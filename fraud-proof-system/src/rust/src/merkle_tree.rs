// src/merkle_tree.rs
//! Merkle Tree implementation for state roots in the Layer-2 on Solana
//! 
//! This module provides a Merkle Tree implementation for representing state roots
//! and generating proofs of inclusion or exclusion.

use sha2::{Sha256, Digest};
use std::collections::HashMap;

/// A Merkle Tree implementation for state roots
pub struct MerkleTree {
    /// The root hash of the Merkle Tree
    root: [u8; 32],
    /// The nodes of the Merkle Tree, stored by level and index
    nodes: HashMap<(usize, usize), [u8; 32]>,
    /// The leaves of the Merkle Tree
    leaves: Vec<[u8; 32]>,
}

impl MerkleTree {
    /// Create a new Merkle Tree from a list of leaves
    pub fn new(leaves: Vec<[u8; 32]>) -> Self {
        let mut tree = Self {
            root: [0; 32],
            nodes: HashMap::new(),
            leaves: leaves.clone(),
        };
        
        // Build the tree
        tree.build();
        
        tree
    }
    
    /// Build the Merkle Tree from the leaves
    fn build(&mut self) {
        let mut current_level_size = self.leaves.len();
        let mut current_level = 0;
        
        // Insert leaves at level 0
        for (i, leaf) in self.leaves.iter().enumerate() {
            self.nodes.insert((0, i), *leaf);
        }
        
        // Build the tree bottom-up
        while current_level_size > 1 {
            let next_level_size = (current_level_size + 1) / 2;
            
            for i in 0..next_level_size {
                let left_idx = i * 2;
                let right_idx = i * 2 + 1;
                
                let left = self.nodes.get(&(current_level, left_idx)).cloned().unwrap_or([0; 32]);
                let right = if right_idx < current_level_size {
                    self.nodes.get(&(current_level, right_idx)).cloned().unwrap_or([0; 32])
                } else {
                    left // If there's no right child, duplicate the left one
                };
                
                let parent = Self::hash_nodes(&left, &right);
                self.nodes.insert((current_level + 1, i), parent);
            }
            
            current_level += 1;
            current_level_size = next_level_size;
        }
        
        // Set the root
        if let Some(root) = self.nodes.get(&(current_level, 0)) {
            self.root = *root;
        }
    }
    
    /// Get the root hash of the Merkle Tree
    pub fn root(&self) -> [u8; 32] {
        self.root
    }
    
    /// Generate a Merkle proof for a leaf at the given index
    pub fn generate_proof(&self, leaf_index: usize) -> Vec<[u8; 32]> {
        let mut proof = Vec::new();
        let mut current_index = leaf_index;
        let mut current_level = 0;
        
        while current_level < self.height() {
            let sibling_index = if current_index % 2 == 0 {
                current_index + 1 // Right sibling
            } else {
                current_index - 1 // Left sibling
            };
            
            if let Some(sibling) = self.nodes.get(&(current_level, sibling_index)) {
                proof.push(*sibling);
            }
            
            current_index /= 2;
            current_level += 1;
        }
        
        proof
    }
    
    /// Verify a Merkle proof for a leaf
    pub fn verify_proof(root: &[u8; 32], leaf: &[u8; 32], proof: &[[u8; 32]], leaf_index: usize) -> bool {
        let mut current_hash = *leaf;
        let mut current_index = leaf_index;
        
        for sibling in proof {
            current_hash = if current_index % 2 == 0 {
                // Leaf is left child
                Self::hash_nodes(&current_hash, sibling)
            } else {
                // Leaf is right child
                Self::hash_nodes(sibling, &current_hash)
            };
            
            current_index /= 2;
        }
        
        &current_hash == root
    }
    
    /// Get the height of the Merkle Tree
    pub fn height(&self) -> usize {
        let leaf_count = self.leaves.len();
        if leaf_count == 0 {
            return 0;
        }
        
        // Height is log2(leaf_count) rounded up
        let mut height = 0;
        let mut count = leaf_count;
        while count > 1 {
            height += 1;
            count = (count + 1) / 2;
        }
        
        height
    }
    
    /// Hash two nodes together to create a parent node
    fn hash_nodes(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(left);
        hasher.update(right);
        let result = hasher.finalize();
        
        let mut output = [0u8; 32];
        output.copy_from_slice(&result);
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_merkle_tree_creation() {
        let leaves = vec![
            [1; 32], [2; 32], [3; 32], [4; 32],
        ];
        
        let tree = MerkleTree::new(leaves);
        
        // Ensure the tree has a root
        assert_ne!(tree.root(), [0; 32]);
    }
    
    #[test]
    fn test_merkle_proof_verification() {
        let leaves = vec![
            [1; 32], [2; 32], [3; 32], [4; 32],
        ];
        
        let tree = MerkleTree::new(leaves.clone());
        let root = tree.root();
        
        // Generate and verify a proof for the first leaf
        let proof = tree.generate_proof(0);
        assert!(MerkleTree::verify_proof(&root, &leaves[0], &proof, 0));
        
        // Generate and verify a proof for the second leaf
        let proof = tree.generate_proof(1);
        assert!(MerkleTree::verify_proof(&root, &leaves[1], &proof, 1));
        
        // Verify that an incorrect leaf fails verification
        let incorrect_leaf = [5; 32];
        assert!(!MerkleTree::verify_proof(&root, &incorrect_leaf, &proof, 1));
    }
}
