/**
 * VDF Worker Types
 */

export interface VDFJob {
  jobId: string;
  txHash: string;
  chainId: number;
  sender: string;
  iterations: number;
  mlBotFlagged: boolean;
  status: 'pending' | 'computing' | 'ready' | 'failed' | 'bypassed';
  progress: number;
  estimatedTimeLeft: number;
  startTime: number;
  endTime?: number;
  proof?: VDFProofResult;
  error?: string;
}

export interface VDFProofResult {
  output: string;   // hex bytes32
  proof: string;    // hex bytes
  iterations: number;
}

export interface VDFRequestBody {
  txHash: string;
  chainId: number;
  sender: string;
  iterations: number;
  mlBotFlagged: boolean;
}

export interface VDFStatusResponse {
  status: 'pending' | 'computing' | 'ready' | 'failed' | 'bypassed';
  progress: number;
  estimatedTimeLeft: number;
  proof?: VDFProofResult;
  error?: string;
}

export interface VDFParams {
  modulus: bigint;
  generator: bigint;
}
