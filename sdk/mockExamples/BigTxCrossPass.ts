/**
 * Use Case 4: Big TX Cross-Chain Pass
 *
 * Demonstrates: A large cross-chain transaction flagged by ML Bot, passes via guardian approval.
 * - ML Bot: Score 75/100 → FLAGGED (suspicious cross-chain pattern)
 * - Guardian voting: MANDATORY (9 approve, 0 reject, 1 abstain)
 * - VDF: TRIGGERED on source chain (ML Bot flagged) → 30 min delay
 * - VDF Outcome: BYPASSED (guardian approval came first)
 * - Bridge: LiFi (Stargate bridge)
 * - Result: PASS (cross-chain transfer successful)
 *
 * Flow:
 * 1. User submits 200 ETH bridge (Ethereum → Polygon)
 * 2. ML Bot analyzes → score 75/100 (suspicious) → FLAGGED
 * 3. Source chain (Ethereum):
 *    a. VDF triggered (ML Bot flagged, 30 min delay)
 *    b. Guardian voting: 9 approve, 0 reject, 1 abstain
 *    c. VDF bypassed with FROST signature
 * 4. LiFi routing:
 *    a. Quote fetched (Stargate bridge)
 *    b. Bridge transaction submitted
 * 5. Destination chain (Polygon):
 *    a. Funds received
 *    b. Cross-chain security event logged
 * 6. Transaction complete on both chains
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
  generateTxHash,
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

import {
  generateMockQuote,
  printRouteInfo,
} from './shared/mockLifi';

// ─── Script Configuration ───

const SCENARIO = {
  name: 'Big TX Cross-Chain Pass',
  amount: ethers.parseEther('200'),    // 200 ETH (~$400K at $2000/ETH)
  sourceChain: 1,                       // Ethereum mainnet
  destChain: 137,                       // Polygon
  expectedResult: 'PASS',
  votes: {
    approve: 9,                         // Strong approval
    reject: 0,
    abstain: 1,
  },
};

// ─── Main Script ───

async function main() {
  printHeader(`USE CASE 4: ${SCENARIO.name.toUpperCase()}`);

  // Initialize guardian network (uses real FROST DKG)
  printStep(0, 'Initializing Guardian Network');
  const network = await initializeGuardianNetwork();
  printSuccess(`${GUARDIAN_COUNT} guardians initialized with FROST keys`);
  printKeyValue('Group Public Key', formatBytes32('0x' + network.groupPublicKey.toString('hex')));

  await delay(500);
  printDivider();

  // ─── Step 1: Cross-Chain Transaction Submission ───
  printStep(1, 'Cross-Chain Transaction Submitted');
  await delay(300);

  const tx = createMockTransaction({
    amount: SCENARIO.amount,
    sourceChain: SCENARIO.sourceChain,
    destChain: SCENARIO.destChain,
  });

  printKeyValue('Type', 'Cross-Chain Bridge');
  printKeyValue('Amount', `${formatEth(tx.amount)} (${formatUSD(tx.amount)})`);
  printKeyValue('Sender', formatAddress(tx.sender));
  printKeyValue('Destination', formatAddress(tx.destination));
  printKeyValue('Source Chain', getChainName(tx.sourceChain));
  printKeyValue('Dest Chain', getChainName(tx.destChain!));
  printKeyValue('TX Hash', formatBytes32(tx.txHash));

  await delay(500);
  printDivider();

  // ─── Step 2: LiFi Route Discovery ───
  printStep(2, 'LiFi Route Discovery');

  printSubStep('Fetching optimal bridge route...');
  await simulateProgress('Querying LiFi aggregator', 4, 1800);

  const route = generateMockQuote({
    fromChainId: SCENARIO.sourceChain,
    toChainId: SCENARIO.destChain,
    fromToken: 'ETH',
    toToken: 'ETH',
    fromAmount: SCENARIO.amount,
  });

  printSuccess('Route found');
  printRouteInfo(route);

  await delay(500);
  printDivider();

  // ─── Step 3: Source Chain Security (Ethereum) ───
  printStep(3, `Source Chain Security (${getChainName(SCENARIO.sourceChain)})`);

  // ML Bot analysis
  printSubStep('Running ML Bot analysis...');
  await simulateProgress('Analyzing cross-chain patterns', 5, 2000);
  const mlAnalysis = simulateMLBotAnalysis({ score: 75, verdict: 'suspicious' });
  printKeyValue('ML Bot Score', `${mlAnalysis.score}/100 (suspicious cross-chain pattern)`);
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
    await simulateProgress('VDF computing on source chain', 5, 3000);
  }

  printDivider();

  // ─── Step 4: Guardian Voting ───
  printStep(4, 'Guardian Voting (ZK Commit-Reveal)');
  printInfo('Guardian voting is MANDATORY for all transactions');
  printInfo('Cross-chain transfers require extra scrutiny');
  await delay(400);

  // Generate proposal ID
  const proposalId = generateProposalId(`bridge-${tx.sourceChain}-${tx.destChain}-${tx.txHash}`);
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
  printStep(6, 'VDF Bypass on Source Chain');
  await delay(400);

  printInfo('VDF is computed on SOURCE chain only');
  printInfo('Destination chain trusts the FROST signature');
  await delay(500);
  printSubStep('Guardian approval detected BEFORE VDF completion');
  printInfo('VDF computation cancelled - not needed');

  await delay(400);
  printInfo(`User saved ${VDF_DELAY_SECONDS / 60} minutes of waiting time`);

  await delay(500);
  printDivider();

  // ─── Step 7: Source Chain Execution ───
  printStep(7, `Source Chain Execution (${getChainName(SCENARIO.sourceChain)})`);

  printSubStep('Verification checks on source chain:');
  await delay(300);
  printSuccess('Guardian vote passed (9/7 threshold)');
  await delay(200);
  printSuccess('FROST signature valid');
  await delay(200);
  printSuccess('VDF bypassed with zero proof');
  await delay(200);
  printSuccess('Sender not blacklisted');
  await delay(200);
  printSuccess('Protocol not paused');

  await delay(500);
  printSubStep('Executing bridge transaction via LiFi...');
  await delay(2000);

  const sourceTxHash = generateTxHash();
  printSuccess(`Source transaction submitted`);
  printKeyValue('Source TX', formatBytes32(sourceTxHash));
  printKeyValue('Bridge', route.steps[0].toolDetails.name);

  await delay(500);
  printDivider();

  // ─── Step 8: Bridge Execution ───
  printStep(8, 'Cross-Chain Bridge');

  printSubStep(`Bridging via ${route.steps[0].toolDetails.name}...`);
  printKeyValue('Source', getChainName(SCENARIO.sourceChain));
  printKeyValue('Destination', getChainName(SCENARIO.destChain));
  printKeyValue('Amount Sent', formatEth(BigInt(route.fromAmount)));
  printKeyValue('Amount Received', formatEth(BigInt(route.toAmount)));
  printKeyValue('Bridge Fee', '~0.1%');

  await delay(800);
  printSubStep('Bridge status: PENDING');
  await delay(1500);
  printSubStep('Bridge status: PENDING → IN_PROGRESS');
  await delay(2000);
  printSubStep('Bridge status: IN_PROGRESS → COMPLETED');
  printSuccess('Bridge completed successfully');

  await delay(500);
  printDivider();

  // ─── Step 9: Destination Chain ───
  printStep(9, `Destination Chain (${getChainName(SCENARIO.destChain)})`);

  const destTxHash = generateTxHash();

  printSubStep('Receiving funds on destination chain...');
  await delay(1500);
  printSuccess('Funds received on Polygon');
  printKeyValue('Dest TX', formatBytes32(destTxHash));
  printKeyValue('Recipient', formatAddress(tx.destination));
  printKeyValue('Amount', formatEth(BigInt(route.toAmount)));

  await delay(400);
  printSubStep('Cross-chain security event logged:');
  printInfo('Security state synchronized across chains');
  printInfo('Guardian approval propagated via LayerZero');

  // ─── Final Result ───
  await delay(500);
  printFinalResult(true, 'CROSS-CHAIN TRANSFER COMPLETE');

  // Summary
  console.log('Summary:');
  printKeyValue('Amount', `${formatEth(tx.amount)} (${formatUSD(tx.amount)})`);
  printKeyValue('Route', `${getChainName(SCENARIO.sourceChain)} → ${getChainName(SCENARIO.destChain)}`);
  printKeyValue('Bridge', route.steps[0].toolDetails.name);
  printKeyValue('ML Bot Score', `${mlAnalysis.score}/100 (threshold: ${ML_BOT_THRESHOLD})`);
  printKeyValue('VDF Triggered', `Yes (ML score ${mlAnalysis.score} >= threshold ${ML_BOT_THRESHOLD})`);
  printKeyValue('VDF Outcome', 'BYPASSED (guardian approval)');
  printKeyValue('Guardian Vote', `${tally.approve} approve, ${tally.reject} reject, ${tally.abstain} abstain`);
  printKeyValue('FROST Signature', 'Valid');
  printKeyValue('Source TX', formatBytes32(sourceTxHash));
  printKeyValue('Dest TX', formatBytes32(destTxHash));
  printKeyValue('Time Saved', `${VDF_DELAY_SECONDS / 60} minutes`);
  console.log();
}

// ─── Run Script ───

if (require.main === module) {
  runScript(SCENARIO.name, main);
}

export { main as runBigTxCrossChainPass };
