// src/interfaces/sequencer_interface.rs
//! Sequencer Interface for Layer-2 on Solana
//!
//! This module defines the interface for interacting with the sequencer system.
//! It provides a clean abstraction layer over the sequencer implementation details.

use solana_program::hash::Hash;
use solana_program::pubkey::Pubkey;
use solana_program::program_error::ProgramError;
use std::sync::{Arc, Mutex};

use crate::rollup::optimistic_rollup::{RollupTransaction, Batch};
use crate::sequencer::{
    TransactionSequencer, SequencerConfig, SequencerStats, TransactionStatus
};

/// Interface for interacting with the sequencer system
pub trait SequencerInterface {
    /// Start the sequencer
    fn start(&mut self);
    
    /// Stop the sequencer
    fn stop(&mut self);
    
    /// Add a transaction to the sequencer
    fn add_transaction(&mut self, transaction: RollupTransaction) -> Result<Hash, ProgramError>;
    
    /// Submit a batch of transactions to the rollup
    fn submit_batch(&mut self) -> Result<u64, ProgramError>;
    
    /// Get transaction status
    fn get_transaction_status(&self, hash: &Hash) -> Option<TransactionStatus>;
    
    /// Get batch by ID
    fn get_batch(&self, batch_id: u64) -> Option<Batch>;
    
    /// Get sequencer statistics
    fn get_stats(&self) -> SequencerStats;
    
    /// Clean up expired transactions
    fn cleanup_expired_transactions(&mut self) -> usize;
}

/// Implementation of the sequencer interface using the TransactionSequencer
pub struct SequencerInterfaceImpl {
    /// The underlying sequencer instance
    sequencer: Arc<Mutex<TransactionSequencer>>,
}

impl SequencerInterfaceImpl {
    /// Create a new sequencer interface instance
    pub fn new(sequencer: Arc<Mutex<TransactionSequencer>>) -> Self {
        SequencerInterfaceImpl { sequencer }
    }
}

impl SequencerInterface for SequencerInterfaceImpl {
    fn start(&mut self) {
        let mut sequencer = self.sequencer.lock().unwrap();
        sequencer.start();
    }
    
    fn stop(&mut self) {
        let mut sequencer = self.sequencer.lock().unwrap();
        sequencer.stop();
    }
    
    fn add_transaction(&mut self, transaction: RollupTransaction) -> Result<Hash, ProgramError> {
        let mut sequencer = self.sequencer.lock().unwrap();
        sequencer.add_transaction(transaction)
    }
    
    fn submit_batch(&mut self) -> Result<u64, ProgramError> {
        let mut sequencer = self.sequencer.lock().unwrap();
        sequencer.submit_batch()
    }
    
    fn get_transaction_status(&self, hash: &Hash) -> Option<TransactionStatus> {
        let sequencer = self.sequencer.lock().unwrap();
        sequencer.get_transaction_status(hash)
    }
    
    fn get_batch(&self, batch_id: u64) -> Option<Batch> {
        let sequencer = self.sequencer.lock().unwrap();
        sequencer.get_batch(batch_id).cloned()
    }
    
    fn get_stats(&self) -> SequencerStats {
        let sequencer = self.sequencer.lock().unwrap();
        sequencer.get_stats()
    }
    
    fn cleanup_expired_transactions(&mut self) -> usize {
        let mut sequencer = self.sequencer.lock().unwrap();
        sequencer.cleanup_expired_transactions()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, RwLock};
    use crate::rollup::OptimisticRollup;
    
    #[test]
    fn test_sequencer_interface() {
        // Create rollup
        let rollup = Arc::new(RwLock::new(OptimisticRollup::new()));
        
        // Create sequencer
        let sequencer_account = Pubkey::new_unique();
        let config = SequencerConfig::default();
        let sequencer = Arc::new(Mutex::new(
            TransactionSequencer::new(config, Arc::clone(&rollup), sequencer_account)
        ));
        
        // Create interface
        let mut interface = SequencerInterfaceImpl::new(Arc::clone(&sequencer));
        
        // Add balance to sender in rollup
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        {
            let mut rollup_instance = rollup.write().unwrap();
            rollup_instance.balances.insert(sender, 1000);
        }
        
        // Create transaction
        let transaction = RollupTransaction {
            sender,
            recipient,
            amount: 100,
            data: vec![],
            signature: vec![1, 2, 3], // Dummy signature
            nonce: 1,
            gas_price: 20,
            gas_limit: 5,
        };
        
        // Add transaction through interface
        let hash = interface.add_transaction(transaction.clone()).unwrap();
        
        // Verify transaction was added
        let status = interface.get_transaction_status(&hash).unwrap();
        assert_eq!(status, TransactionStatus::Pending);
        
        // Verify stats
        let stats = interface.get_stats();
        assert_eq!(stats.total_transactions, 1);
        assert_eq!(stats.pending_transactions, 1);
        
        // Add more transactions to meet batch threshold
        for i in 0..2 {
            let tx = RollupTransaction {
                sender,
                recipient,
                amount: 100,
                data: vec![],
                signature: vec![i+4, i+5, i+6], // Dummy signature
                nonce: i+2,
                gas_price: 20,
                gas_limit: 5,
            };
            
            interface.add_transaction(tx).unwrap();
        }
        
        // Submit batch through interface
        let batch_id = interface.submit_batch().unwrap();
        
        // Verify batch was created
        let batch = interface.get_batch(batch_id).unwrap();
        assert_eq!(batch.sequencer, sequencer_account);
        
        // Verify stats after batch submission
        let stats = interface.get_stats();
        assert_eq!(stats.total_transactions, 3);
        assert_eq!(stats.pending_transactions, 0);
        assert_eq!(stats.included_transactions, 3);
        assert_eq!(stats.total_batches, 1);
    }
}
