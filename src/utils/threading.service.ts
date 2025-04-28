// English comment for verification
/**
 * @file threading.service.ts
 * @description Service for managing multi-threading and parallel processing
 */

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { MonitoringService, EventSeverity, EventCategory } from '../monitoring/monitoring.service';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

/**
 * Interface for thread pool configuration
 */
export interface ThreadPoolConfig {
  minThreads: number;
  maxThreads: number;
  idleTimeoutMs: number;
  taskQueueLimit: number;
  priorityLevels: number;
  workerRestartThreshold: number;
  monitoringEnabled: boolean;
  monitoringIntervalMs: number;
  threadAffinityEnabled: boolean;
  workersDirectory: string;
}

/**
 * Interface for task options
 */
export interface TaskOptions {
  priority?: number;
  timeout?: number;
  retries?: number;
  retryDelayMs?: number;
  threadAffinity?: number;
  onProgress?: (progress: number) => void;
}

/**
 * Interface for task result
 */
export interface TaskResult<T> {
  id: string;
  success: boolean;
  result?: T;
  error?: Error;
  executionTimeMs: number;
  threadId: number;
  retryCount: number;
}

/**
 * Interface for thread pool statistics
 */
export interface ThreadPoolStatistics {
  totalThreads: number;
  activeThreads: number;
  idleThreads: number;
  pendingTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageExecutionTimeMs: number;
  averageWaitTimeMs: number;
  maxExecutionTimeMs: number;
  cpuUtilization: number[];
  memoryUsageMb: number;
  taskSuccessRate: number;
  tasksByPriority: Record<number, number>;
}

/**
 * Interface for worker message
 */
interface WorkerMessage {
  type: 'result' | 'error' | 'progress' | 'ready' | 'busy' | 'idle';
  taskId?: string;
  data?: any;
  error?: any;
  progress?: number;
}

/**
 * Interface for task
 */
interface Task {
  id: string;
  script: string;
  data: any;
  options: TaskOptions;
  resolve: (result: TaskResult<any>) => void;
  reject: (error: Error) => void;
  startTime: number;
  queueTime: number;
  retryCount: number;
  timeout?: NodeJS.Timeout;
}

/**
 * Interface for worker thread
 */
interface WorkerThread {
  id: number;
  worker: Worker;
  busy: boolean;
  currentTask?: string;
  lastActiveTime: number;
  taskCount: number;
  failureCount: number;
  totalExecutionTimeMs: number;
}

/**
 * Service for managing multi-threading and parallel processing
 */
export class ThreadingService {
  private static instance: ThreadingService;
  private initialized: boolean = false;
  private running: boolean = false;
  
  private config: ThreadPoolConfig = {
    minThreads: Math.max(1, Math.floor(os.cpus().length / 2)),
    maxThreads: os.cpus().length,
    idleTimeoutMs: 60000, // 1 minute
    taskQueueLimit: 1000,
    priorityLevels: 5,
    workerRestartThreshold: 10,
    monitoringEnabled: true,
    monitoringIntervalMs: 5000, // 5 seconds
    threadAffinityEnabled: false,
    workersDirectory: './workers'
  };
  
  private workers: Map<number, WorkerThread> = new Map();
  private taskQueue: Task[][] = [];
  private taskMap: Map<string, Task> = new Map();
  
  private monitoringInterval: NodeJS.Timeout | null = null;
  private idleCheckInterval: NodeJS.Timeout | null = null;
  
  private statistics: ThreadPoolStatistics = {
    totalThreads: 0,
    activeThreads: 0,
    idleThreads: 0,
    pendingTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    averageExecutionTimeMs: 0,
    averageWaitTimeMs: 0,
    maxExecutionTimeMs: 0,
    cpuUtilization: [],
    memoryUsageMb: 0,
    taskSuccessRate: 100,
    tasksByPriority: {}
  };
  
  private totalExecutionTimeMs: number = 0;
  private totalWaitTimeMs: number = 0;
  
  private constructor() {
    // Initialize task queue with priority levels
    for (let i = 0; i < this.config.priorityLevels; i++) {
      this.taskQueue.push([]);
      this.statistics.tasksByPriority[i] = 0;
    }
  }
  
  /**
   * Get the singleton instance of the ThreadingService
   * @returns The ThreadingService instance
   */
  public static getInstance(): ThreadingService {
    if (!ThreadingService.instance) {
      ThreadingService.instance = new ThreadingService();
    }
    return ThreadingService.instance;
  }
  
  /**
   * Initialize the threading service
   * @param config Optional configuration to override defaults
   */
  public async initialize(config?: Partial<ThreadPoolConfig>): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    try {
      // Update configuration if provided
      if (config) {
        this.config = { ...this.config, ...config };
      }
      
      // Ensure workers directory exists
      if (!fs.existsSync(this.config.workersDirectory)) {
        fs.mkdirSync(this.config.workersDirectory, { recursive: true });
      }
      
      // Initialize task queue with updated priority levels
      this.taskQueue = [];
      this.statistics.tasksByPriority = {};
      
      for (let i = 0; i < this.config.priorityLevels; i++) {
        this.taskQueue.push([]);
        this.statistics.tasksByPriority[i] = 0;
      }
      
      // Log initialization
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'ThreadingService',
        eventType: 'Initialization',
        severity: EventSeverity.INFO,
        category: EventCategory.SYSTEM,
        message: 'Threading service initialized',
        details: {
          minThreads: this.config.minThreads,
          maxThreads: this.config.maxThreads,
          priorityLevels: this.config.priorityLevels
        }
      });
      
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize threading service: ${error.message}`);
    }
  }
  
  /**
   * Start the threading service
   */
  public async start(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    if (this.running) {
      return;
    }
    
    try {
      // Create initial worker threads
      for (let i = 0; i < this.config.minThreads; i++) {
        await this.createWorker();
      }
      
      // Start monitoring interval if enabled
      if (this.config.monitoringEnabled) {
        this.monitoringInterval = setInterval(
          () => this.monitorThreadPool(),
          this.config.monitoringIntervalMs
        );
      }
      
      // Start idle check interval
      this.idleCheckInterval = setInterval(
        () => this.checkIdleWorkers(),
        this.config.idleTimeoutMs / 2
      );
      
      // Log start
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'ThreadingService',
        eventType: 'Start',
        severity: EventSeverity.INFO,
        category: EventCategory.SYSTEM,
        message: 'Threading service started',
        details: {
          initialThreads: this.workers.size
        }
      });
      
      this.running = true;
    } catch (error) {
      throw new Error(`Failed to start threading service: ${error.message}`);
    }
  }
  
  /**
   * Stop the threading service
   */
  public async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    
    try {
      // Stop monitoring interval
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }
      
      // Stop idle check interval
      if (this.idleCheckInterval) {
        clearInterval(this.idleCheckInterval);
        this.idleCheckInterval = null;
      }
      
      // Terminate all workers
      const workerIds = Array.from(this.workers.keys());
      for (const workerId of workerIds) {
        await this.terminateWorker(workerId);
      }
      
      // Clear task queue
      for (let i = 0; i < this.taskQueue.length; i++) {
        for (const task of this.taskQueue[i]) {
          task.reject(new Error('Threading service stopped'));
        }
        this.taskQueue[i] = [];
      }
      
      this.taskMap.clear();
      
      // Log stop
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'ThreadingService',
        eventType: 'Stop',
        severity: EventSeverity.INFO,
        category: EventCategory.SYSTEM,
        message: 'Threading service stopped'
      });
      
      this.running = false;
    } catch (error) {
      throw new Error(`Failed to stop threading service: ${error.message}`);
    }
  }
  
  /**
   * Execute a task in a worker thread
   * @param script Path to the worker script
   * @param data Data to pass to the worker
   * @param options Task options
   * @returns Promise that resolves with the task result
   */
  public async executeTask<T>(script: string, data: any, options: TaskOptions = {}): Promise<TaskResult<T>> {
    if (!this.running) {
      throw new Error('Threading service is not running');
    }
    
    // Check if task queue is full
    const totalPendingTasks = this.taskQueue.reduce((sum, queue) => sum + queue.length, 0);
    if (totalPendingTasks >= this.config.taskQueueLimit) {
      throw new Error('Task queue is full');
    }
    
    return new Promise<TaskResult<T>>((resolve, reject) => {
      // Create task
      const taskId = uuidv4();
      const priority = options.priority !== undefined ? 
        Math.max(0, Math.min(this.config.priorityLevels - 1, options.priority)) : 
        Math.floor(this.config.priorityLevels / 2); // Default to middle priority
      
      const task: Task = {
        id: taskId,
        script,
        data,
        options,
        resolve,
        reject,
        startTime: 0,
        queueTime: Date.now(),
        retryCount: 0
      };
      
      // Add task to queue
      this.taskQueue[priority].push(task);
      this.taskMap.set(taskId, task);
      
      // Update statistics
      this.statistics.pendingTasks++;
      this.statistics.tasksByPriority[priority]++;
      
      // Process task queue
      this.processTaskQueue();
    });
  }
  
  /**
   * Get thread pool statistics
   * @returns Thread pool statistics
   */
  public getStatistics(): ThreadPoolStatistics {
    // Update statistics
    this.statistics.totalThreads = this.workers.size;
    this.statistics.activeThreads = Array.from(this.workers.values()).filter(worker => worker.busy).length;
    this.statistics.idleThreads = this.statistics.totalThreads - this.statistics.activeThreads;
    this.statistics.pendingTasks = this.taskQueue.reduce((sum, queue) => sum + queue.length, 0);
    
    // Calculate task success rate
    const totalTasks = this.statistics.completedTasks + this.statistics.failedTasks;
    this.statistics.taskSuccessRate = totalTasks > 0 ? 
      (this.statistics.completedTasks / totalTasks) * 100 : 100;
    
    // Calculate average execution time
    this.statistics.averageExecutionTimeMs = this.statistics.completedTasks > 0 ? 
      this.totalExecutionTimeMs / this.statistics.completedTasks : 0;
    
    // Calculate average wait time
    this.statistics.averageWaitTimeMs = (this.statistics.completedTasks + this.statistics.failedTasks) > 0 ? 
      this.totalWaitTimeMs / (this.statistics.completedTasks + this.statistics.failedTasks) : 0;
    
    // Get memory usage
    const memoryUsage = process.memoryUsage();
    this.statistics.memoryUsageMb = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    
    return { ...this.statistics };
  }
  
  /**
   * Update thread pool configuration
   * @param config Partial configuration to update
   */
  public updateConfig(config: Partial<ThreadPoolConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...config };
    
    // Adjust thread pool size if needed
    if (this.running) {
      if (this.config.minThreads > oldConfig.minThreads) {
        // Create additional workers to meet new minimum
        const additionalWorkers = this.config.minThreads - this.workers.size;
        if (additionalWorkers > 0) {
          for (let i = 0; i < additionalWorkers; i++) {
            this.createWorker();
          }
        }
      }
      
      // Update monitoring interval if changed
      if (this.config.monitoringEnabled !== oldConfig.monitoringEnabled || 
          this.config.monitoringIntervalMs !== oldConfig.monitoringIntervalMs) {
        
        if (this.monitoringInterval) {
          clearInterval(this.monitoringInterval);
          this.monitoringInterval = null;
        }
        
        if (this.config.monitoringEnabled) {
          this.monitoringInterval = setInterval(
            () => this.monitorThreadPool(),
            this.config.monitoringIntervalMs
          );
        }
      }
      
      // Update idle check interval if changed
      if (this.config.idleTimeoutMs !== oldConfig.idleTimeoutMs && this.idleCheckInterval) {
        clearInterval(this.idleCheckInterval);
        this.idleCheckInterval = setInterval(
          () => this.checkIdleWorkers(),
          this.config.idleTimeoutMs / 2
        );
      }
    }
  }
  
  /**
   * Get current thread pool configuration
   * @returns Current configuration
   */
  public getConfig(): ThreadPoolConfig {
    return { ...this.config };
  }
  
  /**
   * Check if threading service is initialized
   * @returns True if initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }
  
  /**
   * Check if threading service is running
   * @returns True if running
   */
  public isRunning(): boolean {
    return this.running;
  }
  
  /**
   * Get the number of active workers
   * @returns Number of active workers
   */
  public getActiveWorkerCount(): number {
    return Array.from(this.workers.values()).filter(worker => worker.busy).length;
  }
  
  /**
   * Get the number of pending tasks
   * @returns Number of pending tasks
   */
  public getPendingTaskCount(): number {
    return this.taskQueue.reduce((sum, queue) => sum + queue.length, 0);
  }
  
  /**
   * Create a worker thread
   * @private
   */
  private async createWorker(): Promise<number> {
    try {
      // Generate worker ID
      const workerId = Date.now();
      
      // Create worker
      const worker = new Worker(path.join(__dirname, 'worker_bootstrap.js'), {
        workerData: {
          workerId,
          workersDirectory: this.config.workersDirectory
        }
      });
      
      // Set up message handler
      worker.on('message', (message: WorkerMessage) => this.handleWorkerMessage(workerId, message));
      
      // Set up error handler
      worker.on('error', (error) => this.handleWorkerError(workerId, error));
      
      // Set up exit handler
      worker.on('exit', (code) => this.handleWorkerExit(workerId, code));
      
      // Add worker to pool
      this.workers.set(workerId, {
        id: workerId,
        worker,
        busy: false,
        lastActiveTime: Date.now(),
        taskCount: 0,
        failureCount: 0,
        totalExecutionTimeMs: 0
      });
      
      // Log worker creation
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'ThreadingService',
        eventType: 'WorkerCreated',
        severity: EventSeverity.INFO,
        category: EventCategory.SYSTEM,
        message: `Worker thread created: ${workerId}`,
        details: {
          workerId,
          totalWorkers: this.workers.size
        }
      });
      
      return workerId;
    } catch (error) {
      throw new Error(`Failed to create worker thread: ${error.message}`);
    }
  }
  
  /**
   * Terminate a worker thread
   * @param workerId ID of the worker to terminate
   * @private
   */
  private async terminateWorker(workerId: number): Promise<void> {
    try {
      const workerThread = this.workers.get(workerId);
      if (!workerThread) {
        return;
      }
      
      // If worker is busy, fail the current task
      if (workerThread.busy && workerThread.currentTask) {
        const task = this.taskMap.get(workerThread.currentTask);
        if (task) {
          // Clear task timeout
          if (task.timeout) {
            clearTimeout(task.timeout);
          }
          
          // Check if task should be retried
          if (task.retryCount < (task.options.retries || 0)) {
            // Retry task
            await this.retryTask(task);
          } else {
            // Fail task
            task.reject(new Error('Worker terminated'));
            this.taskMap.delete(task.id);
            
            // Update statistics
            this.statistics.failedTasks++;
            this.totalWaitTimeMs += Date.now() - task.queueTime;
          }
        }
      }
      
      // Terminate worker
      await workerThread.worker.terminate();
      
      // Remove worker from pool
      this.workers.delete(workerId);
      
      // Log worker termination
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'ThreadingService',
        eventType: 'WorkerTerminated',
        severity: EventSeverity.INFO,
        category: EventCategory.SYSTEM,
        message: `Worker thread terminated: ${workerId}`,
        details: {
          workerId,
          totalWorkers: this.workers.size
        }
      });
    } catch (error) {
      throw new Error(`Failed to terminate worker thread: ${error.message}`);
    }
  }
  
  /**
   * Process the task queue
   * @private
   */
  private async processTaskQueue(): Promise<void> {
    // Check if there are available workers
    const availableWorkers = Array.from(this.workers.values()).filter(worker => !worker.busy);
    if (availableWorkers.length === 0) {
      // Check if we can create more workers
      if (this.workers.size < this.config.maxThreads) {
        await this.createWorker();
        // Process queue again after creating worker
        this.processTaskQueue();
      }
      return;
    }
    
    // Find the highest priority task
    let task: Task | undefined;
    let priorityLevel = -1;
    
    for (let i = 0; i < this.taskQueue.length; i++) {
      if (this.taskQueue[i].length > 0) {
        task = this.taskQueue[i].shift();
        priorityLevel = i;
        break;
      }
    }
    
    if (!task) {
      return; // No tasks in queue
    }
    
    // Update statistics
    this.statistics.pendingTasks--;
    if (priorityLevel >= 0) {
      this.statistics.tasksByPriority[priorityLevel]--;
    }
    
    // Find the best worker for the task
    let selectedWorker: WorkerThread | undefined;
    
    if (this.config.threadAffinityEnabled && task.options.threadAffinity !== undefined) {
      // Try to find worker with matching affinity
      const affinityWorkers = availableWorkers.filter(worker => 
        worker.id % this.config.maxThreads === task.options.threadAffinity % this.config.maxThreads
      );
      
      if (affinityWorkers.length > 0) {
        selectedWorker = affinityWorkers[0];
      }
    }
    
    // If no worker with matching affinity, use least busy worker
    if (!selectedWorker) {
      selectedWorker = availableWorkers.sort((a, b) => a.taskCount - b.taskCount)[0];
    }
    
    // Execute task on selected worker
    await this.executeTaskOnWorker(selectedWorker, task);
    
    // Process more tasks if available
    if (this.getPendingTaskCount() > 0 && this.getActiveWorkerCount() < this.workers.size) {
      this.processTaskQueue();
    }
  }
  
  /**
   * Execute a task on a worker
   * @param workerThread Worker thread to execute task on
   * @param task Task to execute
   * @private
   */
  private async executeTaskOnWorker(workerThread: WorkerThread, task: Task): Promise<void> {
    try {
      // Mark worker as busy
      workerThread.busy = true;
      workerThread.currentTask = task.id;
      workerThread.lastActiveTime = Date.now();
      
      // Set task start time
      task.startTime = Date.now();
      
      // Set task timeout if specified
      if (task.options.timeout) {
        task.timeout = setTimeout(() => {
          this.handleTaskTimeout(task.id);
        }, task.options.timeout);
      }
      
      // Send task to worker
      workerThread.worker.postMessage({
        type: 'execute',
        taskId: task.id,
        script: task.script,
        data: task.data
      });
      
      // Log task execution
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'ThreadingService',
        eventType: 'TaskExecutionStarted',
        severity: EventSeverity.DEBUG,
        category: EventCategory.TASK,
        message: `Task execution started: ${task.id}`,
        details: {
          taskId: task.id,
          workerId: workerThread.id,
          script: path.basename(task.script)
        }
      });
    } catch (error) {
      // Handle execution error
      this.handleTaskError(task.id, error);
    }
  }
  
  /**
   * Retry a task
   * @param task Task to retry
   * @private
   */
  private async retryTask(task: Task): Promise<void> {
    try {
      // Increment retry count
      task.retryCount++;
      
      // Log retry
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'ThreadingService',
        eventType: 'TaskRetry',
        severity: EventSeverity.WARNING,
        category: EventCategory.TASK,
        message: `Retrying task: ${task.id} (attempt ${task.retryCount})`,
        details: {
          taskId: task.id,
          retryCount: task.retryCount,
          maxRetries: task.options.retries || 0
        }
      });
      
      // Add delay before retry if specified
      if (task.options.retryDelayMs) {
        await new Promise(resolve => setTimeout(resolve, task.options.retryDelayMs));
      }
      
      // Add task back to queue with original priority
      const priority = task.options.priority !== undefined ? 
        Math.max(0, Math.min(this.config.priorityLevels - 1, task.options.priority)) : 
        Math.floor(this.config.priorityLevels / 2);
      
      this.taskQueue[priority].push(task);
      
      // Update statistics
      this.statistics.pendingTasks++;
      this.statistics.tasksByPriority[priority]++;
      
      // Process task queue
      this.processTaskQueue();
    } catch (error) {
      // If retry fails, fail the task
      task.reject(new Error(`Failed to retry task: ${error.message}`));
      this.taskMap.delete(task.id);
      
      // Update statistics
      this.statistics.failedTasks++;
      this.totalWaitTimeMs += Date.now() - task.queueTime;
    }
  }
  
  /**
   * Handle worker message
   * @param workerId ID of the worker that sent the message
   * @param message Message from the worker
   * @private
   */
  private async handleWorkerMessage(workerId: number, message: WorkerMessage): Promise<void> {
    const workerThread = this.workers.get(workerId);
    if (!workerThread) {
      return;
    }
    
    switch (message.type) {
      case 'result':
        if (message.taskId) {
          await this.handleTaskResult(workerId, message.taskId, message.data);
        }
        break;
      
      case 'error':
        if (message.taskId) {
          await this.handleTaskError(message.taskId, message.error);
        }
        break;
      
      case 'progress':
        if (message.taskId && message.progress !== undefined) {
          await this.handleTaskProgress(message.taskId, message.progress);
        }
        break;
      
      case 'ready':
        // Worker is ready for tasks
        workerThread.busy = false;
        workerThread.currentTask = undefined;
        workerThread.lastActiveTime = Date.now();
        
        // Process task queue if there are pending tasks
        if (this.getPendingTaskCount() > 0) {
          this.processTaskQueue();
        }
        break;
      
      case 'busy':
        // Worker is busy
        workerThread.busy = true;
        workerThread.lastActiveTime = Date.now();
        break;
      
      case 'idle':
        // Worker is idle
        workerThread.busy = false;
        workerThread.currentTask = undefined;
        workerThread.lastActiveTime = Date.now();
        break;
    }
  }
  
  /**
   * Handle worker error
   * @param workerId ID of the worker that had an error
   * @param error Error from the worker
   * @private
   */
  private async handleWorkerError(workerId: number, error: Error): Promise<void> {
    try {
      const workerThread = this.workers.get(workerId);
      if (!workerThread) {
        return;
      }
      
      // Increment failure count
      workerThread.failureCount++;
      
      // Log worker error
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'ThreadingService',
        eventType: 'WorkerError',
        severity: EventSeverity.ERROR,
        category: EventCategory.SYSTEM,
        message: `Worker thread error: ${workerId}`,
        details: {
          workerId,
          error: error.message,
          failureCount: workerThread.failureCount
        }
      });
      
      // If worker has a current task, fail it
      if (workerThread.busy && workerThread.currentTask) {
        await this.handleTaskError(workerThread.currentTask, error);
      }
      
      // If worker has exceeded failure threshold, terminate and replace it
      if (workerThread.failureCount >= this.config.workerRestartThreshold) {
        await this.terminateWorker(workerId);
        await this.createWorker();
      }
    } catch (error) {
      console.error(`Failed to handle worker error: ${error.message}`);
    }
  }
  
  /**
   * Handle worker exit
   * @param workerId ID of the worker that exited
   * @param code Exit code
   * @private
   */
  private async handleWorkerExit(workerId: number, code: number): Promise<void> {
    try {
      // Log worker exit
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'ThreadingService',
        eventType: 'WorkerExit',
        severity: code === 0 ? EventSeverity.INFO : EventSeverity.WARNING,
        category: EventCategory.SYSTEM,
        message: `Worker thread exited: ${workerId} (code: ${code})`,
        details: {
          workerId,
          exitCode: code
        }
      });
      
      // Remove worker from pool
      this.workers.delete(workerId);
      
      // If worker exited abnormally and we're below min threads, create a new worker
      if (code !== 0 && this.workers.size < this.config.minThreads) {
        await this.createWorker();
      }
    } catch (error) {
      console.error(`Failed to handle worker exit: ${error.message}`);
    }
  }
  
  /**
   * Handle task result
   * @param workerId ID of the worker that completed the task
   * @param taskId ID of the completed task
   * @param result Result of the task
   * @private
   */
  private async handleTaskResult(workerId: number, taskId: string, result: any): Promise<void> {
    try {
      const task = this.taskMap.get(taskId);
      if (!task) {
        return;
      }
      
      const workerThread = this.workers.get(workerId);
      if (!workerThread) {
        return;
      }
      
      // Clear task timeout
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
      
      // Calculate execution time
      const executionTimeMs = Date.now() - task.startTime;
      
      // Update worker statistics
      workerThread.taskCount++;
      workerThread.totalExecutionTimeMs += executionTimeMs;
      workerThread.busy = false;
      workerThread.currentTask = undefined;
      workerThread.lastActiveTime = Date.now();
      
      // Update global statistics
      this.statistics.completedTasks++;
      this.totalExecutionTimeMs += executionTimeMs;
      this.totalWaitTimeMs += task.startTime - task.queueTime;
      
      if (executionTimeMs > this.statistics.maxExecutionTimeMs) {
        this.statistics.maxExecutionTimeMs = executionTimeMs;
      }
      
      // Create task result
      const taskResult: TaskResult<any> = {
        id: taskId,
        success: true,
        result,
        executionTimeMs,
        threadId: workerId,
        retryCount: task.retryCount
      };
      
      // Resolve task promise
      task.resolve(taskResult);
      
      // Remove task from map
      this.taskMap.delete(taskId);
      
      // Log task completion
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'ThreadingService',
        eventType: 'TaskCompleted',
        severity: EventSeverity.DEBUG,
        category: EventCategory.TASK,
        message: `Task completed: ${taskId}`,
        details: {
          taskId,
          workerId,
          executionTimeMs
        }
      });
      
      // Process task queue if there are pending tasks
      if (this.getPendingTaskCount() > 0) {
        this.processTaskQueue();
      }
    } catch (error) {
      console.error(`Failed to handle task result: ${error.message}`);
    }
  }
  
  /**
   * Handle task error
   * @param taskId ID of the task that had an error
   * @param error Error from the task
   * @private
   */
  private async handleTaskError(taskId: string, error: Error): Promise<void> {
    try {
      const task = this.taskMap.get(taskId);
      if (!task) {
        return;
      }
      
      // Clear task timeout
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
      
      // Find worker for this task
      let workerId: number | undefined;
      for (const [id, worker] of this.workers.entries()) {
        if (worker.currentTask === taskId) {
          workerId = id;
          
          // Reset worker state
          worker.busy = false;
          worker.currentTask = undefined;
          worker.lastActiveTime = Date.now();
          
          break;
        }
      }
      
      // Log task error
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'ThreadingService',
        eventType: 'TaskError',
        severity: EventSeverity.ERROR,
        category: EventCategory.TASK,
        message: `Task error: ${taskId}`,
        details: {
          taskId,
          workerId,
          error: error.message,
          retryCount: task.retryCount,
          maxRetries: task.options.retries || 0
        }
      });
      
      // Check if task should be retried
      if (task.retryCount < (task.options.retries || 0)) {
        // Retry task
        await this.retryTask(task);
      } else {
        // Calculate execution time
        const executionTimeMs = Date.now() - task.startTime;
        
        // Update statistics
        this.statistics.failedTasks++;
        this.totalWaitTimeMs += task.startTime - task.queueTime;
        
        // Create task result
        const taskResult: TaskResult<any> = {
          id: taskId,
          success: false,
          error,
          executionTimeMs,
          threadId: workerId || 0,
          retryCount: task.retryCount
        };
        
        // Resolve task promise with error
        task.reject(error);
        
        // Remove task from map
        this.taskMap.delete(taskId);
      }
      
      // Process task queue if there are pending tasks
      if (this.getPendingTaskCount() > 0) {
        this.processTaskQueue();
      }
    } catch (error) {
      console.error(`Failed to handle task error: ${error.message}`);
    }
  }
  
  /**
   * Handle task timeout
   * @param taskId ID of the task that timed out
   * @private
   */
  private async handleTaskTimeout(taskId: string): Promise<void> {
    try {
      const task = this.taskMap.get(taskId);
      if (!task) {
        return;
      }
      
      // Find worker for this task
      let workerId: number | undefined;
      for (const [id, worker] of this.workers.entries()) {
        if (worker.currentTask === taskId) {
          workerId = id;
          break;
        }
      }
      
      // Create timeout error
      const timeoutError = new Error(`Task timed out after ${task.options.timeout}ms`);
      
      // Log task timeout
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.logEvent({
        source: 'ThreadingService',
        eventType: 'TaskTimeout',
        severity: EventSeverity.WARNING,
        category: EventCategory.TASK,
        message: `Task timed out: ${taskId}`,
        details: {
          taskId,
          workerId,
          timeout: task.options.timeout
        }
      });
      
      // Handle as task error
      await this.handleTaskError(taskId, timeoutError);
      
      // If worker is found, terminate it to prevent zombie processes
      if (workerId !== undefined) {
        await this.terminateWorker(workerId);
        await this.createWorker();
      }
    } catch (error) {
      console.error(`Failed to handle task timeout: ${error.message}`);
    }
  }
  
  /**
   * Handle task progress
   * @param taskId ID of the task that reported progress
   * @param progress Progress value (0-100)
   * @private
   */
  private async handleTaskProgress(taskId: string, progress: number): Promise<void> {
    try {
      const task = this.taskMap.get(taskId);
      if (!task || !task.options.onProgress) {
        return;
      }
      
      // Call progress callback
      task.options.onProgress(progress);
    } catch (error) {
      console.error(`Failed to handle task progress: ${error.message}`);
    }
  }
  
  /**
   * Monitor thread pool
   * @private
   */
  private async monitorThreadPool(): Promise<void> {
    try {
      // Get CPU utilization
      this.statistics.cpuUtilization = os.cpus().map(cpu => {
        const total = Object.values(cpu.times).reduce((sum, time) => sum + time, 0);
        const idle = cpu.times.idle;
        return 100 - (idle / total * 100);
      });
      
      // Get memory usage
      const memoryUsage = process.memoryUsage();
      this.statistics.memoryUsageMb = Math.round(memoryUsage.heapUsed / 1024 / 1024);
      
      // Log statistics
      const monitoringService = MonitoringService.getInstance();
      await monitoringService.recordMetric({
        metricType: 'threading.active_workers',
        source: 'ThreadingService',
        value: this.getActiveWorkerCount(),
        unit: 'count'
      });
      
      await monitoringService.recordMetric({
        metricType: 'threading.pending_tasks',
        source: 'ThreadingService',
        value: this.getPendingTaskCount(),
        unit: 'count'
      });
      
      await monitoringService.recordMetric({
        metricType: 'threading.memory_usage',
        source: 'ThreadingService',
        value: this.statistics.memoryUsageMb,
        unit: 'MB'
      });
      
      await monitoringService.recordMetric({
        metricType: 'threading.avg_execution_time',
        source: 'ThreadingService',
        value: this.statistics.averageExecutionTimeMs,
        unit: 'ms'
      });
      
      // Scale thread pool if needed
      await this.scaleThreadPool();
    } catch (error) {
      console.error(`Failed to monitor thread pool: ${error.message}`);
    }
  }
  
  /**
   * Scale thread pool based on load
   * @private
   */
  private async scaleThreadPool(): Promise<void> {
    try {
      const pendingTasks = this.getPendingTaskCount();
      const activeWorkers = this.getActiveWorkerCount();
      const totalWorkers = this.workers.size;
      
      // Scale up if there are pending tasks and all workers are busy
      if (pendingTasks > 0 && activeWorkers >= totalWorkers && totalWorkers < this.config.maxThreads) {
        // Create new worker
        await this.createWorker();
      }
      
      // Scale down is handled by idle worker check
    } catch (error) {
      console.error(`Failed to scale thread pool: ${error.message}`);
    }
  }
  
  /**
   * Check for idle workers
   * @private
   */
  private async checkIdleWorkers(): Promise<void> {
    try {
      const now = Date.now();
      const idleThreshold = now - this.config.idleTimeoutMs;
      
      // Find idle workers
      const idleWorkers: number[] = [];
      
      for (const [id, worker] of this.workers.entries()) {
        if (!worker.busy && worker.lastActiveTime < idleThreshold) {
          idleWorkers.push(id);
        }
      }
      
      // Terminate excess idle workers, but keep at least minThreads
      if (this.workers.size - idleWorkers.length >= this.config.minThreads) {
        for (const workerId of idleWorkers) {
          await this.terminateWorker(workerId);
          
          // Stop if we've reached minThreads
          if (this.workers.size <= this.config.minThreads) {
            break;
          }
        }
      }
    } catch (error) {
      console.error(`Failed to check idle workers: ${error.message}`);
    }
  }
}

/**
 * Worker bootstrap script
 * This script is loaded by the worker thread and handles task execution
 */
export const workerBootstrapScript = `
const { parentPort, workerData, isMainThread } = require('worker_threads');
const path = require('path');
const fs = require('fs');

// Exit if this is not a worker thread
if (isMainThread) {
  console.error('Worker bootstrap script should not be run in main thread');
  process.exit(1);
}

// Get worker ID and workers directory
const { workerId, workersDirectory } = workerData;

// Send ready message to parent
parentPort.postMessage({ type: 'ready' });

// Handle messages from parent
parentPort.on('message', async (message) => {
  if (message.type === 'execute') {
    try {
      // Send busy message
      parentPort.postMessage({ type: 'busy' });
      
      // Get task details
      const { taskId, script, data } = message;
      
      // Check if script exists
      const scriptPath = path.resolve(script);
      if (!fs.existsSync(scriptPath)) {
        throw new Error(\`Script not found: \${scriptPath}\`);
      }
      
      // Load script
      const taskModule = require(scriptPath);
      
      // Check if script exports execute function
      if (typeof taskModule.execute !== 'function') {
        throw new Error(\`Script does not export execute function: \${scriptPath}\`);
      }
      
      // Set up progress reporting
      const reportProgress = (progress) => {
        parentPort.postMessage({
          type: 'progress',
          taskId,
          progress
        });
      };
      
      // Execute task
      const result = await taskModule.execute(data, reportProgress);
      
      // Send result to parent
      parentPort.postMessage({
        type: 'result',
        taskId,
        data: result
      });
      
      // Send idle message
      parentPort.postMessage({ type: 'idle' });
    } catch (error) {
      // Send error to parent
      parentPort.postMessage({
        type: 'error',
        taskId: message.taskId,
        error: {
          message: error.message,
          stack: error.stack
        }
      });
      
      // Send idle message
      parentPort.postMessage({ type: 'idle' });
    }
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error(\`Worker \${workerId} uncaught exception: \${error.message}\`);
  
  // Send error to parent
  parentPort.postMessage({
    type: 'error',
    error: {
      message: error.message,
      stack: error.stack
    }
  });
  
  // Exit worker
  process.exit(1);
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error(\`Worker \${workerId} unhandled rejection: \${reason}\`);
  
  // Send error to parent
  parentPort.postMessage({
    type: 'error',
    error: {
      message: reason.message || String(reason),
      stack: reason.stack || ''
    }
  });
  
  // Exit worker
  process.exit(1);
});
`;

/**
 * Create worker bootstrap file
 * @param directory Directory to create file in
 * @returns Path to created file
 */
export async function createWorkerBootstrapFile(directory: string = __dirname): Promise<string> {
  const filePath = path.join(directory, 'worker_bootstrap.js');
  fs.writeFileSync(filePath, workerBootstrapScript);
  return filePath;
}
