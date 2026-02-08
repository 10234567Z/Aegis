/**
 * Use Case 5: Small TX Cross-Chain Fail
 *
 * Demonstrates: A small cross-chain transaction that fails due to blacklisted destination.
 * - ML Bot: Score 99/100 → FLAGGED (blacklisted destination detected)
 * - Guardian voting: MANDATORY (1 approve, 8 reject, 1 abstain)
 * - VDF: TRIGGERED (ML Bot flagged) → but cancelled after guardian rejection
 * - Failure Reason: Destination address is on the blacklist (known exploit address)
 * - Result: FAIL (guardians reject transfer to exploit address)
 *
 * Flow:
 * 1. User submits 5 ETH bridge (Ethereum → Arbitrum)
 * 2. ML Bot analyzes → score 99/100 (dangerous) → FLAGGED
 *    - Blacklisted destination address detected
 * 3. VDF starts (30 min delay), buying time for guardians
 * 4. Guardian voting:
 *    - All 10 guardians submit ZK commitments
 *    - All 10 guardians reveal votes with ZK proofs
 *    - Tally: 1 approve, 8 reject, 1 abstain → REJECTION threshold met
 * 5. FROST rejection signature created
 * 6. Transaction BLOCKED, VDF cancelled - funds protected
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

import {
  generateMockQuote,
  printRouteInfo,
  KNOWN_EXPLOIT_ADDRESSES,
  isKnownExploitAddress,
} from './shared/mockLifi';

import { ensureServices, getLiveConfig, printLiveModeBanner, LiveConfig } from './shared/liveMode';
import { liveMLAnalysis, liveGuardianVoting, liveVDFComputation } from './shared/liveClients';
import { SEPOLIA_MODE, getSDKConfig, printSDKModeBanner, executeViaSDK, checkOnChainStatus, buildIntent, SDKConfig } from './shared/sdkMode';

// ─── Script Configuration ───

const SCENARIO = {
  name: 'Small TX Cross-Chain Fail',
  amount: ethers.parseEther('5'),      // 5 ETH (~$10K at $2000/ETH) - SMALL
  sourceChain: 1,                       // Ethereum mainnet
  destChain: 42161,                     // Arbitrum
  // Use a known exploit address as destination
  destination: KNOWN_EXPLOIT_ADDRESSES[0],
  expectedResult: 'FAIL',
  votes: {
    approve: 1,                         // Only 1 naive guardian approves
    reject: 8,                          // 8 reject (blacklisted address)
    abstain: 1,
  },
  blacklistReason: 'Known exploit address from Ronin Bridge hack (2022)',
};

// ─── Main Script ───

async function main() {
  printHeader(`USE CASE 5: ${SCENARIO.name.toUpperCase()}`);

  // ─── Sepolia SDK Mode ───
  if (SEPOLIA_MODE) {
    const sdkConfig = await getSDKConfig();
    printSDKModeBanner(sdkConfig);
    await checkOnChainStatus(sdkConfig);

    const intent = buildIntent({
      target: '0x1234567890123456789012345678901234567890', // known exploit addr
      value: 0n,
      amount: SCENARIO.amount,
      sourceChain: 11155111,
      // Cross-chain bridge not available on Sepolia demo — same-chain with blacklisted target
    });

    try {
      const result = await executeViaSDK(sdkConfig, intent, sdkConfig.signerAddress);
      // If we get here, the blacklisted addr wasn't caught
      printFinalResult(true, 'TRANSACTION EXECUTED (blacklist not enforced)');
      console.log();
    } catch (error: any) {
      if (error.message.includes('blacklisted') || error.message.includes('Blacklisted') || error.message.includes('rejected')) {
        printFinalResult(false, 'TRANSACTION BLOCKED - BLACKLISTED DESTINATION');
        printInfo('SDK correctly blocked transfer to known exploit address');
      } else {
        printFinalResult(false, `SDK ERROR: ${error.message}`);
      }
    }
    console.log('Summary:');
    printKeyValue('Mode', `SDK (${sdkConfig.networkName})`);
    printKeyValue('Target', '0x1234...7890 (known exploit)');
    printKeyValue('Expected', 'BLOCKED by blacklist/guardian rejection');
    console.log();
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

  // ─── Step 1: Cross-Chain Transaction Submission ───
  printStep(1, 'Cross-Chain Transaction Submitted');
  await delay(300);

  const tx = createMockTransaction({
    amount: SCENARIO.amount,
    sourceChain: SCENARIO.sourceChain,
    destChain: SCENARIO.destChain,
    destination: SCENARIO.destination, // Blacklisted address
    sender: LIVE_MODE ? liveConfig!.signerAddress : undefined,
  });

  printKeyValue('Type', 'Cross-Chain Bridge');
  printKeyValue('Amount', `${formatEth(tx.amount)} (${formatUSD(tx.amount)})`);
  printKeyValue('Sender', formatAddress(tx.sender));
  printKeyValue('Destination', formatAddress(tx.destination));
  printKeyValue('Source Chain', getChainName(tx.sourceChain));
  printKeyValue('Dest Chain', getChainName(tx.destChain!));
  printKeyValue('TX Hash', formatBytes32(tx.txHash));
  if (LIVE_MODE) printInfo('Mode: LIVE (real APIs)');

  await delay(500);
  printDivider();

  // ─── Step 2: Security Checks ───
  printStep(2, 'Security Analysis');

  // Check blacklist - THIS IS THE KEY CHECK
  printSubStep('Checking destination address against blacklist...');
  await delay(800);

  const isBlacklisted = isKnownExploitAddress(tx.destination);

  if (isBlacklisted) {
    printFailure('BLACKLIST ALERT: Destination address is BLACKLISTED');
    printKeyValue('Address', tx.destination);
    printKeyValue('Reason', SCENARIO.blacklistReason);
    printWarning('Blacklist evidence will be presented to guardians');
  } else {
    printSuccess('Destination address is clean');
  }

  await delay(500);

  // ML Bot analysis
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
    await simulateProgress('Analyzing transaction + blacklist check', 5, 2000);
    const mlAnalysis = simulateMLBotAnalysis({ score: 99, verdict: 'dangerous' });
    mlScore = mlAnalysis.score;
    mlVerdict = mlAnalysis.verdict;
    mlFlagged = mlAnalysis.flagged;
    printKeyValue('ML Bot Score', `${mlScore}/100 (CRITICAL - blacklisted destination)`);
  }

  printKeyValue('ML Bot Verdict', mlVerdict);
  printKeyValue('Flag Threshold', `${ML_BOT_THRESHOLD}/100`);
  printFailure(`Transaction FLAGGED by ML Bot (score ${mlScore} >= threshold ${ML_BOT_THRESHOLD})`);

  await delay(500);

  // Check VDF requirement
  const vdfRequired = isVDFRequired(mlFlagged);

  if (vdfRequired) {
    printWarning('VDF TRIGGERED - ML Bot flagged transaction');
    printKeyValue('VDF Iterations', VDF_ITERATIONS.toLocaleString());
    printKeyValue('VDF Delay', `${VDF_DELAY_SECONDS / 60} minutes (buys time for guardian review)`);
  }

  await delay(500);
  printDivider();

  // ─── Step 3: VDF Time-Lock ───
  printStep(3, 'VDF Time-Lock Initiated');

  if (vdfRequired) {
    if (LIVE_MODE) {
      printSubStep('Requesting VDF computation from VDF Worker...');
      await liveVDFComputation(liveConfig!, tx.txHash, tx.sourceChain, tx.sender);
      printInfo('VDF buys time for guardians to review');
      printWarning('Transaction cannot execute until VDF completes or guardians decide');
    } else {
      printSubStep('VDF computation starting on protocol worker...');
      await delay(400);
      printKeyValue('Challenge', formatBytes32(tx.txHash));
      printKeyValue('Iterations', VDF_ITERATIONS.toLocaleString());
      printKeyValue('Expected completion', `${VDF_DELAY_SECONDS / 60} minutes`);
      printInfo('VDF buys time for guardians to review');
      printWarning('Transaction cannot execute until VDF completes or guardians decide');
      await simulateProgress('VDF computing (guardians alerted)', 5, 2500);
    }
  }

  printDivider();

  // ─── Step 4: LiFi Route (Still fetched for context) ───
  printStep(4, 'LiFi Route Discovery');

  printSubStep('Fetching bridge route for context...');
  await delay(1200);

  const route = generateMockQuote({
    fromChainId: SCENARIO.sourceChain,
    toChainId: SCENARIO.destChain,
    fromToken: 'ETH',
    toToken: 'ETH',
    fromAmount: SCENARIO.amount,
  });

  printInfo('Route found (but may be blocked)');
  printRouteInfo(route);

  printWarning('Note: Route exists but destination is blacklisted');

  await delay(500);
  printDivider();

  // ─── Step 5: Guardian Voting (Blacklist Review) ───
  printStep(5, LIVE_MODE ? 'Guardian Voting - Blacklist Review (Live API)' : 'Guardian Voting (ZK Commit-Reveal)');
  printInfo('Guardian voting is MANDATORY for all transactions');
  printWarning('CRITICAL ALERT: Destination on blacklist - evidence presented to guardians');
  printInfo('Guardians reviewing blacklist evidence...');
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
    // Show blacklist evidence to guardians
    const proposalId = generateProposalId(`blacklist-review-${tx.txHash}`);
    printKeyValue('Proposal ID', formatBytes32(proposalId));

    await delay(400);
    printSubStep('Evidence presented to guardians:');
    await delay(300);
    printSubStep(`  - Destination: ${formatAddress(tx.destination)}`);
    await delay(200);
    printSubStep(`  - Blacklist Reason: ${SCENARIO.blacklistReason}`);
    await delay(200);
    printSubStep('  - Address linked to $625M exploit');
    await delay(200);
    printSubStep('  - OFAC sanctioned address');

    const decisions = createVotingDecisions(
      SCENARIO.votes.approve,
      SCENARIO.votes.reject,
      SCENARIO.votes.abstain,
    );

    await delay(600);
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
      const reason = reveal.vote === 0 ? '(blacklist confirmed)' :
                     reveal.vote === 1 ? '(disagrees with blacklist)' : '';
      await delay(300);
      printSubStep(`  ${guardian.name} revealed: ${voteStr} ${reason}`);
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
    printWarning('Guardians have confirmed: DO NOT send to blacklisted address');
  } else if (isApprovalReached(voteApprove)) {
    printSuccess(`Approval threshold reached: ${voteApprove}/${GUARDIAN_THRESHOLD}`);
  } else {
    printInfo('No threshold reached - vote inconclusive');
  }

  await delay(500);
  printDivider();

  // ─── Step 6: FROST Rejection Signature ───
  printStep(6, 'FROST Rejection Signature');

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

    const proposalId = generateProposalId(`blacklist-review-${tx.txHash}`);
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

  // ─── Step 7: Transaction Blocked ───
  printStep(7, 'Transaction Blocked');

  printSubStep('Security enforcement:');
  await delay(400);
  printFailure(`Guardian vote: REJECTED (${voteReject}/${REJECTION_THRESHOLD} rejection threshold)`);
  await delay(300);
  printSuccess('FROST rejection signature: VALID');
  await delay(300);
  printInfo('VDF: CANCELLED (guardians rejected before completion)');

  await delay(500);
  printSubStep('Actions taken:');
  await delay(300);
  printFailure('Transaction BLOCKED - cannot execute');
  await delay(200);
  printFailure('Bridge route CANCELLED');
  await delay(200);
  printInfo('Sender notified: Destination is blacklisted');
  await delay(200);
  printWarning('Incident logged for compliance');

  // ─── Final Result ───
  await delay(500);
  printFinalResult(false, 'TRANSACTION BLOCKED - BLACKLISTED DESTINATION');

  // Summary
  console.log('Summary:');
  printKeyValue('Mode', LIVE_MODE ? 'LIVE (real infrastructure)' : 'MOCK (simulated)');
  printKeyValue('Amount', `${formatEth(tx.amount)} (${formatUSD(tx.amount)})`);
  printKeyValue('Route', `${getChainName(SCENARIO.sourceChain)} → ${getChainName(SCENARIO.destChain)}`);
  printKeyValue('Destination', formatAddress(tx.destination));
  printKeyValue('Blacklist Status', 'BLACKLISTED');
  printKeyValue('Blacklist Reason', SCENARIO.blacklistReason);
  printKeyValue('ML Bot Score', `${mlScore}/100 (threshold: ${ML_BOT_THRESHOLD})`);
  printKeyValue('VDF Triggered', `Yes (ML score ${mlScore} >= ${ML_BOT_THRESHOLD}) - cancelled after rejection`);
  printKeyValue('Guardian Vote', `${voteApprove} approve, ${voteReject} reject, ${voteAbstain} abstain`);
  printKeyValue('FROST Signature', 'Rejection signature valid');
  printKeyValue('Outcome', 'BLOCKED - Funds protected');
  console.log();

  // Security note
  console.log('Security Note:');
  printInfo('Even small transactions are blocked if destination is blacklisted');
  printInfo('Guardians maintain and update the blacklist based on:');
  printSubStep('  - Known exploit addresses');
  printSubStep('  - OFAC sanctioned entities');
  printSubStep('  - Mixer/tumbler contracts');
  printSubStep('  - Phishing addresses');
  console.log();
}

// ─── Run Script ───

if (require.main === module) {
  runScript(SCENARIO.name, main);
}

export { main as runSmallTxCrossChainFail };
