// src/fraud_proof_system/state_transition_test.rs
#[cfg(test)]
mod tests {
    use super::*;
    use crate::fraud_proof_system::state_transition::{StateTransition, Transaction, TransactionResult};
    
    #[test]
    fn test_state_transition_simple_transaction() {
        // Create a pre-state root
        let pre_state_root = [1; 32];
        
        // Create a simple transaction
        let transaction = Transaction {
            sender: [2; 32],
            recipient: [3; 32],
            amount: 100,
            nonce: 1,
            signature: [4; 32],
        };
        
        // Create a state transition
        let state_transition = StateTransition {
            pre_state_root,
            transaction: transaction.clone(),
            block_number: 1,
            timestamp: 1000,
        };
        
        // Execute the state transition
        let result = state_transition.execute();
        
        // Verify the result
        assert!(result.is_ok(), "State transition execution failed");
        
        let transition_result = result.unwrap();
        assert_ne!(transition_result.post_state_root, pre_state_root, "Post-state root should differ from pre-state root");
        assert_eq!(transition_result.status, TransactionResult::Success, "Transaction should succeed");
    }
    
    #[test]
    fn test_state_transition_invalid_signature() {
        // Create a pre-state root
        let pre_state_root = [1; 32];
        
        // Create a transaction with invalid signature
        let transaction = Transaction {
            sender: [2; 32],
            recipient: [3; 32],
            amount: 100,
            nonce: 1,
            signature: [0; 32], // Invalid signature
        };
        
        // Create a state transition
        let state_transition = StateTransition {
            pre_state_root,
            transaction: transaction.clone(),
            block_number: 1,
            timestamp: 1000,
        };
        
        // Execute the state transition
        let result = state_transition.execute();
        
        // Verify the result
        assert!(result.is_ok(), "State transition execution should not fail for invalid signature");
        
        let transition_result = result.unwrap();
        assert_eq!(transition_result.status, TransactionResult::InvalidSignature, "Transaction should fail with InvalidSignature");
        assert_eq!(transition_result.post_state_root, pre_state_root, "Post-state root should remain unchanged");
    }
    
    #[test]
    fn test_state_transition_insufficient_balance() {
        // Create a pre-state root
        let pre_state_root = [1; 32];
        
        // Create a transaction with amount exceeding balance
        let transaction = Transaction {
            sender: [2; 32],
            recipient: [3; 32],
            amount: 1000000, // Very large amount
            nonce: 1,
            signature: [4; 32],
        };
        
        // Create a state transition
        let state_transition = StateTransition {
            pre_state_root,
            transaction: transaction.clone(),
            block_number: 1,
            timestamp: 1000,
        };
        
        // Execute the state transition
        let result = state_transition.execute();
        
        // Verify the result
        assert!(result.is_ok(), "State transition execution should not fail for insufficient balance");
        
        let transition_result = result.unwrap();
        assert_eq!(transition_result.status, TransactionResult::InsufficientBalance, "Transaction should fail with InsufficientBalance");
        assert_eq!(transition_result.post_state_root, pre_state_root, "Post-state root should remain unchanged");
    }
    
    #[test]
    fn test_state_transition_invalid_nonce() {
        // Create a pre-state root
        let pre_state_root = [1; 32];
        
        // Create a transaction with invalid nonce
        let transaction = Transaction {
            sender: [2; 32],
            recipient: [3; 32],
            amount: 100,
            nonce: 0, // Invalid nonce (assuming 1 is expected)
            signature: [4; 32],
        };
        
        // Create a state transition
        let state_transition = StateTransition {
            pre_state_root,
            transaction: transaction.clone(),
            block_number: 1,
            timestamp: 1000,
        };
        
        // Execute the state transition
        let result = state_transition.execute();
        
        // Verify the result
        assert!(result.is_ok(), "State transition execution should not fail for invalid nonce");
        
        let transition_result = result.unwrap();
        assert_eq!(transition_result.status, TransactionResult::InvalidNonce, "Transaction should fail with InvalidNonce");
        assert_eq!(transition_result.post_state_root, pre_state_root, "Post-state root should remain unchanged");
    }
    
    #[test]
    fn test_state_transition_multiple_transactions() {
        // Create a pre-state root
        let pre_state_root = [1; 32];
        
        // Create multiple transactions
        let transactions = vec![
            Transaction {
                sender: [2; 32],
                recipient: [3; 32],
                amount: 100,
                nonce: 1,
                signature: [4; 32],
            },
            Transaction {
                sender: [2; 32],
                recipient: [4; 32],
                amount: 50,
                nonce: 2,
                signature: [5; 32],
            },
            Transaction {
                sender: [3; 32],
                recipient: [5; 32],
                amount: 25,
                nonce: 1,
                signature: [6; 32],
            },
        ];
        
        // Execute state transitions sequentially
        let mut current_state_root = pre_state_root;
        
        for (i, tx) in transactions.iter().enumerate() {
            let state_transition = StateTransition {
                pre_state_root: current_state_root,
                transaction: tx.clone(),
                block_number: 1,
                timestamp: 1000 + i as u64,
            };
            
            let result = state_transition.execute();
            assert!(result.is_ok(), "State transition execution failed for transaction {}", i);
            
            let transition_result = result.unwrap();
            assert_eq!(transition_result.status, TransactionResult::Success, "Transaction {} should succeed", i);
            
            current_state_root = transition_result.post_state_root;
        }
        
        // Verify the final state root differs from the initial one
        assert_ne!(current_state_root, pre_state_root, "Final state root should differ from initial state root");
    }
    
    #[test]
    fn test_state_transition_determinism() {
        // Create a pre-state root
        let pre_state_root = [1; 32];
        
        // Create a transaction
        let transaction = Transaction {
            sender: [2; 32],
            recipient: [3; 32],
            amount: 100,
            nonce: 1,
            signature: [4; 32],
        };
        
        // Create two identical state transitions
        let state_transition1 = StateTransition {
            pre_state_root,
            transaction: transaction.clone(),
            block_number: 1,
            timestamp: 1000,
        };
        
        let state_transition2 = StateTransition {
            pre_state_root,
            transaction: transaction.clone(),
            block_number: 1,
            timestamp: 1000,
        };
        
        // Execute both state transitions
        let result1 = state_transition1.execute();
        let result2 = state_transition2.execute();
        
        // Verify both results are successful
        assert!(result1.is_ok(), "First state transition execution failed");
        assert!(result2.is_ok(), "Second state transition execution failed");
        
        let transition_result1 = result1.unwrap();
        let transition_result2 = result2.unwrap();
        
        // Verify both transitions produce the same post-state root
        assert_eq!(
            transition_result1.post_state_root,
            transition_result2.post_state_root,
            "State transitions should be deterministic"
        );
    }
    
    #[test]
    fn test_state_transition_with_different_timestamps() {
        // Create a pre-state root
        let pre_state_root = [1; 32];
        
        // Create a transaction
        let transaction = Transaction {
            sender: [2; 32],
            recipient: [3; 32],
            amount: 100,
            nonce: 1,
            signature: [4; 32],
        };
        
        // Create two state transitions with different timestamps
        let state_transition1 = StateTransition {
            pre_state_root,
            transaction: transaction.clone(),
            block_number: 1,
            timestamp: 1000,
        };
        
        let state_transition2 = StateTransition {
            pre_state_root,
            transaction: transaction.clone(),
            block_number: 1,
            timestamp: 2000, // Different timestamp
        };
        
        // Execute both state transitions
        let result1 = state_transition1.execute();
        let result2 = state_transition2.execute();
        
        // Verify both results are successful
        assert!(result1.is_ok(), "First state transition execution failed");
        assert!(result2.is_ok(), "Second state transition execution failed");
        
        let transition_result1 = result1.unwrap();
        let transition_result2 = result2.unwrap();
        
        // Verify both transitions produce different post-state roots
        // This is because the timestamp is included in the state calculation
        assert_ne!(
            transition_result1.post_state_root,
            transition_result2.post_state_root,
            "State transitions with different timestamps should produce different results"
        );
    }
}
