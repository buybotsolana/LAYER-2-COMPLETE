// English comment for verification
/**
 * @file UltraOptimizedBridge.ts
 * @description High-performance bridge implementation between Ethereum and Solana with multi-threading, caching, and metrics
 * 
 * This module provides a complete end-to-end integration between Ethereum and Solana blockchains,
 * handling deposits, withdrawals, and finalization with optimized performance and reliability.
 */

import { Connection, PublicKey, Transaction, TransactionInstruction, Keypair, sendAndConfirmTransaction } from '@solana/web3.js';
import { ethers } from 'ethers';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from './utils/Logger';
import { MetricsCollector } from './utils/MetricsCollector';
import { Cache } from './utils/Cache';
import { Database } from './database/Database';
import { BridgeTransaction, TransactionStatus, TransactionType } from './models/BridgeTransaction';
import { TokenMapping } from './models/TokenMapping';
import { BridgeConfig } from './models/BridgeConfig';
import { EthereumConnector } from './connectors/EthereumConnector';
import { SolanaConnector } from './connectors/SolanaConnector';
import { BlockFinalizationManager } from './finalization/BlockFinalizationManager';
import { SecurityManager } from './security/SecurityManager';
import { EventEmitter } from 'events';

/**
 * Main UltraOptimizedBridge class that orchestrates all bridge operations
 */
export class UltraOptimizedBridge extends EventEmitter {
    private config: BridgeConfig;
    private logger: Logger;
    private metrics: MetricsCollector;
    private cache: Cache;
    private db: Database;
    private ethereumConnector: EthereumConnector;
    private solanaConnector: SolanaConnector;
    private finalizationManager: BlockFinalizationManager;
    private securityManager: SecurityManager;
    private workers: Worker[] = [];
    private isRunning: boolean = false;
    private depositWorkerCount: number = 0;
    private withdrawalWorkerCount: number = 0;
    private finalizationWorkerCount: number = 0;

    /**
     * Creates a new instance of the UltraOptimizedBridge
     * @param config Bridge configuration
     */
    constructor(config: BridgeConfig) {
        super();
        this.config = config;
        
        // Initialize logger
        this.logger = new Logger({
            logLevel: config.logLevel || 'info',
            logFile: config.logFile || path.join(process.cwd(), 'logs', 'bridge.log'),
            console: config.consoleLog !== false
        });
        
        // Initialize metrics collector
        this.metrics = new MetricsCollector({
            metricsInterval: config.metricsInterval || 60000, // Default: 1 minute
            metricsFile: config.metricsFile || path.join(process.cwd(), 'logs', 'metrics.json'),
            enablePrometheus: config.enablePrometheus || false,
            prometheusPort: config.prometheusPort || 9090
        });
        
        // Initialize cache
        this.cache = new Cache({
            ttl: config.cacheTTL || 300000, // Default: 5 minutes
            maxSize: config.cacheMaxSize || 1000,
            persistPath: config.cachePersistPath || path.join(process.cwd(), 'cache')
        });
        
        // Initialize database
        this.db = new Database({
            type: config.dbType || 'postgres',
            host: config.dbHost || 'localhost',
            port: config.dbPort || 5432,
            username: config.dbUsername || 'postgres',
            password: config.dbPassword || 'postgres',
            database: config.dbName || 'bridge',
            synchronize: config.dbSynchronize !== false,
            logging: config.dbLogging || false
        });
        
        // Initialize Ethereum connector
        this.ethereumConnector = new EthereumConnector({
            rpcUrl: config.ethereumRpcUrl,
            privateKey: config.ethereumPrivateKey,
            depositBridgeAddress: config.depositBridgeAddress,
            withdrawalBridgeAddress: config.withdrawalBridgeAddress,
            gasMultiplier: config.ethereumGasMultiplier || 1.2,
            confirmations: config.ethereumConfirmations || 12,
            maxRetries: config.ethereumMaxRetries || 5,
            retryDelay: config.ethereumRetryDelay || 15000
        }, this.logger, this.metrics, this.cache);
        
        // Initialize Solana connector
        this.solanaConnector = new SolanaConnector({
            rpcUrl: config.solanaRpcUrl,
            privateKey: config.solanaPrivateKey,
            depositHandlerProgramId: config.depositHandlerProgramId,
            withdrawalHandlerProgramId: config.withdrawalHandlerProgramId,
            confirmations: config.solanaConfirmations || 32,
            maxRetries: config.solanaMaxRetries || 5,
            retryDelay: config.solanaRetryDelay || 5000
        }, this.logger, this.metrics, this.cache);
        
        // Initialize finalization manager
        this.finalizationManager = new BlockFinalizationManager({
            finalizationContractAddress: config.finalizationContractAddress,
            finalizationInterval: config.finalizationInterval || 3600000, // Default: 1 hour
            challengePeriod: config.challengePeriod || 604800, // Default: 7 days
            maxBlocksPerBatch: config.maxBlocksPerBatch || 50
        }, this.ethereumConnector, this.solanaConnector, this.logger, this.metrics, this.cache);
        
        // Initialize security manager
        this.securityManager = new SecurityManager({
            enableDoubleSpendProtection: config.enableDoubleSpendProtection !== false,
            enableRateLimiting: config.enableRateLimiting !== false,
            maxTransactionsPerMinute: config.maxTransactionsPerMinute || 100,
            maxValuePerTransaction: config.maxValuePerTransaction || ethers.utils.parseEther('100').toString(),
            maxValuePerDay: config.maxValuePerDay || ethers.utils.parseEther('1000').toString(),
            alertThreshold: config.alertThreshold || 0.8,
            alertEmail: config.alertEmail,
            alertWebhook: config.alertWebhook
        }, this.logger, this.metrics);
        
        this.logger.info('UltraOptimizedBridge initialized');
    }

    /**
     * Starts the bridge operations
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            this.logger.warn('Bridge is already running');
            return;
        }

        try {
            this.logger.info('Starting UltraOptimizedBridge...');
            
            // Connect to database
            await this.db.connect();
            this.logger.info('Database connected');
            
            // Initialize Ethereum connector
            await this.ethereumConnector.initialize();
            this.logger.info('Ethereum connector initialized');
            
            // Initialize Solana connector
            await this.solanaConnector.initialize();
            this.logger.info('Solana connector initialized');
            
            // Initialize finalization manager
            await this.finalizationManager.initialize();
            this.logger.info('Finalization manager initialized');
            
            // Initialize security manager
            await this.securityManager.initialize();
            this.logger.info('Security manager initialized');
            
            // Start metrics collector
            this.metrics.start();
            this.logger.info('Metrics collector started');
            
            // Start worker threads
            await this.startWorkers();
            this.logger.info(`Started ${this.workers.length} worker threads`);
            
            this.isRunning = true;
            this.logger.info('UltraOptimizedBridge started successfully');
            this.emit('started');
            
            // Register process exit handlers
            this.registerExitHandlers();
            
        } catch (error) {
            this.logger.error('Failed to start UltraOptimizedBridge', error);
            await this.stop();
            throw error;
        }
    }

    /**
     * Stops the bridge operations
     */
    public async stop(): Promise<void> {
        if (!this.isRunning) {
            this.logger.warn('Bridge is not running');
            return;
        }

        try {
            this.logger.info('Stopping UltraOptimizedBridge...');
            
            // Stop worker threads
            await this.stopWorkers();
            this.logger.info('Worker threads stopped');
            
            // Stop metrics collector
            this.metrics.stop();
            this.logger.info('Metrics collector stopped');
            
            // Disconnect from database
            await this.db.disconnect();
            this.logger.info('Database disconnected');
            
            // Persist cache
            await this.cache.persist();
            this.logger.info('Cache persisted');
            
            this.isRunning = false;
            this.logger.info('UltraOptimizedBridge stopped successfully');
            this.emit('stopped');
            
        } catch (error) {
            this.logger.error('Error stopping UltraOptimizedBridge', error);
            throw error;
        }
    }

    /**
     * Starts worker threads for parallel processing
     */
    private async startWorkers(): Promise<void> {
        const cpuCount = os.cpus().length;
        
        // Calculate optimal worker counts based on CPU cores and configuration
        this.depositWorkerCount = Math.max(1, Math.min(
            this.config.depositWorkerCount || Math.floor(cpuCount / 3),
            cpuCount - 1
        ));
        
        this.withdrawalWorkerCount = Math.max(1, Math.min(
            this.config.withdrawalWorkerCount || Math.floor(cpuCount / 3),
            cpuCount - 1
        ));
        
        this.finalizationWorkerCount = Math.max(1, Math.min(
            this.config.finalizationWorkerCount || 1,
            cpuCount - 1
        ));
        
        // Start deposit workers
        for (let i = 0; i < this.depositWorkerCount; i++) {
            const worker = new Worker(path.join(__dirname, 'workers', 'deposit.worker.js'), {
                workerData: {
                    workerId: `deposit-${i}`,
                    config: this.config
                }
            });
            
            worker.on('message', this.handleWorkerMessage.bind(this));
            worker.on('error', (error) => {
                this.logger.error(`Deposit worker ${i} error`, error);
                this.metrics.increment('worker.deposit.errors');
                // Restart worker if it crashes
                this.restartWorker(worker, 'deposit', i);
            });
            
            this.workers.push(worker);
            this.logger.info(`Started deposit worker ${i}`);
        }
        
        // Start withdrawal workers
        for (let i = 0; i < this.withdrawalWorkerCount; i++) {
            const worker = new Worker(path.join(__dirname, 'workers', 'withdrawal.worker.js'), {
                workerData: {
                    workerId: `withdrawal-${i}`,
                    config: this.config
                }
            });
            
            worker.on('message', this.handleWorkerMessage.bind(this));
            worker.on('error', (error) => {
                this.logger.error(`Withdrawal worker ${i} error`, error);
                this.metrics.increment('worker.withdrawal.errors');
                // Restart worker if it crashes
                this.restartWorker(worker, 'withdrawal', i);
            });
            
            this.workers.push(worker);
            this.logger.info(`Started withdrawal worker ${i}`);
        }
        
        // Start finalization workers
        for (let i = 0; i < this.finalizationWorkerCount; i++) {
            const worker = new Worker(path.join(__dirname, 'workers', 'finalization.worker.js'), {
                workerData: {
                    workerId: `finalization-${i}`,
                    config: this.config
                }
            });
            
            worker.on('message', this.handleWorkerMessage.bind(this));
            worker.on('error', (error) => {
                this.logger.error(`Finalization worker ${i} error`, error);
                this.metrics.increment('worker.finalization.errors');
                // Restart worker if it crashes
                this.restartWorker(worker, 'finalization', i);
            });
            
            this.workers.push(worker);
            this.logger.info(`Started finalization worker ${i}`);
        }
    }

    /**
     * Stops all worker threads
     */
    private async stopWorkers(): Promise<void> {
        const terminationPromises = this.workers.map(worker => {
            return new Promise<void>((resolve) => {
                worker.once('exit', () => {
                    resolve();
                });
                worker.postMessage({ type: 'terminate' });
            });
        });
        
        await Promise.all(terminationPromises);
        this.workers = [];
    }

    /**
     * Restarts a worker thread if it crashes
     * @param worker The worker that crashed
     * @param type Type of worker (deposit, withdrawal, finalization)
     * @param index Index of the worker
     */
    private restartWorker(worker: Worker, type: string, index: number): void {
        // Remove the crashed worker from the array
        const workerIndex = this.workers.indexOf(worker);
        if (workerIndex !== -1) {
            this.workers.splice(workerIndex, 1);
        }
        
        // Create a new worker
        const newWorker = new Worker(path.join(__dirname, 'workers', `${type}.worker.js`), {
            workerData: {
                workerId: `${type}-${index}`,
                config: this.config
            }
        });
        
        newWorker.on('message', this.handleWorkerMessage.bind(this));
        newWorker.on('error', (error) => {
            this.logger.error(`${type} worker ${index} error`, error);
            this.metrics.increment(`worker.${type}.errors`);
            // Restart worker if it crashes
            this.restartWorker(newWorker, type, index);
        });
        
        this.workers.push(newWorker);
        this.logger.info(`Restarted ${type} worker ${index}`);
    }

    /**
     * Handles messages from worker threads
     * @param message Message from worker
     */
    private handleWorkerMessage(message: any): void {
        switch (message.type) {
            case 'log':
                this.logger[message.level](message.message, message.meta);
                break;
                
            case 'metric':
                if (message.metricType === 'increment') {
                    this.metrics.increment(message.name, message.value);
                } else if (message.metricType === 'gauge') {
                    this.metrics.gauge(message.name, message.value);
                } else if (message.metricType === 'histogram') {
                    this.metrics.histogram(message.name, message.value);
                }
                break;
                
            case 'transaction':
                this.emit('transaction', message.transaction);
                break;
                
            case 'deposit':
                this.emit('deposit', message.deposit);
                break;
                
            case 'withdrawal':
                this.emit('withdrawal', message.withdrawal);
                break;
                
            case 'finalization':
                this.emit('finalization', message.finalization);
                break;
                
            case 'error':
                this.logger.error(message.error, message.meta);
                this.emit('error', message.error);
                break;
                
            default:
                this.logger.warn(`Unknown message type: ${message.type}`, message);
        }
    }

    /**
     * Registers process exit handlers
     */
    private registerExitHandlers(): void {
        // Handle process termination signals
        process.on('SIGINT', async () => {
            this.logger.info('Received SIGINT signal');
            await this.stop();
            process.exit(0);
        });
        
        process.on('SIGTERM', async () => {
            this.logger.info('Received SIGTERM signal');
            await this.stop();
            process.exit(0);
        });
        
        // Handle uncaught exceptions
        process.on('uncaughtException', async (error) => {
            this.logger.error('Uncaught exception', error);
            await this.stop();
            process.exit(1);
        });
        
        // Handle unhandled promise rejections
        process.on('unhandledRejection', async (reason) => {
            this.logger.error('Unhandled promise rejection', reason);
            await this.stop();
            process.exit(1);
        });
    }

    /**
     * Initiates a deposit from Ethereum to Solana
     * @param token Ethereum token address (or 'ETH' for native Ether)
     * @param amount Amount to deposit (in smallest unit, e.g., wei)
     * @param recipient Solana recipient address
     * @returns Transaction hash
     */
    public async depositFromEthereumToSolana(
        token: string,
        amount: string,
        recipient: string
    ): Promise<string> {
        this.logger.info(`Initiating deposit from Ethereum to Solana: ${amount} ${token} to ${recipient}`);
        
        // Validate parameters
        if (!this.isRunning) {
            throw new Error('Bridge is not running');
        }
        
        if (!token || !amount || !recipient) {
            throw new Error('Invalid parameters: token, amount, and recipient are required');
        }
        
        // Check if token is supported
        const isSupported = await this.ethereumConnector.isTokenSupported(token);
        if (!isSupported) {
            throw new Error(`Token ${token} is not supported`);
        }
        
        // Validate recipient address
        try {
            new PublicKey(recipient);
        } catch (error) {
            throw new Error(`Invalid Solana recipient address: ${recipient}`);
        }
        
        // Check security constraints
        await this.securityManager.validateDeposit(token, amount);
        
        // Create transaction record
        const transaction = await this.db.createTransaction({
            type: TransactionType.DEPOSIT,
            status: TransactionStatus.PENDING,
            sourceChain: 'ethereum',
            targetChain: 'solana',
            sourceAddress: await this.ethereumConnector.getAddress(),
            targetAddress: recipient,
            token,
            amount,
            timestamp: Date.now()
        });
        
        // Execute deposit
        try {
            const txHash = await this.ethereumConnector.deposit(token, amount, recipient);
            
            // Update transaction record
            await this.db.updateTransaction(transaction.id, {
                status: TransactionStatus.PROCESSING,
                sourceTransactionHash: txHash
            });
            
            // Emit event
            this.emit('depositInitiated', {
                transactionId: transaction.id,
                token,
                amount,
                recipient,
                txHash
            });
            
            // Update metrics
            this.metrics.increment('deposit.initiated');
            this.metrics.histogram('deposit.amount', parseFloat(ethers.utils.formatEther(amount)));
            
            return txHash;
        } catch (error) {
            // Update transaction record
            await this.db.updateTransaction(transaction.id, {
                status: TransactionStatus.FAILED,
                error: error.message
            });
            
            // Update metrics
            this.metrics.increment('deposit.failed');
            
            this.logger.error(`Deposit failed: ${error.message}`, error);
            throw error;
        }
    }

    /**
     * Initiates a withdrawal from Solana to Ethereum
     * @param token Solana token mint address
     * @param amount Amount to withdraw (in smallest unit)
     * @param recipient Ethereum recipient address
     * @returns Transaction signature
     */
    public async withdrawFromSolanaToEthereum(
        token: string,
        amount: string,
        recipient: string
    ): Promise<string> {
        this.logger.info(`Initiating withdrawal from Solana to Ethereum: ${amount} ${token} to ${recipient}`);
        
        // Validate parameters
        if (!this.isRunning) {
            throw new Error('Bridge is not running');
        }
        
        if (!token || !amount || !recipient) {
            throw new Error('Invalid parameters: token, amount, and recipient are required');
        }
        
        // Check if token is supported
        const isSupported = await this.solanaConnector.isTokenSupported(token);
        if (!isSupported) {
            throw new Error(`Token ${token} is not supported`);
        }
        
        // Validate recipient address
        if (!ethers.utils.isAddress(recipient)) {
            throw new Error(`Invalid Ethereum recipient address: ${recipient}`);
        }
        
        // Check security constraints
        await this.securityManager.validateWithdrawal(token, amount);
        
        // Create transaction record
        const transaction = await this.db.createTransaction({
            type: TransactionType.WITHDRAWAL,
            status: TransactionStatus.PENDING,
            sourceChain: 'solana',
            targetChain: 'ethereum',
            sourceAddress: await this.solanaConnector.getAddress(),
            targetAddress: recipient,
            token,
            amount,
            timestamp: Date.now()
        });
        
        // Execute withdrawal
        try {
            const signature = await this.solanaConnector.withdraw(token, amount, recipient);
            
            // Update transaction record
            await this.db.updateTransaction(transaction.id, {
                status: TransactionStatus.PROCESSING,
                sourceTransactionHash: signature
            });
            
            // Emit event
            this.emit('withdrawalInitiated', {
                transactionId: transaction.id,
                token,
                amount,
                recipient,
                signature
            });
            
            // Update metrics
            this.metrics.increment('withdrawal.initiated');
            this.metrics.histogram('withdrawal.amount', parseFloat(amount) / 1e9); // Convert lamports to SOL
            
            return signature;
        } catch (error) {
            // Update transaction record
            await this.db.updateTransaction(transaction.id, {
                status: TransactionStatus.FAILED,
                error: error.message
            });
            
            // Update metrics
            this.metrics.increment('withdrawal.failed');
            
            this.logger.error(`Withdrawal failed: ${error.message}`, error);
            throw error;
        }
    }

    /**
     * Gets the status of a transaction
     * @param transactionId Transaction ID
     * @returns Transaction status
     */
    public async getTransactionStatus(transactionId: string): Promise<BridgeTransaction> {
        return await this.db.getTransaction(transactionId);
    }

    /**
     * Gets all transactions with optional filtering
     * @param filter Filter options
     * @returns List of transactions
     */
    public async getTransactions(filter?: {
        type?: TransactionType,
        status?: TransactionStatus,
        sourceChain?: string,
        targetChain?: string,
        fromTimestamp?: number,
        toTimestamp?: number,
        limit?: number,
        offset?: number
    }): Promise<BridgeTransaction[]> {
        return await this.db.getTransactions(filter);
    }

    /**
     * Gets the token mappings between Ethereum and Solana
     * @returns List of token mappings
     */
    public async getTokenMappings(): Promise<TokenMapping[]> {
        return await this.db.getTokenMappings();
    }

    /**
     * Adds a token mapping between Ethereum and Solana
     * @param ethereumToken Ethereum token address
     * @param solanaToken Solana token mint address
     * @param symbol Token symbol
     * @param decimals Token decimals
     * @returns Created token mapping
     */
    public async addTokenMapping(
        ethereumToken: string,
        solanaToken: string,
        symbol: string,
        decimals: number
    ): Promise<TokenMapping> {
        // Validate parameters
        if (!ethereumToken || !solanaToken || !symbol) {
            throw new Error('Invalid parameters: ethereumToken, solanaToken, and symbol are required');
        }
        
        if (!ethers.utils.isAddress(ethereumToken)) {
            throw new Error(`Invalid Ethereum token address: ${ethereumToken}`);
        }
        
        try {
            new PublicKey(solanaToken);
        } catch (error) {
            throw new Error(`Invalid Solana token address: ${solanaToken}`);
        }
        
        // Add token mapping to Ethereum bridge
        await this.ethereumConnector.addSupportedToken(ethereumToken, solanaToken);
        
        // Add token mapping to Solana bridge
        await this.solanaConnector.addTokenMapping(ethereumToken, solanaToken);
        
        // Add token mapping to database
        const mapping = await this.db.addTokenMapping({
            ethereumToken,
            solanaToken,
            symbol,
            decimals,
            active: true
        });
        
        this.logger.info(`Added token mapping: ${symbol} - ETH:${ethereumToken} <-> SOL:${solanaToken}`);
        
        return mapping;
    }

    /**
     * Gets bridge statistics
     * @returns Bridge statistics
     */
    public async getStatistics(): Promise<any> {
        const stats = {
            totalTransactions: await this.db.getTransactionCount(),
            pendingTransactions: await this.db.getTransactionCount({ status: TransactionStatus.PENDING }),
            processingTransactions: await this.db.getTransactionCount({ status: TransactionStatus.PROCESSING }),
            completedTransactions: await this.db.getTransactionCount({ status: TransactionStatus.COMPLETED }),
            failedTransactions: await this.db.getTransactionCount({ status: TransactionStatus.FAILED }),
            
            totalDeposits: await this.db.getTransactionCount({ type: TransactionType.DEPOSIT }),
            totalWithdrawals: await this.db.getTransactionCount({ type: TransactionType.WITHDRAWAL }),
            
            tokenMappings: await this.db.getTokenMappingCount(),
            
            ethereumBalance: await this.ethereumConnector.getBalance(),
            solanaBalance: await this.solanaConnector.getBalance(),
            
            workers: {
                total: this.workers.length,
                deposit: this.depositWorkerCount,
                withdrawal: this.withdrawalWorkerCount,
                finalization: this.finalizationWorkerCount
            },
            
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            
            metrics: this.metrics.getAll()
        };
        
        return stats;
    }
}
