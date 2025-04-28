/**
 * Batch Processor for Solana Layer-2
 * 
 * This module provides functionality for processing transactions in batches,
 * optimizing throughput and reducing costs on the Solana blockchain.
 * 
 * @module batch_processor
 */

import { 
  Connection, 
  PublicKey, 
  Keypair, 
  Transaction, 
  sendAndConfirmTransaction,
  TransactionInstruction
} from '@solana/web3.js';
import { Logger } from './utils/logger';
import * as crypto from 'crypto';

/**
 * Configuration options for the batch processor
 */
export interface BatchProcessorConfig {
  /** Solana RPC endpoint URL */
  solanaRpcUrl: string;
  /** Operator account keypair */
  operatorKeypair: Keypair;
  /** Maximum number of transactions per batch */
  maxBatchSize?: number;
  /** Maximum gas per batch */
  maxGasPerBatch?: number;
  /** Block time in milliseconds */
  blockTime?: number;
  /** Timeout for transaction confirmation in milliseconds */
  confirmationTimeout?: number;
  /** Priority fee in lamports */
  priorityFee?: number;
}

/**
 * Transaction interface for the batch processor
 */
export interface BatchTransaction {
  /** Transaction ID */
  id: string;
  /** Recipient address */
  to: string;
  /** Transaction data */
  data: string;
  /** Transaction value */
  value: number;
  /** Sender address */
  from: string;
  /** Gas limit */
  gas: number;
  /** Gas price */
  gasPrice?: number;
  /** Transaction status */
  status: TransactionStatus;
  /** Transaction hash (after submission) */
  hash?: string;
  /** Transaction timestamp */
  timestamp: number;
}

/**
 * Batch interface for the batch processor
 */
export interface Batch {
  /** Batch ID */
  id: string;
  /** Transactions in the batch */
  transactions: BatchTransaction[];
  /** Batch creation timestamp */
  createdAt: number;
  /** Batch expiration timestamp */
  expiresAt: number;
  /** Batch status */
  status: BatchStatus;
  /** Total gas used by the batch */
  totalGas: number;
  /** Priority fee for the batch */
  priorityFee: number;
  /** Whether the batch has been processed */
  processed: boolean;
}

/**
 * Transaction status enum
 */
export enum TransactionStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  CONFIRMED = 'confirmed',
  FAILED = 'failed'
}

/**
 * Batch status enum
 */
export enum BatchStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  EXPIRED = 'expired',
  ABORTED = 'aborted'
}

/**
 * Class that implements the batch processor functionality
 */
export class BatchProcessor {
  private connection: Connection;
  private operatorKeypair: Keypair;
  private maxBatchSize: number;
  private maxGasPerBatch: number;
  private blockTime: number;
  private confirmationTimeout: number;
  private priorityFee: number;
  private logger: Logger;
  private batches: Map<string, Batch> = new Map();
  private currentBatch: Batch | null = null;
  private processingInterval: NodeJS.Timeout | null = null;
  private initialized: boolean = false;

  /**
   * Creates a new instance of BatchProcessor
   * 
   * @param config - Configuration options for the batch processor
   */
  constructor(config: BatchProcessorConfig) {
    this.connection = new Connection(config.solanaRpcUrl, 'confirmed');
    this.operatorKeypair = config.operatorKeypair;
    this.maxBatchSize = config.maxBatchSize || 1000;
    this.maxGasPerBatch = config.maxGasPerBatch || 10000000; // 10M gas default
    this.blockTime = config.blockTime || 400; // 400ms default block time
    this.confirmationTimeout = config.confirmationTimeout || 60000; // 60 seconds default
    this.priorityFee = config.priorityFee || 10000; // 10,000 lamports default
    this.logger = new Logger('BatchProcessor');
    
    this.logger.info('BatchProcessor initialized', {
      solanaRpcUrl: config.solanaRpcUrl,
      maxBatchSize: this.maxBatchSize,
      maxGasPerBatch: this.maxGasPerBatch,
      blockTime: this.blockTime
    });
  }

  /**
   * Initializes the batch processor
   * 
   * @returns Promise resolving when initialization is complete
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.info('BatchProcessor already initialized');
      return;
    }
    
    try {
      this.logger.info('Initializing BatchProcessor');
      
      // Create initial batch
      this.createNewBatch();
      
      this.initialized = true;
      this.logger.info('BatchProcessor initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize BatchProcessor', { error });
      throw new Error(`Failed to initialize BatchProcessor: ${error.message}`);
    }
  }

  /**
   * Starts the batch processor
   * 
   * @returns Promise resolving when the processor is started
   */
  async start(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    if (this.processingInterval) {
      this.logger.info('BatchProcessor already running');
      return;
    }
    
    this.logger.info('Starting BatchProcessor');
    
    // Start processing batches at regular intervals
    this.processingInterval = setInterval(() => {
      this.processCurrentBatch();
    }, this.blockTime);
    
    this.logger.info('BatchProcessor started successfully');
  }

  /**
   * Stops the batch processor
   * 
   * @returns Promise resolving when the processor is stopped
   */
  async stop(): Promise<void> {
    if (!this.processingInterval) {
      this.logger.info('BatchProcessor already stopped');
      return;
    }
    
    this.logger.info('Stopping BatchProcessor');
    
    // Clear the processing interval
    clearInterval(this.processingInterval);
    this.processingInterval = null;
    
    // Process any remaining transactions in the current batch
    if (this.currentBatch && this.currentBatch.transactions.length > 0) {
      await this.processCurrentBatch();
    }
    
    this.logger.info('BatchProcessor stopped successfully');
  }

  /**
   * Creates a new batch
   * 
   * @param priorityFee - Priority fee for the batch
   * @returns Batch ID
   * @private
   */
  private createNewBatch(priorityFee: number = this.priorityFee): string {
    const batchId = this.generateBatchId();
    const now = Date.now();
    
    const batch: Batch = {
      id: batchId,
      transactions: [],
      createdAt: now,
      expiresAt: now + (this.blockTime * 10), // Expire after 10 blocks
      status: BatchStatus.PENDING,
      totalGas: 0,
      priorityFee,
      processed: false
    };
    
    this.batches.set(batchId, batch);
    this.currentBatch = batch;
    
    this.logger.info('New batch created', {
      batchId,
      expiresAt: new Date(batch.expiresAt).toISOString()
    });
    
    return batchId;
  }

  /**
   * Generates a unique batch ID
   * 
   * @returns Batch ID
   * @private
   */
  private generateBatchId(): string {
    return `batch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Generates a unique transaction ID
   * 
   * @returns Transaction ID
   * @private
   */
  private generateTransactionId(): string {
    return `tx_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Adds a transaction to the current batch
   * 
   * @param transaction - Transaction to add
   * @returns Promise resolving to the transaction ID
   */
  async addTransaction(transaction: Omit<BatchTransaction, 'id' | 'status' | 'timestamp'>): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // Ensure we have a current batch
    if (!this.currentBatch) {
      this.createNewBatch();
    }
    
    // Check if the current batch is full or has expired
    if (this.isBatchFull(this.currentBatch!) || this.isBatchExpired(this.currentBatch!)) {
      this.createNewBatch();
    }
    
    // Create a new transaction object
    const txId = this.generateTransactionId();
    const newTransaction: BatchTransaction = {
      id: txId,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
      from: transaction.from,
      gas: transaction.gas || 21000, // Default gas limit
      gasPrice: transaction.gasPrice,
      status: TransactionStatus.PENDING,
      timestamp: Date.now()
    };
    
    // Add to current batch
    this.currentBatch!.transactions.push(newTransaction);
    this.currentBatch!.totalGas += newTransaction.gas;
    
    this.logger.info('Transaction added to batch', {
      transactionId: txId,
      batchId: this.currentBatch!.id,
      batchSize: this.currentBatch!.transactions.length
    });
    
    return txId;
  }

  /**
   * Checks if a batch is full
   * 
   * @param batch - Batch to check
   * @returns Whether the batch is full
   * @private
   */
  private isBatchFull(batch: Batch): boolean {
    return batch.transactions.length >= this.maxBatchSize || 
           batch.totalGas >= this.maxGasPerBatch;
  }

  /**
   * Checks if a batch has expired
   * 
   * @param batch - Batch to check
   * @returns Whether the batch has expired
   * @private
   */
  private isBatchExpired(batch: Batch): boolean {
    return Date.now() >= batch.expiresAt;
  }

  /**
   * Processes the current batch
   * 
   * @returns Promise resolving when the batch is processed
   * @private
   */
  private async processCurrentBatch(): Promise<void> {
    if (!this.currentBatch || this.currentBatch.transactions.length === 0) {
      return;
    }
    
    // Only process pending batches
    if (this.currentBatch.status !== BatchStatus.PENDING) {
      return;
    }
    
    const batch = this.currentBatch;
    
    try {
      this.logger.info('Processing batch', {
        batchId: batch.id,
        transactionCount: batch.transactions.length
      });
      
      // Update batch status
      batch.status = BatchStatus.PROCESSING;
      
      // Create a new batch for future transactions
      this.createNewBatch();
      
      // Process all transactions in the batch
      const results = await this.processTransactions(batch.transactions);
      
      // Update transaction statuses
      for (let i = 0; i < batch.transactions.length; i++) {
        const tx = batch.transactions[i];
        const result = results[i];
        
        if (result.success) {
          tx.status = TransactionStatus.CONFIRMED;
          tx.hash = result.hash;
        } else {
          tx.status = TransactionStatus.FAILED;
        }
      }
      
      // Update batch status
      batch.status = BatchStatus.COMPLETED;
      batch.processed = true;
      
      this.logger.info('Batch processed successfully', {
        batchId: batch.id,
        successCount: results.filter(r => r.success).length,
        failureCount: results.filter(r => !r.success).length
      });
    } catch (error) {
      this.logger.error('Failed to process batch', { error, batchId: batch.id });
      
      // Update batch status
      batch.status = BatchStatus.FAILED;
      
      // Mark all pending transactions as failed
      for (const tx of batch.transactions) {
        if (tx.status === TransactionStatus.PENDING || tx.status === TransactionStatus.PROCESSING) {
          tx.status = TransactionStatus.FAILED;
        }
      }
    }
  }

  /**
   * Processes a list of transactions
   * 
   * @param transactions - Transactions to process
   * @returns Promise resolving to the processing results
   * @private
   */
  private async processTransactions(
    transactions: BatchTransaction[]
  ): Promise<Array<{ success: boolean; hash?: string }>> {
    // In a real implementation, this would submit the transactions to Neon EVM
    // and track their execution
    
    // For now, we'll simulate processing with a high success rate
    const results: Array<{ success: boolean; hash?: string }> = [];
    
    for (const tx of transactions) {
      // Update transaction status
      tx.status = TransactionStatus.PROCESSING;
      
      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 95% success rate
      const success = Math.random() < 0.95;
      
      if (success) {
        // Generate a transaction hash
        const hash = `0x${crypto.randomBytes(32).toString('hex')}`;
        results.push({ success: true, hash });
      } else {
        results.push({ success: false });
      }
    }
    
    return results;
  }

  /**
   * Gets a transaction by ID
   * 
   * @param transactionId - Transaction ID
   * @returns Transaction if found, undefined otherwise
   */
  getTransaction(transactionId: string): BatchTransaction | undefined {
    for (const batch of this.batches.values()) {
      const transaction = batch.transactions.find(tx => tx.id === transactionId);
      if (transaction) {
        return transaction;
      }
    }
    
    return undefined;
  }

  /**
   * Gets a batch by ID
   * 
   * @param batchId - Batch ID
   * @returns Batch if found, undefined otherwise
   */
  getBatch(batchId: string): Batch | undefined {
    return this.batches.get(batchId);
  }

  /**
   * Gets all batches
   * 
   * @returns Array of all batches
   */
  getAllBatches(): Batch[] {
    return Array.from(this.batches.values());
  }

  /**
   * Gets batches by status
   * 
   * @param status - Batch status
   * @returns Array of batches with the specified status
   */
  getBatchesByStatus(status: BatchStatus): Batch[] {
    return Array.from(this.batches.values()).filter(batch => batch.status === status);
  }

  /**
   * Gets the current batch
   * 
   * @returns Current batch, or null if none exists
   */
  getCurrentBatch(): Batch | null {
    return this.currentBatch;
  }

  /**
   * Aborts a batch
   * 
   * @param batchId - Batch ID
   * @returns Whether the batch was successfully aborted
   */
  abortBatch(batchId: string): boolean {
    const batch = this.batches.get(batchId);
    
    if (!batch) {
      this.logger.error('Batch not found', { batchId });
      return false;
    }
    
    if (batch.status !== BatchStatus.PENDING) {
      this.logger.error('Cannot abort batch with status', { 
        batchId, 
        status: batch.status 
      });
      return false;
    }
    
    // Update batch status
    batch.status = BatchStatus.ABORTED;
    
    // If this is the current batch, create a new one
    if (this.currentBatch && this.currentBatch.id === batchId) {
      this.createNewBatch();
    }
    
    this.logger.info('Batch aborted', { batchId });
    
    return true;
  }

  /**
   * Cleans up old batches
   * 
   * @param maxAgeMs - Maximum age of batches to keep (in milliseconds)
   * @returns Number of batches removed
   */
  cleanupOldBatches(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let removedCount = 0;
    
    for (const [batchId, batch] of this.batches.entries()) {
      // Only remove completed, failed, expired, or aborted batches
      if (batch.status === BatchStatus.COMPLETED || 
          batch.status === BatchStatus.FAILED || 
          batch.status === BatchStatus.EXPIRED || 
          batch.status === BatchStatus.ABORTED) {
        
        // Check if the batch is old enough
        if (now - batch.createdAt > maxAgeMs) {
          this.batches.delete(batchId);
          removedCount++;
        }
      }
    }
    
    this.logger.info('Cleaned up old batches', { removedCount });
    
    return removedCount;
  }
}
