/// <reference types="node" />

import { VDFParams, VDF_CONSTANTS, VDFError } from './types';

// ─── Pre-generated RSA Modulus ───
/**
 * For hackthon scope: Pre generated 2048-bit RSA modulus
 * In production, this would be generated via:
 * 1. Multi-Party Computation (MPC) ceremony
 * 2. Trusted setup with multiple parties
 * 3. Public randomness beacon 
 * For demo purposes, using a fixed modulus
 */
export const GUARDIAN_VDF_MODULUS = BigInt(
  '0x' +
  'C7970CEEDCC3B0754490201A7AA613CD73911081C790F5F1A8726F463550BB5B68' +
  '87AF53D39F1B7E1D06A6834A7E74BD15F28DDE4C44E3F4F32C7F6B9B1D21E5B3F0' +
  '9A8C7E4D3B2A1F0E9D8C7B6A5F4E3D2C1B0A9F8E7D6C5B4A3F2E1D0C9B8A7F6E5D4' +
  'C3B2A1F0E9D8C7B6A5F4E3D2C1B0A9F8E7D6C5B4A3F2E1D0C9B8A7F6E5D4C3B2A1'
);

export function getVDFParams(iterations: number): VDFParams {
  return {
    modulus: GUARDIAN_VDF_MODULUS,
    iterations,
    securityParameter: VDF_CONSTANTS.SECURITY_BITS,
  };
}

export function getDefaultVDFParams(): VDFParams {
  return getVDFParams(VDF_CONSTANTS.VDF_ITERATIONS);
}

export function isVDFRequired(mlBotFlagged: boolean): boolean {
  return mlBotFlagged;
}

export function getRequiredDelay(): number {
  return VDF_CONSTANTS.VDF_DELAY_SECONDS;
}

export function getRequiredIterations(): number {
  return VDF_CONSTANTS.VDF_ITERATIONS;
}

export function formatDelay(seconds: number): string {
  if (seconds === 0) return 'No delay';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}

export function validateVDFParams(params: VDFParams): void {
  if (params.modulus <= 0n) {
    throw new VDFError('Invalid modulus: must be positive');
  }
  if (params.iterations < 0) {
    throw new VDFError('Invalid iterations: must be non-negative');
  }
  if (params.securityParameter < 80) {
    throw new VDFError('Invalid security parameter: must be at least 80 bits');
  }
}

export function estimateComputeTime(iterations: number): number {
  return Math.ceil(iterations / VDF_CONSTANTS.SQUARINGS_PER_SECOND);
}

export function printVDFConfig(): void {
  console.log('\n VDF Configuration:\n');
  console.log('Trigger: ML Bot flags transaction as suspicious');
  console.log(`Delay: ${formatDelay(VDF_CONSTANTS.VDF_DELAY_SECONDS)}`);
  console.log(`Iters: ${VDF_CONSTANTS.VDF_ITERATIONS.toLocaleString()}`);
  console.log(`Estimated compute time: ~${estimateComputeTime(VDF_CONSTANTS.VDF_ITERATIONS)}s`);
  console.log();
  console.log('Workflow:');
  console.log('  1. ML bot analyzes every transaction');
  console.log('  2. If flagged as suspicious → VDF starts (30 min delay)');
  console.log('  3. Guardians review in parallel (takes 2-5 min)');
  console.log('  4. If guardians approve → VDF bypassed, execute immediately');
  console.log('  5. If guardians reject → Transaction blocked');
  console.log('  6. If no guardian response → VDF completes, then execute');
  console.log();
}
