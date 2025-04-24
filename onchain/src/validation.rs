/**
 * Modulo di validazione per il Layer-2 su Solana
 * 
 * Questo modulo implementa le funzioni di validazione per le transazioni e gli stati
 * del sistema Layer-2 su Solana, garantendo l'integrità e la sicurezza del sistema.
 * Include protezioni avanzate anti-double-spending e validazione multi-fase.
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
    secp256k1::{Secp256k1, Message, Signature},
    hash::{hash, Hash},
};
use std::convert::TryInto;
use std::mem::size_of;
use std::collections::HashSet;
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
    SpentNonce
};

/// Struttura per la validazione
pub struct Validator {
    /// Chiave pubblica del programma
    pub program_id: Pubkey,
}

/// Enum per i livelli di validazione
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ValidationLevel {
    /// Validazione di base (sintassi e formato)
    Basic,
    /// Validazione crittografica (firme e prove)
    Cryptographic,
    /// Validazione semantica (regole di business)
    Semantic,
    /// Validazione di stato (effetti sullo stato globale)
    State,
}

/// Struttura per il risultato della validazione
#[derive(Debug)]
pub struct ValidationResult {
    /// Livello di validazione
    pub level: ValidationLevel,
    /// Risultato della validazione
    pub result: ProgramResult,
    /// Dettagli aggiuntivi
    pub details: Option<String>,
    /// Timestamp della validazione
    pub timestamp: i64,
}

impl Validator {
    /// Crea un nuovo validatore
    pub fn new(program_id: &Pubkey) -> Self {
        Self {
            program_id: *program_id,
        }
    }

    /// Verifica che un account sia di proprietà del programma
    pub fn validate_account_owner(&self, account_info: &AccountInfo) -> ProgramResult {
        if account_info.owner != &self.program_id {
            msg!("L'account non è di proprietà del programma");
            return Err(ProgramError::IncorrectProgramId);
        }
        Ok(())
    }

    /// Verifica che un account sia scrivibile
    pub fn validate_is_writable(&self, account_info: &AccountInfo) -> ProgramResult {
        if !account_info.is_writable {
            msg!("L'account deve essere scrivibile");
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(())
    }

    /// Verifica che un account sia firmato
    pub fn validate_is_signer(&self, account_info: &AccountInfo) -> ProgramResult {
        if !account_info.is_signer {
            msg!("L'account deve essere un firmatario");
            return Err(ProgramError::MissingRequiredSignature);
        }
        Ok(())
    }

    /// Verifica che un account sia inizializzato
    pub fn validate_is_initialized<T: Pack + IsInitialized>(&self, data: &[u8]) -> ProgramResult {
        let state = T::unpack_unchecked(data)?;
        if !state.is_initialized() {
            msg!("L'account non è inizializzato");
            return Err(ProgramError::UninitializedAccount);
        }
        Ok(())
    }

    /// Verifica che un account abbia abbastanza lamports per essere rent-exempt
    pub fn validate_rent_exempt(&self, account_info: &AccountInfo, rent: &Rent) -> ProgramResult {
        if !rent.is_exempt(account_info.lamports(), account_info.data_len()) {
            msg!("L'account non è rent-exempt");
            return Err(ProgramError::AccountNotRentExempt);
        }
        Ok(())
    }

    /// Verifica che un account abbia la dimensione corretta
    pub fn validate_account_size(&self, account_info: &AccountInfo, expected_size: usize) -> ProgramResult {
        if account_info.data_len() != expected_size {
            msg!("Dimensione dell'account non valida");
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(())
    }

    /// Verifica una firma Secp256k1
    pub fn validate_secp256k1_signature(
        &self,
        message: &[u8],
        signature: &[u8],
        public_key: &[u8],
    ) -> ProgramResult {
        // Calcola l'hash del messaggio
        let message_hash = keccak::hash(message);
        
        // Converte l'hash in un messaggio Secp256k1
        let secp256k1_message = Message::parse_slice(&message_hash.0)
            .map_err(|_| {
                msg!("Errore nel parsing del messaggio Secp256k1");
                ProgramError::InvalidArgument
            })?;
        
        // Converte la firma in una firma Secp256k1
        let secp256k1_signature = Signature::parse_slice(signature)
            .map_err(|_| {
                msg!("Errore nel parsing della firma Secp256k1");
                ProgramError::InvalidArgument
            })?;
        
        // Converte la chiave pubblica in una chiave pubblica Secp256k1
        let secp256k1_public_key = Secp256k1::parse_slice(public_key)
            .map_err(|_| {
                msg!("Errore nel parsing della chiave pubblica Secp256k1");
                ProgramError::InvalidArgument
            })?;
        
        // Verifica la firma
        if !Secp256k1::verify(&secp256k1_message, &secp256k1_signature, &secp256k1_public_key) {
            msg!("Firma Secp256k1 non valida");
            return Err(ProgramError::InvalidArgument);
        }
        
        Ok(())
    }

    /// Verifica una prova di Merkle
    pub fn validate_merkle_proof(
        &self,
        leaf: &[u8],
        proof: &[Vec<u8>],
        root: &[u8],
    ) -> ProgramResult {
        let mut current = leaf.to_vec();
        
        for sibling in proof {
            // Ordina i nodi per garantire la coerenza
            let (left, right) = if current < *sibling {
                (current.clone(), sibling.clone())
            } else {
                (sibling.clone(), current.clone())
            };
            
            // Concatena e calcola l'hash
            let mut combined = Vec::with_capacity(left.len() + right.len());
            combined.extend_from_slice(&left);
            combined.extend_from_slice(&right);
            
            let hash = keccak::hash(&combined);
            current = hash.0.to_vec();
        }
        
        if current != root {
            msg!("Prova di Merkle non valida");
            return Err(Layer2Error::InvalidMerkleProof.into());
        }
        
        Ok(())
    }

    /// Verifica una transazione con validazione multi-fase
    pub fn validate_transaction_multi_phase(
        &self, 
        transaction: &Transaction,
        history_account: Option<&AccountInfo>,
        state_account: Option<&AccountInfo>,
    ) -> Vec<ValidationResult> {
        let clock = Clock::get().unwrap_or_default();
        let current_timestamp = clock.unix_timestamp;
        let mut results = Vec::new();
        
        // Fase 1: Validazione di base (sintassi e formato)
        let basic_result = self.validate_transaction_basic(transaction);
        results.push(ValidationResult {
            level: ValidationLevel::Basic,
            result: basic_result.clone(),
            details: None,
            timestamp: current_timestamp,
        });
        
        // Se la validazione di base fallisce, interrompi il processo
        if basic_result.is_err() {
            return results;
        }
        
        // Fase 2: Validazione crittografica (firme)
        let crypto_result = self.validate_transaction_cryptographic(transaction);
        results.push(ValidationResult {
            level: ValidationLevel::Cryptographic,
            result: crypto_result.clone(),
            details: None,
            timestamp: current_timestamp,
        });
        
        // Se la validazione crittografica fallisce, interrompi il processo
        if crypto_result.is_err() {
            return results;
        }
        
        // Fase 3: Validazione semantica (regole di business)
        let semantic_result = self.validate_transaction_semantic(transaction);
        results.push(ValidationResult {
            level: ValidationLevel::Semantic,
            result: semantic_result.clone(),
            details: None,
            timestamp: current_timestamp,
        });
        
        // Se la validazione semantica fallisce, interrompi il processo
        if semantic_result.is_err() {
            return results;
        }
        
        // Fase 4: Validazione di stato (double-spending, saldo, ecc.)
        if let (Some(history), Some(state)) = (history_account, state_account) {
            let state_result = self.validate_transaction_state(transaction, history, state);
            results.push(ValidationResult {
                level: ValidationLevel::State,
                result: state_result.clone(),
                details: None,
                timestamp: current_timestamp,
            });
        }
        
        results
    }

    /// Validazione di base della transazione (sintassi e formato)
    pub fn validate_transaction_basic(&self, transaction: &Transaction) -> ProgramResult {
        // Verifica che il mittente e il destinatario siano validi
        if transaction.sender == Pubkey::default() || transaction.recipient == Pubkey::default() {
            msg!("Mittente o destinatario non valido");
            return Err(Layer2Error::InvalidAddress.into());
        }
        
        // Verifica che il mittente e il destinatario siano diversi
        if transaction.sender == transaction.recipient {
            msg!("Il mittente e il destinatario non possono essere uguali");
            return Err(Layer2Error::SenderEqualsRecipient.into());
        }
        
        // Verifica che l'importo sia valido
        if transaction.amount == 0 {
            msg!("Importo non valido");
            return Err(Layer2Error::InvalidAmount.into());
        }
        
        // Verifica che il nonce sia valido
        if transaction.nonce == 0 {
            msg!("Nonce non valido");
            return Err(Layer2Error::InvalidNonce.into());
        }
        
        // Verifica che la transazione non sia scaduta
        let clock = Clock::get()?;
        if transaction.expiry_timestamp < clock.unix_timestamp as u64 {
            msg!("La transazione è scaduta");
            return Err(Layer2Error::TransactionExpired.into());
        }
        
        // Verifica che il tipo di transazione sia valido
        match transaction.transaction_type {
            0 | 1 | 2 | 3 => {}, // Tipi validi
            _ => {
                msg!("Tipo di transazione non valido");
                return Err(Layer2Error::InvalidTransactionType.into());
            }
        }
        
        // Verifica che i dati non superino la dimensione massima
        const MAX_DATA_SIZE: usize = 1024;
        if transaction.data.len() > MAX_DATA_SIZE {
            msg!("I dati della transazione superano la dimensione massima");
            return Err(Layer2Error::DataTooLarge.into());
        }
        
        Ok(())
    }

    /// Validazione crittografica della transazione (firme)
    pub fn validate_transaction_cryptographic(&self, transaction: &Transaction) -> ProgramResult {
        // Verifica che la firma non sia vuota
        if transaction.signature.is_empty() {
            msg!("Firma della transazione mancante");
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        // Serializza la transazione senza la firma
        let mut tx_data = Vec::new();
        tx_data.extend_from_slice(&transaction.sender.to_bytes());
        tx_data.extend_from_slice(&transaction.recipient.to_bytes());
        tx_data.extend_from_slice(&transaction.amount.to_le_bytes());
        tx_data.extend_from_slice(&transaction.nonce.to_le_bytes());
        tx_data.extend_from_slice(&transaction.expiry_timestamp.to_le_bytes());
        tx_data.push(transaction.transaction_type as u8);
        tx_data.extend_from_slice(&(transaction.data.len() as u32).to_le_bytes());
        tx_data.extend_from_slice(&transaction.data);
        
        // Calcola l'hash della transazione
        let tx_hash = keccak::hash(&tx_data);
        
        // Estrai la firma e la chiave pubblica
        if transaction.signature.len() < 65 {
            msg!("Lunghezza della firma non valida");
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        let signature = &transaction.signature[0..64];
        let recovery_id = transaction.signature[64];
        
        // Recupera la chiave pubblica dalla firma
        let recovered_pubkey = match Secp256k1::recover(
            &Message::parse(&tx_hash.0),
            &Signature::parse_slice(signature)?,
            recovery_id,
        ) {
            Ok(pubkey) => pubkey,
            Err(_) => {
                msg!("Impossibile recuperare la chiave pubblica dalla firma");
                return Err(Layer2Error::InvalidSignature.into());
            }
        };
        
        // Verifica che la chiave pubblica recuperata corrisponda al mittente
        let pubkey_bytes = recovered_pubkey.serialize();
        let expected_pubkey = transaction.sender.to_bytes();
        
        // Nota: questa è una semplificazione, in un'implementazione reale
        // dovremmo convertire correttamente tra il formato Secp256k1 e Solana
        if pubkey_bytes != expected_pubkey {
            msg!("La chiave pubblica recuperata non corrisponde al mittente");
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        // Verifica la firma con timestamping sicuro
        self.validate_transaction_timestamp(transaction)?;
        
        Ok(())
    }

    /// Validazione semantica della transazione (regole di business)
    pub fn validate_transaction_semantic(&self, transaction: &Transaction) -> ProgramResult {
        // Verifica regole specifiche per tipo di transazione
        match transaction.transaction_type {
            0 => {
                // Deposito
                // Verifica che l'importo sia superiore alla soglia minima
                const MIN_DEPOSIT: u64 = 1000;
                if transaction.amount < MIN_DEPOSIT {
                    msg!("Importo del deposito inferiore alla soglia minima");
                    return Err(Layer2Error::AmountBelowMinimum.into());
                }
            },
            1 => {
                // Trasferimento
                // Nessuna regola aggiuntiva per ora
            },
            2 => {
                // Prelievo
                // Verifica che l'importo sia inferiore alla soglia massima
                const MAX_WITHDRAWAL: u64 = 1_000_000_000;
                if transaction.amount > MAX_WITHDRAWAL {
                    msg!("Importo del prelievo superiore alla soglia massima");
                    return Err(Layer2Error::AmountAboveMaximum.into());
                }
            },
            3 => {
                // Swap
                // Verifica che i dati contengano le informazioni necessarie
                if transaction.data.len() < 32 {
                    msg!("Dati insufficienti per uno swap");
                    return Err(Layer2Error::InvalidData.into());
                }
            },
            _ => {
                msg!("Tipo di transazione non supportato");
                return Err(Layer2Error::InvalidTransactionType.into());
            }
        }
        
        // Verifica che la transazione non sia troppo vecchia
        let clock = Clock::get()?;
        const MAX_TX_AGE: i64 = 86400; // 24 ore
        let tx_age = clock.unix_timestamp - (transaction.expiry_timestamp - 3600) as i64;
        if tx_age > MAX_TX_AGE {
            msg!("La transazione è troppo vecchia");
            return Err(Layer2Error::TransactionTooOld.into());
        }
        
        Ok(())
    }

    /// Validazione di stato della transazione (double-spending, saldo, ecc.)
    pub fn validate_transaction_state(
        &self,
        transaction: &Transaction,
        history_account: &AccountInfo,
        state_account: &AccountInfo,
    ) -> ProgramResult {
        // Verifica che gli account siano di proprietà del programma
        self.validate_account_owner(history_account)?;
        self.validate_account_owner(state_account)?;
        
        // Deserializza lo stato
        let state_data = state_account.try_borrow_data()?;
        let state = Layer2State::unpack(&state_data)?;
        
        // Verifica che il mittente abbia un saldo sufficiente
        let sender_account = state.accounts.iter()
            .find(|a| a.address == transaction.sender)
            .ok_or(Layer2Error::AccountNotFound)?;
        
        if sender_account.balance < transaction.amount {
            msg!("Saldo insufficiente");
            return Err(Layer2Error::InsufficientBalance.into());
        }
        
        // Verifica che il nonce non sia già stato utilizzato (anti-double-spending)
        self.validate_transaction_nonce(transaction, history_account)?;
        
        // Verifica che la transazione non sia già stata elaborata
        self.validate_transaction_not_processed(transaction, history_account)?;
        
        Ok(())
    }

    /// Verifica che il nonce non sia già stato utilizzato (anti-double-spending)
    pub fn validate_transaction_nonce(
        &self,
        transaction: &Transaction,
        history_account: &AccountInfo,
    ) -> ProgramResult {
        // Deserializza la cronologia delle transazioni
        let history_data = history_account.try_borrow_data()?;
        let history = TransactionHistory::unpack(&history_data)?;
        
        // Verifica che il nonce non sia già stato utilizzato
        for spent_nonce in &history.spent_nonces {
            if spent_nonce.sender == transaction.sender && spent_nonce.nonce == transaction.nonce {
                msg!("Nonce già utilizzato (double-spending)");
                return Err(Layer2Error::NonceAlreadyUsed.into());
            }
        }
        
        Ok(())
    }

    /// Verifica che la transazione non sia già stata elaborata
    pub fn validate_transaction_not_processed(
        &self,
        transaction: &Transaction,
        history_account: &AccountInfo,
    ) -> ProgramResult {
        // Deserializza la cronologia delle transazioni
        let history_data = history_account.try_borrow_data()?;
        let history = TransactionHistory::unpack(&history_data)?;
        
        // Calcola l'hash della transazione
        let mut tx_data = Vec::new();
        tx_data.extend_from_slice(&transaction.sender.to_bytes());
        tx_data.extend_from_slice(&transaction.recipient.to_bytes());
        tx_data.extend_from_slice(&transaction.amount.to_le_bytes());
        tx_data.extend_from_slice(&transaction.nonce.to_le_bytes());
        tx_data.extend_from_slice(&transaction.expiry_timestamp.to_le_bytes());
        tx_data.push(transaction.transaction_type as u8);
        tx_data.extend_from_slice(&(transaction.data.len() as u32).to_le_bytes());
        tx_data.extend_from_slice(&transaction.data);
        
        let tx_hash = keccak::hash(&tx_data).to_bytes();
        
        // Verifica che l'hash della transazione non sia già presente nella cronologia
        for processed_tx in &history.processed_transactions {
            if processed_tx.transaction_hash == tx_hash {
                msg!("Transazione già elaborata");
                return Err(Layer2Error::TransactionAlreadyProcessed.into());
            }
        }
        
        Ok(())
    }

    /// Verifica il timestamp della transazione
    pub fn validate_transaction_timestamp(
        &self,
        transaction: &Transaction,
    ) -> ProgramResult {
        // Verifica che il timestamp sia valido
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp as u64;
        
        // Verifica che il timestamp non sia nel futuro
        if transaction.expiry_timestamp > current_time + 3600 {
            msg!("Timestamp della transazione nel futuro");
            return Err(Layer2Error::InvalidTimestamp.into());
        }
        
        // Verifica che il timestamp non sia scaduto
        if transaction.expiry_timestamp < current_time {
            msg!("Timestamp della transazione scaduto");
            return Err(Layer2Error::TransactionExpired.into());
        }
        
        Ok(())
    }

    /// Verifica un batch di transazioni con validazione multi-fase
    pub fn validate_batch_multi_phase(
        &self,
        batch: &Batch,
        history_account: Option<&AccountInfo>,
        state_account: Option<&AccountInfo>,
    ) -> Vec<ValidationResult> {
        let clock = Clock::get().unwrap_or_default();
        let current_timestamp = clock.unix_timestamp;
        let mut results = Vec::new();
        
        // Fase 1: Validazione di base (sintassi e formato)
        let basic_result = self.validate_batch_basic(batch);
        results.push(ValidationResult {
            level: ValidationLevel::Basic,
            result: basic_result.clone(),
            details: None,
            timestamp: current_timestamp,
        });
        
        // Se la validazione di base fallisce, interrompi il processo
        if basic_result.is_err() {
            return results;
        }
        
        // Fase 2: Validazione crittografica (firme e Merkle root)
        let crypto_result = self.validate_batch_cryptographic(batch);
        results.push(ValidationResult {
            level: ValidationLevel::Cryptographic,
            result: crypto_result.clone(),
            details: None,
            timestamp: current_timestamp,
        });
        
        // Se la validazione crittografica fallisce, interrompi il processo
        if crypto_result.is_err() {
            return results;
        }
        
        // Fase 3: Validazione semantica (regole di business)
        let semantic_result = self.validate_batch_semantic(batch);
        results.push(ValidationResult {
            level: ValidationLevel::Semantic,
            result: semantic_result.clone(),
            details: None,
            timestamp: current_timestamp,
        });
        
        // Se la validazione semantica fallisce, interrompi il processo
        if semantic_result.is_err() {
            return results;
        }
        
        // Fase 4: Validazione di stato (double-spending, saldo, ecc.)
        if let (Some(history), Some(state)) = (history_account, state_account) {
            let state_result = self.validate_batch_state(batch, history, state);
            results.push(ValidationResult {
                level: ValidationLevel::State,
                result: state_result.clone(),
                details: None,
                timestamp: current_timestamp,
            });
        }
        
        results
    }

    /// Validazione di base del batch (sintassi e formato)
    pub fn validate_batch_basic(&self, batch: &Batch) -> ProgramResult {
        // Verifica che il batch non sia vuoto
        if batch.transactions.is_empty() {
            msg!("Il batch non può essere vuoto");
            return Err(Layer2Error::EmptyBatch.into());
        }
        
        // Verifica che il batch non superi la dimensione massima
        const MAX_BATCH_SIZE: usize = 1024;
        if batch.transactions.len() > MAX_BATCH_SIZE {
            msg!("Il batch supera la dimensione massima");
            return Err(Layer2Error::BatchTooLarge.into());
        }
        
        // Verifica che il sequencer sia valido
        if batch.sequencer == Pubkey::default() {
            msg!("Sequencer non valido");
            return Err(Layer2Error::InvalidSequencer.into());
        }
        
        // Verifica che il batch non sia scaduto
        let clock = Clock::get()?;
        if batch.expiry_timestamp < clock.unix_timestamp as u64 {
            msg!("Il batch è scaduto");
            return Err(Layer2Error::BatchExpired.into());
        }
        
        // Verifica che il root di Merkle non sia vuoto
        if batch.merkle_root == [0; 32] {
            msg!("Root di Merkle non valido");
            return Err(Layer2Error::InvalidMerkleRoot.into());
        }
        
        // Verifica che ogni transazione nel batch sia valida (validazione di base)
        for transaction in &batch.transactions {
            self.validate_transaction_basic(transaction)?;
        }
        
        Ok(())
    }

    /// Validazione crittografica del batch (firme e Merkle root)
    pub fn validate_batch_cryptographic(&self, batch: &Batch) -> ProgramResult {
        // Verifica che la firma non sia vuota
        if batch.signature.is_empty() {
            msg!("Firma del batch mancante");
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        // Serializza il batch senza la firma
        let mut batch_data = Vec::new();
        batch_data.extend_from_slice(&batch.sequencer.to_bytes());
        batch_data.extend_from_slice(&batch.expiry_timestamp.to_le_bytes());
        batch_data.extend_from_slice(&batch.merkle_root);
        batch_data.extend_from_slice(&(batch.transactions.len() as u32).to_le_bytes());
        
        for tx in &batch.transactions {
            batch_data.extend_from_slice(&tx.sender.to_bytes());
            batch_data.extend_from_slice(&tx.recipient.to_bytes());
            batch_data.extend_from_slice(&tx.amount.to_le_bytes());
            batch_data.extend_from_slice(&tx.nonce.to_le_bytes());
            batch_data.extend_from_slice(&tx.expiry_timestamp.to_le_bytes());
            batch_data.push(tx.transaction_type as u8);
            batch_data.extend_from_slice(&(tx.data.len() as u32).to_le_bytes());
            batch_data.extend_from_slice(&tx.data);
        }
        
        // Calcola l'hash del batch
        let batch_hash = keccak::hash(&batch_data);
        
        // Estrai la firma e la chiave pubblica
        if batch.signature.len() < 65 {
            msg!("Lunghezza della firma non valida");
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        let signature = &batch.signature[0..64];
        let recovery_id = batch.signature[64];
        
        // Recupera la chiave pubblica dalla firma
        let recovered_pubkey = match Secp256k1::recover(
            &Message::parse(&batch_hash.0),
            &Signature::parse_slice(signature)?,
            recovery_id,
        ) {
            Ok(pubkey) => pubkey,
            Err(_) => {
                msg!("Impossibile recuperare la chiave pubblica dalla firma");
                return Err(Layer2Error::InvalidSignature.into());
            }
        };
        
        // Verifica che la chiave pubblica recuperata corrisponda al sequencer
        let pubkey_bytes = recovered_pubkey.serialize();
        let expected_pubkey = batch.sequencer.to_bytes();
        
        // Nota: questa è una semplificazione, in un'implementazione reale
        // dovremmo convertire correttamente tra il formato Secp256k1 e Solana
        if pubkey_bytes != expected_pubkey {
            msg!("La chiave pubblica recuperata non corrisponde al sequencer");
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        // Verifica che il root di Merkle sia valido
        self.validate_batch_merkle_root(batch)?;
        
        // Verifica che ogni transazione nel batch sia valida (validazione crittografica)
        for transaction in &batch.transactions {
            self.validate_transaction_cryptographic(transaction)?;
        }
        
        Ok(())
    }

    /// Validazione semantica del batch (regole di business)
    pub fn validate_batch_semantic(&self, batch: &Batch) -> ProgramResult {
        // Verifica che il batch non contenga transazioni duplicate
        let mut tx_hashes = HashSet::new();
        
        for tx in &batch.transactions {
            // Serializza la transazione
            let mut tx_data = Vec::new();
            tx_data.extend_from_slice(&tx.sender.to_bytes());
            tx_data.extend_from_slice(&tx.recipient.to_bytes());
            tx_data.extend_from_slice(&tx.amount.to_le_bytes());
            tx_data.extend_from_slice(&tx.nonce.to_le_bytes());
            tx_data.extend_from_slice(&tx.expiry_timestamp.to_le_bytes());
            tx_data.push(tx.transaction_type as u8);
            tx_data.extend_from_slice(&(tx.data.len() as u32).to_le_bytes());
            tx_data.extend_from_slice(&tx.data);
            
            // Calcola l'hash della transazione
            let tx_hash = keccak::hash(&tx_data).to_bytes();
            
            // Verifica che l'hash non sia già presente
            if !tx_hashes.insert(tx_hash) {
                msg!("Il batch contiene transazioni duplicate");
                return Err(Layer2Error::DuplicateTransaction.into());
            }
        }
        
        // Verifica che il batch non contenga transazioni con lo stesso mittente e nonce
        let mut sender_nonces = HashSet::new();
        
        for tx in &batch.transactions {
            let sender_nonce = (tx.sender, tx.nonce);
            
            if !sender_nonces.insert(sender_nonce) {
                msg!("Il batch contiene transazioni con lo stesso mittente e nonce");
                return Err(Layer2Error::DuplicateNonce.into());
            }
        }
        
        // Verifica che ogni transazione nel batch sia valida (validazione semantica)
        for transaction in &batch.transactions {
            self.validate_transaction_semantic(transaction)?;
        }
        
        Ok(())
    }

    /// Validazione di stato del batch (double-spending, saldo, ecc.)
    pub fn validate_batch_state(
        &self,
        batch: &Batch,
        history_account: &AccountInfo,
        state_account: &AccountInfo,
    ) -> ProgramResult {
        // Verifica che gli account siano di proprietà del programma
        self.validate_account_owner(history_account)?;
        self.validate_account_owner(state_account)?;
        
        // Deserializza lo stato
        let state_data = state_account.try_borrow_data()?;
        let state = Layer2State::unpack(&state_data)?;
        
        // Simula l'applicazione del batch per verificare che non ci siano problemi
        let mut simulated_state = state.clone();
        
        // Traccia i nonce utilizzati durante la simulazione
        let mut used_nonces = HashSet::new();
        
        for tx in &batch.transactions {
            // Verifica che il nonce non sia già stato utilizzato in questo batch
            let sender_nonce = (tx.sender, tx.nonce);
            
            if !used_nonces.insert(sender_nonce) {
                msg!("Double-spending rilevato nel batch (stesso mittente e nonce)");
                return Err(Layer2Error::DoubleSpending.into());
            }
            
            // Verifica che il mittente abbia un saldo sufficiente
            let sender_idx = simulated_state.accounts.iter()
                .position(|a| a.address == tx.sender)
                .ok_or(Layer2Error::AccountNotFound)?;
            
            if simulated_state.accounts[sender_idx].balance < tx.amount {
                msg!("Saldo insufficiente");
                return Err(Layer2Error::InsufficientBalance.into());
            }
            
            // Aggiorna il saldo del mittente
            simulated_state.accounts[sender_idx].balance -= tx.amount;
            
            // Aggiorna il saldo del destinatario
            let recipient_idx = simulated_state.accounts.iter()
                .position(|a| a.address == tx.recipient);
            
            match recipient_idx {
                Some(idx) => {
                    simulated_state.accounts[idx].balance += tx.amount;
                },
                None => {
                    // Il destinatario non esiste, crea un nuovo account
                    if simulated_state.accounts.len() >= simulated_state.accounts.capacity() {
                        msg!("Numero massimo di account raggiunto");
                        return Err(Layer2Error::MaxAccountsReached.into());
                    }
                    
                    simulated_state.accounts.push(Account {
                        address: tx.recipient,
                        balance: tx.amount,
                        nonce: 0,
                        is_initialized: true,
                    });
                }
            }
        }
        
        // Verifica che ogni transazione nel batch sia valida (validazione di stato)
        for transaction in &batch.transactions {
            self.validate_transaction_state(transaction, history_account, state_account)?;
        }
        
        Ok(())
    }

    /// Verifica che il root di Merkle di un batch sia valido
    pub fn validate_batch_merkle_root(&self, batch: &Batch) -> ProgramResult {
        // Calcola il root di Merkle dalle transazioni
        let mut leaves = Vec::with_capacity(batch.transactions.len());
        
        for tx in &batch.transactions {
            // Serializza la transazione
            let mut tx_data = Vec::new();
            tx_data.extend_from_slice(&tx.sender.to_bytes());
            tx_data.extend_from_slice(&tx.recipient.to_bytes());
            tx_data.extend_from_slice(&tx.amount.to_le_bytes());
            tx_data.extend_from_slice(&tx.nonce.to_le_bytes());
            tx_data.extend_from_slice(&tx.expiry_timestamp.to_le_bytes());
            tx_data.push(tx.transaction_type as u8);
            tx_data.extend_from_slice(&(tx.data.len() as u32).to_le_bytes());
            tx_data.extend_from_slice(&tx.data);
            
            // Calcola l'hash della transazione
            let tx_hash = keccak::hash(&tx_data);
            leaves.push(tx_hash.0.to_vec());
        }
        
        // Costruisci l'albero di Merkle
        let merkle_tree = MerkleTree::new(leaves);
        let calculated_root = merkle_tree.root();
        
        // Verifica che il root calcolato corrisponda a quello del batch
        if calculated_root != batch.merkle_root {
            msg!("Il root di Merkle calcolato non corrisponde a quello del batch");
            return Err(Layer2Error::InvalidMerkleRoot.into());
        }
        
        Ok(())
    }

    /// Verifica una prova di transazione in un batch
    pub fn validate_transaction_in_batch(
        &self,
        transaction: &Transaction,
        proof: &Proof,
        batch: &Batch,
    ) -> ProgramResult {
        // Serializza la transazione
        let mut tx_data = Vec::new();
        tx_data.extend_from_slice(&transaction.sender.to_bytes());
        tx_data.extend_from_slice(&transaction.recipient.to_bytes());
        tx_data.extend_from_slice(&transaction.amount.to_le_bytes());
        tx_data.extend_from_slice(&transaction.nonce.to_le_bytes());
        tx_data.extend_from_slice(&transaction.expiry_timestamp.to_le_bytes());
        tx_data.push(transaction.transaction_type as u8);
        tx_data.extend_from_slice(&(transaction.data.len() as u32).to_le_bytes());
        tx_data.extend_from_slice(&transaction.data);
        
        // Calcola l'hash della transazione
        let tx_hash = keccak::hash(&tx_data).0.to_vec();
        
        // Verifica la prova di Merkle
        self.validate_merkle_proof(&tx_hash, &proof.siblings, &batch.merkle_root)?;
        
        // Verifica che l'indice della transazione sia valido
        if proof.index >= batch.transactions.len() as u32 {
            msg!("Indice della transazione non valido");
            return Err(Layer2Error::InvalidTransactionIndex.into());
        }
        
        // Verifica che la transazione all'indice specificato corrisponda
        let batch_tx = &batch.transactions[proof.index as usize];
        
        if batch_tx.sender != transaction.sender ||
           batch_tx.recipient != transaction.recipient ||
           batch_tx.amount != transaction.amount ||
           batch_tx.nonce != transaction.nonce ||
           batch_tx.expiry_timestamp != transaction.expiry_timestamp ||
           batch_tx.transaction_type != transaction.transaction_type ||
           batch_tx.data != transaction.data {
            msg!("La transazione non corrisponde a quella nel batch");
            return Err(Layer2Error::TransactionMismatch.into());
        }
        
        Ok(())
    }

    /// Verifica una sfida a una transazione
    pub fn validate_challenge(
        &self,
        challenge: &Challenge,
        batch: &Batch,
        history_account: &AccountInfo,
        state_account: &AccountInfo,
    ) -> ProgramResult {
        // Verifica che la sfida sia valida
        if challenge.challenger == Pubkey::default() {
            msg!("Sfidante non valido");
            return Err(Layer2Error::InvalidChallenger.into());
        }
        
        // Verifica che la sfida non sia scaduta
        let clock = Clock::get()?;
        if challenge.expiry_timestamp < clock.unix_timestamp as u64 {
            msg!("La sfida è scaduta");
            return Err(Layer2Error::ChallengeExpired.into());
        }
        
        // Verifica che l'indice della transazione sia valido
        if challenge.transaction_index >= batch.transactions.len() as u32 {
            msg!("Indice della transazione non valido");
            return Err(Layer2Error::InvalidTransactionIndex.into());
        }
        
        // Ottieni la transazione dal batch
        let transaction = &batch.transactions[challenge.transaction_index as usize];
        
        // Verifica il tipo di sfida
        match challenge.challenge_type {
            0 => {
                // Sfida per double-spending
                self.validate_challenge_double_spending(transaction, history_account)?;
            },
            1 => {
                // Sfida per saldo insufficiente
                self.validate_challenge_insufficient_balance(transaction, state_account)?;
            },
            2 => {
                // Sfida per firma non valida
                if self.validate_transaction_cryptographic(transaction).is_ok() {
                    msg!("La firma della transazione è valida, sfida non valida");
                    return Err(Layer2Error::InvalidChallenge.into());
                }
            },
            3 => {
                // Sfida per transazione scaduta
                if transaction.expiry_timestamp >= clock.unix_timestamp as u64 {
                    msg!("La transazione non è scaduta, sfida non valida");
                    return Err(Layer2Error::InvalidChallenge.into());
                }
            },
            _ => {
                msg!("Tipo di sfida non valido");
                return Err(Layer2Error::InvalidChallengeType.into());
            }
        }
        
        Ok(())
    }

    /// Verifica una sfida per double-spending
    pub fn validate_challenge_double_spending(
        &self,
        transaction: &Transaction,
        history_account: &AccountInfo,
    ) -> ProgramResult {
        // Deserializza la cronologia delle transazioni
        let history_data = history_account.try_borrow_data()?;
        let history = TransactionHistory::unpack(&history_data)?;
        
        // Verifica che il nonce sia già stato utilizzato
        let mut nonce_used = false;
        
        for spent_nonce in &history.spent_nonces {
            if spent_nonce.sender == transaction.sender && spent_nonce.nonce == transaction.nonce {
                nonce_used = true;
                break;
            }
        }
        
        if !nonce_used {
            msg!("Il nonce non è stato utilizzato, sfida non valida");
            return Err(Layer2Error::InvalidChallenge.into());
        }
        
        Ok(())
    }

    /// Verifica una sfida per saldo insufficiente
    pub fn validate_challenge_insufficient_balance(
        &self,
        transaction: &Transaction,
        state_account: &AccountInfo,
    ) -> ProgramResult {
        // Deserializza lo stato
        let state_data = state_account.try_borrow_data()?;
        let state = Layer2State::unpack(&state_data)?;
        
        // Verifica che il mittente abbia un saldo insufficiente
        let sender_account = state.accounts.iter()
            .find(|a| a.address == transaction.sender)
            .ok_or(Layer2Error::AccountNotFound)?;
        
        if sender_account.balance >= transaction.amount {
            msg!("Il mittente ha un saldo sufficiente, sfida non valida");
            return Err(Layer2Error::InvalidChallenge.into());
        }
        
        Ok(())
    }
}
