// src/fraud_proof_system/bisection.rs
//! Bisection Game implementation for the Fraud Proof System
//! 
//! This module provides the implementation of the bisection game for interactive
//! fraud proof verification, allowing for efficient identification of the exact
//! point of disagreement in a state transition.

use super::state_transition::{StateTransition, Transaction};
use solana_program::keccak;
use borsh::{BorshDeserialize, BorshSerialize};
use std::fmt;

/// Bisection game state
#[derive(Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum BisectionGameState {
    /// Game is in progress
    InProgress,
    
    /// Game is completed with a valid state transition
    ValidStateTransition,
    
    /// Game is completed with an invalid state transition
    InvalidStateTransition,
    
    /// Game is timed out
    TimedOut,
}

impl fmt::Display for BisectionGameState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BisectionGameState::InProgress => write!(f, "InProgress"),
            BisectionGameState::ValidStateTransition => write!(f, "ValidStateTransition"),
            BisectionGameState::InvalidStateTransition => write!(f, "InvalidStateTransition"),
            BisectionGameState::TimedOut => write!(f, "TimedOut"),
        }
    }
}

/// Bisection step
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct BisectionStep {
    /// Step index
    pub index: usize,
    
    /// Pre-state root
    pub pre_state_root: [u8; 32],
    
    /// Post-state root
    pub post_state_root: [u8; 32],
    
    /// Transactions included in this step
    pub transactions: Vec<Transaction>,
    
    /// Start index of transactions
    pub start_index: usize,
    
    /// End index of transactions
    pub end_index: usize,
}

/// Bisection game for interactive fraud proof verification
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct BisectionGame {
    /// Game ID
    pub id: [u8; 32],
    
    /// Initial pre-state root
    pub initial_pre_state_root: [u8; 32],
    
    /// Initial post-state root
    pub initial_post_state_root: [u8; 32],
    
    /// Expected post-state root
    pub expected_post_state_root: [u8; 32],
    
    /// All transactions
    pub transactions: Vec<Transaction>,
    
    /// Current steps in the bisection
    pub steps: Vec<BisectionStep>,
    
    /// Current game state
    pub state: BisectionGameState,
    
    /// Current step index
    pub current_step_index: usize,
    
    /// Timeout timestamp
    pub timeout_timestamp: u64,
    
    /// Challenger address
    pub challenger: [u8; 32],
    
    /// Defender address
    pub defender: [u8; 32],
}

impl BisectionGame {
    /// Create a new bisection game
    pub fn new(
        pre_state_root: [u8; 32],
        post_state_root: [u8; 32],
        expected_post_state_root: [u8; 32],
        transactions: Vec<Transaction>,
    ) -> Self {
        // Generate a game ID
        let mut id_data = Vec::new();
        id_data.extend_from_slice(&pre_state_root);
        id_data.extend_from_slice(&post_state_root);
        id_data.extend_from_slice(&expected_post_state_root);
        let id = keccak::hash(&id_data).to_bytes();
        
        // Create the initial step
        let initial_step = BisectionStep {
            index: 0,
            pre_state_root,
            post_state_root,
            transactions: transactions.clone(),
            start_index: 0,
            end_index: transactions.len(),
        };
        
        Self {
            id,
            initial_pre_state_root: pre_state_root,
            initial_post_state_root: post_state_root,
            expected_post_state_root,
            transactions,
            steps: vec![initial_step],
            state: BisectionGameState::InProgress,
            current_step_index: 0,
            timeout_timestamp: 0, // Will be set when the game is started
            challenger: [0; 32], // Will be set when the game is started
            defender: [0; 32],   // Will be set when the game is started
        }
    }
    
    /// Start the bisection game
    pub fn start(&mut self, challenger: [u8; 32], defender: [u8; 32], timeout: u64) {
        self.challenger = challenger;
        self.defender = defender;
        self.timeout_timestamp = timeout;
    }
    
    /// Perform a bisection step
    pub fn bisect(&mut self, disputed_step_index: usize) -> Result<(), &'static str> {
        // Check if the game is still in progress
        if self.state != BisectionGameState::InProgress {
            return Err("Game is not in progress");
        }
        
        // Check if the disputed step index is valid
        if disputed_step_index >= self.steps.len() {
            return Err("Invalid disputed step index");
        }
        
        // Get the disputed step
        let disputed_step = &self.steps[disputed_step_index];
        
        // Check if the step can be bisected
        if disputed_step.end_index - disputed_step.start_index <= 1 {
            // We've reached a single transaction, so we can determine the invalid one
            self.state = BisectionGameState::InvalidStateTransition;
            return Ok(());
        }
        
        // Calculate the midpoint
        let mid_index = disputed_step.start_index + (disputed_step.end_index - disputed_step.start_index) / 2;
        
        // Calculate the mid-state root
        let mid_state_root = self.calculate_mid_state_root(disputed_step, mid_index)?;
        
        // Create the two new steps
        let first_half = BisectionStep {
            index: self.steps.len(),
            pre_state_root: disputed_step.pre_state_root,
            post_state_root: mid_state_root,
            transactions: disputed_step.transactions[disputed_step.start_index..mid_index].to_vec(),
            start_index: disputed_step.start_index,
            end_index: mid_index,
        };
        
        let second_half = BisectionStep {
            index: self.steps.len() + 1,
            pre_state_root: mid_state_root,
            post_state_root: disputed_step.post_state_root,
            transactions: disputed_step.transactions[mid_index..disputed_step.end_index].to_vec(),
            start_index: mid_index,
            end_index: disputed_step.end_index,
        };
        
        // Add the new steps
        self.steps.push(first_half);
        self.steps.push(second_half);
        
        // Update the current step index
        self.current_step_index = self.steps.len() - 1;
        
        Ok(())
    }
    
    /// Calculate the mid-state root
    fn calculate_mid_state_root(&self, step: &BisectionStep, mid_index: usize) -> Result<[u8; 32], &'static str> {
        // In a real implementation, we would:
        // 1. Start with the pre-state root
        // 2. Apply all transactions up to mid_index
        // 3. Calculate the resulting state root
        
        // For this implementation, we'll simulate the process
        
        // Create a state transition for each transaction
        let mut current_root = step.pre_state_root;
        let mut block_number = 0;
        let mut timestamp = 0;
        
        for i in step.start_index..mid_index {
            if i >= self.transactions.len() {
                return Err("Transaction index out of bounds");
            }
            
            let transaction = &self.transactions[i];
            let state_transition = StateTransition::new(
                current_root,
                transaction.clone(),
                block_number,
                timestamp,
            );
            
            // Calculate the post-state root
            match state_transition.calculate_post_state_root() {
                Ok(root) => {
                    current_root = root;
                    block_number += 1;
                    timestamp += 1;
                },
                Err(_) => return Err("Failed to calculate post-state root"),
            }
        }
        
        Ok(current_root)
    }
    
    /// Check if the game has timed out
    pub fn check_timeout(&mut self, current_timestamp: u64) -> bool {
        if self.state == BisectionGameState::InProgress && current_timestamp > self.timeout_timestamp {
            self.state = BisectionGameState::TimedOut;
            true
        } else {
            false
        }
    }
    
    /// Get the current game state
    pub fn get_state(&self) -> BisectionGameState {
        self.state
    }
    
    /// Get the current step
    pub fn get_current_step(&self) -> Option<&BisectionStep> {
        if self.current_step_index < self.steps.len() {
            Some(&self.steps[self.current_step_index])
        } else {
            None
        }
    }
    
    /// Get all steps
    pub fn get_steps(&self) -> &[BisectionStep] {
        &self.steps
    }
    
    /// Get the game ID
    pub fn get_id(&self) -> [u8; 32] {
        self.id
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_bisection_game_creation() {
        // Create a transaction
        let transaction = Transaction {
            sender: [1; 32],
            recipient: [2; 32],
            amount: 100,
            nonce: 0,
            data: Vec::new(),
            signature: [0; 64],
        };
        
        // Create a bisection game
        let game = BisectionGame::new(
            [1; 32],
            [2; 32],
            [3; 32],
            vec![transaction],
        );
        
        // Verify the game is in progress
        assert_eq!(game.state, BisectionGameState::InProgress);
        
        // Verify the game has one step
        assert_eq!(game.steps.len(), 1);
        
        // Verify the step has the correct pre and post state roots
        let step = &game.steps[0];
        assert_eq!(step.pre_state_root, [1; 32]);
        assert_eq!(step.post_state_root, [2; 32]);
    }
    
    #[test]
    fn test_bisection_game_bisect() {
        // Create multiple transactions
        let transactions = vec![
            Transaction {
                sender: [1; 32],
                recipient: [2; 32],
                amount: 100,
                nonce: 0,
                data: Vec::new(),
                signature: [0; 64],
            },
            Transaction {
                sender: [2; 32],
                recipient: [3; 32],
                amount: 50,
                nonce: 0,
                data: Vec::new(),
                signature: [0; 64],
            },
            Transaction {
                sender: [3; 32],
                recipient: [4; 32],
                amount: 25,
                nonce: 0,
                data: Vec::new(),
                signature: [0; 64],
            },
            Transaction {
                sender: [4; 32],
                recipient: [5; 32],
                amount: 10,
                nonce: 0,
                data: Vec::new(),
                signature: [0; 64],
            },
        ];
        
        // Create a bisection game
        let mut game = BisectionGame::new(
            [1; 32],
            [2; 32],
            [3; 32],
            transactions,
        );
        
        // Start the game
        game.start([10; 32], [20; 32], 1000);
        
        // Perform a bisection step
        let result = game.bisect(0);
        assert!(result.is_ok());
        
        // Verify the game has three steps (original + 2 new)
        assert_eq!(game.steps.len(), 3);
        
        // Verify the new steps have the correct start and end indices
        let first_half = &game.steps[1];
        let second_half = &game.steps[2];
        assert_eq!(first_half.start_index, 0);
        assert_eq!(first_half.end_index, 2);
        assert_eq!(second_half.start_index, 2);
        assert_eq!(second_half.end_index, 4);
    }
    
    #[test]
    fn test_bisection_game_timeout() {
        // Create a transaction
        let transaction = Transaction {
            sender: [1; 32],
            recipient: [2; 32],
            amount: 100,
            nonce: 0,
            data: Vec::new(),
            signature: [0; 64],
        };
        
        // Create a bisection game
        let mut game = BisectionGame::new(
            [1; 32],
            [2; 32],
            [3; 32],
            vec![transaction],
        );
        
        // Start the game with a timeout
        game.start([10; 32], [20; 32], 1000);
        
        // Check timeout before the deadline
        let result = game.check_timeout(500);
        assert!(!result);
        assert_eq!(game.state, BisectionGameState::InProgress);
        
        // Check timeout after the deadline
        let result = game.check_timeout(1500);
        assert!(result);
        assert_eq!(game.state, BisectionGameState::TimedOut);
    }
}
