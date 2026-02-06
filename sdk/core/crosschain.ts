/**
 * sdk/core/crosschain.ts
 *
 * Cross-Chain Security Sync Module
 *
 * Handles propagation of security events across all chains.
 * Uses LayerZero for messaging with FROST signature verification.
 *
 * Flow:
 *   1. Detection on Chain A → SecurityEvent created
 *   2. Guardians vote (ZK) → FROST signature generated
 *   3. Broadcaster sends via LayerZero to all target chains
 *   4. Each chain verifies FROST sig → executes action
 *   5. Confirmation stage → retry if needed
 *
 * Event Types:
 *   - EMERGENCY_PAUSE: Pause protocol on all chains
 *   - BLACKLIST: Block address across chains
 *   - THRESHOLD_UP: Increase tx threshold
 *   - MONITOR: Alert without action
 */

import { ethers } from 'ethers';
import { FrostSignature } from './contract';

// ─── Security Event Types ───

export type SecurityEventType =
  | 'EMERGENCY_PAUSE'
  | 'BLACKLIST'
  | 'THRESHOLD_UP'
  | 'MONITOR'
  | 'UNPAUSE'
  | 'UNBLACKLIST';

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface SecurityEvent {
  eventId: string;              // Unique hash (prevents replays)
  sourceChainId: number;        // Where attack was detected
  eventType: SecurityEventType;
  severity: Severity;
  targetChains: number[];       // Which chains should act
  actionParameters: ActionParameters;
  timestamp: number;            // When event was created
  expiryTime: number;           // When this event expires
  guardianSignature: FrostSignature; // FROST signature (7/10 approval)
  evidenceHash: string;         // Merkle root linking to incident data
}

export interface ActionParameters {
  pauseDuration?: number;       // For EMERGENCY_PAUSE (seconds)
  addressToBlacklist?: string;  // For BLACKLIST
  newThreshold?: number;        // For THRESHOLD_UP
  affectedProtocols?: string[]; // Protocol addresses affected
  metadata?: Record<string, any>;
}

export interface PropagationStatus {
  chainId: number;
  chainName: string;
  delivered: boolean;
  confirmed: boolean;
  txHash?: string;
  error?: string;
  retrying: boolean;
  retryCount: number;
}

export interface EventPropagationResult {
  eventId: string;
  overallStatus: 'PENDING' | 'PARTIAL' | 'COMPLETE' | 'FAILED';
  chains: PropagationStatus[];
  completedAt?: number;
}

// ─── Chain Configuration ───

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  layerZeroEndpoint: string;    // LayerZero endpoint address
  guardianRegistry: string;     // GuardianRegistry contract address
  confirmations: number;        // Required confirmations
}

export const SUPPORTED_CHAINS: ChainConfig[] = [
  {
    chainId: 1,
    name: 'Ethereum',
    rpcUrl: '',
    layerZeroEndpoint: '0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675',
    guardianRegistry: '',
    confirmations: 2,
  },
  {
    chainId: 137,
    name: 'Polygon',
    rpcUrl: '',
    layerZeroEndpoint: '0x3c2269811836af69497E5F486A85D7316753cf62',
    guardianRegistry: '',
    confirmations: 5,
  },
  {
    chainId: 42161,
    name: 'Arbitrum',
    rpcUrl: '',
    layerZeroEndpoint: '0x3c2269811836af69497E5F486A85D7316753cf62',
    guardianRegistry: '',
    confirmations: 1,
  },
  {
    chainId: 10,
    name: 'Optimism',
    rpcUrl: '',
    layerZeroEndpoint: '0x3c2269811836af69497E5F486A85D7316753cf62',
    guardianRegistry: '',
    confirmations: 1,
  },
  {
    chainId: 8453,
    name: 'Base',
    rpcUrl: '',
    layerZeroEndpoint: '0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7',
    guardianRegistry: '',
    confirmations: 1,
  },
];

// ─── Security Event Encoder ───

export class SecurityEventEncoder {
  /**
   * Generate unique event ID from event data
   */
  static generateEventId(
    sourceChainId: number,
    eventType: SecurityEventType,
    timestamp: number,
    nonce: number,
  ): string {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'string', 'uint256', 'uint256'],
        [sourceChainId, eventType, timestamp, nonce],
      ),
    );
  }

  /**
   * Encode SecurityEvent for LayerZero transmission
   */
  static encode(event: SecurityEvent): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      [
        'bytes32',   // eventId
        'uint256',   // sourceChainId
        'uint8',     // eventType (enum index)
        'uint8',     // severity (enum index)
        'uint256[]', // targetChains
        'bytes',     // actionParameters (encoded)
        'uint256',   // timestamp
        'uint256',   // expiryTime
        'bytes',     // guardianSignature
        'bytes32',   // evidenceHash
      ],
      [
        event.eventId,
        event.sourceChainId,
        this.eventTypeToIndex(event.eventType),
        this.severityToIndex(event.severity),
        event.targetChains,
        this.encodeActionParameters(event.actionParameters),
        event.timestamp,
        event.expiryTime,
        this.encodeSignature(event.guardianSignature),
        event.evidenceHash,
      ],
    );
  }

  /**
   * Decode SecurityEvent from LayerZero payload
   */
  static decode(encoded: string): SecurityEvent {
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      [
        'bytes32',   // eventId
        'uint256',   // sourceChainId
        'uint8',     // eventType
        'uint8',     // severity
        'uint256[]', // targetChains
        'bytes',     // actionParameters
        'uint256',   // timestamp
        'uint256',   // expiryTime
        'bytes',     // guardianSignature
        'bytes32',   // evidenceHash
      ],
      encoded,
    );

    return {
      eventId: decoded[0],
      sourceChainId: Number(decoded[1]),
      eventType: this.indexToEventType(decoded[2]),
      severity: this.indexToSeverity(decoded[3]),
      targetChains: decoded[4].map((n: bigint) => Number(n)),
      actionParameters: this.decodeActionParameters(decoded[5]),
      timestamp: Number(decoded[6]),
      expiryTime: Number(decoded[7]),
      guardianSignature: this.decodeSignature(decoded[8]),
      evidenceHash: decoded[9],
    };
  }

  /**
   * Create message hash for FROST signing
   */
  static createMessageHash(event: Omit<SecurityEvent, 'guardianSignature'>): string {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        [
          'bytes32',
          'uint256',
          'string',
          'string',
          'uint256[]',
          'bytes',
          'uint256',
          'uint256',
          'bytes32',
        ],
        [
          event.eventId,
          event.sourceChainId,
          event.eventType,
          event.severity,
          event.targetChains,
          this.encodeActionParameters(event.actionParameters),
          event.timestamp,
          event.expiryTime,
          event.evidenceHash,
        ],
      ),
    );
  }

  // ─── Helper Methods ───

  private static eventTypeToIndex(type: SecurityEventType): number {
    const types: SecurityEventType[] = [
      'EMERGENCY_PAUSE', 'BLACKLIST', 'THRESHOLD_UP', 'MONITOR', 'UNPAUSE', 'UNBLACKLIST',
    ];
    return types.indexOf(type);
  }

  private static indexToEventType(index: number): SecurityEventType {
    const types: SecurityEventType[] = [
      'EMERGENCY_PAUSE', 'BLACKLIST', 'THRESHOLD_UP', 'MONITOR', 'UNPAUSE', 'UNBLACKLIST',
    ];
    return types[index] || 'MONITOR';
  }

  private static severityToIndex(severity: Severity): number {
    const severities: Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    return severities.indexOf(severity);
  }

  private static indexToSeverity(index: number): Severity {
    const severities: Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    return severities[index] || 'LOW';
  }

  private static encodeActionParameters(params: ActionParameters): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'address', 'uint256', 'address[]', 'bytes'],
      [
        params.pauseDuration || 0,
        params.addressToBlacklist || ethers.ZeroAddress,
        params.newThreshold || 0,
        params.affectedProtocols || [],
        params.metadata ? ethers.toUtf8Bytes(JSON.stringify(params.metadata)) : '0x',
      ],
    );
  }

  private static decodeActionParameters(encoded: string): ActionParameters {
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'address', 'uint256', 'address[]', 'bytes'],
      encoded,
    );

    let metadata: Record<string, any> | undefined;
    if (decoded[4] && decoded[4] !== '0x') {
      try {
        metadata = JSON.parse(ethers.toUtf8String(decoded[4]));
      } catch {
        metadata = undefined;
      }
    }

    return {
      pauseDuration: Number(decoded[0]) || undefined,
      addressToBlacklist: decoded[1] !== ethers.ZeroAddress ? decoded[1] : undefined,
      newThreshold: Number(decoded[2]) || undefined,
      affectedProtocols: decoded[3].length > 0 ? decoded[3] : undefined,
      metadata,
    };
  }

  private static encodeSignature(sig: FrostSignature): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes', 'bytes32', 'bytes'],
      [sig.signature, sig.message, sig.publicKey],
    );
  }

  private static decodeSignature(encoded: string): FrostSignature {
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      ['bytes', 'bytes32', 'bytes'],
      encoded,
    );
    return {
      signature: decoded[0],
      message: decoded[1],
      publicKey: decoded[2],
    };
  }
}

// ─── Cross-Chain Broadcaster ───

export interface BroadcasterConfig {
  providers: Map<number, ethers.Provider>;
  signers: Map<number, ethers.Signer>;
  retryAttempts: number;
  retryDelayMs: number;
}

export class CrossChainBroadcaster {
  private config: BroadcasterConfig;
  private pendingEvents: Map<string, EventPropagationResult> = new Map();

  constructor(config: Partial<BroadcasterConfig> = {}) {
    this.config = {
      providers: config.providers || new Map(),
      signers: config.signers || new Map(),
      retryAttempts: config.retryAttempts || 3,
      retryDelayMs: config.retryDelayMs || 60000, // 60 seconds
    };
  }

  /**
   * Broadcast a security event to all target chains
   */
  async broadcast(event: SecurityEvent): Promise<EventPropagationResult> {
    console.log(`[Broadcaster] Broadcasting event ${event.eventId.slice(0, 10)}...`);
    console.log(`  Type: ${event.eventType}, Severity: ${event.severity}`);
    console.log(`  Target chains: ${event.targetChains.join(', ')}`);

    const result: EventPropagationResult = {
      eventId: event.eventId,
      overallStatus: 'PENDING',
      chains: event.targetChains.map(chainId => {
        const chain = SUPPORTED_CHAINS.find(c => c.chainId === chainId);
        return {
          chainId,
          chainName: chain?.name || `Chain ${chainId}`,
          delivered: false,
          confirmed: false,
          retrying: false,
          retryCount: 0,
        };
      }),
    };

    this.pendingEvents.set(event.eventId, result);

    // Send to all chains in parallel
    const encoded = SecurityEventEncoder.encode(event);

    await Promise.all(
      result.chains.map(async (chainStatus) => {
        await this.sendToChain(chainStatus, encoded, event);
      }),
    );

    // Update overall status
    this.updateOverallStatus(result);

    return result;
  }

  /**
   * Get propagation status for an event
   */
  getStatus(eventId: string): EventPropagationResult | undefined {
    return this.pendingEvents.get(eventId);
  }

  /**
   * Retry failed chains for an event
   */
  async retryFailed(eventId: string, event: SecurityEvent): Promise<EventPropagationResult> {
    const result = this.pendingEvents.get(eventId);
    if (!result) {
      throw new Error(`Event ${eventId} not found`);
    }

    const encoded = SecurityEventEncoder.encode(event);
    const failedChains = result.chains.filter(c => !c.delivered && !c.retrying);

    await Promise.all(
      failedChains.map(async (chainStatus) => {
        chainStatus.retrying = true;
        chainStatus.retryCount++;
        await this.sendToChain(chainStatus, encoded, event);
      }),
    );

    this.updateOverallStatus(result);
    return result;
  }

  // ─── Private Methods ───

  private async sendToChain(
    chainStatus: PropagationStatus,
    encoded: string,
    event: SecurityEvent,
  ): Promise<void> {
    try {
      const chainConfig = SUPPORTED_CHAINS.find(c => c.chainId === chainStatus.chainId);
      if (!chainConfig) {
        chainStatus.error = 'Unsupported chain';
        return;
      }

      const signer = this.config.signers.get(chainStatus.chainId);
      if (!signer) {
        chainStatus.error = 'No signer configured for chain';
        return;
      }

      // Build LayerZero send transaction
      const lzEndpointAbi = [
        'function send(uint16 _dstChainId, bytes calldata _destination, bytes calldata _payload, address payable _refundAddress, address _zroPaymentAddress, bytes calldata _adapterParams) external payable',
      ];

      const lzEndpoint = new ethers.Contract(
        chainConfig.layerZeroEndpoint,
        lzEndpointAbi,
        signer,
      );

      // Get LayerZero chain ID (different from EVM chain ID)
      const lzChainId = this.evmToLayerZeroChainId(chainStatus.chainId);

      // Encode destination (GuardianRegistry on target chain)
      const destination = ethers.solidityPacked(
        ['address'],
        [chainConfig.guardianRegistry],
      );

      // Adapter params (default gas limit)
      const adapterParams = ethers.solidityPacked(
        ['uint16', 'uint256'],
        [1, 200000], // Version 1, 200k gas
      );

      // Send via LayerZero
      const tx = await lzEndpoint.send(
        lzChainId,
        destination,
        encoded,
        await signer.getAddress(),
        ethers.ZeroAddress,
        adapterParams,
        { value: ethers.parseEther('0.01') }, // Estimated fee
      );

      chainStatus.txHash = tx.hash;
      chainStatus.delivered = true;
      chainStatus.retrying = false;

      console.log(`[Broadcaster] Sent to ${chainStatus.chainName}: ${tx.hash}`);

      // Wait for confirmation
      const receipt = await tx.wait(chainConfig.confirmations);
      chainStatus.confirmed = receipt?.status === 1;

    } catch (error) {
      chainStatus.error = String(error);
      chainStatus.retrying = false;
      console.error(`[Broadcaster] Failed to send to ${chainStatus.chainName}:`, error);
    }
  }

  private updateOverallStatus(result: EventPropagationResult): void {
    const allDelivered = result.chains.every(c => c.delivered);
    const allConfirmed = result.chains.every(c => c.confirmed);
    const anyDelivered = result.chains.some(c => c.delivered);
    const allFailed = result.chains.every(c => c.error && !c.retrying);

    if (allConfirmed) {
      result.overallStatus = 'COMPLETE';
      result.completedAt = Date.now();
    } else if (allFailed) {
      result.overallStatus = 'FAILED';
    } else if (anyDelivered) {
      result.overallStatus = 'PARTIAL';
    } else {
      result.overallStatus = 'PENDING';
    }
  }

  private evmToLayerZeroChainId(evmChainId: number): number {
    // LayerZero chain IDs
    const mapping: Record<number, number> = {
      1: 101,      // Ethereum
      137: 109,    // Polygon
      42161: 110,  // Arbitrum
      10: 111,     // Optimism
      8453: 184,   // Base
      43114: 106,  // Avalanche
      56: 102,     // BSC
    };
    return mapping[evmChainId] || evmChainId;
  }
}

// ─── Cross-Chain Subscription Manager ───

export type EventCallback = (event: SecurityEvent, chainId: number) => void;

export interface SubscriptionConfig {
  chains: number[] | 'all';
  eventTypes?: SecurityEventType[];
  minSeverity?: Severity;
}

export class CrossChainSync {
  private providers: Map<number, ethers.Provider> = new Map();
  private subscriptions: Map<string, EventCallback> = new Map();
  private listeners: Map<number, ethers.Contract> = new Map();
  private processedEvents: Set<string> = new Set();

  constructor(providers: Map<number, ethers.Provider>) {
    this.providers = providers;
  }

  /**
   * Subscribe to security events across chains
   */
  subscribe(
    config: SubscriptionConfig,
    callback: EventCallback,
  ): string {
    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.subscriptions.set(subscriptionId, callback);

    // Set up listeners for each chain
    const chains = config.chains === 'all'
      ? SUPPORTED_CHAINS.map(c => c.chainId)
      : config.chains;

    for (const chainId of chains) {
      this.setupChainListener(chainId, config, callback);
    }

    console.log(`[CrossChainSync] Subscription ${subscriptionId} created for chains: ${chains.join(', ')}`);

    return subscriptionId;
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }

  /**
   * Get current security state across all chains
   */
  async getSecurityState(chains: number[]): Promise<Map<number, ChainSecurityState>> {
    const states = new Map<number, ChainSecurityState>();

    await Promise.all(
      chains.map(async (chainId) => {
        const state = await this.getChainSecurityState(chainId);
        states.set(chainId, state);
      }),
    );

    return states;
  }

  /**
   * Check if an address is blacklisted on any chain
   */
  async isAddressBlacklisted(address: string, chains: number[]): Promise<Map<number, boolean>> {
    const results = new Map<number, boolean>();

    await Promise.all(
      chains.map(async (chainId) => {
        const isBlacklisted = await this.checkBlacklist(chainId, address);
        results.set(chainId, isBlacklisted);
      }),
    );

    return results;
  }

  /**
   * Get recent security events
   */
  async getRecentEvents(
    chains: number[],
    limit: number = 10,
  ): Promise<SecurityEvent[]> {
    const events: SecurityEvent[] = [];

    // In production, this would query an indexer or event logs
    // For now, return from processed events cache

    return events.slice(0, limit);
  }

  // ─── Private Methods ───

  private setupChainListener(
    chainId: number,
    config: SubscriptionConfig,
    callback: EventCallback,
  ): void {
    const provider = this.providers.get(chainId);
    if (!provider) {
      console.warn(`[CrossChainSync] No provider for chain ${chainId}`);
      return;
    }

    const chainConfig = SUPPORTED_CHAINS.find(c => c.chainId === chainId);
    if (!chainConfig || !chainConfig.guardianRegistry) {
      console.warn(`[CrossChainSync] No registry configured for chain ${chainId}`);
      return;
    }

    // GuardianRegistry event ABI
    const registryAbi = [
      'event SecurityEventReceived(bytes32 indexed eventId, uint8 eventType, uint8 severity, address indexed source)',
      'event SecurityEventExecuted(bytes32 indexed eventId, bool success)',
    ];

    const registry = new ethers.Contract(
      chainConfig.guardianRegistry,
      registryAbi,
      provider,
    );

    // Listen for SecurityEventReceived
    registry.on('SecurityEventReceived', (eventId, eventType, severity, source) => {
      // Prevent duplicate processing
      const eventKey = `${chainId}-${eventId}`;
      if (this.processedEvents.has(eventKey)) {
        return;
      }
      this.processedEvents.add(eventKey);

      // Filter by config
      if (config.eventTypes && !config.eventTypes.includes(this.indexToEventType(eventType))) {
        return;
      }

      if (config.minSeverity && this.severityToLevel(this.indexToSeverity(severity)) < this.severityToLevel(config.minSeverity)) {
        return;
      }

      // Fetch full event details and call callback
      // In production, would decode full event from transaction
      const mockEvent: SecurityEvent = {
        eventId,
        sourceChainId: chainId,
        eventType: this.indexToEventType(eventType),
        severity: this.indexToSeverity(severity),
        targetChains: [chainId],
        actionParameters: {},
        timestamp: Date.now(),
        expiryTime: Date.now() + 3600000,
        guardianSignature: { signature: '0x', message: '0x', publicKey: '0x' },
        evidenceHash: '0x',
      };

      callback(mockEvent, chainId);
    });

    this.listeners.set(chainId, registry);
  }

  private async getChainSecurityState(chainId: number): Promise<ChainSecurityState> {
    // In production, would query GuardianRegistry contract
    return {
      chainId,
      isPaused: false,
      currentThreshold: 7,
      lastEventTimestamp: 0,
      blacklistedCount: 0,
    };
  }

  private async checkBlacklist(chainId: number, address: string): Promise<boolean> {
    // In production, would query GuardianRegistry.isBlacklisted(address)
    return false;
  }

  private indexToEventType(index: number): SecurityEventType {
    const types: SecurityEventType[] = [
      'EMERGENCY_PAUSE', 'BLACKLIST', 'THRESHOLD_UP', 'MONITOR', 'UNPAUSE', 'UNBLACKLIST',
    ];
    return types[index] || 'MONITOR';
  }

  private indexToSeverity(index: number): Severity {
    const severities: Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    return severities[index] || 'LOW';
  }

  private severityToLevel(severity: Severity): number {
    return { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }[severity];
  }
}

export interface ChainSecurityState {
  chainId: number;
  isPaused: boolean;
  currentThreshold: number;
  lastEventTimestamp: number;
  blacklistedCount: number;
}

// ─── Factory Functions ───

export function createBroadcaster(config?: Partial<BroadcasterConfig>): CrossChainBroadcaster {
  return new CrossChainBroadcaster(config);
}

export function createCrossChainSync(providers: Map<number, ethers.Provider>): CrossChainSync {
  return new CrossChainSync(providers);
}

// ─── Helper: Create Security Event ───

let eventNonce = 0;

export function createSecurityEvent(
  sourceChainId: number,
  eventType: SecurityEventType,
  severity: Severity,
  targetChains: number[],
  actionParameters: ActionParameters,
  frostSignature: FrostSignature,
  evidenceHash: string,
  expirySeconds: number = 3600, // 1 hour default
): SecurityEvent {
  const timestamp = Date.now();
  const eventId = SecurityEventEncoder.generateEventId(
    sourceChainId,
    eventType,
    timestamp,
    eventNonce++,
  );

  return {
    eventId,
    sourceChainId,
    eventType,
    severity,
    targetChains,
    actionParameters,
    timestamp,
    expiryTime: timestamp + expirySeconds * 1000,
    guardianSignature: frostSignature,
    evidenceHash,
  };
}
