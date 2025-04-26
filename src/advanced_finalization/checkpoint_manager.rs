// src/advanced_finalization/checkpoint_manager.rs
//! Checkpoint Manager module for Advanced Finalization System
//! 
//! This module implements checkpoint management:
//! - Checkpoint creation and storage
//! - Checkpoint status tracking
//! - Checkpoint pruning and archiving
//! - Checkpoint verification
//!
//! Checkpoints are snapshots of the system state that can be finalized,
//! providing a basis for the security guarantees of the Layer-2 system.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::{HashMap, VecDeque};

/// Checkpoint status
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CheckpointStatus {
    /// Pending status (initial)
    Pending,
    
    /// Confirmed status (enough confirmations)
    Confirmed,
    
    /// Finalized status (final)
    Finalized,
    
    /// Forced finalized status (final, but forced)
    ForcedFinalized,
    
    /// Rejected status (invalid)
    Rejected,
}

/// Checkpoint configuration
#[derive(Debug, Clone)]
pub struct CheckpointConfig {
    /// Minimum time between checkpoints (in seconds)
    pub min_checkpoint_interval: u64,
    
    /// Maximum time between checkpoints (in seconds)
    pub max_checkpoint_interval: u64,
    
    /// Maximum number of checkpoints to keep
    pub max_checkpoint_count: u32,
}

impl Default for CheckpointConfig {
    fn default() -> Self {
        Self {
            min_checkpoint_interval: 3600, // 1 hour in seconds
            max_checkpoint_interval: 86400, // 1 day in seconds
            max_checkpoint_count: 100,
        }
    }
}

/// Checkpoint
#[derive(Debug, Clone)]
pub struct Checkpoint {
    /// Checkpoint ID
    pub id: u64,
    
    /// Block hash
    pub block_hash: [u8; 32],
    
    /// Block number
    pub block_number: u64,
    
    /// State root
    pub state_root: [u8; 32],
    
    /// Timestamp
    pub timestamp: u64,
    
    /// Proposer
    pub proposer: Pubkey,
    
    /// Status
    pub status: CheckpointStatus,
    
    /// Finalization timestamp
    pub finalization_timestamp: Option<u64>,
    
    /// Votes count
    pub votes_count: u32,
    
    /// Total stake voted
    pub total_stake_voted: u64,
}

/// Checkpoint manager for the advanced finalization system
pub struct CheckpointManager {
    /// Checkpoint configuration
    config: CheckpointConfig,
    
    /// Checkpoints by ID
    checkpoints: HashMap<u64, Checkpoint>,
    
    /// Checkpoint IDs in order
    checkpoint_ids: VecDeque<u64>,
    
    /// Next checkpoint ID
    next_checkpoint_id: u64,
    
    /// Last checkpoint timestamp
    last_checkpoint_timestamp: u64,
    
    /// Whether the checkpoint manager is initialized
    initialized: bool,
}

impl CheckpointManager {
    /// Create a new checkpoint manager with default configuration
    pub fn new() -> Self {
        Self {
            config: CheckpointConfig::default(),
            checkpoints: HashMap::new(),
            checkpoint_ids: VecDeque::new(),
            next_checkpoint_id: 1,
            last_checkpoint_timestamp: 0,
            initialized: false,
        }
    }
    
    /// Create a new checkpoint manager with the specified configuration
    pub fn with_config(config: CheckpointConfig) -> Self {
        Self {
            config,
            checkpoints: HashMap::new(),
            checkpoint_ids: VecDeque::new(),
            next_checkpoint_id: 1,
            last_checkpoint_timestamp: 0,
            initialized: false,
        }
    }
    
    /// Initialize the checkpoint manager
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        self.initialized = true;
        
        msg!("Checkpoint manager initialized");
        
        Ok(())
    }
    
    /// Check if the checkpoint manager is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Create a checkpoint
    pub fn create_checkpoint(
        &mut self,
        block_hash: [u8; 32],
        block_number: u64,
        state_root: [u8; 32],
        timestamp: u64,
        proposer: Pubkey,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the minimum checkpoint interval has passed
        if timestamp < self.last_checkpoint_timestamp + self.config.min_checkpoint_interval {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Create the checkpoint
        let checkpoint_id = self.next_checkpoint_id;
        self.next_checkpoint_id += 1;
        
        let checkpoint = Checkpoint {
            id: checkpoint_id,
            block_hash,
            block_number,
            state_root,
            timestamp,
            proposer,
            status: CheckpointStatus::Pending,
            finalization_timestamp: None,
            votes_count: 0,
            total_stake_voted: 0,
        };
        
        // Add the checkpoint
        self.checkpoints.insert(checkpoint_id, checkpoint);
        self.checkpoint_ids.push_back(checkpoint_id);
        
        // Update the last checkpoint timestamp
        self.last_checkpoint_timestamp = timestamp;
        
        // Prune old checkpoints if necessary
        self.prune_checkpoints();
        
        msg!("Checkpoint created: {}", checkpoint_id);
        
        Ok(checkpoint_id)
    }
    
    /// Get a checkpoint
    pub fn get_checkpoint(&self, checkpoint_id: u64) -> Result<&Checkpoint, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the checkpoint
        let checkpoint = self.checkpoints.get(&checkpoint_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        Ok(checkpoint)
    }
    
    /// Update checkpoint status
    pub fn update_checkpoint_status(
        &mut self,
        checkpoint_id: u64,
        status: CheckpointStatus,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the checkpoint
        let checkpoint = self.checkpoints.get_mut(&checkpoint_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Update the status
        checkpoint.status = status.clone();
        
        // If the checkpoint is finalized, set the finalization timestamp
        if status == CheckpointStatus::Finalized || status == CheckpointStatus::ForcedFinalized {
            checkpoint.finalization_timestamp = Some(0); // In a real implementation, we would use the current timestamp
        }
        
        msg!("Checkpoint status updated: {}, status: {:?}", checkpoint_id, status);
        
        Ok(())
    }
    
    /// Register a vote for a checkpoint
    pub fn register_vote(
        &mut self,
        checkpoint_id: u64,
        voter_stake: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the checkpoint
        let checkpoint = self.checkpoints.get_mut(&checkpoint_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the checkpoint is pending
        if checkpoint.status != CheckpointStatus::Pending {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Update the votes
        checkpoint.votes_count += 1;
        checkpoint.total_stake_voted += voter_stake;
        
        msg!("Vote registered for checkpoint: {}, total votes: {}, total stake: {}", 
            checkpoint_id, checkpoint.votes_count, checkpoint.total_stake_voted);
        
        Ok(())
    }
    
    /// Check for checkpoints that need to be created
    pub fn check_checkpoint_creation(&self, current_timestamp: u64) -> Result<bool, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the maximum checkpoint interval has passed
        if current_timestamp >= self.last_checkpoint_timestamp + self.config.max_checkpoint_interval {
            return Ok(true);
        }
        
        Ok(false)
    }
    
    /// Prune old checkpoints
    fn prune_checkpoints(&mut self) {
        // Check if we need to prune
        while self.checkpoint_ids.len() > self.config.max_checkpoint_count as usize {
            // Get the oldest checkpoint ID
            if let Some(oldest_id) = self.checkpoint_ids.pop_front() {
                // Remove the checkpoint
                self.checkpoints.remove(&oldest_id);
                
                msg!("Checkpoint pruned: {}", oldest_id);
            }
        }
    }
    
    /// Get the latest checkpoint
    pub fn get_latest_checkpoint(&self) -> Option<&Checkpoint> {
        if !self.initialized {
            return None;
        }
        
        // Get the latest checkpoint ID
        if let Some(latest_id) = self.checkpoint_ids.back() {
            // Get the checkpoint
            return self.checkpoints.get(latest_id);
        }
        
        None
    }
    
    /// Get the latest finalized checkpoint
    pub fn get_latest_finalized_checkpoint(&self) -> Option<&Checkpoint> {
        if !self.initialized {
            return None;
        }
        
        // Iterate through the checkpoints in reverse order
        for checkpoint_id in self.checkpoint_ids.iter().rev() {
            // Get the checkpoint
            if let Some(checkpoint) = self.checkpoints.get(checkpoint_id) {
                // Check if the checkpoint is finalized
                if checkpoint.status == CheckpointStatus::Finalized || 
                   checkpoint.status == CheckpointStatus::ForcedFinalized {
                    return Some(checkpoint);
                }
            }
        }
        
        None
    }
    
    /// Update the checkpoint manager configuration
    pub fn update_config(&mut self, config: CheckpointConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the configuration
        self.config = config;
        
        msg!("Checkpoint manager configuration updated");
        
        Ok(())
    }
    
    /// Get all checkpoints
    pub fn get_all_checkpoints(&self) -> &HashMap<u64, Checkpoint> {
        &self.checkpoints
    }
    
    /// Get checkpoint IDs in order
    pub fn get_checkpoint_ids(&self) -> &VecDeque<u64> {
        &self.checkpoint_ids
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_checkpoint_manager_creation() {
        let manager = CheckpointManager::new();
        assert!(!manager.is_initialized());
    }
    
    #[test]
    fn test_checkpoint_manager_with_config() {
        let config = CheckpointConfig::default();
        let manager = CheckpointManager::with_config(config);
        assert!(!manager.is_initialized());
    }
}
