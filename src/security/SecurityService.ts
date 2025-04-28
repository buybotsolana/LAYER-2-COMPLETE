// English comment for verification
/**
 * @file SecurityService.ts
 * @description Service for implementing security measures in the Wormhole Relayer system
 * @author Manus AI
 * @date April 27, 2025
 */

import { EthereumConnector } from '../relayer/EthereumConnector';
import { SolanaConnector } from '../relayer/SolanaConnector';
import { RelayerDatabaseService } from '../relayer/RelayerDatabase';
import { Logger } from '../utils/Logger';
import { MetricsService } from './MetricsService';
import { AlertService } from './AlertService';
import { CacheService } from '../utils/CacheService';
import { ChainType, MessageStatus } from '../relayer/RelayerTypes';
import * as crypto from 'crypto';
import { ethers } from 'ethers';
import * as nacl from 'tweetnacl';
import * as bs58 from 'bs58';

/**
 * Interface for security configuration
 */
interface SecurityConfig {
  // General security settings
  enableSignatureVerification: boolean;
  enableRateLimiting: boolean;
  enableDDoSProtection: boolean;
  enableTransactionValidation: boolean;
  enableHSMSupport: boolean;
  
  // Rate limiting settings
  rateLimits: {
    maxRequestsPerMinute: number;
    maxMessagesPerAddress: number;
    maxConcurrentRequests: number;
  };
  
  // Signature verification settings
  signatureVerification: {
    requiredConfirmations: {
      [ChainType.ETHEREUM]: number;
      [ChainType.SOLANA]: number;
    };
    trustedGuardians: string[];
  };
  
  // Transaction validation settings
  transactionValidation: {
    maxGasPrice: string;
    maxTransactionSize: number;
    blockedAddresses: string[];
  };
  
  // HSM settings
  hsm: {
    enabled: boolean;
    module: string;
    keyIds: {
      ethereum: string;
      solana: string;
    };
    retryAttempts: number;
  };
  
  // Firewall settings
  firewall: {
    enabled: boolean;
    allowedIPs: string[];
    blockedIPs: string[];
    maxConnectionsPerIP: number;
  };
}

/**
 * Interface for a rate limiter entry
 */
interface RateLimiterEntry {
  count: number;
  lastReset: Date;
  blocked: boolean;
  blockExpiration?: Date;
}

/**
 * SecurityService class
 * 
 * Provides comprehensive security measures for the Wormhole Relayer system,
 * including signature verification, rate limiting, transaction validation,
 * and HSM support.
 */
export class SecurityService {
  private readonly logger: Logger;
  private readonly db: RelayerDatabaseService;
  private readonly ethereum: EthereumConnector;
  private readonly solana: SolanaConnector;
  private readonly metrics: MetricsService;
  private readonly alerts: AlertService;
  private readonly cache: CacheService;
  private readonly config: SecurityConfig;
  private isRunning: boolean = false;
  
  // Rate limiting state
  private rateLimiters: {
    [key: string]: RateLimiterEntry;
  } = {};
  
  // HSM connection
  private hsmConnection: any = null;
  
  /**
   * Creates a new instance of the SecurityService
   * 
   * @param db The database service
   * @param ethereum The Ethereum connector
   * @param solana The Solana connector
   * @param metrics The metrics service
   * @param alerts The alert service
   * @param cache The cache service
   * @param logger The logger
   * @param config The security configuration
   */
  constructor(
    db: RelayerDatabaseService,
    ethereum: EthereumConnector,
    solana: SolanaConnector,
    metrics: MetricsService,
    alerts: AlertService,
    cache: CacheService,
    logger: Logger,
    config?: Partial<SecurityConfig>
  ) {
    this.db = db;
    this.ethereum = ethereum;
    this.solana = solana;
    this.metrics = metrics;
    this.alerts = alerts;
    this.cache = cache;
    this.logger = logger.createChild('SecurityService');
    
    // Default configuration
    const defaultConfig: SecurityConfig = {
      enableSignatureVerification: true,
      enableRateLimiting: true,
      enableDDoSProtection: true,
      enableTransactionValidation: true,
      enableHSMSupport: false,
      
      rateLimits: {
        maxRequestsPerMinute: 100,
        maxMessagesPerAddress: 50,
        maxConcurrentRequests: 20
      },
      
      signatureVerification: {
        requiredConfirmations: {
          [ChainType.ETHEREUM]: 12,
          [ChainType.SOLANA]: 32
        },
        trustedGuardians: []
      },
      
      transactionValidation: {
        maxGasPrice: '500000000000', // 500 gwei
        maxTransactionSize: 100000, // bytes
        blockedAddresses: []
      },
      
      hsm: {
        enabled: false,
        module: 'pkcs11',
        keyIds: {
          ethereum: 'eth_key_1',
          solana: 'sol_key_1'
        },
        retryAttempts: 3
      },
      
      firewall: {
        enabled: true,
        allowedIPs: [],
        blockedIPs: [],
        maxConnectionsPerIP: 50
      }
    };
    
    // Merge provided config with defaults
    this.config = {
      ...defaultConfig,
      ...config,
      rateLimits: {
        ...defaultConfig.rateLimits,
        ...(config?.rateLimits || {})
      },
      signatureVerification: {
        ...defaultConfig.signatureVerification,
        ...(config?.signatureVerification || {})
      },
      transactionValidation: {
        ...defaultConfig.transactionValidation,
        ...(config?.transactionValidation || {})
      },
      hsm: {
        ...defaultConfig.hsm,
        ...(config?.hsm || {})
      },
      firewall: {
        ...defaultConfig.firewall,
        ...(config?.firewall || {})
      }
    };
  }
  
  /**
   * Starts the security service
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Security service is already running');
      return;
    }
    
    this.isRunning = true;
    this.logger.info('Starting security service');
    
    try {
      // Initialize HSM if enabled
      if (this.config.enableHSMSupport && this.config.hsm.enabled) {
        await this.initializeHSM();
      }
      
      // Load blocked addresses from database
      await this.loadBlockedAddresses();
      
      // Initialize rate limiters
      this.initializeRateLimiters();
      
      this.logger.info('Security service started successfully');
      this.metrics.recordMetric('security_service.started', 1);
    } catch (error) {
      this.isRunning = false;
      this.logger.error('Failed to start security service', error);
      this.metrics.recordMetric('security_service.start_failed', 1);
      throw error;
    }
  }
  
  /**
   * Stops the security service
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('Security service is not running');
      return;
    }
    
    this.isRunning = false;
    this.logger.info('Stopping security service');
    
    try {
      // Close HSM connection if open
      if (this.hsmConnection) {
        await this.closeHSM();
      }
      
      this.logger.info('Security service stopped successfully');
      this.metrics.recordMetric('security_service.stopped', 1);
    } catch (error) {
      this.logger.error('Error stopping security service', error);
      this.metrics.recordMetric('security_service.stop_failed', 1);
      throw error;
    }
  }
  
  /**
   * Initializes the HSM connection
   */
  private async initializeHSM(): Promise<void> {
    this.logger.info('Initializing HSM connection');
    
    try {
      // In a real implementation, you would initialize the HSM connection here
      // For this example, we'll simulate it
      
      // Simulate HSM connection
      this.hsmConnection = {
        isConnected: true,
        sign: async (keyId: string, data: Buffer): Promise<Buffer> => {
          // Simulate signing with HSM
          // In a real implementation, this would use the HSM to sign the data
          const privateKey = crypto.randomBytes(32);
          const signer = new ethers.utils.SigningKey(privateKey);
          const signature = signer.signDigest(ethers.utils.keccak256(data));
          return Buffer.concat([
            Buffer.from(signature.r.slice(2), 'hex'),
            Buffer.from(signature.s.slice(2), 'hex'),
            Buffer.from([signature.v])
          ]);
        }
      };
      
      this.logger.info('HSM connection initialized successfully');
      this.metrics.recordMetric('security_service.hsm_initialized', 1);
    } catch (error) {
      this.logger.error('Failed to initialize HSM connection', error);
      this.metrics.recordMetric('security_service.hsm_initialization_failed', 1);
      throw error;
    }
  }
  
  /**
   * Closes the HSM connection
   */
  private async closeHSM(): Promise<void> {
    this.logger.info('Closing HSM connection');
    
    try {
      // In a real implementation, you would close the HSM connection here
      // For this example, we'll simulate it
      
      this.hsmConnection = null;
      
      this.logger.info('HSM connection closed successfully');
      this.metrics.recordMetric('security_service.hsm_closed', 1);
    } catch (error) {
      this.logger.error('Failed to close HSM connection', error);
      this.metrics.recordMetric('security_service.hsm_close_failed', 1);
      throw error;
    }
  }
  
  /**
   * Loads blocked addresses from the database
   */
  private async loadBlockedAddresses(): Promise<void> {
    this.logger.info('Loading blocked addresses from database');
    
    try {
      // In a real implementation, you would load blocked addresses from the database
      // For this example, we'll simulate it
      
      // Simulate loading blocked addresses
      const blockedAddresses = [
        '0x1234567890123456789012345678901234567890',
        '0x0987654321098765432109876543210987654321'
      ];
      
      // Add to config
      this.config.transactionValidation.blockedAddresses = [
        ...this.config.transactionValidation.blockedAddresses,
        ...blockedAddresses
      ];
      
      this.logger.info(`Loaded ${blockedAddresses.length} blocked addresses`);
    } catch (error) {
      this.logger.error('Failed to load blocked addresses', error);
      this.metrics.recordMetric('security_service.load_blocked_addresses_failed', 1);
      throw error;
    }
  }
  
  /**
   * Initializes rate limiters
   */
  private initializeRateLimiters(): void {
    this.logger.info('Initializing rate limiters');
    
    // Clear existing rate limiters
    this.rateLimiters = {};
    
    this.logger.info('Rate limiters initialized');
  }
  
  /**
   * Verifies a signature
   * 
   * @param message The message to verify
   * @param signature The signature to verify
   * @param publicKey The public key to verify against
   * @param chainType The chain type
   * @returns Whether the signature is valid
   */
  public async verifySignature(
    message: Buffer,
    signature: Buffer,
    publicKey: string,
    chainType: ChainType
  ): Promise<boolean> {
    if (!this.config.enableSignatureVerification) {
      return true;
    }
    
    this.logger.debug(`Verifying signature for message from ${chainType}`);
    
    try {
      // Check if we've already verified this signature
      const cacheKey = `signature:${message.toString('hex')}:${signature.toString('hex')}:${publicKey}`;
      const cachedResult = await this.cache.get(cacheKey);
      if (cachedResult === 'true') {
        this.logger.debug('Signature verification cached result: valid');
        return true;
      } else if (cachedResult === 'false') {
        this.logger.debug('Signature verification cached result: invalid');
        return false;
      }
      
      let isValid = false;
      
      // Verify based on chain type
      if (chainType === ChainType.ETHEREUM) {
        // Verify Ethereum signature
        try {
          const msgHash = ethers.utils.keccak256(message);
          const msgHashBytes = ethers.utils.arrayify(msgHash);
          const recoveredAddress = ethers.utils.verifyMessage(msgHashBytes, signature);
          isValid = recoveredAddress.toLowerCase() === publicKey.toLowerCase();
        } catch (error) {
          this.logger.error('Error verifying Ethereum signature', error);
          isValid = false;
        }
      } else if (chainType === ChainType.SOLANA) {
        // Verify Solana signature
        try {
          const publicKeyBytes = bs58.decode(publicKey);
          isValid = nacl.sign.detached.verify(
            message,
            signature,
            publicKeyBytes
          );
        } catch (error) {
          this.logger.error('Error verifying Solana signature', error);
          isValid = false;
        }
      } else {
        this.logger.error(`Unsupported chain type for signature verification: ${chainType}`);
        isValid = false;
      }
      
      // Cache the result
      await this.cache.set(cacheKey, isValid ? 'true' : 'false', 86400); // Cache for 24 hours
      
      // Record metrics
      this.metrics.recordMetric('security_service.signature_verification', 1);
      this.metrics.recordMetric('security_service.signature_valid', isValid ? 1 : 0);
      
      this.logger.debug(`Signature verification result: ${isValid ? 'valid' : 'invalid'}`);
      return isValid;
    } catch (error) {
      this.logger.error('Error verifying signature', error);
      this.metrics.recordMetric('security_service.signature_verification_error', 1);
      return false;
    }
  }
  
  /**
   * Checks if an address is blocked
   * 
   * @param address The address to check
   * @returns Whether the address is blocked
   */
  public isAddressBlocked(address: string): boolean {
    // Normalize address
    const normalizedAddress = address.toLowerCase();
    
    // Check if address is in blocked list
    const isBlocked = this.config.transactionValidation.blockedAddresses
      .map(a => a.toLowerCase())
      .includes(normalizedAddress);
    
    if (isBlocked) {
      this.logger.warn(`Blocked address detected: ${address}`);
      this.metrics.recordMetric('security_service.blocked_address_detected', 1);
      this.alerts.triggerAlert('security', 'warning', `Blocked address detected: ${address}`);
    }
    
    return isBlocked;
  }
  
  /**
   * Validates a transaction
   * 
   * @param transaction The transaction to validate
   * @param chainType The chain type
   * @returns Whether the transaction is valid
   */
  public validateTransaction(transaction: any, chainType: ChainType): boolean {
    if (!this.config.enableTransactionValidation) {
      return true;
    }
    
    this.logger.debug(`Validating transaction for ${chainType}`);
    
    try {
      // Validate based on chain type
      if (chainType === ChainType.ETHEREUM) {
        // Validate Ethereum transaction
        
        // Check gas price if present
        if (transaction.gasPrice) {
          const maxGasPrice = ethers.BigNumber.from(this.config.transactionValidation.maxGasPrice);
          const gasPrice = ethers.BigNumber.from(transaction.gasPrice);
          
          if (gasPrice.gt(maxGasPrice)) {
            this.logger.warn(`Transaction gas price exceeds maximum: ${gasPrice.toString()} > ${maxGasPrice.toString()}`);
            this.metrics.recordMetric('security_service.high_gas_price_rejected', 1);
            return false;
          }
        }
        
        // Check transaction size
        const txSize = JSON.stringify(transaction).length;
        if (txSize > this.config.transactionValidation.maxTransactionSize) {
          this.logger.warn(`Transaction size exceeds maximum: ${txSize} > ${this.config.transactionValidation.maxTransactionSize}`);
          this.metrics.recordMetric('security_service.large_transaction_rejected', 1);
          return false;
        }
        
        // Check if sender is blocked
        if (transaction.from && this.isAddressBlocked(transaction.from)) {
          return false;
        }
        
        // Check if recipient is blocked
        if (transaction.to && this.isAddressBlocked(transaction.to)) {
          return false;
        }
      } else if (chainType === ChainType.SOLANA) {
        // Validate Solana transaction
        
        // Check transaction size
        const txSize = JSON.stringify(transaction).length;
        if (txSize > this.config.transactionValidation.maxTransactionSize) {
          this.logger.warn(`Transaction size exceeds maximum: ${txSize} > ${this.config.transactionValidation.maxTransactionSize}`);
          this.metrics.recordMetric('security_service.large_transaction_rejected', 1);
          return false;
        }
        
        // Additional Solana-specific validation could be added here
      } else {
        this.logger.error(`Unsupported chain type for transaction validation: ${chainType}`);
        return false;
      }
      
      // Record metrics
      this.metrics.recordMetric('security_service.transaction_validation', 1);
      this.metrics.recordMetric('security_service.transaction_valid', 1);
      
      return true;
    } catch (error) {
      this.logger.error('Error validating transaction', error);
      this.metrics.recordMetric('security_service.transaction_validation_error', 1);
      return false;
    }
  }
  
  /**
   * Checks rate limits for an address
   * 
   * @param address The address to check
   * @param actionType The type of action being performed
   * @returns Whether the action is allowed
   */
  public checkRateLimit(address: string, actionType: string): boolean {
    if (!this.config.enableRateLimiting) {
      return true;
    }
    
    this.logger.debug(`Checking rate limit for ${address} (${actionType})`);
    
    try {
      // Create a unique key for this address and action type
      const key = `${address.toLowerCase()}:${actionType}`;
      
      // Get or create rate limiter entry
      let entry = this.rateLimiters[key];
      if (!entry) {
        entry = {
          count: 0,
          lastReset: new Date(),
          blocked: false
        };
        this.rateLimiters[key] = entry;
      }
      
      // Check if blocked
      if (entry.blocked) {
        if (entry.blockExpiration && entry.blockExpiration > new Date()) {
          this.logger.warn(`Rate limit exceeded for ${address} (${actionType}), blocked until ${entry.blockExpiration}`);
          this.metrics.recordMetric('security_service.rate_limit_blocked', 1);
          return false;
        } else {
          // Unblock if expiration has passed
          entry.blocked = false;
          entry.blockExpiration = undefined;
        }
      }
      
      // Check if we need to reset the counter
      const now = new Date();
      const minutesSinceLastReset = (now.getTime() - entry.lastReset.getTime()) / 60000;
      if (minutesSinceLastReset >= 1) {
        entry.count = 0;
        entry.lastReset = now;
      }
      
      // Check if rate limit exceeded
      if (entry.count >= this.config.rateLimits.maxRequestsPerMinute) {
        this.logger.warn(`Rate limit exceeded for ${address} (${actionType})`);
        this.metrics.recordMetric('security_service.rate_limit_exceeded', 1);
        
        // Block for 5 minutes
        entry.blocked = true;
        entry.blockExpiration = new Date(now.getTime() + 5 * 60000);
        
        return false;
      }
      
      // Increment counter
      entry.count++;
      
      return true;
    } catch (error) {
      this.logger.error('Error checking rate limit', error);
      this.metrics.recordMetric('security_service.rate_limit_check_error', 1);
      return true; // Allow in case of error
    }
  }
  
  /**
   * Signs a message using the HSM
   * 
   * @param message The message to sign
   * @param chainType The chain type
   * @returns The signature
   */
  public async signWithHSM(message: Buffer, chainType: ChainType): Promise<Buffer> {
    if (!this.config.enableHSMSupport || !this.config.hsm.enabled || !this.hsmConnection) {
      throw new Error('HSM not enabled or initialized');
    }
    
    this.logger.debug(`Signing message with HSM for ${chainType}`);
    
    try {
      // Get the key ID for the chain
      const keyId = chainType === ChainType.ETHEREUM
        ? this.config.hsm.keyIds.ethereum
        : this.config.hsm.keyIds.solana;
      
      // Sign the message
      const signature = await this.hsmConnection.sign(keyId, message);
      
      // Record metrics
      this.metrics.recordMetric('security_service.hsm_signing', 1);
      
      return signature;
    } catch (error) {
      this.logger.error('Error signing with HSM', error);
      this.metrics.recordMetric('security_service.hsm_signing_error', 1);
      throw error;
    }
  }
  
  /**
   * Validates a VAA (Verified Action Approval)
   * 
   * @param vaa The VAA to validate
   * @returns Whether the VAA is valid
   */
  public async validateVAA(vaa: Buffer): Promise<boolean> {
    this.logger.debug('Validating VAA');
    
    try {
      // Check if we've already validated this VAA
      const vaaHash = crypto.createHash('sha256').update(vaa).digest('hex');
      const cacheKey = `vaa_valid:${vaaHash}`;
      const cachedResult = await this.cache.get(cacheKey);
      if (cachedResult === 'true') {
        this.logger.debug('VAA validation cached result: valid');
        return true;
      } else if (cachedResult === 'false') {
        this.logger.debug('VAA validation cached result: invalid');
        return false;
      }
      
      // In a real implementation, you would:
      // 1. Parse the VAA
      // 2. Verify the signatures from the guardians
      // 3. Check that enough guardians have signed
      // 4. Verify the VAA hasn't been used before
      
      // For this example, we'll simulate validation
      const isValid = true;
      
      // Cache the result
      await this.cache.set(cacheKey, isValid ? 'true' : 'false', 86400); // Cache for 24 hours
      
      // Record metrics
      this.metrics.recordMetric('security_service.vaa_validation', 1);
      this.metrics.recordMetric('security_service.vaa_valid', isValid ? 1 : 0);
      
      return isValid;
    } catch (error) {
      this.logger.error('Error validating VAA', error);
      this.metrics.recordMetric('security_service.vaa_validation_error', 1);
      return false;
    }
  }
  
  /**
   * Checks if an IP address is allowed
   * 
   * @param ip The IP address to check
   * @returns Whether the IP is allowed
   */
  public isIPAllowed(ip: string): boolean {
    if (!this.config.firewall.enabled) {
      return true;
    }
    
    // Check if IP is explicitly blocked
    if (this.config.firewall.blockedIPs.includes(ip)) {
      this.logger.warn(`Blocked IP detected: ${ip}`);
      this.metrics.recordMetric('security_service.blocked_ip_detected', 1);
      return false;
    }
    
    // If we have an allowlist and the IP is not in it, block it
    if (this.config.firewall.allowedIPs.length > 0 && !this.config.firewall.allowedIPs.includes(ip)) {
      this.logger.warn(`IP not in allowlist: ${ip}`);
      this.metrics.recordMetric('security_service.ip_not_in_allowlist', 1);
      return false;
    }
    
    return true;
  }
  
  /**
   * Generates a secure random number
   * 
   * @param min The minimum value (inclusive)
   * @param max The maximum value (exclusive)
   * @returns A secure random number
   */
  public generateSecureRandom(min: number, max: number): number {
    // Generate a secure random number between min and max
    const range = max - min;
    const bytesNeeded = Math.ceil(Math.log2(range) / 8);
    const randomBytes = crypto.randomBytes(bytesNeeded);
    let randomValue = 0;
    
    for (let i = 0; i < bytesNeeded; i++) {
      randomValue = (randomValue << 8) | randomBytes[i];
    }
    
    return min + (randomValue % range);
  }
  
  /**
   * Encrypts sensitive data
   * 
   * @param data The data to encrypt
   * @param key The encryption key
   * @returns The encrypted data
   */
  public encryptData(data: string, key: Buffer): string {
    // Generate a random initialization vector
    const iv = crypto.randomBytes(16);
    
    // Create cipher
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    // Encrypt the data
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Return the IV and encrypted data
    return iv.toString('hex') + ':' + encrypted;
  }
  
  /**
   * Decrypts sensitive data
   * 
   * @param encryptedData The encrypted data
   * @param key The encryption key
   * @returns The decrypted data
   */
  public decryptData(encryptedData: string, key: Buffer): string {
    // Split the IV and encrypted data
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    // Create decipher
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    
    // Decrypt the data
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
  
  /**
   * Gets the status of the security service
   * 
   * @returns The status
   */
  public getStatus(): { 
    isRunning: boolean, 
    hsmConnected: boolean,
    rateLimitingEnabled: boolean,
    signatureVerificationEnabled: boolean,
    transactionValidationEnabled: boolean,
    firewallEnabled: boolean
  } {
    return {
      isRunning: this.isRunning,
      hsmConnected: this.hsmConnection !== null,
      rateLimitingEnabled: this.config.enableRateLimiting,
      signatureVerificationEnabled: this.config.enableSignatureVerification,
      transactionValidationEnabled: this.config.enableTransactionValidation,
      firewallEnabled: this.config.firewall.enabled
    };
  }
}
