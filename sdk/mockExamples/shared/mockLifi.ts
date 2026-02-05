/**
 * Mock LiFi responses for cross-chain demo scenarios.
 *
 * Simulates LiFi API responses without actual network calls.
 * Useful for deterministic demo flows.
 */

import { ethers } from 'ethers';
import { LIFI_DIAMOND } from '../../core/constants';
import { getChainName, generateTxHash, formatAddress } from './utils';

// ─── Types (aligned with sdk/core/lifi.ts) ───

export interface MockRoute {
  id: string;
  fromChainId: number;
  toChainId: number;
  fromToken: TokenInfo;
  toToken: TokenInfo;
  fromAmount: string;
  toAmount: string;
  steps: RouteStep[];
  tags: string[];
  insurance: { state: string; feeAmountUsd: string };
}

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  chainId: number;
  name: string;
}

export interface RouteStep {
  id: string;
  type: 'swap' | 'bridge' | 'cross';
  tool: string;
  toolDetails: { name: string; logoURI: string };
  action: {
    fromChainId: number;
    toChainId: number;
    fromToken: TokenInfo;
    toToken: TokenInfo;
    fromAmount: string;
    toAmount: string;
    slippage: number;
  };
  estimate: {
    fromAmount: string;
    toAmount: string;
    approvalAddress: string;
    gasCosts: { type: string; amount: string; token: TokenInfo }[];
    executionDuration: number;
  };
}

export interface BridgeStatus {
  status: 'PENDING' | 'DONE' | 'FAILED';
  substatus?: string;
  substatusMessage?: string;
  sending: { txHash: string; chainId: number; amount: string };
  receiving?: { txHash: string; chainId: number; amount: string };
}

// ─── Token Definitions ───

const TOKENS: Record<string, Record<number, TokenInfo>> = {
  ETH: {
    1: { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18, chainId: 1, name: 'Ethereum' },
    137: { address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', symbol: 'WETH', decimals: 18, chainId: 137, name: 'Wrapped Ether' },
    42161: { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18, chainId: 42161, name: 'Ethereum' },
  },
  USDC: {
    1: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6, chainId: 1, name: 'USD Coin' },
    137: { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', decimals: 6, chainId: 137, name: 'USD Coin' },
    42161: { address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', symbol: 'USDC', decimals: 6, chainId: 42161, name: 'USD Coin' },
  },
};

// ─── Bridge Tools ───

const BRIDGE_TOOLS = [
  { name: 'Stargate', logoURI: 'https://li.fi/logos/stargate.png' },
  { name: 'Hop', logoURI: 'https://li.fi/logos/hop.png' },
  { name: 'Across', logoURI: 'https://li.fi/logos/across.png' },
  { name: 'Connext', logoURI: 'https://li.fi/logos/connext.png' },
];

// ─── Mock Quote Generator ───

export function generateMockQuote(params: {
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: bigint;
}): MockRoute {
  const fromTokenInfo = TOKENS[params.fromToken]?.[params.fromChainId] || {
    address: '0x0000000000000000000000000000000000000000',
    symbol: params.fromToken,
    decimals: 18,
    chainId: params.fromChainId,
    name: params.fromToken,
  };

  const toTokenInfo = TOKENS[params.toToken]?.[params.toChainId] || {
    address: '0x0000000000000000000000000000000000000000',
    symbol: params.toToken,
    decimals: 18,
    chainId: params.toChainId,
    name: params.toToken,
  };

  // Simulate ~0.1% bridge fee
  const toAmount = (params.fromAmount * 999n) / 1000n;

  const bridgeTool = BRIDGE_TOOLS[Math.floor(Math.random() * BRIDGE_TOOLS.length)];

  const step: RouteStep = {
    id: `step-${Date.now()}`,
    type: 'cross',
    tool: bridgeTool.name.toLowerCase(),
    toolDetails: bridgeTool,
    action: {
      fromChainId: params.fromChainId,
      toChainId: params.toChainId,
      fromToken: fromTokenInfo,
      toToken: toTokenInfo,
      fromAmount: params.fromAmount.toString(),
      toAmount: toAmount.toString(),
      slippage: 0.005, // 0.5%
    },
    estimate: {
      fromAmount: params.fromAmount.toString(),
      toAmount: toAmount.toString(),
      approvalAddress: LIFI_DIAMOND[params.fromChainId] || LIFI_DIAMOND[1],
      gasCosts: [
        {
          type: 'SEND',
          amount: ethers.parseEther('0.005').toString(),
          token: fromTokenInfo,
        },
      ],
      executionDuration: 120, // 2 minutes estimated
    },
  };

  return {
    id: `route-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    fromChainId: params.fromChainId,
    toChainId: params.toChainId,
    fromToken: fromTokenInfo,
    toToken: toTokenInfo,
    fromAmount: params.fromAmount.toString(),
    toAmount: toAmount.toString(),
    steps: [step],
    tags: ['RECOMMENDED', 'CHEAPEST'],
    insurance: { state: 'NOT_INSURABLE', feeAmountUsd: '0' },
  };
}

// ─── Mock Transaction Builder ───

export function buildMockTransaction(route: MockRoute): {
  to: string;
  data: string;
  value: bigint;
  gasLimit: bigint;
} {
  // Generate mock calldata (would be actual LiFi Diamond calldata in production)
  const mockCalldata = ethers.solidityPacked(
    ['bytes4', 'bytes32', 'uint256', 'uint256'],
    [
      '0x12345678', // Mock function selector
      ethers.keccak256(ethers.toUtf8Bytes(route.id)),
      BigInt(route.fromAmount),
      BigInt(route.toChainId),
    ],
  );

  return {
    to: LIFI_DIAMOND[route.fromChainId] || LIFI_DIAMOND[1],
    data: mockCalldata,
    value: BigInt(route.fromAmount),
    gasLimit: 500000n,
  };
}

// ─── Mock Status Tracker ───

export interface BridgeTracker {
  txHash: string;
  route: MockRoute;
  status: BridgeStatus;
}

const pendingBridges: Map<string, BridgeTracker> = new Map();

export function initiateBridge(route: MockRoute, txHash: string): BridgeTracker {
  const tracker: BridgeTracker = {
    txHash,
    route,
    status: {
      status: 'PENDING',
      substatus: 'WAIT_SOURCE_CONFIRMATIONS',
      substatusMessage: 'Waiting for source chain confirmations',
      sending: {
        txHash,
        chainId: route.fromChainId,
        amount: route.fromAmount,
      },
    },
  };

  pendingBridges.set(txHash, tracker);
  return tracker;
}

export function completeBridge(txHash: string, success: boolean = true): BridgeTracker | null {
  const tracker = pendingBridges.get(txHash);
  if (!tracker) return null;

  if (success) {
    tracker.status = {
      status: 'DONE',
      substatus: 'COMPLETED',
      substatusMessage: 'Bridge completed successfully',
      sending: tracker.status.sending,
      receiving: {
        txHash: generateTxHash(),
        chainId: tracker.route.toChainId,
        amount: tracker.route.toAmount,
      },
    };
  } else {
    tracker.status = {
      status: 'FAILED',
      substatus: 'FAILED',
      substatusMessage: 'Bridge failed - funds will be refunded',
      sending: tracker.status.sending,
    };
  }

  return tracker;
}

export function getBridgeStatus(txHash: string): BridgeStatus | null {
  const tracker = pendingBridges.get(txHash);
  return tracker?.status || null;
}

// ─── Cross-Chain Flow Simulator ───

export interface CrossChainResult {
  route: MockRoute;
  sourceTxHash: string;
  destTxHash?: string;
  success: boolean;
  bridgeTool: string;
  estimatedDuration: number;
}

export function simulateCrossChainTransfer(params: {
  fromChainId: number;
  toChainId: number;
  amount: bigint;
  success?: boolean;
}): CrossChainResult {
  const route = generateMockQuote({
    fromChainId: params.fromChainId,
    toChainId: params.toChainId,
    fromToken: 'ETH',
    toToken: 'ETH',
    fromAmount: params.amount,
  });

  const sourceTxHash = generateTxHash();
  const success = params.success !== false;

  return {
    route,
    sourceTxHash,
    destTxHash: success ? generateTxHash() : undefined,
    success,
    bridgeTool: route.steps[0].toolDetails.name,
    estimatedDuration: route.steps[0].estimate.executionDuration,
  };
}

// ─── Logging Helpers ───

export function printRouteInfo(route: MockRoute): void {
  console.log(`  Route ID: ${route.id.slice(0, 20)}...`);
  console.log(`  From: ${getChainName(route.fromChainId)} (${route.fromToken.symbol})`);
  console.log(`  To: ${getChainName(route.toChainId)} (${route.toToken.symbol})`);
  console.log(`  Amount: ${ethers.formatEther(route.fromAmount)} ${route.fromToken.symbol}`);
  console.log(`  Receive: ${ethers.formatEther(route.toAmount)} ${route.toToken.symbol}`);
  console.log(`  Bridge: ${route.steps[0].toolDetails.name}`);
  console.log(`  Est. Duration: ${route.steps[0].estimate.executionDuration}s`);
}

// ─── Known Blacklisted Addresses (for demo) ───

export const KNOWN_EXPLOIT_ADDRESSES = [
  '0x1234567890123456789012345678901234567890', // Mock exploit address 1
  '0xDeadBeefDeadBeefDeadBeefDeadBeefDeadBeef', // Mock exploit address 2
  '0xBaDC0deBaDC0deBaDC0deBaDC0deBaDC0deBaD0', // Mock exploit address 3
];

export function isKnownExploitAddress(address: string): boolean {
  return KNOWN_EXPLOIT_ADDRESSES.some(
    (addr) => addr.toLowerCase() === address.toLowerCase(),
  );
}
