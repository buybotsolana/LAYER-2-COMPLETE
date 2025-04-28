// English comment for verification
/**
 * @file ThreadPoolService.ts
 * @description Service for managing multi-threading in the Wormhole Relayer system
 * @author Manus AI
 * @date April 27, 2025
 */

import { Logger } from '../utils/Logger';
import { MetricsService } from '../monitoring/MetricsService';
import { AlertService } from '../monitoring/AlertService';
import * as os from 'os';
import { EventEmitter } from 'events';
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

/**
 * Interface for thread pool configuration
 */
interface ThreadPoolConfig {
  minThreads: number;
  maxThreads: number;
  idleTimeout: number;
  queueLimit: number;
  taskTimeout: number;
  priorityLevels: number;
  workerScript: string;
  autoScale: boolean;
  autoScaleInterval: number;
  autoScaleThreshold: number;
  autoScaleStep: number;
}

/**
 * Interface for a task to be executed by the thread pool
 */
interface Task {
  id: string;
  fn: Function;
  args: any[];
  priority: number;
  submittedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: any;
  error?: Error;
  timeout?: NodeJS.Timeout;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

/**
 * Interface for a worker thread
 */
interface WorkerThread {
  id: string;
  worker: Worker;
  busy: boolean;
  currentTask?: string;
  startedAt: Date;
  tasksCompleted: number;
  lastTaskCompletedAt?: Date;
  errors: number;
}

/**
 * ThreadPoolService class
 * 
 * Provides a thread pool for executing CPU-intensive tasks in parallel,
 * with support for task prioritization, auto-scaling, and monitoring.
 */
export class ThreadPoolService extends EventEmitter {
  private readonly logger: Logger;
  private readonly metrics: MetricsService;
  private readonly alerts: AlertService;
  private readonly config: ThreadPoolConfig;
  private isRunning: boolean = false;
  private workers: Map<string, WorkerThread> = new Map();
  private taskQueue: Task[] = [];
  private taskMap: Map<string, Task> = new Map();
  private autoScaleTimer: NodeJS.Timeout | null = null;
  private workerScriptPath: string;

  /**
   * Creates a new instance of the ThreadPoolService
   * 
   * @param metrics The metrics service
   * @param alerts The alert service
   * @param logger The logger
   * @param config The thread pool configuration
   */
  constructor(
    metrics: MetricsService,
    alerts: AlertService,
    logger: Logger,
    config?: Partial<ThreadPoolConfig>
  ) {
    super();
    this.metrics = metrics;
    this.alerts = alerts;
    this.logger = logger.createChild('ThreadPoolService');

    // Default configuration
    const defaultConfig: ThreadPoolConfig = {
      minThreads: Math.max(1, Math.floor(os.cpus().length / 2)), // Half of CPU cores
      maxThreads: os.cpus().length, // Number of CPU cores
      idleTimeout: 60000, // 1 minute
      queueLimit: 1000,
      taskTimeout: 300000, // 5 minutes
      priorityLevels: 5,
      workerScript: path.join(__dirname, 'worker.js'),
      autoScale: true,
      autoScaleInterval: 5000, // 5 seconds
      autoScaleThreshold: 0.7, // 70% utilization
      autoScaleStep: 2 // Add/remove 2 threads at a time
    };

    // Merge provided config with defaults
    this.config = {
      ...defaultConfig,
      ...config
    };

    // Ensure the worker script exists
    this.workerScriptPath = this.config.workerScript;
    if (!fs.existsSync(this.workerScriptPath)) {
      // Create a default worker script if it doesn't exist
      this.createDefaultWorkerScript();
    }
  }

  /**
   * Creates a default worker script if one doesn't exist
   */
  private createDefaultWorkerScript(): void {
    const workerDir = path.dirname(this.workerScriptPath);
    if (!fs.existsSync(workerDir)) {
      fs.mkdirSync(workerDir, { recursive: true });
    }

    const workerScript = `
const { parentPort, workerData } = require('worker_threads');

// Handle messages from the main thread
parentPort.on('message', async (message) => {
  try {
    const { taskId, fnStr, args } = message;
    
    // Convert function string back to function
    const fn = new Function('return ' + fnStr)();
    
    // Execute the function
    const result = await fn(...args);
    
    // Send the result back to the main thread
    parentPort.postMessage({ taskId, result });
  } catch (error) {
    // Send the error back to the main thread
    parentPort.postMessage({ 
      taskId: message.taskId, 
      error: { 
        message: error.message, 
        stack: error.stack 
      } 
    });
  }
});

// Notify the main thread that the worker is ready
parentPort.postMessage({ ready: true });
`;

    fs.writeFileSync(this.workerScriptPath, workerScript);
    this.logger.info(`Created default worker script at ${this.workerScriptPath}`);
  }

  /**
   * Starts the thread pool
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Thread pool is already running');
      return;
    }

    this.isRunning = true;
    this.logger.info(`Starting thread pool with ${this.config.minThreads} initial threads`);

    try {
      // Initialize workers
      for (let i = 0; i < this.config.minThreads; i++) {
        await this.createWorker();
      }

      // Start auto-scaling if enabled
      if (this.config.autoScale) {
        this.startAutoScaling();
      }

      this.logger.info('Thread pool started successfully');
      this.metrics.recordMetric('thread_pool.started', 1);
    } catch (error) {
      this.isRunning = false;
      this.logger.error('Failed to start thread pool', error);
      this.metrics.recordMetric('thread_pool.start_failed', 1);
      throw error;
    }
  }

  /**
   * Stops the thread pool
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('Thread pool is not running');
      return;
    }

    this.isRunning = false;
    this.logger.info('Stopping thread pool');

    try {
      // Stop auto-scaling
      if (this.autoScaleTimer) {
        clearInterval(this.autoScaleTimer);
        this.autoScaleTimer = null;
      }

      // Terminate all workers
      const terminationPromises = Array.from(this.workers.values()).map(worker => {
        return new Promise<void>((resolve) => {
          worker.worker.once('exit', () => {
            resolve();
          });
          worker.worker.terminate();
        });
      });

      await Promise.all(terminationPromises);
      this.workers.clear();

      // Clear task queue
      this.taskQueue = [];
      this.taskMap.clear();

      this.logger.info('Thread pool stopped successfully');
      this.metrics.recordMetric('thread_pool.stopped', 1);
    } catch (error) {
      this.logger.error('Error stopping thread pool', error);
      this.metrics.recordMetric('thread_pool.stop_failed', 1);
      throw error;
    }
  }

  /**
   * Creates a new worker
   * 
   * @returns The worker ID
   */
  private async createWorker(): Promise<string> {
    const workerId = crypto.randomUUID();
    
    this.logger.debug(`Creating worker ${workerId}`);

    try {
      // Create a new worker
      const worker = new Worker(this.workerScriptPath);

      // Create worker thread object
      const workerThread: WorkerThread = {
        id: workerId,
        worker,
        busy: false,
        startedAt: new Date(),
        tasksCompleted: 0,
        errors: 0
      };

      // Add to workers map
      this.workers.set(workerId, workerThread);

      // Set up message handler
      worker.on('message', (message) => {
        if (message.ready) {
          // Worker is ready, process next task if available
          this.processNextTask(workerId);
        } else if (message.taskId) {
          // Task completed
          this.handleTaskCompletion(workerId, message.taskId, message.result, message.error);
        }
      });

      // Set up error handler
      worker.on('error', (error) => {
        this.logger.error(`Worker ${workerId} error`, error);
        this.metrics.recordMetric('thread_pool.worker_error', 1);
        
        // Increment error count
        workerThread.errors++;

        // If the worker has a current task, fail it
        if (workerThread.currentTask) {
          const task = this.taskMap.get(workerThread.currentTask);
          if (task) {
            this.failTask(task, new Error(`Worker error: ${error.message}`));
          }
          workerThread.currentTask = undefined;
        }

        // Replace the worker
        this.replaceWorker(workerId);
      });

      // Set up exit handler
      worker.on('exit', (code) => {
        this.logger.debug(`Worker ${workerId} exited with code ${code}`);
        
        // If the worker has a current task, fail it
        if (workerThread.currentTask) {
          const task = this.taskMap.get(workerThread.currentTask);
          if (task) {
            this.failTask(task, new Error(`Worker exited with code ${code}`));
          }
          workerThread.currentTask = undefined;
        }

        // Remove from workers map
        this.workers.delete(workerId);

        // Replace the worker if we're still running and it wasn't intentionally terminated
        if (this.isRunning && code !== 0) {
          this.replaceWorker(workerId);
        }
      });

      this.logger.debug(`Worker ${workerId} created successfully`);
      this.metrics.recordMetric('thread_pool.worker_created', 1);

      return workerId;
    } catch (error) {
      this.logger.error(`Failed to create worker ${workerId}`, error);
      this.metrics.recordMetric('thread_pool.worker_creation_failed', 1);
      throw error;
    }
  }

  /**
   * Replaces a worker
   * 
   * @param workerId The ID of the worker to replace
   */
  private async replaceWorker(workerId: string): Promise<void> {
    this.logger.debug(`Replacing worker ${workerId}`);

    try {
      // Create a new worker
      await this.createWorker();

      this.logger.debug(`Worker ${workerId} replaced successfully`);
      this.metrics.recordMetric('thread_pool.worker_replaced', 1);
    } catch (error) {
      this.logger.error(`Failed to replace worker ${workerId}`, error);
      this.metrics.recordMetric('thread_pool.worker_replacement_failed', 1);
    }
  }

  /**
   * Starts the auto-scaling process
   */
  private startAutoScaling(): void {
    this.logger.debug('Starting auto-scaling');

    this.autoScaleTimer = setInterval(() => {
      this.autoScale();
    }, this.config.autoScaleInterval);
  }

  /**
   * Auto-scales the thread pool based on current utilization
   */
  private autoScale(): void {
    if (!this.isRunning) return;

    try {
      // Calculate current utilization
      const totalWorkers = this.workers.size;
      const busyWorkers = Array.from(this.workers.values()).filter(w => w.busy).length;
      const utilization = totalWorkers > 0 ? busyWorkers / totalWorkers : 0;
      const queueSize = this.taskQueue.length;

      this.logger.debug(`Auto-scaling check: utilization=${utilization.toFixed(2)}, workers=${totalWorkers}, queue=${queueSize}`);

      // Record metrics
      this.metrics.recordMetric('thread_pool.utilization', utilization);
      this.metrics.recordMetric('thread_pool.workers', totalWorkers);
      this.metrics.recordMetric('thread_pool.busy_workers', busyWorkers);
      this.metrics.recordMetric('thread_pool.queue_size', queueSize);

      // Scale up if utilization is high and queue is not empty
      if (utilization >= this.config.autoScaleThreshold && queueSize > 0 && totalWorkers < this.config.maxThreads) {
        const workersToAdd = Math.min(
          this.config.autoScaleStep,
          this.config.maxThreads - totalWorkers
        );

        if (workersToAdd > 0) {
          this.logger.info(`Auto-scaling up: adding ${workersToAdd} workers`);
          
          // Add workers
          for (let i = 0; i < workersToAdd; i++) {
            this.createWorker().catch(error => {
              this.logger.error('Error creating worker during auto-scale up', error);
            });
          }

          this.metrics.recordMetric('thread_pool.auto_scale_up', workersToAdd);
        }
      }
      // Scale down if utilization is low and we have more than minimum workers
      else if (utilization < this.config.autoScaleThreshold / 2 && queueSize === 0 && totalWorkers > this.config.minThreads) {
        const workersToRemove = Math.min(
          this.config.autoScaleStep,
          totalWorkers - this.config.minThreads
        );

        if (workersToRemove > 0) {
          this.logger.info(`Auto-scaling down: removing ${workersToRemove} workers`);
          
          // Find idle workers to remove
          const idleWorkers = Array.from(this.workers.values())
            .filter(w => !w.busy)
            .slice(0, workersToRemove);

          // Terminate idle workers
          for (const worker of idleWorkers) {
            worker.worker.terminate();
            this.workers.delete(worker.id);
          }

          this.metrics.recordMetric('thread_pool.auto_scale_down', workersToRemove);
        }
      }
    } catch (error) {
      this.logger.error('Error during auto-scaling', error);
      this.metrics.recordMetric('thread_pool.auto_scale_error', 1);
    }
  }

  /**
   * Submits a task to the thread pool
   * 
   * @param fn The function to execute
   * @param args The arguments to pass to the function
   * @param priority The priority of the task (0-4, higher is more important)
   * @returns A promise that resolves with the result of the function
   */
  public submit<T>(fn: Function, args: any[] = [], priority: number = 2): Promise<T> {
    if (!this.isRunning) {
      return Promise.reject(new Error('Thread pool is not running'));
    }

    // Validate priority
    priority = Math.max(0, Math.min(this.config.priorityLevels - 1, priority));

    // Check queue limit
    if (this.taskQueue.length >= this.config.queueLimit) {
      this.logger.warn(`Task queue limit reached (${this.config.queueLimit})`);
      this.metrics.recordMetric('thread_pool.queue_limit_reached', 1);
      this.alerts.triggerAlert('system', 'warning', `Thread pool task queue limit reached (${this.config.queueLimit})`);
      return Promise.reject(new Error('Task queue limit reached'));
    }

    return new Promise<T>((resolve, reject) => {
      // Create task
      const taskId = crypto.randomUUID();
      const task: Task = {
        id: taskId,
        fn,
        args,
        priority,
        submittedAt: new Date(),
        resolve,
        reject
      };

      // Set up task timeout
      task.timeout = setTimeout(() => {
        this.failTask(task, new Error(`Task timed out after ${this.config.taskTimeout}ms`));
      }, this.config.taskTimeout);

      // Add to task map
      this.taskMap.set(taskId, task);

      // Add to task queue
      this.addToQueue(task);

      this.logger.debug(`Task ${taskId} submitted with priority ${priority}`);
      this.metrics.recordMetric('thread_pool.task_submitted', 1);
      this.metrics.recordMetric(`thread_pool.task_priority_${priority}`, 1);

      // Process the task if workers are available
      this.processNextTask();
    });
  }

  /**
   * Adds a task to the queue
   * 
   * @param task The task to add
   */
  private addToQueue(task: Task): void {
    // Find the position to insert the task based on priority
    let insertIndex = this.taskQueue.length;
    for (let i = 0; i < this.taskQueue.length; i++) {
      if (this.taskQueue[i].priority < task.priority) {
        insertIndex = i;
        break;
      }
    }

    // Insert the task
    this.taskQueue.splice(insertIndex, 0, task);

    // Emit event
    this.emit('taskQueued', task.id);
  }

  /**
   * Processes the next task in the queue
   * 
   * @param specificWorkerId Optional worker ID to use
   */
  private processNextTask(specificWorkerId?: string): void {
    if (!this.isRunning || this.taskQueue.length === 0) return;

    // Find an available worker
    let availableWorker: WorkerThread | undefined;
    
    if (specificWorkerId) {
      // Use the specified worker if it's available
      const worker = this.workers.get(specificWorkerId);
      if (worker && !worker.busy) {
        availableWorker = worker;
      }
    } else {
      // Find any available worker
      for (const worker of this.workers.values()) {
        if (!worker.busy) {
          availableWorker = worker;
          break;
        }
      }
    }

    if (!availableWorker) return;

    // Get the next task
    const task = this.taskQueue.shift();
    if (!task) return;

    // Mark worker as busy
    availableWorker.busy = true;
    availableWorker.currentTask = task.id;

    // Update task
    task.startedAt = new Date();

    // Serialize the function
    const fnStr = task.fn.toString();

    // Send the task to the worker
    availableWorker.worker.postMessage({
      taskId: task.id,
      fnStr,
      args: task.args
    });

    this.logger.debug(`Task ${task.id} started on worker ${availableWorker.id}`);
    this.metrics.recordMetric('thread_pool.task_started', 1);

    // Emit event
    this.emit('taskStarted', task.id, availableWorker.id);
  }

  /**
   * Handles task completion
   * 
   * @param workerId The ID of the worker that completed the task
   * @param taskId The ID of the completed task
   * @param result The result of the task
   * @param error The error that occurred, if any
   */
  private handleTaskCompletion(workerId: string, taskId: string, result?: any, error?: any): void {
    const worker = this.workers.get(workerId);
    const task = this.taskMap.get(taskId);

    if (!worker || !task) return;

    // Mark worker as available
    worker.busy = false;
    worker.currentTask = undefined;
    worker.tasksCompleted++;
    worker.lastTaskCompletedAt = new Date();

    // Clear task timeout
    if (task.timeout) {
      clearTimeout(task.timeout);
      task.timeout = undefined;
    }

    // Update task
    task.completedAt = new Date();

    if (error) {
      // Task failed
      task.error = new Error(error.message);
      task.error.stack = error.stack;
      
      this.logger.error(`Task ${taskId} failed on worker ${workerId}`, task.error);
      this.metrics.recordMetric('thread_pool.task_failed', 1);
      
      // Reject the promise
      task.reject(task.error);
    } else {
      // Task succeeded
      task.result = result;
      
      const duration = task.completedAt.getTime() - task.startedAt!.getTime();
      this.logger.debug(`Task ${taskId} completed on worker ${workerId} in ${duration}ms`);
      this.metrics.recordMetric('thread_pool.task_completed', 1);
      this.metrics.recordMetric('thread_pool.task_duration', duration);
      
      // Resolve the promise
      task.resolve(result);
    }

    // Remove from task map
    this.taskMap.delete(taskId);

    // Emit event
    this.emit('taskCompleted', taskId, workerId, !!error);

    // Process next task
    this.processNextTask(workerId);
  }

  /**
   * Fails a task
   * 
   * @param task The task to fail
   * @param error The error that caused the failure
   */
  private failTask(task: Task, error: Error): void {
    // Check if the task has already been completed
    if (task.completedAt) return;

    // Update task
    task.completedAt = new Date();
    task.error = error;

    // Clear task timeout
    if (task.timeout) {
      clearTimeout(task.timeout);
      task.timeout = undefined;
    }

    this.logger.error(`Task ${task.id} failed: ${error.message}`);
    this.metrics.recordMetric('thread_pool.task_failed', 1);

    // Reject the promise
    task.reject(error);

    // Remove from task map
    this.taskMap.delete(task.id);

    // Remove from queue if it's still there
    const queueIndex = this.taskQueue.findIndex(t => t.id === task.id);
    if (queueIndex >= 0) {
      this.taskQueue.splice(queueIndex, 1);
    }

    // Emit event
    this.emit('taskFailed', task.id, error);
  }

  /**
   * Gets the status of the thread pool
   * 
   * @returns The status
   */
  public getStatus(): {
    isRunning: boolean;
    workers: number;
    busyWorkers: number;
    queueSize: number;
    tasksCompleted: number;
    utilization: number;
  } {
    const totalWorkers = this.workers.size;
    const busyWorkers = Array.from(this.workers.values()).filter(w => w.busy).length;
    const utilization = totalWorkers > 0 ? busyWorkers / totalWorkers : 0;
    const tasksCompleted = Array.from(this.workers.values()).reduce((sum, w) => sum + w.tasksCompleted, 0);

    return {
      isRunning: this.isRunning,
      workers: totalWorkers,
      busyWorkers,
      queueSize: this.taskQueue.length,
      tasksCompleted,
      utilization
    };
  }

  /**
   * Gets detailed statistics about the thread pool
   * 
   * @returns The statistics
   */
  public getStatistics(): {
    workers: {
      total: number;
      busy: number;
      idle: number;
    };
    tasks: {
      queued: number;
      active: number;
      completed: number;
      failed: number;
      averageDuration: number;
    };
    queue: {
      size: number;
      byPriority: number[];
      oldestTask: Date | null;
    };
    utilization: number;
  } {
    const totalWorkers = this.workers.size;
    const busyWorkers = Array.from(this.workers.values()).filter(w => w.busy).length;
    const idleWorkers = totalWorkers - busyWorkers;
    const utilization = totalWorkers > 0 ? busyWorkers / totalWorkers : 0;

    // Calculate task statistics
    const completedTasks = Array.from(this.workers.values()).reduce((sum, w) => sum + w.tasksCompleted, 0);
    const failedTasks = Array.from(this.workers.values()).reduce((sum, w) => sum + w.errors, 0);
    
    // Calculate average duration (not accurate in this implementation)
    const averageDuration = 0; // Would require tracking all task durations
    
    // Calculate queue statistics
    const queueSize = this.taskQueue.length;
    const queueByPriority = Array(this.config.priorityLevels).fill(0);
    let oldestTask: Date | null = null;
    
    for (const task of this.taskQueue) {
      queueByPriority[task.priority]++;
      if (!oldestTask || task.submittedAt < oldestTask) {
        oldestTask = task.submittedAt;
      }
    }

    return {
      workers: {
        total: totalWorkers,
        busy: busyWorkers,
        idle: idleWorkers
      },
      tasks: {
        queued: queueSize,
        active: busyWorkers,
        completed: completedTasks,
        failed: failedTasks,
        averageDuration
      },
      queue: {
        size: queueSize,
        byPriority: queueByPriority,
        oldestTask
      },
      utilization
    };
  }
}
