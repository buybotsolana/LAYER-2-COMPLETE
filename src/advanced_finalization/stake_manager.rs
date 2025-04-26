// src/advanced_finalization/stake_manager.rs
//! Stake Manager module for Advanced Finalization System
//! 
//! This module implements stake management:
//! - Validator stake tracking and verification
//! - Stake delegation and withdrawal
//! - Stake slashing for malicious behavior
//! - Stake-based voting power calculation
//!
//! The stake manager ensures that finalization voting is properly
//! weighted according to validators' economic stake in the system.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;

/// Stake configuration
#[derive(Debug, Clone)]
pub struct StakeConfig {
    /// Minimum stake required for finalization voting (in tokens)
    pub min_finalization_stake: u64,
}

impl Default for StakeConfig {
    fn default() -> Self {
        Self {
            min_finalization_stake: 100_000_000_000, // 1,000 SOL (assuming 8 decimals)
        }
    }
}

/// Stake information
#[derive(Debug, Clone)]
pub struct StakeInfo {
    /// Validator public key
    pub validator: Pubkey,
    
    /// Stake amount
    pub amount: u64,
    
    /// Locked until timestamp
    pub locked_until: u64,
    
    /// Whether the stake is active
    pub is_active: bool,
    
    /// Stake activation timestamp
    pub activation_timestamp: u64,
    
    /// Last vote timestamp
    pub last_vote_timestamp: Option<u64>,
}

/// Stake manager for the advanced finalization system
pub struct StakeManager {
    /// Stake configuration
    config: StakeConfig,
    
    /// Stakes by validator
    stakes: HashMap<Pubkey, StakeInfo>,
    
    /// Total active stake
    total_active_stake: u64,
    
    /// Whether the stake manager is initialized
    initialized: bool,
}

impl StakeManager {
    /// Create a new stake manager with default configuration
    pub fn new() -> Self {
        Self {
            config: StakeConfig::default(),
            stakes: HashMap::new(),
            total_active_stake: 0,
            initialized: false,
        }
    }
    
    /// Create a new stake manager with the specified configuration
    pub fn with_config(config: StakeConfig) -> Self {
        Self {
            config,
            stakes: HashMap::new(),
            total_active_stake: 0,
            initialized: false,
        }
    }
    
    /// Initialize the stake manager
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        self.initialized = true;
        
        msg!("Stake manager initialized");
        
        Ok(())
    }
    
    /// Check if the stake manager is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Stake tokens
    pub fn stake(
        &mut self,
        validator: &Pubkey,
        amount: u64,
        lock_duration: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the amount is sufficient
        if amount < self.config.min_finalization_stake {
            return Err(ProgramError::InsufficientFunds);
        }
        
        // Calculate the lock timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        let locked_until = current_timestamp + lock_duration;
        
        // Check if the validator already has a stake
        if let Some(stake_info) = self.stakes.get_mut(validator) {
            // Update the stake
            stake_info.amount += amount;
            stake_info.locked_until = locked_until.max(stake_info.locked_until);
            
            // If the stake was not active, activate it
            if !stake_info.is_active {
                stake_info.is_active = true;
                stake_info.activation_timestamp = current_timestamp;
                
                // Update the total active stake
                self.total_active_stake += stake_info.amount;
            } else {
                // Update the total active stake
                self.total_active_stake += amount;
            }
        } else {
            // Create a new stake
            let stake_info = StakeInfo {
                validator: *validator,
                amount,
                locked_until,
                is_active: true,
                activation_timestamp: current_timestamp,
                last_vote_timestamp: None,
            };
            
            // Add the stake
            self.stakes.insert(*validator, stake_info);
            
            // Update the total active stake
            self.total_active_stake += amount;
        }
        
        msg!("Stake added: validator: {:?}, amount: {}, locked until: {}", 
            validator, amount, locked_until);
        
        Ok(())
    }
    
    /// Unstake tokens
    pub fn unstake(
        &mut self,
        validator: &Pubkey,
        amount: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the stake
        let stake_info = self.stakes.get_mut(validator)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the stake is locked
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        if current_timestamp < stake_info.locked_until {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if the amount is valid
        if amount > stake_info.amount {
            return Err(ProgramError::InsufficientFunds);
        }
        
        // Update the stake
        stake_info.amount -= amount;
        
        // Update the total active stake
        self.total_active_stake -= amount;
        
        // If the stake is now below the minimum, deactivate it
        if stake_info.amount < self.config.min_finalization_stake {
            stake_info.is_active = false;
            
            // Update the total active stake
            self.total_active_stake -= stake_info.amount;
        }
        
        msg!("Stake removed: validator: {:?}, amount: {}", validator, amount);
        
        Ok(())
    }
    
    /// Slash stake
    pub fn slash(
        &mut self,
        validator: &Pubkey,
        amount: u64,
        reason: &str,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the stake
        let stake_info = self.stakes.get_mut(validator)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the amount is valid
        if amount > stake_info.amount {
            return Err(ProgramError::InsufficientFunds);
        }
        
        // Update the stake
        stake_info.amount -= amount;
        
        // Update the total active stake
        if stake_info.is_active {
            self.total_active_stake -= amount;
        }
        
        // If the stake is now below the minimum, deactivate it
        if stake_info.amount < self.config.min_finalization_stake && stake_info.is_active {
            stake_info.is_active = false;
            
            // Update the total active stake
            self.total_active_stake -= stake_info.amount;
        }
        
        msg!("Stake slashed: validator: {:?}, amount: {}, reason: {}", 
            validator, amount, reason);
        
        Ok(())
    }
    
    /// Record a vote
    pub fn record_vote(
        &mut self,
        validator: &Pubkey,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the stake
        let stake_info = self.stakes.get_mut(validator)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the stake is active
        if !stake_info.is_active {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Update the last vote timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        stake_info.last_vote_timestamp = Some(current_timestamp);
        
        msg!("Vote recorded: validator: {:?}", validator);
        
        Ok(())
    }
    
    /// Get the stake for a validator
    pub fn get_stake(&self, validator: &Pubkey) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the stake
        if let Some(stake_info) = self.stakes.get(validator) {
            if stake_info.is_active {
                return Ok(stake_info.amount);
            }
        }
        
        Ok(0)
    }
    
    /// Get the total active stake
    pub fn get_total_active_stake(&self) -> u64 {
        if !self.initialized {
            return 0;
        }
        
        self.total_active_stake
    }
    
    /// Check if a validator has sufficient stake
    pub fn has_sufficient_stake(&self, validator: &Pubkey) -> bool {
        if !self.initialized {
            return false;
        }
        
        // Get the stake
        if let Some(stake_info) = self.stakes.get(validator) {
            if stake_info.is_active && stake_info.amount >= self.config.min_finalization_stake {
                return true;
            }
        }
        
        false
    }
    
    /// Get all active validators
    pub fn get_active_validators(&self) -> Vec<Pubkey> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.stakes.iter()
            .filter(|(_, stake_info)| stake_info.is_active)
            .map(|(validator, _)| *validator)
            .collect()
    }
    
    /// Update the stake manager configuration
    pub fn update_config(&mut self, config: StakeConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the configuration
        self.config = config;
        
        msg!("Stake manager configuration updated");
        
        Ok(())
    }
    
    /// Get all stakes
    pub fn get_all_stakes(&self) -> &HashMap<Pubkey, StakeInfo> {
        &self.stakes
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_stake_manager_creation() {
        let manager = StakeManager::new();
        assert!(!manager.is_initialized());
    }
    
    #[test]
    fn test_stake_manager_with_config() {
        let config = StakeConfig::default();
        let manager = StakeManager::with_config(config);
        assert!(!manager.is_initialized());
    }
}
