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
use thiserror::Error;
use std::time::{SystemTime, UNIX_EPOCH};

/// Error types for finalization operations
#[derive(Error, Debug, Clone, PartialEq, Eq)]
pub enum FinalizationError {
    /// Invalid block number
    #[error("Invalid block number: {0}")]
    InvalidBlockNumber(String),
    
    /// Block not found
    #[error("Block not found: {0}")]
    BlockNotFound(String),
    
    /// Invalid block status
    #[error("Invalid block status: {0}")]
    InvalidBlockStatus(String),
    
    /// Challenge deadline passed
    #[error("Challenge deadline passed: {0}")]
    ChallengeDeadlinePassed(String),
    
    /// Invalid challenge index
    #[error("Invalid challenge index: {0}")]
    InvalidChallengeIndex(String),
    
    /// Invalid state commitment
    #[error("Invalid state commitment: {0}")]
    InvalidStateCommitment(String),
    
    /// Invalid L2 output
    #[error("Invalid L2 output: {0}")]
    InvalidL2Output(String),
    
    /// Unauthorized access
    #[error("Unauthorized access: {0}")]
    Unauthorized(String),
    
    /// System time error
    #[error("System time error: {0}")]
    SystemTimeError(String),
    
    /// Generic error
    #[error("Generic error: {0}")]
    GenericError(String),
}

impl From<std::time::SystemTimeError> for FinalizationError {
    fn from(error: std::time::SystemTimeError) -> Self {
        FinalizationError::SystemTimeError(error.to_string())
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
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)?
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
            return Err(FinalizationError::Unauthorized("Proposer not authorized".to_string()));
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
            return Err(FinalizationError::Unauthorized("Challenger not authorized".to_string()));
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
            return Err(FinalizationError::Unauthorized("Validator not authorized".to_string()));
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
            return Err(FinalizationError::Unauthorized("Proposer not authorized".to_string()));
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
            return Err(FinalizationError::Unauthorized("Proposer not authorized".to_string()));
        }
        
        // Get the current timestamp
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)?
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
    
    // Get the system account
    let system_account = next_account_info(account_info_iter)?;
    
    // Create or get the finalization manager
    let mut finalization_manager = FinalizationManager::new(0);
    
    match instruction {
        FinalizationInstruction::Initialize {
            challenge_period,
            min_blocks_before_finalization,
            max_challenges_per_block,
        } => {
            // Create a new configuration
            let config = FinalizationConfig {
                challenge_period: *challenge_period,
                min_blocks_before_finalization: *min_blocks_before_finalization,
                max_challenges_per_block: *max_challenges_per_block,
                dispute_game_address: None,
                fraud_proof_system_address: None,
            };
            
            // Create a new RBAC with the system account as the owner
            let rbac = FinalizationRBAC::new(*system_account.key);
            
            // Create a new finalization manager with the configuration and RBAC
            finalization_manager = FinalizationManager::with_config_and_rbac(config, rbac);
            
            // Initialize the finalization manager
            finalization_manager.initialize(program_id, accounts)?;
            
            msg!("Finalization system initialized");
            
            Ok(())
        },
        FinalizationInstruction::Update => {
            // Update the finalization manager
            finalization_manager.update()
                .map_err(|e| {
                    msg!("Error updating finalization manager: {}", e);
                    ProgramError::Custom(1)
                })?;
            
            msg!("Finalization system updated");
            
            Ok(())
        },
        FinalizationInstruction::BlockFinalization(block_instruction) => {
            // Process the block finalization instruction
            block_finalization::process_instruction(program_id, accounts, block_instruction)
        },
        FinalizationInstruction::StateCommitment(state_instruction) => {
            // Process the state commitment instruction
            state_commitment::process_instruction(program_id, accounts, state_instruction)
        },
        FinalizationInstruction::OutputOracle(output_instruction) => {
            // Process the L2 output oracle instruction
            output_oracle::process_instruction(program_id, accounts, output_instruction)
        },
        FinalizationInstruction::AddProposer { proposer } => {
            // Get the owner account
            let owner_account = next_account_info(account_info_iter)?;
            
            // Verify the owner account is a signer
            if !owner_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Verify the owner account is the owner of the finalization system
            if !finalization_manager.rbac.is_owner(owner_account.key) {
                return Err(ProgramError::InvalidAccountData);
            }
            
            // Add the proposer
            finalization_manager.rbac.add_proposer(*proposer);
            
            msg!("Added proposer: {}", proposer);
            
            Ok(())
        },
        FinalizationInstruction::RemoveProposer { proposer } => {
            // Get the owner account
            let owner_account = next_account_info(account_info_iter)?;
            
            // Verify the owner account is a signer
            if !owner_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Verify the owner account is the owner of the finalization system
            if !finalization_manager.rbac.is_owner(owner_account.key) {
                return Err(ProgramError::InvalidAccountData);
            }
            
            // Remove the proposer
            finalization_manager.rbac.remove_proposer(proposer);
            
            msg!("Removed proposer: {}", proposer);
            
            Ok(())
        },
        FinalizationInstruction::AddChallenger { challenger } => {
            // Get the owner account
            let owner_account = next_account_info(account_info_iter)?;
            
            // Verify the owner account is a signer
            if !owner_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Verify the owner account is the owner of the finalization system
            if !finalization_manager.rbac.is_owner(owner_account.key) {
                return Err(ProgramError::InvalidAccountData);
            }
            
            // Add the challenger
            finalization_manager.rbac.add_challenger(*challenger);
            
            msg!("Added challenger: {}", challenger);
            
            Ok(())
        },
        FinalizationInstruction::RemoveChallenger { challenger } => {
            // Get the owner account
            let owner_account = next_account_info(account_info_iter)?;
            
            // Verify the owner account is a signer
            if !owner_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Verify the owner account is the owner of the finalization system
            if !finalization_manager.rbac.is_owner(owner_account.key) {
                return Err(ProgramError::InvalidAccountData);
            }
            
            // Remove the challenger
            finalization_manager.rbac.remove_challenger(challenger);
            
            msg!("Removed challenger: {}", challenger);
            
            Ok(())
        },
        FinalizationInstruction::AddValidator { validator } => {
            // Get the owner account
            let owner_account = next_account_info(account_info_iter)?;
            
            // Verify the owner account is a signer
            if !owner_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Verify the owner account is the owner of the finalization system
            if !finalization_manager.rbac.is_owner(owner_account.key) {
                return Err(ProgramError::InvalidAccountData);
            }
            
            // Add the validator
            finalization_manager.rbac.add_validator(*validator);
            
            msg!("Added validator: {}", validator);
            
            Ok(())
        },
        FinalizationInstruction::RemoveValidator { validator } => {
            // Get the owner account
            let owner_account = next_account_info(account_info_iter)?;
            
            // Verify the owner account is a signer
            if !owner_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Verify the owner account is the owner of the finalization system
            if !finalization_manager.rbac.is_owner(owner_account.key) {
                return Err(ProgramError::InvalidAccountData);
            }
            
            // Remove the validator
            finalization_manager.rbac.remove_validator(validator);
            
            msg!("Removed validator: {}", validator);
            
            Ok(())
        },
        FinalizationInstruction::UpdateContractAddresses {
            dispute_game_address,
            fraud_proof_system_address,
        } => {
            // Get the owner account
            let owner_account = next_account_info(account_info_iter)?;
            
            // Verify the owner account is a signer
            if !owner_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Verify the owner account is the owner of the finalization system
            if !finalization_manager.rbac.is_owner(owner_account.key) {
                return Err(ProgramError::InvalidAccountData);
            }
            
            // Update the contract addresses
            finalization_manager.config.dispute_game_address = *dispute_game_address;
            finalization_manager.config.fraud_proof_system_address = *fraud_proof_system_address;
            
            msg!("Updated contract addresses");
            
            Ok(())
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_finalization_rbac() {
        // Create a new RBAC with a test owner
        let owner = Pubkey::new_unique();
        let mut rbac = FinalizationRBAC::new(owner);
        
        // Test owner checks
        assert!(rbac.is_owner(&owner));
        assert!(!rbac.is_owner(&Pubkey::new_unique()));
        
        // Test proposer checks
        let proposer = Pubkey::new_unique();
        assert!(!rbac.is_proposer(&proposer));
        rbac.add_proposer(proposer);
        assert!(rbac.is_proposer(&proposer));
        rbac.remove_proposer(&proposer);
        assert!(!rbac.is_proposer(&proposer));
        
        // Test challenger checks
        let challenger = Pubkey::new_unique();
        assert!(!rbac.is_challenger(&challenger));
        rbac.add_challenger(challenger);
        assert!(rbac.is_challenger(&challenger));
        rbac.remove_challenger(&challenger);
        assert!(!rbac.is_challenger(&challenger));
        
        // Test validator checks
        let validator = Pubkey::new_unique();
        assert!(!rbac.is_validator(&validator));
        rbac.add_validator(validator);
        assert!(rbac.is_validator(&validator));
        rbac.remove_validator(&validator);
        assert!(!rbac.is_validator(&validator));
    }
    
    #[test]
    fn test_finalization_config() {
        // Test default configuration
        let config = FinalizationConfig::new();
        assert_eq!(config.challenge_period, 7 * 24 * 60 * 60);
        assert_eq!(config.min_blocks_before_finalization, 10);
        assert_eq!(config.max_challenges_per_block, 5);
        assert_eq!(config.dispute_game_address, None);
        assert_eq!(config.fraud_proof_system_address, None);
        
        // Test configuration with custom challenge period
        let challenge_period = 3600;
        let config = FinalizationConfig::with_challenge_period(challenge_period);
        assert_eq!(config.challenge_period, challenge_period);
    }
    
    // Additional tests would be added here to test the finalization manager
}
