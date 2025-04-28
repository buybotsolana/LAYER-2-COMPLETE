#!/bin/bash
# setup-local-testnet.sh

# Start local Ethereum node
echo "Starting local Ethereum node..."
ganache-cli --deterministic --mnemonic "test test test test test test test test test test test junk" &
ETHEREUM_PID=$!

# Start local Solana validator
echo "Starting local Solana validator..."
solana-test-validator &
SOLANA_PID=$!

# Wait for nodes to start
sleep 5

# Deploy L1 contracts
echo "Deploying L1 contracts..."
cd ethereum
npx hardhat run scripts/deploy.js --network localhost
cd ..

# Start L2 sequencer
echo "Starting L2 sequencer..."
cd sequencer
cargo run --release -- --ethereum-rpc http://localhost:8545 --solana-rpc http://localhost:8899 &
SEQUENCER_PID=$!

# Start L2 validator
echo "Starting L2 validator..."
cd validator
cargo run --release -- --ethereum-rpc http://localhost:8545 --solana-rpc http://localhost:8899 &
VALIDATOR_PID=$!

echo "Local testnet is running!"
echo "Ethereum RPC: http://localhost:8545"
echo "Solana RPC: http://localhost:8899"
echo "L2 API: http://localhost:3000"

# Function to clean up processes on exit
function cleanup {
  echo "Shutting down..."
  kill $ETHEREUM_PID $SOLANA_PID $SEQUENCER_PID $VALIDATOR_PID
}

# Register the cleanup function for SIGINT and SIGTERM
trap cleanup SIGINT SIGTERM

# Keep script running
wait
