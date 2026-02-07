/**
 * sdk/core/ens.ts
 *
 * ENS Security Profile Module
 *
 * Enables users to store their DeFi security preferences in ENS text records.
 * Your ENS name becomes your portable, decentralized security policy.
 *
 * Text Record Keys (namespaced):
 *   - defi.guardian.threshold   : Wei amount - flag transactions above this
 *   - defi.guardian.delay       : Seconds - extra delay for flagged txs
 *   - defi.guardian.whitelist   : Comma-separated ENS names/addresses
 *   - defi.guardian.mode        : strict | normal | paranoid
 *   - defi.guardian.notify      : Webhook URL for alerts
 *
 * Example:
 *   alice.eth:
 *     defi.guardian.threshold = "10000000000000000000" (10 ETH)
 *     defi.guardian.mode = "paranoid"
 *     defi.guardian.whitelist = "uniswap.eth,aave.eth"
 *
 * Usage:
 *   const ensClient = new ENSSecurityClient(provider);
 *   const profile = await ensClient.getSecurityProfile("alice.eth");
 *   // { threshold: 10n * 10n**18n, mode: "paranoid", whitelist: ["uniswap.eth", "aave.eth"], ... }
 */

import { ethers } from 'ethers';

// ─── Constants ───

/** ENS text record key prefix */
export const ENS_KEY_PREFIX = 'defi.guardian';

/** Individual text record keys */
export const ENS_KEYS = {
  THRESHOLD: `${ENS_KEY_PREFIX}.threshold`,
  DELAY: `${ENS_KEY_PREFIX}.delay`,
  WHITELIST: `${ENS_KEY_PREFIX}.whitelist`,
  MODE: `${ENS_KEY_PREFIX}.mode`,
  NOTIFY: `${ENS_KEY_PREFIX}.notify`,
} as const;

/** Security modes */
export type SecurityMode = 'strict' | 'normal' | 'paranoid';

/** Default values when no profile is set */
export const DEFAULT_PROFILE: SecurityProfile = {
  threshold: 0n, // No threshold (disabled)
  delay: 0,
  whitelist: [],
  mode: 'normal',
  notifyUrl: undefined,
  hasProfile: false,
};

// ─── Types ───

export interface SecurityProfile {
  /** Flag transactions above this amount (in wei). 0 = disabled */
  threshold: bigint;
  /** Extra delay in seconds for flagged transactions */
  delay: number;
  /** Allowed protocols/addresses (ENS names or addresses) */
  whitelist: string[];
  /** Security mode: strict, normal, or paranoid */
  mode: SecurityMode;
  /** Optional webhook URL for alerts */
  notifyUrl?: string;
  /** Whether user has set any security profile */
  hasProfile: boolean;
}

export interface ENSClientConfig {
  /** Ethers provider with ENS support */
  provider: ethers.Provider;
  /** Optional: custom ENS registry address (for testnets) */
  ensRegistryAddress?: string;
}

// ─── ENS Public Resolver ABI (text records) ───

const RESOLVER_ABI = [
  'function text(bytes32 node, string key) view returns (string)',
  'function setText(bytes32 node, string key, string value)',
  'function addr(bytes32 node) view returns (address)',
];

const ENS_REGISTRY_ABI = [
  'function resolver(bytes32 node) view returns (address)',
  'function owner(bytes32 node) view returns (address)',
];

// ─── ENS Security Client ───

export class ENSSecurityClient {
  private provider: ethers.Provider;
  private ensRegistryAddress: string;

  constructor(config: ENSClientConfig) {
    this.provider = config.provider;
    // Mainnet ENS Registry - same address on mainnet and most testnets
    this.ensRegistryAddress = config.ensRegistryAddress || '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
  }

  // ─── Profile Read Operations ───

  /**
   * Get complete security profile from ENS text records.
   * Returns default profile if user hasn't set one.
   */
  async getSecurityProfile(ensNameOrAddress: string): Promise<SecurityProfile> {
    const ensName = await this.resolveToName(ensNameOrAddress);
    if (!ensName) {
      return { ...DEFAULT_PROFILE };
    }

    const resolver = await this.getResolver(ensName);
    if (!resolver) {
      return { ...DEFAULT_PROFILE };
    }

    // Fetch all text records in parallel
    const [thresholdStr, delayStr, whitelistStr, modeStr, notifyUrl] = await Promise.all([
      this.getTextRecord(resolver, ensName, ENS_KEYS.THRESHOLD),
      this.getTextRecord(resolver, ensName, ENS_KEYS.DELAY),
      this.getTextRecord(resolver, ensName, ENS_KEYS.WHITELIST),
      this.getTextRecord(resolver, ensName, ENS_KEYS.MODE),
      this.getTextRecord(resolver, ensName, ENS_KEYS.NOTIFY),
    ]);

    // Check if any profile data exists
    const hasProfile = !!(thresholdStr || delayStr || whitelistStr || modeStr);

    // Parse values
    const threshold = thresholdStr ? BigInt(thresholdStr) : 0n;
    const delay = delayStr ? parseInt(delayStr, 10) : 0;
    const whitelist = whitelistStr
      ? whitelistStr.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const mode = this.parseMode(modeStr);

    return {
      threshold,
      delay,
      whitelist,
      mode,
      notifyUrl: notifyUrl || undefined,
      hasProfile,
    };
  }

  /**
   * Get just the threshold setting.
   */
  async getThreshold(ensNameOrAddress: string): Promise<bigint> {
    const value = await this.getTextRecordByName(ensNameOrAddress, ENS_KEYS.THRESHOLD);
    return value ? BigInt(value) : 0n;
  }

  /**
   * Get just the whitelist.
   */
  async getWhitelist(ensNameOrAddress: string): Promise<string[]> {
    const value = await this.getTextRecordByName(ensNameOrAddress, ENS_KEYS.WHITELIST);
    if (!value) return [];
    return value.split(',').map(s => s.trim()).filter(Boolean);
  }

  /**
   * Get just the security mode.
   */
  async getMode(ensNameOrAddress: string): Promise<SecurityMode> {
    const value = await this.getTextRecordByName(ensNameOrAddress, ENS_KEYS.MODE);
    return this.parseMode(value);
  }

  /**
   * Get just the delay setting.
   */
  async getDelay(ensNameOrAddress: string): Promise<number> {
    const value = await this.getTextRecordByName(ensNameOrAddress, ENS_KEYS.DELAY);
    return value ? parseInt(value, 10) : 0;
  }

  /**
   * Check if user has any security profile set.
   */
  async hasSecurityProfile(ensNameOrAddress: string): Promise<boolean> {
    const profile = await this.getSecurityProfile(ensNameOrAddress);
    return profile.hasProfile;
  }

  // ─── Profile Write Operations ───

  /**
   * Set complete security profile.
   * Requires signer to be the ENS name owner.
   */
  async setSecurityProfile(
    ensName: string,
    profile: Partial<SecurityProfile>,
    signer: ethers.Signer,
  ): Promise<ethers.TransactionReceipt[]> {
    const resolver = await this.getResolver(ensName);
    if (!resolver) {
      throw new Error(`No resolver found for ${ensName}`);
    }

    const resolverContract = new ethers.Contract(resolver, RESOLVER_ABI, signer);
    const node = ethers.namehash(ensName);
    const receipts: ethers.TransactionReceipt[] = [];

    // Set each field that's provided
    if (profile.threshold !== undefined) {
      const tx = await resolverContract.setText(node, ENS_KEYS.THRESHOLD, profile.threshold.toString());
      receipts.push(await tx.wait());
    }

    if (profile.delay !== undefined) {
      const tx = await resolverContract.setText(node, ENS_KEYS.DELAY, profile.delay.toString());
      receipts.push(await tx.wait());
    }

    if (profile.whitelist !== undefined) {
      const tx = await resolverContract.setText(node, ENS_KEYS.WHITELIST, profile.whitelist.join(','));
      receipts.push(await tx.wait());
    }

    if (profile.mode !== undefined) {
      const tx = await resolverContract.setText(node, ENS_KEYS.MODE, profile.mode);
      receipts.push(await tx.wait());
    }

    if (profile.notifyUrl !== undefined) {
      const tx = await resolverContract.setText(node, ENS_KEYS.NOTIFY, profile.notifyUrl);
      receipts.push(await tx.wait());
    }

    return receipts;
  }

  /**
   * Set just the threshold.
   */
  async setThreshold(
    ensName: string,
    threshold: bigint,
    signer: ethers.Signer,
  ): Promise<ethers.TransactionReceipt> {
    return this.setTextRecord(ensName, ENS_KEYS.THRESHOLD, threshold.toString(), signer);
  }

  /**
   * Set just the whitelist.
   */
  async setWhitelist(
    ensName: string,
    whitelist: string[],
    signer: ethers.Signer,
  ): Promise<ethers.TransactionReceipt> {
    return this.setTextRecord(ensName, ENS_KEYS.WHITELIST, whitelist.join(','), signer);
  }

  /**
   * Set just the mode.
   */
  async setMode(
    ensName: string,
    mode: SecurityMode,
    signer: ethers.Signer,
  ): Promise<ethers.TransactionReceipt> {
    return this.setTextRecord(ensName, ENS_KEYS.MODE, mode, signer);
  }

  /**
   * Clear all security profile settings.
   */
  async clearSecurityProfile(
    ensName: string,
    signer: ethers.Signer,
  ): Promise<ethers.TransactionReceipt[]> {
    const receipts: ethers.TransactionReceipt[] = [];

    for (const key of Object.values(ENS_KEYS)) {
      try {
        const receipt = await this.setTextRecord(ensName, key, '', signer);
        receipts.push(receipt);
      } catch {
        // Ignore errors for keys that weren't set
      }
    }

    return receipts;
  }

  // ─── Resolution ───

  /**
   * Resolve ENS name to address.
   */
  async resolveAddress(ensName: string): Promise<string | null> {
    try {
      const address = await this.provider.resolveName(ensName);
      return address;
    } catch {
      return null;
    }
  }

  /**
   * Reverse lookup: address to ENS name.
   */
  async lookupName(address: string): Promise<string | null> {
    try {
      const name = await this.provider.lookupAddress(address);
      return name;
    } catch {
      return null;
    }
  }

  /**
   * Resolve input to ENS name (handles both name and address).
   */
  async resolveToName(ensNameOrAddress: string): Promise<string | null> {
    if (ensNameOrAddress.endsWith('.eth')) {
      return ensNameOrAddress;
    }

    if (ethers.isAddress(ensNameOrAddress)) {
      return this.lookupName(ensNameOrAddress);
    }

    return null;
  }

  // ─── Validation Helpers ───

  /**
   * Check if a target is in user's whitelist.
   * Resolves ENS names in whitelist to addresses for comparison.
   */
  async isWhitelisted(ensNameOrAddress: string, target: string): Promise<boolean> {
    const whitelist = await this.getWhitelist(ensNameOrAddress);
    if (whitelist.length === 0) {
      return true; // Empty whitelist = allow all
    }

    const targetLower = target.toLowerCase();
    const targetName = await this.lookupName(target);

    for (const entry of whitelist) {
      // Direct match (address or name)
      if (entry.toLowerCase() === targetLower) {
        return true;
      }

      // Check if entry is ENS name that resolves to target
      if (entry.endsWith('.eth')) {
        const resolved = await this.resolveAddress(entry);
        if (resolved && resolved.toLowerCase() === targetLower) {
          return true;
        }
      }

      // Check if target's ENS name matches entry
      if (targetName && targetName.toLowerCase() === entry.toLowerCase()) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if transaction amount exceeds user's threshold.
   */
  async exceedsThreshold(ensNameOrAddress: string, amount: bigint): Promise<boolean> {
    const threshold = await this.getThreshold(ensNameOrAddress);
    if (threshold === 0n) {
      return false; // No threshold set
    }
    return amount > threshold;
  }

  /**
   * Get effective delay for a transaction.
   * Returns user's custom delay if set, otherwise 0.
   */
  async getEffectiveDelay(ensNameOrAddress: string): Promise<number> {
    return this.getDelay(ensNameOrAddress);
  }

  // ─── Internal Helpers ───

  private async getResolver(ensName: string): Promise<string | null> {
    try {
      const registry = new ethers.Contract(
        this.ensRegistryAddress,
        ENS_REGISTRY_ABI,
        this.provider,
      );
      const node = ethers.namehash(ensName);
      const resolverAddress = await registry.resolver(node);

      if (resolverAddress === ethers.ZeroAddress) {
        return null;
      }

      return resolverAddress;
    } catch {
      return null;
    }
  }

  private async getTextRecord(
    resolverAddress: string,
    ensName: string,
    key: string,
  ): Promise<string | null> {
    try {
      const resolver = new ethers.Contract(resolverAddress, RESOLVER_ABI, this.provider);
      const node = ethers.namehash(ensName);
      const value = await resolver.text(node, key);
      return value || null;
    } catch {
      return null;
    }
  }

  private async getTextRecordByName(
    ensNameOrAddress: string,
    key: string,
  ): Promise<string | null> {
    const ensName = await this.resolveToName(ensNameOrAddress);
    if (!ensName) return null;

    const resolver = await this.getResolver(ensName);
    if (!resolver) return null;

    return this.getTextRecord(resolver, ensName, key);
  }

  private async setTextRecord(
    ensName: string,
    key: string,
    value: string,
    signer: ethers.Signer,
  ): Promise<ethers.TransactionReceipt> {
    const resolver = await this.getResolver(ensName);
    if (!resolver) {
      throw new Error(`No resolver found for ${ensName}`);
    }

    const resolverContract = new ethers.Contract(resolver, RESOLVER_ABI, signer);
    const node = ethers.namehash(ensName);
    const tx = await resolverContract.setText(node, key, value);
    return tx.wait();
  }

  private parseMode(value: string | null): SecurityMode {
    if (value === 'strict' || value === 'paranoid') {
      return value;
    }
    return 'normal';
  }
}

// ─── Factory Function ───

let defaultClient: ENSSecurityClient | null = null;

export function getENSSecurityClient(provider: ethers.Provider): ENSSecurityClient {
  if (!defaultClient) {
    defaultClient = new ENSSecurityClient({ provider });
  }
  return defaultClient;
}

export function createENSSecurityClient(config: ENSClientConfig): ENSSecurityClient {
  return new ENSSecurityClient(config);
}

// ─── Utility: Format Profile for Display ───

export function formatSecurityProfile(profile: SecurityProfile): string {
  if (!profile.hasProfile) {
    return 'No security profile set';
  }

  const lines: string[] = [];

  if (profile.threshold > 0n) {
    lines.push(`Threshold: ${ethers.formatEther(profile.threshold)} ETH`);
  }

  if (profile.delay > 0) {
    lines.push(`Extra Delay: ${profile.delay}s`);
  }

  if (profile.whitelist.length > 0) {
    lines.push(`Whitelist: ${profile.whitelist.join(', ')}`);
  }

  lines.push(`Mode: ${profile.mode}`);

  if (profile.notifyUrl) {
    lines.push(`Notify: ${profile.notifyUrl}`);
  }

  return lines.join('\n');
}