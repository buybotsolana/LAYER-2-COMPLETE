// src/advanced_finalization/security_monitor.rs
//! Security Monitor module for Advanced Finalization System
//! 
//! This module implements security monitoring:
//! - Detection of suspicious finalization patterns
//! - Monitoring of validator behavior
//! - Alerting for potential security issues
//! - Automatic response to security threats
//!
//! The security monitor helps protect the finalization system from
//! attacks and ensures the integrity of the finalization process.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::{HashMap, VecDeque};

/// Security configuration
#[derive(Debug, Clone)]
pub struct SecurityConfig {
    /// Whether to enable security monitoring
    pub enable_security_monitoring: bool,
}

impl Default for SecurityConfig {
    fn default() -> Self {
        Self {
            enable_security_monitoring: true,
        }
    }
}

/// Security alert
#[derive(Debug, Clone)]
pub struct SecurityAlert {
    /// Alert ID
    pub id: u64,
    
    /// Alert type
    pub alert_type: SecurityAlertType,
    
    /// Alert severity
    pub severity: SecurityAlertSeverity,
    
    /// Alert description
    pub description: String,
    
    /// Related entities
    pub related_entities: Vec<Pubkey>,
    
    /// Timestamp
    pub timestamp: u64,
    
    /// Whether the alert is resolved
    pub is_resolved: bool,
    
    /// Resolution timestamp
    pub resolution_timestamp: Option<u64>,
    
    /// Resolution description
    pub resolution_description: Option<String>,
}

/// Security alert type
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecurityAlertType {
    /// Suspicious voting pattern
    SuspiciousVotingPattern,
    
    /// Validator inactivity
    ValidatorInactivity,
    
    /// Stake concentration
    StakeConcentration,
    
    /// Checkpoint stalling
    CheckpointStalling,
    
    /// Finalization delay
    FinalizationDelay,
    
    /// Challenge flooding
    ChallengeFlooding,
    
    /// Forced finalization abuse
    ForcedFinalizationAbuse,
    
    /// Other
    Other(String),
}

/// Security alert severity
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum SecurityAlertSeverity {
    /// Low severity
    Low,
    
    /// Medium severity
    Medium,
    
    /// High severity
    High,
    
    /// Critical severity
    Critical,
}

/// Security monitor for the advanced finalization system
pub struct SecurityMonitor {
    /// Security configuration
    config: SecurityConfig,
    
    /// Alerts
    alerts: HashMap<u64, SecurityAlert>,
    
    /// Alert history
    alert_history: VecDeque<u64>,
    
    /// Next alert ID
    next_alert_id: u64,
    
    /// Voting patterns by validator
    voting_patterns: HashMap<Pubkey, Vec<(u64, u64)>>, // (checkpoint_id, timestamp)
    
    /// Checkpoint finalization times
    checkpoint_finalization_times: HashMap<u64, u64>, // checkpoint_id -> finalization timestamp
    
    /// Whether the security monitor is initialized
    initialized: bool,
}

impl SecurityMonitor {
    /// Create a new security monitor with default configuration
    pub fn new() -> Self {
        Self {
            config: SecurityConfig::default(),
            alerts: HashMap::new(),
            alert_history: VecDeque::new(),
            next_alert_id: 1,
            voting_patterns: HashMap::new(),
            checkpoint_finalization_times: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Create a new security monitor with the specified configuration
    pub fn with_config(config: SecurityConfig) -> Self {
        Self {
            config,
            alerts: HashMap::new(),
            alert_history: VecDeque::new(),
            next_alert_id: 1,
            voting_patterns: HashMap::new(),
            checkpoint_finalization_times: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Initialize the security monitor
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        self.initialized = true;
        
        msg!("Security monitor initialized");
        
        Ok(())
    }
    
    /// Check if the security monitor is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Record a vote
    pub fn record_vote(
        &mut self,
        validator: &Pubkey,
        checkpoint_id: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if security monitoring is enabled
        if !self.config.enable_security_monitoring {
            return Ok(());
        }
        
        // Record the vote
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        self.voting_patterns.entry(*validator)
            .or_insert_with(Vec::new)
            .push((checkpoint_id, current_timestamp));
        
        Ok(())
    }
    
    /// Record checkpoint finalization
    pub fn record_checkpoint_finalization(
        &mut self,
        checkpoint_id: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if security monitoring is enabled
        if !self.config.enable_security_monitoring {
            return Ok(());
        }
        
        // Record the finalization
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        self.checkpoint_finalization_times.insert(checkpoint_id, current_timestamp);
        
        Ok(())
    }
    
    /// Check for security alerts
    pub fn check_alerts(&mut self) -> Result<Vec<SecurityAlert>, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if security monitoring is enabled
        if !self.config.enable_security_monitoring {
            return Ok(Vec::new());
        }
        
        let mut new_alerts = Vec::new();
        
        // Check for suspicious voting patterns
        self.check_suspicious_voting_patterns(&mut new_alerts)?;
        
        // Check for stake concentration
        self.check_stake_concentration(&mut new_alerts)?;
        
        // Check for checkpoint stalling
        self.check_checkpoint_stalling(&mut new_alerts)?;
        
        // Check for finalization delays
        self.check_finalization_delays(&mut new_alerts)?;
        
        // Add the new alerts
        for alert in &new_alerts {
            self.alerts.insert(alert.id, alert.clone());
            self.alert_history.push_back(alert.id);
        }
        
        // Limit the alert history size
        while self.alert_history.len() > 100 {
            if let Some(old_id) = self.alert_history.pop_front() {
                self.alerts.remove(&old_id);
            }
        }
        
        Ok(new_alerts)
    }
    
    /// Check for suspicious voting patterns
    fn check_suspicious_voting_patterns(&mut self, alerts: &mut Vec<SecurityAlert>) -> ProgramResult {
        // In a real implementation, we would analyze voting patterns for suspicious behavior
        // For now, we'll just return without creating any alerts
        
        Ok(())
    }
    
    /// Check for stake concentration
    fn check_stake_concentration(&mut self, alerts: &mut Vec<SecurityAlert>) -> ProgramResult {
        // In a real implementation, we would analyze stake distribution for concentration
        // For now, we'll just return without creating any alerts
        
        Ok(())
    }
    
    /// Check for checkpoint stalling
    fn check_checkpoint_stalling(&mut self, alerts: &mut Vec<SecurityAlert>) -> ProgramResult {
        // In a real implementation, we would check for stalled checkpoints
        // For now, we'll just return without creating any alerts
        
        Ok(())
    }
    
    /// Check for finalization delays
    fn check_finalization_delays(&mut self, alerts: &mut Vec<SecurityAlert>) -> ProgramResult {
        // In a real implementation, we would check for delays in finalization
        // For now, we'll just return without creating any alerts
        
        Ok(())
    }
    
    /// Create a security alert
    fn create_alert(
        &mut self,
        alert_type: SecurityAlertType,
        severity: SecurityAlertSeverity,
        description: String,
        related_entities: Vec<Pubkey>,
    ) -> SecurityAlert {
        let alert_id = self.next_alert_id;
        self.next_alert_id += 1;
        
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        SecurityAlert {
            id: alert_id,
            alert_type,
            severity,
            description,
            related_entities,
            timestamp: current_timestamp,
            is_resolved: false,
            resolution_timestamp: None,
            resolution_description: None,
        }
    }
    
    /// Resolve a security alert
    pub fn resolve_alert(
        &mut self,
        alert_id: u64,
        resolution_description: String,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the alert
        let alert = self.alerts.get_mut(&alert_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the alert is already resolved
        if alert.is_resolved {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Resolve the alert
        alert.is_resolved = true;
        alert.resolution_timestamp = Some(0); // In a real implementation, we would use the current timestamp
        alert.resolution_description = Some(resolution_description);
        
        msg!("Security alert resolved: {}", alert_id);
        
        Ok(())
    }
    
    /// Get a security alert
    pub fn get_alert(&self, alert_id: u64) -> Option<&SecurityAlert> {
        if !self.initialized {
            return None;
        }
        
        self.alerts.get(&alert_id)
    }
    
    /// Get all active security alerts
    pub fn get_active_alerts(&self) -> Vec<&SecurityAlert> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.alerts.values()
            .filter(|alert| !alert.is_resolved)
            .collect()
    }
    
    /// Get all security alerts by severity
    pub fn get_alerts_by_severity(&self, severity: SecurityAlertSeverity) -> Vec<&SecurityAlert> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.alerts.values()
            .filter(|alert| alert.severity == severity)
            .collect()
    }
    
    /// Update the security monitor configuration
    pub fn update_config(&mut self, config: SecurityConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the configuration
        self.config = config;
        
        msg!("Security monitor configuration updated");
        
        Ok(())
    }
    
    /// Clear all alerts
    pub fn clear_alerts(&mut self) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Clear the alerts
        self.alerts.clear();
        self.alert_history.clear();
        
        msg!("All security alerts cleared");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_security_monitor_creation() {
        let monitor = SecurityMonitor::new();
        assert!(!monitor.is_initialized());
    }
    
    #[test]
    fn test_security_monitor_with_config() {
        let config = SecurityConfig::default();
        let monitor = SecurityMonitor::with_config(config);
        assert!(!monitor.is_initialized());
    }
}
