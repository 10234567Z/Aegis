# Uniswap v4 Hook Integration

**GuardianHook: Security-First Trading on Uniswap v4**

Uniswap v4's hook architecture allows us to inject Guardian Protocol security directly into the swap lifecycle - preventing hacks before they happen.

## Overview

GuardianHook is a Uniswap v4 hook that enforces security checks on every swap:
- Blacklist enforcement (block known attackers)
- Protocol pause (emergency stop)
- ENS Security Profiles (user-defined rules)
- Large swap detection (monitoring)

```
User initiates swap
        │
        ▼
┌───────────────────────────────┐
│      beforeSwap() Hook        │
│  ┌─────────────────────────┐  │
│  │ 1. Check protocol pause │  │
│  │ 2. Check blacklist      │  │
│  │ 3. Enforce ENS profile  │  │
│  │    - Threshold check    │  │
│  │    - Whitelist check    │  │
│  └─────────────────────────┘  │
└───────────────────────────────┘
        │
        ▼ (if allowed)
┌───────────────────────────────┐
│      Uniswap v4 Swap          │
└───────────────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│       afterSwap() Hook        │
│  ┌─────────────────────────┐  │
│  │ 1. Update pool stats    │  │
│  │ 2. Detect large swaps   │  │
│  │ 3. Emit monitoring event│  │
│  └─────────────────────────┘  │
└───────────────────────────────┘
```

## Security Features

### 1. Blacklist Enforcement

Every swap checks if the sender is blacklisted:

```solidity
function beforeSwap(...) external returns (...) {
    if (_isBlacklisted(sender)) {
        emit SwapBlocked(poolId, sender, "Sender blacklisted");
        revert AddressBlacklisted(sender);
    }
    // ...
}
```

When Guardian Protocol detects an attacker (via ML analysis or guardian consensus), they're added to the blacklist. The hook blocks all their swaps instantly.

### 2. Protocol Pause

Emergency pause that halts all trading:

```solidity
if (_isProtocolPaused()) {
    emit SwapBlocked(poolId, sender, "Protocol paused");
    revert ProtocolPaused();
}
```

Guardians can vote to pause the protocol when an exploit is detected, stopping further damage.

### 3. ENS Security Profiles

Users can define their own security rules via ENS text records:

```solidity
function _enforceENSProfile(address sender, ...) internal {
    (uint256 threshold, uint256 delay, uint8 mode, bool hasProfile) =
        _getENSProfile(sender);

    if (!hasProfile) return;

    // Check user-defined threshold
    if (threshold > 0 && swapAmount > threshold) {
        emit ENSThresholdExceeded(poolId, sender, swapAmount, threshold);
    }

    // Paranoid mode: whitelist only
    if (mode == 2) {
        if (!_isWhitelistedTarget(sender, token)) {
            revert ENSWhitelistViolation(sender, token);
        }
    }
}
```

### 4. Large Swap Detection

Monitor and log large swaps for pattern analysis:

```solidity
function afterSwap(...) external returns (...) {
    uint256 effectiveThreshold = _getEffectiveThreshold(sender);

    if (swapAmount >= effectiveThreshold) {
        userLargeSwapCount[sender]++;
        emit LargeSwapDetected(poolId, sender, amountSpecified, swapAmount);
    }
}
```

## Hook Permissions

```solidity
function getHookPermissions() public pure returns (Hooks.Permissions memory) {
    return Hooks.Permissions({
        beforeInitialize: true,   // Register pool
        afterInitialize: false,
        beforeAddLiquidity: true, // Check LP blacklist
        afterAddLiquidity: false,
        beforeRemoveLiquidity: false,
        afterRemoveLiquidity: false,
        beforeSwap: true,         // Security checks
        afterSwap: true,          // Monitoring
        beforeDonate: false,
        afterDonate: false,
        beforeSwapReturnDelta: false,
        afterSwapReturnDelta: false,
        afterAddLiquidityReturnDelta: false,
        afterRemoveLiquidityReturnDelta: false
    });
}
```

## Deployment

### Sepolia Testnet

```
GuardianHook: 0x... (deployed)
PoolManager: 0x... (Uniswap v4)
SecurityMiddleware: 0x8A4364c08147b1Ec0025e7B1e848BF675f9Dc7b9
GuardianRegistry: 0x702e8307Bc9c8EC7489C6f9e5562EdA44bB9fB7d
```

### Deploy Script

```bash
cd contracts/hooks
forge script script/DeployGuardianHook.s.sol --rpc-url sepolia --broadcast
```

## Events

| Event | Description |
|-------|-------------|
| `PoolRegistered` | New pool initialized with hook |
| `SwapExecuted` | Every swap (for monitoring) |
| `SwapBlocked` | Swap prevented (blacklist/pause) |
| `LargeSwapDetected` | Swap exceeds threshold |
| `LiquidityBlocked` | LP blocked (blacklist/pause) |
| `ENSThresholdExceeded` | User's ENS threshold exceeded |
| `ENSWhitelistBlocked` | Token not in user's whitelist |
| `ENSProfileApplied` | User's ENS profile was read |

## Integration with Guardian Protocol

```
┌─────────────────────────────────────────────────────────────┐
│                    Guardian Protocol                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  ML Bot     │  │  Guardians  │  │  VDF Time-Lock      │  │
│  │  Detection  │  │  (7/10)     │  │  (30 min delay)     │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                     │             │
│         └────────────────┼─────────────────────┘             │
│                          │                                   │
│                          ▼                                   │
│              ┌───────────────────────┐                       │
│              │  SecurityMiddleware   │                       │
│              │  - Blacklist          │                       │
│              │  - Pause state        │                       │
│              └───────────┬───────────┘                       │
└──────────────────────────┼───────────────────────────────────┘
                           │
                           ▼
              ┌───────────────────────┐
              │     GuardianHook      │
              │   (Uniswap v4 Hook)   │
              │                       │
              │  beforeSwap() reads   │
              │  SecurityMiddleware   │
              └───────────────────────┘
```

## Why Uniswap v4 Hooks?

1. **Native Integration**: Security checks happen inside the swap, not around it
2. **Gas Efficient**: Single transaction, no external calls for simple swaps
3. **Composable**: Works with any pool using this hook
4. **Upgradeable Security**: Hook can point to new SecurityMiddleware

## Files

| File | Description |
|------|-------------|
| `contracts/hooks/GuardianHook.sol` | Main hook contract |
| `contracts/hooks/src/GuardianHook.sol` | Foundry source |
| `contracts/hooks/script/DeployGuardianHook.s.sol` | Deploy script |
| `contracts/hooks/test/GuardianHook.t.sol` | Tests |

## License

MIT
