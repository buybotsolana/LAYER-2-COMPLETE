// src/finalization/block_finalization_test.rs
#[cfg(test)]
mod tests {
    use super::*;
    use crate::finalization::block_finalization::{BlockFinalization, Block, FinalizationStatus};
    
    #[test]
    fn test_block_finalization_normal_flow() {
        // Create a block
        let block = Block {
            number: 1,
            state_root: [1; 32],
            parent_hash: [0; 32],
            timestamp: 1000,
            transactions_root: [2; 32],
            receipts_root: [3; 32],
        };
        
        // Create a block finalization instance
        let mut finalization = BlockFinalization::new(7 * 24 * 60 * 60); // 7 days in seconds
        
        // Submit the block
        let result = finalization.submit_block(block.clone(), 100); // L1 block number 100
        assert!(result.is_ok(), "Block submission failed");
        
        // Check the status immediately after submission
        let status = finalization.get_block_status(block.number);
        assert_eq!(status, FinalizationStatus::Submitted, "Block should be in Submitted status");
        
        // Advance time to half of the challenge period
        finalization.advance_l1_block(100 + (7 * 24 * 60 * 60 / 2) / 15); // Assuming 15 seconds per L1 block
        
        // Check the status
        let status = finalization.get_block_status(block.number);
        assert_eq!(status, FinalizationStatus::Submitted, "Block should still be in Submitted status");
        
        // Advance time to just after the challenge period
        finalization.advance_l1_block(100 + (7 * 24 * 60 * 60) / 15 + 1); // Assuming 15 seconds per L1 block
        
        // Check the status
        let status = finalization.get_block_status(block.number);
        assert_eq!(status, FinalizationStatus::Finalized, "Block should be in Finalized status");
    }
    
    #[test]
    fn test_block_finalization_with_challenge() {
        // Create a block
        let block = Block {
            number: 1,
            state_root: [1; 32],
            parent_hash: [0; 32],
            timestamp: 1000,
            transactions_root: [2; 32],
            receipts_root: [3; 32],
        };
        
        // Create a block finalization instance
        let mut finalization = BlockFinalization::new(7 * 24 * 60 * 60); // 7 days in seconds
        
        // Submit the block
        let result = finalization.submit_block(block.clone(), 100); // L1 block number 100
        assert!(result.is_ok(), "Block submission failed");
        
        // Challenge the block
        let result = finalization.challenge_block(block.number, "Invalid state transition".to_string());
        assert!(result.is_ok(), "Block challenge failed");
        
        // Check the status
        let status = finalization.get_block_status(block.number);
        assert_eq!(status, FinalizationStatus::Challenged, "Block should be in Challenged status");
        
        // Advance time to after the challenge period
        finalization.advance_l1_block(100 + (7 * 24 * 60 * 60) / 15 + 1); // Assuming 15 seconds per L1 block
        
        // Check the status
        let status = finalization.get_block_status(block.number);
        assert_eq!(status, FinalizationStatus::Challenged, "Block should remain in Challenged status");
        
        // Resolve the challenge (invalidate the block)
        let result = finalization.resolve_challenge(block.number, false);
        assert!(result.is_ok(), "Challenge resolution failed");
        
        // Check the status
        let status = finalization.get_block_status(block.number);
        assert_eq!(status, FinalizationStatus::Invalid, "Block should be in Invalid status");
    }
    
    #[test]
    fn test_block_finalization_with_resolved_challenge() {
        // Create a block
        let block = Block {
            number: 1,
            state_root: [1; 32],
            parent_hash: [0; 32],
            timestamp: 1000,
            transactions_root: [2; 32],
            receipts_root: [3; 32],
        };
        
        // Create a block finalization instance
        let mut finalization = BlockFinalization::new(7 * 24 * 60 * 60); // 7 days in seconds
        
        // Submit the block
        let result = finalization.submit_block(block.clone(), 100); // L1 block number 100
        assert!(result.is_ok(), "Block submission failed");
        
        // Challenge the block
        let result = finalization.challenge_block(block.number, "Invalid state transition".to_string());
        assert!(result.is_ok(), "Block challenge failed");
        
        // Check the status
        let status = finalization.get_block_status(block.number);
        assert_eq!(status, FinalizationStatus::Challenged, "Block should be in Challenged status");
        
        // Resolve the challenge (validate the block)
        let result = finalization.resolve_challenge(block.number, true);
        assert!(result.is_ok(), "Challenge resolution failed");
        
        // Check the status
        let status = finalization.get_block_status(block.number);
        assert_eq!(status, FinalizationStatus::Submitted, "Block should return to Submitted status");
        
        // Advance time to after the challenge period
        finalization.advance_l1_block(100 + (7 * 24 * 60 * 60) / 15 + 1); // Assuming 15 seconds per L1 block
        
        // Check the status
        let status = finalization.get_block_status(block.number);
        assert_eq!(status, FinalizationStatus::Finalized, "Block should be in Finalized status");
    }
    
    #[test]
    fn test_block_finalization_multiple_blocks() {
        // Create a block finalization instance
        let mut finalization = BlockFinalization::new(7 * 24 * 60 * 60); // 7 days in seconds
        
        // Submit multiple blocks
        for i in 1..=5 {
            let block = Block {
                number: i,
                state_root: [i as u8; 32],
                parent_hash: [(i - 1) as u8; 32],
                timestamp: 1000 * i as u64,
                transactions_root: [(i * 2) as u8; 32],
                receipts_root: [(i * 3) as u8; 32],
            };
            
            let result = finalization.submit_block(block.clone(), 100 + (i - 1) * 100); // L1 block numbers 100, 200, 300, 400, 500
            assert!(result.is_ok(), "Block submission failed for block {}", i);
        }
        
        // Challenge block 3
        let result = finalization.challenge_block(3, "Invalid state transition".to_string());
        assert!(result.is_ok(), "Block challenge failed for block 3");
        
        // Advance time to after the challenge period for blocks 1 and 2
        finalization.advance_l1_block(300 + (7 * 24 * 60 * 60) / 15 + 1); // Assuming 15 seconds per L1 block
        
        // Check the status of each block
        assert_eq!(finalization.get_block_status(1), FinalizationStatus::Finalized, "Block 1 should be in Finalized status");
        assert_eq!(finalization.get_block_status(2), FinalizationStatus::Finalized, "Block 2 should be in Finalized status");
        assert_eq!(finalization.get_block_status(3), FinalizationStatus::Challenged, "Block 3 should be in Challenged status");
        assert_eq!(finalization.get_block_status(4), FinalizationStatus::Submitted, "Block 4 should be in Submitted status");
        assert_eq!(finalization.get_block_status(5), FinalizationStatus::Submitted, "Block 5 should be in Submitted status");
        
        // Resolve the challenge for block 3 (invalidate the block)
        let result = finalization.resolve_challenge(3, false);
        assert!(result.is_ok(), "Challenge resolution failed for block 3");
        
        // Check the status of each block
        assert_eq!(finalization.get_block_status(1), FinalizationStatus::Finalized, "Block 1 should be in Finalized status");
        assert_eq!(finalization.get_block_status(2), FinalizationStatus::Finalized, "Block 2 should be in Finalized status");
        assert_eq!(finalization.get_block_status(3), FinalizationStatus::Invalid, "Block 3 should be in Invalid status");
        assert_eq!(finalization.get_block_status(4), FinalizationStatus::Invalid, "Block 4 should be in Invalid status");
        assert_eq!(finalization.get_block_status(5), FinalizationStatus::Invalid, "Block 5 should be in Invalid status");
    }
    
    #[test]
    fn test_block_finalization_with_different_challenge_periods() {
        // Test with 1 day challenge period (testnet)
        let mut finalization_testnet = BlockFinalization::new(1 * 24 * 60 * 60); // 1 day in seconds
        
        // Test with 7 days challenge period (mainnet)
        let mut finalization_mainnet = BlockFinalization::new(7 * 24 * 60 * 60); // 7 days in seconds
        
        // Create a block
        let block = Block {
            number: 1,
            state_root: [1; 32],
            parent_hash: [0; 32],
            timestamp: 1000,
            transactions_root: [2; 32],
            receipts_root: [3; 32],
        };
        
        // Submit the block to both instances
        finalization_testnet.submit_block(block.clone(), 100).unwrap();
        finalization_mainnet.submit_block(block.clone(), 100).unwrap();
        
        // Advance time to just after the testnet challenge period
        let testnet_blocks = (1 * 24 * 60 * 60) / 15 + 1; // Assuming 15 seconds per L1 block
        finalization_testnet.advance_l1_block(100 + testnet_blocks);
        finalization_mainnet.advance_l1_block(100 + testnet_blocks);
        
        // Check the status
        assert_eq!(finalization_testnet.get_block_status(block.number), FinalizationStatus::Finalized, "Block should be Finalized in testnet");
        assert_eq!(finalization_mainnet.get_block_status(block.number), FinalizationStatus::Submitted, "Block should still be Submitted in mainnet");
        
        // Advance time to just after the mainnet challenge period
        let mainnet_blocks = (7 * 24 * 60 * 60) / 15 + 1; // Assuming 15 seconds per L1 block
        finalization_mainnet.advance_l1_block(100 + mainnet_blocks);
        
        // Check the status
        assert_eq!(finalization_mainnet.get_block_status(block.number), FinalizationStatus::Finalized, "Block should be Finalized in mainnet");
    }
    
    #[test]
    fn test_block_finalization_invalid_operations() {
        // Create a block finalization instance
        let mut finalization = BlockFinalization::new(7 * 24 * 60 * 60); // 7 days in seconds
        
        // Create a block
        let block = Block {
            number: 1,
            state_root: [1; 32],
            parent_hash: [0; 32],
            timestamp: 1000,
            transactions_root: [2; 32],
            receipts_root: [3; 32],
        };
        
        // Submit the block
        finalization.submit_block(block.clone(), 100).unwrap();
        
        // Try to submit the same block again
        let result = finalization.submit_block(block.clone(), 101);
        assert!(result.is_err(), "Should not be able to submit the same block twice");
        
        // Try to challenge a non-existent block
        let result = finalization.challenge_block(2, "Invalid state transition".to_string());
        assert!(result.is_err(), "Should not be able to challenge a non-existent block");
        
        // Try to resolve a challenge for a non-challenged block
        let result = finalization.resolve_challenge(1, true);
        assert!(result.is_err(), "Should not be able to resolve a challenge for a non-challenged block");
        
        // Challenge the block
        finalization.challenge_block(1, "Invalid state transition".to_string()).unwrap();
        
        // Resolve the challenge
        finalization.resolve_challenge(1, false).unwrap();
        
        // Try to challenge an invalid block
        let result = finalization.challenge_block(1, "Another challenge".to_string());
        assert!(result.is_err(), "Should not be able to challenge an invalid block");
    }
    
    #[test]
    fn test_block_finalization_get_latest_finalized_block() {
        // Create a block finalization instance
        let mut finalization = BlockFinalization::new(7 * 24 * 60 * 60); // 7 days in seconds
        
        // Initially, there should be no finalized blocks
        let latest = finalization.get_latest_finalized_block();
        assert!(latest.is_none(), "There should be no finalized blocks initially");
        
        // Submit multiple blocks
        for i in 1..=5 {
            let block = Block {
                number: i,
                state_root: [i as u8; 32],
                parent_hash: [(i - 1) as u8; 32],
                timestamp: 1000 * i as u64,
                transactions_root: [(i * 2) as u8; 32],
                receipts_root: [(i * 3) as u8; 32],
            };
            
            finalization.submit_block(block.clone(), 100 + (i - 1) * 100).unwrap();
        }
        
        // Advance time to finalize blocks 1 and 2
        finalization.advance_l1_block(300 + (7 * 24 * 60 * 60) / 15 + 1);
        
        // Check the latest finalized block
        let latest = finalization.get_latest_finalized_block();
        assert!(latest.is_some(), "There should be finalized blocks");
        assert_eq!(latest.unwrap().number, 2, "The latest finalized block should be block 2");
        
        // Challenge block 3
        finalization.challenge_block(3, "Invalid state transition".to_string()).unwrap();
        
        // Resolve the challenge (invalidate the block)
        finalization.resolve_challenge(3, false).unwrap();
        
        // Advance time to finalize all remaining valid blocks
        finalization.advance_l1_block(500 + (7 * 24 * 60 * 60) / 15 + 1);
        
        // Check the latest finalized block
        let latest = finalization.get_latest_finalized_block();
        assert!(latest.is_some(), "There should be finalized blocks");
        assert_eq!(latest.unwrap().number, 2, "The latest finalized block should still be block 2");
    }
}
