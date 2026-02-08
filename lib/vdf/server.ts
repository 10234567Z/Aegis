/**
 * VDF Worker HTTP Server
 *
 * Wraps lib/vdf's local VDF prover into an HTTP API
 * that the SDK's VDFClient (sdk/core/VDF.ts) can talk to.
 *
 * Endpoints:
 *   POST /vdf/request  — Start VDF computation, returns jobId
 *   GET  /vdf/status/:jobId — Poll job status & progress
 *   POST /vdf/mock     — Return instant mock proof (dev mode)
 *   GET  /health       — Health check
 *
 * Usage:
 *   cd lib/vdf && npx ts-node server.ts
 *   # Runs on port 3000 by default (VDF_PORT env)
 */

import http from 'http';
import { VDFProver } from './src/prover';
import { VDFVerifier } from './src/verifier';
import { getVDFParams } from './src/params';
import { VDFChallenge, VDFProof, VDFJob } from './src/types';
import { sha256 } from '@noble/hashes/sha256';

const PORT = parseInt(process.env.VDF_PORT || '3000', 10);
// Demo iterations: 10k ≈ instant, 100k ≈ ~1s, 1M ≈ ~6s
const DEMO_ITERATIONS = parseInt(process.env.VDF_ITERATIONS || '50000', 10);

// Track jobs for status polling
const activeJobs = new Map<string, {
  jobId: string;
  status: 'pending' | 'computing' | 'complete' | 'failed' | 'bypassed';
  progress: number;
  estimatedTimeLeft: number;
  proof?: { output: string; proof: string; iterations: number };
  error?: string;
  startTime: number;
}>();

let jobCounter = 0;

// ─── Helpers ───

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function respond(res: http.ServerResponse, statusCode: number, body: any) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(body));
}

function proofToHex(proof: VDFProof): { output: string; proof: string; iterations: number } {
  return {
    output: '0x' + proof.output.toString('hex').slice(0, 64).padStart(64, '0'),
    proof: '0x' + proof.proof.toString('hex').slice(0, 64).padStart(64, '0'),
    iterations: proof.iterations,
  };
}

// ─── Request Handlers ───

async function handleVDFRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await parseBody(req);
  const { txHash, chainId, sender, mlBotFlagged } = body;

  if (!txHash) {
    return respond(res, 400, { error: 'Missing txHash' });
  }

  const jobId = `vdf_${++jobCounter}_${Date.now()}`;

  // Create tracked job
  const job = {
    jobId,
    status: 'computing' as const,
    progress: 0,
    estimatedTimeLeft: Math.ceil(DEMO_ITERATIONS / 166_000),
    startTime: Date.now(),
  };
  activeJobs.set(jobId, job as any);

  console.log(`[VDF Worker] Job ${jobId} started — ${DEMO_ITERATIONS.toLocaleString()} iterations`);

  // Run VDF computation in background
  computeVDFInBackground(jobId, txHash);

  respond(res, 200, { jobId });
}

async function computeVDFInBackground(jobId: string, txHash: string) {
  const job = activeJobs.get(jobId);
  if (!job) return;

  try {
    const params = getVDFParams(DEMO_ITERATIONS);
    const prover = new VDFProver(params);

    // Create challenge from txHash
    const inputBytes = Buffer.from(txHash.replace('0x', '').padEnd(64, '0').slice(0, 64), 'hex');
    const challenge: VDFChallenge = {
      input: inputBytes,
      timestamp: Date.now(),
      iterations: DEMO_ITERATIONS,
      mlBotFlagged: true,
    };

    const proof = await prover.compute(challenge, (progress, iteration) => {
      job.progress = progress;
      job.estimatedTimeLeft = Math.max(0,
        Math.ceil((100 - progress) / 100 * ((Date.now() - job.startTime) / 1000))
      );
    });

    job.status = 'complete';
    job.progress = 100;
    job.estimatedTimeLeft = 0;
    (job as any).proof = proofToHex(proof);

    console.log(`[VDF Worker] Job ${jobId} complete in ${((Date.now() - job.startTime) / 1000).toFixed(1)}s`);
  } catch (error: any) {
    job.status = 'failed';
    (job as any).error = error.message;
    console.error(`[VDF Worker] Job ${jobId} failed:`, error.message);
  }
}

function handleVDFStatus(req: http.IncomingMessage, res: http.ServerResponse, jobId: string) {
  const job = activeJobs.get(jobId);
  if (!job) {
    return respond(res, 404, { error: 'Job not found' });
  }

  // Map to SDK's expected VDFStatus format
  const status: any = {
    status: job.status === 'complete' ? 'ready' : job.status,
    progress: job.progress,
    estimatedTimeLeft: job.estimatedTimeLeft,
  };

  if (job.proof) {
    status.proof = job.proof;
  }
  if (job.error) {
    status.error = job.error;
  }

  respond(res, 200, status);
}

function handleMockProof(req: http.IncomingMessage, res: http.ServerResponse) {
  // Instant zero proof for dev/testing
  respond(res, 200, {
    output: '0x' + '0'.repeat(64),
    proof: '0x',
    iterations: 0,
  });
}

function handleHealth(res: http.ServerResponse) {
  respond(res, 200, {
    status: 'ok',
    service: 'vdf-worker',
    localCompute: true,
    activeJobs: activeJobs.size,
    demoIterations: DEMO_ITERATIONS,
  });
}

// ─── Server ───

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    if (req.method === 'POST' && path === '/vdf/request') {
      return handleVDFRequest(req, res);
    }
    if (req.method === 'GET' && path.startsWith('/vdf/status/')) {
      const jobId = path.split('/vdf/status/')[1];
      return handleVDFStatus(req, res, jobId);
    }
    if (req.method === 'POST' && path === '/vdf/mock') {
      return handleMockProof(req, res);
    }
    if (req.method === 'GET' && path === '/health') {
      return handleHealth(res);
    }

    respond(res, 404, { error: 'Not found' });
  } catch (error: any) {
    respond(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n VDF Worker running on http://localhost:${PORT}`);
  console.log(`  POST /vdf/request   — Start VDF computation`);
  console.log(`  GET  /vdf/status/:id — Poll job status`);
  console.log(`  POST /vdf/mock      — Instant mock proof`);
  console.log(`  GET  /health        — Health check`);
  console.log(`\n  Mode: Local compute (lib/vdf Wesolowski prover)`);
  console.log(`  Demo iterations: ${DEMO_ITERATIONS.toLocaleString()} (production: 300,000,000)`);
  console.log(`  Estimated compute: ~${Math.max(1, Math.ceil(DEMO_ITERATIONS / 166_000))}s per proof\n`);
});
