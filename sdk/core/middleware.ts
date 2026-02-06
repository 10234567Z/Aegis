/**
 * sdk/core/middleware.ts
 *
 * Main orchestration layer for Guardian Protocol SDK.
 *
 * This module implements the "Cryptographic Airlock" — the core innovation
 * that separates Intent from Execution.
 *
 * VDF Trigger: ML Bot flag ONLY
 * When ML bot flags a transaction as suspicious, VDF is required.
 * Guardians can bypass VDF by voting to approve.
 *
 * Flow:
 *   1. Capture: SDK intercepts user's intent (swap, bridge, etc.)
 *   2. ML Bot Analysis: Check if transaction is flagged
 *   3. Route Detection: Determine if same-chain or cross-chain (LI.FI)
 *   4. Parallel Trigger:
 *      - VDF Worker: Starts time-lock computation (if ML flagged)
 *      - Guardian Network: Receives alert, starts ZK voting
 *   5. Polling: SDK polls both until ready
 *   6. Aggregation: Combine VDF proof + FROST signature
 *   7. Execution: Submit to SecurityMiddleware contract
 */

import { ethers } from 'ethers';
import { SecurityContract, SecurityConfig, VDFProof, FrostSignature } from './contract';
import { VDFClient, VDFRequest, VDFStatus } from './VDF';
import { ZKVoteClient, VoteStatus } from './ZK';
import { LiFiClient, LiFiConfig, Route } from './lifi';

// ─── Types ───

export interface MiddlewareConfig {
  security: SecurityConfig;
  vdfWorkerUrl: string;
  guardianApiUrl: string;
  lifiConfig?: Partial<LiFiConfig>;
  provider: ethers.Provider;
  signer?: ethers.Signer;
}

export interface TransactionIntent {
  type: 'swap' | 'bridge' | 'generic';
  target: string;                   // Target contract address
  data: string;                     // Encoded calldata
  value: bigint;                    // ETH value
  amount: bigint;                   // Token amount (for display)
  sourceChain: number;              // Source chain ID
  destChain?: number;               // Destination chain (for bridges)
  mlBotFlagged: boolean;            // ML bot flagged as suspicious
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
  executionTime: number;
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

  isCrossChain(intent: TransactionIntent): boolean {
    return !!(intent.destChain && intent.destChain !== intent.sourceChain);
  }

  isBridge(intent: TransactionIntent): boolean {
    return intent.type === 'bridge' || this.isCrossChain(intent);
  }

  /**
   * Execute a transaction through the security middleware.
   * This is the main entry point for dApps.
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

    // Step 1: Determine what's required based on ML bot flag
    const requiresVDF = this.vdfClient.isVDFRequired(routedIntent.mlBotFlagged);

    if (requiresVDF) {
      this.emitProgress(onProgress, {
        stage: 'submitted',
        message: 'ML Bot flagged transaction as suspicious - VDF required (30 min delay)',
      });
    }

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

  private async routeIntent(
    intent: TransactionIntent,
    onProgress?: (progress: ExecutionProgress) => void,
  ): Promise<TransactionIntent> {
    if (!this.isCrossChain(intent)) {
      return intent;
    }

    this.emitProgress(onProgress, {
      stage: 'submitted',
      message: 'Fetching optimal cross-chain route via LI.FI...',
    });

    const route = await this.lifiClient.getQuote({
      fromChain: intent.sourceChain,
      toChain: intent.destChain!,
      fromToken: intent.metadata?.tokenIn || '0x0000000000000000000000000000000000000000',
      toToken: intent.metadata?.tokenOut || '0x0000000000000000000000000000000000000000',
      fromAmount: intent.amount.toString(),
      fromAddress: await this.getSenderAddress(),
      slippage: intent.metadata?.slippage || 0.005,
    });

    const tx = await this.lifiClient.buildTransaction(route);

    this.emitProgress(onProgress, {
      stage: 'submitted',
      message: `Route found: ${route.steps.map(s => s.tool).join(' → ')} (Gas: $${route.gasCostUSD})`,
    });

    return {
      ...intent,
      target: tx.to,
      data: tx.data,
      value: BigInt(tx.value),
      metadata: {
        ...intent.metadata,
        protocol: 'lifi',
      } as any,
    };
  }

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
   * Only triggered when ML bot flags transaction.
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
      chainId: intent.sourceChain,
      sender: await this.getSenderAddress(),
      mlBotFlagged: true,
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
    const proposalId = await this.zkClient.submitForReview({
      txHash,
      target: intent.target,
      value: intent.value,
      data: intent.data,
      chainId: intent.sourceChain,
      sender: await this.getSenderAddress(),
      amount: intent.amount,
    });

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

  private async preflight(intent: TransactionIntent): Promise<void> {
    const isPaused = await this.contract.isPaused();
    if (isPaused) {
      throw new Error('Protocol is currently paused due to security alert');
    }

    const sender = await this.getSenderAddress();
    const isBlacklisted = await this.contract.isBlacklisted(sender);
    if (isBlacklisted) {
      throw new Error('Sender address is blacklisted');
    }

    if (!intent.target || intent.target === ethers.ZeroAddress) {
      throw new Error('Invalid target address');
    }
  }

  private generateTxHash(intent: TransactionIntent): string {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'bytes', 'uint256', 'uint256', 'uint256'],
        [intent.target, intent.data, intent.value, intent.sourceChain, Date.now()],
      ),
    );
  }

  private async getSenderAddress(): Promise<string> {
    if (!this.config.signer) {
      throw new Error('Signer required');
    }
    return this.config.signer.getAddress();
  }

  private emitProgress(
    callback: ((progress: ExecutionProgress) => void) | undefined,
    progress: ExecutionProgress,
  ): void {
    if (callback) {
      callback(progress);
    }
  }

  // ─── Query Methods ───

  async getSecurityState() {
    return this.contract.getSecurityState();
  }

  async isBlacklisted(address: string) {
    return this.contract.isBlacklisted(address);
  }
}

// ─── Factory Function ───

export function createSecurityMiddleware(config: MiddlewareConfig): SecurityMiddleware {
  return new SecurityMiddleware(config);
}
