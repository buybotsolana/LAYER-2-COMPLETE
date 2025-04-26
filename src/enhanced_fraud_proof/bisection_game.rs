// src/enhanced_fraud_proof/bisection_game.rs
//! Bisection Game module for Enhanced Fraud Proof System
//! 
//! This module implements the interactive bisection protocol for fraud proofs:
//! - Binary search over execution steps to identify the exact point of disagreement
//! - Efficient state transition verification at each step
//! - Timeout handling for non-responsive parties
//! - Game state management and progression
//!
//! The bisection game is the core mechanism for efficiently resolving disputes
//! about state transitions in the optimistic rollup.

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

/// Bisection step in a game
#[derive(Debug, Clone)]
pub struct BisectionStep {
    /// Step index
    pub index: u32,
    
    /// Pre-state root at this step
    pub pre_state_root: [u8; 32],
    
    /// Post-state root at this step
    pub post_state_root: [u8; 32],
    
    /// Execution step index (in the transaction sequence)
    pub execution_step: u64,
    
    /// Timestamp when the step was submitted
    pub timestamp: u64,
    
    /// Submitter of this step
    pub submitter: Pubkey,
}

/// Bisection game status
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BisectionStatus {
    /// Game is in progress
    InProgress,
    
    /// Game is waiting for challenger response
    WaitingForChallenger,
    
    /// Game is waiting for defender response
    WaitingForDefender,
    
    /// Challenger won the game
    ChallengerWon,
    
    /// Defender won the game
    DefenderWon,
    
    /// Game timed out
    Timeout,
}

/// Bisection game
#[derive(Debug, Clone)]
pub struct BisectionGameState {
    /// Challenge ID
    pub challenge_id: u64,
    
    /// Challenger public key
    pub challenger: Pubkey,
    
    /// Defender public key
    pub defender: Pubkey,
    
    /// Initial pre-state root
    pub initial_pre_state_root: [u8; 32],
    
    /// Initial post-state root
    pub initial_post_state_root: [u8; 32],
    
    /// Current bisection steps
    pub steps: Vec<BisectionStep>,
    
    /// Current game status
    pub status: BisectionStatus,
    
    /// Current bisection depth
    pub current_depth: u32,
    
    /// Last step timestamp
    pub last_step_timestamp: u64,
    
    /// Whether the game is finalized
    pub is_finalized: bool,
}

/// Bisection game for the enhanced fraud proof system
pub struct BisectionGame {
    /// Bisection game configuration
    config: EnhancedFraudProofConfig,
    
    /// Active games by challenge ID
    games: HashMap<u64, BisectionGameState>,
    
    /// Whether the bisection game is initialized
    initialized: bool,
}

impl BisectionGame {
    /// Create a new bisection game with default configuration
    pub fn new() -> Self {
        Self {
            config: EnhancedFraudProofConfig::default(),
            games: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Create a new bisection game with the specified configuration
    pub fn with_config(config: EnhancedFraudProofConfig) -> Self {
        Self {
            config,
            games: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Initialize the bisection game
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        self.initialized = true;
        
        msg!("Bisection game initialized");
        
        Ok(())
    }
    
    /// Check if the bisection game is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Start a new bisection game
    pub fn start_game(
        &mut self,
        challenge_id: u64,
        pre_state_root: [u8; 32],
        post_state_root: [u8; 32],
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if a game already exists for this challenge
        if self.games.contains_key(&challenge_id) {
            return Err(ProgramError::AccountAlreadyInitialized);
        }
        
        // Create the initial step
        let initial_step = BisectionStep {
            index: 0,
            pre_state_root,
            post_state_root,
            execution_step: 0,
            timestamp: 0, // In a real implementation, we would use the current timestamp
            submitter: Pubkey::default(), // In a real implementation, we would use the challenger's pubkey
        };
        
        // Create the game state
        let game_state = BisectionGameState {
            challenge_id,
            challenger: Pubkey::default(), // In a real implementation, we would use the challenger's pubkey
            defender: Pubkey::default(), // In a real implementation, we would use the defender's pubkey
            initial_pre_state_root: pre_state_root,
            initial_post_state_root: post_state_root,
            steps: vec![initial_step],
            status: BisectionStatus::WaitingForDefender,
            current_depth: 0,
            last_step_timestamp: 0, // In a real implementation, we would use the current timestamp
            is_finalized: false,
        };
        
        // Add the game
        self.games.insert(challenge_id, game_state);
        
        msg!("Bisection game started for challenge: {}", challenge_id);
        
        Ok(())
    }
    
    /// Advance a bisection game
    pub fn advance_game(
        &mut self,
        challenge_id: u64,
        mid_state_root: [u8; 32],
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the game
        let game = self.games.get_mut(&challenge_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the game is already finalized
        if game.is_finalized {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if the game is waiting for a response
        match game.status {
            BisectionStatus::WaitingForChallenger => {
                // Challenger's turn
                // In a real implementation, we would verify that the caller is the challenger
            },
            BisectionStatus::WaitingForDefender => {
                // Defender's turn
                // In a real implementation, we would verify that the caller is the defender
            },
            _ => {
                return Err(ProgramError::InvalidArgument);
            }
        }
        
        // Check if the maximum bisection depth is reached
        if game.current_depth >= self.config.max_bisection_depth {
            // We've reached the maximum depth, so we need to finalize the game
            // The last step should be a single execution step, so we can verify it directly
            
            // In a real implementation, we would verify the execution step and determine the winner
            // For now, we'll just set the game status to ChallengerWon
            
            game.status = BisectionStatus::ChallengerWon;
            game.is_finalized = true;
            
            msg!("Bisection game finalized for challenge: {}, challenger won", challenge_id);
            
            return Ok(());
        }
        
        // Get the latest step
        let latest_step = game.steps.last()
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Create the new step
        let new_step = BisectionStep {
            index: latest_step.index + 1,
            pre_state_root: latest_step.pre_state_root,
            post_state_root: mid_state_root,
            execution_step: latest_step.execution_step + (1 << (self.config.max_bisection_depth - game.current_depth - 1)),
            timestamp: 0, // In a real implementation, we would use the current timestamp
            submitter: Pubkey::default(), // In a real implementation, we would use the caller's pubkey
        };
        
        // Add the new step
        game.steps.push(new_step);
        
        // Update the game state
        game.current_depth += 1;
        game.last_step_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        // Toggle the turn
        game.status = match game.status {
            BisectionStatus::WaitingForChallenger => BisectionStatus::WaitingForDefender,
            BisectionStatus::WaitingForDefender => BisectionStatus::WaitingForChallenger,
            _ => game.status,
        };
        
        msg!("Bisection game advanced for challenge: {}, depth: {}", challenge_id, game.current_depth);
        
        Ok(())
    }
    
    /// Check for timeouts in bisection games
    pub fn check_timeouts(&mut self, current_timestamp: u64) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        for (challenge_id, game) in self.games.iter_mut() {
            // Skip finalized games
            if game.is_finalized {
                continue;
            }
            
            // Check if the game has timed out
            if current_timestamp > game.last_step_timestamp + self.config.challenge_step_timeout {
                // Game has timed out
                
                // Determine the winner based on whose turn it was
                match game.status {
                    BisectionStatus::WaitingForChallenger => {
                        // Challenger timed out, defender wins
                        game.status = BisectionStatus::DefenderWon;
                    },
                    BisectionStatus::WaitingForDefender => {
                        // Defender timed out, challenger wins
                        game.status = BisectionStatus::ChallengerWon;
                    },
                    _ => {
                        // Game is not waiting for a response, so no timeout
                        continue;
                    }
                }
                
                // Finalize the game
                game.is_finalized = true;
                game.status = BisectionStatus::Timeout;
                
                msg!("Bisection game timed out for challenge: {}", challenge_id);
            }
        }
        
        Ok(())
    }
    
    /// Get the status of a bisection game
    pub fn get_game_status(&self, challenge_id: u64) -> Result<BisectionStatus, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the game
        let game = self.games.get(&challenge_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        Ok(game.status.clone())
    }
    
    /// Get a bisection game
    pub fn get_game(&self, challenge_id: u64) -> Option<&BisectionGameState> {
        if !self.initialized {
            return None;
        }
        
        self.games.get(&challenge_id)
    }
    
    /// Finalize a bisection game
    pub fn finalize_game(&mut self, challenge_id: u64, winner_is_challenger: bool) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the game
        let game = self.games.get_mut(&challenge_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the game is already finalized
        if game.is_finalized {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Set the game status
        game.status = if winner_is_challenger {
            BisectionStatus::ChallengerWon
        } else {
            BisectionStatus::DefenderWon
        };
        
        // Finalize the game
        game.is_finalized = true;
        
        msg!("Bisection game finalized for challenge: {}, challenger won: {}", challenge_id, winner_is_challenger);
        
        Ok(())
    }
    
    /// Update the bisection game configuration
    pub fn update_config(&mut self, config: EnhancedFraudProofConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the configuration
        self.config = config;
        
        msg!("Bisection game configuration updated");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_bisection_game_creation() {
        let game = BisectionGame::new();
        assert!(!game.is_initialized());
    }
    
    #[test]
    fn test_bisection_game_with_config() {
        let config = EnhancedFraudProofConfig::default();
        let game = BisectionGame::with_config(config);
        assert!(!game.is_initialized());
    }
}
