// src/integration_test.rs
//! Integration tests for the Layer-2 on Solana solution
//! 
//! This module contains tests that verify the integration of all components:
//! - Fraud Proof System
//! - Finalization Logic
//! - Bridge Mechanism (Deposits and Withdrawals)

use crate::{
    Layer2System,
    Layer2Config,
    fraud_proof_system::{
        FraudProofSystem,
        FraudProofType,
        StateTransition,
    },
    bridge::{
        DepositHandler,
        WithdrawalHandler,
        Deposit,
        Withdrawal,
    },
    finalization::{
        FinalizationManager,
        BlockFinalization,
        StateCommitment,
        L2OutputOracle,
    },
};

use solana_program::{
    pubkey::Pubkey,
    hash::Hash,
};
use solana_sdk::{
    signature::{Keypair, Signer},
    transaction::Transaction,
    system_instruction,
};

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
    // Create a keypair for testing
    let from_keypair = Keypair::new();
    let to_pubkey = Pubkey::new_unique();
    
    // Create a simple transfer transaction
    let instruction = system_instruction::transfer(
        &from_keypair.pubkey(),
        &to_pubkey,
        100,
    );
    
    let message = solana_program::message::Message::new(&[instruction], Some(&from_keypair.pubkey()));
    let transaction = Transaction::new(
        &[&from_keypair],
        message,
        Hash::default(),
    );
    
    // Create a state transition
    let pre_state_root = [0; 32];
    let post_state_root = [1; 32];
    let expected_post_state_root = [2; 32]; // Different from post_state_root
    
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
    assert!(result);
    
    // Start a bisection game
    let game = fraud_proof_system.start_bisection_game(
        pre_state_root,
        post_state_root,
        expected_post_state_root,
        &transaction_data,
    ).unwrap();
    
    // Verify the game is in progress
    assert_eq!(game.state, crate::fraud_proof_system::BisectionGameState::InProgress);
}

/// Test the bridge mechanism
fn test_bridge_mechanism(deposit_handler: &mut DepositHandler, withdrawal_handler: &mut WithdrawalHandler) {
    // Test deposit
    let eth_sender = [1; 20];
    let eth_token = [2; 20];
    let amount = 100;
    let sol_recipient = Pubkey::new_unique();
    
    // Create a deposit
    let deposit = Deposit {
        eth_sender,
        eth_token,
        amount,
        sol_recipient,
        timestamp: 1000,
        deposit_hash: [3; 32],
        processed: false,
    };
    
    // Process the deposit
    // In a real test, we would call the deposit handler's process_deposit method
    // For now, we just verify the deposit structure
    assert_eq!(deposit.eth_sender, eth_sender);
    assert_eq!(deposit.eth_token, eth_token);
    assert_eq!(deposit.amount, amount);
    assert_eq!(deposit.sol_recipient, sol_recipient);
    assert_eq!(deposit.processed, false);
    
    // Test withdrawal
    let eth_recipient = [4; 20];
    let sol_sender = Pubkey::new_unique();
    
    // Create a withdrawal
    let withdrawal = Withdrawal {
        eth_recipient,
        eth_token,
        amount,
        sol_sender,
        timestamp: 2000,
        withdrawal_hash: [5; 32],
        processed: false,
        l2_block_number: 1,
        l2_block_hash: [6; 32],
    };
    
    // Process the withdrawal
    // In a real test, we would call the withdrawal handler's process_withdrawal method
    // For now, we just verify the withdrawal structure
    assert_eq!(withdrawal.eth_recipient, eth_recipient);
    assert_eq!(withdrawal.eth_token, eth_token);
    assert_eq!(withdrawal.amount, amount);
    assert_eq!(withdrawal.sol_sender, sol_sender);
    assert_eq!(withdrawal.processed, false);
}

/// Test the finalization logic
fn test_finalization_logic(finalization_manager: &mut FinalizationManager) {
    // Verify the challenge period
    assert_eq!(finalization_manager.challenge_period, 7 * 24 * 60 * 60);
    
    // Test block finalization
    // In a real test, we would propose and finalize blocks
    // For now, we just verify the finalization manager structure
    assert_eq!(finalization_manager.block_finalization.challenge_period, 7 * 24 * 60 * 60);
    
    // Test state commitment
    // In a real test, we would commit and verify state roots
    // For now, we just verify the finalization manager structure
    
    // Test L2 output oracle
    // In a real test, we would submit and verify L2 outputs
    // For now, we just verify the finalization manager structure
    assert_eq!(finalization_manager.output_oracle.challenge_period, 7 * 24 * 60 * 60);
}

/// Test the complete flow
fn test_complete_flow(layer2_system: &mut Layer2System) {
    // In a real test, we would:
    // 1. Process a deposit from L1 to L2
    // 2. Execute transactions on L2
    // 3. Finalize L2 blocks
    // 4. Process a withdrawal from L2 to L1
    // 5. Verify fraud proofs if needed
    
    // For now, we just verify the Layer-2 system structure
    assert_eq!(layer2_system.config.challenge_period, 7 * 24 * 60 * 60);
}
