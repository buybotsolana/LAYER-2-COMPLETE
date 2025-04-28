/**
 * Modulo di definizione dello stato per il Layer-2 su Solana
 * 
 * Questo modulo definisce le strutture dati per lo stato del sistema Layer-2,
 * incluse le transazioni, i batch, gli account e le prove.
 */

use solana_program::{
    program_error::ProgramError,
    pubkey::Pubkey,
    keccak,
    program_pack::{IsInitialized, Pack, Sealed},
};
use std::convert::TryInto;
use std::mem::size_of;
use borsh::{BorshDeserialize, BorshSerialize};
use crate::error::Layer2Error;

/// Stato di una transazione
#[derive(Clone, Copy, Debug, PartialEq, BorshSerialize, BorshDeserialize)]
pub enum TransactionStatus {
    /// La transazione è in attesa di essere elaborata
    Pending,
    /// La transazione è stata elaborata con successo
    Confirmed,
    /// La transazione è stata rifiutata
    Rejected,
    /// La transazione è stata contestata
    Challenged,
}

/// Tipo di transazione
#[derive(Clone, Copy, Debug, PartialEq, BorshSerialize, BorshDeserialize)]
pub enum TransactionType {
    /// Deposito
    Deposit,
    /// Trasferimento
    Transfer,
    /// Prelievo
    Withdrawal,
    /// Altro tipo di transazione
    Other,
}

/// Struttura per una transazione Layer-2
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
pub struct Transaction {
    /// ID univoco della transazione
    pub id: [u8; 32],
    /// Mittente della transazione
    pub sender: Pubkey,
    /// Destinatario della transazione
    pub recipient: Pubkey,
    /// Importo della transazione
    pub amount: u64,
    /// Nonce per prevenire replay attack
    pub nonce: u64,
    /// Timestamp di scadenza della transazione
    pub expiry_timestamp: u64,
    /// Tipo di transazione
    pub transaction_type: TransactionType,
    /// Stato della transazione
    pub status: TransactionStatus,
    /// Dati aggiuntivi della transazione
    pub data: Vec<u8>,
    /// Firma della transazione
    pub signature: Vec<u8>,
}

impl Transaction {
    /// Crea una nuova transazione
    pub fn new(
        sender: Pubkey,
        recipient: Pubkey,
        amount: u64,
        nonce: u64,
        expiry_timestamp: u64,
        transaction_type: TransactionType,
        data: Vec<u8>,
        signature: Vec<u8>,
    ) -> Self {
        let mut transaction = Self {
            id: [0; 32],
            sender,
            recipient,
            amount,
            nonce,
            expiry_timestamp,
            transaction_type,
            status: TransactionStatus::Pending,
            data,
            signature,
        };
        
        // Calcola l'ID della transazione come hash dei suoi campi
        transaction.id = transaction.hash();
        
        transaction
    }
    
    /// Calcola l'hash della transazione
    pub fn hash(&self) -> [u8; 32] {
        let mut data_to_hash = Vec::new();
        
        data_to_hash.extend_from_slice(&self.sender.to_bytes());
        data_to_hash.extend_from_slice(&self.recipient.to_bytes());
        data_to_hash.extend_from_slice(&self.amount.to_le_bytes());
        data_to_hash.extend_from_slice(&self.nonce.to_le_bytes());
        data_to_hash.extend_from_slice(&self.expiry_timestamp.to_le_bytes());
        data_to_hash.extend_from_slice(&[self.transaction_type as u8]);
        data_to_hash.extend_from_slice(&self.data);
        
        keccak::hash(&data_to_hash).0
    }
    
    /// Verifica la firma della transazione
    pub fn verify_signature(&self, public_key: &[u8]) -> Result<bool, ProgramError> {
        // Implementazione semplificata della verifica della firma
        // In un'implementazione reale, verificheremmo la firma crittografica
        
        if self.signature.is_empty() {
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        // Simuliamo una verifica della firma
        Ok(true)
    }
}

/// Struttura per un batch di transazioni
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
pub struct Batch {
    /// ID univoco del batch
    pub id: [u8; 32],
    /// Transazioni nel batch
    pub transactions: Vec<Transaction>,
    /// Sequencer che ha creato il batch
    pub sequencer: Pubkey,
    /// Timestamp di creazione del batch
    pub timestamp: u64,
    /// Timestamp di scadenza del batch
    pub expiry_timestamp: u64,
    /// Root dell'albero di Merkle delle transazioni
    pub merkle_root: [u8; 32],
    /// Firma del sequencer
    pub signature: Vec<u8>,
}

impl Batch {
    /// Crea un nuovo batch
    pub fn new(
        transactions: Vec<Transaction>,
        sequencer: Pubkey,
        timestamp: u64,
        expiry_timestamp: u64,
        signature: Vec<u8>,
    ) -> Self {
        let mut batch = Self {
            id: [0; 32],
            transactions,
            sequencer,
            timestamp,
            expiry_timestamp,
            merkle_root: [0; 32],
            signature,
        };
        
        // Calcola il root di Merkle delle transazioni
        batch.merkle_root = batch.compute_merkle_root();
        
        // Calcola l'ID del batch come hash dei suoi campi
        batch.id = batch.hash();
        
        batch
    }
    
    /// Calcola l'hash del batch
    pub fn hash(&self) -> [u8; 32] {
        let mut data_to_hash = Vec::new();
        
        data_to_hash.extend_from_slice(&self.merkle_root);
        data_to_hash.extend_from_slice(&self.sequencer.to_bytes());
        data_to_hash.extend_from_slice(&self.timestamp.to_le_bytes());
        data_to_hash.extend_from_slice(&self.expiry_timestamp.to_le_bytes());
        
        keccak::hash(&data_to_hash).0
    }
    
    /// Calcola il root dell'albero di Merkle delle transazioni
    pub fn compute_merkle_root(&self) -> [u8; 32] {
        if self.transactions.is_empty() {
            return [0; 32];
        }
        
        // Calcola gli hash delle transazioni
        let mut hashes: Vec<[u8; 32]> = self.transactions.iter()
            .map(|tx| tx.hash())
            .collect();
        
        // Costruisci l'albero di Merkle
        while hashes.len() > 1 {
            let mut next_level = Vec::new();
            
            for i in 0..(hashes.len() + 1) / 2 {
                let left = hashes[i * 2];
                let right = if i * 2 + 1 < hashes.len() {
                    hashes[i * 2 + 1]
                } else {
                    left // Duplica l'ultimo nodo se necessario
                };
                
                let mut combined = Vec::with_capacity(64);
                combined.extend_from_slice(&left);
                combined.extend_from_slice(&right);
                
                let hash = keccak::hash(&combined).0;
                next_level.push(hash);
            }
            
            hashes = next_level;
        }
        
        hashes[0]
    }
    
    /// Verifica la firma del batch
    pub fn verify_signature(&self, public_key: &[u8]) -> Result<bool, ProgramError> {
        // Implementazione semplificata della verifica della firma
        // In un'implementazione reale, verificheremmo la firma crittografica
        
        if self.signature.is_empty() {
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        // Simuliamo una verifica della firma
        Ok(true)
    }
}

/// Struttura per un account Layer-2
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
pub struct Account {
    /// Chiave pubblica dell'account
    pub pubkey: Pubkey,
    /// Saldo dell'account
    pub balance: u64,
    /// Nonce dell'account
    pub nonce: u64,
    /// Flag di inizializzazione
    pub is_initialized: bool,
}

impl Account {
    /// Crea un nuovo account
    pub fn new(pubkey: Pubkey) -> Self {
        Self {
            pubkey,
            balance: 0,
            nonce: 0,
            is_initialized: true,
        }
    }
    
    /// Incrementa il nonce dell'account
    pub fn increment_nonce(&mut self) {
        self.nonce += 1;
    }
}

impl Sealed for Account {}

impl IsInitialized for Account {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}

impl Pack for Account {
    const LEN: usize = size_of::<Pubkey>() + size_of::<u64>() + size_of::<u64>() + size_of::<bool>();
    
    fn pack_into_slice(&self, dst: &mut [u8]) {
        let mut offset = 0;
        
        dst[offset..offset + 32].copy_from_slice(&self.pubkey.to_bytes());
        offset += 32;
        
        dst[offset..offset + 8].copy_from_slice(&self.balance.to_le_bytes());
        offset += 8;
        
        dst[offset..offset + 8].copy_from_slice(&self.nonce.to_le_bytes());
        offset += 8;
        
        dst[offset] = self.is_initialized as u8;
    }
    
    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        if src.len() != Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        
        let mut offset = 0;
        
        let pubkey = Pubkey::new(&src[offset..offset + 32]);
        offset += 32;
        
        let balance = u64::from_le_bytes(src[offset..offset + 8].try_into().unwrap());
        offset += 8;
        
        let nonce = u64::from_le_bytes(src[offset..offset + 8].try_into().unwrap());
        offset += 8;
        
        let is_initialized = src[offset] != 0;
        
        Ok(Self {
            pubkey,
            balance,
            nonce,
            is_initialized,
        })
    }
}

/// Struttura per una prova crittografica
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
pub struct Proof {
    /// Tipo di prova
    pub proof_type: u8,
    /// Dati della prova
    pub data: Vec<u8>,
}

impl Proof {
    /// Crea una nuova prova
    pub fn new(proof_type: u8, data: Vec<u8>) -> Self {
        Self {
            proof_type,
            data,
        }
    }
    
    /// Verifica la prova
    pub fn verify(&self) -> Result<bool, ProgramError> {
        // Implementazione semplificata della verifica della prova
        // In un'implementazione reale, verificheremmo la prova crittografica
        
        if self.data.is_empty() {
            return Err(Layer2Error::InvalidProof.into());
        }
        
        // Simuliamo una verifica della prova
        Ok(true)
    }
}

/// Struttura per una sfida
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
pub struct Challenge {
    /// ID univoco della sfida
    pub id: [u8; 32],
    /// Sfidante
    pub challenger: Pubkey,
    /// Hash dello stato contestato
    pub contested_state_hash: [u8; 32],
    /// Prova della sfida
    pub proof: Proof,
    /// Timestamp di creazione della sfida
    pub timestamp: u64,
    /// Timestamp di scadenza della sfida
    pub expiry_timestamp: u64,
    /// Stato della sfida
    pub is_resolved: bool,
    /// Risultato della sfida (true se la sfida ha avuto successo)
    pub is_successful: bool,
}

impl Challenge {
    /// Crea una nuova sfida
    pub fn new(
        challenger: Pubkey,
        contested_state_hash: [u8; 32],
        proof: Proof,
        timestamp: u64,
        expiry_timestamp: u64,
    ) -> Self {
        let mut challenge = Self {
            id: [0; 32],
            challenger,
            contested_state_hash,
            proof,
            timestamp,
            expiry_timestamp,
            is_resolved: false,
            is_successful: false,
        };
        
        // Calcola l'ID della sfida come hash dei suoi campi
        challenge.id = challenge.hash();
        
        challenge
    }
    
    /// Calcola l'hash della sfida
    pub fn hash(&self) -> [u8; 32] {
        let mut data_to_hash = Vec::new();
        
        data_to_hash.extend_from_slice(&self.challenger.to_bytes());
        data_to_hash.extend_from_slice(&self.contested_state_hash);
        data_to_hash.extend_from_slice(&[self.proof.proof_type]);
        data_to_hash.extend_from_slice(&self.proof.data);
        data_to_hash.extend_from_slice(&self.timestamp.to_le_bytes());
        data_to_hash.extend_from_slice(&self.expiry_timestamp.to_le_bytes());
        
        keccak::hash(&data_to_hash).0
    }
}

/// Struttura per un albero di Merkle
#[derive(Clone, Debug)]
pub struct MerkleTree {
    /// Nodi dell'albero
    pub nodes: Vec<Vec<[u8; 32]>>,
}

impl MerkleTree {
    /// Crea un nuovo albero di Merkle dalle foglie
    pub fn new(leaves: Vec<[u8; 32]>) -> Self {
        if leaves.is_empty() {
            return Self { nodes: vec![vec![[0; 32]]] };
        }
        
        let mut nodes = Vec::new();
        nodes.push(leaves);
        
        while nodes.last().unwrap().len() > 1 {
            let mut next_level = Vec::new();
            let current_level = nodes.last().unwrap();
            
            for i in 0..(current_level.len() + 1) / 2 {
                let left = current_level[i * 2];
                let right = if i * 2 + 1 < current_level.len() {
                    current_level[i * 2 + 1]
                } else {
                    left // Duplica l'ultimo nodo se necessario
                };
                
                let mut combined = Vec::with_capacity(64);
                combined.extend_from_slice(&left);
                combined.extend_from_slice(&right);
                
                let hash = keccak::hash(&combined).0;
                next_level.push(hash);
            }
            
            nodes.push(next_level);
        }
        
        Self { nodes }
    }
    
    /// Ottiene il root dell'albero
    pub fn root(&self) -> [u8; 32] {
        self.nodes.last().unwrap()[0]
    }
    
    /// Genera una prova di Merkle per una foglia
    pub fn generate_proof(&self, leaf_index: usize) -> Vec<[u8; 32]> {
        let mut proof = Vec::new();
        let mut index = leaf_index;
        
        for level in 0..self.nodes.len() - 1 {
            let is_right = index % 2 == 1;
            let sibling_index = if is_right { index - 1 } else { index + 1 };
            
            if sibling_index < self.nodes[level].len() {
                proof.push(self.nodes[level][sibling_index]);
            }
            
            index /= 2;
        }
        
        proof
    }
    
    /// Verifica una prova di Merkle
    pub fn verify_proof(leaf: [u8; 32], proof: &[[u8; 32]], root: [u8; 32]) -> bool {
        let mut current = leaf;
        
        for sibling in proof {
            let (left, right) = if current < *sibling {
                (current, *sibling)
            } else {
                (*sibling, current)
            };
            
            let mut combined = Vec::with_capacity(64);
            combined.extend_from_slice(&left);
            combined.extend_from_slice(&right);
            
            current = keccak::hash(&combined).0;
        }
        
        current == root
    }
}

/// Struttura per una transizione di stato
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
pub struct StateTransition {
    /// ID univoco della transizione di stato
    pub id: [u8; 32],
    /// Hash dello stato iniziale
    pub from_state_hash: [u8; 32],
    /// Hash dello stato finale
    pub to_state_hash: [u8; 32],
    /// Batch di transazioni che ha causato la transizione
    pub batch: Batch,
    /// Timestamp della transizione
    pub timestamp: u64,
    /// Firma del sequencer
    pub signature: Vec<u8>,
}

impl StateTransition {
    /// Crea una nuova transizione di stato
    pub fn new(
        from_state_hash: [u8; 32],
        to_state_hash: [u8; 32],
        batch: Batch,
        timestamp: u64,
        signature: Vec<u8>,
    ) -> Self {
        let mut transition = Self {
            id: [0; 32],
            from_state_hash,
            to_state_hash,
            batch,
            timestamp,
            signature,
        };
        
        // Calcola l'ID della transizione come hash dei suoi campi
        transition.id = transition.hash();
        
        transition
    }
    
    /// Calcola l'hash della transizione
    pub fn hash(&self) -> [u8; 32] {
        let mut data_to_hash = Vec::new();
        
        data_to_hash.extend_from_slice(&self.from_state_hash);
        data_to_hash.extend_from_slice(&self.to_state_hash);
        data_to_hash.extend_from_slice(&self.batch.id);
        data_to_hash.extend_from_slice(&self.timestamp.to_le_bytes());
        
        keccak::hash(&data_to_hash).0
    }
    
    /// Verifica la firma della transizione
    pub fn verify_signature(&self, public_key: &[u8]) -> Result<bool, ProgramError> {
        // Implementazione semplificata della verifica della firma
        // In un'implementazione reale, verificheremmo la firma crittografica
        
        if self.signature.is_empty() {
            return Err(Layer2Error::InvalidSignature.into());
        }
        
        // Simuliamo una verifica della firma
        Ok(true)
    }
}

/// Struttura per lo stato del Layer-2
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
pub struct Layer2State {
    /// Versione dello stato
    pub version: u8,
    /// Numero di blocco
    pub block_number: u64,
    /// Timestamp dell'ultimo aggiornamento
    pub timestamp: u64,
    /// Root dell'albero di Merkle degli account
    pub accounts_root: [u8; 32],
    /// Root dell'albero di Merkle delle transazioni
    pub transactions_root: [u8; 32],
    /// Hash dell'ultimo batch elaborato
    pub last_batch_hash: [u8; 32],
    /// Sequencer attuale
    pub sequencer: Pubkey,
    /// Flag di inizializzazione
    pub is_initialized: bool,
}

impl Layer2State {
    /// Crea un nuovo stato
    pub fn new(
        version: u8,
        block_number: u64,
        timestamp: u64,
        accounts_root: [u8; 32],
        transactions_root: [u8; 32],
        last_batch_hash: [u8; 32],
        sequencer: Pubkey,
    ) -> Self {
        Self {
            version,
            block_number,
            timestamp,
            accounts_root,
            transactions_root,
            last_batch_hash,
            sequencer,
            is_initialized: true,
        }
    }
    
    /// Calcola l'hash dello stato
    pub fn hash(&self) -> [u8; 32] {
        let mut data_to_hash = Vec::new();
        
        data_to_hash.push(self.version);
        data_to_hash.extend_from_slice(&self.block_number.to_le_bytes());
        data_to_hash.extend_from_slice(&self.timestamp.to_le_bytes());
        data_to_hash.extend_from_slice(&self.accounts_root);
        data_to_hash.extend_from_slice(&self.transactions_root);
        data_to_hash.extend_from_slice(&self.last_batch_hash);
        data_to_hash.extend_from_slice(&self.sequencer.to_bytes());
        
        keccak::hash(&data_to_hash).0
    }
}

impl Sealed for Layer2State {}

impl IsInitialized for Layer2State {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}

impl Pack for Layer2State {
    const LEN: usize = size_of::<u8>() + size_of::<u64>() + size_of::<u64>() + 
                       size_of::<[u8; 32]>() + size_of::<[u8; 32]>() + 
                       size_of::<[u8; 32]>() + size_of::<Pubkey>() + 
                       size_of::<bool>();
    
    fn pack_into_slice(&self, dst: &mut [u8]) {
        let mut offset = 0;
        
        dst[offset] = self.version;
        offset += 1;
        
        dst[offset..offset + 8].copy_from_slice(&self.block_number.to_le_bytes());
        offset += 8;
        
        dst[offset..offset + 8].copy_from_slice(&self.timestamp.to_le_bytes());
        offset += 8;
        
        dst[offset..offset + 32].copy_from_slice(&self.accounts_root);
        offset += 32;
        
        dst[offset..offset + 32].copy_from_slice(&self.transactions_root);
        offset += 32;
        
        dst[offset..offset + 32].copy_from_slice(&self.last_batch_hash);
        offset += 32;
        
        dst[offset..offset + 32].copy_from_slice(&self.sequencer.to_bytes());
        offset += 32;
        
        dst[offset] = self.is_initialized as u8;
    }
    
    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        if src.len() != Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        
        let mut offset = 0;
        
        let version = src[offset];
        offset += 1;
        
        let block_number = u64::from_le_bytes(src[offset..offset + 8].try_into().unwrap());
        offset += 8;
        
        let timestamp = u64::from_le_bytes(src[offset..offset + 8].try_into().unwrap());
        offset += 8;
        
        let mut accounts_root = [0; 32];
        accounts_root.copy_from_slice(&src[offset..offset + 32]);
        offset += 32;
        
        let mut transactions_root = [0; 32];
        transactions_root.copy_from_slice(&src[offset..offset + 32]);
        offset += 32;
        
        let mut last_batch_hash = [0; 32];
        last_batch_hash.copy_from_slice(&src[offset..offset + 32]);
        offset += 32;
        
        let sequencer = Pubkey::new(&src[offset..offset + 32]);
        offset += 32;
        
        let is_initialized = src[offset] != 0;
        
        Ok(Self {
            version,
            block_number,
            timestamp,
            accounts_root,
            transactions_root,
            last_batch_hash,
            sequencer,
            is_initialized,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_transaction_hash() {
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        
        let tx = Transaction::new(
            sender,
            recipient,
            1000,
            1,
            1000000,
            TransactionType::Transfer,
            vec![1, 2, 3],
            vec![4, 5, 6],
        );
        
        let hash = tx.hash();
        assert_ne!(hash, [0; 32]);
    }
    
    #[test]
    fn test_batch_merkle_root() {
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        
        let tx1 = Transaction::new(
            sender,
            recipient,
            1000,
            1,
            1000000,
            TransactionType::Transfer,
            vec![1, 2, 3],
            vec![4, 5, 6],
        );
        
        let tx2 = Transaction::new(
            sender,
            recipient,
            2000,
            2,
            1000000,
            TransactionType::Transfer,
            vec![7, 8, 9],
            vec![10, 11, 12],
        );
        
        let sequencer = Pubkey::new_unique();
        
        let batch = Batch::new(
            vec![tx1, tx2],
            sequencer,
            1000000,
            2000000,
            vec![13, 14, 15],
        );
        
        let merkle_root = batch.compute_merkle_root();
        assert_ne!(merkle_root, [0; 32]);
    }
    
    #[test]
    fn test_merkle_tree() {
        let leaves = vec![
            [1; 32],
            [2; 32],
            [3; 32],
            [4; 32],
        ];
        
        let tree = MerkleTree::new(leaves.clone());
        let root = tree.root();
        
        for (i, leaf) in leaves.iter().enumerate() {
            let proof = tree.generate_proof(i);
            assert!(MerkleTree::verify_proof(*leaf, &proof, root));
        }
    }
    
    #[test]
    fn test_account_pack_unpack() {
        let pubkey = Pubkey::new_unique();
        let account = Account::new(pubkey);
        
        let mut dst = vec![0; Account::LEN];
        account.pack_into_slice(&mut dst);
        
        let unpacked = Account::unpack_from_slice(&dst).unwrap();
        assert_eq!(account.pubkey, unpacked.pubkey);
        assert_eq!(account.balance, unpacked.balance);
        assert_eq!(account.nonce, unpacked.nonce);
        assert_eq!(account.is_initialized, unpacked.is_initialized);
    }
    
    #[test]
    fn test_layer2_state_pack_unpack() {
        let sequencer = Pubkey::new_unique();
        let state = Layer2State::new(
            1,
            100,
            1000000,
            [1; 32],
            [2; 32],
            [3; 32],
            sequencer,
        );
        
        let mut dst = vec![0; Layer2State::LEN];
        state.pack_into_slice(&mut dst);
        
        let unpacked = Layer2State::unpack_from_slice(&dst).unwrap();
        assert_eq!(state.version, unpacked.version);
        assert_eq!(state.block_number, unpacked.block_number);
        assert_eq!(state.timestamp, unpacked.timestamp);
        assert_eq!(state.accounts_root, unpacked.accounts_root);
        assert_eq!(state.transactions_root, unpacked.transactions_root);
        assert_eq!(state.last_batch_hash, unpacked.last_batch_hash);
        assert_eq!(state.sequencer, unpacked.sequencer);
        assert_eq!(state.is_initialized, unpacked.is_initialized);
    }
}
