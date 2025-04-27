/**
 * Transaction Prioritization for Solana Layer-2
 * 
 * This module provides functionality for prioritizing transactions in the Layer-2 solution,
 * including priority queues, priority boosting, and priority-based execution.
 * 
 * @module transaction_prioritization
 */

import { Logger } from './utils/logger';
import { GasFeeOptimizer } from './gas_fee_optimizer';
import * as crypto from 'crypto';

/**
 * Configuration options for the transaction prioritization
 */
export interface TransactionPrioritizationConfig {
  /** Maximum number of transactions in the queue */
  maxQueueSize?: number;
  /** Base priority fee in lamports */
  basePriorityFee?: number;
  /** Maximum priority fee in lamports */
  maxPriorityFee?: number;
  /** Priority boost factor for high-value transactions */
  highValueBoostFactor?: number;
  /** Priority boost factor for time-sensitive transactions */
  timeSensitiveBoostFactor?: number;
  /** Gas fee optimizer instance */
  gasFeeOptimizer: GasFeeOptimizer;
}

/**
 * Transaction interface for prioritization
 */
export interface PrioritizedTransaction {
  /** Transaction ID */
  id: string;
  /** Transaction data */
  data: string;
  /** Transaction value */
  value: number;
  /** Sender address */
  from: string;
  /** Recipient address */
  to: string;
  /** Gas limit */
  gasLimit: number;
  /** Gas price */
  gasPrice: number;
  /** Priority fee */
  priorityFee: number;
  /** Total fee (gas fee + priority fee) */
  totalFee: number;
  /** Priority score */
  priorityScore: number;
  /** Timestamp */
  timestamp: number;
  /** Whether the transaction is time-sensitive */
  timeSensitive: boolean;
  /** Whether the transaction is high-value */
  highValue: boolean;
}

/**
 * Class that implements the transaction prioritization functionality
 */
export class TransactionPrioritization {
  private maxQueueSize: number;
  private basePriorityFee: number;
  private maxPriorityFee: number;
  private highValueBoostFactor: number;
  private timeSensitiveBoostFactor: number;
  private gasFeeOptimizer: GasFeeOptimizer;
  private logger: Logger;
  private transactionQueue: PrioritizedTransaction[] = [];
  private highValueThreshold: number = 1000000000; // 1 SOL in lamports

  /**
   * Creates a new instance of TransactionPrioritization
   * 
   * @param config - Configuration options for transaction prioritization
   */
  constructor(config: TransactionPrioritizationConfig) {
    this.maxQueueSize = config.maxQueueSize || 10000;
    this.basePriorityFee = config.basePriorityFee || 10000; // 10,000 lamports default
    this.maxPriorityFee = config.maxPriorityFee || 1000000; // 1,000,000 lamports default
    this.highValueBoostFactor = config.highValueBoostFactor || 2.0;
    this.timeSensitiveBoostFactor = config.timeSensitiveBoostFactor || 1.5;
    this.gasFeeOptimizer = config.gasFeeOptimizer;
    this.logger = new Logger('TransactionPrioritization');
    
    this.logger.info('TransactionPrioritization initialized', {
      maxQueueSize: this.maxQueueSize,
      basePriorityFee: this.basePriorityFee,
      maxPriorityFee: this.maxPriorityFee,
      highValueBoostFactor: this.highValueBoostFactor,
      timeSensitiveBoostFactor: this.timeSensitiveBoostFactor
    });
  }

  /**
   * Adds a transaction to the priority queue
   * 
   * @param transaction - Transaction to add
   * @param priorityFee - Priority fee in lamports (optional)
   * @param timeSensitive - Whether the transaction is time-sensitive (optional)
   * @returns Promise resolving to the prioritized transaction
   */
  async addTransaction(
    transaction: {
      data: string;
      value: number;
      from: string;
      to: string;
      gasLimit?: number;
      gasPrice?: number;
    },
    priorityFee?: number,
    timeSensitive: boolean = false
  ): Promise<PrioritizedTransaction> {
    try {
      this.logger.info('Adding transaction to priority queue');
      
      // Generate transaction ID
      const id = this.generateTransactionId();
      
      // Determine if this is a high-value transaction
      const highValue = transaction.value >= this.highValueThreshold;
      
      // Estimate gas limit if not provided
      const gasLimit = transaction.gasLimit || 
                      this.gasFeeOptimizer.estimateGasLimit(transaction.data);
      
      // Get current gas price if not provided
      const gasPrice = transaction.gasPrice || 
                      this.gasFeeOptimizer.getCurrentGasPrice();
      
      // Calculate gas fee
      const gasFee = gasLimit * gasPrice;
      
      // Use provided priority fee or calculate based on transaction properties
      const calculatedPriorityFee = priorityFee || this.calculatePriorityFee(
        transaction.value,
        highValue,
        timeSensitive
      );
      
      // Calculate total fee
      const totalFee = gasFee + calculatedPriorityFee;
      
      // Calculate priority score
      const priorityScore = this.calculatePriorityScore(
        calculatedPriorityFee,
        highValue,
        timeSensitive,
        transaction.value,
        Date.now()
      );
      
      // Create prioritized transaction
      const prioritizedTx: PrioritizedTransaction = {
        id,
        data: transaction.data,
        value: transaction.value,
        from: transaction.from,
        to: transaction.to,
        gasLimit,
        gasPrice,
        priorityFee: calculatedPriorityFee,
        totalFee,
        priorityScore,
        timestamp: Date.now(),
        timeSensitive,
        highValue
      };
      
      // Add to queue
      this.addToQueue(prioritizedTx);
      
      this.logger.info('Transaction added to priority queue', {
        transactionId: id,
        priorityScore,
        queueSize: this.transactionQueue.length
      });
      
      return prioritizedTx;
    } catch (error) {
      this.logger.error('Failed to add transaction to priority queue', { error });
      throw new Error(`Failed to add transaction to priority queue: ${error.message}`);
    }
  }

  /**
   * Adds a transaction to the queue and maintains queue order
   * 
   * @param transaction - Transaction to add
   * @private
   */
  private addToQueue(transaction: PrioritizedTransaction): void {
    // Add transaction to queue
    this.transactionQueue.push(transaction);
    
    // Sort queue by priority score (descending)
    this.transactionQueue.sort((a, b) => b.priorityScore - a.priorityScore);
    
    // Trim queue if it exceeds maximum size
    if (this.transactionQueue.length > this.maxQueueSize) {
      // Remove lowest priority transactions
      const removed = this.transactionQueue.splice(this.maxQueueSize);
      this.logger.info('Queue trimmed', {
        removedCount: removed.length
      });
    }
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
   * Calculates the priority fee for a transaction
   * 
   * @param value - Transaction value
   * @param highValue - Whether the transaction is high-value
   * @param timeSensitive - Whether the transaction is time-sensitive
   * @returns Priority fee in lamports
   * @private
   */
  private calculatePriorityFee(
    value: number,
    highValue: boolean,
    timeSensitive: boolean
  ): number {
    // Start with base priority fee
    let priorityFee = this.basePriorityFee;
    
    // Add value-based component (0.01% of transaction value)
    priorityFee += Math.floor(value * 0.0001);
    
    // Apply boosts for high-value and time-sensitive transactions
    if (highValue) {
      priorityFee = Math.floor(priorityFee * this.highValueBoostFactor);
    }
    
    if (timeSensitive) {
      priorityFee = Math.floor(priorityFee * this.timeSensitiveBoostFactor);
    }
    
    // Ensure priority fee is within limits
    priorityFee = Math.min(priorityFee, this.maxPriorityFee);
    
    return priorityFee;
  }

  /**
   * Calculates the priority score for a transaction
   * 
   * @param priorityFee - Priority fee in lamports
   * @param highValue - Whether the transaction is high-value
   * @param timeSensitive - Whether the transaction is time-sensitive
   * @param value - Transaction value
   * @param timestamp - Transaction timestamp
   * @returns Priority score
   * @private
   */
  private calculatePriorityScore(
    priorityFee: number,
    highValue: boolean,
    timeSensitive: boolean,
    value: number,
    timestamp: number
  ): number {
    // Base score is the priority fee
    let score = priorityFee;
    
    // Add value-based component (normalized)
    const valueComponent = Math.min(value / this.highValueThreshold, 1) * 1000;
    score += valueComponent;
    
    // Add boosts for high-value and time-sensitive transactions
    if (highValue) {
      score *= this.highValueBoostFactor;
    }
    
    if (timeSensitive) {
      score *= this.timeSensitiveBoostFactor;
    }
    
    // Add time-based component (older transactions get a small boost)
    const ageMs = Date.now() - timestamp;
    const ageBoost = Math.min(ageMs / 60000, 10) * 100; // Up to 1000 after 10 minutes
    score += ageBoost;
    
    return score;
  }

  /**
   * Gets the next batch of transactions from the queue
   * 
   * @param batchSize - Maximum number of transactions to get
   * @param maxGasLimit - Maximum total gas limit for the batch
   * @returns Array of prioritized transactions
   */
  getNextBatch(batchSize: number, maxGasLimit: number): PrioritizedTransaction[] {
    try {
      this.logger.info('Getting next batch of transactions', {
        batchSize,
        maxGasLimit,
        queueSize: this.transactionQueue.length
      });
      
      if (this.transactionQueue.length === 0) {
        return [];
      }
      
      const batch: PrioritizedTransaction[] = [];
      let totalGas = 0;
      
      // Get transactions until batch is full or we run out of transactions
      for (let i = 0; i < this.transactionQueue.length && batch.length < batchSize; i++) {
        const tx = this.transactionQueue[i];
        
        // Check if adding this transaction would exceed the gas limit
        if (totalGas + tx.gasLimit > maxGasLimit && batch.length > 0) {
          // Skip this transaction if it would exceed the limit and we already have some
          continue;
        }
        
        // Add transaction to batch
        batch.push(tx);
        totalGas += tx.gasLimit;
        
        // Remove from queue
        this.transactionQueue.splice(i, 1);
        i--; // Adjust index since we removed an item
      }
      
      this.logger.info('Batch retrieved', {
        batchSize: batch.length,
        totalGas,
        remainingQueueSize: this.transactionQueue.length
      });
      
      return batch;
    } catch (error) {
      this.logger.error('Failed to get next batch of transactions', { error });
      throw new Error(`Failed to get next batch of transactions: ${error.message}`);
    }
  }

  /**
   * Gets a transaction by ID
   * 
   * @param transactionId - Transaction ID
   * @returns Transaction if found, undefined otherwise
   */
  getTransaction(transactionId: string): PrioritizedTransaction | undefined {
    return this.transactionQueue.find(tx => tx.id === transactionId);
  }

  /**
   * Gets the current queue size
   * 
   * @returns Number of transactions in the queue
   */
  getQueueSize(): number {
    return this.transactionQueue.length;
  }

  /**
   * Gets the current queue
   * 
   * @returns Array of all transactions in the queue
   */
  getQueue(): PrioritizedTransaction[] {
    return [...this.transactionQueue];
  }

  /**
   * Updates the priority of a transaction
   * 
   * @param transactionId - Transaction ID
   * @param newPriorityFee - New priority fee in lamports
   * @returns Updated transaction if found, undefined otherwise
   */
  updateTransactionPriority(
    transactionId: string,
    newPriorityFee: number
  ): PrioritizedTransaction | undefined {
    try {
      this.logger.info('Updating transaction priority', {
        transactionId,
        newPriorityFee
      });
      
      // Find transaction in queue
      const index = this.transactionQueue.findIndex(tx => tx.id === transactionId);
      
      if (index === -1) {
        this.logger.info('Transaction not found', {
          transactionId
        });
        return undefined;
      }
      
      const transaction = this.transactionQueue[index];
      
      // Update priority fee
      transaction.priorityFee = Math.min(newPriorityFee, this.maxPriorityFee);
      
      // Update total fee
      transaction.totalFee = (transaction.gasLimit * transaction.gasPrice) + transaction.priorityFee;
      
      // Recalculate priority score
      transaction.priorityScore = this.calculatePriorityScore(
        transaction.priorityFee,
        transaction.highValue,
        transaction.timeSensitive,
        transaction.value,
        transaction.timestamp
      );
      
      // Remove from queue and re-add to maintain order
      this.transactionQueue.splice(index, 1);
      this.addToQueue(transaction);
      
      this.logger.info('Transaction priority updated', {
        transactionId,
        newPriorityScore: transaction.priorityScore
      });
      
      return transaction;
    } catch (error) {
      this.logger.error('Failed to update transaction priority', { error });
      throw new Error(`Failed to update transaction priority: ${error.message}`);
    }
  }

  /**
   * Removes a transaction from the queue
   * 
   * @param transactionId - Transaction ID
   * @returns Removed transaction if found, undefined otherwise
   */
  removeTransaction(transactionId: string): PrioritizedTransaction | undefined {
    try {
      this.logger.info('Removing transaction from queue', {
        transactionId
      });
      
      // Find transaction in queue
      const index = this.transactionQueue.findIndex(tx => tx.id === transactionId);
      
      if (index === -1) {
        this.logger.info('Transaction not found', {
          transactionId
        });
        return undefined;
      }
      
      // Remove from queue
      const [transaction] = this.transactionQueue.splice(index, 1);
      
      this.logger.info('Transaction removed from queue', {
        transactionId,
        queueSize: this.transactionQueue.length
      });
      
      return transaction;
    } catch (error) {
      this.logger.error('Failed to remove transaction from queue', { error });
      throw new Error(`Failed to remove transaction from queue: ${error.message}`);
    }
  }

  /**
   * Clears the transaction queue
   */
  clearQueue(): void {
    this.logger.info('Clearing transaction queue', {
      queueSize: this.transactionQueue.length
    });
    
    this.transactionQueue = [];
  }

  /**
   * Updates the high value threshold
   * 
   * @param newThreshold - New high value threshold in lamports
   */
  updateHighValueThreshold(newThreshold: number): void {
    this.highValueThreshold = newThreshold;
    
    this.logger.info('High value threshold updated', {
      newThreshold
    });
    
    // Update high value flag for all transactions in queue
    for (const tx of this.transactionQueue) {
      tx.highValue = tx.value >= this.highValueThreshold;
      
      // Recalculate priority score
      tx.priorityScore = this.calculatePriorityScore(
        tx.priorityFee,
        tx.highValue,
        tx.timeSensitive,
        tx.value,
        tx.timestamp
      );
    }
    
    // Resort queue
    this.transactionQueue.sort((a, b) => b.priorityScore - a.priorityScore);
  }

  /**
   * Updates the base priority fee
   * 
   * @param newBasePriorityFee - New base priority fee in lamports
   */
  updateBasePriorityFee(newBasePriorityFee: number): void {
    this.basePriorityFee = newBasePriorityFee;
    
    this.logger.info('Base priority fee updated', {
      newBasePriorityFee
    });
  }
}
