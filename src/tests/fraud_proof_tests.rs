// src/tests/fraud_proof_tests.rs
//! Comprehensive tests for the Fraud Proof System
//! 
//! This module contains detailed tests for the fraud proof system,
//! including edge cases and stress tests.

use crate::fraud_proof_system::{
    FraudProofSystem,
    FraudProofType,
    StateTransition,
    MerkleTree,
    verify_fraud_proof,
    ProofVerificationResult,
    BisectionGame,
    BisectionGameState,
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

/// Test fraud proof generation with various transaction types
#[test]
fn test_fraud_proof_generation_with_various_transactions() {
    // Create a fraud proof system
    let fraud_proof_system = FraudProofSystem::new();
    
    // Test with transfer transaction
    test_with_transfer_transaction(&fraud_proof_system);
    
    // Test with multiple instructions
    test_with_multiple_instructions(&fraud_proof_system);
    
    // Test with large transaction
    test_with_large_transaction(&fraud_proof_system);
}

/// Test with a simple transfer transaction
fn test_with_transfer_transaction(fraud_proof_system: &FraudProofSystem) {
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
    
    // Verify the fraud proof properties
    assert_eq!(fraud_proof.proof_type, FraudProofType::ExecutionFraud);
    assert_eq!(fraud_proof.pre_state_root, pre_state_root);
    assert_eq!(fraud_proof.post_state_root, post_state_root);
    assert_eq!(fraud_proof.expected_post_state_root, expected_post_state_root);
}

/// Test with multiple instructions in a transaction
fn test_with_multiple_instructions(fraud_proof_system: &FraudProofSystem) {
    // Create keypairs for testing
    let from_keypair = Keypair::new();
    let to_pubkey1 = Pubkey::new_unique();
    let to_pubkey2 = Pubkey::new_unique();
    
    // Create multiple transfer instructions
    let instruction1 = system_instruction::transfer(
        &from_keypair.pubkey(),
        &to_pubkey1,
        50,
    );
    
    let instruction2 = system_instruction::transfer(
        &from_keypair.pubkey(),
        &to_pubkey2,
        50,
    );
    
    let message = solana_program::message::Message::new(
        &[instruction1, instruction2],
        Some(&from_keypair.pubkey()),
    );
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
}

/// Test with a large transaction
fn test_with_large_transaction(fraud_proof_system: &FraudProofSystem) {
    // Create keypairs for testing
    let from_keypair = Keypair::new();
    let mut instructions = Vec::new();
    
    // Create 10 transfer instructions
    for _ in 0..10 {
        let to_pubkey = Pubkey::new_unique();
        let instruction = system_instruction::transfer(
            &from_keypair.pubkey(),
            &to_pubkey,
            10,
        );
        instructions.push(instruction);
    }
    
    let message = solana_program::message::Message::new(
        &instructions,
        Some(&from_keypair.pubkey()),
    );
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
}

/// Test the bisection game
#[test]
fn test_bisection_game() {
    // Create a fraud proof system
    let fraud_proof_system = FraudProofSystem::new();
    
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
    
    // Start a bisection game
    let game = fraud_proof_system.start_bisection_game(
        pre_state_root,
        post_state_root,
        expected_post_state_root,
        &transaction_data,
    ).unwrap();
    
    // Verify the game is in progress
    assert_eq!(game.state, BisectionGameState::InProgress);
    
    // Verify the game properties
    assert_eq!(game.pre_state_root, pre_state_root);
    assert_eq!(game.post_state_root, post_state_root);
    assert_eq!(game.expected_post_state_root, expected_post_state_root);
    assert_eq!(game.transactions.len(), 1);
}

/// Test the Merkle tree implementation
#[test]
fn test_merkle_tree() {
    // Create a set of leaves
    let leaves = vec![
        [1; 32], [2; 32], [3; 32], [4; 32], [5; 32], [6; 32], [7; 32], [8; 32],
    ];
    
    // Create a Merkle tree
    let tree = MerkleTree::new(leaves.clone());
    
    // Get the root
    let root = tree.root();
    
    // Verify the root is not zero
    assert_ne!(root, [0; 32]);
    
    // Generate and verify proofs for each leaf
    for (i, leaf) in leaves.iter().enumerate() {
        let proof = tree.generate_proof(i);
        let result = MerkleTree::verify_proof(&root, leaf, &proof, i);
        assert!(result);
    }
    
    // Verify with an incorrect leaf
    let incorrect_leaf = [9; 32];
    let proof = tree.generate_proof(0);
    let result = MerkleTree::verify_proof(&root, &incorrect_leaf, &proof, 0);
    assert!(!result);
}

/// Test fraud proof verification
#[test]
fn test_fraud_proof_verification() {
    // Create a fraud proof system
    let fraud_proof_system = FraudProofSystem::new();
    
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
    
    // Serialize and deserialize the fraud proof
    let serialized = fraud_proof.serialize().unwrap();
    let deserialized = crate::fraud_proof_system::fraud_proof::FraudProof::deserialize(&serialized).unwrap();
    
    // Verify the deserialized fraud proof
    let result = fraud_proof_system.verify_fraud_proof(&deserialized).unwrap();
    assert!(result);
}
