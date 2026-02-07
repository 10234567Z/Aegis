/**
 * sdk/core/lifi.ts
 * 
 * LI.FI Integration Module
 * 
 * Powers cross-chain swaps and bridges through LI.FI's API.
 * Handles route fetching, quote comparison, and execution.
 * 
 * Bounty Requirements:
 *   ✓ Use LI.FI's core API/SDK for cross-chain swaps/bridges
 *   ✓ Handle slippage, errors, gas estimation
 *   ✓ Reliability and UX for DeFi users
 */

import { ethers } from 'ethers';
import {
  LIFI_API_URL,
  LIFI_INTEGRATOR_ID,
  NATIVE_TOKEN as NATIVE_TOKEN_CONST,
  LIFI_DIAMOND as LIFI_DIAMOND_CONST,
} from './constants';

// Re-export for external use
export const NATIVE_TOKEN = NATIVE_TOKEN_CONST;
export const LIFI_DIAMOND = LIFI_DIAMOND_CONST;

// ─── Types ───

export interface LiFiConfig {
  apiUrl: string;
  apiKey?: string;              // Optional API key for higher rate limits
  integratorId: string;         // Your integrator ID from LI.FI
}

export interface ChainInfo {
  chainId: number;
  name: string;
  nativeCurrency: string;
  rpcUrl: string;
}

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  chainId: number;
  name: string;
  logoURI?: string;
  priceUSD?: string;
}

export interface QuoteRequest {
  fromChain: number;
  toChain: number;
  fromToken: string;            // Token address (use 0x0 for native)
  toToken: string;
  fromAmount: string;           // Amount in wei
  fromAddress: string;          // Sender address
  toAddress?: string;           // Recipient (defaults to fromAddress)
  slippage?: number;            // 0.01 = 1% (default: 0.5%)
  allowBridges?: string[];      // Filter bridges (e.g., ['stargate', 'hop'])
  allowExchanges?: string[];    // Filter DEXs
}

export interface Route {
  id: string;
  fromChainId: number;
  toChainId: number;
  fromToken: TokenInfo;
  toToken: TokenInfo;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;          // Minimum after slippage
  steps: RouteStep[];
  gasCostUSD: string;
  executionDuration: number;    // Estimated seconds
  tags: string[];               // e.g., ['FASTEST', 'CHEAPEST']
}

export interface RouteStep {
  type: 'swap' | 'bridge' | 'protocol';
  tool: string;                 // e.g., 'uniswap', 'stargate'
  toolDetails: {
    name: string;
    logoURI: string;
  };
  action: {
    fromChainId: number;
    toChainId: number;
    fromToken: TokenInfo;
    toToken: TokenInfo;
    fromAmount: string;
    toAmount: string;
  };
  estimate: {
    fromAmount: string;
    toAmount: string;
    toAmountMin: string;
    gasCosts: GasCost[];
    executionDuration: number;
  };
}

export interface GasCost {
  type: string;
  estimate: string;
  limit: string;
  amount: string;
  amountUSD: string;
  token: TokenInfo;
}

export interface TransactionRequest {
  to: string;                   // LI.FI Diamond contract
  data: string;                 // Calldata
  value: string;                // Native token value
  gasLimit: string;
  gasPrice?: string;
  chainId: number;
}

export interface ExecutionStatus {
  status: 'PENDING' | 'DONE' | 'FAILED' | 'NOT_FOUND';
  substatus?: string;
  txHash?: string;
  txLink?: string;
  receiving?: {
    chainId: number;
    txHash: string;
    amount: string;
    token: TokenInfo;
  };
  error?: {
    message: string;
    code: string;
  };
}

// ─── Constants ───

const DEFAULT_CONFIG: LiFiConfig = {
  apiUrl: LIFI_API_URL,
  integratorId: LIFI_INTEGRATOR_ID,
};

// ─── LI.FI Client ───

export class LiFiClient {
  private config: LiFiConfig;

  constructor(config: Partial<LiFiConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Route Fetching ───

  /**
   * Get available routes for a cross-chain transfer.
   * Returns multiple options sorted by recommendation.
   */
  async getRoutes(request: QuoteRequest): Promise<Route[]> {
    const params = new URLSearchParams({
      fromChain: request.fromChain.toString(),
      toChain: request.toChain.toString(),
      fromToken: request.fromToken,
      toToken: request.toToken,
      fromAmount: request.fromAmount,
      fromAddress: request.fromAddress,
      toAddress: request.toAddress || request.fromAddress,
      slippage: (request.slippage || 0.005).toString(),
      integrator: this.config.integratorId,
    });

    if (request.allowBridges?.length) {
      params.set('allowBridges', request.allowBridges.join(','));
    }
    if (request.allowExchanges?.length) {
      params.set('allowExchanges', request.allowExchanges.join(','));
    }

    const response = await this.fetch(`/routes?${params}`);
    
    if (!response.routes || response.routes.length === 0) {
      throw new LiFiError('NO_ROUTES', 'No routes found for this transfer');
    }

    return response.routes;
  }

  /**
   * Get a single best quote (fastest + cheapest balance).
   */
  async getQuote(request: QuoteRequest): Promise<Route> {
    const params = new URLSearchParams({
      fromChain: request.fromChain.toString(),
      toChain: request.toChain.toString(),
      fromToken: request.fromToken,
      toToken: request.toToken,
      fromAmount: request.fromAmount,
      fromAddress: request.fromAddress,
      toAddress: request.toAddress || request.fromAddress,
      slippage: (request.slippage || 0.005).toString(),
      integrator: this.config.integratorId,
    });

    const response = await this.fetch(`/quote?${params}`);
    return response;
  }

  // ─── Transaction Building ───

  /**
   * Build transaction data for a specific route.
   * Returns ready-to-sign transaction.
   */
  async buildTransaction(route: Route): Promise<TransactionRequest> {
    const response = await this.fetch('/quote/contractCall', {
      method: 'POST',
      body: JSON.stringify({ route }),
    });

    return {
      to: response.transactionRequest.to,
      data: response.transactionRequest.data,
      value: response.transactionRequest.value || '0',
      gasLimit: response.transactionRequest.gasLimit,
      gasPrice: response.transactionRequest.gasPrice,
      chainId: route.fromChainId,
    };
  }

  /**
   * Get step transaction for multi-step routes.
   */
  async getStepTransaction(step: RouteStep): Promise<TransactionRequest> {
    const response = await this.fetch('/step/transaction', {
      method: 'POST',
      body: JSON.stringify({ step }),
    });

    return response.transactionRequest;
  }

  // ─── Execution Status ───

  /**
   * Check status of a cross-chain transfer.
   * Poll this after sending transaction.
   */
  async getStatus(txHash: string, fromChain: number, toChain: number): Promise<ExecutionStatus> {
    const params = new URLSearchParams({
      txHash,
      fromChain: fromChain.toString(),
      toChain: toChain.toString(),
    });

    const response = await this.fetch(`/status?${params}`);
    return response;
  }

  /**
   * Wait for cross-chain transfer to complete.
   * Polls status until DONE or FAILED.
   */
  async waitForCompletion(
    txHash: string,
    fromChain: number,
    toChain: number,
    onUpdate?: (status: ExecutionStatus) => void,
    timeout: number = 600000, // 10 minutes
  ): Promise<ExecutionStatus> {
    const startTime = Date.now();
    const pollInterval = 5000; // 5 seconds

    while (true) {
      const status = await this.getStatus(txHash, fromChain, toChain);

      if (onUpdate) {
        onUpdate(status);
      }

      if (status.status === 'DONE' || status.status === 'FAILED') {
        return status;
      }

      if (Date.now() - startTime > timeout) {
        throw new LiFiError('TIMEOUT', 'Transfer timeout - check explorer manually');
      }

      await this.sleep(pollInterval);
    }
  }

  // ─── Chain & Token Info ───

  /**
   * Get supported chains.
   */
  async getChains(): Promise<ChainInfo[]> {
    const response = await this.fetch('/chains');
    return response.chains;
  }

  /**
   * Get supported tokens for a chain.
   */
  async getTokens(chainId: number): Promise<TokenInfo[]> {
    const response = await this.fetch(`/tokens?chains=${chainId}`);
    return response.tokens[chainId] || [];
  }

  /**
   * Get token info by address.
   */
  async getToken(chainId: number, tokenAddress: string): Promise<TokenInfo> {
    const response = await this.fetch(`/token?chain=${chainId}&token=${tokenAddress}`);
    return response;
  }

  // ─── Gas Estimation ───

  /**
   * Estimate gas for a route.
   */
  async estimateGas(route: Route): Promise<{ gasLimit: string; gasCostUSD: string }> {
    const tx = await this.buildTransaction(route);
    return {
      gasLimit: tx.gasLimit,
      gasCostUSD: route.gasCostUSD,
    };
  }

  // ─── Helpers ───

  /**
   * Check if transfer is cross-chain.
   */
  isCrossChain(fromChain: number, toChain: number): boolean {
    return fromChain !== toChain;
  }

  /**
   * Get LI.FI Diamond address for a chain.
   */
  getDiamondAddress(chainId: number): string {
    const address = LIFI_DIAMOND[chainId];
    if (!address) {
      throw new LiFiError('UNSUPPORTED_CHAIN', `Chain ${chainId} not supported`);
    }
    return address;
  }

  /**
   * Format amount for display.
   */
  formatAmount(amount: string, decimals: number): string {
    return ethers.formatUnits(amount, decimals);
  }

  /**
   * Parse amount to wei.
   */
  parseAmount(amount: string, decimals: number): string {
    return ethers.parseUnits(amount, decimals).toString();
  }

  // ─── Internal ───

  private async fetch(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.config.apiUrl}${endpoint}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (this.config.apiKey) {
      headers['x-lifi-api-key'] = this.config.apiKey;
    }

    const response = await fetch(url, {
      ...options,
      headers: { ...headers, ...options.headers },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { code?: string; message?: string };
      throw new LiFiError(
        error.code || 'API_ERROR',
        error.message || `LI.FI API error: ${response.statusText}`,
      );
    }

    return response.json();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ─── Error Class ───

export class LiFiError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'LiFiError';
    this.code = code;
  }
}

// ─── Singleton Export ───

let defaultClient: LiFiClient | null = null;

export function getLiFiClient(config?: Partial<LiFiConfig>): LiFiClient {
  if (!defaultClient || config) {
    defaultClient = new LiFiClient(config);
  }
  return defaultClient;
}

// ─── Helper: Quick Quote ───

/**
 * Quick helper to get a quote and build transaction.
 */
export async function getQuickQuote(
  fromChain: number,
  toChain: number,
  fromToken: string,
  toToken: string,
  amount: string,
  fromAddress: string,
  slippage: number = 0.005,
): Promise<{ route: Route; tx: TransactionRequest }> {
  const client = getLiFiClient();

  const route = await client.getQuote({
    fromChain,
    toChain,
    fromToken,
    toToken,
    fromAmount: amount,
    fromAddress,
    slippage,
  });

  const tx = await client.buildTransaction(route);

  return { route, tx };
}
