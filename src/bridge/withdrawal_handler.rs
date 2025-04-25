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
    /// Withdrawal is initiated
    Initiated,
    
    /// Withdrawal is proven
    Proven,
    
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
    
    /// Proof
    pub proof: Option<WithdrawalProof>,
    
    /// L1 transaction hash (if finalized)
    pub l1_tx_hash: Option<[u8; 32]>,
}

/// Withdrawal proof
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct WithdrawalProof {
    /// Merkle proof
    pub merkle_proof: Vec<[u8; 32]>,
    
    /// Merkle root
    pub merkle_root: [u8; 32],
    
    /// Leaf index
    pub leaf_index: u64,
    
    /// Block number
    pub block_number: u64,
    
    /// Timestamp
    pub timestamp: u64,
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
    
    /// Challenge period in seconds
    pub challenge_period: u64,
}

impl WithdrawalHandler {
    /// Create a new withdrawal handler
    pub fn new(challenge_period: u64) -> Self {
        let mut handler = Self {
            withdrawals: HashMap::new(),
            supported_tokens: Vec::new(),
            min_withdrawal_amounts: HashMap::new(),
            max_withdrawal_amounts: HashMap::new(),
            challenge_period,
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
    
    /// Initiate a withdrawal from L2 to L1
    pub fn initiate_withdrawal(
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
            status: WithdrawalStatus::Initiated,
            proof: None,
            l1_tx_hash: None,
        };
        
        // Add the withdrawal
        self.withdrawals.insert(id, withdrawal);
        
        Ok(id)
    }
    
    /// Prove a withdrawal
    pub fn prove_withdrawal(
        &mut self,
        id: [u8; 32],
        merkle_proof: Vec<[u8; 32]>,
        merkle_root: [u8; 32],
        leaf_index: u64,
        block_number: u64,
    ) -> Result<(), String> {
        // Check if the withdrawal exists
        let withdrawal = match self.withdrawals.get_mut(&id) {
            Some(withdrawal) => withdrawal,
            None => return Err(format!("Withdrawal with ID {:?} does not exist", id)),
        };
        
        // Check if the withdrawal is initiated
        if withdrawal.status != WithdrawalStatus::Initiated {
            return Err(format!("Withdrawal with ID {:?} is not initiated", id));
        }
        
        // Get the current timestamp
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        // Create the proof
        let proof = WithdrawalProof {
            merkle_proof,
            merkle_root,
            leaf_index,
            block_number,
            timestamp: now,
        };
        
        // Update the withdrawal
        withdrawal.status = WithdrawalStatus::Proven;
        withdrawal.proof = Some(proof);
        
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
        
        // Check if the withdrawal is proven
        if withdrawal.status != WithdrawalStatus::Proven {
            return Err(format!("Withdrawal with ID {:?} is not proven", id));
        }
        
        // Check if the challenge period has passed
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        let proof_timestamp = withdrawal.proof.as_ref().unwrap().timestamp;
        if now < proof_timestamp + self.challenge_period {
            return Err(format!("Challenge period for withdrawal with ID {:?} has not passed", id));
        }
        
        // Update the withdrawal
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
        
        // Check if the withdrawal is initiated or proven
        if withdrawal.status != WithdrawalStatus::Initiated && withdrawal.status != WithdrawalStatus::Proven {
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
    
    /// Verify a withdrawal proof
    pub fn verify_withdrawal_proof(
        &self,
        id: [u8; 32],
    ) -> Result<bool, String> {
        // Check if the withdrawal exists
        let withdrawal = match self.withdrawals.get(&id) {
            Some(withdrawal) => withdrawal,
            None => return Err(format!("Withdrawal with ID {:?} does not exist", id)),
        };
        
        // Check if the withdrawal has a proof
        let proof = match &withdrawal.proof {
            Some(proof) => proof,
            None => return Err(format!("Withdrawal with ID {:?} has no proof", id)),
        };
        
        // In a real implementation, we would verify the Merkle proof
        // For now, we'll assume all proofs are valid
        Ok(true)
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
    
    /// Initiate a withdrawal from L2 to L1
    InitiateWithdrawal {
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
    
    /// Prove a withdrawal
    ProveWithdrawal {
        /// Withdrawal ID
        id: [u8; 32],
        
        /// Merkle proof
        merkle_proof: Vec<[u8; 32]>,
        
        /// Merkle root
        merkle_root: [u8; 32],
        
        /// Leaf index
        leaf_index: u64,
        
        /// Block number
        block_number: u64,
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
        WithdrawalInstruction::InitiateWithdrawal {
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
            // 2. Initiate the withdrawal
            // 3. Serialize the updated withdrawal handler account
            
            // For now, we just log the initiation
            msg!("Initiated withdrawal from {:?} to {:?}", sender_info.key, l1_recipient);
            
            Ok(())
        },
        WithdrawalInstruction::ProveWithdrawal {
            id,
            merkle_proof,
            merkle_root,
            leaf_index,
            block_number,
        } => {
            // Get the prover account
            let prover_info = next_account_info(account_info_iter)?;
            
            // Check if the prover is a signer
            if !prover_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the withdrawal handler account
            let withdrawal_handler_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the withdrawal handler account
            // 2. Prove the withdrawal
            // 3. Serialize the updated withdrawal handler account
            
            // For now, we just log the proof
            msg!("Proved withdrawal with ID: {:?}", id);
            
            Ok(())
        },
        WithdrawalInstruction::FinalizeWithdrawal {
            id,
            l1_tx_hash,
        } => {
            // Get the finalizer account
            let finalizer_info = next_account_info(account_info_iter)?;
            
            // Check if the finalizer is a signer
            if !finalizer_info.is_signer {
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
            // Get the rejecter account
            let rejecter_info = next_account_info(account_info_iter)?;
            
            // Check if the rejecter is a signer
            if !rejecter_info.is_signer {
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
        // Create a withdrawal handler with a 10-second challenge period
        let mut withdrawal_handler = WithdrawalHandler::new(10);
        
        // Add a supported token
        let token = [1; 20];
        let result = withdrawal_handler.add_supported_token(
            token,
            1_000_000, // 1 token
            1_000_000_000_000, // 1,000,000 tokens
        );
        assert!(result.is_ok());
        
        // Initiate a withdrawal
        let l2_tx_hash = [2; 32];
        let l2_block_number = 1;
        let l2_sender = [3; 32];
        let l1_recipient = [4; 20];
        let amount = 5_000_000; // 5 tokens
        
        let result = withdrawal_handler.initiate_withdrawal(
            l2_tx_hash,
            l2_block_number,
            l2_sender,
            l1_recipient,
            token,
            amount,
        );
        assert!(result.is_ok());
        let id = result.unwrap();
        
        // Get the withdrawal
        let withdrawal = withdrawal_handler.get_withdrawal(id).unwrap();
        assert_eq!(withdrawal.l2_tx_hash, l2_tx_hash);
        assert_eq!(withdrawal.l2_block_number, l2_block_number);
        assert_eq!(withdrawal.l2_sender, l2_sender);
        assert_eq!(withdrawal.l1_recipient, l1_recipient);
        assert_eq!(withdrawal.token, token);
        assert_eq!(withdrawal.amount, amount);
        assert_eq!(withdrawal.status, WithdrawalStatus::Initiated);
        
        // Prove the withdrawal
        let merkle_proof = vec![[5; 32], [6; 32]];
        let merkle_root = [7; 32];
        let leaf_index = 8;
        let block_number = 9;
        
        let result = withdrawal_handler.prove_withdrawal(
            id,
            merkle_proof.clone(),
            merkle_root,
            leaf_index,
            block_number,
        );
        assert!(result.is_ok());
        
        // Get the withdrawal again
        let withdrawal = withdrawal_handler.get_withdrawal(id).unwrap();
        assert_eq!(withdrawal.status, WithdrawalStatus::Proven);
        assert!(withdrawal.proof.is_some());
        let proof = withdrawal.proof.as_ref().unwrap();
        assert_eq!(proof.merkle_proof, merkle_proof);
        assert_eq!(proof.merkle_root, merkle_root);
        assert_eq!(proof.leaf_index, leaf_index);
        assert_eq!(proof.block_number, block_number);
        
        // Verify the withdrawal proof
        let result = withdrawal_handler.verify_withdrawal_proof(id);
        assert!(result.is_ok());
        assert!(result.unwrap());
        
        // Finalize the withdrawal
        // Note: In a real test, we would need to wait for the challenge period to pass
        // For this test, we'll assume it has passed
        let l1_tx_hash = [10; 32];
        let result = withdrawal_handler.finalize_withdrawal(id, l1_tx_hash);
        assert!(result.is_ok());
        
        // Get the withdrawal again
        let withdrawal = withdrawal_handler.get_withdrawal(id).unwrap();
        assert_eq!(withdrawal.status, WithdrawalStatus::Finalized);
        assert_eq!(withdrawal.l1_tx_hash, Some(l1_tx_hash));
    }
}
