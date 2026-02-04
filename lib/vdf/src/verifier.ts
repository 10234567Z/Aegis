/**
 * Verification equation: y == π^l * x^r mod N,  r = 2^T mod l
 */
/// <reference types="node" />

import { sha256 } from '@noble/hashes/sha256';
import { modPow } from 'bigint-mod-arith';
import { VDFChallenge, VDFProof, 
  VDFParams, 
  VDFVerificationResult,
  VDFVerificationError 
} from './types';
import { validateVDFParams } from './params';

// --- Helper Functions ---

function bytesToBigInt(bytes: Buffer): bigint {
  return BigInt('0x' + bytes.toString('hex'));
}
function bigIntToBuffer(value: bigint, size: number = 32): Buffer {
  const hex= value.toString(16).padStart(size * 2, '0');
  return Buffer.from(hex, 'hex');
}
function hashToScalar(modulus: bigint, ...inputs: Buffer[]): bigint {
  const combined= Buffer.concat(inputs);
  const hash= sha256(combined);
  const value= bytesToBigInt(Buffer.from(hash));
  return value% modulus;
}
function generateSmallPrime(seed: Buffer): bigint {
  let hash= sha256(seed);
  let candidate= bytesToBigInt(Buffer.from(hash)) % (2n ** 128n);
  if (candidate % 2n=== 0n) {
    candidate+= 1n;
  }
  return candidate;
}

// --- VDF Verifier Class ---

export class VDFVerifier {
  private params: VDFParams;
  constructor(params: VDFParams) {
    validateVDFParams(params);
    this.params= params;
  }
  
  /**
   * @param challenge - Original challenge
   * @param proof - VDF proof to verify
   * @returns Verification result
   */
  async verify(
    challenge: VDFChallenge,
    proof: VDFProof
  ): Promise<VDFVerificationResult> {
    const startTime = Date.now();
    try {
      console.log(`[VDF Verifier] Starting verification`);
      // Handle zero proof (guardian bypass)
      if (proof.iterations=== 0) {
        return {
          valid: true,
          message: 'Zero proof (guardian bypass)',
          computeTime: 0,
        };
      }
      // S1: Convert input to x
      const x= hashToScalar(this.params.modulus, challenge.input);
      // S2: Extract output y and proof π from proof
      const y=bytesToBigInt(proof.output);
      const pi= bytesToBigInt(proof.proof);
      // S3: Generate Fiat-Shamir challenge l - same as in prover
      const l= generateSmallPrime(
        Buffer.concat([
          challenge.input,
          proof.output,
          Buffer.from(proof.iterations.toString()),
        ])
      );
      // Step 4: Compute r = 2^T mod l
      const twoToT= 2n ** BigInt(proof.iterations);
      const r = twoToT % l;
      // Step 5: Verify equation: y == π^l * x^r mod N
      const piToL= modPow(pi, l, this.params.modulus);
      const xToR= modPow(x, r, this.params.modulus);
      const rightSide= (piToL * xToR) % this.params.modulus;
      const valid= y === rightSide;
      const endTime= Date.now();
      const verificationTime = endTime - startTime;
      console.log(`[VDF Verifier] Verification ${valid ? 'PASSED' : 'FAILED'}`);
      console.log(` Time: ${verificationTime}ms`);
      if (!valid) {
        console.log(`Expected:${y.toString(16).slice(0, 16)}...`);
        console.log(`Got:${rightSide.toString(16).slice(0, 16)}...`);
      }
      return {
        valid,
        message: valid ? 'Proof verified successfully' : 'Proof verification failed',
        computeTime: proof.computeTime,
        expectedTime: Math.ceil(challenge.iterations / 30000),
      };
    } catch (error) {
      console.error('[VDF Verifier] Verification error:', error);
      throw new VDFVerificationError(`Failed to verify VDF: ${error}`);
    }
  }
  
  //quick verification without logging
  async verifyQuick(challenge: VDFChallenge, proof: VDFProof): Promise<boolean> {
    try {
      if (proof.iterations === 0) return true; //zero proof case
      
      const x = hashToScalar(this.params.modulus, challenge.input);
      const y = bytesToBigInt(proof.output);
      const pi = bytesToBigInt(proof.proof);
      const l = generateSmallPrime(
        Buffer.concat([
          challenge.input,
          proof.output,
          Buffer.from(proof.iterations.toString()),
        ])
      );
      const twoToT = 2n ** BigInt(proof.iterations);
      const r = twoToT % l;
      const piToL = modPow(pi, l, this.params.modulus);
      const xToR = modPow(x, r, this.params.modulus);
      const rightSide = (piToL * xToR) % this.params.modulus;
      return y === rightSide;
    } catch {
      return false;
    }
  }
}

// Quick helper to verify
export async function verifyVDF(
  challenge: VDFChallenge,
  proof: VDFProof,
  params: VDFParams
): Promise<VDFVerificationResult> {
  const verifier = new VDFVerifier(params);
  return verifier.verify(challenge, proof);
}

//Quick bool verifn
export async function isValidVDF(
  challenge: VDFChallenge,
  proof: VDFProof,
  params: VDFParams
): Promise<boolean> {
  const verifier = new VDFVerifier(params);
  return verifier.verifyQuick(challenge, proof);
}
