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
 * Flow:
 * 1. Attacker submits 1000 ETH withdrawal (Ethereum → Ethereum)
 * 2. ML Bot analyzes → score 95/100 (dangerous) → FLAGGED
 *    - Flash loan detected, price manipulation, suspicious withdrawal
 * 3. VDF computation starts (30 min fixed delay, buys time for guardians)
 * 4. Guardian voting happens IN PARALLEL:
 *    - All 10 guardians submit ZK commitments
 *    - All 10 guardians reveal votes with ZK proofs
 *    - Tally: 2 approve, 7 reject, 1 abstain → REJECTION threshold met
 * 5. FROST signature created by 7 REJECTING guardians
 * 6. Transaction BLOCKED - attack prevented
 * 7. VDF computation cancelled (not needed)
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

  // Initialize guardian network (uses real FROST DKG)
  printStep(0, 'Initializing Guardian Network');
  const network = await initializeGuardianNetwork();
  printSuccess(`${GUARDIAN_COUNT} guardians initialized with FROST keys`);
  printKeyValue('Group Public Key', formatBytes32('0x' + network.groupPublicKey.toString('hex')));

  await delay(500);
  printDivider();

  // ─── Step 1: Transaction Submission ───
  printStep(1, 'Suspicious Transaction Submitted');
  await delay(300);

  const tx = createMockTransaction({
    amount: SCENARIO.amount,
    sourceChain: SCENARIO.sourceChain,
  });

  printKeyValue('Type', 'Large Withdrawal (SUSPICIOUS)');
  printKeyValue('Amount', `${formatEth(tx.amount)} (${formatUSD(tx.amount)})`);
  printKeyValue('Sender', formatAddress(tx.sender));
  printKeyValue('Destination', formatAddress(tx.destination));
  printKeyValue('Chain', getChainName(tx.sourceChain));
  printKeyValue('TX Hash', formatBytes32(tx.txHash));

  await delay(500);
  printDivider();

  // ─── Step 2: Security Checks ───
  printStep(2, 'Security Analysis');

  // ML Bot analysis - ATTACK DETECTED
  printSubStep('Running ML Bot analysis...');
  await simulateProgress('Deep pattern analysis', 6, 2500);
  const mlAnalysis = simulateMLBotAnalysis({ score: SCENARIO.mlBotScore, verdict: 'dangerous' });
  printKeyValue('ML Bot Score', `${mlAnalysis.score}/100 (CRITICAL)`);
  printKeyValue('ML Bot Verdict', mlAnalysis.verdict);
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
  printWarning(`Transaction FLAGGED by ML Bot (score ${mlAnalysis.score} >= threshold ${ML_BOT_THRESHOLD})`);

  // Check VDF requirement
  const vdfRequired = isVDFRequired(mlAnalysis.flagged);

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
    printSubStep('VDF computation starting on protocol worker...');
    await delay(400);
    printKeyValue('Challenge', formatBytes32(tx.txHash));
    printKeyValue('Iterations', VDF_ITERATIONS.toLocaleString());
    printKeyValue('Expected completion', `${VDF_DELAY_SECONDS / 60} minutes`);
    printInfo('VDF buys time for guardians to review');
    printWarning('Attacker must wait - cannot bypass VDF');
    await simulateProgress('VDF computing (guardians reviewing)', 5, 3000);
  }

  printDivider();

  // ─── Step 4: Guardian Voting (Attack Review) ───
  printStep(4, 'Guardian Voting (Attack Review)');
  printWarning('HIGH PRIORITY: ML Bot score 95/100');
  printInfo('Guardians reviewing attack evidence...');
  await delay(600);

  // Generate proposal ID
  const proposalId = generateProposalId(`attack-review-${tx.txHash}`);
  printKeyValue('Proposal ID', formatBytes32(proposalId));

  // Create voting decisions - REJECTION scenario
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
    const emoji = reveal.vote === 0 ? '(attack confirmed)' : '';
    await delay(300);
    printSubStep(`  ${guardian.name} revealed: ${voteStr} ${emoji}`);
  }

  // Phase 4c: Tally
  await delay(500);
  printSubStep('Phase 3: Vote Tally');
  const tally = tallyVotes(decisions);
  printVoteResult(tally.approve, tally.reject, tally.abstain);

  const voteApproved = isApprovalReached(tally.approve);
  const voteRejected = isRejectionReached(tally.reject);

  await delay(400);
  if (voteRejected) {
    printFailure(`REJECTION threshold reached: ${tally.reject}/${REJECTION_THRESHOLD} rejections`);
    printWarning('Guardians have confirmed this is an attack');
  } else if (voteApproved) {
    printSuccess(`Approval threshold reached: ${tally.approve}/${GUARDIAN_THRESHOLD}`);
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

  // Get REJECTING guardians for signing (they sign the rejection)
  const rejectingGuardians = decisions
    .filter(d => d.vote === 'REJECT')
    .map(d => d.guardianId);

  printSubStep(`Signing participants: ${rejectingGuardians.length} rejecting guardians`);
  printKeyValue('Rejection threshold', `${REJECTION_THRESHOLD} of ${GUARDIAN_COUNT}`);

  // Create message to sign (rejection of proposal)
  const rejectionMessage = Buffer.from(
    ethers.keccak256(ethers.toUtf8Bytes(`REJECT:${proposalId}`)).slice(2),
    'hex'
  );

  await delay(600);
  printSubStep('Round 1: Generating nonce commitments...');
  await delay(1000);
  printSubStep('Round 2: Generating signature shares...');
  await delay(800);
  printSubStep('Aggregating rejection signature...');
  await delay(500);

  // Create actual FROST signature using real crypto
  const signature = await createFROSTSignature(network, rejectionMessage, rejectingGuardians);
  const soliditySig = formatForSolidity(signature);

  printSuccess('FROST rejection signature created');
  printKeyValue('R (commitment)', formatBytes32(soliditySig.R));
  printKeyValue('z (scalar)', formatBytes32(soliditySig.z));

  await delay(500);
  printDivider();

  // ─── Step 6: Transaction Blocked ───
  printStep(6, 'Transaction Blocked');

  printSubStep('Security enforcement:');
  await delay(400);
  printFailure('Guardian vote: REJECTED (7/4 rejection threshold)');
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
  printKeyValue('Amount', `${formatEth(tx.amount)} (${formatUSD(tx.amount)})`);
  printKeyValue('Attack Type', SCENARIO.attackType);
  printKeyValue('ML Bot Score', `${mlAnalysis.score}/100 (threshold: ${ML_BOT_THRESHOLD})`);
  printKeyValue('VDF Triggered', `Yes (ML score ${mlAnalysis.score} >= ${ML_BOT_THRESHOLD}) - cancelled after rejection`);
  printKeyValue('Guardian Vote', `${tally.approve} approve, ${tally.reject} reject, ${tally.abstain} abstain`);
  printKeyValue('FROST Signature', 'Rejection signature valid');
  printKeyValue('Outcome', 'BLOCKED - Funds protected');
  console.log();

  // Attack timeline
  console.log('Attack Timeline:');
  printKeyValue('T+0s', 'Attacker submitted suspicious transaction');
  printKeyValue('T+1s', `ML Bot flagged with ${mlAnalysis.score}/100 score`);
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
