/**
 * VDF Prover - Wesolowski's VDF implementation
 *
 * Computes y = x^(2^T) mod N via sequential squaring
 * Proof: π = x^q mod N where q = floor(2^T/l)
 */

import { sha256 } from '@noble/hashes/sha256';
import { modPow } from 'bigint-mod-arith';
import { VDFParams, VDFProofResult } from './types';

// --- RSA-2048 Modulus (from RSA Factoring Challenge) ---
// This is a well-known unfactored RSA modulus, secure for VDF
const RSA_2048_MODULUS = BigInt(
  '0x' +
  'c7970ceedcc3b0754490201a7aa613cd73911081c790f5f1a8726f463550bb5b' +
  '7ff0db8e1ea1189ec72f93d1650011bd721aeeacc2acde32a04107f0648c2813' +
  'a31f5b0b7765ff8b44b4b6ffc93384b646eb09c7cf5e8592d40ea33c80039f35' +
  'b4f14a04b51f7bfd781be4d1673164ba8eb991c2c4d730bbbe35f592bdef524a' +
  'f7e8daefd26c66fc02c479af89d64d373f442709439de66ceb955f3ea37d5159' +
  'f6135809f85334b5cb1813addc80cd05609f10ac6a95ad65872c909525bdad32' +
  'bc729592642920f24c61dc5b3c3b7923e56b16a4d9d373d8721f24a3fc0f1b31' +
  '31f55615172866bccc30f95054c824e733a5eb6817f7bc16399d48c6361cc7e5'
);

const DEFAULT_GENERATOR = 2n;

// --- Helpers ---

function bytesToBigInt(bytes: Buffer | Uint8Array): bigint {
  const hex = Buffer.from(bytes).toString('hex');
  return hex.length > 0 ? BigInt('0x' + hex) : 0n;
}

function bigIntToHex(value: bigint, bytes: number = 32): string {
  const hex = value.toString(16).padStart(bytes * 2, '0');
  return '0x' + hex;
}

function hashToScalar(modulus: bigint, ...inputs: Buffer[]): bigint {
  const combined = Buffer.concat(inputs);
  const hash = sha256(combined);
  const value = bytesToBigInt(Buffer.from(hash));
  return value % modulus;
}

function generateSmallPrime(seed: Buffer): bigint {
  const hash = sha256(seed);
  let candidate = bytesToBigInt(Buffer.from(hash)) % (2n ** 128n);
  if (candidate % 2n === 0n) {
    candidate += 1n;
  }
  return candidate;
}

// --- VDF Prover Class ---

export class VDFProver {
  private params: VDFParams;

  constructor(params?: Partial<VDFParams>) {
    this.params = {
      modulus: params?.modulus ?? RSA_2048_MODULUS,
      generator: params?.generator ?? DEFAULT_GENERATOR,
    };
  }

  /**
   * Compute VDF proof with progress callback
   */
  async compute(
    input: Buffer,
    iterations: number,
    onProgress?: (progress: number, iteration: number, estimatedTimeLeft: number) => void
  ): Promise<VDFProofResult> {
    const startTime = Date.now();
    console.log(`[VDF Prover] Starting computation`);
    console.log(`  Iterations: ${iterations.toLocaleString()}`);

    // Step 1: Convert input to number in Z_N
    const x = hashToScalar(this.params.modulus, input);
    console.log(`[VDF Prover] Input derived: ${x.toString(16).slice(0, 16)}...`);

    // Step 2: Compute y = x^(2^T) mod N via repeated squaring
    console.log(`[VDF Prover] Computing repeated squarings...`);
    const y = await this.repeatedSquaring(x, iterations, startTime, onProgress);

    const afterSquaring = Date.now();
    console.log(`[VDF Prover] Squaring complete in ${((afterSquaring - startTime) / 1000).toFixed(2)}s`);

    // Step 3: Generate Fiat-Shamir challenge l
    const inputBuf = Buffer.from(input);
    const yBuf = Buffer.from(y.toString(16).padStart(64, '0'), 'hex');
    const iterBuf = Buffer.from(iterations.toString());
    const l = generateSmallPrime(Buffer.concat([inputBuf, yBuf, iterBuf]));

    // Step 4: Compute proof π = x^q mod N where q = floor(2^T / l)
    console.log(`[VDF Prover] Generating proof...`);
    const twoToT = 2n ** BigInt(iterations);
    const q = twoToT / l;
    const pi = modPow(x, q, this.params.modulus);

    const endTime = Date.now();
    console.log(`[VDF Prover] Proof complete!`);
    console.log(`  Total time: ${((endTime - startTime) / 1000).toFixed(2)}s`);

    return {
      output: bigIntToHex(y, 32),
      proof: bigIntToHex(pi, 256), // RSA-2048 = 256 bytes
      iterations,
    };
  }

  private async repeatedSquaring(
    x: bigint,
    iterations: number,
    startTime: number,
    onProgress?: (progress: number, iteration: number, estimatedTimeLeft: number) => void
  ): Promise<bigint> {
    let result = x;
    const progressInterval = Math.max(1, Math.floor(iterations / 100));
    const modulus = this.params.modulus;

    for (let i = 0; i < iterations; i++) {
      result = (result * result) % modulus;

      if (onProgress && i % progressInterval === 0) {
        const progress = Math.floor((i / iterations) * 100);
        const elapsed = Date.now() - startTime;
        const rate = i / (elapsed / 1000); // iterations per second
        const remaining = iterations - i;
        const estimatedTimeLeft = rate > 0 ? Math.ceil(remaining / rate) : 0;

        onProgress(progress, i, estimatedTimeLeft);

        // Yield to event loop occasionally
        if (i % (progressInterval * 10) === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
    }

    if (onProgress) {
      onProgress(100, iterations, 0);
    }

    return result;
  }

  /**
   * Create a zero proof for bypassed transactions
   */
  createZeroProof(): VDFProofResult {
    return {
      output: '0x' + '0'.repeat(64),
      proof: '0x',
      iterations: 0,
    };
  }
}

// --- Mock Prover (for testing) ---

export class MockVDFProver {
  async compute(input: Buffer, iterations: number): Promise<VDFProofResult> {
    // Simulate a short delay
    await new Promise(resolve => setTimeout(resolve, 100));

    // Generate deterministic mock output from input
    const hash = sha256(Buffer.concat([input, Buffer.from(iterations.toString())]));

    return {
      output: '0x' + Buffer.from(hash).toString('hex'),
      proof: '0x' + Buffer.from(sha256(hash)).toString('hex').repeat(8), // 256 bytes
      iterations,
    };
  }
}
