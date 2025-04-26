// src/utils/batch_processor.rs
//! Batch Processor implementation for Layer-2 on Solana
//! 
//! This module provides an efficient batch processing system for
//! handling multiple operations in a single pass, reducing overhead
//! and improving throughput.

use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Operation status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperationStatus {
    /// Operation is pending
    Pending,
    
    /// Operation is in progress
    InProgress,
    
    /// Operation completed successfully
    Completed,
    
    /// Operation failed
    Failed,
}

/// Operation result
#[derive(Debug, Clone)]
pub struct OperationResult<T> {
    /// Operation ID
    pub id: u64,
    
    /// Operation status
    pub status: OperationStatus,
    
    /// Operation result (if completed)
    pub result: Option<T>,
    
    /// Error message (if failed)
    pub error: Option<String>,
    
    /// Processing time
    pub processing_time: Duration,
}

/// Batch processor for efficient handling of multiple operations
pub struct BatchProcessor<T, R> {
    /// Next operation ID
    next_id: u64,
    
    /// Pending operations
    pending_operations: HashMap<u64, T>,
    
    /// In-progress operations
    in_progress_operations: HashMap<u64, (T, Instant)>,
    
    /// Completed operations
    completed_operations: HashMap<u64, OperationResult<R>>,
    
    /// Batch size
    batch_size: usize,
    
    /// Operation timeout
    operation_timeout: Duration,
}

impl<T, R> BatchProcessor<T, R> {
    /// Create a new batch processor with the specified batch size and timeout
    pub fn new(batch_size: usize, operation_timeout: Duration) -> Self {
        Self {
            next_id: 1,
            pending_operations: HashMap::new(),
            in_progress_operations: HashMap::new(),
            completed_operations: HashMap::new(),
            batch_size,
            operation_timeout,
        }
    }
    
    /// Add an operation to the batch
    pub fn add_operation(&mut self, operation: T) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        
        self.pending_operations.insert(id, operation);
        
        id
    }
    
    /// Get the next batch of operations to process
    pub fn get_next_batch(&mut self) -> Vec<(u64, T)> where T: Clone {
        // Check for timed out operations
        let now = Instant::now();
        let timed_out: Vec<u64> = self.in_progress_operations.iter()
            .filter(|(_, (_, start_time))| now.duration_since(*start_time) > self.operation_timeout)
            .map(|(id, _)| *id)
            .collect();
        
        // Move timed out operations back to pending
        for id in timed_out {
            if let Some((operation, _)) = self.in_progress_operations.remove(&id) {
                self.pending_operations.insert(id, operation);
            }
        }
        
        // Get the next batch of operations
        let mut batch = Vec::new();
        let mut pending_ids: Vec<u64> = self.pending_operations.keys().cloned().collect();
        pending_ids.sort(); // Process in order of ID
        
        for id in pending_ids.iter().take(self.batch_size) {
            if let Some(operation) = self.pending_operations.remove(id) {
                batch.push((*id, operation.clone()));
                self.in_progress_operations.insert(*id, (operation, Instant::now()));
            }
        }
        
        batch
    }
    
    /// Complete an operation with a result
    pub fn complete_operation(&mut self, id: u64, result: R) {
        if let Some((_, start_time)) = self.in_progress_operations.remove(&id) {
            let processing_time = start_time.elapsed();
            
            let operation_result = OperationResult {
                id,
                status: OperationStatus::Completed,
                result: Some(result),
                error: None,
                processing_time,
            };
            
            self.completed_operations.insert(id, operation_result);
        }
    }
    
    /// Fail an operation with an error
    pub fn fail_operation(&mut self, id: u64, error: String) {
        if let Some((_, start_time)) = self.in_progress_operations.remove(&id) {
            let processing_time = start_time.elapsed();
            
            let operation_result = OperationResult {
                id,
                status: OperationStatus::Failed,
                result: None,
                error: Some(error),
                processing_time,
            };
            
            self.completed_operations.insert(id, operation_result);
        }
    }
    
    /// Get the status of an operation
    pub fn get_operation_status(&self, id: u64) -> OperationStatus {
        if self.pending_operations.contains_key(&id) {
            OperationStatus::Pending
        } else if self.in_progress_operations.contains_key(&id) {
            OperationStatus::InProgress
        } else if let Some(result) = self.completed_operations.get(&id) {
            result.status
        } else {
            // Operation not found
            OperationStatus::Failed
        }
    }
    
    /// Get the result of an operation
    pub fn get_operation_result(&self, id: u64) -> Option<&OperationResult<R>> {
        self.completed_operations.get(&id)
    }
    
    /// Get all completed operations
    pub fn get_completed_operations(&self) -> Vec<&OperationResult<R>> {
        self.completed_operations.values().collect()
    }
    
    /// Get all pending operations
    pub fn get_pending_operations_count(&self) -> usize {
        self.pending_operations.len()
    }
    
    /// Get all in-progress operations
    pub fn get_in_progress_operations_count(&self) -> usize {
        self.in_progress_operations.len()
    }
    
    /// Get all completed operations
    pub fn get_completed_operations_count(&self) -> usize {
        self.completed_operations.len()
    }
    
    /// Clear completed operations to free memory
    pub fn clear_completed_operations(&mut self) {
        self.completed_operations.clear();
    }
    
    /// Process a batch of operations with the provided processor function
    pub fn process_batch<F>(&mut self, processor: F) 
    where 
        F: Fn(&T) -> Result<R, String>,
        T: Clone
    {
        let batch = self.get_next_batch();
        
        for (id, operation) in batch {
            match processor(&operation) {
                Ok(result) => self.complete_operation(id, result),
                Err(error) => self.fail_operation(id, error),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_batch_processor() {
        // Create a batch processor for string operations
        let mut processor = BatchProcessor::<String, String>::new(5, Duration::from_secs(10));
        
        // Add some operations
        let id1 = processor.add_operation("Operation 1".to_string());
        let id2 = processor.add_operation("Operation 2".to_string());
        let id3 = processor.add_operation("Operation 3".to_string());
        
        // Check operation status
        assert_eq!(processor.get_operation_status(id1), OperationStatus::Pending);
        assert_eq!(processor.get_operation_status(id2), OperationStatus::Pending);
        assert_eq!(processor.get_operation_status(id3), OperationStatus::Pending);
        
        // Get a batch of operations
        let batch = processor.get_next_batch();
        assert_eq!(batch.len(), 3);
        
        // Check operation status after getting batch
        assert_eq!(processor.get_operation_status(id1), OperationStatus::InProgress);
        assert_eq!(processor.get_operation_status(id2), OperationStatus::InProgress);
        assert_eq!(processor.get_operation_status(id3), OperationStatus::InProgress);
        
        // Complete an operation
        processor.complete_operation(id1, "Result 1".to_string());
        
        // Fail an operation
        processor.fail_operation(id2, "Error 2".to_string());
        
        // Check operation status after completion
        assert_eq!(processor.get_operation_status(id1), OperationStatus::Completed);
        assert_eq!(processor.get_operation_status(id2), OperationStatus::Failed);
        assert_eq!(processor.get_operation_status(id3), OperationStatus::InProgress);
        
        // Get operation results
        let result1 = processor.get_operation_result(id1).unwrap();
        assert_eq!(result1.status, OperationStatus::Completed);
        assert_eq!(result1.result, Some("Result 1".to_string()));
        
        let result2 = processor.get_operation_result(id2).unwrap();
        assert_eq!(result2.status, OperationStatus::Failed);
        assert_eq!(result2.error, Some("Error 2".to_string()));
        
        // Process a batch with a processor function
        let mut processor2 = BatchProcessor::<i32, i32>::new(5, Duration::from_secs(10));
        
        // Add some operations
        let id4 = processor2.add_operation(10);
        let id5 = processor2.add_operation(0);
        
        // Process the batch
        processor2.process_batch(|&x| {
            if x == 0 {
                Err("Division by zero".to_string())
            } else {
                Ok(100 / x)
            }
        });
        
        // Check results
        let result4 = processor2.get_operation_result(id4).unwrap();
        assert_eq!(result4.status, OperationStatus::Completed);
        assert_eq!(result4.result, Some(10));
        
        let result5 = processor2.get_operation_result(id5).unwrap();
        assert_eq!(result5.status, OperationStatus::Failed);
        assert_eq!(result5.error, Some("Division by zero".to_string()));
    }
}
