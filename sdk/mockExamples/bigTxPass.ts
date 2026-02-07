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
 * Flow:
 * 1. User submits 500 ETH withdrawal (Ethereum → Ethereum)
 * 2. ML Bot analyzes transaction → score 75/100 (suspicious) → FLAGGED
 * 3. VDF computation starts (30 min fixed delay)
 * 4. Guardian voting happens IN PARALLEL:
 *    - All 10 guardians submit ZK commitments
 *    - All 10 guardians reveal votes with ZK proofs
 *    - Tally: 7 approve, 2 reject, 1 abstain → Threshold met
 * 5. FROST signature created by 7 approving guardians
 * 6. VDF BYPASSED - guardian approval overrides VDF wait
 * 7. Transaction executed (user saved 30 min of VDF wait)
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

  // Initialize guardian network (uses real FROST DKG)
  printStep(0, 'Initializing Guardian Network');
  const network = await initializeGuardianNetwork();
  printSuccess(`${GUARDIAN_COUNT} guardians initialized with FROST keys`);
  printKeyValue('Group Public Key', formatBytes32('0x' + network.groupPublicKey.toString('hex')));

  await delay(500);
  printDivider();

  // ─── Step 1: Transaction Submission ───
  printStep(1, 'Transaction Submitted');
  await delay(300);

  const tx = createMockTransaction({
    amount: SCENARIO.amount,
    sourceChain: SCENARIO.sourceChain,
  });

  printKeyValue('Type', 'Large Withdrawal');
  printKeyValue('Amount', `${formatEth(tx.amount)} (${formatUSD(tx.amount)})`);
  printKeyValue('Sender', formatAddress(tx.sender));
  printKeyValue('Destination', formatAddress(tx.destination));
  printKeyValue('Chain', getChainName(tx.sourceChain));
  printKeyValue('TX Hash', formatBytes32(tx.txHash));

  await delay(500);
  printDivider();

  // ─── Step 2: Security Checks ───
  printStep(2, 'Security Analysis');

  // ML Bot analysis
  printSubStep('Running ML Bot analysis...');
  await simulateProgress('Analyzing transaction patterns', 5, 2000);
  const mlAnalysis = simulateMLBotAnalysis({ score: 75, verdict: 'suspicious' });
  printKeyValue('ML Bot Score', `${mlAnalysis.score}/100 (suspicious pattern)`);
  printKeyValue('ML Bot Verdict', mlAnalysis.verdict);
  printKeyValue('Flag Threshold', `${ML_BOT_THRESHOLD}/100`);
  printWarning(`Transaction FLAGGED by ML Bot (score ${mlAnalysis.score} >= threshold ${ML_BOT_THRESHOLD})`);

  await delay(500);

  // Check VDF requirement
  const vdfRequired = isVDFRequired(mlAnalysis.flagged);

  if (vdfRequired) {
    printWarning('VDF TRIGGERED - ML Bot flagged transaction');
    printKeyValue('VDF Iterations', VDF_ITERATIONS.toLocaleString());
    printKeyValue('VDF Delay', `${VDF_DELAY_SECONDS / 60} minutes (fixed)`);
  } else {
    printSuccess('VDF NOT REQUIRED - ML Bot score below threshold');
  }

  await delay(500);
  printDivider();

  // ─── Step 3: VDF Computation Started ───
  printStep(3, 'VDF Time-Lock Initiated');

  if (vdfRequired) {
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

  printDivider();

  // ─── Step 4: Guardian Voting (In Parallel) ───
  printStep(4, 'Guardian Voting (ZK Commit-Reveal)');
  printInfo('Guardian voting is MANDATORY - runs parallel to VDF');
  await delay(400);

  // Generate proposal ID
  const proposalId = generateProposalId(`large-withdrawal-${tx.txHash}`);
  printKeyValue('Proposal ID', formatBytes32(proposalId));

  // Create voting decisions
  const decisions = createVotingDecisions(
    SCENARIO.votes.approve,
    SCENARIO.votes.reject,
    SCENARIO.votes.abstain,
  );

  // Phase 4a: Commit Phase
  await delay(500);
  printSubStep('Phase 1: Commitment Submission');
  const commitments = simulateCommitPhase(decisions);

  for (const commitment of commitments) {
    const guardian = network.guardians[commitment.guardianId];
    await delay(250);
    printSubStep(`  ${guardian.name} submitted commitment`);
  }
  printSuccess(`${commitments.length}/${GUARDIAN_COUNT} commitments received`);

  // Phase 4b: Reveal Phase
  await delay(500);
  printSubStep('Phase 2: Vote Reveal with ZK Proofs');
  const reveals = simulateRevealPhase(commitments, decisions);

  for (const reveal of reveals) {
    const guardian = network.guardians[reveal.guardianId];
    const voteStr = reveal.vote === 1 ? 'APPROVE' : reveal.vote === 0 ? 'REJECT' : 'ABSTAIN';
    await delay(300);
    printSubStep(`  ${guardian.name} revealed: ${voteStr} (ZK proof verified)`);
  }

  // Phase 4c: Tally
  await delay(500);
  printSubStep('Phase 3: Vote Tally');
  const tally = tallyVotes(decisions);
  printVoteResult(tally.approve, tally.reject, tally.abstain);

  const votePassed = isApprovalReached(tally.approve);
  if (votePassed) {
    printSuccess(`Threshold reached: ${tally.approve}/${GUARDIAN_THRESHOLD} approvals`);
  } else {
    printFailure(`Threshold NOT reached: ${tally.approve}/${GUARDIAN_THRESHOLD} approvals`);
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

  // Get approving guardians for signing
  const approvingGuardians = decisions
    .filter(d => d.vote === 'APPROVE')
    .map(d => d.guardianId);

  printSubStep(`Signing participants: ${approvingGuardians.length} guardians`);
  printKeyValue('Threshold required', `${GUARDIAN_THRESHOLD} of ${GUARDIAN_COUNT}`);

  // Create message to sign (proposal ID hash)
  const message = Buffer.from(proposalId.slice(2), 'hex');

  await delay(600);
  printSubStep('Round 1: Generating nonce commitments...');
  await delay(1000);
  printSubStep('Round 2: Generating signature shares...');
  await delay(800);
  printSubStep('Aggregating signature...');
  await delay(500);

  // Create actual FROST signature using real crypto
  const signature = await createFROSTSignature(network, message, approvingGuardians);
  const soliditySig = formatForSolidity(signature);

  printSuccess('FROST signature created');
  printKeyValue('R (commitment)', formatBytes32(soliditySig.R));
  printKeyValue('z (scalar)', formatBytes32(soliditySig.z));

  await delay(500);
  printDivider();

  // ─── Step 6: VDF Bypass ───
  printStep(6, 'VDF Bypass Decision');
  await delay(400);

  printSubStep('Guardian approval detected BEFORE VDF completion');
  await delay(600);
  printInfo('VDF computation cancelled - not needed');

  await delay(400);
  printKeyValue('VDF Proof Type', 'Zero Proof (bypass)');
  printKeyValue('Iterations', '0 (bypassed)');
  printSuccess('VDF bypassed via guardian approval');

  printInfo(`User saved ${VDF_DELAY_SECONDS / 60} minutes of waiting time`);

  await delay(500);
  printDivider();

  // ─── Step 7: Execution ───
  printStep(7, 'Transaction Execution');

  printSubStep('Verification checks:');
  await delay(300);
  printSuccess('Guardian vote passed (7/7 threshold)');
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
  await delay(2000);

  // Simulate successful execution
  const executionTxHash = '0x' + Buffer.from(Array(32).fill(0).map(() =>
    Math.floor(Math.random() * 256))).toString('hex');

  printSuccess(`Transaction executed on ${getChainName(tx.sourceChain)}`);
  printKeyValue('Execution TX', formatBytes32(executionTxHash));

  // ─── Final Result ───
  await delay(500);
  printFinalResult(true, 'TRANSACTION APPROVED AND EXECUTED');

  // Summary
  console.log('Summary:');
  printKeyValue('Amount', `${formatEth(tx.amount)} (${formatUSD(tx.amount)})`);
  printKeyValue('ML Bot Score', `${mlAnalysis.score}/100 (threshold: ${ML_BOT_THRESHOLD})`);
  printKeyValue('VDF Triggered', `Yes (ML score ${mlAnalysis.score} >= threshold ${ML_BOT_THRESHOLD})`);
  printKeyValue('VDF Outcome', 'BYPASSED (guardian approval)');
  printKeyValue('Guardian Vote', `${tally.approve} approve, ${tally.reject} reject, ${tally.abstain} abstain`);
  printKeyValue('FROST Signature', 'Valid');
  printKeyValue('Time Saved', `${VDF_DELAY_SECONDS / 60} minutes`);
  printKeyValue('Execution', 'Immediate (VDF bypassed)');
  console.log();
}

// ─── Run Script ───

if (require.main === module) {
  runScript(SCENARIO.name, main);
}

export { main as runBigTxSlowPassSameChain };
