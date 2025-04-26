// src/advanced_finalization/finalization_protocol.rs
//! Finalization Protocol module for Advanced Finalization System
//! 
//! This module implements the finalization protocol:
//! - Multi-stage finalization process
//! - Optimistic and forced finalization paths
//! - Challenge period management
//! - Finalization state tracking
//!
//! The finalization protocol defines the rules and process by which
//! state transitions become irreversible.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;

/// Finalization stage
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FinalizationStage {
    /// Proposed stage (initial)
    Proposed,
    
    /// Confirmed stage (enough confirmations)
    Confirmed,
    
    /// In challenge period
    InChallengePeriod,
    
    /// Finalized stage (final)
    Finalized,
    
    /// Forced finalized stage (final, but forced)
    ForcedFinalized,
    
    /// Rejected stage (invalid)
    Rejected,
}

/// Finalization configuration
#[derive(Debug, Clone)]
pub struct FinalizationConfig {
    /// Number of confirmations required for optimistic finalization
    pub optimistic_confirmation_count: u32,
    
    /// Challenge period for optimistic finalization (in seconds)
    pub optimistic_challenge_period: u64,
    
    /// Whether to enable forced finalization
    pub enable_forced_finalization: bool,
    
    /// Timeout for forced finalization (in seconds)
    pub forced_finalization_timeout: u64,
}

impl Default for FinalizationConfig {
    fn default() -> Self {
        Self {
            optimistic_confirmation_count: 100,
            optimistic_challenge_period: 604800, // 7 days in seconds
            enable_forced_finalization: true,
            forced_finalization_timeout: 1209600, // 14 days in seconds
        }
    }
}

/// Finalization state
#[derive(Debug, Clone)]
struct FinalizationState {
    /// Checkpoint ID
    pub checkpoint_id: u64,
    
    /// Current stage
    pub stage: FinalizationStage,
    
    /// Confirmation count
    pub confirmation_count: u32,
    
    /// Stage start timestamp
    pub stage_start_timestamp: u64,
    
    /// Challenge period end timestamp
    pub challenge_period_end_timestamp: Option<u64>,
    
    /// Whether the checkpoint is challenged
    pub is_challenged: bool,
    
    /// Challenge ID (if challenged)
    pub challenge_id: Option<u64>,
}

/// Finalization protocol for the advanced finalization system
pub struct FinalizationProtocol {
    /// Finalization configuration
    config: FinalizationConfig,
    
    /// Finalization states by checkpoint ID
    states: HashMap<u64, FinalizationState>,
    
    /// Whether the finalization protocol is initialized
    initialized: bool,
}

impl FinalizationProtocol {
    /// Create a new finalization protocol with default configuration
    pub fn new() -> Self {
        Self {
            config: FinalizationConfig::default(),
            states: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Create a new finalization protocol with the specified configuration
    pub fn with_config(config: FinalizationConfig) -> Self {
        Self {
            config,
            states: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Initialize the finalization protocol
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        self.initialized = true;
        
        msg!("Finalization protocol initialized");
        
        Ok(())
    }
    
    /// Check if the finalization protocol is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Start the finalization process for a checkpoint
    pub fn start_finalization(&mut self, checkpoint_id: u64) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the checkpoint is already being finalized
        if self.states.contains_key(&checkpoint_id) {
            return Err(ProgramError::AccountAlreadyInitialized);
        }
        
        // Create the finalization state
        let state = FinalizationState {
            checkpoint_id,
            stage: FinalizationStage::Proposed,
            confirmation_count: 0,
            stage_start_timestamp: 0, // In a real implementation, we would use the current timestamp
            challenge_period_end_timestamp: None,
            is_challenged: false,
            challenge_id: None,
        };
        
        // Add the state
        self.states.insert(checkpoint_id, state);
        
        msg!("Finalization started for checkpoint: {}", checkpoint_id);
        
        Ok(())
    }
    
    /// Confirm a checkpoint
    pub fn confirm(&mut self, checkpoint_id: u64) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the finalization state
        let state = self.states.get_mut(&checkpoint_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the checkpoint is in the Proposed stage
        if state.stage != FinalizationStage::Proposed {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Increment the confirmation count
        state.confirmation_count += 1;
        
        // Check if the checkpoint has enough confirmations
        if state.confirmation_count >= self.config.optimistic_confirmation_count {
            // Move to the InChallengePeriod stage
            state.stage = FinalizationStage::InChallengePeriod;
            state.stage_start_timestamp = 0; // In a real implementation, we would use the current timestamp
            
            // Set the challenge period end timestamp
            let current_timestamp = 0; // In a real implementation, we would use the current timestamp
            state.challenge_period_end_timestamp = Some(current_timestamp + self.config.optimistic_challenge_period);
            
            msg!("Checkpoint moved to challenge period: {}", checkpoint_id);
        } else {
            msg!("Checkpoint confirmed: {}, count: {}", checkpoint_id, state.confirmation_count);
        }
        
        Ok(())
    }
    
    /// Challenge a checkpoint
    pub fn challenge(&mut self, checkpoint_id: u64, challenge_id: u64) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the finalization state
        let state = self.states.get_mut(&checkpoint_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the checkpoint is in the InChallengePeriod stage
        if state.stage != FinalizationStage::InChallengePeriod {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if the checkpoint is already challenged
        if state.is_challenged {
            return Err(ProgramError::AccountAlreadyInitialized);
        }
        
        // Mark the checkpoint as challenged
        state.is_challenged = true;
        state.challenge_id = Some(challenge_id);
        
        msg!("Checkpoint challenged: {}, challenge: {}", checkpoint_id, challenge_id);
        
        Ok(())
    }
    
    /// Resolve a challenge
    pub fn resolve_challenge(&mut self, checkpoint_id: u64, challenge_successful: bool) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the finalization state
        let state = self.states.get_mut(&checkpoint_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the checkpoint is challenged
        if !state.is_challenged {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Resolve the challenge
        if challenge_successful {
            // Challenge was successful, reject the checkpoint
            state.stage = FinalizationStage::Rejected;
            
            msg!("Checkpoint rejected due to successful challenge: {}", checkpoint_id);
        } else {
            // Challenge failed, continue with the challenge period
            state.is_challenged = false;
            state.challenge_id = None;
            
            msg!("Challenge failed, checkpoint continues in challenge period: {}", checkpoint_id);
        }
        
        Ok(())
    }
    
    /// Finalize a checkpoint
    pub fn finalize(&mut self, checkpoint_id: u64) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the finalization state
        let state = self.states.get_mut(&checkpoint_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the checkpoint is in the InChallengePeriod stage
        if state.stage != FinalizationStage::InChallengePeriod {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if the checkpoint is challenged
        if state.is_challenged {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if the challenge period has ended
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        if let Some(end_timestamp) = state.challenge_period_end_timestamp {
            if current_timestamp < end_timestamp {
                return Err(ProgramError::InvalidArgument);
            }
        } else {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Finalize the checkpoint
        state.stage = FinalizationStage::Finalized;
        
        msg!("Checkpoint finalized: {}", checkpoint_id);
        
        Ok(())
    }
    
    /// Force finalization of a checkpoint
    pub fn force_finalization(&mut self, checkpoint_id: u64) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if forced finalization is enabled
        if !self.config.enable_forced_finalization {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Get the finalization state
        let state = self.states.get_mut(&checkpoint_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the checkpoint is in the Proposed or InChallengePeriod stage
        if state.stage != FinalizationStage::Proposed && state.stage != FinalizationStage::InChallengePeriod {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if the forced finalization timeout has passed
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        if current_timestamp < state.stage_start_timestamp + self.config.forced_finalization_timeout {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Force finalize the checkpoint
        state.stage = FinalizationStage::ForcedFinalized;
        
        msg!("Checkpoint force finalized: {}", checkpoint_id);
        
        Ok(())
    }
    
    /// Check for expired challenge periods
    pub fn check_expired_challenge_periods(&mut self) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        for (checkpoint_id, state) in self.states.iter_mut() {
            // Skip checkpoints that are not in the InChallengePeriod stage
            if state.stage != FinalizationStage::InChallengePeriod {
                continue;
            }
            
            // Skip challenged checkpoints
            if state.is_challenged {
                continue;
            }
            
            // Check if the challenge period has ended
            if let Some(end_timestamp) = state.challenge_period_end_timestamp {
                if current_timestamp >= end_timestamp {
                    // Challenge period has ended, finalize the checkpoint
                    state.stage = FinalizationStage::Finalized;
                    
                    msg!("Checkpoint automatically finalized after challenge period: {}", checkpoint_id);
                }
            }
        }
        
        Ok(())
    }
    
    /// Get the finalization stage of a checkpoint
    pub fn get_stage(&self, checkpoint_id: u64) -> Result<FinalizationStage, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the finalization state
        let state = self.states.get(&checkpoint_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        Ok(state.stage.clone())
    }
    
    /// Get the finalization state of a checkpoint
    pub fn get_state(&self, checkpoint_id: u64) -> Result<&FinalizationState, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the finalization state
        let state = self.states.get(&checkpoint_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        Ok(state)
    }
    
    /// Update the finalization protocol configuration
    pub fn update_config(&mut self, config: FinalizationConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the configuration
        self.config = config;
        
        msg!("Finalization protocol configuration updated");
        
        Ok(())
    }
    
    /// Get all finalization states
    pub fn get_all_states(&self) -> &HashMap<u64, FinalizationState> {
        &self.states
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_finalization_protocol_creation() {
        let protocol = FinalizationProtocol::new();
        assert!(!protocol.is_initialized());
    }
    
    #[test]
    fn test_finalization_protocol_with_config() {
        let config = FinalizationConfig::default();
        let protocol = FinalizationProtocol::with_config(config);
        assert!(!protocol.is_initialized());
    }
}
