/**
 * VDF Job Manager - Handles job queue and status tracking
 */

import { v4 as uuidv4 } from 'uuid';
import { VDFJob, VDFRequestBody, VDFStatusResponse, VDFProofResult } from './types';
import { VDFProver, MockVDFProver } from './vdf-prover';

export class JobManager {
  private jobs: Map<string, VDFJob> = new Map();
  private prover: VDFProver;
  private mockProver: MockVDFProver;
  private devMode: boolean;

  constructor(devMode: boolean = false) {
    this.devMode = devMode;
    this.prover = new VDFProver();
    this.mockProver = new MockVDFProver();
    console.log(`[JobManager] Initialized (devMode: ${devMode})`);
  }

  /**
   * Create a new VDF computation job
   */
  createJob(request: VDFRequestBody): string {
    const jobId = uuidv4();
    const estimatedTime = this.estimateTime(request.iterations);

    const job: VDFJob = {
      jobId,
      txHash: request.txHash,
      chainId: request.chainId,
      sender: request.sender,
      iterations: request.iterations,
      mlBotFlagged: request.mlBotFlagged,
      status: 'pending',
      progress: 0,
      estimatedTimeLeft: estimatedTime,
      startTime: Date.now(),
    };

    this.jobs.set(jobId, job);
    console.log(`[JobManager] Created job ${jobId} for tx ${request.txHash.slice(0, 10)}...`);

    // Start computation asynchronously
    this.startComputation(jobId);

    return jobId;
  }

  /**
   * Get job status
   */
  getStatus(jobId: string): VDFStatusResponse | null {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }

    return {
      status: job.status,
      progress: job.progress,
      estimatedTimeLeft: job.estimatedTimeLeft,
      proof: job.proof,
      error: job.error,
    };
  }

  /**
   * Bypass VDF for a job (guardian approval)
   */
  bypassJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) {
      return false;
    }

    if (job.status === 'ready' || job.status === 'failed') {
      return false; // Can't bypass completed jobs
    }

    job.status = 'bypassed';
    job.endTime = Date.now();
    job.proof = this.prover.createZeroProof();
    console.log(`[JobManager] Job ${jobId} bypassed by guardians`);

    return true;
  }

  /**
   * Generate mock proof (dev mode only)
   */
  async getMockProof(txHash: string, iterations: number): Promise<VDFProofResult | null> {
    if (!this.devMode) {
      return null;
    }

    const input = Buffer.from(txHash.replace('0x', ''), 'hex');
    return this.mockProver.compute(input, iterations);
  }

  /**
   * Get all jobs (for debugging)
   */
  getAllJobs(): VDFJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Clean up old jobs (call periodically)
   */
  cleanup(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [jobId, job] of this.jobs.entries()) {
      const age = now - job.startTime;
      if (age > maxAgeMs && (job.status === 'ready' || job.status === 'failed' || job.status === 'bypassed')) {
        this.jobs.delete(jobId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[JobManager] Cleaned up ${cleaned} old jobs`);
    }

    return cleaned;
  }

  // --- Private Methods ---

  private async startComputation(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'computing';
    console.log(`[JobManager] Starting computation for job ${jobId}`);

    try {
      const input = Buffer.from(job.txHash.replace('0x', '').padEnd(64, '0').slice(0, 64), 'hex');

      const proof = await this.prover.compute(
        input,
        job.iterations,
        (progress, iteration, estimatedTimeLeft) => {
          // Update job progress
          const currentJob = this.jobs.get(jobId);
          if (currentJob && currentJob.status === 'computing') {
            currentJob.progress = progress;
            currentJob.estimatedTimeLeft = estimatedTimeLeft;
          }
        }
      );

      // Check if job was bypassed during computation
      const currentJob = this.jobs.get(jobId);
      if (currentJob && currentJob.status === 'computing') {
        currentJob.status = 'ready';
        currentJob.progress = 100;
        currentJob.estimatedTimeLeft = 0;
        currentJob.proof = proof;
        currentJob.endTime = Date.now();
        console.log(`[JobManager] Job ${jobId} completed successfully`);
      }
    } catch (error) {
      const currentJob = this.jobs.get(jobId);
      if (currentJob) {
        currentJob.status = 'failed';
        currentJob.error = String(error);
        currentJob.endTime = Date.now();
        console.error(`[JobManager] Job ${jobId} failed:`, error);
      }
    }
  }

  private estimateTime(iterations: number): number {
    // Estimate ~30,000 squarings per second
    const squaringsPerSecond = 30000;
    return Math.ceil(iterations / squaringsPerSecond);
  }
}
