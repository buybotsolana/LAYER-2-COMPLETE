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
        if batch.transactions.len() > 1024 {
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
        
        // Verifica che il root di Merkle sia valido
        // In un'implementazione reale, verificheremmo che il root di Merkle
        // corrisponda all'hash delle transazioni nel batch
        if batch.merkle_root == [0; 32] {
            msg!("Root di Merkle non valido");
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
        
        // Verifica che la transizione di stato sia coerente
        // In un'implementazione reale, verificheremmo che applicando le transazioni
        // nello stato iniziale si ottenga lo stato finale
        
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
        
        // Verifica che la prova sia valida
        // In un'implementazione reale, verificheremmo la prova crittografica
        // che dimostra l'invalidità dello stato contestato
        
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
        
        // Verifica che la prova sia valida
        // In un'implementazione reale, verificheremmo la prova crittografica
        // che dimostra la validità del prelievo
        
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
    
    // Altri test...
}
