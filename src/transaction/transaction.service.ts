// English comment for verification
/**
 * @file transaction.service.ts
 * @description Enhanced service for managing transactions in the Layer-2 system
 * @module transaction/service
 */

import { Repository, In, LessThanOrEqual, MoreThanOrEqual, Between } from 'typeorm';
import { Transaction, TransactionStatus, TransactionType } from './transaction.entity';
import { DatabaseService } from '../database/database.service';
import { Logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as os from 'os';

/**
 * Interface for transaction creation parameters
 */
export interface CreateTransactionParams {
  sender: string;
  recipient: string;
  amount: string;
  gasLimit: number;
  gasPrice: string;
  nonce: number;
  data: string;
  signature: string;
  type: TransactionType;
  priority?: number;
  expiresAt?: Date;
  metadata?: Record<string, any>;
}

/**
 * Interface for transaction query parameters
 */
export interface TransactionQueryParams {
  status?: TransactionStatus | TransactionStatus[];
  sender?: string;
  recipient?: string;
  type?: TransactionType | TransactionType[];
  fromDate?: Date;
  toDate?: Date;
  minPriority?: number;
  maxPriority?: number;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDirection?: 'ASC' | 'DESC';
  includeBundle?: boolean;
  hash?: string;
  blockNumber?: number;
  minNonce?: number;
  maxNonce?: number;
}

/**
 * Interface for transaction statistics
 */
export interface TransactionStatistics {
  totalCount: number;
  pendingCount: number;
  bundledCount: number;
  confirmedCount: number;
  failedCount: number;
  expiredCount: number;
  averageConfirmationTime: number | null;
  averageFee: string;
  transactionsByType: Record<TransactionType, number>;
  transactionsByHour: Array<{ hour: Date; count: number }>;
}

/**
 * Enhanced service that manages transactions in the Layer-2 system
 * Provides methods for creating, updating, and querying transactions
 * Supports multi-threading for improved performance
 */
export class TransactionService {
  private repository: Repository<Transaction>;
  private logger: Logger;
  private static instance: TransactionService;
  private workers: Worker[] = [];
  private useMultiThreading: boolean = false;
  private maxWorkers: number = 0;
  private batchSize: number = 100;
  private statsCache: {
    statistics: TransactionStatistics | null;
    lastUpdated: Date | null;
  } = {
    statistics: null,
    lastUpdated: null
  };

  /**
   * Private constructor to prevent direct instantiation
   * Use TransactionService.getInstance() instead
   */
  private constructor() {
    this.logger = new Logger('TransactionService');
    const dbService = DatabaseService.getInstance();
    this.repository = dbService.getRepository(Transaction);
    
    // Initialize multi-threading if enabled
    this.useMultiThreading = process.env.USE_MULTI_THREADING === 'true';
    this.maxWorkers = this.useMultiThreading 
      ? parseInt(process.env.MAX_TRANSACTION_WORKERS || '0', 10) || Math.max(1, os.cpus().length - 1)
      : 0;
    
    if (this.useMultiThreading) {
      this.logger.info(`Initializing transaction service with ${this.maxWorkers} workers`);
      this.initializeWorkers();
    }
  }

  /**
   * Gets the singleton instance of TransactionService
   * 
   * @returns The singleton instance
   */
  public static getInstance(): TransactionService {
    if (!TransactionService.instance) {
      TransactionService.instance = new TransactionService();
    }
    return TransactionService.instance;
  }

  /**
   * Initializes worker threads for parallel transaction processing
   */
  private initializeWorkers(): void {
    try {
      for (let i = 0; i < this.maxWorkers; i++) {
        const worker = new Worker(path.join(__dirname, 'transaction.worker.js'), {
          workerData: { workerId: i }
        });
        
        worker.on('error', (error) => {
          this.logger.error(`Worker ${i} error:`, { error });
          // Restart worker on error
          this.restartWorker(i);
        });
        
        worker.on('exit', (code) => {
          if (code !== 0) {
            this.logger.warn(`Worker ${i} exited with code ${code}`);
            // Restart worker on abnormal exit
            this.restartWorker(i);
          }
        });
        
        this.workers.push(worker);
        this.logger.info(`Worker ${i} initialized`);
      }
    } catch (error) {
      this.logger.error('Failed to initialize workers', { error });
      this.useMultiThreading = false;
    }
  }

  /**
   * Restarts a worker thread
   * 
   * @param index - Index of the worker to restart
   */
  private restartWorker(index: number): void {
    try {
      if (this.workers[index]) {
        this.workers[index].terminate();
      }
      
      const worker = new Worker(path.join(__dirname, 'transaction.worker.js'), {
        workerData: { workerId: index }
      });
      
      worker.on('error', (error) => {
        this.logger.error(`Worker ${index} error:`, { error });
        this.restartWorker(index);
      });
      
      worker.on('exit', (code) => {
        if (code !== 0) {
          this.logger.warn(`Worker ${index} exited with code ${code}`);
          this.restartWorker(index);
        }
      });
      
      this.workers[index] = worker;
      this.logger.info(`Worker ${index} restarted`);
    } catch (error) {
      this.logger.error(`Failed to restart worker ${index}`, { error });
    }
  }

  /**
   * Creates a new transaction
   * 
   * @param params - Transaction creation parameters
   * @returns Promise resolving to the created transaction
   * @throws Error if transaction creation fails
   */
  public async createTransaction(params: CreateTransactionParams): Promise<Transaction> {
    try {
      this.logger.info('Creating new transaction', {
        sender: params.sender,
        recipient: params.recipient,
        amount: params.amount,
        type: params.type
      });

      // Generate transaction hash
      const hash = this.generateTransactionHash(params);

      // Check if transaction with same hash already exists
      const existingTransaction = await this.getTransactionByHash(hash);
      if (existingTransaction) {
        this.logger.warn('Transaction with same hash already exists', { hash });
        return existingTransaction;
      }

      // Create transaction entity
      const transaction = new Transaction();
      transaction.id = uuidv4();
      transaction.hash = hash;
      transaction.sender = params.sender;
      transaction.recipient = params.recipient;
      transaction.amount = params.amount;
      transaction.gasLimit = params.gasLimit;
      transaction.gasPrice = params.gasPrice;
      transaction.nonce = params.nonce;
      transaction.data = params.data;
      transaction.signature = params.signature;
      transaction.type = params.type;
      transaction.status = TransactionStatus.PENDING;
      transaction.priority = params.priority || 50;
      transaction.fee = this.calculateFee(params.gasLimit, params.gasPrice);
      transaction.expiresAt = params.expiresAt || this.calculateExpiryTime();
      transaction.metadata = params.metadata || {};

      // Save transaction to database
      const savedTransaction = await this.repository.save(transaction);

      this.logger.info('Transaction created successfully', {
        id: savedTransaction.id,
        hash: savedTransaction.hash
      });

      // Invalidate statistics cache
      this.invalidateStatsCache();

      return savedTransaction;
    } catch (error) {
      this.logger.error('Failed to create transaction', { error });
      throw new Error(`Failed to create transaction: ${error.message}`);
    }
  }

  /**
   * Creates multiple transactions in a batch
   * Uses multi-threading if enabled for improved performance
   * 
   * @param paramsArray - Array of transaction creation parameters
   * @returns Promise resolving to an array of created transactions
   * @throws Error if batch transaction creation fails
   */
  public async createTransactionBatch(paramsArray: CreateTransactionParams[]): Promise<Transaction[]> {
    try {
      this.logger.info('Creating transaction batch', { count: paramsArray.length });

      if (this.useMultiThreading && paramsArray.length > this.batchSize) {
        return this.createTransactionBatchParallel(paramsArray);
      } else {
        return this.createTransactionBatchSequential(paramsArray);
      }
    } catch (error) {
      this.logger.error('Failed to create transaction batch', { error });
      throw new Error(`Failed to create transaction batch: ${error.message}`);
    }
  }

  /**
   * Creates multiple transactions sequentially
   * 
   * @param paramsArray - Array of transaction creation parameters
   * @returns Promise resolving to an array of created transactions
   */
  private async createTransactionBatchSequential(paramsArray: CreateTransactionParams[]): Promise<Transaction[]> {
    const transactions: Transaction[] = [];
    
    for (const params of paramsArray) {
      try {
        const transaction = await this.createTransaction(params);
        transactions.push(transaction);
      } catch (error) {
        this.logger.error('Failed to create transaction in batch', { 
          error, 
          sender: params.sender, 
          recipient: params.recipient 
        });
        // Continue with next transaction
      }
    }
    
    this.logger.info('Transaction batch created sequentially', { 
      total: paramsArray.length, 
      successful: transactions.length 
    });
    
    return transactions;
  }

  /**
   * Creates multiple transactions in parallel using worker threads
   * 
   * @param paramsArray - Array of transaction creation parameters
   * @returns Promise resolving to an array of created transactions
   */
  private async createTransactionBatchParallel(paramsArray: CreateTransactionParams[]): Promise<Transaction[]> {
    // Split params into chunks for each worker
    const chunks: CreateTransactionParams[][] = [];
    const chunkSize = Math.ceil(paramsArray.length / this.maxWorkers);
    
    for (let i = 0; i < paramsArray.length; i += chunkSize) {
      chunks.push(paramsArray.slice(i, i + chunkSize));
    }
    
    // Process each chunk in a separate worker
    const promises = chunks.map((chunk, index) => {
      return new Promise<Transaction[]>((resolve, reject) => {
        const worker = this.workers[index % this.maxWorkers];
        
        const messageHandler = (message: any) => {
          if (message.type === 'batch_complete') {
            worker.removeListener('message', messageHandler);
            resolve(message.transactions);
          }
        };
        
        worker.on('message', messageHandler);
        
        worker.postMessage({
          type: 'create_batch',
          params: chunk
        });
      });
    });
    
    // Wait for all workers to complete
    const results = await Promise.all(promises);
    
    // Flatten results
    const transactions = results.flat();
    
    this.logger.info('Transaction batch created in parallel', { 
      total: paramsArray.length, 
      successful: transactions.length 
    });
    
    return transactions;
  }

  /**
   * Updates the status of a transaction
   * 
   * @param id - Transaction ID
   * @param status - New transaction status
   * @param errorMessage - Optional error message if status is FAILED
   * @param blockNumber - Optional block number if status is CONFIRMED
   * @param blockTimestamp - Optional block timestamp if status is CONFIRMED
   * @returns Promise resolving to the updated transaction
   * @throws Error if transaction update fails
   */
  public async updateTransactionStatus(
    id: string,
    status: TransactionStatus,
    errorMessage?: string,
    blockNumber?: number,
    blockTimestamp?: Date
  ): Promise<Transaction> {
    try {
      this.logger.info('Updating transaction status', {
        id,
        status,
        errorMessage,
        blockNumber,
        blockTimestamp
      });

      // Get transaction from database
      const transaction = await this.repository.findOne(id);
      if (!transaction) {
        throw new Error(`Transaction not found: ${id}`);
      }

      // Update transaction status
      transaction.status = status;
      transaction.errorMessage = errorMessage || null;
      transaction.blockNumber = blockNumber || null;
      transaction.blockTimestamp = blockTimestamp || null;

      // Save updated transaction to database
      const updatedTransaction = await this.repository.save(transaction);

      this.logger.info('Transaction status updated successfully', {
        id: updatedTransaction.id,
        status: updatedTransaction.status
      });

      // Invalidate statistics cache
      this.invalidateStatsCache();

      return updatedTransaction;
    } catch (error) {
      this.logger.error('Failed to update transaction status', { error });
      throw new Error(`Failed to update transaction status: ${error.message}`);
    }
  }

  /**
   * Updates the status of multiple transactions in a batch
   * Uses multi-threading if enabled for improved performance
   * 
   * @param updates - Array of transaction status updates
   * @returns Promise resolving to the number of transactions updated
   * @throws Error if batch update fails
   */
  public async updateTransactionStatusBatch(
    updates: Array<{
      id: string;
      status: TransactionStatus;
      errorMessage?: string;
      blockNumber?: number;
      blockTimestamp?: Date;
    }>
  ): Promise<number> {
    try {
      this.logger.info('Updating transaction status batch', { count: updates.length });

      if (this.useMultiThreading && updates.length > this.batchSize) {
        return this.updateTransactionStatusBatchParallel(updates);
      } else {
        return this.updateTransactionStatusBatchSequential(updates);
      }
    } catch (error) {
      this.logger.error('Failed to update transaction status batch', { error });
      throw new Error(`Failed to update transaction status batch: ${error.message}`);
    }
  }

  /**
   * Updates the status of multiple transactions sequentially
   * 
   * @param updates - Array of transaction status updates
   * @returns Promise resolving to the number of transactions updated
   */
  private async updateTransactionStatusBatchSequential(
    updates: Array<{
      id: string;
      status: TransactionStatus;
      errorMessage?: string;
      blockNumber?: number;
      blockTimestamp?: Date;
    }>
  ): Promise<number> {
    let successCount = 0;
    
    for (const update of updates) {
      try {
        await this.updateTransactionStatus(
          update.id,
          update.status,
          update.errorMessage,
          update.blockNumber,
          update.blockTimestamp
        );
        successCount++;
      } catch (error) {
        this.logger.error('Failed to update transaction in batch', { 
          error, 
          id: update.id, 
          status: update.status 
        });
        // Continue with next update
      }
    }
    
    this.logger.info('Transaction status batch updated sequentially', { 
      total: updates.length, 
      successful: successCount 
    });
    
    return successCount;
  }

  /**
   * Updates the status of multiple transactions in parallel using worker threads
   * 
   * @param updates - Array of transaction status updates
   * @returns Promise resolving to the number of transactions updated
   */
  private async updateTransactionStatusBatchParallel(
    updates: Array<{
      id: string;
      status: TransactionStatus;
      errorMessage?: string;
      blockNumber?: number;
      blockTimestamp?: Date;
    }>
  ): Promise<number> {
    // Split updates into chunks for each worker
    const chunks: typeof updates[] = [];
    const chunkSize = Math.ceil(updates.length / this.maxWorkers);
    
    for (let i = 0; i < updates.length; i += chunkSize) {
      chunks.push(updates.slice(i, i + chunkSize));
    }
    
    // Process each chunk in a separate worker
    const promises = chunks.map((chunk, index) => {
      return new Promise<number>((resolve, reject) => {
        const worker = this.workers[index % this.maxWorkers];
        
        const messageHandler = (message: any) => {
          if (message.type === 'update_batch_complete') {
            worker.removeListener('message', messageHandler);
            resolve(message.count);
          }
        };
        
        worker.on('message', messageHandler);
        
        worker.postMessage({
          type: 'update_status_batch',
          updates: chunk
        });
      });
    });
    
    // Wait for all workers to complete
    const results = await Promise.all(promises);
    
    // Sum up successful updates
    const totalSuccessful = results.reduce((sum, count) => sum + count, 0);
    
    this.logger.info('Transaction status batch updated in parallel', { 
      total: updates.length, 
      successful: totalSuccessful 
    });
    
    // Invalidate statistics cache
    this.invalidateStatsCache();
    
    return totalSuccessful;
  }

  /**
   * Assigns a transaction to a bundle
   * 
   * @param id - Transaction ID
   * @param bundleId - Bundle ID
   * @returns Promise resolving to the updated transaction
   * @throws Error if transaction update fails
   */
  public async assignTransactionToBundle(id: string, bundleId: string): Promise<Transaction> {
    try {
      this.logger.info('Assigning transaction to bundle', {
        id,
        bundleId
      });

      // Get transaction from database
      const transaction = await this.repository.findOne(id);
      if (!transaction) {
        throw new Error(`Transaction not found: ${id}`);
      }

      // Update transaction bundle and status
      transaction.bundleId = bundleId;
      transaction.status = TransactionStatus.BUNDLED;

      // Save updated transaction to database
      const updatedTransaction = await this.repository.save(transaction);

      this.logger.info('Transaction assigned to bundle successfully', {
        id: updatedTransaction.id,
        bundleId: updatedTransaction.bundleId
      });

      // Invalidate statistics cache
      this.invalidateStatsCache();

      return updatedTransaction;
    } catch (error) {
      this.logger.error('Failed to assign transaction to bundle', { error });
      throw new Error(`Failed to assign transaction to bundle: ${error.message}`);
    }
  }

  /**
   * Assigns multiple transactions to a bundle in a batch
   * 
   * @param transactionIds - Array of transaction IDs
   * @param bundleId - Bundle ID
   * @returns Promise resolving to the number of transactions assigned
   * @throws Error if batch assignment fails
   */
  public async assignTransactionsToBundleBatch(
    transactionIds: string[],
    bundleId: string
  ): Promise<number> {
    try {
      this.logger.info('Assigning transactions to bundle batch', { 
        count: transactionIds.length,
        bundleId
      });

      // Update transactions directly in database for better performance
      const result = await this.repository.createQueryBuilder()
        .update(Transaction)
        .set({ 
          bundleId: bundleId,
          status: TransactionStatus.BUNDLED
        })
        .where({ 
          id: In(transactionIds),
          status: TransactionStatus.PENDING
        })
        .execute();

      const count = result.affected || 0;

      this.logger.info('Transactions assigned to bundle successfully', {
        count,
        bundleId
      });

      // Invalidate statistics cache
      this.invalidateStatsCache();

      return count;
    } catch (error) {
      this.logger.error('Failed to assign transactions to bundle batch', { error });
      throw new Error(`Failed to assign transactions to bundle batch: ${error.message}`);
    }
  }

  /**
   * Gets a transaction by ID
   * 
   * @param id - Transaction ID
   * @param includeBundle - Whether to include the bundle relation
   * @returns Promise resolving to the transaction if found, null otherwise
   */
  public async getTransactionById(id: string, includeBundle: boolean = true): Promise<Transaction | null> {
    try {
      this.logger.info('Getting transaction by ID', { id, includeBundle });

      // Get transaction from database
      const transaction = await this.repository.findOne(id, {
        relations: includeBundle ? ['bundle'] : []
      });

      if (!transaction) {
        this.logger.info('Transaction not found', { id });
        return null;
      }

      this.logger.info('Transaction retrieved successfully', {
        id: transaction.id,
        status: transaction.status
      });

      return transaction;
    } catch (error) {
      this.logger.error('Failed to get transaction by ID', { error });
      throw new Error(`Failed to get transaction by ID: ${error.message}`);
    }
  }

  /**
   * Gets a transaction by hash
   * 
   * @param hash - Transaction hash
   * @param includeBundle - Whether to include the bundle relation
   * @returns Promise resolving to the transaction if found, null otherwise
   */
  public async getTransactionByHash(hash: string, includeBundle: boolean = true): Promise<Transaction | null> {
    try {
      this.logger.info('Getting transaction by hash', { hash, includeBundle });

      // Get transaction from database
      const transaction = await this.repository.findOne({
        where: { hash },
        relations: includeBundle ? ['bundle'] : []
      });

      if (!transaction) {
        this.logger.info('Transaction not found', { hash });
        return null;
      }

      this.logger.info('Transaction retrieved successfully', {
        id: transaction.id,
        hash: transaction.hash,
        status: transaction.status
      });

      return transaction;
    } catch (error) {
      this.logger.error('Failed to get transaction by hash', { error });
      throw new Error(`Failed to get transaction by hash: ${error.message}`);
    }
  }

  /**
   * Gets transactions by query parameters
   * 
   * @param params - Query parameters
   * @returns Promise resolving to an array of transactions
   */
  public async getTransactions(params: TransactionQueryParams): Promise<Transaction[]> {
    try {
      this.logger.info('Getting transactions by query parameters', { params });

      // Build query
      const queryBuilder = this.repository.createQueryBuilder('transaction');
      
      // Add relations if requested
      if (params.includeBundle) {
        queryBuilder.leftJoinAndSelect('transaction.bundle', 'bundle');
      }

      // Apply filters
      if (params.status) {
        if (Array.isArray(params.status)) {
          queryBuilder.andWhere('transaction.status IN (:...statuses)', { statuses: params.status });
        } else {
          queryBuilder.andWhere('transaction.status = :status', { status: params.status });
        }
      }
      
      if (params.sender) {
        queryBuilder.andWhere('transaction.sender = :sender', { sender: params.sender });
      }
      
      if (params.recipient) {
        queryBuilder.andWhere('transaction.recipient = :recipient', { recipient: params.recipient });
      }
      
      if (params.type) {
        if (Array.isArray(params.type)) {
          queryBuilder.andWhere('transaction.type IN (:...types)', { types: params.type });
        } else {
          queryBuilder.andWhere('transaction.type = :type', { type: params.type });
        }
      }
      
      if (params.hash) {
        queryBuilder.andWhere('transaction.hash = :hash', { hash: params.hash });
      }
      
      if (params.blockNumber) {
        queryBuilder.andWhere('transaction.blockNumber = :blockNumber', { blockNumber: params.blockNumber });
      }
      
      if (params.fromDate && params.toDate) {
        queryBuilder.andWhere('transaction.createdAt BETWEEN :fromDate AND :toDate', { 
          fromDate: params.fromDate, 
          toDate: params.toDate 
        });
      } else if (params.fromDate) {
        queryBuilder.andWhere('transaction.createdAt >= :fromDate', { fromDate: params.fromDate });
      } else if (params.toDate) {
        queryBuilder.andWhere('transaction.createdAt <= :toDate', { toDate: params.toDate });
      }
      
      if (params.minPriority && params.maxPriority) {
        queryBuilder.andWhere('transaction.priority BETWEEN :minPriority AND :maxPriority', { 
          minPriority: params.minPriority, 
          maxPriority: params.maxPriority 
        });
      } else if (params.minPriority) {
        queryBuilder.andWhere('transaction.priority >= :minPriority', { minPriority: params.minPriority });
      } else if (params.maxPriority) {
        queryBuilder.andWhere('transaction.priority <= :maxPriority', { maxPriority: params.maxPriority });
      }
      
      if (params.minNonce && params.maxNonce) {
        queryBuilder.andWhere('transaction.nonce BETWEEN :minNonce AND :maxNonce', { 
          minNonce: params.minNonce, 
          maxNonce: params.maxNonce 
        });
      } else if (params.minNonce) {
        queryBuilder.andWhere('transaction.nonce >= :minNonce', { minNonce: params.minNonce });
      } else if (params.maxNonce) {
        queryBuilder.andWhere('transaction.nonce <= :maxNonce', { maxNonce: params.maxNonce });
      }

      // Apply sorting
      if (params.sortBy) {
        const direction = params.sortDirection || 'DESC';
        queryBuilder.orderBy(`transaction.${params.sortBy}`, direction);
      } else {
        // Default sorting: priority (descending) and creation time (ascending)
        queryBuilder.orderBy('transaction.priority', 'DESC')
          .addOrderBy('transaction.createdAt', 'ASC');
      }

      // Apply pagination
      if (params.limit) {
        queryBuilder.take(params.limit);
      }
      
      if (params.offset) {
        queryBuilder.skip(params.offset);
      }

      // Execute query
      const transactions = await queryBuilder.getMany();

      this.logger.info('Transactions retrieved successfully', {
        count: transactions.length
      });

      return transactions;
    } catch (error) {
      this.logger.error('Failed to get transactions', { error });
      throw new Error(`Failed to get transactions: ${error.message}`);
    }
  }

  /**
   * Gets pending transactions that are ready to be bundled
   * 
   * @param limit - Maximum number of transactions to return
   * @param minPriority - Minimum priority of transactions to return
   * @returns Promise resolving to an array of pending transactions
   */
  public async getPendingTransactions(limit: number = 100, minPriority: number = 0): Promise<Transaction[]> {
    try {
      this.logger.info('Getting pending transactions', { limit, minPriority });

      // Get current time
      const now = new Date();

      // Build query
      const queryBuilder = this.repository.createQueryBuilder('transaction')
        .where('transaction.status = :status', { status: TransactionStatus.PENDING })
        .andWhere('transaction.expiresAt > :now', { now })
        .andWhere('transaction.priority >= :minPriority', { minPriority })
        .orderBy('transaction.priority', 'DESC')
        .addOrderBy('transaction.createdAt', 'ASC')
        .take(limit);

      // Execute query
      const transactions = await queryBuilder.getMany();

      this.logger.info('Pending transactions retrieved successfully', {
        count: transactions.length
      });

      return transactions;
    } catch (error) {
      this.logger.error('Failed to get pending transactions', { error });
      throw new Error(`Failed to get pending transactions: ${error.message}`);
    }
  }

  /**
   * Gets expired transactions
   * 
   * @param limit - Maximum number of transactions to return
   * @returns Promise resolving to an array of expired transactions
   */
  public async getExpiredTransactions(limit: number = 100): Promise<Transaction[]> {
    try {
      this.logger.info('Getting expired transactions', { limit });

      // Get current time
      const now = new Date();

      // Build query
      const queryBuilder = this.repository.createQueryBuilder('transaction')
        .where('transaction.status = :status', { status: TransactionStatus.PENDING })
        .andWhere('transaction.expiresAt <= :now', { now })
        .orderBy('transaction.expiresAt', 'ASC')
        .take(limit);

      // Execute query
      const transactions = await queryBuilder.getMany();

      this.logger.info('Expired transactions retrieved successfully', {
        count: transactions.length
      });

      return transactions;
    } catch (error) {
      this.logger.error('Failed to get expired transactions', { error });
      throw new Error(`Failed to get expired transactions: ${error.message}`);
    }
  }

  /**
   * Marks expired transactions as expired
   * 
   * @returns Promise resolving to the number of transactions marked as expired
   */
  public async markExpiredTransactions(): Promise<number> {
    try {
      this.logger.info('Marking expired transactions');

      // Get current time
      const now = new Date();

      // Update expired transactions
      const result = await this.repository.createQueryBuilder()
        .update(Transaction)
        .set({ status: TransactionStatus.EXPIRED })
        .where('status = :status', { status: TransactionStatus.PENDING })
        .andWhere('expiresAt <= :now', { now })
        .execute();

      const count = result.affected || 0;

      this.logger.info('Expired transactions marked successfully', {
        count
      });

      // Invalidate statistics cache if any transactions were marked as expired
      if (count > 0) {
        this.invalidateStatsCache();
      }

      return count;
    } catch (error) {
      this.logger.error('Failed to mark expired transactions', { error });
      throw new Error(`Failed to mark expired transactions: ${error.message}`);
    }
  }

  /**
   * Gets the count of pending transactions
   * 
   * @returns Promise resolving to the count of pending transactions
   */
  public async getPendingTransactionCount(): Promise<number> {
    try {
      this.logger.debug('Getting pending transaction count');

      // Get current time
      const now = new Date();

      // Count pending transactions
      const count = await this.repository.count({
        where: {
          status: TransactionStatus.PENDING,
          expiresAt: MoreThanOrEqual(now)
        }
      });

      return count;
    } catch (error) {
      this.logger.error('Failed to get pending transaction count', { error });
      throw new Error(`Failed to get pending transaction count: ${error.message}`);
    }
  }

  /**
   * Gets transaction statistics
   * Uses caching to improve performance
   * 
   * @param forceRefresh - Whether to force a refresh of the statistics
   * @returns Promise resolving to transaction statistics
   */
  public async getTransactionStatistics(forceRefresh: boolean = false): Promise<TransactionStatistics> {
    try {
      // Check if we have cached statistics and they are still valid (less than 5 minutes old)
      const now = new Date();
      if (
        !forceRefresh &&
        this.statsCache.statistics &&
        this.statsCache.lastUpdated &&
        now.getTime() - this.statsCache.lastUpdated.getTime() < 5 * 60 * 1000
      ) {
        return this.statsCache.statistics;
      }

      this.logger.info('Calculating transaction statistics');

      // Get total count
      const totalCount = await this.repository.count();

      // Get counts by status
      const pendingCount = await this.repository.count({ where: { status: TransactionStatus.PENDING } });
      const bundledCount = await this.repository.count({ where: { status: TransactionStatus.BUNDLED } });
      const confirmedCount = await this.repository.count({ where: { status: TransactionStatus.CONFIRMED } });
      const failedCount = await this.repository.count({ where: { status: TransactionStatus.FAILED } });
      const expiredCount = await this.repository.count({ where: { status: TransactionStatus.EXPIRED } });

      // Calculate average confirmation time
      const confirmationTimeResult = await this.repository
        .createQueryBuilder('transaction')
        .select('AVG(EXTRACT(EPOCH FROM (transaction.blockTimestamp - transaction.createdAt)))', 'avgTime')
        .where('transaction.status = :status', { status: TransactionStatus.CONFIRMED })
        .andWhere('transaction.blockTimestamp IS NOT NULL')
        .getRawOne();

      const averageConfirmationTime = confirmationTimeResult?.avgTime ? parseFloat(confirmationTimeResult.avgTime) : null;

      // Calculate average fee
      const feeResult = await this.repository
        .createQueryBuilder('transaction')
        .select('AVG(transaction.fee::numeric)', 'avgFee')
        .getRawOne();

      const averageFee = feeResult?.avgFee ? feeResult.avgFee.toString() : '0';

      // Get transactions by type
      const transactionsByType: Record<TransactionType, number> = {} as Record<TransactionType, number>;
      
      for (const type of Object.values(TransactionType)) {
        const count = await this.repository.count({ where: { type } });
        transactionsByType[type] = count;
      }

      // Get transactions by hour for the last 24 hours
      const transactionsByHour: Array<{ hour: Date; count: number }> = [];
      
      for (let i = 0; i < 24; i++) {
        const hourStart = new Date();
        hourStart.setHours(hourStart.getHours() - i, 0, 0, 0);
        
        const hourEnd = new Date(hourStart);
        hourEnd.setHours(hourEnd.getHours() + 1);
        
        const count = await this.repository.count({
          where: {
            createdAt: Between(hourStart, hourEnd)
          }
        });
        
        transactionsByHour.push({
          hour: hourStart,
          count
        });
      }

      // Create statistics object
      const statistics: TransactionStatistics = {
        totalCount,
        pendingCount,
        bundledCount,
        confirmedCount,
        failedCount,
        expiredCount,
        averageConfirmationTime,
        averageFee,
        transactionsByType,
        transactionsByHour
      };

      // Update cache
      this.statsCache = {
        statistics,
        lastUpdated: now
      };

      this.logger.info('Transaction statistics calculated successfully');

      return statistics;
    } catch (error) {
      this.logger.error('Failed to get transaction statistics', { error });
      throw new Error(`Failed to get transaction statistics: ${error.message}`);
    }
  }

  /**
   * Invalidates the statistics cache
   */
  private invalidateStatsCache(): void {
    this.statsCache = {
      statistics: null,
      lastUpdated: null
    };
  }

  /**
   * Calculates the fee for a transaction
   * 
   * @param gasLimit - Gas limit for the transaction
   * @param gasPrice - Gas price for the transaction
   * @returns Calculated fee as a string
   */
  private calculateFee(gasLimit: number, gasPrice: string): string {
    // Convert gasPrice to BigInt
    const gasPriceBigInt = BigInt(gasPrice);
    
    // Calculate fee
    const feeBigInt = gasPriceBigInt * BigInt(gasLimit);
    
    // Return fee as string
    return feeBigInt.toString();
  }

  /**
   * Calculates the expiry time for a transaction
   * Default is 24 hours from now
   * 
   * @returns Calculated expiry time
   */
  private calculateExpiryTime(): Date {
    const expiryTime = new Date();
    expiryTime.setHours(expiryTime.getHours() + 24);
    return expiryTime;
  }

  /**
   * Generates a transaction hash
   * 
   * @param params - Transaction parameters
   * @returns Generated transaction hash
   */
  private generateTransactionHash(params: CreateTransactionParams): string {
    // Create hash input
    const hashInput = `${params.sender}${params.recipient}${params.amount}${params.nonce}${params.data}${params.signature}`;
    
    // Generate hash
    const hash = createHash('sha256').update(hashInput).digest('hex');
    
    // Return hash with 0x prefix
    return `0x${hash}`;
  }

  /**
   * Cleans up old transactions
   * Removes expired and failed transactions older than the specified number of days
   * 
   * @param daysToKeep - Number of days to keep transactions
   * @returns Promise resolving to the number of transactions removed
   */
  public async cleanupOldTransactions(daysToKeep: number = 30): Promise<number> {
    try {
      this.logger.info('Cleaning up old transactions', { daysToKeep });

      // Calculate cutoff date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      // Remove old transactions
      const result = await this.repository.createQueryBuilder()
        .delete()
        .from(Transaction)
        .where('status IN (:...statuses)', { statuses: [TransactionStatus.EXPIRED, TransactionStatus.FAILED] })
        .andWhere('createdAt < :cutoffDate', { cutoffDate })
        .execute();

      const count = result.affected || 0;

      this.logger.info('Old transactions cleaned up successfully', {
        count
      });

      // Invalidate statistics cache if any transactions were removed
      if (count > 0) {
        this.invalidateStatsCache();
      }

      return count;
    } catch (error) {
      this.logger.error('Failed to clean up old transactions', { error });
      throw new Error(`Failed to clean up old transactions: ${error.message}`);
    }
  }

  /**
   * Shuts down the transaction service
   * Terminates all worker threads
   */
  public async shutdown(): Promise<void> {
    try {
      this.logger.info('Shutting down transaction service');

      // Terminate all workers
      if (this.useMultiThreading) {
        for (let i = 0; i < this.workers.length; i++) {
          await this.workers[i].terminate();
        }
        this.workers = [];
      }

      this.logger.info('Transaction service shut down successfully');
    } catch (error) {
      this.logger.error('Failed to shut down transaction service', { error });
      throw new Error(`Failed to shut down transaction service: ${error.message}`);
    }
  }
}
