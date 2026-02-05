/**
 * sdk/core/middleware.ts
 * 
 * Main orchestration layer for Sack Money SDK.
 * 
 * This module implements the "Cryptographic Airlock" — the core innovation
 * that separates Intent from Execution.
 * 
 * Flow:
 *   1. Capture: SDK intercepts user's intent (swap, bridge, etc.)
 *   2. Route Detection: Determine if same-chain (Uniswap) or cross-chain (LI.FI)
 *   3. Parallel Trigger:
 *      - VDF Worker: Starts time-lock computation (if high-value)
 *      - Guardian Network: Receives alert, starts ZK voting
 *   4. Polling: SDK polls both until ready
 *   5. Aggregation: Combine VDF proof + FROST signature
 *   6. Execution: Submit to SecurityMiddleware contract
 */

import { ethers } from 'ethers';
import { SecurityContract, SecurityConfig, ExecuteParams, VDFProof, FrostSignature } from './contract';
import { VDFClient, VDFRequest, VDFStatus } from './VDF';
import { ZKVoteClient, VoteStatus, TransactionProposal } from './ZK';
import { LiFiClient, LiFiConfig, Route, ExecutionStatus as LiFiStatus, LIFI_DIAMOND } from './lifi';
import { AMOUNT_THRESHOLDS } from './constants';

// ─── Types ───

export interface MiddlewareConfig {
  security: SecurityConfig;
  vdfWorkerUrl: string;
  guardianApiUrl: string;
  lifiConfig?: Partial<LiFiConfig>;  // LI.FI API configuration
  provider: ethers.Provider;
  signer?: ethers.Signer;
}

export interface TransactionIntent {
  type: 'swap' | 'bridge' | 'generic';
  target: string;                   // Target contract address
  data: string;                     // Encoded calldata
  value: bigint;                    // ETH value
  amount: bigint;                   // Token amount (for threshold calc)
  sourceChain: number;              // Source chain ID
  destChain?: number;               // Destination chain (for bridges)
  metadata?: {
    protocol: 'uniswap' | 'lifi' | 'custom';
    tokenIn?: string;
    tokenOut?: string;
    slippage?: number;
  };
}

export interface ExecutionResult {
  success: boolean;
  txHash: string;
  receipt: ethers.TransactionReceipt;
  vdfProof: VDFProof;
  frostSignature: FrostSignature;
  executionTime: number;            // Total time in ms
}

export interface ExecutionProgress {
  stage: 'submitted' | 'vdf-pending' | 'voting-pending' | 'ready' | 'executing' | 'complete' | 'failed';
  vdfStatus?: VDFStatus;
  voteStatus?: VoteStatus;
  message: string;
}

// ─── Security Middleware ───

export class SecurityMiddleware {
  private config: MiddlewareConfig;
  private contract: SecurityContract;
  private vdfClient: VDFClient;
  private zkClient: ZKVoteClient;
  private lifiClient: LiFiClient;

  constructor(config: MiddlewareConfig) {
    this.config = config;

    this.contract = new SecurityContract(
      config.provider,
      config.security,
      config.signer,
    );

    this.vdfClient = new VDFClient({
      workerUrl: config.vdfWorkerUrl,
    });

    this.zkClient = new ZKVoteClient({
      guardianApiUrl: config.guardianApiUrl,
    });

    this.lifiClient = new LiFiClient(config.lifiConfig);
  }

  // ─── Cross-Chain Detection ───

  /**
   * Check if intent requires cross-chain routing via LI.FI.
   */
  isCrossChain(intent: TransactionIntent): boolean {
    return !!(intent.destChain && intent.destChain !== intent.sourceChain);
  }

  /**
   * Check if intent is a bridge operation.
   */
  isBridge(intent: TransactionIntent): boolean {
    return intent.type === 'bridge' || this.isCrossChain(intent);
  }

  /**
   * Execute a transaction through the security middleware.
   * This is the main entry point for dApps.
   * 
   * @param intent - The transaction intent
   * @param onProgress - Optional callback for progress updates
   * @returns Execution result with proofs
   */
  async executeSecurely(
    intent: TransactionIntent,
    onProgress?: (progress: ExecutionProgress) => void,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Step 0: Pre-flight checks
    await this.preflight(intent);

    // Step 0.5: Route through LI.FI for cross-chain
    const routedIntent = await this.routeIntent(intent, onProgress);

    const txHash = this.generateTxHash(routedIntent);

    this.emitProgress(onProgress, {
      stage: 'submitted',
      message: this.isCrossChain(intent) 
        ? 'Cross-chain transfer submitted for security review'
        : 'Transaction submitted for security review',
    });

    // Step 1: Determine what's required
    // Cross-chain = always require VDF (higher risk)
    const requiresVDF = this.isCrossChain(intent) || this.vdfClient.isVDFRequired(routedIntent.amount);
    const requiresVoting = true; // Always require guardian oversight

    // Step 2: Start parallel processes
    const [vdfProof, frostSignature] = await Promise.all([
      this.handleVDF(routedIntent, txHash, requiresVDF, onProgress),
      this.handleVoting(routedIntent, txHash, onProgress),
    ]);

    this.emitProgress(onProgress, {
      stage: 'ready',
      message: 'All proofs ready, executing transaction',
    });

    // Step 3: Execute on-chain
    this.emitProgress(onProgress, {
      stage: 'executing',
      message: this.isCrossChain(intent)
        ? 'Submitting cross-chain transfer to SecurityMiddleware'
        : 'Submitting to SecurityMiddleware contract',
    });

    const receipt = await this.contract.executeSecurely({
      target: routedIntent.target,
      data: routedIntent.data,
      value: routedIntent.value,
      vdfProof,
      frostSignature,
    });

    // Step 4: For cross-chain, wait for destination confirmation
    if (this.isCrossChain(intent) && intent.destChain) {
      this.emitProgress(onProgress, {
        stage: 'executing',
        message: 'Waiting for cross-chain confirmation...',
      });

      await this.lifiClient.waitForCompletion(
        receipt.hash,
        intent.sourceChain,
        intent.destChain,
        (status) => {
          this.emitProgress(onProgress, {
            stage: 'executing',
            message: `Cross-chain status: ${status.status}${status.substatus ? ` (${status.substatus})` : ''}`,
          });
        },
      );
    }

    this.emitProgress(onProgress, {
      stage: 'complete',
      message: this.isCrossChain(intent)
        ? 'Cross-chain transfer completed successfully'
        : 'Transaction executed successfully',
    });

    return {
      success: true,
      txHash: receipt.hash,
      receipt,
      vdfProof,
      frostSignature,
      executionTime: Date.now() - startTime,
    };
  }

  // ─── LI.FI Cross-Chain Routing ───

  /**
   * Route intent through LI.FI if cross-chain.
   * Converts high-level intent to actual transaction data.
   */
  private async routeIntent(
    intent: TransactionIntent,
    onProgress?: (progress: ExecutionProgress) => void,
  ): Promise<TransactionIntent> {
    // Same-chain: return as-is
    if (!this.isCrossChain(intent)) {
      return intent;
    }

    this.emitProgress(onProgress, {
      stage: 'submitted',
      message: 'Fetching optimal cross-chain route via LI.FI...',
    });

    // Get quote from LI.FI
    const route = await this.lifiClient.getQuote({
      fromChain: intent.sourceChain,
      toChain: intent.destChain!,
      fromToken: intent.metadata?.tokenIn || '0x0000000000000000000000000000000000000000',
      toToken: intent.metadata?.tokenOut || '0x0000000000000000000000000000000000000000',
      fromAmount: intent.amount.toString(),
      fromAddress: await this.getSenderAddress(),
      slippage: intent.metadata?.slippage || 0.005,
    });

    // Build transaction
    const tx = await this.lifiClient.buildTransaction(route);

    this.emitProgress(onProgress, {
      stage: 'submitted',
      message: `Route found: ${route.steps.map(s => s.tool).join(' → ')} (Gas: $${route.gasCostUSD})`,
    });

    // Return modified intent with LI.FI calldata
    return {
      ...intent,
      target: tx.to,                         // LI.FI Diamond
      data: tx.data,                         // LI.FI calldata
      value: BigInt(tx.value),               // Native token for bridge
      metadata: {
        ...intent.metadata,
        protocol: 'lifi',
        lifiRoute: route,                    // Store route for reference
      } as any,
    };
  }

  /**
   * Get LI.FI quote without executing.
   * Useful for previewing cross-chain routes.
   */
  async getQuote(
    fromChain: number,
    toChain: number,
    fromToken: string,
    toToken: string,
    amount: bigint,
    slippage: number = 0.005,
  ): Promise<Route> {
    return this.lifiClient.getQuote({
      fromChain,
      toChain,
      fromToken,
      toToken,
      fromAmount: amount.toString(),
      fromAddress: await this.getSenderAddress(),
      slippage,
    });
  }

  /**
   * Get multiple route options for comparison.
   */
  async getRoutes(
    fromChain: number,
    toChain: number,
    fromToken: string,
    toToken: string,
    amount: bigint,
    slippage: number = 0.005,
  ): Promise<Route[]> {
    return this.lifiClient.getRoutes({
      fromChain,
      toChain,
      fromToken,
      toToken,
      fromAmount: amount.toString(),
      fromAddress: await this.getSenderAddress(),
      slippage,
    });
  }

  /**
   * Handle VDF proof generation/retrieval.
   */
  private async handleVDF(
    intent: TransactionIntent,
    txHash: string,
    required: boolean,
    onProgress?: (progress: ExecutionProgress) => void,
  ): Promise<VDFProof> {
    if (!required) {
      return this.vdfClient.createZeroProof();
    }

    const request: VDFRequest = {
      txHash,
      amount: intent.amount,
      chainId: intent.sourceChain,
      sender: await this.getSenderAddress(),
    };

    return this.vdfClient.getProof(request, (status) => {
      this.emitProgress(onProgress, {
        stage: 'vdf-pending',
        vdfStatus: status,
        message: `VDF computation: ${status.progress}% (${status.estimatedTimeLeft}s remaining)`,
      });
    });
  }

  /**
   * Handle Guardian voting and FROST signature retrieval.
   */
  private async handleVoting(
    intent: TransactionIntent,
    txHash: string,
    onProgress?: (progress: ExecutionProgress) => void,
  ): Promise<FrostSignature> {
    // Submit for Guardian review
    const proposalId = await this.zkClient.submitForReview({
      txHash,
      target: intent.target,
      value: intent.value,
      data: intent.data,
      chainId: intent.sourceChain,
      sender: await this.getSenderAddress(),
      amount: intent.amount,
    });

    // Wait for voting to complete
    const voteResult = await this.zkClient.waitForVoteResult(proposalId, (status) => {
      this.emitProgress(onProgress, {
        stage: 'voting-pending',
        voteStatus: status,
        message: `Guardian voting: ${status.votes.approve}/${status.threshold} approvals`,
      });
    });

    if (voteResult.isRejected) {
      throw new Error(`Transaction rejected by Guardians (${voteResult.votes.reject} rejections)`);
    }

    if (!voteResult.isApproved || !voteResult.frostSignature) {
      throw new Error('Voting expired without reaching threshold');
    }

    return voteResult.frostSignature;
  }

  /**
   * Pre-flight checks before starting the security flow.
   */
  private async preflight(intent: TransactionIntent): Promise<void> {
    // Check if protocol is paused
    const isPaused = await this.contract.isPaused();
    if (isPaused) {
      throw new Error('Protocol is currently paused due to security alert');
    }

    // Check if sender is blacklisted
    const sender = await this.getSenderAddress();
    const isBlacklisted = await this.contract.isBlacklisted(sender);
    if (isBlacklisted) {
      throw new Error('Sender address is blacklisted');
    }

    // Validate intent
    if (!intent.target || intent.target === ethers.ZeroAddress) {
      throw new Error('Invalid target address');
    }
  }

  /**
   * Generate a unique hash for this transaction intent.
   */
  private generateTxHash(intent: TransactionIntent): string {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'bytes', 'uint256', 'uint256', 'uint256'],
        [intent.target, intent.data, intent.value, intent.sourceChain, Date.now()],
      ),
    );
  }

  /**
   * Get the signer's address.
   */
  private async getSenderAddress(): Promise<string> {
    if (!this.config.signer) {
      throw new Error('Signer required');
    }
    return this.config.signer.getAddress();
  }

  /**
   * Emit progress update if callback provided.
   */
  private emitProgress(
    callback: ((progress: ExecutionProgress) => void) | undefined,
    progress: ExecutionProgress,
  ): void {
    if (callback) {
      callback(progress);
    }
  }

  // ─── Query Methods ───

  /**
   * Get current security state.
   */
  async getSecurityState() {
    return this.contract.getSecurityState();
  }

  /**
   * Check if an address is blacklisted.
   */
  async isBlacklisted(address: string) {
    return this.contract.isBlacklisted(address);
  }

  /**
   * Calculate required delay for an amount.
   */
  async calculateDelay(amount: bigint) {
    return this.contract.calculateRequiredDelay(amount);
  }

  /**
   * Get risk level for an amount.
   */
  getRiskLevel(amount: bigint): 'low' | 'medium' | 'high' | 'critical' {
    if (amount >= AMOUNT_THRESHOLDS.CRITICAL) return 'critical';
    if (amount >= AMOUNT_THRESHOLDS.HIGH) return 'high';
    if (amount >= AMOUNT_THRESHOLDS.MEDIUM) return 'medium';
    return 'low';
  }
}

// ─── Factory Function ───

export function createSecurityMiddleware(config: MiddlewareConfig): SecurityMiddleware {
  return new SecurityMiddleware(config);
}