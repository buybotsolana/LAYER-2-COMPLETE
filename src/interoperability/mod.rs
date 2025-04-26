// src/interoperability/mod.rs
//! Cross-Chain Interoperability module for Layer-2 on Solana
//! 
//! This module implements cross-chain interoperability features:
//! - Message passing between different blockchains
//! - Asset transfers across chains
//! - Cross-chain contract calls
//! - Unified liquidity across multiple chains
//!
//! These features allow the Layer-2 solution to communicate and
//! interact with other blockchain networks, creating a more
//! connected and interoperable ecosystem.

mod message_protocol;
mod asset_bridge;
mod cross_chain_calls;
mod liquidity_network;
mod chain_registry;
mod verification_protocol;
mod relay_network;
mod security_module;

pub use message_protocol::MessageProtocol;
pub use asset_bridge::AssetBridge;
pub use cross_chain_calls::CrossChainCalls;
pub use liquidity_network::LiquidityNetwork;
pub use chain_registry::ChainRegistry;
pub use verification_protocol::VerificationProtocol;
pub use relay_network::RelayNetwork;
pub use security_module::SecurityModule;

use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

/// Supported blockchain networks
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockchainNetwork {
    /// Ethereum
    Ethereum,
    
    /// Binance Smart Chain
    BinanceSmartChain,
    
    /// Polygon
    Polygon,
    
    /// Avalanche
    Avalanche,
    
    /// Arbitrum
    Arbitrum,
    
    /// Optimism
    Optimism,
    
    /// Cosmos
    Cosmos,
    
    /// Polkadot
    Polkadot,
    
    /// Near
    Near,
    
    /// Custom network
    Custom(String),
}

/// Interoperability configuration
#[derive(Debug, Clone)]
pub struct InteroperabilityConfig {
    /// Enabled networks
    pub enabled_networks: Vec<BlockchainNetwork>,
    
    /// Message verification threshold (number of confirmations)
    pub message_verification_threshold: u32,
    
    /// Asset transfer limit per transaction
    pub asset_transfer_limit: u64,
    
    /// Cross-chain call gas limit
    pub cross_chain_call_gas_limit: u64,
    
    /// Relay network size
    pub relay_network_size: u32,
    
    /// Security module enabled
    pub security_module_enabled: bool,
}

impl Default for InteroperabilityConfig {
    fn default() -> Self {
        Self {
            enabled_networks: vec![
                BlockchainNetwork::Ethereum,
                BlockchainNetwork::Polygon,
                BlockchainNetwork::Arbitrum,
                BlockchainNetwork::Optimism,
            ],
            message_verification_threshold: 10,
            asset_transfer_limit: 1_000_000_000, // 1 billion units
            cross_chain_call_gas_limit: 1_000_000, // 1 million gas
            relay_network_size: 5,
            security_module_enabled: true,
        }
    }
}

/// Interoperability manager for cross-chain communication
pub struct InteroperabilityManager {
    /// Interoperability configuration
    config: InteroperabilityConfig,
    
    /// Message protocol
    message_protocol: MessageProtocol,
    
    /// Asset bridge
    asset_bridge: AssetBridge,
    
    /// Cross-chain calls
    cross_chain_calls: CrossChainCalls,
    
    /// Liquidity network
    liquidity_network: LiquidityNetwork,
    
    /// Chain registry
    chain_registry: ChainRegistry,
    
    /// Verification protocol
    verification_protocol: VerificationProtocol,
    
    /// Relay network
    relay_network: RelayNetwork,
    
    /// Security module
    security_module: SecurityModule,
    
    /// Whether the interoperability manager is initialized
    initialized: bool,
}

impl InteroperabilityManager {
    /// Create a new interoperability manager with default configuration
    pub fn new() -> Self {
        let config = InteroperabilityConfig::default();
        Self {
            config: config.clone(),
            message_protocol: MessageProtocol::with_config(config.message_verification_threshold),
            asset_bridge: AssetBridge::with_config(config.asset_transfer_limit),
            cross_chain_calls: CrossChainCalls::with_config(config.cross_chain_call_gas_limit),
            liquidity_network: LiquidityNetwork::new(),
            chain_registry: ChainRegistry::with_networks(config.enabled_networks.clone()),
            verification_protocol: VerificationProtocol::new(),
            relay_network: RelayNetwork::with_config(config.relay_network_size),
            security_module: SecurityModule::with_config(config.security_module_enabled),
            initialized: false,
        }
    }
    
    /// Create a new interoperability manager with the specified configuration
    pub fn with_config(config: InteroperabilityConfig) -> Self {
        Self {
            config: config.clone(),
            message_protocol: MessageProtocol::with_config(config.message_verification_threshold),
            asset_bridge: AssetBridge::with_config(config.asset_transfer_limit),
            cross_chain_calls: CrossChainCalls::with_config(config.cross_chain_call_gas_limit),
            liquidity_network: LiquidityNetwork::new(),
            chain_registry: ChainRegistry::with_networks(config.enabled_networks.clone()),
            verification_protocol: VerificationProtocol::new(),
            relay_network: RelayNetwork::with_config(config.relay_network_size),
            security_module: SecurityModule::with_config(config.security_module_enabled),
            initialized: false,
        }
    }
    
    /// Initialize the interoperability manager
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Initialize all components
        self.message_protocol.initialize()?;
        self.asset_bridge.initialize()?;
        self.cross_chain_calls.initialize()?;
        self.liquidity_network.initialize()?;
        self.chain_registry.initialize()?;
        self.verification_protocol.initialize()?;
        self.relay_network.initialize()?;
        self.security_module.initialize()?;
        
        self.initialized = true;
        
        msg!("Interoperability manager initialized");
        
        Ok(())
    }
    
    /// Check if the interoperability manager is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Send a message to another blockchain
    pub fn send_message(
        &mut self,
        target_network: BlockchainNetwork,
        recipient: Vec<u8>,
        message: Vec<u8>,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the target network is enabled
        if !self.chain_registry.is_network_enabled(&target_network)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check the message with the security module
        self.security_module.check_outgoing_message(&target_network, &recipient, &message)?;
        
        // Send the message
        let message_id = self.message_protocol.send_message(target_network.clone(), recipient.clone(), message.clone())?;
        
        // Relay the message
        self.relay_network.relay_message(message_id, target_network, recipient, message)?;
        
        msg!("Message sent: id: {}", message_id);
        
        Ok(message_id)
    }
    
    /// Receive a message from another blockchain
    pub fn receive_message(
        &mut self,
        source_network: BlockchainNetwork,
        sender: Vec<u8>,
        message: Vec<u8>,
        proof: Vec<u8>,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the source network is enabled
        if !self.chain_registry.is_network_enabled(&source_network)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Verify the message
        self.verification_protocol.verify_message(&source_network, &sender, &message, &proof)?;
        
        // Check the message with the security module
        self.security_module.check_incoming_message(&source_network, &sender, &message)?;
        
        // Receive the message
        let message_id = self.message_protocol.receive_message(source_network, sender, message)?;
        
        msg!("Message received: id: {}", message_id);
        
        Ok(message_id)
    }
    
    /// Transfer an asset to another blockchain
    pub fn transfer_asset(
        &mut self,
        target_network: BlockchainNetwork,
        recipient: Vec<u8>,
        asset_id: Vec<u8>,
        amount: u64,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the target network is enabled
        if !self.chain_registry.is_network_enabled(&target_network)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check the transfer with the security module
        self.security_module.check_outgoing_transfer(&target_network, &recipient, &asset_id, amount)?;
        
        // Transfer the asset
        let transfer_id = self.asset_bridge.transfer_asset(target_network.clone(), recipient.clone(), asset_id.clone(), amount)?;
        
        // Update the liquidity network
        self.liquidity_network.update_liquidity(&target_network, &asset_id, amount, false)?;
        
        msg!("Asset transferred: id: {}, amount: {}", transfer_id, amount);
        
        Ok(transfer_id)
    }
    
    /// Receive an asset from another blockchain
    pub fn receive_asset(
        &mut self,
        source_network: BlockchainNetwork,
        sender: Vec<u8>,
        asset_id: Vec<u8>,
        amount: u64,
        proof: Vec<u8>,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the source network is enabled
        if !self.chain_registry.is_network_enabled(&source_network)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Verify the transfer
        self.verification_protocol.verify_transfer(&source_network, &sender, &asset_id, amount, &proof)?;
        
        // Check the transfer with the security module
        self.security_module.check_incoming_transfer(&source_network, &sender, &asset_id, amount)?;
        
        // Receive the asset
        let transfer_id = self.asset_bridge.receive_asset(source_network.clone(), sender, asset_id.clone(), amount)?;
        
        // Update the liquidity network
        self.liquidity_network.update_liquidity(&source_network, &asset_id, amount, true)?;
        
        msg!("Asset received: id: {}, amount: {}", transfer_id, amount);
        
        Ok(transfer_id)
    }
    
    /// Execute a cross-chain contract call
    pub fn execute_cross_chain_call(
        &mut self,
        target_network: BlockchainNetwork,
        contract_address: Vec<u8>,
        function_signature: Vec<u8>,
        parameters: Vec<u8>,
        gas_limit: u64,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the target network is enabled
        if !self.chain_registry.is_network_enabled(&target_network)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check the gas limit
        if gas_limit > self.config.cross_chain_call_gas_limit {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check the call with the security module
        self.security_module.check_outgoing_call(&target_network, &contract_address, &function_signature, &parameters)?;
        
        // Execute the call
        let call_id = self.cross_chain_calls.execute_call(
            target_network.clone(),
            contract_address.clone(),
            function_signature.clone(),
            parameters.clone(),
            gas_limit,
        )?;
        
        // Relay the call
        self.relay_network.relay_call(call_id, target_network, contract_address, function_signature, parameters, gas_limit)?;
        
        msg!("Cross-chain call executed: id: {}", call_id);
        
        Ok(call_id)
    }
    
    /// Receive a cross-chain contract call
    pub fn receive_cross_chain_call(
        &mut self,
        source_network: BlockchainNetwork,
        sender: Vec<u8>,
        function_signature: Vec<u8>,
        parameters: Vec<u8>,
        proof: Vec<u8>,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the source network is enabled
        if !self.chain_registry.is_network_enabled(&source_network)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Verify the call
        self.verification_protocol.verify_call(&source_network, &sender, &function_signature, &parameters, &proof)?;
        
        // Check the call with the security module
        self.security_module.check_incoming_call(&source_network, &sender, &function_signature, &parameters)?;
        
        // Receive the call
        let call_id = self.cross_chain_calls.receive_call(
            source_network,
            sender,
            function_signature,
            parameters,
        )?;
        
        msg!("Cross-chain call received: id: {}", call_id);
        
        Ok(call_id)
    }
    
    /// Get the liquidity for an asset on a specific network
    pub fn get_liquidity(
        &self,
        network: &BlockchainNetwork,
        asset_id: &[u8],
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the network is enabled
        if !self.chain_registry.is_network_enabled(network)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Get the liquidity
        self.liquidity_network.get_liquidity(network, asset_id)
    }
    
    /// Update the interoperability configuration
    pub fn update_config(&mut self, config: InteroperabilityConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the configuration
        self.config = config.clone();
        
        // Update the components
        self.message_protocol.update_config(config.message_verification_threshold)?;
        self.asset_bridge.update_config(config.asset_transfer_limit)?;
        self.cross_chain_calls.update_config(config.cross_chain_call_gas_limit)?;
        self.chain_registry.update_networks(config.enabled_networks.clone())?;
        self.relay_network.update_config(config.relay_network_size)?;
        self.security_module.update_config(config.security_module_enabled)?;
        
        msg!("Interoperability configuration updated");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_interoperability_manager_creation() {
        let manager = InteroperabilityManager::new();
        assert!(!manager.is_initialized());
    }
    
    #[test]
    fn test_interoperability_manager_with_config() {
        let config = InteroperabilityConfig::default();
        let manager = InteroperabilityManager::with_config(config);
        assert!(!manager.is_initialized());
    }
}
