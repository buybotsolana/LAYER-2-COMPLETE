// src/finalization/mod.rs
//! Finalization module for Layer-2 on Solana
//! 
//! This module integrates the finalization logic for the Layer-2 system,
//! ensuring that blocks become final and irreversible after a challenge period.

mod block_finalization;
mod state_commitment;
mod output_oracle;

pub use block_finalization::BlockFinalization;
pub use state_commitment::StateCommitment;
pub use output_oracle::L2OutputOracle;

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};

/// Finalization manager for the Layer-2 system
pub struct FinalizationManager {
    /// Challenge period in seconds
    pub challenge_period: u64,
    
    /// Block finalization
    pub block_finalization: BlockFinalization,
    
    /// State commitment
    pub state_commitment: StateCommitment,
    
    /// L2 output oracle
    pub output_oracle: L2OutputOracle,
}

impl FinalizationManager {
    /// Create a new finalization manager
    pub fn new(challenge_period: u64) -> Self {
        Self {
            challenge_period,
            block_finalization: BlockFinalization::new(challenge_period),
            state_commitment: StateCommitment::new(),
            output_oracle: L2OutputOracle::new(challenge_period),
        }
    }
    
    /// Initialize the finalization manager
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        // Initialize block finalization
        self.block_finalization.initialize(program_id, accounts)?;
        
        // Initialize state commitment
        self.state_commitment.initialize(program_id, accounts)?;
        
        // Initialize L2 output oracle
        self.output_oracle.initialize(program_id, accounts)?;
        
        Ok(())
    }
}

/// Finalization instruction types
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum FinalizationInstruction {
    /// Block finalization instructions
    BlockFinalization(block_finalization::BlockFinalizationInstruction),
    
    /// State commitment instructions
    StateCommitment(state_commitment::StateCommitmentInstruction),
    
    /// L2 output oracle instructions
    OutputOracle(output_oracle::OutputOracleInstruction),
}

/// Process finalization instruction
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction: &FinalizationInstruction,
) -> ProgramResult {
    match instruction {
        FinalizationInstruction::BlockFinalization(block_finalization_instruction) => {
            block_finalization::process_instruction(program_id, accounts, block_finalization_instruction)
        },
        FinalizationInstruction::StateCommitment(state_commitment_instruction) => {
            state_commitment::process_instruction(program_id, accounts, state_commitment_instruction)
        },
        FinalizationInstruction::OutputOracle(output_oracle_instruction) => {
            output_oracle::process_instruction(program_id, accounts, output_oracle_instruction)
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_finalization_integration() {
        // Create a finalization manager with a 7-day challenge period
        let challenge_period = 7 * 24 * 60 * 60; // 7 days in seconds
        let finalization_manager = FinalizationManager::new(challenge_period);
        
        // Basic test to ensure the manager can be created
        assert_eq!(finalization_manager.challenge_period, challenge_period);
    }
}
