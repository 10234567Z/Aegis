# LI.FI Integration

**Cross-Chain Security with LI.FI Aggregation**

Guardian Protocol uses LI.FI for cross-chain routing while adding a security layer that protects users across all chains.

## Overview

LI.FI aggregates bridges and DEXs across 20+ chains. We integrate it to:
1. Route cross-chain transactions through optimal paths
2. Apply Guardian Protocol security before execution
3. Propagate security events across all chains

```
┌─────────────────────────────────────────────────────────────┐
│                   User Transaction                          │
│                                                             │
│   "Swap 100 ETH on Ethereum to USDC on Arbitrum"            │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 Guardian Protocol SDK                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  1. ML Bot Analysis (is this suspicious?)           │    │
│  │  2. Guardian Voting (7/10 consensus)                │    │
│  │  3. VDF Time-Lock (if flagged, 30 min delay)        │    │
│  │  4. ENS Profile Check (user's security rules)       │    │
│  └─────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      LI.FI API                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  • Get optimal route (bridge + DEX)                 │    │
│  │  • Build transaction data                           │    │
│  │  • Track execution status                           │    │
│  └─────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Execution on Source Chain                      │
│              (with Guardian security proofs)                │
└─────────────────────────────────────────────────────────────┘
```

## SDK Integration

### LiFiClient

```typescript
import { LiFiClient, getQuickQuote, NATIVE_TOKEN } from '@sackmoney/sdk';

// Initialize client
const lifi = new LiFiClient({
  apiUrl: 'https://li.quest/v1',
  integrator: 'Aegis',
});

// Get a quote for cross-chain swap
const quote = await lifi.getQuote({
  fromChain: 1,          // Ethereum
  toChain: 42161,        // Arbitrum
  fromToken: NATIVE_TOKEN,
  toToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
  fromAmount: '1000000000000000000', // 1 ETH
  fromAddress: userAddress,
});

// Execute with Guardian security
const result = await middleware.executeSecurely({
  type: 'bridge',
  target: quote.transactionRequest.to,
  data: quote.transactionRequest.data,
  value: BigInt(quote.transactionRequest.value),
  amount: BigInt(quote.estimate.fromAmount),
  sourceChain: 1,
  destChain: 42161,
}, onProgress, senderAddress);
```

### Quick Quote Helper

```typescript
import { getQuickQuote } from '@sackmoney/sdk';

// One-liner for simple quotes
const quote = await getQuickQuote(
  1,        // from Ethereum
  42161,    // to Arbitrum
  NATIVE_TOKEN,
  USDC_ARBITRUM,
  parseEther('1'),
  userAddress,
);
```

## Cross-Chain Security Events

When Guardian Protocol detects a threat, it broadcasts security events to all chains via LI.FI/LayerZero:

```typescript
import {
  createBroadcaster,
  createSecurityEvent,
  SUPPORTED_CHAINS
} from '@sackmoney/sdk';

// Create security event
const event = createSecurityEvent(
  1,                    // Source chain (Ethereum)
  'EMERGENCY_PAUSE',    // Event type
  'CRITICAL',           // Severity
  SUPPORTED_CHAINS,     // Target all chains
  { pauseDuration: 3600 },
  frostSignature,       // Guardian signature
  evidenceHash,
);

// Broadcast to all chains
const broadcaster = createBroadcaster({ providers, signers });
const result = await broadcaster.broadcast(event);
```

### Security Event Types

| Event | Description |
|-------|-------------|
| `EMERGENCY_PAUSE` | Pause protocol on all chains |
| `BLACKLIST` | Block address across chains |
| `THRESHOLD_UP` | Increase transaction threshold |
| `MONITOR` | Alert without action |
| `UNPAUSE` | Resume operations |
| `UNBLACKLIST` | Remove from blacklist |

## Supported Chains

```typescript
export const SUPPORTED_CHAINS = {
  1: 'Ethereum',
  10: 'Optimism',
  56: 'BSC',
  137: 'Polygon',
  42161: 'Arbitrum',
  43114: 'Avalanche',
  8453: 'Base',
  // Testnets
  11155111: 'Sepolia',
  80002: 'Polygon Amoy',
  421614: 'Arbitrum Sepolia',
  84532: 'Base Sepolia',
};
```

## LI.FI Diamond Contract

All LI.FI swaps go through the Diamond contract (same address on all chains):

```typescript
export const LIFI_DIAMOND: Record<number, string> = {
  1: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',      // Ethereum
  10: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',     // Optimism
  56: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',     // BSC
  137: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',    // Polygon
  42161: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',  // Arbitrum
  43114: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',  // Avalanche
  8453: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',   // Base
};
```

## API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/quote` | GET | Get optimal route and transaction data |
| `/status` | GET | Track cross-chain transaction status |
| `/chains` | GET | List supported chains |
| `/tokens` | GET | List supported tokens |
| `/tools` | GET | List available bridges/DEXs |

## Security Flow for Cross-Chain

```
1. User wants to bridge ETH → USDC (Ethereum → Arbitrum)
                    │
                    ▼
2. SDK calls LI.FI API to get optimal route
                    │
                    ▼
3. ML Bot analyzes: Is this a suspicious transaction?
   - Large amount? Unusual pattern? Known attacker?
                    │
                    ▼
4. If flagged: VDF time-lock (30 min delay)
   Guardians can vote to approve/reject
                    │
                    ▼
5. If approved: Execute via LI.FI Diamond
   Transaction includes:
   - VDF proof (or zero-proof if not flagged)
   - FROST signature (guardian consensus)
                    │
                    ▼
6. LI.FI routes through optimal bridge
   (Stargate, Hop, Across, etc.)
                    │
                    ▼
7. User receives USDC on Arbitrum
```

## Error Handling

```typescript
import { LiFiError } from '@sackmoney/sdk';

try {
  const quote = await lifi.getQuote(request);
} catch (error) {
  if (error instanceof LiFiError) {
    console.error(`LI.FI Error [${error.code}]: ${error.message}`);
    // Handle specific errors:
    // - NO_ROUTE_FOUND
    // - INSUFFICIENT_LIQUIDITY
    // - SLIPPAGE_TOO_HIGH
  }
}
```

## Files

| File | Description |
|------|-------------|
| `sdk/core/lifi.ts` | LI.FI Client implementation |
| `sdk/core/crosschain.ts` | Cross-chain security event broadcaster |
| `sdk/core/constants.ts` | LI.FI API URL, integrator ID, chain configs |
| `sdk/mockExamples/BigTxCrossPass.ts` | Cross-chain demo |
| `sdk/mockExamples/SmallTxCross.ts` | Cross-chain demo |

## Why LI.FI?

1. **Aggregation**: Best routes across 15+ bridges and 30+ DEXs
2. **Multi-Chain**: 20+ chains supported
3. **Single Integration**: One API for all cross-chain needs
4. **Execution Tracking**: Monitor transaction status across chains
5. **Reliability**: Fallback routes if primary fails

## License

MIT
