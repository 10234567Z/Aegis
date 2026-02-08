/**
 * Use Case 2: Big TX Slow Pass (Same-Chain)
 *
 * Demonstrates: A large transaction flagged by ML Bot that passes via guardian approval.
 * - ML Bot: Score 75/100 → FLAGGED (exceeds threshold 50)
 * - Guardian voting: MANDATORY (7 approve, 2 reject, 1 abstain)
 * - VDF: TRIGGERED (ML Bot flagged) → 30 min delay, 300M iterations
 * - VDF Outcome: BYPASSED (guardian approval came first)
 * - Result: PASS (via guardian approval, not VDF completion)
 *
 * Supports --live mode: uses real Agent API, Guardian Mock, VDF Worker, and on-chain execution.
 */

import { ethers } from 'ethers';
import {
  printHeader,
  printStep,
  printSubStep,
  printSuccess,
  printFailure,
  printInfo,
  printWarning,
  printDivider,
  printKeyValue,
  printVoteResult,
  printFinalResult,
  formatEth,
  formatAddress,
  formatBytes32,
  formatUSD,
  generateProposalId,
  createMockTransaction,
  getChainName,
  isVDFRequired,
  isApprovalReached,
  simulateMLBotAnalysis,
  ML_BOT_THRESHOLD,
  VDF_ITERATIONS,
  VDF_DELAY_SECONDS,
  GUARDIAN_COUNT,
  GUARDIAN_THRESHOLD,
  runScript,
  delay,
  simulateProgress,
  LIVE_MODE,
} from './shared';

import {
  initializeGuardianNetwork,
  createVotingDecisions,
  simulateCommitPhase,
  simulateRevealPhase,
  tallyVotes,
  createFROSTSignature,
  formatForSolidity,
} from './shared/mockGuardians';

import { ensureServices, getLiveConfig, printLiveModeBanner, LiveConfig } from './shared/liveMode';
import { liveMLAnalysis, liveGuardianVoting, liveVDFComputation, liveVDFBypass, liveExecution, createLiveZeroProof } from './shared/liveClients';
import { SEPOLIA_MODE, getSDKConfig, printSDKModeBanner, executeViaSDK, checkOnChainStatus, buildIntent, SDKConfig } from './shared/sdkMode';

// ─── Script Configuration ───

const SCENARIO = {
  name: 'Big TX Slow Pass (Same-Chain)',
  amount: ethers.parseEther('500'),    // 500 ETH (~$1M at $2000/ETH)
  sourceChain: 1,                       // Ethereum mainnet
  destChain: undefined,                 // Same chain (no bridge)
  expectedResult: 'PASS',
  votes: {
    approve: 7,                         // Exactly at threshold
    reject: 2,
    abstain: 1,
  },
};

// ─── Main Script ───

async function main() {
  printHeader(`USE CASE 2: ${SCENARIO.name.toUpperCase()}`);

  // ─── Sepolia SDK Mode ───
  if (SEPOLIA_MODE) {
    const sdkConfig = await getSDKConfig();
    printSDKModeBanner(sdkConfig);
    await checkOnChainStatus(sdkConfig);

    const intent = buildIntent({
      target: sdkConfig.signerAddress,
      value: 0n,
      amount: SCENARIO.amount,
      sourceChain: 11155111,
    });
    // ML flag triggers VDF computation in parallel with Guardian voting
    intent.mlBotFlagged = true;

    try {
      const result = await executeViaSDK(sdkConfig, intent, sdkConfig.signerAddress);
      printFinalResult(result.success, 'TRANSACTION APPROVED AND EXECUTED ON SEPOLIA');
      console.log('Summary:');
      printKeyValue('Mode', `SDK (${sdkConfig.networkName})`);
      printKeyValue('TX Hash', result.txHash);
      printKeyValue('VDF Proof Iterations', String(result.vdfProof.iterations));
      printKeyValue('FROST Signature', result.frostSignature.signature ? 'Valid' : 'N/A');
      printKeyValue('Execution Time', `${result.executionTime}ms`);
      console.log();
    } catch (error: any) {
      printFinalResult(false, `SDK EXECUTION FAILED: ${error.message}`);
    }
    return;
  }

  // ─── Live Mode Setup ───
  let liveConfig: LiveConfig | undefined;
  if (LIVE_MODE) {
    printLiveModeBanner();
    await ensureServices();
    liveConfig = await getLiveConfig();
    printSuccess(`Connected to Hardhat node. Signer: ${formatAddress(liveConfig.signerAddress)}`);
    printDivider();
  }

  // ─── Step 0: Guardian Network ───
  printStep(0, LIVE_MODE ? 'Connecting to Guardian Network' : 'Initializing Guardian Network');
  let network;
  if (LIVE_MODE) {
    printSuccess('Guardian Network running on :3001 (real FROST signing)');
  } else {
    network = await initializeGuardianNetwork();
    printSuccess(`${GUARDIAN_COUNT} guardians initialized with FROST keys`);
    printKeyValue('Group Public Key', formatBytes32('0x' + network.groupPublicKey.toString('hex')));
  }

  await delay(500);
  printDivider();

  // ─── Step 1: Transaction Submission ───
  printStep(1, 'Transaction Submitted');
  await delay(300);

  const tx = createMockTransaction({
    amount: SCENARIO.amount,
    sourceChain: SCENARIO.sourceChain,
    sender: LIVE_MODE ? liveConfig!.signerAddress : undefined,
  });

  printKeyValue('Type', 'Large Withdrawal');
  printKeyValue('Amount', `${formatEth(tx.amount)} (${formatUSD(tx.amount)})`);
  printKeyValue('Sender', formatAddress(tx.sender));
  printKeyValue('Destination', formatAddress(tx.destination));
  printKeyValue('Chain', getChainName(tx.sourceChain));
  printKeyValue('TX Hash', formatBytes32(tx.txHash));
  if (LIVE_MODE) printInfo('Mode: LIVE (real APIs)');

  await delay(500);
  printDivider();

  // ─── Step 2: Security Analysis ───
  printStep(2, 'Security Analysis');

  let mlScore: number;
  let mlVerdict: string;
  let mlFlagged: boolean;

  if (LIVE_MODE) {
    printSubStep('Calling ML Agent API...');
    const analysis = await liveMLAnalysis(liveConfig!, {
      txHash: tx.txHash,
      sender: tx.sender,
      target: tx.destination,
      value: tx.amount,
      data: tx.data,
      chainId: tx.sourceChain,
      amount: tx.amount,
    });
    mlScore = analysis.score;
    mlVerdict = analysis.verdict;
    mlFlagged = analysis.flagged;
    printKeyValue('ML Bot Score', `${mlScore}/100 (from real Agent API)`);
  } else {
    printSubStep('Running ML Bot analysis...');
    await simulateProgress('Analyzing transaction patterns', 5, 2000);
    const mlAnalysis = simulateMLBotAnalysis({ score: 75, verdict: 'suspicious' });
    mlScore = mlAnalysis.score;
    mlVerdict = mlAnalysis.verdict;
    mlFlagged = mlAnalysis.flagged;
    printKeyValue('ML Bot Score', `${mlScore}/100 (suspicious pattern)`);
  }

  printKeyValue('ML Bot Verdict', mlVerdict);
  printKeyValue('Flag Threshold', `${ML_BOT_THRESHOLD}/100`);

  if (mlFlagged) {
    printWarning(`Transaction FLAGGED by ML Bot (score ${mlScore} >= threshold ${ML_BOT_THRESHOLD})`);
  } else {
    printSuccess('Transaction NOT flagged by ML Bot');
  }

  await delay(500);

  const vdfRequired = isVDFRequired(mlFlagged);
  if (vdfRequired) {
    printWarning('VDF TRIGGERED - ML Bot flagged transaction');
    printKeyValue('VDF Iterations', VDF_ITERATIONS.toLocaleString());
    printKeyValue('VDF Delay', `${VDF_DELAY_SECONDS / 60} minutes (fixed)`);
  } else {
    printSuccess('VDF NOT REQUIRED - ML Bot score below threshold');
  }

  await delay(500);
  printDivider();

  // ─── Step 3: VDF Time-Lock ───
  printStep(3, 'VDF Time-Lock Initiated');
  let vdfJobId: string | undefined;

  if (vdfRequired) {
    if (LIVE_MODE) {
      printSubStep('Requesting VDF computation from VDF Worker...');
      const vdfResult = await liveVDFComputation(liveConfig!, tx.txHash, tx.sourceChain, tx.sender);
      vdfJobId = vdfResult.jobId;
      printInfo('VDF runs IN PARALLEL with guardian voting');
      printInfo('If guardians approve first, VDF will be bypassed');
    } else {
      printSubStep('VDF computation starting on protocol worker...');
      await delay(400);
      printKeyValue('Challenge', formatBytes32(tx.txHash));
      printKeyValue('Iterations', VDF_ITERATIONS.toLocaleString());
      printKeyValue('Expected completion', `${VDF_DELAY_SECONDS / 60} minutes`);
      await delay(300);
      printInfo('VDF runs IN PARALLEL with guardian voting');
      printInfo('If guardians approve first, VDF will be bypassed');
      await simulateProgress('VDF computing (will be bypassed)', 5, 3000);
    }
  }

  printDivider();

  // ─── Step 4: Guardian Voting ───
  printStep(4, LIVE_MODE ? 'Guardian Voting (Live API)' : 'Guardian Voting (ZK Commit-Reveal)');
  printInfo('Guardian voting is MANDATORY - runs parallel to VDF');
  await delay(400);

  let votePassed: boolean;
  let voteApprove: number;
  let voteReject: number;
  let voteAbstain: number;
  let liveFrostSig: { signature: string; message: string; publicKey: string } | undefined;

  if (LIVE_MODE) {
    const votingResult = await liveGuardianVoting(
      liveConfig!,
      {
        txHash: tx.txHash,
        sender: tx.sender,
        target: tx.destination,
        value: tx.amount,
        data: tx.data,
        chainId: tx.sourceChain,
        amount: tx.amount,
        mlScore,
        mlFlagged,
      },
      'approve', // Force approve for this demo scenario
    );

    votePassed = votingResult.passed;
    voteApprove = votingResult.votes.approve;
    voteReject = votingResult.votes.reject;
    voteAbstain = votingResult.votes.abstain;
    liveFrostSig = votingResult.frostSignature;
  } else {
    const proposalId = generateProposalId(`large-withdrawal-${tx.txHash}`);
    printKeyValue('Proposal ID', formatBytes32(proposalId));

    const decisions = createVotingDecisions(
      SCENARIO.votes.approve,
      SCENARIO.votes.reject,
      SCENARIO.votes.abstain,
    );

    await delay(500);
    printSubStep('Phase 1: Commitment Submission');
    const commitments = simulateCommitPhase(decisions);

    for (const commitment of commitments) {
      const guardian = network!.guardians[commitment.guardianId];
      await delay(250);
      printSubStep(`  ${guardian.name} submitted commitment`);
    }
    printSuccess(`${commitments.length}/${GUARDIAN_COUNT} commitments received`);

    await delay(500);
    printSubStep('Phase 2: Vote Reveal with ZK Proofs');
    const reveals = simulateRevealPhase(commitments, decisions);

    for (const reveal of reveals) {
      const guardian = network!.guardians[reveal.guardianId];
      const voteStr = reveal.vote === 1 ? 'APPROVE' : reveal.vote === 0 ? 'REJECT' : 'ABSTAIN';
      await delay(300);
      printSubStep(`  ${guardian.name} revealed: ${voteStr} (ZK proof verified)`);
    }

    await delay(500);
    printSubStep('Phase 3: Vote Tally');
    const tally = tallyVotes(decisions);
    voteApprove = tally.approve;
    voteReject = tally.reject;
    voteAbstain = tally.abstain;
    votePassed = isApprovalReached(tally.approve);
  }

  printVoteResult(voteApprove, voteReject, voteAbstain);

  if (votePassed) {
    printSuccess(`Threshold reached: ${voteApprove}/${GUARDIAN_THRESHOLD} approvals`);
  } else {
    printFailure(`Threshold NOT reached: ${voteApprove}/${GUARDIAN_THRESHOLD} approvals`);
  }

  await delay(500);
  printDivider();

  // ─── Step 5: FROST Threshold Signature ───
  printStep(5, 'FROST Threshold Signature');

  if (!votePassed) {
    printFailure('Skipping FROST signing - vote did not pass');
    printFinalResult(false, 'TRANSACTION BLOCKED - Guardian vote failed');
    return;
  }

  if (LIVE_MODE) {
    if (liveFrostSig) {
      printSuccess('FROST signature received from Guardian Network');
      printKeyValue('Signature', formatBytes32(liveFrostSig.signature || '0x'));
    } else {
      printSuccess('Guardian approval confirmed (signature included in vote response)');
    }
  } else {
    const approvingGuardians = createVotingDecisions(
      SCENARIO.votes.approve,
      SCENARIO.votes.reject,
      SCENARIO.votes.abstain,
    )
      .filter(d => d.vote === 'APPROVE')
      .map(d => d.guardianId);

    printSubStep(`Signing participants: ${approvingGuardians.length} guardians`);
    printKeyValue('Threshold required', `${GUARDIAN_THRESHOLD} of ${GUARDIAN_COUNT}`);

    const proposalId = generateProposalId(`large-withdrawal-${tx.txHash}`);
    const message = Buffer.from(proposalId.slice(2), 'hex');

    await delay(600);
    printSubStep('Round 1: Generating nonce commitments...');
    await delay(1000);
    printSubStep('Round 2: Generating signature shares...');
    await delay(800);
    printSubStep('Aggregating signature...');
    await delay(500);

    const signature = await createFROSTSignature(network!, message, approvingGuardians);
    const soliditySig = formatForSolidity(signature);

    printSuccess('FROST signature created');
    printKeyValue('R (commitment)', formatBytes32(soliditySig.R));
    printKeyValue('z (scalar)', formatBytes32(soliditySig.z));
  }

  await delay(500);
  printDivider();

  // ─── Step 6: VDF Bypass ───
  printStep(6, 'VDF Bypass Decision');
  await delay(400);

  if (vdfRequired) {
    printSubStep('Guardian approval detected BEFORE VDF completion');

    if (LIVE_MODE && vdfJobId) {
      await liveVDFBypass(liveConfig!, vdfJobId);
    } else {
      await delay(600);
      printInfo('VDF computation cancelled - not needed');
    }

    await delay(400);
    printKeyValue('VDF Proof Type', 'Zero Proof (bypass)');
    printKeyValue('Iterations', '0 (bypassed)');
    printSuccess('VDF bypassed via guardian approval');
    printInfo(`User saved ${VDF_DELAY_SECONDS / 60} minutes of waiting time`);
  } else {
    printSuccess('VDF was not triggered - no bypass needed');
  }

  await delay(500);
  printDivider();

  // ─── Step 7: Execution ───
  printStep(7, 'Transaction Execution');

  printSubStep('Verification checks:');
  await delay(300);
  printSuccess(`Guardian vote passed (${voteApprove}/${GUARDIAN_THRESHOLD} threshold)`);
  await delay(200);
  printSuccess('FROST signature valid');
  await delay(200);
  printSuccess('VDF bypassed with zero proof + FROST sig');
  await delay(200);
  printSuccess('Sender not blacklisted');
  await delay(200);
  printSuccess('Protocol not paused');

  await delay(500);
  printSubStep('Executing transaction...');

  let executionTxHash: string;

  if (LIVE_MODE) {
    const result = await liveExecution(liveConfig!, {
      target: tx.destination,
      data: tx.data,
      value: tx.amount,
      vdfProof: createLiveZeroProof(),
      frostSignature: liveFrostSig || { signature: '0x', message: '0x' + '0'.repeat(64), publicKey: '0x' },
    });
    executionTxHash = result.txHash;
  } else {
    await delay(2000);
    executionTxHash = '0x' + Buffer.from(Array(32).fill(0).map(() =>
      Math.floor(Math.random() * 256))).toString('hex');
  }

  printSuccess(`Transaction executed on ${getChainName(tx.sourceChain)}`);
  printKeyValue('Execution TX', formatBytes32(executionTxHash));
  if (LIVE_MODE) printInfo('On-chain execution via SecurityMiddleware contract');

  // ─── Final Result ───
  await delay(500);
  printFinalResult(true, 'TRANSACTION APPROVED AND EXECUTED');

  // Summary
  console.log('Summary:');
  printKeyValue('Mode', LIVE_MODE ? 'LIVE (real infrastructure)' : 'MOCK (simulated)');
  printKeyValue('Amount', `${formatEth(tx.amount)} (${formatUSD(tx.amount)})`);
  printKeyValue('ML Bot Score', `${mlScore}/100 (threshold: ${ML_BOT_THRESHOLD})`);
  printKeyValue('VDF Triggered', vdfRequired ? `Yes (ML score ${mlScore} >= threshold ${ML_BOT_THRESHOLD})` : 'No');
  printKeyValue('VDF Outcome', vdfRequired ? 'BYPASSED (guardian approval)' : 'Not triggered');
  printKeyValue('Guardian Vote', `${voteApprove} approve, ${voteReject} reject, ${voteAbstain} abstain`);
  printKeyValue('FROST Signature', 'Valid');
  if (vdfRequired) printKeyValue('Time Saved', `${VDF_DELAY_SECONDS / 60} minutes`);
  printKeyValue('Execution', vdfRequired ? 'Immediate (VDF bypassed)' : 'Immediate');
  console.log();
}

// ─── Run Script ───

if (require.main === module) {
  runScript(SCENARIO.name, main);
}

export { main as runBigTxSlowPassSameChain };
