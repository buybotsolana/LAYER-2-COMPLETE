// src/bridge/message_relay.rs
//! Message Relay implementation for the Bridge module
//! 
//! This module provides a relay for messages between Ethereum (L1) and Solana Layer-2,
//! ensuring that cross-chain communication is secure and reliable.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;

/// Message status
#[derive(Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum MessageStatus {
    /// Message is pending
    Pending,
    
    /// Message is confirmed
    Confirmed,
    
    /// Message is finalized
    Finalized,
    
    /// Message is rejected
    Rejected,
}

/// Message direction
#[derive(Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum MessageDirection {
    /// Message from L1 to L2
    L1ToL2,
    
    /// Message from L2 to L1
    L2ToL1,
}

/// Message information
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct Message {
    /// Message ID
    pub id: [u8; 32],
    
    /// Message direction
    pub direction: MessageDirection,
    
    /// Source address
    pub source: Vec<u8>,
    
    /// Destination address
    pub destination: Vec<u8>,
    
    /// Message data
    pub data: Vec<u8>,
    
    /// Gas limit (for L2 to L1 messages)
    pub gas_limit: Option<u64>,
    
    /// Gas price (for L2 to L1 messages)
    pub gas_price: Option<u64>,
    
    /// Timestamp
    pub timestamp: u64,
    
    /// Status
    pub status: MessageStatus,
    
    /// Transaction hash (if finalized)
    pub tx_hash: Option<Vec<u8>>,
}

/// Message relay for the bridge
pub struct MessageRelay {
    /// L1 bridge address
    pub l1_bridge_address: [u8; 20],
    
    /// L1 withdrawal bridge address
    pub l1_withdrawal_bridge_address: [u8; 20],
    
    /// Messages by ID
    pub messages: HashMap<[u8; 32], Message>,
    
    /// Latest L1 block number
    pub latest_l1_block_number: u64,
    
    /// Latest L2 block number
    pub latest_l2_block_number: u64,
}

impl MessageRelay {
    /// Create a new message relay
    pub fn new(l1_bridge_address: [u8; 20], l1_withdrawal_bridge_address: [u8; 20]) -> Self {
        Self {
            l1_bridge_address,
            l1_withdrawal_bridge_address,
            messages: HashMap::new(),
            latest_l1_block_number: 0,
            latest_l2_block_number: 0,
        }
    }
    
    /// Initialize the message relay
    pub fn initialize(&mut self, program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
        // In a real implementation, we would initialize the message relay
        // with accounts and other data
        Ok(())
    }
    
    /// Update the latest L1 block number
    pub fn update_latest_l1_block_number(&mut self, block_number: u64) {
        if block_number > self.latest_l1_block_number {
            self.latest_l1_block_number = block_number;
        }
    }
    
    /// Update the latest L2 block number
    pub fn update_latest_l2_block_number(&mut self, block_number: u64) {
        if block_number > self.latest_l2_block_number {
            self.latest_l2_block_number = block_number;
        }
    }
    
    /// Get the latest L1 block number
    pub fn get_latest_l1_block_number(&self) -> u64 {
        self.latest_l1_block_number
    }
    
    /// Get the latest L2 block number
    pub fn get_latest_l2_block_number(&self) -> u64 {
        self.latest_l2_block_number
    }
    
    /// Send a message from L1 to L2
    pub fn send_l1_to_l2_message(
        &mut self,
        source: [u8; 20],
        destination: [u8; 32],
        data: Vec<u8>,
    ) -> Result<[u8; 32], String> {
        // Generate a message ID
        let mut id_data = Vec::new();
        id_data.extend_from_slice(&source);
        id_data.extend_from_slice(&destination);
        id_data.extend_from_slice(&data);
        id_data.extend_from_slice(&self.latest_l1_block_number.to_le_bytes());
        
        let id = solana_program::keccak::hash(&id_data).to_bytes();
        
        // Check if the message already exists
        if self.messages.contains_key(&id) {
            return Err(format!("Message with ID {:?} already exists", id));
        }
        
        // Get the current timestamp
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        // Create the message
        let message = Message {
            id,
            direction: MessageDirection::L1ToL2,
            source: source.to_vec(),
            destination: destination.to_vec(),
            data,
            gas_limit: None,
            gas_price: None,
            timestamp: now,
            status: MessageStatus::Pending,
            tx_hash: None,
        };
        
        // Add the message
        self.messages.insert(id, message);
        
        Ok(id)
    }
    
    /// Send a message from L2 to L1
    pub fn send_l2_to_l1_message(
        &mut self,
        source: [u8; 32],
        destination: [u8; 20],
        data: Vec<u8>,
        gas_limit: u64,
        gas_price: u64,
    ) -> Result<[u8; 32], String> {
        // Check if the gas limit is within bounds
        if gas_limit > 1_000_000 {
            return Err(format!("Gas limit {} exceeds maximum of 1,000,000", gas_limit));
        }
        
        // Check if the gas price is within bounds
        if gas_price > 1_000_000_000_000 {
            return Err(format!("Gas price {} exceeds maximum of 1,000,000 Gwei", gas_price / 1_000_000_000));
        }
        
        // Generate a message ID
        let mut id_data = Vec::new();
        id_data.extend_from_slice(&source);
        id_data.extend_from_slice(&destination);
        id_data.extend_from_slice(&data);
        id_data.extend_from_slice(&self.latest_l2_block_number.to_le_bytes());
        
        let id = solana_program::keccak::hash(&id_data).to_bytes();
        
        // Check if the message already exists
        if self.messages.contains_key(&id) {
            return Err(format!("Message with ID {:?} already exists", id));
        }
        
        // Get the current timestamp
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        // Create the message
        let message = Message {
            id,
            direction: MessageDirection::L2ToL1,
            source: source.to_vec(),
            destination: destination.to_vec(),
            data,
            gas_limit: Some(gas_limit),
            gas_price: Some(gas_price),
            timestamp: now,
            status: MessageStatus::Pending,
            tx_hash: None,
        };
        
        // Add the message
        self.messages.insert(id, message);
        
        Ok(id)
    }
    
    /// Confirm a message
    pub fn confirm_message(
        &mut self,
        id: [u8; 32],
    ) -> Result<(), String> {
        // Check if the message exists
        let message = match self.messages.get_mut(&id) {
            Some(message) => message,
            None => return Err(format!("Message with ID {:?} does not exist", id)),
        };
        
        // Check if the message is pending
        if message.status != MessageStatus::Pending {
            return Err(format!("Message with ID {:?} is not pending", id));
        }
        
        // Update the message status
        message.status = MessageStatus::Confirmed;
        
        Ok(())
    }
    
    /// Finalize a message
    pub fn finalize_message(
        &mut self,
        id: [u8; 32],
        tx_hash: Vec<u8>,
    ) -> Result<(), String> {
        // Check if the message exists
        let message = match self.messages.get_mut(&id) {
            Some(message) => message,
            None => return Err(format!("Message with ID {:?} does not exist", id)),
        };
        
        // Check if the message is confirmed
        if message.status != MessageStatus::Confirmed {
            return Err(format!("Message with ID {:?} is not confirmed", id));
        }
        
        // Update the message status
        message.status = MessageStatus::Finalized;
        message.tx_hash = Some(tx_hash);
        
        Ok(())
    }
    
    /// Reject a message
    pub fn reject_message(
        &mut self,
        id: [u8; 32],
        reason: &str,
    ) -> Result<(), String> {
        // Check if the message exists
        let message = match self.messages.get_mut(&id) {
            Some(message) => message,
            None => return Err(format!("Message with ID {:?} does not exist", id)),
        };
        
        // Check if the message is pending or confirmed
        if message.status != MessageStatus::Pending && message.status != MessageStatus::Confirmed {
            return Err(format!("Message with ID {:?} cannot be rejected", id));
        }
        
        // Update the message status
        message.status = MessageStatus::Rejected;
        
        // Log the rejection reason
        msg!("Message rejected: {}", reason);
        
        Ok(())
    }
    
    /// Get a message
    pub fn get_message(&self, id: [u8; 32]) -> Option<&Message> {
        self.messages.get(&id)
    }
    
    /// Get all messages
    pub fn get_all_messages(&self) -> Vec<&Message> {
        self.messages.values().collect()
    }
    
    /// Get messages by status
    pub fn get_messages_by_status(&self, status: MessageStatus) -> Vec<&Message> {
        self.messages.values()
            .filter(|message| message.status == status)
            .collect()
    }
    
    /// Get messages by direction
    pub fn get_messages_by_direction(&self, direction: MessageDirection) -> Vec<&Message> {
        self.messages.values()
            .filter(|message| message.direction == direction)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_message_relay() {
        // Create a message relay
        let l1_bridge_address = [1; 20];
        let l1_withdrawal_bridge_address = [2; 20];
        let mut relay = MessageRelay::new(l1_bridge_address, l1_withdrawal_bridge_address);
        
        // Update block numbers
        relay.update_latest_l1_block_number(100);
        relay.update_latest_l2_block_number(200);
        
        assert_eq!(relay.get_latest_l1_block_number(), 100);
        assert_eq!(relay.get_latest_l2_block_number(), 200);
        
        // Send an L1 to L2 message
        let source = [3; 20];
        let destination = [4; 32];
        let data = vec![5, 6, 7];
        
        let result = relay.send_l1_to_l2_message(source, destination, data.clone());
        assert!(result.is_ok());
        
        let message_id = result.unwrap();
        
        // Get the message
        let message = relay.get_message(message_id).unwrap();
        assert_eq!(message.direction, MessageDirection::L1ToL2);
        assert_eq!(message.source, source.to_vec());
        assert_eq!(message.destination, destination.to_vec());
        assert_eq!(message.data, data);
        assert_eq!(message.status, MessageStatus::Pending);
        
        // Confirm the message
        let result = relay.confirm_message(message_id);
        assert!(result.is_ok());
        
        // Get the message again
        let message = relay.get_message(message_id).unwrap();
        assert_eq!(message.status, MessageStatus::Confirmed);
        
        // Finalize the message
        let tx_hash = vec![8, 9, 10];
        let result = relay.finalize_message(message_id, tx_hash.clone());
        assert!(result.is_ok());
        
        // Get the message again
        let message = relay.get_message(message_id).unwrap();
        assert_eq!(message.status, MessageStatus::Finalized);
        assert_eq!(message.tx_hash, Some(tx_hash));
    }
}
