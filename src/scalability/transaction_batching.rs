// src/scalability/transaction_batching.rs
//! Transaction Batching module for Scalability Optimization
//! 
//! This module implements transaction batching:
//! - Efficient grouping of transactions
//! - Batch size optimization
//! - Priority-based batching
//! - Gas optimization for batches
//!
//! Transaction batching significantly increases throughput by
//! processing multiple transactions as a single unit.

use solana_program::{
    program_error::ProgramError,
    msg,
};
use std::collections::VecDeque;

/// Transaction batch
#[derive(Debug, Clone)]
pub struct TransactionBatch {
    /// Batch ID
    pub id: u64,
    
    /// Transactions in the batch
    pub transactions: Vec<Vec<u8>>,
    
    /// Total size in bytes
    pub total_size: usize,
    
    /// Estimated gas cost
    pub estimated_gas: u64,
    
    /// Priority level (higher is more important)
    pub priority: u32,
}

/// Transaction batcher for scalability optimization
pub struct TransactionBatcher {
    /// Maximum batch size
    max_batch_size: u32,
    
    /// Next batch ID
    next_batch_id: u64,
    
    /// Pending transactions
    pending_transactions: VecDeque<Vec<u8>>,
    
    /// Whether the transaction batcher is initialized
    initialized: bool,
}

impl TransactionBatcher {
    /// Create a new transaction batcher with default configuration
    pub fn new() -> Self {
        Self {
            max_batch_size: 1000,
            next_batch_id: 1,
            pending_transactions: VecDeque::new(),
            initialized: false,
        }
    }
    
    /// Create a new transaction batcher with the specified configuration
    pub fn with_config(max_batch_size: u32) -> Self {
        Self {
            max_batch_size,
            next_batch_id: 1,
            pending_transactions: VecDeque::new(),
            initialized: false,
        }
    }
    
    /// Initialize the transaction batcher
    pub fn initialize(&mut self) -> Result<(), ProgramError> {
        self.initialized = true;
        
        msg!("Transaction batcher initialized");
        
        Ok(())
    }
    
    /// Check if the transaction batcher is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Add a transaction to the pending queue
    pub fn add_transaction(&mut self, transaction: Vec<u8>) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        self.pending_transactions.push_back(transaction);
        
        Ok(())
    }
    
    /// Batch transactions
    pub fn batch_transactions(&mut self, transactions: &[Vec<u8>]) -> Result<Vec<TransactionBatch>, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        let mut batches = Vec::new();
        let mut current_batch = Vec::new();
        let mut current_size = 0;
        
        for transaction in transactions {
            // If adding this transaction would exceed the max batch size, create a new batch
            if current_batch.len() >= self.max_batch_size as usize {
                // Create a batch with the current transactions
                let batch_id = self.next_batch_id;
                self.next_batch_id += 1;
                
                let batch = TransactionBatch {
                    id: batch_id,
                    transactions: current_batch,
                    total_size: current_size,
                    estimated_gas: 0, // In a real implementation, we would estimate the gas cost
                    priority: 0, // In a real implementation, we would assign a priority
                };
                
                batches.push(batch);
                
                // Start a new batch
                current_batch = Vec::new();
                current_size = 0;
            }
            
            // Add the transaction to the current batch
            current_batch.push(transaction.clone());
            current_size += transaction.len();
        }
        
        // If there are any transactions left in the current batch, create a final batch
        if !current_batch.is_empty() {
            let batch_id = self.next_batch_id;
            self.next_batch_id += 1;
            
            let batch = TransactionBatch {
                id: batch_id,
                transactions: current_batch,
                total_size: current_size,
                estimated_gas: 0, // In a real implementation, we would estimate the gas cost
                priority: 0, // In a real implementation, we would assign a priority
            };
            
            batches.push(batch);
        }
        
        msg!("Transactions batched: {} batches created", batches.len());
        
        Ok(batches)
    }
    
    /// Process pending transactions
    pub fn process_pending(&mut self) -> Result<Vec<TransactionBatch>, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Convert the pending transactions to a vector
        let transactions: Vec<Vec<u8>> = self.pending_transactions.drain(..).collect();
        
        // Batch the transactions
        self.batch_transactions(&transactions)
    }
    
    /// Estimate gas for a batch
    pub fn estimate_gas(&self, batch: &TransactionBatch) -> u64 {
        // In a real implementation, we would estimate the gas cost based on the transactions
        // For now, we'll use a simple heuristic based on the total size
        (batch.total_size as u64) * 100
    }
    
    /// Prioritize batches
    pub fn prioritize_batches(&mut self, batches: &mut [TransactionBatch]) {
        // In a real implementation, we would prioritize batches based on various factors
        // For now, we'll use a simple heuristic based on the estimated gas and size
        for batch in batches.iter_mut() {
            let estimated_gas = self.estimate_gas(batch);
            batch.estimated_gas = estimated_gas;
            
            // Higher priority for batches with lower gas cost per transaction
            if batch.transactions.len() > 0 {
                batch.priority = (1000000 / (estimated_gas / batch.transactions.len() as u64)) as u32;
            }
        }
        
        // Sort batches by priority (higher priority first)
        batches.sort_by(|a, b| b.priority.cmp(&a.priority));
    }
    
    /// Update the transaction batcher configuration
    pub fn update_config(&mut self, max_batch_size: u32) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        self.max_batch_size = max_batch_size;
        
        msg!("Transaction batcher configuration updated");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_transaction_batcher_creation() {
        let batcher = TransactionBatcher::new();
        assert!(!batcher.is_initialized());
    }
    
    #[test]
    fn test_transaction_batcher_with_config() {
        let batcher = TransactionBatcher::with_config(500);
        assert!(!batcher.is_initialized());
        assert_eq!(batcher.max_batch_size, 500);
    }
}
