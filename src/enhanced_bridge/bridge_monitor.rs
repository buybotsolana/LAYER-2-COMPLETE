// src/enhanced_bridge/bridge_monitor.rs
//! Bridge Monitor module for Enhanced Bridge Security
//! 
//! This module implements bridge monitoring:
//! - Transaction monitoring and anomaly detection
//! - Security alerts and notifications
//! - Activity logging and audit trails
//! - Risk scoring and analysis
//!
//! The bridge monitor ensures that suspicious activities
//! are detected and reported for further investigation.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::{HashMap, VecDeque};

/// Monitor configuration
#[derive(Debug, Clone)]
pub struct MonitorConfig {
    /// Maximum number of transactions to keep in history
    pub max_transaction_history: usize,
    
    /// Threshold for suspicious transaction amount (in SOL)
    pub suspicious_amount_threshold: u64,
    
    /// Threshold for suspicious transaction frequency (transactions per hour)
    pub suspicious_frequency_threshold: u32,
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self {
            max_transaction_history: 1000,
            suspicious_amount_threshold: 100_000_000_000, // 1,000 SOL (assuming 8 decimals)
            suspicious_frequency_threshold: 20,
        }
    }
}

/// Alert level
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AlertLevel {
    /// Info
    Info,
    
    /// Warning
    Warning,
    
    /// Critical
    Critical,
}

/// Alert information
#[derive(Debug, Clone)]
pub struct AlertInfo {
    /// Alert ID
    pub id: u64,
    
    /// Alert level
    pub level: AlertLevel,
    
    /// Alert message
    pub message: String,
    
    /// Related transfer ID (if any)
    pub transfer_id: Option<u64>,
    
    /// Related account (if any)
    pub account: Option<[u8; 32]>,
    
    /// Creation timestamp
    pub creation_timestamp: u64,
    
    /// Whether the alert has been acknowledged
    pub acknowledged: bool,
    
    /// Acknowledgement timestamp (if acknowledged)
    pub acknowledgement_timestamp: Option<u64>,
}

/// Transaction information
#[derive(Debug, Clone)]
pub struct TransactionInfo {
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
    
    /// Timestamp
    pub timestamp: u64,
}

/// Bridge monitor for the enhanced bridge system
pub struct BridgeMonitor {
    /// Monitor configuration
    config: MonitorConfig,
    
    /// Transaction history
    transaction_history: VecDeque<TransactionInfo>,
    
    /// Alerts by ID
    alerts: HashMap<u64, AlertInfo>,
    
    /// Next alert ID
    next_alert_id: u64,
    
    /// Transaction count by account and hour
    transaction_count: HashMap<([u8; 32], u64), u32>,
    
    /// Whether the bridge monitor is initialized
    initialized: bool,
}

impl BridgeMonitor {
    /// Create a new bridge monitor with default configuration
    pub fn new() -> Self {
        Self {
            config: MonitorConfig::default(),
            transaction_history: VecDeque::new(),
            alerts: HashMap::new(),
            next_alert_id: 1,
            transaction_count: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Create a new bridge monitor with the specified configuration
    pub fn with_config(config: MonitorConfig) -> Self {
        Self {
            config,
            transaction_history: VecDeque::new(),
            alerts: HashMap::new(),
            next_alert_id: 1,
            transaction_count: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Initialize the bridge monitor
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        self.initialized = true;
        
        msg!("Bridge monitor initialized");
        
        Ok(())
    }
    
    /// Check if the bridge monitor is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Record a transaction
    pub fn record_transaction(
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
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        // Create the transaction
        let transaction = TransactionInfo {
            transfer_id,
            source: *source,
            destination: *destination,
            asset_id,
            amount,
            timestamp: current_timestamp,
        };
        
        // Add the transaction to the history
        self.transaction_history.push_back(transaction);
        
        // If the history is too large, remove the oldest transaction
        if self.transaction_history.len() > self.config.max_transaction_history {
            self.transaction_history.pop_front();
        }
        
        // Update the transaction count
        let hour_timestamp = current_timestamp - (current_timestamp % 3600); // Round down to the hour
        let count = self.transaction_count.entry((*source, hour_timestamp))
            .or_insert(0);
        *count += 1;
        
        // Check for suspicious activity
        self.check_suspicious_activity(transfer_id, source, amount, *count)?;
        
        msg!("Transaction recorded: {}", transfer_id);
        
        Ok(())
    }
    
    /// Check for suspicious activity
    fn check_suspicious_activity(
        &mut self,
        transfer_id: u64,
        account: &[u8; 32],
        amount: u64,
        transaction_count: u32,
    ) -> ProgramResult {
        // Check for suspicious amount
        if amount >= self.config.suspicious_amount_threshold {
            self.create_alert(
                AlertLevel::Warning,
                format!("Suspicious amount: {}", amount),
                Some(transfer_id),
                Some(*account),
            )?;
        }
        
        // Check for suspicious frequency
        if transaction_count >= self.config.suspicious_frequency_threshold {
            self.create_alert(
                AlertLevel::Warning,
                format!("Suspicious frequency: {} transactions per hour", transaction_count),
                None,
                Some(*account),
            )?;
        }
        
        Ok(())
    }
    
    /// Create an alert
    pub fn create_alert(
        &mut self,
        level: AlertLevel,
        message: String,
        transfer_id: Option<u64>,
        account: Option<[u8; 32]>,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        // Create the alert
        let alert_id = self.next_alert_id;
        self.next_alert_id += 1;
        
        let alert = AlertInfo {
            id: alert_id,
            level,
            message,
            transfer_id,
            account,
            creation_timestamp: current_timestamp,
            acknowledged: false,
            acknowledgement_timestamp: None,
        };
        
        // Add the alert
        self.alerts.insert(alert_id, alert);
        
        msg!("Alert created: {}", alert_id);
        
        Ok(alert_id)
    }
    
    /// Acknowledge an alert
    pub fn acknowledge_alert(
        &mut self,
        alert_id: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the alert
        let alert = self.alerts.get_mut(&alert_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the alert is already acknowledged
        if alert.acknowledged {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Update the alert
        alert.acknowledged = true;
        
        // Set the acknowledgement timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        alert.acknowledgement_timestamp = Some(current_timestamp);
        
        msg!("Alert acknowledged: {}", alert_id);
        
        Ok(())
    }
    
    /// Clean up old transaction counts
    pub fn clean_up_old_transaction_counts(&mut self) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        let hour_timestamp = current_timestamp - (current_timestamp % 3600); // Round down to the hour
        
        // Remove transaction counts older than 24 hours
        let old_hour_timestamp = hour_timestamp - 24 * 3600;
        
        let keys_to_remove: Vec<([u8; 32], u64)> = self.transaction_count.keys()
            .filter(|(_, ts)| *ts < old_hour_timestamp)
            .cloned()
            .collect();
        
        for key in keys_to_remove {
            self.transaction_count.remove(&key);
        }
        
        msg!("Old transaction counts cleaned up");
        
        Ok(())
    }
    
    /// Get transaction history
    pub fn get_transaction_history(&self) -> &VecDeque<TransactionInfo> {
        &self.transaction_history
    }
    
    /// Get alerts
    pub fn get_alerts(&self) -> &HashMap<u64, AlertInfo> {
        &self.alerts
    }
    
    /// Get unacknowledged alerts
    pub fn get_unacknowledged_alerts(&self) -> Vec<&AlertInfo> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.alerts.values()
            .filter(|alert| !alert.acknowledged)
            .collect()
    }
    
    /// Get alerts by level
    pub fn get_alerts_by_level(&self, level: AlertLevel) -> Vec<&AlertInfo> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.alerts.values()
            .filter(|alert| alert.level == level)
            .collect()
    }
    
    /// Update the bridge monitor configuration
    pub fn update_config(&mut self, config: MonitorConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the configuration
        self.config = config;
        
        msg!("Bridge monitor configuration updated");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_bridge_monitor_creation() {
        let monitor = BridgeMonitor::new();
        assert!(!monitor.is_initialized());
    }
    
    #[test]
    fn test_bridge_monitor_with_config() {
        let config = MonitorConfig::default();
        let monitor = BridgeMonitor::with_config(config);
        assert!(!monitor.is_initialized());
    }
}
