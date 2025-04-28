// src/rollup/mod.rs
//! Optimistic Rollup module for Layer-2 on Solana
//!
//! This module contains the implementation of the optimistic rollup system,
//! which is a core component of the Layer-2 solution.

pub mod optimistic_rollup;

// Re-export main components
pub use optimistic_rollup::*;
