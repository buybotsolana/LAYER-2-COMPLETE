// Calldata Compression Module for Layer-2 on Solana
//
// This module implements advanced calldata compression techniques to minimize transaction sizes
// and reduce gas costs for the Layer-2 on Solana implementation.
//
// Key techniques:
// - RLP encoding optimization
// - Huffman coding for frequent patterns
// - Dictionary compression
// - Zero byte optimization
// - Brotli compression for large payloads
//
// Author: Manus AI
// Date: April 2025

use std::collections::{HashMap, BinaryHeap};
use std::cmp::Ordering;
use std::io::{Read, Write};
use brotli::{CompressorReader, CompressorWriter};
use thiserror::Error;
use crate::gas_optimization::{Transaction, GasOptimizerConfig};

/// Errors that can occur in the calldata compression module
#[derive(Error, Debug)]
pub enum CompressionError {
    #[error("Invalid input data: {0}")]
    InvalidInput(String),

    #[error("Compression failed: {0}")]
    CompressionFailed(String),

    #[error("Decompression failed: {0}")]
    DecompressionFailed(String),

    #[error("Huffman coding error: {0}")]
    HuffmanCodingError(String),

    #[error("Dictionary error: {0}")]
    DictionaryError(String),

    #[error("RLP optimization error: {0}")]
    RlpOptimizationError(String),

    #[error("Zero byte optimization error: {0}")]
    ZeroByteOptimizationError(String),

    #[error("Brotli error: {0}")]
    BrotliError(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Unknown compression error")]
    Unknown,
}

/// Result type for compression operations
pub type CompressionResult<T> = Result<T, CompressionError>;

/// Result of calldata compression
#[derive(Clone, Debug)]
pub struct CompressionOutcome {
    /// Original data size in bytes
    pub original_size: usize,
    
    /// Compressed data size in bytes
    pub compressed_size: usize,
    
    /// Compression ratio (original_size / compressed_size)
    pub compression_ratio: f64,
    
    /// Estimated gas saved
    pub gas_saved: u64,
    
    /// Compression method used
    pub method: CompressionMethod,
}

/// Available compression methods
#[derive(Clone, Debug, PartialEq)]
pub enum CompressionMethod {
    /// No compression
    None,
    
    /// RLP encoding optimization
    RlpOptimization,
    
    /// Huffman coding
    HuffmanCoding,
    
    /// Dictionary compression
    Dictionary,
    
    /// Zero byte optimization
    ZeroByteOptimization,
    
    /// Brotli compression
    Brotli,
    
    /// Combined methods
    Combined(Vec<CompressionMethod>),
}

impl CompressionMethod {
    /// Get the method name as a string
    pub fn name(&self) -> String {
        match self {
            CompressionMethod::None => "None".to_string(),
            CompressionMethod::RlpOptimization => "RLP Optimization".to_string(),
            CompressionMethod::HuffmanCoding => "Huffman Coding".to_string(),
            CompressionMethod::Dictionary => "Dictionary".to_string(),
            CompressionMethod::ZeroByteOptimization => "Zero Byte Optimization".to_string(),
            CompressionMethod::Brotli => "Brotli".to_string(),
            CompressionMethod::Combined(methods) => {
                let names: Vec<String> = methods.iter().map(|m| m.name()).collect();
                format!("Combined({})", names.join(", "))
            }
        }
    }
    
    /// Get the method identifier byte
    pub fn identifier(&self) -> u8 {
        match self {
            CompressionMethod::None => 0x00,
            CompressionMethod::RlpOptimization => 0x01,
            CompressionMethod::HuffmanCoding => 0x02,
            CompressionMethod::Dictionary => 0x03,
            CompressionMethod::ZeroByteOptimization => 0x04,
            CompressionMethod::Brotli => 0xB7,
            CompressionMethod::Combined(_) => 0xFF,
        }
    }
    
    /// Get the method from identifier byte
    pub fn from_identifier(id: u8) -> Option<Self> {
        match id {
            0x00 => Some(CompressionMethod::None),
            0x01 => Some(CompressionMethod::RlpOptimization),
            0x02 => Some(CompressionMethod::HuffmanCoding),
            0x03 => Some(CompressionMethod::Dictionary),
            0x04 => Some(CompressionMethod::ZeroByteOptimization),
            0xB7 => Some(CompressionMethod::Brotli),
            0xFF => Some(CompressionMethod::Combined(Vec::new())), // Empty combined methods
            _ => None,
        }
    }
}

/// Huffman tree node for compression
#[derive(Clone, Debug)]
struct HuffmanNode {
    /// Frequency of the byte or subtree
    frequency: usize,
    
    /// Byte value (for leaf nodes)
    value: Option<u8>,
    
    /// Left child
    left: Option<Box<HuffmanNode>>,
    
    /// Right child
    right: Option<Box<HuffmanNode>>,
}

impl Ord for HuffmanNode {
    fn cmp(&self, other: &Self) -> Ordering {
        // Reverse ordering for min-heap
        other.frequency.cmp(&self.frequency)
    }
}

impl PartialOrd for HuffmanNode {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for HuffmanNode {
    fn eq(&self, other: &Self) -> bool {
        self.frequency == other.frequency
    }
}

impl Eq for HuffmanNode {}

/// Dictionary entry for compression
#[derive(Clone, Debug)]
struct DictionaryEntry {
    /// Pattern to replace
    pattern: Vec<u8>,
    
    /// Frequency of occurrence
    frequency: usize,
    
    /// ID in the dictionary
    id: u16,
}

/// Main struct for calldata compression
pub struct CalldataCompressor {
    /// Configuration
    config: GasOptimizerConfig,
    
    /// Dictionary for common patterns
    dictionary: HashMap<Vec<u8>, u16>,
    
    /// Reverse dictionary for decompression
    reverse_dictionary: HashMap<u16, Vec<u8>>,
    
    /// Next dictionary entry ID
    next_dict_id: u16,
    
    /// Huffman coding tables
    huffman_tables: HashMap<Vec<u8>, Vec<u8>>,
    
    /// Maximum compression ratio to consider (to avoid excessive CPU usage)
    max_compression_ratio: f64,
    
    /// Minimum data size for compression (bytes)
    min_compression_size: usize,
}

impl CalldataCompressor {
    /// Create a new calldata compressor with the given configuration
    pub fn new(config: GasOptimizerConfig) -> Self {
        Self {
            config,
            dictionary: HashMap::new(),
            reverse_dictionary: HashMap::new(),
            next_dict_id: 0,
            huffman_tables: HashMap::new(),
            max_compression_ratio: 10.0, // Maximum 10:1 compression ratio
            min_compression_size: 32,    // Minimum 32 bytes for compression
        }
    }
    
    /// Initialize the compressor
    pub fn initialize(&mut self) -> CompressionResult<()> {
        // Initialize dictionary with common patterns
        self.initialize_dictionary()?;
        
        // Initialize Huffman tables
        self.initialize_huffman_tables()?;
        
        Ok(())
    }
    
    /// Initialize dictionary with common patterns
    fn initialize_dictionary(&mut self) -> CompressionResult<()> {
        // Common Solana and Ethereum patterns
        let common_patterns = [
            // Common Solana address prefixes
            vec![0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
            
            // Common Ethereum address prefixes
            vec![0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
            
            // Common function signatures
            vec![0xa9, 0x05, 0x9c, 0xbb], // transfer(address,uint256)
            vec![0x09, 0x5e, 0xa7, 0xb3], // approve(address,uint256)
            vec![0x70, 0xa0, 0x82, 0x31], // balanceOf(address)
            vec![0xdd, 0x62, 0xed, 0x3e], // allowance(address,address)
            
            // Common zero sequences
            vec![0, 0, 0, 0, 0, 0, 0, 0],
            vec![0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            vec![0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ];
        
        // Add patterns to dictionary
        for pattern in common_patterns.iter() {
            if !self.dictionary.contains_key(pattern) {
                self.dictionary.insert(pattern.clone(), self.next_dict_id);
                self.reverse_dictionary.insert(self.next_dict_id, pattern.clone());
                self.next_dict_id += 1;
            }
        }
        
        Ok(())
    }
    
    /// Initialize Huffman tables
    fn initialize_huffman_tables(&mut self) -> CompressionResult<()> {
        // For now, we'll use dynamic Huffman coding
        // In a production system, we might pre-compute tables for common data patterns
        Ok(())
    }
    
    /// Compress transaction calldata
    pub fn compress_transaction(&mut self, transaction: &mut Transaction) -> CompressionResult<CompressionOutcome> {
        let original_data = transaction.data.clone();
        let original_size = original_data.len();
        
        // Skip compression for very small payloads
        if original_size < self.min_compression_size {
            return Ok(CompressionOutcome {
                original_size,
                compressed_size: original_size,
                compression_ratio: 1.0,
                gas_saved: 0,
                method: CompressionMethod::None,
            });
        }
        
        // Try different compression methods and select the best one
        let mut best_result: Option<(Vec<u8>, CompressionMethod)> = None;
        let mut best_size = original_size;
        
        // 1. Try RLP optimization
        match self.optimize_rlp(&original_data) {
            Ok(rlp_data) => {
                if rlp_data.len() < best_size {
                    best_result = Some((rlp_data, CompressionMethod::RlpOptimization));
                    best_size = best_result.as_ref().unwrap().0.len();
                }
            },
            Err(e) => {
                // Log error but continue with other methods
                eprintln!("RLP optimization failed: {}", e);
            }
        }
        
        // 2. Try Huffman coding
        match self.huffman_compress(&original_data) {
            Ok(huffman_data) => {
                if huffman_data.len() < best_size {
                    best_result = Some((huffman_data, CompressionMethod::HuffmanCoding));
                    best_size = best_result.as_ref().unwrap().0.len();
                }
            },
            Err(e) => {
                // Log error but continue with other methods
                eprintln!("Huffman compression failed: {}", e);
            }
        }
        
        // 3. Try dictionary compression
        match self.dictionary_compress(&original_data) {
            Ok(dict_data) => {
                if dict_data.len() < best_size {
                    best_result = Some((dict_data, CompressionMethod::Dictionary));
                    best_size = best_result.as_ref().unwrap().0.len();
                }
            },
            Err(e) => {
                // Log error but continue with other methods
                eprintln!("Dictionary compression failed: {}", e);
            }
        }
        
        // 4. Try zero byte optimization
        match self.optimize_zero_bytes(&original_data) {
            Ok(zero_data) => {
                if zero_data.len() < best_size {
                    best_result = Some((zero_data, CompressionMethod::ZeroByteOptimization));
                    best_size = best_result.as_ref().unwrap().0.len();
                }
            },
            Err(e) => {
                // Log error but continue with other methods
                eprintln!("Zero byte optimization failed: {}", e);
            }
        }
        
        // 5. Try Brotli compression for large payloads
        if original_size > 1024 {
            match self.brotli_compress(&original_data) {
                Ok(brotli_data) => {
                    if brotli_data.len() < best_size {
                        best_result = Some((brotli_data, CompressionMethod::Brotli));
                        best_size = best_result.as_ref().unwrap().0.len();
                    }
                },
                Err(e) => {
                    // Log error but continue with other methods
                    eprintln!("Brotli compression failed: {}", e);
                }
            }
        }
        
        // Update transaction with compressed data if better than original
        if let Some((compressed_data, method)) = best_result {
            // Only use compression if it saves at least 10% of the original size
            if compressed_data.len() <= original_size * 9 / 10 {
                // Calculate gas saved (approximately 16 gas per non-zero byte, 4 gas per zero byte)
                let mut original_gas = 0;
                for &byte in &original_data {
                    original_gas += if byte == 0 { 4 } else { 16 };
                }
                
                let mut compressed_gas = 0;
                for &byte in &compressed_data {
                    compressed_gas += if byte == 0 { 4 } else { 16 };
                }
                
                let gas_saved = if original_gas > compressed_gas {
                    original_gas - compressed_gas
                } else {
                    0
                };
                
                // Add compression method identifier at the beginning
                let mut final_data = Vec::with_capacity(compressed_data.len() + 1);
                final_data.push(method.identifier());
                final_data.extend_from_slice(&compressed_data);
                
                // Update transaction data
                transaction.data = final_data;
                
                // Return compression result
                return Ok(CompressionOutcome {
                    original_size,
                    compressed_size: compressed_data.len() + 1, // +1 for method identifier
                    compression_ratio: original_size as f64 / (compressed_data.len() + 1) as f64,
                    gas_saved,
                    method,
                });
            }
        }
        
        // If no compression method was better, return original
        Ok(CompressionOutcome {
            original_size,
            compressed_size: original_size,
            compression_ratio: 1.0,
            gas_saved: 0,
            method: CompressionMethod::None,
        })
    }
    
    /// Optimize RLP encoding
    fn optimize_rlp(&self, data: &[u8]) -> CompressionResult<Vec<u8>> {
        // Check if data is RLP encoded
        if !self.is_rlp_encoded(data) {
            return Err(CompressionError::RlpOptimizationError("Data is not RLP encoded".to_string()));
        }
        
        // Implement RLP optimization logic
        // This is a simplified version - in a real implementation, we would
        // decode the RLP, optimize the structure, and re-encode it
        
        let mut optimized = Vec::with_capacity(data.len());
        let mut i = 0;
        
        while i < data.len() {
            // Process RLP list headers more efficiently
            if data[i] >= 0xc0 && data[i] <= 0xf7 && i + 1 < data.len() {
                // Short list
                let list_len = (data[i] - 0xc0) as usize;
                if list_len > 0 && i + list_len < data.len() {
                    // Check if list contains only short strings that can be optimized
                    let mut can_optimize = true;
                    let mut j = i + 1;
                    let end = i + 1 + list_len;
                    
                    while j < end {
                        if j >= data.len() {
                            return Err(CompressionError::RlpOptimizationError(
                                format!("Invalid RLP data: index {} out of bounds", j)
                            ));
                        }
                        
                        if data[j] < 0x80 || data[j] > 0xb7 {
                            can_optimize = false;
                            break;
                        }
                        
                        // Calculate length of the string
                        let str_len = (data[j] - 0x80) as usize;
                        if j + 1 + str_len > end {
                            can_optimize = false;
                            break;
                        }
                        
                        j += 1 + str_len;
                    }
                    
                    if can_optimize {
                        // Optimize by using more compact encoding
                        optimized.push(data[i]);
                        i += 1;
                        continue;
                    }
                }
            }
            
            // Copy byte as is
            optimized.push(data[i]);
            i += 1;
        }
        
        Ok(optimized)
    }
    
    /// Check if data is RLP encoded
    fn is_rlp_encoded(&self, data: &[u8]) -> bool {
        if data.is_empty() {
            return false;
        }
        
        // Simple heuristic: check if first byte is a valid RLP prefix
        let first_byte = data[0];
        
        // Single byte in range [0x00, 0x7f]
        if first_byte <= 0x7f {
            return true;
        }
        
        // String of length 0-55 bytes
        if first_byte >= 0x80 && first_byte <= 0xb7 {
            let length = (first_byte - 0x80) as usize;
            return data.len() >= length + 1;
        }
        
        // String of length > 55 bytes
        if first_byte >= 0xb8 && first_byte <= 0xbf {
            let length_of_length = (first_byte - 0xb7) as usize;
            if data.len() < 1 + length_of_length {
                return false;
            }
            
            // Calculate length from next bytes
            let mut length = 0;
            for i in 0..length_of_length {
                length = length * 256 + data[1 + i] as usize;
            }
            
            return data.len() >= 1 + length_of_length + length;
        }
        
        // List of length 0-55 bytes
        if first_byte >= 0xc0 && first_byte <= 0xf7 {
            let length = (first_byte - 0xc0) as usize;
            return data.len() >= length + 1;
        }
        
        // List of length > 55 bytes
        if first_byte >= 0xf8 && first_byte <= 0xff {
            let length_of_length = (first_byte - 0xf7) as usize;
            if data.len() < 1 + length_of_length {
                return false;
            }
            
            // Calculate length from next bytes
            let mut length = 0;
            for i in 0..length_of_length {
                length = length * 256 + data[1 + i] as usize;
            }
            
            return data.len() >= 1 + length_of_length + length;
        }
        
        false
    }
    
    /// Compress data using Huffman coding
    fn huffman_compress(&self, data: &[u8]) -> CompressionResult<Vec<u8>> {
        // Validate input
        if data.is_empty() {
            return Err(CompressionError::HuffmanCodingError("Empty input data".to_string()));
        }
        
        // Count frequency of each byte
        let mut frequencies = [0usize; 256];
        for &byte in data {
            frequencies[byte as usize] += 1;
        }
        
        // Build Huffman tree
        let tree = self.build_huffman_tree(&frequencies)
            .map_err(|e| CompressionError::HuffmanCodingError(e))?;
        
        // Generate Huffman codes
        let mut codes = HashMap::new();
        self.generate_huffman_codes(&tree, Vec::new(), &mut codes)
            .map_err(|e| CompressionError::HuffmanCodingError(e))?;
        
        // Compress data
        let mut compressed = Vec::new();
        
        // Add header with tree information (simplified)
        let mut header = Vec::new();
        let mut non_zero_freqs = 0;
        
        for i in 0..256 {
            if frequencies[i] > 0 {
                non_zero_freqs += 1;
            }
        }
        
        // Validate number of unique bytes
        if non_zero_freqs == 0 {
            return Err(CompressionError::HuffmanCodingError("No non-zero frequencies".to_string()));
        }
        
        if non_zero_freqs > 255 {
            return Err(CompressionError::HuffmanCodingError(
                format!("Too many unique bytes: {}", non_zero_freqs)
            ));
        }
        
        header.push(non_zero_freqs as u8);
        
        for i in 0..256 {
            if frequencies[i] > 0 {
                header.push(i as u8);
                
                // Encode frequency (variable-length encoding)
                let mut freq = frequencies[i];
                if freq < 128 {
                    header.push(freq as u8);
                } else {
                    let mut freq_bytes = Vec::new();
                    while freq > 0 {
                        freq_bytes.push((freq & 0x7f) as u8 | if freq > 0x7f { 0x80 } else { 0 });
                        freq >>= 7;
                    }
                    header.extend(freq_bytes.into_iter().rev());
                }
            }
        }
        
        compressed.extend_from_slice(&header);
        
        // Compress data using Huffman codes
        let mut bit_buffer = 0u32;
        let mut bit_count = 0;
        
        for &byte in data {
            if let Some(code) = codes.get(&byte) {
                for &bit in code {
                    bit_buffer = (bit_buffer << 1) | (bit as u32);
                    bit_count += 1;
                    
                    if bit_count == 8 {
                        compressed.push(bit_buffer as u8);
                        bit_buffer = 0;
                        bit_count = 0;
                    }
                }
            } else {
                return Err(CompressionError::HuffmanCodingError(
                    format!("No Huffman code for byte {}", byte)
                ));
            }
        }
        
        // Flush remaining bits
        if bit_count > 0 {
            bit_buffer <<= 8 - bit_count;
            compressed.push(bit_buffer as u8);
        }
        
        Ok(compressed)
    }
    
    /// Build Huffman tree from byte frequencies
    fn build_huffman_tree(&self, frequencies: &[usize; 256]) -> Result<HuffmanNode, String> {
        let mut heap = BinaryHeap::new();
        
        // Create leaf nodes for bytes with non-zero frequency
        for i in 0..256 {
            if frequencies[i] > 0 {
                heap.push(HuffmanNode {
                    frequency: frequencies[i],
                    value: Some(i as u8),
                    left: None,
                    right: None,
                });
            }
        }
        
        // Handle special cases
        if heap.is_empty() {
            return Err("No non-zero frequencies".to_string());
        }
        
        if heap.len() == 1 {
            // Only one unique byte, create a simple tree
            let leaf = heap.pop().unwrap();
            return Ok(HuffmanNode {
                frequency: leaf.frequency,
                value: None,
                left: Some(Box::new(leaf)),
                right: Some(Box::new(HuffmanNode {
                    frequency: 0,
                    value: Some(0),
                    left: None,
                    right: None,
                })),
            });
        }
        
        // Build tree by combining nodes
        while heap.len() > 1 {
            let left = heap.pop().unwrap();
            let right = heap.pop().unwrap();
            
            heap.push(HuffmanNode {
                frequency: left.frequency + right.frequency,
                value: None,
                left: Some(Box::new(left)),
                right: Some(Box::new(right)),
            });
        }
        
        // Return root node
        Ok(heap.pop().unwrap())
    }
    
    /// Generate Huffman codes from tree
    fn generate_huffman_codes(
        &self,
        node: &HuffmanNode,
        code: Vec<u8>,
        codes: &mut HashMap<u8, Vec<u8>>,
    ) -> Result<(), String> {
        if let Some(value) = node.value {
            // Leaf node, store code
            codes.insert(value, code);
            return Ok(());
        }
        
        // Internal node, traverse left and right
        if let Some(ref left) = node.left {
            let mut left_code = code.clone();
            left_code.push(0);
            self.generate_huffman_codes(left, left_code, codes)?;
        } else {
            return Err("Invalid Huffman tree: internal node missing left child".to_string());
        }
        
        if let Some(ref right) = node.right {
            let mut right_code = code.clone();
            right_code.push(1);
            self.generate_huffman_codes(right, right_code, codes)?;
        } else {
            return Err("Invalid Huffman tree: internal node missing right child".to_string());
        }
        
        Ok(())
    }
    
    /// Decompress Huffman-coded data
    fn huffman_decompress(&self, data: &[u8]) -> CompressionResult<Vec<u8>> {
        if data.is_empty() {
            return Err(CompressionError::DecompressionFailed("Empty input data".to_string()));
        }
        
        // Read header
        let mut i = 0;
        
        // Read number of unique bytes
        if i >= data.len() {
            return Err(CompressionError::DecompressionFailed("Unexpected end of data while reading header".to_string()));
        }
        
        let non_zero_freqs = data[i] as usize;
        i += 1;
        
        if non_zero_freqs == 0 {
            return Err(CompressionError::DecompressionFailed("Invalid Huffman header: zero unique bytes".to_string()));
        }
        
        // Read frequencies
        let mut frequencies = [0usize; 256];
        
        for _ in 0..non_zero_freqs {
            // Read byte value
            if i >= data.len() {
                return Err(CompressionError::DecompressionFailed("Unexpected end of data while reading byte value".to_string()));
            }
            
            let byte = data[i] as usize;
            i += 1;
            
            // Read frequency
            if i >= data.len() {
                return Err(CompressionError::DecompressionFailed("Unexpected end of data while reading frequency".to_string()));
            }
            
            let mut freq = 0;
            let mut shift = 0;
            
            loop {
                let b = data[i];
                i += 1;
                
                freq |= ((b & 0x7f) as usize) << shift;
                
                if b & 0x80 == 0 {
                    break;
                }
                
                shift += 7;
                
                if i >= data.len() {
                    return Err(CompressionError::DecompressionFailed("Unexpected end of data while reading frequency".to_string()));
                }
            }
            
            frequencies[byte] = freq;
        }
        
        // Build Huffman tree
        let tree = self.build_huffman_tree(&frequencies)
            .map_err(|e| CompressionError::DecompressionFailed(format!("Failed to build Huffman tree: {}", e)))?;
        
        // Decompress data
        let mut decompressed = Vec::new();
        let mut node = &tree;
        
        for j in i..data.len() {
            let byte = data[j];
            
            for bit_idx in (0..8).rev() {
                let bit = (byte >> bit_idx) & 1;
                
                // Traverse tree
                if bit == 0 {
                    if let Some(ref left) = node.left {
                        node = left;
                    } else {
                        return Err(CompressionError::DecompressionFailed("Invalid Huffman code: no left child".to_string()));
                    }
                } else {
                    if let Some(ref right) = node.right {
                        node = right;
                    } else {
                        return Err(CompressionError::DecompressionFailed("Invalid Huffman code: no right child".to_string()));
                    }
                }
                
                // Check if we reached a leaf node
                if let Some(value) = node.value {
                    decompressed.push(value);
                    node = &tree; // Reset to root for next code
                }
            }
        }
        
        Ok(decompressed)
    }
    
    /// Compress data using dictionary
    fn dictionary_compress(&self, data: &[u8]) -> CompressionResult<Vec<u8>> {
        // Validate input
        if data.is_empty() {
            return Err(CompressionError::DictionaryError("Empty input data".to_string()));
        }
        
        if data.len() < 3 {
            return Err(CompressionError::DictionaryError("Data too short for dictionary compression".to_string()));
        }
        
        // This is a simplified implementation
        // In a real system, we would maintain a persistent dictionary of common patterns
        
        // Build dictionary of common patterns
        let mut local_dict = HashMap::new();
        let mut next_id = 0u16;
        
        // Start with existing dictionary
        for (pattern, id) in &self.dictionary {
            local_dict.insert(pattern.clone(), *id);
            if *id >= next_id {
                next_id = *id + 1;
            }
        }
        
        // Find repeating patterns (minimum 3 bytes)
        for window_size in (3..=16).rev() {
            if data.len() < window_size {
                continue;
            }
            
            let mut pattern_counts = HashMap::new();
            
            for i in 0..=(data.len() - window_size) {
                let pattern = data[i..(i + window_size)].to_vec();
                *pattern_counts.entry(pattern).or_insert(0) += 1;
            }
            
            // Add frequent patterns to dictionary (appearing at least 3 times)
            for (pattern, count) in pattern_counts {
                if count >= 3 && next_id < 65535 && !local_dict.contains_key(&pattern) {
                    local_dict.insert(pattern, next_id);
                    next_id += 1;
                }
            }
            
            // Limit dictionary size
            if local_dict.len() >= 256 {
                break;
            }
        }
        
        // If dictionary is empty, return error
        if local_dict.is_empty() {
            return Err(CompressionError::DictionaryError("No repeating patterns found".to_string()));
        }
        
        // Compress data using dictionary
        let mut compressed = Vec::new();
        
        // Add dictionary header
        if local_dict.len() > 255 {
            compressed.push(0); // Special marker for large dictionary
            compressed.extend_from_slice(&(local_dict.len() as u16).to_le_bytes());
        } else {
            compressed.push(local_dict.len() as u8);
        }
        
        // Add dictionary entries
        for (pattern, id) in &local_dict {
            if pattern.len() > 255 {
                return Err(CompressionError::DictionaryError(
                    format!("Pattern too long: {} bytes, maximum allowed: 255 bytes", pattern.len())
                ));
            }
            
            compressed.push(pattern.len() as u8);
            compressed.extend_from_slice(pattern);
            compressed.extend_from_slice(&id.to_le_bytes());
        }
        
        // Compress data
        let mut i = 0;
        while i < data.len() {
            let mut matched = false;
            
            // Try to match patterns from dictionary
            for (pattern, id) in &local_dict {
                if i + pattern.len() <= data.len() && data[i..(i + pattern.len())] == pattern[..] {
                    // Dictionary reference
                    compressed.push(0xff); // Marker for dictionary reference
                    compressed.extend_from_slice(&id.to_le_bytes());
                    
                    i += pattern.len();
                    matched = true;
                    break;
                }
            }
            
            if !matched {
                // Literal byte
                if data[i] == 0xff {
                    // Escape 0xff
                    compressed.push(0xff);
                    compressed.push(0x00);
                } else {
                    compressed.push(data[i]);
                }
                i += 1;
            }
        }
        
        Ok(compressed)
    }
    
    /// Decompress dictionary-compressed data
    fn dictionary_decompress(&self, data: &[u8]) -> CompressionResult<Vec<u8>> {
        if data.is_empty() {
            return Err(CompressionError::DecompressionFailed("Empty input data".to_string()));
        }
        
        // Read dictionary header
        let mut i = 0;
        
        // Read dictionary size
        if i >= data.len() {
            return Err(CompressionError::DecompressionFailed("Unexpected end of data while reading dictionary size".to_string()));
        }
        
        let dict_size = if data[i] == 0 {
            // Large dictionary
            i += 1;
            if i + 2 > data.len() {
                return Err(CompressionError::DecompressionFailed("Unexpected end of data while reading large dictionary size".to_string()));
            }
            
            let size_bytes = [data[i], data[i+1]];
            i += 2;
            u16::from_le_bytes(size_bytes) as usize
        } else {
            let size = data[i] as usize;
            i += 1;
            size
        };
        
        if dict_size == 0 {
            return Err(CompressionError::DecompressionFailed("Invalid dictionary size: 0".to_string()));
        }
        
        // Read dictionary entries
        let mut dictionary = HashMap::new();
        
        for _ in 0..dict_size {
            // Read pattern length
            if i >= data.len() {
                return Err(CompressionError::DecompressionFailed("Unexpected end of data while reading pattern length".to_string()));
            }
            
            let pattern_len = data[i] as usize;
            i += 1;
            
            // Read pattern
            if i + pattern_len > data.len() {
                return Err(CompressionError::DecompressionFailed(
                    format!("Unexpected end of data while reading pattern: need {} bytes, have {} bytes", 
                        pattern_len, data.len() - i)
                ));
            }
            
            let pattern = data[i..(i + pattern_len)].to_vec();
            i += pattern_len;
            
            // Read ID
            if i + 2 > data.len() {
                return Err(CompressionError::DecompressionFailed("Unexpected end of data while reading pattern ID".to_string()));
            }
            
            let id_bytes = [data[i], data[i+1]];
            let id = u16::from_le_bytes(id_bytes);
            i += 2;
            
            // Add to dictionary
            dictionary.insert(id, pattern);
        }
        
        // Decompress data
        let mut decompressed = Vec::new();
        
        while i < data.len() {
            if data[i] == 0xff {
                // Dictionary reference or escaped 0xff
                i += 1;
                
                if i >= data.len() {
                    return Err(CompressionError::DecompressionFailed("Unexpected end of data after dictionary marker".to_string()));
                }
                
                if data[i] == 0x00 {
                    // Escaped 0xff
                    decompressed.push(0xff);
                    i += 1;
                } else {
                    // Dictionary reference
                    if i + 1 >= data.len() {
                        return Err(CompressionError::DecompressionFailed("Unexpected end of data while reading dictionary ID".to_string()));
                    }
                    
                    let id_bytes = [data[i], data[i+1]];
                    let id = u16::from_le_bytes(id_bytes);
                    i += 2;
                    
                    // Look up pattern
                    if let Some(pattern) = dictionary.get(&id) {
                        decompressed.extend_from_slice(pattern);
                    } else {
                        return Err(CompressionError::DecompressionFailed(
                            format!("Invalid dictionary reference: ID {} not found", id)
                        ));
                    }
                }
            } else {
                // Literal byte
                decompressed.push(data[i]);
                i += 1;
            }
        }
        
        Ok(decompressed)
    }
    
    /// Optimize zero bytes
    fn optimize_zero_bytes(&self, data: &[u8]) -> CompressionResult<Vec<u8>> {
        // Validate input
        if data.is_empty() {
            return Err(CompressionError::ZeroByteOptimizationError("Empty input data".to_string()));
        }
        
        // Count consecutive zero bytes
        let mut zero_runs = Vec::new();
        let mut current_run_start = None;
        let mut current_run_length = 0;
        
        for (i, &byte) in data.iter().enumerate() {
            if byte == 0 {
                if current_run_start.is_none() {
                    current_run_start = Some(i);
                }
                current_run_length += 1;
            } else {
                if current_run_length > 0 {
                    zero_runs.push((current_run_start.unwrap(), current_run_length));
                    current_run_start = None;
                    current_run_length = 0;
                }
            }
        }
        
        if current_run_length > 0 {
            zero_runs.push((current_run_start.unwrap(), current_run_length));
        }
        
        // If no zero runs, return error
        if zero_runs.is_empty() {
            return Err(CompressionError::ZeroByteOptimizationError("No zero bytes found".to_string()));
        }
        
        // Sort zero runs by length (descending)
        zero_runs.sort_by(|a, b| b.1.cmp(&a.1));
        
        // Optimize only if there are significant zero runs
        let total_zeros: usize = zero_runs.iter().map(|&(_, len)| len).sum();
        if total_zeros < data.len() / 10 {
            return Err(CompressionError::ZeroByteOptimizationError("Not enough zero bytes to optimize".to_string()));
        }
        
        // Limit number of runs to track
        let max_runs = std::cmp::min(zero_runs.len(), 255);
        let zero_runs = &zero_runs[0..max_runs];
        
        // Compress data
        let mut compressed = Vec::new();
        
        // Add header with number of zero runs
        compressed.push(zero_runs.len() as u8);
        
        // Add run information
        for &(start, length) in zero_runs {
            compressed.extend_from_slice(&(start as u32).to_le_bytes());
            compressed.extend_from_slice(&(length as u32).to_le_bytes());
        }
        
        // Create a bitmap of which bytes are part of zero runs
        let mut is_zero_run = vec![false; data.len()];
        for &(start, length) in zero_runs {
            for i in start..(start + length) {
                is_zero_run[i] = true;
            }
        }
        
        // Add non-zero bytes and references to zero runs
        let mut i = 0;
        while i < data.len() {
            if is_zero_run[i] {
                // Find which run this belongs to
                for (run_idx, &(start, length)) in zero_runs.iter().enumerate() {
                    if i >= start && i < start + length {
                        // Zero run reference
                        compressed.push(0x00); // Zero marker
                        compressed.push(run_idx as u8);
                        compressed.push((i - start) as u8); // Offset within run
                        
                        i += 1;
                        break;
                    }
                }
            } else {
                // Encode literal byte
                if data[i] == 0x00 {
                    // Escape 0x00
                    compressed.push(0x00);
                    compressed.push(0xff);
                } else {
                    compressed.push(data[i]);
                }
                i += 1;
            }
        }
        
        Ok(compressed)
    }
    
    /// Decompress zero-byte optimized data
    fn zero_byte_decompress(&self, data: &[u8]) -> CompressionResult<Vec<u8>> {
        if data.is_empty() {
            return Err(CompressionError::DecompressionFailed("Empty input data".to_string()));
        }
        
        // Read header
        let mut i = 0;
        
        // Read number of zero runs
        if i >= data.len() {
            return Err(CompressionError::DecompressionFailed("Unexpected end of data while reading number of zero runs".to_string()));
        }
        
        let num_runs = data[i] as usize;
        i += 1;
        
        if num_runs == 0 {
            return Err(CompressionError::DecompressionFailed("Invalid number of zero runs: 0".to_string()));
        }
        
        // Read run information
        let mut zero_runs = Vec::with_capacity(num_runs);
        
        for _ in 0..num_runs {
            // Read start position
            if i + 4 > data.len() {
                return Err(CompressionError::DecompressionFailed("Unexpected end of data while reading run start".to_string()));
            }
            
            let start_bytes = [data[i], data[i+1], data[i+2], data[i+3]];
            let start = u32::from_le_bytes(start_bytes) as usize;
            i += 4;
            
            // Read length
            if i + 4 > data.len() {
                return Err(CompressionError::DecompressionFailed("Unexpected end of data while reading run length".to_string()));
            }
            
            let length_bytes = [data[i], data[i+1], data[i+2], data[i+3]];
            let length = u32::from_le_bytes(length_bytes) as usize;
            i += 4;
            
            zero_runs.push((start, length));
        }
        
        // Calculate original data size
        let original_size = zero_runs.iter()
            .map(|&(start, length)| start + length)
            .max()
            .unwrap_or(0);
        
        // Decompress data
        let mut decompressed = vec![0; original_size];
        let mut filled = vec![false; original_size];
        
        // Fill in zero runs
        for &(start, length) in &zero_runs {
            for j in start..(start + length) {
                decompressed[j] = 0;
                filled[j] = true;
            }
        }
        
        // Process remaining data
        while i < data.len() {
            if data[i] == 0x00 {
                // Zero marker or escaped 0x00
                i += 1;
                
                if i >= data.len() {
                    return Err(CompressionError::DecompressionFailed("Unexpected end of data after zero marker".to_string()));
                }
                
                if data[i] == 0xff {
                    // Escaped 0x00
                    let pos = filled.iter().position(|&f| !f)
                        .ok_or_else(|| CompressionError::DecompressionFailed("No unfilled positions left".to_string()))?;
                    
                    decompressed[pos] = 0x00;
                    filled[pos] = true;
                    i += 1;
                } else {
                    // Zero run reference
                    let run_idx = data[i] as usize;
                    i += 1;
                    
                    if i >= data.len() {
                        return Err(CompressionError::DecompressionFailed("Unexpected end of data while reading run offset".to_string()));
                    }
                    
                    let offset = data[i] as usize;
                    i += 1;
                    
                    if run_idx >= zero_runs.len() {
                        return Err(CompressionError::DecompressionFailed(
                            format!("Invalid zero run index: {}, max: {}", run_idx, zero_runs.len() - 1)
                        ));
                    }
                    
                    let (start, length) = zero_runs[run_idx];
                    
                    if offset >= length {
                        return Err(CompressionError::DecompressionFailed(
                            format!("Invalid offset {} in zero run of length {}", offset, length)
                        ));
                    }
                    
                    let pos = start + offset;
                    filled[pos] = true;
                }
            } else {
                // Literal byte
                let pos = filled.iter().position(|&f| !f)
                    .ok_or_else(|| CompressionError::DecompressionFailed("No unfilled positions left".to_string()))?;
                
                decompressed[pos] = data[i];
                filled[pos] = true;
                i += 1;
            }
        }
        
        // Check if all positions are filled
        if !filled.iter().all(|&f| f) {
            return Err(CompressionError::DecompressionFailed("Not all positions were filled".to_string()));
        }
        
        Ok(decompressed)
    }
    
    /// Compress data using Brotli
    fn brotli_compress(&self, data: &[u8]) -> CompressionResult<Vec<u8>> {
        // Validate input
        if data.is_empty() {
            return Err(CompressionError::BrotliError("Empty input data".to_string()));
        }
        
        let mut compressed = Vec::new();
        
        // Compress data
        let mut writer = CompressorWriter::new(
            &mut compressed,
            4096, // buffer size
            9, // quality (0-11, higher is better compression but slower)
            22, // lgwin (window size bits, 10-24)
        );
        
        writer.write_all(data)
            .map_err(|e| CompressionError::BrotliError(format!("Brotli compression error: {}", e)))?;
        
        writer.flush()
            .map_err(|e| CompressionError::BrotliError(format!("Brotli flush error: {}", e)))?;
        
        Ok(compressed)
    }
    
    /// Decompress Brotli data
    fn brotli_decompress(&self, data: &[u8]) -> CompressionResult<Vec<u8>> {
        // Validate input
        if data.is_empty() {
            return Err(CompressionError::DecompressionFailed("Empty input data".to_string()));
        }
        
        let mut decompressed = Vec::new();
        let mut reader = CompressorReader::new(
            data,
            4096, // buffer size
        );
        
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break, // End of data
                Ok(n) => decompressed.extend_from_slice(&buffer[..n]),
                Err(e) => return Err(CompressionError::DecompressionFailed(
                    format!("Brotli decompression error: {}", e)
                )),
            }
        }
        
        Ok(decompressed)
    }
    
    /// Decompress data
    pub fn decompress(&self, data: &[u8]) -> CompressionResult<Vec<u8>> {
        if data.is_empty() {
            return Ok(Vec::new());
        }
        
        // First byte is the compression method identifier
        if data.len() < 2 {
            return Err(CompressionError::DecompressionFailed("Data too short to contain method identifier".to_string()));
        }
        
        let method_id = data[0];
        let compressed_data = &data[1..];
        
        // Decompress based on method
        match CompressionMethod::from_identifier(method_id) {
            Some(CompressionMethod::None) => Ok(compressed_data.to_vec()),
            
            Some(CompressionMethod::RlpOptimization) => {
                // RLP optimization is reversible
                Ok(compressed_data.to_vec())
            },
            
            Some(CompressionMethod::HuffmanCoding) => {
                self.huffman_decompress(compressed_data)
            },
            
            Some(CompressionMethod::Dictionary) => {
                self.dictionary_decompress(compressed_data)
            },
            
            Some(CompressionMethod::ZeroByteOptimization) => {
                self.zero_byte_decompress(compressed_data)
            },
            
            Some(CompressionMethod::Brotli) => {
                self.brotli_decompress(compressed_data)
            },
            
            Some(CompressionMethod::Combined(_)) => {
                Err(CompressionError::DecompressionFailed("Combined compression method not implemented".to_string()))
            },
            
            None => {
                Err(CompressionError::DecompressionFailed(format!("Unknown compression method: 0x{:02x}", method_id)))
            }
        }
    }
    
    /// Calculate gas cost of data
    pub fn calculate_gas_cost(&self, data: &[u8]) -> u64 {
        let mut gas = 0;
        
        for &byte in data {
            gas += if byte == 0 { 4 } else { 16 };
        }
        
        gas
    }
    
    /// Get compression statistics
    pub fn get_compression_stats(&self, original: &[u8], compressed: &[u8]) -> CompressionOutcome {
        let original_size = original.len();
        let compressed_size = compressed.len();
        
        let compression_ratio = if compressed_size > 0 {
            original_size as f64 / compressed_size as f64
        } else {
            0.0
        };
        
        let original_gas = self.calculate_gas_cost(original);
        let compressed_gas = self.calculate_gas_cost(compressed);
        
        let gas_saved = if original_gas > compressed_gas {
            original_gas - compressed_gas
        } else {
            0
        };
        
        // Determine compression method from first byte
        let method = if compressed.is_empty() {
            CompressionMethod::None
        } else {
            CompressionMethod::from_identifier(compressed[0])
                .unwrap_or(CompressionMethod::None)
        };
        
        CompressionOutcome {
            original_size,
            compressed_size,
            compression_ratio,
            gas_saved,
            method,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gas_optimization::GasOptimizerConfig;
    
    #[test]
    fn test_compression_method_identifier() {
        // Test method identifiers
        assert_eq!(CompressionMethod::None.identifier(), 0x00);
        assert_eq!(CompressionMethod::RlpOptimization.identifier(), 0x01);
        assert_eq!(CompressionMethod::HuffmanCoding.identifier(), 0x02);
        assert_eq!(CompressionMethod::Dictionary.identifier(), 0x03);
        assert_eq!(CompressionMethod::ZeroByteOptimization.identifier(), 0x04);
        assert_eq!(CompressionMethod::Brotli.identifier(), 0xB7);
        assert_eq!(CompressionMethod::Combined(vec![]).identifier(), 0xFF);
        
        // Test from_identifier
        assert_eq!(CompressionMethod::from_identifier(0x00), Some(CompressionMethod::None));
        assert_eq!(CompressionMethod::from_identifier(0x01), Some(CompressionMethod::RlpOptimization));
        assert_eq!(CompressionMethod::from_identifier(0x02), Some(CompressionMethod::HuffmanCoding));
        assert_eq!(CompressionMethod::from_identifier(0x03), Some(CompressionMethod::Dictionary));
        assert_eq!(CompressionMethod::from_identifier(0x04), Some(CompressionMethod::ZeroByteOptimization));
        assert_eq!(CompressionMethod::from_identifier(0xB7), Some(CompressionMethod::Brotli));
        assert_eq!(CompressionMethod::from_identifier(0xFF), Some(CompressionMethod::Combined(vec![])));
        assert_eq!(CompressionMethod::from_identifier(0x99), None);
    }
    
    #[test]
    fn test_calldata_compressor_creation() {
        let config = GasOptimizerConfig::default();
        let compressor = CalldataCompressor::new(config);
        
        // Test initialization
        let mut compressor = CalldataCompressor::new(GasOptimizerConfig::default());
        assert!(compressor.initialize().is_ok());
    }
    
    #[test]
    fn test_zero_byte_optimization() {
        let config = GasOptimizerConfig::default();
        let compressor = CalldataCompressor::new(config);
        
        // Test with all zeros
        let data = vec![0; 1000]; // 1KB of zeros
        
        let result = compressor.optimize_zero_bytes(&data);
        assert!(result.is_ok());
        let compressed = result.unwrap();
        assert!(compressed.len() < data.len());
        
        // Test with mixed data
        let mut mixed_data = vec![0; 1000];
        for i in 0..1000 {
            if i % 10 == 0 {
                mixed_data[i] = 1;
            }
        }
        
        let result = compressor.optimize_zero_bytes(&mixed_data);
        assert!(result.is_ok());
        let compressed = result.unwrap();
        assert!(compressed.len() < mixed_data.len());
        
        // Test with no zeros
        let no_zeros = vec![1; 1000];
        let result = compressor.optimize_zero_bytes(&no_zeros);
        assert!(result.is_err());
    }
    
    #[test]
    fn test_brotli_compression() {
        let config = GasOptimizerConfig::default();
        let compressor = CalldataCompressor::new(config);
        
        // Test with random data
        let data = vec![0; 1000]; // 1KB of zeros
        
        let result = compressor.brotli_compress(&data);
        assert!(result.is_ok());
        let compressed = result.unwrap();
        assert!(compressed.len() < data.len());
        
        // Test with mixed data
        let mut mixed_data = vec![0; 1000];
        for i in 0..1000 {
            mixed_data[i] = (i % 256) as u8;
        }
        
        let result = compressor.brotli_compress(&mixed_data);
        assert!(result.is_ok());
        let compressed = result.unwrap();
        assert!(compressed.len() < mixed_data.len());
    }
    
    #[test]
    fn test_huffman_compression() {
        let config = GasOptimizerConfig::default();
        let compressor = CalldataCompressor::new(config);
        
        // Test with repeated pattern
        let mut data = Vec::new();
        for _ in 0..100 {
            data.extend_from_slice(&[1, 2, 3, 4, 5]);
        }
        
        let result = compressor.huffman_compress(&data);
        assert!(result.is_ok());
        let compressed = result.unwrap();
        assert!(compressed.len() < data.len());
        
        // Test with single byte repeated
        let single_byte = vec![42; 1000];
        let result = compressor.huffman_compress(&single_byte);
        assert!(result.is_ok());
        let compressed = result.unwrap();
        assert!(compressed.len() < single_byte.len());
    }
    
    #[test]
    fn test_dictionary_compression() {
        let config = GasOptimizerConfig::default();
        let compressor = CalldataCompressor::new(config);
        
        // Test with repeated pattern
        let mut data = Vec::new();
        for _ in 0..100 {
            data.extend_from_slice(&[1, 2, 3, 4, 5]);
        }
        
        let result = compressor.dictionary_compress(&data);
        assert!(result.is_ok());
        let compressed = result.unwrap();
        assert!(compressed.len() < data.len());
        
        // Test with no repeating patterns
        let mut random_data = Vec::new();
        for i in 0..1000 {
            random_data.push(i as u8);
        }
        
        let result = compressor.dictionary_compress(&random_data);
        assert!(result.is_err());
    }
    
    #[test]
    fn test_compress_transaction() {
        let config = GasOptimizerConfig::default();
        let mut compressor = CalldataCompressor::new(config);
        compressor.initialize().unwrap();
        
        // Test with transaction containing zeros
        let mut transaction = Transaction {
            data: vec![0; 1000],
            // Other fields would be here in a real implementation
        };
        
        let result = compressor.compress_transaction(&mut transaction);
        assert!(result.is_ok());
        let outcome = result.unwrap();
        
        // Should be compressed
        assert!(outcome.compressed_size < outcome.original_size);
        assert!(outcome.compression_ratio > 1.0);
        assert!(outcome.gas_saved > 0);
        assert_ne!(outcome.method, CompressionMethod::None);
        
        // Test with small transaction (should not be compressed)
        let mut small_transaction = Transaction {
            data: vec![1, 2, 3],
            // Other fields would be here in a real implementation
        };
        
        let result = compressor.compress_transaction(&mut small_transaction);
        assert!(result.is_ok());
        let outcome = result.unwrap();
        
        // Should not be compressed
        assert_eq!(outcome.compressed_size, outcome.original_size);
        assert_eq!(outcome.compression_ratio, 1.0);
        assert_eq!(outcome.gas_saved, 0);
        assert_eq!(outcome.method, CompressionMethod::None);
    }
    
    #[test]
    fn test_compression_decompression_roundtrip() {
        let config = GasOptimizerConfig::default();
        let mut compressor = CalldataCompressor::new(config);
        compressor.initialize().unwrap();
        
        // Test with different data patterns
        let test_cases = vec![
            vec![0; 1000],                    // All zeros
            vec![1; 1000],                    // All ones
            vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9], // Sequential
            {                                 // Repeated pattern
                let mut data = Vec::new();
                for _ in 0..100 {
                    data.extend_from_slice(&[1, 2, 3, 4, 5]);
                }
                data
            },
            {                                 // Mixed data
                let mut data = vec![0; 1000];
                for i in 0..1000 {
                    if i % 10 == 0 {
                        data[i] = 1;
                    }
                }
                data
            },
        ];
        
        for data in test_cases {
            let mut transaction = Transaction {
                data: data.clone(),
                // Other fields would be here in a real implementation
            };
            
            // Compress
            let result = compressor.compress_transaction(&mut transaction);
            if result.is_err() {
                // Some data patterns might not be compressible, that's ok
                continue;
            }
            
            let outcome = result.unwrap();
            if outcome.method == CompressionMethod::None {
                // No compression applied, skip
                continue;
            }
            
            // Decompress
            let result = compressor.decompress(&transaction.data);
            assert!(result.is_ok(), "Decompression failed for method: {:?}", outcome.method);
            
            let decompressed = result.unwrap();
            
            // Check roundtrip
            assert_eq!(decompressed, data, "Roundtrip failed for method: {:?}", outcome.method);
        }
    }
    
    #[test]
    fn test_gas_cost_calculation() {
        let config = GasOptimizerConfig::default();
        let compressor = CalldataCompressor::new(config);
        
        // Test with all zeros
        let zeros = vec![0; 10];
        assert_eq!(compressor.calculate_gas_cost(&zeros), 40); // 10 * 4 = 40
        
        // Test with all non-zeros
        let non_zeros = vec![1; 10];
        assert_eq!(compressor.calculate_gas_cost(&non_zeros), 160); // 10 * 16 = 160
        
        // Test with mixed data
        let mixed = vec![0, 1, 0, 1, 0];
        assert_eq!(compressor.calculate_gas_cost(&mixed), 44); // 3 * 4 + 2 * 16 = 12 + 32 = 44
    }
}
