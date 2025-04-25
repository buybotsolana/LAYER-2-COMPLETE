// src/interfaces/fraud_proof_interface.rs
//! Standard interfaces for Fraud Proof System components
//! 
//! This module defines standard interfaces for the Fraud Proof System
//! components to ensure consistency and interoperability.

use crate::interfaces::component_interface::{
    Component, ComponentError, Initializable, Serializable,
    StateManagement, AccountManagement, InstructionProcessor
};
use solana_program::{
    account_info::AccountInfo,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};

/// Standard interface for fraud proof generation
pub trait FraudProofGenerator {
    /// Error type for fraud proof generation operations
    type Error: ComponentError;
    
    /// Fraud proof type
    type FraudProof: Serializable;
    
    /// Transaction type
    type Transaction: BorshDeserialize + BorshSerialize;
    
    /// Generate a fraud proof for an invalid state transition
    fn generate_fraud_proof(
        &self,
        pre_state_root: [u8; 32],
        post_state_root: [u8; 32],
        expected_post_state_root: [u8; 32],
        transaction_data: &[u8],
        proof_type: u8,
    ) -> Result<Self::FraudProof, Self::Error>;
    
    /// Verify a fraud proof
    fn verify_fraud_proof(
        &self,
        fraud_proof: &Self::FraudProof,
    ) -> Result<bool, Self::Error>;
}

/// Standard interface for bisection games
pub trait BisectionGameManager {
    /// Error type for bisection game operations
    type Error: ComponentError;
    
    /// Bisection game type
    type BisectionGame: Serializable;
    
    /// Transaction type
    type Transaction: BorshDeserialize + BorshSerialize;
    
    /// Start a bisection game
    fn start_bisection_game(
        &self,
        pre_state_root: [u8; 32],
        post_state_root: [u8; 32],
        expected_post_state_root: [u8; 32],
        transaction_data: &[u8],
    ) -> Result<Self::BisectionGame, Self::Error>;
    
    /// Perform a bisection step
    fn bisect(
        &self,
        game: &mut Self::BisectionGame,
        step_index: usize,
    ) -> Result<(), Self::Error>;
    
    /// Resolve a bisection game
    fn resolve_game(
        &self,
        game: &Self::BisectionGame,
    ) -> Result<Self::FraudProof, Self::Error> where Self: FraudProofGenerator;
    
    /// Get the current state of a bisection game
    fn get_game_state(
        &self,
        game: &Self::BisectionGame,
    ) -> Result<u8, Self::Error>;
}

/// Standard interface for Merkle tree operations
pub trait MerkleTreeManager {
    /// Error type for Merkle tree operations
    type Error: ComponentError;
    
    /// Create a new Merkle tree from leaves
    fn create_merkle_tree(
        &self,
        leaves: Vec<[u8; 32]>,
    ) -> Result<[u8; 32], Self::Error>;
    
    /// Generate a Merkle proof for a leaf
    fn generate_proof(
        &self,
        root: [u8; 32],
        leaf: [u8; 32],
        leaf_index: usize,
    ) -> Result<Vec<[u8; 32]>, Self::Error>;
    
    /// Verify a Merkle proof
    fn verify_proof(
        &self,
        root: [u8; 32],
        leaf: [u8; 32],
        proof: &[[u8; 32]],
        leaf_index: usize,
    ) -> Result<bool, Self::Error>;
}

/// Standard interface for state transition verification
pub trait StateTransitionVerifier {
    /// Error type for state transition verification operations
    type Error: ComponentError;
    
    /// Transaction type
    type Transaction: BorshDeserialize + BorshSerialize;
    
    /// Verify a state transition
    fn verify_state_transition(
        &self,
        pre_state_root: [u8; 32],
        post_state_root: [u8; 32],
        transaction: &Self::Transaction,
    ) -> Result<bool, Self::Error>;
    
    /// Calculate the post-state root for a transaction
    fn calculate_post_state_root(
        &self,
        pre_state_root: [u8; 32],
        transaction: &Self::Transaction,
    ) -> Result<[u8; 32], Self::Error>;
}

/// Standard interface for the Solana runtime wrapper
pub trait SolanaRuntimeWrapper {
    /// Error type for Solana runtime operations
    type Error: ComponentError;
    
    /// Transaction type
    type Transaction: BorshDeserialize + BorshSerialize;
    
    /// Execute a transaction in the Solana runtime
    fn execute_transaction(
        &self,
        transaction: &Self::Transaction,
    ) -> Result<(), Self::Error>;
    
    /// Get the state root after transaction execution
    fn get_state_root(&self) -> Result<[u8; 32], Self::Error>;
    
    /// Set the state root before transaction execution
    fn set_state_root(&mut self, state_root: [u8; 32]) -> Result<(), Self::Error>;
}

/// Complete Fraud Proof System interface
pub trait FraudProofSystem: 
    Component + 
    FraudProofGenerator + 
    BisectionGameManager + 
    MerkleTreeManager + 
    StateTransitionVerifier + 
    SolanaRuntimeWrapper 
{
    /// Get the challenge period in seconds
    fn get_challenge_period(&self) -> u64;
    
    /// Set the challenge period in seconds
    fn set_challenge_period(&mut self, challenge_period: u64) -> Result<(), Self::Error>;
    
    /// Get the maximum number of bisection steps
    fn get_max_bisection_steps(&self) -> u32;
    
    /// Set the maximum number of bisection steps
    fn set_max_bisection_steps(&mut self, max_steps: u32) -> Result<(), Self::Error>;
}
