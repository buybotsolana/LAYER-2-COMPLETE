// src/enhanced_fraud_proof/proof_incentives.rs
//! Proof Incentives module for Enhanced Fraud Proof System
//! 
//! This module implements economic incentives for fraud proofs:
//! - Reward distribution for successful challenges
//! - Penalty mechanisms for failed challenges
//! - Staking requirements for challengers
//! - Dynamic incentive adjustment based on system parameters
//!
//! The proof incentives system ensures that participants are economically
//! motivated to submit valid fraud proofs and discouraged from submitting
//! invalid ones.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;

use super::EnhancedFraudProofConfig;

/// Incentive parameters
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct IncentiveParameters {
    /// Minimum bond required for challenges (in tokens)
    pub min_challenge_bond: u64,
    
    /// Maximum bond required for challenges (in tokens)
    pub max_challenge_bond: u64,
    
    /// Base reward percentage for successful challenges (in basis points)
    pub base_reward_percentage: u32,
    
    /// Additional reward percentage for high-confidence challenges (in basis points)
    pub high_confidence_bonus_percentage: u32,
    
    /// Penalty percentage for failed challenges (in basis points)
    pub penalty_percentage: u32,
    
    /// Percentage of penalty that goes to the defender (in basis points)
    pub defender_percentage: u32,
    
    /// Percentage of penalty that goes to the system (in basis points)
    pub system_percentage: u32,
    
    /// Whether to enable dynamic incentive adjustment
    pub enable_dynamic_adjustment: bool,
    
    /// Adjustment factor for dynamic incentives (in basis points)
    pub adjustment_factor: u32,
    
    /// Minimum time between adjustments (in seconds)
    pub min_adjustment_interval: u64,
}

impl Default for IncentiveParameters {
    fn default() -> Self {
        Self {
            min_challenge_bond: 10_000_000_000, // 100 SOL (assuming 8 decimals)
            max_challenge_bond: 1_000_000_000_000, // 10,000 SOL
            base_reward_percentage: 1000, // 10%
            high_confidence_bonus_percentage: 500, // 5%
            penalty_percentage: 500, // 5%
            defender_percentage: 8000, // 80%
            system_percentage: 2000, // 20%
            enable_dynamic_adjustment: true,
            adjustment_factor: 100, // 1%
            min_adjustment_interval: 86400, // 1 day in seconds
        }
    }
}

/// Reward distribution
#[derive(Debug, Clone)]
pub struct RewardDistribution {
    /// Challenger reward
    pub challenger_reward: u64,
    
    /// Defender reward
    pub defender_reward: u64,
    
    /// System reward
    pub system_reward: u64,
    
    /// Total reward
    pub total_reward: u64,
}

/// Proof incentives for the enhanced fraud proof system
pub struct ProofIncentives {
    /// Incentive parameters
    parameters: IncentiveParameters,
    
    /// Challenger stakes
    challenger_stakes: HashMap<Pubkey, u64>,
    
    /// Reward history
    reward_history: Vec<RewardDistribution>,
    
    /// Last adjustment timestamp
    last_adjustment_timestamp: u64,
    
    /// Whether the proof incentives are initialized
    initialized: bool,
}

impl ProofIncentives {
    /// Create a new proof incentives with default parameters
    pub fn new() -> Self {
        Self {
            parameters: IncentiveParameters::default(),
            challenger_stakes: HashMap::new(),
            reward_history: Vec::new(),
            last_adjustment_timestamp: 0,
            initialized: false,
        }
    }
    
    /// Create a new proof incentives with the specified configuration
    pub fn with_config(config: EnhancedFraudProofConfig) -> Self {
        Self {
            parameters: IncentiveParameters {
                min_challenge_bond: config.min_challenge_bond,
                max_challenge_bond: config.min_challenge_bond * 100,
                base_reward_percentage: config.challenge_reward_percentage,
                high_confidence_bonus_percentage: config.challenge_reward_percentage / 2,
                penalty_percentage: config.challenge_penalty_percentage,
                defender_percentage: 8000, // 80%
                system_percentage: 2000, // 20%
                enable_dynamic_adjustment: true,
                adjustment_factor: 100, // 1%
                min_adjustment_interval: 86400, // 1 day in seconds
            },
            challenger_stakes: HashMap::new(),
            reward_history: Vec::new(),
            last_adjustment_timestamp: 0,
            initialized: false,
        }
    }
    
    /// Initialize the proof incentives
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        self.initialized = true;
        
        msg!("Proof incentives initialized");
        
        Ok(())
    }
    
    /// Check if the proof incentives are initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Stake tokens for a challenger
    pub fn stake(&mut self, challenger: &Pubkey, amount: u64) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the amount is sufficient
        if amount < self.parameters.min_challenge_bond {
            return Err(ProgramError::InsufficientFunds);
        }
        
        // Update the challenger's stake
        let current_stake = self.challenger_stakes.get(challenger).unwrap_or(&0);
        let new_stake = current_stake + amount;
        
        self.challenger_stakes.insert(*challenger, new_stake);
        
        msg!("Challenger staked: {:?}, amount: {}", challenger, amount);
        
        Ok(())
    }
    
    /// Unstake tokens for a challenger
    pub fn unstake(&mut self, challenger: &Pubkey, amount: u64) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the challenger has sufficient stake
        let current_stake = self.challenger_stakes.get(challenger)
            .ok_or(ProgramError::InvalidArgument)?;
        
        if *current_stake < amount {
            return Err(ProgramError::InsufficientFunds);
        }
        
        // Update the challenger's stake
        let new_stake = current_stake - amount;
        
        if new_stake == 0 {
            self.challenger_stakes.remove(challenger);
        } else {
            self.challenger_stakes.insert(*challenger, new_stake);
        }
        
        msg!("Challenger unstaked: {:?}, amount: {}", challenger, amount);
        
        Ok(())
    }
    
    /// Reward a challenger for a successful challenge
    pub fn reward_challenger(&mut self, challenger: &Pubkey, bond_amount: u64) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Calculate the reward
        let base_reward = (bond_amount * self.parameters.base_reward_percentage as u64) / 10000;
        let high_confidence_bonus = (bond_amount * self.parameters.high_confidence_bonus_percentage as u64) / 10000;
        
        let challenger_reward = bond_amount + base_reward + high_confidence_bonus;
        let system_reward = 0; // In a real implementation, we would calculate the system reward
        
        // Create the reward distribution
        let distribution = RewardDistribution {
            challenger_reward,
            defender_reward: 0,
            system_reward,
            total_reward: challenger_reward + system_reward,
        };
        
        // Add the distribution to the history
        self.reward_history.push(distribution.clone());
        
        // In a real implementation, we would transfer the reward to the challenger
        
        msg!("Challenger rewarded: {:?}, amount: {}", challenger, challenger_reward);
        
        Ok(())
    }
    
    /// Penalize a challenger for a failed challenge
    pub fn penalize_challenger(&mut self, challenger: &Pubkey, bond_amount: u64) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Calculate the penalty
        let penalty = (bond_amount * self.parameters.penalty_percentage as u64) / 10000;
        
        let defender_reward = (penalty * self.parameters.defender_percentage as u64) / 10000;
        let system_reward = (penalty * self.parameters.system_percentage as u64) / 10000;
        
        // Create the reward distribution
        let distribution = RewardDistribution {
            challenger_reward: 0,
            defender_reward,
            system_reward,
            total_reward: defender_reward + system_reward,
        };
        
        // Add the distribution to the history
        self.reward_history.push(distribution.clone());
        
        // In a real implementation, we would transfer the penalty to the defender and the system
        
        msg!("Challenger penalized: {:?}, amount: {}", challenger, penalty);
        
        Ok(())
    }
    
    /// Adjust incentives dynamically
    pub fn adjust_incentives(&mut self, current_timestamp: u64) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if dynamic adjustment is enabled
        if !self.parameters.enable_dynamic_adjustment {
            return Ok(());
        }
        
        // Check if the minimum adjustment interval has passed
        if current_timestamp < self.last_adjustment_timestamp + self.parameters.min_adjustment_interval {
            return Ok(());
        }
        
        // In a real implementation, we would adjust the incentives based on system parameters
        // For now, we'll just update the last adjustment timestamp
        
        self.last_adjustment_timestamp = current_timestamp;
        
        msg!("Incentives adjusted");
        
        Ok(())
    }
    
    /// Update the incentive parameters
    pub fn update_parameters(&mut self, parameters: IncentiveParameters) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the parameters
        self.parameters = parameters;
        
        msg!("Incentive parameters updated");
        
        Ok(())
    }
    
    /// Update the proof incentives configuration
    pub fn update_config(&mut self, config: EnhancedFraudProofConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the parameters
        self.parameters = IncentiveParameters {
            min_challenge_bond: config.min_challenge_bond,
            max_challenge_bond: config.min_challenge_bond * 100,
            base_reward_percentage: config.challenge_reward_percentage,
            high_confidence_bonus_percentage: config.challenge_reward_percentage / 2,
            penalty_percentage: config.challenge_penalty_percentage,
            defender_percentage: 8000, // 80%
            system_percentage: 2000, // 20%
            enable_dynamic_adjustment: true,
            adjustment_factor: 100, // 1%
            min_adjustment_interval: 86400, // 1 day in seconds
        };
        
        msg!("Proof incentives configuration updated");
        
        Ok(())
    }
    
    /// Get the incentive parameters
    pub fn get_parameters(&self) -> &IncentiveParameters {
        &self.parameters
    }
    
    /// Get the challenger stakes
    pub fn get_challenger_stakes(&self) -> &HashMap<Pubkey, u64> {
        &self.challenger_stakes
    }
    
    /// Get the reward history
    pub fn get_reward_history(&self) -> &Vec<RewardDistribution> {
        &self.reward_history
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_proof_incentives_creation() {
        let incentives = ProofIncentives::new();
        assert!(!incentives.is_initialized());
    }
    
    #[test]
    fn test_proof_incentives_with_config() {
        let config = EnhancedFraudProofConfig::default();
        let incentives = ProofIncentives::with_config(config);
        assert!(!incentives.is_initialized());
    }
}
