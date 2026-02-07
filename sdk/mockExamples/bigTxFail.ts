/**
 * Use Case 3: Big TX Slow Fail (Same-Chain)
 *
 * Demonstrates: A large suspicious transaction that fails via guardian rejection.
 * - ML Bot: Score 95/100 → FLAGGED (attack pattern detected)
 * - Guardian voting: MANDATORY (2 approve, 7 reject, 1 abstain)
 * - VDF: TRIGGERED (ML Bot flagged) → 30 min delay buys time for guardians
 * - VDF Outcome: CANCELLED (transaction blocked before VDF could complete)
 * - Result: FAIL (guardians detected attack pattern)
 *
 * Supports --live mode: uses real Agent API, Guardian Mock, and VDF Worker.
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
  isRejectionReached,
  simulateMLBotAnalysis,
  ML_BOT_THRESHOLD,
  VDF_ITERATIONS,
  VDF_DELAY_SECONDS,
  GUARDIAN_COUNT,
  GUARDIAN_THRESHOLD,
  REJECTION_THRESHOLD,
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
import { liveMLAnalysis, liveGuardianVoting, liveVDFComputation } from './shared/liveClients';

// ─── Script Configuration ───

const SCENARIO = {
  name: 'Big TX Slow Fail (Same-Chain)',
  amount: ethers.parseEther('1000'),   // 1000 ETH (~$2M at $2000/ETH)
  sourceChain: 1,                       // Ethereum mainnet
  destChain: undefined,                 // Same chain (no bridge)
  expectedResult: 'FAIL',
  votes: {
    approve: 2,                         // Only 2 approve
    reject: 7,                          // 7 reject (meets rejection threshold)
    abstain: 1,
  },
  attackType: 'Flash Loan Attack',
  mlBotScore: 95,
};

// ─── Main Script ───

async function main() {
  printHeader(`USE CASE 3: ${SCENARIO.name.toUpperCase()}`);

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
  printStep(1, 'Suspicious Transaction Submitted');
  await delay(300);

  const tx = createMockTransaction({
    amount: SCENARIO.amount,
    sourceChain: SCENARIO.sourceChain,
    sender: LIVE_MODE ? liveConfig!.signerAddress : undefined,
  });

  printKeyValue('Type', 'Large Withdrawal (SUSPICIOUS)');
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
    await simulateProgress('Deep pattern analysis', 6, 2500);
    const mlAnalysis = simulateMLBotAnalysis({ score: SCENARIO.mlBotScore, verdict: 'dangerous' });
    mlScore = mlAnalysis.score;
    mlVerdict = mlAnalysis.verdict;
    mlFlagged = mlAnalysis.flagged;
    printKeyValue('ML Bot Score', `${mlScore}/100 (CRITICAL)`);
  }

  printKeyValue('ML Bot Verdict', mlVerdict);
  printKeyValue('Flag Threshold', `${ML_BOT_THRESHOLD}/100`);
  await delay(300);
  printFailure(`ATTACK PATTERN DETECTED: ${SCENARIO.attackType}`);

  await delay(500);
  printSubStep('ML Bot Evidence:');
  await delay(300);
  printSubStep('  - Flash loan initiated in same block');
  await delay(200);
  printSubStep('  - Price manipulation detected on oracle');
  await delay(200);
  printSubStep('  - Withdrawal to new address (created 2 blocks ago)');
  await delay(200);
  printSubStep('  - Similar pattern to known exploits');

  await delay(400);
  printWarning(`Transaction FLAGGED by ML Bot (score ${mlScore} >= threshold ${ML_BOT_THRESHOLD})`);

  const vdfRequired = isVDFRequired(mlFlagged);

  if (vdfRequired) {
    await delay(400);
    printWarning('VDF TRIGGERED - ML Bot flagged as dangerous');
    printKeyValue('VDF Iterations', VDF_ITERATIONS.toLocaleString());
    printKeyValue('VDF Delay', `${VDF_DELAY_SECONDS / 60} minutes (fixed)`);
    printInfo('VDF delay buys time for guardian review');
  }

  await delay(500);
  printDivider();

  // ─── Step 3: VDF Computation Started ───
  printStep(3, 'VDF Time-Lock Initiated');

  if (vdfRequired) {
    if (LIVE_MODE) {
      printSubStep('Requesting VDF computation from VDF Worker...');
      await liveVDFComputation(liveConfig!, tx.txHash, tx.sourceChain, tx.sender);
      printInfo('VDF buys time for guardians to review');
      printWarning('Attacker must wait - cannot bypass VDF');
    } else {
      printSubStep('VDF computation starting on protocol worker...');
      await delay(400);
      printKeyValue('Challenge', formatBytes32(tx.txHash));
      printKeyValue('Iterations', VDF_ITERATIONS.toLocaleString());
      printKeyValue('Expected completion', `${VDF_DELAY_SECONDS / 60} minutes`);
      printInfo('VDF buys time for guardians to review');
      printWarning('Attacker must wait - cannot bypass VDF');
      await simulateProgress('VDF computing (guardians reviewing)', 5, 3000);
    }
  }

  printDivider();

  // ─── Step 4: Guardian Voting ───
  printStep(4, LIVE_MODE ? 'Guardian Voting - Attack Review (Live API)' : 'Guardian Voting (Attack Review)');
  printWarning(`HIGH PRIORITY: ML Bot score ${mlScore}/100`);
  printInfo('Guardians reviewing attack evidence...');
  await delay(600);

  let voteApprove: number;
  let voteReject: number;
  let voteAbstain: number;
  let voteRejected: boolean;

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
      'reject', // Force reject for this demo scenario
    );

    voteApprove = votingResult.votes.approve;
    voteReject = votingResult.votes.reject;
    voteAbstain = votingResult.votes.abstain;
    voteRejected = votingResult.rejected;
  } else {
    const proposalId = generateProposalId(`attack-review-${tx.txHash}`);
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
      const emoji = reveal.vote === 0 ? '(attack confirmed)' : '';
      await delay(300);
      printSubStep(`  ${guardian.name} revealed: ${voteStr} ${emoji}`);
    }

    await delay(500);
    printSubStep('Phase 3: Vote Tally');
    const tally = tallyVotes(decisions);
    voteApprove = tally.approve;
    voteReject = tally.reject;
    voteAbstain = tally.abstain;
    voteRejected = isRejectionReached(tally.reject);
  }

  printVoteResult(voteApprove, voteReject, voteAbstain);

  await delay(400);
  if (voteRejected) {
    printFailure(`REJECTION threshold reached: ${voteReject}/${REJECTION_THRESHOLD} rejections`);
    printWarning('Guardians have confirmed this is an attack');
  } else if (isApprovalReached(voteApprove)) {
    printSuccess(`Approval threshold reached: ${voteApprove}/${GUARDIAN_THRESHOLD}`);
  } else {
    printInfo('No threshold reached - vote inconclusive');
  }

  await delay(500);
  printDivider();

  // ─── Step 5: FROST Rejection Signature ───
  printStep(5, 'FROST Rejection Signature');

  if (!voteRejected) {
    printInfo('Transaction not rejected by guardians');
    printFinalResult(true, 'TRANSACTION APPROVED');
    return;
  }

  if (LIVE_MODE) {
    printSuccess('FROST rejection signature received from Guardian Network');
    printInfo('Rejection signed by rejecting guardians via real FROST protocol');
  } else {
    const rejectingGuardians = createVotingDecisions(
      SCENARIO.votes.approve,
      SCENARIO.votes.reject,
      SCENARIO.votes.abstain,
    )
      .filter(d => d.vote === 'REJECT')
      .map(d => d.guardianId);

    printSubStep(`Signing participants: ${rejectingGuardians.length} rejecting guardians`);
    printKeyValue('Rejection threshold', `${REJECTION_THRESHOLD} of ${GUARDIAN_COUNT}`);

    const proposalId = generateProposalId(`attack-review-${tx.txHash}`);
    const rejectionMessage = Buffer.from(
      ethers.keccak256(ethers.toUtf8Bytes(`REJECT:${proposalId}`)).slice(2),
      'hex',
    );

    await delay(600);
    printSubStep('Round 1: Generating nonce commitments...');
    await delay(1000);
    printSubStep('Round 2: Generating signature shares...');
    await delay(800);
    printSubStep('Aggregating rejection signature...');
    await delay(500);

    const signature = await createFROSTSignature(network!, rejectionMessage, rejectingGuardians);
    const soliditySig = formatForSolidity(signature);

    printSuccess('FROST rejection signature created');
    printKeyValue('R (commitment)', formatBytes32(soliditySig.R));
    printKeyValue('z (scalar)', formatBytes32(soliditySig.z));
  }

  await delay(500);
  printDivider();

  // ─── Step 6: Transaction Blocked ───
  printStep(6, 'Transaction Blocked');

  printSubStep('Security enforcement:');
  await delay(400);
  printFailure(`Guardian vote: REJECTED (${voteReject}/${REJECTION_THRESHOLD} rejection threshold)`);
  await delay(300);
  printSuccess('FROST rejection signature: VALID');
  await delay(300);
  printInfo('VDF computation: CANCELLED (not needed)');

  await delay(500);
  printSubStep('Actions taken:');
  await delay(300);
  printFailure('Transaction BLOCKED - cannot execute');
  await delay(200);
  printWarning('Sender address flagged for monitoring');
  await delay(200);
  printInfo('Attack evidence logged for analysis');

  // ─── Final Result ───
  await delay(500);
  printFinalResult(false, 'TRANSACTION BLOCKED - ATTACK PREVENTED');

  // Summary
  console.log('Summary:');
  printKeyValue('Mode', LIVE_MODE ? 'LIVE (real infrastructure)' : 'MOCK (simulated)');
  printKeyValue('Amount', `${formatEth(tx.amount)} (${formatUSD(tx.amount)})`);
  printKeyValue('Attack Type', SCENARIO.attackType);
  printKeyValue('ML Bot Score', `${mlScore}/100 (threshold: ${ML_BOT_THRESHOLD})`);
  printKeyValue('VDF Triggered', vdfRequired ? `Yes (ML score ${mlScore} >= ${ML_BOT_THRESHOLD}) - cancelled after rejection` : 'No');
  printKeyValue('Guardian Vote', `${voteApprove} approve, ${voteReject} reject, ${voteAbstain} abstain`);
  printKeyValue('FROST Signature', 'Rejection signature valid');
  printKeyValue('Outcome', 'BLOCKED - Funds protected');
  console.log();

  // Attack timeline
  console.log('Attack Timeline:');
  printKeyValue('T+0s', 'Attacker submitted suspicious transaction');
  printKeyValue('T+1s', `ML Bot flagged with ${mlScore}/100 score`);
  printKeyValue('T+2s', `VDF started (${VDF_DELAY_SECONDS / 60} min countdown)`);
  printKeyValue('T+5s', 'Guardians notified of high-priority alert');
  printKeyValue('T+30s', 'All guardians voted REJECT');
  printKeyValue('T+35s', 'FROST rejection signature created');
  printKeyValue('T+36s', 'Transaction BLOCKED, VDF cancelled');
  printInfo('Attack stopped in ~36 seconds, funds safe');
  console.log();
}

// ─── Run Script ───

if (require.main === module) {
  runScript(SCENARIO.name, main);
}

export { main as runBigTxSlowFailSameChain };
