/**
 * Modulo di elaborazione delle istruzioni per il Layer-2 su Solana
 * 
 * Questo modulo implementa il processore principale che gestisce l'elaborazione
 * delle istruzioni del programma Layer-2.
 */

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::{clock::Clock, rent::Rent, Sysvar},
    program_pack::{IsInitialized, Pack},
    system_instruction,
    program::{invoke, invoke_signed},
};
use borsh::{BorshDeserialize, BorshSerialize};
use crate::error::{Layer2Error, handle_error, require};
use crate::instruction::Layer2Instruction;
use crate::state::{
    Layer2State, 
    Transaction, 
    TransactionStatus, 
    Batch, 
    Account, 
    Proof, 
    Challenge,
    MerkleTree,
    StateTransition
};
use crate::validation::Validator;

/// Struttura per il processore delle istruzioni
pub struct Processor {}

impl Processor {
    /// Elabora un'istruzione
    pub fn process(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        instruction_data: &[u8],
    ) -> ProgramResult {
        let instruction = Layer2Instruction::deserialize(instruction_data)?;
        
        match instruction {
            Layer2Instruction::Initialize { version } => {
                Self::process_initialize(program_id, accounts, version)
            },
            Layer2Instruction::Deposit { amount, data } => {
                Self::process_deposit(program_id, accounts, amount, data)
            },
            Layer2Instruction::Transfer { amount, nonce, data } => {
                Self::process_transfer(program_id, accounts, amount, nonce, data)
            },
            Layer2Instruction::Withdraw { amount, nonce, data } => {
                Self::process_withdraw(program_id, accounts, amount, nonce, data)
            },
            Layer2Instruction::SubmitBatch { transactions, timestamp, expiry_timestamp } => {
                Self::process_submit_batch(program_id, accounts, transactions, timestamp, expiry_timestamp)
            },
            Layer2Instruction::VerifyBatch { batch_id } => {
                Self::process_verify_batch(program_id, accounts, batch_id)
            },
            Layer2Instruction::ChallengeBatch { batch_id, proof } => {
                Self::process_challenge_batch(program_id, accounts, batch_id, proof)
            },
            Layer2Instruction::ResolveChallenge { challenge_id, response } => {
                Self::process_resolve_challenge(program_id, accounts, challenge_id, response)
            },
            Layer2Instruction::UpdateSequencer { new_sequencer } => {
                Self::process_update_sequencer(program_id, accounts, new_sequencer)
            },
            Layer2Instruction::UpdateParameters { parameters } => {
                Self::process_update_parameters(program_id, accounts, parameters)
            },
            Layer2Instruction::CreateAccount { initial_balance } => {
                Self::process_create_account(program_id, accounts, initial_balance)
            },
            Layer2Instruction::CloseAccount {} => {
                Self::process_close_account(program_id, accounts)
            },
            Layer2Instruction::ExecuteStateTransition { from_state_hash, to_state_hash, batch_id } => {
                Self::process_execute_state_transition(program_id, accounts, from_state_hash, to_state_hash, batch_id)
            },
            Layer2Instruction::VerifyMerkleProof { leaf, proof, root } => {
                Self::process_verify_merkle_proof(program_id, accounts, leaf, proof, root)
            },
        }
    }
    
    /// Elabora un'istruzione di inizializzazione
    fn process_initialize(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        version: u8,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        let state_account_info = next_account_info(account_info_iter)?;
        let sequencer_info = next_account_info(account_info_iter)?;
        let system_program_info = next_account_info(account_info_iter)?;
        let rent_info = next_account_info(account_info_iter)?;
        
        // Verifica che l'account di stato sia di proprietà del programma
        if state_account_info.owner != program_id {
            // Se l'account non è di proprietà del programma, lo inizializziamo
            let rent = Rent::from_account_info(rent_info)?;
            let space = Layer2State::LEN;
            let lamports = rent.minimum_balance(space);
            
            // Crea l'account di stato
            invoke(
                &system_instruction::create_account(
                    sequencer_info.key,
                    state_account_info.key,
                    lamports,
                    space as u64,
                    program_id,
                ),
                &[
                    sequencer_info.clone(),
                    state_account_info.clone(),
                    system_program_info.clone(),
                ],
            )?;
        }
        
        // Verifica che l'account di stato non sia già inizializzato
        if !state_account_info.data.borrow().iter().all(|&x| x == 0) {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che il sequencer sia un firmatario
        if !sequencer_info.is_signer {
            return Err(handle_error(Layer2Error::InvalidSignature));
        }
        
        // Inizializza lo stato del Layer-2
        let clock = Clock::get()?;
        let state = Layer2State::new(
            version,
            0, // Blocco iniziale
            clock.unix_timestamp as u64,
            [0; 32], // Root degli account iniziale
            [0; 32], // Root delle transazioni iniziale
            [0; 32], // Hash dell'ultimo batch iniziale
            *sequencer_info.key,
        );
        
        // Salva lo stato nell'account
        let mut state_data = state_account_info.data.borrow_mut();
        state.pack_into_slice(&mut state_data);
        
        msg!("Layer-2 inizializzato con successo");
        
        Ok(())
    }
    
    /// Elabora un'istruzione di deposito
    fn process_deposit(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        amount: u64,
        data: Vec<u8>,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        let state_account_info = next_account_info(account_info_iter)?;
        let sender_info = next_account_info(account_info_iter)?;
        let recipient_info = next_account_info(account_info_iter)?;
        let system_program_info = next_account_info(account_info_iter)?;
        
        // Verifica che l'account di stato sia di proprietà del programma
        if state_account_info.owner != program_id {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che il mittente sia un firmatario
        if !sender_info.is_signer {
            return Err(handle_error(Layer2Error::InvalidSignature));
        }
        
        // Verifica che l'importo sia valido
        if amount == 0 {
            return Err(handle_error(Layer2Error::InvalidAmount));
        }
        
        // Verifica che il mittente abbia abbastanza fondi
        if sender_info.lamports() < amount {
            return Err(handle_error(Layer2Error::InsufficientBalance));
        }
        
        // Carica lo stato del Layer-2
        let state = Layer2State::unpack_from_slice(&state_account_info.data.borrow())?;
        
        // Verifica che lo stato sia inizializzato
        if !state.is_initialized {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Carica l'account del destinatario nel Layer-2
        let mut recipient_account = if recipient_info.data_len() == Account::LEN {
            Account::unpack_from_slice(&recipient_info.data.borrow())?
        } else {
            // Se l'account non esiste, lo creiamo
            Account::new(*recipient_info.key)
        };
        
        // Aggiorna il saldo dell'account del destinatario
        recipient_account.balance = recipient_account.balance.checked_add(amount)
            .ok_or(handle_error(Layer2Error::ArithmeticOverflow))?;
        
        // Trasferisci i fondi dal mittente al programma
        invoke(
            &system_instruction::transfer(
                sender_info.key,
                recipient_info.key,
                amount,
            ),
            &[
                sender_info.clone(),
                recipient_info.clone(),
                system_program_info.clone(),
            ],
        )?;
        
        // Salva l'account del destinatario
        recipient_account.pack_into_slice(&mut recipient_info.data.borrow_mut());
        
        msg!("Deposito completato con successo");
        
        Ok(())
    }
    
    /// Elabora un'istruzione di trasferimento
    fn process_transfer(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        amount: u64,
        nonce: u64,
        data: Vec<u8>,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        let state_account_info = next_account_info(account_info_iter)?;
        let sender_info = next_account_info(account_info_iter)?;
        let recipient_info = next_account_info(account_info_iter)?;
        
        // Verifica che l'account di stato sia di proprietà del programma
        if state_account_info.owner != program_id {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che il mittente sia un firmatario
        if !sender_info.is_signer {
            return Err(handle_error(Layer2Error::InvalidSignature));
        }
        
        // Verifica che l'importo sia valido
        if amount == 0 {
            return Err(handle_error(Layer2Error::InvalidAmount));
        }
        
        // Carica lo stato del Layer-2
        let state = Layer2State::unpack_from_slice(&state_account_info.data.borrow())?;
        
        // Verifica che lo stato sia inizializzato
        if !state.is_initialized {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Carica l'account del mittente nel Layer-2
        let mut sender_account = Account::unpack_from_slice(&sender_info.data.borrow())?;
        
        // Verifica che il mittente abbia abbastanza fondi
        if sender_account.balance < amount {
            return Err(handle_error(Layer2Error::InsufficientBalance));
        }
        
        // Verifica che il nonce sia valido
        if sender_account.nonce >= nonce {
            return Err(handle_error(Layer2Error::InvalidNonce));
        }
        
        // Carica l'account del destinatario nel Layer-2
        let mut recipient_account = if recipient_info.data_len() == Account::LEN {
            Account::unpack_from_slice(&recipient_info.data.borrow())?
        } else {
            // Se l'account non esiste, lo creiamo
            Account::new(*recipient_info.key)
        };
        
        // Aggiorna i saldi
        sender_account.balance = sender_account.balance.checked_sub(amount)
            .ok_or(handle_error(Layer2Error::ArithmeticUnderflow))?;
        
        recipient_account.balance = recipient_account.balance.checked_add(amount)
            .ok_or(handle_error(Layer2Error::ArithmeticOverflow))?;
        
        // Aggiorna il nonce del mittente
        sender_account.nonce = nonce;
        
        // Salva gli account
        sender_account.pack_into_slice(&mut sender_info.data.borrow_mut());
        recipient_account.pack_into_slice(&mut recipient_info.data.borrow_mut());
        
        msg!("Trasferimento completato con successo");
        
        Ok(())
    }
    
    /// Elabora un'istruzione di prelievo
    fn process_withdraw(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        amount: u64,
        nonce: u64,
        data: Vec<u8>,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        let state_account_info = next_account_info(account_info_iter)?;
        let sender_info = next_account_info(account_info_iter)?;
        let recipient_info = next_account_info(account_info_iter)?;
        let system_program_info = next_account_info(account_info_iter)?;
        
        // Verifica che l'account di stato sia di proprietà del programma
        if state_account_info.owner != program_id {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che il mittente sia un firmatario
        if !sender_info.is_signer {
            return Err(handle_error(Layer2Error::InvalidSignature));
        }
        
        // Verifica che l'importo sia valido
        if amount == 0 {
            return Err(handle_error(Layer2Error::InvalidAmount));
        }
        
        // Carica lo stato del Layer-2
        let state = Layer2State::unpack_from_slice(&state_account_info.data.borrow())?;
        
        // Verifica che lo stato sia inizializzato
        if !state.is_initialized {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Carica l'account del mittente nel Layer-2
        let mut sender_account = Account::unpack_from_slice(&sender_info.data.borrow())?;
        
        // Verifica che il mittente abbia abbastanza fondi
        if sender_account.balance < amount {
            return Err(handle_error(Layer2Error::InsufficientBalance));
        }
        
        // Verifica che il nonce sia valido
        if sender_account.nonce >= nonce {
            return Err(handle_error(Layer2Error::InvalidNonce));
        }
        
        // Aggiorna il saldo del mittente
        sender_account.balance = sender_account.balance.checked_sub(amount)
            .ok_or(handle_error(Layer2Error::ArithmeticUnderflow))?;
        
        // Aggiorna il nonce del mittente
        sender_account.nonce = nonce;
        
        // Trasferisci i fondi dal programma al destinatario
        // In un'implementazione reale, questo richiederebbe una firma del programma
        // e un'istruzione di trasferimento firmata
        
        // Salva l'account del mittente
        sender_account.pack_into_slice(&mut sender_info.data.borrow_mut());
        
        msg!("Prelievo completato con successo");
        
        Ok(())
    }
    
    /// Elabora un'istruzione di invio batch
    fn process_submit_batch(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        transactions_data: Vec<u8>,
        timestamp: u64,
        expiry_timestamp: u64,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        let state_account_info = next_account_info(account_info_iter)?;
        let sequencer_info = next_account_info(account_info_iter)?;
        let batch_account_info = next_account_info(account_info_iter)?;
        
        // Verifica che l'account di stato sia di proprietà del programma
        if state_account_info.owner != program_id {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che il sequencer sia un firmatario
        if !sequencer_info.is_signer {
            return Err(handle_error(Layer2Error::InvalidSignature));
        }
        
        // Carica lo stato del Layer-2
        let state = Layer2State::unpack_from_slice(&state_account_info.data.borrow())?;
        
        // Verifica che lo stato sia inizializzato
        if !state.is_initialized {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che il sequencer sia autorizzato
        if state.sequencer != *sequencer_info.key {
            return Err(handle_error(Layer2Error::Unauthorized));
        }
        
        // Deserializza le transazioni
        let transactions: Vec<Transaction> = match borsh::BorshDeserialize::try_from_slice(&transactions_data) {
            Ok(txs) => txs,
            Err(_) => return Err(handle_error(Layer2Error::DeserializationError)),
        };
        
        // Verifica che il batch non sia vuoto
        if transactions.is_empty() {
            return Err(handle_error(Layer2Error::EmptyBatch));
        }
        
        // Verifica che il batch non superi la dimensione massima
        if transactions.len() > 1024 {
            return Err(handle_error(Layer2Error::BatchTooLarge));
        }
        
        // Verifica che il timestamp sia valido
        let clock = Clock::get()?;
        if timestamp > clock.unix_timestamp as u64 {
            return Err(handle_error(Layer2Error::InvalidInstruction));
        }
        
        // Verifica che il timestamp di scadenza sia valido
        if expiry_timestamp <= clock.unix_timestamp as u64 {
            return Err(handle_error(Layer2Error::BatchExpired));
        }
        
        // Crea il batch
        let batch = Batch::new(
            transactions,
            *sequencer_info.key,
            timestamp,
            expiry_timestamp,
            vec![], // Firma vuota per ora
        );
        
        // Salva il batch nell'account
        let batch_data = batch.try_to_vec()?;
        let mut batch_account_data = batch_account_info.data.borrow_mut();
        
        if batch_account_data.len() < batch_data.len() {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        batch_account_data[..batch_data.len()].copy_from_slice(&batch_data);
        
        msg!("Batch inviato con successo");
        
        Ok(())
    }
    
    /// Elabora un'istruzione di verifica batch
    fn process_verify_batch(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        batch_id: [u8; 32],
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        let state_account_info = next_account_info(account_info_iter)?;
        let batch_account_info = next_account_info(account_info_iter)?;
        let transition_account_info = next_account_info(account_info_iter)?;
        
        // Verifica che l'account di stato sia di proprietà del programma
        if state_account_info.owner != program_id {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Carica lo stato del Layer-2
        let mut state = Layer2State::unpack_from_slice(&state_account_info.data.borrow())?;
        
        // Verifica che lo stato sia inizializzato
        if !state.is_initialized {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Carica il batch
        let batch: Batch = match borsh::BorshDeserialize::try_from_slice(&batch_account_info.data.borrow()) {
            Ok(b) => b,
            Err(_) => return Err(handle_error(Layer2Error::DeserializationError)),
        };
        
        // Verifica che il batch sia quello richiesto
        if batch.id != batch_id {
            return Err(handle_error(Layer2Error::InvalidBatch));
        }
        
        // Verifica che il batch non sia scaduto
        let clock = Clock::get()?;
        if batch.expiry_timestamp < clock.unix_timestamp as u64 {
            return Err(handle_error(Layer2Error::BatchExpired));
        }
        
        // Crea un validatore
        let validator = Validator::new(program_id);
        
        // Verifica il batch
        validator.validate_batch(&batch)?;
        
        // Calcola il nuovo stato
        let old_state_hash = state.hash();
        
        // Aggiorna lo stato
        state.block_number += 1;
        state.timestamp = clock.unix_timestamp as u64;
        state.last_batch_hash = batch.id;
        
        // Calcola il nuovo hash dello stato
        let new_state_hash = state.hash();
        
        // Crea la transizione di stato
        let transition = StateTransition::new(
            old_state_hash,
            new_state_hash,
            batch,
            clock.unix_timestamp as u64,
            vec![], // Firma vuota per ora
        );
        
        // Salva la transizione di stato nell'account
        let transition_data = transition.try_to_vec()?;
        let mut transition_account_data = transition_account_info.data.borrow_mut();
        
        if transition_account_data.len() < transition_data.len() {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        transition_account_data[..transition_data.len()].copy_from_slice(&transition_data);
        
        // Salva lo stato aggiornato
        state.pack_into_slice(&mut state_account_info.data.borrow_mut());
        
        msg!("Batch verificato con successo");
        
        Ok(())
    }
    
    /// Elabora un'istruzione di contestazione batch
    fn process_challenge_batch(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        batch_id: [u8; 32],
        proof_data: Vec<u8>,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        let state_account_info = next_account_info(account_info_iter)?;
        let challenger_info = next_account_info(account_info_iter)?;
        let batch_account_info = next_account_info(account_info_iter)?;
        let challenge_account_info = next_account_info(account_info_iter)?;
        
        // Verifica che l'account di stato sia di proprietà del programma
        if state_account_info.owner != program_id {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che lo sfidante sia un firmatario
        if !challenger_info.is_signer {
            return Err(handle_error(Layer2Error::InvalidSignature));
        }
        
        // Carica lo stato del Layer-2
        let state = Layer2State::unpack_from_slice(&state_account_info.data.borrow())?;
        
        // Verifica che lo stato sia inizializzato
        if !state.is_initialized {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Carica il batch
        let batch: Batch = match borsh::BorshDeserialize::try_from_slice(&batch_account_info.data.borrow()) {
            Ok(b) => b,
            Err(_) => return Err(handle_error(Layer2Error::DeserializationError)),
        };
        
        // Verifica che il batch sia quello richiesto
        if batch.id != batch_id {
            return Err(handle_error(Layer2Error::InvalidBatch));
        }
        
        // Deserializza la prova
        let proof: Proof = match borsh::BorshDeserialize::try_from_slice(&proof_data) {
            Ok(p) => p,
            Err(_) => return Err(handle_error(Layer2Error::DeserializationError)),
        };
        
        // Verifica la prova
        if !proof.verify()? {
            return Err(handle_error(Layer2Error::InvalidProof));
        }
        
        // Crea la sfida
        let clock = Clock::get()?;
        let challenge = Challenge::new(
            *challenger_info.key,
            state.hash(),
            proof,
            clock.unix_timestamp as u64,
            clock.unix_timestamp as u64 + 86400, // 24 ore di scadenza
        );
        
        // Salva la sfida nell'account
        let challenge_data = challenge.try_to_vec()?;
        let mut challenge_account_data = challenge_account_info.data.borrow_mut();
        
        if challenge_account_data.len() < challenge_data.len() {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        challenge_account_data[..challenge_data.len()].copy_from_slice(&challenge_data);
        
        msg!("Sfida creata con successo");
        
        Ok(())
    }
    
    /// Elabora un'istruzione di risoluzione sfida
    fn process_resolve_challenge(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        challenge_id: [u8; 32],
        response_data: Vec<u8>,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        let state_account_info = next_account_info(account_info_iter)?;
        let sequencer_info = next_account_info(account_info_iter)?;
        let challenge_account_info = next_account_info(account_info_iter)?;
        let batch_account_info = next_account_info(account_info_iter)?;
        
        // Verifica che l'account di stato sia di proprietà del programma
        if state_account_info.owner != program_id {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che il sequencer sia un firmatario
        if !sequencer_info.is_signer {
            return Err(handle_error(Layer2Error::InvalidSignature));
        }
        
        // Carica lo stato del Layer-2
        let state = Layer2State::unpack_from_slice(&state_account_info.data.borrow())?;
        
        // Verifica che lo stato sia inizializzato
        if !state.is_initialized {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che il sequencer sia autorizzato
        if state.sequencer != *sequencer_info.key {
            return Err(handle_error(Layer2Error::Unauthorized));
        }
        
        // Carica la sfida
        let mut challenge: Challenge = match borsh::BorshDeserialize::try_from_slice(&challenge_account_info.data.borrow()) {
            Ok(c) => c,
            Err(_) => return Err(handle_error(Layer2Error::DeserializationError)),
        };
        
        // Verifica che la sfida sia quella richiesta
        if challenge.id != challenge_id {
            return Err(handle_error(Layer2Error::InvalidChallenge));
        }
        
        // Verifica che la sfida non sia già risolta
        if challenge.is_resolved {
            return Err(handle_error(Layer2Error::InvalidChallenge));
        }
        
        // Verifica che la sfida non sia scaduta
        let clock = Clock::get()?;
        if challenge.expiry_timestamp < clock.unix_timestamp as u64 {
            return Err(handle_error(Layer2Error::ChallengeExpired));
        }
        
        // Verifica la risposta
        // In un'implementazione reale, verificheremmo la risposta crittografica
        
        // Aggiorna la sfida
        challenge.is_resolved = true;
        challenge.is_successful = false; // La sfida non ha avuto successo
        
        // Salva la sfida aggiornata
        let challenge_data = challenge.try_to_vec()?;
        let mut challenge_account_data = challenge_account_info.data.borrow_mut();
        
        if challenge_account_data.len() < challenge_data.len() {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        challenge_account_data[..challenge_data.len()].copy_from_slice(&challenge_data);
        
        msg!("Sfida risolta con successo");
        
        Ok(())
    }
    
    /// Elabora un'istruzione di aggiornamento sequencer
    fn process_update_sequencer(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        new_sequencer: Pubkey,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        let state_account_info = next_account_info(account_info_iter)?;
        let current_sequencer_info = next_account_info(account_info_iter)?;
        let new_sequencer_info = next_account_info(account_info_iter)?;
        
        // Verifica che l'account di stato sia di proprietà del programma
        if state_account_info.owner != program_id {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che il sequencer attuale sia un firmatario
        if !current_sequencer_info.is_signer {
            return Err(handle_error(Layer2Error::InvalidSignature));
        }
        
        // Carica lo stato del Layer-2
        let mut state = Layer2State::unpack_from_slice(&state_account_info.data.borrow())?;
        
        // Verifica che lo stato sia inizializzato
        if !state.is_initialized {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che il sequencer attuale sia autorizzato
        if state.sequencer != *current_sequencer_info.key {
            return Err(handle_error(Layer2Error::Unauthorized));
        }
        
        // Verifica che il nuovo sequencer sia valido
        if new_sequencer == Pubkey::default() {
            return Err(handle_error(Layer2Error::InvalidSequencer));
        }
        
        // Aggiorna il sequencer
        state.sequencer = new_sequencer;
        
        // Salva lo stato aggiornato
        state.pack_into_slice(&mut state_account_info.data.borrow_mut());
        
        msg!("Sequencer aggiornato con successo");
        
        Ok(())
    }
    
    /// Elabora un'istruzione di aggiornamento parametri
    fn process_update_parameters(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        parameters: Vec<u8>,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        let state_account_info = next_account_info(account_info_iter)?;
        let sequencer_info = next_account_info(account_info_iter)?;
        
        // Verifica che l'account di stato sia di proprietà del programma
        if state_account_info.owner != program_id {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che il sequencer sia un firmatario
        if !sequencer_info.is_signer {
            return Err(handle_error(Layer2Error::InvalidSignature));
        }
        
        // Carica lo stato del Layer-2
        let state = Layer2State::unpack_from_slice(&state_account_info.data.borrow())?;
        
        // Verifica che lo stato sia inizializzato
        if !state.is_initialized {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che il sequencer sia autorizzato
        if state.sequencer != *sequencer_info.key {
            return Err(handle_error(Layer2Error::Unauthorized));
        }
        
        // In un'implementazione reale, qui aggiorneremmo i parametri del sistema
        
        msg!("Parametri aggiornati con successo");
        
        Ok(())
    }
    
    /// Elabora un'istruzione di creazione account
    fn process_create_account(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        initial_balance: u64,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        let state_account_info = next_account_info(account_info_iter)?;
        let owner_info = next_account_info(account_info_iter)?;
        let new_account_info = next_account_info(account_info_iter)?;
        let system_program_info = next_account_info(account_info_iter)?;
        let rent_info = next_account_info(account_info_iter)?;
        
        // Verifica che l'account di stato sia di proprietà del programma
        if state_account_info.owner != program_id {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che il proprietario sia un firmatario
        if !owner_info.is_signer {
            return Err(handle_error(Layer2Error::InvalidSignature));
        }
        
        // Carica lo stato del Layer-2
        let state = Layer2State::unpack_from_slice(&state_account_info.data.borrow())?;
        
        // Verifica che lo stato sia inizializzato
        if !state.is_initialized {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che l'account non esista già
        if new_account_info.data_len() == Account::LEN {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Crea l'account
        let rent = Rent::from_account_info(rent_info)?;
        let space = Account::LEN;
        let lamports = rent.minimum_balance(space);
        
        invoke(
            &system_instruction::create_account(
                owner_info.key,
                new_account_info.key,
                lamports,
                space as u64,
                program_id,
            ),
            &[
                owner_info.clone(),
                new_account_info.clone(),
                system_program_info.clone(),
            ],
        )?;
        
        // Inizializza l'account
        let account = Account::new(*new_account_info.key);
        
        // Salva l'account
        account.pack_into_slice(&mut new_account_info.data.borrow_mut());
        
        msg!("Account creato con successo");
        
        Ok(())
    }
    
    /// Elabora un'istruzione di chiusura account
    fn process_close_account(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        let state_account_info = next_account_info(account_info_iter)?;
        let owner_info = next_account_info(account_info_iter)?;
        let account_info = next_account_info(account_info_iter)?;
        let recipient_info = next_account_info(account_info_iter)?;
        
        // Verifica che l'account di stato sia di proprietà del programma
        if state_account_info.owner != program_id {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che il proprietario sia un firmatario
        if !owner_info.is_signer {
            return Err(handle_error(Layer2Error::InvalidSignature));
        }
        
        // Carica lo stato del Layer-2
        let state = Layer2State::unpack_from_slice(&state_account_info.data.borrow())?;
        
        // Verifica che lo stato sia inizializzato
        if !state.is_initialized {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Carica l'account
        let account = Account::unpack_from_slice(&account_info.data.borrow())?;
        
        // Verifica che l'account sia inizializzato
        if !account.is_initialized {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che il saldo sia zero
        if account.balance > 0 {
            return Err(handle_error(Layer2Error::InsufficientBalance));
        }
        
        // Trasferisci i lamports al destinatario
        let lamports = account_info.lamports();
        **account_info.lamports.borrow_mut() = 0;
        **recipient_info.lamports.borrow_mut() += lamports;
        
        // Azzera i dati dell'account
        let mut account_data = account_info.data.borrow_mut();
        account_data.fill(0);
        
        msg!("Account chiuso con successo");
        
        Ok(())
    }
    
    /// Elabora un'istruzione di esecuzione transizione di stato
    fn process_execute_state_transition(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        from_state_hash: [u8; 32],
        to_state_hash: [u8; 32],
        batch_id: [u8; 32],
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        let state_account_info = next_account_info(account_info_iter)?;
        let sequencer_info = next_account_info(account_info_iter)?;
        let transition_account_info = next_account_info(account_info_iter)?;
        
        // Verifica che l'account di stato sia di proprietà del programma
        if state_account_info.owner != program_id {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che il sequencer sia un firmatario
        if !sequencer_info.is_signer {
            return Err(handle_error(Layer2Error::InvalidSignature));
        }
        
        // Carica lo stato del Layer-2
        let mut state = Layer2State::unpack_from_slice(&state_account_info.data.borrow())?;
        
        // Verifica che lo stato sia inizializzato
        if !state.is_initialized {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica che il sequencer sia autorizzato
        if state.sequencer != *sequencer_info.key {
            return Err(handle_error(Layer2Error::Unauthorized));
        }
        
        // Verifica che lo stato corrente corrisponda allo stato iniziale
        let current_state_hash = state.hash();
        if current_state_hash != from_state_hash {
            return Err(handle_error(Layer2Error::InvalidStateTransition));
        }
        
        // In un'implementazione reale, qui verificheremmo che la transizione di stato sia valida
        // applicando le transazioni del batch allo stato corrente e verificando che lo stato risultante
        // corrisponda allo stato finale
        
        // Aggiorna lo stato
        state.block_number += 1;
        state.last_batch_hash = batch_id;
        
        let clock = Clock::get()?;
        state.timestamp = clock.unix_timestamp as u64;
        
        // Verifica che lo stato aggiornato corrisponda allo stato finale
        let new_state_hash = state.hash();
        if new_state_hash != to_state_hash {
            return Err(handle_error(Layer2Error::InvalidStateTransition));
        }
        
        // Salva lo stato aggiornato
        state.pack_into_slice(&mut state_account_info.data.borrow_mut());
        
        // Crea la transizione di stato
        let transition = StateTransition::new(
            from_state_hash,
            to_state_hash,
            Batch::new(
                vec![], // Transazioni vuote per ora
                *sequencer_info.key,
                clock.unix_timestamp as u64,
                clock.unix_timestamp as u64 + 86400, // 24 ore di scadenza
                vec![], // Firma vuota per ora
            ),
            clock.unix_timestamp as u64,
            vec![], // Firma vuota per ora
        );
        
        // Salva la transizione di stato
        let transition_data = transition.try_to_vec()?;
        let mut transition_account_data = transition_account_info.data.borrow_mut();
        
        if transition_account_data.len() < transition_data.len() {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        transition_account_data[..transition_data.len()].copy_from_slice(&transition_data);
        
        msg!("Transizione di stato eseguita con successo");
        
        Ok(())
    }
    
    /// Elabora un'istruzione di verifica prova di Merkle
    fn process_verify_merkle_proof(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        leaf: [u8; 32],
        proof: Vec<[u8; 32]>,
        root: [u8; 32],
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        
        let state_account_info = next_account_info(account_info_iter)?;
        
        // Verifica che l'account di stato sia di proprietà del programma
        if state_account_info.owner != program_id {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Carica lo stato del Layer-2
        let state = Layer2State::unpack_from_slice(&state_account_info.data.borrow())?;
        
        // Verifica che lo stato sia inizializzato
        if !state.is_initialized {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Verifica la prova di Merkle
        let result = MerkleTree::verify_proof(leaf, &proof, root);
        
        if !result {
            return Err(handle_error(Layer2Error::InvalidMerkleProof));
        }
        
        msg!("Prova di Merkle verificata con successo");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_program::clock::Epoch;
    
    // Test per process_initialize
    #[test]
    fn test_process_initialize() {
        // Crea un program_id
        let program_id = Pubkey::new_unique();
        
        // Crea gli account necessari
        let state_key = Pubkey::new_unique();
        let sequencer_key = Pubkey::new_unique();
        
        let mut state_lamports = 0;
        let mut state_data = vec![0; Layer2State::LEN];
        let state_account_info = AccountInfo::new(
            &state_key,
            true,
            true,
            &mut state_lamports,
            &mut state_data,
            &program_id,
            false,
            Epoch::default(),
        );
        
        let mut sequencer_lamports = 1000000;
        let mut sequencer_data = vec![];
        let sequencer_account_info = AccountInfo::new(
            &sequencer_key,
            true,
            false,
            &mut sequencer_lamports,
            &mut sequencer_data,
            &Pubkey::default(),
            false,
            Epoch::default(),
        );
        
        let mut system_program_lamports = 0;
        let mut system_program_data = vec![];
        let system_program_account_info = AccountInfo::new(
            &solana_program::system_program::id(),
            false,
            false,
            &mut system_program_lamports,
            &mut system_program_data,
            &Pubkey::default(),
            false,
            Epoch::default(),
        );
        
        let mut rent_lamports = 0;
        let mut rent_data = vec![];
        let rent_account_info = AccountInfo::new(
            &solana_program::sysvar::rent::id(),
            false,
            false,
            &mut rent_lamports,
            &mut rent_data,
            &Pubkey::default(),
            false,
            Epoch::default(),
        );
        
        let accounts = vec![
            state_account_info,
            sequencer_account_info,
            system_program_account_info,
            rent_account_info,
        ];
        
        // Esegui l'istruzione
        let result = Processor::process_initialize(&program_id, &accounts, 1);
        
        // Verifica che l'istruzione sia stata eseguita con successo
        assert!(result.is_ok());
    }
    
    // Altri test...
}
