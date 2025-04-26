// src/interoperability/message_protocol.rs
//! Message Protocol module for Cross-Chain Interoperability
//! 
//! This module implements the cross-chain messaging protocol:
//! - Message formatting and serialization
//! - Message routing and delivery
//! - Message verification and validation
//! - Message acknowledgment and status tracking
//!
//! The message protocol is the foundation of cross-chain communication,
//! enabling secure and reliable message passing between different blockchains.

use solana_program::{
    program_error::ProgramError,
    msg,
};
use std::collections::HashMap;
use thiserror::Error;
use crate::interoperability::BlockchainNetwork;

/// Errors that can occur in the Message Protocol module
#[derive(Error, Debug)]
pub enum MessageProtocolError {
    #[error("Message protocol not initialized")]
    NotInitialized,

    #[error("Message not found: {0}")]
    MessageNotFound(u64),

    #[error("Invalid message format: {0}")]
    InvalidMessageFormat(String),

    #[error("Invalid network: {0}")]
    InvalidNetwork(String),

    #[error("Message too large: {size} bytes, maximum allowed: {max_size} bytes")]
    MessageTooLarge { size: usize, max_size: usize },

    #[error("Invalid status transition from {from:?} to {to:?}")]
    InvalidStatusTransition { from: MessageStatus, to: MessageStatus },

    #[error("Verification failed: {0}")]
    VerificationFailed(String),

    #[error("Invalid configuration: {0}")]
    InvalidConfiguration(String),

    #[error("Program error: {0}")]
    ProgramError(#[from] ProgramError),

    #[error("Unknown error")]
    Unknown,
}

/// Result type for Message Protocol operations
pub type MessageProtocolResult<T> = Result<T, MessageProtocolError>;

/// Message status
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MessageStatus {
    /// Pending - initial state
    Pending,
    
    /// Sent - message has been sent but not yet delivered
    Sent,
    
    /// Delivered - message has been delivered to the target chain
    Delivered,
    
    /// Acknowledged - message has been processed by the recipient
    Acknowledged,
    
    /// Failed - message delivery or processing failed
    Failed,
}

impl MessageStatus {
    /// Check if the status transition is valid
    pub fn can_transition_to(&self, next: &MessageStatus) -> bool {
        match self {
            MessageStatus::Pending => matches!(next, MessageStatus::Sent | MessageStatus::Failed),
            MessageStatus::Sent => matches!(next, MessageStatus::Delivered | MessageStatus::Failed),
            MessageStatus::Delivered => matches!(next, MessageStatus::Acknowledged | MessageStatus::Failed),
            MessageStatus::Acknowledged => false, // Terminal state
            MessageStatus::Failed => false, // Terminal state
        }
    }
}

/// Message information
#[derive(Debug, Clone)]
pub struct MessageInfo {
    /// Message ID
    pub id: u64,
    
    /// Source network
    pub source_network: Option<BlockchainNetwork>,
    
    /// Target network
    pub target_network: Option<BlockchainNetwork>,
    
    /// Sender
    pub sender: Vec<u8>,
    
    /// Recipient
    pub recipient: Vec<u8>,
    
    /// Message content
    pub content: Vec<u8>,
    
    /// Status
    pub status: MessageStatus,
    
    /// Creation timestamp
    pub creation_timestamp: u64,
    
    /// Last update timestamp
    pub last_update_timestamp: u64,
    
    /// Verification confirmations
    pub verification_confirmations: u32,
}

impl MessageInfo {
    /// Create a new message info
    pub fn new(
        id: u64,
        source_network: Option<BlockchainNetwork>,
        target_network: Option<BlockchainNetwork>,
        sender: Vec<u8>,
        recipient: Vec<u8>,
        content: Vec<u8>,
        timestamp: u64,
    ) -> Self {
        Self {
            id,
            source_network,
            target_network,
            sender,
            recipient,
            content,
            status: MessageStatus::Pending,
            creation_timestamp: timestamp,
            last_update_timestamp: timestamp,
            verification_confirmations: 0,
        }
    }
    
    /// Check if the message is verified
    pub fn is_verified(&self, threshold: u32) -> bool {
        self.verification_confirmations >= threshold
    }
    
    /// Get the message size in bytes
    pub fn size(&self) -> usize {
        // Base size (fixed fields)
        let mut size = 8 + // id
                      1 + // source_network presence
                      1 + // target_network presence
                      1 + self.sender.len() + // sender
                      1 + self.recipient.len() + // recipient
                      4 + self.content.len() + // content
                      1 + // status
                      8 + // creation_timestamp
                      8 + // last_update_timestamp
                      4; // verification_confirmations
        
        // Add network sizes if present
        if self.source_network.is_some() {
            size += 4; // Enum size
        }
        
        if self.target_network.is_some() {
            size += 4; // Enum size
        }
        
        size
    }
}

/// Message protocol configuration
#[derive(Debug, Clone)]
pub struct MessageProtocolConfig {
    /// Verification threshold (number of confirmations)
    pub verification_threshold: u32,
    
    /// Maximum message size in bytes
    pub max_message_size: usize,
    
    /// Maximum number of pending messages
    pub max_pending_messages: usize,
    
    /// Whether to require acknowledgment
    pub require_acknowledgment: bool,
}

impl Default for MessageProtocolConfig {
    fn default() -> Self {
        Self {
            verification_threshold: 10,
            max_message_size: 1024 * 10, // 10 KB
            max_pending_messages: 1000,
            require_acknowledgment: true,
        }
    }
}

impl MessageProtocolConfig {
    /// Validate the configuration
    pub fn validate(&self) -> MessageProtocolResult<()> {
        if self.verification_threshold == 0 {
            return Err(MessageProtocolError::InvalidConfiguration(
                "Verification threshold cannot be zero".to_string()
            ));
        }
        
        if self.max_message_size == 0 {
            return Err(MessageProtocolError::InvalidConfiguration(
                "Maximum message size cannot be zero".to_string()
            ));
        }
        
        if self.max_pending_messages == 0 {
            return Err(MessageProtocolError::InvalidConfiguration(
                "Maximum pending messages cannot be zero".to_string()
            ));
        }
        
        Ok(())
    }
}

/// Message protocol for cross-chain communication
pub struct MessageProtocol {
    /// Protocol configuration
    config: MessageProtocolConfig,
    
    /// Messages by ID
    messages: HashMap<u64, MessageInfo>,
    
    /// Next message ID
    next_message_id: u64,
    
    /// Whether the message protocol is initialized
    initialized: bool,
}

impl MessageProtocol {
    /// Create a new message protocol with default configuration
    pub fn new() -> Self {
        Self {
            config: MessageProtocolConfig::default(),
            messages: HashMap::new(),
            next_message_id: 1,
            initialized: false,
        }
    }
    
    /// Create a new message protocol with the specified configuration
    pub fn with_config(config: MessageProtocolConfig) -> MessageProtocolResult<Self> {
        // Validate the configuration
        config.validate()?;
        
        Ok(Self {
            config,
            messages: HashMap::new(),
            next_message_id: 1,
            initialized: false,
        })
    }
    
    /// Initialize the message protocol
    pub fn initialize(&mut self) -> MessageProtocolResult<()> {
        self.initialized = true;
        
        msg!("Message protocol initialized with verification threshold: {}", 
            self.config.verification_threshold);
        
        Ok(())
    }
    
    /// Check if the message protocol is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Send a message to another blockchain
    pub fn send_message(
        &mut self,
        target_network: BlockchainNetwork,
        recipient: Vec<u8>,
        content: Vec<u8>,
    ) -> MessageProtocolResult<u64> {
        if !self.initialized {
            return Err(MessageProtocolError::NotInitialized);
        }
        
        // Validate inputs
        if recipient.is_empty() {
            return Err(MessageProtocolError::InvalidMessageFormat(
                "Recipient cannot be empty".to_string()
            ));
        }
        
        if content.is_empty() {
            return Err(MessageProtocolError::InvalidMessageFormat(
                "Content cannot be empty".to_string()
            ));
        }
        
        // Check message size
        let content_size = content.len();
        if content_size > self.config.max_message_size {
            return Err(MessageProtocolError::MessageTooLarge {
                size: content_size,
                max_size: self.config.max_message_size,
            });
        }
        
        // Check if we have too many pending messages
        let pending_count = self.messages.values()
            .filter(|m| matches!(m.status, MessageStatus::Pending | MessageStatus::Sent))
            .count();
            
        if pending_count >= self.config.max_pending_messages {
            return Err(MessageProtocolError::InvalidConfiguration(
                format!("Too many pending messages: {}, maximum allowed: {}", 
                    pending_count, self.config.max_pending_messages)
            ));
        }
        
        // Get the current timestamp
        let current_timestamp = Self::get_current_timestamp();
        
        // Create the message
        let message_id = self.next_message_id;
        self.next_message_id += 1;
        
        let message = MessageInfo::new(
            message_id,
            None, // Will be set by the receiving chain
            Some(target_network),
            Vec::new(), // Will be set based on the transaction sender
            recipient,
            content,
            current_timestamp,
        );
        
        // Add the message
        self.messages.insert(message_id, message);
        
        // Update the message status
        self.update_message_status(message_id, MessageStatus::Sent)?;
        
        msg!("Message sent: {}, target network: {:?}", message_id, target_network);
        
        Ok(message_id)
    }
    
    /// Receive a message from another blockchain
    pub fn receive_message(
        &mut self,
        source_network: BlockchainNetwork,
        sender: Vec<u8>,
        content: Vec<u8>,
    ) -> MessageProtocolResult<u64> {
        if !self.initialized {
            return Err(MessageProtocolError::NotInitialized);
        }
        
        // Validate inputs
        if sender.is_empty() {
            return Err(MessageProtocolError::InvalidMessageFormat(
                "Sender cannot be empty".to_string()
            ));
        }
        
        if content.is_empty() {
            return Err(MessageProtocolError::InvalidMessageFormat(
                "Content cannot be empty".to_string()
            ));
        }
        
        // Check message size
        let content_size = content.len();
        if content_size > self.config.max_message_size {
            return Err(MessageProtocolError::MessageTooLarge {
                size: content_size,
                max_size: self.config.max_message_size,
            });
        }
        
        // Get the current timestamp
        let current_timestamp = Self::get_current_timestamp();
        
        // Create the message
        let message_id = self.next_message_id;
        self.next_message_id += 1;
        
        let message = MessageInfo::new(
            message_id,
            Some(source_network),
            None, // This is the target chain
            sender,
            Vec::new(), // Will be set based on the message content
            content,
            current_timestamp,
        );
        
        // Add the message
        self.messages.insert(message_id, message);
        
        // Update the message status
        self.update_message_status(message_id, MessageStatus::Delivered)?;
        
        msg!("Message received: {}, source network: {:?}", message_id, source_network);
        
        Ok(message_id)
    }
    
    /// Acknowledge a message
    pub fn acknowledge_message(&mut self, message_id: u64) -> MessageProtocolResult<()> {
        if !self.initialized {
            return Err(MessageProtocolError::NotInitialized);
        }
        
        // Update the message status
        self.update_message_status(message_id, MessageStatus::Acknowledged)?;
        
        msg!("Message acknowledged: {}", message_id);
        
        Ok(())
    }
    
    /// Update message status
    pub fn update_message_status(&mut self, message_id: u64, status: MessageStatus) -> MessageProtocolResult<()> {
        if !self.initialized {
            return Err(MessageProtocolError::NotInitialized);
        }
        
        // Get the message
        let message = self.messages.get_mut(&message_id)
            .ok_or(MessageProtocolError::MessageNotFound(message_id))?;
        
        // Check if the status transition is valid
        if !message.status.can_transition_to(&status) {
            return Err(MessageProtocolError::InvalidStatusTransition {
                from: message.status.clone(),
                to: status,
            });
        }
        
        // Update the status
        message.status = status;
        
        // Update the last update timestamp
        let current_timestamp = Self::get_current_timestamp();
        message.last_update_timestamp = current_timestamp;
        
        msg!("Message status updated: {}, status: {:?}", message_id, status);
        
        Ok(())
    }
    
    /// Add verification confirmation
    pub fn add_verification_confirmation(&mut self, message_id: u64) -> MessageProtocolResult<bool> {
        if !self.initialized {
            return Err(MessageProtocolError::NotInitialized);
        }
        
        // Get the message
        let message = self.messages.get_mut(&message_id)
            .ok_or(MessageProtocolError::MessageNotFound(message_id))?;
        
        // Increment the confirmation count
        message.verification_confirmations += 1;
        
        // Update the last update timestamp
        let current_timestamp = Self::get_current_timestamp();
        message.last_update_timestamp = current_timestamp;
        
        // Check if the message is verified
        let verified = message.verification_confirmations >= self.config.verification_threshold;
        
        if verified && message.status == MessageStatus::Sent {
            // Update the status to delivered
            message.status = MessageStatus::Delivered;
        }
        
        msg!("Verification confirmation added: {}, confirmations: {}, verified: {}", 
            message_id, message.verification_confirmations, verified);
        
        Ok(verified)
    }
    
    /// Get a message
    pub fn get_message(&self, message_id: u64) -> MessageProtocolResult<&MessageInfo> {
        if !self.initialized {
            return Err(MessageProtocolError::NotInitialized);
        }
        
        self.messages.get(&message_id)
            .ok_or(MessageProtocolError::MessageNotFound(message_id))
    }
    
    /// Get all messages
    pub fn get_all_messages(&self) -> MessageProtocolResult<&HashMap<u64, MessageInfo>> {
        if !self.initialized {
            return Err(MessageProtocolError::NotInitialized);
        }
        
        Ok(&self.messages)
    }
    
    /// Get messages by status
    pub fn get_messages_by_status(&self, status: MessageStatus) -> MessageProtocolResult<Vec<&MessageInfo>> {
        if !self.initialized {
            return Err(MessageProtocolError::NotInitialized);
        }
        
        let messages = self.messages.values()
            .filter(|m| m.status == status)
            .collect();
        
        Ok(messages)
    }
    
    /// Format a message for cross-chain transmission
    pub fn format_message(&self, message_id: u64) -> MessageProtocolResult<Vec<u8>> {
        if !self.initialized {
            return Err(MessageProtocolError::NotInitialized);
        }
        
        // Get the message
        let message = self.get_message(message_id)?;
        
        // In a real implementation, we would serialize the message
        // For now, we'll just return a simple format
        
        let mut formatted = Vec::new();
        
        // Add the message ID
        formatted.extend_from_slice(&message_id.to_le_bytes());
        
        // Add the target network (if any)
        if let Some(target_network) = &message.target_network {
            // In a real implementation, we would serialize the network enum
            formatted.push(1); // Indicates presence of target network
            formatted.push(target_network.to_code()); // Network code
        } else {
            formatted.push(0); // Indicates absence of target network
        }
        
        // Add the source network (if any)
        if let Some(source_network) = &message.source_network {
            // In a real implementation, we would serialize the network enum
            formatted.push(1); // Indicates presence of source network
            formatted.push(source_network.to_code()); // Network code
        } else {
            formatted.push(0); // Indicates absence of source network
        }
        
        // Add the sender
        if message.sender.len() > 255 {
            return Err(MessageProtocolError::InvalidMessageFormat(
                format!("Sender too long: {} bytes, maximum allowed: 255 bytes", message.sender.len())
            ));
        }
        formatted.push(message.sender.len() as u8);
        formatted.extend_from_slice(&message.sender);
        
        // Add the recipient
        if message.recipient.len() > 255 {
            return Err(MessageProtocolError::InvalidMessageFormat(
                format!("Recipient too long: {} bytes, maximum allowed: 255 bytes", message.recipient.len())
            ));
        }
        formatted.push(message.recipient.len() as u8);
        formatted.extend_from_slice(&message.recipient);
        
        // Add the content
        if message.content.len() > u32::MAX as usize {
            return Err(MessageProtocolError::InvalidMessageFormat(
                format!("Content too long: {} bytes, maximum allowed: {} bytes", 
                    message.content.len(), u32::MAX)
            ));
        }
        formatted.extend_from_slice(&(message.content.len() as u32).to_le_bytes());
        formatted.extend_from_slice(&message.content);
        
        Ok(formatted)
    }
    
    /// Parse a formatted message
    pub fn parse_message(&self, formatted: &[u8]) -> MessageProtocolResult<MessageInfo> {
        if !self.initialized {
            return Err(MessageProtocolError::NotInitialized);
        }
        
        // In a real implementation, we would deserialize the message
        // For now, we'll just parse a simple format
        
        if formatted.len() < 8 {
            return Err(MessageProtocolError::InvalidMessageFormat(
                format!("Message too short: {} bytes, minimum required: 8 bytes", formatted.len())
            ));
        }
        
        let mut index = 0;
        
        // Parse the message ID
        if index + 8 > formatted.len() {
            return Err(MessageProtocolError::InvalidMessageFormat(
                "Unexpected end of message while parsing ID".to_string()
            ));
        }
        let mut id_bytes = [0u8; 8];
        id_bytes.copy_from_slice(&formatted[index..index+8]);
        let id = u64::from_le_bytes(id_bytes);
        index += 8;
        
        // Parse the target network
        if index >= formatted.len() {
            return Err(MessageProtocolError::InvalidMessageFormat(
                "Unexpected end of message while parsing target network presence".to_string()
            ));
        }
        let has_target_network = formatted[index] != 0;
        index += 1;
        
        let target_network = if has_target_network {
            if index >= formatted.len() {
                return Err(MessageProtocolError::InvalidMessageFormat(
                    "Unexpected end of message while parsing target network code".to_string()
                ));
            }
            // In a real implementation, we would deserialize the network enum
            let network_code = formatted[index];
            index += 1;
            
            match BlockchainNetwork::from_code(network_code) {
                Some(network) => Some(network),
                None => return Err(MessageProtocolError::InvalidNetwork(
                    format!("Invalid target network code: {}", network_code)
                )),
            }
        } else {
            None
        };
        
        // Parse the source network
        if index >= formatted.len() {
            return Err(MessageProtocolError::InvalidMessageFormat(
                "Unexpected end of message while parsing source network presence".to_string()
            ));
        }
        let has_source_network = formatted[index] != 0;
        index += 1;
        
        let source_network = if has_source_network {
            if index >= formatted.len() {
                return Err(MessageProtocolError::InvalidMessageFormat(
                    "Unexpected end of message while parsing source network code".to_string()
                ));
            }
            // In a real implementation, we would deserialize the network enum
            let network_code = formatted[index];
            index += 1;
            
            match BlockchainNetwork::from_code(network_code) {
                Some(network) => Some(network),
                None => return Err(MessageProtocolError::InvalidNetwork(
                    format!("Invalid source network code: {}", network_code)
                )),
            }
        } else {
            None
        };
        
        // Parse the sender
        if index >= formatted.len() {
            return Err(MessageProtocolError::InvalidMessageFormat(
                "Unexpected end of message while parsing sender length".to_string()
            ));
        }
        let sender_len = formatted[index] as usize;
        index += 1;
        if index + sender_len > formatted.len() {
            return Err(MessageProtocolError::InvalidMessageFormat(
                format!("Unexpected end of message while parsing sender: need {} bytes, have {} bytes", 
                    sender_len, formatted.len() - index)
            ));
        }
        let sender = formatted[index..index+sender_len].to_vec();
        index += sender_len;
        
        // Parse the recipient
        if index >= formatted.len() {
            return Err(MessageProtocolError::InvalidMessageFormat(
                "Unexpected end of message while parsing recipient length".to_string()
            ));
        }
        let recipient_len = formatted[index] as usize;
        index += 1;
        if index + recipient_len > formatted.len() {
            return Err(MessageProtocolError::InvalidMessageFormat(
                format!("Unexpected end of message while parsing recipient: need {} bytes, have {} bytes", 
                    recipient_len, formatted.len() - index)
            ));
        }
        let recipient = formatted[index..index+recipient_len].to_vec();
        index += recipient_len;
        
        // Parse the content
        if index + 4 > formatted.len() {
            return Err(MessageProtocolError::InvalidMessageFormat(
                "Unexpected end of message while parsing content length".to_string()
            ));
        }
        let mut content_len_bytes = [0u8; 4];
        content_len_bytes.copy_from_slice(&formatted[index..index+4]);
        let content_len = u32::from_le_bytes(content_len_bytes) as usize;
        index += 4;
        if index + content_len > formatted.len() {
            return Err(MessageProtocolError::InvalidMessageFormat(
                format!("Unexpected end of message while parsing content: need {} bytes, have {} bytes", 
                    content_len, formatted.len() - index)
            ));
        }
        let content = formatted[index..index+content_len].to_vec();
        
        // Create the message info
        let current_timestamp = Self::get_current_timestamp();
        
        let message = MessageInfo::new(
            id,
            source_network,
            target_network,
            sender,
            recipient,
            content,
            current_timestamp,
        );
        
        Ok(message)
    }
    
    /// Update the message protocol configuration
    pub fn update_config(&mut self, config: MessageProtocolConfig) -> MessageProtocolResult<()> {
        if !self.initialized {
            return Err(MessageProtocolError::NotInitialized);
        }
        
        // Validate the configuration
        config.validate()?;
        
        self.config = config;
        
        msg!("Message protocol configuration updated");
        
        Ok(())
    }
    
    /// Get the current configuration
    pub fn get_config(&self) -> &MessageProtocolConfig {
        &self.config
    }
    
    /// Get the current timestamp
    fn get_current_timestamp() -> u64 {
        // In a real implementation, we would use the current timestamp
        // For now, we'll just return 0
        0
    }
    
    /// Clean up old messages
    pub fn clean_up_old_messages(&mut self, max_age_ms: u64) -> MessageProtocolResult<usize> {
        if !self.initialized {
            return Err(MessageProtocolError::NotInitialized);
        }
        
        let current_timestamp = Self::get_current_timestamp();
        
        // Find messages to remove
        let to_remove: Vec<u64> = self.messages.iter()
            .filter(|(_, msg)| {
                // Keep messages that are not in a terminal state
                if !matches!(msg.status, MessageStatus::Acknowledged | MessageStatus::Failed) {
                    return false;
                }
                
                // Remove messages that are older than max_age_ms
                current_timestamp.saturating_sub(msg.last_update_timestamp) > max_age_ms
            })
            .map(|(id, _)| *id)
            .collect();
        
        // Remove the messages
        for id in &to_remove {
            self.messages.remove(id);
        }
        
        let count = to_remove.len();
        
        if count > 0 {
            msg!("Cleaned up {} old messages", count);
        }
        
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_message_protocol_creation() {
        let protocol = MessageProtocol::new();
        assert!(!protocol.is_initialized());
    }
    
    #[test]
    fn test_message_protocol_with_config() {
        let config = MessageProtocolConfig {
            verification_threshold: 20,
            ..MessageProtocolConfig::default()
        };
        
        let protocol = MessageProtocol::with_config(config).unwrap();
        assert!(!protocol.is_initialized());
        assert_eq!(protocol.config.verification_threshold, 20);
    }
    
    #[test]
    fn test_invalid_configuration() {
        // Test zero verification_threshold
        let config = MessageProtocolConfig {
            verification_threshold: 0,
            ..MessageProtocolConfig::default()
        };
        
        let result = MessageProtocol::with_config(config);
        assert!(result.is_err());
        
        // Test zero max_message_size
        let config = MessageProtocolConfig {
            max_message_size: 0,
            ..MessageProtocolConfig::default()
        };
        
        let result = MessageProtocol::with_config(config);
        assert!(result.is_err());
        
        // Test zero max_pending_messages
        let config = MessageProtocolConfig {
            max_pending_messages: 0,
            ..MessageProtocolConfig::default()
        };
        
        let result = MessageProtocol::with_config(config);
        assert!(result.is_err());
    }
    
    #[test]
    fn test_initialization() {
        let mut protocol = MessageProtocol::new();
        assert!(!protocol.is_initialized());
        
        protocol.initialize().unwrap();
        assert!(protocol.is_initialized());
    }
    
    #[test]
    fn test_send_message() {
        let mut protocol = MessageProtocol::new();
        protocol.initialize().unwrap();
        
        // Send a valid message
        let result = protocol.send_message(
            BlockchainNetwork::Ethereum,
            vec![1, 2, 3],
            vec![4, 5, 6],
        );
        
        assert!(result.is_ok());
        let message_id = result.unwrap();
        
        // Check that the message was added
        let message = protocol.get_message(message_id).unwrap();
        assert_eq!(message.id, message_id);
        assert_eq!(message.target_network, Some(BlockchainNetwork::Ethereum));
        assert_eq!(message.recipient, vec![1, 2, 3]);
        assert_eq!(message.content, vec![4, 5, 6]);
        assert_eq!(message.status, MessageStatus::Sent);
    }
    
    #[test]
    fn test_send_message_validation() {
        let mut protocol = MessageProtocol::new();
        protocol.initialize().unwrap();
        
        // Test empty recipient
        let result = protocol.send_message(
            BlockchainNetwork::Ethereum,
            vec![],
            vec![4, 5, 6],
        );
        
        assert!(result.is_err());
        
        // Test empty content
        let result = protocol.send_message(
            BlockchainNetwork::Ethereum,
            vec![1, 2, 3],
            vec![],
        );
        
        assert!(result.is_err());
        
        // Test message too large
        let config = MessageProtocolConfig {
            max_message_size: 2,
            ..MessageProtocolConfig::default()
        };
        
        let mut protocol = MessageProtocol::with_config(config).unwrap();
        protocol.initialize().unwrap();
        
        let result = protocol.send_message(
            BlockchainNetwork::Ethereum,
            vec![1, 2, 3],
            vec![4, 5, 6],
        );
        
        assert!(result.is_err());
    }
    
    #[test]
    fn test_receive_message() {
        let mut protocol = MessageProtocol::new();
        protocol.initialize().unwrap();
        
        // Receive a valid message
        let result = protocol.receive_message(
            BlockchainNetwork::Ethereum,
            vec![1, 2, 3],
            vec![4, 5, 6],
        );
        
        assert!(result.is_ok());
        let message_id = result.unwrap();
        
        // Check that the message was added
        let message = protocol.get_message(message_id).unwrap();
        assert_eq!(message.id, message_id);
        assert_eq!(message.source_network, Some(BlockchainNetwork::Ethereum));
        assert_eq!(message.sender, vec![1, 2, 3]);
        assert_eq!(message.content, vec![4, 5, 6]);
        assert_eq!(message.status, MessageStatus::Delivered);
    }
    
    #[test]
    fn test_acknowledge_message() {
        let mut protocol = MessageProtocol::new();
        protocol.initialize().unwrap();
        
        // Send a message
        let message_id = protocol.send_message(
            BlockchainNetwork::Ethereum,
            vec![1, 2, 3],
            vec![4, 5, 6],
        ).unwrap();
        
        // Update to delivered
        protocol.update_message_status(message_id, MessageStatus::Delivered).unwrap();
        
        // Acknowledge the message
        let result = protocol.acknowledge_message(message_id);
        assert!(result.is_ok());
        
        // Check that the message status was updated
        let message = protocol.get_message(message_id).unwrap();
        assert_eq!(message.status, MessageStatus::Acknowledged);
    }
    
    #[test]
    fn test_invalid_status_transition() {
        let mut protocol = MessageProtocol::new();
        protocol.initialize().unwrap();
        
        // Send a message
        let message_id = protocol.send_message(
            BlockchainNetwork::Ethereum,
            vec![1, 2, 3],
            vec![4, 5, 6],
        ).unwrap();
        
        // Try to acknowledge the message (invalid transition from Sent to Acknowledged)
        let result = protocol.acknowledge_message(message_id);
        assert!(result.is_err());
        
        // Check that the message status was not updated
        let message = protocol.get_message(message_id).unwrap();
        assert_eq!(message.status, MessageStatus::Sent);
    }
    
    #[test]
    fn test_add_verification_confirmation() {
        let mut protocol = MessageProtocol::new();
        protocol.initialize().unwrap();
        
        // Send a message
        let message_id = protocol.send_message(
            BlockchainNetwork::Ethereum,
            vec![1, 2, 3],
            vec![4, 5, 6],
        ).unwrap();
        
        // Add verification confirmations
        for i in 1..=protocol.config.verification_threshold {
            let result = protocol.add_verification_confirmation(message_id);
            assert!(result.is_ok());
            
            let verified = result.unwrap();
            
            if i < protocol.config.verification_threshold {
                assert!(!verified);
            } else {
                assert!(verified);
            }
        }
        
        // Check that the message status was updated to Delivered
        let message = protocol.get_message(message_id).unwrap();
        assert_eq!(message.status, MessageStatus::Delivered);
        assert_eq!(message.verification_confirmations, protocol.config.verification_threshold);
    }
    
    #[test]
    fn test_format_and_parse_message() {
        let mut protocol = MessageProtocol::new();
        protocol.initialize().unwrap();
        
        // Send a message
        let message_id = protocol.send_message(
            BlockchainNetwork::Ethereum,
            vec![1, 2, 3],
            vec![4, 5, 6],
        ).unwrap();
        
        // Format the message
        let formatted = protocol.format_message(message_id).unwrap();
        
        // Parse the formatted message
        let parsed = protocol.parse_message(&formatted).unwrap();
        
        // Check that the parsed message matches the original
        let original = protocol.get_message(message_id).unwrap();
        
        assert_eq!(parsed.id, original.id);
        assert_eq!(parsed.target_network, original.target_network);
        assert_eq!(parsed.recipient, original.recipient);
        assert_eq!(parsed.content, original.content);
    }
    
    #[test]
    fn test_update_config() {
        let mut protocol = MessageProtocol::new();
        protocol.initialize().unwrap();
        
        // Update the configuration
        let config = MessageProtocolConfig {
            verification_threshold: 20,
            ..MessageProtocolConfig::default()
        };
        
        let result = protocol.update_config(config);
        assert!(result.is_ok());
        assert_eq!(protocol.config.verification_threshold, 20);
    }
    
    #[test]
    fn test_clean_up_old_messages() {
        let mut protocol = MessageProtocol::new();
        protocol.initialize().unwrap();
        
        // Send a message
        let message_id = protocol.send_message(
            BlockchainNetwork::Ethereum,
            vec![1, 2, 3],
            vec![4, 5, 6],
        ).unwrap();
        
        // Update to delivered
        protocol.update_message_status(message_id, MessageStatus::Delivered).unwrap();
        
        // Acknowledge the message
        protocol.acknowledge_message(message_id).unwrap();
        
        // Clean up old messages
        let result = protocol.clean_up_old_messages(0);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 1);
        
        // Check that the message was removed
        let result = protocol.get_message(message_id);
        assert!(result.is_err());
    }
    
    #[test]
    fn test_message_status_transitions() {
        // Test valid transitions
        assert!(MessageStatus::Pending.can_transition_to(&MessageStatus::Sent));
        assert!(MessageStatus::Pending.can_transition_to(&MessageStatus::Failed));
        assert!(MessageStatus::Sent.can_transition_to(&MessageStatus::Delivered));
        assert!(MessageStatus::Sent.can_transition_to(&MessageStatus::Failed));
        assert!(MessageStatus::Delivered.can_transition_to(&MessageStatus::Acknowledged));
        assert!(MessageStatus::Delivered.can_transition_to(&MessageStatus::Failed));
        
        // Test invalid transitions
        assert!(!MessageStatus::Pending.can_transition_to(&MessageStatus::Delivered));
        assert!(!MessageStatus::Pending.can_transition_to(&MessageStatus::Acknowledged));
        assert!(!MessageStatus::Sent.can_transition_to(&MessageStatus::Pending));
        assert!(!MessageStatus::Sent.can_transition_to(&MessageStatus::Acknowledged));
        assert!(!MessageStatus::Delivered.can_transition_to(&MessageStatus::Pending));
        assert!(!MessageStatus::Delivered.can_transition_to(&MessageStatus::Sent));
        assert!(!MessageStatus::Acknowledged.can_transition_to(&MessageStatus::Pending));
        assert!(!MessageStatus::Acknowledged.can_transition_to(&MessageStatus::Sent));
        assert!(!MessageStatus::Acknowledged.can_transition_to(&MessageStatus::Delivered));
        assert!(!MessageStatus::Acknowledged.can_transition_to(&MessageStatus::Failed));
        assert!(!MessageStatus::Failed.can_transition_to(&MessageStatus::Pending));
        assert!(!MessageStatus::Failed.can_transition_to(&MessageStatus::Sent));
        assert!(!MessageStatus::Failed.can_transition_to(&MessageStatus::Delivered));
        assert!(!MessageStatus::Failed.can_transition_to(&MessageStatus::Acknowledged));
    }
}
