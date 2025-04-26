// src/enhanced_bridge/liquidity_pool.rs
//! Liquidity Pool module for Enhanced Bridge Security
//! 
//! This module implements liquidity pools for instant withdrawals:
//! - Liquidity provider management
//! - Pool balance tracking
//! - Fee calculation and distribution
//! - Instant withdrawal processing
//!
//! The liquidity pool enables instant withdrawals by providing
//! liquidity for users who don't want to wait for the challenge period.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;

/// Pool configuration
#[derive(Debug, Clone)]
pub struct PoolConfig {
    /// Whether the pool is enabled
    pub enabled: bool,
    
    /// Fee for instant withdrawals (in basis points)
    pub instant_withdrawal_fee_bps: u32,
}

impl Default for PoolConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            instant_withdrawal_fee_bps: 25, // 0.25%
        }
    }
}

/// Liquidity provider information
#[derive(Debug, Clone)]
pub struct LiquidityProvider {
    /// Provider public key
    pub provider: Pubkey,
    
    /// Liquidity by asset ID
    pub liquidity: HashMap<u64, u64>,
    
    /// Fees earned by asset ID
    pub fees_earned: HashMap<u64, u64>,
    
    /// Whether the provider is active
    pub is_active: bool,
    
    /// Activation timestamp
    pub activation_timestamp: u64,
}

/// Liquidity pool for the enhanced bridge system
pub struct LiquidityPool {
    /// Pool configuration
    config: PoolConfig,
    
    /// Liquidity providers by public key
    providers: HashMap<Pubkey, LiquidityProvider>,
    
    /// Total liquidity by asset ID
    total_liquidity: HashMap<u64, u64>,
    
    /// Total fees by asset ID
    total_fees: HashMap<u64, u64>,
    
    /// Whether the liquidity pool is initialized
    initialized: bool,
}

impl LiquidityPool {
    /// Create a new liquidity pool with default configuration
    pub fn new() -> Self {
        Self {
            config: PoolConfig::default(),
            providers: HashMap::new(),
            total_liquidity: HashMap::new(),
            total_fees: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Create a new liquidity pool with the specified configuration
    pub fn with_config(config: PoolConfig) -> Self {
        Self {
            config,
            providers: HashMap::new(),
            total_liquidity: HashMap::new(),
            total_fees: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Initialize the liquidity pool
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        self.initialized = true;
        
        msg!("Liquidity pool initialized");
        
        Ok(())
    }
    
    /// Check if the liquidity pool is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Add liquidity
    pub fn add_liquidity(
        &mut self,
        provider: &Pubkey,
        asset_id: u64,
        amount: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the pool is enabled
        if !self.config.enabled {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Get or create the provider
        let provider_info = self.providers.entry(*provider)
            .or_insert_with(|| {
                let current_timestamp = 0; // In a real implementation, we would use the current timestamp
                
                LiquidityProvider {
                    provider: *provider,
                    liquidity: HashMap::new(),
                    fees_earned: HashMap::new(),
                    is_active: true,
                    activation_timestamp: current_timestamp,
                }
            });
        
        // Update the provider's liquidity
        let provider_liquidity = provider_info.liquidity.entry(asset_id)
            .or_insert(0);
        *provider_liquidity += amount;
        
        // Update the total liquidity
        let total = self.total_liquidity.entry(asset_id)
            .or_insert(0);
        *total += amount;
        
        msg!("Liquidity added: provider: {:?}, asset: {}, amount: {}", provider, asset_id, amount);
        
        Ok(())
    }
    
    /// Remove liquidity
    pub fn remove_liquidity(
        &mut self,
        provider: &Pubkey,
        asset_id: u64,
        amount: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the pool is enabled
        if !self.config.enabled {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Get the provider
        let provider_info = self.providers.get_mut(provider)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the provider has enough liquidity
        let provider_liquidity = provider_info.liquidity.get_mut(&asset_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        if *provider_liquidity < amount {
            return Err(ProgramError::InsufficientFunds);
        }
        
        // Update the provider's liquidity
        *provider_liquidity -= amount;
        
        // Update the total liquidity
        let total = self.total_liquidity.get_mut(&asset_id)
            .ok_or(ProgramError::InvalidArgument)?;
        *total -= amount;
        
        msg!("Liquidity removed: provider: {:?}, asset: {}, amount: {}", provider, asset_id, amount);
        
        Ok(())
    }
    
    /// Process an instant withdrawal
    pub fn process_instant_withdrawal(
        &mut self,
        asset_id: u64,
        amount: u64,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the pool is enabled
        if !self.config.enabled {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if there is enough liquidity
        if !self.has_sufficient_liquidity(asset_id, amount)? {
            return Err(ProgramError::InsufficientFunds);
        }
        
        // Calculate the fee
        let fee = (amount * self.config.instant_withdrawal_fee_bps as u64) / 10000;
        
        // Update the total fees
        let total_fees = self.total_fees.entry(asset_id)
            .or_insert(0);
        *total_fees += fee;
        
        // Distribute the fee to providers
        self.distribute_fee(asset_id, fee)?;
        
        // Update the total liquidity
        let total = self.total_liquidity.get_mut(&asset_id)
            .ok_or(ProgramError::InvalidArgument)?;
        *total -= amount;
        
        msg!("Instant withdrawal processed: asset: {}, amount: {}, fee: {}", asset_id, amount, fee);
        
        Ok(fee)
    }
    
    /// Distribute a fee to providers
    fn distribute_fee(
        &mut self,
        asset_id: u64,
        fee: u64,
    ) -> ProgramResult {
        // Get the total liquidity for the asset
        let total_liquidity = self.total_liquidity.get(&asset_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // If there is no liquidity, there are no providers to distribute to
        if *total_liquidity == 0 {
            return Ok(());
        }
        
        // Distribute the fee proportionally to each provider
        for (_, provider_info) in self.providers.iter_mut() {
            // Skip inactive providers
            if !provider_info.is_active {
                continue;
            }
            
            // Get the provider's liquidity for the asset
            if let Some(provider_liquidity) = provider_info.liquidity.get(&asset_id) {
                // Calculate the provider's share of the fee
                let provider_fee = (fee * *provider_liquidity) / *total_liquidity;
                
                // Update the provider's fees earned
                let provider_fees = provider_info.fees_earned.entry(asset_id)
                    .or_insert(0);
                *provider_fees += provider_fee;
            }
        }
        
        Ok(())
    }
    
    /// Check if there is sufficient liquidity
    pub fn has_sufficient_liquidity(
        &self,
        asset_id: u64,
        amount: u64,
    ) -> Result<bool, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the pool is enabled
        if !self.config.enabled {
            return Ok(false);
        }
        
        // Get the total liquidity for the asset
        let total_liquidity = self.total_liquidity.get(&asset_id)
            .unwrap_or(&0);
        
        // Check if there is enough liquidity
        Ok(*total_liquidity >= amount)
    }
    
    /// Get the total liquidity for an asset
    pub fn get_total_liquidity(
        &self,
        asset_id: u64,
    ) -> u64 {
        if !self.initialized {
            return 0;
        }
        
        *self.total_liquidity.get(&asset_id).unwrap_or(&0)
    }
    
    /// Get the total fees for an asset
    pub fn get_total_fees(
        &self,
        asset_id: u64,
    ) -> u64 {
        if !self.initialized {
            return 0;
        }
        
        *self.total_fees.get(&asset_id).unwrap_or(&0)
    }
    
    /// Get a provider's liquidity for an asset
    pub fn get_provider_liquidity(
        &self,
        provider: &Pubkey,
        asset_id: u64,
    ) -> u64 {
        if !self.initialized {
            return 0;
        }
        
        if let Some(provider_info) = self.providers.get(provider) {
            *provider_info.liquidity.get(&asset_id).unwrap_or(&0)
        } else {
            0
        }
    }
    
    /// Get a provider's fees earned for an asset
    pub fn get_provider_fees(
        &self,
        provider: &Pubkey,
        asset_id: u64,
    ) -> u64 {
        if !self.initialized {
            return 0;
        }
        
        if let Some(provider_info) = self.providers.get(provider) {
            *provider_info.fees_earned.get(&asset_id).unwrap_or(&0)
        } else {
            0
        }
    }
    
    /// Update the liquidity pool configuration
    pub fn update_config(&mut self, config: PoolConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the configuration
        self.config = config;
        
        msg!("Liquidity pool configuration updated");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_liquidity_pool_creation() {
        let pool = LiquidityPool::new();
        assert!(!pool.is_initialized());
    }
    
    #[test]
    fn test_liquidity_pool_with_config() {
        let config = PoolConfig::default();
        let pool = LiquidityPool::with_config(config);
        assert!(!pool.is_initialized());
    }
}
