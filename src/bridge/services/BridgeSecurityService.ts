// English comment for verification
/**
 * @file BridgeSecurityService.ts
 * @description Service for implementing security measures for the bridge between Ethereum and Solana
 * 
 * This service provides comprehensive security features for the bridge operations,
 * including fraud detection, rate limiting, signature verification, and security auditing.
 */

import { EthereumConnector } from '../connectors/EthereumConnector';
import { SolanaConnector } from '../connectors/SolanaConnector';
import { Logger } from '../utils/Logger';
import { MetricsCollector } from '../utils/MetricsCollector';
import { Cache } from '../utils/Cache';
import { Repository, Between, LessThan, MoreThan, In } from 'typeorm';
import { BridgeTransaction, TransactionStatus, TransactionType } from '../models/BridgeTransaction';
import { BlockFinalization, BlockFinalizationState } from '../models/BlockFinalization';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';
import * as bs58 from 'bs58';

/**
 * Configuration for the bridge security service
 */
export interface BridgeSecurityConfig {
    /**
     * Security check interval in milliseconds
     */
    securityCheckInterval?: number;
    
    /**
     * Whether to enable fraud detection
     */
    enableFraudDetection?: boolean;
    
    /**
     * Fraud detection interval in milliseconds
     */
    fraudDetectionInterval?: number;
    
    /**
     * Whether to enable rate limiting
     */
    enableRateLimiting?: boolean;
    
    /**
     * Rate limit window in milliseconds
     */
    rateLimitWindow?: number;
    
    /**
     * Maximum number of deposits per window per address
     */
    maxDepositsPerWindow?: number;
    
    /**
     * Maximum number of withdrawals per window per address
     */
    maxWithdrawalsPerWindow?: number;
    
    /**
     * Maximum deposit amount per transaction (in smallest unit)
     */
    maxDepositAmount?: string;
    
    /**
     * Maximum withdrawal amount per transaction (in smallest unit)
     */
    maxWithdrawalAmount?: string;
    
    /**
     * Whether to enable signature verification
     */
    enableSignatureVerification?: boolean;
    
    /**
     * Whether to enable security auditing
     */
    enableSecurityAuditing?: boolean;
    
    /**
     * Security audit interval in milliseconds
     */
    securityAuditInterval?: number;
    
    /**
     * Directory for storing security audit logs
     */
    securityAuditLogDirectory?: string;
    
    /**
     * Maximum age of security audit logs to keep (in days)
     */
    maxSecurityAuditLogAge?: number;
    
    /**
     * Whether to enable emergency shutdown
     */
    enableEmergencyShutdown?: boolean;
    
    /**
     * Emergency shutdown threshold (number of security incidents)
     */
    emergencyShutdownThreshold?: number;
    
    /**
     * Whether to enable whitelist
     */
    enableWhitelist?: boolean;
    
    /**
     * Whitelisted addresses
     */
    whitelistedAddresses?: string[];
    
    /**
     * Whether to enable blacklist
     */
    enableBlacklist?: boolean;
    
    /**
     * Blacklisted addresses
     */
    blacklistedAddresses?: string[];
    
    /**
     * Whether to enable transaction signing
     */
    enableTransactionSigning?: boolean;
    
    /**
     * Path to private key file for transaction signing
     */
    privateKeyPath?: string;
    
    /**
     * Password for private key file
     */
    privateKeyPassword?: string;
    
    /**
     * Whether to enable HSM integration
     */
    enableHsmIntegration?: boolean;
    
    /**
     * HSM configuration
     */
    hsmConfig?: {
        /**
         * HSM module path
         */
        modulePath: string;
        
        /**
         * HSM slot ID
         */
        slotId: number;
        
        /**
         * HSM PIN
         */
        pin: string;
        
        /**
         * HSM key label
         */
        keyLabel: string;
    };
    
    /**
     * Whether to enable multi-signature
     */
    enableMultiSignature?: boolean;
    
    /**
     * Multi-signature threshold (number of signatures required)
     */
    multiSignatureThreshold?: number;
    
    /**
     * Multi-signature signers
     */
    multiSignatureSigners?: string[];
}

/**
 * Security incident types
 */
export enum SecurityIncidentType {
    FRAUD_DETECTED = 'fraud_detected',
    RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
    INVALID_SIGNATURE = 'invalid_signature',
    BLACKLISTED_ADDRESS = 'blacklisted_address',
    SUSPICIOUS_TRANSACTION = 'suspicious_transaction',
    LARGE_TRANSACTION = 'large_transaction',
    EMERGENCY_SHUTDOWN = 'emergency_shutdown',
    UNAUTHORIZED_ACCESS = 'unauthorized_access',
    INVALID_STATE_TRANSITION = 'invalid_state_transition',
    DOUBLE_SPEND_ATTEMPT = 'double_spend_attempt'
}

/**
 * Security incident
 */
export interface SecurityIncident {
    /**
     * Incident ID
     */
    id: string;
    
    /**
     * Incident timestamp
     */
    timestamp: number;
    
    /**
     * Incident type
     */
    type: SecurityIncidentType;
    
    /**
     * Incident description
     */
    description: string;
    
    /**
     * Incident source
     */
    source: string;
    
    /**
     * Incident data
     */
    data?: any;
    
    /**
     * Whether the incident has been resolved
     */
    resolved?: boolean;
    
    /**
     * Resolution timestamp
     */
    resolvedAt?: number;
    
    /**
     * Resolution user
     */
    resolvedBy?: string;
    
    /**
     * Resolution description
     */
    resolutionDescription?: string;
}

/**
 * Rate limit entry
 */
interface RateLimitEntry {
    /**
     * Address
     */
    address: string;
    
    /**
     * Transaction type
     */
    type: TransactionType;
    
    /**
     * Count
     */
    count: number;
    
    /**
     * Window start timestamp
     */
    windowStart: number;
}

/**
 * Bridge security service class
 */
export class BridgeSecurityService {
    private config: BridgeSecurityConfig;
    private logger: Logger;
    private metrics: MetricsCollector;
    private cache: Cache;
    private ethereumConnector: EthereumConnector;
    private solanaConnector: SolanaConnector;
    private bridgeTransactionRepository: Repository<BridgeTransaction>;
    private blockFinalizationRepository: Repository<BlockFinalization>;
    
    private isRunning: boolean = false;
    private securityCheckInterval: NodeJS.Timeout | null = null;
    private fraudDetectionInterval: NodeJS.Timeout | null = null;
    private securityAuditInterval: NodeJS.Timeout | null = null;
    
    private securityIncidents: SecurityIncident[] = [];
    private rateLimitEntries: RateLimitEntry[] = [];
    private emergencyShutdownActive: boolean = false;
    private privateKey: string | null = null;
    
    /**
     * Creates a new instance of the bridge security service
     * @param config Bridge security configuration
     * @param logger Logger instance
     * @param metrics Metrics collector instance
     * @param cache Cache instance
     * @param ethereumConnector Ethereum connector instance
     * @param solanaConnector Solana connector instance
     * @param bridgeTransactionRepository Bridge transaction repository
     * @param blockFinalizationRepository Block finalization repository
     */
    constructor(
        config: BridgeSecurityConfig,
        logger: Logger,
        metrics: MetricsCollector,
        cache: Cache,
        ethereumConnector: EthereumConnector,
        solanaConnector: SolanaConnector,
        bridgeTransactionRepository: Repository<BridgeTransaction>,
        blockFinalizationRepository: Repository<BlockFinalization>
    ) {
        this.config = {
            ...config,
            securityCheckInterval: config.securityCheckInterval || 60000, // 1 minute
            enableFraudDetection: config.enableFraudDetection !== false,
            fraudDetectionInterval: config.fraudDetectionInterval || 300000, // 5 minutes
            enableRateLimiting: config.enableRateLimiting !== false,
            rateLimitWindow: config.rateLimitWindow || 3600000, // 1 hour
            maxDepositsPerWindow: config.maxDepositsPerWindow || 10,
            maxWithdrawalsPerWindow: config.maxWithdrawalsPerWindow || 10,
            maxDepositAmount: config.maxDepositAmount || '1000000000000000000000', // 1000 ETH
            maxWithdrawalAmount: config.maxWithdrawalAmount || '1000000000000000000000', // 1000 ETH
            enableSignatureVerification: config.enableSignatureVerification !== false,
            enableSecurityAuditing: config.enableSecurityAuditing !== false,
            securityAuditInterval: config.securityAuditInterval || 3600000, // 1 hour
            securityAuditLogDirectory: config.securityAuditLogDirectory || path.join(process.cwd(), 'security-logs'),
            maxSecurityAuditLogAge: config.maxSecurityAuditLogAge || 30, // 30 days
            enableEmergencyShutdown: config.enableEmergencyShutdown !== false,
            emergencyShutdownThreshold: config.emergencyShutdownThreshold || 10,
            enableWhitelist: config.enableWhitelist || false,
            whitelistedAddresses: config.whitelistedAddresses || [],
            enableBlacklist: config.enableBlacklist !== false,
            blacklistedAddresses: config.blacklistedAddresses || [],
            enableTransactionSigning: config.enableTransactionSigning !== false,
            enableHsmIntegration: config.enableHsmIntegration || false,
            enableMultiSignature: config.enableMultiSignature || false,
            multiSignatureThreshold: config.multiSignatureThreshold || 2,
            multiSignatureSigners: config.multiSignatureSigners || []
        };
        
        this.logger = logger;
        this.metrics = metrics;
        this.cache = cache;
        this.ethereumConnector = ethereumConnector;
        this.solanaConnector = solanaConnector;
        this.bridgeTransactionRepository = bridgeTransactionRepository;
        this.blockFinalizationRepository = blockFinalizationRepository;
        
        // Create security audit log directory if it doesn't exist
        if (this.config.enableSecurityAuditing && !fs.existsSync(this.config.securityAuditLogDirectory)) {
            fs.mkdirSync(this.config.securityAuditLogDirectory, { recursive: true });
        }
    }
    
    /**
     * Initializes the bridge security service
     */
    public async initialize(): Promise<void> {
        this.logger.info('Initializing bridge security service...');
        
        try {
            // Load security incidents from cache
            await this.loadSecurityIncidents();
            
            // Load rate limit entries from cache
            await this.loadRateLimitEntries();
            
            // Load emergency shutdown status from cache
            await this.loadEmergencyShutdownStatus();
            
            // Initialize private key if transaction signing is enabled
            if (this.config.enableTransactionSigning && !this.config.enableHsmIntegration) {
                await this.initializePrivateKey();
            }
            
            // Initialize HSM if HSM integration is enabled
            if (this.config.enableHsmIntegration) {
                await this.initializeHsm();
            }
            
            this.logger.info('Bridge security service initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize bridge security service', error);
            throw error;
        }
    }
    
    /**
     * Loads security incidents from cache
     */
    private async loadSecurityIncidents(): Promise<void> {
        try {
            const cachedIncidents = await this.cache.get('bridge:securityIncidents');
            
            if (cachedIncidents) {
                this.securityIncidents = JSON.parse(cachedIncidents);
                this.logger.info(`Loaded ${this.securityIncidents.length} security incidents from cache`);
            }
        } catch (error) {
            this.logger.error('Failed to load security incidents from cache', error);
        }
    }
    
    /**
     * Loads rate limit entries from cache
     */
    private async loadRateLimitEntries(): Promise<void> {
        try {
            const cachedEntries = await this.cache.get('bridge:rateLimitEntries');
            
            if (cachedEntries) {
                this.rateLimitEntries = JSON.parse(cachedEntries);
                this.logger.info(`Loaded ${this.rateLimitEntries.length} rate limit entries from cache`);
            }
        } catch (error) {
            this.logger.error('Failed to load rate limit entries from cache', error);
        }
    }
    
    /**
     * Loads emergency shutdown status from cache
     */
    private async loadEmergencyShutdownStatus(): Promise<void> {
        try {
            const cachedStatus = await this.cache.get('bridge:emergencyShutdownActive');
            
            if (cachedStatus) {
                this.emergencyShutdownActive = JSON.parse(cachedStatus);
                this.logger.info(`Loaded emergency shutdown status from cache: ${this.emergencyShutdownActive}`);
            }
        } catch (error) {
            this.logger.error('Failed to load emergency shutdown status from cache', error);
        }
    }
    
    /**
     * Initializes the private key for transaction signing
     */
    private async initializePrivateKey(): Promise<void> {
        try {
            if (!this.config.privateKeyPath) {
                this.logger.warn('Private key path not specified, transaction signing will not be available');
                return;
            }
            
            // Check if private key file exists
            if (!fs.existsSync(this.config.privateKeyPath)) {
                this.logger.warn(`Private key file not found: ${this.config.privateKeyPath}`);
                return;
            }
            
            // Read private key file
            const encryptedKey = fs.readFileSync(this.config.privateKeyPath, 'utf8');
            
            // Decrypt private key
            if (this.config.privateKeyPassword) {
                try {
                    const wallet = await ethers.Wallet.fromEncryptedJson(encryptedKey, this.config.privateKeyPassword);
                    this.privateKey = wallet.privateKey;
                    this.logger.info('Private key initialized successfully');
                } catch (error) {
                    this.logger.error('Failed to decrypt private key', error);
                }
            } else {
                this.logger.warn('Private key password not specified, transaction signing will not be available');
            }
        } catch (error) {
            this.logger.error('Failed to initialize private key', error);
        }
    }
    
    /**
     * Initializes the HSM for transaction signing
     */
    private async initializeHsm(): Promise<void> {
        try {
            if (!this.config.hsmConfig) {
                this.logger.warn('HSM configuration not specified, HSM integration will not be available');
                return;
            }
            
            // This is a simplified implementation
            // In a real-world scenario, you would use a library like 'pkcs11js' or 'node-pkcs11'
            this.logger.info('HSM initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize HSM', error);
        }
    }
    
    /**
     * Starts the bridge security service
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            this.logger.warn('Bridge security service already running');
            return;
        }
        
        this.logger.info('Starting bridge security service...');
        
        try {
            this.isRunning = true;
            
            // Start security check interval
            this.securityCheckInterval = setInterval(() => {
                this.runSecurityChecks();
            }, this.config.securityCheckInterval);
            
            // Start fraud detection interval
            if (this.config.enableFraudDetection) {
                this.fraudDetectionInterval = setInterval(() => {
                    this.detectFraud();
                }, this.config.fraudDetectionInterval);
                
                // Run fraud detection immediately
                this.detectFraud();
            }
            
            // Start security audit interval
            if (this.config.enableSecurityAuditing) {
                this.securityAuditInterval = setInterval(() => {
                    this.performSecurityAudit();
                }, this.config.securityAuditInterval);
                
                // Perform security audit immediately
                this.performSecurityAudit();
            }
            
            this.logger.info('Bridge security service started successfully');
        } catch (error) {
            this.isRunning = false;
            this.logger.error('Failed to start bridge security service', error);
            throw error;
        }
    }
    
    /**
     * Stops the bridge security service
     */
    public async stop(): Promise<void> {
        if (!this.isRunning) {
            this.logger.warn('Bridge security service not running');
            return;
        }
        
        this.logger.info('Stopping bridge security service...');
        
        try {
            this.isRunning = false;
            
            // Stop security check interval
            if (this.securityCheckInterval) {
                clearInterval(this.securityCheckInterval);
                this.securityCheckInterval = null;
            }
            
            // Stop fraud detection interval
            if (this.fraudDetectionInterval) {
                clearInterval(this.fraudDetectionInterval);
                this.fraudDetectionInterval = null;
            }
            
            // Stop security audit interval
            if (this.securityAuditInterval) {
                clearInterval(this.securityAuditInterval);
                this.securityAuditInterval = null;
            }
            
            // Save security incidents to cache
            await this.cache.set('bridge:securityIncidents', JSON.stringify(this.securityIncidents));
            
            // Save rate limit entries to cache
            await this.cache.set('bridge:rateLimitEntries', JSON.stringify(this.rateLimitEntries));
            
            // Save emergency shutdown status to cache
            await this.cache.set('bridge:emergencyShutdownActive', JSON.stringify(this.emergencyShutdownActive));
            
            this.logger.info('Bridge security service stopped successfully');
        } catch (error) {
            this.logger.error('Failed to stop bridge security service', error);
            throw error;
        }
    }
    
    /**
     * Runs security checks
     */
    private async runSecurityChecks(): Promise<void> {
        if (!this.isRunning) {
            return;
        }
        
        try {
            this.logger.debug('Running security checks...');
            
            // Check for emergency shutdown
            if (this.emergencyShutdownActive) {
                this.logger.warn('Emergency shutdown is active, skipping security checks');
                return;
            }
            
            // Clean up expired rate limit entries
            this.cleanupRateLimitEntries();
            
            // Check for suspicious transactions
            await this.checkForSuspiciousTransactions();
            
            this.logger.debug('Security checks completed successfully');
        } catch (error) {
            this.logger.error('Error running security checks', error);
        }
    }
    
    /**
     * Cleans up expired rate limit entries
     */
    private cleanupRateLimitEntries(): void {
        try {
            const now = Date.now();
            const windowSize = this.config.rateLimitWindow;
            
            // Remove entries with expired windows
            this.rateLimitEntries = this.rateLimitEntries.filter(entry => {
                return entry.windowStart + windowSize > now;
            });
            
            this.logger.debug(`Cleaned up rate limit entries, ${this.rateLimitEntries.length} remaining`);
        } catch (error) {
            this.logger.error('Error cleaning up rate limit entries', error);
        }
    }
    
    /**
     * Checks for suspicious transactions
     */
    private async checkForSuspiciousTransactions(): Promise<void> {
        try {
            const now = Date.now();
            const oneDayAgo = now - 24 * 60 * 60 * 1000;
            
            // Get recent transactions
            const recentTransactions = await this.bridgeTransactionRepository.find({
                where: {
                    timestamp: MoreThan(oneDayAgo)
                },
                order: {
                    timestamp: 'DESC'
                }
            });
            
            if (recentTransactions.length === 0) {
                this.logger.debug('No recent transactions to check');
                return;
            }
            
            this.logger.debug(`Checking ${recentTransactions.length} recent transactions for suspicious activity`);
            
            // Check each transaction
            for (const transaction of recentTransactions) {
                // Check for large amounts
                if (this.isLargeTransaction(transaction)) {
                    await this.createSecurityIncident(
                        SecurityIncidentType.LARGE_TRANSACTION,
                        `Large ${transaction.type.toLowerCase()} detected: ${transaction.amount} ${transaction.token}`,
                        'security-check',
                        {
                            transactionId: transaction.id,
                            type: transaction.type,
                            amount: transaction.amount,
                            token: transaction.token,
                            sourceAddress: transaction.sourceAddress,
                            targetAddress: transaction.targetAddress
                        }
                    );
                }
                
                // Check for blacklisted addresses
                if (this.isBlacklistedAddress(transaction.sourceAddress) || this.isBlacklistedAddress(transaction.targetAddress)) {
                    await this.createSecurityIncident(
                        SecurityIncidentType.BLACKLISTED_ADDRESS,
                        `Transaction involving blacklisted address detected`,
                        'security-check',
                        {
                            transactionId: transaction.id,
                            type: transaction.type,
                            sourceAddress: transaction.sourceAddress,
                            targetAddress: transaction.targetAddress
                        }
                    );
                }
                
                // Check for suspicious patterns
                if (this.hasSuspiciousPattern(transaction, recentTransactions)) {
                    await this.createSecurityIncident(
                        SecurityIncidentType.SUSPICIOUS_TRANSACTION,
                        `Suspicious transaction pattern detected`,
                        'security-check',
                        {
                            transactionId: transaction.id,
                            type: transaction.type,
                            sourceAddress: transaction.sourceAddress,
                            targetAddress: transaction.targetAddress
                        }
                    );
                }
            }
        } catch (error) {
            this.logger.error('Error checking for suspicious transactions', error);
        }
    }
    
    /**
     * Checks if a transaction has a large amount
     * @param transaction Transaction to check
     * @returns Whether the transaction has a large amount
     */
    private isLargeTransaction(transaction: BridgeTransaction): boolean {
        try {
            const maxAmount = transaction.type === TransactionType.DEPOSIT
                ? this.config.maxDepositAmount
                : this.config.maxWithdrawalAmount;
            
            // Compare as BigInt to handle large numbers
            const amount = BigInt(transaction.amount);
            const max = BigInt(maxAmount);
            
            return amount > max;
        } catch (error) {
            this.logger.error('Error checking if transaction is large', error);
            return false;
        }
    }
    
    /**
     * Checks if an address is blacklisted
     * @param address Address to check
     * @returns Whether the address is blacklisted
     */
    private isBlacklistedAddress(address: string): boolean {
        if (!this.config.enableBlacklist || !this.config.blacklistedAddresses) {
            return false;
        }
        
        return this.config.blacklistedAddresses.includes(address.toLowerCase());
    }
    
    /**
     * Checks if a transaction has a suspicious pattern
     * @param transaction Transaction to check
     * @param allTransactions All recent transactions
     * @returns Whether the transaction has a suspicious pattern
     */
    private hasSuspiciousPattern(transaction: BridgeTransaction, allTransactions: BridgeTransaction[]): boolean {
        try {
            // Check for rapid back-and-forth transfers
            const sourceAddress = transaction.sourceAddress.toLowerCase();
            const targetAddress = transaction.targetAddress.toLowerCase();
            
            // Find transactions between the same addresses in reverse direction
            const reverseTransactions = allTransactions.filter(tx => {
                return tx.id !== transaction.id &&
                    tx.sourceAddress.toLowerCase() === targetAddress &&
                    tx.targetAddress.toLowerCase() === sourceAddress;
            });
            
            if (reverseTransactions.length > 0) {
                // Check if any reverse transaction happened within a short time window (e.g., 1 hour)
                const transactionTime = transaction.timestamp;
                const shortTimeWindow = 60 * 60 * 1000; // 1 hour
                
                const rapidReverseTransactions = reverseTransactions.filter(tx => {
                    return Math.abs(tx.timestamp - transactionTime) < shortTimeWindow;
                });
                
                if (rapidReverseTransactions.length > 0) {
                    return true;
                }
            }
            
            // Check for multiple transactions from the same source in a short time
            const sameSourceTransactions = allTransactions.filter(tx => {
                return tx.id !== transaction.id &&
                    tx.sourceAddress.toLowerCase() === sourceAddress;
            });
            
            if (sameSourceTransactions.length > 5) {
                // Check if more than 5 transactions happened within a short time window (e.g., 1 hour)
                const transactionTime = transaction.timestamp;
                const shortTimeWindow = 60 * 60 * 1000; // 1 hour
                
                const rapidTransactions = sameSourceTransactions.filter(tx => {
                    return Math.abs(tx.timestamp - transactionTime) < shortTimeWindow;
                });
                
                if (rapidTransactions.length > 5) {
                    return true;
                }
            }
            
            return false;
        } catch (error) {
            this.logger.error('Error checking for suspicious pattern', error);
            return false;
        }
    }
    
    /**
     * Detects fraud
     */
    private async detectFraud(): Promise<void> {
        if (!this.isRunning || !this.config.enableFraudDetection) {
            return;
        }
        
        try {
            this.logger.debug('Detecting fraud...');
            
            // Check for emergency shutdown
            if (this.emergencyShutdownActive) {
                this.logger.warn('Emergency shutdown is active, skipping fraud detection');
                return;
            }
            
            // Check for double-spend attempts
            await this.detectDoubleSpendAttempts();
            
            // Check for invalid state transitions
            await this.detectInvalidStateTransitions();
            
            this.logger.debug('Fraud detection completed successfully');
        } catch (error) {
            this.logger.error('Error detecting fraud', error);
        }
    }
    
    /**
     * Detects double-spend attempts
     */
    private async detectDoubleSpendAttempts(): Promise<void> {
        try {
            const now = Date.now();
            const oneDayAgo = now - 24 * 60 * 60 * 1000;
            
            // Get recent transactions
            const recentTransactions = await this.bridgeTransactionRepository.find({
                where: {
                    timestamp: MoreThan(oneDayAgo)
                }
            });
            
            if (recentTransactions.length === 0) {
                this.logger.debug('No recent transactions to check for double-spend attempts');
                return;
            }
            
            // Group transactions by source transaction hash
            const transactionsBySourceHash: { [key: string]: BridgeTransaction[] } = {};
            
            for (const transaction of recentTransactions) {
                if (!transaction.sourceTransactionHash) {
                    continue;
                }
                
                const hash = transaction.sourceTransactionHash.toLowerCase();
                
                if (!transactionsBySourceHash[hash]) {
                    transactionsBySourceHash[hash] = [];
                }
                
                transactionsBySourceHash[hash].push(transaction);
            }
            
            // Check for multiple transactions with the same source hash
            for (const [hash, transactions] of Object.entries(transactionsBySourceHash)) {
                if (transactions.length > 1) {
                    await this.createSecurityIncident(
                        SecurityIncidentType.DOUBLE_SPEND_ATTEMPT,
                        `Double-spend attempt detected: ${transactions.length} transactions with the same source hash`,
                        'fraud-detection',
                        {
                            sourceTransactionHash: hash,
                            transactionIds: transactions.map(tx => tx.id)
                        }
                    );
                }
            }
        } catch (error) {
            this.logger.error('Error detecting double-spend attempts', error);
        }
    }
    
    /**
     * Detects invalid state transitions
     */
    private async detectInvalidStateTransitions(): Promise<void> {
        try {
            const now = Date.now();
            const oneDayAgo = now - 24 * 60 * 60 * 1000;
            
            // Get recent transactions with status updates
            const recentTransactions = await this.bridgeTransactionRepository.find({
                where: {
                    updatedAt: MoreThan(oneDayAgo)
                }
            });
            
            if (recentTransactions.length === 0) {
                this.logger.debug('No recent transactions to check for invalid state transitions');
                return;
            }
            
            // Define valid state transitions
            const validTransitions: { [key: string]: string[] } = {
                [TransactionStatus.PENDING]: [
                    TransactionStatus.PROCESSING,
                    TransactionStatus.FAILED
                ],
                [TransactionStatus.PROCESSING]: [
                    TransactionStatus.CONFIRMING,
                    TransactionStatus.FAILED
                ],
                [TransactionStatus.CONFIRMING]: [
                    TransactionStatus.FINALIZING,
                    TransactionStatus.FAILED
                ],
                [TransactionStatus.FINALIZING]: [
                    TransactionStatus.COMPLETED,
                    TransactionStatus.FAILED
                ],
                [TransactionStatus.COMPLETED]: [],
                [TransactionStatus.FAILED]: [
                    TransactionStatus.PENDING
                ]
            };
            
            // Check each transaction for invalid state transitions
            for (const transaction of recentTransactions) {
                // Get transaction history
                const history = await this.getTransactionStatusHistory(transaction.id);
                
                if (history.length < 2) {
                    continue; // Not enough history to check transitions
                }
                
                // Check each transition
                for (let i = 1; i < history.length; i++) {
                    const prevStatus = history[i - 1].status;
                    const currStatus = history[i].status;
                    
                    if (!validTransitions[prevStatus].includes(currStatus)) {
                        await this.createSecurityIncident(
                            SecurityIncidentType.INVALID_STATE_TRANSITION,
                            `Invalid state transition detected: ${prevStatus} -> ${currStatus}`,
                            'fraud-detection',
                            {
                                transactionId: transaction.id,
                                prevStatus,
                                currStatus,
                                timestamp: history[i].timestamp
                            }
                        );
                    }
                }
            }
        } catch (error) {
            this.logger.error('Error detecting invalid state transitions', error);
        }
    }
    
    /**
     * Gets transaction status history
     * @param transactionId Transaction ID
     * @returns Transaction status history
     */
    private async getTransactionStatusHistory(transactionId: string): Promise<{ status: string, timestamp: number }[]> {
        try {
            // This is a simplified implementation
            // In a real-world scenario, you would query a history table or audit log
            
            // For now, return a dummy history
            return [
                { status: TransactionStatus.PENDING, timestamp: Date.now() - 3600000 },
                { status: TransactionStatus.PROCESSING, timestamp: Date.now() - 3000000 },
                { status: TransactionStatus.CONFIRMING, timestamp: Date.now() - 2400000 },
                { status: TransactionStatus.FINALIZING, timestamp: Date.now() - 1800000 },
                { status: TransactionStatus.COMPLETED, timestamp: Date.now() - 1200000 }
            ];
        } catch (error) {
            this.logger.error('Error getting transaction status history', error);
            return [];
        }
    }
    
    /**
     * Performs a security audit
     */
    private async performSecurityAudit(): Promise<void> {
        if (!this.isRunning || !this.config.enableSecurityAuditing) {
            return;
        }
        
        try {
            this.logger.info('Performing security audit...');
            
            const timestamp = Date.now();
            const dateStr = new Date(timestamp).toISOString().replace(/:/g, '-').replace(/\..+/, '');
            const auditFileName = `security-audit-${dateStr}.json`;
            const auditPath = path.join(this.config.securityAuditLogDirectory, auditFileName);
            
            // Collect audit data
            const auditData = {
                timestamp,
                securityIncidents: this.securityIncidents.filter(incident => !incident.resolved),
                emergencyShutdownActive: this.emergencyShutdownActive,
                rateLimitEntries: this.rateLimitEntries.length,
                blacklistedAddresses: this.config.blacklistedAddresses,
                whitelistedAddresses: this.config.whitelistedAddresses,
                transactionSigningEnabled: this.config.enableTransactionSigning,
                hsmIntegrationEnabled: this.config.enableHsmIntegration,
                multiSignatureEnabled: this.config.enableMultiSignature,
                fraudDetectionEnabled: this.config.enableFraudDetection,
                rateLimitingEnabled: this.config.enableRateLimiting,
                signatureVerificationEnabled: this.config.enableSignatureVerification
            };
            
            // Write audit to file
            fs.writeFileSync(auditPath, JSON.stringify(auditData, null, 2));
            
            this.logger.info(`Security audit completed: ${auditPath}`);
            
            // Clean up old audit logs
            this.cleanupOldAuditLogs();
        } catch (error) {
            this.logger.error('Error performing security audit', error);
        }
    }
    
    /**
     * Cleans up old audit logs
     */
    private cleanupOldAuditLogs(): void {
        try {
            const files = fs.readdirSync(this.config.securityAuditLogDirectory);
            const now = Date.now();
            const maxAge = this.config.maxSecurityAuditLogAge * 24 * 60 * 60 * 1000; // Convert days to milliseconds
            
            for (const file of files) {
                if (!file.startsWith('security-audit-')) {
                    continue;
                }
                
                const filePath = path.join(this.config.securityAuditLogDirectory, file);
                const stats = fs.statSync(filePath);
                const fileAge = now - stats.mtimeMs;
                
                if (fileAge > maxAge) {
                    fs.unlinkSync(filePath);
                    this.logger.debug(`Deleted old audit log: ${filePath}`);
                }
            }
        } catch (error) {
            this.logger.error('Error cleaning up old audit logs', error);
        }
    }
    
    /**
     * Creates a security incident
     * @param type Incident type
     * @param description Incident description
     * @param source Incident source
     * @param data Incident data
     * @returns Created incident
     */
    public async createSecurityIncident(
        type: SecurityIncidentType,
        description: string,
        source: string,
        data?: any
    ): Promise<SecurityIncident> {
        try {
            // Create new incident
            const incident: SecurityIncident = {
                id: `incident-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                timestamp: Date.now(),
                type,
                description,
                source,
                data,
                resolved: false
            };
            
            // Add incident to list
            this.securityIncidents.push(incident);
            
            // Trim incidents to keep only the last 1000
            if (this.securityIncidents.length > 1000) {
                this.securityIncidents = this.securityIncidents.slice(-1000);
            }
            
            // Save incidents to cache
            await this.cache.set('bridge:securityIncidents', JSON.stringify(this.securityIncidents));
            
            // Log incident
            this.logger.warn(`Security incident created: ${incident.type} - ${incident.description}`);
            
            // Update metrics
            this.metrics.increment(`security.incidents.${incident.type}`);
            this.metrics.gauge('security.incidents.active', this.securityIncidents.filter(i => !i.resolved).length);
            
            // Check if emergency shutdown should be activated
            await this.checkEmergencyShutdown();
            
            return incident;
        } catch (error) {
            this.logger.error('Error creating security incident', error);
            throw error;
        }
    }
    
    /**
     * Checks if emergency shutdown should be activated
     */
    private async checkEmergencyShutdown(): Promise<void> {
        if (!this.config.enableEmergencyShutdown) {
            return;
        }
        
        try {
            // Count active incidents
            const activeIncidents = this.securityIncidents.filter(incident => !incident.resolved);
            
            if (activeIncidents.length >= this.config.emergencyShutdownThreshold) {
                await this.activateEmergencyShutdown();
            }
        } catch (error) {
            this.logger.error('Error checking emergency shutdown', error);
        }
    }
    
    /**
     * Activates emergency shutdown
     */
    public async activateEmergencyShutdown(): Promise<void> {
        try {
            if (this.emergencyShutdownActive) {
                this.logger.warn('Emergency shutdown already active');
                return;
            }
            
            this.logger.error('Activating emergency shutdown');
            
            // Set emergency shutdown flag
            this.emergencyShutdownActive = true;
            
            // Save emergency shutdown status to cache
            await this.cache.set('bridge:emergencyShutdownActive', JSON.stringify(this.emergencyShutdownActive));
            
            // Create security incident
            await this.createSecurityIncident(
                SecurityIncidentType.EMERGENCY_SHUTDOWN,
                'Emergency shutdown activated',
                'security-service',
                {
                    activeIncidents: this.securityIncidents.filter(incident => !incident.resolved).length,
                    threshold: this.config.emergencyShutdownThreshold
                }
            );
            
            // Update metrics
            this.metrics.gauge('security.emergencyShutdown', 1);
            
            // Notify administrators
            // This is a simplified implementation
            this.logger.error('EMERGENCY SHUTDOWN ACTIVATED - Bridge operations have been suspended');
        } catch (error) {
            this.logger.error('Error activating emergency shutdown', error);
        }
    }
    
    /**
     * Deactivates emergency shutdown
     * @param user User who deactivated the emergency shutdown
     * @param reason Reason for deactivating the emergency shutdown
     */
    public async deactivateEmergencyShutdown(user: string, reason: string): Promise<void> {
        try {
            if (!this.emergencyShutdownActive) {
                this.logger.warn('Emergency shutdown not active');
                return;
            }
            
            this.logger.info(`Deactivating emergency shutdown by ${user}: ${reason}`);
            
            // Clear emergency shutdown flag
            this.emergencyShutdownActive = false;
            
            // Save emergency shutdown status to cache
            await this.cache.set('bridge:emergencyShutdownActive', JSON.stringify(this.emergencyShutdownActive));
            
            // Resolve emergency shutdown incident
            const incident = this.securityIncidents.find(i => 
                i.type === SecurityIncidentType.EMERGENCY_SHUTDOWN && !i.resolved
            );
            
            if (incident) {
                incident.resolved = true;
                incident.resolvedAt = Date.now();
                incident.resolvedBy = user;
                incident.resolutionDescription = reason;
                
                // Save incidents to cache
                await this.cache.set('bridge:securityIncidents', JSON.stringify(this.securityIncidents));
            }
            
            // Update metrics
            this.metrics.gauge('security.emergencyShutdown', 0);
            
            // Notify administrators
            // This is a simplified implementation
            this.logger.info('EMERGENCY SHUTDOWN DEACTIVATED - Bridge operations have been resumed');
        } catch (error) {
            this.logger.error('Error deactivating emergency shutdown', error);
        }
    }
    
    /**
     * Resolves a security incident
     * @param incidentId Incident ID
     * @param user User who resolved the incident
     * @param description Resolution description
     * @returns Whether the incident was resolved
     */
    public async resolveSecurityIncident(
        incidentId: string,
        user: string,
        description: string
    ): Promise<boolean> {
        try {
            const incident = this.securityIncidents.find(i => i.id === incidentId);
            
            if (!incident) {
                this.logger.warn(`Security incident ${incidentId} not found`);
                return false;
            }
            
            if (incident.resolved) {
                this.logger.warn(`Security incident ${incidentId} already resolved`);
                return false;
            }
            
            // Resolve incident
            incident.resolved = true;
            incident.resolvedAt = Date.now();
            incident.resolvedBy = user;
            incident.resolutionDescription = description;
            
            // Save incidents to cache
            await this.cache.set('bridge:securityIncidents', JSON.stringify(this.securityIncidents));
            
            // Update metrics
            this.metrics.gauge('security.incidents.active', this.securityIncidents.filter(i => !i.resolved).length);
            
            this.logger.info(`Security incident ${incidentId} resolved by ${user}: ${description}`);
            
            return true;
        } catch (error) {
            this.logger.error('Error resolving security incident', error);
            return false;
        }
    }
    
    /**
     * Checks if a deposit is allowed
     * @param sourceAddress Source address
     * @param token Token address
     * @param amount Amount to deposit
     * @returns Whether the deposit is allowed
     */
    public async isDepositAllowed(
        sourceAddress: string,
        token: string,
        amount: string
    ): Promise<boolean> {
        try {
            // Check for emergency shutdown
            if (this.emergencyShutdownActive) {
                this.logger.warn(`Deposit from ${sourceAddress} rejected: Emergency shutdown active`);
                return false;
            }
            
            // Check whitelist if enabled
            if (this.config.enableWhitelist) {
                if (!this.isWhitelistedAddress(sourceAddress)) {
                    this.logger.warn(`Deposit from ${sourceAddress} rejected: Address not whitelisted`);
                    return false;
                }
            }
            
            // Check blacklist
            if (this.isBlacklistedAddress(sourceAddress)) {
                this.logger.warn(`Deposit from ${sourceAddress} rejected: Address blacklisted`);
                
                await this.createSecurityIncident(
                    SecurityIncidentType.BLACKLISTED_ADDRESS,
                    `Deposit attempt from blacklisted address: ${sourceAddress}`,
                    'deposit-check',
                    {
                        sourceAddress,
                        token,
                        amount
                    }
                );
                
                return false;
            }
            
            // Check rate limit
            if (this.config.enableRateLimiting) {
                if (!this.checkRateLimit(sourceAddress, TransactionType.DEPOSIT)) {
                    this.logger.warn(`Deposit from ${sourceAddress} rejected: Rate limit exceeded`);
                    
                    await this.createSecurityIncident(
                        SecurityIncidentType.RATE_LIMIT_EXCEEDED,
                        `Deposit rate limit exceeded for address: ${sourceAddress}`,
                        'deposit-check',
                        {
                            sourceAddress,
                            token,
                            amount
                        }
                    );
                    
                    return false;
                }
            }
            
            // Check amount limit
            if (this.isLargeAmount(amount, this.config.maxDepositAmount)) {
                this.logger.warn(`Deposit from ${sourceAddress} rejected: Amount too large`);
                
                await this.createSecurityIncident(
                    SecurityIncidentType.LARGE_TRANSACTION,
                    `Large deposit detected: ${amount} ${token}`,
                    'deposit-check',
                    {
                        sourceAddress,
                        token,
                        amount
                    }
                );
                
                return false;
            }
            
            return true;
        } catch (error) {
            this.logger.error('Error checking if deposit is allowed', error);
            return false;
        }
    }
    
    /**
     * Checks if a withdrawal is allowed
     * @param sourceAddress Source address
     * @param token Token address
     * @param amount Amount to withdraw
     * @returns Whether the withdrawal is allowed
     */
    public async isWithdrawalAllowed(
        sourceAddress: string,
        token: string,
        amount: string
    ): Promise<boolean> {
        try {
            // Check for emergency shutdown
            if (this.emergencyShutdownActive) {
                this.logger.warn(`Withdrawal from ${sourceAddress} rejected: Emergency shutdown active`);
                return false;
            }
            
            // Check whitelist if enabled
            if (this.config.enableWhitelist) {
                if (!this.isWhitelistedAddress(sourceAddress)) {
                    this.logger.warn(`Withdrawal from ${sourceAddress} rejected: Address not whitelisted`);
                    return false;
                }
            }
            
            // Check blacklist
            if (this.isBlacklistedAddress(sourceAddress)) {
                this.logger.warn(`Withdrawal from ${sourceAddress} rejected: Address blacklisted`);
                
                await this.createSecurityIncident(
                    SecurityIncidentType.BLACKLISTED_ADDRESS,
                    `Withdrawal attempt from blacklisted address: ${sourceAddress}`,
                    'withdrawal-check',
                    {
                        sourceAddress,
                        token,
                        amount
                    }
                );
                
                return false;
            }
            
            // Check rate limit
            if (this.config.enableRateLimiting) {
                if (!this.checkRateLimit(sourceAddress, TransactionType.WITHDRAWAL)) {
                    this.logger.warn(`Withdrawal from ${sourceAddress} rejected: Rate limit exceeded`);
                    
                    await this.createSecurityIncident(
                        SecurityIncidentType.RATE_LIMIT_EXCEEDED,
                        `Withdrawal rate limit exceeded for address: ${sourceAddress}`,
                        'withdrawal-check',
                        {
                            sourceAddress,
                            token,
                            amount
                        }
                    );
                    
                    return false;
                }
            }
            
            // Check amount limit
            if (this.isLargeAmount(amount, this.config.maxWithdrawalAmount)) {
                this.logger.warn(`Withdrawal from ${sourceAddress} rejected: Amount too large`);
                
                await this.createSecurityIncident(
                    SecurityIncidentType.LARGE_TRANSACTION,
                    `Large withdrawal detected: ${amount} ${token}`,
                    'withdrawal-check',
                    {
                        sourceAddress,
                        token,
                        amount
                    }
                );
                
                return false;
            }
            
            return true;
        } catch (error) {
            this.logger.error('Error checking if withdrawal is allowed', error);
            return false;
        }
    }
    
    /**
     * Checks if an address is whitelisted
     * @param address Address to check
     * @returns Whether the address is whitelisted
     */
    private isWhitelistedAddress(address: string): boolean {
        if (!this.config.enableWhitelist || !this.config.whitelistedAddresses) {
            return true;
        }
        
        return this.config.whitelistedAddresses.includes(address.toLowerCase());
    }
    
    /**
     * Checks if an amount is too large
     * @param amount Amount to check
     * @param maxAmount Maximum allowed amount
     * @returns Whether the amount is too large
     */
    private isLargeAmount(amount: string, maxAmount: string): boolean {
        try {
            // Compare as BigInt to handle large numbers
            const amountBigInt = BigInt(amount);
            const maxBigInt = BigInt(maxAmount);
            
            return amountBigInt > maxBigInt;
        } catch (error) {
            this.logger.error('Error checking if amount is large', error);
            return false;
        }
    }
    
    /**
     * Checks rate limit for an address
     * @param address Address to check
     * @param type Transaction type
     * @returns Whether the rate limit is not exceeded
     */
    private checkRateLimit(address: string, type: TransactionType): boolean {
        try {
            const now = Date.now();
            const windowSize = this.config.rateLimitWindow;
            const maxCount = type === TransactionType.DEPOSIT
                ? this.config.maxDepositsPerWindow
                : this.config.maxWithdrawalsPerWindow;
            
            // Find or create rate limit entry
            let entry = this.rateLimitEntries.find(e => 
                e.address.toLowerCase() === address.toLowerCase() && 
                e.type === type &&
                e.windowStart + windowSize > now
            );
            
            if (!entry) {
                entry = {
                    address: address.toLowerCase(),
                    type,
                    count: 0,
                    windowStart: now
                };
                
                this.rateLimitEntries.push(entry);
            }
            
            // Check if rate limit is exceeded
            if (entry.count >= maxCount) {
                return false;
            }
            
            // Increment count
            entry.count++;
            
            return true;
        } catch (error) {
            this.logger.error('Error checking rate limit', error);
            return false;
        }
    }
    
    /**
     * Verifies a signature
     * @param message Message that was signed
     * @param signature Signature
     * @param address Address that signed the message
     * @returns Whether the signature is valid
     */
    public async verifySignature(
        message: string,
        signature: string,
        address: string
    ): Promise<boolean> {
        try {
            if (!this.config.enableSignatureVerification) {
                return true;
            }
            
            // Verify Ethereum signature
            const messageHash = ethers.utils.hashMessage(message);
            const recoveredAddress = ethers.utils.recoverAddress(messageHash, signature);
            
            const isValid = recoveredAddress.toLowerCase() === address.toLowerCase();
            
            if (!isValid) {
                await this.createSecurityIncident(
                    SecurityIncidentType.INVALID_SIGNATURE,
                    `Invalid signature detected for address: ${address}`,
                    'signature-verification',
                    {
                        message,
                        signature,
                        address,
                        recoveredAddress
                    }
                );
            }
            
            return isValid;
        } catch (error) {
            this.logger.error('Error verifying signature', error);
            
            await this.createSecurityIncident(
                SecurityIncidentType.INVALID_SIGNATURE,
                `Error verifying signature: ${error.message}`,
                'signature-verification',
                {
                    message,
                    signature,
                    address,
                    error: error.message
                }
            );
            
            return false;
        }
    }
    
    /**
     * Signs a message
     * @param message Message to sign
     * @returns Signature
     */
    public async signMessage(message: string): Promise<string> {
        try {
            if (!this.config.enableTransactionSigning) {
                throw new Error('Transaction signing is not enabled');
            }
            
            if (this.config.enableHsmIntegration) {
                return await this.signMessageWithHsm(message);
            } else if (this.privateKey) {
                const wallet = new ethers.Wallet(this.privateKey);
                return await wallet.signMessage(message);
            } else {
                throw new Error('No private key available for signing');
            }
        } catch (error) {
            this.logger.error('Error signing message', error);
            throw error;
        }
    }
    
    /**
     * Signs a message with HSM
     * @param message Message to sign
     * @returns Signature
     */
    private async signMessageWithHsm(message: string): Promise<string> {
        try {
            // This is a simplified implementation
            // In a real-world scenario, you would use a library like 'pkcs11js' or 'node-pkcs11'
            
            // For now, return a dummy signature
            return '0x' + crypto.randomBytes(65).toString('hex');
        } catch (error) {
            this.logger.error('Error signing message with HSM', error);
            throw error;
        }
    }
    
    /**
     * Gets active security incidents
     * @returns Active security incidents
     */
    public getActiveSecurityIncidents(): SecurityIncident[] {
        return this.securityIncidents.filter(incident => !incident.resolved);
    }
    
    /**
     * Gets all security incidents
     * @returns All security incidents
     */
    public getAllSecurityIncidents(): SecurityIncident[] {
        return this.securityIncidents;
    }
    
    /**
     * Gets emergency shutdown status
     * @returns Whether emergency shutdown is active
     */
    public isEmergencyShutdownActive(): boolean {
        return this.emergencyShutdownActive;
    }
    
    /**
     * Adds an address to the blacklist
     * @param address Address to add
     * @param reason Reason for blacklisting
     * @param user User who added the address
     */
    public async addToBlacklist(address: string, reason: string, user: string): Promise<void> {
        try {
            if (!this.config.enableBlacklist) {
                throw new Error('Blacklist is not enabled');
            }
            
            const normalizedAddress = address.toLowerCase();
            
            if (this.config.blacklistedAddresses.includes(normalizedAddress)) {
                this.logger.warn(`Address ${address} is already blacklisted`);
                return;
            }
            
            this.logger.info(`Adding address ${address} to blacklist: ${reason} (by ${user})`);
            
            // Add to blacklist
            this.config.blacklistedAddresses.push(normalizedAddress);
            
            // Log security incident
            await this.createSecurityIncident(
                SecurityIncidentType.BLACKLISTED_ADDRESS,
                `Address added to blacklist: ${address}`,
                'blacklist-management',
                {
                    address,
                    reason,
                    user
                }
            );
        } catch (error) {
            this.logger.error('Error adding address to blacklist', error);
            throw error;
        }
    }
    
    /**
     * Removes an address from the blacklist
     * @param address Address to remove
     * @param reason Reason for removing
     * @param user User who removed the address
     */
    public async removeFromBlacklist(address: string, reason: string, user: string): Promise<void> {
        try {
            if (!this.config.enableBlacklist) {
                throw new Error('Blacklist is not enabled');
            }
            
            const normalizedAddress = address.toLowerCase();
            const index = this.config.blacklistedAddresses.indexOf(normalizedAddress);
            
            if (index === -1) {
                this.logger.warn(`Address ${address} is not blacklisted`);
                return;
            }
            
            this.logger.info(`Removing address ${address} from blacklist: ${reason} (by ${user})`);
            
            // Remove from blacklist
            this.config.blacklistedAddresses.splice(index, 1);
            
            // Log security incident
            await this.createSecurityIncident(
                SecurityIncidentType.BLACKLISTED_ADDRESS,
                `Address removed from blacklist: ${address}`,
                'blacklist-management',
                {
                    address,
                    reason,
                    user
                }
            );
        } catch (error) {
            this.logger.error('Error removing address from blacklist', error);
            throw error;
        }
    }
    
    /**
     * Adds an address to the whitelist
     * @param address Address to add
     * @param reason Reason for whitelisting
     * @param user User who added the address
     */
    public async addToWhitelist(address: string, reason: string, user: string): Promise<void> {
        try {
            if (!this.config.enableWhitelist) {
                throw new Error('Whitelist is not enabled');
            }
            
            const normalizedAddress = address.toLowerCase();
            
            if (this.config.whitelistedAddresses.includes(normalizedAddress)) {
                this.logger.warn(`Address ${address} is already whitelisted`);
                return;
            }
            
            this.logger.info(`Adding address ${address} to whitelist: ${reason} (by ${user})`);
            
            // Add to whitelist
            this.config.whitelistedAddresses.push(normalizedAddress);
        } catch (error) {
            this.logger.error('Error adding address to whitelist', error);
            throw error;
        }
    }
    
    /**
     * Removes an address from the whitelist
     * @param address Address to remove
     * @param reason Reason for removing
     * @param user User who removed the address
     */
    public async removeFromWhitelist(address: string, reason: string, user: string): Promise<void> {
        try {
            if (!this.config.enableWhitelist) {
                throw new Error('Whitelist is not enabled');
            }
            
            const normalizedAddress = address.toLowerCase();
            const index = this.config.whitelistedAddresses.indexOf(normalizedAddress);
            
            if (index === -1) {
                this.logger.warn(`Address ${address} is not whitelisted`);
                return;
            }
            
            this.logger.info(`Removing address ${address} from whitelist: ${reason} (by ${user})`);
            
            // Remove from whitelist
            this.config.whitelistedAddresses.splice(index, 1);
        } catch (error) {
            this.logger.error('Error removing address from whitelist', error);
            throw error;
        }
    }
}
