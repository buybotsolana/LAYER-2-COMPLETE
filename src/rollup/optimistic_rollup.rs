// src/rollup/optimistic_rollup.rs
//! Optimistic Rollup implementation for Layer-2 on Solana
//!
//! This module implements an optimistic rollup system that allows for off-chain
//! transaction execution with on-chain verification. It includes mechanisms for
//! batching transactions, committing state, and handling fraud proofs.

use std::collections::{HashMap, VecDeque};
use std::time::{Duration, SystemTime};
use solana_program::hash::{Hash, Hasher};
use solana_program::pubkey::Pubkey;
use solana_program::instruction::{AccountMeta, Instruction};
use solana_program::program_error::ProgramError;

/// The duration of the challenge period in seconds (7 days)
pub const CHALLENGE_PERIOD_SECONDS: u64 = 7 * 24 * 60 * 60;

/// Status of a batch in the rollup
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BatchStatus {
    /// Batch has been submitted but not yet finalized
    Pending,
    /// Batch has been challenged
    Challenged,
    /// Batch has been finalized
    Finalized,
    /// Batch has been proven fraudulent
    Rejected,
}

/// A transaction to be included in a batch
#[derive(Debug, Clone)]
pub struct RollupTransaction {
    /// Sender of the transaction
    pub sender: Pubkey,
    /// Recipient of the transaction
    pub recipient: Pubkey,
    /// Amount to transfer
    pub amount: u64,
    /// Transaction data
    pub data: Vec<u8>,
    /// Transaction signature
    pub signature: Vec<u8>,
    /// Transaction nonce
    pub nonce: u64,
    /// Gas price
    pub gas_price: u64,
    /// Gas limit
    pub gas_limit: u64,
}

/// A batch of transactions in the rollup
#[derive(Debug, Clone)]
pub struct Batch {
    /// Unique identifier for the batch
    pub batch_id: u64,
    /// Transactions included in the batch
    pub transactions: Vec<RollupTransaction>,
    /// Hash of the state root before executing the batch
    pub pre_state_root: Hash,
    /// Hash of the state root after executing the batch
    pub post_state_root: Hash,
    /// Timestamp when the batch was submitted
    pub timestamp: SystemTime,
    /// Status of the batch
    pub status: BatchStatus,
    /// Sequencer that submitted the batch
    pub sequencer: Pubkey,
    /// Aggregated transaction fees
    pub fees: u64,
}

/// A challenge to a batch
#[derive(Debug, Clone)]
pub struct Challenge {
    /// Batch being challenged
    pub batch_id: u64,
    /// Account submitting the challenge
    pub challenger: Pubkey,
    /// Reason for the challenge
    pub reason: ChallengeReason,
    /// Timestamp when the challenge was submitted
    pub timestamp: SystemTime,
    /// Stake amount for the challenge
    pub stake: u64,
}

/// Reason for challenging a batch
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChallengeReason {
    /// Invalid state transition
    InvalidStateTransition,
    /// Invalid transaction signature
    InvalidSignature,
    /// Invalid transaction format
    InvalidFormat,
    /// Double-spend attempt
    DoubleSpend,
    /// Other reason (with description)
    Other(String),
}

/// The Optimistic Rollup system
pub struct OptimisticRollup {
    /// Current batch ID
    pub current_batch_id: u64,
    /// Mapping of batch IDs to batches
    pub batches: HashMap<u64, Batch>,
    /// Queue of pending batches
    pub pending_batches: VecDeque<u64>,
    /// Mapping of batch IDs to challenges
    pub challenges: HashMap<u64, Vec<Challenge>>,
    /// Current state root
    pub state_root: Hash,
    /// Mapping of accounts to balances
    pub balances: HashMap<Pubkey, u64>,
    /// Mapping of accounts to nonces
    pub nonces: HashMap<Pubkey, u64>,
}

impl OptimisticRollup {
    /// Create a new Optimistic Rollup instance
    pub fn new() -> Self {
        let mut hasher = Hasher::default();
        hasher.hash(&[0; 32]);
        
        OptimisticRollup {
            current_batch_id: 0,
            batches: HashMap::new(),
            pending_batches: VecDeque::new(),
            challenges: HashMap::new(),
            state_root: hasher.result(),
            balances: HashMap::new(),
            nonces: HashMap::new(),
        }
    }

    /// Create a new batch of transactions
    pub fn create_batch(&mut self, transactions: Vec<RollupTransaction>, sequencer: Pubkey) -> Result<u64, ProgramError> {
        // Validate transactions
        for tx in &transactions {
            self.validate_transaction(tx)?;
        }

        // Calculate pre-state root
        let pre_state_root = self.state_root;

        // Apply transactions to get post-state root
        let mut temp_balances = self.balances.clone();
        let mut temp_nonces = self.nonces.clone();

        for tx in &transactions {
            // Update sender balance
            let sender_balance = temp_balances.get(&tx.sender).unwrap_or(&0);
            let total_cost = tx.amount + tx.gas_price * tx.gas_limit;
            
            if *sender_balance < total_cost {
                return Err(ProgramError::InsufficientFunds);
            }
            
            temp_balances.insert(tx.sender, sender_balance - total_cost);
            
            // Update recipient balance
            let recipient_balance = temp_balances.get(&tx.recipient).unwrap_or(&0);
            temp_balances.insert(tx.recipient, recipient_balance + tx.amount);
            
            // Update nonce
            let sender_nonce = temp_nonces.get(&tx.sender).unwrap_or(&0);
            if tx.nonce != *sender_nonce + 1 {
                return Err(ProgramError::InvalidArgument);
            }
            temp_nonces.insert(tx.sender, tx.nonce);
        }

        // Calculate post-state root
        let mut hasher = Hasher::default();
        for (pubkey, balance) in &temp_balances {
            hasher.hash(pubkey.as_ref());
            hasher.hash(&balance.to_le_bytes());
        }
        for (pubkey, nonce) in &temp_nonces {
            hasher.hash(pubkey.as_ref());
            hasher.hash(&nonce.to_le_bytes());
        }
        let post_state_root = hasher.result();

        // Calculate total fees
        let total_fees: u64 = transactions.iter()
            .map(|tx| tx.gas_price * tx.gas_limit)
            .sum();

        // Create batch
        let batch_id = self.current_batch_id;
        let batch = Batch {
            batch_id,
            transactions,
            pre_state_root,
            post_state_root,
            timestamp: SystemTime::now(),
            status: BatchStatus::Pending,
            sequencer,
            fees: total_fees,
        };

        // Store batch
        self.batches.insert(batch_id, batch);
        self.pending_batches.push_back(batch_id);
        self.current_batch_id += 1;

        Ok(batch_id)
    }

    /// Validate a transaction
    fn validate_transaction(&self, transaction: &RollupTransaction) -> Result<(), ProgramError> {
        // Check if sender has sufficient balance
        let sender_balance = self.balances.get(&transaction.sender).unwrap_or(&0);
        let total_cost = transaction.amount + transaction.gas_price * transaction.gas_limit;
        
        if *sender_balance < total_cost {
            return Err(ProgramError::InsufficientFunds);
        }
        
        // Check nonce
        let sender_nonce = self.nonces.get(&transaction.sender).unwrap_or(&0);
        if transaction.nonce != *sender_nonce + 1 {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Verify signature (simplified for example)
        // In a real implementation, this would use proper cryptographic verification
        if transaction.signature.is_empty() {
            return Err(ProgramError::MissingRequiredSignature);
        }
        
        Ok(())
    }

    /// Submit a challenge to a batch
    pub fn challenge_batch(&mut self, batch_id: u64, challenger: Pubkey, reason: ChallengeReason, stake: u64) -> Result<(), ProgramError> {
        // Check if batch exists
        if !self.batches.contains_key(&batch_id) {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if batch is still in challenge period
        let batch = self.batches.get(&batch_id).unwrap();
        if batch.status != BatchStatus::Pending {
            return Err(ProgramError::InvalidArgument);
        }
        
        let now = SystemTime::now();
        let elapsed = now.duration_since(batch.timestamp).unwrap_or(Duration::from_secs(0));
        if elapsed.as_secs() > CHALLENGE_PERIOD_SECONDS {
            // Batch is past challenge period, should be finalized
            return Err(ProgramError::InvalidArgument);
        }
        
        // Create challenge
        let challenge = Challenge {
            batch_id,
            challenger,
            reason,
            timestamp: now,
            stake,
        };
        
        // Store challenge
        if let Some(challenges) = self.challenges.get_mut(&batch_id) {
            challenges.push(challenge);
        } else {
            self.challenges.insert(batch_id, vec![challenge]);
        }
        
        // Update batch status
        if let Some(batch) = self.batches.get_mut(&batch_id) {
            batch.status = BatchStatus::Challenged;
        }
        
        Ok(())
    }

    /// Resolve a challenge
    pub fn resolve_challenge(&mut self, batch_id: u64, challenge_index: usize, is_valid: bool) -> Result<(), ProgramError> {
        // Check if batch exists
        if !self.batches.contains_key(&batch_id) {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Check if challenge exists
        if !self.challenges.contains_key(&batch_id) || self.challenges.get(&batch_id).unwrap().len() <= challenge_index {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Get batch and challenge
        let batch = self.batches.get_mut(&batch_id).unwrap();
        let challenges = self.challenges.get_mut(&batch_id).unwrap();
        let challenge = &challenges[challenge_index];
        
        if is_valid {
            // Challenge is valid, reject batch
            batch.status = BatchStatus::Rejected;
            
            // Reward challenger
            if let Some(balance) = self.balances.get_mut(&challenge.challenger) {
                *balance += challenge.stake * 2; // Double the stake as reward
            } else {
                self.balances.insert(challenge.challenger, challenge.stake * 2);
            }
        } else {
            // Challenge is invalid, remove it
            challenges.remove(challenge_index);
            
            // If no more challenges, set batch back to pending
            if challenges.is_empty() {
                batch.status = BatchStatus::Pending;
            }
            
            // Slash challenger stake (it goes to sequencer)
            if let Some(balance) = self.balances.get_mut(&batch.sequencer) {
                *balance += challenge.stake;
            } else {
                self.balances.insert(batch.sequencer, challenge.stake);
            }
        }
        
        Ok(())
    }

    /// Finalize a batch after challenge period
    pub fn finalize_batch(&mut self, batch_id: u64) -> Result<(), ProgramError> {
        // Check if batch exists
        if !self.batches.contains_key(&batch_id) {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Get batch
        let batch = self.batches.get_mut(&batch_id).unwrap();
        
        // Check if batch can be finalized
        if batch.status != BatchStatus::Pending {
            return Err(ProgramError::InvalidArgument);
        }
        
        let now = SystemTime::now();
        let elapsed = now.duration_since(batch.timestamp).unwrap_or(Duration::from_secs(0));
        if elapsed.as_secs() < CHALLENGE_PERIOD_SECONDS {
            // Challenge period not over yet
            return Err(ProgramError::InvalidArgument);
        }
        
        // Finalize batch
        batch.status = BatchStatus::Finalized;
        
        // Apply state changes
        self.state_root = batch.post_state_root;
        
        // Apply transactions
        for tx in &batch.transactions {
            // Update sender balance
            let sender_balance = self.balances.get(&tx.sender).unwrap_or(&0);
            let total_cost = tx.amount + tx.gas_price * tx.gas_limit;
            self.balances.insert(tx.sender, sender_balance - total_cost);
            
            // Update recipient balance
            let recipient_balance = self.balances.get(&tx.recipient).unwrap_or(&0);
            self.balances.insert(tx.recipient, recipient_balance + tx.amount);
            
            // Update nonce
            self.nonces.insert(tx.sender, tx.nonce);
            
            // Pay fees to sequencer
            let sequencer_balance = self.balances.get(&batch.sequencer).unwrap_or(&0);
            self.balances.insert(batch.sequencer, sequencer_balance + tx.gas_price * tx.gas_limit);
        }
        
        // Remove batch from pending queue
        self.pending_batches.retain(|&id| id != batch_id);
        
        Ok(())
    }

    /// Get batch by ID
    pub fn get_batch(&self, batch_id: u64) -> Option<&Batch> {
        self.batches.get(&batch_id)
    }

    /// Get challenges for a batch
    pub fn get_challenges(&self, batch_id: u64) -> Option<&Vec<Challenge>> {
        self.challenges.get(&batch_id)
    }

    /// Get account balance
    pub fn get_balance(&self, account: &Pubkey) -> u64 {
        *self.balances.get(account).unwrap_or(&0)
    }

    /// Get account nonce
    pub fn get_nonce(&self, account: &Pubkey) -> u64 {
        *self.nonces.get(account).unwrap_or(&0)
    }

    /// Create an instruction to submit a batch
    pub fn create_submit_batch_instruction(
        program_id: &Pubkey,
        payer: &Pubkey,
        transactions: Vec<RollupTransaction>,
    ) -> Instruction {
        // Serialize transactions
        let mut data = Vec::new();
        data.extend_from_slice(&[0]); // Instruction discriminator: 0 = SubmitBatch
        
        // Serialize number of transactions
        data.extend_from_slice(&(transactions.len() as u32).to_le_bytes());
        
        // Serialize each transaction
        for tx in transactions {
            data.extend_from_slice(tx.sender.as_ref());
            data.extend_from_slice(tx.recipient.as_ref());
            data.extend_from_slice(&tx.amount.to_le_bytes());
            
            // Serialize data length and data
            data.extend_from_slice(&(tx.data.len() as u32).to_le_bytes());
            data.extend_from_slice(&tx.data);
            
            // Serialize signature length and signature
            data.extend_from_slice(&(tx.signature.len() as u32).to_le_bytes());
            data.extend_from_slice(&tx.signature);
            
            data.extend_from_slice(&tx.nonce.to_le_bytes());
            data.extend_from_slice(&tx.gas_price.to_le_bytes());
            data.extend_from_slice(&tx.gas_limit.to_le_bytes());
        }
        
        Instruction {
            program_id: *program_id,
            accounts: vec![
                AccountMeta::new(*payer, true), // Payer account (signer)
            ],
            data,
        }
    }

    /// Create an instruction to challenge a batch
    pub fn create_challenge_batch_instruction(
        program_id: &Pubkey,
        challenger: &Pubkey,
        batch_id: u64,
        reason: ChallengeReason,
        stake: u64,
    ) -> Instruction {
        // Serialize challenge data
        let mut data = Vec::new();
        data.extend_from_slice(&[1]); // Instruction discriminator: 1 = ChallengeBatch
        data.extend_from_slice(&batch_id.to_le_bytes());
        
        // Serialize reason
        let reason_code = match reason {
            ChallengeReason::InvalidStateTransition => 0u8,
            ChallengeReason::InvalidSignature => 1u8,
            ChallengeReason::InvalidFormat => 2u8,
            ChallengeReason::DoubleSpend => 3u8,
            ChallengeReason::Other(_) => 4u8,
        };
        data.extend_from_slice(&[reason_code]);
        
        if let ChallengeReason::Other(description) = reason {
            data.extend_from_slice(&(description.len() as u32).to_le_bytes());
            data.extend_from_slice(description.as_bytes());
        }
        
        data.extend_from_slice(&stake.to_le_bytes());
        
        Instruction {
            program_id: *program_id,
            accounts: vec![
                AccountMeta::new(*challenger, true), // Challenger account (signer)
            ],
            data,
        }
    }

    /// Create an instruction to finalize a batch
    pub fn create_finalize_batch_instruction(
        program_id: &Pubkey,
        finalizer: &Pubkey,
        batch_id: u64,
    ) -> Instruction {
        // Serialize finalize data
        let mut data = Vec::new();
        data.extend_from_slice(&[2]); // Instruction discriminator: 2 = FinalizeBatch
        data.extend_from_slice(&batch_id.to_le_bytes());
        
        Instruction {
            program_id: *program_id,
            accounts: vec![
                AccountMeta::new(*finalizer, true), // Finalizer account (signer)
            ],
            data,
        }
    }
}

/// Tests for the Optimistic Rollup system
#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;
    
    #[test]
    fn test_create_batch() {
        let mut rollup = OptimisticRollup::new();
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        let sequencer = Pubkey::new_unique();
        
        // Add balance to sender
        rollup.balances.insert(sender, 1000);
        
        // Create transaction
        let tx = RollupTransaction {
            sender,
            recipient,
            amount: 100,
            data: vec![],
            signature: vec![1, 2, 3], // Dummy signature
            nonce: 1,
            gas_price: 10,
            gas_limit: 5,
        };
        
        // Create batch
        let batch_id = rollup.create_batch(vec![tx], sequencer).unwrap();
        
        // Verify batch was created
        assert_eq!(batch_id, 0);
        assert_eq!(rollup.current_batch_id, 1);
        assert_eq!(rollup.pending_batches.len(), 1);
        assert_eq!(rollup.batches.len(), 1);
        
        // Verify batch details
        let batch = rollup.get_batch(batch_id).unwrap();
        assert_eq!(batch.transactions.len(), 1);
        assert_eq!(batch.status, BatchStatus::Pending);
        assert_eq!(batch.sequencer, sequencer);
        assert_eq!(batch.fees, 50); // 10 gas price * 5 gas limit
    }
    
    #[test]
    fn test_challenge_and_resolve() {
        let mut rollup = OptimisticRollup::new();
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        let sequencer = Pubkey::new_unique();
        let challenger = Pubkey::new_unique();
        
        // Add balance to sender and challenger
        rollup.balances.insert(sender, 1000);
        rollup.balances.insert(challenger, 500);
        
        // Create transaction
        let tx = RollupTransaction {
            sender,
            recipient,
            amount: 100,
            data: vec![],
            signature: vec![1, 2, 3], // Dummy signature
            nonce: 1,
            gas_price: 10,
            gas_limit: 5,
        };
        
        // Create batch
        let batch_id = rollup.create_batch(vec![tx], sequencer).unwrap();
        
        // Challenge batch
        rollup.challenge_batch(
            batch_id,
            challenger,
            ChallengeReason::InvalidSignature,
            100
        ).unwrap();
        
        // Verify batch was challenged
        let batch = rollup.get_batch(batch_id).unwrap();
        assert_eq!(batch.status, BatchStatus::Challenged);
        
        // Verify challenge was created
        let challenges = rollup.get_challenges(batch_id).unwrap();
        assert_eq!(challenges.len(), 1);
        assert_eq!(challenges[0].challenger, challenger);
        assert_eq!(challenges[0].stake, 100);
        
        // Resolve challenge as valid
        rollup.resolve_challenge(batch_id, 0, true).unwrap();
        
        // Verify batch was rejected
        let batch = rollup.get_batch(batch_id).unwrap();
        assert_eq!(batch.status, BatchStatus::Rejected);
        
        // Verify challenger was rewarded
        assert_eq!(rollup.get_balance(&challenger), 600); // 500 - 100 stake + 200 reward
    }
    
    #[test]
    fn test_finalize_batch() {
        let mut rollup = OptimisticRollup::new();
        let sender = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        let sequencer = Pubkey::new_unique();
        
        // Add balance to sender
        rollup.balances.insert(sender, 1000);
        
        // Create transaction
        let tx = RollupTransaction {
            sender,
            recipient,
            amount: 100,
            data: vec![],
            signature: vec![1, 2, 3], // Dummy signature
            nonce: 1,
            gas_price: 10,
            gas_limit: 5,
        };
        
        // Create batch
        let batch_id = rollup.create_batch(vec![tx], sequencer).unwrap();
        
        // Try to finalize before challenge period
        let result = rollup.finalize_batch(batch_id);
        assert!(result.is_err());
        
        // Manually set batch timestamp to be in the past
        if let Some(batch) = rollup.batches.get_mut(&batch_id) {
            batch.timestamp = SystemTime::now() - Duration::from_secs(CHALLENGE_PERIOD_SECONDS + 1);
        }
        
        // Now finalize should succeed
        rollup.finalize_batch(batch_id).unwrap();
        
        // Verify batch was finalized
        let batch = rollup.get_batch(batch_id).unwrap();
        assert_eq!(batch.status, BatchStatus::Finalized);
        
        // Verify state was updated
        assert_eq!(rollup.get_balance(&sender), 850); // 1000 - 100 amount - 50 gas
        assert_eq!(rollup.get_balance(&recipient), 100);
        assert_eq!(rollup.get_balance(&sequencer), 50); // Gas fees
        assert_eq!(rollup.get_nonce(&sender), 1);
        assert_eq!(rollup.pending_batches.len(), 0);
    }
}
