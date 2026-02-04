// Main entry point for VDF module

// Modules
export { VDFProver, computeVDF } from './prover';
export { VDFVerifier, verifyVDF, isValidVDF } from './verifier';
export { VDFClient, getVDFClient, VDFClientConfig } from './client';

// --- Params ---
export {
  getVDFParams,
  getDefaultVDFParams,
  GUARDIAN_VDF_MODULUS,
  isVDFRequired,
  getRequiredDelay,
  getRequiredIterations,
  formatDelay,
  estimateComputeTime,
  printVDFConfig,
} from './params';

// ---types ---
export {
  VDFParams,
  VDFChallenge,
  VDFProof,
  VDFJob,
  SecureTransaction,
  VDFVerificationResult,
  VDFError,
  VDFComputationError,
  VDFVerificationError,
  VDF_CONSTANTS,
} from './types';
