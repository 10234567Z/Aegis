# Guardian Protocol - Uniswap v4 Hook

A Uniswap v4 Hook that integrates Guardian Protocol security into any Uniswap v4 pool.

## Features

| Hook Callback | Security Feature |
|--------------|------------------|
| `beforeSwap` | Blocks blacklisted addresses, enforces protocol pause |
| `afterSwap` | Logs swap data for ML analysis, detects large swaps |
| `beforeAddLiquidity` | Prevents blacklisted LPs from providing liquidity |
| `beforeInitialize` | Registers pool for tracking |

## How It Works

```
User initiates swap
       ↓
┌──────────────────────────┐
│     beforeSwap()         │
│  ├─ Check: isPaused?     │──→ Revert if paused
│  └─ Check: isBlacklisted?│──→ Revert if blacklisted
└──────────────────────────┘
       ↓
┌──────────────────────────┐
│   Uniswap v4 Pool Swap   │
└──────────────────────────┘
       ↓
┌──────────────────────────┐
│      afterSwap()         │
│  ├─ Update pool stats    │
│  ├─ Emit SwapExecuted    │──→ ML Bot monitors
│  └─ Detect large swaps   │──→ Alert if > threshold
└──────────────────────────┘
```

## Integration with Guardian Protocol

The hook reads security state from `SecurityMiddleware`:

- **`isPaused()`** - If guardians trigger emergency pause, all swaps blocked
- **`blacklistedAddresses(address)`** - Known exploit addresses cannot swap

## Setup

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Node.js 18+

### Install Dependencies

```bash
cd contracts/hooks

# Install Foundry dependencies
forge install uniswap/v4-core
forge install uniswap/v4-periphery
forge install foundry-rs/forge-std
forge install OpenZeppelin/openzeppelin-contracts
```

### Build

```bash
forge build
```

### Test

```bash
forge test -vvv
```

### Deploy

```bash
# Set environment variables
export PRIVATE_KEY=your_private_key
export RPC_URL=https://sepolia.infura.io/v3/your_key
export SECURITY_MIDDLEWARE=0x... # Your SecurityMiddleware address

# Deploy (use deployment script)
forge script script/DeployGuardianHook.s.sol --rpc-url $RPC_URL --broadcast
```

## Contract Addresses

| Network | GuardianHook | SecurityMiddleware |
|---------|--------------|-------------------|
| Sepolia | TBD | TBD |
| Base Sepolia | TBD | TBD |

## Events

The hook emits events for off-chain monitoring:

```solidity
// Every swap (for ML bot)
event SwapExecuted(
    PoolId indexed poolId,
    address indexed sender,
    bool zeroForOne,
    int256 amountSpecified,
    uint256 timestamp
);

// Large swaps (for alerts)
event LargeSwapDetected(
    PoolId indexed poolId,
    address indexed sender,
    int256 amountSpecified,
    uint256 estimatedValueUSD
);

// Blocked actions
event SwapBlocked(PoolId indexed poolId, address indexed sender, string reason);
event LiquidityBlocked(PoolId indexed poolId, address indexed provider, string reason);
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Uniswap v4 PoolManager                │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                    GuardianHook                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Security Checks:                                │   │
│  │  • Blacklist verification                       │   │
│  │  • Pause enforcement                            │   │
│  │  • Large swap detection                         │   │
│  └─────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│               SecurityMiddleware                       │
│  ┌─────────────────────────────────────────────────┐   │
│  │ State:                                          │   │
│  │  • isPaused: bool                               │   │
│  │  • blacklistedAddresses: mapping(address=>bool) │   │
│  └─────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                Guardian Network                         │
│  (FROST signatures, ZK voting, VDF time-locks)          │
└─────────────────────────────────────────────────────────┘
```