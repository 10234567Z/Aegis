# Guardian Protocol - Deployment Guide
Deploy Guardian Protocol contracts for your protocol.

## Quick Start

```bash
cd deploy

# install dependencies
npm install
# then compile
npm run compile

# deploying to local network
npm run node          # Terminal 1: Start local node
npm run deploy:local  # Terminal 2: Deploy

# Deploy to sepolia
npm run deploy:sepolia
```

## Prerequisites

1. Create a e.nv using .env.example

## Contract Deployment Order
The script deploys contracts in this order:
1. **FROSTVerifier**
2. **VDFVerifier**
3. **ZKVoteVerifier**
4. **GuardianRegistry**
5. **SecurityMiddleware**
6. **CrossChainMessenger**

## After Deployment

The script outputs SDK config:

```typescript
const middleware = createSecurityMiddleware({
  security: {
    middlewareAddress: '0x...', // Your SecurityMiddleware
    registryAddress: '0x...',   // Your GuardianRegistry
    chainId: 11155111,
  },
  vdfWorkerUrl: 'https://vdf.sackmoney.io',
  guardianApiUrl: 'https://guardians.sackmoney.io',
  provider,
  signer,
});
```

## Deployment Files
Deployments are saved to `deployments/<network>-<chainId>-<timestamp>.json`:

## Contract Verification

After deployment, verify on block explorers:

```bash
# Verify single contract
npx hardhat verify --network sepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
# Verify VDFVerifier (no constructor args)
npx hardhat verify --network sepolia 0x...
```

## LayerZero Endpoints

| Chain | Endpoint |
|-------|----------|
| Ethereum | `0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675` |
| Polygon | `0x3c2269811836af69497E5F486A85D7316753cf62` |
| Arbitrum | `0x3c2269811836af69497E5F486A85D7316753cf62` |
| Optimism | `0x3c2269811836af69497E5F486A85D7316753cf62` |
| Base | `0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7` |
| Sepolia | `0xae92d5aD7583AD66E49A0c67BAd18F6ba52dDDc1` |
