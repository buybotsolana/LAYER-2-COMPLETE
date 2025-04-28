// English comment for verification
/**
 * @file BlockFinalizationService.ts
 * @description Service for connecting Layer-2 blocks to Ethereum finalization
 * @author Manus AI
 * @date April 27, 2025
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ethers } from 'ethers';
import { Logger } from '../utils/Logger';
import { ConfigService } from '../config/config.service';
import { MetricsService } from '../monitoring/MetricsService';
import { MonitoringService } from '../monitoring/MonitoringService';
import { SecurityService } from '../security/SecurityService';
import { CacheService } from '../utils/CacheService';
import { BlockFinalization } from '../models/BlockFinalization';
import { Bundle } from '../sequencer/bundle.entity';
import { Transaction } from '../transaction/transaction.entity';
import { EventEmitter } from 'events';

// Import BlockFinalization ABI
import * as BlockFinalizationABI from '../abis/BlockFinalization.json';

/**
 * Interface for block finalization parameters
 */
export interface BlockFinalizationParams {
  blockHash: string;
  stateRoot: string;
  parentBlockHash: string;
  blockNumber: number;
  transactionCount: number;
  transactionsRoot: string;
}

/**
 * BlockFinalizationService for connecting Layer-2 blocks to Ethereum
 */
@Injectable()
export class BlockFinalizationService extends EventEmitter implements OnModuleInit {
  private readonly logger: Logger;
  private readonly ethereumProvider: ethers.providers.JsonRpcProvider;
  private readonly ethereumWallet: ethers.Wallet;
  private readonly blockFinalizationContract: ethers.Contract;
  private isInitialized: boolean = false;
  private isRunning: boolean = false;
  private pollingInterval: NodeJS.Timeout;
  
  /**
   * Constructor for BlockFinalizationService
   * 
   * @param blockFinalizationRepository - Repository for block finalization records
   * @param bundleRepository - Repository for bundles
   * @param transactionRepository - Repository for transactions
   * @param configService - Configuration service
   * @param metricsService - Metrics service
   * @param monitoringService - Monitoring service
   * @param securityService - Security service
   * @param cacheService - Cache service
   */
  constructor(
    @InjectRepository(BlockFinalization)
    private readonly blockFinalizationRepository: Repository<BlockFinalization>,
    @InjectRepository(Bundle)
    private readonly bundleRepository: Repository<Bundle>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly monitoringService: MonitoringService,
    private readonly securityService: SecurityService,
    private readonly cacheService: CacheService
  ) {
    super();
    this.logger = new Logger('BlockFinalizationService');
    
    // Initialize Ethereum provider
    const ethereumConfig = this.configService.getEthereumConfig();
    this.ethereumProvider = new ethers.providers.JsonRpcProvider(ethereumConfig.rpc);
    
    // Initialize Ethereum wallet
    const privateKey = this.securityService.getDecryptedSecret('ETHEREUM_PRIVATE_KEY');
    this.ethereumWallet = new ethers.Wallet(privateKey, this.ethereumProvider);
    
    // Initialize BlockFinalization contract
    const blockFinalizationAddress = this.configService.get('ethereum.contracts.blockFinalization');
    this.blockFinalizationContract = new ethers.Contract(
      blockFinalizationAddress,
      BlockFinalizationABI,
      this.ethereumWallet
    );
    
    this.logger.info('BlockFinalizationService created');
  }
  
  /**
   * Initialize the service when the module is initialized
   */
  async onModuleInit(): Promise<void> {
    await this.initialize();
  }
  
  /**
   * Initialize the service
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('BlockFinalizationService is already initialized');
      return;
    }
    
    this.logger.info('Initializing BlockFinalizationService');
    
    try {
      // Verify contract connection
      const challengePeriod = await this.blockFinalizationContract.challengePeriod();
      this.logger.info(`Connected to BlockFinalization contract, challenge period: ${challengePeriod} seconds`);
      
      // Create database tables if they don't exist
      await this.createDatabaseTables();
      
      this.isInitialized = true;
      this.logger.info('BlockFinalizationService initialized successfully');
      this.emit('initialized');
    } catch (error) {
      this.logger.error('Failed to initialize BlockFinalizationService', error);
      throw new Error(`Failed to initialize BlockFinalizationService: ${error.message}`);
    }
  }
  
  /**
   * Create necessary database tables
   */
  private async createDatabaseTables(): Promise<void> {
    // This would be handled by TypeORM entity definitions
    // No need to manually create tables
  }
  
  /**
   * Start the service
   */
  public async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    if (this.isRunning) {
      this.logger.warn('BlockFinalizationService is already running');
      return;
    }
    
    this.logger.info('Starting BlockFinalizationService');
    
    try {
      // Start polling for pending bundles
      const pollingIntervalMs = this.configService.get('ethereum.finalization.pollingInterval', 60000);
      this.pollingInterval = setInterval(() => this.processPendingBundles(), pollingIntervalMs);
      
      this.isRunning = true;
      this.logger.info('BlockFinalizationService started successfully');
      this.emit('started');
    } catch (error) {
      this.logger.error('Failed to start BlockFinalizationService', error);
      throw new Error(`Failed to start BlockFinalizationService: ${error.message}`);
    }
  }
  
  /**
   * Stop the service
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('BlockFinalizationService is not running');
      return;
    }
    
    this.logger.info('Stopping BlockFinalizationService');
    
    try {
      // Clear polling interval
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
      }
      
      this.isRunning = false;
      this.logger.info('BlockFinalizationService stopped successfully');
      this.emit('stopped');
    } catch (error) {
      this.logger.error('Failed to stop BlockFinalizationService', error);
      throw new Error(`Failed to stop BlockFinalizationService: ${error.message}`);
    }
  }
  
  /**
   * Process pending bundles
   */
  private async processPendingBundles(): Promise<void> {
    try {
      // Find bundles that need to be finalized
      const pendingBundles = await this.bundleRepository.find({
        where: {
          status: 'PROCESSED',
          finalized: false
        },
        order: {
          blockNumber: 'ASC'
        }
      });
      
      this.logger.debug(`Found ${pendingBundles.length} pending bundles to finalize`);
      
      // Process each pending bundle
      for (const bundle of pendingBundles) {
        try {
          await this.finalizeBundle(bundle);
        } catch (error) {
          this.logger.error(`Error finalizing bundle ${bundle.id}`, error);
        }
      }
      
      // Record metrics
      this.metricsService.recordMetric('block_finalization.pending_bundles', pendingBundles.length);
    } catch (error) {
      this.logger.error('Error processing pending bundles', error);
      
      // Record error metric
      this.metricsService.recordMetric('block_finalization.processing_errors', 1);
    }
  }
  
  /**
   * Finalize a bundle
   * 
   * @param bundle - Bundle to finalize
   */
  private async finalizeBundle(bundle: Bundle): Promise<void> {
    this.logger.info(`Finalizing bundle ${bundle.id} (block ${bundle.blockNumber})`);
    
    try {
      // Check if the bundle is already finalized
      const existingFinalization = await this.blockFinalizationRepository.findOne({
        where: { bundleId: bundle.id }
      });
      
      if (existingFinalization) {
        if (existingFinalization.status === 'FINALIZED') {
          this.logger.info(`Bundle ${bundle.id} is already finalized`);
          return;
        } else if (existingFinalization.status === 'PENDING') {
          // Check if the finalization is complete on Ethereum
          const blockState = await this.blockFinalizationContract.getBlockState(existingFinalization.blockHash);
          
          if (blockState === 3) { // 3 = Finalized
            // Update finalization status
            existingFinalization.status = 'FINALIZED';
            existingFinalization.finalizedAt = new Date();
            await this.blockFinalizationRepository.save(existingFinalization);
            
            // Update bundle
            bundle.finalized = true;
            bundle.finalizedAt = new Date();
            await this.bundleRepository.save(bundle);
            
            this.logger.info(`Bundle ${bundle.id} finalization confirmed on Ethereum`);
            
            // Emit event
            this.emit('bundleFinalized', {
              bundleId: bundle.id,
              blockNumber: bundle.blockNumber,
              blockHash: existingFinalization.blockHash,
              finalizedAt: existingFinalization.finalizedAt
            });
            
            return;
          } else if (blockState === 4) { // 4 = Invalidated
            // Update finalization status
            existingFinalization.status = 'INVALIDATED';
            existingFinalization.error = 'Block was invalidated on Ethereum';
            await this.blockFinalizationRepository.save(existingFinalization);
            
            this.logger.warn(`Bundle ${bundle.id} was invalidated on Ethereum`);
            
            // Emit event
            this.emit('bundleInvalidated', {
              bundleId: bundle.id,
              blockNumber: bundle.blockNumber,
              blockHash: existingFinalization.blockHash,
              error: existingFinalization.error
            });
            
            return;
          }
          
          // Block is still in proposed or challenged state
          this.logger.debug(`Bundle ${bundle.id} finalization is still pending on Ethereum (state: ${blockState})`);
          return;
        }
      }
      
      // Get the parent block hash
      let parentBlockHash = ethers.constants.HashZero;
      
      if (bundle.blockNumber > 1) {
        const parentBundle = await this.bundleRepository.findOne({
          where: {
            blockNumber: bundle.blockNumber - 1,
            finalized: true
          }
        });
        
        if (!parentBundle) {
          this.logger.warn(`Parent bundle for block ${bundle.blockNumber} is not finalized yet`);
          return;
        }
        
        const parentFinalization = await this.blockFinalizationRepository.findOne({
          where: { bundleId: parentBundle.id }
        });
        
        if (!parentFinalization) {
          this.logger.warn(`Parent finalization for block ${bundle.blockNumber} not found`);
          return;
        }
        
        parentBlockHash = parentFinalization.blockHash;
      }
      
      // Calculate the state root
      const stateRoot = await this.calculateStateRoot(bundle);
      
      // Calculate the transactions root
      const transactionsRoot = await this.calculateTransactionsRoot(bundle);
      
      // Get transaction count
      const transactionCount = await this.transactionRepository.count({
        where: { bundleId: bundle.id }
      });
      
      // Prepare block finalization parameters
      const blockHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ['uint256', 'bytes32', 'bytes32', 'uint256'],
          [bundle.blockNumber, stateRoot, parentBlockHash, bundle.timestamp]
        )
      );
      
      const params: BlockFinalizationParams = {
        blockHash,
        stateRoot,
        parentBlockHash,
        blockNumber: bundle.blockNumber,
        transactionCount,
        transactionsRoot
      };
      
      // Propose the block on Ethereum
      const tx = await this.blockFinalizationContract.proposeBlock(
        params.blockHash,
        params.stateRoot,
        params.parentBlockHash,
        params.blockNumber,
        params.transactionCount,
        params.transactionsRoot,
        {
          gasLimit: 500000
        }
      );
      
      this.logger.info(`Proposed block ${bundle.blockNumber} on Ethereum: ${tx.hash}`);
      
      // Wait for transaction to be mined
      const receipt = await tx.wait();
      
      if (receipt.status === 0) {
        throw new Error(`Transaction failed: ${tx.hash}`);
      }
      
      // Create finalization record
      const finalization = new BlockFinalization();
      finalization.bundleId = bundle.id;
      finalization.blockNumber = bundle.blockNumber;
      finalization.blockHash = blockHash;
      finalization.stateRoot = stateRoot;
      finalization.parentBlockHash = parentBlockHash;
      finalization.transactionsRoot = transactionsRoot;
      finalization.transactionCount = transactionCount;
      finalization.proposedAt = new Date();
      finalization.status = 'PENDING';
      finalization.ethereumTransactionHash = tx.hash;
      
      await this.blockFinalizationRepository.save(finalization);
      
      this.logger.info(`Created finalization record for bundle ${bundle.id}`);
      
      // Emit event
      this.emit('blockProposed', {
        bundleId: bundle.id,
        blockNumber: bundle.blockNumber,
        blockHash,
        stateRoot,
        transactionHash: tx.hash
      });
      
      // Record metrics
      this.metricsService.recordMetric('block_finalization.blocks_proposed', 1);
    } catch (error) {
      this.logger.error(`Error finalizing bundle ${bundle.id}`, error);
      
      // Record error metric
      this.metricsService.recordMetric('block_finalization.finalization_errors', 1);
      
      // Create or update finalization record with error
      const finalization = await this.blockFinalizationRepository.findOne({
        where: { bundleId: bundle.id }
      }) || new BlockFinalization();
      
      finalization.bundleId = bundle.id;
      finalization.blockNumber = bundle.blockNumber;
      finalization.status = 'FAILED';
      finalization.error = error.message;
      
      await this.blockFinalizationRepository.save(finalization);
      
      // Emit event
      this.emit('finalizationFailed', {
        bundleId: bundle.id,
        blockNumber: bundle.blockNumber,
        error: error.message
      });
    }
  }
  
  /**
   * Calculate the state root for a bundle
   * 
   * @param bundle - Bundle to calculate state root for
   * @returns The state root hash
   */
  private async calculateStateRoot(bundle: Bundle): Promise<string> {
    try {
      // Get all transactions in the bundle
      const transactions = await this.transactionRepository.find({
        where: { bundleId: bundle.id },
        order: { sequence: 'ASC' }
      });
      
      // Calculate state root
      // In a real implementation, this would involve calculating a Merkle root
      // of the state changes caused by the transactions
      // For now, we'll use a simplified approach
      
      const transactionHashes = transactions.map(tx => tx.hash);
      const concatenatedHashes = transactionHashes.join('');
      const stateRoot = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(concatenatedHashes + bundle.timestamp)
      );
      
      return stateRoot;
    } catch (error) {
      this.logger.error(`Error calculating state root for bundle ${bundle.id}`, error);
      throw new Error(`Failed to calculate state root: ${error.message}`);
    }
  }
  
  /**
   * Calculate the transactions root for a bundle
   * 
   * @param bundle - Bundle to calculate transactions root for
   * @returns The transactions root hash
   */
  private async calculateTransactionsRoot(bundle: Bundle): Promise<string> {
    try {
      // Get all transactions in the bundle
      const transactions = await this.transactionRepository.find({
        where: { bundleId: bundle.id },
        order: { sequence: 'ASC' }
      });
      
      // Calculate transactions root
      // In a real implementation, this would involve calculating a Merkle root
      // of the transaction hashes
      // For now, we'll use a simplified approach
      
      const transactionHashes = transactions.map(tx => tx.hash);
      const concatenatedHashes = transactionHashes.join('');
      const transactionsRoot = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(concatenatedHashes)
      );
      
      return transactionsRoot;
    } catch (error) {
      this.logger.error(`Error calculating transactions root for bundle ${bundle.id}`, error);
      throw new Error(`Failed to calculate transactions root: ${error.message}`);
    }
  }
  
  /**
   * Manually finalize a block on Ethereum
   * 
   * @param blockHash - Hash of the block to finalize
   * @returns The transaction hash
   */
  public async finalizeBlock(blockHash: string): Promise<string> {
    this.logger.info(`Manually finalizing block with hash ${blockHash}`);
    
    try {
      // Check if the block exists
      const finalization = await this.blockFinalizationRepository.findOne({
        where: { blockHash }
      });
      
      if (!finalization) {
        throw new Error(`Block with hash ${blockHash} not found`);
      }
      
      // Check if the block is already finalized
      if (finalization.status === 'FINALIZED') {
        this.logger.info(`Block with hash ${blockHash} is already finalized`);
        return finalization.ethereumTransactionHash;
      }
      
      // Call the finalizeBlock function on the contract
      const tx = await this.blockFinalizationContract.finalizeBlock(blockHash, {
        gasLimit: 300000
      });
      
      this.logger.info(`Finalization transaction sent: ${tx.hash}`);
      
      // Wait for transaction to be mined
      const receipt = await tx.wait();
      
      if (receipt.status === 0) {
        throw new Error(`Transaction failed: ${tx.hash}`);
      }
      
      // Update finalization record
      finalization.status = 'FINALIZED';
      finalization.finalizedAt = new Date();
      finalization.ethereumTransactionHash = tx.hash;
      
      await this.blockFinalizationRepository.save(finalization);
      
      // Update bundle
      const bundle = await this.bundleRepository.findOne({
        where: { id: finalization.bundleId }
      });
      
      if (bundle) {
        bundle.finalized = true;
        bundle.finalizedAt = new Date();
        await this.bundleRepository.save(bundle);
      }
      
      this.logger.info(`Block with hash ${blockHash} finalized successfully`);
      
      // Emit event
      this.emit('blockFinalized', {
        bundleId: finalization.bundleId,
        blockNumber: finalization.blockNumber,
        blockHash,
        finalizedAt: finalization.finalizedAt
      });
      
      // Record metrics
      this.metricsService.recordMetric('block_finalization.blocks_finalized', 1);
      
      return tx.hash;
    } catch (error) {
      this.logger.error(`Error finalizing block with hash ${blockHash}`, error);
      
      // Record error metric
      this.metricsService.recordMetric('block_finalization.finalization_errors', 1);
      
      throw new Error(`Failed to finalize block: ${error.message}`);
    }
  }
  
  /**
   * Get the status of a block
   * 
   * @param blockHash - Hash of the block
   * @returns The block status
   */
  public async getBlockStatus(blockHash: string): Promise<any> {
    try {
      // Check if the block exists in our database
      const finalization = await this.blockFinalizationRepository.findOne({
        where: { blockHash }
      });
      
      if (!finalization) {
        return {
          exists: false,
          message: 'Block not found'
        };
      }
      
      // Get the block state from Ethereum
      const blockState = await this.blockFinalizationContract.getBlockState(blockHash);
      const blockDetails = await this.blockFinalizationContract.getBlockDetails(blockHash);
      
      // Map block state to string
      const stateMap = [
        'NonExistent',
        'Proposed',
        'Challenged',
        'Finalized',
        'Invalidated'
      ];
      
      const ethereumState = stateMap[blockState] || 'Unknown';
      
      // Get bundle details
      const bundle = await this.bundleRepository.findOne({
        where: { id: finalization.bundleId }
      });
      
      return {
        exists: true,
        blockHash,
        blockNumber: finalization.blockNumber,
        bundleId: finalization.bundleId,
        status: finalization.status,
        ethereumState,
        proposedAt: finalization.proposedAt,
        finalizedAt: finalization.finalizedAt,
        ethereumTransactionHash: finalization.ethereumTransactionHash,
        error: finalization.error,
        bundle: bundle ? {
          id: bundle.id,
          blockNumber: bundle.blockNumber,
          timestamp: bundle.timestamp,
          transactionCount: bundle.transactionCount,
          finalized: bundle.finalized,
          finalizedAt: bundle.finalizedAt
        } : null,
        ethereumDetails: {
          blockNumber: blockDetails.blockNumber.toString(),
          stateRoot: blockDetails.stateRoot,
          proposer: blockDetails.proposer,
          proposalTime: new Date(blockDetails.proposalTime.toNumber() * 1000).toISOString(),
          state: ethereumState
        }
      };
    } catch (error) {
      this.logger.error(`Error getting block status for ${blockHash}`, error);
      throw new Error(`Failed to get block status: ${error.message}`);
    }
  }
  
  /**
   * Get all finalized blocks
   * 
   * @param limit - Maximum number of blocks to return
   * @param offset - Offset for pagination
   * @returns List of finalized blocks
   */
  public async getFinalizedBlocks(limit: number = 100, offset: number = 0): Promise<any[]> {
    try {
      // Get finalized blocks from database
      const finalizations = await this.blockFinalizationRepository.find({
        where: { status: 'FINALIZED' },
        order: { blockNumber: 'DESC' },
        take: limit,
        skip: offset
      });
      
      // Get bundle details for each finalization
      const blocks = await Promise.all(
        finalizations.map(async (finalization) => {
          const bundle = await this.bundleRepository.findOne({
            where: { id: finalization.bundleId }
          });
          
          return {
            blockHash: finalization.blockHash,
            blockNumber: finalization.blockNumber,
            bundleId: finalization.bundleId,
            proposedAt: finalization.proposedAt,
            finalizedAt: finalization.finalizedAt,
            ethereumTransactionHash: finalization.ethereumTransactionHash,
            bundle: bundle ? {
              id: bundle.id,
              blockNumber: bundle.blockNumber,
              timestamp: bundle.timestamp,
              transactionCount: bundle.transactionCount,
              finalized: bundle.finalized,
              finalizedAt: bundle.finalizedAt
            } : null
          };
        })
      );
      
      return blocks;
    } catch (error) {
      this.logger.error('Error getting finalized blocks', error);
      throw new Error(`Failed to get finalized blocks: ${error.message}`);
    }
  }
  
  /**
   * Get service status
   * 
   * @returns The current status of the service
   */
  public async getStatus(): Promise<any> {
    try {
      // Get counts from database
      const [
        totalBlocks,
        pendingBlocks,
        finalizedBlocks,
        failedBlocks
      ] = await Promise.all([
        this.blockFinalizationRepository.count(),
        this.blockFinalizationRepository.count({ where: { status: 'PENDING' } }),
        this.blockFinalizationRepository.count({ where: { status: 'FINALIZED' } }),
        this.blockFinalizationRepository.count({ where: { status: 'FAILED' } })
      ]);
      
      // Get Ethereum contract details
      const [
        challengePeriod,
        lastFinalizedBlockHash,
        lastFinalizedBlockNumber
      ] = await Promise.all([
        this.blockFinalizationContract.challengePeriod(),
        this.blockFinalizationContract.lastFinalizedBlockHash(),
        this.blockFinalizationContract.lastFinalizedBlockNumber()
      ]);
      
      return {
        isInitialized: this.isInitialized,
        isRunning: this.isRunning,
        blocks: {
          total: totalBlocks,
          pending: pendingBlocks,
          finalized: finalizedBlocks,
          failed: failedBlocks
        },
        ethereum: {
          contractAddress: this.blockFinalizationContract.address,
          challengePeriod: challengePeriod.toString(),
          lastFinalizedBlockHash,
          lastFinalizedBlockNumber: lastFinalizedBlockNumber.toString()
        }
      };
    } catch (error) {
      this.logger.error('Error getting service status', error);
      throw new Error(`Failed to get service status: ${error.message}`);
    }
  }
}
