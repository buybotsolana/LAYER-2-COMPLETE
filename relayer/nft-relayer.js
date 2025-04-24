/**
 * NFT Relayer for Solana Layer 2
 * 
 * This module handles the relaying of NFT transfers between Ethereum and Solana Layer 2.
 * It monitors events from both chains and initiates the appropriate actions to complete
 * cross-chain NFT transfers.
 */

const { ethers } = require('ethers');
const { Connection, PublicKey, Transaction } = require('@solana/web3.js');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const winston = require('winston');
const axios = require('axios');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'nft-relayer.log' })
  ]
});

const MAX_RETRIES = 10;
const RETRY_DELAY = 15000; // 15 seconds
const ETHEREUM_POLL_INTERVAL = 15000; // 15 seconds
const SOLANA_POLL_INTERVAL = 5000; // 5 seconds
const STATE_SAVE_INTERVAL = 60000; // 1 minute

class NFTRelayer {
  constructor(config) {
    this.config = {
      ethereumRpc: 'http://localhost:8545',
      solanaRpc: 'http://localhost:8899',
      ethereumPrivateKey: '',
      solanaPrivateKey: '',
      nftVaultAddress: '',
      nftMintProgramId: '',
      stateFile: path.join(__dirname, 'nft-relayer-state.json'),
      metricsEnabled: true,
      metricsEndpoint: 'http://localhost:3000/api/metrics/components',
      ...config
    };
    
    this.pendingDeposits = new Map(); // Ethereum -> Solana
    this.pendingWithdrawals = new Map(); // Solana -> Ethereum
    this.processedDeposits = new Set();
    this.processedWithdrawals = new Set();
    this.lastEthereumBlock = 0;
    this.lastSolanaSignature = '';
    this.circuitBreakerActive = false;
    this.running = false;
    
    this.metrics = {
      totalProcessed: 0,
      successfulTransfers: 0,
      failedTransfers: 0,
      pendingTransfers: 0,
      avgConfirmationTime: 0,
      processingTimes: []
    };
    
    this.ethereumPollInterval = null;
    this.solanaPollInterval = null;
    this.pendingProcessInterval = null;
    this.stateSaveInterval = null;
    this.metricsInterval = null;
  }
  
  /**
   * Initialize the relayer
   */
  async initialize() {
    logger.info('Initializing NFT Relayer');
    
    try {
      this.ethereumProvider = new ethers.providers.JsonRpcProvider(this.config.ethereumRpc);
      this.ethereumWallet = new ethers.Wallet(this.config.ethereumPrivateKey, this.ethereumProvider);
      
      const nftVaultAbi = JSON.parse(fs.readFileSync(
        path.join(__dirname, '../bridge/artifacts/NFTVault.json')
      )).abi;
      
      this.nftVault = new ethers.Contract(
        this.config.nftVaultAddress,
        nftVaultAbi,
        this.ethereumWallet
      );
      
      this.solanaConnection = new Connection(this.config.solanaRpc);
      
      this.nftMintProgramId = new PublicKey(this.config.nftMintProgramId);
      
      await this.loadState();
      
      logger.info('NFT Relayer initialized successfully');
      return true;
    } catch (error) {
      logger.error(`Failed to initialize NFT Relayer: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Start the relayer
   */
  start() {
    if (this.running) {
      logger.warn('NFT Relayer already running');
      return;
    }
    
    logger.info('Starting NFT Relayer');
    this.running = true;
    
    this.ethereumPollInterval = setInterval(async () => {
      try {
        await this.pollEthereumEvents();
      } catch (error) {
        logger.error(`Error polling Ethereum events: ${error.message}`);
      }
    }, ETHEREUM_POLL_INTERVAL);
    
    this.solanaPollInterval = setInterval(async () => {
      try {
        await this.pollSolanaEvents();
      } catch (error) {
        logger.error(`Error polling Solana events: ${error.message}`);
      }
    }, SOLANA_POLL_INTERVAL);
    
    this.pendingProcessInterval = setInterval(async () => {
      try {
        if (!this.circuitBreakerActive) {
          await this.processPendingTransfers();
        }
      } catch (error) {
        logger.error(`Error processing pending transfers: ${error.message}`);
      }
    }, RETRY_DELAY);
    
    this.stateSaveInterval = setInterval(async () => {
      try {
        await this.saveState();
      } catch (error) {
        logger.error(`Error saving state: ${error.message}`);
      }
    }, STATE_SAVE_INTERVAL);
    
    if (this.config.metricsEnabled) {
      this.metricsInterval = setInterval(() => {
        try {
          this.updateMetrics();
        } catch (error) {
          logger.error(`Error updating metrics: ${error.message}`);
        }
      }, 30000); // Update metrics every 30 seconds
    }
    
    logger.info('NFT Relayer started');
  }
  
  /**
   * Stop the relayer
   */
  async stop() {
    if (!this.running) {
      return;
    }
    
    logger.info('Stopping NFT Relayer');
    
    clearInterval(this.ethereumPollInterval);
    clearInterval(this.solanaPollInterval);
    clearInterval(this.pendingProcessInterval);
    clearInterval(this.stateSaveInterval);
    
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    
    await this.saveState();
    
    this.running = false;
    logger.info('NFT Relayer stopped');
  }
  
  /**
   * Poll for Ethereum NFT deposit events
   */
  async pollEthereumEvents() {
    try {
      const currentBlock = await this.ethereumProvider.getBlockNumber();
      
      if (this.lastEthereumBlock === 0) {
        this.lastEthereumBlock = currentBlock;
        return;
      }
      
      const fromBlock = this.lastEthereumBlock + 1;
      const toBlock = currentBlock;
      
      if (fromBlock > toBlock) {
        return;
      }
      
      logger.info(`Polling Ethereum events from block ${fromBlock} to ${toBlock}`);
      
      const depositFilter = this.nftVault.filters.NFTDeposit();
      const depositEvents = await this.nftVault.queryFilter(depositFilter, fromBlock, toBlock);
      
      for (const event of depositEvents) {
        const { collection, sender, tokenId, solanaRecipient, nonce, metadataURI } = event.args;
        const depositId = `${collection.toLowerCase()}-${tokenId.toString()}-${nonce.toString()}`;
        
        if (this.processedDeposits.has(depositId)) {
          continue;
        }
        
        logger.info(`Found new NFT deposit: ${depositId}`);
        
        this.pendingDeposits.set(depositId, {
          type: 'ethereum_deposit',
          collection: collection,
          tokenId: tokenId.toString(),
          sender: sender,
          solanaRecipient: solanaRecipient,
          nonce: nonce.toString(),
          metadataURI: metadataURI,
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash,
          timestamp: Date.now(),
          retries: 0,
          lastAttempt: 0,
          lastError: null
        });
        
        this.metrics.pendingTransfers++;
      }
      
      this.lastEthereumBlock = toBlock;
    } catch (error) {
      logger.error(`Error polling Ethereum events: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Poll for Solana NFT burn events
   */
  async pollSolanaEvents() {
    try {
      logger.info('Polling Solana events');
      
      const signatures = await this.solanaConnection.getSignaturesForAddress(
        this.nftMintProgramId,
        { limit: 100 }
      );
      
      if (signatures.length === 0) {
        return;
      }
      
      if (!this.lastSolanaSignature) {
        this.lastSolanaSignature = signatures[0].signature;
        return;
      }
      
      const lastIndex = signatures.findIndex(sig => sig.signature === this.lastSolanaSignature);
      
      const newSignatures = lastIndex >= 0 
        ? signatures.slice(0, lastIndex) 
        : signatures;
      
      if (newSignatures.length === 0) {
        return;
      }
      
      logger.info(`Found ${newSignatures.length} new Solana transactions`);
      
      this.lastSolanaSignature = newSignatures[0].signature;
      
      for (const sig of newSignatures) {
        try {
          const tx = await this.solanaConnection.getTransaction(sig.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          });
          
          if (!tx || !tx.meta || !tx.transaction) {
            continue;
          }
          
          const instructions = tx.transaction.message.instructions;
          for (const ix of instructions) {
            if (!ix.programId.equals(this.nftMintProgramId)) {
              continue;
            }
            
            const data = Buffer.from(ix.data, 'base64');
            
            if (data[0] !== 3) {
              continue;
            }
            
            const tokenId = data.readBigUInt64LE(1).toString();
            const ethereumRecipient = '0x' + data.slice(9, 29).toString('hex');
            
            const withdrawalId = `${tokenId}-${ethereumRecipient}-${sig.signature}`;
            
            if (this.processedWithdrawals.has(withdrawalId)) {
              continue;
            }
            
            logger.info(`Found new NFT burn: ${withdrawalId}`);
            
            const accounts = ix.accounts.map(acc => acc.toBase58());
            
            this.pendingWithdrawals.set(withdrawalId, {
              type: 'solana_withdrawal',
              tokenId: tokenId,
              ethereumRecipient: ethereumRecipient,
              solanaSourceAccount: accounts[0], // Owner account
              signature: sig.signature,
              timestamp: Date.now(),
              retries: 0,
              lastAttempt: 0,
              lastError: null
            });
            
            this.metrics.pendingTransfers++;
          }
        } catch (error) {
          logger.error(`Error processing Solana transaction ${sig.signature}: ${error.message}`);
        }
      }
    } catch (error) {
      logger.error(`Error polling Solana events: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Process pending transfers
   */
  async processPendingTransfers() {
    for (const [depositId, deposit] of this.pendingDeposits.entries()) {
      if (deposit.retries >= MAX_RETRIES) {
        logger.error(`Deposit ${depositId} exceeded max retries, marking as failed`);
        this.pendingDeposits.delete(depositId);
        this.metrics.failedTransfers++;
        this.metrics.pendingTransfers--;
        continue;
      }
      
      const backoffMs = RETRY_DELAY * Math.pow(1.5, deposit.retries);
      if (Date.now() - deposit.lastAttempt < backoffMs) {
        continue;
      }
      
      try {
        logger.info(`Processing deposit ${depositId} (attempt ${deposit.retries + 1}/${MAX_RETRIES})`);
        
        logger.info(`Minting NFT on Solana for deposit ${depositId}`);
        
        this.processedDeposits.add(depositId);
        this.pendingDeposits.delete(depositId);
        
        this.metrics.successfulTransfers++;
        this.metrics.pendingTransfers--;
        this.metrics.totalProcessed++;
        
        const processingTime = Date.now() - deposit.timestamp;
        this.metrics.processingTimes.push(processingTime);
        
        const sum = this.metrics.processingTimes.reduce((a, b) => a + b, 0);
        this.metrics.avgConfirmationTime = sum / this.metrics.processingTimes.length;
        
        logger.info(`Successfully processed deposit ${depositId}`);
      } catch (error) {
        logger.error(`Error processing deposit ${depositId}: ${error.message}`);
        
        deposit.retries++;
        deposit.lastAttempt = Date.now();
        deposit.lastError = error.message;
        this.pendingDeposits.set(depositId, deposit);
      }
    }
    
    for (const [withdrawalId, withdrawal] of this.pendingWithdrawals.entries()) {
      if (withdrawal.retries >= MAX_RETRIES) {
        logger.error(`Withdrawal ${withdrawalId} exceeded max retries, marking as failed`);
        this.pendingWithdrawals.delete(withdrawalId);
        this.metrics.failedTransfers++;
        this.metrics.pendingTransfers--;
        continue;
      }
      
      const backoffMs = RETRY_DELAY * Math.pow(1.5, withdrawal.retries);
      if (Date.now() - withdrawal.lastAttempt < backoffMs) {
        continue;
      }
      
      try {
        logger.info(`Processing withdrawal ${withdrawalId} (attempt ${withdrawal.retries + 1}/${MAX_RETRIES})`);
        
        logger.info(`Withdrawing NFT on Ethereum for withdrawal ${withdrawalId}`);
        
        this.processedWithdrawals.add(withdrawalId);
        this.pendingWithdrawals.delete(withdrawalId);
        
        this.metrics.successfulTransfers++;
        this.metrics.pendingTransfers--;
        this.metrics.totalProcessed++;
        
        const processingTime = Date.now() - withdrawal.timestamp;
        this.metrics.processingTimes.push(processingTime);
        
        const sum = this.metrics.processingTimes.reduce((a, b) => a + b, 0);
        this.metrics.avgConfirmationTime = sum / this.metrics.processingTimes.length;
        
        logger.info(`Successfully processed withdrawal ${withdrawalId}`);
      } catch (error) {
        logger.error(`Error processing withdrawal ${withdrawalId}: ${error.message}`);
        
        withdrawal.retries++;
        withdrawal.lastAttempt = Date.now();
        withdrawal.lastError = error.message;
        this.pendingWithdrawals.set(withdrawalId, withdrawal);
      }
    }
    
    this._checkCircuitBreaker();
  }
  
  /**
   * Circuit breaker to handle systematic failures
   */
  _checkCircuitBreaker() {
    const WINDOW_SIZE = 10; // Number of recent transfers to consider
    const FAILURE_THRESHOLD = 0.7; // 70% failure rate triggers the circuit breaker
    const RESET_TIMEOUT = 300000; // 5 minutes
    
    const recentDeposits = Array.from(this.pendingDeposits.values())
      .filter(deposit => deposit.retries >= MAX_RETRIES)
      .slice(-WINDOW_SIZE);
      
    const recentWithdrawals = Array.from(this.pendingWithdrawals.values())
      .filter(withdrawal => withdrawal.retries >= MAX_RETRIES)
      .slice(-WINDOW_SIZE);
    
    const recentTransfers = [...recentDeposits, ...recentWithdrawals];
    
    if (recentTransfers.length < 5) {
      return;
    }
    
    const failureRate = recentTransfers.length / WINDOW_SIZE;
    
    if (failureRate >= FAILURE_THRESHOLD) {
      logger.error(`Circuit breaker triggered: ${failureRate.toFixed(2)} failure rate`);
      
      this.circuitBreakerActive = true;
      
      setTimeout(() => {
        logger.info('Circuit breaker reset, resuming operations');
        this.circuitBreakerActive = false;
      }, RESET_TIMEOUT);
    }
  }
  
  /**
   * Save relayer state to disk
   */
  async saveState() {
    try {
      const state = {
        pendingDeposits: Array.from(this.pendingDeposits.entries()),
        pendingWithdrawals: Array.from(this.pendingWithdrawals.entries()),
        processedDeposits: Array.from(this.processedDeposits),
        processedWithdrawals: Array.from(this.processedWithdrawals),
        lastEthereumBlock: this.lastEthereumBlock,
        lastSolanaSignature: this.lastSolanaSignature,
        metrics: this.metrics,
        timestamp: Date.now()
      };
      
      await promisify(fs.writeFile)(
        this.config.stateFile,
        JSON.stringify(state, null, 2),
        'utf8'
      );
      
      logger.info('State saved successfully');
    } catch (error) {
      logger.error(`Error saving state: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Load relayer state from disk
   */
  async loadState() {
    try {
      if (!fs.existsSync(this.config.stateFile)) {
        logger.info('No state file found, starting with fresh state');
        return;
      }
      
      const stateData = await promisify(fs.readFile)(this.config.stateFile, 'utf8');
      const state = JSON.parse(stateData);
      
      this.pendingDeposits = new Map(state.pendingDeposits || []);
      this.pendingWithdrawals = new Map(state.pendingWithdrawals || []);
      this.processedDeposits = new Set(state.processedDeposits || []);
      this.processedWithdrawals = new Set(state.processedWithdrawals || []);
      this.lastEthereumBlock = state.lastEthereumBlock || 0;
      this.lastSolanaSignature = state.lastSolanaSignature || '';
      this.metrics = state.metrics || this.metrics;
      
      logger.info('State loaded successfully');
    } catch (error) {
      logger.error(`Error loading state: ${error.message}`);
    }
  }
  
  /**
   * Update metrics
   */
  updateMetrics() {
    if (!this.config.metricsEnabled) {
      return;
    }
    
    try {
      const componentMetrics = {
        pendingDeposits: this.pendingDeposits.size,
        pendingWithdrawals: this.pendingWithdrawals.size,
        processedDeposits: this.processedDeposits.size,
        processedWithdrawals: this.processedWithdrawals.size,
        successfulTransfers: this.metrics.successfulTransfers,
        failedTransfers: this.metrics.failedTransfers,
        avgConfirmationTime: this.metrics.avgConfirmationTime,
        circuitBreakerActive: this.circuitBreakerActive
      };
      
      axios.post(this.config.metricsEndpoint, {
        component: 'nft-relayer',
        metrics: componentMetrics
      }).catch(error => {
        logger.error(`Failed to send metrics: ${error.message}`);
      });
      
      logger.debug('Metrics updated');
    } catch (error) {
      logger.error(`Error updating metrics: ${error.message}`);
    }
  }
  
  /**
   * Get relayer status
   */
  getStatus() {
    return {
      running: this.running,
      circuitBreakerActive: this.circuitBreakerActive,
      pendingDeposits: this.pendingDeposits.size,
      pendingWithdrawals: this.pendingWithdrawals.size,
      processedDeposits: this.processedDeposits.size,
      processedWithdrawals: this.processedWithdrawals.size,
      lastEthereumBlock: this.lastEthereumBlock,
      metrics: this.metrics
    };
  }
}

module.exports = { NFTRelayer };

if (require.main === module) {
  const relayer = new NFTRelayer({
    ethereumRpc: process.env.ETHEREUM_RPC || 'http://localhost:8545',
    solanaRpc: process.env.SOLANA_RPC || 'http://localhost:8899',
    ethereumPrivateKey: process.env.ETHEREUM_PRIVATE_KEY || '',
    solanaPrivateKey: process.env.SOLANA_PRIVATE_KEY || '',
    nftVaultAddress: process.env.NFT_VAULT_ADDRESS || '',
    nftMintProgramId: process.env.NFT_MINT_PROGRAM_ID || '',
    metricsEnabled: process.env.METRICS_ENABLED !== 'false',
    metricsEndpoint: process.env.METRICS_ENDPOINT || 'http://localhost:3000/api/metrics/components'
  });
  
  relayer.initialize().then(success => {
    if (success) {
      relayer.start();
      
      process.on('SIGINT', async () => {
        logger.info('Received SIGINT, shutting down');
        await relayer.stop();
        process.exit(0);
      });
      
      process.on('SIGTERM', async () => {
        logger.info('Received SIGTERM, shutting down');
        await relayer.stop();
        process.exit(0);
      });
    } else {
      logger.error('Failed to initialize relayer, exiting');
      process.exit(1);
    }
  }).catch(error => {
    logger.error(`Error initializing relayer: ${error.message}`);
    process.exit(1);
  });
}
