// src/verification.rs
//! Verification of fraud proofs
//! 
//! This module provides functionality for verifying fraud proofs,
//! ensuring that they correctly demonstrate invalid state transitions.

use crate::merkle_tree::MerkleTree;
use crate::state_transition::{StateTransition, State};
use crate::fraud_proof::{FraudProof, FraudProofType};
use crate::solana_runtime_wrapper::SolanaRuntimeWrapper;
use solana_sdk::transaction::Transaction;
use anyhow::Result;

/// Result of fraud proof verification
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProofVerificationResult {
    /// The proof is valid and demonstrates fraud
    Valid,
    
    /// The proof is invalid and does not demonstrate fraud
    Invalid,
    
    /// The proof verification was inconclusive
    Inconclusive,
}

/// Verify a fraud proof
pub fn verify_fraud_proof(
    proof: &FraudProof,
    state: &mut impl State,
) -> Result<ProofVerificationResult> {
    // Deserialize the transaction
    let transaction: Transaction = bincode::deserialize(&proof.transaction_data)
        .map_err(|e| anyhow::anyhow!("Failed to deserialize transaction: {}", e))?;
    
    // Set the state to the pre-state
    state.set_state_root(proof.pre_state_root)
        .map_err(|e| anyhow::anyhow!("Failed to set pre-state: {}", e))?;
    
    // Apply the transaction
    state.apply_transaction(&transaction)
        .map_err(|e| anyhow::anyhow!("Failed to apply transaction: {}", e))?;
    
    // Calculate the post-state root
    let calculated_post_state_root = state.calculate_state_root()
        .map_err(|e| anyhow::anyhow!("Failed to calculate post-state root: {}", e))?;
    
    // Check if the calculated post-state root matches the expected one
    if calculated_post_state_root == proof.expected_post_state_root {
        // The calculated post-state root matches the expected one,
        // which means the fraud proof is valid
        Ok(ProofVerificationResult::Valid)
    } else if calculated_post_state_root == proof.post_state_root {
        // The calculated post-state root matches the claimed one,
        // which means the fraud proof is invalid
        Ok(ProofVerificationResult::Invalid)
    } else {
        // The calculated post-state root matches neither the expected one
        // nor the claimed one, which means the verification is inconclusive
        Ok(ProofVerificationResult::Inconclusive)
    }
}

/// Verify a fraud proof using the Solana Runtime
pub fn verify_fraud_proof_with_runtime(
    proof: &FraudProof,
    runtime: &mut SolanaRuntimeWrapper,
) -> Result<ProofVerificationResult> {
    // Deserialize the transaction
    let transaction: Transaction = bincode::deserialize(&proof.transaction_data)
        .map_err(|e| anyhow::anyhow!("Failed to deserialize transaction: {}", e))?;
    
    // Execute the transaction
    let execution_result = runtime.execute_transaction(&transaction)
        .map_err(|e| anyhow::anyhow!("Failed to execute transaction: {}", e))?;
    
    // Check if the calculated post-state root matches the expected one
    if execution_result.post_state_root == proof.expected_post_state_root {
        // The calculated post-state root matches the expected one,
        // which means the fraud proof is valid
        Ok(ProofVerificationResult::Valid)
    } else if execution_result.post_state_root == proof.post_state_root {
        // The calculated post-state root matches the claimed one,
        // which means the fraud proof is invalid
        Ok(ProofVerificationResult::Invalid)
    } else {
        // The calculated post-state root matches neither the expected one
        // nor the claimed one, which means the verification is inconclusive
        Ok(ProofVerificationResult::Inconclusive)
    }
}

/// Verify a Merkle proof for a transaction
pub fn verify_transaction_inclusion(
    transaction_hash: &[u8; 32],
    transaction_root: &[u8; 32],
    proof: &[[u8; 32]],
    index: usize,
) -> bool {
    MerkleTree::verify_proof(transaction_root, transaction_hash, proof, index)
}

/// Verify a Merkle proof for a state
pub fn verify_state_inclusion(
    state_hash: &[u8; 32],
    state_root: &[u8; 32],
    proof: &[[u8; 32]],
    index: usize,
) -> bool {
    MerkleTree::verify_proof(state_root, state_hash, proof, index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_sdk::signature::{Keypair, Signer};
    use solana_sdk::system_instruction;
    use solana_program::message::Message;
    use solana_program::hash::Hash;
    use std::collections::HashMap;
    
    // Mock implementation of State for testing
    struct MockState {
        state_root: [u8; 32],
        accounts: HashMap<solana_program::pubkey::Pubkey, solana_sdk::account::Account>,
    }
    
    impl MockState {
        fn new() -> Self {
            Self {
                state_root: [0; 32],
                accounts: HashMap::new(),
            }
        }
    }
    
    impl State for MockState {
        fn apply_transaction(&mut self, transaction: &Transaction) -> Result<(), anyhow::Error> {
            // Mock implementation - just update the state root
            self.state_root = [1; 32];
            Ok(())
        }
        
        fn calculate_state_root(&self) -> Result<[u8; 32], anyhow::Error> {
            Ok(self.state_root)
        }
        
        fn set_state_root(&mut self, state_root: [u8; 32]) -> Result<(), anyhow::Error> {
            self.state_root = state_root;
            Ok(())
        }
        
        fn get_state_root(&self) -> Result<[u8; 32], anyhow::Error> {
            Ok(self.state_root)
        }
        
        fn get_proof(&self, account: &solana_program::pubkey::Pubkey) -> Result<Vec<[u8; 32]>, anyhow::Error> {
            // Mock implementation - return empty proof
            Ok(vec![])
        }
        
        fn verify_proof(&self, account: &solana_program::pubkey::Pubkey, proof: &[[u8; 32]]) -> Result<bool, anyhow::Error> {
            // Mock implementation - always return true
            Ok(true)
        }
    }
    
    #[test]
    fn test_fraud_proof_verification() {
        // Create a mock state
        let mut state = MockState::new();
        
        // Create a keypair for testing
        let from_keypair = Keypair::new();
        let to_pubkey = solana_program::pubkey::Pubkey::new_unique();
        
        // Create a simple transfer transaction
        let instruction = system_instruction::transfer(
            &from_keypair.pubkey(),
            &to_pubkey,
            100,
        );
        
        let message = Message::new(&[instruction], Some(&from_keypair.pubkey()));
        let transaction = Transaction::new(
            &[&from_keypair],
            message,
            Hash::default(),
        );
        
        // Serialize the transaction
        let transaction_data = bincode::serialize(&transaction).unwrap();
        
        // Create a valid fraud proof
        let fraud_proof = FraudProof::new(
            FraudProofType::ExecutionFraud,
            [0; 32], // pre_state_root
            [2; 32], // post_state_root (incorrect)
            [1; 32], // expected_post_state_root (correct)
            transaction_data,
            1,
            1000,
        );
        
        // Verify the fraud proof
        let result = verify_fraud_proof(&fraud_proof, &mut state);
        assert!(result.is_ok());
        
        // The result should be Valid because the calculated post-state root ([1; 32])
        // matches the expected one ([1; 32])
        assert_eq!(result.unwrap(), ProofVerificationResult::Valid);
        
        // Create an invalid fraud proof
        let fraud_proof = FraudProof::new(
            FraudProofType::ExecutionFraud,
            [0; 32], // pre_state_root
            [1; 32], // post_state_root (correct)
            [2; 32], // expected_post_state_root (incorrect)
            transaction_data,
            1,
            1000,
        );
        
        // Verify the fraud proof
        let result = verify_fraud_proof(&fraud_proof, &mut state);
        assert!(result.is_ok());
        
        // The result should be Invalid because the calculated post-state root ([1; 32])
        // matches the claimed one ([1; 32])
        assert_eq!(result.unwrap(), ProofVerificationResult::Invalid);
    }
    
    #[test]
    fn test_merkle_proof_verification() {
        // Create a set of leaves
        let leaves = vec![
            [1; 32], [2; 32], [3; 32], [4; 32],
        ];
        
        // Create a Merkle tree
        let tree = MerkleTree::new(leaves.clone());
        
        // Get the root
        let root = tree.root();
        
        // Generate a proof for the first leaf
        let proof = tree.generate_proof(0);
        
        // Verify the proof
        let result = verify_transaction_inclusion(&leaves[0], &root, &proof, 0);
        assert!(result);
        
        // Verify with an incorrect leaf
        let incorrect_leaf = [5; 32];
        let result = verify_transaction_inclusion(&incorrect_leaf, &root, &proof, 0);
        assert!(!result);
    }
}
