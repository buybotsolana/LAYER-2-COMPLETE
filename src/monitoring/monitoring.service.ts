// English comment for verification
/**
 * @file monitoring.service.ts
 * @description Service for monitoring system performance and detecting issues
 */

import { DatabaseService } from '../database/database.service';
import { MonitoringEvent, EventSeverity, EventCategory, PerformanceMetric, AlertConfiguration, AlertHistory, SystemHealth } from './monitoring.entity';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import * as os from 'os';

/**
 * Interface for monitoring service configuration
 */
export interface MonitoringConfig {
  enabled: boolean;
  alertingEnabled: boolean;
  retentionDays: number;
  metricsIntervalMs: number;
  healthCheckIntervalMs: number;
  alertEvaluationIntervalMs: number;
  logLevel: EventSeverity;
  notificationChannels: NotificationChannel[];
  customMetrics: CustomMetricConfig[];
}

/**
 * Interface for notification channel configuration
 */
export interface NotificationChannel {
  type: 'email' | 'slack' | 'webhook' | 'pagerduty';
  name: string;
  config: any;
  enabled: boolean;
}

/**
 * Interface for custom metric configuration
 */
export interface CustomMetricConfig {
  name: string;
  source: string;
  collectFunction: () => Promise<number>;
  unit?: string;
  dimensions?: Record<string, string>;
  intervalMs?: number;
}

/**
 * Interface for event logging parameters
 */
export interface LogEventParams {
  source: string;
  eventType: string;
  severity: EventSeverity;
  category: EventCategory;
  message: string;
  details?: any;
  relatedEntityId?: string;
  relatedEntityType?: string;
}

/**
 * Interface for recording metric parameters
 */
export interface RecordMetricParams {
  metricType: string;
  source: string;
  value: number;
  unit?: string;
  dimensions?: Record<string, string>;
}

/**
 * Interface for alert configuration parameters
 */
export interface CreateAlertConfigParams {
  name: string;
  description: string;
  metricType: string;
  source?: string;
  operator: string;
  threshold: number;
  evaluationPeriodSeconds: number;
  consecutiveDatapointsToAlert: number;
  severity: EventSeverity;
  notificationChannels?: any;
  dimensions?: Record<string, string>;
}

/**
 * Interface for alert notification parameters
 */
export interface SendAlertNotificationParams {
  alertId: string;
  alertName: string;
  severity: EventSeverity;
  message: string;
  value: number;
  threshold: number;
  details?: any;
  channels?: string[];
}

/**
 * Interface for error statistics
 */
export interface ErrorStatistics {
  totalErrors: number;
  errorsByType: Record<string, number>;
  errorsByHour: { hour: Date; count: number }[];
  mostFrequentErrors: { message: string; count: number }[];
}

/**
 * Service for monitoring system performance and detecting issues
 */
export class MonitoringService {
  private static instance: MonitoringService;
  private initialized: boolean = false;
  private running: boolean = false;
  
  private config: MonitoringConfig = {
    enabled: true,
    alertingEnabled: true,
    retentionDays: 30,
    metricsIntervalMs: 60000, // 1 minute
    healthCheckIntervalMs: 300000, // 5 minutes
    alertEvaluationIntervalMs: 60000, // 1 minute
    logLevel: EventSeverity.INFO,
    notificationChannels: [],
    customMetrics: []
  };
  
  private metricsInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private alertEvaluationInterval: NodeJS.Timeout | null = null;
  private customMetricIntervals: Map<string, NodeJS.Timeout> = new Map();
  
  private eventRepository: Repository<MonitoringEvent>;
  private metricRepository: Repository<PerformanceMetric>;
  private alertConfigRepository: Repository<AlertConfiguration>;
  private alertHistoryRepository: Repository<AlertHistory>;
  private systemHealthRepository: Repository<SystemHealth>;
  
  private activeAlerts: Map<string, AlertHistory> = new Map();
  private errorCounters: Map<string, number> = new Map();
  
  private constructor() {
    // Private constructor to enforce singleton pattern
  }
  
  /**
   * Get the singleton instance of the MonitoringService
   * @returns The MonitoringService instance
   */
  public static getInstance(): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService();
    }
    return MonitoringService.instance;
  }
  
  /**
   * Initialize the monitoring service
   * @param config Optional configuration to override defaults
   */
  public async initialize(config?: Partial<MonitoringConfig>): Promise<void> {
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
      
      // Get repositories
      this.eventRepository = dbService.getRepository(MonitoringEvent);
      this.metricRepository = dbService.getRepository(PerformanceMetric);
      this.alertConfigRepository = dbService.getRepository(AlertConfiguration);
      this.alertHistoryRepository = dbService.getRepository(AlertHistory);
      this.systemHealthRepository = dbService.getRepository(SystemHealth);
      
      // Log initialization
      await this.logEvent({
        source: 'MonitoringService',
        eventType: 'Initialization',
        severity: EventSeverity.INFO,
        category: EventCategory.SYSTEM,
        message: 'Monitoring service initialized'
      });
      
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize monitoring service: ${error.message}`);
    }
  }
  
  /**
   * Start the monitoring service
   */
  public async start(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    if (this.running) {
      return;
    }
    
    try {
      // Start collecting system metrics
      if (this.config.enabled) {
        this.metricsInterval = setInterval(
          () => this.collectSystemMetrics(),
          this.config.metricsIntervalMs
        );
        
        this.healthCheckInterval = setInterval(
          () => this.performHealthCheck(),
          this.config.healthCheckIntervalMs
        );
        
        // Start alert evaluation if alerting is enabled
        if (this.config.alertingEnabled) {
          this.alertEvaluationInterval = setInterval(
            () => this.evaluateAlerts(),
            this.config.alertEvaluationIntervalMs
          );
        }
        
        // Start custom metric collection
        this.startCustomMetricCollection();
      }
      
      // Log start
      await this.logEvent({
        source: 'MonitoringService',
        eventType: 'Start',
        severity: EventSeverity.INFO,
        category: EventCategory.SYSTEM,
        message: 'Monitoring service started'
      });
      
      this.running = true;
    } catch (error) {
      throw new Error(`Failed to start monitoring service: ${error.message}`);
    }
  }
  
  /**
   * Stop the monitoring service
   */
  public async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    
    try {
      // Stop all intervals
      if (this.metricsInterval) {
        clearInterval(this.metricsInterval);
        this.metricsInterval = null;
      }
      
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }
      
      if (this.alertEvaluationInterval) {
        clearInterval(this.alertEvaluationInterval);
        this.alertEvaluationInterval = null;
      }
      
      // Stop custom metric intervals
      this.stopCustomMetricCollection();
      
      // Log stop
      await this.logEvent({
        source: 'MonitoringService',
        eventType: 'Stop',
        severity: EventSeverity.INFO,
        category: EventCategory.SYSTEM,
        message: 'Monitoring service stopped'
      });
      
      this.running = false;
    } catch (error) {
      throw new Error(`Failed to stop monitoring service: ${error.message}`);
    }
  }
  
  /**
   * Log an event to the monitoring system
   * @param params Event parameters
   * @returns The created event
   */
  public async logEvent(params: LogEventParams): Promise<MonitoringEvent> {
    try {
      // Check if severity is above log level
      if (this.getSeverityLevel(params.severity) < this.getSeverityLevel(this.config.logLevel)) {
        return null;
      }
      
      // Create event entity
      const event = new MonitoringEvent();
      event.source = params.source;
      event.eventType = params.eventType;
      event.severity = params.severity;
      event.category = params.category;
      event.message = params.message;
      event.details = params.details;
      event.relatedEntityId = params.relatedEntityId;
      event.relatedEntityType = params.relatedEntityType;
      event.timestamp = new Date();
      
      // Save to database if initialized
      if (this.initialized) {
        return await this.eventRepository.save(event);
      }
      
      return event;
    } catch (error) {
      console.error(`Failed to log event: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Record a metric to the monitoring system
   * @param params Metric parameters
   * @returns The created metric
   */
  public async recordMetric(params: RecordMetricParams): Promise<PerformanceMetric> {
    try {
      // Create metric entity
      const metric = new PerformanceMetric();
      metric.metricType = params.metricType;
      metric.source = params.source;
      metric.value = params.value;
      metric.unit = params.unit;
      metric.dimensions = params.dimensions;
      metric.timestamp = new Date();
      
      // Save to database if initialized
      if (this.initialized) {
        return await this.metricRepository.save(metric);
      }
      
      return metric;
    } catch (error) {
      console.error(`Failed to record metric: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Create a new alert configuration
   * @param params Alert configuration parameters
   * @returns The created alert configuration
   */
  public async createAlertConfig(params: CreateAlertConfigParams): Promise<AlertConfiguration> {
    try {
      // Create alert configuration entity
      const alertConfig = new AlertConfiguration();
      alertConfig.name = params.name;
      alertConfig.description = params.description;
      alertConfig.metricType = params.metricType;
      alertConfig.source = params.source;
      alertConfig.operator = params.operator;
      alertConfig.threshold = params.threshold;
      alertConfig.evaluationPeriodSeconds = params.evaluationPeriodSeconds;
      alertConfig.consecutiveDatapointsToAlert = params.consecutiveDatapointsToAlert;
      alertConfig.severity = params.severity;
      alertConfig.notificationChannels = params.notificationChannels;
      alertConfig.dimensions = params.dimensions;
      alertConfig.enabled = true;
      
      // Save to database
      return await this.alertConfigRepository.save(alertConfig);
    } catch (error) {
      throw new Error(`Failed to create alert configuration: ${error.message}`);
    }
  }
  
  /**
   * Update an existing alert configuration
   * @param id Alert configuration ID
   * @param params Alert configuration parameters to update
   * @returns The updated alert configuration
   */
  public async updateAlertConfig(id: string, params: Partial<CreateAlertConfigParams>): Promise<AlertConfiguration> {
    try {
      // Get existing alert configuration
      const alertConfig = await this.alertConfigRepository.findOne({ where: { id } });
      if (!alertConfig) {
        throw new Error(`Alert configuration not found: ${id}`);
      }
      
      // Update fields
      Object.assign(alertConfig, params);
      
      // Save to database
      return await this.alertConfigRepository.save(alertConfig);
    } catch (error) {
      throw new Error(`Failed to update alert configuration: ${error.message}`);
    }
  }
  
  /**
   * Delete an alert configuration
   * @param id Alert configuration ID
   * @returns True if deleted successfully
   */
  public async deleteAlertConfig(id: string): Promise<boolean> {
    try {
      // Get existing alert configuration
      const alertConfig = await this.alertConfigRepository.findOne({ where: { id } });
      if (!alertConfig) {
        throw new Error(`Alert configuration not found: ${id}`);
      }
      
      // Delete from database
      await this.alertConfigRepository.remove(alertConfig);
      return true;
    } catch (error) {
      throw new Error(`Failed to delete alert configuration: ${error.message}`);
    }
  }
  
  /**
   * Get all alert configurations
   * @param enabled Optional filter for enabled status
   * @returns List of alert configurations
   */
  public async getAlertConfigs(enabled?: boolean): Promise<AlertConfiguration[]> {
    try {
      const query: any = {};
      if (enabled !== undefined) {
        query.enabled = enabled;
      }
      
      return await this.alertConfigRepository.find({ where: query });
    } catch (error) {
      throw new Error(`Failed to get alert configurations: ${error.message}`);
    }
  }
  
  /**
   * Get alert history
   * @param limit Maximum number of records to return
   * @param offset Offset for pagination
   * @param status Optional filter for alert status
   * @returns List of alert history records
   */
  public async getAlertHistory(limit: number = 100, offset: number = 0, status?: string): Promise<AlertHistory[]> {
    try {
      const query: any = {};
      if (status) {
        query.status = status;
      }
      
      return await this.alertHistoryRepository.find({
        where: query,
        order: { timestamp: 'DESC' },
        take: limit,
        skip: offset
      });
    } catch (error) {
      throw new Error(`Failed to get alert history: ${error.message}`);
    }
  }
  
  /**
   * Get recent events
   * @param limit Maximum number of records to return
   * @param offset Offset for pagination
   * @param severity Optional filter for event severity
   * @param category Optional filter for event category
   * @returns List of events
   */
  public async getEvents(
    limit: number = 100,
    offset: number = 0,
    severity?: EventSeverity,
    category?: EventCategory
  ): Promise<MonitoringEvent[]> {
    try {
      const query: any = {};
      if (severity) {
        query.severity = severity;
      }
      if (category) {
        query.category = category;
      }
      
      return await this.eventRepository.find({
        where: query,
        order: { timestamp: 'DESC' },
        take: limit,
        skip: offset
      });
    } catch (error) {
      throw new Error(`Failed to get events: ${error.message}`);
    }
  }
  
  /**
   * Get metrics by type
   * @param metricType Type of metric to retrieve
   * @param startTime Start time for metrics
   * @param endTime End time for metrics
   * @param limit Maximum number of records to return
   * @returns List of metrics
   */
  public async getMetricsByType(
    metricType: string,
    startTime: Date,
    endTime: Date,
    limit: number = 1000
  ): Promise<PerformanceMetric[]> {
    try {
      const queryBuilder = this.metricRepository.createQueryBuilder('metric')
        .where('metric.metricType = :metricType', { metricType })
        .andWhere('metric.timestamp >= :startTime', { startTime })
        .andWhere('metric.timestamp <= :endTime', { endTime })
        .orderBy('metric.timestamp', 'ASC')
        .take(limit);
      
      return await queryBuilder.getMany();
    } catch (error) {
      throw new Error(`Failed to get metrics by type: ${error.message}`);
    }
  }
  
  /**
   * Get aggregated metrics by type
   * @param metricType Type of metric to retrieve
   * @param startTime Start time for metrics
   * @param endTime End time for metrics
   * @param aggregation Aggregation function (avg, min, max, sum)
   * @param intervalMinutes Interval in minutes for aggregation
   * @returns Aggregated metrics
   */
  public async getAggregatedMetrics(
    metricType: string,
    startTime: Date,
    endTime: Date,
    aggregation: 'avg' | 'min' | 'max' | 'sum' = 'avg',
    intervalMinutes: number = 5
  ): Promise<any[]> {
    try {
      const queryBuilder = this.metricRepository.createQueryBuilder('metric')
        .select(`date_trunc('minute', "timestamp") - (extract(minute from "timestamp")::int % :interval) * interval '1 minute'`, 'time_bucket')
        .addSelect(`${aggregation}(value)`, 'value')
        .where('metric.metricType = :metricType', { metricType })
        .andWhere('metric.timestamp >= :startTime', { startTime })
        .andWhere('metric.timestamp <= :endTime', { endTime })
        .setParameter('interval', intervalMinutes)
        .groupBy('time_bucket')
        .orderBy('time_bucket', 'ASC');
      
      return await queryBuilder.getRawMany();
    } catch (error) {
      throw new Error(`Failed to get aggregated metrics: ${error.message}`);
    }
  }
  
  /**
   * Get the latest system health status
   * @returns The latest system health status
   */
  public async getLatestHealthStatus(): Promise<SystemHealth> {
    try {
      return await this.systemHealthRepository.findOne({
        order: { timestamp: 'DESC' }
      });
    } catch (error) {
      throw new Error(`Failed to get latest health status: ${error.message}`);
    }
  }
  
  /**
   * Get error statistics
   * @param hours Number of hours to look back
   * @returns Error statistics
   */
  public async getErrorStatistics(hours: number = 24): Promise<ErrorStatistics> {
    try {
      const startTime = new Date();
      startTime.setHours(startTime.getHours() - hours);
      
      // Get total errors
      const totalErrors = await this.eventRepository.count({
        where: {
          severity: EventSeverity.ERROR,
          timestamp: { $gte: startTime }
        }
      });
      
      // Get errors by type
      const errorsByTypeQuery = this.eventRepository.createQueryBuilder('event')
        .select('event.eventType', 'type')
        .addSelect('COUNT(*)', 'count')
        .where('event.severity = :severity', { severity: EventSeverity.ERROR })
        .andWhere('event.timestamp >= :startTime', { startTime })
        .groupBy('event.eventType')
        .orderBy('count', 'DESC');
      
      const errorsByTypeResult = await errorsByTypeQuery.getRawMany();
      const errorsByType: Record<string, number> = {};
      errorsByTypeResult.forEach(item => {
        errorsByType[item.type] = parseInt(item.count);
      });
      
      // Get errors by hour
      const errorsByHour = await this.getErrorsByHour(hours);
      
      // Get most frequent errors
      const mostFrequentErrors = await this.getMostFrequentErrors(hours);
      
      return {
        totalErrors,
        errorsByType,
        errorsByHour,
        mostFrequentErrors
      };
    } catch (error) {
      throw new Error(`Failed to get error statistics: ${error.message}`);
    }
  }
  
  /**
   * Get errors grouped by hour
   * @param hours Number of hours to look back
   * @returns Errors by hour
   */
  public async getErrorsByHour(hours: number = 24): Promise<{ hour: Date; count: number }[]> {
    try {
      const startTime = new Date();
      startTime.setHours(startTime.getHours() - hours);
      
      const queryBuilder = this.eventRepository.createQueryBuilder('event')
        .select(`date_trunc('hour', "timestamp")`, 'hour')
        .addSelect('COUNT(*)', 'count')
        .where('event.severity = :severity', { severity: EventSeverity.ERROR })
        .andWhere('event.timestamp >= :startTime', { startTime })
        .groupBy('hour')
        .orderBy('hour', 'ASC');
      
      const result = await queryBuilder.getRawMany();
      
      return result.map(item => ({
        hour: new Date(item.hour),
        count: parseInt(item.count)
      }));
    } catch (error) {
      throw new Error(`Failed to get errors by hour: ${error.message}`);
    }
  }
  
  /**
   * Get most frequent error messages
   * @param hours Number of hours to look back
   * @param limit Maximum number of records to return
   * @returns Most frequent errors
   */
  public async getMostFrequentErrors(hours: number = 24, limit: number = 10): Promise<{ message: string; count: number }[]> {
    try {
      const startTime = new Date();
      startTime.setHours(startTime.getHours() - hours);
      
      const queryBuilder = this.eventRepository.createQueryBuilder('event')
        .select('event.message', 'message')
        .addSelect('COUNT(*)', 'count')
        .where('event.severity = :severity', { severity: EventSeverity.ERROR })
        .andWhere('event.timestamp >= :startTime', { startTime })
        .groupBy('event.message')
        .orderBy('count', 'DESC')
        .take(limit);
      
      const result = await queryBuilder.getRawMany();
      
      return result.map(item => ({
        message: item.message,
        count: parseInt(item.count)
      }));
    } catch (error) {
      throw new Error(`Failed to get most frequent errors: ${error.message}`);
    }
  }
  
  /**
   * Increment error counter for a specific error type
   * @param errorType Type of error
   * @returns Current count
   */
  public incrementErrorCounter(errorType: string): number {
    const currentCount = this.errorCounters.get(errorType) || 0;
    const newCount = currentCount + 1;
    this.errorCounters.set(errorType, newCount);
    return newCount;
  }
  
  /**
   * Get error counters
   * @returns Map of error counters
   */
  public getErrorCounters(): Map<string, number> {
    return new Map(this.errorCounters);
  }
  
  /**
   * Reset error counters
   */
  public resetErrorCounters(): void {
    this.errorCounters.clear();
  }
  
  /**
   * Clean up old monitoring data
   * @param days Number of days to retain data
   * @returns Number of records deleted
   */
  public async cleanupOldData(days: number = 30): Promise<{ events: number; metrics: number; alerts: number }> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      
      // Delete old events
      const eventsResult = await this.eventRepository.createQueryBuilder()
        .delete()
        .where('timestamp < :cutoffDate', { cutoffDate })
        .execute();
      
      // Delete old metrics
      const metricsResult = await this.metricRepository.createQueryBuilder()
        .delete()
        .where('timestamp < :cutoffDate', { cutoffDate })
        .execute();
      
      // Delete old alert history
      const alertsResult = await this.alertHistoryRepository.createQueryBuilder()
        .delete()
        .where('timestamp < :cutoffDate', { cutoffDate })
        .execute();
      
      return {
        events: eventsResult.affected || 0,
        metrics: metricsResult.affected || 0,
        alerts: alertsResult.affected || 0
      };
    } catch (error) {
      throw new Error(`Failed to clean up old data: ${error.message}`);
    }
  }
  
  /**
   * Report metrics to the monitoring system
   * @param metrics Object containing metrics to report
   */
  public async reportMetrics(metrics: Record<string, any>): Promise<void> {
    try {
      const timestamp = new Date();
      const promises: Promise<any>[] = [];
      
      // Process each metric
      for (const [key, value] of Object.entries(metrics)) {
        if (typeof value === 'number') {
          promises.push(this.recordMetric({
            metricType: key,
            source: 'system',
            value
          }));
        } else if (typeof value === 'object' && value !== null) {
          // Handle nested metrics
          for (const [nestedKey, nestedValue] of Object.entries(value)) {
            if (typeof nestedValue === 'number') {
              promises.push(this.recordMetric({
                metricType: `${key}.${nestedKey}`,
                source: 'system',
                value: nestedValue
              }));
            }
          }
        }
      }
      
      await Promise.all(promises);
    } catch (error) {
      console.error(`Failed to report metrics: ${error.message}`);
    }
  }
  
  /**
   * Check for alerts based on current metrics
   */
  public async checkAlerts(): Promise<void> {
    if (!this.config.alertingEnabled) {
      return;
    }
    
    try {
      // Get enabled alert configurations
      const alertConfigs = await this.getAlertConfigs(true);
      
      for (const config of alertConfigs) {
        await this.evaluateAlertConfig(config);
      }
    } catch (error) {
      console.error(`Failed to check alerts: ${error.message}`);
    }
  }
  
  /**
   * Add a notification channel
   * @param channel Notification channel configuration
   */
  public addNotificationChannel(channel: NotificationChannel): void {
    this.config.notificationChannels.push(channel);
  }
  
  /**
   * Remove a notification channel
   * @param name Name of the channel to remove
   * @returns True if removed successfully
   */
  public removeNotificationChannel(name: string): boolean {
    const initialLength = this.config.notificationChannels.length;
    this.config.notificationChannels = this.config.notificationChannels.filter(
      channel => channel.name !== name
    );
    return this.config.notificationChannels.length < initialLength;
  }
  
  /**
   * Add a custom metric
   * @param metricConfig Custom metric configuration
   */
  public addCustomMetric(metricConfig: CustomMetricConfig): void {
    this.config.customMetrics.push(metricConfig);
    
    // Start collection if monitoring is running
    if (this.running) {
      this.startCustomMetricCollection(metricConfig);
    }
  }
  
  /**
   * Remove a custom metric
   * @param name Name of the metric to remove
   * @returns True if removed successfully
   */
  public removeCustomMetric(name: string): boolean {
    const initialLength = this.config.customMetrics.length;
    
    // Stop collection if running
    if (this.customMetricIntervals.has(name)) {
      clearInterval(this.customMetricIntervals.get(name));
      this.customMetricIntervals.delete(name);
    }
    
    this.config.customMetrics = this.config.customMetrics.filter(
      metric => metric.name !== name
    );
    
    return this.config.customMetrics.length < initialLength;
  }
  
  /**
   * Update monitoring configuration
   * @param config Partial configuration to update
   */
  public updateConfig(config: Partial<MonitoringConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...config };
    
    // Restart intervals if running and intervals changed
    if (this.running) {
      if (oldConfig.metricsIntervalMs !== this.config.metricsIntervalMs && this.metricsInterval) {
        clearInterval(this.metricsInterval);
        this.metricsInterval = setInterval(
          () => this.collectSystemMetrics(),
          this.config.metricsIntervalMs
        );
      }
      
      if (oldConfig.healthCheckIntervalMs !== this.config.healthCheckIntervalMs && this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = setInterval(
          () => this.performHealthCheck(),
          this.config.healthCheckIntervalMs
        );
      }
      
      if (oldConfig.alertEvaluationIntervalMs !== this.config.alertEvaluationIntervalMs && this.alertEvaluationInterval) {
        clearInterval(this.alertEvaluationInterval);
        this.alertEvaluationInterval = setInterval(
          () => this.evaluateAlerts(),
          this.config.alertEvaluationIntervalMs
        );
      }
    }
  }
  
  /**
   * Get current monitoring configuration
   * @returns Current configuration
   */
  public getConfig(): MonitoringConfig {
    return { ...this.config };
  }
  
  /**
   * Check if monitoring service is initialized
   * @returns True if initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }
  
  /**
   * Check if monitoring service is running
   * @returns True if running
   */
  public isRunning(): boolean {
    return this.running;
  }
  
  /**
   * Collect system metrics
   * @private
   */
  private async collectSystemMetrics(): Promise<void> {
    try {
      // Collect CPU metrics
      const cpuUsage = os.loadavg()[0] / os.cpus().length; // Normalize by CPU count
      await this.recordMetric({
        metricType: 'system.cpu.usage',
        source: 'system',
        value: cpuUsage,
        unit: 'percent'
      });
      
      // Collect memory metrics
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      const memoryUsage = (usedMemory / totalMemory) * 100;
      
      await this.recordMetric({
        metricType: 'system.memory.usage',
        source: 'system',
        value: memoryUsage,
        unit: 'percent'
      });
      
      await this.recordMetric({
        metricType: 'system.memory.used',
        source: 'system',
        value: usedMemory / (1024 * 1024), // Convert to MB
        unit: 'MB'
      });
      
      // Collect process metrics
      const processMemory = process.memoryUsage();
      await this.recordMetric({
        metricType: 'process.memory.rss',
        source: 'process',
        value: processMemory.rss / (1024 * 1024), // Convert to MB
        unit: 'MB'
      });
      
      await this.recordMetric({
        metricType: 'process.memory.heapUsed',
        source: 'process',
        value: processMemory.heapUsed / (1024 * 1024), // Convert to MB
        unit: 'MB'
      });
      
      await this.recordMetric({
        metricType: 'process.memory.heapTotal',
        source: 'process',
        value: processMemory.heapTotal / (1024 * 1024), // Convert to MB
        unit: 'MB'
      });
      
      // Collect uptime
      await this.recordMetric({
        metricType: 'system.uptime',
        source: 'system',
        value: os.uptime(),
        unit: 'seconds'
      });
      
      await this.recordMetric({
        metricType: 'process.uptime',
        source: 'process',
        value: process.uptime(),
        unit: 'seconds'
      });
      
      // Collect database connection pool metrics
      const dbService = DatabaseService.getInstance();
      const poolStats = await dbService.getConnectionPoolStats();
      
      await this.recordMetric({
        metricType: 'database.connections.total',
        source: 'database',
        value: poolStats.total
      });
      
      await this.recordMetric({
        metricType: 'database.connections.active',
        source: 'database',
        value: poolStats.active
      });
      
      await this.recordMetric({
        metricType: 'database.connections.idle',
        source: 'database',
        value: poolStats.idle
      });
      
      // Collect error metrics
      const errorCounters = this.getErrorCounters();
      let totalErrors = 0;
      
      for (const [errorType, count] of errorCounters.entries()) {
        totalErrors += count;
        await this.recordMetric({
          metricType: `errors.${errorType}`,
          source: 'errors',
          value: count
        });
      }
      
      await this.recordMetric({
        metricType: 'errors.total',
        source: 'errors',
        value: totalErrors
      });
      
      // Reset error counters after recording
      this.resetErrorCounters();
    } catch (error) {
      console.error(`Failed to collect system metrics: ${error.message}`);
    }
  }
  
  /**
   * Perform health check
   * @private
   */
  private async performHealthCheck(): Promise<void> {
    try {
      const healthStatus = new SystemHealth();
      healthStatus.components = {};
      let isHealthy = true;
      let message = 'System is healthy';
      
      // Check database health
      try {
        const dbService = DatabaseService.getInstance();
        const isConnected = await dbService.isConnected();
        healthStatus.components.database = {
          status: isConnected ? 'healthy' : 'unhealthy',
          connected: isConnected
        };
        
        if (!isConnected) {
          isHealthy = false;
          message = 'Database connection issue';
        }
      } catch (error) {
        healthStatus.components.database = {
          status: 'unhealthy',
          error: error.message
        };
        isHealthy = false;
        message = 'Database health check failed';
      }
      
      // Check memory usage
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const memoryUsage = ((totalMemory - freeMemory) / totalMemory) * 100;
      
      healthStatus.components.memory = {
        status: memoryUsage < 90 ? 'healthy' : 'warning',
        usage: memoryUsage,
        total: totalMemory,
        free: freeMemory
      };
      
      if (memoryUsage >= 90) {
        isHealthy = false;
        message = 'High memory usage';
      }
      
      // Check CPU usage
      const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
      
      healthStatus.components.cpu = {
        status: cpuUsage < 80 ? 'healthy' : 'warning',
        usage: cpuUsage,
        cores: os.cpus().length
      };
      
      if (cpuUsage >= 80) {
        isHealthy = false;
        message = 'High CPU usage';
      }
      
      // Check disk space
      // This would require additional libraries or shell commands
      // For simplicity, we'll skip this in the example
      
      // Set overall status
      healthStatus.status = isHealthy ? 'healthy' : 'unhealthy';
      healthStatus.message = message;
      healthStatus.timestamp = new Date();
      
      // Save health status
      await this.systemHealthRepository.save(healthStatus);
      
      // Log critical health issues
      if (!isHealthy) {
        await this.logEvent({
          source: 'HealthCheck',
          eventType: 'HealthIssue',
          severity: EventSeverity.WARNING,
          category: EventCategory.SYSTEM,
          message: `Health check issue detected: ${message}`,
          details: healthStatus.components
        });
      }
    } catch (error) {
      console.error(`Failed to perform health check: ${error.message}`);
      
      // Log the error
      await this.logEvent({
        source: 'HealthCheck',
        eventType: 'HealthCheckError',
        severity: EventSeverity.ERROR,
        category: EventCategory.SYSTEM,
        message: `Health check failed: ${error.message}`
      });
    }
  }
  
  /**
   * Evaluate all alerts
   * @private
   */
  private async evaluateAlerts(): Promise<void> {
    try {
      // Get enabled alert configurations
      const alertConfigs = await this.getAlertConfigs(true);
      
      for (const config of alertConfigs) {
        await this.evaluateAlertConfig(config);
      }
    } catch (error) {
      console.error(`Failed to evaluate alerts: ${error.message}`);
    }
  }
  
  /**
   * Evaluate a specific alert configuration
   * @param config Alert configuration to evaluate
   * @private
   */
  private async evaluateAlertConfig(config: AlertConfiguration): Promise<void> {
    try {
      // Get evaluation period start time
      const startTime = new Date();
      startTime.setSeconds(startTime.getSeconds() - config.evaluationPeriodSeconds);
      
      // Get metrics for the evaluation period
      const metrics = await this.getMetricsByType(config.metricType, startTime, new Date());
      
      if (metrics.length === 0) {
        return; // No data to evaluate
      }
      
      // Apply source filter if specified
      const filteredMetrics = config.source
        ? metrics.filter(m => m.source === config.source)
        : metrics;
      
      if (filteredMetrics.length === 0) {
        return; // No data after filtering
      }
      
      // Apply dimensions filter if specified
      const dimensionFilteredMetrics = config.dimensions
        ? filteredMetrics.filter(m => {
            if (!m.dimensions) return false;
            
            for (const [key, value] of Object.entries(config.dimensions)) {
              if (m.dimensions[key] !== value) {
                return false;
              }
            }
            
            return true;
          })
        : filteredMetrics;
      
      if (dimensionFilteredMetrics.length === 0) {
        return; // No data after dimension filtering
      }
      
      // Get the most recent metrics for evaluation
      const recentMetrics = dimensionFilteredMetrics
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, config.consecutiveDatapointsToAlert);
      
      if (recentMetrics.length < config.consecutiveDatapointsToAlert) {
        return; // Not enough data points
      }
      
      // Check if all data points breach the threshold
      const allBreach = recentMetrics.every(metric => {
        return this.checkThresholdBreach(metric.value, config.threshold, config.operator);
      });
      
      // Get the latest value for reporting
      const latestValue = recentMetrics[0].value;
      
      // Check if alert is already active
      const alertKey = config.id;
      const isAlertActive = this.activeAlerts.has(alertKey);
      
      if (allBreach && !isAlertActive) {
        // Create new alert
        const alert = new AlertHistory();
        alert.alertConfigurationId = config.id;
        alert.name = config.name;
        alert.severity = config.severity;
        alert.status = 'TRIGGERED';
        alert.message = `Alert triggered: ${config.name} - ${config.metricType} ${config.operator} ${config.threshold}`;
        alert.value = latestValue;
        alert.threshold = config.threshold;
        alert.details = {
          source: config.source,
          dimensions: config.dimensions,
          evaluationPeriod: config.evaluationPeriodSeconds,
          datapoints: recentMetrics.map(m => ({
            timestamp: m.timestamp,
            value: m.value
          }))
        };
        alert.timestamp = new Date();
        
        // Save alert to database
        const savedAlert = await this.alertHistoryRepository.save(alert);
        
        // Add to active alerts
        this.activeAlerts.set(alertKey, savedAlert);
        
        // Send notification
        await this.sendAlertNotification({
          alertId: savedAlert.id,
          alertName: config.name,
          severity: config.severity,
          message: alert.message,
          value: latestValue,
          threshold: config.threshold,
          details: alert.details,
          channels: config.notificationChannels
        });
        
        // Log event
        await this.logEvent({
          source: 'AlertSystem',
          eventType: 'AlertTriggered',
          severity: config.severity,
          category: EventCategory.SYSTEM,
          message: alert.message,
          details: {
            alertId: savedAlert.id,
            alertName: config.name,
            value: latestValue,
            threshold: config.threshold
          }
        });
      } else if (!allBreach && isAlertActive) {
        // Resolve existing alert
        const activeAlert = this.activeAlerts.get(alertKey);
        activeAlert.status = 'RESOLVED';
        activeAlert.resolvedAt = new Date();
        
        // Update in database
        await this.alertHistoryRepository.save(activeAlert);
        
        // Remove from active alerts
        this.activeAlerts.delete(alertKey);
        
        // Log event
        await this.logEvent({
          source: 'AlertSystem',
          eventType: 'AlertResolved',
          severity: EventSeverity.INFO,
          category: EventCategory.SYSTEM,
          message: `Alert resolved: ${config.name}`,
          details: {
            alertId: activeAlert.id,
            alertName: config.name,
            value: latestValue,
            threshold: config.threshold
          }
        });
      }
    } catch (error) {
      console.error(`Failed to evaluate alert config ${config.id}: ${error.message}`);
    }
  }
  
  /**
   * Send alert notification
   * @param params Notification parameters
   * @private
   */
  private async sendAlertNotification(params: SendAlertNotificationParams): Promise<void> {
    try {
      const notificationResults: any[] = [];
      
      // Get channels to notify
      const channelsToNotify = params.channels && params.channels.length > 0
        ? this.config.notificationChannels.filter(c => params.channels.includes(c.name) && c.enabled)
        : this.config.notificationChannels.filter(c => c.enabled);
      
      if (channelsToNotify.length === 0) {
        return; // No channels to notify
      }
      
      // Format message
      const formattedMessage = `
ALERT: ${params.alertName}
Severity: ${params.severity}
Message: ${params.message}
Value: ${params.value}
Threshold: ${params.threshold}
Time: ${new Date().toISOString()}
      `.trim();
      
      // Send to each channel
      for (const channel of channelsToNotify) {
        try {
          switch (channel.type) {
            case 'email':
              // Implementation would depend on email library
              notificationResults.push({
                channel: channel.name,
                type: 'email',
                success: true,
                message: 'Email notification sent'
              });
              break;
              
            case 'slack':
              // Implementation would depend on Slack API library
              notificationResults.push({
                channel: channel.name,
                type: 'slack',
                success: true,
                message: 'Slack notification sent'
              });
              break;
              
            case 'webhook':
              // Implementation would use HTTP client
              notificationResults.push({
                channel: channel.name,
                type: 'webhook',
                success: true,
                message: 'Webhook notification sent'
              });
              break;
              
            case 'pagerduty':
              // Implementation would depend on PagerDuty API library
              notificationResults.push({
                channel: channel.name,
                type: 'pagerduty',
                success: true,
                message: 'PagerDuty notification sent'
              });
              break;
              
            default:
              notificationResults.push({
                channel: channel.name,
                type: channel.type,
                success: false,
                message: 'Unknown channel type'
              });
          }
        } catch (error) {
          notificationResults.push({
            channel: channel.name,
            type: channel.type,
            success: false,
            message: error.message
          });
        }
      }
      
      // Update alert with notification results
      const alert = await this.alertHistoryRepository.findOne({ where: { id: params.alertId } });
      if (alert) {
        alert.notificationsSent += 1;
        alert.notificationResults = notificationResults;
        await this.alertHistoryRepository.save(alert);
      }
    } catch (error) {
      console.error(`Failed to send alert notification: ${error.message}`);
    }
  }
  
  /**
   * Start custom metric collection
   * @param specificMetric Optional specific metric to start
   * @private
   */
  private startCustomMetricCollection(specificMetric?: CustomMetricConfig): void {
    const metricsToStart = specificMetric
      ? [specificMetric]
      : this.config.customMetrics;
    
    for (const metric of metricsToStart) {
      // Skip if already collecting
      if (this.customMetricIntervals.has(metric.name)) {
        continue;
      }
      
      const intervalMs = metric.intervalMs || this.config.metricsIntervalMs;
      
      // Create interval
      const interval = setInterval(async () => {
        try {
          const value = await metric.collectFunction();
          await this.recordMetric({
            metricType: metric.name,
            source: metric.source,
            value,
            unit: metric.unit,
            dimensions: metric.dimensions
          });
        } catch (error) {
          console.error(`Failed to collect custom metric ${metric.name}: ${error.message}`);
        }
      }, intervalMs);
      
      // Store interval reference
      this.customMetricIntervals.set(metric.name, interval);
    }
  }
  
  /**
   * Stop custom metric collection
   * @private
   */
  private stopCustomMetricCollection(): void {
    for (const [name, interval] of this.customMetricIntervals.entries()) {
      clearInterval(interval);
    }
    
    this.customMetricIntervals.clear();
  }
  
  /**
   * Check if a value breaches a threshold
   * @param value Value to check
   * @param threshold Threshold to compare against
   * @param operator Comparison operator
   * @returns True if threshold is breached
   * @private
   */
  private checkThresholdBreach(value: number, threshold: number, operator: string): boolean {
    switch (operator) {
      case '>':
        return value > threshold;
      case '>=':
        return value >= threshold;
      case '<':
        return value < threshold;
      case '<=':
        return value <= threshold;
      case '==':
      case '=':
        return value === threshold;
      case '!=':
        return value !== threshold;
      default:
        return false;
    }
  }
  
  /**
   * Get numeric severity level for comparison
   * @param severity Severity to convert
   * @returns Numeric severity level
   * @private
   */
  private getSeverityLevel(severity: EventSeverity): number {
    switch (severity) {
      case EventSeverity.DEBUG:
        return 0;
      case EventSeverity.INFO:
        return 1;
      case EventSeverity.WARNING:
        return 2;
      case EventSeverity.ERROR:
        return 3;
      case EventSeverity.CRITICAL:
        return 4;
      default:
        return 0;
    }
  }
}
