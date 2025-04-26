// src/monitoring/alerts.rs
//! Alerts Module for Layer-2 on Solana
//!
//! This module provides comprehensive alerting capabilities:
//! - Alert generation based on metric thresholds
//! - Alert severity levels
//! - Multiple notification channels (console, log, email, Slack, etc.)
//! - Alert aggregation and deduplication
//! - Alert history and status tracking
//!
//! The alerts system is designed to notify operators of potential issues
//! before they become critical problems.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use serde::{Serialize, Deserialize};
use thiserror::Error;

/// Alert severity level
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum AlertSeverity {
    /// Informational alert
    Info,
    
    /// Warning alert
    Warning,
    
    /// Error alert
    Error,
    
    /// Critical alert
    Critical,
}

impl std::fmt::Display for AlertSeverity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AlertSeverity::Info => write!(f, "INFO"),
            AlertSeverity::Warning => write!(f, "WARNING"),
            AlertSeverity::Error => write!(f, "ERROR"),
            AlertSeverity::Critical => write!(f, "CRITICAL"),
        }
    }
}

/// Alert status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AlertStatus {
    /// Active alert
    Active,
    
    /// Acknowledged alert
    Acknowledged,
    
    /// Resolved alert
    Resolved,
}

impl std::fmt::Display for AlertStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AlertStatus::Active => write!(f, "ACTIVE"),
            AlertStatus::Acknowledged => write!(f, "ACKNOWLEDGED"),
            AlertStatus::Resolved => write!(f, "RESOLVED"),
        }
    }
}

/// Alert notification endpoint
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AlertEndpoint {
    /// Console output
    Console,
    
    /// Log file
    Log,
    
    /// Email
    Email(String),
    
    /// Slack webhook
    Slack(String),
    
    /// Discord webhook
    Discord(String),
    
    /// Telegram bot
    Telegram(String),
    
    /// PagerDuty
    PagerDuty(String),
    
    /// OpsGenie
    OpsGenie(String),
    
    /// Custom webhook
    Webhook(String),
}

/// Alert
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alert {
    /// Alert ID
    pub id: String,
    
    /// Alert title
    pub title: String,
    
    /// Alert message
    pub message: String,
    
    /// Alert severity
    pub severity: AlertSeverity,
    
    /// Alert status
    pub status: AlertStatus,
    
    /// Alert source
    pub source: String,
    
    /// Alert tags
    pub tags: Vec<String>,
    
    /// Alert creation timestamp
    pub created_at: u64,
    
    /// Alert last updated timestamp
    pub updated_at: u64,
    
    /// Alert acknowledged timestamp (if acknowledged)
    pub acknowledged_at: Option<u64>,
    
    /// Alert resolved timestamp (if resolved)
    pub resolved_at: Option<u64>,
    
    /// Alert count (for repeated alerts)
    pub count: u32,
}

impl Alert {
    /// Create a new alert
    pub fn new(title: &str, message: &str, severity: AlertSeverity) -> Self {
        let now = current_timestamp();
        
        Self {
            id: generate_alert_id(),
            title: title.to_string(),
            message: message.to_string(),
            severity,
            status: AlertStatus::Active,
            source: "system".to_string(),
            tags: Vec::new(),
            created_at: now,
            updated_at: now,
            acknowledged_at: None,
            resolved_at: None,
            count: 1,
        }
    }
    
    /// Acknowledge the alert
    pub fn acknowledge(&mut self) {
        if self.status == AlertStatus::Active {
            self.status = AlertStatus::Acknowledged;
            self.acknowledged_at = Some(current_timestamp());
            self.updated_at = self.acknowledged_at.unwrap();
        }
    }
    
    /// Resolve the alert
    pub fn resolve(&mut self) {
        if self.status != AlertStatus::Resolved {
            self.status = AlertStatus::Resolved;
            self.resolved_at = Some(current_timestamp());
            self.updated_at = self.resolved_at.unwrap();
        }
    }
    
    /// Increment the alert count
    pub fn increment_count(&mut self) {
        self.count += 1;
        self.updated_at = current_timestamp();
    }
    
    /// Add a tag to the alert
    pub fn add_tag(&mut self, tag: &str) {
        if !self.tags.contains(&tag.to_string()) {
            self.tags.push(tag.to_string());
            self.updated_at = current_timestamp();
        }
    }
    
    /// Set the alert source
    pub fn set_source(&mut self, source: &str) {
        self.source = source.to_string();
        self.updated_at = current_timestamp();
    }
    
    /// Check if the alert is active
    pub fn is_active(&self) -> bool {
        self.status == AlertStatus::Active
    }
    
    /// Check if the alert is acknowledged
    pub fn is_acknowledged(&self) -> bool {
        self.status == AlertStatus::Acknowledged
    }
    
    /// Check if the alert is resolved
    pub fn is_resolved(&self) -> bool {
        self.status == AlertStatus::Resolved
    }
    
    /// Get the alert age in seconds
    pub fn age(&self) -> u64 {
        current_timestamp().saturating_sub(self.created_at)
    }
    
    /// Check if the alert is older than the given duration
    pub fn is_older_than(&self, seconds: u64) -> bool {
        self.age() > seconds
    }
}

/// Alert manager configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertManagerConfig {
    /// Maximum number of alerts to keep in history
    pub max_history: usize,
    
    /// Alert deduplication window in seconds
    pub deduplication_window: u64,
    
    /// Alert endpoints
    pub endpoints: Vec<AlertEndpoint>,
    
    /// Minimum severity for notifications
    pub min_notification_severity: AlertSeverity,
    
    /// Enable alert aggregation
    pub enable_aggregation: bool,
    
    /// Aggregation window in seconds
    pub aggregation_window: u64,
    
    /// Maximum alerts per aggregation
    pub max_alerts_per_aggregation: usize,
}

impl Default for AlertManagerConfig {
    fn default() -> Self {
        Self {
            max_history: 1000,
            deduplication_window: 300, // 5 minutes
            endpoints: vec![
                AlertEndpoint::Console,
                AlertEndpoint::Log,
            ],
            min_notification_severity: AlertSeverity::Warning,
            enable_aggregation: true,
            aggregation_window: 300, // 5 minutes
            max_alerts_per_aggregation: 10,
        }
    }
}

/// Alert manager
pub struct AlertManager {
    /// Alert history
    alerts: Arc<RwLock<VecDeque<Alert>>>,
    
    /// Active alerts
    active_alerts: Arc<RwLock<HashMap<String, Alert>>>,
    
    /// Alert endpoints
    endpoints: Vec<AlertEndpoint>,
    
    /// Configuration
    config: AlertManagerConfig,
}

impl AlertManager {
    /// Create a new alert manager with the default configuration
    pub fn new(endpoints: Vec<AlertEndpoint>) -> Self {
        let mut config = AlertManagerConfig::default();
        config.endpoints = endpoints;
        
        Self::with_config(config)
    }
    
    /// Create a new alert manager with the given configuration
    pub fn with_config(config: AlertManagerConfig) -> Self {
        Self {
            alerts: Arc::new(RwLock::new(VecDeque::with_capacity(config.max_history))),
            active_alerts: Arc::new(RwLock::new(HashMap::new())),
            endpoints: config.endpoints.clone(),
            config,
        }
    }
    
    /// Send an alert
    pub fn send_alert(&self, title: &str, message: &str, severity: AlertSeverity) -> String {
        let alert = Alert::new(title, message, severity);
        let alert_id = alert.id.clone();
        
        // Check for deduplication
        let should_deduplicate = {
            let active_alerts = self.active_alerts.read().unwrap();
            active_alerts.values().any(|a| {
                a.title == title && 
                a.severity == severity && 
                a.is_active() && 
                current_timestamp().saturating_sub(a.updated_at) < self.config.deduplication_window
            })
        };
        
        if should_deduplicate {
            // Find the existing alert and increment its count
            let mut active_alerts = self.active_alerts.write().unwrap();
            for alert in active_alerts.values_mut() {
                if alert.title == title && 
                   alert.severity == severity && 
                   alert.is_active() && 
                   current_timestamp().saturating_sub(alert.updated_at) < self.config.deduplication_window {
                    alert.increment_count();
                    
                    // If severity is high enough, send notification
                    if severity >= self.config.min_notification_severity {
                        self.send_notifications(alert);
                    }
                    
                    return alert.id.clone();
                }
            }
            
            // If we get here, the alert wasn't found (race condition), so add it
            active_alerts.insert(alert_id.clone(), alert.clone());
        } else {
            // Add the new alert
            let mut active_alerts = self.active_alerts.write().unwrap();
            active_alerts.insert(alert_id.clone(), alert.clone());
            
            // Add to history
            let mut alerts = self.alerts.write().unwrap();
            alerts.push_back(alert.clone());
            
            // Trim history if needed
            if alerts.len() > self.config.max_history {
                alerts.pop_front();
            }
            
            // If severity is high enough, send notification
            if severity >= self.config.min_notification_severity {
                self.send_notifications(&alert);
            }
        }
        
        alert_id
    }
    
    /// Acknowledge an alert
    pub fn acknowledge_alert(&self, alert_id: &str) -> Result<(), AlertError> {
        let mut active_alerts = self.active_alerts.write().unwrap();
        
        if let Some(alert) = active_alerts.get_mut(alert_id) {
            alert.acknowledge();
            
            // Update in history
            let mut alerts = self.alerts.write().unwrap();
            for stored_alert in alerts.iter_mut() {
                if stored_alert.id == alert_id {
                    *stored_alert = alert.clone();
                    break;
                }
            }
            
            Ok(())
        } else {
            Err(AlertError::AlertNotFound(alert_id.to_string()))
        }
    }
    
    /// Resolve an alert
    pub fn resolve_alert(&self, alert_id: &str) -> Result<(), AlertError> {
        let mut active_alerts = self.active_alerts.write().unwrap();
        
        if let Some(alert) = active_alerts.get_mut(alert_id) {
            alert.resolve();
            
            // Update in history
            let mut alerts = self.alerts.write().unwrap();
            for stored_alert in alerts.iter_mut() {
                if stored_alert.id == alert_id {
                    *stored_alert = alert.clone();
                    break;
                }
            }
            
            // Remove from active alerts
            active_alerts.remove(alert_id);
            
            Ok(())
        } else {
            Err(AlertError::AlertNotFound(alert_id.to_string()))
        }
    }
    
    /// Get an alert by ID
    pub fn get_alert(&self, alert_id: &str) -> Option<Alert> {
        // Check active alerts first
        let active_alerts = self.active_alerts.read().unwrap();
        if let Some(alert) = active_alerts.get(alert_id) {
            return Some(alert.clone());
        }
        
        // Check history
        let alerts = self.alerts.read().unwrap();
        for alert in alerts.iter() {
            if alert.id == alert_id {
                return Some(alert.clone());
            }
        }
        
        None
    }
    
    /// Get all alerts
    pub fn get_all_alerts(&self) -> Vec<Alert> {
        let alerts = self.alerts.read().unwrap();
        alerts.iter().cloned().collect()
    }
    
    /// Get active alerts
    pub fn get_active_alerts(&self) -> Vec<Alert> {
        let active_alerts = self.active_alerts.read().unwrap();
        active_alerts.values().cloned().collect()
    }
    
    /// Get alerts by severity
    pub fn get_alerts_by_severity(&self, severity: AlertSeverity) -> Vec<Alert> {
        let alerts = self.alerts.read().unwrap();
        alerts.iter()
            .filter(|a| a.severity == severity)
            .cloned()
            .collect()
    }
    
    /// Get alerts by status
    pub fn get_alerts_by_status(&self, status: AlertStatus) -> Vec<Alert> {
        let alerts = self.alerts.read().unwrap();
        alerts.iter()
            .filter(|a| a.status == status)
            .cloned()
            .collect()
    }
    
    /// Get alerts by source
    pub fn get_alerts_by_source(&self, source: &str) -> Vec<Alert> {
        let alerts = self.alerts.read().unwrap();
        alerts.iter()
            .filter(|a| a.source == source)
            .cloned()
            .collect()
    }
    
    /// Get alerts by tag
    pub fn get_alerts_by_tag(&self, tag: &str) -> Vec<Alert> {
        let alerts = self.alerts.read().unwrap();
        alerts.iter()
            .filter(|a| a.tags.contains(&tag.to_string()))
            .cloned()
            .collect()
    }
    
    /// Get alerts created after the given timestamp
    pub fn get_alerts_after(&self, timestamp: u64) -> Vec<Alert> {
        let alerts = self.alerts.read().unwrap();
        alerts.iter()
            .filter(|a| a.created_at > timestamp)
            .cloned()
            .collect()
    }
    
    /// Get alerts created before the given timestamp
    pub fn get_alerts_before(&self, timestamp: u64) -> Vec<Alert> {
        let alerts = self.alerts.read().unwrap();
        alerts.iter()
            .filter(|a| a.created_at < timestamp)
            .cloned()
            .collect()
    }
    
    /// Clear all alerts
    pub fn clear_alerts(&self) {
        let mut active_alerts = self.active_alerts.write().unwrap();
        active_alerts.clear();
        
        let mut alerts = self.alerts.write().unwrap();
        alerts.clear();
    }
    
    /// Send notifications for an alert
    fn send_notifications(&self, alert: &Alert) {
        for endpoint in &self.endpoints {
            match endpoint {
                AlertEndpoint::Console => {
                    println!("[{}] {}: {}", alert.severity, alert.title, alert.message);
                },
                AlertEndpoint::Log => {
                    // In a real implementation, this would log to a file
                    eprintln!("[{}] {}: {}", alert.severity, alert.title, alert.message);
                },
                AlertEndpoint::Email(email) => {
                    // In a real implementation, this would send an email
                    println!("Sending email alert to {}: [{}] {}: {}", 
                             email, alert.severity, alert.title, alert.message);
                },
                AlertEndpoint::Slack(webhook) => {
                    // In a real implementation, this would send a Slack message
                    println!("Sending Slack alert to {}: [{}] {}: {}", 
                             webhook, alert.severity, alert.title, alert.message);
                },
                AlertEndpoint::Discord(webhook) => {
                    // In a real implementation, this would send a Discord message
                    println!("Sending Discord alert to {}: [{}] {}: {}", 
                             webhook, alert.severity, alert.title, alert.message);
                },
                AlertEndpoint::Telegram(bot) => {
                    // In a real implementation, this would send a Telegram message
                    println!("Sending Telegram alert via {}: [{}] {}: {}", 
                             bot, alert.severity, alert.title, alert.message);
                },
                AlertEndpoint::PagerDuty(key) => {
                    // In a real implementation, this would send a PagerDuty alert
                    println!("Sending PagerDuty alert with key {}: [{}] {}: {}", 
                             key, alert.severity, alert.title, alert.message);
                },
                AlertEndpoint::OpsGenie(key) => {
                    // In a real implementation, this would send an OpsGenie alert
                    println!("Sending OpsGenie alert with key {}: [{}] {}: {}", 
                             key, alert.severity, alert.title, alert.message);
                },
                AlertEndpoint::Webhook(url) => {
                    // In a real implementation, this would send a webhook request
                    println!("Sending webhook alert to {}: [{}] {}: {}", 
                             url, alert.severity, alert.title, alert.message);
                },
            }
        }
    }
}

/// Alert error
#[derive(Debug, Error)]
pub enum AlertError {
    /// Alert not found
    #[error("Alert not found: {0}")]
    AlertNotFound(String),
    
    /// Invalid alert ID
    #[error("Invalid alert ID: {0}")]
    InvalidAlertId(String),
    
    /// Invalid alert severity
    #[error("Invalid alert severity: {0}")]
    InvalidAlertSeverity(String),
    
    /// Invalid alert status
    #[error("Invalid alert status: {0}")]
    InvalidAlertStatus(String),
    
    /// Notification error
    #[error("Notification error: {0}")]
    NotificationError(String),
}

/// Generate a unique alert ID
fn generate_alert_id() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    
    let timestamp = current_timestamp();
    let random = rand::random::<u64>();
    
    let mut hasher = DefaultHasher::new();
    timestamp.hash(&mut hasher);
    random.hash(&mut hasher);
    
    format!("alert-{:016x}", hasher.finish())
}

/// Get current timestamp in seconds since epoch
fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_alert_creation() {
        let alert = Alert::new("Test Alert", "This is a test alert", AlertSeverity::Warning);
        
        assert_eq!(alert.title, "Test Alert");
        assert_eq!(alert.message, "This is a test alert");
        assert_eq!(alert.severity, AlertSeverity::Warning);
        assert_eq!(alert.status, AlertStatus::Active);
        assert_eq!(alert.count, 1);
        assert!(alert.is_active());
        assert!(!alert.is_acknowledged());
        assert!(!alert.is_resolved());
    }
    
    #[test]
    fn test_alert_status_changes() {
        let mut alert = Alert::new("Test Alert", "This is a test alert", AlertSeverity::Warning);
        
        // Test acknowledgement
        alert.acknowledge();
        assert_eq!(alert.status, AlertStatus::Acknowledged);
        assert!(alert.acknowledged_at.is_some());
        assert!(alert.is_acknowledged());
        
        // Test resolution
        alert.resolve();
        assert_eq!(alert.status, AlertStatus::Resolved);
        assert!(alert.resolved_at.is_some());
        assert!(alert.is_resolved());
    }
    
    #[test]
    fn test_alert_manager() {
        let endpoints = vec![AlertEndpoint::Console];
        let alert_manager = AlertManager::new(endpoints);
        
        // Send an alert
        let alert_id = alert_manager.send_alert(
            "Test Alert",
            "This is a test alert",
            AlertSeverity::Warning,
        );
        
        // Get the alert
        let alert = alert_manager.get_alert(&alert_id).unwrap();
        assert_eq!(alert.title, "Test Alert");
        assert_eq!(alert.message, "This is a test alert");
        assert_eq!(alert.severity, AlertSeverity::Warning);
        
        // Get active alerts
        let active_alerts = alert_manager.get_active_alerts();
        assert_eq!(active_alerts.len(), 1);
        
        // Acknowledge the alert
        let result = alert_manager.acknowledge_alert(&alert_id);
        assert!(result.is_ok());
        
        // Get the acknowledged alert
        let alert = alert_manager.get_alert(&alert_id).unwrap();
        assert!(alert.is_acknowledged());
        
        // Resolve the alert
        let result = alert_manager.resolve_alert(&alert_id);
        assert!(result.is_ok());
        
        // Get the resolved alert
        let alert = alert_manager.get_alert(&alert_id).unwrap();
        assert!(alert.is_resolved());
        
        // Get active alerts (should be empty)
        let active_alerts = alert_manager.get_active_alerts();
        assert_eq!(active_alerts.len(), 0);
    }
    
    #[test]
    fn test_alert_deduplication() {
        let endpoints = vec![AlertEndpoint::Console];
        let alert_manager = AlertManager::new(endpoints);
        
        // Send an alert
        let alert_id1 = alert_manager.send_alert(
            "Duplicate Alert",
            "This alert will be deduplicated",
            AlertSeverity::Warning,
        );
        
        // Send the same alert again
        let alert_id2 = alert_manager.send_alert(
            "Duplicate Alert",
            "This alert will be deduplicated",
            AlertSeverity::Warning,
        );
        
        // The IDs should be the same
        assert_eq!(alert_id1, alert_id2);
        
        // Get the alert
        let alert = alert_manager.get_alert(&alert_id1).unwrap();
        
        // The count should be incremented
        assert_eq!(alert.count, 2);
    }
}
