// src/developer_tools/monitoring.rs
//! Monitoring module for Layer-2 on Solana Developer Tools
//! 
//! This module provides monitoring and analytics tools for developers to track
//! the performance and health of their applications on the Layer-2 platform:
//! - Real-time metrics collection
//! - Performance dashboards
//! - Alert systems
//! - Log aggregation and analysis
//! - Health checks and status reporting
//!
//! These tools are designed to help developers monitor their applications
//! in development and production environments.

use solana_program::{
    program_error::ProgramError,
    msg,
};
use std::collections::{HashMap, VecDeque};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Metric type
#[derive(Debug, Clone, PartialEq)]
pub enum MetricType {
    /// Counter (monotonically increasing)
    Counter,
    
    /// Gauge (can increase or decrease)
    Gauge,
    
    /// Histogram (distribution of values)
    Histogram,
    
    /// Timer (duration measurements)
    Timer,
}

/// Metric value
#[derive(Debug, Clone, PartialEq)]
pub enum MetricValue {
    /// Integer value
    Integer(i64),
    
    /// Float value
    Float(f64),
    
    /// Duration value
    Duration(Duration),
    
    /// Histogram values
    Histogram(Vec<f64>),
}

/// Metric data point
#[derive(Debug, Clone)]
pub struct MetricDataPoint {
    /// Timestamp (seconds since epoch)
    pub timestamp: u64,
    
    /// Metric name
    pub name: String,
    
    /// Metric type
    pub metric_type: MetricType,
    
    /// Metric value
    pub value: MetricValue,
    
    /// Metric tags
    pub tags: HashMap<String, String>,
}

impl MetricDataPoint {
    /// Create a new metric data point
    pub fn new(name: &str, metric_type: MetricType, value: MetricValue) -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::from_secs(0))
            .as_secs();
        
        Self {
            timestamp,
            name: name.to_string(),
            metric_type,
            value,
            tags: HashMap::new(),
        }
    }
    
    /// Add a tag to the metric
    pub fn with_tag(mut self, key: &str, value: &str) -> Self {
        self.tags.insert(key.to_string(), value.to_string());
        self
    }
    
    /// Add multiple tags to the metric
    pub fn with_tags(mut self, tags: HashMap<String, String>) -> Self {
        self.tags.extend(tags);
        self
    }
}

/// Alert severity
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
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

/// Alert status
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AlertStatus {
    /// Alert is active
    Active,
    
    /// Alert is resolved
    Resolved,
    
    /// Alert is acknowledged
    Acknowledged,
}

/// Alert
#[derive(Debug, Clone)]
pub struct Alert {
    /// Alert ID
    pub id: String,
    
    /// Alert name
    pub name: String,
    
    /// Alert description
    pub description: String,
    
    /// Alert severity
    pub severity: AlertSeverity,
    
    /// Alert status
    pub status: AlertStatus,
    
    /// Alert timestamp (seconds since epoch)
    pub timestamp: u64,
    
    /// Alert source
    pub source: String,
    
    /// Alert tags
    pub tags: HashMap<String, String>,
    
    /// Alert metadata
    pub metadata: HashMap<String, String>,
}

impl Alert {
    /// Create a new alert
    pub fn new(id: &str, name: &str, description: &str, severity: AlertSeverity) -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::from_secs(0))
            .as_secs();
        
        Self {
            id: id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            severity,
            status: AlertStatus::Active,
            timestamp,
            source: "unknown".to_string(),
            tags: HashMap::new(),
            metadata: HashMap::new(),
        }
    }
    
    /// Set the alert source
    pub fn with_source(mut self, source: &str) -> Self {
        self.source = source.to_string();
        self
    }
    
    /// Add a tag to the alert
    pub fn with_tag(mut self, key: &str, value: &str) -> Self {
        self.tags.insert(key.to_string(), value.to_string());
        self
    }
    
    /// Add multiple tags to the alert
    pub fn with_tags(mut self, tags: HashMap<String, String>) -> Self {
        self.tags.extend(tags);
        self
    }
    
    /// Add metadata to the alert
    pub fn with_metadata(mut self, key: &str, value: &str) -> Self {
        self.metadata.insert(key.to_string(), value.to_string());
        self
    }
    
    /// Add multiple metadata entries to the alert
    pub fn with_metadata_map(mut self, metadata: HashMap<String, String>) -> Self {
        self.metadata.extend(metadata);
        self
    }
    
    /// Resolve the alert
    pub fn resolve(&mut self) {
        self.status = AlertStatus::Resolved;
    }
    
    /// Acknowledge the alert
    pub fn acknowledge(&mut self) {
        self.status = AlertStatus::Acknowledged;
    }
}

/// Log level
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    /// Trace level
    Trace,
    
    /// Debug level
    Debug,
    
    /// Info level
    Info,
    
    /// Warning level
    Warning,
    
    /// Error level
    Error,
    
    /// Critical level
    Critical,
}

/// Log entry
#[derive(Debug, Clone)]
pub struct LogEntry {
    /// Log timestamp (seconds since epoch)
    pub timestamp: u64,
    
    /// Log level
    pub level: LogLevel,
    
    /// Log message
    pub message: String,
    
    /// Log source
    pub source: String,
    
    /// Log tags
    pub tags: HashMap<String, String>,
    
    /// Log metadata
    pub metadata: HashMap<String, String>,
}

impl LogEntry {
    /// Create a new log entry
    pub fn new(level: LogLevel, message: &str) -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::from_secs(0))
            .as_secs();
        
        Self {
            timestamp,
            level,
            message: message.to_string(),
            source: "unknown".to_string(),
            tags: HashMap::new(),
            metadata: HashMap::new(),
        }
    }
    
    /// Set the log source
    pub fn with_source(mut self, source: &str) -> Self {
        self.source = source.to_string();
        self
    }
    
    /// Add a tag to the log entry
    pub fn with_tag(mut self, key: &str, value: &str) -> Self {
        self.tags.insert(key.to_string(), value.to_string());
        self
    }
    
    /// Add multiple tags to the log entry
    pub fn with_tags(mut self, tags: HashMap<String, String>) -> Self {
        self.tags.extend(tags);
        self
    }
    
    /// Add metadata to the log entry
    pub fn with_metadata(mut self, key: &str, value: &str) -> Self {
        self.metadata.insert(key.to_string(), value.to_string());
        self
    }
    
    /// Add multiple metadata entries to the log entry
    pub fn with_metadata_map(mut self, metadata: HashMap<String, String>) -> Self {
        self.metadata.extend(metadata);
        self
    }
}

/// Health status
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HealthStatus {
    /// Healthy
    Healthy,
    
    /// Degraded
    Degraded,
    
    /// Unhealthy
    Unhealthy,
    
    /// Unknown
    Unknown,
}

/// Health check
#[derive(Debug, Clone)]
pub struct HealthCheck {
    /// Health check name
    pub name: String,
    
    /// Health check description
    pub description: String,
    
    /// Health check status
    pub status: HealthStatus,
    
    /// Health check timestamp (seconds since epoch)
    pub timestamp: u64,
    
    /// Health check details
    pub details: String,
    
    /// Health check tags
    pub tags: HashMap<String, String>,
}

impl HealthCheck {
    /// Create a new health check
    pub fn new(name: &str, description: &str, status: HealthStatus) -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::from_secs(0))
            .as_secs();
        
        Self {
            name: name.to_string(),
            description: description.to_string(),
            status,
            timestamp,
            details: String::new(),
            tags: HashMap::new(),
        }
    }
    
    /// Set the health check details
    pub fn with_details(mut self, details: &str) -> Self {
        self.details = details.to_string();
        self
    }
    
    /// Add a tag to the health check
    pub fn with_tag(mut self, key: &str, value: &str) -> Self {
        self.tags.insert(key.to_string(), value.to_string());
        self
    }
    
    /// Add multiple tags to the health check
    pub fn with_tags(mut self, tags: HashMap<String, String>) -> Self {
        self.tags.extend(tags);
        self
    }
}

/// Metric collector
pub struct MetricCollector {
    /// Metrics buffer
    metrics: VecDeque<MetricDataPoint>,
    
    /// Maximum buffer size
    max_buffer_size: usize,
    
    /// Whether the metric collector is initialized
    initialized: bool,
}

impl MetricCollector {
    /// Create a new metric collector
    pub fn new(max_buffer_size: usize) -> Self {
        Self {
            metrics: VecDeque::with_capacity(max_buffer_size),
            max_buffer_size,
            initialized: false,
        }
    }
    
    /// Initialize the metric collector
    pub fn initialize(&mut self) -> Result<(), ProgramError> {
        self.initialized = true;
        
        msg!("Metric collector initialized");
        
        Ok(())
    }
    
    /// Check if the metric collector is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Add a metric
    pub fn add_metric(&mut self, metric: MetricDataPoint) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // If buffer is full, remove oldest metric
        if self.metrics.len() >= self.max_buffer_size {
            self.metrics.pop_front();
        }
        
        self.metrics.push_back(metric);
        
        Ok(())
    }
    
    /// Get all metrics
    pub fn get_metrics(&self) -> &VecDeque<MetricDataPoint> {
        &self.metrics
    }
    
    /// Get metrics by name
    pub fn get_metrics_by_name(&self, name: &str) -> Vec<&MetricDataPoint> {
        self.metrics.iter()
            .filter(|m| m.name == name)
            .collect()
    }
    
    /// Get metrics by type
    pub fn get_metrics_by_type(&self, metric_type: &MetricType) -> Vec<&MetricDataPoint> {
        self.metrics.iter()
            .filter(|m| m.metric_type == *metric_type)
            .collect()
    }
    
    /// Get metrics by tag
    pub fn get_metrics_by_tag(&self, key: &str, value: &str) -> Vec<&MetricDataPoint> {
        self.metrics.iter()
            .filter(|m| m.tags.get(key).map_or(false, |v| v == value))
            .collect()
    }
    
    /// Clear all metrics
    pub fn clear(&mut self) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        self.metrics.clear();
        
        Ok(())
    }
}

/// Alert manager
pub struct AlertManager {
    /// Alerts
    alerts: HashMap<String, Alert>,
    
    /// Alert history
    alert_history: VecDeque<Alert>,
    
    /// Maximum history size
    max_history_size: usize,
    
    /// Whether the alert manager is initialized
    initialized: bool,
}

impl AlertManager {
    /// Create a new alert manager
    pub fn new(max_history_size: usize) -> Self {
        Self {
            alerts: HashMap::new(),
            alert_history: VecDeque::with_capacity(max_history_size),
            max_history_size,
            initialized: false,
        }
    }
    
    /// Initialize the alert manager
    pub fn initialize(&mut self) -> Result<(), ProgramError> {
        self.initialized = true;
        
        msg!("Alert manager initialized");
        
        Ok(())
    }
    
    /// Check if the alert manager is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Add an alert
    pub fn add_alert(&mut self, alert: Alert) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        self.alerts.insert(alert.id.clone(), alert.clone());
        
        // Add to history
        if self.alert_history.len() >= self.max_history_size {
            self.alert_history.pop_front();
        }
        
        self.alert_history.push_back(alert);
        
        Ok(())
    }
    
    /// Get an alert
    pub fn get_alert(&self, id: &str) -> Option<&Alert> {
        if !self.initialized {
            return None;
        }
        
        self.alerts.get(id)
    }
    
    /// Get a mutable alert
    pub fn get_alert_mut(&mut self, id: &str) -> Option<&mut Alert> {
        if !self.initialized {
            return None;
        }
        
        self.alerts.get_mut(id)
    }
    
    /// Get all active alerts
    pub fn get_active_alerts(&self) -> Vec<&Alert> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.alerts.values()
            .filter(|a| a.status == AlertStatus::Active)
            .collect()
    }
    
    /// Get alerts by severity
    pub fn get_alerts_by_severity(&self, severity: &AlertSeverity) -> Vec<&Alert> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.alerts.values()
            .filter(|a| a.severity == *severity)
            .collect()
    }
    
    /// Get alerts by status
    pub fn get_alerts_by_status(&self, status: &AlertStatus) -> Vec<&Alert> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.alerts.values()
            .filter(|a| a.status == *status)
            .collect()
    }
    
    /// Get alerts by source
    pub fn get_alerts_by_source(&self, source: &str) -> Vec<&Alert> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.alerts.values()
            .filter(|a| a.source == source)
            .collect()
    }
    
    /// Get alerts by tag
    pub fn get_alerts_by_tag(&self, key: &str, value: &str) -> Vec<&Alert> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.alerts.values()
            .filter(|a| a.tags.get(key).map_or(false, |v| v == value))
            .collect()
    }
    
    /// Resolve an alert
    pub fn resolve_alert(&mut self, id: &str) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        let alert = self.alerts.get_mut(id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        alert.resolve();
        
        // Add to history
        if self.alert_history.len() >= self.max_history_size {
            self.alert_history.pop_front();
        }
        
        self.alert_history.push_back(alert.clone());
        
        Ok(())
    }
    
    /// Acknowledge an alert
    pub fn acknowledge_alert(&mut self, id: &str) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        let alert = self.alerts.get_mut(id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        alert.acknowledge();
        
        // Add to history
        if self.alert_history.len() >= self.max_history_size {
            self.alert_history.pop_front();
        }
        
        self.alert_history.push_back(alert.clone());
        
        Ok(())
    }
    
    /// Get alert history
    pub fn get_alert_history(&self) -> &VecDeque<Alert> {
        &self.alert_history
    }
    
    /// Clear resolved alerts
    pub fn clear_resolved_alerts(&mut self) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        self.alerts.retain(|_, a| a.status != AlertStatus::Resolved);
        
        Ok(())
    }
}

/// Log manager
pub struct LogManager {
    /// Logs
    logs: VecDeque<LogEntry>,
    
    /// Maximum log buffer size
    max_buffer_size: usize,
    
    /// Minimum log level
    min_log_level: LogLevel,
    
    /// Whether the log manager is initialized
    initialized: bool,
}

impl LogManager {
    /// Create a new log manager
    pub fn new(max_buffer_size: usize, min_log_level: LogLevel) -> Self {
        Self {
            logs: VecDeque::with_capacity(max_buffer_size),
            max_buffer_size,
            min_log_level,
            initialized: false,
        }
    }
    
    /// Initialize the log manager
    pub fn initialize(&mut self) -> Result<(), ProgramError> {
        self.initialized = true;
        
        msg!("Log manager initialized");
        
        Ok(())
    }
    
    /// Check if the log manager is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Add a log entry
    pub fn add_log(&mut self, log: LogEntry) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check log level
        if log.level < self.min_log_level {
            return Ok(());
        }
        
        // If buffer is full, remove oldest log
        if self.logs.len() >= self.max_buffer_size {
            self.logs.pop_front();
        }
        
        self.logs.push_back(log);
        
        Ok(())
    }
    
    /// Get all logs
    pub fn get_logs(&self) -> &VecDeque<LogEntry> {
        &self.logs
    }
    
    /// Get logs by level
    pub fn get_logs_by_level(&self, level: &LogLevel) -> Vec<&LogEntry> {
        self.logs.iter()
            .filter(|l| l.level == *level)
            .collect()
    }
    
    /// Get logs by source
    pub fn get_logs_by_source(&self, source: &str) -> Vec<&LogEntry> {
        self.logs.iter()
            .filter(|l| l.source == source)
            .collect()
    }
    
    /// Get logs by tag
    pub fn get_logs_by_tag(&self, key: &str, value: &str) -> Vec<&LogEntry> {
        self.logs.iter()
            .filter(|l| l.tags.get(key).map_or(false, |v| v == value))
            .collect()
    }
    
    /// Search logs by message
    pub fn search_logs(&self, query: &str) -> Vec<&LogEntry> {
        self.logs.iter()
            .filter(|l| l.message.contains(query))
            .collect()
    }
    
    /// Set minimum log level
    pub fn set_min_log_level(&mut self, level: LogLevel) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        self.min_log_level = level;
        
        Ok(())
    }
    
    /// Clear all logs
    pub fn clear(&mut self) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        self.logs.clear();
        
        Ok(())
    }
}

/// Health check manager
pub struct HealthCheckManager {
    /// Health checks
    health_checks: HashMap<String, HealthCheck>,
    
    /// Health check history
    health_check_history: HashMap<String, VecDeque<HealthCheck>>,
    
    /// Maximum history size per health check
    max_history_size: usize,
    
    /// Whether the health check manager is initialized
    initialized: bool,
}

impl HealthCheckManager {
    /// Create a new health check manager
    pub fn new(max_history_size: usize) -> Self {
        Self {
            health_checks: HashMap::new(),
            health_check_history: HashMap::new(),
            max_history_size,
            initialized: false,
        }
    }
    
    /// Initialize the health check manager
    pub fn initialize(&mut self) -> Result<(), ProgramError> {
        self.initialized = true;
        
        msg!("Health check manager initialized");
        
        Ok(())
    }
    
    /// Check if the health check manager is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Add a health check
    pub fn add_health_check(&mut self, health_check: HealthCheck) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        let name = health_check.name.clone();
        
        self.health_checks.insert(name.clone(), health_check.clone());
        
        // Add to history
        let history = self.health_check_history.entry(name).or_insert_with(|| {
            VecDeque::with_capacity(self.max_history_size)
        });
        
        if history.len() >= self.max_history_size {
            history.pop_front();
        }
        
        history.push_back(health_check);
        
        Ok(())
    }
    
    /// Get a health check
    pub fn get_health_check(&self, name: &str) -> Option<&HealthCheck> {
        if !self.initialized {
            return None;
        }
        
        self.health_checks.get(name)
    }
    
    /// Get all health checks
    pub fn get_all_health_checks(&self) -> &HashMap<String, HealthCheck> {
        &self.health_checks
    }
    
    /// Get health checks by status
    pub fn get_health_checks_by_status(&self, status: &HealthStatus) -> Vec<&HealthCheck> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.health_checks.values()
            .filter(|h| h.status == *status)
            .collect()
    }
    
    /// Get health checks by tag
    pub fn get_health_checks_by_tag(&self, key: &str, value: &str) -> Vec<&HealthCheck> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.health_checks.values()
            .filter(|h| h.tags.get(key).map_or(false, |v| v == value))
            .collect()
    }
    
    /// Get health check history
    pub fn get_health_check_history(&self, name: &str) -> Option<&VecDeque<HealthCheck>> {
        if !self.initialized {
            return None;
        }
        
        self.health_check_history.get(name)
    }
    
    /// Get overall system health
    pub fn get_overall_health(&self) -> HealthStatus {
        if !self.initialized {
            return HealthStatus::Unknown;
        }
        
        if self.health_checks.is_empty() {
            return HealthStatus::Unknown;
        }
        
        let mut has_degraded = false;
        
        for health_check in self.health_checks.values() {
            match health_check.status {
                HealthStatus::Unhealthy => return HealthStatus::Unhealthy,
                HealthStatus::Degraded => has_degraded = true,
                _ => {}
            }
        }
        
        if has_degraded {
            HealthStatus::Degraded
        } else {
            HealthStatus::Healthy
        }
    }
}

/// Monitoring manager
pub struct MonitoringManager {
    /// Metric collector
    metric_collector: Option<MetricCollector>,
    
    /// Alert manager
    alert_manager: Option<AlertManager>,
    
    /// Log manager
    log_manager: Option<LogManager>,
    
    /// Health check manager
    health_check_manager: Option<HealthCheckManager>,
    
    /// Whether the monitoring manager is initialized
    initialized: bool,
}

impl MonitoringManager {
    /// Create a new monitoring manager
    pub fn new() -> Self {
        Self {
            metric_collector: None,
            alert_manager: None,
            log_manager: None,
            health_check_manager: None,
            initialized: false,
        }
    }
    
    /// Initialize the monitoring manager
    pub fn initialize(&mut self) -> Result<(), ProgramError> {
        self.initialized = true;
        
        // Initialize components with default settings
        let mut metric_collector = MetricCollector::new(1000);
        metric_collector.initialize()?;
        self.metric_collector = Some(metric_collector);
        
        let mut alert_manager = AlertManager::new(100);
        alert_manager.initialize()?;
        self.alert_manager = Some(alert_manager);
        
        let mut log_manager = LogManager::new(1000, LogLevel::Info);
        log_manager.initialize()?;
        self.log_manager = Some(log_manager);
        
        let mut health_check_manager = HealthCheckManager::new(10);
        health_check_manager.initialize()?;
        self.health_check_manager = Some(health_check_manager);
        
        msg!("Monitoring manager initialized");
        
        Ok(())
    }
    
    /// Initialize the monitoring manager with custom settings
    pub fn initialize_with_settings(
        &mut self,
        metric_buffer_size: usize,
        alert_history_size: usize,
        log_buffer_size: usize,
        min_log_level: LogLevel,
        health_check_history_size: usize,
    ) -> Result<(), ProgramError> {
        self.initialized = true;
        
        // Initialize components with custom settings
        let mut metric_collector = MetricCollector::new(metric_buffer_size);
        metric_collector.initialize()?;
        self.metric_collector = Some(metric_collector);
        
        let mut alert_manager = AlertManager::new(alert_history_size);
        alert_manager.initialize()?;
        self.alert_manager = Some(alert_manager);
        
        let mut log_manager = LogManager::new(log_buffer_size, min_log_level);
        log_manager.initialize()?;
        self.log_manager = Some(log_manager);
        
        let mut health_check_manager = HealthCheckManager::new(health_check_history_size);
        health_check_manager.initialize()?;
        self.health_check_manager = Some(health_check_manager);
        
        msg!("Monitoring manager initialized with custom settings");
        
        Ok(())
    }
    
    /// Check if the monitoring manager is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Get the metric collector
    pub fn get_metric_collector(&self) -> Option<&MetricCollector> {
        if !self.initialized {
            return None;
        }
        
        self.metric_collector.as_ref()
    }
    
    /// Get the mutable metric collector
    pub fn get_metric_collector_mut(&mut self) -> Option<&mut MetricCollector> {
        if !self.initialized {
            return None;
        }
        
        self.metric_collector.as_mut()
    }
    
    /// Get the alert manager
    pub fn get_alert_manager(&self) -> Option<&AlertManager> {
        if !self.initialized {
            return None;
        }
        
        self.alert_manager.as_ref()
    }
    
    /// Get the mutable alert manager
    pub fn get_alert_manager_mut(&mut self) -> Option<&mut AlertManager> {
        if !self.initialized {
            return None;
        }
        
        self.alert_manager.as_mut()
    }
    
    /// Get the log manager
    pub fn get_log_manager(&self) -> Option<&LogManager> {
        if !self.initialized {
            return None;
        }
        
        self.log_manager.as_ref()
    }
    
    /// Get the mutable log manager
    pub fn get_log_manager_mut(&mut self) -> Option<&mut LogManager> {
        if !self.initialized {
            return None;
        }
        
        self.log_manager.as_mut()
    }
    
    /// Get the health check manager
    pub fn get_health_check_manager(&self) -> Option<&HealthCheckManager> {
        if !self.initialized {
            return None;
        }
        
        self.health_check_manager.as_ref()
    }
    
    /// Get the mutable health check manager
    pub fn get_health_check_manager_mut(&mut self) -> Option<&mut HealthCheckManager> {
        if !self.initialized {
            return None;
        }
        
        self.health_check_manager.as_mut()
    }
    
    /// Add a metric
    pub fn add_metric(&mut self, metric: MetricDataPoint) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        if let Some(collector) = &mut self.metric_collector {
            collector.add_metric(metric)?;
        }
        
        Ok(())
    }
    
    /// Add an alert
    pub fn add_alert(&mut self, alert: Alert) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        if let Some(manager) = &mut self.alert_manager {
            manager.add_alert(alert)?;
        }
        
        Ok(())
    }
    
    /// Add a log entry
    pub fn add_log(&mut self, log: LogEntry) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        if let Some(manager) = &mut self.log_manager {
            manager.add_log(log)?;
        }
        
        Ok(())
    }
    
    /// Add a health check
    pub fn add_health_check(&mut self, health_check: HealthCheck) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        if let Some(manager) = &mut self.health_check_manager {
            manager.add_health_check(health_check)?;
        }
        
        Ok(())
    }
    
    /// Get overall system health
    pub fn get_overall_health(&self) -> HealthStatus {
        if !self.initialized {
            return HealthStatus::Unknown;
        }
        
        if let Some(manager) = &self.health_check_manager {
            manager.get_overall_health()
        } else {
            HealthStatus::Unknown
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_monitoring_manager_creation() {
        let manager = MonitoringManager::new();
        assert!(!manager.is_initialized());
    }
    
    #[test]
    fn test_metric_data_point() {
        let metric = MetricDataPoint::new(
            "test_metric",
            MetricType::Counter,
            MetricValue::Integer(42)
        ).with_tag("tag1", "value1");
        
        assert_eq!(metric.name, "test_metric");
        assert_eq!(metric.metric_type, MetricType::Counter);
        assert_eq!(metric.value, MetricValue::Integer(42));
        assert_eq!(metric.tags.get("tag1"), Some(&"value1".to_string()));
    }
    
    #[test]
    fn test_alert() {
        let mut alert = Alert::new(
            "test_alert",
            "Test Alert",
            "This is a test alert",
            AlertSeverity::Warning
        ).with_source("test_source")
         .with_tag("tag1", "value1");
        
        assert_eq!(alert.id, "test_alert");
        assert_eq!(alert.name, "Test Alert");
        assert_eq!(alert.description, "This is a test alert");
        assert_eq!(alert.severity, AlertSeverity::Warning);
        assert_eq!(alert.status, AlertStatus::Active);
        assert_eq!(alert.source, "test_source");
        assert_eq!(alert.tags.get("tag1"), Some(&"value1".to_string()));
        
        alert.resolve();
        assert_eq!(alert.status, AlertStatus::Resolved);
        
        alert.acknowledge();
        assert_eq!(alert.status, AlertStatus::Acknowledged);
    }
    
    #[test]
    fn test_log_entry() {
        let log = LogEntry::new(
            LogLevel::Info,
            "This is a test log message"
        ).with_source("test_source")
         .with_tag("tag1", "value1");
        
        assert_eq!(log.level, LogLevel::Info);
        assert_eq!(log.message, "This is a test log message");
        assert_eq!(log.source, "test_source");
        assert_eq!(log.tags.get("tag1"), Some(&"value1".to_string()));
    }
    
    #[test]
    fn test_health_check() {
        let health_check = HealthCheck::new(
            "test_health_check",
            "Test Health Check",
            HealthStatus::Healthy
        ).with_details("Everything is working fine")
         .with_tag("tag1", "value1");
        
        assert_eq!(health_check.name, "test_health_check");
        assert_eq!(health_check.description, "Test Health Check");
        assert_eq!(health_check.status, HealthStatus::Healthy);
        assert_eq!(health_check.details, "Everything is working fine");
        assert_eq!(health_check.tags.get("tag1"), Some(&"value1".to_string()));
    }
}
