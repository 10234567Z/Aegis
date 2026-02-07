/**
 * sdk/core/VDF.ts
 *
 * VDF (Verifiable Delay Function) module for time-lock proofs.
 *
 * Trigger: ML Bot flag ONLY
 * When ML bot detects suspicious transaction patterns, it flags the tx.
 * Flagged transactions require VDF proof (30 min delay) before execution.
 * Guardians can bypass VDF by approving the transaction.
 *
 * Flow:
 *   1. ML bot analyzes transaction and flags if suspicious
 *   2. If flagged, SDK requests VDF proof from worker
 *   3. Worker computes sequential hash chain (30 min, cannot be parallelized)
 *   4. SDK polls until proof is ready OR guardians bypass
 *   5. Proof is submitted to SecurityMiddleware for on-chain verification
 *
 * Alignment with lib/vdf:
 *   - Both use mlBotFlagged boolean as trigger
 *   - Both use 30 min / 54M iterations when flagged
 *   - Use adapters.ts to convert Buffer ↔ string types
 */

import { VDFProof } from './contract';
import {
  VDF_POLL_INTERVAL,
  VDF_TIMEOUT,
  VDF_ITERATIONS,
  VDF_DELAY_SECONDS,
} from './constants';

// ─── Types ───

export interface VDFConfig {
  workerUrl: string;              // VDF Worker server URL
  pollInterval: number;           // Polling interval in ms
  timeout: number;                // Max wait time in ms
}

export interface VDFRequest {
  txHash: string;                 // Unique identifier for this tx
  chainId: number;                // Source chain
  sender: string;                 // Transaction sender
  mlBotFlagged: boolean;          // ML bot flagged as suspicious
}

export interface VDFStatus {
  status: 'pending' | 'computing' | 'ready' | 'failed' | 'bypassed';
  progress: number;               // 0-100 percentage
  estimatedTimeLeft: number;      // Seconds remaining
  proof?: VDFProof;               // Available when status === 'ready'
  error?: string;                 // Available when status === 'failed'
}

// ─── Constants ───

const DEFAULT_CONFIG: Omit<VDFConfig, 'workerUrl'> & { workerUrl: string } = {
  workerUrl: '',  // Must be provided by caller
  pollInterval: VDF_POLL_INTERVAL,
  timeout: VDF_TIMEOUT,
};

// ─── VDF Client ───

export class VDFClient {
  private config: VDFConfig;

  constructor(config: Partial<VDFConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if VDF is required based on ML bot flag.
   * Simple: flagged = VDF required, not flagged = no VDF.
   */
  isVDFRequired(mlBotFlagged: boolean): boolean {
    return mlBotFlagged;
  }

  /**
   * Get VDF parameters (fixed when ML bot flags).
   */
  getVDFParams(): { iterations: number; delaySeconds: number; delayFormatted: string } {
    return {
      iterations: VDF_ITERATIONS,
      delaySeconds: VDF_DELAY_SECONDS,
      delayFormatted: '30 minutes',
    };
  }

  /**
   * Request VDF computation from the worker.
   * Returns immediately — use pollStatus() or waitForProof() to get result.
   */
  async requestProof(request: VDFRequest): Promise<string> {
    if (!request.mlBotFlagged) {
      throw new Error('VDF not required: transaction not flagged by ML bot');
    }

    const response = await fetch(`${this.config.workerUrl}/vdf/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        txHash: request.txHash,
        chainId: request.chainId,
        sender: request.sender,
        iterations: VDF_ITERATIONS,
        mlBotFlagged: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`VDF request failed: ${error}`);
    }

    const data = await response.json() as { jobId: string };
    return data.jobId;
  }

  /**
   * Poll the status of a VDF computation.
   */
  async pollStatus(jobId: string): Promise<VDFStatus> {
    const response = await fetch(`${this.config.workerUrl}/vdf/status/${jobId}`);

    if (!response.ok) {
      throw new Error(`Failed to get VDF status: ${response.statusText}`);
    }

    return response.json() as Promise<VDFStatus>;
  }

  /**
   * Wait for VDF proof to be ready.
   * Polls until complete, bypassed, or timeout.
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

      if (status.status === 'bypassed') {
        // Guardian approved - return zero proof
        return this.createZeroProof();
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
  async getMockProof(txHash: string): Promise<VDFProof> {
    const response = await fetch(`${this.config.workerUrl}/vdf/mock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        txHash,
        iterations: VDF_ITERATIONS,
      }),
    });

    if (!response.ok) {
      throw new Error('Mock VDF not available (worker not in dev mode)');
    }

    return response.json() as Promise<VDFProof>;
  }

  /**
   * Create a zero-proof for transactions that don't require VDF
   * or when guardians bypass the VDF.
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