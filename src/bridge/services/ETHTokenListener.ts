// English comment for verification
/**
 * @file ETHTokenListener.ts
 * @description Event listener for ETH token events on Solana Layer-2
 * @author Manus AI
 * @date April 27, 2025
 */

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Connection, PublicKey } from '@solana/web3.js';
import { ChainId, CHAIN_ID_ETH, CHAIN_ID_SOLANA } from '@certusone/wormhole-sdk';
import { Logger } from '../utils/Logger';
import { ConfigService } from '../config/config.service';
import { MetricsService } from '../monitoring/MetricsService';
import { TokenMapping } from '../models/TokenMapping';
import { BridgeTransaction } from '../models/BridgeTransaction';
import { ETHTokenSupport } from './ETHTokenSupport';
import { BridgeService } from './bridge.service';
import { EventEmitter } from 'events';

/**
 * ETHTokenListener service for handling ETH token events
 */
@Injectable()
export class ETHTokenListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger;
  private readonly solanaConnection: Connection;
  private isRunning: boolean = false;
  private pollingInterval: NodeJS.Timeout;
  private eventEmitter: EventEmitter = new EventEmitter();
  
  /**
   * Constructor for the ETHTokenListener service
   * 
   * @param tokenMappingRepository - Repository for token mappings
   * @param bridgeTransactionRepository - Repository for bridge transactions
   * @param ethTokenSupport - ETH token support service
   * @param bridgeService - Bridge service
   * @param configService - Configuration service
   * @param metricsService - Metrics service
   */
  constructor(
    @InjectRepository(TokenMapping)
    private readonly tokenMappingRepository: Repository<TokenMapping>,
    @InjectRepository(BridgeTransaction)
    private readonly bridgeTransactionRepository: Repository<BridgeTransaction>,
    private readonly ethTokenSupport: ETHTokenSupport,
    private readonly bridgeService: BridgeService,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService
  ) {
    this.logger = new Logger('ETHTokenListener');
    
    // Initialize Solana connection
    const solanaConfig = this.configService.getSolanaConfig();
    this.solanaConnection = new Connection(solanaConfig.rpc, solanaConfig.commitment);
    
    this.logger.info('ETHTokenListener service initialized');
  }
  
  /**
   * Initialize the service when the module is initialized
   */
  async onModuleInit(): Promise<void> {
    await this.start();
  }
  
  /**
   * Clean up when the module is destroyed
   */
  onModuleDestroy(): void {
    this.stop();
  }
  
  /**
   * Start the listener
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('ETHTokenListener is already running');
      return;
    }
    
    this.logger.info('Starting ETHTokenListener');
    
    try {
      // Set up event listeners
      this.setupEventListeners();
      
      // Start polling for pending transactions
      const pollingIntervalMs = this.configService.get('eth.tokenListener.pollingInterval', 30000);
      this.pollingInterval = setInterval(() => this.processPendingTransactions(), pollingIntervalMs);
      
      this.isRunning = true;
      this.logger.info('ETHTokenListener started successfully');
    } catch (error) {
      this.logger.error('Failed to start ETHTokenListener', error);
      throw new Error(`Failed to start ETHTokenListener: ${error.message}`);
    }
  }
  
  /**
   * Stop the listener
   */
  public stop(): void {
    if (!this.isRunning) {
      this.logger.warn('ETHTokenListener is not running');
      return;
    }
    
    this.logger.info('Stopping ETHTokenListener');
    
    // Clear polling interval
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    
    // Remove event listeners
    this.eventEmitter.removeAllListeners();
    
    this.isRunning = false;
    this.logger.info('ETHTokenListener stopped successfully');
  }
  
  /**
   * Set up event listeners
   */
  private setupEventListeners(): void {
    // Listen for bridge events
    this.bridgeService.on('depositInitiated', (data) => {
      this.logger.info(`Deposit initiated: ${JSON.stringify(data)}`);
      this.handleDepositInitiated(data);
    });
    
    this.bridgeService.on('depositCompleted', (data) => {
      this.logger.info(`Deposit completed: ${JSON.stringify(data)}`);
      this.handleDepositCompleted(data);
    });
    
    this.bridgeService.on('withdrawalInitiated', (data) => {
      this.logger.info(`Withdrawal initiated: ${JSON.stringify(data)}`);
      this.handleWithdrawalInitiated(data);
    });
    
    this.bridgeService.on('withdrawalCompleted', (data) => {
      this.logger.info(`Withdrawal completed: ${JSON.stringify(data)}`);
      this.handleWithdrawalCompleted(data);
    });
  }
  
  /**
   * Process pending transactions
   */
  private async processPendingTransactions(): Promise<void> {
    try {
      // Find pending deposit transactions
      const pendingDeposits = await this.bridgeTransactionRepository.find({
        where: {
          type: 'DEPOSIT',
          status: 'PENDING',
          targetChain: CHAIN_ID_SOLANA
        }
      });
      
      this.logger.debug(`Found ${pendingDeposits.length} pending deposits`);
      
      // Process each pending deposit
      for (const deposit of pendingDeposits) {
        try {
          await this.processDeposit(deposit);
        } catch (error) {
          this.logger.error(`Error processing deposit ${deposit.id}`, error);
        }
      }
      
      // Find pending withdrawal transactions
      const pendingWithdrawals = await this.bridgeTransactionRepository.find({
        where: {
          type: 'WITHDRAWAL',
          status: 'PENDING',
          sourceChain: CHAIN_ID_SOLANA
        }
      });
      
      this.logger.debug(`Found ${pendingWithdrawals.length} pending withdrawals`);
      
      // Process each pending withdrawal
      for (const withdrawal of pendingWithdrawals) {
        try {
          await this.processWithdrawal(withdrawal);
        } catch (error) {
          this.logger.error(`Error processing withdrawal ${withdrawal.id}`, error);
        }
      }
      
      // Record metrics
      this.metricsService.recordMetric('eth_token_listener.pending_transactions', {
        deposits: pendingDeposits.length,
        withdrawals: pendingWithdrawals.length
      });
    } catch (error) {
      this.logger.error('Error processing pending transactions', error);
      
      // Record error metric
      this.metricsService.recordMetric('eth_token_listener.processing_errors', 1);
    }
  }
  
  /**
   * Handle deposit initiated event
   * 
   * @param data - Deposit event data
   */
  private async handleDepositInitiated(data: any): Promise<void> {
    try {
      // Get transaction
      const transaction = await this.bridgeTransactionRepository.findOne({
        where: { id: data.id }
      });
      
      if (!transaction) {
        this.logger.warn(`Transaction ${data.id} not found`);
        return;
      }
      
      // Check if token mapping exists
      const tokenMapping = await this.tokenMappingRepository.findOne({
        where: { ethereumToken: transaction.sourceToken }
      });
      
      if (!tokenMapping) {
        // Create new token mapping if it doesn't exist
        this.logger.info(`Token mapping not found for ${transaction.sourceToken}, creating new token`);
        
        // This would require fetching token info from Ethereum
        // For now, we'll just log a warning
        this.logger.warn(`Automatic token creation not implemented yet`);
      }
    } catch (error) {
      this.logger.error('Error handling deposit initiated event', error);
    }
  }
  
  /**
   * Handle deposit completed event
   * 
   * @param data - Deposit event data
   */
  private async handleDepositCompleted(data: any): Promise<void> {
    try {
      // Get transaction
      const transaction = await this.bridgeTransactionRepository.findOne({
        where: { id: data.id }
      });
      
      if (!transaction) {
        this.logger.warn(`Transaction ${data.id} not found`);
        return;
      }
      
      // Update transaction status
      transaction.status = 'COMPLETED';
      transaction.completedAt = new Date();
      await this.bridgeTransactionRepository.save(transaction);
      
      // Record metrics
      this.metricsService.recordMetric('eth_token_listener.deposits_completed', 1);
    } catch (error) {
      this.logger.error('Error handling deposit completed event', error);
    }
  }
  
  /**
   * Handle withdrawal initiated event
   * 
   * @param data - Withdrawal event data
   */
  private async handleWithdrawalInitiated(data: any): Promise<void> {
    try {
      // Get transaction
      const transaction = await this.bridgeTransactionRepository.findOne({
        where: { id: data.id }
      });
      
      if (!transaction) {
        this.logger.warn(`Transaction ${data.id} not found`);
        return;
      }
      
      // Check if token mapping exists
      const tokenMapping = await this.tokenMappingRepository.findOne({
        where: { solanaToken: transaction.sourceToken }
      });
      
      if (!tokenMapping) {
        this.logger.warn(`Token mapping not found for ${transaction.sourceToken}`);
        
        // Update transaction status
        transaction.status = 'FAILED';
        transaction.error = 'Token mapping not found';
        await this.bridgeTransactionRepository.save(transaction);
        
        return;
      }
      
      // Process withdrawal
      await this.ethTokenSupport.processWithdrawal(transaction);
    } catch (error) {
      this.logger.error('Error handling withdrawal initiated event', error);
    }
  }
  
  /**
   * Handle withdrawal completed event
   * 
   * @param data - Withdrawal event data
   */
  private async handleWithdrawalCompleted(data: any): Promise<void> {
    try {
      // Get transaction
      const transaction = await this.bridgeTransactionRepository.findOne({
        where: { id: data.id }
      });
      
      if (!transaction) {
        this.logger.warn(`Transaction ${data.id} not found`);
        return;
      }
      
      // Update transaction status
      transaction.status = 'COMPLETED';
      transaction.completedAt = new Date();
      await this.bridgeTransactionRepository.save(transaction);
      
      // Record metrics
      this.metricsService.recordMetric('eth_token_listener.withdrawals_completed', 1);
    } catch (error) {
      this.logger.error('Error handling withdrawal completed event', error);
    }
  }
  
  /**
   * Process a deposit
   * 
   * @param transaction - Bridge transaction
   */
  private async processDeposit(transaction: BridgeTransaction): Promise<void> {
    try {
      // Check if VAA is available
      if (!transaction.vaaHash) {
        this.logger.debug(`Transaction ${transaction.id} has no VAA hash, skipping`);
        return;
      }
      
      // Process deposit
      await this.ethTokenSupport.processDeposit(transaction);
      
      // Record metrics
      this.metricsService.recordMetric('eth_token_listener.deposits_processed', 1);
    } catch (error) {
      this.logger.error(`Error processing deposit ${transaction.id}`, error);
      
      // Update transaction status
      transaction.status = 'FAILED';
      transaction.error = error.message;
      await this.bridgeTransactionRepository.save(transaction);
      
      // Record error metric
      this.metricsService.recordMetric('eth_token_listener.deposit_processing_errors', 1);
    }
  }
  
  /**
   * Process a withdrawal
   * 
   * @param transaction - Bridge transaction
   */
  private async processWithdrawal(transaction: BridgeTransaction): Promise<void> {
    try {
      // Process withdrawal
      await this.ethTokenSupport.processWithdrawal(transaction);
      
      // Record metrics
      this.metricsService.recordMetric('eth_token_listener.withdrawals_processed', 1);
    } catch (error) {
      this.logger.error(`Error processing withdrawal ${transaction.id}`, error);
      
      // Update transaction status
      transaction.status = 'FAILED';
      transaction.error = error.message;
      await this.bridgeTransactionRepository.save(transaction);
      
      // Record error metric
      this.metricsService.recordMetric('eth_token_listener.withdrawal_processing_errors', 1);
    }
  }
  
  /**
   * Get listener status
   * 
   * @returns The current status of the listener
   */
  public async getStatus(): Promise<any> {
    try {
      // Get transaction counts
      const [
        pendingDeposits,
        pendingWithdrawals,
        completedDeposits,
        completedWithdrawals,
        failedDeposits,
        failedWithdrawals,
      ] = await Promise.all([
        this.bridgeTransactionRepository.count({
          where: {
            type: 'DEPOSIT',
            status: 'PENDING',
            targetChain: CHAIN_ID_SOLANA
          }
        }),
        this.bridgeTransactionRepository.count({
          where: {
            type: 'WITHDRAWAL',
            status: 'PENDING',
            sourceChain: CHAIN_ID_SOLANA
          }
        }),
        this.bridgeTransactionRepository.count({
          where: {
            type: 'DEPOSIT',
            status: 'COMPLETED',
            targetChain: CHAIN_ID_SOLANA
          }
        }),
        this.bridgeTransactionRepository.count({
          where: {
            type: 'WITHDRAWAL',
            status: 'COMPLETED',
            sourceChain: CHAIN_ID_SOLANA
          }
        }),
        this.bridgeTransactionRepository.count({
          where: {
            type: 'DEPOSIT',
            status: 'FAILED',
            targetChain: CHAIN_ID_SOLANA
          }
        }),
        this.bridgeTransactionRepository.count({
          where: {
            type: 'WITHDRAWAL',
            status: 'FAILED',
            sourceChain: CHAIN_ID_SOLANA
          }
        }),
      ]);
      
      // Get token mappings count
      const tokenMappingsCount = await this.tokenMappingRepository.count();
      
      return {
        isRunning: this.isRunning,
        transactions: {
          pendingDeposits,
          pendingWithdrawals,
          completedDeposits,
          completedWithdrawals,
          failedDeposits,
          failedWithdrawals,
        },
        tokenMappings: tokenMappingsCount,
      };
    } catch (error) {
      this.logger.error('Error getting listener status', error);
      throw new Error(`Failed to get listener status: ${error.message}`);
    }
  }
}
