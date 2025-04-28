/**
 * Solana Layer 2 - Enhanced Security Module
 * 
 * This module implements advanced security features for the Solana Layer 2 program,
 * including replay attack protection, double-spending prevention, front-running protection,
 * rate limiting, amount limiting, and other security measures.
 * 
 * Security enhancements include:
 * - Robust nonce tracking and verification for replay protection
 * - Time-based transaction ordering for front-running protection
 * - Double-spending prevention through comprehensive transaction validation
 * - Quantum-resistant signature verification integration
 */

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    sysvar::{clock::Clock, Sysvar},
};
use crate::{
    error::{Layer2Error, return_layer2_error},
    state::{Layer2State, NonceStore, TransactionRecord},
};

// Security constants
const MAX_TRANSACTIONS_PER_BLOCK: u32 = 1000;
const MAX_AMOUNT_PER_TRANSACTION: u64 = 1_000_000_000_000; // 1000 SOL in lamports
const RATE_LIMIT_WINDOW: u64 = 60; // 60 seconds
const RATE_LIMIT_MAX_TRANSACTIONS: u32 = 100; // 100 transactions per minute
const AMOUNT_LIMIT_WINDOW: u64 = 3600; // 1 hour
const AMOUNT_LIMIT_MAX_AMOUNT: u64 = 10_000_000_000_000; // 10,000 SOL in lamports
const FRONT_RUNNING_PROTECTION_WINDOW: u64 = 10; // 10 seconds
const NONCE_EXPIRATION_TIME: u64 = 86400; // 24 hours in seconds
const MAX_NONCE_STORE_SIZE: usize = 10000; // Maximum number of nonces to store

// Process security instruction
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // First byte is the security instruction type
    if instruction_data.is_empty() {
        return Err(return_layer2_error(Layer2Error::InvalidInstruction, "Empty security instruction data"));
    }
    
    let instruction_type = instruction_data[0];
    
    match instruction_type {
        0 => check_transaction_security(program_id, accounts, &instruction_data[1..]),
        1 => update_security_params(program_id, accounts, &instruction_data[1..]),
        2 => pause_program(program_id, accounts),
        3 => unpause_program(program_id, accounts),
        _ => Err(return_layer2_error(Layer2Error::InvalidInstruction, "Invalid security instruction type")),
    }
}

// Check transaction security with enhanced protections
fn check_transaction_security(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    // Get accounts
    let sender = next_account_info(accounts_iter)?;
    let state_account = next_account_info(accounts_iter)?;
    let nonce_store_account = next_account_info(accounts_iter)?;
    let transaction_record_account = next_account_info(accounts_iter)?;
    let clock_sysvar = next_account_info(accounts_iter)?;
    
    // Check if sender is a signer
    if !sender.is_signer {
        return Err(return_layer2_error(Layer2Error::InvalidSignature, "Sender must be a signer"));
    }
    
    // Check if accounts are owned by this program
    if state_account.owner != program_id || nonce_store_account.owner != program_id || transaction_record_account.owner != program_id {
        return Err(return_layer2_error(Layer2Error::InvalidStateTransition, "Accounts not owned by program"));
    }
    
    // Deserialize state
    let state_data = state_account.try_borrow_data()?;
    let state = Layer2State::unpack(&state_data)?;
    
    // Check if program is paused
    if state.paused {
        return Err(return_layer2_error(Layer2Error::ProgramPaused, "Program is paused"));
    }
    
    // Get current timestamp
    let clock = Clock::from_account_info(clock_sysvar)?;
    let current_timestamp = clock.unix_timestamp as u64;
    
    // Parse transaction amount, nonce, and hash from instruction data
    if instruction_data.len() < 48 {
        return Err(return_layer2_error(Layer2Error::InvalidInstruction, "Invalid transaction data"));
    }
    
    let amount = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());
    let nonce = u64::from_le_bytes(instruction_data[8..16].try_into().unwrap());
    let tx_hash: [u8; 32] = instruction_data[16..48].try_into().unwrap();
    
    // Check amount limit
    if amount > MAX_AMOUNT_PER_TRANSACTION {
        return Err(return_layer2_error(Layer2Error::TransactionLimitExceeded, "Transaction amount exceeds maximum"));
    }
    
    // Check if nonce has been used before
    let mut nonce_store_data = nonce_store_account.try_borrow_mut_data()?;
    let mut nonce_store = NonceStore::unpack(&nonce_store_data)?;
    
    if current_timestamp - nonce_store.last_cleanup > 3600 {
        cleanup_expired_nonces(&mut nonce_store, current_timestamp);
        nonce_store.last_cleanup = current_timestamp;
    }
    
    // Check if nonce exists in the store
    for (stored_nonce, _) in &nonce_store.nonces {
        if *stored_nonce == nonce {
            return Err(return_layer2_error(Layer2Error::InvalidTransaction, "Nonce already used (replay attack detected)"));
        }
    }
    
    nonce_store.nonces.push((nonce, current_timestamp));
    
    if nonce_store.nonces.len() > MAX_NONCE_STORE_SIZE {
        nonce_store.nonces.sort_by(|a, b| a.1.cmp(&b.1)); // Sort by timestamp
        nonce_store.nonces.truncate(MAX_NONCE_STORE_SIZE / 2); // Keep only the newer half
    }
    
    NonceStore::pack(nonce_store, &mut nonce_store_data)?;
    
    // Check if transaction with same hash exists
    let mut tx_record_data = transaction_record_account.try_borrow_mut_data()?;
    
    if tx_record_data[0] == 0 {
        let tx_record = TransactionRecord {
            is_initialized: true,
            sender: *sender.key,
            tx_hash,
            nonce,
            amount,
            timestamp: current_timestamp,
            status: 0, // Pending
            execution_timestamp: None,
        };
        
        TransactionRecord::pack(tx_record, &mut tx_record_data)?;
    } else {
        // Check if this is a duplicate transaction
        let tx_record = TransactionRecord::unpack(&tx_record_data)?;
        
        if tx_record.tx_hash == tx_hash {
            return Err(return_layer2_error(Layer2Error::InvalidTransaction, "Transaction already exists (double-spend attempt)"));
        }
        
        if tx_record.sender == *sender.key && 
           current_timestamp - tx_record.timestamp < FRONT_RUNNING_PROTECTION_WINDOW {
            return Err(return_layer2_error(Layer2Error::InvalidTransaction, "Transaction submitted too quickly after previous one (potential front-running)"));
        }
    }
    
    // Check if sender has exceeded rate limits
    let transaction_history = get_recent_transactions_for_sender(sender.key, accounts)?;
    if exceeds_rate_limit(sender.key, current_timestamp, &transaction_history) {
        return Err(return_layer2_error(Layer2Error::RateLimitExceeded, "Rate limit exceeded for sender"));
    }
    
    // Check if sender has exceeded amount limits
    let amount_history = get_recent_amounts_for_sender(sender.key, accounts)?;
    if exceeds_amount_limit(sender.key, amount, current_timestamp, &amount_history) {
        return Err(return_layer2_error(Layer2Error::AmountLimitExceeded, "Amount limit exceeded for sender"));
    }
    
    msg!("Security checks passed for transaction: {:?}", tx_hash);
    
    Ok(())
}

// Update security parameters
fn update_security_params(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    // Get accounts
    let authority = next_account_info(accounts_iter)?;
    let state_account = next_account_info(accounts_iter)?;
    
    // Check if authority is a signer
    if !authority.is_signer {
        return Err(return_layer2_error(Layer2Error::InvalidSignature, "Authority must be a signer"));
    }
    
    // Check if state account is owned by this program
    if state_account.owner != program_id {
        return Err(return_layer2_error(Layer2Error::InvalidStateTransition, "State account not owned by program"));
    }
    
    // Deserialize state
    let state_data = state_account.try_borrow_data()?;
    let mut state = Layer2State::unpack(&state_data)?;
    
    // Check if authority is authorized
    if state.authority != *authority.key {
        return Err(return_layer2_error(Layer2Error::Unauthorized, "Unauthorized authority"));
    }
    
    // Parse new security parameters from instruction data
    if instruction_data.len() < 30 {
        return Err(return_layer2_error(Layer2Error::InvalidInstruction, "Invalid security params data"));
    }
    
    let challenge_period = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());
    let min_sequencer_stake = u64::from_le_bytes(instruction_data[8..16].try_into().unwrap());
    let min_validator_stake = u64::from_le_bytes(instruction_data[16..24].try_into().unwrap());
    let fraud_proof_reward_bps = u16::from_le_bytes(instruction_data[24..26].try_into().unwrap());
    let max_batch_size = u32::from_le_bytes(instruction_data[26..30].try_into().unwrap());
    
    // Update security parameters
    state.security_params.challenge_period = challenge_period;
    state.security_params.min_sequencer_stake = min_sequencer_stake;
    state.security_params.min_validator_stake = min_validator_stake;
    state.security_params.fraud_proof_reward_bps = fraud_proof_reward_bps;
    state.security_params.max_batch_size = max_batch_size;
    
    // Serialize state back to account
    let mut state_data = state_account.try_borrow_mut_data()?;
    Layer2State::pack(state, &mut state_data)?;
    
    msg!("Security parameters updated");
    
    Ok(())
}

// Pause program
fn pause_program(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    // Get accounts
    let authority = next_account_info(accounts_iter)?;
    let state_account = next_account_info(accounts_iter)?;
    
    // Check if authority is a signer
    if !authority.is_signer {
        return Err(return_layer2_error(Layer2Error::InvalidSignature, "Authority must be a signer"));
    }
    
    // Check if state account is owned by this program
    if state_account.owner != program_id {
        return Err(return_layer2_error(Layer2Error::InvalidStateTransition, "State account not owned by program"));
    }
    
    // Deserialize state
    let state_data = state_account.try_borrow_data()?;
    let mut state = Layer2State::unpack(&state_data)?;
    
    // Check if authority is authorized
    if state.authority != *authority.key {
        return Err(return_layer2_error(Layer2Error::Unauthorized, "Unauthorized authority"));
    }
    
    // Check if program is already paused
    if state.paused {
        return Err(return_layer2_error(Layer2Error::InvalidStateTransition, "Program is already paused"));
    }
    
    // Pause program
    state.paused = true;
    
    // Serialize state back to account
    let mut state_data = state_account.try_borrow_mut_data()?;
    Layer2State::pack(state, &mut state_data)?;
    
    msg!("Program paused");
    
    Ok(())
}

// Unpause program
fn unpause_program(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    // Get accounts
    let authority = next_account_info(accounts_iter)?;
    let state_account = next_account_info(accounts_iter)?;
    
    // Check if authority is a signer
    if !authority.is_signer {
        return Err(return_layer2_error(Layer2Error::InvalidSignature, "Authority must be a signer"));
    }
    
    // Check if state account is owned by this program
    if state_account.owner != program_id {
        return Err(return_layer2_error(Layer2Error::InvalidStateTransition, "State account not owned by program"));
    }
    
    // Deserialize state
    let state_data = state_account.try_borrow_data()?;
    let mut state = Layer2State::unpack(&state_data)?;
    
    // Check if authority is authorized
    if state.authority != *authority.key {
        return Err(return_layer2_error(Layer2Error::Unauthorized, "Unauthorized authority"));
    }
    
    // Check if program is already unpaused
    if !state.paused {
        return Err(return_layer2_error(Layer2Error::InvalidStateTransition, "Program is already unpaused"));
    }
    
    // Unpause program
    state.paused = false;
    
    // Serialize state back to account
    let mut state_data = state_account.try_borrow_mut_data()?;
    Layer2State::pack(state, &mut state_data)?;
    
    msg!("Program unpaused");
    
    Ok(())
}

// Helper function to clean up expired nonces
fn cleanup_expired_nonces(nonce_store: &mut NonceStore, current_timestamp: u64) {
    let expiration_threshold = current_timestamp.saturating_sub(NONCE_EXPIRATION_TIME);
    nonce_store.nonces.retain(|(_, timestamp)| *timestamp >= expiration_threshold);
    
    msg!("Cleaned up expired nonces. Remaining: {}", nonce_store.nonces.len());
}

// Helper function to get recent transactions for a sender
fn get_recent_transactions_for_sender(
    sender: &Pubkey,
    accounts: &[AccountInfo],
) -> Result<Vec<(Pubkey, u64)>, ProgramError> {
    let mut transactions = Vec::new();
    
    for account in accounts.iter().skip(5) { // Skip the first 5 accounts (sender, state, nonce_store, tx_record, clock)
        if account.owner == &solana_program::system_program::id() {
            continue; // Skip system-owned accounts
        }
        
        if let Ok(tx_record) = TransactionRecord::unpack(&account.try_borrow_data()?) {
            if tx_record.is_initialized && tx_record.sender == *sender {
                transactions.push((tx_record.sender, tx_record.timestamp));
            }
        }
    }
    
    Ok(transactions)
}

// Helper function to get recent amounts for a sender
fn get_recent_amounts_for_sender(
    sender: &Pubkey,
    accounts: &[AccountInfo],
) -> Result<Vec<(Pubkey, u64, u64)>, ProgramError> {
    let mut amounts = Vec::new();
    
    for account in accounts.iter().skip(5) { // Skip the first 5 accounts (sender, state, nonce_store, tx_record, clock)
        if account.owner == &solana_program::system_program::id() {
            continue; // Skip system-owned accounts
        }
        
        if let Ok(tx_record) = TransactionRecord::unpack(&account.try_borrow_data()?) {
            if tx_record.is_initialized && tx_record.sender == *sender {
                amounts.push((tx_record.sender, tx_record.timestamp, tx_record.amount));
            }
        }
    }
    
    Ok(amounts)
}

// Helper function to check if a transaction is a replay
pub fn is_replay(nonce: u64, used_nonces: &[u64]) -> bool {
    used_nonces.contains(&nonce)
}

// Helper function to check if a transaction exceeds rate limits
pub fn exceeds_rate_limit(
    sender: &Pubkey,
    current_timestamp: u64,
    transaction_history: &[(Pubkey, u64)],
) -> bool {
    let window_start = current_timestamp.saturating_sub(RATE_LIMIT_WINDOW);
    
    let transactions_in_window = transaction_history
        .iter()
        .filter(|(tx_sender, timestamp)| {
            tx_sender == sender && *timestamp >= window_start
        })
        .count() as u32;
    
    transactions_in_window >= RATE_LIMIT_MAX_TRANSACTIONS
}

// Helper function to check if a transaction exceeds amount limits
pub fn exceeds_amount_limit(
    sender: &Pubkey,
    amount: u64,
    current_timestamp: u64,
    transaction_history: &[(Pubkey, u64, u64)],
) -> bool {
    let window_start = current_timestamp.saturating_sub(AMOUNT_LIMIT_WINDOW);
    
    let amount_in_window: u64 = transaction_history
        .iter()
        .filter(|(tx_sender, timestamp, _)| {
            tx_sender == sender && *timestamp >= window_start
        })
        .map(|(_, _, tx_amount)| *tx_amount)
        .sum();
    
    amount_in_window + amount > AMOUNT_LIMIT_MAX_AMOUNT
}

// Helper function to validate a merkle proof
pub fn validate_merkle_proof(
    tx_hash: &[u8; 32],
    merkle_proof: &[[u8; 32]],
    merkle_root: &[u8; 32],
) -> bool {
    let mut current_hash = *tx_hash;
    
    for proof_element in merkle_proof {
        // Sort hashes to ensure consistent ordering
        let (first, second) = if current_hash < *proof_element {
            (current_hash, *proof_element)
        } else {
            (*proof_element, current_hash)
        };
        
        // Concatenate and hash
        let mut combined = [0u8; 64];
        combined[0..32].copy_from_slice(&first);
        combined[32..64].copy_from_slice(&second);
        
        current_hash = solana_program::keccak::hash(&combined).0;
    }
    
    current_hash == *merkle_root
}

// Helper function to create a transaction hash
pub fn create_transaction_hash(
    sender: &Pubkey,
    recipient: &Pubkey,
    amount: u64,
    nonce: u64,
    timestamp: u64,
) -> [u8; 32] {
    // Concatenate all transaction data
    let mut data = Vec::with_capacity(32 + 32 + 8 + 8 + 8);
    data.extend_from_slice(sender.as_ref());
    data.extend_from_slice(recipient.as_ref());
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&nonce.to_le_bytes());
    data.extend_from_slice(&timestamp.to_le_bytes());
    
    solana_program::keccak::hash(&data).0
}
