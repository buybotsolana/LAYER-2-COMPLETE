// src/lib.rs
//! Layer-2 on Solana - Integration Module
//! 
//! This module integrates all components of the Layer-2 solution:
//! - Fraud Proof System
//! - Finalization Logic
//! - Bridge Mechanism (Deposits and Withdrawals)

mod fraud_proof_system;
mod bridge;
mod finalization;

pub use fraud_proof_system::FraudProofSystem;
pub use bridge::{DepositHandler, WithdrawalHandler};
pub use finalization::FinalizationManager;

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    program::{invoke, invoke_signed},
    system_instruction,
    sysvar::{rent::Rent, Sysvar},
};
use solana_program::borsh::try_from_slice_unchecked;
use borsh::{BorshDeserialize, BorshSerialize};

/// Instruction types for the Layer-2 system
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum Layer2Instruction {
    /// Fraud Proof System instructions
    FraudProof(fraud_proof_system::FraudProofInstruction),
    
    /// Bridge instructions
    Bridge(bridge::BridgeInstruction),
    
    /// Finalization instructions
    Finalization(finalization::FinalizationInstruction),
}

/// Program entrypoint
entrypoint!(process_instruction);

/// Process instruction
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = Layer2Instruction::try_from_slice(instruction_data)?;
    
    match instruction {
        Layer2Instruction::FraudProof(fraud_proof_instruction) => {
            fraud_proof_system::process_instruction(program_id, accounts, &fraud_proof_instruction)
        },
        Layer2Instruction::Bridge(bridge_instruction) => {
            bridge::process_instruction(program_id, accounts, &bridge_instruction)
        },
        Layer2Instruction::Finalization(finalization_instruction) => {
            finalization::process_instruction(program_id, accounts, &finalization_instruction)
        },
    }
}

/// Layer-2 system configuration
pub struct Layer2Config {
    /// Owner of the Layer-2 system
    pub owner: Pubkey,
    
    /// L1 bridge address
    pub l1_bridge_address: [u8; 20],
    
    /// L1 withdrawal bridge address
    pub l1_withdrawal_bridge_address: [u8; 20],
    
    /// Challenge period in seconds
    pub challenge_period: u64,
}

/// Layer-2 system
pub struct Layer2System {
    /// Configuration
    pub config: Layer2Config,
    
    /// Fraud proof system
    pub fraud_proof_system: FraudProofSystem,
    
    /// Deposit handler
    pub deposit_handler: bridge::DepositHandler,
    
    /// Withdrawal handler
    pub withdrawal_handler: bridge::WithdrawalHandler,
    
    /// Finalization manager
    pub finalization_manager: finalization::FinalizationManager,
}

impl Layer2System {
    /// Create a new Layer-2 system
    pub fn new(config: Layer2Config) -> Self {
        Self {
            config: config.clone(),
            fraud_proof_system: FraudProofSystem::new(),
            deposit_handler: bridge::DepositHandler::new(config.l1_bridge_address),
            withdrawal_handler: bridge::WithdrawalHandler::new(config.l1_withdrawal_bridge_address),
            finalization_manager: finalization::FinalizationManager::new(config.challenge_period),
        }
    }
    
    /// Initialize the Layer-2 system
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        // Initialize fraud proof system
        self.fraud_proof_system.initialize(program_id, accounts)?;
        
        // Initialize deposit handler
        self.deposit_handler.initialize(program_id, accounts)?;
        
        // Initialize withdrawal handler
        self.withdrawal_handler.initialize(program_id, accounts)?;
        
        // Initialize finalization manager
        self.finalization_manager.initialize(program_id, accounts)?;
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_layer2_system_creation() {
        let config = Layer2Config {
            owner: Pubkey::new_unique(),
            l1_bridge_address: [1; 20],
            l1_withdrawal_bridge_address: [2; 20],
            challenge_period: 7 * 24 * 60 * 60, // 7 days
        };
        
        let layer2_system = Layer2System::new(config);
        
        // Basic test to ensure the system can be created
        assert_eq!(layer2_system.config.challenge_period, 7 * 24 * 60 * 60);
    }
}
