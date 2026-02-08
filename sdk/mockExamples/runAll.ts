/**
 * Run All Mock Example Scripts
 *
 * Executes all 5 use cases demonstrating the DeFi Guardian security flow:
 *
 * 1. Small TX Same-Chain Pass     - Small tx, no VDF, guardian approval
 * 2. Big TX Slow Pass Same-Chain  - Large tx, VDF triggered but bypassed via guardian approval
 * 3. Big TX Slow Fail Same-Chain  - Large tx, attack detected, guardians reject
 * 4. Big TX Cross-Chain Pass      - Cross-chain bridge, VDF bypassed, successful
 * 5. Small TX Cross-Chain Fail    - Cross-chain to blacklisted address, blocked
 *
 * Usage:
 *   npx ts-node sdk/mockExamples/runAll.ts          # Mock mode (all simulated)
 *   npx ts-node sdk/mockExamples/runAll.ts --live    # Live mode (real services)
 *   npx ts-node sdk/mockExamples/runAll.ts --sepolia  # Sepolia mode (real SDK on testnet)
 *   npx ts-node sdk/mockExamples/runAll.ts --fast    # Fast mode (skip delays)
 */

import { runSmallTxSameChainPass } from './smallTx';
import { runBigTxSlowPassSameChain } from './bigTxPass';
import { runBigTxSlowFailSameChain } from './bigTxFail';
import { runBigTxCrossChainPass } from './BigTxCrossPass';
import { runSmallTxCrossChainFail } from './SmallTxCross';
import { clearNetworkCache } from './shared/mockGuardians';
import { LIVE_MODE } from './shared/utils';
import { SEPOLIA_MODE } from './shared/sdkMode';
import { ensureServices, printLiveModeBanner } from './shared/liveMode';

// ─── Configuration ───

interface ScriptConfig {
  name: string;
  description: string;
  fn: () => Promise<void>;
  category: 'same-chain' | 'cross-chain';
  expectedResult: 'PASS' | 'FAIL';
}

const SCRIPTS: ScriptConfig[] = [
  {
    name: '1. Small TX Same-Chain Pass',
    description: '10 ETH, ML clean (15/100), no VDF, 8/10 approve',
    fn: runSmallTxSameChainPass,
    category: 'same-chain',
    expectedResult: 'PASS',
  },
  {
    name: '2. Big TX Slow Pass Same-Chain',
    description: '500 ETH, ML flagged (75/100), VDF bypassed via guardian approval',
    fn: runBigTxSlowPassSameChain,
    category: 'same-chain',
    expectedResult: 'PASS',
  },
  {
    name: '3. Big TX Slow Fail Same-Chain',
    description: '1000 ETH attack, ML flagged (95/100), guardians reject',
    fn: runBigTxSlowFailSameChain,
    category: 'same-chain',
    expectedResult: 'FAIL',
  },
  {
    name: '4. Big TX Cross-Chain Pass',
    description: '200 ETH bridge ETH→Polygon, ML flagged (75/100), VDF bypassed',
    fn: runBigTxCrossChainPass,
    category: 'cross-chain',
    expectedResult: 'PASS',
  },
  {
    name: '5. Small TX Cross-Chain Fail',
    description: '5 ETH to blacklisted addr, ML flagged (99/100), blocked',
    fn: runSmallTxCrossChainFail,
    category: 'cross-chain',
    expectedResult: 'FAIL',
  },
];

// ─── Formatting ───

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  magenta: '\x1b[35m',
};

function printSimpleBanner(): void {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                                                                      ║');
  console.log('║                     DEFI GUARDIAN - DEMO SUITE                       ║');
  console.log('║                                                                      ║');
  console.log('║     First Cryptographically-Enforced Intent Layer for DeFi          ║');
  console.log('║                    ETHGlobal HackMoney 2026                          ║');
  console.log('║                                                                      ║');
  if (LIVE_MODE) {
    console.log(`║     ${COLORS.magenta}${COLORS.bright}MODE: LIVE — Real APIs, Real Contracts, Real FROST${COLORS.reset}              ║`);  } else if (SEPOLIA_MODE) {
    console.log(`\u2551     ${COLORS.green}${COLORS.bright}MODE: SEPOLIA \u2014 Real SDK SecurityMiddleware on Testnet${COLORS.reset}         \u2551`);  } else {
    console.log('║     MODE: MOCK — All components simulated locally                   ║');
  }
  console.log('║                                                                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('\n');
}

function printScriptList(): void {
  console.log(`${COLORS.bright}Demo Scripts:${COLORS.reset}\n`);

  for (const script of SCRIPTS) {
    const resultColor = script.expectedResult === 'PASS' ? COLORS.green : COLORS.red;
    console.log(`  ${COLORS.cyan}${script.name}${COLORS.reset}`);
    console.log(`    ${COLORS.gray}${script.description}${COLORS.reset}`);
    console.log(`    Expected: ${resultColor}${script.expectedResult}${COLORS.reset}`);
    console.log();
  }
}

function printDivider(): void {
  console.log(`${COLORS.gray}${'━'.repeat(72)}${COLORS.reset}`);
}

function printSummary(results: { name: string; success: boolean; duration: number }[]): void {
  console.log('\n');
  printDivider();
  console.log(`\n${COLORS.bright}DEMO SUMMARY${COLORS.reset}\n`);

  let passCount = 0;
  let failCount = 0;

  for (const result of results) {
    const icon = result.success ? `${COLORS.green}✓${COLORS.reset}` : `${COLORS.red}✗${COLORS.reset}`;
    const status = result.success ? `${COLORS.green}COMPLETED${COLORS.reset}` : `${COLORS.red}ERROR${COLORS.reset}`;
    console.log(`  ${icon} ${result.name} - ${status} (${result.duration}ms)`);

    if (result.success) passCount++;
    else failCount++;
  }

  console.log();
  console.log(`  ${COLORS.bright}Total:${COLORS.reset} ${results.length} scripts`);
  console.log(`  ${COLORS.green}Completed:${COLORS.reset} ${passCount}`);
  console.log(`  ${COLORS.red}Errors:${COLORS.reset} ${failCount}`);
  if (LIVE_MODE) console.log(`  ${COLORS.magenta}Mode:${COLORS.reset} LIVE (real infrastructure)`);
  console.log();
  printDivider();
}

// ─── Main Runner ───

async function runAllScripts(): Promise<void> {
  printSimpleBanner();

  // In live mode, check all services upfront before running any scripts
  if (LIVE_MODE) {
    printLiveModeBanner();
    await ensureServices();
    printDivider();
    console.log();
  }

  printScriptList();

  const results: { name: string; success: boolean; duration: number }[] = [];

  console.log(`${COLORS.bright}Starting demo execution...${COLORS.reset}\n`);

  if (LIVE_MODE) {
    console.log(`${COLORS.magenta}Note: Using real APIs — Hardhat :8545, Agent :5000, Guardian :3001, VDF :3000${COLORS.reset}\n`);  } else if (SEPOLIA_MODE) {
    console.log(`${COLORS.green}Note: Using real SDK SecurityMiddleware against Sepolia testnet${COLORS.reset}\n`);  } else {
    console.log(`${COLORS.gray}Note: Guardian network is shared across all scripts (DKG runs once)${COLORS.reset}\n`);
  }

  // Clear any cached network to start fresh
  clearNetworkCache();

  for (let i = 0; i < SCRIPTS.length; i++) {
    const script = SCRIPTS[i];

    printDivider();
    console.log(`\n${COLORS.bright}Running Script ${i + 1}/${SCRIPTS.length}: ${script.name}${COLORS.reset}\n`);

    const startTime = Date.now();

    try {
      await script.fn();
      const duration = Date.now() - startTime;
      results.push({ name: script.name, success: true, duration });
    } catch (error) {
      const duration = Date.now() - startTime;
      results.push({ name: script.name, success: false, duration });
      console.error(`${COLORS.red}Error in ${script.name}:${COLORS.reset}`, error);
    }

    // Pause between scripts for readability
    if (i < SCRIPTS.length - 1) {
      console.log(`\n${COLORS.gray}Continuing to next script in 2s...${COLORS.reset}\n`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  printSummary(results);

  // Final message
  console.log(`\n${COLORS.bright}Demo Complete!${COLORS.reset}`);
  console.log(`\n${COLORS.gray}Key Takeaways:${COLORS.reset}`);
  console.log(`  1. Guardian voting is MANDATORY for ALL transactions`);
  console.log(`  2. ZK proofs protect guardian vote privacy`);
  console.log(`  3. VDF time-locks activate when ML Bot flags transaction (score >= 50)`);
  console.log(`  4. VDF can be BYPASSED with guardian approval (saves 30 min)`);
  console.log(`  5. Cross-chain security is unified via FROST signatures`);
  console.log(`  6. Blacklisted addresses are blocked regardless of amount`);
  console.log();
}

// ─── Individual Script Runner ───

async function runSingleScript(index: number): Promise<void> {
  if (index < 0 || index >= SCRIPTS.length) {
    console.error(`Invalid script index. Choose 0-${SCRIPTS.length - 1}`);
    process.exit(1);
  }

  const script = SCRIPTS[index];
  console.log(`\nRunning: ${script.name}\n`);

  clearNetworkCache();

  try {
    await script.fn();
  } catch (error) {
    console.error(`Error:`, error);
    process.exit(1);
  }
}

// ─── CLI Entry Point ───

if (require.main === module) {
  // Filter out flags like --live, --fast to find the script index
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));

  if (args.length > 0) {
    // Run specific script by index (0-4)
    const index = parseInt(args[0], 10);
    runSingleScript(index).catch(console.error);
  } else {
    // Run all scripts
    runAllScripts().catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
  }
}

export { runAllScripts, runSingleScript, SCRIPTS };
