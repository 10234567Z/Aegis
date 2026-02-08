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
    middleware: '0x8A4364c08147b1Ec0025e7B1e848BF675f9Dc7b9',
    registry: '0x702e8307Bc9c8EC7489C6f9e5562EdA44bB9fB7d',
  },
  // Local development (Hardhat)
  31337: {
    middleware: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707', // Set dynamically for local dev
    registry: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
  },
} as const;

// ─── Infrastructure URLs ───
// No hardcoded service URLs — callers must provide their own via config.
// For local dev: VDF=http://localhost:3000, Guardian=http://localhost:3001, Agent=http://localhost:5000

// ─── LI.FI Integration ───

/** LI.FI API base URL */
export const LIFI_API_URL = 'https://li.quest/v1';

/** Sack Money integrator ID for LI.FI */
export const LIFI_INTEGRATOR_ID = 'Aegis';

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

// ─── VDF Configuration (ML Bot Trigger Only) ───

/** Default polling interval for VDF status (ms) */
export const VDF_POLL_INTERVAL = 2000;

/** Default VDF computation timeout (ms) - 35 minutes */
export const VDF_TIMEOUT = 2100000;

/**
 * VDF delay in seconds when ML bot flags transaction.
 * Fixed 30 minute delay for all flagged transactions.
 */
export const VDF_DELAY_SECONDS = 1800;

/**
 * VDF iterations when ML bot flags transaction.
 * 30 min * 166,000 squarings/sec = 300,000,000 iterations
 * Calibrated for modern hardware. Aligned with lib/vdf constants.
 */
export const VDF_ITERATIONS = 300_000_000;

// ─── ZK Voting Configuration ───

/** Default polling interval for vote status (ms) */
export const ZK_POLL_INTERVAL = 3000;

/** Default voting timeout (ms) - 5 minutes */
export const ZK_TIMEOUT = 300000;

// ─── ML Bot Configuration ───

/**
 * ML bot score threshold for flagging transactions.
 * Score >= 50 = flagged for VDF delay.
 * Aligned with Agent's ML_FLAG_THRESHOLD.
 */
export const ML_BOT_THRESHOLD = 50;

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
