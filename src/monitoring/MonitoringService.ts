// English comment for verification
/**
 * @file MonitoringService.ts
 * @description Service for monitoring the Wormhole Relayer system
 * @author Manus AI
 * @date April 27, 2025
 */

import { RelayerDatabaseService } from './RelayerDatabase';
import { EthereumConnector } from './EthereumConnector';
import { SolanaConnector } from './SolanaConnector';
import { DepositService } from './DepositService';
import { WithdrawalService } from './WithdrawalService';
import { FinalizationService } from './FinalizationService';
import { Logger } from '../utils/Logger';
import { MetricsService } from '../monitoring/MetricsService';
import { AlertService } from '../monitoring/AlertService';
import { CacheService } from '../utils/CacheService';
import { ThreadPoolService } from '../utils/ThreadPoolService';
import { ChainType, MessageStatus } from './RelayerTypes';
import * as os from 'os';

/**
 * Interface for system health status
 */
interface SystemHealthStatus {
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  components: {
    [key: string]: {
      status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
      details: string;
      lastChecked: Date;
    }
  };
  lastChecked: Date;
}

/**
 * Interface for system metrics
 */
interface SystemMetrics {
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercentage: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    usagePercentage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
  };
  database: {
    connectionCount: number;
    queryCount: number;
    slowQueries: number;
  };
  messages: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    totalProcessed: number;
  };
  transactions: {
    submitted: number;
    confirmed: number;
    failed: number;
  };
  ethereum: {
    blockHeight: number;
    gasPrice: string;
    connectionStatus: 'CONNECTED' | 'DISCONNECTED';
  };
  solana: {
    slotHeight: number;
    connectionStatus: 'CONNECTED' | 'DISCONNECTED';
  };
  threadPool: {
    activeThreads: number;
    queueSize: number;
    completedTasks: number;
  };
  cache: {
    size: number;
    hitRate: number;
    missRate: number;
  };
  timestamp: Date;
}

/**
 * Interface for alert configuration
 */
interface AlertConfig {
  enabled: boolean;
  threshold: number;
  cooldownPeriod: number;
  lastTriggered?: Date;
}

/**
 * Interface for monitoring configuration
 */
interface MonitoringConfig {
  healthCheckInterval: number;
  metricsCollectionInterval: number;
  retentionPeriod: number;
  alerts: {
    highCpuUsage: AlertConfig;
    highMemoryUsage: AlertConfig;
    highDiskUsage: AlertConfig;
    databaseConnectionIssues: AlertConfig;
    highPendingMessageCount: AlertConfig;
    highFailedMessageCount: AlertConfig;
    blockchainConnectionIssues: AlertConfig;
    threadPoolSaturation: AlertConfig;
    slowMessageProcessing: AlertConfig;
  };
}

/**
 * MonitoringService class
 * 
 * Provides comprehensive monitoring for the Wormhole Relayer system,
 * including health checks, metrics collection, and alerting.
 */
export class MonitoringService {
  private readonly logger: Logger;
  private readonly db: RelayerDatabaseService;
  private readonly ethereum: EthereumConnector;
  private readonly solana: SolanaConnector;
  private readonly depositService: DepositService;
  private readonly withdrawalService: WithdrawalService;
  private readonly finalizationService: FinalizationService;
  private readonly metrics: MetricsService;
  private readonly alerts: AlertService;
  private readonly cache: CacheService;
  private readonly threadPool: ThreadPoolService;
  private readonly config: MonitoringConfig;
  private isRunning: boolean = false;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private metricsCollectionTimer: NodeJS.Timeout | null = null;
  private lastSystemMetrics: SystemMetrics | null = null;
  private systemHealth: SystemHealthStatus = {
    status: 'HEALTHY',
    components: {},
    lastChecked: new Date()
  };

  /**
   * Creates a new instance of the MonitoringService
   * 
   * @param db The database service
   * @param ethereum The Ethereum connector
   * @param solana The Solana connector
   * @param depositService The deposit service
   * @param withdrawalService The withdrawal service
   * @param finalizationService The finalization service
   * @param metrics The metrics service
   * @param alerts The alert service
   * @param cache The cache service
   * @param threadPool The thread pool service
   * @param logger The logger
   * @param config The monitoring configuration
   */
  constructor(
    db: RelayerDatabaseService,
    ethereum: EthereumConnector,
    solana: SolanaConnector,
    depositService: DepositService,
    withdrawalService: WithdrawalService,
    finalizationService: FinalizationService,
    metrics: MetricsService,
    alerts: AlertService,
    cache: CacheService,
    threadPool: ThreadPoolService,
    logger: Logger,
    config?: Partial<MonitoringConfig>
  ) {
    this.db = db;
    this.ethereum = ethereum;
    this.solana = solana;
    this.depositService = depositService;
    this.withdrawalService = withdrawalService;
    this.finalizationService = finalizationService;
    this.metrics = metrics;
    this.alerts = alerts;
    this.cache = cache;
    this.threadPool = threadPool;
    this.logger = logger.createChild('MonitoringService');

    // Default configuration
    const defaultConfig: MonitoringConfig = {
      healthCheckInterval: 60000, // 1 minute
      metricsCollectionInterval: 15000, // 15 seconds
      retentionPeriod: 7 * 24 * 60 * 60 * 1000, // 7 days
      alerts: {
        highCpuUsage: {
          enabled: true,
          threshold: 80, // 80% CPU usage
          cooldownPeriod: 300000 // 5 minutes
        },
        highMemoryUsage: {
          enabled: true,
          threshold: 80, // 80% memory usage
          cooldownPeriod: 300000 // 5 minutes
        },
        highDiskUsage: {
          enabled: true,
          threshold: 80, // 80% disk usage
          cooldownPeriod: 3600000 // 1 hour
        },
        databaseConnectionIssues: {
          enabled: true,
          threshold: 3, // 3 failed queries
          cooldownPeriod: 300000 // 5 minutes
        },
        highPendingMessageCount: {
          enabled: true,
          threshold: 100, // 100 pending messages
          cooldownPeriod: 300000 // 5 minutes
        },
        highFailedMessageCount: {
          enabled: true,
          threshold: 10, // 10 failed messages
          cooldownPeriod: 300000 // 5 minutes
        },
        blockchainConnectionIssues: {
          enabled: true,
          threshold: 3, // 3 failed connections
          cooldownPeriod: 300000 // 5 minutes
        },
        threadPoolSaturation: {
          enabled: true,
          threshold: 90, // 90% thread pool utilization
          cooldownPeriod: 300000 // 5 minutes
        },
        slowMessageProcessing: {
          enabled: true,
          threshold: 300000, // 5 minutes
          cooldownPeriod: 300000 // 5 minutes
        }
      }
    };

    // Merge provided config with defaults
    this.config = {
      ...defaultConfig,
      ...config,
      alerts: {
        ...defaultConfig.alerts,
        ...(config?.alerts || {})
      }
    };

    // Initialize system health
    this.initializeSystemHealth();
  }

  /**
   * Initializes the system health status
   */
  private initializeSystemHealth(): void {
    const now = new Date();
    this.systemHealth = {
      status: 'HEALTHY',
      components: {
        database: {
          status: 'HEALTHY',
          details: 'Database connection is healthy',
          lastChecked: now
        },
        ethereum: {
          status: 'HEALTHY',
          details: 'Ethereum connection is healthy',
          lastChecked: now
        },
        solana: {
          status: 'HEALTHY',
          details: 'Solana connection is healthy',
          lastChecked: now
        },
        depositService: {
          status: 'HEALTHY',
          details: 'Deposit service is running',
          lastChecked: now
        },
        withdrawalService: {
          status: 'HEALTHY',
          details: 'Withdrawal service is running',
          lastChecked: now
        },
        finalizationService: {
          status: 'HEALTHY',
          details: 'Finalization service is running',
          lastChecked: now
        },
        system: {
          status: 'HEALTHY',
          details: 'System resources are healthy',
          lastChecked: now
        }
      },
      lastChecked: now
    };
  }

  /**
   * Starts the monitoring service
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Monitoring service is already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting monitoring service');

    try {
      // Perform initial health check
      await this.performHealthCheck();

      // Collect initial metrics
      await this.collectMetrics();

      // Start periodic health checks
      this.healthCheckTimer = setInterval(
        () => this.performHealthCheck(),
        this.config.healthCheckInterval
      );

      // Start periodic metrics collection
      this.metricsCollectionTimer = setInterval(
        () => this.collectMetrics(),
        this.config.metricsCollectionInterval
      );

      this.logger.info('Monitoring service started successfully');
      this.metrics.recordMetric('monitoring_service.started', 1);
    } catch (error) {
      this.isRunning = false;
      this.logger.error('Failed to start monitoring service', error);
      this.metrics.recordMetric('monitoring_service.start_failed', 1);
      throw error;
    }
  }

  /**
   * Stops the monitoring service
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('Monitoring service is not running');
      return;
    }

    this.isRunning = false;
    this.logger.info('Stopping monitoring service');

    try {
      // Stop periodic health checks
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = null;
      }

      // Stop periodic metrics collection
      if (this.metricsCollectionTimer) {
        clearInterval(this.metricsCollectionTimer);
        this.metricsCollectionTimer = null;
      }

      this.logger.info('Monitoring service stopped successfully');
      this.metrics.recordMetric('monitoring_service.stopped', 1);
    } catch (error) {
      this.logger.error('Error stopping monitoring service', error);
      this.metrics.recordMetric('monitoring_service.stop_failed', 1);
      throw error;
    }
  }

  /**
   * Performs a health check of the system
   */
  private async performHealthCheck(): Promise<void> {
    if (!this.isRunning) return;

    const startTime = Date.now();
    this.logger.debug('Performing health check');

    try {
      const now = new Date();
      let overallStatus: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' = 'HEALTHY';

      // Check database health
      try {
        await this.checkDatabaseHealth();
        this.systemHealth.components.database = {
          status: 'HEALTHY',
          details: 'Database connection is healthy',
          lastChecked: now
        };
      } catch (error) {
        this.systemHealth.components.database = {
          status: 'UNHEALTHY',
          details: `Database connection error: ${error.message}`,
          lastChecked: now
        };
        overallStatus = 'UNHEALTHY';
        this.logger.error('Database health check failed', error);
        this.triggerAlert('databaseConnectionIssues', 'Database connection issues detected');
      }

      // Check Ethereum connection health
      try {
        await this.checkEthereumHealth();
        this.systemHealth.components.ethereum = {
          status: 'HEALTHY',
          details: 'Ethereum connection is healthy',
          lastChecked: now
        };
      } catch (error) {
        this.systemHealth.components.ethereum = {
          status: 'UNHEALTHY',
          details: `Ethereum connection error: ${error.message}`,
          lastChecked: now
        };
        overallStatus = 'UNHEALTHY';
        this.logger.error('Ethereum health check failed', error);
        this.triggerAlert('blockchainConnectionIssues', 'Ethereum connection issues detected');
      }

      // Check Solana connection health
      try {
        await this.checkSolanaHealth();
        this.systemHealth.components.solana = {
          status: 'HEALTHY',
          details: 'Solana connection is healthy',
          lastChecked: now
        };
      } catch (error) {
        this.systemHealth.components.solana = {
          status: 'UNHEALTHY',
          details: `Solana connection error: ${error.message}`,
          lastChecked: now
        };
        overallStatus = 'UNHEALTHY';
        this.logger.error('Solana health check failed', error);
        this.triggerAlert('blockchainConnectionIssues', 'Solana connection issues detected');
      }

      // Check deposit service health
      const depositStatus = this.depositService.getStatus();
      if (depositStatus.isRunning) {
        this.systemHealth.components.depositService = {
          status: 'HEALTHY',
          details: 'Deposit service is running',
          lastChecked: now
        };
      } else {
        this.systemHealth.components.depositService = {
          status: 'UNHEALTHY',
          details: 'Deposit service is not running',
          lastChecked: now
        };
        overallStatus = 'UNHEALTHY';
        this.logger.error('Deposit service is not running');
      }

      // Check withdrawal service health
      const withdrawalStatus = this.withdrawalService.getStatus();
      if (withdrawalStatus.isRunning) {
        this.systemHealth.components.withdrawalService = {
          status: 'HEALTHY',
          details: 'Withdrawal service is running',
          lastChecked: now
        };
      } else {
        this.systemHealth.components.withdrawalService = {
          status: 'UNHEALTHY',
          details: 'Withdrawal service is not running',
          lastChecked: now
        };
        overallStatus = 'UNHEALTHY';
        this.logger.error('Withdrawal service is not running');
      }

      // Check finalization service health
      const finalizationStatus = this.finalizationService.getStatus();
      if (finalizationStatus.isRunning) {
        this.systemHealth.components.finalizationService = {
          status: 'HEALTHY',
          details: 'Finalization service is running',
          lastChecked: now
        };
      } else {
        this.systemHealth.components.finalizationService = {
          status: 'UNHEALTHY',
          details: 'Finalization service is not running',
          lastChecked: now
        };
        overallStatus = 'UNHEALTHY';
        this.logger.error('Finalization service is not running');
      }

      // Check system resources
      try {
        await this.checkSystemResources();
        this.systemHealth.components.system = {
          status: 'HEALTHY',
          details: 'System resources are healthy',
          lastChecked: now
        };
      } catch (error) {
        this.systemHealth.components.system = {
          status: error.status || 'UNHEALTHY',
          details: error.message,
          lastChecked: now
        };
        overallStatus = error.status === 'DEGRADED' ? 
          (overallStatus === 'UNHEALTHY' ? 'UNHEALTHY' : 'DEGRADED') : 
          'UNHEALTHY';
        this.logger.error('System resources check failed', error);
      }

      // Update overall status
      this.systemHealth.status = overallStatus;
      this.systemHealth.lastChecked = now;

      // Record health check metrics
      this.metrics.recordMetric('monitoring_service.health_check_completed', 1);
      this.metrics.recordMetric('monitoring_service.health_status', 
        overallStatus === 'HEALTHY' ? 2 : (overallStatus === 'DEGRADED' ? 1 : 0));

      // Log health check result
      this.logger.info(`Health check completed: ${overallStatus}`);

      // Record health check duration
      const duration = Date.now() - startTime;
      this.metrics.recordMetric('monitoring_service.health_check_duration', duration);
    } catch (error) {
      this.logger.error('Error performing health check', error);
      this.metrics.recordMetric('monitoring_service.health_check_error', 1);
    }
  }

  /**
   * Checks the health of the database connection
   */
  private async checkDatabaseHealth(): Promise<void> {
    // In a real implementation, you would:
    // 1. Execute a simple query to verify the database connection
    // 2. Check connection pool status
    // 3. Verify database performance metrics
    
    // For this example, we'll simulate a database check
    const isHealthy = Math.random() > 0.05; // 5% chance of failure for simulation
    
    if (!isHealthy) {
      throw new Error('Database connection test failed');
    }
  }

  /**
   * Checks the health of the Ethereum connection
   */
  private async checkEthereumHealth(): Promise<void> {
    try {
      // Get the current block number to verify connection
      const blockNumber = await this.ethereum.getBlockNumber();
      
      // Verify that the block number is reasonable
      if (blockNumber <= 0) {
        throw new Error('Invalid block number received from Ethereum node');
      }
    } catch (error) {
      throw new Error(`Ethereum connection check failed: ${error.message}`);
    }
  }

  /**
   * Checks the health of the Solana connection
   */
  private async checkSolanaHealth(): Promise<void> {
    try {
      // Get the current slot to verify connection
      const slot = await this.solana.getSlot();
      
      // Verify that the slot is reasonable
      if (slot <= 0) {
        throw new Error('Invalid slot received from Solana node');
      }
    } catch (error) {
      throw new Error(`Solana connection check failed: ${error.message}`);
    }
  }

  /**
   * Checks the health of system resources
   */
  private async checkSystemResources(): Promise<void> {
    // Check CPU usage
    const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
    if (cpuUsage > this.config.alerts.highCpuUsage.threshold) {
      this.triggerAlert('highCpuUsage', `High CPU usage detected: ${cpuUsage.toFixed(2)}%`);
      throw {
        status: 'DEGRADED',
        message: `High CPU usage: ${cpuUsage.toFixed(2)}%`
      };
    }
    
    // Check memory usage
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsagePercentage = (usedMemory / totalMemory) * 100;
    
    if (memoryUsagePercentage > this.config.alerts.highMemoryUsage.threshold) {
      this.triggerAlert('highMemoryUsage', `High memory usage detected: ${memoryUsagePercentage.toFixed(2)}%`);
      throw {
        status: 'DEGRADED',
        message: `High memory usage: ${memoryUsagePercentage.toFixed(2)}%`
      };
    }
    
    // In a real implementation, you would also check disk usage
    // For this example, we'll simulate it
    const diskUsagePercentage = 50 + Math.random() * 40; // 50-90%
    
    if (diskUsagePercentage > this.config.alerts.highDiskUsage.threshold) {
      this.triggerAlert('highDiskUsage', `High disk usage detected: ${diskUsagePercentage.toFixed(2)}%`);
      throw {
        status: 'DEGRADED',
        message: `High disk usage: ${diskUsagePercentage.toFixed(2)}%`
      };
    }
  }

  /**
   * Collects metrics from the system
   */
  private async collectMetrics(): Promise<void> {
    if (!this.isRunning) return;

    const startTime = Date.now();
    this.logger.debug('Collecting metrics');

    try {
      // Collect system metrics
      const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      const memoryUsagePercentage = (usedMemory / totalMemory) * 100;
      
      // In a real implementation, you would collect actual disk and network metrics
      // For this example, we'll simulate them
      const diskTotal = 1000 * 1024 * 1024 * 1024; // 1 TB
      const diskUsed = diskTotal * (50 + Math.random() * 40) / 100; // 50-90%
      const diskFree = diskTotal - diskUsed;
      const diskUsagePercentage = (diskUsed / diskTotal) * 100;
      
      const networkBytesIn = Math.floor(Math.random() * 10000000); // 0-10 MB
      const networkBytesOut = Math.floor(Math.random() * 10000000); // 0-10 MB
      
      // Collect database metrics
      // In a real implementation, you would get these from the database service
      // For this example, we'll simulate them
      const dbConnectionCount = 10 + Math.floor(Math.random() * 20); // 10-30
      const dbQueryCount = 1000 + Math.floor(Math.random() * 5000); // 1000-6000
      const dbSlowQueries = Math.floor(Math.random() * 10); // 0-10
      
      // Collect message metrics
      // In a real implementation, you would get these from the database
      // For this example, we'll simulate them
      const pendingMessages = 10 + Math.floor(Math.random() * 100); // 10-110
      const processingMessages = 5 + Math.floor(Math.random() * 20); // 5-25
      const completedMessages = 1000 + Math.floor(Math.random() * 5000); // 1000-6000
      const failedMessages = Math.floor(Math.random() * 20); // 0-20
      const totalProcessedMessages = completedMessages + failedMessages;
      
      // Check for high pending message count
      if (pendingMessages > this.config.alerts.highPendingMessageCount.threshold) {
        this.triggerAlert('highPendingMessageCount', `High pending message count detected: ${pendingMessages}`);
      }
      
      // Check for high failed message count
      if (failedMessages > this.config.alerts.highFailedMessageCount.threshold) {
        this.triggerAlert('highFailedMessageCount', `High failed message count detected: ${failedMessages}`);
      }
      
      // Collect transaction metrics
      // In a real implementation, you would get these from the database
      // For this example, we'll simulate them
      const submittedTransactions = 500 + Math.floor(Math.random() * 2000); // 500-2500
      const confirmedTransactions = submittedTransactions - Math.floor(Math.random() * 100); // Some may not be confirmed yet
      const failedTransactions = Math.floor(Math.random() * 10); // 0-10
      
      // Collect blockchain metrics
      let ethereumBlockHeight = 0;
      let ethereumGasPrice = '0';
      let ethereumConnectionStatus: 'CONNECTED' | 'DISCONNECTED' = 'DISCONNECTED';
      
      try {
        ethereumBlockHeight = await this.ethereum.getBlockNumber();
        ethereumGasPrice = await this.ethereum.getGasPrice();
        ethereumConnectionStatus = 'CONNECTED';
      } catch (error) {
        this.logger.error('Error collecting Ethereum metrics', error);
      }
      
      let solanaSlotHeight = 0;
      let solanaConnectionStatus: 'CONNECTED' | 'DISCONNECTED' = 'DISCONNECTED';
      
      try {
        solanaSlotHeight = await this.solana.getSlot();
        solanaConnectionStatus = 'CONNECTED';
      } catch (error) {
        this.logger.error('Error collecting Solana metrics', error);
      }
      
      // Collect thread pool metrics
      // In a real implementation, you would get these from the thread pool service
      // For this example, we'll simulate them
      const threadPoolActiveThreads = 5 + Math.floor(Math.random() * 10); // 5-15
      const threadPoolQueueSize = Math.floor(Math.random() * 50); // 0-50
      const threadPoolCompletedTasks = 10000 + Math.floor(Math.random() * 10000); // 10000-20000
      
      // Check for thread pool saturation
      const threadPoolCapacity = 20; // Assuming a capacity of 20 threads
      const threadPoolUtilization = (threadPoolActiveThreads / threadPoolCapacity) * 100;
      
      if (threadPoolUtilization > this.config.alerts.threadPoolSaturation.threshold) {
        this.triggerAlert('threadPoolSaturation', `Thread pool saturation detected: ${threadPoolUtilization.toFixed(2)}%`);
      }
      
      // Collect cache metrics
      // In a real implementation, you would get these from the cache service
      // For this example, we'll simulate them
      const cacheSize = 1000 + Math.floor(Math.random() * 5000); // 1000-6000
      const cacheHitRate = 70 + Math.random() * 25; // 70-95%
      const cacheMissRate = 100 - cacheHitRate;
      
      // Create the metrics object
      const metrics: SystemMetrics = {
        cpu: {
          usage: cpuUsage,
          loadAverage: os.loadavg()
        },
        memory: {
          total: totalMemory,
          used: usedMemory,
          free: freeMemory,
          usagePercentage: memoryUsagePercentage
        },
        disk: {
          total: diskTotal,
          used: diskUsed,
          free: diskFree,
          usagePercentage: diskUsagePercentage
        },
        network: {
          bytesIn: networkBytesIn,
          bytesOut: networkBytesOut
        },
        database: {
          connectionCount: dbConnectionCount,
          queryCount: dbQueryCount,
          slowQueries: dbSlowQueries
        },
        messages: {
          pending: pendingMessages,
          processing: processingMessages,
          completed: completedMessages,
          failed: failedMessages,
          totalProcessed: totalProcessedMessages
        },
        transactions: {
          submitted: submittedTransactions,
          confirmed: confirmedTransactions,
          failed: failedTransactions
        },
        ethereum: {
          blockHeight: ethereumBlockHeight,
          gasPrice: ethereumGasPrice,
          connectionStatus: ethereumConnectionStatus
        },
        solana: {
          slotHeight: solanaSlotHeight,
          connectionStatus: solanaConnectionStatus
        },
        threadPool: {
          activeThreads: threadPoolActiveThreads,
          queueSize: threadPoolQueueSize,
          completedTasks: threadPoolCompletedTasks
        },
        cache: {
          size: cacheSize,
          hitRate: cacheHitRate,
          missRate: cacheMissRate
        },
        timestamp: new Date()
      };
      
      // Store the metrics
      this.lastSystemMetrics = metrics;
      
      // Record metrics in the metrics service
      this.recordMetricsInService(metrics);
      
      // Store metrics in the database for historical analysis
      await this.storeMetricsInDatabase(metrics);
      
      // Clean up old metrics
      await this.cleanupOldMetrics();
      
      // Log metrics collection result
      this.logger.debug('Metrics collection completed');
      
      // Record metrics collection duration
      const duration = Date.now() - startTime;
      this.metrics.recordMetric('monitoring_service.metrics_collection_duration', duration);
    } catch (error) {
      this.logger.error('Error collecting metrics', error);
      this.metrics.recordMetric('monitoring_service.metrics_collection_error', 1);
    }
  }

  /**
   * Records metrics in the metrics service
   * 
   * @param metrics The metrics to record
   */
  private recordMetricsInService(metrics: SystemMetrics): void {
    // Record CPU metrics
    this.metrics.recordMetric('system.cpu.usage', metrics.cpu.usage);
    this.metrics.recordMetric('system.cpu.load_average_1m', metrics.cpu.loadAverage[0]);
    this.metrics.recordMetric('system.cpu.load_average_5m', metrics.cpu.loadAverage[1]);
    this.metrics.recordMetric('system.cpu.load_average_15m', metrics.cpu.loadAverage[2]);
    
    // Record memory metrics
    this.metrics.recordMetric('system.memory.total', metrics.memory.total);
    this.metrics.recordMetric('system.memory.used', metrics.memory.used);
    this.metrics.recordMetric('system.memory.free', metrics.memory.free);
    this.metrics.recordMetric('system.memory.usage_percentage', metrics.memory.usagePercentage);
    
    // Record disk metrics
    this.metrics.recordMetric('system.disk.total', metrics.disk.total);
    this.metrics.recordMetric('system.disk.used', metrics.disk.used);
    this.metrics.recordMetric('system.disk.free', metrics.disk.free);
    this.metrics.recordMetric('system.disk.usage_percentage', metrics.disk.usagePercentage);
    
    // Record network metrics
    this.metrics.recordMetric('system.network.bytes_in', metrics.network.bytesIn);
    this.metrics.recordMetric('system.network.bytes_out', metrics.network.bytesOut);
    
    // Record database metrics
    this.metrics.recordMetric('database.connection_count', metrics.database.connectionCount);
    this.metrics.recordMetric('database.query_count', metrics.database.queryCount);
    this.metrics.recordMetric('database.slow_queries', metrics.database.slowQueries);
    
    // Record message metrics
    this.metrics.recordMetric('messages.pending', metrics.messages.pending);
    this.metrics.recordMetric('messages.processing', metrics.messages.processing);
    this.metrics.recordMetric('messages.completed', metrics.messages.completed);
    this.metrics.recordMetric('messages.failed', metrics.messages.failed);
    this.metrics.recordMetric('messages.total_processed', metrics.messages.totalProcessed);
    
    // Record transaction metrics
    this.metrics.recordMetric('transactions.submitted', metrics.transactions.submitted);
    this.metrics.recordMetric('transactions.confirmed', metrics.transactions.confirmed);
    this.metrics.recordMetric('transactions.failed', metrics.transactions.failed);
    
    // Record blockchain metrics
    this.metrics.recordMetric('ethereum.block_height', metrics.ethereum.blockHeight);
    this.metrics.recordMetric('ethereum.connection_status', metrics.ethereum.connectionStatus === 'CONNECTED' ? 1 : 0);
    this.metrics.recordMetric('solana.slot_height', metrics.solana.slotHeight);
    this.metrics.recordMetric('solana.connection_status', metrics.solana.connectionStatus === 'CONNECTED' ? 1 : 0);
    
    // Record thread pool metrics
    this.metrics.recordMetric('thread_pool.active_threads', metrics.threadPool.activeThreads);
    this.metrics.recordMetric('thread_pool.queue_size', metrics.threadPool.queueSize);
    this.metrics.recordMetric('thread_pool.completed_tasks', metrics.threadPool.completedTasks);
    
    // Record cache metrics
    this.metrics.recordMetric('cache.size', metrics.cache.size);
    this.metrics.recordMetric('cache.hit_rate', metrics.cache.hitRate);
    this.metrics.recordMetric('cache.miss_rate', metrics.cache.missRate);
  }

  /**
   * Stores metrics in the database for historical analysis
   * 
   * @param metrics The metrics to store
   */
  private async storeMetricsInDatabase(metrics: SystemMetrics): Promise<void> {
    // In a real implementation, you would store the metrics in the database
    // For this example, we'll just log that we're storing them
    this.logger.debug('Storing metrics in database');
  }

  /**
   * Cleans up old metrics from the database
   */
  private async cleanupOldMetrics(): Promise<void> {
    // In a real implementation, you would delete metrics older than the retention period
    // For this example, we'll just log that we're cleaning up
    this.logger.debug('Cleaning up old metrics');
  }

  /**
   * Triggers an alert
   * 
   * @param alertType The type of alert
   * @param message The alert message
   */
  private triggerAlert(alertType: keyof typeof this.config.alerts, message: string): void {
    const alertConfig = this.config.alerts[alertType];
    
    // Check if alerts are enabled for this type
    if (!alertConfig.enabled) {
      return;
    }
    
    // Check if we're in the cooldown period
    if (alertConfig.lastTriggered) {
      const timeSinceLastAlert = Date.now() - alertConfig.lastTriggered.getTime();
      if (timeSinceLastAlert < alertConfig.cooldownPeriod) {
        return;
      }
    }
    
    // Update the last triggered time
    alertConfig.lastTriggered = new Date();
    
    // Trigger the alert
    this.logger.warn(`Alert: ${message}`);
    this.alerts.triggerAlert('system', 'warning', message);
    this.metrics.recordMetric(`alerts.${alertType}`, 1);
  }

  /**
   * Gets the current system health status
   * 
   * @returns The system health status
   */
  public getSystemHealth(): SystemHealthStatus {
    return this.systemHealth;
  }

  /**
   * Gets the latest system metrics
   * 
   * @returns The latest system metrics, or null if none have been collected
   */
  public getLatestMetrics(): SystemMetrics | null {
    return this.lastSystemMetrics;
  }

  /**
   * Gets historical metrics from the database
   * 
   * @param startTime The start time for the metrics
   * @param endTime The end time for the metrics
   * @param resolution The resolution of the metrics (e.g., '1m', '5m', '1h')
   * @returns The historical metrics
   */
  public async getHistoricalMetrics(
    startTime: Date,
    endTime: Date,
    resolution: string
  ): Promise<SystemMetrics[]> {
    // In a real implementation, you would query the database for historical metrics
    // For this example, we'll just return an empty array
    return [];
  }

  /**
   * Gets the status of the monitoring service
   * 
   * @returns The status
   */
  public getStatus(): { 
    isRunning: boolean, 
    lastHealthCheck: Date, 
    lastMetricsCollection: Date | null 
  } {
    return {
      isRunning: this.isRunning,
      lastHealthCheck: this.systemHealth.lastChecked,
      lastMetricsCollection: this.lastSystemMetrics?.timestamp || null
    };
  }
}
