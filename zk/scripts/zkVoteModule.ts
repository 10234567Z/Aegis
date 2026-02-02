/**
 * guardian-node/src/zk/index.ts
 * 
 * ZK Voting Module — runs inside guardian-node.
 * 
 * Responsibilities:
 *   1. Generate commitment hash when guardian decides to vote
 *   2. Generate Groth16 ZK proof during reveal phase
 *   3. Submit commitment and proof to ZKVoteVerifier contract
 * 
 * Integration points:
 *   - Called by dashboard vote handler when guardian clicks APPROVE/REJECT/ABSTAIN
 *   - Reads compiled circuit artifacts from /artifacts/
 *   - Submits transactions via ethers provider
 */

import { groth16 } from 'snarkjs';
import { ethers } from 'ethers';
import { poseidon } from 'circomlib';
import path from 'path';

// ─── Types ───

export type VoteDecision = 'APPROVE' | 'REJECT' | 'ABSTAIN';

const VOTE_VALUES: Record<VoteDecision, number> = {
  REJECT:   0,
  APPROVE:  1,
  ABSTAIN:  2,
};

export interface VoteInput {
  proposalId: string;       // bytes32 hex string
  decision:   VoteDecision;
  guardianId: number;       // 0–9
  guardianSecret: string;   // guardian's secret key (from secure storage)
}

export interface CommitmentResult {
  commitment: string;       // bytes32 hex — submit this on-chain
  nonce: string;            // store locally, needed for reveal
}

export interface ProofResult {
  proof: {
    pA: [string, string];
    pB: [[string, string], [string, string]];
    pC: [string, string];
  };
  vote: number;             // revealed vote value
}

// ─── Config ───

const ARTIFACTS_DIR = path.resolve(__dirname, '../../artifacts');
const WASM_PATH     = path.join(ARTIFACTS_DIR, 'GuardianVote.wasm');
const ZKEY_PATH     = path.join(ARTIFACTS_DIR, 'GuardianVote_final.zkey');

// ─── Commitment Generation ───

/**
 * Generates the commitment hash for a vote.
 * commitment = Poseidon(guardianId, vote, nonce, proposalId)
 * 
 * This is submitted on-chain during the commit phase.
 * The nonce must be stored locally — it's needed during reveal.
 */
export function generateCommitment(input: VoteInput): CommitmentResult {
  const vote  = VOTE_VALUES[input.decision];
  const nonce = generateRandomNonce();
  const proposalIdBigInt = BigInt(input.proposalId);

  const commitment = poseidon([
    BigInt(input.guardianId),
    BigInt(vote),
    BigInt(nonce),
    proposalIdBigInt,
  ]);

  return {
    commitment: '0x' + commitment.toString(16).padStart(64, '0'),
    nonce,
  };
}

// ─── Proof Generation ───

/**
 * Generates the Groth16 ZK proof for the reveal phase.
 * 
 * This proves:
 *   - The voter is a valid guardian (ID 0–9, owns the key)
 *   - Their vote matches the commitment on-chain
 *   - Vote is valid (0, 1, or 2)
 * 
 * Without revealing which guardian they are.
 * 
 * Takes 2–5 seconds depending on hardware.
 */
export async function generateProof(
  input: VoteInput,
  nonce: string,                  // from generateCommitment()
  guardianPubKeys: string[10],    // all 10 public keys
): Promise<ProofResult> {
  const vote = VOTE_VALUES[input.decision];

  // ─── Circuit witness (private + public inputs) ───
  const circuitInput = {
    // Private inputs (hidden)
    guardianId:     input.guardianId,
    guardianSecret: input.guardianSecret,
    vote:           vote,
    nonce:          nonce,

    // Public inputs (verifiable)
    proposalId:     BigInt(input.proposalId),
    commitment:     poseidon([
      BigInt(input.guardianId),
      BigInt(vote),
      BigInt(nonce),
      BigInt(input.proposalId),
    ]),
    guardianPubKeys: guardianPubKeys.map(k => BigInt(k)),
  };

  // ─── Generate proof using snarkjs ───
  const { proof, publicSignals } = await groth16.prove(
    WASM_PATH,
    ZKEY_PATH,
    circuitInput,
  );

  return {
    proof: {
      pA: [proof.A[0], proof.A[1]],
      pB: [[proof.B[0][1], proof.B[0][0]], [proof.B[1][1], proof.B[1][0]]],  // BN254 swap
      pC: [proof.C[0], proof.C[1]],
    },
    vote,
  };
}

// ─── On-Chain Submission ───

/**
 * Submits the commitment to ZKVoteVerifier during commit phase.
 */
export async function submitCommitment(
  provider: ethers.Provider,
  signer: ethers.Signer,
  verifierAddress: string,
  proposalId: string,
  commitment: string,
  guardianSlot: number,
): Promise<ethers.TransactionReceipt> {
  const verifier = new ethers.Contract(
    verifierAddress,
    ZK_VOTE_VERIFIER_ABI,
    signer,
  );

  const tx = await verifier.submitCommitment(
    proposalId,
    commitment,
    guardianSlot,
  );

  return tx.wait();
}

/**
 * Submits the ZK proof + revealed vote to ZKVoteVerifier during reveal phase.
 */
export async function submitReveal(
  provider: ethers.Provider,
  signer: ethers.Signer,
  verifierAddress: string,
  proposalId: string,
  guardianSlot: number,
  proof: ProofResult,
): Promise<ethers.TransactionReceipt> {
  const verifier = new ethers.Contract(
    verifierAddress,
    ZK_VOTE_VERIFIER_ABI,
    signer,
  );

  const tx = await verifier.revealVote(
    proposalId,
    guardianSlot,
    proof.vote,
    proof.proof.pA,
    proof.proof.pB,
    proof.proof.pC,
  );

  return tx.wait();
}

// ─── Full Vote Flow (called by dashboard handler) ───

/**
 * Orchestrates the entire voting flow for a guardian.
 * 
 * Usage:
 *   const zkModule = new ZKVoteModule(provider, signer, config);
 *   await zkModule.vote({ proposalId, decision: 'APPROVE', guardianId: 3, guardianSecret: '...' });
 * 
 * Handles:
 *   1. Generates commitment
 *   2. Submits commitment on-chain
 *   3. Waits for all guardians to commit (polls contract)
 *   4. Generates ZK proof
 *   5. Submits reveal on-chain
 */
export class ZKVoteModule {
  private provider: ethers.Provider;
  private signer: ethers.Signer;
  private verifierAddress: string;
  private guardianPubKeys: string[];

  constructor(
    provider: ethers.Provider,
    signer: ethers.Signer,
    verifierAddress: string,
    guardianPubKeys: string[],
  ) {
    this.provider = provider;
    this.signer = signer;
    this.verifierAddress = verifierAddress;
    this.guardianPubKeys = guardianPubKeys;
  }

  async vote(input: VoteInput): Promise<void> {
    // Step 1: Generate commitment
    const { commitment, nonce } = generateCommitment(input);
    console.log('[ZK] Commitment generated');

    // Step 2: Submit commitment on-chain
    await submitCommitment(
      this.provider,
      this.signer,
      this.verifierAddress,
      input.proposalId,
      commitment,
      input.guardianId,
    );
    console.log('[ZK] Commitment submitted on-chain');

    // Step 3: Wait for all guardians to commit
    await this.waitForAllCommits(input.proposalId);
    console.log('[ZK] All commitments in — generating proof');

    // Step 4: Generate ZK proof
    const proof = await generateProof(
      input,
      nonce,
      this.guardianPubKeys as any,
    );
    console.log('[ZK] Proof generated');

    // Step 5: Submit reveal
    await submitReveal(
      this.provider,
      this.signer,
      this.verifierAddress,
      input.proposalId,
      input.guardianId,
      proof,
    );
    console.log('[ZK] Vote revealed on-chain');
  }

  /**
   * Polls contract until all 10 guardians have committed.
   * In production this would also use event subscriptions.
   */
  private async waitForAllCommits(proposalId: string): Promise<void> {
    const verifier = new ethers.Contract(
      this.verifierAddress,
      ZK_VOTE_VERIFIER_ABI,
      this.provider,
    );

    while (true) {
      const [commitCount] = await verifier.getProposalState(proposalId);
      if (commitCount >= 10) break;
      await new Promise(r => setTimeout(r, 2000)); // poll every 2s
    }
  }
}

// ─── Helpers ───

function generateRandomNonce(): string {
  return BigInt('0x' + Buffer.alloc(32).fill(0).toString('hex').replace(
    /./g, () => Math.floor(Math.random() * 16).toString(16)
  )).toString();
}

// Minimal ABI — only the functions we call
const ZK_VOTE_VERIFIER_ABI = [
  "function submitCommitment(bytes32 proposalId, bytes32 commitment, uint8 guardianSlot)",
  "function revealVote(bytes32 proposalId, uint8 guardianSlot, uint8 vote, uint[2] pA, uint[2][2] pB, uint[2] pC)",
  "function getProposalState(bytes32 proposalId) view returns (uint8, uint8, uint8, uint8, uint8, bool)",
];
