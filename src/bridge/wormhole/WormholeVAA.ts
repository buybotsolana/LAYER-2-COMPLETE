// English comment for verification
/**
 * @file WormholeVAA.ts
 * @description Utilities for handling Wormhole Verifiable Action Approvals (VAAs)
 * @author Manus AI
 * @date April 27, 2025
 */

import {
  ChainId,
  parseVaa,
  SignedVaa,
  getSignedVAA,
  parseSequenceFromLogEth,
  parseSequenceFromLogSolana,
  getEmitterAddressEth,
  getEmitterAddressSolana,
  parseTokenTransferPayload,
  parseAttestMetaPayload,
  getIsTransferCompletedEth,
  getIsTransferCompletedSolana,
} from '@certusone/wormhole-sdk';
import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import { keccak256 } from 'ethers/lib/utils';
import { Logger } from '../../utils/Logger';
import { CacheService } from '../../utils/CacheService';
import { WormholeConfig } from './WormholeConfig';
import { WormholeGuardian } from './WormholeGuardian';

/**
 * Interface for VAA data
 */
export interface VAAData {
  // Core VAA fields
  version: number;
  guardianSetIndex: number;
  signatures: {
    guardianIndex: number;
    signature: Buffer;
  }[];
  timestamp: number;
  nonce: number;
  emitterChain: ChainId;
  emitterAddress: string;
  sequence: string;
  consistencyLevel: number;
  payload: Buffer;
  
  // Parsed fields
  hash: string;
  encodedVaa: string; // base64 encoded VAA
}

/**
 * Interface for token transfer data extracted from VAA
 */
export interface TokenTransferData {
  // Token transfer fields
  amount: string;
  tokenAddress: string;
  tokenChain: ChainId;
  recipient: string;
  recipientChain: ChainId;
  fee: string;
  fromAddress: string;
  // Additional fields for tracking
  vaaHash: string;
  sourceTransaction?: string;
  targetTransaction?: string;
  sourceTimestamp: number;
  targetTimestamp?: number;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
}

/**
 * WormholeVAA class - Utilities for handling Wormhole VAAs
 */
export class WormholeVAA {
  private readonly logger: Logger;
  private readonly config: WormholeConfig;
  private readonly cacheService: CacheService;
  private readonly guardianService: WormholeGuardian;
  private readonly ethereumProvider: ethers.providers.JsonRpcProvider;
  private readonly solanaConnection: Connection;
  
  /**
   * Constructor for the WormholeVAA
   * 
   * @param cacheService - Cache service for optimizing data access
   * @param guardianService - Guardian service for signature verification
   * @param logger - Logger instance
   * @param config - Configuration for Wormhole
   */
  constructor(
    cacheService: CacheService,
    guardianService: WormholeGuardian,
    logger: Logger,
    config: WormholeConfig
  ) {
    this.cacheService = cacheService;
    this.guardianService = guardianService;
    this.logger = logger.createChild('WormholeVAA');
    this.config = config;
    
    // Initialize blockchain connections
    this.ethereumProvider = new ethers.providers.JsonRpcProvider(this.config.ethereum.rpc);
    this.solanaConnection = new Connection(this.config.solana.rpc, 'confirmed');
    
    this.logger.info('WormholeVAA initialized');
  }
  
  /**
   * Parse a VAA buffer into structured data
   * 
   * @param vaaBuffer - The VAA buffer to parse
   * @returns Parsed VAA data
   */
  public parseVAA(vaaBuffer: Buffer): VAAData {
    this.logger.debug('Parsing VAA');
    
    try {
      // Parse VAA using Wormhole SDK
      const parsedVaa = parseVaa(vaaBuffer);
      
      // Create hash of VAA for identification
      const hash = this.createVAAHash(parsedVaa);
      
      // Create structured VAA data
      const vaaData: VAAData = {
        version: parsedVaa.version,
        guardianSetIndex: parsedVaa.guardianSetIndex,
        signatures: parsedVaa.signatures.map(sig => ({
          guardianIndex: sig.guardianIndex,
          signature: sig.signature,
        })),
        timestamp: parsedVaa.timestamp,
        nonce: parsedVaa.nonce,
        emitterChain: parsedVaa.emitterChain,
        emitterAddress: Buffer.from(parsedVaa.emitterAddress).toString('hex'),
        sequence: parsedVaa.sequence.toString(),
        consistencyLevel: parsedVaa.consistencyLevel,
        payload: parsedVaa.payload,
        hash,
        encodedVaa: vaaBuffer.toString('base64'),
      };
      
      this.logger.debug(`VAA parsed successfully, hash: ${hash}`);
      return vaaData;
    } catch (error) {
      this.logger.error('Error parsing VAA', error);
      throw new Error(`Failed to parse VAA: ${error.message}`);
    }
  }
  
  /**
   * Create a hash for a VAA for identification
   * 
   * @param vaa - The parsed VAA
   * @returns Hash string
   */
  private createVAAHash(vaa: SignedVaa): string {
    // Create a hash using emitter chain, address, and sequence
    const emitterAddressHex = Buffer.from(vaa.emitterAddress).toString('hex');
    const sequenceStr = vaa.sequence.toString();
    
    // Use keccak256 for consistent hashing
    const hashData = ethers.utils.defaultAbiCoder.encode(
      ['uint16', 'bytes32', 'uint64'],
      [vaa.emitterChain, `0x${emitterAddressHex}`, vaa.sequence]
    );
    
    return keccak256(hashData);
  }
  
  /**
   * Fetch a signed VAA from Wormhole
   * 
   * @param chainId - The source chain ID
   * @param emitterAddress - The emitter address
   * @param sequence - The sequence number
   * @param retries - Number of retries (optional)
   * @returns The signed VAA buffer
   */
  public async fetchSignedVAA(
    chainId: ChainId,
    emitterAddress: string,
    sequence: string,
    retries: number = this.config.relayer.maxRetries
  ): Promise<Buffer> {
    this.logger.info(`Fetching signed VAA for chain ${chainId}, emitter ${emitterAddress}, sequence ${sequence}`);
    
    // Try to get from cache first
    const cacheKey = `vaa-${chainId}-${emitterAddress}-${sequence}`;
    const cachedVAA = await this.cacheService.get(cacheKey);
    
    if (cachedVAA) {
      this.logger.info(`Using cached VAA for ${cacheKey}`);
      return Buffer.from(cachedVAA as string, 'base64');
    }
    
    // Retry logic for getting VAA
    let currentRetry = 0;
    let vaa: Uint8Array | null = null;
    
    while (currentRetry < retries && !vaa) {
      try {
        vaa = await getSignedVAA(
          this.config.wormhole.rpc,
          chainId,
          emitterAddress,
          sequence
        );
        
        this.logger.info(`Got signed VAA for ${cacheKey}`);
      } catch (error) {
        currentRetry++;
        
        if (currentRetry >= retries) {
          this.logger.error(`Failed to get signed VAA after ${currentRetry} retries`, error);
          throw new Error(`Failed to get signed VAA: ${error.message}`);
        }
        
        this.logger.warn(`Failed to get signed VAA, retrying (${currentRetry}/${retries})`, error);
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, this.config.relayer.retryDelay));
      }
    }
    
    if (!vaa) {
      throw new Error(`Failed to get signed VAA for chain ${chainId}, emitter ${emitterAddress}, sequence ${sequence}`);
    }
    
    const vaaBuffer = Buffer.from(vaa);
    
    // Cache the VAA
    await this.cacheService.set(
      cacheKey,
      vaaBuffer.toString('base64'),
      60 * 60 // 1 hour
    );
    
    return vaaBuffer;
  }
  
  /**
   * Fetch a signed VAA from Wormhole using transaction hash
   * 
   * @param chainId - The source chain ID
   * @param txHash - The transaction hash
   * @param retries - Number of retries (optional)
   * @returns The signed VAA buffer
   */
  public async fetchSignedVAAByTx(
    chainId: ChainId,
    txHash: string,
    retries: number = this.config.relayer.maxRetries
  ): Promise<Buffer> {
    this.logger.info(`Fetching signed VAA for chain ${chainId}, tx ${txHash}`);
    
    // Try to get from cache first
    const cacheKey = `vaa-tx-${chainId}-${txHash}`;
    const cachedVAA = await this.cacheService.get(cacheKey);
    
    if (cachedVAA) {
      this.logger.info(`Using cached VAA for ${cacheKey}`);
      return Buffer.from(cachedVAA as string, 'base64');
    }
    
    let sequence: string;
    let emitterAddress: string;
    
    // Get sequence and emitter address based on chain
    if (chainId === CHAIN_ID_ETH) {
      // Get transaction receipt from Ethereum
      const receipt = await this.ethereumProvider.getTransactionReceipt(txHash);
      if (!receipt) {
        throw new Error(`Transaction ${txHash} not found on Ethereum`);
      }
      
      // Parse sequence from logs
      sequence = parseSequenceFromLogEth(receipt, this.config.ethereum.tokenBridgeAddress);
      
      // Get emitter address (token bridge)
      emitterAddress = getEmitterAddressEth(this.config.ethereum.tokenBridgeAddress);
    } else if (chainId === CHAIN_ID_SOLANA) {
      // Get transaction from Solana
      const tx = await this.solanaConnection.getTransaction(txHash, {
        commitment: 'confirmed',
      });
      
      if (!tx) {
        throw new Error(`Transaction ${txHash} not found on Solana`);
      }
      
      // Parse sequence from logs
      sequence = parseSequenceFromLogSolana(tx);
      
      // Get emitter address (token bridge)
      emitterAddress = await getEmitterAddressSolana(new PublicKey(this.config.solana.tokenBridgeAddress));
    } else {
      throw new Error(`Chain ${chainId} not supported for fetching VAA by transaction hash`);
    }
    
    // Fetch VAA using sequence and emitter address
    const vaaBuffer = await this.fetchSignedVAA(chainId, emitterAddress, sequence, retries);
    
    // Cache the VAA with transaction hash
    await this.cacheService.set(
      cacheKey,
      vaaBuffer.toString('base64'),
      60 * 60 // 1 hour
    );
    
    return vaaBuffer;
  }
  
  /**
   * Verify a VAA's signatures
   * 
   * @param vaaData - The VAA data to verify
   * @returns Whether the VAA is valid
   */
  public async verifyVAA(vaaData: VAAData): Promise<boolean> {
    this.logger.debug(`Verifying VAA signatures for VAA ${vaaData.hash}`);
    
    try {
      // Get the guardian set for the VAA's guardian set index
      const guardianSet = await this.guardianService.getGuardianSet(vaaData.guardianSetIndex);
      
      if (!guardianSet) {
        this.logger.error(`Guardian set ${vaaData.guardianSetIndex} not found`);
        return false;
      }
      
      // Check if we have enough signatures (2/3 of guardian set)
      const requiredSignatures = Math.ceil((guardianSet.keys.length * 2) / 3);
      if (vaaData.signatures.length < requiredSignatures) {
        this.logger.error(`VAA ${vaaData.hash} has insufficient signatures: ${vaaData.signatures.length}/${requiredSignatures}`);
        return false;
      }
      
      // Reconstruct the VAA body hash that was signed
      const body = Buffer.concat([
        Buffer.from([vaaData.version]),
        Buffer.from([vaaData.guardianSetIndex]),
        Buffer.from(new Uint8Array(4).buffer), // timestamp (uint32)
        Buffer.from(new Uint8Array(4).buffer), // nonce (uint32)
        Buffer.from(new Uint8Array(2).buffer), // emitterChain (uint16)
        Buffer.from(new Uint8Array(32).buffer), // emitterAddress (bytes32)
        Buffer.from(new Uint8Array(8).buffer), // sequence (uint64)
        Buffer.from(new Uint8Array(1).buffer), // consistencyLevel (uint8)
        vaaData.payload,
      ]);
      
      const bodyHash = ethers.utils.keccak256(body);
      
      // Verify each signature
      for (const sig of vaaData.signatures) {
        // Check if guardian index is valid
        if (sig.guardianIndex >= guardianSet.keys.length) {
          this.logger.error(`VAA ${vaaData.hash} has invalid guardian index: ${sig.guardianIndex}`);
          return false;
        }
        
        // Get guardian public key
        const guardianPublicKey = guardianSet.keys[sig.guardianIndex];
        
        // Verify signature
        const signerAddress = ethers.utils.recoverAddress(bodyHash, {
          r: `0x${sig.signature.slice(0, 32).toString('hex')}`,
          s: `0x${sig.signature.slice(32, 64).toString('hex')}`,
          v: sig.signature[64] + 27,
        });
        
        // Check if recovered address matches guardian public key
        if (signerAddress.toLowerCase() !== guardianPublicKey.toLowerCase()) {
          this.logger.error(`VAA ${vaaData.hash} has invalid signature from guardian ${sig.guardianIndex}`);
          return false;
        }
      }
      
      this.logger.info(`VAA ${vaaData.hash} signatures verified successfully`);
      return true;
    } catch (error) {
      this.logger.error(`Error verifying VAA ${vaaData.hash}`, error);
      return false;
    }
  }
  
  /**
   * Extract token transfer details from a VAA
   * 
   * @param vaaData - The VAA data
   * @returns Token transfer details if it's a token transfer VAA, null otherwise
   */
  public extractTokenTransfer(vaaData: VAAData): TokenTransferData | null {
    this.logger.debug(`Extracting token transfer details from VAA ${vaaData.hash}`);
    
    try {
      // Check if this is a token bridge VAA by checking emitter address
      // This would require comparing against known token bridge addresses
      
      // Parse the payload as a token transfer
      const transfer = parseTokenTransferPayload(vaaData.payload);
      
      if (!transfer) {
        this.logger.debug(`VAA ${vaaData.hash} is not a token transfer VAA`);
        return null;
      }
      
      // Create token transfer data
      const tokenTransferData: TokenTransferData = {
        amount: transfer.amount.toString(),
        tokenAddress: Buffer.from(transfer.tokenAddress).toString('hex'),
        tokenChain: transfer.tokenChain,
        recipient: Buffer.from(transfer.to).toString('hex'),
        recipientChain: transfer.toChain,
        fee: transfer.fee.toString(),
        fromAddress: Buffer.from(transfer.fromAddress).toString('hex'),
        vaaHash: vaaData.hash,
        sourceTimestamp: vaaData.timestamp,
        status: 'PENDING',
      };
      
      this.logger.info(`Extracted token transfer from VAA ${vaaData.hash}: ${tokenTransferData.amount} from chain ${tokenTransferData.tokenChain} to chain ${tokenTransferData.recipientChain}`);
      return tokenTransferData;
    } catch (error) {
      this.logger.error(`Error extracting token transfer from VAA ${vaaData.hash}`, error);
      return null;
    }
  }
  
  /**
   * Check if a VAA has been redeemed
   * 
   * @param vaaData - The VAA data
   * @param targetChain - The target chain ID
   * @returns Whether the VAA has been redeemed
   */
  public async isVAARedeemed(vaaData: VAAData, targetChain: ChainId): Promise<boolean> {
    this.logger.debug(`Checking if VAA ${vaaData.hash} has been redeemed on chain ${targetChain}`);
    
    try {
      // Extract token transfer data to determine if this is a token transfer VAA
      const tokenTransfer = this.extractTokenTransfer(vaaData);
      
      if (!tokenTransfer) {
        this.logger.debug(`VAA ${vaaData.hash} is not a token transfer VAA`);
        return false;
      }
      
      // Check if the VAA has been redeemed based on target chain
      if (targetChain === CHAIN_ID_ETH) {
        // Check if transfer is completed on Ethereum
        const isCompleted = await getIsTransferCompletedEth(
          this.ethereumProvider,
          this.config.ethereum.tokenBridgeAddress,
          Buffer.from(vaaData.encodedVaa, 'base64')
        );
        
        this.logger.info(`VAA ${vaaData.hash} redemption status on Ethereum: ${isCompleted}`);
        return isCompleted;
      } else if (targetChain === CHAIN_ID_SOLANA) {
        // Check if transfer is completed on Solana
        const isCompleted = await getIsTransferCompletedSolana(
          this.solanaConnection,
          this.config.solana.tokenBridgeAddress,
          Buffer.from(vaaData.encodedVaa, 'base64')
        );
        
        this.logger.info(`VAA ${vaaData.hash} redemption status on Solana: ${isCompleted}`);
        return isCompleted;
      } else {
        this.logger.error(`Unsupported target chain ${targetChain} for checking VAA redemption`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Error checking if VAA ${vaaData.hash} has been redeemed`, error);
      throw new Error(`Failed to check VAA redemption: ${error.message}`);
    }
  }
  
  /**
   * Get the token address on the target chain for a token transfer
   * 
   * @param tokenTransfer - The token transfer data
   * @param targetChain - The target chain ID
   * @returns The token address on the target chain
   */
  public async getTargetTokenAddress(tokenTransfer: TokenTransferData, targetChain: ChainId): Promise<string> {
    this.logger.debug(`Getting target token address for transfer ${tokenTransfer.vaaHash} on chain ${targetChain}`);
    
    try {
      // This would require querying the token bridge on the target chain
      // to get the corresponding token address
      
      // For now, return a placeholder
      return "0x0000000000000000000000000000000000000000";
    } catch (error) {
      this.logger.error(`Error getting target token address for transfer ${tokenTransfer.vaaHash}`, error);
      throw new Error(`Failed to get target token address: ${error.message}`);
    }
  }
}
