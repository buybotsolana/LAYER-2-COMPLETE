// English comment for verification
/**
 * @file BridgeCacheService.ts
 * @description Service for implementing advanced caching capabilities for the bridge between Ethereum and Solana
 * 
 * This service provides comprehensive caching features for the bridge operations,
 * including multi-level caching, TTL-based expiration, and cache invalidation strategies.
 */

import { Logger } from '../utils/Logger';
import { MetricsCollector } from '../utils/MetricsCollector';
import { Repository } from 'typeorm';
import { BridgeTransaction } from '../models/BridgeTransaction';
import { TokenMapping } from '../models/TokenMapping';
import { BlockFinalization } from '../models/BlockFinalization';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as Redis from 'redis';
import { promisify } from 'util';

/**
 * Cache storage type
 */
export enum CacheStorageType {
    MEMORY = 'memory',
    REDIS = 'redis',
    FILE = 'file',
    MULTI_LEVEL = 'multi_level'
}

/**
 * Cache invalidation strategy
 */
export enum CacheInvalidationStrategy {
    TTL = 'ttl',
    LRU = 'lru',
    LFU = 'lfu',
    FIFO = 'fifo'
}

/**
 * Configuration for the bridge cache service
 */
export interface BridgeCacheConfig {
    /**
     * Cache storage type
     */
    storageType?: CacheStorageType;
    
    /**
     * Cache invalidation strategy
     */
    invalidationStrategy?: CacheInvalidationStrategy;
    
    /**
     * Default TTL in milliseconds
     */
    defaultTtl?: number;
    
    /**
     * Maximum number of items in memory cache
     */
    maxMemoryItems?: number;
    
    /**
     * Maximum memory size in bytes
     */
    maxMemorySize?: number;
    
    /**
     * Redis connection options
     */
    redisOptions?: {
        /**
         * Redis host
         */
        host: string;
        
        /**
         * Redis port
         */
        port: number;
        
        /**
         * Redis password
         */
        password?: string;
        
        /**
         * Redis database
         */
        db?: number;
        
        /**
         * Redis key prefix
         */
        keyPrefix?: string;
    };
    
    /**
     * File cache options
     */
    fileOptions?: {
        /**
         * Directory for file cache
         */
        directory: string;
        
        /**
         * Whether to compress cached files
         */
        compress?: boolean;
        
        /**
         * Maximum file cache size in bytes
         */
        maxSize?: number;
    };
    
    /**
     * Multi-level cache options
     */
    multiLevelOptions?: {
        /**
         * Whether to use memory cache
         */
        useMemory?: boolean;
        
        /**
         * Whether to use Redis cache
         */
        useRedis?: boolean;
        
        /**
         * Whether to use file cache
         */
        useFile?: boolean;
    };
    
    /**
     * Cache cleanup interval in milliseconds
     */
    cleanupInterval?: number;
    
    /**
     * Whether to enable cache statistics
     */
    enableStatistics?: boolean;
    
    /**
     * Whether to enable cache warming
     */
    enableCacheWarming?: boolean;
    
    /**
     * Cache warming interval in milliseconds
     */
    cacheWarmingInterval?: number;
    
    /**
     * Whether to enable cache compression
     */
    enableCompression?: boolean;
    
    /**
     * Whether to enable cache encryption
     */
    enableEncryption?: boolean;
    
    /**
     * Encryption key
     */
    encryptionKey?: string;
    
    /**
     * Whether to enable cache versioning
     */
    enableVersioning?: boolean;
    
    /**
     * Cache version
     */
    cacheVersion?: string;
    
    /**
     * Whether to enable cache sharding
     */
    enableSharding?: boolean;
    
    /**
     * Number of shards
     */
    shardCount?: number;
}

/**
 * Cache item
 */
interface CacheItem<T> {
    /**
     * Item key
     */
    key: string;
    
    /**
     * Item value
     */
    value: T;
    
    /**
     * Item expiration timestamp
     */
    expiresAt?: number;
    
    /**
     * Item creation timestamp
     */
    createdAt: number;
    
    /**
     * Item last access timestamp
     */
    lastAccessedAt: number;
    
    /**
     * Item access count
     */
    accessCount: number;
    
    /**
     * Item size in bytes
     */
    size: number;
    
    /**
     * Item version
     */
    version?: string;
    
    /**
     * Item tags
     */
    tags?: string[];
}

/**
 * Cache statistics
 */
interface CacheStatistics {
    /**
     * Number of items in cache
     */
    itemCount: number;
    
    /**
     * Total size of cache in bytes
     */
    totalSize: number;
    
    /**
     * Number of cache hits
     */
    hits: number;
    
    /**
     * Number of cache misses
     */
    misses: number;
    
    /**
     * Cache hit ratio
     */
    hitRatio: number;
    
    /**
     * Number of items evicted
     */
    evictions: number;
    
    /**
     * Number of items expired
     */
    expirations: number;
    
    /**
     * Average item size in bytes
     */
    averageItemSize: number;
    
    /**
     * Average item age in milliseconds
     */
    averageItemAge: number;
    
    /**
     * Average item access count
     */
    averageAccessCount: number;
    
    /**
     * Statistics by tag
     */
    tagStats: {
        [tag: string]: {
            itemCount: number;
            totalSize: number;
            hits: number;
            misses: number;
            hitRatio: number;
        }
    };
}

/**
 * Bridge cache service class
 */
export class BridgeCacheService {
    private config: BridgeCacheConfig;
    private logger: Logger;
    private metrics: MetricsCollector;
    private bridgeTransactionRepository: Repository<BridgeTransaction>;
    private tokenMappingRepository: Repository<TokenMapping>;
    private blockFinalizationRepository: Repository<BlockFinalization>;
    
    private isRunning: boolean = false;
    private memoryCache: Map<string, CacheItem<any>> = new Map();
    private redisClient: Redis.RedisClient | null = null;
    private redisGetAsync: ((key: string) => Promise<string>) | null = null;
    private redisSetAsync: ((key: string, value: string) => Promise<string>) | null = null;
    private redisDelAsync: ((key: string) => Promise<number>) | null = null;
    private redisExpireAsync: ((key: string, seconds: number) => Promise<number>) | null = null;
    private redisKeysAsync: ((pattern: string) => Promise<string[]>) | null = null;
    
    private cleanupInterval: NodeJS.Timeout | null = null;
    private cacheWarmingInterval: NodeJS.Timeout | null = null;
    
    private statistics: CacheStatistics = {
        itemCount: 0,
        totalSize: 0,
        hits: 0,
        misses: 0,
        hitRatio: 0,
        evictions: 0,
        expirations: 0,
        averageItemSize: 0,
        averageItemAge: 0,
        averageAccessCount: 0,
        tagStats: {}
    };
    
    /**
     * Creates a new instance of the bridge cache service
     * @param config Bridge cache configuration
     * @param logger Logger instance
     * @param metrics Metrics collector instance
     * @param bridgeTransactionRepository Bridge transaction repository
     * @param tokenMappingRepository Token mapping repository
     * @param blockFinalizationRepository Block finalization repository
     */
    constructor(
        config: BridgeCacheConfig,
        logger: Logger,
        metrics: MetricsCollector,
        bridgeTransactionRepository: Repository<BridgeTransaction>,
        tokenMappingRepository: Repository<TokenMapping>,
        blockFinalizationRepository: Repository<BlockFinalization>
    ) {
        this.config = {
            ...config,
            storageType: config.storageType || CacheStorageType.MEMORY,
            invalidationStrategy: config.invalidationStrategy || CacheInvalidationStrategy.TTL,
            defaultTtl: config.defaultTtl || 3600000, // 1 hour
            maxMemoryItems: config.maxMemoryItems || 10000,
            maxMemorySize: config.maxMemorySize || 100 * 1024 * 1024, // 100 MB
            redisOptions: config.redisOptions || {
                host: 'localhost',
                port: 6379,
                keyPrefix: 'bridge:cache:'
            },
            fileOptions: config.fileOptions || {
                directory: path.join(process.cwd(), 'cache'),
                compress: true,
                maxSize: 1024 * 1024 * 1024 // 1 GB
            },
            multiLevelOptions: config.multiLevelOptions || {
                useMemory: true,
                useRedis: false,
                useFile: false
            },
            cleanupInterval: config.cleanupInterval || 300000, // 5 minutes
            enableStatistics: config.enableStatistics !== false,
            enableCacheWarming: config.enableCacheWarming || false,
            cacheWarmingInterval: config.cacheWarmingInterval || 3600000, // 1 hour
            enableCompression: config.enableCompression || false,
            enableEncryption: config.enableEncryption || false,
            enableVersioning: config.enableVersioning || false,
            cacheVersion: config.cacheVersion || '1.0.0',
            enableSharding: config.enableSharding || false,
            shardCount: config.shardCount || 10
        };
        
        this.logger = logger;
        this.metrics = metrics;
        this.bridgeTransactionRepository = bridgeTransactionRepository;
        this.tokenMappingRepository = tokenMappingRepository;
        this.blockFinalizationRepository = blockFinalizationRepository;
    }
    
    /**
     * Initializes the bridge cache service
     */
    public async initialize(): Promise<void> {
        this.logger.info('Initializing bridge cache service...');
        
        try {
            // Initialize cache storage
            await this.initializeStorage();
            
            this.logger.info('Bridge cache service initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize bridge cache service', error);
            throw error;
        }
    }
    
    /**
     * Initializes the cache storage
     */
    private async initializeStorage(): Promise<void> {
        try {
            switch (this.config.storageType) {
                case CacheStorageType.MEMORY:
                    // Memory cache is already initialized
                    this.logger.info('Initialized memory cache storage');
                    break;
                    
                case CacheStorageType.REDIS:
                    await this.initializeRedisStorage();
                    break;
                    
                case CacheStorageType.FILE:
                    await this.initializeFileStorage();
                    break;
                    
                case CacheStorageType.MULTI_LEVEL:
                    await this.initializeMultiLevelStorage();
                    break;
                    
                default:
                    throw new Error(`Unsupported cache storage type: ${this.config.storageType}`);
            }
        } catch (error) {
            this.logger.error('Failed to initialize cache storage', error);
            throw error;
        }
    }
    
    /**
     * Initializes Redis cache storage
     */
    private async initializeRedisStorage(): Promise<void> {
        try {
            const options = this.config.redisOptions;
            
            if (!options) {
                throw new Error('Redis options not provided');
            }
            
            this.logger.info(`Initializing Redis cache storage: ${options.host}:${options.port}`);
            
            // Create Redis client
            this.redisClient = Redis.createClient({
                host: options.host,
                port: options.port,
                password: options.password,
                db: options.db,
                prefix: options.keyPrefix
            });
            
            // Promisify Redis methods
            this.redisGetAsync = promisify(this.redisClient.get).bind(this.redisClient);
            this.redisSetAsync = promisify(this.redisClient.set).bind(this.redisClient);
            this.redisDelAsync = promisify(this.redisClient.del).bind(this.redisClient);
            this.redisExpireAsync = promisify(this.redisClient.expire).bind(this.redisClient);
            this.redisKeysAsync = promisify(this.redisClient.keys).bind(this.redisClient);
            
            // Handle Redis errors
            this.redisClient.on('error', (error) => {
                this.logger.error('Redis cache error', error);
            });
            
            this.logger.info('Redis cache storage initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize Redis cache storage', error);
            throw error;
        }
    }
    
    /**
     * Initializes file cache storage
     */
    private async initializeFileStorage(): Promise<void> {
        try {
            const options = this.config.fileOptions;
            
            if (!options) {
                throw new Error('File options not provided');
            }
            
            this.logger.info(`Initializing file cache storage: ${options.directory}`);
            
            // Create cache directory if it doesn't exist
            if (!fs.existsSync(options.directory)) {
                fs.mkdirSync(options.directory, { recursive: true });
            }
            
            this.logger.info('File cache storage initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize file cache storage', error);
            throw error;
        }
    }
    
    /**
     * Initializes multi-level cache storage
     */
    private async initializeMultiLevelStorage(): Promise<void> {
        try {
            const options = this.config.multiLevelOptions;
            
            if (!options) {
                throw new Error('Multi-level options not provided');
            }
            
            this.logger.info('Initializing multi-level cache storage');
            
            // Initialize memory cache
            if (options.useMemory) {
                this.logger.info('Initializing memory cache for multi-level storage');
                // Memory cache is already initialized
            }
            
            // Initialize Redis cache
            if (options.useRedis) {
                await this.initializeRedisStorage();
            }
            
            // Initialize file cache
            if (options.useFile) {
                await this.initializeFileStorage();
            }
            
            this.logger.info('Multi-level cache storage initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize multi-level cache storage', error);
            throw error;
        }
    }
    
    /**
     * Starts the bridge cache service
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            this.logger.warn('Bridge cache service already running');
            return;
        }
        
        this.logger.info('Starting bridge cache service...');
        
        try {
            this.isRunning = true;
            
            // Start cleanup interval
            this.cleanupInterval = setInterval(() => {
                this.cleanup();
            }, this.config.cleanupInterval);
            
            // Start cache warming interval if enabled
            if (this.config.enableCacheWarming) {
                this.cacheWarmingInterval = setInterval(() => {
                    this.warmCache();
                }, this.config.cacheWarmingInterval);
                
                // Warm cache immediately
                this.warmCache();
            }
            
            this.logger.info('Bridge cache service started successfully');
        } catch (error) {
            this.isRunning = false;
            this.logger.error('Failed to start bridge cache service', error);
            throw error;
        }
    }
    
    /**
     * Stops the bridge cache service
     */
    public async stop(): Promise<void> {
        if (!this.isRunning) {
            this.logger.warn('Bridge cache service not running');
            return;
        }
        
        this.logger.info('Stopping bridge cache service...');
        
        try {
            this.isRunning = false;
            
            // Stop cleanup interval
            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
                this.cleanupInterval = null;
            }
            
            // Stop cache warming interval
            if (this.cacheWarmingInterval) {
                clearInterval(this.cacheWarmingInterval);
                this.cacheWarmingInterval = null;
            }
            
            // Close Redis client if initialized
            if (this.redisClient) {
                this.redisClient.quit();
                this.redisClient = null;
                this.redisGetAsync = null;
                this.redisSetAsync = null;
                this.redisDelAsync = null;
                this.redisExpireAsync = null;
                this.redisKeysAsync = null;
            }
            
            this.logger.info('Bridge cache service stopped successfully');
        } catch (error) {
            this.logger.error('Failed to stop bridge cache service', error);
            throw error;
        }
    }
    
    /**
     * Cleans up expired and excess cache items
     */
    private async cleanup(): Promise<void> {
        if (!this.isRunning) {
            return;
        }
        
        try {
            this.logger.debug('Cleaning up cache...');
            
            const now = Date.now();
            let expiredCount = 0;
            let evictedCount = 0;
            
            // Clean up based on storage type
            switch (this.config.storageType) {
                case CacheStorageType.MEMORY:
                    // Clean up expired items
                    for (const [key, item] of this.memoryCache.entries()) {
                        if (item.expiresAt && item.expiresAt < now) {
                            this.memoryCache.delete(key);
                            expiredCount++;
                            
                            // Update statistics
                            if (this.config.enableStatistics) {
                                this.statistics.expirations++;
                                this.statistics.itemCount--;
                                this.statistics.totalSize -= item.size;
                                
                                // Update tag statistics
                                if (item.tags) {
                                    for (const tag of item.tags) {
                                        if (this.statistics.tagStats[tag]) {
                                            this.statistics.tagStats[tag].itemCount--;
                                            this.statistics.tagStats[tag].totalSize -= item.size;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    
                    // Evict items if cache is too large
                    if (this.memoryCache.size > this.config.maxMemoryItems) {
                        const itemsToEvict = this.memoryCache.size - this.config.maxMemoryItems;
                        
                        // Get items sorted by eviction strategy
                        const items = Array.from(this.memoryCache.entries());
                        
                        switch (this.config.invalidationStrategy) {
                            case CacheInvalidationStrategy.LRU:
                                // Sort by last accessed time (oldest first)
                                items.sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
                                break;
                                
                            case CacheInvalidationStrategy.LFU:
                                // Sort by access count (least first)
                                items.sort((a, b) => a[1].accessCount - b[1].accessCount);
                                break;
                                
                            case CacheInvalidationStrategy.FIFO:
                                // Sort by creation time (oldest first)
                                items.sort((a, b) => a[1].createdAt - b[1].createdAt);
                                break;
                                
                            default:
                                // Default to LRU
                                items.sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
                        }
                        
                        // Evict items
                        for (let i = 0; i < itemsToEvict; i++) {
                            const [key, item] = items[i];
                            this.memoryCache.delete(key);
                            evictedCount++;
                            
                            // Update statistics
                            if (this.config.enableStatistics) {
                                this.statistics.evictions++;
                                this.statistics.itemCount--;
                                this.statistics.totalSize -= item.size;
                                
                                // Update tag statistics
                                if (item.tags) {
                                    for (const tag of item.tags) {
                                        if (this.statistics.tagStats[tag]) {
                                            this.statistics.tagStats[tag].itemCount--;
                                            this.statistics.tagStats[tag].totalSize -= item.size;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    break;
                    
                case CacheStorageType.REDIS:
                    // Redis handles expiration automatically
                    break;
                    
                case CacheStorageType.FILE:
                    await this.cleanupFileCache();
                    break;
                    
                case CacheStorageType.MULTI_LEVEL:
                    // Clean up memory cache
                    if (this.config.multiLevelOptions?.useMemory) {
                        // Same as memory cache cleanup
                        for (const [key, item] of this.memoryCache.entries()) {
                            if (item.expiresAt && item.expiresAt < now) {
                                this.memoryCache.delete(key);
                                expiredCount++;
                                
                                // Update statistics
                                if (this.config.enableStatistics) {
                                    this.statistics.expirations++;
                                    this.statistics.itemCount--;
                                    this.statistics.totalSize -= item.size;
                                }
                            }
                        }
                    }
                    
                    // Clean up file cache
                    if (this.config.multiLevelOptions?.useFile) {
                        await this.cleanupFileCache();
                    }
                    break;
            }
            
            // Update metrics
            this.metrics.gauge('cache.items', this.memoryCache.size);
            this.metrics.gauge('cache.size', this.calculateMemoryCacheSize());
            
            if (expiredCount > 0 || evictedCount > 0) {
                this.logger.debug(`Cache cleanup: ${expiredCount} expired, ${evictedCount} evicted`);
            }
        } catch (error) {
            this.logger.error('Error during cache cleanup', error);
        }
    }
    
    /**
     * Cleans up file cache
     */
    private async cleanupFileCache(): Promise<void> {
        try {
            const options = this.config.fileOptions;
            
            if (!options) {
                return;
            }
            
            const directory = options.directory;
            const now = Date.now();
            let expiredCount = 0;
            let evictedCount = 0;
            
            // Get all cache files
            const files = fs.readdirSync(directory);
            
            // Calculate total size and collect file info
            let totalSize = 0;
            const fileInfos: { path: string, size: number, mtime: number }[] = [];
            
            for (const file of files) {
                if (!file.endsWith('.cache')) {
                    continue;
                }
                
                const filePath = path.join(directory, file);
                const stats = fs.statSync(filePath);
                
                totalSize += stats.size;
                fileInfos.push({
                    path: filePath,
                    size: stats.size,
                    mtime: stats.mtimeMs
                });
                
                // Check if file is expired
                try {
                    const metadata = JSON.parse(fs.readFileSync(`${filePath}.meta`, 'utf8'));
                    
                    if (metadata.expiresAt && metadata.expiresAt < now) {
                        fs.unlinkSync(filePath);
                        fs.unlinkSync(`${filePath}.meta`);
                        expiredCount++;
                        totalSize -= stats.size;
                        
                        // Update statistics
                        if (this.config.enableStatistics) {
                            this.statistics.expirations++;
                            this.statistics.itemCount--;
                            this.statistics.totalSize -= stats.size;
                        }
                    }
                } catch (error) {
                    // Metadata file might not exist or be corrupted
                    // In this case, we'll consider the file for eviction
                }
            }
            
            // Evict files if cache is too large
            if (options.maxSize && totalSize > options.maxSize) {
                // Sort files by modification time (oldest first)
                fileInfos.sort((a, b) => a.mtime - b.mtime);
                
                // Evict files until we're under the limit
                let currentSize = totalSize;
                
                for (const fileInfo of fileInfos) {
                    if (currentSize <= options.maxSize) {
                        break;
                    }
                    
                    try {
                        fs.unlinkSync(fileInfo.path);
                        fs.unlinkSync(`${fileInfo.path}.meta`);
                        evictedCount++;
                        currentSize -= fileInfo.size;
                        
                        // Update statistics
                        if (this.config.enableStatistics) {
                            this.statistics.evictions++;
                            this.statistics.itemCount--;
                            this.statistics.totalSize -= fileInfo.size;
                        }
                    } catch (error) {
                        this.logger.error(`Error evicting file cache: ${fileInfo.path}`, error);
                    }
                }
            }
            
            if (expiredCount > 0 || evictedCount > 0) {
                this.logger.debug(`File cache cleanup: ${expiredCount} expired, ${evictedCount} evicted`);
            }
        } catch (error) {
            this.logger.error('Error during file cache cleanup', error);
        }
    }
    
    /**
     * Warms the cache by pre-loading frequently accessed data
     */
    private async warmCache(): Promise<void> {
        if (!this.isRunning || !this.config.enableCacheWarming) {
            return;
        }
        
        try {
            this.logger.info('Warming cache...');
            
            // Warm token mappings
            await this.warmTokenMappings();
            
            // Warm recent transactions
            await this.warmRecentTransactions();
            
            // Warm block finalizations
            await this.warmBlockFinalizations();
            
            this.logger.info('Cache warming completed');
        } catch (error) {
            this.logger.error('Error during cache warming', error);
        }
    }
    
    /**
     * Warms token mappings
     */
    private async warmTokenMappings(): Promise<void> {
        try {
            this.logger.debug('Warming token mappings...');
            
            // Get all token mappings
            const tokenMappings = await this.tokenMappingRepository.find();
            
            // Cache each token mapping
            for (const mapping of tokenMappings) {
                const key = `token_mapping:${mapping.ethereumToken}`;
                await this.set(key, mapping, {
                    ttl: 24 * 60 * 60 * 1000, // 24 hours
                    tags: ['token_mapping']
                });
                
                const reverseKey = `token_mapping_reverse:${mapping.solanaToken}`;
                await this.set(reverseKey, mapping, {
                    ttl: 24 * 60 * 60 * 1000, // 24 hours
                    tags: ['token_mapping']
                });
            }
            
            this.logger.debug(`Warmed ${tokenMappings.length} token mappings`);
        } catch (error) {
            this.logger.error('Error warming token mappings', error);
        }
    }
    
    /**
     * Warms recent transactions
     */
    private async warmRecentTransactions(): Promise<void> {
        try {
            this.logger.debug('Warming recent transactions...');
            
            // Get recent transactions
            const recentTransactions = await this.bridgeTransactionRepository.find({
                order: {
                    timestamp: 'DESC'
                },
                take: 1000
            });
            
            // Cache each transaction
            for (const transaction of recentTransactions) {
                const key = `transaction:${transaction.id}`;
                await this.set(key, transaction, {
                    ttl: 60 * 60 * 1000, // 1 hour
                    tags: ['transaction']
                });
            }
            
            this.logger.debug(`Warmed ${recentTransactions.length} recent transactions`);
        } catch (error) {
            this.logger.error('Error warming recent transactions', error);
        }
    }
    
    /**
     * Warms block finalizations
     */
    private async warmBlockFinalizations(): Promise<void> {
        try {
            this.logger.debug('Warming block finalizations...');
            
            // Get recent block finalizations
            const recentFinalizations = await this.blockFinalizationRepository.find({
                order: {
                    blockNumber: 'DESC'
                },
                take: 100
            });
            
            // Cache each finalization
            for (const finalization of recentFinalizations) {
                const key = `block_finalization:${finalization.blockNumber}`;
                await this.set(key, finalization, {
                    ttl: 12 * 60 * 60 * 1000, // 12 hours
                    tags: ['block_finalization']
                });
            }
            
            this.logger.debug(`Warmed ${recentFinalizations.length} block finalizations`);
        } catch (error) {
            this.logger.error('Error warming block finalizations', error);
        }
    }
    
    /**
     * Gets a value from the cache
     * @param key Cache key
     * @returns Cached value or null if not found
     */
    public async get<T>(key: string): Promise<T | null> {
        try {
            // Generate full key with version if versioning is enabled
            const fullKey = this.getFullKey(key);
            
            // Get from appropriate storage
            switch (this.config.storageType) {
                case CacheStorageType.MEMORY:
                    return this.getFromMemory<T>(fullKey);
                    
                case CacheStorageType.REDIS:
                    return await this.getFromRedis<T>(fullKey);
                    
                case CacheStorageType.FILE:
                    return await this.getFromFile<T>(fullKey);
                    
                case CacheStorageType.MULTI_LEVEL:
                    return await this.getFromMultiLevel<T>(fullKey);
                    
                default:
                    throw new Error(`Unsupported cache storage type: ${this.config.storageType}`);
            }
        } catch (error) {
            this.logger.error(`Error getting cache key: ${key}`, error);
            return null;
        }
    }
    
    /**
     * Gets a value from memory cache
     * @param key Cache key
     * @returns Cached value or null if not found
     */
    private getFromMemory<T>(key: string): T | null {
        const item = this.memoryCache.get(key);
        
        if (!item) {
            // Update statistics
            if (this.config.enableStatistics) {
                this.statistics.misses++;
                this.updateHitRatio();
                
                // Update metrics
                this.metrics.increment('cache.misses');
            }
            
            return null;
        }
        
        // Check if item is expired
        if (item.expiresAt && item.expiresAt < Date.now()) {
            this.memoryCache.delete(key);
            
            // Update statistics
            if (this.config.enableStatistics) {
                this.statistics.expirations++;
                this.statistics.misses++;
                this.statistics.itemCount--;
                this.statistics.totalSize -= item.size;
                this.updateHitRatio();
                
                // Update tag statistics
                if (item.tags) {
                    for (const tag of item.tags) {
                        if (this.statistics.tagStats[tag]) {
                            this.statistics.tagStats[tag].itemCount--;
                            this.statistics.tagStats[tag].totalSize -= item.size;
                            this.statistics.tagStats[tag].misses++;
                            this.statistics.tagStats[tag].hitRatio = 
                                this.statistics.tagStats[tag].hits / 
                                (this.statistics.tagStats[tag].hits + this.statistics.tagStats[tag].misses);
                        }
                    }
                }
                
                // Update metrics
                this.metrics.increment('cache.expirations');
                this.metrics.increment('cache.misses');
                this.metrics.gauge('cache.items', this.memoryCache.size);
                this.metrics.gauge('cache.size', this.calculateMemoryCacheSize());
            }
            
            return null;
        }
        
        // Update item metadata
        item.lastAccessedAt = Date.now();
        item.accessCount++;
        
        // Update statistics
        if (this.config.enableStatistics) {
            this.statistics.hits++;
            this.updateHitRatio();
            
            // Update tag statistics
            if (item.tags) {
                for (const tag of item.tags) {
                    if (this.statistics.tagStats[tag]) {
                        this.statistics.tagStats[tag].hits++;
                        this.statistics.tagStats[tag].hitRatio = 
                            this.statistics.tagStats[tag].hits / 
                            (this.statistics.tagStats[tag].hits + this.statistics.tagStats[tag].misses);
                    }
                }
            }
            
            // Update metrics
            this.metrics.increment('cache.hits');
        }
        
        return item.value;
    }
    
    /**
     * Gets a value from Redis cache
     * @param key Cache key
     * @returns Cached value or null if not found
     */
    private async getFromRedis<T>(key: string): Promise<T | null> {
        if (!this.redisClient || !this.redisGetAsync) {
            return null;
        }
        
        try {
            const value = await this.redisGetAsync(key);
            
            if (!value) {
                // Update statistics
                if (this.config.enableStatistics) {
                    this.statistics.misses++;
                    this.updateHitRatio();
                    
                    // Update metrics
                    this.metrics.increment('cache.misses');
                }
                
                return null;
            }
            
            // Parse value
            const item = this.parseValue<T>(value);
            
            // Update statistics
            if (this.config.enableStatistics) {
                this.statistics.hits++;
                this.updateHitRatio();
                
                // Update metrics
                this.metrics.increment('cache.hits');
            }
            
            return item;
        } catch (error) {
            this.logger.error(`Error getting from Redis cache: ${key}`, error);
            return null;
        }
    }
    
    /**
     * Gets a value from file cache
     * @param key Cache key
     * @returns Cached value or null if not found
     */
    private async getFromFile<T>(key: string): Promise<T | null> {
        try {
            const options = this.config.fileOptions;
            
            if (!options) {
                return null;
            }
            
            const filePath = this.getFilePath(key);
            const metaPath = `${filePath}.meta`;
            
            // Check if file exists
            if (!fs.existsSync(filePath) || !fs.existsSync(metaPath)) {
                // Update statistics
                if (this.config.enableStatistics) {
                    this.statistics.misses++;
                    this.updateHitRatio();
                    
                    // Update metrics
                    this.metrics.increment('cache.misses');
                }
                
                return null;
            }
            
            // Read metadata
            const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            
            // Check if item is expired
            if (metadata.expiresAt && metadata.expiresAt < Date.now()) {
                fs.unlinkSync(filePath);
                fs.unlinkSync(metaPath);
                
                // Update statistics
                if (this.config.enableStatistics) {
                    this.statistics.expirations++;
                    this.statistics.misses++;
                    this.statistics.itemCount--;
                    this.statistics.totalSize -= metadata.size;
                    this.updateHitRatio();
                    
                    // Update metrics
                    this.metrics.increment('cache.expirations');
                    this.metrics.increment('cache.misses');
                }
                
                return null;
            }
            
            // Read file
            let data = fs.readFileSync(filePath);
            
            // Decompress if needed
            if (options.compress) {
                const zlib = require('zlib');
                data = zlib.gunzipSync(data);
            }
            
            // Decrypt if needed
            if (this.config.enableEncryption && this.config.encryptionKey) {
                data = this.decrypt(data);
            }
            
            // Parse value
            const value = JSON.parse(data.toString('utf8'));
            
            // Update metadata
            metadata.lastAccessedAt = Date.now();
            metadata.accessCount++;
            fs.writeFileSync(metaPath, JSON.stringify(metadata));
            
            // Update statistics
            if (this.config.enableStatistics) {
                this.statistics.hits++;
                this.updateHitRatio();
                
                // Update metrics
                this.metrics.increment('cache.hits');
            }
            
            return value;
        } catch (error) {
            this.logger.error(`Error getting from file cache: ${key}`, error);
            return null;
        }
    }
    
    /**
     * Gets a value from multi-level cache
     * @param key Cache key
     * @returns Cached value or null if not found
     */
    private async getFromMultiLevel<T>(key: string): Promise<T | null> {
        const options = this.config.multiLevelOptions;
        
        if (!options) {
            return null;
        }
        
        // Try memory cache first
        if (options.useMemory) {
            const memoryValue = this.getFromMemory<T>(key);
            
            if (memoryValue !== null) {
                return memoryValue;
            }
        }
        
        // Try Redis cache next
        if (options.useRedis) {
            const redisValue = await this.getFromRedis<T>(key);
            
            if (redisValue !== null) {
                // Store in memory cache for faster access next time
                if (options.useMemory) {
                    await this.setInMemory(key, redisValue, {
                        ttl: this.config.defaultTtl
                    });
                }
                
                return redisValue;
            }
        }
        
        // Try file cache last
        if (options.useFile) {
            const fileValue = await this.getFromFile<T>(key);
            
            if (fileValue !== null) {
                // Store in memory cache for faster access next time
                if (options.useMemory) {
                    await this.setInMemory(key, fileValue, {
                        ttl: this.config.defaultTtl
                    });
                }
                
                // Store in Redis cache for faster access next time
                if (options.useRedis) {
                    await this.setInRedis(key, fileValue, {
                        ttl: this.config.defaultTtl
                    });
                }
                
                return fileValue;
            }
        }
        
        return null;
    }
    
    /**
     * Sets a value in the cache
     * @param key Cache key
     * @param value Value to cache
     * @param options Cache options
     * @returns Whether the value was successfully cached
     */
    public async set<T>(
        key: string,
        value: T,
        options: {
            ttl?: number,
            tags?: string[]
        } = {}
    ): Promise<boolean> {
        try {
            // Generate full key with version if versioning is enabled
            const fullKey = this.getFullKey(key);
            
            // Set in appropriate storage
            switch (this.config.storageType) {
                case CacheStorageType.MEMORY:
                    return await this.setInMemory<T>(fullKey, value, options);
                    
                case CacheStorageType.REDIS:
                    return await this.setInRedis<T>(fullKey, value, options);
                    
                case CacheStorageType.FILE:
                    return await this.setInFile<T>(fullKey, value, options);
                    
                case CacheStorageType.MULTI_LEVEL:
                    return await this.setInMultiLevel<T>(fullKey, value, options);
                    
                default:
                    throw new Error(`Unsupported cache storage type: ${this.config.storageType}`);
            }
        } catch (error) {
            this.logger.error(`Error setting cache key: ${key}`, error);
            return false;
        }
    }
    
    /**
     * Sets a value in memory cache
     * @param key Cache key
     * @param value Value to cache
     * @param options Cache options
     * @returns Whether the value was successfully cached
     */
    private async setInMemory<T>(
        key: string,
        value: T,
        options: {
            ttl?: number,
            tags?: string[]
        } = {}
    ): Promise<boolean> {
        try {
            // Check if cache is full
            if (this.memoryCache.size >= this.config.maxMemoryItems) {
                // Evict items based on invalidation strategy
                await this.evictItems();
            }
            
            // Calculate item size
            const size = this.calculateItemSize(value);
            
            // Create cache item
            const item: CacheItem<T> = {
                key,
                value,
                expiresAt: options.ttl ? Date.now() + options.ttl : undefined,
                createdAt: Date.now(),
                lastAccessedAt: Date.now(),
                accessCount: 0,
                size,
                tags: options.tags,
                version: this.config.enableVersioning ? this.config.cacheVersion : undefined
            };
            
            // Store in cache
            this.memoryCache.set(key, item);
            
            // Update statistics
            if (this.config.enableStatistics) {
                this.statistics.itemCount++;
                this.statistics.totalSize += size;
                this.updateAverages();
                
                // Update tag statistics
                if (options.tags) {
                    for (const tag of options.tags) {
                        if (!this.statistics.tagStats[tag]) {
                            this.statistics.tagStats[tag] = {
                                itemCount: 0,
                                totalSize: 0,
                                hits: 0,
                                misses: 0,
                                hitRatio: 0
                            };
                        }
                        
                        this.statistics.tagStats[tag].itemCount++;
                        this.statistics.tagStats[tag].totalSize += size;
                    }
                }
                
                // Update metrics
                this.metrics.gauge('cache.items', this.memoryCache.size);
                this.metrics.gauge('cache.size', this.calculateMemoryCacheSize());
            }
            
            return true;
        } catch (error) {
            this.logger.error(`Error setting in memory cache: ${key}`, error);
            return false;
        }
    }
    
    /**
     * Sets a value in Redis cache
     * @param key Cache key
     * @param value Value to cache
     * @param options Cache options
     * @returns Whether the value was successfully cached
     */
    private async setInRedis<T>(
        key: string,
        value: T,
        options: {
            ttl?: number,
            tags?: string[]
        } = {}
    ): Promise<boolean> {
        if (!this.redisClient || !this.redisSetAsync || !this.redisExpireAsync) {
            return false;
        }
        
        try {
            // Serialize value
            const serializedValue = this.serializeValue(value);
            
            // Store in Redis
            await this.redisSetAsync(key, serializedValue);
            
            // Set expiration if TTL is provided
            if (options.ttl) {
                await this.redisExpireAsync(key, Math.ceil(options.ttl / 1000));
            }
            
            // Store tags if provided
            if (options.tags && options.tags.length > 0) {
                for (const tag of options.tags) {
                    await this.redisClient.sadd(`tag:${tag}`, key);
                }
            }
            
            return true;
        } catch (error) {
            this.logger.error(`Error setting in Redis cache: ${key}`, error);
            return false;
        }
    }
    
    /**
     * Sets a value in file cache
     * @param key Cache key
     * @param value Value to cache
     * @param options Cache options
     * @returns Whether the value was successfully cached
     */
    private async setInFile<T>(
        key: string,
        value: T,
        options: {
            ttl?: number,
            tags?: string[]
        } = {}
    ): Promise<boolean> {
        try {
            const fileOptions = this.config.fileOptions;
            
            if (!fileOptions) {
                return false;
            }
            
            // Create directory if it doesn't exist
            if (!fs.existsSync(fileOptions.directory)) {
                fs.mkdirSync(fileOptions.directory, { recursive: true });
            }
            
            const filePath = this.getFilePath(key);
            const metaPath = `${filePath}.meta`;
            
            // Serialize value
            let data = Buffer.from(JSON.stringify(value), 'utf8');
            
            // Encrypt if needed
            if (this.config.enableEncryption && this.config.encryptionKey) {
                data = this.encrypt(data);
            }
            
            // Compress if needed
            if (fileOptions.compress) {
                const zlib = require('zlib');
                data = zlib.gzipSync(data);
            }
            
            // Write file
            fs.writeFileSync(filePath, data);
            
            // Calculate item size
            const size = data.length;
            
            // Create metadata
            const metadata = {
                key,
                expiresAt: options.ttl ? Date.now() + options.ttl : undefined,
                createdAt: Date.now(),
                lastAccessedAt: Date.now(),
                accessCount: 0,
                size,
                tags: options.tags,
                version: this.config.enableVersioning ? this.config.cacheVersion : undefined
            };
            
            // Write metadata
            fs.writeFileSync(metaPath, JSON.stringify(metadata));
            
            // Update statistics
            if (this.config.enableStatistics) {
                this.statistics.itemCount++;
                this.statistics.totalSize += size;
                this.updateAverages();
                
                // Update metrics
                this.metrics.gauge('cache.items', this.statistics.itemCount);
                this.metrics.gauge('cache.size', this.statistics.totalSize);
            }
            
            return true;
        } catch (error) {
            this.logger.error(`Error setting in file cache: ${key}`, error);
            return false;
        }
    }
    
    /**
     * Sets a value in multi-level cache
     * @param key Cache key
     * @param value Value to cache
     * @param options Cache options
     * @returns Whether the value was successfully cached
     */
    private async setInMultiLevel<T>(
        key: string,
        value: T,
        options: {
            ttl?: number,
            tags?: string[]
        } = {}
    ): Promise<boolean> {
        const multiOptions = this.config.multiLevelOptions;
        
        if (!multiOptions) {
            return false;
        }
        
        let success = true;
        
        // Set in memory cache
        if (multiOptions.useMemory) {
            const memorySuccess = await this.setInMemory(key, value, options);
            success = success && memorySuccess;
        }
        
        // Set in Redis cache
        if (multiOptions.useRedis) {
            const redisSuccess = await this.setInRedis(key, value, options);
            success = success && redisSuccess;
        }
        
        // Set in file cache
        if (multiOptions.useFile) {
            const fileSuccess = await this.setInFile(key, value, options);
            success = success && fileSuccess;
        }
        
        return success;
    }
    
    /**
     * Deletes a value from the cache
     * @param key Cache key
     * @returns Whether the value was successfully deleted
     */
    public async delete(key: string): Promise<boolean> {
        try {
            // Generate full key with version if versioning is enabled
            const fullKey = this.getFullKey(key);
            
            // Delete from appropriate storage
            switch (this.config.storageType) {
                case CacheStorageType.MEMORY:
                    return this.deleteFromMemory(fullKey);
                    
                case CacheStorageType.REDIS:
                    return await this.deleteFromRedis(fullKey);
                    
                case CacheStorageType.FILE:
                    return await this.deleteFromFile(fullKey);
                    
                case CacheStorageType.MULTI_LEVEL:
                    return await this.deleteFromMultiLevel(fullKey);
                    
                default:
                    throw new Error(`Unsupported cache storage type: ${this.config.storageType}`);
            }
        } catch (error) {
            this.logger.error(`Error deleting cache key: ${key}`, error);
            return false;
        }
    }
    
    /**
     * Deletes a value from memory cache
     * @param key Cache key
     * @returns Whether the value was successfully deleted
     */
    private deleteFromMemory(key: string): boolean {
        const item = this.memoryCache.get(key);
        
        if (!item) {
            return false;
        }
        
        // Delete from cache
        this.memoryCache.delete(key);
        
        // Update statistics
        if (this.config.enableStatistics) {
            this.statistics.itemCount--;
            this.statistics.totalSize -= item.size;
            
            // Update tag statistics
            if (item.tags) {
                for (const tag of item.tags) {
                    if (this.statistics.tagStats[tag]) {
                        this.statistics.tagStats[tag].itemCount--;
                        this.statistics.tagStats[tag].totalSize -= item.size;
                    }
                }
            }
            
            // Update metrics
            this.metrics.gauge('cache.items', this.memoryCache.size);
            this.metrics.gauge('cache.size', this.calculateMemoryCacheSize());
        }
        
        return true;
    }
    
    /**
     * Deletes a value from Redis cache
     * @param key Cache key
     * @returns Whether the value was successfully deleted
     */
    private async deleteFromRedis(key: string): Promise<boolean> {
        if (!this.redisClient || !this.redisDelAsync) {
            return false;
        }
        
        try {
            const result = await this.redisDelAsync(key);
            return result > 0;
        } catch (error) {
            this.logger.error(`Error deleting from Redis cache: ${key}`, error);
            return false;
        }
    }
    
    /**
     * Deletes a value from file cache
     * @param key Cache key
     * @returns Whether the value was successfully deleted
     */
    private async deleteFromFile(key: string): Promise<boolean> {
        try {
            const filePath = this.getFilePath(key);
            const metaPath = `${filePath}.meta`;
            
            // Check if files exist
            const fileExists = fs.existsSync(filePath);
            const metaExists = fs.existsSync(metaPath);
            
            if (!fileExists && !metaExists) {
                return false;
            }
            
            // Read metadata for statistics
            let size = 0;
            let tags: string[] | undefined;
            
            if (metaExists) {
                try {
                    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                    size = metadata.size;
                    tags = metadata.tags;
                } catch (error) {
                    // Ignore metadata errors
                }
            }
            
            // Delete files
            if (fileExists) {
                fs.unlinkSync(filePath);
            }
            
            if (metaExists) {
                fs.unlinkSync(metaPath);
            }
            
            // Update statistics
            if (this.config.enableStatistics && size > 0) {
                this.statistics.itemCount--;
                this.statistics.totalSize -= size;
                
                // Update tag statistics
                if (tags) {
                    for (const tag of tags) {
                        if (this.statistics.tagStats[tag]) {
                            this.statistics.tagStats[tag].itemCount--;
                            this.statistics.tagStats[tag].totalSize -= size;
                        }
                    }
                }
                
                // Update metrics
                this.metrics.gauge('cache.items', this.statistics.itemCount);
                this.metrics.gauge('cache.size', this.statistics.totalSize);
            }
            
            return true;
        } catch (error) {
            this.logger.error(`Error deleting from file cache: ${key}`, error);
            return false;
        }
    }
    
    /**
     * Deletes a value from multi-level cache
     * @param key Cache key
     * @returns Whether the value was successfully deleted
     */
    private async deleteFromMultiLevel(key: string): Promise<boolean> {
        const multiOptions = this.config.multiLevelOptions;
        
        if (!multiOptions) {
            return false;
        }
        
        let success = true;
        
        // Delete from memory cache
        if (multiOptions.useMemory) {
            const memorySuccess = this.deleteFromMemory(key);
            success = success && memorySuccess;
        }
        
        // Delete from Redis cache
        if (multiOptions.useRedis) {
            const redisSuccess = await this.deleteFromRedis(key);
            success = success && redisSuccess;
        }
        
        // Delete from file cache
        if (multiOptions.useFile) {
            const fileSuccess = await this.deleteFromFile(key);
            success = success && fileSuccess;
        }
        
        return success;
    }
    
    /**
     * Clears all cache items
     * @returns Whether the cache was successfully cleared
     */
    public async clear(): Promise<boolean> {
        try {
            // Clear appropriate storage
            switch (this.config.storageType) {
                case CacheStorageType.MEMORY:
                    return this.clearMemory();
                    
                case CacheStorageType.REDIS:
                    return await this.clearRedis();
                    
                case CacheStorageType.FILE:
                    return await this.clearFile();
                    
                case CacheStorageType.MULTI_LEVEL:
                    return await this.clearMultiLevel();
                    
                default:
                    throw new Error(`Unsupported cache storage type: ${this.config.storageType}`);
            }
        } catch (error) {
            this.logger.error('Error clearing cache', error);
            return false;
        }
    }
    
    /**
     * Clears memory cache
     * @returns Whether the cache was successfully cleared
     */
    private clearMemory(): boolean {
        // Clear cache
        this.memoryCache.clear();
        
        // Update statistics
        if (this.config.enableStatistics) {
            this.statistics.itemCount = 0;
            this.statistics.totalSize = 0;
            this.statistics.tagStats = {};
            
            // Update metrics
            this.metrics.gauge('cache.items', 0);
            this.metrics.gauge('cache.size', 0);
        }
        
        return true;
    }
    
    /**
     * Clears Redis cache
     * @returns Whether the cache was successfully cleared
     */
    private async clearRedis(): Promise<boolean> {
        if (!this.redisClient || !this.redisKeysAsync || !this.redisDelAsync) {
            return false;
        }
        
        try {
            // Get all keys with prefix
            const prefix = this.config.redisOptions?.keyPrefix || 'bridge:cache:';
            const keys = await this.redisKeysAsync(`${prefix}*`);
            
            if (keys.length === 0) {
                return true;
            }
            
            // Delete all keys
            await this.redisDelAsync(keys);
            
            return true;
        } catch (error) {
            this.logger.error('Error clearing Redis cache', error);
            return false;
        }
    }
    
    /**
     * Clears file cache
     * @returns Whether the cache was successfully cleared
     */
    private async clearFile(): Promise<boolean> {
        try {
            const options = this.config.fileOptions;
            
            if (!options) {
                return false;
            }
            
            const directory = options.directory;
            
            // Check if directory exists
            if (!fs.existsSync(directory)) {
                return true;
            }
            
            // Get all cache files
            const files = fs.readdirSync(directory);
            
            // Delete all files
            for (const file of files) {
                const filePath = path.join(directory, file);
                fs.unlinkSync(filePath);
            }
            
            // Update statistics
            if (this.config.enableStatistics) {
                this.statistics.itemCount = 0;
                this.statistics.totalSize = 0;
                this.statistics.tagStats = {};
                
                // Update metrics
                this.metrics.gauge('cache.items', 0);
                this.metrics.gauge('cache.size', 0);
            }
            
            return true;
        } catch (error) {
            this.logger.error('Error clearing file cache', error);
            return false;
        }
    }
    
    /**
     * Clears multi-level cache
     * @returns Whether the cache was successfully cleared
     */
    private async clearMultiLevel(): Promise<boolean> {
        const multiOptions = this.config.multiLevelOptions;
        
        if (!multiOptions) {
            return false;
        }
        
        let success = true;
        
        // Clear memory cache
        if (multiOptions.useMemory) {
            const memorySuccess = this.clearMemory();
            success = success && memorySuccess;
        }
        
        // Clear Redis cache
        if (multiOptions.useRedis) {
            const redisSuccess = await this.clearRedis();
            success = success && redisSuccess;
        }
        
        // Clear file cache
        if (multiOptions.useFile) {
            const fileSuccess = await this.clearFile();
            success = success && fileSuccess;
        }
        
        return success;
    }
    
    /**
     * Clears cache items by tag
     * @param tag Tag to clear
     * @returns Whether the cache was successfully cleared
     */
    public async clearByTag(tag: string): Promise<boolean> {
        try {
            // Clear appropriate storage
            switch (this.config.storageType) {
                case CacheStorageType.MEMORY:
                    return this.clearMemoryByTag(tag);
                    
                case CacheStorageType.REDIS:
                    return await this.clearRedisByTag(tag);
                    
                case CacheStorageType.FILE:
                    return await this.clearFileByTag(tag);
                    
                case CacheStorageType.MULTI_LEVEL:
                    return await this.clearMultiLevelByTag(tag);
                    
                default:
                    throw new Error(`Unsupported cache storage type: ${this.config.storageType}`);
            }
        } catch (error) {
            this.logger.error(`Error clearing cache by tag: ${tag}`, error);
            return false;
        }
    }
    
    /**
     * Clears memory cache items by tag
     * @param tag Tag to clear
     * @returns Whether the cache was successfully cleared
     */
    private clearMemoryByTag(tag: string): boolean {
        // Find items with tag
        const keysToDelete: string[] = [];
        
        for (const [key, item] of this.memoryCache.entries()) {
            if (item.tags && item.tags.includes(tag)) {
                keysToDelete.push(key);
            }
        }
        
        // Delete items
        for (const key of keysToDelete) {
            this.deleteFromMemory(key);
        }
        
        return true;
    }
    
    /**
     * Clears Redis cache items by tag
     * @param tag Tag to clear
     * @returns Whether the cache was successfully cleared
     */
    private async clearRedisByTag(tag: string): Promise<boolean> {
        if (!this.redisClient || !this.redisKeysAsync || !this.redisDelAsync) {
            return false;
        }
        
        try {
            // Get keys with tag
            const keys = await this.redisClient.smembers(`tag:${tag}`);
            
            if (keys.length === 0) {
                return true;
            }
            
            // Delete keys
            await this.redisDelAsync(keys);
            
            // Delete tag set
            await this.redisDelAsync(`tag:${tag}`);
            
            return true;
        } catch (error) {
            this.logger.error(`Error clearing Redis cache by tag: ${tag}`, error);
            return false;
        }
    }
    
    /**
     * Clears file cache items by tag
     * @param tag Tag to clear
     * @returns Whether the cache was successfully cleared
     */
    private async clearFileByTag(tag: string): Promise<boolean> {
        try {
            const options = this.config.fileOptions;
            
            if (!options) {
                return false;
            }
            
            const directory = options.directory;
            
            // Check if directory exists
            if (!fs.existsSync(directory)) {
                return true;
            }
            
            // Get all cache files
            const files = fs.readdirSync(directory);
            
            // Find and delete files with tag
            for (const file of files) {
                if (!file.endsWith('.meta')) {
                    continue;
                }
                
                const metaPath = path.join(directory, file);
                
                try {
                    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                    
                    if (metadata.tags && metadata.tags.includes(tag)) {
                        const filePath = metaPath.slice(0, -5); // Remove .meta
                        
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }
                        
                        fs.unlinkSync(metaPath);
                        
                        // Update statistics
                        if (this.config.enableStatistics) {
                            this.statistics.itemCount--;
                            this.statistics.totalSize -= metadata.size;
                            
                            // Update tag statistics
                            if (metadata.tags) {
                                for (const itemTag of metadata.tags) {
                                    if (this.statistics.tagStats[itemTag]) {
                                        this.statistics.tagStats[itemTag].itemCount--;
                                        this.statistics.tagStats[itemTag].totalSize -= metadata.size;
                                    }
                                }
                            }
                        }
                    }
                } catch (error) {
                    // Ignore metadata errors
                }
            }
            
            // Update metrics
            if (this.config.enableStatistics) {
                this.metrics.gauge('cache.items', this.statistics.itemCount);
                this.metrics.gauge('cache.size', this.statistics.totalSize);
            }
            
            return true;
        } catch (error) {
            this.logger.error(`Error clearing file cache by tag: ${tag}`, error);
            return false;
        }
    }
    
    /**
     * Clears multi-level cache items by tag
     * @param tag Tag to clear
     * @returns Whether the cache was successfully cleared
     */
    private async clearMultiLevelByTag(tag: string): Promise<boolean> {
        const multiOptions = this.config.multiLevelOptions;
        
        if (!multiOptions) {
            return false;
        }
        
        let success = true;
        
        // Clear memory cache
        if (multiOptions.useMemory) {
            const memorySuccess = this.clearMemoryByTag(tag);
            success = success && memorySuccess;
        }
        
        // Clear Redis cache
        if (multiOptions.useRedis) {
            const redisSuccess = await this.clearRedisByTag(tag);
            success = success && redisSuccess;
        }
        
        // Clear file cache
        if (multiOptions.useFile) {
            const fileSuccess = await this.clearFileByTag(tag);
            success = success && fileSuccess;
        }
        
        return success;
    }
    
    /**
     * Gets cache statistics
     * @returns Cache statistics
     */
    public getStatistics(): CacheStatistics {
        if (!this.config.enableStatistics) {
            return {
                itemCount: 0,
                totalSize: 0,
                hits: 0,
                misses: 0,
                hitRatio: 0,
                evictions: 0,
                expirations: 0,
                averageItemSize: 0,
                averageItemAge: 0,
                averageAccessCount: 0,
                tagStats: {}
            };
        }
        
        return { ...this.statistics };
    }
    
    /**
     * Updates hit ratio in statistics
     */
    private updateHitRatio(): void {
        const total = this.statistics.hits + this.statistics.misses;
        this.statistics.hitRatio = total > 0 ? this.statistics.hits / total : 0;
    }
    
    /**
     * Updates average values in statistics
     */
    private updateAverages(): void {
        // Update average item size
        this.statistics.averageItemSize = this.statistics.itemCount > 0
            ? this.statistics.totalSize / this.statistics.itemCount
            : 0;
        
        // Update average item age
        const now = Date.now();
        let totalAge = 0;
        let totalAccessCount = 0;
        
        for (const item of this.memoryCache.values()) {
            totalAge += now - item.createdAt;
            totalAccessCount += item.accessCount;
        }
        
        this.statistics.averageItemAge = this.memoryCache.size > 0
            ? totalAge / this.memoryCache.size
            : 0;
        
        // Update average access count
        this.statistics.averageAccessCount = this.memoryCache.size > 0
            ? totalAccessCount / this.memoryCache.size
            : 0;
    }
    
    /**
     * Evicts items from memory cache based on invalidation strategy
     */
    private async evictItems(): Promise<void> {
        try {
            // Calculate number of items to evict
            const itemsToEvict = Math.ceil(this.memoryCache.size * 0.1); // Evict 10% of items
            
            if (itemsToEvict <= 0) {
                return;
            }
            
            this.logger.debug(`Evicting ${itemsToEvict} items from memory cache`);
            
            // Get items sorted by eviction strategy
            const items = Array.from(this.memoryCache.entries());
            
            switch (this.config.invalidationStrategy) {
                case CacheInvalidationStrategy.LRU:
                    // Sort by last accessed time (oldest first)
                    items.sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
                    break;
                    
                case CacheInvalidationStrategy.LFU:
                    // Sort by access count (least first)
                    items.sort((a, b) => a[1].accessCount - b[1].accessCount);
                    break;
                    
                case CacheInvalidationStrategy.FIFO:
                    // Sort by creation time (oldest first)
                    items.sort((a, b) => a[1].createdAt - b[1].createdAt);
                    break;
                    
                default:
                    // Default to LRU
                    items.sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
            }
            
            // Evict items
            for (let i = 0; i < itemsToEvict; i++) {
                const [key, item] = items[i];
                this.memoryCache.delete(key);
                
                // Update statistics
                if (this.config.enableStatistics) {
                    this.statistics.evictions++;
                    this.statistics.itemCount--;
                    this.statistics.totalSize -= item.size;
                    
                    // Update tag statistics
                    if (item.tags) {
                        for (const tag of item.tags) {
                            if (this.statistics.tagStats[tag]) {
                                this.statistics.tagStats[tag].itemCount--;
                                this.statistics.tagStats[tag].totalSize -= item.size;
                            }
                        }
                    }
                }
            }
            
            // Update metrics
            this.metrics.increment('cache.evictions', itemsToEvict);
            this.metrics.gauge('cache.items', this.memoryCache.size);
            this.metrics.gauge('cache.size', this.calculateMemoryCacheSize());
        } catch (error) {
            this.logger.error('Error evicting items from cache', error);
        }
    }
    
    /**
     * Calculates the size of an item
     * @param value Item value
     * @returns Size in bytes
     */
    private calculateItemSize(value: any): number {
        try {
            // Serialize value to JSON and measure string length
            const json = JSON.stringify(value);
            return Buffer.byteLength(json, 'utf8');
        } catch (error) {
            this.logger.error('Error calculating item size', error);
            return 0;
        }
    }
    
    /**
     * Calculates the total size of memory cache
     * @returns Size in bytes
     */
    private calculateMemoryCacheSize(): number {
        let totalSize = 0;
        
        for (const item of this.memoryCache.values()) {
            totalSize += item.size;
        }
        
        return totalSize;
    }
    
    /**
     * Gets the full key with version if versioning is enabled
     * @param key Cache key
     * @returns Full key
     */
    private getFullKey(key: string): string {
        if (this.config.enableVersioning && this.config.cacheVersion) {
            return `${this.config.cacheVersion}:${key}`;
        }
        
        if (this.config.enableSharding) {
            const shardId = this.getShardId(key);
            return `shard${shardId}:${key}`;
        }
        
        return key;
    }
    
    /**
     * Gets the shard ID for a key
     * @param key Cache key
     * @returns Shard ID
     */
    private getShardId(key: string): number {
        const hash = crypto.createHash('md5').update(key).digest('hex');
        const hashNum = parseInt(hash.substring(0, 8), 16);
        return hashNum % this.config.shardCount;
    }
    
    /**
     * Gets the file path for a key
     * @param key Cache key
     * @returns File path
     */
    private getFilePath(key: string): string {
        const options = this.config.fileOptions;
        
        if (!options) {
            throw new Error('File options not provided');
        }
        
        // Hash key to create a valid filename
        const hash = crypto.createHash('md5').update(key).digest('hex');
        
        return path.join(options.directory, `${hash}.cache`);
    }
    
    /**
     * Serializes a value for storage
     * @param value Value to serialize
     * @returns Serialized value
     */
    private serializeValue(value: any): string {
        return JSON.stringify(value);
    }
    
    /**
     * Parses a serialized value
     * @param serialized Serialized value
     * @returns Parsed value
     */
    private parseValue<T>(serialized: string): T {
        return JSON.parse(serialized);
    }
    
    /**
     * Encrypts data
     * @param data Data to encrypt
     * @returns Encrypted data
     */
    private encrypt(data: Buffer): Buffer {
        if (!this.config.encryptionKey) {
            return data;
        }
        
        try {
            const iv = crypto.randomBytes(16);
            const key = crypto.createHash('sha256').update(this.config.encryptionKey).digest();
            const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
            
            const encrypted = Buffer.concat([
                iv,
                cipher.update(data),
                cipher.final()
            ]);
            
            return encrypted;
        } catch (error) {
            this.logger.error('Error encrypting data', error);
            return data;
        }
    }
    
    /**
     * Decrypts data
     * @param data Data to decrypt
     * @returns Decrypted data
     */
    private decrypt(data: Buffer): Buffer {
        if (!this.config.encryptionKey) {
            return data;
        }
        
        try {
            const iv = data.slice(0, 16);
            const encryptedData = data.slice(16);
            const key = crypto.createHash('sha256').update(this.config.encryptionKey).digest();
            const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
            
            const decrypted = Buffer.concat([
                decipher.update(encryptedData),
                decipher.final()
            ]);
            
            return decrypted;
        } catch (error) {
            this.logger.error('Error decrypting data', error);
            return data;
        }
    }
}
