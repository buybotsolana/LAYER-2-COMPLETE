// src/advanced_architecture/consensus.rs
//! Enhanced Consensus module for Layer-2 on Solana
//! 
//! This module implements an enhanced consensus mechanism for the Layer-2 solution:
//! - Optimistic rollup with fraud proofs
//! - Sequencer selection and rotation
//! - Proposer-Builder Separation (PBS) for MEV mitigation
//! - Stake-based validator selection
//! - Slashing conditions for malicious behavior
//!
//! The consensus mechanism is designed to be secure, efficient, and resistant to
//! various attack vectors while maintaining high throughput.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::{HashMap, VecDeque};
use thiserror::Error;

/// Errors that may occur during consensus operations
#[derive(Error, Debug, Clone, PartialEq, Eq)]
pub enum ConsensusError {
    /// Consensus system is not initialized
    #[error("Consensus system is not initialized")]
    NotInitialized,
    
    /// Participant already exists
    #[error("Participant already exists: {0}")]
    ParticipantAlreadyExists(String),
    
    /// Participant does not exist
    #[error("Participant does not exist: {0}")]
    ParticipantDoesNotExist(String),
    
    /// Insufficient stake for role
    #[error("Insufficient stake for role {0}: required {1}, provided {2}")]
    InsufficientStake(String, u64, u64),
    
    /// Maximum number of participants reached for role
    #[error("Maximum number of participants reached for role {0}: limit {1}")]
    MaxParticipantsReached(String, u32),
    
    /// No active sequencers
    #[error("No active sequencers available")]
    NoActiveSequencers,
    
    /// No active validators
    #[error("No active validators available")]
    NoActiveValidators,
    
    /// No active builders
    #[error("No active builders available")]
    NoActiveBuilders,
    
    /// No active proposers
    #[error("No active proposers available")]
    NoActiveProposers,
    
    /// Invalid block
    #[error("Invalid block: {0}")]
    InvalidBlock(String),
    
    /// Block already exists
    #[error("Block already exists: {0}")]
    BlockAlreadyExists(String),
    
    /// Block does not exist
    #[error("Block does not exist: {0}")]
    BlockDoesNotExist(String),
    
    /// Invalid block status transition
    #[error("Invalid block status transition from {0} to {1}")]
    InvalidBlockStatusTransition(String, String),
    
    /// Challenge period not expired
    #[error("Challenge period not expired for block {0}: expires at {1}, current time {2}")]
    ChallengePeriodNotExpired(String, u64, u64),
    
    /// Challenge period expired
    #[error("Challenge period expired for block {0}: expired at {1}, current time {2}")]
    ChallengePeriodExpired(String, u64, u64),
    
    /// Unauthorized operation
    #[error("Unauthorized operation: {0}")]
    Unauthorized(String),
    
    /// Invalid role for operation
    #[error("Invalid role for operation: required {0}, provided {1}")]
    InvalidRole(String, String),
    
    /// Invalid configuration
    #[error("Invalid configuration: {0}")]
    InvalidConfiguration(String),
    
    /// Generic error
    #[error("Generic error: {0}")]
    GenericError(String),
}

impl From<ProgramError> for ConsensusError {
    fn from(error: ProgramError) -> Self {
        ConsensusError::GenericError(error.to_string())
    }
}

/// Consensus role enumeration
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq, Eq)]
pub enum ConsensusRole {
    /// Sequencer role (proposes blocks)
    Sequencer,
    
    /// Validator role (validates blocks)
    Validator,
    
    /// Builder role (builds blocks with transactions)
    Builder,
    
    /// Proposer role (proposes blocks built by builders)
    Proposer,
    
    /// Challenger role (submits fraud proofs)
    Challenger,
}

impl ToString for ConsensusRole {
    fn to_string(&self) -> String {
        match self {
            ConsensusRole::Sequencer => "Sequencer".to_string(),
            ConsensusRole::Validator => "Validator".to_string(),
            ConsensusRole::Builder => "Builder".to_string(),
            ConsensusRole::Proposer => "Proposer".to_string(),
            ConsensusRole::Challenger => "Challenger".to_string(),
        }
    }
}

/// Consensus parameters
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct ConsensusParameters {
    /// Minimum stake required for sequencers
    pub min_sequencer_stake: u64,
    
    /// Minimum stake required for validators
    pub min_validator_stake: u64,
    
    /// Minimum stake required for builders
    pub min_builder_stake: u64,
    
    /// Minimum stake required for proposers
    pub min_proposer_stake: u64,
    
    /// Minimum stake required for challengers
    pub min_challenger_stake: u64,
    
    /// Maximum number of sequencers
    pub max_sequencers: u32,
    
    /// Maximum number of validators
    pub max_validators: u32,
    
    /// Maximum number of builders
    pub max_builders: u32,
    
    /// Maximum number of proposers
    pub max_proposers: u32,
    
    /// Sequencer rotation interval (in blocks)
    pub sequencer_rotation_interval: u64,
    
    /// Challenge period (in seconds)
    pub challenge_period: u64,
    
    /// Slashing percentage for malicious behavior (in basis points)
    pub slashing_percentage: u32,
    
    /// Reward percentage for honest behavior (in basis points)
    pub reward_percentage: u32,
}

impl Default for ConsensusParameters {
    fn default() -> Self {
        Self {
            min_sequencer_stake: 100_000_000_000, // 1,000 SOL (assuming 8 decimals)
            min_validator_stake: 10_000_000_000,  // 100 SOL
            min_builder_stake: 50_000_000_000,    // 500 SOL
            min_proposer_stake: 50_000_000_000,   // 500 SOL
            min_challenger_stake: 10_000_000_000, // 100 SOL
            max_sequencers: 10,
            max_validators: 100,
            max_builders: 20,
            max_proposers: 20,
            sequencer_rotation_interval: 100,     // Rotate every 100 blocks
            challenge_period: 604800,             // 7 days in seconds
            slashing_percentage: 1000,            // 10%
            reward_percentage: 500,               // 5%
        }
    }
}

/// Consensus configuration
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct ConsensusConfig {
    /// Consensus parameters
    pub parameters: ConsensusParameters,
    
    /// Whether to use Proposer-Builder Separation
    pub use_pbs: bool,
    
    /// Whether to enable slashing
    pub enable_slashing: bool,
    
    /// Whether to enable rewards
    pub enable_rewards: bool,
    
    /// Whether to enable sequencer rotation
    pub enable_sequencer_rotation: bool,
    
    /// Whether to enable permissionless validation
    pub permissionless_validation: bool,
}

impl Default for ConsensusConfig {
    fn default() -> Self {
        Self {
            parameters: ConsensusParameters::default(),
            use_pbs: true,
            enable_slashing: true,
            enable_rewards: true,
            enable_sequencer_rotation: true,
            permissionless_validation: true,
        }
    }
}

impl ConsensusConfig {
    /// Validate the consensus configuration
    pub fn validate(&self) -> Result<(), ConsensusError> {
        // Validate stake requirements
        if self.parameters.min_sequencer_stake == 0 {
            return Err(ConsensusError::InvalidConfiguration(
                "Minimum sequencer stake cannot be zero".to_string()
            ));
        }
        
        if self.parameters.min_validator_stake == 0 {
            return Err(ConsensusError::InvalidConfiguration(
                "Minimum validator stake cannot be zero".to_string()
            ));
        }
        
        if self.use_pbs {
            if self.parameters.min_builder_stake == 0 {
                return Err(ConsensusError::InvalidConfiguration(
                    "Minimum builder stake cannot be zero when PBS is enabled".to_string()
                ));
            }
            
            if self.parameters.min_proposer_stake == 0 {
                return Err(ConsensusError::InvalidConfiguration(
                    "Minimum proposer stake cannot be zero when PBS is enabled".to_string()
                ));
            }
        }
        
        // Validate max participants
        if self.parameters.max_sequencers == 0 {
            return Err(ConsensusError::InvalidConfiguration(
                "Maximum number of sequencers cannot be zero".to_string()
            ));
        }
        
        if self.parameters.max_validators == 0 {
            return Err(ConsensusError::InvalidConfiguration(
                "Maximum number of validators cannot be zero".to_string()
            ));
        }
        
        if self.use_pbs {
            if self.parameters.max_builders == 0 {
                return Err(ConsensusError::InvalidConfiguration(
                    "Maximum number of builders cannot be zero when PBS is enabled".to_string()
                ));
            }
            
            if self.parameters.max_proposers == 0 {
                return Err(ConsensusError::InvalidConfiguration(
                    "Maximum number of proposers cannot be zero when PBS is enabled".to_string()
                ));
            }
        }
        
        // Validate rotation interval
        if self.enable_sequencer_rotation && self.parameters.sequencer_rotation_interval == 0 {
            return Err(ConsensusError::InvalidConfiguration(
                "Sequencer rotation interval cannot be zero when rotation is enabled".to_string()
            ));
        }
        
        // Validate challenge period
        if self.parameters.challenge_period == 0 {
            return Err(ConsensusError::InvalidConfiguration(
                "Challenge period cannot be zero".to_string()
            ));
        }
        
        // Validate slashing and reward percentages
        if self.enable_slashing && self.parameters.slashing_percentage == 0 {
            return Err(ConsensusError::InvalidConfiguration(
                "Slashing percentage cannot be zero when slashing is enabled".to_string()
            ));
        }
        
        if self.enable_slashing && self.parameters.slashing_percentage > 10000 {
            return Err(ConsensusError::InvalidConfiguration(
                format!("Slashing percentage cannot exceed 10000 (100%), got {}", 
                        self.parameters.slashing_percentage)
            ));
        }
        
        if self.enable_rewards && self.parameters.reward_percentage == 0 {
            return Err(ConsensusError::InvalidConfiguration(
                "Reward percentage cannot be zero when rewards are enabled".to_string()
            ));
        }
        
        if self.enable_rewards && self.parameters.reward_percentage > 10000 {
            return Err(ConsensusError::InvalidConfiguration(
                format!("Reward percentage cannot exceed 10000 (100%), got {}", 
                        self.parameters.reward_percentage)
            ));
        }
        
        Ok(())
    }
}

/// Participant in the consensus
#[derive(Debug, Clone)]
pub struct ConsensusParticipant {
    /// Public key of the participant
    pub pubkey: Pubkey,
    
    /// Role of the participant
    pub role: ConsensusRole,
    
    /// Stake amount
    pub stake: u64,
    
    /// Reputation score
    pub reputation: i64,
    
    /// Last active timestamp
    pub last_active: u64,
    
    /// Number of blocks proposed
    pub blocks_proposed: u64,
    
    /// Number of blocks validated
    pub blocks_validated: u64,
    
    /// Number of successful challenges
    pub successful_challenges: u64,
    
    /// Number of failed challenges
    pub failed_challenges: u64,
}

/// Block status enumeration
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockStatus {
    /// Block is proposed but not yet finalized
    Proposed,
    
    /// Block is challenged
    Challenged,
    
    /// Block is finalized
    Finalized,
    
    /// Block is rejected
    Rejected,
}

impl ToString for BlockStatus {
    fn to_string(&self) -> String {
        match self {
            BlockStatus::Proposed => "Proposed".to_string(),
            BlockStatus::Challenged => "Challenged".to_string(),
            BlockStatus::Finalized => "Finalized".to_string(),
            BlockStatus::Rejected => "Rejected".to_string(),
        }
    }
}

/// Block in the Layer-2 chain
#[derive(Debug, Clone)]
pub struct Block {
    /// Block number
    pub number: u64,
    
    /// Block hash
    pub hash: [u8; 32],
    
    /// Parent block hash
    pub parent_hash: [u8; 32],
    
    /// State root
    pub state_root: [u8; 32],
    
    /// Transactions root
    pub transactions_root: [u8; 32],
    
    /// Receipts root
    pub receipts_root: [u8; 32],
    
    /// Timestamp
    pub timestamp: u64,
    
    /// Sequencer that proposed the block
    pub sequencer: Pubkey,
    
    /// Builder that built the block (if using PBS)
    pub builder: Option<Pubkey>,
    
    /// Proposer that proposed the block (if using PBS)
    pub proposer: Option<Pubkey>,
    
    /// Block status
    pub status: BlockStatus,
    
    /// Challenge deadline
    pub challenge_deadline: u64,
    
    /// Challenges against this block
    pub challenges: Vec<Pubkey>,
}

impl Block {
    /// Get a string representation of the block hash
    pub fn hash_string(&self) -> String {
        hex::encode(self.hash)
    }
    
    /// Check if the block can be finalized
    pub fn can_finalize(&self, current_time: u64) -> bool {
        self.status == BlockStatus::Proposed && current_time >= self.challenge_deadline
    }
    
    /// Check if the block can be challenged
    pub fn can_challenge(&self, current_time: u64) -> bool {
        self.status == BlockStatus::Proposed && current_time < self.challenge_deadline
    }
}

/// Enhanced consensus for the Layer-2 solution
pub struct EnhancedConsensus {
    /// Consensus configuration
    config: ConsensusConfig,
    
    /// Participants in the consensus
    participants: HashMap<Pubkey, ConsensusParticipant>,
    
    /// Active sequencers
    active_sequencers: VecDeque<Pubkey>,
    
    /// Active validators
    active_validators: Vec<Pubkey>,
    
    /// Active builders
    active_builders: Vec<Pubkey>,
    
    /// Active proposers
    active_proposers: Vec<Pubkey>,
    
    /// Blocks in the chain
    blocks: HashMap<[u8; 32], Block>,
    
    /// Latest finalized block
    latest_finalized_block: Option<[u8; 32]>,
    
    /// Current sequencer
    current_sequencer: Option<Pubkey>,
    
    /// Current block number
    current_block_number: u64,
    
    /// Whether the consensus is initialized
    initialized: bool,
}

impl EnhancedConsensus {
    /// Create a new enhanced consensus with default configuration
    pub fn new() -> Self {
        Self {
            config: ConsensusConfig::default(),
            participants: HashMap::new(),
            active_sequencers: VecDeque::new(),
            active_validators: Vec::new(),
            active_builders: Vec::new(),
            active_proposers: Vec::new(),
            blocks: HashMap::new(),
            latest_finalized_block: None,
            current_sequencer: None,
            current_block_number: 0,
            initialized: false,
        }
    }
    
    /// Create a new enhanced consensus with the specified configuration
    pub fn with_config(config: ConsensusConfig) -> Result<Self, ConsensusError> {
        // Validate the configuration
        config.validate()?;
        
        Ok(Self {
            config,
            participants: HashMap::new(),
            active_sequencers: VecDeque::new(),
            active_validators: Vec::new(),
            active_builders: Vec::new(),
            active_proposers: Vec::new(),
            blocks: HashMap::new(),
            latest_finalized_block: None,
            current_sequencer: None,
            current_block_number: 0,
            initialized: false,
        })
    }
    
    /// Initialize the enhanced consensus
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> Result<(), ConsensusError> {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)
            .map_err(|e| ConsensusError::GenericError(e.to_string()))?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ConsensusError::Unauthorized(
                "System account is not owned by the program".to_string()
            ));
        }
        
        // Validate the configuration
        self.config.validate()?;
        
        // Initialize the genesis block
        let genesis_block = Block {
            number: 0,
            hash: [0; 32],
            parent_hash: [0; 32],
            state_root: [0; 32],
            transactions_root: [0; 32],
            receipts_root: [0; 32],
            timestamp: 0,
            sequencer: *system_account.key,
            builder: None,
            proposer: None,
            status: BlockStatus::Finalized,
            challenge_deadline: 0,
            challenges: Vec::new(),
        };
        
        // Add the genesis block
        self.blocks.insert(genesis_block.hash, genesis_block.clone());
        self.latest_finalized_block = Some(genesis_block.hash);
        self.current_block_number = 1;
        
        self.initialized = true;
        
        msg!("Enhanced consensus initialized");
        
        Ok(())
    }
    
    /// Check if the enhanced consensus is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Register a participant in the consensus
    pub fn register_participant(&mut self, pubkey: Pubkey, role: ConsensusRole, stake: u64) -> Result<(), ConsensusError> {
        if !self.initialized {
            return Err(ConsensusError::NotInitialized);
        }
        
        // Check if the participant already exists
        if self.participants.contains_key(&pubkey) {
            return Err(ConsensusError::ParticipantAlreadyExists(
                format!("{:?}", pubkey)
            ));
        }
        
        // Check if the stake is sufficient for the role
        match role {
            ConsensusRole::Sequencer => {
                if stake < self.config.parameters.min_sequencer_stake {
                    return Err(ConsensusError::InsufficientStake(
                        role.to_string(),
                        self.config.parameters.min_sequencer_stake,
                        stake
                    ));
                }
                
                // Check if the maximum number of sequencers is reached
                if self.active_sequencers.len() >= self.config.parameters.max_sequencers as usize {
                    return Err(ConsensusError::MaxParticipantsReached(
                        role.to_string(),
                        self.config.parameters.max_sequencers
                    ));
                }
                
                // Add the sequencer to the active sequencers
                self.active_sequencers.push_back(pubkey);
            },
            ConsensusRole::Validator => {
                if stake < self.config.parameters.min_validator_stake {
                    return Err(ConsensusError::InsufficientStake(
                        role.to_string(),
                        self.config.parameters.min_validator_stake,
                        stake
                    ));
                }
                
                // Check if the maximum number of validators is reached
                if self.active_validators.len() >= self.config.parameters.max_validators as usize {
                    return Err(ConsensusError::MaxParticipantsReached(
                        role.to_string(),
                        self.config.parameters.max_validators
                    ));
                }
                
                // Add the validator to the active validators
                self.active_validators.push(pubkey);
            },
            ConsensusRole::Builder => {
                if stake < self.config.parameters.min_builder_stake {
                    return Err(ConsensusError::InsufficientStake(
                        role.to_string(),
                        self.config.parameters.min_builder_stake,
                        stake
                    ));
                }
                
                // Check if the maximum number of builders is reached
                if self.active_builders.len() >= self.config.parameters.max_builders as usize {
                    return Err(ConsensusError::MaxParticipantsReached(
                        role.to_string(),
                        self.config.parameters.max_builders
                    ));
                }
                
                // Add the builder to the active builders
                self.active_builders.push(pubkey);
            },
            ConsensusRole::Proposer => {
                if stake < self.config.parameters.min_proposer_stake {
                    return Err(ConsensusError::InsufficientStake(
                        role.to_string(),
                        self.config.parameters.min_proposer_stake,
                        stake
                    ));
                }
                
                // Check if the maximum number of proposers is reached
                if self.active_proposers.len() >= self.config.parameters.max_proposers as usize {
                    return Err(ConsensusError::MaxParticipantsReached(
                        role.to_string(),
                        self.config.parameters.max_proposers
                    ));
                }
                
                // Add the proposer to the active proposers
                self.active_proposers.push(pubkey);
            },
            ConsensusRole::Challenger => {
                if stake < self.config.parameters.min_challenger_stake {
                    return Err(ConsensusError::InsufficientStake(
                        role.to_string(),
                        self.config.parameters.min_challenger_stake,
                        stake
                    ));
                }
            },
        }
        
        // Create the participant
        let participant = ConsensusParticipant {
            pubkey,
            role: role.clone(),
            stake,
            reputation: 0,
            last_active: 0,
            blocks_proposed: 0,
            blocks_validated: 0,
            successful_challenges: 0,
            failed_challenges: 0,
        };
        
        // Add the participant
        self.participants.insert(pubkey, participant);
        
        // If this is the first sequencer, set it as the current sequencer
        if role == ConsensusRole::Sequencer && self.current_sequencer.is_none() {
            self.current_sequencer = Some(pubkey);
        }
        
        msg!("Participant registered: {:?}, role: {:?}, stake: {}", pubkey, role, stake);
        
        Ok(())
    }
    
    /// Unregister a participant from the consensus
    pub fn unregister_participant(&mut self, pubkey: &Pubkey) -> Result<(), ConsensusError> {
        if !self.initialized {
            return Err(ConsensusError::NotInitialized);
        }
        
        // Check if the participant exists
        let participant = self.participants.get(pubkey)
            .ok_or_else(|| ConsensusError::ParticipantDoesNotExist(
                format!("{:?}", pubkey)
            ))?;
        
        // Remove the participant from the active list based on their role
        match participant.role {
            ConsensusRole::Sequencer => {
                self.active_sequencers.retain(|&p| p != *pubkey);
                
                // If this was the current sequencer, select a new one
                if self.current_sequencer == Some(*pubkey) {
                    self.current_sequencer = self.active_sequencers.front().cloned();
                }
            },
            ConsensusRole::Validator => {
                self.active_validators.retain(|&p| p != *pubkey);
            },
            ConsensusRole::Builder => {
                self.active_builders.retain(|&p| p != *pubkey);
            },
            ConsensusRole::Proposer => {
                self.active_proposers.retain(|&p| p != *pubkey);
            },
            ConsensusRole::Challenger => {
                // No active list for challengers
            },
        }
        
        // Remove the participant
        self.participants.remove(pubkey);
        
        msg!("Participant unregistered: {:?}", pubkey);
        
        Ok(())
    }
    
    /// Rotate the current sequencer
    pub fn rotate_sequencer(&mut self) -> Result<(), ConsensusError> {
        if !self.initialized {
            return Err(ConsensusError::NotInitialized);
        }
        
        // Check if sequencer rotation is enabled
        if !self.config.enable_sequencer_rotation {
            return Ok(());
        }
        
        // Check if there are any sequencers
        if self.active_sequencers.is_empty() {
            return Err(ConsensusError::NoActiveSequencers);
        }
        
        // Rotate the sequencer
        if let Some(current_sequencer) = self.current_sequencer.take() {
            // Move the current sequencer to the back of the queue
            self.active_sequencers.retain(|&p| p != current_sequencer);
            self.active_sequencers.push_back(current_sequencer);
            
            // Set the new current sequencer
            self.current_sequencer = self.active_sequencers.front().cloned();
            
            if let Some(new_sequencer) = self.current_sequencer {
                msg!("Sequencer rotated from {:?} to {:?}", current_sequencer, new_sequencer);
            }
        } else {
            // No current sequencer, set the first one in the queue
            self.current_sequencer = self.active_sequencers.front().cloned();
            
            if let Some(new_sequencer) = self.current_sequencer {
                msg!("Sequencer set to {:?}", new_sequencer);
            }
        }
        
        Ok(())
    }
    
    /// Propose a new block
    pub fn propose_block(
        &mut self,
        proposer: &Pubkey,
        state_root: [u8; 32],
        transactions_root: [u8; 32],
        receipts_root: [u8; 32],
        timestamp: u64,
        builder: Option<&Pubkey>,
    ) -> Result<[u8; 32], ConsensusError> {
        if !self.initialized {
            return Err(ConsensusError::NotInitialized);
        }
        
        // Check if the proposer is the current sequencer or a valid proposer
        let is_sequencer = self.current_sequencer == Some(*proposer);
        let is_proposer = self.config.use_pbs && self.active_proposers.contains(proposer);
        
        if !is_sequencer && !is_proposer {
            return Err(ConsensusError::Unauthorized(
                format!("Proposer {:?} is not the current sequencer or a valid proposer", proposer)
            ));
        }
        
        // If using PBS, check if the builder is valid
        if self.config.use_pbs {
            if let Some(builder_key) = builder {
                if !self.active_builders.contains(builder_key) {
                    return Err(ConsensusError::Unauthorized(
                        format!("Builder {:?} is not a valid builder", builder_key)
                    ));
                }
            } else {
                return Err(ConsensusError::InvalidConfiguration(
                    "Builder must be specified when using PBS".to_string()
                ));
            }
        }
        
        // Get the latest finalized block
        let parent_hash = self.latest_finalized_block
            .ok_or_else(|| ConsensusError::GenericError("No finalized blocks".to_string()))?;
        
        // Create a new block hash (in a real implementation, this would be a cryptographic hash)
        let mut block_hash = [0u8; 32];
        let mut hasher = blake3::Hasher::new();
        hasher.update(&parent_hash);
        hasher.update(&state_root);
        hasher.update(&transactions_root);
        hasher.update(&receipts_root);
        hasher.update(&timestamp.to_le_bytes());
        hasher.update(&proposer.to_bytes());
        if let Some(builder_key) = builder {
            hasher.update(&builder_key.to_bytes());
        }
        block_hash.copy_from_slice(&hasher.finalize().as_bytes()[0..32]);
        
        // Check if a block with this hash already exists
        if self.blocks.contains_key(&block_hash) {
            return Err(ConsensusError::BlockAlreadyExists(
                hex::encode(block_hash)
            ));
        }
        
        // Calculate the challenge deadline
        let challenge_deadline = timestamp + self.config.parameters.challenge_period;
        
        // Create the new block
        let block = Block {
            number: self.current_block_number,
            hash: block_hash,
            parent_hash,
            state_root,
            transactions_root,
            receipts_root,
            timestamp,
            sequencer: if is_sequencer { *proposer } else { self.current_sequencer.unwrap() },
            builder: builder.cloned(),
            proposer: if is_proposer { Some(*proposer) } else { None },
            status: BlockStatus::Proposed,
            challenge_deadline,
            challenges: Vec::new(),
        };
        
        // Add the block to the chain
        self.blocks.insert(block_hash, block);
        
        // Increment the block number
        self.current_block_number += 1;
        
        // Update the participant stats
        if let Some(participant) = self.participants.get_mut(proposer) {
            participant.blocks_proposed += 1;
            participant.last_active = timestamp;
        }
        
        // If using PBS and a builder was specified, update the builder stats
        if let Some(builder_key) = builder {
            if let Some(builder_participant) = self.participants.get_mut(builder_key) {
                builder_participant.last_active = timestamp;
            }
        }
        
        // Check if we need to rotate the sequencer
        if self.config.enable_sequencer_rotation && 
           self.current_block_number % self.config.parameters.sequencer_rotation_interval == 0 {
            self.rotate_sequencer()?;
        }
        
        msg!("Block proposed: number {}, hash {}", self.current_block_number - 1, hex::encode(block_hash));
        
        Ok(block_hash)
    }
    
    /// Finalize a block
    pub fn finalize_block(&mut self, block_hash: &[u8; 32], current_time: u64) -> Result<(), ConsensusError> {
        if !self.initialized {
            return Err(ConsensusError::NotInitialized);
        }
        
        // Check if the block exists
        let block = self.blocks.get_mut(block_hash)
            .ok_or_else(|| ConsensusError::BlockDoesNotExist(
                hex::encode(*block_hash)
            ))?;
        
        // Check if the block can be finalized
        if block.status != BlockStatus::Proposed {
            return Err(ConsensusError::InvalidBlockStatusTransition(
                block.status.to_string(),
                BlockStatus::Finalized.to_string()
            ));
        }
        
        // Check if the challenge period has expired
        if current_time < block.challenge_deadline {
            return Err(ConsensusError::ChallengePeriodNotExpired(
                hex::encode(*block_hash),
                block.challenge_deadline,
                current_time
            ));
        }
        
        // Update the block status
        block.status = BlockStatus::Finalized;
        
        // Update the latest finalized block
        self.latest_finalized_block = Some(*block_hash);
        
        // Update the validator stats
        for validator in &self.active_validators {
            if let Some(participant) = self.participants.get_mut(validator) {
                participant.blocks_validated += 1;
                participant.last_active = current_time;
            }
        }
        
        msg!("Block finalized: number {}, hash {}", block.number, hex::encode(*block_hash));
        
        Ok(())
    }
    
    /// Challenge a block
    pub fn challenge_block(
        &mut self,
        challenger: &Pubkey,
        block_hash: &[u8; 32],
        current_time: u64,
        evidence: &[u8],
    ) -> Result<(), ConsensusError> {
        if !self.initialized {
            return Err(ConsensusError::NotInitialized);
        }
        
        // Check if the challenger is a valid challenger or validator
        let participant = self.participants.get(challenger)
            .ok_or_else(|| ConsensusError::ParticipantDoesNotExist(
                format!("{:?}", challenger)
            ))?;
        
        let is_challenger = participant.role == ConsensusRole::Challenger;
        let is_validator = participant.role == ConsensusRole::Validator;
        
        if !is_challenger && !is_validator {
            return Err(ConsensusError::InvalidRole(
                "Challenger or Validator".to_string(),
                participant.role.to_string()
            ));
        }
        
        // Check if the block exists
        let block = self.blocks.get_mut(block_hash)
            .ok_or_else(|| ConsensusError::BlockDoesNotExist(
                hex::encode(*block_hash)
            ))?;
        
        // Check if the block can be challenged
        if block.status != BlockStatus::Proposed {
            return Err(ConsensusError::InvalidBlockStatusTransition(
                block.status.to_string(),
                BlockStatus::Challenged.to_string()
            ));
        }
        
        // Check if the challenge period has expired
        if current_time >= block.challenge_deadline {
            return Err(ConsensusError::ChallengePeriodExpired(
                hex::encode(*block_hash),
                block.challenge_deadline,
                current_time
            ));
        }
        
        // In a real implementation, we would verify the evidence here
        // For now, we'll just accept the challenge
        
        // Update the block status
        block.status = BlockStatus::Challenged;
        
        // Add the challenger to the list of challengers
        block.challenges.push(*challenger);
        
        // Update the challenger stats
        if let Some(participant) = self.participants.get_mut(challenger) {
            participant.successful_challenges += 1;
            participant.last_active = current_time;
            
            // Increase the reputation
            participant.reputation += 10;
        }
        
        // If slashing is enabled, slash the sequencer
        if self.config.enable_slashing {
            if let Some(sequencer_participant) = self.participants.get_mut(&block.sequencer) {
                let slash_amount = (sequencer_participant.stake * self.config.parameters.slashing_percentage as u64) / 10000;
                sequencer_participant.stake = sequencer_participant.stake.saturating_sub(slash_amount);
                
                // Decrease the reputation
                sequencer_participant.reputation -= 20;
                
                msg!("Sequencer {:?} slashed: {} ({}%)", 
                     block.sequencer, slash_amount, self.config.parameters.slashing_percentage / 100);
            }
            
            // If using PBS and a builder was specified, slash the builder as well
            if let Some(builder) = block.builder {
                if let Some(builder_participant) = self.participants.get_mut(&builder) {
                    let slash_amount = (builder_participant.stake * self.config.parameters.slashing_percentage as u64) / 10000;
                    builder_participant.stake = builder_participant.stake.saturating_sub(slash_amount);
                    
                    // Decrease the reputation
                    builder_participant.reputation -= 20;
                    
                    msg!("Builder {:?} slashed: {} ({}%)", 
                         builder, slash_amount, self.config.parameters.slashing_percentage / 100);
                }
            }
            
            // If using PBS and a proposer was specified, slash the proposer as well
            if let Some(proposer) = block.proposer {
                if let Some(proposer_participant) = self.participants.get_mut(&proposer) {
                    let slash_amount = (proposer_participant.stake * self.config.parameters.slashing_percentage as u64) / 10000;
                    proposer_participant.stake = proposer_participant.stake.saturating_sub(slash_amount);
                    
                    // Decrease the reputation
                    proposer_participant.reputation -= 20;
                    
                    msg!("Proposer {:?} slashed: {} ({}%)", 
                         proposer, slash_amount, self.config.parameters.slashing_percentage / 100);
                }
            }
        }
        
        msg!("Block challenged: number {}, hash {}, challenger {:?}", 
             block.number, hex::encode(*block_hash), challenger);
        
        Ok(())
    }
    
    /// Reject a challenged block
    pub fn reject_block(&mut self, block_hash: &[u8; 32]) -> Result<(), ConsensusError> {
        if !self.initialized {
            return Err(ConsensusError::NotInitialized);
        }
        
        // Check if the block exists
        let block = self.blocks.get_mut(block_hash)
            .ok_or_else(|| ConsensusError::BlockDoesNotExist(
                hex::encode(*block_hash)
            ))?;
        
        // Check if the block can be rejected
        if block.status != BlockStatus::Challenged {
            return Err(ConsensusError::InvalidBlockStatusTransition(
                block.status.to_string(),
                BlockStatus::Rejected.to_string()
            ));
        }
        
        // Update the block status
        block.status = BlockStatus::Rejected;
        
        msg!("Block rejected: number {}, hash {}", block.number, hex::encode(*block_hash));
        
        Ok(())
    }
    
    /// Get the current sequencer
    pub fn get_current_sequencer(&self) -> Result<Pubkey, ConsensusError> {
        if !self.initialized {
            return Err(ConsensusError::NotInitialized);
        }
        
        self.current_sequencer
            .ok_or_else(|| ConsensusError::NoActiveSequencers)
    }
    
    /// Get a block by hash
    pub fn get_block(&self, block_hash: &[u8; 32]) -> Result<&Block, ConsensusError> {
        if !self.initialized {
            return Err(ConsensusError::NotInitialized);
        }
        
        self.blocks.get(block_hash)
            .ok_or_else(|| ConsensusError::BlockDoesNotExist(
                hex::encode(*block_hash)
            ))
    }
    
    /// Get the latest finalized block
    pub fn get_latest_finalized_block(&self) -> Result<&Block, ConsensusError> {
        if !self.initialized {
            return Err(ConsensusError::NotInitialized);
        }
        
        let block_hash = self.latest_finalized_block
            .ok_or_else(|| ConsensusError::GenericError("No finalized blocks".to_string()))?;
        
        self.blocks.get(&block_hash)
            .ok_or_else(|| ConsensusError::BlockDoesNotExist(
                hex::encode(block_hash)
            ))
    }
    
    /// Get a participant by public key
    pub fn get_participant(&self, pubkey: &Pubkey) -> Result<&ConsensusParticipant, ConsensusError> {
        if !self.initialized {
            return Err(ConsensusError::NotInitialized);
        }
        
        self.participants.get(pubkey)
            .ok_or_else(|| ConsensusError::ParticipantDoesNotExist(
                format!("{:?}", pubkey)
            ))
    }
    
    /// Update the consensus configuration
    pub fn update_config(&mut self, config: ConsensusConfig) -> Result<(), ConsensusError> {
        if !self.initialized {
            return Err(ConsensusError::NotInitialized);
        }
        
        // Validate the new configuration
        config.validate()?;
        
        // Update the configuration
        self.config = config;
        
        msg!("Consensus configuration updated");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_consensus_config_validation() {
        // Valid configuration
        let valid_config = ConsensusConfig::default();
        assert!(valid_config.validate().is_ok());
        
        // Invalid configuration (min_sequencer_stake = 0)
        let mut invalid_config = ConsensusConfig::default();
        invalid_config.parameters.min_sequencer_stake = 0;
        assert!(invalid_config.validate().is_err());
        
        // Invalid configuration (min_validator_stake = 0)
        let mut invalid_config = ConsensusConfig::default();
        invalid_config.parameters.min_validator_stake = 0;
        assert!(invalid_config.validate().is_err());
        
        // Invalid configuration (min_builder_stake = 0 with PBS enabled)
        let mut invalid_config = ConsensusConfig::default();
        invalid_config.use_pbs = true;
        invalid_config.parameters.min_builder_stake = 0;
        assert!(invalid_config.validate().is_err());
        
        // Invalid configuration (min_proposer_stake = 0 with PBS enabled)
        let mut invalid_config = ConsensusConfig::default();
        invalid_config.use_pbs = true;
        invalid_config.parameters.min_proposer_stake = 0;
        assert!(invalid_config.validate().is_err());
        
        // Invalid configuration (max_sequencers = 0)
        let mut invalid_config = ConsensusConfig::default();
        invalid_config.parameters.max_sequencers = 0;
        assert!(invalid_config.validate().is_err());
        
        // Invalid configuration (max_validators = 0)
        let mut invalid_config = ConsensusConfig::default();
        invalid_config.parameters.max_validators = 0;
        assert!(invalid_config.validate().is_err());
        
        // Invalid configuration (max_builders = 0 with PBS enabled)
        let mut invalid_config = ConsensusConfig::default();
        invalid_config.use_pbs = true;
        invalid_config.parameters.max_builders = 0;
        assert!(invalid_config.validate().is_err());
        
        // Invalid configuration (max_proposers = 0 with PBS enabled)
        let mut invalid_config = ConsensusConfig::default();
        invalid_config.use_pbs = true;
        invalid_config.parameters.max_proposers = 0;
        assert!(invalid_config.validate().is_err());
        
        // Invalid configuration (sequencer_rotation_interval = 0 with rotation enabled)
        let mut invalid_config = ConsensusConfig::default();
        invalid_config.enable_sequencer_rotation = true;
        invalid_config.parameters.sequencer_rotation_interval = 0;
        assert!(invalid_config.validate().is_err());
        
        // Invalid configuration (challenge_period = 0)
        let mut invalid_config = ConsensusConfig::default();
        invalid_config.parameters.challenge_period = 0;
        assert!(invalid_config.validate().is_err());
        
        // Invalid configuration (slashing_percentage = 0 with slashing enabled)
        let mut invalid_config = ConsensusConfig::default();
        invalid_config.enable_slashing = true;
        invalid_config.parameters.slashing_percentage = 0;
        assert!(invalid_config.validate().is_err());
        
        // Invalid configuration (slashing_percentage > 10000 with slashing enabled)
        let mut invalid_config = ConsensusConfig::default();
        invalid_config.enable_slashing = true;
        invalid_config.parameters.slashing_percentage = 12000;
        assert!(invalid_config.validate().is_err());
        
        // Invalid configuration (reward_percentage = 0 with rewards enabled)
        let mut invalid_config = ConsensusConfig::default();
        invalid_config.enable_rewards = true;
        invalid_config.parameters.reward_percentage = 0;
        assert!(invalid_config.validate().is_err());
        
        // Invalid configuration (reward_percentage > 10000 with rewards enabled)
        let mut invalid_config = ConsensusConfig::default();
        invalid_config.enable_rewards = true;
        invalid_config.parameters.reward_percentage = 12000;
        assert!(invalid_config.validate().is_err());
    }
    
    // Additional tests would be implemented here
}
