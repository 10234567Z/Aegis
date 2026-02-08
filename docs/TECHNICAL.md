# Technical Documentation

> Complete technical reference for DeFiGuardian (Aegis Protocol)

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Deployed Contracts (Sepolia)](#deployed-contracts-sepolia)
- [Services & Ports](#services--ports)
- [SDK (`sdk/`)](#sdk)
  - [Quick Start](#sdk-quick-start)
  - [Core Modules](#sdk-core-modules)
  - [Types Reference](#sdk-types-reference)
  - [Exported API Surface](#sdk-exported-api-surface)
- [ML Agent (`agent/`)](#ml-agent)
  - [Endpoints](#agent-endpoints)
  - [SSE Real-Time Events](#sse-real-time-events)
  - [ML Model Details](#ml-model-details)
- [Guardian Mock (`guardian-mock/`)](#guardian-mock)
  - [Endpoints](#guardian-endpoints)
  - [Voting Logic](#voting-logic)
- [VDF Worker (`lib/vdf/server.ts`)](#vdf-worker)
  - [Endpoints](#vdf-endpoints)
  - [VDF Internals](#vdf-internals)
- [Cryptographic Libraries (`lib/`)](#cryptographic-libraries)
  - [FROST Threshold Signatures (`lib/frost/`)](#frost-threshold-signatures)
  - [VDF Prover (`lib/vdf/`)](#vdf-prover)
  - [ZK Circuits (`lib/zk/`)](#zk-circuits)
- [Smart Contracts (`contracts/`)](#smart-contracts)
  - [SecurityMiddleware](#securitymiddleware)
  - [GuardianRegistry](#guardianregistry)
  - [Verifiers](#verifiers)
  - [GuardianHook (Uniswap v4)](#guardianhook-uniswap-v4)
  - [ENSSecurityProfile](#enssecurityprofile)
  - [CrossChainMessenger](#crosschainmessenger)
  - [Contract ABIs (for Frontend)](#contract-abis-for-frontend)
- [Demo Scripts](#demo-scripts)
- [Transaction Flow (End-to-End)](#transaction-flow-end-to-end)
- [Frontend Integration Guide](#frontend-integration-guide)
- [Running Locally](#running-locally)
- [Environment Variables](#environment-variables)
- [Protocol Constants](#protocol-constants)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                          USER / dApp                                 │
│                     (Frontend / Wallet)                              │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     SDK SecurityMiddleware                           │
│               sdk/core/middleware.ts                                 │
│                                                                      │
│  executeSecurely(intent, onProgress, sender)                         │
│    ├── 0. Pre-flight: isPaused? isBlacklisted?        [on-chain]     │
│    ├── 0.5 LI.FI cross-chain routing                  [LI.FI API]    │
│    ├── 0.55 ENS security profile lookup               [ENS]          │
│    ├── 0.6 ML Agent analysis (auto if sender given)   [HTTP :5000]   │
│    ├── 1. VDF computation (if ML flagged)      ──┐    [HTTP :3000]   │
│    └── 2. Guardian voting (parallel)            ──┤    [HTTP :3001]  │
│         └── FROST threshold signature            │                   │
│    ├── 3. On-chain execution                  ◄──┘    [Sepolia TX]   │
│    └── 4. Cross-chain confirmation (if bridge)        [LI.FI]        │
└──────────────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
   ┌────────────┐    ┌──────────────┐    ┌─────────────────┐
   │  ML Agent  │    │  Guardian    │    │  VDF Worker     │
   │  :5000     │    │  Network     │    │  :3000          │
   │            │    │  :3001       │    │                 │
   │ XGBoost    │    │ 10 guardians │    │ Wesolowski VDF  │
   │ 47 features│    │ FROST signing│    │ RSA-2048        │
   │ Etherscan  │    │ ZK voting    │    │ 50k iter (demo) │
   └────────────┘    └──────────────┘    └─────────────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               ▼
   ┌──────────────────────────────────────────────────────────────┐
   │              Sepolia Smart Contracts                         │
   │                                                              │
   │  SecurityMiddleware ──► GuardianRegistry                     │
   │       │                      │                               │
   │       ├── VDFVerifier        ├── ZKVoteVerifier              │
   │       ├── FROSTVerifier      └── CrossChainMessenger         │
   │       └── Groth16Verifier                                    │
   └──────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
DeFiGuardian/
├── sdk/                          # TypeScript SDK — main integration point
│   ├── index.ts                  # Public API exports
│   ├── core/
│   │   ├── middleware.ts         # SecurityMiddleware orchestrator (the "Airlock")
│   │   ├── contract.ts          # On-chain contract interactions
│   │   ├── VDF.ts               # VDF client (HTTP requests to worker)
│   │   ├── ZK.ts                # ZK vote client (polls Guardian API)
│   │   ├── lifi.ts              # LI.FI cross-chain integration
│   │   ├── ens.ts               # ENS security profiles
│   │   ├── crosschain.ts        # Cross-chain security sync (LayerZero)
│   │   ├── constants.ts         # Protocol constants & deployed addresses
│   │   ├── types.ts             # Shared types (votes, proofs, proposals)
│   │   └── adapters.ts          # Buffer↔string type converters
│   └── mockExamples/            # 5 demo scripts + shared utilities
│
├── agent/                        # Python ML Agent (Flask API)
│   ├── main.py                  # Flask server — /analyze, /review, /events
│   ├── src/
│   │   ├── model.py             # XGBoost fraud detector + SHAP explanations
│   │   ├── features.py          # 47-feature computation from Etherscan data
│   │   └── etherscan.py         # Etherscan V2 API client
│   └── models/
│       ├── eth_fraud_xgb.json   # Trained XGBoost model weights
│       └── preprocessors.pkl    # Feature scalers (StandardScaler)
│
├── guardian-mock/                # Mock Guardian Network (Express server)
│   └── src/
│       ├── server.ts            # Express API — /proposals/submit, status
│       └── mockFrost.ts         # Simplified FROST signing simulation
│
├── lib/                          # Cryptographic libraries
│   ├── frost/                   # FROST threshold signatures (Ed25519)
│   ├── vdf/                     # VDF (Verifiable Delay Function)
│   └── zk/                      # Zero-Knowledge voting circuits
│
├── contracts/                    # Solidity smart contracts
│   ├── SecurityMiddleware.sol   # Main airlock (queue + execute)
│   ├── GuardianRegistry.sol     # Security state manager
│   ├── ENSSecurityProfile.sol   # ENS text record reader
│   ├── CrossChainMessenger.sol  # LayerZero cross-chain messaging
│   ├── hooks/
│   │   └── GuardianHook.sol     # Uniswap v4 Hook integration
│   └── verifiers/
│       ├── VDFVerifier.sol      # On-chain VDF verification
│       ├── FROSTVerifier.sol    # Ed25519 Schnorr signature verification
│       └── ZKVoteVerifier.sol   # Groth16 ZK proof verification
│
├── deploy/                       # Hardhat deployment
│   ├── scripts/
│   └── deployed-addresses.json  # Current Sepolia addresses
│
└── ML_bot/
    └── DefGuard_MLbot.ipynb     # Jupyter notebook for model training
```

---

## Deployed Contracts (Sepolia)

| Contract | Address | Role |
|----------|---------|------|
| **SecurityMiddleware** | `0x8A4364c08147b1Ec0025e7B1e848BF675f9Dc7b9` | Main airlock — queue + execute transactions |
| **GuardianRegistry** | `0x702e8307Bc9c8EC7489C6f9e5562EdA44bB9fB7d` | Security state, proposals, guardian management |
| **VDFVerifier** | `0xFAf997119B0FFDF62E149Cbfc3713267a7C8DaEA` | On-chain VDF proof verification |
| **Groth16Verifier** | `0x42D098fE28Ae3923Ac972EB1b803f3e295EFEE7D` | ZK proof verification (snarkjs-generated) |
| **FROSTVerifier** | `0x02a59687A130D198a23F790866500489F6f88C12` | FROST threshold signature verification |
| **ZKVoteVerifier** | `0xb638C0997778F172ba4609B8E20252483cD87eEE` | Guardian voting with ZK privacy |
| **GuardianHook** | `0xFce40025E4a77D5395188d82657A728521D839ec` | Uniswap v4 Hook — enforces security on swaps |

**Deployer**: `0x69E135540F4F5B69592365DFE7730c08ACe96CCb`
**Network**: Sepolia (Chain ID: `11155111`)
**Uniswap v4 PoolManager**: `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`

---

## Services & Ports

| Service | Port | Tech | Purpose |
|---------|------|------|---------|
| **ML Agent** | `5000` | Python/Flask | Fraud detection, Etherscan analysis, SSE events |
| **VDF Worker** | `3000` | Node.js/HTTP | Wesolowski VDF time-lock computation |
| **Guardian Mock** | `3001` | Node.js/Express | Guardian network, FROST signing, voting |

---

## SDK

### SDK Quick Start

```typescript
import { createSecurityMiddleware, createTestnetMiddleware } from '@sackmoney/sdk';
import { ethers } from 'ethers';

// Option A: Quick setup for Sepolia
const middleware = createTestnetMiddleware(provider, signer, {
  vdfWorkerUrl: 'http://localhost:3000',
  guardianApiUrl: 'http://localhost:3001',
  agentApiUrl: 'http://localhost:5000',
});

// Option B: Manual setup
const middleware = createSecurityMiddleware({
  security: {
    middlewareAddress: '0x8A4364c08147b1Ec0025e7B1e848BF675f9Dc7b9',
    registryAddress: '0x702e8307Bc9c8EC7489C6f9e5562EdA44bB9fB7d',
    chainId: 11155111,
  },
  vdfWorkerUrl: 'http://localhost:3000',
  guardianApiUrl: 'http://localhost:3001',
  agentApiUrl: 'http://localhost:5000',
  provider,
  signer,
});

// Execute a transaction through the security airlock
const result = await middleware.executeSecurely(
  {
    type: 'swap',
    target: '0xUniswapRouter...',
    data: '0xSwapCalldata...',
    value: 0n,
    amount: ethers.parseEther('100'),
    sourceChain: 11155111,
  },
  (progress) => {
    console.log(`[${progress.stage}] ${progress.message}`);
  },
  senderAddress,
);
```

### SDK Core Modules

| Module | File | Responsibility |
|--------|------|----------------|
| **SecurityMiddleware** | `sdk/core/middleware.ts` | Main orchestrator — the "Cryptographic Airlock" |
| **SecurityContract** | `sdk/core/contract.ts` | On-chain reads/writes (queue, execute, isPaused, isBlacklisted) |
| **VDFClient** | `sdk/core/VDF.ts` | HTTP client for VDF worker (request proof, poll status) |
| **ZKVoteClient** | `sdk/core/ZK.ts` | Polls Guardian API for voting status, waits for result |
| **LiFiClient** | `sdk/core/lifi.ts` | LI.FI cross-chain quote/route/execute |
| **ENSSecurityClient** | `sdk/core/ens.ts` | Reads ENS text records for user security preferences |
| **CrossChainSync** | `sdk/core/crosschain.ts` | LayerZero security event propagation |
| **Constants** | `sdk/core/constants.ts` | Deployed addresses, thresholds, iteration counts |
| **Types** | `sdk/core/types.ts` | Shared types (votes, proofs, proposals) |
| **Adapters** | `sdk/core/adapters.ts` | Buffer↔string converters for lib/ interop |

### SDK Types Reference

#### `TransactionIntent`

```typescript
interface TransactionIntent {
  type: 'swap' | 'bridge' | 'generic';
  target: string;          // Target contract address
  data: string;            // Encoded calldata (0x...)
  value: bigint;           // ETH value in wei
  amount: bigint;          // Display amount in wei
  sourceChain: number;     // Chain ID (11155111 for Sepolia)
  destChain?: number;      // Destination chain (for bridges)
  mlBotFlagged?: boolean;  // Force ML flag (auto-detected if omitted)
  forceGuardianOutcome?: 'approve' | 'reject';  // Testing only
}
```

#### `ExecutionResult`

```typescript
interface ExecutionResult {
  success: boolean;
  txHash: string;                          // On-chain TX hash
  receipt: ethers.TransactionReceipt;
  vdfProof: VDFProof;                      // { output, proof, iterations }
  frostSignature: FrostSignature;          // { signature, message, publicKey }
  executionTime: number;                   // Total ms
  ensName?: string;                        // Resolved ENS name
  ensSecurityProfile?: SecurityProfile;    // User's ENS preferences
}
```

#### `ExecutionProgress`

```typescript
interface ExecutionProgress {
  stage: 'submitted' | 'vdf-pending' | 'voting-pending' | 'ready' | 'executing' | 'complete' | 'failed';
  vdfStatus?: VDFStatus;
  voteStatus?: VoteStatus;
  message: string;
}
```

#### `VoteStatus`

```typescript
interface VoteStatus {
  proposalId: string;
  phase: 'commit' | 'reveal' | 'complete' | 'expired';
  votes: {
    approve: number;   // 0-10
    reject: number;    // 0-10
    abstain: number;   // 0-10
    pending: number;   // 0-10
  };
  threshold: number;           // Required approvals (7)
  isApproved: boolean;         // approve >= 7
  isRejected: boolean;         // reject > 3
  frostSignature?: { R: string; z: string; };
  expiresAt: number;
}
```

#### `SecurityProfile` (ENS)

```typescript
interface SecurityProfile {
  threshold: bigint;       // Flag TXs above this amount (wei). 0 = disabled
  delay: number;           // Extra delay seconds for flagged TXs
  whitelist: string[];     // Allowed protocols (ENS names or addresses)
  mode: SecurityMode;      // 'strict' | 'normal' | 'paranoid'
  notifyUrl?: string;      // Webhook URL for alerts
  hasProfile: boolean;     // Whether user has set any ENS profile
}
```

### SDK Exported API Surface

```typescript
// Core
export { SecurityMiddleware, createSecurityMiddleware }
export { SecurityContract }
export { VDFClient, getVDFClient }
export { ZKVoteClient, getZKVoteClient }
export { LiFiClient, getLiFiClient, getQuickQuote, LiFiError }
export { ENSSecurityClient, createENSSecurityClient, getENSSecurityClient }
export { CrossChainSync, CrossChainBroadcaster, SecurityEventEncoder }

// Quick Setup
export { createMainnetMiddleware }
export { createTestnetMiddleware }
export { createLocalMiddleware }

// Constants
export { PROTOCOL_ADDRESSES }
export { GUARDIAN_COUNT }            // 10
export { GUARDIAN_THRESHOLD }        // 7
export { VDF_ITERATIONS }           // 300_000_000
export { VDF_DELAY_SECONDS }        // 1800 (30 min)
export { ML_BOT_THRESHOLD }         // 50
export { VOTE_VALUES }
export { LIFI_API_URL, LIFI_INTEGRATOR_ID, NATIVE_TOKEN, LIFI_DIAMOND }

// ENS
export { ENS_KEY_PREFIX }  // 'defi.guardian'
export { ENS_KEYS }
export { DEFAULT_PROFILE }

export const VERSION = '1.0.0';
```

---

## ML Agent

**Stack**: Python 3.11+, Flask, XGBoost, SHAP, Etherscan V2 API
**Location**: `agent/`
**Port**: `5000`

### Agent Endpoints

#### `GET /health`

```json
{ "status": "ok", "model_loaded": true }
```

#### `POST /analyze` — Quick Fraud Score

```json
// Request
{ "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18" }

// Response
{
  "address": "0x742d...",
  "is_fraud": false,
  "score": 47.3,
  "verdict": "suspicious",
  "recommendation": "review"
}
```

#### `POST /review` — Full Flow (SDK Integration Point)

```json
// Request
{
  "guardianApiUrl": "http://localhost:3001",
  "proposal": {
    "txHash": "0xabc123...",
    "sender": "0x69E135...",
    "senderENS": "alice.eth",
    "target": "0xUniswap...",
    "value": "1000000000000000000",
    "data": "0x...",
    "chainId": 11155111,
    "amount": "1000000000000000000"
  }
}

// Response
{
  "proposalId": "0xabc12345...",
  "mlAnalysis": { "score": 47.3, "verdict": "suspicious", "flagged": false },
  "guardianStatus": { "submitted": true, "proposalId": "0xabc12345..." }
}
```

### SSE Real-Time Events

```javascript
const evtSource = new EventSource('http://localhost:5000/events');

evtSource.addEventListener('review', (event) => {
  const data = JSON.parse(event.data);
  console.log('New review:', data);
});
```

### ML Model Details

- **Algorithm**: XGBoost (gradient-boosted trees)
- **Features**: 47 features computed from Etherscan transaction history
- **Flag threshold**: Score >= `50` → flagged for VDF delay

---

## Guardian Mock

**Stack**: Node.js, Express, TypeScript
**Location**: `guardian-mock/`
**Port**: `3001`

### Guardian Endpoints

#### `POST /proposals/submit` — Submit Proposal for Voting

```json
// Request
{
  "txHash": "0xabc123...",
  "sender": "0x69E135...",
  "target": "0xUniswap...",
  "value": "1000000000000000000",
  "mlScore": 47.3,
  "mlFlagged": false,
  "forceOutcome": "auto"
}

// Response
{
  "proposalId": "0xabc12345000000...",
  "status": "pending",
  "message": "Proposal submitted, voting in progress"
}
```

#### `GET /proposals/:id/status` — Full Status (SDK Polling)

```json
{
  "proposalId": "0xabc12345...",
  "phase": "complete",
  "votes": { "approve": 8, "reject": 1, "abstain": 1, "pending": 0 },
  "threshold": 7,
  "isApproved": true,
  "isRejected": false,
  "frostSignature": { "R": "0x...", "z": "0x..." }
}
```

### Voting Logic

| ML Score | `forceOutcome` | Result |
|----------|---------------|--------|
| Any | `"approve"` | 8 approve, 1 reject |
| Any | `"reject"` | 1 approve, 8 reject |
| >= 70 | `"auto"` | 1 approve, 8 reject (HIGH RISK) |
| 50–69 | `"auto"` | 3 approve, 6 reject (MEDIUM RISK) |
| < 50 | `"auto"` | 8 approve, 1 reject (LOW RISK) |

---

## VDF Worker

**Stack**: Node.js, HTTP server
**Location**: `lib/vdf/server.ts`
**Port**: `3000`

### VDF Endpoints

#### `POST /vdf/request` — Start VDF Computation

```json
// Request
{
  "txHash": "0xabc123...",
  "chainId": 11155111,
  "sender": "0x69E135...",
  "mlBotFlagged": true,
  "iterations": 300000000
}

// Response
{ "jobId": "vdf_1_1707400000000" }
```

#### `GET /vdf/status/:jobId` — Poll Progress

```json
// Computing
{ "status": "computing", "progress": 45, "estimatedTimeLeft": 2 }

// Ready
{
  "status": "ready",
  "progress": 100,
  "proof": { "output": "0xabcdef...", "proof": "0x123456...", "iterations": 50000 }
}
```

### VDF Internals

- **Algorithm**: Wesolowski VDF — `y = x^(2^T) mod N`
- **Modulus**: RSA-2048
- **Demo iterations**: `50,000` (~1 second)
- **Production iterations**: `300,000,000` (~30 minutes)
- **Sequential**: Cannot be parallelized

---

## Cryptographic Libraries

### FROST Threshold Signatures (`lib/frost/`)

7-of-10 Schnorr threshold signatures on Ed25519.

```typescript
import { performDKG, FROSTCoordinator, aggregateSignatureShares } from 'lib/frost';

const dkgOutput = performDKG({ threshold: 7, totalParticipants: 10 });
const signature = aggregateSignatureShares(shares, commitments, message, groupPublicKey);
```

### VDF Prover (`lib/vdf/`)

Wesolowski VDF with RSA-2048 modulus.

```typescript
import { VDFProver, getVDFParams, VDFVerifier } from 'lib/vdf';

const params = getVDFParams(50000);
const prover = new VDFProver(params);
const proof = await prover.compute(challenge, (progress) => console.log(`${progress}%`));
```

### ZK Circuits (`lib/zk/`)

Circom + snarkjs Groth16 for private guardian voting.

**Circuit**: `GuardianVote.circom`
Proves: Voter is one of 10 valid guardians, owns their private key, vote matches commitment.

---

## Smart Contracts

### SecurityMiddleware

**Address**: `0x8A4364c08147b1Ec0025e7B1e848BF675f9Dc7b9`

The main "Cryptographic Airlock". Two-step execution:

```solidity
function queueTransaction(bytes32 txHash, address sender, address destination, uint256 value, bool mlBotFlagged, bytes calldata txData) external returns (bytes32 proposalId)
function executeTransaction(bytes32 txHash, bytes calldata vdfProof, bytes32 frostR, bytes32 frostZ) external
function isPaused() external view returns (bool)
function blacklistedAddresses(address) external view returns (bool)
```

### GuardianRegistry

**Address**: `0x702e8307Bc9c8EC7489C6f9e5562EdA44bB9fB7d`

Security state manager. Creates proposals, listens for ZK vote results.

### Verifiers

- **VDFVerifier** (`0xFAf997119B0FFDF62E149Cbfc3713267a7C8DaEA`) — On-chain VDF verification
- **FROSTVerifier** (`0x02a59687A130D198a23F790866500489F6f88C12`) — Ed25519 Schnorr verification
- **ZKVoteVerifier** (`0xb638C0997778F172ba4609B8E20252483cD87eEE`) — Groth16 ZK proof verification

### GuardianHook (Uniswap v4)

**Location**: `contracts/hooks/GuardianHook.sol`

Uniswap v4 Hook enforcing security on every swap:
- `beforeSwap`: Checks blacklist, pause state, ENS security profile
- `afterSwap`: Logs large swaps for monitoring
- `beforeAddLiquidity`: Verifies LP addresses

### ENSSecurityProfile

**Location**: `contracts/ENSSecurityProfile.sol`

On-chain reader for ENS-based security preferences.

| Key | Example |
|-----|---------|
| `defi.guardian.threshold` | `"10000000000000000000"` (10 ETH) |
| `defi.guardian.mode` | `"strict"` / `"normal"` / `"paranoid"` |
| `defi.guardian.whitelist` | `"uniswap.eth,aave.eth"` |

### CrossChainMessenger

**Location**: `contracts/CrossChainMessenger.sol`

LayerZero-based cross-chain security event propagation.

---

## Demo Scripts

```bash
cd sdk

# Sepolia mode (real on-chain execution)
npx ts-node mockExamples/smallTx.ts --sepolia
npx ts-node mockExamples/bigTxPass.ts --sepolia
npx ts-node mockExamples/bigTxFail.ts --sepolia
npx ts-node mockExamples/BigTxCrossPass.ts --sepolia
npx ts-node mockExamples/SmallTxCross.ts --sepolia
```

| # | Script | Scenario | Result |
|---|--------|----------|--------|
| 1 | `smallTx` | 0.1 ETH same-chain | **PASS** |
| 2 | `bigTxPass` | 500 ETH + VDF + guardian approve | **PASS** |
| 3 | `bigTxFail` | 1000 ETH attack, guardian reject | **BLOCKED** |
| 4 | `BigTxCrossPass` | 500 ETH cross-chain | **PASS** |
| 5 | `SmallTxCross` | 0.5 ETH cross-chain | **PASS** |

---

## Transaction Flow (End-to-End)

```
User submits TransactionIntent
        │
        ▼
[0] PRE-FLIGHT: isPaused? isBlacklisted?
        │
        ▼
[0.5] ROUTE (if cross-chain): LI.FI API
        │
        ▼
[0.55] ENS PROFILE: Read user's security preferences
        │
        ▼
[0.6] ML AGENT: Analyze sender, flag if suspicious
        │
        ▼
[1-2] PARALLEL: VDF computation + Guardian voting
        │
        ▼
[3] ON-CHAIN: queueTransaction → executeTransaction
        │
        ▼
[4] RESULT: { txHash, vdfProof, frostSignature }
```

---

## Running Locally

### Prerequisites

- Node.js 18+
- Python 3.11+
- Sepolia RPC URL
- Funded Sepolia wallet (>0.01 ETH)

### Start Services

```bash
# Terminal 1: ML Agent (port 5000)
cd agent && uv run python main.py

# Terminal 2: Guardian Mock (port 3001)
cd guardian-mock && npm install && npx ts-node src/server.ts

# Terminal 3: VDF Worker (port 3000)
cd lib/vdf && npm install && npx ts-node server.ts
```

### Run Demo

```bash
cd sdk && npm install
npx ts-node mockExamples/smallTx.ts --sepolia
```

---

## Environment Variables

### `deploy/.env`

```env
PRIVATE_KEY=0x...
SEPOLIA_RPC_URL=https://...
ETHERSCAN_API_KEY=...
```

### `agent/.env`

```env
ETHERSCAN_API_KEY=...
PORT=5000
```

### VDF Worker

```env
VDF_PORT=3000
VDF_ITERATIONS=50000
```

---

## Protocol Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `GUARDIAN_COUNT` | `10` | Total guardians |
| `GUARDIAN_THRESHOLD` | `7` | Required approvals |
| `REJECTION_THRESHOLD` | `4` | Rejections to block |
| `VDF_ITERATIONS` | `300,000,000` | Production (30 min) |
| `VDF_DELAY_SECONDS` | `1800` | Fixed delay when flagged |
| `ML_BOT_THRESHOLD` | `50` | Score >= 50 = flagged |
| `VOTE_APPROVE` | `1` | Circuit value |
| `VOTE_REJECT` | `0` | Circuit value |
| `VOTE_ABSTAIN` | `2` | Circuit value |
