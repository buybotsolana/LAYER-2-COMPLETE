// English comment for verification
/**
 * @file WormholeRelayer.ts
 * @description Complete implementation of Wormhole Relayer for cross-chain communication
 * @author Manus AI
 * @date April 27, 2025
 */

import {
  ChainId,
  CHAIN_ID_ETH,
  CHAIN_ID_SOLANA,
  getEmitterAddressEth,
  getEmitterAddressSolana,
  parseSequenceFromLogEth,
  parseSequenceFromLogSolana,
  getSignedVAA,
  redeemOnSolana,
  redeemOnEth,
  postVaaSolana,
  postVaaEth,
} from '@certusone/wormhole-sdk';
import { Connection, PublicKey, Transaction, Keypair, sendAndConfirmTransaction } from '@solana/web3.js';
import { ethers } from 'ethers';
import { Logger } from '../utils/Logger';
import { MetricsService } from '../monitoring/MetricsService';
import { MonitoringService } from '../monitoring/MonitoringService';
import { ThreadPoolService } from '../utils/ThreadPoolService';
import { CacheService } from '../utils/CacheService';
import { DatabaseService } from '../database/database.service';
import { BridgeTransaction, BridgeTransactionStatus, BridgeTransactionType } from '../models/BridgeTransaction';
import { TokenMapping } from '../models/TokenMapping';
import { EventEmitter } from 'events';

/**
 * Configuration interface for the Wormhole Relayer
 */
interface WormholeRelayerConfig {
  // Ethereum configuration
  ethereumRpc: string;
  ethereumPrivateKey: string;
  ethereumBridgeAddress: string;
  ethereumTokenBridgeAddress: string;
  
  // Solana configuration
  solanaRpc: string;
  solanaPrivateKey: string;
  solanaBridgeAddress: string;
  solanaTokenBridgeAddress: string;
  
  // Wormhole configuration
  wormholeRpc: string;
  guardianSetIndex: number;
  
  // Relayer configuration
  pollingInterval: number;
  maxRetries: number;
  retryDelay: number;
  confirmations: {
    ethereum: number;
    solana: number;
  };
  
  // Performance configuration
  maxConcurrentTransactions: number;
  batchSize: number;
  
  // Monitoring configuration
  metricsEnabled: boolean;
  alertThresholds: {
    processingTime: number;
    errorRate: number;
    pendingTransactions: number;
  };
}

/**
 * Default configuration for the Wormhole Relayer
 */
const DEFAULT_CONFIG: WormholeRelayerConfig = {
  ethereumRpc: 'https://mainnet.infura.io/v3/your-infura-key',
  ethereumPrivateKey: '',
  ethereumBridgeAddress: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B',
  ethereumTokenBridgeAddress: '0x3ee18B2214AFF97000D974cf647E7C347E8fa585',
  
  solanaRpc: 'https://api.mainnet-beta.solana.com',
  solanaPrivateKey: '',
  solanaBridgeAddress: 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth',
  solanaTokenBridgeAddress: 'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb',
  
  wormholeRpc: 'https://wormhole-v2-mainnet-api.certus.one',
  guardianSetIndex: 2,
  
  pollingInterval: 15000, // 15 seconds
  maxRetries: 5,
  retryDelay: 10000, // 10 seconds
  confirmations: {
    ethereum: 15,
    solana: 32,
  },
  
  maxConcurrentTransactions: 10,
  batchSize: 20,
  
  metricsEnabled: true,
  alertThresholds: {
    processingTime: 60000, // 60 seconds
    errorRate: 0.1, // 10%
    pendingTransactions: 100,
  },
};

/**
 * WormholeRelayer class - Handles cross-chain communication between Ethereum and Solana
 * using Wormhole protocol
 */
export class WormholeRelayer extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: WormholeRelayerConfig;
  private readonly metricsService: MetricsService;
  private readonly monitoringService: MonitoringService;
  private readonly threadPoolService: ThreadPoolService;
  private readonly cacheService: CacheService;
  private readonly databaseService: DatabaseService;
  
  // Blockchain connections
  private ethereumProvider: ethers.providers.JsonRpcProvider;
  private ethereumWallet: ethers.Wallet;
  private solanaConnection: Connection;
  private solanaWallet: Keypair;
  
  // Internal state
  private isRunning: boolean = false;
  private pollingIntervalId: NodeJS.Timeout | null = null;
  private pendingTransactions: Map<string, BridgeTransaction> = new Map();
  private processedSequences: Set<string> = new Set();
  private lastProcessedBlockEthereum: number = 0;
  private lastProcessedBlockSolana: number = 0;
  
  /**
   * Constructor for the WormholeRelayer
   * 
   * @param databaseService - Database service for storing transaction data
   * @param metricsService - Metrics service for monitoring performance
   * @param monitoringService - Monitoring service for alerts and notifications
   * @param threadPoolService - Thread pool service for parallel processing
   * @param cacheService - Cache service for optimizing data access
   * @param logger - Logger instance
   * @param config - Configuration for the relayer
   */
  constructor(
    databaseService: DatabaseService,
    metricsService: MetricsService,
    monitoringService: MonitoringService,
    threadPoolService: ThreadPoolService,
    cacheService: CacheService,
    logger: Logger,
    config: Partial<WormholeRelayerConfig> = {}
  ) {
    super();
    
    this.databaseService = databaseService;
    this.metricsService = metricsService;
    this.monitoringService = monitoringService;
    this.threadPoolService = threadPoolService;
    this.cacheService = cacheService;
    this.logger = logger.createChild('WormholeRelayer');
    
    // Merge provided config with defaults
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
    
    // Initialize blockchain connections
    this.ethereumProvider = new ethers.providers.JsonRpcProvider(this.config.ethereumRpc);
    this.ethereumWallet = new ethers.Wallet(this.config.ethereumPrivateKey, this.ethereumProvider);
    this.solanaConnection = new Connection(this.config.solanaRpc, 'confirmed');
    this.solanaWallet = Keypair.fromSecretKey(Buffer.from(this.config.solanaPrivateKey, 'hex'));
    
    this.logger.info('WormholeRelayer initialized');
  }
  
  /**
   * Start the relayer service
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('WormholeRelayer is already running');
      return;
    }
    
    this.logger.info('Starting WormholeRelayer');
    
    try {
      // Initialize blockchain connections
      await this.initializeConnections();
      
      // Load last processed blocks from database
      await this.loadLastProcessedBlocks();
      
      // Load pending transactions from database
      await this.loadPendingTransactions();
      
      // Start polling for new events
      this.startPolling();
      
      this.isRunning = true;
      this.logger.info('WormholeRelayer started successfully');
      this.emit('started');
    } catch (error) {
      this.logger.error('Failed to start WormholeRelayer', error);
      throw error;
    }
  }
  
  /**
   * Stop the relayer service
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('WormholeRelayer is not running');
      return;
    }
    
    this.logger.info('Stopping WormholeRelayer');
    
    try {
      // Stop polling
      this.stopPolling();
      
      // Save current state to database
      await this.saveState();
      
      this.isRunning = false;
      this.logger.info('WormholeRelayer stopped successfully');
      this.emit('stopped');
    } catch (error) {
      this.logger.error('Failed to stop WormholeRelayer', error);
      throw error;
    }
  }
  
  /**
   * Initialize blockchain connections
   */
  private async initializeConnections(): Promise<void> {
    this.logger.info('Initializing blockchain connections');
    
    try {
      // Test Ethereum connection
      const ethereumBlockNumber = await this.ethereumProvider.getBlockNumber();
      this.logger.info(`Connected to Ethereum, current block: ${ethereumBlockNumber}`);
      
      // Test Solana connection
      const solanaBlockHeight = await this.solanaConnection.getBlockHeight();
      this.logger.info(`Connected to Solana, current block: ${solanaBlockHeight}`);
      
      // Record metrics
      if (this.config.metricsEnabled) {
        this.metricsService.recordMetric('wormhole.ethereum.block_height', ethereumBlockNumber);
        this.metricsService.recordMetric('wormhole.solana.block_height', solanaBlockHeight);
      }
    } catch (error) {
      this.logger.error('Failed to initialize blockchain connections', error);
      throw error;
    }
  }
  
  /**
   * Load last processed blocks from database
   */
  private async loadLastProcessedBlocks(): Promise<void> {
    this.logger.info('Loading last processed blocks from database');
    
    try {
      // Query database for last processed blocks
      const lastProcessedBlocks = await this.databaseService.query(
        'SELECT chain_id, last_block FROM relayer_last_processed_blocks'
      );
      
      // Set last processed blocks
      for (const row of lastProcessedBlocks) {
        if (row.chain_id === CHAIN_ID_ETH) {
          this.lastProcessedBlockEthereum = row.last_block;
          this.logger.info(`Last processed Ethereum block: ${this.lastProcessedBlockEthereum}`);
        } else if (row.chain_id === CHAIN_ID_SOLANA) {
          this.lastProcessedBlockSolana = row.last_block;
          this.logger.info(`Last processed Solana block: ${this.lastProcessedBlockSolana}`);
        }
      }
      
      // If no records found, use current block heights
      if (this.lastProcessedBlockEthereum === 0) {
        this.lastProcessedBlockEthereum = await this.ethereumProvider.getBlockNumber();
        this.logger.info(`No last processed Ethereum block found, starting from current block: ${this.lastProcessedBlockEthereum}`);
      }
      
      if (this.lastProcessedBlockSolana === 0) {
        this.lastProcessedBlockSolana = await this.solanaConnection.getBlockHeight();
        this.logger.info(`No last processed Solana block found, starting from current block: ${this.lastProcessedBlockSolana}`);
      }
    } catch (error) {
      this.logger.error('Failed to load last processed blocks', error);
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
        'SELECT * FROM bridge_transactions WHERE status IN (?, ?)',
        [BridgeTransactionStatus.PENDING, BridgeTransactionStatus.PROCESSING]
      );
      
      // Add pending transactions to memory
      for (const tx of pendingTransactions) {
        const bridgeTx = new BridgeTransaction(tx);
        this.pendingTransactions.set(bridgeTx.id, bridgeTx);
      }
      
      this.logger.info(`Loaded ${this.pendingTransactions.size} pending transactions`);
      
      // Record metrics
      if (this.config.metricsEnabled) {
        this.metricsService.recordMetric('wormhole.pending_transactions', this.pendingTransactions.size);
      }
    } catch (error) {
      this.logger.error('Failed to load pending transactions', error);
      throw error;
    }
  }
  
  /**
   * Start polling for new events
   */
  private startPolling(): void {
    this.logger.info(`Starting polling with interval: ${this.config.pollingInterval}ms`);
    
    // Clear any existing interval
    this.stopPolling();
    
    // Start new polling interval
    this.pollingIntervalId = setInterval(async () => {
      try {
        await this.pollForNewEvents();
      } catch (error) {
        this.logger.error('Error during polling', error);
        
        // Record error metric
        if (this.config.metricsEnabled) {
          this.metricsService.recordMetric('wormhole.polling_errors', 1);
        }
        
        // Send alert if error rate exceeds threshold
        const errorRate = this.metricsService.getLatestValue('wormhole.polling_errors') || 0;
        if (errorRate > this.config.alertThresholds.errorRate) {
          this.monitoringService.sendAlert({
            level: 'error',
            source: 'WormholeRelayer',
            message: 'High error rate in polling',
            details: {
              errorRate,
              threshold: this.config.alertThresholds.errorRate,
            },
          });
        }
      }
    }, this.config.pollingInterval);
    
    this.logger.info('Polling started');
  }
  
  /**
   * Stop polling for new events
   */
  private stopPolling(): void {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
      this.logger.info('Polling stopped');
    }
  }
  
  /**
   * Poll for new events on both chains
   */
  private async pollForNewEvents(): Promise<void> {
    const startTime = Date.now();
    this.logger.debug('Polling for new events');
    
    try {
      // Process pending transactions first
      await this.processPendingTransactions();
      
      // Poll for new events on Ethereum
      await this.pollEthereumEvents();
      
      // Poll for new events on Solana
      await this.pollSolanaEvents();
      
      // Record metrics
      if (this.config.metricsEnabled) {
        const processingTime = Date.now() - startTime;
        this.metricsService.recordMetric('wormhole.polling_time', processingTime);
        
        // Send alert if processing time exceeds threshold
        if (processingTime > this.config.alertThresholds.processingTime) {
          this.monitoringService.sendAlert({
            level: 'warning',
            source: 'WormholeRelayer',
            message: 'Polling processing time exceeded threshold',
            details: {
              processingTime,
              threshold: this.config.alertThresholds.processingTime,
            },
          });
        }
      }
    } catch (error) {
      this.logger.error('Error during polling', error);
      throw error;
    }
  }
  
  /**
   * Process pending transactions
   */
  private async processPendingTransactions(): Promise<void> {
    if (this.pendingTransactions.size === 0) {
      return;
    }
    
    this.logger.info(`Processing ${this.pendingTransactions.size} pending transactions`);
    
    // Create batches of transactions to process concurrently
    const batches: BridgeTransaction[][] = [];
    const transactions = Array.from(this.pendingTransactions.values());
    
    for (let i = 0; i < transactions.length; i += this.config.batchSize) {
      batches.push(transactions.slice(i, i + this.config.batchSize));
    }
    
    // Process each batch
    for (const batch of batches) {
      // Use thread pool to process transactions concurrently
      await this.threadPoolService.submitTask(async () => {
        const promises = batch.map(tx => this.processTransaction(tx));
        await Promise.all(promises);
      });
    }
    
    // Record metrics
    if (this.config.metricsEnabled) {
      this.metricsService.recordMetric('wormhole.pending_transactions', this.pendingTransactions.size);
      
      // Send alert if pending transactions exceed threshold
      if (this.pendingTransactions.size > this.config.alertThresholds.pendingTransactions) {
        this.monitoringService.sendAlert({
          level: 'warning',
          source: 'WormholeRelayer',
          message: 'Pending transactions exceeded threshold',
          details: {
            pendingTransactions: this.pendingTransactions.size,
            threshold: this.config.alertThresholds.pendingTransactions,
          },
        });
      }
    }
  }
  
  /**
   * Process a single transaction
   * 
   * @param transaction - The transaction to process
   */
  private async processTransaction(transaction: BridgeTransaction): Promise<void> {
    const startTime = Date.now();
    this.logger.info(`Processing transaction ${transaction.id}`);
    
    try {
      // Update transaction status
      transaction.status = BridgeTransactionStatus.PROCESSING;
      await this.updateTransactionInDatabase(transaction);
      
      // Process based on transaction type
      if (transaction.type === BridgeTransactionType.DEPOSIT) {
        // Ethereum to Solana
        await this.processDepositTransaction(transaction);
      } else if (transaction.type === BridgeTransactionType.WITHDRAWAL) {
        // Solana to Ethereum
        await this.processWithdrawalTransaction(transaction);
      } else {
        throw new Error(`Unknown transaction type: ${transaction.type}`);
      }
      
      // Record metrics
      if (this.config.metricsEnabled) {
        const processingTime = Date.now() - startTime;
        this.metricsService.recordMetric('wormhole.transaction_processing_time', processingTime, {
          type: transaction.type,
        });
      }
    } catch (error) {
      this.logger.error(`Error processing transaction ${transaction.id}`, error);
      
      // Update transaction with error
      transaction.status = BridgeTransactionStatus.ERROR;
      transaction.error = error.message;
      await this.updateTransactionInDatabase(transaction);
      
      // Record error metric
      if (this.config.metricsEnabled) {
        this.metricsService.recordMetric('wormhole.transaction_errors', 1, {
          type: transaction.type,
        });
      }
    }
  }
  
  /**
   * Process a deposit transaction (Ethereum to Solana)
   * 
   * @param transaction - The deposit transaction to process
   */
  private async processDepositTransaction(transaction: BridgeTransaction): Promise<void> {
    this.logger.info(`Processing deposit transaction ${transaction.id}`);
    
    try {
      // Check if VAA is already available
      if (!transaction.vaa) {
        // Get the VAA from Wormhole
        const vaa = await this.getSignedVAA(
          CHAIN_ID_ETH,
          transaction.sourceTransaction,
          transaction.sequence
        );
        
        // Update transaction with VAA
        transaction.vaa = Buffer.from(vaa).toString('base64');
        await this.updateTransactionInDatabase(transaction);
      }
      
      // Parse VAA
      const vaaBuffer = Buffer.from(transaction.vaa, 'base64');
      
      // Post VAA to Solana
      await this.postVAAToSolana(vaaBuffer);
      
      // Redeem VAA on Solana
      const redeemTx = await this.redeemVAAOnSolana(vaaBuffer, transaction);
      
      // Update transaction as completed
      transaction.status = BridgeTransactionStatus.COMPLETED;
      transaction.destinationTransaction = redeemTx;
      transaction.completedAt = new Date();
      await this.updateTransactionInDatabase(transaction);
      
      // Remove from pending transactions
      this.pendingTransactions.delete(transaction.id);
      
      this.logger.info(`Deposit transaction ${transaction.id} completed successfully`);
      
      // Emit event
      this.emit('transactionCompleted', transaction);
    } catch (error) {
      this.logger.error(`Error processing deposit transaction ${transaction.id}`, error);
      
      // Check if we should retry
      if (transaction.retryCount < this.config.maxRetries) {
        transaction.retryCount++;
        transaction.status = BridgeTransactionStatus.PENDING;
        transaction.error = error.message;
        await this.updateTransactionInDatabase(transaction);
        
        this.logger.info(`Scheduled retry ${transaction.retryCount}/${this.config.maxRetries} for transaction ${transaction.id}`);
      } else {
        // Max retries reached, mark as failed
        transaction.status = BridgeTransactionStatus.FAILED;
        transaction.error = error.message;
        await this.updateTransactionInDatabase(transaction);
        
        // Remove from pending transactions
        this.pendingTransactions.delete(transaction.id);
        
        this.logger.error(`Deposit transaction ${transaction.id} failed after ${this.config.maxRetries} retries`);
        
        // Emit event
        this.emit('transactionFailed', transaction);
      }
      
      throw error;
    }
  }
  
  /**
   * Process a withdrawal transaction (Solana to Ethereum)
   * 
   * @param transaction - The withdrawal transaction to process
   */
  private async processWithdrawalTransaction(transaction: BridgeTransaction): Promise<void> {
    this.logger.info(`Processing withdrawal transaction ${transaction.id}`);
    
    try {
      // Check if VAA is already available
      if (!transaction.vaa) {
        // Get the VAA from Wormhole
        const vaa = await this.getSignedVAA(
          CHAIN_ID_SOLANA,
          transaction.sourceTransaction,
          transaction.sequence
        );
        
        // Update transaction with VAA
        transaction.vaa = Buffer.from(vaa).toString('base64');
        await this.updateTransactionInDatabase(transaction);
      }
      
      // Parse VAA
      const vaaBuffer = Buffer.from(transaction.vaa, 'base64');
      
      // Redeem VAA on Ethereum
      const redeemTx = await this.redeemVAAOnEthereum(vaaBuffer, transaction);
      
      // Update transaction as completed
      transaction.status = BridgeTransactionStatus.COMPLETED;
      transaction.destinationTransaction = redeemTx;
      transaction.completedAt = new Date();
      await this.updateTransactionInDatabase(transaction);
      
      // Remove from pending transactions
      this.pendingTransactions.delete(transaction.id);
      
      this.logger.info(`Withdrawal transaction ${transaction.id} completed successfully`);
      
      // Emit event
      this.emit('transactionCompleted', transaction);
    } catch (error) {
      this.logger.error(`Error processing withdrawal transaction ${transaction.id}`, error);
      
      // Check if we should retry
      if (transaction.retryCount < this.config.maxRetries) {
        transaction.retryCount++;
        transaction.status = BridgeTransactionStatus.PENDING;
        transaction.error = error.message;
        await this.updateTransactionInDatabase(transaction);
        
        this.logger.info(`Scheduled retry ${transaction.retryCount}/${this.config.maxRetries} for transaction ${transaction.id}`);
      } else {
        // Max retries reached, mark as failed
        transaction.status = BridgeTransactionStatus.FAILED;
        transaction.error = error.message;
        await this.updateTransactionInDatabase(transaction);
        
        // Remove from pending transactions
        this.pendingTransactions.delete(transaction.id);
        
        this.logger.error(`Withdrawal transaction ${transaction.id} failed after ${this.config.maxRetries} retries`);
        
        // Emit event
        this.emit('transactionFailed', transaction);
      }
      
      throw error;
    }
  }
  
  /**
   * Poll for new events on Ethereum
   */
  private async pollEthereumEvents(): Promise<void> {
    this.logger.debug('Polling for new Ethereum events');
    
    try {
      // Get current block number
      const currentBlock = await this.ethereumProvider.getBlockNumber();
      
      // Calculate from block (with safety margin)
      const fromBlock = Math.max(this.lastProcessedBlockEthereum - 10, 0);
      
      // Calculate to block (with confirmations)
      const toBlock = currentBlock - this.config.confirmations.ethereum;
      
      // Skip if no new blocks to process
      if (fromBlock >= toBlock) {
        this.logger.debug('No new Ethereum blocks to process');
        return;
      }
      
      this.logger.info(`Processing Ethereum blocks from ${fromBlock} to ${toBlock}`);
      
      // Get logs from Ethereum bridge contract
      const bridgeContract = new ethers.Contract(
        this.config.ethereumBridgeAddress,
        ['event LogMessagePublished(address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel)'],
        this.ethereumProvider
      );
      
      const logs = await bridgeContract.queryFilter(
        bridgeContract.filters.LogMessagePublished(),
        fromBlock,
        toBlock
      );
      
      this.logger.info(`Found ${logs.length} new Ethereum events`);
      
      // Process each log
      for (const log of logs) {
        await this.processEthereumLog(log);
      }
      
      // Update last processed block
      this.lastProcessedBlockEthereum = toBlock;
      await this.saveLastProcessedBlock(CHAIN_ID_ETH, toBlock);
      
      // Record metrics
      if (this.config.metricsEnabled) {
        this.metricsService.recordMetric('wormhole.ethereum.processed_events', logs.length);
        this.metricsService.recordMetric('wormhole.ethereum.last_processed_block', toBlock);
      }
    } catch (error) {
      this.logger.error('Error polling Ethereum events', error);
      throw error;
    }
  }
  
  /**
   * Process a log from Ethereum
   * 
   * @param log - The Ethereum log to process
   */
  private async processEthereumLog(log: ethers.providers.Log): Promise<void> {
    try {
      // Parse sequence from log
      const sequence = parseSequenceFromLogEth(log);
      
      // Create unique identifier for this event
      const eventId = `eth-${log.blockNumber}-${log.transactionHash}-${sequence}`;
      
      // Skip if already processed
      if (this.processedSequences.has(eventId)) {
        this.logger.debug(`Skipping already processed Ethereum event: ${eventId}`);
        return;
      }
      
      this.logger.info(`Processing Ethereum event: ${eventId}`);
      
      // Get emitter address
      const emitterAddress = getEmitterAddressEth(this.config.ethereumTokenBridgeAddress);
      
      // Check if this is a token bridge event
      if (log.address.toLowerCase() === this.config.ethereumBridgeAddress.toLowerCase()) {
        // Get VAA
        const vaa = await this.getSignedVAA(
          CHAIN_ID_ETH,
          log.transactionHash,
          sequence
        );
        
        // Create bridge transaction
        const transaction = new BridgeTransaction({
          id: eventId,
          type: BridgeTransactionType.DEPOSIT,
          status: BridgeTransactionStatus.PENDING,
          sourceChain: CHAIN_ID_ETH,
          targetChain: CHAIN_ID_SOLANA,
          sourceTransaction: log.transactionHash,
          sequence: sequence.toString(),
          vaa: Buffer.from(vaa).toString('base64'),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        
        // Save to database
        await this.createTransactionInDatabase(transaction);
        
        // Add to pending transactions
        this.pendingTransactions.set(transaction.id, transaction);
        
        this.logger.info(`Created new deposit transaction: ${transaction.id}`);
        
        // Emit event
        this.emit('transactionCreated', transaction);
      }
      
      // Mark as processed
      this.processedSequences.add(eventId);
    } catch (error) {
      this.logger.error(`Error processing Ethereum log: ${log.transactionHash}`, error);
      throw error;
    }
  }
  
  /**
   * Poll for new events on Solana
   */
  private async pollSolanaEvents(): Promise<void> {
    this.logger.debug('Polling for new Solana events');
    
    try {
      // Get current block height
      const currentBlock = await this.solanaConnection.getBlockHeight();
      
      // Calculate to block (with confirmations)
      const toBlock = currentBlock - this.config.confirmations.solana;
      
      // Skip if no new blocks to process
      if (this.lastProcessedBlockSolana >= toBlock) {
        this.logger.debug('No new Solana blocks to process');
        return;
      }
      
      this.logger.info(`Processing Solana blocks from ${this.lastProcessedBlockSolana} to ${toBlock}`);
      
      // Get signatures for bridge program
      const signatures = await this.solanaConnection.getSignaturesForAddress(
        new PublicKey(this.config.solanaBridgeAddress),
        {
          limit: 100,
          until: this.lastProcessedBlockSolana.toString(),
        }
      );
      
      this.logger.info(`Found ${signatures.length} new Solana transactions`);
      
      // Process each signature
      for (const signature of signatures) {
        await this.processSolanaSignature(signature.signature);
      }
      
      // Update last processed block
      this.lastProcessedBlockSolana = toBlock;
      await this.saveLastProcessedBlock(CHAIN_ID_SOLANA, toBlock);
      
      // Record metrics
      if (this.config.metricsEnabled) {
        this.metricsService.recordMetric('wormhole.solana.processed_events', signatures.length);
        this.metricsService.recordMetric('wormhole.solana.last_processed_block', toBlock);
      }
    } catch (error) {
      this.logger.error('Error polling Solana events', error);
      throw error;
    }
  }
  
  /**
   * Process a signature from Solana
   * 
   * @param signature - The Solana transaction signature to process
   */
  private async processSolanaSignature(signature: string): Promise<void> {
    try {
      // Get transaction
      const transaction = await this.solanaConnection.getTransaction(signature, {
        commitment: 'confirmed',
      });
      
      if (!transaction) {
        this.logger.warn(`Transaction not found for signature: ${signature}`);
        return;
      }
      
      // Create unique identifier for this event
      const eventId = `solana-${transaction.slot}-${signature}`;
      
      // Skip if already processed
      if (this.processedSequences.has(eventId)) {
        this.logger.debug(`Skipping already processed Solana event: ${eventId}`);
        return;
      }
      
      this.logger.info(`Processing Solana event: ${eventId}`);
      
      // Check if this is a token bridge event
      if (transaction.meta && transaction.meta.logMessages) {
        const isTokenBridgeEvent = transaction.meta.logMessages.some(
          log => log.includes(this.config.solanaTokenBridgeAddress)
        );
        
        if (isTokenBridgeEvent) {
          // Parse sequence from transaction
          const sequence = parseSequenceFromLogSolana(transaction);
          
          if (sequence) {
            // Get VAA
            const vaa = await this.getSignedVAA(
              CHAIN_ID_SOLANA,
              signature,
              sequence
            );
            
            // Create bridge transaction
            const bridgeTransaction = new BridgeTransaction({
              id: eventId,
              type: BridgeTransactionType.WITHDRAWAL,
              status: BridgeTransactionStatus.PENDING,
              sourceChain: CHAIN_ID_SOLANA,
              targetChain: CHAIN_ID_ETH,
              sourceTransaction: signature,
              sequence: sequence.toString(),
              vaa: Buffer.from(vaa).toString('base64'),
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            
            // Save to database
            await this.createTransactionInDatabase(bridgeTransaction);
            
            // Add to pending transactions
            this.pendingTransactions.set(bridgeTransaction.id, bridgeTransaction);
            
            this.logger.info(`Created new withdrawal transaction: ${bridgeTransaction.id}`);
            
            // Emit event
            this.emit('transactionCreated', bridgeTransaction);
          }
        }
      }
      
      // Mark as processed
      this.processedSequences.add(eventId);
    } catch (error) {
      this.logger.error(`Error processing Solana signature: ${signature}`, error);
      throw error;
    }
  }
  
  /**
   * Get signed VAA from Wormhole
   * 
   * @param chainId - The source chain ID
   * @param txHash - The transaction hash
   * @param sequence - The sequence number
   * @returns The signed VAA
   */
  private async getSignedVAA(
    chainId: ChainId,
    txHash: string,
    sequence: string | number
  ): Promise<Uint8Array> {
    this.logger.info(`Getting signed VAA for chain ${chainId}, tx ${txHash}, sequence ${sequence}`);
    
    // Try to get from cache first
    const cacheKey = `vaa-${chainId}-${txHash}-${sequence}`;
    const cachedVAA = await this.cacheService.get(cacheKey);
    
    if (cachedVAA) {
      this.logger.info(`Using cached VAA for ${cacheKey}`);
      return Buffer.from(cachedVAA as string, 'base64');
    }
    
    // Get emitter address based on chain
    let emitterAddress: string;
    if (chainId === CHAIN_ID_ETH) {
      emitterAddress = getEmitterAddressEth(this.config.ethereumTokenBridgeAddress);
    } else if (chainId === CHAIN_ID_SOLANA) {
      emitterAddress = getEmitterAddressSolana(new PublicKey(this.config.solanaTokenBridgeAddress));
    } else {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }
    
    // Retry logic for getting VAA
    let retries = 0;
    let vaa: Uint8Array | null = null;
    
    while (retries < this.config.maxRetries && !vaa) {
      try {
        vaa = await getSignedVAA(
          this.config.wormholeRpc,
          chainId,
          emitterAddress,
          sequence.toString()
        );
        
        this.logger.info(`Got signed VAA for ${cacheKey}`);
      } catch (error) {
        retries++;
        
        if (retries >= this.config.maxRetries) {
          this.logger.error(`Failed to get signed VAA after ${retries} retries`, error);
          throw error;
        }
        
        this.logger.warn(`Failed to get signed VAA, retrying (${retries}/${this.config.maxRetries})`, error);
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
      }
    }
    
    if (!vaa) {
      throw new Error(`Failed to get signed VAA for chain ${chainId}, tx ${txHash}, sequence ${sequence}`);
    }
    
    // Cache the VAA
    await this.cacheService.set(
      cacheKey,
      Buffer.from(vaa).toString('base64'),
      60 * 60 // 1 hour
    );
    
    return vaa;
  }
  
  /**
   * Post VAA to Solana
   * 
   * @param vaa - The VAA to post
   */
  private async postVAAToSolana(vaa: Buffer): Promise<void> {
    this.logger.info('Posting VAA to Solana');
    
    try {
      await postVaaSolana(
        this.solanaConnection,
        async (tx: Transaction) => {
          tx.partialSign(this.solanaWallet);
          return tx;
        },
        this.config.solanaBridgeAddress,
        this.solanaWallet.publicKey.toString(),
        Buffer.from(vaa)
      );
      
      this.logger.info('VAA posted to Solana successfully');
    } catch (error) {
      // Check if error is "already posted"
      if (error.message && error.message.includes('Custom program error: 0x0')) {
        this.logger.info('VAA already posted to Solana');
        return;
      }
      
      this.logger.error('Error posting VAA to Solana', error);
      throw error;
    }
  }
  
  /**
   * Redeem VAA on Solana
   * 
   * @param vaa - The VAA to redeem
   * @param transaction - The bridge transaction
   * @returns The transaction signature
   */
  private async redeemVAAOnSolana(
    vaa: Buffer,
    transaction: BridgeTransaction
  ): Promise<string> {
    this.logger.info(`Redeeming VAA on Solana for transaction ${transaction.id}`);
    
    try {
      const txid = await redeemOnSolana(
        this.solanaConnection,
        async (tx: Transaction) => {
          tx.partialSign(this.solanaWallet);
          return tx;
        },
        this.config.solanaTokenBridgeAddress,
        this.solanaWallet.publicKey.toString(),
        vaa
      );
      
      this.logger.info(`VAA redeemed on Solana successfully: ${txid}`);
      return txid;
    } catch (error) {
      this.logger.error(`Error redeeming VAA on Solana for transaction ${transaction.id}`, error);
      throw error;
    }
  }
  
  /**
   * Redeem VAA on Ethereum
   * 
   * @param vaa - The VAA to redeem
   * @param transaction - The bridge transaction
   * @returns The transaction hash
   */
  private async redeemVAAOnEthereum(
    vaa: Buffer,
    transaction: BridgeTransaction
  ): Promise<string> {
    this.logger.info(`Redeeming VAA on Ethereum for transaction ${transaction.id}`);
    
    try {
      const txHash = await redeemOnEth(
        this.config.ethereumTokenBridgeAddress,
        this.ethereumWallet,
        vaa
      );
      
      this.logger.info(`VAA redeemed on Ethereum successfully: ${txHash}`);
      return txHash;
    } catch (error) {
      this.logger.error(`Error redeeming VAA on Ethereum for transaction ${transaction.id}`, error);
      throw error;
    }
  }
  
  /**
   * Create a transaction in the database
   * 
   * @param transaction - The transaction to create
   */
  private async createTransactionInDatabase(transaction: BridgeTransaction): Promise<void> {
    this.logger.debug(`Creating transaction in database: ${transaction.id}`);
    
    try {
      await this.databaseService.query(
        `INSERT INTO bridge_transactions (
          id, type, status, source_chain, target_chain, source_transaction,
          destination_transaction, sequence, vaa, error, retry_count,
          created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          transaction.id,
          transaction.type,
          transaction.status,
          transaction.sourceChain,
          transaction.targetChain,
          transaction.sourceTransaction,
          transaction.destinationTransaction,
          transaction.sequence,
          transaction.vaa,
          transaction.error,
          transaction.retryCount,
          transaction.createdAt,
          transaction.updatedAt,
          transaction.completedAt,
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
  private async updateTransactionInDatabase(transaction: BridgeTransaction): Promise<void> {
    this.logger.debug(`Updating transaction in database: ${transaction.id}`);
    
    try {
      transaction.updatedAt = new Date();
      
      await this.databaseService.query(
        `UPDATE bridge_transactions SET
          status = ?,
          destination_transaction = ?,
          vaa = ?,
          error = ?,
          retry_count = ?,
          updated_at = ?,
          completed_at = ?
        WHERE id = ?`,
        [
          transaction.status,
          transaction.destinationTransaction,
          transaction.vaa,
          transaction.error,
          transaction.retryCount,
          transaction.updatedAt,
          transaction.completedAt,
          transaction.id,
        ]
      );
    } catch (error) {
      this.logger.error(`Error updating transaction in database: ${transaction.id}`, error);
      throw error;
    }
  }
  
  /**
   * Save the last processed block for a chain
   * 
   * @param chainId - The chain ID
   * @param blockNumber - The block number
   */
  private async saveLastProcessedBlock(chainId: ChainId, blockNumber: number): Promise<void> {
    this.logger.debug(`Saving last processed block for chain ${chainId}: ${blockNumber}`);
    
    try {
      await this.databaseService.query(
        `INSERT INTO relayer_last_processed_blocks (chain_id, last_block)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE last_block = ?`,
        [chainId, blockNumber, blockNumber]
      );
    } catch (error) {
      this.logger.error(`Error saving last processed block for chain ${chainId}`, error);
      throw error;
    }
  }
  
  /**
   * Save the current state to database
   */
  private async saveState(): Promise<void> {
    this.logger.info('Saving current state to database');
    
    try {
      // Save last processed blocks
      await this.saveLastProcessedBlock(CHAIN_ID_ETH, this.lastProcessedBlockEthereum);
      await this.saveLastProcessedBlock(CHAIN_ID_SOLANA, this.lastProcessedBlockSolana);
      
      // Update all pending transactions
      for (const transaction of this.pendingTransactions.values()) {
        await this.updateTransactionInDatabase(transaction);
      }
      
      this.logger.info('Current state saved to database successfully');
    } catch (error) {
      this.logger.error('Error saving current state to database', error);
      throw error;
    }
  }
  
  /**
   * Get status of the relayer
   * 
   * @returns The current status of the relayer
   */
  public getStatus(): any {
    return {
      isRunning: this.isRunning,
      lastProcessedBlockEthereum: this.lastProcessedBlockEthereum,
      lastProcessedBlockSolana: this.lastProcessedBlockSolana,
      pendingTransactions: this.pendingTransactions.size,
      processedSequences: this.processedSequences.size,
    };
  }
  
  /**
   * Get all pending transactions
   * 
   * @returns Array of pending transactions
   */
  public getPendingTransactions(): BridgeTransaction[] {
    return Array.from(this.pendingTransactions.values());
  }
  
  /**
   * Get transaction by ID
   * 
   * @param id - The transaction ID
   * @returns The transaction if found, null otherwise
   */
  public async getTransactionById(id: string): Promise<BridgeTransaction | null> {
    // Check in-memory cache first
    if (this.pendingTransactions.has(id)) {
      return this.pendingTransactions.get(id) || null;
    }
    
    // Query database
    try {
      const rows = await this.databaseService.query(
        'SELECT * FROM bridge_transactions WHERE id = ?',
        [id]
      );
      
      if (rows.length === 0) {
        return null;
      }
      
      return new BridgeTransaction(rows[0]);
    } catch (error) {
      this.logger.error(`Error getting transaction by ID: ${id}`, error);
      throw error;
    }
  }
  
  /**
   * Get transactions by status
   * 
   * @param status - The transaction status
   * @returns Array of transactions with the specified status
   */
  public async getTransactionsByStatus(status: BridgeTransactionStatus): Promise<BridgeTransaction[]> {
    try {
      const rows = await this.databaseService.query(
        'SELECT * FROM bridge_transactions WHERE status = ?',
        [status]
      );
      
      return rows.map(row => new BridgeTransaction(row));
    } catch (error) {
      this.logger.error(`Error getting transactions by status: ${status}`, error);
      throw error;
    }
  }
  
  /**
   * Get transactions by source chain
   * 
   * @param chainId - The source chain ID
   * @returns Array of transactions from the specified chain
   */
  public async getTransactionsBySourceChain(chainId: ChainId): Promise<BridgeTransaction[]> {
    try {
      const rows = await this.databaseService.query(
        'SELECT * FROM bridge_transactions WHERE source_chain = ?',
        [chainId]
      );
      
      return rows.map(row => new BridgeTransaction(row));
    } catch (error) {
      this.logger.error(`Error getting transactions by source chain: ${chainId}`, error);
      throw error;
    }
  }
  
  /**
   * Get transactions by target chain
   * 
   * @param chainId - The target chain ID
   * @returns Array of transactions to the specified chain
   */
  public async getTransactionsByTargetChain(chainId: ChainId): Promise<BridgeTransaction[]> {
    try {
      const rows = await this.databaseService.query(
        'SELECT * FROM bridge_transactions WHERE target_chain = ?',
        [chainId]
      );
      
      return rows.map(row => new BridgeTransaction(row));
    } catch (error) {
      this.logger.error(`Error getting transactions by target chain: ${chainId}`, error);
      throw error;
    }
  }
  
  /**
   * Get transactions by time range
   * 
   * @param startTime - The start time
   * @param endTime - The end time
   * @returns Array of transactions in the specified time range
   */
  public async getTransactionsByTimeRange(
    startTime: Date,
    endTime: Date
  ): Promise<BridgeTransaction[]> {
    try {
      const rows = await this.databaseService.query(
        'SELECT * FROM bridge_transactions WHERE created_at BETWEEN ? AND ?',
        [startTime, endTime]
      );
      
      return rows.map(row => new BridgeTransaction(row));
    } catch (error) {
      this.logger.error('Error getting transactions by time range', error);
      throw error;
    }
  }
  
  /**
   * Retry a failed transaction
   * 
   * @param id - The transaction ID
   * @returns The updated transaction
   */
  public async retryTransaction(id: string): Promise<BridgeTransaction> {
    this.logger.info(`Retrying transaction: ${id}`);
    
    try {
      // Get transaction
      const transaction = await this.getTransactionById(id);
      
      if (!transaction) {
        throw new Error(`Transaction not found: ${id}`);
      }
      
      // Check if transaction can be retried
      if (
        transaction.status !== BridgeTransactionStatus.ERROR &&
        transaction.status !== BridgeTransactionStatus.FAILED
      ) {
        throw new Error(`Transaction cannot be retried: ${id}, status: ${transaction.status}`);
      }
      
      // Reset transaction for retry
      transaction.status = BridgeTransactionStatus.PENDING;
      transaction.error = null;
      transaction.retryCount = 0;
      transaction.updatedAt = new Date();
      
      // Update in database
      await this.updateTransactionInDatabase(transaction);
      
      // Add to pending transactions
      this.pendingTransactions.set(transaction.id, transaction);
      
      this.logger.info(`Transaction ${id} scheduled for retry`);
      
      return transaction;
    } catch (error) {
      this.logger.error(`Error retrying transaction: ${id}`, error);
      throw error;
    }
  }
}
