use solana_program::{
    pubkey::Pubkey,
    program_pack::Pack,
    system_instruction,
    system_program,
    sysvar::rent::Rent,
};
use solana_program_test::*;
use solana_sdk::{
    account::Account,
    signature::{Keypair, Signer},
    transaction::Transaction,
};

// Importa il modulo del programma Layer 2
use solana_layer2_program::{
    processor::process_instruction,
    state::{Layer2State, BatchCommitment, Challenge, SecurityParams},
};
use solana_layer2_program::instruction::Layer2Instruction;

#[tokio::test]
async fn test_initialize() {
    // Configura il test del programma
    let program_id = solana_layer2_program::id();
    let mut program_test = ProgramTest::new(
        "solana_layer2_program",
        program_id,
        processor!(process_instruction),
    );

    // Crea un keypair per l'autorità del sistema
    let authority = Keypair::new();
    
    // Crea un keypair per l'account di stato del Layer 2
    let layer2_state = Keypair::new();
    
    // Aggiungi fondi all'autorità per pagare le transazioni
    program_test.add_account(
        authority.pubkey(),
        Account {
            lamports: 1_000_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );

    // Avvia il test
    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;

    // Crea l'istruzione di inizializzazione
    let max_sequencers = 10;
    let challenge_period_slots = 100;
    let minimum_stake_amount = 1_000_000;
    
    let initialize_ix = Layer2Instruction::initialize(
        &program_id,
        &authority.pubkey(),
        &layer2_state.pubkey(),
        max_sequencers,
        challenge_period_slots,
        minimum_stake_amount,
    );
    
    // Crea l'istruzione per creare l'account di stato
    let rent = Rent::default();
    let state_size = Layer2State::LEN;
    let lamports = rent.minimum_balance(state_size);
    
    let create_state_account_ix = system_instruction::create_account(
        &authority.pubkey(),
        &layer2_state.pubkey(),
        lamports,
        state_size as u64,
        &program_id,
    );
    
    // Crea e invia la transazione
    let transaction = Transaction::new_signed_with_payer(
        &[create_state_account_ix, initialize_ix],
        Some(&authority.pubkey()),
        &[&authority, &layer2_state],
        recent_blockhash,
    );
    
    // Invia la transazione e verifica che non ci siano errori
    banks_client.process_transaction(transaction).await.unwrap();
    
    // Verifica che l'account di stato sia stato inizializzato correttamente
    let state_account = banks_client.get_account(layer2_state.pubkey()).await.unwrap().unwrap();
    assert_eq!(state_account.owner, program_id);
    
    // Deserializza lo stato e verifica i valori
    let state = Layer2State::unpack(&state_account.data).unwrap();
    assert_eq!(state.is_initialized, true);
    assert_eq!(state.authority, authority.pubkey());
    assert_eq!(state.security_params.challenge_period, challenge_period_slots);
    assert_eq!(state.security_params.min_sequencer_stake, minimum_stake_amount);
    assert_eq!(state.current_batch_id, 0);
}

#[tokio::test]
async fn test_register_sequencer() {
    // Configura il test del programma
    let program_id = solana_layer2_program::id();
    let mut program_test = ProgramTest::new(
        "solana_layer2_program",
        program_id,
        processor!(process_instruction),
    );

    // Crea keypair per l'autorità e il sequencer
    let authority = Keypair::new();
    let sequencer = Keypair::new();
    let layer2_state = Keypair::new();
    let sequencer_stake_account = Keypair::new();
    
    // Aggiungi fondi all'autorità e al sequencer
    program_test.add_account(
        authority.pubkey(),
        Account {
            lamports: 10_000_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );
    
    program_test.add_account(
        sequencer.pubkey(),
        Account {
            lamports: 10_000_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );
    
    // Inizializza lo stato del Layer 2
    let max_sequencers = 10;
    let challenge_period_slots = 100;
    let minimum_stake_amount = 1_000_000;
    
    let mut layer2_state_data = Layer2State {
        is_initialized: true,
        authority: authority.pubkey(),
        current_batch_id: 0,
        transaction_count: 0,
        total_value_locked: 0,
        last_update_timestamp: 0,
        sequencer: Pubkey::default(),
        paused: false,
        security_params: SecurityParams {
            challenge_period: challenge_period_slots,
            min_sequencer_stake: minimum_stake_amount,
            min_validator_stake: 0,
            fraud_proof_reward_bps: 1000, // 10%
            max_batch_size: 1000,
            max_transactions_per_batch: 500,
        },
    };
    
    let mut state_data = vec![0; Layer2State::LEN];
    layer2_state_data.pack_into_slice(&mut state_data);
    
    program_test.add_account(
        layer2_state.pubkey(),
        Account {
            lamports: 1_000_000,
            data: state_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    );

    // Avvia il test
    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;
    
    // Crea l'account per la transazione
    let transaction_account = Keypair::new();
    let rent = Rent::default();
    let transaction_size = std::mem::size_of::<Transaction>();
    let lamports = rent.minimum_balance(transaction_size);
    
    let create_transaction_account_ix = system_instruction::create_account(
        &sequencer.pubkey(),
        &transaction_account.pubkey(),
        lamports,
        transaction_size as u64,
        &program_id,
    );
    
    // Crea l'istruzione per registrare un sequencer
    let stake_amount = 2_000_000; // Più del minimo richiesto
    
    let register_ix = Layer2Instruction::register_sequencer(
        &program_id,
        &authority.pubkey(),
        &layer2_state.pubkey(),
        &sequencer.pubkey(),
        stake_amount,
    );
    
    // Crea e invia la transazione
    let transaction = Transaction::new_signed_with_payer(
        &[register_ix],
        Some(&authority.pubkey()),
        &[&authority, &sequencer],
        recent_blockhash,
    );
    
    // Invia la transazione e verifica che non ci siano errori
    banks_client.process_transaction(transaction).await.unwrap();
    
    // Verifica che il sequencer sia stato registrato
    let state_account = banks_client.get_account(layer2_state.pubkey()).await.unwrap().unwrap();
    let state = Layer2State::unpack(&state_account.data).unwrap();
    
    assert_eq!(state.is_initialized, true);
    assert_eq!(state.sequencer, sequencer.pubkey());
    
    // Verifica che l'account di stake sia stato creato correttamente
    let expected_stake_address = Pubkey::create_with_seed(
        &sequencer.pubkey(),
        "sequencer_stake",
        &program_id,
    ).unwrap();
    
    let stake_account = banks_client.get_account(expected_stake_address).await.unwrap().unwrap();
    assert_eq!(stake_account.owner, program_id);
    assert_eq!(stake_account.lamports >= stake_amount, true);
}

#[tokio::test]
async fn test_commit_batch() {
    // Configura il test del programma
    let program_id = solana_layer2_program::id();
    let mut program_test = ProgramTest::new(
        "solana_layer2_program",
        program_id,
        processor!(process_instruction),
    );

    // Crea keypair per l'autorità, il sequencer e gli account necessari
    let authority = Keypair::new();
    let sequencer = Keypair::new();
    let layer2_state = Keypair::new();
    let batch_account = Keypair::new();
    
    // Aggiungi fondi all'autorità e al sequencer
    program_test.add_account(
        authority.pubkey(),
        Account {
            lamports: 10_000_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );
    
    program_test.add_account(
        sequencer.pubkey(),
        Account {
            lamports: 10_000_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );
    
    // Inizializza lo stato del Layer 2 con il sequencer già registrato
    let max_sequencers = 10;
    let challenge_period_slots = 100;
    let minimum_stake_amount = 1_000_000;
    
    let mut sequencers = [Pubkey::default(); 10];
    sequencers[0] = sequencer.pubkey();
    
    let mut layer2_state_data = Layer2State {
        is_initialized: true,
        authority: authority.pubkey(),
        current_batch_id: 0,
        transaction_count: 0,
        total_value_locked: 0,
        last_update_timestamp: 0,
        sequencer: sequencer.pubkey(),
        paused: false,
        security_params: SecurityParams {
            challenge_period: challenge_period_slots,
            min_sequencer_stake: minimum_stake_amount,
            min_validator_stake: 0,
            fraud_proof_reward_bps: 1000, // 10%
            max_batch_size: 1000,
            max_transactions_per_batch: 500,
        },
    };
    
    let mut state_data = vec![0; Layer2State::LEN];
    layer2_state_data.pack_into_slice(&mut state_data);
    
    program_test.add_account(
        layer2_state.pubkey(),
        Account {
            lamports: 1_000_000,
            data: state_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    );

    // Avvia il test
    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;
    
    // Crea l'istruzione per committare un batch
    let batch_number = 0;
    let transactions_root = [1; 32];
    let previous_state_root = [2; 32];
    let new_state_root = [3; 32];
    let timestamp = 12345;
    
    let transaction_hashes = vec![transactions_root];
    
    let commit_ix = Layer2Instruction::commit_batch(
        &program_id,
        &sequencer.pubkey(),
        &layer2_state.pubkey(),
        &batch_account.pubkey(),
        batch_number,
        transaction_hashes,
        previous_state_root,
        new_state_root,
        timestamp,
    );
    
    // Crea l'account per il batch
    let rent = Rent::default();
    let batch_account_size = BatchCommitment::LEN;
    let lamports = rent.minimum_balance(batch_account_size);
    
    let create_batch_account_ix = system_instruction::create_account(
        &sequencer.pubkey(),
        &batch_account.pubkey(),
        lamports,
        batch_account_size as u64,
        &program_id,
    );
    
    // Crea e invia la transazione
    let transaction = Transaction::new_signed_with_payer(
        &[create_batch_account_ix, commit_ix],
        Some(&sequencer.pubkey()),
        &[&sequencer, &batch_account],
        recent_blockhash,
    );
    
    // Invia la transazione e verifica che non ci siano errori
    banks_client.process_transaction(transaction).await.unwrap();
    
    // Verifica che il batch sia stato committato
    let batch_account_data = banks_client.get_account(batch_account.pubkey()).await.unwrap().unwrap();
    let batch = BatchCommitment::unpack(&batch_account_data.data).unwrap();
    
    assert_eq!(batch.is_initialized, true);
    assert_eq!(batch.sequencer, sequencer.pubkey());
    assert_eq!(batch.batch_number, batch_number);
    assert_eq!(batch.transactions_root, transactions_root);
    assert_eq!(batch.previous_state_root, previous_state_root);
    assert_eq!(batch.new_state_root, new_state_root);
    assert_eq!(batch.timestamp, timestamp);
    assert_eq!(batch.is_finalized, false);
    
    // Verifica che lo stato sia stato aggiornato
    let state_account = banks_client.get_account(layer2_state.pubkey()).await.unwrap().unwrap();
    let state = Layer2State::unpack(&state_account.data).unwrap();
    
    assert_eq!(state.current_batch_id, 1);
}

#[tokio::test]
async fn test_challenge_and_resolve() {
    // Configura il test del programma
    let program_id = solana_layer2_program::id();
    let mut program_test = ProgramTest::new(
        "solana_layer2_program",
        program_id,
        processor!(process_instruction),
    );

    // Crea keypair per l'autorità, il sequencer, il contestatore e gli account necessari
    let authority = Keypair::new();
    let sequencer = Keypair::new();
    let challenger = Keypair::new();
    let layer2_state = Keypair::new();
    let batch_account = Keypair::new();
    let challenge_account = Keypair::new();
    
    // Aggiungi fondi agli account
    program_test.add_account(
        authority.pubkey(),
        Account {
            lamports: 10_000_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );
    
    program_test.add_account(
        sequencer.pubkey(),
        Account {
            lamports: 10_000_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );
    
    program_test.add_account(
        challenger.pubkey(),
        Account {
            lamports: 10_000_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );
    
    // Inizializza lo stato del Layer 2 con il sequencer già registrato
    let max_sequencers = 10;
    let challenge_period_slots = 100;
    let minimum_stake_amount = 1_000_000;
    
    let mut sequencers = [Pubkey::default(); 10];
    sequencers[0] = sequencer.pubkey();
    
    let mut layer2_state_data = Layer2State {
        is_initialized: true,
        authority: authority.pubkey(),
        current_batch_id: 1, // Abbiamo già un batch
        transaction_count: 0,
        total_value_locked: 0,
        last_update_timestamp: 0,
        sequencer: sequencer.pubkey(),
        paused: false,
        security_params: SecurityParams {
            challenge_period: challenge_period_slots,
            min_sequencer_stake: minimum_stake_amount,
            min_validator_stake: 0,
            fraud_proof_reward_bps: 1000, // 10%
            max_batch_size: 1000,
            max_transactions_per_batch: 500,
        },
    };
    
    let mut state_data = vec![0; Layer2State::LEN];
    layer2_state_data.pack_into_slice(&mut state_data);
    
    program_test.add_account(
        layer2_state.pubkey(),
        Account {
            lamports: 1_000_000,
            data: state_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    );
    
    // Crea un batch già committato
    let batch_number = 0;
    let transactions_root = [1; 32];
    let previous_state_root = [2; 32];
    let new_state_root = [3; 32];
    let timestamp = 12345;
    
    let mut batch_data = BatchCommitment {
        is_initialized: true,
        sequencer: sequencer.pubkey(),
        batch_number,
        transactions_root,
        previous_state_root,
        new_state_root,
        timestamp,
        is_finalized: false,
        challenge_deadline_slot: 200, // Un valore arbitrario nel futuro
    };
    
    let mut batch_account_data = vec![0; BatchCommitment::LEN];
    batch_data.pack_into_slice(&mut batch_account_data);
    
    program_test.add_account(
        batch_account.pubkey(),
        Account {
            lamports: 1_000_000,
            data: batch_account_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    );

    // Avvia il test
    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;
    
    // Crea l'istruzione per contestare il batch
    let transaction_index = 5;
    let merkle_proof = vec![[4; 32], [5; 32]];
    let transaction_data = vec![10, 20, 30];
    let previous_state = vec![40, 50, 60];
    let expected_new_state = vec![70, 80, 90];
    
    let challenge_ix = Layer2Instruction::challenge_batch(
        &program_id,
        &challenger.pubkey(),
        &layer2_state.pubkey(),
        &batch_account.pubkey(),
        &challenge_account.pubkey(),
        batch_number,
        transaction_index,
        merkle_proof.clone(),
        transaction_data.clone(),
        previous_state.clone(),
        expected_new_state.clone(),
    );
    
    // Crea l'account per la contestazione
    let rent = Rent::default();
    let challenge_account_size = Challenge::LEN;
    let lamports = rent.minimum_balance(challenge_account_size);
    
    let create_challenge_account_ix = system_instruction::create_account(
        &challenger.pubkey(),
        &challenge_account.pubkey(),
        lamports,
        challenge_account_size as u64,
        &program_id,
    );
    
    // Crea e invia la transazione di contestazione
    let challenge_transaction = Transaction::new_signed_with_payer(
        &[create_challenge_account_ix, challenge_ix],
        Some(&challenger.pubkey()),
        &[&challenger, &challenge_account],
        recent_blockhash,
    );
    
    // Invia la transazione e verifica che non ci siano errori
    banks_client.process_transaction(challenge_transaction).await.unwrap();
    
    // Verifica che la contestazione sia stata creata
    let challenge_account_data = banks_client.get_account(challenge_account.pubkey()).await.unwrap().unwrap();
    let challenge = Challenge::unpack(&challenge_account_data.data).unwrap();
    
    assert_eq!(challenge.id > 0, true);
    assert_eq!(challenge.challenger, challenger.pubkey());
    assert_eq!(challenge.batch_id, batch_number);
    assert_eq!(challenge.reason, 2); // 2 = invalid state transition
    assert_eq!(challenge.status, 0); // pending
    
    println!("Challenge ID: {}", challenge.id);
    
    // Ora risolvi la contestazione
    let mut challenge_id_bytes = [0u8; 32];
    challenge_id_bytes[0..8].copy_from_slice(&challenge.id.to_le_bytes());
    let challenge_id = Pubkey::new(&challenge_id_bytes);
    
    println!("Challenge ID Pubkey: {}", challenge_id);
    
    let resolve_ix = Layer2Instruction::resolve_challenge(
        &program_id,
        &authority.pubkey(),
        &layer2_state.pubkey(),
        &batch_account.pubkey(),
        &challenge_account.pubkey(),
        &sequencer.pubkey(),
        challenge_id, // Use the properly formatted challenge_id
        true, // La contestazione è valida
    );
    
    // Crea e invia la transazione di risoluzione
    let resolve_transaction = Transaction::new_signed_with_payer(
        &[resolve_ix],
        Some(&authority.pubkey()),
        &[&authority],
        recent_blockhash,
    );
    
    // Invia la transazione e verifica che non ci siano errori
    banks_client.process_transaction(resolve_transaction).await.unwrap();
    
    // Verifica che la contestazione sia stata risolta
    let challenge_account_data = banks_client.get_account(challenge_account.pubkey()).await.unwrap().unwrap();
    let challenge = Challenge::unpack(&challenge_account_data.data).unwrap();
    
    assert_eq!(challenge.status, 1); // 1 = accepted
    assert_eq!(challenge.resolution_timestamp.is_some(), true);
    
    // Verifica che il batch sia stato invalidato
    let batch_account_data = banks_client.get_account(batch_account.pubkey()).await.unwrap().unwrap();
    let batch = BatchCommitment::unpack(&batch_account_data.data).unwrap();
    
    assert_eq!(batch.is_finalized, false);
    // In un'implementazione reale, il batch verrebbe contrassegnato come invalidato
}

#[tokio::test]
async fn test_finalize_batch() {
    // Configura il test del programma
    let program_id = solana_layer2_program::id();
    let mut program_test = ProgramTest::new(
        "solana_layer2_program",
        program_id,
        processor!(process_instruction),
    );

    // Crea keypair per l'autorità, il sequencer e gli account necessari
    let authority = Keypair::new();
    let sequencer = Keypair::new();
    let user = Keypair::new();
    let layer2_state = Keypair::new();
    let batch_account = Keypair::new();
    
    // Aggiungi fondi agli account
    program_test.add_account(
        authority.pubkey(),
        Account {
            lamports: 10_000_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );
    
    program_test.add_account(
        sequencer.pubkey(),
        Account {
            lamports: 10_000_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );
    
    program_test.add_account(
        user.pubkey(),
        Account {
            lamports: 10_000_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );
    
    // Inizializza lo stato del Layer 2
    let max_sequencers = 10;
    let challenge_period_slots = 100;
    let minimum_stake_amount = 1_000_000;
    
    let mut sequencers = [Pubkey::default(); 10];
    sequencers[0] = sequencer.pubkey();
    
    let mut layer2_state_data = Layer2State {
        is_initialized: true,
        authority: authority.pubkey(),
        current_batch_id: 1, // Abbiamo già un batch
        transaction_count: 0,
        total_value_locked: 0,
        last_update_timestamp: 0,
        sequencer: sequencer.pubkey(),
        paused: false,
        security_params: SecurityParams {
            challenge_period: challenge_period_slots,
            min_sequencer_stake: minimum_stake_amount,
            min_validator_stake: 0,
            fraud_proof_reward_bps: 1000, // 10%
            max_batch_size: 1000,
            max_transactions_per_batch: 500,
        },
    };
    
    let mut state_data = vec![0; Layer2State::LEN];
    layer2_state_data.pack_into_slice(&mut state_data);
    
    program_test.add_account(
        layer2_state.pubkey(),
        Account {
            lamports: 1_000_000,
            data: state_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    );
    
    // Crea un batch già committato con deadline di contestazione passata
    let batch_number = 0;
    let transactions_root = [1; 32];
    let previous_state_root = [2; 32];
    let new_state_root = [3; 32];
    let timestamp = 12345;
    
    let mut batch_data = BatchCommitment {
        is_initialized: true,
        sequencer: sequencer.pubkey(),
        batch_number,
        transactions_root,
        previous_state_root,
        new_state_root,
        timestamp,
        is_finalized: false,
        challenge_deadline_slot: 0, // Una deadline nel passato
    };
    
    let mut batch_account_data = vec![0; BatchCommitment::LEN];
    batch_data.pack_into_slice(&mut batch_account_data);
    
    program_test.add_account(
        batch_account.pubkey(),
        Account {
            lamports: 1_000_000,
            data: batch_account_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    );

    // Avvia il test
    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;
    
    // Crea l'istruzione per finalizzare il batch
    let finalize_ix = Layer2Instruction::finalize_batch(
        &program_id,
        &user.pubkey(),
        &layer2_state.pubkey(),
        &batch_account.pubkey(),
        batch_number,
    );
    
    // Crea e invia la transazione
    let transaction = Transaction::new_signed_with_payer(
        &[finalize_ix],
        Some(&user.pubkey()),
        &[&user],
        recent_blockhash,
    );
    
    // Invia la transazione e verifica che non ci siano errori
    banks_client.process_transaction(transaction).await.unwrap();
    
    // Verifica che il batch sia stato finalizzato
    let batch_account_data = banks_client.get_account(batch_account.pubkey()).await.unwrap().unwrap();
    let batch = BatchCommitment::unpack(&batch_account_data.data).unwrap();
    
    assert_eq!(batch.is_finalized, true);
}
