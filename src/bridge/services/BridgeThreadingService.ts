// English comment for verification
/**
 * @file BridgeThreadingService.ts
 * @description Service for implementing multi-threading capabilities for the bridge between Ethereum and Solana
 * 
 * This service provides advanced multi-threading capabilities for the bridge operations,
 * including worker pools, task queues, and parallel processing of transactions.
 */

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import * as path from 'path';
import * as os from 'os';
import { Logger } from '../utils/Logger';
import { MetricsCollector } from '../utils/MetricsCollector';
import { Cache } from '../utils/Cache';
import { BridgeTransaction, TransactionStatus, TransactionType } from '../models/BridgeTransaction';
import { Repository } from 'typeorm';
import { EventEmitter } from 'events';

/**
 * Configuration for the bridge threading service
 */
export interface BridgeThreadingConfig {
    /**
     * Minimum number of worker threads
     */
    minWorkers?: number;
    
    /**
     * Maximum number of worker threads
     */
    maxWorkers?: number;
    
    /**
     * Whether to enable auto-scaling of worker threads
     */
    enableAutoScaling?: boolean;
    
    /**
     * Auto-scaling interval in milliseconds
     */
    autoScalingInterval?: number;
    
    /**
     * CPU usage threshold for scaling up (percentage)
     */
    cpuThresholdScaleUp?: number;
    
    /**
     * CPU usage threshold for scaling down (percentage)
     */
    cpuThresholdScaleDown?: number;
    
    /**
     * Worker idle timeout in milliseconds
     */
    workerIdleTimeout?: number;
    
    /**
     * Maximum number of tasks in queue before blocking
     */
    maxQueueSize?: number;
    
    /**
     * Task timeout in milliseconds
     */
    taskTimeout?: number;
    
    /**
     * Maximum number of retries for failed tasks
     */
    maxTaskRetries?: number;
    
    /**
     * Retry delay in milliseconds
     */
    retryDelay?: number;
    
    /**
     * Whether to enable worker affinity
     */
    enableWorkerAffinity?: boolean;
    
    /**
     * Worker script path
     */
    workerScriptPath?: string;
}

/**
 * Task priority levels
 */
export enum TaskPriority {
    LOW = 0,
    NORMAL = 1,
    HIGH = 2,
    CRITICAL = 3
}

/**
 * Task status
 */
export enum TaskStatus {
    QUEUED = 'queued',
    RUNNING = 'running',
    COMPLETED = 'completed',
    FAILED = 'failed',
    RETRYING = 'retrying',
    CANCELLED = 'cancelled',
    TIMEOUT = 'timeout'
}

/**
 * Task type
 */
export enum TaskType {
    DEPOSIT_PROCESSING = 'deposit_processing',
    WITHDRAWAL_PROCESSING = 'withdrawal_processing',
    BLOCK_FINALIZATION = 'block_finalization',
    TRANSACTION_VERIFICATION = 'transaction_verification',
    SIGNATURE_VERIFICATION = 'signature_verification',
    METRICS_COLLECTION = 'metrics_collection',
    CACHE_CLEANUP = 'cache_cleanup',
    DATABASE_MAINTENANCE = 'database_maintenance'
}

/**
 * Task definition
 */
export interface Task {
    /**
     * Task ID
     */
    id: string;
    
    /**
     * Task type
     */
    type: TaskType;
    
    /**
     * Task priority
     */
    priority: TaskPriority;
    
    /**
     * Task data
     */
    data: any;
    
    /**
     * Task status
     */
    status: TaskStatus;
    
    /**
     * Task creation timestamp
     */
    createdAt: number;
    
    /**
     * Task start timestamp
     */
    startedAt?: number;
    
    /**
     * Task completion timestamp
     */
    completedAt?: number;
    
    /**
     * Task worker ID
     */
    workerId?: number;
    
    /**
     * Task result
     */
    result?: any;
    
    /**
     * Task error
     */
    error?: any;
    
    /**
     * Number of retries
     */
    retries?: number;
    
    /**
     * Maximum number of retries
     */
    maxRetries?: number;
    
    /**
     * Retry delay in milliseconds
     */
    retryDelay?: number;
    
    /**
     * Task timeout in milliseconds
     */
    timeout?: number;
    
    /**
     * Task timeout ID
     */
    timeoutId?: NodeJS.Timeout;
    
    /**
     * Task callback
     */
    callback?: (error: Error | null, result?: any) => void;
}

/**
 * Worker status
 */
export enum WorkerStatus {
    IDLE = 'idle',
    BUSY = 'busy',
    STARTING = 'starting',
    STOPPING = 'stopping',
    CRASHED = 'crashed'
}

/**
 * Worker definition
 */
export interface WorkerInfo {
    /**
     * Worker ID
     */
    id: number;
    
    /**
     * Worker instance
     */
    worker: Worker;
    
    /**
     * Worker status
     */
    status: WorkerStatus;
    
    /**
     * Current task ID
     */
    currentTaskId?: string;
    
    /**
     * Worker creation timestamp
     */
    createdAt: number;
    
    /**
     * Last activity timestamp
     */
    lastActivityAt: number;
    
    /**
     * Number of tasks processed
     */
    tasksProcessed: number;
    
    /**
     * Number of tasks failed
     */
    tasksFailed: number;
    
    /**
     * Worker affinity (task types this worker is specialized for)
     */
    affinity?: TaskType[];
    
    /**
     * CPU usage (percentage)
     */
    cpuUsage?: number;
    
    /**
     * Memory usage (bytes)
     */
    memoryUsage?: number;
}

/**
 * Worker message types
 */
export enum WorkerMessageType {
    TASK_RESULT = 'task_result',
    TASK_ERROR = 'task_error',
    WORKER_READY = 'worker_ready',
    WORKER_BUSY = 'worker_busy',
    WORKER_IDLE = 'worker_idle',
    WORKER_ERROR = 'worker_error',
    WORKER_METRICS = 'worker_metrics'
}

/**
 * Worker message
 */
export interface WorkerMessage {
    /**
     * Message type
     */
    type: WorkerMessageType;
    
    /**
     * Worker ID
     */
    workerId: number;
    
    /**
     * Task ID
     */
    taskId?: string;
    
    /**
     * Task result
     */
    result?: any;
    
    /**
     * Task error
     */
    error?: any;
    
    /**
     * Worker metrics
     */
    metrics?: {
        /**
         * CPU usage (percentage)
         */
        cpuUsage: number;
        
        /**
         * Memory usage (bytes)
         */
        memoryUsage: number;
        
        /**
         * Tasks processed
         */
        tasksProcessed: number;
        
        /**
         * Tasks failed
         */
        tasksFailed: number;
    };
}

/**
 * Bridge threading service class
 */
export class BridgeThreadingService extends EventEmitter {
    private config: BridgeThreadingConfig;
    private logger: Logger;
    private metrics: MetricsCollector;
    private cache: Cache;
    private bridgeTransactionRepository: Repository<BridgeTransaction>;
    
    private isRunning: boolean = false;
    private workers: Map<number, WorkerInfo> = new Map();
    private taskQueue: Task[] = [];
    private tasks: Map<string, Task> = new Map();
    private autoScalingInterval: NodeJS.Timeout | null = null;
    private workerIdCounter: number = 0;
    
    /**
     * Creates a new instance of the bridge threading service
     * @param config Bridge threading configuration
     * @param logger Logger instance
     * @param metrics Metrics collector instance
     * @param cache Cache instance
     * @param bridgeTransactionRepository Bridge transaction repository
     */
    constructor(
        config: BridgeThreadingConfig,
        logger: Logger,
        metrics: MetricsCollector,
        cache: Cache,
        bridgeTransactionRepository: Repository<BridgeTransaction>
    ) {
        super();
        
        this.config = {
            ...config,
            minWorkers: config.minWorkers || Math.max(1, Math.floor(os.cpus().length / 2)),
            maxWorkers: config.maxWorkers || os.cpus().length,
            enableAutoScaling: config.enableAutoScaling !== false,
            autoScalingInterval: config.autoScalingInterval || 60000, // 1 minute
            cpuThresholdScaleUp: config.cpuThresholdScaleUp || 70, // 70%
            cpuThresholdScaleDown: config.cpuThresholdScaleDown || 30, // 30%
            workerIdleTimeout: config.workerIdleTimeout || 300000, // 5 minutes
            maxQueueSize: config.maxQueueSize || 1000,
            taskTimeout: config.taskTimeout || 60000, // 1 minute
            maxTaskRetries: config.maxTaskRetries || 3,
            retryDelay: config.retryDelay || 5000, // 5 seconds
            enableWorkerAffinity: config.enableWorkerAffinity !== false,
            workerScriptPath: config.workerScriptPath || path.join(__dirname, 'bridge.worker.js')
        };
        
        this.logger = logger;
        this.metrics = metrics;
        this.cache = cache;
        this.bridgeTransactionRepository = bridgeTransactionRepository;
    }
    
    /**
     * Initializes the bridge threading service
     */
    public async initialize(): Promise<void> {
        this.logger.info('Initializing bridge threading service...');
        
        try {
            // Create worker script if it doesn't exist
            await this.createWorkerScript();
            
            this.logger.info('Bridge threading service initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize bridge threading service', error);
            throw error;
        }
    }
    
    /**
     * Creates the worker script file
     */
    private async createWorkerScript(): Promise<void> {
        const fs = require('fs').promises;
        const workerScriptPath = this.config.workerScriptPath;
        
        try {
            // Check if worker script already exists
            try {
                await fs.access(workerScriptPath);
                this.logger.debug(`Worker script already exists: ${workerScriptPath}`);
                return;
            } catch (error) {
                // File doesn't exist, continue
            }
            
            // Create directory if it doesn't exist
            const directory = path.dirname(workerScriptPath);
            await fs.mkdir(directory, { recursive: true });
            
            // Create worker script
            const workerScript = `
const { parentPort, workerData, threadId } = require('worker_threads');
const os = require('os');

// Initialize worker
const workerId = workerData.workerId;
let tasksProcessed = 0;
let tasksFailed = 0;
let currentTaskId = null;

// Send ready message
parentPort.postMessage({
    type: 'worker_ready',
    workerId
});

// Process messages from main thread
parentPort.on('message', async (message) => {
    if (message.type === 'task') {
        const task = message.task;
        currentTaskId = task.id;
        
        // Send busy message
        parentPort.postMessage({
            type: 'worker_busy',
            workerId,
            taskId: task.id
        });
        
        try {
            // Process task
            const result = await processTask(task);
            
            // Send result
            parentPort.postMessage({
                type: 'task_result',
                workerId,
                taskId: task.id,
                result
            });
            
            tasksProcessed++;
        } catch (error) {
            // Send error
            parentPort.postMessage({
                type: 'task_error',
                workerId,
                taskId: task.id,
                error: {
                    message: error.message,
                    stack: error.stack
                }
            });
            
            tasksFailed++;
        }
        
        currentTaskId = null;
        
        // Send idle message
        parentPort.postMessage({
            type: 'worker_idle',
            workerId
        });
        
        // Send metrics
        sendMetrics();
    } else if (message.type === 'get_metrics') {
        sendMetrics();
    } else if (message.type === 'terminate') {
        process.exit(0);
    }
});

/**
 * Processes a task
 * @param task Task to process
 * @returns Task result
 */
async function processTask(task) {
    // This is a simplified implementation
    // In a real-world scenario, you would implement different task processors
    
    switch (task.type) {
        case 'deposit_processing':
            return processDepositTask(task);
        case 'withdrawal_processing':
            return processWithdrawalTask(task);
        case 'block_finalization':
            return processBlockFinalizationTask(task);
        case 'transaction_verification':
            return processTransactionVerificationTask(task);
        case 'signature_verification':
            return processSignatureVerificationTask(task);
        case 'metrics_collection':
            return processMetricsCollectionTask(task);
        case 'cache_cleanup':
            return processCacheCleanupTask(task);
        case 'database_maintenance':
            return processDatabaseMaintenanceTask(task);
        default:
            throw new Error(\`Unknown task type: \${task.type}\`);
    }
}

/**
 * Processes a deposit task
 * @param task Deposit task
 * @returns Task result
 */
async function processDepositTask(task) {
    // Simulate processing time
    await sleep(Math.random() * 1000);
    
    return {
        success: true,
        processedAt: Date.now(),
        workerId,
        taskType: task.type,
        data: task.data
    };
}

/**
 * Processes a withdrawal task
 * @param task Withdrawal task
 * @returns Task result
 */
async function processWithdrawalTask(task) {
    // Simulate processing time
    await sleep(Math.random() * 1000);
    
    return {
        success: true,
        processedAt: Date.now(),
        workerId,
        taskType: task.type,
        data: task.data
    };
}

/**
 * Processes a block finalization task
 * @param task Block finalization task
 * @returns Task result
 */
async function processBlockFinalizationTask(task) {
    // Simulate processing time
    await sleep(Math.random() * 1000);
    
    return {
        success: true,
        processedAt: Date.now(),
        workerId,
        taskType: task.type,
        data: task.data
    };
}

/**
 * Processes a transaction verification task
 * @param task Transaction verification task
 * @returns Task result
 */
async function processTransactionVerificationTask(task) {
    // Simulate processing time
    await sleep(Math.random() * 500);
    
    return {
        success: true,
        processedAt: Date.now(),
        workerId,
        taskType: task.type,
        data: task.data
    };
}

/**
 * Processes a signature verification task
 * @param task Signature verification task
 * @returns Task result
 */
async function processSignatureVerificationTask(task) {
    // Simulate processing time
    await sleep(Math.random() * 300);
    
    return {
        success: true,
        processedAt: Date.now(),
        workerId,
        taskType: task.type,
        data: task.data
    };
}

/**
 * Processes a metrics collection task
 * @param task Metrics collection task
 * @returns Task result
 */
async function processMetricsCollectionTask(task) {
    // Simulate processing time
    await sleep(Math.random() * 200);
    
    return {
        success: true,
        processedAt: Date.now(),
        workerId,
        taskType: task.type,
        data: task.data
    };
}

/**
 * Processes a cache cleanup task
 * @param task Cache cleanup task
 * @returns Task result
 */
async function processCacheCleanupTask(task) {
    // Simulate processing time
    await sleep(Math.random() * 500);
    
    return {
        success: true,
        processedAt: Date.now(),
        workerId,
        taskType: task.type,
        data: task.data
    };
}

/**
 * Processes a database maintenance task
 * @param task Database maintenance task
 * @returns Task result
 */
async function processDatabaseMaintenanceTask(task) {
    // Simulate processing time
    await sleep(Math.random() * 1000);
    
    return {
        success: true,
        processedAt: Date.now(),
        workerId,
        taskType: task.type,
        data: task.data
    };
}

/**
 * Sleeps for a specified number of milliseconds
 * @param ms Milliseconds to sleep
 * @returns Promise that resolves after the specified time
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sends worker metrics to the main thread
 */
function sendMetrics() {
    const cpuUsage = process.cpuUsage();
    const memoryUsage = process.memoryUsage();
    
    parentPort.postMessage({
        type: 'worker_metrics',
        workerId,
        metrics: {
            cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000, // Convert to percentage
            memoryUsage: memoryUsage.rss,
            tasksProcessed,
            tasksFailed
        }
    });
}

// Handle errors
process.on('uncaughtException', (error) => {
    parentPort.postMessage({
        type: 'worker_error',
        workerId,
        error: {
            message: error.message,
            stack: error.stack
        }
    });
});
            `;
            
            await fs.writeFile(workerScriptPath, workerScript);
            this.logger.info(`Created worker script: ${workerScriptPath}`);
        } catch (error) {
            this.logger.error('Failed to create worker script', error);
            throw error;
        }
    }
    
    /**
     * Starts the bridge threading service
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            this.logger.warn('Bridge threading service already running');
            return;
        }
        
        this.logger.info('Starting bridge threading service...');
        
        try {
            this.isRunning = true;
            
            // Start initial workers
            await this.startWorkers(this.config.minWorkers);
            
            // Start auto-scaling if enabled
            if (this.config.enableAutoScaling) {
                this.autoScalingInterval = setInterval(() => {
                    this.autoScaleWorkers();
                }, this.config.autoScalingInterval);
            }
            
            this.logger.info(`Bridge threading service started with ${this.workers.size} workers`);
        } catch (error) {
            this.isRunning = false;
            this.logger.error('Failed to start bridge threading service', error);
            throw error;
        }
    }
    
    /**
     * Stops the bridge threading service
     */
    public async stop(): Promise<void> {
        if (!this.isRunning) {
            this.logger.warn('Bridge threading service not running');
            return;
        }
        
        this.logger.info('Stopping bridge threading service...');
        
        try {
            this.isRunning = false;
            
            // Stop auto-scaling
            if (this.autoScalingInterval) {
                clearInterval(this.autoScalingInterval);
                this.autoScalingInterval = null;
            }
            
            // Stop all workers
            await this.stopAllWorkers();
            
            // Clear task queue
            this.taskQueue = [];
            this.tasks.clear();
            
            this.logger.info('Bridge threading service stopped');
        } catch (error) {
            this.logger.error('Failed to stop bridge threading service', error);
            throw error;
        }
    }
    
    /**
     * Starts a specified number of worker threads
     * @param count Number of workers to start
     */
    private async startWorkers(count: number): Promise<void> {
        this.logger.info(`Starting ${count} worker threads...`);
        
        const startPromises = [];
        
        for (let i = 0; i < count; i++) {
            startPromises.push(this.startWorker());
        }
        
        await Promise.all(startPromises);
        
        this.logger.info(`Started ${count} worker threads`);
    }
    
    /**
     * Starts a single worker thread
     * @returns Worker ID
     */
    private async startWorker(): Promise<number> {
        return new Promise((resolve, reject) => {
            try {
                const workerId = ++this.workerIdCounter;
                
                this.logger.debug(`Starting worker thread ${workerId}...`);
                
                // Create worker
                const worker = new Worker(this.config.workerScriptPath, {
                    workerData: { workerId }
                });
                
                // Create worker info
                const workerInfo: WorkerInfo = {
                    id: workerId,
                    worker,
                    status: WorkerStatus.STARTING,
                    createdAt: Date.now(),
                    lastActivityAt: Date.now(),
                    tasksProcessed: 0,
                    tasksFailed: 0
                };
                
                // Add worker to map
                this.workers.set(workerId, workerInfo);
                
                // Handle worker messages
                worker.on('message', (message: WorkerMessage) => {
                    this.handleWorkerMessage(message);
                });
                
                // Handle worker error
                worker.on('error', (error) => {
                    this.logger.error(`Worker ${workerId} error:`, error);
                    
                    // Update worker status
                    const workerInfo = this.workers.get(workerId);
                    
                    if (workerInfo) {
                        workerInfo.status = WorkerStatus.CRASHED;
                        
                        // Handle current task if any
                        if (workerInfo.currentTaskId) {
                            const task = this.tasks.get(workerInfo.currentTaskId);
                            
                            if (task) {
                                this.handleTaskError(task, new Error(`Worker crashed: ${error.message}`));
                            }
                        }
                    }
                    
                    // Remove worker
                    this.workers.delete(workerId);
                    
                    // Start a new worker if service is still running
                    if (this.isRunning) {
                        this.startWorker().catch(error => {
                            this.logger.error('Failed to start replacement worker', error);
                        });
                    }
                });
                
                // Handle worker exit
                worker.on('exit', (code) => {
                    this.logger.debug(`Worker ${workerId} exited with code ${code}`);
                    
                    // Remove worker
                    this.workers.delete(workerId);
                    
                    // Start a new worker if service is still running and exit was unexpected
                    if (this.isRunning && code !== 0) {
                        this.startWorker().catch(error => {
                            this.logger.error('Failed to start replacement worker', error);
                        });
                    }
                });
                
                // Update metrics
                this.metrics.gauge('threading.workers.total', this.workers.size);
                
                resolve(workerId);
            } catch (error) {
                reject(error);
            }
        });
    }
    
    /**
     * Stops all worker threads
     */
    private async stopAllWorkers(): Promise<void> {
        this.logger.info(`Stopping ${this.workers.size} worker threads...`);
        
        const stopPromises = [];
        
        for (const workerId of this.workers.keys()) {
            stopPromises.push(this.stopWorker(workerId));
        }
        
        await Promise.all(stopPromises);
        
        this.logger.info('All worker threads stopped');
    }
    
    /**
     * Stops a single worker thread
     * @param workerId Worker ID
     */
    private async stopWorker(workerId: number): Promise<void> {
        return new Promise((resolve) => {
            const workerInfo = this.workers.get(workerId);
            
            if (!workerInfo) {
                this.logger.warn(`Worker ${workerId} not found`);
                resolve();
                return;
            }
            
            this.logger.debug(`Stopping worker ${workerId}...`);
            
            // Update worker status
            workerInfo.status = WorkerStatus.STOPPING;
            
            // Send terminate message
            workerInfo.worker.postMessage({ type: 'terminate' });
            
            // Set timeout to force terminate
            const terminateTimeout = setTimeout(() => {
                this.logger.warn(`Worker ${workerId} did not exit gracefully, terminating...`);
                workerInfo.worker.terminate();
            }, 5000);
            
            // Handle worker exit
            workerInfo.worker.once('exit', () => {
                clearTimeout(terminateTimeout);
                this.workers.delete(workerId);
                this.metrics.gauge('threading.workers.total', this.workers.size);
                resolve();
            });
        });
    }
    
    /**
     * Handles a message from a worker thread
     * @param message Worker message
     */
    private handleWorkerMessage(message: WorkerMessage): void {
        const workerId = message.workerId;
        const workerInfo = this.workers.get(workerId);
        
        if (!workerInfo) {
            this.logger.warn(`Received message from unknown worker ${workerId}`);
            return;
        }
        
        // Update last activity timestamp
        workerInfo.lastActivityAt = Date.now();
        
        switch (message.type) {
            case WorkerMessageType.WORKER_READY:
                this.handleWorkerReady(workerInfo);
                break;
                
            case WorkerMessageType.WORKER_BUSY:
                this.handleWorkerBusy(workerInfo, message.taskId);
                break;
                
            case WorkerMessageType.WORKER_IDLE:
                this.handleWorkerIdle(workerInfo);
                break;
                
            case WorkerMessageType.WORKER_ERROR:
                this.handleWorkerError(workerInfo, message.error);
                break;
                
            case WorkerMessageType.WORKER_METRICS:
                this.handleWorkerMetrics(workerInfo, message.metrics);
                break;
                
            case WorkerMessageType.TASK_RESULT:
                this.handleTaskResult(message.taskId, message.result);
                break;
                
            case WorkerMessageType.TASK_ERROR:
                this.handleTaskError(this.tasks.get(message.taskId), message.error);
                break;
                
            default:
                this.logger.warn(`Unknown message type from worker ${workerId}: ${message.type}`);
        }
    }
    
    /**
     * Handles a worker ready message
     * @param workerInfo Worker info
     */
    private handleWorkerReady(workerInfo: WorkerInfo): void {
        this.logger.debug(`Worker ${workerInfo.id} is ready`);
        
        // Update worker status
        workerInfo.status = WorkerStatus.IDLE;
        
        // Update metrics
        this.metrics.gauge('threading.workers.idle', Array.from(this.workers.values()).filter(w => w.status === WorkerStatus.IDLE).length);
        
        // Assign task if available
        this.assignTaskToWorker(workerInfo);
    }
    
    /**
     * Handles a worker busy message
     * @param workerInfo Worker info
     * @param taskId Task ID
     */
    private handleWorkerBusy(workerInfo: WorkerInfo, taskId: string): void {
        this.logger.debug(`Worker ${workerInfo.id} is busy with task ${taskId}`);
        
        // Update worker status
        workerInfo.status = WorkerStatus.BUSY;
        workerInfo.currentTaskId = taskId;
        
        // Update metrics
        this.metrics.gauge('threading.workers.busy', Array.from(this.workers.values()).filter(w => w.status === WorkerStatus.BUSY).length);
        
        // Update task status
        const task = this.tasks.get(taskId);
        
        if (task) {
            task.status = TaskStatus.RUNNING;
            task.startedAt = Date.now();
            task.workerId = workerInfo.id;
            
            // Set task timeout
            if (task.timeout > 0) {
                task.timeoutId = setTimeout(() => {
                    this.handleTaskTimeout(task);
                }, task.timeout);
            }
        }
    }
    
    /**
     * Handles a worker idle message
     * @param workerInfo Worker info
     */
    private handleWorkerIdle(workerInfo: WorkerInfo): void {
        this.logger.debug(`Worker ${workerInfo.id} is idle`);
        
        // Update worker status
        workerInfo.status = WorkerStatus.IDLE;
        workerInfo.currentTaskId = undefined;
        
        // Update metrics
        this.metrics.gauge('threading.workers.idle', Array.from(this.workers.values()).filter(w => w.status === WorkerStatus.IDLE).length);
        
        // Assign task if available
        this.assignTaskToWorker(workerInfo);
    }
    
    /**
     * Handles a worker error message
     * @param workerInfo Worker info
     * @param error Error
     */
    private handleWorkerError(workerInfo: WorkerInfo, error: any): void {
        this.logger.error(`Worker ${workerInfo.id} error:`, error);
        
        // Update worker status
        workerInfo.status = WorkerStatus.CRASHED;
        workerInfo.tasksFailed++;
        
        // Handle current task if any
        if (workerInfo.currentTaskId) {
            const task = this.tasks.get(workerInfo.currentTaskId);
            
            if (task) {
                this.handleTaskError(task, new Error(`Worker error: ${error.message}`));
            }
        }
        
        // Restart worker
        this.stopWorker(workerInfo.id).then(() => {
            if (this.isRunning) {
                this.startWorker().catch(error => {
                    this.logger.error('Failed to restart worker', error);
                });
            }
        }).catch(error => {
            this.logger.error('Failed to stop worker', error);
        });
    }
    
    /**
     * Handles a worker metrics message
     * @param workerInfo Worker info
     * @param metrics Worker metrics
     */
    private handleWorkerMetrics(workerInfo: WorkerInfo, metrics: any): void {
        // Update worker metrics
        workerInfo.cpuUsage = metrics.cpuUsage;
        workerInfo.memoryUsage = metrics.memoryUsage;
        workerInfo.tasksProcessed = metrics.tasksProcessed;
        workerInfo.tasksFailed = metrics.tasksFailed;
        
        // Update metrics
        this.metrics.gauge(`threading.worker.${workerInfo.id}.cpu_usage`, workerInfo.cpuUsage);
        this.metrics.gauge(`threading.worker.${workerInfo.id}.memory_usage`, workerInfo.memoryUsage);
        this.metrics.gauge(`threading.worker.${workerInfo.id}.tasks_processed`, workerInfo.tasksProcessed);
        this.metrics.gauge(`threading.worker.${workerInfo.id}.tasks_failed`, workerInfo.tasksFailed);
    }
    
    /**
     * Handles a task result message
     * @param taskId Task ID
     * @param result Task result
     */
    private handleTaskResult(taskId: string, result: any): void {
        const task = this.tasks.get(taskId);
        
        if (!task) {
            this.logger.warn(`Task ${taskId} not found for result`);
            return;
        }
        
        this.logger.debug(`Task ${taskId} completed successfully`);
        
        // Clear task timeout
        if (task.timeoutId) {
            clearTimeout(task.timeoutId);
            task.timeoutId = undefined;
        }
        
        // Update task status
        task.status = TaskStatus.COMPLETED;
        task.completedAt = Date.now();
        task.result = result;
        
        // Call task callback
        if (task.callback) {
            try {
                task.callback(null, result);
            } catch (error) {
                this.logger.error(`Error in task ${taskId} callback:`, error);
            }
        }
        
        // Emit task completed event
        this.emit('taskCompleted', task);
        
        // Update metrics
        this.metrics.increment(`threading.tasks.completed.${task.type}`);
        this.metrics.gauge('threading.tasks.active', this.tasks.size);
        this.metrics.histogram('threading.tasks.duration', task.completedAt - task.startedAt);
        
        // Remove task from map
        this.tasks.delete(taskId);
    }
    
    /**
     * Handles a task error message
     * @param task Task
     * @param error Error
     */
    private handleTaskError(task: Task, error: any): void {
        if (!task) {
            this.logger.warn('Task not found for error');
            return;
        }
        
        this.logger.error(`Task ${task.id} failed:`, error);
        
        // Clear task timeout
        if (task.timeoutId) {
            clearTimeout(task.timeoutId);
            task.timeoutId = undefined;
        }
        
        // Update task status
        task.status = TaskStatus.FAILED;
        task.completedAt = Date.now();
        task.error = error;
        
        // Increment retry count
        task.retries = (task.retries || 0) + 1;
        
        // Check if task should be retried
        if (task.retries < task.maxRetries) {
            this.logger.debug(`Retrying task ${task.id} (${task.retries}/${task.maxRetries})`);
            
            // Update task status
            task.status = TaskStatus.RETRYING;
            
            // Schedule retry
            setTimeout(() => {
                // Reset task status
                task.status = TaskStatus.QUEUED;
                task.startedAt = undefined;
                task.completedAt = undefined;
                task.workerId = undefined;
                task.result = undefined;
                task.error = undefined;
                
                // Add task to queue
                this.addTaskToQueue(task);
            }, task.retryDelay);
            
            // Update metrics
            this.metrics.increment(`threading.tasks.retried.${task.type}`);
        } else {
            // Call task callback with error
            if (task.callback) {
                try {
                    task.callback(error);
                } catch (callbackError) {
                    this.logger.error(`Error in task ${task.id} error callback:`, callbackError);
                }
            }
            
            // Emit task failed event
            this.emit('taskFailed', task, error);
            
            // Update metrics
            this.metrics.increment(`threading.tasks.failed.${task.type}`);
            this.metrics.gauge('threading.tasks.active', this.tasks.size);
            
            // Remove task from map
            this.tasks.delete(task.id);
        }
    }
    
    /**
     * Handles a task timeout
     * @param task Task
     */
    private handleTaskTimeout(task: Task): void {
        this.logger.warn(`Task ${task.id} timed out after ${task.timeout}ms`);
        
        // Update task status
        task.status = TaskStatus.TIMEOUT;
        task.completedAt = Date.now();
        task.error = new Error(`Task timed out after ${task.timeout}ms`);
        
        // Call task callback with error
        if (task.callback) {
            try {
                task.callback(task.error);
            } catch (error) {
                this.logger.error(`Error in task ${task.id} timeout callback:`, error);
            }
        }
        
        // Emit task failed event
        this.emit('taskFailed', task, task.error);
        
        // Update metrics
        this.metrics.increment(`threading.tasks.timeout.${task.type}`);
        this.metrics.gauge('threading.tasks.active', this.tasks.size);
        
        // Remove task from map
        this.tasks.delete(task.id);
        
        // Check if worker is still busy with this task
        if (task.workerId) {
            const workerInfo = this.workers.get(task.workerId);
            
            if (workerInfo && workerInfo.currentTaskId === task.id) {
                // Worker is still busy with this task, restart it
                this.logger.warn(`Restarting worker ${workerInfo.id} due to task timeout`);
                
                this.stopWorker(workerInfo.id).then(() => {
                    if (this.isRunning) {
                        this.startWorker().catch(error => {
                            this.logger.error('Failed to restart worker', error);
                        });
                    }
                }).catch(error => {
                    this.logger.error('Failed to stop worker', error);
                });
            }
        }
    }
    
    /**
     * Auto-scales worker threads based on load
     */
    private autoScaleWorkers(): void {
        if (!this.isRunning || !this.config.enableAutoScaling) {
            return;
        }
        
        try {
            // Calculate average CPU usage
            let totalCpuUsage = 0;
            let workerCount = 0;
            
            for (const workerInfo of this.workers.values()) {
                if (workerInfo.cpuUsage !== undefined) {
                    totalCpuUsage += workerInfo.cpuUsage;
                    workerCount++;
                }
            }
            
            const avgCpuUsage = workerCount > 0 ? totalCpuUsage / workerCount : 0;
            
            // Calculate queue pressure
            const queuePressure = this.taskQueue.length / this.config.maxQueueSize;
            
            // Calculate idle workers ratio
            const idleWorkers = Array.from(this.workers.values()).filter(w => w.status === WorkerStatus.IDLE).length;
            const idleRatio = this.workers.size > 0 ? idleWorkers / this.workers.size : 0;
            
            this.logger.debug(`Auto-scaling: CPU=${avgCpuUsage.toFixed(2)}%, Queue=${queuePressure.toFixed(2)}, Idle=${idleRatio.toFixed(2)}`);
            
            // Update metrics
            this.metrics.gauge('threading.auto_scaling.cpu_usage', avgCpuUsage);
            this.metrics.gauge('threading.auto_scaling.queue_pressure', queuePressure);
            this.metrics.gauge('threading.auto_scaling.idle_ratio', idleRatio);
            
            // Scale up if CPU usage is high or queue pressure is high
            if (
                (avgCpuUsage > this.config.cpuThresholdScaleUp || queuePressure > 0.7) &&
                this.workers.size < this.config.maxWorkers
            ) {
                const workersToAdd = Math.min(
                    Math.ceil(this.workers.size * 0.2), // Add up to 20% more workers
                    this.config.maxWorkers - this.workers.size // Don't exceed max workers
                );
                
                if (workersToAdd > 0) {
                    this.logger.info(`Auto-scaling: Adding ${workersToAdd} workers due to high load`);
                    this.startWorkers(workersToAdd).catch(error => {
                        this.logger.error('Failed to start workers during auto-scaling', error);
                    });
                }
            }
            // Scale down if CPU usage is low and queue pressure is low
            else if (
                avgCpuUsage < this.config.cpuThresholdScaleDown &&
                queuePressure < 0.3 &&
                idleRatio > 0.5 &&
                this.workers.size > this.config.minWorkers
            ) {
                const workersToRemove = Math.min(
                    Math.ceil(this.workers.size * 0.1), // Remove up to 10% of workers
                    this.workers.size - this.config.minWorkers // Don't go below min workers
                );
                
                if (workersToRemove > 0) {
                    this.logger.info(`Auto-scaling: Removing ${workersToRemove} workers due to low load`);
                    
                    // Find idle workers to remove
                    const idleWorkerIds = Array.from(this.workers.values())
                        .filter(w => w.status === WorkerStatus.IDLE)
                        .sort((a, b) => a.lastActivityAt - b.lastActivityAt) // Remove oldest idle workers first
                        .slice(0, workersToRemove)
                        .map(w => w.id);
                    
                    // Stop idle workers
                    for (const workerId of idleWorkerIds) {
                        this.stopWorker(workerId).catch(error => {
                            this.logger.error(`Failed to stop worker ${workerId} during auto-scaling`, error);
                        });
                    }
                }
            }
            
            // Check for idle workers that have been inactive for too long
            const now = Date.now();
            const idleTimeout = this.config.workerIdleTimeout;
            
            for (const workerInfo of this.workers.values()) {
                if (
                    workerInfo.status === WorkerStatus.IDLE &&
                    now - workerInfo.lastActivityAt > idleTimeout &&
                    this.workers.size > this.config.minWorkers
                ) {
                    this.logger.info(`Auto-scaling: Removing idle worker ${workerInfo.id} due to inactivity`);
                    
                    this.stopWorker(workerInfo.id).catch(error => {
                        this.logger.error(`Failed to stop idle worker ${workerInfo.id}`, error);
                    });
                }
            }
        } catch (error) {
            this.logger.error('Error during auto-scaling', error);
        }
    }
    
    /**
     * Adds a task to the queue
     * @param task Task to add
     */
    private addTaskToQueue(task: Task): void {
        // Add task to queue based on priority
        let inserted = false;
        
        for (let i = 0; i < this.taskQueue.length; i++) {
            if (task.priority > this.taskQueue[i].priority) {
                this.taskQueue.splice(i, 0, task);
                inserted = true;
                break;
            }
        }
        
        if (!inserted) {
            this.taskQueue.push(task);
        }
        
        // Update metrics
        this.metrics.gauge('threading.tasks.queued', this.taskQueue.length);
        
        // Assign task to idle worker if available
        this.assignTaskToIdleWorker();
    }
    
    /**
     * Assigns a task to an idle worker
     */
    private assignTaskToIdleWorker(): void {
        if (this.taskQueue.length === 0) {
            return;
        }
        
        // Find idle worker
        for (const workerInfo of this.workers.values()) {
            if (workerInfo.status === WorkerStatus.IDLE) {
                this.assignTaskToWorker(workerInfo);
                break;
            }
        }
    }
    
    /**
     * Assigns a task to a specific worker
     * @param workerInfo Worker info
     */
    private assignTaskToWorker(workerInfo: WorkerInfo): void {
        if (this.taskQueue.length === 0) {
            return;
        }
        
        // Find best task for worker based on affinity
        let taskIndex = 0;
        
        if (this.config.enableWorkerAffinity && workerInfo.affinity) {
            // Find first task that matches worker affinity
            for (let i = 0; i < this.taskQueue.length; i++) {
                if (workerInfo.affinity.includes(this.taskQueue[i].type)) {
                    taskIndex = i;
                    break;
                }
            }
        }
        
        // Get task
        const task = this.taskQueue.splice(taskIndex, 1)[0];
        
        if (!task) {
            return;
        }
        
        this.logger.debug(`Assigning task ${task.id} to worker ${workerInfo.id}`);
        
        // Send task to worker
        workerInfo.worker.postMessage({
            type: 'task',
            task: {
                id: task.id,
                type: task.type,
                data: task.data
            }
        });
        
        // Update metrics
        this.metrics.gauge('threading.tasks.queued', this.taskQueue.length);
    }
    
    /**
     * Submits a task for processing
     * @param type Task type
     * @param data Task data
     * @param options Task options
     * @returns Promise that resolves with the task result
     */
    public async submitTask<T = any>(
        type: TaskType,
        data: any,
        options: {
            priority?: TaskPriority,
            timeout?: number,
            maxRetries?: number,
            retryDelay?: number
        } = {}
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            // Check if service is running
            if (!this.isRunning) {
                reject(new Error('Bridge threading service is not running'));
                return;
            }
            
            // Check if queue is full
            if (this.taskQueue.length >= this.config.maxQueueSize) {
                reject(new Error('Task queue is full'));
                return;
            }
            
            // Create task
            const task: Task = {
                id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                type,
                priority: options.priority !== undefined ? options.priority : TaskPriority.NORMAL,
                data,
                status: TaskStatus.QUEUED,
                createdAt: Date.now(),
                timeout: options.timeout !== undefined ? options.timeout : this.config.taskTimeout,
                maxRetries: options.maxRetries !== undefined ? options.maxRetries : this.config.maxTaskRetries,
                retryDelay: options.retryDelay !== undefined ? options.retryDelay : this.config.retryDelay,
                retries: 0,
                callback: (error, result) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(result);
                    }
                }
            };
            
            // Add task to map
            this.tasks.set(task.id, task);
            
            // Add task to queue
            this.addTaskToQueue(task);
            
            // Update metrics
            this.metrics.increment(`threading.tasks.submitted.${task.type}`);
            this.metrics.gauge('threading.tasks.active', this.tasks.size);
            
            this.logger.debug(`Submitted task ${task.id} of type ${task.type}`);
        });
    }
    
    /**
     * Cancels a task
     * @param taskId Task ID
     * @returns Whether the task was cancelled
     */
    public cancelTask(taskId: string): boolean {
        const task = this.tasks.get(taskId);
        
        if (!task) {
            this.logger.warn(`Task ${taskId} not found for cancellation`);
            return false;
        }
        
        this.logger.debug(`Cancelling task ${taskId}`);
        
        // Check if task is already completed or failed
        if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED) {
            this.logger.warn(`Task ${taskId} already ${task.status}`);
            return false;
        }
        
        // Check if task is queued
        if (task.status === TaskStatus.QUEUED) {
            // Remove task from queue
            const index = this.taskQueue.findIndex(t => t.id === taskId);
            
            if (index !== -1) {
                this.taskQueue.splice(index, 1);
            }
            
            // Update task status
            task.status = TaskStatus.CANCELLED;
            task.completedAt = Date.now();
            
            // Call task callback with error
            if (task.callback) {
                try {
                    task.callback(new Error('Task cancelled'));
                } catch (error) {
                    this.logger.error(`Error in task ${taskId} cancellation callback:`, error);
                }
            }
            
            // Remove task from map
            this.tasks.delete(taskId);
            
            // Update metrics
            this.metrics.increment(`threading.tasks.cancelled.${task.type}`);
            this.metrics.gauge('threading.tasks.active', this.tasks.size);
            this.metrics.gauge('threading.tasks.queued', this.taskQueue.length);
            
            return true;
        }
        
        // Task is running, can't cancel directly
        // Mark as cancelled and let worker handle it
        task.status = TaskStatus.CANCELLED;
        
        // Clear task timeout
        if (task.timeoutId) {
            clearTimeout(task.timeoutId);
            task.timeoutId = undefined;
        }
        
        // Call task callback with error
        if (task.callback) {
            try {
                task.callback(new Error('Task cancelled'));
            } catch (error) {
                this.logger.error(`Error in task ${taskId} cancellation callback:`, error);
            }
        }
        
        // Remove task from map
        this.tasks.delete(taskId);
        
        // Update metrics
        this.metrics.increment(`threading.tasks.cancelled.${task.type}`);
        this.metrics.gauge('threading.tasks.active', this.tasks.size);
        
        return true;
    }
    
    /**
     * Gets the status of a task
     * @param taskId Task ID
     * @returns Task status or null if task not found
     */
    public getTaskStatus(taskId: string): { status: TaskStatus, workerId?: number } | null {
        const task = this.tasks.get(taskId);
        
        if (!task) {
            return null;
        }
        
        return {
            status: task.status,
            workerId: task.workerId
        };
    }
    
    /**
     * Gets the status of all tasks
     * @returns Task statuses
     */
    public getAllTaskStatuses(): { [taskId: string]: { status: TaskStatus, type: TaskType, workerId?: number } } {
        const statuses: { [taskId: string]: { status: TaskStatus, type: TaskType, workerId?: number } } = {};
        
        for (const [taskId, task] of this.tasks.entries()) {
            statuses[taskId] = {
                status: task.status,
                type: task.type,
                workerId: task.workerId
            };
        }
        
        return statuses;
    }
    
    /**
     * Gets the status of all workers
     * @returns Worker statuses
     */
    public getAllWorkerStatuses(): { [workerId: string]: { status: WorkerStatus, currentTaskId?: string, tasksProcessed: number, tasksFailed: number } } {
        const statuses: { [workerId: string]: { status: WorkerStatus, currentTaskId?: string, tasksProcessed: number, tasksFailed: number } } = {};
        
        for (const [workerId, workerInfo] of this.workers.entries()) {
            statuses[workerId.toString()] = {
                status: workerInfo.status,
                currentTaskId: workerInfo.currentTaskId,
                tasksProcessed: workerInfo.tasksProcessed,
                tasksFailed: workerInfo.tasksFailed
            };
        }
        
        return statuses;
    }
    
    /**
     * Gets the number of active workers
     * @returns Number of active workers
     */
    public getWorkerCount(): number {
        return this.workers.size;
    }
    
    /**
     * Gets the number of idle workers
     * @returns Number of idle workers
     */
    public getIdleWorkerCount(): number {
        return Array.from(this.workers.values()).filter(w => w.status === WorkerStatus.IDLE).length;
    }
    
    /**
     * Gets the number of busy workers
     * @returns Number of busy workers
     */
    public getBusyWorkerCount(): number {
        return Array.from(this.workers.values()).filter(w => w.status === WorkerStatus.BUSY).length;
    }
    
    /**
     * Gets the number of queued tasks
     * @returns Number of queued tasks
     */
    public getQueuedTaskCount(): number {
        return this.taskQueue.length;
    }
    
    /**
     * Gets the number of active tasks
     * @returns Number of active tasks
     */
    public getActiveTaskCount(): number {
        return this.tasks.size;
    }
    
    /**
     * Gets the number of tasks of a specific type
     * @param type Task type
     * @returns Number of tasks of the specified type
     */
    public getTaskCountByType(type: TaskType): number {
        return Array.from(this.tasks.values()).filter(t => t.type === type).length;
    }
    
    /**
     * Gets the number of tasks with a specific status
     * @param status Task status
     * @returns Number of tasks with the specified status
     */
    public getTaskCountByStatus(status: TaskStatus): number {
        return Array.from(this.tasks.values()).filter(t => t.status === status).length;
    }
    
    /**
     * Sets worker affinity
     * @param workerId Worker ID
     * @param affinity Task types this worker is specialized for
     * @returns Whether the affinity was set
     */
    public setWorkerAffinity(workerId: number, affinity: TaskType[]): boolean {
        const workerInfo = this.workers.get(workerId);
        
        if (!workerInfo) {
            this.logger.warn(`Worker ${workerId} not found for setting affinity`);
            return false;
        }
        
        this.logger.debug(`Setting worker ${workerId} affinity to ${affinity.join(', ')}`);
        
        workerInfo.affinity = affinity;
        return true;
    }
    
    /**
     * Gets worker affinity
     * @param workerId Worker ID
     * @returns Worker affinity or null if worker not found
     */
    public getWorkerAffinity(workerId: number): TaskType[] | null {
        const workerInfo = this.workers.get(workerId);
        
        if (!workerInfo) {
            return null;
        }
        
        return workerInfo.affinity || [];
    }
    
    /**
     * Clears worker affinity
     * @param workerId Worker ID
     * @returns Whether the affinity was cleared
     */
    public clearWorkerAffinity(workerId: number): boolean {
        const workerInfo = this.workers.get(workerId);
        
        if (!workerInfo) {
            this.logger.warn(`Worker ${workerId} not found for clearing affinity`);
            return false;
        }
        
        this.logger.debug(`Clearing worker ${workerId} affinity`);
        
        workerInfo.affinity = undefined;
        return true;
    }
    
    /**
     * Gets worker metrics
     * @param workerId Worker ID
     * @returns Worker metrics or null if worker not found
     */
    public getWorkerMetrics(workerId: number): { cpuUsage?: number, memoryUsage?: number, tasksProcessed: number, tasksFailed: number } | null {
        const workerInfo = this.workers.get(workerId);
        
        if (!workerInfo) {
            return null;
        }
        
        return {
            cpuUsage: workerInfo.cpuUsage,
            memoryUsage: workerInfo.memoryUsage,
            tasksProcessed: workerInfo.tasksProcessed,
            tasksFailed: workerInfo.tasksFailed
        };
    }
    
    /**
     * Gets all worker metrics
     * @returns All worker metrics
     */
    public getAllWorkerMetrics(): { [workerId: string]: { cpuUsage?: number, memoryUsage?: number, tasksProcessed: number, tasksFailed: number } } {
        const metrics: { [workerId: string]: { cpuUsage?: number, memoryUsage?: number, tasksProcessed: number, tasksFailed: number } } = {};
        
        for (const [workerId, workerInfo] of this.workers.entries()) {
            metrics[workerId.toString()] = {
                cpuUsage: workerInfo.cpuUsage,
                memoryUsage: workerInfo.memoryUsage,
                tasksProcessed: workerInfo.tasksProcessed,
                tasksFailed: workerInfo.tasksFailed
            };
        }
        
        return metrics;
    }
    
    /**
     * Requests worker metrics update
     * @param workerId Worker ID
     * @returns Whether the request was sent
     */
    public requestWorkerMetrics(workerId: number): boolean {
        const workerInfo = this.workers.get(workerId);
        
        if (!workerInfo) {
            this.logger.warn(`Worker ${workerId} not found for metrics request`);
            return false;
        }
        
        this.logger.debug(`Requesting metrics from worker ${workerId}`);
        
        workerInfo.worker.postMessage({ type: 'get_metrics' });
        return true;
    }
    
    /**
     * Requests all worker metrics updates
     */
    public requestAllWorkerMetrics(): void {
        for (const workerId of this.workers.keys()) {
            this.requestWorkerMetrics(workerId);
        }
    }
}
