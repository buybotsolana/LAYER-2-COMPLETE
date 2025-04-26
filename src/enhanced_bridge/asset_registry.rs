// src/enhanced_bridge/asset_registry.rs
//! Asset Registry module for Enhanced Bridge Security
//! 
//! This module implements asset registry:
//! - Asset registration and management
//! - Asset metadata and properties
//! - Asset verification and validation
//! - Cross-chain asset mapping
//!
//! The asset registry ensures that only valid assets can be
//! transferred through the bridge and maintains mappings between
//! assets on different chains.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;

/// Asset type
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssetType {
    /// Native token (e.g., SOL, ETH)
    Native,
    
    /// SPL token (Solana)
    SPL,
    
    /// ERC-20 token (Ethereum)
    ERC20,
    
    /// ERC-721 token (Ethereum)
    ERC721,
    
    /// ERC-1155 token (Ethereum)
    ERC1155,
}

/// Asset verification status
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerificationStatus {
    /// Unverified
    Unverified,
    
    /// Pending verification
    Pending,
    
    /// Verified
    Verified,
    
    /// Rejected
    Rejected,
}

/// Asset information
#[derive(Debug, Clone)]
pub struct AssetInfo {
    /// Asset ID
    pub id: u64,
    
    /// Asset name
    pub name: String,
    
    /// Asset symbol
    pub symbol: String,
    
    /// Asset type
    pub asset_type: AssetType,
    
    /// Decimals
    pub decimals: u8,
    
    /// Solana address
    pub solana_address: Option<Pubkey>,
    
    /// Ethereum address
    pub ethereum_address: Option<[u8; 20]>,
    
    /// Verification status
    pub verification_status: VerificationStatus,
    
    /// Maximum transfer amount (0 for unlimited)
    pub max_transfer_amount: u64,
    
    /// Whether the asset is enabled
    pub enabled: bool,
    
    /// Creation timestamp
    pub creation_timestamp: u64,
    
    /// Last update timestamp
    pub last_update_timestamp: u64,
}

/// Asset registry for the enhanced bridge system
pub struct AssetRegistry {
    /// Assets by ID
    assets: HashMap<u64, AssetInfo>,
    
    /// Assets by Solana address
    assets_by_solana: HashMap<Pubkey, u64>,
    
    /// Assets by Ethereum address
    assets_by_ethereum: HashMap<[u8; 20], u64>,
    
    /// Next asset ID
    next_asset_id: u64,
    
    /// Whether the asset registry is initialized
    initialized: bool,
}

impl AssetRegistry {
    /// Create a new asset registry
    pub fn new() -> Self {
        Self {
            assets: HashMap::new(),
            assets_by_solana: HashMap::new(),
            assets_by_ethereum: HashMap::new(),
            next_asset_id: 1,
            initialized: false,
        }
    }
    
    /// Initialize the asset registry
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        self.initialized = true;
        
        msg!("Asset registry initialized");
        
        Ok(())
    }
    
    /// Check if the asset registry is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Register an asset
    pub fn register_asset(
        &mut self,
        name: String,
        symbol: String,
        asset_type: AssetType,
        decimals: u8,
        solana_address: Option<Pubkey>,
        ethereum_address: Option<[u8; 20]>,
        max_transfer_amount: u64,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the asset already exists
        if let Some(solana_addr) = solana_address {
            if self.assets_by_solana.contains_key(&solana_addr) {
                return Err(ProgramError::AccountAlreadyInitialized);
            }
        }
        
        if let Some(ethereum_addr) = ethereum_address {
            if self.assets_by_ethereum.contains_key(&ethereum_addr) {
                return Err(ProgramError::AccountAlreadyInitialized);
            }
        }
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        // Create the asset
        let asset_id = self.next_asset_id;
        self.next_asset_id += 1;
        
        let asset = AssetInfo {
            id: asset_id,
            name,
            symbol,
            asset_type,
            decimals,
            solana_address,
            ethereum_address,
            verification_status: VerificationStatus::Unverified,
            max_transfer_amount,
            enabled: false, // Assets are disabled by default until verified
            creation_timestamp: current_timestamp,
            last_update_timestamp: current_timestamp,
        };
        
        // Add the asset
        self.assets.insert(asset_id, asset.clone());
        
        // Add the asset to the address maps
        if let Some(solana_addr) = solana_address {
            self.assets_by_solana.insert(solana_addr, asset_id);
        }
        
        if let Some(ethereum_addr) = ethereum_address {
            self.assets_by_ethereum.insert(ethereum_addr, asset_id);
        }
        
        msg!("Asset registered: {}", asset_id);
        
        Ok(asset_id)
    }
    
    /// Update asset verification status
    pub fn update_verification_status(
        &mut self,
        asset_id: u64,
        status: VerificationStatus,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the asset
        let asset = self.assets.get_mut(&asset_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Update the verification status
        asset.verification_status = status;
        
        // If the asset is verified, enable it
        if status == VerificationStatus::Verified {
            asset.enabled = true;
        }
        
        // Update the last update timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        asset.last_update_timestamp = current_timestamp;
        
        msg!("Asset verification status updated: {}", asset_id);
        
        Ok(())
    }
    
    /// Enable or disable an asset
    pub fn set_asset_enabled(
        &mut self,
        asset_id: u64,
        enabled: bool,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the asset
        let asset = self.assets.get_mut(&asset_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Update the enabled status
        asset.enabled = enabled;
        
        // Update the last update timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        asset.last_update_timestamp = current_timestamp;
        
        msg!("Asset enabled status updated: {}, enabled: {}", asset_id, enabled);
        
        Ok(())
    }
    
    /// Update asset max transfer amount
    pub fn update_max_transfer_amount(
        &mut self,
        asset_id: u64,
        max_transfer_amount: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the asset
        let asset = self.assets.get_mut(&asset_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Update the max transfer amount
        asset.max_transfer_amount = max_transfer_amount;
        
        // Update the last update timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        asset.last_update_timestamp = current_timestamp;
        
        msg!("Asset max transfer amount updated: {}, amount: {}", asset_id, max_transfer_amount);
        
        Ok(())
    }
    
    /// Check if an asset is valid for transfer
    pub fn is_valid_for_transfer(
        &self,
        asset_id: u64,
        amount: u64,
    ) -> Result<bool, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the asset
        let asset = self.assets.get(&asset_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the asset is enabled
        if !asset.enabled {
            return Ok(false);
        }
        
        // Check if the asset is verified
        if asset.verification_status != VerificationStatus::Verified {
            return Ok(false);
        }
        
        // Check if the amount is within the max transfer amount
        if asset.max_transfer_amount > 0 && amount > asset.max_transfer_amount {
            return Ok(false);
        }
        
        Ok(true)
    }
    
    /// Get an asset by ID
    pub fn get_asset(
        &self,
        asset_id: u64,
    ) -> Option<&AssetInfo> {
        if !self.initialized {
            return None;
        }
        
        self.assets.get(&asset_id)
    }
    
    /// Get an asset by Solana address
    pub fn get_asset_by_solana(
        &self,
        solana_address: &Pubkey,
    ) -> Option<&AssetInfo> {
        if !self.initialized {
            return None;
        }
        
        if let Some(asset_id) = self.assets_by_solana.get(solana_address) {
            return self.assets.get(asset_id);
        }
        
        None
    }
    
    /// Get an asset by Ethereum address
    pub fn get_asset_by_ethereum(
        &self,
        ethereum_address: &[u8; 20],
    ) -> Option<&AssetInfo> {
        if !self.initialized {
            return None;
        }
        
        if let Some(asset_id) = self.assets_by_ethereum.get(ethereum_address) {
            return self.assets.get(asset_id);
        }
        
        None
    }
    
    /// Get all assets
    pub fn get_all_assets(&self) -> &HashMap<u64, AssetInfo> {
        &self.assets
    }
    
    /// Get verified assets
    pub fn get_verified_assets(&self) -> Vec<&AssetInfo> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.assets.values()
            .filter(|asset| asset.verification_status == VerificationStatus::Verified)
            .collect()
    }
    
    /// Get enabled assets
    pub fn get_enabled_assets(&self) -> Vec<&AssetInfo> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.assets.values()
            .filter(|asset| asset.enabled)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_asset_registry_creation() {
        let registry = AssetRegistry::new();
        assert!(!registry.is_initialized());
    }
}
