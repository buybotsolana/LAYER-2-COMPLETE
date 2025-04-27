// src/fee_optimization/mod.rs
//! Fee Optimization module for Layer-2 on Solana
//!
//! This module contains the implementation of the gasless transaction system,
//! which allows users to submit transactions without paying gas fees.

pub mod gasless_transactions;

// Re-export main components
pub use gasless_transactions::*;
