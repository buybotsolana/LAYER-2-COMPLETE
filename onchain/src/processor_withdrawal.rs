/**
 * Modulo per il processamento dei prelievi nel Layer-2 su Solana
 * 
 * Questo modulo implementa le funzioni per gestire i prelievi dal Layer-2,
 * con protezioni avanzate anti-double-spending e validazione multi-fase.
 */

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::{clock::Clock, rent::Rent, Sysvar},
    program_pack::{IsInitialized, Pack},
    keccak,
    hash::{hash, Hash},
};
use std::convert::TryInto;
use std::mem::size_of;
use crate::error::Layer2Error;
use crate::state::{
    Layer2State, 
    Transaction, 
    TransactionStatus, 
    Batch, 
    Account, 
    Proof, 
    Challenge,
    MerkleTree,
    StateTransition,
    TransactionHistory,
    WithdrawalRequest,
    WithdrawalProof
};
use crate::validation::{Validator, ValidationLevel};

/// Struttura per il processore di prelievi
pub struct WithdrawalProcessor {
    /// Validatore per le verifiche di sicurezza
    validator: Validator,
}

impl WithdrawalProcessor {
    /// Crea un nuovo processore di prelievi
    pub fn new(program_id: &Pubkey) -> Self {
        Self {
            validator: Validator::new(program_id),
        }
    }

    /// Processa una richiesta di prelievo
    pub fn process_withdrawal(
        &self,
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        withdrawal_data: &[u8],
    ) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        
        // Ottieni gli account necessari
        let withdrawal_account = next_account_info(accounts_iter)?;
        let state_account = next_account_info(accounts_iter)?;
        let history_account = next_account_info(accounts_iter)?;
        let user_account = next_account_info(accounts_iter)?;
        let system_program = next_account_info(accounts_iter)?;
        
        // Verifica che gli account siano di proprietà del programma
        self.validator.validate_account_owner(withdrawal_account)?;
        self.validator.validate_account_owner(state_account)?;
        self.validator.validate_account_owner(history_account)?;
        
        // Verifica che l'account utente sia un firmatario
        self.validator.validate_is_signer(user_account)?;
        
        // Deserializza la richiesta di prelievo
        let withdrawal_request = WithdrawalRequest::unpack(withdrawal_data)?;
        
        // Verifica che la richiesta di prelievo sia valida
        self.validate_withdrawal_request(&withdrawal_request, user_account, state_account, history_account)?;
        
        // Processa il prelievo
        self.execute_withdrawal(&withdrawal_request, user_account, state_account, history_account)?;
        
        // Registra il prelievo nella cronologia
        self.record_withdrawal(&withdrawal_request, history_account)?;
        
        Ok(())
    }

    /// Valida una richiesta di prelievo con protezione anti-double-spending
    fn validate_withdrawal_request(
        &self,
        withdrawal_request: &WithdrawalRequest,
        user_account: &AccountInfo,
        state_account: &AccountInfo,
        history_account: &AccountInfo,
    ) -> ProgramResult {
        // Verifica che l'utente sia il mittente della transazione
        if withdrawal_request.transaction.sender != *user_account.key {
            msg!("L'utente non è il mittente della transazione");
            return Err(Layer2Error::InvalidSender.into());
        }
        
        // Verifica che il tipo di transazione sia un prelievo
        if withdrawal_request.transaction.transaction_type != 2 {
            msg!("La transazione non è un prelievo");
            return Err(Layer2Error::InvalidTransactionType.into());
        }
        
        // Esegui la validazione multi-fase della transazione
        let validation_results = self.validator.validate_transaction_multi_phase(
            &withdrawal_request.transaction,
            Some(history_account),
            Some(state_account),
        );
        
        // Verifica che tutte le fasi di validazione siano passate
        for result in &validation_results {
            if let Err(err) = &result.result {
                msg!("Validazione fallita al livello {:?}: {:?}", result.level, err);
                return Err(err.clone());
            }
        }
        
        // Verifica la prova di inclusione nel batch
        self.validator.validate_transaction_in_batch(
            &withdrawal_request.transaction,
            &withdrawal_request.proof,
            &withdrawal_request.batch,
        )?;
        
        // Verifica che il batch sia valido
        let batch_validation_results = self.validator.validate_batch_multi_phase(
            &withdrawal_request.batch,
            Some(history_account),
            Some(state_account),
        );
        
        // Verifica che tutte le fasi di validazione del batch siano passate
        for result in &batch_validation_results {
            if let Err(err) = &result.result {
                msg!("Validazione del batch fallita al livello {:?}: {:?}", result.level, err);
                return Err(err.clone());
            }
        }
        
        // Verifica che il prelievo non sia già stato elaborato (anti-double-spending)
        self.validate_withdrawal_not_processed(withdrawal_request, history_account)?;
        
        // Verifica il periodo di attesa per il prelievo
        self.validate_withdrawal_waiting_period(withdrawal_request)?;
        
        Ok(())
    }

    /// Verifica che il prelievo non sia già stato elaborato (anti-double-spending)
    fn validate_withdrawal_not_processed(
        &self,
        withdrawal_request: &WithdrawalRequest,
        history_account: &AccountInfo,
    ) -> ProgramResult {
        // Deserializza la cronologia delle transazioni
        let history_data = history_account.try_borrow_data()?;
        let history = TransactionHistory::unpack(&history_data)?;
        
        // Calcola l'hash della transazione di prelievo
        let mut tx_data = Vec::new();
        let tx = &withdrawal_request.transaction;
        tx_data.extend_from_slice(&tx.sender.to_bytes());
        tx_data.extend_from_slice(&tx.recipient.to_bytes());
        tx_data.extend_from_slice(&tx.amount.to_le_bytes());
        tx_data.extend_from_slice(&tx.nonce.to_le_bytes());
        tx_data.extend_from_slice(&tx.expiry_timestamp.to_le_bytes());
        tx_data.push(tx.transaction_type as u8);
        tx_data.extend_from_slice(&(tx.data.len() as u32).to_le_bytes());
        tx_data.extend_from_slice(&tx.data);
        
        let tx_hash = keccak::hash(&tx_data).to_bytes();
        
        // Verifica che l'hash della transazione non sia già presente nella cronologia dei prelievi
        for processed_withdrawal in &history.processed_withdrawals {
            if processed_withdrawal.transaction_hash == tx_hash {
                msg!("Prelievo già elaborato (double-spending)");
                return Err(Layer2Error::WithdrawalAlreadyProcessed.into());
            }
        }
        
        // Verifica che il nonce non sia già stato utilizzato
        for spent_nonce in &history.spent_nonces {
            if spent_nonce.sender == tx.sender && spent_nonce.nonce == tx.nonce {
                msg!("Nonce già utilizzato (double-spending)");
                return Err(Layer2Error::NonceAlreadyUsed.into());
            }
        }
        
        Ok(())
    }

    /// Verifica il periodo di attesa per il prelievo
    fn validate_withdrawal_waiting_period(
        &self,
        withdrawal_request: &WithdrawalRequest,
    ) -> ProgramResult {
        // Ottieni il timestamp corrente
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp as u64;
        
        // Verifica che sia trascorso il periodo di attesa minimo
        const WITHDRAWAL_WAITING_PERIOD: u64 = 86400; // 24 ore
        
        if current_time < withdrawal_request.batch.expiry_timestamp + WITHDRAWAL_WAITING_PERIOD {
            let remaining_time = withdrawal_request.batch.expiry_timestamp + WITHDRAWAL_WAITING_PERIOD - current_time;
            msg!("Periodo di attesa per il prelievo non ancora trascorso. Rimanenti: {} secondi", remaining_time);
            return Err(Layer2Error::WithdrawalWaitingPeriod.into());
        }
        
        // Verifica che il prelievo non sia scaduto
        const WITHDRAWAL_EXPIRY_PERIOD: u64 = 604800; // 7 giorni
        
        if current_time > withdrawal_request.batch.expiry_timestamp + WITHDRAWAL_EXPIRY_PERIOD {
            msg!("Prelievo scaduto");
            return Err(Layer2Error::WithdrawalExpired.into());
        }
        
        Ok(())
    }

    /// Esegue il prelievo
    fn execute_withdrawal(
        &self,
        withdrawal_request: &WithdrawalRequest,
        user_account: &AccountInfo,
        state_account: &AccountInfo,
        history_account: &AccountInfo,
    ) -> ProgramResult {
        // Deserializza lo stato
        let mut state_data = state_account.try_borrow_mut_data()?;
        let mut state = Layer2State::unpack(&state_data)?;
        
        // Trova l'account del mittente
        let sender_idx = state.accounts.iter()
            .position(|a| a.address == withdrawal_request.transaction.sender)
            .ok_or(Layer2Error::AccountNotFound)?;
        
        // Verifica che il mittente abbia un saldo sufficiente
        if state.accounts[sender_idx].balance < withdrawal_request.transaction.amount {
            msg!("Saldo insufficiente");
            return Err(Layer2Error::InsufficientBalance.into());
        }
        
        // Aggiorna il saldo del mittente
        state.accounts[sender_idx].balance -= withdrawal_request.transaction.amount;
        
        // Aggiorna il nonce del mittente
        state.accounts[sender_idx].nonce = withdrawal_request.transaction.nonce;
        
        // Serializza lo stato aggiornato
        Layer2State::pack(state, &mut state_data)?;
        
        // Trasferisci i fondi all'utente (in un'implementazione reale, questo richiederebbe
        // un'istruzione di trasferimento del sistema)
        
        Ok(())
    }

    /// Registra il prelievo nella cronologia
    fn record_withdrawal(
        &self,
        withdrawal_request: &WithdrawalRequest,
        history_account: &AccountInfo,
    ) -> ProgramResult {
        // Deserializza la cronologia delle transazioni
        let mut history_data = history_account.try_borrow_mut_data()?;
        let mut history = TransactionHistory::unpack(&history_data)?;
        
        // Calcola l'hash della transazione di prelievo
        let mut tx_data = Vec::new();
        let tx = &withdrawal_request.transaction;
        tx_data.extend_from_slice(&tx.sender.to_bytes());
        tx_data.extend_from_slice(&tx.recipient.to_bytes());
        tx_data.extend_from_slice(&tx.amount.to_le_bytes());
        tx_data.extend_from_slice(&tx.nonce.to_le_bytes());
        tx_data.extend_from_slice(&tx.expiry_timestamp.to_le_bytes());
        tx_data.push(tx.transaction_type as u8);
        tx_data.extend_from_slice(&(tx.data.len() as u32).to_le_bytes());
        tx_data.extend_from_slice(&tx.data);
        
        let tx_hash = keccak::hash(&tx_data).to_bytes();
        
        // Ottieni il timestamp corrente
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp as u64;
        
        // Aggiungi il prelievo alla cronologia
        history.processed_withdrawals.push(WithdrawalProof {
            transaction_hash: tx_hash,
            amount: tx.amount,
            recipient: tx.recipient,
            timestamp: current_time,
            batch_merkle_root: withdrawal_request.batch.merkle_root,
        });
        
        // Aggiungi il nonce alla lista dei nonce utilizzati
        history.spent_nonces.push(SpentNonce {
            sender: tx.sender,
            nonce: tx.nonce,
            timestamp: current_time,
        });
        
        // Serializza la cronologia aggiornata
        TransactionHistory::pack(history, &mut history_data)?;
        
        Ok(())
    }

    /// Sfida un prelievo
    pub fn challenge_withdrawal(
        &self,
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        challenge_data: &[u8],
    ) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();
        
        // Ottieni gli account necessari
        let challenge_account = next_account_info(accounts_iter)?;
        let withdrawal_account = next_account_info(accounts_iter)?;
        let state_account = next_account_info(accounts_iter)?;
        let history_account = next_account_info(accounts_iter)?;
        let challenger_account = next_account_info(accounts_iter)?;
        
        // Verifica che gli account siano di proprietà del programma
        self.validator.validate_account_owner(challenge_account)?;
        self.validator.validate_account_owner(withdrawal_account)?;
        self.validator.validate_account_owner(state_account)?;
        self.validator.validate_account_owner(history_account)?;
        
        // Verifica che l'account sfidante sia un firmatario
        self.validator.validate_is_signer(challenger_account)?;
        
        // Deserializza la sfida
        let challenge = Challenge::unpack(challenge_data)?;
        
        // Verifica che lo sfidante sia corretto
        if challenge.challenger != *challenger_account.key {
            msg!("Lo sfidante non corrisponde");
            return Err(Layer2Error::InvalidChallenger.into());
        }
        
        // Deserializza la richiesta di prelievo
        let withdrawal_data = withdrawal_account.try_borrow_data()?;
        let withdrawal_request = WithdrawalRequest::unpack(&withdrawal_data)?;
        
        // Verifica che la sfida sia valida
        self.validator.validate_challenge(
            &challenge,
            &withdrawal_request.batch,
            history_account,
            state_account,
        )?;
        
        // Se la sfida è valida, blocca il prelievo
        self.block_withdrawal(&withdrawal_request, history_account)?;
        
        // Premia lo sfidante (in un'implementazione reale, questo richiederebbe
        // un'istruzione di trasferimento del sistema)
        
        Ok(())
    }

    /// Blocca un prelievo
    fn block_withdrawal(
        &self,
        withdrawal_request: &WithdrawalRequest,
        history_account: &AccountInfo,
    ) -> ProgramResult {
        // Deserializza la cronologia delle transazioni
        let mut history_data = history_account.try_borrow_mut_data()?;
        let mut history = TransactionHistory::unpack(&history_data)?;
        
        // Calcola l'hash della transazione di prelievo
        let mut tx_data = Vec::new();
        let tx = &withdrawal_request.transaction;
        tx_data.extend_from_slice(&tx.sender.to_bytes());
        tx_data.extend_from_slice(&tx.recipient.to_bytes());
        tx_data.extend_from_slice(&tx.amount.to_le_bytes());
        tx_data.extend_from_slice(&tx.nonce.to_le_bytes());
        tx_data.extend_from_slice(&tx.expiry_timestamp.to_le_bytes());
        tx_data.push(tx.transaction_type as u8);
        tx_data.extend_from_slice(&(tx.data.len() as u32).to_le_bytes());
        tx_data.extend_from_slice(&tx.data);
        
        let tx_hash = keccak::hash(&tx_data).to_bytes();
        
        // Aggiungi l'hash della transazione alla lista dei prelievi bloccati
        history.blocked_withdrawals.push(tx_hash);
        
        // Serializza la cronologia aggiornata
        TransactionHistory::pack(history, &mut history_data)?;
        
        Ok(())
    }
}
