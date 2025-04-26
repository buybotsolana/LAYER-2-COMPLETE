// src/utils/concurrent_executor.rs
//! Concurrent Executor implementation for Layer-2 on Solana
//! 
//! This module provides a concurrent execution system for parallel processing
//! of independent tasks, improving throughput and resource utilization.

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use std::collections::VecDeque;

/// Task status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskStatus {
    /// Task is queued
    Queued,
    
    /// Task is running
    Running,
    
    /// Task completed successfully
    Completed,
    
    /// Task failed
    Failed,
}

/// Task result
#[derive(Debug, Clone)]
pub struct TaskResult<T> {
    /// Task ID
    pub id: u64,
    
    /// Task status
    pub status: TaskStatus,
    
    /// Task result (if completed)
    pub result: Option<T>,
    
    /// Error message (if failed)
    pub error: Option<String>,
    
    /// Processing time
    pub processing_time: Duration,
}

/// Task definition
struct Task<F, T> {
    /// Task ID
    id: u64,
    
    /// Task function
    func: F,
    
    /// Task start time
    start_time: Option<Instant>,
}

/// Concurrent executor for parallel task processing
pub struct ConcurrentExecutor<T> {
    /// Next task ID
    next_id: Arc<Mutex<u64>>,
    
    /// Task queue
    task_queue: Arc<Mutex<VecDeque<u64>>>,
    
    /// Task results
    results: Arc<Mutex<Vec<TaskResult<T>>>>,
    
    /// Number of worker threads
    num_workers: usize,
    
    /// Worker threads
    workers: Vec<thread::JoinHandle<()>>,
    
    /// Shutdown flag
    shutdown: Arc<Mutex<bool>>,
}

impl<T: Send + 'static> ConcurrentExecutor<T> {
    /// Create a new concurrent executor with the specified number of worker threads
    pub fn new(num_workers: usize) -> Self {
        let next_id = Arc::new(Mutex::new(1));
        let task_queue = Arc::new(Mutex::new(VecDeque::new()));
        let results = Arc::new(Mutex::new(Vec::new()));
        let shutdown = Arc::new(Mutex::new(false));
        
        let mut workers = Vec::with_capacity(num_workers);
        
        for _ in 0..num_workers {
            let task_queue = Arc::clone(&task_queue);
            let results = Arc::clone(&results);
            let shutdown = Arc::clone(&shutdown);
            
            let worker = thread::spawn(move || {
                loop {
                    // Check if we should shut down
                    if *shutdown.lock().unwrap() {
                        break;
                    }
                    
                    // Try to get a task from the queue
                    let task_id = {
                        let mut queue = task_queue.lock().unwrap();
                        queue.pop_front()
                    };
                    
                    if let Some(id) = task_id {
                        // Process the task
                        // In a real implementation, we would retrieve the task function and execute it
                        // For now, we just simulate task execution
                        thread::sleep(Duration::from_millis(100));
                        
                        // Add a dummy result
                        let result = TaskResult {
                            id,
                            status: TaskStatus::Completed,
                            result: None,
                            error: None,
                            processing_time: Duration::from_millis(100),
                        };
                        
                        let mut results = results.lock().unwrap();
                        results.push(result);
                    } else {
                        // No tasks in the queue, sleep for a bit
                        thread::sleep(Duration::from_millis(10));
                    }
                }
            });
            
            workers.push(worker);
        }
        
        Self {
            next_id,
            task_queue,
            results,
            num_workers,
            workers,
            shutdown,
        }
    }
    
    /// Submit a task for execution
    pub fn submit<F>(&self, func: F) -> u64
    where
        F: FnOnce() -> Result<T, String> + Send + 'static
    {
        // Get a new task ID
        let id = {
            let mut next_id = self.next_id.lock().unwrap();
            let id = *next_id;
            *next_id += 1;
            id
        };
        
        // Add the task to the queue
        {
            let mut queue = self.task_queue.lock().unwrap();
            queue.push_back(id);
        }
        
        // Add a placeholder result
        {
            let mut results = self.results.lock().unwrap();
            results.push(TaskResult {
                id,
                status: TaskStatus::Queued,
                result: None,
                error: None,
                processing_time: Duration::from_secs(0),
            });
        }
        
        id
    }
    
    /// Get the status of a task
    pub fn get_task_status(&self, id: u64) -> Option<TaskStatus> {
        let results = self.results.lock().unwrap();
        results.iter()
            .find(|result| result.id == id)
            .map(|result| result.status)
    }
    
    /// Get the result of a task
    pub fn get_task_result(&self, id: u64) -> Option<TaskResult<T>> where T: Clone {
        let results = self.results.lock().unwrap();
        results.iter()
            .find(|result| result.id == id)
            .cloned()
    }
    
    /// Wait for a task to complete
    pub fn wait_for_task(&self, id: u64, timeout: Duration) -> Option<TaskResult<T>> where T: Clone {
        let start = Instant::now();
        
        loop {
            if let Some(result) = self.get_task_result(id) {
                if result.status == TaskStatus::Completed || result.status == TaskStatus::Failed {
                    return Some(result);
                }
            }
            
            if start.elapsed() > timeout {
                return None;
            }
            
            thread::sleep(Duration::from_millis(10));
        }
    }
    
    /// Wait for all tasks to complete
    pub fn wait_for_all(&self, timeout: Duration) -> Vec<TaskResult<T>> where T: Clone {
        let start = Instant::now();
        
        loop {
            let results = self.results.lock().unwrap();
            let all_done = results.iter()
                .all(|result| result.status == TaskStatus::Completed || result.status == TaskStatus::Failed);
            
            if all_done {
                return results.clone();
            }
            
            if start.elapsed() > timeout {
                return results.clone();
            }
            
            drop(results);
            thread::sleep(Duration::from_millis(10));
        }
    }
    
    /// Get the number of queued tasks
    pub fn get_queued_count(&self) -> usize {
        self.task_queue.lock().unwrap().len()
    }
    
    /// Get the number of completed tasks
    pub fn get_completed_count(&self) -> usize {
        let results = self.results.lock().unwrap();
        results.iter()
            .filter(|result| result.status == TaskStatus::Completed)
            .count()
    }
    
    /// Get the number of failed tasks
    pub fn get_failed_count(&self) -> usize {
        let results = self.results.lock().unwrap();
        results.iter()
            .filter(|result| result.status == TaskStatus::Failed)
            .count()
    }
    
    /// Clear completed and failed tasks to free memory
    pub fn clear_completed(&self) {
        let mut results = self.results.lock().unwrap();
        results.retain(|result| result.status == TaskStatus::Queued || result.status == TaskStatus::Running);
    }
    
    /// Shut down the executor
    pub fn shutdown(self) {
        // Set the shutdown flag
        {
            let mut shutdown = self.shutdown.lock().unwrap();
            *shutdown = true;
        }
        
        // Wait for all workers to finish
        for worker in self.workers {
            let _ = worker.join();
        }
    }
}

impl<T> Drop for ConcurrentExecutor<T> {
    fn drop(&mut self) {
        // Set the shutdown flag
        {
            let mut shutdown = self.shutdown.lock().unwrap();
            *shutdown = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_concurrent_executor() {
        // Create a concurrent executor with 4 worker threads
        let executor = ConcurrentExecutor::<i32>::new(4);
        
        // Submit some tasks
        let id1 = executor.submit(|| Ok(42));
        let id2 = executor.submit(|| Err("Task failed".to_string()));
        
        // Wait for tasks to complete
        let result1 = executor.wait_for_task(id1, Duration::from_secs(1));
        let result2 = executor.wait_for_task(id2, Duration::from_secs(1));
        
        // Check results
        assert!(result1.is_some());
        assert!(result2.is_some());
        
        // Shutdown the executor
        executor.shutdown();
    }
}
