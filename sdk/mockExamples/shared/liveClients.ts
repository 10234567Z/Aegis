/**
 * Live Mode API Client Wrappers
 *
 * Wraps real SDK clients and service APIs with demo-friendly interfaces.
 * Each function calls real HTTP endpoints and returns structured results
 * that match the mock script output patterns.
 */

import { ethers } from 'ethers';
import { LiveConfig } from './liveMode';
import {
  printSubStep,
  printSuccess,
  printFailure,
  printInfo,
  printWarning,
  printKeyValue,
  formatAddress,
  formatBytes32,
  delay,
} from './utils';

// ─── Types ───

export interface LiveMLAnalysis {
  score: number;
  flagged: boolean;
  verdict: string;
  proposalId?: string;
}

export interface LiveVotingResult {
  proposalId: string;
  votes: {
    approve: number;
    reject: number;
    abstain: number;
  };
  passed: boolean;
  rejected: boolean;
  frostSignature?: {
    signature: string;
    message: string;
    publicKey: string;
  };
}

export interface LiveVDFProof {
  output: string;
  proof: string;
  iterations: number;
}

export interface LiveExecutionResult {
  txHash: string;
  success: boolean;
}

// ─── ML Agent Analysis ───

/**
 * Call the real ML Agent API to analyze a transaction.
 * Endpoint: POST <agentApiUrl>/review
 */
export async function liveMLAnalysis(
  config: LiveConfig,
  tx: {
    txHash: string;
    sender: string;
    target: string;
    value: bigint;
    data: string;
    chainId: number;
    amount: bigint;
  },
): Promise<LiveMLAnalysis> {
  printSubStep('Calling ML Agent API (POST /review)...');
  await delay(200);

  const response = await fetch(`${config.agentApiUrl}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      guardianApiUrl: config.guardianApiUrl,
      proposal: {
        txHash: tx.txHash,
        sender: tx.sender,
        senderENS: null,
        target: tx.target,
        value: tx.value.toString(),
        data: tx.data,
        chainId: tx.chainId,
        amount: tx.amount.toString(),
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ML Agent API failed (${response.status}): ${errorText}`);
  }

  const result = (await response.json()) as {
    mlAnalysis?: { score?: number; flagged?: boolean; verdict?: string };
    proposalId?: string;
  };

  printInfo(`Agent API response received`);

  return {
    score: result.mlAnalysis?.score ?? 0,
    flagged: result.mlAnalysis?.flagged ?? false,
    verdict: result.mlAnalysis?.verdict ?? 'unknown',
    proposalId: result.proposalId,
  };
}

// ─── Guardian Voting ───

/**
 * Submit a proposal to the Guardian Mock and poll until voting completes.
 * Endpoint: POST <guardianApiUrl>/proposals/submit
 *           GET  <guardianApiUrl>/proposals/:id/status
 */
export async function liveGuardianVoting(
  config: LiveConfig,
  proposal: {
    txHash: string;
    sender: string;
    target: string;
    value: bigint;
    data: string;
    chainId: number;
    amount: bigint;
    mlScore: number;
    mlFlagged: boolean;
  },
  forceOutcome?: 'approve' | 'reject' | 'auto',
): Promise<LiveVotingResult> {
  printSubStep('Submitting proposal to Guardian Network (POST /proposals/submit)...');
  await delay(200);

  // Submit proposal
  const submitResponse = await fetch(`${config.guardianApiUrl}/proposals/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      txHash: proposal.txHash,
      sender: proposal.sender,
      target: proposal.target,
      value: proposal.value.toString(),
      data: proposal.data,
      chainId: proposal.chainId,
      amount: proposal.amount.toString(),
      mlScore: proposal.mlScore,
      mlFlagged: proposal.mlFlagged,
      forceOutcome: forceOutcome || 'auto',
    }),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    throw new Error(`Guardian submit failed (${submitResponse.status}): ${errorText}`);
  }

  const { proposalId } = (await submitResponse.json()) as { proposalId: string };
  printSuccess(`Proposal submitted: ${formatBytes32(proposalId)}`);

  // Poll for result
  printSubStep('Polling guardian voting status...');
  const startTime = Date.now();
  const TIMEOUT = 30000; // 30 seconds
  const POLL_INTERVAL = 1000; // 1 second

  while (true) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

    const statusResponse = await fetch(
      `${config.guardianApiUrl}/proposals/${proposalId}/status`,
    );

    if (!statusResponse.ok) {
      throw new Error(`Failed to get proposal status: ${statusResponse.statusText}`);
    }

    const status = (await statusResponse.json()) as {
      isApproved: boolean;
      isRejected: boolean;
      phase: string;
      votes: { approve: number; reject: number; abstain: number };
      frostSignature?: { R?: string; z?: string; signature?: string; message?: string; publicKey?: string };
    };

    if (status.isApproved || status.isRejected || status.phase === 'expired') {
      printSubStep(`Voting complete — phase: ${status.phase}`);
      printKeyValue('  Approve', String(status.votes.approve));
      printKeyValue('  Reject', String(status.votes.reject));
      printKeyValue('  Abstain', String(status.votes.abstain));

      // Build FROST signature from response if approved
      let frostSignature: LiveVotingResult['frostSignature'] | undefined;
      if (status.isApproved && status.frostSignature) {
        frostSignature = {
          signature: status.frostSignature.R || status.frostSignature.signature || '0x',
          message: status.frostSignature.z || status.frostSignature.message || '0x',
          publicKey: status.frostSignature.publicKey || '0x',
        };
      }

      return {
        proposalId,
        votes: {
          approve: status.votes.approve,
          reject: status.votes.reject,
          abstain: status.votes.abstain,
        },
        passed: status.isApproved,
        rejected: status.isRejected,
        frostSignature,
      };
    }

    if (Date.now() - startTime > TIMEOUT) {
      throw new Error('Guardian voting timed out');
    }

    // Print progress dot
    printSubStep(`  Waiting... (${status.votes.approve}A/${status.votes.reject}R so far)`);
  }
}

// ─── VDF Computation ───

/**
 * Request VDF computation from the VDF Worker and poll until complete.
 * Endpoint: POST <vdfWorkerUrl>/vdf/request
 *           GET  <vdfWorkerUrl>/vdf/status/:jobId
 *           POST <vdfWorkerUrl>/vdf/bypass/:jobId
 */
export async function liveVDFComputation(
  config: LiveConfig,
  txHash: string,
  chainId: number,
  sender: string,
): Promise<{ proof: LiveVDFProof; jobId: string }> {
  printSubStep('Requesting VDF computation (POST /vdf/request)...');
  await delay(200);

  const response = await fetch(`${config.vdfWorkerUrl}/vdf/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      txHash,
      chainId,
      sender,
      iterations: 300_000_000,
      mlBotFlagged: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`VDF request failed (${response.status}): ${errorText}`);
  }

  const { jobId } = (await response.json()) as { jobId: string };
  printSuccess(`VDF job created: ${jobId}`);

  return {
    proof: { output: '0x', proof: '0x', iterations: 0 }, // Will be filled if we wait
    jobId,
  };
}

/**
 * Bypass an active VDF job (used when guardians approve before VDF completes).
 */
export async function liveVDFBypass(
  config: LiveConfig,
  jobId: string,
): Promise<void> {
  printSubStep(`Bypassing VDF job (POST /vdf/bypass/${jobId})...`);

  const response = await fetch(`${config.vdfWorkerUrl}/vdf/bypass/${jobId}`, {
    method: 'POST',
  });

  if (response.ok) {
    printSuccess('VDF bypassed via guardian approval');
  } else {
    printWarning('VDF bypass request failed (may already be complete)');
  }
}

/**
 * Get current VDF job status.
 */
export async function liveVDFStatus(
  config: LiveConfig,
  jobId: string,
): Promise<{ status: string; progress: number }> {
  const response = await fetch(`${config.vdfWorkerUrl}/vdf/status/${jobId}`);

  if (!response.ok) {
    return { status: 'unknown', progress: 0 };
  }

  return (await response.json()) as { status: string; progress: number };
}

// ─── On-Chain Execution ───

/**
 * Execute a transaction through the SecurityMiddleware contract.
 * This calls the real on-chain executeSecurely() function.
 */
export async function liveExecution(
  config: LiveConfig,
  params: {
    target: string;
    data: string;
    value: bigint;
    vdfProof: LiveVDFProof;
    frostSignature: {
      signature: string;
      message: string;
      publicKey: string;
    };
  },
): Promise<LiveExecutionResult> {
  printSubStep('Submitting to SecurityMiddleware contract...');
  await delay(200);

  const SECURITY_MIDDLEWARE_ABI = [
    'function executeSecurely(address target, bytes calldata data, uint256 value, bytes calldata vdfProof, bytes calldata frostSignature) external payable returns (bytes memory)',
  ];

  const contract = new ethers.Contract(
    config.middlewareAddress,
    SECURITY_MIDDLEWARE_ABI,
    config.signer,
  );

  // Encode VDF proof
  const vdfBytes = ethers.AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'bytes', 'uint256'],
    [params.vdfProof.output || '0x' + '0'.repeat(64), params.vdfProof.proof || '0x', params.vdfProof.iterations],
  );

  // Encode FROST signature
  const frostBytes = ethers.AbiCoder.defaultAbiCoder().encode(
    ['bytes', 'bytes32', 'bytes'],
    [
      params.frostSignature.signature || '0x',
      params.frostSignature.message || '0x' + '0'.repeat(64),
      params.frostSignature.publicKey || '0x',
    ],
  );

  try {
    const tx = await contract.executeSecurely(
      params.target,
      params.data,
      params.value,
      vdfBytes,
      frostBytes,
      { value: params.value },
    );

    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      success: true,
    };
  } catch (error: any) {
    // On-chain execution may revert — this is expected for demo purposes
    // since the mock contracts may not have full verification logic
    printWarning(`On-chain execution reverted: ${error.reason || error.message}`);
    printInfo('This is expected — contract verification requires full setup');

    // Return a simulated success for demo flow
    const fallbackHash = '0x' + Buffer.from(Array(32).fill(0).map(() =>
      Math.floor(Math.random() * 256))).toString('hex');

    return {
      txHash: fallbackHash,
      success: false,
    };
  }
}

// ─── Zero Proof Helper ───

/**
 * Create a zero VDF proof (for non-flagged transactions or VDF bypass).
 */
export function createLiveZeroProof(): LiveVDFProof {
  return {
    output: '0x' + '0'.repeat(64),
    proof: '0x',
    iterations: 0,
  };
}
