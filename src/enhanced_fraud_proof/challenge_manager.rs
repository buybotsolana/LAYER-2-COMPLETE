// src/enhanced_fraud_proof/challenge_manager.rs
//! Challenge Manager module for Enhanced Fraud Proof System
//! 
//! This module manages challenges in the fraud proof system:
//! - Challenge creation and tracking
//! - Challenge status management
//! - Challenge resolution and finalization
//! - Challenge history and analytics
//!
//! The challenge manager coordinates the entire fraud proof process,
//! from submission to resolution.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;

use super::EnhancedFraudProofConfig;

/// Challenge status
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChallengeStatus {
    /// Challenge is active
    Active,
    
    /// Challenge is successful
    Successful,
    
    /// Challenge has failed
    Failed,
    
    /// Challenge has been withdrawn
    Withdrawn,
    
    /// Challenge has expired
    Expired,
}

/// Challenge
#[derive(Debug, Clone)]
pub struct Challenge {
    /// Challenge ID
    pub id: u64,
    
    /// Challenger public key
    pub challenger: Pubkey,
    
    /// Block hash being challenged
    pub block_hash: [u8; 32],
    
    /// Pre-state root
    pub pre_state_root: [u8; 32],
    
    /// Post-state root
    pub post_state_root: [u8; 32],
    
    /// Bond amount
    pub bond_amount: u64,
    
    /// Challenge status
    pub status: ChallengeStatus,
    
    /// Creation timestamp
    pub creation_timestamp: u64,
    
    /// Resolution timestamp
    pub resolution_timestamp: Option<u64>,
    
    /// Resolution reason
    pub resolution_reason: Option<String>,
}

/// Challenge manager for the enhanced fraud proof system
pub struct ChallengeManager {
    /// Challenge manager configuration
    config: EnhancedFraudProofConfig,
    
    /// Challenges by ID
    challenges: HashMap<u64, Challenge>,
    
    /// Next challenge ID
    next_challenge_id: u64,
    
    /// Whether the challenge manager is initialized
    initialized: bool,
}

impl ChallengeManager {
    /// Create a new challenge manager with default configuration
    pub fn new() -> Self {
        Self {
            config: EnhancedFraudProofConfig::default(),
            challenges: HashMap::new(),
            next_challenge_id: 1,
            initialized: false,
        }
    }
    
    /// Create a new challenge manager with the specified configuration
    pub fn with_config(config: EnhancedFraudProofConfig) -> Self {
        Self {
            config,
            challenges: HashMap::new(),
            next_challenge_id: 1,
            initialized: false,
        }
    }
    
    /// Initialize the challenge manager
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        self.initialized = true;
        
        msg!("Challenge manager initialized");
        
        Ok(())
    }
    
    /// Check if the challenge manager is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Create a challenge
    pub fn create_challenge(
        &mut self,
        challenger: Pubkey,
        block_hash: [u8; 32],
        pre_state_root: [u8; 32],
        post_state_root: [u8; 32],
        bond_amount: u64,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the bond amount is sufficient
        if bond_amount < self.config.min_challenge_bond {
            return Err(ProgramError::InsufficientFunds);
        }
        
        // Check if the maximum number of concurrent challenges is reached
        if self.get_active_challenges().len() >= self.config.max_concurrent_challenges as usize {
            return Err(ProgramError::MaxAccountsDataSizeExceeded);
        }
        
        // Create the challenge
        let challenge_id = self.next_challenge_id;
        self.next_challenge_id += 1;
        
        let challenge = Challenge {
            id: challenge_id,
            challenger,
            block_hash,
            pre_state_root,
            post_state_root,
            bond_amount,
            status: ChallengeStatus::Active,
            creation_timestamp: 0, // In a real implementation, we would use the current timestamp
            resolution_timestamp: None,
            resolution_reason: None,
        };
        
        // Add the challenge
        self.challenges.insert(challenge_id, challenge);
        
        msg!("Challenge created: {}", challenge_id);
        
        Ok(challenge_id)
    }
    
    /// Get a challenge
    pub fn get_challenge(&self, challenge_id: u64) -> Option<&Challenge> {
        if !self.initialized {
            return None;
        }
        
        self.challenges.get(&challenge_id)
    }
    
    /// Get active challenges
    pub fn get_active_challenges(&self) -> Vec<&Challenge> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.challenges.values()
            .filter(|challenge| challenge.status == ChallengeStatus::Active)
            .collect()
    }
    
    /// Finalize a challenge
    pub fn finalize_challenge(
        &mut self,
        challenge_id: u64,
        status: ChallengeStatus,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the challenge
        let challenge = self.challenges.get_mut(&challenge_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the challenge is active
        if challenge.status != ChallengeStatus::Active {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Update the challenge status
        challenge.status = status;
        challenge.resolution_timestamp = Some(0); // In a real implementation, we would use the current timestamp
        
        // Set the resolution reason
        let reason = match status {
            ChallengeStatus::Successful => "Challenge successful",
            ChallengeStatus::Failed => "Challenge failed",
            ChallengeStatus::Withdrawn => "Challenge withdrawn",
            ChallengeStatus::Expired => "Challenge expired",
            _ => "Unknown",
        };
        
        challenge.resolution_reason = Some(reason.to_string());
        
        msg!("Challenge finalized: {}, status: {:?}", challenge_id, status);
        
        Ok(())
    }
    
    /// Withdraw a challenge
    pub fn withdraw_challenge(&mut self, challenge_id: u64, challenger: &Pubkey) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the challenge
        let challenge = self.challenges.get_mut(&challenge_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the challenge is active
        if challenge.status != ChallengeStatus::Active {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if the caller is the challenger
        if challenge.challenger != *challenger {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Update the challenge status
        challenge.status = ChallengeStatus::Withdrawn;
        challenge.resolution_timestamp = Some(0); // In a real implementation, we would use the current timestamp
        challenge.resolution_reason = Some("Challenge withdrawn by challenger".to_string());
        
        msg!("Challenge withdrawn: {}", challenge_id);
        
        Ok(())
    }
    
    /// Check for expired challenges
    pub fn check_expired_challenges(&mut self, current_timestamp: u64) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        for (challenge_id, challenge) in self.challenges.iter_mut() {
            // Skip non-active challenges
            if challenge.status != ChallengeStatus::Active {
                continue;
            }
            
            // Check if the challenge has expired
            if current_timestamp > challenge.creation_timestamp + self.config.max_challenge_period {
                // Challenge has expired
                challenge.status = ChallengeStatus::Expired;
                challenge.resolution_timestamp = Some(current_timestamp);
                challenge.resolution_reason = Some("Challenge expired".to_string());
                
                msg!("Challenge expired: {}", challenge_id);
            }
        }
        
        Ok(())
    }
    
    /// Get challenge statistics
    pub fn get_statistics(&self) -> (usize, usize, usize, usize, usize) {
        if !self.initialized {
            return (0, 0, 0, 0, 0);
        }
        
        let total = self.challenges.len();
        let active = self.challenges.values()
            .filter(|challenge| challenge.status == ChallengeStatus::Active)
            .count();
        let successful = self.challenges.values()
            .filter(|challenge| challenge.status == ChallengeStatus::Successful)
            .count();
        let failed = self.challenges.values()
            .filter(|challenge| challenge.status == ChallengeStatus::Failed)
            .count();
        let other = total - active - successful - failed;
        
        (total, active, successful, failed, other)
    }
    
    /// Update the challenge manager configuration
    pub fn update_config(&mut self, config: EnhancedFraudProofConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the configuration
        self.config = config;
        
        msg!("Challenge manager configuration updated");
        
        Ok(())
    }
    
    /// Get all challenges
    pub fn get_all_challenges(&self) -> &HashMap<u64, Challenge> {
        &self.challenges
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_challenge_manager_creation() {
        let manager = ChallengeManager::new();
        assert!(!manager.is_initialized());
    }
    
    #[test]
    fn test_challenge_manager_with_config() {
        let config = EnhancedFraudProofConfig::default();
        let manager = ChallengeManager::with_config(config);
        assert!(!manager.is_initialized());
    }
}
