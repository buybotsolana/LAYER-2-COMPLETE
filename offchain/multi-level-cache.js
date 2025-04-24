/**
 * Implementazione del Sistema di Cache Multi-livello per il Layer-2 su Solana
 * 
 * Questo modulo implementa un sistema di cache multi-livello con supporto per
 * prefetching predittivo, invalidazione selettiva e compressione adattiva.
 */

const { EventEmitter } = require('events');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const { performance } = require('perf_hooks');
const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { PerformanceMetrics } = require('./performance-metrics');
const { WorkerPool } = require('./worker-pool');

// Promisify zlib functions
const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);
const deflateAsync = promisify(zlib.deflate);
const inflateAsync = promisify(zlib.inflate);
const brotliCompressAsync = promisify(zlib.brotliCompress);
const brotliDecompressAsync = promisify(zlib.brotliDecompress);

/**
 * Classe CacheItem
 * 
 * Rappresenta un elemento nella cache
 */
class CacheItem {
  /**
   * Costruttore
   * @param {string} key - Chiave dell'elemento
   * @param {*} value - Valore dell'elemento
   * @param {Object} options - Opzioni
   */
  constructor(key, value, options = {}) {
    this.key = key;
    this.value = value;
    this.originalSize = this._calculateSize(value);
    this.compressedSize = this.originalSize;
    this.compressed = false;
    this.compressedValue = null;
    this.createdAt = Date.now();
    this.lastAccessed = Date.now();
    this.accessCount = 0;
    this.ttl = options.ttl || 0; // 0 = nessun TTL
    this.priority = options.priority || 0;
    this.tags = options.tags || [];
    this.metadata = options.metadata || {};
    this.dependencies = options.dependencies || [];
    this.dependents = new Set();
  }

  /**
   * Calcola la dimensione di un valore
   * @param {*} value - Valore
   * @returns {number} - Dimensione in byte
   * @private
   */
  _calculateSize(value) {
    if (value === null || value === undefined) {
      return 0;
    }

    if (Buffer.isBuffer(value)) {
      return value.length;
    }

    if (typeof value === 'string') {
      return Buffer.byteLength(value, 'utf8');
    }

    if (typeof value === 'number') {
      return 8;
    }

    if (typeof value === 'boolean') {
      return 1;
    }

    if (Array.isArray(value) || typeof value === 'object') {
      try {
        const json = JSON.stringify(value);
        return Buffer.byteLength(json, 'utf8');
      } catch (error) {
        return 1024; // Valore di default per oggetti non serializzabili
      }
    }

    return 1024; // Valore di default
  }

  /**
   * Verifica se l'elemento è scaduto
   * @returns {boolean} - True se l'elemento è scaduto
   */
  isExpired() {
    if (this.ttl === 0) {
      return false;
    }

    return Date.now() > this.createdAt + this.ttl;
  }

  /**
   * Aggiorna il timestamp di ultimo accesso
   */
  updateAccessTime() {
    this.lastAccessed = Date.now();
    this.accessCount++;
  }

  /**
   * Comprime il valore
   * @param {string} algorithm - Algoritmo di compressione
   * @returns {Promise<boolean>} - True se la compressione è riuscita
   */
  async compress(algorithm = 'gzip') {
    // Se il valore è già compresso, non fare nulla
    if (this.compressed) {
      return true;
    }

    try {
      // Converti il valore in Buffer se necessario
      let valueBuffer;

      if (Buffer.isBuffer(this.value)) {
        valueBuffer = this.value;
      } else if (typeof this.value === 'string') {
        valueBuffer = Buffer.from(this.value, 'utf8');
      } else {
        valueBuffer = Buffer.from(JSON.stringify(this.value), 'utf8');
      }

      // Comprimi il valore
      let compressedValue;

      switch (algorithm) {
        case 'gzip':
          compressedValue = await gzipAsync(valueBuffer);
          break;

        case 'deflate':
          compressedValue = await deflateAsync(valueBuffer);
          break;

        case 'brotli':
          compressedValue = await brotliCompressAsync(valueBuffer);
          break;

        default:
          throw new Error(`Algoritmo di compressione non supportato: ${algorithm}`);
      }

      // Verifica che la compressione sia efficace
      if (compressedValue.length < valueBuffer.length) {
        this.compressedValue = compressedValue;
        this.compressedSize = compressedValue.length;
        this.compressed = true;
        this.compressionAlgorithm = algorithm;
        return true;
      }

      return false;
    } catch (error) {
      console.error(`Errore durante la compressione del valore per la chiave ${this.key}:`, error);
      return false;
    }
  }

  /**
   * Decomprime il valore
   * @returns {Promise<*>} - Valore decompresso
   */
  async decompress() {
    // Se il valore non è compresso, restituisci il valore originale
    if (!this.compressed || !this.compressedValue) {
      return this.value;
    }

    try {
      // Decomprime il valore
      let decompressedValue;

      switch (this.compressionAlgorithm) {
        case 'gzip':
          decompressedValue = await gunzipAsync(this.compressedValue);
          break;

        case 'deflate':
          decompressedValue = await inflateAsync(this.compressedValue);
          break;

        case 'brotli':
          decompressedValue = await brotliDecompressAsync(this.compressedValue);
          break;

        default:
          throw new Error(`Algoritmo di compressione non supportato: ${this.compressionAlgorithm}`);
      }

      // Converti il valore decompresso nel formato originale
      if (typeof this.value === 'string') {
        return decompressedValue.toString('utf8');
      } else if (typeof this.value === 'object' || Array.isArray(this.value)) {
        return JSON.parse(decompressedValue.toString('utf8'));
      }

      return decompressedValue;
    } catch (error) {
      console.error(`Errore durante la decompressione del valore per la chiave ${this.key}:`, error);
      return this.value;
    }
  }

  /**
   * Ottiene il valore dell'elemento
   * @returns {Promise<*>} - Valore dell'elemento
   */
  async getValue() {
    // Aggiorna il timestamp di ultimo accesso
    this.updateAccessTime();

    // Se il valore è compresso, decomprimilo
    if (this.compressed) {
      return this.decompress();
    }

    return this.value;
  }

  /**
   * Aggiunge una dipendenza
   * @param {string} key - Chiave della dipendenza
   */
  addDependency(key) {
    if (!this.dependencies.includes(key)) {
      this.dependencies.push(key);
    }
  }

  /**
   * Aggiunge un dipendente
   * @param {string} key - Chiave del dipendente
   */
  addDependent(key) {
    this.dependents.add(key);
  }

  /**
   * Rimuove un dipendente
   * @param {string} key - Chiave del dipendente
   */
  removeDependent(key) {
    this.dependents.delete(key);
  }

  /**
   * Ottiene i dipendenti
   * @returns {Set<string>} - Dipendenti
   */
  getDependents() {
    return this.dependents;
  }

  /**
   * Ottiene le dipendenze
   * @returns {Array<string>} - Dipendenze
   */
  getDependencies() {
    return this.dependencies;
  }

  /**
   * Ottiene la dimensione dell'elemento
   * @returns {number} - Dimensione in byte
   */
  getSize() {
    return this.compressed ? this.compressedSize : this.originalSize;
  }

  /**
   * Ottiene il rapporto di compressione
   * @returns {number} - Rapporto di compressione
   */
  getCompressionRatio() {
    if (!this.compressed || this.originalSize === 0) {
      return 1;
    }

    return this.compressedSize / this.originalSize;
  }

  /**
   * Ottiene la frequenza di accesso
   * @returns {number} - Frequenza di accesso
   */
  getAccessFrequency() {
    const age = Math.max(1, Date.now() - this.createdAt);
    return (this.accessCount * 1000) / age;
  }

  /**
   * Ottiene il punteggio di priorità
   * @returns {number} - Punteggio di priorità
   */
  getPriorityScore() {
    const recency = Math.max(0, Date.now() - this.lastAccessed) / 1000;
    const frequency = this.getAccessFrequency();
    const size = this.getSize();

    // Calcola il punteggio di priorità
    // Più alto è il punteggio, più alta è la priorità di mantenere l'elemento in cache
    return (frequency * this.priority) / (recency * Math.log(size + 1));
  }
}

/**
 * Classe CacheLevel
 * 
 * Rappresenta un livello nella cache multi-livello
 */
class CacheLevel extends EventEmitter {
  /**
   * Costruttore
   * @param {string} name - Nome del livello
   * @param {Object} options - Opzioni
   */
  constructor(name, options = {}) {
    super();
    
    this.name = name;
    this.options = {
      capacity: options.capacity || 1024 * 1024 * 10, // 10 MB
      ttl: options.ttl || 0, // 0 = nessun TTL
      cleanupInterval: options.cleanupInterval || 60000, // 1 minuto
      compressionThreshold: options.compressionThreshold || 1024, // 1 KB
      compressionMinRatio: options.compressionMinRatio || 0.7, // 30% di riduzione
      compressionAlgorithm: options.compressionAlgorithm || 'gzip',
      enableCompression: options.enableCompression !== false,
      ...options
    };
    
    this.items = new Map();
    this.size = 0;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.cleanupTimer = null;
    
    // Avvia il timer di pulizia
    this._startCleanupTimer();
  }
  
  /**
   * Avvia il timer di pulizia
   * @private
   */
  _startCleanupTimer() {
    if (this.options.cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => {
        this.cleanup().catch(error => {
          console.error(`Errore durante la pulizia del livello ${this.name}:`, error);
        });
      }, this.options.cleanupInterval);
      
      // Evita che il timer impedisca al processo di terminare
      this.cleanupTimer.unref();
    }
  }
  
  /**
   * Imposta un elemento nella cache
   * @param {string} key - Chiave dell'elemento
   * @param {*} value - Valore dell'elemento
   * @param {Object} options - Opzioni
   * @returns {Promise<boolean>} - True se l'operazione è riuscita
   */
  async set(key, value, options = {}) {
    // Verifica che la chiave sia una stringa
    if (typeof key !== 'string') {
      throw new Error('La chiave deve essere una stringa');
    }
    
    // Verifica che il valore non sia undefined
    if (value === undefined) {
      throw new Error('Il valore non può essere undefined');
    }
    
    // Opzioni di default
    const itemOptions = {
      ttl: options.ttl || this.options.ttl,
      priority: options.priority || 1,
      tags: options.tags || [],
      metadata: options.metadata || {},
      dependencies: options.dependencies || [],
      ...options
    };
    
    try {
      // Crea l'elemento
      const item = new CacheItem(key, value, itemOptions);
      
      // Verifica se l'elemento è troppo grande
      if (item.originalSize > this.options.capacity) {
        this.emit('error', {
          level: this.name,
          operation: 'set',
          key,
          error: new Error(`Elemento troppo grande: ${item.originalSize} byte`)
        });
        return false;
      }
      
      // Comprimi l'elemento se necessario
      if (this.options.enableCompression && 
          item.originalSize >= this.options.compressionThreshold) {
        await item.compress(this.options.compressionAlgorithm);
      }
      
      // Verifica se è necessario fare spazio
      const oldItem = this.items.get(key);
      const oldSize = oldItem ? oldItem.getSize() : 0;
      const newSize = item.getSize();
      const sizeDiff = newSize - oldSize;
      
      if (sizeDiff > 0 && this.size + sizeDiff > this.options.capacity) {
        // Fai spazio nella cache
        await this._makeSpace(sizeDiff);
      }
      
      // Aggiorna le dipendenze
      if (oldItem) {
        // Rimuovi il vecchio elemento dalle dipendenze
        for (const depKey of oldItem.getDependencies()) {
          const depItem = this.items.get(depKey);
          if (depItem) {
            depItem.removeDependent(key);
          }
        }
      }
      
      // Aggiungi il nuovo elemento alle dipendenze
      for (const depKey of item.getDependencies()) {
        const depItem = this.items.get(depKey);
        if (depItem) {
          depItem.addDependent(key);
        }
      }
      
      // Aggiorna la dimensione della cache
      this.size = this.size - oldSize + newSize;
      
      // Memorizza l'elemento
      this.items.set(key, item);
      
      // Emetti evento
      this.emit('set', {
        level: this.name,
        key,
        size: newSize,
        compressed: item.compressed,
        compressionRatio: item.getCompressionRatio()
      });
      
      return true;
    } catch (error) {
      console.error(`Errore durante l'impostazione dell'elemento per la chiave ${key}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        level: this.name,
        operation: 'set',
        key,
        error
      });
      
      return false;
    }
  }
  
  /**
   * Ottiene un elemento dalla cache
   * @param {string} key - Chiave dell'elemento
   * @returns {Promise<*>} - Valore dell'elemento o null se non trovato
   */
  async get(key) {
    // Verifica che la chiave sia una stringa
    if (typeof key !== 'string') {
      throw new Error('La chiave deve essere una stringa');
    }
    
    try {
      // Verifica se l'elemento esiste
      if (!this.items.has(key)) {
        this.misses++;
        
        // Emetti evento
        this.emit('miss', {
          level: this.name,
          key
        });
        
        return null;
      }
      
      // Ottieni l'elemento
      const item = this.items.get(key);
      
      // Verifica se l'elemento è scaduto
      if (item.isExpired()) {
        // Rimuovi l'elemento
        this.delete(key);
        
        this.misses++;
        
        // Emetti evento
        this.emit('miss', {
          level: this.name,
          key,
          reason: 'expired'
        });
        
        return null;
      }
      
      // Ottieni il valore
      const value = await item.getValue();
      
      this.hits++;
      
      // Emetti evento
      this.emit('hit', {
        level: this.name,
        key,
        accessCount: item.accessCount,
        lastAccessed: item.lastAccessed
      });
      
      return value;
    } catch (error) {
      console.error(`Errore durante l'ottenimento dell'elemento per la chiave ${key}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        level: this.name,
        operation: 'get',
        key,
        error
      });
      
      return null;
    }
  }
  
  /**
   * Verifica se un elemento esiste nella cache
   * @param {string} key - Chiave dell'elemento
   * @returns {boolean} - True se l'elemento esiste
   */
  has(key) {
    // Verifica che la chiave sia una stringa
    if (typeof key !== 'string') {
      throw new Error('La chiave deve essere una stringa');
    }
    
    // Verifica se l'elemento esiste
    if (!this.items.has(key)) {
      return false;
    }
    
    // Ottieni l'elemento
    const item = this.items.get(key);
    
    // Verifica se l'elemento è scaduto
    if (item.isExpired()) {
      // Rimuovi l'elemento
      this.delete(key);
      return false;
    }
    
    return true;
  }
  
  /**
   * Elimina un elemento dalla cache
   * @param {string} key - Chiave dell'elemento
   * @returns {boolean} - True se l'elemento è stato eliminato
   */
  delete(key) {
    // Verifica che la chiave sia una stringa
    if (typeof key !== 'string') {
      throw new Error('La chiave deve essere una stringa');
    }
    
    try {
      // Verifica se l'elemento esiste
      if (!this.items.has(key)) {
        return false;
      }
      
      // Ottieni l'elemento
      const item = this.items.get(key);
      
      // Aggiorna la dimensione della cache
      this.size -= item.getSize();
      
      // Rimuovi l'elemento dalle dipendenze
      for (const depKey of item.getDependencies()) {
        const depItem = this.items.get(depKey);
        if (depItem) {
          depItem.removeDependent(key);
        }
      }
      
      // Rimuovi l'elemento
      this.items.delete(key);
      
      // Emetti evento
      this.emit('delete', {
        level: this.name,
        key
      });
      
      return true;
    } catch (error) {
      console.error(`Errore durante l'eliminazione dell'elemento per la chiave ${key}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        level: this.name,
        operation: 'delete',
        key,
        error
      });
      
      return false;
    }
  }
  
  /**
   * Elimina tutti gli elementi dalla cache
   * @returns {boolean} - True se l'operazione è riuscita
   */
  clear() {
    try {
      // Rimuovi tutti gli elementi
      this.items.clear();
      
      // Resetta la dimensione
      this.size = 0;
      
      // Emetti evento
      this.emit('clear', {
        level: this.name
      });
      
      return true;
    } catch (error) {
      console.error(`Errore durante la pulizia del livello ${this.name}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        level: this.name,
        operation: 'clear',
        error
      });
      
      return false;
    }
  }
  
  /**
   * Invalida gli elementi con un tag specifico
   * @param {string} tag - Tag
   * @returns {number} - Numero di elementi invalidati
   */
  invalidateByTag(tag) {
    try {
      let count = 0;
      
      // Trova gli elementi con il tag
      for (const [key, item] of this.items.entries()) {
        if (item.tags.includes(tag)) {
          // Rimuovi l'elemento
          this.delete(key);
          count++;
        }
      }
      
      // Emetti evento
      if (count > 0) {
        this.emit('invalidate', {
          level: this.name,
          tag,
          count
        });
      }
      
      return count;
    } catch (error) {
      console.error(`Errore durante l'invalidazione degli elementi con il tag ${tag}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        level: this.name,
        operation: 'invalidateByTag',
        tag,
        error
      });
      
      return 0;
    }
  }
  
  /**
   * Invalida gli elementi con un pattern di chiave
   * @param {string|RegExp} pattern - Pattern
   * @returns {number} - Numero di elementi invalidati
   */
  invalidateByPattern(pattern) {
    try {
      let count = 0;
      const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
      
      // Trova gli elementi con la chiave che corrisponde al pattern
      for (const key of this.items.keys()) {
        if (regex.test(key)) {
          // Rimuovi l'elemento
          this.delete(key);
          count++;
        }
      }
      
      // Emetti evento
      if (count > 0) {
        this.emit('invalidate', {
          level: this.name,
          pattern: pattern.toString(),
          count
        });
      }
      
      return count;
    } catch (error) {
      console.error(`Errore durante l'invalidazione degli elementi con il pattern ${pattern}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        level: this.name,
        operation: 'invalidateByPattern',
        pattern: pattern.toString(),
        error
      });
      
      return 0;
    }
  }
  
  /**
   * Invalida gli elementi dipendenti da una chiave
   * @param {string} key - Chiave
   * @param {boolean} recursive - Invalida ricorsivamente
   * @returns {number} - Numero di elementi invalidati
   */
  invalidateDependents(key, recursive = true) {
    try {
      // Verifica che la chiave sia una stringa
      if (typeof key !== 'string') {
        throw new Error('La chiave deve essere una stringa');
      }
      
      // Verifica se l'elemento esiste
      if (!this.items.has(key)) {
        return 0;
      }
      
      // Ottieni l'elemento
      const item = this.items.get(key);
      
      // Ottieni i dipendenti
      const dependents = [...item.getDependents()];
      let count = 0;
      
      // Invalida i dipendenti
      for (const depKey of dependents) {
        // Rimuovi l'elemento
        this.delete(depKey);
        count++;
        
        // Invalida ricorsivamente
        if (recursive) {
          count += this.invalidateDependents(depKey, true);
        }
      }
      
      // Emetti evento
      if (count > 0) {
        this.emit('invalidate', {
          level: this.name,
          key,
          dependents: count
        });
      }
      
      return count;
    } catch (error) {
      console.error(`Errore durante l'invalidazione dei dipendenti della chiave ${key}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        level: this.name,
        operation: 'invalidateDependents',
        key,
        error
      });
      
      return 0;
    }
  }
  
  /**
   * Esegue la pulizia della cache
   * @returns {Promise<number>} - Numero di elementi rimossi
   */
  async cleanup() {
    try {
      let count = 0;
      
      // Rimuovi gli elementi scaduti
      for (const [key, item] of this.items.entries()) {
        if (item.isExpired()) {
          // Rimuovi l'elemento
          this.delete(key);
          count++;
        }
      }
      
      // Emetti evento
      if (count > 0) {
        this.emit('cleanup', {
          level: this.name,
          count
        });
      }
      
      return count;
    } catch (error) {
      console.error(`Errore durante la pulizia del livello ${this.name}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        level: this.name,
        operation: 'cleanup',
        error
      });
      
      return 0;
    }
  }
  
  /**
   * Fa spazio nella cache
   * @param {number} requiredSpace - Spazio richiesto
   * @returns {Promise<number>} - Spazio liberato
   * @private
   */
  async _makeSpace(requiredSpace) {
    // Verifica se è necessario fare spazio
    if (requiredSpace <= 0 || this.size + requiredSpace <= this.options.capacity) {
      return 0;
    }
    
    try {
      let freedSpace = 0;
      
      // Calcola lo spazio da liberare
      const targetSpace = Math.max(requiredSpace, this.options.capacity * 0.1);
      
      // Ordina gli elementi per punteggio di priorità
      const items = [...this.items.entries()]
        .map(([key, item]) => ({ key, item, score: item.getPriorityScore() }))
        .sort((a, b) => a.score - b.score);
      
      // Rimuovi gli elementi fino a liberare abbastanza spazio
      for (const { key, item } of items) {
        // Verifica se è stato liberato abbastanza spazio
        if (freedSpace >= targetSpace) {
          break;
        }
        
        // Rimuovi l'elemento
        this.delete(key);
        
        // Aggiorna lo spazio liberato
        freedSpace += item.getSize();
        
        // Incrementa il contatore di evizioni
        this.evictions++;
      }
      
      // Emetti evento
      if (freedSpace > 0) {
        this.emit('eviction', {
          level: this.name,
          freedSpace,
          evictions: this.evictions
        });
      }
      
      return freedSpace;
    } catch (error) {
      console.error(`Errore durante la liberazione di spazio nel livello ${this.name}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        level: this.name,
        operation: 'makeSpace',
        error
      });
      
      return 0;
    }
  }
  
  /**
   * Ottiene le statistiche del livello
   * @returns {Object} - Statistiche
   */
  getStats() {
    return {
      name: this.name,
      size: this.size,
      capacity: this.options.capacity,
      usage: this.size / this.options.capacity,
      items: this.items.size,
      hits: this.hits,
      misses: this.misses,
      hitRatio: this.hits / (this.hits + this.misses || 1),
      evictions: this.evictions
    };
  }
  
  /**
   * Chiude il livello
   */
  close() {
    // Ferma il timer di pulizia
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    // Rimuovi tutti gli elementi
    this.clear();
    
    // Rimuovi tutti i listener
    this.removeAllListeners();
  }
}

/**
 * Classe PrefetchManager
 * 
 * Gestisce il prefetching predittivo
 */
class PrefetchManager extends EventEmitter {
  /**
   * Costruttore
   * @param {MultiLevelCache} cache - Cache multi-livello
   * @param {Object} options - Opzioni
   */
  constructor(cache, options = {}) {
    super();
    
    this.cache = cache;
    this.options = {
      enabled: options.enabled !== false,
      maxConcurrent: options.maxConcurrent || 5,
      minConfidence: options.minConfidence || 0.5,
      maxPrefetchSize: options.maxPrefetchSize || 1024 * 1024, // 1 MB
      cooldown: options.cooldown || 1000, // 1 secondo
      enableLearning: options.enableLearning !== false,
      learningRate: options.learningRate || 0.1,
      decayRate: options.decayRate || 0.01,
      maxPatterns: options.maxPatterns || 1000,
      workerCount: options.workerCount || 2,
      ...options
    };
    
    this.patterns = new Map();
    this.accessHistory = [];
    this.maxHistoryLength = options.maxHistoryLength || 100;
    this.prefetchQueue = [];
    this.activePrefetches = 0;
    this.lastPrefetchTime = 0;
    this.workerPool = null;
    this.metrics = {
      prefetchRequests: 0,
      prefetchHits: 0,
      prefetchMisses: 0,
      prefetchBytes: 0,
      patternCount: 0
    };
    
    // Inizializza il worker pool
    if (this.options.enabled) {
      this._initializeWorkerPool();
    }
  }
  
  /**
   * Inizializza il worker pool
   * @private
   */
  _initializeWorkerPool() {
    try {
      // Crea il worker pool
      this.workerPool = new WorkerPool({
        workerCount: this.options.workerCount,
        workerScript: path.join(__dirname, 'prefetch-worker.js')
      });
      
      console.log(`PrefetchManager inizializzato con ${this.options.workerCount} worker`);
    } catch (error) {
      console.error('Errore durante l\'inizializzazione del worker pool:', error);
      this.options.enabled = false;
    }
  }
  
  /**
   * Registra un accesso alla cache
   * @param {string} key - Chiave dell'elemento
   */
  recordAccess(key) {
    if (!this.options.enabled || !this.options.enableLearning) {
      return;
    }
    
    try {
      // Aggiungi la chiave alla cronologia
      this.accessHistory.push({
        key,
        timestamp: Date.now()
      });
      
      // Limita la dimensione della cronologia
      if (this.accessHistory.length > this.maxHistoryLength) {
        this.accessHistory.shift();
      }
      
      // Aggiorna i pattern
      this._updatePatterns();
      
      // Avvia il prefetching
      this._triggerPrefetch(key);
    } catch (error) {
      console.error(`Errore durante la registrazione dell'accesso per la chiave ${key}:`, error);
    }
  }
  
  /**
   * Aggiorna i pattern di accesso
   * @private
   */
  _updatePatterns() {
    if (this.accessHistory.length < 2) {
      return;
    }
    
    try {
      // Ottieni gli ultimi due accessi
      const lastAccess = this.accessHistory[this.accessHistory.length - 1];
      const prevAccess = this.accessHistory[this.accessHistory.length - 2];
      
      // Verifica che gli accessi siano validi
      if (!lastAccess || !prevAccess) {
        return;
      }
      
      // Verifica che gli accessi siano diversi
      if (lastAccess.key === prevAccess.key) {
        return;
      }
      
      // Verifica che gli accessi siano abbastanza vicini
      const timeDiff = lastAccess.timestamp - prevAccess.timestamp;
      if (timeDiff > 5000) { // 5 secondi
        return;
      }
      
      // Aggiorna il pattern
      const pattern = prevAccess.key;
      const target = lastAccess.key;
      
      if (!this.patterns.has(pattern)) {
        this.patterns.set(pattern, new Map());
      }
      
      const targets = this.patterns.get(pattern);
      
      if (!targets.has(target)) {
        targets.set(target, {
          count: 0,
          confidence: 0,
          lastAccess: 0
        });
      }
      
      const targetInfo = targets.get(target);
      
      // Aggiorna le statistiche
      targetInfo.count++;
      targetInfo.lastAccess = Date.now();
      
      // Calcola la confidenza
      let totalCount = 0;
      for (const info of targets.values()) {
        totalCount += info.count;
      }
      
      for (const [t, info] of targets.entries()) {
        info.confidence = info.count / totalCount;
        
        // Applica il decay
        info.confidence *= (1 - this.options.decayRate);
        
        // Rimuovi i target con confidenza troppo bassa
        if (info.confidence < 0.1) {
          targets.delete(t);
        }
      }
      
      // Limita il numero di pattern
      if (this.patterns.size > this.options.maxPatterns) {
        // Rimuovi i pattern meno utilizzati
        const patternEntries = [...this.patterns.entries()]
          .map(([p, t]) => {
            let totalConfidence = 0;
            let lastAccess = 0;
            
            for (const info of t.values()) {
              totalConfidence += info.confidence;
              lastAccess = Math.max(lastAccess, info.lastAccess);
            }
            
            return { pattern: p, confidence: totalConfidence, lastAccess };
          })
          .sort((a, b) => {
            // Ordina per confidenza e ultimo accesso
            if (Math.abs(a.confidence - b.confidence) < 0.1) {
              return a.lastAccess - b.lastAccess;
            }
            
            return a.confidence - b.confidence;
          });
        
        // Rimuovi i pattern meno utilizzati
        const patternsToRemove = patternEntries.slice(0, patternEntries.length - this.options.maxPatterns);
        
        for (const { pattern } of patternsToRemove) {
          this.patterns.delete(pattern);
        }
      }
      
      // Aggiorna le metriche
      this.metrics.patternCount = this.patterns.size;
    } catch (error) {
      console.error('Errore durante l\'aggiornamento dei pattern:', error);
    }
  }
  
  /**
   * Avvia il prefetching
   * @param {string} key - Chiave dell'elemento
   * @private
   */
  _triggerPrefetch(key) {
    if (!this.options.enabled) {
      return;
    }
    
    try {
      // Verifica se è necessario rispettare il cooldown
      const now = Date.now();
      if (now - this.lastPrefetchTime < this.options.cooldown) {
        return;
      }
      
      // Verifica se ci sono pattern per la chiave
      if (!this.patterns.has(key)) {
        return;
      }
      
      // Ottieni i target
      const targets = this.patterns.get(key);
      
      // Filtra i target per confidenza
      const candidateTargets = [...targets.entries()]
        .filter(([_, info]) => info.confidence >= this.options.minConfidence)
        .sort((a, b) => b[1].confidence - a[1].confidence);
      
      // Verifica se ci sono target validi
      if (candidateTargets.length === 0) {
        return;
      }
      
      // Aggiungi i target alla coda di prefetching
      for (const [target, info] of candidateTargets) {
        // Verifica se il target è già in cache
        if (this.cache.has(target)) {
          continue;
        }
        
        // Aggiungi il target alla coda
        this.prefetchQueue.push({
          key: target,
          confidence: info.confidence,
          timestamp: now
        });
      }
      
      // Aggiorna il timestamp dell'ultimo prefetch
      this.lastPrefetchTime = now;
      
      // Avvia il prefetching
      this._processPrefetchQueue();
    } catch (error) {
      console.error(`Errore durante l'avvio del prefetching per la chiave ${key}:`, error);
    }
  }
  
  /**
   * Elabora la coda di prefetching
   * @private
   */
  async _processPrefetchQueue() {
    if (!this.options.enabled || this.prefetchQueue.length === 0 || this.activePrefetches >= this.options.maxConcurrent) {
      return;
    }
    
    try {
      // Ordina la coda per confidenza
      this.prefetchQueue.sort((a, b) => b.confidence - a.confidence);
      
      // Limita il numero di prefetch concorrenti
      const availableSlots = this.options.maxConcurrent - this.activePrefetches;
      const itemsToProcess = Math.min(availableSlots, this.prefetchQueue.length);
      
      // Elabora gli elementi
      for (let i = 0; i < itemsToProcess; i++) {
        const item = this.prefetchQueue.shift();
        
        // Verifica se l'elemento è valido
        if (!item) {
          continue;
        }
        
        // Verifica se l'elemento è già in cache
        if (this.cache.has(item.key)) {
          continue;
        }
        
        // Incrementa il contatore di prefetch attivi
        this.activePrefetches++;
        
        // Esegui il prefetch
        this._prefetchItem(item).finally(() => {
          // Decrementa il contatore di prefetch attivi
          this.activePrefetches--;
          
          // Continua a elaborare la coda
          this._processPrefetchQueue();
        });
      }
    } catch (error) {
      console.error('Errore durante l\'elaborazione della coda di prefetching:', error);
      
      // Decrementa il contatore di prefetch attivi
      this.activePrefetches = Math.max(0, this.activePrefetches - 1);
    }
  }
  
  /**
   * Esegue il prefetch di un elemento
   * @param {Object} item - Elemento da prefetchare
   * @returns {Promise<boolean>} - True se il prefetch è riuscito
   * @private
   */
  async _prefetchItem(item) {
    try {
      // Incrementa il contatore di richieste
      this.metrics.prefetchRequests++;
      
      // Emetti evento
      this.emit('prefetch', {
        key: item.key,
        confidence: item.confidence
      });
      
      // Verifica se l'elemento è già in cache
      if (this.cache.has(item.key)) {
        this.metrics.prefetchHits++;
        return true;
      }
      
      // Esegui il prefetch
      if (this.workerPool) {
        // Usa il worker pool
        const result = await this.workerPool.executeTask({
          type: 'prefetch',
          key: item.key,
          fetcher: this.options.fetcher
        });
        
        // Verifica se il prefetch è riuscito
        if (result && result.success && result.value !== null) {
          // Memorizza l'elemento in cache
          await this.cache.set(item.key, result.value, {
            ttl: this.options.ttl,
            priority: 0.5, // Priorità media
            tags: ['prefetched'],
            metadata: {
              prefetched: true,
              confidence: item.confidence
            }
          });
          
          // Aggiorna le metriche
          this.metrics.prefetchHits++;
          this.metrics.prefetchBytes += result.size || 0;
          
          return true;
        }
      } else if (typeof this.options.fetcher === 'function') {
        // Usa il fetcher direttamente
        const value = await this.options.fetcher(item.key);
        
        // Verifica se il prefetch è riuscito
        if (value !== null && value !== undefined) {
          // Memorizza l'elemento in cache
          await this.cache.set(item.key, value, {
            ttl: this.options.ttl,
            priority: 0.5, // Priorità media
            tags: ['prefetched'],
            metadata: {
              prefetched: true,
              confidence: item.confidence
            }
          });
          
          // Aggiorna le metriche
          this.metrics.prefetchHits++;
          
          // Stima la dimensione
          let size = 0;
          if (Buffer.isBuffer(value)) {
            size = value.length;
          } else if (typeof value === 'string') {
            size = Buffer.byteLength(value, 'utf8');
          } else {
            try {
              size = Buffer.byteLength(JSON.stringify(value), 'utf8');
            } catch (e) {
              size = 1024; // Valore di default
            }
          }
          
          this.metrics.prefetchBytes += size;
          
          return true;
        }
      }
      
      // Prefetch fallito
      this.metrics.prefetchMisses++;
      
      return false;
    } catch (error) {
      console.error(`Errore durante il prefetch dell'elemento ${item.key}:`, error);
      
      // Aggiorna le metriche
      this.metrics.prefetchMisses++;
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'prefetch',
        key: item.key,
        error
      });
      
      return false;
    }
  }
  
  /**
   * Ottiene le statistiche del prefetching
   * @returns {Object} - Statistiche
   */
  getStats() {
    return {
      enabled: this.options.enabled,
      prefetchRequests: this.metrics.prefetchRequests,
      prefetchHits: this.metrics.prefetchHits,
      prefetchMisses: this.metrics.prefetchMisses,
      hitRatio: this.metrics.prefetchHits / (this.metrics.prefetchRequests || 1),
      prefetchBytes: this.metrics.prefetchBytes,
      patternCount: this.metrics.patternCount,
      queueLength: this.prefetchQueue.length,
      activePrefetches: this.activePrefetches
    };
  }
  
  /**
   * Chiude il prefetch manager
   */
  async close() {
    // Disabilita il prefetching
    this.options.enabled = false;
    
    // Svuota la coda
    this.prefetchQueue = [];
    
    // Chiudi il worker pool
    if (this.workerPool) {
      await this.workerPool.close();
      this.workerPool = null;
    }
    
    // Rimuovi tutti i listener
    this.removeAllListeners();
  }
}

/**
 * Classe MultiLevelCache
 * 
 * Implementa una cache multi-livello
 */
class MultiLevelCache extends EventEmitter {
  /**
   * Costruttore
   * @param {Object} options - Opzioni
   */
  constructor(options = {}) {
    super();
    
    this.options = {
      levels: options.levels || [
        {
          name: 'memory',
          capacity: options.memoryCapacity || 1024 * 1024 * 10, // 10 MB
          ttl: options.memoryTTL || 60000 // 1 minuto
        },
        {
          name: 'persistent',
          capacity: options.persistentCapacity || 1024 * 1024 * 100, // 100 MB
          ttl: options.persistentTTL || 3600000 // 1 ora
        }
      ],
      namespacePrefix: options.namespacePrefix || '',
      enableCompression: options.enableCompression !== false,
      compressionThreshold: options.compressionThreshold || 1024, // 1 KB
      compressionAlgorithm: options.compressionAlgorithm || 'gzip',
      enableMetrics: options.enableMetrics !== false,
      metricsInterval: options.metricsInterval || 10000, // 10 secondi
      prefetching: {
        enabled: options.prefetching?.enabled !== false,
        fetcher: options.prefetching?.fetcher || null,
        ...options.prefetching
      },
      ...options
    };
    
    // Livelli della cache
    this.levels = [];
    
    // Prefetch manager
    this.prefetchManager = null;
    
    // Metriche
    this.metrics = new PerformanceMetrics('multi_level_cache', {
      enableMetrics: this.options.enableMetrics,
      metricsInterval: this.options.metricsInterval
    });
    
    // Inizializza la cache
    this._initialize();
  }
  
  /**
   * Inizializza la cache
   * @private
   */
  _initialize() {
    try {
      // Crea i livelli
      for (const levelOptions of this.options.levels) {
        const level = new CacheLevel(levelOptions.name, {
          ...levelOptions,
          enableCompression: this.options.enableCompression,
          compressionThreshold: this.options.compressionThreshold,
          compressionAlgorithm: this.options.compressionAlgorithm
        });
        
        // Gestisci gli eventi del livello
        level.on('hit', (data) => {
          this.metrics.incrementCounter(`${data.level}_hits`);
          this.emit('hit', data);
        });
        
        level.on('miss', (data) => {
          this.metrics.incrementCounter(`${data.level}_misses`);
          this.emit('miss', data);
        });
        
        level.on('set', (data) => {
          this.metrics.incrementCounter(`${data.level}_sets`);
          this.emit('set', data);
        });
        
        level.on('delete', (data) => {
          this.metrics.incrementCounter(`${data.level}_deletes`);
          this.emit('delete', data);
        });
        
        level.on('eviction', (data) => {
          this.metrics.incrementCounter(`${data.level}_evictions`);
          this.emit('eviction', data);
        });
        
        level.on('error', (data) => {
          this.metrics.incrementCounter(`${data.level}_errors`);
          this.emit('error', data);
        });
        
        // Aggiungi il livello
        this.levels.push(level);
      }
      
      // Inizializza il prefetch manager
      if (this.options.prefetching.enabled) {
        this.prefetchManager = new PrefetchManager(this, this.options.prefetching);
        
        // Gestisci gli eventi del prefetch manager
        this.prefetchManager.on('prefetch', (data) => {
          this.metrics.incrementCounter('prefetch_requests');
          this.emit('prefetch', data);
        });
        
        this.prefetchManager.on('error', (data) => {
          this.metrics.incrementCounter('prefetch_errors');
          this.emit('error', data);
        });
      }
      
      console.log(`MultiLevelCache inizializzata con ${this.levels.length} livelli`);
    } catch (error) {
      console.error('Errore durante l\'inizializzazione della cache multi-livello:', error);
      throw error;
    }
  }
  
  /**
   * Formatta una chiave
   * @param {string} key - Chiave
   * @returns {string} - Chiave formattata
   * @private
   */
  _formatKey(key) {
    // Verifica che la chiave sia una stringa
    if (typeof key !== 'string') {
      throw new Error('La chiave deve essere una stringa');
    }
    
    // Aggiungi il prefisso del namespace
    return this.options.namespacePrefix + key;
  }
  
  /**
   * Imposta un elemento nella cache
   * @param {string} key - Chiave dell'elemento
   * @param {*} value - Valore dell'elemento
   * @param {Object} options - Opzioni
   * @returns {Promise<boolean>} - True se l'operazione è riuscita
   */
  async set(key, value, options = {}) {
    const startTime = performance.now();
    
    try {
      // Formatta la chiave
      const formattedKey = this._formatKey(key);
      
      // Verifica che il valore non sia undefined
      if (value === undefined) {
        throw new Error('Il valore non può essere undefined');
      }
      
      // Opzioni di default
      const itemOptions = {
        ttl: options.ttl || 0,
        priority: options.priority || 1,
        tags: options.tags || [],
        metadata: options.metadata || {},
        dependencies: options.dependencies || [],
        ...options
      };
      
      // Imposta l'elemento in tutti i livelli
      const results = [];
      
      for (const level of this.levels) {
        const result = await level.set(formattedKey, value, itemOptions);
        results.push(result);
      }
      
      // Verifica se l'operazione è riuscita in almeno un livello
      const success = results.some(r => r);
      
      const endTime = performance.now();
      this.metrics.recordLatency('set', endTime - startTime);
      
      if (success) {
        this.metrics.incrementCounter('sets');
      } else {
        this.metrics.incrementCounter('set_failures');
      }
      
      return success;
    } catch (error) {
      console.error(`Errore durante l'impostazione dell'elemento per la chiave ${key}:`, error);
      
      const endTime = performance.now();
      this.metrics.recordLatency('set_failed', endTime - startTime);
      this.metrics.incrementCounter('set_failures');
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'set',
        key,
        error
      });
      
      return false;
    }
  }
  
  /**
   * Ottiene un elemento dalla cache
   * @param {string} key - Chiave dell'elemento
   * @returns {Promise<*>} - Valore dell'elemento o null se non trovato
   */
  async get(key) {
    const startTime = performance.now();
    
    try {
      // Formatta la chiave
      const formattedKey = this._formatKey(key);
      
      // Cerca l'elemento in tutti i livelli
      for (let i = 0; i < this.levels.length; i++) {
        const level = this.levels[i];
        const value = await level.get(formattedKey);
        
        if (value !== null) {
          // Elemento trovato
          
          // Registra l'accesso per il prefetching
          if (this.prefetchManager) {
            this.prefetchManager.recordAccess(formattedKey);
          }
          
          // Propaga l'elemento ai livelli superiori
          this._propagateToHigherLevels(formattedKey, value, i);
          
          const endTime = performance.now();
          this.metrics.recordLatency('get_hit', endTime - startTime);
          this.metrics.incrementCounter('hits');
          
          return value;
        }
      }
      
      // Elemento non trovato
      const endTime = performance.now();
      this.metrics.recordLatency('get_miss', endTime - startTime);
      this.metrics.incrementCounter('misses');
      
      return null;
    } catch (error) {
      console.error(`Errore durante l'ottenimento dell'elemento per la chiave ${key}:`, error);
      
      const endTime = performance.now();
      this.metrics.recordLatency('get_failed', endTime - startTime);
      this.metrics.incrementCounter('get_failures');
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'get',
        key,
        error
      });
      
      return null;
    }
  }
  
  /**
   * Propaga un elemento ai livelli superiori
   * @param {string} key - Chiave dell'elemento
   * @param {*} value - Valore dell'elemento
   * @param {number} foundLevel - Livello in cui è stato trovato l'elemento
   * @private
   */
  async _propagateToHigherLevels(key, value, foundLevel) {
    try {
      // Propaga l'elemento ai livelli superiori
      for (let i = foundLevel - 1; i >= 0; i--) {
        const level = this.levels[i];
        await level.set(key, value);
      }
    } catch (error) {
      console.error(`Errore durante la propagazione dell'elemento per la chiave ${key}:`, error);
    }
  }
  
  /**
   * Verifica se un elemento esiste nella cache
   * @param {string} key - Chiave dell'elemento
   * @returns {boolean} - True se l'elemento esiste
   */
  has(key) {
    try {
      // Formatta la chiave
      const formattedKey = this._formatKey(key);
      
      // Verifica se l'elemento esiste in almeno un livello
      for (const level of this.levels) {
        if (level.has(formattedKey)) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error(`Errore durante la verifica dell'esistenza dell'elemento per la chiave ${key}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'has',
        key,
        error
      });
      
      return false;
    }
  }
  
  /**
   * Elimina un elemento dalla cache
   * @param {string} key - Chiave dell'elemento
   * @returns {Promise<boolean>} - True se l'elemento è stato eliminato
   */
  async delete(key) {
    const startTime = performance.now();
    
    try {
      // Formatta la chiave
      const formattedKey = this._formatKey(key);
      
      // Elimina l'elemento da tutti i livelli
      const results = [];
      
      for (const level of this.levels) {
        const result = await level.delete(formattedKey);
        results.push(result);
      }
      
      // Verifica se l'operazione è riuscita in almeno un livello
      const success = results.some(r => r);
      
      const endTime = performance.now();
      this.metrics.recordLatency('delete', endTime - startTime);
      
      if (success) {
        this.metrics.incrementCounter('deletes');
      }
      
      return success;
    } catch (error) {
      console.error(`Errore durante l'eliminazione dell'elemento per la chiave ${key}:`, error);
      
      const endTime = performance.now();
      this.metrics.recordLatency('delete_failed', endTime - startTime);
      this.metrics.incrementCounter('delete_failures');
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'delete',
        key,
        error
      });
      
      return false;
    }
  }
  
  /**
   * Elimina tutti gli elementi dalla cache
   * @returns {Promise<boolean>} - True se l'operazione è riuscita
   */
  async clear() {
    const startTime = performance.now();
    
    try {
      // Elimina tutti gli elementi da tutti i livelli
      const results = [];
      
      for (const level of this.levels) {
        const result = await level.clear();
        results.push(result);
      }
      
      // Verifica se l'operazione è riuscita in tutti i livelli
      const success = results.every(r => r);
      
      const endTime = performance.now();
      this.metrics.recordLatency('clear', endTime - startTime);
      this.metrics.incrementCounter('clears');
      
      return success;
    } catch (error) {
      console.error('Errore durante la pulizia della cache:', error);
      
      const endTime = performance.now();
      this.metrics.recordLatency('clear_failed', endTime - startTime);
      this.metrics.incrementCounter('clear_failures');
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'clear',
        error
      });
      
      return false;
    }
  }
  
  /**
   * Invalida gli elementi con un tag specifico
   * @param {string} tag - Tag
   * @returns {Promise<number>} - Numero di elementi invalidati
   */
  async invalidateByTag(tag) {
    const startTime = performance.now();
    
    try {
      // Invalida gli elementi in tutti i livelli
      let totalCount = 0;
      
      for (const level of this.levels) {
        const count = await level.invalidateByTag(tag);
        totalCount += count;
      }
      
      const endTime = performance.now();
      this.metrics.recordLatency('invalidate_by_tag', endTime - startTime);
      this.metrics.incrementCounter('invalidations', totalCount);
      
      return totalCount;
    } catch (error) {
      console.error(`Errore durante l'invalidazione degli elementi con il tag ${tag}:`, error);
      
      const endTime = performance.now();
      this.metrics.recordLatency('invalidate_by_tag_failed', endTime - startTime);
      this.metrics.incrementCounter('invalidation_failures');
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'invalidateByTag',
        tag,
        error
      });
      
      return 0;
    }
  }
  
  /**
   * Invalida gli elementi con un pattern di chiave
   * @param {string|RegExp} pattern - Pattern
   * @returns {Promise<number>} - Numero di elementi invalidati
   */
  async invalidateByPattern(pattern) {
    const startTime = performance.now();
    
    try {
      // Invalida gli elementi in tutti i livelli
      let totalCount = 0;
      
      for (const level of this.levels) {
        const count = await level.invalidateByPattern(pattern);
        totalCount += count;
      }
      
      const endTime = performance.now();
      this.metrics.recordLatency('invalidate_by_pattern', endTime - startTime);
      this.metrics.incrementCounter('invalidations', totalCount);
      
      return totalCount;
    } catch (error) {
      console.error(`Errore durante l'invalidazione degli elementi con il pattern ${pattern}:`, error);
      
      const endTime = performance.now();
      this.metrics.recordLatency('invalidate_by_pattern_failed', endTime - startTime);
      this.metrics.incrementCounter('invalidation_failures');
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'invalidateByPattern',
        pattern: pattern.toString(),
        error
      });
      
      return 0;
    }
  }
  
  /**
   * Invalida tutti gli elementi
   * @returns {Promise<boolean>} - True se l'operazione è riuscita
   */
  async invalidateAll() {
    return this.clear();
  }
  
  /**
   * Esegue la pulizia della cache
   * @returns {Promise<number>} - Numero di elementi rimossi
   */
  async cleanup() {
    const startTime = performance.now();
    
    try {
      // Esegui la pulizia in tutti i livelli
      let totalCount = 0;
      
      for (const level of this.levels) {
        const count = await level.cleanup();
        totalCount += count;
      }
      
      const endTime = performance.now();
      this.metrics.recordLatency('cleanup', endTime - startTime);
      this.metrics.incrementCounter('cleanups');
      
      return totalCount;
    } catch (error) {
      console.error('Errore durante la pulizia della cache:', error);
      
      const endTime = performance.now();
      this.metrics.recordLatency('cleanup_failed', endTime - startTime);
      this.metrics.incrementCounter('cleanup_failures');
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'cleanup',
        error
      });
      
      return 0;
    }
  }
  
  /**
   * Ottiene le statistiche della cache
   * @returns {Object} - Statistiche
   */
  getStats() {
    // Statistiche generali
    const stats = {
      levels: this.levels.length,
      levelStats: {},
      hits: 0,
      misses: 0,
      hitRatio: 0,
      size: 0,
      capacity: 0,
      usage: 0,
      items: 0,
      ...this.metrics.getMetrics()
    };
    
    // Statistiche dei livelli
    for (const level of this.levels) {
      const levelStats = level.getStats();
      stats.levelStats[level.name] = levelStats;
      
      // Aggiorna le statistiche generali
      stats.hits += levelStats.hits;
      stats.misses += levelStats.misses;
      stats.size += levelStats.size;
      stats.capacity += levelStats.capacity;
      stats.items += levelStats.items;
    }
    
    // Calcola il rapporto di hit
    stats.hitRatio = stats.hits / (stats.hits + stats.misses || 1);
    
    // Calcola l'utilizzo
    stats.usage = stats.size / (stats.capacity || 1);
    
    // Statistiche del prefetching
    if (this.prefetchManager) {
      stats.prefetching = this.prefetchManager.getStats();
    }
    
    return stats;
  }
  
  /**
   * Chiude la cache
   */
  async close() {
    try {
      // Chiudi il prefetch manager
      if (this.prefetchManager) {
        await this.prefetchManager.close();
        this.prefetchManager = null;
      }
      
      // Chiudi tutti i livelli
      for (const level of this.levels) {
        level.close();
      }
      
      // Svuota l'array dei livelli
      this.levels = [];
      
      // Rimuovi tutti i listener
      this.removeAllListeners();
      
      console.log('MultiLevelCache chiusa');
    } catch (error) {
      console.error('Errore durante la chiusura della cache multi-livello:', error);
      throw error;
    }
  }
}

/**
 * Crea un worker per il prefetching
 */
function createPrefetchWorker() {
  // Verifica che sia un worker thread
  if (isMainThread) {
    throw new Error('Questa funzione deve essere chiamata da un worker thread');
  }
  
  // Gestisci i messaggi
  parentPort.on('message', async (message) => {
    try {
      const { type, ...params } = message;
      
      switch (type) {
        case 'prefetch':
          const { key, fetcher } = params;
          
          // Verifica che il fetcher sia valido
          if (typeof fetcher !== 'function') {
            parentPort.postMessage({ success: false, error: 'Fetcher non valido' });
            return;
          }
          
          // Esegui il prefetch
          const value = await fetcher(key);
          
          // Verifica se il prefetch è riuscito
          if (value !== null && value !== undefined) {
            // Stima la dimensione
            let size = 0;
            if (Buffer.isBuffer(value)) {
              size = value.length;
            } else if (typeof value === 'string') {
              size = Buffer.byteLength(value, 'utf8');
            } else {
              try {
                size = Buffer.byteLength(JSON.stringify(value), 'utf8');
              } catch (e) {
                size = 1024; // Valore di default
              }
            }
            
            parentPort.postMessage({ success: true, value, size });
          } else {
            parentPort.postMessage({ success: false, value: null });
          }
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
  MultiLevelCache,
  CacheLevel,
  CacheItem,
  PrefetchManager,
  createPrefetchWorker
};
