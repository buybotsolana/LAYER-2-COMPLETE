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
use crate::gas_optimization::{Transaction, GasOptimizerConfig};

/// Result of calldata compression
#[derive(Clone, Debug)]
pub struct CompressionResult {
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
        }
    }
    
    /// Initialize the compressor
    pub fn initialize(&self) -> Result<(), String> {
        // Nothing to initialize for now
        Ok(())
    }
    
    /// Compress transaction calldata
    pub fn compress_transaction(&self, transaction: &mut Transaction) -> Result<CompressionResult, String> {
        let original_data = transaction.data.clone();
        let original_size = original_data.len();
        
        // Skip compression for very small payloads
        if original_size < 32 {
            return Ok(CompressionResult {
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
        if let Ok(rlp_data) = self.optimize_rlp(&original_data) {
            if rlp_data.len() < best_size {
                best_result = Some((rlp_data, CompressionMethod::RlpOptimization));
                best_size = best_result.as_ref().unwrap().0.len();
            }
        }
        
        // 2. Try Huffman coding
        if let Ok(huffman_data) = self.huffman_compress(&original_data) {
            if huffman_data.len() < best_size {
                best_result = Some((huffman_data, CompressionMethod::HuffmanCoding));
                best_size = best_result.as_ref().unwrap().0.len();
            }
        }
        
        // 3. Try dictionary compression
        if let Ok(dict_data) = self.dictionary_compress(&original_data) {
            if dict_data.len() < best_size {
                best_result = Some((dict_data, CompressionMethod::Dictionary));
                best_size = best_result.as_ref().unwrap().0.len();
            }
        }
        
        // 4. Try zero byte optimization
        if let Ok(zero_data) = self.optimize_zero_bytes(&original_data) {
            if zero_data.len() < best_size {
                best_result = Some((zero_data, CompressionMethod::ZeroByteOptimization));
                best_size = best_result.as_ref().unwrap().0.len();
            }
        }
        
        // 5. Try Brotli compression for large payloads
        if original_size > 1024 {
            if let Ok(brotli_data) = self.brotli_compress(&original_data) {
                if brotli_data.len() < best_size {
                    best_result = Some((brotli_data, CompressionMethod::Brotli));
                    best_size = best_result.as_ref().unwrap().0.len();
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
                
                // Update transaction data
                transaction.data = compressed_data.clone();
                
                // Return compression result
                return Ok(CompressionResult {
                    original_size,
                    compressed_size: compressed_data.len(),
                    compression_ratio: original_size as f64 / compressed_data.len() as f64,
                    gas_saved,
                    method,
                });
            }
        }
        
        // If no compression method was better, return original
        Ok(CompressionResult {
            original_size,
            compressed_size: original_size,
            compression_ratio: 1.0,
            gas_saved: 0,
            method: CompressionMethod::None,
        })
    }
    
    /// Optimize RLP encoding
    fn optimize_rlp(&self, data: &[u8]) -> Result<Vec<u8>, String> {
        // Check if data is RLP encoded
        if !self.is_rlp_encoded(data) {
            return Err("Data is not RLP encoded".to_string());
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
                        if data[j] < 0x80 || data[j] > 0xb7 {
                            can_optimize = false;
                            break;
                        }
                        j += 1 + (data[j] - 0x80) as usize;
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
    fn huffman_compress(&self, data: &[u8]) -> Result<Vec<u8>, String> {
        // Count frequency of each byte
        let mut frequencies = [0usize; 256];
        for &byte in data {
            frequencies[byte as usize] += 1;
        }
        
        // Build Huffman tree
        let tree = self.build_huffman_tree(&frequencies)?;
        
        // Generate Huffman codes
        let mut codes = HashMap::new();
        self.generate_huffman_codes(&tree, Vec::new(), &mut codes)?;
        
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
                return Err(format!("No Huffman code for byte {}", byte));
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
        }
        
        if let Some(ref right) = node.right {
            let mut right_code = code.clone();
            right_code.push(1);
            self.generate_huffman_codes(right, right_code, codes)?;
        }
        
        Ok(())
    }
    
    /// Compress data using dictionary
    fn dictionary_compress(&self, data: &[u8]) -> Result<Vec<u8>, String> {
        // This is a simplified implementation
        // In a real system, we would maintain a persistent dictionary of common patterns
        
        // Build dictionary of common patterns
        let mut local_dict = HashMap::new();
        let mut next_id = 0u16;
        
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
                if count >= 3 && next_id < 65535 {
                    local_dict.insert(pattern, next_id);
                    next_id += 1;
                }
            }
            
            // Limit dictionary size
            if local_dict.len() >= 256 {
                break;
            }
        }
        
        // If dictionary is empty, return original data
        if local_dict.is_empty() {
            return Err("No repeating patterns found".to_string());
        }
        
        // Compress data using dictionary
        let mut compressed = Vec::new();
        
        // Add dictionary header
        compressed.push(local_dict.len() as u8);
        
        for (pattern, id) in &local_dict {
            compressed.push(pattern.len() as u8);
            compressed.extend_from_slice(pattern);
            compressed.push((*id >> 8) as u8);
            compressed.push((*id & 0xff) as u8);
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
                    compressed.push((*id >> 8) as u8);
                    compressed.push((*id & 0xff) as u8);
                    
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
    
    /// Optimize zero bytes
    fn optimize_zero_bytes(&self, data: &[u8]) -> Result<Vec<u8>, String> {
        // Count consecutive zero bytes
        let mut zero_runs = Vec::new();
        let mut current_run = 0;
        
        for &byte in data {
            if byte == 0 {
                current_run += 1;
            } else {
                if current_run > 0 {
                    zero_runs.push((current_run, zero_runs.len()));
                    current_run = 0;
                }
            }
        }
        
        if current_run > 0 {
            zero_runs.push((current_run, zero_runs.len()));
        }
        
        // If no zero runs, return original data
        if zero_runs.is_empty() {
            return Err("No zero bytes found".to_string());
        }
        
        // Sort zero runs by length (descending)
        zero_runs.sort_by(|a, b| b.0.cmp(&a.0));
        
        // Optimize only if there are significant zero runs
        let total_zeros: usize = zero_runs.iter().map(|&(len, _)| len).sum();
        if total_zeros < data.len() / 10 {
            return Err("Not enough zero bytes to optimize".to_string());
        }
        
        // Compress data
        let mut compressed = Vec::new();
        
        // Add header with number of zero runs
        compressed.push(zero_runs.len() as u8);
        
        // Process data
        let mut i = 0;
        let mut next_run_idx = 0;
        
        while i < data.len() {
            if data[i] == 0 {
                // Count consecutive zeros
                let mut zero_count = 0;
                let mut j = i;
                while j < data.len() && data[j] == 0 {
                    zero_count += 1;
                    j += 1;
                }
                
                // Find this run in our sorted list
                let run_idx = zero_runs.iter().position(|&(_, idx)| idx == next_run_idx).unwrap();
                next_run_idx += 1;
                
                // Encode zero run
                compressed.push(0x00); // Zero marker
                compressed.push(run_idx as u8); // Run index
                compressed.push(zero_count as u8); // Run length
                
                i += zero_count;
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
    
    /// Compress data using Brotli
    fn brotli_compress(&self, data: &[u8]) -> Result<Vec<u8>, String> {
        let mut compressed = Vec::new();
        
        // Add marker for Brotli compression
        compressed.push(0xB7); // 'B' in hex
        
        // Compress data
        let mut writer = CompressorWriter::new(
            &mut compressed,
            4096, // buffer size
            9, // quality (0-11, higher is better compression but slower)
            22, // lgwin (window size bits, 10-24)
        );
        
        if let Err(e) = writer.write_all(data) {
            return Err(format!("Brotli compression error: {}", e));
        }
        
        if let Err(e) = writer.flush() {
            return Err(format!("Brotli flush error: {}", e));
        }
        
        Ok(compressed)
    }
    
    /// Decompress data
    pub fn decompress(&self, data: &[u8]) -> Result<Vec<u8>, String> {
        if data.is_empty() {
            return Ok(Vec::new());
        }
        
        // Check compression method
        if data[0] == 0xB7 {
            // Brotli compression
            return self.brotli_decompress(&data[1..]);
        }
        
        // For other methods, we would need to implement specific decompression logic
        // This is a placeholder for a complete implementation
        Err("Decompression not implemented for this format".to_string())
    }
    
    /// Decompress Brotli data
    fn brotli_decompress(&self, data: &[u8]) -> Result<Vec<u8>, String> {
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
                Err(e) => return Err(format!("Brotli decompression error: {}", e)),
            }
        }
        
        Ok(decompressed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gas_optimization::GasOptimizerConfig;
    
    #[test]
    fn test_calldata_compression() {
        let config = GasOptimizerConfig::default();
        let compressor = CalldataCompressor::new(config);
        
        // Test with random data
        let data = vec![0; 1000]; // 1KB of zeros
        
        // Test zero byte optimization
        let result = compressor.optimize_zero_bytes(&data);
        assert!(result.is_ok());
        let compressed = result.unwrap();
        assert!(compressed.len() < data.len());
        
        // Test Brotli compression
        let result = compressor.brotli_compress(&data);
        assert!(result.is_ok());
        let compressed = result.unwrap();
        assert!(compressed.len() < data.len());
        
        // Test decompression
        let result = compressor.decompress(&compressed);
        assert!(result.is_ok());
        let decompressed = result.unwrap();
        assert_eq!(decompressed, data);
    }
}
