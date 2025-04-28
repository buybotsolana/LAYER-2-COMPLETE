// English comment for verification
/**
 * @file CacheService.ts
 * @description Service for caching data in the Wormhole Relayer system
 * @author Manus AI
 * @date April 27, 2025
 */

import { Logger } from '../utils/Logger';
import { MetricsService } from '../monitoring/MetricsService';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';

// Promisify zlib functions
const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

/**
 * Interface for cache configuration
 */
interface CacheConfig {
  // General settings
  enabled: boolean;
  defaultTTL: number; // Time-to-live in seconds
  maxSize: number; // Maximum size in bytes
  
  // Memory cache settings
  memory: {
    enabled: boolean;
    maxItems: number;
    maxItemSize: number; // Maximum size of a single item in bytes
  };
  
  // File cache settings
  file: {
    enabled: boolean;
    directory: string;
    maxItems: number;
    maxItemSize: number; // Maximum size of a single item in bytes
  };
  
  // Redis cache settings (if available)
  redis: {
    enabled: boolean;
    host: string;
    port: number;
    password?: string;
    db: number;
    keyPrefix: string;
  };
  
  // Compression settings
  compression: {
    enabled: boolean;
    minSize: number; // Minimum size in bytes to apply compression
    level: number; // Compression level (1-9)
  };
  
  // Encryption settings
  encryption: {
    enabled: boolean;
    algorithm: string;
    key: string; // Base64-encoded key
    iv: string; // Base64-encoded initialization vector
  };
  
  // Invalidation settings
  invalidation: {
    strategy: 'LRU' | 'LFU' | 'FIFO';
    scanInterval: number; // Interval in milliseconds to scan for expired items
  };
  
  // Persistence settings
  persistence: {
    enabled: boolean;
    saveInterval: number; // Interval in milliseconds to save cache to disk
    loadOnStart: boolean;
  };
}

/**
 * Interface for a cache item
 */
interface CacheItem {
  key: string;
  value: string;
  size: number;
  createdAt: number;
  expiresAt: number;
  lastAccessed: number;
  accessCount: number;
  compressed: boolean;
  encrypted: boolean;
}

/**
 * Interface for cache statistics
 */
interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  expirations: number;
  evictions: number;
  size: number;
  itemCount: number;
  hitRate: number;
  missRate: number;
}

/**
 * CacheService class
 * 
 * Provides a multi-level caching system for the Wormhole Relayer,
 * with support for memory, file, and Redis caching, as well as
 * compression, encryption, and various invalidation strategies.
 */
export class CacheService {
  private readonly logger: Logger;
  private readonly metrics: MetricsService;
  private readonly config: CacheConfig;
  private isRunning: boolean = false;
  
  // Memory cache
  private memoryCache: Map<string, CacheItem> = new Map();
  private memoryCacheSize: number = 0;
  
  // Redis client (if available)
  private redisClient: any = null;
  
  // Cache statistics
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    expirations: 0,
    evictions: 0,
    size: 0,
    itemCount: 0,
    hitRate: 0,
    missRate: 0
  };
  
  // Timers
  private invalidationTimer: NodeJS.Timeout | null = null;
  private persistenceTimer: NodeJS.Timeout | null = null;
  
  // Encryption key and IV
  private encryptionKey: Buffer | null = null;
  private encryptionIV: Buffer | null = null;
  
  /**
   * Creates a new instance of the CacheService
   * 
   * @param metrics The metrics service
   * @param logger The logger
   * @param config The cache configuration
   */
  constructor(
    metrics: MetricsService,
    logger: Logger,
    config?: Partial<CacheConfig>
  ) {
    this.metrics = metrics;
    this.logger = logger.createChild('CacheService');
    
    // Default configuration
    const defaultConfig: CacheConfig = {
      enabled: true,
      defaultTTL: 3600, // 1 hour
      maxSize: 1024 * 1024 * 100, // 100 MB
      
      memory: {
        enabled: true,
        maxItems: 10000,
        maxItemSize: 1024 * 1024 // 1 MB
      },
      
      file: {
        enabled: true,
        directory: path.join(process.cwd(), 'cache'),
        maxItems: 100000,
        maxItemSize: 1024 * 1024 * 10 // 10 MB
      },
      
      redis: {
        enabled: false,
        host: 'localhost',
        port: 6379,
        db: 0,
        keyPrefix: 'wormhole:cache:'
      },
      
      compression: {
        enabled: true,
        minSize: 1024, // 1 KB
        level: 6
      },
      
      encryption: {
        enabled: false,
        algorithm: 'aes-256-cbc',
        key: '', // Must be provided if encryption is enabled
        iv: '' // Must be provided if encryption is enabled
      },
      
      invalidation: {
        strategy: 'LRU',
        scanInterval: 60000 // 1 minute
      },
      
      persistence: {
        enabled: true,
        saveInterval: 300000, // 5 minutes
        loadOnStart: true
      }
    };
    
    // Merge provided config with defaults
    this.config = {
      ...defaultConfig,
      ...config,
      memory: {
        ...defaultConfig.memory,
        ...(config?.memory || {})
      },
      file: {
        ...defaultConfig.file,
        ...(config?.file || {})
      },
      redis: {
        ...defaultConfig.redis,
        ...(config?.redis || {})
      },
      compression: {
        ...defaultConfig.compression,
        ...(config?.compression || {})
      },
      encryption: {
        ...defaultConfig.encryption,
        ...(config?.encryption || {})
      },
      invalidation: {
        ...defaultConfig.invalidation,
        ...(config?.invalidation || {})
      },
      persistence: {
        ...defaultConfig.persistence,
        ...(config?.persistence || {})
      }
    };
    
    // Initialize encryption if enabled
    if (this.config.encryption.enabled) {
      if (!this.config.encryption.key || !this.config.encryption.iv) {
        throw new Error('Encryption key and IV must be provided if encryption is enabled');
      }
      
      this.encryptionKey = Buffer.from(this.config.encryption.key, 'base64');
      this.encryptionIV = Buffer.from(this.config.encryption.iv, 'base64');
    }
  }
  
  /**
   * Starts the cache service
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Cache service is already running');
      return;
    }
    
    this.isRunning = true;
    this.logger.info('Starting cache service');
    
    try {
      // Create cache directory if it doesn't exist
      if (this.config.file.enabled) {
        if (!fs.existsSync(this.config.file.directory)) {
          fs.mkdirSync(this.config.file.directory, { recursive: true });
        }
      }
      
      // Initialize Redis if enabled
      if (this.config.redis.enabled) {
        await this.initializeRedis();
      }
      
      // Load cache from disk if enabled
      if (this.config.persistence.enabled && this.config.persistence.loadOnStart) {
        await this.loadCache();
      }
      
      // Start invalidation timer
      this.startInvalidationTimer();
      
      // Start persistence timer
      if (this.config.persistence.enabled) {
        this.startPersistenceTimer();
      }
      
      this.logger.info('Cache service started successfully');
      this.metrics.recordMetric('cache_service.started', 1);
    } catch (error) {
      this.isRunning = false;
      this.logger.error('Failed to start cache service', error);
      this.metrics.recordMetric('cache_service.start_failed', 1);
      throw error;
    }
  }
  
  /**
   * Stops the cache service
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('Cache service is not running');
      return;
    }
    
    this.isRunning = false;
    this.logger.info('Stopping cache service');
    
    try {
      // Stop invalidation timer
      if (this.invalidationTimer) {
        clearInterval(this.invalidationTimer);
        this.invalidationTimer = null;
      }
      
      // Stop persistence timer
      if (this.persistenceTimer) {
        clearInterval(this.persistenceTimer);
        this.persistenceTimer = null;
      }
      
      // Save cache to disk if enabled
      if (this.config.persistence.enabled) {
        await this.saveCache();
      }
      
      // Close Redis connection if enabled
      if (this.config.redis.enabled && this.redisClient) {
        await this.closeRedis();
      }
      
      this.logger.info('Cache service stopped successfully');
      this.metrics.recordMetric('cache_service.stopped', 1);
    } catch (error) {
      this.logger.error('Error stopping cache service', error);
      this.metrics.recordMetric('cache_service.stop_failed', 1);
      throw error;
    }
  }
  
  /**
   * Initializes the Redis connection
   */
  private async initializeRedis(): Promise<void> {
    this.logger.info('Initializing Redis connection');
    
    try {
      // In a real implementation, you would initialize the Redis client here
      // For this example, we'll simulate it
      
      this.redisClient = {
        isConnected: true,
        get: async (key: string): Promise<string | null> => {
          // Simulate Redis get
          return null;
        },
        set: async (key: string, value: string, options: any): Promise<void> => {
          // Simulate Redis set
        },
        del: async (key: string): Promise<void> => {
          // Simulate Redis del
        },
        quit: async (): Promise<void> => {
          // Simulate Redis quit
          this.redisClient = null;
        }
      };
      
      this.logger.info('Redis connection initialized successfully');
      this.metrics.recordMetric('cache_service.redis_initialized', 1);
    } catch (error) {
      this.logger.error('Failed to initialize Redis connection', error);
      this.metrics.recordMetric('cache_service.redis_initialization_failed', 1);
      throw error;
    }
  }
  
  /**
   * Closes the Redis connection
   */
  private async closeRedis(): Promise<void> {
    this.logger.info('Closing Redis connection');
    
    try {
      if (this.redisClient) {
        await this.redisClient.quit();
        this.redisClient = null;
      }
      
      this.logger.info('Redis connection closed successfully');
      this.metrics.recordMetric('cache_service.redis_closed', 1);
    } catch (error) {
      this.logger.error('Failed to close Redis connection', error);
      this.metrics.recordMetric('cache_service.redis_close_failed', 1);
      throw error;
    }
  }
  
  /**
   * Starts the invalidation timer
   */
  private startInvalidationTimer(): void {
    this.logger.debug('Starting invalidation timer');
    
    this.invalidationTimer = setInterval(() => {
      this.invalidateExpiredItems();
    }, this.config.invalidation.scanInterval);
  }
  
  /**
   * Starts the persistence timer
   */
  private startPersistenceTimer(): void {
    this.logger.debug('Starting persistence timer');
    
    this.persistenceTimer = setInterval(() => {
      this.saveCache().catch(error => {
        this.logger.error('Error saving cache', error);
      });
    }, this.config.persistence.saveInterval);
  }
  
  /**
   * Invalidates expired items
   */
  private invalidateExpiredItems(): void {
    if (!this.isRunning) return;
    
    this.logger.debug('Invalidating expired items');
    
    try {
      const now = Date.now();
      let expiredCount = 0;
      
      // Check memory cache
      for (const [key, item] of this.memoryCache.entries()) {
        if (item.expiresAt > 0 && item.expiresAt <= now) {
          this.memoryCache.delete(key);
          this.memoryCacheSize -= item.size;
          expiredCount++;
        }
      }
      
      // Update stats
      this.stats.expirations += expiredCount;
      this.stats.itemCount = this.memoryCache.size;
      this.stats.size = this.memoryCacheSize;
      
      // Record metrics
      this.metrics.recordMetric('cache_service.expired_items', expiredCount);
      this.metrics.recordMetric('cache_service.memory_cache_size', this.memoryCacheSize);
      this.metrics.recordMetric('cache_service.memory_cache_items', this.memoryCache.size);
      
      this.logger.debug(`Invalidated ${expiredCount} expired items`);
    } catch (error) {
      this.logger.error('Error invalidating expired items', error);
      this.metrics.recordMetric('cache_service.invalidation_error', 1);
    }
  }
  
  /**
   * Loads the cache from disk
   */
  private async loadCache(): Promise<void> {
    if (!this.config.file.enabled) return;
    
    this.logger.info('Loading cache from disk');
    
    try {
      const cacheFile = path.join(this.config.file.directory, 'memory-cache.json');
      
      if (!fs.existsSync(cacheFile)) {
        this.logger.info('No cache file found, starting with empty cache');
        return;
      }
      
      const cacheData = fs.readFileSync(cacheFile, 'utf8');
      const cache = JSON.parse(cacheData);
      
      // Clear existing cache
      this.memoryCache.clear();
      this.memoryCacheSize = 0;
      
      // Load items
      let loadedCount = 0;
      const now = Date.now();
      
      for (const item of cache.items) {
        // Skip expired items
        if (item.expiresAt > 0 && item.expiresAt <= now) {
          continue;
        }
        
        this.memoryCache.set(item.key, item);
        this.memoryCacheSize += item.size;
        loadedCount++;
      }
      
      // Load stats
      this.stats = cache.stats;
      this.stats.itemCount = this.memoryCache.size;
      this.stats.size = this.memoryCacheSize;
      
      this.logger.info(`Loaded ${loadedCount} items from cache file`);
      this.metrics.recordMetric('cache_service.items_loaded', loadedCount);
    } catch (error) {
      this.logger.error('Error loading cache from disk', error);
      this.metrics.recordMetric('cache_service.load_error', 1);
      
      // Start with empty cache
      this.memoryCache.clear();
      this.memoryCacheSize = 0;
    }
  }
  
  /**
   * Saves the cache to disk
   */
  private async saveCache(): Promise<void> {
    if (!this.config.file.enabled || !this.config.persistence.enabled) return;
    
    this.logger.info('Saving cache to disk');
    
    try {
      const cacheFile = path.join(this.config.file.directory, 'memory-cache.json');
      
      // Prepare cache data
      const cache = {
        items: Array.from(this.memoryCache.values()),
        stats: this.stats
      };
      
      // Save to file
      fs.writeFileSync(cacheFile, JSON.stringify(cache), 'utf8');
      
      this.logger.info(`Saved ${this.memoryCache.size} items to cache file`);
      this.metrics.recordMetric('cache_service.items_saved', this.memoryCache.size);
    } catch (error) {
      this.logger.error('Error saving cache to disk', error);
      this.metrics.recordMetric('cache_service.save_error', 1);
    }
  }
  
  /**
   * Gets a value from the cache
   * 
   * @param key The cache key
   * @returns The cached value, or null if not found
   */
  public async get(key: string): Promise<string | null> {
    if (!this.isRunning || !this.config.enabled) {
      return null;
    }
    
    try {
      // Normalize key
      const normalizedKey = this.normalizeKey(key);
      
      // Try memory cache first
      if (this.config.memory.enabled) {
        const memoryItem = this.memoryCache.get(normalizedKey);
        
        if (memoryItem) {
          // Check if expired
          if (memoryItem.expiresAt > 0 && memoryItem.expiresAt <= Date.now()) {
            // Remove from memory cache
            this.memoryCache.delete(normalizedKey);
            this.memoryCacheSize -= memoryItem.size;
            this.stats.expirations++;
            this.stats.itemCount = this.memoryCache.size;
            this.stats.size = this.memoryCacheSize;
            
            this.metrics.recordMetric('cache_service.memory_cache_miss', 1);
            this.metrics.recordMetric('cache_service.memory_cache_expired', 1);
          } else {
            // Update access stats
            memoryItem.lastAccessed = Date.now();
            memoryItem.accessCount++;
            
            // Get the value
            let value = memoryItem.value;
            
            // Decrypt if needed
            if (memoryItem.encrypted) {
              value = await this.decrypt(value);
            }
            
            // Decompress if needed
            if (memoryItem.compressed) {
              value = await this.decompress(value);
            }
            
            // Update stats
            this.stats.hits++;
            this.updateHitRates();
            
            this.metrics.recordMetric('cache_service.memory_cache_hit', 1);
            
            return value;
          }
        } else {
          this.metrics.recordMetric('cache_service.memory_cache_miss', 1);
        }
      }
      
      // Try Redis cache if enabled
      if (this.config.redis.enabled && this.redisClient) {
        const redisKey = this.config.redis.keyPrefix + normalizedKey;
        const redisValue = await this.redisClient.get(redisKey);
        
        if (redisValue) {
          // Parse the value
          const parsedValue = JSON.parse(redisValue);
          
          // Check if expired
          if (parsedValue.expiresAt > 0 && parsedValue.expiresAt <= Date.now()) {
            // Remove from Redis
            await this.redisClient.del(redisKey);
            
            this.metrics.recordMetric('cache_service.redis_cache_miss', 1);
            this.metrics.recordMetric('cache_service.redis_cache_expired', 1);
          } else {
            // Get the value
            let value = parsedValue.value;
            
            // Decrypt if needed
            if (parsedValue.encrypted) {
              value = await this.decrypt(value);
            }
            
            // Decompress if needed
            if (parsedValue.compressed) {
              value = await this.decompress(value);
            }
            
            // Store in memory cache if enabled
            if (this.config.memory.enabled) {
              await this.storeInMemoryCache(normalizedKey, value, parsedValue.expiresAt);
            }
            
            // Update stats
            this.stats.hits++;
            this.updateHitRates();
            
            this.metrics.recordMetric('cache_service.redis_cache_hit', 1);
            
            return value;
          }
        } else {
          this.metrics.recordMetric('cache_service.redis_cache_miss', 1);
        }
      }
      
      // Try file cache if enabled
      if (this.config.file.enabled) {
        const filePath = this.getFilePath(normalizedKey);
        
        if (fs.existsSync(filePath)) {
          try {
            const fileData = fs.readFileSync(filePath, 'utf8');
            const parsedData = JSON.parse(fileData);
            
            // Check if expired
            if (parsedData.expiresAt > 0 && parsedData.expiresAt <= Date.now()) {
              // Remove file
              fs.unlinkSync(filePath);
              
              this.metrics.recordMetric('cache_service.file_cache_miss', 1);
              this.metrics.recordMetric('cache_service.file_cache_expired', 1);
            } else {
              // Get the value
              let value = parsedData.value;
              
              // Decrypt if needed
              if (parsedData.encrypted) {
                value = await this.decrypt(value);
              }
              
              // Decompress if needed
              if (parsedData.compressed) {
                value = await this.decompress(value);
              }
              
              // Store in memory cache if enabled
              if (this.config.memory.enabled) {
                await this.storeInMemoryCache(normalizedKey, value, parsedData.expiresAt);
              }
              
              // Update stats
              this.stats.hits++;
              this.updateHitRates();
              
              this.metrics.recordMetric('cache_service.file_cache_hit', 1);
              
              return value;
            }
          } catch (error) {
            this.logger.error(`Error reading cache file for key ${normalizedKey}`, error);
            this.metrics.recordMetric('cache_service.file_cache_error', 1);
            
            // Remove corrupted file
            try {
              fs.unlinkSync(filePath);
            } catch (unlinkError) {
              this.logger.error(`Error removing corrupted cache file for key ${normalizedKey}`, unlinkError);
            }
          }
        } else {
          this.metrics.recordMetric('cache_service.file_cache_miss', 1);
        }
      }
      
      // Not found in any cache
      this.stats.misses++;
      this.updateHitRates();
      
      this.metrics.recordMetric('cache_service.cache_miss', 1);
      
      return null;
    } catch (error) {
      this.logger.error(`Error getting cache value for key ${key}`, error);
      this.metrics.recordMetric('cache_service.get_error', 1);
      return null;
    }
  }
  
  /**
   * Sets a value in the cache
   * 
   * @param key The cache key
   * @param value The value to cache
   * @param ttl The time-to-live in seconds, or 0 for no expiration
   * @returns Whether the operation was successful
   */
  public async set(key: string, value: string, ttl: number = this.config.defaultTTL): Promise<boolean> {
    if (!this.isRunning || !this.config.enabled) {
      return false;
    }
    
    try {
      // Normalize key
      const normalizedKey = this.normalizeKey(key);
      
      // Calculate expiration time
      const expiresAt = ttl > 0 ? Date.now() + (ttl * 1000) : 0;
      
      // Compress if needed
      let compressedValue = value;
      let compressed = false;
      
      if (this.config.compression.enabled && value.length >= this.config.compression.minSize) {
        compressedValue = await this.compress(value);
        compressed = true;
      }
      
      // Encrypt if needed
      let encryptedValue = compressedValue;
      let encrypted = false;
      
      if (this.config.encryption.enabled) {
        encryptedValue = await this.encrypt(compressedValue);
        encrypted = true;
      }
      
      // Store in memory cache if enabled
      if (this.config.memory.enabled) {
        await this.storeInMemoryCache(normalizedKey, value, expiresAt, compressed, encrypted, encryptedValue);
      }
      
      // Store in Redis if enabled
      if (this.config.redis.enabled && this.redisClient) {
        await this.storeInRedis(normalizedKey, encryptedValue, expiresAt, compressed, encrypted);
      }
      
      // Store in file cache if enabled
      if (this.config.file.enabled) {
        await this.storeInFile(normalizedKey, encryptedValue, expiresAt, compressed, encrypted);
      }
      
      // Update stats
      this.stats.sets++;
      
      this.metrics.recordMetric('cache_service.cache_set', 1);
      
      return true;
    } catch (error) {
      this.logger.error(`Error setting cache value for key ${key}`, error);
      this.metrics.recordMetric('cache_service.set_error', 1);
      return false;
    }
  }
  
  /**
   * Deletes a value from the cache
   * 
   * @param key The cache key
   * @returns Whether the operation was successful
   */
  public async delete(key: string): Promise<boolean> {
    if (!this.isRunning || !this.config.enabled) {
      return false;
    }
    
    try {
      // Normalize key
      const normalizedKey = this.normalizeKey(key);
      
      // Delete from memory cache
      if (this.config.memory.enabled) {
        const memoryItem = this.memoryCache.get(normalizedKey);
        
        if (memoryItem) {
          this.memoryCache.delete(normalizedKey);
          this.memoryCacheSize -= memoryItem.size;
          this.stats.itemCount = this.memoryCache.size;
          this.stats.size = this.memoryCacheSize;
          
          this.metrics.recordMetric('cache_service.memory_cache_delete', 1);
        }
      }
      
      // Delete from Redis if enabled
      if (this.config.redis.enabled && this.redisClient) {
        const redisKey = this.config.redis.keyPrefix + normalizedKey;
        await this.redisClient.del(redisKey);
        
        this.metrics.recordMetric('cache_service.redis_cache_delete', 1);
      }
      
      // Delete from file cache if enabled
      if (this.config.file.enabled) {
        const filePath = this.getFilePath(normalizedKey);
        
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          
          this.metrics.recordMetric('cache_service.file_cache_delete', 1);
        }
      }
      
      // Update stats
      this.stats.deletes++;
      
      this.metrics.recordMetric('cache_service.cache_delete', 1);
      
      return true;
    } catch (error) {
      this.logger.error(`Error deleting cache value for key ${key}`, error);
      this.metrics.recordMetric('cache_service.delete_error', 1);
      return false;
    }
  }
  
  /**
   * Clears the entire cache
   * 
   * @returns Whether the operation was successful
   */
  public async clear(): Promise<boolean> {
    if (!this.isRunning) {
      return false;
    }
    
    try {
      // Clear memory cache
      this.memoryCache.clear();
      this.memoryCacheSize = 0;
      
      // Clear Redis if enabled
      if (this.config.redis.enabled && this.redisClient) {
        // In a real implementation, you would clear all keys with the prefix
        // For this example, we'll just log it
        this.logger.info('Clearing Redis cache');
      }
      
      // Clear file cache if enabled
      if (this.config.file.enabled) {
        // Delete all cache files
        const cacheDir = this.config.file.directory;
        
        if (fs.existsSync(cacheDir)) {
          const files = fs.readdirSync(cacheDir);
          
          for (const file of files) {
            if (file.endsWith('.cache')) {
              fs.unlinkSync(path.join(cacheDir, file));
            }
          }
        }
      }
      
      // Reset stats
      this.resetStats();
      
      this.logger.info('Cache cleared successfully');
      this.metrics.recordMetric('cache_service.cache_cleared', 1);
      
      return true;
    } catch (error) {
      this.logger.error('Error clearing cache', error);
      this.metrics.recordMetric('cache_service.clear_error', 1);
      return false;
    }
  }
  
  /**
   * Stores a value in the memory cache
   * 
   * @param key The cache key
   * @param value The original value
   * @param expiresAt The expiration timestamp
   * @param compressed Whether the value is compressed
   * @param encrypted Whether the value is encrypted
   * @param storedValue The value to store (compressed and/or encrypted)
   */
  private async storeInMemoryCache(
    key: string,
    value: string,
    expiresAt: number,
    compressed: boolean = false,
    encrypted: boolean = false,
    storedValue?: string
  ): Promise<void> {
    // Check if we need to store the original or processed value
    const valueToStore = storedValue || value;
    
    // Calculate size
    const size = Buffer.byteLength(valueToStore, 'utf8');
    
    // Check if item is too large
    if (size > this.config.memory.maxItemSize) {
      this.logger.warn(`Cache item for key ${key} is too large for memory cache (${size} bytes)`);
      this.metrics.recordMetric('cache_service.memory_cache_item_too_large', 1);
      return;
    }
    
    // Check if we need to make room
    if (this.memoryCache.size >= this.config.memory.maxItems || 
        this.memoryCacheSize + size > this.config.maxSize) {
      this.evictItems(size);
    }
    
    // Create cache item
    const cacheItem: CacheItem = {
      key,
      value: valueToStore,
      size,
      createdAt: Date.now(),
      expiresAt,
      lastAccessed: Date.now(),
      accessCount: 0,
      compressed,
      encrypted
    };
    
    // Store in memory cache
    this.memoryCache.set(key, cacheItem);
    this.memoryCacheSize += size;
    
    // Update stats
    this.stats.itemCount = this.memoryCache.size;
    this.stats.size = this.memoryCacheSize;
  }
  
  /**
   * Stores a value in Redis
   * 
   * @param key The cache key
   * @param value The value to store
   * @param expiresAt The expiration timestamp
   * @param compressed Whether the value is compressed
   * @param encrypted Whether the value is encrypted
   */
  private async storeInRedis(
    key: string,
    value: string,
    expiresAt: number,
    compressed: boolean,
    encrypted: boolean
  ): Promise<void> {
    if (!this.redisClient) return;
    
    const redisKey = this.config.redis.keyPrefix + key;
    
    // Create cache item
    const cacheItem = {
      value,
      expiresAt,
      compressed,
      encrypted
    };
    
    // Calculate TTL
    const ttl = expiresAt > 0 ? Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)) : 0;
    
    // Store in Redis
    if (ttl > 0) {
      await this.redisClient.set(redisKey, JSON.stringify(cacheItem), { EX: ttl });
    } else {
      await this.redisClient.set(redisKey, JSON.stringify(cacheItem));
    }
  }
  
  /**
   * Stores a value in the file cache
   * 
   * @param key The cache key
   * @param value The value to store
   * @param expiresAt The expiration timestamp
   * @param compressed Whether the value is compressed
   * @param encrypted Whether the value is encrypted
   */
  private async storeInFile(
    key: string,
    value: string,
    expiresAt: number,
    compressed: boolean,
    encrypted: boolean
  ): Promise<void> {
    const filePath = this.getFilePath(key);
    
    // Calculate size
    const size = Buffer.byteLength(value, 'utf8');
    
    // Check if item is too large
    if (size > this.config.file.maxItemSize) {
      this.logger.warn(`Cache item for key ${key} is too large for file cache (${size} bytes)`);
      this.metrics.recordMetric('cache_service.file_cache_item_too_large', 1);
      return;
    }
    
    // Create cache item
    const cacheItem = {
      key,
      value,
      size,
      createdAt: Date.now(),
      expiresAt,
      lastAccessed: Date.now(),
      accessCount: 0,
      compressed,
      encrypted
    };
    
    // Store in file
    fs.writeFileSync(filePath, JSON.stringify(cacheItem), 'utf8');
  }
  
  /**
   * Evicts items from the memory cache to make room for new items
   * 
   * @param sizeNeeded The size needed in bytes
   */
  private evictItems(sizeNeeded: number): void {
    this.logger.debug(`Evicting items to make room for ${sizeNeeded} bytes`);
    
    // Check if we need to evict items
    if (this.memoryCache.size === 0) {
      return;
    }
    
    // Get all items
    const items = Array.from(this.memoryCache.values());
    
    // Sort items based on invalidation strategy
    if (this.config.invalidation.strategy === 'LRU') {
      // Least Recently Used
      items.sort((a, b) => a.lastAccessed - b.lastAccessed);
    } else if (this.config.invalidation.strategy === 'LFU') {
      // Least Frequently Used
      items.sort((a, b) => a.accessCount - b.accessCount);
    } else {
      // FIFO (First In, First Out)
      items.sort((a, b) => a.createdAt - b.createdAt);
    }
    
    // Evict items until we have enough space
    let evictedCount = 0;
    let evictedSize = 0;
    
    while (
      (this.memoryCache.size - evictedCount > this.config.memory.maxItems || 
       this.memoryCacheSize - evictedSize + sizeNeeded > this.config.maxSize) && 
      evictedCount < items.length
    ) {
      const item = items[evictedCount];
      this.memoryCache.delete(item.key);
      evictedSize += item.size;
      evictedCount++;
    }
    
    // Update stats
    this.memoryCacheSize -= evictedSize;
    this.stats.evictions += evictedCount;
    this.stats.itemCount = this.memoryCache.size;
    this.stats.size = this.memoryCacheSize;
    
    this.logger.debug(`Evicted ${evictedCount} items (${evictedSize} bytes)`);
    this.metrics.recordMetric('cache_service.items_evicted', evictedCount);
    this.metrics.recordMetric('cache_service.bytes_evicted', evictedSize);
  }
  
  /**
   * Compresses a string
   * 
   * @param value The string to compress
   * @returns The compressed string
   */
  private async compress(value: string): Promise<string> {
    try {
      const buffer = Buffer.from(value, 'utf8');
      const compressed = await gzipAsync(buffer, { level: this.config.compression.level });
      return compressed.toString('base64');
    } catch (error) {
      this.logger.error('Error compressing value', error);
      this.metrics.recordMetric('cache_service.compression_error', 1);
      return value;
    }
  }
  
  /**
   * Decompresses a string
   * 
   * @param value The compressed string
   * @returns The decompressed string
   */
  private async decompress(value: string): Promise<string> {
    try {
      const buffer = Buffer.from(value, 'base64');
      const decompressed = await gunzipAsync(buffer);
      return decompressed.toString('utf8');
    } catch (error) {
      this.logger.error('Error decompressing value', error);
      this.metrics.recordMetric('cache_service.decompression_error', 1);
      return value;
    }
  }
  
  /**
   * Encrypts a string
   * 
   * @param value The string to encrypt
   * @returns The encrypted string
   */
  private async encrypt(value: string): Promise<string> {
    if (!this.encryptionKey || !this.encryptionIV) {
      return value;
    }
    
    try {
      const cipher = crypto.createCipheriv(
        this.config.encryption.algorithm,
        this.encryptionKey,
        this.encryptionIV
      );
      
      let encrypted = cipher.update(value, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      
      return encrypted;
    } catch (error) {
      this.logger.error('Error encrypting value', error);
      this.metrics.recordMetric('cache_service.encryption_error', 1);
      return value;
    }
  }
  
  /**
   * Decrypts a string
   * 
   * @param value The encrypted string
   * @returns The decrypted string
   */
  private async decrypt(value: string): Promise<string> {
    if (!this.encryptionKey || !this.encryptionIV) {
      return value;
    }
    
    try {
      const decipher = crypto.createDecipheriv(
        this.config.encryption.algorithm,
        this.encryptionKey,
        this.encryptionIV
      );
      
      let decrypted = decipher.update(value, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      this.logger.error('Error decrypting value', error);
      this.metrics.recordMetric('cache_service.decryption_error', 1);
      return value;
    }
  }
  
  /**
   * Normalizes a cache key
   * 
   * @param key The key to normalize
   * @returns The normalized key
   */
  private normalizeKey(key: string): string {
    // Replace invalid characters
    return key.replace(/[^a-zA-Z0-9_:.-]/g, '_');
  }
  
  /**
   * Gets the file path for a cache key
   * 
   * @param key The cache key
   * @returns The file path
   */
  private getFilePath(key: string): string {
    // Create a hash of the key
    const hash = crypto.createHash('md5').update(key).digest('hex');
    
    // Create a directory structure based on the first few characters of the hash
    const dir1 = hash.substring(0, 2);
    const dir2 = hash.substring(2, 4);
    
    const dirPath = path.join(this.config.file.directory, dir1, dir2);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    // Return the full path
    return path.join(dirPath, `${hash}.cache`);
  }
  
  /**
   * Updates hit and miss rates
   */
  private updateHitRates(): void {
    const total = this.stats.hits + this.stats.misses;
    
    if (total > 0) {
      this.stats.hitRate = this.stats.hits / total;
      this.stats.missRate = this.stats.misses / total;
    } else {
      this.stats.hitRate = 0;
      this.stats.missRate = 0;
    }
  }
  
  /**
   * Resets cache statistics
   */
  private resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      expirations: 0,
      evictions: 0,
      size: this.memoryCacheSize,
      itemCount: this.memoryCache.size,
      hitRate: 0,
      missRate: 0
    };
  }
  
  /**
   * Gets cache statistics
   * 
   * @returns The cache statistics
   */
  public getStats(): CacheStats {
    return { ...this.stats };
  }
  
  /**
   * Gets the status of the cache service
   * 
   * @returns The status
   */
  public getStatus(): {
    isRunning: boolean;
    enabled: boolean;
    memoryEnabled: boolean;
    fileEnabled: boolean;
    redisEnabled: boolean;
    redisConnected: boolean;
    compressionEnabled: boolean;
    encryptionEnabled: boolean;
    itemCount: number;
    size: number;
    hitRate: number;
  } {
    return {
      isRunning: this.isRunning,
      enabled: this.config.enabled,
      memoryEnabled: this.config.memory.enabled,
      fileEnabled: this.config.file.enabled,
      redisEnabled: this.config.redis.enabled,
      redisConnected: this.redisClient !== null,
      compressionEnabled: this.config.compression.enabled,
      encryptionEnabled: this.config.encryption.enabled,
      itemCount: this.stats.itemCount,
      size: this.stats.size,
      hitRate: this.stats.hitRate
    };
  }
}
