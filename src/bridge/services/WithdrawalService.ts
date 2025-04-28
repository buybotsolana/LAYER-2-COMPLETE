// English comment for verification
/**
 * @file WithdrawalService.ts
 * @description Service for handling withdrawals from Solana to Ethereum
 * 
 * This service manages the complete flow of withdrawals from Solana to Ethereum,
 * including initiating withdrawals on Solana, processing them on Ethereum,
 * and maintaining the state of withdrawals in the database.
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
import * as bs58 from 'bs58';

/**
 * Configuration for the withdrawal service
 */
export interface WithdrawalServiceConfig {
    /**
     * Number of worker threads for processing withdrawals
     */
    workerCount?: number;
    
    /**
     * Polling interval for checking new withdrawals (ms)
     */
    pollingInterval?: number;
    
    /**
     * Maximum number of withdrawals to process in a batch
     */
    batchSize?: number;
    
    /**
     * Maximum number of retry attempts for failed withdrawals
     */
    maxRetries?: number;
    
    /**
     * Delay between retry attempts (ms)
     */
    retryDelay?: number;
    
    /**
     * Minimum confirmations required for Solana withdrawals
     */
    minConfirmations?: number;
    
    /**
     * Whether to enable automatic processing of withdrawals
     */
    autoProcess?: boolean;
    
    /**
     * Whether to enable automatic retries for failed withdrawals
     */
    autoRetry?: boolean;
    
    /**
     * Maximum age of withdrawals to process (ms)
     */
    maxWithdrawalAge?: number;
    
    /**
     * Whether to enable withdrawal event listening
     */
    enableEventListening?: boolean;
    
    /**
     * Starting slot for event listening
     */
    startSlot?: number;
    
    /**
     * Maximum number of slots to process in a batch
     */
    maxSlotsPerBatch?: number;
    
    /**
     * Finalization delay for withdrawals (ms)
     */
    finalizationDelay?: number;
}

/**
 * Withdrawal service class for handling withdrawals from Solana to Ethereum
 */
export class WithdrawalService {
    private config: WithdrawalServiceConfig;
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
    private lastProcessedSlot: number = 0;
    
    /**
     * Creates a new instance of the withdrawal service
     * @param config Withdrawal service configuration
     * @param logger Logger instance
     * @param metrics Metrics collector instance
     * @param cache Cache instance
     * @param ethereumConnector Ethereum connector instance
     * @param solanaConnector Solana connector instance
     * @param bridgeTransactionRepository Bridge transaction repository
     * @param tokenMappingRepository Token mapping repository
     */
    constructor(
        config: WithdrawalServiceConfig,
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
            minConfirmations: config.minConfirmations || 32,
            autoProcess: config.autoProcess !== false,
            autoRetry: config.autoRetry !== false,
            maxWithdrawalAge: config.maxWithdrawalAge || 7 * 24 * 60 * 60 * 1000, // 7 days
            enableEventListening: config.enableEventListening !== false,
            maxSlotsPerBatch: config.maxSlotsPerBatch || 1000,
            finalizationDelay: config.finalizationDelay || 600000 // 10 minutes
        };
        
        this.logger = logger;
        this.metrics = metrics;
        this.cache = cache;
        this.ethereumConnector = ethereumConnector;
        this.solanaConnector = solanaConnector;
        this.bridgeTransactionRepository = bridgeTransactionRepository;
        this.tokenMappingRepository = tokenMappingRepository;
        
        // Set last processed slot from config or default to 0
        this.lastProcessedSlot = config.startSlot || 0;
    }
    
    /**
     * Initializes the withdrawal service
     */
    public async initialize(): Promise<void> {
        this.logger.info('Initializing withdrawal service...');
        
        try {
            // Initialize workers if in main thread
            if (isMainThread) {
                await this.initializeWorkers();
            }
            
            this.logger.info('Withdrawal service initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize withdrawal service', error);
            throw error;
        }
    }
    
    /**
     * Initializes worker threads for processing withdrawals
     */
    private async initializeWorkers(): Promise<void> {
        if (this.config.workerCount <= 1) {
            this.logger.info('Running in single-threaded mode');
            return;
        }
        
        this.logger.info(`Initializing ${this.config.workerCount} worker threads for withdrawal processing`);
        
        for (let i = 0; i < this.config.workerCount; i++) {
            const worker = new Worker(path.resolve(__dirname, 'WithdrawalWorker.js'), {
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
                this.metrics.increment('withdrawal.worker.errors');
                
                // Restart worker
                this.restartWorker(i);
            });
            
            worker.on('exit', (code) => {
                if (code !== 0) {
                    this.logger.warn(`Worker ${i} exited with code ${code}`);
                    this.metrics.increment('withdrawal.worker.exits');
                    
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
        
        const worker = new Worker(path.resolve(__dirname, 'WithdrawalWorker.js'), {
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
            this.metrics.increment('withdrawal.worker.errors');
            
            // Restart worker
            this.restartWorker(index);
        });
        
        worker.on('exit', (code) => {
            if (code !== 0) {
                this.logger.warn(`Worker ${index} exited with code ${code}`);
                this.metrics.increment('withdrawal.worker.exits');
                
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
                this.logger.info(`Withdrawal ${result.withdrawalHash} processed successfully`);
                this.metrics.increment('withdrawal.processed.success');
                
                // Update transaction status
                await this.bridgeTransactionRepository.update(
                    { id: result.transactionId },
                    {
                        status: TransactionStatus.COMPLETED,
                        targetTransactionHash: result.txHash,
                        targetBlockNumber: result.blockNumber,
                        completedTimestamp: Date.now()
                    }
                );
            } else {
                this.logger.error(`Withdrawal ${result.withdrawalHash} processing failed: ${result.error}`);
                this.metrics.increment('withdrawal.processed.failed');
                
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
     * Starts the withdrawal service
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            this.logger.warn('Withdrawal service already running');
            return;
        }
        
        this.logger.info('Starting withdrawal service...');
        
        try {
            this.isRunning = true;
            
            // Start polling for pending withdrawals
            if (this.config.autoProcess) {
                this.startPolling();
            }
            
            // Start listening for withdrawal events
            if (this.config.enableEventListening) {
                this.startEventListening();
            }
            
            this.logger.info('Withdrawal service started successfully');
        } catch (error) {
            this.isRunning = false;
            this.logger.error('Failed to start withdrawal service', error);
            throw error;
        }
    }
    
    /**
     * Stops the withdrawal service
     */
    public async stop(): Promise<void> {
        if (!this.isRunning) {
            this.logger.warn('Withdrawal service not running');
            return;
        }
        
        this.logger.info('Stopping withdrawal service...');
        
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
            
            this.logger.info('Withdrawal service stopped successfully');
        } catch (error) {
            this.logger.error('Failed to stop withdrawal service', error);
            throw error;
        }
    }
    
    /**
     * Starts polling for pending withdrawals
     */
    private startPolling(): void {
        this.logger.info(`Starting withdrawal polling with interval ${this.config.pollingInterval}ms`);
        
        // Process immediately
        this.processPendingWithdrawals();
        
        // Set up interval
        this.pollingInterval = setInterval(() => {
            this.processPendingWithdrawals();
        }, this.config.pollingInterval);
    }
    
    /**
     * Starts listening for withdrawal events
     */
    private startEventListening(): void {
        this.logger.info('Starting withdrawal event listening');
        
        // Process immediately
        this.processWithdrawalEvents();
        
        // Set up interval
        this.eventListeningInterval = setInterval(() => {
            this.processWithdrawalEvents();
        }, this.config.pollingInterval);
    }
    
    /**
     * Processes pending withdrawals
     */
    private async processPendingWithdrawals(): Promise<void> {
        if (!this.isRunning) {
            return;
        }
        
        try {
            this.logger.debug('Processing pending withdrawals...');
            
            // Find pending withdrawals
            const pendingWithdrawals = await this.bridgeTransactionRepository.find({
                where: [
                    {
                        type: TransactionType.WITHDRAWAL,
                        status: TransactionStatus.PENDING
                    },
                    {
                        type: TransactionType.WITHDRAWAL,
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
            
            if (pendingWithdrawals.length === 0) {
                this.logger.debug('No pending withdrawals to process');
                return;
            }
            
            this.logger.info(`Found ${pendingWithdrawals.length} pending withdrawals to process`);
            this.metrics.gauge('withdrawal.pending', pendingWithdrawals.length);
            
            // Process withdrawals
            if (this.workers.length > 0) {
                // Distribute withdrawals among workers
                const withdrawalsPerWorker = Math.ceil(pendingWithdrawals.length / this.workers.length);
                
                for (let i = 0; i < this.workers.length; i++) {
                    const start = i * withdrawalsPerWorker;
                    const end = Math.min(start + withdrawalsPerWorker, pendingWithdrawals.length);
                    
                    if (start < end) {
                        const workerWithdrawals = pendingWithdrawals.slice(start, end);
                        
                        this.workers[i].postMessage({
                            type: 'process',
                            withdrawals: workerWithdrawals
                        });
                    }
                }
            } else {
                // Process withdrawals in main thread
                for (const withdrawal of pendingWithdrawals) {
                    await this.processWithdrawal(withdrawal);
                }
            }
        } catch (error) {
            this.logger.error('Error processing pending withdrawals', error);
            this.metrics.increment('withdrawal.processing.errors');
        }
    }
    
    /**
     * Processes withdrawal events from Solana
     */
    private async processWithdrawalEvents(): Promise<void> {
        if (!this.isRunning) {
            return;
        }
        
        try {
            this.logger.debug('Processing withdrawal events...');
            
            // Get current slot
            const currentSlot = await this.solanaConnector.getCurrentSlot();
            
            // If no last processed slot, start from current slot
            if (this.lastProcessedSlot === 0) {
                this.lastProcessedSlot = currentSlot;
                this.logger.info(`Starting event processing from slot ${this.lastProcessedSlot}`);
                return;
            }
            
            // Calculate range to process
            const fromSlot = this.lastProcessedSlot + 1;
            const toSlot = Math.min(currentSlot, fromSlot + this.config.maxSlotsPerBatch - 1);
            
            if (fromSlot > toSlot) {
                this.logger.debug('No new slots to process');
                return;
            }
            
            this.logger.info(`Processing withdrawal events from slot ${fromSlot} to ${toSlot}`);
            
            // Get withdrawal events
            const events = await this.solanaConnector.getWithdrawalEvents(fromSlot, toSlot);
            
            if (events.length === 0) {
                this.logger.debug(`No withdrawal events found in slots ${fromSlot}-${toSlot}`);
                
                // Update last processed slot
                this.lastProcessedSlot = toSlot;
                return;
            }
            
            this.logger.info(`Found ${events.length} withdrawal events in slots ${fromSlot}-${toSlot}`);
            this.metrics.gauge('withdrawal.events', events.length);
            
            // Process events
            for (const event of events) {
                await this.processWithdrawalEvent(event);
            }
            
            // Update last processed slot
            this.lastProcessedSlot = toSlot;
            
        } catch (error) {
            this.logger.error('Error processing withdrawal events', error);
            this.metrics.increment('withdrawal.events.processing.errors');
        }
    }
    
    /**
     * Processes a withdrawal event
     * @param event Withdrawal event
     */
    private async processWithdrawalEvent(event: any): Promise<void> {
        try {
            const {
                withdrawalHash,
                sender,
                token,
                amount,
                ethRecipient,
                slot,
                signature
            } = event;
            
            this.logger.info(`Processing withdrawal event: hash=${withdrawalHash}, token=${token}, amount=${amount}, recipient=${ethRecipient}`);
            
            // Check if withdrawal already exists
            const existingWithdrawal = await this.bridgeTransactionRepository.findOne({
                where: {
                    sourceTransactionHash: signature
                }
            });
            
            if (existingWithdrawal) {
                this.logger.info(`Withdrawal ${withdrawalHash} already exists with ID ${existingWithdrawal.id}`);
                return;
            }
            
            // Get token mapping
            const tokenMapping = await this.tokenMappingRepository.findOne({
                where: {
                    solanaToken: token
                }
            });
            
            if (!tokenMapping) {
                this.logger.error(`Token mapping not found for Solana token ${token}`);
                return;
            }
            
            // Create bridge transaction
            const bridgeTransaction = new BridgeTransaction();
            bridgeTransaction.type = TransactionType.WITHDRAWAL;
            bridgeTransaction.status = TransactionStatus.PENDING;
            bridgeTransaction.sourceChain = 'solana';
            bridgeTransaction.targetChain = 'ethereum';
            bridgeTransaction.sourceAddress = sender;
            bridgeTransaction.targetAddress = ethRecipient;
            bridgeTransaction.token = token;
            bridgeTransaction.amount = amount;
            bridgeTransaction.sourceTransactionHash = signature;
            bridgeTransaction.sourceBlockNumber = slot;
            bridgeTransaction.timestamp = Date.now();
            bridgeTransaction.metadata = {
                withdrawalHash,
                ethereumToken: tokenMapping.ethereumToken
            };
            
            // Save bridge transaction
            const savedTransaction = await this.bridgeTransactionRepository.save(bridgeTransaction);
            
            this.logger.info(`Created bridge transaction ${savedTransaction.id} for withdrawal ${withdrawalHash}`);
            this.metrics.increment('withdrawal.events.processed');
            
        } catch (error) {
            this.logger.error(`Error processing withdrawal event: ${error.message}`, error);
            this.metrics.increment('withdrawal.events.errors');
        }
    }
    
    /**
     * Processes a withdrawal
     * @param withdrawal Withdrawal transaction
     */
    public async processWithdrawal(withdrawal: BridgeTransaction): Promise<void> {
        try {
            this.logger.info(`Processing withdrawal ${withdrawal.id}: ${withdrawal.amount} ${withdrawal.token} to ${withdrawal.targetAddress}`);
            
            // Update status to processing
            await this.bridgeTransactionRepository.update(
                { id: withdrawal.id },
                { status: TransactionStatus.PROCESSING }
            );
            
            // Get token mapping
            const tokenMapping = await this.tokenMappingRepository.findOne({
                where: {
                    solanaToken: withdrawal.token
                }
            });
            
            if (!tokenMapping) {
                throw new Error(`Token mapping not found for Solana token ${withdrawal.token}`);
            }
            
            // Check if withdrawal has enough confirmations
            const confirmations = await this.solanaConnector.getTransactionConfirmations(withdrawal.sourceTransactionHash);
            
            if (confirmations < this.config.minConfirmations) {
                this.logger.info(`Withdrawal ${withdrawal.id} has ${confirmations} confirmations, waiting for ${this.config.minConfirmations}`);
                
                // Update status back to pending
                await this.bridgeTransactionRepository.update(
                    { id: withdrawal.id },
                    { status: TransactionStatus.PENDING }
                );
                
                return;
            }
            
            // Update status to confirming
            await this.bridgeTransactionRepository.update(
                { id: withdrawal.id },
                { status: TransactionStatus.CONFIRMING, sourceConfirmations: confirmations }
            );
            
            // Generate withdrawal proof
            const withdrawalHash = withdrawal.metadata?.withdrawalHash || withdrawal.sourceTransactionHash;
            const proof = await this.solanaConnector.generateWithdrawalProof(withdrawalHash);
            
            // Process withdrawal on Ethereum
            const txHash = await this.ethereumConnector.processWithdrawal(
                tokenMapping.ethereumToken,
                withdrawal.amount,
                withdrawal.targetAddress,
                withdrawal.sourceAddress,
                withdrawalHash
            );
            
            // Update status to finalizing
            await this.bridgeTransactionRepository.update(
                { id: withdrawal.id },
                {
                    status: TransactionStatus.FINALIZING,
                    targetTransactionHash: txHash
                }
            );
            
            // Wait for Ethereum confirmation
            const receipt = await this.ethereumConnector.waitForTransaction(txHash);
            
            if (receipt.status === 0) {
                throw new Error(`Ethereum transaction failed: ${txHash}`);
            }
            
            // Update status to completed
            await this.bridgeTransactionRepository.update(
                { id: withdrawal.id },
                {
                    status: TransactionStatus.COMPLETED,
                    targetBlockNumber: receipt.blockNumber,
                    targetConfirmations: await this.ethereumConnector.getTransactionConfirmations(txHash),
                    completedTimestamp: Date.now()
                }
            );
            
            this.logger.info(`Withdrawal ${withdrawal.id} processed successfully: ${txHash}`);
            this.metrics.increment('withdrawal.processed.success');
            
        } catch (error) {
            this.logger.error(`Error processing withdrawal ${withdrawal.id}: ${error.message}`, error);
            this.metrics.increment('withdrawal.processed.failed');
            
            // Update status to failed
            await this.bridgeTransactionRepository.update(
                { id: withdrawal.id },
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
     * Creates a withdrawal from Solana to Ethereum
     * @param token Solana token mint address
     * @param amount Amount to withdraw (in smallest unit)
     * @param recipient Ethereum recipient address
     * @returns Transaction signature
     */
    public async createWithdrawal(
        token: string,
        amount: string,
        recipient: string
    ): Promise<string> {
        try {
            this.logger.info(`Creating withdrawal: ${amount} ${token} to ${recipient}`);
            
            // Check if token is supported
            const isSupported = await this.solanaConnector.isTokenSupported(token);
            
            if (!isSupported) {
                throw new Error(`Token ${token} is not supported`);
            }
            
            // Get token mapping
            const tokenMapping = await this.tokenMappingRepository.findOne({
                where: {
                    solanaToken: token
                }
            });
            
            if (!tokenMapping) {
                throw new Error(`Token mapping not found for Solana token ${token}`);
            }
            
            // Check if recipient is valid
            if (!this.isValidEthereumAddress(recipient)) {
                throw new Error(`Invalid Ethereum recipient address: ${recipient}`);
            }
            
            // Create withdrawal on Solana
            const signature = await this.solanaConnector.withdraw(token, amount, recipient);
            
            this.logger.info(`Withdrawal transaction submitted: ${signature}`);
            this.metrics.increment('withdrawal.created');
            
            return signature;
        } catch (error) {
            this.logger.error(`Error creating withdrawal: ${error.message}`, error);
            this.metrics.increment('withdrawal.creation.errors');
            throw error;
        }
    }
    
    /**
     * Checks if an Ethereum address is valid
     * @param address Ethereum address
     * @returns Whether the address is valid
     */
    private isValidEthereumAddress(address: string): boolean {
        try {
            return ethers.utils.isAddress(address);
        } catch (error) {
            return false;
        }
    }
    
    /**
     * Gets the current Solana slot
     * @returns Current slot
     */
    private async getCurrentSlot(): Promise<number> {
        try {
            return await this.solanaConnector.getCurrentSlot();
        } catch (error) {
            this.logger.error('Error getting current slot', error);
            throw error;
        }
    }
    
    /**
     * Finalizes a withdrawal on Ethereum
     * @param withdrawalId Withdrawal ID
     * @returns Transaction hash
     */
    public async finalizeWithdrawal(withdrawalId: string): Promise<string> {
        try {
            this.logger.info(`Finalizing withdrawal ${withdrawalId}`);
            
            // Get withdrawal transaction
            const withdrawal = await this.bridgeTransactionRepository.findOne({
                where: {
                    id: withdrawalId,
                    type: TransactionType.WITHDRAWAL,
                    status: TransactionStatus.FINALIZING
                }
            });
            
            if (!withdrawal) {
                throw new Error(`Withdrawal ${withdrawalId} not found or not in finalizing state`);
            }
            
            // Check if enough time has passed since finalizing
            const finalizingTime = withdrawal.updatedAt.getTime();
            const currentTime = Date.now();
            
            if (currentTime - finalizingTime < this.config.finalizationDelay) {
                const remainingTime = this.config.finalizationDelay - (currentTime - finalizingTime);
                this.logger.info(`Withdrawal ${withdrawalId} not ready for finalization, waiting ${remainingTime}ms`);
                return null;
            }
            
            // Finalize withdrawal on Ethereum
            const txHash = await this.ethereumConnector.confirmWithdrawal(withdrawal.metadata?.withdrawalHash || withdrawal.sourceTransactionHash);
            
            this.logger.info(`Withdrawal ${withdrawalId} finalization transaction submitted: ${txHash}`);
            this.metrics.increment('withdrawal.finalized');
            
            return txHash;
        } catch (error) {
            this.logger.error(`Error finalizing withdrawal: ${error.message}`, error);
            this.metrics.increment('withdrawal.finalization.errors');
            throw error;
        }
    }
}
