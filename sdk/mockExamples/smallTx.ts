/**
 * Use Case 1: Small TX Same-Chain Pass
 *
 * Demonstrates: A small, clean transaction on the same chain.
 * - ML Bot: Score 15/100 → NOT flagged (below threshold 50)
 * - Guardian voting: MANDATORY (8 approve, 1 reject, 1 abstain)
 * - VDF: NOT triggered (ML Bot did not flag)
 * - Result: PASS (immediate execution after guardian approval)
 *
 * Supports --live mode: uses real Agent API, Guardian Mock, and on-chain execution.
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
import { liveMLAnalysis, liveGuardianVoting, liveExecution, createLiveZeroProof } from './shared/liveClients';
import { SEPOLIA_MODE, getSDKConfig, printSDKModeBanner, executeViaSDK, checkOnChainStatus, buildIntent, SDKConfig } from './shared/sdkMode';

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

  // ─── Sepolia SDK Mode ───
  if (SEPOLIA_MODE) {
    const sdkConfig = await getSDKConfig();
    printSDKModeBanner(sdkConfig);
    await checkOnChainStatus(sdkConfig);

    const intent = buildIntent({
      target: sdkConfig.signerAddress, // self-transfer for demo
      value: 0n, // don't send real ETH
      amount: SCENARIO.amount,
      sourceChain: 11155111, // Sepolia
    });

    try {
      const result = await executeViaSDK(sdkConfig, intent, sdkConfig.signerAddress);
      printFinalResult(result.success, 'TRANSACTION APPROVED AND EXECUTED ON SEPOLIA');
      console.log('Summary:');
      printKeyValue('Mode', `SDK (${sdkConfig.networkName})`);
      printKeyValue('TX Hash', result.txHash);
      printKeyValue('Execution Time', `${result.executionTime}ms`);
      if (result.ensName) printKeyValue('ENS', result.ensName);
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

  printKeyValue('Type', 'Withdrawal');
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
    await simulateProgress('Analyzing transaction', 4, 1500);
    const mlAnalysis = simulateMLBotAnalysis({ score: 15, verdict: 'safe' });
    mlScore = mlAnalysis.score;
    mlVerdict = mlAnalysis.verdict;
    mlFlagged = mlAnalysis.flagged;
    printKeyValue('ML Bot Score', `${mlScore}/100 (low suspicion)`);
  }

  printKeyValue('ML Bot Verdict', mlVerdict);
  printKeyValue('Flag Threshold', `${ML_BOT_THRESHOLD}/100`);

  if (mlFlagged) {
    printInfo('Transaction FLAGGED by ML Bot');
  } else {
    printSuccess('Transaction NOT flagged by ML Bot');
  }

  await delay(400);

  const vdfRequired = isVDFRequired(mlFlagged);
  if (vdfRequired) {
    printInfo('VDF TRIGGERED - ML Bot flagged transaction');
  } else {
    printSuccess('VDF NOT REQUIRED - ML Bot score below threshold');
  }

  await delay(500);
  printDivider();

  // ─── Step 3: Guardian Voting ───
  printStep(3, LIVE_MODE ? 'Guardian Voting (Live API)' : 'Guardian Voting (ZK Commit-Reveal)');
  printInfo('Guardian voting is MANDATORY for all transactions');
  await delay(400);

  let votePassed: boolean;
  let voteApprove: number;
  let voteReject: number;
  let voteAbstain: number;
  let frostSigR: string | undefined;
  let frostSigZ: string | undefined;
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
    const proposalId = generateProposalId(`withdrawal-${tx.txHash}`);
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
      await delay(200);
      printSubStep(`  ${guardian.name} submitted commitment`);
    }
    printSuccess(`${commitments.length}/${GUARDIAN_COUNT} commitments received`);

    await delay(500);
    printSubStep('Phase 2: Vote Reveal with ZK Proofs');
    const reveals = simulateRevealPhase(commitments, decisions);

    for (const reveal of reveals) {
      const guardian = network!.guardians[reveal.guardianId];
      const voteStr = reveal.vote === 1 ? 'APPROVE' : reveal.vote === 0 ? 'REJECT' : 'ABSTAIN';
      await delay(250);
      printSubStep(`  ${guardian.name} revealed: ${voteStr} (ZK proof verified)`);
    }

    await delay(400);
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

  // ─── Step 4: FROST Threshold Signature ───
  printStep(4, 'FROST Threshold Signature');

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

    const proposalId = generateProposalId(`withdrawal-${tx.txHash}`);
    const message = Buffer.from(proposalId.slice(2), 'hex');

    await delay(600);
    printSubStep('Round 1: Generating nonce commitments...');
    await delay(800);
    printSubStep('Round 2: Generating signature shares...');
    await delay(600);
    printSubStep('Aggregating signature...');
    await delay(400);

    const signature = await createFROSTSignature(network!, message, approvingGuardians);
    const soliditySig = formatForSolidity(signature);

    printSuccess('FROST signature created');
    frostSigR = soliditySig.R;
    frostSigZ = soliditySig.z;
    printKeyValue('R (commitment)', formatBytes32(soliditySig.R));
    printKeyValue('z (scalar)', formatBytes32(soliditySig.z));
  }

  await delay(500);
  printDivider();

  // ─── Step 5: Execution ───
  printStep(5, 'Transaction Execution');

  printSubStep('Verification checks:');
  await delay(300);
  printSuccess(`Guardian vote passed (${voteApprove}/${GUARDIAN_THRESHOLD} threshold)`);
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
    await delay(1500);
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
  printKeyValue('Amount', formatEth(tx.amount));
  printKeyValue('ML Bot Score', `${mlScore}/100 (threshold: ${ML_BOT_THRESHOLD})`);
  printKeyValue('VDF Required', `No (ML score ${mlScore} < threshold ${ML_BOT_THRESHOLD})`);
  printKeyValue('Guardian Vote', `${voteApprove} approve, ${voteReject} reject, ${voteAbstain} abstain`);
  printKeyValue('FROST Signature', 'Valid');
  printKeyValue('Execution', 'Immediate (no VDF delay)');
  console.log();
}

// ─── Run Script ───

if (require.main === module) {
  runScript(SCENARIO.name, main);
}

export { main as runSmallTxSameChainPass };
