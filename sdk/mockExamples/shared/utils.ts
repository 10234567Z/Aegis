/**
 * Shared utilities for mock example scripts.
 * Provides consistent logging, formatting, and simulation helpers.
 */

import { ethers } from 'ethers';
import {
  GUARDIAN_COUNT,
  GUARDIAN_THRESHOLD,
  REJECTION_THRESHOLD,
  VOTE_VALUES,
  ML_BOT_THRESHOLD,
  VDF_ITERATIONS,
  VDF_DELAY_SECONDS,
} from '../../core/constants';

// Re-export for convenience
export { GUARDIAN_COUNT, GUARDIAN_THRESHOLD, REJECTION_THRESHOLD, VOTE_VALUES, ML_BOT_THRESHOLD, VDF_ITERATIONS, VDF_DELAY_SECONDS };

// ─── Logging Utilities ───

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

export function printHeader(title: string): void {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${COLORS.bright}${title}${COLORS.reset}`);
  console.log('='.repeat(70) + '\n');
}

export function printStep(step: number, title: string): void {
  console.log(`${COLORS.cyan}[Step ${step}]${COLORS.reset} ${COLORS.bright}${title}${COLORS.reset}`);
}

export function printSubStep(text: string): void {
  console.log(`  ${COLORS.gray}>${COLORS.reset} ${text}`);
}

export function printSuccess(text: string): void {
  console.log(`  ${COLORS.green}✓${COLORS.reset} ${text}`);
}

export function printFailure(text: string): void {
  console.log(`  ${COLORS.red}✗${COLORS.reset} ${text}`);
}

export function printInfo(text: string): void {
  console.log(`  ${COLORS.blue}ℹ${COLORS.reset} ${text}`);
}

export function printWarning(text: string): void {
  console.log(`  ${COLORS.yellow}⚠${COLORS.reset} ${text}`);
}

export function printDivider(): void {
  console.log(`${COLORS.gray}${'─'.repeat(70)}${COLORS.reset}`);
}

export function printKeyValue(key: string, value: string): void {
  console.log(`  ${COLORS.gray}${key}:${COLORS.reset} ${value}`);
}

export function printVoteResult(approve: number, reject: number, abstain: number): void {
  console.log(`  ${COLORS.green}Approve: ${approve}${COLORS.reset}  ${COLORS.red}Reject: ${reject}${COLORS.reset}  ${COLORS.gray}Abstain: ${abstain}${COLORS.reset}`);
}

export function printFinalResult(success: boolean, message: string): void {
  console.log('\n' + '─'.repeat(70));
  if (success) {
    console.log(`${COLORS.green}${COLORS.bright}  RESULT: ✓ ${message}${COLORS.reset}`);
  } else {
    console.log(`${COLORS.red}${COLORS.bright}  RESULT: ✗ ${message}${COLORS.reset}`);
  }
  console.log('─'.repeat(70) + '\n');
}

// ─── Formatting Utilities ───

export function formatEth(wei: bigint): string {
  return `${ethers.formatEther(wei)} ETH`;
}

export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatBytes32(bytes: string): string {
  return `${bytes.slice(0, 10)}...${bytes.slice(-8)}`;
}

export function formatUSD(ethAmount: bigint, ethPrice: number = 2000): string {
  const eth = Number(ethers.formatEther(ethAmount));
  const usd = eth * ethPrice;
  return `$${usd.toLocaleString()}`;
}

// ─── Transaction Helpers ───

export function generateTxHash(): string {
  return '0x' + Buffer.from(Array(32).fill(0).map(() => Math.floor(Math.random() * 256))).toString('hex');
}

export function generateProposalId(description: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(description + Date.now()));
}

export function generateAddress(): string {
  return ethers.Wallet.createRandom().address;
}

// ─── ML Bot Analysis ───

/**
 * Mock ML bot analysis result.
 * Mirrors AgentAnalysis from sdk/core/middleware.ts.
 */
export interface MockAgentAnalysis {
  score: number;        // 0-100 risk score
  flagged: boolean;     // true if score > ML_BOT_THRESHOLD (70)
  verdict: string;      // 'safe' | 'suspicious' | 'dangerous'
}

/**
 * Simulate ML bot analysis for a transaction.
 * In production, this calls the Agent API at /review.
 */
export function simulateMLBotAnalysis(params: {
  score: number;
  verdict?: string;
}): MockAgentAnalysis {
  const { score } = params;
  const flagged = score > ML_BOT_THRESHOLD;
  const verdict = params.verdict ?? (score <= 25 ? 'safe' : score <= 60 ? 'suspicious' : 'dangerous');
  return { score, flagged, verdict };
}

// ─── Threshold Checks ───

/**
 * Check if VDF is required based on ML bot flag.
 * Mirrors VDFClient.isVDFRequired() from sdk/core/VDF.ts.
 */
export function isVDFRequired(mlBotFlagged: boolean): boolean {
  return mlBotFlagged;
}

export function isApprovalReached(approveCount: number): boolean {
  return approveCount >= GUARDIAN_THRESHOLD;
}

export function isRejectionReached(rejectCount: number): boolean {
  return rejectCount >= REJECTION_THRESHOLD;
}

// ─── Mock Data Generators ───

export interface MockTransaction {
  txHash: string;
  sender: string;
  destination: string;
  amount: bigint;
  sourceChain: number;
  destChain?: number;
  data: string;
}

export function createMockTransaction(params: {
  amount: bigint;
  sourceChain?: number;
  destChain?: number;
  sender?: string;
  destination?: string;
}): MockTransaction {
  return {
    txHash: generateTxHash(),
    sender: params.sender || generateAddress(),
    destination: params.destination || generateAddress(),
    amount: params.amount,
    sourceChain: params.sourceChain || 1, // Ethereum mainnet
    destChain: params.destChain,
    data: '0x',
  };
}

// ─── Chain Info ───

export const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  56: 'BSC',
  137: 'Polygon',
  42161: 'Arbitrum',
  43114: 'Avalanche',
  8453: 'Base',
};

export function getChainName(chainId: number): string {
  return CHAIN_NAMES[chainId] || `Chain ${chainId}`;
}

// ─── Timing Utilities ───

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

// ─── Script Runner ───

export async function runScript(
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  const startTime = Date.now();

  try {
    await fn();
    const duration = Date.now() - startTime;
    console.log(`${COLORS.gray}Script completed in ${formatDuration(duration)}${COLORS.reset}\n`);
  } catch (error) {
    console.error(`${COLORS.red}Script failed:${COLORS.reset}`, error);
    process.exit(1);
  }
}
