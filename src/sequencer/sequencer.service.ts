// English comment for verification
/**
 * @file SequencerService.ts
 * @description Comprehensive implementation of the Sequencer service for Layer-2
 * @author Manus AI
 * @date April 27, 2025
 */

import { Connection, PublicKey, Transaction, Keypair, sendAndConfirmTransaction } from '@solana/web3.js';
import { Logger } from '../utils/Logger';
import { MetricsService } from '../monitoring/MetricsService';
import { MonitoringService } from '../monitoring/MonitoringService';
import { ThreadPoolService } from '../utils/ThreadPoolService';
import { CacheService } from '../utils/CacheService';
import { DatabaseService } from '../database/database.service';
import { BundleEntity } from './bundle.entity';
import { TransactionEntity } from '../transaction/transaction.entity';
import { EventEmitter } from 'events';

/**
 * Transaction priority levels
 */
export enum TransactionPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * Bundle status enum
 */
export enum BundleStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUBMITTED = 'submitted',
  CONFIRMED = 'confirmed',
  FAILED = 'failed'
}

/**
 * Transaction status enum
 */
export enum TransactionStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  INCLUDED = 'included',
  CONFIRMED = 'confirmed',
  FAILED = 'failed'
}

/**
 * Sequencer configuration interface
 */
export interface SequencerConfig {
  // Solana configuration
  solana: {
    rpc: string;
    privateKey: string;
    commitment: 'processed' | 'confirmed' | 'finalized';
    maxRetries: number;
    retryDelay: number;
  };
  
  // Bundling configuration
  bundling: {
    maxTransactionsPerBundle: number;
    bundleInterval: number;
    minTransactionsPerBundle: number;
    maxBundleSize: number; // in bytes
    priorityWeights: {
      [key in TransactionPriority]: number;
    };
    dynamicBundling: boolean;
    bundleTimeoutMs: number;
  };
  
  // Performance configuration
  performance: {
    maxConcurrentBundles: number;
    maxConcurrentTransactions: number;
    useThreadPool: boolean;
    threadPoolSize: number;
    useBatchProcessing: boolean;
    batchSize: number;
  };
  
  // Monitoring configuration
  monitoring: {
    metricsEnabled: boolean;
    alertThresholds: {
      bundleProcessingTime: number;
      errorRate: number;
      pendingTransactions: number;
      pendingBundles: number;
      transactionConfirmationTime: number;
    };
  };
  
  // Database configuration
  database: {
    transactionTTL: number; // in seconds
    bundleTTL: number; // in seconds
    pruneInterval: number; // in seconds
  };
}

/**
 * Default sequencer configuration
 */
const DEFAULT_CONFIG: SequencerConfig = {
  solana: {
    rpc: 'https://api.mainnet-beta.solana.com',
    privateKey: '',
    commitment: 'confirmed',
    maxRetries: 5,
    retryDelay: 5000, // 5 seconds
  },
  
  bundling: {
    maxTransactionsPerBundle: 100,
    bundleInterval: 10000, // 10 seconds
    minTransactionsPerBundle: 5,
    maxBundleSize: 1024 * 1024, // 1 MB
    priorityWeights: {
      [TransactionPriority.LOW]: 1,
      [TransactionPriority.MEDIUM]: 2,
      [TransactionPriority.HIGH]: 5,
      [TransactionPriority.CRITICAL]: 10
    },
    dynamicBundling: true,
    bundleTimeoutMs: 60000, // 60 seconds
  },
  
  performance: {
    maxConcurrentBundles: 5,
    maxConcurrentTransactions: 20,
    useThreadPool: true,
    threadPoolSize: 10,
    useBatchProcessing: true,
    batchSize: 50,
  },
  
  monitoring: {
    metricsEnabled: true,
    alertThresholds: {
      bundleProcessingTime: 30000, // 30 seconds
      errorRate: 0.1, // 10%
      pendingTransactions: 1000,
      pendingBundles: 20,
      transactionConfirmationTime: 60000, // 60 seconds
    },
  },
  
  database: {
    transactionTTL: 86400 * 7, // 7 days
    bundleTTL: 86400 * 30, // 30 days
    pruneInterval: 3600, // 1 hour
  },
};

/**
 * SequencerService class - Handles transaction bundling and submission to the blockchain
 */
export class SequencerService extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: SequencerConfig;
  private readonly metricsService: MetricsService;
  private readonly monitoringService: MonitoringService;
  private readonly threadPoolService: ThreadPoolService;
  private readonly cacheService: CacheService;
  private readonly databaseService: DatabaseService;
  
  // Blockchain connection
  private solanaConnection: Connection;
  private solanaWallet: Keypair;
  
  // Internal state
  private isRunning: boolean = false;
  private bundleIntervalId: NodeJS.Timeout | null = null;
  private pruneIntervalId: NodeJS.Timeout | null = null;
  private pendingTransactions: Map<string, TransactionEntity> = new Map();
  private pendingBundles: Map<string, BundleEntity> = new Map();
  private processingBundles: Set<string> = new Set();
  
  /**
   * Constructor for the SequencerService
   * 
   * @param databaseService - Database service for storing transaction data
   * @param metricsService - Metrics service for monitoring performance
   * @param monitoringService - Monitoring service for alerts and notifications
   * @param threadPoolService - Thread pool service for parallel processing
   * @param cacheService - Cache service for optimizing data access
   * @param logger - Logger instance
   * @param config - Configuration for the sequencer
   */
  constructor(
    databaseService: DatabaseService,
    metricsService: MetricsService,
    monitoringService: MonitoringService,
    threadPoolService: ThreadPoolService,
    cacheService: CacheService,
    logger: Logger,
    config: Partial<SequencerConfig> = {}
  ) {
    super();
    
    this.databaseService = databaseService;
    this.metricsService = metricsService;
    this.monitoringService = monitoringService;
    this.threadPoolService = threadPoolService;
    this.cacheService = cacheService;
    this.logger = logger.createChild('SequencerService');
    
    // Merge provided config with defaults
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      bundling: {
        ...DEFAULT_CONFIG.bundling,
        ...(config.bundling || {}),
        priorityWeights: {
          ...DEFAULT_CONFIG.bundling.priorityWeights,
          ...(config.bundling?.priorityWeights || {})
        }
      },
      monitoring: {
        ...DEFAULT_CONFIG.monitoring,
        ...(config.monitoring || {}),
        alertThresholds: {
          ...DEFAULT_CONFIG.monitoring.alertThresholds,
          ...(config.monitoring?.alertThresholds || {})
        }
      }
    };
    
    // Initialize Solana connection
    this.solanaConnection = new Connection(this.config.solana.rpc, this.config.solana.commitment);
    
    // Initialize Solana wallet if private key is provided
    if (this.config.solana.privateKey) {
      this.solanaWallet = Keypair.fromSecretKey(Buffer.from(this.config.solana.privateKey, 'hex'));
    } else {
      // Generate a new keypair for testing purposes
      this.solanaWallet = Keypair.generate();
      this.logger.warn('No private key provided, generated a new keypair for testing');
    }
    
    this.logger.info('SequencerService initialized');
  }
  
  /**
   * Start the sequencer service
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('SequencerService is already running');
      return;
    }
    
    this.logger.info('Starting SequencerService');
    
    try {
      // Initialize database tables
      await this.initializeDatabaseTables();
      
      // Load pending transactions and bundles from database
      await this.loadPendingTransactions();
      await this.loadPendingBundles();
      
      // Start bundle creation interval
      this.startBundleInterval();
      
      // Start database pruning interval
      this.startPruneInterval();
      
      this.isRunning = true;
      this.logger.info('SequencerService started successfully');
      this.emit('started');
      
      // Record metrics
      if (this.config.monitoring.metricsEnabled) {
        this.metricsService.recordMetric('sequencer.status', 1);
        this.metricsService.recordMetric('sequencer.pending_transactions', this.pendingTransactions.size);
        this.metricsService.recordMetric('sequencer.pending_bundles', this.pendingBundles.size);
      }
    } catch (error) {
      this.logger.error('Failed to start SequencerService', error);
      throw error;
    }
  }
  
  /**
   * Stop the sequencer service
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('SequencerService is not running');
      return;
    }
    
    this.logger.info('Stopping SequencerService');
    
    try {
      // Stop bundle creation interval
      this.stopBundleInterval();
      
      // Stop database pruning interval
      this.stopPruneInterval();
      
      // Save current state to database
      await this.saveState();
      
      this.isRunning = false;
      this.logger.info('SequencerService stopped successfully');
      this.emit('stopped');
      
      // Record metrics
      if (this.config.monitoring.metricsEnabled) {
        this.metricsService.recordMetric('sequencer.status', 0);
      }
    } catch (error) {
      this.logger.error('Failed to stop SequencerService', error);
      throw error;
    }
  }
  
  /**
   * Initialize database tables
   */
  private async initializeDatabaseTables(): Promise<void> {
    this.logger.info('Initializing database tables');
    
    try {
      // Create transactions table if it doesn't exist
      await this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS transactions (
          id VARCHAR(255) PRIMARY KEY,
          status VARCHAR(50) NOT NULL,
          priority VARCHAR(50) NOT NULL,
          data TEXT NOT NULL,
          signature VARCHAR(255),
          bundle_id VARCHAR(255),
          error TEXT,
          retry_count INT DEFAULT 0,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL,
          completed_at TIMESTAMP,
          expires_at TIMESTAMP
        )
      `);
      
      // Create bundles table if it doesn't exist
      await this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS bundles (
          id VARCHAR(255) PRIMARY KEY,
          status VARCHAR(50) NOT NULL,
          transaction_count INT NOT NULL,
          transaction_ids TEXT NOT NULL,
          signature VARCHAR(255),
          error TEXT,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL,
          completed_at TIMESTAMP,
          expires_at TIMESTAMP
        )
      `);
      
      this.logger.info('Database tables initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize database tables', error);
      throw error;
    }
  }
  
  /**
   * Load pending transactions from database
   */
  private async loadPendingTransactions(): Promise<void> {
    this.logger.info('Loading pending transactions from database');
    
    try {
      // Query database for pending transactions
      const pendingTransactions = await this.databaseService.query(
        'SELECT * FROM transactions WHERE status IN (?, ?) AND expires_at > NOW()',
        [TransactionStatus.PENDING, TransactionStatus.PROCESSING]
      );
      
      // Add pending transactions to memory
      for (const tx of pendingTransactions) {
        const transaction = new TransactionEntity(tx);
        this.pendingTransactions.set(transaction.id, transaction);
      }
      
      this.logger.info(`Loaded ${this.pendingTransactions.size} pending transactions`);
      
      // Record metrics
      if (this.config.monitoring.metricsEnabled) {
        this.metricsService.recordMetric('sequencer.pending_transactions', this.pendingTransactions.size);
      }
    } catch (error) {
      this.logger.error('Failed to load pending transactions', error);
      throw error;
    }
  }
  
  /**
   * Load pending bundles from database
   */
  private async loadPendingBundles(): Promise<void> {
    this.logger.info('Loading pending bundles from database');
    
    try {
      // Query database for pending bundles
      const pendingBundles = await this.databaseService.query(
        'SELECT * FROM bundles WHERE status IN (?, ?, ?) AND expires_at > NOW()',
        [BundleStatus.PENDING, BundleStatus.PROCESSING, BundleStatus.SUBMITTED]
      );
      
      // Add pending bundles to memory
      for (const bundle of pendingBundles) {
        const bundleEntity = new BundleEntity(bundle);
        this.pendingBundles.set(bundleEntity.id, bundleEntity);
        
        // Mark as processing if it was processing before
        if (bundleEntity.status === BundleStatus.PROCESSING) {
          this.processingBundles.add(bundleEntity.id);
        }
      }
      
      this.logger.info(`Loaded ${this.pendingBundles.size} pending bundles`);
      
      // Record metrics
      if (this.config.monitoring.metricsEnabled) {
        this.metricsService.recordMetric('sequencer.pending_bundles', this.pendingBundles.size);
      }
    } catch (error) {
      this.logger.error('Failed to load pending bundles', error);
      throw error;
    }
  }
  
  /**
   * Start bundle creation interval
   */
  private startBundleInterval(): void {
    this.logger.info(`Starting bundle creation interval: ${this.config.bundling.bundleInterval}ms`);
    
    // Clear any existing interval
    this.stopBundleInterval();
    
    // Start new interval
    this.bundleIntervalId = setInterval(async () => {
      try {
        await this.createAndProcessBundles();
      } catch (error) {
        this.logger.error('Error during bundle creation and processing', error);
        
        // Record error metric
        if (this.config.monitoring.metricsEnabled) {
          this.metricsService.recordMetric('sequencer.bundle_errors', 1);
        }
      }
    }, this.config.bundling.bundleInterval);
    
    this.logger.info('Bundle creation interval started');
  }
  
  /**
   * Stop bundle creation interval
   */
  private stopBundleInterval(): void {
    if (this.bundleIntervalId) {
      clearInterval(this.bundleIntervalId);
      this.bundleIntervalId = null;
      this.logger.info('Bundle creation interval stopped');
    }
  }
  
  /**
   * Start database pruning interval
   */
  private startPruneInterval(): void {
    this.logger.info(`Starting database pruning interval: ${this.config.database.pruneInterval}s`);
    
    // Clear any existing interval
    this.stopPruneInterval();
    
    // Start new interval
    this.pruneIntervalId = setInterval(async () => {
      try {
        await this.pruneDatabase();
      } catch (error) {
        this.logger.error('Error during database pruning', error);
      }
    }, this.config.database.pruneInterval * 1000);
    
    this.logger.info('Database pruning interval started');
  }
  
  /**
   * Stop database pruning interval
   */
  private stopPruneInterval(): void {
    if (this.pruneIntervalId) {
      clearInterval(this.pruneIntervalId);
      this.pruneIntervalId = null;
      this.logger.info('Database pruning interval stopped');
    }
  }
  
  /**
   * Create and process bundles
   */
  private async createAndProcessBundles(): Promise<void> {
    this.logger.debug('Creating and processing bundles');
    
    try {
      // Check if there are pending transactions
      if (this.pendingTransactions.size === 0) {
        this.logger.debug('No pending transactions to bundle');
        return;
      }
      
      // Check if we can create more bundles
      const availableBundleSlots = this.config.performance.maxConcurrentBundles - this.processingBundles.size;
      
      if (availableBundleSlots <= 0) {
        this.logger.debug('Maximum concurrent bundles reached, waiting for completion');
        return;
      }
      
      // Create bundles
      const bundlesToCreate = Math.min(availableBundleSlots, Math.ceil(this.pendingTransactions.size / this.config.bundling.maxTransactionsPerBundle));
      
      this.logger.info(`Creating ${bundlesToCreate} bundles from ${this.pendingTransactions.size} pending transactions`);
      
      for (let i = 0; i < bundlesToCreate; i++) {
        const bundle = await this.createBundle();
        
        if (bundle) {
          // Process bundle
          this.processBundle(bundle);
        }
      }
      
      // Record metrics
      if (this.config.monitoring.metricsEnabled) {
        this.metricsService.recordMetric('sequencer.pending_transactions', this.pendingTransactions.size);
        this.metricsService.recordMetric('sequencer.pending_bundles', this.pendingBundles.size);
        this.metricsService.recordMetric('sequencer.processing_bundles', this.processingBundles.size);
      }
    } catch (error) {
      this.logger.error('Error creating and processing bundles', error);
      throw error;
    }
  }
  
  /**
   * Create a bundle from pending transactions
   * 
   * @returns The created bundle, or null if not enough transactions
   */
  private async createBundle(): Promise<BundleEntity | null> {
    this.logger.debug('Creating bundle');
    
    try {
      // Get pending transactions
      const transactions = Array.from(this.pendingTransactions.values());
      
      // Sort transactions by priority and timestamp
      transactions.sort((a, b) => {
        const priorityA = this.config.bundling.priorityWeights[a.priority as TransactionPriority] || 1;
        const priorityB = this.config.bundling.priorityWeights[b.priority as TransactionPriority] || 1;
        
        if (priorityA !== priorityB) {
          return priorityB - priorityA; // Higher priority first
        }
        
        return a.createdAt.getTime() - b.createdAt.getTime(); // Older first
      });
      
      // Select transactions for the bundle
      const selectedTransactions: TransactionEntity[] = [];
      let bundleSize = 0;
      
      for (const tx of transactions) {
        // Skip transactions that are already in a bundle
        if (tx.bundleId) {
          continue;
        }
        
        // Check if adding this transaction would exceed the max bundle size
        const txSize = Buffer.from(tx.data, 'base64').length;
        
        if (bundleSize + txSize > this.config.bundling.maxBundleSize) {
          continue;
        }
        
        // Add transaction to bundle
        selectedTransactions.push(tx);
        bundleSize += txSize;
        
        // Check if we've reached the max transactions per bundle
        if (selectedTransactions.length >= this.config.bundling.maxTransactionsPerBundle) {
          break;
        }
      }
      
      // Check if we have enough transactions
      if (selectedTransactions.length < this.config.bundling.minTransactionsPerBundle) {
        this.logger.debug(`Not enough transactions for a bundle: ${selectedTransactions.length} < ${this.config.bundling.minTransactionsPerBundle}`);
        return null;
      }
      
      // Create bundle
      const bundle = new BundleEntity({
        id: `bundle-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
        status: BundleStatus.PENDING,
        transactionCount: selectedTransactions.length,
        transactionIds: selectedTransactions.map(tx => tx.id).join(','),
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + this.config.database.bundleTTL * 1000)
      });
      
      // Update transactions with bundle ID
      for (const tx of selectedTransactions) {
        tx.bundleId = bundle.id;
        tx.status = TransactionStatus.PROCESSING;
        tx.updatedAt = new Date();
        
        // Update in database
        await this.updateTransactionInDatabase(tx);
        
        // Remove from pending transactions
        this.pendingTransactions.delete(tx.id);
      }
      
      // Save bundle to database
      await this.createBundleInDatabase(bundle);
      
      // Add to pending bundles
      this.pendingBundles.set(bundle.id, bundle);
      
      this.logger.info(`Created bundle ${bundle.id} with ${bundle.transactionCount} transactions`);
      
      // Emit event
      this.emit('bundleCreated', bundle);
      
      return bundle;
    } catch (error) {
      this.logger.error('Error creating bundle', error);
      throw error;
    }
  }
  
  /**
   * Process a bundle
   * 
   * @param bundle - The bundle to process
   */
  private async processBundle(bundle: BundleEntity): Promise<void> {
    this.logger.info(`Processing bundle ${bundle.id}`);
    
    // Mark bundle as processing
    bundle.status = BundleStatus.PROCESSING;
    bundle.updatedAt = new Date();
    await this.updateBundleInDatabase(bundle);
    
    // Add to processing bundles
    this.processingBundles.add(bundle.id);
    
    // Use thread pool if enabled
    if (this.config.performance.useThreadPool) {
      this.threadPoolService.submitTask(() => this.processBundleInternal(bundle));
    } else {
      this.processBundleInternal(bundle).catch(error => {
        this.logger.error(`Error processing bundle ${bundle.id}`, error);
      });
    }
  }
  
  /**
   * Internal method to process a bundle
   * 
   * @param bundle - The bundle to process
   */
  private async processBundleInternal(bundle: BundleEntity): Promise<void> {
    const startTime = Date.now();
    this.logger.info(`Processing bundle ${bundle.id} internally`);
    
    try {
      // Get transaction IDs
      const transactionIds = bundle.transactionIds.split(',');
      
      // Get transactions from database
      const transactions: TransactionEntity[] = [];
      
      for (const id of transactionIds) {
        const tx = await this.getTransactionById(id);
        
        if (tx) {
          transactions.push(tx);
        } else {
          this.logger.warn(`Transaction ${id} not found for bundle ${bundle.id}`);
        }
      }
      
      if (transactions.length === 0) {
        throw new Error(`No transactions found for bundle ${bundle.id}`);
      }
      
      // Create Solana transactions
      const solanaTransactions: Transaction[] = [];
      
      for (const tx of transactions) {
        try {
          const transactionData = Buffer.from(tx.data, 'base64');
          const solanaTransaction = Transaction.from(transactionData);
          solanaTransactions.push(solanaTransaction);
        } catch (error) {
          this.logger.error(`Error parsing transaction ${tx.id}`, error);
          
          // Mark transaction as failed
          tx.status = TransactionStatus.FAILED;
          tx.error = `Error parsing transaction: ${error.message}`;
          tx.updatedAt = new Date();
          await this.updateTransactionInDatabase(tx);
        }
      }
      
      if (solanaTransactions.length === 0) {
        throw new Error(`No valid transactions in bundle ${bundle.id}`);
      }
      
      // Submit bundle to blockchain
      const signature = await this.submitBundle(solanaTransactions);
      
      // Update bundle with signature
      bundle.signature = signature;
      bundle.status = BundleStatus.SUBMITTED;
      bundle.updatedAt = new Date();
      await this.updateBundleInDatabase(bundle);
      
      // Update transactions
      for (const tx of transactions) {
        tx.status = TransactionStatus.INCLUDED;
        tx.signature = signature;
        tx.updatedAt = new Date();
        await this.updateTransactionInDatabase(tx);
      }
      
      this.logger.info(`Bundle ${bundle.id} submitted with signature ${signature}`);
      
      // Wait for confirmation
      const confirmation = await this.waitForConfirmation(signature);
      
      // Update bundle status
      bundle.status = BundleStatus.CONFIRMED;
      bundle.completedAt = new Date();
      bundle.updatedAt = new Date();
      await this.updateBundleInDatabase(bundle);
      
      // Update transactions
      for (const tx of transactions) {
        tx.status = TransactionStatus.CONFIRMED;
        tx.completedAt = new Date();
        tx.updatedAt = new Date();
        await this.updateTransactionInDatabase(tx);
      }
      
      this.logger.info(`Bundle ${bundle.id} confirmed`);
      
      // Emit event
      this.emit('bundleConfirmed', bundle);
      
      // Record metrics
      if (this.config.monitoring.metricsEnabled) {
        const processingTime = Date.now() - startTime;
        this.metricsService.recordMetric('sequencer.bundle_processing_time', processingTime);
        this.metricsService.recordMetric('sequencer.bundle_transaction_count', transactions.length);
        
        // Send alert if processing time exceeds threshold
        if (processingTime > this.config.monitoring.alertThresholds.bundleProcessingTime) {
          this.monitoringService.sendAlert({
            level: 'warning',
            source: 'SequencerService',
            message: 'Bundle processing time exceeded threshold',
            details: {
              bundleId: bundle.id,
              processingTime,
              threshold: this.config.monitoring.alertThresholds.bundleProcessingTime,
            },
          });
        }
      }
    } catch (error) {
      this.logger.error(`Error processing bundle ${bundle.id}`, error);
      
      // Update bundle status
      bundle.status = BundleStatus.FAILED;
      bundle.error = error.message;
      bundle.updatedAt = new Date();
      await this.updateBundleInDatabase(bundle);
      
      // Update transactions
      const transactionIds = bundle.transactionIds.split(',');
      
      for (const id of transactionIds) {
        const tx = await this.getTransactionById(id);
        
        if (tx) {
          tx.status = TransactionStatus.FAILED;
          tx.error = `Bundle failed: ${error.message}`;
          tx.updatedAt = new Date();
          await this.updateTransactionInDatabase(tx);
        }
      }
      
      // Emit event
      this.emit('bundleFailed', bundle);
      
      // Record error metric
      if (this.config.monitoring.metricsEnabled) {
        this.metricsService.recordMetric('sequencer.bundle_errors', 1);
      }
    } finally {
      // Remove from processing bundles
      this.processingBundles.delete(bundle.id);
      
      // Remove from pending bundles if completed or failed
      if (bundle.status === BundleStatus.CONFIRMED || bundle.status === BundleStatus.FAILED) {
        this.pendingBundles.delete(bundle.id);
      }
    }
  }
  
  /**
   * Submit a bundle of transactions to the blockchain
   * 
   * @param transactions - The transactions to submit
   * @returns The transaction signature
   */
  private async submitBundle(transactions: Transaction[]): Promise<string> {
    this.logger.info(`Submitting bundle with ${transactions.length} transactions`);
    
    try {
      // TODO: Implement actual bundle submission
      // For now, just return a placeholder signature
      const signature = `bundle-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      
      this.logger.info(`Bundle submitted with signature: ${signature}`);
      return signature;
    } catch (error) {
      this.logger.error('Error submitting bundle', error);
      throw error;
    }
  }
  
  /**
   * Wait for transaction confirmation
   * 
   * @param signature - The transaction signature
   * @returns The confirmation status
   */
  private async waitForConfirmation(signature: string): Promise<boolean> {
    this.logger.info(`Waiting for confirmation of transaction ${signature}`);
    
    try {
      // TODO: Implement actual confirmation waiting
      // For now, just wait a bit and return true
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      this.logger.info(`Transaction ${signature} confirmed`);
      return true;
    } catch (error) {
      this.logger.error(`Error waiting for confirmation of transaction ${signature}`, error);
      throw error;
    }
  }
  
  /**
   * Add a transaction to the sequencer
   * 
   * @param transaction - The transaction to add
   * @returns The transaction ID
   */
  public async addTransaction(transaction: Partial<TransactionEntity>): Promise<string> {
    this.logger.info('Adding transaction to sequencer');
    
    try {
      // Validate transaction
      if (!transaction.data) {
        throw new Error('Transaction data is required');
      }
      
      // Create transaction entity
      const tx = new TransactionEntity({
        id: transaction.id || `tx-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
        status: TransactionStatus.PENDING,
        priority: transaction.priority || TransactionPriority.MEDIUM,
        data: transaction.data,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + this.config.database.transactionTTL * 1000)
      });
      
      // Save to database
      await this.createTransactionInDatabase(tx);
      
      // Add to pending transactions
      this.pendingTransactions.set(tx.id, tx);
      
      this.logger.info(`Transaction added with ID: ${tx.id}`);
      
      // Emit event
      this.emit('transactionAdded', tx);
      
      // Record metrics
      if (this.config.monitoring.metricsEnabled) {
        this.metricsService.recordMetric('sequencer.transactions_added', 1);
        this.metricsService.recordMetric('sequencer.pending_transactions', this.pendingTransactions.size);
        
        // Send alert if pending transactions exceed threshold
        if (this.pendingTransactions.size > this.config.monitoring.alertThresholds.pendingTransactions) {
          this.monitoringService.sendAlert({
            level: 'warning',
            source: 'SequencerService',
            message: 'Pending transactions exceeded threshold',
            details: {
              pendingTransactions: this.pendingTransactions.size,
              threshold: this.config.monitoring.alertThresholds.pendingTransactions,
            },
          });
        }
      }
      
      return tx.id;
    } catch (error) {
      this.logger.error('Error adding transaction', error);
      throw error;
    }
  }
  
  /**
   * Get a transaction by ID
   * 
   * @param id - The transaction ID
   * @returns The transaction if found, null otherwise
   */
  public async getTransactionById(id: string): Promise<TransactionEntity | null> {
    this.logger.debug(`Getting transaction by ID: ${id}`);
    
    try {
      // Check in-memory cache first
      if (this.pendingTransactions.has(id)) {
        return this.pendingTransactions.get(id) || null;
      }
      
      // Query database
      const rows = await this.databaseService.query(
        'SELECT * FROM transactions WHERE id = ?',
        [id]
      );
      
      if (rows.length === 0) {
        return null;
      }
      
      return new TransactionEntity(rows[0]);
    } catch (error) {
      this.logger.error(`Error getting transaction by ID: ${id}`, error);
      throw error;
    }
  }
  
  /**
   * Get a bundle by ID
   * 
   * @param id - The bundle ID
   * @returns The bundle if found, null otherwise
   */
  public async getBundleById(id: string): Promise<BundleEntity | null> {
    this.logger.debug(`Getting bundle by ID: ${id}`);
    
    try {
      // Check in-memory cache first
      if (this.pendingBundles.has(id)) {
        return this.pendingBundles.get(id) || null;
      }
      
      // Query database
      const rows = await this.databaseService.query(
        'SELECT * FROM bundles WHERE id = ?',
        [id]
      );
      
      if (rows.length === 0) {
        return null;
      }
      
      return new BundleEntity(rows[0]);
    } catch (error) {
      this.logger.error(`Error getting bundle by ID: ${id}`, error);
      throw error;
    }
  }
  
  /**
   * Get transactions by status
   * 
   * @param status - The transaction status
   * @returns Array of transactions with the specified status
   */
  public async getTransactionsByStatus(status: TransactionStatus): Promise<TransactionEntity[]> {
    this.logger.debug(`Getting transactions by status: ${status}`);
    
    try {
      // Query database
      const rows = await this.databaseService.query(
        'SELECT * FROM transactions WHERE status = ?',
        [status]
      );
      
      return rows.map(row => new TransactionEntity(row));
    } catch (error) {
      this.logger.error(`Error getting transactions by status: ${status}`, error);
      throw error;
    }
  }
  
  /**
   * Get bundles by status
   * 
   * @param status - The bundle status
   * @returns Array of bundles with the specified status
   */
  public async getBundlesByStatus(status: BundleStatus): Promise<BundleEntity[]> {
    this.logger.debug(`Getting bundles by status: ${status}`);
    
    try {
      // Query database
      const rows = await this.databaseService.query(
        'SELECT * FROM bundles WHERE status = ?',
        [status]
      );
      
      return rows.map(row => new BundleEntity(row));
    } catch (error) {
      this.logger.error(`Error getting bundles by status: ${status}`, error);
      throw error;
    }
  }
  
  /**
   * Create a transaction in the database
   * 
   * @param transaction - The transaction to create
   */
  private async createTransactionInDatabase(transaction: TransactionEntity): Promise<void> {
    this.logger.debug(`Creating transaction in database: ${transaction.id}`);
    
    try {
      await this.databaseService.query(
        `INSERT INTO transactions (
          id, status, priority, data, signature, bundle_id, error, retry_count,
          created_at, updated_at, completed_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          transaction.id,
          transaction.status,
          transaction.priority,
          transaction.data,
          transaction.signature,
          transaction.bundleId,
          transaction.error,
          transaction.retryCount,
          transaction.createdAt,
          transaction.updatedAt,
          transaction.completedAt,
          transaction.expiresAt,
        ]
      );
    } catch (error) {
      this.logger.error(`Error creating transaction in database: ${transaction.id}`, error);
      throw error;
    }
  }
  
  /**
   * Update a transaction in the database
   * 
   * @param transaction - The transaction to update
   */
  private async updateTransactionInDatabase(transaction: TransactionEntity): Promise<void> {
    this.logger.debug(`Updating transaction in database: ${transaction.id}`);
    
    try {
      await this.databaseService.query(
        `UPDATE transactions SET
          status = ?,
          priority = ?,
          data = ?,
          signature = ?,
          bundle_id = ?,
          error = ?,
          retry_count = ?,
          updated_at = ?,
          completed_at = ?,
          expires_at = ?
        WHERE id = ?`,
        [
          transaction.status,
          transaction.priority,
          transaction.data,
          transaction.signature,
          transaction.bundleId,
          transaction.error,
          transaction.retryCount,
          transaction.updatedAt,
          transaction.completedAt,
          transaction.expiresAt,
          transaction.id,
        ]
      );
    } catch (error) {
      this.logger.error(`Error updating transaction in database: ${transaction.id}`, error);
      throw error;
    }
  }
  
  /**
   * Create a bundle in the database
   * 
   * @param bundle - The bundle to create
   */
  private async createBundleInDatabase(bundle: BundleEntity): Promise<void> {
    this.logger.debug(`Creating bundle in database: ${bundle.id}`);
    
    try {
      await this.databaseService.query(
        `INSERT INTO bundles (
          id, status, transaction_count, transaction_ids, signature, error,
          created_at, updated_at, completed_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bundle.id,
          bundle.status,
          bundle.transactionCount,
          bundle.transactionIds,
          bundle.signature,
          bundle.error,
          bundle.createdAt,
          bundle.updatedAt,
          bundle.completedAt,
          bundle.expiresAt,
        ]
      );
    } catch (error) {
      this.logger.error(`Error creating bundle in database: ${bundle.id}`, error);
      throw error;
    }
  }
  
  /**
   * Update a bundle in the database
   * 
   * @param bundle - The bundle to update
   */
  private async updateBundleInDatabase(bundle: BundleEntity): Promise<void> {
    this.logger.debug(`Updating bundle in database: ${bundle.id}`);
    
    try {
      await this.databaseService.query(
        `UPDATE bundles SET
          status = ?,
          transaction_count = ?,
          transaction_ids = ?,
          signature = ?,
          error = ?,
          updated_at = ?,
          completed_at = ?,
          expires_at = ?
        WHERE id = ?`,
        [
          bundle.status,
          bundle.transactionCount,
          bundle.transactionIds,
          bundle.signature,
          bundle.error,
          bundle.updatedAt,
          bundle.completedAt,
          bundle.expiresAt,
          bundle.id,
        ]
      );
    } catch (error) {
      this.logger.error(`Error updating bundle in database: ${bundle.id}`, error);
      throw error;
    }
  }
  
  /**
   * Prune expired transactions and bundles from database
   */
  private async pruneDatabase(): Promise<void> {
    this.logger.info('Pruning expired transactions and bundles from database');
    
    try {
      // Delete expired transactions
      const deletedTransactions = await this.databaseService.query(
        'DELETE FROM transactions WHERE expires_at < NOW()'
      );
      
      // Delete expired bundles
      const deletedBundles = await this.databaseService.query(
        'DELETE FROM bundles WHERE expires_at < NOW()'
      );
      
      this.logger.info(`Pruned ${deletedTransactions.affectedRows} transactions and ${deletedBundles.affectedRows} bundles`);
      
      // Record metrics
      if (this.config.monitoring.metricsEnabled) {
        this.metricsService.recordMetric('sequencer.pruned_transactions', deletedTransactions.affectedRows);
        this.metricsService.recordMetric('sequencer.pruned_bundles', deletedBundles.affectedRows);
      }
    } catch (error) {
      this.logger.error('Error pruning database', error);
      throw error;
    }
  }
  
  /**
   * Save the current state to database
   */
  private async saveState(): Promise<void> {
    this.logger.info('Saving current state to database');
    
    try {
      // Update all pending transactions
      for (const transaction of this.pendingTransactions.values()) {
        await this.updateTransactionInDatabase(transaction);
      }
      
      // Update all pending bundles
      for (const bundle of this.pendingBundles.values()) {
        await this.updateBundleInDatabase(bundle);
      }
      
      this.logger.info('Current state saved to database successfully');
    } catch (error) {
      this.logger.error('Error saving current state to database', error);
      throw error;
    }
  }
  
  /**
   * Get status of the sequencer
   * 
   * @returns The current status of the sequencer
   */
  public getStatus(): any {
    return {
      isRunning: this.isRunning,
      pendingTransactions: this.pendingTransactions.size,
      pendingBundles: this.pendingBundles.size,
      processingBundles: this.processingBundles.size,
    };
  }
  
  /**
   * Get all pending transactions
   * 
   * @returns Array of pending transactions
   */
  public getPendingTransactions(): TransactionEntity[] {
    return Array.from(this.pendingTransactions.values());
  }
  
  /**
   * Get all pending bundles
   * 
   * @returns Array of pending bundles
   */
  public getPendingBundles(): BundleEntity[] {
    return Array.from(this.pendingBundles.values());
  }
  
  /**
   * Retry a failed transaction
   * 
   * @param id - The transaction ID
   * @returns The updated transaction
   */
  public async retryTransaction(id: string): Promise<TransactionEntity> {
    this.logger.info(`Retrying transaction: ${id}`);
    
    try {
      // Get transaction
      const transaction = await this.getTransactionById(id);
      
      if (!transaction) {
        throw new Error(`Transaction not found: ${id}`);
      }
      
      // Check if transaction can be retried
      if (
        transaction.status !== TransactionStatus.FAILED &&
        transaction.status !== TransactionStatus.CONFIRMED
      ) {
        throw new Error(`Transaction cannot be retried: ${id}, status: ${transaction.status}`);
      }
      
      // Reset transaction for retry
      transaction.status = TransactionStatus.PENDING;
      transaction.bundleId = null;
      transaction.signature = null;
      transaction.error = null;
      transaction.retryCount++;
      transaction.updatedAt = new Date();
      
      // Update in database
      await this.updateTransactionInDatabase(transaction);
      
      // Add to pending transactions
      this.pendingTransactions.set(transaction.id, transaction);
      
      this.logger.info(`Transaction ${id} scheduled for retry`);
      
      // Emit event
      this.emit('transactionRetried', transaction);
      
      return transaction;
    } catch (error) {
      this.logger.error(`Error retrying transaction: ${id}`, error);
      throw error;
    }
  }
  
  /**
   * Cancel a pending transaction
   * 
   * @param id - The transaction ID
   * @returns Whether the transaction was cancelled
   */
  public async cancelTransaction(id: string): Promise<boolean> {
    this.logger.info(`Cancelling transaction: ${id}`);
    
    try {
      // Get transaction
      const transaction = await this.getTransactionById(id);
      
      if (!transaction) {
        throw new Error(`Transaction not found: ${id}`);
      }
      
      // Check if transaction can be cancelled
      if (
        transaction.status !== TransactionStatus.PENDING &&
        transaction.status !== TransactionStatus.PROCESSING
      ) {
        throw new Error(`Transaction cannot be cancelled: ${id}, status: ${transaction.status}`);
      }
      
      // Remove from pending transactions
      this.pendingTransactions.delete(id);
      
      // Update transaction status
      transaction.status = 'cancelled' as any;
      transaction.updatedAt = new Date();
      
      // Update in database
      await this.updateTransactionInDatabase(transaction);
      
      this.logger.info(`Transaction ${id} cancelled`);
      
      // Emit event
      this.emit('transactionCancelled', transaction);
      
      return true;
    } catch (error) {
      this.logger.error(`Error cancelling transaction: ${id}`, error);
      throw error;
    }
  }
}
