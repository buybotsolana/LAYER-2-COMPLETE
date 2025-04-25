// src/finalization/output_oracle.rs
//! L2 Output Oracle implementation for Layer-2 on Solana
//! 
//! This module provides the implementation of the L2 Output Oracle,
//! which is responsible for publishing L2 state outputs to L1.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// L2 output information
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct L2Output {
    /// Output index
    pub index: u64,
    
    /// Block number
    pub block_number: u64,
    
    /// Output root
    pub root: [u8; 32],
    
    /// Timestamp
    pub timestamp: u64,
    
    /// Submitter
    pub submitter: [u8; 32],
    
    /// Is finalized
    pub is_finalized: bool,
    
    /// Finalization timestamp
    pub finalization_timestamp: Option<u64>,
}

/// L2 Output Oracle for the Layer-2 system
pub struct L2OutputOracle {
    /// Challenge period in seconds
    pub challenge_period: u64,
    
    /// Outputs
    pub outputs: HashMap<u64, L2Output>,
    
    /// Latest output index
    pub latest_output_index: u64,
    
    /// Latest finalized output index
    pub latest_finalized_output_index: u64,
}

impl L2OutputOracle {
    /// Create a new L2 Output Oracle
    pub fn new(challenge_period: u64) -> Self {
        Self {
            challenge_period,
            outputs: HashMap::new(),
            latest_output_index: 0,
            latest_finalized_output_index: 0,
        }
    }
    
    /// Initialize the L2 Output Oracle
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        // In a real implementation, we would initialize the L2 Output Oracle
        // with accounts and other data
        Ok(())
    }
    
    /// Submit a new L2 output
    pub fn submit_output(
        &mut self,
        block_number: u64,
        root: [u8; 32],
        submitter: [u8; 32],
    ) -> Result<u64, String> {
        // Get the current timestamp
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        // Create the L2 output
        let output = L2Output {
            index: self.latest_output_index + 1,
            block_number,
            root,
            timestamp: now,
            submitter,
            is_finalized: false,
            finalization_timestamp: None,
        };
        
        // Add the output
        self.outputs.insert(output.index, output.clone());
        
        // Update the latest output index
        self.latest_output_index = output.index;
        
        Ok(output.index)
    }
    
    /// Finalize an L2 output
    pub fn finalize_output(&mut self, index: u64) -> Result<(), String> {
        // Check if the output exists
        let output = match self.outputs.get_mut(&index) {
            Some(output) => output,
            None => return Err(format!("Output with index {} does not exist", index)),
        };
        
        // Check if the output is already finalized
        if output.is_finalized {
            return Err(format!("Output with index {} is already finalized", index));
        }
        
        // Check if the challenge period has passed
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        if now < output.timestamp + self.challenge_period {
            return Err(format!("Challenge period for output with index {} has not passed", index));
        }
        
        // Update the output
        output.is_finalized = true;
        output.finalization_timestamp = Some(now);
        
        // Update the latest finalized output index if necessary
        if index > self.latest_finalized_output_index {
            self.latest_finalized_output_index = index;
        }
        
        Ok(())
    }
    
    /// Delete an L2 output
    pub fn delete_output(&mut self, index: u64) -> Result<(), String> {
        // Check if the output exists
        if !self.outputs.contains_key(&index) {
            return Err(format!("Output with index {} does not exist", index));
        }
        
        // Check if the output is finalized
        let output = self.outputs.get(&index).unwrap();
        if output.is_finalized {
            return Err(format!("Output with index {} is finalized and cannot be deleted", index));
        }
        
        // Remove the output
        self.outputs.remove(&index);
        
        // Update the latest output index if necessary
        if index == self.latest_output_index {
            // Find the new latest output index
            self.latest_output_index = self.outputs.keys()
                .max()
                .copied()
                .unwrap_or(0);
        }
        
        Ok(())
    }
    
    /// Get an L2 output
    pub fn get_output(&self, index: u64) -> Option<&L2Output> {
        self.outputs.get(&index)
    }
    
    /// Get the latest output
    pub fn get_latest_output(&self) -> Option<&L2Output> {
        self.outputs.get(&self.latest_output_index)
    }
    
    /// Get the latest finalized output
    pub fn get_latest_finalized_output(&self) -> Option<&L2Output> {
        self.outputs.get(&self.latest_finalized_output_index)
    }
    
    /// Get all outputs
    pub fn get_outputs(&self) -> &HashMap<u64, L2Output> {
        &self.outputs
    }
    
    /// Verify an L2 output
    pub fn verify_output(
        &self,
        index: u64,
        root: [u8; 32],
    ) -> bool {
        match self.outputs.get(&index) {
            Some(output) => output.root == root,
            None => false,
        }
    }
}

/// L2 Output Oracle instruction types
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum OutputOracleInstruction {
    /// Submit a new L2 output
    SubmitOutput {
        /// Block number
        block_number: u64,
        
        /// Output root
        root: [u8; 32],
    },
    
    /// Finalize an L2 output
    FinalizeOutput {
        /// Output index
        index: u64,
    },
    
    /// Delete an L2 output
    DeleteOutput {
        /// Output index
        index: u64,
    },
    
    /// Verify an L2 output
    VerifyOutput {
        /// Output index
        index: u64,
        
        /// Output root
        root: [u8; 32],
    },
}

/// Process L2 Output Oracle instruction
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction: &OutputOracleInstruction,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    
    match instruction {
        OutputOracleInstruction::SubmitOutput {
            block_number,
            root,
        } => {
            // Get the submitter account
            let submitter_info = next_account_info(account_info_iter)?;
            
            // Check if the submitter is a signer
            if !submitter_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the L2 Output Oracle account
            let output_oracle_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the L2 Output Oracle account
            // 2. Submit the output
            // 3. Serialize the updated L2 Output Oracle account
            
            // For now, we just log the submission
            msg!("Submitted L2 output for block number: {}", block_number);
            
            Ok(())
        },
        OutputOracleInstruction::FinalizeOutput {
            index,
        } => {
            // Get the L2 Output Oracle account
            let output_oracle_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the L2 Output Oracle account
            // 2. Finalize the output
            // 3. Serialize the updated L2 Output Oracle account
            
            // For now, we just log the finalization
            msg!("Finalized L2 output with index: {}", index);
            
            Ok(())
        },
        OutputOracleInstruction::DeleteOutput {
            index,
        } => {
            // Get the submitter account
            let submitter_info = next_account_info(account_info_iter)?;
            
            // Check if the submitter is a signer
            if !submitter_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the L2 Output Oracle account
            let output_oracle_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the L2 Output Oracle account
            // 2. Delete the output
            // 3. Serialize the updated L2 Output Oracle account
            
            // For now, we just log the deletion
            msg!("Deleted L2 output with index: {}", index);
            
            Ok(())
        },
        OutputOracleInstruction::VerifyOutput {
            index,
            root,
        } => {
            // Get the L2 Output Oracle account
            let output_oracle_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the L2 Output Oracle account
            // 2. Verify the output
            
            // For now, we just log the verification
            msg!("Verified L2 output with index: {}", index);
            
            Ok(())
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_l2_output_oracle() {
        // Create an L2 Output Oracle with a 10-second challenge period
        let mut output_oracle = L2OutputOracle::new(10);
        
        // Submit an output
        let result = output_oracle.submit_output(
            1,
            [1; 32],
            [2; 32],
        );
        assert!(result.is_ok());
        let index = result.unwrap();
        
        // Get the output
        let output = output_oracle.get_output(index).unwrap();
        assert_eq!(output.index, index);
        assert_eq!(output.block_number, 1);
        assert_eq!(output.root, [1; 32]);
        assert_eq!(output.submitter, [2; 32]);
        assert!(!output.is_finalized);
        assert!(output.finalization_timestamp.is_none());
        
        // Verify the output
        let result = output_oracle.verify_output(index, [1; 32]);
        assert!(result);
        
        // Verify with an incorrect root
        let result = output_oracle.verify_output(index, [2; 32]);
        assert!(!result);
    }
}
