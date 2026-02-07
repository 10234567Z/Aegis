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

  printDivider();

  // ─── Step 1: Transaction Submission ───
  printStep(1, 'Transaction Submitted');

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

  printDivider();

  // ─── Step 2: Security Checks ───
  printStep(2, 'Security Analysis');

  // ML Bot analysis
  printSubStep('Running ML Bot analysis...');
  const mlAnalysis = simulateMLBotAnalysis({ score: 75, verdict: 'suspicious' });
  printKeyValue('ML Bot Score', `${mlAnalysis.score}/100 (suspicious pattern)`);
  printKeyValue('ML Bot Verdict', mlAnalysis.verdict);
  printKeyValue('Flag Threshold', `${ML_BOT_THRESHOLD}/100`);
  printWarning(`Transaction FLAGGED by ML Bot (score ${mlAnalysis.score} >= threshold ${ML_BOT_THRESHOLD})`);

  // Check VDF requirement
  const vdfRequired = isVDFRequired(mlAnalysis.flagged);

  if (vdfRequired) {
    printWarning('VDF TRIGGERED - ML Bot flagged transaction');
    printKeyValue('VDF Iterations', VDF_ITERATIONS.toLocaleString());
    printKeyValue('VDF Delay', `${VDF_DELAY_SECONDS / 60} minutes (fixed)`);
  } else {
    printSuccess('VDF NOT REQUIRED - ML Bot score below threshold');
  }

  printDivider();

  // ─── Step 3: VDF Computation Started ───
  printStep(3, 'VDF Time-Lock Initiated');

  if (vdfRequired) {
    printSubStep('VDF computation starting on protocol worker...');
    printKeyValue('Challenge', formatBytes32(tx.txHash));
    printKeyValue('Iterations', VDF_ITERATIONS.toLocaleString());
    printKeyValue('Expected completion', `${VDF_DELAY_SECONDS / 60} minutes`);
    printInfo('VDF runs IN PARALLEL with guardian voting');
    printInfo('If guardians approve first, VDF will be bypassed');
  }

  printDivider();

  // ─── Step 4: Guardian Voting (In Parallel) ───
  printStep(4, 'Guardian Voting (ZK Commit-Reveal)');
  printInfo('Guardian voting is MANDATORY - runs parallel to VDF');

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
  printSubStep('Phase 1: Commitment Submission');
  const commitments = simulateCommitPhase(decisions);

  for (const commitment of commitments) {
    const guardian = network.guardians[commitment.guardianId];
    printSubStep(`  ${guardian.name} submitted commitment`);
  }
  printSuccess(`${commitments.length}/${GUARDIAN_COUNT} commitments received`);

  // Phase 4b: Reveal Phase
  printSubStep('Phase 2: Vote Reveal with ZK Proofs');
  const reveals = simulateRevealPhase(commitments, decisions);

  for (const reveal of reveals) {
    const guardian = network.guardians[reveal.guardianId];
    const voteStr = reveal.vote === 1 ? 'APPROVE' : reveal.vote === 0 ? 'REJECT' : 'ABSTAIN';
    printSubStep(`  ${guardian.name} revealed: ${voteStr} (ZK proof verified)`);
  }

  // Phase 4c: Tally
  printSubStep('Phase 3: Vote Tally');
  const tally = tallyVotes(decisions);
  printVoteResult(tally.approve, tally.reject, tally.abstain);

  const votePassed = isApprovalReached(tally.approve);
  if (votePassed) {
    printSuccess(`Threshold reached: ${tally.approve}/${GUARDIAN_THRESHOLD} approvals`);
  } else {
    printFailure(`Threshold NOT reached: ${tally.approve}/${GUARDIAN_THRESHOLD} approvals`);
  }

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

  printSubStep('Round 1: Generating nonce commitments...');
  printSubStep('Round 2: Generating signature shares...');
  printSubStep('Aggregating signature...');

  // Create actual FROST signature using real crypto
  const signature = await createFROSTSignature(network, message, approvingGuardians);
  const soliditySig = formatForSolidity(signature);

  printSuccess('FROST signature created');
  printKeyValue('R (commitment)', formatBytes32(soliditySig.R));
  printKeyValue('z (scalar)', formatBytes32(soliditySig.z));

  printDivider();

  // ─── Step 6: VDF Bypass ───
  printStep(6, 'VDF Bypass Decision');

  printSubStep('Guardian approval detected BEFORE VDF completion');
  printInfo('VDF computation cancelled - not needed');

  // Create zero proof (bypass proof)
  const zeroProof = {
    output: '0x' + '0'.repeat(64),
    proof: '0x',
    iterations: 0,
  };

  printKeyValue('VDF Proof Type', 'Zero Proof (bypass)');
  printKeyValue('Iterations', '0 (bypassed)');
  printSuccess('VDF bypassed via guardian approval');

  printInfo(`User saved ${VDF_DELAY_SECONDS / 60} minutes of waiting time`);

  printDivider();

  // ─── Step 7: Execution ───
  printStep(7, 'Transaction Execution');

  printSubStep('Verification checks:');
  printSuccess('Guardian vote passed (7/7 threshold)');
  printSuccess('FROST signature valid');
  printSuccess('VDF bypassed with zero proof + FROST sig');
  printSuccess('Sender not blacklisted');
  printSuccess('Protocol not paused');

  printSubStep('Executing transaction...');

  // Simulate successful execution
  const executionTxHash = '0x' + Buffer.from(Array(32).fill(0).map(() =>
    Math.floor(Math.random() * 256))).toString('hex');

  printSuccess(`Transaction executed on ${getChainName(tx.sourceChain)}`);
  printKeyValue('Execution TX', formatBytes32(executionTxHash));

  // ─── Final Result ───
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
