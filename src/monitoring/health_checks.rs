// src/monitoring/health_checks.rs
//! Health Checks Module for Layer-2 on Solana
//!
//! This module provides comprehensive health checking capabilities:
//! - System health checks
//! - Node health checks
//! - Network health checks
//! - Contract health checks
//! - Bridge health checks
//! - Data availability checks
//!
//! The health checks system is designed to proactively identify issues
//! and ensure the overall health of the Layer-2 platform.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use serde::{Serialize, Deserialize};
use thiserror::Error;
use tokio::sync::mpsc;
use tokio::time;

use crate::monitoring::{AlertManager, AlertSeverity, MetricsCollector};

/// Health check status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HealthStatus {
    /// Healthy
    Healthy,
    
    /// Warning
    Warning,
    
    /// Critical
    Critical,
    
    /// Unknown
    Unknown,
}

impl std::fmt::Display for HealthStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HealthStatus::Healthy => write!(f, "HEALTHY"),
            HealthStatus::Warning => write!(f, "WARNING"),
            HealthStatus::Critical => write!(f, "CRITICAL"),
            HealthStatus::Unknown => write!(f, "UNKNOWN"),
        }
    }
}

/// Health check type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HealthCheckType {
    /// System health check
    System,
    
    /// Node health check
    Node,
    
    /// Network health check
    Network,
    
    /// Contract health check
    Contract,
    
    /// Bridge health check
    Bridge,
    
    /// Data availability health check
    DataAvailability,
}

impl std::fmt::Display for HealthCheckType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HealthCheckType::System => write!(f, "SYSTEM"),
            HealthCheckType::Node => write!(f, "NODE"),
            HealthCheckType::Network => write!(f, "NETWORK"),
            HealthCheckType::Contract => write!(f, "CONTRACT"),
            HealthCheckType::Bridge => write!(f, "BRIDGE"),
            HealthCheckType::DataAvailability => write!(f, "DATA_AVAILABILITY"),
        }
    }
}

/// Health check result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheckResult {
    /// Health check ID
    pub id: String,
    
    /// Health check name
    pub name: String,
    
    /// Health check description
    pub description: String,
    
    /// Health check type
    pub check_type: HealthCheckType,
    
    /// Health check status
    pub status: HealthStatus,
    
    /// Health check message
    pub message: String,
    
    /// Health check details
    pub details: Option<serde_json::Value>,
    
    /// Health check timestamp
    pub timestamp: u64,
    
    /// Health check duration in milliseconds
    pub duration_ms: u64,
    
    /// Health check tags
    pub tags: Vec<String>,
}

/// Health check configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheckConfig {
    /// Check interval in seconds
    pub interval: u64,
    
    /// Maximum history to keep
    pub max_history: usize,
    
    /// Enable system health checks
    pub enable_system_checks: bool,
    
    /// Enable node health checks
    pub enable_node_checks: bool,
    
    /// Enable network health checks
    pub enable_network_checks: bool,
    
    /// Enable contract health checks
    pub enable_contract_checks: bool,
    
    /// Enable bridge health checks
    pub enable_bridge_checks: bool,
    
    /// Enable data availability health checks
    pub enable_data_availability_checks: bool,
    
    /// Send alerts on status changes
    pub send_alerts_on_status_change: bool,
}

impl Default for HealthCheckConfig {
    fn default() -> Self {
        Self {
            interval: 60,
            max_history: 100,
            enable_system_checks: true,
            enable_node_checks: true,
            enable_network_checks: true,
            enable_contract_checks: true,
            enable_bridge_checks: true,
            enable_data_availability_checks: true,
            send_alerts_on_status_change: true,
        }
    }
}

/// Health check manager
pub struct HealthCheckManager {
    /// Health check results
    results: Arc<RwLock<HashMap<String, HealthCheckResult>>>,
    
    /// Health check history
    history: Arc<RwLock<VecDeque<(u64, HashMap<String, HealthCheckResult>)>>>,
    
    /// Running status
    running: Arc<Mutex<bool>>,
    
    /// Shutdown channel
    shutdown_tx: Option<mpsc::Sender<()>>,
    
    /// Check interval
    interval: Duration,
    
    /// Configuration
    config: HealthCheckConfig,
}

impl HealthCheckManager {
    /// Create a new health check manager with the default configuration
    pub fn new(interval_seconds: u64) -> Self {
        let mut config = HealthCheckConfig::default();
        config.interval = interval_seconds;
        
        Self::with_config(config)
    }
    
    /// Create a new health check manager with the given configuration
    pub fn with_config(config: HealthCheckConfig) -> Self {
        Self {
            interval: Duration::from_secs(config.interval),
            config,
            results: Arc::new(RwLock::new(HashMap::new())),
            history: Arc::new(RwLock::new(VecDeque::new())),
            running: Arc::new(Mutex::new(false)),
            shutdown_tx: None,
        }
    }
    
    /// Start the health check manager
    pub fn start(&self, metrics_collector: Arc<MetricsCollector>, alert_manager: Arc<AlertManager>) {
        let mut running = self.running.lock().unwrap();
        if *running {
            return;
        }
        
        *running = true;
        
        let results = Arc::clone(&self.results);
        let history = Arc::clone(&self.history);
        let running_clone = Arc::clone(&self.running);
        let interval = self.interval;
        let max_history = self.config.max_history;
        let config = self.config.clone();
        
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        
        // Store the shutdown sender
        drop(running);
        let mut running = self.running.lock().unwrap();
        self.shutdown_tx = Some(shutdown_tx);
        drop(running);
        
        // Spawn health check task
        tokio::spawn(async move {
            let mut interval_timer = time::interval(interval);
            
            // Previous results for status change detection
            let mut previous_results = HashMap::new();
            
            loop {
                tokio::select! {
                    _ = interval_timer.tick() => {
                        // Get all metrics
                        let metrics = metrics_collector.get_all_metrics();
                        
                        // Run health checks
                        let mut new_results = HashMap::new();
                        
                        // System health checks
                        if config.enable_system_checks {
                            let system_results = run_system_health_checks(&metrics);
                            for result in system_results {
                                new_results.insert(result.id.clone(), result);
                            }
                        }
                        
                        // Node health checks
                        if config.enable_node_checks {
                            let node_results = run_node_health_checks(&metrics);
                            for result in node_results {
                                new_results.insert(result.id.clone(), result);
                            }
                        }
                        
                        // Network health checks
                        if config.enable_network_checks {
                            let network_results = run_network_health_checks(&metrics);
                            for result in network_results {
                                new_results.insert(result.id.clone(), result);
                            }
                        }
                        
                        // Contract health checks
                        if config.enable_contract_checks {
                            let contract_results = run_contract_health_checks(&metrics);
                            for result in contract_results {
                                new_results.insert(result.id.clone(), result);
                            }
                        }
                        
                        // Bridge health checks
                        if config.enable_bridge_checks {
                            let bridge_results = run_bridge_health_checks(&metrics);
                            for result in bridge_results {
                                new_results.insert(result.id.clone(), result);
                            }
                        }
                        
                        // Data availability health checks
                        if config.enable_data_availability_checks {
                            let data_availability_results = run_data_availability_health_checks(&metrics);
                            for result in data_availability_results {
                                new_results.insert(result.id.clone(), result);
                            }
                        }
                        
                        // Update results storage
                        let mut results_write = results.write().unwrap();
                        *results_write = new_results.clone();
                        
                        // Update history
                        let timestamp = current_timestamp();
                        
                        let mut history_write = history.write().unwrap();
                        history_write.push_back((timestamp, new_results.clone()));
                        
                        // Trim history if needed
                        if history_write.len() > max_history {
                            history_write.pop_front();
                        }
                        
                        // Send alerts for status changes
                        if config.send_alerts_on_status_change {
                            for (id, result) in &new_results {
                                if let Some(previous_result) = previous_results.get(id) {
                                    if result.status != previous_result.status {
                                        // Status changed, send alert
                                        let severity = match result.status {
                                            HealthStatus::Healthy => AlertSeverity::Info,
                                            HealthStatus::Warning => AlertSeverity::Warning,
                                            HealthStatus::Critical => AlertSeverity::Critical,
                                            HealthStatus::Unknown => AlertSeverity::Warning,
                                        };
                                        
                                        alert_manager.send_alert(
                                            &format!("Health check status changed: {}", result.name),
                                            &format!(
                                                "Health check '{}' status changed from {} to {}: {}",
                                                result.name,
                                                previous_result.status,
                                                result.status,
                                                result.message
                                            ),
                                            severity,
                                        );
                                    }
                                } else if result.status != HealthStatus::Healthy {
                                    // New non-healthy result, send alert
                                    let severity = match result.status {
                                        HealthStatus::Healthy => AlertSeverity::Info,
                                        HealthStatus::Warning => AlertSeverity::Warning,
                                        HealthStatus::Critical => AlertSeverity::Critical,
                                        HealthStatus::Unknown => AlertSeverity::Warning,
                                    };
                                    
                                    alert_manager.send_alert(
                                        &format!("New health check issue: {}", result.name),
                                        &format!(
                                            "Health check '{}' is in {} state: {}",
                                            result.name,
                                            result.status,
                                            result.message
                                        ),
                                        severity,
                                    );
                                }
                            }
                        }
                        
                        // Update previous results for next iteration
                        previous_results = new_results.clone();
                    }
                    _ = shutdown_rx.recv() => {
                        // Shutdown requested
                        break;
                    }
                }
            }
            
            // Set running flag to false
            let mut running = running_clone.lock().unwrap();
            *running = false;
        });
    }
    
    /// Stop the health check manager
    pub fn stop(&self) {
        let mut running = self.running.lock().unwrap();
        if !*running {
            return;
        }
        
        // Send shutdown signal
        if let Some(tx) = &self.shutdown_tx {
            let _ = tx.try_send(());
        }
        
        // Clear shutdown sender
        self.shutdown_tx = None;
        
        // Set running flag to false
        *running = false;
    }
    
    /// Check if the health check manager is running
    pub fn is_running(&self) -> bool {
        let running = self.running.lock().unwrap();
        *running
    }
    
    /// Get a health check result by ID
    pub fn get_result(&self, id: &str) -> Option<HealthCheckResult> {
        let results = self.results.read().unwrap();
        results.get(id).cloned()
    }
    
    /// Get all health check results
    pub fn get_all_results(&self) -> HashMap<String, HealthCheckResult> {
        let results = self.results.read().unwrap();
        results.clone()
    }
    
    /// Get health check results by type
    pub fn get_results_by_type(&self, check_type: HealthCheckType) -> Vec<HealthCheckResult> {
        let results = self.results.read().unwrap();
        results.values()
            .filter(|r| r.check_type == check_type)
            .cloned()
            .collect()
    }
    
    /// Get health check results by status
    pub fn get_results_by_status(&self, status: HealthStatus) -> Vec<HealthCheckResult> {
        let results = self.results.read().unwrap();
        results.values()
            .filter(|r| r.status == status)
            .cloned()
            .collect()
    }
    
    /// Get health check results by tag
    pub fn get_results_by_tag(&self, tag: &str) -> Vec<HealthCheckResult> {
        let results = self.results.read().unwrap();
        results.values()
            .filter(|r| r.tags.contains(&tag.to_string()))
            .cloned()
            .collect()
    }
    
    /// Get health check history
    pub fn get_history(&self) -> Vec<(u64, HashMap<String, HealthCheckResult>)> {
        let history = self.history.read().unwrap();
        history.iter().cloned().collect()
    }
    
    /// Get health check history for a specific check
    pub fn get_check_history(&self, id: &str) -> Vec<(u64, Option<HealthCheckResult>)> {
        let history = self.history.read().unwrap();
        history.iter()
            .map(|(timestamp, results)| (*timestamp, results.get(id).cloned()))
            .collect()
    }
    
    /// Get overall system health status
    pub fn get_overall_status(&self) -> HealthStatus {
        let results = self.results.read().unwrap();
        
        if results.is_empty() {
            return HealthStatus::Unknown;
        }
        
        // If any check is critical, the overall status is critical
        if results.values().any(|r| r.status == HealthStatus::Critical) {
            return HealthStatus::Critical;
        }
        
        // If any check is warning, the overall status is warning
        if results.values().any(|r| r.status == HealthStatus::Warning) {
            return HealthStatus::Warning;
        }
        
        // If any check is unknown, the overall status is warning
        if results.values().any(|r| r.status == HealthStatus::Unknown) {
            return HealthStatus::Warning;
        }
        
        // All checks are healthy
        HealthStatus::Healthy
    }
    
    /// Clear all health check results
    pub fn clear_results(&self) {
        let mut results = self.results.write().unwrap();
        results.clear();
        
        let mut history = self.history.write().unwrap();
        history.clear();
    }
}

/// Run system health checks
fn run_system_health_checks(metrics: &HashMap<String, crate::monitoring::MetricFamily>) -> Vec<HealthCheckResult> {
    let mut results = Vec::new();
    
    // CPU usage check
    if let Some(cpu_family) = metrics.get("system_cpu_usage") {
        if let Some(cpu_metric) = cpu_family.metrics.first() {
            if let crate::monitoring::MetricValue::Float(cpu_usage) = cpu_metric.value {
                let (status, message) = if cpu_usage > 90.0 {
                    (
                        HealthStatus::Critical,
                        format!("CPU usage is critically high: {:.2}%", cpu_usage),
                    )
                } else if cpu_usage > 75.0 {
                    (
                        HealthStatus::Warning,
                        format!("CPU usage is high: {:.2}%", cpu_usage),
                    )
                } else {
                    (
                        HealthStatus::Healthy,
                        format!("CPU usage is normal: {:.2}%", cpu_usage),
                    )
                };
                
                let result = HealthCheckResult {
                    id: "system_cpu_usage".to_string(),
                    name: "CPU Usage".to_string(),
                    description: "Check system CPU usage".to_string(),
                    check_type: HealthCheckType::System,
                    status,
                    message,
                    details: Some(serde_json::json!({
                        "cpu_usage": cpu_usage,
                        "threshold_warning": 75.0,
                        "threshold_critical": 90.0,
                    })),
                    timestamp: current_timestamp(),
                    duration_ms: 0,
                    tags: vec!["system".to_string(), "cpu".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    // Memory usage check
    if let Some(memory_family) = metrics.get("system_memory_usage") {
        if let Some(memory_metric) = memory_family.metrics.first() {
            if let crate::monitoring::MetricValue::Float(memory_usage) = memory_metric.value {
                let (status, message) = if memory_usage > 90.0 {
                    (
                        HealthStatus::Critical,
                        format!("Memory usage is critically high: {:.2}%", memory_usage),
                    )
                } else if memory_usage > 80.0 {
                    (
                        HealthStatus::Warning,
                        format!("Memory usage is high: {:.2}%", memory_usage),
                    )
                } else {
                    (
                        HealthStatus::Healthy,
                        format!("Memory usage is normal: {:.2}%", memory_usage),
                    )
                };
                
                let result = HealthCheckResult {
                    id: "system_memory_usage".to_string(),
                    name: "Memory Usage".to_string(),
                    description: "Check system memory usage".to_string(),
                    check_type: HealthCheckType::System,
                    status,
                    message,
                    details: Some(serde_json::json!({
                        "memory_usage": memory_usage,
                        "threshold_warning": 80.0,
                        "threshold_critical": 90.0,
                    })),
                    timestamp: current_timestamp(),
                    duration_ms: 0,
                    tags: vec!["system".to_string(), "memory".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    // Disk usage check
    if let Some(disk_family) = metrics.get("system_disk_usage") {
        if let Some(disk_metric) = disk_family.metrics.first() {
            if let crate::monitoring::MetricValue::Float(disk_usage) = disk_metric.value {
                let (status, message) = if disk_usage > 90.0 {
                    (
                        HealthStatus::Critical,
                        format!("Disk usage is critically high: {:.2}%", disk_usage),
                    )
                } else if disk_usage > 80.0 {
                    (
                        HealthStatus::Warning,
                        format!("Disk usage is high: {:.2}%", disk_usage),
                    )
                } else {
                    (
                        HealthStatus::Healthy,
                        format!("Disk usage is normal: {:.2}%", disk_usage),
                    )
                };
                
                let result = HealthCheckResult {
                    id: "system_disk_usage".to_string(),
                    name: "Disk Usage".to_string(),
                    description: "Check system disk usage".to_string(),
                    check_type: HealthCheckType::System,
                    status,
                    message,
                    details: Some(serde_json::json!({
                        "disk_usage": disk_usage,
                        "threshold_warning": 80.0,
                        "threshold_critical": 90.0,
                    })),
                    timestamp: current_timestamp(),
                    duration_ms: 0,
                    tags: vec!["system".to_string(), "disk".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    results
}

/// Run node health checks
fn run_node_health_checks(metrics: &HashMap<String, crate::monitoring::MetricFamily>) -> Vec<HealthCheckResult> {
    let mut results = Vec::new();
    
    // Block production check
    if let Some(block_production_family) = metrics.get("node_block_production") {
        if let Some(block_production_metric) = block_production_family.metrics.first() {
            if let crate::monitoring::MetricValue::Float(block_production_rate) = block_production_metric.value {
                let (status, message) = if block_production_rate < 0.5 {
                    (
                        HealthStatus::Critical,
                        format!("Block production rate is critically low: {:.2} blocks/s", block_production_rate),
                    )
                } else if block_production_rate < 0.8 {
                    (
                        HealthStatus::Warning,
                        format!("Block production rate is low: {:.2} blocks/s", block_production_rate),
                    )
                } else {
                    (
                        HealthStatus::Healthy,
                        format!("Block production rate is normal: {:.2} blocks/s", block_production_rate),
                    )
                };
                
                let result = HealthCheckResult {
                    id: "node_block_production".to_string(),
                    name: "Block Production".to_string(),
                    description: "Check node block production rate".to_string(),
                    check_type: HealthCheckType::Node,
                    status,
                    message,
                    details: Some(serde_json::json!({
                        "block_production_rate": block_production_rate,
                        "threshold_warning": 0.8,
                        "threshold_critical": 0.5,
                    })),
                    timestamp: current_timestamp(),
                    duration_ms: 0,
                    tags: vec!["node".to_string(), "block".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    // Transaction processing check
    if let Some(tx_processing_family) = metrics.get("node_transaction_processing") {
        if let Some(tx_processing_metric) = tx_processing_family.metrics.first() {
            if let crate::monitoring::MetricValue::Float(tx_processing_rate) = tx_processing_metric.value {
                let (status, message) = if tx_processing_rate < 10.0 {
                    (
                        HealthStatus::Critical,
                        format!("Transaction processing rate is critically low: {:.2} tx/s", tx_processing_rate),
                    )
                } else if tx_processing_rate < 50.0 {
                    (
                        HealthStatus::Warning,
                        format!("Transaction processing rate is low: {:.2} tx/s", tx_processing_rate),
                    )
                } else {
                    (
                        HealthStatus::Healthy,
                        format!("Transaction processing rate is normal: {:.2} tx/s", tx_processing_rate),
                    )
                };
                
                let result = HealthCheckResult {
                    id: "node_transaction_processing".to_string(),
                    name: "Transaction Processing".to_string(),
                    description: "Check node transaction processing rate".to_string(),
                    check_type: HealthCheckType::Node,
                    status,
                    message,
                    details: Some(serde_json::json!({
                        "tx_processing_rate": tx_processing_rate,
                        "threshold_warning": 50.0,
                        "threshold_critical": 10.0,
                    })),
                    timestamp: current_timestamp(),
                    duration_ms: 0,
                    tags: vec!["node".to_string(), "transaction".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    results
}

/// Run network health checks
fn run_network_health_checks(metrics: &HashMap<String, crate::monitoring::MetricFamily>) -> Vec<HealthCheckResult> {
    let mut results = Vec::new();
    
    // Peer count check
    if let Some(peer_count_family) = metrics.get("network_peer_count") {
        if let Some(peer_count_metric) = peer_count_family.metrics.first() {
            if let crate::monitoring::MetricValue::Float(peer_count) = peer_count_metric.value {
                let (status, message) = if peer_count < 3.0 {
                    (
                        HealthStatus::Critical,
                        format!("Peer count is critically low: {:.0}", peer_count),
                    )
                } else if peer_count < 5.0 {
                    (
                        HealthStatus::Warning,
                        format!("Peer count is low: {:.0}", peer_count),
                    )
                } else {
                    (
                        HealthStatus::Healthy,
                        format!("Peer count is normal: {:.0}", peer_count),
                    )
                };
                
                let result = HealthCheckResult {
                    id: "network_peer_count".to_string(),
                    name: "Peer Count".to_string(),
                    description: "Check network peer count".to_string(),
                    check_type: HealthCheckType::Network,
                    status,
                    message,
                    details: Some(serde_json::json!({
                        "peer_count": peer_count,
                        "threshold_warning": 5.0,
                        "threshold_critical": 3.0,
                    })),
                    timestamp: current_timestamp(),
                    duration_ms: 0,
                    tags: vec!["network".to_string(), "peer".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    // Network latency check
    if let Some(latency_family) = metrics.get("network_latency") {
        if let Some(latency_metric) = latency_family.metrics.first() {
            if let crate::monitoring::MetricValue::Float(latency) = latency_metric.value {
                let (status, message) = if latency > 1000.0 {
                    (
                        HealthStatus::Critical,
                        format!("Network latency is critically high: {:.2} ms", latency),
                    )
                } else if latency > 500.0 {
                    (
                        HealthStatus::Warning,
                        format!("Network latency is high: {:.2} ms", latency),
                    )
                } else {
                    (
                        HealthStatus::Healthy,
                        format!("Network latency is normal: {:.2} ms", latency),
                    )
                };
                
                let result = HealthCheckResult {
                    id: "network_latency".to_string(),
                    name: "Network Latency".to_string(),
                    description: "Check network latency".to_string(),
                    check_type: HealthCheckType::Network,
                    status,
                    message,
                    details: Some(serde_json::json!({
                        "latency": latency,
                        "threshold_warning": 500.0,
                        "threshold_critical": 1000.0,
                    })),
                    timestamp: current_timestamp(),
                    duration_ms: 0,
                    tags: vec!["network".to_string(), "latency".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    results
}

/// Run contract health checks
fn run_contract_health_checks(metrics: &HashMap<String, crate::monitoring::MetricFamily>) -> Vec<HealthCheckResult> {
    let mut results = Vec::new();
    
    // Contract error rate check
    if let Some(error_rate_family) = metrics.get("contract_error_rate") {
        if let Some(error_rate_metric) = error_rate_family.metrics.first() {
            if let crate::monitoring::MetricValue::Float(error_rate) = error_rate_metric.value {
                let (status, message) = if error_rate > 5.0 {
                    (
                        HealthStatus::Critical,
                        format!("Contract error rate is critically high: {:.2}%", error_rate),
                    )
                } else if error_rate > 1.0 {
                    (
                        HealthStatus::Warning,
                        format!("Contract error rate is high: {:.2}%", error_rate),
                    )
                } else {
                    (
                        HealthStatus::Healthy,
                        format!("Contract error rate is normal: {:.2}%", error_rate),
                    )
                };
                
                let result = HealthCheckResult {
                    id: "contract_error_rate".to_string(),
                    name: "Contract Error Rate".to_string(),
                    description: "Check contract error rate".to_string(),
                    check_type: HealthCheckType::Contract,
                    status,
                    message,
                    details: Some(serde_json::json!({
                        "error_rate": error_rate,
                        "threshold_warning": 1.0,
                        "threshold_critical": 5.0,
                    })),
                    timestamp: current_timestamp(),
                    duration_ms: 0,
                    tags: vec!["contract".to_string(), "error".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    // Contract execution time check
    if let Some(execution_time_family) = metrics.get("contract_execution_time") {
        if let Some(execution_time_metric) = execution_time_family.metrics.first() {
            if let crate::monitoring::MetricValue::Histogram(execution_times) = &execution_time_metric.value {
                if !execution_times.is_empty() {
                    let avg_execution_time = execution_times.iter().sum::<f64>() / execution_times.len() as f64;
                    
                    let (status, message) = if avg_execution_time > 1000.0 {
                        (
                            HealthStatus::Critical,
                            format!("Contract execution time is critically high: {:.2} ms", avg_execution_time),
                        )
                    } else if avg_execution_time > 500.0 {
                        (
                            HealthStatus::Warning,
                            format!("Contract execution time is high: {:.2} ms", avg_execution_time),
                        )
                    } else {
                        (
                            HealthStatus::Healthy,
                            format!("Contract execution time is normal: {:.2} ms", avg_execution_time),
                        )
                    };
                    
                    let result = HealthCheckResult {
                        id: "contract_execution_time".to_string(),
                        name: "Contract Execution Time".to_string(),
                        description: "Check contract execution time".to_string(),
                        check_type: HealthCheckType::Contract,
                        status,
                        message,
                        details: Some(serde_json::json!({
                            "execution_time": avg_execution_time,
                            "threshold_warning": 500.0,
                            "threshold_critical": 1000.0,
                        })),
                        timestamp: current_timestamp(),
                        duration_ms: 0,
                        tags: vec!["contract".to_string(), "execution".to_string()],
                    };
                    
                    results.push(result);
                }
            }
        }
    }
    
    results
}

/// Run bridge health checks
fn run_bridge_health_checks(metrics: &HashMap<String, crate::monitoring::MetricFamily>) -> Vec<HealthCheckResult> {
    let mut results = Vec::new();
    
    // Bridge deposit success rate check
    if let Some(deposit_success_rate_family) = metrics.get("bridge_deposit_success_rate") {
        if let Some(deposit_success_rate_metric) = deposit_success_rate_family.metrics.first() {
            if let crate::monitoring::MetricValue::Float(deposit_success_rate) = deposit_success_rate_metric.value {
                let (status, message) = if deposit_success_rate < 95.0 {
                    (
                        HealthStatus::Critical,
                        format!("Bridge deposit success rate is critically low: {:.2}%", deposit_success_rate),
                    )
                } else if deposit_success_rate < 98.0 {
                    (
                        HealthStatus::Warning,
                        format!("Bridge deposit success rate is low: {:.2}%", deposit_success_rate),
                    )
                } else {
                    (
                        HealthStatus::Healthy,
                        format!("Bridge deposit success rate is normal: {:.2}%", deposit_success_rate),
                    )
                };
                
                let result = HealthCheckResult {
                    id: "bridge_deposit_success_rate".to_string(),
                    name: "Bridge Deposit Success Rate".to_string(),
                    description: "Check bridge deposit success rate".to_string(),
                    check_type: HealthCheckType::Bridge,
                    status,
                    message,
                    details: Some(serde_json::json!({
                        "deposit_success_rate": deposit_success_rate,
                        "threshold_warning": 98.0,
                        "threshold_critical": 95.0,
                    })),
                    timestamp: current_timestamp(),
                    duration_ms: 0,
                    tags: vec!["bridge".to_string(), "deposit".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    // Bridge withdrawal success rate check
    if let Some(withdrawal_success_rate_family) = metrics.get("bridge_withdrawal_success_rate") {
        if let Some(withdrawal_success_rate_metric) = withdrawal_success_rate_family.metrics.first() {
            if let crate::monitoring::MetricValue::Float(withdrawal_success_rate) = withdrawal_success_rate_metric.value {
                let (status, message) = if withdrawal_success_rate < 95.0 {
                    (
                        HealthStatus::Critical,
                        format!("Bridge withdrawal success rate is critically low: {:.2}%", withdrawal_success_rate),
                    )
                } else if withdrawal_success_rate < 98.0 {
                    (
                        HealthStatus::Warning,
                        format!("Bridge withdrawal success rate is low: {:.2}%", withdrawal_success_rate),
                    )
                } else {
                    (
                        HealthStatus::Healthy,
                        format!("Bridge withdrawal success rate is normal: {:.2}%", withdrawal_success_rate),
                    )
                };
                
                let result = HealthCheckResult {
                    id: "bridge_withdrawal_success_rate".to_string(),
                    name: "Bridge Withdrawal Success Rate".to_string(),
                    description: "Check bridge withdrawal success rate".to_string(),
                    check_type: HealthCheckType::Bridge,
                    status,
                    message,
                    details: Some(serde_json::json!({
                        "withdrawal_success_rate": withdrawal_success_rate,
                        "threshold_warning": 98.0,
                        "threshold_critical": 95.0,
                    })),
                    timestamp: current_timestamp(),
                    duration_ms: 0,
                    tags: vec!["bridge".to_string(), "withdrawal".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    results
}

/// Run data availability health checks
fn run_data_availability_health_checks(metrics: &HashMap<String, crate::monitoring::MetricFamily>) -> Vec<HealthCheckResult> {
    let mut results = Vec::new();
    
    // Data availability success rate check
    if let Some(data_availability_success_rate_family) = metrics.get("data_availability_success_rate") {
        if let Some(data_availability_success_rate_metric) = data_availability_success_rate_family.metrics.first() {
            if let crate::monitoring::MetricValue::Float(data_availability_success_rate) = data_availability_success_rate_metric.value {
                let (status, message) = if data_availability_success_rate < 95.0 {
                    (
                        HealthStatus::Critical,
                        format!("Data availability success rate is critically low: {:.2}%", data_availability_success_rate),
                    )
                } else if data_availability_success_rate < 98.0 {
                    (
                        HealthStatus::Warning,
                        format!("Data availability success rate is low: {:.2}%", data_availability_success_rate),
                    )
                } else {
                    (
                        HealthStatus::Healthy,
                        format!("Data availability success rate is normal: {:.2}%", data_availability_success_rate),
                    )
                };
                
                let result = HealthCheckResult {
                    id: "data_availability_success_rate".to_string(),
                    name: "Data Availability Success Rate".to_string(),
                    description: "Check data availability success rate".to_string(),
                    check_type: HealthCheckType::DataAvailability,
                    status,
                    message,
                    details: Some(serde_json::json!({
                        "data_availability_success_rate": data_availability_success_rate,
                        "threshold_warning": 98.0,
                        "threshold_critical": 95.0,
                    })),
                    timestamp: current_timestamp(),
                    duration_ms: 0,
                    tags: vec!["data_availability".to_string(), "success_rate".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    results
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
    fn test_health_status_display() {
        assert_eq!(format!("{}", HealthStatus::Healthy), "HEALTHY");
        assert_eq!(format!("{}", HealthStatus::Warning), "WARNING");
        assert_eq!(format!("{}", HealthStatus::Critical), "CRITICAL");
        assert_eq!(format!("{}", HealthStatus::Unknown), "UNKNOWN");
    }
    
    #[test]
    fn test_health_check_type_display() {
        assert_eq!(format!("{}", HealthCheckType::System), "SYSTEM");
        assert_eq!(format!("{}", HealthCheckType::Node), "NODE");
        assert_eq!(format!("{}", HealthCheckType::Network), "NETWORK");
        assert_eq!(format!("{}", HealthCheckType::Contract), "CONTRACT");
        assert_eq!(format!("{}", HealthCheckType::Bridge), "BRIDGE");
        assert_eq!(format!("{}", HealthCheckType::DataAvailability), "DATA_AVAILABILITY");
    }
    
    #[test]
    fn test_health_check_manager() {
        let manager = HealthCheckManager::new(60);
        
        assert!(!manager.is_running());
        
        // Test result retrieval methods
        assert!(manager.get_result("test_result").is_none());
        assert!(manager.get_all_results().is_empty());
        assert!(manager.get_results_by_type(HealthCheckType::System).is_empty());
        assert!(manager.get_results_by_status(HealthStatus::Healthy).is_empty());
        assert!(manager.get_results_by_tag("test_tag").is_empty());
        assert!(manager.get_history().is_empty());
        assert!(manager.get_check_history("test_result").is_empty());
        
        // Test overall status
        assert_eq!(manager.get_overall_status(), HealthStatus::Unknown);
    }
}
