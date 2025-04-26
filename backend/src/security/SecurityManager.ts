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
  private spentOutputs: Set<string>; // Track spent outputs for double spend detection

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
    this.spentOutputs = new Set();
    
    // Default security configuration
    this.securityConfig = {
      maxRequestsPerMinute: 60,
      maxTransactionsPerBlock: 1000,
      nonceExpirationBlocks: 100,
      maxTransactionSize: 1024 * 10, // 10KB
      minStakeForValidator: new BN(LAMPORTS_PER_SOL * 100), // 100 SOL
      apiKeySecret: process.env.API_KEY_SECRET || 'default_secret_change_me',
      maxGasPerTransaction: 500000, // Maximum gas units per transaction
      stateTransitionRules: {
        // Define valid state transitions
        'pending': ['processing', 'completed', 'failed'],
        'processing': ['completed', 'failed'],
        'completed': [],
        'failed': ['pending'] // Allow retries from failed state
      },
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
    try {
      // Extract transaction inputs (references to previous outputs)
      const inputs = this.extractTransactionInputs(transaction);
      
      // Check if any input has been spent already
      for (const input of inputs) {
        const inputId = this.getInputId(input);
        if (this.spentOutputs.has(inputId)) {
          return {
            valid: false,
            error: `Double spend detected: input ${inputId} has already been spent`
          };
        }
      }
      
      // Mark inputs as spent (will be committed after transaction is confirmed)
      for (const input of inputs) {
        const inputId = this.getInputId(input);
        this.spentOutputs.add(inputId);
      }
      
      return { valid: true };
    } catch (error) {
      console.error('Double spend check error:', error);
      return { valid: true }; // Fallback to valid in case of error
    }
  }

  /**
   * Extract transaction inputs from a transaction
   * @param transaction Transaction to extract inputs from
   * @returns Array of transaction inputs
   */
  private extractTransactionInputs(transaction: Transaction): any[] {
    // This is a simplified implementation
    // In a real system, you would extract the actual inputs from the transaction
    // based on your specific transaction format
    
    const inputs = [];
    
    // Example: Extract input references from transaction data
    for (const instruction of transaction.instructions) {
      // Parse instruction data to extract input references
      // This is highly dependent on your specific transaction format
      
      // For demonstration purposes, we'll create a dummy input for each instruction
      const dummyInput = {
        previousTxId: bs58.encode(instruction.programId.toBuffer()).slice(0, 16),
        outputIndex: Math.floor(Math.random() * 4), // Just for demonstration
        amount: Math.floor(Math.random() * 1000) // Just for demonstration
      };
      
      inputs.push(dummyInput);
    }
    
    return inputs;
  }

  /**
   * Get a unique identifier for a transaction input
   * @param input Transaction input
   * @returns Unique identifier
   */
  private getInputId(input: any): string {
    return `${input.previousTxId}:${input.outputIndex}`;
  }

  /**
   * Check for invalid state transition
   * @param transaction Transaction to check
   * @returns Validation result
   */
  private checkInvalidStateTransition(transaction: Transaction): ValidationResult {
    try {
      // Extract state transition from transaction
      const stateTransition = this.extractStateTransition(transaction);
      
      if (!stateTransition) {
        // No state transition in this transaction
        return { valid: true };
      }
      
      const { fromState, toState } = stateTransition;
      
      // Check if the transition is allowed
      const allowedTransitions = this.securityConfig.stateTransitionRules[fromState] || [];
      if (!allowedTransitions.includes(toState)) {
        return {
          valid: false,
          error: `Invalid state transition: ${fromState} -> ${toState} is not allowed`
        };
      }
      
      return { valid: true };
    } catch (error) {
      console.error('State transition check error:', error);
      return { valid: true }; // Fallback to valid in case of error
    }
  }

  /**
   * Extract state transition from a transaction
   * @param transaction Transaction to extract state transition from
   * @returns State transition or null if no state transition
   */
  private extractStateTransition(transaction: Transaction): StateTransition | null {
    // This is a simplified implementation
    // In a real system, you would extract the actual state transition from the transaction
    // based on your specific transaction format
    
    // For demonstration purposes, we'll check if any instruction has data that looks like a state transition
    for (const instruction of transaction.instructions) {
      if (instruction.data.length >= 2) {
        // Assume first byte is a command code and second byte is a state code
        const commandCode = instruction.data[0];
        
        // Check if this is a state transition command (e.g., command code 0x10)
        if (commandCode === 0x10) {
          const fromStateCode = instruction.data[1];
          const toStateCode = instruction.data[2];
          
          // Map state codes to state names
          const stateMap = {
            0: 'pending',
            1: 'processing',
            2: 'completed',
            3: 'failed'
          };
          
          return {
            fromState: stateMap[fromStateCode] || 'unknown',
            toState: stateMap[toStateCode] || 'unknown'
          };
        }
      }
    }
    
    return null;
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
        
        // Check if instruction has valid accounts
        if (!instruction.keys || instruction.keys.length === 0) {
          return {
            valid: false,
            error: `Instruction ${i} has no account keys`
          };
        }
        
        // Check if instruction data is valid
        if (!instruction.data) {
          return {
            valid: false,
            error: `Instruction ${i} has no data`
          };
        }
      }
      
      // Check if transaction has a recent blockhash
      if (!transaction.recentBlockhash) {
        return {
          valid: false,
          error: 'Transaction has no recent blockhash'
        };
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
    try {
      // Estimate gas usage for the transaction
      const estimatedGas = this.estimateGasUsage(transaction);
      
      // Check if gas usage exceeds maximum
      if (estimatedGas > this.securityConfig.maxGasPerTransaction) {
        return {
          valid: false,
          error: `Transaction exceeds maximum gas usage (${estimatedGas} > ${this.securityConfig.maxGasPerTransaction})`
        };
      }
      
      return { valid: true };
    } catch (error) {
      console.error('Gas usage check error:', error);
      return { valid: true }; // Fallback to valid in case of error
    }
  }

  /**
   * Estimate gas usage for a transaction
   * @param transaction Transaction to estimate gas for
   * @returns Estimated gas usage
   */
  private estimateGasUsage(transaction: Transaction): number {
    // This is a simplified implementation
    // In a real system, you would use a more accurate gas estimation model
    
    // Base gas cost for the transaction
    let gasUsage = 21000;
    
    // Add gas for each instruction
    for (const instruction of transaction.instructions) {
      // Gas for instruction overhead
      gasUsage += 5000;
      
      // Gas for instruction data
      gasUsage += instruction.data.length * 68;
      
      // Gas for each account reference
      gasUsage += instruction.keys.length * 2500;
    }
    
    return gasUsage;
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
          // Extract the actual stake amount from the account data
          // This is a simplified implementation that extracts the lamports field
          const lamports = account.account.lamports;
          const stakeAmount = new BN(lamports);
          totalStake = totalStake.add(stakeAmount);
          
          console.log(`Stake account ${account.pubkey.toString()} has ${lamports} lamports`);
        }
      }
      
      console.log(`Total stake for validator ${validatorPubkey.toString()}: ${totalStake.toString()} lamports`);
      console.log(`Minimum required stake: ${this.securityConfig.minStakeForValidator.toString()} lamports`);
      
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
  maxGasPerTransaction: number;
  stateTransitionRules: {
    [fromState: string]: string[];
  };
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

/**
 * State transition
 */
interface StateTransition {
  fromState: string;
  toState: string;
}

export default SecurityManager;
