// src/monitoring/mod.rs
//! Monitoring Module for Layer-2 on Solana
//!
//! This module provides comprehensive monitoring capabilities:
//! - Metrics collection and storage
//! - Alerting system
//! - Analytics engine
//! - Health checks
//! - Logging and tracing
//!
//! The monitoring system is designed to provide visibility into the
//! Layer-2 platform's performance, health, and security.

mod metrics;
mod alerts;
mod analytics;
mod health_checks;

pub use metrics::{
    MetricsCollector, MetricFamily, Metric, MetricValue, MetricType,
    MetricsCollectorConfig, MetricsError
};

pub use alerts::{
    AlertManager, Alert, AlertSeverity, AlertStatus, AlertEndpoint,
    AlertManagerConfig, AlertError
};

pub use analytics::{
    AnalyticsEngine, AnalyticsResult, AnalyticsValue, AnalyticsType,
    TimeWindow, AnalyticsEngineConfig
};

pub use health_checks::{
    HealthCheckManager, HealthCheckResult, HealthStatus, HealthCheckType,
    HealthCheckConfig
};

use std::sync::Arc;
use tokio::sync::mpsc;

/// Monitoring system configuration
#[derive(Debug, Clone)]
pub struct MonitoringConfig {
    /// Metrics collector configuration
    pub metrics_config: MetricsCollectorConfig,
    
    /// Alert manager configuration
    pub alerts_config: AlertManagerConfig,
    
    /// Analytics engine configuration
    pub analytics_config: AnalyticsEngineConfig,
    
    /// Health check configuration
    pub health_check_config: HealthCheckConfig,
}

impl Default for MonitoringConfig {
    fn default() -> Self {
        Self {
            metrics_config: MetricsCollectorConfig::default(),
            alerts_config: AlertManagerConfig::default(),
            analytics_config: AnalyticsEngineConfig::default(),
            health_check_config: HealthCheckConfig::default(),
        }
    }
}

/// Monitoring system
pub struct MonitoringSystem {
    /// Metrics collector
    pub metrics_collector: Arc<MetricsCollector>,
    
    /// Alert manager
    pub alert_manager: Arc<AlertManager>,
    
    /// Analytics engine
    pub analytics_engine: Arc<AnalyticsEngine>,
    
    /// Health check manager
    pub health_check_manager: Arc<HealthCheckManager>,
    
    /// Shutdown channel
    shutdown_tx: Option<mpsc::Sender<()>>,
}

impl MonitoringSystem {
    /// Create a new monitoring system with the default configuration
    pub fn new() -> Self {
        Self::with_config(MonitoringConfig::default())
    }
    
    /// Create a new monitoring system with the given configuration
    pub fn with_config(config: MonitoringConfig) -> Self {
        let metrics_collector = Arc::new(MetricsCollector::with_config(config.metrics_config));
        let alert_manager = Arc::new(AlertManager::with_config(config.alerts_config));
        let analytics_engine = Arc::new(AnalyticsEngine::with_config(config.analytics_config));
        let health_check_manager = Arc::new(HealthCheckManager::with_config(config.health_check_config));
        
        Self {
            metrics_collector,
            alert_manager,
            analytics_engine,
            health_check_manager,
            shutdown_tx: None,
        }
    }
    
    /// Start the monitoring system
    pub fn start(&mut self) {
        // Start metrics collector
        let metrics_collector_clone = Arc::clone(&self.metrics_collector);
        metrics_collector_clone.start();
        
        // Start alert manager (no explicit start needed)
        
        // Start analytics engine
        let analytics_engine_clone = Arc::clone(&self.analytics_engine);
        let metrics_collector_clone = Arc::clone(&self.metrics_collector);
        let alert_manager_clone = Arc::clone(&self.alert_manager);
        analytics_engine_clone.start(metrics_collector_clone, alert_manager_clone);
        
        // Start health check manager
        let health_check_manager_clone = Arc::clone(&self.health_check_manager);
        let metrics_collector_clone = Arc::clone(&self.metrics_collector);
        let alert_manager_clone = Arc::clone(&self.alert_manager);
        health_check_manager_clone.start(metrics_collector_clone, alert_manager_clone);
        
        // Create shutdown channel
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        self.shutdown_tx = Some(shutdown_tx);
        
        // Spawn monitoring task
        let metrics_collector_clone = Arc::clone(&self.metrics_collector);
        let alert_manager_clone = Arc::clone(&self.alert_manager);
        let analytics_engine_clone = Arc::clone(&self.analytics_engine);
        let health_check_manager_clone = Arc::clone(&self.health_check_manager);
        
        tokio::spawn(async move {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    // Shutdown requested
                    metrics_collector_clone.stop();
                    analytics_engine_clone.stop();
                    health_check_manager_clone.stop();
                }
            }
        });
    }
    
    /// Stop the monitoring system
    pub fn stop(&self) {
        // Send shutdown signal
        if let Some(tx) = &self.shutdown_tx {
            let _ = tx.try_send(());
        }
        
        // Stop components directly
        self.metrics_collector.stop();
        self.analytics_engine.stop();
        self.health_check_manager.stop();
    }
    
    /// Check if the monitoring system is running
    pub fn is_running(&self) -> bool {
        self.metrics_collector.is_running() ||
        self.analytics_engine.is_running() ||
        self.health_check_manager.is_running()
    }
    
    /// Get the overall system health status
    pub fn get_overall_health_status(&self) -> HealthStatus {
        self.health_check_manager.get_overall_status()
    }
    
    /// Send an alert
    pub fn send_alert(&self, title: &str, message: &str, severity: AlertSeverity) -> String {
        self.alert_manager.send_alert(title, message, severity)
    }
    
    /// Record a metric
    pub fn record_metric(&self, name: &str, value: MetricValue, metric_type: MetricType, labels: Option<std::collections::HashMap<String, String>>) {
        self.metrics_collector.record_metric(name, value, metric_type, labels);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_monitoring_config_default() {
        let config = MonitoringConfig::default();
        
        assert_eq!(config.metrics_config.interval, 10);
        assert_eq!(config.alerts_config.max_history, 1000);
        assert_eq!(config.analytics_config.interval, 60);
        assert_eq!(config.health_check_config.interval, 60);
    }
    
    #[test]
    fn test_monitoring_system_creation() {
        let system = MonitoringSystem::new();
        
        assert!(!system.is_running());
        assert_eq!(system.get_overall_health_status(), HealthStatus::Unknown);
    }
}
