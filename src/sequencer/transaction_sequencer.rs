// src/sequencer/transaction_sequencer.rs
//! Transaction Sequencer implementation for Layer-2 on Solana
//!
//! This module implements a sequencer system that collects, orders, and batches
//! transactions before submitting them to the rollup. It includes mechanisms for
//! transaction prioritization, fee markets, and batch optimization.

use std::collections::{BinaryHeap, HashMap, VecDeque};
use std::cmp::{Ordering, Reverse};
use std::time::{Duration, Instant, SystemTime};
use solana_program::hash::Hash;
use solana_program::pubkey::Pubkey;
use solana_program::instruction::Instruction;
use solana_program::program_error::ProgramError;
use std::sync::{Arc, Mutex, RwLock};
use std::thread;

use crate::rollup::optimistic_rollup::{RollupTransaction, OptimisticRollup, Batch};

/// Maximum number of transactions in a batch
pub const MAX_BATCH_SIZE: usize = 1000;

/// Maximum batch submission interval (in seconds)
pub const MAX_BATCH_INTERVAL: u64 = 60;

/// Minimum number of transactions to trigger a batch submission
pub const MIN_BATCH_THRESHOLD: usize = 100;

/// Status of a transaction in the sequencer
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransactionStatus {
    /// Transaction is pending in the sequencer queue
    Pending,
    /// Transaction has been included in a batch
    Included(u64), // Batch ID
    /// Transaction has been rejected
    Rejected(String), // Reason
    /// Transaction has expired
    Expired,
}

/// Priority level for transactions
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum PriorityLevel {
    /// Critical transactions (e.g., protocol operations)
    Critical = 0,
    /// High priority transactions (e.g., high fee transactions)
    High = 1,
    /// Medium priority transactions (e.g., normal user transactions)
    Medium = 2,
    /// Low priority transactions (e.g., low fee transactions)
    Low = 3,
}

/// A transaction in the sequencer queue
#[derive(Debug, Clone)]
pub struct SequencerTransaction {
    /// Transaction data
    pub transaction: RollupTransaction,
    /// Transaction hash
    pub hash: Hash,
    /// Timestamp when the transaction was received
    pub received_at: SystemTime,
    /// Expiration time
    pub expires_at: Option<SystemTime>,
    /// Status of the transaction
    pub status: TransactionStatus,
    /// Priority level
    pub priority: PriorityLevel,
    /// Effective gas price (including priority boost)
    pub effective_gas_price: u64,
}

impl PartialEq for SequencerTransaction {
    fn eq(&self, other: &Self) -> bool {
        self.hash == other.hash
    }
}

impl Eq for SequencerTransaction {}

impl PartialOrd for SequencerTransaction {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for SequencerTransaction {
    fn cmp(&self, other: &Self) -> Ordering {
        // First compare by priority level
        let priority_cmp = self.priority.cmp(&other.priority);
        if priority_cmp != Ordering::Equal {
            return priority_cmp;
        }
        
        // Then compare by effective gas price (higher price = higher priority)
        let gas_price_cmp = self.effective_gas_price.cmp(&other.effective_gas_price);
        if gas_price_cmp != Ordering::Equal {
            return gas_price_cmp.reverse(); // Reverse because higher gas price should come first
        }
        
        // Finally compare by received time (earlier = higher priority)
        self.received_at.cmp(&other.received_at)
    }
}

/// Configuration for the sequencer
#[derive(Debug, Clone)]
pub struct SequencerConfig {
    /// Maximum number of transactions in a batch
    pub max_batch_size: usize,
    /// Maximum batch submission interval (in seconds)
    pub max_batch_interval: u64,
    /// Minimum number of transactions to trigger a batch submission
    pub min_batch_threshold: usize,
    /// Base fee for transactions
    pub base_fee: u64,
    /// Fee multiplier for priority levels
    pub priority_fee_multiplier: HashMap<PriorityLevel, u64>,
    /// Maximum transaction lifetime (in seconds)
    pub max_transaction_lifetime: u64,
    /// Whether to enable automatic batch submission
    pub auto_submit_batches: bool,
}

impl Default for SequencerConfig {
    fn default() -> Self {
        let mut priority_fee_multiplier = HashMap::new();
        priority_fee_multiplier.insert(PriorityLevel::Critical, 4);
        priority_fee_multiplier.insert(PriorityLevel::High, 2);
        priority_fee_multiplier.insert(PriorityLevel::Medium, 1);
        priority_fee_multiplier.insert(PriorityLevel::Low, 1);
        
        SequencerConfig {
            max_batch_size: MAX_BATCH_SIZE,
            max_batch_interval: MAX_BATCH_INTERVAL,
            min_batch_threshold: MIN_BATCH_THRESHOLD,
            base_fee: 10,
            priority_fee_multiplier,
            max_transaction_lifetime: 3600, // 1 hour
            auto_submit_batches: true,
        }
    }
}

/// Statistics for the sequencer
#[derive(Debug, Clone, Default)]
pub struct SequencerStats {
    /// Total number of transactions received
    pub total_transactions: u64,
    /// Number of transactions currently in the queue
    pub pending_transactions: u64,
    /// Number of transactions included in batches
    pub included_transactions: u64,
    /// Number of rejected transactions
    pub rejected_transactions: u64,
    /// Number of expired transactions
    pub expired_transactions: u64,
    /// Total number of batches submitted
    pub total_batches: u64,
    /// Average batch size
    pub average_batch_size: f64,
    /// Average transaction fee
    pub average_transaction_fee: f64,
    /// Average time in queue (in seconds)
    pub average_queue_time: f64,
}

/// The Transaction Sequencer system
pub struct TransactionSequencer {
    /// Configuration
    config: SequencerConfig,
    /// Transaction queue (priority queue)
    transaction_queue: BinaryHeap<Reverse<SequencerTransaction>>,
    /// Mapping of transaction hashes to indices in the queue
    transaction_map: HashMap<Hash, TransactionStatus>,
    /// Batches created by the sequencer
    batches: HashMap<u64, Batch>,
    /// Next batch ID
    next_batch_id: u64,
    /// Last batch submission time
    last_batch_time: Instant,
    /// Rollup instance
    rollup: Arc<RwLock<OptimisticRollup>>,
    /// Sequencer statistics
    stats: SequencerStats,
    /// Sequencer account
    sequencer_account: Pubkey,
    /// Batch submission thread handle
    batch_thread: Option<thread::JoinHandle<()>>,
    /// Shutdown signal
    shutdown: Arc<Mutex<bool>>,
}

impl TransactionSequencer {
    /// Create a new Transaction Sequencer instance
    pub fn new(config: SequencerConfig, rollup: Arc<RwLock<OptimisticRollup>>, sequencer_account: Pubkey) -> Self {
        let sequencer = TransactionSequencer {
            config,
            transaction_queue: BinaryHeap::new(),
            transaction_map: HashMap::new(),
            batches: HashMap::new(),
            next_batch_id: 0,
            last_batch_time: Instant::now(),
            rollup,
            stats: SequencerStats::default(),
            sequencer_account,
            batch_thread: None,
            shutdown: Arc::new(Mutex::new(false)),
        };
        
        sequencer
    }
    
    /// Start the sequencer
    pub fn start(&mut self) {
        if self.config.auto_submit_batches {
            self.start_batch_submission_thread();
        }
    }
    
    /// Stop the sequencer
    pub fn stop(&mut self) {
        if let Some(thread) = self.batch_thread.take() {
            // Signal thread to shut down
            let mut shutdown = self.shutdown.lock().unwrap();
            *shutdown = true;
            
            // Wait for thread to finish
            thread.join().unwrap();
        }
    }
    
    /// Start the batch submission thread
    fn start_batch_submission_thread(&mut self) {
        let config = self.config.clone();
        let rollup = Arc::clone(&self.rollup);
        let sequencer_account = self.sequencer_account;
        let shutdown = Arc::clone(&self.shutdown);
        
        let thread = thread::spawn(move || {
            let mut last_check = Instant::now();
            
            loop {
                // Check if we should shut down
                if *shutdown.lock().unwrap() {
                    break;
                }
                
                // Sleep for a short time
                thread::sleep(Duration::from_millis(100));
                
                // Check if it's time to submit a batch
                let now = Instant::now();
                let elapsed = now.duration_since(last_check).as_secs();
                
                if elapsed >= config.max_batch_interval {
                    // Try to submit a batch
                    let mut rollup = rollup.write().unwrap();
                    
                    // TODO: Implement batch submission logic
                    // This would involve collecting transactions from the queue,
                    // creating a batch, and submitting it to the rollup
                    
                    last_check = now;
                }
            }
        });
        
        self.batch_thread = Some(thread);
    }
    
    /// Add a transaction to the sequencer
    pub fn add_transaction(&mut self, transaction: RollupTransaction) -> Result<Hash, ProgramError> {
        // Generate transaction hash
        let hash = self.generate_transaction_hash(&transaction);
        
        // Check if transaction already exists
        if self.transaction_map.contains_key(&hash) {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Calculate priority level based on gas price
        let priority = self.calculate_priority_level(&transaction);
        
        // Calculate effective gas price (including priority boost)
        let effective_gas_price = self.calculate_effective_gas_price(&transaction, priority);
        
        // Calculate expiration time
        let received_at = SystemTime::now();
        let expires_at = received_at.checked_add(Duration::from_secs(self.config.max_transaction_lifetime));
        
        // Create sequencer transaction
        let sequencer_tx = SequencerTransaction {
            transaction,
            hash,
            received_at,
            expires_at,
            status: TransactionStatus::Pending,
            priority,
            effective_gas_price,
        };
        
        // Add to queue
        self.transaction_queue.push(Reverse(sequencer_tx.clone()));
        
        // Add to map
        self.transaction_map.insert(hash, TransactionStatus::Pending);
        
        // Update stats
        self.stats.total_transactions += 1;
        self.stats.pending_transactions += 1;
        
        // Check if we should submit a batch
        if !self.config.auto_submit_batches && 
           self.transaction_queue.len() >= self.config.min_batch_threshold {
            self.submit_batch()?;
        }
        
        Ok(hash)
    }
    
    /// Submit a batch of transactions to the rollup
    pub fn submit_batch(&mut self) -> Result<u64, ProgramError> {
        // Check if there are enough transactions
        if self.transaction_queue.len() < self.config.min_batch_threshold {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Collect transactions for the batch
        let mut batch_transactions = Vec::new();
        let mut batch_tx_hashes = Vec::new();
        
        while !self.transaction_queue.is_empty() && batch_transactions.len() < self.config.max_batch_size {
            if let Some(Reverse(tx)) = self.transaction_queue.pop() {
                // Check if transaction has expired
                let now = SystemTime::now();
                if let Some(expires_at) = tx.expires_at {
                    if now > expires_at {
                        // Transaction has expired
                        self.transaction_map.insert(tx.hash, TransactionStatus::Expired);
                        self.stats.expired_transactions += 1;
                        self.stats.pending_transactions -= 1;
                        continue;
                    }
                }
                
                // Add transaction to batch
                batch_transactions.push(tx.transaction.clone());
                batch_tx_hashes.push(tx.hash);
            }
        }
        
        // Submit batch to rollup
        let batch_id = {
            let mut rollup = self.rollup.write().unwrap();
            rollup.create_batch(batch_transactions.clone(), self.sequencer_account)?
        };
        
        // Update transaction statuses
        for hash in batch_tx_hashes {
            self.transaction_map.insert(hash, TransactionStatus::Included(batch_id));
            self.stats.included_transactions += 1;
            self.stats.pending_transactions -= 1;
        }
        
        // Update stats
        self.stats.total_batches += 1;
        self.stats.average_batch_size = (self.stats.average_batch_size * (self.stats.total_batches - 1) as f64
                                        + batch_transactions.len() as f64) / self.stats.total_batches as f64;
        
        // Update last batch time
        self.last_batch_time = Instant::now();
        
        Ok(batch_id)
    }
    
    /// Get transaction status
    pub fn get_transaction_status(&self, hash: &Hash) -> Option<TransactionStatus> {
        self.transaction_map.get(hash).cloned()
    }
    
    /// Get batch by ID
    pub fn get_batch(&self, batch_id: u64) -> Option<&Batch> {
        self.batches.get(&batch_id)
    }
    
    /// Get sequencer statistics
    pub fn get_stats(&self) -> SequencerStats {
        self.stats.clone()
    }
    
    /// Clean up expired transactions
    pub fn cleanup_expired_transactions(&mut self) -> usize {
        let now = SystemTime::now();
        let mut expired_count = 0;
        
        // Create a new queue without expired transactions
        let mut new_queue = BinaryHeap::new();
        
        while let Some(Reverse(tx)) = self.transaction_queue.pop() {
            if let Some(expires_at) = tx.expires_at {
                if now > expires_at {
                    // Transaction has expired
                    self.transaction_map.insert(tx.hash, TransactionStatus::Expired);
                    self.stats.expired_transactions += 1;
                    self.stats.pending_transactions -= 1;
                    expired_count += 1;
                    continue;
                }
            }
            
            // Transaction is still valid
            new_queue.push(Reverse(tx));
        }
        
        // Replace the queue
        self.transaction_queue = new_queue;
        
        expired_count
    }
    
    /// Calculate priority level based on gas price
    fn calculate_priority_level(&self, transaction: &RollupTransaction) -> PriorityLevel {
        // This is a simplified implementation
        // In a real system, this would consider various factors
        
        if transaction.gas_price >= self.config.base_fee * 3 {
            PriorityLevel::Critical
        } else if transaction.gas_price >= self.config.base_fee * 2 {
            PriorityLevel::High
        } else if transaction.gas_price >= self.config.base_fee {
            PriorityLevel::Medium
        } else {
            PriorityLevel::Low
        }
    }
    
    /// Calculate effective gas price (including priority boost)
    fn calculate_effective_gas_price(&self, transaction: &RollupTransaction, priority: PriorityLevel) -> u64 {
        let multiplier = self.config.priority_fee_multiplier.get(&priority).unwrap_or(&1);
        transaction.gas_price * multiplier
    }
    
    /// Generate a hash for a transaction
    fn generate_transaction_hash(&self, transaction: &RollupTransaction) -> Hash {
        let mut hasher = solana_program::hash::Hasher::default();
        hasher.hash(transaction.sender.as_ref());
        hasher.hash(transaction.recipient.as_ref());
        hasher.hash(&transaction.amount.to_le_bytes());
        hasher.hash(&transaction.data);
        hasher.hash(&transaction.nonce.to_le_bytes());
        hasher.hash(&transaction.gas_price.to_le_bytes());
        hasher.hash(&transaction.gas_limit.to_le_bytes());
        
        hasher.result()
    }
    
    /// Create an instruction to submit a transaction to the sequencer
    pub fn create_submit_transaction_instruction(
        program_id: &Pubkey,
        payer: &Pubkey,
        transaction: &RollupTransaction,
    ) -> Instruction {
        // Serialize transaction data
        let mut data = Vec::new();
        data.extend_from_slice(&[0]); // Instruction discriminator: 0 = SubmitTransaction
        
        // Serialize transaction
        data.extend_from_slice(transaction.sender.as_ref());
        data.extend_from_slice(transaction.recipient.as_ref());
        data.extend_from_slice(&transaction.amount.to_le_bytes());
        
        // Serialize data length and data
        data.extend_from_slice(&(transaction.data.len() as u32).to_le_bytes());
        data.extend_from_slice(&transaction.data);
        
        // Serialize signature length and signature
        data.extend_from_slice(&(transaction.signature.len() as u32).to_le_bytes());
        data.extend_from_slice(&transaction.signature);
        
        data.extend_from_slice(&transaction.nonce.to_le_bytes());
        data.extend_from_slice(&transaction.gas_price.to_le_bytes());
        data.extend_from_slice(&transaction.gas_limit.to_le_bytes());
        
        Instruction {
            program_id: *program_id,
            accounts: vec![
                solana_program::instruction::AccountMeta::new(*payer, true), // Payer account (signer)
            ],
            data,
        }
    }
    
    /// Create an instruction to get transaction status
    pub fn create_get_transaction_status_instruction(
        program_id: &Pubkey,
        payer: &Pubkey,
        transaction_hash: &Hash,
    ) -> Instruction {
        // Serialize instruction data
        let mut data = Vec::new();
        data.extend_from_slice(&[1]); // Instruction discriminator: 1 = GetTransactionStatus
        data.extend_from_slice(transaction_hash.as_ref());
        
        Instruction {
            program_id: *program_id,
            accounts: vec![
                solana_program::instruction::AccountMeta::new_readonly(*payer, true), // Payer account (signer)
            ],
            data,
        }
    }
}

/// Tests for the Transaction Sequencer system
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;
    
    #[test]
    fn test_add_transaction() {
        // Create rollup
        let rollup = Arc::new(RwLock::new(OptimisticRollup::new()));
        
        // Create sequencer
        let sequencer_account = Pubkey::new_unique();
        let config = SequencerConfig::default();
        let mut sequencer = TransactionSequencer::new(config, Arc::clone(&rollup), sequencer_account);
        
        // Create transaction
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        let transaction = RollupTransaction {
            sender,
            recipient,
            amount: 100,
            data: vec![],
            signature: vec![1, 2, 3], // Dummy signature
            nonce: 1,
            gas_price: 20, // Higher than base fee
            gas_limit: 5,
        };
        
        // Add transaction
        let hash = sequencer.add_transaction(transaction.clone()).unwrap();
        
        // Verify transaction was added
        let status = sequencer.get_transaction_status(&hash).unwrap();
        assert_eq!(status, TransactionStatus::Pending);
        
        // Verify stats
        let stats = sequencer.get_stats();
        assert_eq!(stats.total_transactions, 1);
        assert_eq!(stats.pending_transactions, 1);
    }
    
    #[test]
    fn test_submit_batch() {
        // Create rollup
        let rollup = Arc::new(RwLock::new(OptimisticRollup::new()));
        
        // Create sequencer with low threshold
        let sequencer_account = Pubkey::new_unique();
        let mut config = SequencerConfig::default();
        config.min_batch_threshold = 2;
        let mut sequencer = TransactionSequencer::new(config, Arc::clone(&rollup), sequencer_account);
        
        // Add balance to sender in rollup
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        {
            let mut rollup = rollup.write().unwrap();
            rollup.balances.insert(sender, 1000);
        }
        
        // Create and add transactions
        for i in 0..3 {
            let transaction = RollupTransaction {
                sender,
                recipient,
                amount: 100,
                data: vec![],
                signature: vec![i, i+1, i+2], // Dummy signature
                nonce: i+1,
                gas_price: 20,
                gas_limit: 5,
            };
            
            sequencer.add_transaction(transaction).unwrap();
        }
        
        // Submit batch
        let batch_id = sequencer.submit_batch().unwrap();
        
        // Verify batch was created
        let batch = {
            let rollup = rollup.read().unwrap();
            rollup.get_batch(batch_id).unwrap().clone()
        };
        
        assert_eq!(batch.transactions.len(), 3);
        assert_eq!(batch.sequencer, sequencer_account);
        
        // Verify stats
        let stats = sequencer.get_stats();
        assert_eq!(stats.total_transactions, 3);
        assert_eq!(stats.pending_transactions, 0);
        assert_eq!(stats.included_transactions, 3);
        assert_eq!(stats.total_batches, 1);
    }
    
    #[test]
    fn test_transaction_priority() {
        // Create rollup
        let rollup = Arc::new(RwLock::new(OptimisticRollup::new()));
        
        // Create sequencer
        let sequencer_account = Pubkey::new_unique();
        let config = SequencerConfig::default();
        let mut sequencer = TransactionSequencer::new(config.clone(), Arc::clone(&rollup), sequencer_account);
        
        // Add balance to sender in rollup
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        {
            let mut rollup = rollup.write().unwrap();
            rollup.balances.insert(sender, 10000);
        }
        
        // Create transactions with different gas prices
        let tx1 = RollupTransaction {
            sender,
            recipient,
            amount: 100,
            data: vec![],
            signature: vec![1, 2, 3],
            nonce: 1,
            gas_price: 5, // Low (below base fee)
            gas_limit: 5,
        };
        
        let tx2 = RollupTransaction {
            sender,
            recipient,
            amount: 100,
            data: vec![],
            signature: vec![4, 5, 6],
            nonce: 2,
            gas_price: 10, // Medium (equal to base fee)
            gas_limit: 5,
        };
        
        let tx3 = RollupTransaction {
            sender,
            recipient,
            amount: 100,
            data: vec![],
            signature: vec![7, 8, 9],
            nonce: 3,
            gas_price: 20, // High (2x base fee)
            gas_limit: 5,
        };
        
        let tx4 = RollupTransaction {
            sender,
            recipient,
            amount: 100,
            data: vec![],
            signature: vec![10, 11, 12],
            nonce: 4,
            gas_price: 30, // Critical (3x base fee)
            gas_limit: 5,
        };
        
        // Add transactions in reverse priority order
        sequencer.add_transaction(tx1.clone()).unwrap();
        sequencer.add_transaction(tx2.clone()).unwrap();
        sequencer.add_transaction(tx3.clone()).unwrap();
        sequencer.add_transaction(tx4.clone()).unwrap();
        
        // Configure sequencer to include only 2 transactions per batch
        let mut config = SequencerConfig::default();
        config.max_batch_size = 2;
        config.min_batch_threshold = 1;
        let mut sequencer = TransactionSequencer::new(config, Arc::clone(&rollup), sequencer_account);
        
        // Add transactions in reverse priority order
        sequencer.add_transaction(tx1.clone()).unwrap();
        sequencer.add_transaction(tx2.clone()).unwrap();
        sequencer.add_transaction(tx3.clone()).unwrap();
        sequencer.add_transaction(tx4.clone()).unwrap();
        
        // Submit batch
        let batch_id = sequencer.submit_batch().unwrap();
        
        // Verify batch contains the highest priority transactions
        let batch = {
            let rollup = rollup.read().unwrap();
            rollup.get_batch(batch_id).unwrap().clone()
        };
        
        assert_eq!(batch.transactions.len(), 2);
        
        // The batch should contain tx4 (Critical) and tx3 (High)
        let contains_tx4 = batch.transactions.iter().any(|tx| tx.gas_price == 30);
        let contains_tx3 = batch.transactions.iter().any(|tx| tx.gas_price == 20);
        
        assert!(contains_tx4, "Batch should contain the Critical priority transaction");
        assert!(contains_tx3, "Batch should contain the High priority transaction");
    }
    
    #[test]
    fn test_expired_transactions() {
        // Create rollup
        let rollup = Arc::new(RwLock::new(OptimisticRollup::new()));
        
        // Create sequencer with short transaction lifetime
        let sequencer_account = Pubkey::new_unique();
        let mut config = SequencerConfig::default();
        config.max_transaction_lifetime = 1; // 1 second
        let mut sequencer = TransactionSequencer::new(config, Arc::clone(&rollup), sequencer_account);
        
        // Create transaction
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        let transaction = RollupTransaction {
            sender,
            recipient,
            amount: 100,
            data: vec![],
            signature: vec![1, 2, 3],
            nonce: 1,
            gas_price: 20,
            gas_limit: 5,
        };
        
        // Add transaction
        let hash = sequencer.add_transaction(transaction).unwrap();
        
        // Wait for transaction to expire
        thread::sleep(Duration::from_secs(2));
        
        // Clean up expired transactions
        let expired_count = sequencer.cleanup_expired_transactions();
        
        // Verify transaction was expired
        assert_eq!(expired_count, 1);
        
        let status = sequencer.get_transaction_status(&hash).unwrap();
        assert_eq!(status, TransactionStatus::Expired);
        
        // Verify stats
        let stats = sequencer.get_stats();
        assert_eq!(stats.total_transactions, 1);
        assert_eq!(stats.pending_transactions, 0);
        assert_eq!(stats.expired_transactions, 1);
    }
}
