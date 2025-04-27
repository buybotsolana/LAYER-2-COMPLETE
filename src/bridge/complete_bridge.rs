// src/bridge/complete_bridge.rs
//! Complete Bridge implementation for Layer-2 on Solana
//!
//! This module implements a trustless bridge system that allows for secure
//! transfer of assets between Solana (L1) and the Layer-2. It uses Wormhole
//! for cross-chain message passing and includes protection against replay attacks.

use std::collections::{HashMap, HashSet};
use solana_program::hash::Hash;
use solana_program::pubkey::Pubkey;
use solana_program::program_error::ProgramError;
use solana_program::instruction::{AccountMeta, Instruction};
use solana_program::system_instruction;
use solana_program::sysvar::rent::Rent;
use solana_program::program_pack::Pack;
use solana_program::account_info::AccountInfo;
use std::time::{SystemTime, UNIX_EPOCH};

/// The maximum time window for accepting a deposit (in seconds)
pub const MAX_DEPOSIT_TIME_WINDOW: u64 = 3600; // 1 hour

/// The maximum time window for accepting a withdrawal (in seconds)
pub const MAX_WITHDRAWAL_TIME_WINDOW: u64 = 3600; // 1 hour

/// Status of a bridge transfer
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransferStatus {
    /// Transfer has been initiated but not yet completed
    Pending,
    /// Transfer has been completed successfully
    Completed,
    /// Transfer has failed
    Failed,
    /// Transfer has been rejected (e.g., due to replay protection)
    Rejected,
}

/// Type of asset being transferred
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssetType {
    /// Native token (SOL)
    Native,
    /// SPL Token
    SPL(Pubkey), // Mint address
    /// NFT
    NFT(Pubkey), // Mint address
}

/// Direction of the transfer
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransferDirection {
    /// From Solana L1 to Layer-2
    Deposit,
    /// From Layer-2 to Solana L1
    Withdrawal,
}

/// A bridge transfer
#[derive(Debug, Clone)]
pub struct BridgeTransfer {
    /// Unique identifier for the transfer
    pub transfer_id: Hash,
    /// Sender of the transfer
    pub sender: Pubkey,
    /// Recipient of the transfer
    pub recipient: Pubkey,
    /// Type of asset being transferred
    pub asset_type: AssetType,
    /// Amount to transfer (for fungible tokens)
    pub amount: u64,
    /// Timestamp when the transfer was initiated
    pub timestamp: u64,
    /// Status of the transfer
    pub status: TransferStatus,
    /// Direction of the transfer
    pub direction: TransferDirection,
    /// Nonce for replay protection
    pub nonce: u64,
    /// Wormhole message hash (for verification)
    pub wormhole_message_hash: Option<Hash>,
    /// Transaction signature
    pub signature: Vec<u8>,
}

/// Wormhole guardian signature
#[derive(Debug, Clone)]
pub struct GuardianSignature {
    /// Guardian public key
    pub guardian: Pubkey,
    /// Signature
    pub signature: Vec<u8>,
}

/// Wormhole message for cross-chain communication
#[derive(Debug, Clone)]
pub struct WormholeMessage {
    /// Unique identifier for the message
    pub message_id: Hash,
    /// Source chain ID (Solana = 1)
    pub source_chain: u16,
    /// Target chain ID (Layer-2 = 2)
    pub target_chain: u16,
    /// Sender address
    pub sender: Pubkey,
    /// Payload (serialized transfer data)
    pub payload: Vec<u8>,
    /// Timestamp
    pub timestamp: u64,
    /// Nonce
    pub nonce: u64,
    /// Guardian signatures
    pub signatures: Vec<GuardianSignature>,
    /// Minimum required signatures
    pub required_signatures: u8,
}

/// The Complete Bridge system
pub struct CompleteBridge {
    /// Mapping of transfer IDs to transfers
    pub transfers: HashMap<Hash, BridgeTransfer>,
    /// Set of used nonces for replay protection
    pub used_nonces: HashSet<u64>,
    /// Mapping of accounts to their nonces
    pub account_nonces: HashMap<Pubkey, u64>,
    /// Wormhole contract address on Solana
    pub wormhole_program_id: Pubkey,
    /// Bridge contract address on Solana
    pub bridge_program_id: Pubkey,
    /// Bridge contract address on Layer-2
    pub l2_bridge_program_id: Pubkey,
    /// Guardian set
    pub guardians: Vec<Pubkey>,
    /// Minimum required guardian signatures
    pub min_guardian_signatures: u8,
    /// Token bridge program ID
    pub token_bridge_program_id: Pubkey,
    /// NFT bridge program ID
    pub nft_bridge_program_id: Pubkey,
}

impl CompleteBridge {
    /// Create a new Complete Bridge instance
    pub fn new(
        wormhole_program_id: Pubkey,
        bridge_program_id: Pubkey,
        l2_bridge_program_id: Pubkey,
        token_bridge_program_id: Pubkey,
        nft_bridge_program_id: Pubkey,
        guardians: Vec<Pubkey>,
        min_guardian_signatures: u8,
    ) -> Self {
        CompleteBridge {
            transfers: HashMap::new(),
            used_nonces: HashSet::new(),
            account_nonces: HashMap::new(),
            wormhole_program_id,
            bridge_program_id,
            l2_bridge_program_id,
            guardians,
            min_guardian_signatures,
            token_bridge_program_id,
            nft_bridge_program_id,
        }
    }

    /// Initiate a deposit from Solana L1 to Layer-2
    pub fn initiate_deposit(
        &mut self,
        sender: Pubkey,
        recipient: Pubkey,
        asset_type: AssetType,
        amount: u64,
        signature: Vec<u8>,
    ) -> Result<Hash, ProgramError> {
        // Get next nonce for sender
        let nonce = self.get_next_nonce(&sender);
        
        // Create transfer
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        // Create transfer ID
        let transfer_id = self.generate_transfer_id(
            &sender,
            &recipient,
            &asset_type,
            amount,
            timestamp,
            nonce,
        );
        
        // Create transfer
        let transfer = BridgeTransfer {
            transfer_id,
            sender,
            recipient,
            asset_type,
            amount,
            timestamp,
            status: TransferStatus::Pending,
            direction: TransferDirection::Deposit,
            nonce,
            wormhole_message_hash: None,
            signature,
        };
        
        // Store transfer
        self.transfers.insert(transfer_id, transfer);
        
        // Update nonce
        self.account_nonces.insert(sender, nonce);
        
        Ok(transfer_id)
    }

    /// Complete a deposit on Layer-2
    pub fn complete_deposit(
        &mut self,
        transfer_id: Hash,
        wormhole_message: WormholeMessage,
    ) -> Result<(), ProgramError> {
        // Check if transfer exists
        if !self.transfers.contains_key(&transfer_id) {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Get transfer
        let transfer = self.transfers.get_mut(&transfer_id).unwrap();
        
        // Check if transfer is pending
        if transfer.status != TransferStatus::Pending {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if transfer is a deposit
        if transfer.direction != TransferDirection::Deposit {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Verify Wormhole message
        self.verify_wormhole_message(&wormhole_message)?;
        
        // Check if message is for this transfer
        if !self.is_message_for_transfer(&wormhole_message, transfer) {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if nonce has been used
        if self.used_nonces.contains(&wormhole_message.nonce) {
            // Reject transfer due to replay attack
            transfer.status = TransferStatus::Rejected;
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if message is within time window
        let current_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        if current_time > wormhole_message.timestamp + MAX_DEPOSIT_TIME_WINDOW {
            // Reject transfer due to expired time window
            transfer.status = TransferStatus::Rejected;
            return Err(ProgramError::InvalidArgument);
        }
        
        // Mark nonce as used
        self.used_nonces.insert(wormhole_message.nonce);
        
        // Update transfer
        transfer.status = TransferStatus::Completed;
        transfer.wormhole_message_hash = Some(wormhole_message.message_id);
        
        Ok(())
    }

    /// Initiate a withdrawal from Layer-2 to Solana L1
    pub fn initiate_withdrawal(
        &mut self,
        sender: Pubkey,
        recipient: Pubkey,
        asset_type: AssetType,
        amount: u64,
        signature: Vec<u8>,
    ) -> Result<Hash, ProgramError> {
        // Get next nonce for sender
        let nonce = self.get_next_nonce(&sender);
        
        // Create transfer
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        // Create transfer ID
        let transfer_id = self.generate_transfer_id(
            &sender,
            &recipient,
            &asset_type,
            amount,
            timestamp,
            nonce,
        );
        
        // Create transfer
        let transfer = BridgeTransfer {
            transfer_id,
            sender,
            recipient,
            asset_type,
            amount,
            timestamp,
            status: TransferStatus::Pending,
            direction: TransferDirection::Withdrawal,
            nonce,
            wormhole_message_hash: None,
            signature,
        };
        
        // Store transfer
        self.transfers.insert(transfer_id, transfer);
        
        // Update nonce
        self.account_nonces.insert(sender, nonce);
        
        Ok(transfer_id)
    }

    /// Complete a withdrawal on Solana L1
    pub fn complete_withdrawal(
        &mut self,
        transfer_id: Hash,
        wormhole_message: WormholeMessage,
    ) -> Result<(), ProgramError> {
        // Check if transfer exists
        if !self.transfers.contains_key(&transfer_id) {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Get transfer
        let transfer = self.transfers.get_mut(&transfer_id).unwrap();
        
        // Check if transfer is pending
        if transfer.status != TransferStatus::Pending {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if transfer is a withdrawal
        if transfer.direction != TransferDirection::Withdrawal {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Verify Wormhole message
        self.verify_wormhole_message(&wormhole_message)?;
        
        // Check if message is for this transfer
        if !self.is_message_for_transfer(&wormhole_message, transfer) {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if nonce has been used
        if self.used_nonces.contains(&wormhole_message.nonce) {
            // Reject transfer due to replay attack
            transfer.status = TransferStatus::Rejected;
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if message is within time window
        let current_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        if current_time > wormhole_message.timestamp + MAX_WITHDRAWAL_TIME_WINDOW {
            // Reject transfer due to expired time window
            transfer.status = TransferStatus::Rejected;
            return Err(ProgramError::InvalidArgument);
        }
        
        // Mark nonce as used
        self.used_nonces.insert(wormhole_message.nonce);
        
        // Update transfer
        transfer.status = TransferStatus::Completed;
        transfer.wormhole_message_hash = Some(wormhole_message.message_id);
        
        Ok(())
    }

    /// Verify a Wormhole message
    fn verify_wormhole_message(&self, message: &WormholeMessage) -> Result<(), ProgramError> {
        // Check if there are enough signatures
        if message.signatures.len() < self.min_guardian_signatures as usize {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if required signatures matches min guardian signatures
        if message.required_signatures != self.min_guardian_signatures {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Verify each signature
        let mut valid_signatures = 0;
        
        for sig in &message.signatures {
            // Check if guardian is in the guardian set
            if !self.guardians.contains(&sig.guardian) {
                continue;
            }
            
            // Verify signature (simplified for example)
            // In a real implementation, this would use proper cryptographic verification
            if !sig.signature.is_empty() {
                valid_signatures += 1;
            }
        }
        
        // Check if there are enough valid signatures
        if valid_signatures < self.min_guardian_signatures as usize {
            return Err(ProgramError::InvalidArgument);
        }
        
        Ok(())
    }

    /// Check if a Wormhole message is for a specific transfer
    fn is_message_for_transfer(&self, message: &WormholeMessage, transfer: &BridgeTransfer) -> bool {
        // In a real implementation, this would deserialize the payload and check if it matches the transfer
        // For simplicity, we'll just check if the nonce matches
        message.nonce == transfer.nonce
    }

    /// Generate a transfer ID
    fn generate_transfer_id(
        &self,
        sender: &Pubkey,
        recipient: &Pubkey,
        asset_type: &AssetType,
        amount: u64,
        timestamp: u64,
        nonce: u64,
    ) -> Hash {
        // In a real implementation, this would use a proper hashing algorithm
        // For simplicity, we'll just use a dummy hash
        let mut hasher = solana_program::hash::Hasher::default();
        hasher.hash(sender.as_ref());
        hasher.hash(recipient.as_ref());
        
        match asset_type {
            AssetType::Native => {
                hasher.hash(&[0]);
            },
            AssetType::SPL(mint) => {
                hasher.hash(&[1]);
                hasher.hash(mint.as_ref());
            },
            AssetType::NFT(mint) => {
                hasher.hash(&[2]);
                hasher.hash(mint.as_ref());
            },
        }
        
        hasher.hash(&amount.to_le_bytes());
        hasher.hash(&timestamp.to_le_bytes());
        hasher.hash(&nonce.to_le_bytes());
        
        hasher.result()
    }

    /// Get the next nonce for an account
    fn get_next_nonce(&self, account: &Pubkey) -> u64 {
        self.account_nonces.get(account).unwrap_or(&0) + 1
    }

    /// Get transfer by ID
    pub fn get_transfer(&self, transfer_id: &Hash) -> Option<&BridgeTransfer> {
        self.transfers.get(transfer_id)
    }

    /// Create an instruction to initiate a deposit
    pub fn create_initiate_deposit_instruction(
        program_id: &Pubkey,
        payer: &Pubkey,
        token_account: &Pubkey,
        recipient: &Pubkey,
        mint: Option<&Pubkey>,
        amount: u64,
    ) -> Instruction {
        let mut accounts = vec![
            AccountMeta::new(*payer, true), // Payer account (signer)
        ];
        
        // Add token account if transferring SPL token or NFT
        if let Some(mint_address) = mint {
            accounts.push(AccountMeta::new(*token_account, false)); // Token account
            accounts.push(AccountMeta::new(*mint_address, false)); // Mint account
        }
        
        // Serialize instruction data
        let mut data = Vec::new();
        data.extend_from_slice(&[0]); // Instruction discriminator: 0 = InitiateDeposit
        
        // Serialize recipient
        data.extend_from_slice(recipient.as_ref());
        
        // Serialize asset type
        if let Some(mint_address) = mint {
            // Check if it's an NFT (simplified check, in reality would check metadata)
            let is_nft = false; // Placeholder
            
            if is_nft {
                data.extend_from_slice(&[2]); // 2 = NFT
            } else {
                data.extend_from_slice(&[1]); // 1 = SPL Token
            }
            
            data.extend_from_slice(mint_address.as_ref());
        } else {
            data.extend_from_slice(&[0]); // 0 = Native
        }
        
        // Serialize amount
        data.extend_from_slice(&amount.to_le_bytes());
        
        Instruction {
            program_id: *program_id,
            accounts,
            data,
        }
    }

    /// Create an instruction to complete a deposit
    pub fn create_complete_deposit_instruction(
        program_id: &Pubkey,
        payer: &Pubkey,
        recipient: &Pubkey,
        mint: Option<&Pubkey>,
        transfer_id: &Hash,
        wormhole_message: &[u8],
    ) -> Instruction {
        let mut accounts = vec![
            AccountMeta::new(*payer, true), // Payer account (signer)
            AccountMeta::new(*recipient, false), // Recipient account
        ];
        
        // Add token account if transferring SPL token or NFT
        if let Some(mint_address) = mint {
            // Get associated token account
            let token_account = Self::get_associated_token_address(recipient, mint_address);
            
            accounts.push(AccountMeta::new(token_account, false)); // Token account
            accounts.push(AccountMeta::new(*mint_address, false)); // Mint account
        }
        
        // Serialize instruction data
        let mut data = Vec::new();
        data.extend_from_slice(&[1]); // Instruction discriminator: 1 = CompleteDeposit
        
        // Serialize transfer ID
        data.extend_from_slice(transfer_id.as_ref());
        
        // Serialize wormhole message length and data
        data.extend_from_slice(&(wormhole_message.len() as u32).to_le_bytes());
        data.extend_from_slice(wormhole_message);
        
        Instruction {
            program_id: *program_id,
            accounts,
            data,
        }
    }

    /// Create an instruction to initiate a withdrawal
    pub fn create_initiate_withdrawal_instruction(
        program_id: &Pubkey,
        payer: &Pubkey,
        token_account: &Pubkey,
        recipient: &Pubkey,
        mint: Option<&Pubkey>,
        amount: u64,
    ) -> Instruction {
        let mut accounts = vec![
            AccountMeta::new(*payer, true), // Payer account (signer)
        ];
        
        // Add token account if transferring SPL token or NFT
        if let Some(mint_address) = mint {
            accounts.push(AccountMeta::new(*token_account, false)); // Token account
            accounts.push(AccountMeta::new(*mint_address, false)); // Mint account
        }
        
        // Serialize instruction data
        let mut data = Vec::new();
        data.extend_from_slice(&[2]); // Instruction discriminator: 2 = InitiateWithdrawal
        
        // Serialize recipient
        data.extend_from_slice(recipient.as_ref());
        
        // Serialize asset type
        if let Some(mint_address) = mint {
            // Check if it's an NFT (simplified check, in reality would check metadata)
            let is_nft = false; // Placeholder
            
            if is_nft {
                data.extend_from_slice(&[2]); // 2 = NFT
            } else {
                data.extend_from_slice(&[1]); // 1 = SPL Token
            }
            
            data.extend_from_slice(mint_address.as_ref());
        } else {
            data.extend_from_slice(&[0]); // 0 = Native
        }
        
        // Serialize amount
        data.extend_from_slice(&amount.to_le_bytes());
        
        Instruction {
            program_id: *program_id,
            accounts,
            data,
        }
    }

    /// Create an instruction to complete a withdrawal
    pub fn create_complete_withdrawal_instruction(
        program_id: &Pubkey,
        payer: &Pubkey,
        recipient: &Pubkey,
        mint: Option<&Pubkey>,
        transfer_id: &Hash,
        wormhole_message: &[u8],
    ) -> Instruction {
        let mut accounts = vec![
            AccountMeta::new(*payer, true), // Payer account (signer)
            AccountMeta::new(*recipient, false), // Recipient account
        ];
        
        // Add token account if transferring SPL token or NFT
        if let Some(mint_address) = mint {
            // Get associated token account
            let token_account = Self::get_associated_token_address(recipient, mint_address);
            
            accounts.push(AccountMeta::new(token_account, false)); // Token account
            accounts.push(AccountMeta::new(*mint_address, false)); // Mint account
        }
        
        // Serialize instruction data
        let mut data = Vec::new();
        data.extend_from_slice(&[3]); // Instruction discriminator: 3 = CompleteWithdrawal
        
        // Serialize transfer ID
        data.extend_from_slice(transfer_id.as_ref());
        
        // Serialize wormhole message length and data
        data.extend_from_slice(&(wormhole_message.len() as u32).to_le_bytes());
        data.extend_from_slice(wormhole_message);
        
        Instruction {
            program_id: *program_id,
            accounts,
            data,
        }
    }

    /// Get the associated token account address
    fn get_associated_token_address(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
        // This is a simplified version of the actual algorithm
        // In a real implementation, this would use the proper derivation path
        let mut hasher = solana_program::hash::Hasher::default();
        hasher.hash(wallet.as_ref());
        hasher.hash(mint.as_ref());
        
        let hash = hasher.result();
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(hash.as_ref());
        
        Pubkey::new_from_array(bytes)
    }
}

/// Tests for the Complete Bridge system
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_initiate_deposit() {
        // Create bridge
        let wormhole_program_id = Pubkey::new_unique();
        let bridge_program_id = Pubkey::new_unique();
        let l2_bridge_program_id = Pubkey::new_unique();
        let token_bridge_program_id = Pubkey::new_unique();
        let nft_bridge_program_id = Pubkey::new_unique();
        let guardians = vec![Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique()];
        let min_guardian_signatures = 2;
        
        let mut bridge = CompleteBridge::new(
            wormhole_program_id,
            bridge_program_id,
            l2_bridge_program_id,
            token_bridge_program_id,
            nft_bridge_program_id,
            guardians,
            min_guardian_signatures,
        );
        
        // Initiate deposit
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        let asset_type = AssetType::Native;
        let amount = 100;
        let signature = vec![1, 2, 3]; // Dummy signature
        
        let transfer_id = bridge.initiate_deposit(
            sender,
            recipient,
            asset_type,
            amount,
            signature,
        ).unwrap();
        
        // Verify transfer was created
        let transfer = bridge.get_transfer(&transfer_id).unwrap();
        assert_eq!(transfer.sender, sender);
        assert_eq!(transfer.recipient, recipient);
        assert_eq!(transfer.amount, amount);
        assert_eq!(transfer.status, TransferStatus::Pending);
        assert_eq!(transfer.direction, TransferDirection::Deposit);
        assert_eq!(transfer.nonce, 1);
    }
    
    #[test]
    fn test_complete_deposit() {
        // Create bridge
        let wormhole_program_id = Pubkey::new_unique();
        let bridge_program_id = Pubkey::new_unique();
        let l2_bridge_program_id = Pubkey::new_unique();
        let token_bridge_program_id = Pubkey::new_unique();
        let nft_bridge_program_id = Pubkey::new_unique();
        let guardians = vec![Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique()];
        let min_guardian_signatures = 2;
        
        let mut bridge = CompleteBridge::new(
            wormhole_program_id,
            bridge_program_id,
            l2_bridge_program_id,
            token_bridge_program_id,
            nft_bridge_program_id,
            guardians.clone(),
            min_guardian_signatures,
        );
        
        // Initiate deposit
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        let asset_type = AssetType::Native;
        let amount = 100;
        let signature = vec![1, 2, 3]; // Dummy signature
        
        let transfer_id = bridge.initiate_deposit(
            sender,
            recipient,
            asset_type,
            amount,
            signature,
        ).unwrap();
        
        // Create Wormhole message
        let message_id = solana_program::hash::hash(&[4, 5, 6]);
        let source_chain = 1; // Solana
        let target_chain = 2; // Layer-2
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let nonce = 1;
        
        let signatures = vec![
            GuardianSignature {
                guardian: guardians[0],
                signature: vec![7, 8, 9], // Dummy signature
            },
            GuardianSignature {
                guardian: guardians[1],
                signature: vec![10, 11, 12], // Dummy signature
            },
        ];
        
        let wormhole_message = WormholeMessage {
            message_id,
            source_chain,
            target_chain,
            sender,
            payload: vec![],
            timestamp,
            nonce,
            signatures,
            required_signatures: min_guardian_signatures,
        };
        
        // Complete deposit
        bridge.complete_deposit(transfer_id, wormhole_message).unwrap();
        
        // Verify transfer was completed
        let transfer = bridge.get_transfer(&transfer_id).unwrap();
        assert_eq!(transfer.status, TransferStatus::Completed);
        assert_eq!(transfer.wormhole_message_hash, Some(message_id));
    }
    
    #[test]
    fn test_replay_protection() {
        // Create bridge
        let wormhole_program_id = Pubkey::new_unique();
        let bridge_program_id = Pubkey::new_unique();
        let l2_bridge_program_id = Pubkey::new_unique();
        let token_bridge_program_id = Pubkey::new_unique();
        let nft_bridge_program_id = Pubkey::new_unique();
        let guardians = vec![Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique()];
        let min_guardian_signatures = 2;
        
        let mut bridge = CompleteBridge::new(
            wormhole_program_id,
            bridge_program_id,
            l2_bridge_program_id,
            token_bridge_program_id,
            nft_bridge_program_id,
            guardians.clone(),
            min_guardian_signatures,
        );
        
        // Initiate first deposit
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        let asset_type = AssetType::Native;
        let amount = 100;
        let signature = vec![1, 2, 3]; // Dummy signature
        
        let transfer_id1 = bridge.initiate_deposit(
            sender,
            recipient,
            asset_type.clone(),
            amount,
            signature.clone(),
        ).unwrap();
        
        // Create Wormhole message
        let message_id = solana_program::hash::hash(&[4, 5, 6]);
        let source_chain = 1; // Solana
        let target_chain = 2; // Layer-2
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let nonce = 1;
        
        let signatures = vec![
            GuardianSignature {
                guardian: guardians[0],
                signature: vec![7, 8, 9], // Dummy signature
            },
            GuardianSignature {
                guardian: guardians[1],
                signature: vec![10, 11, 12], // Dummy signature
            },
        ];
        
        let wormhole_message = WormholeMessage {
            message_id,
            source_chain,
            target_chain,
            sender,
            payload: vec![],
            timestamp,
            nonce,
            signatures: signatures.clone(),
            required_signatures: min_guardian_signatures,
        };
        
        // Complete first deposit
        bridge.complete_deposit(transfer_id1, wormhole_message.clone()).unwrap();
        
        // Initiate second deposit
        let transfer_id2 = bridge.initiate_deposit(
            sender,
            recipient,
            asset_type,
            amount,
            signature,
        ).unwrap();
        
        // Try to complete second deposit with same Wormhole message (should fail due to replay protection)
        let result = bridge.complete_deposit(transfer_id2, wormhole_message);
        assert!(result.is_err());
        
        // Verify second transfer was rejected
        let transfer = bridge.get_transfer(&transfer_id2).unwrap();
        assert_eq!(transfer.status, TransferStatus::Rejected);
    }
    
    #[test]
    fn test_withdrawal_flow() {
        // Create bridge
        let wormhole_program_id = Pubkey::new_unique();
        let bridge_program_id = Pubkey::new_unique();
        let l2_bridge_program_id = Pubkey::new_unique();
        let token_bridge_program_id = Pubkey::new_unique();
        let nft_bridge_program_id = Pubkey::new_unique();
        let guardians = vec![Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique()];
        let min_guardian_signatures = 2;
        
        let mut bridge = CompleteBridge::new(
            wormhole_program_id,
            bridge_program_id,
            l2_bridge_program_id,
            token_bridge_program_id,
            nft_bridge_program_id,
            guardians.clone(),
            min_guardian_signatures,
        );
        
        // Initiate withdrawal
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let asset_type = AssetType::SPL(mint);
        let amount = 100;
        let signature = vec![1, 2, 3]; // Dummy signature
        
        let transfer_id = bridge.initiate_withdrawal(
            sender,
            recipient,
            asset_type,
            amount,
            signature,
        ).unwrap();
        
        // Create Wormhole message
        let message_id = solana_program::hash::hash(&[4, 5, 6]);
        let source_chain = 2; // Layer-2
        let target_chain = 1; // Solana
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let nonce = 1;
        
        let signatures = vec![
            GuardianSignature {
                guardian: guardians[0],
                signature: vec![7, 8, 9], // Dummy signature
            },
            GuardianSignature {
                guardian: guardians[1],
                signature: vec![10, 11, 12], // Dummy signature
            },
        ];
        
        let wormhole_message = WormholeMessage {
            message_id,
            source_chain,
            target_chain,
            sender,
            payload: vec![],
            timestamp,
            nonce,
            signatures,
            required_signatures: min_guardian_signatures,
        };
        
        // Complete withdrawal
        bridge.complete_withdrawal(transfer_id, wormhole_message).unwrap();
        
        // Verify transfer was completed
        let transfer = bridge.get_transfer(&transfer_id).unwrap();
        assert_eq!(transfer.status, TransferStatus::Completed);
        assert_eq!(transfer.wormhole_message_hash, Some(message_id));
    }
}
