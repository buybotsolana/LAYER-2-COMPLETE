use std::fmt;
use std::error::Error;
use std::sync::Arc;
use crate::error_handling::error_handler::{Layer2Error, Layer2Result};

/**
 * Sistema di monitoraggio degli errori per Layer-2 su Solana
 * 
 * Questo modulo fornisce funzionalità per monitorare, tracciare e analizzare
 * gli errori che si verificano nel sistema Layer-2, facilitando il debugging
 * e migliorando la robustezza del sistema.
 * 
 * @author Manus
 */

/// Struttura per il monitoraggio degli errori
pub struct ErrorMonitor {
    /// Contatori per i diversi tipi di errori
    error_counters: Arc<parking_lot::RwLock<ErrorCounters>>,
    
    /// Tracciamento degli errori recenti
    recent_errors: Arc<parking_lot::RwLock<Vec<ErrorEntry>>>,
    
    /// Dimensione massima della lista di errori recenti
    max_recent_errors: usize,
    
    /// Callback per notifiche di errori critici
    critical_callbacks: Vec<Box<dyn Fn(&ErrorEntry) + Send + Sync>>,
    
    /// Flag per abilitare/disabilitare il monitoraggio
    enabled: bool,
}

/// Contatori per i diversi tipi di errori
#[derive(Debug, Default, Clone)]
pub struct ErrorCounters {
    /// Errori di bridge
    pub bridge_errors: usize,
    
    /// Errori di finalizzazione
    pub finalization_errors: usize,
    
    /// Errori di prova di frode
    pub fraud_proof_errors: usize,
    
    /// Errori di rete
    pub network_errors: usize,
    
    /// Errori di transazione
    pub transaction_errors: usize,
    
    /// Errori di stato
    pub state_errors: usize,
    
    /// Errori di configurazione
    pub config_errors: usize,
    
    /// Errori di sicurezza
    pub security_errors: usize,
    
    /// Errori generici
    pub generic_errors: usize,
    
    /// Errori esterni
    pub external_errors: usize,
    
    /// Errori critici
    pub critical_errors: usize,
    
    /// Totale errori
    pub total_errors: usize,
}

/// Gravità dell'errore
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorSeverity {
    /// Errore di bassa gravità (informativo)
    Low,
    
    /// Errore di media gravità (warning)
    Medium,
    
    /// Errore di alta gravità (errore)
    High,
    
    /// Errore critico (blocca il sistema)
    Critical,
}

/// Voce di errore per il tracciamento
#[derive(Debug, Clone)]
pub struct ErrorEntry {
    /// Timestamp dell'errore
    pub timestamp: chrono::DateTime<chrono::Utc>,
    
    /// Errore
    pub error: String,
    
    /// Tipo di errore
    pub error_type: String,
    
    /// Gravità dell'errore
    pub severity: ErrorSeverity,
    
    /// Contesto dell'errore
    pub context: Option<String>,
    
    /// Stack trace
    pub stack_trace: Option<String>,
}

impl ErrorMonitor {
    /// Crea un nuovo monitor degli errori
    pub fn new(max_recent_errors: usize) -> Self {
        ErrorMonitor {
            error_counters: Arc::new(parking_lot::RwLock::new(ErrorCounters::default())),
            recent_errors: Arc::new(parking_lot::RwLock::new(Vec::with_capacity(max_recent_errors))),
            max_recent_errors,
            critical_callbacks: Vec::new(),
            enabled: true,
        }
    }
    
    /// Registra un errore
    pub fn record_error(&self, error: &Layer2Error, context: Option<String>) {
        if !self.enabled {
            return;
        }
        
        // Determina il tipo e la gravità dell'errore
        let (error_type, severity) = self.classify_error(error);
        
        // Incrementa i contatori
        {
            let mut counters = self.error_counters.write();
            match error {
                Layer2Error::Bridge(_) => counters.bridge_errors += 1,
                Layer2Error::Finalization(_) => counters.finalization_errors += 1,
                Layer2Error::FraudProof(_) => counters.fraud_proof_errors += 1,
                Layer2Error::Network(_) => counters.network_errors += 1,
                Layer2Error::Transaction(_) => counters.transaction_errors += 1,
                Layer2Error::State(_) => counters.state_errors += 1,
                Layer2Error::Config(_) => counters.config_errors += 1,
                Layer2Error::Security(_) => counters.security_errors += 1,
                Layer2Error::Generic(_) => counters.generic_errors += 1,
                Layer2Error::External { .. } => counters.external_errors += 1,
            }
            
            if severity == ErrorSeverity::Critical {
                counters.critical_errors += 1;
            }
            
            counters.total_errors += 1;
        }
        
        // Crea una voce di errore
        let entry = ErrorEntry {
            timestamp: chrono::Utc::now(),
            error: error.to_string(),
            error_type,
            severity,
            context,
            stack_trace: self.capture_stack_trace(),
        };
        
        // Aggiungi l'errore alla lista di errori recenti
        {
            let mut recent = self.recent_errors.write();
            if recent.len() >= self.max_recent_errors {
                recent.remove(0); // Rimuovi l'errore più vecchio
            }
            recent.push(entry.clone());
        }
        
        // Notifica i callback per errori critici
        if severity == ErrorSeverity::Critical {
            for callback in &self.critical_callbacks {
                callback(&entry);
            }
        }
    }
    
    /// Classifica un errore per tipo e gravità
    fn classify_error(&self, error: &Layer2Error) -> (String, ErrorSeverity) {
        match error {
            Layer2Error::Bridge(bridge_error) => {
                let severity = match bridge_error {
                    crate::error_handling::error_handler::BridgeError::DepositFailed { .. } => ErrorSeverity::High,
                    crate::error_handling::error_handler::BridgeError::WithdrawalFailed { .. } => ErrorSeverity::High,
                    crate::error_handling::error_handler::BridgeError::MessageVerificationFailed { .. } => ErrorSeverity::High,
                    crate::error_handling::error_handler::BridgeError::Timeout { .. } => ErrorSeverity::Medium,
                    crate::error_handling::error_handler::BridgeError::InsufficientLiquidity { .. } => ErrorSeverity::Medium,
                    crate::error_handling::error_handler::BridgeError::UnsupportedToken(_) => ErrorSeverity::Low,
                    crate::error_handling::error_handler::BridgeError::Other(_) => ErrorSeverity::Medium,
                };
                ("Bridge".to_string(), severity)
            },
            Layer2Error::Finalization(finalization_error) => {
                let severity = match finalization_error {
                    crate::error_handling::error_handler::FinalizationError::ConsensusFailure { .. } => ErrorSeverity::Critical,
                    crate::error_handling::error_handler::FinalizationError::CheckpointFailure { .. } => ErrorSeverity::High,
                    crate::error_handling::error_handler::FinalizationError::InsufficientStake { .. } => ErrorSeverity::Medium,
                    crate::error_handling::error_handler::FinalizationError::Timeout { .. } => ErrorSeverity::Medium,
                    crate::error_handling::error_handler::FinalizationError::FinalityFailure { .. } => ErrorSeverity::High,
                    crate::error_handling::error_handler::FinalizationError::Other(_) => ErrorSeverity::Medium,
                };
                ("Finalization".to_string(), severity)
            },
            Layer2Error::FraudProof(fraud_proof_error) => {
                let severity = match fraud_proof_error {
                    crate::error_handling::error_handler::FraudProofError::ProofVerificationFailed { .. } => ErrorSeverity::High,
                    crate::error_handling::error_handler::FraudProofError::BisectionFailed { .. } => ErrorSeverity::High,
                    crate::error_handling::error_handler::FraudProofError::Timeout { .. } => ErrorSeverity::Medium,
                    crate::error_handling::error_handler::FraudProofError::InvalidState { .. } => ErrorSeverity::High,
                    crate::error_handling::error_handler::FraudProofError::InvalidStateTransition { .. } => ErrorSeverity::High,
                    crate::error_handling::error_handler::FraudProofError::Other(_) => ErrorSeverity::Medium,
                };
                ("FraudProof".to_string(), severity)
            },
            Layer2Error::Network(network_error) => {
                let severity = match network_error {
                    crate::error_handling::error_handler::NetworkError::ConnectionFailed { .. } => ErrorSeverity::Medium,
                    crate::error_handling::error_handler::NetworkError::Timeout { .. } => ErrorSeverity::Low,
                    crate::error_handling::error_handler::NetworkError::RateLimited { .. } => ErrorSeverity::Low,
                    crate::error_handling::error_handler::NetworkError::ResponseError { .. } => ErrorSeverity::Medium,
                    crate::error_handling::error_handler::NetworkError::SerializationError { .. } => ErrorSeverity::Medium,
                    crate::error_handling::error_handler::NetworkError::Other(_) => ErrorSeverity::Medium,
                };
                ("Network".to_string(), severity)
            },
            Layer2Error::Transaction(transaction_error) => {
                let severity = match transaction_error {
                    crate::error_handling::error_handler::TransactionError::SignatureError { .. } => ErrorSeverity::High,
                    crate::error_handling::error_handler::TransactionError::InsufficientGas { .. } => ErrorSeverity::Medium,
                    crate::error_handling::error_handler::TransactionError::InvalidNonce { .. } => ErrorSeverity::Medium,
                    crate::error_handling::error_handler::TransactionError::InsufficientBalance { .. } => ErrorSeverity::Medium,
                    crate::error_handling::error_handler::TransactionError::ExecutionError { .. } => ErrorSeverity::High,
                    crate::error_handling::error_handler::TransactionError::Timeout { .. } => ErrorSeverity::Low,
                    crate::error_handling::error_handler::TransactionError::Rejected { .. } => ErrorSeverity::Medium,
                    crate::error_handling::error_handler::TransactionError::Other(_) => ErrorSeverity::Medium,
                };
                ("Transaction".to_string(), severity)
            },
            Layer2Error::State(state_error) => {
                let severity = match state_error {
                    crate::error_handling::error_handler::StateError::AccessError { .. } => ErrorSeverity::High,
                    crate::error_handling::error_handler::StateError::NotFound { .. } => ErrorSeverity::Medium,
                    crate::error_handling::error_handler::StateError::Corruption { .. } => ErrorSeverity::Critical,
                    crate::error_handling::error_handler::StateError::SyncError { .. } => ErrorSeverity::High,
                    crate::error_handling::error_handler::StateError::MerkleProofError { .. } => ErrorSeverity::High,
                    crate::error_handling::error_handler::StateError::Other(_) => ErrorSeverity::Medium,
                };
                ("State".to_string(), severity)
            },
            Layer2Error::Config(config_error) => {
                let severity = match config_error {
                    crate::error_handling::error_handler::ConfigError::ParseError { .. } => ErrorSeverity::Medium,
                    crate::error_handling::error_handler::ConfigError::ValidationError { .. } => ErrorSeverity::Medium,
                    crate::error_handling::error_handler::ConfigError::MissingKey { .. } => ErrorSeverity::Medium,
                    crate::error_handling::error_handler::ConfigError::InvalidType { .. } => ErrorSeverity::Medium,
                    crate::error_handling::error_handler::ConfigError::LoadError { .. } => ErrorSeverity::High,
                    crate::error_handling::error_handler::ConfigError::Other(_) => ErrorSeverity::Medium,
                };
                ("Config".to_string(), severity)
            },
            Layer2Error::Security(security_error) => {
                let severity = match security_error {
                    crate::error_handling::error_handler::SecurityError::AuthenticationFailed { .. } => ErrorSeverity::High,
                    crate::error_handling::error_handler::SecurityError::AuthorizationFailed { .. } => ErrorSeverity::High,
                    crate::error_handling::error_handler::SecurityError::TokenValidationFailed { .. } => ErrorSeverity::High,
                    crate::error_handling::error_handler::SecurityError::RateLimited { .. } => ErrorSeverity::Low,
                    crate::error_handling::error_handler::SecurityError::InvalidInput { .. } => ErrorSeverity::Medium,
                    crate::error_handling::error_handler::SecurityError::Other(_) => ErrorSeverity::Medium,
                };
                ("Security".to_string(), severity)
            },
            Layer2Error::Generic(_) => {
                ("Generic".to_string(), ErrorSeverity::Medium)
            },
            Layer2Error::External { .. } => {
                ("External".to_string(), ErrorSeverity::Medium)
            },
        }
    }
    
    /// Cattura lo stack trace
    fn capture_stack_trace(&self) -> Option<String> {
        // In una implementazione reale, qui si utilizzerebbe una libreria
        // per catturare lo stack trace, come backtrace-rs
        #[cfg(feature = "backtrace")]
        {
            let backtrace = backtrace::Backtrace::new();
            Some(format!("{:?}", backtrace))
        }
        
        #[cfg(not(feature = "backtrace"))]
        None
    }
    
    /// Aggiunge un callback per errori critici
    pub fn add_critical_callback<F>(&mut self, callback: F)
    where
        F: Fn(&ErrorEntry) + Send + Sync + 'static,
    {
        self.critical_callbacks.push(Box::new(callback));
    }
    
    /// Ottiene le statistiche degli errori
    pub fn get_error_stats(&self) -> ErrorCounters {
        self.error_counters.read().clone()
    }
    
    /// Ottiene gli errori recenti
    pub fn get_recent_errors(&self) -> Vec<ErrorEntry> {
        self.recent_errors.read().clone()
    }
    
    /// Ottiene gli errori recenti di un certo tipo
    pub fn get_recent_errors_by_type(&self, error_type: &str) -> Vec<ErrorEntry> {
        self.recent_errors.read().iter()
            .filter(|entry| entry.error_type == error_type)
            .cloned()
            .collect()
    }
    
    /// Ottiene gli errori recenti di una certa gravità
    pub fn get_recent_errors_by_severity(&self, severity: ErrorSeverity) -> Vec<ErrorEntry> {
        self.recent_errors.read().iter()
            .filter(|entry| entry.severity == severity)
            .cloned()
            .collect()
    }
    
    /// Resetta i contatori degli errori
    pub fn reset_counters(&self) {
        *self.error_counters.write() = ErrorCounters::default();
    }
    
    /// Cancella gli errori recenti
    pub fn clear_recent_errors(&self) {
        self.recent_errors.write().clear();
    }
    
    /// Abilita il monitoraggio
    pub fn enable(&mut self) {
        self.enabled = true;
    }
    
    /// Disabilita il monitoraggio
    pub fn disable(&mut self) {
        self.enabled = false;
    }
    
    /// Verifica se il monitoraggio è abilitato
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }
}

impl fmt::Display for ErrorSeverity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErrorSeverity::Low => write!(f, "Low"),
            ErrorSeverity::Medium => write!(f, "Medium"),
            ErrorSeverity::High => write!(f, "High"),
            ErrorSeverity::Critical => write!(f, "Critical"),
        }
    }
}

/// Estensione per Result per registrare gli errori
pub trait MonitorExt<T> {
    /// Registra un errore se presente
    fn monitor(self, monitor: &ErrorMonitor) -> Self;
    
    /// Registra un errore con contesto se presente
    fn monitor_with_context<C, F>(self, monitor: &ErrorMonitor, context: F) -> Self
    where
        F: FnOnce() -> C,
        C: Into<String>;
}

impl<T> MonitorExt<T> for Layer2Result<T> {
    fn monitor(self, monitor: &ErrorMonitor) -> Self {
        if let Err(ref error) = self {
            monitor.record_error(error, None);
        }
        self
    }
    
    fn monitor_with_context<C, F>(self, monitor: &ErrorMonitor, context: F) -> Self
    where
        F: FnOnce() -> C,
        C: Into<String>,
    {
        if let Err(ref error) = self {
            monitor.record_error(error, Some(context().into()));
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error_handling::error_handler::{BridgeError, Layer2Error};
    use std::sync::atomic::{AtomicBool, Ordering};
    
    #[test]
    fn test_error_monitor() {
        let monitor = ErrorMonitor::new(10);
        
        // Registra alcuni errori
        let error1 = Layer2Error::Bridge(BridgeError::DepositFailed {
            token: "ETH".to_string(),
            amount: 1000000000,
            reason: "insufficient funds".to_string(),
        });
        
        let error2 = Layer2Error::Bridge(BridgeError::Timeout {
            operation: "deposit".to_string(),
            timeout_ms: 5000,
        });
        
        monitor.record_error(&error1, Some("Test context".to_string()));
        monitor.record_error(&error2, None);
        
        // Verifica i contatori
        let stats = monitor.get_error_stats();
        assert_eq!(stats.bridge_errors, 2);
        assert_eq!(stats.total_errors, 2);
        
        // Verifica gli errori recenti
        let recent = monitor.get_recent_errors();
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].error_type, "Bridge");
        assert_eq!(recent[0].context, Some("Test context".to_string()));
        assert_eq!(recent[1].error_type, "Bridge");
        assert_eq!(recent[1].context, None);
        
        // Verifica gli errori per tipo
        let bridge_errors = monitor.get_recent_errors_by_type("Bridge");
        assert_eq!(bridge_errors.len(), 2);
        
        // Verifica gli errori per gravità
        let high_errors = monitor.get_recent_errors_by_severity(ErrorSeverity::High);
        assert_eq!(high_errors.len(), 1);
        
        let medium_errors = monitor.get_recent_errors_by_severity(ErrorSeverity::Medium);
        assert_eq!(medium_errors.len(), 1);
    }
    
    #[test]
    fn test_critical_callback() {
        let called = Arc::new(AtomicBool::new(false));
        let called_clone = Arc::clone(&called);
        
        let mut monitor = ErrorMonitor::new(10);
        monitor.add_critical_callback(move |entry| {
            assert_eq!(entry.severity, ErrorSeverity::Critical);
            called_clone.store(true, Ordering::SeqCst);
        });
        
        // Registra un errore non critico
        let non_critical_error = Layer2Error::Bridge(BridgeError::Timeout {
            operation: "deposit".to_string(),
            timeout_ms: 5000,
        });
        monitor.record_error(&non_critical_error, None);
        assert_eq!(called.load(Ordering::SeqCst), false);
        
        // Registra un errore critico
        let critical_error = Layer2Error::State(crate::error_handling::error_handler::StateError::Corruption {
            context: "block_state".to_string(),
            reason: "hash mismatch".to_string(),
        });
        monitor.record_error(&critical_error, None);
        assert_eq!(called.load(Ordering::SeqCst), true);
    }
    
    #[test]
    fn test_monitor_ext() {
        let monitor = ErrorMonitor::new(10);
        
        // Test con un risultato Ok
        let result: Layer2Result<i32> = Ok(42);
        let monitored = result.monitor(&monitor);
        assert_eq!(monitored, Ok(42));
        
        // Test con un risultato Err
        let error = Layer2Error::Bridge(BridgeError::DepositFailed {
            token: "ETH".to_string(),
            amount: 1000000000,
            reason: "insufficient funds".to_string(),
        });
        let result: Layer2Result<i32> = Err(error);
        let monitored = result.monitor_with_context(&monitor, || "Test context");
        assert!(monitored.is_err());
        
        // Verifica che l'errore sia stato registrato
        let stats = monitor.get_error_stats();
        assert_eq!(stats.bridge_errors, 1);
        assert_eq!(stats.total_errors, 1);
        
        let recent = monitor.get_recent_errors();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].context, Some("Test context".to_string()));
    }
    
    #[test]
    fn test_max_recent_errors() {
        let monitor = ErrorMonitor::new(2);
        
        // Registra 3 errori (dovrebbe mantenere solo gli ultimi 2)
        for i in 0..3 {
            let error = Layer2Error::Generic(format!("Error {}", i));
            monitor.record_error(&error, None);
        }
        
        // Verifica che ci siano solo 2 errori recenti
        let recent = monitor.get_recent_errors();
        assert_eq!(recent.len(), 2);
        assert!(recent[0].error.contains("Error 1"));
        assert!(recent[1].error.contains("Error 2"));
    }
    
    #[test]
    fn test_disable_enable() {
        let mut monitor = ErrorMonitor::new(10);
        
        // Disabilita il monitoraggio
        monitor.disable();
        assert_eq!(monitor.is_enabled(), false);
        
        // Registra un errore (non dovrebbe essere registrato)
        let error = Layer2Error::Generic("Test error".to_string());
        monitor.record_error(&error, None);
        
        // Verifica che non ci siano errori registrati
        let stats = monitor.get_error_stats();
        assert_eq!(stats.total_errors, 0);
        
        // Riabilita il monitoraggio
        monitor.enable();
        assert_eq!(monitor.is_enabled(), true);
        
        // Registra un errore (dovrebbe essere registrato)
        monitor.record_error(&error, None);
        
        // Verifica che l'errore sia stato registrato
        let stats = monitor.get_error_stats();
        assert_eq!(stats.total_errors, 1);
    }
}
