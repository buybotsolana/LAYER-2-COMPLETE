// English comment for verification
/**
 * @file ETHTokenSupport.ts
 * @description Service for managing ETH tokens on Solana blockchain
 * @author Manus AI
 * @date April 27, 2025
 */

import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ethers } from 'ethers';
import { Connection, PublicKey, Keypair, Transaction as SolanaTransaction } from '@solana/web3.js';
import { Token, TOKEN_PROGRAM_ID, MintLayout, u64 } from '@solana/spl-token';
import { Logger } from '../utils/Logger';
import { ConfigService } from '../config/ConfigService';
import { MetricsService } from '../monitoring/MetricsService';
import { CacheService } from '../utils/CacheService';
import { WormholeTokenBridge } from '../relayer/wormhole/WormholeTokenBridge';
import { TokenMapping } from '../models/TokenMapping';
import { BridgeConfig } from '../models/BridgeConfig';
import { EventEmitter } from 'events';

/**
 * Interface for token creation parameters
 */
export interface CreateTokenParams {
  name: string;
  symbol: string;
  decimals: number;
  ethereumToken: string;
  initialSupply?: string;
  mintAuthority?: string;
  freezeAuthority?: string;
  metadata?: any;
}

/**
 * Interface for token minting parameters
 */
export interface MintTokensParams {
  solanaToken: string;
  amount: string;
  recipient: string;
  reference?: string;
  metadata?: any;
}

/**
 * Interface for token burning parameters
 */
export interface BurnTokensParams {
  solanaToken: string;
  amount: string;
  owner: string;
  reference?: string;
  metadata?: any;
}

/**
 * Interface for token mapping parameters
 */
export interface MapTokenParams {
  ethereumToken: string;
  solanaToken: string;
  name: string;
  symbol: string;
  decimals: number;
  depositsEnabled?: boolean;
  withdrawalsEnabled?: boolean;
  minAmount?: string;
  maxAmount?: string;
  metadata?: any;
}

/**
 * Interface for token info
 */
export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  mintAuthority: string;
  freezeAuthority: string;
  isInitialized: boolean;
  ethereumToken?: string;
}

/**
 * Service for managing ETH tokens on Solana
 */
@Injectable()
export class ETHTokenSupport extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: BridgeConfig;
  
  // Solana connection
  private solanaConnection: Connection;
  private solanaWallet: Keypair;
  
  // Service state
  private isInitialized: boolean = false;
  
  /**
   * Constructor for the ETHTokenSupport service
   * 
   * @param wormholeTokenBridge - Wormhole token bridge service
   * @param metricsService - Metrics service
   * @param cacheService - Cache service
   * @param logger - Logger
   * @param config - Bridge configuration
   */
  constructor(
    private readonly wormholeTokenBridge: WormholeTokenBridge,
    private readonly metricsService: MetricsService,
    private readonly cacheService: CacheService,
    logger: Logger,
    config: BridgeConfig,
    @InjectRepository(TokenMapping)
    private readonly tokenMappingRepository: Repository<TokenMapping>
  ) {
    super();
    
    this.logger = logger.createChild('ETHTokenSupport');
    this.config = config;
    
    // Initialize Solana connection
    this.solanaConnection = new Connection(this.config.solana.rpc, 'confirmed');
    this.solanaWallet = Keypair.fromSecretKey(Buffer.from(this.config.solana.privateKey, 'hex'));
    
    this.logger.info('ETHTokenSupport service created');
  }
  
  /**
   * Initialize the ETH token support service
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('ETHTokenSupport already initialized');
      return;
    }
    
    this.logger.info('Initializing ETHTokenSupport');
    
    try {
      // Load token mappings
      await this.loadTokenMappings();
      
      this.isInitialized = true;
      this.logger.info('ETHTokenSupport initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize ETHTokenSupport', error);
      throw new Error(`Failed to initialize ETHTokenSupport: ${error.message}`);
    }
  }
  
  /**
   * Load token mappings from database
   */
  private async loadTokenMappings(): Promise<void> {
    this.logger.info('Loading token mappings');
    
    try {
      const tokenMappings = await this.tokenMappingRepository.find({
        where: { active: true }
      });
      
      this.logger.info(`Loaded ${tokenMappings.length} token mappings`);
      
      // Cache token mappings for quick access
      for (const mapping of tokenMappings) {
        const ethereumCacheKey = `token_mapping_eth_${mapping.ethereumToken}`;
        const solanaCacheKey = `token_mapping_sol_${mapping.solanaToken}`;
        
        await this.cacheService.set(ethereumCacheKey, mapping, 3600); // 1 hour
        await this.cacheService.set(solanaCacheKey, mapping, 3600); // 1 hour
      }
    } catch (error) {
      this.logger.error('Error loading token mappings', error);
      throw error;
    }
  }
  
  /**
   * Create a new ETH token on Solana
   * 
   * @param params - Token creation parameters
   * @returns The created token address
   */
  public async createEthToken(params: CreateTokenParams): Promise<string> {
    this.logger.info(`Creating ETH token on Solana: ${params.name} (${params.symbol})`);
    
    try {
      // Check if token already exists for the Ethereum token
      const existingMapping = await this.tokenMappingRepository.findOne({
        where: { ethereumToken: params.ethereumToken }
      });
      
      if (existingMapping) {
        this.logger.warn(`Token mapping already exists for Ethereum token ${params.ethereumToken}: ${existingMapping.solanaToken}`);
        return existingMapping.solanaToken;
      }
      
      // Create token mint account
      const mintAccount = Keypair.generate();
      const mintRent = await this.solanaConnection.getMinimumBalanceForRentExemption(MintLayout.span);
      
      const createMintTransaction = new SolanaTransaction().add(
        // Create mint account
        ethers.utils.solidity.SystemProgram.createAccount({
          fromPubkey: this.solanaWallet.publicKey,
          newAccountPubkey: mintAccount.publicKey,
          lamports: mintRent,
          space: MintLayout.span,
          programId: TOKEN_PROGRAM_ID,
        }),
        // Initialize mint
        Token.createInitMintInstruction(
          TOKEN_PROGRAM_ID,
          mintAccount.publicKey,
          params.decimals,
          new PublicKey(params.mintAuthority || this.solanaWallet.publicKey.toString()),
          params.freezeAuthority ? new PublicKey(params.freezeAuthority) : null
        )
      );
      
      // Sign and send transaction
      const createMintSignature = await this.solanaConnection.sendTransaction(
        createMintTransaction,
        [this.solanaWallet, mintAccount],
        { skipPreflight: false, preflightCommitment: 'confirmed' }
      );
      
      await this.solanaConnection.confirmTransaction(createMintSignature, 'confirmed');
      
      const tokenAddress = mintAccount.publicKey.toString();
      this.logger.info(`Created ETH token on Solana: ${tokenAddress}`);
      
      // Create token mapping
      const tokenMapping = new TokenMapping();
      tokenMapping.ethereumToken = params.ethereumToken;
      tokenMapping.solanaToken = tokenAddress;
      tokenMapping.name = params.name;
      tokenMapping.symbol = params.symbol;
      tokenMapping.decimals = params.decimals;
      tokenMapping.depositsEnabled = true;
      tokenMapping.withdrawalsEnabled = true;
      tokenMapping.active = true;
      tokenMapping.metadata = params.metadata || {};
      
      await this.tokenMappingRepository.save(tokenMapping);
      
      // Cache token mapping
      const ethereumCacheKey = `token_mapping_eth_${params.ethereumToken}`;
      const solanaCacheKey = `token_mapping_sol_${tokenAddress}`;
      
      await this.cacheService.set(ethereumCacheKey, tokenMapping, 3600); // 1 hour
      await this.cacheService.set(solanaCacheKey, tokenMapping, 3600); // 1 hour
      
      // Mint initial supply if specified
      if (params.initialSupply && ethers.BigNumber.from(params.initialSupply).gt(0)) {
        await this.mintTokens({
          solanaToken: tokenAddress,
          amount: params.initialSupply,
          recipient: params.mintAuthority || this.solanaWallet.publicKey.toString(),
          reference: 'initial_supply',
        });
      }
      
      // Emit event
      this.emit('tokenCreated', {
        ethereumToken: params.ethereumToken,
        solanaToken: tokenAddress,
        name: params.name,
        symbol: params.symbol,
        decimals: params.decimals,
      });
      
      // Record metric
      if (this.metricsService) {
        this.metricsService.recordMetric('eth_token.created', 1, {
          name: params.name,
          symbol: params.symbol,
        });
      }
      
      return tokenAddress;
    } catch (error) {
      this.logger.error(`Error creating ETH token on Solana: ${error.message}`, error);
      throw new Error(`Failed to create ETH token: ${error.message}`);
    }
  }
  
  /**
   * Mint tokens to a recipient
   * 
   * @param params - Token minting parameters
   * @returns The transaction signature
   */
  public async mintTokens(params: MintTokensParams): Promise<string> {
    this.logger.info(`Minting ${params.amount} tokens of ${params.solanaToken} to ${params.recipient}`);
    
    try {
      // Get token info
      const tokenInfo = await this.getTokenInfo(params.solanaToken);
      
      // Create recipient associated token account if it doesn't exist
      const recipientPublicKey = new PublicKey(params.recipient);
      const associatedTokenAddress = await Token.getAssociatedTokenAddress(
        Token.ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        new PublicKey(params.solanaToken),
        recipientPublicKey
      );
      
      let transaction = new SolanaTransaction();
      
      // Check if associated token account exists
      const associatedTokenInfo = await this.solanaConnection.getAccountInfo(associatedTokenAddress);
      
      if (!associatedTokenInfo) {
        // Create associated token account
        transaction.add(
          Token.createAssociatedTokenAccountInstruction(
            Token.ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            new PublicKey(params.solanaToken),
            associatedTokenAddress,
            recipientPublicKey,
            this.solanaWallet.publicKey
          )
        );
      }
      
      // Add mint instruction
      transaction.add(
        Token.createMintToInstruction(
          TOKEN_PROGRAM_ID,
          new PublicKey(params.solanaToken),
          associatedTokenAddress,
          this.solanaWallet.publicKey,
          [],
          new u64(params.amount)
        )
      );
      
      // Sign and send transaction
      const signature = await this.solanaConnection.sendTransaction(
        transaction,
        [this.solanaWallet],
        { skipPreflight: false, preflightCommitment: 'confirmed' }
      );
      
      await this.solanaConnection.confirmTransaction(signature, 'confirmed');
      
      this.logger.info(`Minted ${params.amount} tokens of ${params.solanaToken} to ${params.recipient}: ${signature}`);
      
      // Emit event
      this.emit('tokensMinted', {
        solanaToken: params.solanaToken,
        amount: params.amount,
        recipient: params.recipient,
        transaction: signature,
        reference: params.reference,
      });
      
      // Record metric
      if (this.metricsService) {
        this.metricsService.recordMetric('eth_token.minted', Number(params.amount), {
          token: params.solanaToken,
        });
      }
      
      return signature;
    } catch (error) {
      this.logger.error(`Error minting tokens: ${error.message}`, error);
      throw new Error(`Failed to mint tokens: ${error.message}`);
    }
  }
  
  /**
   * Burn tokens from an owner
   * 
   * @param params - Token burning parameters
   * @returns The transaction signature
   */
  public async burnTokens(params: BurnTokensParams): Promise<string> {
    this.logger.info(`Burning ${params.amount} tokens of ${params.solanaToken} from ${params.owner}`);
    
    try {
      // Get token info
      const tokenInfo = await this.getTokenInfo(params.solanaToken);
      
      // Get owner associated token account
      const ownerPublicKey = new PublicKey(params.owner);
      const associatedTokenAddress = await Token.getAssociatedTokenAddress(
        Token.ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        new PublicKey(params.solanaToken),
        ownerPublicKey
      );
      
      // Create burn transaction
      const transaction = new SolanaTransaction().add(
        Token.createBurnInstruction(
          TOKEN_PROGRAM_ID,
          new PublicKey(params.solanaToken),
          associatedTokenAddress,
          ownerPublicKey,
          [],
          new u64(params.amount)
        )
      );
      
      // Sign and send transaction
      const signature = await this.solanaConnection.sendTransaction(
        transaction,
        [this.solanaWallet],
        { skipPreflight: false, preflightCommitment: 'confirmed' }
      );
      
      await this.solanaConnection.confirmTransaction(signature, 'confirmed');
      
      this.logger.info(`Burned ${params.amount} tokens of ${params.solanaToken} from ${params.owner}: ${signature}`);
      
      // Emit event
      this.emit('tokensBurned', {
        solanaToken: params.solanaToken,
        amount: params.amount,
        owner: params.owner,
        transaction: signature,
        reference: params.reference,
      });
      
      // Record metric
      if (this.metricsService) {
        this.metricsService.recordMetric('eth_token.burned', Number(params.amount), {
          token: params.solanaToken,
        });
      }
      
      return signature;
    } catch (error) {
      this.logger.error(`Error burning tokens: ${error.message}`, error);
      throw new Error(`Failed to burn tokens: ${error.message}`);
    }
  }
  
  /**
   * Map an Ethereum token to a Solana token
   * 
   * @param params - Token mapping parameters
   * @returns The token mapping ID
   */
  public async mapEthereumToken(params: MapTokenParams): Promise<number> {
    this.logger.info(`Mapping Ethereum token ${params.ethereumToken} to Solana token ${params.solanaToken}`);
    
    try {
      // Check if mapping already exists
      const existingMapping = await this.tokenMappingRepository.findOne({
        where: [
          { ethereumToken: params.ethereumToken },
          { solanaToken: params.solanaToken }
        ]
      });
      
      if (existingMapping) {
        this.logger.warn(`Token mapping already exists: ${existingMapping.id}`);
        
        // Update existing mapping
        existingMapping.name = params.name;
        existingMapping.symbol = params.symbol;
        existingMapping.decimals = params.decimals;
        existingMapping.depositsEnabled = params.depositsEnabled ?? existingMapping.depositsEnabled;
        existingMapping.withdrawalsEnabled = params.withdrawalsEnabled ?? existingMapping.withdrawalsEnabled;
        existingMapping.minAmount = params.minAmount ?? existingMapping.minAmount;
        existingMapping.maxAmount = params.maxAmount ?? existingMapping.maxAmount;
        existingMapping.metadata = { ...existingMapping.metadata, ...params.metadata };
        
        await this.tokenMappingRepository.save(existingMapping);
        
        // Update cache
        const ethereumCacheKey = `token_mapping_eth_${params.ethereumToken}`;
        const solanaCacheKey = `token_mapping_sol_${params.solanaToken}`;
        
        await this.cacheService.set(ethereumCacheKey, existingMapping, 3600); // 1 hour
        await this.cacheService.set(solanaCacheKey, existingMapping, 3600); // 1 hour
        
        return existingMapping.id;
      }
      
      // Create new mapping
      const tokenMapping = new TokenMapping();
      tokenMapping.ethereumToken = params.ethereumToken;
      tokenMapping.solanaToken = params.solanaToken;
      tokenMapping.name = params.name;
      tokenMapping.symbol = params.symbol;
      tokenMapping.decimals = params.decimals;
      tokenMapping.depositsEnabled = params.depositsEnabled ?? true;
      tokenMapping.withdrawalsEnabled = params.withdrawalsEnabled ?? true;
      tokenMapping.minAmount = params.minAmount || '0';
      tokenMapping.maxAmount = params.maxAmount || '0';
      tokenMapping.active = true;
      tokenMapping.metadata = params.metadata || {};
      
      const savedMapping = await this.tokenMappingRepository.save(tokenMapping);
      
      // Cache token mapping
      const ethereumCacheKey = `token_mapping_eth_${params.ethereumToken}`;
      const solanaCacheKey = `token_mapping_sol_${params.solanaToken}`;
      
      await this.cacheService.set(ethereumCacheKey, savedMapping, 3600); // 1 hour
      await this.cacheService.set(solanaCacheKey, savedMapping, 3600); // 1 hour
      
      this.logger.info(`Created token mapping: ${savedMapping.id}`);
      
      // Emit event
      this.emit('tokenMapped', {
        id: savedMapping.id,
        ethereumToken: params.ethereumToken,
        solanaToken: params.solanaToken,
        name: params.name,
        symbol: params.symbol,
        decimals: params.decimals,
      });
      
      // Record metric
      if (this.metricsService) {
        this.metricsService.recordMetric('eth_token.mapped', 1, {
          name: params.name,
          symbol: params.symbol,
        });
      }
      
      return savedMapping.id;
    } catch (error) {
      this.logger.error(`Error mapping Ethereum token: ${error.message}`, error);
      throw new Error(`Failed to map Ethereum token: ${error.message}`);
    }
  }
  
  /**
   * Get token info
   * 
   * @param tokenAddress - Token address
   * @returns Token info
   */
  public async getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
    this.logger.info(`Getting token info for ${tokenAddress}`);
    
    try {
      // Get token account info
      const accountInfo = await this.solanaConnection.getAccountInfo(new PublicKey(tokenAddress));
      
      if (!accountInfo) {
        throw new Error(`Token ${tokenAddress} not found`);
      }
      
      // Parse mint data
      const mintData = MintLayout.decode(accountInfo.data);
      
      // Get token mapping
      const tokenMapping = await this.tokenMappingRepository.findOne({
        where: { solanaToken: tokenAddress }
      });
      
      return {
        address: tokenAddress,
        name: tokenMapping?.name || '',
        symbol: tokenMapping?.symbol || '',
        decimals: mintData.decimals,
        totalSupply: mintData.supply.toString(),
        mintAuthority: mintData.mintAuthority ? new PublicKey(mintData.mintAuthority).toString() : null,
        freezeAuthority: mintData.freezeAuthority ? new PublicKey(mintData.freezeAuthority).toString() : null,
        isInitialized: mintData.isInitialized,
        ethereumToken: tokenMapping?.ethereumToken,
      };
    } catch (error) {
      this.logger.error(`Error getting token info: ${error.message}`, error);
      throw new Error(`Failed to get token info: ${error.message}`);
    }
  }
  
  /**
   * Get token mappings
   * 
   * @param active - Whether to get only active mappings
   * @returns List of token mappings
   */
  public async getTokenMappings(active: boolean = true): Promise<TokenMapping[]> {
    this.logger.info(`Getting token mappings (active=${active})`);
    
    try {
      return await this.tokenMappingRepository.find({
        where: active ? { active: true } : {}
      });
    } catch (error) {
      this.logger.error(`Error getting token mappings: ${error.message}`, error);
      throw new Error(`Failed to get token mappings: ${error.message}`);
    }
  }
  
  /**
   * Get token mapping by Ethereum token address
   * 
   * @param ethereumToken - Ethereum token address
   * @returns Token mapping or null if not found
   */
  public async getTokenMappingByEthereumToken(ethereumToken: string): Promise<TokenMapping | null> {
    this.logger.info(`Getting token mapping for Ethereum token ${ethereumToken}`);
    
    try {
      // Try to get from cache first
      const cacheKey = `token_mapping_eth_${ethereumToken}`;
      const cachedMapping = await this.cacheService.get<TokenMapping>(cacheKey);
      
      if (cachedMapping) {
        return cachedMapping;
      }
      
      // Get from database
      const mapping = await this.tokenMappingRepository.findOne({
        where: { ethereumToken }
      });
      
      if (mapping) {
        // Cache for future use
        await this.cacheService.set(cacheKey, mapping, 3600); // 1 hour
      }
      
      return mapping || null;
    } catch (error) {
      this.logger.error(`Error getting token mapping: ${error.message}`, error);
      return null;
    }
  }
  
  /**
   * Get token mapping by Solana token address
   * 
   * @param solanaToken - Solana token address
   * @returns Token mapping or null if not found
   */
  public async getTokenMappingBySolanaToken(solanaToken: string): Promise<TokenMapping | null> {
    this.logger.info(`Getting token mapping for Solana token ${solanaToken}`);
    
    try {
      // Try to get from cache first
      const cacheKey = `token_mapping_sol_${solanaToken}`;
      const cachedMapping = await this.cacheService.get<TokenMapping>(cacheKey);
      
      if (cachedMapping) {
        return cachedMapping;
      }
      
      // Get from database
      const mapping = await this.tokenMappingRepository.findOne({
        where: { solanaToken }
      });
      
      if (mapping) {
        // Cache for future use
        await this.cacheService.set(cacheKey, mapping, 3600); // 1 hour
      }
      
      return mapping || null;
    } catch (error) {
      this.logger.error(`Error getting token mapping: ${error.message}`, error);
      return null;
    }
  }
  
  /**
   * Update token mapping
   * 
   * @param id - Token mapping ID
   * @param updates - Updates to apply
   * @returns Updated token mapping
   */
  public async updateTokenMapping(id: number, updates: Partial<TokenMapping>): Promise<TokenMapping> {
    this.logger.info(`Updating token mapping ${id}`);
    
    try {
      // Get existing mapping
      const mapping = await this.tokenMappingRepository.findOne({
        where: { id }
      });
      
      if (!mapping) {
        throw new Error(`Token mapping ${id} not found`);
      }
      
      // Apply updates
      Object.assign(mapping, updates);
      
      // Save updates
      const updatedMapping = await this.tokenMappingRepository.save(mapping);
      
      // Update cache
      const ethereumCacheKey = `token_mapping_eth_${mapping.ethereumToken}`;
      const solanaCacheKey = `token_mapping_sol_${mapping.solanaToken}`;
      
      await this.cacheService.set(ethereumCacheKey, updatedMapping, 3600); // 1 hour
      await this.cacheService.set(solanaCacheKey, updatedMapping, 3600); // 1 hour
      
      this.logger.info(`Updated token mapping ${id}`);
      
      return updatedMapping;
    } catch (error) {
      this.logger.error(`Error updating token mapping: ${error.message}`, error);
      throw new Error(`Failed to update token mapping: ${error.message}`);
    }
  }
  
  /**
   * Get ETH token statistics
   * 
   * @returns ETH token statistics
   */
  public async getStatistics(): Promise<any> {
    this.logger.info('Getting ETH token statistics');
    
    try {
      // Get token mappings
      const tokenMappings = await this.getTokenMappings();
      
      // Get token info for each mapping
      const tokenInfoPromises = tokenMappings.map(mapping => this.getTokenInfo(mapping.solanaToken));
      const tokenInfos = await Promise.all(tokenInfoPromises);
      
      // Calculate total supply
      const totalSupply = tokenInfos.reduce((sum, info) => {
        return sum.add(ethers.BigNumber.from(info.totalSupply));
      }, ethers.BigNumber.from(0));
      
      return {
        tokenCount: tokenMappings.length,
        totalSupply: totalSupply.toString(),
        tokens: tokenInfos.map(info => ({
          address: info.address,
          name: info.name,
          symbol: info.symbol,
          decimals: info.decimals,
          totalSupply: info.totalSupply,
          ethereumToken: info.ethereumToken,
        })),
      };
    } catch (error) {
      this.logger.error(`Error getting ETH token statistics: ${error.message}`, error);
      throw new Error(`Failed to get ETH token statistics: ${error.message}`);
    }
  }
}
