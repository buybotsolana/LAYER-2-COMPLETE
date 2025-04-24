/**
 * Modulo di definizione delle istruzioni per il Layer-2 su Solana
 * 
 * Questo modulo definisce le istruzioni supportate dal programma Layer-2,
 * inclusa la serializzazione e deserializzazione dei dati delle istruzioni.
 */

use solana_program::{
    program_error::ProgramError,
    pubkey::Pubkey,
    instruction::{AccountMeta, Instruction},
};
use std::convert::TryInto;
use std::mem::size_of;
use borsh::{BorshDeserialize, BorshSerialize};
use crate::error::Layer2Error;

/// Istruzioni supportate dal programma Layer-2
#[derive(Clone, Debug, PartialEq, BorshSerialize, BorshDeserialize)]
pub enum Layer2Instruction {
    /// Inizializza il sistema Layer-2
    /// 
    /// Accounts:
    /// 0. `[writable, signer]` Account di stato del Layer-2
    /// 1. `[signer]` Account del sequencer iniziale
    /// 2. `[]` Account di sistema
    /// 3. `[]` Account di rent
    Initialize {
        /// Versione iniziale
        version: u8,
    },
    
    /// Deposita fondi nel Layer-2
    /// 
    /// Accounts:
    /// 0. `[writable]` Account di stato del Layer-2
    /// 1. `[writable, signer]` Account del mittente
    /// 2. `[writable]` Account del destinatario nel Layer-2
    /// 3. `[]` Account di sistema
    Deposit {
        /// Importo da depositare
        amount: u64,
        /// Dati aggiuntivi
        data: Vec<u8>,
    },
    
    /// Trasferisce fondi all'interno del Layer-2
    /// 
    /// Accounts:
    /// 0. `[writable]` Account di stato del Layer-2
    /// 1. `[writable, signer]` Account del mittente nel Layer-2
    /// 2. `[writable]` Account del destinatario nel Layer-2
    Transfer {
        /// Importo da trasferire
        amount: u64,
        /// Nonce per prevenire replay attack
        nonce: u64,
        /// Dati aggiuntivi
        data: Vec<u8>,
    },
    
    /// Preleva fondi dal Layer-2
    /// 
    /// Accounts:
    /// 0. `[writable]` Account di stato del Layer-2
    /// 1. `[writable, signer]` Account del mittente nel Layer-2
    /// 2. `[writable]` Account del destinatario
    /// 3. `[]` Account di sistema
    Withdraw {
        /// Importo da prelevare
        amount: u64,
        /// Nonce per prevenire replay attack
        nonce: u64,
        /// Dati aggiuntivi
        data: Vec<u8>,
    },
    
    /// Invia un batch di transazioni
    /// 
    /// Accounts:
    /// 0. `[writable]` Account di stato del Layer-2
    /// 1. `[writable, signer]` Account del sequencer
    /// 2. `[writable]` Account del batch
    SubmitBatch {
        /// Transazioni nel batch
        transactions: Vec<u8>, // Serializzato con borsh
        /// Timestamp di creazione del batch
        timestamp: u64,
        /// Timestamp di scadenza del batch
        expiry_timestamp: u64,
    },
    
    /// Verifica un batch di transazioni
    /// 
    /// Accounts:
    /// 0. `[writable]` Account di stato del Layer-2
    /// 1. `[writable]` Account del batch
    /// 2. `[writable]` Account della transizione di stato
    VerifyBatch {
        /// ID del batch
        batch_id: [u8; 32],
    },
    
    /// Contesta un batch di transazioni
    /// 
    /// Accounts:
    /// 0. `[writable]` Account di stato del Layer-2
    /// 1. `[writable, signer]` Account dello sfidante
    /// 2. `[writable]` Account del batch
    /// 3. `[writable]` Account della sfida
    ChallengeBatch {
        /// ID del batch
        batch_id: [u8; 32],
        /// Prova della sfida
        proof: Vec<u8>, // Serializzato con borsh
    },
    
    /// Risolve una sfida
    /// 
    /// Accounts:
    /// 0. `[writable]` Account di stato del Layer-2
    /// 1. `[writable, signer]` Account del sequencer
    /// 2. `[writable]` Account della sfida
    /// 3. `[writable]` Account del batch
    ResolveChallenge {
        /// ID della sfida
        challenge_id: [u8; 32],
        /// Risposta alla sfida
        response: Vec<u8>, // Serializzato con borsh
    },
    
    /// Aggiorna il sequencer
    /// 
    /// Accounts:
    /// 0. `[writable]` Account di stato del Layer-2
    /// 1. `[writable, signer]` Account del sequencer attuale
    /// 2. `[writable]` Account del nuovo sequencer
    UpdateSequencer {
        /// Nuovo sequencer
        new_sequencer: Pubkey,
    },
    
    /// Aggiorna i parametri del sistema
    /// 
    /// Accounts:
    /// 0. `[writable]` Account di stato del Layer-2
    /// 1. `[writable, signer]` Account del sequencer
    UpdateParameters {
        /// Nuovi parametri
        parameters: Vec<u8>, // Serializzato con borsh
    },
    
    /// Crea un account Layer-2
    /// 
    /// Accounts:
    /// 0. `[writable]` Account di stato del Layer-2
    /// 1. `[writable, signer]` Account del proprietario
    /// 2. `[writable]` Account da creare
    /// 3. `[]` Account di sistema
    /// 4. `[]` Account di rent
    CreateAccount {
        /// Saldo iniziale
        initial_balance: u64,
    },
    
    /// Chiude un account Layer-2
    /// 
    /// Accounts:
    /// 0. `[writable]` Account di stato del Layer-2
    /// 1. `[writable, signer]` Account del proprietario
    /// 2. `[writable]` Account da chiudere
    /// 3. `[writable]` Account destinatario dei fondi
    CloseAccount {},
    
    /// Esegue una transizione di stato
    /// 
    /// Accounts:
    /// 0. `[writable]` Account di stato del Layer-2
    /// 1. `[writable, signer]` Account del sequencer
    /// 2. `[writable]` Account della transizione di stato
    ExecuteStateTransition {
        /// Hash dello stato iniziale
        from_state_hash: [u8; 32],
        /// Hash dello stato finale
        to_state_hash: [u8; 32],
        /// ID del batch
        batch_id: [u8; 32],
    },
    
    /// Verifica una prova di Merkle
    /// 
    /// Accounts:
    /// 0. `[]` Account di stato del Layer-2
    VerifyMerkleProof {
        /// Foglia
        leaf: [u8; 32],
        /// Prova
        proof: Vec<[u8; 32]>,
        /// Root
        root: [u8; 32],
    },
}

impl Layer2Instruction {
    /// Serializza un'istruzione in un vettore di byte
    pub fn serialize(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(1000); // Dimensione iniziale arbitraria
        self.serialize_into(&mut buf).unwrap();
        buf
    }
    
    /// Deserializza un'istruzione da un vettore di byte
    pub fn deserialize(input: &[u8]) -> Result<Self, ProgramError> {
        Self::try_from_slice(input).map_err(|_| Layer2Error::DeserializationError.into())
    }
    
    /// Crea un'istruzione di inizializzazione
    pub fn initialize(
        program_id: &Pubkey,
        state_account: &Pubkey,
        sequencer: &Pubkey,
        version: u8,
    ) -> Instruction {
        let accounts = vec![
            AccountMeta::new(*state_account, true),
            AccountMeta::new_readonly(*sequencer, true),
            AccountMeta::new_readonly(solana_program::system_program::id(), false),
            AccountMeta::new_readonly(solana_program::sysvar::rent::id(), false),
        ];
        
        let data = Layer2Instruction::Initialize { version }.serialize();
        
        Instruction {
            program_id: *program_id,
            accounts,
            data,
        }
    }
    
    /// Crea un'istruzione di deposito
    pub fn deposit(
        program_id: &Pubkey,
        state_account: &Pubkey,
        sender: &Pubkey,
        recipient: &Pubkey,
        amount: u64,
        data: Vec<u8>,
    ) -> Instruction {
        let accounts = vec![
            AccountMeta::new(*state_account, false),
            AccountMeta::new(*sender, true),
            AccountMeta::new(*recipient, false),
            AccountMeta::new_readonly(solana_program::system_program::id(), false),
        ];
        
        let data = Layer2Instruction::Deposit { amount, data }.serialize();
        
        Instruction {
            program_id: *program_id,
            accounts,
            data,
        }
    }
    
    /// Crea un'istruzione di trasferimento
    pub fn transfer(
        program_id: &Pubkey,
        state_account: &Pubkey,
        sender: &Pubkey,
        recipient: &Pubkey,
        amount: u64,
        nonce: u64,
        data: Vec<u8>,
    ) -> Instruction {
        let accounts = vec![
            AccountMeta::new(*state_account, false),
            AccountMeta::new(*sender, true),
            AccountMeta::new(*recipient, false),
        ];
        
        let data = Layer2Instruction::Transfer { amount, nonce, data }.serialize();
        
        Instruction {
            program_id: *program_id,
            accounts,
            data,
        }
    }
    
    /// Crea un'istruzione di prelievo
    pub fn withdraw(
        program_id: &Pubkey,
        state_account: &Pubkey,
        sender: &Pubkey,
        recipient: &Pubkey,
        amount: u64,
        nonce: u64,
        data: Vec<u8>,
    ) -> Instruction {
        let accounts = vec![
            AccountMeta::new(*state_account, false),
            AccountMeta::new(*sender, true),
            AccountMeta::new(*recipient, false),
            AccountMeta::new_readonly(solana_program::system_program::id(), false),
        ];
        
        let data = Layer2Instruction::Withdraw { amount, nonce, data }.serialize();
        
        Instruction {
            program_id: *program_id,
            accounts,
            data,
        }
    }
    
    /// Crea un'istruzione di invio batch
    pub fn submit_batch(
        program_id: &Pubkey,
        state_account: &Pubkey,
        sequencer: &Pubkey,
        batch_account: &Pubkey,
        transactions: Vec<u8>,
        timestamp: u64,
        expiry_timestamp: u64,
    ) -> Instruction {
        let accounts = vec![
            AccountMeta::new(*state_account, false),
            AccountMeta::new(*sequencer, true),
            AccountMeta::new(*batch_account, false),
        ];
        
        let data = Layer2Instruction::SubmitBatch {
            transactions,
            timestamp,
            expiry_timestamp,
        }.serialize();
        
        Instruction {
            program_id: *program_id,
            accounts,
            data,
        }
    }
    
    /// Crea un'istruzione di verifica batch
    pub fn verify_batch(
        program_id: &Pubkey,
        state_account: &Pubkey,
        batch_account: &Pubkey,
        transition_account: &Pubkey,
        batch_id: [u8; 32],
    ) -> Instruction {
        let accounts = vec![
            AccountMeta::new(*state_account, false),
            AccountMeta::new(*batch_account, false),
            AccountMeta::new(*transition_account, false),
        ];
        
        let data = Layer2Instruction::VerifyBatch { batch_id }.serialize();
        
        Instruction {
            program_id: *program_id,
            accounts,
            data,
        }
    }
    
    /// Crea un'istruzione di contestazione batch
    pub fn challenge_batch(
        program_id: &Pubkey,
        state_account: &Pubkey,
        challenger: &Pubkey,
        batch_account: &Pubkey,
        challenge_account: &Pubkey,
        batch_id: [u8; 32],
        proof: Vec<u8>,
    ) -> Instruction {
        let accounts = vec![
            AccountMeta::new(*state_account, false),
            AccountMeta::new(*challenger, true),
            AccountMeta::new(*batch_account, false),
            AccountMeta::new(*challenge_account, false),
        ];
        
        let data = Layer2Instruction::ChallengeBatch { batch_id, proof }.serialize();
        
        Instruction {
            program_id: *program_id,
            accounts,
            data,
        }
    }
    
    /// Crea un'istruzione di risoluzione sfida
    pub fn resolve_challenge(
        program_id: &Pubkey,
        state_account: &Pubkey,
        sequencer: &Pubkey,
        challenge_account: &Pubkey,
        batch_account: &Pubkey,
        challenge_id: [u8; 32],
        response: Vec<u8>,
    ) -> Instruction {
        let accounts = vec![
            AccountMeta::new(*state_account, false),
            AccountMeta::new(*sequencer, true),
            AccountMeta::new(*challenge_account, false),
            AccountMeta::new(*batch_account, false),
        ];
        
        let data = Layer2Instruction::ResolveChallenge { challenge_id, response }.serialize();
        
        Instruction {
            program_id: *program_id,
            accounts,
            data,
        }
    }
    
    /// Crea un'istruzione di aggiornamento sequencer
    pub fn update_sequencer(
        program_id: &Pubkey,
        state_account: &Pubkey,
        current_sequencer: &Pubkey,
        new_sequencer: &Pubkey,
    ) -> Instruction {
        let accounts = vec![
            AccountMeta::new(*state_account, false),
            AccountMeta::new(*current_sequencer, true),
            AccountMeta::new(*new_sequencer, false),
        ];
        
        let data = Layer2Instruction::UpdateSequencer {
            new_sequencer: *new_sequencer,
        }.serialize();
        
        Instruction {
            program_id: *program_id,
            accounts,
            data,
        }
    }
    
    /// Crea un'istruzione di aggiornamento parametri
    pub fn update_parameters(
        program_id: &Pubkey,
        state_account: &Pubkey,
        sequencer: &Pubkey,
        parameters: Vec<u8>,
    ) -> Instruction {
        let accounts = vec![
            AccountMeta::new(*state_account, false),
            AccountMeta::new(*sequencer, true),
        ];
        
        let data = Layer2Instruction::UpdateParameters { parameters }.serialize();
        
        Instruction {
            program_id: *program_id,
            accounts,
            data,
        }
    }
    
    /// Crea un'istruzione di creazione account
    pub fn create_account(
        program_id: &Pubkey,
        state_account: &Pubkey,
        owner: &Pubkey,
        new_account: &Pubkey,
        initial_balance: u64,
    ) -> Instruction {
        let accounts = vec![
            AccountMeta::new(*state_account, false),
            AccountMeta::new(*owner, true),
            AccountMeta::new(*new_account, false),
            AccountMeta::new_readonly(solana_program::system_program::id(), false),
            AccountMeta::new_readonly(solana_program::sysvar::rent::id(), false),
        ];
        
        let data = Layer2Instruction::CreateAccount { initial_balance }.serialize();
        
        Instruction {
            program_id: *program_id,
            accounts,
            data,
        }
    }
    
    /// Crea un'istruzione di chiusura account
    pub fn close_account(
        program_id: &Pubkey,
        state_account: &Pubkey,
        owner: &Pubkey,
        account: &Pubkey,
        recipient: &Pubkey,
    ) -> Instruction {
        let accounts = vec![
            AccountMeta::new(*state_account, false),
            AccountMeta::new(*owner, true),
            AccountMeta::new(*account, false),
            AccountMeta::new(*recipient, false),
        ];
        
        let data = Layer2Instruction::CloseAccount {}.serialize();
        
        Instruction {
            program_id: *program_id,
            accounts,
            data,
        }
    }
    
    /// Crea un'istruzione di esecuzione transizione di stato
    pub fn execute_state_transition(
        program_id: &Pubkey,
        state_account: &Pubkey,
        sequencer: &Pubkey,
        transition_account: &Pubkey,
        from_state_hash: [u8; 32],
        to_state_hash: [u8; 32],
        batch_id: [u8; 32],
    ) -> Instruction {
        let accounts = vec![
            AccountMeta::new(*state_account, false),
            AccountMeta::new(*sequencer, true),
            AccountMeta::new(*transition_account, false),
        ];
        
        let data = Layer2Instruction::ExecuteStateTransition {
            from_state_hash,
            to_state_hash,
            batch_id,
        }.serialize();
        
        Instruction {
            program_id: *program_id,
            accounts,
            data,
        }
    }
    
    /// Crea un'istruzione di verifica prova di Merkle
    pub fn verify_merkle_proof(
        program_id: &Pubkey,
        state_account: &Pubkey,
        leaf: [u8; 32],
        proof: Vec<[u8; 32]>,
        root: [u8; 32],
    ) -> Instruction {
        let accounts = vec![
            AccountMeta::new_readonly(*state_account, false),
        ];
        
        let data = Layer2Instruction::VerifyMerkleProof {
            leaf,
            proof,
            root,
        }.serialize();
        
        Instruction {
            program_id: *program_id,
            accounts,
            data,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_instruction_serialize_deserialize() {
        let instruction = Layer2Instruction::Initialize { version: 1 };
        let serialized = instruction.serialize();
        let deserialized = Layer2Instruction::deserialize(&serialized).unwrap();
        
        match deserialized {
            Layer2Instruction::Initialize { version } => {
                assert_eq!(version, 1);
            },
            _ => panic!("Deserializzazione non corretta"),
        }
    }
    
    #[test]
    fn test_deposit_instruction() {
        let program_id = Pubkey::new_unique();
        let state_account = Pubkey::new_unique();
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        
        let instruction = Layer2Instruction::deposit(
            &program_id,
            &state_account,
            &sender,
            &recipient,
            1000,
            vec![1, 2, 3],
        );
        
        assert_eq!(instruction.program_id, program_id);
        assert_eq!(instruction.accounts.len(), 4);
        assert_eq!(instruction.accounts[0].pubkey, state_account);
        assert_eq!(instruction.accounts[1].pubkey, sender);
        assert_eq!(instruction.accounts[2].pubkey, recipient);
        
        let deserialized = Layer2Instruction::deserialize(&instruction.data).unwrap();
        
        match deserialized {
            Layer2Instruction::Deposit { amount, data } => {
                assert_eq!(amount, 1000);
                assert_eq!(data, vec![1, 2, 3]);
            },
            _ => panic!("Deserializzazione non corretta"),
        }
    }
    
    #[test]
    fn test_transfer_instruction() {
        let program_id = Pubkey::new_unique();
        let state_account = Pubkey::new_unique();
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        
        let instruction = Layer2Instruction::transfer(
            &program_id,
            &state_account,
            &sender,
            &recipient,
            1000,
            1,
            vec![1, 2, 3],
        );
        
        assert_eq!(instruction.program_id, program_id);
        assert_eq!(instruction.accounts.len(), 3);
        assert_eq!(instruction.accounts[0].pubkey, state_account);
        assert_eq!(instruction.accounts[1].pubkey, sender);
        assert_eq!(instruction.accounts[2].pubkey, recipient);
        
        let deserialized = Layer2Instruction::deserialize(&instruction.data).unwrap();
        
        match deserialized {
            Layer2Instruction::Transfer { amount, nonce, data } => {
                assert_eq!(amount, 1000);
                assert_eq!(nonce, 1);
                assert_eq!(data, vec![1, 2, 3]);
            },
            _ => panic!("Deserializzazione non corretta"),
        }
    }
    
    #[test]
    fn test_withdraw_instruction() {
        let program_id = Pubkey::new_unique();
        let state_account = Pubkey::new_unique();
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        
        let instruction = Layer2Instruction::withdraw(
            &program_id,
            &state_account,
            &sender,
            &recipient,
            1000,
            1,
            vec![1, 2, 3],
        );
        
        assert_eq!(instruction.program_id, program_id);
        assert_eq!(instruction.accounts.len(), 4);
        assert_eq!(instruction.accounts[0].pubkey, state_account);
        assert_eq!(instruction.accounts[1].pubkey, sender);
        assert_eq!(instruction.accounts[2].pubkey, recipient);
        
        let deserialized = Layer2Instruction::deserialize(&instruction.data).unwrap();
        
        match deserialized {
            Layer2Instruction::Withdraw { amount, nonce, data } => {
                assert_eq!(amount, 1000);
                assert_eq!(nonce, 1);
                assert_eq!(data, vec![1, 2, 3]);
            },
            _ => panic!("Deserializzazione non corretta"),
        }
    }
}
