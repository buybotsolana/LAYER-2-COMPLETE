// src/interfaces/component_interface.rs
//! Standard interfaces for Layer-2 components
//! 
//! This module defines standard interfaces that all Layer-2 components
//! should implement to ensure consistency and interoperability.

use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::error::Error;
use std::fmt::{Debug, Display};

/// Standard error interface for all Layer-2 components
pub trait ComponentError: Error + Debug + Display {
    /// Convert the error to a program error
    fn to_program_error(&self) -> solana_program::program_error::ProgramError;
    
    /// Get the error code
    fn error_code(&self) -> u32;
    
    /// Get the error message
    fn error_message(&self) -> String;
    
    /// Get the error source
    fn error_source(&self) -> Option<&(dyn Error + 'static)>;
}

/// Standard initialization interface for all Layer-2 components
pub trait Initializable {
    /// Error type for initialization operations
    type Error: ComponentError;
    
    /// Initialize the component
    fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> Result<(), Self::Error>;
    
    /// Check if the component is initialized
    fn is_initialized(&self) -> bool;
}

/// Standard serialization interface for all Layer-2 components
pub trait Serializable: BorshSerialize + BorshDeserialize {
    /// Error type for serialization operations
    type Error: ComponentError;
    
    /// Serialize the component to bytes
    fn serialize_to_bytes(&self) -> Result<Vec<u8>, Self::Error>;
    
    /// Deserialize bytes to a component
    fn deserialize_from_bytes(data: &[u8]) -> Result<Self, Self::Error> where Self: Sized;
    
    /// Get the serialized size of the component
    fn serialized_size(&self) -> Result<usize, Self::Error>;
}

/// Standard state management interface for all Layer-2 components
pub trait StateManagement {
    /// Error type for state management operations
    type Error: ComponentError;
    
    /// State type for the component
    type State: Serializable;
    
    /// Get the current state
    fn get_state(&self) -> Result<&Self::State, Self::Error>;
    
    /// Update the state
    fn update_state(&mut self, state: Self::State) -> Result<(), Self::Error>;
    
    /// Reset the state to default
    fn reset_state(&mut self) -> Result<(), Self::Error>;
}

/// Standard account management interface for all Layer-2 components
pub trait AccountManagement {
    /// Error type for account management operations
    type Error: ComponentError;
    
    /// Validate accounts for an operation
    fn validate_accounts(&self, program_id: &Pubkey, accounts: &[AccountInfo]) -> Result<(), Self::Error>;
    
    /// Get the required accounts for an operation
    fn get_required_accounts(&self) -> Vec<&'static str>;
    
    /// Check if an account is owned by the program
    fn is_account_owned_by_program(&self, account: &AccountInfo, program_id: &Pubkey) -> bool;
}

/// Standard instruction processing interface for all Layer-2 components
pub trait InstructionProcessor {
    /// Error type for instruction processing operations
    type Error: ComponentError;
    
    /// Instruction type for the component
    type Instruction: BorshDeserialize;
    
    /// Process an instruction
    fn process_instruction(
        &mut self,
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        instruction_data: &[u8],
    ) -> Result<ProgramResult, Self::Error>;
    
    /// Validate an instruction
    fn validate_instruction(&self, instruction: &Self::Instruction) -> Result<(), Self::Error>;
}

/// Standard event emission interface for all Layer-2 components
pub trait EventEmitter {
    /// Error type for event emission operations
    type Error: ComponentError;
    
    /// Event type for the component
    type Event: BorshSerialize + Debug;
    
    /// Emit an event
    fn emit_event(&self, event: Self::Event) -> Result<(), Self::Error>;
    
    /// Get the last emitted event
    fn get_last_event(&self) -> Option<&Self::Event>;
}

/// Standard metrics collection interface for all Layer-2 components
pub trait MetricsCollector {
    /// Error type for metrics collection operations
    type Error: ComponentError;
    
    /// Metric type for the component
    type Metric: BorshSerialize + Debug;
    
    /// Record a metric
    fn record_metric(&mut self, metric: Self::Metric) -> Result<(), Self::Error>;
    
    /// Get all metrics
    fn get_metrics(&self) -> Result<Vec<&Self::Metric>, Self::Error>;
    
    /// Reset metrics
    fn reset_metrics(&mut self) -> Result<(), Self::Error>;
}

/// Standard configuration management interface for all Layer-2 components
pub trait ConfigurationManagement {
    /// Error type for configuration management operations
    type Error: ComponentError;
    
    /// Configuration type for the component
    type Configuration: Serializable;
    
    /// Get the current configuration
    fn get_configuration(&self) -> Result<&Self::Configuration, Self::Error>;
    
    /// Update the configuration
    fn update_configuration(&mut self, configuration: Self::Configuration) -> Result<(), Self::Error>;
    
    /// Reset the configuration to default
    fn reset_configuration(&mut self) -> Result<(), Self::Error>;
}

/// Standard security interface for all Layer-2 components
pub trait SecurityManagement {
    /// Error type for security management operations
    type Error: ComponentError;
    
    /// Check if an account is authorized for an operation
    fn is_authorized(&self, account: &AccountInfo, operation: &str) -> Result<bool, Self::Error>;
    
    /// Get the owner of the component
    fn get_owner(&self) -> Result<Pubkey, Self::Error>;
    
    /// Set the owner of the component
    fn set_owner(&mut self, owner: Pubkey) -> Result<(), Self::Error>;
    
    /// Add an authorized account
    fn add_authorized_account(&mut self, account: Pubkey, operations: Vec<String>) -> Result<(), Self::Error>;
    
    /// Remove an authorized account
    fn remove_authorized_account(&mut self, account: Pubkey) -> Result<(), Self::Error>;
}

/// Standard upgrade interface for all Layer-2 components
pub trait Upgradeable {
    /// Error type for upgrade operations
    type Error: ComponentError;
    
    /// Upgrade the component
    fn upgrade(&mut self, program_id: &Pubkey, accounts: &[AccountInfo], new_code: &[u8]) -> Result<(), Self::Error>;
    
    /// Get the current version
    fn get_version(&self) -> Result<String, Self::Error>;
    
    /// Check if an upgrade is available
    fn is_upgrade_available(&self) -> Result<bool, Self::Error>;
}

/// Standard testing interface for all Layer-2 components
pub trait Testable {
    /// Error type for testing operations
    type Error: ComponentError;
    
    /// Run tests for the component
    fn run_tests(&self) -> Result<Vec<TestResult>, Self::Error>;
    
    /// Check if the component is in test mode
    fn is_test_mode(&self) -> bool;
    
    /// Set the test mode
    fn set_test_mode(&mut self, test_mode: bool);
}

/// Test result for the Testable trait
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TestResult {
    /// Name of the test
    pub name: String,
    
    /// Whether the test passed
    pub passed: bool,
    
    /// Error message if the test failed
    pub error_message: Option<String>,
    
    /// Duration of the test in milliseconds
    pub duration_ms: u64,
}

/// Standard component interface that combines all other interfaces
pub trait Component:
    Initializable +
    Serializable +
    StateManagement +
    AccountManagement +
    InstructionProcessor +
    EventEmitter +
    MetricsCollector +
    ConfigurationManagement +
    SecurityManagement +
    Upgradeable +
    Testable
{
    /// Get the name of the component
    fn name(&self) -> &str;
    
    /// Get the description of the component
    fn description(&self) -> &str;
    
    /// Get the dependencies of the component
    fn dependencies(&self) -> Vec<&str>;
}
