// src/interfaces/bridge_interface.rs
//! Standard interfaces for Bridge components
//! 
//! This module defines standard interfaces for the Bridge
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

/// Standard interface for deposit handling
pub trait DepositHandler {
    /// Error type for deposit operations
    type Error: ComponentError;
    
    /// Deposit information type
    type Deposit: Serializable;
    
    /// Process a deposit from L1
    fn process_deposit(
        &mut self,
        l1_tx_hash: [u8; 32],
        l1_block_number: u64,
        l1_sender: [u8; 20],
        l2_recipient: [u8; 32],
        token: [u8; 20],
        amount: u64,
    ) -> Result<[u8; 32], Self::Error>;
    
    /// Confirm a deposit
    fn confirm_deposit(
        &mut self,
        id: [u8; 32],
    ) -> Result<(), Self::Error>;
    
    /// Finalize a deposit
    fn finalize_deposit(
        &mut self,
        id: [u8; 32],
        l2_tx_hash: [u8; 32],
    ) -> Result<(), Self::Error>;
    
    /// Reject a deposit
    fn reject_deposit(
        &mut self,
        id: [u8; 32],
        reason: &str,
    ) -> Result<(), Self::Error>;
    
    /// Get a deposit
    fn get_deposit(
        &self,
        id: [u8; 32],
    ) -> Result<Option<Self::Deposit>, Self::Error>;
    
    /// Add a supported token
    fn add_supported_token(
        &mut self,
        token: [u8; 20],
        min_amount: u64,
        max_amount: u64,
    ) -> Result<(), Self::Error>;
    
    /// Remove a supported token
    fn remove_supported_token(
        &mut self,
        token: [u8; 20],
    ) -> Result<(), Self::Error>;
}

/// Standard interface for withdrawal handling
pub trait WithdrawalHandler {
    /// Error type for withdrawal operations
    type Error: ComponentError;
    
    /// Withdrawal information type
    type Withdrawal: Serializable;
    
    /// Withdrawal proof type
    type WithdrawalProof: Serializable;
    
    /// Initiate a withdrawal from L2 to L1
    fn initiate_withdrawal(
        &mut self,
        l2_tx_hash: [u8; 32],
        l2_block_number: u64,
        l2_sender: [u8; 32],
        l1_recipient: [u8; 20],
        token: [u8; 20],
        amount: u64,
    ) -> Result<[u8; 32], Self::Error>;
    
    /// Prove a withdrawal
    fn prove_withdrawal(
        &mut self,
        id: [u8; 32],
        merkle_proof: Vec<[u8; 32]>,
        merkle_root: [u8; 32],
        leaf_index: u64,
        block_number: u64,
    ) -> Result<(), Self::Error>;
    
    /// Finalize a withdrawal
    fn finalize_withdrawal(
        &mut self,
        id: [u8; 32],
        l1_tx_hash: [u8; 32],
    ) -> Result<(), Self::Error>;
    
    /// Reject a withdrawal
    fn reject_withdrawal(
        &mut self,
        id: [u8; 32],
        reason: &str,
    ) -> Result<(), Self::Error>;
    
    /// Get a withdrawal
    fn get_withdrawal(
        &self,
        id: [u8; 32],
    ) -> Result<Option<Self::Withdrawal>, Self::Error>;
    
    /// Verify a withdrawal proof
    fn verify_withdrawal_proof(
        &self,
        id: [u8; 32],
    ) -> Result<bool, Self::Error>;
    
    /// Add a supported token
    fn add_supported_token(
        &mut self,
        token: [u8; 20],
        min_amount: u64,
        max_amount: u64,
    ) -> Result<(), Self::Error>;
    
    /// Remove a supported token
    fn remove_supported_token(
        &mut self,
        token: [u8; 20],
    ) -> Result<(), Self::Error>;
}

/// Standard interface for token mapping
pub trait TokenMapper {
    /// Error type for token mapping operations
    type Error: ComponentError;
    
    /// Map an L1 token to an L2 token
    fn map_l1_to_l2_token(
        &mut self,
        l1_token: [u8; 20],
        l2_token: Pubkey,
    ) -> Result<(), Self::Error>;
    
    /// Map an L2 token to an L1 token
    fn map_l2_to_l1_token(
        &mut self,
        l2_token: Pubkey,
        l1_token: [u8; 20],
    ) -> Result<(), Self::Error>;
    
    /// Get the L2 token for an L1 token
    fn get_l2_token(
        &self,
        l1_token: [u8; 20],
    ) -> Result<Option<Pubkey>, Self::Error>;
    
    /// Get the L1 token for an L2 token
    fn get_l1_token(
        &self,
        l2_token: Pubkey,
    ) -> Result<Option<[u8; 20]>, Self::Error>;
    
    /// Remove an L1 token mapping
    fn remove_l1_token_mapping(
        &mut self,
        l1_token: [u8; 20],
    ) -> Result<(), Self::Error>;
    
    /// Remove an L2 token mapping
    fn remove_l2_token_mapping(
        &mut self,
        l2_token: Pubkey,
    ) -> Result<(), Self::Error>;
}

/// Standard interface for message passing
pub trait MessagePasser {
    /// Error type for message passing operations
    type Error: ComponentError;
    
    /// Message type
    type Message: Serializable;
    
    /// Send a message from L2 to L1
    fn send_message_to_l1(
        &mut self,
        sender: Pubkey,
        recipient: [u8; 20],
        data: Vec<u8>,
    ) -> Result<[u8; 32], Self::Error>;
    
    /// Process a message from L1 to L2
    fn process_message_from_l1(
        &mut self,
        l1_tx_hash: [u8; 32],
        sender: [u8; 20],
        recipient: Pubkey,
        data: Vec<u8>,
    ) -> Result<[u8; 32], Self::Error>;
    
    /// Get a message
    fn get_message(
        &self,
        id: [u8; 32],
    ) -> Result<Option<Self::Message>, Self::Error>;
    
    /// Verify a message
    fn verify_message(
        &self,
        id: [u8; 32],
        proof: Vec<[u8; 32]>,
    ) -> Result<bool, Self::Error>;
}

/// Complete Bridge interface
pub trait Bridge: 
    Component + 
    DepositHandler + 
    WithdrawalHandler + 
    TokenMapper + 
    MessagePasser 
{
    /// Get the L1 bridge address
    fn get_l1_bridge_address(&self) -> [u8; 20];
    
    /// Set the L1 bridge address
    fn set_l1_bridge_address(&mut self, address: [u8; 20]) -> Result<(), Self::Error>;
    
    /// Get the L1 withdrawal bridge address
    fn get_l1_withdrawal_bridge_address(&self) -> [u8; 20];
    
    /// Set the L1 withdrawal bridge address
    fn set_l1_withdrawal_bridge_address(&mut self, address: [u8; 20]) -> Result<(), Self::Error>;
    
    /// Get the challenge period in seconds
    fn get_challenge_period(&self) -> u64;
    
    /// Set the challenge period in seconds
    fn set_challenge_period(&mut self, challenge_period: u64) -> Result<(), Self::Error>;
}
