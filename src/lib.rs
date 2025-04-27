// src/lib.rs
//! Layer-2 on Solana
//!
//! This crate implements a Layer-2 system for Solana, including an optimistic rollup,
//! a trustless bridge, a transaction sequencer, and a fee optimization system.

pub mod rollup;
pub mod bridge;
pub mod sequencer;
pub mod fee_optimization;
pub mod interfaces;

// Re-export main components for convenience
pub use rollup::OptimisticRollup;
pub use bridge::CompleteBridge;
pub use sequencer::TransactionSequencer;
pub use fee_optimization::GaslessTransactions;

// Re-export interfaces
pub use interfaces::rollup_interface::RollupInterface;
pub use interfaces::bridge_interface::BridgeInterface;
pub use interfaces::sequencer_interface::SequencerInterface;
pub use interfaces::fee_optimization_interface::FeeOptimizationInterface;
