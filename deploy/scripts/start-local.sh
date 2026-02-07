#!/bin/bash
# Start all DeFiGuardian services for local testing
#
# This script starts:
#   1. Hardhat local node
#   2. Agent (ML analysis)
#   3. Guardian Mock (FROST voting)
#
# For deploying contracts, run separately:
#   npm run deploy:local
#
# Usage:
#   ./scripts/start-local.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$DEPLOY_DIR")"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🚀 Starting DeFiGuardian Local Environment${NC}"
echo ""

# Check if ports are available
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Port $1 is already in use${NC}"
        return 1
    fi
    return 0
}

echo "Checking ports..."
check_port 8545 || { echo "Hardhat node port 8545 in use"; exit 1; }
check_port 3000 || { echo "VDF Worker port 3000 in use"; exit 1; }
check_port 3001 || { echo "Guardian Mock port 3001 in use"; exit 1; }
check_port 5000 || { echo "Agent port 5000 in use"; exit 1; }
echo "All ports available."
echo ""

# Create log directory
LOG_DIR="$DEPLOY_DIR/logs"
mkdir -p "$LOG_DIR"

# Function to cleanup on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down services...${NC}"
    pkill -f "hardhat node" 2>/dev/null || true
    pkill -f "guardian-mock" 2>/dev/null || true
    pkill -f "vdf-worker" 2>/dev/null || true
    pkill -f "python.*main.py" 2>/dev/null || true
    echo "Done."
}
trap cleanup EXIT

# 1. Start Hardhat node
echo -e "${GREEN}1/3 Starting Hardhat node...${NC}"
cd "$DEPLOY_DIR"
npx hardhat node > "$LOG_DIR/hardhat.log" 2>&1 &
sleep 3
echo "    Hardhat node running on http://localhost:8545"

# 2. Start Agent
echo -e "${GREEN}2/3 Starting ML Agent...${NC}"
cd "$ROOT_DIR/agent"
uv run main.py > "$LOG_DIR/agent.log" 2>&1 &
sleep 2
echo "    Agent running on http://localhost:5000"

# 3. Start Guardian Mock
echo -e "${GREEN}3/3 Starting Guardian Mock...${NC}"
cd "$ROOT_DIR/guardian-mock"
npm install > /dev/null 2>&1
npm run start > "$LOG_DIR/guardian.log" 2>&1 &
sleep 2
echo "    Guardian Mock running on http://localhost:3001"

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ All services running!${NC}"
echo ""
echo "  Services:"
echo "    • Hardhat Node:   http://localhost:8545"
echo "    • Agent:          http://localhost:5000"
echo "    • Guardian Mock:  http://localhost:3001"
echo ""
echo "  Logs: $LOG_DIR/"
echo ""
echo "  Press Ctrl+C to stop all services."
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"

# Wait forever
wait
