//ahh final testing file hmmm
/// <reference types="node" />

import {
  VDFProver,
  VDFVerifier,
  VDFClient,
  getVDFParams,
  isVDFRequired,
  getRequiredIterations,
  getRequiredDelay,
  formatDelay,
  VDFChallenge,
} from '../src/index';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function log(message: string): void {
  console.log(`[TEST] ${message}`);
}

async function runTests() {
  log('Starting VDF test suite...\n');
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  // T1. ML bot flag triggers VDF correctly
  try {
    log('Test 1: ML bot flag triggers VDF');
    
    const flaggedtx = true;
    const cleantx = false;
    assert(isVDFRequired(flaggedtx), 'Flagged tx should require VDF');
    assert(!isVDFRequired(cleantx), 'Clean tx should not require VDF');
    const delay = getRequiredDelay();
    const iterations = getRequiredIterations();
    assert(delay === 1800, 'VDF imposed: 30 minutes');
    assert(iterations === 300_000_000, 'VDF iterations - 300M for 30 min (166k/sec)');
    log(`Flagged tx: VDF required`);
    log(`Clean tx: No VDF`);
    log(`Delay: ${formatDelay(delay)}`);
    log(`Iterations: ${iterations.toLocaleString()}`);
    log('Test 1 PASSED\n');
    testsPassed++;
  } catch (error) {
    log(`✗ Test 1 FAILED: ${error}\n`);
    testsFailed++;
  }
  
  // T2: VDF computatn and verificn (small test with 10k iters)
  try {
    log('Test 2: VDF computation and verification (quick test)');
    const iterations = 10000;  //quick test
    const params = getVDFParams(iterations);
    const prover = new VDFProver(params);
    const verifier = new VDFVerifier(params);
    const challenge: VDFChallenge = {
      input: Buffer.from('test-proposal-123'),
      timestamp: Date.now(),
      iterations,
    };
    
    log('  Computing VDF (this will take ~0.3 seconds)...');
    const startTime = Date.now();
    const proof = await prover.compute(challenge);
    const computeTime = Date.now() - startTime;
    log(`  Computation complete in ${(computeTime / 1000).toFixed(2)}s`);
    // RSA-2048 modulus = 256 bytes for output and proof
    assert(proof.output.length === 256, 'Output should be 256 bytes (RSA-2048)');
    assert(proof.proof.length === 256, 'Proof should be 256 bytes (RSA-2048)');
    assert(proof.iterations === iterations, 'Iterations should match');
    log('  Verifying proof...');
    const result = await verifier.verify(challenge, proof);
    assert(result.valid, 'Proof should verify');
    log(`  Verification: ${result.message}`);
    log('✓ Test 2 PASSED\n');
    testsPassed++;
  } catch (error) {
    log(`✗ Test 2 FAILED: ${error}\n`);
    testsFailed++;
  }
  
  // T3: Zero proof -guardian bypass case
  try {
    log('Test 3: Zero proof (guardian bypass)');
    const params = getVDFParams(100000);
    const verifier = new VDFVerifier(params);
    const challenge: VDFChallenge = {
      input: Buffer.from('bypassed-tx'),
      timestamp: Date.now(),
      iterations: 0,
    };
    const zeroProof = {
      output: Buffer.alloc(32),
      proof: Buffer.alloc(32),
      iterations: 0,
      computeTime: 0,
    };
    const result = await verifier.verify(challenge, zeroProof);
    assert(result.valid, 'Zero proof should be valid');
    assert(result.message.includes('bypass'), 'Should indicate bypass');
    log('  Zero proof verified (guardian bypass)');
    log('✓ Test 3 PASSED\n');
    testsPassed++;
  } catch (error) {
    log(`✗ Test 3 FAILED: ${error}\n`);
    testsFailed++;
  }
  
  // T4: VDF Client integration
  try {
    log('Test 4: VDF Client integration');
    const client = new VDFClient({ localCompute: true });
    // Check VDF requirements
    const flagged = true;
    const notFlagged = false;
    assert(client.isVDFRequired(flagged), 'Flagged tx should require VDF');
    assert(!client.isVDFRequired(notFlagged), 'Not flagged tx should not require VDF');
    // Test zero proof creation
    const zeroProof = client.createZeroProof();
    assert(zeroProof.iterations === 0, 'Zero proof should have 0 iterations');
    log('VDF Client initialized successfully');
    log( 'Flagged tx: VDF required');
    log('Clean tx: No VDF');
    log('Zero proof creation works');
    log('Test 4 PASSED\n');
    testsPassed++;
  } catch (error) {
    log(`Test 4 FAILED: ${error}\n`);
    testsFailed++;
  }
  
  // T5: Invalid proof -> reject
  try {
    log('Test 5: Invalid proof rejection');
    const params = getVDFParams(10000);
    const verifier = new VDFVerifier(params);
    const challenge: VDFChallenge = {
      input: Buffer.from('test-challenge'),
      timestamp: Date.now(),
      iterations: 10000,
    };
    // Create invalid proof (random data)
    const invalidProof = {
      output: Buffer.from('0'.repeat(64), 'hex'),
      proof: Buffer.from('1'.repeat(64), 'hex'),
      iterations: 10000,
      computeTime: 100,
    };
    const result = await verifier.verify(challenge, invalidProof);
    assert(!result.valid, 'Invalid proof should be rejected');
    log('  Invalid proof correctly rejected');
    log('Test 5 PASSED\n');
    testsPassed++;
  } catch (error) {
    log(`Test 5 FAILED: ${error}\n`);
    testsFailed++;
  }
  log('\n------------------------------');
  log(`Tests Passed: ${testsPassed}`);
  log(`Tests Failed: ${testsFailed}`);
  log('------------------------------\n');
  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Testing error:', error);
  process.exit(1);
});
