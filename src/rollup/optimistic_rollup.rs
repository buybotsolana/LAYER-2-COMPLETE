// src/rollup/optimistic_rollup.rs
//! Optimistic Rollup implementation for Layer-2 on Solana
//!
//! This module implements the core components of an Optimistic Rollup system:
//! - Transaction batching and execution
//! - State commitment
//! - Fraud proof verification
//! - Challenge mechanism
//!
//! The Optimistic Rollup approach assumes transactions are valid by default,
//! but allows a challenge period during which validators can submit fraud proofs
//! if they detect invalid state transitions.

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
use std::collections::HashMap;
use std::time::{Duration, SystemTime};

/// Maximum number of transactions in a batch
const MAX_BATCH_SIZE: usize = 1000;

/// Challenge period duration in seconds
const CHALLENGE_PERIOD_SECONDS: u64 = 604800; // 7 days

/// State root size in bytes
const STATE_ROOT_SIZE: usize = 32;

/// Transaction status enum
#[derive(BorshSerialize, BorshDeserialize, Debug, PartialEq, Clone)]
pub enum TransactionStatus {
    /// Transaction is pending execution
    Pending,
    
    /// Transaction has been executed and included in a batch
    Executed,
    
    /// Transaction has been finalized (challenge period passed)
    Finalized,
    
    /// Transaction has been challenged
    Challenged,
    
    /// Transaction has been proven invalid
    Invalid,
}

/// Transaction data structure
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct Transaction {
    /// Sender's public key
    pub sender: Pubkey,
    
    /// Recipient's public key
    pub recipient: Pubkey,
    
    /// Transaction amount
    pub amount: u64,
    
    /// Transaction nonce to prevent replay attacks
    pub nonce: u64,
    
    /// Transaction signature
    pub signature: [u8; 64],
    
    /// Transaction timestamp
    pub timestamp: u64,
    
    /// Transaction status
    pub status: TransactionStatus,
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
    
    /// Previous state root
    pub previous_state_root: [u8; STATE_ROOT_SIZE],
    
    /// New state root after applying all transactions
    pub new_state_root: [u8; STATE_ROOT_SIZE],
    
    /// Batch creation timestamp
    pub timestamp: u64,
    
    /// Batch finalization timestamp (after challenge period)
    pub finalization_timestamp: u64,
    
    /// Batch status
    pub status: BatchStatus,
}

/// Batch status enum
#[derive(BorshSerialize, BorshDeserialize, Debug, PartialEq)]
pub enum BatchStatus {
    /// Batch is pending finalization (in challenge period)
    Pending,
    
    /// Batch has been finalized (challenge period passed)
    Finalized,
    
    /// Batch has been challenged
    Challenged,
    
    /// Batch has been proven invalid
    Invalid,
}

/// Challenge data structure
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct Challenge {
    /// Challenge ID
    pub id: u64,
    
    /// Challenger's public key
    pub challenger: Pubkey,
    
    /// Batch ID being challenged
    pub batch_id: u64,
    
    /// Transaction index in the batch
    pub transaction_index: u64,
    
    /// Pre-state root
    pub pre_state_root: [u8; STATE_ROOT_SIZE],
    
    /// Post-state root claimed by sequencer
    pub claimed_post_state_root: [u8; STATE_ROOT_SIZE],
    
    /// Post-state root calculated by challenger
    pub actual_post_state_root: [u8; STATE_ROOT_SIZE],
    
    /// Challenge creation timestamp
    pub timestamp: u64,
    
    /// Challenge status
    pub status: ChallengeStatus,
}

/// Challenge status enum
#[derive(BorshSerialize, BorshDeserialize, Debug, PartialEq)]
pub enum ChallengeStatus {
    /// Challenge is pending resolution
    Pending,
    
    /// Challenge has been accepted (fraud proven)
    Accepted,
    
    /// Challenge has been rejected (no fraud)
    Rejected,
    
    /// Challenge has timed out
    TimedOut,
}

/// Program state data structure
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct ProgramState {
    /// Current state root
    pub state_root: [u8; STATE_ROOT_SIZE],
    
    /// Next batch ID
    pub next_batch_id: u64,
    
    /// Next challenge ID
    pub next_challenge_id: u64,
    
    /// Map of batch IDs to batch data
    pub batches: HashMap<u64, Batch>,
    
    /// Map of challenge IDs to challenge data
    pub challenges: HashMap<u64, Challenge>,
    
    /// Map of account addresses to balances
    pub balances: HashMap<Pubkey, u64>,
    
    /// Map of account addresses to nonces
    pub nonces: HashMap<Pubkey, u64>,
}

/// Instruction enum
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum Instruction {
    /// Initialize the program state
    Initialize,
    
    /// Submit a transaction
    SubmitTransaction(Transaction),
    
    /// Create a batch of transactions
    CreateBatch(Vec<Transaction>),
    
    /// Finalize a batch after challenge period
    FinalizeBatch(u64),
    
    /// Submit a challenge for a batch
    SubmitChallenge(Challenge),
    
    /// Resolve a challenge
    ResolveChallenge(u64),
    
    /// Withdraw funds from L2 to L1
    Withdraw {
        amount: u64,
        recipient: Pubkey,
    },
}

/// Process program instructions
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = Instruction::try_from_slice(instruction_data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    
    match instruction {
        Instruction::Initialize => {
            process_initialize(program_id, accounts)
        },
        Instruction::SubmitTransaction(transaction) => {
            process_submit_transaction(program_id, accounts, transaction)
        },
        Instruction::CreateBatch(transactions) => {
            process_create_batch(program_id, accounts, transactions)
        },
        Instruction::FinalizeBatch(batch_id) => {
            process_finalize_batch(program_id, accounts, batch_id)
        },
        Instruction::SubmitChallenge(challenge) => {
            process_submit_challenge(program_id, accounts, challenge)
        },
        Instruction::ResolveChallenge(challenge_id) => {
            process_resolve_challenge(program_id, accounts, challenge_id)
        },
        Instruction::Withdraw { amount, recipient } => {
            process_withdraw(program_id, accounts, amount, recipient)
        },
    }
}

/// Process initialize instruction
fn process_initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let state_account = next_account_info(account_info_iter)?;
    
    if !state_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    let rent = Rent::get()?;
    if !rent.is_exempt(state_account.lamports(), state_account.data_len()) {
        return Err(ProgramError::AccountNotRentExempt);
    }
    
    let program_state = ProgramState {
        state_root: [0; STATE_ROOT_SIZE],
        next_batch_id: 0,
        next_challenge_id: 0,
        batches: HashMap::new(),
        challenges: HashMap::new(),
        balances: HashMap::new(),
        nonces: HashMap::new(),
    };
    
    program_state.serialize(&mut *state_account.data.borrow_mut())?;
    
    msg!("Optimistic Rollup initialized");
    Ok(())
}

/// Process submit transaction instruction
fn process_submit_transaction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    transaction: Transaction,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let state_account = next_account_info(account_info_iter)?;
    let sender_account = next_account_info(account_info_iter)?;
    
    if !state_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    // Verify transaction signature
    if !verify_transaction_signature(&transaction, sender_account.key) {
        return Err(ProgramError::InvalidArgument);
    }
    
    let mut program_state = ProgramState::try_from_slice(&state_account.data.borrow())?;
    
    // Check nonce to prevent replay attacks
    let current_nonce = program_state.nonces.get(&transaction.sender).unwrap_or(&0);
    if transaction.nonce <= *current_nonce {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Update nonce
    program_state.nonces.insert(transaction.sender, transaction.nonce);
    
    // Store transaction (in a real implementation, this would be more efficient)
    // For simplicity, we're just acknowledging the transaction here
    
    msg!("Transaction submitted: {:?}", transaction);
    
    program_state.serialize(&mut *state_account.data.borrow_mut())?;
    
    Ok(())
}

/// Process create batch instruction
fn process_create_batch(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    transactions: Vec<Transaction>,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let state_account = next_account_info(account_info_iter)?;
    let sequencer_account = next_account_info(account_info_iter)?;
    
    if !state_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    // Verify sequencer signature (in a real implementation)
    // For simplicity, we're just checking that the sequencer signed the transaction
    if !sequencer_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    if transactions.len() > MAX_BATCH_SIZE {
        return Err(ProgramError::InvalidArgument);
    }
    
    let mut program_state = ProgramState::try_from_slice(&state_account.data.borrow())?;
    
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;
    
    // Execute transactions and update state
    let previous_state_root = program_state.state_root;
    let mut new_state_root = previous_state_root;
    
    // In a real implementation, we would execute each transaction and update the state root
    // For simplicity, we're just creating a dummy state root
    for transaction in &transactions {
        // Update balances
        let sender_balance = program_state.balances.get(&transaction.sender).unwrap_or(&0);
        if *sender_balance < transaction.amount {
            return Err(ProgramError::InsufficientFunds);
        }
        
        program_state.balances.insert(transaction.sender, sender_balance - transaction.amount);
        
        let recipient_balance = program_state.balances.get(&transaction.recipient).unwrap_or(&0);
        program_state.balances.insert(transaction.recipient, recipient_balance + transaction.amount);
        
        // Update state root (in a real implementation, this would use a Merkle tree)
        // For simplicity, we're just using a dummy hash function
        new_state_root = hash_state(&program_state.balances);
    }
    
    // Create batch
    let batch_id = program_state.next_batch_id;
    program_state.next_batch_id += 1;
    
    let batch = Batch {
        id: batch_id,
        sequencer: *sequencer_account.key,
        transactions: transactions.clone(),
        previous_state_root,
        new_state_root,
        timestamp: current_timestamp,
        finalization_timestamp: current_timestamp + CHALLENGE_PERIOD_SECONDS,
        status: BatchStatus::Pending,
    };
    
    program_state.batches.insert(batch_id, batch);
    program_state.state_root = new_state_root;
    
    program_state.serialize(&mut *state_account.data.borrow_mut())?;
    
    msg!("Batch created: {}", batch_id);
    Ok(())
}

/// Process finalize batch instruction
fn process_finalize_batch(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    batch_id: u64,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let state_account = next_account_info(account_info_iter)?;
    
    if !state_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    let mut program_state = ProgramState::try_from_slice(&state_account.data.borrow())?;
    
    let batch = program_state.batches.get_mut(&batch_id).ok_or(ProgramError::InvalidArgument)?;
    
    if batch.status != BatchStatus::Pending {
        return Err(ProgramError::InvalidArgument);
    }
    
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;
    
    if current_timestamp < batch.finalization_timestamp {
        return Err(ProgramError::InvalidArgument);
    }
    
    batch.status = BatchStatus::Finalized;
    
    program_state.serialize(&mut *state_account.data.borrow_mut())?;
    
    msg!("Batch finalized: {}", batch_id);
    Ok(())
}

/// Process submit challenge instruction
fn process_submit_challenge(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    challenge: Challenge,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let state_account = next_account_info(account_info_iter)?;
    let challenger_account = next_account_info(account_info_iter)?;
    
    if !state_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    if !challenger_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    let mut program_state = ProgramState::try_from_slice(&state_account.data.borrow())?;
    
    let batch = program_state.batches.get(&challenge.batch_id).ok_or(ProgramError::InvalidArgument)?;
    
    if batch.status != BatchStatus::Pending {
        return Err(ProgramError::InvalidArgument);
    }
    
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;
    
    if current_timestamp >= batch.finalization_timestamp {
        return Err(ProgramError::InvalidArgument);
    }
    
    // In a real implementation, we would verify the challenge by re-executing the transaction
    // and comparing the state roots
    // For simplicity, we're just accepting the challenge
    
    let challenge_id = program_state.next_challenge_id;
    program_state.next_challenge_id += 1;
    
    let mut challenge = challenge;
    challenge.id = challenge_id;
    challenge.challenger = *challenger_account.key;
    challenge.timestamp = current_timestamp;
    challenge.status = ChallengeStatus::Pending;
    
    program_state.challenges.insert(challenge_id, challenge);
    
    program_state.serialize(&mut *state_account.data.borrow_mut())?;
    
    msg!("Challenge submitted: {}", challenge_id);
    Ok(())
}

/// Process resolve challenge instruction
fn process_resolve_challenge(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    challenge_id: u64,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let state_account = next_account_info(account_info_iter)?;
    
    if !state_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    let mut program_state = ProgramState::try_from_slice(&state_account.data.borrow())?;
    
    let challenge = program_state.challenges.get_mut(&challenge_id).ok_or(ProgramError::InvalidArgument)?;
    
    if challenge.status != ChallengeStatus::Pending {
        return Err(ProgramError::InvalidArgument);
    }
    
    let batch = program_state.batches.get_mut(&challenge.batch_id).ok_or(ProgramError::InvalidArgument)?;
    
    // In a real implementation, we would verify the challenge by re-executing the transaction
    // and comparing the state roots
    // For simplicity, we're just accepting the challenge if the state roots don't match
    
    if challenge.claimed_post_state_root != challenge.actual_post_state_root {
        challenge.status = ChallengeStatus::Accepted;
        batch.status = BatchStatus::Invalid;
        
        // Revert to the state before the batch
        program_state.state_root = batch.previous_state_root;
        
        msg!("Challenge accepted: {}", challenge_id);
    } else {
        challenge.status = ChallengeStatus::Rejected;
        msg!("Challenge rejected: {}", challenge_id);
    }
    
    program_state.serialize(&mut *state_account.data.borrow_mut())?;
    
    Ok(())
}

/// Process withdraw instruction
fn process_withdraw(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
    recipient: Pubkey,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let state_account = next_account_info(account_info_iter)?;
    let sender_account = next_account_info(account_info_iter)?;
    
    if !state_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    if !sender_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    let mut program_state = ProgramState::try_from_slice(&state_account.data.borrow())?;
    
    let sender_balance = program_state.balances.get(sender_account.key).unwrap_or(&0);
    
    if *sender_balance < amount {
        return Err(ProgramError::InsufficientFunds);
    }
    
    program_state.balances.insert(*sender_account.key, sender_balance - amount);
    
    // In a real implementation, this would trigger a withdrawal on L1
    // For simplicity, we're just updating the L2 state
    
    program_state.serialize(&mut *state_account.data.borrow_mut())?;
    
    msg!("Withdrawal initiated: {} to {}", amount, recipient);
    Ok(())
}

/// Helper function to verify transaction signature
fn verify_transaction_signature(transaction: &Transaction, pubkey: &Pubkey) -> bool {
    // In a real implementation, this would verify the signature
    // For simplicity, we're just returning true
    true
}

/// Helper function to hash state
fn hash_state(balances: &HashMap<Pubkey, u64>) -> [u8; STATE_ROOT_SIZE] {
    // In a real implementation, this would compute a Merkle root
    // For simplicity, we're just returning a dummy hash
    [0; STATE_ROOT_SIZE]
}

/// Helper function to get the next account info
fn next_account_info<'a, 'b>(
    iter: &'a mut std::slice::Iter<'b, AccountInfo<'b>>,
) -> Result<&'b AccountInfo<'b>, ProgramError> {
    iter.next().ok_or(ProgramError::NotEnoughAccountKeys)
}

// Entrypoint
entrypoint!(process_instruction);
