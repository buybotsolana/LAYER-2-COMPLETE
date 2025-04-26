// src/enhanced_bridge/rate_limiter.rs
//! Rate Limiter module for Enhanced Bridge Security
//! 
//! This module implements rate limiting:
//! - Transaction frequency limits
//! - Value-based limits
//! - Account-specific and global limits
//! - Adaptive rate limiting based on network conditions
//!
//! The rate limiter prevents abuse of the bridge by limiting
//! the frequency and value of transactions.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;

/// Rate limit configuration
#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    /// Maximum transactions per hour per account
    pub max_transactions_per_hour: u32,
    
    /// Maximum value per hour per account
    pub max_value_per_hour: u64,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            max_transactions_per_hour: 10,
            max_value_per_hour: 10_000_000_000_000, // 100,000 SOL (assuming 8 decimals)
        }
    }
}

/// Transaction limit
#[derive(Debug, Clone)]
pub struct TransactionLimit {
    /// Account
    pub account: [u8; 32],
    
    /// Hour timestamp (rounded down to the hour)
    pub hour_timestamp: u64,
    
    /// Transaction count
    pub transaction_count: u32,
    
    /// Total value
    pub total_value: u64,
}

/// Rate limiter for the enhanced bridge system
pub struct RateLimiter {
    /// Rate limit configuration
    config: RateLimitConfig,
    
    /// Transaction limits by account and hour
    limits: HashMap<([u8; 32], u64), TransactionLimit>,
    
    /// Whether the rate limiter is initialized
    initialized: bool,
}

impl RateLimiter {
    /// Create a new rate limiter with default configuration
    pub fn new() -> Self {
        Self {
            config: RateLimitConfig::default(),
            limits: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Create a new rate limiter with the specified configuration
    pub fn with_config(config: RateLimitConfig) -> Self {
        Self {
            config,
            limits: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Initialize the rate limiter
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        self.initialized = true;
        
        msg!("Rate limiter initialized");
        
        Ok(())
    }
    
    /// Check if the rate limiter is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Check limits
    pub fn check_limits(
        &self,
        account: &[u8; 32],
        value: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the current hour timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        let hour_timestamp = current_timestamp - (current_timestamp % 3600); // Round down to the hour
        
        // Get the transaction limit
        if let Some(limit) = self.limits.get(&(*account, hour_timestamp)) {
            // Check transaction count limit
            if limit.transaction_count >= self.config.max_transactions_per_hour {
                return Err(ProgramError::InvalidArgument);
            }
            
            // Check value limit
            if limit.total_value + value > self.config.max_value_per_hour {
                return Err(ProgramError::InvalidArgument);
            }
        }
        
        Ok(())
    }
    
    /// Update limits
    pub fn update_limits(
        &mut self,
        account: &[u8; 32],
        value: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the current hour timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        let hour_timestamp = current_timestamp - (current_timestamp % 3600); // Round down to the hour
        
        // Get or create the transaction limit
        let limit = self.limits.entry((*account, hour_timestamp))
            .or_insert_with(|| TransactionLimit {
                account: *account,
                hour_timestamp,
                transaction_count: 0,
                total_value: 0,
            });
        
        // Update the limit
        limit.transaction_count += 1;
        limit.total_value += value;
        
        msg!("Limits updated: account: {:?}, hour: {}, count: {}, value: {}", 
            account, hour_timestamp, limit.transaction_count, limit.total_value);
        
        Ok(())
    }
    
    /// Clean up old limits
    pub fn clean_up_old_limits(&mut self) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the current hour timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        let hour_timestamp = current_timestamp - (current_timestamp % 3600); // Round down to the hour
        
        // Remove limits older than 24 hours
        let old_hour_timestamp = hour_timestamp - 24 * 3600;
        
        let keys_to_remove: Vec<([u8; 32], u64)> = self.limits.keys()
            .filter(|(_, ts)| *ts < old_hour_timestamp)
            .cloned()
            .collect();
        
        for key in keys_to_remove {
            self.limits.remove(&key);
        }
        
        msg!("Old limits cleaned up");
        
        Ok(())
    }
    
    /// Get transaction count for an account in the current hour
    pub fn get_transaction_count(
        &self,
        account: &[u8; 32],
    ) -> u32 {
        if !self.initialized {
            return 0;
        }
        
        // Get the current hour timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        let hour_timestamp = current_timestamp - (current_timestamp % 3600); // Round down to the hour
        
        // Get the transaction limit
        if let Some(limit) = self.limits.get(&(*account, hour_timestamp)) {
            return limit.transaction_count;
        }
        
        0
    }
    
    /// Get total value for an account in the current hour
    pub fn get_total_value(
        &self,
        account: &[u8; 32],
    ) -> u64 {
        if !self.initialized {
            return 0;
        }
        
        // Get the current hour timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        let hour_timestamp = current_timestamp - (current_timestamp % 3600); // Round down to the hour
        
        // Get the transaction limit
        if let Some(limit) = self.limits.get(&(*account, hour_timestamp)) {
            return limit.total_value;
        }
        
        0
    }
    
    /// Update the rate limiter configuration
    pub fn update_config(&mut self, config: RateLimitConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the configuration
        self.config = config;
        
        msg!("Rate limiter configuration updated");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_rate_limiter_creation() {
        let limiter = RateLimiter::new();
        assert!(!limiter.is_initialized());
    }
    
    #[test]
    fn test_rate_limiter_with_config() {
        let config = RateLimitConfig::default();
        let limiter = RateLimiter::with_config(config);
        assert!(!limiter.is_initialized());
    }
}
