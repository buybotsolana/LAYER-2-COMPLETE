/**
 * Solana Layer 2 - Wrapped Token Mint Program
 * 
 * This program handles the minting and burning of wrapped tokens on Solana
 * for the Ethereum-Solana Layer 2 bridge.
 */

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    program_pack::Pack,
    sysvar::{rent::Rent, Sysvar},
    program::invoke,
};
use spl_token::{
    state::{Account as TokenAccount, Mint},
    instruction::{initialize_mint, mint_to, burn},
};
use std::convert::TryInto;

// Define program ID
solana_program::declare_id!("WrappedTokenMint111111111111111111111111111");

// Instruction types
enum WrappedTokenInstruction {
    // Initialize a new wrapped token mint
    InitializeWrappedToken {
        // Original token address on Ethereum (20 bytes)
        ethereum_token_address: [u8; 20],
        // Token name
        name: String,
        // Token symbol
        symbol: String,
        // Token decimals
        decimals: u8,
    },
    
    // Mint wrapped tokens (from bridge)
    MintWrappedToken {
        // Amount to mint
        amount: u64,
        // Ethereum transaction hash
        ethereum_tx_hash: [u8; 32],
        // Nonce to prevent replay
        nonce: u64,
    },
    
    // Burn wrapped tokens (for withdrawal)
    BurnWrappedToken {
        // Amount to burn
        amount: u64,
        // Ethereum recipient address
        ethereum_recipient: [u8; 20],
    },
}

// Program state
#[derive(Debug)]
struct WrappedTokenState {
    // Is this account initialized
    is_initialized: bool,
    // Original token address on Ethereum
    ethereum_token_address: [u8; 20],
    // Wrapped token mint on Solana
    wrapped_mint: Pubkey,
    // Authority that can mint/burn tokens
    authority: Pubkey,
    // Used nonces to prevent replay attacks
    used_nonces: Vec<u64>,
}

// Program entry point
// entrypoint!(process_instruction); // Using the entrypoint in lib.rs instead

// Process instruction
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse instruction type
    let instruction = parse_instruction(instruction_data)?;
    
    match instruction {
        WrappedTokenInstruction::InitializeWrappedToken { 
            ethereum_token_address, 
            name, 
            symbol, 
            decimals 
        } => {
            process_initialize_wrapped_token(
                program_id, 
                accounts, 
                ethereum_token_address,
                name,
                symbol,
                decimals,
            )
        },
        WrappedTokenInstruction::MintWrappedToken { 
            amount, 
            ethereum_tx_hash, 
            nonce 
        } => {
            process_mint_wrapped_token(
                program_id, 
                accounts, 
                amount, 
                ethereum_tx_hash, 
                nonce,
            )
        },
        WrappedTokenInstruction::BurnWrappedToken { 
            amount, 
            ethereum_recipient 
        } => {
            process_burn_wrapped_token(
                program_id, 
                accounts, 
                amount, 
                ethereum_recipient,
            )
        },
    }
}

// Parse instruction data
fn parse_instruction(data: &[u8]) -> Result<WrappedTokenInstruction, ProgramError> {
    // First byte is the instruction type
    let instruction_type = data[0];
    
    match instruction_type {
        0 => {
            // Initialize wrapped token
            if data.len() < 22 {
                return Err(ProgramError::InvalidInstructionData);
            }
            
            let ethereum_token_address: [u8; 20] = data[1..21].try_into().unwrap();
            
            // Parse name, symbol, and decimals
            let name_len = data[21] as usize;
            if data.len() < 22 + name_len {
                return Err(ProgramError::InvalidInstructionData);
            }
            let name = String::from_utf8(data[22..22 + name_len].to_vec())
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            
            let symbol_len_pos = 22 + name_len;
            if data.len() <= symbol_len_pos {
                return Err(ProgramError::InvalidInstructionData);
            }
            let symbol_len = data[symbol_len_pos] as usize;
            if data.len() < symbol_len_pos + 1 + symbol_len + 1 {
                return Err(ProgramError::InvalidInstructionData);
            }
            let symbol = String::from_utf8(data[symbol_len_pos + 1..symbol_len_pos + 1 + symbol_len].to_vec())
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            
            let decimals_pos = symbol_len_pos + 1 + symbol_len;
            let decimals = data[decimals_pos];
            
            Ok(WrappedTokenInstruction::InitializeWrappedToken {
                ethereum_token_address,
                name,
                symbol,
                decimals,
            })
        },
        1 => {
            // Mint wrapped token
            if data.len() != 49 {
                return Err(ProgramError::InvalidInstructionData);
            }
            
            let amount = u64::from_le_bytes(data[1..9].try_into().unwrap());
            let ethereum_tx_hash: [u8; 32] = data[9..41].try_into().unwrap();
            let nonce = u64::from_le_bytes(data[41..49].try_into().unwrap());
            
            Ok(WrappedTokenInstruction::MintWrappedToken {
                amount,
                ethereum_tx_hash,
                nonce,
            })
        },
        2 => {
            // Burn wrapped token
            if data.len() != 29 {
                return Err(ProgramError::InvalidInstructionData);
            }
            
            let amount = u64::from_le_bytes(data[1..9].try_into().unwrap());
            let ethereum_recipient: [u8; 20] = data[9..29].try_into().unwrap();
            
            Ok(WrappedTokenInstruction::BurnWrappedToken {
                amount,
                ethereum_recipient,
            })
        },
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// Process initialize wrapped token instruction
fn process_initialize_wrapped_token(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    ethereum_token_address: [u8; 20],
    name: String,
    symbol: String,
    decimals: u8,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    // Get accounts
    let initializer = next_account_info(accounts_iter)?;
    let state_account = next_account_info(accounts_iter)?;
    let wrapped_mint = next_account_info(accounts_iter)?;
    let mint_authority = next_account_info(accounts_iter)?;
    let rent_account = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;
    
    // Check if initializer is a signer
    if !initializer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Check if state account is owned by this program
    if state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    // Check if wrapped mint is uninitialized
    let rent = Rent::from_account_info(rent_account)?;
    if !rent.is_exempt(wrapped_mint.lamports(), Mint::LEN) {
        return Err(ProgramError::AccountNotRentExempt);
    }
    
    // Initialize wrapped token mint
    let initialize_mint_ix = initialize_mint(
        token_program.key,
        wrapped_mint.key,
        mint_authority.key,
        Some(mint_authority.key), // Freeze authority
        decimals,
    )?;
    
    invoke(
        &initialize_mint_ix,
        &[
            wrapped_mint.clone(),
            rent_account.clone(),
            token_program.clone(),
        ],
    )?;
    
    // Initialize state account
    let _state_data = state_account.try_borrow_mut_data()?;
    let _state = WrappedTokenState {
        is_initialized: true,
        ethereum_token_address,
        wrapped_mint: *wrapped_mint.key,
        authority: *mint_authority.key,
        used_nonces: Vec::new(),
    };
    
    // Serialize state to account data
    // In a real implementation, we would use a proper serialization library
    // For simplicity, we'll just use a placeholder
    msg!("Initialized wrapped token for Ethereum token: {:?}", ethereum_token_address);
    msg!("Name: {}, Symbol: {}, Decimals: {}", name, symbol, decimals);
    
    Ok(())
}

// Process mint wrapped token instruction
fn process_mint_wrapped_token(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
    ethereum_tx_hash: [u8; 32],
    nonce: u64,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    // Get accounts
    let authority = next_account_info(accounts_iter)?;
    let state_account = next_account_info(accounts_iter)?;
    let wrapped_mint = next_account_info(accounts_iter)?;
    let recipient_token_account = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;
    
    // Check if authority is a signer
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Check if state account is owned by this program
    if state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    // Check if nonce has been used
    // In a real implementation, we would check against the state.used_nonces vector
    // For simplicity, we'll just log the nonce
    msg!("Minting with nonce: {}", nonce);
    
    // Mint tokens to recipient
    let mint_to_ix = mint_to(
        token_program.key,
        wrapped_mint.key,
        recipient_token_account.key,
        authority.key,
        &[],
        amount,
    )?;
    
    invoke(
        &mint_to_ix,
        &[
            wrapped_mint.clone(),
            recipient_token_account.clone(),
            authority.clone(),
            token_program.clone(),
        ],
    )?;
    
    msg!("Minted {} wrapped tokens from Ethereum tx: {:?}", amount, ethereum_tx_hash);
    
    Ok(())
}

// Process burn wrapped token instruction
fn process_burn_wrapped_token(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
    ethereum_recipient: [u8; 20],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    // Get accounts
    let owner = next_account_info(accounts_iter)?;
    let state_account = next_account_info(accounts_iter)?;
    let wrapped_mint = next_account_info(accounts_iter)?;
    let source_token_account = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;
    
    // Check if owner is a signer
    if !owner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Check if state account is owned by this program
    if state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    // Check if source token account belongs to owner
    let token_account_data = TokenAccount::unpack(&source_token_account.data.borrow())?;
    if token_account_data.owner != *owner.key {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Burn tokens
    let burn_ix = burn(
        token_program.key,
        source_token_account.key,
        wrapped_mint.key,
        owner.key,
        &[],
        amount,
    )?;
    
    invoke(
        &burn_ix,
        &[
            source_token_account.clone(),
            wrapped_mint.clone(),
            owner.clone(),
            token_program.clone(),
        ],
    )?;
    
    msg!("Burned {} wrapped tokens for Ethereum recipient: {:?}", amount, ethereum_recipient);
    
    Ok(())
}
