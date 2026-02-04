/**
 * Demo of ML bot triggered VDF with guardian bypass
 */

/// <reference types="node" />
import {
  VDFClient,
  getRequiredDelay,
  getRequiredIterations,
  formatDelay,
  printVDFConfig,
} from '../src/index';

// --- demo scenarios ---
async function demoMLBotTriggeredVDF() {
  console.log('\n' + '-'.repeat(70));
  console.log('  ML BOT TRIGGERED VDF DEMO');
  console.log('-'.repeat(70) + '\n');
  printVDFConfig();
  
  console.log('─'.repeat(70));
  console.log('SCENARIO 1: Clean Tx (NOT Flagged)');
  console.log('─'.repeat(70));
  console.log('1. User submits withdrawal');
  console.log('2. ML bot analyzes: "Pattern looks legitimate"');
  console.log('3. ML bot score: 15/100 (low suspicion)');
  console.log('4. Result: ✓ NO VDF TRIGGERED');
  console.log('5. Tx executes immediately');
  console.log('\nTotal time: < 1 second');
  console.log('User experience: INSTANT\n');
  
  console.log('─'.repeat(70));
  console.log('SCENARIO 2: Suspicious Tx (FLAGGED)');
  console.log('─'.repeat(70));
  console.log('1. User (attacker) submits withdrawal');
  console.log('2. ML bot analyzes: "Flash loan detected"');
  console.log('3. ML bot score: 95/100 (high suspicion)');
  console.log('4. Result:  VDF TRIGGERED (30 min delay)');
  console.log('5. Guardians notified for review');
  console.log();
  
  console.log('  Path A: Guardians APPROVE (legitimate but flagged)');
  console.log('    • 7/10 vote APPROVE (takes 2-5 min)');
  console.log('    • VDF BYPASSED');
  console.log('    • Execute immediately');
  console.log('    • Total: 2-5 minutes\n');
  
  console.log('  Path B: Guardians REJECT (confirmed attack)');
  console.log('    • 7/10 vote REJECT (takes 2-5 min)');
  console.log('    • Tx BLOCKED forever');
  console.log('    • Attack prevented!');
  console.log('    • Total: 2-5 minutes\n');
  
  console.log('  Path C: No Guardian Response (guardians offline)');
  console.log('    • VDF completes naturally (30 min)');
  console.log('    • Tx executes after delay');
  console.log('    • Safety net worked!');
  console.log('    • Total: 30 minutes\n');
  
  console.log('─'.repeat(70));
  console.log('SCENARIO 3: Mixed Pattern (Edge Case)');
  console.log('─'.repeat(70));
  console.log('1. Large withdrawal from new address');
  console.log('2. ML bot analyzes: "Uncertain pattern"');
  console.log('3. ML bot score: 65/100 (medium suspicion)');
  console.log('4. Result: VDF TRIGGERED (safety first)');
  console.log('5. Guardians review and make decision');
  console.log('6. Most likely: Guardians approve if legitimate');
  console.log('\n Expected time: 2-5 minutes (guardian approval)');
  console.log('🎯 False positive handled gracefully\n');
}

async function demoClientUsage() {
  console.log('\n' + '='.repeat(70));
  console.log('  VDF CLIENT USAGE DEMO');
  console.log('='.repeat(70) + '\n');
  
  const client = new VDFClient({ localCompute: true });
  
  // Clean Tx
  console.log('Example 1: Clean Tx (ML bot: 15/100)');
  const clean = false;  // Not flagged
  if (client.isVDFRequired(clean)) {
    console.log('  ✗ VDF required');
  } else {
    console.log('  ✓ No VDF - executes immediately');
  }
  console.log();
  
  //Suspicious Tx
  console.log('Example 2: Suspicious Tx (ML bot: 95/100)');
  const suspicious = true;  // Flagged
  if (client.isVDFRequired(suspicious)) {
    console.log('    VDF required');
    console.log(`  Delay: ${formatDelay(getRequiredDelay())}`);
    console.log(`  Iterations: ${getRequiredIterations().toLocaleString()}`);
    console.log(`  Can be bypassed by guardian approval`);
  }
  console.log();
  
  // Zero proof - bypass
  console.log('Example 3: Guardian bypass');
  const zeroProof = client.createZeroProof();
  console.log('  Created zero proof:');
  console.log(`    Iterations: ${zeroProof.iterations}`);
  console.log(`    Output: ${zeroProof.output.toString('hex').slice(0, 16)}...`);
  console.log('  This proof is instantly valid (no computation needed)');
  console.log();
}

async function demoFullFlow() {
  console.log('\n' + '='.repeat(70));
  console.log('  FULL ML BOT + VDF + GUARDIAN FLOW');
  console.log('='.repeat(70) + '\n');
  
  console.log('Step 1: Tx Submitted');
  console.log('  User: Withdraw 1000 ETH');
  console.log('  Destination: 0xabc...');
  console.log();
  
  console.log('Step 2: ML Bot Analysis');
  console.log('  Analyzing pattern...');
  console.log('  Features checked:');
  console.log('    • Tx history: New address ');
  console.log('    • Amount: Large withdrawal ');
  console.log('    • Timing: Unusual hour ');
  console.log('    • Contract: No flash loan ✓');
  console.log('    • Gas: Normal ✓');
  console.log();
  console.log('  ML Bot Score: 72/100 (HIGH SUSPICION)');
  console.log('  Decision: FLAG FOR REVIEW');
  console.log();
  
  console.log('Step 3: VDF Triggered');
  console.log('  SecurityMiddleware.queueTx()');
  console.log('  - Starts 30-minute VDF timer');
  console.log('  - Creates guardian proposal');
  console.log('  - Emits TxQueued event');
  console.log();
  
  console.log('Step 4: Guardian Notification');
  console.log('  All 10 guardians notified via:');
  console.log('    • Discord webhook');
  console.log('    • Email alert');
  console.log('    • Dashboard notification');
  console.log();
  console.log('  Guardians see:');
  console.log('    • Tx details');
  console.log('    • ML bot score: 72/100');
  console.log('    • User history');
  console.log('    • Pattern analysis');
  console.log();
  
  console.log('Step 5: Guardian Voting (ZK Private)');
  console.log('  Guardian 1: Reviews → APPROVE (legitimate user)');
  console.log('  Guardian 2: Reviews → APPROVE');
  console.log('  Guardian 3: Reviews → APPROVE');
  console.log('  Guardian 4: Reviews → REJECT (too risky)');
  console.log('  Guardian 5: Reviews → APPROVE');
  console.log('  Guardian 6: Reviews → APPROVE');
  console.log('  Guardian 7: Reviews → APPROVE');
  console.log('  Guardian 8: Reviews → APPROVE');
  console.log('  Guardian 9: Reviews → ABSTAIN');
  console.log('  Guardian 10: Reviews → ABSTAIN');
  console.log();
  console.log('  Result: 7 APPROVE, 1 REJECT, 2 ABSTAIN');
  console.log('  Threshold reached: 7/10 ✓');
  console.log('  Time taken: 3 minutes');
  console.log();
  
  console.log('Step 6: FROST Signature');
  console.log('  7 guardians create threshold signature');
  console.log('  Signature proves guardian approval');
  console.log();
  
  console.log('Step 7: VDF Bypass');
  console.log('  Guardian approval detected');
  console.log('  VDF bypassed (27 minutes saved!)');
  console.log('  Zero proof created');
  console.log();
  
  console.log('Step 8: Execution');
  console.log('  SecurityMiddleware.executeTx()');
  console.log('  Checks:');
  console.log('    ✓ Guardian approved (7/10)');
  console.log('    ✓ FROST signature valid');
  console.log('    ✓ VDF bypassed with zero proof');
  console.log('  Tx executes immediately!');
  console.log();
  
  console.log('Timeline:');
  console.log('  • VDF started: 30-min countdown');
  console.log('  • Guardians voted: 3 minutes');
  console.log('  • Execution: IMMEDIATE (bypassed)');
  console.log('  • User saved: 27 minutes! ⚡');
  console.log();
}

// --- Run Demo ---
async function runDemo() {
  await demoMLBotTriggeredVDF();
  await demoClientUsage();
  await demoFullFlow();
  
  console.log('\n' + '='.repeat(70));
  console.log('  KEY INSIGHTS');
  console.log('='.repeat(70) + '\n');
  
  console.log('1. ML Bot is the Trigger');
  console.log('   - Analyzes every Tx');
  console.log('   - Only flags suspicious patterns');
  console.log('   - Clean Txs: instant execution\n');
  
  console.log('2. VDF = Safety Net, Not Punishment');
  console.log('   - Guardians usually respond in 2-5 min');
  console.log('   - Legitimate users approved quickly');
  console.log('   - Attackers blocked or delayed\n');
  
  console.log('3. Three-Layer Defense');
  console.log('   - Layer 1: ML bot (automated detection)');
  console.log('   - Layer 2: Guardians (human review)');
  console.log('   - Layer 3: VDF (time-lock fallback)\n');
  
  console.log('='.repeat(70) + '\n');
}
if (require.main === module) {
  runDemo().catch(error => {
    console.error('Demo error:', error);
    process.exit(1);
  });
}
