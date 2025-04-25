// src/state_transition.rs
//! State transition logic for the Layer-2 on Solana
//! 
//! This module handles the state transition logic for the Layer-2 chain,
//! including transaction execution and state root calculation.

use crate::merkle_tree::MerkleTree;
use solana_program::instruction::Instruction;
use solana_program::message::Message;
use solana_program::pubkey::Pubkey;
use solana_program::hash::Hash;
use solana_sdk::transaction::Transaction;
use thiserror::Error;
use std::collections::HashMap;

/// Errors that can occur during state transition
#[derive(Debug, Error)]
pub enum StateTransitionError {
    /// Error in transaction execution
    #[error("Transaction execution error: {0}")]
    TransactionExecutionError(String),
    
    /// Error in state root calculation
    #[error("State root calculation error: {0}")]
    StateRootCalculationError(String),
    
    /// Invalid transaction format
    #[error("Invalid transaction format: {0}")]
    InvalidTransactionFormat(String),
    
    /// Invalid state format
    #[error("Invalid state format: {0}")]
    InvalidStateFormat(String),
    
    /// Generic error
    #[error("Generic error: {0}")]
    GenericError(String),
}

/// Represents a state transition in the Layer-2 chain
pub struct StateTransition {
    /// The pre-state root (before transaction execution)
    pub pre_state_root: [u8; 32],
    
    /// The post-state root (after transaction execution)
    pub post_state_root: [u8; 32],
    
    /// The transaction that caused the state transition
    pub transaction: Transaction,
    
    /// The block number of the state transition
    pub block_number: u64,
    
    /// The timestamp of the state transition
    pub timestamp: u64,
    
    /// Additional metadata for the state transition
    pub metadata: HashMap<String, Vec<u8>>,
}

impl StateTransition {
    /// Create a new state transition
    pub fn new(
        pre_state_root: [u8; 32],
        transaction: Transaction,
        block_number: u64,
        timestamp: u64,
    ) -> Self {
        Self {
            pre_state_root,
            post_state_root: [0; 32], // Will be calculated during execution
            transaction,
            block_number,
            timestamp,
            metadata: HashMap::new(),
        }
    }
    
    /// Execute the state transition and calculate the post-state root
    pub fn execute(&mut self, state: &mut impl State) -> Result<[u8; 32], StateTransitionError> {
        // Apply the transaction to the state
        state.apply_transaction(&self.transaction)
            .map_err(|e| StateTransitionError::TransactionExecutionError(e.to_string()))?;
        
        // Calculate the new state root
        let post_state_root = state.calculate_state_root()
            .map_err(|e| StateTransitionError::StateRootCalculationError(e.to_string()))?;
        
        self.post_state_root = post_state_root;
        
        Ok(post_state_root)
    }
    
    /// Verify that the state transition is valid
    pub fn verify(&self, state: &mut impl State) -> Result<bool, StateTransitionError> {
        // Save the current state root
        let original_state_root = state.calculate_state_root()
            .map_err(|e| StateTransitionError::StateRootCalculationError(e.to_string()))?;
        
        // Set the state to the pre-state
        state.set_state_root(self.pre_state_root)
            .map_err(|e| StateTransitionError::InvalidStateFormat(e.to_string()))?;
        
        // Apply the transaction
        state.apply_transaction(&self.transaction)
            .map_err(|e| StateTransitionError::TransactionExecutionError(e.to_string()))?;
        
        // Calculate the new state root
        let calculated_post_state_root = state.calculate_state_root()
            .map_err(|e| StateTransitionError::StateRootCalculationError(e.to_string()))?;
        
        // Restore the original state
        state.set_state_root(original_state_root)
            .map_err(|e| StateTransitionError::InvalidStateFormat(e.to_string()))?;
        
        // Compare the calculated post-state root with the expected one
        Ok(calculated_post_state_root == self.post_state_root)
    }
    
    /// Get the transaction hash
    pub fn transaction_hash(&self) -> [u8; 32] {
        let mut hash = [0; 32];
        let tx_hash = self.transaction.message.hash();
        hash.copy_from_slice(tx_hash.as_ref());
        hash
    }
}

/// Trait for state implementations
pub trait State {
    /// Apply a transaction to the state
    fn apply_transaction(&mut self, transaction: &Transaction) -> Result<(), anyhow::Error>;
    
    /// Calculate the state root
    fn calculate_state_root(&self) -> Result<[u8; 32], anyhow::Error>;
    
    /// Set the state root (used for verification)
    fn set_state_root(&mut self, state_root: [u8; 32]) -> Result<(), anyhow::Error>;
    
    /// Get the state root
    fn get_state_root(&self) -> Result<[u8; 32], anyhow::Error>;
    
    /// Get a proof for a specific account
    fn get_proof(&self, account: &Pubkey) -> Result<Vec<[u8; 32]>, anyhow::Error>;
    
    /// Verify a proof for a specific account
    fn verify_proof(&self, account: &Pubkey, proof: &[[u8; 32]]) -> Result<bool, anyhow::Error>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_sdk::signature::{Keypair, Signer};
    use solana_sdk::system_instruction;
    
    // Mock implementation of State for testing
    struct MockState {
        state_root: [u8; 32],
        accounts: HashMap<Pubkey, Vec<u8>>,
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
        
        fn get_proof(&self, account: &Pubkey) -> Result<Vec<[u8; 32]>, anyhow::Error> {
            // Mock implementation - return empty proof
            Ok(vec![])
        }
        
        fn verify_proof(&self, account: &Pubkey, proof: &[[u8; 32]]) -> Result<bool, anyhow::Error> {
            // Mock implementation - always return true
            Ok(true)
        }
    }
    
    #[test]
    fn test_state_transition_execution() {
        // Create a mock state
        let mut state = MockState::new();
        
        // Create a keypair for testing
        let from_keypair = Keypair::new();
        let to_pubkey = Pubkey::new_unique();
        
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
        
        // Create a state transition
        let mut state_transition = StateTransition::new(
            [0; 32],
            transaction,
            1,
            1000,
        );
        
        // Execute the state transition
        let result = state_transition.execute(&mut state);
        assert!(result.is_ok());
        
        // Verify the state transition
        let verification_result = state_transition.verify(&mut state);
        assert!(verification_result.is_ok());
        assert!(verification_result.unwrap());
    }
}
