// English comment for verification
/**
 * @file layer2.system.ts
 * @description Enhanced Layer-2 system implementation with PostgreSQL integration and advanced features
 * @module layer2/system
 */

import { Logger } from '../utils/logger';
import { DatabaseService } from '../database/database.service';
import { TransactionService } from '../transaction/transaction.service';
import { SequencerService } from '../sequencer/sequencer.service';
import { GasOptimizerService } from '../utils/gas.optimizer.service';
import { RecoveryService } from '../utils/recovery.service';
import { BridgeService } from '../bridge/bridge.service';
import { WatchdogService } from '../utils/watchdog.service';
import { ConfigService } from '../config/config.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { v4 as uuidv4 } from 'uuid';
import * as os from 'os';
import { Worker } from 'worker_threads';
import * as path from 'path';
import { BundleStatus, BundlePriority, BundleType } from '../sequencer/bundle.entity';
import { TransactionStatus, TransactionType } from '../transaction/transaction.entity';

/**
 * Interface for system statistics
 */
export interface SystemStatistics {
  // Transaction statistics
  transactionStats: {
    totalCount: number;
    pendingCount: number;
    bundledCount: number;
    confirmedCount: number;
    failedCount: number;
    expiredCount: number;
    averageConfirmationTime: number | null;
    averageFee: string;
    transactionsByType: Record<string, number>;
    transactionsByHour: Array<{ hour: Date; count: number }>;
  };
  
  // Bundle statistics
  bundleStats: {
    totalCount: number;
    pendingCount: number;
    readyCount: number;
    processingCount: number;
    submittingCount: number;
    confirmedCount: number;
    failedCount: number;
    expiredCount: number;
    abortedCount: number;
    averageConfirmationTime: number | null;
    averageTransactionsPerBundle: number;
    averageGasPerBundle: number;
    totalFeesCollected: string;
    bundlesByType: Record<string, number>;
    bundlesByPriority: Record<string, number>;
    bundlesByHour: Array<{ hour: Date; count: number }>;
    successRate: number;
  };
  
  // System performance metrics
  performanceMetrics: {
    cpuUsage: number;
    memoryUsage: number;
    uptime: number;
    activeWorkers: number;
    databaseConnectionPool: {
      total: number;
      idle: number;
      active: number;
    };
    averageProcessingTime: number;
    averageSubmissionTime: number;
    throughput: {
      transactionsPerSecond: number;
      bundlesPerHour: number;
    };
  };
  
  // Error statistics
  errorStats: {
    totalErrors: number;
    errorsByType: Record<string, number>;
    errorsByHour: Array<{ hour: Date; count: number }>;
    mostFrequentErrors: Array<{ message: string; count: number }>;
  };
}

/**
 * Interface for system configuration
 */
export interface SystemConfig {
  // Processing configuration
  processing: {
    enabled: boolean;
    intervalMs: number;
    maxTransactionsPerBatch: number;
    minTransactionsToFinalize: number;
    maxBundleAgeMs: number;
    useMultiThreading: boolean;
    maxWorkers: number;
  };
  
  // Submission configuration
  submission: {
    enabled: boolean;
    intervalMs: number;
    maxBundlesPerSubmission: number;
    retryEnabled: boolean;
    maxRetries: number;
    retryDelayMs: number;
  };
  
  // Maintenance configuration
  maintenance: {
    enabled: boolean;
    intervalMs: number;
    cleanupEnabled: boolean;
    dataRetentionDays: number;
  };
  
  // Gas optimization configuration
  gasOptimization: {
    enabled: boolean;
    strategy: 'conservative' | 'moderate' | 'aggressive';
    maxBoostFactor: number;
    priorityFeeFactor: number;
  };
  
  // Recovery configuration
  recovery: {
    enabled: boolean;
    maxStuckTimeMs: number;
    autoAbortEnabled: boolean;
  };
  
  // Monitoring configuration
  monitoring: {
    enabled: boolean;
    metricsIntervalMs: number;
    alertingEnabled: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };
  
  // Bridge configuration
  bridge: {
    enabled: boolean;
    confirmations: number;
    maxGasPrice: string;
  };
}

/**
 * Enhanced Layer-2 system that integrates all components with PostgreSQL support
 * Provides a unified interface for interacting with the Layer-2 system
 * Supports multi-threading, advanced monitoring, and comprehensive error handling
 */
export class Layer2System {
  private logger: Logger;
  private databaseService: DatabaseService;
  private transactionService: TransactionService;
  private sequencerService: SequencerService;
  private gasOptimizerService: GasOptimizerService;
  private recoveryService: RecoveryService;
  private bridgeService: BridgeService;
  private watchdogService: WatchdogService;
  private configService: ConfigService;
  private monitoringService: MonitoringService;
  private static instance: Layer2System;
  private isRunning: boolean = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private submissionInterval: NodeJS.Timeout | null = null;
  private maintenanceInterval: NodeJS.Timeout | null = null;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private systemId: string;
  private workers: Worker[] = [];
  private useMultiThreading: boolean = false;
  private maxWorkers: number = 0;
  private startTime: Date | null = null;
  private lastProcessingTime: number = 0;
  private lastSubmissionTime: number = 0;
  private transactionsProcessedCounter: number = 0;
  private bundlesSubmittedCounter: number = 0;
  private errorCounter: Record<string, number> = {};
  private config: SystemConfig;

  /**
   * Private constructor to prevent direct instantiation
   * Use Layer2System.getInstance() instead
   */
  private constructor() {
    this.logger = new Logger('Layer2System');
    this.databaseService = DatabaseService.getInstance();
    this.transactionService = TransactionService.getInstance();
    this.sequencerService = SequencerService.getInstance();
    this.gasOptimizerService = GasOptimizerService.getInstance();
    this.recoveryService = RecoveryService.getInstance();
    this.bridgeService = BridgeService.getInstance();
    this.watchdogService = WatchdogService.getInstance();
    this.configService = ConfigService.getInstance();
    this.monitoringService = MonitoringService.getInstance();
    this.systemId = uuidv4();
    
    // Initialize default configuration
    this.config = {
      processing: {
        enabled: true,
        intervalMs: 5000,
        maxTransactionsPerBatch: 100,
        minTransactionsToFinalize: 50,
        maxBundleAgeMs: 60000, // 1 minute
        useMultiThreading: true,
        maxWorkers: Math.max(1, os.cpus().length - 1)
      },
      submission: {
        enabled: true,
        intervalMs: 10000,
        maxBundlesPerSubmission: 5,
        retryEnabled: true,
        maxRetries: 3,
        retryDelayMs: 5000
      },
      maintenance: {
        enabled: true,
        intervalMs: 300000, // 5 minutes
        cleanupEnabled: true,
        dataRetentionDays: 30
      },
      gasOptimization: {
        enabled: true,
        strategy: 'moderate',
        maxBoostFactor: 1.5,
        priorityFeeFactor: 1.1
      },
      recovery: {
        enabled: true,
        maxStuckTimeMs: 600000, // 10 minutes
        autoAbortEnabled: true
      },
      monitoring: {
        enabled: true,
        metricsIntervalMs: 60000, // 1 minute
        alertingEnabled: true,
        logLevel: 'info'
      },
      bridge: {
        enabled: true,
        confirmations: 12,
        maxGasPrice: '100000000000' // 100 Gwei
      }
    };
  }

  /**
   * Gets the singleton instance of Layer2System
   * 
   * @returns The singleton instance
   */
  public static getInstance(): Layer2System {
    if (!Layer2System.instance) {
      Layer2System.instance = new Layer2System();
    }
    return Layer2System.instance;
  }

  /**
   * Initializes worker threads for parallel processing
   */
  private initializeWorkers(): void {
    try {
      if (!this.useMultiThreading) return;
      
      this.logger.info(`Initializing Layer2System with ${this.maxWorkers} workers`);
      
      for (let i = 0; i < this.maxWorkers; i++) {
        const worker = new Worker(path.join(__dirname, 'layer2.worker.js'), {
          workerData: { workerId: i, systemId: this.systemId }
        });
        
        worker.on('error', (error) => {
          this.logger.error(`Worker ${i} error:`, { error });
          this.incrementErrorCounter('worker_error');
          // Restart worker on error
          this.restartWorker(i);
        });
        
        worker.on('exit', (code) => {
          if (code !== 0) {
            this.logger.warn(`Worker ${i} exited with code ${code}`);
            // Restart worker on abnormal exit
            this.restartWorker(i);
          }
        });
        
        worker.on('message', (message) => {
          if (message.type === 'processing_complete') {
            this.transactionsProcessedCounter += message.processedCount;
          } else if (message.type === 'submission_complete') {
            this.bundlesSubmittedCounter += message.submittedCount;
          } else if (message.type === 'error') {
            this.incrementErrorCounter(message.errorType || 'worker_error');
          }
        });
        
        this.workers.push(worker);
        this.logger.info(`Worker ${i} initialized`);
      }
    } catch (error) {
      this.logger.error('Failed to initialize workers', { error });
      this.incrementErrorCounter('worker_initialization_error');
      this.useMultiThreading = false;
    }
  }

  /**
   * Restarts a worker thread
   * 
   * @param index - Index of the worker to restart
   */
  private restartWorker(index: number): void {
    try {
      if (this.workers[index]) {
        this.workers[index].terminate();
      }
      
      const worker = new Worker(path.join(__dirname, 'layer2.worker.js'), {
        workerData: { workerId: index, systemId: this.systemId }
      });
      
      worker.on('error', (error) => {
        this.logger.error(`Worker ${index} error:`, { error });
        this.incrementErrorCounter('worker_error');
        this.restartWorker(index);
      });
      
      worker.on('exit', (code) => {
        if (code !== 0) {
          this.logger.warn(`Worker ${index} exited with code ${code}`);
          this.restartWorker(index);
        }
      });
      
      worker.on('message', (message) => {
        if (message.type === 'processing_complete') {
          this.transactionsProcessedCounter += message.processedCount;
        } else if (message.type === 'submission_complete') {
          this.bundlesSubmittedCounter += message.submittedCount;
        } else if (message.type === 'error') {
          this.incrementErrorCounter(message.errorType || 'worker_error');
        }
      });
      
      this.workers[index] = worker;
      this.logger.info(`Worker ${index} restarted`);
    } catch (error) {
      this.logger.error(`Failed to restart worker ${index}`, { error });
      this.incrementErrorCounter('worker_restart_error');
    }
  }

  /**
   * Increments the error counter for a specific error type
   * 
   * @param errorType - Type of error
   */
  private incrementErrorCounter(errorType: string): void {
    if (!this.errorCounter[errorType]) {
      this.errorCounter[errorType] = 0;
    }
    this.errorCounter[errorType]++;
    
    // Report to monitoring service
    if (this.monitoringService && this.config.monitoring.enabled) {
      this.monitoringService.reportError(errorType);
    }
  }

  /**
   * Updates the system configuration
   * 
   * @param config - New configuration (partial or complete)
   */
  public updateConfig(config: Partial<SystemConfig>): void {
    try {
      this.logger.info('Updating system configuration');
      
      // Deep merge configuration
      this.config = this.deepMerge(this.config, config);
      
      // Update multi-threading settings
      this.useMultiThreading = this.config.processing.useMultiThreading;
      this.maxWorkers = this.config.processing.maxWorkers;
      
      // Update log level
      this.logger.setLogLevel(this.config.monitoring.logLevel);
      
      // Update intervals if system is running
      if (this.isRunning) {
        this.resetIntervals();
      }
      
      this.logger.info('System configuration updated successfully');
    } catch (error) {
      this.logger.error('Failed to update system configuration', { error });
      this.incrementErrorCounter('config_update_error');
    }
  }

  /**
   * Deep merges two objects
   * 
   * @param target - Target object
   * @param source - Source object
   * @returns Merged object
   */
  private deepMerge<T>(target: T, source: Partial<T>): T {
    const output = { ...target };
    
    if (isObject(target) && isObject(source)) {
      Object.keys(source).forEach(key => {
        if (isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    
    return output;
    
    function isObject(item: any): item is Record<string, any> {
      return (item && typeof item === 'object' && !Array.isArray(item));
    }
  }

  /**
   * Resets all intervals based on current configuration
   */
  private resetIntervals(): void {
    // Clear existing intervals
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    if (this.submissionInterval) {
      clearInterval(this.submissionInterval);
      this.submissionInterval = null;
    }
    if (this.maintenanceInterval) {
      clearInterval(this.maintenanceInterval);
      this.maintenanceInterval = null;
    }
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    // Set new intervals if system is running
    if (this.isRunning) {
      if (this.config.processing.enabled) {
        this.processingInterval = setInterval(
          () => this.processPendingTransactions().catch(error => {
            this.logger.error('Error processing pending transactions', { error });
            this.incrementErrorCounter('processing_error');
          }),
          this.config.processing.intervalMs
        );
      }
      
      if (this.config.submission.enabled) {
        this.submissionInterval = setInterval(
          () => this.submitReadyBundles().catch(error => {
            this.logger.error('Error submitting ready bundles', { error });
            this.incrementErrorCounter('submission_error');
          }),
          this.config.submission.intervalMs
        );
      }
      
      if (this.config.maintenance.enabled) {
        this.maintenanceInterval = setInterval(
          () => this.performMaintenance().catch(error => {
            this.logger.error('Error performing maintenance', { error });
            this.incrementErrorCounter('maintenance_error');
          }),
          this.config.maintenance.intervalMs
        );
      }
      
      if (this.config.monitoring.enabled) {
        this.monitoringInterval = setInterval(
          () => this.collectAndReportMetrics().catch(error => {
            this.logger.error('Error collecting metrics', { error });
            this.incrementErrorCounter('monitoring_error');
          }),
          this.config.monitoring.metricsIntervalMs
        );
      }
    }
  }

  /**
   * Initializes the Layer-2 system
   * 
   * @param config - Optional configuration to apply during initialization
   * @returns Promise resolving when initialization is complete
   * @throws Error if initialization fails
   */
  public async initialize(config?: Partial<SystemConfig>): Promise<void> {
    try {
      this.logger.info('Initializing Layer-2 system');
      
      // Update configuration if provided
      if (config) {
        this.updateConfig(config);
      }
      
      // Initialize multi-threading if enabled
      if (this.config.processing.useMultiThreading) {
        this.useMultiThreading = true;
        this.maxWorkers = this.config.processing.maxWorkers;
        this.initializeWorkers();
      }

      // Initialize database with PostgreSQL support
      await this.databaseService.initialize();

      // Initialize services
      await this.sequencerService.initialize();
      await this.gasOptimizerService.initialize();
      await this.recoveryService.initialize();
      await this.bridgeService.initialize();
      await this.watchdogService.initialize();
      await this.monitoringService.initialize();

      this.logger.info('Layer-2 system initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Layer-2 system', { error });
      this.incrementErrorCounter('initialization_error');
      throw new Error(`Failed to initialize Layer-2 system: ${error.message}`);
    }
  }

  /**
   * Starts the Layer-2 system
   * 
   * @returns Promise resolving when system is started
   * @throws Error if system start fails
   */
  public async start(): Promise<void> {
    try {
      if (this.isRunning) {
        this.logger.warn('Layer-2 system is already running');
        return;
      }

      this.logger.info('Starting Layer-2 system');

      // Initialize system if not already initialized
      if (!this.databaseService.isInitialized()) {
        await this.initialize();
      }
      
      // Record start time
      this.startTime = new Date();
      
      // Reset counters
      this.transactionsProcessedCounter = 0;
      this.bundlesSubmittedCounter = 0;
      this.errorCounter = {};

      // Set up intervals
      this.resetIntervals();

      // Start watchdog
      await this.watchdogService.start();
      
      // Start monitoring
      if (this.config.monitoring.enabled) {
        await this.monitoringService.start();
      }

      this.isRunning = true;
      this.logger.info('Layer-2 system started successfully');
      
      // Report system start to monitoring
      if (this.config.monitoring.enabled) {
        this.monitoringService.reportEvent('system_start', {
          systemId: this.systemId,
          startTime: this.startTime,
          config: this.config
        });
      }
    } catch (error) {
      this.logger.error('Failed to start Layer-2 system', { error });
      this.incrementErrorCounter('start_error');
      throw new Error(`Failed to start Layer-2 system: ${error.message}`);
    }
  }

  /**
   * Stops the Layer-2 system
   * 
   * @returns Promise resolving when system is stopped
   * @throws Error if system stop fails
   */
  public async stop(): Promise<void> {
    try {
      if (!this.isRunning) {
        this.logger.warn('Layer-2 system is not running');
        return;
      }

      this.logger.info('Stopping Layer-2 system');

      // Stop intervals
      if (this.processingInterval) {
        clearInterval(this.processingInterval);
        this.processingInterval = null;
      }
      if (this.submissionInterval) {
        clearInterval(this.submissionInterval);
        this.submissionInterval = null;
      }
      if (this.maintenanceInterval) {
        clearInterval(this.maintenanceInterval);
        this.maintenanceInterval = null;
      }
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }

      // Stop watchdog
      await this.watchdogService.stop();
      
      // Stop monitoring
      if (this.config.monitoring.enabled) {
        await this.monitoringService.stop();
      }
      
      // Terminate workers
      if (this.useMultiThreading) {
        for (const worker of this.workers) {
          await worker.terminate();
        }
        this.workers = [];
      }
      
      // Calculate uptime
      const uptime = this.startTime ? (new Date().getTime() - this.startTime.getTime()) / 1000 : 0;

      this.isRunning = false;
      this.logger.info('Layer-2 system stopped successfully', {
        uptime,
        transactionsProcessed: this.transactionsProcessedCounter,
        bundlesSubmitted: this.bundlesSubmittedCounter
      });
      
      // Report system stop to monitoring
      if (this.config.monitoring.enabled) {
        this.monitoringService.reportEvent('system_stop', {
          systemId: this.systemId,
          uptime,
          transactionsProcessed: this.transactionsProcessedCounter,
          bundlesSubmitted: this.bundlesSubmittedCounter,
          errors: this.errorCounter
        });
      }
    } catch (error) {
      this.logger.error('Failed to stop Layer-2 system', { error });
      this.incrementErrorCounter('stop_error');
      throw new Error(`Failed to stop Layer-2 system: ${error.message}`);
    }
  }

  /**
   * Processes pending transactions
   * Uses multi-threading if enabled for improved performance
   * 
   * @returns Promise resolving to the number of transactions processed
   */
  private async processPendingTransactions(): Promise<number> {
    try {
      const startTime = Date.now();
      this.logger.debug('Processing pending transactions');

      // Mark expired transactions
      await this.transactionService.markExpiredTransactions();
      
      let processedCount = 0;
      
      if (this.useMultiThreading && this.workers.length > 0) {
        // Process in parallel using workers
        processedCount = await this.processPendingTransactionsParallel();
      } else {
        // Process sequentially
        const maxTransactions = this.config.processing.maxTransactionsPerBatch;
        processedCount = await this.sequencerService.processPendingTransactions(maxTransactions);
      }

      // Finalize bundle if it has enough transactions or has been open for too long
      const currentBundle = this.sequencerService.getCurrentBundle();
      if (currentBundle) {
        const minTransactionsToFinalize = this.config.processing.minTransactionsToFinalize;
        const maxBundleAgeMs = this.config.processing.maxBundleAgeMs;
        const bundleAgeMs = Date.now() - currentBundle.createdAt.getTime();

        if (
          (currentBundle.transactionCount >= minTransactionsToFinalize) ||
          (bundleAgeMs >= maxBundleAgeMs && currentBundle.transactionCount > 0)
        ) {
          await this.sequencerService.finalizeBundle();
        }
      }
      
      // Update processing time
      this.lastProcessingTime = Date.now() - startTime;
      
      // Update counter
      this.transactionsProcessedCounter += processedCount;
      
      return processedCount;
    } catch (error) {
      this.logger.error('Error processing pending transactions', { error });
      this.incrementErrorCounter('processing_error');
      throw error;
    }
  }

  /**
   * Processes pending transactions in parallel using worker threads
   * 
   * @returns Promise resolving to the number of transactions processed
   */
  private async processPendingTransactionsParallel(): Promise<number> {
    try {
      // Divide work among workers
      const promises = this.workers.map((worker, index) => {
        return new Promise<number>((resolve, reject) => {
          const messageHandler = (message: any) => {
            if (message.type === 'processing_complete' && message.workerId === index) {
              worker.removeListener('message', messageHandler);
              resolve(message.processedCount);
            }
          };
          
          worker.on('message', messageHandler);
          
          worker.postMessage({
            type: 'process_transactions',
            batchSize: Math.ceil(this.config.processing.maxTransactionsPerBatch / this.workers.length),
            minPriority: 0
          });
          
          // Set timeout to prevent hanging
          setTimeout(() => {
            worker.removeListener('message', messageHandler);
            reject(new Error(`Worker ${index} processing timeout`));
          }, this.config.processing.intervalMs * 0.9);
        });
      });
      
      // Wait for all workers to complete
      const results = await Promise.allSettled(promises);
      
      // Sum up successful results
      let totalProcessed = 0;
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          totalProcessed += result.value;
        } else {
          this.logger.error(`Worker ${index} failed to process transactions`, { error: result.reason });
          this.incrementErrorCounter('worker_processing_error');
        }
      });
      
      return totalProcessed;
    } catch (error) {
      this.logger.error('Error processing pending transactions in parallel', { error });
      this.incrementErrorCounter('parallel_processing_error');
      throw error;
    }
  }

  /**
   * Submits ready bundles
   * Uses multi-threading if enabled for improved performance
   * 
   * @returns Promise resolving to the number of bundles submitted
   */
  private async submitReadyBundles(): Promise<number> {
    try {
      const startTime = Date.now();
      this.logger.debug('Submitting ready bundles');
      
      let submittedCount = 0;
      
      if (this.useMultiThreading && this.workers.length > 0) {
        // Submit in parallel using workers
        submittedCount = await this.submitReadyBundlesParallel();
      } else {
        // Submit sequentially
        // Get ready bundles
        const maxBundles = this.config.submission.maxBundlesPerSubmission;
        const readyBundles = await this.sequencerService.getReadyBundles(maxBundles, true);

        if (readyBundles.length === 0) {
          return 0;
        }

        // Submit each bundle
        for (const bundle of readyBundles) {
          try {
            // Optimize gas price if enabled
            if (this.config.gasOptimization.enabled) {
              await this.gasOptimizerService.optimizeBundleGas(bundle.id);
            }

            // Submit bundle
            await this.sequencerService.submitBundle(bundle.id);
            submittedCount++;
          } catch (error) {
            this.logger.error('Failed to submit bundle', {
              bundleId: bundle.id,
              error
            });
            this.incrementErrorCounter('bundle_submission_error');
            // Continue with next bundle
          }
        }
      }
      
      // Update submission time
      this.lastSubmissionTime = Date.now() - startTime;
      
      // Update counter
      this.bundlesSubmittedCounter += submittedCount;
      
      return submittedCount;
    } catch (error) {
      this.logger.error('Error submitting ready bundles', { error });
      this.incrementErrorCounter('submission_error');
      throw error;
    }
  }

  /**
   * Submits ready bundles in parallel using worker threads
   * 
   * @returns Promise resolving to the number of bundles submitted
   */
  private async submitReadyBundlesParallel(): Promise<number> {
    try {
      // Get ready bundles
      const maxBundles = this.config.submission.maxBundlesPerSubmission;
      const readyBundles = await this.sequencerService.getReadyBundles(maxBundles, true);
      
      if (readyBundles.length === 0) {
        return 0;
      }
      
      // Divide bundles among workers
      const bundlesPerWorker: string[][] = Array(this.workers.length).fill(null).map(() => []);
      
      readyBundles.forEach((bundle, index) => {
        const workerIndex = index % this.workers.length;
        bundlesPerWorker[workerIndex].push(bundle.id);
      });
      
      // Submit bundles in parallel
      const promises = bundlesPerWorker.map((bundleIds, index) => {
        if (bundleIds.length === 0) return Promise.resolve(0);
        
        return new Promise<number>((resolve, reject) => {
          const worker = this.workers[index];
          
          const messageHandler = (message: any) => {
            if (message.type === 'submission_complete' && message.workerId === index) {
              worker.removeListener('message', messageHandler);
              resolve(message.submittedCount);
            }
          };
          
          worker.on('message', messageHandler);
          
          worker.postMessage({
            type: 'submit_bundles',
            bundleIds,
            optimizeGas: this.config.gasOptimization.enabled
          });
          
          // Set timeout to prevent hanging
          setTimeout(() => {
            worker.removeListener('message', messageHandler);
            reject(new Error(`Worker ${index} submission timeout`));
          }, this.config.submission.intervalMs * 0.9);
        });
      });
      
      // Wait for all workers to complete
      const results = await Promise.allSettled(promises);
      
      // Sum up successful results
      let totalSubmitted = 0;
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          totalSubmitted += result.value;
        } else {
          this.logger.error(`Worker ${index} failed to submit bundles`, { error: result.reason });
          this.incrementErrorCounter('worker_submission_error');
        }
      });
      
      return totalSubmitted;
    } catch (error) {
      this.logger.error('Error submitting ready bundles in parallel', { error });
      this.incrementErrorCounter('parallel_submission_error');
      throw error;
    }
  }

  /**
   * Performs maintenance tasks
   * 
   * @returns Promise resolving when maintenance is complete
   */
  private async performMaintenance(): Promise<void> {
    try {
      this.logger.debug('Performing maintenance');

      // Mark expired transactions and bundles
      await this.transactionService.markExpiredTransactions();
      await this.sequencerService.markExpiredBundles();

      // Run recovery checks if enabled
      if (this.config.recovery.enabled) {
        await this.recoveryService.checkStuckTransactions(this.config.recovery.maxStuckTimeMs);
        await this.recoveryService.checkStuckBundles(this.config.recovery.maxStuckTimeMs);
        
        // Auto-abort stuck bundles if enabled
        if (this.config.recovery.autoAbortEnabled) {
          await this.recoveryService.autoAbortStuckBundles(this.config.recovery.maxStuckTimeMs);
        }
      }

      // Run bridge maintenance if enabled
      if (this.config.bridge.enabled) {
        await this.bridgeService.performMaintenance();
      }

      // Run database maintenance
      await this.databaseService.performMaintenance();
      
      // Clean up old data if enabled
      if (this.config.maintenance.cleanupEnabled) {
        const dataRetentionDays = this.config.maintenance.dataRetentionDays;
        await this.transactionService.cleanupOldTransactions(dataRetentionDays);
        await this.sequencerService.cleanupOldBundles(dataRetentionDays);
      }
    } catch (error) {
      this.logger.error('Error performing maintenance', { error });
      this.incrementErrorCounter('maintenance_error');
      throw error;
    }
  }

  /**
   * Collects and reports system metrics
   * 
   * @returns Promise resolving when metrics collection is complete
   */
  private async collectAndReportMetrics(): Promise<void> {
    try {
      if (!this.config.monitoring.enabled) return;
      
      this.logger.debug('Collecting system metrics');
      
      // Get transaction statistics
      const transactionStats = await this.transactionService.getTransactionStatistics();
      
      // Get bundle statistics
      const bundleStats = await this.sequencerService.getBundleStatistics();
      
      // Get system performance metrics
      const performanceMetrics = {
        cpuUsage: process.cpuUsage().user / 1000000, // Convert to seconds
        memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024, // Convert to MB
        uptime: this.startTime ? (new Date().getTime() - this.startTime.getTime()) / 1000 : 0,
        activeWorkers: this.workers.length,
        databaseConnectionPool: await this.databaseService.getConnectionPoolStats(),
        averageProcessingTime: this.lastProcessingTime,
        averageSubmissionTime: this.lastSubmissionTime,
        throughput: {
          transactionsPerSecond: this.calculateTransactionsPerSecond(),
          bundlesPerHour: this.calculateBundlesPerHour()
        }
      };
      
      // Get error statistics
      const errorStats = {
        totalErrors: Object.values(this.errorCounter).reduce((sum, count) => sum + count, 0),
        errorsByType: this.errorCounter,
        errorsByHour: await this.monitoringService.getErrorsByHour(),
        mostFrequentErrors: await this.monitoringService.getMostFrequentErrors(5)
      };
      
      // Create system statistics
      const systemStats: SystemStatistics = {
        transactionStats,
        bundleStats,
        performanceMetrics,
        errorStats
      };
      
      // Report metrics to monitoring service
      await this.monitoringService.reportMetrics(systemStats);
      
      // Check for alerts
      if (this.config.monitoring.alertingEnabled) {
        await this.monitoringService.checkAlerts(systemStats);
      }
    } catch (error) {
      this.logger.error('Error collecting system metrics', { error });
      this.incrementErrorCounter('metrics_collection_error');
    }
  }

  /**
   * Calculates transactions processed per second
   * 
   * @returns Transactions per second
   */
  private calculateTransactionsPerSecond(): number {
    if (!this.startTime) return 0;
    
    const uptimeSeconds = (new Date().getTime() - this.startTime.getTime()) / 1000;
    if (uptimeSeconds <= 0) return 0;
    
    return this.transactionsProcessedCounter / uptimeSeconds;
  }

  /**
   * Calculates bundles submitted per hour
   * 
   * @returns Bundles per hour
   */
  private calculateBundlesPerHour(): number {
    if (!this.startTime) return 0;
    
    const uptimeHours = (new Date().getTime() - this.startTime.getTime()) / (1000 * 60 * 60);
    if (uptimeHours <= 0) return 0;
    
    return this.bundlesSubmittedCounter / uptimeHours;
  }

  /**
   * Gets the status of the Layer-2 system
   * 
   * @returns System status object
   */
  public async getStatus(): Promise<any> {
    try {
      // Get current bundle
      const currentBundle = this.sequencerService.getCurrentBundle();

      // Get pending transaction count
      const pendingTransactionCount = await this.transactionService.getPendingTransactionCount();

      // Get ready bundle count
      const readyBundleCount = await this.sequencerService.getReadyBundleCount();

      // Get processing bundle count
      const processingBundleCount = await this.sequencerService.getProcessingBundleCount();

      // Get confirmed bundle count
      const confirmedBundleCount = await this.sequencerService.getConfirmedBundleCount();

      // Get failed bundle count
      const failedBundleCount = await this.sequencerService.getFailedBundleCount();

      // Get bridge status
      const bridgeStatus = await this.bridgeService.getStatus();

      // Get gas price
      const gasPrice = await this.gasOptimizerService.getCurrentGasPrice();
      
      // Get system performance metrics
      const performanceMetrics = {
        cpuUsage: process.cpuUsage().user / 1000000, // Convert to seconds
        memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024, // Convert to MB
        uptime: this.startTime ? (new Date().getTime() - this.startTime.getTime()) / 1000 : 0,
        activeWorkers: this.workers.length,
        transactionsProcessed: this.transactionsProcessedCounter,
        bundlesSubmitted: this.bundlesSubmittedCounter,
        lastProcessingTime: this.lastProcessingTime,
        lastSubmissionTime: this.lastSubmissionTime,
        throughput: {
          transactionsPerSecond: this.calculateTransactionsPerSecond(),
          bundlesPerHour: this.calculateBundlesPerHour()
        }
      };

      // Return status object
      return {
        systemId: this.systemId,
        isRunning: this.isRunning,
        startTime: this.startTime,
        currentBundle: currentBundle ? {
          id: currentBundle.id,
          transactionCount: currentBundle.transactionCount,
          currentGas: currentBundle.currentGas,
          maxGas: currentBundle.maxGas,
          createdAt: currentBundle.createdAt,
          type: currentBundle.type,
          priority: currentBundle.priority
        } : null,
        pendingTransactionCount,
        readyBundleCount,
        processingBundleCount,
        confirmedBundleCount,
        failedBundleCount,
        bridgeStatus,
        gasPrice,
        performanceMetrics,
        errorCounts: this.errorCounter,
        config: {
          useMultiThreading: this.useMultiThreading,
          maxWorkers: this.maxWorkers,
          gasOptimizationEnabled: this.config.gasOptimization.enabled,
          recoveryEnabled: this.config.recovery.enabled,
          monitoringEnabled: this.config.monitoring.enabled
        }
      };
    } catch (error) {
      this.logger.error('Error getting system status', { error });
      this.incrementErrorCounter('status_error');
      throw new Error(`Failed to get system status: ${error.message}`);
    }
  }

  /**
   * Gets the health status of the Layer-2 system
   * 
   * @returns Health status object
   */
  public async getHealth(): Promise<any> {
    try {
      // Check database connection
      const databaseConnected = await this.databaseService.isConnected();
      
      // Get database connection pool stats
      const databasePoolStats = await this.databaseService.getConnectionPoolStats();

      // Check watchdog status
      const watchdogStatus = await this.watchdogService.getStatus();

      // Check bridge connection
      const bridgeConnected = await this.bridgeService.isConnected();
      
      // Check worker status
      const workersHealthy = this.checkWorkersHealth();
      
      // Check error rate
      const totalErrors = Object.values(this.errorCounter).reduce((sum, count) => sum + count, 0);
      const errorRate = this.startTime 
        ? totalErrors / ((new Date().getTime() - this.startTime.getTime()) / 1000 / 60) // errors per minute
        : 0;
      const errorRateHealthy = errorRate < 5; // Less than 5 errors per minute is considered healthy
      
      // Check transaction processing
      const transactionProcessingHealthy = this.lastProcessingTime < this.config.processing.intervalMs * 0.9;
      
      // Check bundle submission
      const bundleSubmissionHealthy = this.lastSubmissionTime < this.config.submission.intervalMs * 0.9;
      
      // Overall health status
      const isHealthy = databaseConnected && 
                        watchdogStatus.healthy && 
                        bridgeConnected && 
                        workersHealthy && 
                        errorRateHealthy &&
                        transactionProcessingHealthy &&
                        bundleSubmissionHealthy;

      // Return health status
      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        uptime: this.startTime ? (new Date().getTime() - this.startTime.getTime()) / 1000 : 0,
        components: {
          database: {
            connected: databaseConnected,
            poolStats: databasePoolStats
          },
          watchdog: watchdogStatus,
          bridge: {
            connected: bridgeConnected
          },
          workers: {
            healthy: workersHealthy,
            active: this.workers.length,
            configured: this.maxWorkers
          },
          errors: {
            healthy: errorRateHealthy,
            rate: errorRate,
            total: totalErrors
          },
          processing: {
            healthy: transactionProcessingHealthy,
            lastDuration: this.lastProcessingTime,
            limit: this.config.processing.intervalMs * 0.9
          },
          submission: {
            healthy: bundleSubmissionHealthy,
            lastDuration: this.lastSubmissionTime,
            limit: this.config.submission.intervalMs * 0.9
          }
        },
        lastChecked: new Date()
      };
    } catch (error) {
      this.logger.error('Error getting system health', { error });
      this.incrementErrorCounter('health_check_error');
      return {
        status: 'unhealthy',
        error: error.message,
        lastChecked: new Date()
      };
    }
  }

  /**
   * Checks if all workers are healthy
   * 
   * @returns True if all workers are healthy, false otherwise
   */
  private checkWorkersHealth(): boolean {
    if (!this.useMultiThreading) return true;
    
    // If we're using multi-threading but have no workers, that's unhealthy
    if (this.maxWorkers > 0 && this.workers.length === 0) return false;
    
    // If we have fewer workers than configured, that's unhealthy
    if (this.workers.length < this.maxWorkers) return false;
    
    // All workers are present
    return true;
  }

  /**
   * Gets detailed system statistics
   * 
   * @param forceRefresh - Whether to force a refresh of the statistics
   * @returns Promise resolving to system statistics
   */
  public async getStatistics(forceRefresh: boolean = false): Promise<SystemStatistics> {
    try {
      // Get transaction statistics
      const transactionStats = await this.transactionService.getTransactionStatistics(forceRefresh);
      
      // Get bundle statistics
      const bundleStats = await this.sequencerService.getBundleStatistics(forceRefresh);
      
      // Get system performance metrics
      const performanceMetrics = {
        cpuUsage: process.cpuUsage().user / 1000000, // Convert to seconds
        memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024, // Convert to MB
        uptime: this.startTime ? (new Date().getTime() - this.startTime.getTime()) / 1000 : 0,
        activeWorkers: this.workers.length,
        databaseConnectionPool: await this.databaseService.getConnectionPoolStats(),
        averageProcessingTime: this.lastProcessingTime,
        averageSubmissionTime: this.lastSubmissionTime,
        throughput: {
          transactionsPerSecond: this.calculateTransactionsPerSecond(),
          bundlesPerHour: this.calculateBundlesPerHour()
        }
      };
      
      // Get error statistics
      const errorStats = {
        totalErrors: Object.values(this.errorCounter).reduce((sum, count) => sum + count, 0),
        errorsByType: this.errorCounter,
        errorsByHour: await this.monitoringService.getErrorsByHour(),
        mostFrequentErrors: await this.monitoringService.getMostFrequentErrors(5)
      };
      
      // Create system statistics
      const systemStats: SystemStatistics = {
        transactionStats,
        bundleStats,
        performanceMetrics,
        errorStats
      };
      
      return systemStats;
    } catch (error) {
      this.logger.error('Error getting system statistics', { error });
      this.incrementErrorCounter('statistics_error');
      throw new Error(`Failed to get system statistics: ${error.message}`);
    }
  }

  /**
   * Gets the current system configuration
   * 
   * @returns Current system configuration
   */
  public getConfig(): SystemConfig {
    return this.config;
  }

  /**
   * Checks if the Layer-2 system is running
   * 
   * @returns True if the system is running, false otherwise
   */
  public isSystemRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Gets the system ID
   * 
   * @returns System ID
   */
  public getSystemId(): string {
    return this.systemId;
  }

  /**
   * Gets the system uptime in seconds
   * 
   * @returns System uptime in seconds, or 0 if not running
   */
  public getUptime(): number {
    if (!this.startTime) return 0;
    return (new Date().getTime() - this.startTime.getTime()) / 1000;
  }
}
