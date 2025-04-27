// src/interfaces/fee_optimization_interface.rs
//! Fee Optimization Interface for Layer-2 on Solana
//!
//! This module defines the interface for interacting with the fee optimization system.
//! It provides a clean abstraction layer over the fee optimization implementation details.

use solana_program::hash::Hash;
use solana_program::pubkey::Pubkey;
use solana_program::program_error::ProgramError;
use std::sync::{Arc, Mutex};

use crate::rollup::optimistic_rollup::RollupTransaction;
use crate::fee_optimization::{
    GaslessTransactions, RelayerConfig, GaslessStats, MetaTransaction, MetaTransactionStatus
};

/// Interface for interacting with the fee optimization system
pub trait FeeOptimizationInterface {
    /// Create a meta-transaction
    fn create_meta_transaction(
        &mut self,
        transaction: RollupTransaction,
        user_signature: Vec<u8>,
    ) -> Result<Hash, ProgramError>;
    
    /// Execute a meta-transaction
    fn execute_meta_transaction(
        &mut self,
        hash: &Hash,
        relayer_signature: Vec<u8>,
        gas_price: u64,
    ) -> Result<(), ProgramError>;
    
    /// Add funds to the subsidy pool
    fn add_to_subsidy_pool(&mut self, amount: u64);
    
    /// Set subsidy for a user
    fn set_user_subsidy(&mut self, user: Pubkey, gas_limit: u64);
    
    /// Add contract to whitelist
    fn add_contract_to_whitelist(&mut self, contract: Pubkey);
    
    /// Remove contract from whitelist
    fn remove_contract_from_whitelist(&mut self, contract: &Pubkey);
    
    /// Check if a contract is whitelisted
    fn is_contract_whitelisted(&self, contract: &Pubkey) -> bool;
    
    /// Get meta-transaction by hash
    fn get_meta_transaction(&self, hash: &Hash) -> Option<MetaTransaction>;
    
    /// Get statistics
    fn get_stats(&self) -> GaslessStats;
    
    /// Clean up expired transactions
    fn cleanup_expired_transactions(&mut self) -> usize;
}

/// Implementation of the fee optimization interface using the GaslessTransactions
pub struct FeeOptimizationInterfaceImpl {
    /// The underlying gasless transactions instance
    gasless: Arc<Mutex<GaslessTransactions>>,
}

impl FeeOptimizationInterfaceImpl {
    /// Create a new fee optimization interface instance
    pub fn new(gasless: Arc<Mutex<GaslessTransactions>>) -> Self {
        FeeOptimizationInterfaceImpl { gasless }
    }
}

impl FeeOptimizationInterface for FeeOptimizationInterfaceImpl {
    fn create_meta_transaction(
        &mut self,
        transaction: RollupTransaction,
        user_signature: Vec<u8>,
    ) -> Result<Hash, ProgramError> {
        let mut gasless = self.gasless.lock().unwrap();
        gasless.create_meta_transaction(transaction, user_signature)
    }
    
    fn execute_meta_transaction(
        &mut self,
        hash: &Hash,
        relayer_signature: Vec<u8>,
        gas_price: u64,
    ) -> Result<(), ProgramError> {
        let mut gasless = self.gasless.lock().unwrap();
        gasless.execute_meta_transaction(hash, relayer_signature, gas_price)
    }
    
    fn add_to_subsidy_pool(&mut self, amount: u64) {
        let mut gasless = self.gasless.lock().unwrap();
        gasless.add_to_subsidy_pool(amount);
    }
    
    fn set_user_subsidy(&mut self, user: Pubkey, gas_limit: u64) {
        let mut gasless = self.gasless.lock().unwrap();
        gasless.set_user_subsidy(user, gas_limit);
    }
    
    fn add_contract_to_whitelist(&mut self, contract: Pubkey) {
        let mut gasless = self.gasless.lock().unwrap();
        gasless.add_contract_to_whitelist(contract);
    }
    
    fn remove_contract_from_whitelist(&mut self, contract: &Pubkey) {
        let mut gasless = self.gasless.lock().unwrap();
        gasless.remove_contract_from_whitelist(contract);
    }
    
    fn is_contract_whitelisted(&self, contract: &Pubkey) -> bool {
        let gasless = self.gasless.lock().unwrap();
        gasless.is_contract_whitelisted(contract)
    }
    
    fn get_meta_transaction(&self, hash: &Hash) -> Option<MetaTransaction> {
        let gasless = self.gasless.lock().unwrap();
        gasless.get_meta_transaction(hash).cloned()
    }
    
    fn get_stats(&self) -> GaslessStats {
        let gasless = self.gasless.lock().unwrap();
        gasless.get_stats()
    }
    
    fn cleanup_expired_transactions(&mut self) -> usize {
        let mut gasless = self.gasless.lock().unwrap();
        gasless.cleanup_expired_transactions()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_fee_optimization_interface() {
        // Create gasless transactions system
        let relayer_account = Pubkey::new_unique();
        let relayer_config = RelayerConfig::default();
        let gasless = Arc::new(Mutex::new(
            GaslessTransactions::new(relayer_config, relayer_account)
        ));
        
        // Create interface
        let mut interface = FeeOptimizationInterfaceImpl::new(Arc::clone(&gasless));
        
        // Add a contract to whitelist
        let contract = Pubkey::new_unique();
        interface.add_contract_to_whitelist(contract);
        
        // Verify contract is whitelisted
        assert!(interface.is_contract_whitelisted(&contract));
        
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
        interface.set_user_subsidy(sender, 10);
        
        // Create meta-transaction
        let user_signature = vec![1, 2, 3]; // Dummy signature
        let hash = interface.create_meta_transaction(transaction.clone(), user_signature.clone()).unwrap();
        
        // Verify meta-transaction was created
        let meta_tx = interface.get_meta_transaction(&hash).unwrap();
        assert_eq!(meta_tx.transaction.sender, sender);
        assert_eq!(meta_tx.transaction.recipient, contract);
        assert_eq!(meta_tx.transaction.amount, 100);
        assert_eq!(meta_tx.status, MetaTransactionStatus::Pending);
        assert_eq!(meta_tx.user_signature, user_signature);
        
        // Verify stats
        let stats = interface.get_stats();
        assert_eq!(stats.total_transactions, 1);
        assert_eq!(stats.pending_transactions, 1);
        
        // Execute meta-transaction
        let relayer_signature = vec![4, 5, 6]; // Dummy signature
        let gas_price = 20;
        interface.execute_meta_transaction(&hash, relayer_signature.clone(), gas_price).unwrap();
        
        // Verify meta-transaction was executed
        let meta_tx = interface.get_meta_transaction(&hash).unwrap();
        assert_eq!(meta_tx.status, MetaTransactionStatus::Executed);
        assert_eq!(meta_tx.relayer, Some(relayer_account));
        assert_eq!(meta_tx.relayer_signature, Some(relayer_signature));
        
        // Verify stats after execution
        let stats = interface.get_stats();
        assert_eq!(stats.total_transactions, 1);
        assert_eq!(stats.pending_transactions, 0);
        assert_eq!(stats.executed_transactions, 1);
    }
}
