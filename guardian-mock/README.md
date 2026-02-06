# Mock Guardian Network

Local mock Guardian Network API for testing DeFiGuardian flows.

Uses real FROST signatures from `lib/frost` and the same voting logic as `sdk/mockExamples`.

## Quick Start

```bash
cd guardian-mock
npm install
npm run dev
```

Server runs on `http://localhost:3001` by default.

## Endpoints

### `GET /health`
Health check and network status.

Response:
```json
{
  "status": "ok",
  "guardianCount": 10,
  "threshold": 7,
  "networkInitialized": true,
  "activeProposals": 0
}
```

### `POST /proposals/submit`
Submit a transaction proposal for Guardian voting.

Request:
```json
{
  "txHash": "0x1234...",
  "sender": "0xabcd...",
  "target": "0x5678...",
  "value": "0",
  "data": "0x...",
  "chainId": 1,
  "amount": "1000000000000000000",
  "mlScore": 45.5,
  "mlFlagged": false
}
```

Response:
```json
{
  "proposalId": "0x123456...",
  "status": "pending",
  "message": "Proposal submitted, voting in progress"
}
```

### `GET /proposals/:id`
Get proposal status and vote tally.

Response:
```json
{
  "proposalId": "0x123456...",
  "status": "approved",
  "votes": {
    "approve": 8,
    "reject": 1,
    "abstain": 1
  },
  "threshold": 7,
  "frostSignature": {
    "R": "0x...",
    "z": "0x..."
  },
  "mlScore": 45.5,
  "mlFlagged": false
}
```

### `GET /proposals/:id/status`
Extended status with phase info.

Response:
```json
{
  "proposalId": "0x123456...",
  "phase": "complete",
  "votes": {
    "approve": 8,
    "reject": 1,
    "abstain": 1,
    "pending": 0
  },
  "threshold": 7,
  "isApproved": true,
  "isRejected": false,
  "frostSignature": {
    "R": "0x...",
    "z": "0x..."
  },
  "expiresAt": 1704067500000
}
```

## Voting Logic

Vote distribution is based on ML score:
- `mlScore >= 70`: Mostly reject (8 reject, 1 approve)
- `mlScore >= 50`: Mixed, lean reject (5 reject, 4 approve)
- `mlScore >= 25`: Mixed, lean approve (6 approve, 3 reject)
- `mlScore < 25`: Mostly approve (9 approve, 0 reject)

## Environment

- `PORT`: Server port (default: 3001)

## Integration

This server is called by the Agent's `/review` endpoint when a transaction is flagged.

Flow:
```
SDK → Agent /review → Guardian Mock /proposals/submit → FROST signature
```
