/**
 * sdk/core/types.ts
 * 
 * Shared types between SDK and Guardian Node.
 * This is the single source of truth for cross-module type definitions.
 * 
 * IMPORTANT: Keep this aligned with:
 *   - zk/scripts/zkVoteModule.ts
 *   - zk/circuits/GuardianVote.circom
 */

// ─── Vote Types (aligned with GuardianVote.circom) ───

/**
 * Vote values as defined in the circuit.
 * REJECT=0, APPROVE=1, ABSTAIN=2
 */
export const VOTE_VALUES = {
  REJECT: 0,
  APPROVE: 1,
  ABSTAIN: 2,
} as const;

export type VoteDecision = keyof typeof VOTE_VALUES;
export type VoteValue = typeof VOTE_VALUES[VoteDecision];

// ─── Guardian Constants ───

export const GUARDIAN_COUNT = 10;
export const GUARDIAN_THRESHOLD = 7;  // 7/10 required for approval
export const REJECTION_THRESHOLD = 4; // >3 rejections = rejected

// ─── Proof Types (aligned with snarkjs/Groth16) ───

/**
 * Groth16 proof structure for on-chain verification.
 * Note: pB has swapped coordinates for BN254 curve.
 */
export interface Groth16Proof {
  pA: [string, string];
  pB: [[string, string], [string, string]];
  pC: [string, string];
}

/**
 * ZK proof result from guardian voting.
 */
export interface ZKProofResult {
  proof: Groth16Proof;
  vote: VoteValue;
}

// ─── Commitment Types ───

/**
 * Commitment hash for commit-reveal scheme.
 * commitment = Poseidon(guardianId, vote, nonce, proposalId)
 */
export interface VoteCommitment {
  commitment: string;  // bytes32 hex
  nonce: string;       // Store locally for reveal
}

// ─── Proposal Types ───

export interface ProposalData {
  proposalId: string;   // bytes32
  target: string;       // Target contract
  value: bigint;        // ETH value
  data: string;         // Calldata
  chainId: number;
  createdAt: number;    // Unix timestamp
  expiresAt: number;    // Unix timestamp
}

// ─── On-chain State Types ───

export interface ProposalState {
  commitCount: number;   // 0-10
  revealCount: number;   // 0-10
  approveCount: number;  // 0-10
  rejectCount: number;   // 0-10
  abstainCount: number;  // 0-10
  isFinalized: boolean;
}

// ─── Helper Functions ───

/**
 * Check if proposal is approved based on vote counts.
 */
export function isProposalApproved(state: ProposalState): boolean {
  return state.approveCount >= GUARDIAN_THRESHOLD;
}

/**
 * Check if proposal is rejected based on vote counts.
 */
export function isProposalRejected(state: ProposalState): boolean {
  return state.rejectCount > (GUARDIAN_COUNT - GUARDIAN_THRESHOLD);
}

/**
 * Get current voting phase.
 */
export function getVotingPhase(
  state: ProposalState, 
  expiresAt: number,
): 'commit' | 'reveal' | 'complete' | 'expired' {
  if (state.isFinalized) return 'complete';
  if (Date.now() > expiresAt) return 'expired';
  if (state.commitCount >= GUARDIAN_COUNT) return 'reveal';
  return 'commit';
}
