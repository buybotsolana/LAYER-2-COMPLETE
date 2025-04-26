// src/enhanced_fraud_proof/mod.rs
//! Enhanced Fraud Proof System for Layer-2 on Solana
//! 
//! This module implements an advanced fraud proof system for the Layer-2 solution:
//! - Interactive fraud proofs with bisection protocol
//! - Optimized state transition verification
//! - Parallel fraud proof verification
//! - Automated fraud detection
//! - Economic incentives for fraud provers
//!
//! The fraud proof system is a critical component for the security of the optimistic rollup,
//! allowing anyone to challenge invalid state transitions.

mod bisection_game;
mod state_transition_verifier;
mod fraud_detector;
mod proof_incentives;
mod challenge_manager;

pub use bisection_game::{BisectionGame, BisectionStep, BisectionStatus};
pub use state_transition_verifier::{StateTransitionVerifier, StateTransitionProof, VerificationResult};
pub use fraud_detector::{FraudDetector, FraudDetectionResult, DetectionStrategy};
pub use proof_incentives::{ProofIncentives, IncentiveParameters, RewardDistribution};
pub use challenge_manager::{ChallengeManager, Challenge, ChallengeStatus};

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;

/// Enhanced fraud proof system configuration
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct EnhancedFraudProofConfig {
    /// Maximum challenge period (in seconds)
    pub max_challenge_period: u64,
    
    /// Maximum bisection depth
    pub max_bisection_depth: u32,
    
    /// Minimum bond required for challenges (in tokens)
    pub min_challenge_bond: u64,
    
    /// Reward percentage for successful challenges (in basis points)
    pub challenge_reward_percentage: u32,
    
    /// Penalty percentage for failed challenges (in basis points)
    pub challenge_penalty_percentage: u32,
    
    /// Whether to enable automated fraud detection
    pub enable_automated_detection: bool,
    
    /// Whether to enable parallel verification
    pub enable_parallel_verification: bool,
    
    /// Maximum number of concurrent challenges
    pub max_concurrent_challenges: u32,
    
    /// Timeout for challenge steps (in seconds)
    pub challenge_step_timeout: u64,
}

impl Default for EnhancedFraudProofConfig {
    fn default() -> Self {
        Self {
            max_challenge_period: 604800, // 7 days in seconds
            max_bisection_depth: 32,
            min_challenge_bond: 10_000_000_000, // 100 SOL (assuming 8 decimals)
            challenge_reward_percentage: 1000, // 10%
            challenge_penalty_percentage: 500, // 5%
            enable_automated_detection: true,
            enable_parallel_verification: true,
            max_concurrent_challenges: 100,
            challenge_step_timeout: 86400, // 1 day in seconds
        }
    }
}

/// Enhanced fraud proof system for the Layer-2 solution
pub struct EnhancedFraudProofSystem {
    /// Fraud proof system configuration
    config: EnhancedFraudProofConfig,
    
    /// Bisection game manager
    bisection_game: bisection_game::BisectionGame,
    
    /// State transition verifier
    state_transition_verifier: state_transition_verifier::StateTransitionVerifier,
    
    /// Fraud detector
    fraud_detector: fraud_detector::FraudDetector,
    
    /// Proof incentives
    proof_incentives: proof_incentives::ProofIncentives,
    
    /// Challenge manager
    challenge_manager: challenge_manager::ChallengeManager,
    
    /// Whether the fraud proof system is initialized
    initialized: bool,
}

impl EnhancedFraudProofSystem {
    /// Create a new enhanced fraud proof system with default configuration
    pub fn new() -> Self {
        let config = EnhancedFraudProofConfig::default();
        Self {
            config: config.clone(),
            bisection_game: bisection_game::BisectionGame::new(),
            state_transition_verifier: state_transition_verifier::StateTransitionVerifier::new(),
            fraud_detector: fraud_detector::FraudDetector::new(),
            proof_incentives: proof_incentives::ProofIncentives::new(),
            challenge_manager: challenge_manager::ChallengeManager::new(),
            initialized: false,
        }
    }
    
    /// Create a new enhanced fraud proof system with the specified configuration
    pub fn with_config(config: EnhancedFraudProofConfig) -> Self {
        Self {
            config: config.clone(),
            bisection_game: bisection_game::BisectionGame::with_config(config.clone()),
            state_transition_verifier: state_transition_verifier::StateTransitionVerifier::with_config(config.clone()),
            fraud_detector: fraud_detector::FraudDetector::with_config(config.clone()),
            proof_incentives: proof_incentives::ProofIncentives::with_config(config.clone()),
            challenge_manager: challenge_manager::ChallengeManager::with_config(config),
            initialized: false,
        }
    }
    
    /// Initialize the enhanced fraud proof system
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        // Initialize each component
        self.bisection_game.initialize(program_id, accounts)?;
        self.state_transition_verifier.initialize(program_id, accounts)?;
        self.fraud_detector.initialize(program_id, accounts)?;
        self.proof_incentives.initialize(program_id, accounts)?;
        self.challenge_manager.initialize(program_id, accounts)?;
        
        self.initialized = true;
        
        msg!("Enhanced fraud proof system initialized");
        
        Ok(())
    }
    
    /// Check if the enhanced fraud proof system is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Submit a challenge
    pub fn submit_challenge(
        &mut self,
        challenger: &Pubkey,
        block_hash: &[u8; 32],
        pre_state_root: &[u8; 32],
        post_state_root: &[u8; 32],
        bond_amount: u64,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the bond amount is sufficient
        if bond_amount < self.config.min_challenge_bond {
            return Err(ProgramError::InsufficientFunds);
        }
        
        // Check if the maximum number of concurrent challenges is reached
        if self.challenge_manager.get_active_challenges().len() >= self.config.max_concurrent_challenges as usize {
            return Err(ProgramError::MaxAccountsDataSizeExceeded);
        }
        
        // Create a new challenge
        let challenge_id = self.challenge_manager.create_challenge(
            *challenger,
            *block_hash,
            *pre_state_root,
            *post_state_root,
            bond_amount,
        )?;
        
        // Start a new bisection game for the challenge
        self.bisection_game.start_game(challenge_id, *pre_state_root, *post_state_root)?;
        
        msg!("Challenge submitted: {}", challenge_id);
        
        Ok(challenge_id)
    }
    
    /// Respond to a challenge
    pub fn respond_to_challenge(
        &mut self,
        responder: &Pubkey,
        challenge_id: u64,
        mid_state_root: &[u8; 32],
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the challenge
        let challenge = self.challenge_manager.get_challenge(challenge_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the challenge is active
        if challenge.status != challenge_manager::ChallengeStatus::Active {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if the responder is the challenged party
        // In a real implementation, we would check if the responder is the sequencer or proposer of the challenged block
        
        // Advance the bisection game
        self.bisection_game.advance_game(challenge_id, *mid_state_root)?;
        
        msg!("Challenge response submitted for challenge: {}", challenge_id);
        
        Ok(())
    }
    
    /// Verify a state transition
    pub fn verify_state_transition(
        &self,
        pre_state_root: &[u8; 32],
        post_state_root: &[u8; 32],
        transactions: &[Vec<u8>],
    ) -> Result<state_transition_verifier::VerificationResult, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Verify the state transition
        let result = self.state_transition_verifier.verify_transition(
            pre_state_root,
            post_state_root,
            transactions,
        )?;
        
        Ok(result)
    }
    
    /// Finalize a challenge
    pub fn finalize_challenge(&mut self, challenge_id: u64) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the challenge
        let challenge = self.challenge_manager.get_challenge(challenge_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the challenge is active
        if challenge.status != challenge_manager::ChallengeStatus::Active {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Get the bisection game status
        let game_status = self.bisection_game.get_game_status(challenge_id)?;
        
        // Determine the challenge outcome based on the bisection game status
        let (is_successful, final_state) = match game_status {
            bisection_game::BisectionStatus::ChallengerWon => (true, challenge_manager::ChallengeStatus::Successful),
            bisection_game::BisectionStatus::DefenderWon => (false, challenge_manager::ChallengeStatus::Failed),
            bisection_game::BisectionStatus::Timeout => (true, challenge_manager::ChallengeStatus::Successful), // Defender timed out
            _ => return Err(ProgramError::InvalidArgument), // Game is not finished
        };
        
        // Finalize the challenge
        self.challenge_manager.finalize_challenge(challenge_id, final_state)?;
        
        // Distribute rewards or penalties
        if is_successful {
            // Successful challenge: reward the challenger
            self.proof_incentives.reward_challenger(&challenge.challenger, challenge.bond_amount)?;
        } else {
            // Failed challenge: penalize the challenger
            self.proof_incentives.penalize_challenger(&challenge.challenger, challenge.bond_amount)?;
        }
        
        msg!("Challenge finalized: {}, successful: {}", challenge_id, is_successful);
        
        Ok(())
    }
    
    /// Detect fraud automatically
    pub fn detect_fraud(&mut self, block_hash: &[u8; 32]) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if automated fraud detection is enabled
        if !self.config.enable_automated_detection {
            return Ok(());
        }
        
        // Detect fraud
        let result = self.fraud_detector.detect_fraud(block_hash)?;
        
        // If fraud is detected, submit a challenge automatically
        if result.fraud_detected {
            msg!("Fraud detected in block: {:?}", block_hash);
            
            // In a real implementation, we would submit a challenge automatically
            // For now, we'll just log that fraud was detected
        }
        
        Ok(())
    }
    
    /// Update the enhanced fraud proof system configuration
    pub fn update_config(&mut self, config: EnhancedFraudProofConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the configuration
        self.config = config.clone();
        
        // Update each component's configuration
        self.bisection_game.update_config(config.clone())?;
        self.state_transition_verifier.update_config(config.clone())?;
        self.fraud_detector.update_config(config.clone())?;
        self.proof_incentives.update_config(config.clone())?;
        self.challenge_manager.update_config(config)?;
        
        msg!("Enhanced fraud proof system configuration updated");
        
        Ok(())
    }
    
    /// Get the challenge manager
    pub fn get_challenge_manager(&self) -> &challenge_manager::ChallengeManager {
        &self.challenge_manager
    }
    
    /// Get the bisection game
    pub fn get_bisection_game(&self) -> &bisection_game::BisectionGame {
        &self.bisection_game
    }
    
    /// Get the state transition verifier
    pub fn get_state_transition_verifier(&self) -> &state_transition_verifier::StateTransitionVerifier {
        &self.state_transition_verifier
    }
    
    /// Get the fraud detector
    pub fn get_fraud_detector(&self) -> &fraud_detector::FraudDetector {
        &self.fraud_detector
    }
    
    /// Get the proof incentives
    pub fn get_proof_incentives(&self) -> &proof_incentives::ProofIncentives {
        &self.proof_incentives
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_enhanced_fraud_proof_system_creation() {
        let system = EnhancedFraudProofSystem::new();
        assert!(!system.is_initialized());
    }
    
    #[test]
    fn test_enhanced_fraud_proof_system_with_config() {
        let config = EnhancedFraudProofConfig::default();
        let system = EnhancedFraudProofSystem::with_config(config);
        assert!(!system.is_initialized());
    }
}
