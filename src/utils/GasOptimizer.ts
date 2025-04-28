// English comment for verification
/**
 * @file GasOptimizer.ts
 * @description Advanced gas optimization service for Layer-2 transactions
 * @author Manus AI
 * @date April 27, 2025
 */

import { Logger } from '../utils/Logger';
import { MetricsService } from '../monitoring/MetricsService';
import { CacheService } from '../utils/CacheService';
import { DatabaseService } from '../database/database.service';
import { EventEmitter } from 'events';

/**
 * Gas price prediction model type
 */
export enum GasPricePredictionModel {
  LINEAR = 'linear',
  EXPONENTIAL = 'exponential',
  MOVING_AVERAGE = 'moving_average',
  MACHINE_LEARNING = 'machine_learning',
  HYBRID = 'hybrid'
}

/**
 * Gas optimization strategy type
 */
export enum GasOptimizationStrategy {
  ECONOMIC = 'economic',
  BALANCED = 'balanced',
  FAST = 'fast',
  URGENT = 'urgent',
  CUSTOM = 'custom'
}

/**
 * Gas price data interface
 */
export interface GasPriceData {
  timestamp: number;
  slow: number;
  average: number;
  fast: number;
  urgent: number;
  baseFee?: number;
  priorityFee?: number;
  source: string;
}

/**
 * Gas optimizer configuration interface
 */
export interface GasOptimizerConfig {
  // Data sources
  dataSources: {
    useOnChain: boolean;
    useEtherscan: boolean;
    useGasStation: boolean;
    customSources: string[];
    updateInterval: number; // in milliseconds
    maxDataAge: number; // in milliseconds
  };
  
  // Prediction models
  predictionModels: {
    enabled: boolean;
    defaultModel: GasPricePredictionModel;
    historyLength: number; // number of data points to use
    predictionHorizon: number; // in milliseconds
    updateInterval: number; // in milliseconds
  };
  
  // Optimization strategies
  strategies: {
    [GasOptimizationStrategy.ECONOMIC]: {
      percentile: number; // 0-100
      maxWaitTime: number; // in milliseconds
      multiplier: number;
    };
    [GasOptimizationStrategy.BALANCED]: {
      percentile: number;
      maxWaitTime: number;
      multiplier: number;
    };
    [GasOptimizationStrategy.FAST]: {
      percentile: number;
      maxWaitTime: number;
      multiplier: number;
    };
    [GasOptimizationStrategy.URGENT]: {
      percentile: number;
      maxWaitTime: number;
      multiplier: number;
    };
    defaultStrategy: GasOptimizationStrategy;
  };
  
  // Value-based optimization
  valueBasedOptimization: {
    enabled: boolean;
    thresholds: {
      low: number;
      medium: number;
      high: number;
      veryHigh: number;
    };
    strategyMapping: {
      low: GasOptimizationStrategy;
      medium: GasOptimizationStrategy;
      high: GasOptimizationStrategy;
      veryHigh: GasOptimizationStrategy;
    };
  };
  
  // Database settings
  database: {
    enabled: boolean;
    retentionPeriod: number; // in milliseconds
    pruneInterval: number; // in milliseconds
  };
}

/**
 * Default gas optimizer configuration
 */
const DEFAULT_CONFIG: GasOptimizerConfig = {
  dataSources: {
    useOnChain: true,
    useEtherscan: true,
    useGasStation: true,
    customSources: [],
    updateInterval: 15000, // 15 seconds
    maxDataAge: 60000, // 1 minute
  },
  
  predictionModels: {
    enabled: true,
    defaultModel: GasPricePredictionModel.HYBRID,
    historyLength: 100,
    predictionHorizon: 300000, // 5 minutes
    updateInterval: 60000, // 1 minute
  },
  
  strategies: {
    [GasOptimizationStrategy.ECONOMIC]: {
      percentile: 10,
      maxWaitTime: 600000, // 10 minutes
      multiplier: 1.0,
    },
    [GasOptimizationStrategy.BALANCED]: {
      percentile: 50,
      maxWaitTime: 180000, // 3 minutes
      multiplier: 1.1,
    },
    [GasOptimizationStrategy.FAST]: {
      percentile: 80,
      maxWaitTime: 60000, // 1 minute
      multiplier: 1.2,
    },
    [GasOptimizationStrategy.URGENT]: {
      percentile: 95,
      maxWaitTime: 15000, // 15 seconds
      multiplier: 1.5,
    },
    defaultStrategy: GasOptimizationStrategy.BALANCED,
  },
  
  valueBasedOptimization: {
    enabled: true,
    thresholds: {
      low: 100, // $100
      medium: 1000, // $1,000
      high: 10000, // $10,000
      veryHigh: 100000, // $100,000
    },
    strategyMapping: {
      low: GasOptimizationStrategy.ECONOMIC,
      medium: GasOptimizationStrategy.BALANCED,
      high: GasOptimizationStrategy.FAST,
      veryHigh: GasOptimizationStrategy.URGENT,
    },
  },
  
  database: {
    enabled: true,
    retentionPeriod: 30 * 24 * 60 * 60 * 1000, // 30 days
    pruneInterval: 24 * 60 * 60 * 1000, // 1 day
  },
};

/**
 * GasOptimizer class - Advanced gas optimization service for Layer-2 transactions
 */
export class GasOptimizer extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: GasOptimizerConfig;
  private readonly metricsService: MetricsService;
  private readonly cacheService: CacheService;
  private readonly databaseService: DatabaseService;
  
  // Internal state
  private isRunning: boolean = false;
  private dataUpdateIntervalId: NodeJS.Timeout | null = null;
  private predictionUpdateIntervalId: NodeJS.Timeout | null = null;
  private pruneIntervalId: NodeJS.Timeout | null = null;
  private gasPriceHistory: GasPriceData[] = [];
  private currentGasPrice: GasPriceData | null = null;
  private predictedGasPrices: Map<GasPricePredictionModel, GasPriceData> = new Map();
  
  /**
   * Constructor for the GasOptimizer
   * 
   * @param databaseService - Database service for storing gas price data
   * @param metricsService - Metrics service for monitoring performance
   * @param cacheService - Cache service for optimizing data access
   * @param logger - Logger instance
   * @param config - Configuration for the gas optimizer
   */
  constructor(
    databaseService: DatabaseService,
    metricsService: MetricsService,
    cacheService: CacheService,
    logger: Logger,
    config: Partial<GasOptimizerConfig> = {}
  ) {
    super();
    
    this.databaseService = databaseService;
    this.metricsService = metricsService;
    this.cacheService = cacheService;
    this.logger = logger.createChild('GasOptimizer');
    
    // Merge provided config with defaults
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      dataSources: {
        ...DEFAULT_CONFIG.dataSources,
        ...(config.dataSources || {}),
      },
      predictionModels: {
        ...DEFAULT_CONFIG.predictionModels,
        ...(config.predictionModels || {}),
      },
      strategies: {
        ...DEFAULT_CONFIG.strategies,
        ...(config.strategies || {}),
        [GasOptimizationStrategy.ECONOMIC]: {
          ...DEFAULT_CONFIG.strategies[GasOptimizationStrategy.ECONOMIC],
          ...(config.strategies?.[GasOptimizationStrategy.ECONOMIC] || {}),
        },
        [GasOptimizationStrategy.BALANCED]: {
          ...DEFAULT_CONFIG.strategies[GasOptimizationStrategy.BALANCED],
          ...(config.strategies?.[GasOptimizationStrategy.BALANCED] || {}),
        },
        [GasOptimizationStrategy.FAST]: {
          ...DEFAULT_CONFIG.strategies[GasOptimizationStrategy.FAST],
          ...(config.strategies?.[GasOptimizationStrategy.FAST] || {}),
        },
        [GasOptimizationStrategy.URGENT]: {
          ...DEFAULT_CONFIG.strategies[GasOptimizationStrategy.URGENT],
          ...(config.strategies?.[GasOptimizationStrategy.URGENT] || {}),
        },
      },
      valueBasedOptimization: {
        ...DEFAULT_CONFIG.valueBasedOptimization,
        ...(config.valueBasedOptimization || {}),
        thresholds: {
          ...DEFAULT_CONFIG.valueBasedOptimization.thresholds,
          ...(config.valueBasedOptimization?.thresholds || {}),
        },
        strategyMapping: {
          ...DEFAULT_CONFIG.valueBasedOptimization.strategyMapping,
          ...(config.valueBasedOptimization?.strategyMapping || {}),
        },
      },
      database: {
        ...DEFAULT_CONFIG.database,
        ...(config.database || {}),
      },
    };
    
    this.logger.info('GasOptimizer initialized');
  }
  
  /**
   * Start the gas optimizer service
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('GasOptimizer is already running');
      return;
    }
    
    this.logger.info('Starting GasOptimizer');
    
    try {
      // Initialize database tables
      if (this.config.database.enabled) {
        await this.initializeDatabaseTables();
      }
      
      // Load historical gas price data
      await this.loadHistoricalGasPrices();
      
      // Start data update interval
      this.startDataUpdateInterval();
      
      // Start prediction update interval
      if (this.config.predictionModels.enabled) {
        this.startPredictionUpdateInterval();
      }
      
      // Start database pruning interval
      if (this.config.database.enabled) {
        this.startPruneInterval();
      }
      
      this.isRunning = true;
      this.logger.info('GasOptimizer started successfully');
      this.emit('started');
      
      // Record metrics
      this.metricsService.recordMetric('gas_optimizer.status', 1);
    } catch (error) {
      this.logger.error('Failed to start GasOptimizer', error);
      throw error;
    }
  }
  
  /**
   * Stop the gas optimizer service
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('GasOptimizer is not running');
      return;
    }
    
    this.logger.info('Stopping GasOptimizer');
    
    try {
      // Stop data update interval
      this.stopDataUpdateInterval();
      
      // Stop prediction update interval
      this.stopPredictionUpdateInterval();
      
      // Stop database pruning interval
      this.stopPruneInterval();
      
      this.isRunning = false;
      this.logger.info('GasOptimizer stopped successfully');
      this.emit('stopped');
      
      // Record metrics
      this.metricsService.recordMetric('gas_optimizer.status', 0);
    } catch (error) {
      this.logger.error('Failed to stop GasOptimizer', error);
      throw error;
    }
  }
  
  /**
   * Initialize database tables
   */
  private async initializeDatabaseTables(): Promise<void> {
    this.logger.info('Initializing database tables');
    
    try {
      // Create gas_prices table if it doesn't exist
      await this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS gas_prices (
          id SERIAL PRIMARY KEY,
          timestamp BIGINT NOT NULL,
          slow FLOAT NOT NULL,
          average FLOAT NOT NULL,
          fast FLOAT NOT NULL,
          urgent FLOAT NOT NULL,
          base_fee FLOAT,
          priority_fee FLOAT,
          source VARCHAR(50) NOT NULL,
          created_at TIMESTAMP NOT NULL
        )
      `);
      
      // Create index on timestamp
      await this.databaseService.query(`
        CREATE INDEX IF NOT EXISTS gas_prices_timestamp_idx ON gas_prices (timestamp)
      `);
      
      this.logger.info('Database tables initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize database tables', error);
      throw error;
    }
  }
  
  /**
   * Load historical gas price data
   */
  private async loadHistoricalGasPrices(): Promise<void> {
    this.logger.info('Loading historical gas prices');
    
    try {
      if (this.config.database.enabled) {
        // Query database for historical gas prices
        const historyLength = this.config.predictionModels.historyLength;
        
        const rows = await this.databaseService.query(
          `SELECT * FROM gas_prices ORDER BY timestamp DESC LIMIT ?`,
          [historyLength]
        );
        
        // Convert rows to GasPriceData objects
        this.gasPriceHistory = rows.map(row => ({
          timestamp: row.timestamp,
          slow: row.slow,
          average: row.average,
          fast: row.fast,
          urgent: row.urgent,
          baseFee: row.base_fee,
          priorityFee: row.priority_fee,
          source: row.source,
        })).reverse(); // Oldest first
        
        this.logger.info(`Loaded ${this.gasPriceHistory.length} historical gas prices`);
      } else {
        this.logger.info('Database is disabled, skipping historical gas price loading');
      }
      
      // If we have historical data, set current gas price
      if (this.gasPriceHistory.length > 0) {
        this.currentGasPrice = this.gasPriceHistory[this.gasPriceHistory.length - 1];
        this.logger.info(`Current gas price set from historical data: ${JSON.stringify(this.currentGasPrice)}`);
      }
    } catch (error) {
      this.logger.error('Failed to load historical gas prices', error);
      throw error;
    }
  }
  
  /**
   * Start data update interval
   */
  private startDataUpdateInterval(): void {
    this.logger.info(`Starting gas price data update interval: ${this.config.dataSources.updateInterval}ms`);
    
    // Clear any existing interval
    this.stopDataUpdateInterval();
    
    // Start new interval
    this.dataUpdateIntervalId = setInterval(async () => {
      try {
        await this.updateGasPriceData();
      } catch (error) {
        this.logger.error('Error during gas price data update', error);
        
        // Record error metric
        this.metricsService.recordMetric('gas_optimizer.data_update_errors', 1);
      }
    }, this.config.dataSources.updateInterval);
    
    this.logger.info('Gas price data update interval started');
  }
  
  /**
   * Stop data update interval
   */
  private stopDataUpdateInterval(): void {
    if (this.dataUpdateIntervalId) {
      clearInterval(this.dataUpdateIntervalId);
      this.dataUpdateIntervalId = null;
      this.logger.info('Gas price data update interval stopped');
    }
  }
  
  /**
   * Start prediction update interval
   */
  private startPredictionUpdateInterval(): void {
    this.logger.info(`Starting gas price prediction update interval: ${this.config.predictionModels.updateInterval}ms`);
    
    // Clear any existing interval
    this.stopPredictionUpdateInterval();
    
    // Start new interval
    this.predictionUpdateIntervalId = setInterval(async () => {
      try {
        await this.updateGasPricePredictions();
      } catch (error) {
        this.logger.error('Error during gas price prediction update', error);
        
        // Record error metric
        this.metricsService.recordMetric('gas_optimizer.prediction_update_errors', 1);
      }
    }, this.config.predictionModels.updateInterval);
    
    this.logger.info('Gas price prediction update interval started');
  }
  
  /**
   * Stop prediction update interval
   */
  private stopPredictionUpdateInterval(): void {
    if (this.predictionUpdateIntervalId) {
      clearInterval(this.predictionUpdateIntervalId);
      this.predictionUpdateIntervalId = null;
      this.logger.info('Gas price prediction update interval stopped');
    }
  }
  
  /**
   * Start database pruning interval
   */
  private startPruneInterval(): void {
    this.logger.info(`Starting database pruning interval: ${this.config.database.pruneInterval}ms`);
    
    // Clear any existing interval
    this.stopPruneInterval();
    
    // Start new interval
    this.pruneIntervalId = setInterval(async () => {
      try {
        await this.pruneDatabase();
      } catch (error) {
        this.logger.error('Error during database pruning', error);
      }
    }, this.config.database.pruneInterval);
    
    this.logger.info('Database pruning interval started');
  }
  
  /**
   * Stop database pruning interval
   */
  private stopPruneInterval(): void {
    if (this.pruneIntervalId) {
      clearInterval(this.pruneIntervalId);
      this.pruneIntervalId = null;
      this.logger.info('Database pruning interval stopped');
    }
  }
  
  /**
   * Update gas price data from all configured sources
   */
  private async updateGasPriceData(): Promise<void> {
    this.logger.debug('Updating gas price data');
    
    try {
      const gasPrices: GasPriceData[] = [];
      
      // Get gas prices from on-chain source
      if (this.config.dataSources.useOnChain) {
        try {
          const onChainGasPrice = await this.getOnChainGasPrice();
          if (onChainGasPrice) {
            gasPrices.push(onChainGasPrice);
          }
        } catch (error) {
          this.logger.error('Error getting on-chain gas price', error);
        }
      }
      
      // Get gas prices from Etherscan
      if (this.config.dataSources.useEtherscan) {
        try {
          const etherscanGasPrice = await this.getEtherscanGasPrice();
          if (etherscanGasPrice) {
            gasPrices.push(etherscanGasPrice);
          }
        } catch (error) {
          this.logger.error('Error getting Etherscan gas price', error);
        }
      }
      
      // Get gas prices from Gas Station
      if (this.config.dataSources.useGasStation) {
        try {
          const gasStationGasPrice = await this.getGasStationGasPrice();
          if (gasStationGasPrice) {
            gasPrices.push(gasStationGasPrice);
          }
        } catch (error) {
          this.logger.error('Error getting Gas Station gas price', error);
        }
      }
      
      // Get gas prices from custom sources
      for (const source of this.config.dataSources.customSources) {
        try {
          const customGasPrice = await this.getCustomGasPrice(source);
          if (customGasPrice) {
            gasPrices.push(customGasPrice);
          }
        } catch (error) {
          this.logger.error(`Error getting gas price from custom source: ${source}`, error);
        }
      }
      
      // If we have gas prices, aggregate them
      if (gasPrices.length > 0) {
        const aggregatedGasPrice = this.aggregateGasPrices(gasPrices);
        
        // Update current gas price
        this.currentGasPrice = aggregatedGasPrice;
        
        // Add to history
        this.gasPriceHistory.push(aggregatedGasPrice);
        
        // Trim history if needed
        if (this.gasPriceHistory.length > this.config.predictionModels.historyLength) {
          this.gasPriceHistory = this.gasPriceHistory.slice(
            this.gasPriceHistory.length - this.config.predictionModels.historyLength
          );
        }
        
        // Save to database if enabled
        if (this.config.database.enabled) {
          await this.saveGasPriceToDatabase(aggregatedGasPrice);
        }
        
        // Emit event
        this.emit('gasPriceUpdated', aggregatedGasPrice);
        
        // Record metrics
        this.metricsService.recordMetric('gas_optimizer.current_slow_gas_price', aggregatedGasPrice.slow);
        this.metricsService.recordMetric('gas_optimizer.current_average_gas_price', aggregatedGasPrice.average);
        this.metricsService.recordMetric('gas_optimizer.current_fast_gas_price', aggregatedGasPrice.fast);
        this.metricsService.recordMetric('gas_optimizer.current_urgent_gas_price', aggregatedGasPrice.urgent);
        
        this.logger.info(`Gas price updated: slow=${aggregatedGasPrice.slow}, average=${aggregatedGasPrice.average}, fast=${aggregatedGasPrice.fast}, urgent=${aggregatedGasPrice.urgent}`);
      } else {
        this.logger.warn('No gas price data available from any source');
      }
    } catch (error) {
      this.logger.error('Error updating gas price data', error);
      throw error;
    }
  }
  
  /**
   * Get gas price from on-chain source
   * 
   * @returns Gas price data or null if not available
   */
  private async getOnChainGasPrice(): Promise<GasPriceData | null> {
    this.logger.debug('Getting on-chain gas price');
    
    try {
      // TODO: Implement on-chain gas price fetching
      // This would require connecting to an Ethereum node
      
      // For now, return null
      return null;
    } catch (error) {
      this.logger.error('Error getting on-chain gas price', error);
      throw error;
    }
  }
  
  /**
   * Get gas price from Etherscan
   * 
   * @returns Gas price data or null if not available
   */
  private async getEtherscanGasPrice(): Promise<GasPriceData | null> {
    this.logger.debug('Getting Etherscan gas price');
    
    try {
      // TODO: Implement Etherscan gas price fetching
      // This would require calling the Etherscan API
      
      // For now, return mock data
      return {
        timestamp: Date.now(),
        slow: 20,
        average: 30,
        fast: 40,
        urgent: 50,
        source: 'etherscan',
      };
    } catch (error) {
      this.logger.error('Error getting Etherscan gas price', error);
      throw error;
    }
  }
  
  /**
   * Get gas price from Gas Station
   * 
   * @returns Gas price data or null if not available
   */
  private async getGasStationGasPrice(): Promise<GasPriceData | null> {
    this.logger.debug('Getting Gas Station gas price');
    
    try {
      // TODO: Implement Gas Station gas price fetching
      // This would require calling the Gas Station API
      
      // For now, return mock data
      return {
        timestamp: Date.now(),
        slow: 25,
        average: 35,
        fast: 45,
        urgent: 55,
        source: 'gas_station',
      };
    } catch (error) {
      this.logger.error('Error getting Gas Station gas price', error);
      throw error;
    }
  }
  
  /**
   * Get gas price from a custom source
   * 
   * @param source - The custom source URL
   * @returns Gas price data or null if not available
   */
  private async getCustomGasPrice(source: string): Promise<GasPriceData | null> {
    this.logger.debug(`Getting gas price from custom source: ${source}`);
    
    try {
      // TODO: Implement custom source gas price fetching
      // This would require calling the custom API
      
      // For now, return null
      return null;
    } catch (error) {
      this.logger.error(`Error getting gas price from custom source: ${source}`, error);
      throw error;
    }
  }
  
  /**
   * Aggregate gas prices from multiple sources
   * 
   * @param gasPrices - List of gas price data from different sources
   * @returns Aggregated gas price data
   */
  private aggregateGasPrices(gasPrices: GasPriceData[]): GasPriceData {
    this.logger.debug(`Aggregating gas prices from ${gasPrices.length} sources`);
    
    // Calculate median values for each gas price type
    const slow = this.calculateMedian(gasPrices.map(gp => gp.slow));
    const average = this.calculateMedian(gasPrices.map(gp => gp.average));
    const fast = this.calculateMedian(gasPrices.map(gp => gp.fast));
    const urgent = this.calculateMedian(gasPrices.map(gp => gp.urgent));
    
    // Calculate median base fee and priority fee if available
    const baseFees = gasPrices.filter(gp => gp.baseFee !== undefined).map(gp => gp.baseFee!);
    const priorityFees = gasPrices.filter(gp => gp.priorityFee !== undefined).map(gp => gp.priorityFee!);
    
    const baseFee = baseFees.length > 0 ? this.calculateMedian(baseFees) : undefined;
    const priorityFee = priorityFees.length > 0 ? this.calculateMedian(priorityFees) : undefined;
    
    return {
      timestamp: Date.now(),
      slow,
      average,
      fast,
      urgent,
      baseFee,
      priorityFee,
      source: 'aggregated',
    };
  }
  
  /**
   * Calculate median of a list of numbers
   * 
   * @param values - List of numbers
   * @returns Median value
   */
  private calculateMedian(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[middle - 1] + sorted[middle]) / 2;
    } else {
      return sorted[middle];
    }
  }
  
  /**
   * Save gas price to database
   * 
   * @param gasPrice - Gas price data to save
   */
  private async saveGasPriceToDatabase(gasPrice: GasPriceData): Promise<void> {
    this.logger.debug('Saving gas price to database');
    
    try {
      await this.databaseService.query(
        `INSERT INTO gas_prices (
          timestamp, slow, average, fast, urgent, base_fee, priority_fee, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          gasPrice.timestamp,
          gasPrice.slow,
          gasPrice.average,
          gasPrice.fast,
          gasPrice.urgent,
          gasPrice.baseFee,
          gasPrice.priorityFee,
          gasPrice.source,
        ]
      );
      
      this.logger.debug('Gas price saved to database successfully');
    } catch (error) {
      this.logger.error('Error saving gas price to database', error);
      throw error;
    }
  }
  
  /**
   * Update gas price predictions using configured models
   */
  private async updateGasPricePredictions(): Promise<void> {
    this.logger.debug('Updating gas price predictions');
    
    try {
      // Check if we have enough historical data
      if (this.gasPriceHistory.length < 10) {
        this.logger.warn('Not enough historical data for gas price predictions');
        return;
      }
      
      // Update predictions for each model
      if (this.config.predictionModels.defaultModel === GasPricePredictionModel.LINEAR || 
          this.config.predictionModels.defaultModel === GasPricePredictionModel.HYBRID) {
        const linearPrediction = this.predictGasPriceLinear();
        this.predictedGasPrices.set(GasPricePredictionModel.LINEAR, linearPrediction);
      }
      
      if (this.config.predictionModels.defaultModel === GasPricePredictionModel.EXPONENTIAL || 
          this.config.predictionModels.defaultModel === GasPricePredictionModel.HYBRID) {
        const exponentialPrediction = this.predictGasPriceExponential();
        this.predictedGasPrices.set(GasPricePredictionModel.EXPONENTIAL, exponentialPrediction);
      }
      
      if (this.config.predictionModels.defaultModel === GasPricePredictionModel.MOVING_AVERAGE || 
          this.config.predictionModels.defaultModel === GasPricePredictionModel.HYBRID) {
        const movingAveragePrediction = this.predictGasPriceMovingAverage();
        this.predictedGasPrices.set(GasPricePredictionModel.MOVING_AVERAGE, movingAveragePrediction);
      }
      
      if (this.config.predictionModels.defaultModel === GasPricePredictionModel.MACHINE_LEARNING) {
        const mlPrediction = this.predictGasPriceMachineLearning();
        this.predictedGasPrices.set(GasPricePredictionModel.MACHINE_LEARNING, mlPrediction);
      }
      
      if (this.config.predictionModels.defaultModel === GasPricePredictionModel.HYBRID) {
        const hybridPrediction = this.predictGasPriceHybrid();
        this.predictedGasPrices.set(GasPricePredictionModel.HYBRID, hybridPrediction);
      }
      
      // Emit event
      this.emit('gasPricePredictionsUpdated', this.predictedGasPrices);
      
      this.logger.info('Gas price predictions updated successfully');
    } catch (error) {
      this.logger.error('Error updating gas price predictions', error);
      throw error;
    }
  }
  
  /**
   * Predict gas price using linear regression
   * 
   * @returns Predicted gas price data
   */
  private predictGasPriceLinear(): GasPriceData {
    this.logger.debug('Predicting gas price using linear regression');
    
    try {
      // Get recent history
      const recentHistory = this.gasPriceHistory.slice(-20);
      
      // Calculate linear regression for each gas price type
      const predictedSlow = this.calculateLinearPrediction(recentHistory.map(gp => gp.slow));
      const predictedAverage = this.calculateLinearPrediction(recentHistory.map(gp => gp.average));
      const predictedFast = this.calculateLinearPrediction(recentHistory.map(gp => gp.fast));
      const predictedUrgent = this.calculateLinearPrediction(recentHistory.map(gp => gp.urgent));
      
      return {
        timestamp: Date.now() + this.config.predictionModels.predictionHorizon,
        slow: predictedSlow,
        average: predictedAverage,
        fast: predictedFast,
        urgent: predictedUrgent,
        source: 'prediction_linear',
      };
    } catch (error) {
      this.logger.error('Error predicting gas price using linear regression', error);
      throw error;
    }
  }
  
  /**
   * Calculate linear prediction for a series of values
   * 
   * @param values - Historical values
   * @returns Predicted value
   */
  private calculateLinearPrediction(values: number[]): number {
    if (values.length < 2) {
      return values[0] || 0;
    }
    
    // Calculate slope using simple linear regression
    const n = values.length;
    const indices = Array.from({ length: n }, (_, i) => i);
    
    const sumX = indices.reduce((sum, x) => sum + x, 0);
    const sumY = values.reduce((sum, y) => sum + y, 0);
    const sumXY = indices.reduce((sum, x, i) => sum + x * values[i], 0);
    const sumXX = indices.reduce((sum, x) => sum + x * x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // Predict future value
    const prediction = intercept + slope * n;
    
    // Ensure prediction is positive
    return Math.max(1, prediction);
  }
  
  /**
   * Predict gas price using exponential smoothing
   * 
   * @returns Predicted gas price data
   */
  private predictGasPriceExponential(): GasPriceData {
    this.logger.debug('Predicting gas price using exponential smoothing');
    
    try {
      // Get recent history
      const recentHistory = this.gasPriceHistory.slice(-20);
      
      // Calculate exponential smoothing for each gas price type
      const predictedSlow = this.calculateExponentialPrediction(recentHistory.map(gp => gp.slow));
      const predictedAverage = this.calculateExponentialPrediction(recentHistory.map(gp => gp.average));
      const predictedFast = this.calculateExponentialPrediction(recentHistory.map(gp => gp.fast));
      const predictedUrgent = this.calculateExponentialPrediction(recentHistory.map(gp => gp.urgent));
      
      return {
        timestamp: Date.now() + this.config.predictionModels.predictionHorizon,
        slow: predictedSlow,
        average: predictedAverage,
        fast: predictedFast,
        urgent: predictedUrgent,
        source: 'prediction_exponential',
      };
    } catch (error) {
      this.logger.error('Error predicting gas price using exponential smoothing', error);
      throw error;
    }
  }
  
  /**
   * Calculate exponential prediction for a series of values
   * 
   * @param values - Historical values
   * @returns Predicted value
   */
  private calculateExponentialPrediction(values: number[]): number {
    if (values.length < 2) {
      return values[0] || 0;
    }
    
    // Use exponential smoothing with alpha = 0.3
    const alpha = 0.3;
    let smoothed = values[0];
    
    for (let i = 1; i < values.length; i++) {
      smoothed = alpha * values[i] + (1 - alpha) * smoothed;
    }
    
    // Predict future value (simple extrapolation)
    const lastValue = values[values.length - 1];
    const prediction = smoothed + (lastValue - smoothed) * 0.5;
    
    // Ensure prediction is positive
    return Math.max(1, prediction);
  }
  
  /**
   * Predict gas price using moving average
   * 
   * @returns Predicted gas price data
   */
  private predictGasPriceMovingAverage(): GasPriceData {
    this.logger.debug('Predicting gas price using moving average');
    
    try {
      // Get recent history
      const recentHistory = this.gasPriceHistory.slice(-10);
      
      // Calculate moving average for each gas price type
      const predictedSlow = this.calculateMovingAveragePrediction(recentHistory.map(gp => gp.slow));
      const predictedAverage = this.calculateMovingAveragePrediction(recentHistory.map(gp => gp.average));
      const predictedFast = this.calculateMovingAveragePrediction(recentHistory.map(gp => gp.fast));
      const predictedUrgent = this.calculateMovingAveragePrediction(recentHistory.map(gp => gp.urgent));
      
      return {
        timestamp: Date.now() + this.config.predictionModels.predictionHorizon,
        slow: predictedSlow,
        average: predictedAverage,
        fast: predictedFast,
        urgent: predictedUrgent,
        source: 'prediction_moving_average',
      };
    } catch (error) {
      this.logger.error('Error predicting gas price using moving average', error);
      throw error;
    }
  }
  
  /**
   * Calculate moving average prediction for a series of values
   * 
   * @param values - Historical values
   * @returns Predicted value
   */
  private calculateMovingAveragePrediction(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    
    // Calculate simple moving average
    const sum = values.reduce((sum, value) => sum + value, 0);
    const average = sum / values.length;
    
    // Ensure prediction is positive
    return Math.max(1, average);
  }
  
  /**
   * Predict gas price using machine learning
   * 
   * @returns Predicted gas price data
   */
  private predictGasPriceMachineLearning(): GasPriceData {
    this.logger.debug('Predicting gas price using machine learning');
    
    try {
      // TODO: Implement machine learning prediction
      // This would require a more complex ML model
      
      // For now, fall back to hybrid prediction
      return this.predictGasPriceHybrid();
    } catch (error) {
      this.logger.error('Error predicting gas price using machine learning', error);
      throw error;
    }
  }
  
  /**
   * Predict gas price using hybrid approach
   * 
   * @returns Predicted gas price data
   */
  private predictGasPriceHybrid(): GasPriceData {
    this.logger.debug('Predicting gas price using hybrid approach');
    
    try {
      // Get predictions from other models
      const linearPrediction = this.predictedGasPrices.get(GasPricePredictionModel.LINEAR) || this.predictGasPriceLinear();
      const exponentialPrediction = this.predictedGasPrices.get(GasPricePredictionModel.EXPONENTIAL) || this.predictGasPriceExponential();
      const movingAveragePrediction = this.predictedGasPrices.get(GasPricePredictionModel.MOVING_AVERAGE) || this.predictGasPriceMovingAverage();
      
      // Combine predictions with weights
      const weights = {
        linear: 0.3,
        exponential: 0.4,
        movingAverage: 0.3,
      };
      
      const predictedSlow = (
        linearPrediction.slow * weights.linear +
        exponentialPrediction.slow * weights.exponential +
        movingAveragePrediction.slow * weights.movingAverage
      );
      
      const predictedAverage = (
        linearPrediction.average * weights.linear +
        exponentialPrediction.average * weights.exponential +
        movingAveragePrediction.average * weights.movingAverage
      );
      
      const predictedFast = (
        linearPrediction.fast * weights.linear +
        exponentialPrediction.fast * weights.exponential +
        movingAveragePrediction.fast * weights.movingAverage
      );
      
      const predictedUrgent = (
        linearPrediction.urgent * weights.linear +
        exponentialPrediction.urgent * weights.exponential +
        movingAveragePrediction.urgent * weights.movingAverage
      );
      
      return {
        timestamp: Date.now() + this.config.predictionModels.predictionHorizon,
        slow: predictedSlow,
        average: predictedAverage,
        fast: predictedFast,
        urgent: predictedUrgent,
        source: 'prediction_hybrid',
      };
    } catch (error) {
      this.logger.error('Error predicting gas price using hybrid approach', error);
      throw error;
    }
  }
  
  /**
   * Prune old gas price data from database
   */
  private async pruneDatabase(): Promise<void> {
    this.logger.info('Pruning old gas price data from database');
    
    try {
      const cutoffTimestamp = Date.now() - this.config.database.retentionPeriod;
      
      const result = await this.databaseService.query(
        'DELETE FROM gas_prices WHERE timestamp < ?',
        [cutoffTimestamp]
      );
      
      this.logger.info(`Pruned ${result.affectedRows} old gas price records`);
      
      // Record metrics
      this.metricsService.recordMetric('gas_optimizer.pruned_records', result.affectedRows);
    } catch (error) {
      this.logger.error('Error pruning database', error);
      throw error;
    }
  }
  
  /**
   * Get optimal gas price for a transaction
   * 
   * @param strategy - The gas optimization strategy to use
   * @param transactionValue - The value of the transaction (optional)
   * @returns The optimal gas price
   */
  public getOptimalGasPrice(
    strategy: GasOptimizationStrategy = this.config.strategies.defaultStrategy,
    transactionValue?: number
  ): number {
    this.logger.debug(`Getting optimal gas price for strategy: ${strategy}`);
    
    try {
      // If value-based optimization is enabled and transaction value is provided,
      // determine the strategy based on the value
      if (this.config.valueBasedOptimization.enabled && transactionValue !== undefined) {
        strategy = this.getValueBasedStrategy(transactionValue);
        this.logger.debug(`Value-based strategy selected: ${strategy} for value: ${transactionValue}`);
      }
      
      // Get current gas price
      if (!this.currentGasPrice) {
        throw new Error('No gas price data available');
      }
      
      // Get gas price based on strategy
      let gasPrice: number;
      
      switch (strategy) {
        case GasOptimizationStrategy.ECONOMIC:
          gasPrice = this.currentGasPrice.slow;
          break;
        case GasOptimizationStrategy.BALANCED:
          gasPrice = this.currentGasPrice.average;
          break;
        case GasOptimizationStrategy.FAST:
          gasPrice = this.currentGasPrice.fast;
          break;
        case GasOptimizationStrategy.URGENT:
          gasPrice = this.currentGasPrice.urgent;
          break;
        default:
          gasPrice = this.currentGasPrice.average;
          break;
      }
      
      // Apply strategy multiplier
      const multiplier = this.config.strategies[strategy]?.multiplier || 1;
      gasPrice *= multiplier;
      
      // Ensure gas price is positive
      gasPrice = Math.max(1, gasPrice);
      
      this.logger.info(`Optimal gas price for strategy ${strategy}: ${gasPrice}`);
      
      return gasPrice;
    } catch (error) {
      this.logger.error('Error getting optimal gas price', error);
      throw error;
    }
  }
  
  /**
   * Get strategy based on transaction value
   * 
   * @param value - The transaction value
   * @returns The appropriate strategy
   */
  private getValueBasedStrategy(value: number): GasOptimizationStrategy {
    const thresholds = this.config.valueBasedOptimization.thresholds;
    const mapping = this.config.valueBasedOptimization.strategyMapping;
    
    if (value >= thresholds.veryHigh) {
      return mapping.veryHigh;
    } else if (value >= thresholds.high) {
      return mapping.high;
    } else if (value >= thresholds.medium) {
      return mapping.medium;
    } else {
      return mapping.low;
    }
  }
  
  /**
   * Get estimated confirmation time for a gas price
   * 
   * @param gasPrice - The gas price
   * @returns Estimated confirmation time in milliseconds
   */
  public getEstimatedConfirmationTime(gasPrice: number): number {
    this.logger.debug(`Getting estimated confirmation time for gas price: ${gasPrice}`);
    
    try {
      // Get current gas price
      if (!this.currentGasPrice) {
        throw new Error('No gas price data available');
      }
      
      // Determine which category the gas price falls into
      if (gasPrice >= this.currentGasPrice.urgent) {
        return this.config.strategies[GasOptimizationStrategy.URGENT].maxWaitTime;
      } else if (gasPrice >= this.currentGasPrice.fast) {
        return this.config.strategies[GasOptimizationStrategy.FAST].maxWaitTime;
      } else if (gasPrice >= this.currentGasPrice.average) {
        return this.config.strategies[GasOptimizationStrategy.BALANCED].maxWaitTime;
      } else {
        return this.config.strategies[GasOptimizationStrategy.ECONOMIC].maxWaitTime;
      }
    } catch (error) {
      this.logger.error('Error getting estimated confirmation time', error);
      throw error;
    }
  }
  
  /**
   * Get current gas price data
   * 
   * @returns Current gas price data
   */
  public getCurrentGasPrice(): GasPriceData | null {
    return this.currentGasPrice;
  }
  
  /**
   * Get predicted gas price data
   * 
   * @param model - The prediction model to use
   * @returns Predicted gas price data
   */
  public getPredictedGasPrice(model: GasPricePredictionModel = this.config.predictionModels.defaultModel): GasPriceData | null {
    return this.predictedGasPrices.get(model) || null;
  }
  
  /**
   * Get gas price history
   * 
   * @param limit - Maximum number of records to return
   * @returns Gas price history
   */
  public getGasPriceHistory(limit: number = this.config.predictionModels.historyLength): GasPriceData[] {
    return this.gasPriceHistory.slice(-limit);
  }
  
  /**
   * Get status of the gas optimizer
   * 
   * @returns The current status of the gas optimizer
   */
  public getStatus(): any {
    return {
      isRunning: this.isRunning,
      currentGasPrice: this.currentGasPrice,
      historyLength: this.gasPriceHistory.length,
      predictionsAvailable: this.predictedGasPrices.size > 0,
    };
  }
}
