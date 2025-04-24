/**
 * Implementazione della cache in memoria per il Layer-2 su Solana
 * 
 * Questo modulo implementa una cache in memoria efficiente con supporto per
 * TTL, LRU, e altre strategie di gestione della memoria.
 */

const { EventEmitter } = require('events');

/**
 * Classe MemoryCache
 * 
 * Implementa una cache in memoria efficiente con supporto per:
 * - TTL (Time-To-Live)
 * - LRU (Least Recently Used)
 * - LFU (Least Frequently Used)
 * - Gestione efficiente della memoria
 * - Monitoraggio delle prestazioni
 */
class MemoryCache extends EventEmitter {
  /**
   * Costruttore
   * @param {Object} options - Opzioni di configurazione
   */
  constructor(options = {}) {
    super();
    
    // Configurazione
    this.maxSize = options.maxSize || 10000;
    this.ttl = options.ttl || 300; // 5 minuti in secondi
    this.checkInterval = options.checkInterval || 60; // 1 minuto in secondi
    this.evictionPolicy = options.evictionPolicy || 'lru'; // 'lru', 'lfu', 'fifo', 'random'
    this.updateAgeOnGet = options.updateAgeOnGet !== false;
    this.updateFrequencyOnGet = options.updateFrequencyOnGet !== false;
    this.namespace = options.namespace || '';
    this.enableMetrics = options.enableMetrics !== false;
    this.metricsInterval = options.metricsInterval || 60; // 1 minuto in secondi
    this.highWaterMark = options.highWaterMark || 0.9; // 90% di riempimento
    this.lowWaterMark = options.lowWaterMark || 0.7; // 70% di riempimento
    this.autoCleanup = options.autoCleanup !== false;
    this.cleanupRatio = options.cleanupRatio || 0.25; // Rimuovi il 25% degli elementi quando si supera highWaterMark
    
    // Stato interno
    this.cache = new Map();
    this.metadata = new Map();
    this.size = 0;
    this.cleanupTimer = null;
    this.metricsTimer = null;
    this.isInitialized = false;
    
    // Metriche
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      evictions: 0,
      expirations: 0,
      lastReportTime: Date.now()
    };
    
    // Inizializzazione
    this._initialize();
  }
  
  /**
   * Inizializza la cache
   * @private
   */
  async _initialize() {
    try {
      console.log(`Inizializzazione MemoryCache con capacità di ${this.maxSize} elementi e policy ${this.evictionPolicy}`);
      
      // Avvia il timer di pulizia se abilitato
      if (this.autoCleanup) {
        this._startCleanupTimer();
      }
      
      // Avvia il timer delle metriche se abilitato
      if (this.enableMetrics) {
        this._startMetricsTimer();
      }
      
      this.isInitialized = true;
      
      // Emetti evento di inizializzazione completata
      this.emit('initialized');
      
      return true;
    } catch (error) {
      console.error('Errore durante l\'inizializzazione della MemoryCache:', error);
      throw error;
    }
  }
  
  /**
   * Avvia il timer di pulizia
   * @private
   */
  _startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this._cleanup();
    }, this.checkInterval * 1000);
    
    // Assicurati che il timer non impedisca al processo di terminare
    this.cleanupTimer.unref();
  }
  
  /**
   * Avvia il timer delle metriche
   * @private
   */
  _startMetricsTimer() {
    this.metricsTimer = setInterval(() => {
      this._reportMetrics();
    }, this.metricsInterval * 1000);
    
    // Assicurati che il timer non impedisca al processo di terminare
    this.metricsTimer.unref();
  }
  
  /**
   * Pulisce la cache rimuovendo gli elementi scaduti
   * @private
   */
  _cleanup() {
    const now = Date.now();
    let expiredCount = 0;
    
    // Rimuovi gli elementi scaduti
    for (const [key, meta] of this.metadata.entries()) {
      if (meta.expiry && meta.expiry <= now) {
        this.cache.delete(key);
        this.metadata.delete(key);
        this.size--;
        expiredCount++;
      }
    }
    
    // Aggiorna le metriche
    this.metrics.expirations += expiredCount;
    
    // Verifica se è necessario eseguire l'evizione
    if (this.size > this.maxSize * this.highWaterMark) {
      this._evictItems();
    }
    
    // Emetti evento di pulizia completata
    if (expiredCount > 0) {
      this.emit('cleanup', {
        expired: expiredCount,
        remaining: this.size
      });
    }
  }
  
  /**
   * Esegue l'evizione degli elementi in base alla policy configurata
   * @private
   */
  _evictItems() {
    // Calcola quanti elementi rimuovere
    const targetSize = Math.floor(this.maxSize * this.lowWaterMark);
    const itemsToRemove = Math.max(1, Math.ceil((this.size - targetSize) * this.cleanupRatio));
    
    if (itemsToRemove <= 0) {
      return;
    }
    
    let evictedCount = 0;
    
    switch (this.evictionPolicy) {
      case 'lru':
        evictedCount = this._evictLRU(itemsToRemove);
        break;
      case 'lfu':
        evictedCount = this._evictLFU(itemsToRemove);
        break;
      case 'fifo':
        evictedCount = this._evictFIFO(itemsToRemove);
        break;
      case 'random':
        evictedCount = this._evictRandom(itemsToRemove);
        break;
      default:
        evictedCount = this._evictLRU(itemsToRemove); // Default a LRU
    }
    
    // Aggiorna le metriche
    this.metrics.evictions += evictedCount;
    
    // Emetti evento di evizione completata
    if (evictedCount > 0) {
      this.emit('eviction', {
        count: evictedCount,
        remaining: this.size,
        policy: this.evictionPolicy
      });
    }
  }
  
  /**
   * Esegue l'evizione LRU (Least Recently Used)
   * @param {number} count - Numero di elementi da rimuovere
   * @returns {number} Numero di elementi rimossi
   * @private
   */
  _evictLRU(count) {
    // Ordina gli elementi per lastAccessed (dal più vecchio al più recente)
    const sortedItems = Array.from(this.metadata.entries())
      .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
    
    return this._evictSortedItems(sortedItems, count);
  }
  
  /**
   * Esegue l'evizione LFU (Least Frequently Used)
   * @param {number} count - Numero di elementi da rimuovere
   * @returns {number} Numero di elementi rimossi
   * @private
   */
  _evictLFU(count) {
    // Ordina gli elementi per accessCount (dal meno frequente al più frequente)
    const sortedItems = Array.from(this.metadata.entries())
      .sort((a, b) => a[1].accessCount - b[1].accessCount);
    
    return this._evictSortedItems(sortedItems, count);
  }
  
  /**
   * Esegue l'evizione FIFO (First In First Out)
   * @param {number} count - Numero di elementi da rimuovere
   * @returns {number} Numero di elementi rimossi
   * @private
   */
  _evictFIFO(count) {
    // Ordina gli elementi per createdAt (dal più vecchio al più recente)
    const sortedItems = Array.from(this.metadata.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt);
    
    return this._evictSortedItems(sortedItems, count);
  }
  
  /**
   * Esegue l'evizione casuale
   * @param {number} count - Numero di elementi da rimuovere
   * @returns {number} Numero di elementi rimossi
   * @private
   */
  _evictRandom(count) {
    const keys = Array.from(this.cache.keys());
    let evictedCount = 0;
    
    // Rimuovi elementi casuali
    for (let i = 0; i < count && keys.length > 0; i++) {
      const randomIndex = Math.floor(Math.random() * keys.length);
      const key = keys[randomIndex];
      
      this.cache.delete(key);
      this.metadata.delete(key);
      this.size--;
      evictedCount++;
      
      // Rimuovi la chiave dall'array
      keys.splice(randomIndex, 1);
    }
    
    return evictedCount;
  }
  
  /**
   * Esegue l'evizione di elementi ordinati
   * @param {Array} sortedItems - Array di elementi ordinati
   * @param {number} count - Numero di elementi da rimuovere
   * @returns {number} Numero di elementi rimossi
   * @private
   */
  _evictSortedItems(sortedItems, count) {
    let evictedCount = 0;
    
    // Rimuovi gli elementi in base all'ordinamento
    for (let i = 0; i < count && i < sortedItems.length; i++) {
      const [key] = sortedItems[i];
      
      this.cache.delete(key);
      this.metadata.delete(key);
      this.size--;
      evictedCount++;
    }
    
    return evictedCount;
  }
  
  /**
   * Genera una chiave di cache normalizzata
   * @param {string} key - Chiave originale
   * @returns {string} Chiave normalizzata
   * @private
   */
  _normalizeKey(key) {
    // Verifica se la chiave è già normalizzata
    if (key.startsWith(this.namespace)) {
      return key;
    }
    
    // Normalizza la chiave
    return `${this.namespace}${key}`;
  }
  
  /**
   * Riporta le metriche
   * @private
   */
  _reportMetrics() {
    const now = Date.now();
    const elapsedSeconds = (now - this.metrics.lastReportTime) / 1000;
    
    if (elapsedSeconds > 0) {
      // Calcola le operazioni al secondo
      const hitsPerSecond = this.metrics.hits / elapsedSeconds;
      const missesPerSecond = this.metrics.misses / elapsedSeconds;
      const setsPerSecond = this.metrics.sets / elapsedSeconds;
      
      // Calcola l'hit rate
      const totalOps = this.metrics.hits + this.metrics.misses;
      const hitRate = totalOps > 0 ? (this.metrics.hits / totalOps) * 100 : 0;
      
      // Log delle metriche
      console.log(`MemoryCache metrics - Size: ${this.size}/${this.maxSize}, Hit rate: ${hitRate.toFixed(2)}%`);
      console.log(`Ops/sec - Hits: ${hitsPerSecond.toFixed(2)}, Misses: ${missesPerSecond.toFixed(2)}, Sets: ${setsPerSecond.toFixed(2)}`);
      console.log(`Evictions: ${this.metrics.evictions}, Expirations: ${this.metrics.expirations}`);
      
      // Emetti evento con le metriche
      this.emit('metrics', {
        timestamp: now,
        size: this.size,
        maxSize: this.maxSize,
        utilization: this.size / this.maxSize,
        hits: this.metrics.hits,
        misses: this.metrics.misses,
        sets: this.metrics.sets,
        evictions: this.metrics.evictions,
        expirations: this.metrics.expirations,
        hitRate,
        opsPerSecond: {
          hits: hitsPerSecond,
          misses: missesPerSecond,
          sets: setsPerSecond
        }
      });
      
      // Resetta i contatori
      this.metrics.hits = 0;
      this.metrics.misses = 0;
      this.metrics.sets = 0;
      this.metrics.evictions = 0;
      this.metrics.expirations = 0;
      this.metrics.lastReportTime = now;
    }
  }
  
  /**
   * Ottiene un valore dalla cache
   * @param {string} key - Chiave da cercare
   * @returns {Promise<*>} Valore trovato o null se non trovato
   */
  async get(key) {
    // Normalizza la chiave
    const normalizedKey = this._normalizeKey(key);
    
    // Verifica se la chiave esiste
    if (!this.cache.has(normalizedKey)) {
      // Aggiorna le metriche
      this.metrics.misses++;
      
      return null;
    }
    
    // Ottieni i metadati
    const meta = this.metadata.get(normalizedKey);
    
    // Verifica se l'elemento è scaduto
    if (meta.expiry && meta.expiry <= Date.now()) {
      // Rimuovi l'elemento scaduto
      this.cache.delete(normalizedKey);
      this.metadata.delete(normalizedKey);
      this.size--;
      
      // Aggiorna le metriche
      this.metrics.misses++;
      this.metrics.expirations++;
      
      return null;
    }
    
    // Aggiorna i metadati di accesso
    if (this.updateAgeOnGet) {
      meta.lastAccessed = Date.now();
    }
    
    if (this.updateFrequencyOnGet) {
      meta.accessCount++;
    }
    
    // Aggiorna le metriche
    this.metrics.hits++;
    
    // Restituisci il valore
    return this.cache.get(normalizedKey);
  }
  
  /**
   * Imposta un valore nella cache
   * @param {string} key - Chiave
   * @param {*} value - Valore da memorizzare
   * @param {Object} options - Opzioni
   * @param {number} options.ttl - TTL in secondi (sovrascrive il valore predefinito)
   * @returns {Promise<boolean>} True se l'operazione ha avuto successo
   */
  async set(key, value, options = {}) {
    // Normalizza la chiave
    const normalizedKey = this._normalizeKey(key);
    
    // Calcola il TTL
    const ttl = options.ttl !== undefined ? options.ttl : this.ttl;
    
    // Calcola la scadenza
    const expiry = ttl > 0 ? Date.now() + (ttl * 1000) : null;
    
    // Crea i metadati
    const now = Date.now();
    const meta = {
      createdAt: now,
      lastAccessed: now,
      accessCount: 0,
      expiry
    };
    
    // Verifica se la chiave esiste già
    const isUpdate = this.cache.has(normalizedKey);
    
    // Aggiorna la cache
    this.cache.set(normalizedKey, value);
    this.metadata.set(normalizedKey, meta);
    
    // Aggiorna la dimensione se è un nuovo elemento
    if (!isUpdate) {
      this.size++;
    }
    
    // Aggiorna le metriche
    this.metrics.sets++;
    
    // Verifica se è necessario eseguire l'evizione
    if (this.size > this.maxSize) {
      this._evictItems();
    }
    
    return true;
  }
  
  /**
   * Invalida una chiave dalla cache
   * @param {string} key - Chiave da invalidare
   * @returns {Promise<boolean>} True se l'operazione ha avuto successo
   */
  async invalidate(key) {
    // Normalizza la chiave
    const normalizedKey = this._normalizeKey(key);
    
    // Verifica se la chiave esiste
    if (!this.cache.has(normalizedKey)) {
      return false;
    }
    
    // Rimuovi l'elemento
    this.cache.delete(normalizedKey);
    this.metadata.delete(normalizedKey);
    this.size--;
    
    return true;
  }
  
  /**
   * Invalida tutte le chiavi con un prefisso specifico
   * @param {string} prefix - Prefisso delle chiavi da invalidare
   * @returns {Promise<boolean>} True se l'operazione ha avuto successo
   */
  async invalidateByPrefix(prefix) {
    // Normalizza il prefisso
    const normalizedPrefix = this._normalizeKey(prefix);
    
    let count = 0;
    
    // Trova tutte le chiavi che iniziano con il prefisso
    for (const key of this.cache.keys()) {
      if (key.startsWith(normalizedPrefix)) {
        this.cache.delete(key);
        this.metadata.delete(key);
        this.size--;
        count++;
      }
    }
    
    return count > 0;
  }
  
  /**
   * Ottiene le statistiche della cache
   * @returns {Promise<Object>} Statistiche della cache
   */
  async getStats() {
    // Calcola le statistiche
    const now = Date.now();
    let expiredCount = 0;
    let ttlStats = { min: Infinity, max: 0, avg: 0, total: 0 };
    let ageStats = { min: Infinity, max: 0, avg: 0, total: 0 };
    let accessStats = { min: Infinity, max: 0, avg: 0, total: 0 };
    
    for (const meta of this.metadata.values()) {
      // Conta gli elementi scaduti
      if (meta.expiry && meta.expiry <= now) {
        expiredCount++;
      }
      
      // Calcola le statistiche TTL
      if (meta.expiry) {
        const remainingTtl = Math.max(0, (meta.expiry - now) / 1000);
        ttlStats.min = Math.min(ttlStats.min, remainingTtl);
        ttlStats.max = Math.max(ttlStats.max, remainingTtl);
        ttlStats.total += remainingTtl;
      }
      
      // Calcola le statistiche di età
      const age = (now - meta.createdAt) / 1000;
      ageStats.min = Math.min(ageStats.min, age);
      ageStats.max = Math.max(ageStats.max, age);
      ageStats.total += age;
      
      // Calcola le statistiche di accesso
      accessStats.min = Math.min(accessStats.min, meta.accessCount);
      accessStats.max = Math.max(accessStats.max, meta.accessCount);
      accessStats.total += meta.accessCount;
    }
    
    // Calcola le medie
    if (this.size > 0) {
      ttlStats.avg = ttlStats.total / this.size;
      ageStats.avg = ageStats.total / this.size;
      accessStats.avg = accessStats.total / this.size;
    }
    
    // Correggi i valori min se non ci sono elementi
    if (this.size === 0) {
      ttlStats.min = 0;
      ageStats.min = 0;
      accessStats.min = 0;
    }
    
    return {
      size: this.size,
      maxSize: this.maxSize,
      utilization: this.size / this.maxSize,
      expired: expiredCount,
      ttl: ttlStats,
      age: ageStats,
      access: accessStats,
      policy: this.evictionPolicy
    };
  }
  
  /**
   * Pulisce la cache
   * @returns {Promise<boolean>} True se l'operazione ha avuto successo
   */
  async clear() {
    // Pulisci la cache
    this.cache.clear();
    this.metadata.clear();
    this.size = 0;
    
    return true;
  }
  
  /**
   * Chiude la cache
   * @returns {Promise<boolean>} True se l'operazione ha avuto successo
   */
  async close() {
    // Ferma i timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    
    // Pulisci la cache
    await this.clear();
    
    this.isInitialized = false;
    
    return true;
  }
}

module.exports = { MemoryCache };
