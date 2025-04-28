// English comment for verification
/**
 * @file EVMBridge.ts
 * @description Bridge between Layer-2 system and EVM compatibility layer
 * @author Layer2 Team
 * @date April 27, 2025
 */

import { ethers, BigNumber } from 'ethers';
import { EVMExecutor } from './EVMExecutor';
import { EVMOptions, EVMTransaction, EVMTransactionReceipt, EVMBlock, EVMLog, EVMAccount } from './EVMTypes';
import { Logger } from '../utils/logger';
import { Layer2Error, ErrorCode } from '../utils/errors';
import { DatabaseService } from '../database/database.service';
import { TransactionService } from '../transaction/transaction.service';
import { SequencerService } from '../sequencer/sequencer.service';
import { MonitoringService } from '../monitoring/MonitoringService';
import { ThreadPoolService } from '../utils/ThreadPoolService';

/**
 * Interface for EVM Bridge configuration
 */
export interface EVMBridgeConfig {
  /** Chain ID */
  chainId: number;
  /** Hardfork */
  hardfork: string;
  /** Enable EIP-1559 */
  enableEIP1559: boolean;
  /** Enable EIP-2930 */
  enableEIP2930: boolean;
  /** Enable EIP-3198 */
  enableEIP3198: boolean;
  /** Enable EIP-3529 */
  enableEIP3529: boolean;
  /** Enable EIP-3541 */
  enableEIP3541: boolean;
  /** Gas limit */
  gasLimit: string;
  /** Block gas limit */
  blockGasLimit: string;
  /** Allow unlimited contract size */
  allowUnlimitedContractSize: boolean;
  /** Debug mode */
  debug: boolean;
  /** Maximum number of worker threads */
  maxWorkerThreads: number;
  /** Database connection string */
  databaseUrl: string;
  /** RPC listen port */
  rpcPort: number;
  /** WebSocket listen port */
  wsPort: number;
  /** Enable metrics */
  enableMetrics: boolean;
  /** Metrics port */
  metricsPort: number;
}

/**
 * Bridge between Layer-2 system and EVM compatibility layer
 */
export class EVMBridge {
  private logger: Logger;
  private config: EVMBridgeConfig;
  private executor: EVMExecutor;
  private database: DatabaseService;
  private transactionService: TransactionService;
  private sequencerService: SequencerService;
  private monitoringService: MonitoringService;
  private threadPool: ThreadPoolService;
  private isRunning: boolean = false;
  private blockNumber: number = 0;
  private blockTimestamp: number = 0;
  private pendingTransactions: Map<string, EVMTransaction> = new Map();

  /**
   * Creates a new EVM Bridge
   * @param logger - Logger instance
   * @param config - EVM Bridge configuration
   */
  constructor(logger: Logger, config: EVMBridgeConfig) {
    this.logger = logger.createChildLogger('EVMBridge');
    this.config = config;

    // Initialize EVM executor
    const evmOptions: EVMOptions = {
      chainId: config.chainId,
      hardfork: config.hardfork,
      enableEIP1559: config.enableEIP1559,
      enableEIP2930: config.enableEIP2930,
      enableEIP3198: config.enableEIP3198,
      enableEIP3529: config.enableEIP3529,
      enableEIP3541: config.enableEIP3541,
      gasLimit: BigNumber.from(config.gasLimit),
      blockGasLimit: BigNumber.from(config.blockGasLimit),
      blockTimestamp: Math.floor(Date.now() / 1000),
      blockNumber: 0,
      blockDifficulty: BigNumber.from(0),
      blockCoinbase: ethers.constants.AddressZero,
      allowUnlimitedContractSize: config.allowUnlimitedContractSize,
      debug: config.debug
    };

    this.executor = new EVMExecutor(this.logger, evmOptions);
    
    // Initialize services
    this.database = new DatabaseService({
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'postgres',
      database: 'layer2',
      connectionString: config.databaseUrl,
      ssl: false,
      synchronize: true,
      logging: config.debug
    });
    
    this.transactionService = new TransactionService(this.database);
    this.sequencerService = new SequencerService(this.database, this.transactionService);
    this.monitoringService = new MonitoringService({
      enableMetrics: config.enableMetrics,
      metricsPort: config.metricsPort,
      logLevel: config.debug ? 'debug' : 'info',
      serviceName: 'evm-bridge'
    });
    
    this.threadPool = new ThreadPoolService({
      maxThreads: config.maxWorkerThreads,
      minThreads: 1,
      idleTimeout: 60000,
      taskQueueLimit: 1000
    });

    this.logger.info('EVMBridge initialized', { 
      chainId: config.chainId,
      hardfork: config.hardfork,
      rpcPort: config.rpcPort,
      wsPort: config.wsPort
    });
  }

  /**
   * Starts the EVM Bridge
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('EVMBridge is already running');
      return;
    }

    try {
      this.logger.info('Starting EVMBridge');

      // Initialize database
      await this.database.initialize();

      // Start services
      await this.monitoringService.start();
      await this.threadPool.start();

      // Update block information
      this.updateBlockInfo();

      // Start periodic tasks
      this.startPeriodicTasks();

      this.isRunning = true;
      this.logger.info('EVMBridge started successfully');
    } catch (error) {
      this.logger.error('Failed to start EVMBridge', { error });
      throw new Layer2Error('Failed to start EVMBridge', ErrorCode.EVM_BRIDGE_START_FAILED, { cause: error });
    }
  }

  /**
   * Stops the EVM Bridge
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('EVMBridge is not running');
      return;
    }

    try {
      this.logger.info('Stopping EVMBridge');

      // Stop services
      await this.threadPool.stop();
      await this.monitoringService.stop();

      this.isRunning = false;
      this.logger.info('EVMBridge stopped successfully');
    } catch (error) {
      this.logger.error('Failed to stop EVMBridge', { error });
      throw new Layer2Error('Failed to stop EVMBridge', ErrorCode.EVM_BRIDGE_STOP_FAILED, { cause: error });
    }
  }

  /**
   * Updates block information
   */
  private updateBlockInfo(): void {
    this.blockNumber++;
    this.blockTimestamp = Math.floor(Date.now() / 1000);

    // Update EVM executor options
    this.executor.updateOptions({
      blockNumber: this.blockNumber,
      blockTimestamp: this.blockTimestamp
    });

    this.logger.debug('Block information updated', { 
      blockNumber: this.blockNumber,
      blockTimestamp: this.blockTimestamp
    });
  }

  /**
   * Starts periodic tasks
   */
  private startPeriodicTasks(): void {
    // Process pending transactions every 2 seconds
    setInterval(() => {
      this.processPendingTransactions().catch(error => {
        this.logger.error('Failed to process pending transactions', { error });
      });
    }, 2000);

    // Update block information every 12 seconds
    setInterval(() => {
      this.updateBlockInfo();
    }, 12000);

    // Report metrics every 10 seconds
    setInterval(() => {
      this.reportMetrics().catch(error => {
        this.logger.error('Failed to report metrics', { error });
      });
    }, 10000);
  }

  /**
   * Processes pending transactions
   */
  private async processPendingTransactions(): Promise<void> {
    if (this.pendingTransactions.size === 0) {
      return;
    }

    this.logger.info('Processing pending transactions', { count: this.pendingTransactions.size });

    // Create a new block
    const blockHash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['uint256', 'uint256', 'address'],
        [this.blockNumber, this.blockTimestamp, ethers.constants.AddressZero]
      )
    );

    const block: EVMBlock = {
      hash: blockHash,
      parentHash: ethers.constants.HashZero,
      number: this.blockNumber,
      timestamp: this.blockTimestamp,
      nonce: '0x0000000000000000',
      difficulty: BigNumber.from(0),
      gasLimit: BigNumber.from(this.config.blockGasLimit),
      gasUsed: BigNumber.from(0),
      miner: ethers.constants.AddressZero,
      extraData: Buffer.from([]),
      transactions: [],
      uncles: [],
      receiptsRoot: ethers.constants.HashZero,
      transactionsRoot: ethers.constants.HashZero,
      stateRoot: ethers.constants.HashZero,
      logsBloom: Buffer.alloc(256),
      mixHash: ethers.constants.HashZero
    };

    // Process transactions in parallel using thread pool
    const transactions = Array.from(this.pendingTransactions.values());
    const results = await Promise.all(
      transactions.map(tx => 
        this.threadPool.submit(() => this.processTransaction(tx, block))
      )
    );

    // Update block with processed transactions
    let totalGasUsed = BigNumber.from(0);
    const processedTxHashes: string[] = [];

    for (const result of results) {
      if (result.success) {
        totalGasUsed = totalGasUsed.add(result.gasUsed);
        processedTxHashes.push(result.txHash);
        block.transactions.push(result.txHash);
      }
    }

    block.gasUsed = totalGasUsed;

    // Remove processed transactions from pending queue
    for (const txHash of processedTxHashes) {
      this.pendingTransactions.delete(txHash);
    }

    this.logger.info('Processed transactions', { 
      blockNumber: this.blockNumber,
      processed: processedTxHashes.length,
      remaining: this.pendingTransactions.size,
      gasUsed: totalGasUsed.toString()
    });
  }

  /**
   * Processes a transaction
   * @param tx - Transaction to process
   * @param block - Block to include the transaction in
   * @returns Processing result
   */
  private async processTransaction(
    tx: EVMTransaction,
    block: EVMBlock
  ): Promise<{
    success: boolean;
    txHash: string;
    gasUsed: BigNumber;
  }> {
    try {
      // Update transaction with block information
      tx.blockHash = block.hash;
      tx.blockNumber = block.number;

      // Execute transaction
      const result = await this.executor.executeTransaction(tx);

      return {
        success: !result.reverted,
        txHash: tx.hash,
        gasUsed: result.gasUsed
      };
    } catch (error) {
      this.logger.error('Failed to process transaction', { error, txHash: tx.hash });
      return {
        success: false,
        txHash: tx.hash,
        gasUsed: BigNumber.from(0)
      };
    }
  }

  /**
   * Reports metrics
   */
  private async reportMetrics(): Promise<void> {
    if (!this.config.enableMetrics) {
      return;
    }

    try {
      // Report EVM metrics
      this.monitoringService.recordMetric('evm_pending_transactions', this.pendingTransactions.size);
      this.monitoringService.recordMetric('evm_block_number', this.blockNumber);
      this.monitoringService.recordMetric('evm_block_timestamp', this.blockTimestamp);

      // Report thread pool metrics
      const threadPoolMetrics = this.threadPool.getMetrics();
      this.monitoringService.recordMetric('thread_pool_active_threads', threadPoolMetrics.activeThreads);
      this.monitoringService.recordMetric('thread_pool_idle_threads', threadPoolMetrics.idleThreads);
      this.monitoringService.recordMetric('thread_pool_queued_tasks', threadPoolMetrics.queuedTasks);
      this.monitoringService.recordMetric('thread_pool_completed_tasks', threadPoolMetrics.completedTasks);
      this.monitoringService.recordMetric('thread_pool_failed_tasks', threadPoolMetrics.failedTasks);
    } catch (error) {
      this.logger.error('Failed to report metrics', { error });
    }
  }

  /**
   * Submits a transaction to the EVM Bridge
   * @param txData - Transaction data
   * @returns Transaction hash
   */
  public async submitTransaction(txData: {
    from: string;
    to?: string;
    value?: string;
    data?: string;
    gas?: string;
    gasPrice?: string;
    nonce?: number;
  }): Promise<string> {
    if (!this.isRunning) {
      throw new Layer2Error('EVMBridge is not running', ErrorCode.EVM_BRIDGE_NOT_RUNNING);
    }

    try {
      this.logger.info('Submitting transaction', { 
        from: txData.from,
        to: txData.to || 'contract creation'
      });

      // Get sender account
      const sender = this.executor.getAccount(txData.from.toLowerCase()) || {
        address: txData.from.toLowerCase(),
        balance: BigNumber.from('1000000000000000000000'), // 1000 ETH for testing
        nonce: 0
      };

      // Determine nonce
      const nonce = txData.nonce !== undefined ? txData.nonce : sender.nonce;

      // Create transaction
      const tx: EVMTransaction = {
        hash: '',
        nonce,
        blockHash: '',
        blockNumber: 0,
        transactionIndex: 0,
        from: txData.from.toLowerCase(),
        to: txData.to?.toLowerCase(),
        value: BigNumber.from(txData.value || '0'),
        gasPrice: BigNumber.from(txData.gasPrice || '1000000000'), // 1 Gwei
        gas: BigNumber.from(txData.gas || '21000'),
        input: Buffer.from(txData.data?.slice(2) || '', 'hex'),
        v: 0,
        r: '',
        s: '',
        chainId: this.config.chainId
      };

      // Generate transaction hash
      tx.hash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'address', 'uint256', 'uint256', 'uint256', 'bytes', 'uint256'],
          [
            tx.from,
            tx.to || ethers.constants.AddressZero,
            tx.value.toString(),
            tx.nonce,
            tx.gas.toString(),
            tx.input,
            this.config.chainId
          ]
        )
      );

      // Add to pending transactions
      this.pendingTransactions.set(tx.hash, tx);

      this.logger.info('Transaction submitted', { txHash: tx.hash });

      return tx.hash;
    } catch (error) {
      this.logger.error('Failed to submit transaction', { error, txData });
      throw new Layer2Error('Failed to submit transaction', ErrorCode.EVM_TRANSACTION_SUBMISSION_FAILED, { cause: error });
    }
  }

  /**
   * Gets a transaction by hash
   * @param txHash - Transaction hash
   * @returns Transaction
   */
  public getTransaction(txHash: string): EVMTransaction | undefined {
    // Check pending transactions
    const pendingTx = this.pendingTransactions.get(txHash);
    if (pendingTx) {
      return pendingTx;
    }

    // Check processed transactions
    return this.executor.getTransaction(txHash);
  }

  /**
   * Gets a transaction receipt by hash
   * @param txHash - Transaction hash
   * @returns Transaction receipt
   */
  public getTransactionReceipt(txHash: string): EVMTransactionReceipt | undefined {
    return this.executor.getTransactionReceipt(txHash);
  }

  /**
   * Gets a block by hash or number
   * @param hashOrNumber - Block hash or number
   * @returns Block
   */
  public getBlock(hashOrNumber: string | number): EVMBlock | undefined {
    return this.executor.getBlock(hashOrNumber);
  }

  /**
   * Gets an account by address
   * @param address - Account address
   * @returns Account
   */
  public getAccount(address: string): EVMAccount | undefined {
    return this.executor.getAccount(address);
  }

  /**
   * Gets logs
   * @param filter - Log filter
   * @returns Logs
   */
  public getLogs(filter: {
    fromBlock?: number;
    toBlock?: number;
    address?: string | string[];
    topics?: (string | string[] | null)[];
  }): EVMLog[] {
    return this.executor.getLogs(filter);
  }

  /**
   * Calls a contract method
   * @param callData - Call data
   * @returns Call result
   */
  public async call(callData: {
    from?: string;
    to: string;
    value?: string;
    data?: string;
    gas?: string;
  }): Promise<string> {
    if (!this.isRunning) {
      throw new Layer2Error('EVMBridge is not running', ErrorCode.EVM_BRIDGE_NOT_RUNNING);
    }

    try {
      this.logger.debug('Calling contract', { 
        from: callData.from || ethers.constants.AddressZero,
        to: callData.to
      });

      // Create transaction
      const tx: EVMTransaction = {
        hash: ethers.utils.keccak256(
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'address', 'uint256', 'bytes'],
            [
              callData.from || ethers.constants.AddressZero,
              callData.to,
              callData.value || '0',
              callData.data || '0x'
            ]
          )
        ),
        nonce: 0,
        blockHash: '',
        blockNumber: 0,
        transactionIndex: 0,
        from: callData.from?.toLowerCase() || ethers.constants.AddressZero,
        to: callData.to.toLowerCase(),
        value: BigNumber.from(callData.value || '0'),
        gasPrice: BigNumber.from('0'),
        gas: BigNumber.from(callData.gas || this.config.gasLimit),
        input: Buffer.from(callData.data?.slice(2) || '', 'hex'),
        v: 0,
        r: '',
        s: '',
        chainId: this.config.chainId
      };

      // Execute transaction
      const result = await this.executor.executeTransaction(tx);

      if (result.reverted) {
        throw new Layer2Error(
          result.error || 'Call reverted',
          ErrorCode.EVM_CALL_REVERTED
        );
      }

      return '0x' + result.returnData.toString('hex');
    } catch (error) {
      this.logger.error('Failed to call contract', { error, callData });
      throw new Layer2Error('Failed to call contract', ErrorCode.EVM_CALL_FAILED, { cause: error });
    }
  }

  /**
   * Estimates gas for a transaction
   * @param txData - Transaction data
   * @returns Estimated gas
   */
  public async estimateGas(txData: {
    from?: string;
    to?: string;
    value?: string;
    data?: string;
  }): Promise<string> {
    if (!this.isRunning) {
      throw new Layer2Error('EVMBridge is not running', ErrorCode.EVM_BRIDGE_NOT_RUNNING);
    }

    try {
      this.logger.debug('Estimating gas', { 
        from: txData.from || ethers.constants.AddressZero,
        to: txData.to || 'contract creation'
      });

      // Create transaction
      const tx: EVMTransaction = {
        hash: ethers.utils.keccak256(
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'address', 'uint256', 'bytes'],
            [
              txData.from || ethers.constants.AddressZero,
              txData.to || ethers.constants.AddressZero,
              txData.value || '0',
              txData.data || '0x'
            ]
          )
        ),
        nonce: 0,
        blockHash: '',
        blockNumber: 0,
        transactionIndex: 0,
        from: txData.from?.toLowerCase() || ethers.constants.AddressZero,
        to: txData.to?.toLowerCase(),
        value: BigNumber.from(txData.value || '0'),
        gasPrice: BigNumber.from('0'),
        gas: BigNumber.from(this.config.gasLimit),
        input: Buffer.from(txData.data?.slice(2) || '', 'hex'),
        v: 0,
        r: '',
        s: '',
        chainId: this.config.chainId
      };

      // Execute transaction
      const result = await this.executor.executeTransaction(tx);

      if (result.reverted) {
        throw new Layer2Error(
          result.error || 'Gas estimation failed',
          ErrorCode.EVM_GAS_ESTIMATION_FAILED
        );
      }

      // Add buffer for safety (20%)
      const estimatedGas = result.gasUsed.mul(120).div(100);

      return estimatedGas.toString();
    } catch (error) {
      this.logger.error('Failed to estimate gas', { error, txData });
      throw new Layer2Error('Failed to estimate gas', ErrorCode.EVM_GAS_ESTIMATION_FAILED, { cause: error });
    }
  }

  /**
   * Gets the current block number
   * @returns Block number
   */
  public getBlockNumber(): number {
    return this.blockNumber;
  }

  /**
   * Gets the chain ID
   * @returns Chain ID
   */
  public getChainId(): number {
    return this.config.chainId;
  }

  /**
   * Gets the gas price
   * @returns Gas price
   */
  public getGasPrice(): string {
    return '1000000000'; // 1 Gwei
  }

  /**
   * Gets the EVM Bridge status
   * @returns Status
   */
  public getStatus(): {
    isRunning: boolean;
    blockNumber: number;
    blockTimestamp: number;
    pendingTransactions: number;
    chainId: number;
  } {
    return {
      isRunning: this.isRunning,
      blockNumber: this.blockNumber,
      blockTimestamp: this.blockTimestamp,
      pendingTransactions: this.pendingTransactions.size,
      chainId: this.config.chainId
    };
  }
}
