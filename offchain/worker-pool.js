/**
 * Implementazione di un sistema di elaborazione parallela con worker threads per il Layer-2 su Solana
 * 
 * Questo modulo implementa un pool di worker threads configurabile per l'elaborazione
 * parallela di task, con supporto per distribuzione del carico, gestione degli errori
 * e monitoraggio delle prestazioni.
 */

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const crypto = require('crypto');

/**
 * Classe WorkerPool
 * 
 * Implementa un pool di worker threads per l'elaborazione parallela di task
 */
class WorkerPool extends EventEmitter {
  /**
   * Costruttore
   * @param {Object} options - Opzioni di configurazione
   */
  constructor(options = {}) {
    super();
    
    // Configurazione
    this.options = {
      workerCount: options.workerCount || Math.max(1, Math.min(os.cpus().length - 1, 8)),
      taskTimeout: options.taskTimeout || 30000, // 30 secondi
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000, // 1 secondo
      workerScript: options.workerScript || path.join(__dirname, 'worker-thread.js'),
      workerOptions: options.workerOptions || {},
      enableMetrics: options.enableMetrics !== false,
      metricsInterval: options.metricsInterval || 10000, // 10 secondi
      enableLoadBalancing: options.enableLoadBalancing !== false,
      loadBalancingStrategy: options.loadBalancingStrategy || 'least-busy', // 'least-busy', 'round-robin', 'random'
      maxQueueSize: options.maxQueueSize || 10000,
      priorityLevels: options.priorityLevels || 3,
      defaultPriority: options.defaultPriority || 1,
      enableBackpressure: options.enableBackpressure !== false,
      backpressureThreshold: options.backpressureThreshold || 0.8, // 80% di riempimento
      backpressureReleaseThreshold: options.backpressureReleaseThreshold || 0.6, // 60% di riempimento
    };
    
    // Stato interno
    this.workers = [];
    this.workerStats = [];
    this.taskQueue = Array(this.options.priorityLevels).fill().map(() => []);
    this.pendingTasks = new Map();
    this.isBackpressureActive = false;
    this.isShuttingDown = false;
    this.taskIdCounter = 0;
    this.taskTimeouts = new Map();
    
    // Metriche
    this.metrics = {
      tasksSubmitted: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      tasksRetried: 0,
      tasksTimedOut: 0,
      taskQueueSize: 0,
      workerUtilization: 0,
      avgTaskDuration: 0,
      totalTaskDuration: 0,
      backpressureEvents: 0,
      lastReportTime: Date.now()
    };
    
    // Inizializzazione
    this._initialize();
  }
  
  /**
   * Inizializza il pool di worker
   * @private
   */
  _initialize() {
    console.log(`Inizializzazione WorkerPool con ${this.options.workerCount} worker...`);
    
    // Crea i worker
    for (let i = 0; i < this.options.workerCount; i++) {
      this._createWorker(i);
    }
    
    // Avvia il monitoraggio delle metriche se abilitato
    if (this.options.enableMetrics) {
      this._startMetricsMonitoring();
    }
    
    // Avvia il processore della coda
    this._startQueueProcessor();
    
    console.log(`WorkerPool inizializzato con ${this.options.workerCount} worker`);
    
    // Emetti evento di inizializzazione completata
    this.emit('initialized', {
      workerCount: this.options.workerCount,
      loadBalancingStrategy: this.options.loadBalancingStrategy,
      priorityLevels: this.options.priorityLevels
    });
  }
  
  /**
   * Crea un worker thread
   * @param {number} id - ID del worker
   * @private
   */
  _createWorker(id) {
    try {
      // Crea il worker
      const worker = new Worker(this.options.workerScript, {
        workerData: {
          workerId: id,
          ...this.options.workerOptions
        }
      });
      
      // Inizializza le statistiche del worker
      this.workerStats[id] = {
        id,
        status: 'idle',
        tasksProcessed: 0,
        tasksSucceeded: 0,
        tasksFailed: 0,
        totalProcessingTime: 0,
        currentTaskId: null,
        currentTaskStartTime: null,
        lastTaskEndTime: null
      };
      
      // Gestisci i messaggi dal worker
      worker.on('message', (message) => {
        this._handleWorkerMessage(id, message);
      });
      
      // Gestisci gli errori del worker
      worker.on('error', (error) => {
        console.error(`Worker ${id} error:`, error);
        this._handleWorkerError(id, error);
      });
      
      // Gestisci la terminazione del worker
      worker.on('exit', (code) => {
        if (code !== 0 && !this.isShuttingDown) {
          console.error(`Worker ${id} exited with code ${code}`);
          this._recreateWorker(id);
        }
      });
      
      // Salva il worker
      this.workers[id] = worker;
      
      return worker;
    } catch (error) {
      console.error(`Error creating worker ${id}:`, error);
      
      // Riprova a creare il worker dopo un ritardo
      setTimeout(() => this._recreateWorker(id), this.options.retryDelay);
      
      return null;
    }
  }
  
  /**
   * Ricrea un worker thread
   * @param {number} id - ID del worker
   * @private
   */
  _recreateWorker(id) {
    try {
      // Termina il worker esistente se presente
      if (this.workers[id]) {
        try {
          this.workers[id].terminate();
        } catch (error) {
          console.error(`Error terminating worker ${id}:`, error);
        }
      }
      
      // Recupera il task corrente se presente
      const currentTaskId = this.workerStats[id].currentTaskId;
      if (currentTaskId && this.pendingTasks.has(currentTaskId)) {
        const task = this.pendingTasks.get(currentTaskId);
        
        // Incrementa il contatore di tentativi
        task.retries = (task.retries || 0) + 1;
        
        // Se il task può essere ritentato, lo rimette in coda
        if (task.retries < this.options.maxRetries) {
          console.log(`Retrying task ${currentTaskId} (attempt ${task.retries + 1}/${this.options.maxRetries + 1})`);
          this.metrics.tasksRetried++;
          
          // Rimetti il task in coda con priorità alta
          this._enqueueTask(task, this.options.priorityLevels - 1);
        } else {
          // Altrimenti, fallisce il task
          console.error(`Task ${currentTaskId} failed after ${task.retries + 1} attempts`);
          this.metrics.tasksFailed++;
          
          // Rimuovi il timeout
          if (this.taskTimeouts.has(currentTaskId)) {
            clearTimeout(this.taskTimeouts.get(currentTaskId));
            this.taskTimeouts.delete(currentTaskId);
          }
          
          // Risolvi la promessa con un errore
          task.reject(new Error(`Task failed after ${task.retries + 1} attempts`));
          this.pendingTasks.delete(currentTaskId);
        }
      }
      
      // Resetta le statistiche del worker
      this.workerStats[id] = {
        id,
        status: 'idle',
        tasksProcessed: 0,
        tasksSucceeded: 0,
        tasksFailed: 0,
        totalProcessingTime: 0,
        currentTaskId: null,
        currentTaskStartTime: null,
        lastTaskEndTime: null
      };
      
      // Crea un nuovo worker
      console.log(`Recreating worker ${id}...`);
      this._createWorker(id);
      
      // Processa la coda
      this._processQueue();
    } catch (error) {
      console.error(`Error recreating worker ${id}:`, error);
      
      // Riprova a ricreare il worker dopo un ritardo
      setTimeout(() => this._recreateWorker(id), this.options.retryDelay);
    }
  }
  
  /**
   * Gestisce i messaggi dal worker
   * @param {number} workerId - ID del worker
   * @param {Object} message - Messaggio dal worker
   * @private
   */
  _handleWorkerMessage(workerId, message) {
    // Verifica che il worker esista
    if (!this.workers[workerId] || !this.workerStats[workerId]) {
      console.error(`Received message from non-existent worker ${workerId}`);
      return;
    }
    
    // Gestisci il messaggio in base al tipo
    switch (message.type) {
      case 'task_result':
        this._handleTaskResult(workerId, message.taskId, message.result, null);
        break;
        
      case 'task_error':
        this._handleTaskResult(workerId, message.taskId, null, new Error(message.error));
        break;
        
      case 'worker_ready':
        // Il worker è pronto a ricevere task
        this.workerStats[workerId].status = 'idle';
        this._processQueue();
        break;
        
      case 'worker_busy':
        // Il worker è occupato
        this.workerStats[workerId].status = 'busy';
        break;
        
      case 'worker_stats':
        // Aggiorna le statistiche del worker
        Object.assign(this.workerStats[workerId], message.stats);
        break;
        
      default:
        console.warn(`Unknown message type from worker ${workerId}:`, message.type);
    }
  }
  
  /**
   * Gestisce gli errori del worker
   * @param {number} workerId - ID del worker
   * @param {Error} error - Errore
   * @private
   */
  _handleWorkerError(workerId, error) {
    console.error(`Worker ${workerId} error:`, error);
    
    // Verifica che il worker esista
    if (!this.workers[workerId] || !this.workerStats[workerId]) {
      console.error(`Received error from non-existent worker ${workerId}`);
      return;
    }
    
    // Recupera il task corrente se presente
    const currentTaskId = this.workerStats[workerId].currentTaskId;
    if (currentTaskId && this.pendingTasks.has(currentTaskId)) {
      const task = this.pendingTasks.get(currentTaskId);
      
      // Incrementa il contatore di tentativi
      task.retries = (task.retries || 0) + 1;
      
      // Se il task può essere ritentato, lo rimette in coda
      if (task.retries < this.options.maxRetries) {
        console.log(`Retrying task ${currentTaskId} (attempt ${task.retries + 1}/${this.options.maxRetries + 1})`);
        this.metrics.tasksRetried++;
        
        // Rimetti il task in coda con priorità alta
        this._enqueueTask(task, this.options.priorityLevels - 1);
      } else {
        // Altrimenti, fallisce il task
        console.error(`Task ${currentTaskId} failed after ${task.retries + 1} attempts`);
        this.metrics.tasksFailed++;
        
        // Rimuovi il timeout
        if (this.taskTimeouts.has(currentTaskId)) {
          clearTimeout(this.taskTimeouts.get(currentTaskId));
          this.taskTimeouts.delete(currentTaskId);
        }
        
        // Risolvi la promessa con un errore
        task.reject(new Error(`Task failed after ${task.retries + 1} attempts: ${error.message}`));
        this.pendingTasks.delete(currentTaskId);
      }
    }
    
    // Ricrea il worker
    this._recreateWorker(workerId);
  }
  
  /**
   * Gestisce il risultato di un task
   * @param {number} workerId - ID del worker
   * @param {string} taskId - ID del task
   * @param {*} result - Risultato del task
   * @param {Error} error - Errore del task
   * @private
   */
  _handleTaskResult(workerId, taskId, result, error) {
    // Verifica che il task esista
    if (!this.pendingTasks.has(taskId)) {
      console.warn(`Received result for non-existent task ${taskId}`);
      return;
    }
    
    // Recupera il task
    const task = this.pendingTasks.get(taskId);
    
    // Rimuovi il timeout
    if (this.taskTimeouts.has(taskId)) {
      clearTimeout(this.taskTimeouts.get(taskId));
      this.taskTimeouts.delete(taskId);
    }
    
    // Aggiorna le statistiche del worker
    const workerStat = this.workerStats[workerId];
    workerStat.status = 'idle';
    workerStat.tasksProcessed++;
    workerStat.currentTaskId = null;
    
    const now = Date.now();
    if (workerStat.currentTaskStartTime) {
      const taskDuration = now - workerStat.currentTaskStartTime;
      workerStat.totalProcessingTime += taskDuration;
      
      // Aggiorna le metriche
      this.metrics.totalTaskDuration += taskDuration;
      this.metrics.tasksCompleted++;
      this.metrics.avgTaskDuration = this.metrics.totalTaskDuration / this.metrics.tasksCompleted;
    }
    
    workerStat.lastTaskEndTime = now;
    workerStat.currentTaskStartTime = null;
    
    if (error) {
      // Incrementa il contatore di tentativi
      task.retries = (task.retries || 0) + 1;
      workerStat.tasksFailed++;
      
      // Se il task può essere ritentato, lo rimette in coda
      if (task.retries < this.options.maxRetries) {
        console.log(`Retrying task ${taskId} (attempt ${task.retries + 1}/${this.options.maxRetries + 1})`);
        this.metrics.tasksRetried++;
        
        // Rimetti il task in coda con priorità alta
        this._enqueueTask(task, this.options.priorityLevels - 1);
      } else {
        // Altrimenti, fallisce il task
        console.error(`Task ${taskId} failed after ${task.retries + 1} attempts:`, error);
        this.metrics.tasksFailed++;
        
        // Risolvi la promessa con un errore
        task.reject(error);
        this.pendingTasks.delete(taskId);
      }
    } else {
      // Task completato con successo
      workerStat.tasksSucceeded++;
      
      // Risolvi la promessa con il risultato
      task.resolve(result);
      this.pendingTasks.delete(taskId);
    }
    
    // Processa la coda
    this._processQueue();
    
    // Verifica se disattivare il backpressure
    this._checkBackpressure();
  }
  
  /**
   * Avvia il monitoraggio delle metriche
   * @private
   */
  _startMetricsMonitoring() {
    setInterval(() => {
      const now = Date.now();
      const elapsed = (now - this.metrics.lastReportTime) / 1000;
      
      if (elapsed > 0) {
        // Calcola le operazioni al secondo
        const tasksPerSecond = this.metrics.tasksCompleted / elapsed;
        
        // Calcola l'utilizzo dei worker
        let busyWorkers = 0;
        for (const stat of this.workerStats) {
          if (stat && stat.status === 'busy') {
            busyWorkers++;
          }
        }
        
        const workerUtilization = busyWorkers / this.options.workerCount;
        this.metrics.workerUtilization = workerUtilization;
        
        // Calcola la dimensione della coda
        let queueSize = 0;
        for (const queue of this.taskQueue) {
          queueSize += queue.length;
        }
        this.metrics.taskQueueSize = queueSize;
        
        console.log(`WorkerPool metrics - Tasks/sec: ${tasksPerSecond.toFixed(2)}, Worker utilization: ${(workerUtilization * 100).toFixed(2)}%`);
        console.log(`Queue size: ${queueSize}, Pending tasks: ${this.pendingTasks.size}`);
        console.log(`Completed: ${this.metrics.tasksCompleted}, Failed: ${this.metrics.tasksFailed}, Retried: ${this.metrics.tasksRetried}, Timed out: ${this.metrics.tasksTimedOut}`);
        console.log(`Avg task duration: ${this.metrics.avgTaskDuration.toFixed(2)}ms, Backpressure events: ${this.metrics.backpressureEvents}`);
        
        // Emetti evento con le metriche
        this.emit('metrics', {
          timestamp: now,
          tasksPerSecond,
          workerUtilization,
          queueSize,
          pendingTasks: this.pendingTasks.size,
          tasksCompleted: this.metrics.tasksCompleted,
          tasksFailed: this.metrics.tasksFailed,
          tasksRetried: this.metrics.tasksRetried,
          tasksTimedOut: this.metrics.tasksTimedOut,
          avgTaskDuration: this.metrics.avgTaskDuration,
          backpressureEvents: this.metrics.backpressureEvents
        });
        
        // Resetta i contatori
        this.metrics.tasksCompleted = 0;
        this.metrics.tasksFailed = 0;
        this.metrics.tasksRetried = 0;
        this.metrics.tasksTimedOut = 0;
        this.metrics.totalTaskDuration = 0;
        this.metrics.lastReportTime = now;
      }
    }, this.options.metricsInterval);
  }
  
  /**
   * Avvia il processore della coda
   * @private
   */
  _startQueueProcessor() {
    // Processa la coda inizialmente
    this._processQueue();
    
    // Imposta un intervallo per processare la coda periodicamente
    // Questo garantisce che i task vengano elaborati anche se ci sono problemi
    // con i worker o con la gestione degli eventi
    setInterval(() => {
      this._processQueue();
    }, 1000);
  }
  
  /**
   * Processa la coda dei task
   * @private
   */
  _processQueue() {
    // Se il pool è in fase di chiusura, non processare la coda
    if (this.isShuttingDown) {
      return;
    }
    
    // Trova i worker disponibili
    const availableWorkers = [];
    for (let i = 0; i < this.workers.length; i++) {
      if (this.workers[i] && this.workerStats[i] && this.workerStats[i].status === 'idle') {
        availableWorkers.push(i);
      }
    }
    
    // Se non ci sono worker disponibili, esci
    if (availableWorkers.length === 0) {
      return;
    }
    
    // Processa i task in ordine di priorità
    for (let priority = this.options.priorityLevels - 1; priority >= 0; priority--) {
      const queue = this.taskQueue[priority];
      
      // Se la coda è vuota, passa alla priorità successiva
      if (queue.length === 0) {
        continue;
      }
      
      // Assegna i task ai worker disponibili
      while (queue.length > 0 && availableWorkers.length > 0) {
        const task = queue.shift();
        
        // Seleziona un worker in base alla strategia di bilanciamento del carico
        const workerIndex = this._selectWorker(availableWorkers);
        
        // Rimuovi il worker dalla lista dei disponibili
        const workerIndexInAvailable = availableWorkers.indexOf(workerIndex);
        if (workerIndexInAvailable !== -1) {
          availableWorkers.splice(workerIndexInAvailable, 1);
        }
        
        // Assegna il task al worker
        this._assignTaskToWorker(workerIndex, task);
      }
      
      // Se non ci sono più worker disponibili, esci
      if (availableWorkers.length === 0) {
        break;
      }
    }
  }
  
  /**
   * Seleziona un worker in base alla strategia di bilanciamento del carico
   * @param {Array<number>} availableWorkers - Array di ID dei worker disponibili
   * @returns {number} ID del worker selezionato
   * @private
   */
  _selectWorker(availableWorkers) {
    if (availableWorkers.length === 0) {
      throw new Error('No available workers');
    }
    
    // Seleziona un worker in base alla strategia di bilanciamento del carico
    switch (this.options.loadBalancingStrategy) {
      case 'least-busy':
        // Seleziona il worker con il minor numero di task elaborati
        return availableWorkers.reduce((minWorker, workerId) => {
          if (this.workerStats[workerId].tasksProcessed < this.workerStats[minWorker].tasksProcessed) {
            return workerId;
          }
          return minWorker;
        }, availableWorkers[0]);
        
      case 'round-robin':
        // Seleziona il worker in modo round-robin
        return availableWorkers[0];
        
      case 'random':
        // Seleziona un worker casuale
        return availableWorkers[Math.floor(Math.random() * availableWorkers.length)];
        
      default:
        // Default: least-busy
        return availableWorkers.reduce((minWorker, workerId) => {
          if (this.workerStats[workerId].tasksProcessed < this.workerStats[minWorker].tasksProcessed) {
            return workerId;
          }
          return minWorker;
        }, availableWorkers[0]);
    }
  }
  
  /**
   * Assegna un task a un worker
   * @param {number} workerId - ID del worker
   * @param {Object} task - Task da assegnare
   * @private
   */
  _assignTaskToWorker(workerId, task) {
    // Verifica che il worker esista
    if (!this.workers[workerId] || !this.workerStats[workerId]) {
      console.error(`Cannot assign task to non-existent worker ${workerId}`);
      
      // Rimetti il task in coda
      this._enqueueTask(task, task.priority || this.options.defaultPriority);
      return;
    }
    
    // Verifica che il worker sia disponibile
    if (this.workerStats[workerId].status !== 'idle') {
      console.warn(`Worker ${workerId} is not idle, cannot assign task`);
      
      // Rimetti il task in coda
      this._enqueueTask(task, task.priority || this.options.defaultPriority);
      return;
    }
    
    // Aggiorna lo stato del worker
    this.workerStats[workerId].status = 'busy';
    this.workerStats[workerId].currentTaskId = task.id;
    this.workerStats[workerId].currentTaskStartTime = Date.now();
    
    // Imposta un timeout per il task
    this.taskTimeouts.set(task.id, setTimeout(() => {
      this._handleTaskTimeout(workerId, task.id);
    }, this.options.taskTimeout));
    
    // Invia il task al worker
    try {
      this.workers[workerId].postMessage({
        type: 'execute_task',
        taskId: task.id,
        taskType: task.taskType,
        data: task.data
      });
    } catch (error) {
      console.error(`Error sending task to worker ${workerId}:`, error);
      
      // Resetta lo stato del worker
      this.workerStats[workerId].status = 'idle';
      this.workerStats[workerId].currentTaskId = null;
      this.workerStats[workerId].currentTaskStartTime = null;
      
      // Rimuovi il timeout
      if (this.taskTimeouts.has(task.id)) {
        clearTimeout(this.taskTimeouts.get(task.id));
        this.taskTimeouts.delete(task.id);
      }
      
      // Incrementa il contatore di tentativi
      task.retries = (task.retries || 0) + 1;
      
      // Se il task può essere ritentato, lo rimette in coda
      if (task.retries < this.options.maxRetries) {
        console.log(`Retrying task ${task.id} (attempt ${task.retries + 1}/${this.options.maxRetries + 1})`);
        this.metrics.tasksRetried++;
        
        // Rimetti il task in coda con priorità alta
        this._enqueueTask(task, this.options.priorityLevels - 1);
      } else {
        // Altrimenti, fallisce il task
        console.error(`Task ${task.id} failed after ${task.retries + 1} attempts`);
        this.metrics.tasksFailed++;
        
        // Risolvi la promessa con un errore
        task.reject(new Error(`Failed to send task to worker: ${error.message}`));
        this.pendingTasks.delete(task.id);
      }
      
      // Ricrea il worker
      this._recreateWorker(workerId);
    }
  }
  
  /**
   * Gestisce il timeout di un task
   * @param {number} workerId - ID del worker
   * @param {string} taskId - ID del task
   * @private
   */
  _handleTaskTimeout(workerId, taskId) {
    console.warn(`Task ${taskId} timed out on worker ${workerId}`);
    
    // Verifica che il task esista
    if (!this.pendingTasks.has(taskId)) {
      console.warn(`Timeout for non-existent task ${taskId}`);
      return;
    }
    
    // Recupera il task
    const task = this.pendingTasks.get(taskId);
    
    // Rimuovi il timeout
    this.taskTimeouts.delete(taskId);
    
    // Incrementa il contatore di tentativi
    task.retries = (task.retries || 0) + 1;
    
    // Aggiorna le metriche
    this.metrics.tasksTimedOut++;
    
    // Se il task può essere ritentato, lo rimette in coda
    if (task.retries < this.options.maxRetries) {
      console.log(`Retrying task ${taskId} after timeout (attempt ${task.retries + 1}/${this.options.maxRetries + 1})`);
      this.metrics.tasksRetried++;
      
      // Rimetti il task in coda con priorità alta
      this._enqueueTask(task, this.options.priorityLevels - 1);
    } else {
      // Altrimenti, fallisce il task
      console.error(`Task ${taskId} failed after ${task.retries + 1} attempts (timeout)`);
      this.metrics.tasksFailed++;
      
      // Risolvi la promessa con un errore
      task.reject(new Error(`Task timed out after ${task.retries + 1} attempts`));
      this.pendingTasks.delete(taskId);
    }
    
    // Ricrea il worker
    this._recreateWorker(workerId);
  }
  
  /**
   * Mette in coda un task
   * @param {Object} task - Task da mettere in coda
   * @param {number} priority - Priorità del task
   * @private
   */
  _enqueueTask(task, priority) {
    // Normalizza la priorità
    const normalizedPriority = Math.max(0, Math.min(this.options.priorityLevels - 1, priority));
    
    // Aggiorna la priorità del task
    task.priority = normalizedPriority;
    
    // Aggiungi il task alla coda
    this.taskQueue[normalizedPriority].push(task);
    
    // Verifica se attivare il backpressure
    this._checkBackpressure();
    
    // Processa la coda
    this._processQueue();
  }
  
  /**
   * Verifica se attivare o disattivare il backpressure
   * @private
   */
  _checkBackpressure() {
    // Calcola la dimensione totale della coda
    let totalQueueSize = 0;
    for (const queue of this.taskQueue) {
      totalQueueSize += queue.length;
    }
    
    // Verifica se attivare il backpressure
    if (this.options.enableBackpressure && !this.isBackpressureActive && totalQueueSize >= this.options.maxQueueSize * this.options.backpressureThreshold) {
      this.isBackpressureActive = true;
      this.metrics.backpressureEvents++;
      
      console.warn(`Backpressure activated (queue size: ${totalQueueSize}/${this.options.maxQueueSize})`);
      
      // Emetti evento di backpressure
      this.emit('backpressure', true);
    }
    
    // Verifica se disattivare il backpressure
    if (this.isBackpressureActive && totalQueueSize <= this.options.maxQueueSize * this.options.backpressureReleaseThreshold) {
      this.isBackpressureActive = false;
      
      console.log(`Backpressure released (queue size: ${totalQueueSize}/${this.options.maxQueueSize})`);
      
      // Emetti evento di backpressure
      this.emit('backpressure', false);
    }
  }
  
  /**
   * Esegue un task
   * @param {string} taskType - Tipo di task
   * @param {*} data - Dati del task
   * @param {Object} options - Opzioni del task
   * @returns {Promise<*>} Risultato del task
   */
  async executeTask(taskType, data, options = {}) {
    // Verifica se il pool è in fase di chiusura
    if (this.isShuttingDown) {
      throw new Error('WorkerPool is shutting down');
    }
    
    // Verifica se il backpressure è attivo
    if (this.isBackpressureActive && !options.bypassBackpressure) {
      throw new Error('Backpressure active, task rejected');
    }
    
    // Genera un ID univoco per il task
    const taskId = `task_${Date.now()}_${this.taskIdCounter++}_${crypto.randomBytes(4).toString('hex')}`;
    
    // Crea il task
    const task = {
      id: taskId,
      taskType,
      data,
      priority: options.priority !== undefined ? options.priority : this.options.defaultPriority,
      retries: 0,
      createdAt: Date.now()
    };
    
    // Crea una promessa per il risultato del task
    const promise = new Promise((resolve, reject) => {
      task.resolve = resolve;
      task.reject = reject;
    });
    
    // Aggiungi il task alla mappa dei task in attesa
    this.pendingTasks.set(taskId, task);
    
    // Aggiorna le metriche
    this.metrics.tasksSubmitted++;
    
    // Metti in coda il task
    this._enqueueTask(task, task.priority);
    
    return promise;
  }
  
  /**
   * Esegue un batch di task
   * @param {Array<Object>} tasks - Array di oggetti { taskType, data, options }
   * @returns {Promise<Array<*>>} Array di risultati
   */
  async executeBatch(tasks) {
    // Verifica se il pool è in fase di chiusura
    if (this.isShuttingDown) {
      throw new Error('WorkerPool is shutting down');
    }
    
    // Verifica se il backpressure è attivo
    if (this.isBackpressureActive) {
      throw new Error('Backpressure active, batch rejected');
    }
    
    // Esegui tutti i task in parallelo
    return Promise.all(tasks.map(({ taskType, data, options }) => {
      return this.executeTask(taskType, data, options);
    }));
  }
  
  /**
   * Ottiene le statistiche del pool
   * @returns {Object} Statistiche del pool
   */
  getStats() {
    // Calcola la dimensione totale della coda
    let totalQueueSize = 0;
    for (const queue of this.taskQueue) {
      totalQueueSize += queue.length;
    }
    
    // Calcola l'utilizzo dei worker
    let busyWorkers = 0;
    for (const stat of this.workerStats) {
      if (stat && stat.status === 'busy') {
        busyWorkers++;
      }
    }
    
    const workerUtilization = busyWorkers / this.options.workerCount;
    
    return {
      workerCount: this.options.workerCount,
      busyWorkers,
      idleWorkers: this.options.workerCount - busyWorkers,
      workerUtilization,
      queueSize: totalQueueSize,
      pendingTasks: this.pendingTasks.size,
      isBackpressureActive: this.isBackpressureActive,
      metrics: { ...this.metrics },
      workerStats: [...this.workerStats]
    };
  }
  
  /**
   * Chiude il pool di worker
   * @param {Object} options - Opzioni di chiusura
   * @returns {Promise<void>}
   */
  async close(options = {}) {
    // Imposta il flag di chiusura
    this.isShuttingDown = true;
    
    console.log('Shutting down WorkerPool...');
    
    // Opzioni di chiusura
    const gracefulTimeout = options.gracefulTimeout || 5000; // 5 secondi
    const forceClose = options.forceClose !== false;
    
    // Se ci sono task in attesa, attendi che vengano completati
    if (this.pendingTasks.size > 0 && !forceClose) {
      console.log(`Waiting for ${this.pendingTasks.size} pending tasks to complete...`);
      
      // Attendi che tutti i task vengano completati o che scada il timeout
      const timeoutPromise = new Promise(resolve => setTimeout(resolve, gracefulTimeout));
      const tasksPromise = new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (this.pendingTasks.size === 0) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });
      
      await Promise.race([timeoutPromise, tasksPromise]);
    }
    
    // Termina tutti i worker
    for (const worker of this.workers) {
      if (worker) {
        try {
          worker.terminate();
        } catch (error) {
          console.error('Error terminating worker:', error);
        }
      }
    }
    
    // Resetta lo stato
    this.workers = [];
    this.workerStats = [];
    this.pendingTasks.clear();
    this.taskQueue = Array(this.options.priorityLevels).fill().map(() => []);
    this.isBackpressureActive = false;
    
    // Cancella tutti i timeout
    for (const timeoutId of this.taskTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.taskTimeouts.clear();
    
    console.log('WorkerPool shut down');
    
    // Emetti evento di chiusura
    this.emit('closed');
  }
}

module.exports = { WorkerPool };
