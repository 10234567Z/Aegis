/**
 * sdk/core/constants.ts
 * 
 * Protocol constants - immutable values for Sack Money SDK.
 * Single source of truth for the entire SDK.
 * 
 * IMPORTANT: Do not use environment variables for these values.
 * These are protocol-level constants that should not be overridden.
 */

// ─── Deployed Contract Addresses ───

/**
 * Protocol contract addresses per chain.
 * These are deployed and immutable.
 */
export const PROTOCOL_ADDRESSES: Record<number, {
  middleware: string;
  registry: string;
}> = {
  // Ethereum Mainnet
  1: {
    middleware: '', // TODO: Add after mainnet deployment
    registry: '',
  },
  // Sepolia Testnet
  11155111: {
    middleware: '', // TODO: Add after testnet deployment
    registry: '',
  },
  // Local development (Hardhat)
  31337: {
    middleware: '', // Set dynamically for local dev
    registry: '',
  },
} as const;

// ─── Infrastructure URLs ───

/** VDF Worker service URL (mainnet) */
export const VDF_WORKER_URL = 'https://vdf.sackmoney.io';

/** Guardian API URL (mainnet) */
export const GUARDIAN_API_URL = 'https://guardians.sackmoney.io';

/** VDF Worker service URL (testnet) */
export const VDF_WORKER_URL_TESTNET = 'https://vdf-testnet.sackmoney.io';

/** Guardian API URL (testnet) */
export const GUARDIAN_API_URL_TESTNET = 'https://guardians-testnet.sackmoney.io';

// ─── LI.FI Integration ───

/** LI.FI API base URL */
export const LIFI_API_URL = 'https://li.quest/v1';

/** Sack Money integrator ID for LI.FI */
export const LIFI_INTEGRATOR_ID = 'sackmoney';

/** Native token placeholder address (same across all chains) */
export const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000';

/** LI.FI Diamond contract addresses per chain */
export const LIFI_DIAMOND: Record<number, string> = {
  1: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',      // Ethereum
  10: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',     // Optimism
  56: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',     // BSC
  137: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',    // Polygon
  42161: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',  // Arbitrum
  43114: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',  // Avalanche
  8453: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',   // Base
} as const;

// ─── Guardian System ───

/** Total number of guardians in the network */
export const GUARDIAN_COUNT = 10;

/** Required approvals for transaction execution (7/10) */
export const GUARDIAN_THRESHOLD = 7;

/** Rejections needed to block a transaction (>3) */
export const REJECTION_THRESHOLD = 4;

// ─── VDF Configuration ───

/** Default polling interval for VDF status (ms) */
export const VDF_POLL_INTERVAL = 2000;

/** Default VDF computation timeout (ms) - 10 minutes */
export const VDF_TIMEOUT = 600000;

/**
 * VDF iteration tiers based on transaction amount.
 * Higher amounts require more iterations (longer delay).
 */
export const VDF_ITERATION_TIERS = [
  { threshold: BigInt('1000000000000000000000'), iterations: 1000000 },  // > 1000 ETH: ~5 min
  { threshold: BigInt('100000000000000000000'),  iterations: 500000 },   // > 100 ETH: ~2.5 min
  { threshold: BigInt('10000000000000000000'),   iterations: 100000 },   // > 10 ETH: ~30 sec
  { threshold: BigInt('1000000000000000000'),    iterations: 10000 },    // > 1 ETH: ~5 sec
  { threshold: BigInt('0'),                      iterations: 0 },        // < 1 ETH: no delay
] as const;

// ─── ZK Voting Configuration ───

/** Default polling interval for vote status (ms) */
export const ZK_POLL_INTERVAL = 3000;

/** Default voting timeout (ms) - 5 minutes */
export const ZK_TIMEOUT = 300000;

// ─── Amount Thresholds ───

/**
 * Risk thresholds for transaction amounts.
 * Used to determine security requirements.
 */
export const AMOUNT_THRESHOLDS = {
  LOW: BigInt('1000000000000000000'),         // 1 ETH - no VDF, fast voting
  MEDIUM: BigInt('10000000000000000000'),     // 10 ETH - short VDF
  HIGH: BigInt('100000000000000000000'),      // 100 ETH - medium VDF
  CRITICAL: BigInt('1000000000000000000000'), // 1000 ETH - long VDF + extra scrutiny
} as const;

// ─── Vote Values (aligned with GuardianVote.circom) ───

/**
 * Vote values as defined in the ZK circuit.
 * REJECT=0, APPROVE=1, ABSTAIN=2
 */
export const VOTE_VALUES = {
  REJECT: 0,
  APPROVE: 1,
  ABSTAIN: 2,
} as const;
