"""
Feature computation from Etherscan API responses.
Computes all 47 features required by the XGBoost fraud detection model.
"""

import numpy as np
from typing import Any
from collections import Counter

# ────────────────────────────────────────────────────────────────
# Feature names (exact match to training data)
# ────────────────────────────────────────────────────────────────

FEATURE_COLUMNS = [
    # Basic account activity (7)
    "Avg min between sent tnx",
    "Avg min between received tnx",
    "Time Diff between first and last (Mins)",
    "Sent tnx",
    "Received Tnx",
    "total transactions (including tnx to create contract",
    "Number of Created Contracts",
    # Counterparty diversity (2)
    "Unique Received From Addresses",
    "Unique Sent To Addresses",
    # Ether value statistics (9)
    "min value received",
    "max value received ",  # note trailing space in original
    "avg val received",
    "min val sent",
    "max val sent",
    "avg val sent",
    "total Ether sent",
    "total ether received",
    "total ether balance",
    # Contract interaction (4)
    "min value sent to contract",
    "max val sent to contract",
    "avg value sent to contract",
    "total ether sent contracts",
    # ERC-20 activity (25)
    " Total ERC20 tnxs",
    " ERC20 total Ether received",
    " ERC20 total ether sent",
    " ERC20 total Ether sent contract",
    " ERC20 uniq sent addr",
    " ERC20 uniq rec addr",
    " ERC20 uniq sent addr.1",
    " ERC20 uniq rec contract addr",
    " ERC20 avg time between sent tnx",
    " ERC20 avg time between rec tnx",
    " ERC20 avg time between rec 2 tnx",
    " ERC20 avg time between contract tnx",
    " ERC20 min val rec",
    " ERC20 max val rec",
    " ERC20 avg val rec",
    " ERC20 min val sent",
    " ERC20 max val sent",
    " ERC20 avg val sent",
    " ERC20 min val sent contract",
    " ERC20 max val sent contract",
    " ERC20 avg val sent contract",
    " ERC20 uniq sent token name",
    " ERC20 uniq rec token name",
    " ERC20 most sent token type",
    " ERC20_most_rec_token_type",
]

# Default values (medians from training data - approximate)
FEATURE_DEFAULTS = {
    "Avg min between sent tnx": 844.26,
    "Avg min between received tnx": 4910.29,
    "Time Diff between first and last (Mins)": 177918.47,
    "Sent tnx": 10,
    "Received Tnx": 5,
    "total transactions (including tnx to create contract": 15,
    "Number of Created Contracts": 0,
    "Unique Received From Addresses": 3,
    "Unique Sent To Addresses": 5,
    "min value received": 0.0,
    "max value received ": 1.0,
    "avg val received": 0.1,
    "min val sent": 0.0,
    "max val sent": 0.5,
    "avg val sent": 0.1,
    "total Ether sent": 1.0,
    "total ether received": 1.0,
    "total ether balance": 0.1,
    "min value sent to contract": 0.0,
    "max val sent to contract": 0.0,
    "avg value sent to contract": 0.0,
    "total ether sent contracts": 0.0,
    " Total ERC20 tnxs": 0,
    " ERC20 total Ether received": 0.0,
    " ERC20 total ether sent": 0.0,
    " ERC20 total Ether sent contract": 0.0,
    " ERC20 uniq sent addr": 0,
    " ERC20 uniq rec addr": 0,
    " ERC20 uniq sent addr.1": 0,
    " ERC20 uniq rec contract addr": 0,
    " ERC20 avg time between sent tnx": 0.0,
    " ERC20 avg time between rec tnx": 0.0,
    " ERC20 avg time between rec 2 tnx": 0.0,
    " ERC20 avg time between contract tnx": 0.0,
    " ERC20 min val rec": 0.0,
    " ERC20 max val rec": 0.0,
    " ERC20 avg val rec": 0.0,
    " ERC20 min val sent": 0.0,
    " ERC20 max val sent": 0.0,
    " ERC20 avg val sent": 0.0,
    " ERC20 min val sent contract": 0.0,
    " ERC20 max val sent contract": 0.0,
    " ERC20 avg val sent contract": 0.0,
    " ERC20 uniq sent token name": 0,
    " ERC20 uniq rec token name": 0,
    " ERC20 most sent token type": "None",
    " ERC20_most_rec_token_type": "None",
}


def wei_to_ether(wei: str | int) -> float:
    """Convert Wei to Ether."""
    return int(wei) / 1e18


def compute_avg_time_between(timestamps: list[int]) -> float:
    """Compute average minutes between consecutive timestamps."""
    if len(timestamps) < 2:
        return 0.0
    timestamps = sorted(timestamps)
    diffs = [(timestamps[i + 1] - timestamps[i]) / 60 for i in range(len(timestamps) - 1)]
    return np.mean(diffs) if diffs else 0.0


def is_contract_address(to_addr: str, contract_creations: set[str]) -> bool:
    """Check if address is a contract (heuristic: was created or has code)."""
    return to_addr.lower() in contract_creations


def compute_features(
    address: str,
    eth_txs: list[dict[str, Any]],
    token_txs: list[dict[str, Any]],
    balance_wei: str,
) -> dict[str, Any]:
    """
    Compute all 47 features from Etherscan API responses.
    
    Args:
        address: The wallet address being analyzed
        eth_txs: Response from Etherscan txlist endpoint
        token_txs: Response from Etherscan tokentx endpoint
        balance_wei: Current balance in Wei
    
    Returns:
        Dictionary with all 47 features
    """
    address = address.lower()
    features = FEATURE_DEFAULTS.copy()
    
    if not eth_txs and not token_txs:
        features["total ether balance"] = wei_to_ether(balance_wei) if balance_wei else 0.0
        return features
    
    # ─── Separate sent vs received ETH transactions ───
    sent_txs = [tx for tx in eth_txs if tx.get("from", "").lower() == address]
    received_txs = [tx for tx in eth_txs if tx.get("to", "").lower() == address]
    
    # Contract creations
    contract_creations = {
        tx.get("contractAddress", "").lower()
        for tx in eth_txs
        if tx.get("contractAddress")
    }
    
    # Sent to contracts
    contract_txs = [
        tx for tx in sent_txs
        if tx.get("to", "").lower() in contract_creations or tx.get("input", "0x") != "0x"
    ]
    
    # ─── Basic account activity ───
    sent_timestamps = [int(tx["timeStamp"]) for tx in sent_txs if tx.get("timeStamp")]
    received_timestamps = [int(tx["timeStamp"]) for tx in received_txs if tx.get("timeStamp")]
    all_timestamps = sent_timestamps + received_timestamps
    
    features["Sent tnx"] = len(sent_txs)
    features["Received Tnx"] = len(received_txs)
    features["total transactions (including tnx to create contract"] = len(eth_txs)
    features["Number of Created Contracts"] = len(contract_creations)
    
    features["Avg min between sent tnx"] = compute_avg_time_between(sent_timestamps)
    features["Avg min between received tnx"] = compute_avg_time_between(received_timestamps)
    
    if all_timestamps:
        features["Time Diff between first and last (Mins)"] = (max(all_timestamps) - min(all_timestamps)) / 60
    
    # ─── Counterparty diversity ───
    unique_sent_to = {tx.get("to", "").lower() for tx in sent_txs if tx.get("to")}
    unique_received_from = {tx.get("from", "").lower() for tx in received_txs if tx.get("from")}
    features["Unique Sent To Addresses"] = len(unique_sent_to)
    features["Unique Received From Addresses"] = len(unique_received_from)
    
    # ─── Ether value statistics ───
    sent_values = [wei_to_ether(tx.get("value", 0)) for tx in sent_txs]
    received_values = [wei_to_ether(tx.get("value", 0)) for tx in received_txs]
    
    if received_values:
        features["min value received"] = min(received_values)
        features["max value received "] = max(received_values)
        features["avg val received"] = np.mean(received_values)
        features["total ether received"] = sum(received_values)
    
    if sent_values:
        features["min val sent"] = min(sent_values)
        features["max val sent"] = max(sent_values)
        features["avg val sent"] = np.mean(sent_values)
        features["total Ether sent"] = sum(sent_values)
    
    features["total ether balance"] = wei_to_ether(balance_wei) if balance_wei else 0.0
    
    # ─── Contract interaction ───
    contract_values = [wei_to_ether(tx.get("value", 0)) for tx in contract_txs]
    if contract_values:
        features["min value sent to contract"] = min(contract_values)
        features["max val sent to contract"] = max(contract_values)
        features["avg value sent to contract"] = np.mean(contract_values)
        features["total ether sent contracts"] = sum(contract_values)
    
    # ─── ERC-20 activity ───
    if token_txs:
        sent_tokens = [tx for tx in token_txs if tx.get("from", "").lower() == address]
        received_tokens = [tx for tx in token_txs if tx.get("to", "").lower() == address]
        contract_tokens = [tx for tx in sent_tokens if tx.get("to", "").lower() in contract_creations]
        
        features[" Total ERC20 tnxs"] = len(token_txs)
        
        # Token values (approximated as raw value / 1e18)
        sent_token_values = [int(tx.get("value", 0)) / 1e18 for tx in sent_tokens]
        received_token_values = [int(tx.get("value", 0)) / 1e18 for tx in received_tokens]
        contract_token_values = [int(tx.get("value", 0)) / 1e18 for tx in contract_tokens]
        
        features[" ERC20 total ether sent"] = sum(sent_token_values)
        features[" ERC20 total Ether received"] = sum(received_token_values)
        features[" ERC20 total Ether sent contract"] = sum(contract_token_values)
        
        # Unique addresses
        features[" ERC20 uniq sent addr"] = len({tx.get("to", "").lower() for tx in sent_tokens})
        features[" ERC20 uniq rec addr"] = len({tx.get("from", "").lower() for tx in received_tokens})
        features[" ERC20 uniq sent addr.1"] = features[" ERC20 uniq sent addr"]  # duplicate in dataset
        features[" ERC20 uniq rec contract addr"] = len({tx.get("from", "").lower() for tx in contract_tokens})
        
        # Timing
        sent_token_ts = [int(tx["timeStamp"]) for tx in sent_tokens if tx.get("timeStamp")]
        received_token_ts = [int(tx["timeStamp"]) for tx in received_tokens if tx.get("timeStamp")]
        contract_token_ts = [int(tx["timeStamp"]) for tx in contract_tokens if tx.get("timeStamp")]
        
        features[" ERC20 avg time between sent tnx"] = compute_avg_time_between(sent_token_ts)
        features[" ERC20 avg time between rec tnx"] = compute_avg_time_between(received_token_ts)
        features[" ERC20 avg time between rec 2 tnx"] = features[" ERC20 avg time between rec tnx"]
        features[" ERC20 avg time between contract tnx"] = compute_avg_time_between(contract_token_ts)
        
        # Value stats
        if received_token_values:
            features[" ERC20 min val rec"] = min(received_token_values)
            features[" ERC20 max val rec"] = max(received_token_values)
            features[" ERC20 avg val rec"] = np.mean(received_token_values)
        
        if sent_token_values:
            features[" ERC20 min val sent"] = min(sent_token_values)
            features[" ERC20 max val sent"] = max(sent_token_values)
            features[" ERC20 avg val sent"] = np.mean(sent_token_values)
        
        if contract_token_values:
            features[" ERC20 min val sent contract"] = min(contract_token_values)
            features[" ERC20 max val sent contract"] = max(contract_token_values)
            features[" ERC20 avg val sent contract"] = np.mean(contract_token_values)
        
        # Unique token names
        sent_token_names = [tx.get("tokenSymbol", "Unknown") for tx in sent_tokens]
        received_token_names = [tx.get("tokenSymbol", "Unknown") for tx in received_tokens]
        
        features[" ERC20 uniq sent token name"] = len(set(sent_token_names))
        features[" ERC20 uniq rec token name"] = len(set(received_token_names))
        
        # Most common token types
        if sent_token_names:
            features[" ERC20 most sent token type"] = Counter(sent_token_names).most_common(1)[0][0]
        if received_token_names:
            features[" ERC20_most_rec_token_type"] = Counter(received_token_names).most_common(1)[0][0]
    
    return features
