/**
 * Implementazione del pattern LMAX Disruptor per il Layer-2 su Solana
 * 
 * Questo modulo implementa il pattern LMAX Disruptor per l'elaborazione ad alte prestazioni
 * di eventi e transazioni, con supporto per elaborazione parallela, gestione delle dipendenze
 * e monitoraggio avanzato delle prestazioni.
 */

const { EventEmitter } = require('events');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/**
 * Classe RingBuffer
 * 
 * Implementa un buffer circolare ottimizzato per il pattern Disruptor
 */
class RingBuffer {
  /**
   * Costruttore
   * @param {number} size - Dimensione del buffer (deve essere una potenza di 2)
   */
  constructor(size) {
    // Verifica che la dimensione sia una potenza di 2
    if ((size & (size - 1)) !== 0) {
      // Arrotonda alla potenza di 2 successiva
      size = 1 << (32 - Math.clz32(size));
    }
    
    this.size = size;
    this.mask = size - 1;
    this.buffer = new Array(size);
    this.sequences = new Uint32Array(1); // Sequenza corrente
    
    // Inizializza il buffer
    for (let i = 0; i < size; i++) {
      this.buffer[i] = {
        sequence: -1,
        data: null,
        status: 'empty'
      };
    }
  }
  
  /**
   * Ottiene la sequenza corrente
   * @returns {number} Sequenza corrente
   */
  getSequence() {
    return Atomics.load(this.sequences, 0);
  }
  
  /**
   * Incrementa la sequenza
   * @returns {number} Nuova sequenza
   */
  incrementSequence() {
    return Atomics.add(this.sequences, 0, 1);
  }
  
  /**
   * Ottiene l'indice nel buffer per una sequenza
   * @param {number} sequence - Sequenza
   * @returns {number} Indice nel buffer
   */
  getIndex(sequence) {
    return sequence & this.mask;
  }
  
  /**
   * Ottiene uno slot nel buffer
   * @param {number} sequence - Sequenza
   * @returns {Object} Slot nel buffer
   */
  getSlot(sequence) {
    return this.buffer[this.getIndex(sequence)];
  }
  
  /**
   * Pubblica un elemento nel buffer
   * @param {*} data - Dati da pubblicare
   * @returns {number} Sequenza assegnata
   */
  publish(data) {
    const sequence = this.incrementSequence();
    const index = this.getIndex(sequence);
    const slot = this.buffer[index];
    
    // Aggiorna lo slot
    slot.sequence = sequence;
    slot.data = data;
    slot.status = 'published';
    
    return sequence;
  }
  
  /**
   * Legge un elemento dal buffer
   * @param {number} sequence - Sequenza da leggere
   * @returns {*} Dati letti
   */
  read(sequence) {
    const slot = this.getSlot(sequence);
    
    if (slot.sequence !== sequence) {
      return null;
    }
    
    return slot.data;
  }
  
  /**
   * Marca un elemento come elaborato
   * @param {number} sequence - Sequenza da marcare
   */
  markProcessed(sequence) {
    const slot = this.getSlot(sequence);
    
    if (slot.sequence === sequence) {
      slot.status = 'processed';
    }
  }
  
  /**
   * Pulisce il buffer
   */
  clear() {
    for (let i = 0; i < this.size; i++) {
      this.buffer[i] = {
        sequence: -1,
        data: null,
        status: 'empty'
      };
    }
    
    Atomics.store(this.sequences, 0, 0);
  }
}

/**
 * Classe Sequencer
 * 
 * Gestisce la sequenza degli eventi nel Disruptor
 */
class Sequencer {
  /**
   * Costruttore
   * @param {RingBuffer} ringBuffer - Buffer circolare
   */
  constructor(ringBuffer) {
    this.ringBuffer = ringBuffer;
    this.cursor = -1;
    this.gatingSequences = [];
  }
  
  /**
   * Aggiunge una sequenza di gating
   * @param {Object} sequence - Sequenza di gating
   */
  addGatingSequence(sequence) {
    this.gatingSequences.push(sequence);
  }
  
  /**
   * Ottiene la sequenza corrente
   * @returns {number} Sequenza corrente
   */
  getCursor() {
    return this.cursor;
  }
  
  /**
   * Ottiene la sequenza minima tra le sequenze di gating
   * @returns {number} Sequenza minima
   */
  getMinimumSequence() {
    if (this.gatingSequences.length === 0) {
      return -1;
    }
    
    return Math.min(...this.gatingSequences.map(s => s.get()));
  }
  
  /**
   * Verifica se c'è spazio disponibile nel buffer
   * @returns {boolean} True se c'è spazio disponibile
   */
  hasAvailableCapacity() {
    const minSequence = this.getMinimumSequence();
    return (this.cursor - minSequence) < this.ringBuffer.size;
  }
  
  /**
   * Richiede la prossima sequenza
   * @returns {number} Prossima sequenza
   */
  next() {
    // Verifica se c'è spazio disponibile
    if (!this.hasAvailableCapacity()) {
      throw new Error('Ring buffer full');
    }
    
    // Incrementa il cursore
    this.cursor++;
    
    return this.cursor;
  }
  
  /**
   * Pubblica una sequenza
   * @param {number} sequence - Sequenza da pubblicare
   */
  publish(sequence) {
    // Verifica che la sequenza sia valida
    if (sequence !== this.cursor) {
      throw new Error('Invalid sequence');
    }
  }
}

/**
 * Classe EventProcessor
 * 
 * Elabora gli eventi dal buffer circolare
 */
class EventProcessor {
  /**
   * Costruttore
   * @param {RingBuffer} ringBuffer - Buffer circolare
   * @param {Function} handler - Funzione di gestione degli eventi
   */
  constructor(ringBuffer, handler) {
    this.ringBuffer = ringBuffer;
    this.handler = handler;
    this.sequence = -1;
    this.running = false;
  }
  
  /**
   * Ottiene la sequenza corrente
   * @returns {number} Sequenza corrente
   */
  get() {
    return this.sequence;
  }
  
  /**
   * Avvia l'elaborazione degli eventi
   */
  start() {
    this.running = true;
    this._process();
  }
  
  /**
   * Ferma l'elaborazione degli eventi
   */
  stop() {
    this.running = false;
  }
  
  /**
   * Elabora gli eventi
   * @private
   */
  async _process() {
    while (this.running) {
      try {
        // Leggi la prossima sequenza
        const nextSequence = this.sequence + 1;
        
        // Leggi l'evento
        const event = this.ringBuffer.read(nextSequence);
        
        if (event) {
          // Elabora l'evento
          await this.handler(event, nextSequence);
          
          // Aggiorna la sequenza
          this.sequence = nextSequence;
          
          // Marca l'evento come elaborato
          this.ringBuffer.markProcessed(nextSequence);
        } else {
          // Nessun evento disponibile, attendi
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      } catch (error) {
        console.error('Error processing event:', error);
      }
    }
  }
}

/**
 * Classe Disruptor
 * 
 * Implementa il pattern LMAX Disruptor per l'elaborazione ad alte prestazioni
 * di eventi e transazioni.
 */
class Disruptor extends EventEmitter {
  /**
   * Costruttore
   * @param {Object} options - Opzioni di configurazione
   */
  constructor(options = {}) {
    super();
    
    // Configurazione
    this.options = {
      bufferSize: options.bufferSize || 1024,
      workerCount: options.workerCount || Math.max(1, Math.min(os.cpus().length - 1, 4)),
      enableParallelProcessing: options.enableParallelProcessing !== false,
      batchSize: options.batchSize || 100,
      waitStrategy: options.waitStrategy || 'yielding', // 'yielding', 'sleeping', 'blocking'
      claimStrategy: options.claimStrategy || 'single', // 'single', 'multi'
      enableMetrics: options.enableMetrics !== false,
      metricsInterval: options.metricsInterval || 10000, // 10 secondi
      enableDependencyTracking: options.enableDependencyTracking !== false,
      maxDependencies: options.maxDependencies || 1000,
      workerScript: options.workerScript || path.join(__dirname, 'disruptor-worker.js'),
      enableBatchProcessing: options.enableBatchProcessing !== false,
      batchTimeout: options.batchTimeout || 10, // 10 ms
      enablePrioritization: options.enablePrioritization !== false,
      priorityLevels: options.priorityLevels || 3,
      defaultPriority: options.defaultPriority || 1
    };
    
    // Stato interno
    this.ringBuffer = new RingBuffer(this.options.bufferSize);
    this.sequencer = new Sequencer(this.ringBuffer);
    this.processors = [];
    this.workers = [];
    this.dependencyGraph = new Map();
    this.pendingEvents = new Map();
    this.processingEvents = new Map();
    this.completedEvents = new Set();
    this.eventIdCounter = 0;
    this.isShuttingDown = false;
    this.batchTimer = null;
    this.currentBatch = [];
    
    // Metriche
    this.metrics = {
      published: 0,
      processed: 0,
      failed: 0,
      avgProcessingTime: 0,
      totalProcessingTime: 0,
      batchesProcessed: 0,
      itemsPerBatch: 0,
      bufferUtilization: 0,
      dependencyWaits: 0,
      lastMetricsTime: Date.now()
    };
    
    // Inizializzazione
    this._initialize();
  }
  
  /**
   * Inizializza il Disruptor
   * @private
   */
  _initialize() {
    console.log(`Inizializzazione LMAX Disruptor con buffer di dimensione ${this.options.bufferSize}...`);
    
    // Inizializza i worker se l'elaborazione parallela è abilitata
    if (this.options.enableParallelProcessing) {
      this._initializeWorkers();
    }
    
    // Inizializza i processori di eventi
    this._initializeProcessors();
    
    // Avvia il monitoraggio delle metriche se abilitato
    if (this.options.enableMetrics) {
      this._startMetricsMonitoring();
    }
    
    // Avvia il batch processing se abilitato
    if (this.options.enableBatchProcessing) {
      this._startBatchProcessing();
    }
    
    console.log(`LMAX Disruptor inizializzato con ${this.options.workerCount} worker`);
    
    // Emetti evento di inizializzazione completata
    this.emit('initialized', {
      bufferSize: this.options.bufferSize,
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
          options: {
            enableDependencyTracking: this.options.enableDependencyTracking,
            enablePrioritization: this.options.enablePrioritization,
            priorityLevels: this.options.priorityLevels
          }
        }
      });
      
      worker.on('message', (message) => {
        if (message.type === 'event_processed') {
          this._handleEventProcessed(message.eventId, message.result, null);
        } else if (message.type === 'event_failed') {
          this._handleEventProcessed(message.eventId, null, new Error(message.error));
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
        options: {
          enableDependencyTracking: this.options.enableDependencyTracking,
          enablePrioritization: this.options.enablePrioritization,
          priorityLevels: this.options.priorityLevels
        }
      }
    });
    
    worker.on('message', (message) => {
      if (message.type === 'event_processed') {
        this._handleEventProcessed(message.eventId, message.result, null);
      } else if (message.type === 'event_failed') {
        this._handleEventProcessed(message.eventId, null, new Error(message.error));
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
   * Inizializza i processori di eventi
   * @private
   */
  _initializeProcessors() {
    // Crea un processore di eventi per ogni worker
    for (let i = 0; i < this.options.workerCount; i++) {
      const processor = new EventProcessor(this.ringBuffer, async (event, sequence) => {
        await this._processEvent(event, sequence);
      });
      
      // Aggiungi il processore alla lista
      this.processors.push(processor);
      
      // Aggiungi il processore come sequenza di gating
      this.sequencer.addGatingSequence(processor);
      
      // Avvia il processore
      processor.start();
    }
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
        const publishRate = this.metrics.published / elapsed;
        const processRate = this.metrics.processed / elapsed;
        
        // Calcola l'utilizzo del buffer
        const cursor = this.sequencer.getCursor();
        const minSequence = this.sequencer.getMinimumSequence();
        const bufferUtilization = (cursor - minSequence) / this.options.bufferSize;
        
        this.metrics.bufferUtilization = bufferUtilization;
        
        console.log(`Disruptor metrics - Publish rate: ${publishRate.toFixed(2)}/s, Process rate: ${processRate.toFixed(2)}/s`);
        console.log(`Buffer utilization: ${(bufferUtilization * 100).toFixed(2)}%, Avg processing time: ${this.metrics.avgProcessingTime.toFixed(2)}ms`);
        console.log(`Batches processed: ${this.metrics.batchesProcessed}, Avg items per batch: ${this.metrics.itemsPerBatch.toFixed(2)}`);
        console.log(`Dependency waits: ${this.metrics.dependencyWaits}, Pending events: ${this.pendingEvents.size}, Processing events: ${this.processingEvents.size}`);
        
        // Emetti evento con le metriche
        this.emit('metrics', {
          timestamp: now,
          publishRate,
          processRate,
          bufferUtilization,
          avgProcessingTime: this.metrics.avgProcessingTime,
          batchesProcessed: this.metrics.batchesProcessed,
          itemsPerBatch: this.metrics.itemsPerBatch,
          dependencyWaits: this.metrics.dependencyWaits,
          pendingEvents: this.pendingEvents.size,
          processingEvents: this.processingEvents.size
        });
        
        // Resetta i contatori
        this.metrics.published = 0;
        this.metrics.processed = 0;
        this.metrics.failed = 0;
        this.metrics.batchesProcessed = 0;
        this.metrics.itemsPerBatch = 0;
        this.metrics.dependencyWaits = 0;
        this.metrics.lastMetricsTime = now;
      }
    }, this.options.metricsInterval);
  }
  
  /**
   * Avvia il batch processing
   * @private
   */
  _startBatchProcessing() {
    this.batchTimer = setInterval(() => {
      this._processBatch();
    }, this.options.batchTimeout);
  }
  
  /**
   * Processa un batch di eventi
   * @private
   */
  _processBatch() {
    if (this.currentBatch.length === 0) {
      return;
    }
    
    // Crea una copia del batch corrente
    const batch = [...this.currentBatch];
    this.currentBatch = [];
    
    // Aggiorna le metriche
    this.metrics.batchesProcessed++;
    this.metrics.itemsPerBatch = (this.metrics.itemsPerBatch + batch.length) / 2; // Media mobile
    
    // Pubblica gli eventi nel buffer
    for (const event of batch) {
      try {
        // Richiedi la prossima sequenza
        const sequence = this.sequencer.next();
        
        // Pubblica l'evento nel buffer
        this.ringBuffer.publish(event);
        
        // Pubblica la sequenza
        this.sequencer.publish(sequence);
        
        // Aggiorna le metriche
        this.metrics.published++;
      } catch (error) {
        console.error('Error publishing event:', error);
        
        // Notifica l'errore
        if (event.callback) {
          event.callback(error);
        }
      }
    }
  }
  
  /**
   * Processa un evento
   * @param {Object} event - Evento da processare
   * @param {number} sequence - Sequenza dell'evento
   * @private
   */
  async _processEvent(event, sequence) {
    // Verifica se l'evento ha dipendenze
    if (this.options.enableDependencyTracking && event.dependencies && event.dependencies.length > 0) {
      // Verifica se tutte le dipendenze sono state completate
      const allDependenciesCompleted = event.dependencies.every(depId => this.completedEvents.has(depId));
      
      if (!allDependenciesCompleted) {
        // Metti l'evento in attesa
        this.pendingEvents.set(event.id, {
          event,
          sequence,
          dependencies: event.dependencies
        });
        
        // Aggiorna le metriche
        this.metrics.dependencyWaits++;
        
        return;
      }
    }
    
    // Marca l'evento come in elaborazione
    this.processingEvents.set(event.id, {
      event,
      sequence,
      startTime: Date.now()
    });
    
    try {
      // Elabora l'evento
      let result;
      
      if (this.options.enableParallelProcessing && this.workers.length > 0) {
        // Distribuisci l'elaborazione ai worker
        const workerIndex = sequence % this.workers.length;
        
        // Invia l'evento al worker
        this.workers[workerIndex].postMessage({
          type: 'process_event',
          eventId: event.id,
          event: event.data,
          timestamp: Date.now()
        });
        
        // Il risultato verrà gestito dal callback del worker
      } else {
        // Elabora l'evento direttamente
        result = await this._executeEvent(event);
        
        // Gestisci il completamento dell'evento
        this._handleEventProcessed(event.id, result, null);
      }
    } catch (error) {
      console.error('Error processing event:', error);
      
      // Gestisci l'errore
      this._handleEventProcessed(event.id, null, error);
    }
  }
  
  /**
   * Esegue un evento
   * @param {Object} event - Evento da eseguire
   * @returns {Promise<*>} Risultato dell'evento
   * @private
   */
  async _executeEvent(event) {
    // Implementazione dell'esecuzione dell'evento
    // Questa è una semplice implementazione di esempio
    
    // Simula un'elaborazione
    await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
    
    // Restituisci un risultato
    return {
      eventId: event.id,
      result: `Processed event ${event.id}`,
      timestamp: Date.now()
    };
  }
  
  /**
   * Gestisce il completamento di un evento
   * @param {string} eventId - ID dell'evento
   * @param {*} result - Risultato dell'evento
   * @param {Error} error - Errore dell'evento
   * @private
   */
  _handleEventProcessed(eventId, result, error) {
    // Verifica se l'evento è in elaborazione
    if (!this.processingEvents.has(eventId)) {
      console.warn(`Event ${eventId} not found in processing events`);
      return;
    }
    
    // Recupera l'evento
    const { event, sequence, startTime } = this.processingEvents.get(eventId);
    
    // Rimuovi l'evento dalla lista degli eventi in elaborazione
    this.processingEvents.delete(eventId);
    
    // Calcola il tempo di elaborazione
    const processingTime = Date.now() - startTime;
    
    // Aggiorna le metriche
    if (error) {
      this.metrics.failed++;
    } else {
      this.metrics.processed++;
      this.metrics.totalProcessingTime += processingTime;
      this.metrics.avgProcessingTime = this.metrics.totalProcessingTime / this.metrics.processed;
    }
    
    // Marca l'evento come completato
    this.completedEvents.add(eventId);
    
    // Limita la dimensione del set degli eventi completati
    if (this.completedEvents.size > this.options.maxDependencies) {
      // Rimuovi gli eventi più vecchi
      const eventsToRemove = Array.from(this.completedEvents).slice(0, this.completedEvents.size - this.options.maxDependencies);
      for (const id of eventsToRemove) {
        this.completedEvents.delete(id);
      }
    }
    
    // Notifica il completamento dell'evento
    if (event.callback) {
      event.callback(error, result);
    }
    
    // Emetti evento di completamento
    this.emit('event_processed', {
      eventId,
      result,
      error,
      processingTime
    });
    
    // Verifica se ci sono eventi in attesa che dipendono da questo
    this._checkPendingEvents(eventId);
  }
  
  /**
   * Verifica se ci sono eventi in attesa che dipendono da un evento completato
   * @param {string} completedEventId - ID dell'evento completato
   * @private
   */
  _checkPendingEvents(completedEventId) {
    // Trova gli eventi in attesa che dipendono dall'evento completato
    const eventsToProcess = [];
    
    for (const [pendingId, pendingInfo] of this.pendingEvents.entries()) {
      // Verifica se l'evento dipende dall'evento completato
      if (pendingInfo.dependencies.includes(completedEventId)) {
        // Rimuovi la dipendenza
        pendingInfo.dependencies = pendingInfo.dependencies.filter(id => id !== completedEventId);
        
        // Se non ci sono più dipendenze, processa l'evento
        if (pendingInfo.dependencies.length === 0) {
          eventsToProcess.push({
            id: pendingId,
            info: pendingInfo
          });
        }
      }
    }
    
    // Processa gli eventi pronti
    for (const { id, info } of eventsToProcess) {
      // Rimuovi l'evento dalla lista degli eventi in attesa
      this.pendingEvents.delete(id);
      
      // Processa l'evento
      this._processEvent(info.event, info.sequence);
    }
  }
  
  /**
   * Pubblica un evento nel Disruptor
   * @param {Object} data - Dati dell'evento
   * @param {Object} options - Opzioni dell'evento
   * @returns {Promise<*>} Risultato dell'evento
   */
  async publish(data, options = {}) {
    // Verifica se il Disruptor è in fase di chiusura
    if (this.isShuttingDown) {
      throw new Error('Disruptor is shutting down');
    }
    
    // Crea l'evento
    const eventId = `event_${Date.now()}_${this.eventIdCounter++}_${crypto.randomBytes(4).toString('hex')}`;
    
    // Crea una promessa per il risultato
    const promise = new Promise((resolve, reject) => {
      const event = {
        id: eventId,
        data,
        timestamp: Date.now(),
        dependencies: options.dependencies || [],
        priority: options.priority !== undefined ? options.priority : this.options.defaultPriority,
        callback: (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        }
      };
      
      // Aggiungi l'evento al batch corrente
      if (this.options.enableBatchProcessing) {
        this.currentBatch.push(event);
        
        // Se il batch è pieno, processalo immediatamente
        if (this.currentBatch.length >= this.options.batchSize) {
          this._processBatch();
        }
      } else {
        // Pubblica l'evento direttamente
        try {
          // Richiedi la prossima sequenza
          const sequence = this.sequencer.next();
          
          // Pubblica l'evento nel buffer
          this.ringBuffer.publish(event);
          
          // Pubblica la sequenza
          this.sequencer.publish(sequence);
          
          // Aggiorna le metriche
          this.metrics.published++;
        } catch (error) {
          reject(error);
        }
      }
    });
    
    return promise;
  }
  
  /**
   * Registra una dipendenza tra eventi
   * @param {string} eventId - ID dell'evento dipendente
   * @param {string|Array<string>} dependencies - ID dell'evento o degli eventi da cui dipende
   * @returns {boolean} True se la registrazione ha avuto successo
   */
  registerDependency(eventId, dependencies) {
    if (!this.options.enableDependencyTracking) {
      return false;
    }
    
    // Converti le dipendenze in array se necessario
    const deps = Array.isArray(dependencies) ? dependencies : [dependencies];
    
    // Verifica se l'evento è in attesa
    if (this.pendingEvents.has(eventId)) {
      const pendingInfo = this.pendingEvents.get(eventId);
      
      // Aggiungi le dipendenze
      for (const dep of deps) {
        if (!pendingInfo.dependencies.includes(dep)) {
          pendingInfo.dependencies.push(dep);
        }
      }
      
      return true;
    }
    
    // Verifica se l'evento è in elaborazione
    if (this.processingEvents.has(eventId)) {
      console.warn(`Cannot register dependencies for event ${eventId} because it is already being processed`);
      return false;
    }
    
    // L'evento non è stato trovato
    return false;
  }
  
  /**
   * Ottiene le statistiche del Disruptor
   * @returns {Object} Statistiche del Disruptor
   */
  getStats() {
    // Calcola l'utilizzo del buffer
    const cursor = this.sequencer.getCursor();
    const minSequence = this.sequencer.getMinimumSequence();
    const bufferUtilization = (cursor - minSequence) / this.options.bufferSize;
    
    return {
      bufferSize: this.options.bufferSize,
      bufferUtilization,
      pendingEvents: this.pendingEvents.size,
      processingEvents: this.processingEvents.size,
      completedEvents: this.completedEvents.size,
      metrics: { ...this.metrics }
    };
  }
  
  /**
   * Chiude il Disruptor
   * @returns {Promise<void>}
   */
  async close() {
    // Imposta il flag di chiusura
    this.isShuttingDown = true;
    
    console.log('Chiusura del Disruptor...');
    
    // Cancella il timer del batch processing
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
    
    // Processa gli eventi rimanenti nel batch
    if (this.currentBatch.length > 0) {
      this._processBatch();
    }
    
    // Attendi che tutti gli eventi in elaborazione siano completati
    if (this.processingEvents.size > 0) {
      console.log(`Attesa completamento di ${this.processingEvents.size} eventi in elaborazione...`);
      
      await new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (this.processingEvents.size === 0) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });
    }
    
    // Ferma i processori
    for (const processor of this.processors) {
      processor.stop();
    }
    
    // Termina i worker
    for (const worker of this.workers) {
      worker.terminate();
    }
    
    console.log('Disruptor chiuso');
    
    // Emetti evento di chiusura
    this.emit('closed');
  }
}

module.exports = { Disruptor, RingBuffer, Sequencer, EventProcessor };
