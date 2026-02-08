<div align="left">

# 🛡️ DeFiGuardian

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.26-black?style=for-the-badge&logo=solidity)](https://soliditylang.org/)
[![Python](https://img.shields.io/badge/Python-3.11-blue?style=for-the-badge&logo=python)](https://www.python.org/)
[![Circom](https://img.shields.io/badge/Circom-ZK-purple?style=for-the-badge)](https://docs.circom.io/)
[![Uniswap](https://img.shields.io/badge/Uniswap-v4_Hook-pink?style=for-the-badge)](https://uniswap.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

**The best hack is the one that never happens.**

**A cryptographic airlock that makes DeFi exploits expensive, slow, and detectable using ML threat detection, guardian consensus, and cryptographic time-locks.**

[📖 Technical Docs](docs/TECHNICAL.md) 

[🦄 Uniswap Integration](docs/UNISWAP_INTEGRATION.md) • [🔗 LI.FI Integration](docs/LIFI_INTEGRATION.md) • [📛 ENS Integration](docs/ENS_SECURITY_PROFILES.md)

---

</div>

## 🎯 The Problem We Solve

### ⚠️ Three Critical Security Crises in DeFi:

<table>
<tr>
<td width="33%">

#### 🔓 **Single Points of Failure**
- **Admin keys get compromised** through phishing, malware, or insiders
- **One key = total control** over protocol funds

</td>
<td width="33%">

#### ⚡ **Attacks Complete Instantly**
- **Exploits happen in one block** — no time to react
- **$3.8B stolen in 2022** with most hacks taking seconds

</td>
<td width="33%">

#### 🏝️ **Chains Are Isolated**
- **Attackers hop between chains** after draining one
- **No cross-chain coordination** for security responses

</td>
</tr>
</table>

### 📊 Market Reality
- **$3.8B** stolen from DeFi protocols in 2022 alone
- **Many hacked protocols were audited** — audits aren't enough
- **Zero** security infrastructure that works across chains

---

## 🚀 The DeFiGuardian Solution

<div align="left">

**DeFiGuardian creates a mandatory security checkpoint between users and protocols. Think of it like an airlock on a spaceship — nothing gets through without proper verification. By combining ML threat detection, distributed guardian consensus, cryptographic time-locks, and cross-chain coordination, we turn "seconds to exploit" into "30 minutes to defend".**

</div>

### ✨ Key Features:

<table>
<tr>
<td width="50%">

#### 🤖 **ML Threat Detection**
- AI trained on thousands of past exploits
- Catches flash loans, oracle manipulation, unusual patterns
- Flags suspicious transactions before execution

#### 🔐 **No Single Point of Failure**
- 10 independent guardians, need 7/10 to approve
- FROST threshold signatures — no admin keys
- ZK private voting — can't bribe individual guardians

</td>
<td width="50%">

#### ⏱️ **Forced Time Delays**
- 30-minute VDF lock on suspicious transactions
- Can't be parallelized — attackers can't speed it up
- Guardians can bypass by voting to approve

#### 🌐 **Cross-Chain Security**
- Threat detected on Ethereum? All chains know instantly
- Emergency pause propagates everywhere via LayerZero
- Blacklisted addresses blocked on every chain

</td>
</tr>
</table>

<img src="docs/architecture.png" alt="DeFiGuardian Architecture" width="100%" />

---

## 🛠️ Technical Architecture

### 🔧 Core Technologies
<table>
  <tr>
    <td width="33%" align="center">

#### 🔐 **FROST**
**Threshold Signatures**
7-of-10 Ed25519 Schnorr signing

  </td>
    <td width="33%" align="center">

#### ⏱️ **VDF**
**Verifiable Delay Functions**
Wesolowski with RSA-2048

  </td>
    <td width="33%" align="center">

#### 🎭 **ZK Proofs**
**Private Guardian Voting**
Groth16 via Circom + snarkjs

  </td>
  </tr>

  <tr>
    <td width="33%" align="center">

#### 🤖 **XGBoost ML**
**Fraud Detection**
47 features from Etherscan data

  </td>
    <td width="33%" align="center">

#### 🦄 **Uniswap v4**
**Hook Integration**
Security built into every swap

  </td>
    <td width="33%" align="center">

#### 🔗 **LI.FI + LayerZero**
**Cross-Chain**
Routing & security propagation

  </td>
  </tr>
</table>


### The Security Flow:

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: User Intent                                         │
│ - Transaction submitted to SDK                              │
│ - Pre-flight: Is protocol paused? Is sender blacklisted?    │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Step 2: ML Analysis                                         │
│ - XGBoost model analyzes sender history (47 features)       │
│ - Score >= 50 = FLAGGED for VDF delay                       │
│ - ENS security profile applied if user has one              │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Step 3: Parallel Processing                                 │
│                                                             │
│  ┌──────────────────┐     ┌──────────────────────────────┐  │
│  │  VDF Time-Lock   │     │  Guardian Network            │  │
│  │  (if flagged)    │     │  10 guardians vote           │  │
│  │                  │     │  ZK proofs for privacy       │  │
│  │  30 min delay    │     │  FROST signature if approved │  │
│  └──────────────────┘     └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Step 4: Execution                                           │
│ - VDF proof + FROST signature verified on-chain             │
│ - Transaction executes (or blocked if rejected)             │
│ - Cross-chain broadcast if needed                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 🏆 Partner Integrations

<table>
<tr>
<td width="33%" align="center">

### 🦄 Uniswap v4

**GuardianHook**

Security checks on every swap:
- Blacklist enforcement
- Protocol pause
- ENS security profiles
- Large swap detection

[📖 Integration Docs](docs/UNISWAP_INTEGRATION.md)

</td>
<td width="33%" align="center">

### 🔗 LI.FI

**Cross-Chain Routing**

Protected bridges & swaps:
- Optimal route finding
- Security before execution
- Multi-chain aggregation

[📖 Integration Docs](docs/LIFI_INTEGRATION.md)

</td>
<td width="33%" align="center">

### 📛 ENS

**Security Profiles**

User-defined protection:
- Personal thresholds
- Whitelist-only mode
- Webhook notifications

[📖 Integration Docs](docs/ENS_SECURITY_PROFILES.md)

</td>
</tr>
</table>

---

## 📜 Deployed Contracts (Sepolia)

| Contract | Address | Role |
|----------|---------|------|
| 🔒 **SecurityMiddleware** | `0x8A4364c08147b1Ec0025e7B1e848BF675f9Dc7b9` | Main airlock — queue + execute |
| 👥 **GuardianRegistry** | `0x702e8307Bc9c8EC7489C6f9e5562EdA44bB9fB7d` | Security state & proposals |
| 🦄 **GuardianHook** | `0xFce40025E4a77D5395188d82657A728521D839ec` | Uniswap v4 integration |
| ⏱️ **VDFVerifier** | `0xFAf997119B0FFDF62E149Cbfc3713267a7C8DaEA` | VDF proof verification |
| ✍️ **FROSTVerifier** | `0x02a59687A130D198a23F790866500489F6f88C12` | Threshold signature verification |
| 🎭 **ZKVoteVerifier** | `0xb638C0997778F172ba4609B8E20252483cD87eEE` | Private voting verification |

**Network**: Sepolia (Chain ID: `11155111`)
**Deployer**: `0x69E135540F4F5B69592365DFE7730c08ACe96CCb`

---

## 📁 Project Structure

```
DeFiGuardian/
│
├── 📂 sdk/                      # TypeScript SDK — main integration point
│   ├── core/                    # Middleware, VDF client, ZK client, LI.FI, ENS
│   └── mockExamples/            # 5 demo scripts for testing
│
├── 📂 agent/                    # Python ML Agent (Flask API)
│   ├── main.py                  # /analyze, /review endpoints + SSE
│   └── models/                  # XGBoost model + preprocessors
│
├── 📂 guardian-mock/            # Mock Guardian Network (Express)
│   └── src/                     # Voting simulation + FROST signing
│
├── 📂 lib/                      # Cryptographic libraries
│   ├── frost/                   # FROST threshold signatures (Ed25519)
│   ├── vdf/                     # Wesolowski VDF prover/verifier
│   └── zk/                      # Circom circuits + Groth16
│
├── 📂 contracts/                # Solidity smart contracts
│   ├── SecurityMiddleware.sol  # Main airlock
│   ├── GuardianRegistry.sol    # Security state manager
│   ├── hooks/GuardianHook.sol  # Uniswap v4 Hook
│   └── verifiers/              # VDF, FROST, ZK verifiers
│
├── 📂 docs/                     # Documentation
│   ├── TECHNICAL.md            # Complete technical reference
│   ├── UNISWAP_INTEGRATION.md  # Uniswap v4 partner docs
│   ├── LIFI_INTEGRATION.md     # LI.FI partner docs
│   └── ENS_SECURITY_PROFILES.md # ENS integration docs
│
└── 📂 ML_bot/                   # Jupyter notebook for model training
```

---

## 🚀 Quick Start

### 📋 Prerequisites

- **Node.js** 18+
- **Python** 3.11+
- **Sepolia RPC URL** (Infura/Alchemy)
- **Funded wallet** (>0.01 ETH)

### ⚡ Installation

```bash
# Clone the repository
git clone https://github.com/Jayanth-M0625/DeFiGuardian.git
cd DeFiGuardian

# Start ML Agent (Terminal 1)
cd agent && uv run python main.py

# Start Guardian Mock (Terminal 2)
cd guardian-mock && npm install && npx ts-node src/server.ts

# Start VDF Worker (Terminal 3)
cd lib/vdf && npm install && npx ts-node server.ts

# Run demo (Terminal 4)
cd sdk && npm install
npx ts-node mockExamples/smallTx.ts --sepolia
```

### 📜 Demo Scripts

| Command | Scenario | Result |
|---------|----------|--------|
| `npx ts-node mockExamples/smallTx.ts --sepolia` | 0.1 ETH normal tx | ✅ **PASS** |
| `npx ts-node mockExamples/bigTxPass.ts --sepolia` | 500 ETH + VDF + approve | ✅ **PASS** |
| `npx ts-node mockExamples/bigTxFail.ts --sepolia` | 1000 ETH attack | ❌ **BLOCKED** |
| `npx ts-node mockExamples/BigTxCrossPass.ts --sepolia` | Cross-chain 500 ETH | ✅ **PASS** |
| `npx ts-node mockExamples/SmallTxCross.ts --sepolia` | Cross-chain 0.5 ETH | ✅ **PASS** |

---

## 📖 Documentation

| Document | Description |
|----------|-------------|
| 📘 [Technical Documentation](docs/TECHNICAL.md) | Complete SDK API, contract details, integration guide |
| 🦄 [Uniswap v4 Integration](docs/UNISWAP_INTEGRATION.md) | GuardianHook for security-first trading |
| 🔗 [LI.FI Integration](docs/LIFI_INTEGRATION.md) | Cross-chain security with LI.FI aggregation |
| 📛 [ENS Security Profiles](docs/ENS_SECURITY_PROFILES.md) | User-defined security rules via ENS |
| 📄 [Project Overview](docs/OVERVIEW.md) | Non-technical overview of problem & solution |

---

## ⚙️ Protocol Constants

| Constant | Value | Description |
|----------|-------|-------------|
| 👥 `GUARDIAN_COUNT` | `10` | Total guardians in network |
| ✅ `GUARDIAN_THRESHOLD` | `7` | Required approvals (7/10) |
| ⏱️ `VDF_DELAY` | `30 min` | Time-lock when ML flags |
| 🔢 `VDF_ITERATIONS` | `300M` | Sequential squarings |
| 🤖 `ML_THRESHOLD` | `50` | Score >= 50 = flagged |

---

## ⚠️ Disclaimer

### Proof of Concept
> **This project is a proof of concept built for ETHGlobal 2025. It demonstrates potential directions for DeFi security infrastructure and is NOT intended for production use or real financial transactions.**

### No Warranty
> **THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY.**

---

<div align="center">

### 🛡️ **DeFiGuardian**

**Made with ❤️ for Hack Money 2026**

</div>
