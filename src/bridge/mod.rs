// src/bridge/mod.rs
//! Bridge module for Layer-2 on Solana
//!
//! This module provides functionality for transferring assets between Solana L1
//! and the Layer-2 system. It includes a trustless bridge implementation using
//! Wormhole for secure cross-chain communication.

mod complete_bridge;

pub use complete_bridge::*;
