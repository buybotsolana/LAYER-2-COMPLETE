// src/bridge/security_module.rs
//! Security Module implementation for the Bridge module
//! 
//! This module provides security verification for bridge operations,
//! ensuring that deposits and withdrawals are legitimate and safe.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;

use super::deposit_handler::Deposit;
use super::withdrawal_handler::Withdrawal;

/// Security level for bridge operations
#[derive(Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum SecurityLevel {
    /// Low security (faster, less secure)
    Low,
    
    /// Medium security (balanced)
    Medium,
    
    /// High security (slower, more secure)
    High,
    
    /// Maximum security (slowest, most secure)
    Maximum,
}

/// Verification result for security checks
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerificationResult {
    /// Operation is approved
    Approved,
    
    /// Operation is rejected with reason
    Rejected(String),
    
    /// Operation is pending further verification
    Pending,
}

/// Security module for the bridge
pub struct SecurityModule {
    /// Security level
    pub security_level: SecurityLevel,
    
    /// Blacklisted L1 addresses
    pub blacklisted_l1_addresses: Vec<[u8; 20]>,
    
    /// Blacklisted L2 addresses
    pub blacklisted_l2_addresses: Vec<[u8; 32]>,
    
    /// Suspicious transaction patterns
    pub suspicious_patterns: Vec<String>,
    
    /// Risk scores for L1 addresses
    pub l1_risk_scores: HashMap<[u8; 20], u8>,
    
    /// Risk scores for L2 addresses
    pub l2_risk_scores: HashMap<[u8; 32], u8>,
}

impl SecurityModule {
    /// Create a new security module
    pub fn new() -> Self {
        Self {
            security_level: SecurityLevel::High,
            blacklisted_l1_addresses: Vec::new(),
            blacklisted_l2_addresses: Vec::new(),
            suspicious_patterns: Vec::new(),
            l1_risk_scores: HashMap::new(),
            l2_risk_scores: HashMap::new(),
        }
    }
    
    /// Initialize the security module
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        // In a real implementation, we would initialize the security module
        // with accounts and other data
        
        // Add some default suspicious patterns
        self.suspicious_patterns.push("multiple_small_deposits".to_string());
        self.suspicious_patterns.push("large_withdrawal_after_deposit".to_string());
        self.suspicious_patterns.push("rapid_deposit_withdrawal_cycle".to_string());
        
        Ok(())
    }
    
    /// Set the security level
    pub fn set_security_level(&mut self, level: SecurityLevel) {
        self.security_level = level;
    }
    
    /// Add a blacklisted L1 address
    pub fn add_blacklisted_l1_address(&mut self, address: [u8; 20]) {
        if !self.blacklisted_l1_addresses.contains(&address) {
            self.blacklisted_l1_addresses.push(address);
        }
    }
    
    /// Remove a blacklisted L1 address
    pub fn remove_blacklisted_l1_address(&mut self, address: [u8; 20]) {
        self.blacklisted_l1_addresses.retain(|a| a != &address);
    }
    
    /// Add a blacklisted L2 address
    pub fn add_blacklisted_l2_address(&mut self, address: [u8; 32]) {
        if !self.blacklisted_l2_addresses.contains(&address) {
            self.blacklisted_l2_addresses.push(address);
        }
    }
    
    /// Remove a blacklisted L2 address
    pub fn remove_blacklisted_l2_address(&mut self, address: [u8; 32]) {
        self.blacklisted_l2_addresses.retain(|a| a != &address);
    }
    
    /// Set the risk score for an L1 address
    pub fn set_l1_risk_score(&mut self, address: [u8; 20], score: u8) {
        self.l1_risk_scores.insert(address, score);
    }
    
    /// Set the risk score for an L2 address
    pub fn set_l2_risk_score(&mut self, address: [u8; 32], score: u8) {
        self.l2_risk_scores.insert(address, score);
    }
    
    /// Get the risk score for an L1 address
    pub fn get_l1_risk_score(&self, address: [u8; 20]) -> u8 {
        *self.l1_risk_scores.get(&address).unwrap_or(&0)
    }
    
    /// Get the risk score for an L2 address
    pub fn get_l2_risk_score(&self, address: [u8; 32]) -> u8 {
        *self.l2_risk_scores.get(&address).unwrap_or(&0)
    }
    
    /// Verify a deposit
    pub fn verify_deposit(&self, deposit: &Deposit) -> Result<VerificationResult, String> {
        // Check if the L1 sender is blacklisted
        if self.blacklisted_l1_addresses.contains(&deposit.l1_sender) {
            return Ok(VerificationResult::Rejected(format!("L1 sender {:?} is blacklisted", deposit.l1_sender)));
        }
        
        // Check if the L2 recipient is blacklisted
        if self.blacklisted_l2_addresses.contains(&deposit.l2_recipient) {
            return Ok(VerificationResult::Rejected(format!("L2 recipient {:?} is blacklisted", deposit.l2_recipient)));
        }
        
        // Check the risk scores
        let l1_risk_score = self.get_l1_risk_score(deposit.l1_sender);
        let l2_risk_score = self.get_l2_risk_score(deposit.l2_recipient);
        
        // Apply security level-specific checks
        match self.security_level {
            SecurityLevel::Low => {
                // For low security, only reject if both addresses have high risk scores
                if l1_risk_score >= 80 && l2_risk_score >= 80 {
                    return Ok(VerificationResult::Rejected(format!("High risk scores: L1={}, L2={}", l1_risk_score, l2_risk_score)));
                }
            },
            SecurityLevel::Medium => {
                // For medium security, reject if either address has a very high risk score
                if l1_risk_score >= 90 || l2_risk_score >= 90 {
                    return Ok(VerificationResult::Rejected(format!("Very high risk scores: L1={}, L2={}", l1_risk_score, l2_risk_score)));
                }
                
                // Or if both have moderately high risk scores
                if l1_risk_score >= 70 && l2_risk_score >= 70 {
                    return Ok(VerificationResult::Rejected(format!("High risk scores: L1={}, L2={}", l1_risk_score, l2_risk_score)));
                }
            },
            SecurityLevel::High => {
                // For high security, reject if either address has a high risk score
                if l1_risk_score >= 70 || l2_risk_score >= 70 {
                    return Ok(VerificationResult::Rejected(format!("High risk scores: L1={}, L2={}", l1_risk_score, l2_risk_score)));
                }
                
                // Or if both have moderate risk scores
                if l1_risk_score >= 50 && l2_risk_score >= 50 {
                    return Ok(VerificationResult::Rejected(format!("Moderate risk scores: L1={}, L2={}", l1_risk_score, l2_risk_score)));
                }
            },
            SecurityLevel::Maximum => {
                // For maximum security, reject if either address has a moderate risk score
                if l1_risk_score >= 50 || l2_risk_score >= 50 {
                    return Ok(VerificationResult::Rejected(format!("Moderate risk scores: L1={}, L2={}", l1_risk_score, l2_risk_score)));
                }
                
                // Or if both have low risk scores
                if l1_risk_score >= 30 && l2_risk_score >= 30 {
                    return Ok(VerificationResult::Rejected(format!("Low risk scores: L1={}, L2={}", l1_risk_score, l2_risk_score)));
                }
            },
        }
        
        // If we get here, the deposit is approved
        Ok(VerificationResult::Approved)
    }
    
    /// Verify a withdrawal
    pub fn verify_withdrawal(&self, withdrawal: &Withdrawal) -> Result<VerificationResult, String> {
        // Check if the L2 sender is blacklisted
        if self.blacklisted_l2_addresses.contains(&withdrawal.l2_sender) {
            return Ok(VerificationResult::Rejected(format!("L2 sender {:?} is blacklisted", withdrawal.l2_sender)));
        }
        
        // Check if the L1 recipient is blacklisted
        if self.blacklisted_l1_addresses.contains(&withdrawal.l1_recipient) {
            return Ok(VerificationResult::Rejected(format!("L1 recipient {:?} is blacklisted", withdrawal.l1_recipient)));
        }
        
        // Check the risk scores
        let l2_risk_score = self.get_l2_risk_score(withdrawal.l2_sender);
        let l1_risk_score = self.get_l1_risk_score(withdrawal.l1_recipient);
        
        // Apply security level-specific checks
        match self.security_level {
            SecurityLevel::Low => {
                // For low security, only reject if both addresses have high risk scores
                if l2_risk_score >= 80 && l1_risk_score >= 80 {
                    return Ok(VerificationResult::Rejected(format!("High risk scores: L2={}, L1={}", l2_risk_score, l1_risk_score)));
                }
            },
            SecurityLevel::Medium => {
                // For medium security, reject if either address has a very high risk score
                if l2_risk_score >= 90 || l1_risk_score >= 90 {
                    return Ok(VerificationResult::Rejected(format!("Very high risk scores: L2={}, L1={}", l2_risk_score, l1_risk_score)));
                }
                
                // Or if both have moderately high risk scores
                if l2_risk_score >= 70 && l1_risk_score >= 70 {
                    return Ok(VerificationResult::Rejected(format!("High risk scores: L2={}, L1={}", l2_risk_score, l1_risk_score)));
                }
            },
            SecurityLevel::High => {
                // For high security, reject if either address has a high risk score
                if l2_risk_score >= 70 || l1_risk_score >= 70 {
                    return Ok(VerificationResult::Rejected(format!("High risk scores: L2={}, L1={}", l2_risk_score, l1_risk_score)));
                }
                
                // Or if both have moderate risk scores
                if l2_risk_score >= 50 && l1_risk_score >= 50 {
                    return Ok(VerificationResult::Rejected(format!("Moderate risk scores: L2={}, L1={}", l2_risk_score, l1_risk_score)));
                }
            },
            SecurityLevel::Maximum => {
                // For maximum security, reject if either address has a moderate risk score
                if l2_risk_score >= 50 || l1_risk_score >= 50 {
                    return Ok(VerificationResult::Rejected(format!("Moderate risk scores: L2={}, L1={}", l2_risk_score, l1_risk_score)));
                }
                
                // Or if both have low risk scores
                if l2_risk_score >= 30 && l1_risk_score >= 30 {
                    return Ok(VerificationResult::Rejected(format!("Low risk scores: L2={}, L1={}", l2_risk_score, l1_risk_score)));
                }
            },
        }
        
        // If we get here, the withdrawal is approved
        Ok(VerificationResult::Approved)
    }
    
    /// Detect suspicious patterns
    pub fn detect_suspicious_patterns(&self, address: [u8; 32], recent_deposits: &[Deposit], recent_withdrawals: &[Withdrawal]) -> Vec<String> {
        let mut detected_patterns = Vec::new();
        
        // Check for multiple small deposits
        let small_deposits = recent_deposits.iter()
            .filter(|d| d.l2_recipient == address && d.amount < 1_000_000)
            .count();
        
        if small_deposits >= 5 {
            detected_patterns.push("multiple_small_deposits".to_string());
        }
        
        // Check for large withdrawal after deposit
        let has_large_withdrawal_after_deposit = recent_deposits.iter()
            .any(|d| d.l2_recipient == address)
            && recent_withdrawals.iter()
                .any(|w| w.l2_sender == address && w.amount > 10_000_000);
        
        if has_large_withdrawal_after_deposit {
            detected_patterns.push("large_withdrawal_after_deposit".to_string());
        }
        
        // Check for rapid deposit-withdrawal cycle
        let has_rapid_cycle = recent_deposits.iter()
            .filter(|d| d.l2_recipient == address)
            .zip(recent_withdrawals.iter().filter(|w| w.l2_sender == address))
            .any(|(d, w)| w.timestamp - d.timestamp < 3600); // Less than 1 hour
        
        if has_rapid_cycle {
            detected_patterns.push("rapid_deposit_withdrawal_cycle".to_string());
        }
        
        detected_patterns
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::deposit_handler::DepositStatus;
    use crate::bridge::withdrawal_handler::WithdrawalStatus;
    
    #[test]
    fn test_security_module() {
        // Create a security module
        let mut security_module = SecurityModule::new();
        
        // Test blacklisting
        let l1_address = [1; 20];
        let l2_address = [2; 32];
        
        security_module.add_blacklisted_l1_address(l1_address);
        security_module.add_blacklisted_l2_address(l2_address);
        
        assert!(security_module.blacklisted_l1_addresses.contains(&l1_address));
        assert!(security_module.blacklisted_l2_addresses.contains(&l2_address));
        
        // Test risk scores
        let l1_address2 = [3; 20];
        let l2_address2 = [4; 32];
        
        security_module.set_l1_risk_score(l1_address2, 75);
        security_module.set_l2_risk_score(l2_address2, 60);
        
        assert_eq!(security_module.get_l1_risk_score(l1_address2), 75);
        assert_eq!(security_module.get_l2_risk_score(l2_address2), 60);
        
        // Test deposit verification with blacklisted address
        let deposit = Deposit {
            id: [0; 32],
            l1_tx_hash: [0; 32],
            l1_block_number: 0,
            l1_sender: l1_address,
            l2_recipient: [0; 32],
            token: [0; 20],
            amount: 0,
            timestamp: 0,
            status: DepositStatus::Pending,
            l2_tx_hash: None,
        };
        
        let result = security_module.verify_deposit(&deposit).unwrap();
        assert!(matches!(result, VerificationResult::Rejected(_)));
        
        // Test withdrawal verification with blacklisted address
        let withdrawal = Withdrawal {
            id: [0; 32],
            l2_tx_hash: [0; 32],
            l2_block_number: 0,
            l2_sender: l2_address,
            l1_recipient: [0; 20],
            token: [0; 20],
            amount: 0,
            timestamp: 0,
            status: WithdrawalStatus::Pending,
            l1_tx_hash: None,
        };
        
        let result = security_module.verify_withdrawal(&withdrawal).unwrap();
        assert!(matches!(result, VerificationResult::Rejected(_)));
        
        // Test security level changes
        security_module.set_security_level(SecurityLevel::Low);
        assert_eq!(security_module.security_level, SecurityLevel::Low);
        
        security_module.set_security_level(SecurityLevel::Maximum);
        assert_eq!(security_module.security_level, SecurityLevel::Maximum);
    }
}
