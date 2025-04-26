// src/advanced_architecture/node_topology.rs
//! Node Topology module for Layer-2 on Solana
//! 
//! This module defines the node topology for the Layer-2 solution:
//! - Node types and roles
//! - Node requirements
//! - Node discovery and connectivity
//! - Node monitoring and health checks
//!
//! The node topology is designed to ensure high availability, security,
//! and performance of the Layer-2 network.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::{HashMap, HashSet};

/// Node type enumeration
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq, Eq)]
pub enum NodeType {
    /// Sequencer node (proposes blocks)
    Sequencer,
    
    /// Validator node (validates blocks)
    Validator,
    
    /// Full node (stores and serves the full state)
    Full,
    
    /// Light node (stores and serves partial state)
    Light,
    
    /// Archive node (stores historical data)
    Archive,
    
    /// RPC node (provides API access)
    RPC,
    
    /// Bridge node (facilitates cross-chain communication)
    Bridge,
    
    /// Prover node (generates and verifies proofs)
    Prover,
}

/// Node role enumeration
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq, Eq)]
pub enum NodeRole {
    /// Proposer role (proposes blocks)
    Proposer,
    
    /// Builder role (builds blocks)
    Builder,
    
    /// Validator role (validates blocks)
    Validator,
    
    /// Challenger role (submits fraud proofs)
    Challenger,
    
    /// Relayer role (relays messages between chains)
    Relayer,
    
    /// Observer role (observes the network)
    Observer,
}

/// Node requirements
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct NodeRequirements {
    /// Minimum CPU cores
    pub min_cpu_cores: u32,
    
    /// Minimum RAM (in MB)
    pub min_ram_mb: u64,
    
    /// Minimum disk space (in GB)
    pub min_disk_gb: u64,
    
    /// Minimum bandwidth (in Mbps)
    pub min_bandwidth_mbps: u32,
    
    /// Minimum stake (in tokens)
    pub min_stake: u64,
    
    /// Minimum uptime (in percentage)
    pub min_uptime_percentage: u32,
}

impl Default for NodeRequirements {
    fn default() -> Self {
        Self {
            min_cpu_cores: 4,
            min_ram_mb: 8192, // 8 GB
            min_disk_gb: 100,
            min_bandwidth_mbps: 100,
            min_stake: 1_000_000_000, // 10 SOL (assuming 8 decimals)
            min_uptime_percentage: 9900, // 99%
        }
    }
}

/// Node topology configuration
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct NodeTopologyConfig {
    /// Node requirements by type
    pub node_requirements: HashMap<NodeType, NodeRequirements>,
    
    /// Maximum number of nodes by type
    pub max_nodes: HashMap<NodeType, u32>,
    
    /// Minimum number of nodes by type
    pub min_nodes: HashMap<NodeType, u32>,
    
    /// Whether to enable node discovery
    pub enable_node_discovery: bool,
    
    /// Whether to enable node health checks
    pub enable_health_checks: bool,
    
    /// Health check interval (in seconds)
    pub health_check_interval: u64,
    
    /// Node rotation interval (in blocks)
    pub node_rotation_interval: u64,
    
    /// Whether to enable permissionless node joining
    pub permissionless_joining: bool,
}

impl Default for NodeTopologyConfig {
    fn default() -> Self {
        let mut node_requirements = HashMap::new();
        node_requirements.insert(NodeType::Sequencer, NodeRequirements {
            min_cpu_cores: 8,
            min_ram_mb: 16384, // 16 GB
            min_disk_gb: 200,
            min_bandwidth_mbps: 1000,
            min_stake: 100_000_000_000, // 1,000 SOL
            min_uptime_percentage: 9990, // 99.9%
        });
        node_requirements.insert(NodeType::Validator, NodeRequirements {
            min_cpu_cores: 4,
            min_ram_mb: 8192, // 8 GB
            min_disk_gb: 100,
            min_bandwidth_mbps: 100,
            min_stake: 10_000_000_000, // 100 SOL
            min_uptime_percentage: 9900, // 99%
        });
        node_requirements.insert(NodeType::Full, NodeRequirements {
            min_cpu_cores: 4,
            min_ram_mb: 8192, // 8 GB
            min_disk_gb: 500,
            min_bandwidth_mbps: 100,
            min_stake: 0,
            min_uptime_percentage: 9500, // 95%
        });
        node_requirements.insert(NodeType::Light, NodeRequirements {
            min_cpu_cores: 2,
            min_ram_mb: 4096, // 4 GB
            min_disk_gb: 50,
            min_bandwidth_mbps: 50,
            min_stake: 0,
            min_uptime_percentage: 9000, // 90%
        });
        node_requirements.insert(NodeType::Archive, NodeRequirements {
            min_cpu_cores: 8,
            min_ram_mb: 16384, // 16 GB
            min_disk_gb: 2000, // 2 TB
            min_bandwidth_mbps: 100,
            min_stake: 0,
            min_uptime_percentage: 9500, // 95%
        });
        node_requirements.insert(NodeType::RPC, NodeRequirements {
            min_cpu_cores: 4,
            min_ram_mb: 8192, // 8 GB
            min_disk_gb: 100,
            min_bandwidth_mbps: 1000,
            min_stake: 0,
            min_uptime_percentage: 9990, // 99.9%
        });
        node_requirements.insert(NodeType::Bridge, NodeRequirements {
            min_cpu_cores: 4,
            min_ram_mb: 8192, // 8 GB
            min_disk_gb: 100,
            min_bandwidth_mbps: 100,
            min_stake: 50_000_000_000, // 500 SOL
            min_uptime_percentage: 9990, // 99.9%
        });
        node_requirements.insert(NodeType::Prover, NodeRequirements {
            min_cpu_cores: 16,
            min_ram_mb: 32768, // 32 GB
            min_disk_gb: 200,
            min_bandwidth_mbps: 100,
            min_stake: 10_000_000_000, // 100 SOL
            min_uptime_percentage: 9900, // 99%
        });
        
        let mut max_nodes = HashMap::new();
        max_nodes.insert(NodeType::Sequencer, 10);
        max_nodes.insert(NodeType::Validator, 100);
        max_nodes.insert(NodeType::Full, 1000);
        max_nodes.insert(NodeType::Light, 10000);
        max_nodes.insert(NodeType::Archive, 10);
        max_nodes.insert(NodeType::RPC, 20);
        max_nodes.insert(NodeType::Bridge, 10);
        max_nodes.insert(NodeType::Prover, 20);
        
        let mut min_nodes = HashMap::new();
        min_nodes.insert(NodeType::Sequencer, 3);
        min_nodes.insert(NodeType::Validator, 10);
        min_nodes.insert(NodeType::Full, 5);
        min_nodes.insert(NodeType::Light, 0);
        min_nodes.insert(NodeType::Archive, 2);
        min_nodes.insert(NodeType::RPC, 3);
        min_nodes.insert(NodeType::Bridge, 3);
        min_nodes.insert(NodeType::Prover, 5);
        
        Self {
            node_requirements,
            max_nodes,
            min_nodes,
            enable_node_discovery: true,
            enable_health_checks: true,
            health_check_interval: 60, // 1 minute
            node_rotation_interval: 100, // Every 100 blocks
            permissionless_joining: true,
        }
    }
}

/// Node information
#[derive(Debug, Clone)]
pub struct NodeInfo {
    /// Node public key
    pub pubkey: Pubkey,
    
    /// Node type
    pub node_type: NodeType,
    
    /// Node roles
    pub roles: HashSet<NodeRole>,
    
    /// Node IP address
    pub ip_address: String,
    
    /// Node port
    pub port: u16,
    
    /// Node version
    pub version: String,
    
    /// Node stake
    pub stake: u64,
    
    /// Node uptime (in percentage)
    pub uptime_percentage: u32,
    
    /// Node last seen timestamp
    pub last_seen: u64,
    
    /// Node health status
    pub is_healthy: bool,
    
    /// Node performance metrics
    pub performance_metrics: NodePerformanceMetrics,
}

/// Node performance metrics
#[derive(Debug, Clone)]
pub struct NodePerformanceMetrics {
    /// CPU usage (in percentage)
    pub cpu_usage_percentage: u32,
    
    /// RAM usage (in MB)
    pub ram_usage_mb: u64,
    
    /// Disk usage (in GB)
    pub disk_usage_gb: u64,
    
    /// Bandwidth usage (in Mbps)
    pub bandwidth_usage_mbps: u32,
    
    /// Transaction throughput (in TPS)
    pub transaction_throughput: u32,
    
    /// Block proposal latency (in ms)
    pub block_proposal_latency_ms: u32,
    
    /// Block validation latency (in ms)
    pub block_validation_latency_ms: u32,
    
    /// Response time (in ms)
    pub response_time_ms: u32,
}

impl Default for NodePerformanceMetrics {
    fn default() -> Self {
        Self {
            cpu_usage_percentage: 0,
            ram_usage_mb: 0,
            disk_usage_gb: 0,
            bandwidth_usage_mbps: 0,
            transaction_throughput: 0,
            block_proposal_latency_ms: 0,
            block_validation_latency_ms: 0,
            response_time_ms: 0,
        }
    }
}

/// Node topology for the Layer-2 solution
pub struct NodeTopology {
    /// Node topology configuration
    config: NodeTopologyConfig,
    
    /// Registered nodes
    nodes: HashMap<Pubkey, NodeInfo>,
    
    /// Active nodes by type
    active_nodes: HashMap<NodeType, HashSet<Pubkey>>,
    
    /// Whether the node topology is initialized
    initialized: bool,
}

impl NodeTopology {
    /// Create a new node topology with default configuration
    pub fn new() -> Self {
        Self {
            config: NodeTopologyConfig::default(),
            nodes: HashMap::new(),
            active_nodes: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Create a new node topology with the specified configuration
    pub fn with_config(config: NodeTopologyConfig) -> Self {
        Self {
            config,
            nodes: HashMap::new(),
            active_nodes: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Initialize the node topology
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        // Initialize active nodes
        for node_type in [
            NodeType::Sequencer,
            NodeType::Validator,
            NodeType::Full,
            NodeType::Light,
            NodeType::Archive,
            NodeType::RPC,
            NodeType::Bridge,
            NodeType::Prover,
        ].iter() {
            self.active_nodes.insert(node_type.clone(), HashSet::new());
        }
        
        self.initialized = true;
        
        msg!("Node topology initialized");
        
        Ok(())
    }
    
    /// Check if the node topology is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Register a node
    pub fn register_node(
        &mut self,
        pubkey: Pubkey,
        node_type: NodeType,
        roles: HashSet<NodeRole>,
        ip_address: String,
        port: u16,
        version: String,
        stake: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the node is already registered
        if self.nodes.contains_key(&pubkey) {
            return Err(ProgramError::AccountAlreadyInitialized);
        }
        
        // Check if the maximum number of nodes is reached
        if let Some(max_nodes) = self.config.max_nodes.get(&node_type) {
            if let Some(active_nodes) = self.active_nodes.get(&node_type) {
                if active_nodes.len() >= *max_nodes as usize {
                    return Err(ProgramError::MaxAccountsDataSizeExceeded);
                }
            }
        }
        
        // Check if the node meets the requirements
        if let Some(requirements) = self.config.node_requirements.get(&node_type) {
            if stake < requirements.min_stake {
                return Err(ProgramError::InsufficientFunds);
            }
        }
        
        // Create the node info
        let node_info = NodeInfo {
            pubkey,
            node_type: node_type.clone(),
            roles,
            ip_address,
            port,
            version,
            stake,
            uptime_percentage: 10000, // 100%
            last_seen: 0, // In a real implementation, we would use the current timestamp
            is_healthy: true,
            performance_metrics: NodePerformanceMetrics::default(),
        };
        
        // Add the node
        self.nodes.insert(pubkey, node_info);
        
        // Add the node to the active nodes
        if let Some(active_nodes) = self.active_nodes.get_mut(&node_type) {
            active_nodes.insert(pubkey);
        }
        
        msg!("Node registered: {:?}, type: {:?}", pubkey, node_type);
        
        Ok(())
    }
    
    /// Unregister a node
    pub fn unregister_node(&mut self, pubkey: &Pubkey) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the node is registered
        let node_info = self.nodes.get(pubkey)
            .ok_or(ProgramError::InvalidAccountData)?;
        
        // Check if the minimum number of nodes is maintained
        if let Some(min_nodes) = self.config.min_nodes.get(&node_info.node_type) {
            if let Some(active_nodes) = self.active_nodes.get(&node_info.node_type) {
                if active_nodes.len() <= *min_nodes as usize {
                    return Err(ProgramError::InvalidArgument);
                }
            }
        }
        
        // Remove the node from the active nodes
        if let Some(active_nodes) = self.active_nodes.get_mut(&node_info.node_type) {
            active_nodes.remove(pubkey);
        }
        
        // Remove the node
        self.nodes.remove(pubkey);
        
        msg!("Node unregistered: {:?}", pubkey);
        
        Ok(())
    }
    
    /// Update node health
    pub fn update_node_health(
        &mut self,
        pubkey: &Pubkey,
        is_healthy: bool,
        performance_metrics: NodePerformanceMetrics,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the node is registered
        let node_info = self.nodes.get_mut(pubkey)
            .ok_or(ProgramError::InvalidAccountData)?;
        
        // Update the node health
        node_info.is_healthy = is_healthy;
        node_info.performance_metrics = performance_metrics;
        node_info.last_seen = 0; // In a real implementation, we would use the current timestamp
        
        // If the node is unhealthy, check if it should be removed from active nodes
        if !is_healthy {
            if let Some(active_nodes) = self.active_nodes.get_mut(&node_info.node_type) {
                active_nodes.remove(pubkey);
            }
        } else {
            // If the node is healthy, add it to active nodes
            if let Some(active_nodes) = self.active_nodes.get_mut(&node_info.node_type) {
                active_nodes.insert(*pubkey);
            }
        }
        
        msg!("Node health updated: {:?}, healthy: {}", pubkey, is_healthy);
        
        Ok(())
    }
    
    /// Update node state based on execution result
    pub fn update_node_state(&mut self, execution_result: &super::execution_environment::ExecutionResult) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // In a real implementation, we would update the node state based on the execution result
        // For now, we'll just log the execution result
        
        msg!("Node state updated based on execution result");
        
        Ok(())
    }
    
    /// Get nodes by type
    pub fn get_nodes_by_type(&self, node_type: &NodeType) -> Vec<&NodeInfo> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.nodes.values()
            .filter(|node| node.node_type == *node_type)
            .collect()
    }
    
    /// Get active nodes by type
    pub fn get_active_nodes_by_type(&self, node_type: &NodeType) -> Vec<&NodeInfo> {
        if !self.initialized {
            return Vec::new();
        }
        
        if let Some(active_nodes) = self.active_nodes.get(node_type) {
            active_nodes.iter()
                .filter_map(|pubkey| self.nodes.get(pubkey))
                .collect()
        } else {
            Vec::new()
        }
    }
    
    /// Get a node by public key
    pub fn get_node(&self, pubkey: &Pubkey) -> Option<&NodeInfo> {
        if !self.initialized {
            return None;
        }
        
        self.nodes.get(pubkey)
    }
    
    /// Check if a node is active
    pub fn is_node_active(&self, pubkey: &Pubkey) -> bool {
        if !self.initialized {
            return false;
        }
        
        if let Some(node_info) = self.nodes.get(pubkey) {
            if let Some(active_nodes) = self.active_nodes.get(&node_info.node_type) {
                return active_nodes.contains(pubkey);
            }
        }
        
        false
    }
    
    /// Update the node topology configuration
    pub fn update_config(&mut self, config: NodeTopologyConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the configuration
        self.config = config;
        
        msg!("Node topology configuration updated");
        
        Ok(())
    }
    
    /// Perform health checks on all nodes
    pub fn perform_health_checks(&mut self) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if health checks are enabled
        if !self.config.enable_health_checks {
            return Ok(());
        }
        
        // In a real implementation, we would perform health checks on all nodes
        // For now, we'll just log that health checks are being performed
        
        msg!("Performing health checks on all nodes");
        
        Ok(())
    }
    
    /// Discover new nodes
    pub fn discover_nodes(&mut self) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if node discovery is enabled
        if !self.config.enable_node_discovery {
            return Ok(());
        }
        
        // In a real implementation, we would discover new nodes
        // For now, we'll just log that node discovery is being performed
        
        msg!("Discovering new nodes");
        
        Ok(())
    }
    
    /// Rotate nodes
    pub fn rotate_nodes(&mut self) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // In a real implementation, we would rotate nodes based on performance and other factors
        // For now, we'll just log that node rotation is being performed
        
        msg!("Rotating nodes");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_node_topology_creation() {
        let topology = NodeTopology::new();
        assert!(!topology.is_initialized());
    }
    
    #[test]
    fn test_node_topology_with_config() {
        let config = NodeTopologyConfig::default();
        let topology = NodeTopology::with_config(config);
        assert!(!topology.is_initialized());
    }
}
