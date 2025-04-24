/**
 * Implementazione ottimizzata del sistema di cache multi-livello per il Layer-2 su Solana
 * 
 * Questo modulo implementa un sistema di cache multi-livello avanzato con:
 * - Struttura a tre livelli (L1: memoria, L2: Redis, L3: distribuito)
 * - Prefetching predittivo basato su pattern di accesso
 * - Invalidazione selettiva basata su grafo di dipendenze
 * - Compressione adattiva dei dati
 * - Monitoraggio avanzato delle prestazioni
 */

const { EventEmitter } = require('events');
const crypto = require('crypto');
const { promisify } = require('util');
const zlib = require('zlib');
const { LRUCache } = require('lru-cache');
const { WorkerPool } = require('./worker-pool');
const path = require('path');
const fs = require('fs').promises;

// Promisify delle funzioni di compressione
const compressAsync = promisify(zlib.deflate);
const decompressAsync = promisify(zlib.inflate);
const brotliCompressAsync = promisify(zlib.brotliCompress);
const brotliDecompressAsync = promisify(zlib.brotliDecompress);

/**
 * Classe MultiLevelCache
 * 
 * Implementa un sistema di cache multi-livello avanzato con prefetching predittivo
 * e invalidazione selettiva basata su grafo di dipendenze.
 */
class MultiLevelCache extends EventEmitter {
  /**
   * Costruttore
   * @param {Object} config - Configurazione della cache
   */
  constructor(config = {}) {
    super();
    
    // Configurazione generale
    this.config = {
      // Configurazione generale
      enableCompression: config.enableCompression !== false,
      compressionThreshold: config.compressionThreshold || 1024, // Soglia in byte
      compressionLevel: config.compressionLevel || 6, // 0-9 per zlib, 0-11 per brotli
      compressionAlgorithm: config.compressionAlgorithm || 'zlib', // 'zlib' o 'brotli'
      defaultTTL: config.defaultTTL || 3600, // 1 ora in secondi
      namespacePrefix: config.namespacePrefix || 'l2cache:',
      enableMetrics: config.enableMetrics !== false,
      metricsInterval: config.metricsInterval || 60000, // 1 minuto
      
      // Configurazione L1 (memoria locale)
      l1: {
        enabled: config.l1?.enabled !== false,
        maxSize: config.l1?.maxSize || 10000, // Numero di elementi
        ttl: config.l1?.ttl || 300, // 5 minuti in secondi
        updateAgeOnGet: config.l1?.updateAgeOnGet !== false
      },
      
      // Configurazione L2 (Redis)
      l2: {
        enabled: config.l2?.enabled !== false,
        host: config.l2?.host || 'localhost',
        port: config.l2?.port || 6379,
        password: config.l2?.password || '',
        db: config.l2?.db || 0,
        ttl: config.l2?.ttl || 1800, // 30 minuti in secondi
        maxConnections: config.l2?.maxConnections || 50,
        connectTimeout: config.l2?.connectTimeout || 10000,
        enableCluster: config.l2?.enableCluster || false,
        clusterNodes: config.l2?.clusterNodes || [],
        enableTLS: config.l2?.enableTLS || false
      },
      
      // Configurazione L3 (cache distribuita)
      l3: {
        enabled: config.l3?.enabled !== false,
        type: config.l3?.type || 'redis-cluster', // 'redis-cluster', 'memcached', 'custom'
        ttl: config.l3?.ttl || 86400, // 24 ore in secondi
        nodes: config.l3?.nodes || [],
        customImplementation: config.l3?.customImplementation || null,
        consistencyLevel: config.l3?.consistencyLevel || 'eventual', // 'eventual', 'strong'
        replicationFactor: config.l3?.replicationFactor || 2
      },
      
      // Configurazione del prefetching predittivo
      prefetching: {
        enabled: config.prefetching?.enabled !== false,
        strategy: config.prefetching?.strategy || 'pattern', // 'pattern', 'frequency', 'temporal', 'hybrid'
        threshold: config.prefetching?.threshold || 0.7, // Soglia di confidenza (0-1)
        maxPrefetchItems: config.prefetching?.maxPrefetchItems || 10,
        patternLength: config.prefetching?.patternLength || 5,
        workerCount: config.prefetching?.workerCount || 2,
        enableAdaptivePrefetching: config.prefetching?.enableAdaptivePrefetching !== false,
        adaptiveInterval: config.prefetching?.adaptiveInterval || 300000, // 5 minuti
        minPrefetchConfidence: config.prefetching?.minPrefetchConfidence || 0.5
      },
      
      // Configurazione del grafo di dipendenze
      dependencies: {
        enabled: config.dependencies?.enabled !== false,
        maxDependencies: config.dependencies?.maxDependencies || 1000,
        maxDependenciesPerKey: config.dependencies?.maxDependenciesPerKey || 50,
        enableTransitiveDependencies: config.dependencies?.enableTransitiveDependencies !== false,
        maxTransitiveDepth: config.dependencies?.maxTransitiveDepth || 3
      },
      
      // Configurazione della persistenza
      persistence: {
        enabled: config.persistence?.enabled !== false,
        path: config.persistence?.path || './cache-persistence',
        interval: config.persistence?.interval || 300000, // 5 minuti
        maxFileSize: config.persistence?.maxFileSize || 100 * 1024 * 1024, // 100 MB
        compressFiles: config.persistence?.compressFiles !== false
      }
    };
    
    // Stato interno
    this.l1Cache = null;
    this.l2Cache = null;
    this.l3Cache = null;
    this.isInitialized = false;
    this.isShuttingDown = false;
    this.accessPatterns = new Map(); // Mappa per il tracciamento dei pattern di accesso
    this.dependencyGraph = new Map(); // Grafo delle dipendenze tra chiavi
    this.prefetchQueue = []; // Coda di prefetching
    this.prefetchWorkerPool = null; // Pool di worker per il prefetching
    this.accessHistory = new Map(); // Storico degli accessi per chiave
    this.prefetchStats = new Map(); // Statistiche di prefetching per chiave
    this.persistenceTimer = null; // Timer per la persistenza
    
    // Metriche
    this.metrics = {
      operations: { get: 0, set: 0, invalidate: 0 },
      hits: { l1: 0, l2: 0, l3: 0 },
      misses: 0,
      errors: { l1: 0, l2: 0, l3: 0 },
      latency: { l1: 0, l2: 0, l3: 0 },
      prefetching: {
        triggered: 0,
        hits: 0,
        misses: 0,
        totalItems: 0,
        successRate: 0
      },
      compression: { 
        compressed: 0, 
        uncompressed: 0, 
        totalSavedBytes: 0,
        compressionTime: 0,
        decompressionTime: 0
      },
      dependencies: {
        registered: 0,
        invalidations: 0,
        transitiveInvalidations: 0
      },
      persistence: {
        writes: 0,
        reads: 0,
        errors: 0
      },
      lastReportTime: Date.now()
    };
    
    // Inizializzazione
    this._initialize();
  }
  
  /**
   * Inizializza il sistema di cache
   * @private
   */
  async _initialize() {
    try {
      console.log('Inizializzazione del sistema di cache multi-livello avanzato...');
      
      // Inizializza L1 (memoria locale)
      if (this.config.l1.enabled) {
        await this._initializeL1Cache();
      }
      
      // Inizializza L2 (Redis)
      if (this.config.l2.enabled) {
        await this._initializeL2Cache();
      }
      
      // Inizializza L3 (cache distribuita)
      if (this.config.l3.enabled) {
        await this._initializeL3Cache();
      }
      
      // Inizializza il pool di worker per il prefetching
      if (this.config.prefetching.enabled) {
        await this._initializePrefetchWorkers();
      }
      
      // Carica la cache persistente
      if (this.config.persistence.enabled) {
        await this._loadPersistentCache();
        this._startPersistenceTimer();
      }
      
      // Avvia il monitoraggio delle metriche
      if (this.config.enableMetrics) {
        this._startMetricsReporting();
      }
      
      this.isInitialized = true;
      console.log('Sistema di cache multi-livello avanzato inizializzato con successo');
      
      // Emetti evento di inizializzazione completata
      this.emit('initialized');
      
      return true;
    } catch (error) {
      console.error('Errore durante l\'inizializzazione del sistema di cache:', error);
      this.emit('error', error);
      throw error;
    }
  }
  
  /**
   * Inizializza la cache L1 (memoria locale)
   * @private
   */
  async _initializeL1Cache() {
    try {
      console.log('Inizializzazione cache L1 (memoria locale)...');
      
      // Crea l'istanza della cache L1 utilizzando LRUCache
      this.l1Cache = new LRUCache({
        max: this.config.l1.maxSize,
        ttl: this.config.l1.ttl * 1000, // Converti in millisecondi
        updateAgeOnGet: this.config.l1.updateAgeOnGet,
        allowStale: false
      });
      
      console.log(`Cache L1 inizializzata con capacità di ${this.config.l1.maxSize} elementi`);
      return true;
    } catch (error) {
      console.error('Errore durante l\'inizializzazione della cache L1:', error);
      throw error;
    }
  }
  
  /**
   * Inizializza la cache L2 (Redis)
   * @private
   */
  async _initializeL2Cache() {
    try {
      console.log('Inizializzazione cache L2 (Redis)...');
      
      // Importa dinamicamente il modulo Redis
      const Redis = require('ioredis');
      
      // Crea l'istanza Redis
      if (this.config.l2.enableCluster && this.config.l2.clusterNodes.length > 0) {
        // Configurazione cluster
        this.l2Cache = new Redis.Cluster(this.config.l2.clusterNodes, {
          redisOptions: {
            password: this.config.l2.password,
            db: this.config.l2.db,
            tls: this.config.l2.enableTLS ? {} : undefined,
            connectTimeout: this.config.l2.connectTimeout
          },
          scaleReads: 'slave',
          maxRedirections: 16,
          retryDelayOnFailover: 100
        });
      } else {
        // Configurazione standalone
        this.l2Cache = new Redis({
          host: this.config.l2.host,
          port: this.config.l2.port,
          password: this.config.l2.password,
          db: this.config.l2.db,
          tls: this.config.l2.enableTLS ? {} : undefined,
          connectTimeout: this.config.l2.connectTimeout,
          maxRetriesPerRequest: 3
        });
      }
      
      // Gestisci gli eventi Redis
      this.l2Cache.on('error', (error) => {
        console.error('Errore Redis L2:', error);
        this.metrics.errors.l2++;
        this.emit('error', { level: 'l2', error });
      });
      
      this.l2Cache.on('connect', () => {
        console.log('Connessione Redis L2 stabilita');
      });
      
      this.l2Cache.on('ready', () => {
        console.log('Redis L2 pronto');
      });
      
      // Attendi che Redis sia pronto
      await new Promise((resolve) => {
        if (this.l2Cache.status === 'ready') {
          resolve();
        } else {
          this.l2Cache.once('ready', resolve);
        }
      });
      
      console.log(`Cache L2 inizializzata con Redis ${this.config.l2.enableCluster ? 'Cluster' : 'Standalone'}`);
      return true;
    } catch (error) {
      console.error('Errore durante l\'inizializzazione della cache L2:', error);
      throw error;
    }
  }
  
  /**
   * Inizializza la cache L3 (cache distribuita)
   * @private
   */
  async _initializeL3Cache() {
    try {
      console.log(`Inizializzazione cache L3 (${this.config.l3.type})...`);
      
      switch (this.config.l3.type) {
        case 'redis-cluster':
          await this._initializeL3RedisCluster();
          break;
          
        case 'memcached':
          await this._initializeL3Memcached();
          break;
          
        case 'custom':
          if (this.config.l3.customImplementation) {
            this.l3Cache = this.config.l3.customImplementation;
          } else {
            throw new Error('Custom implementation non fornita per la cache L3');
          }
          break;
          
        default:
          throw new Error(`Tipo di cache L3 non supportato: ${this.config.l3.type}`);
      }
      
      console.log(`Cache L3 inizializzata con ${this.config.l3.type}`);
      return true;
    } catch (error) {
      console.error('Errore durante l\'inizializzazione della cache L3:', error);
      throw error;
    }
  }
  
  /**
   * Inizializza la cache L3 con Redis Cluster
   * @private
   */
  async _initializeL3RedisCluster() {
    // Importa dinamicamente il modulo Redis
    const Redis = require('ioredis');
    
    // Verifica che ci siano nodi configurati
    if (!this.config.l3.nodes || this.config.l3.nodes.length === 0) {
      throw new Error('Nessun nodo configurato per Redis Cluster L3');
    }
    
    // Crea l'istanza Redis Cluster
    this.l3Cache = new Redis.Cluster(this.config.l3.nodes, {
      scaleReads: 'slave',
      maxRedirections: 16,
      retryDelayOnFailover: 100,
      clusterRetryStrategy: (times) => Math.min(times * 100, 3000)
    });
    
    // Gestisci gli eventi Redis
    this.l3Cache.on('error', (error) => {
      console.error('Errore Redis Cluster L3:', error);
      this.metrics.errors.l3++;
      this.emit('error', { level: 'l3', error });
    });
    
    // Attendi che il cluster sia pronto
    await new Promise((resolve) => {
      if (this.l3Cache.status === 'ready') {
        resolve();
      } else {
        this.l3Cache.once('ready', resolve);
      }
    });
  }
  
  /**
   * Inizializza la cache L3 con Memcached
   * @private
   */
  async _initializeL3Memcached() {
    // Importa dinamicamente il modulo Memcached
    const Memcached = require('memcached');
    
    // Verifica che ci siano nodi configurati
    if (!this.config.l3.nodes || this.config.l3.nodes.length === 0) {
      throw new Error('Nessun nodo configurato per Memcached L3');
    }
    
    // Crea l'istanza Memcached
    const servers = this.config.l3.nodes.join(',');
    this.l3Cache = new Memcached(servers, {
      retries: 3,
      retry: 1000,
      timeout: 5000,
      poolSize: 10
    });
    
    // Promisify dei metodi Memcached
    this.l3Cache.getAsync = promisify(this.l3Cache.get).bind(this.l3Cache);
    this.l3Cache.setAsync = promisify(this.l3Cache.set).bind(this.l3Cache);
    this.l3Cache.delAsync = promisify(this.l3Cache.del).bind(this.l3Cache);
    this.l3Cache.flushAsync = promisify(this.l3Cache.flush).bind(this.l3Cache);
    
    // Gestisci gli eventi Memcached
    this.l3Cache.on('failure', (details) => {
      console.error('Errore Memcached L3:', details);
      this.metrics.errors.l3++;
      this.emit('error', { level: 'l3', error: details });
    });
    
    this.l3Cache.on('reconnecting', (details) => {
      console.log('Riconnessione Memcached L3:', details);
    });
  }
  
  /**
   * Inizializza i worker per il prefetching
   * @private
   */
  async _initializePrefetchWorkers() {
    try {
      console.log('Inizializzazione worker per il prefetching...');
      
      // Crea il pool di worker
      this.prefetchWorkerPool = new WorkerPool({
        workerCount: this.config.prefetching.workerCount,
        workerScript: path.join(__dirname, 'prefetch-worker.js'),
        workerOptions: {
          prefetchConfig: {
            strategy: this.config.prefetching.strategy,
            threshold: this.config.prefetching.threshold,
            patternLength: this.config.prefetching.patternLength,
            maxPrefetchItems: this.config.prefetching.maxPrefetchItems
          }
        },
        enableMetrics: true,
        metricsInterval: this.config.metricsInterval
      });
      
      // Gestisci gli eventi del pool di worker
      this.prefetchWorkerPool.on('metrics', (metrics) => {
        // Aggiorna le metriche di prefetching
        this.metrics.prefetching.triggered += metrics.tasksCompleted;
      });
      
      console.log(`Worker per il prefetching inizializzati (${this.config.prefetching.workerCount} worker)`);
      return true;
    } catch (error) {
      console.error('Errore durante l\'inizializzazione dei worker per il prefetching:', error);
      throw error;
    }
  }
  
  /**
   * Carica la cache persistente dal disco
   * @private
   */
  async _loadPersistentCache() {
    try {
      console.log('Caricamento della cache persistente...');
      
      // Verifica che la directory esista
      try {
        await fs.mkdir(this.config.persistence.path, { recursive: true });
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }
      }
      
      // Leggi i file di cache
      const files = await fs.readdir(this.config.persistence.path);
      const cacheFiles = files.filter(file => file.endsWith('.cache'));
      
      if (cacheFiles.length === 0) {
        console.log('Nessun file di cache trovato');
        return;
      }
      
      // Carica i file di cache
      for (const file of cacheFiles) {
        try {
          const filePath = path.join(this.config.persistence.path, file);
          const stats = await fs.stat(filePath);
          
          // Salta i file troppo grandi
          if (stats.size > this.config.persistence.maxFileSize) {
            console.warn(`File di cache troppo grande, saltato: ${file}`);
            continue;
          }
          
          // Leggi il file
          let data = await fs.readFile(filePath);
          
          // Decomprimi il file se necessario
          if (file.endsWith('.cache.gz')) {
            data = await promisify(zlib.gunzip)(data);
          }
          
          // Parsa il contenuto
          const cacheData = JSON.parse(data.toString('utf8'));
          
          // Carica i dati nella cache
          for (const [key, value] of Object.entries(cacheData)) {
            if (value.expiry && value.expiry < Date.now()) {
              continue; // Salta le chiavi scadute
            }
            
            // Decodifica il valore se è in base64
            let decodedValue = value.value;
            if (value.encoding === 'base64') {
              decodedValue = Buffer.from(value.value, 'base64');
            }
            
            // Decomprimi il valore se è compresso
            if (value.compressed) {
              try {
                if (value.algorithm === 'brotli') {
                  decodedValue = await brotliDecompressAsync(decodedValue);
                } else {
                  decodedValue = await decompressAsync(decodedValue);
                }
                
                // Converti il buffer in stringa e poi in oggetto
                decodedValue = JSON.parse(decodedValue.toString('utf8'));
              } catch (error) {
                console.error(`Errore durante la decompressione del valore per la chiave ${key}:`, error);
                continue;
              }
            }
            
            // Calcola il TTL rimanente
            const ttl = value.expiry ? Math.max(0, (value.expiry - Date.now()) / 1000) : this.config.defaultTTL;
            
            // Memorizza il valore nella cache
            await this.set(key, decodedValue, { ttl });
            
            // Ripristina le dipendenze
            if (value.dependencies && Array.isArray(value.dependencies)) {
              this.dependencyGraph.set(key, new Set(value.dependencies));
            }
          }
          
          this.metrics.persistence.reads++;
        } catch (error) {
          console.error(`Errore durante il caricamento del file di cache ${file}:`, error);
          this.metrics.persistence.errors++;
        }
      }
      
      console.log(`Cache persistente caricata (${this.metrics.persistence.reads} file)`);
    } catch (error) {
      console.error('Errore durante il caricamento della cache persistente:', error);
      this.metrics.persistence.errors++;
    }
  }
  
  /**
   * Avvia il timer per la persistenza della cache
   * @private
   */
  _startPersistenceTimer() {
    this.persistenceTimer = setInterval(() => {
      this._persistCache();
    }, this.config.persistence.interval);
    
    // Assicurati che il timer non impedisca al processo di terminare
    this.persistenceTimer.unref();
  }
  
  /**
   * Persiste la cache su disco
   * @private
   */
  async _persistCache() {
    try {
      console.log('Persistenza della cache...');
      
      // Verifica che la directory esista
      try {
        await fs.mkdir(this.config.persistence.path, { recursive: true });
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }
      }
      
      // Prepara i dati da persistere
      const cacheData = {};
      let totalItems = 0;
      
      // Raccogli i dati dalla cache L1
      if (this.l1Cache) {
        for (const [key, value] of this.l1Cache.entries()) {
          const normalizedKey = this._normalizeKey(key);
          const ttl = this.l1Cache.getRemainingTTL(key);
          const expiry = ttl > 0 ? Date.now() + ttl : null;
          
          // Prepara il valore per la persistenza
          let persistValue;
          let encoding = null;
          let compressed = false;
          let algorithm = null;
          
          // Comprimi il valore se necessario
          if (this.config.enableCompression && typeof value === 'object') {
            try {
              const stringValue = JSON.stringify(value);
              
              if (Buffer.byteLength(stringValue, 'utf8') >= this.config.compressionThreshold) {
                const startTime = Date.now();
                
                if (this.config.compressionAlgorithm === 'brotli') {
                  const compressedValue = await brotliCompressAsync(Buffer.from(stringValue, 'utf8'));
                  persistValue = compressedValue.toString('base64');
                  compressed = true;
                  algorithm = 'brotli';
                } else {
                  const compressedValue = await compressAsync(stringValue);
                  persistValue = compressedValue.toString('base64');
                  compressed = true;
                  algorithm = 'zlib';
                }
                
                encoding = 'base64';
              } else {
                persistValue = value;
              }
            } catch (error) {
              console.error(`Errore durante la compressione del valore per la chiave ${normalizedKey}:`, error);
              persistValue = value;
            }
          } else {
            persistValue = value;
          }
          
          // Aggiungi le dipendenze
          const dependencies = this.dependencyGraph.has(normalizedKey) 
            ? Array.from(this.dependencyGraph.get(normalizedKey))
            : null;
          
          // Memorizza il valore
          cacheData[normalizedKey] = {
            value: persistValue,
            expiry,
            encoding,
            compressed,
            algorithm,
            dependencies
          };
          
          totalItems++;
          
          // Limita il numero di elementi per evitare file troppo grandi
          if (totalItems >= 10000) {
            break;
          }
        }
      }
      
      // Se non ci sono dati da persistere, esci
      if (totalItems === 0) {
        console.log('Nessun dato da persistere');
        return;
      }
      
      // Crea il file di cache
      const timestamp = Date.now();
      const fileName = `cache_${timestamp}.cache${this.config.persistence.compressFiles ? '.gz' : ''}`;
      const filePath = path.join(this.config.persistence.path, fileName);
      
      // Serializza i dati
      const jsonData = JSON.stringify(cacheData);
      
      // Comprimi il file se necessario
      if (this.config.persistence.compressFiles) {
        const compressedData = await promisify(zlib.gzip)(Buffer.from(jsonData, 'utf8'));
        await fs.writeFile(filePath, compressedData);
      } else {
        await fs.writeFile(filePath, jsonData, 'utf8');
      }
      
      this.metrics.persistence.writes++;
      
      // Elimina i file vecchi
      const files = await fs.readdir(this.config.persistence.path);
      const cacheFiles = files.filter(file => file.endsWith('.cache') || file.endsWith('.cache.gz'));
      
      // Ordina i file per data (dal più vecchio al più recente)
      const sortedFiles = cacheFiles.sort((a, b) => {
        const timestampA = parseInt(a.match(/cache_(\d+)\.cache/)?.[1] || '0');
        const timestampB = parseInt(b.match(/cache_(\d+)\.cache/)?.[1] || '0');
        return timestampA - timestampB;
      });
      
      // Mantieni solo gli ultimi 5 file
      if (sortedFiles.length > 5) {
        const filesToDelete = sortedFiles.slice(0, sortedFiles.length - 5);
        
        for (const file of filesToDelete) {
          try {
            await fs.unlink(path.join(this.config.persistence.path, file));
          } catch (error) {
            console.error(`Errore durante l'eliminazione del file ${file}:`, error);
          }
        }
      }
      
      console.log(`Cache persistita (${totalItems} elementi)`);
    } catch (error) {
      console.error('Errore durante la persistenza della cache:', error);
      this.metrics.persistence.errors++;
    }
  }
  
  /**
   * Avvia il reporting delle metriche
   * @private
   */
  _startMetricsReporting() {
    setInterval(() => {
      const now = Date.now();
      const elapsedSeconds = (now - this.metrics.lastReportTime) / 1000;
      
      if (elapsedSeconds > 0) {
        // Calcola le operazioni al secondo
        const opsPerSecond = {
          get: this.metrics.operations.get / elapsedSeconds,
          set: this.metrics.operations.set / elapsedSeconds,
          invalidate: this.metrics.operations.invalidate / elapsedSeconds
        };
        
        // Calcola l'hit rate
        const totalHits = this.metrics.hits.l1 + this.metrics.hits.l2 + this.metrics.hits.l3;
        const totalOps = totalHits + this.metrics.misses;
        const hitRate = totalOps > 0 ? (totalHits / totalOps) * 100 : 0;
        
        // Calcola la distribuzione degli hit
        const hitDistribution = {
          l1: totalHits > 0 ? (this.metrics.hits.l1 / totalHits) * 100 : 0,
          l2: totalHits > 0 ? (this.metrics.hits.l2 / totalHits) * 100 : 0,
          l3: totalHits > 0 ? (this.metrics.hits.l3 / totalHits) * 100 : 0
        };
        
        // Calcola il rapporto di compressione
        const compressionRatio = this.metrics.compression.uncompressed > 0 
          ? this.metrics.compression.uncompressed / Math.max(1, this.metrics.compression.compressed) 
          : 0;
        
        // Calcola il tasso di successo del prefetching
        const prefetchSuccessRate = this.metrics.prefetching.totalItems > 0
          ? (this.metrics.prefetching.hits / this.metrics.prefetching.totalItems) * 100
          : 0;
        
        // Log delle metriche
        console.log(`Cache metrics - Hit rate: ${hitRate.toFixed(2)}%, Ops/sec: ${(opsPerSecond.get + opsPerSecond.set + opsPerSecond.invalidate).toFixed(2)}`);
        console.log(`Hit distribution - L1: ${hitDistribution.l1.toFixed(2)}%, L2: ${hitDistribution.l2.toFixed(2)}%, L3: ${hitDistribution.l3.toFixed(2)}%`);
        console.log(`Latency (ms) - L1: ${this.metrics.latency.l1.toFixed(2)}, L2: ${this.metrics.latency.l2.toFixed(2)}, L3: ${this.metrics.latency.l3.toFixed(2)}`);
        console.log(`Prefetching - Success rate: ${prefetchSuccessRate.toFixed(2)}%, Triggered: ${this.metrics.prefetching.triggered}, Hits: ${this.metrics.prefetching.hits}`);
        console.log(`Dependencies - Registered: ${this.metrics.dependencies.registered}, Invalidations: ${this.metrics.dependencies.invalidations}, Transitive: ${this.metrics.dependencies.transitiveInvalidations}`);
        
        if (this.config.enableCompression) {
          console.log(`Compression - Ratio: ${compressionRatio.toFixed(2)}x, Compressed: ${this.metrics.compression.compressed}, Saved: ${(this.metrics.compression.totalSavedBytes / 1024).toFixed(2)} KB`);
        }
        
        if (this.config.persistence.enabled) {
          console.log(`Persistence - Writes: ${this.metrics.persistence.writes}, Reads: ${this.metrics.persistence.reads}, Errors: ${this.metrics.persistence.errors}`);
        }
        
        // Emetti evento con le metriche
        this.emit('metrics', {
          timestamp: now,
          opsPerSecond,
          hitRate,
          hitDistribution,
          latency: this.metrics.latency,
          prefetching: {
            successRate: prefetchSuccessRate,
            triggered: this.metrics.prefetching.triggered,
            hits: this.metrics.prefetching.hits,
            misses: this.metrics.prefetching.misses,
            totalItems: this.metrics.prefetching.totalItems
          },
          compression: {
            ratio: compressionRatio,
            compressed: this.metrics.compression.compressed,
            uncompressed: this.metrics.compression.uncompressed,
            savedBytes: this.metrics.compression.totalSavedBytes
          },
          dependencies: {
            registered: this.metrics.dependencies.registered,
            invalidations: this.metrics.dependencies.invalidations,
            transitiveInvalidations: this.metrics.dependencies.transitiveInvalidations
          },
          persistence: {
            writes: this.metrics.persistence.writes,
            reads: this.metrics.persistence.reads,
            errors: this.metrics.persistence.errors
          },
          errors: this.metrics.errors
        });
        
        // Resetta i contatori
        this.metrics.operations = { get: 0, set: 0, invalidate: 0 };
        this.metrics.hits = { l1: 0, l2: 0, l3: 0 };
        this.metrics.misses = 0;
        this.metrics.errors = { l1: 0, l2: 0, l3: 0 };
        this.metrics.latency = { l1: 0, l2: 0, l3: 0 };
        this.metrics.prefetching = {
          triggered: 0,
          hits: 0,
          misses: 0,
          totalItems: 0,
          successRate: 0
        };
        this.metrics.compression = {
          compressed: 0,
          uncompressed: 0,
          totalSavedBytes: 0,
          compressionTime: 0,
          decompressionTime: 0
        };
        this.metrics.dependencies = {
          registered: 0,
          invalidations: 0,
          transitiveInvalidations: 0
        };
        this.metrics.persistence = {
          writes: 0,
          reads: 0,
          errors: 0
        };
        this.metrics.lastReportTime = now;
      }
    }, this.config.metricsInterval);
  }
  
  /**
   * Genera una chiave di cache normalizzata
   * @param {string} key - Chiave originale
   * @returns {string} Chiave normalizzata
   * @private
   */
  _normalizeKey(key) {
    // Verifica se la chiave è già normalizzata
    if (key.startsWith(this.config.namespacePrefix)) {
      return key;
    }
    
    // Normalizza la chiave
    return `${this.config.namespacePrefix}${key}`;
  }
  
  /**
   * Comprime un valore se necessario
   * @param {*} value - Valore da comprimere
   * @param {string} key - Chiave associata al valore (per logging)
   * @returns {Promise<Object>} Oggetto con valore compresso e metadati
   * @private
   */
  async _compressValue(value, key) {
    if (!this.config.enableCompression) {
      return { value, compressed: false, originalSize: 0, compressedSize: 0 };
    }
    
    try {
      // Converti il valore in stringa JSON se non è già una stringa
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      const originalSize = Buffer.byteLength(stringValue, 'utf8');
      
      // Verifica se il valore supera la soglia di compressione
      if (originalSize < this.config.compressionThreshold) {
        return { value, compressed: false, originalSize, compressedSize: originalSize };
      }
      
      // Misura il tempo di compressione
      const startTime = Date.now();
      
      // Comprimi il valore
      let compressedValue;
      if (this.config.compressionAlgorithm === 'brotli') {
        compressedValue = await brotliCompressAsync(Buffer.from(stringValue, 'utf8'), {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: this.config.compressionLevel
          }
        });
      } else {
        // Default: zlib
        compressedValue = await compressAsync(stringValue, {
          level: this.config.compressionLevel
        });
      }
      
      // Calcola il tempo di compressione
      const compressionTime = Date.now() - startTime;
      
      // Calcola la dimensione compressa
      const compressedSize = compressedValue.length;
      
      // Verifica se la compressione è efficace
      if (compressedSize >= originalSize) {
        // La compressione non è efficace, usa il valore originale
        return { value, compressed: false, originalSize, compressedSize: originalSize };
      }
      
      // Aggiorna le metriche
      this.metrics.compression.compressed++;
      this.metrics.compression.uncompressed += originalSize;
      this.metrics.compression.totalSavedBytes += (originalSize - compressedSize);
      this.metrics.compression.compressionTime += compressionTime;
      
      // Restituisci il valore compresso con metadati
      return {
        value: compressedValue,
        compressed: true,
        algorithm: this.config.compressionAlgorithm,
        originalSize,
        compressedSize,
        compressionTime
      };
    } catch (error) {
      console.error(`Errore durante la compressione del valore per la chiave ${key}:`, error);
      // In caso di errore, usa il valore originale
      return { value, compressed: false, originalSize: 0, compressedSize: 0 };
    }
  }
  
  /**
   * Decomprime un valore se necessario
   * @param {*} data - Dati da decomprimere
   * @param {string} key - Chiave associata al valore (per logging)
   * @returns {Promise<*>} Valore decompresso
   * @private
   */
  async _decompressValue(data, key) {
    if (!data || !data.compressed) {
      return data.value;
    }
    
    try {
      // Misura il tempo di decompressione
      const startTime = Date.now();
      
      // Decomprime il valore
      let decompressedValue;
      if (data.algorithm === 'brotli') {
        decompressedValue = await brotliDecompressAsync(data.value);
      } else {
        // Default: zlib
        decompressedValue = await decompressAsync(data.value);
      }
      
      // Calcola il tempo di decompressione
      const decompressionTime = Date.now() - startTime;
      
      // Aggiorna le metriche
      this.metrics.compression.decompressionTime += decompressionTime;
      
      // Converti il buffer in stringa
      const stringValue = decompressedValue.toString('utf8');
      
      // Prova a convertire la stringa in JSON se possibile
      try {
        return JSON.parse(stringValue);
      } catch (e) {
        // Se non è JSON valido, restituisci la stringa
        return stringValue;
      }
    } catch (error) {
      console.error(`Errore durante la decompressione del valore per la chiave ${key}:`, error);
      // In caso di errore, restituisci il valore compresso
      return data.value;
    }
  }
  
  /**
   * Aggiorna il pattern di accesso per una chiave
   * @param {string} key - Chiave acceduta
   * @private
   */
  _updateAccessPattern(key) {
    if (!this.config.prefetching.enabled) {
      return;
    }
    
    // Ottieni l'ultimo pattern di accesso
    const lastAccesses = this.accessHistory.get('__last_accesses__') || [];
    
    // Aggiungi la chiave corrente al pattern
    lastAccesses.push(key);
    
    // Mantieni solo le ultime N chiavi
    if (lastAccesses.length > this.config.prefetching.patternLength) {
      lastAccesses.shift();
    }
    
    // Aggiorna lo storico
    this.accessHistory.set('__last_accesses__', lastAccesses);
    
    // Se abbiamo abbastanza chiavi per formare un pattern, aggiornalo
    if (lastAccesses.length >= 2) {
      // Crea il pattern (tutte le chiavi tranne l'ultima)
      const pattern = lastAccesses.slice(0, -1).join(',');
      const nextKey = lastAccesses[lastAccesses.length - 1];
      
      // Aggiorna la mappa dei pattern
      if (!this.accessPatterns.has(pattern)) {
        this.accessPatterns.set(pattern, new Map());
      }
      
      const nextKeys = this.accessPatterns.get(pattern);
      nextKeys.set(nextKey, (nextKeys.get(nextKey) || 0) + 1);
      
      // Limita la dimensione della mappa dei pattern
      if (this.accessPatterns.size > 1000) {
        // Rimuovi il pattern meno utilizzato
        let minPattern = null;
        let minCount = Infinity;
        
        for (const [p, next] of this.accessPatterns.entries()) {
          const count = Array.from(next.values()).reduce((sum, c) => sum + c, 0);
          if (count < minCount) {
            minCount = count;
            minPattern = p;
          }
        }
        
        if (minPattern) {
          this.accessPatterns.delete(minPattern);
        }
      }
    }
    
    // Aggiorna lo storico degli accessi per la chiave
    if (!this.accessHistory.has(key)) {
      this.accessHistory.set(key, []);
    }
    
    const keyHistory = this.accessHistory.get(key);
    keyHistory.push(Date.now());
    
    // Mantieni solo gli ultimi 100 accessi
    if (keyHistory.length > 100) {
      keyHistory.shift();
    }
    
    // Avvia il prefetching se abbiamo un pattern completo
    if (lastAccesses.length === this.config.prefetching.patternLength) {
      this._triggerPrefetch(lastAccesses);
    }
  }
  
  /**
   * Avvia il prefetching basato su un pattern di accesso
   * @param {Array<string>} pattern - Pattern di accesso
   * @private
   */
  async _triggerPrefetch(pattern) {
    if (!this.config.prefetching.enabled || !this.prefetchWorkerPool) {
      return;
    }
    
    try {
      // Crea il pattern (tutte le chiavi tranne l'ultima)
      const patternKey = pattern.slice(0, -1).join(',');
      
      // Verifica se abbiamo un pattern valido
      if (!this.accessPatterns.has(patternKey)) {
        return;
      }
      
      // Ottieni le chiavi più probabili
      const nextKeys = this.accessPatterns.get(patternKey);
      const totalCount = Array.from(nextKeys.values()).reduce((sum, count) => sum + count, 0);
      
      // Calcola le probabilità e seleziona le chiavi con probabilità superiore alla soglia
      const candidates = [];
      
      for (const [key, count] of nextKeys.entries()) {
        const probability = count / totalCount;
        
        if (probability >= this.config.prefetching.threshold) {
          candidates.push({ key, probability });
        }
      }
      
      // Ordina i candidati per probabilità (dal più probabile al meno probabile)
      candidates.sort((a, b) => b.probability - a.probability);
      
      // Limita il numero di chiavi da prefetchare
      const keysToFetch = candidates
        .slice(0, this.config.prefetching.maxPrefetchItems)
        .map(c => c.key);
      
      // Se non ci sono chiavi da prefetchare, esci
      if (keysToFetch.length === 0) {
        return;
      }
      
      // Aggiorna le metriche
      this.metrics.prefetching.triggered++;
      this.metrics.prefetching.totalItems += keysToFetch.length;
      
      // Esegui il prefetching in background
      this.prefetchWorkerPool.executeTask('prefetch', {
        keys: keysToFetch,
        pattern: patternKey,
        timestamp: Date.now()
      }).then(result => {
        // Aggiorna le statistiche di prefetching
        if (result && result.fetched) {
          for (const key of result.fetched) {
            // Aggiorna le statistiche
            if (!this.prefetchStats.has(key)) {
              this.prefetchStats.set(key, { hits: 0, misses: 0 });
            }
          }
        }
      }).catch(error => {
        console.error('Errore durante il prefetching:', error);
      });
      
      // Prefetch immediato per le chiavi più probabili
      for (const key of keysToFetch.slice(0, 3)) {
        // Verifica se la chiave è già in cache
        const normalizedKey = this._normalizeKey(key);
        const inCache = await this._checkInCache(normalizedKey);
        
        // Se non è in cache, caricala
        if (!inCache) {
          this.get(key).catch(() => {
            // Ignora gli errori durante il prefetching
          });
        }
      }
    } catch (error) {
      console.error('Errore durante il trigger del prefetching:', error);
    }
  }
  
  /**
   * Verifica se una chiave è presente in cache
   * @param {string} key - Chiave da verificare
   * @returns {Promise<boolean>} True se la chiave è in cache
   * @private
   */
  async _checkInCache(key) {
    // Verifica in L1
    if (this.l1Cache && this.l1Cache.has(key)) {
      return true;
    }
    
    // Verifica in L2
    if (this.l2Cache) {
      try {
        const exists = await this.l2Cache.exists(key);
        if (exists) {
          return true;
        }
      } catch (error) {
        // Ignora gli errori
      }
    }
    
    // Verifica in L3
    if (this.l3Cache) {
      try {
        if (this.l3Cache.getAsync) {
          const value = await this.l3Cache.getAsync(key);
          return value !== undefined && value !== null;
        } else if (this.l3Cache.exists) {
          const exists = await this.l3Cache.exists(key);
          return exists;
        }
      } catch (error) {
        // Ignora gli errori
      }
    }
    
    return false;
  }
  
  /**
   * Registra una dipendenza tra chiavi
   * @param {string} key - Chiave dipendente
   * @param {string|Array<string>} dependencies - Chiave o array di chiavi da cui dipende
   * @returns {Promise<boolean>} True se la registrazione ha avuto successo
   */
  async registerDependency(key, dependencies) {
    if (!this.config.dependencies.enabled) {
      return false;
    }
    
    try {
      // Normalizza la chiave
      const normalizedKey = this._normalizeKey(key);
      
      // Converti le dipendenze in array se necessario
      const deps = Array.isArray(dependencies) ? dependencies : [dependencies];
      
      // Normalizza le dipendenze
      const normalizedDeps = deps.map(dep => this._normalizeKey(dep));
      
      // Verifica se la chiave esiste già nel grafo
      if (!this.dependencyGraph.has(normalizedKey)) {
        this.dependencyGraph.set(normalizedKey, new Set());
      }
      
      // Ottieni il set di dipendenze
      const dependencySet = this.dependencyGraph.get(normalizedKey);
      
      // Aggiungi le nuove dipendenze
      for (const dep of normalizedDeps) {
        // Evita dipendenze circolari
        if (dep === normalizedKey) {
          continue;
        }
        
        // Verifica se abbiamo raggiunto il limite di dipendenze per chiave
        if (dependencySet.size >= this.config.dependencies.maxDependenciesPerKey) {
          console.warn(`Limite di dipendenze raggiunto per la chiave ${normalizedKey}`);
          break;
        }
        
        dependencySet.add(dep);
        this.metrics.dependencies.registered++;
      }
      
      // Verifica se abbiamo raggiunto il limite di dipendenze totali
      if (this.dependencyGraph.size > this.config.dependencies.maxDependencies) {
        // Rimuovi le chiavi meno utilizzate
        const keysToRemove = [];
        
        for (const [graphKey] of this.dependencyGraph.entries()) {
          // Verifica se la chiave è stata acceduta di recente
          if (!this.accessHistory.has(graphKey)) {
            keysToRemove.push(graphKey);
          }
        }
        
        // Rimuovi le chiavi
        for (const keyToRemove of keysToRemove.slice(0, this.dependencyGraph.size - this.config.dependencies.maxDependencies)) {
          this.dependencyGraph.delete(keyToRemove);
        }
      }
      
      return true;
    } catch (error) {
      console.error('Errore durante la registrazione della dipendenza:', error);
      return false;
    }
  }
  
  /**
   * Invalida tutte le chiavi dipendenti da una chiave
   * @param {string} key - Chiave da cui dipendono altre chiavi
   * @param {number} depth - Profondità massima per le dipendenze transitive
   * @returns {Promise<Array<string>>} Array di chiavi invalidate
   * @private
   */
  async _invalidateDependents(key, depth = 0) {
    if (!this.config.dependencies.enabled) {
      return [];
    }
    
    try {
      // Normalizza la chiave
      const normalizedKey = this._normalizeKey(key);
      
      // Trova tutte le chiavi che dipendono da questa
      const dependents = [];
      
      for (const [depKey, deps] of this.dependencyGraph.entries()) {
        if (deps.has(normalizedKey)) {
          dependents.push(depKey);
        }
      }
      
      // Invalida tutte le chiavi dipendenti
      const invalidated = [];
      
      for (const dependent of dependents) {
        // Invalida la chiave
        await this.invalidate(dependent);
        invalidated.push(dependent);
        
        // Aggiorna le metriche
        this.metrics.dependencies.invalidations++;
        
        // Se abilitato, invalida anche le dipendenze transitive
        if (this.config.dependencies.enableTransitiveDependencies && depth < this.config.dependencies.maxTransitiveDepth) {
          const transitive = await this._invalidateDependents(dependent, depth + 1);
          invalidated.push(...transitive);
          
          // Aggiorna le metriche
          this.metrics.dependencies.transitiveInvalidations += transitive.length;
        }
      }
      
      return invalidated;
    } catch (error) {
      console.error('Errore durante l\'invalidazione delle dipendenze:', error);
      return [];
    }
  }
  
  /**
   * Ottiene un valore dalla cache
   * @param {string} key - Chiave da cercare
   * @param {Object} options - Opzioni
   * @returns {Promise<*>} Valore trovato o null se non trovato
   */
  async get(key, options = {}) {
    // Verifica che il sistema sia inizializzato
    if (!this.isInitialized) {
      throw new Error('Sistema di cache non inizializzato');
    }
    
    // Normalizza la chiave
    const normalizedKey = this._normalizeKey(key);
    
    // Aggiorna le metriche
    this.metrics.operations.get++;
    
    // Aggiorna il pattern di accesso
    this._updateAccessPattern(normalizedKey);
    
    try {
      // Cerca nella cache L1 (memoria locale)
      if (this.config.l1.enabled && this.l1Cache) {
        const startTime = Date.now();
        const value = this.l1Cache.get(normalizedKey);
        const endTime = Date.now();
        
        // Aggiorna le metriche di latenza
        this.metrics.latency.l1 = endTime - startTime;
        
        if (value !== undefined) {
          // Aggiorna le metriche
          this.metrics.hits.l1++;
          
          // Aggiorna le statistiche di prefetching
          if (this.prefetchStats.has(normalizedKey)) {
            const stats = this.prefetchStats.get(normalizedKey);
            stats.hits++;
            this.metrics.prefetching.hits++;
          }
          
          return value;
        }
      }
      
      // Cerca nella cache L2 (Redis)
      if (this.config.l2.enabled && this.l2Cache) {
        const startTime = Date.now();
        let value;
        
        try {
          value = await this.l2Cache.get(normalizedKey);
        } catch (error) {
          console.error(`Errore durante il recupero dalla cache L2 per la chiave ${normalizedKey}:`, error);
          this.metrics.errors.l2++;
        }
        
        const endTime = Date.now();
        
        // Aggiorna le metriche di latenza
        this.metrics.latency.l2 = endTime - startTime;
        
        if (value !== null && value !== undefined) {
          // Aggiorna le metriche
          this.metrics.hits.l2++;
          
          // Decodifica il valore se necessario
          let decodedValue = value;
          
          try {
            // Se il valore è una stringa JSON, prova a decodificarlo
            if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
              decodedValue = JSON.parse(value);
            }
          } catch (error) {
            // Se non è JSON valido, usa il valore originale
            decodedValue = value;
          }
          
          // Promuovi il valore alla cache L1
          if (this.config.l1.enabled && this.l1Cache) {
            this.l1Cache.set(normalizedKey, decodedValue, { ttl: this.config.l1.ttl * 1000 });
          }
          
          // Aggiorna le statistiche di prefetching
          if (this.prefetchStats.has(normalizedKey)) {
            const stats = this.prefetchStats.get(normalizedKey);
            stats.hits++;
            this.metrics.prefetching.hits++;
          }
          
          return decodedValue;
        }
      }
      
      // Cerca nella cache L3 (cache distribuita)
      if (this.config.l3.enabled && this.l3Cache) {
        const startTime = Date.now();
        let value;
        
        try {
          if (this.l3Cache.getAsync) {
            // Memcached
            value = await this.l3Cache.getAsync(normalizedKey);
          } else {
            // Redis Cluster o custom
            value = await this.l3Cache.get(normalizedKey);
          }
        } catch (error) {
          console.error(`Errore durante il recupero dalla cache L3 per la chiave ${normalizedKey}:`, error);
          this.metrics.errors.l3++;
        }
        
        const endTime = Date.now();
        
        // Aggiorna le metriche di latenza
        this.metrics.latency.l3 = endTime - startTime;
        
        if (value !== null && value !== undefined) {
          // Aggiorna le metriche
          this.metrics.hits.l3++;
          
          // Decodifica il valore se necessario
          let decodedValue = value;
          
          try {
            // Se il valore è una stringa JSON, prova a decodificarlo
            if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
              decodedValue = JSON.parse(value);
            }
          } catch (error) {
            // Se non è JSON valido, usa il valore originale
            decodedValue = value;
          }
          
          // Promuovi il valore alla cache L2
          if (this.config.l2.enabled && this.l2Cache) {
            try {
              const valueToStore = typeof decodedValue === 'object' ? JSON.stringify(decodedValue) : decodedValue;
              await this.l2Cache.set(normalizedKey, valueToStore, 'EX', this.config.l2.ttl);
            } catch (error) {
              console.error(`Errore durante la promozione alla cache L2 per la chiave ${normalizedKey}:`, error);
              this.metrics.errors.l2++;
            }
          }
          
          // Promuovi il valore alla cache L1
          if (this.config.l1.enabled && this.l1Cache) {
            this.l1Cache.set(normalizedKey, decodedValue, { ttl: this.config.l1.ttl * 1000 });
          }
          
          // Aggiorna le statistiche di prefetching
          if (this.prefetchStats.has(normalizedKey)) {
            const stats = this.prefetchStats.get(normalizedKey);
            stats.hits++;
            this.metrics.prefetching.hits++;
          }
          
          return decodedValue;
        }
      }
      
      // Valore non trovato in nessuna cache
      this.metrics.misses++;
      
      // Aggiorna le statistiche di prefetching
      if (this.prefetchStats.has(normalizedKey)) {
        const stats = this.prefetchStats.get(normalizedKey);
        stats.misses++;
        this.metrics.prefetching.misses++;
      }
      
      return null;
    } catch (error) {
      console.error(`Errore durante il recupero dalla cache per la chiave ${normalizedKey}:`, error);
      throw error;
    }
  }
  
  /**
   * Imposta un valore nella cache
   * @param {string} key - Chiave
   * @param {*} value - Valore da memorizzare
   * @param {Object} options - Opzioni
   * @param {number} options.ttl - TTL in secondi (sovrascrive il valore predefinito)
   * @param {Array<string>} options.dependencies - Chiavi da cui dipende questo valore
   * @returns {Promise<boolean>} True se l'operazione ha avuto successo
   */
  async set(key, value, options = {}) {
    // Verifica che il sistema sia inizializzato
    if (!this.isInitialized) {
      throw new Error('Sistema di cache non inizializzato');
    }
    
    // Normalizza la chiave
    const normalizedKey = this._normalizeKey(key);
    
    // Aggiorna le metriche
    this.metrics.operations.set++;
    
    try {
      // Calcola il TTL
      const ttl = options.ttl !== undefined ? options.ttl : this.config.defaultTTL;
      
      // Registra le dipendenze se specificate
      if (options.dependencies && this.config.dependencies.enabled) {
        await this.registerDependency(normalizedKey, options.dependencies);
      }
      
      // Comprimi il valore se necessario
      let valueToStore = value;
      let compressedData = null;
      
      if (this.config.enableCompression && typeof value === 'object') {
        compressedData = await this._compressValue(value, normalizedKey);
        
        if (compressedData.compressed) {
          valueToStore = compressedData.value;
        }
      }
      
      // Memorizza il valore nella cache L1
      if (this.config.l1.enabled && this.l1Cache) {
        this.l1Cache.set(normalizedKey, value, { ttl: this.config.l1.ttl * 1000 });
      }
      
      // Memorizza il valore nella cache L2
      if (this.config.l2.enabled && this.l2Cache) {
        try {
          // Prepara il valore da memorizzare
          let l2Value;
          
          if (compressedData && compressedData.compressed) {
            // Usa il valore compresso
            l2Value = compressedData.value;
          } else {
            // Converti in JSON se è un oggetto
            l2Value = typeof value === 'object' ? JSON.stringify(value) : value;
          }
          
          // Memorizza il valore
          await this.l2Cache.set(normalizedKey, l2Value, 'EX', this.config.l2.ttl);
        } catch (error) {
          console.error(`Errore durante la memorizzazione nella cache L2 per la chiave ${normalizedKey}:`, error);
          this.metrics.errors.l2++;
        }
      }
      
      // Memorizza il valore nella cache L3
      if (this.config.l3.enabled && this.l3Cache) {
        try {
          // Prepara il valore da memorizzare
          let l3Value;
          
          if (compressedData && compressedData.compressed) {
            // Usa il valore compresso
            l3Value = compressedData.value;
          } else {
            // Converti in JSON se è un oggetto
            l3Value = typeof value === 'object' ? JSON.stringify(value) : value;
          }
          
          // Memorizza il valore
          if (this.l3Cache.setAsync) {
            // Memcached
            await this.l3Cache.setAsync(normalizedKey, l3Value, this.config.l3.ttl);
          } else {
            // Redis Cluster o custom
            await this.l3Cache.set(normalizedKey, l3Value, 'EX', this.config.l3.ttl);
          }
        } catch (error) {
          console.error(`Errore durante la memorizzazione nella cache L3 per la chiave ${normalizedKey}:`, error);
          this.metrics.errors.l3++;
        }
      }
      
      return true;
    } catch (error) {
      console.error(`Errore durante la memorizzazione nella cache per la chiave ${normalizedKey}:`, error);
      throw error;
    }
  }
  
  /**
   * Invalida una chiave dalla cache
   * @param {string} key - Chiave da invalidare
   * @param {Object} options - Opzioni
   * @param {boolean} options.invalidateDependents - Se true, invalida anche le chiavi dipendenti
   * @returns {Promise<boolean>} True se l'operazione ha avuto successo
   */
  async invalidate(key, options = {}) {
    // Verifica che il sistema sia inizializzato
    if (!this.isInitialized) {
      throw new Error('Sistema di cache non inizializzato');
    }
    
    // Normalizza la chiave
    const normalizedKey = this._normalizeKey(key);
    
    // Aggiorna le metriche
    this.metrics.operations.invalidate++;
    
    try {
      // Invalida la chiave nella cache L1
      if (this.config.l1.enabled && this.l1Cache) {
        this.l1Cache.delete(normalizedKey);
      }
      
      // Invalida la chiave nella cache L2
      if (this.config.l2.enabled && this.l2Cache) {
        try {
          await this.l2Cache.del(normalizedKey);
        } catch (error) {
          console.error(`Errore durante l'invalidazione nella cache L2 per la chiave ${normalizedKey}:`, error);
          this.metrics.errors.l2++;
        }
      }
      
      // Invalida la chiave nella cache L3
      if (this.config.l3.enabled && this.l3Cache) {
        try {
          if (this.l3Cache.delAsync) {
            // Memcached
            await this.l3Cache.delAsync(normalizedKey);
          } else {
            // Redis Cluster o custom
            await this.l3Cache.del(normalizedKey);
          }
        } catch (error) {
          console.error(`Errore durante l'invalidazione nella cache L3 per la chiave ${normalizedKey}:`, error);
          this.metrics.errors.l3++;
        }
      }
      
      // Invalida le chiavi dipendenti se richiesto
      if (options.invalidateDependents !== false && this.config.dependencies.enabled) {
        await this._invalidateDependents(normalizedKey);
      }
      
      return true;
    } catch (error) {
      console.error(`Errore durante l'invalidazione nella cache per la chiave ${normalizedKey}:`, error);
      throw error;
    }
  }
  
  /**
   * Invalida tutte le chiavi con un prefisso specifico
   * @param {string} prefix - Prefisso delle chiavi da invalidare
   * @param {Object} options - Opzioni
   * @param {boolean} options.invalidateDependents - Se true, invalida anche le chiavi dipendenti
   * @returns {Promise<boolean>} True se l'operazione ha avuto successo
   */
  async invalidateByPrefix(prefix, options = {}) {
    // Verifica che il sistema sia inizializzato
    if (!this.isInitialized) {
      throw new Error('Sistema di cache non inizializzato');
    }
    
    // Normalizza il prefisso
    const normalizedPrefix = this._normalizeKey(prefix);
    
    try {
      // Invalida le chiavi nella cache L1
      if (this.config.l1.enabled && this.l1Cache) {
        for (const key of this.l1Cache.keys()) {
          if (key.startsWith(normalizedPrefix)) {
            this.l1Cache.delete(key);
          }
        }
      }
      
      // Invalida le chiavi nella cache L2
      if (this.config.l2.enabled && this.l2Cache) {
        try {
          // Ottieni tutte le chiavi con il prefisso
          const keys = await this.l2Cache.keys(`${normalizedPrefix}*`);
          
          if (keys.length > 0) {
            // Elimina tutte le chiavi
            await this.l2Cache.del(...keys);
          }
        } catch (error) {
          console.error(`Errore durante l'invalidazione per prefisso nella cache L2 (${normalizedPrefix}):`, error);
          this.metrics.errors.l2++;
        }
      }
      
      // Invalida le chiavi nella cache L3
      if (this.config.l3.enabled && this.l3Cache) {
        try {
          if (this.l3Cache.keys) {
            // Redis Cluster
            const keys = await this.l3Cache.keys(`${normalizedPrefix}*`);
            
            if (keys.length > 0) {
              // Elimina tutte le chiavi
              await this.l3Cache.del(...keys);
            }
          } else {
            // Memcached o custom (non supporta l'eliminazione per prefisso)
            console.warn('L\'invalidazione per prefisso non è supportata per la cache L3');
          }
        } catch (error) {
          console.error(`Errore durante l'invalidazione per prefisso nella cache L3 (${normalizedPrefix}):`, error);
          this.metrics.errors.l3++;
        }
      }
      
      // Invalida le chiavi dipendenti se richiesto
      if (options.invalidateDependents !== false && this.config.dependencies.enabled) {
        // Trova tutte le chiavi che iniziano con il prefisso
        const keysToInvalidate = [];
        
        for (const key of this.dependencyGraph.keys()) {
          if (key.startsWith(normalizedPrefix)) {
            keysToInvalidate.push(key);
          }
        }
        
        // Invalida tutte le chiavi dipendenti
        for (const key of keysToInvalidate) {
          await this._invalidateDependents(key);
        }
      }
      
      return true;
    } catch (error) {
      console.error(`Errore durante l'invalidazione per prefisso (${normalizedPrefix}):`, error);
      throw error;
    }
  }
  
  /**
   * Ottiene le statistiche della cache
   * @returns {Promise<Object>} Statistiche della cache
   */
  async getStats() {
    // Verifica che il sistema sia inizializzato
    if (!this.isInitialized) {
      throw new Error('Sistema di cache non inizializzato');
    }
    
    try {
      // Statistiche L1
      let l1Stats = { size: 0, maxSize: 0 };
      if (this.config.l1.enabled && this.l1Cache) {
        l1Stats = {
          size: this.l1Cache.size,
          maxSize: this.config.l1.maxSize,
          utilization: this.l1Cache.size / this.config.l1.maxSize
        };
      }
      
      // Statistiche L2
      let l2Stats = { size: 0 };
      if (this.config.l2.enabled && this.l2Cache) {
        try {
          const info = await this.l2Cache.info();
          l2Stats = {
            size: info.used_memory ? parseInt(info.used_memory) : 0,
            keys: info.db0 ? parseInt(info.db0.split('=')[1].split(',')[0]) : 0
          };
        } catch (error) {
          console.error('Errore durante il recupero delle statistiche L2:', error);
        }
      }
      
      // Statistiche L3
      let l3Stats = { size: 0 };
      if (this.config.l3.enabled && this.l3Cache) {
        try {
          if (this.l3Cache.stats) {
            const stats = await promisify(this.l3Cache.stats).bind(this.l3Cache)();
            l3Stats = { size: stats.curr_items || 0 };
          }
        } catch (error) {
          console.error('Errore durante il recupero delle statistiche L3:', error);
        }
      }
      
      // Statistiche di prefetching
      const prefetchingStats = {
        enabled: this.config.prefetching.enabled,
        patternCount: this.accessPatterns.size,
        successRate: this.metrics.prefetching.totalItems > 0
          ? (this.metrics.prefetching.hits / this.metrics.prefetching.totalItems) * 100
          : 0
      };
      
      // Statistiche delle dipendenze
      const dependenciesStats = {
        enabled: this.config.dependencies.enabled,
        count: this.dependencyGraph.size,
        totalDependencies: Array.from(this.dependencyGraph.values())
          .reduce((sum, deps) => sum + deps.size, 0)
      };
      
      return {
        levels: {
          l1: l1Stats,
          l2: l2Stats,
          l3: l3Stats
        },
        prefetching: prefetchingStats,
        dependencies: dependenciesStats,
        metrics: { ...this.metrics }
      };
    } catch (error) {
      console.error('Errore durante il recupero delle statistiche della cache:', error);
      throw error;
    }
  }
  
  /**
   * Chiude il sistema di cache
   * @returns {Promise<void>}
   */
  async close() {
    // Verifica che il sistema sia inizializzato
    if (!this.isInitialized) {
      return;
    }
    
    console.log('Chiusura del sistema di cache multi-livello...');
    
    // Imposta il flag di chiusura
    this.isShuttingDown = true;
    
    try {
      // Persisti la cache se abilitato
      if (this.config.persistence.enabled) {
        // Cancella il timer di persistenza
        if (this.persistenceTimer) {
          clearInterval(this.persistenceTimer);
          this.persistenceTimer = null;
        }
        
        // Esegui un'ultima persistenza
        await this._persistCache();
      }
      
      // Chiudi il pool di worker per il prefetching
      if (this.prefetchWorkerPool) {
        await this.prefetchWorkerPool.close();
        this.prefetchWorkerPool = null;
      }
      
      // Chiudi la cache L2
      if (this.l2Cache) {
        if (this.l2Cache.quit) {
          await this.l2Cache.quit();
        } else if (this.l2Cache.disconnect) {
          await this.l2Cache.disconnect();
        }
        this.l2Cache = null;
      }
      
      // Chiudi la cache L3
      if (this.l3Cache) {
        if (this.l3Cache.quit) {
          await this.l3Cache.quit();
        } else if (this.l3Cache.end) {
          this.l3Cache.end();
        } else if (this.l3Cache.disconnect) {
          await this.l3Cache.disconnect();
        }
        this.l3Cache = null;
      }
      
      // Resetta lo stato
      this.l1Cache = null;
      this.isInitialized = false;
      
      console.log('Sistema di cache multi-livello chiuso');
    } catch (error) {
      console.error('Errore durante la chiusura del sistema di cache:', error);
      throw error;
    }
  }
}

module.exports = { MultiLevelCache };
