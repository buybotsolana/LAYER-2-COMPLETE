// src/interfaces/bridge_interface.rs
//! Bridge Interface for Layer-2 on Solana
//!
//! This module defines the interface for interacting with the bridge system.
//! It provides a clean abstraction layer over the bridge implementation details.

use solana_program::hash::Hash;
use solana_program::pubkey::Pubkey;
use solana_program::program_error::ProgramError;
use std::sync::{Arc, Mutex};

use crate::bridge::{
    CompleteBridge, BridgeTransfer, TransferStatus, AssetType, TransferDirection,
    WormholeMessage
};

/// Interface for interacting with the bridge system
pub trait BridgeInterface {
    /// Initiate a deposit from Solana L1 to Layer-2
    fn initiate_deposit(
        &mut self,
        sender: Pubkey,
        recipient: Pubkey,
        asset_type: AssetType,
        amount: u64,
        signature: Vec<u8>,
    ) -> Result<Hash, ProgramError>;
    
    /// Complete a deposit on Layer-2
    fn complete_deposit(
        &mut self,
        transfer_id: Hash,
        wormhole_message: WormholeMessage,
    ) -> Result<(), ProgramError>;
    
    /// Initiate a withdrawal from Layer-2 to Solana L1
    fn initiate_withdrawal(
        &mut self,
        sender: Pubkey,
        recipient: Pubkey,
        asset_type: AssetType,
        amount: u64,
        signature: Vec<u8>,
    ) -> Result<Hash, ProgramError>;
    
    /// Complete a withdrawal on Solana L1
    fn complete_withdrawal(
        &mut self,
        transfer_id: Hash,
        wormhole_message: WormholeMessage,
    ) -> Result<(), ProgramError>;
    
    /// Get transfer by ID
    fn get_transfer(&self, transfer_id: &Hash) -> Option<BridgeTransfer>;
}

/// Implementation of the bridge interface using the CompleteBridge
pub struct BridgeInterfaceImpl {
    /// The underlying bridge instance
    bridge: Arc<Mutex<CompleteBridge>>,
}

impl BridgeInterfaceImpl {
    /// Create a new bridge interface instance
    pub fn new(bridge: Arc<Mutex<CompleteBridge>>) -> Self {
        BridgeInterfaceImpl { bridge }
    }
}

impl BridgeInterface for BridgeInterfaceImpl {
    fn initiate_deposit(
        &mut self,
        sender: Pubkey,
        recipient: Pubkey,
        asset_type: AssetType,
        amount: u64,
        signature: Vec<u8>,
    ) -> Result<Hash, ProgramError> {
        let mut bridge = self.bridge.lock().unwrap();
        bridge.initiate_deposit(sender, recipient, asset_type, amount, signature)
    }
    
    fn complete_deposit(
        &mut self,
        transfer_id: Hash,
        wormhole_message: WormholeMessage,
    ) -> Result<(), ProgramError> {
        let mut bridge = self.bridge.lock().unwrap();
        bridge.complete_deposit(transfer_id, wormhole_message)
    }
    
    fn initiate_withdrawal(
        &mut self,
        sender: Pubkey,
        recipient: Pubkey,
        asset_type: AssetType,
        amount: u64,
        signature: Vec<u8>,
    ) -> Result<Hash, ProgramError> {
        let mut bridge = self.bridge.lock().unwrap();
        bridge.initiate_withdrawal(sender, recipient, asset_type, amount, signature)
    }
    
    fn complete_withdrawal(
        &mut self,
        transfer_id: Hash,
        wormhole_message: WormholeMessage,
    ) -> Result<(), ProgramError> {
        let mut bridge = self.bridge.lock().unwrap();
        bridge.complete_withdrawal(transfer_id, wormhole_message)
    }
    
    fn get_transfer(&self, transfer_id: &Hash) -> Option<BridgeTransfer> {
        let bridge = self.bridge.lock().unwrap();
        bridge.get_transfer(transfer_id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    use crate::bridge::{GuardianSignature};
    
    #[test]
    fn test_bridge_interface() {
        // Create bridge
        let wormhole_program_id = Pubkey::new_unique();
        let bridge_program_id = Pubkey::new_unique();
        let l2_bridge_program_id = Pubkey::new_unique();
        let token_bridge_program_id = Pubkey::new_unique();
        let nft_bridge_program_id = Pubkey::new_unique();
        let guardians = vec![Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique()];
        let min_guardian_signatures = 2;
        
        let bridge = Arc::new(Mutex::new(CompleteBridge::new(
            wormhole_program_id,
            bridge_program_id,
            l2_bridge_program_id,
            token_bridge_program_id,
            nft_bridge_program_id,
            guardians.clone(),
            min_guardian_signatures,
        )));
        
        // Create interface
        let mut interface = BridgeInterfaceImpl::new(Arc::clone(&bridge));
        
        // Initiate deposit
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        let asset_type = AssetType::Native;
        let amount = 100;
        let signature = vec![1, 2, 3]; // Dummy signature
        
        let transfer_id = interface.initiate_deposit(
            sender,
            recipient,
            asset_type.clone(),
            amount,
            signature.clone(),
        ).unwrap();
        
        // Verify transfer was created
        let transfer = interface.get_transfer(&transfer_id).unwrap();
        assert_eq!(transfer.sender, sender);
        assert_eq!(transfer.recipient, recipient);
        assert_eq!(transfer.amount, amount);
        assert_eq!(transfer.status, TransferStatus::Pending);
        assert_eq!(transfer.direction, TransferDirection::Deposit);
        
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
        interface.complete_deposit(transfer_id, wormhole_message.clone()).unwrap();
        
        // Verify transfer was completed
        let transfer = interface.get_transfer(&transfer_id).unwrap();
        assert_eq!(transfer.status, TransferStatus::Completed);
        assert_eq!(transfer.wormhole_message_hash, Some(message_id));
    }
}
