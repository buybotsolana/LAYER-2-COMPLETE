// English comment for verification
/**
 * @file BundleProcessor.ts
 * @description Advanced bundle processor for optimizing transaction bundling
 * @author Manus AI
 * @date April 27, 2025
 */

import { Logger } from '../utils/Logger';
import { MetricsService } from '../monitoring/MetricsService';
import { CacheService } from '../utils/CacheService';
import { TransactionEntity } from '../transaction/transaction.entity';
import { BundleEntity } from './bundle.entity';
import { TransactionPriority, BundleStatus, TransactionStatus } from './sequencer.service';

/**
 * Bundle optimization strategy enum
 */
export enum BundleOptimizationStrategy {
  FIRST_COME_FIRST_SERVED = 'first_come_first_served',
  PRIORITY_BASED = 'priority_based',
  FEE_OPTIMIZED = 'fee_optimized',
  SIZE_OPTIMIZED = 'size_optimized',
  HYBRID = 'hybrid'
}

/**
 * Bundle processor configuration interface
 */
export interface BundleProcessorConfig {
  // Optimization strategy
  strategy: BundleOptimizationStrategy;
  
  // Bundle constraints
  maxTransactionsPerBundle: number;
  minTransactionsPerBundle: number;
  maxBundleSize: number; // in bytes
  
  // Priority weights
  priorityWeights: {
    [key in TransactionPriority]: number;
  };
  
  // Fee optimization
  feeOptimization: {
    enabled: boolean;
    targetFeePercentage: number;
    maxFeePercentage: number;
  };
  
  // Gas price optimization
  gasOptimization: {
    enabled: boolean;
    useHistoricalPrices: boolean;
    gasPriceMultiplier: number;
  };
  
  // Advanced options
  advancedOptions: {
    considerDependencies: boolean;
    useTransactionAging: boolean;
    agingFactor: number;
    useDynamicBundling: boolean;
    dynamicBundlingThreshold: number;
  };
}

/**
 * Default bundle processor configuration
 */
const DEFAULT_CONFIG: BundleProcessorConfig = {
  strategy: BundleOptimizationStrategy.HYBRID,
  
  maxTransactionsPerBundle: 100,
  minTransactionsPerBundle: 5,
  maxBundleSize: 1024 * 1024, // 1 MB
  
  priorityWeights: {
    [TransactionPriority.LOW]: 1,
    [TransactionPriority.MEDIUM]: 2,
    [TransactionPriority.HIGH]: 5,
    [TransactionPriority.CRITICAL]: 10
  },
  
  feeOptimization: {
    enabled: true,
    targetFeePercentage: 0.1, // 10%
    maxFeePercentage: 0.2, // 20%
  },
  
  gasOptimization: {
    enabled: true,
    useHistoricalPrices: true,
    gasPriceMultiplier: 1.1, // 10% higher than current price
  },
  
  advancedOptions: {
    considerDependencies: true,
    useTransactionAging: true,
    agingFactor: 1.05, // 5% increase in priority per minute
    useDynamicBundling: true,
    dynamicBundlingThreshold: 50, // transactions
  },
};

/**
 * BundleProcessor class - Advanced processor for optimizing transaction bundling
 */
export class BundleProcessor {
  private readonly logger: Logger;
  private readonly config: BundleProcessorConfig;
  private readonly metricsService: MetricsService;
  private readonly cacheService: CacheService;
  
  /**
   * Constructor for the BundleProcessor
   * 
   * @param metricsService - Metrics service for monitoring performance
   * @param cacheService - Cache service for optimizing data access
   * @param logger - Logger instance
   * @param config - Configuration for the bundle processor
   */
  constructor(
    metricsService: MetricsService,
    cacheService: CacheService,
    logger: Logger,
    config: Partial<BundleProcessorConfig> = {}
  ) {
    this.metricsService = metricsService;
    this.cacheService = cacheService;
    this.logger = logger.createChild('BundleProcessor');
    
    // Merge provided config with defaults
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      priorityWeights: {
        ...DEFAULT_CONFIG.priorityWeights,
        ...(config.priorityWeights || {})
      },
      feeOptimization: {
        ...DEFAULT_CONFIG.feeOptimization,
        ...(config.feeOptimization || {})
      },
      gasOptimization: {
        ...DEFAULT_CONFIG.gasOptimization,
        ...(config.gasOptimization || {})
      },
      advancedOptions: {
        ...DEFAULT_CONFIG.advancedOptions,
        ...(config.advancedOptions || {})
      }
    };
    
    this.logger.info('BundleProcessor initialized with strategy: ' + this.config.strategy);
  }
  
  /**
   * Create optimal bundles from a list of transactions
   * 
   * @param transactions - List of pending transactions
   * @param maxBundles - Maximum number of bundles to create
   * @returns List of created bundles
   */
  public createOptimalBundles(
    transactions: TransactionEntity[],
    maxBundles: number
  ): BundleEntity[] {
    this.logger.info(`Creating optimal bundles from ${transactions.length} transactions (max: ${maxBundles} bundles)`);
    
    try {
      // Record start time for metrics
      const startTime = Date.now();
      
      // Filter out transactions that are already in bundles
      const availableTransactions = transactions.filter(tx => !tx.bundleId);
      
      if (availableTransactions.length === 0) {
        this.logger.info('No available transactions for bundling');
        return [];
      }
      
      // Select strategy based on configuration
      let bundleCreator: (txs: TransactionEntity[], max: number) => BundleEntity[];
      
      switch (this.config.strategy) {
        case BundleOptimizationStrategy.FIRST_COME_FIRST_SERVED:
          bundleCreator = this.createFCFSBundles.bind(this);
          break;
        case BundleOptimizationStrategy.PRIORITY_BASED:
          bundleCreator = this.createPriorityBundles.bind(this);
          break;
        case BundleOptimizationStrategy.FEE_OPTIMIZED:
          bundleCreator = this.createFeeOptimizedBundles.bind(this);
          break;
        case BundleOptimizationStrategy.SIZE_OPTIMIZED:
          bundleCreator = this.createSizeOptimizedBundles.bind(this);
          break;
        case BundleOptimizationStrategy.HYBRID:
        default:
          bundleCreator = this.createHybridBundles.bind(this);
          break;
      }
      
      // Create bundles using selected strategy
      const bundles = bundleCreator(availableTransactions, maxBundles);
      
      // Record metrics
      const processingTime = Date.now() - startTime;
      this.metricsService.recordMetric('bundle_processor.processing_time', processingTime);
      this.metricsService.recordMetric('bundle_processor.bundles_created', bundles.length);
      
      const totalTransactions = bundles.reduce((sum, bundle) => sum + bundle.transactionCount, 0);
      this.metricsService.recordMetric('bundle_processor.transactions_bundled', totalTransactions);
      
      this.logger.info(`Created ${bundles.length} bundles with ${totalTransactions} transactions in ${processingTime}ms`);
      
      return bundles;
    } catch (error) {
      this.logger.error('Error creating optimal bundles', error);
      throw error;
    }
  }
  
  /**
   * Create bundles using First-Come-First-Served strategy
   * 
   * @param transactions - List of pending transactions
   * @param maxBundles - Maximum number of bundles to create
   * @returns List of created bundles
   */
  private createFCFSBundles(
    transactions: TransactionEntity[],
    maxBundles: number
  ): BundleEntity[] {
    this.logger.debug(`Creating FCFS bundles from ${transactions.length} transactions`);
    
    // Sort transactions by creation time (oldest first)
    const sortedTransactions = [...transactions].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );
    
    return this.createBundlesFromSortedTransactions(sortedTransactions, maxBundles);
  }
  
  /**
   * Create bundles using Priority-Based strategy
   * 
   * @param transactions - List of pending transactions
   * @param maxBundles - Maximum number of bundles to create
   * @returns List of created bundles
   */
  private createPriorityBundles(
    transactions: TransactionEntity[],
    maxBundles: number
  ): BundleEntity[] {
    this.logger.debug(`Creating Priority-Based bundles from ${transactions.length} transactions`);
    
    // Apply aging factor if enabled
    let processedTransactions = [...transactions];
    
    if (this.config.advancedOptions.useTransactionAging) {
      processedTransactions = this.applyTransactionAging(processedTransactions);
    }
    
    // Sort transactions by priority (highest first)
    const sortedTransactions = processedTransactions.sort((a, b) => {
      const priorityA = this.config.priorityWeights[a.priority as TransactionPriority] || 1;
      const priorityB = this.config.priorityWeights[b.priority as TransactionPriority] || 1;
      
      if (priorityA !== priorityB) {
        return priorityB - priorityA; // Higher priority first
      }
      
      return a.createdAt.getTime() - b.createdAt.getTime(); // Older first
    });
    
    return this.createBundlesFromSortedTransactions(sortedTransactions, maxBundles);
  }
  
  /**
   * Create bundles using Fee-Optimized strategy
   * 
   * @param transactions - List of pending transactions
   * @param maxBundles - Maximum number of bundles to create
   * @returns List of created bundles
   */
  private createFeeOptimizedBundles(
    transactions: TransactionEntity[],
    maxBundles: number
  ): BundleEntity[] {
    this.logger.debug(`Creating Fee-Optimized bundles from ${transactions.length} transactions`);
    
    // TODO: Implement fee optimization logic
    // This would require parsing transaction data to extract fee information
    
    // For now, fall back to priority-based bundling
    return this.createPriorityBundles(transactions, maxBundles);
  }
  
  /**
   * Create bundles using Size-Optimized strategy
   * 
   * @param transactions - List of pending transactions
   * @param maxBundles - Maximum number of bundles to create
   * @returns List of created bundles
   */
  private createSizeOptimizedBundles(
    transactions: TransactionEntity[],
    maxBundles: number
  ): BundleEntity[] {
    this.logger.debug(`Creating Size-Optimized bundles from ${transactions.length} transactions`);
    
    // Sort transactions by size (smallest first)
    const sortedTransactions = [...transactions].sort((a, b) => {
      const sizeA = Buffer.from(a.data, 'base64').length;
      const sizeB = Buffer.from(b.data, 'base64').length;
      return sizeA - sizeB;
    });
    
    return this.createBundlesFromSortedTransactions(sortedTransactions, maxBundles);
  }
  
  /**
   * Create bundles using Hybrid strategy
   * 
   * @param transactions - List of pending transactions
   * @param maxBundles - Maximum number of bundles to create
   * @returns List of created bundles
   */
  private createHybridBundles(
    transactions: TransactionEntity[],
    maxBundles: number
  ): BundleEntity[] {
    this.logger.debug(`Creating Hybrid bundles from ${transactions.length} transactions`);
    
    // Apply aging factor if enabled
    let processedTransactions = [...transactions];
    
    if (this.config.advancedOptions.useTransactionAging) {
      processedTransactions = this.applyTransactionAging(processedTransactions);
    }
    
    // Sort transactions by a combination of priority, age, and size
    const sortedTransactions = processedTransactions.sort((a, b) => {
      const priorityA = this.config.priorityWeights[a.priority as TransactionPriority] || 1;
      const priorityB = this.config.priorityWeights[b.priority as TransactionPriority] || 1;
      
      // Calculate age score (older = higher score)
      const ageA = (Date.now() - a.createdAt.getTime()) / 60000; // minutes
      const ageB = (Date.now() - b.createdAt.getTime()) / 60000; // minutes
      
      // Calculate size score (smaller = higher score)
      const sizeA = Buffer.from(a.data, 'base64').length;
      const sizeB = Buffer.from(b.data, 'base64').length;
      const maxSize = Math.max(...processedTransactions.map(tx => Buffer.from(tx.data, 'base64').length));
      const sizeScoreA = 1 - (sizeA / maxSize);
      const sizeScoreB = 1 - (sizeB / maxSize);
      
      // Combine scores with weights
      const scoreA = (priorityA * 0.6) + (ageA * 0.3) + (sizeScoreA * 0.1);
      const scoreB = (priorityB * 0.6) + (ageB * 0.3) + (sizeScoreB * 0.1);
      
      return scoreB - scoreA; // Higher score first
    });
    
    return this.createBundlesFromSortedTransactions(sortedTransactions, maxBundles);
  }
  
  /**
   * Apply transaction aging to increase priority of older transactions
   * 
   * @param transactions - List of transactions
   * @returns Transactions with adjusted priorities
   */
  private applyTransactionAging(transactions: TransactionEntity[]): TransactionEntity[] {
    this.logger.debug('Applying transaction aging');
    
    return transactions.map(tx => {
      // Clone transaction to avoid modifying original
      const clonedTx = { ...tx };
      
      // Calculate age in minutes
      const ageInMinutes = (Date.now() - tx.createdAt.getTime()) / 60000;
      
      // Apply aging factor
      const agingMultiplier = Math.pow(this.config.advancedOptions.agingFactor, ageInMinutes);
      
      // Store original priority weight
      const originalWeight = this.config.priorityWeights[tx.priority as TransactionPriority] || 1;
      
      // Apply aging multiplier (stored in a custom field)
      (clonedTx as any).effectivePriorityWeight = originalWeight * agingMultiplier;
      
      return clonedTx;
    });
  }
  
  /**
   * Create bundles from sorted transactions
   * 
   * @param sortedTransactions - Sorted list of transactions
   * @param maxBundles - Maximum number of bundles to create
   * @returns List of created bundles
   */
  private createBundlesFromSortedTransactions(
    sortedTransactions: TransactionEntity[],
    maxBundles: number
  ): BundleEntity[] {
    this.logger.debug(`Creating bundles from ${sortedTransactions.length} sorted transactions`);
    
    const bundles: BundleEntity[] = [];
    const usedTransactionIds = new Set<string>();
    
    // Determine if we should use dynamic bundling
    const useDynamicBundling = this.config.advancedOptions.useDynamicBundling && 
                              sortedTransactions.length >= this.config.advancedOptions.dynamicBundlingThreshold;
    
    // Adjust min transactions per bundle based on dynamic bundling
    const minTransactionsPerBundle = useDynamicBundling
      ? Math.max(1, Math.floor(this.config.minTransactionsPerBundle / 2))
      : this.config.minTransactionsPerBundle;
    
    // Create bundles until we reach max bundles or run out of transactions
    while (bundles.length < maxBundles && usedTransactionIds.size < sortedTransactions.length) {
      // Select transactions for the bundle
      const bundleTransactions: TransactionEntity[] = [];
      let bundleSize = 0;
      
      for (const tx of sortedTransactions) {
        // Skip transactions that are already in a bundle
        if (usedTransactionIds.has(tx.id)) {
          continue;
        }
        
        // Check if adding this transaction would exceed the max bundle size
        const txSize = Buffer.from(tx.data, 'base64').length;
        
        if (bundleSize + txSize > this.config.maxBundleSize) {
          continue;
        }
        
        // Add transaction to bundle
        bundleTransactions.push(tx);
        bundleSize += txSize;
        usedTransactionIds.add(tx.id);
        
        // Check if we've reached the max transactions per bundle
        if (bundleTransactions.length >= this.config.maxTransactionsPerBundle) {
          break;
        }
      }
      
      // Check if we have enough transactions for a bundle
      if (bundleTransactions.length < minTransactionsPerBundle) {
        this.logger.debug(`Not enough transactions for a bundle: ${bundleTransactions.length} < ${minTransactionsPerBundle}`);
        break;
      }
      
      // Create bundle
      const bundle = new BundleEntity({
        id: `bundle-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
        status: BundleStatus.PENDING,
        transactionCount: bundleTransactions.length,
        transactionIds: bundleTransactions.map(tx => tx.id).join(','),
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400 * 30 * 1000) // 30 days
      });
      
      bundles.push(bundle);
      
      this.logger.debug(`Created bundle ${bundle.id} with ${bundle.transactionCount} transactions`);
    }
    
    return bundles;
  }
  
  /**
   * Analyze a bundle for optimization opportunities
   * 
   * @param bundle - The bundle to analyze
   * @param transactions - The transactions in the bundle
   * @returns Analysis results
   */
  public analyzeBundleEfficiency(
    bundle: BundleEntity,
    transactions: TransactionEntity[]
  ): any {
    this.logger.debug(`Analyzing efficiency of bundle ${bundle.id}`);
    
    try {
      // Calculate bundle size
      let totalSize = 0;
      let totalPriority = 0;
      
      for (const tx of transactions) {
        const txSize = Buffer.from(tx.data, 'base64').length;
        totalSize += txSize;
        
        const priorityWeight = this.config.priorityWeights[tx.priority as TransactionPriority] || 1;
        totalPriority += priorityWeight;
      }
      
      // Calculate efficiency metrics
      const sizeEfficiency = totalSize / this.config.maxBundleSize;
      const countEfficiency = transactions.length / this.config.maxTransactionsPerBundle;
      const averagePriority = totalPriority / transactions.length;
      
      // Calculate overall efficiency score (0-100)
      const efficiencyScore = Math.round(
        (sizeEfficiency * 0.4 + countEfficiency * 0.4 + (averagePriority / 10) * 0.2) * 100
      );
      
      return {
        bundleId: bundle.id,
        transactionCount: transactions.length,
        totalSize,
        sizeEfficiency: Math.round(sizeEfficiency * 100),
        countEfficiency: Math.round(countEfficiency * 100),
        averagePriority,
        efficiencyScore,
        recommendations: this.generateOptimizationRecommendations(
          sizeEfficiency,
          countEfficiency,
          averagePriority
        )
      };
    } catch (error) {
      this.logger.error(`Error analyzing bundle ${bundle.id}`, error);
      throw error;
    }
  }
  
  /**
   * Generate optimization recommendations based on efficiency metrics
   * 
   * @param sizeEfficiency - Size efficiency (0-1)
   * @param countEfficiency - Count efficiency (0-1)
   * @param averagePriority - Average priority
   * @returns List of recommendations
   */
  private generateOptimizationRecommendations(
    sizeEfficiency: number,
    countEfficiency: number,
    averagePriority: number
  ): string[] {
    const recommendations: string[] = [];
    
    if (sizeEfficiency < 0.7) {
      recommendations.push('Increase max transactions per bundle to improve size efficiency');
    }
    
    if (countEfficiency < 0.7) {
      recommendations.push('Decrease bundle interval to collect more transactions');
    }
    
    if (averagePriority < 2) {
      recommendations.push('Adjust priority weights to better reflect transaction importance');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Bundle efficiency is good, no specific recommendations');
    }
    
    return recommendations;
  }
}
