// src/bisection.rs
//! Bisection game for interactive fraud proof verification
//! 
//! This module implements a bisection game that allows for interactive
//! verification of fraud proofs by narrowing down the exact point of disagreement.

use crate::merkle_tree::MerkleTree;
use crate::state_transition::{StateTransition, State};
use crate::fraud_proof::{FraudProof, FraudProofType};
use solana_sdk::transaction::Transaction;
use std::collections::HashMap;

/// Represents a step in the bisection game
#[derive(Debug, Clone)]
pub struct BisectionStep {
    /// The index of the step
    pub index: usize,
    
    /// The state root at this step
    pub state_root: [u8; 32],
    
    /// The transaction that was executed at this step (if any)
    pub transaction: Option<Transaction>,
    
    /// The execution trace for this step
    pub execution_trace: Vec<u8>,
}

/// Represents the state of a bisection game
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BisectionGameState {
    /// The game is in progress
    InProgress,
    
    /// The game has been won by the challenger
    ChallengerWon,
    
    /// The game has been won by the defender
    DefenderWon,
    
    /// The game has been aborted
    Aborted,
}

/// Represents a bisection game for interactive fraud proof verification
pub struct BisectionGame {
    /// The pre-state root (before all transactions)
    pub pre_state_root: [u8; 32],
    
    /// The post-state root (after all transactions)
    pub post_state_root: [u8; 32],
    
    /// The expected post-state root
    pub expected_post_state_root: [u8; 32],
    
    /// The transactions that were executed
    pub transactions: Vec<Transaction>,
    
    /// The intermediate state roots after each transaction
    pub intermediate_state_roots: Vec<[u8; 32]>,
    
    /// The current state of the game
    pub state: BisectionGameState,
    
    /// The current step in the bisection process
    pub current_step: usize,
    
    /// The steps in the bisection process
    pub steps: Vec<BisectionStep>,
    
    /// The index of the transaction that caused the disagreement
    pub disagreement_index: Option<usize>,
    
    /// Additional metadata for the game
    pub metadata: HashMap<String, Vec<u8>>,
}

impl BisectionGame {
    /// Create a new bisection game
    pub fn new(
        pre_state_root: [u8; 32],
        post_state_root: [u8; 32],
        expected_post_state_root: [u8; 32],
        transactions: Vec<Transaction>,
    ) -> Self {
        let mut game = Self {
            pre_state_root,
            post_state_root,
            expected_post_state_root,
            transactions,
            intermediate_state_roots: Vec::new(),
            state: BisectionGameState::InProgress,
            current_step: 0,
            steps: Vec::new(),
            disagreement_index: None,
            metadata: HashMap::new(),
        };
        
        // Initialize the first step
        game.steps.push(BisectionStep {
            index: 0,
            state_root: pre_state_root,
            transaction: None,
            execution_trace: Vec::new(),
        });
        
        game
    }
    
    /// Initialize the bisection game with intermediate state roots
    pub fn initialize(&mut self, intermediate_state_roots: Vec<[u8; 32]>) {
        self.intermediate_state_roots = intermediate_state_roots;
        
        // Add steps for each intermediate state
        for (i, state_root) in self.intermediate_state_roots.iter().enumerate() {
            self.steps.push(BisectionStep {
                index: i + 1,
                state_root: *state_root,
                transaction: Some(self.transactions[i].clone()),
                execution_trace: Vec::new(),
            });
        }
    }
    
    /// Perform a bisection step
    pub fn bisect(&mut self, state: &mut impl State) -> Result<BisectionStep, anyhow::Error> {
        if self.state != BisectionGameState::InProgress {
            anyhow::bail!("Game is not in progress");
        }
        
        if self.steps.len() <= 2 {
            // We've narrowed it down to a single transaction
            self.disagreement_index = Some(self.current_step);
            self.state = BisectionGameState::ChallengerWon;
            return Ok(self.steps[self.current_step].clone());
        }
        
        // Find the midpoint
        let mid_index = self.current_step + (self.steps.len() - self.current_step) / 2;
        
        // Get the state root at the midpoint
        let mid_state_root = self.steps[mid_index].state_root;
        
        // Set the state to the pre-state
        state.set_state_root(self.pre_state_root)?;
        
        // Execute transactions up to the midpoint
        for i in 0..mid_index {
            if let Some(transaction) = &self.steps[i].transaction {
                state.apply_transaction(transaction)?;
            }
        }
        
        // Calculate the state root
        let calculated_mid_state_root = state.calculate_state_root()?;
        
        // Check if the calculated state root matches the expected one
        if calculated_mid_state_root == mid_state_root {
            // The first half is correct, so the disagreement is in the second half
            self.current_step = mid_index;
        } else {
            // The disagreement is in the first half
            // We keep the current_step as is
            
            // Update the steps to only include the first half
            self.steps.truncate(mid_index + 1);
        }
        
        Ok(self.steps[self.current_step].clone())
    }
    
    /// Resolve the bisection game
    pub fn resolve(&mut self, state: &mut impl State) -> Result<FraudProof, anyhow::Error> {
        if self.state != BisectionGameState::ChallengerWon {
            anyhow::bail!("Game is not won by the challenger");
        }
        
        if let Some(disagreement_index) = self.disagreement_index {
            // Get the transaction that caused the disagreement
            let transaction = self.transactions[disagreement_index].clone();
            
            // Set the state to the pre-state
            state.set_state_root(self.steps[disagreement_index].state_root)?;
            
            // Execute the transaction
            state.apply_transaction(&transaction)?;
            
            // Calculate the state root
            let calculated_post_state_root = state.calculate_state_root()?;
            
            // Create a state transition
            let state_transition = StateTransition::new(
                self.steps[disagreement_index].state_root,
                transaction,
                0, // Block number not relevant here
                0, // Timestamp not relevant here
            );
            
            // Create a fraud proof
            let fraud_proof = FraudProof::new(
                FraudProofType::ExecutionFraud,
                self.steps[disagreement_index].state_root,
                calculated_post_state_root,
                self.steps[disagreement_index + 1].state_root,
                bincode::serialize(&transaction).unwrap_or_default(),
                0, // Block number not relevant here
                0, // Timestamp not relevant here
            );
            
            Ok(fraud_proof)
        } else {
            anyhow::bail!("No disagreement index found");
        }
    }
    
    /// Abort the bisection game
    pub fn abort(&mut self) {
        self.state = BisectionGameState::Aborted;
    }
    
    /// Check if the game is finished
    pub fn is_finished(&self) -> bool {
        self.state != BisectionGameState::InProgress
    }
    
    /// Get the current step
    pub fn get_current_step(&self) -> &BisectionStep {
        &self.steps[self.current_step]
    }
    
    /// Add metadata to the game
    pub fn add_metadata(&mut self, key: &str, value: Vec<u8>) {
        self.metadata.insert(key.to_string(), value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_sdk::signature::{Keypair, Signer};
    use solana_sdk::system_instruction;
    use solana_program::message::Message;
    use solana_program::hash::Hash;
    use std::collections::HashMap;
    
    // Mock implementation of State for testing
    struct MockState {
        state_root: [u8; 32],
        accounts: HashMap<solana_program::pubkey::Pubkey, solana_sdk::account::Account>,
    }
    
    impl MockState {
        fn new() -> Self {
            Self {
                state_root: [0; 32],
                accounts: HashMap::new(),
            }
        }
    }
    
    impl State for MockState {
        fn apply_transaction(&mut self, transaction: &Transaction) -> Result<(), anyhow::Error> {
            // Mock implementation - just update the state root
            self.state_root = [1; 32];
            Ok(())
        }
        
        fn calculate_state_root(&self) -> Result<[u8; 32], anyhow::Error> {
            Ok(self.state_root)
        }
        
        fn set_state_root(&mut self, state_root: [u8; 32]) -> Result<(), anyhow::Error> {
            self.state_root = state_root;
            Ok(())
        }
        
        fn get_state_root(&self) -> Result<[u8; 32], anyhow::Error> {
            Ok(self.state_root)
        }
        
        fn get_proof(&self, account: &solana_program::pubkey::Pubkey) -> Result<Vec<[u8; 32]>, anyhow::Error> {
            // Mock implementation - return empty proof
            Ok(vec![])
        }
        
        fn verify_proof(&self, account: &solana_program::pubkey::Pubkey, proof: &[[u8; 32]]) -> Result<bool, anyhow::Error> {
            // Mock implementation - always return true
            Ok(true)
        }
    }
    
    #[test]
    fn test_bisection_game() {
        // Create a mock state
        let mut state = MockState::new();
        
        // Create a keypair for testing
        let from_keypair = Keypair::new();
        let to_pubkey = solana_program::pubkey::Pubkey::new_unique();
        
        // Create a simple transfer transaction
        let instruction = system_instruction::transfer(
            &from_keypair.pubkey(),
            &to_pubkey,
            100,
        );
        
        let message = Message::new(&[instruction], Some(&from_keypair.pubkey()));
        let transaction = Transaction::new(
            &[&from_keypair],
            message,
            Hash::default(),
        );
        
        // Create a bisection game
        let mut game = BisectionGame::new(
            [0; 32],
            [1; 32],
            [2; 32], // Different from post_state_root
            vec![transaction],
        );
        
        // Initialize the game with intermediate state roots
        game.initialize(vec![[1; 32]]);
        
        // Perform a bisection step
        let result = game.bisect(&mut state);
        assert!(result.is_ok());
        
        // The game should be won by the challenger
        assert_eq!(game.state, BisectionGameState::ChallengerWon);
        
        // Resolve the game
        let result = game.resolve(&mut state);
        assert!(result.is_ok());
        
        // Verify the fraud proof
        let fraud_proof = result.unwrap();
        assert_eq!(fraud_proof.proof_type, FraudProofType::ExecutionFraud);
        assert_eq!(fraud_proof.pre_state_root, [0; 32]);
        assert_eq!(fraud_proof.expected_post_state_root, [1; 32]);
    }
}
