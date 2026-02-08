/**
 * sdk/core/contract.ts
 * 
 * Contract interaction layer for SecurityMiddleware and GuardianRegistry.
 * Handles all on-chain reads/writes for the Sack Money protocol.
 */

import { ethers, Contract as EthersContract } from 'ethers';

// ─── Types ───

export interface SecurityConfig {
  middlewareAddress: string;
  registryAddress: string;
  chainId: number;
}

export interface ExecuteParams {
  target: string;           // Target contract (Uniswap, LI.FI Diamond, etc.)
  data: string;             // Calldata for the target
  value: bigint;            // ETH value to send
  vdfProof: VDFProof;       // Time-lock proof
  frostSignature: FrostSignature; // Guardian threshold signature
}

export interface VDFProof {
  output: string;           // VDF output hash
  proof: string;            // VDF proof bytes
  iterations: number;       // Number of sequential iterations
}

export interface FrostSignature {
  signature: string;        // Aggregated FROST signature
  message: string;          // Signed message hash
  publicKey: string;        // Aggregated public key
}

export interface SecurityState {
  isPaused: boolean;
  lastUpdateBlock: number;
  requiredDelay: number;    // VDF iterations required based on amount
  threshold: number;        // Guardian threshold (e.g., 7)
}

// ─── ABIs ───

const SECURITY_MIDDLEWARE_ABI = [
  // 2-step execution flow (matches SecurityMiddleware.sol)
  "function queueTransaction(bytes32 txHash, address sender, address destination, uint256 value, bool mlBotFlagged, bytes calldata txData) external returns (bytes32 proposalId)",
  "function executeTransaction(bytes32 txHash, bytes calldata vdfProof, bytes32 frostR, bytes32 frostZ) external",
  
  // View functions
  "function isPaused() external view returns (bool)",
  "function blacklistedAddresses(address account) external view returns (bool)",
  "function getTransactionStatus(bytes32 txHash) external view returns (bool exists, bool mlBotFlagged, bool executed, bool guardianApproved, bool guardianRejected, uint256 vdfDeadline, bool vdfComplete)",
  "function getVDFDelay() external pure returns (uint256)",
  "function GUARDIAN_THRESHOLD() external pure returns (uint8)",
  
  // Events
  "event TransactionQueued(bytes32 indexed txHash, bytes32 indexed proposalId, bool mlBotFlagged, uint256 vdfDeadline, string reason)",
  "event TransactionExecuted(bytes32 indexed txHash, string executionPath)",
  "event TransactionBlocked(bytes32 indexed txHash, string reason)",
  "event GuardianBypass(bytes32 indexed txHash, bytes32 indexed proposalId, uint8 approvals)",
];

const GUARDIAN_REGISTRY_ABI = [
  // FROST key management
  "function getAggregatedPublicKey() external view returns (bytes)",
  "function getGuardianCount() external view returns (uint8)",
  
  // Pause mechanism
  "function isPaused() external view returns (bool)",
  "function pauseReason() external view returns (string)",
  
  // Guardian info
  "function isGuardian(address account) external view returns (bool)",
  "function getGuardianENS(address guardian) external view returns (string)",
];

// ─── Contract Wrapper ───

export class SecurityContract {
  private provider: ethers.Provider;
  private signer: ethers.Signer | null;
  private middleware: EthersContract;
  private registry: EthersContract;
  private config: SecurityConfig;

  constructor(
    provider: ethers.Provider,
    config: SecurityConfig,
    signer?: ethers.Signer,
  ) {
    this.provider = provider;
    this.signer = signer || null;
    this.config = config;

    const signerOrProvider = signer || provider;
    
    this.middleware = new EthersContract(
      config.middlewareAddress,
      SECURITY_MIDDLEWARE_ABI,
      signerOrProvider,
    );

    this.registry = new EthersContract(
      config.registryAddress,
      GUARDIAN_REGISTRY_ABI,
      signerOrProvider,
    );
  }

  // ─── Core Execution ───

  /**
   * Execute a transaction through the security middleware.
   * 2-step flow: queueTransaction → executeTransaction
   * Matches the actual SecurityMiddleware.sol contract.
   */
  async executeSecurely(params: ExecuteParams): Promise<ethers.TransactionReceipt> {
    if (!this.signer) {
      throw new Error('Signer required for execution');
    }

    const sender = await this.signer.getAddress();

    // Generate txHash from intent parameters
    const txHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'bytes', 'uint256', 'uint256'],
        [params.target, params.data, params.value, Date.now()],
      ),
    );

    // Step 1: Queue the transaction on-chain
    const queueTx = await this.middleware.queueTransaction(
      txHash,
      sender,
      params.target,
      params.value,
      false, // mlBotFlagged — we handle ML analysis off-chain in the SDK
      params.data,
    );
    await queueTx.wait();

    // Step 2: Execute with proofs
    // FROST signature can come in two formats:
    // - Guardian mock: { R: string, z: string }
    // - SDK type: { signature: string, message: string, publicKey: string }
    const sig = params.frostSignature as any;
    let frostR: string;
    let frostZ: string;

    if (sig.R && sig.z) {
      // Direct R, z format from guardian mock
      frostR = sig.R;
      frostZ = sig.z;
    } else {
      // SDK format: signature=R, publicKey contains z
      frostR = sig.signature || ethers.ZeroHash;
      frostZ = sig.publicKey || ethers.ZeroHash;
    }

    // Ensure they're proper bytes32
    if (!frostR.startsWith('0x')) frostR = '0x' + frostR;
    if (!frostZ.startsWith('0x')) frostZ = '0x' + frostZ;
    frostR = ethers.zeroPadValue(frostR.slice(0, 66), 32);
    frostZ = ethers.zeroPadValue(frostZ.slice(0, 66), 32);

    const vdfBytes = this.encodeVDFProof(params.vdfProof);

    const executeTx = await this.middleware.executeTransaction(
      txHash,
      vdfBytes,
      frostR,
      frostZ,
    );

    return executeTx.wait();
  }

  // ─── View Functions ───

  /**
   * Get current security state from middleware.
   */
  async getSecurityState(): Promise<SecurityState> {
    const [isPaused, threshold] = await Promise.all([
      this.middleware.isPaused(),
      this.middleware.GUARDIAN_THRESHOLD().catch(() => 7),
    ]);

    return {
      isPaused,
      lastUpdateBlock: 0,
      requiredDelay: Number(await this.middleware.getVDFDelay().catch(() => 1800)),
      threshold: Number(threshold),
    };
  }

  /**
   * Check if an address is blacklisted.
   */
  async isBlacklisted(address: string): Promise<boolean> {
    return this.middleware.blacklistedAddresses(address);
  }

  /**
   * Get transaction status on-chain.
   */
  async getTransactionStatus(txHash: string): Promise<{
    exists: boolean;
    mlBotFlagged: boolean;
    executed: boolean;
    guardianApproved: boolean;
    guardianRejected: boolean;
    vdfDeadline: bigint;
    vdfComplete: boolean;
  }> {
    const [exists, mlBotFlagged, executed, guardianApproved, guardianRejected, vdfDeadline, vdfComplete] =
      await this.middleware.getTransactionStatus(txHash);
    return { exists, mlBotFlagged, executed, guardianApproved, guardianRejected, vdfDeadline, vdfComplete };
  }

  /**
   * Calculate required VDF delay.
   */
  async calculateRequiredDelay(_amount: bigint): Promise<number> {
    const delay = await this.middleware.getVDFDelay();
    return Number(delay);
  }

  /**
   * Check if protocol is paused (from middleware contract directly).
   */
  async isPaused(): Promise<boolean> {
    return this.middleware.isPaused();
  }

  /**
   * Get FROST aggregated public key from registry.
   */
  async getAggregatedPublicKey(): Promise<string> {
    return this.registry.getAggregatedPublicKey();
  }

  /**
   * Check if an address is a guardian.
   */
  async isGuardian(address: string): Promise<boolean> {
    return this.registry.isGuardian(address);
  }

  // ─── Encoding Helpers ───

  private encodeVDFProof(proof: VDFProof): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes', 'uint256'],
      [proof.output, proof.proof, proof.iterations],
    );
  }

  private encodeFrostSignature(sig: FrostSignature): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes', 'bytes32', 'bytes'],
      [sig.signature, sig.message, sig.publicKey],
    );
  }

  // ─── Getters ───

  get middlewareAddress(): string {
    return this.config.middlewareAddress;
  }

  get registryAddress(): string {
    return this.config.registryAddress;
  }

  get chainId(): number {
    return this.config.chainId;
  }
}