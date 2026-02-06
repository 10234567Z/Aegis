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

export {
  LiFiClient,
  getLiFiClient,
  LiFiError,
  getQuickQuote,
  NATIVE_TOKEN,
  LIFI_DIAMOND,
  type LiFiConfig,
  type QuoteRequest,
  type Route,
  type RouteStep,
  type TokenInfo,
  type ChainInfo,
  type TransactionRequest,
  type ExecutionStatus,
} from './core/lifi';

// ─── Cross-Chain Sync ───

export {
  SecurityEventEncoder,
  CrossChainBroadcaster,
  CrossChainSync,
  createBroadcaster,
  createCrossChainSync,
  createSecurityEvent,
  SUPPORTED_CHAINS,
  type SecurityEvent,
  type SecurityEventType,
  type Severity,
  type ActionParameters,
  type PropagationStatus,
  type EventPropagationResult,
  type ChainConfig,
  type ChainSecurityState,
  type BroadcasterConfig,
  type SubscriptionConfig,
  type EventCallback,
} from './core/crosschain';

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

// Re-export constants
export {
  PROTOCOL_ADDRESSES,
  VDF_WORKER_URL,
  GUARDIAN_API_URL,
  VDF_WORKER_URL_TESTNET,
  GUARDIAN_API_URL_TESTNET,
  LIFI_API_URL,
  LIFI_INTEGRATOR_ID,
  VDF_ITERATIONS,
  VDF_DELAY_SECONDS,
  ML_BOT_THRESHOLD,
} from './core/constants';

// ─── Version ───

export const VERSION = '1.0.0';

// ─── Quick Start Helpers ───

import { ethers } from 'ethers';
import { createSecurityMiddleware, MiddlewareConfig } from './core/middleware';
import {
  PROTOCOL_ADDRESSES,
  VDF_WORKER_URL,
  GUARDIAN_API_URL,
  VDF_WORKER_URL_TESTNET,
  GUARDIAN_API_URL_TESTNET,
} from './core/constants';

/**
 * Quick setup for mainnet.
 * @throws Error if mainnet contracts are not yet deployed
 */
export function createMainnetMiddleware(
  provider: ethers.Provider,
  signer: ethers.Signer,
): ReturnType<typeof createSecurityMiddleware> {
  const addresses = PROTOCOL_ADDRESSES[1];
  if (!addresses.middleware || !addresses.registry) {
    throw new Error('Mainnet contracts not yet deployed. Use createSecurityMiddleware() with explicit addresses.');
  }

  return createSecurityMiddleware({
    security: {
      middlewareAddress: addresses.middleware,
      registryAddress: addresses.registry,
      chainId: 1,
    },
    vdfWorkerUrl: VDF_WORKER_URL,
    guardianApiUrl: GUARDIAN_API_URL,
    provider,
    signer,
  });
}

/**
 * Quick setup for testnet (Sepolia).
 * @throws Error if testnet contracts are not yet deployed
 */
export function createTestnetMiddleware(
  provider: ethers.Provider,
  signer: ethers.Signer,
): ReturnType<typeof createSecurityMiddleware> {
  const addresses = PROTOCOL_ADDRESSES[11155111];
  if (!addresses.middleware || !addresses.registry) {
    throw new Error('Testnet contracts not yet deployed. Use createSecurityMiddleware() with explicit addresses.');
  }

  return createSecurityMiddleware({
    security: {
      middlewareAddress: addresses.middleware,
      registryAddress: addresses.registry,
      chainId: 11155111,
    },
    vdfWorkerUrl: VDF_WORKER_URL_TESTNET,
    guardianApiUrl: GUARDIAN_API_URL_TESTNET,
    provider,
    signer,
  });
}

/**
 * Quick setup for local development.
 * Addresses must be provided since they're created at runtime.
 */
export function createLocalMiddleware(
  provider: ethers.Provider,
  signer: ethers.Signer,
  addresses: { middleware: string; registry: string },
): ReturnType<typeof createSecurityMiddleware> {
  if (!addresses.middleware || !addresses.registry) {
    throw new Error('Local middleware and registry addresses are required.');
  }

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
