#!/bin/bash
# Compiles Circom circuit → WASM + R1CS → generates proving key
# Run this once before deploying 
# Output goes to /artifacts/
# artifacts must ship with guardian node package
#
# Requirements:
#   - circom 2.x
#   - snarkjs
#   - download powersOfTau_0001.ptau from https://github.com/privacy-ethereum/perpetualpowersoftau

set -e

CIRCUIT_NAME="GuardianVote"
CIRCUITS_DIR="../circuits"
ARTIFACTS_DIR="../artifacts"
CEREMONY_FILE="powersOfTau_0001.ptau"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " ZK circuit compilation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

mkdir -p $ARTIFACTS_DIR

# Compile: Circom → WASM + R1CS
echo ""
echo "[1/5] Compiling circuit..."
circom $CIRCUITS_DIR/$CIRCUIT_NAME.circom \
  --wasm \
  --r1cs \
  --output $ARTIFACTS_DIR \
  --include node_modules

echo "  ✓ $CIRCUIT_NAME.wasm"
echo "  ✓ $CIRCUIT_NAME.r1cs"

# ─── Step 2: Download Powers of Tau (trusted setup) ───
# Using Hermez's ceremony — widely used, trusted.
# In production: run a guardian-participated multi-party ceremony instead.
echo ""
echo "[2/5] Downloading Powers of Tau ceremony..."
if [ ! -f "$ARTIFACTS_DIR/$CEREMONY_FILE" ]; then
  wget -q \
    "https://hermez.s3.amazonaws.com/$CEREMONY_FILE" \
    -O "$ARTIFACTS_DIR/$CEREMONY_FILE"
  echo "  ✓ Downloaded $CEREMONY_FILE"
else
  echo "  ✓ Already exists, skipping download"
fi

# ─── Step 3: Prepare ceremony for our circuit ───
echo ""
echo "[3/5] Preparing ceremony for circuit..."
snarkjs powersoftau prepare_phase2 \
  $ARTIFACTS_DIR/$CEREMONY_FILE \
  $ARTIFACTS_DIR/${CIRCUIT_NAME}_prepared.ptau \
  --verbose 2>/dev/null

echo "  ✓ Prepared phase 2"

# ─── Step 4: Generate zkey (proving key) ───
echo ""
echo "[4/5] Generating proving key (zkey)..."
snarkjs groth16 setup \
  $ARTIFACTS_DIR/$CIRCUIT_NAME.r1cs \
  $ARTIFACTS_DIR/${CIRCUIT_NAME}_prepared.ptau \
  $ARTIFACTS_DIR/${CIRCUIT_NAME}_0000.zkey

echo "  ✓ Initial zkey generated"

# Contribute to ceremony (for hackathon: single contribution is fine)
# In production: each guardian contributes to the ceremony
echo "  Contributing to ceremony..."
snarkjs zkey contribute \
  $ARTIFACTS_DIR/${CIRCUIT_NAME}_0000.zkey \
  $ARTIFACTS_DIR/${CIRCUIT_NAME}_final.zkey \
  --name="guardian-protocol-hackathon" \
  -e "guardian protocol random entropy $(date +%s)" 2>/dev/null

echo "  ✓ Final zkey ready"

# ─── Step 5: Export Solidity verifier ───
echo ""
echo "[5/5] Exporting Solidity verifier contract..."
snarkjs zkey export verifyingkey \
  $ARTIFACTS_DIR/${CIRCUIT_NAME}_final.zkey \
  $ARTIFACTS_DIR/${CIRCUIT_NAME}_verification_key.json

snarkjs groth16 export solidityverifier \
  $ARTIFACTS_DIR/${CIRCUIT_NAME}_final.zkey \
  ../contracts/${CIRCUIT_NAME}Verifier.sol

echo "  ✓ Solidity verifier exported to contracts/"

# ─── Cleanup intermediate files ───
rm -f $ARTIFACTS_DIR/${CIRCUIT_NAME}_0000.zkey
rm -f $ARTIFACTS_DIR/${CIRCUIT_NAME}_prepared.ptau
rm -f $ARTIFACTS_DIR/$CEREMONY_FILE

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Done. Artifacts:"
echo "   $ARTIFACTS_DIR/$CIRCUIT_NAME.wasm          (witness generation)"
echo "   $ARTIFACTS_DIR/${CIRCUIT_NAME}_final.zkey  (proving key)"
echo "   ../contracts/${CIRCUIT_NAME}Verifier.sol   (on-chain verifier)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
