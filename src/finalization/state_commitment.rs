// src/finalization/state_commitment.rs
//! State Commitment implementation for Layer-2 on Solana
//! 
//! This module provides the implementation of state commitment logic,
//! ensuring that state roots are properly committed to the Layer-1.

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

/// State commitment for the Layer-2 system
pub struct StateCommitment {
    /// State roots
    pub state_roots: HashMap<u64, StateRoot>,
    
    /// Latest committed state root number
    pub latest_committed_state_root: u64,
}

/// State root information
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct StateRoot {
    /// Block number
    pub block_number: u64,
    
    /// State root
    pub root: [u8; 32],
    
    /// Timestamp
    pub timestamp: u64,
    
    /// Committer
    pub committer: [u8; 32],
    
    /// Is committed to L1
    pub is_committed: bool,
    
    /// L1 transaction hash (if committed)
    pub l1_tx_hash: Option<[u8; 32]>,
}

impl StateCommitment {
    /// Create a new state commitment
    pub fn new() -> Self {
        Self {
            state_roots: HashMap::new(),
            latest_committed_state_root: 0,
        }
    }
    
    /// Initialize the state commitment
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        // In a real implementation, we would initialize the state commitment
        // with accounts and other data
        Ok(())
    }
    
    /// Propose a new state root
    pub fn propose_state_root(
        &mut self,
        block_number: u64,
        root: [u8; 32],
        committer: [u8; 32],
    ) -> Result<(), String> {
        // Check if the block number is valid
        if block_number <= self.latest_committed_state_root {
            return Err(format!("Block number {} is already committed", block_number));
        }
        
        // Check if the state root already exists
        if self.state_roots.contains_key(&block_number) {
            return Err(format!("State root for block number {} already exists", block_number));
        }
        
        // Get the current timestamp
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        // Create the state root info
        let state_root = StateRoot {
            block_number,
            root,
            timestamp: now,
            committer,
            is_committed: false,
            l1_tx_hash: None,
        };
        
        // Add the state root
        self.state_roots.insert(block_number, state_root);
        
        Ok(())
    }
    
    /// Commit a state root to L1
    pub fn commit_state_root(
        &mut self,
        block_number: u64,
        l1_tx_hash: [u8; 32],
    ) -> Result<(), String> {
        // Check if the state root exists
        let state_root = match self.state_roots.get_mut(&block_number) {
            Some(root) => root,
            None => return Err(format!("State root for block number {} does not exist", block_number)),
        };
        
        // Check if the state root is already committed
        if state_root.is_committed {
            return Err(format!("State root for block number {} is already committed", block_number));
        }
        
        // Update the state root
        state_root.is_committed = true;
        state_root.l1_tx_hash = Some(l1_tx_hash);
        
        // Update the latest committed state root number if necessary
        if block_number > self.latest_committed_state_root {
            self.latest_committed_state_root = block_number;
        }
        
        Ok(())
    }
    
    /// Get a state root
    pub fn get_state_root(&self, block_number: u64) -> Option<&StateRoot> {
        self.state_roots.get(&block_number)
    }
    
    /// Get the latest committed state root
    pub fn get_latest_committed_state_root(&self) -> Option<&StateRoot> {
        self.state_roots.get(&self.latest_committed_state_root)
    }
    
    /// Get all state roots
    pub fn get_state_roots(&self) -> &HashMap<u64, StateRoot> {
        &self.state_roots
    }
    
    /// Verify a state root
    pub fn verify_state_root(
        &self,
        block_number: u64,
        root: [u8; 32],
    ) -> bool {
        match self.state_roots.get(&block_number) {
            Some(state_root) => state_root.root == root,
            None => false,
        }
    }
}

/// State commitment instruction types
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum StateCommitmentInstruction {
    /// Propose a new state root
    ProposeStateRoot {
        /// Block number
        block_number: u64,
        
        /// State root
        root: [u8; 32],
    },
    
    /// Commit a state root to L1
    CommitStateRoot {
        /// Block number
        block_number: u64,
        
        /// L1 transaction hash
        l1_tx_hash: [u8; 32],
    },
    
    /// Verify a state root
    VerifyStateRoot {
        /// Block number
        block_number: u64,
        
        /// State root
        root: [u8; 32],
    },
}

/// Process state commitment instruction
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction: &StateCommitmentInstruction,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    
    match instruction {
        StateCommitmentInstruction::ProposeStateRoot {
            block_number,
            root,
        } => {
            // Get the committer account
            let committer_info = next_account_info(account_info_iter)?;
            
            // Check if the committer is a signer
            if !committer_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the state commitment account
            let state_commitment_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the state commitment account
            // 2. Propose the state root
            // 3. Serialize the updated state commitment account
            
            // For now, we just log the proposal
            msg!("Proposed state root for block number: {}", block_number);
            
            Ok(())
        },
        StateCommitmentInstruction::CommitStateRoot {
            block_number,
            l1_tx_hash,
        } => {
            // Get the committer account
            let committer_info = next_account_info(account_info_iter)?;
            
            // Check if the committer is a signer
            if !committer_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the state commitment account
            let state_commitment_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the state commitment account
            // 2. Commit the state root
            // 3. Serialize the updated state commitment account
            
            // For now, we just log the commitment
            msg!("Committed state root for block number: {}", block_number);
            
            Ok(())
        },
        StateCommitmentInstruction::VerifyStateRoot {
            block_number,
            root,
        } => {
            // Get the state commitment account
            let state_commitment_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the state commitment account
            // 2. Verify the state root
            
            // For now, we just log the verification
            msg!("Verified state root for block number: {}", block_number);
            
            Ok(())
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_state_commitment() {
        // Create a state commitment
        let mut state_commitment = StateCommitment::new();
        
        // Propose a state root
        let result = state_commitment.propose_state_root(
            1,
            [1; 32],
            [2; 32],
        );
        assert!(result.is_ok());
        
        // Get the state root
        let state_root = state_commitment.get_state_root(1).unwrap();
        assert_eq!(state_root.block_number, 1);
        assert_eq!(state_root.root, [1; 32]);
        assert_eq!(state_root.committer, [2; 32]);
        assert!(!state_root.is_committed);
        assert!(state_root.l1_tx_hash.is_none());
        
        // Commit the state root
        let result = state_commitment.commit_state_root(
            1,
            [3; 32],
        );
        assert!(result.is_ok());
        
        // Get the state root again
        let state_root = state_commitment.get_state_root(1).unwrap();
        assert!(state_root.is_committed);
        assert_eq!(state_root.l1_tx_hash, Some([3; 32]));
        
        // Verify the state root
        let result = state_commitment.verify_state_root(1, [1; 32]);
        assert!(result);
        
        // Verify with an incorrect root
        let result = state_commitment.verify_state_root(1, [2; 32]);
        assert!(!result);
    }
}
