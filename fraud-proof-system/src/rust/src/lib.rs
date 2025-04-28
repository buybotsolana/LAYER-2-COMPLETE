// src/lib.rs
//! Fraud Proof System for Layer-2 on Solana
//! 
//! This library implements a fraud proof system for a Layer-2 solution on Solana,
//! allowing for the generation and verification of proofs that demonstrate invalid
//! state transitions in the Layer-2 chain.

mod merkle_tree;
mod state_transition;
mod fraud_proof;
mod solana_runtime_wrapper;
mod bisection;
mod verification;

pub use merkle_tree::MerkleTree;
pub use state_transition::{StateTransition, StateTransitionError};
pub use fraud_proof::{FraudProof, FraudProofType, FraudProofError};
pub use solana_runtime_wrapper::{SolanaRuntimeWrapper, ExecutionResult};
pub use bisection::{BisectionGame, BisectionStep};
pub use verification::{verify_fraud_proof, ProofVerificationResult};

/// Error types for the fraud proof system
#[derive(Debug, thiserror::Error)]
pub enum FraudProofSystemError {
    /// Error in state transition
    #[error("State transition error: {0}")]
    StateTransitionError(#[from] state_transition::StateTransitionError),
    
    /// Error in fraud proof generation
    #[error("Fraud proof error: {0}")]
    FraudProofError(#[from] fraud_proof::FraudProofError),
    
    /// Error in Solana runtime execution
    #[error("Solana runtime error: {0}")]
    SolanaRuntimeError(String),
    
    /// Error in Merkle tree operations
    #[error("Merkle tree error: {0}")]
    MerkleTreeError(String),
    
    /// Error in bisection game
    #[error("Bisection game error: {0}")]
    BisectionError(String),
    
    /// Error in proof verification
    #[error("Proof verification error: {0}")]
    VerificationError(String),
    
    /// Generic error
    #[error("Generic error: {0}")]
    GenericError(String),
}

/// Result type for the fraud proof system
pub type FraudProofSystemResult<T> = Result<T, FraudProofSystemError>;

/// Main entry point for the fraud proof system
pub struct FraudProofSystem {
    runtime: solana_runtime_wrapper::SolanaRuntimeWrapper,
}

impl FraudProofSystem {
    /// Create a new fraud proof system
    pub fn new() -> Self {
        Self {
            runtime: solana_runtime_wrapper::SolanaRuntimeWrapper::new(),
        }
    }
    
    /// Generate a fraud proof for an invalid state transition
    pub fn generate_fraud_proof(
        &self,
        pre_state_root: [u8; 32],
        post_state_root: [u8; 32],
        expected_post_state_root: [u8; 32],
        transaction_data: &[u8],
        proof_type: fraud_proof::FraudProofType,
    ) -> FraudProofSystemResult<fraud_proof::FraudProof> {
        // Implementation will be added
        todo!("Implement fraud proof generation")
    }
    
    /// Verify a fraud proof
    pub fn verify_fraud_proof(
        &self,
        proof: &fraud_proof::FraudProof,
    ) -> FraudProofSystemResult<bool> {
        // Implementation will be added
        todo!("Implement fraud proof verification")
    }
    
    /// Start a bisection game for an invalid state transition
    pub fn start_bisection_game(
        &self,
        pre_state_root: [u8; 32],
        post_state_root: [u8; 32],
        expected_post_state_root: [u8; 32],
        transaction_data: &[u8],
    ) -> FraudProofSystemResult<bisection::BisectionGame> {
        // Implementation will be added
        todo!("Implement bisection game")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_fraud_proof_system_creation() {
        let fps = FraudProofSystem::new();
        // Basic test to ensure the system can be created
    }
}
