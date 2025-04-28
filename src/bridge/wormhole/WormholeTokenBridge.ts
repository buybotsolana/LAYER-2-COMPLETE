// English comment for verification
/**
 * @file WormholeTokenBridge.ts
 * @description Implementation of token bridge functionality for Wormhole integration
 * @author Manus AI
 * @date April 27, 2025
 */

import {
  ChainId,
  CHAIN_ID_ETH,
  CHAIN_ID_SOLANA,
  attestFromEth,
  attestFromSolana,
  createWrappedOnEth,
  createWrappedOnSolana,
  getIsTransferCompletedEth,
  getIsTransferCompletedSolana,
  getOriginalAssetEth,
  getOriginalAssetSolana,
  parseSequenceFromLogEth,
  parseSequenceFromLogSolana,
  redeemOnEth,
  redeemOnSolana,
  transferFromEth,
  transferFromSolana,
  tryNativeToHexString,
  tryHexToNativeString,
  parseAttestMetaPayload,
  parseTokenTransferPayload,
} from '@certusone/wormhole-sdk';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { ethers } from 'ethers';
import { Logger } from '../../utils/Logger';
import { MetricsService } from '../../monitoring/MetricsService';
import { CacheService } from '../../utils/CacheService';
import { WormholeConfig } from './WormholeConfig';
import { WormholeVAA, TokenTransferData } from './WormholeVAA';
import { EventEmitter } from 'events';

/**
 * Interface for token bridge transaction result
 */
export interface TokenBridgeResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
  sequence?: string;
  vaaBytes?: Buffer;
}

/**
 * Interface for token information
 */
export interface TokenInfo {
  address: string;
  chainId: ChainId;
  name?: string;
  symbol?: string;
  decimals?: number;
  isNative: boolean;
  isWrapped: boolean;
  originalChainId?: ChainId;
  originalAddress?: string;
}

/**
 * WormholeTokenBridge class - Handles token bridge operations between chains
 */
export class WormholeTokenBridge extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: WormholeConfig;
  private readonly metricsService: MetricsService;
  private readonly cacheService: CacheService;
  private readonly vaaService: WormholeVAA;
  
  // Blockchain connections
  private ethereumProvider: ethers.providers.JsonRpcProvider;
  private ethereumWallet: ethers.Wallet;
  private solanaConnection: Connection;
  private solanaWallet: Keypair;
  
  /**
   * Constructor for the WormholeTokenBridge
   * 
   * @param vaaService - VAA service for handling VAAs
   * @param metricsService - Metrics service for monitoring performance
   * @param cacheService - Cache service for optimizing data access
   * @param logger - Logger instance
   * @param config - Configuration for Wormhole
   */
  constructor(
    vaaService: WormholeVAA,
    metricsService: MetricsService,
    cacheService: CacheService,
    logger: Logger,
    config: WormholeConfig
  ) {
    super();
    
    this.vaaService = vaaService;
    this.metricsService = metricsService;
    this.cacheService = cacheService;
    this.logger = logger.createChild('WormholeTokenBridge');
    this.config = config;
    
    // Initialize blockchain connections
    this.ethereumProvider = new ethers.providers.JsonRpcProvider(this.config.ethereum.rpc);
    this.ethereumWallet = new ethers.Wallet(this.config.ethereum.privateKey, this.ethereumProvider);
    this.solanaConnection = new Connection(this.config.solana.rpc, this.config.solana.commitment);
    this.solanaWallet = Keypair.fromSecretKey(Buffer.from(this.config.solana.privateKey, 'hex'));
    
    this.logger.info('WormholeTokenBridge initialized');
  }
  
  /**
   * Transfer tokens from Ethereum to Solana
   * 
   * @param tokenAddress - The token address on Ethereum
   * @param amount - The amount to transfer (in smallest unit)
   * @param recipientAddress - The recipient address on Solana
   * @param options - Additional options
   * @returns The transfer result
   */
  public async transferFromEthToSolana(
    tokenAddress: string,
    amount: string,
    recipientAddress: string,
    options: {
      fee?: string;
      nonce?: number;
      gasLimit?: number;
      gasPrice?: string;
    } = {}
  ): Promise<TokenBridgeResult> {
    this.logger.info(`Transferring ${amount} of token ${tokenAddress} from Ethereum to Solana recipient ${recipientAddress}`);
    
    try {
      const startTime = Date.now();
      
      // Set default options
      const fee = options.fee || '0';
      const nonce = options.nonce || Math.floor(Math.random() * 100000);
      const gasLimit = options.gasLimit || 500000;
      const gasPrice = options.gasPrice || (await this.ethereumProvider.getGasPrice()).toString();
      
      // Convert Solana address to bytes32
      const recipientBytes = tryNativeToHexString(recipientAddress, CHAIN_ID_SOLANA);
      if (!recipientBytes) {
        throw new Error(`Invalid Solana recipient address: ${recipientAddress}`);
      }
      
      // Execute transfer
      const receipt = await transferFromEth(
        this.config.ethereum.tokenBridgeAddress,
        this.ethereumWallet,
        tokenAddress,
        amount,
        CHAIN_ID_SOLANA,
        Buffer.from(recipientBytes.substring(2), 'hex'),
        fee,
        nonce
      );
      
      if (!receipt) {
        throw new Error('Transfer transaction failed');
      }
      
      // Get sequence from logs
      const sequence = parseSequenceFromLogEth(receipt, this.config.ethereum.bridgeAddress);
      
      // Record metrics
      const duration = Date.now() - startTime;
      this.metricsService.recordMetric('wormhole.token_bridge.transfer_eth_to_solana', {
        duration,
        amount,
        token: tokenAddress,
        recipient: recipientAddress,
      });
      
      this.logger.info(`Transfer from Ethereum to Solana completed: ${receipt.transactionHash}, sequence: ${sequence}`);
      
      // Emit event
      this.emit('transferInitiated', {
        sourceChain: CHAIN_ID_ETH,
        targetChain: CHAIN_ID_SOLANA,
        tokenAddress,
        amount,
        recipient: recipientAddress,
        transactionHash: receipt.transactionHash,
        sequence,
      });
      
      return {
        success: true,
        transactionHash: receipt.transactionHash,
        sequence,
      };
    } catch (error) {
      this.logger.error(`Error transferring from Ethereum to Solana`, error);
      
      // Record error metric
      this.metricsService.recordMetric('wormhole.token_bridge.transfer_eth_to_solana_errors', 1);
      
      return {
        success: false,
        error: error.message,
      };
    }
  }
  
  /**
   * Transfer tokens from Solana to Ethereum
   * 
   * @param tokenAddress - The token address on Solana
   * @param amount - The amount to transfer (in smallest unit)
   * @param recipientAddress - The recipient address on Ethereum
   * @param options - Additional options
   * @returns The transfer result
   */
  public async transferFromSolanaToEth(
    tokenAddress: string,
    amount: string,
    recipientAddress: string,
    options: {
      fee?: string;
      nonce?: number;
    } = {}
  ): Promise<TokenBridgeResult> {
    this.logger.info(`Transferring ${amount} of token ${tokenAddress} from Solana to Ethereum recipient ${recipientAddress}`);
    
    try {
      const startTime = Date.now();
      
      // Set default options
      const fee = options.fee || '0';
      const nonce = options.nonce || Math.floor(Math.random() * 100000);
      
      // Convert Ethereum address to bytes32
      const recipientBytes = tryNativeToHexString(recipientAddress, CHAIN_ID_ETH);
      if (!recipientBytes) {
        throw new Error(`Invalid Ethereum recipient address: ${recipientAddress}`);
      }
      
      // Execute transfer
      const transaction = await transferFromSolana(
        this.solanaConnection,
        this.config.solana.bridgeAddress,
        this.config.solana.tokenBridgeAddress,
        this.solanaWallet.publicKey.toString(),
        tokenAddress,
        amount,
        recipientBytes,
        CHAIN_ID_ETH,
        fee,
        nonce
      );
      
      // Sign and send transaction
      transaction.partialSign(this.solanaWallet);
      const txid = await this.solanaConnection.sendRawTransaction(transaction.serialize());
      
      // Wait for confirmation
      await this.solanaConnection.confirmTransaction(txid, this.config.solana.commitment);
      
      // Get transaction
      const tx = await this.solanaConnection.getTransaction(txid, {
        commitment: this.config.solana.commitment,
      });
      
      if (!tx) {
        throw new Error('Transfer transaction not found');
      }
      
      // Get sequence from logs
      const sequence = parseSequenceFromLogSolana(tx);
      
      // Record metrics
      const duration = Date.now() - startTime;
      this.metricsService.recordMetric('wormhole.token_bridge.transfer_solana_to_eth', {
        duration,
        amount,
        token: tokenAddress,
        recipient: recipientAddress,
      });
      
      this.logger.info(`Transfer from Solana to Ethereum completed: ${txid}, sequence: ${sequence}`);
      
      // Emit event
      this.emit('transferInitiated', {
        sourceChain: CHAIN_ID_SOLANA,
        targetChain: CHAIN_ID_ETH,
        tokenAddress,
        amount,
        recipient: recipientAddress,
        transactionHash: txid,
        sequence,
      });
      
      return {
        success: true,
        transactionHash: txid,
        sequence,
      };
    } catch (error) {
      this.logger.error(`Error transferring from Solana to Ethereum`, error);
      
      // Record error metric
      this.metricsService.recordMetric('wormhole.token_bridge.transfer_solana_to_eth_errors', 1);
      
      return {
        success: false,
        error: error.message,
      };
    }
  }
  
  /**
   * Redeem a token transfer on Ethereum
   * 
   * @param vaaBytes - The VAA bytes
   * @param options - Additional options
   * @returns The redemption result
   */
  public async redeemOnEthereum(
    vaaBytes: Buffer,
    options: {
      gasLimit?: number;
      gasPrice?: string;
    } = {}
  ): Promise<TokenBridgeResult> {
    this.logger.info(`Redeeming token transfer on Ethereum`);
    
    try {
      const startTime = Date.now();
      
      // Set default options
      const gasLimit = options.gasLimit || 1000000;
      const gasPrice = options.gasPrice || (await this.ethereumProvider.getGasPrice()).toString();
      
      // Parse VAA to get transfer details
      const vaaData = this.vaaService.parseVAA(vaaBytes);
      const tokenTransfer = this.vaaService.extractTokenTransfer(vaaData);
      
      if (!tokenTransfer) {
        throw new Error('VAA is not a token transfer');
      }
      
      // Check if already redeemed
      const isCompleted = await getIsTransferCompletedEth(
        this.ethereumProvider,
        this.config.ethereum.tokenBridgeAddress,
        vaaBytes
      );
      
      if (isCompleted) {
        this.logger.info(`Token transfer already redeemed on Ethereum`);
        return {
          success: true,
          error: 'Transfer already redeemed',
        };
      }
      
      // Redeem on Ethereum
      const receipt = await redeemOnEth(
        this.config.ethereum.tokenBridgeAddress,
        this.ethereumWallet,
        vaaBytes,
        {
          gasLimit,
          gasPrice,
        }
      );
      
      if (!receipt) {
        throw new Error('Redemption transaction failed');
      }
      
      // Record metrics
      const duration = Date.now() - startTime;
      this.metricsService.recordMetric('wormhole.token_bridge.redeem_on_ethereum', {
        duration,
        amount: tokenTransfer.amount,
        token: tokenTransfer.tokenAddress,
        recipient: tokenTransfer.recipient,
      });
      
      this.logger.info(`Token transfer redeemed on Ethereum: ${receipt.transactionHash}`);
      
      // Emit event
      this.emit('transferCompleted', {
        sourceChain: tokenTransfer.tokenChain,
        targetChain: CHAIN_ID_ETH,
        tokenAddress: tokenTransfer.tokenAddress,
        amount: tokenTransfer.amount,
        recipient: tokenTransfer.recipient,
        transactionHash: receipt.transactionHash,
        vaaHash: vaaData.hash,
      });
      
      return {
        success: true,
        transactionHash: receipt.transactionHash,
      };
    } catch (error) {
      this.logger.error(`Error redeeming token transfer on Ethereum`, error);
      
      // Record error metric
      this.metricsService.recordMetric('wormhole.token_bridge.redeem_on_ethereum_errors', 1);
      
      return {
        success: false,
        error: error.message,
      };
    }
  }
  
  /**
   * Redeem a token transfer on Solana
   * 
   * @param vaaBytes - The VAA bytes
   * @returns The redemption result
   */
  public async redeemOnSolana(vaaBytes: Buffer): Promise<TokenBridgeResult> {
    this.logger.info(`Redeeming token transfer on Solana`);
    
    try {
      const startTime = Date.now();
      
      // Parse VAA to get transfer details
      const vaaData = this.vaaService.parseVAA(vaaBytes);
      const tokenTransfer = this.vaaService.extractTokenTransfer(vaaData);
      
      if (!tokenTransfer) {
        throw new Error('VAA is not a token transfer');
      }
      
      // Check if already redeemed
      const isCompleted = await getIsTransferCompletedSolana(
        this.solanaConnection,
        this.config.solana.tokenBridgeAddress,
        vaaBytes
      );
      
      if (isCompleted) {
        this.logger.info(`Token transfer already redeemed on Solana`);
        return {
          success: true,
          error: 'Transfer already redeemed',
        };
      }
      
      // Post VAA to Solana
      await postVaaSolana(
        this.solanaConnection,
        this.solanaWallet,
        this.config.solana.bridgeAddress,
        this.solanaWallet.publicKey.toString(),
        vaaBytes
      );
      
      // Redeem on Solana
      const transaction = await redeemOnSolana(
        this.solanaConnection,
        this.config.solana.bridgeAddress,
        this.config.solana.tokenBridgeAddress,
        this.solanaWallet.publicKey.toString(),
        vaaBytes
      );
      
      // Sign and send transaction
      transaction.partialSign(this.solanaWallet);
      const txid = await this.solanaConnection.sendRawTransaction(transaction.serialize());
      
      // Wait for confirmation
      await this.solanaConnection.confirmTransaction(txid, this.config.solana.commitment);
      
      // Record metrics
      const duration = Date.now() - startTime;
      this.metricsService.recordMetric('wormhole.token_bridge.redeem_on_solana', {
        duration,
        amount: tokenTransfer.amount,
        token: tokenTransfer.tokenAddress,
        recipient: tokenTransfer.recipient,
      });
      
      this.logger.info(`Token transfer redeemed on Solana: ${txid}`);
      
      // Emit event
      this.emit('transferCompleted', {
        sourceChain: tokenTransfer.tokenChain,
        targetChain: CHAIN_ID_SOLANA,
        tokenAddress: tokenTransfer.tokenAddress,
        amount: tokenTransfer.amount,
        recipient: tokenTransfer.recipient,
        transactionHash: txid,
        vaaHash: vaaData.hash,
      });
      
      return {
        success: true,
        transactionHash: txid,
      };
    } catch (error) {
      this.logger.error(`Error redeeming token transfer on Solana`, error);
      
      // Record error metric
      this.metricsService.recordMetric('wormhole.token_bridge.redeem_on_solana_errors', 1);
      
      return {
        success: false,
        error: error.message,
      };
    }
  }
  
  /**
   * Get token information
   * 
   * @param tokenAddress - The token address
   * @param chainId - The chain ID
   * @returns The token information
   */
  public async getTokenInfo(tokenAddress: string, chainId: ChainId): Promise<TokenInfo> {
    this.logger.debug(`Getting token info for ${tokenAddress} on chain ${chainId}`);
    
    try {
      // Try to get from cache first
      const cacheKey = `token_info_${chainId}_${tokenAddress}`;
      const cachedInfo = await this.cacheService.get(cacheKey);
      
      if (cachedInfo) {
        this.logger.debug(`Using cached token info for ${tokenAddress} on chain ${chainId}`);
        return cachedInfo as TokenInfo;
      }
      
      let tokenInfo: TokenInfo;
      
      if (chainId === CHAIN_ID_ETH) {
        // Get token info from Ethereum
        const originalAsset = await getOriginalAssetEth(
          this.ethereumProvider,
          this.config.ethereum.tokenBridgeAddress,
          tokenAddress
        );
        
        const isWrapped = originalAsset.chainId !== 0;
        
        // Create token info
        tokenInfo = {
          address: tokenAddress,
          chainId: CHAIN_ID_ETH,
          isNative: false,
          isWrapped,
        };
        
        if (isWrapped) {
          tokenInfo.originalChainId = originalAsset.chainId;
          tokenInfo.originalAddress = Buffer.from(originalAsset.assetAddress).toString('hex');
        }
        
        // Get additional token info (name, symbol, decimals)
        try {
          const tokenContract = new ethers.Contract(
            tokenAddress,
            [
              'function name() view returns (string)',
              'function symbol() view returns (string)',
              'function decimals() view returns (uint8)',
            ],
            this.ethereumProvider
          );
          
          const [name, symbol, decimals] = await Promise.all([
            tokenContract.name(),
            tokenContract.symbol(),
            tokenContract.decimals(),
          ]);
          
          tokenInfo.name = name;
          tokenInfo.symbol = symbol;
          tokenInfo.decimals = decimals;
        } catch (error) {
          this.logger.warn(`Error getting additional token info for ${tokenAddress} on Ethereum`, error);
        }
      } else if (chainId === CHAIN_ID_SOLANA) {
        // Get token info from Solana
        const originalAsset = await getOriginalAssetSolana(
          this.solanaConnection,
          this.config.solana.tokenBridgeAddress,
          tokenAddress
        );
        
        const isWrapped = originalAsset.chainId !== 0;
        
        // Create token info
        tokenInfo = {
          address: tokenAddress,
          chainId: CHAIN_ID_SOLANA,
          isNative: false,
          isWrapped,
        };
        
        if (isWrapped) {
          tokenInfo.originalChainId = originalAsset.chainId;
          tokenInfo.originalAddress = Buffer.from(originalAsset.assetAddress).toString('hex');
        }
        
        // Get additional token info (name, symbol, decimals)
        try {
          // This would require querying the Solana token metadata program
          // For now, leave these fields undefined
        } catch (error) {
          this.logger.warn(`Error getting additional token info for ${tokenAddress} on Solana`, error);
        }
      } else {
        throw new Error(`Unsupported chain ID: ${chainId}`);
      }
      
      // Cache token info
      await this.cacheService.set(
        cacheKey,
        tokenInfo,
        24 * 60 * 60 // 24 hours
      );
      
      return tokenInfo;
    } catch (error) {
      this.logger.error(`Error getting token info for ${tokenAddress} on chain ${chainId}`, error);
      throw error;
    }
  }
  
  /**
   * Attest a token from Ethereum to Solana
   * 
   * @param tokenAddress - The token address on Ethereum
   * @param options - Additional options
   * @returns The attestation result
   */
  public async attestFromEthToSolana(
    tokenAddress: string,
    options: {
      gasLimit?: number;
      gasPrice?: string;
    } = {}
  ): Promise<TokenBridgeResult> {
    this.logger.info(`Attesting token ${tokenAddress} from Ethereum to Solana`);
    
    try {
      const startTime = Date.now();
      
      // Set default options
      const gasLimit = options.gasLimit || 500000;
      const gasPrice = options.gasPrice || (await this.ethereumProvider.getGasPrice()).toString();
      
      // Execute attestation
      const receipt = await attestFromEth(
        this.config.ethereum.tokenBridgeAddress,
        this.ethereumWallet,
        tokenAddress,
        {
          gasLimit,
          gasPrice,
        }
      );
      
      if (!receipt) {
        throw new Error('Attestation transaction failed');
      }
      
      // Get sequence from logs
      const sequence = parseSequenceFromLogEth(receipt, this.config.ethereum.bridgeAddress);
      
      // Record metrics
      const duration = Date.now() - startTime;
      this.metricsService.recordMetric('wormhole.token_bridge.attest_eth_to_solana', {
        duration,
        token: tokenAddress,
      });
      
      this.logger.info(`Token attestation from Ethereum to Solana completed: ${receipt.transactionHash}, sequence: ${sequence}`);
      
      // Emit event
      this.emit('attestationInitiated', {
        sourceChain: CHAIN_ID_ETH,
        targetChain: CHAIN_ID_SOLANA,
        tokenAddress,
        transactionHash: receipt.transactionHash,
        sequence,
      });
      
      return {
        success: true,
        transactionHash: receipt.transactionHash,
        sequence,
      };
    } catch (error) {
      this.logger.error(`Error attesting token from Ethereum to Solana`, error);
      
      // Record error metric
      this.metricsService.recordMetric('wormhole.token_bridge.attest_eth_to_solana_errors', 1);
      
      return {
        success: false,
        error: error.message,
      };
    }
  }
  
  /**
   * Create wrapped token on Solana from Ethereum attestation
   * 
   * @param vaaBytes - The VAA bytes
   * @returns The creation result
   */
  public async createWrappedOnSolana(vaaBytes: Buffer): Promise<TokenBridgeResult> {
    this.logger.info(`Creating wrapped token on Solana`);
    
    try {
      const startTime = Date.now();
      
      // Parse VAA
      const vaaData = this.vaaService.parseVAA(vaaBytes);
      
      // Post VAA to Solana
      await postVaaSolana(
        this.solanaConnection,
        this.solanaWallet,
        this.config.solana.bridgeAddress,
        this.solanaWallet.publicKey.toString(),
        vaaBytes
      );
      
      // Create wrapped token
      const transaction = await createWrappedOnSolana(
        this.solanaConnection,
        this.config.solana.bridgeAddress,
        this.config.solana.tokenBridgeAddress,
        this.solanaWallet.publicKey.toString(),
        vaaBytes
      );
      
      // Sign and send transaction
      transaction.partialSign(this.solanaWallet);
      const txid = await this.solanaConnection.sendRawTransaction(transaction.serialize());
      
      // Wait for confirmation
      await this.solanaConnection.confirmTransaction(txid, this.config.solana.commitment);
      
      // Record metrics
      const duration = Date.now() - startTime;
      this.metricsService.recordMetric('wormhole.token_bridge.create_wrapped_on_solana', {
        duration,
      });
      
      this.logger.info(`Wrapped token created on Solana: ${txid}`);
      
      // Emit event
      this.emit('wrappedTokenCreated', {
        sourceChain: vaaData.emitterChain,
        targetChain: CHAIN_ID_SOLANA,
        transactionHash: txid,
        vaaHash: vaaData.hash,
      });
      
      return {
        success: true,
        transactionHash: txid,
      };
    } catch (error) {
      this.logger.error(`Error creating wrapped token on Solana`, error);
      
      // Record error metric
      this.metricsService.recordMetric('wormhole.token_bridge.create_wrapped_on_solana_errors', 1);
      
      return {
        success: false,
        error: error.message,
      };
    }
  }
  
  /**
   * Get the status of a token transfer
   * 
   * @param sourceChain - The source chain ID
   * @param targetChain - The target chain ID
   * @param sequence - The sequence number
   * @returns The transfer status
   */
  public async getTransferStatus(
    sourceChain: ChainId,
    targetChain: ChainId,
    sequence: string
  ): Promise<{
    status: 'PENDING' | 'COMPLETED' | 'FAILED';
    sourceTransaction?: string;
    targetTransaction?: string;
    vaaBytes?: Buffer;
  }> {
    this.logger.debug(`Getting transfer status for sequence ${sequence} from chain ${sourceChain} to chain ${targetChain}`);
    
    try {
      // Get emitter address based on source chain
      let emitterAddress: string;
      if (sourceChain === CHAIN_ID_ETH) {
        emitterAddress = this.config.ethereum.tokenBridgeAddress;
      } else if (sourceChain === CHAIN_ID_SOLANA) {
        emitterAddress = this.config.solana.tokenBridgeAddress;
      } else {
        throw new Error(`Unsupported source chain: ${sourceChain}`);
      }
      
      // Try to get VAA
      let vaaBytes: Buffer;
      try {
        vaaBytes = await this.vaaService.fetchSignedVAA(sourceChain, emitterAddress, sequence);
      } catch (error) {
        this.logger.warn(`VAA not found for sequence ${sequence}`, error);
        return { status: 'PENDING' };
      }
      
      // Parse VAA
      const vaaData = this.vaaService.parseVAA(vaaBytes);
      
      // Check if transfer is completed on target chain
      let isCompleted = false;
      try {
        isCompleted = await this.vaaService.isVAARedeemed(vaaData, targetChain);
      } catch (error) {
        this.logger.warn(`Error checking if VAA is redeemed`, error);
      }
      
      return {
        status: isCompleted ? 'COMPLETED' : 'PENDING',
        vaaBytes,
      };
    } catch (error) {
      this.logger.error(`Error getting transfer status`, error);
      return { status: 'FAILED' };
    }
  }
}
