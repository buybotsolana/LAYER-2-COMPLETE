// src/interfaces/rollup_interface.rs
//! Rollup Interface for Layer-2 on Solana
//!
//! This module defines the interface for interacting with the optimistic rollup system.
//! It provides a clean abstraction layer over the rollup implementation details.

use solana_program::hash::Hash;
use solana_program::pubkey::Pubkey;
use solana_program::program_error::ProgramError;
use std::sync::{Arc, RwLock};

use crate::rollup::{
    OptimisticRollup, RollupTransaction, Batch, BatchStatus, Challenge, ChallengeReason
};

/// Interface for interacting with the optimistic rollup system
pub trait RollupInterface {
    /// Create a new batch of transactions
    fn create_batch(&self, transactions: Vec<RollupTransaction>, sequencer: Pubkey) -> Result<u64, ProgramError>;
    
    /// Submit a challenge to a batch
    fn challenge_batch(&self, batch_id: u64, challenger: Pubkey, reason: ChallengeReason, stake: u64) -> Result<(), ProgramError>;
    
    /// Resolve a challenge
    fn resolve_challenge(&self, batch_id: u64, challenge_index: usize, is_valid: bool) -> Result<(), ProgramError>;
    
    /// Finalize a batch after challenge period
    fn finalize_batch(&self, batch_id: u64) -> Result<(), ProgramError>;
    
    /// Get batch by ID
    fn get_batch(&self, batch_id: u64) -> Option<Batch>;
    
    /// Get challenges for a batch
    fn get_challenges(&self, batch_id: u64) -> Option<Vec<Challenge>>;
    
    /// Get account balance
    fn get_balance(&self, account: &Pubkey) -> u64;
    
    /// Get account nonce
    fn get_nonce(&self, account: &Pubkey) -> u64;
}

/// Implementation of the rollup interface using the OptimisticRollup
pub struct RollupInterfaceImpl {
    /// The underlying rollup instance
    rollup: Arc<RwLock<OptimisticRollup>>,
}

impl RollupInterfaceImpl {
    /// Create a new rollup interface instance
    pub fn new(rollup: Arc<RwLock<OptimisticRollup>>) -> Self {
        RollupInterfaceImpl { rollup }
    }
}

impl RollupInterface for RollupInterfaceImpl {
    fn create_batch(&self, transactions: Vec<RollupTransaction>, sequencer: Pubkey) -> Result<u64, ProgramError> {
        let mut rollup = self.rollup.write().unwrap();
        rollup.create_batch(transactions, sequencer)
    }
    
    fn challenge_batch(&self, batch_id: u64, challenger: Pubkey, reason: ChallengeReason, stake: u64) -> Result<(), ProgramError> {
        let mut rollup = self.rollup.write().unwrap();
        rollup.challenge_batch(batch_id, challenger, reason, stake)
    }
    
    fn resolve_challenge(&self, batch_id: u64, challenge_index: usize, is_valid: bool) -> Result<(), ProgramError> {
        let mut rollup = self.rollup.write().unwrap();
        rollup.resolve_challenge(batch_id, challenge_index, is_valid)
    }
    
    fn finalize_batch(&self, batch_id: u64) -> Result<(), ProgramError> {
        let mut rollup = self.rollup.write().unwrap();
        rollup.finalize_batch(batch_id)
    }
    
    fn get_batch(&self, batch_id: u64) -> Option<Batch> {
        let rollup = self.rollup.read().unwrap();
        rollup.get_batch(batch_id).cloned()
    }
    
    fn get_challenges(&self, batch_id: u64) -> Option<Vec<Challenge>> {
        let rollup = self.rollup.read().unwrap();
        rollup.get_challenges(batch_id).cloned()
    }
    
    fn get_balance(&self, account: &Pubkey) -> u64 {
        let rollup = self.rollup.read().unwrap();
        rollup.get_balance(account)
    }
    
    fn get_nonce(&self, account: &Pubkey) -> u64 {
        let rollup = self.rollup.read().unwrap();
        rollup.get_nonce(account)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};
    
    #[test]
    fn test_rollup_interface() {
        // Create rollup
        let rollup = Arc::new(RwLock::new(OptimisticRollup::new()));
        
        // Add balance to sender
        {
            let mut rollup_instance = rollup.write().unwrap();
            let sender = Pubkey::new_unique();
            rollup_instance.balances.insert(sender, 1000);
        }
        
        // Create interface
        let interface = RollupInterfaceImpl::new(Arc::clone(&rollup));
        
        // Create transaction
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        let sequencer = Pubkey::new_unique();
        
        // Add balance to sender
        {
            let mut rollup_instance = rollup.write().unwrap();
            rollup_instance.balances.insert(sender, 1000);
        }
        
        // Create transaction
        let tx = RollupTransaction {
            sender,
            recipient,
            amount: 100,
            data: vec![],
            signature: vec![1, 2, 3], // Dummy signature
            nonce: 1,
            gas_price: 10,
            gas_limit: 5,
        };
        
        // Create batch through interface
        let batch_id = interface.create_batch(vec![tx], sequencer).unwrap();
        
        // Verify batch was created
        let batch = interface.get_batch(batch_id).unwrap();
        assert_eq!(batch.transactions.len(), 1);
        assert_eq!(batch.status, BatchStatus::Pending);
        assert_eq!(batch.sequencer, sequencer);
        
        // Verify balance
        let balance = interface.get_balance(&sender);
        assert_eq!(balance, 1000); // Balance not yet updated until finalization
        
        // Manually set batch timestamp to be in the past to allow finalization
        {
            let mut rollup_instance = rollup.write().unwrap();
            if let Some(batch) = rollup_instance.batches.get_mut(&batch_id) {
                batch.timestamp = SystemTime::now() - Duration::from_secs(7 * 24 * 60 * 60 + 1);
            }
        }
        
        // Finalize batch through interface
        interface.finalize_batch(batch_id).unwrap();
        
        // Verify batch was finalized
        let batch = interface.get_batch(batch_id).unwrap();
        assert_eq!(batch.status, BatchStatus::Finalized);
        
        // Verify balance was updated
        let balance = interface.get_balance(&sender);
        assert_eq!(balance, 850); // 1000 - 100 amount - 50 gas
        
        // Verify recipient balance
        let recipient_balance = interface.get_balance(&recipient);
        assert_eq!(recipient_balance, 100);
    }
}
