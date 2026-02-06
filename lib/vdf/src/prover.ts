/**
 * Computes VDF proofs
 * using Wesolowski's VDF:
 * Computation: y = x^(2^T)mod N ;T sequential squarings
 * proof: π = x^q mod N where q = floor(2^T/l)
 */
/// <reference types="node" />

import { sha256 } from '@noble/hashes/sha256';
import { modPow, modInv } from 'bigint-mod-arith';
import { VDFChallenge, VDFProof, VDFParams, VDFComputationError, VDF_CONSTANTS } from './types';
import { validateVDFParams } from './params';

// --- Constants ---

// RSA-2048 modulus = 256 bytes
const RSA_2048_BYTES = 256;

// --- Helpers ---

function bytesToBigInt(bytes: Buffer): bigint {
  return BigInt('0x' + bytes.toString('hex'));
}

function bigIntToBuffer(value: bigint, size: number = RSA_2048_BYTES): Buffer {
  const hex = value.toString(16).padStart(size * 2, '0');
  // Truncate if longer than expected (shouldn't happen with correct modulus)
  const truncatedHex = hex.slice(-size * 2);
  return Buffer.from(truncatedHex, 'hex');
}

//Hash function for generating challenge
function hashToScalar(modulus: bigint, ...inputs: Buffer[]): bigint {
  const combined = Buffer.concat(inputs);
  const hash = sha256(combined);
  const value = bytesToBigInt(Buffer.from(hash));
  return value % modulus;
}

// Generate a small prime using hash, for Fiat-Shamir challenge in proof generation
function generateSmallPrime(seed: Buffer): bigint {
  let hash = sha256(seed);
  let candidate = bytesToBigInt(Buffer.from(hash)) % (2n ** 128n);
  
  // Make it odd
  if (candidate % 2n === 0n) {
    candidate += 1n;
  }
  // For simplicity, just return odd number
  // In production, would test for primality
  return candidate;
}

// --- VDF Prover Class ---

export class VDFProver {
  private params: VDFParams;
  constructor(params: VDFParams) {
    validateVDFParams(params);
    this.params = params;
  }
  
  /**
   * @param challenge - The VDF challenge
   * @param onProgress - Optional callback for progress updates
   * @returns VDF proof
   */
  async compute(
    challenge: VDFChallenge,
    onProgress?: (progress: number, currentIteration: number) => void
  ): Promise<VDFProof> {
    const startTime = Date.now();
    console.log(`[VDF Prover] Starting computation`);
    console.log(`  Iterations: ${challenge.iterations.toLocaleString()}`);
    console.log(`  Expected time: ~${Math.ceil(challenge.iterations / VDF_CONSTANTS.SQUARINGS_PER_SECOND)}s`);
    
    try {
      // Step 1: Convert input to number in Z_N
      const x = hashToScalar(this.params.modulus, challenge.input);
      console.log(`[VDF Prover] Input derived: ${x.toString(16).slice(0, 16)}...`);
      // Step 2: Compute y = x^(2^T) mod N via repeated squaring
      console.log(`[VDF Prover] Computing repeated squarings...`);
      const y = await this.repeatedSquaring(
        x,
        challenge.iterations,
        this.params.modulus,
        onProgress
      );
      const afterSquaring = Date.now();
      console.log(`[VDF Prover] Squaring complete in ${((afterSquaring - startTime) / 1000).toFixed(2)}s`);
      // Step 3: Generate Fiat Shamir challenge l
      const l = generateSmallPrime(
        Buffer.concat([
          challenge.input,
          bigIntToBuffer(y),
          Buffer.from(challenge.iterations.toString()),
        ])
      );
      console.log(`[VDF Prover] Challenge l: ${l.toString(16).slice(0, 16)}...`);
      // Step 4: Compute proof π = x^q mod N where q = floor(2^T / l)
      console.log(`[VDF Prover] Generating proof...`);
      const twoToT = 2n ** BigInt(challenge.iterations);
      const q = twoToT / l;
      const r = twoToT % l;
      // Compute π = x^q mod N using fast exponentiation
      const pi = modPow(x, q, this.params.modulus);
      const endTime = Date.now();
      const computeTime = endTime - startTime;
      console.log(`[VDF Prover] Proof complete!`);
      console.log(`  Total time: ${(computeTime / 1000).toFixed(2)}s`);
      console.log(`  Output: ${y.toString(16).slice(0, 16)}...`);
      
      const proof: VDFProof = {
        output: bigIntToBuffer(y, RSA_2048_BYTES),
        proof: bigIntToBuffer(pi, RSA_2048_BYTES),
        iterations: challenge.iterations,
        computeTime,
      };
      return proof;
    } catch (error) {
      console.error('[VDF Prover] Computation failed:', error);
      throw new VDFComputationError(`Failed to compute VDF: ${error}`);
    }
  }
  
  private async repeatedSquaring(
    x: bigint,
    iterations: number,
    modulus: bigint,
    onProgress?: (progress: number, currentIteration: number) => void
  ): Promise<bigint> {
    let result = x;
    const progressInterval = Math.max(1, Math.floor(iterations / 100)); // Report after every 1%
    for (let i = 0; i < iterations; i++) {
      result = (result * result) % modulus;
      if (onProgress && i % progressInterval === 0) {
        const progress = Math.floor((i / iterations) * 100);
        onProgress(progress, i);
        // Yield to event loop occasionally (for async operations)
        if (i % (progressInterval * 10) === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
    }
    
    if (onProgress) {
      onProgress(100, iterations);
    }
    
    return result;
  }
  
  createZeroProof(): VDFProof {
    return {
      output: Buffer.alloc(32),
      proof: Buffer.alloc(32),
      iterations: 0,
      computeTime: 0,
    };
  }
}

// Quick helper to compute VDF

export async function computeVDF(
  challenge: VDFChallenge,
  params: VDFParams,
  onProgress?: (progress: number, iteration: number) => void
): Promise<VDFProof> {
  const prover = new VDFProver(params);
  return prover.compute(challenge, onProgress);
}
