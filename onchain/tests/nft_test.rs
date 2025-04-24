#![cfg(test)]
mod nft_tests {
    use solana_program::{
        instruction::{AccountMeta, Instruction},
        pubkey::Pubkey,
        system_program,
        sysvar::rent,
    };
    use solana_program_test::*;
    use solana_sdk::{
        account::Account,
        signature::{Keypair, Signer},
        transaction::Transaction,
    };
    use std::str::FromStr;

    
    #[tokio::test]
    async fn test_initialize_nft_collection() {
        let program_id = Pubkey::from_str("NFTMint11111111111111111111111111111111111111").unwrap();
        let mut program_test = ProgramTest::new(
            "nft_mint",
            program_id,
            processor!(crate::nft_mint::process_instruction),
        );
        
        let initializer = Keypair::new();
        let collection_state = Keypair::new();
        let authority = Keypair::new();
        
        program_test.add_account(
            initializer.pubkey(),
            Account {
                lamports: 1000000000,
                data: vec![],
                owner: system_program::id(),
                executable: false,
                rent_epoch: 0,
            },
        );
        
        let (mut banks_client, payer, recent_blockhash) = program_test.start().await;
        
        let rent = banks_client.get_rent().await.unwrap();
        let collection_state_rent = rent.minimum_balance(1000); // Placeholder size
        
        let create_collection_state_ix = solana_program::system_instruction::create_account(
            &payer.pubkey(),
            &collection_state.pubkey(),
            collection_state_rent,
            1000, // Placeholder size
            &program_id,
        );
        
        let ethereum_collection_address = [1u8; 20];
        let name = "Test Collection";
        let symbol = "TEST";
        
        let mut instruction_data = vec![0]; // Instruction type: InitializeNFTCollection
        instruction_data.extend_from_slice(&ethereum_collection_address);
        instruction_data.push(name.len() as u8);
        instruction_data.extend_from_slice(name.as_bytes());
        instruction_data.push(symbol.len() as u8);
        instruction_data.extend_from_slice(symbol.as_bytes());
        
        let initialize_collection_ix = Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(initializer.pubkey(), true),
                AccountMeta::new(collection_state.pubkey(), false),
                AccountMeta::new(authority.pubkey(), false),
                AccountMeta::new_readonly(rent::id(), false),
            ],
            data: instruction_data,
        };
        
        let mut transaction = Transaction::new_with_payer(
            &[create_collection_state_ix, initialize_collection_ix],
            Some(&payer.pubkey()),
        );
        transaction.sign(&[&payer, &collection_state, &initializer], recent_blockhash);
        
        banks_client.process_transaction(transaction).await.unwrap();
        
        let collection_state_account = banks_client
            .get_account(collection_state.pubkey())
            .await
            .unwrap()
            .unwrap();
        
        assert_eq!(collection_state_account.owner, program_id);
        assert!(collection_state_account.data.len() > 0);
        assert_eq!(collection_state_account.data[0], 1); // is_initialized flag
    }
    
    #[tokio::test]
    async fn test_mint_nft() {
        let program_id = Pubkey::from_str("NFTMint11111111111111111111111111111111111111").unwrap();
        let mut program_test = ProgramTest::new(
            "nft_mint",
            program_id,
            processor!(crate::nft_mint::process_instruction),
        );
        
        let authority = Keypair::new();
        let collection_state = Keypair::new();
        let metadata_account = Keypair::new();
        let mint_account = Keypair::new();
        let destination_token_account = Keypair::new();
        
        program_test.add_account(
            authority.pubkey(),
            Account {
                lamports: 1000000000,
                data: vec![],
                owner: system_program::id(),
                executable: false,
                rent_epoch: 0,
            },
        );
        
        program_test.add_account(
            collection_state.pubkey(),
            Account {
                lamports: 1000000000,
                data: vec![1], // is_initialized flag
                owner: program_id,
                executable: false,
                rent_epoch: 0,
            },
        );
        
        let (mut banks_client, payer, recent_blockhash) = program_test.start().await;
        
        let rent = banks_client.get_rent().await.unwrap();
        let metadata_rent = rent.minimum_balance(1000); // Placeholder size
        
        let create_metadata_ix = solana_program::system_instruction::create_account(
            &payer.pubkey(),
            &metadata_account.pubkey(),
            metadata_rent,
            1000, // Placeholder size
            &program_id,
        );
        
        let mint_rent = rent.minimum_balance(82); // Mint account size
        
        let create_mint_ix = solana_program::system_instruction::create_account(
            &payer.pubkey(),
            &mint_account.pubkey(),
            mint_rent,
            82, // Mint account size
            &spl_token::id(),
        );
        
        let token_account_rent = rent.minimum_balance(165); // Token account size
        
        let create_token_account_ix = solana_program::system_instruction::create_account(
            &payer.pubkey(),
            &destination_token_account.pubkey(),
            token_account_rent,
            165, // Token account size
            &spl_token::id(),
        );
        
        let token_id = 12345u64;
        let metadata_uri = "https://example.com/metadata/12345";
        let ethereum_tx_hash = [2u8; 32];
        let nonce = 67890u64;
        
        let mut instruction_data = vec![1]; // Instruction type: MintNFT
        instruction_data.extend_from_slice(&token_id.to_le_bytes());
        instruction_data.push(metadata_uri.len() as u8);
        instruction_data.extend_from_slice(metadata_uri.as_bytes());
        instruction_data.extend_from_slice(&ethereum_tx_hash);
        instruction_data.extend_from_slice(&nonce.to_le_bytes());
        
        let mint_nft_ix = Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(authority.pubkey(), true),
                AccountMeta::new(collection_state.pubkey(), false),
                AccountMeta::new(metadata_account.pubkey(), false),
                AccountMeta::new(mint_account.pubkey(), false),
                AccountMeta::new(destination_token_account.pubkey(), false),
                AccountMeta::new_readonly(spl_token::id(), false),
                AccountMeta::new_readonly(rent::id(), false),
            ],
            data: instruction_data,
        };
        
        let mut transaction = Transaction::new_with_payer(
            &[
                create_metadata_ix,
                create_mint_ix,
                create_token_account_ix,
                mint_nft_ix,
            ],
            Some(&payer.pubkey()),
        );
        transaction.sign(
            &[
                &payer,
                &metadata_account,
                &mint_account,
                &destination_token_account,
                &authority,
            ],
            recent_blockhash,
        );
        
        banks_client.process_transaction(transaction).await.unwrap();
        
        let metadata_account = banks_client
            .get_account(metadata_account.pubkey())
            .await
            .unwrap()
            .unwrap();
        
        assert_eq!(metadata_account.owner, program_id);
        assert!(metadata_account.data.len() > 0);
        assert_eq!(metadata_account.data[0], 1); // is_initialized flag
    }
    
    #[tokio::test]
    async fn test_transfer_nft() {
        let program_id = Pubkey::from_str("NFTMint11111111111111111111111111111111111111").unwrap();
        let mut program_test = ProgramTest::new(
            "nft_mint",
            program_id,
            processor!(crate::nft_mint::process_instruction),
        );
        
        let owner = Keypair::new();
        let metadata_account = Keypair::new();
        let source_token_account = Keypair::new();
        let destination_token_account = Keypair::new();
        let new_owner = Keypair::new();
        
        program_test.add_account(
            owner.pubkey(),
            Account {
                lamports: 1000000000,
                data: vec![],
                owner: system_program::id(),
                executable: false,
                rent_epoch: 0,
            },
        );
        
        program_test.add_account(
            metadata_account.pubkey(),
            Account {
                lamports: 1000000000,
                data: vec![1], // is_initialized flag
                owner: program_id,
                executable: false,
                rent_epoch: 0,
            },
        );
        
        program_test.add_account(
            source_token_account.pubkey(),
            Account {
                lamports: 1000000000,
                data: vec![1], // is_initialized flag
                owner: spl_token::id(),
                executable: false,
                rent_epoch: 0,
            },
        );
        
        program_test.add_account(
            destination_token_account.pubkey(),
            Account {
                lamports: 1000000000,
                data: vec![1], // is_initialized flag
                owner: spl_token::id(),
                executable: false,
                rent_epoch: 0,
            },
        );
        
        let (mut banks_client, payer, recent_blockhash) = program_test.start().await;
        
        let token_id = 12345u64;
        
        let mut instruction_data = vec![2]; // Instruction type: TransferNFT
        instruction_data.extend_from_slice(&token_id.to_le_bytes());
        instruction_data.extend_from_slice(new_owner.pubkey().as_ref());
        
        let transfer_nft_ix = Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(owner.pubkey(), true),
                AccountMeta::new(metadata_account.pubkey(), false),
                AccountMeta::new(source_token_account.pubkey(), false),
                AccountMeta::new(destination_token_account.pubkey(), false),
                AccountMeta::new_readonly(spl_token::id(), false),
            ],
            data: instruction_data,
        };
        
        let mut transaction = Transaction::new_with_payer(
            &[transfer_nft_ix],
            Some(&payer.pubkey()),
        );
        transaction.sign(&[&payer, &owner], recent_blockhash);
        
        banks_client.process_transaction(transaction).await.unwrap();
    }
    
    #[tokio::test]
    async fn test_burn_nft() {
        let program_id = Pubkey::from_str("NFTMint11111111111111111111111111111111111111").unwrap();
        let mut program_test = ProgramTest::new(
            "nft_mint",
            program_id,
            processor!(crate::nft_mint::process_instruction),
        );
        
        let owner = Keypair::new();
        let metadata_account = Keypair::new();
        let mint_account = Keypair::new();
        let source_token_account = Keypair::new();
        
        program_test.add_account(
            owner.pubkey(),
            Account {
                lamports: 1000000000,
                data: vec![],
                owner: system_program::id(),
                executable: false,
                rent_epoch: 0,
            },
        );
        
        program_test.add_account(
            metadata_account.pubkey(),
            Account {
                lamports: 1000000000,
                data: vec![1], // is_initialized flag
                owner: program_id,
                executable: false,
                rent_epoch: 0,
            },
        );
        
        program_test.add_account(
            mint_account.pubkey(),
            Account {
                lamports: 1000000000,
                data: vec![1], // is_initialized flag
                owner: spl_token::id(),
                executable: false,
                rent_epoch: 0,
            },
        );
        
        program_test.add_account(
            source_token_account.pubkey(),
            Account {
                lamports: 1000000000,
                data: vec![1], // is_initialized flag
                owner: spl_token::id(),
                executable: false,
                rent_epoch: 0,
            },
        );
        
        let (mut banks_client, payer, recent_blockhash) = program_test.start().await;
        
        let token_id = 12345u64;
        let ethereum_recipient = [3u8; 20];
        
        let mut instruction_data = vec![3]; // Instruction type: BurnNFT
        instruction_data.extend_from_slice(&token_id.to_le_bytes());
        instruction_data.extend_from_slice(&ethereum_recipient);
        
        let burn_nft_ix = Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(owner.pubkey(), true),
                AccountMeta::new(metadata_account.pubkey(), false),
                AccountMeta::new(mint_account.pubkey(), false),
                AccountMeta::new(source_token_account.pubkey(), false),
                AccountMeta::new_readonly(spl_token::id(), false),
            ],
            data: instruction_data,
        };
        
        let mut transaction = Transaction::new_with_payer(
            &[burn_nft_ix],
            Some(&payer.pubkey()),
        );
        transaction.sign(&[&payer, &owner], recent_blockhash);
        
        banks_client.process_transaction(transaction).await.unwrap();
    }
}
