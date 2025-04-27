// src/interfaces/mod.rs
//! Interfaces module for Layer-2 on Solana
//!
//! This module provides interfaces for the various components of the Layer-2 system,
//! ensuring proper integration and interoperability between the rollup, bridge,
//! sequencer, and fee optimization systems.

mod rollup_interface;
mod bridge_interface;
mod sequencer_interface;
mod fee_optimization_interface;

pub use rollup_interface::*;
pub use bridge_interface::*;
pub use sequencer_interface::*;
pub use fee_optimization_interface::*;
