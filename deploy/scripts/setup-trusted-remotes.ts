/**
 * Setup Trusted Remotes for CrossChainMessenger, this script configures trusted remote addresses for LayerZero cross-chain messaging
 * Each chains CrossChainMessenger must know the addresses of messengers on other chains
 *
 * Usage:
 *   1. Deploy CrossChainMessenger on all chains first
 *   2. Update DEPLOYED_ADDRESSES below with actual addresses
 *   3. Run: npx hardhat run scripts/setup-trusted-remotes.ts --network <network>
 *
 * local testing
 * npx hardhat run scripts/setup-trusted-remotes.ts --network localhost
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// --- Chain Config ---

interface ChainDeployment {
  chainId: number;
  lzChainId: number;
  name: string;
  messengerAddress: string;
  registryAddress: string;
}

// Layer0 V2 endpoint ids
// https://docs.layerzero.network/v2/developers/evm/technical-reference/deployed-contracts
const LZ_CHAIN_IDS: Record<number, number> = {
  // chaindid: endpointId
  1: 30101,       // Ethereum Mainnet
  11155111: 40161, // Sepolia
  137: 30109,     // Polygon
  80002: 40267,   // Polygon Amoy
  42161: 30110,   // Arbitrum One
  421614: 40231,  // Arbitrum Sepolia
  10: 30111,      // Optimism
  11155420: 40232, // Optimism Sepolia
  8453: 30184,    // Base
  84532: 40245,   // Base Sepolia
  43114: 30106,   // Avalanche
  56: 30102,      // BSC
  31337: 31337,   // Local
};

// Load deployed addresses from file or use defaults
function loadDeployedAddresses(): ChainDeployment[] {
  const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");

  if (fs.existsSync(addressesPath)) {
    const data = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

    // For local deployment, create single-chain config
    if (data.network === "localhost") {
      return [{
        chainId: 31337,
        lzChainId: 31337,
        name: "localhost",
        messengerAddress: data.contracts.CrossChainMessenger || "",
        registryAddress: data.contracts.GuardianRegistry || "",
      }];
    }
  }

  // Default testnet addresses (update after deployment)
  return [
    {
      chainId: 11155111,
      lzChainId: 40161,
      name: "Sepolia",
      messengerAddress: "", // Update after deployment
      registryAddress: "",
    },
    {
      chainId: 80002,
      lzChainId: 40267,
      name: "Polygon Amoy",
      messengerAddress: "",
      registryAddress: "",
    },
    {
      chainId: 421614,
      lzChainId: 40231,
      name: "Arbitrum Sepolia",
      messengerAddress: "",
      registryAddress: "",
    },
    {
      chainId: 84532,
      lzChainId: 40245,
      name: "Base Sepolia",
      messengerAddress: "",
      registryAddress: "",
    },
  ];
}

// --- ABI ---

const CROSS_CHAIN_MESSENGER_ABI = [
  "function setTrustedRemote(uint16 _lzChainId, bytes calldata _path) external",
  "function getTrustedRemote(uint16 _lzChainId) external view returns (bytes memory)",
  "function setGuardianRegistry(address _guardianRegistry) external",
  "function guardianRegistry() external view returns (address)",
];

const GUARDIAN_REGISTRY_ABI = [
  "function setCrossChainMessenger(address _messenger) external",
  "function crossChainMessenger() external view returns (address)",
];

// --- Setup Functions ---

/**
 * Encode trusted remote path for LayerZero
 * Format: remoteAddress + localAddress (40 bytes total)
 */
function encodeTrustedRemote(remoteAddress: string, localAddress: string): string {
  // Remove 0x prefix and pad to 20 bytes each
  const remote = remoteAddress.toLowerCase().replace("0x", "").padStart(40, "0");
  const local = localAddress.toLowerCase().replace("0x", "").padStart(40, "0");
  return "0x" + remote + local;
}

/**
 * Setup trusted remotes for a single chain's CrossChainMessenger
 */
async function setupTrustedRemotesForChain(
  messenger: any,
  localDeployment: ChainDeployment,
  allDeployments: ChainDeployment[],
): Promise<void> {
  console.log(`\nSetting up trusted remotes for ${localDeployment.name}...`);

  for (const remote of allDeployments) {
    // Skip self
    if (remote.chainId === localDeployment.chainId) continue;

    // Skip if remote messenger not deployed
    if (!remote.messengerAddress) {
      console.log(`  ⚠️  Skipping ${remote.name}: No messenger address`);
      continue;
    }

    const trustedRemotePath = encodeTrustedRemote(
      remote.messengerAddress,
      localDeployment.messengerAddress,
    );

    console.log(`  Setting trusted remote for ${remote.name} (LZ: ${remote.lzChainId})...`);

    try {
      const tx = await messenger.setTrustedRemote(remote.lzChainId, trustedRemotePath);
      await tx.wait();
      console.log(`  ✅ ${remote.name}: ${trustedRemotePath.slice(0, 20)}...`);
    } catch (error: any) {
      console.log(`  ❌ ${remote.name}: ${error.message}`);
    }
  }
}

/**
 * Verify trusted remotes are set correctly
 */
async function verifyTrustedRemotes(
  messenger: any,
  localDeployment: ChainDeployment,
  allDeployments: ChainDeployment[],
): Promise<void> {
  console.log(`\nVerifying trusted remotes for ${localDeployment.name}...`);

  for (const remote of allDeployments) {
    if (remote.chainId === localDeployment.chainId) continue;
    if (!remote.messengerAddress) continue;

    try {
      const path = await messenger.getTrustedRemote(remote.lzChainId);
      if (path && path !== "0x") {
        console.log(`  ✅ ${remote.name}: Configured`);
      } else {
        console.log(`  ❌ ${remote.name}: Not configured`);
      }
    } catch (error) {
      console.log(`  ❌ ${remote.name}: Error reading`);
    }
  }
}

/**
 * Link CrossChainMessenger and GuardianRegistry
 */
async function linkContracts(
  deployment: ChainDeployment,
  signer: any,
): Promise<void> {
  if (!deployment.messengerAddress || !deployment.registryAddress) {
    console.log("⚠️  Skipping contract linking: Missing addresses");
    return;
  }

  console.log("\nLinking CrossChainMessenger ↔ GuardianRegistry...");

  const messenger = new ethers.Contract(
    deployment.messengerAddress,
    CROSS_CHAIN_MESSENGER_ABI,
    signer,
  );

  const registry = new ethers.Contract(
    deployment.registryAddress,
    GUARDIAN_REGISTRY_ABI,
    signer,
  );

  // Check if already linked
  try {
    const currentRegistry = await messenger.guardianRegistry();
    if (currentRegistry.toLowerCase() === deployment.registryAddress.toLowerCase()) {
      console.log("  ✅ Messenger already linked to Registry");
    } else {
      console.log("  Setting GuardianRegistry on Messenger...");
      const tx1 = await messenger.setGuardianRegistry(deployment.registryAddress);
      await tx1.wait();
      console.log("  ✅ Messenger → Registry linked");
    }
  } catch (error: any) {
    console.log(`  ⚠️  Could not link Messenger → Registry: ${error.message}`);
  }

  try {
    const currentMessenger = await registry.crossChainMessenger();
    if (currentMessenger.toLowerCase() === deployment.messengerAddress.toLowerCase()) {
      console.log("  ✅ Registry already linked to Messenger");
    } else {
      console.log("  Setting CrossChainMessenger on Registry...");
      const tx2 = await registry.setCrossChainMessenger(deployment.messengerAddress);
      await tx2.wait();
      console.log("  ✅ Registry → Messenger linked");
    }
  } catch (error: any) {
    console.log(`  ⚠️  Could not link Registry → Messenger: ${error.message}`);
  }
}

// --- Main ---

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  CrossChainMessenger Trusted Remote Setup");
  console.log("═══════════════════════════════════════════════════════════\n");

  const [signer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log(`Network: ${network.name} (Chain ID: ${chainId})`);
  console.log(`Signer: ${signer.address}\n`);

  // Load deployments
  const deployments = loadDeployedAddresses();
  const localDeployment = deployments.find(d => d.chainId === chainId);

  if (!localDeployment) {
    console.error(`❌ No deployment found for chain ${chainId}`);
    console.log("\nAvailable deployments:");
    deployments.forEach(d => console.log(`  - ${d.name} (${d.chainId})`));
    process.exit(1);
  }

  if (!localDeployment.messengerAddress) {
    console.error("❌ CrossChainMessenger not deployed on this chain");
    console.log("Run deploy-local.ts first, then update deployed-addresses.json");
    process.exit(1);
  }

  console.log(`Local CrossChainMessenger: ${localDeployment.messengerAddress}`);
  console.log(`Local GuardianRegistry: ${localDeployment.registryAddress}`);

  // Connect to messenger
  const messenger = new ethers.Contract(
    localDeployment.messengerAddress,
    CROSS_CHAIN_MESSENGER_ABI,
    signer,
  );

  // Setup trusted remotes
  await setupTrustedRemotesForChain(messenger, localDeployment, deployments);

  // Verify
  await verifyTrustedRemotes(messenger, localDeployment, deployments);

  // Link contracts
  await linkContracts(localDeployment, signer);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Setup Complete!");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Save updated config
  const outputPath = path.join(__dirname, "..", "cross-chain-config.json");
  const config = {
    updatedAt: new Date().toISOString(),
    chainId,
    lzChainId: LZ_CHAIN_IDS[chainId],
    localMessenger: localDeployment.messengerAddress,
    trustedRemotes: deployments
      .filter(d => d.chainId !== chainId && d.messengerAddress)
      .map(d => ({
        name: d.name,
        chainId: d.chainId,
        lzChainId: d.lzChainId,
        messenger: d.messengerAddress,
      })),
  };
  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
  console.log(`Configuration saved to: ${outputPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });