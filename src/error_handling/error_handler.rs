use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;
use tokio::time::sleep;
use log::{debug, error, info, warn};
use thiserror::Error;

/// Errori che possono verificarsi durante la gestione degli errori
#[derive(Error, Debug)]
pub enum ErrorHandlerError {
    #[error("Errore di inizializzazione: {0}")]
    InitializationError(String),
    
    #[error("Errore di configurazione: {0}")]
    ConfigurationError(String),
    
    #[error("Errore di registrazione: {0}")]
    LoggingError(String),
    
    #[error("Errore di notifica: {0}")]
    NotificationError(String),
    
    #[error("Errore di recupero: {0}")]
    RecoveryError(String),
    
    #[error("Errore sconosciuto: {0}")]
    UnknownError(String),
}

/// Livello di gravità dell'errore
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ErrorSeverity {
    Debug,
    Info,
    Warning,
    Error,
    Critical,
    Fatal,
}

/// Contesto dell'errore
#[derive(Debug, Clone)]
pub struct ErrorContext {
    /// Componente in cui si è verificato l'errore
    pub component: String,
    
    /// Operazione durante la quale si è verificato l'errore
    pub operation: String,
    
    /// Dati aggiuntivi relativi all'errore
    pub metadata: HashMap<String, String>,
    
    /// Timestamp dell'errore
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

impl ErrorContext {
    /// Crea un nuovo contesto di errore
    pub fn new(component: &str, operation: &str) -> Self {
        Self {
            component: component.to_string(),
            operation: operation.to_string(),
            metadata: HashMap::new(),
            timestamp: chrono::Utc::now(),
        }
    }
    
    /// Aggiunge metadati al contesto
    pub fn with_metadata(mut self, key: &str, value: &str) -> Self {
        self.metadata.insert(key.to_string(), value.to_string());
        self
    }
    
    /// Aggiunge più metadati al contesto
    pub fn with_metadata_map(mut self, metadata: HashMap<String, String>) -> Self {
        self.metadata.extend(metadata);
        self
    }
}

/// Informazioni sull'errore
#[derive(Debug, Clone)]
pub struct ErrorInfo {
    /// ID univoco dell'errore
    pub id: String,
    
    /// Messaggio di errore
    pub message: String,
    
    /// Gravità dell'errore
    pub severity: ErrorSeverity,
    
    /// Contesto dell'errore
    pub context: ErrorContext,
    
    /// Errore originale (opzionale)
    pub source: Option<String>,
    
    /// Tentativi di recupero effettuati
    pub recovery_attempts: u32,
    
    /// Stato di risoluzione
    pub resolved: bool,
}

impl ErrorInfo {
    /// Crea una nuova informazione di errore
    pub fn new(message: &str, severity: ErrorSeverity, context: ErrorContext) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            message: message.to_string(),
            severity,
            context,
            source: None,
            recovery_attempts: 0,
            resolved: false,
        }
    }
    
    /// Imposta l'errore originale
    pub fn with_source(mut self, source: &str) -> Self {
        self.source = Some(source.to_string());
        self
    }
    
    /// Incrementa il contatore dei tentativi di recupero
    pub fn increment_recovery_attempts(&mut self) {
        self.recovery_attempts += 1;
    }
    
    /// Segna l'errore come risolto
    pub fn mark_resolved(&mut self) {
        self.resolved = true;
    }
}

/// Configurazione del gestore degli errori
#[derive(Debug, Clone)]
pub struct ErrorHandlerConfig {
    /// Dimensione massima della coda degli errori
    pub max_queue_size: usize,
    
    /// Numero massimo di tentativi di recupero
    pub max_recovery_attempts: u32,
    
    /// Intervallo tra i tentativi di recupero (in millisecondi)
    pub recovery_interval_ms: u64,
    
    /// Abilitare la notifica degli errori
    pub enable_notifications: bool,
    
    /// URL del webhook per le notifiche
    pub notification_webhook_url: Option<String>,
    
    /// Livello minimo di gravità per le notifiche
    pub notification_min_severity: ErrorSeverity,
    
    /// Abilitare il logging non bloccante
    pub enable_non_blocking_logging: bool,
    
    /// Dimensione del buffer di logging
    pub logging_buffer_size: usize,
}

impl Default for ErrorHandlerConfig {
    fn default() -> Self {
        Self {
            max_queue_size: 1000,
            max_recovery_attempts: 3,
            recovery_interval_ms: 1000,
            enable_notifications: false,
            notification_webhook_url: None,
            notification_min_severity: ErrorSeverity::Error,
            enable_non_blocking_logging: true,
            logging_buffer_size: 100,
        }
    }
}

/// Tipo di funzione di recupero
type RecoveryFn = Box<dyn Fn(&ErrorInfo) -> Result<(), ErrorHandlerError> + Send + Sync>;

/// Gestore degli errori
pub struct ErrorHandler {
    /// Configurazione del gestore
    config: ErrorHandlerConfig,
    
    /// Coda degli errori
    error_queue: Arc<Mutex<VecDeque<ErrorInfo>>>,
    
    /// Funzioni di recupero registrate
    recovery_functions: Arc<RwLock<HashMap<String, RecoveryFn>>>,
    
    /// Buffer di logging
    logging_buffer: Arc<Mutex<VecDeque<ErrorInfo>>>,
    
    /// Semaforo per limitare le operazioni concorrenti
    semaphore: Arc<Semaphore>,
    
    /// Statistiche
    stats: Arc<RwLock<ErrorHandlerStats>>,
}

/// Statistiche del gestore degli errori
#[derive(Debug, Clone, Default)]
pub struct ErrorHandlerStats {
    /// Numero totale di errori gestiti
    pub total_errors: u64,
    
    /// Numero di errori per livello di gravità
    pub errors_by_severity: HashMap<ErrorSeverity, u64>,
    
    /// Numero di errori risolti
    pub resolved_errors: u64,
    
    /// Numero di tentativi di recupero
    pub recovery_attempts: u64,
    
    /// Numero di recuperi riusciti
    pub successful_recoveries: u64,
    
    /// Numero di notifiche inviate
    pub notifications_sent: u64,
    
    /// Tempo medio di gestione degli errori (in millisecondi)
    pub avg_handling_time_ms: f64,
    
    /// Dimensione attuale della coda
    pub current_queue_size: usize,
    
    /// Dimensione massima raggiunta dalla coda
    pub peak_queue_size: usize,
}

impl ErrorHandler {
    /// Crea un nuovo gestore degli errori con la configurazione predefinita
    pub fn new() -> Result<Self, ErrorHandlerError> {
        Self::with_config(ErrorHandlerConfig::default())
    }
    
    /// Crea un nuovo gestore degli errori con una configurazione personalizzata
    pub fn with_config(config: ErrorHandlerConfig) -> Result<Self, ErrorHandlerError> {
        let handler = Self {
            config: config.clone(),
            error_queue: Arc::new(Mutex::new(VecDeque::with_capacity(config.max_queue_size))),
            recovery_functions: Arc::new(RwLock::new(HashMap::new())),
            logging_buffer: Arc::new(Mutex::new(VecDeque::with_capacity(config.logging_buffer_size))),
            semaphore: Arc::new(Semaphore::new(10)), // Limita a 10 operazioni concorrenti
            stats: Arc::new(RwLock::new(ErrorHandlerStats::default())),
        };
        
        // Avvia il worker di logging se abilitato
        if config.enable_non_blocking_logging {
            let logging_buffer = handler.logging_buffer.clone();
            tokio::spawn(async move {
                loop {
                    sleep(Duration::from_millis(100)).await;
                    Self::process_logging_buffer(&logging_buffer).await;
                }
            });
        }
        
        Ok(handler)
    }
    
    /// Registra una funzione di recupero per un componente specifico
    pub fn register_recovery_function<F>(&self, component: &str, f: F) -> Result<(), ErrorHandlerError>
    where
        F: Fn(&ErrorInfo) -> Result<(), ErrorHandlerError> + Send + Sync + 'static,
    {
        let mut recovery_functions = self.recovery_functions.write().map_err(|e| {
            ErrorHandlerError::InitializationError(format!("Impossibile acquisire il lock: {}", e))
        })?;
        
        recovery_functions.insert(component.to_string(), Box::new(f));
        Ok(())
    }
    
    /// Gestisce un errore
    pub async fn handle_error(&self, error_info: ErrorInfo) -> Result<(), ErrorHandlerError> {
        let start_time = Instant::now();
        
        // Aggiorna le statistiche
        {
            let mut stats = self.stats.write().map_err(|e| {
                ErrorHandlerError::UnknownError(format!("Impossibile acquisire il lock delle statistiche: {}", e))
            })?;
            
            stats.total_errors += 1;
            
            let severity_count = stats.errors_by_severity.entry(error_info.severity).or_insert(0);
            *severity_count += 1;
        }
        
        // Logga l'errore
        self.log_error(&error_info).await?;
        
        // Invia notifica se necessario
        if self.config.enable_notifications && error_info.severity >= self.config.notification_min_severity {
            self.send_notification(&error_info).await?;
        }
        
        // Tenta il recupero se disponibile
        let recovery_result = self.attempt_recovery(&error_info).await;
        
        // Aggiungi l'errore alla coda se non è stato risolto
        if recovery_result.is_err() {
            let mut error_queue = self.error_queue.lock().map_err(|e| {
                ErrorHandlerError::UnknownError(format!("Impossibile acquisire il lock della coda: {}", e))
            })?;
            
            // Verifica se la coda è piena
            if error_queue.len() >= self.config.max_queue_size {
                // Rimuovi l'errore più vecchio
                error_queue.pop_front();
            }
            
            // Aggiungi il nuovo errore
            error_queue.push_back(error_info.clone());
            
            // Aggiorna le statistiche
            let mut stats = self.stats.write().map_err(|e| {
                ErrorHandlerError::UnknownError(format!("Impossibile acquisire il lock delle statistiche: {}", e))
            })?;
            
            stats.current_queue_size = error_queue.len();
            stats.peak_queue_size = stats.peak_queue_size.max(error_queue.len());
        }
        
        // Aggiorna il tempo medio di gestione
        {
            let mut stats = self.stats.write().map_err(|e| {
                ErrorHandlerError::UnknownError(format!("Impossibile acquisire il lock delle statistiche: {}", e))
            })?;
            
            let handling_time = start_time.elapsed().as_millis() as f64;
            stats.avg_handling_time_ms = (stats.avg_handling_time_ms * (stats.total_errors - 1) as f64 + handling_time) / stats.total_errors as f64;
        }
        
        Ok(())
    }
    
    /// Logga un errore
    async fn log_error(&self, error_info: &ErrorInfo) -> Result<(), ErrorHandlerError> {
        if self.config.enable_non_blocking_logging {
            // Aggiungi l'errore al buffer di logging
            let mut logging_buffer = self.logging_buffer.lock().map_err(|e| {
                ErrorHandlerError::LoggingError(format!("Impossibile acquisire il lock del buffer di logging: {}", e))
            })?;
            
            // Verifica se il buffer è pieno
            if logging_buffer.len() >= self.config.logging_buffer_size {
                // Rimuovi l'errore più vecchio
                logging_buffer.pop_front();
            }
            
            // Aggiungi il nuovo errore
            logging_buffer.push_back(error_info.clone());
        } else {
            // Logga immediatamente
            Self::log_error_info(error_info);
        }
        
        Ok(())
    }
    
    /// Processa il buffer di logging
    async fn process_logging_buffer(logging_buffer: &Arc<Mutex<VecDeque<ErrorInfo>>>) {
        let errors_to_log = {
            let mut buffer = match logging_buffer.lock() {
                Ok(buffer) => buffer,
                Err(e) => {
                    error!("Impossibile acquisire il lock del buffer di logging: {}", e);
                    return;
                }
            };
            
            // Prendi tutti gli errori dal buffer
            let errors = buffer.drain(..).collect::<Vec<_>>();
            errors
        };
        
        // Logga tutti gli errori
        for error_info in errors_to_log {
            Self::log_error_info(&error_info);
        }
    }
    
    /// Logga le informazioni sull'errore
    fn log_error_info(error_info: &ErrorInfo) {
        let log_message = format!(
            "[{}] {} - {} in {}.{} - ID: {}",
            error_info.severity as u8,
            error_info.message,
            error_info.context.operation,
            error_info.context.component,
            if let Some(source) = &error_info.source {
                format!(" - Causa: {}", source)
            } else {
                String::new()
            },
            error_info.id
        );
        
        match error_info.severity {
            ErrorSeverity::Debug => debug!("{}", log_message),
            ErrorSeverity::Info => info!("{}", log_message),
            ErrorSeverity::Warning => warn!("{}", log_message),
            ErrorSeverity::Error | ErrorSeverity::Critical | ErrorSeverity::Fatal => error!("{}", log_message),
        }
    }
    
    /// Invia una notifica per un errore
    async fn send_notification(&self, error_info: &ErrorInfo) -> Result<(), ErrorHandlerError> {
        // Acquisisci un permesso dal semaforo
        let _permit = self.semaphore.acquire().await.map_err(|e| {
            ErrorHandlerError::NotificationError(format!("Impossibile acquisire il permesso dal semaforo: {}", e))
        })?;
        
        // Verifica se l'URL del webhook è configurato
        if let Some(webhook_url) = &self.config.notification_webhook_url {
            // In un'implementazione reale, qui invieresti la notifica al webhook
            // Per semplicità, qui logghiamo solo l'evento
            info!(
                "Notifica inviata per errore {} - Gravità: {:?} - Componente: {}",
                error_info.id, error_info.severity, error_info.context.component
            );
            
            // Aggiorna le statistiche
            let mut stats = self.stats.write().map_err(|e| {
                ErrorHandlerError::UnknownError(format!("Impossibile acquisire il lock delle statistiche: {}", e))
            })?;
            
            stats.notifications_sent += 1;
        }
        
        Ok(())
    }
    
    /// Tenta il recupero da un errore
    async fn attempt_recovery(&self, error_info: &ErrorInfo) -> Result<(), ErrorHandlerError> {
        // Verifica se esiste una funzione di recupero per questo componente
        let recovery_function = {
            let recovery_functions = self.recovery_functions.read().map_err(|e| {
                ErrorHandlerError::RecoveryError(format!("Impossibile acquisire il lock: {}", e))
            })?;
            
            recovery_functions.get(&error_info.context.component).cloned()
        };
        
        if let Some(recovery_fn) = recovery_function {
            // Aggiorna le statistiche
            {
                let mut stats = self.stats.write().map_err(|e| {
                    ErrorHandlerError::UnknownError(format!("Impossibile acquisire il lock delle statistiche: {}", e))
                })?;
                
                stats.recovery_attempts += 1;
            }
            
            // Tenta il recupero
            let result = recovery_fn(error_info);
            
            // Aggiorna le statistiche in base al risultato
            {
                let mut stats = self.stats.write().map_err(|e| {
                    ErrorHandlerError::UnknownError(format!("Impossibile acquisire il lock delle statistiche: {}", e))
                })?;
                
                if result.is_ok() {
                    stats.successful_recoveries += 1;
                    stats.resolved_errors += 1;
                }
            }
            
            result
        } else {
            Err(ErrorHandlerError::RecoveryError(format!(
                "Nessuna funzione di recupero registrata per il componente: {}",
                error_info.context.component
            )))
        }
    }
    
    /// Ottiene le statistiche del gestore degli errori
    pub fn get_stats(&self) -> Result<ErrorHandlerStats, ErrorHandlerError> {
        let stats = self.stats.read().map_err(|e| {
            ErrorHandlerError::UnknownError(format!("Impossibile acquisire il lock delle statistiche: {}", e))
        })?;
        
        Ok(stats.clone())
    }
    
    /// Ottiene gli errori non risolti
    pub fn get_unresolved_errors(&self) -> Result<Vec<ErrorInfo>, ErrorHandlerError> {
        let error_queue = self.error_queue.lock().map_err(|e| {
            ErrorHandlerError::UnknownError(format!("Impossibile acquisire il lock della coda: {}", e))
        })?;
        
        Ok(error_queue.iter().filter(|e| !e.resolved).cloned().collect())
    }
    
    /// Ottiene gli errori per componente
    pub fn get_errors_by_component(&self, component: &str) -> Result<Vec<ErrorInfo>, ErrorHandlerError> {
        let error_queue = self.error_queue.lock().map_err(|e| {
            ErrorHandlerError::UnknownError(format!("Impossibile acquisire il lock della coda: {}", e))
        })?;
        
        Ok(error_queue
            .iter()
            .filter(|e| e.context.component == component)
            .cloned()
            .collect())
    }
    
    /// Ottiene gli errori per gravità
    pub fn get_errors_by_severity(&self, severity: ErrorSeverity) -> Result<Vec<ErrorInfo>, ErrorHandlerError> {
        let error_queue = self.error_queue.lock().map_err(|e| {
            ErrorHandlerError::UnknownError(format!("Impossibile acquisire il lock della coda: {}", e))
        })?;
        
        Ok(error_queue
            .iter()
            .filter(|e| e.severity == severity)
            .cloned()
            .collect())
    }
    
    /// Pulisce gli errori risolti dalla coda
    pub fn clean_resolved_errors(&self) -> Result<usize, ErrorHandlerError> {
        let mut error_queue = self.error_queue.lock().map_err(|e| {
            ErrorHandlerError::UnknownError(format!("Impossibile acquisire il lock della coda: {}", e))
        })?;
        
        let initial_size = error_queue.len();
        error_queue.retain(|e| !e.resolved);
        let removed_count = initial_size - error_queue.len();
        
        // Aggiorna le statistiche
        let mut stats = self.stats.write().map_err(|e| {
            ErrorHandlerError::UnknownError(format!("Impossibile acquisire il lock delle statistiche: {}", e))
        })?;
        
        stats.current_queue_size = error_queue.len();
        
        Ok(removed_count)
    }
}

/// Monitor degli errori
pub struct ErrorMonitor {
    /// Gestore degli errori
    error_handler: Arc<ErrorHandler>,
    
    /// Intervallo di monitoraggio (in millisecondi)
    monitoring_interval_ms: u64,
    
    /// Soglie di allarme per gravità
    alarm_thresholds: HashMap<ErrorSeverity, u64>,
    
    /// Callback di allarme
    alarm_callback: Option<Box<dyn Fn(ErrorSeverity, u64) + Send + Sync>>,
    
    /// Stato di esecuzione
    running: Arc<RwLock<bool>>,
}

impl ErrorMonitor {
    /// Crea un nuovo monitor degli errori
    pub fn new(error_handler: Arc<ErrorHandler>, monitoring_interval_ms: u64) -> Self {
        Self {
            error_handler,
            monitoring_interval_ms,
            alarm_thresholds: HashMap::new(),
            alarm_callback: None,
            running: Arc::new(RwLock::new(false)),
        }
    }
    
    /// Imposta una soglia di allarme per una gravità specifica
    pub fn set_alarm_threshold(&mut self, severity: ErrorSeverity, threshold: u64) {
        self.alarm_thresholds.insert(severity, threshold);
    }
    
    /// Imposta il callback di allarme
    pub fn set_alarm_callback<F>(&mut self, callback: F)
    where
        F: Fn(ErrorSeverity, u64) + Send + Sync + 'static,
    {
        self.alarm_callback = Some(Box::new(callback));
    }
    
    /// Avvia il monitoraggio
    pub async fn start(&self) -> Result<(), ErrorHandlerError> {
        // Imposta lo stato di esecuzione
        {
            let mut running = self.running.write().map_err(|e| {
                ErrorHandlerError::InitializationError(format!("Impossibile acquisire il lock: {}", e))
            })?;
            
            if *running {
                return Err(ErrorHandlerError::InitializationError(
                    "Il monitor è già in esecuzione".to_string(),
                ));
            }
            
            *running = true;
        }
        
        // Clona le risorse necessarie per il task
        let error_handler = self.error_handler.clone();
        let alarm_thresholds = self.alarm_thresholds.clone();
        let alarm_callback = self.alarm_callback.clone();
        let running = self.running.clone();
        let interval = self.monitoring_interval_ms;
        
        // Avvia il task di monitoraggio
        tokio::spawn(async move {
            while {
                let is_running = running.read().unwrap_or_else(|_| {
                    error!("Impossibile acquisire il lock dello stato di esecuzione");
                    Box::new(false)
                });
                *is_running
            } {
                // Ottieni le statistiche
                match error_handler.get_stats() {
                    Ok(stats) => {
                        // Controlla le soglie di allarme
                        for (severity, count) in &stats.errors_by_severity {
                            if let Some(threshold) = alarm_thresholds.get(severity) {
                                if *count >= *threshold {
                                    // Attiva l'allarme
                                    if let Some(callback) = &alarm_callback {
                                        callback(*severity, *count);
                                    }
                                }
                            }
                        }
                        
                        // Logga le statistiche
                        debug!(
                            "Statistiche del gestore degli errori: {} errori totali, {} risolti, {} in coda",
                            stats.total_errors, stats.resolved_errors, stats.current_queue_size
                        );
                    }
                    Err(e) => {
                        error!("Impossibile ottenere le statistiche: {}", e);
                    }
                }
                
                // Attendi l'intervallo di monitoraggio
                sleep(Duration::from_millis(interval)).await;
            }
        });
        
        Ok(())
    }
    
    /// Ferma il monitoraggio
    pub async fn stop(&self) -> Result<(), ErrorHandlerError> {
        let mut running = self.running.write().map_err(|e| {
            ErrorHandlerError::InitializationError(format!("Impossibile acquisire il lock: {}", e))
        })?;
        
        *running = false;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_error_handler() {
        // Crea un gestore degli errori
        let handler = ErrorHandler::new().unwrap();
        
        // Crea un contesto di errore
        let context = ErrorContext::new("TestComponent", "test_operation")
            .with_metadata("param1", "value1")
            .with_metadata("param2", "value2");
        
        // Crea un'informazione di errore
        let error_info = ErrorInfo::new("Test error", ErrorSeverity::Error, context);
        
        // Gestisci l'errore
        handler.handle_error(error_info).await.unwrap();
        
        // Verifica le statistiche
        let stats = handler.get_stats().unwrap();
        assert_eq!(stats.total_errors, 1);
        assert_eq!(stats.current_queue_size, 1);
    }
    
    #[tokio::test]
    async fn test_error_recovery() {
        // Crea un gestore degli errori
        let handler = ErrorHandler::new().unwrap();
        
        // Registra una funzione di recupero
        handler
            .register_recovery_function("TestComponent", |_| Ok(()))
            .unwrap();
        
        // Crea un contesto di errore
        let context = ErrorContext::new("TestComponent", "test_operation");
        
        // Crea un'informazione di errore
        let error_info = ErrorInfo::new("Test error", ErrorSeverity::Error, context);
        
        // Gestisci l'errore
        handler.handle_error(error_info).await.unwrap();
        
        // Verifica le statistiche
        let stats = handler.get_stats().unwrap();
        assert_eq!(stats.total_errors, 1);
        assert_eq!(stats.recovery_attempts, 1);
        assert_eq!(stats.successful_recoveries, 1);
    }
}
