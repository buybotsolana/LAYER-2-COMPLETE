// src/bridge/mod.rs
//! Bridge module for Layer-2 on Solana
//! 
//! This module integrates the deposit and withdrawal handlers for the bridge
//! between Ethereum (L1) and Solana Layer-2.

mod deposit_handler;
mod withdrawal_handler;

pub use deposit_handler::{DepositHandler, Deposit};
pub use withdrawal_handler::{WithdrawalHandler, Withdrawal};

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};

/// Bridge instruction types
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum BridgeInstruction {
    /// Deposit instructions
    Deposit(deposit_handler::DepositInstruction),
    
    /// Withdrawal instructions
    Withdrawal(withdrawal_handler::WithdrawalInstruction),
}

/// Process bridge instruction
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction: &BridgeInstruction,
) -> ProgramResult {
    match instruction {
        BridgeInstruction::Deposit(deposit_instruction) => {
            deposit_handler::process_instruction(program_id, accounts, deposit_instruction)
        },
        BridgeInstruction::Withdrawal(withdrawal_instruction) => {
            withdrawal_handler::process_instruction(program_id, accounts, withdrawal_instruction)
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_bridge_integration() {
        // This test will be expanded to test the integration of deposit and withdrawal handlers
    }
}
