/**
 * Implementazione dello Shared Ring Buffer per il Layer-2 su Solana
 * 
 * Questo modulo implementa un buffer circolare condiviso ad alte prestazioni
 * per la comunicazione efficiente tra thread e processi.
 */

const { EventEmitter } = require('events');
const { performance } = require('perf_hooks');
const { Worker, isMainThread, parentPort, MessageChannel, threadId } = require('worker_threads');
const os = require('os');
const crypto = require('crypto');
const { PerformanceMetrics } = require('./performance-metrics');

/**
 * Classe BufferEntry
 * 
 * Rappresenta un'entry nel buffer circolare
 */
class BufferEntry {
  /**
   * Costruttore
   * @param {number} index - Indice dell'entry
   * @param {number} size - Dimensione dell'entry in byte
   */
  constructor(index, size) {
    this.index = index;
    this.size = size;
    this.data = null;
    this.metadata = {};
    this.timestamp = 0;
    this.sequence = 0;
    this.producerId = null;
    this.consumerId = null;
    this.state = 'empty'; // empty, writing, ready, reading, processed
    this.retries = 0;
    this.lock = false;
  }

  /**
   * Resetta l'entry
   */
  reset() {
    this.data = null;
    this.metadata = {};
    this.timestamp = 0;
    this.sequence = 0;
    this.producerId = null;
    this.consumerId = null;
    this.state = 'empty';
    this.retries = 0;
    this.lock = false;
  }

  /**
   * Verifica se l'entry è vuota
   * @returns {boolean} - True se l'entry è vuota
   */
  isEmpty() {
    return this.state === 'empty';
  }

  /**
   * Verifica se l'entry è pronta per essere letta
   * @returns {boolean} - True se l'entry è pronta
   */
  isReady() {
    return this.state === 'ready';
  }

  /**
   * Verifica se l'entry è in fase di scrittura
   * @returns {boolean} - True se l'entry è in fase di scrittura
   */
  isWriting() {
    return this.state === 'writing';
  }

  /**
   * Verifica se l'entry è in fase di lettura
   * @returns {boolean} - True se l'entry è in fase di lettura
   */
  isReading() {
    return this.state === 'reading';
  }

  /**
   * Verifica se l'entry è stata processata
   * @returns {boolean} - True se l'entry è stata processata
   */
  isProcessed() {
    return this.state === 'processed';
  }

  /**
   * Verifica se l'entry è bloccata
   * @returns {boolean} - True se l'entry è bloccata
   */
  isLocked() {
    return this.lock;
  }

  /**
   * Blocca l'entry
   * @returns {boolean} - True se il blocco è riuscito
   */
  tryLock() {
    if (this.lock) {
      return false;
    }

    this.lock = true;
    return true;
  }

  /**
   * Sblocca l'entry
   */
  unlock() {
    this.lock = false;
  }

  /**
   * Imposta lo stato dell'entry
   * @param {string} state - Nuovo stato
   */
  setState(state) {
    this.state = state;
  }

  /**
   * Imposta i dati dell'entry
   * @param {*} data - Dati
   * @param {Object} metadata - Metadati
   * @param {number} sequence - Numero di sequenza
   * @param {string} producerId - ID del produttore
   */
  setData(data, metadata = {}, sequence = 0, producerId = null) {
    this.data = data;
    this.metadata = metadata;
    this.timestamp = Date.now();
    this.sequence = sequence;
    this.producerId = producerId;
    this.state = 'ready';
  }

  /**
   * Ottiene i dati dell'entry
   * @returns {Object} - Dati e metadati
   */
  getData() {
    return {
      data: this.data,
      metadata: this.metadata,
      timestamp: this.timestamp,
      sequence: this.sequence,
      producerId: this.producerId
    };
  }

  /**
   * Marca l'entry come in fase di lettura
   * @param {string} consumerId - ID del consumatore
   */
  markReading(consumerId) {
    this.state = 'reading';
    this.consumerId = consumerId;
  }

  /**
   * Marca l'entry come processata
   */
  markProcessed() {
    this.state = 'processed';
  }

  /**
   * Incrementa il contatore di tentativi
   * @returns {number} - Nuovo numero di tentativi
   */
  incrementRetries() {
    return ++this.retries;
  }

  /**
   * Ottiene l'età dell'entry
   * @returns {number} - Età in millisecondi
   */
  getAge() {
    return Date.now() - this.timestamp;
  }
}

/**
 * Classe RingBufferCursor
 * 
 * Rappresenta un cursore nel buffer circolare
 */
class RingBufferCursor {
  /**
   * Costruttore
   * @param {string} id - ID del cursore
   * @param {string} type - Tipo di cursore (producer, consumer)
   * @param {number} position - Posizione iniziale
   */
  constructor(id, type, position = 0) {
    this.id = id;
    this.type = type;
    this.position = position;
    this.lastPosition = position;
    this.sequence = 0;
    this.lastUpdateTime = Date.now();
    this.active = true;
    this.stalled = false;
    this.stalledSince = null;
    this.processedCount = 0;
    this.errorCount = 0;
  }

  /**
   * Avanza il cursore
   * @param {number} bufferSize - Dimensione del buffer
   * @returns {number} - Nuova posizione
   */
  advance(bufferSize) {
    this.lastPosition = this.position;
    this.position = (this.position + 1) % bufferSize;
    this.sequence++;
    this.lastUpdateTime = Date.now();
    this.stalled = false;
    this.stalledSince = null;
    return this.position;
  }

  /**
   * Imposta la posizione del cursore
   * @param {number} position - Nuova posizione
   * @param {number} bufferSize - Dimensione del buffer
   */
  setPosition(position, bufferSize) {
    this.lastPosition = this.position;
    this.position = position % bufferSize;
    this.lastUpdateTime = Date.now();
  }

  /**
   * Incrementa il contatore di elementi processati
   */
  incrementProcessedCount() {
    this.processedCount++;
  }

  /**
   * Incrementa il contatore di errori
   */
  incrementErrorCount() {
    this.errorCount++;
  }

  /**
   * Marca il cursore come stalled
   */
  markStalled() {
    if (!this.stalled) {
      this.stalled = true;
      this.stalledSince = Date.now();
    }
  }

  /**
   * Verifica se il cursore è stalled
   * @param {number} threshold - Soglia in millisecondi
   * @returns {boolean} - True se il cursore è stalled
   */
  isStalled(threshold) {
    if (!this.stalled) {
      return false;
    }

    return Date.now() - this.stalledSince > threshold;
  }

  /**
   * Ottiene il tempo di inattività
   * @returns {number} - Tempo di inattività in millisecondi
   */
  getIdleTime() {
    return Date.now() - this.lastUpdateTime;
  }

  /**
   * Verifica se il cursore è attivo
   * @returns {boolean} - True se il cursore è attivo
   */
  isActive() {
    return this.active;
  }

  /**
   * Attiva il cursore
   */
  activate() {
    this.active = true;
  }

  /**
   * Disattiva il cursore
   */
  deactivate() {
    this.active = false;
  }

  /**
   * Ottiene le statistiche del cursore
   * @returns {Object} - Statistiche
   */
  getStats() {
    return {
      id: this.id,
      type: this.type,
      position: this.position,
      sequence: this.sequence,
      active: this.active,
      stalled: this.stalled,
      stalledSince: this.stalledSince,
      lastUpdateTime: this.lastUpdateTime,
      idleTime: this.getIdleTime(),
      processedCount: this.processedCount,
      errorCount: this.errorCount
    };
  }
}

/**
 * Classe SharedRingBuffer
 * 
 * Implementa un buffer circolare condiviso
 */
class SharedRingBuffer extends EventEmitter {
  /**
   * Costruttore
   * @param {Object} options - Opzioni
   */
  constructor(options = {}) {
    super();
    
    this.options = {
      size: options.size || 1024,
      entrySize: options.entrySize || 1024,
      waitStrategy: options.waitStrategy || 'yield', // yield, sleep, blocking
      claimStrategy: options.claimStrategy || 'single', // single, multi
      overflowStrategy: options.overflowStrategy || 'block', // block, overwrite, drop
      stalledThreshold: options.stalledThreshold || 5000, // 5 secondi
      cleanupInterval: options.cleanupInterval || 1000, // 1 secondo
      enableMetrics: options.enableMetrics !== false,
      metricsInterval: options.metricsInterval || 10000, // 10 secondi
      ...options
    };
    
    // Genera un ID univoco per il buffer
    this.id = options.id || `ring-buffer-${crypto.randomBytes(4).toString('hex')}`;
    
    // Stato interno
    this.buffer = new Array(this.options.size);
    this.producers = new Map();
    this.consumers = new Map();
    this.producerSequence = 0;
    this.consumerSequence = 0;
    this.isOpen = true;
    this.cleanupTimer = null;
    
    // Metriche
    this.metrics = new PerformanceMetrics('shared_ring_buffer', {
      enableMetrics: this.options.enableMetrics,
      metricsInterval: this.options.metricsInterval
    });
    
    // Inizializza il buffer
    this._initialize();
  }
  
  /**
   * Inizializza il buffer
   * @private
   */
  _initialize() {
    // Inizializza le entry del buffer
    for (let i = 0; i < this.options.size; i++) {
      this.buffer[i] = new BufferEntry(i, this.options.entrySize);
    }
    
    // Avvia il timer di pulizia
    this._startCleanupTimer();
    
    console.log(`SharedRingBuffer inizializzato con ${this.options.size} entry`);
  }
  
  /**
   * Avvia il timer di pulizia
   * @private
   */
  _startCleanupTimer() {
    if (this.options.cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => {
        this._cleanup();
      }, this.options.cleanupInterval);
      
      // Evita che il timer impedisca al processo di terminare
      this.cleanupTimer.unref();
    }
  }
  
  /**
   * Esegue la pulizia del buffer
   * @private
   */
  _cleanup() {
    try {
      // Verifica i cursori stalled
      for (const [id, cursor] of this.producers.entries()) {
        if (cursor.isStalled(this.options.stalledThreshold)) {
          console.warn(`Produttore ${id} stalled da ${Date.now() - cursor.stalledSince}ms`);
          
          // Emetti evento
          this.emit('producer_stalled', {
            id,
            position: cursor.position,
            stalledSince: cursor.stalledSince
          });
        }
      }
      
      for (const [id, cursor] of this.consumers.entries()) {
        if (cursor.isStalled(this.options.stalledThreshold)) {
          console.warn(`Consumatore ${id} stalled da ${Date.now() - cursor.stalledSince}ms`);
          
          // Emetti evento
          this.emit('consumer_stalled', {
            id,
            position: cursor.position,
            stalledSince: cursor.stalledSince
          });
        }
      }
      
      // Verifica le entry bloccate
      let unlockedCount = 0;
      
      for (let i = 0; i < this.buffer.length; i++) {
        const entry = this.buffer[i];
        
        if (entry.isLocked() && entry.getAge() > this.options.stalledThreshold) {
          // Sblocca l'entry
          entry.unlock();
          unlockedCount++;
          
          // Emetti evento
          this.emit('entry_unlocked', {
            index: i,
            age: entry.getAge()
          });
        }
      }
      
      if (unlockedCount > 0) {
        console.warn(`Sbloccate ${unlockedCount} entry bloccate`);
      }
    } catch (error) {
      console.error('Errore durante la pulizia del buffer:', error);
    }
  }
  
  /**
   * Registra un produttore
   * @param {string} id - ID del produttore
   * @returns {RingBufferCursor} - Cursore del produttore
   */
  registerProducer(id = null) {
    // Genera un ID se non fornito
    const producerId = id || `producer-${crypto.randomBytes(4).toString('hex')}`;
    
    // Verifica se il produttore esiste già
    if (this.producers.has(producerId)) {
      throw new Error(`Produttore ${producerId} già registrato`);
    }
    
    // Crea il cursore
    const cursor = new RingBufferCursor(producerId, 'producer', 0);
    
    // Registra il produttore
    this.producers.set(producerId, cursor);
    
    // Emetti evento
    this.emit('producer_registered', {
      id: producerId,
      position: cursor.position
    });
    
    return cursor;
  }
  
  /**
   * Registra un consumatore
   * @param {string} id - ID del consumatore
   * @returns {RingBufferCursor} - Cursore del consumatore
   */
  registerConsumer(id = null) {
    // Genera un ID se non fornito
    const consumerId = id || `consumer-${crypto.randomBytes(4).toString('hex')}`;
    
    // Verifica se il consumatore esiste già
    if (this.consumers.has(consumerId)) {
      throw new Error(`Consumatore ${consumerId} già registrato`);
    }
    
    // Crea il cursore
    const cursor = new RingBufferCursor(consumerId, 'consumer', 0);
    
    // Registra il consumatore
    this.consumers.set(consumerId, cursor);
    
    // Emetti evento
    this.emit('consumer_registered', {
      id: consumerId,
      position: cursor.position
    });
    
    return cursor;
  }
  
  /**
   * Deregistra un produttore
   * @param {string} id - ID del produttore
   * @returns {boolean} - True se la deregistrazione è riuscita
   */
  deregisterProducer(id) {
    // Verifica se il produttore esiste
    if (!this.producers.has(id)) {
      return false;
    }
    
    // Deregistra il produttore
    this.producers.delete(id);
    
    // Emetti evento
    this.emit('producer_deregistered', {
      id
    });
    
    return true;
  }
  
  /**
   * Deregistra un consumatore
   * @param {string} id - ID del consumatore
   * @returns {boolean} - True se la deregistrazione è riuscita
   */
  deregisterConsumer(id) {
    // Verifica se il consumatore esiste
    if (!this.consumers.has(id)) {
      return false;
    }
    
    // Deregistra il consumatore
    this.consumers.delete(id);
    
    // Emetti evento
    this.emit('consumer_deregistered', {
      id
    });
    
    return true;
  }
  
  /**
   * Pubblica un elemento nel buffer
   * @param {*} data - Dati da pubblicare
   * @param {Object} metadata - Metadati
   * @param {string} producerId - ID del produttore
   * @returns {Promise<number>} - Indice dell'elemento pubblicato
   */
  async publish(data, metadata = {}, producerId = null) {
    const startTime = performance.now();
    
    try {
      // Verifica che il buffer sia aperto
      if (!this.isOpen) {
        throw new Error('Buffer chiuso');
      }
      
      // Verifica che il produttore sia registrato
      if (producerId && !this.producers.has(producerId)) {
        throw new Error(`Produttore ${producerId} non registrato`);
      }
      
      // Ottieni il cursore del produttore
      const cursor = producerId ? this.producers.get(producerId) : null;
      
      // Verifica che il cursore sia attivo
      if (cursor && !cursor.isActive()) {
        throw new Error(`Produttore ${producerId} non attivo`);
      }
      
      // Trova una entry disponibile
      const entryIndex = await this._findAvailableEntry(cursor);
      
      // Verifica che l'indice sia valido
      if (entryIndex === -1) {
        throw new Error('Nessuna entry disponibile');
      }
      
      // Ottieni l'entry
      const entry = this.buffer[entryIndex];
      
      // Verifica che l'entry sia disponibile
      if (!entry.isEmpty() || entry.isLocked()) {
        throw new Error(`Entry ${entryIndex} non disponibile`);
      }
      
      // Blocca l'entry
      if (!entry.tryLock()) {
        throw new Error(`Impossibile bloccare l'entry ${entryIndex}`);
      }
      
      try {
        // Imposta lo stato dell'entry
        entry.setState('writing');
        
        // Incrementa la sequenza
        this.producerSequence++;
        
        // Imposta i dati
        entry.setData(
          data,
          metadata,
          cursor ? cursor.sequence : this.producerSequence,
          producerId
        );
        
        // Avanza il cursore
        if (cursor) {
          cursor.advance(this.options.size);
          cursor.incrementProcessedCount();
        }
        
        // Aggiorna le metriche
        const endTime = performance.now();
        this.metrics.recordLatency('publish', endTime - startTime);
        this.metrics.incrementCounter('published');
        
        // Emetti evento
        this.emit('published', {
          index: entryIndex,
          producerId,
          sequence: entry.sequence
        });
        
        return entryIndex;
      } finally {
        // Sblocca l'entry
        entry.unlock();
      }
    } catch (error) {
      console.error('Errore durante la pubblicazione:', error);
      
      // Aggiorna le metriche
      const endTime = performance.now();
      this.metrics.recordLatency('publish_failed', endTime - startTime);
      this.metrics.incrementCounter('publish_failures');
      
      // Incrementa il contatore di errori
      if (producerId && this.producers.has(producerId)) {
        this.producers.get(producerId).incrementErrorCount();
      }
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'publish',
        producerId,
        error
      });
      
      throw error;
    }
  }
  
  /**
   * Trova una entry disponibile
   * @param {RingBufferCursor} cursor - Cursore del produttore
   * @returns {Promise<number>} - Indice della entry disponibile
   * @private
   */
  async _findAvailableEntry(cursor) {
    // Strategia di claim
    if (this.options.claimStrategy === 'single' && cursor) {
      // Strategia single: usa la posizione del cursore
      const position = cursor.position;
      const entry = this.buffer[position];
      
      // Verifica se l'entry è disponibile
      if (entry.isEmpty() && !entry.isLocked()) {
        return position;
      }
      
      // Entry non disponibile, applica la strategia di overflow
      switch (this.options.overflowStrategy) {
        case 'block':
          // Blocca fino a quando l'entry non è disponibile
          return this._waitForAvailableEntry(position);
          
        case 'overwrite':
          // Sovrascrivi l'entry
          return position;
          
        case 'drop':
          // Scarta l'elemento
          return -1;
          
        default:
          throw new Error(`Strategia di overflow non supportata: ${this.options.overflowStrategy}`);
      }
    } else {
      // Strategia multi: cerca la prima entry disponibile
      for (let i = 0; i < this.options.size; i++) {
        const entry = this.buffer[i];
        
        if (entry.isEmpty() && !entry.isLocked()) {
          return i;
        }
      }
      
      // Nessuna entry disponibile, applica la strategia di overflow
      switch (this.options.overflowStrategy) {
        case 'block':
          // Blocca fino a quando una entry non è disponibile
          return this._waitForAnyAvailableEntry();
          
        case 'overwrite':
          // Sovrascrivi la entry più vecchia
          return this._findOldestEntry();
          
        case 'drop':
          // Scarta l'elemento
          return -1;
          
        default:
          throw new Error(`Strategia di overflow non supportata: ${this.options.overflowStrategy}`);
      }
    }
  }
  
  /**
   * Attende che una entry specifica sia disponibile
   * @param {number} index - Indice della entry
   * @returns {Promise<number>} - Indice della entry disponibile
   * @private
   */
  async _waitForAvailableEntry(index) {
    const entry = this.buffer[index];
    let attempts = 0;
    
    // Attendi che l'entry sia disponibile
    while (!entry.isEmpty() || entry.isLocked()) {
      attempts++;
      
      // Applica la strategia di attesa
      switch (this.options.waitStrategy) {
        case 'yield':
          // Cedi il controllo al sistema operativo
          await new Promise(resolve => setImmediate(resolve));
          break;
          
        case 'sleep':
          // Dormi per un breve periodo
          await new Promise(resolve => setTimeout(resolve, 1));
          break;
          
        case 'blocking':
          // Blocca fino a quando l'entry non è disponibile
          await new Promise(resolve => {
            const checkInterval = setInterval(() => {
              if (entry.isEmpty() && !entry.isLocked()) {
                clearInterval(checkInterval);
                resolve();
              }
            }, 1);
          });
          break;
          
        default:
          throw new Error(`Strategia di attesa non supportata: ${this.options.waitStrategy}`);
      }
      
      // Verifica se il buffer è ancora aperto
      if (!this.isOpen) {
        return -1;
      }
      
      // Limita il numero di tentativi
      if (attempts > 1000) {
        console.warn(`Troppi tentativi di attesa per l'entry ${index}`);
        return -1;
      }
    }
    
    return index;
  }
  
  /**
   * Attende che una qualsiasi entry sia disponibile
   * @returns {Promise<number>} - Indice della entry disponibile
   * @private
   */
  async _waitForAnyAvailableEntry() {
    let attempts = 0;
    
    // Attendi che una entry sia disponibile
    while (true) {
      // Cerca una entry disponibile
      for (let i = 0; i < this.options.size; i++) {
        const entry = this.buffer[i];
        
        if (entry.isEmpty() && !entry.isLocked()) {
          return i;
        }
      }
      
      attempts++;
      
      // Applica la strategia di attesa
      switch (this.options.waitStrategy) {
        case 'yield':
          // Cedi il controllo al sistema operativo
          await new Promise(resolve => setImmediate(resolve));
          break;
          
        case 'sleep':
          // Dormi per un breve periodo
          await new Promise(resolve => setTimeout(resolve, 1));
          break;
          
        case 'blocking':
          // Blocca fino a quando una entry non è disponibile
          await new Promise(resolve => {
            const checkInterval = setInterval(() => {
              for (let i = 0; i < this.options.size; i++) {
                const entry = this.buffer[i];
                
                if (entry.isEmpty() && !entry.isLocked()) {
                  clearInterval(checkInterval);
                  resolve();
                  return;
                }
              }
            }, 1);
          });
          break;
          
        default:
          throw new Error(`Strategia di attesa non supportata: ${this.options.waitStrategy}`);
      }
      
      // Verifica se il buffer è ancora aperto
      if (!this.isOpen) {
        return -1;
      }
      
      // Limita il numero di tentativi
      if (attempts > 1000) {
        console.warn('Troppi tentativi di attesa per una entry disponibile');
        return -1;
      }
    }
  }
  
  /**
   * Trova la entry più vecchia
   * @returns {number} - Indice della entry più vecchia
   * @private
   */
  _findOldestEntry() {
    let oldestIndex = 0;
    let oldestTimestamp = Infinity;
    
    // Cerca la entry più vecchia
    for (let i = 0; i < this.options.size; i++) {
      const entry = this.buffer[i];
      
      if (entry.timestamp < oldestTimestamp && !entry.isLocked()) {
        oldestIndex = i;
        oldestTimestamp = entry.timestamp;
      }
    }
    
    return oldestIndex;
  }
  
  /**
   * Consuma un elemento dal buffer
   * @param {string} consumerId - ID del consumatore
   * @returns {Promise<Object>} - Elemento consumato
   */
  async consume(consumerId = null) {
    const startTime = performance.now();
    
    try {
      // Verifica che il buffer sia aperto
      if (!this.isOpen) {
        throw new Error('Buffer chiuso');
      }
      
      // Verifica che il consumatore sia registrato
      if (consumerId && !this.consumers.has(consumerId)) {
        throw new Error(`Consumatore ${consumerId} non registrato`);
      }
      
      // Ottieni il cursore del consumatore
      const cursor = consumerId ? this.consumers.get(consumerId) : null;
      
      // Verifica che il cursore sia attivo
      if (cursor && !cursor.isActive()) {
        throw new Error(`Consumatore ${consumerId} non attivo`);
      }
      
      // Trova una entry disponibile
      const entryIndex = await this._findReadyEntry(cursor);
      
      // Verifica che l'indice sia valido
      if (entryIndex === -1) {
        return null;
      }
      
      // Ottieni l'entry
      const entry = this.buffer[entryIndex];
      
      // Verifica che l'entry sia pronta
      if (!entry.isReady() || entry.isLocked()) {
        return null;
      }
      
      // Blocca l'entry
      if (!entry.tryLock()) {
        return null;
      }
      
      try {
        // Marca l'entry come in fase di lettura
        entry.markReading(consumerId);
        
        // Ottieni i dati
        const data = entry.getData();
        
        // Marca l'entry come processata
        entry.markProcessed();
        
        // Avanza il cursore
        if (cursor) {
          cursor.advance(this.options.size);
          cursor.incrementProcessedCount();
        }
        
        // Incrementa la sequenza
        this.consumerSequence++;
        
        // Aggiorna le metriche
        const endTime = performance.now();
        this.metrics.recordLatency('consume', endTime - startTime);
        this.metrics.incrementCounter('consumed');
        
        // Emetti evento
        this.emit('consumed', {
          index: entryIndex,
          consumerId,
          sequence: data.sequence
        });
        
        return {
          ...data,
          index: entryIndex
        };
      } finally {
        // Sblocca l'entry
        entry.unlock();
      }
    } catch (error) {
      console.error('Errore durante il consumo:', error);
      
      // Aggiorna le metriche
      const endTime = performance.now();
      this.metrics.recordLatency('consume_failed', endTime - startTime);
      this.metrics.incrementCounter('consume_failures');
      
      // Incrementa il contatore di errori
      if (consumerId && this.consumers.has(consumerId)) {
        this.consumers.get(consumerId).incrementErrorCount();
      }
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'consume',
        consumerId,
        error
      });
      
      throw error;
    }
  }
  
  /**
   * Trova una entry pronta per essere letta
   * @param {RingBufferCursor} cursor - Cursore del consumatore
   * @returns {Promise<number>} - Indice della entry pronta
   * @private
   */
  async _findReadyEntry(cursor) {
    // Strategia di claim
    if (cursor) {
      // Usa la posizione del cursore
      const position = cursor.position;
      const entry = this.buffer[position];
      
      // Verifica se l'entry è pronta
      if (entry.isReady() && !entry.isLocked()) {
        return position;
      }
      
      // Entry non pronta, attendi
      return this._waitForReadyEntry(position);
    } else {
      // Cerca la prima entry pronta
      for (let i = 0; i < this.options.size; i++) {
        const entry = this.buffer[i];
        
        if (entry.isReady() && !entry.isLocked()) {
          return i;
        }
      }
      
      // Nessuna entry pronta, attendi
      return this._waitForAnyReadyEntry();
    }
  }
  
  /**
   * Attende che una entry specifica sia pronta
   * @param {number} index - Indice della entry
   * @returns {Promise<number>} - Indice della entry pronta
   * @private
   */
  async _waitForReadyEntry(index) {
    const entry = this.buffer[index];
    let attempts = 0;
    
    // Attendi che l'entry sia pronta
    while (!entry.isReady() || entry.isLocked()) {
      attempts++;
      
      // Applica la strategia di attesa
      switch (this.options.waitStrategy) {
        case 'yield':
          // Cedi il controllo al sistema operativo
          await new Promise(resolve => setImmediate(resolve));
          break;
          
        case 'sleep':
          // Dormi per un breve periodo
          await new Promise(resolve => setTimeout(resolve, 1));
          break;
          
        case 'blocking':
          // Blocca fino a quando l'entry non è pronta
          await new Promise(resolve => {
            const checkInterval = setInterval(() => {
              if (entry.isReady() && !entry.isLocked()) {
                clearInterval(checkInterval);
                resolve();
              }
            }, 1);
          });
          break;
          
        default:
          throw new Error(`Strategia di attesa non supportata: ${this.options.waitStrategy}`);
      }
      
      // Verifica se il buffer è ancora aperto
      if (!this.isOpen) {
        return -1;
      }
      
      // Limita il numero di tentativi
      if (attempts > 1000) {
        console.warn(`Troppi tentativi di attesa per l'entry ${index}`);
        return -1;
      }
    }
    
    return index;
  }
  
  /**
   * Attende che una qualsiasi entry sia pronta
   * @returns {Promise<number>} - Indice della entry pronta
   * @private
   */
  async _waitForAnyReadyEntry() {
    let attempts = 0;
    
    // Attendi che una entry sia pronta
    while (true) {
      // Cerca una entry pronta
      for (let i = 0; i < this.options.size; i++) {
        const entry = this.buffer[i];
        
        if (entry.isReady() && !entry.isLocked()) {
          return i;
        }
      }
      
      attempts++;
      
      // Applica la strategia di attesa
      switch (this.options.waitStrategy) {
        case 'yield':
          // Cedi il controllo al sistema operativo
          await new Promise(resolve => setImmediate(resolve));
          break;
          
        case 'sleep':
          // Dormi per un breve periodo
          await new Promise(resolve => setTimeout(resolve, 1));
          break;
          
        case 'blocking':
          // Blocca fino a quando una entry non è pronta
          await new Promise(resolve => {
            const checkInterval = setInterval(() => {
              for (let i = 0; i < this.options.size; i++) {
                const entry = this.buffer[i];
                
                if (entry.isReady() && !entry.isLocked()) {
                  clearInterval(checkInterval);
                  resolve();
                  return;
                }
              }
            }, 1);
          });
          break;
          
        default:
          throw new Error(`Strategia di attesa non supportata: ${this.options.waitStrategy}`);
      }
      
      // Verifica se il buffer è ancora aperto
      if (!this.isOpen) {
        return -1;
      }
      
      // Limita il numero di tentativi
      if (attempts > 1000) {
        console.warn('Troppi tentativi di attesa per una entry pronta');
        return -1;
      }
    }
  }
  
  /**
   * Resetta una entry
   * @param {number} index - Indice della entry
   * @returns {boolean} - True se il reset è riuscito
   */
  resetEntry(index) {
    try {
      // Verifica che l'indice sia valido
      if (index < 0 || index >= this.options.size) {
        throw new Error(`Indice non valido: ${index}`);
      }
      
      // Ottieni l'entry
      const entry = this.buffer[index];
      
      // Verifica che l'entry non sia bloccata
      if (entry.isLocked()) {
        return false;
      }
      
      // Resetta l'entry
      entry.reset();
      
      // Emetti evento
      this.emit('entry_reset', {
        index
      });
      
      return true;
    } catch (error) {
      console.error(`Errore durante il reset dell'entry ${index}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'resetEntry',
        index,
        error
      });
      
      return false;
    }
  }
  
  /**
   * Resetta tutte le entry
   * @returns {number} - Numero di entry resettate
   */
  resetAllEntries() {
    try {
      let count = 0;
      
      // Resetta tutte le entry
      for (let i = 0; i < this.options.size; i++) {
        const entry = this.buffer[i];
        
        // Verifica che l'entry non sia bloccata
        if (entry.isLocked()) {
          continue;
        }
        
        // Resetta l'entry
        entry.reset();
        count++;
      }
      
      // Emetti evento
      this.emit('all_entries_reset', {
        count
      });
      
      return count;
    } catch (error) {
      console.error('Errore durante il reset di tutte le entry:', error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'resetAllEntries',
        error
      });
      
      return 0;
    }
  }
  
  /**
   * Ottiene le statistiche del buffer
   * @returns {Object} - Statistiche
   */
  getStats() {
    // Conta le entry per stato
    let emptyCount = 0;
    let writingCount = 0;
    let readyCount = 0;
    let readingCount = 0;
    let processedCount = 0;
    let lockedCount = 0;
    
    for (const entry of this.buffer) {
      if (entry.isEmpty()) {
        emptyCount++;
      } else if (entry.isWriting()) {
        writingCount++;
      } else if (entry.isReady()) {
        readyCount++;
      } else if (entry.isReading()) {
        readingCount++;
      } else if (entry.isProcessed()) {
        processedCount++;
      }
      
      if (entry.isLocked()) {
        lockedCount++;
      }
    }
    
    // Statistiche dei produttori
    const producerStats = [];
    for (const [id, cursor] of this.producers.entries()) {
      producerStats.push(cursor.getStats());
    }
    
    // Statistiche dei consumatori
    const consumerStats = [];
    for (const [id, cursor] of this.consumers.entries()) {
      consumerStats.push(cursor.getStats());
    }
    
    return {
      id: this.id,
      size: this.options.size,
      entrySize: this.options.entrySize,
      isOpen: this.isOpen,
      entries: {
        empty: emptyCount,
        writing: writingCount,
        ready: readyCount,
        reading: readingCount,
        processed: processedCount,
        locked: lockedCount
      },
      usage: (this.options.size - emptyCount) / this.options.size,
      producers: {
        count: this.producers.size,
        stats: producerStats
      },
      consumers: {
        count: this.consumers.size,
        stats: consumerStats
      },
      sequences: {
        producer: this.producerSequence,
        consumer: this.consumerSequence
      },
      ...this.metrics.getMetrics()
    };
  }
  
  /**
   * Chiude il buffer
   */
  close() {
    // Verifica che il buffer sia aperto
    if (!this.isOpen) {
      return;
    }
    
    // Imposta il flag di chiusura
    this.isOpen = false;
    
    // Ferma il timer di pulizia
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    // Emetti evento
    this.emit('closed', {
      id: this.id
    });
    
    // Rimuovi tutti i listener
    this.removeAllListeners();
    
    console.log(`SharedRingBuffer ${this.id} chiuso`);
  }
}

/**
 * Classe RingBufferWorker
 * 
 * Implementa un worker per il buffer circolare
 */
class RingBufferWorker {
  /**
   * Costruttore
   * @param {Object} options - Opzioni
   */
  constructor(options = {}) {
    this.options = {
      workerId: options.workerId || `worker-${crypto.randomBytes(4).toString('hex')}`,
      producerId: options.producerId,
      consumerId: options.consumerId,
      processFunction: options.processFunction,
      errorHandler: options.errorHandler,
      batchSize: options.batchSize || 1,
      pollInterval: options.pollInterval || 1,
      maxRetries: options.maxRetries || 3,
      ...options
    };
    
    this.buffer = options.buffer;
    this.isRunning = false;
    this.processedCount = 0;
    this.errorCount = 0;
    this.startTime = null;
    this.stopTime = null;
  }
  
  /**
   * Avvia il worker
   */
  start() {
    // Verifica che il worker non sia già in esecuzione
    if (this.isRunning) {
      return;
    }
    
    // Imposta il flag di esecuzione
    this.isRunning = true;
    this.startTime = Date.now();
    
    // Avvia il loop di elaborazione
    this._processLoop();
    
    console.log(`RingBufferWorker ${this.options.workerId} avviato`);
  }
  
  /**
   * Ferma il worker
   */
  stop() {
    // Verifica che il worker sia in esecuzione
    if (!this.isRunning) {
      return;
    }
    
    // Imposta il flag di esecuzione
    this.isRunning = false;
    this.stopTime = Date.now();
    
    console.log(`RingBufferWorker ${this.options.workerId} fermato`);
  }
  
  /**
   * Loop di elaborazione
   * @private
   */
  async _processLoop() {
    while (this.isRunning) {
      try {
        // Elabora un batch di elementi
        await this._processBatch();
        
        // Attendi il prossimo ciclo
        if (this.options.pollInterval > 0) {
          await new Promise(resolve => setTimeout(resolve, this.options.pollInterval));
        } else {
          await new Promise(resolve => setImmediate(resolve));
        }
      } catch (error) {
        console.error(`Errore nel loop di elaborazione del worker ${this.options.workerId}:`, error);
        this.errorCount++;
        
        // Gestisci l'errore
        if (typeof this.options.errorHandler === 'function') {
          try {
            await this.options.errorHandler(error);
          } catch (handlerError) {
            console.error(`Errore nel gestore degli errori del worker ${this.options.workerId}:`, handlerError);
          }
        }
        
        // Attendi prima di riprovare
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
  
  /**
   * Elabora un batch di elementi
   * @private
   */
  async _processBatch() {
    // Verifica che la funzione di elaborazione sia definita
    if (typeof this.options.processFunction !== 'function') {
      return;
    }
    
    // Elabora un batch di elementi
    const batch = [];
    
    for (let i = 0; i < this.options.batchSize; i++) {
      try {
        // Consuma un elemento
        const item = await this.buffer.consume(this.options.consumerId);
        
        // Verifica che l'elemento sia valido
        if (!item) {
          break;
        }
        
        // Aggiungi l'elemento al batch
        batch.push(item);
      } catch (error) {
        console.error(`Errore durante il consumo dell'elemento nel worker ${this.options.workerId}:`, error);
        this.errorCount++;
        break;
      }
    }
    
    // Verifica che ci siano elementi da elaborare
    if (batch.length === 0) {
      return;
    }
    
    try {
      // Elabora il batch
      await this.options.processFunction(batch);
      
      // Aggiorna il contatore
      this.processedCount += batch.length;
    } catch (error) {
      console.error(`Errore durante l'elaborazione del batch nel worker ${this.options.workerId}:`, error);
      this.errorCount++;
      
      // Gestisci l'errore
      if (typeof this.options.errorHandler === 'function') {
        try {
          await this.options.errorHandler(error, batch);
        } catch (handlerError) {
          console.error(`Errore nel gestore degli errori del worker ${this.options.workerId}:`, handlerError);
        }
      }
    }
  }
  
  /**
   * Pubblica un elemento nel buffer
   * @param {*} data - Dati da pubblicare
   * @param {Object} metadata - Metadati
   * @returns {Promise<number>} - Indice dell'elemento pubblicato
   */
  async publish(data, metadata = {}) {
    return this.buffer.publish(data, metadata, this.options.producerId);
  }
  
  /**
   * Ottiene le statistiche del worker
   * @returns {Object} - Statistiche
   */
  getStats() {
    return {
      workerId: this.options.workerId,
      producerId: this.options.producerId,
      consumerId: this.options.consumerId,
      isRunning: this.isRunning,
      processedCount: this.processedCount,
      errorCount: this.errorCount,
      startTime: this.startTime,
      stopTime: this.stopTime,
      uptime: this.startTime ? (this.stopTime || Date.now()) - this.startTime : 0,
      throughput: this.startTime ? this.processedCount / ((this.stopTime || Date.now()) - this.startTime) * 1000 : 0
    };
  }
}

/**
 * Crea un worker thread per il buffer circolare
 */
function createRingBufferWorkerThread() {
  // Verifica che sia un worker thread
  if (isMainThread) {
    throw new Error('Questa funzione deve essere chiamata da un worker thread');
  }
  
  // Gestisci i messaggi
  parentPort.on('message', async (message) => {
    try {
      const { type, ...params } = message;
      
      switch (type) {
        case 'publish':
          const { buffer, data, metadata, producerId } = params;
          const result = await buffer.publish(data, metadata, producerId);
          parentPort.postMessage({ success: true, result });
          break;
          
        case 'consume':
          const { buffer: consumeBuffer, consumerId } = params;
          const item = await consumeBuffer.consume(consumerId);
          parentPort.postMessage({ success: true, item });
          break;
          
        case 'process':
          const { buffer: processBuffer, consumerId: processConsumerId, processFunction, count } = params;
          
          // Elabora gli elementi
          const results = [];
          
          for (let i = 0; i < count; i++) {
            const item = await processBuffer.consume(processConsumerId);
            
            if (!item) {
              break;
            }
            
            // Elabora l'elemento
            const result = await processFunction(item);
            results.push(result);
          }
          
          parentPort.postMessage({ success: true, results });
          break;
          
        default:
          parentPort.postMessage({ success: false, error: `Tipo di operazione non supportato: ${type}` });
      }
    } catch (error) {
      parentPort.postMessage({ success: false, error: error.message });
    }
  });
}

module.exports = {
  SharedRingBuffer,
  BufferEntry,
  RingBufferCursor,
  RingBufferWorker,
  createRingBufferWorkerThread
};
