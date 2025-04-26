use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use log::{debug, error, info, warn};
use tokio::sync::RwLock;
use tokio::time::sleep;
use crate::error_handling::error_handler::{ErrorContext, ErrorHandler, ErrorHandlerError, ErrorInfo, ErrorSeverity};

/// Errori che possono verificarsi durante il monitoraggio
#[derive(Debug, thiserror::Error)]
pub enum ErrorMonitorError {
    #[error("Errore di inizializzazione: {0}")]
    InitializationError(String),
    
    #[error("Errore di configurazione: {0}")]
    ConfigurationError(String),
    
    #[error("Errore di monitoraggio: {0}")]
    MonitoringError(String),
    
    #[error("Errore di notifica: {0}")]
    NotificationError(String),
    
    #[error("Errore di gestione degli errori: {0}")]
    ErrorHandlingError(#[from] ErrorHandlerError),
}

/// Tipo di metrica monitorata
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MetricType {
    ErrorCount,
    ErrorRate,
    RecoveryRate,
    ResponseTime,
    MemoryUsage,
    CPUUsage,
    DiskUsage,
    NetworkLatency,
    ThroughputTPS,
    QueueSize,
    Custom(u32),
}

/// Configurazione del monitor
#[derive(Debug, Clone)]
pub struct ErrorMonitorConfig {
    /// Intervallo di monitoraggio (in millisecondi)
    pub monitoring_interval_ms: u64,
    
    /// Soglie di allarme per gravità
    pub alarm_thresholds: HashMap<ErrorSeverity, u64>,
    
    /// Soglie di allarme per metriche
    pub metric_thresholds: HashMap<MetricType, f64>,
    
    /// Abilitare le notifiche di allarme
    pub enable_alarm_notifications: bool,
    
    /// URL del webhook per le notifiche di allarme
    pub alarm_webhook_url: Option<String>,
    
    /// Periodo di aggregazione delle metriche (in secondi)
    pub metrics_aggregation_period_sec: u64,
    
    /// Capacità della cronologia delle metriche
    pub metrics_history_capacity: usize,
    
    /// Abilitare il monitoraggio automatico
    pub enable_auto_monitoring: bool,
    
    /// Intervallo di pulizia degli errori risolti (in secondi)
    pub resolved_errors_cleanup_interval_sec: u64,
}

impl Default for ErrorMonitorConfig {
    fn default() -> Self {
        Self {
            monitoring_interval_ms: 5000, // 5 secondi
            alarm_thresholds: HashMap::new(),
            metric_thresholds: HashMap::new(),
            enable_alarm_notifications: false,
            alarm_webhook_url: None,
            metrics_aggregation_period_sec: 60, // 1 minuto
            metrics_history_capacity: 1440, // 24 ore con aggregazione di 1 minuto
            enable_auto_monitoring: true,
            resolved_errors_cleanup_interval_sec: 3600, // 1 ora
        }
    }
}

/// Punto dati di una metrica
#[derive(Debug, Clone)]
pub struct MetricDataPoint {
    /// Timestamp del punto dati
    pub timestamp: chrono::DateTime<chrono::Utc>,
    
    /// Valore della metrica
    pub value: f64,
}

/// Cronologia di una metrica
#[derive(Debug, Clone)]
pub struct MetricHistory {
    /// Tipo di metrica
    pub metric_type: MetricType,
    
    /// Punti dati
    pub data_points: Vec<MetricDataPoint>,
    
    /// Capacità massima
    pub capacity: usize,
}

impl MetricHistory {
    /// Crea una nuova cronologia di metrica
    pub fn new(metric_type: MetricType, capacity: usize) -> Self {
        Self {
            metric_type,
            data_points: Vec::with_capacity(capacity),
            capacity,
        }
    }
    
    /// Aggiunge un punto dati
    pub fn add_data_point(&mut self, value: f64) {
        // Crea un nuovo punto dati
        let data_point = MetricDataPoint {
            timestamp: chrono::Utc::now(),
            value,
        };
        
        // Aggiungi il punto dati
        self.data_points.push(data_point);
        
        // Rimuovi i punti dati in eccesso
        if self.data_points.len() > self.capacity {
            self.data_points.remove(0);
        }
    }
    
    /// Ottiene il valore corrente
    pub fn current_value(&self) -> Option<f64> {
        self.data_points.last().map(|dp| dp.value)
    }
    
    /// Calcola la media dei valori
    pub fn average(&self) -> Option<f64> {
        if self.data_points.is_empty() {
            return None;
        }
        
        let sum: f64 = self.data_points.iter().map(|dp| dp.value).sum();
        Some(sum / self.data_points.len() as f64)
    }
    
    /// Calcola il valore massimo
    pub fn max(&self) -> Option<f64> {
        self.data_points.iter().map(|dp| dp.value).fold(None, |max, x| {
            match max {
                None => Some(x),
                Some(max_val) => Some(max_val.max(x)),
            }
        })
    }
    
    /// Calcola il valore minimo
    pub fn min(&self) -> Option<f64> {
        self.data_points.iter().map(|dp| dp.value).fold(None, |min, x| {
            match min {
                None => Some(x),
                Some(min_val) => Some(min_val.min(x)),
            }
        })
    }
    
    /// Calcola la tendenza (positiva, negativa o stabile)
    pub fn trend(&self) -> Option<TrendDirection> {
        if self.data_points.len() < 2 {
            return None;
        }
        
        // Calcola la media mobile per ridurre il rumore
        let window_size = (self.data_points.len() / 10).max(2);
        let recent_avg = self.data_points.iter().rev().take(window_size).map(|dp| dp.value).sum::<f64>() / window_size as f64;
        let older_avg = self.data_points.iter().rev().skip(window_size).take(window_size).map(|dp| dp.value).sum::<f64>() / window_size as f64;
        
        // Determina la direzione della tendenza
        let threshold = 0.05; // 5% di variazione
        let relative_change = (recent_avg - older_avg) / older_avg.abs();
        
        if relative_change > threshold {
            Some(TrendDirection::Increasing)
        } else if relative_change < -threshold {
            Some(TrendDirection::Decreasing)
        } else {
            Some(TrendDirection::Stable)
        }
    }
}

/// Direzione della tendenza
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrendDirection {
    Increasing,
    Decreasing,
    Stable,
}

/// Stato di allarme
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlarmState {
    Normal,
    Warning,
    Critical,
}

/// Allarme
#[derive(Debug, Clone)]
pub struct Alarm {
    /// ID univoco dell'allarme
    pub id: String,
    
    /// Tipo di metrica
    pub metric_type: MetricType,
    
    /// Stato dell'allarme
    pub state: AlarmState,
    
    /// Valore attuale
    pub current_value: f64,
    
    /// Soglia
    pub threshold: f64,
    
    /// Timestamp di attivazione
    pub activation_time: chrono::DateTime<chrono::Utc>,
    
    /// Messaggio
    pub message: String,
}

/// Monitor degli errori avanzato
pub struct ErrorMonitor {
    /// Gestore degli errori
    error_handler: Arc<ErrorHandler>,
    
    /// Configurazione del monitor
    config: ErrorMonitorConfig,
    
    /// Cronologie delle metriche
    metric_histories: Arc<RwLock<HashMap<MetricType, MetricHistory>>>,
    
    /// Allarmi attivi
    active_alarms: Arc<RwLock<HashMap<String, Alarm>>>,
    
    /// Callback di allarme
    alarm_callback: Option<Arc<dyn Fn(Alarm) + Send + Sync>>,
    
    /// Stato di esecuzione
    running: Arc<RwLock<bool>>,
    
    /// Contatore di cicli di monitoraggio
    monitoring_cycles: Arc<Mutex<u64>>,
    
    /// Timestamp dell'ultimo ciclo di monitoraggio
    last_monitoring_cycle: Arc<Mutex<Instant>>,
    
    /// Timestamp dell'ultima pulizia degli errori risolti
    last_cleanup: Arc<Mutex<Instant>>,
}

impl ErrorMonitor {
    /// Crea un nuovo monitor degli errori
    pub fn new(error_handler: Arc<ErrorHandler>) -> Result<Self, ErrorMonitorError> {
        Self::with_config(error_handler, ErrorMonitorConfig::default())
    }
    
    /// Crea un nuovo monitor degli errori con una configurazione personalizzata
    pub fn with_config(error_handler: Arc<ErrorHandler>, config: ErrorMonitorConfig) -> Result<Self, ErrorMonitorError> {
        let monitor = Self {
            error_handler,
            config: config.clone(),
            metric_histories: Arc::new(RwLock::new(HashMap::new())),
            active_alarms: Arc::new(RwLock::new(HashMap::new())),
            alarm_callback: None,
            running: Arc::new(RwLock::new(false)),
            monitoring_cycles: Arc::new(Mutex::new(0)),
            last_monitoring_cycle: Arc::new(Mutex::new(Instant::now())),
            last_cleanup: Arc::new(Mutex::new(Instant::now())),
        };
        
        // Inizializza le cronologie delle metriche
        let metric_types = [
            MetricType::ErrorCount,
            MetricType::ErrorRate,
            MetricType::RecoveryRate,
            MetricType::ResponseTime,
            MetricType::MemoryUsage,
            MetricType::QueueSize,
        ];
        
        for metric_type in &metric_types {
            monitor.initialize_metric_history(*metric_type)?;
        }
        
        // Avvia il monitoraggio automatico se abilitato
        if config.enable_auto_monitoring {
            tokio::spawn(monitor.start_monitoring());
        }
        
        Ok(monitor)
    }
    
    /// Inizializza la cronologia di una metrica
    fn initialize_metric_history(&self, metric_type: MetricType) -> Result<(), ErrorMonitorError> {
        let mut metric_histories = self.metric_histories.try_write().map_err(|e| {
            ErrorMonitorError::InitializationError(format!("Impossibile acquisire il lock: {}", e))
        })?;
        
        metric_histories.insert(
            metric_type,
            MetricHistory::new(metric_type, self.config.metrics_history_capacity),
        );
        
        Ok(())
    }
    
    /// Imposta il callback di allarme
    pub fn set_alarm_callback<F>(&mut self, callback: F)
    where
        F: Fn(Alarm) + Send + Sync + 'static,
    {
        self.alarm_callback = Some(Arc::new(callback));
    }
    
    /// Imposta una soglia di allarme per una gravità specifica
    pub fn set_alarm_threshold(&mut self, severity: ErrorSeverity, threshold: u64) {
        self.config.alarm_thresholds.insert(severity, threshold);
    }
    
    /// Imposta una soglia di allarme per una metrica specifica
    pub fn set_metric_threshold(&mut self, metric_type: MetricType, threshold: f64) {
        self.config.metric_thresholds.insert(metric_type, threshold);
    }
    
    /// Avvia il monitoraggio
    pub async fn start_monitoring(self) -> Result<(), ErrorMonitorError> {
        // Imposta lo stato di esecuzione
        {
            let mut running = self.running.write().await;
            
            if *running {
                return Err(ErrorMonitorError::InitializationError(
                    "Il monitor è già in esecuzione".to_string(),
                ));
            }
            
            *running = true;
        }
        
        // Clona le risorse necessarie per il task
        let error_handler = self.error_handler.clone();
        let metric_histories = self.metric_histories.clone();
        let active_alarms = self.active_alarms.clone();
        let alarm_callback = self.alarm_callback.clone();
        let running = self.running.clone();
        let monitoring_cycles = self.monitoring_cycles.clone();
        let last_monitoring_cycle = self.last_monitoring_cycle.clone();
        let last_cleanup = self.last_cleanup.clone();
        let config = self.config.clone();
        
        // Esegui il ciclo di monitoraggio
        while {
            let is_running = *running.read().await;
            is_running
        } {
            // Aggiorna il contatore di cicli
            {
                let mut cycles = monitoring_cycles.lock().map_err(|e| {
                    ErrorMonitorError::MonitoringError(format!("Impossibile acquisire il lock: {}", e))
                })?;
                *cycles += 1;
            }
            
            // Aggiorna il timestamp dell'ultimo ciclo
            {
                let mut last_cycle = last_monitoring_cycle.lock().map_err(|e| {
                    ErrorMonitorError::MonitoringError(format!("Impossibile acquisire il lock: {}", e))
                })?;
                *last_cycle = Instant::now();
            }
            
            // Ottieni le statistiche
            let stats = error_handler.get_stats()?;
            
            // Aggiorna le metriche
            {
                let mut metric_histories = metric_histories.write().await;
                
                // Aggiorna la metrica ErrorCount
                if let Some(history) = metric_histories.get_mut(&MetricType::ErrorCount) {
                    history.add_data_point(stats.total_errors as f64);
                }
                
                // Aggiorna la metrica ErrorRate
                if let Some(history) = metric_histories.get_mut(&MetricType::ErrorRate) {
                    // Calcola il tasso di errori (errori al secondo)
                    let elapsed_sec = config.monitoring_interval_ms as f64 / 1000.0;
                    let previous_count = history.current_value().unwrap_or(0.0);
                    let current_count = stats.total_errors as f64;
                    let error_rate = (current_count - previous_count) / elapsed_sec;
                    history.add_data_point(error_rate);
                }
                
                // Aggiorna la metrica RecoveryRate
                if let Some(history) = metric_histories.get_mut(&MetricType::RecoveryRate) {
                    // Calcola il tasso di recupero (percentuale di errori recuperati)
                    let recovery_rate = if stats.total_errors > 0 {
                        stats.successful_recoveries as f64 / stats.total_errors as f64 * 100.0
                    } else {
                        100.0 // Se non ci sono errori, il tasso di recupero è del 100%
                    };
                    history.add_data_point(recovery_rate);
                }
                
                // Aggiorna la metrica ResponseTime
                if let Some(history) = metric_histories.get_mut(&MetricType::ResponseTime) {
                    history.add_data_point(stats.avg_handling_time_ms);
                }
                
                // Aggiorna la metrica QueueSize
                if let Some(history) = metric_histories.get_mut(&MetricType::QueueSize) {
                    history.add_data_point(stats.current_queue_size as f64);
                }
            }
            
            // Controlla le soglie di allarme per gravità
            for (severity, count) in &stats.errors_by_severity {
                if let Some(threshold) = config.alarm_thresholds.get(severity) {
                    if *count >= *threshold {
                        // Crea un allarme
                        let alarm = Alarm {
                            id: uuid::Uuid::new_v4().to_string(),
                            metric_type: MetricType::ErrorCount,
                            state: AlarmState::Critical,
                            current_value: *count as f64,
                            threshold: *threshold as f64,
                            activation_time: chrono::Utc::now(),
                            message: format!(
                                "Soglia di errori superata per gravità {:?}: {} (soglia: {})",
                                severity, count, threshold
                            ),
                        };
                        
                        // Attiva l'allarme
                        self.trigger_alarm(alarm).await?;
                    }
                }
            }
            
            // Controlla le soglie di allarme per metriche
            {
                let metric_histories = metric_histories.read().await;
                
                for (metric_type, threshold) in &config.metric_thresholds {
                    if let Some(history) = metric_histories.get(metric_type) {
                        if let Some(current_value) = history.current_value() {
                            if current_value > *threshold {
                                // Crea un allarme
                                let alarm = Alarm {
                                    id: uuid::Uuid::new_v4().to_string(),
                                    metric_type: *metric_type,
                                    state: AlarmState::Critical,
                                    current_value,
                                    threshold: *threshold,
                                    activation_time: chrono::Utc::now(),
                                    message: format!(
                                        "Soglia di metrica superata per {:?}: {:.2} (soglia: {:.2})",
                                        metric_type, current_value, threshold
                                    ),
                                };
                                
                                // Attiva l'allarme
                                self.trigger_alarm(alarm).await?;
                            }
                        }
                    }
                }
            }
            
            // Pulisci gli errori risolti periodicamente
            {
                let mut last_cleanup_time = last_cleanup.lock().map_err(|e| {
                    ErrorMonitorError::MonitoringError(format!("Impossibile acquisire il lock: {}", e))
                })?;
                
                let elapsed = last_cleanup_time.elapsed();
                if elapsed > Duration::from_secs(config.resolved_errors_cleanup_interval_sec) {
                    // Pulisci gli errori risolti
                    match error_handler.clean_resolved_errors() {
                        Ok(count) => {
                            debug!("Puliti {} errori risolti", count);
                        }
                        Err(e) => {
                            error!("Impossibile pulire gli errori risolti: {}", e);
                        }
                    }
                    
                    // Aggiorna il timestamp dell'ultima pulizia
                    *last_cleanup_time = Instant::now();
                }
            }
            
            // Attendi l'intervallo di monitoraggio
            sleep(Duration::from_millis(config.monitoring_interval_ms)).await;
        }
        
        Ok(())
    }
    
    /// Attiva un allarme
    async fn trigger_alarm(&self, alarm: Alarm) -> Result<(), ErrorMonitorError> {
        // Aggiungi l'allarme alla lista degli allarmi attivi
        {
            let mut active_alarms = self.active_alarms.write().await;
            active_alarms.insert(alarm.id.clone(), alarm.clone());
        }
        
        // Logga l'allarme
        warn!("Allarme attivato: {}", alarm.message);
        
        // Invia notifica se abilitato
        if self.config.enable_alarm_notifications {
            if let Some(webhook_url) = &self.config.alarm_webhook_url {
                // In un'implementazione reale, qui invieresti la notifica al webhook
                info!("Notifica di allarme inviata a {}: {}", webhook_url, alarm.message);
            }
        }
        
        // Chiama il callback di allarme se presente
        if let Some(callback) = &self.alarm_callback {
            callback(alarm.clone());
        }
        
        Ok(())
    }
    
    /// Risolve un allarme
    pub async fn resolve_alarm(&self, alarm_id: &str) -> Result<(), ErrorMonitorError> {
        let mut active_alarms = self.active_alarms.write().await;
        
        if let Some(alarm) = active_alarms.remove(alarm_id) {
            info!("Allarme risolto: {}", alarm.message);
        }
        
        Ok(())
    }
    
    /// Ottiene gli allarmi attivi
    pub async fn get_active_alarms(&self) -> Result<Vec<Alarm>, ErrorMonitorError> {
        let active_alarms = self.active_alarms.read().await;
        Ok(active_alarms.values().cloned().collect())
    }
    
    /// Ottiene la cronologia di una metrica
    pub async fn get_metric_history(&self, metric_type: MetricType) -> Result<Option<MetricHistory>, ErrorMonitorError> {
        let metric_histories = self.metric_histories.read().await;
        Ok(metric_histories.get(&metric_type).cloned())
    }
    
    /// Ottiene tutte le cronologie delle metriche
    pub async fn get_all_metric_histories(&self) -> Result<HashMap<MetricType, MetricHistory>, ErrorMonitorError> {
        let metric_histories = self.metric_histories.read().await;
        Ok(metric_histories.clone())
    }
    
    /// Ferma il monitoraggio
    pub async fn stop(&self) -> Result<(), ErrorMonitorError> {
        let mut running = self.running.write().await;
        *running = false;
        Ok(())
    }
    
    /// Verifica se il monitor è in esecuzione
    pub async fn is_running(&self) -> Result<bool, ErrorMonitorError> {
        let running = self.running.read().await;
        Ok(*running)
    }
    
    /// Ottiene il numero di cicli di monitoraggio
    pub fn get_monitoring_cycles(&self) -> Result<u64, ErrorMonitorError> {
        let cycles = self.monitoring_cycles.lock().map_err(|e| {
            ErrorMonitorError::MonitoringError(format!("Impossibile acquisire il lock: {}", e))
        })?;
        Ok(*cycles)
    }
    
    /// Ottiene il timestamp dell'ultimo ciclo di monitoraggio
    pub fn get_last_monitoring_cycle(&self) -> Result<Instant, ErrorMonitorError> {
        let last_cycle = self.last_monitoring_cycle.lock().map_err(|e| {
            ErrorMonitorError::MonitoringError(format!("Impossibile acquisire il lock: {}", e))
        })?;
        Ok(*last_cycle)
    }
    
    /// Crea un errore di test
    pub async fn create_test_error(&self, severity: ErrorSeverity, message: &str) -> Result<(), ErrorMonitorError> {
        // Crea un contesto di errore
        let context = ErrorContext::new("ErrorMonitor", "create_test_error")
            .with_metadata("test", "true");
        
        // Crea un'informazione di errore
        let error_info = ErrorInfo::new(message, severity, context);
        
        // Gestisci l'errore
        self.error_handler.handle_error(error_info).await?;
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error_handling::error_handler::ErrorHandler;
    
    #[tokio::test]
    async fn test_error_monitor() {
        // Crea un gestore degli errori
        let handler = Arc::new(ErrorHandler::new().unwrap());
        
        // Crea un monitor degli errori
        let monitor = ErrorMonitor::new(handler.clone()).unwrap();
        
        // Crea un errore di test
        monitor.create_test_error(ErrorSeverity::Error, "Test error").await.unwrap();
        
        // Verifica che il monitor sia in esecuzione
        assert!(monitor.is_running().await.unwrap());
        
        // Ferma il monitor
        monitor.stop().await.unwrap();
        
        // Verifica che il monitor sia stato fermato
        assert!(!monitor.is_running().await.unwrap());
    }
}
