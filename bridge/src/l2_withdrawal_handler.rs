// src/l2_withdrawal_handler.rs
//! Handler for withdrawals from Solana Layer-2 to Ethereum (L1)
//! 
//! This module processes withdrawal requests on Solana Layer-2 and
//! generates proofs that can be verified on Ethereum to release assets.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    program::{invoke, invoke_signed},
    system_instruction,
    sysvar::{rent::Rent, Sysvar},
};
use solana_program::borsh::try_from_slice_unchecked;
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::HashMap;

/// Withdrawal information for L2 to L1
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct Withdrawal {
    /// Ethereum recipient address (20 bytes)
    pub eth_recipient: [u8; 20],
    
    /// Ethereum token address (20 bytes, zero for ETH)
    pub eth_token: [u8; 20],
    
    /// Amount of tokens
    pub amount: u64,
    
    /// Solana sender address
    pub sol_sender: Pubkey,
    
    /// Timestamp of the withdrawal
    pub timestamp: u64,
    
    /// Withdrawal hash
    pub withdrawal_hash: [u8; 32],
    
    /// Whether the withdrawal has been processed
    pub processed: bool,
    
    /// L2 block number containing the withdrawal
    pub l2_block_number: u64,
    
    /// L2 block hash containing the withdrawal
    pub l2_block_hash: [u8; 32],
}

/// Program state
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct ProgramState {
    /// Owner of the program
    pub owner: Pubkey,
    
    /// L1 bridge address
    pub l1_bridge_address: [u8; 20],
    
    /// Mapping of Solana token mints to Ethereum token addresses
    pub token_mapping: HashMap<Pubkey, [u8; 20]>,
    
    /// Nonce for PDA derivation
    pub nonce: u8,
    
    /// Total withdrawals processed
    pub total_withdrawals: u64,
    
    /// Latest L2 block number
    pub latest_l2_block_number: u64,
    
    /// Latest L2 block hash
    pub latest_l2_block_hash: [u8; 32],
}

/// Instruction types
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum WithdrawalInstruction {
    /// Initialize the program
    /// 
    /// Accounts expected:
    /// 0. `[signer]` Owner account
    /// 1. `[writable]` Program state account
    /// 2. `[]` Rent sysvar
    Initialize {
        /// L1 bridge address
        l1_bridge_address: [u8; 20],
    },
    
    /// Initiate a withdrawal
    /// 
    /// Accounts expected:
    /// 0. `[signer]` Sender account
    /// 1. `[writable]` Program state account
    /// 2. `[writable]` Withdrawal account
    /// 3. `[writable]` Sender token account
    /// 4. `[]` Token mint
    /// 5. `[]` Token program
    /// 6. `[]` System program
    InitiateWithdrawal {
        /// Ethereum recipient address
        eth_recipient: [u8; 20],
        
        /// Amount of tokens
        amount: u64,
    },
    
    /// Process a withdrawal
    /// 
    /// Accounts expected:
    /// 0. `[signer]` Owner or authorized operator
    /// 1. `[writable]` Program state account
    /// 2. `[writable]` Withdrawal account
    ProcessWithdrawal {
        /// Withdrawal hash
        withdrawal_hash: [u8; 32],
    },
    
    /// Add a token mapping
    /// 
    /// Accounts expected:
    /// 0. `[signer]` Owner account
    /// 1. `[writable]` Program state account
    AddTokenMapping {
        /// Solana token mint
        sol_token_mint: Pubkey,
        
        /// Ethereum token address
        eth_token: [u8; 20],
    },
    
    /// Remove a token mapping
    /// 
    /// Accounts expected:
    /// 0. `[signer]` Owner account
    /// 1. `[writable]` Program state account
    RemoveTokenMapping {
        /// Solana token mint
        sol_token_mint: Pubkey,
    },
    
    /// Update L2 block information
    /// 
    /// Accounts expected:
    /// 0. `[signer]` Owner or authorized operator
    /// 1. `[writable]` Program state account
    UpdateL2BlockInfo {
        /// L2 block number
        l2_block_number: u64,
        
        /// L2 block hash
        l2_block_hash: [u8; 32],
    },
    
    /// Generate a withdrawal proof
    /// 
    /// Accounts expected:
    /// 0. `[signer]` Sender account
    /// 1. `[]` Program state account
    /// 2. `[]` Withdrawal account
    GenerateWithdrawalProof {
        /// Withdrawal hash
        withdrawal_hash: [u8; 32],
    },
}

/// Program entrypoint
entrypoint!(process_instruction);

/// Process instruction
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = WithdrawalInstruction::try_from_slice(instruction_data)?;
    
    match instruction {
        WithdrawalInstruction::Initialize { l1_bridge_address } => {
            process_initialize(program_id, accounts, l1_bridge_address)
        },
        WithdrawalInstruction::InitiateWithdrawal { eth_recipient, amount } => {
            process_initiate_withdrawal(program_id, accounts, eth_recipient, amount)
        },
        WithdrawalInstruction::ProcessWithdrawal { withdrawal_hash } => {
            process_process_withdrawal(program_id, accounts, withdrawal_hash)
        },
        WithdrawalInstruction::AddTokenMapping { sol_token_mint, eth_token } => {
            process_add_token_mapping(program_id, accounts, sol_token_mint, eth_token)
        },
        WithdrawalInstruction::RemoveTokenMapping { sol_token_mint } => {
            process_remove_token_mapping(program_id, accounts, sol_token_mint)
        },
        WithdrawalInstruction::UpdateL2BlockInfo { l2_block_number, l2_block_hash } => {
            process_update_l2_block_info(program_id, accounts, l2_block_number, l2_block_hash)
        },
        WithdrawalInstruction::GenerateWithdrawalProof { withdrawal_hash } => {
            process_generate_withdrawal_proof(program_id, accounts, withdrawal_hash)
        },
    }
}

/// Process initialize instruction
fn process_initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    l1_bridge_address: [u8; 20],
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    
    let owner_account = next_account_info(account_info_iter)?;
    let state_account = next_account_info(account_info_iter)?;
    let rent_account = next_account_info(account_info_iter)?;
    
    // Verify owner signature
    if !owner_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Verify state account ownership
    if state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    // Verify rent exemption
    let rent = Rent::from_account_info(rent_account)?;
    if !rent.is_exempt(state_account.lamports(), state_account.data_len()) {
        return Err(ProgramError::AccountNotRentExempt);
    }
    
    // Initialize program state
    let program_state = ProgramState {
        owner: *owner_account.key,
        l1_bridge_address,
        token_mapping: HashMap::new(),
        nonce: 0,
        total_withdrawals: 0,
        latest_l2_block_number: 0,
        latest_l2_block_hash: [0; 32],
    };
    
    // Serialize program state
    program_state.serialize(&mut *state_account.data.borrow_mut())?;
    
    Ok(())
}

/// Process initiate withdrawal instruction
fn process_initiate_withdrawal(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    eth_recipient: [u8; 20],
    amount: u64,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    
    let sender_account = next_account_info(account_info_iter)?;
    let state_account = next_account_info(account_info_iter)?;
    let withdrawal_account = next_account_info(account_info_iter)?;
    let sender_token_account = next_account_info(account_info_iter)?;
    let token_mint = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;
    
    // Verify sender signature
    if !sender_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Verify state account ownership
    if state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    // Deserialize program state
    let mut program_state: ProgramState = try_from_slice_unchecked(&state_account.data.borrow())?;
    
    // Verify token mapping exists
    if !program_state.token_mapping.contains_key(token_mint.key) {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Get the Ethereum token address
    let eth_token = program_state.token_mapping[token_mint.key];
    
    // Generate a unique withdrawal hash
    let withdrawal_hash = solana_program::keccak::hash(
        &[
            &eth_recipient[..],
            &eth_token[..],
            &amount.to_le_bytes()[..],
            &sender_account.key.to_bytes()[..],
            &program_state.latest_l2_block_number.to_le_bytes()[..],
            &program_state.latest_l2_block_hash[..],
        ].concat()
    ).to_bytes();
    
    // Create the withdrawal
    let withdrawal = Withdrawal {
        eth_recipient,
        eth_token,
        amount,
        sol_sender: *sender_account.key,
        timestamp: solana_program::clock::Clock::get()?.unix_timestamp as u64,
        withdrawal_hash,
        processed: false,
        l2_block_number: program_state.latest_l2_block_number,
        l2_block_hash: program_state.latest_l2_block_hash,
    };
    
    // Burn tokens from sender
    // In a real implementation, we would call the token program to burn tokens
    // For now, we just log the burn operation
    msg!("Burning {} tokens from {}", amount, sender_account.key);
    
    // Serialize withdrawal data
    withdrawal.serialize(&mut *withdrawal_account.data.borrow_mut())?;
    
    // Update program state
    program_state.total_withdrawals += 1;
    program_state.serialize(&mut *state_account.data.borrow_mut())?;
    
    Ok(())
}

/// Process process withdrawal instruction
fn process_process_withdrawal(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    withdrawal_hash: [u8; 32],
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    
    let operator_account = next_account_info(account_info_iter)?;
    let state_account = next_account_info(account_info_iter)?;
    let withdrawal_account = next_account_info(account_info_iter)?;
    
    // Verify operator signature
    if !operator_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Verify state account ownership
    if state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    // Deserialize program state
    let program_state: ProgramState = try_from_slice_unchecked(&state_account.data.borrow())?;
    
    // Verify operator authorization
    if *operator_account.key != program_state.owner {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Deserialize withdrawal data
    let mut withdrawal: Withdrawal = try_from_slice_unchecked(&withdrawal_account.data.borrow())?;
    
    // Verify withdrawal hash
    if withdrawal.withdrawal_hash != withdrawal_hash {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Verify withdrawal hasn't been processed
    if withdrawal.processed {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Mark withdrawal as processed
    withdrawal.processed = true;
    
    // Serialize withdrawal data
    withdrawal.serialize(&mut *withdrawal_account.data.borrow_mut())?;
    
    Ok(())
}

/// Process add token mapping instruction
fn process_add_token_mapping(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    sol_token_mint: Pubkey,
    eth_token: [u8; 20],
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    
    let owner_account = next_account_info(account_info_iter)?;
    let state_account = next_account_info(account_info_iter)?;
    
    // Verify owner signature
    if !owner_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Verify state account ownership
    if state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    // Deserialize program state
    let mut program_state: ProgramState = try_from_slice_unchecked(&state_account.data.borrow())?;
    
    // Verify owner authorization
    if *owner_account.key != program_state.owner {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Add token mapping
    program_state.token_mapping.insert(sol_token_mint, eth_token);
    
    // Serialize program state
    program_state.serialize(&mut *state_account.data.borrow_mut())?;
    
    Ok(())
}

/// Process remove token mapping instruction
fn process_remove_token_mapping(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    sol_token_mint: Pubkey,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    
    let owner_account = next_account_info(account_info_iter)?;
    let state_account = next_account_info(account_info_iter)?;
    
    // Verify owner signature
    if !owner_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Verify state account ownership
    if state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    // Deserialize program state
    let mut program_state: ProgramState = try_from_slice_unchecked(&state_account.data.borrow())?;
    
    // Verify owner authorization
    if *owner_account.key != program_state.owner {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Remove token mapping
    program_state.token_mapping.remove(&sol_token_mint);
    
    // Serialize program state
    program_state.serialize(&mut *state_account.data.borrow_mut())?;
    
    Ok(())
}

/// Process update L2 block info instruction
fn process_update_l2_block_info(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    l2_block_number: u64,
    l2_block_hash: [u8; 32],
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    
    let operator_account = next_account_info(account_info_iter)?;
    let state_account = next_account_info(account_info_iter)?;
    
    // Verify operator signature
    if !operator_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Verify state account ownership
    if state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    // Deserialize program state
    let mut program_state: ProgramState = try_from_slice_unchecked(&state_account.data.borrow())?;
    
    // Verify operator authorization
    if *operator_account.key != program_state.owner {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Verify block number is greater than the latest
    if l2_block_number <= program_state.latest_l2_block_number {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Update L2 block info
    program_state.latest_l2_block_number = l2_block_number;
    program_state.latest_l2_block_hash = l2_block_hash;
    
    // Serialize program state
    program_state.serialize(&mut *state_account.data.borrow_mut())?;
    
    Ok(())
}

/// Process generate withdrawal proof instruction
fn process_generate_withdrawal_proof(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    withdrawal_hash: [u8; 32],
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    
    let sender_account = next_account_info(account_info_iter)?;
    let state_account = next_account_info(account_info_iter)?;
    let withdrawal_account = next_account_info(account_info_iter)?;
    
    // Verify sender signature
    if !sender_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Verify state account ownership
    if state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    // Deserialize withdrawal data
    let withdrawal: Withdrawal = try_from_slice_unchecked(&withdrawal_account.data.borrow())?;
    
    // Verify withdrawal hash
    if withdrawal.withdrawal_hash != withdrawal_hash {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Verify sender is the withdrawal initiator
    if withdrawal.sol_sender != *sender_account.key {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Generate and return the proof
    // In a real implementation, we would generate a Merkle proof
    // For now, we just log the proof generation
    msg!("Generating proof for withdrawal {}", hex::encode(withdrawal_hash));
    
    // Return the proof data
    // In a real implementation, we would return the proof data
    // For now, we just return success
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_program::clock::Epoch;
    use std::mem::size_of;
    
    #[test]
    fn test_initialize() {
        // Create program ID
        let program_id = Pubkey::new_unique();
        
        // Create accounts
        let owner_key = Pubkey::new_unique();
        let mut owner_lamports = 100000;
        let mut owner_data = vec![0; 0];
        let owner_account = AccountInfo::new(
            &owner_key,
            true,
            false,
            &mut owner_lamports,
            &mut owner_data,
            &program_id,
            false,
            Epoch::default(),
        );
        
        let state_key = Pubkey::new_unique();
        let mut state_lamports = 100000;
        let mut state_data = vec![0; size_of::<ProgramState>()];
        let state_account = AccountInfo::new(
            &state_key,
            false,
            true,
            &mut state_lamports,
            &mut state_data,
            &program_id,
            false,
            Epoch::default(),
        );
        
        let rent_key = Pubkey::new_unique();
        let mut rent_lamports = 100000;
        let mut rent_data = vec![0; 0];
        let rent_account = AccountInfo::new(
            &rent_key,
            false,
            false,
            &mut rent_lamports,
            &mut rent_data,
            &program_id,
            false,
            Epoch::default(),
        );
        
        let accounts = vec![owner_account, state_account, rent_account];
        
        // Create L1 bridge address
        let l1_bridge_address = [1; 20];
        
        // Process initialize instruction
        let result = process_initialize(&program_id, &accounts, l1_bridge_address);
        
        // Verify result
        assert!(result.is_ok());
    }
}
