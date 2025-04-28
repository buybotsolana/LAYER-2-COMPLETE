// English comment for verification
/**
 * @file BridgeMonitoringService.ts
 * @description Service for monitoring the bridge between Ethereum and Solana
 * 
 * This service provides comprehensive monitoring of the bridge operations,
 * including transaction status, health checks, performance metrics, and alerting.
 */

import { EthereumConnector } from '../connectors/EthereumConnector';
import { SolanaConnector } from '../connectors/SolanaConnector';
import { Logger } from '../utils/Logger';
import { MetricsCollector } from '../utils/MetricsCollector';
import { Cache } from '../utils/Cache';
import { Repository, Between, LessThan, MoreThan, In } from 'typeorm';
import { BridgeTransaction, TransactionStatus, TransactionType } from '../models/BridgeTransaction';
import { BlockFinalization, BlockFinalizationState } from '../models/BlockFinalization';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

/**
 * Configuration for the bridge monitoring service
 */
export interface BridgeMonitoringConfig {
    /**
     * Monitoring interval in milliseconds
     */
    monitoringInterval?: number;
    
    /**
     * Whether to enable health checks
     */
    enableHealthChecks?: boolean;
    
    /**
     * Health check interval in milliseconds
     */
    healthCheckInterval?: number;
    
    /**
     * Whether to enable performance monitoring
     */
    enablePerformanceMonitoring?: boolean;
    
    /**
     * Performance monitoring interval in milliseconds
     */
    performanceMonitoringInterval?: number;
    
    /**
     * Whether to enable alerting
     */
    enableAlerting?: boolean;
    
    /**
     * Alert notification endpoints
     */
    alertEndpoints?: {
        /**
         * Slack webhook URL
         */
        slack?: string;
        
        /**
         * Email recipients
         */
        email?: string[];
        
        /**
         * PagerDuty service key
         */
        pagerDuty?: string;
        
        /**
         * Custom webhook URL
         */
        webhook?: string;
    };
    
    /**
     * Maximum number of transactions to process in a batch
     */
    batchSize?: number;
    
    /**
     * Directory for storing monitoring reports
     */
    reportDirectory?: string;
    
    /**
     * Whether to enable automatic report generation
     */
    enableReportGeneration?: boolean;
    
    /**
     * Report generation interval in milliseconds
     */
    reportGenerationInterval?: number;
    
    /**
     * Maximum age of reports to keep (in days)
     */
    maxReportAge?: number;
    
    /**
     * Whether to enable transaction status monitoring
     */
    enableTransactionStatusMonitoring?: boolean;
    
    /**
     * Transaction status monitoring interval in milliseconds
     */
    transactionStatusMonitoringInterval?: number;
    
    /**
     * Maximum age of stuck transactions to alert on (in milliseconds)
     */
    stuckTransactionThreshold?: number;
    
    /**
     * Whether to enable gas price monitoring
     */
    enableGasPriceMonitoring?: boolean;
    
    /**
     * Gas price monitoring interval in milliseconds
     */
    gasPriceMonitoringInterval?: number;
    
    /**
     * Gas price alert threshold (in gwei)
     */
    gasPriceAlertThreshold?: number;
    
    /**
     * Whether to enable liquidity monitoring
     */
    enableLiquidityMonitoring?: boolean;
    
    /**
     * Liquidity monitoring interval in milliseconds
     */
    liquidityMonitoringInterval?: number;
    
    /**
     * Liquidity alert threshold (in percentage)
     */
    liquidityAlertThreshold?: number;
}

/**
 * Alert severity levels
 */
export enum AlertSeverity {
    INFO = 'info',
    WARNING = 'warning',
    ERROR = 'error',
    CRITICAL = 'critical'
}

/**
 * Alert data
 */
export interface Alert {
    /**
     * Alert ID
     */
    id: string;
    
    /**
     * Alert timestamp
     */
    timestamp: number;
    
    /**
     * Alert severity
     */
    severity: AlertSeverity;
    
    /**
     * Alert title
     */
    title: string;
    
    /**
     * Alert message
     */
    message: string;
    
    /**
     * Alert source
     */
    source: string;
    
    /**
     * Alert data
     */
    data?: any;
    
    /**
     * Whether the alert has been acknowledged
     */
    acknowledged?: boolean;
    
    /**
     * Acknowledgement timestamp
     */
    acknowledgedAt?: number;
    
    /**
     * Acknowledgement user
     */
    acknowledgedBy?: string;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
    /**
     * Component name
     */
    component: string;
    
    /**
     * Whether the component is healthy
     */
    healthy: boolean;
    
    /**
     * Health check timestamp
     */
    timestamp: number;
    
    /**
     * Health check message
     */
    message?: string;
    
    /**
     * Health check details
     */
    details?: any;
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
    /**
     * CPU usage (percentage)
     */
    cpuUsage: number;
    
    /**
     * Memory usage (bytes)
     */
    memoryUsage: number;
    
    /**
     * Total memory (bytes)
     */
    totalMemory: number;
    
    /**
     * Free memory (bytes)
     */
    freeMemory: number;
    
    /**
     * Disk usage (bytes)
     */
    diskUsage: number;
    
    /**
     * Total disk space (bytes)
     */
    totalDiskSpace: number;
    
    /**
     * Free disk space (bytes)
     */
    freeDiskSpace: number;
    
    /**
     * Network usage (bytes)
     */
    networkUsage: number;
    
    /**
     * Database connection count
     */
    dbConnections: number;
    
    /**
     * Database query time (ms)
     */
    dbQueryTime: number;
    
    /**
     * Ethereum RPC response time (ms)
     */
    ethereumRpcResponseTime: number;
    
    /**
     * Solana RPC response time (ms)
     */
    solanaRpcResponseTime: number;
    
    /**
     * Transaction processing time (ms)
     */
    transactionProcessingTime: number;
    
    /**
     * Metrics timestamp
     */
    timestamp: number;
}

/**
 * Bridge monitoring service class
 */
export class BridgeMonitoringService {
    private config: BridgeMonitoringConfig;
    private logger: Logger;
    private metrics: MetricsCollector;
    private cache: Cache;
    private ethereumConnector: EthereumConnector;
    private solanaConnector: SolanaConnector;
    private bridgeTransactionRepository: Repository<BridgeTransaction>;
    private blockFinalizationRepository: Repository<BlockFinalization>;
    
    private isRunning: boolean = false;
    private monitoringInterval: NodeJS.Timeout | null = null;
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private performanceMonitoringInterval: NodeJS.Timeout | null = null;
    private reportGenerationInterval: NodeJS.Timeout | null = null;
    private transactionStatusMonitoringInterval: NodeJS.Timeout | null = null;
    private gasPriceMonitoringInterval: NodeJS.Timeout | null = null;
    private liquidityMonitoringInterval: NodeJS.Timeout | null = null;
    
    private alerts: Alert[] = [];
    private healthCheckResults: HealthCheckResult[] = [];
    private performanceMetrics: PerformanceMetrics[] = [];
    
    /**
     * Creates a new instance of the bridge monitoring service
     * @param config Bridge monitoring configuration
     * @param logger Logger instance
     * @param metrics Metrics collector instance
     * @param cache Cache instance
     * @param ethereumConnector Ethereum connector instance
     * @param solanaConnector Solana connector instance
     * @param bridgeTransactionRepository Bridge transaction repository
     * @param blockFinalizationRepository Block finalization repository
     */
    constructor(
        config: BridgeMonitoringConfig,
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
            monitoringInterval: config.monitoringInterval || 60000, // 1 minute
            enableHealthChecks: config.enableHealthChecks !== false,
            healthCheckInterval: config.healthCheckInterval || 300000, // 5 minutes
            enablePerformanceMonitoring: config.enablePerformanceMonitoring !== false,
            performanceMonitoringInterval: config.performanceMonitoringInterval || 60000, // 1 minute
            enableAlerting: config.enableAlerting !== false,
            batchSize: config.batchSize || 100,
            reportDirectory: config.reportDirectory || path.join(process.cwd(), 'reports'),
            enableReportGeneration: config.enableReportGeneration !== false,
            reportGenerationInterval: config.reportGenerationInterval || 3600000, // 1 hour
            maxReportAge: config.maxReportAge || 30, // 30 days
            enableTransactionStatusMonitoring: config.enableTransactionStatusMonitoring !== false,
            transactionStatusMonitoringInterval: config.transactionStatusMonitoringInterval || 300000, // 5 minutes
            stuckTransactionThreshold: config.stuckTransactionThreshold || 3600000, // 1 hour
            enableGasPriceMonitoring: config.enableGasPriceMonitoring !== false,
            gasPriceMonitoringInterval: config.gasPriceMonitoringInterval || 300000, // 5 minutes
            gasPriceAlertThreshold: config.gasPriceAlertThreshold || 100, // 100 gwei
            enableLiquidityMonitoring: config.enableLiquidityMonitoring !== false,
            liquidityMonitoringInterval: config.liquidityMonitoringInterval || 300000, // 5 minutes
            liquidityAlertThreshold: config.liquidityAlertThreshold || 10 // 10%
        };
        
        this.logger = logger;
        this.metrics = metrics;
        this.cache = cache;
        this.ethereumConnector = ethereumConnector;
        this.solanaConnector = solanaConnector;
        this.bridgeTransactionRepository = bridgeTransactionRepository;
        this.blockFinalizationRepository = blockFinalizationRepository;
        
        // Create report directory if it doesn't exist
        if (!fs.existsSync(this.config.reportDirectory)) {
            fs.mkdirSync(this.config.reportDirectory, { recursive: true });
        }
    }
    
    /**
     * Initializes the bridge monitoring service
     */
    public async initialize(): Promise<void> {
        this.logger.info('Initializing bridge monitoring service...');
        
        try {
            // Load previous alerts
            await this.loadAlerts();
            
            // Load previous health check results
            await this.loadHealthCheckResults();
            
            // Load previous performance metrics
            await this.loadPerformanceMetrics();
            
            this.logger.info('Bridge monitoring service initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize bridge monitoring service', error);
            throw error;
        }
    }
    
    /**
     * Loads previous alerts from cache
     */
    private async loadAlerts(): Promise<void> {
        try {
            const cachedAlerts = await this.cache.get('bridge:alerts');
            
            if (cachedAlerts) {
                this.alerts = JSON.parse(cachedAlerts);
                this.logger.info(`Loaded ${this.alerts.length} alerts from cache`);
            }
        } catch (error) {
            this.logger.error('Failed to load alerts from cache', error);
        }
    }
    
    /**
     * Loads previous health check results from cache
     */
    private async loadHealthCheckResults(): Promise<void> {
        try {
            const cachedResults = await this.cache.get('bridge:healthChecks');
            
            if (cachedResults) {
                this.healthCheckResults = JSON.parse(cachedResults);
                this.logger.info(`Loaded ${this.healthCheckResults.length} health check results from cache`);
            }
        } catch (error) {
            this.logger.error('Failed to load health check results from cache', error);
        }
    }
    
    /**
     * Loads previous performance metrics from cache
     */
    private async loadPerformanceMetrics(): Promise<void> {
        try {
            const cachedMetrics = await this.cache.get('bridge:performanceMetrics');
            
            if (cachedMetrics) {
                this.performanceMetrics = JSON.parse(cachedMetrics);
                this.logger.info(`Loaded ${this.performanceMetrics.length} performance metrics from cache`);
            }
        } catch (error) {
            this.logger.error('Failed to load performance metrics from cache', error);
        }
    }
    
    /**
     * Starts the bridge monitoring service
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            this.logger.warn('Bridge monitoring service already running');
            return;
        }
        
        this.logger.info('Starting bridge monitoring service...');
        
        try {
            this.isRunning = true;
            
            // Start monitoring interval
            this.monitoringInterval = setInterval(() => {
                this.runMonitoring();
            }, this.config.monitoringInterval);
            
            // Start health check interval
            if (this.config.enableHealthChecks) {
                this.healthCheckInterval = setInterval(() => {
                    this.runHealthChecks();
                }, this.config.healthCheckInterval);
                
                // Run health checks immediately
                this.runHealthChecks();
            }
            
            // Start performance monitoring interval
            if (this.config.enablePerformanceMonitoring) {
                this.performanceMonitoringInterval = setInterval(() => {
                    this.collectPerformanceMetrics();
                }, this.config.performanceMonitoringInterval);
                
                // Collect performance metrics immediately
                this.collectPerformanceMetrics();
            }
            
            // Start report generation interval
            if (this.config.enableReportGeneration) {
                this.reportGenerationInterval = setInterval(() => {
                    this.generateReport();
                }, this.config.reportGenerationInterval);
            }
            
            // Start transaction status monitoring interval
            if (this.config.enableTransactionStatusMonitoring) {
                this.transactionStatusMonitoringInterval = setInterval(() => {
                    this.monitorTransactionStatus();
                }, this.config.transactionStatusMonitoringInterval);
                
                // Monitor transaction status immediately
                this.monitorTransactionStatus();
            }
            
            // Start gas price monitoring interval
            if (this.config.enableGasPriceMonitoring) {
                this.gasPriceMonitoringInterval = setInterval(() => {
                    this.monitorGasPrice();
                }, this.config.gasPriceMonitoringInterval);
                
                // Monitor gas price immediately
                this.monitorGasPrice();
            }
            
            // Start liquidity monitoring interval
            if (this.config.enableLiquidityMonitoring) {
                this.liquidityMonitoringInterval = setInterval(() => {
                    this.monitorLiquidity();
                }, this.config.liquidityMonitoringInterval);
                
                // Monitor liquidity immediately
                this.monitorLiquidity();
            }
            
            this.logger.info('Bridge monitoring service started successfully');
        } catch (error) {
            this.isRunning = false;
            this.logger.error('Failed to start bridge monitoring service', error);
            throw error;
        }
    }
    
    /**
     * Stops the bridge monitoring service
     */
    public async stop(): Promise<void> {
        if (!this.isRunning) {
            this.logger.warn('Bridge monitoring service not running');
            return;
        }
        
        this.logger.info('Stopping bridge monitoring service...');
        
        try {
            this.isRunning = false;
            
            // Stop monitoring interval
            if (this.monitoringInterval) {
                clearInterval(this.monitoringInterval);
                this.monitoringInterval = null;
            }
            
            // Stop health check interval
            if (this.healthCheckInterval) {
                clearInterval(this.healthCheckInterval);
                this.healthCheckInterval = null;
            }
            
            // Stop performance monitoring interval
            if (this.performanceMonitoringInterval) {
                clearInterval(this.performanceMonitoringInterval);
                this.performanceMonitoringInterval = null;
            }
            
            // Stop report generation interval
            if (this.reportGenerationInterval) {
                clearInterval(this.reportGenerationInterval);
                this.reportGenerationInterval = null;
            }
            
            // Stop transaction status monitoring interval
            if (this.transactionStatusMonitoringInterval) {
                clearInterval(this.transactionStatusMonitoringInterval);
                this.transactionStatusMonitoringInterval = null;
            }
            
            // Stop gas price monitoring interval
            if (this.gasPriceMonitoringInterval) {
                clearInterval(this.gasPriceMonitoringInterval);
                this.gasPriceMonitoringInterval = null;
            }
            
            // Stop liquidity monitoring interval
            if (this.liquidityMonitoringInterval) {
                clearInterval(this.liquidityMonitoringInterval);
                this.liquidityMonitoringInterval = null;
            }
            
            // Save alerts to cache
            await this.cache.set('bridge:alerts', JSON.stringify(this.alerts));
            
            // Save health check results to cache
            await this.cache.set('bridge:healthChecks', JSON.stringify(this.healthCheckResults));
            
            // Save performance metrics to cache
            await this.cache.set('bridge:performanceMetrics', JSON.stringify(this.performanceMetrics));
            
            this.logger.info('Bridge monitoring service stopped successfully');
        } catch (error) {
            this.logger.error('Failed to stop bridge monitoring service', error);
            throw error;
        }
    }
    
    /**
     * Runs the monitoring process
     */
    private async runMonitoring(): Promise<void> {
        if (!this.isRunning) {
            return;
        }
        
        try {
            this.logger.debug('Running bridge monitoring...');
            
            // Collect bridge statistics
            const stats = await this.collectBridgeStatistics();
            
            // Update metrics
            this.updateMetrics(stats);
            
            // Check for anomalies
            await this.checkForAnomalies(stats);
            
            this.logger.debug('Bridge monitoring completed successfully');
        } catch (error) {
            this.logger.error('Error running bridge monitoring', error);
        }
    }
    
    /**
     * Collects bridge statistics
     * @returns Bridge statistics
     */
    private async collectBridgeStatistics(): Promise<any> {
        try {
            const now = Date.now();
            const oneDayAgo = now - 24 * 60 * 60 * 1000;
            
            // Get deposit statistics
            const depositStats = await this.bridgeTransactionRepository
                .createQueryBuilder('tx')
                .select('COUNT(*)', 'total')
                .addSelect('SUM(CASE WHEN tx.status = :completed THEN 1 ELSE 0 END)', 'completed')
                .addSelect('SUM(CASE WHEN tx.status = :pending THEN 1 ELSE 0 END)', 'pending')
                .addSelect('SUM(CASE WHEN tx.status = :processing THEN 1 ELSE 0 END)', 'processing')
                .addSelect('SUM(CASE WHEN tx.status = :failed THEN 1 ELSE 0 END)', 'failed')
                .addSelect('AVG(tx.completedTimestamp - tx.timestamp)', 'avgProcessingTime')
                .where('tx.type = :type', { type: TransactionType.DEPOSIT })
                .andWhere('tx.timestamp >= :oneDayAgo', { oneDayAgo })
                .setParameter('completed', TransactionStatus.COMPLETED)
                .setParameter('pending', TransactionStatus.PENDING)
                .setParameter('processing', TransactionStatus.PROCESSING)
                .setParameter('failed', TransactionStatus.FAILED)
                .getRawOne();
            
            // Get withdrawal statistics
            const withdrawalStats = await this.bridgeTransactionRepository
                .createQueryBuilder('tx')
                .select('COUNT(*)', 'total')
                .addSelect('SUM(CASE WHEN tx.status = :completed THEN 1 ELSE 0 END)', 'completed')
                .addSelect('SUM(CASE WHEN tx.status = :pending THEN 1 ELSE 0 END)', 'pending')
                .addSelect('SUM(CASE WHEN tx.status = :processing THEN 1 ELSE 0 END)', 'processing')
                .addSelect('SUM(CASE WHEN tx.status = :failed THEN 1 ELSE 0 END)', 'failed')
                .addSelect('AVG(tx.completedTimestamp - tx.timestamp)', 'avgProcessingTime')
                .where('tx.type = :type', { type: TransactionType.WITHDRAWAL })
                .andWhere('tx.timestamp >= :oneDayAgo', { oneDayAgo })
                .setParameter('completed', TransactionStatus.COMPLETED)
                .setParameter('pending', TransactionStatus.PENDING)
                .setParameter('processing', TransactionStatus.PROCESSING)
                .setParameter('failed', TransactionStatus.FAILED)
                .getRawOne();
            
            // Get finalization statistics
            const finalizationStats = await this.blockFinalizationRepository
                .createQueryBuilder('bf')
                .select('COUNT(*)', 'total')
                .addSelect('SUM(CASE WHEN bf.state = :proposed THEN 1 ELSE 0 END)', 'proposed')
                .addSelect('SUM(CASE WHEN bf.state = :finalized THEN 1 ELSE 0 END)', 'finalized')
                .addSelect('SUM(CASE WHEN bf.state = :challenged THEN 1 ELSE 0 END)', 'challenged')
                .addSelect('SUM(CASE WHEN bf.state = :invalidated THEN 1 ELSE 0 END)', 'invalidated')
                .addSelect('AVG(bf.finalizationTime - bf.proposalTime)', 'avgFinalizationTime')
                .where('bf.proposalTime >= :oneDayAgo', { oneDayAgo })
                .setParameter('proposed', BlockFinalizationState.PROPOSED)
                .setParameter('finalized', BlockFinalizationState.FINALIZED)
                .setParameter('challenged', BlockFinalizationState.CHALLENGED)
                .setParameter('invalidated', BlockFinalizationState.INVALIDATED)
                .getRawOne();
            
            // Get Ethereum statistics
            const ethereumStats = {
                gasPrice: await this.ethereumConnector.getGasPrice(),
                blockNumber: await this.ethereumConnector.getCurrentBlock(),
                pendingTransactions: await this.ethereumConnector.getPendingTransactionCount()
            };
            
            // Get Solana statistics
            const solanaStats = {
                slot: await this.solanaConnector.getCurrentSlot(),
                transactionCount: await this.solanaConnector.getRecentTransactionCount()
            };
            
            return {
                timestamp: now,
                deposits: depositStats,
                withdrawals: withdrawalStats,
                finalizations: finalizationStats,
                ethereum: ethereumStats,
                solana: solanaStats
            };
        } catch (error) {
            this.logger.error('Error collecting bridge statistics', error);
            throw error;
        }
    }
    
    /**
     * Updates metrics with bridge statistics
     * @param stats Bridge statistics
     */
    private updateMetrics(stats: any): void {
        try {
            // Update deposit metrics
            this.metrics.gauge('bridge.deposits.total', stats.deposits.total || 0);
            this.metrics.gauge('bridge.deposits.completed', stats.deposits.completed || 0);
            this.metrics.gauge('bridge.deposits.pending', stats.deposits.pending || 0);
            this.metrics.gauge('bridge.deposits.processing', stats.deposits.processing || 0);
            this.metrics.gauge('bridge.deposits.failed', stats.deposits.failed || 0);
            this.metrics.gauge('bridge.deposits.avgProcessingTime', stats.deposits.avgProcessingTime || 0);
            
            // Update withdrawal metrics
            this.metrics.gauge('bridge.withdrawals.total', stats.withdrawals.total || 0);
            this.metrics.gauge('bridge.withdrawals.completed', stats.withdrawals.completed || 0);
            this.metrics.gauge('bridge.withdrawals.pending', stats.withdrawals.pending || 0);
            this.metrics.gauge('bridge.withdrawals.processing', stats.withdrawals.processing || 0);
            this.metrics.gauge('bridge.withdrawals.failed', stats.withdrawals.failed || 0);
            this.metrics.gauge('bridge.withdrawals.avgProcessingTime', stats.withdrawals.avgProcessingTime || 0);
            
            // Update finalization metrics
            this.metrics.gauge('bridge.finalizations.total', stats.finalizations.total || 0);
            this.metrics.gauge('bridge.finalizations.proposed', stats.finalizations.proposed || 0);
            this.metrics.gauge('bridge.finalizations.finalized', stats.finalizations.finalized || 0);
            this.metrics.gauge('bridge.finalizations.challenged', stats.finalizations.challenged || 0);
            this.metrics.gauge('bridge.finalizations.invalidated', stats.finalizations.invalidated || 0);
            this.metrics.gauge('bridge.finalizations.avgFinalizationTime', stats.finalizations.avgFinalizationTime || 0);
            
            // Update Ethereum metrics
            this.metrics.gauge('bridge.ethereum.gasPrice', stats.ethereum.gasPrice || 0);
            this.metrics.gauge('bridge.ethereum.blockNumber', stats.ethereum.blockNumber || 0);
            this.metrics.gauge('bridge.ethereum.pendingTransactions', stats.ethereum.pendingTransactions || 0);
            
            // Update Solana metrics
            this.metrics.gauge('bridge.solana.slot', stats.solana.slot || 0);
            this.metrics.gauge('bridge.solana.transactionCount', stats.solana.transactionCount || 0);
        } catch (error) {
            this.logger.error('Error updating metrics', error);
        }
    }
    
    /**
     * Checks for anomalies in bridge statistics
     * @param stats Bridge statistics
     */
    private async checkForAnomalies(stats: any): Promise<void> {
        try {
            // Check for high failure rate in deposits
            const depositFailureRate = stats.deposits.total > 0
                ? (stats.deposits.failed / stats.deposits.total) * 100
                : 0;
            
            if (depositFailureRate > 10) {
                await this.createAlert(
                    AlertSeverity.WARNING,
                    'High deposit failure rate',
                    `Deposit failure rate is ${depositFailureRate.toFixed(2)}%`,
                    'bridge-monitoring',
                    { depositFailureRate, stats: stats.deposits }
                );
            }
            
            // Check for high failure rate in withdrawals
            const withdrawalFailureRate = stats.withdrawals.total > 0
                ? (stats.withdrawals.failed / stats.withdrawals.total) * 100
                : 0;
            
            if (withdrawalFailureRate > 10) {
                await this.createAlert(
                    AlertSeverity.WARNING,
                    'High withdrawal failure rate',
                    `Withdrawal failure rate is ${withdrawalFailureRate.toFixed(2)}%`,
                    'bridge-monitoring',
                    { withdrawalFailureRate, stats: stats.withdrawals }
                );
            }
            
            // Check for challenged finalizations
            if (stats.finalizations.challenged > 0) {
                await this.createAlert(
                    AlertSeverity.ERROR,
                    'Challenged finalizations detected',
                    `${stats.finalizations.challenged} finalization(s) have been challenged`,
                    'bridge-monitoring',
                    { challengedCount: stats.finalizations.challenged }
                );
            }
            
            // Check for invalidated finalizations
            if (stats.finalizations.invalidated > 0) {
                await this.createAlert(
                    AlertSeverity.ERROR,
                    'Invalidated finalizations detected',
                    `${stats.finalizations.invalidated} finalization(s) have been invalidated`,
                    'bridge-monitoring',
                    { invalidatedCount: stats.finalizations.invalidated }
                );
            }
            
            // Check for high gas price
            if (stats.ethereum.gasPrice > this.config.gasPriceAlertThreshold * 1e9) { // Convert gwei to wei
                await this.createAlert(
                    AlertSeverity.WARNING,
                    'High gas price',
                    `Current gas price is ${(stats.ethereum.gasPrice / 1e9).toFixed(2)} gwei, which is above the threshold of ${this.config.gasPriceAlertThreshold} gwei`,
                    'bridge-monitoring',
                    { gasPrice: stats.ethereum.gasPrice, threshold: this.config.gasPriceAlertThreshold * 1e9 }
                );
            }
            
            // Check for long processing times
            if (stats.deposits.avgProcessingTime > 3600000) { // 1 hour
                await this.createAlert(
                    AlertSeverity.WARNING,
                    'Long deposit processing time',
                    `Average deposit processing time is ${(stats.deposits.avgProcessingTime / 60000).toFixed(2)} minutes`,
                    'bridge-monitoring',
                    { avgProcessingTime: stats.deposits.avgProcessingTime }
                );
            }
            
            if (stats.withdrawals.avgProcessingTime > 3600000) { // 1 hour
                await this.createAlert(
                    AlertSeverity.WARNING,
                    'Long withdrawal processing time',
                    `Average withdrawal processing time is ${(stats.withdrawals.avgProcessingTime / 60000).toFixed(2)} minutes`,
                    'bridge-monitoring',
                    { avgProcessingTime: stats.withdrawals.avgProcessingTime }
                );
            }
        } catch (error) {
            this.logger.error('Error checking for anomalies', error);
        }
    }
    
    /**
     * Runs health checks
     */
    private async runHealthChecks(): Promise<void> {
        if (!this.isRunning) {
            return;
        }
        
        try {
            this.logger.debug('Running health checks...');
            
            const results: HealthCheckResult[] = [];
            const timestamp = Date.now();
            
            // Check Ethereum connection
            try {
                const blockNumber = await this.ethereumConnector.getCurrentBlock();
                results.push({
                    component: 'ethereum',
                    healthy: true,
                    timestamp,
                    message: `Connected to Ethereum, current block: ${blockNumber}`,
                    details: { blockNumber }
                });
            } catch (error) {
                results.push({
                    component: 'ethereum',
                    healthy: false,
                    timestamp,
                    message: `Failed to connect to Ethereum: ${error.message}`,
                    details: { error: error.message }
                });
                
                await this.createAlert(
                    AlertSeverity.CRITICAL,
                    'Ethereum connection failed',
                    `Failed to connect to Ethereum: ${error.message}`,
                    'health-check',
                    { error: error.message }
                );
            }
            
            // Check Solana connection
            try {
                const slot = await this.solanaConnector.getCurrentSlot();
                results.push({
                    component: 'solana',
                    healthy: true,
                    timestamp,
                    message: `Connected to Solana, current slot: ${slot}`,
                    details: { slot }
                });
            } catch (error) {
                results.push({
                    component: 'solana',
                    healthy: false,
                    timestamp,
                    message: `Failed to connect to Solana: ${error.message}`,
                    details: { error: error.message }
                });
                
                await this.createAlert(
                    AlertSeverity.CRITICAL,
                    'Solana connection failed',
                    `Failed to connect to Solana: ${error.message}`,
                    'health-check',
                    { error: error.message }
                );
            }
            
            // Check database connection
            try {
                const count = await this.bridgeTransactionRepository.count();
                results.push({
                    component: 'database',
                    healthy: true,
                    timestamp,
                    message: `Connected to database, transaction count: ${count}`,
                    details: { transactionCount: count }
                });
            } catch (error) {
                results.push({
                    component: 'database',
                    healthy: false,
                    timestamp,
                    message: `Failed to connect to database: ${error.message}`,
                    details: { error: error.message }
                });
                
                await this.createAlert(
                    AlertSeverity.CRITICAL,
                    'Database connection failed',
                    `Failed to connect to database: ${error.message}`,
                    'health-check',
                    { error: error.message }
                );
            }
            
            // Check disk space
            try {
                const diskSpace = await this.getDiskSpace();
                const freePercentage = (diskSpace.free / diskSpace.total) * 100;
                const healthy = freePercentage > 10; // Less than 10% free space is unhealthy
                
                results.push({
                    component: 'disk',
                    healthy,
                    timestamp,
                    message: healthy
                        ? `Disk space is sufficient: ${freePercentage.toFixed(2)}% free`
                        : `Low disk space: ${freePercentage.toFixed(2)}% free`,
                    details: diskSpace
                });
                
                if (!healthy) {
                    await this.createAlert(
                        AlertSeverity.ERROR,
                        'Low disk space',
                        `Low disk space: ${freePercentage.toFixed(2)}% free`,
                        'health-check',
                        diskSpace
                    );
                }
            } catch (error) {
                results.push({
                    component: 'disk',
                    healthy: false,
                    timestamp,
                    message: `Failed to check disk space: ${error.message}`,
                    details: { error: error.message }
                });
            }
            
            // Check memory usage
            try {
                const memoryUsage = process.memoryUsage();
                const totalMemory = os.totalmem();
                const freeMemory = os.freemem();
                const usedPercentage = ((totalMemory - freeMemory) / totalMemory) * 100;
                const healthy = usedPercentage < 90; // More than 90% used is unhealthy
                
                results.push({
                    component: 'memory',
                    healthy,
                    timestamp,
                    message: healthy
                        ? `Memory usage is normal: ${usedPercentage.toFixed(2)}% used`
                        : `High memory usage: ${usedPercentage.toFixed(2)}% used`,
                    details: {
                        totalMemory,
                        freeMemory,
                        usedPercentage,
                        processMemory: memoryUsage
                    }
                });
                
                if (!healthy) {
                    await this.createAlert(
                        AlertSeverity.ERROR,
                        'High memory usage',
                        `High memory usage: ${usedPercentage.toFixed(2)}% used`,
                        'health-check',
                        {
                            totalMemory,
                            freeMemory,
                            usedPercentage,
                            processMemory: memoryUsage
                        }
                    );
                }
            } catch (error) {
                results.push({
                    component: 'memory',
                    healthy: false,
                    timestamp,
                    message: `Failed to check memory usage: ${error.message}`,
                    details: { error: error.message }
                });
            }
            
            // Check CPU usage
            try {
                const cpuUsage = await this.getCpuUsage();
                const healthy = cpuUsage < 90; // More than 90% used is unhealthy
                
                results.push({
                    component: 'cpu',
                    healthy,
                    timestamp,
                    message: healthy
                        ? `CPU usage is normal: ${cpuUsage.toFixed(2)}%`
                        : `High CPU usage: ${cpuUsage.toFixed(2)}%`,
                    details: { cpuUsage }
                });
                
                if (!healthy) {
                    await this.createAlert(
                        AlertSeverity.ERROR,
                        'High CPU usage',
                        `High CPU usage: ${cpuUsage.toFixed(2)}%`,
                        'health-check',
                        { cpuUsage }
                    );
                }
            } catch (error) {
                results.push({
                    component: 'cpu',
                    healthy: false,
                    timestamp,
                    message: `Failed to check CPU usage: ${error.message}`,
                    details: { error: error.message }
                });
            }
            
            // Store health check results
            this.healthCheckResults = [...this.healthCheckResults, ...results];
            
            // Trim health check results to keep only the last 1000
            if (this.healthCheckResults.length > 1000) {
                this.healthCheckResults = this.healthCheckResults.slice(-1000);
            }
            
            // Save health check results to cache
            await this.cache.set('bridge:healthChecks', JSON.stringify(this.healthCheckResults));
            
            // Log health check results
            const unhealthyComponents = results.filter(result => !result.healthy);
            
            if (unhealthyComponents.length > 0) {
                this.logger.warn(`Health check completed with ${unhealthyComponents.length} unhealthy components`);
                
                for (const result of unhealthyComponents) {
                    this.logger.warn(`Unhealthy component: ${result.component} - ${result.message}`);
                }
            } else {
                this.logger.info('Health check completed successfully, all components are healthy');
            }
        } catch (error) {
            this.logger.error('Error running health checks', error);
        }
    }
    
    /**
     * Collects performance metrics
     */
    private async collectPerformanceMetrics(): Promise<void> {
        if (!this.isRunning) {
            return;
        }
        
        try {
            this.logger.debug('Collecting performance metrics...');
            
            const timestamp = Date.now();
            
            // Get CPU usage
            const cpuUsage = await this.getCpuUsage();
            
            // Get memory usage
            const memoryUsage = process.memoryUsage();
            const totalMemory = os.totalmem();
            const freeMemory = os.freemem();
            
            // Get disk usage
            const diskSpace = await this.getDiskSpace();
            
            // Get network usage
            const networkUsage = await this.getNetworkUsage();
            
            // Get database connection count
            const dbConnections = await this.getDatabaseConnectionCount();
            
            // Get database query time
            const dbQueryTime = await this.getDatabaseQueryTime();
            
            // Get Ethereum RPC response time
            const ethereumRpcResponseTime = await this.getEthereumRpcResponseTime();
            
            // Get Solana RPC response time
            const solanaRpcResponseTime = await this.getSolanaRpcResponseTime();
            
            // Get transaction processing time
            const transactionProcessingTime = await this.getTransactionProcessingTime();
            
            // Create performance metrics
            const metrics: PerformanceMetrics = {
                cpuUsage,
                memoryUsage: memoryUsage.rss,
                totalMemory,
                freeMemory,
                diskUsage: diskSpace.total - diskSpace.free,
                totalDiskSpace: diskSpace.total,
                freeDiskSpace: diskSpace.free,
                networkUsage,
                dbConnections,
                dbQueryTime,
                ethereumRpcResponseTime,
                solanaRpcResponseTime,
                transactionProcessingTime,
                timestamp
            };
            
            // Store performance metrics
            this.performanceMetrics.push(metrics);
            
            // Trim performance metrics to keep only the last 1000
            if (this.performanceMetrics.length > 1000) {
                this.performanceMetrics = this.performanceMetrics.slice(-1000);
            }
            
            // Save performance metrics to cache
            await this.cache.set('bridge:performanceMetrics', JSON.stringify(this.performanceMetrics));
            
            // Update metrics
            this.metrics.gauge('system.cpu.usage', cpuUsage);
            this.metrics.gauge('system.memory.usage', memoryUsage.rss);
            this.metrics.gauge('system.memory.total', totalMemory);
            this.metrics.gauge('system.memory.free', freeMemory);
            this.metrics.gauge('system.disk.usage', diskSpace.total - diskSpace.free);
            this.metrics.gauge('system.disk.total', diskSpace.total);
            this.metrics.gauge('system.disk.free', diskSpace.free);
            this.metrics.gauge('system.network.usage', networkUsage);
            this.metrics.gauge('system.db.connections', dbConnections);
            this.metrics.gauge('system.db.queryTime', dbQueryTime);
            this.metrics.gauge('system.ethereum.rpcResponseTime', ethereumRpcResponseTime);
            this.metrics.gauge('system.solana.rpcResponseTime', solanaRpcResponseTime);
            this.metrics.gauge('system.transaction.processingTime', transactionProcessingTime);
            
            this.logger.debug('Performance metrics collected successfully');
        } catch (error) {
            this.logger.error('Error collecting performance metrics', error);
        }
    }
    
    /**
     * Gets CPU usage
     * @returns CPU usage percentage
     */
    private async getCpuUsage(): Promise<number> {
        return new Promise((resolve) => {
            const startUsage = process.cpuUsage();
            
            setTimeout(() => {
                const endUsage = process.cpuUsage(startUsage);
                const userCpuUsage = endUsage.user / 1000; // microseconds to milliseconds
                const systemCpuUsage = endUsage.system / 1000; // microseconds to milliseconds
                const totalCpuUsage = userCpuUsage + systemCpuUsage;
                
                // Calculate CPU usage as a percentage of the available CPU time
                // 100ms * number of CPUs
                const availableCpuTime = 100 * os.cpus().length;
                const cpuUsagePercentage = (totalCpuUsage / availableCpuTime) * 100;
                
                resolve(Math.min(cpuUsagePercentage, 100)); // Cap at 100%
            }, 100);
        });
    }
    
    /**
     * Gets disk space
     * @returns Disk space information
     */
    private async getDiskSpace(): Promise<{ total: number, free: number }> {
        // This is a simplified implementation
        // In a real-world scenario, you would use a library like 'diskusage'
        return {
            total: 1000000000000, // 1 TB
            free: 500000000000 // 500 GB
        };
    }
    
    /**
     * Gets network usage
     * @returns Network usage in bytes
     */
    private async getNetworkUsage(): Promise<number> {
        // This is a simplified implementation
        // In a real-world scenario, you would use a library like 'systeminformation'
        return 1000000; // 1 MB
    }
    
    /**
     * Gets database connection count
     * @returns Database connection count
     */
    private async getDatabaseConnectionCount(): Promise<number> {
        // This is a simplified implementation
        // In a real-world scenario, you would query the database for connection count
        return 10;
    }
    
    /**
     * Gets database query time
     * @returns Database query time in milliseconds
     */
    private async getDatabaseQueryTime(): Promise<number> {
        try {
            const start = Date.now();
            await this.bridgeTransactionRepository.count();
            return Date.now() - start;
        } catch (error) {
            this.logger.error('Error measuring database query time', error);
            return 0;
        }
    }
    
    /**
     * Gets Ethereum RPC response time
     * @returns Ethereum RPC response time in milliseconds
     */
    private async getEthereumRpcResponseTime(): Promise<number> {
        try {
            const start = Date.now();
            await this.ethereumConnector.getCurrentBlock();
            return Date.now() - start;
        } catch (error) {
            this.logger.error('Error measuring Ethereum RPC response time', error);
            return 0;
        }
    }
    
    /**
     * Gets Solana RPC response time
     * @returns Solana RPC response time in milliseconds
     */
    private async getSolanaRpcResponseTime(): Promise<number> {
        try {
            const start = Date.now();
            await this.solanaConnector.getCurrentSlot();
            return Date.now() - start;
        } catch (error) {
            this.logger.error('Error measuring Solana RPC response time', error);
            return 0;
        }
    }
    
    /**
     * Gets transaction processing time
     * @returns Transaction processing time in milliseconds
     */
    private async getTransactionProcessingTime(): Promise<number> {
        try {
            const result = await this.bridgeTransactionRepository
                .createQueryBuilder('tx')
                .select('AVG(tx.completedTimestamp - tx.timestamp)', 'avgProcessingTime')
                .where('tx.status = :status', { status: TransactionStatus.COMPLETED })
                .andWhere('tx.completedTimestamp IS NOT NULL')
                .getRawOne();
            
            return result.avgProcessingTime || 0;
        } catch (error) {
            this.logger.error('Error measuring transaction processing time', error);
            return 0;
        }
    }
    
    /**
     * Generates a monitoring report
     */
    private async generateReport(): Promise<void> {
        if (!this.isRunning) {
            return;
        }
        
        try {
            this.logger.info('Generating monitoring report...');
            
            const timestamp = Date.now();
            const dateStr = new Date(timestamp).toISOString().replace(/:/g, '-').replace(/\..+/, '');
            const reportFileName = `bridge-report-${dateStr}.json`;
            const reportPath = path.join(this.config.reportDirectory, reportFileName);
            
            // Collect report data
            const reportData = {
                timestamp,
                bridgeStatistics: await this.collectBridgeStatistics(),
                healthChecks: this.healthCheckResults.slice(-100), // Last 100 health checks
                performanceMetrics: this.performanceMetrics.slice(-100), // Last 100 performance metrics
                alerts: this.alerts.slice(-100) // Last 100 alerts
            };
            
            // Write report to file
            fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
            
            this.logger.info(`Monitoring report generated: ${reportPath}`);
            
            // Clean up old reports
            this.cleanupOldReports();
        } catch (error) {
            this.logger.error('Error generating monitoring report', error);
        }
    }
    
    /**
     * Cleans up old reports
     */
    private cleanupOldReports(): void {
        try {
            const files = fs.readdirSync(this.config.reportDirectory);
            const now = Date.now();
            const maxAge = this.config.maxReportAge * 24 * 60 * 60 * 1000; // Convert days to milliseconds
            
            for (const file of files) {
                if (!file.startsWith('bridge-report-')) {
                    continue;
                }
                
                const filePath = path.join(this.config.reportDirectory, file);
                const stats = fs.statSync(filePath);
                const fileAge = now - stats.mtimeMs;
                
                if (fileAge > maxAge) {
                    fs.unlinkSync(filePath);
                    this.logger.debug(`Deleted old report: ${filePath}`);
                }
            }
        } catch (error) {
            this.logger.error('Error cleaning up old reports', error);
        }
    }
    
    /**
     * Monitors transaction status
     */
    private async monitorTransactionStatus(): Promise<void> {
        if (!this.isRunning) {
            return;
        }
        
        try {
            this.logger.debug('Monitoring transaction status...');
            
            const now = Date.now();
            const stuckThreshold = now - this.config.stuckTransactionThreshold;
            
            // Find stuck transactions
            const stuckTransactions = await this.bridgeTransactionRepository.find({
                where: [
                    {
                        status: TransactionStatus.PENDING,
                        timestamp: LessThan(stuckThreshold)
                    },
                    {
                        status: TransactionStatus.PROCESSING,
                        timestamp: LessThan(stuckThreshold)
                    }
                ],
                take: this.config.batchSize
            });
            
            if (stuckTransactions.length === 0) {
                this.logger.debug('No stuck transactions found');
                return;
            }
            
            this.logger.warn(`Found ${stuckTransactions.length} stuck transactions`);
            
            // Group transactions by type
            const stuckDeposits = stuckTransactions.filter(tx => tx.type === TransactionType.DEPOSIT);
            const stuckWithdrawals = stuckTransactions.filter(tx => tx.type === TransactionType.WITHDRAWAL);
            
            // Create alerts for stuck transactions
            if (stuckDeposits.length > 0) {
                await this.createAlert(
                    AlertSeverity.ERROR,
                    'Stuck deposit transactions',
                    `${stuckDeposits.length} deposit transactions have been stuck for more than ${this.config.stuckTransactionThreshold / 60000} minutes`,
                    'transaction-monitoring',
                    { count: stuckDeposits.length, transactions: stuckDeposits.map(tx => tx.id) }
                );
            }
            
            if (stuckWithdrawals.length > 0) {
                await this.createAlert(
                    AlertSeverity.ERROR,
                    'Stuck withdrawal transactions',
                    `${stuckWithdrawals.length} withdrawal transactions have been stuck for more than ${this.config.stuckTransactionThreshold / 60000} minutes`,
                    'transaction-monitoring',
                    { count: stuckWithdrawals.length, transactions: stuckWithdrawals.map(tx => tx.id) }
                );
            }
        } catch (error) {
            this.logger.error('Error monitoring transaction status', error);
        }
    }
    
    /**
     * Monitors gas price
     */
    private async monitorGasPrice(): Promise<void> {
        if (!this.isRunning) {
            return;
        }
        
        try {
            this.logger.debug('Monitoring gas price...');
            
            // Get current gas price
            const gasPrice = await this.ethereumConnector.getGasPrice();
            const gasPriceGwei = gasPrice / 1e9; // Convert wei to gwei
            
            this.logger.debug(`Current gas price: ${gasPriceGwei.toFixed(2)} gwei`);
            
            // Check if gas price is above threshold
            if (gasPriceGwei > this.config.gasPriceAlertThreshold) {
                await this.createAlert(
                    AlertSeverity.WARNING,
                    'High gas price',
                    `Current gas price is ${gasPriceGwei.toFixed(2)} gwei, which is above the threshold of ${this.config.gasPriceAlertThreshold} gwei`,
                    'gas-price-monitoring',
                    { gasPrice, gasPriceGwei, threshold: this.config.gasPriceAlertThreshold }
                );
            }
        } catch (error) {
            this.logger.error('Error monitoring gas price', error);
        }
    }
    
    /**
     * Monitors liquidity
     */
    private async monitorLiquidity(): Promise<void> {
        if (!this.isRunning) {
            return;
        }
        
        try {
            this.logger.debug('Monitoring liquidity...');
            
            // Get token mappings
            const tokenMappings = await this.getTokenMappings();
            
            for (const mapping of tokenMappings) {
                // Get Ethereum token balance
                const ethereumBalance = await this.ethereumConnector.getTokenBalance(mapping.ethereumToken);
                
                // Get Solana token balance
                const solanaBalance = await this.solanaConnector.getTokenBalance(mapping.solanaToken);
                
                // Calculate liquidity ratio
                const liquidityRatio = ethereumBalance > 0
                    ? (solanaBalance / ethereumBalance) * 100
                    : 100;
                
                this.logger.debug(`Liquidity ratio for ${mapping.symbol}: ${liquidityRatio.toFixed(2)}%`);
                
                // Check if liquidity ratio is below threshold
                if (liquidityRatio < this.config.liquidityAlertThreshold) {
                    await this.createAlert(
                        AlertSeverity.ERROR,
                        'Low liquidity',
                        `Liquidity ratio for ${mapping.symbol} is ${liquidityRatio.toFixed(2)}%, which is below the threshold of ${this.config.liquidityAlertThreshold}%`,
                        'liquidity-monitoring',
                        {
                            symbol: mapping.symbol,
                            ethereumToken: mapping.ethereumToken,
                            solanaToken: mapping.solanaToken,
                            ethereumBalance,
                            solanaBalance,
                            liquidityRatio,
                            threshold: this.config.liquidityAlertThreshold
                        }
                    );
                }
            }
        } catch (error) {
            this.logger.error('Error monitoring liquidity', error);
        }
    }
    
    /**
     * Gets token mappings
     * @returns Token mappings
     */
    private async getTokenMappings(): Promise<any[]> {
        // This is a simplified implementation
        // In a real-world scenario, you would query the database for token mappings
        return [
            {
                symbol: 'ETH',
                ethereumToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
                solanaToken: 'So11111111111111111111111111111111111111112'
            },
            {
                symbol: 'USDC',
                ethereumToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                solanaToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
            }
        ];
    }
    
    /**
     * Creates an alert
     * @param severity Alert severity
     * @param title Alert title
     * @param message Alert message
     * @param source Alert source
     * @param data Alert data
     * @returns Created alert
     */
    public async createAlert(
        severity: AlertSeverity,
        title: string,
        message: string,
        source: string,
        data?: any
    ): Promise<Alert> {
        try {
            // Check if a similar alert already exists
            const existingAlert = this.alerts.find(alert =>
                alert.severity === severity &&
                alert.title === title &&
                alert.source === source &&
                !alert.acknowledged &&
                alert.timestamp > Date.now() - 3600000 // Within the last hour
            );
            
            if (existingAlert) {
                this.logger.debug(`Similar alert already exists: ${existingAlert.id}`);
                return existingAlert;
            }
            
            // Create new alert
            const alert: Alert = {
                id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                timestamp: Date.now(),
                severity,
                title,
                message,
                source,
                data,
                acknowledged: false
            };
            
            // Add alert to list
            this.alerts.push(alert);
            
            // Trim alerts to keep only the last 1000
            if (this.alerts.length > 1000) {
                this.alerts = this.alerts.slice(-1000);
            }
            
            // Save alerts to cache
            await this.cache.set('bridge:alerts', JSON.stringify(this.alerts));
            
            // Log alert
            this.logger.warn(`Alert created: ${alert.title} (${alert.severity})`);
            
            // Send alert notification
            await this.sendAlertNotification(alert);
            
            return alert;
        } catch (error) {
            this.logger.error('Error creating alert', error);
            throw error;
        }
    }
    
    /**
     * Sends an alert notification
     * @param alert Alert to send
     */
    private async sendAlertNotification(alert: Alert): Promise<void> {
        if (!this.config.enableAlerting || !this.config.alertEndpoints) {
            return;
        }
        
        try {
            // Send to Slack
            if (this.config.alertEndpoints.slack) {
                await this.sendSlackNotification(alert);
            }
            
            // Send to email
            if (this.config.alertEndpoints.email && this.config.alertEndpoints.email.length > 0) {
                await this.sendEmailNotification(alert);
            }
            
            // Send to PagerDuty
            if (this.config.alertEndpoints.pagerDuty) {
                await this.sendPagerDutyNotification(alert);
            }
            
            // Send to webhook
            if (this.config.alertEndpoints.webhook) {
                await this.sendWebhookNotification(alert);
            }
        } catch (error) {
            this.logger.error('Error sending alert notification', error);
        }
    }
    
    /**
     * Sends a Slack notification
     * @param alert Alert to send
     */
    private async sendSlackNotification(alert: Alert): Promise<void> {
        try {
            const payload = {
                text: `*${alert.title}*`,
                blocks: [
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: alert.title
                        }
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: alert.message
                        }
                    },
                    {
                        type: 'section',
                        fields: [
                            {
                                type: 'mrkdwn',
                                text: `*Severity:* ${alert.severity}`
                            },
                            {
                                type: 'mrkdwn',
                                text: `*Source:* ${alert.source}`
                            },
                            {
                                type: 'mrkdwn',
                                text: `*Time:* ${new Date(alert.timestamp).toISOString()}`
                            },
                            {
                                type: 'mrkdwn',
                                text: `*ID:* ${alert.id}`
                            }
                        ]
                    }
                ]
            };
            
            await axios.post(this.config.alertEndpoints.slack, payload);
            
            this.logger.debug(`Slack notification sent for alert ${alert.id}`);
        } catch (error) {
            this.logger.error('Error sending Slack notification', error);
        }
    }
    
    /**
     * Sends an email notification
     * @param alert Alert to send
     */
    private async sendEmailNotification(alert: Alert): Promise<void> {
        // This is a simplified implementation
        // In a real-world scenario, you would use a library like 'nodemailer'
        this.logger.debug(`Email notification would be sent for alert ${alert.id}`);
    }
    
    /**
     * Sends a PagerDuty notification
     * @param alert Alert to send
     */
    private async sendPagerDutyNotification(alert: Alert): Promise<void> {
        try {
            const payload = {
                routing_key: this.config.alertEndpoints.pagerDuty,
                event_action: 'trigger',
                payload: {
                    summary: alert.title,
                    source: alert.source,
                    severity: this.mapAlertSeverityToPagerDutySeverity(alert.severity),
                    timestamp: new Date(alert.timestamp).toISOString(),
                    component: 'bridge',
                    group: 'bridge-monitoring',
                    class: alert.source,
                    custom_details: {
                        message: alert.message,
                        data: alert.data
                    }
                }
            };
            
            await axios.post('https://events.pagerduty.com/v2/enqueue', payload);
            
            this.logger.debug(`PagerDuty notification sent for alert ${alert.id}`);
        } catch (error) {
            this.logger.error('Error sending PagerDuty notification', error);
        }
    }
    
    /**
     * Maps alert severity to PagerDuty severity
     * @param severity Alert severity
     * @returns PagerDuty severity
     */
    private mapAlertSeverityToPagerDutySeverity(severity: AlertSeverity): string {
        switch (severity) {
            case AlertSeverity.INFO:
                return 'info';
            case AlertSeverity.WARNING:
                return 'warning';
            case AlertSeverity.ERROR:
                return 'error';
            case AlertSeverity.CRITICAL:
                return 'critical';
            default:
                return 'warning';
        }
    }
    
    /**
     * Sends a webhook notification
     * @param alert Alert to send
     */
    private async sendWebhookNotification(alert: Alert): Promise<void> {
        try {
            await axios.post(this.config.alertEndpoints.webhook, alert);
            
            this.logger.debug(`Webhook notification sent for alert ${alert.id}`);
        } catch (error) {
            this.logger.error('Error sending webhook notification', error);
        }
    }
    
    /**
     * Acknowledges an alert
     * @param alertId Alert ID
     * @param user User who acknowledged the alert
     * @returns Whether the alert was acknowledged
     */
    public async acknowledgeAlert(alertId: string, user: string): Promise<boolean> {
        try {
            const alert = this.alerts.find(a => a.id === alertId);
            
            if (!alert) {
                this.logger.warn(`Alert ${alertId} not found`);
                return false;
            }
            
            if (alert.acknowledged) {
                this.logger.warn(`Alert ${alertId} already acknowledged`);
                return false;
            }
            
            // Acknowledge alert
            alert.acknowledged = true;
            alert.acknowledgedAt = Date.now();
            alert.acknowledgedBy = user;
            
            // Save alerts to cache
            await this.cache.set('bridge:alerts', JSON.stringify(this.alerts));
            
            this.logger.info(`Alert ${alertId} acknowledged by ${user}`);
            
            return true;
        } catch (error) {
            this.logger.error('Error acknowledging alert', error);
            return false;
        }
    }
    
    /**
     * Gets active alerts
     * @returns Active alerts
     */
    public getActiveAlerts(): Alert[] {
        return this.alerts.filter(alert => !alert.acknowledged);
    }
    
    /**
     * Gets all alerts
     * @returns All alerts
     */
    public getAllAlerts(): Alert[] {
        return this.alerts;
    }
    
    /**
     * Gets health check results
     * @returns Health check results
     */
    public getHealthCheckResults(): HealthCheckResult[] {
        return this.healthCheckResults;
    }
    
    /**
     * Gets performance metrics
     * @returns Performance metrics
     */
    public getPerformanceMetrics(): PerformanceMetrics[] {
        return this.performanceMetrics;
    }
    
    /**
     * Gets the latest monitoring report
     * @returns Latest monitoring report
     */
    public getLatestReport(): any {
        try {
            const files = fs.readdirSync(this.config.reportDirectory)
                .filter(file => file.startsWith('bridge-report-'))
                .sort()
                .reverse();
            
            if (files.length === 0) {
                return null;
            }
            
            const reportPath = path.join(this.config.reportDirectory, files[0]);
            const reportData = fs.readFileSync(reportPath, 'utf8');
            
            return JSON.parse(reportData);
        } catch (error) {
            this.logger.error('Error getting latest report', error);
            return null;
        }
    }
}
