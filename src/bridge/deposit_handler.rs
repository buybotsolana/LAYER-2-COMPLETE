// src/bridge/deposit_handler.rs
//! Deposit Handler implementation for Layer-2 on Solana
//! 
//! This module provides the implementation of the deposit handler for the bridge
//! between Ethereum (L1) and Solana Layer-2, allowing users to deposit assets
//! from L1 to L2 in a secure and trustless manner.

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

/// Deposit status
#[derive(Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum DepositStatus {
    /// Deposit is pending
    Pending,
    
    /// Deposit is confirmed
    Confirmed,
    
    /// Deposit is finalized
    Finalized,
    
    /// Deposit is rejected
    Rejected,
}

/// Deposit information
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct Deposit {
    /// Deposit ID
    pub id: [u8; 32],
    
    /// L1 transaction hash
    pub l1_tx_hash: [u8; 32],
    
    /// L1 block number
    pub l1_block_number: u64,
    
    /// L1 sender address
    pub l1_sender: [u8; 20],
    
    /// L2 recipient address
    pub l2_recipient: [u8; 32],
    
    /// Token address (zero address for native token)
    pub token: [u8; 20],
    
    /// Amount
    pub amount: u64,
    
    /// Timestamp
    pub timestamp: u64,
    
    /// Status
    pub status: DepositStatus,
    
    /// L2 transaction hash (if finalized)
    pub l2_tx_hash: Option<[u8; 32]>,
}

/// Deposit handler for the Layer-2 system
pub struct DepositHandler {
    /// Deposits
    pub deposits: HashMap<[u8; 32], Deposit>,
    
    /// Supported tokens
    pub supported_tokens: Vec<[u8; 20]>,
    
    /// Minimum deposit amounts per token
    pub min_deposit_amounts: HashMap<[u8; 20], u64>,
    
    /// Maximum deposit amounts per token
    pub max_deposit_amounts: HashMap<[u8; 20], u64>,
}

impl DepositHandler {
    /// Create a new deposit handler
    pub fn new() -> Self {
        let mut handler = Self {
            deposits: HashMap::new(),
            supported_tokens: Vec::new(),
            min_deposit_amounts: HashMap::new(),
            max_deposit_amounts: HashMap::new(),
        };
        
        // Add native token (ETH) as supported
        let eth_address = [0; 20];
        handler.supported_tokens.push(eth_address);
        handler.min_deposit_amounts.insert(eth_address, 1_000_000_000_000_000); // 0.001 ETH
        handler.max_deposit_amounts.insert(eth_address, 1_000_000_000_000_000_000_000); // 1000 ETH
        
        handler
    }
    
    /// Initialize the deposit handler
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        // In a real implementation, we would initialize the deposit handler
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
        self.min_deposit_amounts.insert(token, min_amount);
        self.max_deposit_amounts.insert(token, max_amount);
        
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
        self.min_deposit_amounts.remove(&token);
        self.max_deposit_amounts.remove(&token);
        
        Ok(())
    }
    
    /// Process a deposit from L1
    pub fn process_deposit(
        &mut self,
        l1_tx_hash: [u8; 32],
        l1_block_number: u64,
        l1_sender: [u8; 20],
        l2_recipient: [u8; 32],
        token: [u8; 20],
        amount: u64,
    ) -> Result<[u8; 32], String> {
        // Check if the token is supported
        if !self.supported_tokens.contains(&token) {
            return Err(format!("Token {:?} is not supported", token));
        }
        
        // Check if the amount is within limits
        let min_amount = self.min_deposit_amounts.get(&token).unwrap_or(&0);
        let max_amount = self.max_deposit_amounts.get(&token).unwrap_or(&u64::MAX);
        
        if amount < *min_amount {
            return Err(format!("Amount {} is less than minimum {}", amount, min_amount));
        }
        
        if amount > *max_amount {
            return Err(format!("Amount {} is greater than maximum {}", amount, max_amount));
        }
        
        // Generate a deposit ID
        let mut id_data = Vec::new();
        id_data.extend_from_slice(&l1_tx_hash);
        id_data.extend_from_slice(&l1_sender);
        id_data.extend_from_slice(&l2_recipient);
        id_data.extend_from_slice(&token);
        id_data.extend_from_slice(&amount.to_le_bytes());
        
        let id = solana_program::keccak::hash(&id_data).to_bytes();
        
        // Check if the deposit already exists
        if self.deposits.contains_key(&id) {
            return Err(format!("Deposit with ID {:?} already exists", id));
        }
        
        // Get the current timestamp
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        // Create the deposit
        let deposit = Deposit {
            id,
            l1_tx_hash,
            l1_block_number,
            l1_sender,
            l2_recipient,
            token,
            amount,
            timestamp: now,
            status: DepositStatus::Pending,
            l2_tx_hash: None,
        };
        
        // Add the deposit
        self.deposits.insert(id, deposit);
        
        Ok(id)
    }
    
    /// Confirm a deposit
    pub fn confirm_deposit(
        &mut self,
        id: [u8; 32],
    ) -> Result<(), String> {
        // Check if the deposit exists
        let deposit = match self.deposits.get_mut(&id) {
            Some(deposit) => deposit,
            None => return Err(format!("Deposit with ID {:?} does not exist", id)),
        };
        
        // Check if the deposit is pending
        if deposit.status != DepositStatus::Pending {
            return Err(format!("Deposit with ID {:?} is not pending", id));
        }
        
        // Update the deposit status
        deposit.status = DepositStatus::Confirmed;
        
        Ok(())
    }
    
    /// Finalize a deposit
    pub fn finalize_deposit(
        &mut self,
        id: [u8; 32],
        l2_tx_hash: [u8; 32],
    ) -> Result<(), String> {
        // Check if the deposit exists
        let deposit = match self.deposits.get_mut(&id) {
            Some(deposit) => deposit,
            None => return Err(format!("Deposit with ID {:?} does not exist", id)),
        };
        
        // Check if the deposit is confirmed
        if deposit.status != DepositStatus::Confirmed {
            return Err(format!("Deposit with ID {:?} is not confirmed", id));
        }
        
        // Update the deposit status
        deposit.status = DepositStatus::Finalized;
        deposit.l2_tx_hash = Some(l2_tx_hash);
        
        Ok(())
    }
    
    /// Reject a deposit
    pub fn reject_deposit(
        &mut self,
        id: [u8; 32],
        reason: &str,
    ) -> Result<(), String> {
        // Check if the deposit exists
        let deposit = match self.deposits.get_mut(&id) {
            Some(deposit) => deposit,
            None => return Err(format!("Deposit with ID {:?} does not exist", id)),
        };
        
        // Check if the deposit is pending or confirmed
        if deposit.status != DepositStatus::Pending && deposit.status != DepositStatus::Confirmed {
            return Err(format!("Deposit with ID {:?} cannot be rejected", id));
        }
        
        // Update the deposit status
        deposit.status = DepositStatus::Rejected;
        
        // Log the rejection reason
        msg!("Deposit rejected: {}", reason);
        
        Ok(())
    }
    
    /// Get a deposit
    pub fn get_deposit(&self, id: [u8; 32]) -> Option<&Deposit> {
        self.deposits.get(&id)
    }
    
    /// Get all deposits
    pub fn get_deposits(&self) -> &HashMap<[u8; 32], Deposit> {
        &self.deposits
    }
    
    /// Get deposits by status
    pub fn get_deposits_by_status(&self, status: DepositStatus) -> Vec<&Deposit> {
        self.deposits.values()
            .filter(|deposit| deposit.status == status)
            .collect()
    }
    
    /// Get deposits by L1 sender
    pub fn get_deposits_by_l1_sender(&self, l1_sender: [u8; 20]) -> Vec<&Deposit> {
        self.deposits.values()
            .filter(|deposit| deposit.l1_sender == l1_sender)
            .collect()
    }
    
    /// Get deposits by L2 recipient
    pub fn get_deposits_by_l2_recipient(&self, l2_recipient: [u8; 32]) -> Vec<&Deposit> {
        self.deposits.values()
            .filter(|deposit| deposit.l2_recipient == l2_recipient)
            .collect()
    }
}

/// Deposit instruction types
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum DepositInstruction {
    /// Add a supported token
    AddSupportedToken {
        /// Token address
        token: [u8; 20],
        
        /// Minimum deposit amount
        min_amount: u64,
        
        /// Maximum deposit amount
        max_amount: u64,
    },
    
    /// Remove a supported token
    RemoveSupportedToken {
        /// Token address
        token: [u8; 20],
    },
    
    /// Process a deposit from L1
    ProcessDeposit {
        /// L1 transaction hash
        l1_tx_hash: [u8; 32],
        
        /// L1 block number
        l1_block_number: u64,
        
        /// L1 sender address
        l1_sender: [u8; 20],
        
        /// L2 recipient address
        l2_recipient: [u8; 32],
        
        /// Token address
        token: [u8; 20],
        
        /// Amount
        amount: u64,
    },
    
    /// Confirm a deposit
    ConfirmDeposit {
        /// Deposit ID
        id: [u8; 32],
    },
    
    /// Finalize a deposit
    FinalizeDeposit {
        /// Deposit ID
        id: [u8; 32],
        
        /// L2 transaction hash
        l2_tx_hash: [u8; 32],
    },
    
    /// Reject a deposit
    RejectDeposit {
        /// Deposit ID
        id: [u8; 32],
        
        /// Reason
        reason: String,
    },
}

/// Process deposit instruction
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction: &DepositInstruction,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    
    match instruction {
        DepositInstruction::AddSupportedToken {
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
            
            // Get the deposit handler account
            let deposit_handler_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the deposit handler account
            // 2. Add the supported token
            // 3. Serialize the updated deposit handler account
            
            // For now, we just log the addition
            msg!("Added supported token: {:?}", token);
            
            Ok(())
        },
        DepositInstruction::RemoveSupportedToken {
            token,
        } => {
            // Get the admin account
            let admin_info = next_account_info(account_info_iter)?;
            
            // Check if the admin is a signer
            if !admin_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the deposit handler account
            let deposit_handler_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the deposit handler account
            // 2. Remove the supported token
            // 3. Serialize the updated deposit handler account
            
            // For now, we just log the removal
            msg!("Removed supported token: {:?}", token);
            
            Ok(())
        },
        DepositInstruction::ProcessDeposit {
            l1_tx_hash,
            l1_block_number,
            l1_sender,
            l2_recipient,
            token,
            amount,
        } => {
            // Get the relayer account
            let relayer_info = next_account_info(account_info_iter)?;
            
            // Check if the relayer is a signer
            if !relayer_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the deposit handler account
            let deposit_handler_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the deposit handler account
            // 2. Process the deposit
            // 3. Serialize the updated deposit handler account
            
            // For now, we just log the deposit
            msg!("Processed deposit from {:?} to {:?}", l1_sender, l2_recipient);
            
            Ok(())
        },
        DepositInstruction::ConfirmDeposit {
            id,
        } => {
            // Get the relayer account
            let relayer_info = next_account_info(account_info_iter)?;
            
            // Check if the relayer is a signer
            if !relayer_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the deposit handler account
            let deposit_handler_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the deposit handler account
            // 2. Confirm the deposit
            // 3. Serialize the updated deposit handler account
            
            // For now, we just log the confirmation
            msg!("Confirmed deposit with ID: {:?}", id);
            
            Ok(())
        },
        DepositInstruction::FinalizeDeposit {
            id,
            l2_tx_hash,
        } => {
            // Get the relayer account
            let relayer_info = next_account_info(account_info_iter)?;
            
            // Check if the relayer is a signer
            if !relayer_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the deposit handler account
            let deposit_handler_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the deposit handler account
            // 2. Finalize the deposit
            // 3. Serialize the updated deposit handler account
            
            // For now, we just log the finalization
            msg!("Finalized deposit with ID: {:?}", id);
            
            Ok(())
        },
        DepositInstruction::RejectDeposit {
            id,
            reason,
        } => {
            // Get the relayer account
            let relayer_info = next_account_info(account_info_iter)?;
            
            // Check if the relayer is a signer
            if !relayer_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the deposit handler account
            let deposit_handler_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the deposit handler account
            // 2. Reject the deposit
            // 3. Serialize the updated deposit handler account
            
            // For now, we just log the rejection
            msg!("Rejected deposit with ID: {:?}, reason: {}", id, reason);
            
            Ok(())
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_deposit_handler() {
        // Create a deposit handler
        let mut deposit_handler = DepositHandler::new();
        
        // Add a supported token
        let token = [1; 20];
        let result = deposit_handler.add_supported_token(
            token,
            1_000_000, // 1 token
            1_000_000_000_000, // 1,000,000 tokens
        );
        assert!(result.is_ok());
        
        // Process a deposit
        let l1_tx_hash = [2; 32];
        let l1_block_number = 1;
        let l1_sender = [3; 20];
        let l2_recipient = [4; 32];
        let amount = 5_000_000; // 5 tokens
        
        let result = deposit_handler.process_deposit(
            l1_tx_hash,
            l1_block_number,
            l1_sender,
            l2_recipient,
            token,
            amount,
        );
        assert!(result.is_ok());
        let id = result.unwrap();
        
        // Get the deposit
        let deposit = deposit_handler.get_deposit(id).unwrap();
        assert_eq!(deposit.l1_tx_hash, l1_tx_hash);
        assert_eq!(deposit.l1_block_number, l1_block_number);
        assert_eq!(deposit.l1_sender, l1_sender);
        assert_eq!(deposit.l2_recipient, l2_recipient);
        assert_eq!(deposit.token, token);
        assert_eq!(deposit.amount, amount);
        assert_eq!(deposit.status, DepositStatus::Pending);
        
        // Confirm the deposit
        let result = deposit_handler.confirm_deposit(id);
        assert!(result.is_ok());
        
        // Get the deposit again
        let deposit = deposit_handler.get_deposit(id).unwrap();
        assert_eq!(deposit.status, DepositStatus::Confirmed);
        
        // Finalize the deposit
        let l2_tx_hash = [5; 32];
        let result = deposit_handler.finalize_deposit(id, l2_tx_hash);
        assert!(result.is_ok());
        
        // Get the deposit again
        let deposit = deposit_handler.get_deposit(id).unwrap();
        assert_eq!(deposit.status, DepositStatus::Finalized);
        assert_eq!(deposit.l2_tx_hash, Some(l2_tx_hash));
    }
}
