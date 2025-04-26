// src/interoperability/chain_registry.rs
//! Chain Registry module for Cross-Chain Interoperability
//! 
//! This module implements blockchain network registry:
//! - Network registration and management
//! - Chain-specific configuration
//! - Protocol compatibility verification
//! - Network status monitoring
//!
//! The chain registry maintains information about supported blockchain
//! networks and their configurations for cross-chain operations.

use solana_program::{
    program_error::ProgramError,
    msg,
};
use std::collections::HashMap;
use crate::interoperability::BlockchainNetwork;

/// Chain status
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChainStatus {
    /// Active
    Active,
    
    /// Inactive
    Inactive,
    
    /// Maintenance
    Maintenance,
    
    /// Deprecated
    Deprecated,
}

/// Chain information
#[derive(Debug, Clone)]
pub struct ChainInfo {
    /// Network
    pub network: BlockchainNetwork,
    
    /// Chain ID
    pub chain_id: u64,
    
    /// RPC endpoint
    pub rpc_endpoint: String,
    
    /// Block confirmation time (seconds)
    pub block_confirmation_time: u32,
    
    /// Required confirmations for finality
    pub required_confirmations: u32,
    
    /// Status
    pub status: ChainStatus,
    
    /// Protocol version
    pub protocol_version: String,
    
    /// Last update timestamp
    pub last_update_timestamp: u64,
    
    /// Last block height
    pub last_block_height: u64,
    
    /// Last block timestamp
    pub last_block_timestamp: u64,
}

/// Chain registry for cross-chain operations
pub struct ChainRegistry {
    /// Chains by network
    chains: HashMap<BlockchainNetwork, ChainInfo>,
    
    /// Whether the chain registry is initialized
    initialized: bool,
}

impl ChainRegistry {
    /// Create a new chain registry
    pub fn new() -> Self {
        Self {
            chains: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Create a new chain registry with the specified networks
    pub fn with_networks(networks: Vec<BlockchainNetwork>) -> Self {
        let mut registry = Self {
            chains: HashMap::new(),
            initialized: false,
        };
        
        // Add default configurations for the specified networks
        for network in networks {
            registry.add_default_chain(network);
        }
        
        registry
    }
    
    /// Initialize the chain registry
    pub fn initialize(&mut self) -> Result<(), ProgramError> {
        self.initialized = true;
        
        msg!("Chain registry initialized");
        
        Ok(())
    }
    
    /// Check if the chain registry is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Add a default chain configuration
    fn add_default_chain(&mut self, network: BlockchainNetwork) {
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        // Create a default chain configuration based on the network
        let chain_info = match network {
            BlockchainNetwork::Ethereum => ChainInfo {
                network: network.clone(),
                chain_id: 1,
                rpc_endpoint: "https://mainnet.infura.io/v3/your-project-id".to_string(),
                block_confirmation_time: 15,
                required_confirmations: 12,
                status: ChainStatus::Active,
                protocol_version: "1.0.0".to_string(),
                last_update_timestamp: current_timestamp,
                last_block_height: 0,
                last_block_timestamp: current_timestamp,
            },
            BlockchainNetwork::BinanceSmartChain => ChainInfo {
                network: network.clone(),
                chain_id: 56,
                rpc_endpoint: "https://bsc-dataseed.binance.org/".to_string(),
                block_confirmation_time: 3,
                required_confirmations: 15,
                status: ChainStatus::Active,
                protocol_version: "1.0.0".to_string(),
                last_update_timestamp: current_timestamp,
                last_block_height: 0,
                last_block_timestamp: current_timestamp,
            },
            BlockchainNetwork::Polygon => ChainInfo {
                network: network.clone(),
                chain_id: 137,
                rpc_endpoint: "https://polygon-rpc.com/".to_string(),
                block_confirmation_time: 2,
                required_confirmations: 128,
                status: ChainStatus::Active,
                protocol_version: "1.0.0".to_string(),
                last_update_timestamp: current_timestamp,
                last_block_height: 0,
                last_block_timestamp: current_timestamp,
            },
            BlockchainNetwork::Avalanche => ChainInfo {
                network: network.clone(),
                chain_id: 43114,
                rpc_endpoint: "https://api.avax.network/ext/bc/C/rpc".to_string(),
                block_confirmation_time: 2,
                required_confirmations: 12,
                status: ChainStatus::Active,
                protocol_version: "1.0.0".to_string(),
                last_update_timestamp: current_timestamp,
                last_block_height: 0,
                last_block_timestamp: current_timestamp,
            },
            BlockchainNetwork::Arbitrum => ChainInfo {
                network: network.clone(),
                chain_id: 42161,
                rpc_endpoint: "https://arb1.arbitrum.io/rpc".to_string(),
                block_confirmation_time: 1,
                required_confirmations: 20,
                status: ChainStatus::Active,
                protocol_version: "1.0.0".to_string(),
                last_update_timestamp: current_timestamp,
                last_block_height: 0,
                last_block_timestamp: current_timestamp,
            },
            BlockchainNetwork::Optimism => ChainInfo {
                network: network.clone(),
                chain_id: 10,
                rpc_endpoint: "https://mainnet.optimism.io".to_string(),
                block_confirmation_time: 1,
                required_confirmations: 15,
                status: ChainStatus::Active,
                protocol_version: "1.0.0".to_string(),
                last_update_timestamp: current_timestamp,
                last_block_height: 0,
                last_block_timestamp: current_timestamp,
            },
            BlockchainNetwork::Cosmos => ChainInfo {
                network: network.clone(),
                chain_id: 0,
                rpc_endpoint: "https://rpc.cosmos.network:26657".to_string(),
                block_confirmation_time: 6,
                required_confirmations: 7,
                status: ChainStatus::Active,
                protocol_version: "1.0.0".to_string(),
                last_update_timestamp: current_timestamp,
                last_block_height: 0,
                last_block_timestamp: current_timestamp,
            },
            BlockchainNetwork::Polkadot => ChainInfo {
                network: network.clone(),
                chain_id: 0,
                rpc_endpoint: "wss://rpc.polkadot.io".to_string(),
                block_confirmation_time: 6,
                required_confirmations: 2,
                status: ChainStatus::Active,
                protocol_version: "1.0.0".to_string(),
                last_update_timestamp: current_timestamp,
                last_block_height: 0,
                last_block_timestamp: current_timestamp,
            },
            BlockchainNetwork::Near => ChainInfo {
                network: network.clone(),
                chain_id: 0,
                rpc_endpoint: "https://rpc.mainnet.near.org".to_string(),
                block_confirmation_time: 1,
                required_confirmations: 2,
                status: ChainStatus::Active,
                protocol_version: "1.0.0".to_string(),
                last_update_timestamp: current_timestamp,
                last_block_height: 0,
                last_block_timestamp: current_timestamp,
            },
            BlockchainNetwork::Custom(name) => ChainInfo {
                network: network.clone(),
                chain_id: 0,
                rpc_endpoint: format!("https://rpc.{}.network", name),
                block_confirmation_time: 10,
                required_confirmations: 10,
                status: ChainStatus::Active,
                protocol_version: "1.0.0".to_string(),
                last_update_timestamp: current_timestamp,
                last_block_height: 0,
                last_block_timestamp: current_timestamp,
            },
        };
        
        // Add the chain
        self.chains.insert(network, chain_info);
    }
    
    /// Register a chain
    pub fn register_chain(&mut self, chain_info: ChainInfo) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Add the chain
        self.chains.insert(chain_info.network.clone(), chain_info);
        
        msg!("Chain registered");
        
        Ok(())
    }
    
    /// Update a chain
    pub fn update_chain(&mut self, chain_info: ChainInfo) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the chain exists
        if !self.chains.contains_key(&chain_info.network) {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Update the chain
        self.chains.insert(chain_info.network.clone(), chain_info);
        
        msg!("Chain updated");
        
        Ok(())
    }
    
    /// Remove a chain
    pub fn remove_chain(&mut self, network: &BlockchainNetwork) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the chain exists
        if !self.chains.contains_key(network) {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Remove the chain
        self.chains.remove(network);
        
        msg!("Chain removed");
        
        Ok(())
    }
    
    /// Update chain status
    pub fn update_chain_status(
        &mut self,
        network: &BlockchainNetwork,
        status: ChainStatus,
    ) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the chain
        let chain = self.chains.get_mut(network)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Update the status
        chain.status = status;
        
        // Update the last update timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        chain.last_update_timestamp = current_timestamp;
        
        msg!("Chain status updated: {:?}", status);
        
        Ok(())
    }
    
    /// Update chain block information
    pub fn update_chain_block_info(
        &mut self,
        network: &BlockchainNetwork,
        block_height: u64,
        block_timestamp: u64,
    ) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the chain
        let chain = self.chains.get_mut(network)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Update the block information
        chain.last_block_height = block_height;
        chain.last_block_timestamp = block_timestamp;
        
        // Update the last update timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        chain.last_update_timestamp = current_timestamp;
        
        msg!("Chain block info updated: height: {}, timestamp: {}", block_height, block_timestamp);
        
        Ok(())
    }
    
    /// Check if a network is enabled
    pub fn is_network_enabled(&self, network: &BlockchainNetwork) -> Result<bool, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the chain exists and is active
        if let Some(chain) = self.chains.get(network) {
            Ok(chain.status == ChainStatus::Active)
        } else {
            Ok(false)
        }
    }
    
    /// Get a chain
    pub fn get_chain(&self, network: &BlockchainNetwork) -> Option<&ChainInfo> {
        if !self.initialized {
            return None;
        }
        
        self.chains.get(network)
    }
    
    /// Get all chains
    pub fn get_all_chains(&self) -> &HashMap<BlockchainNetwork, ChainInfo> {
        &self.chains
    }
    
    /// Update the chain registry networks
    pub fn update_networks(&mut self, networks: Vec<BlockchainNetwork>) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Clear the existing chains
        self.chains.clear();
        
        // Add default configurations for the specified networks
        for network in networks {
            self.add_default_chain(network);
        }
        
        msg!("Chain registry networks updated");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_chain_registry_creation() {
        let registry = ChainRegistry::new();
        assert!(!registry.is_initialized());
        assert_eq!(registry.chains.len(), 0);
    }
    
    #[test]
    fn test_chain_registry_with_networks() {
        let networks = vec![
            BlockchainNetwork::Ethereum,
            BlockchainNetwork::Polygon,
        ];
        
        let registry = ChainRegistry::with_networks(networks);
        assert!(!registry.is_initialized());
        assert_eq!(registry.chains.len(), 2);
        assert!(registry.chains.contains_key(&BlockchainNetwork::Ethereum));
        assert!(registry.chains.contains_key(&BlockchainNetwork::Polygon));
    }
}
