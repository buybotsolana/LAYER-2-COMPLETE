// src/sequencer/mod.rs
//! Sequencer module for Layer-2 on Solana
//!
//! This module provides functionality for collecting, ordering, and batching
//! transactions before submitting them to the rollup. It includes mechanisms for
//! transaction prioritization, fee markets, and batch optimization.

mod transaction_sequencer;

pub use transaction_sequencer::*;
