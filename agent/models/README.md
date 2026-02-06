# Model files go here

Place the following files in this directory:
- `eth_fraud_xgb.json` - XGBoost model exported from notebook
- `preprocessors.pkl` - Pickled scaler and label encoders

To generate these from the Colab notebook, add this at the end:

```python
import pickle

# Save model
model.save_model("eth_fraud_xgb.json")

# Save preprocessors
preprocessors = {
    "scaler": scaler,
    "label_encoders": label_encoders,
}
with open("preprocessors.pkl", "wb") as f:
    pickle.dump(preprocessors, f)

# Download both files
from google.colab import files
files.download("eth_fraud_xgb.json")
files.download("preprocessors.pkl")
```
