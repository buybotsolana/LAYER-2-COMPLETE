// src/fee_optimization/mod.rs
//! Fee Optimization module for Layer-2 on Solana
//!
//! This module provides functionality for optimizing transaction fees and
//! enabling gasless transactions. It includes mechanisms for meta-transactions,
//! relayers, and fee subsidization.

mod gasless_transactions;

pub use gasless_transactions::*;
