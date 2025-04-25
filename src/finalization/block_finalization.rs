// src/finalization/block_finalization.rs
//! Block Finalization implementation for Layer-2 on Solana
//! 
//! This module provides the implementation of block finalization logic,
//! ensuring that blocks become final and irreversible after a challenge period.

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

/// Block status
#[derive(Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum BlockStatus {
    /// Block is pending finalization
    Pending,
    
    /// Block is being challenged
    Challenged,
    
    /// Block is finalized
    Finalized,
    
    /// Block is invalidated
    Invalidated,
}

/// Block information
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct BlockInfo {
    /// Block number
    pub number: u64,
    
    /// Block hash
    pub hash: [u8; 32],
    
    /// State root
    pub state_root: [u8; 32],
    
    /// Timestamp
    pub timestamp: u64,
    
    /// Proposer
    pub proposer: [u8; 32],
    
    /// Status
    pub status: BlockStatus,
    
    /// Challenge deadline
    pub challenge_deadline: u64,
    
    /// Challenges
    pub challenges: Vec<Challenge>,
}

/// Challenge information
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct Challenge {
    /// Challenger
    pub challenger: [u8; 32],
    
    /// Challenge timestamp
    pub timestamp: u64,
    
    /// Challenge reason
    pub reason: String,
    
    /// Challenge data
    pub data: Vec<u8>,
}

/// Block finalization for the Layer-2 system
pub struct BlockFinalization {
    /// Challenge period in seconds
    pub challenge_period: u64,
    
    /// Blocks
    pub blocks: HashMap<u64, BlockInfo>,
    
    /// Latest finalized block number
    pub latest_finalized_block: u64,
}

impl BlockFinalization {
    /// Create a new block finalization
    pub fn new(challenge_period: u64) -> Self {
        Self {
            challenge_period,
            blocks: HashMap::new(),
            latest_finalized_block: 0,
        }
    }
    
    /// Initialize the block finalization
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        // In a real implementation, we would initialize the block finalization
        // with accounts and other data
        Ok(())
    }
    
    /// Propose a new block
    pub fn propose_block(
        &mut self,
        number: u64,
        hash: [u8; 32],
        state_root: [u8; 32],
        proposer: [u8; 32],
    ) -> Result<(), String> {
        // Check if the block number is valid
        if number <= self.latest_finalized_block {
            return Err(format!("Block number {} is already finalized", number));
        }
        
        // Check if the block already exists
        if self.blocks.contains_key(&number) {
            return Err(format!("Block number {} already exists", number));
        }
        
        // Get the current timestamp
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        // Create the block info
        let block_info = BlockInfo {
            number,
            hash,
            state_root,
            timestamp: now,
            proposer,
            status: BlockStatus::Pending,
            challenge_deadline: now + self.challenge_period,
            challenges: Vec::new(),
        };
        
        // Add the block
        self.blocks.insert(number, block_info);
        
        Ok(())
    }
    
    /// Challenge a block
    pub fn challenge_block(
        &mut self,
        number: u64,
        challenger: [u8; 32],
        reason: String,
        data: Vec<u8>,
    ) -> Result<(), String> {
        // Check if the block exists
        let block_info = match self.blocks.get_mut(&number) {
            Some(info) => info,
            None => return Err(format!("Block number {} does not exist", number)),
        };
        
        // Check if the block is still pending
        if block_info.status != BlockStatus::Pending {
            return Err(format!("Block number {} is not pending", number));
        }
        
        // Check if the challenge deadline has passed
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        if now > block_info.challenge_deadline {
            return Err(format!("Challenge deadline for block number {} has passed", number));
        }
        
        // Create the challenge
        let challenge = Challenge {
            challenger,
            timestamp: now,
            reason,
            data,
        };
        
        // Add the challenge
        block_info.challenges.push(challenge);
        
        // Update the block status
        block_info.status = BlockStatus::Challenged;
        
        Ok(())
    }
    
    /// Resolve a challenge
    pub fn resolve_challenge(
        &mut self,
        number: u64,
        challenge_index: usize,
        is_valid: bool,
    ) -> Result<(), String> {
        // Check if the block exists
        let block_info = match self.blocks.get_mut(&number) {
            Some(info) => info,
            None => return Err(format!("Block number {} does not exist", number)),
        };
        
        // Check if the block is challenged
        if block_info.status != BlockStatus::Challenged {
            return Err(format!("Block number {} is not challenged", number));
        }
        
        // Check if the challenge index is valid
        if challenge_index >= block_info.challenges.len() {
            return Err(format!("Challenge index {} is invalid", challenge_index));
        }
        
        // Update the block status based on the challenge resolution
        if is_valid {
            // The challenge is valid, so the block is invalidated
            block_info.status = BlockStatus::Invalidated;
        } else {
            // The challenge is invalid, so the block remains pending
            block_info.status = BlockStatus::Pending;
            
            // Remove the challenge
            block_info.challenges.remove(challenge_index);
            
            // If there are no more challenges, check if the block can be finalized
            if block_info.challenges.is_empty() {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                
                if now > block_info.challenge_deadline {
                    // The challenge deadline has passed, so the block can be finalized
                    block_info.status = BlockStatus::Finalized;
                    
                    // Update the latest finalized block number if necessary
                    if block_info.number > self.latest_finalized_block {
                        self.latest_finalized_block = block_info.number;
                    }
                }
            }
        }
        
        Ok(())
    }
    
    /// Finalize blocks
    pub fn finalize_blocks(&mut self) -> Result<Vec<u64>, String> {
        let mut finalized_blocks = Vec::new();
        
        // Get the current timestamp
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        // Check all pending blocks
        for (number, block_info) in self.blocks.iter_mut() {
            if block_info.status == BlockStatus::Pending && now > block_info.challenge_deadline {
                // The challenge deadline has passed, so the block can be finalized
                block_info.status = BlockStatus::Finalized;
                
                // Update the latest finalized block number if necessary
                if *number > self.latest_finalized_block {
                    self.latest_finalized_block = *number;
                }
                
                // Add the block number to the list of finalized blocks
                finalized_blocks.push(*number);
            }
        }
        
        Ok(finalized_blocks)
    }
    
    /// Get a block
    pub fn get_block(&self, number: u64) -> Option<&BlockInfo> {
        self.blocks.get(&number)
    }
    
    /// Get the latest finalized block
    pub fn get_latest_finalized_block(&self) -> Option<&BlockInfo> {
        self.blocks.get(&self.latest_finalized_block)
    }
    
    /// Get all blocks
    pub fn get_blocks(&self) -> &HashMap<u64, BlockInfo> {
        &self.blocks
    }
}

/// Block finalization instruction types
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum BlockFinalizationInstruction {
    /// Propose a new block
    ProposeBlock {
        /// Block number
        number: u64,
        
        /// Block hash
        hash: [u8; 32],
        
        /// State root
        state_root: [u8; 32],
    },
    
    /// Challenge a block
    ChallengeBlock {
        /// Block number
        number: u64,
        
        /// Challenge reason
        reason: String,
        
        /// Challenge data
        data: Vec<u8>,
    },
    
    /// Resolve a challenge
    ResolveChallenge {
        /// Block number
        number: u64,
        
        /// Challenge index
        challenge_index: u64,
        
        /// Is the challenge valid
        is_valid: bool,
    },
    
    /// Finalize blocks
    FinalizeBlocks,
}

/// Process block finalization instruction
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction: &BlockFinalizationInstruction,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    
    match instruction {
        BlockFinalizationInstruction::ProposeBlock {
            number,
            hash,
            state_root,
        } => {
            // Get the proposer account
            let proposer_info = next_account_info(account_info_iter)?;
            
            // Check if the proposer is a signer
            if !proposer_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the block finalization account
            let block_finalization_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the block finalization account
            // 2. Propose the block
            // 3. Serialize the updated block finalization account
            
            // For now, we just log the proposal
            msg!("Proposed block number: {}", number);
            
            Ok(())
        },
        BlockFinalizationInstruction::ChallengeBlock {
            number,
            reason,
            data,
        } => {
            // Get the challenger account
            let challenger_info = next_account_info(account_info_iter)?;
            
            // Check if the challenger is a signer
            if !challenger_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the block finalization account
            let block_finalization_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the block finalization account
            // 2. Challenge the block
            // 3. Serialize the updated block finalization account
            
            // For now, we just log the challenge
            msg!("Challenged block number: {}", number);
            
            Ok(())
        },
        BlockFinalizationInstruction::ResolveChallenge {
            number,
            challenge_index,
            is_valid,
        } => {
            // Get the resolver account
            let resolver_info = next_account_info(account_info_iter)?;
            
            // Check if the resolver is a signer
            if !resolver_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the block finalization account
            let block_finalization_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the block finalization account
            // 2. Resolve the challenge
            // 3. Serialize the updated block finalization account
            
            // For now, we just log the resolution
            msg!("Resolved challenge for block number: {}", number);
            
            Ok(())
        },
        BlockFinalizationInstruction::FinalizeBlocks => {
            // Get the block finalization account
            let block_finalization_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the block finalization account
            // 2. Finalize blocks
            // 3. Serialize the updated block finalization account
            
            // For now, we just log the finalization
            msg!("Finalized blocks");
            
            Ok(())
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_block_finalization() {
        // Create a block finalization with a 10-second challenge period
        let mut block_finalization = BlockFinalization::new(10);
        
        // Propose a block
        let result = block_finalization.propose_block(
            1,
            [1; 32],
            [2; 32],
            [3; 32],
        );
        assert!(result.is_ok());
        
        // Get the block
        let block = block_finalization.get_block(1).unwrap();
        assert_eq!(block.number, 1);
        assert_eq!(block.hash, [1; 32]);
        assert_eq!(block.state_root, [2; 32]);
        assert_eq!(block.proposer, [3; 32]);
        assert_eq!(block.status, BlockStatus::Pending);
        
        // Challenge the block
        let result = block_finalization.challenge_block(
            1,
            [4; 32],
            "Invalid state transition".to_string(),
            Vec::new(),
        );
        assert!(result.is_ok());
        
        // Get the block again
        let block = block_finalization.get_block(1).unwrap();
        assert_eq!(block.status, BlockStatus::Challenged);
        assert_eq!(block.challenges.len(), 1);
        
        // Resolve the challenge as invalid
        let result = block_finalization.resolve_challenge(1, 0, false);
        assert!(result.is_ok());
        
        // Get the block again
        let block = block_finalization.get_block(1).unwrap();
        assert_eq!(block.status, BlockStatus::Pending);
        assert_eq!(block.challenges.len(), 0);
    }
}
