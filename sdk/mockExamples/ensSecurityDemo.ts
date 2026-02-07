/**
 * ENS Security Profile Demo
 *
 * Demonstrates how users can personalize their DeFi security
 * by storing preferences in ENS text records.
 *
 * Scenarios:
 *   1. User with no ENS profile → Default security
 *   2. User with threshold set → Flags large transactions
 *   3. User in paranoid mode → Whitelist-only access
 *   4. User with webhook → Gets notified of transactions
 *
 * Text Record Keys:
 *   - defi.guardian.threshold   : Wei amount to flag
 *   - defi.guardian.delay       : Extra delay in seconds
 *   - defi.guardian.whitelist   : Allowed protocols
 *   - defi.guardian.mode        : strict | normal | paranoid
 *   - defi.guardian.notify      : Webhook URL
 *
 * Run: npx ts-node sdk/mockExamples/ensSecurityDemo.ts
 */

import { ethers } from 'ethers';
import {
  ENSSecurityClient,
  SecurityProfile,
  formatSecurityProfile,
  ENS_KEYS,
} from '../core/ens';

// ─── Demo Configuration ───

const DEMO_USERS = {
  // User with no ENS profile
  noProfile: {
    address: '0x1234567890123456789012345678901234567890',
    ensName: null,
  },
  // User with conservative settings
  conservative: {
    address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // vitalik.eth
    ensName: 'vitalik.eth',
    mockProfile: {
      threshold: ethers.parseEther('10'),   // 10 ETH
      delay: 300,                            // 5 min extra delay
      whitelist: ['uniswap.eth', 'aave.eth'],
      mode: 'paranoid' as const,
      notifyUrl: 'https://webhook.example.com/alerts',
    },
  },
  // User with relaxed settings
  degen: {
    address: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
    ensName: 'degen.eth',
    mockProfile: {
      threshold: ethers.parseEther('1000'), // 1000 ETH
      delay: 0,
      whitelist: [],
      mode: 'normal' as const,
    },
  },
};

// ─── Mock ENS Resolver ───

class MockENSProvider {
  private profiles: Map<string, SecurityProfile> = new Map();
  private nameToAddress: Map<string, string> = new Map();
  private addressToName: Map<string, string> = new Map();

  constructor() {
    // Set up mock data
    this.setProfile('vitalik.eth', {
      threshold: ethers.parseEther('10'),
      delay: 300,
      whitelist: ['uniswap.eth', 'aave.eth'],
      mode: 'paranoid',
      notifyUrl: 'https://webhook.example.com/alerts',
      hasProfile: true,
    });

    this.setProfile('degen.eth', {
      threshold: ethers.parseEther('1000'),
      delay: 0,
      whitelist: [],
      mode: 'normal',
      hasProfile: true,
    });

    this.nameToAddress.set('vitalik.eth', DEMO_USERS.conservative.address);
    this.nameToAddress.set('degen.eth', DEMO_USERS.degen.address);
    this.nameToAddress.set('uniswap.eth', '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D');
    this.nameToAddress.set('aave.eth', '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9');

    this.addressToName.set(DEMO_USERS.conservative.address.toLowerCase(), 'vitalik.eth');
    this.addressToName.set(DEMO_USERS.degen.address.toLowerCase(), 'degen.eth');
  }

  setProfile(ensName: string, profile: SecurityProfile) {
    this.profiles.set(ensName.toLowerCase(), profile);
  }

  getProfile(ensName: string): SecurityProfile | null {
    return this.profiles.get(ensName.toLowerCase()) || null;
  }

  resolveName(name: string): string | null {
    return this.nameToAddress.get(name.toLowerCase()) || null;
  }

  lookupAddress(address: string): string | null {
    return this.addressToName.get(address.toLowerCase()) || null;
  }
}

// ─── Demo Functions ───

function printHeader(text: string) {
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${text}`);
  console.log('═'.repeat(60));
}

function printSection(text: string) {
  console.log('\n' + '─'.repeat(40));
  console.log(`  ${text}`);
  console.log('─'.repeat(40));
}

function printKeyValue(key: string, value: string) {
  console.log(`  ${key.padEnd(20)}: ${value}`);
}

function printSuccess(text: string) {
  console.log(`  ✅ ${text}`);
}

function printWarning(text: string) {
  console.log(`  ⚠️  ${text}`);
}

function printError(text: string) {
  console.log(`  ❌ ${text}`);
}

function printInfo(text: string) {
  console.log(`  ℹ️  ${text}`);
}

// ─── Scenario 1: No ENS Profile ───

async function demoNoProfile(mockProvider: MockENSProvider) {
  printSection('Scenario 1: User with No ENS Profile');

  const user = DEMO_USERS.noProfile;
  printKeyValue('Address', user.address);
  printKeyValue('ENS Name', 'None');

  // Try to get profile
  const ensName = mockProvider.lookupAddress(user.address);
  if (!ensName) {
    printInfo('No ENS name found for this address');
    printInfo('Using default security settings');
    printKeyValue('Threshold', 'Default ($100k)');
    printKeyValue('Mode', 'normal');
    printKeyValue('Whitelist', 'None (allow all)');
  }

  // Simulate transaction
  printInfo('Transaction: Swap 50 ETH on Uniswap');
  printSuccess('Transaction allowed - using default security');
}

// ─── Scenario 2: Conservative User (Paranoid Mode) ───

async function demoConservativeUser(mockProvider: MockENSProvider) {
  printSection('Scenario 2: Conservative User (Paranoid Mode)');

  const user = DEMO_USERS.conservative;
  printKeyValue('Address', user.address.slice(0, 10) + '...');
  printKeyValue('ENS Name', user.ensName!);

  // Get profile
  const profile = mockProvider.getProfile(user.ensName!);
  if (profile) {
    console.log('\n  ENS Security Profile:');
    printKeyValue('Threshold', `${ethers.formatEther(profile.threshold)} ETH`);
    printKeyValue('Mode', profile.mode);
    printKeyValue('Whitelist', profile.whitelist.join(', ') || 'None');
    printKeyValue('Extra Delay', `${profile.delay}s`);
    printKeyValue('Notify URL', profile.notifyUrl || 'None');
  }

  // Scenario 2a: Small swap on whitelisted protocol
  console.log('\n  Test 2a: Swap 5 ETH on Uniswap');
  printSuccess('Amount (5 ETH) < Threshold (10 ETH)');
  printSuccess('Uniswap is in whitelist');
  printSuccess('Transaction allowed');

  // Scenario 2b: Large swap
  console.log('\n  Test 2b: Swap 50 ETH on Uniswap');
  printWarning('Amount (50 ETH) > Threshold (10 ETH)');
  printWarning('Transaction flagged for extra review');
  printInfo('VDF time-lock triggered (30 min + 5 min delay)');
  printSuccess('Transaction allowed after delay');

  // Scenario 2c: Non-whitelisted protocol
  console.log('\n  Test 2c: Swap on SushiSwap (not whitelisted)');
  printError('SushiSwap is NOT in whitelist');
  printError('BLOCKED: Paranoid mode requires whitelisted protocols');
}

// ─── Scenario 3: Degen User (Relaxed Settings) ───

async function degenUser(mockProvider: MockENSProvider) {
  printSection('Scenario 3: Degen User (Relaxed Settings)');

  const user = DEMO_USERS.degen;
  printKeyValue('Address', user.address.slice(0, 10) + '...');
  printKeyValue('ENS Name', user.ensName!);

  // Get profile
  const profile = mockProvider.getProfile(user.ensName!);
  if (profile) {
    console.log('\n  ENS Security Profile:');
    printKeyValue('Threshold', `${ethers.formatEther(profile.threshold)} ETH`);
    printKeyValue('Mode', profile.mode);
    printKeyValue('Whitelist', profile.whitelist.length === 0 ? 'None (allow all)' : profile.whitelist.join(', '));
    printKeyValue('Extra Delay', profile.delay === 0 ? 'None' : `${profile.delay}s`);
  }

  // Scenario 3a: Large swap
  console.log('\n  Test 3a: Swap 500 ETH on any DEX');
  printSuccess('Amount (500 ETH) < Threshold (1000 ETH)');
  printSuccess('No whitelist restrictions');
  printSuccess('Transaction allowed immediately');

  // Scenario 3b: Very large swap
  console.log('\n  Test 3b: Swap 2000 ETH');
  printWarning('Amount (2000 ETH) > Threshold (1000 ETH)');
  printWarning('Transaction flagged for extra review');
  printInfo('User accepts higher risk with relaxed settings');
}

// ─── Scenario 4: Setting Up a Profile ───

async function demoSettingProfile() {
  printSection('Scenario 4: Setting Up ENS Security Profile');

  console.log('\n  How to set your security profile:\n');

  console.log('  1. Go to app.ens.domains');
  console.log('  2. Select your ENS name');
  console.log('  3. Click "Add/Edit Record"');
  console.log('  4. Add text records:\n');

  printKeyValue('Key', 'defi.guardian.threshold');
  printKeyValue('Value', '10000000000000000000  (10 ETH in wei)');
  console.log();

  printKeyValue('Key', 'defi.guardian.mode');
  printKeyValue('Value', 'paranoid  (strict | normal | paranoid)');
  console.log();

  printKeyValue('Key', 'defi.guardian.whitelist');
  printKeyValue('Value', 'uniswap.eth,aave.eth,compound.eth');
  console.log();

  printKeyValue('Key', 'defi.guardian.delay');
  printKeyValue('Value', '300  (extra 5 min delay)');
  console.log();

  printKeyValue('Key', 'defi.guardian.notify');
  printKeyValue('Value', 'https://your-webhook.com/alerts');

  console.log('\n  5. Sign the transaction to save');
  console.log('  6. Your security profile is now active across all Guardian-protected protocols!');
}

// ─── Scenario 5: Programmatic Profile Setup ───

async function demoProgrammaticSetup() {
  printSection('Scenario 5: Programmatic Profile Setup (SDK)');

  console.log('\n  Using the SDK to set your profile:\n');

  console.log(`
  import { ENSSecurityClient } from '@sackmoney/sdk';

  const ensClient = new ENSSecurityClient({ provider });

  // Set your security profile
  await ensClient.setSecurityProfile('alice.eth', {
    threshold: parseEther('10'),      // Flag swaps > 10 ETH
    delay: 300,                        // 5 min extra delay
    whitelist: ['uniswap.eth'],        // Only Uniswap allowed
    mode: 'paranoid',                  // Strict enforcement
    notifyUrl: 'https://...',          // Get alerts
  }, signer);

  // Read someone's profile
  const profile = await ensClient.getSecurityProfile('vitalik.eth');
  console.log(profile.threshold);      // 10000000000000000000n
  console.log(profile.mode);           // 'paranoid'

  // Check if target is allowed
  const allowed = await ensClient.isWhitelisted('alice.eth', uniswapAddress);
  `);
}

// ─── Main ───

async function main() {
  printHeader('ENS Security Profile Demo');
  console.log('\n  Your ENS name = Your portable DeFi security policy\n');

  const mockProvider = new MockENSProvider();

  await demoNoProfile(mockProvider);
  await demoConservativeUser(mockProvider);
  await degenUser(mockProvider);
  await demoSettingProfile();
  await demoProgrammaticSetup();

  printHeader('Summary');
  console.log(`
  ENS Security Profiles allow users to:

  ✅ Set personal transaction thresholds
  ✅ Define whitelisted protocols (paranoid mode)
  ✅ Add extra delays for large transactions
  ✅ Receive webhook notifications
  ✅ Control their own security without trusting a centralized database

  Text Record Keys:
    • defi.guardian.threshold  - Wei amount to flag
    • defi.guardian.mode       - strict | normal | paranoid
    • defi.guardian.whitelist  - Comma-separated ENS names
    • defi.guardian.delay      - Extra seconds to wait
    • defi.guardian.notify     - Webhook URL for alerts

  Integration Points:
    • SDK (middleware.ts) - Reads profile before execution
    • GuardianHook (on-chain) - Enforces on Uniswap v4 pools
    • ENSSecurityProfile.sol - On-chain profile reader
  `);

  console.log('═'.repeat(60));
  console.log('  Demo complete!');
  console.log('═'.repeat(60) + '\n');
}

// Run
main().catch(console.error);
