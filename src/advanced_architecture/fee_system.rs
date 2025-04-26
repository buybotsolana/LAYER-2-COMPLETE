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
        
        self.initialized = true;
        
        msg!("Fee system initialized");
        
        Ok(())
    }
    
    /// Check if the fee system is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Calculate fees for a transaction
    pub fn calculate_fees(&self, transaction_data: &[u8]) -> Result<Vec<FeeCalculationResult>, ProgramError> {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        // Parse the transaction to determine the fee types and amounts
        // This is a simplified implementation; in a real system, we would parse the transaction
        // to determine the operations and calculate the fees accordingly
        
        // For now, we'll just calculate a base fee
        let base_fee_params = self.config.fee_parameters.get(&FeeType::BaseFee)
            .ok_or(ProgramError::InvalidArgument)?;
        
        if !base_fee_params.is_active {
            return Ok(vec![]);
        }
        
        // Calculate the base fee
        let base_fee_amount = self.calculate_base_fee(transaction_data.len() as u64, base_fee_params);
        
        // Create a fee calculation result
        let fee_result = FeeCalculationResult {
            fee_type: FeeType::BaseFee,
            amount: base_fee_amount,
            payer: Pubkey::new_unique(), // This would be the transaction signer in a real system
            recipient: *self.fee_recipients.get("treasury").unwrap_or(&Pubkey::new_unique()),
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
    pub fn distribute_fees(&mut self, fees: &[FeeCalculationResult]) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
        for fee in fees {
            // Update collected fees
            if let Some(collected) = self.collected_fees.get_mut(&fee.fee_type) {
                *collected += fee.amount;
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
    pub fn update_config(&mut self, config: FeeSystemConfig) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
        }
        
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
    pub fn update_base_fee(&mut self, block_utilization: u32) -> ProgramResult {
        if !self.initialized {
            return Err(ProgramError::UninitializedAccount);
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
                10_000 / self.config.base_fee_adjustment_factor
            };
            
            // Calculate the new base fee
            let new_base_fee = (self.current_base_fee * adjustment_factor as u64) / 10_000;
            
            // Calculate the maximum change
            let max_increase = (self.current_base_fee * self.config.max_base_fee_change as u64) / 10_000;
            let max_decrease = (self.current_base_fee * self.config.max_base_fee_change as u64) / 10_000;
            
            // Apply the maximum change constraint
            if new_base_fee > self.current_base_fee {
                self.current_base_fee = (self.current_base_fee + max_increase).min(new_base_fee);
            } else {
                self.current_base_fee = (self.current_base_fee - max_decrease).max(new_base_fee);
            }
            
            msg!("Base fee updated: {}", self.current_base_fee);
        }
        
        Ok(())
    }
    
    /// Get the current base fee
    pub fn get_current_base_fee(&self) -> u64 {
        self.current_base_fee
    }
    
    /// Get the collected fees
    pub fn get_collected_fees(&self) -> &HashMap<FeeType, u64> {
        &self.collected_fees
    }
    
    /// Get the fee recipients
    pub fn get_fee_recipients(&self) -> &HashMap<String, Pubkey> {
        &self.fee_recipients
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_fee_system_creation() {
        let fee_system = FeeSystem::new();
        assert!(!fee_system.is_initialized());
        assert_eq!(fee_system.get_current_base_fee(), 1_000_000);
        assert_eq!(fee_system.get_collected_fees().len(), 0);
        assert_eq!(fee_system.get_fee_recipients().len(), 0);
    }
    
    #[test]
    fn test_fee_system_with_config() {
        let config = FeeSystemConfig::default();
        let fee_system = FeeSystem::with_config(config);
        assert!(!fee_system.is_initialized());
        assert_eq!(fee_system.get_current_base_fee(), 1_000_000);
        assert_eq!(fee_system.get_collected_fees().len(), 0);
        assert_eq!(fee_system.get_fee_recipients().len(), 0);
    }
    
    #[test]
    fn test_fee_calculation() {
        let mut fee_system = FeeSystem::new();
        
        // Initialize the fee system
        let program_id = Pubkey::new_unique();
        let system_account = AccountInfo::new(
            &Pubkey::new_unique(),
            true,
            false,
            &mut 0,
            &mut [],
            &program_id,
            false,
            0,
        );
        let treasury_account = AccountInfo::new(
            &Pubkey::new_unique(),
            true,
            false,
            &mut 0,
            &mut [],
            &program_id,
            false,
            0,
        );
        let insurance_account = AccountInfo::new(
            &Pubkey::new_unique(),
            true,
            false,
            &mut 0,
            &mut [],
            &program_id,
            false,
            0,
        );
        let sequencer_account = AccountInfo::new(
            &Pubkey::new_unique(),
            true,
            false,
            &mut 0,
            &mut [],
            &program_id,
            false,
            0,
        );
        let validator_account = AccountInfo::new(
            &Pubkey::new_unique(),
            true,
            false,
            &mut 0,
            &mut [],
            &program_id,
            false,
            0,
        );
        let staker_account = AccountInfo::new(
            &Pubkey::new_unique(),
            true,
            false,
            &mut 0,
            &mut [],
            &program_id,
            false,
            0,
        );
        let lp_account = AccountInfo::new(
            &Pubkey::new_unique(),
            true,
            false,
            &mut 0,
            &mut [],
            &program_id,
            false,
            0,
        );
        
        let accounts = vec![
            system_account,
            treasury_account,
            insurance_account,
            sequencer_account,
            validator_account,
            staker_account,
            lp_account,
        ];
        
        fee_system.initialize(&program_id, &accounts).unwrap();
        
        // Calculate fees for a transaction
        let transaction_data = vec![0; 100];
        let fees = fee_system.calculate_fees(&transaction_data).unwrap();
        
        // Verify the fees
        assert_eq!(fees.len(), 1);
        assert_eq!(fees[0].fee_type, FeeType::BaseFee);
        assert!(fees[0].amount > 0);
        assert!(!fees[0].is_paid);
    }
}
