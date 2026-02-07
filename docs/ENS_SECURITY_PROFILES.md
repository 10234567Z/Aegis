# ENS Security Profiles

**Your ENS name = Your portable DeFi security policy**

Store your personal security preferences in ENS text records. Any protocol using Guardian Protocol will automatically apply your settings.

## Overview

ENS Security Profiles allow users to define their own DeFi security rules without trusting a centralized database. Your preferences are stored on-chain in your ENS name's text records and are portable across all Guardian-protected protocols.

```
alice.eth
  ├── defi.guardian.threshold = "10000000000000000000"  // 10 ETH
  ├── defi.guardian.mode = "paranoid"
  ├── defi.guardian.whitelist = "uniswap.eth,aave.eth"
  ├── defi.guardian.delay = "300"
  └── defi.guardian.notify = "https://webhook.site/..."
```

## Text Record Keys

| Key | Type | Description | Example |
|-----|------|-------------|---------|
| `defi.guardian.threshold` | Wei (string) | Flag transactions above this amount | `"10000000000000000000"` (10 ETH) |
| `defi.guardian.mode` | String | Security mode | `"normal"`, `"strict"`, `"paranoid"` |
| `defi.guardian.whitelist` | CSV | Allowed protocols (ENS names or addresses) | `"uniswap.eth,aave.eth"` |
| `defi.guardian.delay` | Seconds | Extra delay for flagged transactions | `"300"` (5 minutes) |
| `defi.guardian.notify` | URL | Webhook for transaction alerts | `"https://..."` |

## Security Modes

| Mode | Behavior |
|------|----------|
| `normal` | Standard Guardian Protocol security. Uses your threshold if set. |
| `strict` | Adds extra delay to all transactions. Applies your threshold. |
| `paranoid` | **Whitelist-only**. Blocks any protocol not in your whitelist. |

## How It Works

### Flow Diagram

```
User initiates transaction
         │
         ▼
┌─────────────────────────────┐
│  SDK resolves sender's ENS  │
│  name and fetches profile   │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Apply security rules:      │
│  • Check threshold          │
│  • Enforce whitelist        │
│  • Add extra delay          │
│  • Send webhook alert       │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  On-chain (GuardianHook):   │
│  • Read ENSSecurityProfile  │
│  • Enforce paranoid mode    │
│  • Emit monitoring events   │
└─────────────────────────────┘
         │
         ▼
    Transaction executes
```

### Example Scenarios

#### Scenario 1: Conservative Whale

```
vitalik.eth:
  threshold = 10 ETH
  mode = paranoid
  whitelist = uniswap.eth, aave.eth
```

| Action | Result |
|--------|--------|
| Swap 5 ETH on Uniswap | ✅ Allowed (under threshold, whitelisted) |
| Swap 50 ETH on Uniswap | ⚠️ Flagged (over threshold) → VDF delay |
| Swap on SushiSwap | ❌ Blocked (not in whitelist) |

#### Scenario 2: Degen Trader

```
degen.eth:
  threshold = 1000 ETH
  mode = normal
  whitelist = (empty)
```

| Action | Result |
|--------|--------|
| Swap 500 ETH anywhere | ✅ Allowed (under threshold, no whitelist) |
| Swap 2000 ETH | ⚠️ Flagged (over threshold) → VDF delay |

## Setting Up Your Profile

### Option 1: ENS App (UI)

1. Go to [app.ens.domains](https://app.ens.domains)
2. Select your ENS name
3. Click **"Add/Edit Record"**
4. Add text records:

   | Key | Value |
   |-----|-------|
   | `defi.guardian.threshold` | `10000000000000000000` |
   | `defi.guardian.mode` | `paranoid` |
   | `defi.guardian.whitelist` | `uniswap.eth,aave.eth` |

5. Sign the transaction
6. Done! Your profile is now active.

### Option 2: SDK (Programmatic)

```typescript
import { ENSSecurityClient } from '@sackmoney/sdk';
import { parseEther } from 'ethers';

const ensClient = new ENSSecurityClient({ provider });

// Set your security profile
await ensClient.setSecurityProfile('alice.eth', {
  threshold: parseEther('10'),       // Flag swaps > 10 ETH
  delay: 300,                         // 5 min extra delay
  whitelist: ['uniswap.eth', 'aave.eth'],
  mode: 'paranoid',
  notifyUrl: 'https://your-webhook.com/alerts',
}, signer);
```

### Option 3: Direct Contract Call

```solidity
// Get the resolver for your ENS name
IResolver resolver = IResolver(ens.resolver(namehash("alice.eth")));

// Set text records
resolver.setText(namehash("alice.eth"), "defi.guardian.threshold", "10000000000000000000");
resolver.setText(namehash("alice.eth"), "defi.guardian.mode", "paranoid");
resolver.setText(namehash("alice.eth"), "defi.guardian.whitelist", "uniswap.eth,aave.eth");
```

## SDK Usage

### Reading a Profile

```typescript
import { ENSSecurityClient, formatSecurityProfile } from '@sackmoney/sdk';

const ensClient = new ENSSecurityClient({ provider });

// Get full profile
const profile = await ensClient.getSecurityProfile('vitalik.eth');
console.log(profile);
// {
//   threshold: 10000000000000000000n,
//   delay: 300,
//   whitelist: ['uniswap.eth', 'aave.eth'],
//   mode: 'paranoid',
//   notifyUrl: 'https://...',
//   hasProfile: true
// }

// Pretty print
console.log(formatSecurityProfile(profile));
// Threshold: 10 ETH
// Extra Delay: 300s
// Whitelist: uniswap.eth, aave.eth
// Mode: paranoid
// Notify: https://...

// Individual fields
const threshold = await ensClient.getThreshold('vitalik.eth');
const whitelist = await ensClient.getWhitelist('vitalik.eth');
const mode = await ensClient.getMode('vitalik.eth');
```

### Checking Permissions

```typescript
// Check if a target is whitelisted
const allowed = await ensClient.isWhitelisted('alice.eth', uniswapRouterAddress);
// true if uniswap.eth is in whitelist

// Check if amount exceeds threshold
const exceeds = await ensClient.exceedsThreshold('alice.eth', parseEther('50'));
// true if 50 ETH > user's threshold
```

### Automatic Enforcement

When using the SecurityMiddleware, ENS profiles are automatically applied:

```typescript
import { createSecurityMiddleware } from '@sackmoney/sdk';

const middleware = createSecurityMiddleware({ ... });

// ENS profile is automatically fetched and enforced
const result = await middleware.executeSecurely(
  {
    type: 'swap',
    target: UNISWAP_ROUTER,
    amount: parseEther('50'),
    ...
  },
  (progress) => console.log(progress.message),
  senderAddress,  // <-- Profile fetched for this address
);

// Result includes the profile that was applied
console.log(result.ensSecurityProfile);
```

## On-Chain Integration

### ENSSecurityProfile Contract

The `ENSSecurityProfile.sol` contract reads user profiles on-chain:

```solidity
interface IENSSecurityProfile {
    function getSecurityProfile(address user) external view returns (
        uint256 threshold,
        uint256 delay,
        uint8 mode,      // 0=normal, 1=strict, 2=paranoid
        bool hasProfile
    );

    function isWhitelisted(address user, address target) external view returns (bool);
    function exceedsThreshold(address user, uint256 amount) external view returns (bool);
    function isParanoidMode(address user) external view returns (bool);
}
```

### GuardianHook Integration

The Uniswap v4 GuardianHook reads ENS profiles:

```solidity
// In beforeSwap():
(uint256 threshold, uint256 delay, uint8 mode, bool hasProfile) =
    ensSecurityProfile.getSecurityProfile(sender);

if (hasProfile) {
    // Check user's threshold
    if (swapAmount > threshold && threshold > 0) {
        emit ENSThresholdExceeded(poolId, sender, swapAmount, threshold);
    }

    // Paranoid mode: whitelist only
    if (mode == 2) { // PARANOID
        require(
            ensSecurityProfile.isWhitelisted(sender, tokenAddress),
            "Token not in whitelist"
        );
    }
}
```

## Webhook Notifications

If you set `defi.guardian.notify`, you'll receive POST requests:

```json
{
  "type": "transaction_alert",
  "ensName": "alice.eth",
  "target": "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  "amount": "50000000000000000000",
  "sourceChain": 1,
  "destChain": null,
  "timestamp": 1699900000000
}
```

Use this to:
- Send Telegram/Discord alerts
- Log to your security dashboard
- Trigger additional verification

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                      User's ENS Name                       │
│                       (alice.eth)                          │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ Text Records:                                         │ │
│  │   defi.guardian.threshold = "10000000000000000000"    │ │
│  │   defi.guardian.mode = "paranoid"                     │ │
│  │   defi.guardian.whitelist = "uniswap.eth,aave.eth"    │ │
│  └───────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
┌───────────────────────┐           ┌───────────────────────┐
│   SDK (Off-chain)     │           │  Contract (On-chain)  │
│                       │           │                       │
│  ENSSecurityClient    │           │  ENSSecurityProfile   │
│  └─ getSecurityProfile│           │  └─ getSecurityProfile│
│  └─ isWhitelisted     │           │  └─ isWhitelisted     │
│                       │           │                       │
│  SecurityMiddleware   │           │  GuardianHook         │
│  └─ applyENSProfile   │           │  └─ _enforceENSProfile│
└───────────────────────┘           └───────────────────────┘
```

## Files

| File | Description |
|------|-------------|
| `sdk/core/ens.ts` | ENS Security Client for SDK |
| `contracts/ENSSecurityProfile.sol` | On-chain profile reader |
| `contracts/hooks/GuardianHook.sol` | Uniswap v4 hook with ENS support |
| `sdk/core/middleware.ts` | Middleware with ENS enforcement |
| `sdk/mockExamples/ensSecurityDemo.ts` | Demo script |

## FAQ

**Q: What if I don't have an ENS name?**
A: Default Guardian Protocol security applies. No custom rules.

**Q: What if I don't set any profile?**
A: Same as above - default security. You can set just the fields you want.

**Q: Can I change my profile?**
A: Yes! Just update the text records. Changes apply immediately.

**Q: Is this really decentralized?**
A: Yes. Your profile is stored in ENS text records on Ethereum. No centralized database.

**Q: What chains are supported?**
A: Any chain with ENS resolution. Mainnet profiles work everywhere.

**Q: Gas cost to set profile?**
A: One transaction per text record, or batch with multicall. ~50-100k gas per record.

## Demo

Run the demo script:

```bash
cd sdk
npx ts-node mockExamples/ensSecurityDemo.ts
```