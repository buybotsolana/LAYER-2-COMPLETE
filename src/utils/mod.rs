// src/utils/mod.rs
//! Utility modules for Layer-2 on Solana
//! 
//! This module contains various utility functions and data structures
//! used throughout the Layer-2 solution.

mod optimized_merkle_tree;
mod batch_processor;
mod concurrent_executor;
mod memory_pool;

pub use optimized_merkle_tree::OptimizedMerkleTree;
pub use batch_processor::BatchProcessor;
pub use concurrent_executor::ConcurrentExecutor;
pub use memory_pool::MemoryPool;

use solana_program::keccak::hash;

/// Compute a hash of two 32-byte arrays
/// 
/// This is an optimized version that avoids unnecessary allocations
pub fn hash_pair(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut input = [0u8; 64];
    input[..32].copy_from_slice(left);
    input[32..].copy_from_slice(right);
    hash(&input).to_bytes()
}

/// Compute a hash of multiple 32-byte arrays
/// 
/// This is an optimized version that minimizes allocations
pub fn hash_multiple(items: &[[u8; 32]]) -> [u8; 32] {
    if items.is_empty() {
        return [0; 32];
    }
    
    if items.len() == 1 {
        return items[0];
    }
    
    let mut result = items[0];
    for item in &items[1..] {
        result = hash_pair(&result, item);
    }
    
    result
}

/// Convert a byte array to a hexadecimal string
pub fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut hex = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        hex.push_str(&format!("{:02x}", byte));
    }
    hex
}

/// Convert a hexadecimal string to a byte array
pub fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, String> {
    if hex.len() % 2 != 0 {
        return Err("Hex string must have an even number of characters".to_string());
    }
    
    let mut bytes = Vec::with_capacity(hex.len() / 2);
    for i in (0..hex.len()).step_by(2) {
        let byte_str = &hex[i..i+2];
        let byte = u8::from_str_radix(byte_str, 16)
            .map_err(|e| format!("Invalid hex character: {}", e))?;
        bytes.push(byte);
    }
    
    Ok(bytes)
}

/// Pad a byte array to a specified length
pub fn pad_to_length(bytes: &[u8], length: usize) -> Vec<u8> {
    if bytes.len() >= length {
        return bytes.to_vec();
    }
    
    let mut padded = Vec::with_capacity(length);
    padded.extend_from_slice(bytes);
    padded.resize(length, 0);
    padded
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_hash_pair() {
        let left = [1; 32];
        let right = [2; 32];
        
        let result1 = hash_pair(&left, &right);
        
        // Compute the same hash using the standard method
        let mut input = Vec::with_capacity(64);
        input.extend_from_slice(&left);
        input.extend_from_slice(&right);
        let result2 = hash(&input).to_bytes();
        
        assert_eq!(result1, result2);
    }
    
    #[test]
    fn test_hash_multiple() {
        let items = [[1; 32], [2; 32], [3; 32]];
        
        let result1 = hash_multiple(&items);
        
        // Compute the same hash using sequential hashing
        let mut result2 = items[0];
        for item in &items[1..] {
            let mut input = Vec::with_capacity(64);
            input.extend_from_slice(&result2);
            input.extend_from_slice(item);
            result2 = hash(&input).to_bytes();
        }
        
        assert_eq!(result1, result2);
    }
    
    #[test]
    fn test_bytes_to_hex() {
        let bytes = [0x12, 0x34, 0xAB, 0xCD];
        let hex = bytes_to_hex(&bytes);
        assert_eq!(hex, "1234abcd");
    }
    
    #[test]
    fn test_hex_to_bytes() {
        let hex = "1234abcd";
        let bytes = hex_to_bytes(hex).unwrap();
        assert_eq!(bytes, [0x12, 0x34, 0xAB, 0xCD]);
    }
    
    #[test]
    fn test_pad_to_length() {
        let bytes = [1, 2, 3];
        let padded = pad_to_length(&bytes, 5);
        assert_eq!(padded, [1, 2, 3, 0, 0]);
    }
}
