/**
 * Wormhole Relayer for Solana Layer 2
 * 
 * This module implements a relayer service that monitors events on both Ethereum and Solana,
 * and relays messages between the two chains to facilitate the cross-chain bridge functionality.
 * 
 * @module wormhole-relayer
 */

const { ethers } = require('ethers');
const { Connection, PublicKey, Keypair, Transaction } = require('@solana/web3.js');
const { default: axios } = require('axios');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const { program } = require('commander');
const { NodeWallet } = require('@project-serum/anchor');

// Constants
const ETHEREUM_CONFIRMATION_BLOCKS = 12;
const SOLANA_CONFIRMATION_BLOCKS = 32;
const POLLING_INTERVAL = 15000; // 15 seconds
const MAX_RETRIES = 5;
const RETRY_DELAY = 10000; // 10 seconds

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'relayer.log' })
  ]
});

/**
 * Wormhole Relayer class
 */
class WormholeRelayer {
  /**
   * Constructor
   * @param {Object} config - Configuration object
   */
  constructor(config) {
    this.config = config;
    this.ethProvider = null;
    this.solanaConnection = null;
    this.ethBridgeContract = null;
    this.ethWallet = null;
    this.solanaWallet = null;
    this.running = false;
    this.lastProcessedEthBlock = 0;
    this.lastProcessedSolanaSlot = 0;
    this.pendingMessages = new Map();
    this.processedMessages = new Set();
    this.circuitBreakerActive = false;
    
    // Set up periodic processing of pending messages
    setInterval(() => {
      if (this.running && !this.circuitBreakerActive) {
        this.processPendingMessages().catch(err => {
          logger.error(`Error in periodic pending message processing: ${err.message}`);
        });
      }
    }, RETRY_DELAY);
  }

  /**
   * Initialize the relayer
   */
  async initialize() {
    try {
      logger.info('Initializing Wormhole Relayer...');

      // Initialize Ethereum provider and wallet
      this.ethProvider = new ethers.providers.JsonRpcProvider(this.config.ethereum.rpcUrl);
      
      if (this.config.ethereum.privateKey) {
        this.ethWallet = new ethers.Wallet(this.config.ethereum.privateKey, this.ethProvider);
        logger.info(`Ethereum wallet initialized: ${this.ethWallet.address}`);
      } else if (this.config.ethereum.mnemonic) {
        this.ethWallet = ethers.Wallet.fromMnemonic(this.config.ethereum.mnemonic).connect(this.ethProvider);
        logger.info(`Ethereum wallet initialized from mnemonic: ${this.ethWallet.address}`);
      } else {
        throw new Error('No Ethereum private key or mnemonic provided');
      }

      // Initialize Ethereum bridge contract
      this.ethBridgeContract = new ethers.Contract(
        this.config.ethereum.bridgeAddress,
        this.config.ethereum.bridgeAbi,
        this.ethWallet
      );
      logger.info(`Ethereum bridge contract initialized at ${this.config.ethereum.bridgeAddress}`);

      // Initialize Solana connection and wallet
      this.solanaConnection = new Connection(this.config.solana.rpcUrl);
      
      if (this.config.solana.privateKey) {
        const secretKey = Buffer.from(this.config.solana.privateKey, 'hex');
        this.solanaWallet = Keypair.fromSecretKey(secretKey);
      } else if (this.config.solana.keypairPath) {
        const keypairData = JSON.parse(fs.readFileSync(this.config.solana.keypairPath, 'utf-8'));
        this.solanaWallet = Keypair.fromSecretKey(Buffer.from(keypairData));
      } else {
        throw new Error('No Solana private key or keypair path provided');
      }
      
      logger.info(`Solana wallet initialized: ${this.solanaWallet.publicKey.toString()}`);

      // Initialize last processed block/slot
      if (this.config.startFromLatest) {
        this.lastProcessedEthBlock = await this.ethProvider.getBlockNumber();
        this.lastProcessedSolanaSlot = await this.solanaConnection.getSlot();
        logger.info(`Starting from latest blocks - ETH: ${this.lastProcessedEthBlock}, Solana: ${this.lastProcessedSolanaSlot}`);
      } else {
        this.lastProcessedEthBlock = this.config.ethereum.startBlock || 0;
        this.lastProcessedSolanaSlot = this.config.solana.startSlot || 0;
        logger.info(`Starting from specified blocks - ETH: ${this.lastProcessedEthBlock}, Solana: ${this.lastProcessedSolanaSlot}`);
      }

      logger.info('Wormhole Relayer initialized successfully');
      return true;
    } catch (error) {
      logger.error(`Initialization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Start the relayer service
   */
  async start() {
    if (this.running) {
      logger.warn('Relayer is already running');
      return;
    }

    try {
      await this.initialize();
      this.running = true;
      logger.info('Wormhole Relayer started');

      // Start monitoring both chains
      this.monitorEthereum();
      this.monitorSolana();
    } catch (error) {
      logger.error(`Failed to start relayer: ${error.message}`);
      throw error;
    }
  }

  /**
   * Stop the relayer service
   */
  stop() {
    this.running = false;
    logger.info('Wormhole Relayer stopped');
  }

  /**
   * Monitor Ethereum for bridge events
   */
  async monitorEthereum() {
    while (this.running) {
      try {
        const currentBlock = await this.ethProvider.getBlockNumber();
        
        // Only process if there are new blocks
        if (currentBlock > this.lastProcessedEthBlock) {
          logger.info(`Processing Ethereum blocks from ${this.lastProcessedEthBlock + 1} to ${currentBlock}`);
          
          // Get deposit events
          const depositFilter = this.ethBridgeContract.filters.Deposit();
          const events = await this.ethBridgeContract.queryFilter(
            depositFilter,
            this.lastProcessedEthBlock + 1,
            currentBlock
          );
          
          // Process each deposit event
          for (const event of events) {
            await this.processEthereumDeposit(event);
          }
          
          this.lastProcessedEthBlock = currentBlock;
        }
      } catch (error) {
        logger.error(`Error monitoring Ethereum: ${error.message}`);
      }
      
      // Wait before next polling
      await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
    }
  }

  /**
   * Monitor Solana for bridge events
   */
  async monitorSolana() {
    while (this.running) {
      try {
        const currentSlot = await this.solanaConnection.getSlot();
        
        // Only process if there are new slots
        if (currentSlot > this.lastProcessedSolanaSlot) {
          logger.info(`Processing Solana slots from ${this.lastProcessedSolanaSlot + 1} to ${currentSlot}`);
          
          // Get program accounts that have been updated
          const programId = new PublicKey(this.config.solana.programId);
          const signatures = await this.solanaConnection.getSignaturesForAddress(
            programId,
            { minContextSlot: this.lastProcessedSolanaSlot + 1 }
          );
          
          // Process each transaction
          for (const sig of signatures) {
            await this.processSolanaTransaction(sig.signature);
          }
          
          this.lastProcessedSolanaSlot = currentSlot;
        }
      } catch (error) {
        logger.error(`Error monitoring Solana: ${error.message}`);
      }
      
      // Wait before next polling
      await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
    }
  }

  /**
   * Process an Ethereum deposit event
   * @param {Object} event - Ethereum event object
   * @param {boolean} isRetry - Whether this is a retry attempt
   * @returns {boolean} Success status
   */
  async processEthereumDeposit(event, isRetry = false) {
    try {
      // Wait for confirmations
      const currentBlock = await this.ethProvider.getBlockNumber();
      const confirmations = currentBlock - event.blockNumber;
      
      if (confirmations < ETHEREUM_CONFIRMATION_BLOCKS) {
        logger.info(`Deposit event at block ${event.blockNumber} has ${confirmations}/${ETHEREUM_CONFIRMATION_BLOCKS} confirmations, waiting...`);
        this.pendingMessages.set(event.transactionHash, {
          type: 'ethereum_deposit',
          event,
          retries: 0
        });
        return;
      }
      
      // Extract event data
      const { token, sender, amount, solanaRecipient, nonce } = event.args;
      const messageId = `eth_${event.transactionHash}_${nonce.toString()}`;
      
      // Check if already processed
      if (this.processedMessages.has(messageId)) {
        logger.info(`Message ${messageId} already processed, skipping`);
        return;
      }
      
      logger.info(`Processing Ethereum deposit: ${amount.toString()} of token ${token} from ${sender} to Solana account ${solanaRecipient}`);
      
      // Prepare Solana transaction to mint wrapped tokens
      const transaction = await this.prepareSolanaMintTransaction(token, solanaRecipient, amount, nonce);
      
      // Sign and send Solana transaction
      const signature = await this.sendSolanaTransaction(transaction);
      logger.info(`Solana mint transaction sent: ${signature}`);
      
      // Mark as processed
      this.processedMessages.add(messageId);
      this.pendingMessages.delete(event.transactionHash);
      return true;
    } catch (error) {
      logger.error(`Error processing Ethereum deposit: ${error.message}`);
      
      // If not a retry, add to pending messages
      if (!isRetry) {
        const pendingMessage = this.pendingMessages.get(event.transactionHash) || {
          type: 'ethereum_deposit',
          event,
          retries: 0,
          lastAttempt: Date.now(),
          data: event
        };
        
        this.pendingMessages.set(event.transactionHash, pendingMessage);
        logger.info(`Added to pending messages for retry later`);
      }
      
      return false;
    }
  }

  /**
   * Process a Solana transaction
   * @param {string|Object} signatureOrData - Solana transaction signature or data object
   * @param {boolean} isRetry - Whether this is a retry attempt
   * @returns {boolean} Success status
   */
  async processSolanaTransaction(signatureOrData, isRetry = false) {
    const signature = typeof signatureOrData === 'string' ? signatureOrData : signatureOrData.signature;
    try {
      // Get transaction details
      const tx = await this.solanaConnection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });
      
      if (!tx) {
        logger.warn(`Transaction ${signature} not found`);
        return;
      }
      
      // Check if it's a withdrawal transaction
      const programId = new PublicKey(this.config.solana.programId);
      const isWithdrawal = tx.transaction.message.instructions.some(
        ix => ix.programId.equals(programId) && this.isWithdrawalInstruction(ix)
      );
      
      if (!isWithdrawal) {
        return;
      }
      
      // Extract withdrawal data
      const withdrawalData = this.extractWithdrawalData(tx);
      if (!withdrawalData) {
        logger.warn(`Could not extract withdrawal data from transaction ${signature}`);
        return;
      }
      
      const { token, recipient, amount, solanaSourceAccount, nonce } = withdrawalData;
      const messageId = `sol_${signature}_${nonce.toString()}`;
      
      // Check if already processed
      if (this.processedMessages.has(messageId)) {
        logger.info(`Message ${messageId} already processed, skipping`);
        return;
      }
      
      logger.info(`Processing Solana withdrawal: ${amount.toString()} to Ethereum address ${recipient} from Solana account ${solanaSourceAccount}`);
      
      // Get signatures from other relayers
      const signatures = await this.collectRelayerSignatures(withdrawalData);
      
      // Submit withdrawal to Ethereum
      const ethTx = await this.submitEthereumWithdrawal(withdrawalData, signatures);
      logger.info(`Ethereum withdrawal transaction sent: ${ethTx.hash}`);
      
      // Mark as processed
      this.processedMessages.add(messageId);
      return true;
    } catch (error) {
      logger.error(`Error processing Solana transaction: ${error.message}`);
      
      // If not a retry, add to pending messages
      if (!isRetry) {
        const pendingMessage = {
          type: 'solana_withdrawal',
          data: { signature },
          retries: 0,
          lastAttempt: Date.now()
        };
        
        this.pendingMessages.set(`sol_tx_${signature}`, pendingMessage);
        logger.info(`Added Solana transaction ${signature} to pending messages for retry later`);
      }
      
      return false;
    }
  }

  /**
   * Prepare a Solana transaction to mint wrapped tokens
   * @param {string} token - Ethereum token address
   * @param {string} recipient - Solana recipient account (as hex string)
   * @param {BigNumber} amount - Token amount
   * @param {BigNumber} nonce - Transaction nonce
   * @returns {Transaction} Solana transaction
   */
  async prepareSolanaMintTransaction(token, recipient, amount, nonce) {
    // Convert hex string to PublicKey
    const recipientPubkey = new PublicKey(Buffer.from(recipient.slice(2), 'hex'));
    
    // Get program and associated accounts
    const programId = new PublicKey(this.config.solana.programId);
    const mintAuthority = new PublicKey(this.config.solana.mintAuthority);
    
    // Find wrapped token mint for the Ethereum token
    const [wrappedMint] = await PublicKey.findProgramAddress(
      [Buffer.from('wrapped_token'), Buffer.from(token.slice(2), 'hex')],
      programId
    );
    
    // Find or create associated token account for recipient
    const associatedTokenProgram = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    const [associatedTokenAccount] = await PublicKey.findProgramAddress(
      [recipientPubkey.toBuffer(), wrappedMint.toBuffer()],
      associatedTokenProgram
    );
    
    // Create transaction
    const transaction = new Transaction();
    
    // Add instruction to mint tokens
    transaction.add({
      keys: [
        { pubkey: mintAuthority, isSigner: true, isWritable: false },
        { pubkey: wrappedMint, isSigner: false, isWritable: true },
        { pubkey: associatedTokenAccount, isSigner: false, isWritable: true },
        { pubkey: recipientPubkey, isSigner: false, isWritable: false }
      ],
      programId,
      data: Buffer.from([
        0, // Instruction index for mint
        ...Buffer.from(amount.toString(16).padStart(64, '0'), 'hex'),
        ...Buffer.from(nonce.toString(16).padStart(64, '0'), 'hex'),
        ...Buffer.from(token.slice(2), 'hex')
      ])
    });
    
    return transaction;
  }

  /**
   * Send a Solana transaction
   * @param {Transaction} transaction - Solana transaction
   * @returns {string} Transaction signature
   */
  async sendSolanaTransaction(transaction) {
    transaction.feePayer = this.solanaWallet.publicKey;
    transaction.recentBlockhash = (await this.solanaConnection.getRecentBlockhash()).blockhash;
    
    // Sign transaction
    transaction.sign(this.solanaWallet);
    
    // Send transaction
    const signature = await this.solanaConnection.sendRawTransaction(transaction.serialize());
    
    // Wait for confirmation
    await this.solanaConnection.confirmTransaction(signature);
    
    return signature;
  }

  /**
   * Check if an instruction is a withdrawal instruction
   * @param {Object} instruction - Solana instruction
   * @returns {boolean} True if it's a withdrawal instruction
   */
  isWithdrawalInstruction(instruction) {
    // The first byte of the instruction data is the instruction index
    // 1 = withdrawal in our program
    return instruction.data[0] === 1;
  }

  /**
   * Extract withdrawal data from a Solana transaction
   * @param {Object} tx - Solana transaction
   * @returns {Object|null} Withdrawal data or null if not found
   */
  extractWithdrawalData(tx) {
    try {
      const programId = new PublicKey(this.config.solana.programId);
      
      // Find withdrawal instruction
      const withdrawalIx = tx.transaction.message.instructions.find(
        ix => ix.programId.equals(programId) && this.isWithdrawalInstruction(ix)
      );
      
      if (!withdrawalIx) {
        return null;
      }
      
      // Parse instruction data
      // Format: [1 (instruction index), token (20 bytes), recipient (20 bytes), amount (32 bytes), nonce (32 bytes)]
      const data = withdrawalIx.data;
      
      // Extract data fields
      const token = '0x' + Buffer.from(data.slice(1, 21)).toString('hex');
      const recipient = '0x' + Buffer.from(data.slice(21, 41)).toString('hex');
      const amount = ethers.BigNumber.from('0x' + Buffer.from(data.slice(41, 73)).toString('hex'));
      const nonce = ethers.BigNumber.from('0x' + Buffer.from(data.slice(73, 105)).toString('hex'));
      
      // Get Solana source account from the first account in the instruction
      const solanaSourceAccount = tx.transaction.message.accountKeys[withdrawalIx.accounts[0]].toString();
      
      return {
        token,
        recipient,
        amount,
        solanaSourceAccount,
        nonce
      };
    } catch (error) {
      logger.error(`Error extracting withdrawal data: ${error.message}`);
      return null;
    }
  }

  /**
   * Collect signatures from other relayers
   * @param {Object} withdrawalData - Withdrawal data
   * @returns {Array} Array of signatures
   */
  async collectRelayerSignatures(withdrawalData) {
    const { token, recipient, amount, solanaSourceAccount, nonce } = withdrawalData;
    
    // Create withdrawal hash
    const withdrawalHash = ethers.utils.solidityKeccak256(
      ['address', 'address', 'uint256', 'bytes32', 'uint256'],
      [token, recipient, amount, solanaSourceAccount, nonce]
    );
    
    // Sign with our key
    const signature = await this.ethWallet.signMessage(ethers.utils.arrayify(withdrawalHash));
    const signatures = [signature];
    
    // In a real implementation, we would collect signatures from other relayers
    // For this example, we'll simulate it by signing with our key multiple times
    if (this.config.simulateMultipleRelayers) {
      for (let i = 1; i < this.config.ethereum.relayerThreshold; i++) {
        signatures.push(signature);
      }
    } else {
      // Request signatures from other relayers
      for (const relayerUrl of this.config.relayerUrls) {
        try {
          const response = await axios.post(`${relayerUrl}/sign`, {
            withdrawalHash: withdrawalHash,
            data: withdrawalData
          });
          
          if (response.data && response.data.signature) {
            signatures.push(response.data.signature);
          }
        } catch (error) {
          logger.error(`Error getting signature from relayer ${relayerUrl}: ${error.message}`);
        }
      }
    }
    
    return signatures;
  }

  /**
   * Submit a withdrawal to Ethereum
   * @param {Object} withdrawalData - Withdrawal data
   * @param {Array} signatures - Array of signatures
   * @returns {Object} Ethereum transaction
   */
  async submitEthereumWithdrawal(withdrawalData, signatures) {
    const { token, recipient, amount, solanaSourceAccount, nonce } = withdrawalData;
    
    // Prepare withdrawal data for contract
    const withdrawalDataForContract = {
      token,
      recipient,
      amount,
      solanaSourceAccount,
      nonce
    };
    
    // Submit withdrawal to Ethereum
    const tx = await this.ethBridgeContract.withdraw(
      withdrawalDataForContract,
      signatures,
      { gasLimit: this.config.ethereum.gasLimit }
    );
    
    // Wait for transaction to be mined
    await tx.wait(1);
    
    return tx;
  }

  /**
   * Process pending messages with progressive backoff and recovery
   */
  async processPendingMessages() {
    for (const [messageId, message] of this.pendingMessages.entries()) {
      if (message.retries >= MAX_RETRIES) {
        logger.error(`Message ${messageId} exceeded max retries (${MAX_RETRIES}), marking as failed`);
        this.pendingMessages.delete(messageId);
        continue;
      }
      
      try {
        logger.info(`Processing pending message ${messageId} (attempt ${message.retries + 1}/${MAX_RETRIES})`);
        
        const backoffMs = RETRY_DELAY * Math.pow(1.5, message.retries);
        
        if (Date.now() - (message.lastAttempt || 0) < backoffMs) {
          continue;
        }
        
        // Process message based on type
        let success = false;
        if (message.type === 'ethereum_deposit') {
          success = await this.processEthereumDeposit(message.event, true);
        } else if (message.type === 'solana_withdrawal') {
          success = await this.processSolanaTransaction(message.data, true);
        }
        
        if (success) {
          logger.info(`Successfully processed message ${messageId} on attempt ${message.retries + 1}`);
          this.pendingMessages.delete(messageId);
          this.processedMessages.add(messageId);
        } else {
          message.retries++;
          message.lastAttempt = Date.now();
          this.pendingMessages.set(messageId, message);
          logger.warn(`Failed to process message ${messageId}, will retry (${message.retries}/${MAX_RETRIES})`);
        }
      } catch (error) {
        message.retries = (message.retries || 0) + 1;
        message.lastAttempt = Date.now();
        message.lastError = error.message;
        this.pendingMessages.set(messageId, message);
        logger.error(`Error processing message ${messageId}: ${error.message}`);
      }
    }
    
    this._checkCircuitBreaker();
    
    await this.saveState();
  }
  
  /**
   * Circuit breaker to handle systematic failures
   */
  _checkCircuitBreaker() {
    const WINDOW_SIZE = 10; // Number of recent messages to consider
    const FAILURE_THRESHOLD = 0.7; // 70% failure rate triggers the circuit breaker
    const RESET_TIMEOUT = 300000; // 5 minutes
    
    const recentMessages = Array.from(this.processedMessages)
      .slice(-WINDOW_SIZE)
      .concat(Array.from(this.pendingMessages.values())
        .filter(msg => msg.retries >= MAX_RETRIES)
        .slice(-WINDOW_SIZE));
    
    if (recentMessages.length < 5) {
      return;
    }
    
    const failureCount = recentMessages.filter(msg => 
      (typeof msg === 'object' && msg.retries >= MAX_RETRIES)).length;
    
    const failureRate = failureCount / recentMessages.length;
    
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
   * Save state to disk
   */
  async saveState() {
    const state = {
      lastProcessedEthBlock: this.lastProcessedEthBlock,
      lastProcessedSolanaSlot: this.lastProcessedSolanaSlot,
      processedMessages: Array.from(this.processedMessages)
    };
    
    await promisify(fs.writeFile)(
      this.config.stateFile,
      JSON.stringify(state, null, 2),
      'utf8'
    );
    
    logger.info('State saved to disk');
  }

  /**
   * Load state from disk
   */
  async loadState() {
    try {
      if (fs.existsSync(this.config.stateFile)) {
        const data = await promisify(fs.readFile)(this.config.stateFile, 'utf8');
        const state = JSON.parse(data);
        
        this.lastProcessedEthBlock = state.lastProcessedEthBlock || 0;
        this.lastProcessedSolanaSlot = state.lastProcessedSolanaSlot || 0;
        this.processedMessages = new Set(state.processedMessages || []);
        
        logger.info('State loaded from disk');
      }
    } catch (error) {
      logger.error(`Error loading state: ${error.message}`);
    }
  }
}

/**
 * Main function
 */
async function main() {
  // Parse command line arguments
  program
    .option('-c, --config <path>', 'Path to config file', './config.json')
    .option('-s, --start-latest', 'Start from latest blocks', false)
    .parse(process.argv);
  
  const options = program.opts();
  
  // Load config
  let config;
  try {
    const configPath = path.resolve(options.config);
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    logger.error(`Error loading config: ${error.message}`);
    process.exit(1);
  }
  
  // Override config with command line options
  config.startFromLatest = options.startLatest;
  
  // Create and start relayer
  const relayer = new WormholeRelayer(config);
  
  // Handle shutdown
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down...');
    relayer.stop();
    await relayer.saveState();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down...');
    relayer.stop();
    await relayer.saveState();
    process.exit(0);
  });
  
  // Start relayer
  try {
    await relayer.loadState();
    await relayer.start();
    
    // Periodically save state
    setInterval(() => {
      relayer.saveState().catch(error => {
        logger.error(`Error saving state: ${error.message}`);
      });
    }, 60000); // Every minute
    
    // Periodically process pending messages
    setInterval(() => {
      relayer.processPendingMessages().catch(error => {
        logger.error(`Error processing pending messages: ${error.message}`);
      });
    }, RETRY_DELAY);
  } catch (error) {
    logger.error(`Error starting relayer: ${error.message}`);
    process.exit(1);
  }
}

// Run main function if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    logger.error(`Unhandled error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  WormholeRelayer
};
