// src/monitoring/analytics.rs
//! Analytics Module for Layer-2 on Solana
//!
//! This module provides comprehensive analytics capabilities:
//! - Performance analytics
//! - Transaction analytics
//! - User analytics
//! - Economic analytics
//! - Security analytics
//! - Trend analysis
//! - Anomaly detection
//!
//! The analytics engine processes metrics data to extract insights
//! and identify patterns that can help improve the Layer-2 platform.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use serde::{Serialize, Deserialize};
use thiserror::Error;
use tokio::sync::mpsc;
use tokio::time;

use crate::monitoring::{AlertManager, MetricsCollector, MetricFamily, MetricValue};

/// Analytics type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AnalyticsType {
    /// Performance analytics
    Performance,
    
    /// Transaction analytics
    Transaction,
    
    /// User analytics
    User,
    
    /// Economic analytics
    Economic,
    
    /// Security analytics
    Security,
    
    /// Network analytics
    Network,
}

/// Time window for analytics
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TimeWindow {
    /// Last hour
    Hour,
    
    /// Last day
    Day,
    
    /// Last week
    Week,
    
    /// Last month
    Month,
    
    /// Custom time window
    Custom(u64), // seconds
}

impl TimeWindow {
    /// Get the duration in seconds
    pub fn duration_secs(&self) -> u64 {
        match self {
            TimeWindow::Hour => 3600,
            TimeWindow::Day => 86400,
            TimeWindow::Week => 604800,
            TimeWindow::Month => 2592000,
            TimeWindow::Custom(secs) => *secs,
        }
    }
    
    /// Get the start timestamp for this window
    pub fn start_timestamp(&self) -> u64 {
        let now = current_timestamp();
        now.saturating_sub(self.duration_secs())
    }
}

/// Analytics result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyticsResult {
    /// Analytics type
    pub analytics_type: AnalyticsType,
    
    /// Time window
    pub time_window: TimeWindow,
    
    /// Result name
    pub name: String,
    
    /// Result description
    pub description: String,
    
    /// Result value
    pub value: AnalyticsValue,
    
    /// Result timestamp
    pub timestamp: u64,
    
    /// Result tags
    pub tags: Vec<String>,
}

/// Analytics value
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AnalyticsValue {
    /// Integer value
    Integer(i64),
    
    /// Float value
    Float(f64),
    
    /// Boolean value
    Boolean(bool),
    
    /// String value
    String(String),
    
    /// Time series data (timestamp, value)
    TimeSeries(Vec<(u64, f64)>),
    
    /// Distribution data (value, count)
    Distribution(Vec<(f64, u64)>),
    
    /// Key-value pairs
    KeyValue(HashMap<String, f64>),
    
    /// Complex object
    Object(serde_json::Value),
}

/// Analytics engine configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyticsEngineConfig {
    /// Processing interval in seconds
    pub interval: u64,
    
    /// Maximum results history to keep
    pub max_history: usize,
    
    /// Enable performance analytics
    pub enable_performance_analytics: bool,
    
    /// Enable transaction analytics
    pub enable_transaction_analytics: bool,
    
    /// Enable user analytics
    pub enable_user_analytics: bool,
    
    /// Enable economic analytics
    pub enable_economic_analytics: bool,
    
    /// Enable security analytics
    pub enable_security_analytics: bool,
    
    /// Enable network analytics
    pub enable_network_analytics: bool,
    
    /// Enable anomaly detection
    pub enable_anomaly_detection: bool,
    
    /// Anomaly detection sensitivity (0.0-1.0)
    pub anomaly_detection_sensitivity: f64,
}

impl Default for AnalyticsEngineConfig {
    fn default() -> Self {
        Self {
            interval: 60,
            max_history: 1000,
            enable_performance_analytics: true,
            enable_transaction_analytics: true,
            enable_user_analytics: true,
            enable_economic_analytics: true,
            enable_security_analytics: true,
            enable_network_analytics: true,
            enable_anomaly_detection: true,
            anomaly_detection_sensitivity: 0.8,
        }
    }
}

/// Analytics engine
pub struct AnalyticsEngine {
    /// Results storage
    results: Arc<RwLock<HashMap<String, AnalyticsResult>>>,
    
    /// Results history
    history: Arc<RwLock<VecDeque<(u64, HashMap<String, AnalyticsResult>)>>>,
    
    /// Running status
    running: Arc<Mutex<bool>>,
    
    /// Shutdown channel
    shutdown_tx: Option<mpsc::Sender<()>>,
    
    /// Processing interval
    interval: Duration,
    
    /// Configuration
    config: AnalyticsEngineConfig,
}

impl AnalyticsEngine {
    /// Create a new analytics engine with the default configuration
    pub fn new(interval_seconds: u64) -> Self {
        let mut config = AnalyticsEngineConfig::default();
        config.interval = interval_seconds;
        
        Self::with_config(config)
    }
    
    /// Create a new analytics engine with the given configuration
    pub fn with_config(config: AnalyticsEngineConfig) -> Self {
        Self {
            interval: Duration::from_secs(config.interval),
            config,
            results: Arc::new(RwLock::new(HashMap::new())),
            history: Arc::new(RwLock::new(VecDeque::new())),
            running: Arc::new(Mutex::new(false)),
            shutdown_tx: None,
        }
    }
    
    /// Start the analytics engine
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
        
        // Spawn processing task
        tokio::spawn(async move {
            let mut interval_timer = time::interval(interval);
            
            loop {
                tokio::select! {
                    _ = interval_timer.tick() => {
                        // Get all metrics
                        let metrics = metrics_collector.get_all_metrics();
                        
                        // Process analytics
                        let mut new_results = HashMap::new();
                        
                        // Performance analytics
                        if config.enable_performance_analytics {
                            let performance_results = process_performance_analytics(&metrics);
                            for result in performance_results {
                                new_results.insert(result.name.clone(), result);
                            }
                        }
                        
                        // Transaction analytics
                        if config.enable_transaction_analytics {
                            let transaction_results = process_transaction_analytics(&metrics);
                            for result in transaction_results {
                                new_results.insert(result.name.clone(), result);
                            }
                        }
                        
                        // User analytics
                        if config.enable_user_analytics {
                            let user_results = process_user_analytics(&metrics);
                            for result in user_results {
                                new_results.insert(result.name.clone(), result);
                            }
                        }
                        
                        // Economic analytics
                        if config.enable_economic_analytics {
                            let economic_results = process_economic_analytics(&metrics);
                            for result in economic_results {
                                new_results.insert(result.name.clone(), result);
                            }
                        }
                        
                        // Security analytics
                        if config.enable_security_analytics {
                            let security_results = process_security_analytics(&metrics);
                            for result in security_results {
                                new_results.insert(result.name.clone(), result);
                            }
                        }
                        
                        // Network analytics
                        if config.enable_network_analytics {
                            let network_results = process_network_analytics(&metrics);
                            for result in network_results {
                                new_results.insert(result.name.clone(), result);
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
                        
                        // Anomaly detection
                        if config.enable_anomaly_detection {
                            let anomalies = detect_anomalies(&new_results, &history_write, config.anomaly_detection_sensitivity);
                            
                            // Send alerts for anomalies
                            for anomaly in anomalies {
                                alert_manager.send_alert(
                                    &format!("Anomaly detected: {}", anomaly.name),
                                    &format!("Anomaly in {}: {}", anomaly.name, anomaly.description),
                                    crate::monitoring::AlertSeverity::Warning,
                                );
                            }
                        }
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
    
    /// Stop the analytics engine
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
    
    /// Check if the analytics engine is running
    pub fn is_running(&self) -> bool {
        let running = self.running.lock().unwrap();
        *running
    }
    
    /// Get a result by name
    pub fn get_result(&self, name: &str) -> Option<AnalyticsResult> {
        let results = self.results.read().unwrap();
        results.get(name).cloned()
    }
    
    /// Get all results
    pub fn get_all_results(&self) -> HashMap<String, AnalyticsResult> {
        let results = self.results.read().unwrap();
        results.clone()
    }
    
    /// Get results by type
    pub fn get_results_by_type(&self, analytics_type: AnalyticsType) -> Vec<AnalyticsResult> {
        let results = self.results.read().unwrap();
        results.values()
            .filter(|r| r.analytics_type == analytics_type)
            .cloned()
            .collect()
    }
    
    /// Get results by tag
    pub fn get_results_by_tag(&self, tag: &str) -> Vec<AnalyticsResult> {
        let results = self.results.read().unwrap();
        results.values()
            .filter(|r| r.tags.contains(&tag.to_string()))
            .cloned()
            .collect()
    }
    
    /// Get results history
    pub fn get_history(&self) -> Vec<(u64, HashMap<String, AnalyticsResult>)> {
        let history = self.history.read().unwrap();
        history.iter().cloned().collect()
    }
    
    /// Get result history for a specific result
    pub fn get_result_history(&self, name: &str) -> Vec<(u64, Option<AnalyticsResult>)> {
        let history = self.history.read().unwrap();
        history.iter()
            .map(|(timestamp, results)| (*timestamp, results.get(name).cloned()))
            .collect()
    }
    
    /// Clear all results
    pub fn clear_results(&self) {
        let mut results = self.results.write().unwrap();
        results.clear();
        
        let mut history = self.history.write().unwrap();
        history.clear();
    }
}

/// Process performance analytics
fn process_performance_analytics(metrics: &HashMap<String, MetricFamily>) -> Vec<AnalyticsResult> {
    let mut results = Vec::new();
    
    // CPU usage trend
    if let Some(cpu_family) = metrics.get("system_cpu_usage") {
        if let Some(cpu_metric) = cpu_family.metrics.first() {
            if let MetricValue::Float(cpu_usage) = cpu_metric.value {
                let result = AnalyticsResult {
                    analytics_type: AnalyticsType::Performance,
                    time_window: TimeWindow::Hour,
                    name: "cpu_usage_trend".to_string(),
                    description: "CPU usage trend over time".to_string(),
                    value: AnalyticsValue::Float(cpu_usage),
                    timestamp: current_timestamp(),
                    tags: vec!["performance".to_string(), "system".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    // Memory usage trend
    if let Some(memory_family) = metrics.get("system_memory_usage") {
        if let Some(memory_metric) = memory_family.metrics.first() {
            if let MetricValue::Float(memory_usage) = memory_metric.value {
                let result = AnalyticsResult {
                    analytics_type: AnalyticsType::Performance,
                    time_window: TimeWindow::Hour,
                    name: "memory_usage_trend".to_string(),
                    description: "Memory usage trend over time".to_string(),
                    value: AnalyticsValue::Float(memory_usage),
                    timestamp: current_timestamp(),
                    tags: vec!["performance".to_string(), "system".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    // Transaction processing rate
    if let Some(tx_processing_family) = metrics.get("node_transaction_processing") {
        if let Some(tx_processing_metric) = tx_processing_family.metrics.first() {
            if let MetricValue::Float(tx_processing_rate) = tx_processing_metric.value {
                let result = AnalyticsResult {
                    analytics_type: AnalyticsType::Performance,
                    time_window: TimeWindow::Hour,
                    name: "transaction_processing_rate_trend".to_string(),
                    description: "Transaction processing rate trend over time".to_string(),
                    value: AnalyticsValue::Float(tx_processing_rate),
                    timestamp: current_timestamp(),
                    tags: vec!["performance".to_string(), "transaction".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    // Block production rate
    if let Some(block_production_family) = metrics.get("node_block_production") {
        if let Some(block_production_metric) = block_production_family.metrics.first() {
            if let MetricValue::Float(block_production_rate) = block_production_metric.value {
                let result = AnalyticsResult {
                    analytics_type: AnalyticsType::Performance,
                    time_window: TimeWindow::Hour,
                    name: "block_production_rate_trend".to_string(),
                    description: "Block production rate trend over time".to_string(),
                    value: AnalyticsValue::Float(block_production_rate),
                    timestamp: current_timestamp(),
                    tags: vec!["performance".to_string(), "block".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    // Contract execution time
    if let Some(contract_execution_family) = metrics.get("contract_execution_time") {
        if let Some(contract_execution_metric) = contract_execution_family.metrics.first() {
            if let MetricValue::Histogram(execution_times) = &contract_execution_metric.value {
                if !execution_times.is_empty() {
                    let avg_execution_time = execution_times.iter().sum::<f64>() / execution_times.len() as f64;
                    
                    let result = AnalyticsResult {
                        analytics_type: AnalyticsType::Performance,
                        time_window: TimeWindow::Hour,
                        name: "contract_execution_time_trend".to_string(),
                        description: "Contract execution time trend over time".to_string(),
                        value: AnalyticsValue::Float(avg_execution_time),
                        timestamp: current_timestamp(),
                        tags: vec!["performance".to_string(), "contract".to_string()],
                    };
                    
                    results.push(result);
                }
            }
        }
    }
    
    results
}

/// Process transaction analytics
fn process_transaction_analytics(metrics: &HashMap<String, MetricFamily>) -> Vec<AnalyticsResult> {
    let mut results = Vec::new();
    
    // Transaction throughput
    if let Some(throughput_family) = metrics.get("transaction_throughput") {
        if let Some(throughput_metric) = throughput_family.metrics.first() {
            if let MetricValue::Float(throughput) = throughput_metric.value {
                let result = AnalyticsResult {
                    analytics_type: AnalyticsType::Transaction,
                    time_window: TimeWindow::Hour,
                    name: "transaction_throughput_trend".to_string(),
                    description: "Transaction throughput trend over time".to_string(),
                    value: AnalyticsValue::Float(throughput),
                    timestamp: current_timestamp(),
                    tags: vec!["transaction".to_string(), "throughput".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    // Transaction latency
    if let Some(latency_family) = metrics.get("transaction_latency") {
        if let Some(latency_metric) = latency_family.metrics.first() {
            if let MetricValue::Histogram(latencies) = &latency_metric.value {
                if !latencies.is_empty() {
                    let avg_latency = latencies.iter().sum::<f64>() / latencies.len() as f64;
                    
                    let result = AnalyticsResult {
                        analytics_type: AnalyticsType::Transaction,
                        time_window: TimeWindow::Hour,
                        name: "transaction_latency_trend".to_string(),
                        description: "Transaction latency trend over time".to_string(),
                        value: AnalyticsValue::Float(avg_latency),
                        timestamp: current_timestamp(),
                        tags: vec!["transaction".to_string(), "latency".to_string()],
                    };
                    
                    results.push(result);
                    
                    // Latency distribution
                    let mut distribution = Vec::new();
                    let mut latencies_sorted = latencies.clone();
                    latencies_sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                    
                    let p50_idx = (latencies_sorted.len() as f64 * 0.5) as usize;
                    let p90_idx = (latencies_sorted.len() as f64 * 0.9) as usize;
                    let p95_idx = (latencies_sorted.len() as f64 * 0.95) as usize;
                    let p99_idx = (latencies_sorted.len() as f64 * 0.99) as usize;
                    
                    let p50 = latencies_sorted.get(p50_idx).cloned().unwrap_or(0.0);
                    let p90 = latencies_sorted.get(p90_idx).cloned().unwrap_or(0.0);
                    let p95 = latencies_sorted.get(p95_idx).cloned().unwrap_or(0.0);
                    let p99 = latencies_sorted.get(p99_idx).cloned().unwrap_or(0.0);
                    
                    let mut percentiles = HashMap::new();
                    percentiles.insert("p50".to_string(), p50);
                    percentiles.insert("p90".to_string(), p90);
                    percentiles.insert("p95".to_string(), p95);
                    percentiles.insert("p99".to_string(), p99);
                    
                    let result = AnalyticsResult {
                        analytics_type: AnalyticsType::Transaction,
                        time_window: TimeWindow::Hour,
                        name: "transaction_latency_percentiles".to_string(),
                        description: "Transaction latency percentiles".to_string(),
                        value: AnalyticsValue::KeyValue(percentiles),
                        timestamp: current_timestamp(),
                        tags: vec!["transaction".to_string(), "latency".to_string(), "percentiles".to_string()],
                    };
                    
                    results.push(result);
                }
            }
        }
    }
    
    // Transaction success rate
    if let Some(success_rate_family) = metrics.get("transaction_success_rate") {
        if let Some(success_rate_metric) = success_rate_family.metrics.first() {
            if let MetricValue::Float(success_rate) = success_rate_metric.value {
                let result = AnalyticsResult {
                    analytics_type: AnalyticsType::Transaction,
                    time_window: TimeWindow::Hour,
                    name: "transaction_success_rate_trend".to_string(),
                    description: "Transaction success rate trend over time".to_string(),
                    value: AnalyticsValue::Float(success_rate),
                    timestamp: current_timestamp(),
                    tags: vec!["transaction".to_string(), "success_rate".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    // Transaction fee
    if let Some(fee_family) = metrics.get("transaction_fee") {
        if let Some(fee_metric) = fee_family.metrics.first() {
            if let MetricValue::Float(fee) = fee_metric.value {
                let result = AnalyticsResult {
                    analytics_type: AnalyticsType::Transaction,
                    time_window: TimeWindow::Hour,
                    name: "transaction_fee_trend".to_string(),
                    description: "Transaction fee trend over time".to_string(),
                    value: AnalyticsValue::Float(fee),
                    timestamp: current_timestamp(),
                    tags: vec!["transaction".to_string(), "fee".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    results
}

/// Process user analytics
fn process_user_analytics(metrics: &HashMap<String, MetricFamily>) -> Vec<AnalyticsResult> {
    // This is a placeholder for actual user analytics processing
    // In a real implementation, this would process user-related metrics
    
    Vec::new()
}

/// Process economic analytics
fn process_economic_analytics(metrics: &HashMap<String, MetricFamily>) -> Vec<AnalyticsResult> {
    let mut results = Vec::new();
    
    // Bridge transfer volume
    if let Some(transfer_volume_family) = metrics.get("bridge_transfer_volume") {
        if let Some(transfer_volume_metric) = transfer_volume_family.metrics.first() {
            if let MetricValue::Integer(transfer_volume) = transfer_volume_metric.value {
                let result = AnalyticsResult {
                    analytics_type: AnalyticsType::Economic,
                    time_window: TimeWindow::Day,
                    name: "bridge_transfer_volume_trend".to_string(),
                    description: "Bridge transfer volume trend over time".to_string(),
                    value: AnalyticsValue::Integer(transfer_volume),
                    timestamp: current_timestamp(),
                    tags: vec!["economic".to_string(), "bridge".to_string(), "volume".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    // Transaction fee revenue
    if let Some(fee_family) = metrics.get("transaction_fee") {
        if let Some(fee_metric) = fee_family.metrics.first() {
            if let MetricValue::Float(fee) = fee_metric.value {
                // Estimate daily revenue based on fee and throughput
                if let Some(throughput_family) = metrics.get("transaction_throughput") {
                    if let Some(throughput_metric) = throughput_family.metrics.first() {
                        if let MetricValue::Float(throughput) = throughput_metric.value {
                            let daily_transactions = throughput * 86400.0; // transactions per day
                            let daily_revenue = fee * daily_transactions;
                            
                            let result = AnalyticsResult {
                                analytics_type: AnalyticsType::Economic,
                                time_window: TimeWindow::Day,
                                name: "transaction_fee_revenue_estimate".to_string(),
                                description: "Estimated daily transaction fee revenue".to_string(),
                                value: AnalyticsValue::Float(daily_revenue),
                                timestamp: current_timestamp(),
                                tags: vec!["economic".to_string(), "fee".to_string(), "revenue".to_string()],
                            };
                            
                            results.push(result);
                        }
                    }
                }
            }
        }
    }
    
    results
}

/// Process security analytics
fn process_security_analytics(metrics: &HashMap<String, MetricFamily>) -> Vec<AnalyticsResult> {
    let mut results = Vec::new();
    
    // Contract error rate
    if let Some(error_rate_family) = metrics.get("contract_error_rate") {
        if let Some(error_rate_metric) = error_rate_family.metrics.first() {
            if let MetricValue::Float(error_rate) = error_rate_metric.value {
                let result = AnalyticsResult {
                    analytics_type: AnalyticsType::Security,
                    time_window: TimeWindow::Hour,
                    name: "contract_error_rate_trend".to_string(),
                    description: "Contract error rate trend over time".to_string(),
                    value: AnalyticsValue::Float(error_rate),
                    timestamp: current_timestamp(),
                    tags: vec!["security".to_string(), "contract".to_string(), "error_rate".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    results
}

/// Process network analytics
fn process_network_analytics(metrics: &HashMap<String, MetricFamily>) -> Vec<AnalyticsResult> {
    let mut results = Vec::new();
    
    // Peer count
    if let Some(peer_count_family) = metrics.get("network_peer_count") {
        if let Some(peer_count_metric) = peer_count_family.metrics.first() {
            if let MetricValue::Float(peer_count) = peer_count_metric.value {
                let result = AnalyticsResult {
                    analytics_type: AnalyticsType::Network,
                    time_window: TimeWindow::Hour,
                    name: "network_peer_count_trend".to_string(),
                    description: "Network peer count trend over time".to_string(),
                    value: AnalyticsValue::Float(peer_count),
                    timestamp: current_timestamp(),
                    tags: vec!["network".to_string(), "peer_count".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    // Network latency
    if let Some(latency_family) = metrics.get("network_latency") {
        if let Some(latency_metric) = latency_family.metrics.first() {
            if let MetricValue::Float(latency) = latency_metric.value {
                let result = AnalyticsResult {
                    analytics_type: AnalyticsType::Network,
                    time_window: TimeWindow::Hour,
                    name: "network_latency_trend".to_string(),
                    description: "Network latency trend over time".to_string(),
                    value: AnalyticsValue::Float(latency),
                    timestamp: current_timestamp(),
                    tags: vec!["network".to_string(), "latency".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    // Message propagation time
    if let Some(propagation_family) = metrics.get("network_propagation_time") {
        if let Some(propagation_metric) = propagation_family.metrics.first() {
            if let MetricValue::Histogram(propagation_times) = &propagation_metric.value {
                if !propagation_times.is_empty() {
                    let avg_propagation_time = propagation_times.iter().sum::<f64>() / propagation_times.len() as f64;
                    
                    let result = AnalyticsResult {
                        analytics_type: AnalyticsType::Network,
                        time_window: TimeWindow::Hour,
                        name: "network_propagation_time_trend".to_string(),
                        description: "Network message propagation time trend over time".to_string(),
                        value: AnalyticsValue::Float(avg_propagation_time),
                        timestamp: current_timestamp(),
                        tags: vec!["network".to_string(), "propagation".to_string()],
                    };
                    
                    results.push(result);
                }
            }
        }
    }
    
    // Network bandwidth
    if let Some(bandwidth_family) = metrics.get("network_bandwidth") {
        if let Some(bandwidth_metric) = bandwidth_family.metrics.first() {
            if let MetricValue::Float(bandwidth) = bandwidth_metric.value {
                let result = AnalyticsResult {
                    analytics_type: AnalyticsType::Network,
                    time_window: TimeWindow::Hour,
                    name: "network_bandwidth_trend".to_string(),
                    description: "Network bandwidth trend over time".to_string(),
                    value: AnalyticsValue::Float(bandwidth),
                    timestamp: current_timestamp(),
                    tags: vec!["network".to_string(), "bandwidth".to_string()],
                };
                
                results.push(result);
            }
        }
    }
    
    results
}

/// Anomaly detection
#[derive(Debug, Clone)]
struct Anomaly {
    /// Anomaly name
    name: String,
    
    /// Anomaly description
    description: String,
    
    /// Anomaly value
    value: f64,
    
    /// Expected value
    expected: f64,
    
    /// Deviation percentage
    deviation: f64,
}

/// Detect anomalies in analytics results
fn detect_anomalies(
    current_results: &HashMap<String, AnalyticsResult>,
    history: &VecDeque<(u64, HashMap<String, AnalyticsResult>)>,
    sensitivity: f64,
) -> Vec<Anomaly> {
    let mut anomalies = Vec::new();
    
    // For each current result
    for (name, result) in current_results {
        // Get historical values for this result
        let historical_values: Vec<f64> = history.iter()
            .filter_map(|(_, results)| {
                results.get(name).and_then(|r| match &r.value {
                    AnalyticsValue::Integer(i) => Some(*i as f64),
                    AnalyticsValue::Float(f) => Some(*f),
                    _ => None,
                })
            })
            .collect();
        
        // Need at least 5 historical values for anomaly detection
        if historical_values.len() < 5 {
            continue;
        }
        
        // Get current value
        let current_value = match &result.value {
            AnalyticsValue::Integer(i) => *i as f64,
            AnalyticsValue::Float(f) => *f,
            _ => continue,
        };
        
        // Calculate mean and standard deviation
        let mean = historical_values.iter().sum::<f64>() / historical_values.len() as f64;
        let variance = historical_values.iter()
            .map(|v| (*v - mean).powi(2))
            .sum::<f64>() / historical_values.len() as f64;
        let std_dev = variance.sqrt();
        
        // Calculate z-score
        let z_score = (current_value - mean) / std_dev;
        
        // Adjust threshold based on sensitivity
        let threshold = 3.0 * (1.0 - sensitivity + 0.5);
        
        // Check if z-score exceeds threshold
        if z_score.abs() > threshold {
            let deviation = ((current_value - mean) / mean * 100.0).abs();
            
            let anomaly = Anomaly {
                name: name.clone(),
                description: format!(
                    "Value {} is {:.2}% {} than expected ({:.2})",
                    current_value,
                    deviation,
                    if current_value > mean { "higher" } else { "lower" },
                    mean
                ),
                value: current_value,
                expected: mean,
                deviation,
            };
            
            anomalies.push(anomaly);
        }
    }
    
    anomalies
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
    fn test_time_window() {
        assert_eq!(TimeWindow::Hour.duration_secs(), 3600);
        assert_eq!(TimeWindow::Day.duration_secs(), 86400);
        assert_eq!(TimeWindow::Week.duration_secs(), 604800);
        assert_eq!(TimeWindow::Month.duration_secs(), 2592000);
        assert_eq!(TimeWindow::Custom(123).duration_secs(), 123);
        
        let now = current_timestamp();
        assert!(TimeWindow::Hour.start_timestamp() <= now);
        assert!(now - TimeWindow::Hour.start_timestamp() <= 3600);
    }
    
    #[test]
    fn test_analytics_engine() {
        let engine = AnalyticsEngine::new(60);
        
        assert!(!engine.is_running());
        
        // Test result retrieval methods
        assert!(engine.get_result("test_result").is_none());
        assert!(engine.get_all_results().is_empty());
        assert!(engine.get_results_by_type(AnalyticsType::Performance).is_empty());
        assert!(engine.get_results_by_tag("test_tag").is_empty());
        assert!(engine.get_history().is_empty());
        assert!(engine.get_result_history("test_result").is_empty());
    }
}
