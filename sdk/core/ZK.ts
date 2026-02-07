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
  ZK_POLL_INTERVAL,
  ZK_TIMEOUT,
  GUARDIAN_COUNT,
  GUARDIAN_THRESHOLD,
} from './constants';
import { 
  VOTE_VALUES, 
  VoteDecision,
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

const DEFAULT_CONFIG: Omit<ZKVoteConfig, 'guardianApiUrl'> & { guardianApiUrl: string } = {
  guardianApiUrl: '',  // Must be provided by caller
  pollInterval: ZK_POLL_INTERVAL,
  timeout: ZK_TIMEOUT,
};

// ABI aligned with ZKVoteVerifier.sol
const ZK_VOTE_VERIFIER_ABI = [
  "function submitCommitment(bytes32 proposalId, bytes32 commitment, uint8 guardianSlot)",
  "function revealVote(bytes32 proposalId, uint8 guardianSlot, uint8 vote, uint[2] pA, uint[2][2] pB, uint[2] pC)",
  "function getProposalState(bytes32 proposalId) view returns (uint8 commitCount, uint8 revealCount, uint8 approveCount, uint8 rejectCount, uint8 abstainCount, bool isFinalized)",
  "function proposalExists(bytes32 proposalId) view returns (bool)",
  "function getCommitDeadline(bytes32 proposalId) view returns (uint256)",
  "function isCommitted(bytes32 proposalId, uint8 guardianSlot) view returns (bool)",
];

// GuardianRegistry ABI for proposal details
const GUARDIAN_REGISTRY_ABI = [
  "function getProposalDetails(bytes32 proposalId) view returns (uint8 action, address targetAddress, string description, bool executed)",
  "function isBlacklisted(address addr) view returns (bool)",
  "function getSecurityState() view returns (bool paused, uint8 threshold, uint256 proposalCount)",
  "function isPaused() view returns (bool)",
  "function currentThreshold() view returns (uint8)",
];

// ─── ZK Vote Query Client ───

export class ZKVoteClient {
  private config: ZKVoteConfig;
  private provider: ethers.Provider | null = null;
  private verifierAddress: string | null = null;
  private registryAddress: string | null = null;

  constructor(config: Partial<ZKVoteConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Connect to on-chain contracts for direct queries.
   */
  connectOnChain(
    provider: ethers.Provider,
    verifierAddress: string,
    registryAddress: string,
  ): void {
    this.provider = provider;
    this.verifierAddress = verifierAddress;
    this.registryAddress = registryAddress;
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

    const data = await response.json() as { proposalId: string };
    return data.proposalId;
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

    return response.json() as Promise<VoteStatus>;
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

    // Get commit deadline from verifier (used as expiry time for voting)
    const commitDeadline = await verifier.getCommitDeadline(proposalId);
    const expiresAtMs = Number(commitDeadline) * 1000 + (10 * 60 * 1000); // Commit deadline + 10min for reveal

    // Build state object for helper functions
    const state = {
      commitCount: Number(commitCount),
      revealCount: Number(revealCount),
      approveCount: Number(approveCount),
      rejectCount: Number(rejectCount),
      abstainCount: Number(abstainCount),
      isFinalized,
    };

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
      expiresAt: expiresAtMs,
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

    return response.json() as Promise<FrostSignature>;
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

    return response.json() as Promise<GuardianInfo[]>;
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
      return verifier.proposalExists(proposalId);
    }

    const response = await fetch(`${this.config.guardianApiUrl}/proposals/${proposalId}`);
    return response.ok;
  }

  /**
   * Get security state from Guardian Registry.
   */
  async getSecurityState(): Promise<{
    isPaused: boolean;
    currentThreshold: number;
    proposalCount: number;
  }> {
    if (!this.provider || !this.registryAddress) {
      throw new Error('On-chain connection required. Call connectOnChain() first.');
    }

    const registry = new ethers.Contract(
      this.registryAddress,
      GUARDIAN_REGISTRY_ABI,
      this.provider,
    );

    const [isPaused, threshold, proposalCount] = await registry.getSecurityState();

    return {
      isPaused,
      currentThreshold: Number(threshold),
      proposalCount: Number(proposalCount),
    };
  }

  /**
   * Check if an address is blacklisted.
   */
  async isAddressBlacklisted(address: string): Promise<boolean> {
    if (!this.provider || !this.registryAddress) {
      throw new Error('On-chain connection required. Call connectOnChain() first.');
    }

    const registry = new ethers.Contract(
      this.registryAddress,
      GUARDIAN_REGISTRY_ABI,
      this.provider,
    );

    return registry.isBlacklisted(address);
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