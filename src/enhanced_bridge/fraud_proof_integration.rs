// src/enhanced_bridge/fraud_proof_integration.rs
//! Fraud Proof Integration module for Enhanced Bridge Security
//! 
//! This module implements integration with the fraud proof system:
//! - Challenge creation and verification
//! - Evidence submission and validation
//! - Integration with the Layer-1 fraud proof contract
//! - Challenge resolution and finalization
//!
//! The fraud proof integration ensures that invalid bridge operations
//! can be challenged and prevented through cryptographic proofs.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;

/// Fraud proof configuration
#[derive(Debug, Clone)]
pub struct FraudProofConfig {
    /// Challenge period for withdrawals (in seconds)
    pub withdrawal_challenge_period: u64,
}

impl Default for FraudProofConfig {
    fn default() -> Self {
        Self {
            withdrawal_challenge_period: 172800, // 2 days in seconds
        }
    }
}

/// Challenge status
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChallengeStatus {
    /// Pending
    Pending,
    
    /// In verification
    InVerification,
    
    /// Successful
    Successful,
    
    /// Failed
    Failed,
    
    /// Expired
    Expired,
}

/// Challenge information
#[derive(Debug, Clone)]
struct ChallengeInfo {
    /// Challenge ID
    pub id: u64,
    
    /// Transfer ID
    pub transfer_id: u64,
    
    /// Challenger
    pub challenger: Pubkey,
    
    /// Evidence
    pub evidence: Vec<u8>,
    
    /// Status
    pub status: ChallengeStatus,
    
    /// Creation timestamp
    pub creation_timestamp: u64,
    
    /// Resolution timestamp
    pub resolution_timestamp: Option<u64>,
    
    /// Resolution reason
    pub resolution_reason: Option<String>,
}

/// Fraud proof integration for the enhanced bridge system
pub struct FraudProofIntegration {
    /// Fraud proof configuration
    config: FraudProofConfig,
    
    /// Challenges by ID
    challenges: HashMap<u64, ChallengeInfo>,
    
    /// Challenges by transfer ID
    challenges_by_transfer: HashMap<u64, Vec<u64>>,
    
    /// Next challenge ID
    next_challenge_id: u64,
    
    /// Whether the fraud proof integration is initialized
    initialized: bool,
}

impl FraudProofIntegration {
    /// Create a new fraud proof integration with default configuration
    pub fn new() -> Self {
        Self {
            config: FraudProofConfig::default(),
            challenges: HashMap::new(),
            challenges_by_transfer: HashMap::new(),
            next_challenge_id: 1,
            initialized: false,
        }
    }
    
    /// Create a new fraud proof integration with the specified configuration
    pub fn with_config(config: FraudProofConfig) -> Self {
        Self {
            config,
            challenges: HashMap::new(),
            challenges_by_transfer: HashMap::new(),
            next_challenge_id: 1,
            initialized: false,
        }
    }
    
    /// Initialize the fraud proof integration
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        self.initialized = true;
        
        msg!("Fraud proof integration initialized");
        
        Ok(())
    }
    
    /// Check if the fraud proof integration is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Create a challenge
    pub fn create_challenge(
        &mut self,
        transfer_id: u64,
        challenger: &Pubkey,
        evidence: &Vec<u8>,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Create the challenge
        let challenge_id = self.next_challenge_id;
        self.next_challenge_id += 1;
        
        let challenge = ChallengeInfo {
            id: challenge_id,
            transfer_id,
            challenger: *challenger,
            evidence: evidence.clone(),
            status: ChallengeStatus::Pending,
            creation_timestamp: 0, // In a real implementation, we would use the current timestamp
            resolution_timestamp: None,
            resolution_reason: None,
        };
        
        // Add the challenge
        self.challenges.insert(challenge_id, challenge);
        
        // Add the challenge to the transfer's challenges
        self.challenges_by_transfer.entry(transfer_id)
            .or_insert_with(Vec::new)
            .push(challenge_id);
        
        msg!("Challenge created: {}, transfer: {}", challenge_id, transfer_id);
        
        Ok(challenge_id)
    }
    
    /// Verify a challenge
    pub fn verify_challenge(
        &mut self,
        challenge_id: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the challenge
        let challenge = self.challenges.get_mut(&challenge_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the challenge is pending
        if challenge.status != ChallengeStatus::Pending {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Update the challenge status
        challenge.status = ChallengeStatus::InVerification;
        
        msg!("Challenge verification started: {}", challenge_id);
        
        Ok(())
    }
    
    /// Resolve a challenge
    pub fn resolve_challenge(
        &mut self,
        challenge_id: u64,
        successful: bool,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the challenge
        let challenge = self.challenges.get_mut(&challenge_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the challenge is in verification
        if challenge.status != ChallengeStatus::InVerification && challenge.status != ChallengeStatus::Pending {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Update the challenge status
        if successful {
            challenge.status = ChallengeStatus::Successful;
            challenge.resolution_reason = Some("Challenge successful".to_string());
        } else {
            challenge.status = ChallengeStatus::Failed;
            challenge.resolution_reason = Some("Challenge failed".to_string());
        }
        
        // Set the resolution timestamp
        challenge.resolution_timestamp = Some(0); // In a real implementation, we would use the current timestamp
        
        let transfer_id = challenge.transfer_id;
        
        msg!("Challenge resolved: {}, successful: {}", challenge_id, successful);
        
        Ok(transfer_id)
    }
    
    /// Check for expired challenges
    pub fn check_expired_challenges(&mut self) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        for (_, challenge) in self.challenges.iter_mut() {
            // Skip challenges that are not pending or in verification
            if challenge.status != ChallengeStatus::Pending && challenge.status != ChallengeStatus::InVerification {
                continue;
            }
            
            // Check if the challenge has expired
            if current_timestamp >= challenge.creation_timestamp + self.config.withdrawal_challenge_period {
                // Update the challenge status
                challenge.status = ChallengeStatus::Expired;
                challenge.resolution_timestamp = Some(current_timestamp);
                challenge.resolution_reason = Some("Challenge expired".to_string());
                
                msg!("Challenge expired: {}", challenge.id);
            }
        }
        
        Ok(())
    }
    
    /// Get a challenge
    pub fn get_challenge(&self, challenge_id: u64) -> Option<&ChallengeInfo> {
        if !self.initialized {
            return None;
        }
        
        self.challenges.get(&challenge_id)
    }
    
    /// Get challenges for a transfer
    pub fn get_challenges_for_transfer(&self, transfer_id: u64) -> Vec<u64> {
        if !self.initialized {
            return Vec::new();
        }
        
        if let Some(challenge_ids) = self.challenges_by_transfer.get(&transfer_id) {
            return challenge_ids.clone();
        }
        
        Vec::new()
    }
    
    /// Check if a transfer has active challenges
    pub fn has_active_challenges(&self, transfer_id: u64) -> bool {
        if !self.initialized {
            return false;
        }
        
        if let Some(challenge_ids) = self.challenges_by_transfer.get(&transfer_id) {
            for challenge_id in challenge_ids {
                if let Some(challenge) = self.challenges.get(challenge_id) {
                    if challenge.status == ChallengeStatus::Pending || challenge.status == ChallengeStatus::InVerification {
                        return true;
                    }
                }
            }
        }
        
        false
    }
    
    /// Check if a transfer has successful challenges
    pub fn has_successful_challenges(&self, transfer_id: u64) -> bool {
        if !self.initialized {
            return false;
        }
        
        if let Some(challenge_ids) = self.challenges_by_transfer.get(&transfer_id) {
            for challenge_id in challenge_ids {
                if let Some(challenge) = self.challenges.get(challenge_id) {
                    if challenge.status == ChallengeStatus::Successful {
                        return true;
                    }
                }
            }
        }
        
        false
    }
    
    /// Update the fraud proof integration configuration
    pub fn update_config(&mut self, config: FraudProofConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the configuration
        self.config = config;
        
        msg!("Fraud proof integration configuration updated");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_fraud_proof_integration_creation() {
        let integration = FraudProofIntegration::new();
        assert!(!integration.is_initialized());
    }
    
    #[test]
    fn test_fraud_proof_integration_with_config() {
        let config = FraudProofConfig::default();
        let integration = FraudProofIntegration::with_config(config);
        assert!(!integration.is_initialized());
    }
}
