// src/fraud_proof_system/merkle_tree.rs
//! Merkle Tree implementation for the Fraud Proof System
//! 
//! This module provides a standard Merkle Tree implementation for
//! state root verification and fraud proof generation.

use solana_program::keccak;
use std::collections::HashMap;
use borsh::{BorshDeserialize, BorshSerialize};

/// Merkle Tree implementation
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct MerkleTree {
    /// Leaves of the tree
    leaves: Vec<[u8; 32]>,
    
    /// Root of the tree
    root: [u8; 32],
    
    /// Height of the tree
    height: usize,
}

impl MerkleTree {
    /// Create a new Merkle tree from leaves
    pub fn new(leaves: Vec<[u8; 32]>) -> Self {
        let mut tree = Self {
            leaves: leaves.clone(),
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
    fn calculate_root(&self) -> [u8; 32] {
        let mut current_level = self.leaves.clone();
        
        // If there's only one leaf, it's the root
        if current_level.len() == 1 {
            return current_level[0];
        }
        
        // Calculate the root by iteratively hashing pairs of nodes
        while current_level.len() > 1 {
            let mut next_level = Vec::new();
            
            // Process pairs of nodes
            for i in (0..current_level.len()).step_by(2) {
                let left = current_level[i];
                let right = if i + 1 < current_level.len() {
                    current_level[i + 1]
                } else {
                    // If there's an odd number of nodes, duplicate the last one
                    left
                };
                
                // Hash the pair
                let node = self.hash_nodes(&left, &right);
                next_level.push(node);
            }
            
            // Move to the next level
            current_level = next_level;
        }
        
        // The last remaining node is the root
        current_level[0]
    }
    
    /// Hash two nodes together
    fn hash_nodes(&self, left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
        let mut input = Vec::with_capacity(64);
        input.extend_from_slice(left);
        input.extend_from_slice(right);
        keccak::hash(&input).to_bytes()
    }
    
    /// Generate a Merkle proof for a leaf
    pub fn generate_proof(&self, index: usize) -> Vec<[u8; 32]> {
        if index >= self.leaves.len() {
            return Vec::new();
        }
        
        let mut proof = Vec::new();
        let mut current_index = index;
        let mut current_level = self.leaves.clone();
        
        while current_level.len() > 1 {
            let mut next_level = Vec::new();
            
            // Process pairs of nodes
            for i in (0..current_level.len()).step_by(2) {
                if i == current_index || i + 1 == current_index {
                    // Add the sibling to the proof
                    if i == current_index {
                        if i + 1 < current_level.len() {
                            proof.push(current_level[i + 1]);
                        } else {
                            // If there's no sibling, use the node itself
                            proof.push(current_level[i]);
                        }
                    } else {
                        proof.push(current_level[i]);
                    }
                }
                
                let left = current_level[i];
                let right = if i + 1 < current_level.len() {
                    current_level[i + 1]
                } else {
                    // If there's an odd number of nodes, duplicate the last one
                    left
                };
                
                // Hash the pair
                let node = self.hash_nodes(&left, &right);
                next_level.push(node);
                
                // Update the index for the next level
                if i <= current_index && current_index <= i + 1 {
                    current_index = next_level.len() - 1;
                }
            }
            
            // Move to the next level
            current_level = next_level;
        }
        
        proof
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
    
    /// Get a leaf from the tree
    pub fn get_leaf(&self, index: usize) -> Option<[u8; 32]> {
        if index < self.leaves.len() {
            Some(self.leaves[index])
        } else {
            None
        }
    }
    
    /// Get all leaves from the tree
    pub fn get_leaves(&self) -> &[[u8; 32]] {
        &self.leaves
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_merkle_tree() {
        // Create a set of leaves
        let leaves = vec![
            [1; 32], [2; 32], [3; 32], [4; 32], [5; 32], [6; 32], [7; 32], [8; 32],
        ];
        
        // Create a Merkle tree
        let mut tree = MerkleTree::new(leaves.clone());
        
        // Get the root
        let root = tree.root();
        
        // Verify the root is not zero
        assert_ne!(root, [0; 32]);
        
        // Generate and verify proofs for each leaf
        for (i, leaf) in leaves.iter().enumerate() {
            let proof = tree.generate_proof(i);
            let result = MerkleTree::verify_proof(&root, leaf, &proof, i);
            assert!(result, "Proof verification failed for leaf {}", i);
        }
        
        // Verify with an incorrect leaf
        let incorrect_leaf = [9; 32];
        let proof = tree.generate_proof(0);
        let result = MerkleTree::verify_proof(&root, &incorrect_leaf, &proof, 0);
        assert!(!result, "Proof verification should fail for incorrect leaf");
        
        // Update a leaf
        let new_leaf = [10; 32];
        tree.update_leaf(0, new_leaf);
        
        // Get the new root
        let new_root = tree.root();
        
        // Verify the new root is different
        assert_ne!(root, new_root, "Root should change after leaf update");
        
        // Generate and verify a proof for the updated leaf
        let proof = tree.generate_proof(0);
        let result = MerkleTree::verify_proof(&new_root, &new_leaf, &proof, 0);
        assert!(result, "Proof verification failed for updated leaf");
    }
    
    #[test]
    fn test_empty_tree() {
        // Create an empty tree
        let tree = MerkleTree::new(Vec::new());
        
        // Verify the root is zero
        assert_eq!(tree.root(), [0; 32], "Empty tree root should be zero");
        
        // Verify the tree is empty
        assert!(tree.is_empty(), "Tree should be empty");
        assert_eq!(tree.len(), 0, "Tree length should be 0");
    }
    
    #[test]
    fn test_single_leaf_tree() {
        // Create a tree with a single leaf
        let leaf = [1; 32];
        let tree = MerkleTree::new(vec![leaf]);
        
        // Verify the root is the leaf
        assert_eq!(tree.root(), leaf, "Single leaf tree root should be the leaf");
        
        // Verify the tree is not empty
        assert!(!tree.is_empty(), "Tree should not be empty");
        assert_eq!(tree.len(), 1, "Tree length should be 1");
        
        // Generate and verify a proof for the leaf
        let proof = tree.generate_proof(0);
        assert!(proof.is_empty(), "Proof for single leaf tree should be empty");
        let result = MerkleTree::verify_proof(&tree.root(), &leaf, &proof, 0);
        assert!(result, "Proof verification failed for single leaf");
    }
}
