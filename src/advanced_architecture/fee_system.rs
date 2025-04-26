// src/advanced_architecture/fee_system.rs
//! Fee System module for Layer-2 on Solana
//! 
//! This module implements a modular fee system with different fee types:
//! - Base fees (gas)
//! - Bridge fees (deposit/withdraw)
//! - DeFi fees (trading, lending)
//! - Protocol fees (governance, staking)
//!
//! The fee system is designed to be flexible and configurable via governance,
//! allowing for adjustments without requiring protocol upgrades.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;
use thiserror::Error;

/// Errors that may occur during fee system operations
#[derive(Error, Debug, Clone, PartialEq, Eq)]
pub enum FeeSystemError {
    /// Fee system is not initialized
    #[error("Fee system is not initialized")]
    NotInitialized,
    
    /// Invalid fee type
    #[error("Invalid fee type: {0}")]
    InvalidFeeType(String),
    
    /// Invalid fee parameters
    #[error("Invalid fee parameters: {0}")]
    InvalidFeeParameters(String),
    
    /// Invalid fee distribution
    #[error("Invalid fee distribution: {0}")]
    InvalidFeeDistribution(String),
    
    /// Fee calculation error
    #[error("Fee calculation error: {0}")]
    FeeCalculationError(String),
    
    /// Fee distribution error
    #[error("Fee distribution error: {0}")]
    FeeDistributionError(String),
    
    /// Insufficient funds for fee payment
    #[error("Insufficient funds for fee payment: {0}")]
    InsufficientFunds(String),
    
    /// Missing fee recipient
    #[error("Missing fee recipient: {0}")]
    MissingFeeRecipient(String),
    
    /// Unauthorized operation
    #[error("Unauthorized operation: {0}")]
    Unauthorized(String),
    
    /// Generic error
    #[error("Generic error: {0}")]
    GenericError(String),
}

impl From<ProgramError> for FeeSystemError {
    fn from(error: ProgramError) -> Self {
        FeeSystemError::GenericError(error.to_string())
    }
}

/// Fee type enumeration
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq, Eq, Hash)]
pub enum FeeType {
    /// Base fee for transaction execution (gas)
    BaseFee,
    
    /// Bridge fee for deposit operations
    BridgeDepositFee,
    
    /// Bridge fee for withdrawal operations
    BridgeWithdrawFee,
    
    /// Trading fee for DEX/AMM operations
    TradingFee,
    
    /// Lending fee for borrowing operations
    LendingFee,
    
    /// Liquidation fee for liquidation operations
    LiquidationFee,
    
    /// Protocol fee for governance operations
    GovernanceFee,
    
    /// Staking fee for staking operations
    StakingFee,
    
    /// Custom fee type
    Custom(String),
}

/// Fee parameters for a specific fee type
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct FeeParameters {
    /// Base fee rate (in basis points, 1/100 of a percent)
    pub base_rate: u32,
    
    /// Minimum fee amount
    pub min_amount: u64,
    
    /// Maximum fee amount
    pub max_amount: u64,
    
    /// Dynamic fee adjustment factor
    pub dynamic_factor: u32,
    
    /// Fee cap
    pub cap: u64,
    
    /// Whether the fee is active
    pub is_active: bool,
}

impl Default for FeeParameters {
    fn default() -> Self {
        Self {
            base_rate: 30, // 0.3%
            min_amount: 1_000, // 0.00001 SOL (assuming 8 decimals)
            max_amount: 1_000_000_000, // 10 SOL (assuming 8 decimals)
            dynamic_factor: 100, // 1x
            cap: 1_000_000_000, // 10 SOL (assuming 8 decimals)
            is_active: true,
        }
    }
}

/// Fee distribution configuration
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct FeeDistribution {
    /// Percentage allocated to sequencers (in basis points)
    pub sequencer_percentage: u32,
    
    /// Percentage allocated to validators (in basis points)
    pub validator_percentage: u32,
    
    /// Percentage allocated to the treasury (in basis points)
    pub treasury_percentage: u32,
    
    /// Percentage allocated to the insurance fund (in basis points)
    pub insurance_percentage: u32,
    
    /// Percentage allocated to stakers (in basis points)
    pub staker_percentage: u32,
    
    /// Percentage allocated to liquidity providers (in basis points)
    pub lp_percentage: u32,
}

impl Default for FeeDistribution {
    fn default() -> Self {
        Self {
            sequencer_percentage: 2000, // 20%
            validator_percentage: 2000, // 20%
            treasury_percentage: 2000, // 20%
            insurance_percentage: 1000, // 10%
            staker_percentage: 2000, // 20%
            lp_percentage: 1000, // 10%
        }
    }
}

impl FeeDistribution {
    /// Validate that the distribution percentages sum to 10000 (100%)
    pub fn validate(&self) -> Result<(), FeeSystemError> {
        let total = self.sequencer_percentage + 
                    self.validator_percentage + 
                    self.treasury_percentage + 
                    self.insurance_percentage + 
                    self.staker_percentage + 
                    self.lp_percentage;
        
        if total != 10000 {
            return Err(FeeSystemError::InvalidFeeDistribution(
                format!("Fee distribution percentages must sum to 10000 (100%), got {}", total)
            ));
        }
        
        Ok(())
    }
}

/// Fee system configuration
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct FeeSystemConfig {
    /// Fee parameters for each fee type
    pub fee_parameters: HashMap<FeeType, FeeParameters>,
    
    /// Fee distribution configuration
    pub fee_distribution: FeeDistribution,
    
    /// EIP-1559 style dynamic fee adjustment
    pub dynamic_fee_adjustment: bool,
    
    /// Base fee adjustment factor (in basis points)
    pub base_fee_adjustment_factor: u32,
    
    /// Maximum base fee change per block (in basis points)
    pub max_base_fee_change: u32,
    
    /// Target block utilization (in basis points)
    pub target_block_utilization: u32,
}

impl Default for FeeSystemConfig {
    fn default() -> Self {
        let mut fee_parameters = HashMap::new();
        
        // Add default fee parameters for each fee type
        fee_parameters.insert(FeeType::BaseFee, FeeParameters::default());
        fee_parameters.insert(FeeType::BridgeDepositFee, FeeParameters {
            base_rate: 50, // 0.5%
            min_amount: 10_000, // 0.0001 SOL
            max_amount: 10_000_000_000, // 100 SOL
            dynamic_factor: 100, // 1x
            cap: 10_000_000_000, // 100 SOL
            is_active: true,
        });
        fee_parameters.insert(FeeType::BridgeWithdrawFee, FeeParameters {
            base_rate: 100, // 1%
            min_amount: 100_000, // 0.001 SOL
            max_amount: 20_000_000_000, // 200 SOL
            dynamic_factor: 100, // 1x
            cap: 20_000_000_000, // 200 SOL
            is_active: true,
        });
        fee_parameters.insert(FeeType::TradingFee, FeeParameters {
            base_rate: 30, // 0.3%
            min_amount: 1_000, // 0.00001 SOL
            max_amount: 5_000_000_000, // 50 SOL
            dynamic_factor: 100, // 1x
            cap: 5_000_000_000, // 50 SOL
            is_active: true,
        });
        fee_parameters.insert(FeeType::LendingFee, FeeParameters {
            base_rate: 10, // 0.1%
            min_amount: 1_000, // 0.00001 SOL
            max_amount: 1_000_000_000, // 10 SOL
            dynamic_factor: 100, // 1x
            cap: 1_000_000_000, // 10 SOL
            is_active: true,
        });
        fee_parameters.insert(FeeType::LiquidationFee, FeeParameters {
            base_rate: 50, // 0.5%
            min_amount: 10_000, // 0.0001 SOL
            max_amount: 5_000_000_000, // 50 SOL
            dynamic_factor: 100, // 1x
            cap: 5_000_000_000, // 50 SOL
            is_active: true,
        });
        fee_parameters.insert(FeeType::GovernanceFee, FeeParameters {
            base_rate: 0, // 0%
            min_amount: 0, // 0 SOL
            max_amount: 0, // 0 SOL
            dynamic_factor: 100, // 1x
            cap: 0, // 0 SOL
            is_active: false,
        });
        fee_parameters.insert(FeeType::StakingFee, FeeParameters {
            base_rate: 5, // 0.05%
            min_amount: 1_000, // 0.00001 SOL
            max_amount: 1_000_000_000, // 10 SOL
            dynamic_factor: 100, // 1x
            cap: 1_000_000_000, // 10 SOL
            is_active: true,
        });
        
        Self {
            fee_parameters,
            fee_distribution: FeeDistribution::default(),
            dynamic_fee_adjustment: true,
            base_fee_adjustment_factor: 125, // 1.25x
            max_base_fee_change: 1250, // 12.5%
            target_block_utilization: 8000, // 80%
        }
    }
}

impl FeeSystemConfig {
    /// Validate the fee system configuration
    pub fn validate(&self) -> Result<(), FeeSystemError> {
        // Validate fee distribution
        self.fee_distribution.validate()?;
        
        // Validate fee parameters
        for (fee_type, params) in &self.fee_parameters {
            if params.min_amount > params.max_amount {
                return Err(FeeSystemError::InvalidFeeParameters(
                    format!("Min amount ({}) greater than max amount ({}) for fee type {:?}", 
                            params.min_amount, params.max_amount, fee_type)
                ));
            }
            
            if params.cap < params.min_amount || params.cap > params.max_amount {
                return Err(FeeSystemError::InvalidFeeParameters(
                    format!("Cap ({}) outside of min-max range ({}-{}) for fee type {:?}", 
                            params.cap, params.min_amount, params.max_amount, fee_type)
                ));
            }
            
            if params.dynamic_factor == 0 {
                return Err(FeeSystemError::InvalidFeeParameters(
                    format!("Dynamic factor cannot be zero for fee type {:?}", fee_type)
                ));
            }
        }
        
        // Validate dynamic fee adjustment parameters
        if self.dynamic_fee_adjustment {
            if self.base_fee_adjustment_factor == 0 {
                return Err(FeeSystemError::InvalidFeeParameters(
                    "Base fee adjustment factor cannot be zero".to_string()
                ));
            }
            
            if self.target_block_utilization == 0 || self.target_block_utilization > 10000 {
                return Err(FeeSystemError::InvalidFeeParameters(
                    format!("Target block utilization must be between 1 and 10000, got {}", 
                            self.target_block_utilization)
                ));
            }
        }
        
        Ok(())
    }
}

/// Fee calculation result
#[derive(Debug, Clone)]
pub struct FeeCalculationResult {
    /// Fee type
    pub fee_type: FeeType,
    
    /// Fee amount
    pub amount: u64,
    
    /// Fee payer
    pub payer: Pubkey,
    
    /// Fee recipient
    pub recipient: Pubkey,
    
    /// Whether the fee has been paid
    pub is_paid: bool,
}

/// Fee system for the Layer-2 solution
pub struct FeeSystem {
    /// Fee system configuration
    config: FeeSystemConfig,
    
    /// Current base fee
    current_base_fee: u64,
    
    /// Block utilization (in basis points)
    block_utilization: u32,
    
    /// Collected fees
    collected_fees: HashMap<FeeType, u64>,
    
    /// Fee recipients
    fee_recipients: HashMap<String, Pubkey>,
    
    /// Whether the fee system is initialized
    initialized: bool,
}

impl FeeSystem {
    /// Create a new fee system with default configuration
    pub fn new() -> Self {
        Self {
            config: FeeSystemConfig::default(),
            current_base_fee: 1_000_000, // 0.01 SOL (assuming 8 decimals)
            block_utilization: 0,
            collected_fees: HashMap::new(),
            fee_recipients: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Create a new fee system with the specified configuration
    pub fn with_config(config: FeeSystemConfig) -> Self {
        Self {
            config,
            current_base_fee: 1_000_000, // 0.01 SOL (assuming 8 decimals)
            block_utilization: 0,
            collected_fees: HashMap::new(),
            fee_recipients: HashMap::new(),
            initialized: false,
        }
    }
    
    /// Initialize the fee system
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        // Get the treasury account
        let treasury_account = next_account_info(account_info_iter)?;
        
        // Get the insurance fund account
        let insurance_account = next_account_info(account_info_iter)?;
        
        // Get the sequencer account
        let sequencer_account = next_account_info(account_info_iter)?;
        
        // Get the validator account
        let validator_account = next_account_info(account_info_iter)?;
        
        // Get the staker account
        let staker_account = next_account_info(account_info_iter)?;
        
        // Get the liquidity provider account
        let lp_account = next_account_info(account_info_iter)?;
        
        // Initialize fee recipients
        self.fee_recipients.insert("treasury".to_string(), *treasury_account.key);
        self.fee_recipients.insert("insurance".to_string(), *insurance_account.key);
        self.fee_recipients.insert("sequencer".to_string(), *sequencer_account.key);
        self.fee_recipients.insert("validator".to_string(), *validator_account.key);
        self.fee_recipients.insert("staker".to_string(), *staker_account.key);
        self.fee_recipients.insert("lp".to_string(), *lp_account.key);
        
        // Initialize collected fees
        for fee_type in self.config.fee_parameters.keys() {
            self.collected_fees.insert(fee_type.clone(), 0);
        }
        
        // Validate the configuration
        self.config.validate().map_err(|e| {
            msg!("Fee system configuration validation failed: {}", e);
            ProgramError::InvalidArgument
        })?;
        
        self.initialized = true;
        
        msg!("Fee system initialized");
        
        Ok(())
    }
    
    /// Check if the fee system is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Calculate fees for a transaction
    pub fn calculate_fees(&self, transaction_data: &[u8]) -> Result<Vec<FeeCalculationResult>, FeeSystemError> {
        if !self.initialized {
            return Err(FeeSystemError::NotInitialized);
        }
        
        // Parse the transaction to determine the fee types and amounts
        // This is a simplified implementation; in a real system, we would parse the transaction
        // to determine the operations and calculate the fees accordingly
        
        // For now, we'll just calculate a base fee
        let base_fee_params = self.config.fee_parameters.get(&FeeType::BaseFee)
            .ok_or_else(|| FeeSystemError::InvalidFeeType("Base fee not configured".to_string()))?;
        
        if !base_fee_params.is_active {
            return Ok(vec![]);
        }
        
        // Calculate the base fee
        let base_fee_amount = self.calculate_base_fee(transaction_data.len() as u64, base_fee_params);
        
        // Get the treasury recipient
        let treasury_recipient = self.fee_recipients.get("treasury")
            .ok_or_else(|| FeeSystemError::MissingFeeRecipient("Treasury recipient not configured".to_string()))?;
        
        // Create a fee calculation result
        let fee_result = FeeCalculationResult {
            fee_type: FeeType::BaseFee,
            amount: base_fee_amount,
            payer: Pubkey::new_unique(), // This would be the transaction signer in a real system
            recipient: *treasury_recipient,
            is_paid: false,
        };
        
        Ok(vec![fee_result])
    }
    
    /// Calculate the base fee for a transaction
    fn calculate_base_fee(&self, transaction_size: u64, fee_params: &FeeParameters) -> u64 {
        // Calculate the base fee based on the transaction size and the current base fee
        let base_fee = (transaction_size * self.current_base_fee * fee_params.base_rate as u64) / 10_000;
        
        // Apply the dynamic factor
        let dynamic_fee = (base_fee * fee_params.dynamic_factor as u64) / 100;
        
        // Apply the min/max constraints
        let fee = dynamic_fee.max(fee_params.min_amount).min(fee_params.max_amount);
        
        // Apply the cap
        fee.min(fee_params.cap)
    }
    
    /// Distribute fees according to the fee distribution rules
    pub fn distribute_fees(&mut self, fees: &[FeeCalculationResult]) -> Result<(), FeeSystemError> {
        if !self.initialized {
            return Err(FeeSystemError::NotInitialized);
        }
        
        for fee in fees {
            // Update collected fees
            if let Some(collected) = self.collected_fees.get_mut(&fee.fee_type) {
                *collected += fee.amount;
            } else {
                return Err(FeeSystemError::InvalidFeeType(
                    format!("Fee type {:?} not configured", fee.fee_type)
                ));
            }
            
            // In a real system, we would transfer the fee to the recipients according to the distribution rules
            // For now, we'll just log the distribution
            
            msg!("Distributing fee: {:?}, amount: {}", fee.fee_type, fee.amount);
            
            // Calculate the distribution
            let sequencer_amount = (fee.amount * self.config.fee_distribution.sequencer_percentage as u64) / 10_000;
            let validator_amount = (fee.amount * self.config.fee_distribution.validator_percentage as u64) / 10_000;
            let treasury_amount = (fee.amount * self.config.fee_distribution.treasury_percentage as u64) / 10_000;
            let insurance_amount = (fee.amount * self.config.fee_distribution.insurance_percentage as u64) / 10_000;
            let staker_amount = (fee.amount * self.config.fee_distribution.staker_percentage as u64) / 10_000;
            let lp_amount = (fee.amount * self.config.fee_distribution.lp_percentage as u64) / 10_000;
            
            // Verify that the distribution sums to the fee amount
            let total_distributed = sequencer_amount + validator_amount + treasury_amount + 
                                   insurance_amount + staker_amount + lp_amount;
            
            // There might be a small rounding error due to integer division
            let rounding_error = fee.amount.saturating_sub(total_distributed);
            if rounding_error > 1 {
                return Err(FeeSystemError::FeeDistributionError(
                    format!("Distribution sum ({}) does not match fee amount ({}), difference: {}", 
                            total_distributed, fee.amount, rounding_error)
                ));
            }
            
            msg!("Sequencer: {}", sequencer_amount);
            msg!("Validator: {}", validator_amount);
            msg!("Treasury: {}", treasury_amount);
            msg!("Insurance: {}", insurance_amount);
            msg!("Staker: {}", staker_amount);
            msg!("LP: {}", lp_amount);
        }
        
        Ok(())
    }
    
    /// Update the fee system configuration
    pub fn update_config(&mut self, config: FeeSystemConfig) -> Result<(), FeeSystemError> {
        if !self.initialized {
            return Err(FeeSystemError::NotInitialized);
        }
        
        // Validate the new configuration
        config.validate()?;
        
        // Update the configuration
        self.config = config;
        
        // Update collected fees
        for fee_type in self.config.fee_parameters.keys() {
            if !self.collected_fees.contains_key(fee_type) {
                self.collected_fees.insert(fee_type.clone(), 0);
            }
        }
        
        msg!("Fee system configuration updated");
        
        Ok(())
    }
    
    /// Update the base fee based on block utilization
    pub fn update_base_fee(&mut self, block_utilization: u32) -> Result<(), FeeSystemError> {
        if !self.initialized {
            return Err(FeeSystemError::NotInitialized);
        }
        
        // Ensure block utilization is within valid range
        if block_utilization > 10000 {
            return Err(FeeSystemError::InvalidFeeParameters(
                format!("Block utilization must be between 0 and 10000, got {}", block_utilization)
            ));
        }
        
        // Update block utilization
        self.block_utilization = block_utilization;
        
        // If dynamic fee adjustment is enabled, adjust the base fee
        if self.config.dynamic_fee_adjustment {
            // Calculate the adjustment factor
            let adjustment_factor = if block_utilization > self.config.target_block_utilization {
                // Block is over-utilized, increase the base fee
                self.config.base_fee_adjustment_factor
            } else {
                // Block is under-utilized, decrease the base fee
                10000 / self.config.base_fee_adjustment_factor
            };
            
            // Calculate the new base fee
            let new_base_fee = (self.current_base_fee * adjustment_factor as u64) / 10000;
            
            // Calculate the maximum change
            let max_increase = (self.current_base_fee * self.config.max_base_fee_change as u64) / 10000;
            let max_decrease = (self.current_base_fee * self.config.max_base_fee_change as u64) / 10000;
            
            // Apply the maximum change constraint
            if new_base_fee > self.current_base_fee {
                self.current_base_fee = (self.current_base_fee + max_increase).min(new_base_fee);
            } else {
                self.current_base_fee = (self.current_base_fee - max_decrease).max(new_base_fee);
            }
            
            msg!("Base fee updated to {}", self.current_base_fee);
        }
        
        Ok(())
    }
    
    /// Get the current base fee
    pub fn get_current_base_fee(&self) -> u64 {
        self.current_base_fee
    }
    
    /// Get the collected fees for a specific fee type
    pub fn get_collected_fees(&self, fee_type: &FeeType) -> Result<u64, FeeSystemError> {
        if !self.initialized {
            return Err(FeeSystemError::NotInitialized);
        }
        
        self.collected_fees.get(fee_type)
            .copied()
            .ok_or_else(|| FeeSystemError::InvalidFeeType(format!("Fee type {:?} not configured", fee_type)))
    }
    
    /// Get the total collected fees
    pub fn get_total_collected_fees(&self) -> Result<u64, FeeSystemError> {
        if !self.initialized {
            return Err(FeeSystemError::NotInitialized);
        }
        
        Ok(self.collected_fees.values().sum())
    }
    
    /// Get the fee parameters for a specific fee type
    pub fn get_fee_parameters(&self, fee_type: &FeeType) -> Result<&FeeParameters, FeeSystemError> {
        if !self.initialized {
            return Err(FeeSystemError::NotInitialized);
        }
        
        self.config.fee_parameters.get(fee_type)
            .ok_or_else(|| FeeSystemError::InvalidFeeType(format!("Fee type {:?} not configured", fee_type)))
    }
    
    /// Set the fee parameters for a specific fee type
    pub fn set_fee_parameters(&mut self, fee_type: FeeType, parameters: FeeParameters) -> Result<(), FeeSystemError> {
        if !self.initialized {
            return Err(FeeSystemError::NotInitialized);
        }
        
        // Validate the parameters
        if parameters.min_amount > parameters.max_amount {
            return Err(FeeSystemError::InvalidFeeParameters(
                format!("Min amount ({}) greater than max amount ({}) for fee type {:?}", 
                        parameters.min_amount, parameters.max_amount, fee_type)
            ));
        }
        
        if parameters.cap < parameters.min_amount || parameters.cap > parameters.max_amount {
            return Err(FeeSystemError::InvalidFeeParameters(
                format!("Cap ({}) outside of min-max range ({}-{}) for fee type {:?}", 
                        parameters.cap, parameters.min_amount, parameters.max_amount, fee_type)
            ));
        }
        
        if parameters.dynamic_factor == 0 {
            return Err(FeeSystemError::InvalidFeeParameters(
                format!("Dynamic factor cannot be zero for fee type {:?}", fee_type)
            ));
        }
        
        // Update the parameters
        self.config.fee_parameters.insert(fee_type.clone(), parameters);
        
        // Ensure the fee type is in the collected fees map
        if !self.collected_fees.contains_key(&fee_type) {
            self.collected_fees.insert(fee_type.clone(), 0);
        }
        
        msg!("Fee parameters updated for fee type {:?}", fee_type);
        
        Ok(())
    }
    
    /// Set the fee distribution
    pub fn set_fee_distribution(&mut self, distribution: FeeDistribution) -> Result<(), FeeSystemError> {
        if !self.initialized {
            return Err(FeeSystemError::NotInitialized);
        }
        
        // Validate the distribution
        distribution.validate()?;
        
        // Update the distribution
        self.config.fee_distribution = distribution;
        
        msg!("Fee distribution updated");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_fee_distribution_validation() {
        // Valid distribution
        let valid_distribution = FeeDistribution::default();
        assert!(valid_distribution.validate().is_ok());
        
        // Invalid distribution (sum != 10000)
        let invalid_distribution = FeeDistribution {
            sequencer_percentage: 2000,
            validator_percentage: 2000,
            treasury_percentage: 2000,
            insurance_percentage: 1000,
            staker_percentage: 2000,
            lp_percentage: 500, // Only 9500 total
        };
        assert!(invalid_distribution.validate().is_err());
    }
    
    #[test]
    fn test_fee_system_config_validation() {
        // Valid configuration
        let valid_config = FeeSystemConfig::default();
        assert!(valid_config.validate().is_ok());
        
        // Invalid configuration (min > max)
        let mut invalid_config = FeeSystemConfig::default();
        let mut invalid_params = FeeParameters::default();
        invalid_params.min_amount = 2_000_000_000;
        invalid_params.max_amount = 1_000_000_000;
        invalid_config.fee_parameters.insert(FeeType::BaseFee, invalid_params);
        assert!(invalid_config.validate().is_err());
        
        // Invalid configuration (cap outside range)
        let mut invalid_config = FeeSystemConfig::default();
        let mut invalid_params = FeeParameters::default();
        invalid_params.min_amount = 1_000_000;
        invalid_params.max_amount = 5_000_000;
        invalid_params.cap = 10_000_000;
        invalid_config.fee_parameters.insert(FeeType::BaseFee, invalid_params);
        assert!(invalid_config.validate().is_err());
        
        // Invalid configuration (dynamic factor = 0)
        let mut invalid_config = FeeSystemConfig::default();
        let mut invalid_params = FeeParameters::default();
        invalid_params.dynamic_factor = 0;
        invalid_config.fee_parameters.insert(FeeType::BaseFee, invalid_params);
        assert!(invalid_config.validate().is_err());
        
        // Invalid configuration (target block utilization > 10000)
        let mut invalid_config = FeeSystemConfig::default();
        invalid_config.target_block_utilization = 12000;
        assert!(invalid_config.validate().is_err());
    }
    
    #[test]
    fn test_calculate_base_fee() {
        let fee_system = FeeSystem::new();
        let fee_params = FeeParameters::default();
        
        // Test with different transaction sizes
        let small_tx_size = 100;
        let medium_tx_size = 1000;
        let large_tx_size = 10000;
        
        let small_fee = fee_system.calculate_base_fee(small_tx_size, &fee_params);
        let medium_fee = fee_system.calculate_base_fee(medium_tx_size, &fee_params);
        let large_fee = fee_system.calculate_base_fee(large_tx_size, &fee_params);
        
        // Verify that fees scale with transaction size
        assert!(small_fee <= medium_fee);
        assert!(medium_fee <= large_fee);
        
        // Verify that fees are within the min/max range
        assert!(small_fee >= fee_params.min_amount);
        assert!(large_fee <= fee_params.max_amount);
        
        // Verify that fees are capped
        assert!(small_fee <= fee_params.cap);
        assert!(medium_fee <= fee_params.cap);
        assert!(large_fee <= fee_params.cap);
    }
}
