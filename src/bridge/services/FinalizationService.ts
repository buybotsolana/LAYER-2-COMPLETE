// English comment for verification
/**
 * @file FinalizationService.ts
 * @description Service for handling block finalization between Ethereum and Solana
 * 
 * This service manages the finalization of Layer-2 blocks on Ethereum,
 * ensuring that the state transitions are properly verified and committed.
 */

import { EthereumConnector } from '../connectors/EthereumConnector';
import { SolanaConnector } from '../connectors/SolanaConnector';
import { Logger } from '../utils/Logger';
import { MetricsCollector } from '../utils/MetricsCollector';
import { Cache } from '../utils/Cache';
import { Repository, Between, LessThan, MoreThan, In } from 'typeorm';
import { BlockFinalization, BlockFinalizationState } from '../models/BlockFinalization';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import * as path from 'path';
import * as os from 'os';
import { ethers } from 'ethers';
import * as crypto from 'crypto';

/**
 * Configuration for the finalization service
 */
export interface FinalizationServiceConfig {
    /**
     * Number of worker threads for processing finalizations
     */
    workerCount?: number;
    
    /**
     * Polling interval for checking new blocks (ms)
     */
    pollingInterval?: number;
    
    /**
     * Maximum number of blocks to process in a batch
     */
    batchSize?: number;
    
    /**
     * Maximum number of retry attempts for failed finalizations
     */
    maxRetries?: number;
    
    /**
     * Delay between retry attempts (ms)
     */
    retryDelay?: number;
    
    /**
     * Challenge period in seconds
     */
    challengePeriod?: number;
    
    /**
     * Whether to enable automatic processing of finalizations
     */
    autoProcess?: boolean;
    
    /**
     * Whether to enable automatic retries for failed finalizations
     */
    autoRetry?: boolean;
    
    /**
     * Finalization contract address on Ethereum
     */
    finalizationContractAddress: string;
    
    /**
     * Finalization interval in milliseconds
     */
    finalizationInterval?: number;
    
    /**
     * Maximum number of blocks per finalization batch
     */
    maxBlocksPerBatch?: number;
    
    /**
     * Whether to enable fraud proof verification
     */
    enableFraudProofVerification?: boolean;
    
    /**
     * Whether to enable automatic challenge response
     */
    enableAutomaticChallengeResponse?: boolean;
}

/**
 * Finalization service class for handling block finalization between Ethereum and Solana
 */
export class FinalizationService {
    private config: FinalizationServiceConfig;
    private logger: Logger;
    private metrics: MetricsCollector;
    private cache: Cache;
    private ethereumConnector: EthereumConnector;
    private solanaConnector: SolanaConnector;
    private blockFinalizationRepository: Repository<BlockFinalization>;
    
    private workers: Worker[] = [];
    private isRunning: boolean = false;
    private pollingInterval: NodeJS.Timeout | null = null;
    private finalizationInterval: NodeJS.Timeout | null = null;
    private lastProcessedBlock: number = 0;
    
    /**
     * Creates a new instance of the finalization service
     * @param config Finalization service configuration
     * @param logger Logger instance
     * @param metrics Metrics collector instance
     * @param cache Cache instance
     * @param ethereumConnector Ethereum connector instance
     * @param solanaConnector Solana connector instance
     * @param blockFinalizationRepository Block finalization repository
     */
    constructor(
        config: FinalizationServiceConfig,
        logger: Logger,
        metrics: MetricsCollector,
        cache: Cache,
        ethereumConnector: EthereumConnector,
        solanaConnector: SolanaConnector,
        blockFinalizationRepository: Repository<BlockFinalization>
    ) {
        this.config = {
            ...config,
            workerCount: config.workerCount || Math.max(1, os.cpus().length - 1),
            pollingInterval: config.pollingInterval || 60000, // 1 minute
            batchSize: config.batchSize || 50,
            maxRetries: config.maxRetries || 5,
            retryDelay: config.retryDelay || 300000, // 5 minutes
            challengePeriod: config.challengePeriod || 604800, // 7 days in seconds
            autoProcess: config.autoProcess !== false,
            autoRetry: config.autoRetry !== false,
            finalizationInterval: config.finalizationInterval || 3600000, // 1 hour
            maxBlocksPerBatch: config.maxBlocksPerBatch || 100,
            enableFraudProofVerification: config.enableFraudProofVerification !== false,
            enableAutomaticChallengeResponse: config.enableAutomaticChallengeResponse !== false
        };
        
        this.logger = logger;
        this.metrics = metrics;
        this.cache = cache;
        this.ethereumConnector = ethereumConnector;
        this.solanaConnector = solanaConnector;
        this.blockFinalizationRepository = blockFinalizationRepository;
    }
    
    /**
     * Initializes the finalization service
     */
    public async initialize(): Promise<void> {
        this.logger.info('Initializing finalization service...');
        
        try {
            // Initialize workers if in main thread
            if (isMainThread) {
                await this.initializeWorkers();
            }
            
            // Get last processed block
            const lastFinalization = await this.blockFinalizationRepository.findOne({
                order: {
                    blockNumber: 'DESC'
                }
            });
            
            if (lastFinalization) {
                this.lastProcessedBlock = lastFinalization.blockNumber;
                this.logger.info(`Last processed block: ${this.lastProcessedBlock}`);
            } else {
                this.logger.info('No previous finalizations found, starting from scratch');
            }
            
            this.logger.info('Finalization service initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize finalization service', error);
            throw error;
        }
    }
    
    /**
     * Initializes worker threads for processing finalizations
     */
    private async initializeWorkers(): Promise<void> {
        if (this.config.workerCount <= 1) {
            this.logger.info('Running in single-threaded mode');
            return;
        }
        
        this.logger.info(`Initializing ${this.config.workerCount} worker threads for finalization processing`);
        
        for (let i = 0; i < this.config.workerCount; i++) {
            const worker = new Worker(path.resolve(__dirname, 'FinalizationWorker.js'), {
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
                this.metrics.increment('finalization.worker.errors');
                
                // Restart worker
                this.restartWorker(i);
            });
            
            worker.on('exit', (code) => {
                if (code !== 0) {
                    this.logger.warn(`Worker ${i} exited with code ${code}`);
                    this.metrics.increment('finalization.worker.exits');
                    
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
        
        const worker = new Worker(path.resolve(__dirname, 'FinalizationWorker.js'), {
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
            this.metrics.increment('finalization.worker.errors');
            
            // Restart worker
            this.restartWorker(index);
        });
        
        worker.on('exit', (code) => {
            if (code !== 0) {
                this.logger.warn(`Worker ${index} exited with code ${code}`);
                this.metrics.increment('finalization.worker.exits');
                
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
                this.logger.info(`Block ${result.blockNumber} finalized successfully`);
                this.metrics.increment('finalization.processed.success');
                
                // Update block finalization status
                await this.blockFinalizationRepository.update(
                    { id: result.finalizationId },
                    {
                        state: BlockFinalizationState.FINALIZED,
                        finalizationTime: Date.now(),
                        finalizationTransactionHash: result.txHash,
                        finalizationGasUsed: result.gasUsed
                    }
                );
            } else {
                this.logger.error(`Block ${result.blockNumber} finalization failed: ${result.error}`);
                this.metrics.increment('finalization.processed.failed');
                
                // Update block finalization status
                await this.blockFinalizationRepository.update(
                    { id: result.finalizationId },
                    {
                        state: result.invalidated ? BlockFinalizationState.INVALIDATED : BlockFinalizationState.PROPOSED,
                        error: result.error
                    }
                );
            }
        } catch (error) {
            this.logger.error('Error handling worker result', error);
        }
    }
    
    /**
     * Starts the finalization service
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            this.logger.warn('Finalization service already running');
            return;
        }
        
        this.logger.info('Starting finalization service...');
        
        try {
            this.isRunning = true;
            
            // Start polling for pending finalizations
            if (this.config.autoProcess) {
                this.startPolling();
            }
            
            // Start finalization interval
            this.startFinalizationInterval();
            
            this.logger.info('Finalization service started successfully');
        } catch (error) {
            this.isRunning = false;
            this.logger.error('Failed to start finalization service', error);
            throw error;
        }
    }
    
    /**
     * Stops the finalization service
     */
    public async stop(): Promise<void> {
        if (!this.isRunning) {
            this.logger.warn('Finalization service not running');
            return;
        }
        
        this.logger.info('Stopping finalization service...');
        
        try {
            this.isRunning = false;
            
            // Stop polling
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
                this.pollingInterval = null;
            }
            
            // Stop finalization interval
            if (this.finalizationInterval) {
                clearInterval(this.finalizationInterval);
                this.finalizationInterval = null;
            }
            
            // Terminate workers
            for (const worker of this.workers) {
                worker.terminate();
            }
            
            this.workers = [];
            
            this.logger.info('Finalization service stopped successfully');
        } catch (error) {
            this.logger.error('Failed to stop finalization service', error);
            throw error;
        }
    }
    
    /**
     * Starts polling for pending finalizations
     */
    private startPolling(): void {
        this.logger.info(`Starting finalization polling with interval ${this.config.pollingInterval}ms`);
        
        // Process immediately
        this.processPendingFinalizations();
        
        // Set up interval
        this.pollingInterval = setInterval(() => {
            this.processPendingFinalizations();
        }, this.config.pollingInterval);
    }
    
    /**
     * Starts the finalization interval
     */
    private startFinalizationInterval(): void {
        this.logger.info(`Starting finalization interval with period ${this.config.finalizationInterval}ms`);
        
        // Process immediately
        this.proposeNewFinalization();
        
        // Set up interval
        this.finalizationInterval = setInterval(() => {
            this.proposeNewFinalization();
        }, this.config.finalizationInterval);
    }
    
    /**
     * Processes pending finalizations
     */
    private async processPendingFinalizations(): Promise<void> {
        if (!this.isRunning) {
            return;
        }
        
        try {
            this.logger.debug('Processing pending finalizations...');
            
            // Find proposed finalizations that are ready to be finalized
            const pendingFinalizations = await this.blockFinalizationRepository.find({
                where: {
                    state: BlockFinalizationState.PROPOSED,
                    expectedFinalizationTime: LessThan(Date.now())
                },
                take: this.config.batchSize,
                order: {
                    blockNumber: 'ASC'
                }
            });
            
            if (pendingFinalizations.length === 0) {
                this.logger.debug('No pending finalizations to process');
                return;
            }
            
            this.logger.info(`Found ${pendingFinalizations.length} pending finalizations to process`);
            this.metrics.gauge('finalization.pending', pendingFinalizations.length);
            
            // Process finalizations
            if (this.workers.length > 0) {
                // Distribute finalizations among workers
                const finalizationsPerWorker = Math.ceil(pendingFinalizations.length / this.workers.length);
                
                for (let i = 0; i < this.workers.length; i++) {
                    const start = i * finalizationsPerWorker;
                    const end = Math.min(start + finalizationsPerWorker, pendingFinalizations.length);
                    
                    if (start < end) {
                        const workerFinalizations = pendingFinalizations.slice(start, end);
                        
                        this.workers[i].postMessage({
                            type: 'process',
                            finalizations: workerFinalizations
                        });
                    }
                }
            } else {
                // Process finalizations in main thread
                for (const finalization of pendingFinalizations) {
                    await this.processFinalization(finalization);
                }
            }
        } catch (error) {
            this.logger.error('Error processing pending finalizations', error);
            this.metrics.increment('finalization.processing.errors');
        }
    }
    
    /**
     * Proposes a new finalization
     */
    private async proposeNewFinalization(): Promise<void> {
        if (!this.isRunning) {
            return;
        }
        
        try {
            this.logger.info('Proposing new finalization...');
            
            // Get latest Solana blocks
            const currentSlot = await this.solanaConnector.getCurrentSlot();
            const fromBlock = this.lastProcessedBlock + 1;
            const toBlock = Math.min(currentSlot, fromBlock + this.config.maxBlocksPerBatch - 1);
            
            if (fromBlock > toBlock) {
                this.logger.debug('No new blocks to finalize');
                return;
            }
            
            this.logger.info(`Proposing finalization for blocks ${fromBlock} to ${toBlock}`);
            
            // Get block data from Solana
            const blocks = await this.solanaConnector.getBlocks(fromBlock, toBlock);
            
            if (blocks.length === 0) {
                this.logger.warn(`No blocks found in range ${fromBlock}-${toBlock}`);
                return;
            }
            
            // Process each block
            for (const block of blocks) {
                await this.proposeBlock(block);
            }
            
            // Update last processed block
            this.lastProcessedBlock = toBlock;
            
        } catch (error) {
            this.logger.error('Error proposing new finalization', error);
            this.metrics.increment('finalization.proposal.errors');
        }
    }
    
    /**
     * Proposes a block for finalization
     * @param block Block data
     */
    private async proposeBlock(block: any): Promise<void> {
        try {
            const { slot, blockhash, parentBlockhash, transactions } = block;
            
            this.logger.info(`Proposing block ${slot} with hash ${blockhash}`);
            
            // Check if block already exists
            const existingBlock = await this.blockFinalizationRepository.findOne({
                where: {
                    blockNumber: slot
                }
            });
            
            if (existingBlock) {
                this.logger.info(`Block ${slot} already exists with ID ${existingBlock.id}`);
                return;
            }
            
            // Calculate state root
            const stateRoot = this.calculateStateRoot(block);
            
            // Calculate transactions root
            const transactionsRoot = this.calculateTransactionsRoot(transactions);
            
            // Create block finalization
            const blockFinalization = new BlockFinalization();
            blockFinalization.blockHash = blockhash;
            blockFinalization.stateRoot = stateRoot;
            blockFinalization.parentBlockHash = parentBlockhash;
            blockFinalization.blockNumber = slot;
            blockFinalization.blockTimestamp = Date.now();
            blockFinalization.proposer = await this.ethereumConnector.getAddress();
            blockFinalization.proposalTime = Date.now();
            blockFinalization.state = BlockFinalizationState.PROPOSED;
            blockFinalization.transactionCount = transactions.length;
            blockFinalization.transactionsRoot = transactionsRoot;
            blockFinalization.expectedFinalizationTime = Date.now() + (this.config.challengePeriod * 1000);
            
            // Save block finalization
            const savedFinalization = await this.blockFinalizationRepository.save(blockFinalization);
            
            this.logger.info(`Created block finalization ${savedFinalization.id} for block ${slot}`);
            
            // Propose block on Ethereum
            const txHash = await this.ethereumConnector.proposeBlock(
                slot,
                blockhash,
                parentBlockhash,
                stateRoot,
                transactionsRoot,
                transactions.length
            );
            
            // Update block finalization with transaction hash
            await this.blockFinalizationRepository.update(
                { id: savedFinalization.id },
                {
                    proposalTransactionHash: txHash
                }
            );
            
            this.logger.info(`Block ${slot} proposed with transaction ${txHash}`);
            this.metrics.increment('finalization.blocks.proposed');
            
        } catch (error) {
            this.logger.error(`Error proposing block: ${error.message}`, error);
            this.metrics.increment('finalization.blocks.proposal.errors');
        }
    }
    
    /**
     * Processes a finalization
     * @param finalization Block finalization
     */
    public async processFinalization(finalization: BlockFinalization): Promise<void> {
        try {
            this.logger.info(`Processing finalization ${finalization.id} for block ${finalization.blockNumber}`);
            
            // Check if there are any challenges
            const challenges = await this.ethereumConnector.getChallenges(finalization.blockNumber);
            
            if (challenges.length > 0) {
                this.logger.warn(`Block ${finalization.blockNumber} has ${challenges.length} challenges, cannot finalize`);
                
                // Update block finalization status
                await this.blockFinalizationRepository.update(
                    { id: finalization.id },
                    {
                        state: BlockFinalizationState.CHALLENGED,
                        challengeId: challenges[0].challengeId
                    }
                );
                
                // Handle challenges if automatic challenge response is enabled
                if (this.config.enableAutomaticChallengeResponse) {
                    for (const challenge of challenges) {
                        await this.handleChallenge(finalization, challenge);
                    }
                }
                
                return;
            }
            
            // Finalize block on Ethereum
            const txHash = await this.ethereumConnector.finalizeBlock(
                finalization.blockNumber,
                finalization.blockHash,
                finalization.stateRoot,
                finalization.transactionsRoot
            );
            
            // Update block finalization status
            await this.blockFinalizationRepository.update(
                { id: finalization.id },
                {
                    state: BlockFinalizationState.FINALIZED,
                    finalizationTime: Date.now(),
                    finalizationTransactionHash: txHash
                }
            );
            
            this.logger.info(`Block ${finalization.blockNumber} finalized with transaction ${txHash}`);
            this.metrics.increment('finalization.blocks.finalized');
            
        } catch (error) {
            this.logger.error(`Error processing finalization ${finalization.id}: ${error.message}`, error);
            this.metrics.increment('finalization.processing.errors');
            
            // Update block finalization status
            await this.blockFinalizationRepository.update(
                { id: finalization.id },
                {
                    error: error.message
                }
            );
        }
    }
    
    /**
     * Handles a challenge
     * @param finalization Block finalization
     * @param challenge Challenge data
     */
    private async handleChallenge(finalization: BlockFinalization, challenge: any): Promise<void> {
        try {
            this.logger.info(`Handling challenge ${challenge.challengeId} for block ${finalization.blockNumber}`);
            
            // Get block data from Solana
            const block = await this.solanaConnector.getBlock(finalization.blockNumber);
            
            if (!block) {
                this.logger.error(`Block ${finalization.blockNumber} not found on Solana`);
                return;
            }
            
            // Verify challenge
            const isValid = await this.verifyChallenge(finalization, challenge, block);
            
            if (isValid) {
                // Challenge is valid, invalidate block
                await this.blockFinalizationRepository.update(
                    { id: finalization.id },
                    {
                        state: BlockFinalizationState.INVALIDATED
                    }
                );
                
                this.logger.warn(`Challenge ${challenge.challengeId} for block ${finalization.blockNumber} is valid, block invalidated`);
                this.metrics.increment('finalization.challenges.valid');
            } else {
                // Challenge is invalid, respond to challenge
                const txHash = await this.ethereumConnector.respondToChallenge(
                    challenge.challengeId,
                    finalization.blockNumber,
                    finalization.blockHash,
                    finalization.stateRoot,
                    finalization.transactionsRoot,
                    this.generateProof(finalization, block)
                );
                
                this.logger.info(`Responded to challenge ${challenge.challengeId} with transaction ${txHash}`);
                this.metrics.increment('finalization.challenges.responded');
            }
        } catch (error) {
            this.logger.error(`Error handling challenge: ${error.message}`, error);
            this.metrics.increment('finalization.challenges.errors');
        }
    }
    
    /**
     * Verifies a challenge
     * @param finalization Block finalization
     * @param challenge Challenge data
     * @param block Block data
     * @returns Whether the challenge is valid
     */
    private async verifyChallenge(
        finalization: BlockFinalization,
        challenge: any,
        block: any
    ): Promise<boolean> {
        try {
            // Implement challenge verification logic
            // This is a simplified example, real implementation would depend on the specific challenge type
            
            const { challengeType, data } = challenge;
            
            switch (challengeType) {
                case 'invalidStateRoot':
                    // Verify state root
                    const calculatedStateRoot = this.calculateStateRoot(block);
                    return calculatedStateRoot !== finalization.stateRoot;
                
                case 'invalidTransactionsRoot':
                    // Verify transactions root
                    const calculatedTransactionsRoot = this.calculateTransactionsRoot(block.transactions);
                    return calculatedTransactionsRoot !== finalization.transactionsRoot;
                
                case 'invalidParentHash':
                    // Verify parent hash
                    return block.parentBlockhash !== finalization.parentBlockHash;
                
                case 'invalidTransaction':
                    // Verify specific transaction
                    const { transactionIndex, expectedHash } = data;
                    if (transactionIndex >= block.transactions.length) {
                        return true; // Invalid transaction index
                    }
                    const transaction = block.transactions[transactionIndex];
                    const transactionHash = this.hashTransaction(transaction);
                    return transactionHash !== expectedHash;
                
                default:
                    this.logger.warn(`Unknown challenge type: ${challengeType}`);
                    return false;
            }
        } catch (error) {
            this.logger.error(`Error verifying challenge: ${error.message}`, error);
            return false;
        }
    }
    
    /**
     * Generates a proof for a challenge response
     * @param finalization Block finalization
     * @param block Block data
     * @returns Proof data
     */
    private generateProof(finalization: BlockFinalization, block: any): any {
        // Implement proof generation logic
        // This is a simplified example, real implementation would depend on the specific challenge type
        
        return {
            blockHash: finalization.blockHash,
            stateRoot: finalization.stateRoot,
            transactionsRoot: finalization.transactionsRoot,
            parentBlockHash: finalization.parentBlockHash,
            transactionCount: finalization.transactionCount,
            timestamp: finalization.blockTimestamp
        };
    }
    
    /**
     * Calculates the state root for a block
     * @param block Block data
     * @returns State root
     */
    private calculateStateRoot(block: any): string {
        // Implement state root calculation logic
        // This is a simplified example, real implementation would use a Merkle tree
        
        const stateData = JSON.stringify({
            slot: block.slot,
            blockhash: block.blockhash,
            parentBlockhash: block.parentBlockhash,
            transactionCount: block.transactions.length,
            timestamp: Date.now()
        });
        
        return '0x' + crypto.createHash('sha256').update(stateData).digest('hex');
    }
    
    /**
     * Calculates the transactions root for a block
     * @param transactions Block transactions
     * @returns Transactions root
     */
    private calculateTransactionsRoot(transactions: any[]): string {
        // Implement transactions root calculation logic
        // This is a simplified example, real implementation would use a Merkle tree
        
        const transactionHashes = transactions.map(tx => this.hashTransaction(tx));
        const transactionsData = JSON.stringify(transactionHashes);
        
        return '0x' + crypto.createHash('sha256').update(transactionsData).digest('hex');
    }
    
    /**
     * Hashes a transaction
     * @param transaction Transaction data
     * @returns Transaction hash
     */
    private hashTransaction(transaction: any): string {
        // Implement transaction hashing logic
        const transactionData = JSON.stringify(transaction);
        
        return '0x' + crypto.createHash('sha256').update(transactionData).digest('hex');
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
     * Creates a challenge for a block
     * @param blockNumber Block number
     * @param challengeType Challenge type
     * @param data Challenge data
     * @returns Transaction hash
     */
    public async createChallenge(
        blockNumber: number,
        challengeType: string,
        data: any
    ): Promise<string> {
        try {
            this.logger.info(`Creating challenge for block ${blockNumber}: ${challengeType}`);
            
            // Get block finalization
            const finalization = await this.blockFinalizationRepository.findOne({
                where: {
                    blockNumber,
                    state: BlockFinalizationState.PROPOSED
                }
            });
            
            if (!finalization) {
                throw new Error(`Block ${blockNumber} not found or not in proposed state`);
            }
            
            // Create challenge on Ethereum
            const txHash = await this.ethereumConnector.createChallenge(
                blockNumber,
                finalization.blockHash,
                challengeType,
                data
            );
            
            // Update block finalization status
            await this.blockFinalizationRepository.update(
                { id: finalization.id },
                {
                    state: BlockFinalizationState.CHALLENGED,
                    challengeId: txHash
                }
            );
            
            this.logger.info(`Challenge created for block ${blockNumber} with transaction ${txHash}`);
            this.metrics.increment('finalization.challenges.created');
            
            return txHash;
        } catch (error) {
            this.logger.error(`Error creating challenge: ${error.message}`, error);
            this.metrics.increment('finalization.challenges.creation.errors');
            throw error;
        }
    }
}
