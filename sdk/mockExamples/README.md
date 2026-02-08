# DeFi Guardian - Demo Scripts

Simulation scripts demonstrating the Guardian Protocol security flow. Each script uses **real FROST cryptography** (DKG + threshold signatures) while simulating ML Bot analysis, ZK voting, and VDF time-locks.

Supports two modes:

- **Mock mode** (default) — all components simulated locally, no services required.
- **Live mode** (`--live`) — uses real Hardhat node, ML Agent, Guardian Mock, VDF Worker, and on-chain contract execution.

## Quick Start (Mock Mode)

```bash
cd sdk

# Run all 5 demos in sequence
npm run demo

# Run individually
npm run demo:1   # Small TX Same-Chain Pass
npm run demo:2   # Big TX Slow Pass (Same-Chain)
npm run demo:3   # Big TX Slow Fail (Same-Chain)
npm run demo:4   # Big TX Cross-Chain Pass
npm run demo:5   # Small TX Cross-Chain Fail

# Skip delays (instant output for development)
npm run demo -- --fast
FAST_MODE=1 npm run demo:2
```

## Live Mode Setup

Live mode runs against real local infrastructure. Follow these steps in order.

### Prerequisites

- Node.js (v18+)
- Python 3.11+ with [uv](https://github.com/astral-sh/uv)
- Homebrew (macOS)

### Step 1: Install system dependencies

XGBoost (used by the ML Agent) requires the OpenMP runtime:

```bash
brew install libomp
```

### Step 2: Install project dependencies

```bash
# Deploy project (Hardhat + contracts)
cd deploy
npm install

# VDF Worker
cd ../lib/vdf-worker
npm install

# Guardian Mock
cd ../../guardian-mock
npm install

# SDK
cd ../sdk
npm install
```

### Step 3: Compile Solidity contracts

The Hardhat config expects contract sources in `deploy/all-contracts/`. This directory uses symlinks pointing to the actual contract files spread across the repo.

If `deploy/all-contracts/` does not exist, create it:

```bash
cd deploy
mkdir -p all-contracts/verifiers all-contracts/interfaces

# Root contracts
ln -s ../../contracts/SecurityMiddleware.sol all-contracts/
ln -s ../../contracts/GuardianRegistry.sol all-contracts/
ln -s ../../contracts/CrossChainMessenger.sol all-contracts/

# Verifiers
ln -s ../../../contracts/verifiers/VDFVerifier.sol all-contracts/verifiers/
ln -s ../../../contracts/verifiers/FROSTVerifier.sol all-contracts/verifiers/
ln -s ../../../contracts/verifiers/ZKVoteVerifier.sol all-contracts/verifiers/

# Interfaces
ln -s ../../../contracts/interfaces/ILayerZeroEndpoint.sol all-contracts/interfaces/

# Groth16Verifier (from lib/zk)
ln -s ../../lib/zk/contracts/GuardianVoteVerifier.sol all-contracts/
```

Then compile:

```bash
cd deploy
npx hardhat compile
```

You should see `Compiled 8 Solidity files successfully`.

### Step 4: Start all services

Open **four** separate terminals:

```bash
# Terminal 1 — Hardhat Node (local blockchain)
cd deploy
npx hardhat node

# Terminal 2 — ML Agent (fraud detection)
cd agent
uv run main.py

# Terminal 3 — Guardian Mock (FROST voting)
cd guardian-mock
npm run start

# Terminal 4 — VDF Worker (time-lock computation)
cd lib/vdf-worker
npm run dev
```

Or use the convenience script (starts Hardhat, Agent, and Guardian Mock in the background):

```bash
cd deploy
./scripts/start-local.sh
# Then start VDF Worker separately:
cd lib/vdf-worker && npm run dev
```

### Step 5: Run the live demo

```bash
cd sdk

# Run all 5 demos against live infrastructure
npm run demo:live

# Run individually
npm run demo:live:1
npm run demo:live:2
npm run demo:live:3
npm run demo:live:4
npm run demo:live:5
```

The script will:
1. Health-check all four services
2. Auto-deploy contracts to Hardhat if not already deployed
3. Run each demo against the real APIs

### Services Overview

| Service | Port | Purpose |
|---------|------|---------|
| Hardhat Node | 8545 | Local EVM blockchain |
| ML Agent | 5000 | Fraud detection (XGBoost model) |
| Guardian Mock | 3001 | FROST DKG + threshold voting |
| VDF Worker | 3000 | Verifiable Delay Function computation |

### Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `HHE22: non-local installation of Hardhat` | Hardhat not installed in `deploy/` | `cd deploy && npm install` |
| `XGBoostError: libomp.dylib could not be loaded` | Missing OpenMP runtime | `brew install libomp` |
| `HH700: Artifact for contract "VDFVerifier" not found` | Contracts not compiled | Create `deploy/all-contracts/` symlinks and run `npx hardhat compile` (see Step 3) |
| Script hangs at "Bypassing VDF job" | VDF computation blocking event loop | Update VDF Worker (`lib/vdf-worker`) and restart it |
| `Live mode requires all services. Missing: ...` | One or more services not running | Check each service port with `lsof -i :PORT` |

## Scenarios

| # | Script | Amount | ML Score | VDF | Votes | Result |
|---|--------|--------|----------|-----|-------|--------|
| 1 | `smallTx.ts` | 10 ETH | 15 (safe) | No | 8A / 1R / 1Ab | PASS |
| 2 | `bigTxPass.ts` | 500 ETH | 75 (suspicious) | Bypassed | 7A / 2R / 1Ab | PASS |
| 3 | `bigTxFail.ts` | 1000 ETH | 95 (attack) | Cancelled | 2A / 7R / 1Ab | FAIL |
| 4 | `BigTxCrossPass.ts` | 200 ETH | 75 (suspicious) | Bypassed | 9A / 0R / 1Ab | PASS |
| 5 | `SmallTxCross.ts` | 5 ETH | 99 (blacklisted) | Cancelled | 1A / 8R / 1Ab | FAIL |

**A** = Approve, **R** = Reject, **Ab** = Abstain

## How It Works

```
TX Submitted
     |
ML Bot Analysis (score 0-100)
     |
score >= 50? ──Yes──> VDF Time-Lock (30 min)
     |                      |
     No              Runs in parallel
     |                      |
Guardian ZK Voting (7/10 to approve)
     |
Approved? ──Yes──> FROST Signature ──> Execute (VDF bypassed if pending)
     |
Rejected? ──Yes──> FROST Rejection Sig ──> Block TX (VDF cancelled)
```

## File Structure

```
mockExamples/
  shared/
    utils.ts          # Logging, formatting, ML Bot simulation
    mockGuardians.ts  # Real FROST DKG + voting simulation
    mockLifi.ts       # Cross-chain bridge simulation
    liveMode.ts       # Service health checks, contract deployment, live config
    liveClients.ts    # HTTP client wrappers for live API calls
    index.ts          # Re-exports
  smallTx.ts          # Use Case 1: Clean small TX
  bigTxPass.ts        # Use Case 2: Flagged TX, guardians approve
  bigTxFail.ts        # Use Case 3: Attack detected, guardians reject
  BigTxCrossPass.ts   # Use Case 4: Cross-chain bridge approved
  SmallTxCross.ts     # Use Case 5: Blacklisted destination blocked
  runAll.ts           # Orchestrator for all 5 scripts
```

## Key Constants (from `sdk/core/constants.ts`)

| Constant | Value | Description |
|----------|-------|-------------|
| `ML_BOT_THRESHOLD` | 50 | Score >= 50 triggers VDF |
| `VDF_ITERATIONS` | 300M | Sequential hash iterations |
| `VDF_DELAY_SECONDS` | 1800 | 30 minute fixed delay |
| `GUARDIAN_THRESHOLD` | 7/10 | Approvals to execute |
| `REJECTION_THRESHOLD` | 4/10 | Rejections to block |
