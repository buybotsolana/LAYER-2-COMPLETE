/**
 * Solana Layer 2 - NFT Mint Program
 * 
 * This program handles the minting, transferring, and burning of NFTs on Solana
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
    program::invoke_signed,
};
use spl_token::{
    state::{Account as TokenAccount, Mint},
    instruction::{initialize_mint, mint_to, burn},
};
use std::convert::TryInto;
use crate::error::{Layer2Error, return_layer2_error};

solana_program::declare_id!("NFTMint11111111111111111111111111111111111111");

#[derive(Debug)]
pub enum NFTInstruction {
    InitializeNFTCollection {
        ethereum_collection_address: [u8; 20],
        name: String,
        symbol: String,
    },
    
    MintNFT {
        token_id: u64,
        metadata_uri: String,
        ethereum_tx_hash: [u8; 32],
        nonce: u64,
    },
    
    TransferNFT {
        token_id: u64,
        new_owner: Pubkey,
    },
    
    BurnNFT {
        token_id: u64,
        ethereum_recipient: [u8; 20],
    },
}

#[derive(Debug)]
pub struct NFTCollectionState {
    pub is_initialized: bool,
    pub ethereum_collection_address: [u8; 20],
    pub name: String,
    pub symbol: String,
    pub authority: Pubkey,
    pub used_nonces: Vec<u64>,
    pub next_token_id: u64,
}

#[derive(Debug)]
pub struct NFTMetadata {
    pub is_initialized: bool,
    pub token_id: u64,
    pub collection: Pubkey,
    pub metadata_uri: String,
    pub mint: Pubkey,
    pub ethereum_token_id: u64,
    pub ethereum_tx_hash: [u8; 32],
}

impl NFTCollectionState {
    pub const LEN: usize = 1 + // is_initialized
                           20 + // ethereum_collection_address
                           64 + // name (max length)
                           16 + // symbol (max length)
                           32 + // authority
                           256 + // used_nonces (max 32 nonces)
                           8; // next_token_id
}

impl NFTMetadata {
    pub const LEN: usize = 1 + // is_initialized
                          8 + // token_id
                          32 + // collection
                          256 + // metadata_uri (max length)
                          32 + // mint
                          8 + // ethereum_token_id
                          32; // ethereum_tx_hash
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = parse_instruction(instruction_data)?;
    
    match instruction {
        NFTInstruction::InitializeNFTCollection { 
            ethereum_collection_address, 
            name, 
            symbol 
        } => {
            process_initialize_nft_collection(
                program_id, 
                accounts, 
                ethereum_collection_address,
                name,
                symbol,
            )
        },
        NFTInstruction::MintNFT { 
            token_id, 
            metadata_uri, 
            ethereum_tx_hash, 
            nonce 
        } => {
            process_mint_nft(
                program_id, 
                accounts, 
                token_id,
                metadata_uri,
                ethereum_tx_hash, 
                nonce,
            )
        },
        NFTInstruction::TransferNFT { 
            token_id, 
            new_owner 
        } => {
            process_transfer_nft(
                program_id, 
                accounts, 
                token_id, 
                new_owner,
            )
        },
        NFTInstruction::BurnNFT { 
            token_id, 
            ethereum_recipient 
        } => {
            process_burn_nft(
                program_id, 
                accounts, 
                token_id, 
                ethereum_recipient,
            )
        },
    }
}

fn parse_instruction(data: &[u8]) -> Result<NFTInstruction, ProgramError> {
    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    
    let instruction_type = data[0];
    
    match instruction_type {
        0 => {
            if data.len() < 22 {
                return Err(ProgramError::InvalidInstructionData);
            }
            
            let ethereum_collection_address: [u8; 20] = data[1..21].try_into().unwrap();
            
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
            if data.len() < symbol_len_pos + 1 + symbol_len {
                return Err(ProgramError::InvalidInstructionData);
            }
            let symbol = String::from_utf8(data[symbol_len_pos + 1..symbol_len_pos + 1 + symbol_len].to_vec())
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            
            Ok(NFTInstruction::InitializeNFTCollection {
                ethereum_collection_address,
                name,
                symbol,
            })
        },
        1 => {
            if data.len() < 9 {
                return Err(ProgramError::InvalidInstructionData);
            }
            
            let token_id = u64::from_le_bytes(data[1..9].try_into().unwrap());
            
            let uri_len_pos = 9;
            if data.len() <= uri_len_pos {
                return Err(ProgramError::InvalidInstructionData);
            }
            let uri_len = data[uri_len_pos] as usize;
            if data.len() < uri_len_pos + 1 + uri_len + 32 + 8 {
                return Err(ProgramError::InvalidInstructionData);
            }
            let metadata_uri = String::from_utf8(data[uri_len_pos + 1..uri_len_pos + 1 + uri_len].to_vec())
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            
            let eth_tx_pos = uri_len_pos + 1 + uri_len;
            let ethereum_tx_hash: [u8; 32] = data[eth_tx_pos..eth_tx_pos + 32].try_into().unwrap();
            
            let nonce_pos = eth_tx_pos + 32;
            let nonce = u64::from_le_bytes(data[nonce_pos..nonce_pos + 8].try_into().unwrap());
            
            Ok(NFTInstruction::MintNFT {
                token_id,
                metadata_uri,
                ethereum_tx_hash,
                nonce,
            })
        },
        2 => {
            if data.len() != 41 {
                return Err(ProgramError::InvalidInstructionData);
            }
            
            let token_id = u64::from_le_bytes(data[1..9].try_into().unwrap());
            let new_owner = Pubkey::new(&data[9..41]);
            
            Ok(NFTInstruction::TransferNFT {
                token_id,
                new_owner,
            })
        },
        3 => {
            if data.len() != 29 {
                return Err(ProgramError::InvalidInstructionData);
            }
            
            let token_id = u64::from_le_bytes(data[1..9].try_into().unwrap());
            let ethereum_recipient: [u8; 20] = data[9..29].try_into().unwrap();
            
            Ok(NFTInstruction::BurnNFT {
                token_id,
                ethereum_recipient,
            })
        },
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn process_initialize_nft_collection(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    ethereum_collection_address: [u8; 20],
    name: String,
    symbol: String,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    let initializer = next_account_info(accounts_iter)?;
    let collection_state_account = next_account_info(accounts_iter)?;
    let authority = next_account_info(accounts_iter)?;
    let rent_account = next_account_info(accounts_iter)?;
    
    if !initializer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    if collection_state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    let rent = Rent::from_account_info(rent_account)?;
    if !rent.is_exempt(collection_state_account.lamports(), NFTCollectionState::LEN) {
        return Err(ProgramError::AccountNotRentExempt);
    }
    
    let mut collection_data = collection_state_account.try_borrow_mut_data()?;
    
    if collection_data[0] != 0 {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    
    collection_data[0] = 1;
    
    collection_data[1..21].copy_from_slice(&ethereum_collection_address);
    
    msg!("Initialized NFT collection for Ethereum collection: {:?}", ethereum_collection_address);
    msg!("Name: {}, Symbol: {}", name, symbol);
    
    Ok(())
}

fn process_mint_nft(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: u64,
    metadata_uri: String,
    ethereum_tx_hash: [u8; 32],
    nonce: u64,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    let authority = next_account_info(accounts_iter)?;
    let collection_state_account = next_account_info(accounts_iter)?;
    let metadata_account = next_account_info(accounts_iter)?;
    let mint_account = next_account_info(accounts_iter)?;
    let destination_token_account = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;
    let rent_account = next_account_info(accounts_iter)?;
    
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    if collection_state_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    if metadata_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    let rent = Rent::from_account_info(rent_account)?;
    if !rent.is_exempt(mint_account.lamports(), Mint::LEN) {
        return Err(ProgramError::AccountNotRentExempt);
    }
    
    if !rent.is_exempt(metadata_account.lamports(), NFTMetadata::LEN) {
        return Err(ProgramError::AccountNotRentExempt);
    }
    
    msg!("Minting NFT with nonce: {}", nonce);
    
    let initialize_mint_ix = initialize_mint(
        token_program.key,
        mint_account.key,
        authority.key,
        Some(authority.key), // Freeze authority
        0, // 0 decimals for NFT
    )?;
    
    invoke(
        &initialize_mint_ix,
        &[
            mint_account.clone(),
            rent_account.clone(),
            token_program.clone(),
        ],
    )?;
    
    let mint_to_ix = mint_to(
        token_program.key,
        mint_account.key,
        destination_token_account.key,
        authority.key,
        &[],
        1, // Mint exactly 1 token for NFT
    )?;
    
    invoke(
        &mint_to_ix,
        &[
            mint_account.clone(),
            destination_token_account.clone(),
            authority.clone(),
            token_program.clone(),
        ],
    )?;
    
    let mut metadata_data = metadata_account.try_borrow_mut_data()?;
    
    if metadata_data[0] != 0 {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    
    metadata_data[0] = 1;
    
    msg!("Minted NFT with ID: {} from Ethereum tx: {:?}", token_id, ethereum_tx_hash);
    msg!("Metadata URI: {}", metadata_uri);
    
    Ok(())
}

fn process_transfer_nft(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: u64,
    new_owner: Pubkey,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    let owner = next_account_info(accounts_iter)?;
    let metadata_account = next_account_info(accounts_iter)?;
    let source_token_account = next_account_info(accounts_iter)?;
    let destination_token_account = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;
    
    if !owner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    if metadata_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    let token_account_data = TokenAccount::unpack(&source_token_account.data.borrow())?;
    if token_account_data.owner != *owner.key {
        return Err(ProgramError::InvalidAccountData);
    }
    
    msg!("Transferring NFT with ID: {} to new owner: {}", token_id, new_owner);
    
    let transfer_ix = spl_token::instruction::transfer(
        token_program.key,
        source_token_account.key,
        destination_token_account.key,
        owner.key,
        &[],
        1, // Transfer exactly 1 token for NFT
    )?;
    
    invoke(
        &transfer_ix,
        &[
            source_token_account.clone(),
            destination_token_account.clone(),
            owner.clone(),
            token_program.clone(),
        ],
    )?;
    
    Ok(())
}

fn process_burn_nft(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: u64,
    ethereum_recipient: [u8; 20],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    let owner = next_account_info(accounts_iter)?;
    let metadata_account = next_account_info(accounts_iter)?;
    let mint_account = next_account_info(accounts_iter)?;
    let source_token_account = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;
    
    if !owner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    if metadata_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    let token_account_data = TokenAccount::unpack(&source_token_account.data.borrow())?;
    if token_account_data.owner != *owner.key {
        return Err(ProgramError::InvalidAccountData);
    }
    
    msg!("Burning NFT with ID: {} for Ethereum recipient: {:?}", token_id, ethereum_recipient);
    
    let burn_ix = burn(
        token_program.key,
        source_token_account.key,
        mint_account.key,
        owner.key,
        &[],
        1, // Burn exactly 1 token for NFT
    )?;
    
    invoke(
        &burn_ix,
        &[
            source_token_account.clone(),
            mint_account.clone(),
            owner.clone(),
            token_program.clone(),
        ],
    )?;
    
    
    Ok(())
}
