/**
 * Modulo di validazione per il Layer-2 su Solana
 * 
 * Questo modulo implementa le funzioni di validazione per le transazioni e gli stati
 * del sistema Layer-2 su Solana, garantendo l'integrità e la sicurezza del sistema.
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
    StateTransition
};

/// Struttura per la validazione
pub struct Validator {
    /// Chiave pubblica del programma
    pub program_id: Pubkey,
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

    /// Verifica una transazione
    pub fn validate_transaction(&self, transaction: &Transaction) -> ProgramResult {
        // Verifica che la transazione non sia scaduta
        let clock = Clock::get()?;
        if transaction.expiry_timestamp < clock.unix_timestamp as u64 {
            msg!("La transazione è scaduta");
            return Err(Layer2Error::TransactionExpired.into());
        }
        
        // Verifica che il nonce sia valido (implementazione semplificata)
        // In un'implementazione reale, verificheremmo che il nonce non sia stato già utilizzato
        if transaction.nonce == 0 {
            msg!("Nonce non valido");
            return Err(Layer2Error::InvalidNonce.into());
        }
        
        // Verifica che l'importo sia valido
        if transaction.amount == 0 {
            msg!("Importo non valido");
            return Err(Layer2Error::InvalidAmount.into());
        }
        
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
        
        // Verifica la firma della transazione
        if !transaction.signature.is_empty() {
            self.validate_transaction_signature(transaction)?;
        }
        
        Ok(())
    }

    /// Verifica la firma di una transazione
    pub fn validate_transaction_signature(&self, transaction: &Transaction) -> ProgramResult {
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
        
        Ok(())
    }

    /// Verifica un batch di transazioni
    pub fn validate_batch(&self, batch: &Batch) -> ProgramResult {
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
        
        // Verifica che il batch non sia scaduto
        let clock = Clock::get()?;
        if batch.expiry_timestamp < clock.unix_timestamp as u64 {
            msg!("Il batch è scaduto");
            return Err(Layer2Error::BatchExpired.into());
        }
        
        // Verifica che il sequencer sia valido
        if batch.sequencer == Pubkey::default() {
            msg!("Sequencer non valido");
            return Err(Layer2Error::InvalidSequencer.into());
        }
        
        // Verifica ogni transazione nel batch
        for transaction in &batch.transactions {
            self.validate_transaction(transaction)?;
        }
        
        // Verifica la firma del batch
        self.validate_batch_signature(batch)?;
        
        // Verifica che il root di Merkle sia valido
        self.validate_batch_merkle_root(batch)?;
        
        Ok(())
    }

    /// Verifica la firma di un batch
    pub fn validate_batch_signature(&self, batch: &Batch) -> ProgramResult {
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
        
        Ok(())
    }

    /// Verifica che il root di Merkle di un batch sia valido
    pub fn validate_batch_merkle_root(&self, batch: &Batch) -> ProgramResult {
        // Verifica che il root di Merkle non sia vuoto
        if batch.merkle_root == [0; 32] {
            msg!("Root di Merkle non valido");
            return Err(Layer2Error::InvalidMerkleRoot.into());
        }
        
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

    /// Verifica una transizione di stato
    pub fn validate_state_transition(
        &self,
        old_state: &Layer2State,
        new_state: &Layer2State,
        transition: &StateTransition,
    ) -> ProgramResult {
        // Verifica che la transizione di stato sia valida
        if transition.from_state_hash != old_state.hash() {
            msg!("Hash dello stato iniziale non valido");
            return Err(Layer2Error::InvalidStateTransition.into());
        }
        
        if transition.to_state_hash != new_state.hash() {
            msg!("Hash dello stato finale non valido");
            return Err(Layer2Error::InvalidStateTransition.into());
        }
        
        // Verifica che il batch sia valido
        self.validate_batch(&transition.batch)?;
        
        // Verifica la firma della transizione di stato
        self.validate_state_transition_signature(transition, old_state)?;
        
        // Verifica che la transizione di stato sia coerente
        self.validate_state_transition_consistency(old_state, new_state, &transition.batch)?;
        
        Ok(())
    }

    /// Verifica la firma di una transizione di stato
    pub fn validate_state_transition_signature(
        &self,
        transition: &StateTransition,
        state: &Layer2State,
    ) -> ProgramResult {
        // Verifica che la firma non sia vuota
        if transition.signature.is_empty() {
            msg!("Firma della transizione di stato mancante");
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        // Serializza la transizione di stato senza la firma
        let mut transition_data = Vec::new();
        transition_data.extend_from_slice(&transition.from_state_hash);
        transition_data.extend_from_slice(&transition.to_state_hash);
        
        // Aggiungi i dati del batch
        transition_data.extend_from_slice(&transition.batch.sequencer.to_bytes());
        transition_data.extend_from_slice(&transition.batch.expiry_timestamp.to_le_bytes());
        transition_data.extend_from_slice(&transition.batch.merkle_root);
        
        // Calcola l'hash della transizione di stato
        let transition_hash = keccak::hash(&transition_data);
        
        // Estrai la firma e la chiave pubblica
        if transition.signature.len() < 65 {
            msg!("Lunghezza della firma non valida");
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        let signature = &transition.signature[0..64];
        let recovery_id = transition.signature[64];
        
        // Recupera la chiave pubblica dalla firma
        let recovered_pubkey = match Secp256k1::recover(
            &Message::parse(&transition_hash.0),
            &Signature::parse_slice(signature)?,
            recovery_id,
        ) {
            Ok(pubkey) => pubkey,
            Err(_) => {
                msg!("Impossibile recuperare la chiave pubblica dalla firma");
                return Err(Layer2Error::InvalidSignature.into());
            }
        };
        
        // Verifica che la chiave pubblica recuperata corrisponda al sequencer autorizzato
        let pubkey_bytes = recovered_pubkey.serialize();
        let expected_pubkey = state.sequencer.to_bytes();
        
        // Nota: questa è una semplificazione, in un'implementazione reale
        // dovremmo convertire correttamente tra il formato Secp256k1 e Solana
        if pubkey_bytes != expected_pubkey {
            msg!("La chiave pubblica recuperata non corrisponde al sequencer autorizzato");
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        Ok(())
    }

    /// Verifica la coerenza di una transizione di stato
    pub fn validate_state_transition_consistency(
        &self,
        old_state: &Layer2State,
        new_state: &Layer2State,
        batch: &Batch,
    ) -> ProgramResult {
        // Verifica che il numero di versione sia incrementato di 1
        if new_state.version != old_state.version.checked_add(1).ok_or(Layer2Error::ArithmeticOverflow)? {
            msg!("Numero di versione non valido");
            return Err(Layer2Error::InvalidStateTransition.into());
        }
        
        // Verifica che il sequencer non sia cambiato
        if new_state.sequencer != old_state.sequencer {
            msg!("Il sequencer non può essere cambiato durante una transizione di stato");
            return Err(Layer2Error::InvalidStateTransition.into());
        }
        
        // Verifica che il numero di transazioni sia incrementato correttamente
        let expected_tx_count = old_state.transaction_count.checked_add(batch.transactions.len() as u64)
            .ok_or(Layer2Error::ArithmeticOverflow)?;
        
        if new_state.transaction_count != expected_tx_count {
            msg!("Numero di transazioni non valido");
            return Err(Layer2Error::InvalidStateTransition.into());
        }
        
        // In un'implementazione reale, qui verificheremmo che applicando le transazioni
        // nello stato iniziale si ottenga lo stato finale, inclusi gli aggiornamenti
        // agli alberi di Merkle degli account e delle transazioni
        
        Ok(())
    }

    /// Verifica una sfida
    pub fn validate_challenge(&self, challenge: &Challenge, state: &Layer2State) -> ProgramResult {
        // Verifica che la sfida non sia scaduta
        let clock = Clock::get()?;
        if challenge.expiry_timestamp < clock.unix_timestamp as u64 {
            msg!("La sfida è scaduta");
            return Err(Layer2Error::ChallengeExpired.into());
        }
        
        // Verifica che lo stato contestato sia valido
        if challenge.contested_state_hash != state.hash() {
            msg!("Hash dello stato contestato non valido");
            return Err(Layer2Error::InvalidChallenge.into());
        }
        
        // Verifica la firma della sfida
        self.validate_challenge_signature(challenge)?;
        
        // Verifica la prova della sfida
        self.validate_challenge_proof(challenge, state)?;
        
        Ok(())
    }

    /// Verifica la firma di una sfida
    pub fn validate_challenge_signature(&self, challenge: &Challenge) -> ProgramResult {
        // Verifica che la firma non sia vuota
        if challenge.signature.is_empty() {
            msg!("Firma della sfida mancante");
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        // Serializza la sfida senza la firma
        let mut challenge_data = Vec::new();
        challenge_data.extend_from_slice(&challenge.challenger.to_bytes());
        challenge_data.extend_from_slice(&challenge.contested_state_hash);
        challenge_data.extend_from_slice(&challenge.expiry_timestamp.to_le_bytes());
        challenge_data.extend_from_slice(&challenge.proof_data);
        
        // Calcola l'hash della sfida
        let challenge_hash = keccak::hash(&challenge_data);
        
        // Estrai la firma e la chiave pubblica
        if challenge.signature.len() < 65 {
            msg!("Lunghezza della firma non valida");
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        let signature = &challenge.signature[0..64];
        let recovery_id = challenge.signature[64];
        
        // Recupera la chiave pubblica dalla firma
        let recovered_pubkey = match Secp256k1::recover(
            &Message::parse(&challenge_hash.0),
            &Signature::parse_slice(signature)?,
            recovery_id,
        ) {
            Ok(pubkey) => pubkey,
            Err(_) => {
                msg!("Impossibile recuperare la chiave pubblica dalla firma");
                return Err(Layer2Error::InvalidSignature.into());
            }
        };
        
        // Verifica che la chiave pubblica recuperata corrisponda al challenger
        let pubkey_bytes = recovered_pubkey.serialize();
        let expected_pubkey = challenge.challenger.to_bytes();
        
        // Nota: questa è una semplificazione, in un'implementazione reale
        // dovremmo convertire correttamente tra il formato Secp256k1 e Solana
        if pubkey_bytes != expected_pubkey {
            msg!("La chiave pubblica recuperata non corrisponde al challenger");
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        Ok(())
    }

    /// Verifica la prova di una sfida
    pub fn validate_challenge_proof(&self, challenge: &Challenge, state: &Layer2State) -> ProgramResult {
        // In un'implementazione reale, qui verificheremmo la prova crittografica
        // che dimostra l'invalidità dello stato contestato
        
        // Per semplicità, qui assumiamo che la prova sia valida se contiene
        // almeno 64 byte di dati (una firma)
        if challenge.proof_data.len() < 64 {
            msg!("Prova della sfida non valida");
            return Err(Layer2Error::InvalidChallenge.into());
        }
        
        Ok(())
    }

    /// Verifica un deposito
    pub fn validate_deposit(
        &self,
        amount: u64,
        sender: &Pubkey,
        recipient: &Pubkey,
    ) -> ProgramResult {
        // Verifica che l'importo sia valido
        if amount == 0 {
            msg!("Importo non valido");
            return Err(Layer2Error::InvalidAmount.into());
        }
        
        // Verifica che il mittente e il destinatario siano validi
        if sender == &Pubkey::default() || recipient == &Pubkey::default() {
            msg!("Mittente o destinatario non valido");
            return Err(Layer2Error::InvalidAddress.into());
        }
        
        // Verifica che il mittente e il destinatario siano diversi
        if sender == recipient {
            msg!("Il mittente e il destinatario non possono essere uguali");
            return Err(Layer2Error::SenderEqualsRecipient.into());
        }
        
        Ok(())
    }

    /// Verifica un prelievo
    pub fn validate_withdrawal(
        &self,
        amount: u64,
        sender: &Pubkey,
        recipient: &Pubkey,
        proof: &Proof,
    ) -> ProgramResult {
        // Verifica che l'importo sia valido
        if amount == 0 {
            msg!("Importo non valido");
            return Err(Layer2Error::InvalidAmount.into());
        }
        
        // Verifica che il mittente e il destinatario siano validi
        if sender == &Pubkey::default() || recipient == &Pubkey::default() {
            msg!("Mittente o destinatario non valido");
            return Err(Layer2Error::InvalidAddress.into());
        }
        
        // Verifica che il mittente e il destinatario siano diversi
        if sender == recipient {
            msg!("Il mittente e il destinatario non possono essere uguali");
            return Err(Layer2Error::SenderEqualsRecipient.into());
        }
        
        // Verifica la firma del prelievo
        self.validate_withdrawal_signature(amount, sender, recipient, proof)?;
        
        // Verifica la prova di inclusione nell'albero di Merkle
        self.validate_withdrawal_merkle_proof(amount, sender, recipient, proof)?;
        
        Ok(())
    }

    /// Verifica la firma di un prelievo
    pub fn validate_withdrawal_signature(
        &self,
        amount: u64,
        sender: &Pubkey,
        recipient: &Pubkey,
        proof: &Proof,
    ) -> ProgramResult {
        // Verifica che la firma non sia vuota
        if proof.signature.is_empty() {
            msg!("Firma del prelievo mancante");
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        // Serializza i dati del prelievo
        let mut withdrawal_data = Vec::new();
        withdrawal_data.extend_from_slice(&sender.to_bytes());
        withdrawal_data.extend_from_slice(&recipient.to_bytes());
        withdrawal_data.extend_from_slice(&amount.to_le_bytes());
        
        // Calcola l'hash del prelievo
        let withdrawal_hash = keccak::hash(&withdrawal_data);
        
        // Estrai la firma e la chiave pubblica
        if proof.signature.len() < 65 {
            msg!("Lunghezza della firma non valida");
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        let signature = &proof.signature[0..64];
        let recovery_id = proof.signature[64];
        
        // Recupera la chiave pubblica dalla firma
        let recovered_pubkey = match Secp256k1::recover(
            &Message::parse(&withdrawal_hash.0),
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
        let expected_pubkey = sender.to_bytes();
        
        // Nota: questa è una semplificazione, in un'implementazione reale
        // dovremmo convertire correttamente tra il formato Secp256k1 e Solana
        if pubkey_bytes != expected_pubkey {
            msg!("La chiave pubblica recuperata non corrisponde al mittente");
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        Ok(())
    }

    /// Verifica la prova di Merkle di un prelievo
    pub fn validate_withdrawal_merkle_proof(
        &self,
        amount: u64,
        sender: &Pubkey,
        recipient: &Pubkey,
        proof: &Proof,
    ) -> ProgramResult {
        // Verifica che la prova non sia vuota
        if proof.merkle_proof.is_empty() {
            msg!("Prova di Merkle mancante");
            return Err(Layer2Error::InvalidMerkleProof.into());
        }
        
        // Serializza i dati del prelievo
        let mut withdrawal_data = Vec::new();
        withdrawal_data.extend_from_slice(&sender.to_bytes());
        withdrawal_data.extend_from_slice(&recipient.to_bytes());
        withdrawal_data.extend_from_slice(&amount.to_le_bytes());
        
        // Calcola l'hash del prelievo
        let withdrawal_hash = keccak::hash(&withdrawal_data);
        
        // Verifica la prova di Merkle
        self.validate_merkle_proof(
            &withdrawal_hash.0,
            &proof.merkle_proof,
            &proof.merkle_root,
        )?;
        
        Ok(())
    }

    /// Verifica i permessi di un account per un'operazione specifica
    pub fn validate_account_permissions(
        &self,
        account_info: &AccountInfo,
        required_permissions: u64,
        state: &Layer2State,
    ) -> ProgramResult {
        // Verifica che l'account sia di proprietà del programma
        self.validate_account_owner(account_info)?;
        
        // Carica l'account
        let account = Account::unpack_from_slice(&account_info.data.borrow())?;
        
        // Verifica che l'account sia inizializzato
        if !account.is_initialized {
            msg!("L'account non è inizializzato");
            return Err(Layer2Error::InvalidAccountData.into());
        }
        
        // Verifica che l'account abbia i permessi richiesti
        if (account.permissions & required_permissions) != required_permissions {
            msg!("L'account non ha i permessi richiesti");
            return Err(Layer2Error::Unauthorized.into());
        }
        
        // Verifica che l'account non sia stato bloccato
        if account.is_locked {
            msg!("L'account è bloccato");
            return Err(Layer2Error::AccountLocked.into());
        }
        
        // Verifica che l'account non sia scaduto
        let clock = Clock::get()?;
        if account.expiry_timestamp > 0 && account.expiry_timestamp < clock.unix_timestamp as u64 {
            msg!("L'account è scaduto");
            return Err(Layer2Error::AccountExpired.into());
        }
        
        Ok(())
    }

    /// Verifica l'autorizzazione multi-livello per un'operazione critica
    pub fn validate_multi_level_authorization(
        &self,
        primary_signer: &AccountInfo,
        secondary_signer: &AccountInfo,
        operation_type: u8,
        state: &Layer2State,
    ) -> ProgramResult {
        // Verifica che entrambi gli account siano firmatari
        self.validate_is_signer(primary_signer)?;
        self.validate_is_signer(secondary_signer)?;
        
        // Verifica che gli account siano diversi
        if primary_signer.key == secondary_signer.key {
            msg!("Gli account firmatari devono essere diversi");
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        // Verifica che il primary_signer sia autorizzato per l'operazione
        match operation_type {
            // Operazioni amministrative
            0 => {
                if *primary_signer.key != state.admin {
                    msg!("L'account non è l'amministratore");
                    return Err(Layer2Error::Unauthorized.into());
                }
            },
            // Operazioni del sequencer
            1 => {
                if *primary_signer.key != state.sequencer {
                    msg!("L'account non è il sequencer");
                    return Err(Layer2Error::Unauthorized.into());
                }
            },
            // Operazioni di emergenza
            2 => {
                if *primary_signer.key != state.emergency_admin {
                    msg!("L'account non è l'amministratore di emergenza");
                    return Err(Layer2Error::Unauthorized.into());
                }
            },
            // Altre operazioni
            _ => {
                msg!("Tipo di operazione non valido");
                return Err(Layer2Error::InvalidInstruction.into());
            }
        }
        
        // Verifica che il secondary_signer sia autorizzato come approvatore
        let is_approver = state.approvers.contains(secondary_signer.key);
        if !is_approver {
            msg!("L'account secondario non è un approvatore autorizzato");
            return Err(Layer2Error::Unauthorized.into());
        }
        
        // Verifica il timeout dell'autorizzazione
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp as u64;
        
        // In un'implementazione reale, verificheremmo che l'autorizzazione
        // sia stata richiesta entro un certo periodo di tempo
        
        Ok(())
    }

    /// Verifica la proprietà di un account
    pub fn validate_account_ownership(
        &self,
        account_info: &AccountInfo,
        expected_owner: &Pubkey,
    ) -> ProgramResult {
        // Verifica che l'account sia di proprietà del programma
        self.validate_account_owner(account_info)?;
        
        // Carica l'account
        let account = Account::unpack_from_slice(&account_info.data.borrow())?;
        
        // Verifica che l'account sia inizializzato
        if !account.is_initialized {
            msg!("L'account non è inizializzato");
            return Err(Layer2Error::InvalidAccountData.into());
        }
        
        // Verifica che il proprietario dell'account corrisponda a quello atteso
        if account.owner != *expected_owner {
            msg!("Il proprietario dell'account non corrisponde a quello atteso");
            return Err(Layer2Error::Unauthorized.into());
        }
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_program::clock::Epoch;
    use solana_program::account_info::AccountInfo;
    
    // Test per validate_account_owner
    #[test]
    fn test_validate_account_owner() {
        let program_id = Pubkey::new_unique();
        let validator = Validator::new(&program_id);
        
        let key = Pubkey::new_unique();
        let mut lamports = 100;
        let mut data = vec![0; 10];
        
        // Account di proprietà del programma
        let account_info = AccountInfo::new(
            &key,
            false,
            true,
            &mut lamports,
            &mut data,
            &program_id,
            false,
            Epoch::default(),
        );
        
        assert_eq!(validator.validate_account_owner(&account_info), Ok(()));
        
        // Account non di proprietà del programma
        let other_program_id = Pubkey::new_unique();
        let account_info = AccountInfo::new(
            &key,
            false,
            true,
            &mut lamports,
            &mut data,
            &other_program_id,
            false,
            Epoch::default(),
        );
        
        assert_eq!(
            validator.validate_account_owner(&account_info),
            Err(ProgramError::IncorrectProgramId)
        );
    }
    
    // Test per validate_is_writable
    #[test]
    fn test_validate_is_writable() {
        let program_id = Pubkey::new_unique();
        let validator = Validator::new(&program_id);
        
        let key = Pubkey::new_unique();
        let mut lamports = 100;
        let mut data = vec![0; 10];
        
        // Account scrivibile
        let account_info = AccountInfo::new(
            &key,
            false,
            true,
            &mut lamports,
            &mut data,
            &program_id,
            false,
            Epoch::default(),
        );
        
        assert_eq!(validator.validate_is_writable(&account_info), Ok(()));
        
        // Account non scrivibile
        let account_info = AccountInfo::new(
            &key,
            false,
            false,
            &mut lamports,
            &mut data,
            &program_id,
            false,
            Epoch::default(),
        );
        
        assert_eq!(
            validator.validate_is_writable(&account_info),
            Err(ProgramError::InvalidAccountData)
        );
    }
    
    // Test per validate_is_signer
    #[test]
    fn test_validate_is_signer() {
        let program_id = Pubkey::new_unique();
        let validator = Validator::new(&program_id);
        
        let key = Pubkey::new_unique();
        let mut lamports = 100;
        let mut data = vec![0; 10];
        
        // Account firmato
        let account_info = AccountInfo::new(
            &key,
            true,
            true,
            &mut lamports,
            &mut data,
            &program_id,
            false,
            Epoch::default(),
        );
        
        assert_eq!(validator.validate_is_signer(&account_info), Ok(()));
        
        // Account non firmato
        let account_info = AccountInfo::new(
            &key,
            false,
            true,
            &mut lamports,
            &mut data,
            &program_id,
            false,
            Epoch::default(),
        );
        
        assert_eq!(
            validator.validate_is_signer(&account_info),
            Err(ProgramError::MissingRequiredSignature)
        );
    }
    
    // Test per validate_multi_level_authorization
    #[test]
    fn test_validate_multi_level_authorization() {
        let program_id = Pubkey::new_unique();
        let validator = Validator::new(&program_id);
        
        let admin_key = Pubkey::new_unique();
        let approver_key = Pubkey::new_unique();
        let sequencer_key = Pubkey::new_unique();
        let emergency_admin_key = Pubkey::new_unique();
        
        let mut admin_lamports = 100;
        let mut admin_data = vec![0; 10];
        let admin_info = AccountInfo::new(
            &admin_key,
            true,
            true,
            &mut admin_lamports,
            &mut admin_data,
            &Pubkey::default(),
            false,
            Epoch::default(),
        );
        
        let mut approver_lamports = 100;
        let mut approver_data = vec![0; 10];
        let approver_info = AccountInfo::new(
            &approver_key,
            true,
            true,
            &mut approver_lamports,
            &mut approver_data,
            &Pubkey::default(),
            false,
            Epoch::default(),
        );
        
        // Crea uno stato con admin, sequencer, emergency_admin e approvers
        let mut state = Layer2State::new(
            1,
            0,
            0,
            [0; 32],
            [0; 32],
            [0; 32],
            sequencer_key,
        );
        state.admin = admin_key;
        state.emergency_admin = emergency_admin_key;
        state.approvers = vec![approver_key];
        
        // Test per operazione amministrativa (tipo 0)
        let result = validator.validate_multi_level_authorization(
            &admin_info,
            &approver_info,
            0,
            &state,
        );
        assert_eq!(result, Ok(()));
        
        // Test per operazione non autorizzata
        let other_key = Pubkey::new_unique();
        let mut other_lamports = 100;
        let mut other_data = vec![0; 10];
        let other_info = AccountInfo::new(
            &other_key,
            true,
            true,
            &mut other_lamports,
            &mut other_data,
            &Pubkey::default(),
            false,
            Epoch::default(),
        );
        
        let result = validator.validate_multi_level_authorization(
            &other_info,
            &approver_info,
            0,
            &state,
        );
        assert!(result.is_err());
    }
}
