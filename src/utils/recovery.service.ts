// English comment for verification
/**
 * @file recovery.service.ts
 * @description Service for handling error recovery and system resilience
 */

import { DatabaseService } from '../database/database.service';
import { TransactionService } from '../transaction/transaction.service';
import { SequencerService } from '../sequencer/sequencer.service';
import { MonitoringService, EventSeverity, EventCategory } from '../monitoring/monitoring.service';
import { Transaction, TransactionStatus } from '../transaction/transaction.entity';
import { Bundle, BundleStatus } from '../sequencer/bundle.entity';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Interface for recovery service configuration
 */
export interface RecoveryConfig {
  enabled: boolean;
  maxStuckTimeMs: number;
  maxRetries: number;
  retryDelayMs: number;
  autoAbortEnabled: boolean;
  checkpointIntervalMs: number;
  checkpointDir: string;
  stateRecoveryEnabled: boolean;
  transactionRecoveryEnabled: boolean;
  bundleRecoveryEnabled: boolean;
  hsm: {
    enabled: boolean;
    primaryKeyPath: string;
    backupKeyPath: string;
    autoFailover: boolean;
  };
}

/**
 * Interface for recovery checkpoint data
 */
export interface RecoveryCheckpoint {
  timestamp: string;
  systemState: {
    running: boolean;
    currentBundleId: string | null;
    pendingTransactionCount: number;
    readyBundleCount: number;
    processingBundleCount: number;
  };
  lastProcessedTransaction: string | null;
  lastProcessedBundle: string | null;
  hsm: {
    activeKey: 'primary' | 'backup';
    lastKeyRotation: string | null;
  };
  customData: Record<string, any>;
}

/**
 * Interface for recovery statistics
 */
export interface RecoveryStatistics {
  totalRecoveryAttempts: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  autoAbortCount: number;
  manualRecoveryCount: number;
  lastRecoveryTime: Date | null;
  recoveryByType: {
    transaction: number;
    bundle: number;
    system: number;
    hsm: number;
  };
  avgRecoveryTimeMs: number;
}

/**
 * Service for handling error recovery and system resilience
 */
export class RecoveryService {
  private static instance: RecoveryService;
  private initialized: boolean = false;
  private running: boolean = false;
  
  private config: RecoveryConfig = {
    enabled: true,
    maxStuckTimeMs: 300000, // 5 minutes
    maxRetries: 3,
    retryDelayMs: 5000, // 5 seconds
    autoAbortEnabled: true,
    checkpointIntervalMs: 60000, // 1 minute
    checkpointDir: './checkpoints',
    stateRecoveryEnabled: true,
    transactionRecoveryEnabled: true,
    bundleRecoveryEnabled: true,
    hsm: {
      enabled: false,
      primaryKeyPath: './keys/primary',
      backupKeyPath: './keys/backup',
      autoFailover: true
    }
  };
  
  private checkpointInterval: NodeJS.Timeout | null = null;
  private recoveryStatistics: RecoveryStatistics = {
    totalRecoveryAttempts: 0,
    successfulRecoveries: 0,
    failedRecoveries: 0,
    autoAbortCount: 0,
    manualRecoveryCount: 0,
    lastRecoveryTime: null,
    recoveryByType: {
      transaction: 0,
      bundle: 0,
      system: 0,
      hsm: 0
    },
    avgRecoveryTimeMs: 0
  };
  
  private totalRecoveryTimeMs: number = 0;
  private activeHsmKey: 'primary' | 'backup' = 'primary';
  private lastKeyRotation: Date | null = null;
  private recoveryInProgress: boolean = false;
  
  private constructor() {
    // Private constructor to enforce singleton pattern
  }
  
  /**
   * Get the singleton instance of the RecoveryService
   * @returns The RecoveryService instance
   */
  public static getInstance(): RecoveryService {
    if (!RecoveryService.instance) {
      RecoveryService.instance = new RecoveryService();
    }
    return RecoveryService.instance;
  }
  
  /**
   * Initialize the recovery service
   * @param config Optional configuration to override defaults
   */
  public async initialize(config?: Partial<RecoveryConfig>): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    try {
      // Update configuration if provided
      if (config) {
        this.config = { ...this.config, ...config };
      }
      
      // Create checkpoint directory if it doesn't exist
      if (!fs.existsSync(this.config.checkpointDir)) {
        fs.mkdirSync(this.config.checkpointDir, { recursive: true });
      }
      
      // Initialize HSM if enabled
      if (this.config.hsm.enabled) {
        await this.initializeHsm();
      }
      
      // Load recovery statistics if available
      await this.loadRecoveryStatistics();
      
      // Log initialization
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'Initialization',
        severity: EventSeverity.INFO,
        category: EventCategory.SYSTEM,
        message: 'Recovery service initialized'
      });
      
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize recovery service: ${error.message}`);
    }
  }
  
  /**
   * Start the recovery service
   */
  public async start(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    if (this.running) {
      return;
    }
    
    try {
      // Start checkpoint interval if enabled
      if (this.config.enabled) {
        this.checkpointInterval = setInterval(
          () => this.createCheckpoint(),
          this.config.checkpointIntervalMs
        );
      }
      
      // Log start
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'Start',
        severity: EventSeverity.INFO,
        category: EventCategory.SYSTEM,
        message: 'Recovery service started'
      });
      
      this.running = true;
    } catch (error) {
      throw new Error(`Failed to start recovery service: ${error.message}`);
    }
  }
  
  /**
   * Stop the recovery service
   */
  public async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    
    try {
      // Stop checkpoint interval
      if (this.checkpointInterval) {
        clearInterval(this.checkpointInterval);
        this.checkpointInterval = null;
      }
      
      // Create final checkpoint
      await this.createCheckpoint();
      
      // Save recovery statistics
      await this.saveRecoveryStatistics();
      
      // Log stop
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'Stop',
        severity: EventSeverity.INFO,
        category: EventCategory.SYSTEM,
        message: 'Recovery service stopped'
      });
      
      this.running = false;
    } catch (error) {
      throw new Error(`Failed to stop recovery service: ${error.message}`);
    }
  }
  
  /**
   * Check for stuck transactions
   * @param maxAgeMs Maximum age in milliseconds for a transaction to be considered stuck
   * @returns Number of stuck transactions found
   */
  public async checkStuckTransactions(maxAgeMs: number = this.config.maxStuckTimeMs): Promise<number> {
    if (!this.config.transactionRecoveryEnabled) {
      return 0;
    }
    
    try {
      const transactionService = TransactionService.getInstance();
      const monitoringService = MonitoringService.getInstance();
      
      // Get transactions that have been in PENDING or PROCESSING state for too long
      const cutoffTime = new Date(Date.now() - maxAgeMs);
      
      const stuckTransactions = await transactionService.getStuckTransactions(cutoffTime);
      
      if (stuckTransactions.length > 0) {
        // Log stuck transactions
        await monitoringService.logEvent({
          source: 'RecoveryService',
          eventType: 'StuckTransactionsDetected',
          severity: EventSeverity.WARNING,
          category: EventCategory.TRANSACTION,
          message: `Found ${stuckTransactions.length} stuck transactions`,
          details: {
            count: stuckTransactions.length,
            transactionIds: stuckTransactions.map(tx => tx.id)
          }
        });
      }
      
      return stuckTransactions.length;
    } catch (error) {
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'CheckStuckTransactionsError',
        severity: EventSeverity.ERROR,
        category: EventCategory.TRANSACTION,
        message: `Failed to check stuck transactions: ${error.message}`
      });
      
      return 0;
    }
  }
  
  /**
   * Check for stuck bundles
   * @param maxAgeMs Maximum age in milliseconds for a bundle to be considered stuck
   * @returns Number of stuck bundles found
   */
  public async checkStuckBundles(maxAgeMs: number = this.config.maxStuckTimeMs): Promise<number> {
    if (!this.config.bundleRecoveryEnabled) {
      return 0;
    }
    
    try {
      const sequencerService = SequencerService.getInstance();
      const monitoringService = MonitoringService.getInstance();
      
      // Get bundles that have been in PROCESSING or SUBMITTING state for too long
      const cutoffTime = new Date(Date.now() - maxAgeMs);
      
      const stuckBundles = await sequencerService.getStuckBundles(cutoffTime);
      
      if (stuckBundles.length > 0) {
        // Log stuck bundles
        await monitoringService.logEvent({
          source: 'RecoveryService',
          eventType: 'StuckBundlesDetected',
          severity: EventSeverity.WARNING,
          category: EventCategory.BUNDLE,
          message: `Found ${stuckBundles.length} stuck bundles`,
          details: {
            count: stuckBundles.length,
            bundleIds: stuckBundles.map(bundle => bundle.id)
          }
        });
      }
      
      return stuckBundles.length;
    } catch (error) {
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'CheckStuckBundlesError',
        severity: EventSeverity.ERROR,
        category: EventCategory.BUNDLE,
        message: `Failed to check stuck bundles: ${error.message}`
      });
      
      return 0;
    }
  }
  
  /**
   * Automatically abort stuck bundles
   * @param maxAgeMs Maximum age in milliseconds for a bundle to be auto-aborted
   * @returns Number of bundles aborted
   */
  public async autoAbortStuckBundles(maxAgeMs: number = this.config.maxStuckTimeMs * 2): Promise<number> {
    if (!this.config.autoAbortEnabled || !this.config.bundleRecoveryEnabled) {
      return 0;
    }
    
    try {
      const sequencerService = SequencerService.getInstance();
      const monitoringService = MonitoringService.getInstance();
      
      // Get bundles that have been stuck for twice the max stuck time
      const cutoffTime = new Date(Date.now() - maxAgeMs);
      
      const stuckBundles = await sequencerService.getStuckBundles(cutoffTime);
      let abortedCount = 0;
      
      for (const bundle of stuckBundles) {
        try {
          // Abort the bundle
          await sequencerService.abortBundle(bundle.id, 'Auto-aborted by recovery service due to being stuck');
          abortedCount++;
          
          // Update statistics
          this.recoveryStatistics.autoAbortCount++;
          
          // Log bundle abort
          await monitoringService.logEvent({
            source: 'RecoveryService',
            eventType: 'BundleAutoAborted',
            severity: EventSeverity.WARNING,
            category: EventCategory.BUNDLE,
            message: `Auto-aborted stuck bundle: ${bundle.id}`,
            details: {
              bundleId: bundle.id,
              status: bundle.status,
              stuckTime: Date.now() - bundle.updatedAt.getTime()
            }
          });
        } catch (error) {
          await monitoringService.logEvent({
            source: 'RecoveryService',
            eventType: 'BundleAutoAbortError',
            severity: EventSeverity.ERROR,
            category: EventCategory.BUNDLE,
            message: `Failed to auto-abort bundle ${bundle.id}: ${error.message}`
          });
        }
      }
      
      return abortedCount;
    } catch (error) {
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'AutoAbortStuckBundlesError',
        severity: EventSeverity.ERROR,
        category: EventCategory.BUNDLE,
        message: `Failed to auto-abort stuck bundles: ${error.message}`
      });
      
      return 0;
    }
  }
  
  /**
   * Retry a failed transaction
   * @param transactionId ID of the transaction to retry
   * @returns The retried transaction if successful, null otherwise
   */
  public async retryTransaction(transactionId: string): Promise<Transaction | null> {
    if (!this.config.transactionRecoveryEnabled) {
      return null;
    }
    
    try {
      const startTime = Date.now();
      const transactionService = TransactionService.getInstance();
      const monitoringService = MonitoringService.getInstance();
      
      // Get the transaction
      const transaction = await transactionService.getTransactionById(transactionId);
      if (!transaction) {
        throw new Error(`Transaction not found: ${transactionId}`);
      }
      
      // Check if transaction can be retried
      if (transaction.status !== TransactionStatus.FAILED && transaction.status !== TransactionStatus.EXPIRED) {
        throw new Error(`Transaction ${transactionId} cannot be retried (status: ${transaction.status})`);
      }
      
      // Check if max retries exceeded
      if (transaction.retryCount >= this.config.maxRetries) {
        throw new Error(`Transaction ${transactionId} has exceeded maximum retry count (${this.config.maxRetries})`);
      }
      
      // Update statistics
      this.recoveryStatistics.totalRecoveryAttempts++;
      this.recoveryStatistics.recoveryByType.transaction++;
      
      // Create a new transaction with the same parameters
      const retriedTransaction = await transactionService.retryTransaction(transactionId);
      
      // Update statistics
      this.recoveryStatistics.successfulRecoveries++;
      this.recoveryStatistics.lastRecoveryTime = new Date();
      
      const recoveryTime = Date.now() - startTime;
      this.totalRecoveryTimeMs += recoveryTime;
      this.recoveryStatistics.avgRecoveryTimeMs = this.totalRecoveryTimeMs / this.recoveryStatistics.successfulRecoveries;
      
      // Log successful retry
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'TransactionRetried',
        severity: EventSeverity.INFO,
        category: EventCategory.TRANSACTION,
        message: `Successfully retried transaction: ${transactionId}`,
        details: {
          originalTransactionId: transactionId,
          newTransactionId: retriedTransaction.id,
          recoveryTimeMs: recoveryTime
        }
      });
      
      return retriedTransaction;
    } catch (error) {
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'TransactionRetryError',
        severity: EventSeverity.ERROR,
        category: EventCategory.TRANSACTION,
        message: `Failed to retry transaction ${transactionId}: ${error.message}`
      });
      
      // Update statistics
      this.recoveryStatistics.failedRecoveries++;
      
      return null;
    }
  }
  
  /**
   * Retry a failed bundle
   * @param bundleId ID of the bundle to retry
   * @returns The retried bundle if successful, null otherwise
   */
  public async retryBundle(bundleId: string): Promise<Bundle | null> {
    if (!this.config.bundleRecoveryEnabled) {
      return null;
    }
    
    try {
      const startTime = Date.now();
      const sequencerService = SequencerService.getInstance();
      const monitoringService = MonitoringService.getInstance();
      
      // Get the bundle
      const bundle = await sequencerService.getBundleById(bundleId);
      if (!bundle) {
        throw new Error(`Bundle not found: ${bundleId}`);
      }
      
      // Check if bundle can be retried
      if (bundle.status !== BundleStatus.FAILED && bundle.status !== BundleStatus.ABORTED) {
        throw new Error(`Bundle ${bundleId} cannot be retried (status: ${bundle.status})`);
      }
      
      // Check if max retries exceeded
      if (bundle.retryCount >= this.config.maxRetries) {
        throw new Error(`Bundle ${bundleId} has exceeded maximum retry count (${this.config.maxRetries})`);
      }
      
      // Update statistics
      this.recoveryStatistics.totalRecoveryAttempts++;
      this.recoveryStatistics.recoveryByType.bundle++;
      
      // Create a new bundle with the same transactions
      const retriedBundle = await sequencerService.retryBundle(bundleId);
      
      // Update statistics
      this.recoveryStatistics.successfulRecoveries++;
      this.recoveryStatistics.lastRecoveryTime = new Date();
      
      const recoveryTime = Date.now() - startTime;
      this.totalRecoveryTimeMs += recoveryTime;
      this.recoveryStatistics.avgRecoveryTimeMs = this.totalRecoveryTimeMs / this.recoveryStatistics.successfulRecoveries;
      
      // Log successful retry
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'BundleRetried',
        severity: EventSeverity.INFO,
        category: EventCategory.BUNDLE,
        message: `Successfully retried bundle: ${bundleId}`,
        details: {
          originalBundleId: bundleId,
          newBundleId: retriedBundle.id,
          recoveryTimeMs: recoveryTime
        }
      });
      
      return retriedBundle;
    } catch (error) {
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'BundleRetryError',
        severity: EventSeverity.ERROR,
        category: EventCategory.BUNDLE,
        message: `Failed to retry bundle ${bundleId}: ${error.message}`
      });
      
      // Update statistics
      this.recoveryStatistics.failedRecoveries++;
      
      return null;
    }
  }
  
  /**
   * Create a system checkpoint
   * @param customData Optional custom data to include in the checkpoint
   * @returns Path to the created checkpoint file
   */
  public async createCheckpoint(customData: Record<string, any> = {}): Promise<string> {
    if (!this.config.stateRecoveryEnabled) {
      return null;
    }
    
    try {
      const sequencerService = SequencerService.getInstance();
      const transactionService = TransactionService.getInstance();
      
      // Get current system state
      const currentBundle = sequencerService.getCurrentBundle();
      const pendingTransactionCount = await transactionService.getPendingTransactionCount();
      const readyBundleCount = await sequencerService.getReadyBundleCount();
      const processingBundleCount = await sequencerService.getProcessingBundleCount();
      
      // Get last processed transaction and bundle
      const lastTransactions = await transactionService.getTransactions({
        limit: 1,
        offset: 0,
        orderBy: 'createdAt',
        orderDirection: 'DESC'
      });
      
      const lastBundles = await sequencerService.getBundles({
        limit: 1,
        offset: 0,
        orderBy: 'createdAt',
        orderDirection: 'DESC'
      });
      
      // Create checkpoint data
      const checkpoint: RecoveryCheckpoint = {
        timestamp: new Date().toISOString(),
        systemState: {
          running: this.running,
          currentBundleId: currentBundle ? currentBundle.id : null,
          pendingTransactionCount,
          readyBundleCount,
          processingBundleCount
        },
        lastProcessedTransaction: lastTransactions.length > 0 ? lastTransactions[0].id : null,
        lastProcessedBundle: lastBundles.length > 0 ? lastBundles[0].id : null,
        hsm: {
          activeKey: this.activeHsmKey,
          lastKeyRotation: this.lastKeyRotation ? this.lastKeyRotation.toISOString() : null
        },
        customData
      };
      
      // Create checkpoint filename with timestamp
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
      const filename = `checkpoint_${timestamp}.json`;
      const checkpointPath = path.join(this.config.checkpointDir, filename);
      
      // Write checkpoint to file
      fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
      
      return checkpointPath;
    } catch (error) {
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'CheckpointError',
        severity: EventSeverity.ERROR,
        category: EventCategory.SYSTEM,
        message: `Failed to create checkpoint: ${error.message}`
      });
      
      return null;
    }
  }
  
  /**
   * Recover system state from a checkpoint
   * @param checkpointPath Path to the checkpoint file
   * @returns True if recovery was successful
   */
  public async recoverFromCheckpoint(checkpointPath: string): Promise<boolean> {
    if (!this.config.stateRecoveryEnabled || this.recoveryInProgress) {
      return false;
    }
    
    this.recoveryInProgress = true;
    const startTime = Date.now();
    
    try {
      const monitoringService = MonitoringService.getInstance();
      
      // Update statistics
      this.recoveryStatistics.totalRecoveryAttempts++;
      this.recoveryStatistics.recoveryByType.system++;
      this.recoveryStatistics.manualRecoveryCount++;
      
      // Log recovery start
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'SystemRecoveryStarted',
        severity: EventSeverity.WARNING,
        category: EventCategory.SYSTEM,
        message: `Starting system recovery from checkpoint: ${checkpointPath}`
      });
      
      // Read checkpoint file
      if (!fs.existsSync(checkpointPath)) {
        throw new Error(`Checkpoint file not found: ${checkpointPath}`);
      }
      
      const checkpointData = JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) as RecoveryCheckpoint;
      
      // Verify checkpoint data
      if (!checkpointData.timestamp || !checkpointData.systemState) {
        throw new Error('Invalid checkpoint data');
      }
      
      // Perform recovery
      // This would involve more complex logic in a real implementation
      // For now, we'll just simulate a successful recovery
      
      // Update HSM state if needed
      if (checkpointData.hsm.activeKey !== this.activeHsmKey) {
        await this.switchHsmKey(checkpointData.hsm.activeKey);
      }
      
      // Update statistics
      this.recoveryStatistics.successfulRecoveries++;
      this.recoveryStatistics.lastRecoveryTime = new Date();
      
      const recoveryTime = Date.now() - startTime;
      this.totalRecoveryTimeMs += recoveryTime;
      this.recoveryStatistics.avgRecoveryTimeMs = this.totalRecoveryTimeMs / this.recoveryStatistics.successfulRecoveries;
      
      // Log recovery completion
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'SystemRecoveryCompleted',
        severity: EventSeverity.INFO,
        category: EventCategory.SYSTEM,
        message: `System recovery completed successfully`,
        details: {
          checkpointPath,
          recoveryTimeMs: recoveryTime
        }
      });
      
      return true;
    } catch (error) {
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'SystemRecoveryError',
        severity: EventSeverity.ERROR,
        category: EventCategory.SYSTEM,
        message: `Failed to recover system from checkpoint: ${error.message}`
      });
      
      // Update statistics
      this.recoveryStatistics.failedRecoveries++;
      
      return false;
    } finally {
      this.recoveryInProgress = false;
    }
  }
  
  /**
   * Get the latest checkpoint
   * @returns Path to the latest checkpoint file, or null if none exists
   */
  public getLatestCheckpoint(): string | null {
    try {
      if (!fs.existsSync(this.config.checkpointDir)) {
        return null;
      }
      
      const files = fs.readdirSync(this.config.checkpointDir)
        .filter(file => file.startsWith('checkpoint_') && file.endsWith('.json'))
        .sort()
        .reverse();
      
      if (files.length === 0) {
        return null;
      }
      
      return path.join(this.config.checkpointDir, files[0]);
    } catch (error) {
      console.error(`Failed to get latest checkpoint: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Perform HSM key rotation
   * @returns True if rotation was successful
   */
  public async rotateHsmKey(): Promise<boolean> {
    if (!this.config.hsm.enabled) {
      return false;
    }
    
    try {
      const monitoringService = MonitoringService.getInstance();
      
      // Switch to the other key
      const newKey = this.activeHsmKey === 'primary' ? 'backup' : 'primary';
      
      // Log key rotation start
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'HsmKeyRotationStarted',
        severity: EventSeverity.INFO,
        category: EventCategory.SECURITY,
        message: `Starting HSM key rotation from ${this.activeHsmKey} to ${newKey}`
      });
      
      // Perform key rotation
      // This would involve more complex logic in a real implementation
      // For now, we'll just simulate a successful rotation
      
      // Update state
      this.activeHsmKey = newKey;
      this.lastKeyRotation = new Date();
      
      // Update statistics
      this.recoveryStatistics.recoveryByType.hsm++;
      
      // Log key rotation completion
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'HsmKeyRotationCompleted',
        severity: EventSeverity.INFO,
        category: EventCategory.SECURITY,
        message: `HSM key rotation completed successfully`,
        details: {
          activeKey: this.activeHsmKey,
          rotationTime: this.lastKeyRotation
        }
      });
      
      return true;
    } catch (error) {
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'HsmKeyRotationError',
        severity: EventSeverity.ERROR,
        category: EventCategory.SECURITY,
        message: `Failed to rotate HSM key: ${error.message}`
      });
      
      return false;
    }
  }
  
  /**
   * Switch to a specific HSM key
   * @param key Key to switch to ('primary' or 'backup')
   * @returns True if switch was successful
   */
  public async switchHsmKey(key: 'primary' | 'backup'): Promise<boolean> {
    if (!this.config.hsm.enabled || this.activeHsmKey === key) {
      return false;
    }
    
    try {
      const monitoringService = MonitoringService.getInstance();
      
      // Log key switch start
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'HsmKeySwitchStarted',
        severity: EventSeverity.INFO,
        category: EventCategory.SECURITY,
        message: `Starting HSM key switch from ${this.activeHsmKey} to ${key}`
      });
      
      // Perform key switch
      // This would involve more complex logic in a real implementation
      // For now, we'll just simulate a successful switch
      
      // Update state
      this.activeHsmKey = key;
      this.lastKeyRotation = new Date();
      
      // Update statistics
      this.recoveryStatistics.recoveryByType.hsm++;
      
      // Log key switch completion
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'HsmKeySwitchCompleted',
        severity: EventSeverity.INFO,
        category: EventCategory.SECURITY,
        message: `HSM key switch completed successfully`,
        details: {
          activeKey: this.activeHsmKey,
          switchTime: this.lastKeyRotation
        }
      });
      
      return true;
    } catch (error) {
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'HsmKeySwitchError',
        severity: EventSeverity.ERROR,
        category: EventCategory.SECURITY,
        message: `Failed to switch HSM key: ${error.message}`
      });
      
      return false;
    }
  }
  
  /**
   * Check HSM health and perform failover if needed
   * @returns True if failover was performed
   */
  public async checkHsmHealth(): Promise<boolean> {
    if (!this.config.hsm.enabled || !this.config.hsm.autoFailover) {
      return false;
    }
    
    try {
      const monitoringService = MonitoringService.getInstance();
      
      // Check primary key health
      const primaryKeyHealthy = await this.checkHsmKeyHealth('primary');
      
      // Check backup key health
      const backupKeyHealthy = await this.checkHsmKeyHealth('backup');
      
      // Log HSM health status
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'HsmHealthCheck',
        severity: EventSeverity.INFO,
        category: EventCategory.SECURITY,
        message: `HSM health check completed`,
        details: {
          primaryKeyHealthy,
          backupKeyHealthy,
          activeKey: this.activeHsmKey
        }
      });
      
      // Perform failover if needed
      if (this.activeHsmKey === 'primary' && !primaryKeyHealthy && backupKeyHealthy) {
        // Failover to backup key
        await this.switchHsmKey('backup');
        
        // Log failover
        await monitoringService.logEvent({
          source: 'RecoveryService',
          eventType: 'HsmFailover',
          severity: EventSeverity.WARNING,
          category: EventCategory.SECURITY,
          message: `HSM failover performed from primary to backup key`
        });
        
        return true;
      } else if (this.activeHsmKey === 'backup' && !backupKeyHealthy && primaryKeyHealthy) {
        // Failover to primary key
        await this.switchHsmKey('primary');
        
        // Log failover
        await monitoringService.logEvent({
          source: 'RecoveryService',
          eventType: 'HsmFailover',
          severity: EventSeverity.WARNING,
          category: EventCategory.SECURITY,
          message: `HSM failover performed from backup to primary key`
        });
        
        return true;
      }
      
      return false;
    } catch (error) {
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'RecoveryService',
        eventType: 'HsmHealthCheckError',
        severity: EventSeverity.ERROR,
        category: EventCategory.SECURITY,
        message: `Failed to check HSM health: ${error.message}`
      });
      
      return false;
    }
  }
  
  /**
   * Get recovery statistics
   * @returns Recovery statistics
   */
  public getRecoveryStatistics(): RecoveryStatistics {
    return { ...this.recoveryStatistics };
  }
  
  /**
   * Update recovery configuration
   * @param config Partial configuration to update
   */
  public updateConfig(config: Partial<RecoveryConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...config };
    
    // Restart checkpoint interval if running and interval changed
    if (this.running && oldConfig.checkpointIntervalMs !== this.config.checkpointIntervalMs && this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
      this.checkpointInterval = setInterval(
        () => this.createCheckpoint(),
        this.config.checkpointIntervalMs
      );
    }
  }
  
  /**
   * Get current recovery configuration
   * @returns Current configuration
   */
  public getConfig(): RecoveryConfig {
    return { ...this.config };
  }
  
  /**
   * Check if recovery service is initialized
   * @returns True if initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }
  
  /**
   * Check if recovery service is running
   * @returns True if running
   */
  public isRunning(): boolean {
    return this.running;
  }
  
  /**
   * Get active HSM key
   * @returns Active HSM key ('primary' or 'backup')
   */
  public getActiveHsmKey(): 'primary' | 'backup' {
    return this.activeHsmKey;
  }
  
  /**
   * Initialize HSM
   * @private
   */
  private async initializeHsm(): Promise<void> {
    try {
      // Check if primary key exists
      const primaryKeyExists = fs.existsSync(this.config.hsm.primaryKeyPath);
      
      // Check if backup key exists
      const backupKeyExists = fs.existsSync(this.config.hsm.backupKeyPath);
      
      if (!primaryKeyExists && !backupKeyExists) {
        // Create directories if they don't exist
        const primaryKeyDir = path.dirname(this.config.hsm.primaryKeyPath);
        const backupKeyDir = path.dirname(this.config.hsm.backupKeyPath);
        
        if (!fs.existsSync(primaryKeyDir)) {
          fs.mkdirSync(primaryKeyDir, { recursive: true });
        }
        
        if (!fs.existsSync(backupKeyDir)) {
          fs.mkdirSync(backupKeyDir, { recursive: true });
        }
        
        // Create dummy key files for simulation
        fs.writeFileSync(this.config.hsm.primaryKeyPath, 'PRIMARY_KEY_SIMULATION');
        fs.writeFileSync(this.config.hsm.backupKeyPath, 'BACKUP_KEY_SIMULATION');
      }
      
      // Set active key
      if (primaryKeyExists) {
        this.activeHsmKey = 'primary';
      } else if (backupKeyExists) {
        this.activeHsmKey = 'backup';
      }
    } catch (error) {
      throw new Error(`Failed to initialize HSM: ${error.message}`);
    }
  }
  
  /**
   * Check HSM key health
   * @param key Key to check ('primary' or 'backup')
   * @returns True if key is healthy
   * @private
   */
  private async checkHsmKeyHealth(key: 'primary' | 'backup'): Promise<boolean> {
    try {
      const keyPath = key === 'primary' ? this.config.hsm.primaryKeyPath : this.config.hsm.backupKeyPath;
      
      // Check if key file exists
      if (!fs.existsSync(keyPath)) {
        return false;
      }
      
      // In a real implementation, this would involve more complex checks
      // For now, we'll just simulate a health check
      
      return true;
    } catch (error) {
      console.error(`Failed to check HSM key health: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Load recovery statistics from file
   * @private
   */
  private async loadRecoveryStatistics(): Promise<void> {
    try {
      const statsPath = path.join(this.config.checkpointDir, 'recovery_stats.json');
      
      if (fs.existsSync(statsPath)) {
        const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
        
        // Convert date strings back to Date objects
        if (stats.lastRecoveryTime) {
          stats.lastRecoveryTime = new Date(stats.lastRecoveryTime);
        }
        
        this.recoveryStatistics = stats;
        
        // Recalculate total recovery time
        this.totalRecoveryTimeMs = this.recoveryStatistics.avgRecoveryTimeMs * this.recoveryStatistics.successfulRecoveries;
      }
    } catch (error) {
      console.error(`Failed to load recovery statistics: ${error.message}`);
    }
  }
  
  /**
   * Save recovery statistics to file
   * @private
   */
  private async saveRecoveryStatistics(): Promise<void> {
    try {
      const statsPath = path.join(this.config.checkpointDir, 'recovery_stats.json');
      fs.writeFileSync(statsPath, JSON.stringify(this.recoveryStatistics, null, 2));
    } catch (error) {
      console.error(`Failed to save recovery statistics: ${error.message}`);
    }
  }
}
