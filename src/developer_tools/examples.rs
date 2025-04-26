// src/developer_tools/examples.rs
//! Examples module for Layer-2 on Solana Developer Tools
//!
//! This module provides example code and applications to help developers
//! understand how to use the Layer-2 platform:
//! - Basic transaction examples
//! - Smart contract examples
//! - Integration examples
//! - End-to-end application examples
//! - Performance optimization examples
//!
//! These examples are designed to be educational and serve as starting points
//! for developers building on the platform.

use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    pubkey::Pubkey,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::fs;
use std::io;

/// Example category
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExampleCategory {
    /// Basic examples
    Basic,
    
    /// Smart contract examples
    SmartContract,
    
    /// Integration examples
    Integration,
    
    /// Application examples
    Application,
    
    /// Performance examples
    Performance,
}

/// Example metadata
#[derive(Debug, Clone)]
pub struct ExampleMetadata {
    /// Example ID
    pub id: String,
    
    /// Example name
    pub name: String,
    
    /// Example description
    pub description: String,
    
    /// Example category
    pub category: ExampleCategory,
    
    /// Example difficulty level (1-5)
    pub difficulty: u8,
    
    /// Example tags
    pub tags: Vec<String>,
    
    /// Example prerequisites
    pub prerequisites: Vec<String>,
    
    /// Example estimated completion time (minutes)
    pub estimated_time: u32,
    
    /// Example author
    pub author: String,
    
    /// Example creation date
    pub creation_date: String,
    
    /// Example last updated date
    pub last_updated: String,
}

/// Example code
#[derive(Debug, Clone)]
pub struct ExampleCode {
    /// Example ID
    pub id: String,
    
    /// Example files
    pub files: HashMap<String, String>,
    
    /// Example entry point
    pub entry_point: String,
    
    /// Example build command
    pub build_command: Option<String>,
    
    /// Example run command
    pub run_command: Option<String>,
    
    /// Example test command
    pub test_command: Option<String>,
}

/// Example repository
pub struct ExampleRepository {
    /// Examples metadata
    examples_metadata: HashMap<String, ExampleMetadata>,
    
    /// Examples code
    examples_code: HashMap<String, ExampleCode>,
    
    /// Base directory for examples
    base_dir: PathBuf,
    
    /// Whether the example repository is initialized
    initialized: bool,
}

impl ExampleRepository {
    /// Create a new example repository
    pub fn new(base_dir: &Path) -> Self {
        Self {
            examples_metadata: HashMap::new(),
            examples_code: HashMap::new(),
            base_dir: base_dir.to_path_buf(),
            initialized: false,
        }
    }
    
    /// Initialize the example repository
    pub fn initialize(&mut self) -> io::Result<()> {
        // Create base directory if it doesn't exist
        if !self.base_dir.exists() {
            fs::create_dir_all(&self.base_dir)?;
        }
        
        // Load examples from disk
        self.load_examples()?;
        
        self.initialized = true;
        
        msg!("Example repository initialized");
        
        Ok(())
    }
    
    /// Check if the example repository is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    
    /// Load examples from disk
    fn load_examples(&mut self) -> io::Result<()> {
        // Clear existing examples
        self.examples_metadata.clear();
        self.examples_code.clear();
        
        // Read example directories
        let entries = fs::read_dir(&self.base_dir)?;
        
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_dir() {
                // Check for metadata.json
                let metadata_path = path.join("metadata.json");
                if metadata_path.exists() {
                    let metadata_str = fs::read_to_string(metadata_path)?;
                    let metadata: serde_json::Value = serde_json::from_str(&metadata_str)?;
                    
                    // Extract metadata fields
                    let id = metadata["id"].as_str().unwrap_or("unknown").to_string();
                    let name = metadata["name"].as_str().unwrap_or("Unknown").to_string();
                    let description = metadata["description"].as_str().unwrap_or("").to_string();
                    
                    let category_str = metadata["category"].as_str().unwrap_or("basic");
                    let category = match category_str.to_lowercase().as_str() {
                        "smartcontract" => ExampleCategory::SmartContract,
                        "integration" => ExampleCategory::Integration,
                        "application" => ExampleCategory::Application,
                        "performance" => ExampleCategory::Performance,
                        _ => ExampleCategory::Basic,
                    };
                    
                    let difficulty = metadata["difficulty"].as_u64().unwrap_or(1) as u8;
                    
                    let tags = if let Some(tags_array) = metadata["tags"].as_array() {
                        tags_array.iter()
                            .filter_map(|v| v.as_str())
                            .map(|s| s.to_string())
                            .collect()
                    } else {
                        Vec::new()
                    };
                    
                    let prerequisites = if let Some(prereq_array) = metadata["prerequisites"].as_array() {
                        prereq_array.iter()
                            .filter_map(|v| v.as_str())
                            .map(|s| s.to_string())
                            .collect()
                    } else {
                        Vec::new()
                    };
                    
                    let estimated_time = metadata["estimated_time"].as_u64().unwrap_or(30) as u32;
                    let author = metadata["author"].as_str().unwrap_or("Unknown").to_string();
                    let creation_date = metadata["creation_date"].as_str().unwrap_or("Unknown").to_string();
                    let last_updated = metadata["last_updated"].as_str().unwrap_or("Unknown").to_string();
                    
                    // Create metadata object
                    let example_metadata = ExampleMetadata {
                        id: id.clone(),
                        name,
                        description,
                        category,
                        difficulty,
                        tags,
                        prerequisites,
                        estimated_time,
                        author,
                        creation_date,
                        last_updated,
                    };
                    
                    // Add metadata to repository
                    self.examples_metadata.insert(id.clone(), example_metadata);
                    
                    // Load code files
                    let mut files = HashMap::new();
                    let code_entries = fs::read_dir(&path)?;
                    
                    for code_entry in code_entries {
                        let code_entry = code_entry?;
                        let code_path = code_entry.path();
                        
                        if code_path.is_file() && code_path.file_name().unwrap_or_default() != "metadata.json" {
                            let file_name = code_path.file_name().unwrap_or_default().to_string_lossy().to_string();
                            let file_content = fs::read_to_string(code_path)?;
                            
                            files.insert(file_name, file_content);
                        }
                    }
                    
                    // Extract code metadata
                    let entry_point = metadata["entry_point"].as_str().unwrap_or("main.rs").to_string();
                    let build_command = metadata["build_command"].as_str().map(|s| s.to_string());
                    let run_command = metadata["run_command"].as_str().map(|s| s.to_string());
                    let test_command = metadata["test_command"].as_str().map(|s| s.to_string());
                    
                    // Create code object
                    let example_code = ExampleCode {
                        id: id.clone(),
                        files,
                        entry_point,
                        build_command,
                        run_command,
                        test_command,
                    };
                    
                    // Add code to repository
                    self.examples_code.insert(id, example_code);
                }
            }
        }
        
        Ok(())
    }
    
    /// Get all example metadata
    pub fn get_all_metadata(&self) -> Vec<&ExampleMetadata> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.examples_metadata.values().collect()
    }
    
    /// Get example metadata by ID
    pub fn get_metadata(&self, id: &str) -> Option<&ExampleMetadata> {
        if !self.initialized {
            return None;
        }
        
        self.examples_metadata.get(id)
    }
    
    /// Get example code by ID
    pub fn get_code(&self, id: &str) -> Option<&ExampleCode> {
        if !self.initialized {
            return None;
        }
        
        self.examples_code.get(id)
    }
    
    /// Get examples by category
    pub fn get_examples_by_category(&self, category: &ExampleCategory) -> Vec<&ExampleMetadata> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.examples_metadata.values()
            .filter(|m| m.category == *category)
            .collect()
    }
    
    /// Get examples by tag
    pub fn get_examples_by_tag(&self, tag: &str) -> Vec<&ExampleMetadata> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.examples_metadata.values()
            .filter(|m| m.tags.iter().any(|t| t == tag))
            .collect()
    }
    
    /// Get examples by difficulty range
    pub fn get_examples_by_difficulty(&self, min_difficulty: u8, max_difficulty: u8) -> Vec<&ExampleMetadata> {
        if !self.initialized {
            return Vec::new();
        }
        
        self.examples_metadata.values()
            .filter(|m| m.difficulty >= min_difficulty && m.difficulty <= max_difficulty)
            .collect()
    }
    
    /// Add a new example
    pub fn add_example(&mut self, metadata: ExampleMetadata, code: ExampleCode) -> io::Result<()> {
        if !self.initialized {
            return Err(io::Error::new(io::ErrorKind::Other, "Repository not initialized"));
        }
        
        // Ensure IDs match
        if metadata.id != code.id {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "Metadata ID and Code ID must match"));
        }
        
        let id = metadata.id.clone();
        
        // Create example directory
        let example_dir = self.base_dir.join(&id);
        fs::create_dir_all(&example_dir)?;
        
        // Write metadata file
        let metadata_json = serde_json::json!({
            "id": metadata.id,
            "name": metadata.name,
            "description": metadata.description,
            "category": format!("{:?}", metadata.category),
            "difficulty": metadata.difficulty,
            "tags": metadata.tags,
            "prerequisites": metadata.prerequisites,
            "estimated_time": metadata.estimated_time,
            "author": metadata.author,
            "creation_date": metadata.creation_date,
            "last_updated": metadata.last_updated,
            "entry_point": code.entry_point,
            "build_command": code.build_command,
            "run_command": code.run_command,
            "test_command": code.test_command,
        });
        
        let metadata_path = example_dir.join("metadata.json");
        fs::write(metadata_path, serde_json::to_string_pretty(&metadata_json)?)?;
        
        // Write code files
        for (file_name, file_content) in &code.files {
            let file_path = example_dir.join(file_name);
            fs::write(file_path, file_content)?;
        }
        
        // Add to repository
        self.examples_metadata.insert(id.clone(), metadata);
        self.examples_code.insert(id, code);
        
        Ok(())
    }
    
    /// Update an existing example
    pub fn update_example(&mut self, metadata: ExampleMetadata, code: ExampleCode) -> io::Result<()> {
        if !self.initialized {
            return Err(io::Error::new(io::ErrorKind::Other, "Repository not initialized"));
        }
        
        // Ensure IDs match
        if metadata.id != code.id {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "Metadata ID and Code ID must match"));
        }
        
        let id = metadata.id.clone();
        
        // Check if example exists
        if !self.examples_metadata.contains_key(&id) {
            return Err(io::Error::new(io::ErrorKind::NotFound, "Example not found"));
        }
        
        // Update example directory
        let example_dir = self.base_dir.join(&id);
        
        // Write metadata file
        let metadata_json = serde_json::json!({
            "id": metadata.id,
            "name": metadata.name,
            "description": metadata.description,
            "category": format!("{:?}", metadata.category),
            "difficulty": metadata.difficulty,
            "tags": metadata.tags,
            "prerequisites": metadata.prerequisites,
            "estimated_time": metadata.estimated_time,
            "author": metadata.author,
            "creation_date": metadata.creation_date,
            "last_updated": metadata.last_updated,
            "entry_point": code.entry_point,
            "build_command": code.build_command,
            "run_command": code.run_command,
            "test_command": code.test_command,
        });
        
        let metadata_path = example_dir.join("metadata.json");
        fs::write(metadata_path, serde_json::to_string_pretty(&metadata_json)?)?;
        
        // Remove old code files
        let entries = fs::read_dir(&example_dir)?;
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_file() && path.file_name().unwrap_or_default() != "metadata.json" {
                fs::remove_file(path)?;
            }
        }
        
        // Write new code files
        for (file_name, file_content) in &code.files {
            let file_path = example_dir.join(file_name);
            fs::write(file_path, file_content)?;
        }
        
        // Update repository
        self.examples_metadata.insert(id.clone(), metadata);
        self.examples_code.insert(id, code);
        
        Ok(())
    }
    
    /// Remove an example
    pub fn remove_example(&mut self, id: &str) -> io::Result<()> {
        if !self.initialized {
            return Err(io::Error::new(io::ErrorKind::Other, "Repository not initialized"));
        }
        
        // Check if example exists
        if !self.examples_metadata.contains_key(id) {
            return Err(io::Error::new(io::ErrorKind::NotFound, "Example not found"));
        }
        
        // Remove example directory
        let example_dir = self.base_dir.join(id);
        fs::remove_dir_all(example_dir)?;
        
        // Remove from repository
        self.examples_metadata.remove(id);
        self.examples_code.remove(id);
        
        Ok(())
    }
}

/// Basic transaction example
pub fn basic_transaction_example() -> &'static str {
    r#"
// Basic Transaction Example
// This example demonstrates how to create and submit a basic transaction on the Layer-2 network

use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    pubkey::Pubkey,
};
use solana_sdk::{
    signature::{Keypair, Signer},
    transaction::Transaction,
    transport::TransportError,
};
use layer2_solana::{
    client::Layer2Client,
    transaction::Layer2Transaction,
};

fn main() -> Result<(), TransportError> {
    // Initialize Layer-2 client
    let client = Layer2Client::new("https://api.layer2-solana.com");
    
    // Create a new keypair for the sender
    let sender = Keypair::new();
    
    // Get the recipient's public key
    let recipient = Pubkey::new_unique();
    
    // Create a new transaction
    let mut transaction = Layer2Transaction::new();
    
    // Add a transfer instruction
    transaction.add_transfer(
        &sender.pubkey(),
        &recipient,
        1_000_000, // 0.001 SOL in lamports
    );
    
    // Sign and submit the transaction
    let signature = client.send_transaction(&transaction, &[&sender])?;
    
    // Print the transaction signature
    println!("Transaction submitted: {}", signature);
    
    // Wait for confirmation
    client.confirm_transaction(&signature)?;
    
    println!("Transaction confirmed!");
    
    Ok(())
}
"#
}

/// Smart contract example
pub fn smart_contract_example() -> &'static str {
    r#"
// Smart Contract Example
// This example demonstrates how to create a simple token contract on the Layer-2 network

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use std::mem::size_of;

// Define the token account structure
#[repr(C)]
pub struct TokenAccount {
    pub owner: Pubkey,
    pub balance: u64,
}

// Program entrypoint
entrypoint!(process_instruction);

// Process instruction function
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Get the instruction code from the instruction data
    let instruction_code = instruction_data.get(0).ok_or(ProgramError::InvalidInstructionData)?;
    
    match instruction_code {
        // Initialize a new token account
        0 => {
            msg!("Instruction: Initialize Token Account");
            initialize_token_account(program_id, accounts, instruction_data)
        },
        // Transfer tokens
        1 => {
            msg!("Instruction: Transfer Tokens");
            transfer_tokens(program_id, accounts, instruction_data)
        },
        // Mint tokens
        2 => {
            msg!("Instruction: Mint Tokens");
            mint_tokens(program_id, accounts, instruction_data)
        },
        // Burn tokens
        3 => {
            msg!("Instruction: Burn Tokens");
            burn_tokens(program_id, accounts, instruction_data)
        },
        // Unknown instruction
        _ => {
            msg!("Error: Unknown instruction");
            Err(ProgramError::InvalidInstructionData)
        }
    }
}

// Initialize a new token account
fn initialize_token_account(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // Get account iterator
    let account_info_iter = &mut accounts.iter();
    
    // Get accounts
    let token_account = next_account_info(account_info_iter)?;
    let owner = next_account_info(account_info_iter)?;
    
    // Check if the token account is owned by the program
    if token_account.owner != program_id {
        msg!("Error: Token account is not owned by the program");
        return Err(ProgramError::IncorrectProgramId);
    }
    
    // Check if the owner signed the transaction
    if !owner.is_signer {
        msg!("Error: Owner did not sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Initialize the token account
    let token_account_data = TokenAccount {
        owner: *owner.key,
        balance: 0,
    };
    
    // Serialize the token account data
    let mut data = token_account.try_borrow_mut_data()?;
    let bytes = bytemuck::bytes_of(&token_account_data);
    data[..bytes.len()].copy_from_slice(bytes);
    
    msg!("Token account initialized");
    
    Ok(())
}

// Transfer tokens
fn transfer_tokens(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Get account iterator
    let account_info_iter = &mut accounts.iter();
    
    // Get accounts
    let source_account = next_account_info(account_info_iter)?;
    let destination_account = next_account_info(account_info_iter)?;
    let owner = next_account_info(account_info_iter)?;
    
    // Check if the source account is owned by the program
    if source_account.owner != program_id {
        msg!("Error: Source account is not owned by the program");
        return Err(ProgramError::IncorrectProgramId);
    }
    
    // Check if the destination account is owned by the program
    if destination_account.owner != program_id {
        msg!("Error: Destination account is not owned by the program");
        return Err(ProgramError::IncorrectProgramId);
    }
    
    // Check if the owner signed the transaction
    if !owner.is_signer {
        msg!("Error: Owner did not sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Get the amount to transfer
    let amount = u64::from_le_bytes(
        instruction_data.get(1..9)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?
    );
    
    // Get the source account data
    let mut source_data = source_account.try_borrow_mut_data()?;
    let mut source_account_data: TokenAccount = bytemuck::pod_from_bytes(&source_data).clone();
    
    // Check if the owner is the owner of the source account
    if source_account_data.owner != *owner.key {
        msg!("Error: Owner is not the owner of the source account");
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Check if the source account has enough balance
    if source_account_data.balance < amount {
        msg!("Error: Insufficient balance");
        return Err(ProgramError::InsufficientFunds);
    }
    
    // Get the destination account data
    let mut dest_data = destination_account.try_borrow_mut_data()?;
    let mut dest_account_data: TokenAccount = bytemuck::pod_from_bytes(&dest_data).clone();
    
    // Update balances
    source_account_data.balance -= amount;
    dest_account_data.balance += amount;
    
    // Serialize the updated account data
    let source_bytes = bytemuck::bytes_of(&source_account_data);
    source_data[..source_bytes.len()].copy_from_slice(source_bytes);
    
    let dest_bytes = bytemuck::bytes_of(&dest_account_data);
    dest_data[..dest_bytes.len()].copy_from_slice(dest_bytes);
    
    msg!("Tokens transferred");
    
    Ok(())
}

// Mint tokens
fn mint_tokens(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Get account iterator
    let account_info_iter = &mut accounts.iter();
    
    // Get accounts
    let token_account = next_account_info(account_info_iter)?;
    let mint_authority = next_account_info(account_info_iter)?;
    
    // Check if the token account is owned by the program
    if token_account.owner != program_id {
        msg!("Error: Token account is not owned by the program");
        return Err(ProgramError::IncorrectProgramId);
    }
    
    // Check if the mint authority signed the transaction
    if !mint_authority.is_signer {
        msg!("Error: Mint authority did not sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Get the amount to mint
    let amount = u64::from_le_bytes(
        instruction_data.get(1..9)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?
    );
    
    // Get the token account data
    let mut data = token_account.try_borrow_mut_data()?;
    let mut token_account_data: TokenAccount = bytemuck::pod_from_bytes(&data).clone();
    
    // Update balance
    token_account_data.balance += amount;
    
    // Serialize the updated account data
    let bytes = bytemuck::bytes_of(&token_account_data);
    data[..bytes.len()].copy_from_slice(bytes);
    
    msg!("Tokens minted");
    
    Ok(())
}

// Burn tokens
fn burn_tokens(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Get account iterator
    let account_info_iter = &mut accounts.iter();
    
    // Get accounts
    let token_account = next_account_info(account_info_iter)?;
    let owner = next_account_info(account_info_iter)?;
    
    // Check if the token account is owned by the program
    if token_account.owner != program_id {
        msg!("Error: Token account is not owned by the program");
        return Err(ProgramError::IncorrectProgramId);
    }
    
    // Check if the owner signed the transaction
    if !owner.is_signer {
        msg!("Error: Owner did not sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Get the amount to burn
    let amount = u64::from_le_bytes(
        instruction_data.get(1..9)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?
    );
    
    // Get the token account data
    let mut data = token_account.try_borrow_mut_data()?;
    let mut token_account_data: TokenAccount = bytemuck::pod_from_bytes(&data).clone();
    
    // Check if the owner is the owner of the token account
    if token_account_data.owner != *owner.key {
        msg!("Error: Owner is not the owner of the token account");
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Check if the token account has enough balance
    if token_account_data.balance < amount {
        msg!("Error: Insufficient balance");
        return Err(ProgramError::InsufficientFunds);
    }
    
    // Update balance
    token_account_data.balance -= amount;
    
    // Serialize the updated account data
    let bytes = bytemuck::bytes_of(&token_account_data);
    data[..bytes.len()].copy_from_slice(bytes);
    
    msg!("Tokens burned");
    
    Ok(())
}
"#
}

/// Integration example
pub fn integration_example() -> &'static str {
    r#"
// Integration Example
// This example demonstrates how to integrate with other protocols on the Layer-2 network

use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    pubkey::Pubkey,
};
use solana_sdk::{
    signature::{Keypair, Signer},
    transaction::Transaction,
    transport::TransportError,
};
use layer2_solana::{
    client::Layer2Client,
    transaction::Layer2Transaction,
    bridge::BridgeClient,
    interoperability::CrossChainMessage,
};

fn main() -> Result<(), TransportError> {
    // Initialize Layer-2 client
    let client = Layer2Client::new("https://api.layer2-solana.com");
    
    // Initialize bridge client
    let bridge_client = BridgeClient::new(&client);
    
    // Create a new keypair for the sender
    let sender = Keypair::new();
    
    // Step 1: Bridge assets from Ethereum to Solana Layer-2
    println!("Step 1: Bridging assets from Ethereum to Solana Layer-2");
    
    // Define the Ethereum token address
    let eth_token_address = "0x1234567890123456789012345678901234567890";
    
    // Define the amount to bridge
    let amount = 1_000_000_000; // 1 token with 9 decimals
    
    // Bridge the assets
    let bridge_signature = bridge_client.bridge_from_ethereum(
        eth_token_address,
        amount,
        &sender.pubkey(),
        &sender,
    )?;
    
    println!("Bridge transaction submitted: {}", bridge_signature);
    
    // Wait for confirmation
    client.confirm_transaction(&bridge_signature)?;
    
    println!("Bridge transaction confirmed!");
    
    // Step 2: Interact with a DeFi protocol on Layer-2
    println!("Step 2: Interacting with a DeFi protocol on Layer-2");
    
    // Define the DeFi protocol program ID
    let defi_program_id = Pubkey::new_unique();
    
    // Create a new transaction
    let mut transaction = Layer2Transaction::new();
    
    // Add an instruction to deposit into the DeFi protocol
    transaction.add_instruction(
        defi_program_id,
        &[
            0, // Instruction code for deposit
            // Amount to deposit (little-endian bytes)
            (amount & 0xFF) as u8,
            ((amount >> 8) & 0xFF) as u8,
            ((amount >> 16) & 0xFF) as u8,
            ((amount >> 24) & 0xFF) as u8,
            ((amount >> 32) & 0xFF) as u8,
            ((amount >> 40) & 0xFF) as u8,
            ((amount >> 48) & 0xFF) as u8,
            ((amount >> 56) & 0xFF) as u8,
        ],
        vec![
            AccountInfo::new(
                &sender.pubkey(),
                true,
                false,
                &mut 0,
                &mut [],
                &defi_program_id,
                false,
                0,
            ),
            // Add other required accounts
        ],
    );
    
    // Sign and submit the transaction
    let defi_signature = client.send_transaction(&transaction, &[&sender])?;
    
    println!("DeFi transaction submitted: {}", defi_signature);
    
    // Wait for confirmation
    client.confirm_transaction(&defi_signature)?;
    
    println!("DeFi transaction confirmed!");
    
    // Step 3: Send a cross-chain message to another blockchain
    println!("Step 3: Sending a cross-chain message to another blockchain");
    
    // Create a cross-chain message
    let message = CrossChainMessage {
        source_chain: "solana-layer2".to_string(),
        destination_chain: "ethereum".to_string(),
        sender: sender.pubkey().to_string(),
        recipient: "0x9876543210987654321098765432109876543210".to_string(),
        data: vec![1, 2, 3, 4, 5],
        gas_limit: 100000,
    };
    
    // Send the cross-chain message
    let message_signature = client.send_cross_chain_message(&message, &sender)?;
    
    println!("Cross-chain message submitted: {}", message_signature);
    
    // Wait for confirmation
    client.confirm_transaction(&message_signature)?;
    
    println!("Cross-chain message confirmed!");
    
    Ok(())
}
"#
}

/// Application example
pub fn application_example() -> &'static str {
    r#"
// Application Example
// This example demonstrates how to build a complete decentralized application on the Layer-2 network

use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    pubkey::Pubkey,
};
use solana_sdk::{
    signature::{Keypair, Signer},
    transaction::Transaction,
    transport::TransportError,
};
use layer2_solana::{
    client::Layer2Client,
    transaction::Layer2Transaction,
    storage::StorageClient,
};
use std::collections::HashMap;
use std::error::Error;
use std::io;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tokio::time::{sleep, Duration};
use warp::Filter;

// Define the application state
struct AppState {
    client: Layer2Client,
    storage: StorageClient,
    admin_keypair: Keypair,
    users: HashMap<String, UserInfo>,
}

// Define user information
struct UserInfo {
    pubkey: Pubkey,
    balance: u64,
    last_active: u64,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Initialize Layer-2 client
    let client = Layer2Client::new("https://api.layer2-solana.com");
    
    // Initialize storage client
    let storage = StorageClient::new(&client);
    
    // Create admin keypair
    let admin_keypair = Keypair::new();
    
    // Initialize application state
    let state = Arc::new(Mutex::new(AppState {
        client,
        storage,
        admin_keypair,
        users: HashMap::new(),
    }));
    
    // Clone state for routes
    let state_filter = warp::any().map(move || state.clone());
    
    // Define API routes
    let register = warp::post()
        .and(warp::path("register"))
        .and(warp::body::json())
        .and(state_filter.clone())
        .and_then(handle_register);
    
    let deposit = warp::post()
        .and(warp::path("deposit"))
        .and(warp::body::json())
        .and(state_filter.clone())
        .and_then(handle_deposit);
    
    let withdraw = warp::post()
        .and(warp::path("withdraw"))
        .and(warp::body::json())
        .and(state_filter.clone())
        .and_then(handle_withdraw);
    
    let get_user = warp::get()
        .and(warp::path("user"))
        .and(warp::path::param::<String>())
        .and(state_filter.clone())
        .and_then(handle_get_user);
    
    let routes = register
        .or(deposit)
        .or(withdraw)
        .or(get_user)
        .with(warp::cors().allow_any_origin());
    
    // Start background tasks
    let state_clone = state.clone();
    tokio::spawn(async move {
        update_user_activity(state_clone).await;
    });
    
    let state_clone = state.clone();
    tokio::spawn(async move {
        cleanup_inactive_users(state_clone).await;
    });
    
    // Start the server
    println!("Starting server on 0.0.0.0:3030");
    warp::serve(routes).run(([0, 0, 0, 0], 3030)).await;
    
    Ok(())
}

// Handle user registration
async fn handle_register(
    body: HashMap<String, String>,
    state: Arc<Mutex<AppState>>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let username = body.get("username").cloned().unwrap_or_default();
    let pubkey_str = body.get("pubkey").cloned().unwrap_or_default();
    
    if username.is_empty() || pubkey_str.is_empty() {
        return Ok(warp::reply::json(&HashMap::from([
            ("success", false),
            ("error", "Username and pubkey are required"),
        ])));
    }
    
    // Parse public key
    let pubkey = match Pubkey::from_str(&pubkey_str) {
        Ok(pubkey) => pubkey,
        Err(_) => {
            return Ok(warp::reply::json(&HashMap::from([
                ("success", false),
                ("error", "Invalid pubkey format"),
            ])));
        }
    };
    
    // Update state
    let mut state = state.lock().unwrap();
    
    // Check if username already exists
    if state.users.contains_key(&username) {
        return Ok(warp::reply::json(&HashMap::from([
            ("success", false),
            ("error", "Username already exists"),
        ])));
    }
    
    // Add user
    state.users.insert(username.clone(), UserInfo {
        pubkey,
        balance: 0,
        last_active: now(),
    });
    
    // Store user data on-chain
    let storage_result = state.storage.store(
        &format!("user:{}", username),
        &serde_json::to_string(&HashMap::from([
            ("pubkey", pubkey_str),
            ("registered_at", now().to_string()),
        ]))?,
        &state.admin_keypair,
    );
    
    match storage_result {
        Ok(signature) => {
            println!("User data stored on-chain: {}", signature);
        },
        Err(e) => {
            println!("Failed to store user data on-chain: {}", e);
        }
    }
    
    Ok(warp::reply::json(&HashMap::from([
        ("success", true),
        ("message", "User registered successfully"),
    ])))
}

// Handle deposit
async fn handle_deposit(
    body: HashMap<String, String>,
    state: Arc<Mutex<AppState>>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let username = body.get("username").cloned().unwrap_or_default();
    let amount_str = body.get("amount").cloned().unwrap_or_default();
    let signature = body.get("signature").cloned().unwrap_or_default();
    
    if username.is_empty() || amount_str.is_empty() || signature.is_empty() {
        return Ok(warp::reply::json(&HashMap::from([
            ("success", false),
            ("error", "Username, amount, and signature are required"),
        ])));
    }
    
    // Parse amount
    let amount = match amount_str.parse::<u64>() {
        Ok(amount) => amount,
        Err(_) => {
            return Ok(warp::reply::json(&HashMap::from([
                ("success", false),
                ("error", "Invalid amount format"),
            ])));
        }
    };
    
    // Update state
    let mut state = state.lock().unwrap();
    
    // Check if user exists
    let user = match state.users.get_mut(&username) {
        Some(user) => user,
        None => {
            return Ok(warp::reply::json(&HashMap::from([
                ("success", false),
                ("error", "User not found"),
            ])));
        }
    };
    
    // Verify the transaction
    let verify_result = state.client.verify_transaction(&signature);
    
    match verify_result {
        Ok(true) => {
            // Update user balance
            user.balance += amount;
            user.last_active = now();
            
            Ok(warp::reply::json(&HashMap::from([
                ("success", true),
                ("message", "Deposit successful"),
                ("new_balance", user.balance.to_string()),
            ])))
        },
        Ok(false) => {
            Ok(warp::reply::json(&HashMap::from([
                ("success", false),
                ("error", "Transaction verification failed"),
            ])))
        },
        Err(e) => {
            Ok(warp::reply::json(&HashMap::from([
                ("success", false),
                ("error", format!("Transaction verification error: {}", e)),
            ])))
        }
    }
}

// Handle withdrawal
async fn handle_withdraw(
    body: HashMap<String, String>,
    state: Arc<Mutex<AppState>>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let username = body.get("username").cloned().unwrap_or_default();
    let amount_str = body.get("amount").cloned().unwrap_or_default();
    let destination = body.get("destination").cloned().unwrap_or_default();
    
    if username.is_empty() || amount_str.is_empty() || destination.is_empty() {
        return Ok(warp::reply::json(&HashMap::from([
            ("success", false),
            ("error", "Username, amount, and destination are required"),
        ])));
    }
    
    // Parse amount
    let amount = match amount_str.parse::<u64>() {
        Ok(amount) => amount,
        Err(_) => {
            return Ok(warp::reply::json(&HashMap::from([
                ("success", false),
                ("error", "Invalid amount format"),
            ])));
        }
    };
    
    // Parse destination public key
    let destination_pubkey = match Pubkey::from_str(&destination) {
        Ok(pubkey) => pubkey,
        Err(_) => {
            return Ok(warp::reply::json(&HashMap::from([
                ("success", false),
                ("error", "Invalid destination pubkey format"),
            ])));
        }
    };
    
    // Update state
    let mut state = state.lock().unwrap();
    
    // Check if user exists
    let user = match state.users.get_mut(&username) {
        Some(user) => user,
        Err(_) => {
            return Ok(warp::reply::json(&HashMap::from([
                ("success", false),
                ("error", "User not found"),
            ])));
        }
    };
    
    // Check if user has enough balance
    if user.balance < amount {
        return Ok(warp::reply::json(&HashMap::from([
            ("success", false),
            ("error", "Insufficient balance"),
        ])));
    }
    
    // Create a new transaction
    let mut transaction = Layer2Transaction::new();
    
    // Add a transfer instruction
    transaction.add_transfer(
        &state.admin_keypair.pubkey(),
        &destination_pubkey,
        amount,
    );
    
    // Sign and submit the transaction
    let result = state.client.send_transaction(&transaction, &[&state.admin_keypair]);
    
    match result {
        Ok(signature) => {
            // Update user balance
            user.balance -= amount;
            user.last_active = now();
            
            Ok(warp::reply::json(&HashMap::from([
                ("success", true),
                ("message", "Withdrawal successful"),
                ("signature", signature),
                ("new_balance", user.balance.to_string()),
            ])))
        },
        Err(e) => {
            Ok(warp::reply::json(&HashMap::from([
                ("success", false),
                ("error", format!("Transaction error: {}", e)),
            ])))
        }
    }
}

// Handle get user
async fn handle_get_user(
    username: String,
    state: Arc<Mutex<AppState>>,
) -> Result<impl warp::Reply, warp::Rejection> {
    // Get state
    let state = state.lock().unwrap();
    
    // Check if user exists
    let user = match state.users.get(&username) {
        Some(user) => user,
        None => {
            return Ok(warp::reply::json(&HashMap::from([
                ("success", false),
                ("error", "User not found"),
            ])));
        }
    };
    
    Ok(warp::reply::json(&HashMap::from([
        ("success", true),
        ("username", username),
        ("pubkey", user.pubkey.to_string()),
        ("balance", user.balance.to_string()),
        ("last_active", user.last_active.to_string()),
    ])))
}

// Update user activity
async fn update_user_activity(state: Arc<Mutex<AppState>>) {
    loop {
        sleep(Duration::from_secs(60)).await;
        
        let mut state = state.lock().unwrap();
        
        for user in state.users.values_mut() {
            // Simulate some activity
            if rand::random::<f64>() < 0.1 {
                user.last_active = now();
                println!("User {} activity updated", user.pubkey);
            }
        }
    }
}

// Cleanup inactive users
async fn cleanup_inactive_users(state: Arc<Mutex<AppState>>) {
    loop {
        sleep(Duration::from_secs(3600)).await; // Run every hour
        
        let mut state = state.lock().unwrap();
        let current_time = now();
        
        // Find inactive users (inactive for more than 30 days)
        let inactive_threshold = 30 * 24 * 60 * 60; // 30 days in seconds
        let inactive_users: Vec<String> = state.users.iter()
            .filter(|(_, user)| current_time - user.last_active > inactive_threshold)
            .map(|(username, _)| username.clone())
            .collect();
        
        // Remove inactive users
        for username in inactive_users {
            println!("Removing inactive user: {}", username);
            state.users.remove(&username);
        }
    }
}

// Get current timestamp
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
"#
}

/// Performance example
pub fn performance_example() -> &'static str {
    r#"
// Performance Example
// This example demonstrates how to optimize performance on the Layer-2 network

use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    pubkey::Pubkey,
};
use solana_sdk::{
    signature::{Keypair, Signer},
    transaction::Transaction,
    transport::TransportError,
};
use layer2_solana::{
    client::Layer2Client,
    transaction::Layer2Transaction,
    batch::BatchProcessor,
    parallel::ParallelExecutor,
    optimization::TransactionOptimizer,
};
use std::error::Error;
use std::time::{Duration, Instant};
use rayon::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Initialize Layer-2 client
    let client = Layer2Client::new("https://api.layer2-solana.com");
    
    // Create a new keypair for the sender
    let sender = Keypair::new();
    
    // Fund the sender account for testing
    println!("Funding sender account for testing...");
    client.request_airdrop(&sender.pubkey(), 1_000_000_000)?;
    
    // Wait for confirmation
    sleep(Duration::from_secs(2)).await;
    
    // Example 1: Basic Transaction
    println!("\nExample 1: Basic Transaction");
    let start = Instant::now();
    
    let recipient = Pubkey::new_unique();
    
    let mut transaction = Layer2Transaction::new();
    transaction.add_transfer(
        &sender.pubkey(),
        &recipient,
        1_000_000,
    );
    
    let signature = client.send_transaction(&transaction, &[&sender])?;
    client.confirm_transaction(&signature)?;
    
    println!("Basic transaction completed in {:?}", start.elapsed());
    
    // Example 2: Batch Processing
    println!("\nExample 2: Batch Processing");
    let start = Instant::now();
    
    // Create a batch processor
    let mut batch_processor = BatchProcessor::new(&client);
    
    // Add multiple transfers to the batch
    for _ in 0..10 {
        let recipient = Pubkey::new_unique();
        batch_processor.add_transfer(
            &sender.pubkey(),
            &recipient,
            100_000,
            &sender,
        )?;
    }
    
    // Process the batch
    let results = batch_processor.process()?;
    
    println!("Batch processing completed in {:?}", start.elapsed());
    println!("Processed {} transactions", results.len());
    
    // Example 3: Parallel Execution
    println!("\nExample 3: Parallel Execution");
    let start = Instant::now();
    
    // Create a parallel executor
    let parallel_executor = ParallelExecutor::new(&client, 4); // 4 threads
    
    // Create multiple transactions
    let mut transactions = Vec::new();
    for _ in 0..20 {
        let recipient = Pubkey::new_unique();
        
        let mut transaction = Layer2Transaction::new();
        transaction.add_transfer(
            &sender.pubkey(),
            &recipient,
            50_000,
        );
        
        transactions.push((transaction, vec![&sender]));
    }
    
    // Execute transactions in parallel
    let results = parallel_executor.execute(transactions)?;
    
    println!("Parallel execution completed in {:?}", start.elapsed());
    println!("Processed {} transactions", results.len());
    
    // Example 4: Transaction Optimization
    println!("\nExample 4: Transaction Optimization");
    let start = Instant::now();
    
    // Create a transaction optimizer
    let optimizer = TransactionOptimizer::new();
    
    // Create a complex transaction
    let mut transaction = Layer2Transaction::new();
    
    // Add multiple instructions
    for _ in 0..5 {
        let recipient = Pubkey::new_unique();
        transaction.add_transfer(
            &sender.pubkey(),
            &recipient,
            20_000,
        );
    }
    
    // Optimize the transaction
    let optimized_transaction = optimizer.optimize(transaction)?;
    
    // Send the optimized transaction
    let signature = client.send_transaction(&optimized_transaction, &[&sender])?;
    client.confirm_transaction(&signature)?;
    
    println!("Optimized transaction completed in {:?}", start.elapsed());
    
    // Example 5: Compute Budget Optimization
    println!("\nExample 5: Compute Budget Optimization");
    let start = Instant::now();
    
    // Create a transaction with compute budget instruction
    let mut transaction = Layer2Transaction::new();
    
    // Add compute budget instruction to request higher compute limit
    transaction.add_compute_budget_instruction(200_000, 1)?;
    
    // Add a complex instruction that requires more compute
    let recipient = Pubkey::new_unique();
    transaction.add_transfer_with_memo(
        &sender.pubkey(),
        &recipient,
        10_000,
        "This is a test memo with additional data to increase instruction complexity",
    )?;
    
    // Send the transaction
    let signature = client.send_transaction(&transaction, &[&sender])?;
    client.confirm_transaction(&signature)?;
    
    println!("Compute budget optimized transaction completed in {:?}", start.elapsed());
    
    // Example 6: Versioned Transactions
    println!("\nExample 6: Versioned Transactions");
    let start = Instant::now();
    
    // Create a versioned transaction (v0)
    let mut transaction = Layer2Transaction::new_versioned(0);
    
    // Add a transfer instruction
    let recipient = Pubkey::new_unique();
    transaction.add_transfer(
        &sender.pubkey(),
        &recipient,
        5_000,
    );
    
    // Send the versioned transaction
    let signature = client.send_versioned_transaction(&transaction, &[&sender])?;
    client.confirm_transaction(&signature)?;
    
    println!("Versioned transaction completed in {:?}", start.elapsed());
    
    // Example 7: Address Lookup Tables
    println!("\nExample 7: Address Lookup Tables");
    let start = Instant::now();
    
    // Create an address lookup table
    let lookup_table_address = client.create_address_lookup_table(&sender, 10)?;
    
    // Wait for confirmation
    sleep(Duration::from_secs(2)).await;
    
    // Add addresses to the lookup table
    let addresses: Vec<Pubkey> = (0..10).map(|_| Pubkey::new_unique()).collect();
    client.extend_address_lookup_table(&lookup_table_address, &addresses, &sender)?;
    
    // Wait for confirmation
    sleep(Duration::from_secs(2)).await;
    
    // Create a transaction using the address lookup table
    let mut transaction = Layer2Transaction::new_with_lookup_tables(vec![lookup_table_address]);
    
    // Add transfer instructions using addresses from the lookup table
    for address in &addresses {
        transaction.add_transfer(
            &sender.pubkey(),
            address,
            1_000,
        );
    }
    
    // Send the transaction
    let signature = client.send_transaction_with_lookup_tables(&transaction, &[&sender])?;
    client.confirm_transaction(&signature)?;
    
    println!("Address lookup table transaction completed in {:?}", start.elapsed());
    
    // Example 8: Priority Fee Optimization
    println!("\nExample 8: Priority Fee Optimization");
    let start = Instant::now();
    
    // Create a transaction with priority fee
    let mut transaction = Layer2Transaction::new();
    
    // Add priority fee instruction
    transaction.add_priority_fee_instruction(10_000)?;
    
    // Add a transfer instruction
    let recipient = Pubkey::new_unique();
    transaction.add_transfer(
        &sender.pubkey(),
        &recipient,
        1_000,
    );
    
    // Send the transaction
    let signature = client.send_transaction(&transaction, &[&sender])?;
    client.confirm_transaction(&signature)?;
    
    println!("Priority fee transaction completed in {:?}", start.elapsed());
    
    // Summary
    println!("\nPerformance Optimization Summary:");
    println!("1. Basic Transaction: Simple and straightforward, but not optimized for throughput");
    println!("2. Batch Processing: Efficient for processing multiple similar operations");
    println!("3. Parallel Execution: Utilizes multiple threads for higher throughput");
    println!("4. Transaction Optimization: Reduces transaction size and improves efficiency");
    println!("5. Compute Budget Optimization: Allocates more compute resources for complex operations");
    println!("6. Versioned Transactions: Enables use of newer transaction features");
    println!("7. Address Lookup Tables: Reduces transaction size when using many addresses");
    println!("8. Priority Fee Optimization: Improves transaction prioritization during network congestion");
    
    Ok(())
}

async fn sleep(duration: Duration) {
    tokio::time::sleep(duration).await;
}
"#
}

/// Create example repository with basic examples
pub fn create_example_repository(base_dir: &Path) -> io::Result<ExampleRepository> {
    // Create example repository
    let mut repository = ExampleRepository::new(base_dir);
    repository.initialize()?;
    
    // Create basic transaction example
    let basic_metadata = ExampleMetadata {
        id: "basic_transaction".to_string(),
        name: "Basic Transaction Example".to_string(),
        description: "This example demonstrates how to create and submit a basic transaction on the Layer-2 network".to_string(),
        category: ExampleCategory::Basic,
        difficulty: 1,
        tags: vec!["transaction".to_string(), "transfer".to_string(), "beginner".to_string()],
        prerequisites: vec!["Solana CLI".to_string(), "Layer-2 SDK".to_string()],
        estimated_time: 15,
        author: "Layer-2 Team".to_string(),
        creation_date: "2025-04-01".to_string(),
        last_updated: "2025-04-01".to_string(),
    };
    
    let basic_code = ExampleCode {
        id: "basic_transaction".to_string(),
        files: {
            let mut files = HashMap::new();
            files.insert("main.rs".to_string(), basic_transaction_example().to_string());
            files
        },
        entry_point: "main.rs".to_string(),
        build_command: Some("cargo build --release".to_string()),
        run_command: Some("cargo run --release".to_string()),
        test_command: None,
    };
    
    repository.add_example(basic_metadata, basic_code)?;
    
    // Create smart contract example
    let contract_metadata = ExampleMetadata {
        id: "smart_contract".to_string(),
        name: "Smart Contract Example".to_string(),
        description: "This example demonstrates how to create a simple token contract on the Layer-2 network".to_string(),
        category: ExampleCategory::SmartContract,
        difficulty: 3,
        tags: vec!["smart contract".to_string(), "token".to_string(), "intermediate".to_string()],
        prerequisites: vec!["Solana CLI".to_string(), "Layer-2 SDK".to_string(), "Rust knowledge".to_string()],
        estimated_time: 45,
        author: "Layer-2 Team".to_string(),
        creation_date: "2025-04-01".to_string(),
        last_updated: "2025-04-01".to_string(),
    };
    
    let contract_code = ExampleCode {
        id: "smart_contract".to_string(),
        files: {
            let mut files = HashMap::new();
            files.insert("lib.rs".to_string(), smart_contract_example().to_string());
            files
        },
        entry_point: "lib.rs".to_string(),
        build_command: Some("cargo build-bpf --release".to_string()),
        run_command: None,
        test_command: Some("cargo test-bpf".to_string()),
    };
    
    repository.add_example(contract_metadata, contract_code)?;
    
    // Create integration example
    let integration_metadata = ExampleMetadata {
        id: "integration".to_string(),
        name: "Integration Example".to_string(),
        description: "This example demonstrates how to integrate with other protocols on the Layer-2 network".to_string(),
        category: ExampleCategory::Integration,
        difficulty: 4,
        tags: vec!["integration".to_string(), "bridge".to_string(), "cross-chain".to_string(), "advanced".to_string()],
        prerequisites: vec!["Solana CLI".to_string(), "Layer-2 SDK".to_string(), "Ethereum knowledge".to_string()],
        estimated_time: 60,
        author: "Layer-2 Team".to_string(),
        creation_date: "2025-04-01".to_string(),
        last_updated: "2025-04-01".to_string(),
    };
    
    let integration_code = ExampleCode {
        id: "integration".to_string(),
        files: {
            let mut files = HashMap::new();
            files.insert("main.rs".to_string(), integration_example().to_string());
            files
        },
        entry_point: "main.rs".to_string(),
        build_command: Some("cargo build --release".to_string()),
        run_command: Some("cargo run --release".to_string()),
        test_command: None,
    };
    
    repository.add_example(integration_metadata, integration_code)?;
    
    // Create application example
    let app_metadata = ExampleMetadata {
        id: "application".to_string(),
        name: "Application Example".to_string(),
        description: "This example demonstrates how to build a complete decentralized application on the Layer-2 network".to_string(),
        category: ExampleCategory::Application,
        difficulty: 5,
        tags: vec!["application".to_string(), "dapp".to_string(), "web".to_string(), "advanced".to_string()],
        prerequisites: vec!["Solana CLI".to_string(), "Layer-2 SDK".to_string(), "Rust knowledge".to_string(), "Web development".to_string()],
        estimated_time: 120,
        author: "Layer-2 Team".to_string(),
        creation_date: "2025-04-01".to_string(),
        last_updated: "2025-04-01".to_string(),
    };
    
    let app_code = ExampleCode {
        id: "application".to_string(),
        files: {
            let mut files = HashMap::new();
            files.insert("main.rs".to_string(), application_example().to_string());
            files
        },
        entry_point: "main.rs".to_string(),
        build_command: Some("cargo build --release".to_string()),
        run_command: Some("cargo run --release".to_string()),
        test_command: None,
    };
    
    repository.add_example(app_metadata, app_code)?;
    
    // Create performance example
    let perf_metadata = ExampleMetadata {
        id: "performance".to_string(),
        name: "Performance Example".to_string(),
        description: "This example demonstrates how to optimize performance on the Layer-2 network".to_string(),
        category: ExampleCategory::Performance,
        difficulty: 4,
        tags: vec!["performance".to_string(), "optimization".to_string(), "advanced".to_string()],
        prerequisites: vec!["Solana CLI".to_string(), "Layer-2 SDK".to_string(), "Rust knowledge".to_string()],
        estimated_time: 90,
        author: "Layer-2 Team".to_string(),
        creation_date: "2025-04-01".to_string(),
        last_updated: "2025-04-01".to_string(),
    };
    
    let perf_code = ExampleCode {
        id: "performance".to_string(),
        files: {
            let mut files = HashMap::new();
            files.insert("main.rs".to_string(), performance_example().to_string());
            files
        },
        entry_point: "main.rs".to_string(),
        build_command: Some("cargo build --release".to_string()),
        run_command: Some("cargo run --release".to_string()),
        test_command: None,
    };
    
    repository.add_example(perf_metadata, perf_code)?;
    
    Ok(repository)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    
    #[test]
    fn test_example_repository_creation() {
        let temp_dir = tempdir().unwrap();
        let repository = ExampleRepository::new(temp_dir.path());
        assert!(!repository.is_initialized());
    }
    
    #[test]
    fn test_example_repository_initialization() {
        let temp_dir = tempdir().unwrap();
        let mut repository = ExampleRepository::new(temp_dir.path());
        repository.initialize().unwrap();
        assert!(repository.is_initialized());
    }
    
    #[test]
    fn test_create_example_repository() {
        let temp_dir = tempdir().unwrap();
        let repository = create_example_repository(temp_dir.path()).unwrap();
        
        // Check if examples were added
        let examples = repository.get_all_metadata();
        assert_eq!(examples.len(), 5);
        
        // Check if we can get examples by category
        let basic_examples = repository.get_examples_by_category(&ExampleCategory::Basic);
        assert_eq!(basic_examples.len(), 1);
        
        let contract_examples = repository.get_examples_by_category(&ExampleCategory::SmartContract);
        assert_eq!(contract_examples.len(), 1);
        
        // Check if we can get examples by tag
        let beginner_examples = repository.get_examples_by_tag("beginner");
        assert_eq!(beginner_examples.len(), 1);
        
        let advanced_examples = repository.get_examples_by_tag("advanced");
        assert_eq!(advanced_examples.len(), 3);
        
        // Check if we can get examples by difficulty
        let easy_examples = repository.get_examples_by_difficulty(1, 2);
        assert_eq!(easy_examples.len(), 1);
        
        let hard_examples = repository.get_examples_by_difficulty(4, 5);
        assert_eq!(hard_examples.len(), 3);
    }
}
