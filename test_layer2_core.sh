#!/bin/bash
# test_layer2_core.sh
#
# This script tests the core functionality of the Layer-2 system on Solana.
# It compiles the code, runs the unit tests, and runs the integration tests.

set -e

echo "===== Testing Layer-2 Core Components ====="

# Create build directory if it doesn't exist
mkdir -p build

# Compile the code
echo "Compiling Layer-2 code..."
rustc --edition=2021 -o build/layer2_test src/lib.rs src/rollup/mod.rs src/rollup/optimistic_rollup.rs src/bridge/mod.rs src/bridge/complete_bridge.rs src/sequencer/mod.rs src/sequencer/transaction_sequencer.rs src/fee_optimization/mod.rs src/fee_optimization/gasless_transactions.rs src/interfaces/mod.rs src/interfaces/rollup_interface.rs src/interfaces/bridge_interface.rs src/interfaces/sequencer_interface.rs src/interfaces/fee_optimization_interface.rs src/integration_test.rs

# Run unit tests
echo "Running unit tests..."
cargo test --lib

# Run integration tests
echo "Running integration tests..."
cargo test --test integration_test

echo "===== All tests passed! ====="
