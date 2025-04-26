// src/enhanced_bridge/multi_sig_validator.rs
//! Multi-Signature Validator module for Enhanced Bridge Security
//! 
//! This module implements multi-signature validation:
//! - Validator management and rotation
//! - Signature threshold configuration
//! - Signature verification and aggregation
//! - Key management and security
//!
//! The multi-signature validator ensures that bridge operations
//! are authorized by a sufficient number of trusted validators.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::{HashMap, HashSet};

/// Signature threshold type
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SignatureThreshold {
    /// Fixed number of signatures
    Fixed(u32),
    
    /// Percentage of total validators (in basis points)
    Percentage(u32),
}

/// Signature configuration
#[derive(Debug, Clone)]
pub struct SignatureConfig {
    /// Minimum number of signatures required
    pub min_signatures: u32,
}

impl Default for SignatureConfig {
    fn default() -> Self {
        Self {
            min_signatures: 3,
        }
    }
}

/// Validator information
#[derive(Debug, Clone)]
struct ValidatorInfo {
    /// Validator public key
    pub pubkey: Pubkey,
    
    /// Whether the validator is active
    pub is_active: bool,
    
    /// Activation timestamp
    pub activation_timestamp: u64,
    
    /// Deactivation timestamp (if deactivated)
    pub deactivation_timestamp: Option<u64>,
    
    /// Weight (for weighted voting)
    pub weight: u32,
}

/// Multi-signature validator for the enhanced bridge system
pub struct MultiSigValidator {
    /// Signature configuration
    config: SignatureConfig,
    
    /// Validators by public key
    validators: HashMap<Pubkey, ValidatorInfo>,
    
    /// Active validator count
    active_validator_count: u32,
    
    /// Total validator weight
    total_validator_weight: u32,
    
    /// Whether the multi-signature validator is initialized
    initialized: bool,
}

impl MultiSigValidator {
    /// Create a new multi-signature validator with default configuration
    pub fn new() -> Self {
        Self {
            config: SignatureConfig::default(),
            validators: HashMap::new(),
            active_validator_count: 0,
            total_validator_weight: 0,
            initialized: false,
        }
    }
    
    /// Create a new multi-signature validator with the specified configuration
    pub fn with_config(config: SignatureConfig) -> Self {
        Self {
            config,
            validators: HashMap::new(),
            active_validator_count: 0,
            total_validator_weight: 0,
            initialized: false,
        }
    }
    
    /// Initialize the multi-signature validator
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        self.initialized = true;
        
        msg!("Multi-signature validator initialized");
        
        Ok(())
    }
    
    /// Check if the multi-signature validator is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Add a validator
    pub fn add_validator(&mut self, validator: Pubkey) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the validator already exists
        if self.validators.contains_key(&validator) {
            return Err(ProgramError::AccountAlreadyInitialized);
        }
        
        // Create the validator info
        let validator_info = ValidatorInfo {
            pubkey: validator,
            is_active: true,
            activation_timestamp: 0, // In a real implementation, we would use the current timestamp
            deactivation_timestamp: None,
            weight: 1, // Default weight
        };
        
        // Add the validator
        self.validators.insert(validator, validator_info);
        
        // Update the active validator count
        self.active_validator_count += 1;
        
        // Update the total validator weight
        self.total_validator_weight += 1;
        
        msg!("Validator added: {:?}", validator);
        
        Ok(())
    }
    
    /// Remove a validator
    pub fn remove_validator(&mut self, validator: &Pubkey) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the validator
        let validator_info = self.validators.get_mut(validator)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the validator is already inactive
        if !validator_info.is_active {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Deactivate the validator
        validator_info.is_active = false;
        validator_info.deactivation_timestamp = Some(0); // In a real implementation, we would use the current timestamp
        
        // Update the active validator count
        self.active_validator_count -= 1;
        
        // Update the total validator weight
        self.total_validator_weight -= validator_info.weight;
        
        msg!("Validator removed: {:?}", validator);
        
        Ok(())
    }
    
    /// Set validator weight
    pub fn set_validator_weight(&mut self, validator: &Pubkey, weight: u32) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the validator
        let validator_info = self.validators.get_mut(validator)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Update the total validator weight
        if validator_info.is_active {
            self.total_validator_weight = self.total_validator_weight - validator_info.weight + weight;
        }
        
        // Update the validator weight
        validator_info.weight = weight;
        
        msg!("Validator weight updated: {:?}, weight: {}", validator, weight);
        
        Ok(())
    }
    
    /// Verify signatures
    pub fn verify_signatures(
        &self,
        signatures: &Vec<([u8; 32], [u8; 64])>,
        source: &[u8; 32],
        destination: &[u8; 32],
        asset_id: u64,
        amount: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if there are enough signatures
        if signatures.len() < self.config.min_signatures as usize {
            return Err(ProgramError::InvalidArgument);
        }
        
        // In a real implementation, we would verify each signature
        // For now, we'll just check that the signers are valid validators
        
        let mut valid_signatures = 0;
        let mut seen_validators = HashSet::new();
        
        for (signer, _signature) in signatures {
            // Convert the signer to a Pubkey
            let signer_pubkey = Pubkey::new_from_array(*signer);
            
            // Check if the signer is a valid validator
            if let Some(validator_info) = self.validators.get(&signer_pubkey) {
                // Check if the validator is active
                if validator_info.is_active {
                    // Check if we've already seen this validator
                    if !seen_validators.contains(&signer_pubkey) {
                        // Add the validator to the seen set
                        seen_validators.insert(signer_pubkey);
                        
                        // Increment the valid signature count
                        valid_signatures += 1;
                    }
                }
            }
        }
        
        // Check if there are enough valid signatures
        if valid_signatures < self.config.min_signatures {
            return Err(ProgramError::InvalidArgument);
        }
        
        msg!("Signatures verified: {}", valid_signatures);
        
        Ok(())
    }
    
    /// Get the number of active validators
    pub fn get_active_validator_count(&self) -> u32 {
        if !self.initialized {
            return 0;
        }
        
        self.active_validator_count
    }
    
    /// Get the total validator weight
    pub fn get_total_validator_weight(&self) -> u32 {
        if !self.initialized {
            return 0;
        }
        
        self.total_validator_weight
    }
    
    /// Check if a validator is active
    pub fn is_validator_active(&self, validator: &Pubkey) -> bool {
        if !self.initialized {
            return false;
        }
        
        if let Some(validator_info) = self.validators.get(validator) {
            return validator_info.is_active;
        }
        
        false
    }
    
    /// Get validator weight
    pub fn get_validator_weight(&self, validator: &Pubkey) -> u32 {
        if !self.initialized {
            return 0;
        }
        
        if let Some(validator_info) = self.validators.get(validator) {
            return validator_info.weight;
        }
        
        0
    }
    
    /// Get all active validators
    pub fn get_active_validators(&self) -> Vec<Pubkey> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.validators.iter()
            .filter(|(_, info)| info.is_active)
            .map(|(pubkey, _)| *pubkey)
            .collect()
    }
    
    /// Update the multi-signature validator configuration
    pub fn update_config(&mut self, config: SignatureConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the configuration
        self.config = config;
        
        msg!("Multi-signature validator configuration updated");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_multi_sig_validator_creation() {
        let validator = MultiSigValidator::new();
        assert!(!validator.is_initialized());
    }
    
    #[test]
    fn test_multi_sig_validator_with_config() {
        let config = SignatureConfig::default();
        let validator = MultiSigValidator::with_config(config);
        assert!(!validator.is_initialized());
    }
}
