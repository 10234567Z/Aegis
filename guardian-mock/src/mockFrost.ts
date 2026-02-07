/**
 * Simplified Mock FROST for Guardian Mock Server
 * 
 * This is a simplified mock of the FROST signature scheme
 * for testing purposes. Does NOT use real cryptography.
 */

import crypto from 'crypto';

const GUARDIAN_COUNT = 10;
const GUARDIAN_THRESHOLD = 7;

// Types
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

export interface MockGuardianNetwork {
  guardians: Array<{ id: number; name: string }>;
  groupPublicKey: Buffer;
}

export interface VotingResult {
  tally: VoteTally;
  passed: boolean;
  rejected: boolean;
  soliditySignature?: { R: string; z: string };
}

const GUARDIAN_NAMES = [
  'alice.eth', 'bob.eth', 'charlie.eth', 'diana.eth', 'eve.eth',
  'frank.eth', 'grace.eth', 'henry.eth', 'iris.eth', 'jack.eth',
];

let cachedNetwork: MockGuardianNetwork | null = null;

/**
 * Initialize mock guardian network
 */
export async function initializeGuardianNetwork(): Promise<MockGuardianNetwork> {
  if (cachedNetwork) return cachedNetwork;

  // Generate a mock group public key
  const groupPublicKey = crypto.randomBytes(32);

  const guardians = GUARDIAN_NAMES.map((name, id) => ({ id, name }));

  cachedNetwork = { guardians, groupPublicKey };
  return cachedNetwork;
}

/**
 * Create vote decisions
 */
export function createVotingDecisions(
  approveCount: number,
  rejectCount: number,
  abstainCount: number = GUARDIAN_COUNT - approveCount - rejectCount
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

/**
 * Tally votes
 */
function tallyVotes(decisions: VoteDecision[]): VoteTally {
  const tally: VoteTally = { approve: 0, reject: 0, abstain: 0, decisions };
  
  for (const { vote } of decisions) {
    if (vote === 'APPROVE') tally.approve++;
    else if (vote === 'REJECT') tally.reject++;
    else tally.abstain++;
  }

  return tally;
}

/**
 * Generate mock FROST signature
 */
function generateMockSignature(proposalId: string): { R: string; z: string } {
  // Generate deterministic but unique mock signature based on proposal
  const hash = crypto.createHash('sha256').update(proposalId).digest();
  const R = '0x' + hash.toString('hex');
  const z = '0x' + crypto.createHash('sha256').update(hash).digest().toString('hex');
  return { R, z };
}

/**
 * Simulate full voting flow
 */
export async function simulateFullVotingFlow(
  network: MockGuardianNetwork,
  proposalId: string,
  decisions: VoteDecision[]
): Promise<VotingResult> {
  const tally = tallyVotes(decisions);
  
  const passed = tally.approve >= GUARDIAN_THRESHOLD;
  const rejected = tally.reject >= (GUARDIAN_COUNT - GUARDIAN_THRESHOLD + 1);

  let soliditySignature: { R: string; z: string } | undefined;

  if (passed || rejected) {
    // Simulate 100ms FROST signing delay
    await new Promise(resolve => setTimeout(resolve, 100));
    soliditySignature = generateMockSignature(proposalId);
  }

  return { tally, passed, rejected, soliditySignature };
}
