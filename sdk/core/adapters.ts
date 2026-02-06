/**
 * sdk/core/adapters.ts
 *
 * Adapter functions to bridge type differences between SDK and crypto libraries.
 * Converts between lib Buffer-based types and SDK string-based types.
 */

// ─── VDF Adapters ───

/**
 * VDF Proof as returned by lib/vdf
 */
export interface LibVDFProof {
  output: Buffer;
  proof: Buffer;
  iterations: number;
  computeTime: number;
}

/**
 * VDF Proof as expected by SDK/contracts
 */
export interface SDKVDFProof {
  output: string;      // bytes32 hex
  proof: string;       // bytes hex
  iterations: number;
}

/**
 * Convert lib/vdf VDFProof to SDK format
 */
export function libVDFProofToSDK(libProof: LibVDFProof): SDKVDFProof {
  return {
    output: '0x' + libProof.output.toString('hex').padStart(64, '0'),
    proof: '0x' + libProof.proof.toString('hex'),
    iterations: libProof.iterations,
  };
}

/**
 * Convert SDK VDFProof to lib format (for verification)
 */
export function sdkVDFProofToLib(sdkProof: SDKVDFProof): LibVDFProof {
  return {
    output: Buffer.from(sdkProof.output.replace('0x', ''), 'hex'),
    proof: Buffer.from(sdkProof.proof.replace('0x', ''), 'hex'),
    iterations: sdkProof.iterations,
    computeTime: 0, // Unknown when converting from SDK
  };
}

/**
 * Create a zero/bypass proof in SDK format
 */
export function createSDKZeroProof(): SDKVDFProof {
  return {
    output: '0x' + '0'.repeat(64),
    proof: '0x',
    iterations: 0,
  };
}

// ─── FROST Adapters ───

/**
 * FROST Signature as returned by lib/frost
 */
export interface LibFROSTSignature {
  R: Buffer;              // 32 bytes - group commitment point
  z: Buffer;              // 32 bytes - aggregated signature scalar
  groupPublicKey: Buffer; // 32 bytes - group public key
}

/**
 * FROST Signature as expected by SDK/contracts
 */
export interface SDKFrostSignature {
  signature: string;   // Combined R || z as hex bytes
  message: string;     // bytes32 - the signed message hash
  publicKey: string;   // bytes - group public key
}

/**
 * Convert lib/frost FROSTSignature to SDK format
 *
 * @param libSig - Signature from lib/frost
 * @param messageHash - The message that was signed (bytes32)
 */
export function libFROSTSignatureToSDK(
  libSig: LibFROSTSignature,
  messageHash: string | Buffer,
): SDKFrostSignature {
  // Combine R and z into single signature blob
  const combinedSig = Buffer.concat([libSig.R, libSig.z]);

  const message = typeof messageHash === 'string'
    ? messageHash
    : '0x' + messageHash.toString('hex');

  return {
    signature: '0x' + combinedSig.toString('hex'),
    message: message.startsWith('0x') ? message : '0x' + message,
    publicKey: '0x' + libSig.groupPublicKey.toString('hex'),
  };
}

/**
 * Convert SDK FrostSignature back to lib format
 */
export function sdkFROSTSignatureToLib(sdkSig: SDKFrostSignature): LibFROSTSignature {
  const sigBytes = Buffer.from(sdkSig.signature.replace('0x', ''), 'hex');

  if (sigBytes.length !== 64) {
    throw new Error(`Invalid signature length: expected 64 bytes, got ${sigBytes.length}`);
  }

  return {
    R: sigBytes.subarray(0, 32),
    z: sigBytes.subarray(32, 64),
    groupPublicKey: Buffer.from(sdkSig.publicKey.replace('0x', ''), 'hex'),
  };
}

/**
 * Format FROST signature for Solidity contract verification
 * Returns the format expected by FROSTVerifier.sol
 */
export function formatFROSTForSolidity(libSig: LibFROSTSignature): {
  r: string;      // bytes32 - R point (compressed)
  s: string;      // bytes32 - z scalar
  publicKey: string; // bytes32 - group public key
} {
  return {
    r: '0x' + libSig.R.toString('hex').padStart(64, '0'),
    s: '0x' + libSig.z.toString('hex').padStart(64, '0'),
    publicKey: '0x' + libSig.groupPublicKey.toString('hex').padStart(64, '0'),
  };
}

// ─── ZK Proof Adapters ───

/**
 * ZK Proof as returned by lib/zk (already SDK-compatible)
 * Included here for completeness and type safety.
 */
export interface LibZKProof {
  pA: [string, string];
  pB: [[string, string], [string, string]];
  pC: [string, string];
}

/**
 * Full proof result from lib/zk
 */
export interface LibProofResult {
  proof: LibZKProof;
  vote: number;
}

/**
 * ZK types are already aligned - this is a pass-through for consistency
 */
export function libZKProofToSDK(libProof: LibZKProof): LibZKProof {
  // Already in correct format, just return as-is
  return libProof;
}

// ─── VDF Challenge Adapters ───

/**
 * VDF Challenge as used by lib/vdf
 */
export interface LibVDFChallenge {
  input: Buffer;
  timestamp: number;
  iterations: number;
  mlBotFlagged?: boolean;
}

/**
 * Create a VDF challenge from SDK request parameters
 */
export function createVDFChallenge(
  txHash: string,
  iterations: number,
  mlBotFlagged: boolean = false,
): LibVDFChallenge {
  // Convert txHash to input buffer
  const input = Buffer.from(txHash.replace('0x', '').padEnd(64, '0').slice(0, 64), 'hex');

  return {
    input,
    timestamp: Date.now(),
    iterations,
    mlBotFlagged,
  };
}

// ─── VDF Constants (aligned with lib/vdf) ───

/**
 * VDF parameters - ML bot flag is the only trigger
 */
export const VDF_DELAY_SECONDS = 1800;           // 30 minutes
export const VDF_ITERATIONS = 300_000_000;       // 30 min * 166k squarings/sec (modern hardware)

/**
 * Check if VDF is required based on ML bot flag
 */
export function isVDFRequired(mlBotFlagged: boolean): boolean {
  return mlBotFlagged;
}

/**
 * Get VDF iterations (always same when ML bot flags)
 */
export function getRequiredIterations(mlBotFlagged: boolean): number {
  return mlBotFlagged ? VDF_ITERATIONS : 0;
}

// ─── Utility Functions ───

/**
 * Convert hex string to Buffer
 */
export function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex.replace('0x', ''), 'hex');
}

/**
 * Convert Buffer to hex string with 0x prefix
 */
export function bufferToHex(buf: Buffer): string {
  return '0x' + buf.toString('hex');
}

/**
 * Ensure hex string has 0x prefix
 */
export function ensureHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex : '0x' + hex;
}

/**
 * Pad hex string to specific byte length
 */
export function padHex(hex: string, bytes: number): string {
  const clean = hex.replace('0x', '');
  return '0x' + clean.padStart(bytes * 2, '0');
}