// src/fraud_proof_system/merkle_tree_test.rs
#[cfg(test)]
mod tests {
    use super::*;
    use crate::fraud_proof_system::merkle_tree::MerkleTree;
    
    #[test]
    fn test_merkle_tree_creation() {
        // Create a set of leaves
        let leaves = vec![
            [1; 32], [2; 32], [3; 32], [4; 32], [5; 32], [6; 32], [7; 32], [8; 32],
        ];
        
        // Create a Merkle tree
        let tree = MerkleTree::new(leaves.clone());
        
        // Get the root
        let root = tree.root();
        
        // Verify the root is not zero
        assert_ne!(root, [0; 32]);
    }
    
    #[test]
    fn test_merkle_proof_generation_and_verification() {
        // Create a set of leaves
        let leaves = vec![
            [1; 32], [2; 32], [3; 32], [4; 32], [5; 32], [6; 32], [7; 32], [8; 32],
        ];
        
        // Create a Merkle tree
        let mut tree = MerkleTree::new(leaves.clone());
        
        // Get the root
        let root = tree.root();
        
        // Generate and verify proofs for each leaf
        for (i, leaf) in leaves.iter().enumerate() {
            let proof = tree.generate_proof(i);
            let result = MerkleTree::verify_proof(&root, leaf, &proof, i);
            assert!(result, "Proof verification failed for leaf {}", i);
        }
    }
    
    #[test]
    fn test_merkle_proof_verification_with_invalid_leaf() {
        // Create a set of leaves
        let leaves = vec![
            [1; 32], [2; 32], [3; 32], [4; 32], [5; 32], [6; 32], [7; 32], [8; 32],
        ];
        
        // Create a Merkle tree
        let mut tree = MerkleTree::new(leaves.clone());
        
        // Get the root
        let root = tree.root();
        
        // Generate a proof for the first leaf
        let proof = tree.generate_proof(0);
        
        // Create an invalid leaf
        let invalid_leaf = [9; 32];
        
        // Verify with the invalid leaf
        let result = MerkleTree::verify_proof(&root, &invalid_leaf, &proof, 0);
        
        // The verification should fail
        assert!(!result, "Proof verification should fail with invalid leaf");
    }
    
    #[test]
    fn test_merkle_tree_update_leaf() {
        // Create a set of leaves
        let leaves = vec![
            [1; 32], [2; 32], [3; 32], [4; 32], [5; 32], [6; 32], [7; 32], [8; 32],
        ];
        
        // Create a Merkle tree
        let mut tree = MerkleTree::new(leaves.clone());
        
        // Get the original root
        let original_root = tree.root();
        
        // Update a leaf
        let new_leaf = [9; 32];
        tree.update_leaf(0, new_leaf);
        
        // Get the new root
        let new_root = tree.root();
        
        // Verify the root has changed
        assert_ne!(original_root, new_root, "Root should change after leaf update");
        
        // Generate a proof for the updated leaf
        let proof = tree.generate_proof(0);
        
        // Verify the proof
        let result = MerkleTree::verify_proof(&new_root, &new_leaf, &proof, 0);
        assert!(result, "Proof verification failed for updated leaf");
    }
    
    #[test]
    fn test_merkle_tree_with_odd_number_of_leaves() {
        // Create a set of leaves with odd number
        let leaves = vec![
            [1; 32], [2; 32], [3; 32], [4; 32], [5; 32], [6; 32], [7; 32],
        ];
        
        // Create a Merkle tree
        let mut tree = MerkleTree::new(leaves.clone());
        
        // Get the root
        let root = tree.root();
        
        // Generate and verify proofs for each leaf
        for (i, leaf) in leaves.iter().enumerate() {
            let proof = tree.generate_proof(i);
            let result = MerkleTree::verify_proof(&root, leaf, &proof, i);
            assert!(result, "Proof verification failed for leaf {} in odd-sized tree", i);
        }
    }
    
    #[test]
    fn test_merkle_tree_with_single_leaf() {
        // Create a set with a single leaf
        let leaves = vec![[1; 32]];
        
        // Create a Merkle tree
        let mut tree = MerkleTree::new(leaves.clone());
        
        // Get the root
        let root = tree.root();
        
        // For a single leaf, the root should be the leaf itself
        assert_eq!(root, leaves[0], "Root should equal the leaf for single-leaf tree");
        
        // Generate and verify proof
        let proof = tree.generate_proof(0);
        let result = MerkleTree::verify_proof(&root, &leaves[0], &proof, 0);
        assert!(result, "Proof verification failed for single-leaf tree");
    }
    
    #[test]
    fn test_merkle_tree_with_empty_leaves() {
        // Create an empty set of leaves
        let leaves: Vec<[u8; 32]> = vec![];
        
        // Create a Merkle tree
        let tree = MerkleTree::new(leaves.clone());
        
        // Get the root
        let root = tree.root();
        
        // For an empty tree, the root should be zero
        assert_eq!(root, [0; 32], "Root should be zero for empty tree");
    }
    
    #[test]
    fn test_merkle_proof_verification_with_invalid_index() {
        // Create a set of leaves
        let leaves = vec![
            [1; 32], [2; 32], [3; 32], [4; 32], [5; 32], [6; 32], [7; 32], [8; 32],
        ];
        
        // Create a Merkle tree
        let mut tree = MerkleTree::new(leaves.clone());
        
        // Get the root
        let root = tree.root();
        
        // Generate a proof for the first leaf
        let proof = tree.generate_proof(0);
        
        // Verify with an invalid index
        let result = MerkleTree::verify_proof(&root, &leaves[0], &proof, 1);
        
        // The verification should fail
        assert!(!result, "Proof verification should fail with invalid index");
    }
    
    #[test]
    fn test_merkle_proof_verification_with_tampered_proof() {
        // Create a set of leaves
        let leaves = vec![
            [1; 32], [2; 32], [3; 32], [4; 32], [5; 32], [6; 32], [7; 32], [8; 32],
        ];
        
        // Create a Merkle tree
        let mut tree = MerkleTree::new(leaves.clone());
        
        // Get the root
        let root = tree.root();
        
        // Generate a proof for the first leaf
        let mut proof = tree.generate_proof(0);
        
        // Tamper with the proof
        if !proof.is_empty() {
            proof[0] = [99; 32];
        }
        
        // Verify with the tampered proof
        let result = MerkleTree::verify_proof(&root, &leaves[0], &proof, 0);
        
        // The verification should fail
        assert!(!result, "Proof verification should fail with tampered proof");
    }
}
