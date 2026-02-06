/// <reference types="node" />

// --- VDF Configuration ---

export interface VDFParams {
  modulus: bigint;              // RSA modulus (2048 bit)
  iterations: number;           // Total squarings (T)
  securityParameter: number;    // typically 128 bits
}

export interface VDFChallenge {
  input: Buffer;                // Input value - proposal ID??
  timestamp: number;            // When time lock starts
  iterations: number;           // Total squarings (T)
  mlBotFlagged?: boolean;       // Whether ML bot flagged as suspicious
}

export interface VDFProof {
  output: Buffer;               // y = x^(2^T) mod N
  proof: Buffer;                // π proof element
  iterations: number;           // T value used
  computeTime: number;          // Actual time taken (ms)
}

// --- VDF Job (for worker/server) ---
export interface VDFJob {
  jobId: string;
  proposalId: string;
  challenge: VDFChallenge;
  status: 'pending' | 'computing' | 'complete' | 'failed' | 'bypassed';
  progress: number;
  startTime: number;
  endTime?: number;
  proof?: VDFProof;
  error?: string;
}

// --- Transaction with VDF ---
export interface SecureTransaction {
  txHash: string;
  proposalId: string;
  sender: string;
  destination: string;
  chainId: number;
  mlBotFlagged: boolean;
  vdfRequired: boolean;
  vdfJob?: VDFJob;
  guardianApproved?: boolean;
  status: 'pending' | 'vdf_computing' | 'guardian_review' | 'ready' | 'executed' | 'rejected';
}

// --- VDF Verification Result ---
export interface VDFVerificationResult {
  valid: boolean;
  message: string;
  computeTime?: number;
  expectedTime?: number;
}

// --- Errors ---
export class VDFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VDFError';
  }
}
export class VDFComputationError extends VDFError {
  constructor(message: string) {
    super(`VDF Computation Error: ${message}`);
    this.name = 'VDFComputationError';
  }
}
export class VDFVerificationError extends VDFError {
  constructor(message: string) {
    super(`VDF Verification Error: ${message}`);
    this.name = 'VDFVerificationError';
  }
}

// --- Constants ---
export const VDF_CONSTANTS = {
  VDF_DELAY_SECONDS: 1800,          // 30 minutes
  VDF_ITERATIONS: 300_000_000,      // 1800s * 166k squarings/second (fast hardware)
  MODULUS_BITS: 2048,               // RSA modulus size
  SECURITY_BITS: 128,               // Security parameter
  SQUARINGS_PER_SECOND: 166_000,    // Calibrated for modern hardware
};
