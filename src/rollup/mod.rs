// src/rollup/mod.rs
//! Rollup module for Layer-2 on Solana
//!
//! This module provides the core functionality for the optimistic rollup system
//! that allows for off-chain transaction execution with on-chain verification.
//! It includes mechanisms for batching transactions, committing state, and
//! handling fraud proofs.

mod optimistic_rollup;

pub use optimistic_rollup::*;
