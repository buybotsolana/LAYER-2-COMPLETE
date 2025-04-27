// src/fee_optimization/gasless_transactions.rs
//! Gasless Transactions implementation for Layer-2 on Solana
//!
//! This module implements a system for gasless transactions that allows users
//! to execute transactions without paying gas fees. It includes mechanisms for
//! meta-transactions, relayers, and fee subsidization.

use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};
use solana_program::hash::Hash;
use solana_program::pubkey::Pubkey;
use solana_program::instruction::{AccountMeta, Instruction};
use solana_program::program_error::ProgramError;
use solana_program::program_pack::Pack;
use solana_program::account_info::AccountInfo;
use std::sync::{Arc, Mutex, RwLock};

use crate::rollup::optimistic_rollup::RollupTransaction;

/// Maximum age of a meta-transaction (in seconds)
pub const MAX_META_TX_AGE: u64 = 3600; // 1 hour

/// Status of a meta-transaction
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MetaTransactionStatus {
    /// Transaction is pending
    Pending,
    /// Transaction has been executed
    Executed,
    /// Transaction has been rejected
    Rejected(String), // Reason
    /// Transaction has expired
    Expired,
}

/// A meta-transaction that can be executed without gas
#[derive(Debug, Clone)]
pub struct MetaTransaction {
    /// Original transaction
    pub transaction: RollupTransaction,
    /// Transaction hash
    pub hash: Hash,
    /// Timestamp when the transaction was created
    pub created_at: u64,
    /// Relayer that will execute the transaction
    pub relayer: Option<Pubkey>,
    /// Status of the transaction
    pub status: MetaTransactionStatus,
    /// Signature from the user
    pub user_signature: Vec<u8>,
    /// Signature from the relayer (if executed)
    pub relayer_signature: Option<Vec<u8>>,
    /// Gas price that the relayer will pay
    pub relayer_gas_price: u64,
    /// Nonce to prevent replay attacks
    pub nonce: u64,
}

/// Configuration for a relayer
#[derive(Debug, Clone)]
pub struct RelayerConfig {
    /// Maximum gas price the relayer is willing to pay
    pub max_gas_price: u64,
    /// Minimum gas price the relayer is willing to pay
    pub min_gas_price: u64,
    /// Maximum gas limit the relayer is willing to pay for
    pub max_gas_limit: u64,
    /// Whitelist of addresses the relayer will serve
    pub whitelist: Option<HashSet<Pubkey>>,
    /// Blacklist of addresses the relayer will not serve
    pub blacklist: HashSet<Pubkey>,
    /// Fee that the relayer charges (in percentage)
    pub fee_percentage: u8,
    /// Maximum fee the relayer will charge
    pub max_fee: u64,
    /// Minimum balance required for users
    pub min_user_balance: u64,
}

impl Default for RelayerConfig {
    fn default() -> Self {
        RelayerConfig {
            max_gas_price: 100,
            min_gas_price: 10,
            max_gas_limit: 1000000,
            whitelist: None,
            blacklist: HashSet::new(),
            fee_percentage: 10, // 10%
            max_fee: 1000,
            min_user_balance: 0,
        }
    }
}

/// Statistics for the gasless transactions system
#[derive(Debug, Clone, Default)]
pub struct GaslessStats {
    /// Total number of meta-transactions received
    pub total_transactions: u64,
    /// Number of meta-transactions currently pending
    pub pending_transactions: u64,
    /// Number of meta-transactions executed
    pub executed_transactions: u64,
    /// Number of rejected meta-transactions
    pub rejected_transactions: u64,
    /// Number of expired meta-transactions
    pub expired_transactions: u64,
    /// Total gas saved by users
    pub total_gas_saved: u64,
    /// Total fees earned by relayers
    pub total_relayer_fees: u64,
    /// Average time to execution (in seconds)
    pub average_execution_time: f64,
}

/// The Gasless Transactions system
pub struct GaslessTransactions {
    /// Meta-transactions by hash
    pub transactions: HashMap<Hash, MetaTransaction>,
    /// Nonces by user
    pub nonces: HashMap<Pubkey, u64>,
    /// Relayer configuration
    pub relayer_config: RelayerConfig,
    /// Relayer account
    pub relayer_account: Pubkey,
    /// Statistics
    pub stats: GaslessStats,
    /// Subsidy pool balance
    pub subsidy_pool: u64,
    /// Whitelist of contracts that can be called gaslessly
    pub contract_whitelist: HashSet<Pubkey>,
    /// Mapping of user addresses to their subsidized gas limit
    pub user_subsidies: HashMap<Pubkey, u64>,
}

impl GaslessTransactions {
    /// Create a new Gasless Transactions instance
    pub fn new(relayer_config: RelayerConfig, relayer_account: Pubkey) -> Self {
        GaslessTransactions {
            transactions: HashMap::new(),
            nonces: HashMap::new(),
            relayer_config,
            relayer_account,
            stats: GaslessStats::default(),
            subsidy_pool: 0,
            contract_whitelist: HashSet::new(),
            user_subsidies: HashMap::new(),
        }
    }

    /// Create a meta-transaction
    pub fn create_meta_transaction(
        &mut self,
        transaction: RollupTransaction,
        user_signature: Vec<u8>,
    ) -> Result<Hash, ProgramError> {
        // Validate transaction
        self.validate_transaction(&transaction)?;
        
        // Get next nonce for user
        let nonce = self.get_next_nonce(&transaction.sender);
        
        // Create timestamp
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        // Create transaction hash
        let hash = self.generate_transaction_hash(&transaction, &user_signature, nonce, created_at);
        
        // Create meta-transaction
        let meta_tx = MetaTransaction {
            transaction,
            hash,
            created_at,
            relayer: None,
            status: MetaTransactionStatus::Pending,
            user_signature,
            relayer_signature: None,
            relayer_gas_price: 0,
            nonce,
        };
        
        // Store meta-transaction
        self.transactions.insert(hash, meta_tx);
        
        // Update nonce
        self.nonces.insert(meta_tx.transaction.sender, nonce);
        
        // Update stats
        self.stats.total_transactions += 1;
        self.stats.pending_transactions += 1;
        
        Ok(hash)
    }

    /// Execute a meta-transaction
    pub fn execute_meta_transaction(
        &mut self,
        hash: &Hash,
        relayer_signature: Vec<u8>,
        gas_price: u64,
    ) -> Result<(), ProgramError> {
        // Check if transaction exists
        if !self.transactions.contains_key(hash) {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Get transaction
        let meta_tx = self.transactions.get_mut(hash).unwrap();
        
        // Check if transaction is pending
        if meta_tx.status != MetaTransactionStatus::Pending {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if transaction has expired
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        if now > meta_tx.created_at + MAX_META_TX_AGE {
            meta_tx.status = MetaTransactionStatus::Expired;
            self.stats.expired_transactions += 1;
            self.stats.pending_transactions -= 1;
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if gas price is within relayer limits
        if gas_price < self.relayer_config.min_gas_price || gas_price > self.relayer_config.max_gas_price {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if gas limit is within relayer limits
        if meta_tx.transaction.gas_limit > self.relayer_config.max_gas_limit {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if user is in whitelist (if whitelist is enabled)
        if let Some(whitelist) = &self.relayer_config.whitelist {
            if !whitelist.contains(&meta_tx.transaction.sender) {
                meta_tx.status = MetaTransactionStatus::Rejected("User not in whitelist".to_string());
                self.stats.rejected_transactions += 1;
                self.stats.pending_transactions -= 1;
                return Err(ProgramError::InvalidArgument);
            }
        }
        
        // Check if user is in blacklist
        if self.relayer_config.blacklist.contains(&meta_tx.transaction.sender) {
            meta_tx.status = MetaTransactionStatus::Rejected("User in blacklist".to_string());
            self.stats.rejected_transactions += 1;
            self.stats.pending_transactions -= 1;
            return Err(ProgramError::InvalidArgument);
        }
        
        // Calculate relayer fee
        let gas_cost = gas_price * meta_tx.transaction.gas_limit;
        let relayer_fee = std::cmp::min(
            (gas_cost * self.relayer_config.fee_percentage as u64) / 100,
            self.relayer_config.max_fee
        );
        
        // Check if user has enough balance for the transaction + fee
        let total_cost = meta_tx.transaction.amount + relayer_fee;
        // In a real implementation, we would check the user's balance here
        
        // Update transaction
        meta_tx.relayer = Some(self.relayer_account);
        meta_tx.status = MetaTransactionStatus::Executed;
        meta_tx.relayer_signature = Some(relayer_signature);
        meta_tx.relayer_gas_price = gas_price;
        
        // Update stats
        self.stats.executed_transactions += 1;
        self.stats.pending_transactions -= 1;
        self.stats.total_gas_saved += gas_cost;
        self.stats.total_relayer_fees += relayer_fee;
        
        // Calculate execution time
        let execution_time = now - meta_tx.created_at;
        self.stats.average_execution_time = (self.stats.average_execution_time * (self.stats.executed_transactions - 1) as f64
                                           + execution_time as f64) / self.stats.executed_transactions as f64;
        
        Ok(())
    }

    /// Add funds to the subsidy pool
    pub fn add_to_subsidy_pool(&mut self, amount: u64) {
        self.subsidy_pool += amount;
    }

    /// Set subsidy for a user
    pub fn set_user_subsidy(&mut self, user: Pubkey, gas_limit: u64) {
        self.user_subsidies.insert(user, gas_limit);
    }

    /// Add contract to whitelist
    pub fn add_contract_to_whitelist(&mut self, contract: Pubkey) {
        self.contract_whitelist.insert(contract);
    }

    /// Remove contract from whitelist
    pub fn remove_contract_from_whitelist(&mut self, contract: &Pubkey) {
        self.contract_whitelist.remove(contract);
    }

    /// Check if a contract is whitelisted
    pub fn is_contract_whitelisted(&self, contract: &Pubkey) -> bool {
        self.contract_whitelist.contains(contract)
    }

    /// Get meta-transaction by hash
    pub fn get_meta_transaction(&self, hash: &Hash) -> Option<&MetaTransaction> {
        self.transactions.get(hash)
    }

    /// Get statistics
    pub fn get_stats(&self) -> GaslessStats {
        self.stats.clone()
    }

    /// Clean up expired transactions
    pub fn cleanup_expired_transactions(&mut self) -> usize {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        let mut expired_count = 0;
        
        for (hash, meta_tx) in self.transactions.iter_mut() {
            if meta_tx.status == MetaTransactionStatus::Pending && now > meta_tx.created_at + MAX_META_TX_AGE {
                meta_tx.status = MetaTransactionStatus::Expired;
                self.stats.expired_transactions += 1;
                self.stats.pending_transactions -= 1;
                expired_count += 1;
            }
        }
        
        expired_count
    }

    /// Validate a transaction
    fn validate_transaction(&self, transaction: &RollupTransaction) -> Result<(), ProgramError> {
        // Check if recipient is a whitelisted contract (if not transferring to a user)
        // This is a simplified check; in a real implementation, we would have more complex logic
        if !self.is_contract_whitelisted(&transaction.recipient) {
            // Check if user has a subsidy
            if !self.user_subsidies.contains_key(&transaction.sender) {
                return Err(ProgramError::InvalidArgument);
            }
            
            // Check if transaction gas limit is within user's subsidy
            let subsidy = self.user_subsidies.get(&transaction.sender).unwrap();
            if transaction.gas_limit > *subsidy {
                return Err(ProgramError::InvalidArgument);
            }
        }
        
        Ok(())
    }

    /// Get next nonce for a user
    fn get_next_nonce(&self, user: &Pubkey) -> u64 {
        self.nonces.get(user).unwrap_or(&0) + 1
    }

    /// Generate a hash for a meta-transaction
    fn generate_transaction_hash(
        &self,
        transaction: &RollupTransaction,
        user_signature: &[u8],
        nonce: u64,
        created_at: u64,
    ) -> Hash {
        let mut hasher = solana_program::hash::Hasher::default();
        hasher.hash(transaction.sender.as_ref());
        hasher.hash(transaction.recipient.as_ref());
        hasher.hash(&transaction.amount.to_le_bytes());
        hasher.hash(&transaction.data);
        hasher.hash(&transaction.nonce.to_le_bytes());
        hasher.hash(&transaction.gas_price.to_le_bytes());
        hasher.hash(&transaction.gas_limit.to_le_bytes());
        hasher.hash(user_signature);
        hasher.hash(&nonce.to_le_bytes());
        hasher.hash(&created_at.to_le_bytes());
        
        hasher.result()
    }

    /// Create an instruction to submit a meta-transaction
    pub fn create_submit_meta_transaction_instruction(
        program_id: &Pubkey,
        payer: &Pubkey,
        transaction: &RollupTransaction,
        user_signature: &[u8],
    ) -> Instruction {
        // Serialize instruction data
        let mut data = Vec::new();
        data.extend_from_slice(&[0]); // Instruction discriminator: 0 = SubmitMetaTransaction
        
        // Serialize transaction
        data.extend_from_slice(transaction.sender.as_ref());
        data.extend_from_slice(transaction.recipient.as_ref());
        data.extend_from_slice(&transaction.amount.to_le_bytes());
        
        // Serialize data length and data
        data.extend_from_slice(&(transaction.data.len() as u32).to_le_bytes());
        data.extend_from_slice(&transaction.data);
        
        // Serialize user signature length and signature
        data.extend_from_slice(&(user_signature.len() as u32).to_le_bytes());
        data.extend_from_slice(user_signature);
        
        data.extend_from_slice(&transaction.nonce.to_le_bytes());
        data.extend_from_slice(&transaction.gas_price.to_le_bytes());
        data.extend_from_slice(&transaction.gas_limit.to_le_bytes());
        
        Instruction {
            program_id: *program_id,
            accounts: vec![
                AccountMeta::new(*payer, true), // Payer account (signer)
                AccountMeta::new_readonly(transaction.sender, false), // Sender account
                AccountMeta::new(transaction.recipient, false), // Recipient account
            ],
            data,
        }
    }

    /// Create an instruction to execute a meta-transaction
    pub fn create_execute_meta_transaction_instruction(
        program_id: &Pubkey,
        relayer: &Pubkey,
        meta_tx_hash: &Hash,
        relayer_signature: &[u8],
        gas_price: u64,
    ) -> Instruction {
        // Serialize instruction data
        let mut data = Vec::new();
        data.extend_from_slice(&[1]); // Instruction discriminator: 1 = ExecuteMetaTransaction
        
        // Serialize meta-transaction hash
        data.extend_from_slice(meta_tx_hash.as_ref());
        
        // Serialize relayer signature length and signature
        data.extend_from_slice(&(relayer_signature.len() as u32).to_le_bytes());
        data.extend_from_slice(relayer_signature);
        
        // Serialize gas price
        data.extend_from_slice(&gas_price.to_le_bytes());
        
        Instruction {
            program_id: *program_id,
            accounts: vec![
                AccountMeta::new(*relayer, true), // Relayer account (signer)
            ],
            data,
        }
    }

    /// Create an instruction to add funds to the subsidy pool
    pub fn create_add_to_subsidy_pool_instruction(
        program_id: &Pubkey,
        payer: &Pubkey,
        amount: u64,
    ) -> Instruction {
        // Serialize instruction data
        let mut data = Vec::new();
        data.extend_from_slice(&[2]); // Instruction discriminator: 2 = AddToSubsidyPool
        
        // Serialize amount
        data.extend_from_slice(&amount.to_le_bytes());
        
        Instruction {
            program_id: *program_id,
            accounts: vec![
                AccountMeta::new(*payer, true), // Payer account (signer)
            ],
            data,
        }
    }

    /// Create an instruction to set a user subsidy
    pub fn create_set_user_subsidy_instruction(
        program_id: &Pubkey,
        admin: &Pubkey,
        user: &Pubkey,
        gas_limit: u64,
    ) -> Instruction {
        // Serialize instruction data
        let mut data = Vec::new();
        data.extend_from_slice(&[3]); // Instruction discriminator: 3 = SetUserSubsidy
        
        // Serialize user
        data.extend_from_slice(user.as_ref());
        
        // Serialize gas limit
        data.extend_from_slice(&gas_limit.to_le_bytes());
        
        Instruction {
            program_id: *program_id,
            accounts: vec![
                AccountMeta::new(*admin, true), // Admin account (signer)
                AccountMeta::new_readonly(*user, false), // User account
            ],
            data,
        }
    }
}

/// Tests for the Gasless Transactions system
#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;
    
    #[test]
    fn test_create_meta_transaction() {
        // Create gasless transactions system
        let relayer_account = Pubkey::new_unique();
        let relayer_config = RelayerConfig::default();
        let mut gasless = GaslessTransactions::new(relayer_config, relayer_account);
        
        // Add a contract to whitelist
        let contract = Pubkey::new_unique();
        gasless.add_contract_to_whitelist(contract);
        
        // Create transaction
        let sender = Pubkey::new_unique();
        let transaction = RollupTransaction {
            sender,
            recipient: contract, // Using whitelisted contract
            amount: 100,
            data: vec![],
            signature: vec![],
            nonce: 1,
            gas_price: 0, // Gasless
            gas_limit: 5,
        };
        
        // Set user subsidy
        gasless.set_user_subsidy(sender, 10);
        
        // Create meta-transaction
        let user_signature = vec![1, 2, 3]; // Dummy signature
        let hash = gasless.create_meta_transaction(transaction.clone(), user_signature.clone()).unwrap();
        
        // Verify meta-transaction was created
        let meta_tx = gasless.get_meta_transaction(&hash).unwrap();
        assert_eq!(meta_tx.transaction.sender, sender);
        assert_eq!(meta_tx.transaction.recipient, contract);
        assert_eq!(meta_tx.transaction.amount, 100);
        assert_eq!(meta_tx.status, MetaTransactionStatus::Pending);
        assert_eq!(meta_tx.user_signature, user_signature);
        assert_eq!(meta_tx.nonce, 1);
        
        // Verify stats
        let stats = gasless.get_stats();
        assert_eq!(stats.total_transactions, 1);
        assert_eq!(stats.pending_transactions, 1);
    }
    
    #[test]
    fn test_execute_meta_transaction() {
        // Create gasless transactions system
        let relayer_account = Pubkey::new_unique();
        let relayer_config = RelayerConfig::default();
        let mut gasless = GaslessTransactions::new(relayer_config, relayer_account);
        
        // Add a contract to whitelist
        let contract = Pubkey::new_unique();
        gasless.add_contract_to_whitelist(contract);
        
        // Create transaction
        let sender = Pubkey::new_unique();
        let transaction = RollupTransaction {
            sender,
            recipient: contract, // Using whitelisted contract
            amount: 100,
            data: vec![],
            signature: vec![],
            nonce: 1,
            gas_price: 0, // Gasless
            gas_limit: 5,
        };
        
        // Set user subsidy
        gasless.set_user_subsidy(sender, 10);
        
        // Create meta-transaction
        let user_signature = vec![1, 2, 3]; // Dummy signature
        let hash = gasless.create_meta_transaction(transaction.clone(), user_signature.clone()).unwrap();
        
        // Execute meta-transaction
        let relayer_signature = vec![4, 5, 6]; // Dummy signature
        let gas_price = 20;
        gasless.execute_meta_transaction(&hash, relayer_signature.clone(), gas_price).unwrap();
        
        // Verify meta-transaction was executed
        let meta_tx = gasless.get_meta_transaction(&hash).unwrap();
        assert_eq!(meta_tx.status, MetaTransactionStatus::Executed);
        assert_eq!(meta_tx.relayer, Some(relayer_account));
        assert_eq!(meta_tx.relayer_signature, Some(relayer_signature));
        assert_eq!(meta_tx.relayer_gas_price, gas_price);
        
        // Verify stats
        let stats = gasless.get_stats();
        assert_eq!(stats.total_transactions, 1);
        assert_eq!(stats.pending_transactions, 0);
        assert_eq!(stats.executed_transactions, 1);
        assert_eq!(stats.total_gas_saved, gas_price * transaction.gas_limit);
    }
    
    #[test]
    fn test_expired_meta_transaction() {
        // Create gasless transactions system with short expiration
        let relayer_account = Pubkey::new_unique();
        let relayer_config = RelayerConfig::default();
        let mut gasless = GaslessTransactions::new(relayer_config, relayer_account);
        
        // Override the MAX_META_TX_AGE constant for testing
        // In a real implementation, we would use a mock or dependency injection
        // Here we'll just create a transaction and manually set its timestamp to be old
        
        // Add a contract to whitelist
        let contract = Pubkey::new_unique();
        gasless.add_contract_to_whitelist(contract);
        
        // Create transaction
        let sender = Pubkey::new_unique();
        let transaction = RollupTransaction {
            sender,
            recipient: contract, // Using whitelisted contract
            amount: 100,
            data: vec![],
            signature: vec![],
            nonce: 1,
            gas_price: 0, // Gasless
            gas_limit: 5,
        };
        
        // Set user subsidy
        gasless.set_user_subsidy(sender, 10);
        
        // Create meta-transaction
        let user_signature = vec![1, 2, 3]; // Dummy signature
        let hash = gasless.create_meta_transaction(transaction.clone(), user_signature.clone()).unwrap();
        
        // Manually set the created_at timestamp to be old
        if let Some(meta_tx) = gasless.transactions.get_mut(&hash) {
            meta_tx.created_at = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() - MAX_META_TX_AGE - 1;
        }
        
        // Clean up expired transactions
        let expired_count = gasless.cleanup_expired_transactions();
        
        // Verify meta-transaction was expired
        assert_eq!(expired_count, 1);
        
        let meta_tx = gasless.get_meta_transaction(&hash).unwrap();
        assert_eq!(meta_tx.status, MetaTransactionStatus::Expired);
        
        // Verify stats
        let stats = gasless.get_stats();
        assert_eq!(stats.total_transactions, 1);
        assert_eq!(stats.pending_transactions, 0);
        assert_eq!(stats.expired_transactions, 1);
    }
    
    #[test]
    fn test_contract_whitelist() {
        // Create gasless transactions system
        let relayer_account = Pubkey::new_unique();
        let relayer_config = RelayerConfig::default();
        let mut gasless = GaslessTransactions::new(relayer_config, relayer_account);
        
        // Create contracts
        let contract1 = Pubkey::new_unique();
        let contract2 = Pubkey::new_unique();
        
        // Add contract1 to whitelist
        gasless.add_contract_to_whitelist(contract1);
        
        // Check whitelist
        assert!(gasless.is_contract_whitelisted(&contract1));
        assert!(!gasless.is_contract_whitelisted(&contract2));
        
        // Remove contract1 from whitelist
        gasless.remove_contract_from_whitelist(&contract1);
        
        // Check whitelist again
        assert!(!gasless.is_contract_whitelisted(&contract1));
    }
    
    #[test]
    fn test_user_subsidy() {
        // Create gasless transactions system
        let relayer_account = Pubkey::new_unique();
        let relayer_config = RelayerConfig::default();
        let mut gasless = GaslessTransactions::new(relayer_config, relayer_account);
        
        // Create user
        let user = Pubkey::new_unique();
        
        // Set user subsidy
        let gas_limit = 100;
        gasless.set_user_subsidy(user, gas_limit);
        
        // Check user subsidy
        assert_eq!(gasless.user_subsidies.get(&user), Some(&gas_limit));
    }
    
    #[test]
    fn test_subsidy_pool() {
        // Create gasless transactions system
        let relayer_account = Pubkey::new_unique();
        let relayer_config = RelayerConfig::default();
        let mut gasless = GaslessTransactions::new(relayer_config, relayer_account);
        
        // Add to subsidy pool
        let amount = 1000;
        gasless.add_to_subsidy_pool(amount);
        
        // Check subsidy pool
        assert_eq!(gasless.subsidy_pool, amount);
        
        // Add more to subsidy pool
        gasless.add_to_subsidy_pool(amount);
        
        // Check subsidy pool again
        assert_eq!(gasless.subsidy_pool, amount * 2);
    }
}
