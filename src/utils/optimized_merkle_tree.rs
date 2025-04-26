// src/utils/optimized_merkle_tree.rs
//! Optimized Merkle Tree implementation for Layer-2 on Solana
//! 
//! This module provides an optimized implementation of a Merkle Tree
//! for efficient state proof verification. It includes optimizations
//! for memory usage, computation speed, and verification efficiency.

use solana_program::keccak::hash;
use std::collections::HashMap;

/// Optimized Merkle Tree implementation
pub struct OptimizedMerkleTree {
    /// Depth of the tree
    depth: usize,
    
    /// Nodes of the tree, stored in a flat array for cache efficiency
    nodes: Vec<[u8; 32]>,
    
    /// Cache of computed nodes to avoid redundant calculations
    node_cache: HashMap<(usize, usize), [u8; 32]>,
    
    /// Default hash values for empty nodes at each level
    default_hashes: Vec<[u8; 32]>,
}

impl OptimizedMerkleTree {
    /// Create a new optimized Merkle tree with the specified depth
    pub fn new(depth: usize) -> Self {
        let mut default_hashes = Vec::with_capacity(depth + 1);
        let mut current_hash = [0; 32];
        
        // Compute default hash values for each level
        default_hashes.push(current_hash);
        for _ in 0..depth {
            current_hash = hash(&[&current_hash[..], &current_hash[..]].concat()).to_bytes();
            default_hashes.push(current_hash);
        }
        
        // Initialize with capacity for a complete tree to avoid reallocations
        let capacity = (1 << (depth + 1)) - 1;
        
        Self {
            depth,
            nodes: Vec::with_capacity(capacity),
            node_cache: HashMap::new(),
            default_hashes,
        }
    }
    
    /// Initialize the tree with the given leaves
    pub fn initialize(&mut self, leaves: &[[u8; 32]]) -> [u8; 32] {
        // Clear existing data
        self.nodes.clear();
        self.node_cache.clear();
        
        // Calculate the number of leaves in a complete tree
        let leaf_count = 1 << self.depth;
        
        // Initialize leaf nodes
        for i in 0..leaf_count {
            if i < leaves.len() {
                self.nodes.push(leaves[i]);
            } else {
                self.nodes.push(self.default_hashes[0]);
            }
        }
        
        // Build the tree bottom-up
        let mut level_size = leaf_count;
        let mut level_offset = 0;
        
        while level_size > 1 {
            let next_level_size = level_size / 2;
            let next_level_offset = level_offset + level_size;
            
            for i in 0..next_level_size {
                let left_idx = level_offset + 2 * i;
                let right_idx = level_offset + 2 * i + 1;
                
                let left = self.nodes[left_idx];
                let right = self.nodes[right_idx];
                
                let parent = hash(&[&left[..], &right[..]].concat()).to_bytes();
                self.nodes.push(parent);
                
                // Cache the node
                self.node_cache.insert((next_level_offset, i), parent);
            }
            
            level_offset = next_level_offset;
            level_size = next_level_size;
        }
        
        // Return the root hash
        self.nodes[self.nodes.len() - 1]
    }
    
    /// Get the root hash of the tree
    pub fn root(&self) -> [u8; 32] {
        if self.nodes.is_empty() {
            self.default_hashes[self.depth]
        } else {
            self.nodes[self.nodes.len() - 1]
        }
    }
    
    /// Generate a Merkle proof for the leaf at the specified index
    pub fn generate_proof(&self, leaf_index: usize) -> Vec<[u8; 32]> {
        let mut proof = Vec::with_capacity(self.depth);
        let mut current_index = leaf_index;
        let mut level_size = 1 << self.depth;
        let mut level_offset = 0;
        
        for _ in 0..self.depth {
            // Get the sibling index
            let sibling_index = if current_index % 2 == 0 {
                current_index + 1
            } else {
                current_index - 1
            };
            
            // Add the sibling to the proof
            if sibling_index < level_offset + level_size {
                proof.push(self.nodes[sibling_index]);
            } else {
                // Use default hash if sibling is out of bounds
                proof.push(self.default_hashes[self.depth - proof.len()]);
            }
            
            // Move to the parent level
            current_index = level_offset + level_size + current_index / 2;
            level_offset += level_size;
            level_size /= 2;
        }
        
        proof
    }
    
    /// Verify a Merkle proof for a leaf
    pub fn verify_proof(root: [u8; 32], leaf: [u8; 32], proof: &[[u8; 32]], leaf_index: usize) -> bool {
        let mut current_hash = leaf;
        let mut current_index = leaf_index;
        
        for &sibling in proof {
            // Determine if the current node is a left or right child
            let (left, right) = if current_index % 2 == 0 {
                (current_hash, sibling)
            } else {
                (sibling, current_hash)
            };
            
            // Compute the parent hash
            current_hash = hash(&[&left[..], &right[..]].concat()).to_bytes();
            
            // Move to the parent index
            current_index /= 2;
        }
        
        // Verify that the computed root matches the expected root
        current_hash == root
    }
    
    /// Update a leaf and recompute the affected path
    pub fn update_leaf(&mut self, leaf_index: usize, new_value: [u8; 32]) -> [u8; 32] {
        if leaf_index >= (1 << self.depth) {
            panic!("Leaf index out of bounds");
        }
        
        // Update the leaf
        self.nodes[leaf_index] = new_value;
        
        // Recompute the path to the root
        let mut current_index = leaf_index;
        let mut level_size = 1 << self.depth;
        let mut level_offset = 0;
        
        for _ in 0..self.depth {
            // Determine if the current node is a left or right child
            let parent_index = level_offset + level_size + current_index / 2;
            let sibling_index = if current_index % 2 == 0 {
                current_index + 1
            } else {
                current_index - 1
            };
            
            // Get the sibling
            let sibling = if sibling_index < level_offset + level_size {
                self.nodes[sibling_index]
            } else {
                self.default_hashes[self.depth - (parent_index - (level_offset + level_size))]
            };
            
            // Compute the parent hash
            let (left, right) = if current_index % 2 == 0 {
                (self.nodes[current_index], sibling)
            } else {
                (sibling, self.nodes[current_index])
            };
            
            let parent = hash(&[&left[..], &right[..]].concat()).to_bytes();
            
            // Update the parent
            if parent_index < self.nodes.len() {
                self.nodes[parent_index] = parent;
            } else {
                self.nodes.push(parent);
            }
            
            // Cache the node
            self.node_cache.insert((level_offset + level_size, current_index / 2), parent);
            
            // Move to the parent level
            current_index = current_index / 2;
            level_offset += level_size;
            level_size /= 2;
        }
        
        // Return the new root
        self.root()
    }
    
    /// Get a node at the specified level and index
    pub fn get_node(&self, level: usize, index: usize) -> [u8; 32] {
        if level > self.depth {
            panic!("Level out of bounds");
        }
        
        if index >= (1 << (self.depth - level)) {
            panic!("Index out of bounds for level");
        }
        
        // Check if the node is cached
        if let Some(&node) = self.node_cache.get(&(level, index)) {
            return node;
        }
        
        // Calculate the node index in the flat array
        let level_offset = (1 << level) - 1;
        let node_index = level_offset + index;
        
        if node_index < self.nodes.len() {
            self.nodes[node_index]
        } else {
            self.default_hashes[level]
        }
    }
    
    /// Batch update multiple leaves for efficiency
    pub fn batch_update(&mut self, updates: &[(usize, [u8; 32])]) -> [u8; 32] {
        if updates.is_empty() {
            return self.root();
        }
        
        // Update all leaves first
        for &(index, value) in updates {
            if index >= (1 << self.depth) {
                panic!("Leaf index out of bounds");
            }
            self.nodes[index] = value;
        }
        
        // Track which parent nodes need to be updated
        let mut affected_parents = HashMap::new();
        for &(index, _) in updates {
            affected_parents.insert(index / 2, true);
        }
        
        // Recompute the tree level by level
        let mut level_size = 1 << self.depth;
        let mut level_offset = 0;
        
        for level in 0..self.depth {
            let next_level_size = level_size / 2;
            let next_level_offset = level_offset + level_size;
            
            let mut next_affected_parents = HashMap::new();
            
            for &parent_index in affected_parents.keys() {
                // Compute the parent hash
                let left_idx = level_offset + 2 * parent_index;
                let right_idx = level_offset + 2 * parent_index + 1;
                
                let left = if left_idx < level_offset + level_size {
                    self.nodes[left_idx]
                } else {
                    self.default_hashes[self.depth - level]
                };
                
                let right = if right_idx < level_offset + level_size {
                    self.nodes[right_idx]
                } else {
                    self.default_hashes[self.depth - level]
                };
                
                let parent = hash(&[&left[..], &right[..]].concat()).to_bytes();
                
                // Update the parent
                let parent_node_index = next_level_offset + parent_index;
                if parent_node_index < self.nodes.len() {
                    self.nodes[parent_node_index] = parent;
                } else {
                    self.nodes.push(parent);
                }
                
                // Cache the node
                self.node_cache.insert((next_level_offset, parent_index), parent);
                
                // Mark the grandparent as affected
                next_affected_parents.insert(parent_index / 2, true);
            }
            
            affected_parents = next_affected_parents;
            level_offset = next_level_offset;
            level_size = next_level_size;
        }
        
        // Return the new root
        self.root()
    }
    
    /// Clear the node cache to free memory
    pub fn clear_cache(&mut self) {
        self.node_cache.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_optimized_merkle_tree() {
        // Create a tree with depth 3 (8 leaves)
        let mut tree = OptimizedMerkleTree::new(3);
        
        // Initialize with some leaves
        let leaves = [
            [1; 32], [2; 32], [3; 32], [4; 32],
            [5; 32], [6; 32], [7; 32], [8; 32],
        ];
        
        let root = tree.initialize(&leaves);
        
        // Generate a proof for leaf 2
        let proof = tree.generate_proof(2);
        
        // Verify the proof
        assert!(OptimizedMerkleTree::verify_proof(root, leaves[2], &proof, 2));
        
        // Update a leaf
        let new_leaf = [42; 32];
        let new_root = tree.update_leaf(2, new_leaf);
        
        // Generate a new proof
        let new_proof = tree.generate_proof(2);
        
        // Verify the new proof
        assert!(OptimizedMerkleTree::verify_proof(new_root, new_leaf, &new_proof, 2));
        
        // Batch update multiple leaves
        let updates = vec![(0, [10; 32]), (3, [20; 32]), (7, [30; 32])];
        let batch_root = tree.batch_update(&updates);
        
        // Verify a proof after batch update
        let batch_proof = tree.generate_proof(3);
        assert!(OptimizedMerkleTree::verify_proof(batch_root, [20; 32], &batch_proof, 3));
    }
}
