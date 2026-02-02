/**
 * sdk/core/ZK.ts
 * 
 * ZK Proof Query Module for SDK.
 * 
 * This module allows dApps to query the status of Guardian ZK voting
 * for their transactions. Guardians vote privately using ZK proofs,
 * and this module polls the results.
 * 
 * Note: Proof GENERATION happens in guardian-node (zkVoteModule.ts).
 *       This SDK module only QUERIES the voting status.
 * 
 * Flow:
 *   1. Transaction is flagged by ML bot → Guardians alerted
 *   2. Guardians vote (APPROVE/REJECT/ABSTAIN) via ZK proofs
 *   3. SDK polls this module to check voting status
 *   4. When 7/10 approve, FROST signature is generated
 *   5. SDK retrieves the FROST signature for on-chain submission
 */

import { ethers } from 'ethers';
import { FrostSignature } from './contract';
import { 
  VOTE_VALUES, 
  VoteDecision, 
  GUARDIAN_COUNT, 
  GUARDIAN_THRESHOLD,
  isProposalApproved,
  isProposalRejected,
  getVotingPhase,
} from './types';

// Re-export for convenience
export { VOTE_VALUES, VoteDecision } from './types';

// ─── Types ───

export interface ZKVoteConfig {
  guardianApiUrl: string;         // Guardian network API endpoint
  pollInterval: number;           // Polling interval in ms
  timeout: number;                // Max wait time in ms
}

export interface TransactionProposal {
  proposalId: string;             // bytes32 identifier
  txHash: string;                 // Original tx hash
  target: string;                 // Target contract
  value: bigint;                  // ETH value
  data: string;                   // Calldata
  chainId: number;                // Chain ID
  sender: string;                 // Transaction sender
  amount: bigint;                 // Parsed amount (for display)
  timestamp: number;              // When proposal was created
}

export interface VoteStatus {
  proposalId: string;
  phase: 'commit' | 'reveal' | 'complete' | 'expired';
  votes: {
    approve: number;
    reject: number;
    abstain: number;
    pending: number;
  };
  threshold: number;              // Required approvals (default: 7)
  isApproved: boolean;            // true if approve >= threshold
  isRejected: boolean;            // true if reject > (10 - threshold)
  frostSignature?: FrostSignature; // Available when approved
  expiresAt: number;              // Timestamp when voting expires
}

export interface GuardianInfo {
  id: number;                     // 0-9
  ensName: string;                // e.g., "guardian-1.sack.eth"
  publicKey: string;              // Poseidon-derived public key
  isActive: boolean;
  reputation: number;             // 0-100 score
}

// ─── Constants ───

const DEFAULT_CONFIG: ZKVoteConfig = {
  guardianApiUrl: 'http://localhost:3002',
  pollInterval: 3000,
  timeout: 300000, // 5 minutes
};

// ABI aligned with zkVoteModule.ts (guardian-node)
const ZK_VOTE_VERIFIER_ABI = [
  "function submitCommitment(bytes32 proposalId, bytes32 commitment, uint8 guardianSlot)",
  "function revealVote(bytes32 proposalId, uint8 guardianSlot, uint8 vote, uint[2] pA, uint[2][2] pB, uint[2] pC)",
  "function getProposalState(bytes32 proposalId) view returns (uint8 commitCount, uint8 revealCount, uint8 approveCount, uint8 rejectCount, uint8 abstainCount, bool isFinalized)",
  "function getProposal(bytes32 proposalId) view returns (address target, uint256 value, bytes data, uint256 createdAt, uint256 expiresAt)",
  "function proposals(bytes32) view returns (bool exists)",
];

// ─── ZK Vote Query Client ───

export class ZKVoteClient {
  private config: ZKVoteConfig;
  private provider: ethers.Provider | null = null;
  private verifierAddress: string | null = null;

  constructor(config: Partial<ZKVoteConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Connect to on-chain verifier contract for direct queries.
   */
  connectOnChain(provider: ethers.Provider, verifierAddress: string): void {
    this.provider = provider;
    this.verifierAddress = verifierAddress;
  }

  /**
   * Submit a transaction for Guardian review.
   * Returns the proposalId for tracking.
   */
  async submitForReview(proposal: Omit<TransactionProposal, 'proposalId' | 'timestamp'>): Promise<string> {
    const response = await fetch(`${this.config.guardianApiUrl}/proposals/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        txHash: proposal.txHash,
        target: proposal.target,
        value: proposal.value.toString(),
        data: proposal.data,
        chainId: proposal.chainId,
        sender: proposal.sender,
        amount: proposal.amount.toString(),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to submit proposal: ${error}`);
    }

    const { proposalId } = await response.json();
    return proposalId;
  }

  /**
   * Get current voting status for a proposal.
   */
  async getVoteStatus(proposalId: string): Promise<VoteStatus> {
    // Try on-chain first if connected
    if (this.provider && this.verifierAddress) {
      return this.getVoteStatusOnChain(proposalId);
    }

    // Fall back to Guardian API
    const response = await fetch(`${this.config.guardianApiUrl}/proposals/${proposalId}/status`);

    if (!response.ok) {
      throw new Error(`Failed to get vote status: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get voting status directly from on-chain contract.
   */
  private async getVoteStatusOnChain(proposalId: string): Promise<VoteStatus> {
    const verifier = new ethers.Contract(
      this.verifierAddress!,
      ZK_VOTE_VERIFIER_ABI,
      this.provider!,
    );

    const [commitCount, revealCount, approveCount, rejectCount, abstainCount, isFinalized] =
      await verifier.getProposalState(proposalId);

    const [, , , createdAt, expiresAt] = await verifier.getProposal(proposalId);

    // Build state object for helper functions
    const state = {
      commitCount: Number(commitCount),
      revealCount: Number(revealCount),
      approveCount: Number(approveCount),
      rejectCount: Number(rejectCount),
      abstainCount: Number(abstainCount),
      isFinalized,
    };

    const expiresAtMs = Number(expiresAt) * 1000;
    const approved = isProposalApproved(state);
    const rejected = isProposalRejected(state);
    const phase = getVotingPhase(state, expiresAtMs);

    // If approved, fetch FROST signature from Guardian API
    let frostSignature: FrostSignature | undefined;
    if (approved) {
      frostSignature = await this.getFrostSignature(proposalId);
    }

    return {
      proposalId,
      phase,
      votes: {
        approve: state.approveCount,
        reject: state.rejectCount,
        abstain: state.abstainCount,
        pending: GUARDIAN_COUNT - state.revealCount,
      },
      threshold: GUARDIAN_THRESHOLD,
      isApproved: approved,
      isRejected: rejected,
      frostSignature,
      expiresAt: Number(expiresAt) * 1000,
    };
  }

  /**
   * Get FROST signature for an approved proposal.
   */
  async getFrostSignature(proposalId: string): Promise<FrostSignature> {
    const response = await fetch(`${this.config.guardianApiUrl}/proposals/${proposalId}/signature`);

    if (!response.ok) {
      throw new Error(`FROST signature not available: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Wait for voting to complete (approved or rejected).
   */
  async waitForVoteResult(
    proposalId: string,
    onUpdate?: (status: VoteStatus) => void,
  ): Promise<VoteStatus> {
    const startTime = Date.now();

    while (true) {
      const status = await this.getVoteStatus(proposalId);

      if (onUpdate) {
        onUpdate(status);
      }

      if (status.isApproved || status.isRejected || status.phase === 'expired') {
        return status;
      }

      if (Date.now() - startTime > this.config.timeout) {
        throw new Error('Voting timed out');
      }

      await this.sleep(this.config.pollInterval);
    }
  }

  /**
   * Get list of active Guardians.
   */
  async getGuardians(): Promise<GuardianInfo[]> {
    const response = await fetch(`${this.config.guardianApiUrl}/guardians`);

    if (!response.ok) {
      throw new Error(`Failed to get guardians: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Check if a proposal exists.
   */
  async proposalExists(proposalId: string): Promise<boolean> {
    if (this.provider && this.verifierAddress) {
      const verifier = new ethers.Contract(
        this.verifierAddress,
        ZK_VOTE_VERIFIER_ABI,
        this.provider,
      );
      return verifier.proposals(proposalId);
    }

    const response = await fetch(`${this.config.guardianApiUrl}/proposals/${proposalId}`);
    return response.ok;
  }

  // ─── Helpers ───

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ─── Singleton Export ───

let defaultClient: ZKVoteClient | null = null;

export function getZKVoteClient(config?: Partial<ZKVoteConfig>): ZKVoteClient {
  if (!defaultClient || config) {
    defaultClient = new ZKVoteClient(config);
  }
  return defaultClient;
}