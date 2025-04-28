// English comment for verification
/**
 * @file MetricsService.ts
 * @description Service for collecting and reporting metrics in the Wormhole Relayer system
 * @author Manus AI
 * @date April 27, 2025
 */

import { Logger } from '../utils/Logger';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

/**
 * Interface for metrics configuration
 */
interface MetricsConfig {
  // General settings
  enabled: boolean;
  collectInterval: number; // Interval in milliseconds to collect metrics
  retentionPeriod: number; // Retention period in days
  
  // System metrics
  system: {
    enabled: boolean;
    collectCPU: boolean;
    collectMemory: boolean;
    collectDisk: boolean;
    collectNetwork: boolean;
  };
  
  // Application metrics
  application: {
    enabled: boolean;
    collectTransactions: boolean;
    collectBundles: boolean;
    collectDeposits: boolean;
    collectWithdrawals: boolean;
    collectFinalization: boolean;
  };
  
  // Storage settings
  storage: {
    memory: {
      enabled: boolean;
      maxItems: number;
    };
    file: {
      enabled: boolean;
      directory: string;
      rotateInterval: number; // Interval in milliseconds to rotate files
    };
    prometheus: {
      enabled: boolean;
      port: number;
      endpoint: string;
    };
    influxdb: {
      enabled: boolean;
      url: string;
      token: string;
      org: string;
      bucket: string;
    };
  };
  
  // Alerting settings
  alerting: {
    enabled: boolean;
    thresholds: {
      [key: string]: {
        warning: number;
        critical: number;
      };
    };
  };
}

/**
 * Interface for a metric
 */
interface Metric {
  name: string;
  value: number;
  timestamp: number;
  tags?: { [key: string]: string };
}

/**
 * Interface for a metric series
 */
interface MetricSeries {
  name: string;
  dataPoints: {
    timestamp: number;
    value: number;
  }[];
  tags?: { [key: string]: string };
}

/**
 * Interface for system metrics
 */
interface SystemMetrics {
  cpu: {
    usage: number;
    loadAvg1m: number;
    loadAvg5m: number;
    loadAvg15m: number;
  };
  memory: {
    total: number;
    free: number;
    used: number;
    usedPercent: number;
  };
  disk: {
    total: number;
    free: number;
    used: number;
    usedPercent: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
  };
}

/**
 * MetricsService class
 * 
 * Provides a comprehensive metrics collection and reporting system for the Wormhole Relayer,
 * with support for system and application metrics, multiple storage backends,
 * and alerting based on thresholds.
 */
export class MetricsService extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: MetricsConfig;
  private isRunning: boolean = false;
  
  // Metrics storage
  private memoryMetrics: Map<string, MetricSeries> = new Map();
  
  // Timers
  private collectTimer: NodeJS.Timeout | null = null;
  private rotateTimer: NodeJS.Timeout | null = null;
  
  // System metrics cache
  private lastCpuInfo: { idle: number; total: number } | null = null;
  private lastNetworkInfo: { bytesIn: number; bytesOut: number; packetsIn: number; packetsOut: number } | null = null;
  
  // Prometheus server (if enabled)
  private prometheusServer: any = null;
  
  // InfluxDB client (if enabled)
  private influxClient: any = null;
  
  /**
   * Creates a new instance of the MetricsService
   * 
   * @param logger The logger
   * @param config The metrics configuration
   */
  constructor(
    logger: Logger,
    config?: Partial<MetricsConfig>
  ) {
    super();
    this.logger = logger.createChild('MetricsService');
    
    // Default configuration
    const defaultConfig: MetricsConfig = {
      enabled: true,
      collectInterval: 10000, // 10 seconds
      retentionPeriod: 7, // 7 days
      
      system: {
        enabled: true,
        collectCPU: true,
        collectMemory: true,
        collectDisk: true,
        collectNetwork: true
      },
      
      application: {
        enabled: true,
        collectTransactions: true,
        collectBundles: true,
        collectDeposits: true,
        collectWithdrawals: true,
        collectFinalization: true
      },
      
      storage: {
        memory: {
          enabled: true,
          maxItems: 1000
        },
        file: {
          enabled: true,
          directory: path.join(process.cwd(), 'metrics'),
          rotateInterval: 86400000 // 24 hours
        },
        prometheus: {
          enabled: false,
          port: 9090,
          endpoint: '/metrics'
        },
        influxdb: {
          enabled: false,
          url: 'http://localhost:8086',
          token: '',
          org: 'wormhole',
          bucket: 'relayer'
        }
      },
      
      alerting: {
        enabled: true,
        thresholds: {
          'system.cpu.usage': {
            warning: 70,
            critical: 90
          },
          'system.memory.usedPercent': {
            warning: 80,
            critical: 95
          },
          'system.disk.usedPercent': {
            warning: 80,
            critical: 95
          }
        }
      }
    };
    
    // Merge provided config with defaults
    this.config = {
      ...defaultConfig,
      ...config,
      system: {
        ...defaultConfig.system,
        ...(config?.system || {})
      },
      application: {
        ...defaultConfig.application,
        ...(config?.application || {})
      },
      storage: {
        memory: {
          ...defaultConfig.storage.memory,
          ...(config?.storage?.memory || {})
        },
        file: {
          ...defaultConfig.storage.file,
          ...(config?.storage?.file || {})
        },
        prometheus: {
          ...defaultConfig.storage.prometheus,
          ...(config?.storage?.prometheus || {})
        },
        influxdb: {
          ...defaultConfig.storage.influxdb,
          ...(config?.storage?.influxdb || {})
        }
      },
      alerting: {
        ...defaultConfig.alerting,
        thresholds: {
          ...defaultConfig.alerting.thresholds,
          ...(config?.alerting?.thresholds || {})
        }
      }
    };
  }
  
  /**
   * Starts the metrics service
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Metrics service is already running');
      return;
    }
    
    if (!this.config.enabled) {
      this.logger.info('Metrics service is disabled');
      return;
    }
    
    this.isRunning = true;
    this.logger.info('Starting metrics service');
    
    try {
      // Create metrics directory if it doesn't exist
      if (this.config.storage.file.enabled) {
        if (!fs.existsSync(this.config.storage.file.directory)) {
          fs.mkdirSync(this.config.storage.file.directory, { recursive: true });
        }
      }
      
      // Initialize Prometheus if enabled
      if (this.config.storage.prometheus.enabled) {
        await this.initializePrometheus();
      }
      
      // Initialize InfluxDB if enabled
      if (this.config.storage.influxdb.enabled) {
        await this.initializeInfluxDB();
      }
      
      // Start collecting metrics
      this.startCollecting();
      
      // Start file rotation if enabled
      if (this.config.storage.file.enabled) {
        this.startFileRotation();
      }
      
      this.logger.info('Metrics service started successfully');
      this.recordMetric('metrics_service.started', 1);
    } catch (error) {
      this.isRunning = false;
      this.logger.error('Failed to start metrics service', error);
      throw error;
    }
  }
  
  /**
   * Stops the metrics service
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('Metrics service is not running');
      return;
    }
    
    this.isRunning = false;
    this.logger.info('Stopping metrics service');
    
    try {
      // Stop collecting metrics
      if (this.collectTimer) {
        clearInterval(this.collectTimer);
        this.collectTimer = null;
      }
      
      // Stop file rotation
      if (this.rotateTimer) {
        clearInterval(this.rotateTimer);
        this.rotateTimer = null;
      }
      
      // Stop Prometheus server if running
      if (this.prometheusServer) {
        await this.stopPrometheus();
      }
      
      // Close InfluxDB connection if open
      if (this.influxClient) {
        await this.closeInfluxDB();
      }
      
      this.logger.info('Metrics service stopped successfully');
    } catch (error) {
      this.logger.error('Error stopping metrics service', error);
      throw error;
    }
  }
  
  /**
   * Initializes the Prometheus server
   */
  private async initializePrometheus(): Promise<void> {
    this.logger.info('Initializing Prometheus server');
    
    try {
      // In a real implementation, you would initialize the Prometheus server here
      // For this example, we'll simulate it
      
      this.prometheusServer = {
        isRunning: true,
        register: new Map(),
        addMetric: (name: string, value: number, labels: any) => {
          this.prometheusServer.register.set(name, { value, labels });
        },
        stop: async () => {
          this.prometheusServer = null;
        }
      };
      
      this.logger.info(`Prometheus server initialized on port ${this.config.storage.prometheus.port}`);
    } catch (error) {
      this.logger.error('Failed to initialize Prometheus server', error);
      throw error;
    }
  }
  
  /**
   * Stops the Prometheus server
   */
  private async stopPrometheus(): Promise<void> {
    this.logger.info('Stopping Prometheus server');
    
    try {
      if (this.prometheusServer) {
        await this.prometheusServer.stop();
        this.prometheusServer = null;
      }
      
      this.logger.info('Prometheus server stopped successfully');
    } catch (error) {
      this.logger.error('Failed to stop Prometheus server', error);
      throw error;
    }
  }
  
  /**
   * Initializes the InfluxDB client
   */
  private async initializeInfluxDB(): Promise<void> {
    this.logger.info('Initializing InfluxDB client');
    
    try {
      // In a real implementation, you would initialize the InfluxDB client here
      // For this example, we'll simulate it
      
      this.influxClient = {
        isConnected: true,
        writePoint: async (point: any) => {
          // Simulate writing a point
        },
        close: async () => {
          this.influxClient = null;
        }
      };
      
      this.logger.info(`InfluxDB client initialized for ${this.config.storage.influxdb.url}`);
    } catch (error) {
      this.logger.error('Failed to initialize InfluxDB client', error);
      throw error;
    }
  }
  
  /**
   * Closes the InfluxDB client
   */
  private async closeInfluxDB(): Promise<void> {
    this.logger.info('Closing InfluxDB client');
    
    try {
      if (this.influxClient) {
        await this.influxClient.close();
        this.influxClient = null;
      }
      
      this.logger.info('InfluxDB client closed successfully');
    } catch (error) {
      this.logger.error('Failed to close InfluxDB client', error);
      throw error;
    }
  }
  
  /**
   * Starts collecting metrics
   */
  private startCollecting(): void {
    this.logger.debug('Starting metrics collection');
    
    this.collectTimer = setInterval(() => {
      this.collectMetrics();
    }, this.config.collectInterval);
  }
  
  /**
   * Starts file rotation
   */
  private startFileRotation(): void {
    this.logger.debug('Starting metrics file rotation');
    
    this.rotateTimer = setInterval(() => {
      this.rotateFiles();
    }, this.config.storage.file.rotateInterval);
  }
  
  /**
   * Collects metrics
   */
  private async collectMetrics(): Promise<void> {
    if (!this.isRunning) return;
    
    try {
      // Collect system metrics if enabled
      if (this.config.system.enabled) {
        const systemMetrics = await this.collectSystemMetrics();
        this.recordSystemMetrics(systemMetrics);
      }
      
      // Collect application metrics if enabled
      if (this.config.application.enabled) {
        // Application metrics are recorded by the application itself
        // using the recordMetric method
      }
      
      // Check for alerts
      if (this.config.alerting.enabled) {
        this.checkAlerts();
      }
    } catch (error) {
      this.logger.error('Error collecting metrics', error);
    }
  }
  
  /**
   * Collects system metrics
   * 
   * @returns The system metrics
   */
  private async collectSystemMetrics(): Promise<SystemMetrics> {
    const metrics: SystemMetrics = {
      cpu: {
        usage: 0,
        loadAvg1m: 0,
        loadAvg5m: 0,
        loadAvg15m: 0
      },
      memory: {
        total: 0,
        free: 0,
        used: 0,
        usedPercent: 0
      },
      disk: {
        total: 0,
        free: 0,
        used: 0,
        usedPercent: 0
      },
      network: {
        bytesIn: 0,
        bytesOut: 0,
        packetsIn: 0,
        packetsOut: 0
      }
    };
    
    // Collect CPU metrics
    if (this.config.system.collectCPU) {
      // Get CPU info
      const cpuInfo = os.cpus();
      let idle = 0;
      let total = 0;
      
      for (const cpu of cpuInfo) {
        idle += cpu.times.idle;
        total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
      }
      
      // Calculate CPU usage
      if (this.lastCpuInfo) {
        const idleDiff = idle - this.lastCpuInfo.idle;
        const totalDiff = total - this.lastCpuInfo.total;
        
        metrics.cpu.usage = 100 - Math.round((idleDiff / totalDiff) * 100);
      }
      
      // Update last CPU info
      this.lastCpuInfo = { idle, total };
      
      // Get load averages
      const loadAvg = os.loadavg();
      metrics.cpu.loadAvg1m = loadAvg[0];
      metrics.cpu.loadAvg5m = loadAvg[1];
      metrics.cpu.loadAvg15m = loadAvg[2];
    }
    
    // Collect memory metrics
    if (this.config.system.collectMemory) {
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      
      metrics.memory.total = totalMemory;
      metrics.memory.free = freeMemory;
      metrics.memory.used = usedMemory;
      metrics.memory.usedPercent = Math.round((usedMemory / totalMemory) * 100);
    }
    
    // Collect disk metrics
    if (this.config.system.collectDisk) {
      try {
        // In a real implementation, you would use a library like 'diskusage'
        // For this example, we'll simulate it
        
        const totalDisk = 1024 * 1024 * 1024 * 1024; // 1 TB
        const freeDisk = 1024 * 1024 * 1024 * 512; // 500 GB
        const usedDisk = totalDisk - freeDisk;
        
        metrics.disk.total = totalDisk;
        metrics.disk.free = freeDisk;
        metrics.disk.used = usedDisk;
        metrics.disk.usedPercent = Math.round((usedDisk / totalDisk) * 100);
      } catch (error) {
        this.logger.error('Error collecting disk metrics', error);
      }
    }
    
    // Collect network metrics
    if (this.config.system.collectNetwork) {
      try {
        // In a real implementation, you would use a library like 'systeminformation'
        // For this example, we'll simulate it
        
        const bytesIn = Math.floor(Math.random() * 1000000);
        const bytesOut = Math.floor(Math.random() * 1000000);
        const packetsIn = Math.floor(Math.random() * 1000);
        const packetsOut = Math.floor(Math.random() * 1000);
        
        // Calculate differences if we have previous values
        if (this.lastNetworkInfo) {
          metrics.network.bytesIn = bytesIn - this.lastNetworkInfo.bytesIn;
          metrics.network.bytesOut = bytesOut - this.lastNetworkInfo.bytesOut;
          metrics.network.packetsIn = packetsIn - this.lastNetworkInfo.packetsIn;
          metrics.network.packetsOut = packetsOut - this.lastNetworkInfo.packetsOut;
        }
        
        // Update last network info
        this.lastNetworkInfo = { bytesIn, bytesOut, packetsIn, packetsOut };
      } catch (error) {
        this.logger.error('Error collecting network metrics', error);
      }
    }
    
    return metrics;
  }
  
  /**
   * Records system metrics
   * 
   * @param metrics The system metrics
   */
  private recordSystemMetrics(metrics: SystemMetrics): void {
    // Record CPU metrics
    if (this.config.system.collectCPU) {
      this.recordMetric('system.cpu.usage', metrics.cpu.usage);
      this.recordMetric('system.cpu.loadAvg1m', metrics.cpu.loadAvg1m);
      this.recordMetric('system.cpu.loadAvg5m', metrics.cpu.loadAvg5m);
      this.recordMetric('system.cpu.loadAvg15m', metrics.cpu.loadAvg15m);
    }
    
    // Record memory metrics
    if (this.config.system.collectMemory) {
      this.recordMetric('system.memory.total', metrics.memory.total);
      this.recordMetric('system.memory.free', metrics.memory.free);
      this.recordMetric('system.memory.used', metrics.memory.used);
      this.recordMetric('system.memory.usedPercent', metrics.memory.usedPercent);
    }
    
    // Record disk metrics
    if (this.config.system.collectDisk) {
      this.recordMetric('system.disk.total', metrics.disk.total);
      this.recordMetric('system.disk.free', metrics.disk.free);
      this.recordMetric('system.disk.used', metrics.disk.used);
      this.recordMetric('system.disk.usedPercent', metrics.disk.usedPercent);
    }
    
    // Record network metrics
    if (this.config.system.collectNetwork) {
      this.recordMetric('system.network.bytesIn', metrics.network.bytesIn);
      this.recordMetric('system.network.bytesOut', metrics.network.bytesOut);
      this.recordMetric('system.network.packetsIn', metrics.network.packetsIn);
      this.recordMetric('system.network.packetsOut', metrics.network.packetsOut);
    }
  }
  
  /**
   * Records a metric
   * 
   * @param name The metric name
   * @param value The metric value
   * @param tags Optional tags
   */
  public recordMetric(name: string, value: number, tags?: { [key: string]: string }): void {
    if (!this.isRunning || !this.config.enabled) {
      return;
    }
    
    try {
      const timestamp = Date.now();
      
      // Create metric
      const metric: Metric = {
        name,
        value,
        timestamp,
        tags
      };
      
      // Store in memory if enabled
      if (this.config.storage.memory.enabled) {
        this.storeMetricInMemory(metric);
      }
      
      // Store in file if enabled
      if (this.config.storage.file.enabled) {
        this.storeMetricInFile(metric);
      }
      
      // Store in Prometheus if enabled
      if (this.config.storage.prometheus.enabled && this.prometheusServer) {
        this.storeMetricInPrometheus(metric);
      }
      
      // Store in InfluxDB if enabled
      if (this.config.storage.influxdb.enabled && this.influxClient) {
        this.storeMetricInInfluxDB(metric);
      }
      
      // Check for alerts
      if (this.config.alerting.enabled && this.config.alerting.thresholds[name]) {
        this.checkAlert(name, value);
      }
      
      // Emit event
      this.emit('metric', metric);
    } catch (error) {
      this.logger.error(`Error recording metric ${name}`, error);
    }
  }
  
  /**
   * Stores a metric in memory
   * 
   * @param metric The metric to store
   */
  private storeMetricInMemory(metric: Metric): void {
    // Get or create series
    let series = this.memoryMetrics.get(metric.name);
    
    if (!series) {
      series = {
        name: metric.name,
        dataPoints: [],
        tags: metric.tags
      };
      this.memoryMetrics.set(metric.name, series);
    }
    
    // Add data point
    series.dataPoints.push({
      timestamp: metric.timestamp,
      value: metric.value
    });
    
    // Limit number of data points
    if (series.dataPoints.length > this.config.storage.memory.maxItems) {
      series.dataPoints.shift();
    }
  }
  
  /**
   * Stores a metric in a file
   * 
   * @param metric The metric to store
   */
  private storeMetricInFile(metric: Metric): void {
    try {
      // Create file path
      const date = new Date(metric.timestamp);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      
      const filePath = path.join(
        this.config.storage.file.directory,
        `${year}-${month}-${day}.metrics.jsonl`
      );
      
      // Append to file
      fs.appendFileSync(filePath, JSON.stringify(metric) + '\n');
    } catch (error) {
      this.logger.error(`Error storing metric ${metric.name} in file`, error);
    }
  }
  
  /**
   * Stores a metric in Prometheus
   * 
   * @param metric The metric to store
   */
  private storeMetricInPrometheus(metric: Metric): void {
    try {
      // In a real implementation, you would use the Prometheus client library
      // For this example, we'll simulate it
      
      this.prometheusServer.addMetric(metric.name, metric.value, metric.tags || {});
    } catch (error) {
      this.logger.error(`Error storing metric ${metric.name} in Prometheus`, error);
    }
  }
  
  /**
   * Stores a metric in InfluxDB
   * 
   * @param metric The metric to store
   */
  private storeMetricInInfluxDB(metric: Metric): void {
    try {
      // In a real implementation, you would use the InfluxDB client library
      // For this example, we'll simulate it
      
      // Create point
      const point = {
        measurement: metric.name,
        fields: { value: metric.value },
        tags: metric.tags || {},
        timestamp: new Date(metric.timestamp)
      };
      
      // Write point
      this.influxClient.writePoint(point);
    } catch (error) {
      this.logger.error(`Error storing metric ${metric.name} in InfluxDB`, error);
    }
  }
  
  /**
   * Rotates metrics files
   */
  private rotateFiles(): void {
    if (!this.config.storage.file.enabled) return;
    
    try {
      const directory = this.config.storage.file.directory;
      
      // Get all metrics files
      const files = fs.readdirSync(directory)
        .filter(file => file.endsWith('.metrics.jsonl'))
        .map(file => path.join(directory, file));
      
      // Calculate retention date
      const retentionDate = new Date();
      retentionDate.setDate(retentionDate.getDate() - this.config.retentionPeriod);
      
      // Delete old files
      for (const file of files) {
        const fileName = path.basename(file);
        const dateMatch = fileName.match(/^(\d{4})-(\d{2})-(\d{2})\.metrics\.jsonl$/);
        
        if (dateMatch) {
          const fileDate = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
          
          if (fileDate < retentionDate) {
            fs.unlinkSync(file);
            this.logger.debug(`Deleted old metrics file: ${fileName}`);
          }
        }
      }
    } catch (error) {
      this.logger.error('Error rotating metrics files', error);
    }
  }
  
  /**
   * Checks for alerts
   */
  private checkAlerts(): void {
    if (!this.config.alerting.enabled) return;
    
    try {
      // Check all metrics with thresholds
      for (const [name, threshold] of Object.entries(this.config.alerting.thresholds)) {
        const series = this.memoryMetrics.get(name);
        
        if (series && series.dataPoints.length > 0) {
          const latestValue = series.dataPoints[series.dataPoints.length - 1].value;
          this.checkAlert(name, latestValue);
        }
      }
    } catch (error) {
      this.logger.error('Error checking alerts', error);
    }
  }
  
  /**
   * Checks if a metric value exceeds alert thresholds
   * 
   * @param name The metric name
   * @param value The metric value
   */
  private checkAlert(name: string, value: number): void {
    const threshold = this.config.alerting.thresholds[name];
    
    if (!threshold) return;
    
    // Check critical threshold
    if (value >= threshold.critical) {
      this.logger.error(`CRITICAL ALERT: ${name} = ${value} (threshold: ${threshold.critical})`);
      this.emit('alert', {
        name,
        value,
        level: 'critical',
        threshold: threshold.critical,
        timestamp: Date.now()
      });
    }
    // Check warning threshold
    else if (value >= threshold.warning) {
      this.logger.warn(`WARNING ALERT: ${name} = ${value} (threshold: ${threshold.warning})`);
      this.emit('alert', {
        name,
        value,
        level: 'warning',
        threshold: threshold.warning,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Gets metrics for a specific name
   * 
   * @param name The metric name
   * @param startTime Optional start time
   * @param endTime Optional end time
   * @returns The metric series
   */
  public getMetrics(name: string, startTime?: number, endTime?: number): MetricSeries | null {
    if (!this.isRunning || !this.config.enabled || !this.config.storage.memory.enabled) {
      return null;
    }
    
    const series = this.memoryMetrics.get(name);
    
    if (!series) {
      return null;
    }
    
    // Filter by time range if specified
    if (startTime !== undefined || endTime !== undefined) {
      const filteredDataPoints = series.dataPoints.filter(point => {
        if (startTime !== undefined && point.timestamp < startTime) {
          return false;
        }
        if (endTime !== undefined && point.timestamp > endTime) {
          return false;
        }
        return true;
      });
      
      return {
        name: series.name,
        dataPoints: filteredDataPoints,
        tags: series.tags
      };
    }
    
    return series;
  }
  
  /**
   * Gets all metrics
   * 
   * @param startTime Optional start time
   * @param endTime Optional end time
   * @returns All metric series
   */
  public getAllMetrics(startTime?: number, endTime?: number): MetricSeries[] {
    if (!this.isRunning || !this.config.enabled || !this.config.storage.memory.enabled) {
      return [];
    }
    
    const result: MetricSeries[] = [];
    
    for (const series of this.memoryMetrics.values()) {
      // Filter by time range if specified
      if (startTime !== undefined || endTime !== undefined) {
        const filteredDataPoints = series.dataPoints.filter(point => {
          if (startTime !== undefined && point.timestamp < startTime) {
            return false;
          }
          if (endTime !== undefined && point.timestamp > endTime) {
            return false;
          }
          return true;
        });
        
        result.push({
          name: series.name,
          dataPoints: filteredDataPoints,
          tags: series.tags
        });
      } else {
        result.push(series);
      }
    }
    
    return result;
  }
  
  /**
   * Gets the latest value for a specific metric
   * 
   * @param name The metric name
   * @returns The latest value, or null if not found
   */
  public getLatestValue(name: string): number | null {
    if (!this.isRunning || !this.config.enabled || !this.config.storage.memory.enabled) {
      return null;
    }
    
    const series = this.memoryMetrics.get(name);
    
    if (!series || series.dataPoints.length === 0) {
      return null;
    }
    
    return series.dataPoints[series.dataPoints.length - 1].value;
  }
  
  /**
   * Gets the status of the metrics service
   * 
   * @returns The status
   */
  public getStatus(): {
    isRunning: boolean;
    enabled: boolean;
    memoryEnabled: boolean;
    fileEnabled: boolean;
    prometheusEnabled: boolean;
    influxdbEnabled: boolean;
    metricCount: number;
    dataPointCount: number;
  } {
    let dataPointCount = 0;
    
    for (const series of this.memoryMetrics.values()) {
      dataPointCount += series.dataPoints.length;
    }
    
    return {
      isRunning: this.isRunning,
      enabled: this.config.enabled,
      memoryEnabled: this.config.storage.memory.enabled,
      fileEnabled: this.config.storage.file.enabled,
      prometheusEnabled: this.config.storage.prometheus.enabled,
      influxdbEnabled: this.config.storage.influxdb.enabled,
      metricCount: this.memoryMetrics.size,
      dataPointCount
    };
  }
}
