// src/error_handling/error_types.rs
//! Error types for Layer-2 on Solana
//! 
//! This module defines standard error types that all Layer-2 components
//! should use to ensure consistent error handling and reporting.

use solana_program::program_error::ProgramError;
use thiserror::Error;
use std::fmt::{Debug, Display, Formatter, Result as FmtResult};
use std::error::Error as StdError;
use crate::interfaces::ComponentError;

/// Base error type for Layer-2 components
#[derive(Error, Debug)]
pub enum Layer2Error {
    /// Solana program error
    #[error("Program error: {0}")]
    ProgramError(#[from] ProgramError),
    
    /// Invalid argument
    #[error("Invalid argument: {0}")]
    InvalidArgument(String),
    
    /// Invalid state
    #[error("Invalid state: {0}")]
    InvalidState(String),
    
    /// Unauthorized operation
    #[error("Unauthorized operation: {0}")]
    Unauthorized(String),
    
    /// Resource not found
    #[error("Resource not found: {0}")]
    NotFound(String),
    
    /// Resource already exists
    #[error("Resource already exists: {0}")]
    AlreadyExists(String),
    
    /// Operation timeout
    #[error("Operation timeout: {0}")]
    Timeout(String),
    
    /// External service error
    #[error("External service error: {0}")]
    ExternalService(String),
    
    /// Serialization error
    #[error("Serialization error: {0}")]
    Serialization(String),
    
    /// Deserialization error
    #[error("Deserialization error: {0}")]
    Deserialization(String),
    
    /// Arithmetic error
    #[error("Arithmetic error: {0}")]
    Arithmetic(String),
    
    /// Insufficient funds
    #[error("Insufficient funds: {0}")]
    InsufficientFunds(String),
    
    /// Limit exceeded
    #[error("Limit exceeded: {0}")]
    LimitExceeded(String),
    
    /// Invalid proof
    #[error("Invalid proof: {0}")]
    InvalidProof(String),
    
    /// Invalid signature
    #[error("Invalid signature: {0}")]
    InvalidSignature(String),
    
    /// Invalid transaction
    #[error("Invalid transaction: {0}")]
    InvalidTransaction(String),
    
    /// Invalid block
    #[error("Invalid block: {0}")]
    InvalidBlock(String),
    
    /// Invalid state transition
    #[error("Invalid state transition: {0}")]
    InvalidStateTransition(String),
    
    /// Invalid deposit
    #[error("Invalid deposit: {0}")]
    InvalidDeposit(String),
    
    /// Invalid withdrawal
    #[error("Invalid withdrawal: {0}")]
    InvalidWithdrawal(String),
    
    /// Internal error
    #[error("Internal error: {0}")]
    Internal(String),
    
    /// Not implemented
    #[error("Not implemented: {0}")]
    NotImplemented(String),
}

impl Layer2Error {
    /// Convert to error code
    pub fn to_error_code(&self) -> u32 {
        match self {
            Layer2Error::ProgramError(e) => e.clone() as u32,
            Layer2Error::InvalidArgument(_) => 1000,
            Layer2Error::InvalidState(_) => 1001,
            Layer2Error::Unauthorized(_) => 1002,
            Layer2Error::NotFound(_) => 1003,
            Layer2Error::AlreadyExists(_) => 1004,
            Layer2Error::Timeout(_) => 1005,
            Layer2Error::ExternalService(_) => 1006,
            Layer2Error::Serialization(_) => 1007,
            Layer2Error::Deserialization(_) => 1008,
            Layer2Error::Arithmetic(_) => 1009,
            Layer2Error::InsufficientFunds(_) => 1010,
            Layer2Error::LimitExceeded(_) => 1011,
            Layer2Error::InvalidProof(_) => 1012,
            Layer2Error::InvalidSignature(_) => 1013,
            Layer2Error::InvalidTransaction(_) => 1014,
            Layer2Error::InvalidBlock(_) => 1015,
            Layer2Error::InvalidStateTransition(_) => 1016,
            Layer2Error::InvalidDeposit(_) => 1017,
            Layer2Error::InvalidWithdrawal(_) => 1018,
            Layer2Error::Internal(_) => 1019,
            Layer2Error::NotImplemented(_) => 1020,
        }
    }
}

impl ComponentError for Layer2Error {
    fn to_program_error(&self) -> ProgramError {
        match self {
            Layer2Error::ProgramError(e) => e.clone(),
            _ => ProgramError::Custom(self.to_error_code() as u32),
        }
    }
    
    fn error_code(&self) -> u32 {
        self.to_error_code()
    }
    
    fn error_message(&self) -> String {
        self.to_string()
    }
    
    fn error_source(&self) -> Option<&(dyn StdError + 'static)> {
        self.source()
    }
}

/// Fraud Proof System specific errors
#[derive(Error, Debug)]
pub enum FraudProofError {
    /// Base Layer-2 error
    #[error("{0}")]
    Layer2Error(#[from] Layer2Error),
    
    /// Invalid fraud proof
    #[error("Invalid fraud proof: {0}")]
    InvalidFraudProof(String),
    
    /// Invalid bisection game
    #[error("Invalid bisection game: {0}")]
    InvalidBisectionGame(String),
    
    /// Invalid Merkle tree
    #[error("Invalid Merkle tree: {0}")]
    InvalidMerkleTree(String),
    
    /// Invalid state transition
    #[error("Invalid state transition: {0}")]
    InvalidStateTransition(String),
    
    /// Invalid Solana runtime operation
    #[error("Invalid Solana runtime operation: {0}")]
    InvalidRuntimeOperation(String),
}

impl ComponentError for FraudProofError {
    fn to_program_error(&self) -> ProgramError {
        match self {
            FraudProofError::Layer2Error(e) => e.to_program_error(),
            _ => ProgramError::Custom(self.error_code()),
        }
    }
    
    fn error_code(&self) -> u32 {
        match self {
            FraudProofError::Layer2Error(e) => e.error_code(),
            FraudProofError::InvalidFraudProof(_) => 2000,
            FraudProofError::InvalidBisectionGame(_) => 2001,
            FraudProofError::InvalidMerkleTree(_) => 2002,
            FraudProofError::InvalidStateTransition(_) => 2003,
            FraudProofError::InvalidRuntimeOperation(_) => 2004,
        }
    }
    
    fn error_message(&self) -> String {
        self.to_string()
    }
    
    fn error_source(&self) -> Option<&(dyn StdError + 'static)> {
        self.source()
    }
}

/// Finalization specific errors
#[derive(Error, Debug)]
pub enum FinalizationError {
    /// Base Layer-2 error
    #[error("{0}")]
    Layer2Error(#[from] Layer2Error),
    
    /// Invalid block finalization
    #[error("Invalid block finalization: {0}")]
    InvalidBlockFinalization(String),
    
    /// Invalid state commitment
    #[error("Invalid state commitment: {0}")]
    InvalidStateCommitment(String),
    
    /// Invalid L2 output
    #[error("Invalid L2 output: {0}")]
    InvalidL2Output(String),
    
    /// Challenge period not elapsed
    #[error("Challenge period not elapsed: {0}")]
    ChallengePeriodNotElapsed(String),
    
    /// Invalid challenge
    #[error("Invalid challenge: {0}")]
    InvalidChallenge(String),
}

impl ComponentError for FinalizationError {
    fn to_program_error(&self) -> ProgramError {
        match self {
            FinalizationError::Layer2Error(e) => e.to_program_error(),
            _ => ProgramError::Custom(self.error_code()),
        }
    }
    
    fn error_code(&self) -> u32 {
        match self {
            FinalizationError::Layer2Error(e) => e.error_code(),
            FinalizationError::InvalidBlockFinalization(_) => 3000,
            FinalizationError::InvalidStateCommitment(_) => 3001,
            FinalizationError::InvalidL2Output(_) => 3002,
            FinalizationError::ChallengePeriodNotElapsed(_) => 3003,
            FinalizationError::InvalidChallenge(_) => 3004,
        }
    }
    
    fn error_message(&self) -> String {
        self.to_string()
    }
    
    fn error_source(&self) -> Option<&(dyn StdError + 'static)> {
        self.source()
    }
}

/// Bridge specific errors
#[derive(Error, Debug)]
pub enum BridgeError {
    /// Base Layer-2 error
    #[error("{0}")]
    Layer2Error(#[from] Layer2Error),
    
    /// Invalid deposit
    #[error("Invalid deposit: {0}")]
    InvalidDeposit(String),
    
    /// Invalid withdrawal
    #[error("Invalid withdrawal: {0}")]
    InvalidWithdrawal(String),
    
    /// Invalid token mapping
    #[error("Invalid token mapping: {0}")]
    InvalidTokenMapping(String),
    
    /// Invalid message
    #[error("Invalid message: {0}")]
    InvalidMessage(String),
    
    /// Unsupported token
    #[error("Unsupported token: {0}")]
    UnsupportedToken(String),
    
    /// Amount out of range
    #[error("Amount out of range: {0}")]
    AmountOutOfRange(String),
}

impl ComponentError for BridgeError {
    fn to_program_error(&self) -> ProgramError {
        match self {
            BridgeError::Layer2Error(e) => e.to_program_error(),
            _ => ProgramError::Custom(self.error_code()),
        }
    }
    
    fn error_code(&self) -> u32 {
        match self {
            BridgeError::Layer2Error(e) => e.error_code(),
            BridgeError::InvalidDeposit(_) => 4000,
            BridgeError::InvalidWithdrawal(_) => 4001,
            BridgeError::InvalidTokenMapping(_) => 4002,
            BridgeError::InvalidMessage(_) => 4003,
            BridgeError::UnsupportedToken(_) => 4004,
            BridgeError::AmountOutOfRange(_) => 4005,
        }
    }
    
    fn error_message(&self) -> String {
        self.to_string()
    }
    
    fn error_source(&self) -> Option<&(dyn StdError + 'static)> {
        self.source()
    }
}
