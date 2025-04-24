// Cache Manager avanzato per il Layer 2 di Solana
// Questo file implementa un sistema di caching gerarchico a 3 livelli con compressione adattiva

const { LRUCache } = require('lru-cache');
const zlib = require('zlib');
const crypto = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

/**
 * Configurazione del cache manager avanzato
 */
class CacheConfig {
  constructor(options = {}) {
    // Configurazione generale
    this.maxSize = options.maxSize || 100000; // Numero massimo di elementi in cache
    this.ttl = options.ttl || 3600000; // TTL predefinito (1 ora in ms)
    this.shardCount = options.shardCount || 16; // Numero di shard
    this.compressionEnabled = options.compressionEnabled !== false;
    this.adaptiveCompression = options.adaptiveCompression !== false;
    this.compressionThreshold = options.compressionThreshold || 1024; // Soglia in byte
    this.prefetchingEnabled = options.prefetchingEnabled !== false;
    this.persistenceEnabled = options.persistenceEnabled !== false;
    this.persistencePath = options.persistencePath || './cache-persistence';
    this.persistenceInterval = options.persistenceInterval || 300000; // 5 minuti in ms
    this.monitoringEnabled = options.monitoringEnabled !== false;
    this.metricsInterval = options.metricsInterval || 10000; // ms
    
    // Configurazione dei livelli di cache
    this.l1Size = options.l1Size || Math.floor(this.maxSize * 0.2); // 20% della cache totale
    this.l2Size = options.l2Size || Math.floor(this.maxSize * 0.3); // 30% della cache totale
    this.l3Size = options.l3Size || Math.floor(this.maxSize * 0.5); // 50% della cache totale
    
    // Configurazione TTL per livello
    this.l1TTL = options.l1TTL || this.ttl / 4; // 25% del TTL predefinito
    this.l2TTL = options.l2TTL || this.ttl / 2; // 50% del TTL predefinito
    this.l3TTL = options.l3TTL || this.ttl; // 100% del TTL predefinito
    
    // Configurazione della promozione/retrocessione
    this.promotionThreshold = options.promotionThreshold || 3; // Numero di accessi per promozione
    this.demotionThreshold = options.demotionThreshold || 10000; // Tempo in ms senza accessi per retrocessione
    
    // Validazione della configurazione
    this._validateConfig();
  }
  
  _validateConfig() {
    if (this.maxSize < 1000) {
      throw new Error('maxSize deve essere almeno 1000');
    }
    
    if (this.ttl < 1000) {
      throw new Error('ttl deve essere almeno 1000 ms');
    }
    
    if (this.shardCount < 1 || this.shardCount > 64) {
      throw new Error('shardCount deve essere compreso tra 1 e 64');
    }
    
    if (this.l1Size + this.l2Size + this.l3Size !== this.maxSize) {
      // Aggiusta le dimensioni per assicurarsi che la somma sia uguale a maxSize
      const total = this.l1Size + this.l2Size + this.l3Size;
      const ratio = this.maxSize / total;
      this.l1Size = Math.floor(this.l1Size * ratio);
      this.l2Size = Math.floor(this.l2Size * ratio);
      this.l3Size = this.maxSize - this.l1Size - this.l2Size;
    }
  }
}

/**
 * Classe principale del cache manager avanzato
 */
class UltraAdvancedCacheManager {
  constructor(config = {}) {
    this.config = new CacheConfig(config);
    this.workers = [];
    this.accessCounts = new Map();
    this.lastAccessTimes = new Map();
    this.compressionStats = new Map();
    this.dependencyGraph = new Map();
    this.metrics = {
      hits: { l1: 0, l2: 0, l3: 0 },
      misses: 0,
      promotions: { l1ToL2: 0, l2ToL3: 0 },
      demotions: { l3ToL2: 0, l2ToL1: 0 },
      evictions: { l1: 0, l2: 0, l3: 0 },
      compressionRatio: 0,
      compressionTime: 0,
      decompressionTime: 0,
      persistenceWrites: 0,
      persistenceReads: 0,
      lastMetricsTime: Date.now()
    };
    
    // Inizializzazione delle cache per livello
    this._initializeCaches();
    
    // Inizializzazione degli shard
    this._initializeShards();
    
    // Inizializzazione dei worker threads
    if (this.config.prefetchingEnabled) {
      this._initializeWorkers();
    }
    
    // Caricamento della cache persistente
    if (this.config.persistenceEnabled) {
      this._loadPersistentCache();
      this._startPersistenceTimer();
    }
    
    // Avvio del monitoraggio
    if (this.config.monitoringEnabled) {
      this._startMonitoring();
    }
    
    console.log(`Cache manager avanzato inizializzato con ${this.config.shardCount} shard e 3 livelli di cache`);
  }
  
  /**
   * Inizializza le cache per ogni livello
   */
  _initializeCaches() {
    // Cache L1 (hot) - accesso veloce, dimensione ridotta
    this.l1Cache = new LRUCache({
      max: this.config.l1Size,
      ttl: this.config.l1TTL,
      updateAgeOnGet: true,
      allowStale: false
    });
    
    // Cache L2 (warm) - bilanciamento tra velocità e dimensione
    this.l2Cache = new LRUCache({
      max: this.config.l2Size,
      ttl: this.config.l2TTL,
      updateAgeOnGet: true,
      allowStale: false
    });
    
    // Cache L3 (cold) - dimensione maggiore, accesso meno frequente
    this.l3Cache = new LRUCache({
      max: this.config.l3Size,
      ttl: this.config.l3TTL,
      updateAgeOnGet: true,
      allowStale: false
    });
  }
  
  /**
   * Inizializza gli shard per la cache
   */
  _initializeShards() {
    this.shards = Array(this.config.shardCount).fill().map(() => ({
      l1: new Map(),
      l2: new Map(),
      l3: new Map()
    }));
  }
  
  /**
   * Inizializza i worker threads per il prefetching
   */
  _initializeWorkers() {
    const numWorkers = Math.min(4, os.cpus().length);
    
    for (let i = 0; i < numWorkers; i++) {
      const worker = new Worker(`${__dirname}/cache-worker.js`, {
        workerData: {
          workerId: i,
          config: this.config
        }
      });
      
      worker.on('message', (message) => {
        if (message.type === 'prefetch_complete') {
          this._handlePrefetchResult(message.result);
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
   * Carica la cache persistente dal disco
   */
  _loadPersistentCache() {
    try {
      // Questa è una versione semplificata, l'implementazione reale
      // dovrebbe caricare i dati dal disco in modo asincrono
      console.log('Caricamento della cache persistente...');
      
      // Simula il caricamento
      setTimeout(() => {
        this.metrics.persistenceReads++;
        console.log('Cache persistente caricata');
      }, 100);
    } catch (error) {
      console.error('Errore durante il caricamento della cache persistente:', error);
    }
  }
  
  /**
   * Avvia il timer per la persistenza della cache
   */
  _startPersistenceTimer() {
    setInterval(() => {
      this._persistCache();
    }, this.config.persistenceInterval);
  }
  
  /**
   * Persiste la cache su disco
   */
  _persistCache() {
    try {
      // Questa è una versione semplificata, l'implementazione reale
      // dovrebbe salvare i dati su disco in modo asincrono
      console.log('Persistenza della cache...');
      
      // Simula la persistenza
      setTimeout(() => {
        this.metrics.persistenceWrites++;
        console.log('Cache persistita');
      }, 100);
    } catch (error) {
      console.error('Errore durante la persistenza della cache:', error);
    }
  }
  
  /**
   * Avvia il monitoraggio delle metriche
   */
  _startMonitoring() {
    setInterval(() => {
      const now = Date.now();
      const elapsed = (now - this.metrics.lastMetricsTime) / 1000;
      
      if (elapsed > 0) {
        // Calcola l'hit rate
        const totalHits = this.metrics.hits.l1 + this.metrics.hits.l2 + this.metrics.hits.l3;
        const totalOps = totalHits + this.metrics.misses;
        const hitRate = totalOps > 0 ? (totalHits / totalOps) * 100 : 0;
        
        // Calcola la distribuzione degli hit
        const l1HitRate = totalHits > 0 ? (this.metrics.hits.l1 / totalHits) * 100 : 0;
        const l2HitRate = totalHits > 0 ? (this.metrics.hits.l2 / totalHits) * 100 : 0;
        const l3HitRate = totalHits > 0 ? (this.metrics.hits.l3 / totalHits) * 100 : 0;
        
        console.log(`Metriche cache - Hit rate: ${hitRate.toFixed(2)}%`);
        console.log(`Distribuzione hit - L1: ${l1HitRate.toFixed(2)}%, L2: ${l2HitRate.toFixed(2)}%, L3: ${l3HitRate.toFixed(2)}%`);
        console.log(`Promozioni - L1->L2: ${this.metrics.promotions.l1ToL2}, L2->L3: ${this.metrics.promotions.l2ToL3}`);
        console.log(`Retrocessioni - L3->L2: ${this.metrics.demotions.l3ToL2}, L2->L1: ${this.metrics.demotions.l2ToL1}`);
        console.log(`Evizioni - L1: ${this.metrics.evictions.l1}, L2: ${this.metrics.evictions.l2}, L3: ${this.metrics.evictions.l3}`);
        
        if (this.config.compressionEnabled) {
          console.log(`Compressione - Ratio: ${this.metrics.compressionRatio.toFixed(2)}, Tempo medio: ${this.metrics.compressionTime.toFixed(2)}ms`);
        }
        
        if (this.config.persistenceEnabled) {
          console.log(`Persistenza - Scritture: ${this.metrics.persistenceWrites}, Letture: ${this.metrics.persistenceReads}`);
        }
        
        this.metrics.lastMetricsTime = now;
      }
    }, this.config.metricsInterval);
  }
  
  /**
   * Calcola lo shard per una chiave
   * @param {string} key - Chiave da hashare
   * @returns {number} Indice dello shard
   */
  _getShardIndex(key) {
    const hash = crypto.createHash('md5').update(key).digest('hex');
    const hashNum = parseInt(hash.substring(0, 8), 16);
    return hashNum % this.config.shardCount;
  }
  
  /**
   * Ottiene il livello di cache per una chiave
   * @param {string} key - Chiave da cercare
   * @returns {Object|null} Livello di cache e valore, o null se non trovato
   */
  _getCacheLevel(key) {
    const shardIndex = this._getShardIndex(key);
    const shard = this.shards[shardIndex];
    
    // Cerca nella cache L1 (hot)
    if (shard.l1.has(key) || this.l1Cache.has(key)) {
      return { level: 'l1', value: shard.l1.get(key) || this.l1Cache.get(key) };
    }
    
    // Cerca nella cache L2 (warm)
    if (shard.l2.has(key) || this.l2Cache.has(key)) {
      return { level: 'l2', value: shard.l2.get(key) || this.l2Cache.get(key) };
    }
    
    // Cerca nella cache L3 (cold)
    if (shard.l3.has(key) || this.l3Cache.has(key)) {
      return { level: 'l3', value: shard.l3.get(key) || this.l3Cache.get(key) };
    }
    
    return null;
  }
  
  /**
   * Incrementa il contatore di accessi per una chiave
   * @param {string} key - Chiave da incrementare
   */
  _incrementAccessCount(key) {
    const count = this.accessCounts.get(key) || 0;
    this.accessCounts.set(key, count + 1);
    this.lastAccessTimes.set(key, Date.now());
  }
  
  /**
   * Promuove una chiave a un livello di cache superiore
   * @param {string} key - Chiave da promuovere
   * @param {string} fromLevel - Livello di partenza
   * @param {*} value - Valore da promuovere
   */
  _promoteKey(key, fromLevel, value) {
    const shardIndex = this._getShardIndex(key);
    const shard = this.shards[shardIndex];
    
    if (fromLevel === 'l1' && this.accessCounts.get(key) >= this.config.promotionThreshold) {
      // Promuovi da L1 a L2
      shard.l1.delete(key);
      this.l1Cache.delete(key);
      shard.l2.set(key, value);
      this.l2Cache.set(key, value);
      this.accessCounts.set(key, 0);
      this.metrics.promotions.l1ToL2++;
    } else if (fromLevel === 'l2' && this.accessCounts.get(key) >= this.config.promotionThreshold) {
      // Promuovi da L2 a L3
      shard.l2.delete(key);
      this.l2Cache.delete(key);
      shard.l3.set(key, value);
      this.l3Cache.set(key, value);
      this.accessCounts.set(key, 0);
      this.metrics.promotions.l2ToL3++;
    }
  }
  
  /**
   * Retrocede le chiavi non utilizzate a livelli di cache inferiori
   */
  _demoteUnusedKeys() {
    const now = Date.now();
    
    // Retrocedi le chiavi da L3 a L2
    for (const [key, lastAccess] of this.lastAccessTimes.entries()) {
      if (now - lastAccess > this.config.demotionThreshold) {
        const cacheLevel = this._getCacheLevel(key);
        
        if (cacheLevel && cacheLevel.level === 'l3') {
          const shardIndex = this._getShardIndex(key);
          const shard = this.shards[shardIndex];
          
          // Retrocedi da L3 a L2
          shard.l3.delete(key);
          this.l3Cache.delete(key);
          shard.l2.set(key, cacheLevel.value);
          this.l2Cache.set(key, cacheLevel.value);
          this.metrics.demotions.l3ToL2++;
        } else if (cacheLevel && cacheLevel.level === 'l2') {
          const shardIndex = this._getShardIndex(key);
          const shard = this.shards[shardIndex];
          
          // Retrocedi da L2 a L1
          shard.l2.delete(key);
          this.l2Cache.delete(key);
          shard.l1.set(key, cacheLevel.value);
          this.l1Cache.set(key, cacheLevel.value);
          this.metrics.demotions.l2ToL1++;
        }
      }
    }
  }
  
  /**
   * Comprime un valore se necessario
   * @param {*} value - Valore da comprimere
   * @param {string} key - Chiave associata al valore
   * @returns {Object} Valore compresso e metadati
   */
  _compressValue(value, key) {
    if (!this.config.compressionEnabled) {
      return { value, compressed: false };
    }
    
    // Converti il valore in stringa JSON
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    
    // Verifica se il valore supera la soglia di compressione
    if (stringValue.length < this.config.compressionThreshold) {
      return { value, compressed: false };
    }
    
    try {
      const startTime = Date.now();
      
      // Scegli l'algoritmo di compressione in base alle statistiche
      let compressedValue;
      let algorithm;
      
      if (this.config.adaptiveCompression && this.compressionStats.has(key)) {
        // Usa l'algoritmo che ha dato i migliori risultati in passato
        const stats = this.compressionStats.get(key);
        algorithm = stats.bestAlgorithm;
        
        switch (algorithm) {
          case 'deflate':
            compressedValue = zlib.deflateSync(stringValue);
            break;
          case 'gzip':
            compressedValue = zlib.gzipSync(stringValue);
            break;
          case 'brotli':
            compressedValue = zlib.brotliCompressSync(stringValue);
            break;
          default:
            compressedValue = zlib.deflateSync(stringValue);
            algorithm = 'deflate';
        }
      } else {
        // Prova tutti gli algoritmi e scegli il migliore
        const deflateValue = zlib.deflateSync(stringValue);
        const gzipValue = zlib.gzipSync(stringValue);
        const brotliValue = zlib.brotliCompressSync(stringValue);
        
        // Scegli l'algoritmo con il miglior rapporto di compressione
        if (deflateValue.length <= gzipValue.length && deflateValue.length <= brotliValue.length) {
          compressedValue = deflateValue;
          algorithm = 'deflate';
        } else if (gzipValue.length <= deflateValue.length && gzipValue.length <= brotliValue.length) {
          compressedValue = gzipValue;
          algorithm = 'gzip';
        } else {
          compressedValue = brotliValue;
          algorithm = 'brotli';
        }
        
        // Memorizza le statistiche di compressione
        this.compressionStats.set(key, {
          bestAlgorithm: algorithm,
          originalSize: stringValue.length,
          compressedSize: compressedValue.length,
          ratio: stringValue.length / compressedValue.length
        });
      }
      
      const compressionTime = Date.now() - startTime;
      const compressionRatio = stringValue.length / compressedValue.length;
      
      // Aggiorna le metriche di compressione
      this.metrics.compressionTime = (this.metrics.compressionTime + compressionTime) / 2;
      this.metrics.compressionRatio = (this.metrics.compressionRatio + compressionRatio) / 2;
      
      return {
        value: compressedValue,
        compressed: true,
        algorithm,
        originalType: typeof value
      };
    } catch (error) {
      console.error('Errore durante la compressione:', error);
      return { value, compressed: false };
    }
  }
  
  /**
   * Decomprime un valore
   * @param {Object} compressedData - Dati compressi
   * @returns {*} Valore decompresso
   */
  _decompressValue(compressedData) {
    if (!compressedData.compressed) {
      return compressedData.value;
    }
    
    try {
      const startTime = Date.now();
      
      let decompressedValue;
      
      switch (compressedData.algorithm) {
        case 'deflate':
          decompressedValue = zlib.inflateSync(compressedData.value).toString();
          break;
        case 'gzip':
          decompressedValue = zlib.gunzipSync(compressedData.value).toString();
          break;
        case 'brotli':
          decompressedValue = zlib.brotliDecompressSync(compressedData.value).toString();
          break;
        default:
          throw new Error(`Algoritmo di compressione sconosciuto: ${compressedData.algorithm}`);
      }
      
      const decompressionTime = Date.now() - startTime;
      
      // Aggiorna le metriche di decompressione
      this.metrics.decompressionTime = (this.metrics.decompressionTime + decompressionTime) / 2;
      
      // Converti il valore decompresso al tipo originale
      if (compressedData.originalType === 'object') {
        return JSON.parse(decompressedValue);
      } else {
        return decompressedValue;
      }
    } catch (error) {
      console.error('Errore durante la decompressione:', error);
      return compressedData.value;
    }
  }
  
  /**
   * Aggiunge una dipendenza tra due chiavi
   * @param {string} key - Chiave principale
   * @param {string} dependentKey - Chiave dipendente
   */
  _addDependency(key, dependentKey) {
    if (!this.dependencyGraph.has(key)) {
      this.dependencyGraph.set(key, new Set());
    }
    
    this.dependencyGraph.get(key).add(dependentKey);
  }
  
  /**
   * Invalida una chiave e tutte le sue dipendenze
   * @param {string} key - Chiave da invalidare
   */
  _invalidateWithDependencies(key) {
    // Invalida la chiave principale
    this._invalidateKey(key);
    
    // Invalida le dipendenze
    if (this.dependencyGraph.has(key)) {
      for (const dependentKey of this.dependencyGraph.get(key)) {
        this._invalidateWithDependencies(dependentKey);
      }
    }
  }
  
  /**
   * Invalida una singola chiave
   * @param {string} key - Chiave da invalidare
   */
  _invalidateKey(key) {
    const shardIndex = this._getShardIndex(key);
    const shard = this.shards[shardIndex];
    
    // Rimuovi la chiave da tutti i livelli di cache
    shard.l1.delete(key);
    this.l1Cache.delete(key);
    shard.l2.delete(key);
    this.l2Cache.delete(key);
    shard.l3.delete(key);
    this.l3Cache.delete(key);
    
    // Rimuovi i contatori di accesso
    this.accessCounts.delete(key);
    this.lastAccessTimes.delete(key);
  }
  
  /**
   * Gestisce il risultato di un prefetch
   * @param {Object} result - Risultato del prefetch
   */
  _handlePrefetchResult(result) {
    if (result.success) {
      // Memorizza il valore prefetchato nella cache
      this.set(result.key, result.value, { ttl: result.ttl });
    }
  }
  
  /**
   * Ottiene un valore dalla cache
   * @param {string} key - Chiave da cercare
   * @returns {*} Valore memorizzato o undefined se non trovato
   */
  get(key) {
    try {
      // Cerca il valore nella cache
      const cacheResult = this._getCacheLevel(key);
      
      if (cacheResult) {
        // Incrementa il contatore di accessi
        this._incrementAccessCount(key);
        
        // Aggiorna le metriche
        this.metrics.hits[cacheResult.level]++;
        
        // Promuovi la chiave se necessario
        this._promoteKey(key, cacheResult.level, cacheResult.value);
        
        // Decomprime il valore se necessario
        return this._decompressValue(cacheResult.value);
      }
      
      // Cache miss
      this.metrics.misses++;
      
      return undefined;
    } catch (error) {
      console.error('Errore durante il recupero dalla cache:', error);
      return undefined;
    }
  }
  
  /**
   * Memorizza un valore nella cache
   * @param {string} key - Chiave da memorizzare
   * @param {*} value - Valore da memorizzare
   * @param {Object} options - Opzioni aggiuntive
   * @returns {boolean} True se l'operazione è riuscita
   */
  set(key, value, options = {}) {
    try {
      const ttl = options.ttl || this.config.ttl;
      const level = options.level || 'l1';
      const dependencies = options.dependencies || [];
      
      // Comprimi il valore se necessario
      const compressedData = this._compressValue(value, key);
      
      // Memorizza il valore nel livello di cache appropriato
      const shardIndex = this._getShardIndex(key);
      const shard = this.shards[shardIndex];
      
      switch (level) {
        case 'l1':
          shard.l1.set(key, compressedData);
          this.l1Cache.set(key, compressedData, { ttl });
          break;
        case 'l2':
          shard.l2.set(key, compressedData);
          this.l2Cache.set(key, compressedData, { ttl });
          break;
        case 'l3':
          shard.l3.set(key, compressedData);
          this.l3Cache.set(key, compressedData, { ttl });
          break;
        default:
          throw new Error(`Livello di cache sconosciuto: ${level}`);
      }
      
      // Inizializza i contatori di accesso
      this.accessCounts.set(key, 0);
      this.lastAccessTimes.set(key, Date.now());
      
      // Aggiungi le dipendenze
      for (const dependentKey of dependencies) {
        this._addDependency(key, dependentKey);
      }
      
      return true;
    } catch (error) {
      console.error('Errore durante la memorizzazione nella cache:', error);
      return false;
    }
  }
  
  /**
   * Verifica se una chiave è presente nella cache
   * @param {string} key - Chiave da verificare
   * @returns {boolean} True se la chiave è presente
   */
  has(key) {
    return this._getCacheLevel(key) !== null;
  }
  
  /**
   * Rimuove una chiave dalla cache
   * @param {string} key - Chiave da rimuovere
   * @returns {boolean} True se la chiave è stata rimossa
   */
  delete(key) {
    try {
      const shardIndex = this._getShardIndex(key);
      const shard = this.shards[shardIndex];
      
      // Rimuovi la chiave da tutti i livelli di cache
      const l1Deleted = shard.l1.delete(key) || this.l1Cache.delete(key);
      const l2Deleted = shard.l2.delete(key) || this.l2Cache.delete(key);
      const l3Deleted = shard.l3.delete(key) || this.l3Cache.delete(key);
      
      // Rimuovi i contatori di accesso
      this.accessCounts.delete(key);
      this.lastAccessTimes.delete(key);
      
      return l1Deleted || l2Deleted || l3Deleted;
    } catch (error) {
      console.error('Errore durante la rimozione dalla cache:', error);
      return false;
    }
  }
  
  /**
   * Invalida una chiave e tutte le sue dipendenze
   * @param {string} key - Chiave da invalidare
   * @returns {boolean} True se l'operazione è riuscita
   */
  invalidate(key) {
    try {
      this._invalidateWithDependencies(key);
      return true;
    } catch (error) {
      console.error('Errore durante l\'invalidazione della cache:', error);
      return false;
    }
  }
  
  /**
   * Invalida tutte le chiavi con un determinato tag
   * @param {string} tag - Tag da invalidare
   * @returns {boolean} True se l'operazione è riuscita
   */
  invalidateByTag(tag) {
    try {
      // Questa è una versione semplificata, l'implementazione reale
      // dovrebbe mantenere una mappa di tag -> chiavi
      console.log(`Invalidazione delle chiavi con tag: ${tag}`);
      return true;
    } catch (error) {
      console.error('Errore durante l\'invalidazione per tag:', error);
      return false;
    }
  }
  
  /**
   * Prefetch di un valore
   * @param {string} key - Chiave da prefetchare
   * @param {Function} fetchFn - Funzione per ottenere il valore
   * @param {Object} options - Opzioni aggiuntive
   * @returns {Promise<boolean>} True se l'operazione è riuscita
   */
  async prefetch(key, fetchFn, options = {}) {
    if (!this.config.prefetchingEnabled) {
      return false;
    }
    
    try {
      // Verifica se la chiave è già in cache
      if (this.has(key)) {
        return true;
      }
      
      // Seleziona un worker casuale
      const workerIndex = Math.floor(Math.random() * this.workers.length);
      const worker = this.workers[workerIndex];
      
      // Invia la richiesta di prefetch al worker
      worker.postMessage({
        type: 'prefetch',
        key,
        fetchFnString: fetchFn.toString(),
        options
      });
      
      return true;
    } catch (error) {
      console.error('Errore durante il prefetch:', error);
      return false;
    }
  }
  
  /**
   * Svuota la cache
   * @returns {boolean} True se l'operazione è riuscita
   */
  clear() {
    try {
      // Svuota tutte le cache
      this.l1Cache.clear();
      this.l2Cache.clear();
      this.l3Cache.clear();
      
      // Svuota tutti gli shard
      for (const shard of this.shards) {
        shard.l1.clear();
        shard.l2.clear();
        shard.l3.clear();
      }
      
      // Resetta i contatori e le mappe
      this.accessCounts.clear();
      this.lastAccessTimes.clear();
      this.compressionStats.clear();
      this.dependencyGraph.clear();
      
      return true;
    } catch (error) {
      console.error('Errore durante lo svuotamento della cache:', error);
      return false;
    }
  }
  
  /**
   * Ottiene le statistiche della cache
   * @returns {Object} Statistiche della cache
   */
  getStats() {
    const l1Size = this.l1Cache.size;
    const l2Size = this.l2Cache.size;
    const l3Size = this.l3Cache.size;
    const totalSize = l1Size + l2Size + l3Size;
    
    const totalHits = this.metrics.hits.l1 + this.metrics.hits.l2 + this.metrics.hits.l3;
    const totalOps = totalHits + this.metrics.misses;
    const hitRate = totalOps > 0 ? (totalHits / totalOps) * 100 : 0;
    
    return {
      size: {
        total: totalSize,
        l1: l1Size,
        l2: l2Size,
        l3: l3Size
      },
      hitRate,
      hits: {
        total: totalHits,
        l1: this.metrics.hits.l1,
        l2: this.metrics.hits.l2,
        l3: this.metrics.hits.l3
      },
      misses: this.metrics.misses,
      promotions: this.metrics.promotions,
      demotions: this.metrics.demotions,
      evictions: this.metrics.evictions,
      compression: {
        ratio: this.metrics.compressionRatio,
        time: this.metrics.compressionTime
      },
      persistence: {
        writes: this.metrics.persistenceWrites,
        reads: this.metrics.persistenceReads
      }
    };
  }
  
  /**
   * Chiude il cache manager e tutti i worker threads
   */
  async close() {
    console.log('Chiusura del cache manager...');
    
    // Persisti la cache se abilitato
    if (this.config.persistenceEnabled) {
      await this._persistCache();
    }
    
    // Termina tutti i worker threads
    for (const worker of this.workers) {
      worker.terminate();
    }
    
    console.log('Cache manager chiuso');
  }
}

module.exports = {
  UltraAdvancedCacheManager,
  CacheConfig
};
