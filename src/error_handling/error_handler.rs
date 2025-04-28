// src/error_handling/error_handler.rs
//! Error handling and recovery mechanisms for Layer-2 on Solana
//! 
//! This module provides utilities for handling errors and implementing
//! recovery mechanisms to ensure robust operation of the Layer-2 system.

use crate::error_handling::error_types::{
    Layer2Error, FraudProofError, FinalizationError, BridgeError
};
use crate::interfaces::ComponentError;
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use std::fmt::Debug;
use std::panic;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;

/// Error severity levels
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorSeverity {
    /// Informational message, not an error
    Info,
    
    /// Warning, operation can continue
    Warning,
    
    /// Error, operation failed but system can continue
    Error,
    
    /// Critical error, system may need to halt
    Critical,
    
    /// Fatal error, system must halt
    Fatal,
}

/// Error context information
#[derive(Debug, Clone)]
pub struct ErrorContext {
    /// Component name
    pub component: String,
    
    /// Operation being performed
    pub operation: String,
    
    /// Error severity
    pub severity: ErrorSeverity,
    
    /// Timestamp of the error
    pub timestamp: u64,
    
    /// Additional metadata
    pub metadata: HashMap<String, String>,
}

impl ErrorContext {
    /// Create a new error context
    pub fn new(component: &str, operation: &str, severity: ErrorSeverity) -> Self {
        Self {
            component: component.to_string(),
            operation: operation.to_string(),
            severity,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            metadata: HashMap::new(),
        }
    }
    
    /// Add metadata to the error context
    pub fn with_metadata(mut self, key: &str, value: &str) -> Self {
        self.metadata.insert(key.to_string(), value.to_string());
        self
    }
}

/// Error handler for Layer-2 components
pub struct ErrorHandler {
    /// Maximum number of errors to store
    max_errors: usize,
    
    /// Recent errors
    recent_errors: Arc<Mutex<Vec<(Box<dyn ComponentError>, ErrorContext)>>>,
    
    /// Error counts by type
    error_counts: Arc<Mutex<HashMap<String, usize>>>,
    
    /// Recovery strategies
    recovery_strategies: Arc<Mutex<HashMap<String, Box<dyn Fn(&dyn ComponentError, &ErrorContext) -> ProgramResult + Send + Sync>>>>,
}

impl ErrorHandler {
    /// Create a new error handler
    pub fn new(max_errors: usize) -> Self {
        // Set up panic hook to log panics
        panic::set_hook(Box::new(|panic_info| {
            let location = panic_info.location().unwrap_or_else(|| panic::Location::caller());
            let message = match panic_info.payload().downcast_ref::<&'static str>() {
                Some(s) => *s,
                None => match panic_info.payload().downcast_ref::<String>() {
                    Some(s) => s.as_str(),
                    None => "Unknown panic payload",
                },
            };
            
            msg!("PANIC: {} at {}:{}:{}", 
                message, 
                location.file(), 
                location.line(), 
                location.column()
            );
        }));
        
        Self {
            max_errors,
            recent_errors: Arc::new(Mutex::new(Vec::new())),
            error_counts: Arc::new(Mutex::new(HashMap::new())),
            recovery_strategies: Arc::new(Mutex::new(HashMap::new())),
        }
    }
    
    /// Handle an error
    pub fn handle_error<E: ComponentError + 'static>(
        &self,
        error: E,
        context: ErrorContext,
    ) -> ProgramResult {
        // Log the error
        msg!("ERROR [{}] {}: {} ({})", 
            context.severity as u8,
            context.component,
            error.error_message(),
            error.error_code()
        );
        
        // Update error counts
        let error_type = std::any::type_name::<E>().to_string();
        let mut error_counts = self.error_counts.lock().unwrap();
        *error_counts.entry(error_type.clone()).or_insert(0) += 1;
        
        // Store the error if it's significant
        if context.severity >= ErrorSeverity::Error {
            let mut recent_errors = self.recent_errors.lock().unwrap();
            if recent_errors.len() >= self.max_errors {
                recent_errors.remove(0);
            }
            recent_errors.push((Box::new(error.clone()), context.clone()));
        }
        
        // Check if we have a recovery strategy for this error type
        let recovery_strategies = self.recovery_strategies.lock().unwrap();
        if let Some(strategy) = recovery_strategies.get(&error_type) {
            return strategy(&error, &context);
        }
        
        // Default handling based on severity
        match context.severity {
            ErrorSeverity::Info | ErrorSeverity::Warning => {
                // Log but continue
                Ok(())
            },
            ErrorSeverity::Error | ErrorSeverity::Critical | ErrorSeverity::Fatal => {
                // Convert to program error and return
                Err(error.to_program_error())
            },
        }
    }
    
    /// Register a recovery strategy for an error type
    pub fn register_recovery_strategy<E: ComponentError + 'static>(
        &self,
        strategy: Box<dyn Fn(&E, &ErrorContext) -> ProgramResult + Send + Sync>,
    ) {
        let error_type = std::any::type_name::<E>().to_string();
        let mut recovery_strategies = self.recovery_strategies.lock().unwrap();
        
        // Wrap the typed strategy in a dynamic one
        let dynamic_strategy = Box::new(move |error: &dyn ComponentError, context: &ErrorContext| -> ProgramResult {
            if let Some(typed_error) = error.downcast_ref::<E>() {
                strategy(typed_error, context)
            } else {
                Err(ProgramError::Custom(9999)) // Should never happen
            }
        });
        
        recovery_strategies.insert(error_type, dynamic_strategy);
    }
    
    /// Get recent errors
    pub fn get_recent_errors(&self) -> Vec<(Box<dyn ComponentError>, ErrorContext)> {
        let recent_errors = self.recent_errors.lock().unwrap();
        recent_errors.clone()
    }
    
    /// Get error counts
    pub fn get_error_counts(&self) -> HashMap<String, usize> {
        let error_counts = self.error_counts.lock().unwrap();
        error_counts.clone()
    }
    
    /// Clear error history
    pub fn clear_errors(&self) {
        let mut recent_errors = self.recent_errors.lock().unwrap();
        recent_errors.clear();
        
        let mut error_counts = self.error_counts.lock().unwrap();
        error_counts.clear();
    }
}

/// Trait for components that can recover from errors
pub trait Recoverable {
    /// Attempt to recover from an error
    fn recover(&mut self, error: &dyn ComponentError, context: &ErrorContext) -> ProgramResult;
    
    /// Check if the component can recover from a specific error
    fn can_recover(&self, error: &dyn ComponentError) -> bool;
    
    /// Get the maximum number of recovery attempts
    fn max_recovery_attempts(&self) -> usize;
}

/// Helper function to safely execute operations with error handling
pub fn execute_with_recovery<F, R, E>(
    operation: F,
    component: &str,
    operation_name: &str,
    severity: ErrorSeverity,
    error_handler: &ErrorHandler,
) -> Result<R, E>
where
    F: FnOnce() -> Result<R, E>,
    E: ComponentError + 'static,
{
    match operation() {
        Ok(result) => Ok(result),
        Err(error) => {
            let context = ErrorContext::new(component, operation_name, severity);
            let _ = error_handler.handle_error(error.clone(), context);
            Err(error)
        }
    }
}

/// Helper function to retry operations with exponential backoff
pub async fn retry_with_backoff<F, Fut, R, E>(
    operation: F,
    component: &str,
    operation_name: &str,
    max_attempts: usize,
    initial_delay_ms: u64,
    error_handler: &ErrorHandler,
) -> Result<R, E>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<R, E>>,
    E: ComponentError + 'static,
{
    let mut attempt = 0;
    let mut delay_ms = initial_delay_ms;
    
    loop {
        attempt += 1;
        
        match operation().await {
            Ok(result) => return Ok(result),
            Err(error) => {
                let context = ErrorContext::new(
                    component,
                    &format!("{} (attempt {}/{})", operation_name, attempt, max_attempts),
                    if attempt < max_attempts { ErrorSeverity::Warning } else { ErrorSeverity::Error }
                ).with_metadata("attempt", &attempt.to_string())
                 .with_metadata("max_attempts", &max_attempts.to_string());
                
                let _ = error_handler.handle_error(error.clone(), context);
                
                if attempt >= max_attempts {
                    return Err(error);
                }
                
                // Exponential backoff with jitter
                let jitter = (std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() % 100) as u64;
                
                let sleep_ms = delay_ms + jitter;
                std::thread::sleep(std::time::Duration::from_millis(sleep_ms));
                
                // Double the delay for next attempt
                delay_ms *= 2;
            }
        }
    }
}

/// Default recovery strategies for common errors
pub fn register_default_recovery_strategies(error_handler: &ErrorHandler) {
    // Strategy for timeout errors
    error_handler.register_recovery_strategy(Box::new(|error: &Layer2Error, context: &ErrorContext| -> ProgramResult {
        match error {
            Layer2Error::Timeout(_) => {
                // For timeout errors, we can just retry later
                msg!("Timeout detected in {} during {}. Will retry later.", 
                    context.component, context.operation);
                Ok(())
            },
            _ => Err(error.to_program_error()),
        }
    }));
    
    // Strategy for serialization errors
    error_handler.register_recovery_strategy(Box::new(|error: &Layer2Error, context: &ErrorContext| -> ProgramResult {
        match error {
            Layer2Error::Serialization(_) | Layer2Error::Deserialization(_) => {
                // For serialization errors, we log and return an error
                msg!("Serialization error detected in {} during {}. Cannot recover.", 
                    context.component, context.operation);
                Err(error.to_program_error())
            },
            _ => Err(error.to_program_error()),
        }
    }));
    
    // Strategy for fraud proof errors
    error_handler.register_recovery_strategy(Box::new(|error: &FraudProofError, context: &ErrorContext| -> ProgramResult {
        match error {
            FraudProofError::InvalidBisectionGame(_) => {
                // For invalid bisection game, we can abort the game and start a new one
                msg!("Invalid bisection game detected in {} during {}. Aborting game.", 
                    context.component, context.operation);
                Ok(())
            },
            _ => Err(error.to_program_error()),
        }
    }));
    
    // Strategy for finalization errors
    error_handler.register_recovery_strategy(Box::new(|error: &FinalizationError, context: &ErrorContext| -> ProgramResult {
        match error {
            FinalizationError::ChallengePeriodNotElapsed(_) => {
                // For challenge period not elapsed, we can just wait
                msg!("Challenge period not elapsed in {} during {}. Will retry later.", 
                    context.component, context.operation);
                Ok(())
            },
            _ => Err(error.to_program_error()),
        }
    }));
    
    // Strategy for bridge errors
    error_handler.register_recovery_strategy(Box::new(|error: &BridgeError, context: &ErrorContext| -> ProgramResult {
        match error {
            BridgeError::UnsupportedToken(_) => {
                // For unsupported token, we can't recover
                msg!("Unsupported token detected in {} during {}. Cannot recover.", 
                    context.component, context.operation);
                Err(error.to_program_error())
            },
            _ => Err(error.to_program_error()),
        }
    }));
}
