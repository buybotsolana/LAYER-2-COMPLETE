// src/bridge/withdrawal_handler.rs
//! Withdrawal Handler implementation for Layer-2 on Solana
//! 
//! This module provides the implementation of the withdrawal handler for the bridge
//! between Ethereum (L1) and Solana Layer-2, allowing users to withdraw assets
//! from L2 to L1 in a secure and trustless manner.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// Withdrawal status
#[derive(Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum WithdrawalStatus {
    /// Withdrawal is pending
    Pending,
    
    /// Withdrawal is confirmed
    Confirmed,
    
    /// Withdrawal is finalized
    Finalized,
    
    /// Withdrawal is rejected
    Rejected,
}

/// Withdrawal information
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct Withdrawal {
    /// Withdrawal ID
    pub id: [u8; 32],
    
    /// L2 transaction hash
    pub l2_tx_hash: [u8; 32],
    
    /// L2 block number
    pub l2_block_number: u64,
    
    /// L2 sender address
    pub l2_sender: [u8; 32],
    
    /// L1 recipient address
    pub l1_recipient: [u8; 20],
    
    /// Token address (zero address for native token)
    pub token: [u8; 20],
    
    /// Amount
    pub amount: u64,
    
    /// Timestamp
    pub timestamp: u64,
    
    /// Status
    pub status: WithdrawalStatus,
    
    /// L1 transaction hash (if finalized)
    pub l1_tx_hash: Option<[u8; 32]>,
}

/// Withdrawal handler for the Layer-2 system
pub struct WithdrawalHandler {
    /// Withdrawals
    pub withdrawals: HashMap<[u8; 32], Withdrawal>,
    
    /// Supported tokens
    pub supported_tokens: Vec<[u8; 20]>,
    
    /// Minimum withdrawal amounts per token
    pub min_withdrawal_amounts: HashMap<[u8; 20], u64>,
    
    /// Maximum withdrawal amounts per token
    pub max_withdrawal_amounts: HashMap<[u8; 20], u64>,
}

impl WithdrawalHandler {
    /// Create a new withdrawal handler
    pub fn new() -> Self {
        let mut handler = Self {
            withdrawals: HashMap::new(),
            supported_tokens: Vec::new(),
            min_withdrawal_amounts: HashMap::new(),
            max_withdrawal_amounts: HashMap::new(),
        };
        
        // Add native token (ETH) as supported
        let eth_address = [0; 20];
        handler.supported_tokens.push(eth_address);
        handler.min_withdrawal_amounts.insert(eth_address, 1_000_000_000_000_000); // 0.001 ETH
        handler.max_withdrawal_amounts.insert(eth_address, 1_000_000_000_000_000_000_000); // 1000 ETH
        
        handler
    }
    
    /// Initialize the withdrawal handler
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        // In a real implementation, we would initialize the withdrawal handler
        // with accounts and other data
        Ok(())
    }
    
    /// Add a supported token
    pub fn add_supported_token(
        &mut self,
        token: [u8; 20],
        min_amount: u64,
        max_amount: u64,
    ) -> Result<(), String> {
        // Check if the token is already supported
        if self.supported_tokens.contains(&token) {
            return Err(format!("Token {:?} is already supported", token));
        }
        
        // Add the token
        self.supported_tokens.push(token);
        self.min_withdrawal_amounts.insert(token, min_amount);
        self.max_withdrawal_amounts.insert(token, max_amount);
        
        Ok(())
    }
    
    /// Remove a supported token
    pub fn remove_supported_token(
        &mut self,
        token: [u8; 20],
    ) -> Result<(), String> {
        // Check if the token is supported
        if !self.supported_tokens.contains(&token) {
            return Err(format!("Token {:?} is not supported", token));
        }
        
        // Remove the token
        self.supported_tokens.retain(|t| t != &token);
        self.min_withdrawal_amounts.remove(&token);
        self.max_withdrawal_amounts.remove(&token);
        
        Ok(())
    }
    
    /// Process a withdrawal from L2
    pub fn process_withdrawal(
        &mut self,
        l2_tx_hash: [u8; 32],
        l2_block_number: u64,
        l2_sender: [u8; 32],
        l1_recipient: [u8; 20],
        token: [u8; 20],
        amount: u64,
    ) -> Result<[u8; 32], String> {
        // Check if the token is supported
        if !self.supported_tokens.contains(&token) {
            return Err(format!("Token {:?} is not supported", token));
        }
        
        // Check if the amount is within limits
        let min_amount = self.min_withdrawal_amounts.get(&token).unwrap_or(&0);
        let max_amount = self.max_withdrawal_amounts.get(&token).unwrap_or(&u64::MAX);
        
        if amount < *min_amount {
            return Err(format!("Amount {} is less than minimum {}", amount, min_amount));
        }
        
        if amount > *max_amount {
            return Err(format!("Amount {} is greater than maximum {}", amount, max_amount));
        }
        
        // Generate a withdrawal ID
        let mut id_data = Vec::new();
        id_data.extend_from_slice(&l2_tx_hash);
        id_data.extend_from_slice(&l2_sender);
        id_data.extend_from_slice(&l1_recipient);
        id_data.extend_from_slice(&token);
        id_data.extend_from_slice(&amount.to_le_bytes());
        
        let id = solana_program::keccak::hash(&id_data).to_bytes();
        
        // Check if the withdrawal already exists
        if self.withdrawals.contains_key(&id) {
            return Err(format!("Withdrawal with ID {:?} already exists", id));
        }
        
        // Get the current timestamp
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        // Create the withdrawal
        let withdrawal = Withdrawal {
            id,
            l2_tx_hash,
            l2_block_number,
            l2_sender,
            l1_recipient,
            token,
            amount,
            timestamp: now,
            status: WithdrawalStatus::Pending,
            l1_tx_hash: None,
        };
        
        // Add the withdrawal
        self.withdrawals.insert(id, withdrawal);
        
        Ok(id)
    }
    
    /// Confirm a withdrawal
    pub fn confirm_withdrawal(
        &mut self,
        id: [u8; 32],
    ) -> Result<(), String> {
        // Check if the withdrawal exists
        let withdrawal = match self.withdrawals.get_mut(&id) {
            Some(withdrawal) => withdrawal,
            None => return Err(format!("Withdrawal with ID {:?} does not exist", id)),
        };
        
        // Check if the withdrawal is pending
        if withdrawal.status != WithdrawalStatus::Pending {
            return Err(format!("Withdrawal with ID {:?} is not pending", id));
        }
        
        // Update the withdrawal status
        withdrawal.status = WithdrawalStatus::Confirmed;
        
        Ok(())
    }
    
    /// Finalize a withdrawal
    pub fn finalize_withdrawal(
        &mut self,
        id: [u8; 32],
        l1_tx_hash: [u8; 32],
    ) -> Result<(), String> {
        // Check if the withdrawal exists
        let withdrawal = match self.withdrawals.get_mut(&id) {
            Some(withdrawal) => withdrawal,
            None => return Err(format!("Withdrawal with ID {:?} does not exist", id)),
        };
        
        // Check if the withdrawal is confirmed
        if withdrawal.status != WithdrawalStatus::Confirmed {
            return Err(format!("Withdrawal with ID {:?} is not confirmed", id));
        }
        
        // Update the withdrawal status
        withdrawal.status = WithdrawalStatus::Finalized;
        withdrawal.l1_tx_hash = Some(l1_tx_hash);
        
        Ok(())
    }
    
    /// Reject a withdrawal
    pub fn reject_withdrawal(
        &mut self,
        id: [u8; 32],
        reason: &str,
    ) -> Result<(), String> {
        // Check if the withdrawal exists
        let withdrawal = match self.withdrawals.get_mut(&id) {
            Some(withdrawal) => withdrawal,
            None => return Err(format!("Withdrawal with ID {:?} does not exist", id)),
        };
        
        // Check if the withdrawal is pending or confirmed
        if withdrawal.status != WithdrawalStatus::Pending && withdrawal.status != WithdrawalStatus::Confirmed {
            return Err(format!("Withdrawal with ID {:?} cannot be rejected", id));
        }
        
        // Update the withdrawal status
        withdrawal.status = WithdrawalStatus::Rejected;
        
        // Log the rejection reason
        msg!("Withdrawal rejected: {}", reason);
        
        Ok(())
    }
    
    /// Get a withdrawal
    pub fn get_withdrawal(&self, id: [u8; 32]) -> Option<&Withdrawal> {
        self.withdrawals.get(&id)
    }
    
    /// Get all withdrawals
    pub fn get_withdrawals(&self) -> &HashMap<[u8; 32], Withdrawal> {
        &self.withdrawals
    }
    
    /// Get withdrawals by status
    pub fn get_withdrawals_by_status(&self, status: WithdrawalStatus) -> Vec<&Withdrawal> {
        self.withdrawals.values()
            .filter(|withdrawal| withdrawal.status == status)
            .collect()
    }
    
    /// Get withdrawals by L2 sender
    pub fn get_withdrawals_by_l2_sender(&self, l2_sender: [u8; 32]) -> Vec<&Withdrawal> {
        self.withdrawals.values()
            .filter(|withdrawal| withdrawal.l2_sender == l2_sender)
            .collect()
    }
    
    /// Get withdrawals by L1 recipient
    pub fn get_withdrawals_by_l1_recipient(&self, l1_recipient: [u8; 20]) -> Vec<&Withdrawal> {
        self.withdrawals.values()
            .filter(|withdrawal| withdrawal.l1_recipient == l1_recipient)
            .collect()
    }
}

/// Withdrawal instruction types
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum WithdrawalInstruction {
    /// Add a supported token
    AddSupportedToken {
        /// Token address
        token: [u8; 20],
        
        /// Minimum withdrawal amount
        min_amount: u64,
        
        /// Maximum withdrawal amount
        max_amount: u64,
    },
    
    /// Remove a supported token
    RemoveSupportedToken {
        /// Token address
        token: [u8; 20],
    },
    
    /// Process a withdrawal from L2
    ProcessWithdrawal {
        /// L2 transaction hash
        l2_tx_hash: [u8; 32],
        
        /// L2 block number
        l2_block_number: u64,
        
        /// L1 recipient address
        l1_recipient: [u8; 20],
        
        /// Token address
        token: [u8; 20],
        
        /// Amount
        amount: u64,
    },
    
    /// Confirm a withdrawal
    ConfirmWithdrawal {
        /// Withdrawal ID
        id: [u8; 32],
    },
    
    /// Finalize a withdrawal
    FinalizeWithdrawal {
        /// Withdrawal ID
        id: [u8; 32],
        
        /// L1 transaction hash
        l1_tx_hash: [u8; 32],
    },
    
    /// Reject a withdrawal
    RejectWithdrawal {
        /// Withdrawal ID
        id: [u8; 32],
        
        /// Reason
        reason: String,
    },
}

/// Process withdrawal instruction
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction: &WithdrawalInstruction,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    
    match instruction {
        WithdrawalInstruction::AddSupportedToken {
            token,
            min_amount,
            max_amount,
        } => {
            // Get the admin account
            let admin_info = next_account_info(account_info_iter)?;
            
            // Check if the admin is a signer
            if !admin_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the withdrawal handler account
            let withdrawal_handler_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the withdrawal handler account
            // 2. Add the supported token
            // 3. Serialize the updated withdrawal handler account
            
            // For now, we just log the addition
            msg!("Added supported token: {:?}", token);
            
            Ok(())
        },
        WithdrawalInstruction::RemoveSupportedToken {
            token,
        } => {
            // Get the admin account
            let admin_info = next_account_info(account_info_iter)?;
            
            // Check if the admin is a signer
            if !admin_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the withdrawal handler account
            let withdrawal_handler_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the withdrawal handler account
            // 2. Remove the supported token
            // 3. Serialize the updated withdrawal handler account
            
            // For now, we just log the removal
            msg!("Removed supported token: {:?}", token);
            
            Ok(())
        },
        WithdrawalInstruction::ProcessWithdrawal {
            l2_tx_hash,
            l2_block_number,
            l1_recipient,
            token,
            amount,
        } => {
            // Get the sender account
            let sender_info = next_account_info(account_info_iter)?;
            
            // Check if the sender is a signer
            if !sender_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the withdrawal handler account
            let withdrawal_handler_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the withdrawal handler account
            // 2. Process the withdrawal
            // 3. Serialize the updated withdrawal handler account
            
            // For now, we just log the withdrawal
            msg!("Processed withdrawal to {:?}", l1_recipient);
            
            Ok(())
        },
        WithdrawalInstruction::ConfirmWithdrawal {
            id,
        } => {
            // Get the validator account
            let validator_info = next_account_info(account_info_iter)?;
            
            // Check if the validator is a signer
            if !validator_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the withdrawal handler account
            let withdrawal_handler_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the withdrawal handler account
            // 2. Confirm the withdrawal
            // 3. Serialize the updated withdrawal handler account
            
            // For now, we just log the confirmation
            msg!("Confirmed withdrawal with ID: {:?}", id);
            
            Ok(())
        },
        WithdrawalInstruction::FinalizeWithdrawal {
            id,
            l1_tx_hash,
        } => {
            // Get the relayer account
            let relayer_info = next_account_info(account_info_iter)?;
            
            // Check if the relayer is a signer
            if !relayer_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the withdrawal handler account
            let withdrawal_handler_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the withdrawal handler account
            // 2. Finalize the withdrawal
            // 3. Serialize the updated withdrawal handler account
            
            // For now, we just log the finalization
            msg!("Finalized withdrawal with ID: {:?}", id);
            
            Ok(())
        },
        WithdrawalInstruction::RejectWithdrawal {
            id,
            reason,
        } => {
            // Get the validator account
            let validator_info = next_account_info(account_info_iter)?;
            
            // Check if the validator is a signer
            if !validator_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the withdrawal handler account
            let withdrawal_handler_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the withdrawal handler account
            // 2. Reject the withdrawal
            // 3. Serialize the updated withdrawal handler account
            
            // For now, we just log the rejection
            msg!("Rejected withdrawal with ID: {:?}, reason: {}", id, reason);
            
            Ok(())
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_withdrawal_handler() {
        // Create a withdrawal handler
        let mut handler = WithdrawalHandler::new();
        
        // Test adding and removing supported tokens
        let token = [1; 20];
        let min_amount = 1_000_000;
        let max_amount = 1_000_000_000;
        
        let result = handler.add_supported_token(token, min_amount, max_amount);
        assert!(result.is_ok());
        
        assert!(handler.supported_tokens.contains(&token));
        assert_eq!(handler.min_withdrawal_amounts.get(&token), Some(&min_amount));
        assert_eq!(handler.max_withdrawal_amounts.get(&token), Some(&max_amount));
        
        let result = handler.remove_supported_token(token);
        assert!(result.is_ok());
        
        assert!(!handler.supported_tokens.contains(&token));
        
        // Test processing a withdrawal
        let l2_tx_hash = [2; 32];
        let l2_block_number = 100;
        let l2_sender = [3; 32];
        let l1_recipient = [4; 20];
        let token = [0; 20]; // Use native token (ETH)
        let amount = 2_000_000_000_000_000; // 0.002 ETH
        
        let result = handler.process_withdrawal(
            l2_tx_hash,
            l2_block_number,
            l2_sender,
            l1_recipient,
            token,
            amount,
        );
        
        assert!(result.is_ok());
        
        let withdrawal_id = result.unwrap();
        
        // Test getting the withdrawal
        let withdrawal = handler.get_withdrawal(withdrawal_id).unwrap();
        assert_eq!(withdrawal.l2_tx_hash, l2_tx_hash);
        assert_eq!(withdrawal.l2_block_number, l2_block_number);
        assert_eq!(withdrawal.l2_sender, l2_sender);
        assert_eq!(withdrawal.l1_recipient, l1_recipient);
        assert_eq!(withdrawal.token, token);
        assert_eq!(withdrawal.amount, amount);
        assert_eq!(withdrawal.status, WithdrawalStatus::Pending);
        
        // Test confirming the withdrawal
        let result = handler.confirm_withdrawal(withdrawal_id);
        assert!(result.is_ok());
        
        let withdrawal = handler.get_withdrawal(withdrawal_id).unwrap();
        assert_eq!(withdrawal.status, WithdrawalStatus::Confirmed);
        
        // Test finalizing the withdrawal
        let l1_tx_hash = [5; 32];
        let result = handler.finalize_withdrawal(withdrawal_id, l1_tx_hash);
        assert!(result.is_ok());
        
        let withdrawal = handler.get_withdrawal(withdrawal_id).unwrap();
        assert_eq!(withdrawal.status, WithdrawalStatus::Finalized);
        assert_eq!(withdrawal.l1_tx_hash, Some(l1_tx_hash));
        
        // Test getting withdrawals by status
        let finalized_withdrawals = handler.get_withdrawals_by_status(WithdrawalStatus::Finalized);
        assert_eq!(finalized_withdrawals.len(), 1);
        assert_eq!(finalized_withdrawals[0].id, withdrawal_id);
        
        // Test getting withdrawals by sender
        let sender_withdrawals = handler.get_withdrawals_by_l2_sender(l2_sender);
        assert_eq!(sender_withdrawals.len(), 1);
        assert_eq!(sender_withdrawals[0].id, withdrawal_id);
        
        // Test getting withdrawals by recipient
        let recipient_withdrawals = handler.get_withdrawals_by_l1_recipient(l1_recipient);
        assert_eq!(recipient_withdrawals.len(), 1);
        assert_eq!(recipient_withdrawals[0].id, withdrawal_id);
    }
}
