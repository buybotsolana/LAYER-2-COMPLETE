import { PublicKey, Connection, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BN } from '@project-serum/anchor';
import * as bs58 from 'bs58';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { createHmac } from 'crypto';
import * as AsyncLock from 'async-lock';
import { performance } from 'perf_hooks';

// Load environment variables
dotenv.config();

/**
 * Optimized Memory Pool for Layer-2 on Solana
 * Provides efficient memory management for high-throughput operations
 */
export class MemoryPool {
  private bufferPool: Map<number, Buffer[]>;
  private maxPoolSize: number;
  private stats: MemoryPoolStats;
  private lock: AsyncLock;
  private cleanupInterval: NodeJS.Timeout | null;
  private lastCleanupTime: number;
  private cleanupThreshold: number;

  /**
   * Constructor for MemoryPool
   * @param config Memory pool configuration
   */
  constructor(config?: Partial<MemoryPoolConfig>) {
    this.bufferPool = new Map();
    this.maxPoolSize = config?.maxPoolSize || 1000;
    this.cleanupThreshold = config?.cleanupThreshold || 0.7; // 70% utilization triggers cleanup
    this.lock = new AsyncLock();
    this.lastCleanupTime = Date.now();
    
    // Initialize stats
    this.stats = {
      totalAllocations: 0,
      poolHits: 0,
      poolMisses: 0,
      totalReleases: 0,
      currentPoolSize: 0,
      peakPoolSize: 0,
      lastCleanupTime: this.lastCleanupTime,
      creationTime: Date.now()
    };
    
    // Start periodic cleanup if enabled
    if (config?.enablePeriodicCleanup !== false) {
      const cleanupIntervalMs = config?.cleanupIntervalMs || 60000; // Default: 1 minute
      this.cleanupInterval = setInterval(() => this.cleanup(), cleanupIntervalMs);
    } else {
      this.cleanupInterval = null;
    }
  }

  /**
   * Allocate a buffer from the pool or create a new one
   * @param size Buffer size in bytes
   * @returns Allocated buffer
   */
  allocate(size: number): Buffer {
    if (size <= 0) {
      throw new Error('Buffer size must be positive');
    }
    
    this.stats.totalAllocations++;
    
    return this.lock.acquire('pool', () => {
      // Check if we have a buffer of this size in the pool
      const buffers = this.bufferPool.get(size);
      
      if (buffers && buffers.length > 0) {
        // Use a buffer from the pool
        const buffer = buffers.pop()!;
        this.stats.poolHits++;
        this.stats.currentPoolSize--;
        return buffer;
      } else {
        // Create a new buffer
        this.stats.poolMisses++;
        return Buffer.alloc(size);
      }
    });
  }

  /**
   * Release a buffer back to the pool
   * @param buffer Buffer to release
   */
  release(buffer: Buffer): void {
    if (!buffer) {
      return;
    }
    
    this.stats.totalReleases++;
    
    this.lock.acquire('pool', () => {
      const size = buffer.length;
      
      // Get or create the list of buffers for this size
      let buffers = this.bufferPool.get(size);
      if (!buffers) {
        buffers = [];
        this.bufferPool.set(size, buffers);
      }
      
      // Check if we've reached the maximum pool size
      if (this.stats.currentPoolSize < this.maxPoolSize) {
        // Clear the buffer data for security
        buffer.fill(0);
        
        // Add the buffer to the pool
        buffers.push(buffer);
        this.stats.currentPoolSize++;
        
        // Update peak pool size
        if (this.stats.currentPoolSize > this.stats.peakPoolSize) {
          this.stats.peakPoolSize = this.stats.currentPoolSize;
        }
        
        // Check if we need to clean up
        if (this.stats.currentPoolSize > this.maxPoolSize * this.cleanupThreshold) {
          this.cleanup();
        }
      }
      // If we've reached the maximum pool size, the buffer will be garbage collected
    });
  }

  /**
   * Clean up the pool by removing excess buffers
   */
  cleanup(): void {
    this.lock.acquire('pool', () => {
      // Calculate how many buffers to remove
      const targetSize = Math.floor(this.maxPoolSize * 0.5); // Reduce to 50% of max size
      let toRemove = Math.max(0, this.stats.currentPoolSize - targetSize);
      
      if (toRemove === 0) {
        return;
      }
      
      // Sort buffer sizes by frequency (least used first)
      const sizeFrequency = new Map<number, number>();
      for (const [size, buffers] of this.bufferPool.entries()) {
        sizeFrequency.set(size, buffers.length);
      }
      
      const sortedSizes = Array.from(sizeFrequency.entries())
        .sort((a, b) => a[1] - b[1])
        .map(entry => entry[0]);
      
      // Remove buffers starting with least used sizes
      for (const size of sortedSizes) {
        if (toRemove <= 0) break;
        
        const buffers = this.bufferPool.get(size)!;
        const removeCount = Math.min(buffers.length, toRemove);
        
        // Remove buffers
        buffers.splice(0, removeCount);
        
        // Update stats
        this.stats.currentPoolSize -= removeCount;
        toRemove -= removeCount;
        
        // If all buffers of this size were removed, delete the entry
        if (buffers.length === 0) {
          this.bufferPool.delete(size);
        }
      }
      
      this.lastCleanupTime = Date.now();
      this.stats.lastCleanupTime = this.lastCleanupTime;
    });
  }

  /**
   * Get memory pool statistics
   * @returns Memory pool statistics
   */
  getStats(): MemoryPoolStats {
    return { ...this.stats };
  }

  /**
   * Destroy the memory pool
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.lock.acquire('pool', () => {
      // Clear all buffers
      for (const [size, buffers] of this.bufferPool.entries()) {
        for (const buffer of buffers) {
          buffer.fill(0);
        }
      }
      
      // Clear the pool
      this.bufferPool.clear();
      this.stats.currentPoolSize = 0;
    });
  }
}

/**
 * Memory pool configuration
 */
interface MemoryPoolConfig {
  maxPoolSize: number;
  enablePeriodicCleanup: boolean;
  cleanupIntervalMs: number;
  cleanupThreshold: number;
}

/**
 * Memory pool statistics
 */
interface MemoryPoolStats {
  totalAllocations: number;
  poolHits: number;
  poolMisses: number;
  totalReleases: number;
  currentPoolSize: number;
  peakPoolSize: number;
  lastCleanupTime: number;
  creationTime: number;
}

/**
 * Batch Processor for Layer-2 on Solana
 * Provides efficient batch processing for high-throughput operations
 */
export class BatchProcessor<T> {
  private batchQueue: T[];
  private processingBatch: boolean;
  private batchSize: number;
  private processingIntervalMs: number;
  private processingTimeout: NodeJS.Timeout | null;
  private processingFunction: (items: T[]) => Promise<void>;
  private stats: BatchProcessorStats;
  private memoryPool: MemoryPool | null;
  private maxQueueSize: number;
  private errorHandler: (error: Error, items: T[]) => Promise<void>;

  /**
   * Constructor for BatchProcessor
   * @param processingFunction Function to process batches
   * @param config Batch processor configuration
   */
  constructor(
    processingFunction: (items: T[]) => Promise<void>,
    config?: Partial<BatchProcessorConfig>
  ) {
    this.batchQueue = [];
    this.processingBatch = false;
    this.batchSize = config?.batchSize || 100;
    this.processingIntervalMs = config?.processingIntervalMs || 1000;
    this.processingTimeout = null;
    this.processingFunction = processingFunction;
    this.maxQueueSize = config?.maxQueueSize || 10000;
    this.memoryPool = config?.memoryPool || null;
    
    // Default error handler
    this.errorHandler = config?.errorHandler || (async (error, items) => {
      console.error('Batch processing error:', error);
      console.error('Failed items:', items);
    });
    
    // Initialize stats
    this.stats = {
      totalItemsProcessed: 0,
      totalBatchesProcessed: 0,
      totalErrors: 0,
      averageBatchSize: 0,
      averageProcessingTimeMs: 0,
      currentQueueSize: 0,
      peakQueueSize: 0,
      lastProcessingTimeMs: 0,
      creationTime: Date.now()
    };
    
    // Start processing timer
    this.startProcessingTimer();
  }

  /**
   * Add an item to the batch queue
   * @param item Item to add
   * @returns Whether the item was added successfully
   */
  addItem(item: T): boolean {
    // Check if queue is full
    if (this.batchQueue.length >= this.maxQueueSize) {
      return false;
    }
    
    // Add item to queue
    this.batchQueue.push(item);
    this.stats.currentQueueSize = this.batchQueue.length;
    
    // Update peak queue size
    if (this.batchQueue.length > this.stats.peakQueueSize) {
      this.stats.peakQueueSize = this.batchQueue.length;
    }
    
    // Process immediately if batch size is reached
    if (this.batchQueue.length >= this.batchSize) {
      this.processBatch();
    }
    
    return true;
  }

  /**
   * Add multiple items to the batch queue
   * @param items Items to add
   * @returns Number of items successfully added
   */
  addItems(items: T[]): number {
    if (!items || items.length === 0) {
      return 0;
    }
    
    let addedCount = 0;
    
    for (const item of items) {
      if (this.addItem(item)) {
        addedCount++;
      } else {
        break; // Queue is full
      }
    }
    
    return addedCount;
  }

  /**
   * Process the current batch
   */
  private async processBatch(): Promise<void> {
    // Check if already processing or queue is empty
    if (this.processingBatch || this.batchQueue.length === 0) {
      return;
    }
    
    this.processingBatch = true;
    
    try {
      // Take items from queue up to batch size
      const itemsToProcess = this.batchQueue.splice(0, this.batchSize);
      this.stats.currentQueueSize = this.batchQueue.length;
      
      if (itemsToProcess.length === 0) {
        this.processingBatch = false;
        return;
      }
      
      // Process batch
      const startTime = performance.now();
      
      try {
        await this.processingFunction(itemsToProcess);
        
        // Update stats
        this.stats.totalItemsProcessed += itemsToProcess.length;
        this.stats.totalBatchesProcessed++;
        
        const processingTime = performance.now() - startTime;
        this.stats.lastProcessingTimeMs = processingTime;
        
        // Update average processing time
        this.stats.averageProcessingTimeMs = 
          (this.stats.averageProcessingTimeMs * (this.stats.totalBatchesProcessed - 1) + processingTime) / 
          this.stats.totalBatchesProcessed;
        
        // Update average batch size
        this.stats.averageBatchSize = 
          (this.stats.averageBatchSize * (this.stats.totalBatchesProcessed - 1) + itemsToProcess.length) / 
          this.stats.totalBatchesProcessed;
      } catch (error) {
        this.stats.totalErrors++;
        await this.errorHandler(error, itemsToProcess);
      }
    } finally {
      this.processingBatch = false;
      
      // Check if there are more items to process
      if (this.batchQueue.length >= this.batchSize) {
        // Process next batch immediately
        setImmediate(() => this.processBatch());
      }
    }
  }

  /**
   * Start the processing timer
   */
  private startProcessingTimer(): void {
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
    }
    
    this.processingTimeout = setTimeout(() => {
      this.processBatch();
      this.startProcessingTimer();
    }, this.processingIntervalMs);
  }

  /**
   * Get batch processor statistics
   * @returns Batch processor statistics
   */
  getStats(): BatchProcessorStats {
    return { ...this.stats };
  }

  /**
   * Flush the batch queue and process all remaining items
   */
  async flush(): Promise<void> {
    // Process all remaining items
    while (this.batchQueue.length > 0) {
      await this.processBatch();
      
      // Wait a bit to allow other operations
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /**
   * Destroy the batch processor
   */
  destroy(): void {
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
      this.processingTimeout = null;
    }
    
    this.batchQueue = [];
    this.stats.currentQueueSize = 0;
  }
}

/**
 * Batch processor configuration
 */
interface BatchProcessorConfig {
  batchSize: number;
  processingIntervalMs: number;
  maxQueueSize: number;
  memoryPool: MemoryPool | null;
  errorHandler: (error: Error, items: any[]) => Promise<void>;
}

/**
 * Batch processor statistics
 */
interface BatchProcessorStats {
  totalItemsProcessed: number;
  totalBatchesProcessed: number;
  totalErrors: number;
  averageBatchSize: number;
  averageProcessingTimeMs: number;
  currentQueueSize: number;
  peakQueueSize: number;
  lastProcessingTimeMs: number;
  creationTime: number;
}

/**
 * Concurrent Executor for Layer-2 on Solana
 * Provides efficient concurrent execution for high-throughput operations
 */
export class ConcurrentExecutor {
  private concurrencyLimit: number;
  private activeCount: number;
  private taskQueue: Array<() => Promise<any>>;
  private stats: ConcurrentExecutorStats;
  private memoryPool: MemoryPool | null;
  private lock: AsyncLock;
  private paused: boolean;

  /**
   * Constructor for ConcurrentExecutor
   * @param config Concurrent executor configuration
   */
  constructor(config?: Partial<ConcurrentExecutorConfig>) {
    this.concurrencyLimit = config?.concurrencyLimit || 10;
    this.activeCount = 0;
    this.taskQueue = [];
    this.memoryPool = config?.memoryPool || null;
    this.lock = new AsyncLock();
    this.paused = false;
    
    // Initialize stats
    this.stats = {
      totalTasksExecuted: 0,
      totalTasksQueued: 0,
      totalErrors: 0,
      averageExecutionTimeMs: 0,
      currentActiveCount: 0,
      currentQueueSize: 0,
      peakActiveCount: 0,
      peakQueueSize: 0,
      creationTime: Date.now()
    };
  }

  /**
   * Execute a task with concurrency control
   * @param task Task to execute
   * @returns Result of the task
   */
  async execute<T>(task: () => Promise<T>): Promise<T> {
    // Check if executor is paused
    if (this.paused) {
      throw new Error('Executor is paused');
    }
    
    // Add task to queue
    this.stats.totalTasksQueued++;
    this.stats.currentQueueSize = this.taskQueue.length;
    
    // Create a promise that will be resolved when the task completes
    return new Promise<T>((resolve, reject) => {
      const wrappedTask = async () => {
        const startTime = performance.now();
        
        try {
          // Execute the task
          const result = await task();
          
          // Update stats
          this.stats.totalTasksExecuted++;
          
          const executionTime = performance.now() - startTime;
          
          // Update average execution time
          this.stats.averageExecutionTimeMs = 
            (this.stats.averageExecutionTimeMs * (this.stats.totalTasksExecuted - 1) + executionTime) / 
            this.stats.totalTasksExecuted;
          
          resolve(result);
          return result;
        } catch (error) {
          this.stats.totalErrors++;
          reject(error);
          throw error;
        } finally {
          // Decrement active count
          this.lock.acquire('executor', () => {
            this.activeCount--;
            this.stats.currentActiveCount = this.activeCount;
            
            // Process next task if available
            this.processNextTask();
          });
        }
      };
      
      // Add task to queue
      this.taskQueue.push(wrappedTask);
      this.stats.currentQueueSize = this.taskQueue.length;
      
      // Update peak queue size
      if (this.taskQueue.length > this.stats.peakQueueSize) {
        this.stats.peakQueueSize = this.taskQueue.length;
      }
      
      // Process next task if concurrency limit not reached
      this.processNextTask();
    });
  }

  /**
   * Process the next task in the queue
   */
  private processNextTask(): void {
    this.lock.acquire('executor', () => {
      // Check if we can execute more tasks
      if (this.activeCount < this.concurrencyLimit && this.taskQueue.length > 0 && !this.paused) {
        // Get next task
        const nextTask = this.taskQueue.shift()!;
        this.stats.currentQueueSize = this.taskQueue.length;
        
        // Increment active count
        this.activeCount++;
        this.stats.currentActiveCount = this.activeCount;
        
        // Update peak active count
        if (this.activeCount > this.stats.peakActiveCount) {
          this.stats.peakActiveCount = this.activeCount;
        }
        
        // Execute task
        setImmediate(() => nextTask());
      }
    });
  }

  /**
   * Execute multiple tasks with concurrency control
   * @param tasks Tasks to execute
   * @returns Results of the tasks
   */
  async executeAll<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
    if (!tasks || tasks.length === 0) {
      return [];
    }
    
    // Execute all tasks
    return Promise.all(tasks.map(task => this.execute(task)));
  }

  /**
   * Get concurrent executor statistics
   * @returns Concurrent executor statistics
   */
  getStats(): ConcurrentExecutorStats {
    return { ...this.stats };
  }

  /**
   * Pause the executor
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * Resume the executor
   */
  resume(): void {
    this.paused = false;
    
    // Process next tasks
    for (let i = 0; i < this.concurrencyLimit; i++) {
      this.processNextTask();
    }
  }

  /**
   * Wait for all tasks to complete
   */
  async waitForCompletion(): Promise<void> {
    // Wait until all tasks are completed
    while (this.activeCount > 0 || this.taskQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Destroy the executor
   */
  destroy(): void {
    this.pause();
    this.taskQueue = [];
    this.stats.currentQueueSize = 0;
  }
}

/**
 * Concurrent executor configuration
 */
interface ConcurrentExecutorConfig {
  concurrencyLimit: number;
  memoryPool: MemoryPool | null;
}

/**
 * Concurrent executor statistics
 */
interface ConcurrentExecutorStats {
  totalTasksExecuted: number;
  totalTasksQueued: number;
  totalErrors: number;
  averageExecutionTimeMs: number;
  currentActiveCount: number;
  currentQueueSize: number;
  peakActiveCount: number;
  peakQueueSize: number;
  creationTime: number;
}

/**
 * Optimized Merkle Tree for Layer-2 on Solana
 * Provides efficient Merkle tree operations with caching
 */
export class OptimizedMerkleTree {
  private leaves: Buffer[];
  private layers: Buffer[][];
  private hashFunction: (left: Buffer, right: Buffer) => Buffer;
  private hashCache: Map<string, Buffer>;
  private memoryPool: MemoryPool | null;
  private dirty: boolean;
  private rootCache: Buffer | null;
  private maxCacheSize: number;
  private stats: MerkleTreeStats;

  /**
   * Constructor for OptimizedMerkleTree
   * @param leaves Initial leaves (optional)
   * @param hashFunction Hash function to use
   * @param config Merkle tree configuration
   */
  constructor(
    leaves: Buffer[] = [],
    hashFunction?: (left: Buffer, right: Buffer) => Buffer,
    config?: Partial<MerkleTreeConfig>
  ) {
    this.leaves = [...leaves];
    this.layers = [this.leaves];
    this.hashFunction = hashFunction || this.defaultHashFunction;
    this.hashCache = new Map();
    this.memoryPool = config?.memoryPool || null;
    this.dirty = true;
    this.rootCache = null;
    this.maxCacheSize = config?.maxCacheSize || 10000;
    
    // Initialize stats
    this.stats = {
      totalHashOperations: 0,
      cacheHits: 0,
      cacheMisses: 0,
      currentCacheSize: 0,
      peakCacheSize: 0,
      treeHeight: 0,
      leafCount: this.leaves.length,
      creationTime: Date.now()
    };
    
    // Build the tree if leaves are provided
    if (this.leaves.length > 0) {
      this.buildTree();
    }
  }

  /**
   * Default hash function (SHA-256)
   * @param left Left buffer
   * @param right Right buffer
   * @returns Hash of the concatenated buffers
   */
  private defaultHashFunction(left: Buffer, right: Buffer): Buffer {
    const combined = Buffer.concat([left, right]);
    return crypto.createHash('sha256').update(combined).digest();
  }

  /**
   * Add a leaf to the tree
   * @param leaf Leaf to add
   */
  addLeaf(leaf: Buffer): void {
    this.leaves.push(leaf);
    this.layers[0] = this.leaves;
    this.dirty = true;
    this.stats.leafCount = this.leaves.length;
  }

  /**
   * Add multiple leaves to the tree
   * @param leaves Leaves to add
   */
  addLeaves(leaves: Buffer[]): void {
    if (!leaves || leaves.length === 0) {
      return;
    }
    
    this.leaves.push(...leaves);
    this.layers[0] = this.leaves;
    this.dirty = true;
    this.stats.leafCount = this.leaves.length;
  }

  /**
   * Build the Merkle tree
   */
  private buildTree(): void {
    // Reset layers except leaves
    this.layers = [this.leaves];
    
    // Build the tree
    let currentLayer = this.leaves;
    
    while (currentLayer.length > 1) {
      const nextLayer: Buffer[] = [];
      
      for (let i = 0; i < currentLayer.length; i += 2) {
        if (i + 1 < currentLayer.length) {
          // Hash the pair
          const left = currentLayer[i];
          const right = currentLayer[i + 1];
          
          // Check cache first
          const cacheKey = this.getCacheKey(left, right);
          let hash: Buffer;
          
          if (this.hashCache.has(cacheKey)) {
            hash = this.hashCache.get(cacheKey)!;
            this.stats.cacheHits++;
          } else {
            hash = this.hashFunction(left, right);
            this.stats.cacheMisses++;
            this.stats.totalHashOperations++;
            
            // Add to cache if not full
            if (this.hashCache.size < this.maxCacheSize) {
              this.hashCache.set(cacheKey, hash);
              this.stats.currentCacheSize = this.hashCache.size;
              
              // Update peak cache size
              if (this.hashCache.size > this.stats.peakCacheSize) {
                this.stats.peakCacheSize = this.hashCache.size;
              }
            }
          }
          
          nextLayer.push(hash);
        } else {
          // Odd number of elements, promote the last one
          nextLayer.push(currentLayer[i]);
        }
      }
      
      this.layers.push(nextLayer);
      currentLayer = nextLayer;
    }
    
    // Cache the root
    this.rootCache = currentLayer.length > 0 ? currentLayer[0] : null;
    this.dirty = false;
    
    // Update stats
    this.stats.treeHeight = this.layers.length;
  }

  /**
   * Get the Merkle root
   * @returns Merkle root
   */
  getRoot(): Buffer | null {
    if (this.dirty) {
      this.buildTree();
    }
    
    return this.rootCache;
  }

  /**
   * Get the Merkle proof for a leaf
   * @param index Index of the leaf
   * @returns Merkle proof
   */
  getProof(index: number): Buffer[] {
    if (index < 0 || index >= this.leaves.length) {
      throw new Error('Leaf index out of range');
    }
    
    if (this.dirty) {
      this.buildTree();
    }
    
    const proof: Buffer[] = [];
    
    for (let i = 0; i < this.layers.length - 1; i++) {
      const layer = this.layers[i];
      const isRightNode = index % 2 === 0;
      const pairIndex = isRightNode ? index + 1 : index - 1;
      
      if (pairIndex < layer.length) {
        proof.push(layer[pairIndex]);
      }
      
      // Move to the next layer
      index = Math.floor(index / 2);
    }
    
    return proof;
  }

  /**
   * Verify a Merkle proof
   * @param leaf Leaf to verify
   * @param proof Merkle proof
   * @param root Merkle root
   * @returns Whether the proof is valid
   */
  verifyProof(leaf: Buffer, proof: Buffer[], root: Buffer): boolean {
    let currentHash = leaf;
    
    for (const proofElement of proof) {
      // Determine if the proof element is a left or right node
      const isRightNode = this.compareBuffers(currentHash, proofElement) < 0;
      
      // Hash the pair
      const left = isRightNode ? currentHash : proofElement;
      const right = isRightNode ? proofElement : currentHash;
      
      // Check cache first
      const cacheKey = this.getCacheKey(left, right);
      
      if (this.hashCache.has(cacheKey)) {
        currentHash = this.hashCache.get(cacheKey)!;
        this.stats.cacheHits++;
      } else {
        currentHash = this.hashFunction(left, right);
        this.stats.cacheMisses++;
        this.stats.totalHashOperations++;
        
        // Add to cache if not full
        if (this.hashCache.size < this.maxCacheSize) {
          this.hashCache.set(cacheKey, currentHash);
          this.stats.currentCacheSize = this.hashCache.size;
          
          // Update peak cache size
          if (this.hashCache.size > this.stats.peakCacheSize) {
            this.stats.peakCacheSize = this.hashCache.size;
          }
        }
      }
    }
    
    return this.compareBuffers(currentHash, root) === 0;
  }

  /**
   * Verify multiple Merkle proofs in batch
   * @param leaves Leaves to verify
   * @param proofs Merkle proofs
   * @param root Merkle root
   * @returns Whether all proofs are valid
   */
  verifyProofBatch(leaves: Buffer[], proofs: Buffer[][], root: Buffer): boolean {
    if (leaves.length !== proofs.length) {
      throw new Error('Number of leaves must match number of proofs');
    }
    
    for (let i = 0; i < leaves.length; i++) {
      if (!this.verifyProof(leaves[i], proofs[i], root)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Compare two buffers
   * @param a First buffer
   * @param b Second buffer
   * @returns Comparison result (-1, 0, or 1)
   */
  private compareBuffers(a: Buffer, b: Buffer): number {
    const length = Math.min(a.length, b.length);
    
    for (let i = 0; i < length; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    
    if (a.length < b.length) return -1;
    if (a.length > b.length) return 1;
    
    return 0;
  }

  /**
   * Get a cache key for a pair of buffers
   * @param left Left buffer
   * @param right Right buffer
   * @returns Cache key
   */
  private getCacheKey(left: Buffer, right: Buffer): string {
    return `${left.toString('hex')}:${right.toString('hex')}`;
  }

  /**
   * Clear the hash cache
   */
  clearCache(): void {
    this.hashCache.clear();
    this.stats.currentCacheSize = 0;
  }

  /**
   * Get Merkle tree statistics
   * @returns Merkle tree statistics
   */
  getStats(): MerkleTreeStats {
    return { ...this.stats };
  }

  /**
   * Destroy the Merkle tree
   */
  destroy(): void {
    this.leaves = [];
    this.layers = [[]];
    this.hashCache.clear();
    this.dirty = true;
    this.rootCache = null;
    this.stats.leafCount = 0;
    this.stats.currentCacheSize = 0;
  }
}

/**
 * Merkle tree configuration
 */
interface MerkleTreeConfig {
  maxCacheSize: number;
  memoryPool: MemoryPool | null;
}

/**
 * Merkle tree statistics
 */
interface MerkleTreeStats {
  totalHashOperations: number;
  cacheHits: number;
  cacheMisses: number;
  currentCacheSize: number;
  peakCacheSize: number;
  treeHeight: number;
  leafCount: number;
  creationTime: number;
}

export { MemoryPool, BatchProcessor, ConcurrentExecutor, OptimizedMerkleTree };
