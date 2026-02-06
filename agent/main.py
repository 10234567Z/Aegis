"""
DeFiGuardian ML Agent - Flask API for fraud detection.

Routes:
    POST /analyze          - Condensed response (score + verdict)
    POST /analyze/detailed - Full response with SHAP explanations
    GET  /health           - Health check
"""

import os
from flask import Flask, request, jsonify
from dotenv import load_dotenv

from src.etherscan import EtherscanClient
from src.features import compute_features
from src.model import FraudDetector

load_dotenv()

app = Flask(__name__)

# Initialize clients
etherscan = EtherscanClient()
detector = FraudDetector()


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({
        "status": "ok",
        "model_loaded": detector.model is not None,
    })


@app.route("/analyze", methods=["POST"])
def analyze():
    """
    Condensed fraud analysis.
    
    Request body:
        {
            "address": "0x..."        // Required: wallet address to analyze
        }
    
    Response:
        {
            "address": "0x...",
            "is_fraud": true/false,
            "score": 0.0-100.0,       // Fraud score (0=safe, 100=fraud)
            "verdict": "safe|suspicious|dangerous",
            "recommendation": "approve|review|reject"
        }
    """
    data = request.get_json()
    
    if not data or "address" not in data:
        return jsonify({"error": "Missing 'address' in request body"}), 400
    
    address = data["address"]
    
    try:
        # Fetch data from Etherscan
        eth_txs, token_txs, balance = etherscan.fetch_all(address)
        
        # Compute features
        features = compute_features(address, eth_txs, token_txs, balance)
        
        # Run prediction
        prediction = detector.predict(features)
        
        # Convert probability to score (0-100)
        score = prediction["fraud_probability"] * 100
        
        # Determine verdict
        if score < 25:
            verdict = "safe"
            recommendation = "approve"
        elif score < 60:
            verdict = "suspicious"
            recommendation = "review"
        else:
            verdict = "dangerous"
            recommendation = "reject"
        
        return jsonify({
            "address": address,
            "is_fraud": prediction["is_fraud"],
            "score": round(score, 2),
            "verdict": verdict,
            "recommendation": recommendation,
        })
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/analyze/detailed", methods=["POST"])
def analyze_detailed():
    """
    Detailed fraud analysis with SHAP explanations.
    
    Request body:
        {
            "address": "0x...",       // Required: wallet address to analyze
            "top_features": 5         // Optional: number of top features to explain
        }
    
    Response:
        {
            "address": "0x...",
            "is_fraud": true/false,
            "score": 0.0-100.0,
            "confidence": "high|medium|low",
            "verdict": "safe|suspicious|dangerous",
            "recommendation": "approve|review|reject",
            "explanation": {
                "summary": "Human-readable summary",
                "top_factors": [
                    {
                        "feature": "Feature name",
                        "impact": "increases|decreases",
                        "importance": 0.0-1.0,
                        "value": <actual value>,
                        "reason": "Human-readable reason"
                    },
                    ...
                ]
            },
            "stats": {
                "eth_transactions": 123,
                "token_transactions": 45,
                "balance_eth": 1.5,
                "account_age_days": 30
            }
        }
    """
    data = request.get_json()
    
    if not data or "address" not in data:
        return jsonify({"error": "Missing 'address' in request body"}), 400
    
    address = data["address"]
    top_n = data.get("top_features", 5)
    
    try:
        # Fetch data from Etherscan
        eth_txs, token_txs, balance = etherscan.fetch_all(address)
        
        # Compute features
        features = compute_features(address, eth_txs, token_txs, balance)
        
        # Run prediction
        prediction = detector.predict(features)
        
        # Get explanations
        explanations = detector.explain(features, top_n=top_n)
        
        # Convert probability to score (0-100)
        score = prediction["fraud_probability"] * 100
        
        # Determine verdict
        if score < 25:
            verdict = "safe"
            recommendation = "approve"
        elif score < 60:
            verdict = "suspicious"
            recommendation = "review"
        else:
            verdict = "dangerous"
            recommendation = "reject"
        
        # Generate summary
        if prediction["is_fraud"]:
            top_reasons = [exp["reason"] for exp in explanations[:3]]
            summary = f"Flagged as potential fraud. Key indicators: {'; '.join(top_reasons)}"
        else:
            summary = f"No fraud indicators detected. Wallet behavior appears normal."
        
        # Compute stats
        account_age_mins = features.get("Time Diff between first and last (Mins)", 0)
        
        return jsonify({
            "address": address,
            "is_fraud": prediction["is_fraud"],
            "score": round(score, 2),
            "confidence": prediction["confidence"],
            "verdict": verdict,
            "recommendation": recommendation,
            "explanation": {
                "summary": summary,
                "top_factors": explanations,
            },
            "stats": {
                "eth_transactions": features.get("total transactions (including tnx to create contract", 0),
                "token_transactions": features.get(" Total ERC20 tnxs", 0),
                "balance_eth": round(features.get("total ether balance", 0), 6),
                "account_age_days": round(account_age_mins / 1440, 2) if account_age_mins else 0,
                "unique_counterparties": features.get("Unique Sent To Addresses", 0) + features.get("Unique Received From Addresses", 0),
            },
        })
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def main():
    """Run the Flask development server."""
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    
    print(f"Starting DeFiGuardian ML Agent on port {port}")
    print(f"Model loaded: {detector.model is not None}")
    
    app.run(host="0.0.0.0", port=port, debug=debug)


if __name__ == "__main__":
    main()
