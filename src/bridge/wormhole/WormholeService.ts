// English comment for verification
/**
 * @file WormholeService.ts
 * @description Main service that integrates all Wormhole components
 * @author Manus AI
 * @date April 27, 2025
 */

import { Logger } from '../../utils/Logger';
import { MetricsService } from '../../monitoring/MetricsService';
import { MonitoringService } from '../../monitoring/MonitoringService';
import { ThreadPoolService } from '../../utils/ThreadPoolService';
import { CacheService } from '../../utils/CacheService';
import { DatabaseService } from '../../database/database.service';
import { WormholeConfig, DEFAULT_WORMHOLE_CONFIG, validateWormholeConfig } from './WormholeConfig';
import { WormholeRelayer } from './WormholeRelayer';
import { WormholeTokenBridge } from './WormholeTokenBridge';
import { WormholeVAA } from './WormholeVAA';
import { WormholeGuardian } from './WormholeGuardian';
import { EventEmitter } from 'events';
import { ChainId, CHAIN_ID_ETH, CHAIN_ID_SOLANA } from '@certusone/wormhole-sdk';

/**
 * Interface for token transfer parameters
 */
export interface TokenTransferParams {
  // Source token information
  tokenAddress: string;
  amount: string;
  
  // Recipient information
  recipientAddress: string;
  
  // Additional parameters
  fee?: string;
  nonce?: number;
}

/**
 * Interface for transaction status
 */
export interface TransactionStatus {
  id: string;
  status: string;
  sourceChain: ChainId;
  targetChain: ChainId;
  sourceTransaction?: string;
  targetTransaction?: string;
  sequence?: string;
  vaaHash?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

/**
 * WormholeService class - Main service that integrates all Wormhole components
 * for a complete cross-chain communication solution
 */
export class WormholeService extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: WormholeConfig;
  private readonly metricsService: MetricsService;
  private readonly monitoringService: MonitoringService;
  private readonly threadPoolService: ThreadPoolService;
  private readonly cacheService: CacheService;
  private readonly databaseService: DatabaseService;
  
  // Wormhole components
  private relayer: WormholeRelayer;
  private tokenBridge: WormholeTokenBridge;
  private vaaService: WormholeVAA;
  private guardianService: WormholeGuardian;
  
  // Service state
  private isInitialized: boolean = false;
  private isRunning: boolean = false;
  
  /**
   * Constructor for the WormholeService
   * 
   * @param databaseService - Database service for storing transaction data
   * @param metricsService - Metrics service for monitoring performance
   * @param monitoringService - Monitoring service for alerts and notifications
   * @param threadPoolService - Thread pool service for parallel processing
   * @param cacheService - Cache service for optimizing data access
   * @param logger - Logger instance
   * @param config - Configuration for the service
   */
  constructor(
    databaseService: DatabaseService,
    metricsService: MetricsService,
    monitoringService: MonitoringService,
    threadPoolService: ThreadPoolService,
    cacheService: CacheService,
    logger: Logger,
    config: Partial<WormholeConfig> = {}
  ) {
    super();
    
    this.databaseService = databaseService;
    this.metricsService = metricsService;
    this.monitoringService = monitoringService;
    this.threadPoolService = threadPoolService;
    this.cacheService = cacheService;
    this.logger = logger.createChild('WormholeService');
    
    // Merge provided config with defaults
    this.config = {
      ...DEFAULT_WORMHOLE_CONFIG,
      ...config,
    };
    
    // Initialize Wormhole components in the correct order
    this.guardianService = new WormholeGuardian(
      metricsService,
      cacheService,
      logger,
      this.config
    );
    
    this.vaaService = new WormholeVAA(
      cacheService,
      this.guardianService, // Pass guardian service for VAA verification
      logger,
      this.config
    );
    
    this.tokenBridge = new WormholeTokenBridge(
      this.vaaService, // Pass VAA service for token bridge operations
      metricsService,
      cacheService,
      logger,
      this.config
    );
    
    this.relayer = new WormholeRelayer(
      databaseService,
      metricsService,
      monitoringService,
      threadPoolService,
      cacheService,
      logger,
      this.config
    );
    
    this.logger.info('WormholeService created');
    
    // Forward events from components
    this.relayer.on('transactionCreated', (tx) => this.emit('transactionCreated', tx));
    this.relayer.on('transactionCompleted', (tx) => this.emit('transactionCompleted', tx));
    this.relayer.on('transactionFailed', (tx) => this.emit('transactionFailed', tx));
    this.tokenBridge.on('transferInitiated', (transfer) => this.emit('transferInitiated', transfer));
    this.tokenBridge.on('transferCompleted', (transfer) => this.emit('transferCompleted', transfer));
  }
  
  /**
   * Initialize the Wormhole service
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('WormholeService is already initialized');
      return;
    }
    
    this.logger.info('Initializing WormholeService');
    
    try {
      // Validate configuration
      const validation = validateWormholeConfig(this.config);
      if (!validation.valid) {
        throw new Error(`Invalid Wormhole configuration: ${validation.errors.join(', ')}`);
      }
      
      // Initialize components in the correct order
      await this.guardianService.initialize();
      // VAA service doesn't need explicit initialization
      await this.tokenBridge.initialize();
      await this.relayer.initialize();
      
      // Create database tables if they don't exist
      await this.createDatabaseTables();
      
      this.isInitialized = true;
      this.logger.info('WormholeService initialized successfully');
      this.emit('initialized');
    } catch (error) {
      this.logger.error('Failed to initialize WormholeService', error);
      throw new Error(`Failed to initialize WormholeService: ${error.message}`);
    }
  }
  
  /**
   * Create necessary database tables
   */
  private async createDatabaseTables(): Promise<void> {
    this.logger.info('Creating database tables');
    
    try {
      // Create bridge_transactions table
      await this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS bridge_transactions (
          id VARCHAR(255) PRIMARY KEY,
          type VARCHAR(50) NOT NULL,
          status VARCHAR(50) NOT NULL,
          source_chain INT NOT NULL,
          target_chain INT NOT NULL,
          source_token VARCHAR(255) NOT NULL,
          target_token VARCHAR(255),
          amount VARCHAR(255) NOT NULL,
          sender VARCHAR(255) NOT NULL,
          recipient VARCHAR(255) NOT NULL,
          source_transaction VARCHAR(255),
          target_transaction VARCHAR(255),
          sequence VARCHAR(255),
          vaa_hash VARCHAR(255),
          vaa TEXT,
          fee VARCHAR(255),
          nonce INT,
          error TEXT,
          retry_count INT DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP
        )
      `);
      
      // Create relayer_last_processed_blocks table
      await this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS relayer_last_processed_blocks (
          chain_id INT PRIMARY KEY,
          last_block BIGINT NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Create token_mappings table
      await this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS token_mappings (
          id VARCHAR(255) PRIMARY KEY,
          source_chain INT NOT NULL,
          target_chain INT NOT NULL,
          source_token VARCHAR(255) NOT NULL,
          target_token VARCHAR(255) NOT NULL,
          name VARCHAR(255),
          symbol VARCHAR(255),
          decimals INT,
          min_amount VARCHAR(255),
          max_amount VARCHAR(255),
          deposits_enabled BOOLEAN DEFAULT TRUE,
          withdrawals_enabled BOOLEAN DEFAULT TRUE,
          active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Create vaa_verification_logs table for auditing
      await this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS vaa_verification_logs (
          id VARCHAR(255) PRIMARY KEY,
          vaa_hash VARCHAR(255) NOT NULL,
          guardian_set_index INT NOT NULL,
          signatures_count INT NOT NULL,
          verified_signatures_count INT NOT NULL,
          required_signatures INT NOT NULL,
          is_valid BOOLEAN NOT NULL,
          verification_time BIGINT NOT NULL,
          error TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      this.logger.info('Database tables created successfully');
    } catch (error) {
      this.logger.error('Failed to create database tables', error);
      throw new Error(`Failed to create database tables: ${error.message}`);
    }
  }
  
  /**
   * Start the Wormhole service
   */
  public async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    if (this.isRunning) {
      this.logger.warn('WormholeService is already running');
      return;
    }
    
    this.logger.info('Starting WormholeService');
    
    try {
      // Start relayer
      await this.relayer.start();
      
      this.isRunning = true;
      this.logger.info('WormholeService started successfully');
      this.emit('started');
    } catch (error) {
      this.logger.error('Failed to start WormholeService', error);
      throw new Error(`Failed to start WormholeService: ${error.message}`);
    }
  }
  
  /**
   * Stop the Wormhole service
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('WormholeService is not running');
      return;
    }
    
    this.logger.info('Stopping WormholeService');
    
    try {
      // Stop relayer
      await this.relayer.stop();
      
      this.isRunning = false;
      this.logger.info('WormholeService stopped successfully');
      this.emit('stopped');
    } catch (error) {
      this.logger.error('Failed to stop WormholeService', error);
      throw new Error(`Failed to stop WormholeService: ${error.message}`);
    }
  }
  
  /**
   * Get the relayer component
   * 
   * @returns The WormholeRelayer instance
   */
  public getRelayer(): WormholeRelayer {
    return this.relayer;
  }
  
  /**
   * Get the token bridge component
   * 
   * @returns The WormholeTokenBridge instance
   */
  public getTokenBridge(): WormholeTokenBridge {
    return this.tokenBridge;
  }
  
  /**
   * Get the VAA service component
   * 
   * @returns The WormholeVAA instance
   */
  public getVAAService(): WormholeVAA {
    return this.vaaService;
  }
  
  /**
   * Get the guardian service component
   * 
   * @returns The WormholeGuardian instance
   */
  public getGuardianService(): WormholeGuardian {
    return this.guardianService;
  }
  
  /**
   * Transfer tokens from Ethereum to Solana
   * 
   * @param params - Token transfer parameters
   * @returns The transaction ID
   */
  public async transferFromEthereumToSolana(params: TokenTransferParams): Promise<string> {
    this.logger.info(`Transferring ${params.amount} of token ${params.tokenAddress} from Ethereum to Solana recipient ${params.recipientAddress}`);
    
    if (!this.isRunning) {
      throw new Error('WormholeService is not running');
    }
    
    try {
      // Create transaction record
      const txId = await this.createTransactionRecord({
        type: 'TRANSFER',
        status: 'INITIATED',
        sourceChain: CHAIN_ID_ETH,
        targetChain: CHAIN_ID_SOLANA,
        sourceToken: params.tokenAddress,
        amount: params.amount,
        sender: 'unknown', // Will be updated after transaction
        recipient: params.recipientAddress,
        fee: params.fee,
        nonce: params.nonce,
      });
      
      // Execute transfer
      const result = await this.tokenBridge.transferFromEthToSolana(
        params.tokenAddress,
        params.amount,
        params.recipientAddress,
        {
          fee: params.fee,
          nonce: params.nonce,
        }
      );
      
      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }
      
      // Update transaction record
      await this.updateTransactionRecord(txId, {
        status: 'PENDING',
        sourceTransaction: result.transactionHash,
        sequence: result.sequence,
      });
      
      return txId;
    } catch (error) {
      this.logger.error('Error transferring from Ethereum to Solana', error);
      throw new Error(`Error transferring from Ethereum to Solana: ${error.message}`);
    }
  }
  
  /**
   * Transfer tokens from Solana to Ethereum
   * 
   * @param params - Token transfer parameters
   * @returns The transaction ID
   */
  public async transferFromSolanaToEthereum(params: TokenTransferParams): Promise<string> {
    this.logger.info(`Transferring ${params.amount} of token ${params.tokenAddress} from Solana to Ethereum recipient ${params.recipientAddress}`);
    
    if (!this.isRunning) {
      throw new Error('WormholeService is not running');
    }
    
    try {
      // Create transaction record
      const txId = await this.createTransactionRecord({
        type: 'TRANSFER',
        status: 'INITIATED',
        sourceChain: CHAIN_ID_SOLANA,
        targetChain: CHAIN_ID_ETH,
        sourceToken: params.tokenAddress,
        amount: params.amount,
        sender: 'unknown', // Will be updated after transaction
        recipient: params.recipientAddress,
        fee: params.fee,
        nonce: params.nonce,
      });
      
      // Execute transfer
      const result = await this.tokenBridge.transferFromSolanaToEth(
        params.tokenAddress,
        params.amount,
        params.recipientAddress,
        {
          fee: params.fee,
          nonce: params.nonce,
        }
      );
      
      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }
      
      // Update transaction record
      await this.updateTransactionRecord(txId, {
        status: 'PENDING',
        sourceTransaction: result.transactionHash,
        sequence: result.sequence,
      });
      
      return txId;
    } catch (error) {
      this.logger.error('Error transferring from Solana to Ethereum', error);
      throw new Error(`Error transferring from Solana to Ethereum: ${error.message}`);
    }
  }
  
  /**
   * Verify a VAA and log the verification result
   * 
   * @param vaaBytes - The VAA bytes to verify
   * @returns Whether the VAA is valid
   */
  public async verifyAndLogVAA(vaaBytes: Buffer): Promise<boolean> {
    try {
      const startTime = Date.now();
      
      // Parse VAA
      const vaaData = this.vaaService.parseVAA(vaaBytes);
      
      // Get guardian set
      const guardianSet = await this.guardianService.getGuardianSet(vaaData.guardianSetIndex);
      
      // Get required signatures
      const requiredSignatures = await this.guardianService.getQuorumSize(vaaData.guardianSetIndex);
      
      // Verify VAA
      const isValid = await this.vaaService.verifyVAA(vaaData);
      
      const verificationTime = Date.now() - startTime;
      
      // Log verification result
      await this.databaseService.query(`
        INSERT INTO vaa_verification_logs (
          id, vaa_hash, guardian_set_index, signatures_count, 
          verified_signatures_count, required_signatures, 
          is_valid, verification_time, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        `vaa-verification-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
        vaaData.hash,
        vaaData.guardianSetIndex,
        vaaData.signatures.length,
        vaaData.signatures.length, // In a real implementation, we would count verified signatures
        requiredSignatures,
        isValid,
        verificationTime,
      ]);
      
      // Record metrics
      this.metricsService.recordMetric('wormhole.vaa_verification', {
        valid: isValid,
        verificationTime,
        guardianSetIndex: vaaData.guardianSetIndex,
        signaturesCount: vaaData.signatures.length,
        requiredSignatures,
      });
      
      return isValid;
    } catch (error) {
      this.logger.error('Error verifying VAA', error);
      
      // Log verification error
      await this.databaseService.query(`
        INSERT INTO vaa_verification_logs (
          id, vaa_hash, guardian_set_index, signatures_count, 
          verified_signatures_count, required_signatures, 
          is_valid, verification_time, error, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        `vaa-verification-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
        'unknown',
        0,
        0,
        0,
        0,
        false,
        0,
        error.message,
      ]);
      
      // Record error metric
      this.metricsService.recordMetric('wormhole.vaa_verification_errors', 1);
      
      return false;
    }
  }
  
  /**
   * Create a transaction record
   * 
   * @param data - Transaction data
   * @returns The transaction ID
   */
  private async createTransactionRecord(data: any): Promise<string> {
    const id = `tx-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    
    await this.databaseService.query(`
      INSERT INTO bridge_transactions (
        id, type, status, source_chain, target_chain, 
        source_token, amount, sender, recipient, 
        fee, nonce, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      id,
      data.type,
      data.status,
      data.sourceChain,
      data.targetChain,
      data.sourceToken,
      data.amount,
      data.sender,
      data.recipient,
      data.fee || null,
      data.nonce || null,
    ]);
    
    return id;
  }
  
  /**
   * Update a transaction record
   * 
   * @param id - Transaction ID
   * @param data - Updated transaction data
   */
  private async updateTransactionRecord(id: string, data: any): Promise<void> {
    let query = 'UPDATE bridge_transactions SET updated_at = CURRENT_TIMESTAMP';
    const params = [];
    
    // Add fields to update
    for (const [key, value] of Object.entries(data)) {
      // Convert camelCase to snake_case
      const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      query += `, ${snakeKey} = ?`;
      params.push(value);
    }
    
    // Add WHERE clause
    query += ' WHERE id = ?';
    params.push(id);
    
    await this.databaseService.query(query, params);
  }
  
  /**
   * Get transaction by ID
   * 
   * @param id - The transaction ID
   * @returns The transaction if found, null otherwise
   */
  public async getTransactionById(id: string): Promise<TransactionStatus | null> {
    const result = await this.databaseService.query(`
      SELECT * FROM bridge_transactions WHERE id = ?
    `, [id]);
    
    if (result.length === 0) {
      return null;
    }
    
    const tx = result[0];
    
    // If transaction is pending, check status from token bridge
    if (tx.status === 'PENDING' && tx.sequence) {
      try {
        const status = await this.tokenBridge.getTransferStatus(
          tx.source_chain,
          tx.target_chain,
          tx.sequence
        );
        
        if (status.status === 'COMPLETED' && !tx.target_transaction) {
          // Update transaction
          await this.updateTransactionRecord(id, {
            status: 'COMPLETED',
            targetTransaction: status.targetTransaction,
            completedAt: new Date(),
          });
          
          tx.status = 'COMPLETED';
          tx.target_transaction = status.targetTransaction;
          tx.completed_at = new Date();
        } else if (status.status === 'FAILED' && tx.status !== 'FAILED') {
          // Update transaction
          await this.updateTransactionRecord(id, {
            status: 'FAILED',
            error: 'Transfer failed on target chain',
          });
          
          tx.status = 'FAILED';
          tx.error = 'Transfer failed on target chain';
        }
      } catch (error) {
        this.logger.warn(`Error checking transfer status for ${id}`, error);
      }
    }
    
    return {
      id: tx.id,
      status: tx.status,
      sourceChain: tx.source_chain,
      targetChain: tx.target_chain,
      sourceTransaction: tx.source_transaction,
      targetTransaction: tx.target_transaction,
      sequence: tx.sequence,
      vaaHash: tx.vaa_hash,
      error: tx.error,
      createdAt: new Date(tx.created_at),
      updatedAt: new Date(tx.updated_at),
      completedAt: tx.completed_at ? new Date(tx.completed_at) : undefined,
    };
  }
  
  /**
   * Get transactions by status
   * 
   * @param status - The transaction status
   * @param limit - Maximum number of transactions to return
   * @param offset - Offset for pagination
   * @returns Array of transactions with the specified status
   */
  public async getTransactionsByStatus(
    status: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<TransactionStatus[]> {
    const result = await this.databaseService.query(`
      SELECT * FROM bridge_transactions 
      WHERE status = ? 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `, [status, limit, offset]);
    
    return result.map(tx => ({
      id: tx.id,
      status: tx.status,
      sourceChain: tx.source_chain,
      targetChain: tx.target_chain,
      sourceTransaction: tx.source_transaction,
      targetTransaction: tx.target_transaction,
      sequence: tx.sequence,
      vaaHash: tx.vaa_hash,
      error: tx.error,
      createdAt: new Date(tx.created_at),
      updatedAt: new Date(tx.updated_at),
      completedAt: tx.completed_at ? new Date(tx.completed_at) : undefined,
    }));
  }
  
  /**
   * Retry a failed transaction
   * 
   * @param id - The transaction ID
   * @returns The updated transaction
   */
  public async retryTransaction(id: string): Promise<TransactionStatus> {
    const tx = await this.getTransactionById(id);
    
    if (!tx) {
      throw new Error(`Transaction ${id} not found`);
    }
    
    if (tx.status !== 'FAILED') {
      throw new Error(`Transaction ${id} is not failed (status: ${tx.status})`);
    }
    
    // Update transaction status
    await this.updateTransactionRecord(id, {
      status: 'RETRYING',
      error: null,
    });
    
    // Queue transaction for retry
    await this.relayer.queueTransactionForRetry(id);
    
    // Get updated transaction
    return this.getTransactionById(id);
  }
  
  /**
   * Get status of the Wormhole service
   * 
   * @returns The current status of the service
   */
  public async getStatus(): Promise<any> {
    const relayerStatus = await this.relayer.getStatus();
    const guardianStatus = await this.guardianService.getStatus();
    
    // Get transaction counts
    const [
      totalTransactions,
      pendingTransactions,
      completedTransactions,
      failedTransactions,
    ] = await Promise.all([
      this.databaseService.query('SELECT COUNT(*) as count FROM bridge_transactions'),
      this.databaseService.query('SELECT COUNT(*) as count FROM bridge_transactions WHERE status = ?', ['PENDING']),
      this.databaseService.query('SELECT COUNT(*) as count FROM bridge_transactions WHERE status = ?', ['COMPLETED']),
      this.databaseService.query('SELECT COUNT(*) as count FROM bridge_transactions WHERE status = ?', ['FAILED']),
    ]);
    
    // Get VAA verification stats
    const [
      totalVerifications,
      successfulVerifications,
      failedVerifications,
      averageVerificationTime,
    ] = await Promise.all([
      this.databaseService.query('SELECT COUNT(*) as count FROM vaa_verification_logs'),
      this.databaseService.query('SELECT COUNT(*) as count FROM vaa_verification_logs WHERE is_valid = ?', [true]),
      this.databaseService.query('SELECT COUNT(*) as count FROM vaa_verification_logs WHERE is_valid = ?', [false]),
      this.databaseService.query('SELECT AVG(verification_time) as avg FROM vaa_verification_logs'),
    ]);
    
    return {
      isInitialized: this.isInitialized,
      isRunning: this.isRunning,
      transactions: {
        total: totalTransactions[0].count,
        pending: pendingTransactions[0].count,
        completed: completedTransactions[0].count,
        failed: failedTransactions[0].count,
      },
      vaaVerification: {
        total: totalVerifications[0].count,
        successful: successfulVerifications[0].count,
        failed: failedVerifications[0].count,
        averageTime: averageVerificationTime[0].avg,
      },
      relayer: relayerStatus,
      guardian: guardianStatus,
    };
  }
}
