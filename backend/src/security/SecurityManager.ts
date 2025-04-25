import { PublicKey, Connection, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider, web3, BN } from '@project-serum/anchor';
import * as bs58 from 'bs58';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { createHmac } from 'crypto';

// Load environment variables
dotenv.config();

/**
 * SecurityManager for Layer-2 on Solana
 * Provides security features including:
 * - Rate limiting
 * - Replay protection
 * - Transaction validation
 * - Signature verification
 * - Fraud detection
 */
export class SecurityManager {
  private connection: Connection;
  private layer2Connection: Connection;
  private rateLimits: Map<string, RateLimitInfo>;
  private nonceRegistry: Map<string, number>;
  private fraudDetectionRules: FraudDetectionRule[];
  private securityConfig: SecurityConfig;

  /**
   * Constructor for SecurityManager
   * @param connection Solana connection
   * @param layer2Connection Layer-2 connection
   * @param config Security configuration
   */
  constructor(
    connection: Connection,
    layer2Connection: Connection,
    config?: Partial<SecurityConfig>
  ) {
    this.connection = connection;
    this.layer2Connection = layer2Connection;
    this.rateLimits = new Map();
    this.nonceRegistry = new Map();
    this.fraudDetectionRules = [];
    
    // Default security configuration
    this.securityConfig = {
      maxRequestsPerMinute: 60,
      maxTransactionsPerBlock: 1000,
      nonceExpirationBlocks: 100,
      maxTransactionSize: 1024 * 10, // 10KB
      minStakeForValidator: new BN(LAMPORTS_PER_SOL * 100), // 100 SOL
      apiKeySecret: process.env.API_KEY_SECRET || 'default_secret_change_me',
      ...config
    };
    
    // Initialize fraud detection rules
    this.initFraudDetectionRules();
  }

  /**
   * Initialize fraud detection rules
   */
  private initFraudDetectionRules() {
    this.fraudDetectionRules = [
      {
        name: 'Double Spend Detection',
        description: 'Detects attempts to spend the same output twice',
        checkFunction: this.checkDoubleSpend.bind(this)
      },
      {
        name: 'Invalid State Transition',
        description: 'Detects invalid state transitions in the state machine',
        checkFunction: this.checkInvalidStateTransition.bind(this)
      },
      {
        name: 'Malformed Transaction',
        description: 'Detects malformed transactions with invalid structure',
        checkFunction: this.checkMalformedTransaction.bind(this)
      },
      {
        name: 'Excessive Gas Usage',
        description: 'Detects transactions that use excessive computational resources',
        checkFunction: this.checkExcessiveGasUsage.bind(this)
      }
    ];
  }

  /**
   * Check for rate limiting
   * @param clientId Client identifier (IP address, wallet address, etc.)
   * @returns Whether the request is allowed
   */
  public checkRateLimit(clientId: string): boolean {
    const now = Date.now();
    const rateLimitInfo = this.rateLimits.get(clientId);
    
    if (!rateLimitInfo) {
      // First request from this client
      this.rateLimits.set(clientId, {
        requestCount: 1,
        windowStart: now,
        lastRequest: now
      });
      return true;
    }
    
    // Check if we're in a new time window
    if (now - rateLimitInfo.windowStart > 60000) { // 1 minute window
      // Reset for new window
      rateLimitInfo.requestCount = 1;
      rateLimitInfo.windowStart = now;
      rateLimitInfo.lastRequest = now;
      return true;
    }
    
    // Check if rate limit is exceeded
    if (rateLimitInfo.requestCount >= this.securityConfig.maxRequestsPerMinute) {
      console.warn(`Rate limit exceeded for client ${clientId}`);
      return false;
    }
    
    // Increment request count
    rateLimitInfo.requestCount++;
    rateLimitInfo.lastRequest = now;
    return true;
  }

  /**
   * Verify transaction nonce to prevent replay attacks
   * @param transaction Transaction to verify
   * @param nonce Transaction nonce
   * @returns Whether the nonce is valid
   */
  public verifyNonce(transaction: Transaction, nonce: string): boolean {
    // Check if nonce has been used before
    if (this.nonceRegistry.has(nonce)) {
      console.warn(`Nonce ${nonce} has already been used`);
      return false;
    }
    
    // Register nonce with current block height
    this.layer2Connection.getBlockHeight().then(blockHeight => {
      this.nonceRegistry.set(nonce, blockHeight);
      
      // Clean up expired nonces
      this.cleanupExpiredNonces(blockHeight);
    });
    
    return true;
  }

  /**
   * Clean up expired nonces
   * @param currentBlockHeight Current block height
   */
  private async cleanupExpiredNonces(currentBlockHeight: number) {
    for (const [nonce, blockHeight] of this.nonceRegistry.entries()) {
      if (currentBlockHeight - blockHeight > this.securityConfig.nonceExpirationBlocks) {
        this.nonceRegistry.delete(nonce);
      }
    }
  }

  /**
   * Validate transaction
   * @param transaction Transaction to validate
   * @returns Validation result
   */
  public validateTransaction(transaction: Transaction): ValidationResult {
    try {
      // Check transaction size
      const serializedTx = transaction.serialize();
      if (serializedTx.length > this.securityConfig.maxTransactionSize) {
        return {
          valid: false,
          error: `Transaction size exceeds maximum (${serializedTx.length} > ${this.securityConfig.maxTransactionSize})`
        };
      }
      
      // Verify all signatures
      if (!transaction.verifySignatures()) {
        return {
          valid: false,
          error: 'Transaction signature verification failed'
        };
      }
      
      // Run fraud detection rules
      for (const rule of this.fraudDetectionRules) {
        const ruleResult = rule.checkFunction(transaction);
        if (!ruleResult.valid) {
          return ruleResult;
        }
      }
      
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Transaction validation error: ${error.message}`
      };
    }
  }

  /**
   * Verify API key
   * @param apiKey API key to verify
   * @param timestamp Request timestamp
   * @param signature Request signature
   * @returns Whether the API key is valid
   */
  public verifyApiKey(apiKey: string, timestamp: string, signature: string): boolean {
    try {
      // Check if timestamp is within acceptable range (5 minutes)
      const now = Math.floor(Date.now() / 1000);
      const requestTime = parseInt(timestamp, 10);
      
      if (isNaN(requestTime) || Math.abs(now - requestTime) > 300) {
        console.warn(`Invalid timestamp: ${timestamp}`);
        return false;
      }
      
      // Verify signature
      const data = `${apiKey}:${timestamp}`;
      const expectedSignature = createHmac('sha256', this.securityConfig.apiKeySecret)
        .update(data)
        .digest('hex');
      
      if (signature !== expectedSignature) {
        console.warn(`Invalid API key signature`);
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('API key verification error:', error);
      return false;
    }
  }

  /**
   * Generate API key
   * @param userId User identifier
   * @returns Generated API key
   */
  public generateApiKey(userId: string): ApiKeyInfo {
    const apiKey = crypto.randomBytes(16).toString('hex');
    const secret = crypto.randomBytes(32).toString('hex');
    
    return {
      apiKey,
      secret,
      userId,
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Check for double spend
   * @param transaction Transaction to check
   * @returns Validation result
   */
  private checkDoubleSpend(transaction: Transaction): ValidationResult {
    // Implementation would check if inputs have been spent already
    // This is a simplified placeholder
    return { valid: true };
  }

  /**
   * Check for invalid state transition
   * @param transaction Transaction to check
   * @returns Validation result
   */
  private checkInvalidStateTransition(transaction: Transaction): ValidationResult {
    // Implementation would verify state transitions
    // This is a simplified placeholder
    return { valid: true };
  }

  /**
   * Check for malformed transaction
   * @param transaction Transaction to check
   * @returns Validation result
   */
  private checkMalformedTransaction(transaction: Transaction): ValidationResult {
    try {
      // Check if transaction has at least one instruction
      if (transaction.instructions.length === 0) {
        return {
          valid: false,
          error: 'Transaction has no instructions'
        };
      }
      
      // Check if each instruction has a program ID
      for (let i = 0; i < transaction.instructions.length; i++) {
        const instruction = transaction.instructions[i];
        if (!instruction.programId) {
          return {
            valid: false,
            error: `Instruction ${i} has no program ID`
          };
        }
      }
      
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Malformed transaction check error: ${error.message}`
      };
    }
  }

  /**
   * Check for excessive gas usage
   * @param transaction Transaction to check
   * @returns Validation result
   */
  private checkExcessiveGasUsage(transaction: Transaction): ValidationResult {
    // Implementation would estimate gas usage
    // This is a simplified placeholder
    return { valid: true };
  }

  /**
   * Detect potential fraud in a block
   * @param blockNumber Block number to check
   * @returns Fraud detection result
   */
  public async detectFraudInBlock(blockNumber: number): Promise<FraudDetectionResult> {
    try {
      // Get block
      const block = await this.layer2Connection.getBlock(blockNumber);
      
      if (!block) {
        return {
          blockNumber,
          fraudDetected: false,
          error: 'Block not found'
        };
      }
      
      // Check number of transactions
      if (block.transactions.length > this.securityConfig.maxTransactionsPerBlock) {
        return {
          blockNumber,
          fraudDetected: true,
          reason: `Block contains too many transactions (${block.transactions.length} > ${this.securityConfig.maxTransactionsPerBlock})`
        };
      }
      
      // Validate each transaction
      for (let i = 0; i < block.transactions.length; i++) {
        const transaction = block.transactions[i].transaction;
        const validationResult = this.validateTransaction(transaction);
        
        if (!validationResult.valid) {
          return {
            blockNumber,
            fraudDetected: true,
            reason: `Invalid transaction at index ${i}: ${validationResult.error}`
          };
        }
      }
      
      return {
        blockNumber,
        fraudDetected: false
      };
    } catch (error) {
      return {
        blockNumber,
        fraudDetected: false,
        error: `Fraud detection error: ${error.message}`
      };
    }
  }

  /**
   * Verify validator stake
   * @param validatorPubkey Validator public key
   * @returns Whether the validator has sufficient stake
   */
  public async verifyValidatorStake(validatorPubkey: PublicKey): Promise<boolean> {
    try {
      // Get validator stake account
      const stakeAccounts = await this.connection.getParsedProgramAccounts(
        SystemProgram.programId,
        {
          filters: [
            {
              dataSize: 200, // Approximate size of stake account data
            },
            {
              memcmp: {
                offset: 12, // Offset of stake authority
                bytes: validatorPubkey.toBase58(),
              },
            },
          ],
        }
      );
      
      // Calculate total stake
      let totalStake = new BN(0);
      for (const account of stakeAccounts) {
        if (account.account.data) {
          // Parse stake amount from account data
          // This is a simplified placeholder
          const stakeAmount = new BN(0); // Would extract from account.account.data
          totalStake = totalStake.add(stakeAmount);
        }
      }
      
      // Check if stake is sufficient
      return totalStake.gte(this.securityConfig.minStakeForValidator);
    } catch (error) {
      console.error('Validator stake verification error:', error);
      return false;
    }
  }
}

/**
 * Rate limit information
 */
interface RateLimitInfo {
  requestCount: number;
  windowStart: number;
  lastRequest: number;
}

/**
 * Security configuration
 */
interface SecurityConfig {
  maxRequestsPerMinute: number;
  maxTransactionsPerBlock: number;
  nonceExpirationBlocks: number;
  maxTransactionSize: number;
  minStakeForValidator: BN;
  apiKeySecret: string;
}

/**
 * Validation result
 */
interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Fraud detection rule
 */
interface FraudDetectionRule {
  name: string;
  description: string;
  checkFunction: (transaction: Transaction) => ValidationResult;
}

/**
 * Fraud detection result
 */
interface FraudDetectionResult {
  blockNumber: number;
  fraudDetected: boolean;
  reason?: string;
  error?: string;
}

/**
 * API key information
 */
interface ApiKeyInfo {
  apiKey: string;
  secret: string;
  userId: string;
  createdAt: string;
}

export default SecurityManager;
