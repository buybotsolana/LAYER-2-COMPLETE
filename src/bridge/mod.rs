// src/bridge/mod.rs
//! Bridge module for Layer-2 on Solana
//! 
//! This module integrates the deposit and withdrawal handlers for the bridge
//! between Ethereum (L1) and Solana Layer-2, providing a secure and trustless
//! mechanism for asset transfers between the two layers.

mod deposit_handler;
mod withdrawal_handler;
mod token_registry;
mod security_module;
mod message_relay;

pub use deposit_handler::{DepositHandler, Deposit, DepositStatus};
pub use withdrawal_handler::{WithdrawalHandler, Withdrawal, WithdrawalStatus};
pub use token_registry::{TokenRegistry, TokenInfo};
pub use security_module::{SecurityModule, SecurityLevel, VerificationResult};
pub use message_relay::{MessageRelay, Message, MessageStatus};

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::{clock::Clock, Sysvar},
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

/// Error types for bridge operations
#[derive(Error, Debug, Clone, PartialEq, Eq)]
pub enum BridgeError {
    /// Invalid token
    #[error("Invalid token: {0}")]
    InvalidToken(String),
    
    /// Invalid amount
    #[error("Invalid amount: {0}")]
    InvalidAmount(String),
    
    /// Invalid deposit
    #[error("Invalid deposit: {0}")]
    InvalidDeposit(String),
    
    /// Invalid withdrawal
    #[error("Invalid withdrawal: {0}")]
    InvalidWithdrawal(String),
    
    /// Invalid message
    #[error("Invalid message: {0}")]
    InvalidMessage(String),
    
    /// Security verification failed
    #[error("Security verification failed: {0}")]
    SecurityVerificationFailed(String),
    
    /// Unauthorized access
    #[error("Unauthorized access: {0}")]
    Unauthorized(String),
    
    /// Daily limit exceeded
    #[error("Daily limit exceeded: {0}")]
    DailyLimitExceeded(String),
    
    /// System time error
    #[error("System time error: {0}")]
    SystemTimeError(String),
    
    /// Generic error
    #[error("Generic error: {0}")]
    GenericError(String),
}

impl From<std::time::SystemTimeError> for BridgeError {
    fn from(error: std::time::SystemTimeError) -> Self {
        BridgeError::SystemTimeError(error.to_string())
    }
}

/// Role-based access control for bridge operations
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct BridgeRBAC {
    /// Owner of the bridge
    pub owner: Pubkey,
    
    /// Authorized relayers
    pub relayers: Vec<Pubkey>,
    
    /// Authorized validators
    pub validators: Vec<Pubkey>,
    
    /// Authorized admins
    pub admins: Vec<Pubkey>,
}

impl BridgeRBAC {
    /// Create a new RBAC with the specified owner
    pub fn new(owner: Pubkey) -> Self {
        Self {
            owner,
            relayers: Vec::new(),
            validators: Vec::new(),
            admins: Vec::new(),
        }
    }
    
    /// Check if an account is the owner
    pub fn is_owner(&self, account: &Pubkey) -> bool {
        *account == self.owner
    }
    
    /// Check if an account is an authorized relayer
    pub fn is_relayer(&self, account: &Pubkey) -> bool {
        self.is_owner(account) || self.relayers.contains(account)
    }
    
    /// Check if an account is an authorized validator
    pub fn is_validator(&self, account: &Pubkey) -> bool {
        self.is_owner(account) || self.validators.contains(account)
    }
    
    /// Check if an account is an authorized admin
    pub fn is_admin(&self, account: &Pubkey) -> bool {
        self.is_owner(account) || self.admins.contains(account)
    }
    
    /// Add a relayer
    pub fn add_relayer(&mut self, account: Pubkey) {
        if !self.relayers.contains(&account) {
            self.relayers.push(account);
        }
    }
    
    /// Remove a relayer
    pub fn remove_relayer(&mut self, account: &Pubkey) {
        self.relayers.retain(|a| a != account);
    }
    
    /// Add a validator
    pub fn add_validator(&mut self, account: Pubkey) {
        if !self.validators.contains(&account) {
            self.validators.push(account);
        }
    }
    
    /// Remove a validator
    pub fn remove_validator(&mut self, account: &Pubkey) {
        self.validators.retain(|a| a != account);
    }
    
    /// Add an admin
    pub fn add_admin(&mut self, account: Pubkey) {
        if !self.admins.contains(&account) {
            self.admins.push(account);
        }
    }
    
    /// Remove an admin
    pub fn remove_admin(&mut self, account: &Pubkey) {
        self.admins.retain(|a| a != account);
    }
}

/// Configuration for the bridge
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct BridgeConfig {
    /// Minimum confirmations required for L1 deposits
    pub min_l1_confirmations: u64,
    
    /// Minimum confirmations required for L2 withdrawals
    pub min_l2_confirmations: u64,
    
    /// Maximum gas limit for L1 transactions
    pub max_l1_gas_limit: u64,
    
    /// Maximum gas price for L1 transactions
    pub max_l1_gas_price: u64,
    
    /// Security level for bridge operations
    pub security_level: security_module::SecurityLevel,
    
    /// Daily deposit limit per token
    pub daily_deposit_limits: HashMap<[u8; 20], u64>,
    
    /// Daily withdrawal limit per token
    pub daily_withdrawal_limits: HashMap<[u8; 20], u64>,
}

impl BridgeConfig {
    /// Create a new configuration with default values
    pub fn new() -> Self {
        Self {
            min_l1_confirmations: 12,
            min_l2_confirmations: 32,
            max_l1_gas_limit: 1_000_000,
            max_l1_gas_price: 100_000_000_000, // 100 Gwei
            security_level: security_module::SecurityLevel::High,
            daily_deposit_limits: HashMap::new(),
            daily_withdrawal_limits: HashMap::new(),
        }
    }
    
    /// Set the daily deposit limit for a token
    pub fn set_daily_deposit_limit(&mut self, token: [u8; 20], limit: u64) {
        self.daily_deposit_limits.insert(token, limit);
    }
    
    /// Set the daily withdrawal limit for a token
    pub fn set_daily_withdrawal_limit(&mut self, token: [u8; 20], limit: u64) {
        self.daily_withdrawal_limits.insert(token, limit);
    }
}

/// Bridge manager for the Layer-2 system
pub struct BridgeManager {
    /// Configuration
    pub config: BridgeConfig,
    
    /// Role-based access control
    pub rbac: BridgeRBAC,
    
    /// Deposit handler
    pub deposit_handler: deposit_handler::DepositHandler,
    
    /// Withdrawal handler
    pub withdrawal_handler: withdrawal_handler::WithdrawalHandler,
    
    /// Token registry
    pub token_registry: token_registry::TokenRegistry,
    
    /// Security module
    pub security_module: security_module::SecurityModule,
    
    /// Message relay
    pub message_relay: message_relay::MessageRelay,
    
    /// Last update timestamp
    pub last_update_timestamp: u64,
    
    /// Daily deposit volumes per token
    pub daily_deposit_volumes: HashMap<[u8; 20], u64>,
    
    /// Daily withdrawal volumes per token
    pub daily_withdrawal_volumes: HashMap<[u8; 20], u64>,
    
    /// Current day (for volume tracking)
    pub current_day: u64,
}

impl BridgeManager {
    /// Create a new bridge manager
    pub fn new(l1_bridge_address: [u8; 20], l1_withdrawal_bridge_address: [u8; 20]) -> Self {
        Self {
            config: BridgeConfig::new(),
            rbac: BridgeRBAC::new(Pubkey::default()),
            deposit_handler: deposit_handler::DepositHandler::new(),
            withdrawal_handler: withdrawal_handler::WithdrawalHandler::new(),
            token_registry: token_registry::TokenRegistry::new(),
            security_module: security_module::SecurityModule::new(),
            message_relay: message_relay::MessageRelay::new(l1_bridge_address, l1_withdrawal_bridge_address),
            last_update_timestamp: 0,
            daily_deposit_volumes: HashMap::new(),
            daily_withdrawal_volumes: HashMap::new(),
            current_day: 0,
        }
    }
    
    /// Initialize the bridge manager
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        // Get the system account
        let system_account = next_account_info(account_info_iter)?;
        
        // Verify the system account is owned by the program
        if system_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        
        // Initialize deposit handler
        self.deposit_handler.initialize(program_id, accounts)?;
        
        // Initialize withdrawal handler
        self.withdrawal_handler.initialize(program_id, accounts)?;
        
        // Initialize token registry
        self.token_registry.initialize(program_id, accounts)?;
        
        // Initialize security module
        self.security_module.initialize(program_id, accounts)?;
        
        // Initialize message relay
        self.message_relay.initialize(program_id, accounts)?;
        
        // Set the last update timestamp
        let clock = Clock::get()?;
        self.last_update_timestamp = clock.unix_timestamp as u64;
        self.current_day = self.last_update_timestamp / (24 * 60 * 60);
        
        msg!("Bridge manager initialized");
        
        Ok(())
    }
    
    /// Update the bridge manager
    pub fn update(&mut self) -> Result<(), BridgeError> {
        // Get the current timestamp
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)?
            .as_secs();
        
        // Check if we've moved to a new day
        let current_day = now / (24 * 60 * 60);
        if current_day > self.current_day {
            // Reset daily volumes
            self.daily_deposit_volumes.clear();
            self.daily_withdrawal_volumes.clear();
            self.current_day = current_day;
        }
        
        // Process pending deposits
        let pending_deposits = self.deposit_handler.get_deposits_by_status(deposit_handler::DepositStatus::Pending);
        for deposit in pending_deposits {
            // Check if the deposit has enough L1 confirmations
            if deposit.l1_block_number + self.config.min_l1_confirmations <= self.message_relay.get_latest_l1_block_number() {
                // Verify the deposit with the security module
                match self.security_module.verify_deposit(&deposit) {
                    Ok(security_module::VerificationResult::Approved) => {
                        // Confirm the deposit
                        if let Err(e) = self.deposit_handler.confirm_deposit(deposit.id) {
                            msg!("Error confirming deposit: {}", e);
                            continue;
                        }
                    },
                    Ok(security_module::VerificationResult::Rejected(reason)) => {
                        // Reject the deposit
                        if let Err(e) = self.deposit_handler.reject_deposit(deposit.id, &reason) {
                            msg!("Error rejecting deposit: {}", e);
                        }
                        continue;
                    },
                    Ok(security_module::VerificationResult::Pending) => {
                        // Do nothing, wait for more confirmations
                        continue;
                    },
                    Err(e) => {
                        msg!("Error verifying deposit: {}", e);
                        continue;
                    },
                }
            }
        }
        
        // Process confirmed deposits
        let confirmed_deposits = self.deposit_handler.get_deposits_by_status(deposit_handler::DepositStatus::Confirmed);
        for deposit in confirmed_deposits {
            // Check if the deposit is within daily limits
            let daily_volume = self.daily_deposit_volumes.get(&deposit.token).unwrap_or(&0);
            let daily_limit = self.config.daily_deposit_limits.get(&deposit.token).unwrap_or(&u64::MAX);
            
            if daily_volume + deposit.amount <= *daily_limit {
                // Generate an L2 transaction to mint tokens
                // In a real implementation, we would:
                // 1. Generate an L2 transaction
                // 2. Submit the transaction to the L2 network
                // 3. Get the transaction hash
                // 4. Finalize the deposit with the transaction hash
                
                // For now, we'll simulate this with a dummy transaction hash
                let l2_tx_hash = [0; 32]; // Dummy transaction hash
                
                // Finalize the deposit
                if let Err(e) = self.deposit_handler.finalize_deposit(deposit.id, l2_tx_hash) {
                    msg!("Error finalizing deposit: {}", e);
                } else {
                    // Update daily volume
                    let new_volume = daily_volume + deposit.amount;
                    self.daily_deposit_volumes.insert(deposit.token, new_volume);
                }
            } else {
                // Reject the deposit due to daily limit
                let limit_message = format!("Daily limit of {} exceeded", daily_limit);
                if let Err(e) = self.deposit_handler.reject_deposit(deposit.id, &limit_message) {
                    msg!("Error rejecting deposit: {}", e);
                }
            }
        }
        
        // Process pending withdrawals
        let pending_withdrawals = self.withdrawal_handler.get_withdrawals_by_status(withdrawal_handler::WithdrawalStatus::Pending);
        for withdrawal in pending_withdrawals {
            // Check if the withdrawal has enough L2 confirmations
            if withdrawal.l2_block_number + self.config.min_l2_confirmations <= self.message_relay.get_latest_l2_block_number() {
                // Verify the withdrawal with the security module
                match self.security_module.verify_withdrawal(&withdrawal) {
                    Ok(security_module::VerificationResult::Approved) => {
                        // Confirm the withdrawal
                        if let Err(e) = self.withdrawal_handler.confirm_withdrawal(withdrawal.id) {
                            msg!("Error confirming withdrawal: {}", e);
                            continue;
                        }
                    },
                    Ok(security_module::VerificationResult::Rejected(reason)) => {
                        // Reject the withdrawal
                        if let Err(e) = self.withdrawal_handler.reject_withdrawal(withdrawal.id, &reason) {
                            msg!("Error rejecting withdrawal: {}", e);
                        }
                        continue;
                    },
                    Ok(security_module::VerificationResult::Pending) => {
                        // Do nothing, wait for more confirmations
                        continue;
                    },
                    Err(e) => {
                        msg!("Error verifying withdrawal: {}", e);
                        continue;
                    },
                }
            }
        }
        
        // Process confirmed withdrawals
        let confirmed_withdrawals = self.withdrawal_handler.get_withdrawals_by_status(withdrawal_handler::WithdrawalStatus::Confirmed);
        for withdrawal in confirmed_withdrawals {
            // Check if the withdrawal is within daily limits
            let daily_volume = self.daily_withdrawal_volumes.get(&withdrawal.token).unwrap_or(&0);
            let daily_limit = self.config.daily_withdrawal_limits.get(&withdrawal.token).unwrap_or(&u64::MAX);
            
            if daily_volume + withdrawal.amount <= *daily_limit {
                // Generate an L1 transaction to release tokens
                // In a real implementation, we would:
                // 1. Generate an L1 transaction
                // 2. Submit the transaction to the L1 network
                // 3. Get the transaction hash
                // 4. Finalize the withdrawal with the transaction hash
                
                // For now, we'll simulate this with a dummy transaction hash
                let l1_tx_hash = [0; 32]; // Dummy transaction hash
                
                // Finalize the withdrawal
                if let Err(e) = self.withdrawal_handler.finalize_withdrawal(withdrawal.id, l1_tx_hash) {
                    msg!("Error finalizing withdrawal: {}", e);
                } else {
                    // Update daily volume
                    let new_volume = daily_volume + withdrawal.amount;
                    self.daily_withdrawal_volumes.insert(withdrawal.token, new_volume);
                }
            } else {
                // Reject the withdrawal due to daily limit
                let limit_message = format!("Daily limit of {} exceeded", daily_limit);
                if let Err(e) = self.withdrawal_handler.reject_withdrawal(withdrawal.id, &limit_message) {
                    msg!("Error rejecting withdrawal: {}", e);
                }
            }
        }
        
        // Update the last update timestamp
        self.last_update_timestamp = now;
        
        Ok(())
    }
    
    /// Process a deposit from L1
    pub fn process_deposit(
        &mut self,
        relayer: &Pubkey,
        l1_tx_hash: [u8; 32],
        l1_block_number: u64,
        token: [u8; 20],
        amount: u64,
        recipient: [u8; 32],
    ) -> Result<(), BridgeError> {
        // Check if the relayer is authorized
        if !self.rbac.is_relayer(relayer) {
            return Err(BridgeError::Unauthorized("Relayer not authorized".to_string()));
        }
        
        // Check if the token is registered
        if !self.token_registry.is_token_registered(&token) {
            return Err(BridgeError::InvalidToken(format!("Token {:?} not registered", token)));
        }
        
        // Check if the amount is valid
        if amount == 0 {
            return Err(BridgeError::InvalidAmount("Amount must be greater than 0".to_string()));
        }
        
        // Create a new deposit
        let deposit_id = self.deposit_handler.create_deposit(
            l1_tx_hash,
            l1_block_number,
            token,
            amount,
            recipient,
        ).map_err(|e| BridgeError::InvalidDeposit(e))?;
        
        msg!("Deposit created with ID: {}", deposit_id);
        
        Ok(())
    }
    
    /// Process a withdrawal to L1
    pub fn process_withdrawal(
        &mut self,
        validator: &Pubkey,
        l2_tx_hash: [u8; 32],
        l2_block_number: u64,
        token: [u8; 20],
        amount: u64,
        recipient: [u8; 20],
    ) -> Result<(), BridgeError> {
        // Check if the validator is authorized
        if !self.rbac.is_validator(validator) {
            return Err(BridgeError::Unauthorized("Validator not authorized".to_string()));
        }
        
        // Check if the token is registered
        if !self.token_registry.is_token_registered(&token) {
            return Err(BridgeError::InvalidToken(format!("Token {:?} not registered", token)));
        }
        
        // Check if the amount is valid
        if amount == 0 {
            return Err(BridgeError::InvalidAmount("Amount must be greater than 0".to_string()));
        }
        
        // Create a new withdrawal
        let withdrawal_id = self.withdrawal_handler.create_withdrawal(
            l2_tx_hash,
            l2_block_number,
            token,
            amount,
            recipient,
        ).map_err(|e| BridgeError::InvalidWithdrawal(e))?;
        
        msg!("Withdrawal created with ID: {}", withdrawal_id);
        
        Ok(())
    }
    
    /// Register a token
    pub fn register_token(
        &mut self,
        admin: &Pubkey,
        l1_token: [u8; 20],
        l2_token: [u8; 32],
        name: String,
        symbol: String,
        decimals: u8,
    ) -> Result<(), BridgeError> {
        // Check if the admin is authorized
        if !self.rbac.is_admin(admin) {
            return Err(BridgeError::Unauthorized("Admin not authorized".to_string()));
        }
        
        // Register the token
        self.token_registry.register_token(l1_token, l2_token, name, symbol, decimals)
            .map_err(|e| BridgeError::InvalidToken(e))
    }
    
    /// Set the daily deposit limit for a token
    pub fn set_daily_deposit_limit(
        &mut self,
        admin: &Pubkey,
        token: [u8; 20],
        limit: u64,
    ) -> Result<(), BridgeError> {
        // Check if the admin is authorized
        if !self.rbac.is_admin(admin) {
            return Err(BridgeError::Unauthorized("Admin not authorized".to_string()));
        }
        
        // Check if the token is registered
        if !self.token_registry.is_token_registered(&token) {
            return Err(BridgeError::InvalidToken(format!("Token {:?} not registered", token)));
        }
        
        // Set the daily deposit limit
        self.config.set_daily_deposit_limit(token, limit);
        
        msg!("Daily deposit limit for token {:?} set to {}", token, limit);
        
        Ok(())
    }
    
    /// Set the daily withdrawal limit for a token
    pub fn set_daily_withdrawal_limit(
        &mut self,
        admin: &Pubkey,
        token: [u8; 20],
        limit: u64,
    ) -> Result<(), BridgeError> {
        // Check if the admin is authorized
        if !self.rbac.is_admin(admin) {
            return Err(BridgeError::Unauthorized("Admin not authorized".to_string()));
        }
        
        // Check if the token is registered
        if !self.token_registry.is_token_registered(&token) {
            return Err(BridgeError::InvalidToken(format!("Token {:?} not registered", token)));
        }
        
        // Set the daily withdrawal limit
        self.config.set_daily_withdrawal_limit(token, limit);
        
        msg!("Daily withdrawal limit for token {:?} set to {}", token, limit);
        
        Ok(())
    }
    
    /// Add a relayer
    pub fn add_relayer(
        &mut self,
        admin: &Pubkey,
        relayer: Pubkey,
    ) -> Result<(), BridgeError> {
        // Check if the admin is authorized
        if !self.rbac.is_admin(admin) {
            return Err(BridgeError::Unauthorized("Admin not authorized".to_string()));
        }
        
        // Add the relayer
        self.rbac.add_relayer(relayer);
        
        msg!("Added relayer: {}", relayer);
        
        Ok(())
    }
    
    /// Remove a relayer
    pub fn remove_relayer(
        &mut self,
        admin: &Pubkey,
        relayer: &Pubkey,
    ) -> Result<(), BridgeError> {
        // Check if the admin is authorized
        if !self.rbac.is_admin(admin) {
            return Err(BridgeError::Unauthorized("Admin not authorized".to_string()));
        }
        
        // Remove the relayer
        self.rbac.remove_relayer(relayer);
        
        msg!("Removed relayer: {}", relayer);
        
        Ok(())
    }
    
    /// Add a validator
    pub fn add_validator(
        &mut self,
        admin: &Pubkey,
        validator: Pubkey,
    ) -> Result<(), BridgeError> {
        // Check if the admin is authorized
        if !self.rbac.is_admin(admin) {
            return Err(BridgeError::Unauthorized("Admin not authorized".to_string()));
        }
        
        // Add the validator
        self.rbac.add_validator(validator);
        
        msg!("Added validator: {}", validator);
        
        Ok(())
    }
    
    /// Remove a validator
    pub fn remove_validator(
        &mut self,
        admin: &Pubkey,
        validator: &Pubkey,
    ) -> Result<(), BridgeError> {
        // Check if the admin is authorized
        if !self.rbac.is_admin(admin) {
            return Err(BridgeError::Unauthorized("Admin not authorized".to_string()));
        }
        
        // Remove the validator
        self.rbac.remove_validator(validator);
        
        msg!("Removed validator: {}", validator);
        
        Ok(())
    }
    
    /// Add an admin
    pub fn add_admin(
        &mut self,
        owner: &Pubkey,
        admin: Pubkey,
    ) -> Result<(), BridgeError> {
        // Check if the owner is authorized
        if !self.rbac.is_owner(owner) {
            return Err(BridgeError::Unauthorized("Owner not authorized".to_string()));
        }
        
        // Add the admin
        self.rbac.add_admin(admin);
        
        msg!("Added admin: {}", admin);
        
        Ok(())
    }
    
    /// Remove an admin
    pub fn remove_admin(
        &mut self,
        owner: &Pubkey,
        admin: &Pubkey,
    ) -> Result<(), BridgeError> {
        // Check if the owner is authorized
        if !self.rbac.is_owner(owner) {
            return Err(BridgeError::Unauthorized("Owner not authorized".to_string()));
        }
        
        // Remove the admin
        self.rbac.remove_admin(admin);
        
        msg!("Removed admin: {}", admin);
        
        Ok(())
    }
    
    /// Set the security level
    pub fn set_security_level(
        &mut self,
        admin: &Pubkey,
        security_level: security_module::SecurityLevel,
    ) -> Result<(), BridgeError> {
        // Check if the admin is authorized
        if !self.rbac.is_admin(admin) {
            return Err(BridgeError::Unauthorized("Admin not authorized".to_string()));
        }
        
        // Set the security level
        self.config.security_level = security_level;
        self.security_module.set_security_level(security_level);
        
        msg!("Security level set to {:?}", security_level);
        
        Ok(())
    }
    
    /// Get the daily deposit volume for a token
    pub fn get_daily_deposit_volume(&self, token: &[u8; 20]) -> u64 {
        *self.daily_deposit_volumes.get(token).unwrap_or(&0)
    }
    
    /// Get the daily withdrawal volume for a token
    pub fn get_daily_withdrawal_volume(&self, token: &[u8; 20]) -> u64 {
        *self.daily_withdrawal_volumes.get(token).unwrap_or(&0)
    }
    
    /// Get the daily deposit limit for a token
    pub fn get_daily_deposit_limit(&self, token: &[u8; 20]) -> u64 {
        *self.config.daily_deposit_limits.get(token).unwrap_or(&u64::MAX)
    }
    
    /// Get the daily withdrawal limit for a token
    pub fn get_daily_withdrawal_limit(&self, token: &[u8; 20]) -> u64 {
        *self.config.daily_withdrawal_limits.get(token).unwrap_or(&u64::MAX)
    }
}

/// Bridge instruction types
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum BridgeInstruction {
    /// Initialize the bridge
    Initialize {
        /// L1 bridge address
        l1_bridge_address: [u8; 20],
        
        /// L1 withdrawal bridge address
        l1_withdrawal_bridge_address: [u8; 20],
    },
    
    /// Update the bridge
    Update,
    
    /// Process a deposit from L1
    ProcessDeposit {
        /// L1 transaction hash
        l1_tx_hash: [u8; 32],
        
        /// L1 block number
        l1_block_number: u64,
        
        /// Token address
        token: [u8; 20],
        
        /// Amount
        amount: u64,
        
        /// Recipient address
        recipient: [u8; 32],
    },
    
    /// Process a withdrawal to L1
    ProcessWithdrawal {
        /// L2 transaction hash
        l2_tx_hash: [u8; 32],
        
        /// L2 block number
        l2_block_number: u64,
        
        /// Token address
        token: [u8; 20],
        
        /// Amount
        amount: u64,
        
        /// Recipient address
        recipient: [u8; 20],
    },
    
    /// Register a token
    RegisterToken {
        /// L1 token address
        l1_token: [u8; 20],
        
        /// L2 token address
        l2_token: [u8; 32],
        
        /// Token name
        name: String,
        
        /// Token symbol
        symbol: String,
        
        /// Token decimals
        decimals: u8,
    },
    
    /// Set the daily deposit limit for a token
    SetDailyDepositLimit {
        /// Token address
        token: [u8; 20],
        
        /// Limit
        limit: u64,
    },
    
    /// Set the daily withdrawal limit for a token
    SetDailyWithdrawalLimit {
        /// Token address
        token: [u8; 20],
        
        /// Limit
        limit: u64,
    },
    
    /// Add a relayer
    AddRelayer {
        /// Relayer account
        relayer: Pubkey,
    },
    
    /// Remove a relayer
    RemoveRelayer {
        /// Relayer account
        relayer: Pubkey,
    },
    
    /// Add a validator
    AddValidator {
        /// Validator account
        validator: Pubkey,
    },
    
    /// Remove a validator
    RemoveValidator {
        /// Validator account
        validator: Pubkey,
    },
    
    /// Add an admin
    AddAdmin {
        /// Admin account
        admin: Pubkey,
    },
    
    /// Remove an admin
    RemoveAdmin {
        /// Admin account
        admin: Pubkey,
    },
    
    /// Set the security level
    SetSecurityLevel {
        /// Security level
        security_level: security_module::SecurityLevel,
    },
}

/// Process bridge instruction
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction: &BridgeInstruction,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    
    // Get the system account
    let system_account = next_account_info(account_info_iter)?;
    
    // Create or get the bridge manager
    let mut bridge_manager = BridgeManager::new([0; 20], [0; 20]);
    
    match instruction {
        BridgeInstruction::Initialize {
            l1_bridge_address,
            l1_withdrawal_bridge_address,
        } => {
            // Create a new bridge manager
            bridge_manager = BridgeManager::new(*l1_bridge_address, *l1_withdrawal_bridge_address);
            
            // Set the owner to the system account
            bridge_manager.rbac = BridgeRBAC::new(*system_account.key);
            
            // Initialize the bridge manager
            bridge_manager.initialize(program_id, accounts)?;
            
            msg!("Bridge initialized");
            
            Ok(())
        },
        BridgeInstruction::Update => {
            // Update the bridge manager
            bridge_manager.update()
                .map_err(|e| {
                    msg!("Error updating bridge manager: {}", e);
                    ProgramError::Custom(1)
                })?;
            
            msg!("Bridge updated");
            
            Ok(())
        },
        BridgeInstruction::ProcessDeposit {
            l1_tx_hash,
            l1_block_number,
            token,
            amount,
            recipient,
        } => {
            // Get the relayer account
            let relayer_account = next_account_info(account_info_iter)?;
            
            // Verify the relayer account is a signer
            if !relayer_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Process the deposit
            bridge_manager.process_deposit(
                relayer_account.key,
                *l1_tx_hash,
                *l1_block_number,
                *token,
                *amount,
                *recipient,
            ).map_err(|e| {
                msg!("Error processing deposit: {}", e);
                ProgramError::Custom(2)
            })?;
            
            msg!("Deposit processed");
            
            Ok(())
        },
        BridgeInstruction::ProcessWithdrawal {
            l2_tx_hash,
            l2_block_number,
            token,
            amount,
            recipient,
        } => {
            // Get the validator account
            let validator_account = next_account_info(account_info_iter)?;
            
            // Verify the validator account is a signer
            if !validator_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Process the withdrawal
            bridge_manager.process_withdrawal(
                validator_account.key,
                *l2_tx_hash,
                *l2_block_number,
                *token,
                *amount,
                *recipient,
            ).map_err(|e| {
                msg!("Error processing withdrawal: {}", e);
                ProgramError::Custom(3)
            })?;
            
            msg!("Withdrawal processed");
            
            Ok(())
        },
        BridgeInstruction::RegisterToken {
            l1_token,
            l2_token,
            name,
            symbol,
            decimals,
        } => {
            // Get the admin account
            let admin_account = next_account_info(account_info_iter)?;
            
            // Verify the admin account is a signer
            if !admin_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Register the token
            bridge_manager.register_token(
                admin_account.key,
                *l1_token,
                *l2_token,
                name.clone(),
                symbol.clone(),
                *decimals,
            ).map_err(|e| {
                msg!("Error registering token: {}", e);
                ProgramError::Custom(4)
            })?;
            
            msg!("Token registered");
            
            Ok(())
        },
        BridgeInstruction::SetDailyDepositLimit {
            token,
            limit,
        } => {
            // Get the admin account
            let admin_account = next_account_info(account_info_iter)?;
            
            // Verify the admin account is a signer
            if !admin_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Set the daily deposit limit
            bridge_manager.set_daily_deposit_limit(
                admin_account.key,
                *token,
                *limit,
            ).map_err(|e| {
                msg!("Error setting daily deposit limit: {}", e);
                ProgramError::Custom(5)
            })?;
            
            msg!("Daily deposit limit set");
            
            Ok(())
        },
        BridgeInstruction::SetDailyWithdrawalLimit {
            token,
            limit,
        } => {
            // Get the admin account
            let admin_account = next_account_info(account_info_iter)?;
            
            // Verify the admin account is a signer
            if !admin_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Set the daily withdrawal limit
            bridge_manager.set_daily_withdrawal_limit(
                admin_account.key,
                *token,
                *limit,
            ).map_err(|e| {
                msg!("Error setting daily withdrawal limit: {}", e);
                ProgramError::Custom(6)
            })?;
            
            msg!("Daily withdrawal limit set");
            
            Ok(())
        },
        BridgeInstruction::AddRelayer {
            relayer,
        } => {
            // Get the admin account
            let admin_account = next_account_info(account_info_iter)?;
            
            // Verify the admin account is a signer
            if !admin_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Add the relayer
            bridge_manager.add_relayer(
                admin_account.key,
                *relayer,
            ).map_err(|e| {
                msg!("Error adding relayer: {}", e);
                ProgramError::Custom(7)
            })?;
            
            msg!("Relayer added");
            
            Ok(())
        },
        BridgeInstruction::RemoveRelayer {
            relayer,
        } => {
            // Get the admin account
            let admin_account = next_account_info(account_info_iter)?;
            
            // Verify the admin account is a signer
            if !admin_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Remove the relayer
            bridge_manager.remove_relayer(
                admin_account.key,
                relayer,
            ).map_err(|e| {
                msg!("Error removing relayer: {}", e);
                ProgramError::Custom(8)
            })?;
            
            msg!("Relayer removed");
            
            Ok(())
        },
        BridgeInstruction::AddValidator {
            validator,
        } => {
            // Get the admin account
            let admin_account = next_account_info(account_info_iter)?;
            
            // Verify the admin account is a signer
            if !admin_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Add the validator
            bridge_manager.add_validator(
                admin_account.key,
                *validator,
            ).map_err(|e| {
                msg!("Error adding validator: {}", e);
                ProgramError::Custom(9)
            })?;
            
            msg!("Validator added");
            
            Ok(())
        },
        BridgeInstruction::RemoveValidator {
            validator,
        } => {
            // Get the admin account
            let admin_account = next_account_info(account_info_iter)?;
            
            // Verify the admin account is a signer
            if !admin_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Remove the validator
            bridge_manager.remove_validator(
                admin_account.key,
                validator,
            ).map_err(|e| {
                msg!("Error removing validator: {}", e);
                ProgramError::Custom(10)
            })?;
            
            msg!("Validator removed");
            
            Ok(())
        },
        BridgeInstruction::AddAdmin {
            admin,
        } => {
            // Get the owner account
            let owner_account = next_account_info(account_info_iter)?;
            
            // Verify the owner account is a signer
            if !owner_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Add the admin
            bridge_manager.add_admin(
                owner_account.key,
                *admin,
            ).map_err(|e| {
                msg!("Error adding admin: {}", e);
                ProgramError::Custom(11)
            })?;
            
            msg!("Admin added");
            
            Ok(())
        },
        BridgeInstruction::RemoveAdmin {
            admin,
        } => {
            // Get the owner account
            let owner_account = next_account_info(account_info_iter)?;
            
            // Verify the owner account is a signer
            if !owner_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Remove the admin
            bridge_manager.remove_admin(
                owner_account.key,
                admin,
            ).map_err(|e| {
                msg!("Error removing admin: {}", e);
                ProgramError::Custom(12)
            })?;
            
            msg!("Admin removed");
            
            Ok(())
        },
        BridgeInstruction::SetSecurityLevel {
            security_level,
        } => {
            // Get the admin account
            let admin_account = next_account_info(account_info_iter)?;
            
            // Verify the admin account is a signer
            if !admin_account.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            
            // Set the security level
            bridge_manager.set_security_level(
                admin_account.key,
                *security_level,
            ).map_err(|e| {
                msg!("Error setting security level: {}", e);
                ProgramError::Custom(13)
            })?;
            
            msg!("Security level set");
            
            Ok(())
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_bridge_rbac() {
        // Create a new RBAC with a test owner
        let owner = Pubkey::new_unique();
        let mut rbac = BridgeRBAC::new(owner);
        
        // Test owner checks
        assert!(rbac.is_owner(&owner));
        assert!(!rbac.is_owner(&Pubkey::new_unique()));
        
        // Test relayer checks
        let relayer = Pubkey::new_unique();
        assert!(!rbac.is_relayer(&relayer));
        rbac.add_relayer(relayer);
        assert!(rbac.is_relayer(&relayer));
        rbac.remove_relayer(&relayer);
        assert!(!rbac.is_relayer(&relayer));
        
        // Test validator checks
        let validator = Pubkey::new_unique();
        assert!(!rbac.is_validator(&validator));
        rbac.add_validator(validator);
        assert!(rbac.is_validator(&validator));
        rbac.remove_validator(&validator);
        assert!(!rbac.is_validator(&validator));
        
        // Test admin checks
        let admin = Pubkey::new_unique();
        assert!(!rbac.is_admin(&admin));
        rbac.add_admin(admin);
        assert!(rbac.is_admin(&admin));
        rbac.remove_admin(&admin);
        assert!(!rbac.is_admin(&admin));
    }
    
    #[test]
    fn test_bridge_config() {
        // Test default configuration
        let config = BridgeConfig::new();
        assert_eq!(config.min_l1_confirmations, 12);
        assert_eq!(config.min_l2_confirmations, 32);
        assert_eq!(config.max_l1_gas_limit, 1_000_000);
        assert_eq!(config.max_l1_gas_price, 100_000_000_000);
        assert_eq!(config.security_level, security_module::SecurityLevel::High);
        assert!(config.daily_deposit_limits.is_empty());
        assert!(config.daily_withdrawal_limits.is_empty());
        
        // Test setting daily limits
        let mut config = BridgeConfig::new();
        let token = [1; 20];
        let limit = 1000;
        config.set_daily_deposit_limit(token, limit);
        config.set_daily_withdrawal_limit(token, limit);
        assert_eq!(config.daily_deposit_limits.get(&token), Some(&limit));
        assert_eq!(config.daily_withdrawal_limits.get(&token), Some(&limit));
    }
    
    // Additional tests would be added here to test the bridge manager
}
