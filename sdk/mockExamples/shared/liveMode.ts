/**
 * Live Mode Infrastructure Management
 *
 * Checks and manages the services required for --live mode:
 *   - Hardhat Node (port 8545) — local blockchain
 *   - ML Agent (port 5000) — fraud detection
 *   - Guardian Mock (port 3001) — voting simulation
 *   - VDF Worker (port 3000) — time-lock computation
 *
 * Also handles auto-deployment of contracts if not yet deployed.
 */

import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { printSuccess, printFailure, printInfo, printWarning } from './utils';

// ─── Constants ───

// LIVE_MODE is exported from utils.ts (canonical source)

const HARDHAT_URL = 'http://127.0.0.1:8545';
const AGENT_URL = 'http://127.0.0.1:5000';
const GUARDIAN_URL = 'http://127.0.0.1:3001';
const VDF_WORKER_URL = 'http://127.0.0.1:3000';

const CHAIN_ID = 31337;

// Relative from sdk/mockExamples/shared/ to deploy/
const DEPLOY_DIR = path.resolve(__dirname, '..', '..', '..', 'deploy');
const DEPLOYED_ADDRESSES_PATH = path.join(DEPLOY_DIR, 'deployed-addresses.json');

// ─── Types ───

export interface LiveConfig {
  provider: ethers.JsonRpcProvider;
  signer: ethers.Signer;
  signerAddress: string;
  middlewareAddress: string;
  registryAddress: string;
  agentApiUrl: string;
  guardianApiUrl: string;
  vdfWorkerUrl: string;
  chainId: number;
}

interface DeployedAddresses {
  network: string;
  chainId: number;
  contracts: {
    VDFVerifier: string;
    Groth16Verifier: string;
    FROSTVerifier: string;
    ZKVoteVerifier: string;
    GuardianRegistry: string;
    SecurityMiddleware: string;
  };
}

interface ServiceCheck {
  name: string;
  url: string;
  healthEndpoint: string;
  isJsonRpc?: boolean;
}

const SERVICES: ServiceCheck[] = [
  { name: 'Hardhat Node', url: HARDHAT_URL, healthEndpoint: HARDHAT_URL, isJsonRpc: true },
  { name: 'ML Agent', url: AGENT_URL, healthEndpoint: `${AGENT_URL}/health` },
  { name: 'Guardian Mock', url: GUARDIAN_URL, healthEndpoint: `${GUARDIAN_URL}/health` },
  { name: 'VDF Worker', url: VDF_WORKER_URL, healthEndpoint: `${VDF_WORKER_URL}/health` },
];

// ─── Health Checks ───

/**
 * Check if a service is healthy by hitting its health endpoint.
 */
async function checkServiceHealth(service: ServiceCheck): Promise<boolean> {
  try {
    if (service.isJsonRpc) {
      // Hardhat node uses JSON-RPC, not REST
      const response = await fetch(service.healthEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    }

    const response = await fetch(service.healthEndpoint, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Verify all required services are running.
 * Throws if any service is down.
 */
export async function ensureServices(): Promise<void> {
  console.log();
  printInfo('Checking live infrastructure...');

  const results: { name: string; healthy: boolean }[] = [];

  for (const service of SERVICES) {
    const healthy = await checkServiceHealth(service);
    results.push({ name: service.name, healthy });

    if (healthy) {
      printSuccess(`${service.name} — running (${service.url})`);
    } else {
      printFailure(`${service.name} — NOT RUNNING (${service.url})`);
    }
  }

  const failedServices = results.filter(r => !r.healthy);

  if (failedServices.length > 0) {
    console.log();
    printWarning('Some services are not running. Start them with:');
    printInfo('  cd deploy && ./scripts/start-local.sh');
    printInfo('  cd lib/vdf-worker && npm run dev');
    console.log();
    throw new Error(
      `Live mode requires all services. Missing: ${failedServices.map(s => s.name).join(', ')}`,
    );
  }

  printSuccess('All services healthy');
  console.log();
}

// ─── Contract Deployment ───

/**
 * Read deployed contract addresses from the deploy directory.
 */
function readDeployedAddresses(): DeployedAddresses | null {
  try {
    if (!fs.existsSync(DEPLOYED_ADDRESSES_PATH)) {
      return null;
    }
    const content = fs.readFileSync(DEPLOYED_ADDRESSES_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Deploy contracts to the local Hardhat node.
 * Uses the existing deploy-local.ts script via npx hardhat.
 */
function deployContracts(): DeployedAddresses {
  printInfo('Deploying contracts to local Hardhat node...');

  try {
    execFileSync('npx', ['hardhat', 'run', 'scripts/deploy-local.ts', '--network', 'localhost'], {
      cwd: DEPLOY_DIR,
      stdio: 'pipe',
      timeout: 60000,
    });
  } catch (error: any) {
    const stderr = error.stderr?.toString() || '';
    const stdout = error.stdout?.toString() || '';
    throw new Error(`Contract deployment failed:\n${stderr || stdout}`);
  }

  const addresses = readDeployedAddresses();
  if (!addresses) {
    throw new Error('Deployment succeeded but deployed-addresses.json not found');
  }

  return addresses;
}

/**
 * Ensure contracts are deployed. Auto-deploys if needed.
 * Returns contract addresses.
 */
export async function ensureContracts(
  provider: ethers.JsonRpcProvider,
): Promise<{ middlewareAddress: string; registryAddress: string }> {
  // Try to read existing addresses
  let addresses = readDeployedAddresses();

  if (addresses) {
    // Verify contract is actually deployed (has bytecode)
    const code = await provider.getCode(addresses.contracts.SecurityMiddleware);
    if (code !== '0x') {
      printSuccess(`Contracts deployed at SecurityMiddleware: ${addresses.contracts.SecurityMiddleware}`);
      return {
        middlewareAddress: addresses.contracts.SecurityMiddleware,
        registryAddress: addresses.contracts.GuardianRegistry,
      };
    }
    printWarning('Contracts found in addresses file but not on-chain (node may have restarted)');
  }

  // Need to deploy
  printWarning('Contracts not deployed. Auto-deploying...');
  addresses = deployContracts();

  printSuccess(`Contracts deployed successfully`);
  printInfo(`  SecurityMiddleware: ${addresses.contracts.SecurityMiddleware}`);
  printInfo(`  GuardianRegistry:  ${addresses.contracts.GuardianRegistry}`);

  return {
    middlewareAddress: addresses.contracts.SecurityMiddleware,
    registryAddress: addresses.contracts.GuardianRegistry,
  };
}

// ─── Configuration ───

/**
 * Build complete live mode configuration.
 * Connects to Hardhat node, gets signer, and resolves contract addresses.
 */
export async function getLiveConfig(): Promise<LiveConfig> {
  const provider = new ethers.JsonRpcProvider(HARDHAT_URL);

  // Use Hardhat's first default account
  const signer = await provider.getSigner(0);
  const signerAddress = await signer.getAddress();

  const { middlewareAddress, registryAddress } = await ensureContracts(provider);

  return {
    provider,
    signer,
    signerAddress,
    middlewareAddress,
    registryAddress,
    agentApiUrl: AGENT_URL,
    guardianApiUrl: GUARDIAN_URL,
    vdfWorkerUrl: VDF_WORKER_URL,
    chainId: CHAIN_ID,
  };
}

// ─── Banner ───

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  magenta: '\x1b[35m',
};

export function printLiveModeBanner(): void {
  console.log();
  console.log(`${COLORS.magenta}${COLORS.bright}╔══════════════════════════════════════════════════════╗${COLORS.reset}`);
  console.log(`${COLORS.magenta}${COLORS.bright}║            LIVE MODE — Real Infrastructure           ║${COLORS.reset}`);
  console.log(`${COLORS.magenta}${COLORS.bright}╠══════════════════════════════════════════════════════╣${COLORS.reset}`);
  console.log(`${COLORS.magenta}║${COLORS.reset}  Using real APIs, real contracts, real FROST signing  ${COLORS.magenta}║${COLORS.reset}`);
  console.log(`${COLORS.magenta}║${COLORS.reset}  Hardhat :8545 | Agent :5000 | Guardian :3001        ${COLORS.magenta}║${COLORS.reset}`);
  console.log(`${COLORS.magenta}║${COLORS.reset}  VDF Worker :3000 | Chain ID: 31337                  ${COLORS.magenta}║${COLORS.reset}`);
  console.log(`${COLORS.magenta}${COLORS.bright}╚══════════════════════════════════════════════════════╝${COLORS.reset}`);
  console.log();
}
