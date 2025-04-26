// src/lib.rs
//! Layer-2 on Solana - Main Library
//! 
//! This is the main entry point for the Layer-2 solution on Solana.
//! It integrates all components of the system: Fraud Proof System,
//! Finalization System, and Bridge.
//!
//! The Layer-2 solution implements an Optimistic Rollup using the
//! Solana Virtual Machine (SVM) as the execution layer, providing
//! scalability, security, and interoperability between Ethereum (L1)
//! and Solana.

mod fraud_proof_system;
mod finalization;
mod bridge;
mod utils;

pub use fraud_proof_system::{
    FraudProofSystem,
    FraudProof,
    FraudProofType,
    BisectionGame,
    MerkleTree,
    StateTransition,
    SolanaRuntimeWrapper,
};

pub use finalization::{
    FinalizationManager,
    BlockFinalization,
    StateCommitment,
    L2OutputOracle,
    FinalizationRBAC,
};

pub use bridge::{
    BridgeManager,
    DepositHandler,
    WithdrawalHandler,
    TokenRegistry,
    SecurityModule,
    MessageRelay,
    BridgeRBAC,
};

use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};

/// Instruction types for the Layer-2 system
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum Instruction {
    /// Fraud proof system instructions
    FraudProofSystem(fraud_proof_system::FraudProofInstruction),
    
    /// Finalization system instructions
    Finalization(finalization::FinalizationInstruction),
    
    /// Bridge instructions
    Bridge(bridge::BridgeInstruction),
}

/// Process instruction entrypoint
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Deserialize the instruction
    let instruction = Instruction::try_from_slice(instruction_data)?;
    
    // Process the instruction based on its type
    match instruction {
        Instruction::FraudProofSystem(fraud_proof_instruction) => {
            fraud_proof_system::process_instruction(program_id, accounts, &fraud_proof_instruction)
        },
        Instruction::Finalization(finalization_instruction) => {
            finalization::process_instruction(program_id, accounts, &finalization_instruction)
        },
        Instruction::Bridge(bridge_instruction) => {
            bridge::process_instruction(program_id, accounts, &bridge_instruction)
        },
    }
}

// Declare the program entrypoint
entrypoint!(process_instruction);

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_instruction_serialization() {
        // Create a fraud proof instruction
        let fraud_proof_instruction = fraud_proof_system::FraudProofInstruction::CheckTimeouts;
        let instruction = Instruction::FraudProofSystem(fraud_proof_instruction);
        
        // Serialize the instruction
        let serialized = borsh::to_vec(&instruction).unwrap();
        
        // Deserialize the instruction
        let deserialized = Instruction::try_from_slice(&serialized).unwrap();
        
        // Verify that the deserialized instruction matches the original
        match deserialized {
            Instruction::FraudProofSystem(deserialized_fraud_proof_instruction) => {
                match deserialized_fraud_proof_instruction {
                    fraud_proof_system::FraudProofInstruction::CheckTimeouts => {
                        // This is the expected case
                    },
                    _ => panic!("Deserialized instruction does not match original"),
                }
            },
            _ => panic!("Deserialized instruction does not match original"),
        }
    }
}
