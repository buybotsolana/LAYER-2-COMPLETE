/**
 * Implementazione ottimizzata della coda di priorità con heap binario per il Layer-2 su Solana
 * 
 * Questo modulo implementa una coda di priorità ad alte prestazioni basata su heap binario
 * con supporto per riprogrammazione dinamica delle priorità, backpressure avanzato e
 * monitoraggio delle prestazioni.
 */

const { EventEmitter } = require('events');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/**
 * Classe BinaryHeap
 * 
 * Implementa un heap binario ottimizzato per le operazioni di coda di priorità
 */
class BinaryHeap {
  /**
   * Costruttore
   * @param {Function} compareFunction - Funzione di confronto per ordinare gli elementi
   */
  constructor(compareFunction) {
    this.heap = [];
    this.compare = compareFunction || ((a, b) => a.priority - b.priority);
    this.indexMap = new Map(); // Mappa per tenere traccia degli indici degli elementi
  }
  
  /**
   * Ottiene la dimensione dell'heap
   * @returns {number} Numero di elementi nell'heap
   */
  get size() {
    return this.heap.length;
  }
  
  /**
   * Verifica se l'heap è vuoto
   * @returns {boolean} True se l'heap è vuoto
   */
  isEmpty() {
    return this.heap.length === 0;
  }
  
  /**
   * Ottiene l'elemento con la priorità più alta senza rimuoverlo
   * @returns {*} Elemento con la priorità più alta
   */
  peek() {
    return this.heap.length > 0 ? this.heap[0] : null;
  }
  
  /**
   * Inserisce un elemento nell'heap
   * @param {*} item - Elemento da inserire
   * @param {string} id - ID univoco dell'elemento
   * @returns {boolean} True se l'inserimento ha avuto successo
   */
  insert(item, id) {
    // Verifica se l'elemento esiste già
    if (this.indexMap.has(id)) {
      return this.updatePriority(id, item.priority);
    }
    
    // Aggiungi l'elemento all'heap
    this.heap.push(item);
    const index = this.heap.length - 1;
    
    // Memorizza l'indice dell'elemento
    this.indexMap.set(id, index);
    
    // Ripristina la proprietà dell'heap
    this._siftUp(index);
    
    return true;
  }
  
  /**
   * Rimuove e restituisce l'elemento con la priorità più alta
   * @returns {*} Elemento con la priorità più alta
   */
  extractMax() {
    if (this.heap.length === 0) {
      return null;
    }
    
    const max = this.heap[0];
    const last = this.heap.pop();
    
    // Rimuovi l'indice dell'elemento estratto
    this.indexMap.delete(max.id);
    
    if (this.heap.length > 0) {
      this.heap[0] = last;
      
      // Aggiorna l'indice dell'elemento spostato
      this.indexMap.set(last.id, 0);
      
      // Ripristina la proprietà dell'heap
      this._siftDown(0);
    }
    
    return max;
  }
  
  /**
   * Aggiorna la priorità di un elemento
   * @param {string} id - ID dell'elemento
   * @param {number} newPriority - Nuova priorità
   * @returns {boolean} True se l'aggiornamento ha avuto successo
   */
  updatePriority(id, newPriority) {
    if (!this.indexMap.has(id)) {
      return false;
    }
    
    const index = this.indexMap.get(id);
    const oldPriority = this.heap[index].priority;
    
    // Aggiorna la priorità
    this.heap[index].priority = newPriority;
    
    // Ripristina la proprietà dell'heap
    if (newPriority > oldPriority) {
      this._siftUp(index);
    } else if (newPriority < oldPriority) {
      this._siftDown(index);
    }
    
    return true;
  }
  
  /**
   * Rimuove un elemento dall'heap
   * @param {string} id - ID dell'elemento
   * @returns {boolean} True se la rimozione ha avuto successo
   */
  remove(id) {
    if (!this.indexMap.has(id)) {
      return false;
    }
    
    const index = this.indexMap.get(id);
    const last = this.heap.pop();
    
    // Rimuovi l'indice dell'elemento
    this.indexMap.delete(id);
    
    if (index === this.heap.length) {
      // L'elemento rimosso era l'ultimo
      return true;
    }
    
    // Sostituisci l'elemento con l'ultimo
    this.heap[index] = last;
    
    // Aggiorna l'indice dell'elemento spostato
    this.indexMap.set(last.id, index);
    
    // Ripristina la proprietà dell'heap
    this._siftUp(index);
    this._siftDown(index);
    
    return true;
  }
  
  /**
   * Verifica se un elemento è presente nell'heap
   * @param {string} id - ID dell'elemento
   * @returns {boolean} True se l'elemento è presente
   */
  contains(id) {
    return this.indexMap.has(id);
  }
  
  /**
   * Ottiene un elemento dall'heap
   * @param {string} id - ID dell'elemento
   * @returns {*} Elemento o null se non trovato
   */
  get(id) {
    if (!this.indexMap.has(id)) {
      return null;
    }
    
    const index = this.indexMap.get(id);
    return this.heap[index];
  }
  
  /**
   * Ripristina la proprietà dell'heap verso l'alto
   * @param {number} index - Indice dell'elemento
   * @private
   */
  _siftUp(index) {
    const item = this.heap[index];
    
    // Sposta l'elemento verso l'alto finché non è nella posizione corretta
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.heap[parentIndex];
      
      // Se l'elemento è in posizione corretta, esci
      if (this.compare(item, parent) <= 0) {
        break;
      }
      
      // Scambia l'elemento con il genitore
      this.heap[parentIndex] = item;
      this.heap[index] = parent;
      
      // Aggiorna gli indici
      this.indexMap.set(item.id, parentIndex);
      this.indexMap.set(parent.id, index);
      
      // Passa al livello superiore
      index = parentIndex;
    }
  }
  
  /**
   * Ripristina la proprietà dell'heap verso il basso
   * @param {number} index - Indice dell'elemento
   * @private
   */
  _siftDown(index) {
    const item = this.heap[index];
    const length = this.heap.length;
    const halfLength = Math.floor(length / 2);
    
    // Sposta l'elemento verso il basso finché non è nella posizione corretta
    while (index < halfLength) {
      const leftChildIndex = 2 * index + 1;
      const rightChildIndex = leftChildIndex + 1;
      
      // Trova il figlio con priorità più alta
      let highestPriorityChildIndex = leftChildIndex;
      
      if (rightChildIndex < length && this.compare(this.heap[rightChildIndex], this.heap[leftChildIndex]) > 0) {
        highestPriorityChildIndex = rightChildIndex;
      }
      
      const highestPriorityChild = this.heap[highestPriorityChildIndex];
      
      // Se l'elemento è in posizione corretta, esci
      if (this.compare(item, highestPriorityChild) >= 0) {
        break;
      }
      
      // Scambia l'elemento con il figlio con priorità più alta
      this.heap[highestPriorityChildIndex] = item;
      this.heap[index] = highestPriorityChild;
      
      // Aggiorna gli indici
      this.indexMap.set(item.id, highestPriorityChildIndex);
      this.indexMap.set(highestPriorityChild.id, index);
      
      // Passa al livello inferiore
      index = highestPriorityChildIndex;
    }
  }
  
  /**
   * Converte l'heap in un array
   * @returns {Array} Array contenente gli elementi dell'heap
   */
  toArray() {
    return [...this.heap];
  }
  
  /**
   * Pulisce l'heap
   */
  clear() {
    this.heap = [];
    this.indexMap.clear();
  }
}

/**
 * Classe PriorityQueue
 * 
 * Implementa una coda di priorità ottimizzata con supporto per:
 * - Heap binario per massime prestazioni
 * - Riprogrammazione dinamica delle priorità
 * - Backpressure avanzato
 * - Monitoraggio delle prestazioni
 */
class PriorityQueue extends EventEmitter {
  /**
   * Costruttore
   * @param {Object} options - Opzioni di configurazione
   */
  constructor(options = {}) {
    super();
    
    // Configurazione
    this.options = {
      maxSize: options.maxSize || 1000000,
      workerCount: options.workerCount || Math.max(1, Math.min(4, os.cpus().length - 1)),
      enableParallelProcessing: options.enableParallelProcessing !== false,
      priorityLevels: options.priorityLevels || 5,
      defaultPriority: options.defaultPriority || Math.floor((options.priorityLevels || 5) / 2),
      priorityFactor: options.priorityFactor || 2.0,
      enableAdaptivePrioritization: options.enableAdaptivePrioritization !== false,
      adaptiveInterval: options.adaptiveInterval || 60000, // 1 minuto
      enableMetrics: options.enableMetrics !== false,
      metricsInterval: options.metricsInterval || 10000, // 10 secondi
      enableBackpressure: options.enableBackpressure !== false,
      backpressureThreshold: options.backpressureThreshold || 0.8, // 80% di riempimento
      backpressureReleaseThreshold: options.backpressureReleaseThreshold || 0.6, // 60% di riempimento
      enableBatchProcessing: options.enableBatchProcessing !== false,
      batchSize: options.batchSize || 100,
      batchInterval: options.batchInterval || 50, // 50 ms
      priorityBoostFactor: options.priorityBoostFactor || 1.5,
      priorityDecayFactor: options.priorityDecayFactor || 0.9,
      priorityAgingInterval: options.priorityAgingInterval || 30000, // 30 secondi
      priorityAgingFactor: options.priorityAgingFactor || 1.1,
      workerScript: options.workerScript || path.join(__dirname, 'priority-queue-worker.js'),
    };
    
    // Stato interno
    this.heap = new BinaryHeap((a, b) => b.priority - a.priority); // Max heap
    this.size = 0;
    this.workers = [];
    this.isBackpressureActive = false;
    this.transactionStats = new Map();
    this.priorityWeights = {
      fee: options.feeWeight || 0.5,
      age: options.ageWeight || 0.3,
      size: options.sizeWeight || 0.1,
      sender: options.senderWeight || 0.1
    };
    this.pendingBatches = new Map();
    this.batchTimer = null;
    this.agingTimer = null;
    this.isShuttingDown = false;
    this.taskIdCounter = 0;
    
    // Metriche
    this.metrics = {
      enqueued: 0,
      dequeued: 0,
      dropped: 0,
      avgWaitTime: 0,
      avgProcessingTime: 0,
      priorityDistribution: Array(this.options.priorityLevels).fill(0),
      priorityChanges: { increased: 0, decreased: 0, aged: 0 },
      backpressureEvents: 0,
      batchesProcessed: 0,
      itemsPerBatch: 0,
      lastMetricsTime: Date.now()
    };
    
    // Inizializzazione
    this._initialize();
  }
  
  /**
   * Inizializza la coda di priorità
   * @private
   */
  _initialize() {
    console.log(`Inizializzazione PriorityQueue ottimizzata con heap binario...`);
    
    // Inizializza i worker se l'elaborazione parallela è abilitata
    if (this.options.enableParallelProcessing) {
      this._initializeWorkers();
    }
    
    // Avvia l'adattamento della prioritizzazione se abilitato
    if (this.options.enableAdaptivePrioritization) {
      this._startAdaptivePrioritization();
    }
    
    // Avvia il monitoraggio delle metriche se abilitato
    if (this.options.enableMetrics) {
      this._startMetricsMonitoring();
    }
    
    // Avvia il timer di invecchiamento delle priorità
    this._startPriorityAging();
    
    console.log(`PriorityQueue inizializzata con ${this.options.priorityLevels} livelli di priorità e ${this.options.workerCount} worker`);
    
    // Emetti evento di inizializzazione completata
    this.emit('initialized', {
      maxSize: this.options.maxSize,
      priorityLevels: this.options.priorityLevels,
      workerCount: this.options.workerCount
    });
  }
  
  /**
   * Inizializza i worker per l'elaborazione parallela
   * @private
   */
  _initializeWorkers() {
    for (let i = 0; i < this.options.workerCount; i++) {
      const worker = new Worker(this.options.workerScript, {
        workerData: {
          workerId: i,
          priorityLevels: this.options.priorityLevels,
          priorityWeights: this.priorityWeights
        }
      });
      
      worker.on('message', (message) => {
        if (message.type === 'priority_calculated') {
          this._handlePriorityCalculation(message.transaction, message.priority);
        } else if (message.type === 'error') {
          console.error(`Worker ${i} error:`, message.error);
        }
      });
      
      worker.on('error', (err) => {
        console.error(`Worker ${i} error:`, err);
        // Ricrea il worker in caso di errore
        this.workers[i] = this._createWorker(i);
      });
      
      this.workers.push(worker);
    }
  }
  
  /**
   * Crea un worker thread
   * @param {number} id - ID del worker
   * @returns {Worker} Worker thread
   * @private
   */
  _createWorker(id) {
    const worker = new Worker(this.options.workerScript, {
      workerData: {
        workerId: id,
        priorityLevels: this.options.priorityLevels,
        priorityWeights: this.priorityWeights
      }
    });
    
    worker.on('message', (message) => {
      if (message.type === 'priority_calculated') {
        this._handlePriorityCalculation(message.transaction, message.priority);
      } else if (message.type === 'error') {
        console.error(`Worker ${id} error:`, message.error);
      }
    });
    
    worker.on('error', (err) => {
      console.error(`Worker ${id} error:`, err);
      // Ricrea il worker in caso di errore
      setTimeout(() => {
        this.workers[id] = this._createWorker(id);
      }, 1000);
    });
    
    return worker;
  }
  
  /**
   * Avvia l'adattamento della prioritizzazione
   * @private
   */
  _startAdaptivePrioritization() {
    setInterval(() => {
      this._adaptPrioritization();
    }, this.options.adaptiveInterval);
  }
  
  /**
   * Adatta i pesi della prioritizzazione in base alle statistiche
   * @private
   */
  _adaptPrioritization() {
    // Implementazione dell'adattamento della prioritizzazione
    // basata sulle statistiche delle transazioni
    
    // Esempio: aumenta il peso delle commissioni se ci sono molte transazioni in attesa
    if (this.size > this.options.maxSize * 0.5) {
      this.priorityWeights.fee = Math.min(0.8, this.priorityWeights.fee + 0.05);
      this.priorityWeights.age = Math.max(0.1, this.priorityWeights.age - 0.02);
      this.priorityWeights.size = Math.max(0.05, this.priorityWeights.size - 0.02);
      this.priorityWeights.sender = Math.max(0.05, this.priorityWeights.sender - 0.01);
    } else {
      // Ripristina i pesi predefiniti
      this.priorityWeights.fee = 0.5;
      this.priorityWeights.age = 0.3;
      this.priorityWeights.size = 0.1;
      this.priorityWeights.sender = 0.1;
    }
    
    // Aggiorna i pesi nei worker
    for (const worker of this.workers) {
      worker.postMessage({
        type: 'update_weights',
        weights: this.priorityWeights
      });
    }
    
    console.log('Pesi di prioritizzazione adattati:', this.priorityWeights);
    
    // Emetti evento di adattamento completato
    this.emit('weights_adapted', this.priorityWeights);
  }
  
  /**
   * Avvia il monitoraggio delle metriche
   * @private
   */
  _startMetricsMonitoring() {
    setInterval(() => {
      const now = Date.now();
      const elapsed = (now - this.metrics.lastMetricsTime) / 1000;
      
      if (elapsed > 0) {
        const enqueueRate = this.metrics.enqueued / elapsed;
        const dequeueRate = this.metrics.dequeued / elapsed;
        
        // Calcola la distribuzione delle priorità
        const priorityDistribution = Array(this.options.priorityLevels).fill(0);
        let totalItems = 0;
        
        for (const item of this.heap.toArray()) {
          const priorityLevel = Math.min(this.options.priorityLevels - 1, Math.floor(item.priority * this.options.priorityLevels));
          priorityDistribution[priorityLevel]++;
          totalItems++;
        }
        
        // Normalizza la distribuzione
        const normalizedDistribution = priorityDistribution.map(count => totalItems > 0 ? count / totalItems : 0);
        
        console.log(`PriorityQueue metrics - Size: ${this.size}, Enqueue rate: ${enqueueRate.toFixed(2)}/s, Dequeue rate: ${dequeueRate.toFixed(2)}/s`);
        console.log(`Avg wait time: ${this.metrics.avgWaitTime.toFixed(2)}ms, Avg processing time: ${this.metrics.avgProcessingTime.toFixed(2)}ms`);
        console.log(`Priority changes - Increased: ${this.metrics.priorityChanges.increased}, Decreased: ${this.metrics.priorityChanges.decreased}, Aged: ${this.metrics.priorityChanges.aged}`);
        console.log(`Backpressure events: ${this.metrics.backpressureEvents}, Batches processed: ${this.metrics.batchesProcessed}, Avg items per batch: ${this.metrics.itemsPerBatch.toFixed(2)}`);
        
        // Emetti evento con le metriche
        this.emit('metrics', {
          timestamp: now,
          size: this.size,
          enqueueRate,
          dequeueRate,
          avgWaitTime: this.metrics.avgWaitTime,
          avgProcessingTime: this.metrics.avgProcessingTime,
          priorityDistribution: normalizedDistribution,
          priorityChanges: { ...this.metrics.priorityChanges },
          backpressureEvents: this.metrics.backpressureEvents,
          batchesProcessed: this.metrics.batchesProcessed,
          itemsPerBatch: this.metrics.itemsPerBatch
        });
        
        // Resetta i contatori
        this.metrics.enqueued = 0;
        this.metrics.dequeued = 0;
        this.metrics.priorityChanges = { increased: 0, decreased: 0, aged: 0 };
        this.metrics.backpressureEvents = 0;
        this.metrics.batchesProcessed = 0;
        this.metrics.itemsPerBatch = 0;
        this.metrics.lastMetricsTime = now;
      }
    }, this.options.metricsInterval);
  }
  
  /**
   * Avvia l'invecchiamento delle priorità
   * @private
   */
  _startPriorityAging() {
    this.agingTimer = setInterval(() => {
      this._agePriorities();
    }, this.options.priorityAgingInterval);
  }
  
  /**
   * Aumenta la priorità delle transazioni più vecchie
   * @private
   */
  _agePriorities() {
    const now = Date.now();
    let changedCount = 0;
    
    // Attraversa tutte le transazioni nell'heap
    for (const item of this.heap.toArray()) {
      // Calcola l'età della transazione in millisecondi
      const age = now - item.timestamp;
      
      // Applica l'invecchiamento solo alle transazioni più vecchie di un certo periodo
      if (age > this.options.priorityAgingInterval) {
        // Calcola il fattore di invecchiamento in base all'età
        const agingFactor = Math.min(2.0, 1.0 + (age / this.options.priorityAgingInterval) * (this.options.priorityAgingFactor - 1.0));
        
        // Calcola la nuova priorità
        const newPriority = Math.min(1.0, item.priority * agingFactor);
        
        // Aggiorna la priorità se è cambiata significativamente
        if (newPriority > item.priority * 1.05) {
          this.updatePriority(item.id, newPriority);
          changedCount++;
        }
      }
    }
    
    // Aggiorna le metriche
    this.metrics.priorityChanges.aged += changedCount;
    
    if (changedCount > 0) {
      console.log(`Priorità aumentata per ${changedCount} transazioni per invecchiamento`);
    }
  }
  
  /**
   * Gestisce il risultato del calcolo della priorità
   * @param {Object} transaction - Transazione
   * @param {number} priority - Priorità calcolata
   * @private
   */
  _handlePriorityCalculation(transaction, priority) {
    // Genera un ID univoco se non presente
    if (!transaction.id) {
      transaction.id = `tx_${Date.now()}_${this.taskIdCounter++}_${crypto.randomBytes(4).toString('hex')}`;
    }
    
    // Aggiungi la priorità alla transazione
    transaction.priority = priority;
    
    // Aggiungi la transazione all'heap
    this.heap.insert(transaction, transaction.id);
    this.size++;
    
    // Aggiorna le metriche
    const priorityLevel = Math.min(this.options.priorityLevels - 1, Math.floor(priority * this.options.priorityLevels));
    this.metrics.priorityDistribution[priorityLevel]++;
    
    // Verifica se attivare il backpressure
    if (this.options.enableBackpressure && !this.isBackpressureActive && this.size >= this.options.maxSize * this.options.backpressureThreshold) {
      this.isBackpressureActive = true;
      this.metrics.backpressureEvents++;
      this.emit('backpressure', true);
      
      console.log(`Backpressure attivato (dimensione: ${this.size}/${this.options.maxSize})`);
    }
    
    // Notifica che una nuova transazione è disponibile
    this.emit('transaction_enqueued', transaction);
    
    // Avvia il batch processing se abilitato
    if (this.options.enableBatchProcessing && !this.batchTimer && !this.isShuttingDown) {
      this._scheduleBatchProcessing();
    }
  }
  
  /**
   * Calcola la priorità di una transazione
   * @param {Object} transaction - Transazione
   * @returns {number} Priorità normalizzata (0-1)
   * @private
   */
  _calculatePriority(transaction) {
    // Estrai i fattori di priorità
    const fee = transaction.fee || 0;
    const age = Date.now() - (transaction.timestamp || Date.now());
    const size = transaction.size || 1;
    const sender = transaction.sender || '';
    
    // Normalizza i fattori
    const maxFee = 1000000; // Valore massimo atteso per le commissioni
    const maxAge = 3600000; // 1 ora in millisecondi
    const maxSize = 10000; // Dimensione massima attesa per una transazione
    
    const normalizedFee = Math.min(1, fee / maxFee);
    const normalizedAge = Math.min(1, age / maxAge);
    const normalizedSize = 1 - Math.min(1, size / maxSize); // Inverti per dare priorità alle transazioni più piccole
    
    // Calcola lo score del mittente (basato sulla storia)
    let senderScore = 0;
    if (this.transactionStats.has(sender)) {
      const stats = this.transactionStats.get(sender);
      senderScore = Math.min(1, stats.successCount / Math.max(1, stats.totalCount));
    }
    
    // Calcola la priorità ponderata
    const priority = 
      this.priorityWeights.fee * normalizedFee +
      this.priorityWeights.age * normalizedAge +
      this.priorityWeights.size * normalizedSize +
      this.priorityWeights.sender * senderScore;
    
    return Math.min(1, Math.max(0, priority));
  }
  
  /**
   * Pianifica l'elaborazione batch
   * @private
   */
  _scheduleBatchProcessing() {
    if (this.batchTimer || this.isShuttingDown) {
      return;
    }
    
    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      
      // Processa un batch se ci sono elementi
      if (this.size > 0) {
        const batchId = `batch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        this._processBatch(batchId);
      }
      
      // Pianifica il prossimo batch se ci sono ancora elementi
      if (this.size > 0 && !this.isShuttingDown) {
        this._scheduleBatchProcessing();
      }
    }, this.options.batchInterval);
  }
  
  /**
   * Processa un batch di transazioni
   * @param {string} batchId - ID del batch
   * @private
   */
  _processBatch(batchId) {
    // Determina la dimensione del batch
    const batchSize = Math.min(this.options.batchSize, this.size);
    
    if (batchSize === 0) {
      return;
    }
    
    // Estrai le transazioni per il batch
    const batch = [];
    
    for (let i = 0; i < batchSize; i++) {
      const transaction = this.heap.extractMax();
      
      if (!transaction) {
        break;
      }
      
      batch.push(transaction);
      this.size--;
    }
    
    // Aggiorna le metriche
    this.metrics.dequeued += batch.length;
    this.metrics.batchesProcessed++;
    this.metrics.itemsPerBatch = (this.metrics.itemsPerBatch + batch.length) / 2; // Media mobile
    
    // Memorizza il batch
    this.pendingBatches.set(batchId, {
      transactions: batch,
      timestamp: Date.now()
    });
    
    // Emetti evento di batch pronto
    this.emit('batch_ready', {
      batchId,
      size: batch.length,
      transactions: batch
    });
    
    // Verifica se disattivare il backpressure
    if (this.isBackpressureActive && this.size <= this.options.maxSize * this.options.backpressureReleaseThreshold) {
      this.isBackpressureActive = false;
      this.emit('backpressure', false);
      
      console.log(`Backpressure disattivato (dimensione: ${this.size}/${this.options.maxSize})`);
    }
    
    // Calcola il tempo di attesa medio
    const now = Date.now();
    let totalWaitTime = 0;
    
    for (const transaction of batch) {
      const waitTime = now - transaction.timestamp;
      totalWaitTime += waitTime;
      
      // Aggiorna le statistiche del mittente
      const sender = transaction.sender || '';
      if (sender) {
        if (!this.transactionStats.has(sender)) {
          this.transactionStats.set(sender, { totalCount: 0, successCount: 0 });
        }
        
        const stats = this.transactionStats.get(sender);
        stats.totalCount++;
      }
    }
    
    if (batch.length > 0) {
      this.metrics.avgWaitTime = (this.metrics.avgWaitTime * 0.9) + (totalWaitTime / batch.length * 0.1); // Media mobile esponenziale
    }
  }
  
  /**
   * Aggiunge una transazione alla coda
   * @param {Object} transaction - Transazione da aggiungere
   * @returns {Promise<boolean>} True se la transazione è stata aggiunta con successo
   */
  async enqueue(transaction) {
    // Verifica se la coda è piena e il backpressure è attivo
    if (this.isBackpressureActive && this.size >= this.options.maxSize) {
      this.metrics.dropped++;
      return false;
    }
    
    // Verifica se la coda è in fase di chiusura
    if (this.isShuttingDown) {
      this.metrics.dropped++;
      return false;
    }
    
    // Aggiungi timestamp se non presente
    if (!transaction.timestamp) {
      transaction.timestamp = Date.now();
    }
    
    // Genera un ID univoco se non presente
    if (!transaction.id) {
      transaction.id = `tx_${Date.now()}_${this.taskIdCounter++}_${crypto.randomBytes(4).toString('hex')}`;
    }
    
    // Aggiorna le metriche
    this.metrics.enqueued++;
    
    // Calcola la priorità
    if (this.options.enableParallelProcessing && this.workers.length > 0) {
      // Distribuisci il calcolo ai worker
      const workerIndex = this.metrics.enqueued % this.workers.length;
      this.workers[workerIndex].postMessage({
        type: 'calculate_priority',
        transaction
      });
    } else {
      // Calcola la priorità direttamente
      const priority = this._calculatePriority(transaction);
      this._handlePriorityCalculation(transaction, priority);
    }
    
    return true;
  }
  
  /**
   * Preleva un batch di transazioni dalla coda
   * @param {number} count - Numero di transazioni da prelevare
   * @returns {Promise<Array>} Array di transazioni
   */
  async dequeue(count = 1) {
    // Verifica se la coda è in fase di chiusura
    if (this.isShuttingDown) {
      return [];
    }
    
    // Limita il numero di transazioni da prelevare
    const actualCount = Math.min(count, this.size);
    
    if (actualCount === 0) {
      return [];
    }
    
    // Estrai le transazioni
    const result = [];
    
    for (let i = 0; i < actualCount; i++) {
      const transaction = this.heap.extractMax();
      
      if (!transaction) {
        break;
      }
      
      result.push(transaction);
      this.size--;
    }
    
    // Aggiorna le metriche
    this.metrics.dequeued += result.length;
    
    // Verifica se disattivare il backpressure
    if (this.isBackpressureActive && this.size <= this.options.maxSize * this.options.backpressureReleaseThreshold) {
      this.isBackpressureActive = false;
      this.emit('backpressure', false);
    }
    
    // Calcola il tempo di attesa medio
    const now = Date.now();
    let totalWaitTime = 0;
    
    for (const transaction of result) {
      const waitTime = now - transaction.timestamp;
      totalWaitTime += waitTime;
      
      // Aggiorna le statistiche del mittente
      const sender = transaction.sender || '';
      if (sender) {
        if (!this.transactionStats.has(sender)) {
          this.transactionStats.set(sender, { totalCount: 0, successCount: 0 });
        }
        
        const stats = this.transactionStats.get(sender);
        stats.totalCount++;
      }
    }
    
    if (result.length > 0) {
      this.metrics.avgWaitTime = (this.metrics.avgWaitTime * 0.9) + (totalWaitTime / result.length * 0.1); // Media mobile esponenziale
    }
    
    return result;
  }
  
  /**
   * Preleva un batch specifico dalla coda
   * @param {string} batchId - ID del batch
   * @returns {Promise<Array>} Array di transazioni o null se il batch non esiste
   */
  async dequeueBatch(batchId) {
    // Verifica se il batch esiste
    if (!this.pendingBatches.has(batchId)) {
      return null;
    }
    
    // Recupera il batch
    const batch = this.pendingBatches.get(batchId);
    this.pendingBatches.delete(batchId);
    
    return batch.transactions;
  }
  
  /**
   * Aggiorna le statistiche di una transazione dopo l'elaborazione
   * @param {Object} transaction - Transazione elaborata
   * @param {boolean} success - Indica se l'elaborazione ha avuto successo
   * @param {number} processingTime - Tempo di elaborazione in millisecondi
   */
  updateTransactionStats(transaction, success, processingTime) {
    // Aggiorna le statistiche del mittente
    const sender = transaction.sender || '';
    if (sender && this.transactionStats.has(sender)) {
      const stats = this.transactionStats.get(sender);
      if (success) {
        stats.successCount++;
      }
    }
    
    // Aggiorna il tempo medio di elaborazione
    this.metrics.avgProcessingTime = (this.metrics.avgProcessingTime * 0.9) + (processingTime * 0.1); // Media mobile esponenziale
  }
  
  /**
   * Aggiorna la priorità di una transazione
   * @param {string} id - ID della transazione
   * @param {number} newPriority - Nuova priorità
   * @returns {boolean} True se l'aggiornamento ha avuto successo
   */
  updatePriority(id, newPriority) {
    // Verifica se la transazione esiste
    if (!this.heap.contains(id)) {
      return false;
    }
    
    // Recupera la transazione
    const transaction = this.heap.get(id);
    const oldPriority = transaction.priority;
    
    // Aggiorna la priorità
    const result = this.heap.updatePriority(id, newPriority);
    
    // Aggiorna le metriche
    if (result) {
      if (newPriority > oldPriority) {
        this.metrics.priorityChanges.increased++;
      } else if (newPriority < oldPriority) {
        this.metrics.priorityChanges.decreased++;
      }
    }
    
    return result;
  }
  
  /**
   * Aumenta la priorità di una transazione
   * @param {string} id - ID della transazione
   * @param {number} factor - Fattore di aumento (moltiplicatore)
   * @returns {boolean} True se l'aggiornamento ha avuto successo
   */
  boostPriority(id, factor = null) {
    // Usa il fattore predefinito se non specificato
    const boostFactor = factor || this.options.priorityBoostFactor;
    
    // Verifica se la transazione esiste
    if (!this.heap.contains(id)) {
      return false;
    }
    
    // Recupera la transazione
    const transaction = this.heap.get(id);
    
    // Calcola la nuova priorità
    const newPriority = Math.min(1.0, transaction.priority * boostFactor);
    
    // Aggiorna la priorità
    return this.updatePriority(id, newPriority);
  }
  
  /**
   * Diminuisce la priorità di una transazione
   * @param {string} id - ID della transazione
   * @param {number} factor - Fattore di diminuzione (moltiplicatore)
   * @returns {boolean} True se l'aggiornamento ha avuto successo
   */
  decreasePriority(id, factor = null) {
    // Usa il fattore predefinito se non specificato
    const decayFactor = factor || this.options.priorityDecayFactor;
    
    // Verifica se la transazione esiste
    if (!this.heap.contains(id)) {
      return false;
    }
    
    // Recupera la transazione
    const transaction = this.heap.get(id);
    
    // Calcola la nuova priorità
    const newPriority = Math.max(0.0, transaction.priority * decayFactor);
    
    // Aggiorna la priorità
    return this.updatePriority(id, newPriority);
  }
  
  /**
   * Rimuove una transazione dalla coda
   * @param {string} id - ID della transazione
   * @returns {boolean} True se la rimozione ha avuto successo
   */
  remove(id) {
    // Verifica se la transazione esiste
    if (!this.heap.contains(id)) {
      return false;
    }
    
    // Rimuovi la transazione
    const result = this.heap.remove(id);
    
    // Aggiorna la dimensione
    if (result) {
      this.size--;
      
      // Verifica se disattivare il backpressure
      if (this.isBackpressureActive && this.size <= this.options.maxSize * this.options.backpressureReleaseThreshold) {
        this.isBackpressureActive = false;
        this.emit('backpressure', false);
      }
    }
    
    return result;
  }
  
  /**
   * Ottiene una transazione dalla coda senza rimuoverla
   * @param {string} id - ID della transazione
   * @returns {Object} Transazione o null se non trovata
   */
  peek(id) {
    return this.heap.get(id);
  }
  
  /**
   * Ottiene la transazione con la priorità più alta senza rimuoverla
   * @returns {Object} Transazione con la priorità più alta o null se la coda è vuota
   */
  peekHighest() {
    return this.heap.peek();
  }
  
  /**
   * Ottiene la dimensione attuale della coda
   * @returns {number} Numero totale di transazioni in coda
   */
  getSize() {
    return this.size;
  }
  
  /**
   * Ottiene la distribuzione delle priorità
   * @returns {Array<number>} Array con la distribuzione normalizzata delle priorità
   */
  getPriorityDistribution() {
    const distribution = Array(this.options.priorityLevels).fill(0);
    let totalItems = 0;
    
    for (const item of this.heap.toArray()) {
      const priorityLevel = Math.min(this.options.priorityLevels - 1, Math.floor(item.priority * this.options.priorityLevels));
      distribution[priorityLevel]++;
      totalItems++;
    }
    
    // Normalizza la distribuzione
    return distribution.map(count => totalItems > 0 ? count / totalItems : 0);
  }
  
  /**
   * Verifica se il backpressure è attivo
   * @returns {boolean} True se il backpressure è attivo
   */
  isBackpressureActive() {
    return this.isBackpressureActive;
  }
  
  /**
   * Pulisce la coda
   */
  clear() {
    this.heap.clear();
    this.size = 0;
    this.isBackpressureActive = false;
    this.pendingBatches.clear();
    
    // Resetta le metriche di distribuzione
    this.metrics.priorityDistribution = Array(this.options.priorityLevels).fill(0);
  }
  
  /**
   * Chiude la coda e termina i worker
   */
  async close() {
    // Imposta il flag di chiusura
    this.isShuttingDown = true;
    
    // Cancella i timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    if (this.agingTimer) {
      clearInterval(this.agingTimer);
      this.agingTimer = null;
    }
    
    // Termina i worker
    for (const worker of this.workers) {
      worker.terminate();
    }
    
    this.workers = [];
    console.log('PriorityQueue chiusa');
    
    // Emetti evento di chiusura
    this.emit('closed');
  }
}

module.exports = { PriorityQueue, BinaryHeap };
