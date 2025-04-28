// src/integration_test.rs
//! Integration tests for the Layer-2 on Solana solution
//! 
//! This module contains comprehensive tests that verify the integration of all components:
//! - Fraud Proof System
//! - Finalization Logic
//! - Bridge Mechanism (Deposits and Withdrawals)
//!
//! These tests ensure that all components work correctly together and that the
//! Layer-2 system functions as expected in various scenarios.

use crate::{
    Layer2System,
    Layer2Config,
    fraud_proof_system::{
        FraudProofSystem,
        FraudProofType,
        StateTransition,
        Transaction,
        BisectionGameState,
        MerkleTree,
        verify_fraud_proof,
        ProofVerificationResult,
    },
    bridge::{
        DepositHandler,
        WithdrawalHandler,
        Deposit,
        Withdrawal,
        DepositStatus,
        WithdrawalStatus,
    },
    finalization::{
        FinalizationManager,
        BlockFinalization,
        StateCommitment,
        L2OutputOracle,
        BlockStatus,
    },
};

use solana_program::{
    pubkey::Pubkey,
    keccak,
};
use std::time::{SystemTime, UNIX_EPOCH};

/// Test the complete Layer-2 system flow
#[test]
fn test_layer2_system_flow() {
    // Create a Layer-2 system configuration
    let config = Layer2Config {
        owner: Pubkey::new_unique(),
        l1_bridge_address: [1; 20],
        l1_withdrawal_bridge_address: [2; 20],
        challenge_period: 7 * 24 * 60 * 60, // 7 days
    };
    
    // Create the Layer-2 system
    let mut layer2_system = Layer2System::new(config);
    
    // Test the fraud proof system
    test_fraud_proof_system(&mut layer2_system.fraud_proof_system);
    
    // Test the bridge mechanism
    test_bridge_mechanism(&mut layer2_system.deposit_handler, &mut layer2_system.withdrawal_handler);
    
    // Test the finalization logic
    test_finalization_logic(&mut layer2_system.finalization_manager);
    
    // Test the complete flow
    test_complete_flow(&mut layer2_system);
}

/// Test the fraud proof system
fn test_fraud_proof_system(fraud_proof_system: &mut FraudProofSystem) {
    // Create a transaction for testing
    let transaction = Transaction {
        sender: [1; 32],
        recipient: [2; 32],
        amount: 100,
        nonce: 0,
        data: Vec::new(),
        signature: [0; 64],
    };
    
    // Create a state transition
    let pre_state_root = [0; 32];
    let state_transition = StateTransition::new(
        pre_state_root,
        transaction.clone(),
        1, // Block number
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(), // Timestamp
    );
    
    // Calculate the post-state root
    let post_state_root = state_transition.calculate_post_state_root().unwrap();
    
    // Create an incorrect expected post-state root
    let mut expected_post_state_root = post_state_root;
    expected_post_state_root[0] ^= 0xFF; // Flip some bits to make it different
    
    // Serialize the transaction
    let transaction_data = bincode::serialize(&transaction).unwrap();
    
    // Generate a fraud proof
    let fraud_proof = fraud_proof_system.generate_fraud_proof(
        pre_state_root,
        post_state_root,
        expected_post_state_root,
        &transaction_data,
        FraudProofType::ExecutionFraud,
    ).unwrap();
    
    // Verify the fraud proof
    let result = fraud_proof_system.verify_fraud_proof(&fraud_proof).unwrap();
    assert!(result, "Fraud proof verification should succeed");
    
    // Start a bisection game
    let mut game = fraud_proof_system.start_bisection_game(
        pre_state_root,
        post_state_root,
        expected_post_state_root,
        &transaction_data,
    ).unwrap();
    
    // Verify the game is in progress
    assert_eq!(game.state, BisectionGameState::InProgress, "Bisection game should be in progress");
    
    // Perform a bisection step
    let result = game.bisect(0);
    assert!(result.is_ok(), "Bisection step should succeed");
    
    // Verify the game has more steps
    assert!(game.steps.len() > 1, "Bisection game should have more steps after bisection");
    
    // Test with a valid state transition
    let valid_fraud_proof = fraud_proof_system.generate_fraud_proof(
        pre_state_root,
        post_state_root,
        post_state_root, // Same as post_state_root
        &transaction_data,
        FraudProofType::ExecutionFraud,
    ).unwrap();
    
    // Verify the valid fraud proof (should be invalid since the state transition is valid)
    let result = fraud_proof_system.verify_fraud_proof(&valid_fraud_proof).unwrap();
    assert!(!result, "Valid state transition should not produce a valid fraud proof");
    
    // Test the Merkle tree implementation
    let leaves = vec![[1; 32], [2; 32], [3; 32], [4; 32]];
    let tree = MerkleTree::new(leaves.clone());
    let root = tree.root();
    
    // Generate and verify proofs for each leaf
    for (i, leaf) in leaves.iter().enumerate() {
        let proof = tree.generate_proof(i);
        let result = MerkleTree::verify_proof(&root, leaf, &proof, i);
        assert!(result, "Merkle proof verification should succeed for leaf {}", i);
    }
}

/// Test the bridge mechanism
fn test_bridge_mechanism(deposit_handler: &mut DepositHandler, withdrawal_handler: &mut WithdrawalHandler) {
    // Test deposit handler
    
    // Add a supported token
    let token = [1; 20];
    let min_amount = 1_000_000; // 1 token
    let max_amount = 1_000_000_000_000; // 1,000,000 tokens
    
    let result = deposit_handler.add_supported_token(token, min_amount, max_amount);
    assert!(result.is_ok(), "Adding supported token should succeed");
    
    // Process a deposit
    let l1_tx_hash = [2; 32];
    let l1_block_number = 1;
    let l1_sender = [3; 20];
    let l2_recipient = [4; 32];
    let amount = 5_000_000; // 5 tokens
    
    let result = deposit_handler.process_deposit(
        l1_tx_hash,
        l1_block_number,
        l1_sender,
        l2_recipient,
        token,
        amount,
    );
    assert!(result.is_ok(), "Processing deposit should succeed");
    let deposit_id = result.unwrap();
    
    // Get the deposit
    let deposit = deposit_handler.get_deposit(deposit_id).unwrap();
    assert_eq!(deposit.l1_tx_hash, l1_tx_hash, "Deposit L1 transaction hash should match");
    assert_eq!(deposit.l1_block_number, l1_block_number, "Deposit L1 block number should match");
    assert_eq!(deposit.l1_sender, l1_sender, "Deposit L1 sender should match");
    assert_eq!(deposit.l2_recipient, l2_recipient, "Deposit L2 recipient should match");
    assert_eq!(deposit.token, token, "Deposit token should match");
    assert_eq!(deposit.amount, amount, "Deposit amount should match");
    assert_eq!(deposit.status, DepositStatus::Pending, "Deposit status should be pending");
    
    // Confirm the deposit
    let result = deposit_handler.confirm_deposit(deposit_id);
    assert!(result.is_ok(), "Confirming deposit should succeed");
    
    // Get the deposit again
    let deposit = deposit_handler.get_deposit(deposit_id).unwrap();
    assert_eq!(deposit.status, DepositStatus::Confirmed, "Deposit status should be confirmed");
    
    // Finalize the deposit
    let l2_tx_hash = [5; 32];
    let result = deposit_handler.finalize_deposit(deposit_id, l2_tx_hash);
    assert!(result.is_ok(), "Finalizing deposit should succeed");
    
    // Get the deposit again
    let deposit = deposit_handler.get_deposit(deposit_id).unwrap();
    assert_eq!(deposit.status, DepositStatus::Finalized, "Deposit status should be finalized");
    assert_eq!(deposit.l2_tx_hash, Some(l2_tx_hash), "Deposit L2 transaction hash should match");
    
    // Test withdrawal handler
    
    // Add the same supported token to the withdrawal handler
    let result = withdrawal_handler.add_supported_token(token, min_amount, max_amount);
    assert!(result.is_ok(), "Adding supported token to withdrawal handler should succeed");
    
    // Initiate a withdrawal
    let l2_tx_hash = [6; 32];
    let l2_block_number = 2;
    let l2_sender = [7; 32];
    let l1_recipient = [8; 20];
    
    let result = withdrawal_handler.initiate_withdrawal(
        l2_tx_hash,
        l2_block_number,
        l2_sender,
        l1_recipient,
        token,
        amount,
    );
    assert!(result.is_ok(), "Initiating withdrawal should succeed");
    let withdrawal_id = result.unwrap();
    
    // Get the withdrawal
    let withdrawal = withdrawal_handler.get_withdrawal(withdrawal_id).unwrap();
    assert_eq!(withdrawal.l2_tx_hash, l2_tx_hash, "Withdrawal L2 transaction hash should match");
    assert_eq!(withdrawal.l2_block_number, l2_block_number, "Withdrawal L2 block number should match");
    assert_eq!(withdrawal.l2_sender, l2_sender, "Withdrawal L2 sender should match");
    assert_eq!(withdrawal.l1_recipient, l1_recipient, "Withdrawal L1 recipient should match");
    assert_eq!(withdrawal.token, token, "Withdrawal token should match");
    assert_eq!(withdrawal.amount, amount, "Withdrawal amount should match");
    assert_eq!(withdrawal.status, WithdrawalStatus::Initiated, "Withdrawal status should be initiated");
    
    // Prove the withdrawal
    let merkle_proof = vec![[9; 32], [10; 32]];
    let merkle_root = [11; 32];
    let leaf_index = 3;
    let block_number = 4;
    
    let result = withdrawal_handler.prove_withdrawal(
        withdrawal_id,
        merkle_proof.clone(),
        merkle_root,
        leaf_index,
        block_number,
    );
    assert!(result.is_ok(), "Proving withdrawal should succeed");
    
    // Get the withdrawal again
    let withdrawal = withdrawal_handler.get_withdrawal(withdrawal_id).unwrap();
    assert_eq!(withdrawal.status, WithdrawalStatus::Proven, "Withdrawal status should be proven");
    assert!(withdrawal.proof.is_some(), "Withdrawal should have a proof");
    
    // Verify the withdrawal proof
    let result = withdrawal_handler.verify_withdrawal_proof(withdrawal_id);
    assert!(result.is_ok(), "Verifying withdrawal proof should succeed");
    assert!(result.unwrap(), "Withdrawal proof should be valid");
    
    // Finalize the withdrawal
    // Note: In a real scenario, we would need to wait for the challenge period to pass
    // For this test, we'll assume it has passed
    let l1_tx_hash = [12; 32];
    let result = withdrawal_handler.finalize_withdrawal(withdrawal_id, l1_tx_hash);
    assert!(result.is_ok(), "Finalizing withdrawal should succeed");
    
    // Get the withdrawal again
    let withdrawal = withdrawal_handler.get_withdrawal(withdrawal_id).unwrap();
    assert_eq!(withdrawal.status, WithdrawalStatus::Finalized, "Withdrawal status should be finalized");
    assert_eq!(withdrawal.l1_tx_hash, Some(l1_tx_hash), "Withdrawal L1 transaction hash should match");
}

/// Test the finalization logic
fn test_finalization_logic(finalization_manager: &mut FinalizationManager) {
    // Verify the challenge period
    assert_eq!(finalization_manager.challenge_period, 7 * 24 * 60 * 60, "Challenge period should be 7 days");
    
    // Test block finalization
    let block_number = 1;
    let block_hash = [1; 32];
    let state_root = [2; 32];
    let proposer = [3; 32];
    
    // Propose a block
    let result = finalization_manager.block_finalization.propose_block(
        block_number,
        block_hash,
        state_root,
        proposer,
    );
    assert!(result.is_ok(), "Proposing a block should succeed");
    
    // Get the block
    let block = finalization_manager.block_finalization.get_block(block_number).unwrap();
    assert_eq!(block.number, block_number, "Block number should match");
    assert_eq!(block.hash, block_hash, "Block hash should match");
    assert_eq!(block.state_root, state_root, "Block state root should match");
    assert_eq!(block.proposer, proposer, "Block proposer should match");
    assert_eq!(block.status, BlockStatus::Pending, "Block status should be pending");
    
    // Test state commitment
    let result = finalization_manager.state_commitment.propose_state_root(
        block_number,
        state_root,
        proposer,
    );
    assert!(result.is_ok(), "Proposing a state root should succeed");
    
    // Get the state root
    let state_root_info = finalization_manager.state_commitment.get_state_root(block_number).unwrap();
    assert_eq!(state_root_info.block_number, block_number, "State root block number should match");
    assert_eq!(state_root_info.root, state_root, "State root should match");
    assert_eq!(state_root_info.committer, proposer, "State root committer should match");
    assert!(!state_root_info.is_committed, "State root should not be committed yet");
    
    // Verify the state root
    let result = finalization_manager.state_commitment.verify_state_root(block_number, state_root);
    assert!(result, "State root verification should succeed");
    
    // Test L2 output oracle
    let result = finalization_manager.output_oracle.submit_output(
        block_number,
        state_root,
        proposer,
    );
    assert!(result.is_ok(), "Submitting an L2 output should succeed");
    let output_index = result.unwrap();
    
    // Get the output
    let output = finalization_manager.output_oracle.get_output(output_index).unwrap();
    assert_eq!(output.block_number, block_number, "Output block number should match");
    assert_eq!(output.root, state_root, "Output root should match");
    assert_eq!(output.submitter, proposer, "Output submitter should match");
    assert!(!output.is_finalized, "Output should not be finalized yet");
    
    // Verify the output
    let result = finalization_manager.output_oracle.verify_output(output_index, state_root);
    assert!(result, "Output verification should succeed");
}

/// Test the complete flow
fn test_complete_flow(layer2_system: &mut Layer2System) {
    // 1. Process a deposit from L1 to L2
    let token = [1; 20];
    let min_amount = 1_000_000; // 1 token
    let max_amount = 1_000_000_000_000; // 1,000,000 tokens
    
    // Add a supported token to the deposit handler
    let result = layer2_system.deposit_handler.add_supported_token(token, min_amount, max_amount);
    assert!(result.is_ok(), "Adding supported token should succeed");
    
    // Process a deposit
    let l1_tx_hash = [2; 32];
    let l1_block_number = 1;
    let l1_sender = [3; 20];
    let l2_recipient = [4; 32];
    let amount = 5_000_000; // 5 tokens
    
    let result = layer2_system.deposit_handler.process_deposit(
        l1_tx_hash,
        l1_block_number,
        l1_sender,
        l2_recipient,
        token,
        amount,
    );
    assert!(result.is_ok(), "Processing deposit should succeed");
    let deposit_id = result.unwrap();
    
    // Confirm and finalize the deposit
    layer2_system.deposit_handler.confirm_deposit(deposit_id).unwrap();
    let l2_tx_hash = [5; 32];
    layer2_system.deposit_handler.finalize_deposit(deposit_id, l2_tx_hash).unwrap();
    
    // 2. Execute transactions on L2
    let transaction = Transaction {
        sender: l2_recipient, // Use the recipient of the deposit as the sender
        recipient: [6; 32],
        amount: 1_000_000, // 1 token
        nonce: 0,
        data: Vec::new(),
        signature: [0; 64],
    };
    
    // Create a state transition
    let pre_state_root = [0; 32];
    let state_transition = StateTransition::new(
        pre_state_root,
        transaction.clone(),
        1, // Block number
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(), // Timestamp
    );
    
    // Calculate the post-state root
    let post_state_root = state_transition.calculate_post_state_root().unwrap();
    
    // 3. Finalize L2 blocks
    let block_number = 1;
    let block_hash = keccak::hash(&[1, 2, 3]).to_bytes();
    let proposer = [7; 32];
    
    // Propose a block
    let result = layer2_system.finalization_manager.block_finalization.propose_block(
        block_number,
        block_hash,
        post_state_root,
        proposer,
    );
    assert!(result.is_ok(), "Proposing a block should succeed");
    
    // Commit the state root
    let result = layer2_system.finalization_manager.state_commitment.propose_state_root(
        block_number,
        post_state_root,
        proposer,
    );
    assert!(result.is_ok(), "Proposing a state root should succeed");
    
    // Submit the L2 output
    let result = layer2_system.finalization_manager.output_oracle.submit_output(
        block_number,
        post_state_root,
        proposer,
    );
    assert!(result.is_ok(), "Submitting an L2 output should succeed");
    let output_index = result.unwrap();
    
    // 4. Process a withdrawal from L2 to L1
    // Add the same supported token to the withdrawal handler
    let result = layer2_system.withdrawal_handler.add_supported_token(token, min_amount, max_amount);
    assert!(result.is_ok(), "Adding supported token to withdrawal handler should succeed");
    
    // Initiate a withdrawal
    let l2_tx_hash = [8; 32];
    let l2_block_number = 2;
    let l2_sender = transaction.recipient; // Use the recipient of the transaction as the sender
    let l1_recipient = [9; 20];
    
    let result = layer2_system.withdrawal_handler.initiate_withdrawal(
        l2_tx_hash,
        l2_block_number,
        l2_sender,
        l1_recipient,
        token,
        500_000, // 0.5 tokens
    );
    assert!(result.is_ok(), "Initiating withdrawal should succeed");
    let withdrawal_id = result.unwrap();
    
    // Prove the withdrawal
    let merkle_proof = vec![[10; 32], [11; 32]];
    let merkle_root = [12; 32];
    let leaf_index = 0;
    
    let result = layer2_system.withdrawal_handler.prove_withdrawal(
        withdrawal_id,
        merkle_proof.clone(),
        merkle_root,
        leaf_index,
        block_number,
    );
    assert!(result.is_ok(), "Proving withdrawal should succeed");
    
    // 5. Verify fraud proofs if needed
    // Create an incorrect state transition
    let mut incorrect_post_state_root = post_state_root;
    incorrect_post_state_root[0] ^= 0xFF; // Flip some bits to make it different
    
    // Serialize the transaction
    let transaction_data = bincode::serialize(&transaction).unwrap();
    
    // Generate a fraud proof
    let fraud_proof = layer2_system.fraud_proof_system.generate_fraud_proof(
        pre_state_root,
        incorrect_post_state_root,
        post_state_root,
        &transaction_data,
        FraudProofType::ExecutionFraud,
    ).unwrap();
    
    // Verify the fraud proof
    let result = layer2_system.fraud_proof_system.verify_fraud_proof(&fraud_proof).unwrap();
    assert!(result, "Fraud proof verification should succeed");
    
    // Challenge the block
    let result = layer2_system.finalization_manager.block_finalization.challenge_block(
        block_number,
        [13; 32], // Challenger
        "Invalid state transition".to_string(),
        fraud_proof.serialize().unwrap(),
    );
    assert!(result.is_ok(), "Challenging a block should succeed");
    
    // Get the block
    let block = layer2_system.finalization_manager.block_finalization.get_block(block_number).unwrap();
    assert_eq!(block.status, BlockStatus::Challenged, "Block status should be challenged");
    
    // Resolve the challenge (assuming the fraud proof is valid)
    let result = layer2_system.finalization_manager.block_finalization.resolve_challenge(
        block_number,
        0, // Challenge index
        true, // Is valid
    );
    assert!(result.is_ok(), "Resolving a challenge should succeed");
    
    // Get the block again
    let block = layer2_system.finalization_manager.block_finalization.get_block(block_number).unwrap();
    assert_eq!(block.status, BlockStatus::Invalidated, "Block status should be invalidated");
}

/// Test threshold contributions for integration tests
#[test]
fn test_threshold_contributions() {
    // Create a Layer-2 system configuration
    let config = Layer2Config {
        owner: Pubkey::new_unique(),
        l1_bridge_address: [1; 20],
        l1_withdrawal_bridge_address: [2; 20],
        challenge_period: 7 * 24 * 60 * 60, // 7 days
    };
    
    // Create the Layer-2 system
    let mut layer2_system = Layer2System::new(config);
    
    // Test with various contribution amounts
    let token = [1; 20];
    let min_amount = 1_000_000; // 1 token
    let max_amount = 1_000_000_000_000; // 1,000,000 tokens
    
    // Add a supported token to the deposit handler
    layer2_system.deposit_handler.add_supported_token(token, min_amount, max_amount).unwrap();
    
    // Test with amount below minimum threshold
    let l1_tx_hash = [2; 32];
    let l1_block_number = 1;
    let l1_sender = [3; 20];
    let l2_recipient = [4; 32];
    let below_min_amount = min_amount - 1;
    
    let result = layer2_system.deposit_handler.process_deposit(
        l1_tx_hash,
        l1_block_number,
        l1_sender,
        l2_recipient,
        token,
        below_min_amount,
    );
    assert!(result.is_err(), "Processing deposit with amount below minimum should fail");
    
    // Test with amount above maximum threshold
    let above_max_amount = max_amount + 1;
    
    let result = layer2_system.deposit_handler.process_deposit(
        l1_tx_hash,
        l1_block_number,
        l1_sender,
        l2_recipient,
        token,
        above_max_amount,
    );
    assert!(result.is_err(), "Processing deposit with amount above maximum should fail");
    
    // Test with amount at minimum threshold
    let result = layer2_system.deposit_handler.process_deposit(
        l1_tx_hash,
        l1_block_number,
        l1_sender,
        l2_recipient,
        token,
        min_amount,
    );
    assert!(result.is_ok(), "Processing deposit with amount at minimum should succeed");
    
    // Test with amount at maximum threshold
    let result = layer2_system.deposit_handler.process_deposit(
        [3; 32], // Different tx hash
        l1_block_number,
        l1_sender,
        l2_recipient,
        token,
        max_amount,
    );
    assert!(result.is_ok(), "Processing deposit with amount at maximum should succeed");
}
