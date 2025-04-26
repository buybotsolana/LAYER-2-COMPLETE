// Batch Processing Module for Layer-2 on Solana
//
// This module implements advanced batch processing techniques to optimize transaction throughput
// and reduce gas costs for the Layer-2 on Solana implementation.
//
// Key techniques:
// - Transaction batching
// - Merkle tree aggregation
// - Parallel execution
// - Priority-based scheduling
// - Gas sharing
//
// Author: Manus AI
// Date: April 2025

use std::collections::{HashMap, BinaryHeap, VecDeque};
use std::cmp::Ordering;
use std::sync::{Arc, Mutex};
use crate::gas_optimization::{Transaction, GasOptimizerConfig};
use crate::utils::merkle_tree::MerkleTree;

/// Result of batch processing optimization
#[derive(Clone, Debug)]
pub struct BatchProcessingResult {
    /// Original number of transactions
    pub original_tx_count: usize,
    
    /// Number of batches created
    pub batch_count: usize,
    
    /// Estimated gas saved
    pub gas_saved: u64,
    
    /// Batch processing method used
    pub method: BatchProcessingMethod,
}

/// Available batch processing methods
#[derive(Clone, Debug, PartialEq)]
pub enum BatchProcessingMethod {
    /// No batching
    None,
    
    /// Simple transaction batching
    SimpleBatching,
    
    /// Merkle tree aggregation
    MerkleAggregation,
    
    /// Parallel execution
    ParallelExecution,
    
    /// Priority-based scheduling
    PriorityScheduling,
    
    /// Gas sharing
    GasSharing,
    
    /// Combined methods
    Combined(Vec<BatchProcessingMethod>),
}

/// Transaction batch
#[derive(Clone, Debug)]
pub struct TransactionBatch {
    /// Batch ID
    pub id: String,
    
    /// Transactions in the batch
    pub transactions: Vec<Transaction>,
    
    /// Merkle root of transaction hashes (if using Merkle aggregation)
    pub merkle_root: Option<Vec<u8>>,
    
    /// Total gas limit for the batch
    pub gas_limit: u64,
    
    /// Batch priority
    pub priority: u8,
    
    /// Batch creation timestamp
    pub timestamp: u64,
    
    /// Batch status
    pub status: BatchStatus,
}

/// Batch status
#[derive(Clone, Debug, PartialEq)]
pub enum BatchStatus {
    /// Pending execution
    Pending,
    
    /// Currently executing
    Executing,
    
    /// Successfully executed
    Executed,
    
    /// Failed execution
    Failed,
}

/// Transaction dependency
#[derive(Clone, Debug)]
pub struct TransactionDependency {
    /// Source transaction ID
    pub source_tx_id: String,
    
    /// Target transaction ID
    pub target_tx_id: String,
    
    /// Dependency type
    pub dependency_type: DependencyType,
}

/// Dependency type
#[derive(Clone, Debug, PartialEq)]
pub enum DependencyType {
    /// Read dependency (target reads data written by source)
    Read,
    
    /// Write dependency (target writes to same storage as source)
    Write,
    
    /// Execution dependency (target must execute after source)
    Execution,
}

/// Main struct for batch processing
pub struct BatchProcessor {
    /// Configuration
    config: GasOptimizerConfig,
    
    /// Pending transactions
    pending_transactions: Mutex<VecDeque<Transaction>>,
    
    /// Transaction dependencies
    dependencies: Mutex<Vec<TransactionDependency>>,
    
    /// Created batches
    batches: Mutex<Vec<TransactionBatch>>,
    
    /// Next batch ID
    next_batch_id: Mutex<u64>,
}

impl BatchProcessor {
    /// Create a new batch processor with the given configuration
    pub fn new(config: GasOptimizerConfig) -> Self {
        Self {
            config,
            pending_transactions: Mutex::new(VecDeque::new()),
            dependencies: Mutex::new(Vec::new()),
            batches: Mutex::new(Vec::new()),
            next_batch_id: Mutex::new(0),
        }
    }
    
    /// Initialize the batch processor
    pub fn initialize(&self) -> Result<(), String> {
        // Reset state
        if let Ok(mut pending) = self.pending_transactions.lock() {
            pending.clear();
        } else {
            return Err("Failed to lock pending transactions".to_string());
        }
        
        if let Ok(mut deps) = self.dependencies.lock() {
            deps.clear();
        } else {
            return Err("Failed to lock dependencies".to_string());
        }
        
        if let Ok(mut batches) = self.batches.lock() {
            batches.clear();
        } else {
            return Err("Failed to lock batches".to_string());
        }
        
        if let Ok(mut next_id) = self.next_batch_id.lock() {
            *next_id = 0;
        } else {
            return Err("Failed to lock next batch ID".to_string());
        }
        
        Ok(())
    }
    
    /// Add a transaction to the batch processor
    pub fn add_transaction(&self, transaction: Transaction) -> Result<(), String> {
        if let Ok(mut pending) = self.pending_transactions.lock() {
            pending.push_back(transaction);
            Ok(())
        } else {
            Err("Failed to lock pending transactions".to_string())
        }
    }
    
    /// Add a transaction dependency
    pub fn add_dependency(&self, dependency: TransactionDependency) -> Result<(), String> {
        if let Ok(mut deps) = self.dependencies.lock() {
            deps.push(dependency);
            Ok(())
        } else {
            Err("Failed to lock dependencies".to_string())
        }
    }
    
    /// Process pending transactions and create batches
    pub fn process_pending(&self) -> Result<BatchProcessingResult, String> {
        // Get pending transactions
        let transactions = if let Ok(mut pending) = self.pending_transactions.lock() {
            let mut txs = Vec::new();
            while let Some(tx) = pending.pop_front() {
                txs.push(tx);
            }
            txs
        } else {
            return Err("Failed to lock pending transactions".to_string());
        };
        
        // If no transactions, return empty result
        if transactions.is_empty() {
            return Ok(BatchProcessingResult {
                original_tx_count: 0,
                batch_count: 0,
                gas_saved: 0,
                method: BatchProcessingMethod::None,
            });
        }
        
        // Get dependencies
        let dependencies = if let Ok(deps) = self.dependencies.lock() {
            deps.clone()
        } else {
            return Err("Failed to lock dependencies".to_string());
        };
        
        // Create batches based on dependencies and configuration
        let (batches, method) = self.create_batches(&transactions, &dependencies)?;
        
        // Calculate gas saved
        let mut original_gas = 0;
        for tx in &transactions {
            original_gas += tx.estimated_gas;
        }
        
        let mut batched_gas = 0;
        for batch in &batches {
            // Base cost for the batch
            batched_gas += 21000; // Base transaction cost
            
            // Add cost for each transaction in the batch
            for tx in &batch.transactions {
                // Reduced cost due to batching
                let tx_gas = match method {
                    BatchProcessingMethod::SimpleBatching => tx.estimated_gas * 90 / 100, // 10% savings
                    BatchProcessingMethod::MerkleAggregation => tx.estimated_gas * 80 / 100, // 20% savings
                    BatchProcessingMethod::ParallelExecution => tx.estimated_gas * 85 / 100, // 15% savings
                    BatchProcessingMethod::PriorityScheduling => tx.estimated_gas * 95 / 100, // 5% savings
                    BatchProcessingMethod::GasSharing => tx.estimated_gas * 75 / 100, // 25% savings
                    BatchProcessingMethod::Combined(_) => tx.estimated_gas * 70 / 100, // 30% savings
                    BatchProcessingMethod::None => tx.estimated_gas,
                };
                
                batched_gas += tx_gas;
            }
        }
        
        let gas_saved = if original_gas > batched_gas {
            original_gas - batched_gas
        } else {
            0
        };
        
        // Store created batches
        if let Ok(mut batch_lock) = self.batches.lock() {
            batch_lock.extend(batches.clone());
        } else {
            return Err("Failed to lock batches".to_string());
        }
        
        // Return result
        Ok(BatchProcessingResult {
            original_tx_count: transactions.len(),
            batch_count: batches.len(),
            gas_saved,
            method,
        })
    }
    
    /// Create batches from transactions
    fn create_batches(
        &self,
        transactions: &[Transaction],
        dependencies: &[TransactionDependency],
    ) -> Result<(Vec<TransactionBatch>, BatchProcessingMethod), String> {
        // Determine best batching method based on transactions and dependencies
        let method = self.determine_batching_method(transactions, dependencies);
        
        match method {
            BatchProcessingMethod::SimpleBatching => self.create_simple_batches(transactions),
            BatchProcessingMethod::MerkleAggregation => self.create_merkle_batches(transactions),
            BatchProcessingMethod::ParallelExecution => self.create_parallel_batches(transactions, dependencies),
            BatchProcessingMethod::PriorityScheduling => self.create_priority_batches(transactions),
            BatchProcessingMethod::GasSharing => self.create_gas_sharing_batches(transactions),
            BatchProcessingMethod::Combined(methods) => self.create_combined_batches(transactions, dependencies, &methods),
            BatchProcessingMethod::None => Ok((
                vec![self.create_single_batch(transactions)?],
                BatchProcessingMethod::None,
            )),
        }
    }
    
    /// Determine the best batching method
    fn determine_batching_method(
        &self,
        transactions: &[Transaction],
        dependencies: &[TransactionDependency],
    ) -> BatchProcessingMethod {
        // If only one transaction, no batching needed
        if transactions.len() <= 1 {
            return BatchProcessingMethod::None;
        }
        
        // If many dependencies, use parallel execution
        if !dependencies.is_empty() && dependencies.len() > transactions.len() / 4 {
            return BatchProcessingMethod::ParallelExecution;
        }
        
        // If many similar transactions, use Merkle aggregation
        let mut tx_types = HashMap::new();
        for tx in transactions {
            *tx_types.entry(tx.tx_type.clone()).or_insert(0) += 1;
        }
        
        let max_type_count = tx_types.values().max().unwrap_or(&0);
        if *max_type_count > transactions.len() / 2 {
            return BatchProcessingMethod::MerkleAggregation;
        }
        
        // If transactions have varying gas costs, use gas sharing
        let mut min_gas = u64::MAX;
        let mut max_gas = 0;
        
        for tx in transactions {
            min_gas = min_gas.min(tx.estimated_gas);
            max_gas = max_gas.max(tx.estimated_gas);
        }
        
        if max_gas > min_gas * 5 {
            return BatchProcessingMethod::GasSharing;
        }
        
        // Default to simple batching
        BatchProcessingMethod::SimpleBatching
    }
    
    /// Create a single batch containing all transactions
    fn create_single_batch(&self, transactions: &[Transaction]) -> Result<TransactionBatch, String> {
        let batch_id = self.get_next_batch_id()?;
        
        let mut total_gas = 0;
        for tx in transactions {
            total_gas += tx.estimated_gas;
        }
        
        Ok(TransactionBatch {
            id: format!("batch-{}", batch_id),
            transactions: transactions.to_vec(),
            merkle_root: None,
            gas_limit: total_gas,
            priority: 1,
            timestamp: self.get_current_timestamp(),
            status: BatchStatus::Pending,
        })
    }
    
    /// Create simple batches (group by transaction type)
    fn create_simple_batches(
        &self,
        transactions: &[Transaction],
    ) -> Result<(Vec<TransactionBatch>, BatchProcessingMethod), String> {
        let mut batches = Vec::new();
        let mut tx_by_type = HashMap::new();
        
        // Group transactions by type
        for tx in transactions {
            tx_by_type
                .entry(tx.tx_type.clone())
                .or_insert_with(Vec::new)
                .push(tx.clone());
        }
        
        // Create a batch for each type
        for (_, txs) in tx_by_type {
            // Split into smaller batches if needed
            let max_batch_size = self.config.max_batch_size;
            
            for chunk in txs.chunks(max_batch_size) {
                let batch_id = self.get_next_batch_id()?;
                
                let mut total_gas = 0;
                for tx in chunk {
                    total_gas += tx.estimated_gas;
                }
                
                batches.push(TransactionBatch {
                    id: format!("batch-{}", batch_id),
                    transactions: chunk.to_vec(),
                    merkle_root: None,
                    gas_limit: total_gas,
                    priority: 1,
                    timestamp: self.get_current_timestamp(),
                    status: BatchStatus::Pending,
                });
            }
        }
        
        Ok((batches, BatchProcessingMethod::SimpleBatching))
    }
    
    /// Create Merkle batches (use Merkle tree for transaction aggregation)
    fn create_merkle_batches(
        &self,
        transactions: &[Transaction],
    ) -> Result<(Vec<TransactionBatch>, BatchProcessingMethod), String> {
        let mut batches = Vec::new();
        let max_batch_size = self.config.max_batch_size;
        
        // Split transactions into batches
        for chunk in transactions.chunks(max_batch_size) {
            let batch_id = self.get_next_batch_id()?;
            
            // Create Merkle tree from transaction hashes
            let mut tx_hashes = Vec::new();
            for tx in chunk {
                // In a real implementation, we would hash the transaction data
                // Here we just use a simple hash of the ID for demonstration
                let hash = self.simple_hash(&tx.id);
                tx_hashes.push(hash);
            }
            
            let merkle_tree = MerkleTree::new(&tx_hashes);
            let merkle_root = merkle_tree.root();
            
            let mut total_gas = 0;
            for tx in chunk {
                total_gas += tx.estimated_gas;
            }
            
            batches.push(TransactionBatch {
                id: format!("batch-{}", batch_id),
                transactions: chunk.to_vec(),
                merkle_root: Some(merkle_root),
                gas_limit: total_gas,
                priority: 1,
                timestamp: self.get_current_timestamp(),
                status: BatchStatus::Pending,
            });
        }
        
        Ok((batches, BatchProcessingMethod::MerkleAggregation))
    }
    
    /// Create parallel batches (group by dependencies)
    fn create_parallel_batches(
        &self,
        transactions: &[Transaction],
        dependencies: &[TransactionDependency],
    ) -> Result<(Vec<TransactionBatch>, BatchProcessingMethod), String> {
        // Build dependency graph
        let mut graph = HashMap::new();
        let mut reverse_graph = HashMap::new();
        
        for tx in transactions {
            graph.insert(tx.id.clone(), Vec::new());
            reverse_graph.insert(tx.id.clone(), Vec::new());
        }
        
        for dep in dependencies {
            if let Some(deps) = graph.get_mut(&dep.source_tx_id) {
                deps.push(dep.target_tx_id.clone());
            }
            
            if let Some(deps) = reverse_graph.get_mut(&dep.target_tx_id) {
                deps.push(dep.source_tx_id.clone());
            }
        }
        
        // Topological sort to find execution order
        let mut visited = HashMap::new();
        let mut temp_visited = HashMap::new();
        let mut order = Vec::new();
        
        for tx in transactions {
            if !visited.contains_key(&tx.id) {
                if let Err(e) = self.topological_sort(
                    &tx.id,
                    &graph,
                    &mut visited,
                    &mut temp_visited,
                    &mut order,
                ) {
                    return Err(e);
                }
            }
        }
        
        // Group transactions into batches that can be executed in parallel
        let mut batches = Vec::new();
        let mut current_batch = Vec::new();
        let mut current_deps = HashSet::new();
        
        for tx_id in order {
            let tx = transactions
                .iter()
                .find(|t| t.id == tx_id)
                .ok_or_else(|| format!("Transaction {} not found", tx_id))?
                .clone();
            
            // Check if this transaction depends on any in the current batch
            let mut has_dependency = false;
            
            if let Some(deps) = reverse_graph.get(&tx.id) {
                for dep in deps {
                    if current_deps.contains(dep) {
                        has_dependency = true;
                        break;
                    }
                }
            }
            
            // If no dependencies, add to current batch
            if !has_dependency && current_batch.len() < self.config.max_batch_size {
                current_batch.push(tx.clone());
                current_deps.insert(tx.id.clone());
            } else {
                // Start a new batch
                if !current_batch.is_empty() {
                    let batch_id = self.get_next_batch_id()?;
                    
                    let mut total_gas = 0;
                    for tx in &current_batch {
                        total_gas += tx.estimated_gas;
                    }
                    
                    batches.push(TransactionBatch {
                        id: format!("batch-{}", batch_id),
                        transactions: current_batch.clone(),
                        merkle_root: None,
                        gas_limit: total_gas,
                        priority: 1,
                        timestamp: self.get_current_timestamp(),
                        status: BatchStatus::Pending,
                    });
                }
                
                current_batch = vec![tx.clone()];
                current_deps = HashSet::new();
                current_deps.insert(tx.id.clone());
            }
        }
        
        // Add final batch if not empty
        if !current_batch.is_empty() {
            let batch_id = self.get_next_batch_id()?;
            
            let mut total_gas = 0;
            for tx in &current_batch {
                total_gas += tx.estimated_gas;
            }
            
            batches.push(TransactionBatch {
                id: format!("batch-{}", batch_id),
                transactions: current_batch,
                merkle_root: None,
                gas_limit: total_gas,
                priority: 1,
                timestamp: self.get_current_timestamp(),
                status: BatchStatus::Pending,
            });
        }
        
        Ok((batches, BatchProcessingMethod::ParallelExecution))
    }
    
    /// Topological sort helper
    fn topological_sort(
        &self,
        node: &str,
        graph: &HashMap<String, Vec<String>>,
        visited: &mut HashMap<String, bool>,
        temp_visited: &mut HashMap<String, bool>,
        order: &mut Vec<String>,
    ) -> Result<(), String> {
        // Check for cycles
        if temp_visited.contains_key(node) {
            return Err(format!("Cycle detected in dependency graph at node {}", node));
        }
        
        // Skip if already visited
        if visited.contains_key(node) {
            return Ok(());
        }
        
        // Mark as temporarily visited
        temp_visited.insert(node.to_string(), true);
        
        // Visit all dependencies
        if let Some(deps) = graph.get(node) {
            for dep in deps {
                self.topological_sort(dep, graph, visited, temp_visited, order)?;
            }
        }
        
        // Mark as visited
        visited.insert(node.to_string(), true);
        temp_visited.remove(node);
        
        // Add to order
        order.push(node.to_string());
        
        Ok(())
    }
    
    /// Create priority batches (group by priority)
    fn create_priority_batches(
        &self,
        transactions: &[Transaction],
    ) -> Result<(Vec<TransactionBatch>, BatchProcessingMethod), String> {
        let mut batches = Vec::new();
        let max_batch_size = self.config.max_batch_size;
        
        // Group transactions by gas price (as a proxy for priority)
        let mut tx_by_priority = BinaryHeap::new();
        
        for tx in transactions {
            tx_by_priority.push((tx.gas_price, tx.clone()));
        }
        
        // Create batches by priority
        let mut current_batch = Vec::new();
        let mut current_priority = 0;
        
        while let Some((priority, tx)) = tx_by_priority.pop() {
            if current_batch.is_empty() {
                // Start a new batch
                current_batch.push(tx);
                current_priority = priority;
            } else if current_batch.len() < max_batch_size && priority >= current_priority / 2 {
                // Add to current batch if priority is similar
                current_batch.push(tx);
            } else {
                // Start a new batch
                let batch_id = self.get_next_batch_id()?;
                
                let mut total_gas = 0;
                for tx in &current_batch {
                    total_gas += tx.estimated_gas;
                }
                
                batches.push(TransactionBatch {
                    id: format!("batch-{}", batch_id),
                    transactions: current_batch.clone(),
                    merkle_root: None,
                    gas_limit: total_gas,
                    priority: (current_priority / 1_000_000_000) as u8, // Convert gwei to priority
                    timestamp: self.get_current_timestamp(),
                    status: BatchStatus::Pending,
                });
                
                current_batch = vec![tx];
                current_priority = priority;
            }
        }
        
        // Add final batch if not empty
        if !current_batch.is_empty() {
            let batch_id = self.get_next_batch_id()?;
            
            let mut total_gas = 0;
            for tx in &current_batch {
                total_gas += tx.estimated_gas;
            }
            
            batches.push(TransactionBatch {
                id: format!("batch-{}", batch_id),
                transactions: current_batch,
                merkle_root: None,
                gas_limit: total_gas,
                priority: (current_priority / 1_000_000_000) as u8, // Convert gwei to priority
                timestamp: self.get_current_timestamp(),
                status: BatchStatus::Pending,
            });
        }
        
        Ok((batches, BatchProcessingMethod::PriorityScheduling))
    }
    
    /// Create gas sharing batches (optimize gas usage across transactions)
    fn create_gas_sharing_batches(
        &self,
        transactions: &[Transaction],
    ) -> Result<(Vec<TransactionBatch>, BatchProcessingMethod), String> {
        let mut batches = Vec::new();
        let max_batch_size = self.config.max_batch_size;
        let max_gas_per_batch = 12_500_000; // Approximate gas limit per block
        
        // Sort transactions by gas usage (descending)
        let mut sorted_txs = transactions.to_vec();
        sorted_txs.sort_by(|a, b| b.estimated_gas.cmp(&a.estimated_gas));
        
        // Create batches using first-fit decreasing algorithm
        let mut current_batches = Vec::<Vec<Transaction>>::new();
        
        for tx in sorted_txs {
            let mut added = false;
            
            // Try to add to an existing batch
            for batch in &mut current_batches {
                let batch_gas = batch.iter().map(|t| t.estimated_gas).sum::<u64>();
                
                if batch.len() < max_batch_size && batch_gas + tx.estimated_gas <= max_gas_per_batch {
                    batch.push(tx.clone());
                    added = true;
                    break;
                }
            }
            
            // If couldn't add to any existing batch, create a new one
            if !added {
                current_batches.push(vec![tx.clone()]);
            }
        }
        
        // Convert to TransactionBatch objects
        for batch_txs in current_batches {
            let batch_id = self.get_next_batch_id()?;
            
            let mut total_gas = 0;
            for tx in &batch_txs {
                total_gas += tx.estimated_gas;
            }
            
            batches.push(TransactionBatch {
                id: format!("batch-{}", batch_id),
                transactions: batch_txs,
                merkle_root: None,
                gas_limit: total_gas,
                priority: 1,
                timestamp: self.get_current_timestamp(),
                status: BatchStatus::Pending,
            });
        }
        
        Ok((batches, BatchProcessingMethod::GasSharing))
    }
    
    /// Create combined batches (using multiple methods)
    fn create_combined_batches(
        &self,
        transactions: &[Transaction],
        dependencies: &[TransactionDependency],
        methods: &[BatchProcessingMethod],
    ) -> Result<(Vec<TransactionBatch>, BatchProcessingMethod), String> {
        // Start with all transactions
        let mut remaining = transactions.to_vec();
        let mut all_batches = Vec::new();
        
        // Apply each method in sequence
        for method in methods {
            // Skip if no transactions left
            if remaining.is_empty() {
                break;
            }
            
            // Apply the method
            let (batches, _) = match method {
                BatchProcessingMethod::SimpleBatching => self.create_simple_batches(&remaining)?,
                BatchProcessingMethod::MerkleAggregation => self.create_merkle_batches(&remaining)?,
                BatchProcessingMethod::ParallelExecution => {
                    self.create_parallel_batches(&remaining, dependencies)?
                }
                BatchProcessingMethod::PriorityScheduling => self.create_priority_batches(&remaining)?,
                BatchProcessingMethod::GasSharing => self.create_gas_sharing_batches(&remaining)?,
                _ => continue, // Skip None and Combined
            };
            
            // Add batches to result
            all_batches.extend(batches);
            
            // Remove processed transactions
            let processed_ids: HashSet<String> = all_batches
                .iter()
                .flat_map(|b| b.transactions.iter().map(|t| t.id.clone()))
                .collect();
            
            remaining.retain(|tx| !processed_ids.contains(&tx.id));
        }
        
        // If any transactions remain, create a simple batch
        if !remaining.is_empty() {
            let (mut batches, _) = self.create_simple_batches(&remaining)?;
            all_batches.append(&mut batches);
        }
        
        Ok((all_batches, BatchProcessingMethod::Combined(methods.to_vec())))
    }
    
    /// Optimize a batch of transactions
    pub fn optimize_batch(&self, transactions: &[Transaction]) -> Result<BatchProcessingResult, String> {
        // Add transactions to processor
        for tx in transactions {
            self.add_transaction(tx.clone())?;
        }
        
        // Process pending transactions
        self.process_pending()
    }
    
    /// Get the next batch ID
    fn get_next_batch_id(&self) -> Result<u64, String> {
        if let Ok(mut id) = self.next_batch_id.lock() {
            let current = *id;
            *id += 1;
            Ok(current)
        } else {
            Err("Failed to lock next batch ID".to_string())
        }
    }
    
    /// Get current timestamp
    fn get_current_timestamp(&self) -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }
    
    /// Simple hash function for demonstration
    fn simple_hash(&self, data: &str) -> Vec<u8> {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        
        let mut hasher = DefaultHasher::new();
        data.hash(&mut hasher);
        let hash = hasher.finish();
        
        let mut result = Vec::new();
        for i in 0..8 {
            result.push(((hash >> (i * 8)) & 0xff) as u8);
        }
        
        result
    }
}

use std::collections::HashSet;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gas_optimization::{GasOptimizerConfig, Transaction, TransactionType};
    
    #[test]
    fn test_batch_processor_initialization() {
        let config = GasOptimizerConfig::default();
        let processor = BatchProcessor::new(config);
        
        let result = processor.initialize();
        assert!(result.is_ok());
    }
    
    #[test]
    fn test_simple_batching() {
        let config = GasOptimizerConfig::default();
        let processor = BatchProcessor::new(config);
        processor.initialize().unwrap();
        
        // Create test transactions
        let mut transactions = Vec::new();
        
        for i in 0..10 {
            transactions.push(Transaction {
                id: format!("tx-{}", i),
                data: vec![0; 100],
                estimated_gas: 50000,
                original_gas: 50000,
                gas_price: 50_000_000_000, // 50 gwei
                tx_type: TransactionType::Transfer,
                storage_access: Vec::new(),
                execution_steps: Vec::new(),
            });
        }
        
        // Add transactions to processor
        for tx in &transactions {
            processor.add_transaction(tx.clone()).unwrap();
        }
        
        // Process pending transactions
        let result = processor.process_pending();
        assert!(result.is_ok());
        
        let batch_result = result.unwrap();
        assert_eq!(batch_result.original_tx_count, 10);
        assert!(batch_result.batch_count > 0);
        assert!(batch_result.gas_saved > 0);
    }
}
