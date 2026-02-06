"""
XGBoost model loading and prediction with SHAP explanations.
"""

import os
import json
import pickle
import numpy as np
import pandas as pd
import xgboost as xgb

from pathlib import Path
from typing import Any

# Try to import shap, but make it optional for lighter deployments
try:
    import shap
    SHAP_AVAILABLE = True
except ImportError:
    SHAP_AVAILABLE = False
    print("Warning: SHAP not available. Detailed explanations disabled.")

from .features import FEATURE_COLUMNS, FEATURE_DEFAULTS


class FraudDetector:
    """XGBoost-based fraud detection with SHAP explanations."""
    
    def __init__(self, model_path: str | None = None, preprocessors_path: str | None = None):
        """
        Initialize the fraud detector.
        
        Args:
            model_path: Path to XGBoost model JSON file
            preprocessors_path: Path to pickled preprocessors (scaler, encoders)
        """
        self.model: xgb.XGBClassifier | None = None
        self.scaler = None
        self.label_encoders: dict[str, Any] = {}
        self.explainer = None
        
        # Default paths
        base_dir = Path(__file__).parent.parent
        model_path = model_path or str(base_dir / "models" / "eth_fraud_xgb.json")
        preprocessors_path = preprocessors_path or str(base_dir / "models" / "preprocessors.pkl")
        
        self._load_model(model_path)
        self._load_preprocessors(preprocessors_path)
    
    def _load_model(self, path: str) -> None:
        """Load the XGBoost model."""
        if not os.path.exists(path):
            print(f"Warning: Model not found at {path}. Using dummy model.")
            return
        
        self.model = xgb.XGBClassifier()
        self.model.load_model(path)
        
        if SHAP_AVAILABLE:
            self.explainer = shap.TreeExplainer(self.model)
    
    def _load_preprocessors(self, path: str) -> None:
        """Load scaler and label encoders."""
        if not os.path.exists(path):
            print(f"Warning: Preprocessors not found at {path}. Using defaults.")
            return
        
        with open(path, "rb") as f:
            data = pickle.load(f)
            self.scaler = data.get("scaler")
            self.label_encoders = data.get("label_encoders", {})
    
    def _preprocess(self, features: dict[str, Any]) -> pd.DataFrame:
        """Preprocess features for model input."""
        # Create DataFrame with correct column order
        df = pd.DataFrame([features])[FEATURE_COLUMNS]
        
        # Handle categorical columns
        cat_cols = [" ERC20 most sent token type", " ERC20_most_rec_token_type"]
        for col in cat_cols:
            if col in df.columns:
                val = str(df[col].iloc[0])
                if col in self.label_encoders:
                    # Use encoder if available
                    try:
                        df[col] = self.label_encoders[col].transform([val])[0]
                    except ValueError:
                        # Unknown category - use 0
                        df[col] = 0
                else:
                    # Simple hash encoding as fallback
                    df[col] = hash(val) % 1000
        
        # Scale numerical columns
        num_cols = [c for c in df.columns if c not in cat_cols]
        if self.scaler is not None:
            df[num_cols] = self.scaler.transform(df[num_cols])
        
        return df
    
    def predict(self, features: dict[str, Any]) -> dict[str, Any]:
        """
        Run fraud prediction on computed features.
        
        Args:
            features: Dictionary of 47 computed features
            
        Returns:
            Dictionary with prediction results
        """
        if self.model is None:
            # Dummy prediction for testing
            return {
                "is_fraud": False,
                "fraud_probability": 0.15,
                "confidence": "low",
                "model_loaded": False,
            }
        
        df = self._preprocess(features)
        
        prob = self.model.predict_proba(df)[0, 1]
        is_fraud = prob >= 0.5
        
        # Confidence levels
        if prob >= 0.85 or prob <= 0.15:
            confidence = "high"
        elif prob >= 0.7 or prob <= 0.3:
            confidence = "medium"
        else:
            confidence = "low"
        
        return {
            "is_fraud": bool(is_fraud),
            "fraud_probability": float(prob),
            "confidence": confidence,
            "model_loaded": True,
        }
    
    def explain(self, features: dict[str, Any], top_n: int = 5) -> list[dict[str, Any]]:
        """
        Generate SHAP-based explanation for prediction.
        
        Args:
            features: Dictionary of 47 computed features
            top_n: Number of top contributing features to return
            
        Returns:
            List of top contributing features with their impact
        """
        if not SHAP_AVAILABLE or self.explainer is None:
            return self._fallback_explanation(features, top_n)
        
        df = self._preprocess(features)
        shap_values = self.explainer.shap_values(df)
        
        # Get absolute SHAP values for ranking
        importance = pd.Series(
            np.abs(shap_values[0]),
            index=FEATURE_COLUMNS
        ).sort_values(ascending=False)
        
        explanations = []
        for feat in importance.head(top_n).index:
            shap_val = shap_values[0][FEATURE_COLUMNS.index(feat)]
            raw_val = features.get(feat, 0)
            
            explanations.append({
                "feature": feat.strip(),
                "impact": "increases" if shap_val > 0 else "decreases",
                "importance": float(abs(shap_val)),
                "value": raw_val,
                "reason": self._feature_to_reason(feat, raw_val, shap_val),
            })
        
        return explanations
    
    def _fallback_explanation(self, features: dict[str, Any], top_n: int) -> list[dict[str, Any]]:
        """Generate explanation without SHAP (based on feature importance)."""
        # Top features from model training (hardcoded from notebook output)
        important_features = [
            " ERC20_most_rec_token_type",
            " Total ERC20 tnxs",
            "Time Diff between first and last (Mins)",
            "Unique Received From Addresses",
            " ERC20 most sent token type",
            "avg val received",
            "Sent tnx",
            "Unique Sent To Addresses",
        ]
        
        explanations = []
        for feat in important_features[:top_n]:
            raw_val = features.get(feat, FEATURE_DEFAULTS.get(feat, 0))
            explanations.append({
                "feature": feat.strip(),
                "impact": "unknown",
                "importance": 0.0,
                "value": raw_val,
                "reason": self._feature_to_reason(feat, raw_val, 0),
            })
        
        return explanations
    
    def _feature_to_reason(self, feat: str, value: Any, shap_val: float) -> str:
        """Convert feature to human-readable reason."""
        feat_lower = feat.lower()
        direction = "high" if shap_val > 0 else "low"
        
        if "erc20" in feat_lower or "token" in feat_lower:
            if "uniq" in feat_lower:
                return f"Interacted with {value} unique token addresses"
            elif "total" in feat_lower and "tnx" in feat_lower:
                return f"Total of {value} ERC-20 transactions"
            elif "type" in feat_lower:
                return f"Most common token type: {value}"
            else:
                return f"Unusual ERC-20 token activity pattern"
        
        elif "time" in feat_lower or "diff" in feat_lower or "min between" in feat_lower:
            if "diff" in feat_lower:
                mins = float(value)
                if mins < 60:
                    return f"Account active for only {mins:.0f} minutes"
                elif mins < 1440:
                    return f"Account active for {mins/60:.1f} hours"
                else:
                    return f"Account active for {mins/1440:.1f} days"
            else:
                return f"Average {value:.1f} minutes between transactions"
        
        elif "uniq" in feat_lower:
            return f"Interacted with {value} unique addresses"
        
        elif "val" in feat_lower or "ether" in feat_lower or "balance" in feat_lower:
            return f"Value metric: {value:.4f} ETH"
        
        elif "sent tnx" in feat_lower:
            return f"Sent {value} transactions"
        
        elif "received" in feat_lower and "tnx" in feat_lower:
            return f"Received {value} transactions"
        
        elif "contract" in feat_lower:
            return f"Contract interaction: {value}"
        
        else:
            return f"{feat.strip()}: {value}"
