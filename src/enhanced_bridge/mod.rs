// src/enhanced_bridge/mod.rs
//! Enhanced Bridge Security module for Layer-2 on Solana
//! 
//! This module implements enhanced security for the bridge between Ethereum (L1) and Solana Layer-2:
//! - Multi-signature validation for asset transfers
//! - Fraud-proof integration for contested transfers
//! - Rate limiting and transaction value caps
//! - Delayed withdrawals with challenge periods
//! - Liquidity pools for instant withdrawals
//! - Monitoring and alerting for suspicious activities
//!
//! The enhanced bridge security ensures safe and reliable asset transfers
//! between the Layer-1 and Layer-2 chains.

mod multi_sig_validator;
mod fraud_proof_integration;
mod rate_limiter;
mod delayed_withdrawals;
mod liquidity_pool;
mod bridge_monitor;
mod asset_registry;
mod bridge_governance;

pub use multi_sig_validator::{MultiSigValidator, SignatureConfig, SignatureThreshold};
pub use fraud_proof_integration::{FraudProofIntegration, FraudProofConfig};
pub use rate_limiter::{RateLimiter, RateLimitConfig, TransactionLimit};
pub use delayed_withdrawals::{DelayedWithdrawals, WithdrawalConfig, WithdrawalStatus};
pub use liquidity_pool::{LiquidityPool, PoolConfig, LiquidityProvider};
pub use bridge_monitor::{BridgeMonitor, MonitorConfig, BridgeAlert};
pub use asset_registry::{AssetRegistry, AssetInfo, AssetStatus};
pub use bridge_governance::{BridgeGovernance, GovernanceConfig, ProposalType};

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;

/// Enhanced bridge security configuration
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct EnhancedBridgeConfig {
    /// Minimum number of signatures required for transfers
    pub min_signatures: u32,
    
    /// Maximum transfer amount without additional verification
    pub max_transfer_amount: u64,
    
    /// Withdrawal delay period (in seconds)
    pub withdrawal_delay_period: u64,
    
    /// Challenge period for withdrawals (in seconds)
    pub withdrawal_challenge_period: u64,
    
    /// Maximum transactions per hour per account
    pub max_transactions_per_hour: u32,
    
    /// Maximum value per hour per account
    pub max_value_per_hour: u64,
    
    /// Whether to enable liquidity pools for instant withdrawals
    pub enable_liquidity_pools: bool,
    
    /// Fee for instant withdrawals (in basis points)
    pub instant_withdrawal_fee_bps: u32,
    
    /// Whether to enable bridge monitoring
    pub enable_bridge_monitoring: bool,
    
    /// Whether to enable bridge governance
    pub enable_bridge_governance: bool,
}

impl Default for EnhancedBridgeConfig {
    fn default() -> Self {
        Self {
            min_signatures: 3,
            max_transfer_amount: 1_000_000_000_000, // 10,000 SOL (assuming 8 decimals)
            withdrawal_delay_period: 86400, // 1 day in seconds
            withdrawal_challenge_period: 172800, // 2 days in seconds
            max_transactions_per_hour: 10,
            max_value_per_hour: 10_000_000_000_000, // 100,000 SOL (assuming 8 decimals)
            enable_liquidity_pools: true,
            instant_withdrawal_fee_bps: 25, // 0.25%
            enable_bridge_monitoring: true,
            enable_bridge_governance: true,
        }
    }
}

/// Transfer direction
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransferDirection {
    /// Deposit (L1 to L2)
    Deposit,
    
    /// Withdrawal (L2 to L1)
    Withdrawal,
}

/// Transfer status
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransferStatus {
    /// Pending
    Pending,
    
    /// In challenge period
    InChallengePeriod,
    
    /// Completed
    Completed,
    
    /// Rejected
    Rejected,
    
    /// Challenged
    Challenged,
}

/// Transfer information
#[derive(Debug, Clone)]
pub struct TransferInfo {
    /// Transfer ID
    pub id: u64,
    
    /// Source address
    pub source: [u8; 32],
    
    /// Destination address
    pub destination: [u8; 32],
    
    /// Asset ID
    pub asset_id: u64,
    
    /// Amount
    pub amount: u64,
    
    /// Direction
    pub direction: TransferDirection,
    
    /// Status
    pub status: TransferStatus,
    
    /// Timestamp
    pub timestamp: u64,
    
    /// Signatures
    pub signatures: Vec<([u8; 32], [u8; 64])>,
    
    /// Challenge ID (if challenged)
    pub challenge_id: Option<u64>,
    
    /// Completion timestamp
    pub completion_timestamp: Option<u64>,
}

/// Enhanced bridge security system for the Layer-2 solution
pub struct EnhancedBridgeSystem {
    /// Bridge configuration
    config: EnhancedBridgeConfig,
    
    /// Multi-signature validator
    multi_sig_validator: multi_sig_validator::MultiSigValidator,
    
    /// Fraud proof integration
    fraud_proof_integration: fraud_proof_integration::FraudProofIntegration,
    
    /// Rate limiter
    rate_limiter: rate_limiter::RateLimiter,
    
    /// Delayed withdrawals
    delayed_withdrawals: delayed_withdrawals::DelayedWithdrawals,
    
    /// Liquidity pool
    liquidity_pool: liquidity_pool::LiquidityPool,
    
    /// Bridge monitor
    bridge_monitor: bridge_monitor::BridgeMonitor,
    
    /// Asset registry
    asset_registry: asset_registry::AssetRegistry,
    
    /// Bridge governance
    bridge_governance: bridge_governance::BridgeGovernance,
    
    /// Transfers by ID
    transfers: HashMap<u64, TransferInfo>,
    
    /// Next transfer ID
    next_transfer_id: u64,
    
    /// Whether the bridge system is initialized
    initialized: bool,
}

impl EnhancedBridgeSystem {
    /// Create a new enhanced bridge system with default configuration
    pub fn new() -> Self {
        let config = EnhancedBridgeConfig::default();
        Self {
            config: config.clone(),
            multi_sig_validator: multi_sig_validator::MultiSigValidator::new(),
            fraud_proof_integration: fraud_proof_integration::FraudProofIntegration::new(),
            rate_limiter: rate_limiter::RateLimiter::new(),
            delayed_withdrawals: delayed_withdrawals::DelayedWithdrawals::new(),
            liquidity_pool: liquidity_pool::LiquidityPool::new(),
            bridge_monitor: bridge_monitor::BridgeMonitor::new(),
            asset_registry: asset_registry::AssetRegistry::new(),
            bridge_governance: bridge_governance::BridgeGovernance::new(),
            transfers: HashMap::new(),
            next_transfer_id: 1,
            initialized: false,
        }
    }
    
    /// Create a new enhanced bridge system with the specified configuration
    pub fn with_config(config: EnhancedBridgeConfig) -> Self {
        Self {
            config: config.clone(),
            multi_sig_validator: multi_sig_validator::MultiSigValidator::with_config(
                multi_sig_validator::SignatureConfig {
                    min_signatures: config.min_signatures,
                }
            ),
            fraud_proof_integration: fraud_proof_integration::FraudProofIntegration::with_config(
                fraud_proof_integration::FraudProofConfig {
                    withdrawal_challenge_period: config.withdrawal_challenge_period,
                }
            ),
            rate_limiter: rate_limiter::RateLimiter::with_config(
                rate_limiter::RateLimitConfig {
                    max_transactions_per_hour: config.max_transactions_per_hour,
                    max_value_per_hour: config.max_value_per_hour,
                }
            ),
            delayed_withdrawals: delayed_withdrawals::DelayedWithdrawals::with_config(
                delayed_withdrawals::WithdrawalConfig {
                    delay_period: config.withdrawal_delay_period,
                    challenge_period: config.withdrawal_challenge_period,
                }
            ),
            liquidity_pool: liquidity_pool::LiquidityPool::with_config(
                liquidity_pool::PoolConfig {
                    enabled: config.enable_liquidity_pools,
                    instant_withdrawal_fee_bps: config.instant_withdrawal_fee_bps,
                }
            ),
            bridge_monitor: bridge_monitor::BridgeMonitor::with_config(
                bridge_monitor::MonitorConfig {
                    enabled: config.enable_bridge_monitoring,
                }
            ),
            asset_registry: asset_registry::AssetRegistry::new(),
            bridge_governance: bridge_governance::BridgeGovernance::with_config(
                bridge_governance::GovernanceConfig {
                    enabled: config.enable_bridge_governance,
                }
            ),
            transfers: HashMap::new(),
            next_transfer_id: 1,
            initialized: false,
        }
    }
    
    /// Initialize the enhanced bridge system
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        // Initialize each component
        self.multi_sig_validator.initialize(program_id, accounts)?;
        self.fraud_proof_integration.initialize(program_id, accounts)?;
        self.rate_limiter.initialize(program_id, accounts)?;
        self.delayed_withdrawals.initialize(program_id, accounts)?;
        self.liquidity_pool.initialize(program_id, accounts)?;
        self.bridge_monitor.initialize(program_id, accounts)?;
        self.asset_registry.initialize(program_id, accounts)?;
        self.bridge_governance.initialize(program_id, accounts)?;
        
        self.initialized = true;
        
        msg!("Enhanced bridge system initialized");
        
        Ok(())
    }
    
    /// Check if the enhanced bridge system is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Process a deposit (L1 to L2)
    pub fn process_deposit(
        &mut self,
        source: [u8; 32],
        destination: [u8; 32],
        asset_id: u64,
        amount: u64,
        signatures: Vec<([u8; 32], [u8; 64])>,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the asset is registered
        if !self.asset_registry.is_asset_registered(asset_id)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if the asset is enabled
        if !self.asset_registry.is_asset_enabled(asset_id)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Verify signatures
        self.multi_sig_validator.verify_signatures(&signatures, &source, &destination, asset_id, amount)?;
        
        // Check rate limits
        self.rate_limiter.check_limits(&source, amount)?;
        
        // Create the transfer
        let transfer_id = self.next_transfer_id;
        self.next_transfer_id += 1;
        
        let transfer = TransferInfo {
            id: transfer_id,
            source,
            destination,
            asset_id,
            amount,
            direction: TransferDirection::Deposit,
            status: TransferStatus::Pending,
            timestamp: 0, // In a real implementation, we would use the current timestamp
            signatures,
            challenge_id: None,
            completion_timestamp: None,
        };
        
        // Add the transfer
        self.transfers.insert(transfer_id, transfer);
        
        // Update rate limits
        self.rate_limiter.update_limits(&source, amount)?;
        
        // Monitor the transfer
        if self.config.enable_bridge_monitoring {
            self.bridge_monitor.monitor_transfer(transfer_id, &source, &destination, asset_id, amount, TransferDirection::Deposit)?;
        }
        
        msg!("Deposit processed: {}", transfer_id);
        
        Ok(transfer_id)
    }
    
    /// Process a withdrawal (L2 to L1)
    pub fn process_withdrawal(
        &mut self,
        source: [u8; 32],
        destination: [u8; 32],
        asset_id: u64,
        amount: u64,
        signatures: Vec<([u8; 32], [u8; 64])>,
        instant: bool,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the asset is registered
        if !self.asset_registry.is_asset_registered(asset_id)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if the asset is enabled
        if !self.asset_registry.is_asset_enabled(asset_id)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Verify signatures
        self.multi_sig_validator.verify_signatures(&signatures, &source, &destination, asset_id, amount)?;
        
        // Check rate limits
        self.rate_limiter.check_limits(&source, amount)?;
        
        // Create the transfer
        let transfer_id = self.next_transfer_id;
        self.next_transfer_id += 1;
        
        let mut transfer = TransferInfo {
            id: transfer_id,
            source,
            destination,
            asset_id,
            amount,
            direction: TransferDirection::Withdrawal,
            status: TransferStatus::Pending,
            timestamp: 0, // In a real implementation, we would use the current timestamp
            signatures,
            challenge_id: None,
            completion_timestamp: None,
        };
        
        // Handle instant withdrawal if requested
        if instant && self.config.enable_liquidity_pools {
            // Check if the liquidity pool has enough liquidity
            if self.liquidity_pool.has_sufficient_liquidity(asset_id, amount)? {
                // Process the instant withdrawal
                let fee = (amount * self.config.instant_withdrawal_fee_bps as u64) / 10000;
                let net_amount = amount - fee;
                
                // Update the transfer
                transfer.status = TransferStatus::Completed;
                transfer.completion_timestamp = Some(0); // In a real implementation, we would use the current timestamp
                
                // Add the transfer
                self.transfers.insert(transfer_id, transfer);
                
                // Update rate limits
                self.rate_limiter.update_limits(&source, amount)?;
                
                // Monitor the transfer
                if self.config.enable_bridge_monitoring {
                    self.bridge_monitor.monitor_transfer(transfer_id, &source, &destination, asset_id, amount, TransferDirection::Withdrawal)?;
                }
                
                msg!("Instant withdrawal processed: {}, fee: {}", transfer_id, fee);
                
                return Ok(transfer_id);
            } else {
                // Not enough liquidity, fall back to delayed withdrawal
                msg!("Insufficient liquidity for instant withdrawal, falling back to delayed withdrawal");
            }
        }
        
        // Process delayed withdrawal
        // Add the transfer
        self.transfers.insert(transfer_id, transfer.clone());
        
        // Add the withdrawal to the delayed withdrawals
        self.delayed_withdrawals.add_withdrawal(transfer_id, &source, &destination, asset_id, amount)?;
        
        // Update rate limits
        self.rate_limiter.update_limits(&source, amount)?;
        
        // Monitor the transfer
        if self.config.enable_bridge_monitoring {
            self.bridge_monitor.monitor_transfer(transfer_id, &source, &destination, asset_id, amount, TransferDirection::Withdrawal)?;
        }
        
        msg!("Delayed withdrawal processed: {}", transfer_id);
        
        Ok(transfer_id)
    }
    
    /// Challenge a withdrawal
    pub fn challenge_withdrawal(
        &mut self,
        transfer_id: u64,
        challenger: &Pubkey,
        evidence: Vec<u8>,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Get the transfer
        let transfer = self.transfers.get_mut(&transfer_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the transfer is a withdrawal
        if transfer.direction != TransferDirection::Withdrawal {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if the transfer is in the challenge period
        if transfer.status != TransferStatus::InChallengePeriod {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Create a challenge
        let challenge_id = self.fraud_proof_integration.create_challenge(transfer_id, challenger, &evidence)?;
        
        // Update the transfer
        transfer.status = TransferStatus::Challenged;
        transfer.challenge_id = Some(challenge_id);
        
        msg!("Withdrawal challenged: {}, challenge: {}", transfer_id, challenge_id);
        
        Ok(challenge_id)
    }
    
    /// Resolve a challenge
    pub fn resolve_challenge(
        &mut self,
        challenge_id: u64,
        successful: bool,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Resolve the challenge
        let transfer_id = self.fraud_proof_integration.resolve_challenge(challenge_id, successful)?;
        
        // Get the transfer
        let transfer = self.transfers.get_mut(&transfer_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Update the transfer
        if successful {
            // Challenge was successful, reject the withdrawal
            transfer.status = TransferStatus::Rejected;
            
            msg!("Challenge successful, withdrawal rejected: {}", transfer_id);
        } else {
            // Challenge failed, continue with the withdrawal
            transfer.status = TransferStatus::InChallengePeriod;
            transfer.challenge_id = None;
            
            msg!("Challenge failed, withdrawal continues: {}", transfer_id);
        }
        
        Ok(())
    }
    
    /// Complete a withdrawal
    pub fn complete_withdrawal(
        &mut self,
        transfer_id: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if the withdrawal is ready to be completed
        if !self.delayed_withdrawals.is_withdrawal_ready(transfer_id)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Get the transfer
        let transfer = self.transfers.get_mut(&transfer_id)
            .ok_or(ProgramError::InvalidArgument)?;
        
        // Check if the transfer is a withdrawal
        if transfer.direction != TransferDirection::Withdrawal {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if the transfer is in the challenge period
        if transfer.status != TransferStatus::InChallengePeriod {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Complete the withdrawal
        self.delayed_withdrawals.complete_withdrawal(transfer_id)?;
        
        // Update the transfer
        transfer.status = TransferStatus::Completed;
        transfer.completion_timestamp = Some(0); // In a real implementation, we would use the current timestamp
        
        msg!("Withdrawal completed: {}", transfer_id);
        
        Ok(())
    }
    
    /// Register an asset
    pub fn register_asset(
        &mut self,
        asset_name: String,
        asset_symbol: String,
        decimals: u8,
        l1_address: [u8; 32],
        l2_address: [u8; 32],
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Register the asset
        let asset_id = self.asset_registry.register_asset(asset_name, asset_symbol, decimals, l1_address, l2_address)?;
        
        msg!("Asset registered: {}", asset_id);
        
        Ok(asset_id)
    }
    
    /// Add a validator
    pub fn add_validator(
        &mut self,
        validator: Pubkey,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Add the validator
        self.multi_sig_validator.add_validator(validator)?;
        
        msg!("Validator added: {:?}", validator);
        
        Ok(())
    }
    
    /// Remove a validator
    pub fn remove_validator(
        &mut self,
        validator: &Pubkey,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Remove the validator
        self.multi_sig_validator.remove_validator(validator)?;
        
        msg!("Validator removed: {:?}", validator);
        
        Ok(())
    }
    
    /// Add liquidity to the pool
    pub fn add_liquidity(
        &mut self,
        provider: &Pubkey,
        asset_id: u64,
        amount: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if liquidity pools are enabled
        if !self.config.enable_liquidity_pools {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Add liquidity
        self.liquidity_pool.add_liquidity(provider, asset_id, amount)?;
        
        msg!("Liquidity added: provider: {:?}, asset: {}, amount: {}", provider, asset_id, amount);
        
        Ok(())
    }
    
    /// Remove liquidity from the pool
    pub fn remove_liquidity(
        &mut self,
        provider: &Pubkey,
        asset_id: u64,
        amount: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if liquidity pools are enabled
        if !self.config.enable_liquidity_pools {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Remove liquidity
        self.liquidity_pool.remove_liquidity(provider, asset_id, amount)?;
        
        msg!("Liquidity removed: provider: {:?}, asset: {}, amount: {}", provider, asset_id, amount);
        
        Ok(())
    }
    
    /// Create a governance proposal
    pub fn create_proposal(
        &mut self,
        proposer: &Pubkey,
        proposal_type: bridge_governance::ProposalType,
        description: String,
        params: Vec<u8>,
    ) -> Result<u64, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if bridge governance is enabled
        if !self.config.enable_bridge_governance {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Create the proposal
        let proposal_id = self.bridge_governance.create_proposal(proposer, proposal_type, description, params)?;
        
        msg!("Proposal created: {}", proposal_id);
        
        Ok(proposal_id)
    }
    
    /// Vote on a governance proposal
    pub fn vote_on_proposal(
        &mut self,
        voter: &Pubkey,
        proposal_id: u64,
        approve: bool,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if bridge governance is enabled
        if !self.config.enable_bridge_governance {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Vote on the proposal
        self.bridge_governance.vote(voter, proposal_id, approve)?;
        
        msg!("Vote cast: voter: {:?}, proposal: {}, approve: {}", voter, proposal_id, approve);
        
        Ok(())
    }
    
    /// Execute a governance proposal
    pub fn execute_proposal(
        &mut self,
        proposal_id: u64,
    ) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Check if bridge governance is enabled
        if !self.config.enable_bridge_governance {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if the proposal can be executed
        if !self.bridge_governance.can_execute(proposal_id)? {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Get the proposal
        let proposal = self.bridge_governance.get_proposal(proposal_id)?;
        
        // Execute the proposal based on its type
        match proposal.proposal_type {
            bridge_governance::ProposalType::UpdateConfig => {
                // In a real implementation, we would deserialize the params and update the config
                msg!("Executing config update proposal");
            },
            bridge_governance::ProposalType::AddValidator => {
                // In a real implementation, we would deserialize the params and add the validator
                msg!("Executing add validator proposal");
            },
            bridge_governance::ProposalType::RemoveValidator => {
                // In a real implementation, we would deserialize the params and remove the validator
                msg!("Executing remove validator proposal");
            },
            bridge_governance::ProposalType::RegisterAsset => {
                // In a real implementation, we would deserialize the params and register the asset
                msg!("Executing register asset proposal");
            },
            bridge_governance::ProposalType::UpdateAsset => {
                // In a real implementation, we would deserialize the params and update the asset
                msg!("Executing update asset proposal");
            },
            bridge_governance::ProposalType::Other(ref description) => {
                msg!("Executing other proposal: {}", description);
            },
        }
        
        // Mark the proposal as executed
        self.bridge_governance.execute_proposal(proposal_id)?;
        
        msg!("Proposal executed: {}", proposal_id);
        
        Ok(())
    }
    
    /// Update the enhanced bridge system configuration
    pub fn update_config(&mut self, config: EnhancedBridgeConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Update the configuration
        self.config = config.clone();
        
        // Update each component's configuration
        self.multi_sig_validator.update_config(
            multi_sig_validator::SignatureConfig {
                min_signatures: config.min_signatures,
            }
        )?;
        
        self.fraud_proof_integration.update_config(
            fraud_proof_integration::FraudProofConfig {
                withdrawal_challenge_period: config.withdrawal_challenge_period,
            }
        )?;
        
        self.rate_limiter.update_config(
            rate_limiter::RateLimitConfig {
                max_transactions_per_hour: config.max_transactions_per_hour,
                max_value_per_hour: config.max_value_per_hour,
            }
        )?;
        
        self.delayed_withdrawals.update_config(
            delayed_withdrawals::WithdrawalConfig {
                delay_period: config.withdrawal_delay_period,
                challenge_period: config.withdrawal_challenge_period,
            }
        )?;
        
        self.liquidity_pool.update_config(
            liquidity_pool::PoolConfig {
                enabled: config.enable_liquidity_pools,
                instant_withdrawal_fee_bps: config.instant_withdrawal_fee_bps,
            }
        )?;
        
        self.bridge_monitor.update_config(
            bridge_monitor::MonitorConfig {
                enabled: config.enable_bridge_monitoring,
            }
        )?;
        
        self.bridge_governance.update_config(
            bridge_governance::GovernanceConfig {
                enabled: config.enable_bridge_governance,
            }
        )?;
        
        msg!("Enhanced bridge system configuration updated");
        
        Ok(())
    }
    
    /// Get a transfer
    pub fn get_transfer(&self, transfer_id: u64) -> Option<&TransferInfo> {
        if !self.initialized {
            return None;
        }
        
        self.transfers.get(&transfer_id)
    }
    
    /// Get all transfers
    pub fn get_all_transfers(&self) -> &HashMap<u64, TransferInfo> {
        &self.transfers
    }
    
    /// Get the multi-signature validator
    pub fn get_multi_sig_validator(&self) -> &multi_sig_validator::MultiSigValidator {
        &self.multi_sig_validator
    }
    
    /// Get the fraud proof integration
    pub fn get_fraud_proof_integration(&self) -> &fraud_proof_integration::FraudProofIntegration {
        &self.fraud_proof_integration
    }
    
    /// Get the rate limiter
    pub fn get_rate_limiter(&self) -> &rate_limiter::RateLimiter {
        &self.rate_limiter
    }
    
    /// Get the delayed withdrawals
    pub fn get_delayed_withdrawals(&self) -> &delayed_withdrawals::DelayedWithdrawals {
        &self.delayed_withdrawals
    }
    
    /// Get the liquidity pool
    pub fn get_liquidity_pool(&self) -> &liquidity_pool::LiquidityPool {
        &self.liquidity_pool
    }
    
    /// Get the bridge monitor
    pub fn get_bridge_monitor(&self) -> &bridge_monitor::BridgeMonitor {
        &self.bridge_monitor
    }
    
    /// Get the asset registry
    pub fn get_asset_registry(&self) -> &asset_registry::AssetRegistry {
        &self.asset_registry
    }
    
    /// Get the bridge governance
    pub fn get_bridge_governance(&self) -> &bridge_governance::BridgeGovernance {
        &self.bridge_governance
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_enhanced_bridge_system_creation() {
        let system = EnhancedBridgeSystem::new();
        assert!(!system.is_initialized());
    }
    
    #[test]
    fn test_enhanced_bridge_system_with_config() {
        let config = EnhancedBridgeConfig::default();
        let system = EnhancedBridgeSystem::with_config(config);
        assert!(!system.is_initialized());
    }
}
