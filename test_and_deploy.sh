#!/bin/bash

# Layer-2 on Solana - Comprehensive Testing and Deployment Script
# This script performs a complete test suite and deploys the Layer-2 solution

# Set environment variables
export NODE_ENV=test
export SOLANA_RPC_URL="https://api.devnet.solana.com"
export LAYER2_RPC_URL="http://localhost:8899"

# Text colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print header
echo -e "${BLUE}=========================================================${NC}"
echo -e "${BLUE}   Layer-2 on Solana - Testing and Deployment Script     ${NC}"
echo -e "${BLUE}=========================================================${NC}"

# Function to check if a command was successful
check_status() {
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Success${NC}"
  else
    echo -e "${RED}✗ Failed${NC}"
    if [ "$1" == "critical" ]; then
      echo -e "${RED}Critical error. Exiting.${NC}"
      exit 1
    fi
  fi
}

# Function to run a test and report results
run_test() {
  local test_name=$1
  local test_command=$2
  local criticality=$3
  
  echo -e "\n${YELLOW}Running test: ${test_name}${NC}"
  eval $test_command
  
  check_status $criticality
}

# Start local Solana validator for testing
echo -e "\n${YELLOW}Starting local Solana validator...${NC}"
solana-test-validator --reset --quiet &
VALIDATOR_PID=$!

# Wait for validator to start
echo "Waiting for validator to start..."
sleep 5

# Install dependencies
echo -e "\n${YELLOW}Installing dependencies...${NC}"
npm install
check_status "critical"

# Build the project
echo -e "\n${YELLOW}Building the project...${NC}"
npm run build
check_status "critical"

# Run unit tests
run_test "Unit Tests" "npm run test:unit" "critical"

# Run integration tests
run_test "Integration Tests" "npm run test:integration" "critical"

# Run fraud proof tests
run_test "Fraud Proof Tests" "npm run test:fraud-proof" "critical"

# Run bridge tests
run_test "Bridge Tests" "npm run test:bridge" "critical"

# Run security tests
run_test "Security Tests" "npm run test:security" "critical"

# Run stress tests
run_test "Stress Tests" "npm run test:stress" "non-critical"

# Run end-to-end tests
run_test "End-to-End Tests" "npm run test:e2e" "critical"

# Run frontend tests
run_test "Frontend Tests" "cd frontend && npm test" "non-critical"

# Run mobile tests
run_test "Mobile Tests" "cd mobile && npm test" "non-critical"

# Run performance benchmarks
echo -e "\n${YELLOW}Running performance benchmarks...${NC}"
npm run benchmark
check_status "non-critical"

# Generate test coverage report
echo -e "\n${YELLOW}Generating test coverage report...${NC}"
npm run coverage
check_status "non-critical"

# Stop the local validator
echo -e "\n${YELLOW}Stopping local Solana validator...${NC}"
kill $VALIDATOR_PID
wait $VALIDATOR_PID 2>/dev/null
echo -e "${GREEN}Validator stopped${NC}"

# Prepare for deployment
echo -e "\n${YELLOW}Preparing for deployment...${NC}"

# Check if we're deploying to testnet or mainnet
if [ "$1" == "mainnet" ]; then
  NETWORK="mainnet-beta"
  echo -e "${RED}WARNING: Deploying to MAINNET${NC}"
  read -p "Are you sure you want to deploy to mainnet? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Deployment cancelled${NC}"
    exit 0
  fi
else
  NETWORK="testnet"
  echo -e "${YELLOW}Deploying to TESTNET${NC}"
fi

# Set network-specific environment variables
export SOLANA_NETWORK=$NETWORK
export SOLANA_RPC_URL="https://api.${NETWORK}.solana.com"

# Deploy contracts
echo -e "\n${YELLOW}Deploying contracts to ${NETWORK}...${NC}"
npm run deploy:contracts -- --network $NETWORK
check_status "critical"

# Deploy backend
echo -e "\n${YELLOW}Deploying backend services...${NC}"
npm run deploy:backend
check_status "critical"

# Deploy frontend
echo -e "\n${YELLOW}Deploying frontend...${NC}"
cd frontend && npm run build && npm run deploy -- --network $NETWORK
check_status "critical"

# Deploy mobile app
echo -e "\n${YELLOW}Building mobile app...${NC}"
cd ../mobile && npm run build
check_status "non-critical"

# Verify deployment
echo -e "\n${YELLOW}Verifying deployment...${NC}"
npm run verify:deployment -- --network $NETWORK
check_status "critical"

# Print deployment information
echo -e "\n${GREEN}=========================================================${NC}"
echo -e "${GREEN}   Layer-2 on Solana - Deployment Successful!           ${NC}"
echo -e "${GREEN}=========================================================${NC}"
echo -e "${YELLOW}Network:${NC} $NETWORK"
echo -e "${YELLOW}Frontend URL:${NC} https://layer2-solana.com"
echo -e "${YELLOW}API URL:${NC} https://api.layer2-solana.com"
echo -e "${YELLOW}Explorer URL:${NC} https://explorer.layer2-solana.com"
echo -e "${YELLOW}Documentation:${NC} https://docs.layer2-solana.com"

# Exit successfully
exit 0
