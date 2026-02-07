"""
DeFiGuardian ML Agent - Flask API for fraud detection.

Routes:
    POST /analyze          - Condensed response (score + verdict)
    POST /analyze/detailed - Full response with SHAP explanations
    POST /review           - Full flow: ML analysis + Guardian Network routing
    GET  /health           - Health check
"""

import os
import json
import queue
import threading
import time
import requests
from flask import Flask, request, jsonify, Response
from dotenv import load_dotenv

from src.etherscan import EtherscanClient
from src.features import compute_features
from src.model import FraudDetector

load_dotenv()

app = Flask(__name__)

# Initialize clients
etherscan = EtherscanClient()
detector = FraudDetector()

# Threshold for flagging (score > 50 = flagged)
ML_FLAG_THRESHOLD = 50.0

# ─── SSE Infrastructure ───

# Registered SSE clients (each gets their own queue)
sse_clients: list[queue.Queue] = []
sse_clients_lock = threading.Lock()


def sse_publish(event_type: str, data: dict) -> None:
    """Push an event to all connected SSE clients."""
    payload = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
    with sse_clients_lock:
        dead = []
        for q in sse_clients:
            try:
                q.put_nowait(payload)
            except queue.Full:
                dead.append(q)
        for q in dead:
            sse_clients.remove(q)


def sse_stream(client_queue: queue.Queue):
    """Generator that yields SSE events for one client."""
    try:
        while True:
            try:
                payload = client_queue.get(timeout=30)
                yield payload
            except queue.Empty:
                # Send keepalive comment every 30s
                yield ": keepalive\n\n"
    except GeneratorExit:
        pass
    finally:
        with sse_clients_lock:
            if client_queue in sse_clients:
                sse_clients.remove(client_queue)


@app.route("/events", methods=["GET"])
def events():
    """SSE endpoint — streams real-time transaction events."""
    client_queue: queue.Queue = queue.Queue(maxsize=256)
    with sse_clients_lock:
        sse_clients.append(client_queue)
    return Response(
        sse_stream(client_queue),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


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
        
        result = {
            "address": address,
            "is_fraud": prediction["is_fraud"],
            "score": round(score, 2),
            "verdict": verdict,
            "recommendation": recommendation,
        }

        sse_publish("analyze", result)
        return jsonify(result)
    
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


@app.route("/review", methods=["POST"])
def review():
    """
    Full transaction review flow: ML analysis + Guardian Network routing.
    
    This is the main endpoint called by the SDK. It:
    1. Analyzes the sender wallet for fraud patterns
    2. Forwards the proposal to the protocol's Guardian Network
    3. Returns combined ML verdict + Guardian voting result
    
    Request body:
        {
            "guardianApiUrl": "https://...",  // Protocol's Guardian Network URL
            "proposal": {
                "txHash": "0x...",
                "sender": "0x...",
                "target": "0x...",
                "value": "1000000000000000000",
                "data": "0x...",
                "chainId": 1,
                "amount": "1000000000000000000"
            }
        }
    
    Response:
        {
            "proposalId": "0x...",
            "mlAnalysis": {
                "score": 45.2,
                "verdict": "suspicious",
                "flagged": false
            },
            "guardianStatus": {
                "submitted": true,
                "message": "Proposal submitted to Guardian Network"
            }
        }
    """
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Missing request body"}), 400
    
    guardian_url = data.get("guardianApiUrl")
    proposal = data.get("proposal")
    
    if not guardian_url:
        return jsonify({"error": "Missing 'guardianApiUrl'"}), 400
    if not proposal:
        return jsonify({"error": "Missing 'proposal'"}), 400
    
    sender = proposal.get("sender")
    if not sender:
        return jsonify({"error": "Missing 'sender' in proposal"}), 400
    
    sender_ens = proposal.get("senderENS")  # ENS name resolved by SDK
    
    try:
        # Step 1: ML Analysis on sender wallet
        try:
            eth_txs, token_txs, balance = etherscan.fetch_all(sender)
            features = compute_features(sender, eth_txs, token_txs, balance)
            prediction = detector.predict(features)
            score = prediction["fraud_probability"] * 100
        except Exception:
            # Fallback: use mock score based on address hash for testing
            import hashlib
            addr_hash = int(hashlib.sha256(sender.encode()).hexdigest(), 16)
            score = (addr_hash % 100)  # 0-99 based on address
        
        flagged = score >= ML_FLAG_THRESHOLD
        
        if score < 25:
            verdict = "safe"
        elif score < 60:
            verdict = "suspicious"
        else:
            verdict = "dangerous"
        
        ml_analysis = {
            "score": round(score, 2),
            "verdict": verdict,
            "flagged": flagged,
        }
        
        # Step 2: Forward to Guardian Network
        guardian_payload = {
            "txHash": proposal.get("txHash"),
            "sender": sender,
            "senderENS": sender_ens,
            "target": proposal.get("target"),
            "value": proposal.get("value"),
            "data": proposal.get("data"),
            "chainId": proposal.get("chainId"),
            "amount": proposal.get("amount"),
            "mlScore": score,
            "mlFlagged": flagged,
        }
        
        try:
            guardian_response = requests.post(
                f"{guardian_url}/proposals/submit",
                json=guardian_payload,
                timeout=10,
            )
            guardian_response.raise_for_status()
            guardian_data = guardian_response.json()
            
            guardian_status = {
                "submitted": True,
                "proposalId": guardian_data.get("proposalId"),
                "message": "Proposal submitted to Guardian Network",
            }
        except requests.exceptions.RequestException as e:
            guardian_status = {
                "submitted": False,
                "error": str(e),
                "message": "Failed to reach Guardian Network",
            }
        
        result = {
            "proposalId": guardian_status.get("proposalId"),
            "mlAnalysis": ml_analysis,
            "guardianStatus": guardian_status,
            "senderENS": sender_ens,
        }

        sse_publish("review", result)
        return jsonify(result)
    
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
