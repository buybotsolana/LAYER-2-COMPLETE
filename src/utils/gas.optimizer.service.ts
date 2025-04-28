// English comment for verification
/**
 * @file gas.optimizer.service.ts
 * @description Service for optimizing gas fees and transaction efficiency
 */

import { DatabaseService } from '../database/database.service';
import { MonitoringService, EventSeverity, EventCategory } from '../monitoring/monitoring.service';
import { Repository } from 'typeorm';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Interface for gas price data
 */
export interface GasPriceData {
  timestamp: Date;
  baseFee: string;
  priorityFee: string;
  totalFee: string;
  fastPriorityFee: string;
  fastTotalFee: string;
  slowPriorityFee: string;
  slowTotalFee: string;
  blockNumber: number;
  networkUtilization: number;
  source: string;
}

/**
 * Interface for gas price prediction
 */
export interface GasPricePrediction {
  timestamp: Date;
  baseFee: string;
  priorityFee: string;
  totalFee: string;
  confidence: number;
  timeframe: '1min' | '5min' | '15min' | '30min' | '1hour';
}

/**
 * Interface for gas price statistics
 */
export interface GasPriceStatistics {
  currentBaseFee: string;
  currentPriorityFee: string;
  currentTotalFee: string;
  averageBaseFee24h: string;
  averagePriorityFee24h: string;
  averageTotalFee24h: string;
  minBaseFee24h: string;
  maxBaseFee24h: string;
  volatility24h: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  predictions: GasPricePrediction[];
  lastUpdated: Date;
}

/**
 * Interface for gas optimization strategy
 */
export interface GasOptimizationStrategy {
  name: string;
  description: string;
  priorityMultiplier: number;
  baseMultiplier: number;
  maxPriorityFee: string;
  minPriorityFee: string;
  maxTotalFee: string;
  useHistoricalData: boolean;
  usePredictions: boolean;
  dynamicAdjustment: boolean;
  timeBasedAdjustment: boolean;
  valueBasedPrioritization: boolean;
}

/**
 * Interface for bundle gas optimization parameters
 */
export interface BundleGasOptimizationParams {
  bundleId: string;
  strategy: string;
  maxTotalFee?: string;
  priorityLevel?: 'low' | 'medium' | 'high';
  deadline?: Date;
  valueThreshold?: string;
}

/**
 * Interface for gas optimizer configuration
 */
export interface GasOptimizerConfig {
  enabled: boolean;
  updateIntervalMs: number;
  dataRetentionDays: number;
  dataSources: {
    onChain: boolean;
    etherscan: boolean;
    gasStation: boolean;
    custom: string[];
  };
  defaultStrategy: string;
  strategies: GasOptimizationStrategy[];
  predictionEnabled: boolean;
  predictionModel: 'linear' | 'exponential' | 'ml';
  historicalDataPoints: number;
  cacheTTLMs: number;
  maxGasBoostPercentage: number;
  timeBasedSettings: {
    peakHours: number[];
    peakMultiplier: number;
    offPeakMultiplier: number;
  };
}

/**
 * Entity for storing gas price data
 */
export class GasPrice {
  id: string;
  timestamp: Date;
  baseFee: string;
  priorityFee: string;
  totalFee: string;
  fastPriorityFee: string;
  fastTotalFee: string;
  slowPriorityFee: string;
  slowTotalFee: string;
  blockNumber: number;
  networkUtilization: number;
  source: string;
}

/**
 * Service for optimizing gas fees and transaction efficiency
 */
export class GasOptimizerService {
  private static instance: GasOptimizerService;
  private initialized: boolean = false;
  private running: boolean = false;
  
  private config: GasOptimizerConfig = {
    enabled: true,
    updateIntervalMs: 15000, // 15 seconds
    dataRetentionDays: 7,
    dataSources: {
      onChain: true,
      etherscan: true,
      gasStation: true,
      custom: []
    },
    defaultStrategy: 'balanced',
    strategies: [
      {
        name: 'economic',
        description: 'Optimize for lowest cost, may take longer to confirm',
        priorityMultiplier: 0.8,
        baseMultiplier: 1.0,
        maxPriorityFee: '5000000000', // 5 Gwei
        minPriorityFee: '1000000000', // 1 Gwei
        maxTotalFee: '50000000000', // 50 Gwei
        useHistoricalData: true,
        usePredictions: false,
        dynamicAdjustment: true,
        timeBasedAdjustment: false,
        valueBasedPrioritization: false
      },
      {
        name: 'balanced',
        description: 'Balance between cost and confirmation time',
        priorityMultiplier: 1.1,
        baseMultiplier: 1.0,
        maxPriorityFee: '20000000000', // 20 Gwei
        minPriorityFee: '1500000000', // 1.5 Gwei
        maxTotalFee: '100000000000', // 100 Gwei
        useHistoricalData: true,
        usePredictions: true,
        dynamicAdjustment: true,
        timeBasedAdjustment: true,
        valueBasedPrioritization: true
      },
      {
        name: 'fast',
        description: 'Optimize for fast confirmation, higher cost',
        priorityMultiplier: 1.5,
        baseMultiplier: 1.0,
        maxPriorityFee: '50000000000', // 50 Gwei
        minPriorityFee: '2000000000', // 2 Gwei
        maxTotalFee: '200000000000', // 200 Gwei
        useHistoricalData: false,
        usePredictions: true,
        dynamicAdjustment: true,
        timeBasedAdjustment: true,
        valueBasedPrioritization: true
      },
      {
        name: 'urgent',
        description: 'Highest priority, fastest confirmation regardless of cost',
        priorityMultiplier: 2.0,
        baseMultiplier: 1.0,
        maxPriorityFee: '100000000000', // 100 Gwei
        minPriorityFee: '5000000000', // 5 Gwei
        maxTotalFee: '500000000000', // 500 Gwei
        useHistoricalData: false,
        usePredictions: true,
        dynamicAdjustment: true,
        timeBasedAdjustment: false,
        valueBasedPrioritization: false
      }
    ],
    predictionEnabled: true,
    predictionModel: 'linear',
    historicalDataPoints: 100,
    cacheTTLMs: 60000, // 1 minute
    maxGasBoostPercentage: 200, // 200%
    timeBasedSettings: {
      peakHours: [9, 10, 11, 12, 13, 14, 15, 16, 17], // 9 AM to 5 PM
      peakMultiplier: 1.2,
      offPeakMultiplier: 0.9
    }
  };
  
  private updateInterval: NodeJS.Timeout | null = null;
  private gasPriceRepository: Repository<GasPrice>;
  
  private currentGasPrice: GasPriceData | null = null;
  private gasPriceCache: Map<string, { data: any, timestamp: number }> = new Map();
  private gasPriceHistory: GasPriceData[] = [];
  private gasPricePredictions: GasPricePrediction[] = [];
  private lastUpdateTime: Date | null = null;
  
  private constructor() {
    // Private constructor to enforce singleton pattern
  }
  
  /**
   * Get the singleton instance of the GasOptimizerService
   * @returns The GasOptimizerService instance
   */
  public static getInstance(): GasOptimizerService {
    if (!GasOptimizerService.instance) {
      GasOptimizerService.instance = new GasOptimizerService();
    }
    return GasOptimizerService.instance;
  }
  
  /**
   * Initialize the gas optimizer service
   * @param config Optional configuration to override defaults
   */
  public async initialize(config?: Partial<GasOptimizerConfig>): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    try {
      // Update configuration if provided
      if (config) {
        this.config = { ...this.config, ...config };
      }
      
      // Get database service
      const dbService = DatabaseService.getInstance();
      
      // Get repository
      this.gasPriceRepository = dbService.getRepository(GasPrice);
      
      // Load historical gas price data
      await this.loadHistoricalGasPriceData();
      
      // Get initial gas price
      await this.updateGasPrice();
      
      // Log initialization
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'GasOptimizerService',
        eventType: 'Initialization',
        severity: EventSeverity.INFO,
        category: EventCategory.GAS,
        message: 'Gas optimizer service initialized'
      });
      
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize gas optimizer service: ${error.message}`);
    }
  }
  
  /**
   * Start the gas optimizer service
   */
  public async start(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    if (this.running) {
      return;
    }
    
    try {
      // Start gas price update interval
      if (this.config.enabled) {
        this.updateInterval = setInterval(
          () => this.updateGasPrice(),
          this.config.updateIntervalMs
        );
      }
      
      // Log start
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'GasOptimizerService',
        eventType: 'Start',
        severity: EventSeverity.INFO,
        category: EventCategory.GAS,
        message: 'Gas optimizer service started'
      });
      
      this.running = true;
    } catch (error) {
      throw new Error(`Failed to start gas optimizer service: ${error.message}`);
    }
  }
  
  /**
   * Stop the gas optimizer service
   */
  public async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    
    try {
      // Stop gas price update interval
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
      }
      
      // Log stop
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'GasOptimizerService',
        eventType: 'Stop',
        severity: EventSeverity.INFO,
        category: EventCategory.GAS,
        message: 'Gas optimizer service stopped'
      });
      
      this.running = false;
    } catch (error) {
      throw new Error(`Failed to stop gas optimizer service: ${error.message}`);
    }
  }
  
  /**
   * Get the current gas price
   * @returns The current gas price data
   */
  public getCurrentGasPrice(): string {
    if (!this.currentGasPrice) {
      return '0';
    }
    
    return this.currentGasPrice.totalFee;
  }
  
  /**
   * Get detailed gas price data
   * @returns Detailed gas price data
   */
  public getDetailedGasPrice(): GasPriceData | null {
    return this.currentGasPrice;
  }
  
  /**
   * Get gas price statistics
   * @param forceUpdate Whether to force an update of gas price data
   * @returns Gas price statistics
   */
  public async getGasPriceStatistics(forceUpdate: boolean = false): Promise<GasPriceStatistics> {
    if (forceUpdate) {
      await this.updateGasPrice();
    }
    
    if (!this.currentGasPrice) {
      throw new Error('Gas price data not available');
    }
    
    // Calculate statistics from historical data
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const last24hData = this.gasPriceHistory.filter(data => data.timestamp >= oneDayAgo);
    
    if (last24hData.length === 0) {
      throw new Error('Insufficient historical data for statistics');
    }
    
    // Calculate averages
    const baseFees = last24hData.map(data => BigInt(data.baseFee));
    const priorityFees = last24hData.map(data => BigInt(data.priorityFee));
    const totalFees = last24hData.map(data => BigInt(data.totalFee));
    
    const avgBaseFee = (baseFees.reduce((a, b) => a + b, BigInt(0)) / BigInt(baseFees.length)).toString();
    const avgPriorityFee = (priorityFees.reduce((a, b) => a + b, BigInt(0)) / BigInt(priorityFees.length)).toString();
    const avgTotalFee = (totalFees.reduce((a, b) => a + b, BigInt(0)) / BigInt(totalFees.length)).toString();
    
    // Calculate min/max
    const minBaseFee = Math.min(...baseFees.map(n => Number(n))).toString();
    const maxBaseFee = Math.max(...baseFees.map(n => Number(n))).toString();
    
    // Calculate volatility (standard deviation / mean)
    const meanTotalFee = Number(avgTotalFee);
    const squaredDiffs = totalFees.map(fee => Math.pow(Number(fee) - meanTotalFee, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / totalFees.length;
    const stdDev = Math.sqrt(variance);
    const volatility = stdDev / meanTotalFee;
    
    // Determine trend
    const recentData = last24hData.slice(-10); // Last 10 data points
    if (recentData.length < 2) {
      throw new Error('Insufficient recent data for trend analysis');
    }
    
    const firstFee = BigInt(recentData[0].totalFee);
    const lastFee = BigInt(recentData[recentData.length - 1].totalFee);
    const percentChange = ((Number(lastFee) - Number(firstFee)) / Number(firstFee)) * 100;
    
    let trend: 'increasing' | 'decreasing' | 'stable';
    if (percentChange > 5) {
      trend = 'increasing';
    } else if (percentChange < -5) {
      trend = 'decreasing';
    } else {
      trend = 'stable';
    }
    
    return {
      currentBaseFee: this.currentGasPrice.baseFee,
      currentPriorityFee: this.currentGasPrice.priorityFee,
      currentTotalFee: this.currentGasPrice.totalFee,
      averageBaseFee24h: avgBaseFee,
      averagePriorityFee24h: avgPriorityFee,
      averageTotalFee24h: avgTotalFee,
      minBaseFee24h: minBaseFee,
      maxBaseFee24h: maxBaseFee,
      volatility24h: volatility,
      trend,
      predictions: this.gasPricePredictions,
      lastUpdated: this.lastUpdateTime || new Date()
    };
  }
  
  /**
   * Optimize gas price for a transaction
   * @param strategyName Name of the strategy to use
   * @param transactionValue Optional value of the transaction for prioritization
   * @param deadline Optional deadline for the transaction
   * @returns Optimized gas price
   */
  public async optimizeGasPrice(
    strategyName: string = this.config.defaultStrategy,
    transactionValue: string = '0',
    deadline?: Date
  ): Promise<{ baseFee: string; priorityFee: string; totalFee: string }> {
    if (!this.currentGasPrice) {
      await this.updateGasPrice();
      
      if (!this.currentGasPrice) {
        throw new Error('Gas price data not available');
      }
    }
    
    // Get the strategy
    const strategy = this.config.strategies.find(s => s.name === strategyName);
    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyName}`);
    }
    
    // Get base values
    let baseFee = BigInt(this.currentGasPrice.baseFee);
    let priorityFee = BigInt(this.currentGasPrice.priorityFee);
    
    // Apply strategy multipliers
    baseFee = (baseFee * BigInt(Math.floor(strategy.baseMultiplier * 100))) / BigInt(100);
    priorityFee = (priorityFee * BigInt(Math.floor(strategy.priorityMultiplier * 100))) / BigInt(100);
    
    // Apply time-based adjustment if enabled
    if (strategy.timeBasedAdjustment) {
      const hour = new Date().getHours();
      const isPeakHour = this.config.timeBasedSettings.peakHours.includes(hour);
      
      if (isPeakHour) {
        priorityFee = (priorityFee * BigInt(Math.floor(this.config.timeBasedSettings.peakMultiplier * 100))) / BigInt(100);
      } else {
        priorityFee = (priorityFee * BigInt(Math.floor(this.config.timeBasedSettings.offPeakMultiplier * 100))) / BigInt(100);
      }
    }
    
    // Apply value-based prioritization if enabled
    if (strategy.valueBasedPrioritization && transactionValue !== '0') {
      const valueMultiplier = this.calculateValueMultiplier(transactionValue);
      priorityFee = (priorityFee * BigInt(Math.floor(valueMultiplier * 100))) / BigInt(100);
    }
    
    // Apply deadline-based adjustment if provided
    if (deadline) {
      const now = new Date();
      const timeUntilDeadline = deadline.getTime() - now.getTime();
      
      if (timeUntilDeadline > 0) {
        // Adjust based on urgency
        const urgencyMultiplier = this.calculateUrgencyMultiplier(timeUntilDeadline);
        priorityFee = (priorityFee * BigInt(Math.floor(urgencyMultiplier * 100))) / BigInt(100);
      }
    }
    
    // Apply min/max constraints
    const minPriorityFee = BigInt(strategy.minPriorityFee);
    const maxPriorityFee = BigInt(strategy.maxPriorityFee);
    
    if (priorityFee < minPriorityFee) {
      priorityFee = minPriorityFee;
    } else if (priorityFee > maxPriorityFee) {
      priorityFee = maxPriorityFee;
    }
    
    // Calculate total fee
    const totalFee = baseFee + priorityFee;
    
    // Apply max total fee constraint
    const maxTotalFee = BigInt(strategy.maxTotalFee);
    if (totalFee > maxTotalFee) {
      // Reduce priority fee to meet max total fee
      priorityFee = maxTotalFee - baseFee;
      
      // Ensure priority fee is not negative
      if (priorityFee < BigInt(0)) {
        priorityFee = BigInt(0);
      }
    }
    
    return {
      baseFee: baseFee.toString(),
      priorityFee: priorityFee.toString(),
      totalFee: (baseFee + priorityFee).toString()
    };
  }
  
  /**
   * Optimize gas settings for a bundle
   * @param params Bundle gas optimization parameters
   * @returns Optimized gas settings for the bundle
   */
  public async optimizeBundleGas(params: BundleGasOptimizationParams): Promise<{
    baseFee: string;
    priorityFee: string;
    totalFee: string;
    gasLimit?: string;
    estimatedTimeToConfirmation?: number;
  }> {
    // Map priority level to strategy if provided
    let strategyName = params.strategy;
    if (params.priorityLevel) {
      switch (params.priorityLevel) {
        case 'low':
          strategyName = 'economic';
          break;
        case 'medium':
          strategyName = 'balanced';
          break;
        case 'high':
          strategyName = 'fast';
          break;
      }
    }
    
    // Optimize gas price
    const optimizedGas = await this.optimizeGasPrice(
      strategyName,
      params.valueThreshold || '0',
      params.deadline
    );
    
    // Apply max total fee constraint if provided
    if (params.maxTotalFee) {
      const maxTotalFee = BigInt(params.maxTotalFee);
      const totalFee = BigInt(optimizedGas.totalFee);
      
      if (totalFee > maxTotalFee) {
        // Reduce priority fee to meet max total fee
        let baseFee = BigInt(optimizedGas.baseFee);
        let priorityFee = maxTotalFee - baseFee;
        
        // Ensure priority fee is not negative
        if (priorityFee < BigInt(0)) {
          priorityFee = BigInt(0);
        }
        
        optimizedGas.priorityFee = priorityFee.toString();
        optimizedGas.totalFee = (baseFee + priorityFee).toString();
      }
    }
    
    // Estimate time to confirmation
    const estimatedTimeToConfirmation = this.estimateTimeToConfirmation(
      optimizedGas.totalFee,
      strategyName
    );
    
    return {
      ...optimizedGas,
      estimatedTimeToConfirmation
    };
  }
  
  /**
   * Predict gas price for a future time
   * @param minutesInFuture Minutes in the future to predict for
   * @returns Predicted gas price
   */
  public async predictGasPrice(minutesInFuture: number): Promise<GasPricePrediction> {
    if (!this.config.predictionEnabled) {
      throw new Error('Gas price prediction is disabled');
    }
    
    if (minutesInFuture <= 0) {
      throw new Error('Minutes in future must be positive');
    }
    
    if (!this.currentGasPrice) {
      await this.updateGasPrice();
      
      if (!this.currentGasPrice) {
        throw new Error('Gas price data not available');
      }
    }
    
    // Get historical data for prediction
    const historicalData = this.gasPriceHistory.slice(-this.config.historicalDataPoints);
    
    if (historicalData.length < 10) {
      throw new Error('Insufficient historical data for prediction');
    }
    
    let prediction: GasPricePrediction;
    
    // Choose prediction model
    switch (this.config.predictionModel) {
      case 'linear':
        prediction = this.linearPrediction(historicalData, minutesInFuture);
        break;
      case 'exponential':
        prediction = this.exponentialPrediction(historicalData, minutesInFuture);
        break;
      case 'ml':
        prediction = await this.mlPrediction(historicalData, minutesInFuture);
        break;
      default:
        prediction = this.linearPrediction(historicalData, minutesInFuture);
    }
    
    // Store prediction
    this.gasPricePredictions.push(prediction);
    
    // Keep only the latest predictions
    if (this.gasPricePredictions.length > 10) {
      this.gasPricePredictions = this.gasPricePredictions.slice(-10);
    }
    
    return prediction;
  }
  
  /**
   * Get gas price history
   * @param hours Number of hours of history to retrieve
   * @param interval Interval between data points in minutes
   * @returns Gas price history
   */
  public async getGasPriceHistory(hours: number = 24, interval: number = 15): Promise<GasPriceData[]> {
    try {
      const now = new Date();
      const startTime = new Date(now.getTime() - hours * 60 * 60 * 1000);
      
      // Query database for historical data
      const queryBuilder = this.gasPriceRepository.createQueryBuilder('gas_price')
        .where('gas_price.timestamp >= :startTime', { startTime })
        .orderBy('gas_price.timestamp', 'ASC');
      
      const allData = await queryBuilder.getMany();
      
      // Group data by interval
      const intervalMs = interval * 60 * 1000;
      const groupedData: Map<number, GasPriceData[]> = new Map();
      
      for (const data of allData) {
        const intervalKey = Math.floor(data.timestamp.getTime() / intervalMs);
        if (!groupedData.has(intervalKey)) {
          groupedData.set(intervalKey, []);
        }
        groupedData.get(intervalKey).push(data as unknown as GasPriceData);
      }
      
      // Get average for each interval
      const result: GasPriceData[] = [];
      
      for (const [intervalKey, dataPoints] of groupedData.entries()) {
        if (dataPoints.length === 0) continue;
        
        // Calculate averages
        const baseFees = dataPoints.map(data => BigInt(data.baseFee));
        const priorityFees = dataPoints.map(data => BigInt(data.priorityFee));
        const totalFees = dataPoints.map(data => BigInt(data.totalFee));
        
        const avgBaseFee = (baseFees.reduce((a, b) => a + b, BigInt(0)) / BigInt(baseFees.length)).toString();
        const avgPriorityFee = (priorityFees.reduce((a, b) => a + b, BigInt(0)) / BigInt(priorityFees.length)).toString();
        const avgTotalFee = (totalFees.reduce((a, b) => a + b, BigInt(0)) / BigInt(totalFees.length)).toString();
        
        // Use the middle timestamp for this interval
        const timestamp = new Date(intervalKey * intervalMs + intervalMs / 2);
        
        result.push({
          timestamp,
          baseFee: avgBaseFee,
          priorityFee: avgPriorityFee,
          totalFee: avgTotalFee,
          fastPriorityFee: dataPoints[0].fastPriorityFee,
          fastTotalFee: dataPoints[0].fastTotalFee,
          slowPriorityFee: dataPoints[0].slowPriorityFee,
          slowTotalFee: dataPoints[0].slowTotalFee,
          blockNumber: dataPoints[dataPoints.length - 1].blockNumber,
          networkUtilization: dataPoints.reduce((sum, data) => sum + data.networkUtilization, 0) / dataPoints.length,
          source: 'aggregated'
        });
      }
      
      return result;
    } catch (error) {
      throw new Error(`Failed to get gas price history: ${error.message}`);
    }
  }
  
  /**
   * Clean up old gas price data
   * @param days Number of days of data to retain
   * @returns Number of records deleted
   */
  public async cleanupOldData(days: number = this.config.dataRetentionDays): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      
      // Delete old data
      const result = await this.gasPriceRepository.createQueryBuilder()
        .delete()
        .where('timestamp < :cutoffDate', { cutoffDate })
        .execute();
      
      return result.affected || 0;
    } catch (error) {
      throw new Error(`Failed to clean up old data: ${error.message}`);
    }
  }
  
  /**
   * Update gas optimizer configuration
   * @param config Partial configuration to update
   */
  public updateConfig(config: Partial<GasOptimizerConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...config };
    
    // Restart update interval if running and interval changed
    if (this.running && oldConfig.updateIntervalMs !== this.config.updateIntervalMs && this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = setInterval(
        () => this.updateGasPrice(),
        this.config.updateIntervalMs
      );
    }
  }
  
  /**
   * Get current gas optimizer configuration
   * @returns Current configuration
   */
  public getConfig(): GasOptimizerConfig {
    return { ...this.config };
  }
  
  /**
   * Check if gas optimizer service is initialized
   * @returns True if initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }
  
  /**
   * Check if gas optimizer service is running
   * @returns True if running
   */
  public isRunning(): boolean {
    return this.running;
  }
  
  /**
   * Update gas price data
   * @private
   */
  private async updateGasPrice(): Promise<void> {
    try {
      // Skip if disabled
      if (!this.config.enabled) {
        return;
      }
      
      const monitoringService = MonitoringService.getInstance();
      
      // Collect gas price data from all enabled sources
      const gasPrices: GasPriceData[] = [];
      
      // On-chain source
      if (this.config.dataSources.onChain) {
        try {
          const onChainData = await this.getOnChainGasPrice();
          if (onChainData) {
            gasPrices.push(onChainData);
          }
        } catch (error) {
          await monitoringService.logEvent({
            source: 'GasOptimizerService',
            eventType: 'OnChainGasPriceError',
            severity: EventSeverity.WARNING,
            category: EventCategory.GAS,
            message: `Failed to get on-chain gas price: ${error.message}`
          });
        }
      }
      
      // Etherscan source
      if (this.config.dataSources.etherscan) {
        try {
          const etherscanData = await this.getEtherscanGasPrice();
          if (etherscanData) {
            gasPrices.push(etherscanData);
          }
        } catch (error) {
          await monitoringService.logEvent({
            source: 'GasOptimizerService',
            eventType: 'EtherscanGasPriceError',
            severity: EventSeverity.WARNING,
            category: EventCategory.GAS,
            message: `Failed to get Etherscan gas price: ${error.message}`
          });
        }
      }
      
      // Gas Station source
      if (this.config.dataSources.gasStation) {
        try {
          const gasStationData = await this.getGasStationGasPrice();
          if (gasStationData) {
            gasPrices.push(gasStationData);
          }
        } catch (error) {
          await monitoringService.logEvent({
            source: 'GasOptimizerService',
            eventType: 'GasStationGasPriceError',
            severity: EventSeverity.WARNING,
            category: EventCategory.GAS,
            message: `Failed to get Gas Station gas price: ${error.message}`
          });
        }
      }
      
      // Custom sources
      for (const customSource of this.config.dataSources.custom) {
        try {
          const customData = await this.getCustomGasPrice(customSource);
          if (customData) {
            gasPrices.push(customData);
          }
        } catch (error) {
          await monitoringService.logEvent({
            source: 'GasOptimizerService',
            eventType: 'CustomGasPriceError',
            severity: EventSeverity.WARNING,
            category: EventCategory.GAS,
            message: `Failed to get custom gas price from ${customSource}: ${error.message}`
          });
        }
      }
      
      // If no data was collected, use the last known price
      if (gasPrices.length === 0) {
        await monitoringService.logEvent({
          source: 'GasOptimizerService',
          eventType: 'NoGasPriceData',
          severity: EventSeverity.WARNING,
          category: EventCategory.GAS,
          message: 'Failed to get gas price data from any source'
        });
        
        return;
      }
      
      // Calculate aggregated gas price
      const aggregatedGasPrice = this.aggregateGasPrices(gasPrices);
      
      // Update current gas price
      this.currentGasPrice = aggregatedGasPrice;
      this.lastUpdateTime = new Date();
      
      // Add to history
      this.gasPriceHistory.push(aggregatedGasPrice);
      
      // Keep history size manageable
      const maxHistorySize = Math.max(1000, this.config.historicalDataPoints * 2);
      if (this.gasPriceHistory.length > maxHistorySize) {
        this.gasPriceHistory = this.gasPriceHistory.slice(-maxHistorySize);
      }
      
      // Save to database
      await this.saveGasPriceToDatabase(aggregatedGasPrice);
      
      // Update predictions if enabled
      if (this.config.predictionEnabled) {
        try {
          await this.predictGasPrice(15); // 15 minutes prediction
        } catch (error) {
          // Ignore prediction errors
        }
      }
      
      // Record metric
      await monitoringService.recordMetric({
        metricType: 'gas.price.total',
        source: 'GasOptimizerService',
        value: Number(aggregatedGasPrice.totalFee) / 1e9, // Convert to Gwei for readability
        unit: 'Gwei'
      });
      
      await monitoringService.recordMetric({
        metricType: 'gas.price.base',
        source: 'GasOptimizerService',
        value: Number(aggregatedGasPrice.baseFee) / 1e9,
        unit: 'Gwei'
      });
      
      await monitoringService.recordMetric({
        metricType: 'gas.price.priority',
        source: 'GasOptimizerService',
        value: Number(aggregatedGasPrice.priorityFee) / 1e9,
        unit: 'Gwei'
      });
    } catch (error) {
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'GasOptimizerService',
        eventType: 'UpdateGasPriceError',
        severity: EventSeverity.ERROR,
        category: EventCategory.GAS,
        message: `Failed to update gas price: ${error.message}`
      });
    }
  }
  
  /**
   * Get on-chain gas price
   * @returns Gas price data from on-chain source
   * @private
   */
  private async getOnChainGasPrice(): Promise<GasPriceData | null> {
    // This would normally use a web3 provider to get on-chain data
    // For simulation, we'll return a mock response
    
    // Check cache first
    const cacheKey = 'onchain';
    const cachedData = this.getCachedData(cacheKey);
    if (cachedData) {
      return {
        ...cachedData,
        source: 'on-chain'
      };
    }
    
    // Simulate on-chain data
    const baseFee = (20000000000 + Math.floor(Math.random() * 5000000000)).toString(); // 20-25 Gwei
    const priorityFee = (1500000000 + Math.floor(Math.random() * 1000000000)).toString(); // 1.5-2.5 Gwei
    const totalFee = (BigInt(baseFee) + BigInt(priorityFee)).toString();
    
    const data: GasPriceData = {
      timestamp: new Date(),
      baseFee,
      priorityFee,
      totalFee,
      fastPriorityFee: (BigInt(priorityFee) * BigInt(2)).toString(),
      fastTotalFee: (BigInt(baseFee) + BigInt(priorityFee) * BigInt(2)).toString(),
      slowPriorityFee: (BigInt(priorityFee) / BigInt(2)).toString(),
      slowTotalFee: (BigInt(baseFee) + BigInt(priorityFee) / BigInt(2)).toString(),
      blockNumber: 12345678,
      networkUtilization: 0.75,
      source: 'on-chain'
    };
    
    // Cache the data
    this.setCachedData(cacheKey, data);
    
    return data;
  }
  
  /**
   * Get Etherscan gas price
   * @returns Gas price data from Etherscan
   * @private
   */
  private async getEtherscanGasPrice(): Promise<GasPriceData | null> {
    // Check cache first
    const cacheKey = 'etherscan';
    const cachedData = this.getCachedData(cacheKey);
    if (cachedData) {
      return {
        ...cachedData,
        source: 'etherscan'
      };
    }
    
    try {
      // In a real implementation, this would call the Etherscan API
      // For simulation, we'll return a mock response
      
      // Simulate API response
      const baseFee = (21000000000 + Math.floor(Math.random() * 4000000000)).toString(); // 21-25 Gwei
      const priorityFee = (1800000000 + Math.floor(Math.random() * 800000000)).toString(); // 1.8-2.6 Gwei
      const totalFee = (BigInt(baseFee) + BigInt(priorityFee)).toString();
      
      const data: GasPriceData = {
        timestamp: new Date(),
        baseFee,
        priorityFee,
        totalFee,
        fastPriorityFee: (BigInt(priorityFee) * BigInt(2)).toString(),
        fastTotalFee: (BigInt(baseFee) + BigInt(priorityFee) * BigInt(2)).toString(),
        slowPriorityFee: (BigInt(priorityFee) / BigInt(2)).toString(),
        slowTotalFee: (BigInt(baseFee) + BigInt(priorityFee) / BigInt(2)).toString(),
        blockNumber: 12345679,
        networkUtilization: 0.8,
        source: 'etherscan'
      };
      
      // Cache the data
      this.setCachedData(cacheKey, data);
      
      return data;
    } catch (error) {
      throw new Error(`Etherscan API error: ${error.message}`);
    }
  }
  
  /**
   * Get Gas Station gas price
   * @returns Gas price data from Gas Station
   * @private
   */
  private async getGasStationGasPrice(): Promise<GasPriceData | null> {
    // Check cache first
    const cacheKey = 'gasstation';
    const cachedData = this.getCachedData(cacheKey);
    if (cachedData) {
      return {
        ...cachedData,
        source: 'gas-station'
      };
    }
    
    try {
      // In a real implementation, this would call the Gas Station API
      // For simulation, we'll return a mock response
      
      // Simulate API response
      const baseFee = (19500000000 + Math.floor(Math.random() * 5500000000)).toString(); // 19.5-25 Gwei
      const priorityFee = (1600000000 + Math.floor(Math.random() * 1200000000)).toString(); // 1.6-2.8 Gwei
      const totalFee = (BigInt(baseFee) + BigInt(priorityFee)).toString();
      
      const data: GasPriceData = {
        timestamp: new Date(),
        baseFee,
        priorityFee,
        totalFee,
        fastPriorityFee: (3000000000 + Math.floor(Math.random() * 2000000000)).toString(), // 3-5 Gwei
        fastTotalFee: (BigInt(baseFee) + BigInt(3000000000 + Math.floor(Math.random() * 2000000000))).toString(),
        slowPriorityFee: (500000000 + Math.floor(Math.random() * 500000000)).toString(), // 0.5-1 Gwei
        slowTotalFee: (BigInt(baseFee) + BigInt(500000000 + Math.floor(Math.random() * 500000000))).toString(),
        blockNumber: 12345680,
        networkUtilization: 0.7,
        source: 'gas-station'
      };
      
      // Cache the data
      this.setCachedData(cacheKey, data);
      
      return data;
    } catch (error) {
      throw new Error(`Gas Station API error: ${error.message}`);
    }
  }
  
  /**
   * Get custom gas price
   * @param source Custom source URL
   * @returns Gas price data from custom source
   * @private
   */
  private async getCustomGasPrice(source: string): Promise<GasPriceData | null> {
    // Check cache first
    const cacheKey = `custom:${source}`;
    const cachedData = this.getCachedData(cacheKey);
    if (cachedData) {
      return {
        ...cachedData,
        source: `custom:${source}`
      };
    }
    
    try {
      // In a real implementation, this would call the custom API
      // For simulation, we'll return a mock response
      
      // Simulate API response
      const baseFee = (20500000000 + Math.floor(Math.random() * 4500000000)).toString(); // 20.5-25 Gwei
      const priorityFee = (1700000000 + Math.floor(Math.random() * 1000000000)).toString(); // 1.7-2.7 Gwei
      const totalFee = (BigInt(baseFee) + BigInt(priorityFee)).toString();
      
      const data: GasPriceData = {
        timestamp: new Date(),
        baseFee,
        priorityFee,
        totalFee,
        fastPriorityFee: (BigInt(priorityFee) * BigInt(2)).toString(),
        fastTotalFee: (BigInt(baseFee) + BigInt(priorityFee) * BigInt(2)).toString(),
        slowPriorityFee: (BigInt(priorityFee) / BigInt(2)).toString(),
        slowTotalFee: (BigInt(baseFee) + BigInt(priorityFee) / BigInt(2)).toString(),
        blockNumber: 12345681,
        networkUtilization: 0.65,
        source: `custom:${source}`
      };
      
      // Cache the data
      this.setCachedData(cacheKey, data);
      
      return data;
    } catch (error) {
      throw new Error(`Custom API error (${source}): ${error.message}`);
    }
  }
  
  /**
   * Aggregate gas prices from multiple sources
   * @param gasPrices Gas price data from multiple sources
   * @returns Aggregated gas price data
   * @private
   */
  private aggregateGasPrices(gasPrices: GasPriceData[]): GasPriceData {
    if (gasPrices.length === 0) {
      throw new Error('No gas price data to aggregate');
    }
    
    if (gasPrices.length === 1) {
      return gasPrices[0];
    }
    
    // Calculate median values
    const baseFees = gasPrices.map(data => BigInt(data.baseFee)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const priorityFees = gasPrices.map(data => BigInt(data.priorityFee)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const fastPriorityFees = gasPrices.map(data => BigInt(data.fastPriorityFee)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const slowPriorityFees = gasPrices.map(data => BigInt(data.slowPriorityFee)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    
    const medianBaseFee = baseFees[Math.floor(baseFees.length / 2)].toString();
    const medianPriorityFee = priorityFees[Math.floor(priorityFees.length / 2)].toString();
    const medianFastPriorityFee = fastPriorityFees[Math.floor(fastPriorityFees.length / 2)].toString();
    const medianSlowPriorityFee = slowPriorityFees[Math.floor(slowPriorityFees.length / 2)].toString();
    
    // Calculate total fees
    const totalFee = (BigInt(medianBaseFee) + BigInt(medianPriorityFee)).toString();
    const fastTotalFee = (BigInt(medianBaseFee) + BigInt(medianFastPriorityFee)).toString();
    const slowTotalFee = (BigInt(medianBaseFee) + BigInt(medianSlowPriorityFee)).toString();
    
    // Calculate average network utilization
    const avgNetworkUtilization = gasPrices.reduce((sum, data) => sum + data.networkUtilization, 0) / gasPrices.length;
    
    // Use the latest block number
    const latestBlockNumber = Math.max(...gasPrices.map(data => data.blockNumber));
    
    return {
      timestamp: new Date(),
      baseFee: medianBaseFee,
      priorityFee: medianPriorityFee,
      totalFee,
      fastPriorityFee: medianFastPriorityFee,
      fastTotalFee,
      slowPriorityFee: medianSlowPriorityFee,
      slowTotalFee,
      blockNumber: latestBlockNumber,
      networkUtilization: avgNetworkUtilization,
      source: 'aggregated'
    };
  }
  
  /**
   * Save gas price data to database
   * @param gasPrice Gas price data to save
   * @private
   */
  private async saveGasPriceToDatabase(gasPrice: GasPriceData): Promise<void> {
    try {
      const gasPriceEntity = new GasPrice();
      gasPriceEntity.timestamp = gasPrice.timestamp;
      gasPriceEntity.baseFee = gasPrice.baseFee;
      gasPriceEntity.priorityFee = gasPrice.priorityFee;
      gasPriceEntity.totalFee = gasPrice.totalFee;
      gasPriceEntity.fastPriorityFee = gasPrice.fastPriorityFee;
      gasPriceEntity.fastTotalFee = gasPrice.fastTotalFee;
      gasPriceEntity.slowPriorityFee = gasPrice.slowPriorityFee;
      gasPriceEntity.slowTotalFee = gasPrice.slowTotalFee;
      gasPriceEntity.blockNumber = gasPrice.blockNumber;
      gasPriceEntity.networkUtilization = gasPrice.networkUtilization;
      gasPriceEntity.source = gasPrice.source;
      
      await this.gasPriceRepository.save(gasPriceEntity);
    } catch (error) {
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'GasOptimizerService',
        eventType: 'SaveGasPriceError',
        severity: EventSeverity.ERROR,
        category: EventCategory.GAS,
        message: `Failed to save gas price to database: ${error.message}`
      });
    }
  }
  
  /**
   * Load historical gas price data
   * @private
   */
  private async loadHistoricalGasPriceData(): Promise<void> {
    try {
      // Get recent gas price data from database
      const queryBuilder = this.gasPriceRepository.createQueryBuilder('gas_price')
        .orderBy('gas_price.timestamp', 'DESC')
        .take(this.config.historicalDataPoints);
      
      const data = await queryBuilder.getMany();
      
      // Convert to GasPriceData and add to history
      this.gasPriceHistory = data.map(item => ({
        timestamp: item.timestamp,
        baseFee: item.baseFee,
        priorityFee: item.priorityFee,
        totalFee: item.totalFee,
        fastPriorityFee: item.fastPriorityFee,
        fastTotalFee: item.fastTotalFee,
        slowPriorityFee: item.slowPriorityFee,
        slowTotalFee: item.slowTotalFee,
        blockNumber: item.blockNumber,
        networkUtilization: item.networkUtilization,
        source: item.source
      })).reverse(); // Reverse to get chronological order
      
      // Set current gas price if available
      if (this.gasPriceHistory.length > 0) {
        this.currentGasPrice = this.gasPriceHistory[this.gasPriceHistory.length - 1];
        this.lastUpdateTime = this.currentGasPrice.timestamp;
      }
    } catch (error) {
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'GasOptimizerService',
        eventType: 'LoadHistoricalDataError',
        severity: EventSeverity.ERROR,
        category: EventCategory.GAS,
        message: `Failed to load historical gas price data: ${error.message}`
      });
    }
  }
  
  /**
   * Get cached data
   * @param key Cache key
   * @returns Cached data or null if not found or expired
   * @private
   */
  private getCachedData(key: string): any {
    const cachedItem = this.gasPriceCache.get(key);
    
    if (!cachedItem) {
      return null;
    }
    
    // Check if expired
    if (Date.now() - cachedItem.timestamp > this.config.cacheTTLMs) {
      this.gasPriceCache.delete(key);
      return null;
    }
    
    return cachedItem.data;
  }
  
  /**
   * Set cached data
   * @param key Cache key
   * @param data Data to cache
   * @private
   */
  private setCachedData(key: string, data: any): void {
    this.gasPriceCache.set(key, {
      data,
      timestamp: Date.now()
    });
  }
  
  /**
   * Calculate value multiplier for gas price optimization
   * @param transactionValue Transaction value
   * @returns Multiplier for priority fee
   * @private
   */
  private calculateValueMultiplier(transactionValue: string): number {
    // Convert value to number for comparison
    const value = Number(transactionValue);
    
    // Define thresholds
    const lowThreshold = 1e18; // 1 ETH
    const mediumThreshold = 10e18; // 10 ETH
    const highThreshold = 100e18; // 100 ETH
    
    // Calculate multiplier based on value
    if (value <= 0) {
      return 1.0; // Default multiplier
    } else if (value < lowThreshold) {
      return 1.0; // No boost for small transactions
    } else if (value < mediumThreshold) {
      return 1.2; // 20% boost for medium transactions
    } else if (value < highThreshold) {
      return 1.5; // 50% boost for large transactions
    } else {
      return 2.0; // 100% boost for very large transactions
    }
  }
  
  /**
   * Calculate urgency multiplier for gas price optimization
   * @param timeUntilDeadlineMs Time until deadline in milliseconds
   * @returns Multiplier for priority fee
   * @private
   */
  private calculateUrgencyMultiplier(timeUntilDeadlineMs: number): number {
    // Define thresholds
    const urgentThreshold = 60000; // 1 minute
    const highThreshold = 300000; // 5 minutes
    const mediumThreshold = 900000; // 15 minutes
    
    // Calculate multiplier based on time until deadline
    if (timeUntilDeadlineMs <= urgentThreshold) {
      return 2.0; // 100% boost for urgent transactions
    } else if (timeUntilDeadlineMs <= highThreshold) {
      return 1.5; // 50% boost for high urgency transactions
    } else if (timeUntilDeadlineMs <= mediumThreshold) {
      return 1.2; // 20% boost for medium urgency transactions
    } else {
      return 1.0; // No boost for low urgency transactions
    }
  }
  
  /**
   * Estimate time to confirmation
   * @param totalFee Total fee
   * @param strategyName Strategy name
   * @returns Estimated time to confirmation in seconds
   * @private
   */
  private estimateTimeToConfirmation(totalFee: string, strategyName: string): number {
    // This is a simplified estimation model
    // In a real implementation, this would use historical data and network conditions
    
    // Base time for different strategies
    const baseTimeByStrategy: Record<string, number> = {
      economic: 120, // 2 minutes
      balanced: 60, // 1 minute
      fast: 30, // 30 seconds
      urgent: 15 // 15 seconds
    };
    
    const baseTime = baseTimeByStrategy[strategyName] || 60;
    
    // Adjust based on current network conditions
    let adjustedTime = baseTime;
    
    if (this.currentGasPrice) {
      // Compare with current gas price
      const currentTotalFee = BigInt(this.currentGasPrice.totalFee);
      const providedTotalFee = BigInt(totalFee);
      
      // Calculate ratio
      const ratio = Number(providedTotalFee * BigInt(100) / currentTotalFee) / 100;
      
      // Adjust time based on ratio
      if (ratio >= 2.0) {
        // Much higher than current price, faster confirmation
        adjustedTime = Math.max(5, Math.floor(baseTime / 3));
      } else if (ratio >= 1.5) {
        // Higher than current price, faster confirmation
        adjustedTime = Math.max(10, Math.floor(baseTime / 2));
      } else if (ratio >= 1.2) {
        // Slightly higher than current price, slightly faster confirmation
        adjustedTime = Math.max(15, Math.floor(baseTime * 0.75));
      } else if (ratio >= 1.0) {
        // Equal to current price, standard confirmation time
        adjustedTime = baseTime;
      } else if (ratio >= 0.8) {
        // Slightly lower than current price, slightly slower confirmation
        adjustedTime = Math.floor(baseTime * 1.5);
      } else if (ratio >= 0.5) {
        // Lower than current price, slower confirmation
        adjustedTime = Math.floor(baseTime * 2);
      } else {
        // Much lower than current price, much slower confirmation
        adjustedTime = Math.floor(baseTime * 3);
      }
      
      // Adjust based on network utilization
      if (this.currentGasPrice.networkUtilization > 0.9) {
        // Very high utilization, slower confirmation
        adjustedTime = Math.floor(adjustedTime * 1.5);
      } else if (this.currentGasPrice.networkUtilization > 0.7) {
        // High utilization, slightly slower confirmation
        adjustedTime = Math.floor(adjustedTime * 1.2);
      } else if (this.currentGasPrice.networkUtilization < 0.3) {
        // Low utilization, faster confirmation
        adjustedTime = Math.max(5, Math.floor(adjustedTime * 0.8));
      }
    }
    
    return adjustedTime;
  }
  
  /**
   * Linear prediction model for gas price
   * @param historicalData Historical gas price data
   * @param minutesInFuture Minutes in the future to predict for
   * @returns Predicted gas price
   * @private
   */
  private linearPrediction(historicalData: GasPriceData[], minutesInFuture: number): GasPricePrediction {
    // Get recent data points
    const recentData = historicalData.slice(-20);
    
    if (recentData.length < 2) {
      throw new Error('Insufficient data for linear prediction');
    }
    
    // Calculate linear regression for base fee
    const baseFeeRegression = this.calculateLinearRegression(
      recentData.map(data => data.timestamp.getTime()),
      recentData.map(data => Number(data.baseFee))
    );
    
    // Calculate linear regression for priority fee
    const priorityFeeRegression = this.calculateLinearRegression(
      recentData.map(data => data.timestamp.getTime()),
      recentData.map(data => Number(data.priorityFee))
    );
    
    // Predict future values
    const futureTime = Date.now() + minutesInFuture * 60 * 1000;
    const predictedBaseFee = Math.max(0, Math.round(baseFeeRegression.slope * futureTime + baseFeeRegression.intercept));
    const predictedPriorityFee = Math.max(0, Math.round(priorityFeeRegression.slope * futureTime + priorityFeeRegression.intercept));
    const predictedTotalFee = predictedBaseFee + predictedPriorityFee;
    
    // Calculate confidence based on R-squared
    const confidence = (baseFeeRegression.r2 + priorityFeeRegression.r2) / 2;
    
    // Determine timeframe
    let timeframe: '1min' | '5min' | '15min' | '30min' | '1hour';
    if (minutesInFuture <= 1) {
      timeframe = '1min';
    } else if (minutesInFuture <= 5) {
      timeframe = '5min';
    } else if (minutesInFuture <= 15) {
      timeframe = '15min';
    } else if (minutesInFuture <= 30) {
      timeframe = '30min';
    } else {
      timeframe = '1hour';
    }
    
    return {
      timestamp: new Date(futureTime),
      baseFee: predictedBaseFee.toString(),
      priorityFee: predictedPriorityFee.toString(),
      totalFee: predictedTotalFee.toString(),
      confidence,
      timeframe
    };
  }
  
  /**
   * Exponential prediction model for gas price
   * @param historicalData Historical gas price data
   * @param minutesInFuture Minutes in the future to predict for
   * @returns Predicted gas price
   * @private
   */
  private exponentialPrediction(historicalData: GasPriceData[], minutesInFuture: number): GasPricePrediction {
    // This is a simplified implementation
    // In a real implementation, this would use more sophisticated exponential models
    
    // Get recent data points
    const recentData = historicalData.slice(-20);
    
    if (recentData.length < 2) {
      throw new Error('Insufficient data for exponential prediction');
    }
    
    // Calculate exponential moving average
    const alpha = 0.3; // Smoothing factor
    
    let emaBaseFee = Number(recentData[0].baseFee);
    let emaPriorityFee = Number(recentData[0].priorityFee);
    
    for (let i = 1; i < recentData.length; i++) {
      emaBaseFee = alpha * Number(recentData[i].baseFee) + (1 - alpha) * emaBaseFee;
      emaPriorityFee = alpha * Number(recentData[i].priorityFee) + (1 - alpha) * emaPriorityFee;
    }
    
    // Calculate rate of change
    const lastFewData = recentData.slice(-5);
    const baseFeeRateOfChange = this.calculateRateOfChange(lastFewData.map(data => Number(data.baseFee)));
    const priorityFeeRateOfChange = this.calculateRateOfChange(lastFewData.map(data => Number(data.priorityFee)));
    
    // Predict future values
    const predictedBaseFee = Math.max(0, Math.round(emaBaseFee * Math.pow(1 + baseFeeRateOfChange, minutesInFuture / 5)));
    const predictedPriorityFee = Math.max(0, Math.round(emaPriorityFee * Math.pow(1 + priorityFeeRateOfChange, minutesInFuture / 5)));
    const predictedTotalFee = predictedBaseFee + predictedPriorityFee;
    
    // Calculate confidence based on volatility
    const volatility = this.calculateVolatility(lastFewData.map(data => Number(data.totalFee)));
    const confidence = Math.max(0, Math.min(1, 1 - volatility));
    
    // Determine timeframe
    let timeframe: '1min' | '5min' | '15min' | '30min' | '1hour';
    if (minutesInFuture <= 1) {
      timeframe = '1min';
    } else if (minutesInFuture <= 5) {
      timeframe = '5min';
    } else if (minutesInFuture <= 15) {
      timeframe = '15min';
    } else if (minutesInFuture <= 30) {
      timeframe = '30min';
    } else {
      timeframe = '1hour';
    }
    
    return {
      timestamp: new Date(Date.now() + minutesInFuture * 60 * 1000),
      baseFee: predictedBaseFee.toString(),
      priorityFee: predictedPriorityFee.toString(),
      totalFee: predictedTotalFee.toString(),
      confidence,
      timeframe
    };
  }
  
  /**
   * Machine learning prediction model for gas price
   * @param historicalData Historical gas price data
   * @param minutesInFuture Minutes in the future to predict for
   * @returns Predicted gas price
   * @private
   */
  private async mlPrediction(historicalData: GasPriceData[], minutesInFuture: number): Promise<GasPricePrediction> {
    // This would normally use a machine learning model
    // For simulation, we'll use a combination of linear and exponential predictions
    
    const linearPred = this.linearPrediction(historicalData, minutesInFuture);
    const expPred = this.exponentialPrediction(historicalData, minutesInFuture);
    
    // Weight predictions based on confidence
    const totalConfidence = linearPred.confidence + expPred.confidence;
    const linearWeight = linearPred.confidence / totalConfidence;
    const expWeight = expPred.confidence / totalConfidence;
    
    const predictedBaseFee = Math.round(
      linearWeight * Number(linearPred.baseFee) + expWeight * Number(expPred.baseFee)
    );
    
    const predictedPriorityFee = Math.round(
      linearWeight * Number(linearPred.priorityFee) + expWeight * Number(expPred.priorityFee)
    );
    
    const predictedTotalFee = predictedBaseFee + predictedPriorityFee;
    
    // Calculate combined confidence
    const confidence = (linearPred.confidence + expPred.confidence) / 2;
    
    return {
      timestamp: new Date(Date.now() + minutesInFuture * 60 * 1000),
      baseFee: predictedBaseFee.toString(),
      priorityFee: predictedPriorityFee.toString(),
      totalFee: predictedTotalFee.toString(),
      confidence,
      timeframe: linearPred.timeframe
    };
  }
  
  /**
   * Calculate linear regression
   * @param x X values
   * @param y Y values
   * @returns Linear regression parameters
   * @private
   */
  private calculateLinearRegression(x: number[], y: number[]): { slope: number; intercept: number; r2: number } {
    const n = x.length;
    
    // Calculate means
    const meanX = x.reduce((sum, val) => sum + val, 0) / n;
    const meanY = y.reduce((sum, val) => sum + val, 0) / n;
    
    // Calculate slope and intercept
    let numerator = 0;
    let denominator = 0;
    
    for (let i = 0; i < n; i++) {
      numerator += (x[i] - meanX) * (y[i] - meanY);
      denominator += Math.pow(x[i] - meanX, 2);
    }
    
    const slope = denominator !== 0 ? numerator / denominator : 0;
    const intercept = meanY - slope * meanX;
    
    // Calculate R-squared
    let ssTotal = 0;
    let ssResidual = 0;
    
    for (let i = 0; i < n; i++) {
      const predicted = slope * x[i] + intercept;
      ssTotal += Math.pow(y[i] - meanY, 2);
      ssResidual += Math.pow(y[i] - predicted, 2);
    }
    
    const r2 = ssTotal !== 0 ? 1 - ssResidual / ssTotal : 0;
    
    return { slope, intercept, r2 };
  }
  
  /**
   * Calculate rate of change
   * @param values Values to calculate rate of change for
   * @returns Rate of change
   * @private
   */
  private calculateRateOfChange(values: number[]): number {
    if (values.length < 2) {
      return 0;
    }
    
    const first = values[0];
    const last = values[values.length - 1];
    
    if (first === 0) {
      return 0;
    }
    
    return (last - first) / first;
  }
  
  /**
   * Calculate volatility
   * @param values Values to calculate volatility for
   * @returns Volatility
   * @private
   */
  private calculateVolatility(values: number[]): number {
    if (values.length < 2) {
      return 0;
    }
    
    // Calculate mean
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    
    // Calculate standard deviation
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    // Calculate coefficient of variation (volatility)
    return mean !== 0 ? stdDev / mean : 0;
  }
}
