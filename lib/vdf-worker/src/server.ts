/**
 * VDF Worker Server
 *
 * Express server that computes VDF proofs for the Guardian Protocol.
 *
 * Endpoints:
 *   POST /vdf/request  - Submit a new VDF computation job
 *   GET  /vdf/status/:jobId - Get job status and proof
 *   POST /vdf/bypass/:jobId - Bypass VDF (guardian approval)
 *   POST /vdf/mock     - Generate mock proof (dev mode only)
 *   GET  /health       - Health check
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { JobManager } from './job-manager';
import { VDFRequestBody } from './types';

// --- Configuration ---

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const DEV_MODE = process.env.NODE_ENV !== 'production';
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

// --- Initialize ---

const app = express();
const jobManager = new JobManager(DEV_MODE);

app.use(cors());
app.use(express.json());

// --- Routes ---

/**
 * Health check
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    devMode: DEV_MODE,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Submit VDF computation request
 *
 * Request body:
 *   txHash: string      - Transaction hash
 *   chainId: number     - Chain ID
 *   sender: string      - Sender address
 *   iterations: number  - VDF iterations (54M for ML bot flag)
 *   mlBotFlagged: bool  - ML bot flagged this transaction
 *
 * Response:
 *   jobId: string       - Job ID for tracking
 */
app.post('/vdf/request', (req: Request, res: Response) => {
  try {
    const body = req.body as VDFRequestBody;

    // Validate request
    if (!body.txHash || !body.chainId || !body.sender || !body.iterations) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    if (!body.mlBotFlagged) {
      res.status(400).json({ error: 'VDF not required: transaction not flagged by ML bot' });
      return;
    }

    const jobId = jobManager.createJob(body);
    console.log(`[Server] New job ${jobId} created for tx ${body.txHash.slice(0, 10)}...`);

    res.json({ jobId });
  } catch (error) {
    console.error('[Server] Error creating job:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get VDF job status
 *
 * Response:
 *   status: 'pending' | 'computing' | 'ready' | 'failed' | 'bypassed'
 *   progress: number (0-100)
 *   estimatedTimeLeft: number (seconds)
 *   proof?: { output, proof, iterations }
 *   error?: string
 */
app.get('/vdf/status/:jobId', (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const status = jobManager.getStatus(jobId);

    if (!status) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json(status);
  } catch (error) {
    console.error('[Server] Error getting status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Bypass VDF computation (guardian approval)
 *
 * This allows guardians to approve a transaction without waiting
 * for the full VDF computation.
 */
app.post('/vdf/bypass/:jobId', (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const success = jobManager.bypassJob(jobId);

    if (!success) {
      res.status(400).json({ error: 'Cannot bypass job (not found or already completed)' });
      return;
    }

    console.log(`[Server] Job ${jobId} bypassed`);
    res.json({ success: true, status: 'bypassed' });
  } catch (error) {
    console.error('[Server] Error bypassing job:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Generate mock proof (dev mode only)
 *
 * Request body:
 *   txHash: string
 *   iterations: number
 *
 * Response:
 *   output: string (hex)
 *   proof: string (hex)
 *   iterations: number
 */
app.post('/vdf/mock', async (req: Request, res: Response) => {
  try {
    if (!DEV_MODE) {
      res.status(403).json({ error: 'Mock VDF not available (not in dev mode)' });
      return;
    }

    const { txHash, iterations } = req.body;

    if (!txHash || !iterations) {
      res.status(400).json({ error: 'Missing txHash or iterations' });
      return;
    }

    const proof = await jobManager.getMockProof(txHash, iterations);

    if (!proof) {
      res.status(500).json({ error: 'Failed to generate mock proof' });
      return;
    }

    console.log(`[Server] Generated mock proof for tx ${txHash.slice(0, 10)}...`);
    res.json(proof);
  } catch (error) {
    console.error('[Server] Error generating mock proof:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * List all jobs (dev mode only, for debugging)
 */
app.get('/vdf/jobs', (_req: Request, res: Response) => {
  if (!DEV_MODE) {
    res.status(403).json({ error: 'Not available in production' });
    return;
  }

  const jobs = jobManager.getAllJobs();
  res.json({
    count: jobs.length,
    jobs: jobs.map(j => ({
      jobId: j.jobId,
      txHash: j.txHash.slice(0, 10) + '...',
      status: j.status,
      progress: j.progress,
      estimatedTimeLeft: j.estimatedTimeLeft,
    })),
  });
});

// --- Periodic Cleanup ---

setInterval(() => {
  jobManager.cleanup();
}, CLEANUP_INTERVAL);

// --- Start Server ---

app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   VDF Worker Server');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   Port:     ${PORT}`);
  console.log(`   Dev Mode: ${DEV_MODE}`);
  console.log('');
  console.log('   Endpoints:');
  console.log('     POST /vdf/request     - Submit VDF job');
  console.log('     GET  /vdf/status/:id  - Get job status');
  console.log('     POST /vdf/bypass/:id  - Bypass VDF (guardian)');
  if (DEV_MODE) {
    console.log('     POST /vdf/mock        - Generate mock proof');
    console.log('     GET  /vdf/jobs        - List all jobs');
  }
  console.log('     GET  /health          - Health check');
  console.log('═══════════════════════════════════════════════════════════');
});

export default app;
