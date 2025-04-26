// src/finalization/mod.rs
//! Finalization module for Layer-2 on Solana
//! 
//! This module integrates the finalization logic for the Layer-2 system,
//! ensuring that blocks become final and irreversible after a challenge period.
//! It implements a robust mechanism for block finalization, state commitment,
//! and L2 output oracle functionality.

mod block_finalization;
mod state_commitment;
mod output_oracle;

pub use block_finalization::{BlockFinalization, BlockInfo, BlockStatus, Challenge};
pub use state_commitment::{StateCommitment, StateCommitmentInfo};
pub use output_oracle::{L2OutputOracle, L2Output, L2OutputStatus};

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::{clock::Clock, Sysvar},
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;

/// Error types for finalization operations
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FinalizationError {
    /// Invalid block number
    InvalidBlockNumber(String),
    
    /// Block not found
    BlockNotFound(String),
    
    /// Invalid block status
    InvalidBlockStatus(String),
    
    /// Challenge deadline passed
    ChallengeDeadlinePassed(String),
    
    /// Invalid challenge index
    InvalidChallengeIndex(String),
    
    /// Invalid state commitment
    InvalidStateCommitment(String),
    
    /// Invalid L2 output
    InvalidL2Output(String),
    
    /// Generic error
    GenericError(String),
}

impl std::fmt::Display for FinalizationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FinalizationError::InvalidBlockNumber(msg) => write!(f, "Invalid block number: {}", msg),
            FinalizationError::BlockNotFound(msg) => write!(f, "Block not found: {}", msg),
            FinalizationError::InvalidBlockStatus(msg) => write!(f, "Invalid block status: {}", msg),
            FinalizationError::ChallengeDeadlinePassed(msg) => write!(f, "Challenge deadline passed: {}", msg),
            FinalizationError::InvalidChallengeIndex(msg) => write!(f, "Invalid challenge index: {}", msg),
            FinalizationError::InvalidStateCommitment(msg) => write!(f, "Invalid state commitment: {}", msg),
            FinalizationError::InvalidL2Output(msg) => write!(f, "Invalid L2 output: {}", msg),
            FinalizationError::GenericError(msg) => write!(f, "Generic error: {}", msg),
        }
    }
}

/// Role-based access control for finalization operations
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct FinalizationRBAC {
    /// Owner of the finalization system
    pub owner: Pubkey,
    
    /// Authorized proposers
    pub proposers: Vec<Pubkey>,
    
    /// Authorized challengers
    pub challengers: Vec<Pubkey>,
    
    /// Authorized validators
    pub validators: Vec<Pubkey>,
}

impl FinalizationRBAC {
    /// Create a new RBAC with the specified owner
    pub fn new(owner: Pubkey) -> Self {
        Self {
            owner,
            proposers: Vec::new(),
            challengers: Vec::new(),
            validators: Vec::new(),
        }
    }
    
    /// Check if an account is the owner
    pub fn is_owner(&self, account: &Pubkey) -> bool {
        *account == self.owner
    }
    
    /// Check if an account is an authorized proposer
    pub fn is_proposer(&self, account: &Pubkey) -> bool {
        self.is_owner(account) || self.proposers.contains(account)
    }
    
    /// Check if an account is an authorized challenger
    pub fn is_challenger(&self, account: &Pubkey) -> bool {
        self.is_owner(account) || self.challengers.contains(account)
    }
    
    /// Check if an account is an authorized validator
    pub fn is_validator(&self, account: &Pubkey) -> bool {
        self.is_owner(account) || self.validators.contains(account)
    }
    
    /// Add a proposer
    pub fn add_proposer(&mut self, account: Pubkey) {
        if !self.proposers.contains(&account) {
            self.proposers.push(account);
        }
    }
    
    /// Remove a proposer
    pub fn remove_proposer(&mut self, account: &Pubkey) {
        self.proposers.retain(|a| a != account);
    }
    
    /// Add a challenger
    pub fn add_challenger(&mut self, account: Pubkey) {
        if !self.challengers.contains(&account) {
            self.challengers.push(account);
        }
    }
    
    /// Remove a challenger
    pub fn remove_challenger(&mut self, account: &Pubkey) {
        self.challengers.retain(|a| a != account);
    }
    
    /// Add a validator
    pub fn add_validator(&mut self, account: Pubkey) {
        if !self.validators.contains(&account) {
            self.validators.push(account);
        }
    }
    
    /// Remove a validator
    pub fn remove_validator(&mut self, account: &Pubkey) {
        self.validators.retain(|a| a != account);
    }
}

/// Configuration for the finalization system
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct FinalizationConfig {
    /// Challenge period in seconds
    pub challenge_period: u64,
    
    /// Minimum number of blocks before finalization
    pub min_blocks_before_finalization: u64,
    
    /// Maximum number of challenges per block
    pub max_challenges_per_block: u64,
    
    /// Dispute game contract address
    pub dispute_game_address: Option<[u8; 32]>,
    
    /// Fraud proof system address
    pub fraud_proof_system_address: Option<[u8; 32]>,
}

impl FinalizationConfig {
    /// Create a new configuration with default values
    pub fn new() -> Self {
        Self {
            challenge_period: 7 * 24 * 60 * 60, // 7 days in seconds
            min_blocks_before_finalization: 10,
            max_challenges_per_block: 5,
            dispute_game_address: None,
            fraud_proof_system_address: None,
        }
    }
    
    /// Create a new configuration with the specified challenge period
    pub fn with_challenge_period(challenge_period: u64) -> Self {
        let mut config = Self::new();
        config.challenge_period = challenge_period;
        config
    }
}

/// Finalization manager for the Layer-2 system
pub struct FinalizationManager {
    /// Configuration
    pub config: FinalizationConfig,
    
    /// Role-based access control
    pub rbac: FinalizationRBAC,
    
    /// Block finalization
    pub block_finalization: BlockFinalization,
    
    /// State commitment
    pub state_commitment: StateCommitment,
    
    /// L2 output oracle
    pub output_oracle: L2OutputOracle,
    
    /// Last update timestamp
    pub last_update_timestamp: u64,
}

impl FinalizationManager {
    /// Create a new finalization manager with the specified challenge period
    pub fn new(challenge_period: u64) -> Self {
        Self {
            config: FinalizationConfig::with_challenge_period(challenge_period),
            rbac: FinalizationRBAC::new(Pubkey::default()),
            block_finalization: BlockFinalization::new(challenge_period),
            state_commitment: StateCommitment::new(),
            output_oracle: L2OutputOracle::new(challenge_period),
            last_update_timestamp: 0,
        }
    }
    
    /// Create a new finalization manager with the specified configuration and RBAC
    pub fn with_config_and_rbac(config: FinalizationConfig, rbac: FinalizationRBAC) -> Self {
        Self {
            config,
            rbac,
            block_finalization: BlockFinalization::new(config.challenge_period),
            state_commitment: StateCommitment::new(),
            output_oracle: L2OutputOracle::new(config.challenge_period),
            last_update_timestamp: 0,
        }
    }
    
    /// Initialize the finalization manager
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        // Initialize block finalization
        self.block_finalization.initialize(program_id, accounts)?;
        
        // Initialize state commitment
        self.state_commitment.initialize(program_id, accounts)?;
        
        // Initialize L2 output oracle
        self.output_oracle.initialize(program_id, accounts)?;
        
        // Set the last update timestamp
        let clock = Clock::get()?;
        self.last_update_timestamp = clock.unix_timestamp as u64;
        
        msg!("Finalization manager initialized");
        
        Ok(())
    }
    
    /// Update the finalization manager
    pub fn update(&mut self) -> Result<(), FinalizationError> {
        // Get the current timestamp
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| FinalizationError::GenericError(e.to_string()))?
            .as_secs();
        
        // Update the block finalization
        let finalized_blocks = self.block_finalization.finalize_blocks()
            .map_err(|e| FinalizationError::GenericError(e))?;
        
        // For each finalized block, update the state commitment and L2 output oracle
        for block_number in finalized_blocks {
            // Get the finalized block
            let block = self.block_finalization.get_block(block_number)
                .ok_or_else(|| FinalizationError::BlockNotFound(format!("Block number {} not found", block_number)))?;
            
            // Finalize the state commitment for this block
            self.state_commitment.finalize_state_commitment(block_number, block.state_root)
                .map_err(|e| FinalizationError::InvalidStateCommitment(e))?;
            
            // Submit the L2 output for this block
            self.output_oracle.submit_l2_output(block_number, block.state_root, now)
                .map_err(|e| FinalizationError::InvalidL2Output(e))?;
        }
        
        // Update the last update timestamp
        self.last_update_timestamp = now;
        
        Ok(())
    }
    
    /// Propose a new block
    pub fn propose_block(
        &mut self,
        proposer: &Pubkey,
        number: u64,
        hash: [u8; 32],
        state_root: [u8; 32],
    ) -> Result<(), FinalizationError> {
        // Check if the proposer is authorized
        if !self.rbac.is_proposer(proposer) {
            return Err(FinalizationError::GenericError("Proposer not authorized".to_string()));
        }
        
        // Propose the block
        self.block_finalization.propose_block(number, hash, state_root, proposer.to_bytes())
            .map_err(|e| FinalizationError::GenericError(e))
    }
    
    /// Challenge a block
    pub fn challenge_block(
        &mut self,
        challenger: &Pubkey,
        number: u64,
        reason: String,
        data: Vec<u8>,
    ) -> Result<(), FinalizationError> {
        // Check if the challenger is authorized
        if !self.rbac.is_challenger(challenger) {
            return Err(FinalizationError::GenericError("Challenger not authorized".to_string()));
        }
        
        // Challenge the block
        self.block_finalization.challenge_block(number, challenger.to_bytes(), reason, data)
            .map_err(|e| FinalizationError::GenericError(e))
    }
    
    /// Resolve a challenge
    pub fn resolve_challenge(
        &mut self,
        validator: &Pubkey,
        number: u64,
        challenge_index: usize,
        is_valid: bool,
    ) -> Result<(), FinalizationError> {
        // Check if the validator is authorized
        if !self.rbac.is_validator(validator) {
            return Err(FinalizationError::GenericError("Validator not authorized".to_string()));
        }
        
        // Resolve the challenge
        self.block_finalization.resolve_challenge(number, challenge_index, is_valid)
            .map_err(|e| FinalizationError::GenericError(e))
    }
    
    /// Submit a state commitment
    pub fn submit_state_commitment(
        &mut self,
        proposer: &Pubkey,
        block_number: u64,
        block_hash: [u8; 32],
        state_root: [u8; 32],
    ) -> Result<(), FinalizationError> {
        // Check if the proposer is authorized
        if !self.rbac.is_proposer(proposer) {
            return Err(FinalizationError::GenericError("Proposer not authorized".to_string()));
        }
        
        // Submit the state commitment
        self.state_commitment.submit_state_commitment(block_number, block_hash, state_root, proposer.to_bytes())
            .map_err(|e| FinalizationError::InvalidStateCommitment(e))
    }
    
    /// Submit an L2 output
    pub fn submit_l2_output(
        &mut self,
        proposer: &Pubkey,
        block_number: u64,
        output_root: [u8; 32],
    ) -> Result<(), FinalizationError> {
        // Check if the proposer is authorized
        if !self.rbac.is_proposer(proposer) {
            return Err(FinalizationError::GenericError("Proposer not authorized".to_string()));
        }
        
        // Get the current timestamp
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| FinalizationError::GenericError(e.to_string()))?
            .as_secs();
        
        // Submit the L2 output
        self.output_oracle.submit_l2_output(block_number, output_root, now)
            .map_err(|e| FinalizationError::InvalidL2Output(e))
    }
    
    /// Get the latest finalized block
    pub fn get_latest_finalized_block(&self) -> Option<&BlockInfo> {
        self.block_finalization.get_latest_finalized_block()
    }
    
    /// Get the latest finalized state commitment
    pub fn get_latest_finalized_state_commitment(&self) -> Option<&StateCommitmentInfo> {
        self.state_commitment.get_latest_finalized_state_commitment()
    }
    
    /// Get the latest finalized L2 output
    pub fn get_latest_finalized_l2_output(&self) -> Option<&L2Output> {
        self.output_oracle.get_latest_finalized_l2_output()
    }
}

/// Finalization instruction types
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum FinalizationInstruction {
    /// Initialize the finalization system
    Initialize {
        /// Challenge period in seconds
        challenge_period: u64,
        
        /// Minimum number of blocks before finalization
        min_blocks_before_finalization: u64,
        
        /// Maximum number of challenges per block
        max_challenges_per_block: u64,
    },
    
    /// Update the finalization system
    Update,
    
    /// Block finalization instructions
    BlockFinalization(block_finalization::BlockFinalizationInstruction),
    
    /// State commitment instructions
    StateCommitment(state_commitment::StateCommitmentInstruction),
    
    /// L2 output oracle instructions
    OutputOracle(output_oracle::OutputOracleInstruction),
    
    /// Add a proposer
    AddProposer {
        /// Proposer account
        proposer: Pubkey,
    },
    
    /// Remove a proposer
    RemoveProposer {
        /// Proposer account
        proposer: Pubkey,
    },
    
    /// Add a challenger
    AddChallenger {
        /// Challenger account
        challenger: Pubkey,
    },
    
    /// Remove a challenger
    RemoveChallenger {
        /// Challenger account
        challenger: Pubkey,
    },
    
    /// Add a validator
    AddValidator {
        /// Validator account
        validator: Pubkey,
    },
    
    /// Remove a validator
    RemoveValidator {
        /// Validator account
        validator: Pubkey,
    },
    
    /// Update contract addresses
    UpdateContractAddresses {
        /// Dispute game contract address
        dispute_game_address: Option<[u8; 32]>,
        
        /// Fraud proof system address
        fraud_proof_system_address: Option<[u8; 32]>,
    },
}

/// Process finalization instruction
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction: &FinalizationInstruction,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    
    match instruction {
        FinalizationInstruction::Initialize {
            challenge_period,
            min_blocks_before_finalization,
            max_challenges_per_block,
        } => {
            // Get the owner account
            let owner_info = next_account_info(account_info_iter)?;
            
            // Check if the owner is a signer
            if !owner_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the finalization account
            let finalization_info = next_account_info(account_info_iter)?;
            
            // Check if the finalization account is owned by the program
            if finalization_info.owner != program_id {
                return Err(ProgramError::IncorrectProgramId);
            }
            
            // Create the configuration
            let config = FinalizationConfig {
                challenge_period: *challenge_period,
                min_blocks_before_finalization: *min_blocks_before_finalization,
                max_challenges_per_block: *max_challenges_per_block,
                dispute_game_address: None,
                fraud_proof_system_address: None,
            };
            
            // Create the RBAC
            let rbac = FinalizationRBAC::new(*owner_info.key);
            
            // Create the finalization manager
            let mut manager = FinalizationManager::with_config_and_rbac(config, rbac);
            
            // Initialize the manager
            manager.initialize(program_id, accounts)?;
            
            // In a real implementation, we would serialize the manager to the finalization account
            // For now, we just log the initialization
            msg!("Finalization system initialized with challenge period: {}", challenge_period);
            
            Ok(())
        },
        FinalizationInstruction::Update => {
            // Get the finalization account
            let finalization_info = next_account_info(account_info_iter)?;
            
            // Check if the finalization account is owned by the program
            if finalization_info.owner != program_id {
                return Err(ProgramError::IncorrectProgramId);
            }
            
            // In a real implementation, we would:
            // 1. Deserialize the finalization manager from the finalization account
            // 2. Update the manager
            // 3. Serialize the updated manager to the finalization account
            
            // For now, we just log the update
            msg!("Finalization system updated");
            
            Ok(())
        },
        FinalizationInstruction::BlockFinalization(block_finalization_instruction) => {
            block_finalization::process_instruction(program_id, accounts, block_finalization_instruction)
        },
        FinalizationInstruction::StateCommitment(state_commitment_instruction) => {
            state_commitment::process_instruction(program_id, accounts, state_commitment_instruction)
        },
        FinalizationInstruction::OutputOracle(output_oracle_instruction) => {
            output_oracle::process_instruction(program_id, accounts, output_oracle_instruction)
        },
        FinalizationInstruction::AddProposer { proposer } => {
            // Get the owner account
            let owner_info = next_account_info(account_info_iter)?;
            
            // Check if the owner is a signer
            if !owner_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the finalization account
            let finalization_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the finalization manager from the finalization account
            // 2. Check if the signer is the owner
            // 3. Add the proposer
            // 4. Serialize the updated manager to the finalization account
            
            // For now, we just log the addition
            msg!("Added proposer: {}", proposer);
            
            Ok(())
        },
        FinalizationInstruction::RemoveProposer { proposer } => {
            // Get the owner account
            let owner_info = next_account_info(account_info_iter)?;
            
            // Check if the owner is a signer
            if !owner_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the finalization account
            let finalization_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the finalization manager from the finalization account
            // 2. Check if the signer is the owner
            // 3. Remove the proposer
            // 4. Serialize the updated manager to the finalization account
            
            // For now, we just log the removal
            msg!("Removed proposer: {}", proposer);
            
            Ok(())
        },
        FinalizationInstruction::AddChallenger { challenger } => {
            // Get the owner account
            let owner_info = next_account_info(account_info_iter)?;
            
            // Check if the owner is a signer
            if !owner_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the finalization account
            let finalization_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the finalization manager from the finalization account
            // 2. Check if the signer is the owner
            // 3. Add the challenger
            // 4. Serialize the updated manager to the finalization account
            
            // For now, we just log the addition
            msg!("Added challenger: {}", challenger);
            
            Ok(())
        },
        FinalizationInstruction::RemoveChallenger { challenger } => {
            // Get the owner account
            let owner_info = next_account_info(account_info_iter)?;
            
            // Check if the owner is a signer
            if !owner_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the finalization account
            let finalization_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the finalization manager from the finalization account
            // 2. Check if the signer is the owner
            // 3. Remove the challenger
            // 4. Serialize the updated manager to the finalization account
            
            // For now, we just log the removal
            msg!("Removed challenger: {}", challenger);
            
            Ok(())
        },
        FinalizationInstruction::AddValidator { validator } => {
            // Get the owner account
            let owner_info = next_account_info(account_info_iter)?;
            
            // Check if the owner is a signer
            if !owner_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the finalization account
            let finalization_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the finalization manager from the finalization account
            // 2. Check if the signer is the owner
            // 3. Add the validator
            // 4. Serialize the updated manager to the finalization account
            
            // For now, we just log the addition
            msg!("Added validator: {}", validator);
            
            Ok(())
        },
        FinalizationInstruction::RemoveValidator { validator } => {
            // Get the owner account
            let owner_info = next_account_info(account_info_iter)?;
            
            // Check if the owner is a signer
            if !owner_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the finalization account
            let finalization_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the finalization manager from the finalization account
            // 2. Check if the signer is the owner
            // 3. Remove the validator
            // 4. Serialize the updated manager to the finalization account
            
            // For now, we just log the removal
            msg!("Removed validator: {}", validator);
            
            Ok(())
        },
        FinalizationInstruction::UpdateContractAddresses {
            dispute_game_address,
            fraud_proof_system_address,
        } => {
            // Get the owner account
            let owner_info = next_account_info(account_info_iter)?;
            
            // Check if the owner is a signer
            if !owner_info.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Get the finalization account
            let finalization_info = next_account_info(account_info_iter)?;
            
            // In a real implementation, we would:
            // 1. Deserialize the finalization manager from the finalization account
            // 2. Check if the signer is the owner
            // 3. Update the contract addresses
            // 4. Serialize the updated manager to the finalization account
            
            // For now, we just log the update
            msg!("Updated contract addresses");
            
            Ok(())
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
        assert_eq!(finalization_manager.config.challenge_period, challenge_period);
    }
    
    #[test]
    fn test_finalization_rbac() {
        // Create an RBAC with a test owner
        let owner = Pubkey::new_unique();
        let mut rbac = FinalizationRBAC::new(owner);
        
        // Test owner checks
        assert!(rbac.is_owner(&owner));
        assert!(!rbac.is_owner(&Pubkey::new_unique()));
        
        // Test proposer management
        let proposer = Pubkey::new_unique();
        rbac.add_proposer(proposer);
        assert!(rbac.is_proposer(&proposer));
        rbac.remove_proposer(&proposer);
        assert!(!rbac.is_proposer(&proposer));
        
        // Test challenger management
        let challenger = Pubkey::new_unique();
        rbac.add_challenger(challenger);
        assert!(rbac.is_challenger(&challenger));
        rbac.remove_challenger(&challenger);
        assert!(!rbac.is_challenger(&challenger));
        
        // Test validator management
        let validator = Pubkey::new_unique();
        rbac.add_validator(validator);
        assert!(rbac.is_validator(&validator));
        rbac.remove_validator(&validator);
        assert!(!rbac.is_validator(&validator));
    }
    
    #[test]
    fn test_finalization_config() {
        // Create a default configuration
        let config = FinalizationConfig::new();
        assert_eq!(config.challenge_period, 7 * 24 * 60 * 60);
        
        // Create a configuration with a custom challenge period
        let custom_period = 3 * 24 * 60 * 60; // 3 days
        let custom_config = FinalizationConfig::with_challenge_period(custom_period);
        assert_eq!(custom_config.challenge_period, custom_period);
    }
}
