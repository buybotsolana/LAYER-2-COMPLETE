// src/scalability/mod.rs
//! Scalability Optimization module for Layer-2 on Solana
//! 
//! This module implements advanced scalability optimizations:
//! - Transaction batching and compression
//! - Parallel transaction processing
//! - State channel implementation
//! - Data availability solutions
//! - Sharding techniques
//!
//! These optimizations ensure that the Layer-2 solution can handle
//! high transaction volumes with minimal latency and cost.

mod transaction_batching;
mod parallel_processing;
mod state_channels;
mod data_availability;
mod sharding;
mod calldata_compression;
mod storage_optimization;
mod execution_optimization;

pub use transaction_batching::TransactionBatcher;
pub use parallel_processing::ParallelExecutor;
pub use state_channels::StateChannelManager;
pub use data_availability::DataAvailabilityLayer;
pub use sharding::ShardManager;
pub use calldata_compression::CalldataCompressor;
pub use storage_optimization::StorageOptimizer;
pub use execution_optimization::ExecutionOptimizer;

use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

/// Scalability configuration
#[derive(Debug, Clone)]
pub struct ScalabilityConfig {
    /// Maximum batch size
    pub max_batch_size: u32,
    
    /// Maximum parallel threads
    pub max_parallel_threads: u32,
    
    /// State channel timeout (in seconds)
    pub state_channel_timeout: u64,
    
    /// Data availability sampling rate (percentage)
    pub data_availability_sampling_rate: u32,
    
    /// Number of shards
    pub shard_count: u32,
    
    /// Compression level (0-9)
    pub compression_level: u32,
    
    /// Storage pruning enabled
    pub storage_pruning_enabled: bool,
    
    /// JIT compilation enabled
    pub jit_compilation_enabled: bool,
}

impl Default for ScalabilityConfig {
    fn default() -> Self {
        Self {
            max_batch_size: 1000,
            max_parallel_threads: 8,
            state_channel_timeout: 3600, // 1 hour in seconds
            data_availability_sampling_rate: 10, // 10%
            shard_count: 4,
            compression_level: 6,
            storage_pruning_enabled: true,
            jit_compilation_enabled: true,
        }
    }
}

/// Scalability manager for the Layer-2 system
pub struct ScalabilityManager {
    /// Scalability configuration
    config: ScalabilityConfig,
    
    /// Transaction batcher
    transaction_batcher: TransactionBatcher,
    
    /// Parallel executor
    parallel_executor: ParallelExecutor,
    
    /// State channel manager
    state_channel_manager: StateChannelManager,
    
    /// Data availability layer
    data_availability_layer: DataAvailabilityLayer,
    
    /// Shard manager
    shard_manager: ShardManager,
    
    /// Calldata compressor
    calldata_compressor: CalldataCompressor,
    
    /// Storage optimizer
    storage_optimizer: StorageOptimizer,
    
    /// Execution optimizer
    execution_optimizer: ExecutionOptimizer,
    
    /// Whether the scalability manager is initialized
    initialized: bool,
}

impl ScalabilityManager {
    /// Create a new scalability manager with default configuration
    pub fn new() -> Self {
        let config = ScalabilityConfig::default();
        Self {
            config: config.clone(),
            transaction_batcher: TransactionBatcher::with_config(config.max_batch_size),
            parallel_executor: ParallelExecutor::with_config(config.max_parallel_threads),
            state_channel_manager: StateChannelManager::with_config(config.state_channel_timeout),
            data_availability_layer: DataAvailabilityLayer::with_config(config.data_availability_sampling_rate),
            shard_manager: ShardManager::with_config(config.shard_count),
            calldata_compressor: CalldataCompressor::with_config(config.compression_level),
            storage_optimizer: StorageOptimizer::with_config(config.storage_pruning_enabled),
            execution_optimizer: ExecutionOptimizer::with_config(config.jit_compilation_enabled),
            initialized: false,
        }
    }
    
    /// Create a new scalability manager with the specified configuration
    pub fn with_config(config: ScalabilityConfig) -> Self {
        Self {
            config: config.clone(),
            transaction_batcher: TransactionBatcher::with_config(config.max_batch_size),
            parallel_executor: ParallelExecutor::with_config(config.max_parallel_threads),
            state_channel_manager: StateChannelManager::with_config(config.state_channel_timeout),
            data_availability_layer: DataAvailabilityLayer::with_config(config.data_availability_sampling_rate),
            shard_manager: ShardManager::with_config(config.shard_count),
            calldata_compressor: CalldataCompressor::with_config(config.compression_level),
            storage_optimizer: StorageOptimizer::with_config(config.storage_pruning_enabled),
            execution_optimizer: ExecutionOptimizer::with_config(config.jit_compilation_enabled),
            initialized: false,
        }
    }
    
    /// Initialize the scalability manager
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Initialize all components
        self.transaction_batcher.initialize()?;
        self.parallel_executor.initialize()?;
        self.state_channel_manager.initialize()?;
        self.data_availability_layer.initialize()?;
        self.shard_manager.initialize()?;
        self.calldata_compressor.initialize()?;
        self.storage_optimizer.initialize()?;
        self.execution_optimizer.initialize()?;
        
        self.initialized = true;
        
        msg!("Scalability manager initialized");
        
        Ok(())
    }
    
    /// Check if the scalability manager is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Process a batch of transactions
    pub fn process_batch(&mut self, transactions: Vec<Vec<u8>>) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Compress the transactions
        let compressed_transactions = self.calldata_compressor.compress_batch(&transactions)?;
        
        // Batch the transactions
        let batches = self.transaction_batcher.batch_transactions(&compressed_transactions)?;
        
        // Process the batches in parallel
        let results = self.parallel_executor.execute_batches(&batches)?;
        
        // Optimize storage
        self.storage_optimizer.optimize()?;
        
        msg!("Batch processed: {} transactions", transactions.len());
        
        Ok(())
    }
    
    /// Open a state channel
    pub fn open_state_channel(&mut self, participants: Vec<Pubkey>) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        self.state_channel_manager.open_channel(participants)
    }
    
    /// Close a state channel
    pub fn close_state_channel(&mut self, channel_id: u64, final_state: Vec<u8>) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        self.state_channel_manager.close_channel(channel_id, final_state)
    }
    
    /// Submit data to the data availability layer
    pub fn submit_data(&mut self, data: Vec<u8>) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        self.data_availability_layer.submit_data(data)
    }
    
    /// Verify data availability
    pub fn verify_data_availability(&self, data_id: u64) -> Result<bool, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        self.data_availability_layer.verify_data_availability(data_id)
    }
    
    /// Assign data to a shard
    pub fn assign_to_shard(&mut self, data: Vec<u8>) -> Result<u32, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        self.shard_manager.assign_to_shard(data)
    }
    
    /// Get data from a shard
    pub fn get_from_shard(&self, shard_id: u32, data_id: u64) -> Result<Vec<u8>, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        self.shard_manager.get_from_shard(shard_id, data_id)
    }
    
    /// Update the scalability configuration
    pub fn update_config(&mut self, config: ScalabilityConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the configuration
        self.config = config.clone();
        
        // Update the components
        self.transaction_batcher.update_config(config.max_batch_size)?;
        self.parallel_executor.update_config(config.max_parallel_threads)?;
        self.state_channel_manager.update_config(config.state_channel_timeout)?;
        self.data_availability_layer.update_config(config.data_availability_sampling_rate)?;
        self.shard_manager.update_config(config.shard_count)?;
        self.calldata_compressor.update_config(config.compression_level)?;
        self.storage_optimizer.update_config(config.storage_pruning_enabled)?;
        self.execution_optimizer.update_config(config.jit_compilation_enabled)?;
        
        msg!("Scalability configuration updated");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_scalability_manager_creation() {
        let manager = ScalabilityManager::new();
        assert!(!manager.is_initialized());
    }
    
    #[test]
    fn test_scalability_manager_with_config() {
        let config = ScalabilityConfig::default();
        let manager = ScalabilityManager::with_config(config);
        assert!(!manager.is_initialized());
    }
}
