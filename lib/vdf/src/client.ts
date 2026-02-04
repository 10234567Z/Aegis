/**
 * Interface for SDK integration
 * Handles VDF job management and guardian bypass logic
 */
/// <reference types="node" />

import { VDFProver } from './prover';
import { VDFVerifier } from './verifier';
import { getVDFParams, getRequiredIterations, isVDFRequired } from './params';
import {
  VDFJob,
  VDFChallenge,
  VDFProof,
  SecureTransaction,
  VDFError,
} from './types';

// --- VDF Client Configuration ---

export interface VDFClientConfig {
  workerUrl?: string;           // URL of VDF worker server
  localCompute?: boolean;       // Compute locally vs worker
  pollInterval?: number;        // Polling interval for job status(ms)
}

const DEFAULT_CONFIG: VDFClientConfig = {
  localCompute: true,           // For hackathon, compute locally
  pollInterval: 1000,           // Poll every second
};

// --- VDF Client Class ---
export class VDFClient {
  private config: VDFClientConfig;
  private jobs: Map<string, VDFJob>;
  private prover: VDFProver | null;
  private verifier: VDFVerifier | null;
  
  constructor(config: Partial<VDFClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.jobs = new Map();
    // Initialize prover/verifier if computing locally
    if (this.config.localCompute) {
      const params = getVDFParams(0); // Will be set per job
      this.prover = new VDFProver(params);
      this.verifier = new VDFVerifier(params);
    } else {
      this.prover = null;
      this.verifier = null;
    }
  }
  
  // Check if VDF is required (based on ML bot flag)
  isVDFRequired(mlBotFlagged: boolean): boolean {
    return isVDFRequired(mlBotFlagged);
  }
  
  // Request VDF computation for flagged transaction
  //Returns job ID for tracking

  async requestProof(request: {
    txHash: string;
    chainId: number;
    sender: string;
    mlBotFlagged: boolean;
  }): Promise<string> {
    // Check if VDF is needed
    if (!isVDFRequired(request.mlBotFlagged)) {
      throw new VDFError('VDF not required, transaction clean');
    }
    const iterations = getRequiredIterations();
    const jobId = this.generateJobId();
    const proposalId = this.hashToProposalId(request.txHash);
    const challenge: VDFChallenge = {
      input: Buffer.from(proposalId.slice(2), 'hex'),
      timestamp: Date.now(),
      iterations,
      mlBotFlagged: request.mlBotFlagged,
    };
    const job: VDFJob = {
      jobId,
      proposalId,
      challenge,
      status: 'pending',
      progress: 0,
      startTime: Date.now(),
    };
    this.jobs.set(jobId, job);
    
    // Start computing
    if (this.config.localCompute) {
      this.computeLocal(jobId);
    } else {
      await this.submitToWorker(jobId);
    }
    return jobId;
  }
  
  // Wait for VDF proof to complete
  async waitForProof(
    jobId: string,
    onProgress?: (status: VDFJob) => void
  ): Promise<VDFProof> {
    const maxWaitTime = 35 * 60 * 1000; // 35 minutes max
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitTime) {
      const job = this.jobs.get(jobId);
      if (!job) {
        throw new VDFError(`Job ${jobId} not found`);
      }
      if (onProgress) {
        onProgress(job);
      }
      if (job.status === 'complete' && job.proof) {
        return job.proof;
      }
      if (job.status === 'failed') {
        throw new VDFError(`VDF computation failed: ${job.error}`);
      }
      if (job.status === 'bypassed') {
        return this.createZeroProof();
      }
      await this.sleep(this.config.pollInterval!);
    }
    
    throw new VDFError('VDF computation timeout');
  }
  
  //Bypass VDF if guardians approve
  bypassVDF(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = 'bypassed';
      job.endTime = Date.now();
      console.log(`[VDF Client] Job ${jobId} bypassed by guardians`);
    }
  }
  
  // Create zero proof for guardian bypass
  createZeroProof(): VDFProof {
    return {
      output: Buffer.alloc(32),
      proof: Buffer.alloc(32),
      iterations: 0,
      computeTime: 0,
    };
  }
  
  // Get job status
  getJobStatus(jobId: string): VDFJob | undefined {
    return this.jobs.get(jobId);
  }
  
  // Verify proof
  async verifyProof(challenge: VDFChallenge, proof: VDFProof): Promise<boolean> {
    if (!this.verifier) {
      throw new VDFError('Verifier not initialized');
    }
    return this.verifier.verifyQuick(challenge, proof);
  }
  
  // --- Private Methods ---
  
  private async computeLocal(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || !this.prover) return;
    job.status = 'computing';
    try {
      const params = getVDFParams(job.challenge.iterations);
      const prover = new VDFProver(params);
      const proof = await prover.compute(
        job.challenge,
        (progress, iteration) => {
          job.progress = progress;
        }
      );
      job.proof = proof;
      job.status = 'complete';
      job.endTime = Date.now();
      console.log(`[VDF Client] Job ${jobId} complete`);
    } catch (error) {
      job.status = 'failed';
      job.error = String(error);
      job.endTime = Date.now();
      console.error(`[VDF Client] Job ${jobId} failed:`, error);
    }
  }
  
  private async submitToWorker(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || !this.config.workerUrl) return;
    try {
      const response = await fetch(`${this.config.workerUrl}/vdf/compute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          challenge: {
            input: job.challenge.input.toString('hex'),
            timestamp: job.challenge.timestamp,
            iterations: job.challenge.iterations,
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`Worker request failed: ${response.statusText}`);
      }
      job.status = 'computing';
    } catch (error) {
      job.status = 'failed';
      job.error = String(error);
    }
  }
  
  private generateJobId(): string {
    return 'vdf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }
  
  private hashToProposalId(txHash: string): string {
    // Simple conversion for hackathon, needs proper hashing for prodn
    return txHash.padEnd(66, '0');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance

let defaultClient: VDFClient | null = null;
export function getVDFClient(config?: Partial<VDFClientConfig>): VDFClient {
  if (!defaultClient || config) {
    defaultClient = new VDFClient(config);
  }
  return defaultClient;
}
