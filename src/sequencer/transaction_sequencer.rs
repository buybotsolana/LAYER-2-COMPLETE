// src/sequencer/transaction_sequencer.rs
//! Transaction Sequencer implementation for Layer-2 on Solana
//!
//! This module implements a transaction sequencer that:
//! - Collects user transactions
//! - Organizes them into batches
//! - Applies ordering rules and prioritization
//! - Publishes batches to the L1 chain
//! - Manages the transaction queue
//!
//! The sequencer is a critical component of the Layer-2 system,
//! responsible for ordering transactions and ensuring they are
//! processed efficiently.

use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::{clock::Clock, rent::Rent, Sysvar},
};
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::{HashMap, VecDeque};
use std::time::{Duration, SystemTime};

/// Maximum number of transactions in a batch
const MAX_BATCH_SIZE: usize = 1000;

/// Maximum time to wait before creating a batch (in seconds)
const MAX_BATCH_WAIT_TIME: u64 = 60;

/// Sequencer state data structure
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct SequencerState {
    /// Sequencer operator public key
    pub operator: Pubkey,
    
    /// Backup operators public keys
    pub backup_operators: Vec<Pubkey>,
    
    /// Next batch ID
    pub next_batch_id: u64,
    
    /// Last batch timestamp
    pub last_batch_timestamp: u64,
    
    /// Transaction queue
    pub transaction_queue: VecDeque<Transaction>,
    
    /// Map of transaction hashes to prevent duplicates
    pub processed_transactions: HashMap<[u8; 32], bool>,
    
    /// Map of batch IDs to batch data
    pub batches: HashMap<u64, Batch>,
    
    /// Total transactions processed
    pub total_transactions_processed: u64,
    
    /// Total batches created
    pub total_batches_created: u64,
    
    /// Sequencer fee (in percentage, e.g., 100 = 1%)
    pub sequencer_fee: u16,
    
    /// Is sequencer paused
    pub is_paused: bool,
}

/// Transaction priority enum
#[derive(BorshSerialize, BorshDeserialize, Debug, PartialEq, Clone, Copy)]
pub enum TransactionPriority {
    /// High priority (processed first)
    High,
    
    /// Medium priority
    Medium,
    
    /// Low priority (processed last)
    Low,
}

/// Transaction data structure
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct Transaction {
    /// Transaction hash
    pub hash: [u8; 32],
    
    /// Sender's public key
    pub sender: Pubkey,
    
    /// Transaction data
    pub data: Vec<u8>,
    
    /// Transaction fee
    pub fee: u64,
    
    /// Transaction priority
    pub priority: TransactionPriority,
    
    /// Transaction timestamp
    pub timestamp: u64,
    
    /// Transaction nonce
    pub nonce: u64,
    
    /// Transaction signature
    pub signature: [u8; 64],
}

/// Batch data structure
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct Batch {
    /// Batch ID
    pub id: u64,
    
    /// Sequencer's public key
    pub sequencer: Pubkey,
    
    /// Transactions in the batch
    pub transactions: Vec<Transaction>,
    
    /// Batch creation timestamp
    pub timestamp: u64,
    
    /// Batch size in bytes
    pub size: u64,
    
    /// Total fees collected in this batch
    pub total_fees: u64,
    
    /// L1 transaction hash (once published)
    pub l1_transaction_hash: Option<[u8; 32]>,
    
    /// Is batch published to L1
    pub is_published: bool,
}

/// Sequencer instruction enum
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum SequencerInstruction {
    /// Initialize the sequencer
    Initialize {
        operator: Pubkey,
        backup_operators: Vec<Pubkey>,
        sequencer_fee: u16,
    },
    
    /// Submit a transaction to the sequencer
    SubmitTransaction {
        data: Vec<u8>,
        fee: u64,
        priority: TransactionPriority,
        nonce: u64,
    },
    
    /// Create a batch of transactions
    CreateBatch,
    
    /// Publish a batch to L1
    PublishBatch {
        batch_id: u64,
    },
    
    /// Update sequencer fee
    UpdateSequencerFee {
        new_fee: u16,
    },
    
    /// Add a backup operator
    AddBackupOperator {
        operator: Pubkey,
    },
    
    /// Remove a backup operator
    RemoveBackupOperator {
        operator: Pubkey,
    },
    
    /// Pause the sequencer
    PauseSequencer,
    
    /// Resume the sequencer
    ResumeSequencer,
}

/// Process sequencer instructions
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = SequencerInstruction::try_from_slice(instruction_data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    
    match instruction {
        SequencerInstruction::Initialize { operator, backup_operators, sequencer_fee } => {
            process_initialize(program_id, accounts, operator, backup_operators, sequencer_fee)
        },
        SequencerInstruction::SubmitTransaction { data, fee, priority, nonce } => {
            process_submit_transaction(program_id, accounts, data, fee, priority, nonce)
        },
        SequencerInstruction::CreateBatch => {
            process_create_batch(program_id, accounts)
        },
        SequencerInstruction::PublishBatch { batch_id } => {
            process_publish_batch(program_id, accounts, batch_id)
        },
        SequencerInstruction::UpdateSequencerFee { new_fee } => {
            process_update_sequencer_fee(program_id, accounts, new_fee)
        },
        SequencerInstruction::AddBackupOperator { operator } => {
            process_add_backup_operator(program_id, accounts, operator)
        },
        SequencerInstruction::RemoveBackupOperator { operator } => {
            process_remove_backup_operator(program_id, accounts, operator)
        },
        SequencerInstruction::PauseSequencer => {
            process_pause_sequencer(program_id, accounts)
        },
        SequencerInstruction::ResumeSequencer => {
            process_resume_sequencer(program_id, accounts)
        },
    }
}

/// Process initialize instruction
fn process_initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    operator: Pubkey,
    backup_operators: Vec<Pubkey>,
    sequencer_fee: u16,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let sequencer_state_account = next_account_info(account_info_iter)?;
    let initializer = next_account_info(account_info_iter)?;
    
    if !sequencer_state_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if sequencer_state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    if !initializer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    let rent = Rent::get()?;
    if !rent.is_exempt(sequencer_state_account.lamports(), sequencer_state_account.data_len()) {
        return Err(ProgramError::AccountNotRentExempt);
    }
    
    // Validate sequencer fee (max 10%)
    if sequencer_fee > 1000 {
        return Err(ProgramError::InvalidArgument);
    }
    
    let sequencer_state = SequencerState {
        operator,
        backup_operators,
        next_batch_id: 0,
        last_batch_timestamp: 0,
        transaction_queue: VecDeque::new(),
        processed_transactions: HashMap::new(),
        batches: HashMap::new(),
        total_transactions_processed: 0,
        total_batches_created: 0,
        sequencer_fee,
        is_paused: false,
    };
    
    sequencer_state.serialize(&mut *sequencer_state_account.data.borrow_mut())?;
    
    msg!("Sequencer initialized");
    Ok(())
}

/// Process submit transaction instruction
fn process_submit_transaction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: Vec<u8>,
    fee: u64,
    priority: TransactionPriority,
    nonce: u64,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let sequencer_state_account = next_account_info(account_info_iter)?;
    let sender = next_account_info(account_info_iter)?;
    let fee_payer = next_account_info(account_info_iter)?;
    
    if !sequencer_state_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if sequencer_state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    if !sender.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    if !fee_payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    let mut sequencer_state = SequencerState::try_from_slice(&sequencer_state_account.data.borrow())?;
    
    if sequencer_state.is_paused {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Create transaction
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;
    
    // In a real implementation, the signature would be verified
    // For simplicity, we're using a dummy signature
    let signature = [0; 64];
    
    let transaction = Transaction {
        hash: hash_transaction(sender.key, &data, nonce),
        sender: *sender.key,
        data,
        fee,
        priority,
        timestamp: current_timestamp,
        nonce,
        signature,
    };
    
    // Check if transaction has already been processed
    if sequencer_state.processed_transactions.contains_key(&transaction.hash) {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Add transaction to queue
    sequencer_state.transaction_queue.push_back(transaction.clone());
    
    // Mark transaction as processed
    sequencer_state.processed_transactions.insert(transaction.hash, true);
    
    // Collect fee
    // In a real implementation, this would transfer tokens from fee_payer to sequencer
    // For simplicity, we're just logging the fee
    
    msg!("Transaction submitted: {:?}", transaction.hash);
    
    sequencer_state.serialize(&mut *sequencer_state_account.data.borrow_mut())?;
    
    Ok(())
}

/// Process create batch instruction
fn process_create_batch(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let sequencer_state_account = next_account_info(account_info_iter)?;
    let operator = next_account_info(account_info_iter)?;
    
    if !sequencer_state_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if sequencer_state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    let mut sequencer_state = SequencerState::try_from_slice(&sequencer_state_account.data.borrow())?;
    
    if sequencer_state.is_paused {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Check if operator is authorized
    if *operator.key != sequencer_state.operator && !sequencer_state.backup_operators.contains(operator.key) {
        return Err(ProgramError::InvalidArgument);
    }
    
    if !operator.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Check if there are enough transactions to create a batch
    if sequencer_state.transaction_queue.is_empty() {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Check if enough time has passed since the last batch
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;
    
    if sequencer_state.last_batch_timestamp > 0 && 
       current_timestamp - sequencer_state.last_batch_timestamp < MAX_BATCH_WAIT_TIME &&
       sequencer_state.transaction_queue.len() < MAX_BATCH_SIZE {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Create batch
    let batch_id = sequencer_state.next_batch_id;
    sequencer_state.next_batch_id += 1;
    
    // Sort transactions by priority and fee
    let mut transactions = Vec::new();
    while !sequencer_state.transaction_queue.is_empty() && transactions.len() < MAX_BATCH_SIZE {
        transactions.push(sequencer_state.transaction_queue.pop_front().unwrap());
    }
    
    transactions.sort_by(|a, b| {
        // First sort by priority (High > Medium > Low)
        let priority_cmp = match (a.priority, b.priority) {
            (TransactionPriority::High, TransactionPriority::High) => std::cmp::Ordering::Equal,
            (TransactionPriority::High, _) => std::cmp::Ordering::Less,
            (_, TransactionPriority::High) => std::cmp::Ordering::Greater,
            (TransactionPriority::Medium, TransactionPriority::Medium) => std::cmp::Ordering::Equal,
            (TransactionPriority::Medium, _) => std::cmp::Ordering::Less,
            (_, TransactionPriority::Medium) => std::cmp::Ordering::Greater,
            (TransactionPriority::Low, TransactionPriority::Low) => std::cmp::Ordering::Equal,
        };
        
        // If priorities are equal, sort by fee (higher fee first)
        if priority_cmp == std::cmp::Ordering::Equal {
            b.fee.cmp(&a.fee)
        } else {
            priority_cmp
        }
    });
    
    // Calculate batch size and total fees
    let mut batch_size = 0;
    let mut total_fees = 0;
    
    for transaction in &transactions {
        batch_size += transaction.data.len() as u64;
        total_fees += transaction.fee;
    }
    
    let batch = Batch {
        id: batch_id,
        sequencer: *operator.key,
        transactions: transactions.clone(),
        timestamp: current_timestamp,
        size: batch_size,
        total_fees,
        l1_transaction_hash: None,
        is_published: false,
    };
    
    sequencer_state.batches.insert(batch_id, batch);
    sequencer_state.last_batch_timestamp = current_timestamp;
    sequencer_state.total_transactions_processed += transactions.len() as u64;
    sequencer_state.total_batches_created += 1;
    
    sequencer_state.serialize(&mut *sequencer_state_account.data.borrow_mut())?;
    
    msg!("Batch created: {} with {} transactions", batch_id, transactions.len());
    Ok(())
}

/// Process publish batch instruction
fn process_publish_batch(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    batch_id: u64,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let sequencer_state_account = next_account_info(account_info_iter)?;
    let operator = next_account_info(account_info_iter)?;
    let l1_program = next_account_info(account_info_iter)?;
    
    if !sequencer_state_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if sequencer_state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    let mut sequencer_state = SequencerState::try_from_slice(&sequencer_state_account.data.borrow())?;
    
    // Check if operator is authorized
    if *operator.key != sequencer_state.operator && !sequencer_state.backup_operators.contains(operator.key) {
        return Err(ProgramError::InvalidArgument);
    }
    
    if !operator.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Get batch
    let batch = sequencer_state.batches.get_mut(&batch_id).ok_or(ProgramError::InvalidArgument)?;
    
    if batch.is_published {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Publish batch to L1
    // In a real implementation, this would call the L1 program to publish the batch
    // For simplicity, we're just marking the batch as published
    
    // Generate a dummy L1 transaction hash
    let l1_transaction_hash = [0; 32];
    
    batch.l1_transaction_hash = Some(l1_transaction_hash);
    batch.is_published = true;
    
    sequencer_state.serialize(&mut *sequencer_state_account.data.borrow_mut())?;
    
    msg!("Batch published: {}", batch_id);
    Ok(())
}

/// Process update sequencer fee instruction
fn process_update_sequencer_fee(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    new_fee: u16,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let sequencer_state_account = next_account_info(account_info_iter)?;
    let operator = next_account_info(account_info_iter)?;
    
    if !sequencer_state_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if sequencer_state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    let mut sequencer_state = SequencerState::try_from_slice(&sequencer_state_account.data.borrow())?;
    
    // Check if operator is authorized
    if *operator.key != sequencer_state.operator {
        return Err(ProgramError::InvalidArgument);
    }
    
    if !operator.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Validate new fee (max 10%)
    if new_fee > 1000 {
        return Err(ProgramError::InvalidArgument);
    }
    
    sequencer_state.sequencer_fee = new_fee;
    
    sequencer_state.serialize(&mut *sequencer_state_account.data.borrow_mut())?;
    
    msg!("Sequencer fee updated: {}", new_fee);
    Ok(())
}

/// Process add backup operator instruction
fn process_add_backup_operator(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    operator: Pubkey,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let sequencer_state_account = next_account_info(account_info_iter)?;
    let admin = next_account_info(account_info_iter)?;
    
    if !sequencer_state_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if sequencer_state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    let mut sequencer_state = SequencerState::try_from_slice(&sequencer_state_account.data.borrow())?;
    
    // Check if admin is authorized
    if *admin.key != sequencer_state.operator {
        return Err(ProgramError::InvalidArgument);
    }
    
    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Check if operator is already a backup operator
    if sequencer_state.backup_operators.contains(&operator) {
        return Err(ProgramError::InvalidArgument);
    }
    
    sequencer_state.backup_operators.push(operator);
    
    sequencer_state.serialize(&mut *sequencer_state_account.data.borrow_mut())?;
    
    msg!("Backup operator added: {}", operator);
    Ok(())
}

/// Process remove backup operator instruction
fn process_remove_backup_operator(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    operator: Pubkey,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let sequencer_state_account = next_account_info(account_info_iter)?;
    let admin = next_account_info(account_info_iter)?;
    
    if !sequencer_state_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if sequencer_state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    let mut sequencer_state = SequencerState::try_from_slice(&sequencer_state_account.data.borrow())?;
    
    // Check if admin is authorized
    if *admin.key != sequencer_state.operator {
        return Err(ProgramError::InvalidArgument);
    }
    
    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Remove operator
    sequencer_state.backup_operators.retain(|&x| x != operator);
    
    sequencer_state.serialize(&mut *sequencer_state_account.data.borrow_mut())?;
    
    msg!("Backup operator removed: {}", operator);
    Ok(())
}

/// Process pause sequencer instruction
fn process_pause_sequencer(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let sequencer_state_account = next_account_info(account_info_iter)?;
    let admin = next_account_info(account_info_iter)?;
    
    if !sequencer_state_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if sequencer_state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    let mut sequencer_state = SequencerState::try_from_slice(&sequencer_state_account.data.borrow())?;
    
    // Check if admin is authorized
    if *admin.key != sequencer_state.operator {
        return Err(ProgramError::InvalidArgument);
    }
    
    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    if sequencer_state.is_paused {
        return Err(ProgramError::InvalidArgument);
    }
    
    sequencer_state.is_paused = true;
    
    sequencer_state.serialize(&mut *sequencer_state_account.data.borrow_mut())?;
    
    msg!("Sequencer paused");
    Ok(())
}

/// Process resume sequencer instruction
fn process_resume_sequencer(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let sequencer_state_account = next_account_info(account_info_iter)?;
    let admin = next_account_info(account_info_iter)?;
    
    if !sequencer_state_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if sequencer_state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    let mut sequencer_state = SequencerState::try_from_slice(&sequencer_state_account.data.borrow())?;
    
    // Check if admin is authorized
    if *admin.key != sequencer_state.operator {
        return Err(ProgramError::InvalidArgument);
    }
    
    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    if !sequencer_state.is_paused {
        return Err(ProgramError::InvalidArgument);
    }
    
    sequencer_state.is_paused = false;
    
    sequencer_state.serialize(&mut *sequencer_state_account.data.borrow_mut())?;
    
    msg!("Sequencer resumed");
    Ok(())
}

/// Helper function to hash transaction data
fn hash_transaction(sender: &Pubkey, data: &[u8], nonce: u64) -> [u8; 32] {
    // In a real implementation, this would compute a hash of the transaction data
    // For simplicity, we're just returning a dummy hash
    [0; 32]
}

/// Helper function to get the next account info
fn next_account_info<'a, 'b>(
    iter: &'a mut std::slice::Iter<'b, AccountInfo<'b>>,
) -> Result<&'b AccountInfo<'b>, ProgramError> {
    iter.next().ok_or(ProgramError::NotEnoughAccountKeys)
}

// Entrypoint
entrypoint!(process_instruction);
