// src/bridge/token_registry.rs
//! Token Registry implementation for the Bridge module
//! 
//! This module provides a registry for tokens that can be bridged between
//! Ethereum (L1) and Solana Layer-2, ensuring that only registered tokens
//! can be transferred through the bridge.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;

/// Token information
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct TokenInfo {
    /// L1 token address
    pub l1_address: [u8; 20],
    
    /// L2 token address
    pub l2_address: [u8; 32],
    
    /// Token name
    pub name: String,
    
    /// Token symbol
    pub symbol: String,
    
    /// Token decimals
    pub decimals: u8,
    
    /// Registration timestamp
    pub registration_timestamp: u64,
    
    /// Is active
    pub is_active: bool,
}

/// Token registry for the bridge
pub struct TokenRegistry {
    /// Tokens by L1 address
    pub tokens_by_l1: HashMap<[u8; 20], TokenInfo>,
    
    /// Tokens by L2 address
    pub tokens_by_l2: HashMap<[u8; 32], TokenInfo>,
}

impl TokenRegistry {
    /// Create a new token registry
    pub fn new() -> Self {
        Self {
            tokens_by_l1: HashMap::new(),
            tokens_by_l2: HashMap::new(),
        }
    }
    
    /// Initialize the token registry
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        // In a real implementation, we would initialize the token registry
        // with accounts and other data
        
        // Add native token (ETH) as registered
        let eth_l1 = [0; 20];
        let eth_l2 = [0; 32];
        
        self.register_token(
            eth_l1,
            eth_l2,
            "Ethereum".to_string(),
            "ETH".to_string(),
            18,
        ).map_err(|e| {
            msg!("Error registering native token: {}", e);
            ProgramError::InvalidArgument
        })?;
        
        Ok(())
    }
    
    /// Register a token
    pub fn register_token(
        &mut self,
        l1_address: [u8; 20],
        l2_address: [u8; 32],
        name: String,
        symbol: String,
        decimals: u8,
    ) -> Result<(), String> {
        // Check if the token is already registered
        if self.tokens_by_l1.contains_key(&l1_address) {
            return Err(format!("Token with L1 address {:?} is already registered", l1_address));
        }
        
        if self.tokens_by_l2.contains_key(&l2_address) {
            return Err(format!("Token with L2 address {:?} is already registered", l2_address));
        }
        
        // Get the current timestamp
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        // Create the token info
        let token_info = TokenInfo {
            l1_address,
            l2_address,
            name,
            symbol,
            decimals,
            registration_timestamp: now,
            is_active: true,
        };
        
        // Add the token
        self.tokens_by_l1.insert(l1_address, token_info.clone());
        self.tokens_by_l2.insert(l2_address, token_info);
        
        Ok(())
    }
    
    /// Unregister a token
    pub fn unregister_token(
        &mut self,
        l1_address: [u8; 20],
    ) -> Result<(), String> {
        // Check if the token is registered
        let token_info = match self.tokens_by_l1.get_mut(&l1_address) {
            Some(info) => info,
            None => return Err(format!("Token with L1 address {:?} is not registered", l1_address)),
        };
        
        // Deactivate the token
        token_info.is_active = false;
        
        // Update the token in the L2 map
        if let Some(info) = self.tokens_by_l2.get_mut(&token_info.l2_address) {
            info.is_active = false;
        }
        
        Ok(())
    }
    
    /// Check if a token is registered
    pub fn is_token_registered(
        &self,
        l1_address: [u8; 20],
    ) -> bool {
        match self.tokens_by_l1.get(&l1_address) {
            Some(info) => info.is_active,
            None => false,
        }
    }
    
    /// Get token info by L1 address
    pub fn get_token_by_l1(
        &self,
        l1_address: [u8; 20],
    ) -> Option<&TokenInfo> {
        self.tokens_by_l1.get(&l1_address)
    }
    
    /// Get token info by L2 address
    pub fn get_token_by_l2(
        &self,
        l2_address: [u8; 32],
    ) -> Option<&TokenInfo> {
        self.tokens_by_l2.get(&l2_address)
    }
    
    /// Get all registered tokens
    pub fn get_all_tokens(&self) -> Vec<&TokenInfo> {
        self.tokens_by_l1.values().filter(|info| info.is_active).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_token_registry() {
        // Create a token registry
        let mut registry = TokenRegistry::new();
        
        // Register a token
        let l1_address = [1; 20];
        let l2_address = [2; 32];
        let name = "Test Token".to_string();
        let symbol = "TEST".to_string();
        let decimals = 18;
        
        let result = registry.register_token(
            l1_address,
            l2_address,
            name.clone(),
            symbol.clone(),
            decimals,
        );
        
        assert!(result.is_ok());
        
        // Check if the token is registered
        assert!(registry.is_token_registered(l1_address));
        
        // Get the token info
        let token_info = registry.get_token_by_l1(l1_address).unwrap();
        assert_eq!(token_info.l1_address, l1_address);
        assert_eq!(token_info.l2_address, l2_address);
        assert_eq!(token_info.name, name);
        assert_eq!(token_info.symbol, symbol);
        assert_eq!(token_info.decimals, decimals);
        assert!(token_info.is_active);
        
        // Unregister the token
        let result = registry.unregister_token(l1_address);
        assert!(result.is_ok());
        
        // Check if the token is unregistered
        assert!(!registry.is_token_registered(l1_address));
        
        // Get all tokens
        let all_tokens = registry.get_all_tokens();
        assert_eq!(all_tokens.len(), 0);
    }
}
