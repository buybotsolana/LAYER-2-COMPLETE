// src/fraud_proof.rs
//! Fraud proof generation and representation for the Layer-2 on Solana
//! 
//! This module handles the generation and representation of fraud proofs,
//! which demonstrate invalid state transitions in the Layer-2 chain.

use crate::merkle_tree::MerkleTree;
use crate::state_transition::{StateTransition, StateTransitionError};
use solana_sdk::transaction::Transaction;
use thiserror::Error;
use std::collections::HashMap;

/// Types of fraud proofs
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FraudProofType {
    /// Fraud in transaction execution
    ExecutionFraud,
    
    /// Fraud in state transition
    StateTransitionFraud,
    
    /// Fraud in data availability
    DataAvailabilityFraud,
    
    /// Fraud in L2 block derivation from L1 data
    DerivationFraud,
}

/// Errors that can occur during fraud proof operations
#[derive(Debug, Error)]
pub enum FraudProofError {
    /// Error in state transition
    #[error("State transition error: {0}")]
    StateTransitionError(#[from] StateTransitionError),
    
    /// Invalid proof format
    #[error("Invalid proof format: {0}")]
    InvalidProofFormat(String),
    
    /// Missing data for proof generation
    #[error("Missing data for proof generation: {0}")]
    MissingData(String),
    
    /// Generic error
    #[error("Generic error: {0}")]
    GenericError(String),
}

/// Represents a fraud proof in the Layer-2 chain
#[derive(Debug, Clone)]
pub struct FraudProof {
    /// The type of fraud proof
    pub proof_type: FraudProofType,
    
    /// The pre-state root (before transaction execution)
    pub pre_state_root: [u8; 32],
    
    /// The post-state root (after transaction execution)
    pub post_state_root: [u8; 32],
    
    /// The expected post-state root
    pub expected_post_state_root: [u8; 32],
    
    /// The transaction that caused the invalid state transition
    pub transaction_data: Vec<u8>,
    
    /// The block number of the fraud
    pub block_number: u64,
    
    /// The timestamp of the fraud proof generation
    pub timestamp: u64,
    
    /// The execution trace that demonstrates the fraud
    pub execution_trace: Vec<u8>,
    
    /// Merkle proof for the transaction inclusion
    pub transaction_proof: Vec<[u8; 32]>,
    
    /// Merkle proof for the pre-state
    pub pre_state_proof: Vec<[u8; 32]>,
    
    /// Merkle proof for the post-state
    pub post_state_proof: Vec<[u8; 32]>,
    
    /// Additional metadata for the fraud proof
    pub metadata: HashMap<String, Vec<u8>>,
}

impl FraudProof {
    /// Create a new fraud proof
    pub fn new(
        proof_type: FraudProofType,
        pre_state_root: [u8; 32],
        post_state_root: [u8; 32],
        expected_post_state_root: [u8; 32],
        transaction_data: Vec<u8>,
        block_number: u64,
        timestamp: u64,
    ) -> Self {
        Self {
            proof_type,
            pre_state_root,
            post_state_root,
            expected_post_state_root,
            transaction_data,
            block_number,
            timestamp,
            execution_trace: Vec::new(),
            transaction_proof: Vec::new(),
            pre_state_proof: Vec::new(),
            post_state_proof: Vec::new(),
            metadata: HashMap::new(),
        }
    }
    
    /// Set the execution trace
    pub fn with_execution_trace(mut self, execution_trace: Vec<u8>) -> Self {
        self.execution_trace = execution_trace;
        self
    }
    
    /// Set the transaction proof
    pub fn with_transaction_proof(mut self, transaction_proof: Vec<[u8; 32]>) -> Self {
        self.transaction_proof = transaction_proof;
        self
    }
    
    /// Set the pre-state proof
    pub fn with_pre_state_proof(mut self, pre_state_proof: Vec<[u8; 32]>) -> Self {
        self.pre_state_proof = pre_state_proof;
        self
    }
    
    /// Set the post-state proof
    pub fn with_post_state_proof(mut self, post_state_proof: Vec<[u8; 32]>) -> Self {
        self.post_state_proof = post_state_proof;
        self
    }
    
    /// Add metadata to the fraud proof
    pub fn add_metadata(&mut self, key: &str, value: Vec<u8>) {
        self.metadata.insert(key.to_string(), value);
    }
    
    /// Serialize the fraud proof to bytes
    pub fn serialize(&self) -> Result<Vec<u8>, FraudProofError> {
        bincode::serialize(self)
            .map_err(|e| FraudProofError::InvalidProofFormat(e.to_string()))
    }
    
    /// Deserialize bytes to a fraud proof
    pub fn deserialize(data: &[u8]) -> Result<Self, FraudProofError> {
        bincode::deserialize(data)
            .map_err(|e| FraudProofError::InvalidProofFormat(e.to_string()))
    }
    
    /// Get the hash of the fraud proof
    pub fn hash(&self) -> [u8; 32] {
        use sha2::{Sha256, Digest};
        
        let mut hasher = Sha256::new();
        
        // Hash the core components
        hasher.update(&[self.proof_type as u8]);
        hasher.update(&self.pre_state_root);
        hasher.update(&self.post_state_root);
        hasher.update(&self.expected_post_state_root);
        hasher.update(&self.transaction_data);
        hasher.update(&self.block_number.to_le_bytes());
        hasher.update(&self.timestamp.to_le_bytes());
        
        let result = hasher.finalize();
        
        let mut output = [0u8; 32];
        output.copy_from_slice(&result);
        output
    }
}

/// Generate a fraud proof for an invalid state transition
pub fn generate_fraud_proof(
    state_transition: &StateTransition,
    expected_post_state_root: [u8; 32],
    proof_type: FraudProofType,
    execution_trace: Vec<u8>,
) -> Result<FraudProof, FraudProofError> {
    // Ensure the state transition is invalid
    if state_transition.post_state_root == expected_post_state_root {
        return Err(FraudProofError::GenericError(
            "State transition is valid, cannot generate fraud proof".to_string()
        ));
    }
    
    // Serialize the transaction
    let transaction_data = bincode::serialize(&state_transition.transaction)
        .map_err(|e| FraudProofError::GenericError(e.to_string()))?;
    
    // Create the fraud proof
    let mut fraud_proof = FraudProof::new(
        proof_type,
        state_transition.pre_state_root,
        state_transition.post_state_root,
        expected_post_state_root,
        transaction_data,
        state_transition.block_number,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    );
    
    // Add the execution trace
    fraud_proof = fraud_proof.with_execution_trace(execution_trace);
    
    // Add metadata
    fraud_proof.add_metadata("transaction_hash", state_transition.transaction_hash().to_vec());
    
    Ok(fraud_proof)
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_sdk::signature::{Keypair, Signer};
    use solana_sdk::system_instruction;
    use solana_program::message::Message;
    use solana_program::hash::Hash;
    
    #[test]
    fn test_fraud_proof_creation() {
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
        
        // Create a state transition
        let state_transition = StateTransition::new(
            [0; 32],
            transaction,
            1,
            1000,
        );
        
        // Generate a fraud proof
        let execution_trace = vec![1, 2, 3, 4]; // Mock execution trace
        let fraud_proof = generate_fraud_proof(
            &state_transition,
            [1; 32], // Different from state_transition.post_state_root
            FraudProofType::ExecutionFraud,
            execution_trace.clone(),
        );
        
        assert!(fraud_proof.is_ok());
        let fraud_proof = fraud_proof.unwrap();
        
        // Verify the fraud proof properties
        assert_eq!(fraud_proof.proof_type, FraudProofType::ExecutionFraud);
        assert_eq!(fraud_proof.pre_state_root, [0; 32]);
        assert_eq!(fraud_proof.expected_post_state_root, [1; 32]);
        assert_eq!(fraud_proof.execution_trace, execution_trace);
    }
    
    #[test]
    fn test_fraud_proof_serialization() {
        // Create a simple fraud proof
        let fraud_proof = FraudProof::new(
            FraudProofType::ExecutionFraud,
            [0; 32],
            [1; 32],
            [2; 32],
            vec![1, 2, 3, 4],
            1,
            1000,
        );
        
        // Serialize the fraud proof
        let serialized = fraud_proof.serialize();
        assert!(serialized.is_ok());
        
        // Deserialize the fraud proof
        let deserialized = FraudProof::deserialize(&serialized.unwrap());
        assert!(deserialized.is_ok());
        
        // Verify the deserialized fraud proof
        let deserialized = deserialized.unwrap();
        assert_eq!(deserialized.proof_type, FraudProofType::ExecutionFraud);
        assert_eq!(deserialized.pre_state_root, [0; 32]);
        assert_eq!(deserialized.post_state_root, [1; 32]);
        assert_eq!(deserialized.expected_post_state_root, [2; 32]);
        assert_eq!(deserialized.transaction_data, vec![1, 2, 3, 4]);
        assert_eq!(deserialized.block_number, 1);
        assert_eq!(deserialized.timestamp, 1000);
    }
}
