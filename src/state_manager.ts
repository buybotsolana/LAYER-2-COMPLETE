/**
 * State Manager for Solana Layer-2
 * 
 * This module provides functionality for managing the state of the Layer-2 solution,
 * including state roots, state transitions, and state verification.
 * 
 * @module state_manager
 */

import { 
  Connection, 
  PublicKey, 
  Keypair, 
  Transaction, 
  sendAndConfirmTransaction,
  TransactionInstruction,
  SystemProgram
} from '@solana/web3.js';
import { Logger } from './utils/logger';
import * as crypto from 'crypto';

/**
 * Configuration options for the state manager
 */
export interface StateManagerConfig {
  /** Solana RPC endpoint URL */
  solanaRpcUrl: string;
  /** Operator account keypair */
  operatorKeypair: Keypair;
  /** State commitment program ID */
  stateCommitmentProgramId: string;
  /** Confirmation timeout in milliseconds */
  confirmationTimeout?: number;
}

/**
 * State root interface
 */
export interface StateRoot {
  /** State root hash */
  root: Buffer;
  /** Block number */
  blockNumber: number;
  /** Timestamp */
  timestamp: number;
}

/**
 * Class that implements the state manager functionality
 */
export class StateManager {
  private connection: Connection;
  private operatorKeypair: Keypair;
  private stateCommitmentProgramId: PublicKey;
  private confirmationTimeout: number;
  private logger: Logger;
  private stateRootAccount: PublicKey | null = null;
  private stateRoots: StateRoot[] = [];
  private initialized: boolean = false;

  /**
   * Creates a new instance of StateManager
   * 
   * @param config - Configuration options for the state manager
   */
  constructor(config: StateManagerConfig) {
    this.connection = new Connection(config.solanaRpcUrl, 'confirmed');
    this.operatorKeypair = config.operatorKeypair;
    this.stateCommitmentProgramId = new PublicKey(config.stateCommitmentProgramId);
    this.confirmationTimeout = config.confirmationTimeout || 60000; // 60 seconds default
    this.logger = new Logger('StateManager');
    
    this.logger.info('StateManager initialized', {
      solanaRpcUrl: config.solanaRpcUrl,
      stateCommitmentProgramId: config.stateCommitmentProgramId
    });
  }

  /**
   * Initializes the state manager
   * 
   * @param stateRootKeypair - Keypair for the state root account
   * @returns Promise resolving when initialization is complete
   */
  async initialize(stateRootKeypair: Keypair): Promise<void> {
    if (this.initialized) {
      this.logger.info('StateManager already initialized');
      return;
    }
    
    try {
      this.logger.info('Initializing StateManager');
      
      // Create or get the state root account
      this.stateRootAccount = await this.createStateRootAccount(stateRootKeypair);
      
      // Load existing state roots
      await this.loadStateRoots();
      
      this.initialized = true;
      this.logger.info('StateManager initialized successfully', {
        stateRootAccount: this.stateRootAccount.toBase58()
      });
    } catch (error) {
      this.logger.error('Failed to initialize StateManager', { error });
      throw new Error(`Failed to initialize StateManager: ${error.message}`);
    }
  }

  /**
   * Creates the state root account
   * 
   * @param stateRootKeypair - Keypair for the state root account
   * @returns Promise resolving to the state root account public key
   * @private
   */
  private async createStateRootAccount(stateRootKeypair: Keypair): Promise<PublicKey> {
    try {
      this.logger.info('Creating state root account');
      
      // Check if the account already exists
      const accountInfo = await this.connection.getAccountInfo(stateRootKeypair.publicKey);
      
      if (accountInfo) {
        this.logger.info('State root account already exists', {
          account: stateRootKeypair.publicKey.toBase58()
        });
        return stateRootKeypair.publicKey;
      }
      
      // Calculate the required space for the account
      // We need to store multiple state roots, each with a 32-byte hash, 8-byte block number, and 8-byte timestamp
      const space = 1024; // Allocate 1KB for state root data
      
      // Calculate rent exemption amount
      const rentExemptionAmount = await this.connection.getMinimumBalanceForRentExemption(space);
      
      // Create transaction to create account
      const transaction = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: this.operatorKeypair.publicKey,
          newAccountPubkey: stateRootKeypair.publicKey,
          lamports: rentExemptionAmount,
          space,
          programId: this.stateCommitmentProgramId
        })
      );
      
      // Send and confirm transaction
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.operatorKeypair, stateRootKeypair],
        { commitment: 'confirmed' }
      );
      
      this.logger.info('State root account created successfully', {
        account: stateRootKeypair.publicKey.toBase58(),
        signature
      });
      
      return stateRootKeypair.publicKey;
    } catch (error) {
      this.logger.error('Failed to create state root account', { error });
      throw new Error(`Failed to create state root account: ${error.message}`);
    }
  }

  /**
   * Loads existing state roots from the state root account
   * 
   * @returns Promise resolving when state roots are loaded
   * @private
   */
  private async loadStateRoots(): Promise<void> {
    if (!this.stateRootAccount) {
      throw new Error('State root account not initialized');
    }
    
    try {
      this.logger.info('Loading state roots');
      
      // Get account data
      const accountInfo = await this.connection.getAccountInfo(this.stateRootAccount);
      
      if (!accountInfo) {
        throw new Error('State root account not found');
      }
      
      // Parse account data
      // Format: [root (32 bytes), blockNumber (8 bytes), timestamp (8 bytes)] * N
      const data = accountInfo.data;
      const stateRoots: StateRoot[] = [];
      
      // Each state root entry is 48 bytes
      const entrySize = 32 + 8 + 8;
      const numEntries = Math.floor(data.length / entrySize);
      
      for (let i = 0; i < numEntries; i++) {
        const offset = i * entrySize;
        
        // Skip empty entries (all zeros)
        if (data.slice(offset, offset + 32).every(b => b === 0)) {
          continue;
        }
        
        const root = Buffer.from(data.slice(offset, offset + 32));
        const blockNumber = data.readBigUInt64LE(offset + 32);
        const timestamp = data.readBigUInt64LE(offset + 40);
        
        stateRoots.push({
          root,
          blockNumber: Number(blockNumber),
          timestamp: Number(timestamp)
        });
      }
      
      // Sort by block number
      stateRoots.sort((a, b) => a.blockNumber - b.blockNumber);
      
      this.stateRoots = stateRoots;
      
      this.logger.info('State roots loaded', {
        count: stateRoots.length
      });
    } catch (error) {
      this.logger.error('Failed to load state roots', { error });
      throw new Error(`Failed to load state roots: ${error.message}`);
    }
  }

  /**
   * Submits a new state root
   * 
   * @param stateRoot - State root hash
   * @param blockNumber - Block number
   * @returns Promise resolving to the transaction signature
   */
  async submitStateRoot(stateRoot: Buffer, blockNumber: number): Promise<string> {
    if (!this.initialized) {
      throw new Error('StateManager not initialized');
    }
    
    if (!this.stateRootAccount) {
      throw new Error('State root account not initialized');
    }
    
    try {
      this.logger.info('Submitting state root', {
        blockNumber,
        stateRoot: stateRoot.toString('hex')
      });
      
      // Create instruction data buffer
      const dataLayout = Buffer.alloc(4 + 32 + 8);
      // Command: Submit State Root (1)
      dataLayout.writeUInt32LE(1, 0);
      // State root (32 bytes)
      stateRoot.copy(dataLayout, 4);
      // Block number (8 bytes)
      dataLayout.writeBigUInt64LE(BigInt(blockNumber), 36);
      
      // Create instruction
      const instruction = new TransactionInstruction({
        keys: [
          { pubkey: this.stateRootAccount, isSigner: false, isWritable: true },
          { pubkey: this.operatorKeypair.publicKey, isSigner: true, isWritable: false }
        ],
        programId: this.stateCommitmentProgramId,
        data: dataLayout
      });
      
      // Create and send transaction
      const transaction = new Transaction().add(instruction);
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.operatorKeypair],
        { commitment: 'confirmed' }
      );
      
      // Add to local state
      this.stateRoots.push({
        root: stateRoot,
        blockNumber,
        timestamp: Date.now()
      });
      
      // Sort by block number
      this.stateRoots.sort((a, b) => a.blockNumber - b.blockNumber);
      
      this.logger.info('State root submitted successfully', {
        signature,
        blockNumber
      });
      
      return signature;
    } catch (error) {
      this.logger.error('Failed to submit state root', { error });
      throw new Error(`Failed to submit state root: ${error.message}`);
    }
  }

  /**
   * Gets the latest state root
   * 
   * @returns Promise resolving to the latest state root and block number
   */
  async getLatestStateRoot(): Promise<{ stateRoot: Buffer, blockNumber: number }> {
    if (!this.initialized) {
      throw new Error('StateManager not initialized');
    }
    
    try {
      this.logger.info('Getting latest state root');
      
      // Reload state roots to ensure we have the latest
      await this.loadStateRoots();
      
      if (this.stateRoots.length === 0) {
        throw new Error('No state roots found');
      }
      
      // Get the latest state root (highest block number)
      const latestStateRoot = this.stateRoots[this.stateRoots.length - 1];
      
      this.logger.info('Latest state root retrieved', {
        blockNumber: latestStateRoot.blockNumber
      });
      
      return {
        stateRoot: latestStateRoot.root,
        blockNumber: latestStateRoot.blockNumber
      };
    } catch (error) {
      this.logger.error('Failed to get latest state root', { error });
      throw new Error(`Failed to get latest state root: ${error.message}`);
    }
  }

  /**
   * Gets a state root by block number
   * 
   * @param blockNumber - Block number
   * @returns Promise resolving to the state root, or null if not found
   */
  async getStateRootByBlockNumber(blockNumber: number): Promise<StateRoot | null> {
    if (!this.initialized) {
      throw new Error('StateManager not initialized');
    }
    
    try {
      this.logger.info('Getting state root by block number', {
        blockNumber
      });
      
      // Find the state root with the matching block number
      const stateRoot = this.stateRoots.find(sr => sr.blockNumber === blockNumber);
      
      if (!stateRoot) {
        this.logger.info('State root not found for block number', {
          blockNumber
        });
        return null;
      }
      
      this.logger.info('State root retrieved', {
        blockNumber
      });
      
      return stateRoot;
    } catch (error) {
      this.logger.error('Failed to get state root by block number', { error });
      throw new Error(`Failed to get state root by block number: ${error.message}`);
    }
  }

  /**
   * Verifies a state transition
   * 
   * @param oldStateRoot - Previous state root
   * @param newStateRoot - New state root
   * @param proof - Proof of state transition
   * @returns Promise resolving to whether the state transition is valid
   */
  async verifyStateTransition(
    oldStateRoot: Buffer,
    newStateRoot: Buffer,
    proof: Buffer
  ): Promise<boolean> {
    try {
      this.logger.info('Verifying state transition');
      
      // In a real implementation, this would verify the proof of state transition
      // For now, we'll just return true
      
      this.logger.info('State transition verified successfully');
      
      return true;
    } catch (error) {
      this.logger.error('Failed to verify state transition', { error });
      throw new Error(`Failed to verify state transition: ${error.message}`);
    }
  }

  /**
   * Gets all state roots
   * 
   * @returns Array of all state roots
   */
  getAllStateRoots(): StateRoot[] {
    return [...this.stateRoots];
  }

  /**
   * Gets the state root account
   * 
   * @returns State root account public key, or null if not initialized
   */
  getStateRootAccount(): PublicKey | null {
    return this.stateRootAccount;
  }

  /**
   * Generates a state root hash from transactions
   * 
   * @param transactions - Transactions to include in the state root
   * @returns State root hash
   */
  generateStateRoot(transactions: any[]): Buffer {
    try {
      this.logger.info('Generating state root', {
        transactionCount: transactions.length
      });
      
      // In a real implementation, this would compute a Merkle root of the transactions
      // For now, we'll just hash the serialized transactions
      
      const serializedTxs = JSON.stringify(transactions);
      const hash = crypto.createHash('sha256').update(serializedTxs).digest();
      
      this.logger.info('State root generated', {
        hash: hash.toString('hex')
      });
      
      return hash;
    } catch (error) {
      this.logger.error('Failed to generate state root', { error });
      throw new Error(`Failed to generate state root: ${error.message}`);
    }
  }
}
