/**
 * Sack Money SDK
 * 
 * A security middleware SDK that adds a "Cryptographic Airlock" to DeFi.
 * Enforces Guardian consensus (FROST) and time-delays (VDF) before execution.
 * 
 * @example
 * ```typescript
 * import { createSecurityMiddleware } from '@sackmoney/sdk';
 * 
 * const middleware = createSecurityMiddleware({
 *   security: {
 *     middlewareAddress: '0x...',
 *     registryAddress: '0x...',
 *     chainId: 1,
 *   },
 *   vdfWorkerUrl: 'https://vdf.sackmoney.io',
 *   guardianApiUrl: 'https://guardians.sackmoney.io',
 *   provider,
 *   signer,
 * });
 * 
 * const result = await middleware.executeSecurely({
 *   type: 'swap',
 *   target: UNISWAP_ROUTER,
 *   data: swapCalldata,
 *   value: 0n,
 *   amount: parseEther('100'),
 *   sourceChain: 1,
 * }, (progress) => {
 *   console.log(progress.message);
 * });
 * ```
 */

// ─── Core Exports ───

export {
  SecurityMiddleware,
  createSecurityMiddleware,
  type MiddlewareConfig,
  type TransactionIntent,
  type ExecutionResult,
  type ExecutionProgress,
} from './core/middleware';

export {
  SecurityContract,
  type SecurityConfig,
  type ExecuteParams,
  type VDFProof,
  type FrostSignature,
  type SecurityState,
} from './core/contract';

export {
  VDFClient,
  getVDFClient,
  type VDFConfig,
  type VDFRequest,
  type VDFStatus,
} from './core/VDF';

export {
  ZKVoteClient,
  getZKVoteClient,
  type ZKVoteConfig,
  type TransactionProposal,
  type VoteStatus,
  type GuardianInfo,
} from './core/ZK';

// Re-export shared types (single source of truth)
export {
  VOTE_VALUES,
  GUARDIAN_COUNT,
  GUARDIAN_THRESHOLD,
  isProposalApproved,
  isProposalRejected,
  getVotingPhase,
  type VoteDecision,
  type VoteValue,
  type Groth16Proof,
  type ZKProofResult,
  type VoteCommitment,
  type ProposalData,
  type ProposalState,
} from './core/types';

// ─── Version ───

export const VERSION = '1.0.0';

// ─── Quick Start Helpers ───

import { ethers } from 'ethers';
import { createSecurityMiddleware, MiddlewareConfig } from './core/middleware';

/**
 * Quick setup for mainnet.
 */
export function createMainnetMiddleware(
  provider: ethers.Provider,
  signer: ethers.Signer,
): ReturnType<typeof createSecurityMiddleware> {
  return createSecurityMiddleware({
    security: {
      middlewareAddress: process.env.MAINNET_MIDDLEWARE_ADDRESS || '',
      registryAddress: process.env.MAINNET_REGISTRY_ADDRESS || '',
      chainId: 1,
    },
    vdfWorkerUrl: process.env.VDF_WORKER_URL || 'https://vdf.sackmoney.io',
    guardianApiUrl: process.env.GUARDIAN_API_URL || 'https://guardians.sackmoney.io',
    provider,
    signer,
  });
}

/**
 * Quick setup for testnet (Sepolia).
 */
export function createTestnetMiddleware(
  provider: ethers.Provider,
  signer: ethers.Signer,
): ReturnType<typeof createSecurityMiddleware> {
  return createSecurityMiddleware({
    security: {
      middlewareAddress: process.env.TESTNET_MIDDLEWARE_ADDRESS || '',
      registryAddress: process.env.TESTNET_REGISTRY_ADDRESS || '',
      chainId: 11155111,
    },
    vdfWorkerUrl: process.env.VDF_WORKER_URL || 'https://vdf-testnet.sackmoney.io',
    guardianApiUrl: process.env.GUARDIAN_API_URL || 'https://guardians-testnet.sackmoney.io',
    provider,
    signer,
  });
}

/**
 * Quick setup for local development.
 */
export function createLocalMiddleware(
  provider: ethers.Provider,
  signer: ethers.Signer,
  addresses: { middleware: string; registry: string },
): ReturnType<typeof createSecurityMiddleware> {
  return createSecurityMiddleware({
    security: {
      middlewareAddress: addresses.middleware,
      registryAddress: addresses.registry,
      chainId: 31337,
    },
    vdfWorkerUrl: 'http://localhost:3001',
    guardianApiUrl: 'http://localhost:3002',
    provider,
    signer,
  });
}
