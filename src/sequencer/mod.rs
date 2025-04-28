// src/sequencer/mod.rs
//! Transaction Sequencer module for Layer-2 on Solana
//!
//! This module contains the implementation of the transaction sequencer,
//! which is responsible for collecting, batching, and publishing transactions.

pub mod transaction_sequencer;

// Re-export main components
pub use transaction_sequencer::*;
