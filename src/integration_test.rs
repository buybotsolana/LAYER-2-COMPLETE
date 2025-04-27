// src/integration_test.rs
//! Integration tests for Layer-2 on Solana
//!
//! This module provides integration tests that verify the interaction between
//! the rollup, bridge, sequencer, and fee optimization systems.

use std::sync::{Arc, RwLock, Mutex};
use std::time::{Duration, SystemTime};
use solana_program::hash::Hash;
use solana_program::pubkey::Pubkey;
use solana_program::program_error::ProgramError;

use crate::rollup::{OptimisticRollup, RollupTransaction, BatchStatus, ChallengeReason};
use crate::bridge::{CompleteBridge, AssetType, TransferStatus, TransferDirection, WormholeMessage, GuardianSignature};
use crate::sequencer::{TransactionSequencer, SequencerConfig, TransactionStatus};
use crate::fee_optimization::{GaslessTransactions, RelayerConfig, MetaTransactionStatus};

use crate::interfaces::rollup_interface::{RollupInterface, RollupInterfaceImpl};
use crate::interfaces::bridge_interface::{BridgeInterface, BridgeInterfaceImpl};
use crate::interfaces::sequencer_interface::{SequencerInterface, SequencerInterfaceImpl};
use crate::interfaces::fee_optimization_interface::{FeeOptimizationInterface, FeeOptimizationInterfaceImpl};

/// Test the complete Layer-2 flow with all components
#[test]
fn test_complete_layer2_flow() {
    // Create rollup
    let rollup = Arc::new(RwLock::new(OptimisticRollup::new()));
    
    // Create bridge
    let wormhole_program_id = Pubkey::new_unique();
    let bridge_program_id = Pubkey::new_unique();
    let l2_bridge_program_id = Pubkey::new_unique();
    let token_bridge_program_id = Pubkey::new_unique();
    let nft_bridge_program_id = Pubkey::new_unique();
    let guardians = vec![Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique()];
    let min_guardian_signatures = 2;
    
    let bridge = Arc::new(Mutex::new(CompleteBridge::new(
        wormhole_program_id,
        bridge_program_id,
        l2_bridge_program_id,
        token_bridge_program_id,
        nft_bridge_program_id,
        guardians.clone(),
        min_guardian_signatures,
    )));
    
    // Create sequencer
    let sequencer_account = Pubkey::new_unique();
    let sequencer_config = SequencerConfig::default();
    let sequencer = Arc::new(Mutex::new(
        TransactionSequencer::new(sequencer_config, Arc::clone(&rollup), sequencer_account)
    ));
    
    // Create gasless transactions system
    let relayer_account = Pubkey::new_unique();
    let relayer_config = RelayerConfig::default();
    let gasless = Arc::new(Mutex::new(
        GaslessTransactions::new(relayer_config, relayer_account)
    ));
    
    // Create interfaces
    let rollup_interface = RollupInterfaceImpl::new(Arc::clone(&rollup));
    let mut bridge_interface = BridgeInterfaceImpl::new(Arc::clone(&bridge));
    let mut sequencer_interface = SequencerInterfaceImpl::new(Arc::clone(&sequencer));
    let mut fee_optimization_interface = FeeOptimizationInterfaceImpl::new(Arc::clone(&gasless));
    
    // Create test accounts
    let user_l1 = Pubkey::new_unique();
    let user_l2 = Pubkey::new_unique();
    let recipient = Pubkey::new_unique();
    
    // Add balance to user on L1 (simulated)
    // In a real implementation, this would be done on the Solana L1 chain
    
    // Step 1: Deposit from L1 to L2
    let deposit_amount = 1000;
    let asset_type = AssetType::Native;
    let signature = vec![1, 2, 3]; // Dummy signature
    
    let transfer_id = bridge_interface.initiate_deposit(
        user_l1,
        user_l2,
        asset_type.clone(),
        deposit_amount,
        signature.clone(),
    ).unwrap();
    
    // Create Wormhole message for deposit
    let message_id = solana_program::hash::hash(&[4, 5, 6]);
    let source_chain = 1; // Solana
    let target_chain = 2; // Layer-2
    let timestamp = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let nonce = 1;
    
    let signatures = vec![
        GuardianSignature {
            guardian: guardians[0],
            signature: vec![7, 8, 9], // Dummy signature
        },
        GuardianSignature {
            guardian: guardians[1],
            signature: vec![10, 11, 12], // Dummy signature
        },
    ];
    
    let wormhole_message = WormholeMessage {
        message_id,
        source_chain,
        target_chain,
        sender: user_l1,
        payload: vec![],
        timestamp,
        nonce,
        signatures,
        required_signatures: min_guardian_signatures,
    };
    
    // Complete deposit on L2
    bridge_interface.complete_deposit(transfer_id, wormhole_message).unwrap();
    
    // Verify deposit was completed
    let transfer = bridge_interface.get_transfer(&transfer_id).unwrap();
    assert_eq!(transfer.status, TransferStatus::Completed);
    
    // Add balance to user on L2 (simulated)
    {
        let mut rollup_instance = rollup.write().unwrap();
        rollup_instance.balances.insert(user_l2, deposit_amount);
    }
    
    // Step 2: Create and execute a transaction on L2
    // Add a contract to whitelist for gasless transactions
    let contract = Pubkey::new_unique();
    fee_optimization_interface.add_contract_to_whitelist(contract);
    
    // Set user subsidy
    fee_optimization_interface.set_user_subsidy(user_l2, 100);
    
    // Create a transaction
    let transaction = RollupTransaction {
        sender: user_l2,
        recipient,
        amount: 100,
        data: vec![],
        signature: vec![],
        nonce: 1,
        gas_price: 0, // Gasless
        gas_limit: 5,
    };
    
    // Create meta-transaction
    let user_signature = vec![13, 14, 15]; // Dummy signature
    let meta_tx_hash = fee_optimization_interface.create_meta_transaction(
        transaction.clone(),
        user_signature.clone()
    ).unwrap();
    
    // Execute meta-transaction
    let relayer_signature = vec![16, 17, 18]; // Dummy signature
    let gas_price = 20;
    fee_optimization_interface.execute_meta_transaction(
        &meta_tx_hash,
        relayer_signature.clone(),
        gas_price
    ).unwrap();
    
    // Verify meta-transaction was executed
    let meta_tx = fee_optimization_interface.get_meta_transaction(&meta_tx_hash).unwrap();
    assert_eq!(meta_tx.status, MetaTransactionStatus::Executed);
    
    // Step 3: Create a batch of transactions using the sequencer
    // Create another transaction
    let transaction2 = RollupTransaction {
        sender: user_l2,
        recipient,
        amount: 50,
        data: vec![],
        signature: vec![19, 20, 21], // Dummy signature
        nonce: 2,
        gas_price: 10,
        gas_limit: 5,
    };
    
    // Add transaction to sequencer
    let tx_hash = sequencer_interface.add_transaction(transaction2.clone()).unwrap();
    
    // Verify transaction was added
    let status = sequencer_interface.get_transaction_status(&tx_hash).unwrap();
    assert_eq!(status, TransactionStatus::Pending);
    
    // Submit batch
    let batch_id = sequencer_interface.submit_batch().unwrap();
    
    // Verify batch was created
    let batch = sequencer_interface.get_batch(batch_id).unwrap();
    assert_eq!(batch.sequencer, sequencer_account);
    
    // Manually set batch timestamp to be in the past to allow finalization
    {
        let mut rollup_instance = rollup.write().unwrap();
        if let Some(batch) = rollup_instance.batches.get_mut(&batch_id) {
            batch.timestamp = SystemTime::now() - Duration::from_secs(7 * 24 * 60 * 60 + 1);
        }
    }
    
    // Finalize batch
    rollup_interface.finalize_batch(batch_id).unwrap();
    
    // Verify batch was finalized
    let batch = rollup_interface.get_batch(batch_id).unwrap();
    assert_eq!(batch.status, BatchStatus::Finalized);
    
    // Step 4: Withdraw from L2 to L1
    let withdrawal_amount = 200;
    let asset_type = AssetType::Native;
    let signature = vec![22, 23, 24]; // Dummy signature
    
    let transfer_id = bridge_interface.initiate_withdrawal(
        user_l2,
        user_l1,
        asset_type.clone(),
        withdrawal_amount,
        signature.clone(),
    ).unwrap();
    
    // Create Wormhole message for withdrawal
    let message_id = solana_program::hash::hash(&[25, 26, 27]);
    let source_chain = 2; // Layer-2
    let target_chain = 1; // Solana
    let timestamp = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let nonce = 2;
    
    let signatures = vec![
        GuardianSignature {
            guardian: guardians[0],
            signature: vec![28, 29, 30], // Dummy signature
        },
        GuardianSignature {
            guardian: guardians[1],
            signature: vec![31, 32, 33], // Dummy signature
        },
    ];
    
    let wormhole_message = WormholeMessage {
        message_id,
        source_chain,
        target_chain,
        sender: user_l2,
        payload: vec![],
        timestamp,
        nonce,
        signatures,
        required_signatures: min_guardian_signatures,
    };
    
    // Complete withdrawal on L1
    bridge_interface.complete_withdrawal(transfer_id, wormhole_message).unwrap();
    
    // Verify withdrawal was completed
    let transfer = bridge_interface.get_transfer(&transfer_id).unwrap();
    assert_eq!(transfer.status, TransferStatus::Completed);
}

/// Test the fraud proof mechanism
#[test]
fn test_fraud_proof_mechanism() {
    // Create rollup
    let rollup = Arc::new(RwLock::new(OptimisticRollup::new()));
    
    // Create interface
    let rollup_interface = RollupInterfaceImpl::new(Arc::clone(&rollup));
    
    // Create test accounts
    let sender = Pubkey::new_unique();
    let recipient = Pubkey::new_unique();
    let sequencer = Pubkey::new_unique();
    let challenger = Pubkey::new_unique();
    
    // Add balance to accounts
    {
        let mut rollup_instance = rollup.write().unwrap();
        rollup_instance.balances.insert(sender, 1000);
        rollup_instance.balances.insert(challenger, 500);
    }
    
    // Create transaction
    let tx = RollupTransaction {
        sender,
        recipient,
        amount: 100,
        data: vec![],
        signature: vec![1, 2, 3], // Dummy signature
        nonce: 1,
        gas_price: 10,
        gas_limit: 5,
    };
    
    // Create batch
    let batch_id = rollup_interface.create_batch(vec![tx], sequencer).unwrap();
    
    // Challenge batch
    rollup_interface.challenge_batch(
        batch_id,
        challenger,
        ChallengeReason::InvalidSignature,
        100
    ).unwrap();
    
    // Verify batch was challenged
    let batch = rollup_interface.get_batch(batch_id).unwrap();
    assert_eq!(batch.status, BatchStatus::Challenged);
    
    // Verify challenge was created
    let challenges = rollup_interface.get_challenges(batch_id).unwrap();
    assert_eq!(challenges.len(), 1);
    assert_eq!(challenges[0].challenger, challenger);
    assert_eq!(challenges[0].stake, 100);
    
    // Resolve challenge as valid (fraud was detected)
    rollup_interface.resolve_challenge(batch_id, 0, true).unwrap();
    
    // Verify batch was rejected
    let batch = rollup_interface.get_batch(batch_id).unwrap();
    assert_eq!(batch.status, BatchStatus::Rejected);
    
    // Verify challenger was rewarded
    let challenger_balance = rollup_interface.get_balance(&challenger);
    assert_eq!(challenger_balance, 600); // 500 - 100 stake + 200 reward
}

/// Test the bridge replay protection
#[test]
fn test_bridge_replay_protection() {
    // Create bridge
    let wormhole_program_id = Pubkey::new_unique();
    let bridge_program_id = Pubkey::new_unique();
    let l2_bridge_program_id = Pubkey::new_unique();
    let token_bridge_program_id = Pubkey::new_unique();
    let nft_bridge_program_id = Pubkey::new_unique();
    let guardians = vec![Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique()];
    let min_guardian_signatures = 2;
    
    let bridge = Arc::new(Mutex::new(CompleteBridge::new(
        wormhole_program_id,
        bridge_program_id,
        l2_bridge_program_id,
        token_bridge_program_id,
        nft_bridge_program_id,
        guardians.clone(),
        min_guardian_signatures,
    )));
    
    // Create interface
    let mut bridge_interface = BridgeInterfaceImpl::new(Arc::clone(&bridge));
    
    // Create test accounts
    let sender = Pubkey::new_unique();
    let recipient = Pubkey::new_unique();
    
    // Initiate first deposit
    let asset_type = AssetType::Native;
    let amount = 100;
    let signature = vec![1, 2, 3]; // Dummy signature
    
    let transfer_id1 = bridge_interface.initiate_deposit(
        sender,
        recipient,
        asset_type.clone(),
        amount,
        signature.clone(),
    ).unwrap();
    
    // Create Wormhole message
    let message_id = solana_program::hash::hash(&[4, 5, 6]);
    let source_chain = 1; // Solana
    let target_chain = 2; // Layer-2
    let timestamp = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let nonce = 1;
    
    let signatures = vec![
        GuardianSignature {
            guardian: guardians[0],
            signature: vec![7, 8, 9], // Dummy signature
        },
        GuardianSignature {
            guardian: guardians[1],
            signature: vec![10, 11, 12], // Dummy signature
        },
    ];
    
    let wormhole_message = WormholeMessage {
        message_id,
        source_chain,
        target_chain,
        sender,
        payload: vec![],
        timestamp,
        nonce,
        signatures: signatures.clone(),
        required_signatures: min_guardian_signatures,
    };
    
    // Complete first deposit
    bridge_interface.complete_deposit(transfer_id1, wormhole_message.clone()).unwrap();
    
    // Initiate second deposit
    let transfer_id2 = bridge_interface.initiate_deposit(
        sender,
        recipient,
        asset_type,
        amount,
        signature,
    ).unwrap();
    
    // Try to complete second deposit with same Wormhole message (should fail due to replay protection)
    let result = bridge_interface.complete_deposit(transfer_id2, wormhole_message);
    assert!(result.is_err());
    
    // Verify second transfer was rejected
    let transfer = bridge_interface.get_transfer(&transfer_id2).unwrap();
    assert_eq!(transfer.status, TransferStatus::Rejected);
}

/// Test the sequencer transaction prioritization
#[test]
fn test_sequencer_prioritization() {
    // Create rollup
    let rollup = Arc::new(RwLock::new(OptimisticRollup::new()));
    
    // Create sequencer with small batch size
    let sequencer_account = Pubkey::new_unique();
    let mut config = SequencerConfig::default();
    config.max_batch_size = 2;
    config.min_batch_threshold = 1;
    let sequencer = Arc::new(Mutex::new(
        TransactionSequencer::new(config, Arc::clone(&rollup), sequencer_account)
    ));
    
    // Create interface
    let mut sequencer_interface = SequencerInterfaceImpl::new(Arc::clone(&sequencer));
    
    // Create test accounts
    let sender = Pubkey::new_unique();
    let recipient = Pubkey::new_unique();
    
    // Add balance to sender
    {
        let mut rollup_instance = rollup.write().unwrap();
        rollup_instance.balances.insert(sender, 10000);
    }
    
    // Create transactions with different gas prices
    let tx1 = RollupTransaction {
        sender,
        recipient,
        amount: 100,
        data: vec![],
        signature: vec![1, 2, 3],
        nonce: 1,
        gas_price: 5, // Low
        gas_limit: 5,
    };
    
    let tx2 = RollupTransaction {
        sender,
        recipient,
        amount: 100,
        data: vec![],
        signature: vec![4, 5, 6],
        nonce: 2,
        gas_price: 10, // Medium
        gas_limit: 5,
    };
    
    let tx3 = RollupTransaction {
        sender,
        recipient,
        amount: 100,
        data: vec![],
        signature: vec![7, 8, 9],
        nonce: 3,
        gas_price: 20, // High
        gas_limit: 5,
    };
    
    let tx4 = RollupTransaction {
        sender,
        recipient,
        amount: 100,
        data: vec![],
        signature: vec![10, 11, 12],
        nonce: 4,
        gas_price: 30, // Critical
        gas_limit: 5,
    };
    
    // Add transactions in reverse priority order
    sequencer_interface.add_transaction(tx1.clone()).unwrap();
    sequencer_interface.add_transaction(tx2.clone()).unwrap();
    sequencer_interface.add_transaction(tx3.clone()).unwrap();
    sequencer_interface.add_transaction(tx4.clone()).unwrap();
    
    // Submit batch (should include only the 2 highest priority transactions)
    let batch_id = sequencer_interface.submit_batch().unwrap();
    
    // Verify batch contains the highest priority transactions
    let batch = sequencer_interface.get_batch(batch_id).unwrap();
    assert_eq!(batch.transactions.len(), 2);
    
    // The batch should contain tx4 (Critical) and tx3 (High)
    let contains_tx4 = batch.transactions.iter().any(|tx| tx.gas_price == 30);
    let contains_tx3 = batch.transactions.iter().any(|tx| tx.gas_price == 20);
    
    assert!(contains_tx4, "Batch should contain the Critical priority transaction");
    assert!(contains_tx3, "Batch should contain the High priority transaction");
}

/// Test the gasless transactions system
#[test]
fn test_gasless_transactions() {
    // Create gasless transactions system
    let relayer_account = Pubkey::new_unique();
    let relayer_config = RelayerConfig::default();
    let gasless = Arc::new(Mutex::new(
        GaslessTransactions::new(relayer_config, relayer_account)
    ));
    
    // Create interface
    let mut fee_optimization_interface = FeeOptimizationInterfaceImpl::new(Arc::clone(&gasless));
    
    // Create test accounts
    let sender = Pubkey::new_unique();
    let contract = Pubkey::new_unique();
    
    // Add contract to whitelist
    fee_optimization_interface.add_contract_to_whitelist(contract);
    
    // Set user subsidy
    fee_optimization_interface.set_user_subsidy(sender, 10);
    
    // Create transaction
    let transaction = RollupTransaction {
        sender,
        recipient: contract,
        amount: 100,
        data: vec![],
        signature: vec![],
        nonce: 1,
        gas_price: 0, // Gasless
        gas_limit: 5,
    };
    
    // Create meta-transaction
    let user_signature = vec![1, 2, 3]; // Dummy signature
    let hash = fee_optimization_interface.create_meta_transaction(
        transaction.clone(),
        user_signature.clone()
    ).unwrap();
    
    // Verify meta-transaction was created
    let meta_tx = fee_optimization_interface.get_meta_transaction(&hash).unwrap();
    assert_eq!(meta_tx.transaction.sender, sender);
    assert_eq!(meta_tx.transaction.recipient, contract);
    assert_eq!(meta_tx.status, MetaTransactionStatus::Pending);
    
    // Execute meta-transaction
    let relayer_signature = vec![4, 5, 6]; // Dummy signature
    let gas_price = 20;
    fee_optimization_interface.execute_meta_transaction(
        &hash,
        relayer_signature.clone(),
        gas_price
    ).unwrap();
    
    // Verify meta-transaction was executed
    let meta_tx = fee_optimization_interface.get_meta_transaction(&hash).unwrap();
    assert_eq!(meta_tx.status, MetaTransactionStatus::Executed);
    assert_eq!(meta_tx.relayer, Some(relayer_account));
    
    // Verify stats
    let stats = fee_optimization_interface.get_stats();
    assert_eq!(stats.total_transactions, 1);
    assert_eq!(stats.executed_transactions, 1);
    assert_eq!(stats.pending_transactions, 0);
}
