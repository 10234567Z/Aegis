/**
 * Use Case 1: Small TX Same-Chain Pass
 *
 * Demonstrates: A small, clean transaction on the same chain.
 * - ML Bot: Score 15/100 → NOT flagged (below threshold 50)
 * - Guardian voting: MANDATORY (8 approve, 1 reject, 1 abstain)
 * - VDF: NOT triggered (ML Bot did not flag)
 * - Result: PASS (immediate execution after guardian approval)
 *
 * Flow:
 * 1. User submits 10 ETH withdrawal (Ethereum → Ethereum)
 * 2. ML Bot analyzes transaction → score 15/100 (safe) → NOT flagged
 * 3. VDF not required (ML Bot did not flag)
 * 4. Guardian voting (ZK commit-reveal):
 *    - All 10 guardians submit commitments
 *    - All 10 guardians reveal votes with ZK proofs
 *    - Tally: 8 approve, 1 reject, 1 abstain → Threshold met
 * 5. FROST signature created by 8 approving guardians
 * 6. Transaction executed immediately (no VDF wait)
 */

import { ethers } from 'ethers';
import {
  printHeader,
  printStep,
  printSubStep,
  printSuccess,
  printFailure,
  printInfo,
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
  name: 'Small TX Same-Chain Pass',
  amount: ethers.parseEther('10'),     // 10 ETH (~$20K at $2000/ETH)
  sourceChain: 1,                       // Ethereum mainnet
  destChain: undefined,                 // Same chain (no bridge)
  expectedResult: 'PASS',
  votes: {
    approve: 8,
    reject: 1,
    abstain: 1,
  },
};

// ─── Main Script ───

async function main() {
  printHeader(`USE CASE 1: ${SCENARIO.name.toUpperCase()}`);

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

  printKeyValue('Type', 'Withdrawal');
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
  await simulateProgress('Analyzing transaction', 4, 1500);
  const mlAnalysis = simulateMLBotAnalysis({ score: 15, verdict: 'safe' });
  printKeyValue('ML Bot Score', `${mlAnalysis.score}/100 (low suspicion)`);
  printKeyValue('ML Bot Verdict', mlAnalysis.verdict);
  printKeyValue('Flag Threshold', `${ML_BOT_THRESHOLD}/100`);
  printSuccess('Transaction NOT flagged by ML Bot');

  await delay(400);

  // Check VDF requirement
  const vdfRequired = isVDFRequired(mlAnalysis.flagged);

  if (vdfRequired) {
    printInfo('VDF TRIGGERED - ML Bot flagged transaction');
  } else {
    printSuccess('VDF NOT REQUIRED - ML Bot score below threshold');
  }

  await delay(500);
  printDivider();

  // ─── Step 3: Guardian Voting (Mandatory) ───
  printStep(3, 'Guardian Voting (ZK Commit-Reveal)');
  printInfo('Guardian voting is MANDATORY for all transactions');
  await delay(400);

  // Generate proposal ID
  const proposalId = generateProposalId(`withdrawal-${tx.txHash}`);
  printKeyValue('Proposal ID', formatBytes32(proposalId));

  // Create voting decisions
  const decisions = createVotingDecisions(
    SCENARIO.votes.approve,
    SCENARIO.votes.reject,
    SCENARIO.votes.abstain,
  );

  // Phase 3a: Commit Phase
  await delay(500);
  printSubStep('Phase 1: Commitment Submission');
  const commitments = simulateCommitPhase(decisions);

  for (const commitment of commitments) {
    const guardian = network.guardians[commitment.guardianId];
    await delay(200);
    printSubStep(`  ${guardian.name} submitted commitment`);
  }
  printSuccess(`${commitments.length}/${GUARDIAN_COUNT} commitments received`);

  // Phase 3b: Reveal Phase
  await delay(500);
  printSubStep('Phase 2: Vote Reveal with ZK Proofs');
  const reveals = simulateRevealPhase(commitments, decisions);

  for (const reveal of reveals) {
    const guardian = network.guardians[reveal.guardianId];
    const voteStr = reveal.vote === 1 ? 'APPROVE' : reveal.vote === 0 ? 'REJECT' : 'ABSTAIN';
    await delay(250);
    printSubStep(`  ${guardian.name} revealed: ${voteStr} (ZK proof verified)`);
  }

  // Phase 3c: Tally
  await delay(400);
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

  // ─── Step 4: FROST Threshold Signature ───
  printStep(4, 'FROST Threshold Signature');

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
  await delay(800);
  printSubStep('Round 2: Generating signature shares...');
  await delay(600);
  printSubStep('Aggregating signature...');
  await delay(400);

  // Create actual FROST signature using real crypto
  const signature = await createFROSTSignature(network, message, approvingGuardians);
  const soliditySig = formatForSolidity(signature);

  printSuccess('FROST signature created');
  printKeyValue('R (commitment)', formatBytes32(soliditySig.R));
  printKeyValue('z (scalar)', formatBytes32(soliditySig.z));

  await delay(500);
  printDivider();

  // ─── Step 5: Execution ───
  printStep(5, 'Transaction Execution');

  printSubStep('Verification checks:');
  await delay(300);
  printSuccess('Guardian vote passed (8/7 threshold)');
  await delay(200);
  printSuccess('FROST signature valid');
  await delay(200);
  printSuccess('VDF not required (ML Bot score below threshold)');
  await delay(200);
  printSuccess('Sender not blacklisted');
  await delay(200);
  printSuccess('Protocol not paused');

  await delay(500);
  printSubStep('Executing transaction...');
  await delay(1500);

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
  printKeyValue('Amount', formatEth(tx.amount));
  printKeyValue('ML Bot Score', `${mlAnalysis.score}/100 (threshold: ${ML_BOT_THRESHOLD})`);
  printKeyValue('VDF Required', `No (ML score ${mlAnalysis.score} < threshold ${ML_BOT_THRESHOLD})`);
  printKeyValue('Guardian Vote', `${tally.approve} approve, ${tally.reject} reject, ${tally.abstain} abstain`);
  printKeyValue('FROST Signature', 'Valid');
  printKeyValue('Execution', 'Immediate (no VDF delay)');
  console.log();
}

// ─── Run Script ───

if (require.main === module) {
  runScript(SCENARIO.name, main);
}

export { main as runSmallTxSameChainPass };
