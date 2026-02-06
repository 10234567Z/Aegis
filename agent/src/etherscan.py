"""
Etherscan API client for fetching wallet transaction history.
"""

import os
import requests
from typing import Any

ETHERSCAN_API_URL = "https://api.etherscan.io/api"


class EtherscanClient:
    """Client for Etherscan API."""
    
    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.getenv("ETHERSCAN_API_KEY", "")
        if not self.api_key:
            print("Warning: No ETHERSCAN_API_KEY set. Rate limits will be strict.")
    
    def _request(self, params: dict[str, Any]) -> dict[str, Any]:
        """Make a request to Etherscan API."""
        params["apikey"] = self.api_key
        response = requests.get(ETHERSCAN_API_URL, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()
        
        if data.get("status") == "0" and data.get("message") == "No transactions found":
            return {"result": []}
        
        if data.get("status") == "0":
            raise Exception(f"Etherscan API error: {data.get('message', 'Unknown error')}")
        
        return data
    
    def get_transactions(self, address: str) -> list[dict[str, Any]]:
        """Get all ETH transactions for an address."""
        data = self._request({
            "module": "account",
            "action": "txlist",
            "address": address,
            "startblock": 0,
            "endblock": 99999999,
            "sort": "asc",
        })
        return data.get("result", [])
    
    def get_token_transactions(self, address: str) -> list[dict[str, Any]]:
        """Get all ERC-20 token transactions for an address."""
        data = self._request({
            "module": "account",
            "action": "tokentx",
            "address": address,
            "startblock": 0,
            "endblock": 99999999,
            "sort": "asc",
        })
        return data.get("result", [])
    
    def get_balance(self, address: str) -> str:
        """Get current ETH balance in Wei."""
        data = self._request({
            "module": "account",
            "action": "balance",
            "address": address,
            "tag": "latest",
        })
        return data.get("result", "0")
    
    def fetch_all(self, address: str) -> tuple[list[dict], list[dict], str]:
        """
        Fetch all data needed for feature computation.
        
        Returns:
            Tuple of (eth_transactions, token_transactions, balance_wei)
        """
        eth_txs = self.get_transactions(address)
        token_txs = self.get_token_transactions(address)
        balance = self.get_balance(address)
        return eth_txs, token_txs, balance
