// src/interoperability/security_module.rs
//! Security Module for Cross-Chain Interoperability
//! 
//! This module implements security features for cross-chain operations:
//! - Rate limiting and transaction throttling
//! - Anomaly detection and prevention
//! - Access control and permission management
//! - Emergency shutdown and circuit breaker mechanisms
//!
//! The security module ensures that cross-chain operations are
//! secure and protected against various attack vectors.

use solana_program::{
    program_error::ProgramError,
    msg,
};
use std::collections::{HashMap, HashSet};
use crate::interoperability::BlockchainNetwork;

/// Security level
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecurityLevel {
    /// Low security
    Low,
    
    /// Medium security
    Medium,
    
    /// High security
    High,
    
    /// Critical security
    Critical,
}

/// Security action
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecurityAction {
    /// Allow
    Allow,
    
    /// Warn
    Warn,
    
    /// Throttle
    Throttle,
    
    /// Block
    Block,
    
    /// Emergency shutdown
    EmergencyShutdown,
}

/// Rate limit information
#[derive(Debug, Clone)]
pub struct RateLimitInfo {
    /// Network
    pub network: BlockchainNetwork,
    
    /// Operation type
    pub operation_type: String,
    
    /// Time window (seconds)
    pub time_window: u64,
    
    /// Max operations
    pub max_operations: u32,
    
    /// Current operations
    pub current_operations: u32,
    
    /// Last reset timestamp
    pub last_reset_timestamp: u64,
}

/// Access control entry
#[derive(Debug, Clone)]
pub struct AccessControlEntry {
    /// Address
    pub address: Vec<u8>,
    
    /// Network
    pub network: BlockchainNetwork,
    
    /// Operation type
    pub operation_type: String,
    
    /// Allowed
    pub allowed: bool,
    
    /// Max amount (if applicable)
    pub max_amount: Option<u64>,
    
    /// Last update timestamp
    pub last_update_timestamp: u64,
}

/// Security incident
#[derive(Debug, Clone)]
pub struct SecurityIncident {
    /// Incident ID
    pub id: u64,
    
    /// Network
    pub network: BlockchainNetwork,
    
    /// Address
    pub address: Vec<u8>,
    
    /// Operation type
    pub operation_type: String,
    
    /// Severity
    pub severity: SecurityLevel,
    
    /// Action taken
    pub action: SecurityAction,
    
    /// Description
    pub description: String,
    
    /// Timestamp
    pub timestamp: u64,
    
    /// Resolved
    pub resolved: bool,
    
    /// Resolution timestamp
    pub resolution_timestamp: Option<u64>,
}

/// Security module for cross-chain operations
pub struct SecurityModule {
    /// Whether security module is enabled
    enabled: bool,
    
    /// Rate limits by (network, operation_type)
    rate_limits: HashMap<(BlockchainNetwork, String), RateLimitInfo>,
    
    /// Access control entries by (address, network, operation_type)
    access_control: HashMap<(Vec<u8>, BlockchainNetwork, String), AccessControlEntry>,
    
    /// Security incidents by ID
    incidents: HashMap<u64, SecurityIncident>,
    
    /// Blocked addresses by network
    blocked_addresses: HashMap<BlockchainNetwork, HashSet<Vec<u8>>>,
    
    /// Emergency shutdown status by network
    emergency_shutdown: HashMap<BlockchainNetwork, bool>,
    
    /// Next incident ID
    next_incident_id: u64,
    
    /// Whether the security module is initialized
    initialized: bool,
}

impl SecurityModule {
    /// Create a new security module with default configuration
    pub fn new() -> Self {
        Self {
            enabled: true,
            rate_limits: HashMap::new(),
            access_control: HashMap::new(),
            incidents: HashMap::new(),
            blocked_addresses: HashMap::new(),
            emergency_shutdown: HashMap::new(),
            next_incident_id: 1,
            initialized: false,
        }
    }
    
    /// Create a new security module with the specified configuration
    pub fn with_config(enabled: bool) -> Self {
        Self {
            enabled,
            rate_limits: HashMap::new(),
            access_control: HashMap::new(),
            incidents: HashMap::new(),
            blocked_addresses: HashMap::new(),
            emergency_shutdown: HashMap::new(),
            next_incident_id: 1,
            initialized: false,
        }
    }
    
    /// Initialize the security module
    pub fn initialize(&mut self) -> Result<(), ProgramError> {
        self.initialized = true;
        
        // Initialize default rate limits
        self.initialize_default_rate_limits();
        
        // Initialize emergency shutdown status for all networks
        for network in [
            BlockchainNetwork::Ethereum,
            BlockchainNetwork::BinanceSmartChain,
            BlockchainNetwork::Polygon,
            BlockchainNetwork::Avalanche,
            BlockchainNetwork::Arbitrum,
            BlockchainNetwork::Optimism,
            BlockchainNetwork::Cosmos,
            BlockchainNetwork::Polkadot,
            BlockchainNetwork::Near,
        ].iter() {
            self.emergency_shutdown.insert(network.clone(), false);
            self.blocked_addresses.insert(network.clone(), HashSet::new());
        }
        
        msg!("Security module initialized");
        
        Ok(())
    }
    
    /// Initialize default rate limits
    fn initialize_default_rate_limits(&mut self) {
        // Define default rate limits for different operations
        let operations = [
            "message", "transfer", "call", "state",
        ];
        
        for network in [
            BlockchainNetwork::Ethereum,
            BlockchainNetwork::BinanceSmartChain,
            BlockchainNetwork::Polygon,
            BlockchainNetwork::Avalanche,
            BlockchainNetwork::Arbitrum,
            BlockchainNetwork::Optimism,
            BlockchainNetwork::Cosmos,
            BlockchainNetwork::Polkadot,
            BlockchainNetwork::Near,
        ].iter() {
            for &operation in operations.iter() {
                let (time_window, max_operations) = match operation {
                    "message" => (60, 100),    // 100 messages per minute
                    "transfer" => (60, 50),    // 50 transfers per minute
                    "call" => (60, 30),        // 30 calls per minute
                    "state" => (300, 10),      // 10 state updates per 5 minutes
                    _ => (60, 100),            // Default: 100 operations per minute
                };
                
                let rate_limit = RateLimitInfo {
                    network: network.clone(),
                    operation_type: operation.to_string(),
                    time_window,
                    max_operations,
                    current_operations: 0,
                    last_reset_timestamp: 0, // Will be set on first use
                };
                
                self.rate_limits.insert((network.clone(), operation.to_string()), rate_limit);
            }
        }
    }
    
    /// Check if the security module is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Check outgoing message
    pub fn check_outgoing_message(
        &mut self,
        target_network: &BlockchainNetwork,
        recipient: &[u8],
        message: &[u8],
    ) -> Result<(), ProgramError> {
        if !self.initialized || !self.enabled {
            return Ok(());
        }
        
        // Check emergency shutdown
        if self.is_emergency_shutdown(target_network)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check rate limit
        self.check_rate_limit(target_network, "message")?;
        
        // Check for anomalies
        self.check_message_anomalies(target_network, recipient, message)?;
        
        Ok(())
    }
    
    /// Check incoming message
    pub fn check_incoming_message(
        &mut self,
        source_network: &BlockchainNetwork,
        sender: &[u8],
        message: &[u8],
    ) -> Result<(), ProgramError> {
        if !self.initialized || !self.enabled {
            return Ok(());
        }
        
        // Check emergency shutdown
        if self.is_emergency_shutdown(source_network)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if sender is blocked
        if self.is_address_blocked(source_network, sender)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check for anomalies
        self.check_message_anomalies(source_network, sender, message)?;
        
        Ok(())
    }
    
    /// Check outgoing transfer
    pub fn check_outgoing_transfer(
        &mut self,
        target_network: &BlockchainNetwork,
        recipient: &[u8],
        asset_id: &[u8],
        amount: u64,
    ) -> Result<(), ProgramError> {
        if !self.initialized || !self.enabled {
            return Ok(());
        }
        
        // Check emergency shutdown
        if self.is_emergency_shutdown(target_network)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check rate limit
        self.check_rate_limit(target_network, "transfer")?;
        
        // Check for anomalies
        self.check_transfer_anomalies(target_network, recipient, asset_id, amount)?;
        
        Ok(())
    }
    
    /// Check incoming transfer
    pub fn check_incoming_transfer(
        &mut self,
        source_network: &BlockchainNetwork,
        sender: &[u8],
        asset_id: &[u8],
        amount: u64,
    ) -> Result<(), ProgramError> {
        if !self.initialized || !self.enabled {
            return Ok(());
        }
        
        // Check emergency shutdown
        if self.is_emergency_shutdown(source_network)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if sender is blocked
        if self.is_address_blocked(source_network, sender)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check for anomalies
        self.check_transfer_anomalies(source_network, sender, asset_id, amount)?;
        
        Ok(())
    }
    
    /// Check outgoing call
    pub fn check_outgoing_call(
        &mut self,
        target_network: &BlockchainNetwork,
        contract_address: &[u8],
        function_signature: &[u8],
        parameters: &[u8],
    ) -> Result<(), ProgramError> {
        if !self.initialized || !self.enabled {
            return Ok(());
        }
        
        // Check emergency shutdown
        if self.is_emergency_shutdown(target_network)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check rate limit
        self.check_rate_limit(target_network, "call")?;
        
        // Check for anomalies
        self.check_call_anomalies(target_network, contract_address, function_signature, parameters)?;
        
        Ok(())
    }
    
    /// Check incoming call
    pub fn check_incoming_call(
        &mut self,
        source_network: &BlockchainNetwork,
        sender: &[u8],
        function_signature: &[u8],
        parameters: &[u8],
    ) -> Result<(), ProgramError> {
        if !self.initialized || !self.enabled {
            return Ok(());
        }
        
        // Check emergency shutdown
        if self.is_emergency_shutdown(source_network)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if sender is blocked
        if self.is_address_blocked(source_network, sender)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check for anomalies
        self.check_call_anomalies(source_network, sender, function_signature, parameters)?;
        
        Ok(())
    }
    
    /// Check rate limit
    fn check_rate_limit(
        &mut self,
        network: &BlockchainNetwork,
        operation_type: &str,
    ) -> Result<(), ProgramError> {
        let key = (network.clone(), operation_type.to_string());
        
        if let Some(rate_limit) = self.rate_limits.get_mut(&key) {
            // Get the current timestamp
            let current_timestamp = 0; // In a real implementation, we would use the current timestamp
            
            // Check if we need to reset the counter
            if current_timestamp - rate_limit.last_reset_timestamp >= rate_limit.time_window {
                rate_limit.current_operations = 0;
                rate_limit.last_reset_timestamp = current_timestamp;
            }
            
            // Check if we've exceeded the limit
            if rate_limit.current_operations >= rate_limit.max_operations {
                // Create a security incident
                self.create_incident(
                    network.clone(),
                    Vec::new(), // No specific address
                    operation_type.to_string(),
                    SecurityLevel::Medium,
                    SecurityAction::Throttle,
                    format!("Rate limit exceeded for {} operations on {}", operation_type, network),
                )?;
                
                return Err(ProgramError::InvalidArgument);
            }
            
            // Increment the counter
            rate_limit.current_operations += 1;
        }
        
        Ok(())
    }
    
    /// Check message anomalies
    fn check_message_anomalies(
        &mut self,
        network: &BlockchainNetwork,
        address: &[u8],
        message: &[u8],
    ) -> Result<(), ProgramError> {
        // In a real implementation, we would check for various anomalies
        // For now, we'll just check if the message is too large
        
        if message.len() > 10000 {
            // Create a security incident
            self.create_incident(
                network.clone(),
                address.to_vec(),
                "message".to_string(),
                SecurityLevel::Medium,
                SecurityAction::Block,
                format!("Message size exceeds limit: {} bytes", message.len()),
            )?;
            
            return Err(ProgramError::InvalidArgument);
        }
        
        Ok(())
    }
    
    /// Check transfer anomalies
    fn check_transfer_anomalies(
        &mut self,
        network: &BlockchainNetwork,
        address: &[u8],
        asset_id: &[u8],
        amount: u64,
    ) -> Result<(), ProgramError> {
        // In a real implementation, we would check for various anomalies
        // For now, we'll just check if the amount is too large
        
        if amount > 1_000_000_000_000 {
            // Create a security incident
            self.create_incident(
                network.clone(),
                address.to_vec(),
                "transfer".to_string(),
                SecurityLevel::High,
                SecurityAction::Block,
                format!("Transfer amount exceeds limit: {}", amount),
            )?;
            
            return Err(ProgramError::InvalidArgument);
        }
        
        Ok(())
    }
    
    /// Check call anomalies
    fn check_call_anomalies(
        &mut self,
        network: &BlockchainNetwork,
        address: &[u8],
        function_signature: &[u8],
        parameters: &[u8],
    ) -> Result<(), ProgramError> {
        // In a real implementation, we would check for various anomalies
        // For now, we'll just check if the parameters are too large
        
        if parameters.len() > 10000 {
            // Create a security incident
            self.create_incident(
                network.clone(),
                address.to_vec(),
                "call".to_string(),
                SecurityLevel::Medium,
                SecurityAction::Block,
                format!("Call parameters size exceeds limit: {} bytes", parameters.len()),
            )?;
            
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check for potentially dangerous function signatures
        // In a real implementation, we would have a more comprehensive list
        let dangerous_signatures = [
            // Example dangerous function signatures
            [0x23, 0xb8, 0x72, 0xdd], // transferFrom
            [0x09, 0x5e, 0xa7, 0xb3], // approve
        ];
        
        for &signature in dangerous_signatures.iter() {
            if function_signature.starts_with(&signature) {
                // Create a security incident
                self.create_incident(
                    network.clone(),
                    address.to_vec(),
                    "call".to_string(),
                    SecurityLevel::High,
                    SecurityAction::Warn,
                    format!("Potentially dangerous function signature detected"),
                )?;
                
                // We don't block it, just warn
                break;
            }
        }
        
        Ok(())
    }
    
    /// Create a security incident
    fn create_incident(
        &mut self,
        network: BlockchainNetwork,
        address: Vec<u8>,
        operation_type: String,
        severity: SecurityLevel,
        action: SecurityAction,
        description: String,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        // Create the incident
        let incident_id = self.next_incident_id;
        self.next_incident_id += 1;
        
        let incident = SecurityIncident {
            id: incident_id,
            network: network.clone(),
            address: address.clone(),
            operation_type: operation_type.clone(),
            severity,
            action: action.clone(),
            description,
            timestamp: current_timestamp,
            resolved: false,
            resolution_timestamp: None,
        };
        
        // Add the incident
        self.incidents.insert(incident_id, incident);
        
        // Take action based on the security action
        match action {
            SecurityAction::Block => {
                // Block the address
                if !address.is_empty() {
                    self.block_address(&network, &address)?;
                }
            },
            SecurityAction::EmergencyShutdown => {
                // Trigger emergency shutdown
                self.trigger_emergency_shutdown(&network)?;
            },
            _ => {
                // No additional action needed
            },
        }
        
        msg!("Security incident created: {}, severity: {:?}, action: {:?}", 
            incident_id, severity, action);
        
        Ok(incident_id)
    }
    
    /// Block an address
    pub fn block_address(
        &mut self,
        network: &BlockchainNetwork,
        address: &[u8],
    ) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the blocked addresses for the network
        let blocked_addresses = self.blocked_addresses.entry(network.clone())
            .or_insert_with(HashSet::new);
        
        // Add the address to the blocked list
        blocked_addresses.insert(address.to_vec());
        
        msg!("Address blocked");
        
        Ok(())
    }
    
    /// Unblock an address
    pub fn unblock_address(
        &mut self,
        network: &BlockchainNetwork,
        address: &[u8],
    ) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the blocked addresses for the network
        if let Some(blocked_addresses) = self.blocked_addresses.get_mut(network) {
            // Remove the address from the blocked list
            blocked_addresses.remove(&address.to_vec());
        }
        
        msg!("Address unblocked");
        
        Ok(())
    }
    
    /// Check if an address is blocked
    pub fn is_address_blocked(
        &self,
        network: &BlockchainNetwork,
        address: &[u8],
    ) -> Result<bool, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the network has any blocked addresses
        if let Some(blocked_addresses) = self.blocked_addresses.get(network) {
            // Check if the address is in the blocked list
            Ok(blocked_addresses.contains(&address.to_vec()))
        } else {
            Ok(false)
        }
    }
    
    /// Trigger emergency shutdown
    pub fn trigger_emergency_shutdown(
        &mut self,
        network: &BlockchainNetwork,
    ) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Set emergency shutdown status
        self.emergency_shutdown.insert(network.clone(), true);
        
        msg!("Emergency shutdown triggered for network: {:?}", network);
        
        Ok(())
    }
    
    /// Clear emergency shutdown
    pub fn clear_emergency_shutdown(
        &mut self,
        network: &BlockchainNetwork,
    ) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Clear emergency shutdown status
        self.emergency_shutdown.insert(network.clone(), false);
        
        msg!("Emergency shutdown cleared for network: {:?}", network);
        
        Ok(())
    }
    
    /// Check if emergency shutdown is active
    pub fn is_emergency_shutdown(
        &self,
        network: &BlockchainNetwork,
    ) -> Result<bool, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check emergency shutdown status
        if let Some(&shutdown) = self.emergency_shutdown.get(network) {
            Ok(shutdown)
        } else {
            Ok(false)
        }
    }
    
    /// Set rate limit
    pub fn set_rate_limit(
        &mut self,
        network: BlockchainNetwork,
        operation_type: String,
        time_window: u64,
        max_operations: u32,
    ) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        // Create or update the rate limit
        let rate_limit = RateLimitInfo {
            network: network.clone(),
            operation_type: operation_type.clone(),
            time_window,
            max_operations,
            current_operations: 0,
            last_reset_timestamp: current_timestamp,
        };
        
        self.rate_limits.insert((network, operation_type), rate_limit);
        
        msg!("Rate limit set");
        
        Ok(())
    }
    
    /// Get a rate limit
    pub fn get_rate_limit(
        &self,
        network: &BlockchainNetwork,
        operation_type: &str,
    ) -> Option<&RateLimitInfo> {
        if !self.initialized {
            return None;
        }
        
        self.rate_limits.get(&(network.clone(), operation_type.to_string()))
    }
    
    /// Set access control
    pub fn set_access_control(
        &mut self,
        address: Vec<u8>,
        network: BlockchainNetwork,
        operation_type: String,
        allowed: bool,
        max_amount: Option<u64>,
    ) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the current timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        
        // Create or update the access control entry
        let entry = AccessControlEntry {
            address: address.clone(),
            network: network.clone(),
            operation_type: operation_type.clone(),
            allowed,
            max_amount,
            last_update_timestamp: current_timestamp,
        };
        
        self.access_control.insert((address, network, operation_type), entry);
        
        msg!("Access control set");
        
        Ok(())
    }
    
    /// Get an access control entry
    pub fn get_access_control(
        &self,
        address: &[u8],
        network: &BlockchainNetwork,
        operation_type: &str,
    ) -> Option<&AccessControlEntry> {
        if !self.initialized {
            return None;
        }
        
        self.access_control.get(&(address.to_vec(), network.clone(), operation_type.to_string()))
    }
    
    /// Resolve a security incident
    pub fn resolve_incident(
        &mut self,
        incident_id: u64,
    ) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the incident
        let incident = self.incidents.get_mut(&incident_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Mark the incident as resolved
        incident.resolved = true;
        
        // Set the resolution timestamp
        let current_timestamp = 0; // In a real implementation, we would use the current timestamp
        incident.resolution_timestamp = Some(current_timestamp);
        
        msg!("Security incident resolved: {}", incident_id);
        
        Ok(())
    }
    
    /// Get a security incident
    pub fn get_incident(
        &self,
        incident_id: u64,
    ) -> Option<&SecurityIncident> {
        if !self.initialized {
            return None;
        }
        
        self.incidents.get(&incident_id)
    }
    
    /// Get all security incidents
    pub fn get_all_incidents(&self) -> &HashMap<u64, SecurityIncident> {
        &self.incidents
    }
    
    /// Update the security module configuration
    pub fn update_config(&mut self, enabled: bool) -> Result<(), ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        self.enabled = enabled;
        
        msg!("Security module configuration updated");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_security_module_creation() {
        let module = SecurityModule::new();
        assert!(!module.is_initialized());
        assert!(module.enabled);
    }
    
    #[test]
    fn test_security_module_with_config() {
        let module = SecurityModule::with_config(false);
        assert!(!module.is_initialized());
        assert!(!module.enabled);
    }
}
