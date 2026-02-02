/**
 * sdk/core/VDF.ts
 * 
 * VDF (Verifiable Delay Function) module for time-lock proofs.
 * 
 * The VDF enforces a mandatory time delay before high-value transactions
 * can execute. This gives Guardians time to review and potentially block
 * malicious transactions.
 * 
 * Flow:
 *   1. SDK calculates required iterations based on tx amount
 *   2. SDK sends request to VDF Worker (off-chain server)
 *   3. Worker computes sequential hash chain (cannot be parallelized)
 *   4. SDK polls until proof is ready
 *   5. Proof is submitted to SecurityMiddleware for on-chain verification
 */

import { VDFProof } from './contract';

// ─── Types ───

export interface VDFConfig {
  workerUrl: string;              // VDF Worker server URL
  pollInterval: number;           // Polling interval in ms (default: 2000)
  timeout: number;                // Max wait time in ms (default: 600000 = 10 min)
}

export interface VDFRequest {
  txHash: string;                 // Unique identifier for this tx
  amount: bigint;                 // Transaction amount (determines iterations)
  chainId: number;                // Source chain
  sender: string;                 // Transaction sender
}

export interface VDFStatus {
  status: 'pending' | 'computing' | 'ready' | 'failed';
  progress: number;               // 0-100 percentage
  estimatedTimeLeft: number;      // Seconds remaining
  proof?: VDFProof;               // Available when status === 'ready'
  error?: string;                 // Available when status === 'failed'
}

// ─── Constants ───

const DEFAULT_CONFIG: VDFConfig = {
  workerUrl: 'http://localhost:3001',
  pollInterval: 2000,
  timeout: 600000,
};

// Iteration tiers based on transaction amount (in wei)
const ITERATION_TIERS = [
  { threshold: BigInt('1000000000000000000000'),    iterations: 1000000 },   // > 1000 ETH: ~5 min
  { threshold: BigInt('100000000000000000000'),     iterations: 500000 },    // > 100 ETH: ~2.5 min
  { threshold: BigInt('10000000000000000000'),      iterations: 100000 },    // > 10 ETH: ~30 sec
  { threshold: BigInt('1000000000000000000'),       iterations: 10000 },     // > 1 ETH: ~5 sec
  { threshold: BigInt('0'),                         iterations: 0 },         // < 1 ETH: no delay
];

// ─── VDF Client ───

export class VDFClient {
  private config: VDFConfig;

  constructor(config: Partial<VDFConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Calculate required iterations based on transaction amount.
   */
  calculateIterations(amount: bigint): number {
    for (const tier of ITERATION_TIERS) {
      if (amount >= tier.threshold) {
        return tier.iterations;
      }
    }
    return 0;
  }

  /**
   * Check if VDF is required for this amount.
   */
  isVDFRequired(amount: bigint): boolean {
    return this.calculateIterations(amount) > 0;
  }

  /**
   * Request VDF computation from the worker.
   * Returns immediately — use pollStatus() or waitForProof() to get result.
   */
  async requestProof(request: VDFRequest): Promise<string> {
    const iterations = this.calculateIterations(request.amount);
    
    if (iterations === 0) {
      throw new Error('VDF not required for this amount');
    }

    const response = await fetch(`${this.config.workerUrl}/vdf/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        txHash: request.txHash,
        amount: request.amount.toString(),
        chainId: request.chainId,
        sender: request.sender,
        iterations,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`VDF request failed: ${error}`);
    }

    const { jobId } = await response.json();
    return jobId;
  }

  /**
   * Poll the status of a VDF computation.
   */
  async pollStatus(jobId: string): Promise<VDFStatus> {
    const response = await fetch(`${this.config.workerUrl}/vdf/status/${jobId}`);

    if (!response.ok) {
      throw new Error(`Failed to get VDF status: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Wait for VDF proof to be ready.
   * Polls until complete or timeout.
   */
  async waitForProof(jobId: string, onProgress?: (status: VDFStatus) => void): Promise<VDFProof> {
    const startTime = Date.now();

    while (true) {
      const status = await this.pollStatus(jobId);

      if (onProgress) {
        onProgress(status);
      }

      if (status.status === 'ready' && status.proof) {
        return status.proof;
      }

      if (status.status === 'failed') {
        throw new Error(`VDF computation failed: ${status.error}`);
      }

      if (Date.now() - startTime > this.config.timeout) {
        throw new Error('VDF computation timed out');
      }

      await this.sleep(this.config.pollInterval);
    }
  }

  /**
   * Request and wait for proof in one call.
   * Convenience method for simple usage.
   */
  async getProof(
    request: VDFRequest, 
    onProgress?: (status: VDFStatus) => void,
  ): Promise<VDFProof> {
    const jobId = await this.requestProof(request);
    return this.waitForProof(jobId, onProgress);
  }

  /**
   * Generate a mock proof for testing (skips actual computation).
   * Only available when worker is in dev mode.
   */
  async getMockProof(request: VDFRequest): Promise<VDFProof> {
    const iterations = this.calculateIterations(request.amount);

    const response = await fetch(`${this.config.workerUrl}/vdf/mock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        txHash: request.txHash,
        iterations,
      }),
    });

    if (!response.ok) {
      throw new Error('Mock VDF not available (worker not in dev mode)');
    }

    return response.json();
  }

  /**
   * Create a zero-proof for transactions that don't require VDF.
   */
  createZeroProof(): VDFProof {
    return {
      output: '0x' + '0'.repeat(64),
      proof: '0x',
      iterations: 0,
    };
  }

  // ─── Helpers ───

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ─── Singleton Export ───

let defaultClient: VDFClient | null = null;

export function getVDFClient(config?: Partial<VDFConfig>): VDFClient {
  if (!defaultClient || config) {
    defaultClient = new VDFClient(config);
  }
  return defaultClient;
}