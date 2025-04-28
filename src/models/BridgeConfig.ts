// English comment for verification
/**
 * @file BridgeConfig.ts
 * @description Configuration model for the UltraOptimizedBridge
 * 
 * This model defines all configuration options for the bridge,
 * including connection details, worker settings, and security parameters.
 */

/**
 * Bridge configuration interface
 */
export interface BridgeConfig {
    /**
     * Log level (debug, info, warn, error)
     */
    logLevel?: string;
    
    /**
     * Path to log file
     */
    logFile?: string;
    
    /**
     * Whether to log to console
     */
    consoleLog?: boolean;
    
    /**
     * Metrics collection interval in milliseconds
     */
    metricsInterval?: number;
    
    /**
     * Path to metrics file
     */
    metricsFile?: string;
    
    /**
     * Whether to enable Prometheus metrics
     */
    enablePrometheus?: boolean;
    
    /**
     * Prometheus metrics server port
     */
    prometheusPort?: number;
    
    /**
     * Cache TTL in milliseconds
     */
    cacheTTL?: number;
    
    /**
     * Maximum cache size (number of items)
     */
    cacheMaxSize?: number;
    
    /**
     * Path to persist cache
     */
    cachePersistPath?: string;
    
    /**
     * Database type (postgres, mysql, etc.)
     */
    dbType?: string;
    
    /**
     * Database host
     */
    dbHost?: string;
    
    /**
     * Database port
     */
    dbPort?: number;
    
    /**
     * Database username
     */
    dbUsername?: string;
    
    /**
     * Database password
     */
    dbPassword?: string;
    
    /**
     * Database name
     */
    dbName?: string;
    
    /**
     * Whether to synchronize database schema
     */
    dbSynchronize?: boolean;
    
    /**
     * Whether to enable database query logging
     */
    dbLogging?: boolean;
    
    /**
     * Ethereum RPC URL
     */
    ethereumRpcUrl: string;
    
    /**
     * Ethereum private key
     */
    ethereumPrivateKey: string;
    
    /**
     * Ethereum deposit bridge contract address
     */
    depositBridgeAddress: string;
    
    /**
     * Ethereum withdrawal bridge contract address
     */
    withdrawalBridgeAddress: string;
    
    /**
     * Ethereum gas price multiplier
     */
    ethereumGasMultiplier?: number;
    
    /**
     * Number of confirmations required for Ethereum transactions
     */
    ethereumConfirmations?: number;
    
    /**
     * Maximum number of retry attempts for Ethereum transactions
     */
    ethereumMaxRetries?: number;
    
    /**
     * Delay between retry attempts for Ethereum transactions (ms)
     */
    ethereumRetryDelay?: number;
    
    /**
     * Solana RPC URL
     */
    solanaRpcUrl: string;
    
    /**
     * Solana private key
     */
    solanaPrivateKey: string;
    
    /**
     * Solana deposit handler program ID
     */
    depositHandlerProgramId: string;
    
    /**
     * Solana withdrawal handler program ID
     */
    withdrawalHandlerProgramId: string;
    
    /**
     * Number of confirmations required for Solana transactions
     */
    solanaConfirmations?: number;
    
    /**
     * Maximum number of retry attempts for Solana transactions
     */
    solanaMaxRetries?: number;
    
    /**
     * Delay between retry attempts for Solana transactions (ms)
     */
    solanaRetryDelay?: number;
    
    /**
     * Finalization contract address
     */
    finalizationContractAddress: string;
    
    /**
     * Finalization interval in milliseconds
     */
    finalizationInterval?: number;
    
    /**
     * Challenge period in seconds
     */
    challengePeriod?: number;
    
    /**
     * Maximum number of blocks per finalization batch
     */
    maxBlocksPerBatch?: number;
    
    /**
     * Whether to enable double spend protection
     */
    enableDoubleSpendProtection?: boolean;
    
    /**
     * Whether to enable rate limiting
     */
    enableRateLimiting?: boolean;
    
    /**
     * Maximum number of transactions per minute
     */
    maxTransactionsPerMinute?: number;
    
    /**
     * Maximum value per transaction (in smallest unit)
     */
    maxValuePerTransaction?: string;
    
    /**
     * Maximum value per day (in smallest unit)
     */
    maxValuePerDay?: string;
    
    /**
     * Alert threshold (0.0 - 1.0)
     */
    alertThreshold?: number;
    
    /**
     * Email address for alerts
     */
    alertEmail?: string;
    
    /**
     * Webhook URL for alerts
     */
    alertWebhook?: string;
    
    /**
     * Number of deposit worker threads
     */
    depositWorkerCount?: number;
    
    /**
     * Number of withdrawal worker threads
     */
    withdrawalWorkerCount?: number;
    
    /**
     * Number of finalization worker threads
     */
    finalizationWorkerCount?: number;
}
