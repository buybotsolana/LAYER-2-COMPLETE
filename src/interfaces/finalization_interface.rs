// src/interfaces/finalization_interface.rs
//! Standard interfaces for Finalization components
//! 
//! This module defines standard interfaces for the Finalization
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

/// Standard interface for block finalization
pub trait BlockFinalizationManager {
    /// Error type for block finalization operations
    type Error: ComponentError;
    
    /// Block type
    type Block: Serializable;
    
    /// Challenge type
    type Challenge: Serializable;
    
    /// Propose a new block
    fn propose_block(
        &mut self,
        block_number: u64,
        block_hash: [u8; 32],
        state_root: [u8; 32],
        proposer: [u8; 32],
    ) -> Result<(), Self::Error>;
    
    /// Finalize a block
    fn finalize_block(
        &mut self,
        block_number: u64,
    ) -> Result<(), Self::Error>;
    
    /// Challenge a block
    fn challenge_block(
        &mut self,
        block_number: u64,
        challenger: [u8; 32],
        reason: String,
        evidence: Vec<u8>,
    ) -> Result<(), Self::Error>;
    
    /// Resolve a challenge
    fn resolve_challenge(
        &mut self,
        block_number: u64,
        challenge_index: usize,
        is_valid: bool,
    ) -> Result<(), Self::Error>;
    
    /// Get a block
    fn get_block(
        &self,
        block_number: u64,
    ) -> Result<Option<Self::Block>, Self::Error>;
    
    /// Get challenges for a block
    fn get_challenges(
        &self,
        block_number: u64,
    ) -> Result<Vec<Self::Challenge>, Self::Error>;
    
    /// Get the latest finalized block number
    fn get_latest_finalized_block_number(&self) -> Result<u64, Self::Error>;
}

/// Standard interface for state commitment
pub trait StateCommitmentManager {
    /// Error type for state commitment operations
    type Error: ComponentError;
    
    /// State root information type
    type StateRoot: Serializable;
    
    /// Propose a new state root
    fn propose_state_root(
        &mut self,
        block_number: u64,
        root: [u8; 32],
        committer: [u8; 32],
    ) -> Result<(), Self::Error>;
    
    /// Commit a state root to L1
    fn commit_state_root(
        &mut self,
        block_number: u64,
        l1_tx_hash: [u8; 32],
    ) -> Result<(), Self::Error>;
    
    /// Get a state root
    fn get_state_root(
        &self,
        block_number: u64,
    ) -> Result<Option<Self::StateRoot>, Self::Error>;
    
    /// Verify a state root
    fn verify_state_root(
        &self,
        block_number: u64,
        root: [u8; 32],
    ) -> Result<bool, Self::Error>;
    
    /// Get the latest committed state root
    fn get_latest_committed_state_root(&self) -> Result<Option<Self::StateRoot>, Self::Error>;
}

/// Standard interface for L2 output oracle
pub trait L2OutputOracleManager {
    /// Error type for L2 output oracle operations
    type Error: ComponentError;
    
    /// L2 output information type
    type L2Output: Serializable;
    
    /// Submit a new L2 output
    fn submit_output(
        &mut self,
        block_number: u64,
        root: [u8; 32],
        submitter: [u8; 32],
    ) -> Result<u64, Self::Error>;
    
    /// Finalize an L2 output
    fn finalize_output(
        &mut self,
        index: u64,
    ) -> Result<(), Self::Error>;
    
    /// Delete an L2 output
    fn delete_output(
        &mut self,
        index: u64,
    ) -> Result<(), Self::Error>;
    
    /// Get an L2 output
    fn get_output(
        &self,
        index: u64,
    ) -> Result<Option<Self::L2Output>, Self::Error>;
    
    /// Verify an L2 output
    fn verify_output(
        &self,
        index: u64,
        root: [u8; 32],
    ) -> Result<bool, Self::Error>;
    
    /// Get the latest output
    fn get_latest_output(&self) -> Result<Option<Self::L2Output>, Self::Error>;
    
    /// Get the latest finalized output
    fn get_latest_finalized_output(&self) -> Result<Option<Self::L2Output>, Self::Error>;
}

/// Complete Finalization Manager interface
pub trait FinalizationManager: 
    Component + 
    BlockFinalizationManager + 
    StateCommitmentManager + 
    L2OutputOracleManager 
{
    /// Get the challenge period in seconds
    fn get_challenge_period(&self) -> u64;
    
    /// Set the challenge period in seconds
    fn set_challenge_period(&mut self, challenge_period: u64) -> Result<(), Self::Error>;
    
    /// Check if a block is finalized
    fn is_block_finalized(&self, block_number: u64) -> Result<bool, Self::Error>;
    
    /// Get the finalization status of a block
    fn get_block_finalization_status(&self, block_number: u64) -> Result<u8, Self::Error>;
}
