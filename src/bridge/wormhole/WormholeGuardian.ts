// English comment for verification
/**
 * @file WormholeGuardian.ts
 * @description Implementation of guardian interactions for Wormhole integration
 * @author Manus AI
 * @date April 27, 2025
 */

import { ChainId } from '@certusone/wormhole-sdk';
import { Logger } from '../../utils/Logger';
import { MetricsService } from '../../monitoring/MetricsService';
import { CacheService } from '../../utils/CacheService';
import { WormholeConfig } from './WormholeConfig';
import { ethers } from 'ethers';
import axios from 'axios';

/**
 * Interface for Guardian information
 */
export interface Guardian {
  index: number;
  key: string;
  name?: string;
}

/**
 * Interface for Guardian Set
 */
export interface GuardianSet {
  index: number;
  keys: string[];
  expirationTime: number;
  guardians: Guardian[];
}

/**
 * WormholeGuardian class - Handles interactions with Wormhole guardians
 */
export class WormholeGuardian {
  private readonly logger: Logger;
  private readonly config: WormholeConfig;
  private readonly metricsService: MetricsService;
  private readonly cacheService: CacheService;
  
  // Guardian sets
  private guardianSets: Map<number, GuardianSet> = new Map();
  private currentGuardianSetIndex: number;
  
  /**
   * Constructor for the WormholeGuardian
   * 
   * @param metricsService - Metrics service for monitoring performance
   * @param cacheService - Cache service for optimizing data access
   * @param logger - Logger instance
   * @param config - Configuration for Wormhole
   */
  constructor(
    metricsService: MetricsService,
    cacheService: CacheService,
    logger: Logger,
    config: WormholeConfig
  ) {
    this.metricsService = metricsService;
    this.cacheService = cacheService;
    this.logger = logger.createChild('WormholeGuardian');
    this.config = config;
    this.currentGuardianSetIndex = this.config.wormhole.guardianSetIndex;
    
    this.logger.info('WormholeGuardian initialized');
  }
  
  /**
   * Initialize the guardian service
   */
  public async initialize(): Promise<void> {
    this.logger.info('Initializing WormholeGuardian');
    
    try {
      // Load guardian sets
      await this.loadGuardianSets();
      
      this.logger.info('WormholeGuardian initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize WormholeGuardian', error);
      throw error;
    }
  }
  
  /**
   * Load guardian sets from cache or network
   */
  private async loadGuardianSets(): Promise<void> {
    this.logger.info('Loading guardian sets');
    
    try {
      // Try to get from cache first
      const cachedGuardianSets = await this.cacheService.get('guardian_sets');
      
      if (cachedGuardianSets) {
        this.logger.info('Using cached guardian sets');
        this.guardianSets = new Map(Object.entries(cachedGuardianSets).map(([key, value]) => [parseInt(key), value as GuardianSet]));
        return;
      }
      
      // Fetch current guardian set
      await this.fetchGuardianSet(this.currentGuardianSetIndex);
      
      this.logger.info(`Loaded ${this.guardianSets.size} guardian sets`);
      
      // Cache guardian sets
      await this.cacheService.set(
        'guardian_sets',
        Object.fromEntries(this.guardianSets),
        24 * 60 * 60 // 24 hours
      );
    } catch (error) {
      this.logger.error('Failed to load guardian sets', error);
      throw error;
    }
  }
  
  /**
   * Fetch a guardian set from the network
   * 
   * @param index - The guardian set index
   * @returns The guardian set
   */
  private async fetchGuardianSet(index: number): Promise<GuardianSet> {
    this.logger.info(`Fetching guardian set ${index}`);
    
    try {
      // Check if already loaded
      if (this.guardianSets.has(index)) {
        return this.guardianSets.get(index)!;
      }
      
      // Fetch guardian set from Wormhole API
      const response = await axios.get(`${this.config.wormhole.rpc}/v1/guardianset/${index}`);
      
      if (response.status !== 200) {
        throw new Error(`Failed to fetch guardian set ${index}: ${response.statusText}`);
      }
      
      const data = response.data;
      
      // Create guardian set
      const guardianSet: GuardianSet = {
        index,
        keys: data.guardianSet.keys,
        expirationTime: data.expirationTime || 0,
        guardians: data.guardianSet.keys.map((key: string, i: number) => ({
          index: i,
          key,
        })),
      };
      
      // Store guardian set
      this.guardianSets.set(index, guardianSet);
      
      this.logger.info(`Fetched guardian set ${index} with ${guardianSet.keys.length} guardians`);
      
      return guardianSet;
    } catch (error) {
      this.logger.error(`Failed to fetch guardian set ${index}`, error);
      throw error;
    }
  }
  
  /**
   * Get a guardian set
   * 
   * @param index - The guardian set index
   * @returns The guardian set
   */
  public async getGuardianSet(index: number = this.currentGuardianSetIndex): Promise<GuardianSet> {
    // Check if already loaded
    if (this.guardianSets.has(index)) {
      return this.guardianSets.get(index)!;
    }
    
    // Fetch guardian set
    return this.fetchGuardianSet(index);
  }
  
  /**
   * Get the current guardian set
   * 
   * @returns The current guardian set
   */
  public async getCurrentGuardianSet(): Promise<GuardianSet> {
    return this.getGuardianSet(this.currentGuardianSetIndex);
  }
  
  /**
   * Check if a guardian set is expired
   * 
   * @param index - The guardian set index
   * @returns Whether the guardian set is expired
   */
  public async isGuardianSetExpired(index: number): Promise<boolean> {
    const guardianSet = await this.getGuardianSet(index);
    
    if (!guardianSet.expirationTime) {
      return false;
    }
    
    return guardianSet.expirationTime < Date.now() / 1000;
  }
  
  /**
   * Get guardian set status
   * 
   * @returns Status of guardian sets
   */
  public async getStatus(): Promise<any> {
    const currentSet = await this.getCurrentGuardianSet();
    const isExpired = await this.isGuardianSetExpired(this.currentGuardianSetIndex);
    
    return {
      currentGuardianSetIndex: this.currentGuardianSetIndex,
      guardianSets: this.guardianSets.size,
      currentGuardianCount: currentSet.guardians.length,
      isCurrentSetExpired: isExpired,
    };
  }
  
  /**
   * Verify signatures against a guardian set
   * 
   * @param signatures - The signatures to verify
   * @param message - The message that was signed
   * @param guardianSetIndex - The guardian set index
   * @returns Whether the signatures are valid
   */
  public async verifySignatures(
    signatures: { guardianIndex: number; signature: Buffer }[],
    message: Buffer,
    guardianSetIndex: number = this.currentGuardianSetIndex
  ): Promise<boolean> {
    this.logger.debug(`Verifying ${signatures.length} signatures against guardian set ${guardianSetIndex}`);
    
    try {
      // Get guardian set
      const guardianSet = await this.getGuardianSet(guardianSetIndex);
      
      // Check if we have enough signatures (2/3 of guardian set)
      const requiredSignatures = Math.floor((guardianSet.guardians.length * 2) / 3) + 1;
      
      if (signatures.length < requiredSignatures) {
        this.logger.warn(`Not enough signatures: ${signatures.length} < ${requiredSignatures}`);
        return false;
      }
      
      // Calculate the message hash that was signed
      const messageHash = ethers.utils.keccak256(message);
      
      // Track valid signatures
      let validSignatures = 0;
      const usedGuardianIndices = new Set<number>();
      
      // Verify each signature
      for (const sig of signatures) {
        // Check if guardian index is valid
        if (sig.guardianIndex >= guardianSet.keys.length) {
          this.logger.warn(`Invalid guardian index: ${sig.guardianIndex} >= ${guardianSet.keys.length}`);
          continue;
        }
        
        // Check if this guardian has already signed
        if (usedGuardianIndices.has(sig.guardianIndex)) {
          this.logger.warn(`Duplicate signature from guardian ${sig.guardianIndex}`);
          continue;
        }
        
        // Get guardian public key
        const guardianPublicKey = guardianSet.keys[sig.guardianIndex];
        
        try {
          // Recover the signer address from the signature
          const signerAddress = ethers.utils.recoverAddress(messageHash, {
            r: `0x${sig.signature.slice(0, 32).toString('hex')}`,
            s: `0x${sig.signature.slice(32, 64).toString('hex')}`,
            v: sig.signature[64] + 27,
          });
          
          // Check if the recovered address matches the guardian's key
          if (signerAddress.toLowerCase() === guardianPublicKey.toLowerCase()) {
            validSignatures++;
            usedGuardianIndices.add(sig.guardianIndex);
            this.logger.debug(`Valid signature from guardian ${sig.guardianIndex}`);
          } else {
            this.logger.warn(`Invalid signature from guardian ${sig.guardianIndex}: ${signerAddress} != ${guardianPublicKey}`);
          }
        } catch (error) {
          this.logger.warn(`Error recovering address from signature: ${error.message}`);
        }
      }
      
      // Check if we have enough valid signatures
      const isValid = validSignatures >= requiredSignatures;
      
      this.logger.info(`Signature verification result: ${isValid} (${validSignatures}/${requiredSignatures} valid signatures)`);
      
      // Record metrics
      this.metricsService.recordMetric('wormhole.signature_verification', {
        valid: isValid,
        validSignatures,
        requiredSignatures,
        totalSignatures: signatures.length,
        guardianSetIndex,
      });
      
      return isValid;
    } catch (error) {
      this.logger.error('Error verifying signatures', error);
      
      // Record error metric
      this.metricsService.recordMetric('wormhole.signature_verification_errors', 1);
      
      return false;
    }
  }
  
  /**
   * Get the quorum size for a guardian set
   * 
   * @param guardianSetIndex - The guardian set index
   * @returns The quorum size (2/3 of guardian set size)
   */
  public async getQuorumSize(guardianSetIndex: number = this.currentGuardianSetIndex): Promise<number> {
    const guardianSet = await this.getGuardianSet(guardianSetIndex);
    return Math.floor((guardianSet.guardians.length * 2) / 3) + 1;
  }
  
  /**
   * Check if a guardian is in the current set
   * 
   * @param guardianKey - The guardian's public key
   * @returns Whether the guardian is in the current set
   */
  public async isGuardianInCurrentSet(guardianKey: string): Promise<boolean> {
    const guardianSet = await this.getCurrentGuardianSet();
    return guardianSet.keys.some(key => key.toLowerCase() === guardianKey.toLowerCase());
  }
}
