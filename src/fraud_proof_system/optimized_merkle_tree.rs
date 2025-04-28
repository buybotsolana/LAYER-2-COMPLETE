// src/fraud_proof_system/optimized_merkle_tree.rs
//! Optimized Merkle Tree implementation for the Fraud Proof System
//! 
//! This module provides an optimized implementation of Merkle Trees
//! for efficient state root verification and fraud proof generation.

use solana_program::keccak;
use std::collections::HashMap;

/// Optimized Merkle Tree implementation
pub struct OptimizedMerkleTree {
    /// Leaves of the tree
    leaves: Vec<[u8; 32]>,
    
    /// Nodes of the tree (cached)
    nodes: HashMap<(usize, usize), [u8; 32]>,
    
    /// Root of the tree (cached)
    root: [u8; 32],
    
    /// Height of the tree
    height: usize,
}

impl OptimizedMerkleTree {
    /// Create a new Merkle tree from leaves
    pub fn new(leaves: Vec<[u8; 32]>) -> Self {
        let mut tree = Self {
            leaves: leaves.clone(),
            nodes: HashMap::new(),
            root: [0; 32],
            height: 0,
        };
        
        // Calculate the height of the tree
        let mut height = 0;
        let mut count = leaves.len();
        while count > 0 {
            height += 1;
            count >>= 1;
        }
        tree.height = height;
        
        // Calculate the root
        if !leaves.is_empty() {
            tree.root = tree.calculate_root();
        }
        
        tree
    }
    
    /// Get the root of the tree
    pub fn root(&self) -> [u8; 32] {
        self.root
    }
    
    /// Calculate the root of the tree
    fn calculate_root(&mut self) -> [u8; 32] {
        self.calculate_node(0, 0, self.leaves.len())
    }
    
    /// Calculate a node in the tree
    fn calculate_node(&mut self, level: usize, start: usize, end: usize) -> [u8; 32] {
        // Check if the node is already cached
        if let Some(&node) = self.nodes.get(&(level, start)) {
            return node;
        }
        
        // If this is a leaf node, return the leaf
        if level == self.height - 1 {
            let leaf = if start < self.leaves.len() {
                self.leaves[start]
            } else {
                [0; 32]
            };
            self.nodes.insert((level, start), leaf);
            return leaf;
        }
        
        // Calculate the midpoint
        let mid = start + ((end - start) >> 1);
        
        // Calculate the left and right children
        let left = self.calculate_node(level + 1, start, mid);
        let right = self.calculate_node(level + 1, mid, end);
        
        // Hash the children together
        let node = self.hash_nodes(&left, &right);
        
        // Cache the node
        self.nodes.insert((level, start), node);
        
        node
    }
    
    /// Hash two nodes together
    fn hash_nodes(&self, left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
        let mut input = Vec::with_capacity(64);
        input.extend_from_slice(left);
        input.extend_from_slice(right);
        keccak::hash(&input).to_bytes()
    }
    
    /// Generate a Merkle proof for a leaf
    pub fn generate_proof(&mut self, index: usize) -> Vec<[u8; 32]> {
        let mut proof = Vec::new();
        self.generate_proof_recursive(&mut proof, 0, 0, self.leaves.len(), index);
        proof
    }
    
    /// Generate a Merkle proof recursively
    fn generate_proof_recursive(
        &mut self,
        proof: &mut Vec<[u8; 32]>,
        level: usize,
        start: usize,
        end: usize,
        index: usize,
    ) {
        // If we've reached the bottom of the tree, return
        if level == self.height - 1 {
            return;
        }
        
        // Calculate the midpoint
        let mid = start + ((end - start) >> 1);
        
        // Determine which child contains the index
        if index < mid {
            // Index is in the left child, so add the right child to the proof
            let right = self.calculate_node(level + 1, mid, end);
            proof.push(right);
            
            // Recurse to the left child
            self.generate_proof_recursive(proof, level + 1, start, mid, index);
        } else {
            // Index is in the right child, so add the left child to the proof
            let left = self.calculate_node(level + 1, start, mid);
            proof.push(left);
            
            // Recurse to the right child
            self.generate_proof_recursive(proof, level + 1, mid, end, index);
        }
    }
    
    /// Verify a Merkle proof
    pub fn verify_proof(
        root: &[u8; 32],
        leaf: &[u8; 32],
        proof: &[[u8; 32]],
        index: usize,
    ) -> bool {
        let mut current = *leaf;
        let mut current_index = index;
        
        for &sibling in proof {
            let (left, right) = if current_index % 2 == 0 {
                (current, sibling)
            } else {
                (sibling, current)
            };
            
            // Hash the nodes together
            let mut input = Vec::with_capacity(64);
            input.extend_from_slice(&left);
            input.extend_from_slice(&right);
            current = keccak::hash(&input).to_bytes();
            
            // Move up the tree
            current_index >>= 1;
        }
        
        // Verify that the calculated root matches the expected root
        current == *root
    }
    
    /// Update a leaf in the tree
    pub fn update_leaf(&mut self, index: usize, new_leaf: [u8; 32]) {
        if index >= self.leaves.len() {
            return;
        }
        
        // Update the leaf
        self.leaves[index] = new_leaf;
        
        // Clear the cache
        self.nodes.clear();
        
        // Recalculate the root
        self.root = self.calculate_root();
    }
    
    /// Get the number of leaves in the tree
    pub fn len(&self) -> usize {
        self.leaves.len()
    }
    
    /// Check if the tree is empty
    pub fn is_empty(&self) -> bool {
        self.leaves.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_optimized_merkle_tree() {
        // Create a set of leaves
        let leaves = vec![
            [1; 32], [2; 32], [3; 32], [4; 32], [5; 32], [6; 32], [7; 32], [8; 32],
        ];
        
        // Create a Merkle tree
        let mut tree = OptimizedMerkleTree::new(leaves.clone());
        
        // Get the root
        let root = tree.root();
        
        // Verify the root is not zero
        assert_ne!(root, [0; 32]);
        
        // Generate and verify proofs for each leaf
        for (i, leaf) in leaves.iter().enumerate() {
            let proof = tree.generate_proof(i);
            let result = OptimizedMerkleTree::verify_proof(&root, leaf, &proof, i);
            assert!(result);
        }
        
        // Verify with an incorrect leaf
        let incorrect_leaf = [9; 32];
        let proof = tree.generate_proof(0);
        let result = OptimizedMerkleTree::verify_proof(&root, &incorrect_leaf, &proof, 0);
        assert!(!result);
        
        // Update a leaf
        let new_leaf = [10; 32];
        tree.update_leaf(0, new_leaf);
        
        // Get the new root
        let new_root = tree.root();
        
        // Verify the new root is different
        assert_ne!(root, new_root);
        
        // Generate and verify a proof for the updated leaf
        let proof = tree.generate_proof(0);
        let result = OptimizedMerkleTree::verify_proof(&new_root, &new_leaf, &proof, 0);
        assert!(result);
    }
}
