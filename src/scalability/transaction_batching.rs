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
use thiserror::Error;

/// Errors that can occur in the Transaction Batching module
#[derive(Error, Debug)]
pub enum BatchingError {
    #[error("Transaction batcher not initialized")]
    NotInitialized,

    #[error("Transaction too large: {size} bytes, maximum allowed: {max_size} bytes")]
    TransactionTooLarge { size: usize, max_size: usize },

    #[error("Batch size exceeds maximum: {size}, maximum allowed: {max_size}")]
    BatchSizeExceeded { size: usize, max_size: usize },

    #[error("Invalid batch configuration: {0}")]
    InvalidConfiguration(String),

    #[error("Empty transaction list")]
    EmptyTransactionList,

    #[error("Program error: {0}")]
    ProgramError(#[from] ProgramError),

    #[error("Unknown error")]
    Unknown,
}

/// Result type for Transaction Batching operations
pub type BatchingResult<T> = Result<T, BatchingError>;

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
    
    /// Timestamp when the batch was created
    pub created_at: u64,
}

impl TransactionBatch {
    /// Create a new transaction batch
    pub fn new(id: u64, transactions: Vec<Vec<u8>>, total_size: usize) -> Self {
        Self {
            id,
            transactions,
            total_size,
            estimated_gas: 0,
            priority: 0,
            created_at: Self::get_current_timestamp(),
        }
    }
    
    /// Get the number of transactions in the batch
    pub fn transaction_count(&self) -> usize {
        self.transactions.len()
    }
    
    /// Check if the batch is empty
    pub fn is_empty(&self) -> bool {
        self.transactions.is_empty()
    }
    
    /// Get the average transaction size
    pub fn average_transaction_size(&self) -> usize {
        if self.transactions.is_empty() {
            0
        } else {
            self.total_size / self.transactions.len()
        }
    }
    
    /// Get the current timestamp
    fn get_current_timestamp() -> u64 {
        // In a real implementation, we would use the current timestamp
        // For now, we'll just return 0
        0
    }
}

/// Transaction batcher configuration
#[derive(Debug, Clone)]
pub struct BatcherConfig {
    /// Maximum batch size (number of transactions)
    pub max_batch_size: u32,
    
    /// Maximum transaction size (in bytes)
    pub max_transaction_size: usize,
    
    /// Maximum batch total size (in bytes)
    pub max_batch_total_size: usize,
    
    /// Whether to prioritize transactions
    pub prioritize_transactions: bool,
}

impl Default for BatcherConfig {
    fn default() -> Self {
        Self {
            max_batch_size: 1000,
            max_transaction_size: 1024 * 10, // 10 KB
            max_batch_total_size: 1024 * 1024, // 1 MB
            prioritize_transactions: true,
        }
    }
}

impl BatcherConfig {
    /// Validate the configuration
    pub fn validate(&self) -> BatchingResult<()> {
        if self.max_batch_size == 0 {
            return Err(BatchingError::InvalidConfiguration(
                "Maximum batch size cannot be zero".to_string()
            ));
        }
        
        if self.max_transaction_size == 0 {
            return Err(BatchingError::InvalidConfiguration(
                "Maximum transaction size cannot be zero".to_string()
            ));
        }
        
        if self.max_batch_total_size == 0 {
            return Err(BatchingError::InvalidConfiguration(
                "Maximum batch total size cannot be zero".to_string()
            ));
        }
        
        if self.max_batch_total_size < self.max_transaction_size {
            return Err(BatchingError::InvalidConfiguration(
                format!(
                    "Maximum batch total size ({}) must be greater than or equal to maximum transaction size ({})",
                    self.max_batch_total_size, self.max_transaction_size
                )
            ));
        }
        
        Ok(())
    }
}

/// Transaction batcher for scalability optimization
pub struct TransactionBatcher {
    /// Batcher configuration
    config: BatcherConfig,
    
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
            config: BatcherConfig::default(),
            next_batch_id: 1,
            pending_transactions: VecDeque::new(),
            initialized: false,
        }
    }
    
    /// Create a new transaction batcher with the specified configuration
    pub fn with_config(config: BatcherConfig) -> BatchingResult<Self> {
        // Validate the configuration
        config.validate()?;
        
        Ok(Self {
            config,
            next_batch_id: 1,
            pending_transactions: VecDeque::new(),
            initialized: false,
        })
    }
    
    /// Initialize the transaction batcher
    pub fn initialize(&mut self) -> BatchingResult<()> {
        self.initialized = true;
        
        msg!("Transaction batcher initialized");
        
        Ok(())
    }
    
    /// Check if the transaction batcher is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Add a transaction to the pending queue
    pub fn add_transaction(&mut self, transaction: Vec<u8>) -> BatchingResult<()> {
        if !self.initialized {
            return Err(BatchingError::NotInitialized);
        }
        
        // Check if the transaction size is within limits
        if transaction.len() > self.config.max_transaction_size {
            return Err(BatchingError::TransactionTooLarge {
                size: transaction.len(),
                max_size: self.config.max_transaction_size,
            });
        }
        
        self.pending_transactions.push_back(transaction);
        
        Ok(())
    }
    
    /// Batch transactions
    pub fn batch_transactions(&mut self, transactions: &[Vec<u8>]) -> BatchingResult<Vec<TransactionBatch>> {
        if !self.initialized {
            return Err(BatchingError::NotInitialized);
        }
        
        if transactions.is_empty() {
            return Err(BatchingError::EmptyTransactionList);
        }
        
        let mut batches = Vec::new();
        let mut current_batch = Vec::new();
        let mut current_size = 0;
        
        for transaction in transactions {
            // Check if the transaction size is within limits
            if transaction.len() > self.config.max_transaction_size {
                return Err(BatchingError::TransactionTooLarge {
                    size: transaction.len(),
                    max_size: self.config.max_transaction_size,
                });
            }
            
            // If adding this transaction would exceed the max batch size or total size, create a new batch
            if current_batch.len() >= self.config.max_batch_size as usize || 
               current_size + transaction.len() > self.config.max_batch_total_size {
                // Create a batch with the current transactions
                if !current_batch.is_empty() {
                    let batch_id = self.next_batch_id;
                    self.next_batch_id += 1;
                    
                    let batch = TransactionBatch::new(batch_id, current_batch, current_size);
                    
                    batches.push(batch);
                    
                    // Start a new batch
                    current_batch = Vec::new();
                    current_size = 0;
                }
            }
            
            // Add the transaction to the current batch
            current_batch.push(transaction.clone());
            current_size += transaction.len();
        }
        
        // If there are any transactions left in the current batch, create a final batch
        if !current_batch.is_empty() {
            let batch_id = self.next_batch_id;
            self.next_batch_id += 1;
            
            let batch = TransactionBatch::new(batch_id, current_batch, current_size);
            
            batches.push(batch);
        }
        
        // Estimate gas and prioritize batches if configured
        for batch in &mut batches {
            batch.estimated_gas = self.estimate_gas(batch);
        }
        
        if self.config.prioritize_transactions {
            self.prioritize_batches(&mut batches);
        }
        
        msg!("Transactions batched: {} batches created", batches.len());
        
        Ok(batches)
    }
    
    /// Process pending transactions
    pub fn process_pending(&mut self) -> BatchingResult<Vec<TransactionBatch>> {
        if !self.initialized {
            return Err(BatchingError::NotInitialized);
        }
        
        // Convert the pending transactions to a vector
        let transactions: Vec<Vec<u8>> = self.pending_transactions.drain(..).collect();
        
        if transactions.is_empty() {
            return Ok(Vec::new());
        }
        
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
            // Higher priority for batches with lower gas cost per transaction
            if !batch.is_empty() {
                batch.priority = (1000000 / (batch.estimated_gas / batch.transaction_count() as u64).max(1)) as u32;
            }
        }
        
        // Sort batches by priority (higher priority first)
        batches.sort_by(|a, b| b.priority.cmp(&a.priority));
    }
    
    /// Update the transaction batcher configuration
    pub fn update_config(&mut self, config: BatcherConfig) -> BatchingResult<()> {
        if !self.initialized {
            return Err(BatchingError::NotInitialized);
        }
        
        // Validate the configuration
        config.validate()?;
        
        self.config = config;
        
        msg!("Transaction batcher configuration updated");
        
        Ok(())
    }
    
    /// Get the current configuration
    pub fn get_config(&self) -> &BatcherConfig {
        &self.config
    }
    
    /// Get the number of pending transactions
    pub fn pending_count(&self) -> usize {
        self.pending_transactions.len()
    }
    
    /// Clear all pending transactions
    pub fn clear_pending(&mut self) -> BatchingResult<()> {
        if !self.initialized {
            return Err(BatchingError::NotInitialized);
        }
        
        self.pending_transactions.clear();
        
        Ok(())
    }
    
    /// Reset the batch ID counter
    pub fn reset_batch_id(&mut self) -> BatchingResult<()> {
        if !self.initialized {
            return Err(BatchingError::NotInitialized);
        }
        
        self.next_batch_id = 1;
        
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
        let config = BatcherConfig {
            max_batch_size: 500,
            ..BatcherConfig::default()
        };
        
        let batcher = TransactionBatcher::with_config(config).unwrap();
        assert!(!batcher.is_initialized());
        assert_eq!(batcher.config.max_batch_size, 500);
    }
    
    #[test]
    fn test_invalid_configuration() {
        // Test zero max_batch_size
        let config = BatcherConfig {
            max_batch_size: 0,
            ..BatcherConfig::default()
        };
        
        let result = TransactionBatcher::with_config(config);
        assert!(result.is_err());
        
        // Test zero max_transaction_size
        let config = BatcherConfig {
            max_transaction_size: 0,
            ..BatcherConfig::default()
        };
        
        let result = TransactionBatcher::with_config(config);
        assert!(result.is_err());
        
        // Test max_batch_total_size < max_transaction_size
        let config = BatcherConfig {
            max_transaction_size: 1000,
            max_batch_total_size: 500,
            ..BatcherConfig::default()
        };
        
        let result = TransactionBatcher::with_config(config);
        assert!(result.is_err());
    }
    
    #[test]
    fn test_initialization() {
        let mut batcher = TransactionBatcher::new();
        assert!(!batcher.is_initialized());
        
        batcher.initialize().unwrap();
        assert!(batcher.is_initialized());
    }
    
    #[test]
    fn test_add_transaction() {
        let mut batcher = TransactionBatcher::new();
        batcher.initialize().unwrap();
        
        // Add a valid transaction
        let transaction = vec![1, 2, 3, 4];
        let result = batcher.add_transaction(transaction);
        assert!(result.is_ok());
        assert_eq!(batcher.pending_count(), 1);
        
        // Add a transaction that exceeds the size limit
        let large_transaction = vec![0; batcher.config.max_transaction_size + 1];
        let result = batcher.add_transaction(large_transaction);
        assert!(result.is_err());
        assert_eq!(batcher.pending_count(), 1);
    }
    
    #[test]
    fn test_batch_transactions() {
        let mut batcher = TransactionBatcher::new();
        batcher.initialize().unwrap();
        
        // Create test transactions
        let transactions: Vec<Vec<u8>> = (0..2000).map(|i| vec![i as u8; 100]).collect();
        
        // Batch the transactions
        let batches = batcher.batch_transactions(&transactions).unwrap();
        
        // Check that we have the expected number of batches
        assert_eq!(batches.len(), 2);
        
        // Check that each batch has the expected number of transactions
        assert_eq!(batches[0].transaction_count(), 1000);
        assert_eq!(batches[1].transaction_count(), 1000);
        
        // Check that the batches have the expected IDs
        assert_eq!(batches[0].id, 1);
        assert_eq!(batches[1].id, 2);
    }
    
    #[test]
    fn test_batch_size_limits() {
        let config = BatcherConfig {
            max_batch_size: 100,
            max_batch_total_size: 5000,
            ..BatcherConfig::default()
        };
        
        let mut batcher = TransactionBatcher::with_config(config).unwrap();
        batcher.initialize().unwrap();
        
        // Create test transactions
        let transactions: Vec<Vec<u8>> = (0..200).map(|i| vec![i as u8; 100]).collect();
        
        // Batch the transactions
        let batches = batcher.batch_transactions(&transactions).unwrap();
        
        // Check that we have the expected number of batches
        assert_eq!(batches.len(), 2);
        
        // Check that each batch has the expected number of transactions
        assert_eq!(batches[0].transaction_count(), 100);
        assert_eq!(batches[1].transaction_count(), 100);
    }
    
    #[test]
    fn test_batch_total_size_limits() {
        let config = BatcherConfig {
            max_batch_size: 1000,
            max_batch_total_size: 5000,
            ..BatcherConfig::default()
        };
        
        let mut batcher = TransactionBatcher::with_config(config).unwrap();
        batcher.initialize().unwrap();
        
        // Create test transactions
        let transactions: Vec<Vec<u8>> = (0..100).map(|i| vec![i as u8; 100]).collect();
        
        // Batch the transactions
        let batches = batcher.batch_transactions(&transactions).unwrap();
        
        // Check that we have the expected number of batches
        assert_eq!(batches.len(), 2);
        
        // Check that each batch has the expected total size
        assert!(batches[0].total_size <= 5000);
        assert!(batches[1].total_size <= 5000);
    }
    
    #[test]
    fn test_process_pending() {
        let mut batcher = TransactionBatcher::new();
        batcher.initialize().unwrap();
        
        // Add some transactions
        for i in 0..100 {
            let transaction = vec![i as u8; 100];
            batcher.add_transaction(transaction).unwrap();
        }
        
        // Process the pending transactions
        let batches = batcher.process_pending().unwrap();
        
        // Check that we have the expected number of batches
        assert_eq!(batches.len(), 1);
        
        // Check that the batch has the expected number of transactions
        assert_eq!(batches[0].transaction_count(), 100);
        
        // Check that there are no more pending transactions
        assert_eq!(batcher.pending_count(), 0);
    }
    
    #[test]
    fn test_prioritize_batches() {
        let mut batcher = TransactionBatcher::new();
        batcher.initialize().unwrap();
        
        // Create test batches
        let mut batches = vec![
            TransactionBatch::new(1, vec![vec![1, 2, 3]], 3),
            TransactionBatch::new(2, vec![vec![1, 2]], 2),
            TransactionBatch::new(3, vec![vec![1]], 1),
        ];
        
        // Estimate gas for each batch
        for batch in &mut batches {
            batch.estimated_gas = batcher.estimate_gas(batch);
        }
        
        // Prioritize the batches
        batcher.prioritize_batches(&mut batches);
        
        // Check that the batches are sorted by priority
        assert_eq!(batches[0].id, 3);
        assert_eq!(batches[1].id, 2);
        assert_eq!(batches[2].id, 1);
    }
    
    #[test]
    fn test_update_config() {
        let mut batcher = TransactionBatcher::new();
        batcher.initialize().unwrap();
        
        // Update the configuration
        let config = BatcherConfig {
            max_batch_size: 500,
            ..BatcherConfig::default()
        };
        
        let result = batcher.update_config(config);
        assert!(result.is_ok());
        assert_eq!(batcher.config.max_batch_size, 500);
    }
    
    #[test]
    fn test_clear_pending() {
        let mut batcher = TransactionBatcher::new();
        batcher.initialize().unwrap();
        
        // Add some transactions
        for i in 0..100 {
            let transaction = vec![i as u8; 100];
            batcher.add_transaction(transaction).unwrap();
        }
        
        // Clear the pending transactions
        let result = batcher.clear_pending();
        assert!(result.is_ok());
        assert_eq!(batcher.pending_count(), 0);
    }
    
    #[test]
    fn test_reset_batch_id() {
        let mut batcher = TransactionBatcher::new();
        batcher.initialize().unwrap();
        
        // Create some batches to increment the batch ID
        let transactions: Vec<Vec<u8>> = (0..100).map(|i| vec![i as u8; 100]).collect();
        let _ = batcher.batch_transactions(&transactions).unwrap();
        
        // Reset the batch ID
        let result = batcher.reset_batch_id();
        assert!(result.is_ok());
        
        // Create a new batch and check the ID
        let transactions: Vec<Vec<u8>> = (0..10).map(|i| vec![i as u8; 100]).collect();
        let batches = batcher.batch_transactions(&transactions).unwrap();
        assert_eq!(batches[0].id, 1);
    }
}
