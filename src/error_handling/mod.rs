// src/error_handling/mod.rs
//! Error handling and recovery mechanisms for Layer-2 on Solana
//! 
//! This module provides error types and utilities for handling errors
//! and implementing recovery mechanisms to ensure robust operation of
//! the Layer-2 system.

pub mod error_types;
pub mod error_handler;

// Re-export common types and functions
pub use error_types::{
    Layer2Error, FraudProofError, FinalizationError, BridgeError
};

pub use error_handler::{
    ErrorHandler, ErrorSeverity, ErrorContext, Recoverable,
    execute_with_recovery, retry_with_backoff, register_default_recovery_strategies
};
