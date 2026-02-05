/**
 * Mock Guardian setup using real FROST DKG.
 *
 * This module provides pre-configured guardians for demo scripts.
 * Uses actual cryptographic key generation from the FROST library.
 */

import {
  performDKG,
  FROSTCoordinator,
  FROSTParticipant,
  verifyFROSTSignature,
  formatSignatureForSolidity,
  DKGOutput,
  GuardianKeyShare,
  FROSTSignature,
  FROST_CONSTANTS,
} from '../../../lib/frost/src/index';

import { GUARDIAN_COUNT, GUARDIAN_THRESHOLD, VOTE_VALUES } from '../../core/constants';
import { generateAddress } from './utils';

// ─── Types ───

export interface GuardianInfo {
  id: number;
  address: string;
  name: string;
  share: GuardianKeyShare;
}

export interface MockGuardianNetwork {
  guardians: GuardianInfo[];
  dkgOutput: DKGOutput;
  groupPublicKey: Buffer;
}

export interface VoteDecision {
  guardianId: number;
  vote: 'APPROVE' | 'REJECT' | 'ABSTAIN';
}

export interface VoteTally {
  approve: number;
  reject: number;
  abstain: number;
  decisions: VoteDecision[];
}

export interface ZKCommitment {
  guardianId: number;
  commitment: string;
  nonce: string;
}

export interface ZKReveal {
  guardianId: number;
  vote: number;
  proof: {
    pA: [string, string];
    pB: [[string, string], [string, string]];
    pC: [string, string];
  };
}

// ─── Guardian Names (for realistic demo) ───

const GUARDIAN_NAMES = [
  'alice.eth',
  'bob.eth',
  'charlie.eth',
  'diana.eth',
  'eve.eth',
  'frank.eth',
  'grace.eth',
  'henry.eth',
  'iris.eth',
  'jack.eth',
];

// ─── Cached DKG Output ───

let cachedNetwork: MockGuardianNetwork | null = null;

/**
 * Initialize the mock guardian network with real FROST DKG.
 * Results are cached for subsequent calls.
 */
export async function initializeGuardianNetwork(): Promise<MockGuardianNetwork> {
  if (cachedNetwork) {
    return cachedNetwork;
  }

  const dkgOutput = await performDKG({
    threshold: GUARDIAN_THRESHOLD,
    totalParticipants: GUARDIAN_COUNT,
  });

  const guardians: GuardianInfo[] = dkgOutput.guardianShares.map((share, index) => ({
    id: index,
    address: generateAddress(),
    name: GUARDIAN_NAMES[index],
    share,
  }));

  cachedNetwork = {
    guardians,
    dkgOutput,
    groupPublicKey: dkgOutput.groupPublicKey,
  };

  return cachedNetwork;
}

/**
 * Clear the cached network (useful for testing fresh setups).
 */
export function clearNetworkCache(): void {
  cachedNetwork = null;
}

// ─── ZK Voting Simulation ───

/**
 * Simulate ZK commitment phase.
 * In real implementation, this would use Poseidon hash.
 */
export function simulateCommitPhase(decisions: VoteDecision[]): ZKCommitment[] {
  return decisions.map(({ guardianId, vote }) => {
    const nonce = '0x' + Buffer.from(Array(32).fill(0).map(() =>
      Math.floor(Math.random() * 256))).toString('hex');

    // Simulated Poseidon hash: H(guardianId, vote, nonce, proposalId)
    const commitment = '0x' + Buffer.from(Array(32).fill(0).map(() =>
      Math.floor(Math.random() * 256))).toString('hex');

    return { guardianId, commitment, nonce };
  });
}

/**
 * Simulate ZK reveal phase with mock proofs.
 * In real implementation, this would generate Groth16 proofs.
 */
export function simulateRevealPhase(
  commitments: ZKCommitment[],
  decisions: VoteDecision[],
): ZKReveal[] {
  return decisions.map(({ guardianId, vote }) => {
    const voteValue = VOTE_VALUES[vote];

    // Mock Groth16 proof structure
    const mockProof = {
      pA: ['0x1234...', '0x5678...'] as [string, string],
      pB: [['0xabcd...', '0xef01...'], ['0x2345...', '0x6789...']] as [[string, string], [string, string]],
      pC: ['0xdead...', '0xbeef...'] as [string, string],
    };

    return { guardianId, vote: voteValue, proof: mockProof };
  });
}

/**
 * Tally votes from decisions.
 */
export function tallyVotes(decisions: VoteDecision[]): VoteTally {
  const tally: VoteTally = {
    approve: 0,
    reject: 0,
    abstain: 0,
    decisions,
  };

  for (const { vote } of decisions) {
    if (vote === 'APPROVE') tally.approve++;
    else if (vote === 'REJECT') tally.reject++;
    else tally.abstain++;
  }

  return tally;
}

/**
 * Create voting decisions for a scenario.
 */
export function createVotingDecisions(
  approveCount: number,
  rejectCount: number,
  abstainCount: number = GUARDIAN_COUNT - approveCount - rejectCount,
): VoteDecision[] {
  const decisions: VoteDecision[] = [];
  let guardianId = 0;

  for (let i = 0; i < approveCount; i++) {
    decisions.push({ guardianId: guardianId++, vote: 'APPROVE' });
  }
  for (let i = 0; i < rejectCount; i++) {
    decisions.push({ guardianId: guardianId++, vote: 'REJECT' });
  }
  for (let i = 0; i < abstainCount; i++) {
    decisions.push({ guardianId: guardianId++, vote: 'ABSTAIN' });
  }

  return decisions;
}

// ─── FROST Signing ───

/**
 * Create a real FROST threshold signature.
 * Uses the actual FROST library with the DKG-generated keys.
 */
export async function createFROSTSignature(
  network: MockGuardianNetwork,
  message: Buffer,
  signingGuardianIds: number[],
): Promise<FROSTSignature> {
  if (signingGuardianIds.length < GUARDIAN_THRESHOLD) {
    throw new Error(`Need at least ${GUARDIAN_THRESHOLD} guardians, got ${signingGuardianIds.length}`);
  }

  // Create coordinator
  const coordinator = new FROSTCoordinator(network.groupPublicKey, GUARDIAN_THRESHOLD);

  // Create participants from selected guardians
  const participants: FROSTParticipant[] = [];
  for (const guardianId of signingGuardianIds) {
    const guardian = network.guardians[guardianId];
    const participant = new FROSTParticipant(
      guardian.share.participantId,
      guardian.share.secretShare,
      guardian.share.publicKey,
      network.groupPublicKey,
    );
    participants.push(participant);
  }

  // Generate unique session ID
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await coordinator.startSession(sessionId, message);

  // Round 1: Collect commitments
  for (const participant of participants) {
    const commitment = await participant.generateCommitment(sessionId);
    await coordinator.submitCommitment(sessionId, commitment.guardianId, commitment);
  }

  // Get commitments for Round 2
  const commitments = await coordinator.getCommitmentList(sessionId);

  // Round 2: Generate signature shares
  for (const participant of participants) {
    const share = await participant.generateSignatureShare(sessionId, message, commitments);
    await coordinator.submitSignatureShare(sessionId, share.guardianId, share);
  }

  // Aggregate signature
  const signature = await coordinator.aggregateSignature(sessionId);

  return signature;
}

/**
 * Verify a FROST signature.
 */
export async function verifySignature(
  signature: FROSTSignature,
  message: Buffer,
): Promise<boolean> {
  return verifyFROSTSignature(signature, message);
}

/**
 * Format FROST signature for Solidity contracts.
 */
export function formatForSolidity(signature: FROSTSignature): { R: string; z: string } {
  return {
    R: '0x' + signature.R.toString('hex'),
    z: '0x' + signature.z.toString('hex'),
  };
}

// ─── Full Voting Flow ───

export interface VotingResult {
  tally: VoteTally;
  passed: boolean;
  rejected: boolean;
  signature?: FROSTSignature;
  soliditySignature?: { R: string; z: string };
}

/**
 * Simulate the full ZK voting + FROST signing flow.
 */
export async function simulateFullVotingFlow(
  network: MockGuardianNetwork,
  proposalId: string,
  decisions: VoteDecision[],
): Promise<VotingResult> {
  // Phase 1: Commit
  const commitments = simulateCommitPhase(decisions);

  // Phase 2: Reveal
  const reveals = simulateRevealPhase(commitments, decisions);

  // Phase 3: Tally
  const tally = tallyVotes(decisions);

  const passed = tally.approve >= GUARDIAN_THRESHOLD;
  const rejected = tally.reject >= (GUARDIAN_COUNT - GUARDIAN_THRESHOLD + 1);

  // Phase 4: FROST signing (only if vote passed or rejected)
  let signature: FROSTSignature | undefined;
  let soliditySignature: { R: string; z: string } | undefined;

  if (passed || rejected) {
    // Get guardian IDs who voted (approve for pass, reject for rejection)
    const signingGuardians = passed
      ? decisions.filter(d => d.vote === 'APPROVE').map(d => d.guardianId)
      : decisions.filter(d => d.vote === 'REJECT').map(d => d.guardianId);

    // Create message from proposal ID
    const message = Buffer.from(proposalId.slice(2), 'hex');

    signature = await createFROSTSignature(network, message, signingGuardians);
    soliditySignature = formatForSolidity(signature);
  }

  return {
    tally,
    passed,
    rejected,
    signature,
    soliditySignature,
  };
}

// ─── Exports ───

export {
  FROST_CONSTANTS,
  FROSTSignature,
};
