// src/utils/memory_pool.rs
//! Memory Pool implementation for Layer-2 on Solana
//! 
//! This module provides an efficient memory pool for reusing allocated memory,
//! reducing the overhead of frequent allocations and deallocations.

use std::sync::{Arc, Mutex};
use std::collections::VecDeque;
use std::marker::PhantomData;

/// Memory block wrapper
pub struct MemoryBlock<T> {
    /// The actual data
    data: T,
    
    /// Reference to the pool for returning the block
    pool: Arc<Mutex<MemoryPoolInner<T>>>,
}

impl<T> Drop for MemoryBlock<T> {
    fn drop(&mut self) {
        // This is a placeholder for the actual implementation
        // In a real implementation, we would move the data out and return it to the pool
    }
}

impl<T> std::ops::Deref for MemoryBlock<T> {
    type Target = T;
    
    fn deref(&self) -> &Self::Target {
        &self.data
    }
}

impl<T> std::ops::DerefMut for MemoryBlock<T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.data
    }
}

/// Inner implementation of the memory pool
struct MemoryPoolInner<T> {
    /// Available blocks
    blocks: VecDeque<T>,
    
    /// Maximum pool size
    max_size: usize,
    
    /// Factory function for creating new blocks
    factory: Box<dyn Fn() -> T + Send>,
}

/// Memory pool for efficient memory reuse
pub struct MemoryPool<T> {
    /// Inner implementation
    inner: Arc<Mutex<MemoryPoolInner<T>>>,
    
    /// Phantom data for type safety
    _phantom: PhantomData<T>,
}

impl<T: Send + 'static> MemoryPool<T> {
    /// Create a new memory pool with the specified maximum size and factory function
    pub fn new<F>(max_size: usize, factory: F) -> Self
    where
        F: Fn() -> T + Send + 'static
    {
        let inner = MemoryPoolInner {
            blocks: VecDeque::with_capacity(max_size),
            max_size,
            factory: Box::new(factory),
        };
        
        Self {
            inner: Arc::new(Mutex::new(inner)),
            _phantom: PhantomData,
        }
    }
    
    /// Get a memory block from the pool
    pub fn get(&self) -> MemoryBlock<T> {
        let mut inner = self.inner.lock().unwrap();
        
        // Try to get a block from the pool
        let data = if let Some(block) = inner.blocks.pop_front() {
            block
        } else {
            // Create a new block if the pool is empty
            (inner.factory)()
        };
        
        MemoryBlock {
            data,
            pool: Arc::clone(&self.inner),
        }
    }
    
    /// Return a memory block to the pool
    fn return_block(&self, block: T) {
        let mut inner = self.inner.lock().unwrap();
        
        // Only add the block if we're below the maximum size
        if inner.blocks.len() < inner.max_size {
            inner.blocks.push_back(block);
        }
        // Otherwise, let it be dropped
    }
    
    /// Get the current number of available blocks
    pub fn available_blocks(&self) -> usize {
        let inner = self.inner.lock().unwrap();
        inner.blocks.len()
    }
    
    /// Preallocate blocks to fill the pool
    pub fn preallocate(&self) {
        let mut inner = self.inner.lock().unwrap();
        
        // Fill the pool to maximum capacity
        while inner.blocks.len() < inner.max_size {
            inner.blocks.push_back((inner.factory)());
        }
    }
    
    /// Clear the pool
    pub fn clear(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.blocks.clear();
    }
    
    /// Resize the pool
    pub fn resize(&self, new_max_size: usize) {
        let mut inner = self.inner.lock().unwrap();
        
        // Update the maximum size
        inner.max_size = new_max_size;
        
        // Trim the pool if necessary
        while inner.blocks.len() > new_max_size {
            inner.blocks.pop_back();
        }
    }
}

impl<T> Clone for MemoryPool<T> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            _phantom: PhantomData,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_memory_pool() {
        // Create a memory pool for Vec<u8> with capacity 1024
        let pool = MemoryPool::new(10, || Vec::with_capacity(1024));
        
        // Preallocate blocks
        pool.preallocate();
        assert_eq!(pool.available_blocks(), 10);
        
        // Get some blocks
        let mut block1 = pool.get();
        let mut block2 = pool.get();
        
        // Use the blocks
        block1.extend_from_slice(&[1, 2, 3]);
        block2.extend_from_slice(&[4, 5, 6]);
        
        assert_eq!(*block1, vec![1, 2, 3]);
        assert_eq!(*block2, vec![4, 5, 6]);
        
        // Check available blocks
        assert_eq!(pool.available_blocks(), 8);
        
        // Drop a block to return it to the pool
        drop(block1);
        assert_eq!(pool.available_blocks(), 9);
        
        // Resize the pool
        pool.resize(5);
        assert_eq!(pool.available_blocks(), 5);
        
        // Clear the pool
        pool.clear();
        assert_eq!(pool.available_blocks(), 0);
    }
}
