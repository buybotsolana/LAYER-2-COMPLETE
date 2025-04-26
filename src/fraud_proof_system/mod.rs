// src/fraud_proof_system/mod.rs
//! Fraud Proof System module for Layer-2 on Solana
//! 
//! This module integrates all components of the fraud proof system:
//! - Merkle Tree implementation
//! - State transition logic
//! - Fraud proof generation and verification
//! - Solana runtime wrapper
//! - Bisection game for interactive verification

mod merkle_tree;
mod state_transition;
mod fraud_proof;
mod solana_runtime_wrapper;
mod bisection;
mod verification;
mod optimized_merkle_tree;

pub use merkle_tree::MerkleTree;
pub use state_transition::{StateTransition, State, StateTransitionError};
pub use fraud_proof::{FraudProof, FraudProofType, FraudProofError, ExecutionTrace, ExecutionStep, StateChange};
pub use solana_runtime_wrapper::{SolanaRuntimeWrapper, ExecutionResult};
pub use bisection::{BisectionGame, BisectionStep, BisectionGameState};
pub use verification::{verify_fraud_proof, ProofVerificationResult};
pub use optimized_merkle_tree::OptimizedMerkleTree;

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

/// Storage for fraud proofs
#[derive(Debug)]
pub struct FraudProofStorage {
    /// Map of fraud proof ID to fraud proof
    proofs: HashMap<[u8; 32], FraudProof>,
}

impl FraudProofStorage {
    /// Create a new fraud proof storage
    pub fn new() -> Self {
        Self {
            proofs: HashMap::new(),
        }
    }

    /// Store a fraud proof
    pub fn store(&mut self, proof: FraudProof) -> [u8; 32] {
        let proof_id = proof.hash();
        self.proofs.insert(proof_id, proof);
        proof_id
    }

    /// Get a fraud proof by ID
    pub fn get(&self, proof_id: &[u8; 32]) -> Option<&FraudProof> {
        self.proofs.get(proof_id)
    }

    /// Remove a fraud proof by ID
    pub fn remove(&mut self, proof_id: &[u8; 32]) -> Option<FraudProof> {
        self.proofs.remove(proof_id)
    }

    /// Get all fraud proofs
    pub fn get_all(&self) -> Vec<&FraudProof> {
        self.proofs.values().collect()
    }
}

/// Storage for bisection games
#[derive(Debug)]
pub struct BisectionGameStorage {
    /// Map of game ID to bisection game
    games: HashMap<[u8; 32], BisectionGame>,
}

impl BisectionGameStorage {
    /// Create a new bisection game storage
    pub fn new() -> Self {
        Self {
            games: HashMap::new(),
        }
    }

    /// Store a bisection game
    pub fn store(&mut self, game: BisectionGame) -> [u8; 32] {
        let game_id = game.get_id();
        self.games.insert(game_id, game);
        game_id
    }

    /// Get a bisection game by ID
    pub fn get(&self, game_id: &[u8; 32]) -> Option<&BisectionGame> {
        self.games.get(game_id)
    }

    /// Get a mutable bisection game by ID
    pub fn get_mut(&mut self, game_id: &[u8; 32]) -> Option<&mut BisectionGame> {
        self.games.get_mut(game_id)
    }

    /// Remove a bisection game by ID
    pub fn remove(&mut self, game_id: &[u8; 32]) -> Option<BisectionGame> {
        self.games.remove(game_id)
    }

    /// Get all bisection games
    pub fn get_all(&self) -> Vec<&BisectionGame> {
        self.games.values().collect()
    }

    /// Check timeouts for all games
    pub fn check_timeouts(&mut self, current_timestamp: u64) -> Vec<[u8; 32]> {
        let mut timed_out_games = Vec::new();
        
        for (game_id, game) in self.games.iter_mut() {
            if game.check_timeout(current_timestamp) {
                timed_out_games.push(*game_id);
            }
        }
        
        timed_out_games
    }
}

/// Fraud proof system for the Layer-2 solution
pub struct FraudProofSystem {
    /// Solana runtime wrapper
    pub runtime: solana_runtime_wrapper::SolanaRuntimeWrapper,
    
    /// Fraud proof storage
    pub proof_storage: FraudProofStorage,
    
    /// Bisection game storage
    pub game_storage: BisectionGameStorage,
}

impl FraudProofSystem {
    /// Create a new fraud proof system
    pub fn new() -> Self {
        Self {
            runtime: solana_runtime_wrapper::SolanaRuntimeWrapper::new(),
            proof_storage: FraudProofStorage::new(),
            game_storage: BisectionGameStorage::new(),
        }
    }
    
    /// Initialize the fraud proof system
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        // Initialize the runtime with the system account
        self.runtime.initialize(system_account)?;
        
        msg!("Fraud proof system initialized");
        
        Ok(())
    }
    
    /// Generate a fraud proof for an invalid state transition
    pub fn generate_fraud_proof(
        &self,
        pre_state_root: [u8; 32],
        post_state_root: [u8; 32],
        expected_post_state_root: [u8; 32],
        transaction_data: &[u8],
        proof_type: fraud_proof::FraudProofType,
    ) -> Result<fraud_proof::FraudProof, fraud_proof::FraudProofError> {
        // Deserialize the transaction
        let transaction = match bincode::deserialize(transaction_data) {
            Ok(tx) => tx,
            Err(e) => return Err(fraud_proof::FraudProofError::GenericError(e.to_string())),
        };
        
        // Create a state transition
        let state_transition = StateTransition::new(
            pre_state_root,
            transaction,
            0, // Block number not relevant here
            0, // Timestamp not relevant here
        );
        
        // Execute the transaction to generate an execution trace
        let execution_result = self.runtime.execute_transaction(&state_transition)?;
        
        // Generate the fraud proof
        fraud_proof::generate_fraud_proof(
            &state_transition,
            expected_post_state_root,
            proof_type,
            execution_result.execution_trace,
        )
    }
    
    /// Store a fraud proof
    pub fn store_fraud_proof(
        &mut self,
        proof: fraud_proof::FraudProof,
    ) -> [u8; 32] {
        self.proof_storage.store(proof)
    }
    
    /// Get a fraud proof by ID
    pub fn get_fraud_proof(
        &self,
        proof_id: &[u8; 32],
    ) -> Option<&fraud_proof::FraudProof> {
        self.proof_storage.get(proof_id)
    }
    
    /// Verify a fraud proof
    pub fn verify_fraud_proof(
        &self,
        proof: &fraud_proof::FraudProof,
    ) -> Result<bool, fraud_proof::FraudProofError> {
        // Verify the fraud proof using the verification module
        verification::verify_fraud_proof(proof, &self.runtime)
    }
    
    /// Start a bisection game for an invalid state transition
    pub fn start_bisection_game(
        &mut self,
        pre_state_root: [u8; 32],
        post_state_root: [u8; 32],
        expected_post_state_root: [u8; 32],
        transaction_data: &[u8],
    ) -> Result<bisection::BisectionGame, fraud_proof::FraudProofError> {
        // Deserialize the transaction
        let transaction = match bincode::deserialize(transaction_data) {
            Ok(tx) => tx,
            Err(e) => return Err(fraud_proof::FraudProofError::GenericError(e.to_string())),
        };
        
        // Create a bisection game
        let game = bisection::BisectionGame::new(
            pre_state_root,
            post_state_root,
            expected_post_state_root,
            vec![transaction],
        );
        
        // Store the game
        self.game_storage.store(game.clone());
        
        Ok(game)
    }
    
    /// Perform a bisection step
    pub fn perform_bisection_step(
        &mut self,
        game_id: &[u8; 32],
        disputed_step_index: usize,
    ) -> Result<(), fraud_proof::FraudProofError> {
        // Get the game
        let game = self.game_storage.get_mut(game_id)
            .ok_or_else(|| fraud_proof::FraudProofError::GenericError("Game not found".to_string()))?;
        
        // Perform the bisection step
        game.bisect(disputed_step_index)
            .map_err(|e| fraud_proof::FraudProofError::GenericError(e.to_string()))?;
        
        Ok(())
    }
    
    /// Check timeouts for all games
    pub fn check_timeouts(&mut self, current_timestamp: u64) -> Vec<[u8; 32]> {
        self.game_storage.check_timeouts(current_timestamp)
    }
}

/// Fraud proof instruction types
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum FraudProofInstruction {
    /// Generate a fraud proof
    GenerateFraudProof {
        /// Pre-state root
        pre_state_root: [u8; 32],
        
        /// Post-state root
        post_state_root: [u8; 32],
        
        /// Expected post-state root
        expected_post_state_root: [u8; 32],
        
        /// Transaction data
        transaction_data: Vec<u8>,
        
        /// Proof type
        proof_type: u8,
    },
    
    /// Verify a fraud proof
    VerifyFraudProof {
        /// Fraud proof data
        proof_data: Vec<u8>,
    },
    
    /// Start a bisection game
    StartBisectionGame {
        /// Pre-state root
        pre_state_root: [u8; 32],
        
        /// Post-state root
        post_state_root: [u8; 32],
        
        /// Expected post-state root
        expected_post_state_root: [u8; 32],
        
        /// Transaction data
        transaction_data: Vec<u8>,
        
        /// Challenger address
        challenger: [u8; 32],
        
        /// Defender address
        defender: [u8; 32],
    },
    
    /// Perform a bisection step
    BisectionStep {
        /// Game ID
        game_id: [u8; 32],
        
        /// Disputed step index
        disputed_step_index: u64,
    },
    
    /// Check timeouts for bisection games
    CheckTimeouts,
}

/// Process fraud proof instruction
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction: &FraudProofInstruction,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    
    // Get the system account
    let system_account = next_account_info(account_info_iter)?;
    
    // Create or get the fraud proof system
    let mut fraud_proof_system = FraudProofSystem::new();
    
    match instruction {
        FraudProofInstruction::GenerateFraudProof {
            pre_state_root,
            post_state_root,
            expected_post_state_root,
            transaction_data,
            proof_type,
        } => {
            // Convert proof type
            let proof_type_enum = match proof_type {
                0 => FraudProofType::ExecutionFraud,
                1 => FraudProofType::StateTransitionFraud,
                2 => FraudProofType::DataAvailabilityFraud,
                3 => FraudProofType::DerivationFraud,
                _ => return Err(ProgramError::InvalidArgument),
            };
            
            // Generate the fraud proof
            let fraud_proof = fraud_proof_system.generate_fraud_proof(
                *pre_state_root,
                *post_state_root,
                *expected_post_state_root,
                transaction_data,
                proof_type_enum,
            ).map_err(|e| {
                msg!("Error generating fraud proof: {}", e);
                ProgramError::InvalidArgument
            })?;
            
            // Store the fraud proof
            let proof_id = fraud_proof_system.store_fraud_proof(fraud_proof);
            
            // Log the proof ID
            msg!("Generated and stored fraud proof with ID: {:?}", proof_id);
            
            Ok(())
        },
        FraudProofInstruction::VerifyFraudProof { proof_data } => {
            // Deserialize the fraud proof
            let fraud_proof = FraudProof::deserialize(proof_data)
                .map_err(|e| {
                    msg!("Error deserializing fraud proof: {}", e);
                    ProgramError::InvalidArgument
                })?;
            
            // Verify the fraud proof
            let result = fraud_proof_system.verify_fraud_proof(&fraud_proof)
                .map_err(|e| {
                    msg!("Error verifying fraud proof: {}", e);
                    ProgramError::InvalidArgument
                })?;
            
            // Log the result
            msg!("Fraud proof verification result: {}", result);
            
            Ok(())
        },
        FraudProofInstruction::StartBisectionGame {
            pre_state_root,
            post_state_root,
            expected_post_state_root,
            transaction_data,
            challenger,
            defender,
        } => {
            // Start the bisection game
            let mut game = fraud_proof_system.start_bisection_game(
                *pre_state_root,
                *post_state_root,
                *expected_post_state_root,
                transaction_data,
            ).map_err(|e| {
                msg!("Error starting bisection game: {}", e);
                ProgramError::InvalidArgument
            })?;
            
            // Get the current timestamp
            let clock = Clock::get()?;
            let current_timestamp = clock.unix_timestamp as u64;
            
            // Set the timeout (e.g., 7 days from now)
            let timeout = current_timestamp + 7 * 24 * 60 * 60;
            
            // Start the game with the challenger, defender, and timeout
            game.start(*challenger, *defender, timeout);
            
            // Store the game
            let game_id = fraud_proof_system.game_storage.store(game);
            
            // Log the game ID
            msg!("Started bisection game with ID: {:?}", game_id);
            
            Ok(())
        },
        FraudProofInstruction::BisectionStep { game_id, disputed_step_index } => {
            // Perform the bisection step
            fraud_proof_system.perform_bisection_step(
                game_id,
                *disputed_step_index as usize,
            ).map_err(|e| {
                msg!("Error performing bisection step: {}", e);
                ProgramError::InvalidArgument
            })?;
            
            // Log the step
            msg!("Performed bisection step for game: {:?}", game_id);
            
            Ok(())
        },
        FraudProofInstruction::CheckTimeouts => {
            // Get the current timestamp
            let clock = Clock::get()?;
            let current_timestamp = clock.unix_timestamp as u64;
            
            // Check timeouts for all games
            let timed_out_games = fraud_proof_system.check_timeouts(current_timestamp);
            
            // Log the timed out games
            msg!("Checked timeouts, found {} timed out games", timed_out_games.len());
            
            Ok(())
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_fraud_proof_system_creation() {
        let fps = FraudProofSystem::new();
        // Verify the system is created with empty storages
        assert_eq!(fps.proof_storage.get_all().len(), 0);
        assert_eq!(fps.game_storage.get_all().len(), 0);
    }
    
    #[test]
    fn test_fraud_proof_storage() {
        // Create a fraud proof
        let fraud_proof = FraudProof::new(
            [1; 32],
            [2; 32],
            [3; 32],
            vec![4, 5, 6],
            FraudProofType::ExecutionFraud,
            ExecutionTrace {
                intermediate_state_roots: vec![[7; 32]],
                execution_steps: vec![],
            },
            vec![8, 9, 10],
        );
        
        // Create a fraud proof storage
        let mut storage = FraudProofStorage::new();
        
        // Store the fraud proof
        let proof_id = storage.store(fraud_proof.clone());
        
        // Get the fraud proof
        let retrieved_proof = storage.get(&proof_id).unwrap();
        
        // Verify the retrieved proof matches the original
        assert_eq!(retrieved_proof.pre_state_root, fraud_proof.pre_state_root);
        assert_eq!(retrieved_proof.post_state_root, fraud_proof.post_state_root);
        assert_eq!(retrieved_proof.expected_post_state_root, fraud_proof.expected_post_state_root);
        assert_eq!(retrieved_proof.transaction_data, fraud_proof.transaction_data);
        assert_eq!(retrieved_proof.proof_type, fraud_proof.proof_type);
        assert_eq!(retrieved_proof.witness_data, fraud_proof.witness_data);
    }
    
    #[test]
    fn test_bisection_game_storage() {
        // Create a transaction
        let transaction = state_transition::Transaction {
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
        
        // Create a bisection game storage
        let mut storage = BisectionGameStorage::new();
        
        // Store the game
        let game_id = storage.store(game.clone());
        
        // Get the game
        let retrieved_game = storage.get(&game_id).unwrap();
        
        // Verify the retrieved game matches the original
        assert_eq!(retrieved_game.initial_pre_state_root, game.initial_pre_state_root);
        assert_eq!(retrieved_game.initial_post_state_root, game.initial_post_state_root);
        assert_eq!(retrieved_game.expected_post_state_root, game.expected_post_state_root);
        assert_eq!(retrieved_game.state, game.state);
    }
}
