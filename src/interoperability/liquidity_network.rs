// src/interoperability/liquidity_network.rs
//! Liquidity Network module for Cross-Chain Interoperability
//! 
//! This module implements unified liquidity across chains:
//! - Liquidity pool management
//! - Cross-chain liquidity sharing
//! - Automated market making
//! - Liquidity incentives and rewards
//!
//! The liquidity network enables efficient asset transfers between
//! different blockchain networks by maintaining shared liquidity pools.

use solana_program::{
    program_error::ProgramError,
    msg,
};
use std::collections::HashMap;
use crate::interoperability::BlockchainNetwork;

/// Liquidity pool information
#[derive(Debug, Clone)]
pub struct LiquidityPoolInfo {
    /// Network
    pub network: BlockchainNetwork,
    
    /// Asset ID
    pub asset_id: Vec<u8>,
    
    /// Total liquidity
    pub total_liquidity: u64,
    
    /// Available liquidity
    pub available_liquidity: u64,
    
    /// Reserved liquidity
    pub reserved_liquidity: u64,
    
    /// Utilization rate (percentage, 0-100)
    pub utilization_rate: u32,
    
    /// Fee rate (basis points, 0-10000)
    pub fee_rate: u32,
    
    /// Last update timestamp
    pub last_update_timestamp: u64,
}

/// Liquidity provider information
#[derive(Debug, Clone)]
pub struct LiquidityProviderInfo {
    /// Provider address
    pub provider_address: Vec<u8>,
    
    /// Network
    pub network: BlockchainNetwork,
    
    /// Asset ID
    pub asset_id: Vec<u8>,
    
    /// Provided liquidity
    pub provided_liquidity: u64,
    
    /// Earned fees
    pub earned_fees: u64,
    
    /// Last update timestamp
    pub last_update_timestamp: u64,
}

/// Liquidity network for cross-chain asset transfers
pub struct LiquidityNetwork {
    /// Liquidity pools by (network, asset_id)
    liquidity_pools: HashMap<(BlockchainNetwork, Vec<u8>), LiquidityPoolInfo>,
    
    /// Liquidity providers by (provider_address, network, asset_id)
    liquidity_providers: HashMap<(Vec<u8>, BlockchainNetwork, Vec<u8>), LiquidityProviderInfo>,
    
    /// Whether the liquidity network is initialized
    initialized: bool,
}

impl LiquidityNetwork {
    /// Create a new liquidity network
    pub fn new() -> Self {
        Self {
            liquidity_pools: HashMap::new(),
            liquidity_providers: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Initialize the liquidity network
    pub fn initialize(&mut self) -> Result<(), ProgramError> {
        self.initialized = true;
        
        msg!("Liquidity network initialized");
        
        Ok(())
    }
    
    /// Check if the liquidity network is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Add liquidity
    pub fn add_liquidity(
        &mut self,
        provider_address: Vec<u8>,
        network: BlockchainNetwork,
        asset_id: Vec<u8>,
        amount: u64,
    ) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        // Update the liquidity pool
        let pool_key = (network.clone(), asset_id.clone());
        
        if let Some(pool) = self.liquidity_pools.get_mut(&pool_key) {
            // Update the existing pool
            pool.total_liquidity = pool.total_liquidity.saturating_add(amount);
            pool.available_liquidity = pool.available_liquidity.saturating_add(amount);
            pool.utilization_rate = if pool.total_liquidity > 0 {
                ((pool.reserved_liquidity * 100) / pool.total_liquidity) as u32
            } else {
                0
            };
            pool.last_update_timestamp = current_timestamp;
        } else {
            // Create a new pool
            let pool = LiquidityPoolInfo {
                network: network.clone(),
                asset_id: asset_id.clone(),
                total_liquidity: amount,
                available_liquidity: amount,
                reserved_liquidity: 0,
                utilization_rate: 0,
                fee_rate: 30, // 0.3% fee rate
                last_update_timestamp: current_timestamp,
            };
            
            self.liquidity_pools.insert(pool_key, pool);
        }
        
        // Update the liquidity provider
        let provider_key = (provider_address.clone(), network.clone(), asset_id.clone());
        
        if let Some(provider) = self.liquidity_providers.get_mut(&provider_key) {
            // Update the existing provider
            provider.provided_liquidity = provider.provided_liquidity.saturating_add(amount);
            provider.last_update_timestamp = current_timestamp;
        } else {
            // Create a new provider
            let provider = LiquidityProviderInfo {
                provider_address,
                network,
                asset_id,
                provided_liquidity: amount,
                earned_fees: 0,
                last_update_timestamp: current_timestamp,
            };
            
            self.liquidity_providers.insert(provider_key, provider);
        }
        
        msg!("Liquidity added: amount: {}", amount);
        
        Ok(())
    }
    
    /// Remove liquidity
    pub fn remove_liquidity(
        &mut self,
        provider_address: Vec<u8>,
        network: BlockchainNetwork,
        asset_id: Vec<u8>,
        amount: u64,
    ) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        // Check if the provider has enough liquidity
        let provider_key = (provider_address.clone(), network.clone(), asset_id.clone());
        
        let provider = self.liquidity_providers.get_mut(&provider_key)
            .ok_or(ProgramError::InvalidArgument)?;
        
        if provider.provided_liquidity < amount {
            return Err(ProgramError::InsufficientFunds);
        }
        
        // Update the liquidity pool
        let pool_key = (network.clone(), asset_id.clone());
        
        let pool = self.liquidity_pools.get_mut(&pool_key)
            .ok_or(ProgramError::InvalidArgument)?;
        
        if pool.available_liquidity < amount {
            return Err(ProgramError::InsufficientFunds);
        }
        
        // Update the pool
        pool.total_liquidity = pool.total_liquidity.saturating_sub(amount);
        pool.available_liquidity = pool.available_liquidity.saturating_sub(amount);
        pool.utilization_rate = if pool.total_liquidity > 0 {
            ((pool.reserved_liquidity * 100) / pool.total_liquidity) as u32
        } else {
            0
        };
        pool.last_update_timestamp = current_timestamp;
        
        // Update the provider
        provider.provided_liquidity = provider.provided_liquidity.saturating_sub(amount);
        provider.last_update_timestamp = current_timestamp;
        
        msg!("Liquidity removed: amount: {}", amount);
        
        Ok(())
    }
    
    /// Reserve liquidity
    pub fn reserve_liquidity(
        &mut self,
        network: &BlockchainNetwork,
        asset_id: &[u8],
        amount: u64,
    ) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        // Get the liquidity pool
        let pool_key = (network.clone(), asset_id.to_vec());
        
        let pool = self.liquidity_pools.get_mut(&pool_key)
            .ok_or(ProgramError::InvalidArgument)?;
        
        if pool.available_liquidity < amount {
            return Err(ProgramError::InsufficientFunds);
        }
        
        // Update the pool
        pool.available_liquidity = pool.available_liquidity.saturating_sub(amount);
        pool.reserved_liquidity = pool.reserved_liquidity.saturating_add(amount);
        pool.utilization_rate = if pool.total_liquidity > 0 {
            ((pool.reserved_liquidity * 100) / pool.total_liquidity) as u32
        } else {
            0
        };
        pool.last_update_timestamp = current_timestamp;
        
        msg!("Liquidity reserved: amount: {}", amount);
        
        Ok(())
    }
    
    /// Release liquidity
    pub fn release_liquidity(
        &mut self,
        network: &BlockchainNetwork,
        asset_id: &[u8],
        amount: u64,
    ) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        // Get the liquidity pool
        let pool_key = (network.clone(), asset_id.to_vec());
        
        let pool = self.liquidity_pools.get_mut(&pool_key)
            .ok_or(ProgramError::InvalidArgument)?;
        
        if pool.reserved_liquidity < amount {
            return Err(ProgramError::InsufficientFunds);
        }
        
        // Update the pool
        pool.available_liquidity = pool.available_liquidity.saturating_add(amount);
        pool.reserved_liquidity = pool.reserved_liquidity.saturating_sub(amount);
        pool.utilization_rate = if pool.total_liquidity > 0 {
            ((pool.reserved_liquidity * 100) / pool.total_liquidity) as u32
        } else {
            0
        };
        pool.last_update_timestamp = current_timestamp;
        
        msg!("Liquidity released: amount: {}", amount);
        
        Ok(())
    }
    
    /// Update liquidity
    pub fn update_liquidity(
        &mut self,
        network: &BlockchainNetwork,
        asset_id: &[u8],
        amount: u64,
        is_incoming: bool,
    ) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        if is_incoming {
            // Incoming transfer, release liquidity
            self.release_liquidity(network, asset_id, amount)
        } else {
            // Outgoing transfer, reserve liquidity
            self.reserve_liquidity(network, asset_id, amount)
        }
    }
    
    /// Collect fees
    pub fn collect_fees(
        &mut self,
        provider_address: Vec<u8>,
        network: BlockchainNetwork,
        asset_id: Vec<u8>,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        // Get the liquidity provider
        let provider_key = (provider_address.clone(), network.clone(), asset_id.clone());
        
        let provider = self.liquidity_providers.get_mut(&provider_key)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Get the fees
        let fees = provider.earned_fees;
        
        // Reset the earned fees
        provider.earned_fees = 0;
        provider.last_update_timestamp = current_timestamp;
        
        msg!("Fees collected: {}", fees);
        
        Ok(fees)
    }
    
    /// Get liquidity
    pub fn get_liquidity(
        &self,
        network: &BlockchainNetwork,
        asset_id: &[u8],
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the liquidity pool
        let pool_key = (network.clone(), asset_id.to_vec());
        
        if let Some(pool) = self.liquidity_pools.get(&pool_key) {
            Ok(pool.available_liquidity)
        } else {
            Ok(0)
        }
    }
    
    /// Get a liquidity pool
    pub fn get_liquidity_pool(
        &self,
        network: &BlockchainNetwork,
        asset_id: &[u8],
    ) -> Option<&LiquidityPoolInfo> {
        if !self.initialized {
            return None;
        }
        
        let pool_key = (network.clone(), asset_id.to_vec());
        
        self.liquidity_pools.get(&pool_key)
    }
    
    /// Get a liquidity provider
    pub fn get_liquidity_provider(
        &self,
        provider_address: &[u8],
        network: &BlockchainNetwork,
        asset_id: &[u8],
    ) -> Option<&LiquidityProviderInfo> {
        if !self.initialized {
            return None;
        }
        
        let provider_key = (provider_address.to_vec(), network.clone(), asset_id.to_vec());
        
        self.liquidity_providers.get(&provider_key)
    }
    
    /// Get all liquidity pools
    pub fn get_all_liquidity_pools(&self) -> &HashMap<(BlockchainNetwork, Vec<u8>), LiquidityPoolInfo> {
        &self.liquidity_pools
    }
    
    /// Get all liquidity providers
    pub fn get_all_liquidity_providers(&self) -> &HashMap<(Vec<u8>, BlockchainNetwork, Vec<u8>), LiquidityProviderInfo> {
        &self.liquidity_providers
    }
    
    /// Update fee rate
    pub fn update_fee_rate(
        &mut self,
        network: BlockchainNetwork,
        asset_id: Vec<u8>,
        fee_rate: u32,
    ) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check the fee rate
        if fee_rate > 10000 {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        // Get the liquidity pool
        let pool_key = (network.clone(), asset_id.clone());
        
        let pool = self.liquidity_pools.get_mut(&pool_key)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Update the fee rate
        pool.fee_rate = fee_rate;
        pool.last_update_timestamp = current_timestamp;
        
        msg!("Fee rate updated: {}", fee_rate);
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_liquidity_network_creation() {
        let network = LiquidityNetwork::new();
        assert!(!network.is_initialized());
    }
}
