use std::fmt;
use std::error::Error;
use std::sync::Arc;

/**
 * Sistema di gestione degli errori migliorato per Layer-2 su Solana
 * 
 * Questo modulo fornisce un sistema completo per la gestione degli errori,
 * con supporto per errori tipizzati, catene di errori, contesto e logging.
 * 
 * @author Manus
 */

/// Enum che rappresenta tutti i possibili errori nel sistema Layer-2
#[derive(Debug)]
pub enum Layer2Error {
    /// Errori di bridge
    Bridge(BridgeError),
    
    /// Errori di finalizzazione
    Finalization(FinalizationError),
    
    /// Errori di prova di frode
    FraudProof(FraudProofError),
    
    /// Errori di rete
    Network(NetworkError),
    
    /// Errori di transazione
    Transaction(TransactionError),
    
    /// Errori di stato
    State(StateError),
    
    /// Errori di configurazione
    Config(ConfigError),
    
    /// Errori di sicurezza
    Security(SecurityError),
    
    /// Errori generici
    Generic(String),
    
    /// Errori esterni
    External {
        source: Box<dyn Error + Send + Sync>,
        context: String,
    },
}

/// Errori specifici del bridge
#[derive(Debug)]
pub enum BridgeError {
    /// Errore di deposito
    DepositFailed {
        token: String,
        amount: u64,
        reason: String,
    },
    
    /// Errore di prelievo
    WithdrawalFailed {
        token: String,
        amount: u64,
        reason: String,
    },
    
    /// Errore di verifica del messaggio
    MessageVerificationFailed {
        message_id: String,
        reason: String,
    },
    
    /// Errore di timeout
    Timeout {
        operation: String,
        timeout_ms: u64,
    },
    
    /// Errore di liquidità insufficiente
    InsufficientLiquidity {
        token: String,
        required: u64,
        available: u64,
    },
    
    /// Errore di token non supportato
    UnsupportedToken(String),
    
    /// Errore generico del bridge
    Other(String),
}

/// Errori specifici della finalizzazione
#[derive(Debug)]
pub enum FinalizationError {
    /// Errore di consenso
    ConsensusFailure {
        block_number: u64,
        reason: String,
    },
    
    /// Errore di checkpoint
    CheckpointFailure {
        checkpoint_id: String,
        reason: String,
    },
    
    /// Errore di stake insufficiente
    InsufficientStake {
        validator: String,
        required: u64,
        actual: u64,
    },
    
    /// Errore di timeout
    Timeout {
        operation: String,
        timeout_ms: u64,
    },
    
    /// Errore di finalità
    FinalityFailure {
        block_number: u64,
        reason: String,
    },
    
    /// Errore generico di finalizzazione
    Other(String),
}

/// Errori specifici della prova di frode
#[derive(Debug)]
pub enum FraudProofError {
    /// Errore di verifica della prova
    ProofVerificationFailed {
        proof_id: String,
        reason: String,
    },
    
    /// Errore di bisection
    BisectionFailed {
        game_id: String,
        step: u32,
        reason: String,
    },
    
    /// Errore di timeout
    Timeout {
        operation: String,
        timeout_ms: u64,
    },
    
    /// Errore di stato invalido
    InvalidState {
        expected: String,
        actual: String,
    },
    
    /// Errore di transizione di stato invalida
    InvalidStateTransition {
        from: String,
        to: String,
        reason: String,
    },
    
    /// Errore generico di prova di frode
    Other(String),
}

/// Errori specifici di rete
#[derive(Debug)]
pub enum NetworkError {
    /// Errore di connessione
    ConnectionFailed {
        endpoint: String,
        reason: String,
    },
    
    /// Errore di timeout
    Timeout {
        operation: String,
        timeout_ms: u64,
    },
    
    /// Errore di rate limit
    RateLimited {
        endpoint: String,
        limit: u32,
        reset_after_ms: u64,
    },
    
    /// Errore di risposta
    ResponseError {
        endpoint: String,
        status_code: u16,
        message: String,
    },
    
    /// Errore di serializzazione/deserializzazione
    SerializationError {
        context: String,
        reason: String,
    },
    
    /// Errore generico di rete
    Other(String),
}

/// Errori specifici di transazione
#[derive(Debug)]
pub enum TransactionError {
    /// Errore di firma
    SignatureError {
        reason: String,
    },
    
    /// Errore di gas insufficiente
    InsufficientGas {
        required: u64,
        provided: u64,
    },
    
    /// Errore di nonce invalido
    InvalidNonce {
        expected: u64,
        actual: u64,
    },
    
    /// Errore di saldo insufficiente
    InsufficientBalance {
        address: String,
        required: u64,
        available: u64,
    },
    
    /// Errore di esecuzione
    ExecutionError {
        tx_hash: String,
        reason: String,
    },
    
    /// Errore di timeout
    Timeout {
        tx_hash: String,
        timeout_ms: u64,
    },
    
    /// Errore di transazione rifiutata
    Rejected {
        tx_hash: String,
        reason: String,
    },
    
    /// Errore generico di transazione
    Other(String),
}

/// Errori specifici di stato
#[derive(Debug)]
pub enum StateError {
    /// Errore di accesso allo stato
    AccessError {
        key: String,
        reason: String,
    },
    
    /// Errore di stato non trovato
    NotFound {
        key: String,
    },
    
    /// Errore di corruzione dello stato
    Corruption {
        context: String,
        reason: String,
    },
    
    /// Errore di sincronizzazione dello stato
    SyncError {
        context: String,
        reason: String,
    },
    
    /// Errore di prova di Merkle
    MerkleProofError {
        key: String,
        reason: String,
    },
    
    /// Errore generico di stato
    Other(String),
}

/// Errori specifici di configurazione
#[derive(Debug)]
pub enum ConfigError {
    /// Errore di parsing
    ParseError {
        key: String,
        value: String,
        reason: String,
    },
    
    /// Errore di validazione
    ValidationError {
        key: String,
        value: String,
        reason: String,
    },
    
    /// Errore di chiave mancante
    MissingKey {
        key: String,
    },
    
    /// Errore di tipo invalido
    InvalidType {
        key: String,
        expected: String,
        actual: String,
    },
    
    /// Errore di caricamento della configurazione
    LoadError {
        path: String,
        reason: String,
    },
    
    /// Errore generico di configurazione
    Other(String),
}

/// Errori specifici di sicurezza
#[derive(Debug)]
pub enum SecurityError {
    /// Errore di autenticazione
    AuthenticationFailed {
        user: String,
        reason: String,
    },
    
    /// Errore di autorizzazione
    AuthorizationFailed {
        user: String,
        resource: String,
        action: String,
    },
    
    /// Errore di validazione del token
    TokenValidationFailed {
        token_type: String,
        reason: String,
    },
    
    /// Errore di rate limit
    RateLimited {
        user: String,
        limit: u32,
        reset_after_ms: u64,
    },
    
    /// Errore di input invalido
    InvalidInput {
        field: String,
        reason: String,
    },
    
    /// Errore generico di sicurezza
    Other(String),
}

impl fmt::Display for Layer2Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Layer2Error::Bridge(err) => write!(f, "Bridge error: {}", err),
            Layer2Error::Finalization(err) => write!(f, "Finalization error: {}", err),
            Layer2Error::FraudProof(err) => write!(f, "Fraud proof error: {}", err),
            Layer2Error::Network(err) => write!(f, "Network error: {}", err),
            Layer2Error::Transaction(err) => write!(f, "Transaction error: {}", err),
            Layer2Error::State(err) => write!(f, "State error: {}", err),
            Layer2Error::Config(err) => write!(f, "Configuration error: {}", err),
            Layer2Error::Security(err) => write!(f, "Security error: {}", err),
            Layer2Error::Generic(msg) => write!(f, "Error: {}", msg),
            Layer2Error::External { source, context } => {
                write!(f, "External error: {} (Context: {})", source, context)
            }
        }
    }
}

impl fmt::Display for BridgeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BridgeError::DepositFailed { token, amount, reason } => {
                write!(f, "Deposit failed for {} {} - {}", amount, token, reason)
            }
            BridgeError::WithdrawalFailed { token, amount, reason } => {
                write!(f, "Withdrawal failed for {} {} - {}", amount, token, reason)
            }
            BridgeError::MessageVerificationFailed { message_id, reason } => {
                write!(f, "Message verification failed for {} - {}", message_id, reason)
            }
            BridgeError::Timeout { operation, timeout_ms } => {
                write!(f, "Timeout after {}ms during {}", timeout_ms, operation)
            }
            BridgeError::InsufficientLiquidity { token, required, available } => {
                write!(f, "Insufficient liquidity for {}: required {}, available {}", token, required, available)
            }
            BridgeError::UnsupportedToken(token) => {
                write!(f, "Unsupported token: {}", token)
            }
            BridgeError::Other(msg) => {
                write!(f, "{}", msg)
            }
        }
    }
}

impl fmt::Display for FinalizationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FinalizationError::ConsensusFailure { block_number, reason } => {
                write!(f, "Consensus failure for block {}: {}", block_number, reason)
            }
            FinalizationError::CheckpointFailure { checkpoint_id, reason } => {
                write!(f, "Checkpoint failure for {}: {}", checkpoint_id, reason)
            }
            FinalizationError::InsufficientStake { validator, required, actual } => {
                write!(f, "Insufficient stake for validator {}: required {}, actual {}", validator, required, actual)
            }
            FinalizationError::Timeout { operation, timeout_ms } => {
                write!(f, "Timeout after {}ms during {}", timeout_ms, operation)
            }
            FinalizationError::FinalityFailure { block_number, reason } => {
                write!(f, "Finality failure for block {}: {}", block_number, reason)
            }
            FinalizationError::Other(msg) => {
                write!(f, "{}", msg)
            }
        }
    }
}

impl fmt::Display for FraudProofError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FraudProofError::ProofVerificationFailed { proof_id, reason } => {
                write!(f, "Proof verification failed for {}: {}", proof_id, reason)
            }
            FraudProofError::BisectionFailed { game_id, step, reason } => {
                write!(f, "Bisection failed for game {} at step {}: {}", game_id, step, reason)
            }
            FraudProofError::Timeout { operation, timeout_ms } => {
                write!(f, "Timeout after {}ms during {}", timeout_ms, operation)
            }
            FraudProofError::InvalidState { expected, actual } => {
                write!(f, "Invalid state: expected {}, got {}", expected, actual)
            }
            FraudProofError::InvalidStateTransition { from, to, reason } => {
                write!(f, "Invalid state transition from {} to {}: {}", from, to, reason)
            }
            FraudProofError::Other(msg) => {
                write!(f, "{}", msg)
            }
        }
    }
}

impl fmt::Display for NetworkError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            NetworkError::ConnectionFailed { endpoint, reason } => {
                write!(f, "Connection failed to {}: {}", endpoint, reason)
            }
            NetworkError::Timeout { operation, timeout_ms } => {
                write!(f, "Network timeout after {}ms during {}", timeout_ms, operation)
            }
            NetworkError::RateLimited { endpoint, limit, reset_after_ms } => {
                write!(f, "Rate limited at {} (limit: {}, reset after: {}ms)", endpoint, limit, reset_after_ms)
            }
            NetworkError::ResponseError { endpoint, status_code, message } => {
                write!(f, "Response error from {}: {} - {}", endpoint, status_code, message)
            }
            NetworkError::SerializationError { context, reason } => {
                write!(f, "Serialization error in {}: {}", context, reason)
            }
            NetworkError::Other(msg) => {
                write!(f, "{}", msg)
            }
        }
    }
}

impl fmt::Display for TransactionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TransactionError::SignatureError { reason } => {
                write!(f, "Signature error: {}", reason)
            }
            TransactionError::InsufficientGas { required, provided } => {
                write!(f, "Insufficient gas: required {}, provided {}", required, provided)
            }
            TransactionError::InvalidNonce { expected, actual } => {
                write!(f, "Invalid nonce: expected {}, got {}", expected, actual)
            }
            TransactionError::InsufficientBalance { address, required, available } => {
                write!(f, "Insufficient balance for {}: required {}, available {}", address, required, available)
            }
            TransactionError::ExecutionError { tx_hash, reason } => {
                write!(f, "Execution error for transaction {}: {}", tx_hash, reason)
            }
            TransactionError::Timeout { tx_hash, timeout_ms } => {
                write!(f, "Transaction {} timed out after {}ms", tx_hash, timeout_ms)
            }
            TransactionError::Rejected { tx_hash, reason } => {
                write!(f, "Transaction {} rejected: {}", tx_hash, reason)
            }
            TransactionError::Other(msg) => {
                write!(f, "{}", msg)
            }
        }
    }
}

impl fmt::Display for StateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StateError::AccessError { key, reason } => {
                write!(f, "State access error for key {}: {}", key, reason)
            }
            StateError::NotFound { key } => {
                write!(f, "State key not found: {}", key)
            }
            StateError::Corruption { context, reason } => {
                write!(f, "State corruption in {}: {}", context, reason)
            }
            StateError::SyncError { context, reason } => {
                write!(f, "State sync error in {}: {}", context, reason)
            }
            StateError::MerkleProofError { key, reason } => {
                write!(f, "Merkle proof error for key {}: {}", key, reason)
            }
            StateError::Other(msg) => {
                write!(f, "{}", msg)
            }
        }
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigError::ParseError { key, value, reason } => {
                write!(f, "Config parse error for {} = {}: {}", key, value, reason)
            }
            ConfigError::ValidationError { key, value, reason } => {
                write!(f, "Config validation error for {} = {}: {}", key, value, reason)
            }
            ConfigError::MissingKey { key } => {
                write!(f, "Missing config key: {}", key)
            }
            ConfigError::InvalidType { key, expected, actual } => {
                write!(f, "Invalid type for config key {}: expected {}, got {}", key, expected, actual)
            }
            ConfigError::LoadError { path, reason } => {
                write!(f, "Failed to load config from {}: {}", path, reason)
            }
            ConfigError::Other(msg) => {
                write!(f, "{}", msg)
            }
        }
    }
}

impl fmt::Display for SecurityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SecurityError::AuthenticationFailed { user, reason } => {
                write!(f, "Authentication failed for user {}: {}", user, reason)
            }
            SecurityError::AuthorizationFailed { user, resource, action } => {
                write!(f, "Authorization failed for user {} to {} on {}", user, action, resource)
            }
            SecurityError::TokenValidationFailed { token_type, reason } => {
                write!(f, "{} token validation failed: {}", token_type, reason)
            }
            SecurityError::RateLimited { user, limit, reset_after_ms } => {
                write!(f, "Rate limit exceeded for user {} (limit: {}, reset after: {}ms)", user, limit, reset_after_ms)
            }
            SecurityError::InvalidInput { field, reason } => {
                write!(f, "Invalid input for {}: {}", field, reason)
            }
            SecurityError::Other(msg) => {
                write!(f, "{}", msg)
            }
        }
    }
}

impl Error for Layer2Error {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Layer2Error::External { source, .. } => Some(source.as_ref()),
            _ => None,
        }
    }
}

/// Tipo Result specifico per Layer-2
pub type Layer2Result<T> = Result<T, Layer2Error>;

/// Gestore degli errori per Layer-2
pub struct ErrorHandler {
    /// Logger per gli errori
    logger: Arc<dyn Logger + Send + Sync>,
    
    /// Callback per gli errori critici
    critical_error_callback: Option<Box<dyn Fn(&Layer2Error) + Send + Sync>>,
}

/// Trait per il logging
pub trait Logger: Send + Sync {
    /// Log di debug
    fn debug(&self, message: &str);
    
    /// Log di info
    fn info(&self, message: &str);
    
    /// Log di warning
    fn warn(&self, message: &str);
    
    /// Log di errore
    fn error(&self, message: &str);
    
    /// Log di errore critico
    fn critical(&self, message: &str);
}

impl ErrorHandler {
    /// Crea un nuovo gestore degli errori
    pub fn new(logger: Arc<dyn Logger + Send + Sync>) -> Self {
        ErrorHandler {
            logger,
            critical_error_callback: None,
        }
    }
    
    /// Imposta il callback per gli errori critici
    pub fn set_critical_error_callback<F>(&mut self, callback: F)
    where
        F: Fn(&Layer2Error) + Send + Sync + 'static,
    {
        self.critical_error_callback = Some(Box::new(callback));
    }
    
    /// Gestisce un errore
    pub fn handle_error(&self, error: &Layer2Error) {
        // Log dell'errore
        match error {
            Layer2Error::Bridge(BridgeError::Timeout { .. }) |
            Layer2Error::Finalization(FinalizationError::Timeout { .. }) |
            Layer2Error::FraudProof(FraudProofError::Timeout { .. }) |
            Layer2Error::Network(NetworkError::Timeout { .. }) |
            Layer2Error::Transaction(TransactionError::Timeout { .. }) => {
                self.logger.warn(&format!("Timeout error: {}", error));
            },
            Layer2Error::Bridge(BridgeError::InsufficientLiquidity { .. }) |
            Layer2Error::Finalization(FinalizationError::InsufficientStake { .. }) |
            Layer2Error::Transaction(TransactionError::InsufficientGas { .. }) |
            Layer2Error::Transaction(TransactionError::InsufficientBalance { .. }) => {
                self.logger.warn(&format!("Resource error: {}", error));
            },
            Layer2Error::State(StateError::NotFound { .. }) |
            Layer2Error::Config(ConfigError::MissingKey { .. }) => {
                self.logger.warn(&format!("Not found error: {}", error));
            },
            Layer2Error::Network(NetworkError::ConnectionFailed { .. }) |
            Layer2Error::Network(NetworkError::ResponseError { .. }) => {
                self.logger.error(&format!("Network error: {}", error));
            },
            Layer2Error::Security(_) => {
                self.logger.error(&format!("Security error: {}", error));
            },
            Layer2Error::State(StateError::Corruption { .. }) => {
                self.logger.critical(&format!("Critical state error: {}", error));
                if let Some(callback) = &self.critical_error_callback {
                    callback(error);
                }
            },
            _ => {
                self.logger.error(&format!("Error: {}", error));
            }
        }
    }
    
    /// Gestisce un risultato
    pub fn handle_result<T>(&self, result: &Layer2Result<T>) -> bool {
        match result {
            Ok(_) => true,
            Err(error) => {
                self.handle_error(error);
                false
            }
        }
    }
}

/// Estensione per Result per aggiungere contesto agli errori
pub trait ResultExt<T, E> {
    /// Aggiunge contesto a un errore
    fn with_context<C, F>(self, context: F) -> Result<T, Layer2Error>
    where
        F: FnOnce() -> C,
        C: Into<String>;
}

impl<T, E: Error + Send + Sync + 'static> ResultExt<T, E> for Result<T, E> {
    fn with_context<C, F>(self, context: F) -> Result<T, Layer2Error>
    where
        F: FnOnce() -> C,
        C: Into<String>,
    {
        self.map_err(|error| {
            Layer2Error::External {
                source: Box::new(error),
                context: context().into(),
            }
        })
    }
}

/// Implementazione di default del Logger
pub struct DefaultLogger;

impl Logger for DefaultLogger {
    fn debug(&self, message: &str) {
        println!("DEBUG: {}", message);
    }
    
    fn info(&self, message: &str) {
        println!("INFO: {}", message);
    }
    
    fn warn(&self, message: &str) {
        println!("WARN: {}", message);
    }
    
    fn error(&self, message: &str) {
        println!("ERROR: {}", message);
    }
    
    fn critical(&self, message: &str) {
        println!("CRITICAL: {}", message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    
    #[derive(Default)]
    struct TestLogger {
        logs: Mutex<Vec<(String, String)>>,
    }
    
    impl Logger for TestLogger {
        fn debug(&self, message: &str) {
            self.logs.lock().unwrap().push(("DEBUG".to_string(), message.to_string()));
        }
        
        fn info(&self, message: &str) {
            self.logs.lock().unwrap().push(("INFO".to_string(), message.to_string()));
        }
        
        fn warn(&self, message: &str) {
            self.logs.lock().unwrap().push(("WARN".to_string(), message.to_string()));
        }
        
        fn error(&self, message: &str) {
            self.logs.lock().unwrap().push(("ERROR".to_string(), message.to_string()));
        }
        
        fn critical(&self, message: &str) {
            self.logs.lock().unwrap().push(("CRITICAL".to_string(), message.to_string()));
        }
    }
    
    #[test]
    fn test_error_handler() {
        let logger = Arc::new(TestLogger::default());
        let error_handler = ErrorHandler::new(Arc::clone(&logger));
        
        // Test timeout error
        let timeout_error = Layer2Error::Network(NetworkError::Timeout {
            operation: "fetch_block".to_string(),
            timeout_ms: 5000,
        });
        error_handler.handle_error(&timeout_error);
        
        // Test critical error
        let critical_error = Layer2Error::State(StateError::Corruption {
            context: "block_state".to_string(),
            reason: "hash mismatch".to_string(),
        });
        error_handler.handle_error(&critical_error);
        
        // Verify logs
        let logs = logger.logs.lock().unwrap();
        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0].0, "WARN");
        assert!(logs[0].1.contains("Timeout error"));
        assert_eq!(logs[1].0, "CRITICAL");
        assert!(logs[1].1.contains("Critical state error"));
    }
    
    #[test]
    fn test_result_ext() {
        // Create a function that returns a std::io::Error
        fn io_error() -> std::io::Result<()> {
            Err(std::io::Error::new(std::io::ErrorKind::NotFound, "file not found"))
        }
        
        // Use with_context to convert to Layer2Error
        let result = io_error().with_context(|| "Failed to open config file");
        
        // Verify the error
        match result {
            Ok(_) => panic!("Expected error"),
            Err(Layer2Error::External { context, .. }) => {
                assert_eq!(context, "Failed to open config file");
            }
            Err(_) => panic!("Expected External error"),
        }
    }
    
    #[test]
    fn test_error_display() {
        let error = Layer2Error::Bridge(BridgeError::DepositFailed {
            token: "ETH".to_string(),
            amount: 1000000000,
            reason: "insufficient funds".to_string(),
        });
        
        let error_string = format!("{}", error);
        assert!(error_string.contains("Bridge error"));
        assert!(error_string.contains("Deposit failed"));
        assert!(error_string.contains("ETH"));
        assert!(error_string.contains("insufficient funds"));
    }
}
