// src/enhanced_bridge/delayed_withdrawals.rs
//! Delayed Withdrawals module for Enhanced Bridge Security
//! 
//! This module implements delayed withdrawals:
//! - Withdrawal queueing and scheduling
//! - Challenge period management
//! - Withdrawal finalization and execution
//! - Withdrawal status tracking
//!
//! The delayed withdrawals system adds a security layer by introducing
//! a waiting period during which withdrawals can be challenged.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;

/// Withdrawal configuration
#[derive(Debug, Clone)]
pub struct WithdrawalConfig {
    /// Delay period (in seconds)
    pub delay_period: u64,
    
    /// Challenge period (in seconds)
    pub challenge_period: u64,
}

impl Default for WithdrawalConfig {
    fn default() -> Self {
        Self {
            delay_period: 86400, // 1 day in seconds
            challenge_period: 172800, // 2 days in seconds
        }
    }
}

/// Withdrawal status
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WithdrawalStatus {
    /// Pending
    Pending,
    
    /// In delay period
    InDelayPeriod,
    
    /// In challenge period
    InChallengePeriod,
    
    /// Ready for execution
    ReadyForExecution,
    
    /// Executed
    Executed,
    
    /// Rejected
    Rejected,
}

/// Withdrawal information
#[derive(Debug, Clone)]
struct WithdrawalInfo {
    /// Transfer ID
    pub transfer_id: u64,
    
    /// Source address
    pub source: [u8; 32],
    
    /// Destination address
    pub destination: [u8; 32],
    
    /// Asset ID
    pub asset_id: u64,
    
    /// Amount
    pub amount: u64,
    
    /// Status
    pub status: WithdrawalStatus,
    
    /// Creation timestamp
    pub creation_timestamp: u64,
    
    /// Delay period end timestamp
    pub delay_period_end_timestamp: u64,
    
    /// Challenge period end timestamp
    pub challenge_period_end_timestamp: u64,
    
    /// Execution timestamp
    pub execution_timestamp: Option<u64>,
}

/// Delayed withdrawals for the enhanced bridge system
pub struct DelayedWithdrawals {
    /// Withdrawal configuration
    config: WithdrawalConfig,
    
    /// Withdrawals by transfer ID
    withdrawals: HashMap<u64, WithdrawalInfo>,
    
    /// Whether the delayed withdrawals is initialized
    initialized: bool,
}

impl DelayedWithdrawals {
    /// Create a new delayed withdrawals with default configuration
    pub fn new() -> Self {
        Self {
            config: WithdrawalConfig::default(),
            withdrawals: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Create a new delayed withdrawals with the specified configuration
    pub fn with_config(config: WithdrawalConfig) -> Self {
        Self {
            config,
            withdrawals: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Initialize the delayed withdrawals
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        self.initialized = true;
        
        msg!("Delayed withdrawals initialized");
        
        Ok(())
    }
    
    /// Check if the delayed withdrawals is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Add a withdrawal
    pub fn add_withdrawal(
        &mut self,
        transfer_id: u64,
        source: &[u8; 32],
        destination: &[u8; 32],
        asset_id: u64,
        amount: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the withdrawal already exists
        if self.withdrawals.contains_key(&transfer_id) {
            return Err(ProgramError::AccountAlreadyInitialized);
        }
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        // Calculate the delay period end timestamp
        let delay_period_end_timestamp = current_timestamp + self.config.delay_period;
        
        // Calculate the challenge period end timestamp
        let challenge_period_end_timestamp = delay_period_end_timestamp + self.config.challenge_period;
        
        // Create the withdrawal
        let withdrawal = WithdrawalInfo {
            transfer_id,
            source: *source,
            destination: *destination,
            asset_id,
            amount,
            status: WithdrawalStatus::Pending,
            creation_timestamp: current_timestamp,
            delay_period_end_timestamp,
            challenge_period_end_timestamp,
            execution_timestamp: None,
        };
        
        // Add the withdrawal
        self.withdrawals.insert(transfer_id, withdrawal);
        
        msg!("Withdrawal added: {}", transfer_id);
        
        Ok(())
    }
    
    /// Update withdrawal status
    pub fn update_withdrawal_status(&mut self) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        for (_, withdrawal) in self.withdrawals.iter_mut() {
            match withdrawal.status {
                WithdrawalStatus::Pending => {
                    // Check if the delay period has started
                    withdrawal.status = WithdrawalStatus::InDelayPeriod;
                    
                    msg!("Withdrawal moved to delay period: {}", withdrawal.transfer_id);
                },
                WithdrawalStatus::InDelayPeriod => {
                    // Check if the delay period has ended
                    if current_timestamp >= withdrawal.delay_period_end_timestamp {
                        withdrawal.status = WithdrawalStatus::InChallengePeriod;
                        
                        msg!("Withdrawal moved to challenge period: {}", withdrawal.transfer_id);
                    }
                },
                WithdrawalStatus::InChallengePeriod => {
                    // Check if the challenge period has ended
                    if current_timestamp >= withdrawal.challenge_period_end_timestamp {
                        withdrawal.status = WithdrawalStatus::ReadyForExecution;
                        
                        msg!("Withdrawal ready for execution: {}", withdrawal.transfer_id);
                    }
                },
                _ => {
                    // No status update needed
                },
            }
        }
        
        Ok(())
    }
    
    /// Check if a withdrawal is ready to be completed
    pub fn is_withdrawal_ready(&self, transfer_id: u64) -> Result<bool, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the withdrawal
        let withdrawal = self.withdrawals.get(&transfer_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the withdrawal is ready for execution
        Ok(withdrawal.status == WithdrawalStatus::ReadyForExecution)
    }
    
    /// Complete a withdrawal
    pub fn complete_withdrawal(&mut self, transfer_id: u64) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the withdrawal
        let withdrawal = self.withdrawals.get_mut(&transfer_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the withdrawal is ready for execution
        if withdrawal.status != WithdrawalStatus::ReadyForExecution {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Update the withdrawal status
        withdrawal.status = WithdrawalStatus::Executed;
        
        // Set the execution timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        withdrawal.execution_timestamp = Some(current_timestamp);
        
        msg!("Withdrawal completed: {}", transfer_id);
        
        Ok(())
    }
    
    /// Reject a withdrawal
    pub fn reject_withdrawal(&mut self, transfer_id: u64) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the withdrawal
        let withdrawal = self.withdrawals.get_mut(&transfer_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the withdrawal is not already executed or rejected
        if withdrawal.status == WithdrawalStatus::Executed || withdrawal.status == WithdrawalStatus::Rejected {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Update the withdrawal status
        withdrawal.status = WithdrawalStatus::Rejected;
        
        msg!("Withdrawal rejected: {}", transfer_id);
        
        Ok(())
    }
    
    /// Get a withdrawal
    pub fn get_withdrawal(&self, transfer_id: u64) -> Option<&WithdrawalInfo> {
        if !self.initialized {
            return None;
        }
        
        self.withdrawals.get(&transfer_id)
    }
    
    /// Get all withdrawals
    pub fn get_all_withdrawals(&self) -> &HashMap<u64, WithdrawalInfo> {
        &self.withdrawals
    }
    
    /// Get withdrawals by status
    pub fn get_withdrawals_by_status(&self, status: WithdrawalStatus) -> Vec<&WithdrawalInfo> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.withdrawals.values()
            .filter(|withdrawal| withdrawal.status == status)
            .collect()
    }
    
    /// Update the delayed withdrawals configuration
    pub fn update_config(&mut self, config: WithdrawalConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the configuration
        self.config = config;
        
        msg!("Delayed withdrawals configuration updated");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_delayed_withdrawals_creation() {
        let withdrawals = DelayedWithdrawals::new();
        assert!(!withdrawals.is_initialized());
    }
    
    #[test]
    fn test_delayed_withdrawals_with_config() {
        let config = WithdrawalConfig::default();
        let withdrawals = DelayedWithdrawals::with_config(config);
        assert!(!withdrawals.is_initialized());
    }
}
