// src/interfaces/mod.rs
//! Standard interfaces for Layer-2 components
//! 
//! This module provides a collection of standard interfaces that all Layer-2
//! components should implement to ensure consistency and interoperability.

pub mod component_interface;
pub mod fraud_proof_interface;
pub mod finalization_interface;
pub mod bridge_interface;

// Re-export common interfaces
pub use component_interface::{
    Component, ComponentError, Initializable, Serializable,
    StateManagement, AccountManagement, InstructionProcessor,
    EventEmitter, MetricsCollector, ConfigurationManagement,
    SecurityManagement, Upgradeable, Testable, TestResult
};

pub use fraud_proof_interface::{
    FraudProofGenerator, BisectionGameManager, MerkleTreeManager,
    StateTransitionVerifier, SolanaRuntimeWrapper, FraudProofSystem
};

pub use finalization_interface::{
    BlockFinalizationManager, StateCommitmentManager,
    L2OutputOracleManager, FinalizationManager
};

pub use bridge_interface::{
    DepositHandler, WithdrawalHandler, TokenMapper,
    MessagePasser, Bridge
};
