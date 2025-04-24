/**
 * Modulo di elaborazione dei depositi per il Layer-2 su Solana
 * 
 * Questo modulo implementa le funzionalità specifiche per l'elaborazione
 * delle operazioni di deposito nel sistema Layer-2.
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
use crate::state::{
    Layer2State, 
    Transaction, 
    TransactionStatus, 
    TransactionType,
    Account, 
    MerkleTree
};
use crate::validation::Validator;

/// Struttura per il processore dei depositi
pub struct DepositProcessor {}

impl DepositProcessor {
    /// Elabora un deposito
    pub fn process_deposit(
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
        let mut state = Layer2State::unpack_from_slice(&state_account_info.data.borrow())?;
        
        // Verifica che lo stato sia inizializzato
        if !state.is_initialized {
            return Err(handle_error(Layer2Error::InvalidAccountData));
        }
        
        // Carica l'account del destinatario nel Layer-2
        let mut recipient_account = if recipient_info.data_len() == Account::LEN && recipient_info.owner == program_id {
            Account::unpack_from_slice(&recipient_info.data.borrow())?
        } else {
            // Se l'account non esiste o non è di proprietà del programma, lo creiamo
            Self::create_layer2_account(
                program_id,
                recipient_info,
                sender_info,
                system_program_info,
                next_account_info(account_info_iter)?, // rent_info
            )?;
            
            Account::new(*recipient_info.key)
        };
        
        // Aggiorna il saldo dell'account del destinatario
        recipient_account.balance = recipient_account.balance.checked_add(amount)
            .ok_or(handle_error(Layer2Error::ArithmeticOverflow))?;
        
        // Trasferisci i fondi dal mittente al programma
        invoke(
            &system_instruction::transfer(
                sender_info.key,
                state_account_info.key, // I fondi vanno al programma
                amount,
            ),
            &[
                sender_info.clone(),
                state_account_info.clone(),
                system_program_info.clone(),
            ],
        )?;
        
        // Crea una transazione di deposito
        let clock = Clock::get()?;
        
        // Calcola il nuovo nonce in modo sicuro
        let new_nonce = recipient_account.nonce.checked_add(1)
            .ok_or(handle_error(Layer2Error::ArithmeticOverflow))?;
        
        // Calcola il timestamp di scadenza in modo sicuro
        let current_timestamp = clock.unix_timestamp as u64;
        let expiry_timestamp = current_timestamp.checked_add(3600) // 1 ora di scadenza
            .ok_or(handle_error(Layer2Error::ArithmeticOverflow))?;
        
        let transaction = Transaction::new(
            *sender_info.key,
            *recipient_info.key,
            amount,
            new_nonce,
            expiry_timestamp,
            TransactionType::Deposit,
            data,
            vec![], // Firma vuota per ora
        );
        
        // Aggiorna il nonce dell'account del destinatario in modo sicuro
        recipient_account.nonce = new_nonce;
        
        // Aggiorna lo stato del Layer-2
        // In un'implementazione reale, aggiorneremmo l'albero di Merkle degli account
        // e l'albero di Merkle delle transazioni
        
        // Salva l'account del destinatario
        recipient_account.pack_into_slice(&mut recipient_info.data.borrow_mut());
        
        // Salva lo stato aggiornato
        state.pack_into_slice(&mut state_account_info.data.borrow_mut());
        
        msg!("Deposito completato con successo");
        
        Ok(())
    }
    
    /// Crea un account Layer-2
    fn create_layer2_account(
        program_id: &Pubkey,
        account_info: &AccountInfo,
        payer_info: &AccountInfo,
        system_program_info: &AccountInfo,
        rent_info: &AccountInfo,
    ) -> ProgramResult {
        // Verifica che il pagatore sia un firmatario
        if !payer_info.is_signer {
            return Err(handle_error(Layer2Error::InvalidSignature));
        }
        
        // Calcola lo spazio e i lamports necessari
        let rent = Rent::from_account_info(rent_info)?;
        let space = Account::LEN;
        let lamports = rent.minimum_balance(space);
        
        // Verifica che il pagatore abbia abbastanza lamports
        if payer_info.lamports() < lamports {
            return Err(handle_error(Layer2Error::InsufficientBalance));
        }
        
        // Crea l'account
        invoke(
            &system_instruction::create_account(
                payer_info.key,
                account_info.key,
                lamports,
                space as u64,
                program_id,
            ),
            &[
                payer_info.clone(),
                account_info.clone(),
                system_program_info.clone(),
            ],
        )?;
        
        msg!("Account Layer-2 creato con successo");
        
        Ok(())
    }
    
    /// Verifica un deposito
    pub fn verify_deposit(
        program_id: &Pubkey,
        transaction: &Transaction,
        state: &Layer2State,
    ) -> ProgramResult {
        // Verifica che la transazione sia di tipo deposito
        if transaction.transaction_type != TransactionType::Deposit {
            return Err(handle_error(Layer2Error::InvalidInstruction));
        }
        
        // Crea un validatore
        let validator = Validator::new(program_id);
        
        // Verifica la transazione
        validator.validate_transaction(transaction)?;
        
        // Verifica il deposito
        validator.validate_deposit(
            transaction.amount,
            &transaction.sender,
            &transaction.recipient,
        )?;
        
        msg!("Deposito verificato con successo");
        
        Ok(())
    }
    
    /// Elabora un batch di depositi
    pub fn process_deposit_batch(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        transactions_data: Vec<u8>,
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
        let mut state = Layer2State::unpack_from_slice(&state_account_info.data.borrow())?;
        
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
        // Utilizziamo una costante per la dimensione massima del batch
        const MAX_BATCH_SIZE: usize = 1024;
        if transactions.len() > MAX_BATCH_SIZE {
            return Err(handle_error(Layer2Error::BatchTooLarge));
        }
        
        // Verifica che tutte le transazioni siano di tipo deposito
        for transaction in &transactions {
            if transaction.transaction_type != TransactionType::Deposit {
                return Err(handle_error(Layer2Error::InvalidInstruction));
            }
        }
        
        // Crea un validatore
        let validator = Validator::new(program_id);
        
        // Elabora ogni transazione
        for transaction in &transactions {
            // Verifica la transazione
            validator.validate_transaction(transaction)?;
            
            // Verifica il deposito
            validator.validate_deposit(
                transaction.amount,
                &transaction.sender,
                &transaction.recipient,
            )?;
            
            // In un'implementazione reale, qui aggiorneremmo gli account
            // e lo stato del Layer-2
        }
        
        // Aggiorna lo stato del Layer-2
        // In un'implementazione reale, aggiorneremmo l'albero di Merkle degli account
        // e l'albero di Merkle delle transazioni
        
        // Salva lo stato aggiornato
        state.pack_into_slice(&mut state_account_info.data.borrow_mut());
        
        msg!("Batch di depositi elaborato con successo");
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_program::clock::Epoch;
    
    // Test per process_deposit
    #[test]
    fn test_process_deposit() {
        // Crea un program_id
        let program_id = Pubkey::new_unique();
        
        // Crea gli account necessari
        let state_key = Pubkey::new_unique();
        let sender_key = Pubkey::new_unique();
        let recipient_key = Pubkey::new_unique();
        
        let mut state_lamports = 0;
        let mut state_data = vec![0; Layer2State::LEN];
        let state_account_info = AccountInfo::new(
            &state_key,
            false,
            true,
            &mut state_lamports,
            &mut state_data,
            &program_id,
            false,
            Epoch::default(),
        );
        
        let mut sender_lamports = 1000000;
        let mut sender_data = vec![];
        let sender_account_info = AccountInfo::new(
            &sender_key,
            true,
            false,
            &mut sender_lamports,
            &mut sender_data,
            &Pubkey::default(),
            false,
            Epoch::default(),
        );
        
        let mut recipient_lamports = 0;
        let mut recipient_data = vec![0; Account::LEN];
        let recipient_account_info = AccountInfo::new(
            &recipient_key,
            false,
            true,
            &mut recipient_lamports,
            &mut recipient_data,
            &program_id,
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
            sender_account_info,
            recipient_account_info,
            system_program_account_info,
            rent_account_info,
        ];
        
        // Inizializza lo stato
        let state = Layer2State::new(
            1,
            0,
            0,
            [0; 32],
            [0; 32],
            [0; 32],
            sender_key,
        );
        state.pack_into_slice(&mut state_data);
        
        // Inizializza l'account del destinatario
        let recipient_account = Account::new(recipient_key);
        recipient_account.pack_into_slice(&mut recipient_data);
        
        // Esegui il deposito
        let result = DepositProcessor::process_deposit(
            &program_id,
            &accounts,
            1000,
            vec![1, 2, 3],
        );
        
        // Verifica che il deposito sia stato eseguito con successo
        assert!(result.is_ok());
    }
    
    // Test per verificare la gestione degli overflow aritmetici
    #[test]
    fn test_arithmetic_overflow() {
        // Crea un program_id
        let program_id = Pubkey::new_unique();
        
        // Crea gli account necessari
        let state_key = Pubkey::new_unique();
        let sender_key = Pubkey::new_unique();
        let recipient_key = Pubkey::new_unique();
        
        let mut state_lamports = 0;
        let mut state_data = vec![0; Layer2State::LEN];
        let state_account_info = AccountInfo::new(
            &state_key,
            false,
            true,
            &mut state_lamports,
            &mut state_data,
            &program_id,
            false,
            Epoch::default(),
        );
        
        let mut sender_lamports = u64::MAX;
        let mut sender_data = vec![];
        let sender_account_info = AccountInfo::new(
            &sender_key,
            true,
            false,
            &mut sender_lamports,
            &mut sender_data,
            &Pubkey::default(),
            false,
            Epoch::default(),
        );
        
        let mut recipient_lamports = 0;
        let mut recipient_data = vec![0; Account::LEN];
        let recipient_account_info = AccountInfo::new(
            &recipient_key,
            false,
            true,
            &mut recipient_lamports,
            &mut recipient_data,
            &program_id,
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
            sender_account_info,
            recipient_account_info,
            system_program_account_info,
            rent_account_info,
        ];
        
        // Inizializza lo stato
        let state = Layer2State::new(
            1,
            0,
            0,
            [0; 32],
            [0; 32],
            [0; 32],
            sender_key,
        );
        state.pack_into_slice(&mut state_data);
        
        // Inizializza l'account del destinatario con un saldo massimo
        let mut recipient_account = Account::new(recipient_key);
        recipient_account.balance = u64::MAX - 100; // Quasi al massimo
        recipient_account.pack_into_slice(&mut recipient_data);
        
        // Esegui il deposito con un importo che causerebbe overflow
        let result = DepositProcessor::process_deposit(
            &program_id,
            &accounts,
            101, // Questo causerebbe overflow
            vec![1, 2, 3],
        );
        
        // Verifica che il deposito fallisca con errore di overflow aritmetico
        assert!(result.is_err());
        if let Err(err) = result {
            assert_eq!(err, Layer2Error::ArithmeticOverflow.into());
        }
    }
}
