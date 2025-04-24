/**
 * Implementazione del Worker Thread Pool per il Layer-2 su Solana
 * 
 * Questo modulo implementa un pool di worker thread per l'elaborazione parallela
 * ad alte prestazioni delle transazioni e delle operazioni.
 */

const { Worker, isMainThread, parentPort, workerData, MessageChannel } = require('worker_threads');
const { EventEmitter } = require('events');
const { performance } = require('perf_hooks');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { PerformanceMetrics } = require('./performance-metrics');
const { SharedRingBuffer } = require('./shared-ring-buffer');

/**
 * Classe Task
 * 
 * Rappresenta un task da eseguire in un worker thread
 */
class Task {
  /**
   * Costruttore
   * @param {string} id - ID del task
   * @param {string} type - Tipo di task
   * @param {*} data - Dati del task
   * @param {Object} options - Opzioni
   */
  constructor(id, type, data, options = {}) {
    this.id = id || `task-${crypto.randomBytes(4).toString('hex')}`;
    this.type = type;
    this.data = data;
    this.options = options;
    this.priority = options.priority || 0;
    this.createdAt = Date.now();
    this.startedAt = null;
    this.completedAt = null;
    this.result = null;
    this.error = null;
    this.status = 'pending'; // pending, running, completed, failed, cancelled
    this.workerId = null;
    this.retries = 0;
    this.maxRetries = options.maxRetries || 3;
    this.timeout = options.timeout || 30000; // 30 secondi
    this.timeoutTimer = null;
    this.dependencies = options.dependencies || [];
    this.dependents = [];
    this.callbacks = {
      onSuccess: options.onSuccess,
      onError: options.onError,
      onComplete: options.onComplete,
      onCancel: options.onCancel,
      onTimeout: options.onTimeout
    };
  }

  /**
   * Imposta lo stato del task
   * @param {string} status - Nuovo stato
   */
  setStatus(status) {
    this.status = status;

    // Aggiorna i timestamp
    switch (status) {
      case 'running':
        this.startedAt = Date.now();
        break;
      case 'completed':
      case 'failed':
      case 'cancelled':
        this.completedAt = Date.now();
        break;
    }
  }

  /**
   * Imposta il risultato del task
   * @param {*} result - Risultato
   */
  setResult(result) {
    this.result = result;
    this.setStatus('completed');

    // Esegui i callback
    if (typeof this.callbacks.onSuccess === 'function') {
      try {
        this.callbacks.onSuccess(result, this);
      } catch (error) {
        console.error(`Errore nel callback onSuccess del task ${this.id}:`, error);
      }
    }

    if (typeof this.callbacks.onComplete === 'function') {
      try {
        this.callbacks.onComplete(result, null, this);
      } catch (error) {
        console.error(`Errore nel callback onComplete del task ${this.id}:`, error);
      }
    }
  }

  /**
   * Imposta l'errore del task
   * @param {Error} error - Errore
   */
  setError(error) {
    this.error = error;
    this.setStatus('failed');

    // Esegui i callback
    if (typeof this.callbacks.onError === 'function') {
      try {
        this.callbacks.onError(error, this);
      } catch (callbackError) {
        console.error(`Errore nel callback onError del task ${this.id}:`, callbackError);
      }
    }

    if (typeof this.callbacks.onComplete === 'function') {
      try {
        this.callbacks.onComplete(null, error, this);
      } catch (callbackError) {
        console.error(`Errore nel callback onComplete del task ${this.id}:`, callbackError);
      }
    }
  }

  /**
   * Annulla il task
   */
  cancel() {
    // Verifica che il task possa essere annullato
    if (this.status !== 'pending' && this.status !== 'running') {
      return false;
    }

    // Annulla il timeout
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }

    // Imposta lo stato
    this.setStatus('cancelled');

    // Esegui i callback
    if (typeof this.callbacks.onCancel === 'function') {
      try {
        this.callbacks.onCancel(this);
      } catch (error) {
        console.error(`Errore nel callback onCancel del task ${this.id}:`, error);
      }
    }

    if (typeof this.callbacks.onComplete === 'function') {
      try {
        this.callbacks.onComplete(null, new Error('Task cancelled'), this);
      } catch (error) {
        console.error(`Errore nel callback onComplete del task ${this.id}:`, error);
      }
    }

    return true;
  }

  /**
   * Imposta il timeout del task
   */
  setTimeout() {
    // Annulla il timeout esistente
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }

    // Verifica che il timeout sia valido
    if (!this.timeout || this.timeout <= 0) {
      return;
    }

    // Imposta il timeout
    this.timeoutTimer = setTimeout(() => {
      // Verifica che il task sia ancora in esecuzione
      if (this.status !== 'running') {
        return;
      }

      // Imposta lo stato
      this.setStatus('failed');
      this.error = new Error(`Task timeout after ${this.timeout}ms`);

      // Esegui i callback
      if (typeof this.callbacks.onTimeout === 'function') {
        try {
          this.callbacks.onTimeout(this);
        } catch (error) {
          console.error(`Errore nel callback onTimeout del task ${this.id}:`, error);
        }
      }

      if (typeof this.callbacks.onError === 'function') {
        try {
          this.callbacks.onError(this.error, this);
        } catch (error) {
          console.error(`Errore nel callback onError del task ${this.id}:`, error);
        }
      }

      if (typeof this.callbacks.onComplete === 'function') {
        try {
          this.callbacks.onComplete(null, this.error, this);
        } catch (error) {
          console.error(`Errore nel callback onComplete del task ${this.id}:`, error);
        }
      }
    }, this.timeout);
  }

  /**
   * Incrementa il contatore di tentativi
   * @returns {number} - Nuovo numero di tentativi
   */
  incrementRetries() {
    return ++this.retries;
  }

  /**
   * Verifica se il task può essere ritentato
   * @returns {boolean} - True se il task può essere ritentato
   */
  canRetry() {
    return this.retries < this.maxRetries;
  }

  /**
   * Aggiunge una dipendenza
   * @param {string} taskId - ID del task dipendente
   */
  addDependency(taskId) {
    if (!this.dependencies.includes(taskId)) {
      this.dependencies.push(taskId);
    }
  }

  /**
   * Aggiunge un task dipendente
   * @param {string} taskId - ID del task dipendente
   */
  addDependent(taskId) {
    if (!this.dependents.includes(taskId)) {
      this.dependents.push(taskId);
    }
  }

  /**
   * Rimuove una dipendenza
   * @param {string} taskId - ID del task dipendente
   */
  removeDependency(taskId) {
    const index = this.dependencies.indexOf(taskId);
    if (index !== -1) {
      this.dependencies.splice(index, 1);
    }
  }

  /**
   * Rimuove un task dipendente
   * @param {string} taskId - ID del task dipendente
   */
  removeDependent(taskId) {
    const index = this.dependents.indexOf(taskId);
    if (index !== -1) {
      this.dependents.splice(index, 1);
    }
  }

  /**
   * Verifica se il task ha dipendenze
   * @returns {boolean} - True se il task ha dipendenze
   */
  hasDependencies() {
    return this.dependencies.length > 0;
  }

  /**
   * Verifica se il task ha dipendenti
   * @returns {boolean} - True se il task ha dipendenti
   */
  hasDependents() {
    return this.dependents.length > 0;
  }

  /**
   * Verifica se il task è in attesa
   * @returns {boolean} - True se il task è in attesa
   */
  isPending() {
    return this.status === 'pending';
  }

  /**
   * Verifica se il task è in esecuzione
   * @returns {boolean} - True se il task è in esecuzione
   */
  isRunning() {
    return this.status === 'running';
  }

  /**
   * Verifica se il task è completato
   * @returns {boolean} - True se il task è completato
   */
  isCompleted() {
    return this.status === 'completed';
  }

  /**
   * Verifica se il task è fallito
   * @returns {boolean} - True se il task è fallito
   */
  isFailed() {
    return this.status === 'failed';
  }

  /**
   * Verifica se il task è annullato
   * @returns {boolean} - True se il task è annullato
   */
  isCancelled() {
    return this.status === 'cancelled';
  }

  /**
   * Verifica se il task è terminato
   * @returns {boolean} - True se il task è terminato
   */
  isFinished() {
    return this.isCompleted() || this.isFailed() || this.isCancelled();
  }

  /**
   * Ottiene la durata del task
   * @returns {number} - Durata in millisecondi
   */
  getDuration() {
    if (!this.startedAt) {
      return 0;
    }

    const endTime = this.completedAt || Date.now();
    return endTime - this.startedAt;
  }

  /**
   * Ottiene il tempo di attesa del task
   * @returns {number} - Tempo di attesa in millisecondi
   */
  getWaitTime() {
    if (!this.createdAt) {
      return 0;
    }

    const startTime = this.startedAt || Date.now();
    return startTime - this.createdAt;
  }

  /**
   * Ottiene il tempo totale del task
   * @returns {number} - Tempo totale in millisecondi
   */
  getTotalTime() {
    if (!this.createdAt) {
      return 0;
    }

    const endTime = this.completedAt || Date.now();
    return endTime - this.createdAt;
  }

  /**
   * Serializza il task
   * @returns {Object} - Task serializzato
   */
  serialize() {
    return {
      id: this.id,
      type: this.type,
      data: this.data,
      priority: this.priority,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      status: this.status,
      workerId: this.workerId,
      retries: this.retries,
      maxRetries: this.maxRetries,
      timeout: this.timeout,
      dependencies: this.dependencies,
      dependents: this.dependents
    };
  }

  /**
   * Deserializza un task
   * @param {Object} data - Task serializzato
   * @returns {Task} - Task deserializzato
   */
  static deserialize(data) {
    const task = new Task(data.id, data.type, data.data, {
      priority: data.priority,
      maxRetries: data.maxRetries,
      timeout: data.timeout,
      dependencies: data.dependencies
    });

    task.createdAt = data.createdAt;
    task.startedAt = data.startedAt;
    task.completedAt = data.completedAt;
    task.status = data.status;
    task.workerId = data.workerId;
    task.retries = data.retries;
    task.dependents = data.dependents || [];

    return task;
  }
}

/**
 * Classe TaskQueue
 * 
 * Implementa una coda di task con priorità
 */
class TaskQueue {
  /**
   * Costruttore
   * @param {Object} options - Opzioni
   */
  constructor(options = {}) {
    this.options = {
      maxSize: options.maxSize || 10000,
      ...options
    };

    this.queue = [];
    this.taskMap = new Map();
    this.dependencyGraph = new Map();
  }

  /**
   * Aggiunge un task alla coda
   * @param {Task} task - Task da aggiungere
   * @returns {boolean} - True se il task è stato aggiunto
   */
  enqueue(task) {
    // Verifica che la coda non sia piena
    if (this.queue.length >= this.options.maxSize) {
      return false;
    }

    // Verifica che il task non sia già nella coda
    if (this.taskMap.has(task.id)) {
      return false;
    }

    // Aggiungi il task alla coda
    this.queue.push(task);
    this.taskMap.set(task.id, task);

    // Aggiorna il grafo delle dipendenze
    this.updateDependencyGraph(task);

    // Ordina la coda per priorità
    this.sortQueue();

    return true;
  }

  /**
   * Rimuove un task dalla coda
   * @param {string} taskId - ID del task da rimuovere
   * @returns {Task} - Task rimosso
   */
  remove(taskId) {
    // Verifica che il task sia nella coda
    if (!this.taskMap.has(taskId)) {
      return null;
    }

    // Ottieni il task
    const task = this.taskMap.get(taskId);

    // Rimuovi il task dalla coda
    const index = this.queue.findIndex(t => t.id === taskId);
    if (index !== -1) {
      this.queue.splice(index, 1);
    }

    // Rimuovi il task dalla mappa
    this.taskMap.delete(taskId);

    // Rimuovi il task dal grafo delle dipendenze
    this.removeDependencyNode(taskId);

    return task;
  }

  /**
   * Ottiene il prossimo task dalla coda
   * @returns {Task} - Prossimo task
   */
  dequeue() {
    // Verifica che la coda non sia vuota
    if (this.queue.length === 0) {
      return null;
    }

    // Trova il primo task senza dipendenze
    for (let i = 0; i < this.queue.length; i++) {
      const task = this.queue[i];

      // Verifica che il task non abbia dipendenze
      if (!task.hasDependencies()) {
        // Rimuovi il task dalla coda
        this.queue.splice(i, 1);
        this.taskMap.delete(task.id);

        // Rimuovi il task dal grafo delle dipendenze
        this.removeDependencyNode(task.id);

        return task;
      }
    }

    return null;
  }

  /**
   * Ottiene un task dalla coda
   * @param {string} taskId - ID del task
   * @returns {Task} - Task
   */
  getTask(taskId) {
    return this.taskMap.get(taskId) || null;
  }

  /**
   * Verifica se un task è nella coda
   * @param {string} taskId - ID del task
   * @returns {boolean} - True se il task è nella coda
   */
  hasTask(taskId) {
    return this.taskMap.has(taskId);
  }

  /**
   * Aggiorna la priorità di un task
   * @param {string} taskId - ID del task
   * @param {number} priority - Nuova priorità
   * @returns {boolean} - True se la priorità è stata aggiornata
   */
  updatePriority(taskId, priority) {
    // Verifica che il task sia nella coda
    if (!this.taskMap.has(taskId)) {
      return false;
    }

    // Ottieni il task
    const task = this.taskMap.get(taskId);

    // Aggiorna la priorità
    task.priority = priority;

    // Ordina la coda
    this.sortQueue();

    return true;
  }

  /**
   * Ordina la coda per priorità
   * @private
   */
  sortQueue() {
    this.queue.sort((a, b) => {
      // Ordina per priorità (decrescente)
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }

      // Ordina per tempo di creazione (crescente)
      return a.createdAt - b.createdAt;
    });
  }

  /**
   * Aggiorna il grafo delle dipendenze
   * @param {Task} task - Task
   * @private
   */
  updateDependencyGraph(task) {
    // Aggiungi il nodo al grafo
    if (!this.dependencyGraph.has(task.id)) {
      this.dependencyGraph.set(task.id, {
        dependencies: new Set(),
        dependents: new Set()
      });
    }

    const node = this.dependencyGraph.get(task.id);

    // Aggiungi le dipendenze
    for (const depId of task.dependencies) {
      node.dependencies.add(depId);

      // Aggiungi il task come dipendente
      if (!this.dependencyGraph.has(depId)) {
        this.dependencyGraph.set(depId, {
          dependencies: new Set(),
          dependents: new Set()
        });
      }

      this.dependencyGraph.get(depId).dependents.add(task.id);
    }

    // Aggiungi i dipendenti
    for (const depId of task.dependents) {
      node.dependents.add(depId);

      // Aggiungi il task come dipendenza
      if (!this.dependencyGraph.has(depId)) {
        this.dependencyGraph.set(depId, {
          dependencies: new Set(),
          dependents: new Set()
        });
      }

      this.dependencyGraph.get(depId).dependencies.add(task.id);
    }
  }

  /**
   * Rimuove un nodo dal grafo delle dipendenze
   * @param {string} taskId - ID del task
   * @private
   */
  removeDependencyNode(taskId) {
    // Verifica che il nodo esista
    if (!this.dependencyGraph.has(taskId)) {
      return;
    }

    const node = this.dependencyGraph.get(taskId);

    // Rimuovi il nodo dalle dipendenze dei dipendenti
    for (const depId of node.dependents) {
      if (this.dependencyGraph.has(depId)) {
        this.dependencyGraph.get(depId).dependencies.delete(taskId);
      }

      // Aggiorna il task
      if (this.taskMap.has(depId)) {
        this.taskMap.get(depId).removeDependency(taskId);
      }
    }

    // Rimuovi il nodo dai dipendenti delle dipendenze
    for (const depId of node.dependencies) {
      if (this.dependencyGraph.has(depId)) {
        this.dependencyGraph.get(depId).dependents.delete(taskId);
      }

      // Aggiorna il task
      if (this.taskMap.has(depId)) {
        this.taskMap.get(depId).removeDependent(taskId);
      }
    }

    // Rimuovi il nodo
    this.dependencyGraph.delete(taskId);
  }

  /**
   * Notifica il completamento di un task
   * @param {string} taskId - ID del task
   */
  notifyTaskCompletion(taskId) {
    // Verifica che il nodo esista
    if (!this.dependencyGraph.has(taskId)) {
      return;
    }

    const node = this.dependencyGraph.get(taskId);

    // Rimuovi il task dalle dipendenze dei dipendenti
    for (const depId of node.dependents) {
      if (this.taskMap.has(depId)) {
        this.taskMap.get(depId).removeDependency(taskId);
      }
    }
  }

  /**
   * Ottiene la dimensione della coda
   * @returns {number} - Dimensione della coda
   */
  size() {
    return this.queue.length;
  }

  /**
   * Verifica se la coda è vuota
   * @returns {boolean} - True se la coda è vuota
   */
  isEmpty() {
    return this.queue.length === 0;
  }

  /**
   * Verifica se la coda è piena
   * @returns {boolean} - True se la coda è piena
   */
  isFull() {
    return this.queue.length >= this.options.maxSize;
  }

  /**
   * Svuota la coda
   */
  clear() {
    this.queue = [];
    this.taskMap.clear();
    this.dependencyGraph.clear();
  }

  /**
   * Ottiene tutti i task nella coda
   * @returns {Array<Task>} - Task nella coda
   */
  getTasks() {
    return [...this.queue];
  }

  /**
   * Ottiene le statistiche della coda
   * @returns {Object} - Statistiche
   */
  getStats() {
    // Conta i task per stato
    const statusCount = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0
    };

    for (const task of this.queue) {
      statusCount[task.status]++;
    }

    // Calcola la priorità media
    let totalPriority = 0;
    for (const task of this.queue) {
      totalPriority += task.priority;
    }
    const avgPriority = this.queue.length > 0 ? totalPriority / this.queue.length : 0;

    return {
      size: this.queue.length,
      maxSize: this.options.maxSize,
      usage: this.queue.length / this.options.maxSize,
      statusCount,
      avgPriority
    };
  }
}

/**
 * Classe WorkerThread
 * 
 * Rappresenta un worker thread nel pool
 */
class WorkerThread extends EventEmitter {
  /**
   * Costruttore
   * @param {string} id - ID del worker
   * @param {string} scriptPath - Percorso dello script del worker
   * @param {Object} options - Opzioni
   */
  constructor(id, scriptPath, options = {}) {
    super();
    
    this.id = id;
    this.scriptPath = scriptPath;
    this.options = {
      workerData: options.workerData || {},
      maxTasks: options.maxTasks || 0, // 0 = illimitato
      maxIdleTime: options.maxIdleTime || 60000, // 1 minuto
      ...options
    };
    
    this.worker = null;
    this.status = 'idle'; // idle, busy, error, terminated
    this.currentTask = null;
    this.taskCount = 0;
    this.errorCount = 0;
    this.startTime = null;
    this.lastTaskTime = null;
    this.terminateTimer = null;
    
    // Inizializza il worker
    this._initialize();
  }
  
  /**
   * Inizializza il worker
   * @private
   */
  _initialize() {
    try {
      // Crea il worker
      this.worker = new Worker(this.scriptPath, {
        workerData: this.options.workerData
      });
      
      // Registra gli eventi
      this.worker.on('message', this._handleMessage.bind(this));
      this.worker.on('error', this._handleError.bind(this));
      this.worker.on('exit', this._handleExit.bind(this));
      
      // Imposta lo stato
      this.status = 'idle';
      this.startTime = Date.now();
      
      // Emetti evento
      this.emit('initialized', {
        id: this.id,
        status: this.status
      });
      
      console.log(`WorkerThread ${this.id} inizializzato`);
    } catch (error) {
      console.error(`Errore durante l'inizializzazione del worker ${this.id}:`, error);
      
      // Imposta lo stato
      this.status = 'error';
      this.errorCount++;
      
      // Emetti evento
      this.emit('error', {
        id: this.id,
        error
      });
    }
  }
  
  /**
   * Gestisce i messaggi dal worker
   * @param {*} message - Messaggio
   * @private
   */
  _handleMessage(message) {
    try {
      // Verifica che il messaggio sia valido
      if (!message || typeof message !== 'object') {
        return;
      }
      
      // Gestisci il messaggio in base al tipo
      switch (message.type) {
        case 'task_result':
          this._handleTaskResult(message.taskId, message.result, null);
          break;
          
        case 'task_error':
          this._handleTaskResult(message.taskId, null, new Error(message.error));
          break;
          
        case 'status':
          this._handleStatusUpdate(message.status);
          break;
          
        case 'log':
          this._handleLog(message.level, message.message, message.data);
          break;
          
        default:
          // Emetti evento
          this.emit('message', {
            id: this.id,
            message
          });
      }
    } catch (error) {
      console.error(`Errore durante la gestione del messaggio dal worker ${this.id}:`, error);
      
      // Emetti evento
      this.emit('error', {
        id: this.id,
        error
      });
    }
  }
  
  /**
   * Gestisce gli errori dal worker
   * @param {Error} error - Errore
   * @private
   */
  _handleError(error) {
    console.error(`Errore nel worker ${this.id}:`, error);
    
    // Imposta lo stato
    this.status = 'error';
    this.errorCount++;
    
    // Gestisci il task corrente
    if (this.currentTask) {
      this._handleTaskResult(this.currentTask.id, null, error);
    }
    
    // Emetti evento
    this.emit('worker_error', {
      id: this.id,
      error
    });
  }
  
  /**
   * Gestisce l'uscita del worker
   * @param {number} code - Codice di uscita
   * @private
   */
  _handleExit(code) {
    console.log(`Worker ${this.id} terminato con codice ${code}`);
    
    // Imposta lo stato
    this.status = 'terminated';
    
    // Gestisci il task corrente
    if (this.currentTask) {
      this._handleTaskResult(
        this.currentTask.id,
        null,
        new Error(`Worker terminated with code ${code}`)
      );
    }
    
    // Emetti evento
    this.emit('terminated', {
      id: this.id,
      code
    });
  }
  
  /**
   * Gestisce il risultato di un task
   * @param {string} taskId - ID del task
   * @param {*} result - Risultato
   * @param {Error} error - Errore
   * @private
   */
  _handleTaskResult(taskId, result, error) {
    // Verifica che ci sia un task corrente
    if (!this.currentTask || this.currentTask.id !== taskId) {
      return;
    }
    
    // Aggiorna lo stato del task
    if (error) {
      this.currentTask.setError(error);
    } else {
      this.currentTask.setResult(result);
    }
    
    // Aggiorna lo stato del worker
    this.status = 'idle';
    this.currentTask = null;
    this.lastTaskTime = Date.now();
    
    // Avvia il timer di terminazione
    this._startTerminateTimer();
    
    // Emetti evento
    this.emit('task_completed', {
      id: this.id,
      taskId,
      result,
      error
    });
  }
  
  /**
   * Gestisce l'aggiornamento dello stato
   * @param {string} status - Nuovo stato
   * @private
   */
  _handleStatusUpdate(status) {
    // Aggiorna lo stato
    this.status = status;
    
    // Emetti evento
    this.emit('status_changed', {
      id: this.id,
      status
    });
  }
  
  /**
   * Gestisce i log dal worker
   * @param {string} level - Livello di log
   * @param {string} message - Messaggio
   * @param {*} data - Dati aggiuntivi
   * @private
   */
  _handleLog(level, message, data) {
    // Emetti evento
    this.emit('log', {
      id: this.id,
      level,
      message,
      data
    });
    
    // Logga il messaggio
    switch (level) {
      case 'error':
        console.error(`[Worker ${this.id}] ${message}`, data);
        break;
      case 'warn':
        console.warn(`[Worker ${this.id}] ${message}`, data);
        break;
      case 'info':
        console.info(`[Worker ${this.id}] ${message}`, data);
        break;
      case 'debug':
        console.debug(`[Worker ${this.id}] ${message}`, data);
        break;
      default:
        console.log(`[Worker ${this.id}] ${message}`, data);
    }
  }
  
  /**
   * Avvia il timer di terminazione
   * @private
   */
  _startTerminateTimer() {
    // Annulla il timer esistente
    if (this.terminateTimer) {
      clearTimeout(this.terminateTimer);
      this.terminateTimer = null;
    }
    
    // Verifica che il tempo di inattività massimo sia valido
    if (!this.options.maxIdleTime || this.options.maxIdleTime <= 0) {
      return;
    }
    
    // Verifica che il worker sia inattivo
    if (this.status !== 'idle') {
      return;
    }
    
    // Avvia il timer
    this.terminateTimer = setTimeout(() => {
      // Verifica che il worker sia ancora inattivo
      if (this.status !== 'idle') {
        return;
      }
      
      // Verifica che il worker sia inattivo da abbastanza tempo
      const idleTime = Date.now() - (this.lastTaskTime || this.startTime);
      if (idleTime < this.options.maxIdleTime) {
        return;
      }
      
      // Termina il worker
      this.terminate();
    }, this.options.maxIdleTime);
  }
  
  /**
   * Esegue un task
   * @param {Task} task - Task da eseguire
   * @returns {boolean} - True se il task è stato accettato
   */
  executeTask(task) {
    // Verifica che il worker sia disponibile
    if (this.status !== 'idle') {
      return false;
    }
    
    // Verifica che il worker non abbia raggiunto il limite di task
    if (this.options.maxTasks > 0 && this.taskCount >= this.options.maxTasks) {
      return false;
    }
    
    try {
      // Annulla il timer di terminazione
      if (this.terminateTimer) {
        clearTimeout(this.terminateTimer);
        this.terminateTimer = null;
      }
      
      // Imposta lo stato
      this.status = 'busy';
      this.currentTask = task;
      this.taskCount++;
      
      // Imposta lo stato del task
      task.setStatus('running');
      task.workerId = this.id;
      
      // Imposta il timeout del task
      task.setTimeout();
      
      // Invia il task al worker
      this.worker.postMessage({
        type: 'execute_task',
        task: task.serialize()
      });
      
      // Emetti evento
      this.emit('task_started', {
        id: this.id,
        taskId: task.id
      });
      
      return true;
    } catch (error) {
      console.error(`Errore durante l'esecuzione del task ${task.id} nel worker ${this.id}:`, error);
      
      // Imposta lo stato
      this.status = 'error';
      this.errorCount++;
      this.currentTask = null;
      
      // Imposta lo stato del task
      task.setError(error);
      
      // Emetti evento
      this.emit('error', {
        id: this.id,
        taskId: task.id,
        error
      });
      
      return false;
    }
  }
  
  /**
   * Annulla il task corrente
   * @returns {boolean} - True se il task è stato annullato
   */
  cancelTask() {
    // Verifica che ci sia un task corrente
    if (!this.currentTask) {
      return false;
    }
    
    try {
      // Invia il messaggio di annullamento al worker
      this.worker.postMessage({
        type: 'cancel_task',
        taskId: this.currentTask.id
      });
      
      // Annulla il task
      const result = this.currentTask.cancel();
      
      // Aggiorna lo stato
      this.status = 'idle';
      this.currentTask = null;
      this.lastTaskTime = Date.now();
      
      // Avvia il timer di terminazione
      this._startTerminateTimer();
      
      // Emetti evento
      this.emit('task_cancelled', {
        id: this.id,
        taskId: this.currentTask.id
      });
      
      return result;
    } catch (error) {
      console.error(`Errore durante l'annullamento del task nel worker ${this.id}:`, error);
      
      // Emetti evento
      this.emit('error', {
        id: this.id,
        error
      });
      
      return false;
    }
  }
  
  /**
   * Termina il worker
   * @returns {boolean} - True se il worker è stato terminato
   */
  terminate() {
    try {
      // Verifica che il worker non sia già terminato
      if (this.status === 'terminated') {
        return false;
      }
      
      // Annulla il timer di terminazione
      if (this.terminateTimer) {
        clearTimeout(this.terminateTimer);
        this.terminateTimer = null;
      }
      
      // Annulla il task corrente
      if (this.currentTask) {
        this.cancelTask();
      }
      
      // Termina il worker
      this.worker.terminate();
      
      // Imposta lo stato
      this.status = 'terminated';
      
      // Emetti evento
      this.emit('terminated', {
        id: this.id,
        code: 0
      });
      
      return true;
    } catch (error) {
      console.error(`Errore durante la terminazione del worker ${this.id}:`, error);
      
      // Emetti evento
      this.emit('error', {
        id: this.id,
        error
      });
      
      return false;
    }
  }
  
  /**
   * Invia un messaggio al worker
   * @param {*} message - Messaggio
   * @returns {boolean} - True se il messaggio è stato inviato
   */
  sendMessage(message) {
    try {
      // Verifica che il worker non sia terminato
      if (this.status === 'terminated') {
        return false;
      }
      
      // Invia il messaggio
      this.worker.postMessage(message);
      
      return true;
    } catch (error) {
      console.error(`Errore durante l'invio del messaggio al worker ${this.id}:`, error);
      
      // Emetti evento
      this.emit('error', {
        id: this.id,
        error
      });
      
      return false;
    }
  }
  
  /**
   * Verifica se il worker è disponibile
   * @returns {boolean} - True se il worker è disponibile
   */
  isAvailable() {
    return this.status === 'idle';
  }
  
  /**
   * Verifica se il worker è occupato
   * @returns {boolean} - True se il worker è occupato
   */
  isBusy() {
    return this.status === 'busy';
  }
  
  /**
   * Verifica se il worker è in errore
   * @returns {boolean} - True se il worker è in errore
   */
  isError() {
    return this.status === 'error';
  }
  
  /**
   * Verifica se il worker è terminato
   * @returns {boolean} - True se il worker è terminato
   */
  isTerminated() {
    return this.status === 'terminated';
  }
  
  /**
   * Ottiene il tempo di attività del worker
   * @returns {number} - Tempo di attività in millisecondi
   */
  getUptime() {
    return Date.now() - this.startTime;
  }
  
  /**
   * Ottiene il tempo di inattività del worker
   * @returns {number} - Tempo di inattività in millisecondi
   */
  getIdleTime() {
    if (this.status !== 'idle') {
      return 0;
    }
    
    return Date.now() - (this.lastTaskTime || this.startTime);
  }
  
  /**
   * Ottiene le statistiche del worker
   * @returns {Object} - Statistiche
   */
  getStats() {
    return {
      id: this.id,
      status: this.status,
      taskCount: this.taskCount,
      errorCount: this.errorCount,
      startTime: this.startTime,
      lastTaskTime: this.lastTaskTime,
      uptime: this.getUptime(),
      idleTime: this.getIdleTime(),
      currentTask: this.currentTask ? this.currentTask.serialize() : null
    };
  }
}

/**
 * Classe WorkerThreadPool
 * 
 * Implementa un pool di worker thread
 */
class WorkerThreadPool extends EventEmitter {
  /**
   * Costruttore
   * @param {Object} options - Opzioni
   */
  constructor(options = {}) {
    super();
    
    this.options = {
      minWorkers: options.minWorkers || 1,
      maxWorkers: options.maxWorkers || Math.max(1, os.cpus().length - 1),
      workerScript: options.workerScript || path.join(__dirname, 'worker-thread.js'),
      workerOptions: options.workerOptions || {},
      taskQueueSize: options.taskQueueSize || 10000,
      taskTimeout: options.taskTimeout || 30000, // 30 secondi
      taskRetries: options.taskRetries || 3,
      workerIdleTimeout: options.workerIdleTimeout || 60000, // 1 minuto
      enableMetrics: options.enableMetrics !== false,
      metricsInterval: options.metricsInterval || 10000, // 10 secondi
      ...options
    };
    
    // Genera un ID univoco per il pool
    this.id = options.id || `worker-pool-${crypto.randomBytes(4).toString('hex')}`;
    
    // Stato interno
    this.workers = new Map();
    this.taskQueue = new TaskQueue({ maxSize: this.options.taskQueueSize });
    this.taskMap = new Map();
    this.isRunning = false;
    this.startTime = null;
    
    // Metriche
    this.metrics = new PerformanceMetrics('worker_pool', {
      enableMetrics: this.options.enableMetrics,
      metricsInterval: this.options.metricsInterval
    });
    
    // Inizializza il pool
    this._initialize();
  }
  
  /**
   * Inizializza il pool
   * @private
   */
  _initialize() {
    // Crea i worker iniziali
    for (let i = 0; i < this.options.minWorkers; i++) {
      this._createWorker();
    }
    
    // Imposta lo stato
    this.isRunning = true;
    this.startTime = Date.now();
    
    console.log(`WorkerThreadPool inizializzato con ${this.options.minWorkers} worker`);
  }
  
  /**
   * Crea un worker
   * @returns {WorkerThread} - Worker creato
   * @private
   */
  _createWorker() {
    try {
      // Genera un ID univoco per il worker
      const workerId = `worker-${crypto.randomBytes(4).toString('hex')}`;
      
      // Crea il worker
      const worker = new WorkerThread(workerId, this.options.workerScript, {
        ...this.options.workerOptions,
        maxIdleTime: this.options.workerIdleTimeout
      });
      
      // Registra gli eventi
      worker.on('task_completed', this._handleTaskCompleted.bind(this));
      worker.on('task_cancelled', this._handleTaskCancelled.bind(this));
      worker.on('error', this._handleWorkerError.bind(this));
      worker.on('terminated', this._handleWorkerTerminated.bind(this));
      
      // Memorizza il worker
      this.workers.set(workerId, worker);
      
      // Emetti evento
      this.emit('worker_created', {
        id: workerId
      });
      
      // Aggiorna le metriche
      this.metrics.setGauge('workers_total', this.workers.size);
      
      return worker;
    } catch (error) {
      console.error('Errore durante la creazione del worker:', error);
      
      // Emetti evento
      this.emit('error', {
        operation: 'createWorker',
        error
      });
      
      return null;
    }
  }
  
  /**
   * Gestisce il completamento di un task
   * @param {Object} event - Evento
   * @private
   */
  _handleTaskCompleted(event) {
    try {
      // Verifica che il task esista
      if (!this.taskMap.has(event.taskId)) {
        return;
      }
      
      // Ottieni il task
      const task = this.taskMap.get(event.taskId);
      
      // Rimuovi il task dalla mappa
      this.taskMap.delete(event.taskId);
      
      // Notifica il completamento del task
      this.taskQueue.notifyTaskCompletion(event.taskId);
      
      // Aggiorna le metriche
      this.metrics.incrementCounter('tasks_completed');
      this.metrics.recordLatency('task_execution', task.getDuration());
      this.metrics.recordLatency('task_wait', task.getWaitTime());
      this.metrics.recordLatency('task_total', task.getTotalTime());
      
      // Emetti evento
      this.emit('task_completed', {
        taskId: event.taskId,
        result: event.result,
        error: event.error
      });
      
      // Elabora il prossimo task
      this._processNextTask();
    } catch (error) {
      console.error(`Errore durante la gestione del completamento del task ${event.taskId}:`, error);
      
      // Emetti evento
      this.emit('error', {
        operation: 'handleTaskCompleted',
        taskId: event.taskId,
        error
      });
    }
  }
  
  /**
   * Gestisce l'annullamento di un task
   * @param {Object} event - Evento
   * @private
   */
  _handleTaskCancelled(event) {
    try {
      // Verifica che il task esista
      if (!this.taskMap.has(event.taskId)) {
        return;
      }
      
      // Ottieni il task
      const task = this.taskMap.get(event.taskId);
      
      // Rimuovi il task dalla mappa
      this.taskMap.delete(event.taskId);
      
      // Notifica il completamento del task
      this.taskQueue.notifyTaskCompletion(event.taskId);
      
      // Aggiorna le metriche
      this.metrics.incrementCounter('tasks_cancelled');
      
      // Emetti evento
      this.emit('task_cancelled', {
        taskId: event.taskId
      });
      
      // Elabora il prossimo task
      this._processNextTask();
    } catch (error) {
      console.error(`Errore durante la gestione dell'annullamento del task ${event.taskId}:`, error);
      
      // Emetti evento
      this.emit('error', {
        operation: 'handleTaskCancelled',
        taskId: event.taskId,
        error
      });
    }
  }
  
  /**
   * Gestisce gli errori dei worker
   * @param {Object} event - Evento
   * @private
   */
  _handleWorkerError(event) {
    try {
      // Aggiorna le metriche
      this.metrics.incrementCounter('worker_errors');
      
      // Emetti evento
      this.emit('worker_error', {
        workerId: event.id,
        error: event.error
      });
      
      // Verifica se il worker deve essere sostituito
      const worker = this.workers.get(event.id);
      if (worker && worker.errorCount > 3) {
        // Termina il worker
        worker.terminate();
        
        // Rimuovi il worker
        this.workers.delete(event.id);
        
        // Crea un nuovo worker se necessario
        if (this.workers.size < this.options.minWorkers) {
          this._createWorker();
        }
        
        // Aggiorna le metriche
        this.metrics.setGauge('workers_total', this.workers.size);
      }
    } catch (error) {
      console.error(`Errore durante la gestione dell'errore del worker ${event.id}:`, error);
      
      // Emetti evento
      this.emit('error', {
        operation: 'handleWorkerError',
        workerId: event.id,
        error
      });
    }
  }
  
  /**
   * Gestisce la terminazione dei worker
   * @param {Object} event - Evento
   * @private
   */
  _handleWorkerTerminated(event) {
    try {
      // Rimuovi il worker
      this.workers.delete(event.id);
      
      // Aggiorna le metriche
      this.metrics.setGauge('workers_total', this.workers.size);
      this.metrics.incrementCounter('workers_terminated');
      
      // Emetti evento
      this.emit('worker_terminated', {
        workerId: event.id,
        code: event.code
      });
      
      // Crea un nuovo worker se necessario
      if (this.isRunning && this.workers.size < this.options.minWorkers) {
        this._createWorker();
      }
    } catch (error) {
      console.error(`Errore durante la gestione della terminazione del worker ${event.id}:`, error);
      
      // Emetti evento
      this.emit('error', {
        operation: 'handleWorkerTerminated',
        workerId: event.id,
        error
      });
    }
  }
  
  /**
   * Elabora il prossimo task nella coda
   * @private
   */
  _processNextTask() {
    try {
      // Verifica che il pool sia in esecuzione
      if (!this.isRunning) {
        return;
      }
      
      // Verifica che ci siano task nella coda
      if (this.taskQueue.isEmpty()) {
        return;
      }
      
      // Trova un worker disponibile
      const availableWorker = this._findAvailableWorker();
      
      // Verifica che ci sia un worker disponibile
      if (!availableWorker) {
        // Crea un nuovo worker se possibile
        if (this.workers.size < this.options.maxWorkers) {
          const worker = this._createWorker();
          
          // Verifica che il worker sia stato creato
          if (worker) {
            // Elabora il prossimo task
            setImmediate(() => this._processNextTask());
          }
        }
        
        return;
      }
      
      // Ottieni il prossimo task
      const task = this.taskQueue.dequeue();
      
      // Verifica che ci sia un task
      if (!task) {
        return;
      }
      
      // Esegui il task
      const success = availableWorker.executeTask(task);
      
      // Verifica che il task sia stato accettato
      if (!success) {
        // Rimetti il task nella coda
        this.taskQueue.enqueue(task);
        
        // Aggiorna le metriche
        this.metrics.incrementCounter('task_execution_failures');
        
        return;
      }
      
      // Memorizza il task
      this.taskMap.set(task.id, task);
      
      // Aggiorna le metriche
      this.metrics.incrementCounter('tasks_started');
      this.metrics.setGauge('tasks_pending', this.taskQueue.size());
      this.metrics.setGauge('tasks_running', this.taskMap.size);
      
      // Elabora il prossimo task
      setImmediate(() => this._processNextTask());
    } catch (error) {
      console.error('Errore durante l\'elaborazione del prossimo task:', error);
      
      // Emetti evento
      this.emit('error', {
        operation: 'processNextTask',
        error
      });
    }
  }
  
  /**
   * Trova un worker disponibile
   * @returns {WorkerThread} - Worker disponibile
   * @private
   */
  _findAvailableWorker() {
    // Cerca un worker disponibile
    for (const worker of this.workers.values()) {
      if (worker.isAvailable()) {
        return worker;
      }
    }
    
    return null;
  }
  
  /**
   * Esegue un task
   * @param {string} type - Tipo di task
   * @param {*} data - Dati del task
   * @param {Object} options - Opzioni
   * @returns {Promise<*>} - Risultato del task
   */
  async executeTask(type, data, options = {}) {
    // Verifica che il pool sia in esecuzione
    if (!this.isRunning) {
      throw new Error('Worker pool not running');
    }
    
    try {
      // Crea il task
      const task = new Task(null, type, data, {
        ...options,
        timeout: options.timeout || this.options.taskTimeout,
        maxRetries: options.maxRetries || this.options.taskRetries
      });
      
      // Aggiorna le metriche
      this.metrics.incrementCounter('tasks_submitted');
      
      // Aggiungi il task alla coda
      const success = this.taskQueue.enqueue(task);
      
      // Verifica che il task sia stato aggiunto
      if (!success) {
        throw new Error('Task queue full');
      }
      
      // Aggiorna le metriche
      this.metrics.setGauge('tasks_pending', this.taskQueue.size());
      
      // Elabora il prossimo task
      this._processNextTask();
      
      // Attendi il completamento del task
      return new Promise((resolve, reject) => {
        // Registra i callback
        task.callbacks.onSuccess = (result) => resolve(result);
        task.callbacks.onError = (error) => reject(error);
      });
    } catch (error) {
      console.error('Errore durante l\'esecuzione del task:', error);
      
      // Aggiorna le metriche
      this.metrics.incrementCounter('task_submission_failures');
      
      // Emetti evento
      this.emit('error', {
        operation: 'executeTask',
        type,
        error
      });
      
      throw error;
    }
  }
  
  /**
   * Esegue più task in parallelo
   * @param {Array<Object>} tasks - Task da eseguire
   * @returns {Promise<Array<*>>} - Risultati dei task
   */
  async executeParallel(tasks) {
    // Verifica che il pool sia in esecuzione
    if (!this.isRunning) {
      throw new Error('Worker pool not running');
    }
    
    try {
      // Esegui i task in parallelo
      const promises = tasks.map(task => this.executeTask(task.type, task.data, task.options));
      
      // Attendi il completamento di tutti i task
      return Promise.all(promises);
    } catch (error) {
      console.error('Errore durante l\'esecuzione parallela dei task:', error);
      
      // Emetti evento
      this.emit('error', {
        operation: 'executeParallel',
        error
      });
      
      throw error;
    }
  }
  
  /**
   * Annulla un task
   * @param {string} taskId - ID del task
   * @returns {boolean} - True se il task è stato annullato
   */
  cancelTask(taskId) {
    try {
      // Verifica che il task sia nella coda
      if (this.taskQueue.hasTask(taskId)) {
        // Rimuovi il task dalla coda
        const task = this.taskQueue.remove(taskId);
        
        // Verifica che il task sia stato rimosso
        if (!task) {
          return false;
        }
        
        // Annulla il task
        task.cancel();
        
        // Aggiorna le metriche
        this.metrics.incrementCounter('tasks_cancelled');
        this.metrics.setGauge('tasks_pending', this.taskQueue.size());
        
        // Emetti evento
        this.emit('task_cancelled', {
          taskId
        });
        
        return true;
      }
      
      // Verifica che il task sia in esecuzione
      if (this.taskMap.has(taskId)) {
        // Ottieni il task
        const task = this.taskMap.get(taskId);
        
        // Verifica che il task abbia un worker
        if (!task.workerId || !this.workers.has(task.workerId)) {
          return false;
        }
        
        // Ottieni il worker
        const worker = this.workers.get(task.workerId);
        
        // Annulla il task
        return worker.cancelTask();
      }
      
      return false;
    } catch (error) {
      console.error(`Errore durante l'annullamento del task ${taskId}:`, error);
      
      // Emetti evento
      this.emit('error', {
        operation: 'cancelTask',
        taskId,
        error
      });
      
      return false;
    }
  }
  
  /**
   * Annulla tutti i task
   * @returns {number} - Numero di task annullati
   */
  cancelAllTasks() {
    try {
      let count = 0;
      
      // Annulla i task nella coda
      const tasks = this.taskQueue.getTasks();
      for (const task of tasks) {
        // Rimuovi il task dalla coda
        this.taskQueue.remove(task.id);
        
        // Annulla il task
        task.cancel();
        
        count++;
      }
      
      // Annulla i task in esecuzione
      for (const worker of this.workers.values()) {
        if (worker.isBusy() && worker.cancelTask()) {
          count++;
        }
      }
      
      // Aggiorna le metriche
      this.metrics.incrementCounter('tasks_cancelled', count);
      this.metrics.setGauge('tasks_pending', this.taskQueue.size());
      this.metrics.setGauge('tasks_running', this.taskMap.size);
      
      // Emetti evento
      this.emit('all_tasks_cancelled', {
        count
      });
      
      return count;
    } catch (error) {
      console.error('Errore durante l\'annullamento di tutti i task:', error);
      
      // Emetti evento
      this.emit('error', {
        operation: 'cancelAllTasks',
        error
      });
      
      return 0;
    }
  }
  
  /**
   * Ottiene lo stato di un task
   * @param {string} taskId - ID del task
   * @returns {Object} - Stato del task
   */
  getTaskStatus(taskId) {
    try {
      // Verifica che il task sia nella coda
      if (this.taskQueue.hasTask(taskId)) {
        return this.taskQueue.getTask(taskId).serialize();
      }
      
      // Verifica che il task sia in esecuzione
      if (this.taskMap.has(taskId)) {
        return this.taskMap.get(taskId).serialize();
      }
      
      return null;
    } catch (error) {
      console.error(`Errore durante l'ottenimento dello stato del task ${taskId}:`, error);
      
      // Emetti evento
      this.emit('error', {
        operation: 'getTaskStatus',
        taskId,
        error
      });
      
      return null;
    }
  }
  
  /**
   * Ottiene lo stato di tutti i task
   * @returns {Object} - Stato dei task
   */
  getAllTaskStatus() {
    try {
      const tasks = {
        pending: [],
        running: []
      };
      
      // Ottieni i task nella coda
      for (const task of this.taskQueue.getTasks()) {
        tasks.pending.push(task.serialize());
      }
      
      // Ottieni i task in esecuzione
      for (const task of this.taskMap.values()) {
        tasks.running.push(task.serialize());
      }
      
      return tasks;
    } catch (error) {
      console.error('Errore durante l\'ottenimento dello stato di tutti i task:', error);
      
      // Emetti evento
      this.emit('error', {
        operation: 'getAllTaskStatus',
        error
      });
      
      return {
        pending: [],
        running: []
      };
    }
  }
  
  /**
   * Ottiene lo stato di un worker
   * @param {string} workerId - ID del worker
   * @returns {Object} - Stato del worker
   */
  getWorkerStatus(workerId) {
    try {
      // Verifica che il worker esista
      if (!this.workers.has(workerId)) {
        return null;
      }
      
      // Ottieni il worker
      const worker = this.workers.get(workerId);
      
      // Ottieni le statistiche
      return worker.getStats();
    } catch (error) {
      console.error(`Errore durante l'ottenimento dello stato del worker ${workerId}:`, error);
      
      // Emetti evento
      this.emit('error', {
        operation: 'getWorkerStatus',
        workerId,
        error
      });
      
      return null;
    }
  }
  
  /**
   * Ottiene lo stato di tutti i worker
   * @returns {Array<Object>} - Stato dei worker
   */
  getAllWorkerStatus() {
    try {
      const workers = [];
      
      // Ottieni le statistiche di tutti i worker
      for (const worker of this.workers.values()) {
        workers.push(worker.getStats());
      }
      
      return workers;
    } catch (error) {
      console.error('Errore durante l\'ottenimento dello stato di tutti i worker:', error);
      
      // Emetti evento
      this.emit('error', {
        operation: 'getAllWorkerStatus',
        error
      });
      
      return [];
    }
  }
  
  /**
   * Ottiene le statistiche del pool
   * @returns {Object} - Statistiche
   */
  getStats() {
    try {
      // Conta i worker per stato
      const workerStatus = {
        idle: 0,
        busy: 0,
        error: 0,
        terminated: 0
      };
      
      for (const worker of this.workers.values()) {
        workerStatus[worker.status]++;
      }
      
      // Ottieni le statistiche della coda
      const queueStats = this.taskQueue.getStats();
      
      // Calcola le statistiche
      const stats = {
        id: this.id,
        isRunning: this.isRunning,
        startTime: this.startTime,
        uptime: this.startTime ? Date.now() - this.startTime : 0,
        workers: {
          total: this.workers.size,
          min: this.options.minWorkers,
          max: this.options.maxWorkers,
          status: workerStatus
        },
        tasks: {
          pending: this.taskQueue.size(),
          running: this.taskMap.size,
          queueCapacity: this.options.taskQueueSize,
          queueUsage: this.taskQueue.size() / this.options.taskQueueSize
        },
        queue: queueStats,
        ...this.metrics.getMetrics()
      };
      
      return stats;
    } catch (error) {
      console.error('Errore durante l\'ottenimento delle statistiche:', error);
      
      // Emetti evento
      this.emit('error', {
        operation: 'getStats',
        error
      });
      
      return {
        id: this.id,
        isRunning: this.isRunning,
        startTime: this.startTime,
        uptime: this.startTime ? Date.now() - this.startTime : 0,
        workers: {
          total: this.workers.size,
          min: this.options.minWorkers,
          max: this.options.maxWorkers
        },
        tasks: {
          pending: this.taskQueue.size(),
          running: this.taskMap.size,
          queueCapacity: this.options.taskQueueSize
        }
      };
    }
  }
  
  /**
   * Ridimensiona il pool
   * @param {Object} options - Opzioni
   * @returns {boolean} - True se il ridimensionamento è riuscito
   */
  resize(options = {}) {
    try {
      // Aggiorna le opzioni
      if (typeof options.minWorkers === 'number') {
        this.options.minWorkers = options.minWorkers;
      }
      
      if (typeof options.maxWorkers === 'number') {
        this.options.maxWorkers = options.maxWorkers;
      }
      
      // Verifica che le opzioni siano valide
      if (this.options.minWorkers > this.options.maxWorkers) {
        this.options.minWorkers = this.options.maxWorkers;
      }
      
      // Aggiusta il numero di worker
      const currentSize = this.workers.size;
      
      if (currentSize < this.options.minWorkers) {
        // Aggiungi worker
        for (let i = currentSize; i < this.options.minWorkers; i++) {
          this._createWorker();
        }
      } else if (currentSize > this.options.maxWorkers) {
        // Rimuovi worker
        let count = 0;
        for (const worker of this.workers.values()) {
          if (count >= currentSize - this.options.maxWorkers) {
            break;
          }
          
          if (worker.isAvailable()) {
            worker.terminate();
            count++;
          }
        }
      }
      
      // Emetti evento
      this.emit('resized', {
        minWorkers: this.options.minWorkers,
        maxWorkers: this.options.maxWorkers,
        currentSize: this.workers.size
      });
      
      return true;
    } catch (error) {
      console.error('Errore durante il ridimensionamento del pool:', error);
      
      // Emetti evento
      this.emit('error', {
        operation: 'resize',
        error
      });
      
      return false;
    }
  }
  
  /**
   * Termina il pool
   * @returns {Promise<boolean>} - True se la terminazione è riuscita
   */
  async terminate() {
    try {
      // Verifica che il pool sia in esecuzione
      if (!this.isRunning) {
        return false;
      }
      
      // Imposta lo stato
      this.isRunning = false;
      
      // Annulla tutti i task
      this.cancelAllTasks();
      
      // Termina tutti i worker
      const promises = [];
      for (const worker of this.workers.values()) {
        worker.terminate();
        promises.push(new Promise(resolve => {
          worker.once('terminated', resolve);
        }));
      }
      
      // Attendi la terminazione di tutti i worker
      await Promise.all(promises);
      
      // Svuota la coda
      this.taskQueue.clear();
      this.taskMap.clear();
      this.workers.clear();
      
      // Chiudi le metriche
      this.metrics.close();
      
      // Emetti evento
      this.emit('terminated');
      
      // Rimuovi tutti i listener
      this.removeAllListeners();
      
      console.log(`WorkerThreadPool ${this.id} terminato`);
      
      return true;
    } catch (error) {
      console.error('Errore durante la terminazione del pool:', error);
      
      // Emetti evento
      this.emit('error', {
        operation: 'terminate',
        error
      });
      
      return false;
    }
  }
}

/**
 * Funzione di inizializzazione del worker
 */
function initializeWorker() {
  // Verifica che sia un worker thread
  if (isMainThread) {
    throw new Error('Questa funzione deve essere chiamata da un worker thread');
  }
  
  // Stato interno
  const state = {
    id: workerData.id || `worker-${threadId}`,
    status: 'idle',
    currentTask: null,
    taskCount: 0,
    errorCount: 0,
    startTime: Date.now(),
    handlers: new Map()
  };
  
  // Registra i gestori dei task
  function registerTaskHandler(type, handler) {
    state.handlers.set(type, handler);
  }
  
  // Esegue un task
  async function executeTask(task) {
    try {
      // Verifica che il task sia valido
      if (!task || !task.type) {
        throw new Error('Invalid task');
      }
      
      // Verifica che ci sia un gestore per il tipo di task
      if (!state.handlers.has(task.type)) {
        throw new Error(`No handler for task type: ${task.type}`);
      }
      
      // Aggiorna lo stato
      state.status = 'busy';
      state.currentTask = task;
      state.taskCount++;
      
      // Invia lo stato
      parentPort.postMessage({
        type: 'status',
        status: state.status
      });
      
      // Ottieni il gestore
      const handler = state.handlers.get(task.type);
      
      // Esegui il task
      const result = await handler(task.data, task);
      
      // Aggiorna lo stato
      state.status = 'idle';
      state.currentTask = null;
      
      // Invia lo stato
      parentPort.postMessage({
        type: 'status',
        status: state.status
      });
      
      // Invia il risultato
      parentPort.postMessage({
        type: 'task_result',
        taskId: task.id,
        result
      });
    } catch (error) {
      // Aggiorna lo stato
      state.status = 'idle';
      state.currentTask = null;
      state.errorCount++;
      
      // Invia lo stato
      parentPort.postMessage({
        type: 'status',
        status: state.status
      });
      
      // Invia l'errore
      parentPort.postMessage({
        type: 'task_error',
        taskId: task.id,
        error: error.message
      });
      
      // Logga l'errore
      parentPort.postMessage({
        type: 'log',
        level: 'error',
        message: `Error executing task ${task.id}: ${error.message}`,
        data: {
          stack: error.stack,
          taskType: task.type
        }
      });
    }
  }
  
  // Gestisce i messaggi
  parentPort.on('message', async (message) => {
    try {
      // Verifica che il messaggio sia valido
      if (!message || typeof message !== 'object') {
        return;
      }
      
      // Gestisci il messaggio in base al tipo
      switch (message.type) {
        case 'execute_task':
          // Deserializza il task
          const task = Task.deserialize(message.task);
          
          // Esegui il task
          await executeTask(task);
          break;
          
        case 'cancel_task':
          // Verifica che ci sia un task corrente
          if (!state.currentTask || state.currentTask.id !== message.taskId) {
            return;
          }
          
          // Aggiorna lo stato
          state.status = 'idle';
          state.currentTask = null;
          
          // Invia lo stato
          parentPort.postMessage({
            type: 'status',
            status: state.status
          });
          break;
          
        default:
          // Invia un messaggio di log
          parentPort.postMessage({
            type: 'log',
            level: 'warn',
            message: `Unknown message type: ${message.type}`,
            data: message
          });
      }
    } catch (error) {
      // Invia un messaggio di log
      parentPort.postMessage({
        type: 'log',
        level: 'error',
        message: `Error handling message: ${error.message}`,
        data: {
          stack: error.stack,
          message
        }
      });
    }
  });
  
  // Invia un messaggio di log
  parentPort.postMessage({
    type: 'log',
    level: 'info',
    message: `Worker ${state.id} initialized`
  });
  
  // Invia lo stato
  parentPort.postMessage({
    type: 'status',
    status: state.status
  });
  
  // Restituisci le funzioni pubbliche
  return {
    registerTaskHandler
  };
}

module.exports = {
  WorkerThreadPool,
  WorkerThread,
  Task,
  TaskQueue,
  initializeWorker
};
