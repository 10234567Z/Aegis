/**
 * Mock Guardian Network Server
 * 
 * Simulates a protocol's Guardian Network for testing.
 * Uses real FROST signatures from lib/frost.
 * 
 * Routes:
 *   POST /proposals/submit  - Submit a proposal for voting
 *   GET  /proposals/:id     - Get proposal status
 *   GET  /health            - Health check
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import {
  initializeGuardianNetwork,
  createVotingDecisions,
  simulateFullVotingFlow,
  MockGuardianNetwork,
} from './mockFrost.js';

// Guardian network constants
const GUARDIAN_COUNT = 10;
const GUARDIAN_THRESHOLD = 7;

const app = express();
app.use(cors());
app.use(express.json());

// In-memory proposal storage
interface Proposal {
  id: string;
  txHash: string;
  sender: string;
  senderENS: string | null;
  target: string;
  value: string;
  data: string;
  chainId: number;
  amount: string;
  mlScore: number;
  mlFlagged: boolean;
  status: 'pending' | 'voting' | 'approved' | 'rejected' | 'expired';
  votes: {
    approve: number;
    reject: number;
    abstain: number;
  };
  frostSignature?: {
    R: string;
    z: string;
  };
  createdAt: number;
}

const proposals: Map<string, Proposal> = new Map();
let guardianNetwork: MockGuardianNetwork | null = null;

// Initialize network on startup
async function initNetwork(): Promise<void> {
  console.log('Initializing Guardian Network with FROST DKG...');
  guardianNetwork = await initializeGuardianNetwork();
  console.log('Guardian Network ready. Group public key:', 
    '0x' + guardianNetwork.groupPublicKey.toString('hex').slice(0, 16) + '...');
}

// Generate proposal ID
function generateProposalId(txHash: string): string {
  const timestamp = Date.now().toString(16);
  const random = Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
  return `0x${txHash.slice(2, 10)}${timestamp}${random}`.padEnd(66, '0');
}

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    guardianCount: GUARDIAN_COUNT,
    threshold: GUARDIAN_THRESHOLD,
    networkInitialized: guardianNetwork !== null,
    activeProposals: proposals.size,
  });
});

// Submit proposal
app.post('/proposals/submit', async (req: Request, res: Response) => {
  try {
    const { txHash, sender, senderENS, target, value, data, chainId, amount, mlScore, mlFlagged } = req.body;

    if (!txHash || !sender) {
      return res.status(400).json({ error: 'Missing required fields: txHash, sender' });
    }

    if (!guardianNetwork) {
      return res.status(503).json({ error: 'Guardian network not initialized' });
    }

    const proposalId = generateProposalId(txHash);

    const proposal: Proposal = {
      id: proposalId,
      txHash,
      sender,
      senderENS: senderENS || null,
      target: target || '',
      value: value || '0',
      data: data || '0x',
      chainId: chainId || 1,
      amount: amount || '0',
      mlScore: mlScore || 0,
      mlFlagged: mlFlagged || false,
      status: 'pending',
      votes: { approve: 0, reject: 0, abstain: 0 },
      createdAt: Date.now(),
    };

    proposals.set(proposalId, proposal);

    // Simulate voting (async, happens in background)
    simulateVoting(proposal);

    const senderLabel = proposal.senderENS ? `${proposal.senderENS} (${sender})` : sender;
    console.log(`[Proposal ${proposalId.slice(0, 10)}...] Submitted by ${senderLabel}. ML Score: ${mlScore}, Flagged: ${mlFlagged}`);

    res.json({
      proposalId,
      status: 'pending',
      message: 'Proposal submitted, voting in progress',
    });
  } catch (error) {
    console.error('Submit error:', error);
    res.status(500).json({ error: String(error) });
  }
});

// Get proposal status
app.get('/proposals/:id', (req: Request, res: Response) => {
  const proposal = proposals.get(req.params.id);

  if (!proposal) {
    return res.status(404).json({ error: 'Proposal not found' });
  }

  res.json({
    proposalId: proposal.id,
    status: proposal.status,
    votes: proposal.votes,
    threshold: GUARDIAN_THRESHOLD,
    frostSignature: proposal.frostSignature,
    mlScore: proposal.mlScore,
    mlFlagged: proposal.mlFlagged,
    senderENS: proposal.senderENS,
  });
});

// Get proposal status (full)
app.get('/proposals/:id/status', (req: Request, res: Response) => {
  const proposal = proposals.get(req.params.id);

  if (!proposal) {
    return res.status(404).json({ error: 'Proposal not found' });
  }

  const phase = proposal.status === 'pending' ? 'commit' :
                proposal.status === 'voting' ? 'reveal' :
                proposal.status === 'approved' || proposal.status === 'rejected' ? 'complete' : 'expired';

  res.json({
    proposalId: proposal.id,
    phase,
    votes: {
      approve: proposal.votes.approve,
      reject: proposal.votes.reject,
      abstain: proposal.votes.abstain,
      pending: GUARDIAN_COUNT - proposal.votes.approve - proposal.votes.reject - proposal.votes.abstain,
    },
    threshold: GUARDIAN_THRESHOLD,
    isApproved: proposal.status === 'approved',
    isRejected: proposal.status === 'rejected',
    frostSignature: proposal.frostSignature ? {
      R: proposal.frostSignature.R,
      z: proposal.frostSignature.z,
    } : undefined,
    senderENS: proposal.senderENS,
    expiresAt: proposal.createdAt + 5 * 60 * 1000, // 5 min expiry
  });
});

// Simulate voting process
async function simulateVoting(proposal: Proposal): Promise<void> {
  if (!guardianNetwork) return;

  // Short delay to simulate voting time
  await new Promise(resolve => setTimeout(resolve, 500));

  proposal.status = 'voting';

  // Determine vote distribution based on ML score
  let approveCount: number;
  let rejectCount: number;

  if (proposal.mlScore >= 70) {
    // High risk: mostly reject
    rejectCount = 8;
    approveCount = 1;
  } else if (proposal.mlScore >= 50) {
    // Medium risk: reject
    rejectCount = 6;
    approveCount = 3;
  } else {
    // Low risk: approve (threshold met)
    approveCount = 8;
    rejectCount = 1;
  }

  const abstainCount = GUARDIAN_COUNT - approveCount - rejectCount;

  // Create voting decisions
  const decisions = createVotingDecisions(approveCount, rejectCount, abstainCount);

  try {
    // Run full voting flow with real FROST
    const result = await simulateFullVotingFlow(
      guardianNetwork,
      proposal.id,
      decisions,
    );

    proposal.votes = {
      approve: result.tally.approve,
      reject: result.tally.reject,
      abstain: result.tally.abstain,
    };

    if (result.passed) {
      proposal.status = 'approved';
      proposal.frostSignature = result.soliditySignature;
      console.log(`[Proposal ${proposal.id.slice(0, 10)}...] APPROVED (${result.tally.approve}/${GUARDIAN_COUNT})`);
    } else if (result.rejected) {
      proposal.status = 'rejected';
      proposal.frostSignature = result.soliditySignature;
      console.log(`[Proposal ${proposal.id.slice(0, 10)}...] REJECTED (${result.tally.reject}/${GUARDIAN_COUNT})`);
    } else {
      // Not enough votes either way
      proposal.status = 'expired';
      console.log(`[Proposal ${proposal.id.slice(0, 10)}...] EXPIRED (no quorum)`);
    }
  } catch (error) {
    console.error(`[Proposal ${proposal.id.slice(0, 10)}...] Voting failed:`, error);
    proposal.status = 'expired';
  }
}

// Start server
const PORT = parseInt(process.env.PORT || '3001', 10);

initNetwork().then(() => {
  app.listen(PORT, () => {
    console.log(`Mock Guardian Network running on http://localhost:${PORT}`);
    console.log(`  POST /proposals/submit  - Submit proposal`);
    console.log(`  GET  /proposals/:id     - Get status`);
    console.log(`  GET  /health            - Health check`);
  });
}).catch(err => {
  console.error('Failed to initialize guardian network:', err);
  process.exit(1);
});
