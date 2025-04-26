// src/scalability/parallel_processing.rs
//! Parallel Processing module for Scalability Optimization
//! 
//! This module implements parallel transaction processing:
//! - Multi-threaded execution engine
//! - Transaction dependency analysis
//! - Workload balancing
//! - Concurrent state access management
//!
//! Parallel processing significantly increases throughput by
//! executing multiple transactions simultaneously.

use solana_program::{
    program_error::ProgramError,
    msg,
};
use std::sync::{Arc, Mutex};
use std::thread;
use thiserror::Error;

/// Errors that can occur in the Parallel Processing module
#[derive(Error, Debug)]
pub enum ParallelExecutionError {
    #[error("Parallel executor not initialized")]
    NotInitialized,

    #[error("Invalid thread configuration: {0}")]
    InvalidThreadConfiguration(String),

    #[error("Thread creation failed: {0}")]
    ThreadCreationFailed(String),

    #[error("Thread join failed: {0}")]
    ThreadJoinFailed(String),

    #[error("Empty batch")]
    EmptyBatch,

    #[error("Dependency analysis failed: {0}")]
    DependencyAnalysisFailed(String),

    #[error("Execution timeout after {0} ms")]
    ExecutionTimeout(u64),

    #[error("Program error: {0}")]
    ProgramError(#[from] ProgramError),

    #[error("Unknown error")]
    Unknown,
}

/// Result type for Parallel Processing operations
pub type ParallelExecutionResult<T> = Result<T, ParallelExecutionError>;

/// Execution result
#[derive(Debug, Clone)]
pub struct ExecutionResult {
    /// Batch ID
    pub batch_id: u64,
    
    /// Success count
    pub success_count: u32,
    
    /// Failure count
    pub failure_count: u32,
    
    /// Execution time in milliseconds
    pub execution_time_ms: u64,
    
    /// Transactions per second
    pub transactions_per_second: f64,
}

impl ExecutionResult {
    /// Create a new execution result
    pub fn new(batch_id: u64, success_count: u32, failure_count: u32, execution_time_ms: u64) -> Self {
        let total_count = success_count + failure_count;
        let transactions_per_second = if execution_time_ms > 0 {
            (total_count as f64 * 1000.0) / execution_time_ms as f64
        } else {
            0.0
        };
        
        Self {
            batch_id,
            success_count,
            failure_count,
            execution_time_ms,
            transactions_per_second,
        }
    }
    
    /// Get the total transaction count
    pub fn total_count(&self) -> u32 {
        self.success_count + self.failure_count
    }
    
    /// Get the success rate
    pub fn success_rate(&self) -> f64 {
        if self.total_count() > 0 {
            self.success_count as f64 / self.total_count() as f64
        } else {
            0.0
        }
    }
}

/// Parallel executor configuration
#[derive(Debug, Clone)]
pub struct ParallelExecutorConfig {
    /// Maximum number of parallel threads
    pub max_parallel_threads: u32,
    
    /// Execution timeout in milliseconds
    pub execution_timeout_ms: u64,
    
    /// Whether to analyze dependencies
    pub analyze_dependencies: bool,
    
    /// Maximum dependency groups
    pub max_dependency_groups: u32,
}

impl Default for ParallelExecutorConfig {
    fn default() -> Self {
        Self {
            max_parallel_threads: 8,
            execution_timeout_ms: 30000, // 30 seconds
            analyze_dependencies: true,
            max_dependency_groups: 16,
        }
    }
}

impl ParallelExecutorConfig {
    /// Validate the configuration
    pub fn validate(&self) -> ParallelExecutionResult<()> {
        if self.max_parallel_threads == 0 {
            return Err(ParallelExecutionError::InvalidThreadConfiguration(
                "Maximum parallel threads cannot be zero".to_string()
            ));
        }
        
        if self.max_parallel_threads > 64 {
            return Err(ParallelExecutionError::InvalidThreadConfiguration(
                format!("Maximum parallel threads ({}) exceeds limit (64)", self.max_parallel_threads)
            ));
        }
        
        if self.execution_timeout_ms == 0 {
            return Err(ParallelExecutionError::InvalidThreadConfiguration(
                "Execution timeout cannot be zero".to_string()
            ));
        }
        
        if self.max_dependency_groups == 0 {
            return Err(ParallelExecutionError::InvalidThreadConfiguration(
                "Maximum dependency groups cannot be zero".to_string()
            ));
        }
        
        Ok(())
    }
}

/// Parallel executor for scalability optimization
pub struct ParallelExecutor {
    /// Executor configuration
    config: ParallelExecutorConfig,
    
    /// Whether the parallel executor is initialized
    initialized: bool,
}

impl ParallelExecutor {
    /// Create a new parallel executor with default configuration
    pub fn new() -> Self {
        Self {
            config: ParallelExecutorConfig::default(),
            initialized: false,
        }
    }
    
    /// Create a new parallel executor with the specified configuration
    pub fn with_config(config: ParallelExecutorConfig) -> ParallelExecutionResult<Self> {
        // Validate the configuration
        config.validate()?;
        
        Ok(Self {
            config,
            initialized: false,
        })
    }
    
    /// Initialize the parallel executor
    pub fn initialize(&mut self) -> ParallelExecutionResult<()> {
        self.initialized = true;
        
        msg!("Parallel executor initialized with {} threads", self.config.max_parallel_threads);
        
        Ok(())
    }
    
    /// Check if the parallel executor is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Execute a batch of transactions in parallel
    pub fn execute_batch(&self, batch: &crate::scalability::transaction_batching::TransactionBatch) -> ParallelExecutionResult<ExecutionResult> {
        if !self.initialized {
            return Err(ParallelExecutionError::NotInitialized);
        }
        
        if batch.transactions.is_empty() {
            return Err(ParallelExecutionError::EmptyBatch);
        }
        
        // Start timing
        let start_time = std::time::Instant::now();
        
        // Create shared counters for success and failure
        let success_count = Arc::new(Mutex::new(0u32));
        let failure_count = Arc::new(Mutex::new(0u32));
        
        // Analyze transaction dependencies if configured
        let dependency_groups = if self.config.analyze_dependencies {
            match self.analyze_dependencies(&batch.transactions) {
                Ok(groups) => groups,
                Err(e) => return Err(e),
            }
        } else {
            vec![batch.transactions.clone()]
        };
        
        // Execute each dependency group sequentially, but transactions within a group in parallel
        for group in dependency_groups {
            // Skip empty groups
            if group.is_empty() {
                continue;
            }
            
            // Determine the number of threads to use
            let thread_count = std::cmp::min(group.len(), self.config.max_parallel_threads as usize);
            
            // Create a vector to hold the thread handles
            let mut handles = Vec::with_capacity(thread_count);
            
            // Divide the transactions among the threads
            let chunk_size = (group.len() + thread_count - 1) / thread_count;
            
            for chunk in group.chunks(chunk_size) {
                // Clone the counters for this thread
                let success_count_clone = Arc::clone(&success_count);
                let failure_count_clone = Arc::clone(&failure_count);
                
                // Clone the transactions for this thread
                let chunk_clone = chunk.to_vec();
                
                // Spawn a thread to execute the transactions
                let handle = match thread::spawn(move || {
                    for transaction in chunk_clone {
                        // In a real implementation, we would execute the transaction
                        // For now, we'll just simulate success or failure
                        let success = transaction.len() % 10 != 0; // 90% success rate
                        
                        if success {
                            // Increment the success counter
                            if let Ok(mut success_count) = success_count_clone.lock() {
                                *success_count += 1;
                            }
                        } else {
                            // Increment the failure counter
                            if let Ok(mut failure_count) = failure_count_clone.lock() {
                                *failure_count += 1;
                            }
                        }
                    }
                }) {
                    Ok(handle) => handle,
                    Err(e) => return Err(ParallelExecutionError::ThreadCreationFailed(e.to_string())),
                };
                
                handles.push(handle);
            }
            
            // Wait for all threads to complete
            for handle in handles {
                if let Err(e) = handle.join() {
                    return Err(ParallelExecutionError::ThreadJoinFailed(format!("{:?}", e)));
                }
            }
            
            // Check if we've exceeded the timeout
            let elapsed_ms = start_time.elapsed().as_millis() as u64;
            if elapsed_ms > self.config.execution_timeout_ms {
                return Err(ParallelExecutionError::ExecutionTimeout(elapsed_ms));
            }
        }
        
        // Calculate the execution time
        let execution_time = start_time.elapsed();
        let execution_time_ms = execution_time.as_millis() as u64;
        
        // Get the final counters
        let success_count = match success_count.lock() {
            Ok(count) => *count,
            Err(_) => return Err(ParallelExecutionError::Unknown),
        };
        
        let failure_count = match failure_count.lock() {
            Ok(count) => *count,
            Err(_) => return Err(ParallelExecutionError::Unknown),
        };
        
        // Create the execution result
        let result = ExecutionResult::new(
            batch.id,
            success_count,
            failure_count,
            execution_time_ms
        );
        
        msg!("Batch executed: id: {}, success: {}, failure: {}, time: {} ms, tps: {:.2}", 
            batch.id, success_count, failure_count, execution_time_ms, result.transactions_per_second);
        
        Ok(result)
    }
    
    /// Execute multiple batches of transactions in parallel
    pub fn execute_batches(&self, batches: &[crate::scalability::transaction_batching::TransactionBatch]) -> ParallelExecutionResult<Vec<ExecutionResult>> {
        if !self.initialized {
            return Err(ParallelExecutionError::NotInitialized);
        }
        
        if batches.is_empty() {
            return Ok(Vec::new());
        }
        
        let mut results = Vec::with_capacity(batches.len());
        
        for batch in batches {
            let result = self.execute_batch(batch)?;
            results.push(result);
        }
        
        Ok(results)
    }
    
    /// Analyze transaction dependencies
    fn analyze_dependencies(&self, transactions: &[Vec<u8>]) -> ParallelExecutionResult<Vec<Vec<Vec<u8>>>> {
        if transactions.is_empty() {
            return Ok(Vec::new());
        }
        
        // In a real implementation, we would analyze the transactions to identify dependencies
        // For now, we'll create groups based on transaction size as a simple heuristic
        
        // Group transactions by size modulo max_dependency_groups
        let mut groups = vec![Vec::new(); self.config.max_dependency_groups as usize];
        
        for transaction in transactions {
            let group_index = transaction.len() % self.config.max_dependency_groups as usize;
            groups[group_index].push(transaction.clone());
        }
        
        // Remove empty groups
        groups.retain(|group| !group.is_empty());
        
        // If all groups were empty (shouldn't happen), return a single group with all transactions
        if groups.is_empty() {
            return Ok(vec![transactions.to_vec()]);
        }
        
        Ok(groups)
    }
    
    /// Update the parallel executor configuration
    pub fn update_config(&mut self, config: ParallelExecutorConfig) -> ParallelExecutionResult<()> {
        if !self.initialized {
            return Err(ParallelExecutionError::NotInitialized);
        }
        
        // Validate the configuration
        config.validate()?;
        
        self.config = config;
        
        msg!("Parallel executor configuration updated");
        
        Ok(())
    }
    
    /// Get the current configuration
    pub fn get_config(&self) -> &ParallelExecutorConfig {
        &self.config
    }
    
    /// Get the available processor count
    pub fn get_available_processors() -> usize {
        match std::thread::available_parallelism() {
            Ok(n) => n.get(),
            Err(_) => 1, // Default to 1 if we can't determine
        }
    }
    
    /// Recommend optimal thread count based on system resources
    pub fn recommend_thread_count() -> u32 {
        let processor_count = Self::get_available_processors();
        
        // Use 75% of available processors, but at least 1 and at most 32
        let recommended = (processor_count * 3 / 4).max(1).min(32);
        
        recommended as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scalability::transaction_batching::TransactionBatch;
    
    // Helper function to create a test batch
    fn create_test_batch(id: u64, transaction_count: usize) -> TransactionBatch {
        let transactions: Vec<Vec<u8>> = (0..transaction_count)
            .map(|i| vec![i as u8; 100])
            .collect();
        
        let total_size = transactions.iter().map(|t| t.len()).sum();
        
        TransactionBatch {
            id,
            transactions,
            total_size,
            estimated_gas: 0,
            priority: 0,
            created_at: 0,
        }
    }
    
    #[test]
    fn test_parallel_executor_creation() {
        let executor = ParallelExecutor::new();
        assert!(!executor.is_initialized());
    }
    
    #[test]
    fn test_parallel_executor_with_config() {
        let config = ParallelExecutorConfig {
            max_parallel_threads: 16,
            ..ParallelExecutorConfig::default()
        };
        
        let executor = ParallelExecutor::with_config(config).unwrap();
        assert!(!executor.is_initialized());
        assert_eq!(executor.config.max_parallel_threads, 16);
    }
    
    #[test]
    fn test_invalid_configuration() {
        // Test zero max_parallel_threads
        let config = ParallelExecutorConfig {
            max_parallel_threads: 0,
            ..ParallelExecutorConfig::default()
        };
        
        let result = ParallelExecutor::with_config(config);
        assert!(result.is_err());
        
        // Test excessive max_parallel_threads
        let config = ParallelExecutorConfig {
            max_parallel_threads: 100,
            ..ParallelExecutorConfig::default()
        };
        
        let result = ParallelExecutor::with_config(config);
        assert!(result.is_err());
        
        // Test zero execution_timeout_ms
        let config = ParallelExecutorConfig {
            execution_timeout_ms: 0,
            ..ParallelExecutorConfig::default()
        };
        
        let result = ParallelExecutor::with_config(config);
        assert!(result.is_err());
        
        // Test zero max_dependency_groups
        let config = ParallelExecutorConfig {
            max_dependency_groups: 0,
            ..ParallelExecutorConfig::default()
        };
        
        let result = ParallelExecutor::with_config(config);
        assert!(result.is_err());
    }
    
    #[test]
    fn test_initialization() {
        let mut executor = ParallelExecutor::new();
        assert!(!executor.is_initialized());
        
        executor.initialize().unwrap();
        assert!(executor.is_initialized());
    }
    
    #[test]
    fn test_execute_batch() {
        let mut executor = ParallelExecutor::new();
        executor.initialize().unwrap();
        
        // Create a test batch
        let batch = create_test_batch(1, 100);
        
        // Execute the batch
        let result = executor.execute_batch(&batch).unwrap();
        
        // Check the result
        assert_eq!(result.batch_id, 1);
        assert_eq!(result.total_count(), 100);
        assert!(result.execution_time_ms > 0);
        assert!(result.transactions_per_second > 0.0);
    }
    
    #[test]
    fn test_execute_empty_batch() {
        let mut executor = ParallelExecutor::new();
        executor.initialize().unwrap();
        
        // Create an empty batch
        let batch = create_test_batch(1, 0);
        
        // Execute the batch
        let result = executor.execute_batch(&batch);
        
        // Check that we get an error
        assert!(result.is_err());
        match result {
            Err(ParallelExecutionError::EmptyBatch) => (),
            _ => panic!("Expected EmptyBatch error"),
        }
    }
    
    #[test]
    fn test_execute_batches() {
        let mut executor = ParallelExecutor::new();
        executor.initialize().unwrap();
        
        // Create test batches
        let batches = vec![
            create_test_batch(1, 100),
            create_test_batch(2, 200),
            create_test_batch(3, 300),
        ];
        
        // Execute the batches
        let results = executor.execute_batches(&batches).unwrap();
        
        // Check the results
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].batch_id, 1);
        assert_eq!(results[0].total_count(), 100);
        assert_eq!(results[1].batch_id, 2);
        assert_eq!(results[1].total_count(), 200);
        assert_eq!(results[2].batch_id, 3);
        assert_eq!(results[2].total_count(), 300);
    }
    
    #[test]
    fn test_analyze_dependencies() {
        let mut executor = ParallelExecutor::new();
        executor.initialize().unwrap();
        
        // Create test transactions
        let transactions: Vec<Vec<u8>> = (0..100)
            .map(|i| vec![i as u8; 100])
            .collect();
        
        // Analyze dependencies
        let groups = executor.analyze_dependencies(&transactions).unwrap();
        
        // Check that we have some groups
        assert!(!groups.is_empty());
        
        // Check that all transactions are accounted for
        let total_transactions: usize = groups.iter().map(|g| g.len()).sum();
        assert_eq!(total_transactions, 100);
    }
    
    #[test]
    fn test_update_config() {
        let mut executor = ParallelExecutor::new();
        executor.initialize().unwrap();
        
        // Update the configuration
        let config = ParallelExecutorConfig {
            max_parallel_threads: 16,
            ..ParallelExecutorConfig::default()
        };
        
        let result = executor.update_config(config);
        assert!(result.is_ok());
        assert_eq!(executor.config.max_parallel_threads, 16);
    }
    
    #[test]
    fn test_execution_result() {
        let result = ExecutionResult::new(1, 90, 10, 1000);
        
        assert_eq!(result.batch_id, 1);
        assert_eq!(result.success_count, 90);
        assert_eq!(result.failure_count, 10);
        assert_eq!(result.execution_time_ms, 1000);
        assert_eq!(result.total_count(), 100);
        assert_eq!(result.success_rate(), 0.9);
        assert_eq!(result.transactions_per_second, 100.0);
    }
    
    #[test]
    fn test_recommend_thread_count() {
        let recommended = ParallelExecutor::recommend_thread_count();
        
        // Check that the recommendation is reasonable
        assert!(recommended >= 1);
        assert!(recommended <= 32);
    }
}
