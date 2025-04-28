// English comment for verification
/**
 * @file DepositService.ts
 * @description Service for handling deposits from Ethereum to Solana
 * 
 * This service manages the complete flow of deposits from Ethereum to Solana,
 * including monitoring Ethereum for deposit events, processing deposits on Solana,
 * and maintaining the state of deposits in the database.
 */

import { EthereumConnector } from '../connectors/EthereumConnector';
import { SolanaConnector } from '../connectors/SolanaConnector';
import { Logger } from '../utils/Logger';
import { MetricsCollector } from '../utils/MetricsCollector';
import { Cache } from '../utils/Cache';
import { Repository, Between, LessThan, MoreThan, In } from 'typeorm';
import { BridgeTransaction, TransactionStatus, TransactionType } from '../models/BridgeTransaction';
import { TokenMapping } from '../models/TokenMapping';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import * as path from 'path';
import * as os from 'os';
import { ethers } from 'ethers';

/**
 * Configuration for the deposit service
 */
export interface DepositServiceConfig {
    /**
     * Number of worker threads for processing deposits
     */
    workerCount?: number;
    
    /**
     * Polling interval for checking new deposits (ms)
     */
    pollingInterval?: number;
    
    /**
     * Maximum number of deposits to process in a batch
     */
    batchSize?: number;
    
    /**
     * Maximum number of retry attempts for failed deposits
     */
    maxRetries?: number;
    
    /**
     * Delay between retry attempts (ms)
     */
    retryDelay?: number;
    
    /**
     * Minimum confirmations required for Ethereum deposits
     */
    minConfirmations?: number;
    
    /**
     * Whether to enable automatic processing of deposits
     */
    autoProcess?: boolean;
    
    /**
     * Whether to enable automatic retries for failed deposits
     */
    autoRetry?: boolean;
    
    /**
     * Maximum age of deposits to process (ms)
     */
    maxDepositAge?: number;
    
    /**
     * Whether to enable deposit event listening
     */
    enableEventListening?: boolean;
    
    /**
     * Starting block for event listening
     */
    startBlock?: number;
    
    /**
     * Maximum number of blocks to process in a batch
     */
    maxBlocksPerBatch?: number;
}

/**
 * Deposit service class for handling deposits from Ethereum to Solana
 */
export class DepositService {
    private config: DepositServiceConfig;
    private logger: Logger;
    private metrics: MetricsCollector;
    private cache: Cache;
    private ethereumConnector: EthereumConnector;
    private solanaConnector: SolanaConnector;
    private bridgeTransactionRepository: Repository<BridgeTransaction>;
    private tokenMappingRepository: Repository<TokenMapping>;
    
    private workers: Worker[] = [];
    private isRunning: boolean = false;
    private pollingInterval: NodeJS.Timeout | null = null;
    private eventListeningInterval: NodeJS.Timeout | null = null;
    private lastProcessedBlock: number = 0;
    
    /**
     * Creates a new instance of the deposit service
     * @param config Deposit service configuration
     * @param logger Logger instance
     * @param metrics Metrics collector instance
     * @param cache Cache instance
     * @param ethereumConnector Ethereum connector instance
     * @param solanaConnector Solana connector instance
     * @param bridgeTransactionRepository Bridge transaction repository
     * @param tokenMappingRepository Token mapping repository
     */
    constructor(
        config: DepositServiceConfig,
        logger: Logger,
        metrics: MetricsCollector,
        cache: Cache,
        ethereumConnector: EthereumConnector,
        solanaConnector: SolanaConnector,
        bridgeTransactionRepository: Repository<BridgeTransaction>,
        tokenMappingRepository: Repository<TokenMapping>
    ) {
        this.config = {
            ...config,
            workerCount: config.workerCount || Math.max(1, os.cpus().length - 1),
            pollingInterval: config.pollingInterval || 60000, // 1 minute
            batchSize: config.batchSize || 50,
            maxRetries: config.maxRetries || 5,
            retryDelay: config.retryDelay || 300000, // 5 minutes
            minConfirmations: config.minConfirmations || 12,
            autoProcess: config.autoProcess !== false,
            autoRetry: config.autoRetry !== false,
            maxDepositAge: config.maxDepositAge || 7 * 24 * 60 * 60 * 1000, // 7 days
            enableEventListening: config.enableEventListening !== false,
            maxBlocksPerBatch: config.maxBlocksPerBatch || 1000
        };
        
        this.logger = logger;
        this.metrics = metrics;
        this.cache = cache;
        this.ethereumConnector = ethereumConnector;
        this.solanaConnector = solanaConnector;
        this.bridgeTransactionRepository = bridgeTransactionRepository;
        this.tokenMappingRepository = tokenMappingRepository;
        
        // Set last processed block from config or default to 0
        this.lastProcessedBlock = config.startBlock || 0;
    }
    
    /**
     * Initializes the deposit service
     */
    public async initialize(): Promise<void> {
        this.logger.info('Initializing deposit service...');
        
        try {
            // Initialize workers if in main thread
            if (isMainThread) {
                await this.initializeWorkers();
            }
            
            this.logger.info('Deposit service initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize deposit service', error);
            throw error;
        }
    }
    
    /**
     * Initializes worker threads for processing deposits
     */
    private async initializeWorkers(): Promise<void> {
        if (this.config.workerCount <= 1) {
            this.logger.info('Running in single-threaded mode');
            return;
        }
        
        this.logger.info(`Initializing ${this.config.workerCount} worker threads for deposit processing`);
        
        for (let i = 0; i < this.config.workerCount; i++) {
            const worker = new Worker(path.resolve(__dirname, 'DepositWorker.js'), {
                workerData: {
                    workerId: i,
                    config: this.config
                }
            });
            
            worker.on('message', (message) => {
                if (message.type === 'log') {
                    this.logger[message.level](`Worker ${i}: ${message.message}`);
                } else if (message.type === 'metric') {
                    this.metrics[message.method](...message.args);
                } else if (message.type === 'result') {
                    this.handleWorkerResult(message.data);
                }
            });
            
            worker.on('error', (error) => {
                this.logger.error(`Worker ${i} error:`, error);
                this.metrics.increment('deposit.worker.errors');
                
                // Restart worker
                this.restartWorker(i);
            });
            
            worker.on('exit', (code) => {
                if (code !== 0) {
                    this.logger.warn(`Worker ${i} exited with code ${code}`);
                    this.metrics.increment('deposit.worker.exits');
                    
                    // Restart worker
                    this.restartWorker(i);
                }
            });
            
            this.workers.push(worker);
        }
        
        this.logger.info(`Initialized ${this.workers.length} worker threads`);
    }
    
    /**
     * Restarts a worker thread
     * @param index Worker index
     */
    private restartWorker(index: number): void {
        if (!this.isRunning) {
            return;
        }
        
        this.logger.info(`Restarting worker ${index}...`);
        
        const worker = new Worker(path.resolve(__dirname, 'DepositWorker.js'), {
            workerData: {
                workerId: index,
                config: this.config
            }
        });
        
        worker.on('message', (message) => {
            if (message.type === 'log') {
                this.logger[message.level](`Worker ${index}: ${message.message}`);
            } else if (message.type === 'metric') {
                this.metrics[message.method](...message.args);
            } else if (message.type === 'result') {
                this.handleWorkerResult(message.data);
            }
        });
        
        worker.on('error', (error) => {
            this.logger.error(`Worker ${index} error:`, error);
            this.metrics.increment('deposit.worker.errors');
            
            // Restart worker
            this.restartWorker(index);
        });
        
        worker.on('exit', (code) => {
            if (code !== 0) {
                this.logger.warn(`Worker ${index} exited with code ${code}`);
                this.metrics.increment('deposit.worker.exits');
                
                // Restart worker
                this.restartWorker(index);
            }
        });
        
        // Replace worker in array
        this.workers[index] = worker;
        
        this.logger.info(`Worker ${index} restarted`);
    }
    
    /**
     * Handles worker result
     * @param result Worker result
     */
    private async handleWorkerResult(result: any): Promise<void> {
        try {
            if (result.success) {
                this.logger.info(`Deposit ${result.depositHash} processed successfully`);
                this.metrics.increment('deposit.processed.success');
                
                // Update transaction status
                await this.bridgeTransactionRepository.update(
                    { id: result.transactionId },
                    {
                        status: TransactionStatus.COMPLETED,
                        targetTransactionHash: result.signature,
                        targetBlockNumber: result.blockNumber,
                        completedTimestamp: Date.now()
                    }
                );
            } else {
                this.logger.error(`Deposit ${result.depositHash} processing failed: ${result.error}`);
                this.metrics.increment('deposit.processed.failed');
                
                // Update transaction status
                await this.bridgeTransactionRepository.update(
                    { id: result.transactionId },
                    {
                        status: TransactionStatus.FAILED,
                        error: result.error,
                        retryCount: () => `"retryCount" + 1`,
                        nextRetryTime: this.config.autoRetry
                            ? Date.now() + this.config.retryDelay
                            : null
                    }
                );
            }
        } catch (error) {
            this.logger.error('Error handling worker result', error);
        }
    }
    
    /**
     * Starts the deposit service
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            this.logger.warn('Deposit service already running');
            return;
        }
        
        this.logger.info('Starting deposit service...');
        
        try {
            this.isRunning = true;
            
            // Start polling for pending deposits
            if (this.config.autoProcess) {
                this.startPolling();
            }
            
            // Start listening for deposit events
            if (this.config.enableEventListening) {
                this.startEventListening();
            }
            
            this.logger.info('Deposit service started successfully');
        } catch (error) {
            this.isRunning = false;
            this.logger.error('Failed to start deposit service', error);
            throw error;
        }
    }
    
    /**
     * Stops the deposit service
     */
    public async stop(): Promise<void> {
        if (!this.isRunning) {
            this.logger.warn('Deposit service not running');
            return;
        }
        
        this.logger.info('Stopping deposit service...');
        
        try {
            this.isRunning = false;
            
            // Stop polling
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
                this.pollingInterval = null;
            }
            
            // Stop event listening
            if (this.eventListeningInterval) {
                clearInterval(this.eventListeningInterval);
                this.eventListeningInterval = null;
            }
            
            // Terminate workers
            for (const worker of this.workers) {
                worker.terminate();
            }
            
            this.workers = [];
            
            this.logger.info('Deposit service stopped successfully');
        } catch (error) {
            this.logger.error('Failed to stop deposit service', error);
            throw error;
        }
    }
    
    /**
     * Starts polling for pending deposits
     */
    private startPolling(): void {
        this.logger.info(`Starting deposit polling with interval ${this.config.pollingInterval}ms`);
        
        // Process immediately
        this.processPendingDeposits();
        
        // Set up interval
        this.pollingInterval = setInterval(() => {
            this.processPendingDeposits();
        }, this.config.pollingInterval);
    }
    
    /**
     * Starts listening for deposit events
     */
    private startEventListening(): void {
        this.logger.info('Starting deposit event listening');
        
        // Process immediately
        this.processDepositEvents();
        
        // Set up interval
        this.eventListeningInterval = setInterval(() => {
            this.processDepositEvents();
        }, this.config.pollingInterval);
    }
    
    /**
     * Processes pending deposits
     */
    private async processPendingDeposits(): Promise<void> {
        if (!this.isRunning) {
            return;
        }
        
        try {
            this.logger.debug('Processing pending deposits...');
            
            // Find pending deposits
            const pendingDeposits = await this.bridgeTransactionRepository.find({
                where: [
                    {
                        type: TransactionType.DEPOSIT,
                        status: TransactionStatus.PENDING
                    },
                    {
                        type: TransactionType.DEPOSIT,
                        status: TransactionStatus.FAILED,
                        retryCount: LessThan(this.config.maxRetries),
                        nextRetryTime: LessThan(Date.now())
                    }
                ],
                take: this.config.batchSize,
                order: {
                    timestamp: 'ASC'
                }
            });
            
            if (pendingDeposits.length === 0) {
                this.logger.debug('No pending deposits to process');
                return;
            }
            
            this.logger.info(`Found ${pendingDeposits.length} pending deposits to process`);
            this.metrics.gauge('deposit.pending', pendingDeposits.length);
            
            // Process deposits
            if (this.workers.length > 0) {
                // Distribute deposits among workers
                const depositsPerWorker = Math.ceil(pendingDeposits.length / this.workers.length);
                
                for (let i = 0; i < this.workers.length; i++) {
                    const start = i * depositsPerWorker;
                    const end = Math.min(start + depositsPerWorker, pendingDeposits.length);
                    
                    if (start < end) {
                        const workerDeposits = pendingDeposits.slice(start, end);
                        
                        this.workers[i].postMessage({
                            type: 'process',
                            deposits: workerDeposits
                        });
                    }
                }
            } else {
                // Process deposits in main thread
                for (const deposit of pendingDeposits) {
                    await this.processDeposit(deposit);
                }
            }
        } catch (error) {
            this.logger.error('Error processing pending deposits', error);
            this.metrics.increment('deposit.processing.errors');
        }
    }
    
    /**
     * Processes deposit events from Ethereum
     */
    private async processDepositEvents(): Promise<void> {
        if (!this.isRunning) {
            return;
        }
        
        try {
            this.logger.debug('Processing deposit events...');
            
            // Get current block
            const currentBlock = await this.ethereumConnector.getCurrentBlock();
            
            // If no last processed block, start from current block
            if (this.lastProcessedBlock === 0) {
                this.lastProcessedBlock = currentBlock;
                this.logger.info(`Starting event processing from block ${this.lastProcessedBlock}`);
                return;
            }
            
            // Calculate range to process
            const fromBlock = this.lastProcessedBlock + 1;
            const toBlock = Math.min(currentBlock, fromBlock + this.config.maxBlocksPerBatch - 1);
            
            if (fromBlock > toBlock) {
                this.logger.debug('No new blocks to process');
                return;
            }
            
            this.logger.info(`Processing deposit events from block ${fromBlock} to ${toBlock}`);
            
            // Get deposit events
            const events = await this.ethereumConnector.getDepositEvents(fromBlock, toBlock);
            
            if (events.length === 0) {
                this.logger.debug(`No deposit events found in blocks ${fromBlock}-${toBlock}`);
                
                // Update last processed block
                this.lastProcessedBlock = toBlock;
                return;
            }
            
            this.logger.info(`Found ${events.length} deposit events in blocks ${fromBlock}-${toBlock}`);
            this.metrics.gauge('deposit.events', events.length);
            
            // Process events
            for (const event of events) {
                await this.processDepositEvent(event);
            }
            
            // Update last processed block
            this.lastProcessedBlock = toBlock;
            
        } catch (error) {
            this.logger.error('Error processing deposit events', error);
            this.metrics.increment('deposit.events.processing.errors');
        }
    }
    
    /**
     * Processes a deposit event
     * @param event Deposit event
     */
    private async processDepositEvent(event: any): Promise<void> {
        try {
            const {
                index,
                sender,
                token,
                amount,
                l2Recipient,
                depositHash,
                blockNumber,
                transactionHash
            } = event;
            
            this.logger.info(`Processing deposit event: hash=${depositHash}, token=${token}, amount=${amount}, recipient=${l2Recipient}`);
            
            // Check if deposit already exists
            const existingDeposit = await this.bridgeTransactionRepository.findOne({
                where: {
                    sourceTransactionHash: transactionHash
                }
            });
            
            if (existingDeposit) {
                this.logger.info(`Deposit ${depositHash} already exists with ID ${existingDeposit.id}`);
                return;
            }
            
            // Get token mapping
            const tokenMapping = await this.tokenMappingRepository.findOne({
                where: {
                    ethereumToken: token.toLowerCase()
                }
            });
            
            if (!tokenMapping) {
                this.logger.error(`Token mapping not found for Ethereum token ${token}`);
                return;
            }
            
            // Create bridge transaction
            const bridgeTransaction = new BridgeTransaction();
            bridgeTransaction.type = TransactionType.DEPOSIT;
            bridgeTransaction.status = TransactionStatus.PENDING;
            bridgeTransaction.sourceChain = 'ethereum';
            bridgeTransaction.targetChain = 'solana';
            bridgeTransaction.sourceAddress = sender;
            bridgeTransaction.targetAddress = l2Recipient;
            bridgeTransaction.token = token;
            bridgeTransaction.amount = amount;
            bridgeTransaction.sourceTransactionHash = transactionHash;
            bridgeTransaction.sourceBlockNumber = blockNumber;
            bridgeTransaction.timestamp = Date.now();
            bridgeTransaction.metadata = {
                depositHash,
                index,
                solanaToken: tokenMapping.solanaToken
            };
            
            // Save bridge transaction
            const savedTransaction = await this.bridgeTransactionRepository.save(bridgeTransaction);
            
            this.logger.info(`Created bridge transaction ${savedTransaction.id} for deposit ${depositHash}`);
            this.metrics.increment('deposit.events.processed');
            
        } catch (error) {
            this.logger.error(`Error processing deposit event: ${error.message}`, error);
            this.metrics.increment('deposit.events.errors');
        }
    }
    
    /**
     * Processes a deposit
     * @param deposit Deposit transaction
     */
    public async processDeposit(deposit: BridgeTransaction): Promise<void> {
        try {
            this.logger.info(`Processing deposit ${deposit.id}: ${deposit.amount} ${deposit.token} to ${deposit.targetAddress}`);
            
            // Update status to processing
            await this.bridgeTransactionRepository.update(
                { id: deposit.id },
                { status: TransactionStatus.PROCESSING }
            );
            
            // Get token mapping
            const tokenMapping = await this.tokenMappingRepository.findOne({
                where: {
                    ethereumToken: deposit.token.toLowerCase()
                }
            });
            
            if (!tokenMapping) {
                throw new Error(`Token mapping not found for Ethereum token ${deposit.token}`);
            }
            
            // Check if deposit has enough confirmations
            const confirmations = await this.ethereumConnector.getTransactionConfirmations(deposit.sourceTransactionHash);
            
            if (confirmations < this.config.minConfirmations) {
                this.logger.info(`Deposit ${deposit.id} has ${confirmations} confirmations, waiting for ${this.config.minConfirmations}`);
                
                // Update status back to pending
                await this.bridgeTransactionRepository.update(
                    { id: deposit.id },
                    { status: TransactionStatus.PENDING }
                );
                
                return;
            }
            
            // Update status to confirming
            await this.bridgeTransactionRepository.update(
                { id: deposit.id },
                { status: TransactionStatus.CONFIRMING, sourceConfirmations: confirmations }
            );
            
            // Process deposit on Solana
            const depositHash = deposit.metadata?.depositHash || deposit.sourceTransactionHash;
            const signature = await this.solanaConnector.processDeposit(
                deposit.token,
                tokenMapping.solanaToken,
                deposit.amount,
                deposit.targetAddress,
                depositHash
            );
            
            // Update status to finalizing
            await this.bridgeTransactionRepository.update(
                { id: deposit.id },
                {
                    status: TransactionStatus.FINALIZING,
                    targetTransactionHash: signature
                }
            );
            
            // Wait for Solana confirmation
            const status = await this.solanaConnector.confirmTransaction(signature);
            
            if (status.err) {
                throw new Error(`Solana transaction failed: ${JSON.stringify(status.err)}`);
            }
            
            // Update status to completed
            await this.bridgeTransactionRepository.update(
                { id: deposit.id },
                {
                    status: TransactionStatus.COMPLETED,
                    targetBlockNumber: status.context.slot,
                    targetConfirmations: status.value?.confirmations || 0,
                    completedTimestamp: Date.now()
                }
            );
            
            this.logger.info(`Deposit ${deposit.id} processed successfully: ${signature}`);
            this.metrics.increment('deposit.processed.success');
            
        } catch (error) {
            this.logger.error(`Error processing deposit ${deposit.id}: ${error.message}`, error);
            this.metrics.increment('deposit.processed.failed');
            
            // Update status to failed
            await this.bridgeTransactionRepository.update(
                { id: deposit.id },
                {
                    status: TransactionStatus.FAILED,
                    error: error.message,
                    retryCount: () => `"retryCount" + 1`,
                    nextRetryTime: this.config.autoRetry
                        ? Date.now() + this.config.retryDelay
                        : null
                }
            );
        }
    }
    
    /**
     * Creates a deposit from Ethereum to Solana
     * @param token Ethereum token address or 'ETH' for native Ether
     * @param amount Amount to deposit (in smallest unit, e.g., wei)
     * @param recipient Solana recipient address
     * @returns Transaction hash
     */
    public async createDeposit(
        token: string,
        amount: string,
        recipient: string
    ): Promise<string> {
        try {
            this.logger.info(`Creating deposit: ${amount} ${token} to ${recipient}`);
            
            // Check if token is supported
            const isSupported = await this.ethereumConnector.isTokenSupported(token);
            
            if (!isSupported) {
                throw new Error(`Token ${token} is not supported`);
            }
            
            // Get token mapping
            const tokenMapping = await this.tokenMappingRepository.findOne({
                where: {
                    ethereumToken: token.toLowerCase()
                }
            });
            
            if (!tokenMapping) {
                throw new Error(`Token mapping not found for Ethereum token ${token}`);
            }
            
            // Check if recipient is valid
            if (!this.isValidSolanaAddress(recipient)) {
                throw new Error(`Invalid Solana recipient address: ${recipient}`);
            }
            
            // Create deposit on Ethereum
            const txHash = await this.ethereumConnector.deposit(token, amount, recipient);
            
            this.logger.info(`Deposit transaction submitted: ${txHash}`);
            this.metrics.increment('deposit.created');
            
            return txHash;
        } catch (error) {
            this.logger.error(`Error creating deposit: ${error.message}`, error);
            this.metrics.increment('deposit.creation.errors');
            throw error;
        }
    }
    
    /**
     * Checks if a Solana address is valid
     * @param address Solana address
     * @returns Whether the address is valid
     */
    private isValidSolanaAddress(address: string): boolean {
        try {
            // Check if the address is a valid base58 string
            const decoded = Buffer.from(bs58.decode(address));
            
            // Solana addresses are 32 bytes
            return decoded.length === 32;
        } catch (error) {
            return false;
        }
    }
    
    /**
     * Gets the current Ethereum block number
     * @returns Current block number
     */
    private async getCurrentBlock(): Promise<number> {
        try {
            return await this.ethereumConnector.getCurrentBlock();
        } catch (error) {
            this.logger.error('Error getting current block', error);
            throw error;
        }
    }
}
