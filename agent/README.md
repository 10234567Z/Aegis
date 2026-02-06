# DeFiGuardian ML Agent

Flask API for fraud detection using XGBoost + SHAP explanations.

## Setup

```bash
cd agent
uv sync
cp .env.example .env
# Add your ETHERSCAN_API_KEY to .env
```

## Place Model Files

Export from Colab notebook and place in `models/`:
- `eth_fraud_xgb.json` - XGBoost model
- `preprocessors.pkl` - Scaler + label encoders

See `models/README.md` for export instructions.

## Run

```bash
uv run python main.py
```

Server runs on `http://localhost:5000`

## API Endpoints

### `POST /analyze` - Condensed Response

```bash
curl -X POST http://localhost:5000/analyze \
  -H "Content-Type: application/json" \
  -d '{"address": "0x..."}'
```

Response:
```json
{
  "address": "0x...",
  "is_fraud": false,
  "score": 15.32,
  "verdict": "safe",
  "recommendation": "approve"
}
```

### `POST /analyze/detailed` - Full Response with Explanations

```bash
curl -X POST http://localhost:5000/analyze/detailed \
  -H "Content-Type: application/json" \
  -d '{"address": "0x...", "top_features": 5}'
```

Response:
```json
{
  "address": "0x...",
  "is_fraud": true,
  "score": 87.5,
  "confidence": "high",
  "verdict": "dangerous",
  "recommendation": "reject",
  "explanation": {
    "summary": "Flagged as potential fraud. Key indicators: ...",
    "top_factors": [
      {
        "feature": "Total ERC20 tnxs",
        "impact": "increases",
        "importance": 0.85,
        "value": 1523,
        "reason": "Total of 1523 ERC-20 transactions"
      }
    ]
  },
  "stats": {
    "eth_transactions": 45,
    "token_transactions": 1523,
    "balance_eth": 0.001,
    "account_age_days": 2.5,
    "unique_counterparties": 89
  }
}
```

### `GET /health` - Health Check

```bash
curl http://localhost:5000/health
```

## Architecture

```
Guardian Network polls this API
         ↓
    POST /analyze
         ↓
    Etherscan API (fetch wallet history)
         ↓
    Compute 47 features
         ↓
    XGBoost prediction + SHAP
         ↓
    Return verdict
```
