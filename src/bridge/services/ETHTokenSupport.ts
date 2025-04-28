// English comment for verification
/**
 * @file ETHTokenSupport.ts
 * @description Implementation of ETH token support on Solana Layer-2
 * @author Manus AI
 * @date April 27, 2025
 */

import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ethers } from 'ethers';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { Token, TOKEN_PROGRAM_ID, MintLayout, AccountLayout } from '@solana/spl-token';
import { ChainId, CHAIN_ID_ETH, CHAIN_ID_SOLANA } from '@certusone/wormhole-sdk';
import { Logger } from '../utils/Logger';
import { ConfigService } from '../config/config.service';
import { MetricsService } from '../monitoring/MetricsService';
import { CacheService } from '../utils/CacheService';
import { SecurityService } from '../security/SecurityService';
import { TokenMapping } from '../models/TokenMapping';
import { BridgeTransaction } from '../models/BridgeTransaction';
import { BridgeService } from '../bridge/bridge.service';

/**
 * Interface for ETH token creation parameters
 */
export interface ETHTokenCreationParams {
  // Ethereum token information
  ethereumToken: string;
  symbol: string;
  name: string;
  decimals: number;
  
  // Optional parameters
  initialSupply?: string;
  metadata?: any;
}

/**
 * Interface for ETH token minting parameters
 */
export interface ETHTokenMintParams {
  // Token information
  solanaToken: string;
  amount: string;
  recipient: string;
  
  // Transaction information
  sourceTransaction?: string;
  vaaHash?: string;
}

/**
 * Interface for ETH token burning parameters
 */
export interface ETHTokenBurnParams {
  // Token information
  solanaToken: string;
  amount: string;
  owner: string;
  
  // Transaction information
  destinationAddress?: string;
}

/**
 * ETHTokenSupport service for handling ETH tokens on Solana
 */
@Injectable()
export class ETHTokenSupport {
  private readonly logger: Logger;
  private readonly solanaConnection: Connection;
  private readonly solanaWallet: Keypair;
  private readonly ethereumProvider: ethers.providers.JsonRpcProvider;
  
  /**
   * Constructor for the ETHTokenSupport service
   * 
   * @param tokenMappingRepository - Repository for token mappings
   * @param bridgeTransactionRepository - Repository for bridge transactions
   * @param bridgeService - Bridge service for cross-chain operations
   * @param configService - Configuration service
   * @param metricsService - Metrics service
   * @param cacheService - Cache service
   * @param securityService - Security service
   */
  constructor(
    @InjectRepository(TokenMapping)
    private readonly tokenMappingRepository: Repository<TokenMapping>,
    @InjectRepository(BridgeTransaction)
    private readonly bridgeTransactionRepository: Repository<BridgeTransaction>,
    private readonly bridgeService: BridgeService,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly cacheService: CacheService,
    private readonly securityService: SecurityService
  ) {
    this.logger = new Logger('ETHTokenSupport');
    
    // Initialize Solana connection
    const solanaConfig = this.configService.getSolanaConfig();
    this.solanaConnection = new Connection(solanaConfig.rpc, solanaConfig.commitment);
    this.solanaWallet = Keypair.fromSecretKey(Buffer.from(solanaConfig.privateKey, 'hex'));
    
    // Initialize Ethereum provider
    const ethereumConfig = this.configService.getEthereumConfig();
    this.ethereumProvider = new ethers.providers.JsonRpcProvider(ethereumConfig.rpc);
    
    this.logger.info('ETHTokenSupport service initialized');
  }
  
  /**
   * Create a new ETH token on Solana
   * 
   * @param params - Token creation parameters
   * @returns The created token mint address
   */
  public async createETHToken(params: ETHTokenCreationParams): Promise<string> {
    this.logger.info(`Creating ETH token for ${params.ethereumToken} on Solana`);
    
    try {
      // Check if token mapping already exists
      const existingMapping = await this.tokenMappingRepository.findOne({
        where: { ethereumToken: params.ethereumToken }
      });
      
      if (existingMapping) {
        this.logger.info(`Token mapping already exists for ${params.ethereumToken}: ${existingMapping.solanaToken}`);
        return existingMapping.solanaToken;
      }
      
      // Create a new token mint
      const mintAccount = Keypair.generate();
      
      // Calculate minimum balance for rent exemption
      const mintRent = await this.solanaConnection.getMinimumBalanceForRentExemption(
        MintLayout.span
      );
      
      // Create transaction to create mint account
      const transaction = new Transaction().add(
        // Create mint account
        SystemProgram.createAccount({
          fromPubkey: this.solanaWallet.publicKey,
          newAccountPubkey: mintAccount.publicKey,
          lamports: mintRent,
          space: MintLayout.span,
          programId: TOKEN_PROGRAM_ID
        }),
        // Initialize mint
        Token.createInitMintInstruction(
          TOKEN_PROGRAM_ID,
          mintAccount.publicKey,
          params.decimals,
          this.solanaWallet.publicKey,
          this.solanaWallet.publicKey
        )
      );
      
      // Send and confirm transaction
      await sendAndConfirmTransaction(
        this.solanaConnection,
        transaction,
        [this.solanaWallet, mintAccount],
        { commitment: 'confirmed' }
      );
      
      this.logger.info(`Created ETH token mint on Solana: ${mintAccount.publicKey.toString()}`);
      
      // Create token mapping
      const tokenMapping = new TokenMapping();
      tokenMapping.ethereumToken = params.ethereumToken;
      tokenMapping.solanaToken = mintAccount.publicKey.toString();
      tokenMapping.symbol = params.symbol;
      tokenMapping.name = params.name;
      tokenMapping.decimals = params.decimals;
      tokenMapping.solanaDecimals = params.decimals;
      tokenMapping.active = true;
      tokenMapping.depositsEnabled = true;
      tokenMapping.withdrawalsEnabled = true;
      tokenMapping.metadata = params.metadata || {};
      
      // Save token mapping
      await this.tokenMappingRepository.save(tokenMapping);
      
      this.logger.info(`Created token mapping for ${params.ethereumToken} -> ${mintAccount.publicKey.toString()}`);
      
      // Mint initial supply if specified
      if (params.initialSupply) {
        const recipient = await this.createAssociatedTokenAccount(
          mintAccount.publicKey,
          this.solanaWallet.publicKey
        );
        
        await this.mintETHToken({
          solanaToken: mintAccount.publicKey.toString(),
          amount: params.initialSupply,
          recipient: recipient.toString()
        });
      }
      
      // Record metrics
      this.metricsService.recordMetric('eth_token_support.token_created', {
        ethereumToken: params.ethereumToken,
        solanaToken: mintAccount.publicKey.toString(),
        symbol: params.symbol,
        decimals: params.decimals
      });
      
      return mintAccount.publicKey.toString();
    } catch (error) {
      this.logger.error(`Error creating ETH token on Solana`, error);
      
      // Record error metric
      this.metricsService.recordMetric('eth_token_support.token_creation_errors', 1);
      
      throw new Error(`Failed to create ETH token on Solana: ${error.message}`);
    }
  }
  
  /**
   * Mint ETH tokens on Solana
   * 
   * @param params - Token minting parameters
   * @returns The transaction signature
   */
  public async mintETHToken(params: ETHTokenMintParams): Promise<string> {
    this.logger.info(`Minting ${params.amount} of token ${params.solanaToken} to ${params.recipient}`);
    
    try {
      // Get token mapping
      const tokenMapping = await this.tokenMappingRepository.findOne({
        where: { solanaToken: params.solanaToken }
      });
      
      if (!tokenMapping) {
        throw new Error(`Token mapping not found for ${params.solanaToken}`);
      }
      
      // Parse mint address
      const mintPubkey = new PublicKey(params.solanaToken);
      
      // Parse recipient address
      const recipientPubkey = new PublicKey(params.recipient);
      
      // Create token instance
      const token = new Token(
        this.solanaConnection,
        mintPubkey,
        TOKEN_PROGRAM_ID,
        this.solanaWallet
      );
      
      // Mint tokens
      const transaction = new Transaction().add(
        Token.createMintToInstruction(
          TOKEN_PROGRAM_ID,
          mintPubkey,
          recipientPubkey,
          this.solanaWallet.publicKey,
          [],
          BigInt(params.amount)
        )
      );
      
      // Send and confirm transaction
      const signature = await sendAndConfirmTransaction(
        this.solanaConnection,
        transaction,
        [this.solanaWallet],
        { commitment: 'confirmed' }
      );
      
      this.logger.info(`Minted ${params.amount} tokens to ${params.recipient}: ${signature}`);
      
      // Update token mapping stats
      tokenMapping.totalDeposited = (BigInt(tokenMapping.totalDeposited || '0') + BigInt(params.amount)).toString();
      await this.tokenMappingRepository.save(tokenMapping);
      
      // Record metrics
      this.metricsService.recordMetric('eth_token_support.tokens_minted', {
        solanaToken: params.solanaToken,
        amount: params.amount,
        recipient: params.recipient
      });
      
      // If this mint is related to a bridge transaction, update it
      if (params.sourceTransaction || params.vaaHash) {
        let transaction;
        
        if (params.vaaHash) {
          transaction = await this.bridgeTransactionRepository.findOne({
            where: { vaaHash: params.vaaHash }
          });
        } else if (params.sourceTransaction) {
          transaction = await this.bridgeTransactionRepository.findOne({
            where: { sourceTransactionHash: params.sourceTransaction }
          });
        }
        
        if (transaction) {
          transaction.targetTransactionHash = signature;
          transaction.status = 'COMPLETED';
          transaction.completedAt = new Date();
          await this.bridgeTransactionRepository.save(transaction);
        }
      }
      
      return signature;
    } catch (error) {
      this.logger.error(`Error minting ETH token on Solana`, error);
      
      // Record error metric
      this.metricsService.recordMetric('eth_token_support.token_minting_errors', 1);
      
      throw new Error(`Failed to mint ETH token on Solana: ${error.message}`);
    }
  }
  
  /**
   * Burn ETH tokens on Solana (for withdrawal)
   * 
   * @param params - Token burning parameters
   * @returns The transaction signature
   */
  public async burnETHToken(params: ETHTokenBurnParams): Promise<string> {
    this.logger.info(`Burning ${params.amount} of token ${params.solanaToken} from ${params.owner}`);
    
    try {
      // Get token mapping
      const tokenMapping = await this.tokenMappingRepository.findOne({
        where: { solanaToken: params.solanaToken }
      });
      
      if (!tokenMapping) {
        throw new Error(`Token mapping not found for ${params.solanaToken}`);
      }
      
      // Parse mint address
      const mintPubkey = new PublicKey(params.solanaToken);
      
      // Parse owner address
      const ownerPubkey = new PublicKey(params.owner);
      
      // Create token instance
      const token = new Token(
        this.solanaConnection,
        mintPubkey,
        TOKEN_PROGRAM_ID,
        this.solanaWallet
      );
      
      // Get owner's token account
      const tokenAccounts = await this.solanaConnection.getTokenAccountsByOwner(
        ownerPubkey,
        { mint: mintPubkey }
      );
      
      if (tokenAccounts.value.length === 0) {
        throw new Error(`Token account not found for owner ${params.owner} and mint ${params.solanaToken}`);
      }
      
      const tokenAccountPubkey = tokenAccounts.value[0].pubkey;
      
      // Burn tokens
      const transaction = new Transaction().add(
        Token.createBurnInstruction(
          TOKEN_PROGRAM_ID,
          mintPubkey,
          tokenAccountPubkey,
          ownerPubkey,
          [],
          BigInt(params.amount)
        )
      );
      
      // Send and confirm transaction
      const signature = await sendAndConfirmTransaction(
        this.solanaConnection,
        transaction,
        [this.solanaWallet],
        { commitment: 'confirmed' }
      );
      
      this.logger.info(`Burned ${params.amount} tokens from ${params.owner}: ${signature}`);
      
      // Update token mapping stats
      tokenMapping.totalWithdrawn = (BigInt(tokenMapping.totalWithdrawn || '0') + BigInt(params.amount)).toString();
      await this.tokenMappingRepository.save(tokenMapping);
      
      // Record metrics
      this.metricsService.recordMetric('eth_token_support.tokens_burned', {
        solanaToken: params.solanaToken,
        amount: params.amount,
        owner: params.owner
      });
      
      // If destination address is provided, initiate withdrawal to Ethereum
      if (params.destinationAddress) {
        await this.bridgeService.withdrawFromSolanaToEth({
          sourceChain: CHAIN_ID_SOLANA,
          sourceToken: params.solanaToken,
          amount: params.amount,
          sender: params.owner,
          targetChain: CHAIN_ID_ETH,
          targetRecipient: params.destinationAddress
        });
      }
      
      return signature;
    } catch (error) {
      this.logger.error(`Error burning ETH token on Solana`, error);
      
      // Record error metric
      this.metricsService.recordMetric('eth_token_support.token_burning_errors', 1);
      
      throw new Error(`Failed to burn ETH token on Solana: ${error.message}`);
    }
  }
  
  /**
   * Get ETH token information on Solana
   * 
   * @param solanaToken - Solana token mint address
   * @returns Token information
   */
  public async getETHTokenInfo(solanaToken: string): Promise<any> {
    this.logger.debug(`Getting ETH token info for ${solanaToken}`);
    
    try {
      // Try to get from cache first
      const cacheKey = `eth_token_info_${solanaToken}`;
      const cachedInfo = await this.cacheService.get(cacheKey);
      
      if (cachedInfo) {
        return cachedInfo;
      }
      
      // Get token mapping
      const tokenMapping = await this.tokenMappingRepository.findOne({
        where: { solanaToken }
      });
      
      if (!tokenMapping) {
        throw new Error(`Token mapping not found for ${solanaToken}`);
      }
      
      // Parse mint address
      const mintPubkey = new PublicKey(solanaToken);
      
      // Create token instance
      const token = new Token(
        this.solanaConnection,
        mintPubkey,
        TOKEN_PROGRAM_ID,
        this.solanaWallet
      );
      
      // Get mint info
      const mintInfo = await token.getMintInfo();
      
      // Get Ethereum token info
      const ethereumTokenInfo = await this.getEthereumTokenInfo(tokenMapping.ethereumToken);
      
      // Combine information
      const tokenInfo = {
        solanaToken,
        ethereumToken: tokenMapping.ethereumToken,
        symbol: tokenMapping.symbol,
        name: tokenMapping.name,
        decimals: tokenMapping.decimals,
        solanaDecimals: tokenMapping.solanaDecimals,
        supply: mintInfo.supply.toString(),
        ethereumInfo: ethereumTokenInfo,
        depositsEnabled: tokenMapping.depositsEnabled,
        withdrawalsEnabled: tokenMapping.withdrawalsEnabled,
        minAmount: tokenMapping.minAmount,
        maxAmount: tokenMapping.maxAmount,
        dailyLimit: tokenMapping.dailyLimit,
        totalDeposited: tokenMapping.totalDeposited,
        totalWithdrawn: tokenMapping.totalWithdrawn,
        metadata: tokenMapping.metadata
      };
      
      // Cache token info
      await this.cacheService.set(cacheKey, tokenInfo, 60 * 5); // 5 minutes
      
      return tokenInfo;
    } catch (error) {
      this.logger.error(`Error getting ETH token info on Solana`, error);
      throw new Error(`Failed to get ETH token info on Solana: ${error.message}`);
    }
  }
  
  /**
   * Get Ethereum token information
   * 
   * @param ethereumToken - Ethereum token address
   * @returns Token information
   */
  private async getEthereumTokenInfo(ethereumToken: string): Promise<any> {
    this.logger.debug(`Getting Ethereum token info for ${ethereumToken}`);
    
    try {
      // Try to get from cache first
      const cacheKey = `ethereum_token_info_${ethereumToken}`;
      const cachedInfo = await this.cacheService.get(cacheKey);
      
      if (cachedInfo) {
        return cachedInfo;
      }
      
      // Create ERC20 contract instance
      const erc20Abi = [
        'function name() view returns (string)',
        'function symbol() view returns (string)',
        'function decimals() view returns (uint8)',
        'function totalSupply() view returns (uint256)',
        'function balanceOf(address) view returns (uint256)'
      ];
      
      const contract = new ethers.Contract(ethereumToken, erc20Abi, this.ethereumProvider);
      
      // Get token info
      const [name, symbol, decimals, totalSupply] = await Promise.all([
        contract.name(),
        contract.symbol(),
        contract.decimals(),
        contract.totalSupply()
      ]);
      
      const tokenInfo = {
        address: ethereumToken,
        name,
        symbol,
        decimals,
        totalSupply: totalSupply.toString()
      };
      
      // Cache token info
      await this.cacheService.set(cacheKey, tokenInfo, 60 * 60); // 1 hour
      
      return tokenInfo;
    } catch (error) {
      this.logger.error(`Error getting Ethereum token info`, error);
      return {
        address: ethereumToken,
        error: error.message
      };
    }
  }
  
  /**
   * Create an associated token account for a wallet
   * 
   * @param mint - Token mint address
   * @param owner - Account owner
   * @returns The associated token account address
   */
  private async createAssociatedTokenAccount(
    mint: PublicKey,
    owner: PublicKey
  ): Promise<PublicKey> {
    // Find the associated token account address
    const associatedTokenAddress = await Token.getAssociatedTokenAddress(
      Token.ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mint,
      owner
    );
    
    // Check if the account already exists
    const accountInfo = await this.solanaConnection.getAccountInfo(associatedTokenAddress);
    
    if (accountInfo) {
      return associatedTokenAddress;
    }
    
    // Create the associated token account
    const transaction = new Transaction().add(
      Token.createAssociatedTokenAccountInstruction(
        Token.ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        mint,
        associatedTokenAddress,
        owner,
        this.solanaWallet.publicKey
      )
    );
    
    // Send and confirm transaction
    await sendAndConfirmTransaction(
      this.solanaConnection,
      transaction,
      [this.solanaWallet],
      { commitment: 'confirmed' }
    );
    
    return associatedTokenAddress;
  }
  
  /**
   * Get all ETH tokens on Solana
   * 
   * @returns List of ETH tokens on Solana
   */
  public async getAllETHTokens(): Promise<any[]> {
    this.logger.debug('Getting all ETH tokens on Solana');
    
    try {
      // Try to get from cache first
      const cacheKey = 'all_eth_tokens';
      const cachedTokens = await this.cacheService.get(cacheKey);
      
      if (cachedTokens) {
        return cachedTokens as any[];
      }
      
      // Get all token mappings
      const tokenMappings = await this.tokenMappingRepository.find({
        where: { active: true }
      });
      
      // Get detailed info for each token
      const tokens = await Promise.all(
        tokenMappings.map(async (mapping) => {
          try {
            return await this.getETHTokenInfo(mapping.solanaToken);
          } catch (error) {
            this.logger.warn(`Error getting info for token ${mapping.solanaToken}`, error);
            return {
              solanaToken: mapping.solanaToken,
              ethereumToken: mapping.ethereumToken,
              symbol: mapping.symbol,
              name: mapping.name,
              error: error.message
            };
          }
        })
      );
      
      // Cache tokens
      await this.cacheService.set(cacheKey, tokens, 60 * 5); // 5 minutes
      
      return tokens;
    } catch (error) {
      this.logger.error('Error getting all ETH tokens on Solana', error);
      throw new Error(`Failed to get all ETH tokens on Solana: ${error.message}`);
    }
  }
  
  /**
   * Process a deposit from Ethereum to Solana
   * 
   * @param transaction - Bridge transaction
   * @returns The mint transaction signature
   */
  public async processDeposit(transaction: BridgeTransaction): Promise<string> {
    this.logger.info(`Processing deposit for transaction ${transaction.id}`);
    
    try {
      // Get token mapping
      const tokenMapping = await this.tokenMappingRepository.findOne({
        where: { ethereumToken: transaction.sourceToken }
      });
      
      if (!tokenMapping) {
        throw new Error(`Token mapping not found for ${transaction.sourceToken}`);
      }
      
      // Create recipient token account if it doesn't exist
      const mintPubkey = new PublicKey(tokenMapping.solanaToken);
      const recipientPubkey = new PublicKey(transaction.recipient);
      
      const recipientTokenAccount = await this.createAssociatedTokenAccount(
        mintPubkey,
        recipientPubkey
      );
      
      // Mint tokens to recipient
      const signature = await this.mintETHToken({
        solanaToken: tokenMapping.solanaToken,
        amount: transaction.amount,
        recipient: recipientTokenAccount.toString(),
        sourceTransaction: transaction.sourceTransactionHash,
        vaaHash: transaction.vaaHash
      });
      
      this.logger.info(`Processed deposit for transaction ${transaction.id}: ${signature}`);
      
      return signature;
    } catch (error) {
      this.logger.error(`Error processing deposit for transaction ${transaction.id}`, error);
      
      // Update transaction status
      transaction.status = 'FAILED';
      transaction.error = error.message;
      await this.bridgeTransactionRepository.save(transaction);
      
      throw new Error(`Failed to process deposit: ${error.message}`);
    }
  }
  
  /**
   * Process a withdrawal from Solana to Ethereum
   * 
   * @param transaction - Bridge transaction
   * @returns The burn transaction signature
   */
  public async processWithdrawal(transaction: BridgeTransaction): Promise<string> {
    this.logger.info(`Processing withdrawal for transaction ${transaction.id}`);
    
    try {
      // Get token mapping
      const tokenMapping = await this.tokenMappingRepository.findOne({
        where: { solanaToken: transaction.sourceToken }
      });
      
      if (!tokenMapping) {
        throw new Error(`Token mapping not found for ${transaction.sourceToken}`);
      }
      
      // Burn tokens
      const signature = await this.burnETHToken({
        solanaToken: transaction.sourceToken,
        amount: transaction.amount,
        owner: transaction.sender,
        destinationAddress: transaction.recipient
      });
      
      this.logger.info(`Processed withdrawal for transaction ${transaction.id}: ${signature}`);
      
      return signature;
    } catch (error) {
      this.logger.error(`Error processing withdrawal for transaction ${transaction.id}`, error);
      
      // Update transaction status
      transaction.status = 'FAILED';
      transaction.error = error.message;
      await this.bridgeTransactionRepository.save(transaction);
      
      throw new Error(`Failed to process withdrawal: ${error.message}`);
    }
  }
}
