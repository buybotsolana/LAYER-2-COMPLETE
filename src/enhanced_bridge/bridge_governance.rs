// src/enhanced_bridge/bridge_governance.rs
//! Bridge Governance module for Enhanced Bridge Security
//! 
//! This module implements bridge governance:
//! - Proposal creation and voting
//! - Parameter updates and configuration changes
//! - Access control and role management
//! - Governance token integration
//!
//! The bridge governance ensures that changes to the bridge
//! are made through a decentralized and transparent process.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::{HashMap, HashSet};

/// Governance configuration
#[derive(Debug, Clone)]
pub struct GovernanceConfig {
    /// Voting period (in seconds)
    pub voting_period: u64,
    
    /// Execution delay (in seconds)
    pub execution_delay: u64,
    
    /// Quorum percentage (in basis points)
    pub quorum_bps: u32,
    
    /// Approval threshold percentage (in basis points)
    pub approval_threshold_bps: u32,
}

impl Default for GovernanceConfig {
    fn default() -> Self {
        Self {
            voting_period: 259200, // 3 days in seconds
            execution_delay: 86400, // 1 day in seconds
            quorum_bps: 3000, // 30%
            approval_threshold_bps: 5000, // 50%
        }
    }
}

/// Proposal status
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProposalStatus {
    /// Active
    Active,
    
    /// Passed
    Passed,
    
    /// Failed
    Failed,
    
    /// Executed
    Executed,
    
    /// Cancelled
    Cancelled,
}

/// Vote
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Vote {
    /// For
    For,
    
    /// Against
    Against,
    
    /// Abstain
    Abstain,
}

/// Action type
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActionType {
    /// Update configuration
    UpdateConfig,
    
    /// Add validator
    AddValidator,
    
    /// Remove validator
    RemoveValidator,
    
    /// Update fee
    UpdateFee,
    
    /// Pause bridge
    PauseBridge,
    
    /// Unpause bridge
    UnpauseBridge,
    
    /// Upgrade contract
    UpgradeContract,
    
    /// Custom action
    Custom(String),
}

/// Action parameters
#[derive(Debug, Clone)]
pub struct ActionParams {
    /// Action type
    pub action_type: ActionType,
    
    /// Parameters
    pub params: Vec<u8>,
}

/// Proposal information
#[derive(Debug, Clone)]
pub struct ProposalInfo {
    /// Proposal ID
    pub id: u64,
    
    /// Proposer
    pub proposer: Pubkey,
    
    /// Title
    pub title: String,
    
    /// Description
    pub description: String,
    
    /// Actions
    pub actions: Vec<ActionParams>,
    
    /// Status
    pub status: ProposalStatus,
    
    /// Creation timestamp
    pub creation_timestamp: u64,
    
    /// Voting end timestamp
    pub voting_end_timestamp: u64,
    
    /// Execution timestamp
    pub execution_timestamp: Option<u64>,
    
    /// For votes
    pub for_votes: u64,
    
    /// Against votes
    pub against_votes: u64,
    
    /// Abstain votes
    pub abstain_votes: u64,
    
    /// Voters
    pub voters: HashSet<Pubkey>,
}

/// Bridge governance for the enhanced bridge system
pub struct BridgeGovernance {
    /// Governance configuration
    config: GovernanceConfig,
    
    /// Proposals by ID
    proposals: HashMap<u64, ProposalInfo>,
    
    /// Next proposal ID
    next_proposal_id: u64,
    
    /// Total voting power
    total_voting_power: u64,
    
    /// Voting power by account
    voting_power: HashMap<Pubkey, u64>,
    
    /// Whether the bridge governance is initialized
    initialized: bool,
}

impl BridgeGovernance {
    /// Create a new bridge governance with default configuration
    pub fn new() -> Self {
        Self {
            config: GovernanceConfig::default(),
            proposals: HashMap::new(),
            next_proposal_id: 1,
            total_voting_power: 0,
            voting_power: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Create a new bridge governance with the specified configuration
    pub fn with_config(config: GovernanceConfig) -> Self {
        Self {
            config,
            proposals: HashMap::new(),
            next_proposal_id: 1,
            total_voting_power: 0,
            voting_power: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Initialize the bridge governance
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        self.initialized = true;
        
        msg!("Bridge governance initialized");
        
        Ok(())
    }
    
    /// Check if the bridge governance is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Set voting power
    pub fn set_voting_power(
        &mut self,
        account: &Pubkey,
        power: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the current voting power
        let current_power = self.voting_power.get(account).unwrap_or(&0);
        
        // Update the total voting power
        self.total_voting_power = self.total_voting_power - *current_power + power;
        
        // Update the voting power
        self.voting_power.insert(*account, power);
        
        msg!("Voting power set: account: {:?}, power: {}", account, power);
        
        Ok(())
    }
    
    /// Create a proposal
    pub fn create_proposal(
        &mut self,
        proposer: &Pubkey,
        title: String,
        description: String,
        actions: Vec<ActionParams>,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the proposer has voting power
        let proposer_power = self.voting_power.get(proposer).unwrap_or(&0);
        if *proposer_power == 0 {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        // Calculate the voting end timestamp
        let voting_end_timestamp = current_timestamp + self.config.voting_period;
        
        // Create the proposal
        let proposal_id = self.next_proposal_id;
        self.next_proposal_id += 1;
        
        let proposal = ProposalInfo {
            id: proposal_id,
            proposer: *proposer,
            title,
            description,
            actions,
            status: ProposalStatus::Active,
            creation_timestamp: current_timestamp,
            voting_end_timestamp,
            execution_timestamp: None,
            for_votes: 0,
            against_votes: 0,
            abstain_votes: 0,
            voters: HashSet::new(),
        };
        
        // Add the proposal
        self.proposals.insert(proposal_id, proposal);
        
        msg!("Proposal created: {}", proposal_id);
        
        Ok(proposal_id)
    }
    
    /// Vote on a proposal
    pub fn vote(
        &mut self,
        proposal_id: u64,
        voter: &Pubkey,
        vote: Vote,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the proposal
        let proposal = self.proposals.get_mut(&proposal_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the proposal is active
        if proposal.status != ProposalStatus::Active {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        // Check if the voting period has ended
        if current_timestamp >= proposal.voting_end_timestamp {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if the voter has already voted
        if proposal.voters.contains(voter) {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Get the voter's voting power
        let voter_power = self.voting_power.get(voter).unwrap_or(&0);
        if *voter_power == 0 {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Update the vote counts
        match vote {
            Vote::For => {
                proposal.for_votes += *voter_power;
            },
            Vote::Against => {
                proposal.against_votes += *voter_power;
            },
            Vote::Abstain => {
                proposal.abstain_votes += *voter_power;
            },
        }
        
        // Add the voter to the voters set
        proposal.voters.insert(*voter);
        
        msg!("Vote cast: proposal: {}, voter: {:?}, vote: {:?}", proposal_id, voter, vote);
        
        Ok(())
    }
    
    /// Process proposals
    pub fn process_proposals(&mut self) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        for (_, proposal) in self.proposals.iter_mut() {
            // Skip proposals that are not active
            if proposal.status != ProposalStatus::Active {
                continue;
            }
            
            // Check if the voting period has ended
            if current_timestamp >= proposal.voting_end_timestamp {
                // Calculate the total votes
                let total_votes = proposal.for_votes + proposal.against_votes + proposal.abstain_votes;
                
                // Check if the quorum is reached
                let quorum_votes = (self.total_voting_power * self.config.quorum_bps as u64) / 10000;
                if total_votes >= quorum_votes {
                    // Check if the proposal is approved
                    let approval_votes = (total_votes * self.config.approval_threshold_bps as u64) / 10000;
                    if proposal.for_votes >= approval_votes {
                        proposal.status = ProposalStatus::Passed;
                        
                        msg!("Proposal passed: {}", proposal.id);
                    } else {
                        proposal.status = ProposalStatus::Failed;
                        
                        msg!("Proposal failed: {}", proposal.id);
                    }
                } else {
                    proposal.status = ProposalStatus::Failed;
                    
                    msg!("Proposal failed (quorum not reached): {}", proposal.id);
                }
            }
        }
        
        Ok(())
    }
    
    /// Execute a proposal
    pub fn execute_proposal(
        &mut self,
        proposal_id: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the proposal
        let proposal = self.proposals.get_mut(&proposal_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the proposal is passed
        if proposal.status != ProposalStatus::Passed {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        // Check if the execution delay has passed
        if current_timestamp < proposal.voting_end_timestamp + self.config.execution_delay {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Execute the proposal actions
        // In a real implementation, we would execute the actions
        
        // Update the proposal status
        proposal.status = ProposalStatus::Executed;
        
        // Set the execution timestamp
        proposal.execution_timestamp = Some(current_timestamp);
        
        msg!("Proposal executed: {}", proposal_id);
        
        Ok(())
    }
    
    /// Cancel a proposal
    pub fn cancel_proposal(
        &mut self,
        proposal_id: u64,
        canceller: &Pubkey,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the proposal
        let proposal = self.proposals.get_mut(&proposal_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the proposal is active
        if proposal.status != ProposalStatus::Active {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if the canceller is the proposer
        if proposal.proposer != *canceller {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Update the proposal status
        proposal.status = ProposalStatus::Cancelled;
        
        msg!("Proposal cancelled: {}", proposal_id);
        
        Ok(())
    }
    
    /// Get a proposal
    pub fn get_proposal(
        &self,
        proposal_id: u64,
    ) -> Option<&ProposalInfo> {
        if !self.initialized {
            return None;
        }
        
        self.proposals.get(&proposal_id)
    }
    
    /// Get all proposals
    pub fn get_all_proposals(&self) -> &HashMap<u64, ProposalInfo> {
        &self.proposals
    }
    
    /// Get active proposals
    pub fn get_active_proposals(&self) -> Vec<&ProposalInfo> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.proposals.values()
            .filter(|proposal| proposal.status == ProposalStatus::Active)
            .collect()
    }
    
    /// Get passed proposals
    pub fn get_passed_proposals(&self) -> Vec<&ProposalInfo> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.proposals.values()
            .filter(|proposal| proposal.status == ProposalStatus::Passed)
            .collect()
    }
    
    /// Get executed proposals
    pub fn get_executed_proposals(&self) -> Vec<&ProposalInfo> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.proposals.values()
            .filter(|proposal| proposal.status == ProposalStatus::Executed)
            .collect()
    }
    
    /// Update the bridge governance configuration
    pub fn update_config(&mut self, config: GovernanceConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the configuration
        self.config = config;
        
        msg!("Bridge governance configuration updated");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_bridge_governance_creation() {
        let governance = BridgeGovernance::new();
        assert!(!governance.is_initialized());
    }
    
    #[test]
    fn test_bridge_governance_with_config() {
        let config = GovernanceConfig::default();
        let governance = BridgeGovernance::with_config(config);
        assert!(!governance.is_initialized());
    }
}
