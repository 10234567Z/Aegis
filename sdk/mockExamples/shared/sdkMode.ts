import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';
import {
  SecurityMiddleware,
  createSecurityMiddleware,
  type TransactionIntent,
  type ExecutionResult,
  type ExecutionProgress,
  type MiddlewareConfig,
} from '../../index';
import { PROTOCOL_ADDRESSES } from '../../core/constants';
import {
  printStep,
  printSubStep,
  printSuccess,
  printFailure,
  printInfo,
  printWarning,
  printDivider,
  printKeyValue,
  printFinalResult,
  formatAddress,
  formatBytes32,
  formatEth,
  formatUSD,
} from './utils';

// Load env from deploy directory (has PRIVATE_KEY, SEPOLIA_RPC_URL)
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', 'deploy', '.env') });

// ─── Types ───

export interface SDKConfig {
  middleware: SecurityMiddleware;
  provider: ethers.Provider;
  signer: ethers.Signer;
  signerAddress: string;
  chainId: number;
  networkName: string;
}

// ─── Network Detection ───

export const SEPOLIA_MODE = process.argv.includes('--sepolia');

// ─── Setup ───

/**
 * Create a real SDK SecurityMiddleware for Sepolia.
 * Uses PRIVATE_KEY and SEPOLIA_RPC_URL from deploy/.env
 */
export async function getSDKConfig(): Promise<SDKConfig> {
  const privateKey = process.env.PRIVATE_KEY;
  const rpcUrl = process.env.SEPOLIA_RPC_URL;

  if (!privateKey) {
    throw new Error('PRIVATE_KEY not set in deploy/.env');
  }
  if (!rpcUrl) {
    throw new Error('SEPOLIA_RPC_URL not set in deploy/.env');
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  const signerAddress = await signer.getAddress();
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  // Get deployed addresses for this chain
  const addresses = PROTOCOL_ADDRESSES[chainId];
  if (!addresses || !addresses.middleware || !addresses.registry) {
    throw new Error(`No deployed addresses for chain ${chainId}. Deploy contracts first.`);
  }

  // Agent and Guardian are running locally
  const agentApiUrl = process.env.AGENT_URL || 'http://localhost:5000';
  const guardianApiUrl = process.env.GUARDIAN_URL || 'http://localhost:3001';
  const vdfWorkerUrl = process.env.VDF_WORKER_URL || 'http://localhost:3000';

  const middleware = createSecurityMiddleware({
    security: {
      middlewareAddress: addresses.middleware,
      registryAddress: addresses.registry,
      chainId,
    },
    vdfWorkerUrl,
    guardianApiUrl,
    agentApiUrl,
    provider,
    signer,
  });

  return {
    middleware,
    provider,
    signer,
    signerAddress,
    chainId,
    networkName: chainId === 11155111 ? 'Sepolia' : `Chain ${chainId}`,
  };
}

/**
 * Print the SDK mode banner.
 */
export function printSDKModeBanner(config: SDKConfig): void {
  const COLORS = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
  };

  console.log();
  console.log(`${COLORS.green}${COLORS.bright}╔══════════════════════════════════════════════════════╗${COLORS.reset}`);
  console.log(`${COLORS.green}${COLORS.bright}║          SDK MODE — SecurityMiddleware          ║${COLORS.reset}`);
  console.log(`${COLORS.green}${COLORS.bright}╠══════════════════════════════════════════════════════╣${COLORS.reset}`);
  console.log(`${COLORS.green}║${COLORS.reset}  Network: ${config.networkName} (${config.chainId})                       ${COLORS.green}║${COLORS.reset}`);
  console.log(`${COLORS.green}║${COLORS.reset}  Signer: ${formatAddress(config.signerAddress)}                          ${COLORS.green}║${COLORS.reset}`);
  console.log(`${COLORS.green}║${COLORS.reset}  Using real SDK SecurityMiddleware.executeSecurely() ${COLORS.green}║${COLORS.reset}`);
  console.log(`${COLORS.green}${COLORS.bright}╚══════════════════════════════════════════════════════╝${COLORS.reset}`);
  console.log();
}

/**
 * Execute a transaction through the REAL SDK SecurityMiddleware.
 *
 * This is the single function that proves the full SDK works end-to-end:
 * 1. Pre-flight checks (isPaused, isBlacklisted) — on-chain reads
 * 2. ML Agent analysis — real HTTP to Agent API
 * 3. VDF handling — zero proof or worker
 * 4. Guardian voting — real HTTP to Guardian API
 * 5. On-chain execution — real tx to SecurityMiddleware contract
 */
export async function executeViaSDK(
  config: SDKConfig,
  intent: TransactionIntent,
  sender: string,
): Promise<ExecutionResult> {
  let stepNumber = 0;

  const onProgress = (progress: ExecutionProgress) => {
    const stageLabels: Record<string, string> = {
      'submitted': 'Submission',
      'vdf-pending': 'VDF Computation',
      'voting-pending': 'Guardian Voting',
      'ready': 'Proofs Ready',
      'executing': 'On-Chain Execution',
      'complete': 'Complete',
      'failed': 'Failed',
    };

    const stageLabel = stageLabels[progress.stage] || progress.stage;

    // Map stages to icons
    if (progress.stage === 'complete') {
      printSuccess(progress.message);
    } else if (progress.stage === 'failed') {
      printFailure(progress.message);
    } else if (progress.stage === 'ready') {
      printSuccess(progress.message);
    } else {
      printSubStep(`[${stageLabel}] ${progress.message}`);
    }

    // Show VDF status details
    if (progress.vdfStatus) {
      printKeyValue('    VDF Progress', `${progress.vdfStatus.progress}%`);
      printKeyValue('    Est. Time Left', `${progress.vdfStatus.estimatedTimeLeft}s`);
    }

    // Show vote status details
    if (progress.voteStatus) {
      printKeyValue('    Approvals', `${(progress.voteStatus as any).votes?.approve || 0}/${(progress.voteStatus as any).threshold || 7}`);
    }
  };

  printStep(stepNumber++, 'SDK SecurityMiddleware.executeSecurely()');
  printInfo(`Executing via real SDK on ${config.networkName}`);
  printKeyValue('Contract', formatAddress(PROTOCOL_ADDRESSES[config.chainId].middleware));
  printDivider();

  const result = await config.middleware.executeSecurely(intent, onProgress, sender);

  return result;
}

/**
 * Run a pre-flight status check against on-chain contracts.
 * This calls real view functions to verify the contracts are alive.
 */
export async function checkOnChainStatus(config: SDKConfig): Promise<void> {
  printStep(0, 'On-Chain Pre-Flight');
  printSubStep('Checking contract status on-chain...');

  try {
    const state = await config.middleware.getSecurityState();
    printSuccess(`Protocol active — paused: ${state.isPaused}, threshold: ${state.threshold}`);
    printKeyValue('Last Update Block', String(state.lastUpdateBlock));
  } catch (error: any) {
    printWarning(`Could not read security state: ${error.message}`);
    printInfo('This is expected if contract uses different ABI');
  }

  try {
    const isBlacklisted = await config.middleware.isBlacklisted(config.signerAddress);
    if (isBlacklisted) {
      throw new Error('Signer address is blacklisted!');
    }
    printSuccess(`Signer ${formatAddress(config.signerAddress)} is not blacklisted`);
  } catch (error: any) {
    if (error.message.includes('blacklisted!')) throw error;
    printWarning(`Could not check blacklist: ${error.message}`);
  }

  const balance = await config.provider.getBalance(config.signerAddress);
  printKeyValue('Signer Balance', formatEth(balance));

  if (balance < ethers.parseEther('0.001')) {
    throw new Error(`Insufficient balance: ${formatEth(balance)}. Need at least 0.001 ETH for gas.`);
  }

  printDivider();
}

/**
 * Build a TransactionIntent for the SDK from mock script parameters.
 */
export function buildIntent(params: {
  target: string;
  value: bigint;
  amount: bigint;
  sourceChain: number;
  destChain?: number;
  data?: string;
  type?: 'swap' | 'bridge' | 'generic';
}): TransactionIntent {
  return {
    type: params.type || (params.destChain ? 'bridge' : 'generic'),
    target: params.target,
    data: params.data || '0x',
    value: params.value,
    amount: params.amount,
    sourceChain: params.sourceChain,
    destChain: params.destChain,
  };
}
