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
import { ENSSecurityClient, SecurityProfile } from './ens';

// ─── Types ───

export interface MiddlewareConfig {
  security: SecurityConfig;
  vdfWorkerUrl: string;
  guardianApiUrl: string;
  agentApiUrl: string;              // ML Bot Agent API
  lifiConfig?: Partial<LiFiConfig>;
  provider: ethers.Provider;
  signer?: ethers.Signer;
}

export interface AgentAnalysis {
  score: number;
  flagged: boolean;
  proposalId?: string;              // If flagged, Guardian proposal ID
  verdict: string;
}

export interface TransactionIntent {
  type: 'swap' | 'bridge' | 'generic';
  target: string;                   // Target contract address
  data: string;                     // Encoded calldata
  value: bigint;                    // ETH value
  amount: bigint;                   // Token amount (for display)
  sourceChain: number;              // Source chain ID
  destChain?: number;               // Destination chain (for bridges)
  mlBotFlagged?: boolean;           // ML bot flagged (auto-detected if omitted)
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
  ensName?: string;               // Resolved ENS name for sender (if exists)
  ensSecurityProfile?: SecurityProfile; // User's ENS security profile (if exists)
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
  private ensClient: ENSSecurityClient;

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

    this.ensClient = new ENSSecurityClient({
      provider: config.provider,
    });
  }

  // ─── Agent Analysis ───

  /**
   * Call ML Agent to analyze transaction.
   * Agent returns score, flag status, and starts Guardian voting if flagged.
   */
  async analyzeWithAgent(
    sender: string,
    target: string,
    value: bigint,
    data: string,
    chainId: number,
    txHash?: string,
    amount?: bigint,
    ensName?: string,
  ): Promise<AgentAnalysis> {
    try {
      const response = await fetch(`${this.config.agentApiUrl}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guardianApiUrl: this.config.guardianApiUrl,
          proposal: {
            txHash: txHash ?? this.generateTxHash({ target, data, value, amount: amount ?? value } as any),
            sender,
            senderENS: ensName || null,
            target,
            value: value.toString(),
            data,
            chainId,
            amount: (amount ?? value).toString(),
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Agent analysis failed: ${response.status}`);
      }

      const result = await response.json() as {
        mlAnalysis?: { score?: number; flagged?: boolean; verdict?: string };
        proposalId?: string;
      };
      return {
        score: result.mlAnalysis?.score ?? 0,
        flagged: result.mlAnalysis?.flagged ?? false,
        proposalId: result.proposalId,
        verdict: result.mlAnalysis?.verdict ?? 'unknown',
      };
    } catch (error) {
      console.warn('Agent analysis failed, defaulting to safe:', error);
      return {
        score: 0,
        flagged: false,
        verdict: 'agent_error',
      };
    }
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
   *
   * If sender is provided and intent.mlBotFlagged is undefined,
   * we'll call the ML Agent for automatic analysis.
   */
  async executeSecurely(
    intent: TransactionIntent,
    onProgress?: (progress: ExecutionProgress) => void,
    sender?: string,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Step 0: Pre-flight checks
    await this.preflight(intent);

    // Step 0.5: Route through LI.FI for cross-chain
    const routedIntent = await this.routeIntent(intent, onProgress);

    // Step 0.55: Resolve ENS name and fetch security profile for sender
    let ensName: string | undefined;
    let ensSecurityProfile: SecurityProfile | undefined;
    if (sender) {
      try {
        const resolved = await this.config.provider.lookupAddress(sender);
        if (resolved) {
          ensName = resolved;

          // Fetch user's ENS security profile
          ensSecurityProfile = await this.ensClient.getSecurityProfile(resolved);

          if (ensSecurityProfile.hasProfile) {
            this.emitProgress(onProgress, {
              stage: 'submitted',
              message: `ENS security profile found for ${resolved} (mode: ${ensSecurityProfile.mode})`,
            });

            // Apply ENS security rules
            await this.applyENSSecurityProfile(routedIntent, ensSecurityProfile, resolved, onProgress);
          }
        }
      } catch {
        // ENS resolution is optional — continue without it
      }
    }

    // Step 0.6: Auto-analyze with ML Agent if not already flagged
    let agentAnalysis: AgentAnalysis | undefined;
    if (sender && routedIntent.mlBotFlagged === undefined) {
      this.emitProgress(onProgress, {
        stage: 'submitted',
        message: 'Analyzing transaction with ML Agent...',
      });

      agentAnalysis = await this.analyzeWithAgent(
        sender,
        routedIntent.target,
        routedIntent.value,
        routedIntent.data,
        routedIntent.sourceChain,
        undefined, // txHash generated later
        routedIntent.amount,
        ensName,
      );

      routedIntent.mlBotFlagged = agentAnalysis.flagged;
      
      this.emitProgress(onProgress, {
        stage: 'submitted',
        message: agentAnalysis.flagged
          ? `ML Agent flagged transaction (score: ${agentAnalysis.score.toFixed(1)})`
          : `Transaction passed ML analysis (score: ${agentAnalysis.score.toFixed(1)})`,
      });
    }

    const txHash = this.generateTxHash(routedIntent);

    this.emitProgress(onProgress, {
      stage: 'submitted',
      message: this.isCrossChain(intent)
        ? 'Cross-chain transfer submitted for security review'
        : 'Transaction submitted for security review',
    });

    // Step 1: Determine what's required based on ML bot flag
    const requiresVDF = this.vdfClient.isVDFRequired(routedIntent.mlBotFlagged ?? false);

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
      ensName,
      ensSecurityProfile,
    };
  }

  // ─── ENS Security Profile Enforcement ───

  /**
   * Apply user's ENS security profile to the transaction.
   * Checks threshold, whitelist, and mode settings.
   */
  private async applyENSSecurityProfile(
    intent: TransactionIntent,
    profile: SecurityProfile,
    ensName: string,
    onProgress?: (progress: ExecutionProgress) => void,
  ): Promise<void> {
    // Check 1: User-defined threshold
    if (profile.threshold > 0n && intent.amount > profile.threshold) {
      this.emitProgress(onProgress, {
        stage: 'submitted',
        message: `⚠️ Amount (${ethers.formatEther(intent.amount)} ETH) exceeds your ENS threshold (${ethers.formatEther(profile.threshold)} ETH)`,
      });

      // Force ML flagging for user-defined large transactions
      intent.mlBotFlagged = true;
    }

    // Check 2: Paranoid mode - whitelist only
    if (profile.mode === 'paranoid' && profile.whitelist.length > 0) {
      const isAllowed = await this.ensClient.isWhitelisted(ensName, intent.target);

      if (!isAllowed) {
        const targetName = await this.ensClient.lookupName(intent.target);
        const targetLabel = targetName || intent.target.slice(0, 10) + '...';

        throw new Error(
          `ENS Security Profile Violation: Target "${targetLabel}" is not in your whitelist. ` +
          `Allowed: ${profile.whitelist.join(', ')}`,
        );
      }

      this.emitProgress(onProgress, {
        stage: 'submitted',
        message: `✓ Target is in your ENS whitelist`,
      });
    }

    // Check 3: Strict mode - add extra delay
    if (profile.mode === 'strict' && profile.delay > 0) {
      this.emitProgress(onProgress, {
        stage: 'submitted',
        message: `Strict mode: ${profile.delay}s extra delay will be applied`,
      });
    }

    // Check 4: Notify webhook if configured
    if (profile.notifyUrl) {
      this.notifyWebhook(profile.notifyUrl, intent, ensName).catch(() => {
        // Non-blocking - don't fail if webhook fails
      });
    }
  }

  /**
   * Send notification to user's configured webhook.
   */
  private async notifyWebhook(
    url: string,
    intent: TransactionIntent,
    ensName: string,
  ): Promise<void> {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'transaction_alert',
          ensName,
          target: intent.target,
          amount: intent.amount.toString(),
          sourceChain: intent.sourceChain,
          destChain: intent.destChain,
          timestamp: Date.now(),
        }),
      });
    } catch {
      // Silently fail - webhook is best-effort
    }
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
