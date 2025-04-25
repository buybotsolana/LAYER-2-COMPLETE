// src/l2_deposit_handler.rs
//! Handler for deposits from Ethereum (L1) to Solana Layer-2
//! 
//! This module processes deposit events from the L1 bridge contract and
//! mints corresponding assets on the Solana Layer-2.

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

/// Deposit information from L1
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct Deposit {
    /// Ethereum sender address (20 bytes)
    pub eth_sender: [u8; 20],
    
    /// Ethereum token address (20 bytes, zero for ETH)
    pub eth_token: [u8; 20],
    
    /// Amount of tokens
    pub amount: u64,
    
    /// Solana recipient address
    pub sol_recipient: Pubkey,
    
    /// Timestamp of the deposit
    pub timestamp: u64,
    
    /// Deposit hash
    pub deposit_hash: [u8; 32],
    
    /// Whether the deposit has been processed
    pub processed: bool,
}

/// Program state
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct ProgramState {
    /// Owner of the program
    pub owner: Pubkey,
    
    /// L1 bridge address
    pub l1_bridge_address: [u8; 20],
    
    /// Mapping of Ethereum token addresses to Solana token mints
    pub token_mapping: HashMap<[u8; 20], Pubkey>,
    
    /// Nonce for PDA derivation
    pub nonce: u8,
    
    /// Total deposits processed
    pub total_deposits: u64,
}

/// Instruction types
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum DepositInstruction {
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
    
    /// Process a deposit
    /// 
    /// Accounts expected:
    /// 0. `[signer]` Owner or authorized operator
    /// 1. `[writable]` Program state account
    /// 2. `[writable]` Deposit account
    /// 3. `[writable]` Recipient token account
    /// 4. `[]` Token mint
    /// 5. `[]` Token program
    /// 6. `[]` System program
    ProcessDeposit {
        /// Deposit information
        deposit: Deposit,
    },
    
    /// Add a token mapping
    /// 
    /// Accounts expected:
    /// 0. `[signer]` Owner account
    /// 1. `[writable]` Program state account
    AddTokenMapping {
        /// Ethereum token address
        eth_token: [u8; 20],
        
        /// Solana token mint
        sol_token_mint: Pubkey,
    },
    
    /// Remove a token mapping
    /// 
    /// Accounts expected:
    /// 0. `[signer]` Owner account
    /// 1. `[writable]` Program state account
    RemoveTokenMapping {
        /// Ethereum token address
        eth_token: [u8; 20],
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
    let instruction = DepositInstruction::try_from_slice(instruction_data)?;
    
    match instruction {
        DepositInstruction::Initialize { l1_bridge_address } => {
            process_initialize(program_id, accounts, l1_bridge_address)
        },
        DepositInstruction::ProcessDeposit { deposit } => {
            process_deposit(program_id, accounts, deposit)
        },
        DepositInstruction::AddTokenMapping { eth_token, sol_token_mint } => {
            process_add_token_mapping(program_id, accounts, eth_token, sol_token_mint)
        },
        DepositInstruction::RemoveTokenMapping { eth_token } => {
            process_remove_token_mapping(program_id, accounts, eth_token)
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
        total_deposits: 0,
    };
    
    // Serialize program state
    program_state.serialize(&mut *state_account.data.borrow_mut())?;
    
    Ok(())
}

/// Process deposit instruction
fn process_deposit(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    deposit: Deposit,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    
    let operator_account = next_account_info(account_info_iter)?;
    let state_account = next_account_info(account_info_iter)?;
    let deposit_account = next_account_info(account_info_iter)?;
    let recipient_token_account = next_account_info(account_info_iter)?;
    let token_mint = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;
    
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
    
    // Verify deposit hasn't been processed
    if deposit.processed {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Verify token mapping exists
    if !program_state.token_mapping.contains_key(&deposit.eth_token) {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Verify token mint matches mapping
    let expected_mint = program_state.token_mapping[&deposit.eth_token];
    if *token_mint.key != expected_mint {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Verify recipient matches
    if *recipient_token_account.key != deposit.sol_recipient {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Mint tokens to recipient
    // In a real implementation, we would call the token program to mint tokens
    // For now, we just log the mint operation
    msg!("Minting {} tokens to {}", deposit.amount, deposit.sol_recipient);
    
    // Mark deposit as processed
    let mut deposit_data = deposit.clone();
    deposit_data.processed = true;
    
    // Serialize deposit data
    deposit_data.serialize(&mut *deposit_account.data.borrow_mut())?;
    
    // Update program state
    program_state.total_deposits += 1;
    program_state.serialize(&mut *state_account.data.borrow_mut())?;
    
    Ok(())
}

/// Process add token mapping instruction
fn process_add_token_mapping(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    eth_token: [u8; 20],
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
    
    // Add token mapping
    program_state.token_mapping.insert(eth_token, sol_token_mint);
    
    // Serialize program state
    program_state.serialize(&mut *state_account.data.borrow_mut())?;
    
    Ok(())
}

/// Process remove token mapping instruction
fn process_remove_token_mapping(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
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
    
    // Remove token mapping
    program_state.token_mapping.remove(&eth_token);
    
    // Serialize program state
    program_state.serialize(&mut *state_account.data.borrow_mut())?;
    
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
