// src/fraud_proof_system/state_transition.rs
//! State Transition implementation for the Fraud Proof System
//! 
//! This module provides the implementation of state transitions for the Layer-2 system,
//! including state transition validation and error handling.

use solana_program::keccak;
use borsh::{BorshDeserialize, BorshSerialize};
use std::fmt;

/// State representation for the Layer-2 system
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct State {
    /// State root
    pub root: [u8; 32],
    
    /// Block number
    pub block_number: u64,
    
    /// Timestamp
    pub timestamp: u64,
    
    /// Account states (key-value pairs)
    pub accounts: Vec<(Vec<u8>, Vec<u8>)>,
}

impl State {
    /// Create a new state
    pub fn new(root: [u8; 32], block_number: u64, timestamp: u64) -> Self {
        Self {
            root,
            block_number,
            timestamp,
            accounts: Vec::new(),
        }
    }
    
    /// Add an account to the state
    pub fn add_account(&mut self, key: Vec<u8>, value: Vec<u8>) {
        self.accounts.push((key, value));
    }
    
    /// Get an account from the state
    pub fn get_account(&self, key: &[u8]) -> Option<&Vec<u8>> {
        self.accounts.iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v)
    }
    
    /// Update an account in the state
    pub fn update_account(&mut self, key: Vec<u8>, value: Vec<u8>) -> bool {
        for (k, v) in &mut self.accounts {
            if k == &key {
                *v = value;
                return true;
            }
        }
        false
    }
    
    /// Remove an account from the state
    pub fn remove_account(&mut self, key: &[u8]) -> bool {
        let len = self.accounts.len();
        self.accounts.retain(|(k, _)| k != key);
        self.accounts.len() < len
    }
    
    /// Calculate the state root
    pub fn calculate_root(&self) -> [u8; 32] {
        // Sort accounts by key for deterministic root calculation
        let mut sorted_accounts = self.accounts.clone();
        sorted_accounts.sort_by(|(k1, _), (k2, _)| k1.cmp(k2));
        
        // Concatenate all account data
        let mut data = Vec::new();
        for (key, value) in &sorted_accounts {
            data.extend_from_slice(key);
            data.extend_from_slice(value);
        }
        
        // Add block number and timestamp
        data.extend_from_slice(&self.block_number.to_le_bytes());
        data.extend_from_slice(&self.timestamp.to_le_bytes());
        
        // Hash the data
        keccak::hash(&data).to_bytes()
    }
}

/// Errors that can occur during state transitions
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StateTransitionError {
    /// Invalid transaction format
    InvalidTransactionFormat,
    
    /// Invalid signature
    InvalidSignature,
    
    /// Insufficient balance
    InsufficientBalance,
    
    /// Nonce mismatch
    NonceMismatch,
    
    /// Invalid state access
    InvalidStateAccess,
    
    /// Execution error
    ExecutionError(String),
    
    /// Generic error
    GenericError(String),
}

impl fmt::Display for StateTransitionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StateTransitionError::InvalidTransactionFormat => write!(f, "Invalid transaction format"),
            StateTransitionError::InvalidSignature => write!(f, "Invalid signature"),
            StateTransitionError::InsufficientBalance => write!(f, "Insufficient balance"),
            StateTransitionError::NonceMismatch => write!(f, "Nonce mismatch"),
            StateTransitionError::InvalidStateAccess => write!(f, "Invalid state access"),
            StateTransitionError::ExecutionError(e) => write!(f, "Execution error: {}", e),
            StateTransitionError::GenericError(e) => write!(f, "Generic error: {}", e),
        }
    }
}

/// State transition for the Layer-2 system
#[derive(Debug, Clone)]
pub struct StateTransition {
    /// Pre-state root
    pub pre_state_root: [u8; 32],
    
    /// Transaction data
    pub transaction_data: Vec<u8>,
    
    /// Block number
    pub block_number: u64,
    
    /// Timestamp
    pub timestamp: u64,
    
    /// Transaction
    pub transaction: Transaction,
}

/// Transaction for the Layer-2 system
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct Transaction {
    /// Sender address
    pub sender: [u8; 32],
    
    /// Recipient address
    pub recipient: [u8; 32],
    
    /// Amount
    pub amount: u64,
    
    /// Nonce
    pub nonce: u64,
    
    /// Data
    pub data: Vec<u8>,
    
    /// Signature
    pub signature: [u8; 64],
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
            transaction_data: bincode::serialize(&transaction).unwrap_or_default(),
            block_number,
            timestamp,
            transaction,
        }
    }
    
    /// Calculate the post-state root
    pub fn calculate_post_state_root(&self) -> Result<[u8; 32], StateTransitionError> {
        // In a real implementation, we would:
        // 1. Load the pre-state
        // 2. Apply the transaction to the pre-state
        // 3. Calculate the post-state root
        
        // For this implementation, we'll simulate the process
        
        // Verify the transaction signature
        if !self.verify_signature() {
            return Err(StateTransitionError::InvalidSignature);
        }
        
        // Create a new state based on the pre-state root
        let mut state = State::new(
            self.pre_state_root,
            self.block_number,
            self.timestamp,
        );
        
        // Apply the transaction to the state
        self.apply_transaction_to_state(&mut state)?;
        
        // Calculate the post-state root
        Ok(state.calculate_root())
    }
    
    /// Verify the transaction signature
    fn verify_signature(&self) -> bool {
        // In a real implementation, we would verify the signature
        // For now, we'll assume all signatures are valid
        true
    }
    
    /// Apply the transaction to the state
    fn apply_transaction_to_state(&self, state: &mut State) -> Result<(), StateTransitionError> {
        // In a real implementation, we would:
        // 1. Check the sender's balance
        // 2. Check the nonce
        // 3. Update the sender's balance
        // 4. Update the recipient's balance
        // 5. Update the sender's nonce
        
        // For this implementation, we'll simulate the process
        
        // Get the sender's account
        let sender_key = self.transaction.sender.to_vec();
        let sender_balance = match state.get_account(&sender_key) {
            Some(account) => {
                // Parse the balance from the account data
                let balance_bytes = &account[0..8];
                let mut balance_array = [0u8; 8];
                balance_array.copy_from_slice(balance_bytes);
                u64::from_le_bytes(balance_array)
            },
            None => {
                // Create a new account with a balance of 1000
                let mut account_data = Vec::new();
                account_data.extend_from_slice(&1000u64.to_le_bytes());
                account_data.extend_from_slice(&0u64.to_le_bytes()); // nonce
                state.add_account(sender_key.clone(), account_data);
                1000
            },
        };
        
        // Check the sender's balance
        if sender_balance < self.transaction.amount {
            return Err(StateTransitionError::InsufficientBalance);
        }
        
        // Get the sender's nonce
        let sender_nonce = match state.get_account(&sender_key) {
            Some(account) => {
                // Parse the nonce from the account data
                let nonce_bytes = &account[8..16];
                let mut nonce_array = [0u8; 8];
                nonce_array.copy_from_slice(nonce_bytes);
                u64::from_le_bytes(nonce_array)
            },
            None => 0,
        };
        
        // Check the nonce
        if sender_nonce != self.transaction.nonce {
            return Err(StateTransitionError::NonceMismatch);
        }
        
        // Update the sender's balance and nonce
        let new_sender_balance = sender_balance - self.transaction.amount;
        let new_sender_nonce = sender_nonce + 1;
        let mut new_sender_account = Vec::new();
        new_sender_account.extend_from_slice(&new_sender_balance.to_le_bytes());
        new_sender_account.extend_from_slice(&new_sender_nonce.to_le_bytes());
        state.update_account(sender_key, new_sender_account);
        
        // Get the recipient's account
        let recipient_key = self.transaction.recipient.to_vec();
        let recipient_balance = match state.get_account(&recipient_key) {
            Some(account) => {
                // Parse the balance from the account data
                let balance_bytes = &account[0..8];
                let mut balance_array = [0u8; 8];
                balance_array.copy_from_slice(balance_bytes);
                u64::from_le_bytes(balance_array)
            },
            None => {
                // Create a new account with a balance of 0
                let mut account_data = Vec::new();
                account_data.extend_from_slice(&0u64.to_le_bytes());
                account_data.extend_from_slice(&0u64.to_le_bytes()); // nonce
                state.add_account(recipient_key.clone(), account_data);
                0
            },
        };
        
        // Update the recipient's balance
        let new_recipient_balance = recipient_balance + self.transaction.amount;
        let recipient_nonce = match state.get_account(&recipient_key) {
            Some(account) => {
                // Parse the nonce from the account data
                let nonce_bytes = &account[8..16];
                let mut nonce_array = [0u8; 8];
                nonce_array.copy_from_slice(nonce_bytes);
                u64::from_le_bytes(nonce_array)
            },
            None => 0,
        };
        let mut new_recipient_account = Vec::new();
        new_recipient_account.extend_from_slice(&new_recipient_balance.to_le_bytes());
        new_recipient_account.extend_from_slice(&recipient_nonce.to_le_bytes());
        state.update_account(recipient_key, new_recipient_account);
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_state_transition() {
        // Create a transaction
        let transaction = Transaction {
            sender: [1; 32],
            recipient: [2; 32],
            amount: 100,
            nonce: 0,
            data: Vec::new(),
            signature: [0; 64],
        };
        
        // Create a state transition
        let state_transition = StateTransition::new(
            [0; 32],
            transaction,
            1,
            1000,
        );
        
        // Calculate the post-state root
        let post_state_root = state_transition.calculate_post_state_root().unwrap();
        
        // Verify the post-state root is not zero
        assert_ne!(post_state_root, [0; 32]);
    }
    
    #[test]
    fn test_insufficient_balance() {
        // Create a transaction with an amount larger than the sender's balance
        let transaction = Transaction {
            sender: [1; 32],
            recipient: [2; 32],
            amount: 2000, // Sender's balance is 1000
            nonce: 0,
            data: Vec::new(),
            signature: [0; 64],
        };
        
        // Create a state transition
        let state_transition = StateTransition::new(
            [0; 32],
            transaction,
            1,
            1000,
        );
        
        // Calculate the post-state root
        let result = state_transition.calculate_post_state_root();
        
        // Verify the result is an error
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StateTransitionError::InsufficientBalance);
    }
    
    #[test]
    fn test_nonce_mismatch() {
        // Create a transaction with an incorrect nonce
        let transaction = Transaction {
            sender: [1; 32],
            recipient: [2; 32],
            amount: 100,
            nonce: 1, // Sender's nonce is 0
            data: Vec::new(),
            signature: [0; 64],
        };
        
        // Create a state transition
        let state_transition = StateTransition::new(
            [0; 32],
            transaction,
            1,
            1000,
        );
        
        // Calculate the post-state root
        let result = state_transition.calculate_post_state_root();
        
        // Verify the result is an error
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StateTransitionError::NonceMismatch);
    }
}
