/**
 * Implementazione del Database Shardato per il Layer-2 su Solana
 * 
 * Questo modulo implementa un sistema di database shardato con supporto per
 * sharding orizzontale, replicazione, connection pooling e failover automatico.
 */

const { EventEmitter } = require('events');
const { Pool } = require('pg');
const crypto = require('crypto');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const { performance } = require('perf_hooks');
const { v4: uuidv4 } = require('uuid');
const { PerformanceMetrics } = require('./performance-metrics');
const { MultiLevelCache } = require('./multi-level-cache');

/**
 * Classe DatabaseShard
 * 
 * Gestisce un singolo shard del database
 */
class DatabaseShard extends EventEmitter {
  /**
   * Costruttore
   * @param {Object} config - Configurazione
   */
  constructor(config) {
    super();
    
    this.id = config.id;
    this.connectionPoolSize = config.connectionPoolSize || 50;
    this.metrics = config.metrics;
    this.connectionPool = null;
    this.isInitialized = false;
    this.isShuttingDown = false;
    this.lastHealthCheck = 0;
    this.healthCheckInterval = config.healthCheckInterval || 30000; // 30 secondi
    this.healthStatus = 'unknown';
    
    // Configurazione del database
    this.dbConfig = {
      host: config.host || 'localhost',
      port: config.port || 5432,
      database: config.database || 'layer2',
      user: config.user || 'postgres',
      password: config.password || '',
      ssl: config.ssl || false,
      max: this.connectionPoolSize,
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 5000,
      ...config.dbConfig
    };
    
    // Cache locale per query frequenti
    this.queryCache = new Map();
    this.maxQueryCacheSize = config.maxQueryCacheSize || 1000;
    this.queryCacheTTL = config.queryCacheTTL || 60000; // 1 minuto
    
    // Prepared statements
    this.preparedStatements = new Map();
  }
  
  /**
   * Inizializza lo shard
   */
  async initialize() {
    try {
      console.log(`Inizializzazione shard ${this.id}...`);
      
      // Crea il pool di connessioni
      this.connectionPool = new Pool(this.dbConfig);
      
      // Gestisci gli eventi del pool
      this.connectionPool.on('error', (err, client) => {
        console.error(`Errore nel pool di connessioni dello shard ${this.id}:`, err);
        this.metrics.incrementCounter('connection_errors');
        this.emit('error', { shardId: this.id, error: err });
      });
      
      this.connectionPool.on('connect', (client) => {
        this.metrics.incrementCounter('connections');
      });
      
      this.connectionPool.on('remove', (client) => {
        this.metrics.incrementCounter('connection_removals');
      });
      
      // Verifica la connessione
      await this._testConnection();
      
      // Inizializza le tabelle se necessario
      await this._initializeTables();
      
      // Prepara gli statement comuni
      await this._prepareCommonStatements();
      
      // Avvia il controllo periodico dello stato
      this._startHealthCheck();
      
      this.isInitialized = true;
      this.healthStatus = 'healthy';
      
      console.log(`Shard ${this.id} inizializzato con ${this.connectionPoolSize} connessioni`);
      this.emit('initialized', { shardId: this.id });
      
      return true;
    } catch (error) {
      console.error(`Errore durante l'inizializzazione dello shard ${this.id}:`, error);
      this.healthStatus = 'error';
      this.metrics.incrementCounter('initialization_errors');
      this.emit('error', { shardId: this.id, error });
      throw error;
    }
  }
  
  /**
   * Testa la connessione al database
   * @private
   */
  async _testConnection() {
    try {
      const client = await this.connectionPool.connect();
      try {
        const result = await client.query('SELECT NOW()');
        console.log(`Connessione al database dello shard ${this.id} stabilita`);
        return true;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error(`Errore durante il test della connessione dello shard ${this.id}:`, error);
      throw error;
    }
  }
  
  /**
   * Inizializza le tabelle del database
   * @private
   */
  async _initializeTables() {
    const client = await this.connectionPool.connect();
    try {
      // Crea le tabelle se non esistono
      await client.query(`
        CREATE TABLE IF NOT EXISTS transactions (
          id VARCHAR(64) PRIMARY KEY,
          sender VARCHAR(64) NOT NULL,
          data JSONB NOT NULL,
          status VARCHAR(20) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_transactions_sender ON transactions(sender);
        CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
        CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
        
        CREATE TABLE IF NOT EXISTS state (
          key VARCHAR(255) PRIMARY KEY,
          value JSONB NOT NULL,
          version BIGINT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_state_updated_at ON state(updated_at);
      `);
      
      console.log(`Tabelle dello shard ${this.id} inizializzate`);
      return true;
    } catch (error) {
      console.error(`Errore durante l'inizializzazione delle tabelle dello shard ${this.id}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Prepara gli statement comuni
   * @private
   */
  async _prepareCommonStatements() {
    const client = await this.connectionPool.connect();
    try {
      // Prepara gli statement comuni
      await client.query('PREPARE get_transaction(VARCHAR) AS SELECT * FROM transactions WHERE id = $1');
      await client.query('PREPARE get_transactions_by_sender(VARCHAR, INTEGER, INTEGER) AS SELECT * FROM transactions WHERE sender = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3');
      await client.query('PREPARE insert_transaction(VARCHAR, VARCHAR, JSONB, VARCHAR) AS INSERT INTO transactions(id, sender, data, status) VALUES($1, $2, $3, $4) RETURNING *');
      await client.query('PREPARE update_transaction_status(VARCHAR, VARCHAR) AS UPDATE transactions SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *');
      await client.query('PREPARE get_state(VARCHAR) AS SELECT * FROM state WHERE key = $1');
      await client.query('PREPARE upsert_state(VARCHAR, JSONB, BIGINT) AS INSERT INTO state(key, value, version) VALUES($1, $2, $3) ON CONFLICT(key) DO UPDATE SET value = $2, version = $3, updated_at = NOW() WHERE state.version < $3 RETURNING *');
      
      // Memorizza gli statement preparati
      this.preparedStatements.set('get_transaction', true);
      this.preparedStatements.set('get_transactions_by_sender', true);
      this.preparedStatements.set('insert_transaction', true);
      this.preparedStatements.set('update_transaction_status', true);
      this.preparedStatements.set('get_state', true);
      this.preparedStatements.set('upsert_state', true);
      
      console.log(`Statement comuni dello shard ${this.id} preparati`);
      return true;
    } catch (error) {
      console.error(`Errore durante la preparazione degli statement dello shard ${this.id}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Avvia il controllo periodico dello stato
   * @private
   */
  _startHealthCheck() {
    setInterval(async () => {
      try {
        await this._performHealthCheck();
      } catch (error) {
        console.error(`Errore durante il controllo dello stato dello shard ${this.id}:`, error);
      }
    }, this.healthCheckInterval);
  }
  
  /**
   * Esegue un controllo dello stato
   * @private
   */
  async _performHealthCheck() {
    if (this.isShuttingDown) {
      return;
    }
    
    try {
      const startTime = performance.now();
      
      // Esegui una query semplice
      const client = await this.connectionPool.connect();
      try {
        await client.query('SELECT 1');
        
        // Aggiorna lo stato
        this.healthStatus = 'healthy';
        this.lastHealthCheck = Date.now();
        
        const endTime = performance.now();
        this.metrics.recordLatency('health_check', endTime - startTime);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error(`Errore durante il controllo dello stato dello shard ${this.id}:`, error);
      
      // Aggiorna lo stato
      this.healthStatus = 'unhealthy';
      this.metrics.incrementCounter('health_check_failures');
      
      // Emetti evento di errore
      this.emit('health_check_failed', { shardId: this.id, error });
    }
  }
  
  /**
   * Ottiene una connessione dal pool
   * @returns {Promise<Object>} - Connessione
   */
  async getConnection() {
    if (!this.isInitialized || this.isShuttingDown) {
      throw new Error(`Shard ${this.id} non inizializzato o in fase di arresto`);
    }
    
    const startTime = performance.now();
    
    try {
      const connection = await this.connectionPool.connect();
      
      const endTime = performance.now();
      this.metrics.recordLatency('get_connection', endTime - startTime);
      
      return connection;
    } catch (error) {
      const endTime = performance.now();
      this.metrics.recordLatency('get_connection_failed', endTime - startTime);
      this.metrics.incrementCounter('get_connection_failures');
      
      console.error(`Errore durante l'ottenimento di una connessione dallo shard ${this.id}:`, error);
      throw error;
    }
  }
  
  /**
   * Rilascia una connessione al pool
   * @param {Object} connection - Connessione
   */
  releaseConnection(connection) {
    if (connection) {
      connection.release();
    }
  }
  
  /**
   * Esegue una query
   * @param {string} text - Testo della query
   * @param {Array} params - Parametri della query
   * @param {Object} options - Opzioni
   * @returns {Promise<Object>} - Risultato della query
   */
  async query(text, params = [], options = {}) {
    if (!this.isInitialized || this.isShuttingDown) {
      throw new Error(`Shard ${this.id} non inizializzato o in fase di arresto`);
    }
    
    const startTime = performance.now();
    
    // Opzioni di default
    const queryOptions = {
      useCache: options.useCache !== false,
      cacheTTL: options.cacheTTL || this.queryCacheTTL,
      usePrepared: options.usePrepared !== false,
      preparedName: options.preparedName,
      ...options
    };
    
    // Genera una chiave di cache
    const cacheKey = this._generateCacheKey(text, params);
    
    // Verifica se il risultato è in cache
    if (queryOptions.useCache && this.queryCache.has(cacheKey)) {
      const cachedResult = this.queryCache.get(cacheKey);
      
      // Verifica che il risultato non sia scaduto
      if (cachedResult.timestamp + queryOptions.cacheTTL > Date.now()) {
        const endTime = performance.now();
        this.metrics.recordLatency('query_cache_hit', endTime - startTime);
        this.metrics.incrementCounter('query_cache_hits');
        
        return cachedResult.result;
      }
      
      // Rimuovi il risultato scaduto
      this.queryCache.delete(cacheKey);
    }
    
    try {
      let result;
      
      // Usa uno statement preparato se disponibile
      if (queryOptions.usePrepared && queryOptions.preparedName && this.preparedStatements.has(queryOptions.preparedName)) {
        result = await this.connectionPool.query(`EXECUTE ${queryOptions.preparedName}(${params.map((_, i) => `$${i + 1}`).join(', ')})`, params);
      } else {
        // Esegui la query normalmente
        result = await this.connectionPool.query(text, params);
      }
      
      // Memorizza il risultato in cache
      if (queryOptions.useCache) {
        // Limita la dimensione della cache
        if (this.queryCache.size >= this.maxQueryCacheSize) {
          // Rimuovi la chiave più vecchia
          const oldestKey = [...this.queryCache.entries()]
            .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
          this.queryCache.delete(oldestKey);
        }
        
        this.queryCache.set(cacheKey, {
          result,
          timestamp: Date.now()
        });
      }
      
      const endTime = performance.now();
      this.metrics.recordLatency('query', endTime - startTime);
      
      return result;
    } catch (error) {
      const endTime = performance.now();
      this.metrics.recordLatency('query_failed', endTime - startTime);
      this.metrics.incrementCounter('query_failures');
      
      console.error(`Errore durante l'esecuzione della query sullo shard ${this.id}:`, error);
      throw error;
    }
  }
  
  /**
   * Esegue una query con una connessione dedicata
   * @param {string} text - Testo della query
   * @param {Array} params - Parametri della query
   * @param {Object} options - Opzioni
   * @returns {Promise<Object>} - Risultato della query
   */
  async queryWithConnection(text, params = [], options = {}) {
    const connection = await this.getConnection();
    
    try {
      return await connection.query(text, params);
    } finally {
      this.releaseConnection(connection);
    }
  }
  
  /**
   * Esegue una transazione
   * @param {Function} callback - Callback che esegue le query nella transazione
   * @returns {Promise<*>} - Risultato della transazione
   */
  async transaction(callback) {
    if (!this.isInitialized || this.isShuttingDown) {
      throw new Error(`Shard ${this.id} non inizializzato o in fase di arresto`);
    }
    
    const startTime = performance.now();
    
    const connection = await this.getConnection();
    
    try {
      // Inizia la transazione
      await connection.query('BEGIN');
      
      // Esegui il callback
      const result = await callback(connection);
      
      // Commit della transazione
      await connection.query('COMMIT');
      
      const endTime = performance.now();
      this.metrics.recordLatency('transaction', endTime - startTime);
      
      return result;
    } catch (error) {
      // Rollback della transazione
      try {
        await connection.query('ROLLBACK');
      } catch (rollbackError) {
        console.error(`Errore durante il rollback della transazione sullo shard ${this.id}:`, rollbackError);
      }
      
      const endTime = performance.now();
      this.metrics.recordLatency('transaction_failed', endTime - startTime);
      this.metrics.incrementCounter('transaction_failures');
      
      console.error(`Errore durante l'esecuzione della transazione sullo shard ${this.id}:`, error);
      throw error;
    } finally {
      this.releaseConnection(connection);
    }
  }
  
  /**
   * Ottiene una transazione
   * @param {string} id - ID della transazione
   * @returns {Promise<Object>} - Transazione
   */
  async getTransaction(id) {
    return this.query('SELECT * FROM transactions WHERE id = $1', [id], {
      useCache: true,
      preparedName: 'get_transaction'
    });
  }
  
  /**
   * Ottiene le transazioni di un mittente
   * @param {string} sender - Indirizzo del mittente
   * @param {number} limit - Limite di risultati
   * @param {number} offset - Offset
   * @returns {Promise<Array<Object>>} - Transazioni
   */
  async getTransactionsBySender(sender, limit = 10, offset = 0) {
    return this.query('SELECT * FROM transactions WHERE sender = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [sender, limit, offset], {
      useCache: true,
      preparedName: 'get_transactions_by_sender'
    });
  }
  
  /**
   * Inserisce una transazione
   * @param {Object} transaction - Transazione
   * @returns {Promise<Object>} - Transazione inserita
   */
  async insertTransaction(transaction) {
    return this.query('INSERT INTO transactions(id, sender, data, status) VALUES($1, $2, $3, $4) RETURNING *', [
      transaction.id,
      transaction.sender,
      transaction.data,
      transaction.status || 'pending'
    ], {
      useCache: false,
      preparedName: 'insert_transaction'
    });
  }
  
  /**
   * Aggiorna lo stato di una transazione
   * @param {string} id - ID della transazione
   * @param {string} status - Nuovo stato
   * @returns {Promise<Object>} - Transazione aggiornata
   */
  async updateTransactionStatus(id, status) {
    return this.query('UPDATE transactions SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *', [id, status], {
      useCache: false,
      preparedName: 'update_transaction_status'
    });
  }
  
  /**
   * Ottiene un valore dallo stato
   * @param {string} key - Chiave
   * @returns {Promise<Object>} - Valore
   */
  async getState(key) {
    return this.query('SELECT * FROM state WHERE key = $1', [key], {
      useCache: true,
      preparedName: 'get_state'
    });
  }
  
  /**
   * Aggiorna o inserisce un valore nello stato
   * @param {string} key - Chiave
   * @param {Object} value - Valore
   * @param {number} version - Versione
   * @returns {Promise<Object>} - Stato aggiornato
   */
  async upsertState(key, value, version) {
    return this.query('INSERT INTO state(key, value, version) VALUES($1, $2, $3) ON CONFLICT(key) DO UPDATE SET value = $2, version = $3, updated_at = NOW() WHERE state.version < $3 RETURNING *', [key, value, version], {
      useCache: false,
      preparedName: 'upsert_state'
    });
  }
  
  /**
   * Genera una chiave di cache per una query
   * @param {string} text - Testo della query
   * @param {Array} params - Parametri della query
   * @returns {string} - Chiave di cache
   * @private
   */
  _generateCacheKey(text, params) {
    const hash = crypto.createHash('sha256');
    hash.update(text);
    hash.update(JSON.stringify(params));
    return hash.digest('hex');
  }
  
  /**
   * Invalida la cache delle query
   * @param {string} pattern - Pattern per le chiavi da invalidare
   */
  invalidateCache(pattern = null) {
    if (pattern) {
      // Invalida solo le chiavi che corrispondono al pattern
      for (const key of this.queryCache.keys()) {
        if (key.includes(pattern)) {
          this.queryCache.delete(key);
        }
      }
    } else {
      // Invalida tutta la cache
      this.queryCache.clear();
    }
  }
  
  /**
   * Ottiene lo stato di salute dello shard
   * @returns {Object} - Stato di salute
   */
  getHealthStatus() {
    return {
      id: this.id,
      status: this.healthStatus,
      lastHealthCheck: this.lastHealthCheck,
      connectionPool: {
        total: this.connectionPool.totalCount,
        idle: this.connectionPool.idleCount,
        waiting: this.connectionPool.waitingCount
      }
    };
  }
  
  /**
   * Chiude lo shard
   */
  async close() {
    if (this.isShuttingDown) {
      return;
    }
    
    this.isShuttingDown = true;
    
    try {
      console.log(`Chiusura dello shard ${this.id}...`);
      
      // Chiudi il pool di connessioni
      await this.connectionPool.end();
      
      this.isInitialized = false;
      console.log(`Shard ${this.id} chiuso`);
      
      // Emetti evento di chiusura
      this.emit('closed', { shardId: this.id });
      
      return true;
    } catch (error) {
      console.error(`Errore durante la chiusura dello shard ${this.id}:`, error);
      throw error;
    }
  }
}

/**
 * Classe ShardedDatabase
 * 
 * Implementa un database shardato con supporto per sharding orizzontale,
 * replicazione e failover automatico.
 */
class ShardedDatabase extends EventEmitter {
  /**
   * Costruttore
   * @param {Object} config - Configurazione
   */
  constructor(config = {}) {
    super();
    
    this.config = {
      shardCount: config.shardCount || 16,
      shardingStrategy: config.shardingStrategy || 'consistent-hash',
      replicationFactor: config.replicationFactor || 3,
      connectionPoolSize: config.connectionPoolSize || 50,
      enableMetrics: config.enableMetrics !== false,
      metricsInterval: config.metricsInterval || 10000, // 10 secondi
      enableCache: config.enableCache !== false,
      cacheConfig: config.cacheConfig || {},
      healthCheckInterval: config.healthCheckInterval || 30000, // 30 secondi
      failoverEnabled: config.failoverEnabled !== false,
      failoverTimeout: config.failoverTimeout || 10000, // 10 secondi
      ...config
    };
    
    // Shards
    this.shards = [];
    this.shardReplicas = new Map(); // Mappa shardId -> [replicaIds]
    this.shardStatus = new Map(); // Mappa shardId -> status
    
    // Cache
    this.cache = null;
    
    // Metriche
    this.metrics = new PerformanceMetrics('database', {
      enableMetrics: this.config.enableMetrics,
      metricsInterval: this.config.metricsInterval
    });
    
    // Stato
    this.isInitialized = false;
    this.isShuttingDown = false;
    this.healthCheckTimer = null;
  }
  
  /**
   * Inizializza il database shardato
   */
  async initialize() {
    try {
      console.log('Inizializzazione del database shardato...');
      
      // Inizializza la cache
      if (this.config.enableCache) {
        await this._initializeCache();
      }
      
      // Inizializza gli shard
      await this._initializeShards();
      
      // Avvia il controllo periodico dello stato
      this._startHealthCheck();
      
      this.isInitialized = true;
      console.log(`Database shardato inizializzato con ${this.config.shardCount} shard e fattore di replicazione ${this.config.replicationFactor}`);
      
      // Emetti evento di inizializzazione completata
      this.emit('initialized', {
        shardCount: this.config.shardCount,
        replicationFactor: this.config.replicationFactor,
        shardingStrategy: this.config.shardingStrategy
      });
      
      return true;
    } catch (error) {
      console.error('Errore durante l\'inizializzazione del database shardato:', error);
      throw error;
    }
  }
  
  /**
   * Inizializza la cache
   * @private
   */
  async _initializeCache() {
    try {
      console.log('Inizializzazione della cache...');
      
      // Crea la cache multi-livello
      this.cache = new MultiLevelCache({
        ...this.config.cacheConfig,
        namespacePrefix: 'db:',
        enableMetrics: this.config.enableMetrics
      });
      
      // Inizializza la cache
      await this.cache.initialize();
      
      console.log('Cache inizializzata');
      return true;
    } catch (error) {
      console.error('Errore durante l\'inizializzazione della cache:', error);
      throw error;
    }
  }
  
  /**
   * Inizializza gli shard
   * @private
   */
  async _initializeShards() {
    try {
      console.log(`Inizializzazione di ${this.config.shardCount} shard...`);
      
      // Crea gli shard
      for (let i = 0; i < this.config.shardCount; i++) {
        const shardId = `shard-${i}`;
        
        // Crea lo shard primario
        const shard = new DatabaseShard({
          id: shardId,
          connectionPoolSize: this.config.connectionPoolSize,
          metrics: this.metrics,
          ...this.config.shardConfig
        });
        
        // Gestisci gli eventi dello shard
        shard.on('error', (data) => {
          console.error(`Errore nello shard ${data.shardId}:`, data.error);
          this.emit('shard_error', data);
        });
        
        shard.on('health_check_failed', (data) => {
          console.error(`Controllo dello stato dello shard ${data.shardId} fallito:`, data.error);
          this.emit('shard_health_check_failed', data);
          
          // Aggiorna lo stato dello shard
          this.shardStatus.set(data.shardId, 'unhealthy');
          
          // Attiva il failover se abilitato
          if (this.config.failoverEnabled) {
            this._activateFailover(data.shardId).catch(error => {
              console.error(`Errore durante l'attivazione del failover per lo shard ${data.shardId}:`, error);
            });
          }
        });
        
        // Inizializza lo shard
        await shard.initialize();
        
        // Aggiungi lo shard alla lista
        this.shards.push(shard);
        
        // Aggiorna lo stato dello shard
        this.shardStatus.set(shardId, 'healthy');
        
        // Crea le repliche
        const replicas = [];
        for (let j = 0; j < this.config.replicationFactor - 1; j++) {
          const replicaId = `${shardId}-replica-${j}`;
          
          // Crea la replica
          const replica = new DatabaseShard({
            id: replicaId,
            connectionPoolSize: this.config.connectionPoolSize,
            metrics: this.metrics,
            ...this.config.shardConfig
          });
          
          // Gestisci gli eventi della replica
          replica.on('error', (data) => {
            console.error(`Errore nella replica ${data.shardId}:`, data.error);
            this.emit('replica_error', data);
          });
          
          replica.on('health_check_failed', (data) => {
            console.error(`Controllo dello stato della replica ${data.shardId} fallito:`, data.error);
            this.emit('replica_health_check_failed', data);
            
            // Aggiorna lo stato della replica
            this.shardStatus.set(data.shardId, 'unhealthy');
          });
          
          // Inizializza la replica
          await replica.initialize();
          
          // Aggiungi la replica alla lista
          this.shards.push(replica);
          replicas.push(replicaId);
          
          // Aggiorna lo stato della replica
          this.shardStatus.set(replicaId, 'healthy');
        }
        
        // Memorizza le repliche dello shard
        this.shardReplicas.set(shardId, replicas);
      }
      
      console.log(`Inizializzati ${this.shards.length} shard (${this.config.shardCount} primari e ${this.shards.length - this.config.shardCount} repliche)`);
      return true;
    } catch (error) {
      console.error('Errore durante l\'inizializzazione degli shard:', error);
      throw error;
    }
  }
  
  /**
   * Avvia il controllo periodico dello stato
   * @private
   */
  _startHealthCheck() {
    this.healthCheckTimer = setInterval(async () => {
      try {
        await this._performHealthCheck();
      } catch (error) {
        console.error('Errore durante il controllo dello stato del database shardato:', error);
      }
    }, this.config.healthCheckInterval);
  }
  
  /**
   * Esegue un controllo dello stato
   * @private
   */
  async _performHealthCheck() {
    if (this.isShuttingDown) {
      return;
    }
    
    // Ottieni lo stato di salute di tutti gli shard
    const healthStatus = {};
    
    for (const shard of this.shards) {
      healthStatus[shard.id] = shard.getHealthStatus();
    }
    
    // Emetti evento con lo stato di salute
    this.emit('health_check', healthStatus);
    
    return healthStatus;
  }
  
  /**
   * Attiva il failover per uno shard
   * @param {string} shardId - ID dello shard
   * @private
   */
  async _activateFailover(shardId) {
    console.log(`Attivazione del failover per lo shard ${shardId}...`);
    
    // Verifica che lo shard esista
    if (!this.shardReplicas.has(shardId)) {
      throw new Error(`Shard ${shardId} non trovato`);
    }
    
    // Ottieni le repliche dello shard
    const replicaIds = this.shardReplicas.get(shardId);
    
    // Verifica che ci siano repliche disponibili
    if (!replicaIds || replicaIds.length === 0) {
      throw new Error(`Nessuna replica disponibile per lo shard ${shardId}`);
    }
    
    // Trova una replica sana
    let healthyReplicaId = null;
    
    for (const replicaId of replicaIds) {
      if (this.shardStatus.get(replicaId) === 'healthy') {
        healthyReplicaId = replicaId;
        break;
      }
    }
    
    if (!healthyReplicaId) {
      throw new Error(`Nessuna replica sana disponibile per lo shard ${shardId}`);
    }
    
    // Trova lo shard primario e la replica sana
    const primaryShard = this.shards.find(s => s.id === shardId);
    const healthyReplica = this.shards.find(s => s.id === healthyReplicaId);
    
    if (!primaryShard || !healthyReplica) {
      throw new Error(`Shard primario o replica non trovati`);
    }
    
    // Promuovi la replica a primario
    console.log(`Promozione della replica ${healthyReplicaId} a primario per lo shard ${shardId}...`);
    
    // Aggiorna le mappe
    const replicaIndex = replicaIds.indexOf(healthyReplicaId);
    replicaIds.splice(replicaIndex, 1);
    replicaIds.push(shardId);
    
    // Scambia gli ID
    primaryShard.id = healthyReplicaId;
    healthyReplica.id = shardId;
    
    // Scambia gli shard nell'array
    const primaryIndex = this.shards.findIndex(s => s.id === healthyReplicaId);
    const replicaIndex2 = this.shards.findIndex(s => s.id === shardId);
    
    if (primaryIndex !== -1 && replicaIndex2 !== -1) {
      const temp = this.shards[primaryIndex];
      this.shards[primaryIndex] = this.shards[replicaIndex2];
      this.shards[replicaIndex2] = temp;
    }
    
    // Aggiorna lo stato
    this.shardStatus.set(shardId, 'healthy');
    this.shardStatus.set(healthyReplicaId, 'unhealthy');
    
    // Emetti evento di failover
    this.emit('failover', {
      shardId,
      newPrimaryId: healthyReplicaId,
      oldPrimaryId: shardId
    });
    
    console.log(`Failover completato per lo shard ${shardId}`);
    
    // Tenta di riavviare lo shard non sano
    setTimeout(async () => {
      try {
        console.log(`Tentativo di riavvio dello shard non sano ${healthyReplicaId}...`);
        
        // Chiudi lo shard
        await primaryShard.close();
        
        // Ricrea lo shard
        const newShard = new DatabaseShard({
          id: healthyReplicaId,
          connectionPoolSize: this.config.connectionPoolSize,
          metrics: this.metrics,
          ...this.config.shardConfig
        });
        
        // Gestisci gli eventi dello shard
        newShard.on('error', (data) => {
          console.error(`Errore nello shard ${data.shardId}:`, data.error);
          this.emit('shard_error', data);
        });
        
        newShard.on('health_check_failed', (data) => {
          console.error(`Controllo dello stato dello shard ${data.shardId} fallito:`, data.error);
          this.emit('shard_health_check_failed', data);
          
          // Aggiorna lo stato dello shard
          this.shardStatus.set(data.shardId, 'unhealthy');
        });
        
        // Inizializza lo shard
        await newShard.initialize();
        
        // Sostituisci lo shard nell'array
        const index = this.shards.findIndex(s => s.id === healthyReplicaId);
        if (index !== -1) {
          this.shards[index] = newShard;
        }
        
        // Aggiorna lo stato dello shard
        this.shardStatus.set(healthyReplicaId, 'healthy');
        
        console.log(`Shard ${healthyReplicaId} riavviato con successo`);
      } catch (error) {
        console.error(`Errore durante il riavvio dello shard ${healthyReplicaId}:`, error);
      }
    }, this.config.failoverTimeout);
  }
  
  /**
   * Ottiene lo shard per una chiave
   * @param {string} key - Chiave
   * @returns {DatabaseShard} - Shard
   */
  getShardForKey(key) {
    if (!this.isInitialized || this.isShuttingDown) {
      throw new Error('Database shardato non inizializzato o in fase di arresto');
    }
    
    if (this.config.shardingStrategy === 'consistent-hash') {
      // Implementazione di consistent hashing
      const hash = this._consistentHash(key);
      const shardIndex = hash % this.config.shardCount;
      const shardId = `shard-${shardIndex}`;
      
      // Trova lo shard
      const shard = this.shards.find(s => s.id === shardId);
      
      if (!shard) {
        throw new Error(`Shard ${shardId} non trovato`);
      }
      
      // Verifica lo stato dello shard
      if (this.shardStatus.get(shardId) !== 'healthy') {
        // Trova una replica sana
        const replicaIds = this.shardReplicas.get(shardId) || [];
        
        for (const replicaId of replicaIds) {
          if (this.shardStatus.get(replicaId) === 'healthy') {
            // Usa la replica
            const replica = this.shards.find(s => s.id === replicaId);
            
            if (replica) {
              return replica;
            }
          }
        }
        
        // Nessuna replica sana trovata, usa lo shard originale
        console.warn(`Nessuna replica sana trovata per lo shard ${shardId}, uso lo shard originale`);
      }
      
      return shard;
    } else if (this.config.shardingStrategy === 'range') {
      // Implementazione di range-based sharding
      // ...
      throw new Error('Range-based sharding non ancora implementato');
    } else {
      throw new Error(`Strategia di sharding non supportata: ${this.config.shardingStrategy}`);
    }
  }
  
  /**
   * Calcola l'hash consistente di una chiave
   * @param {string} key - Chiave
   * @returns {number} - Hash
   * @private
   */
  _consistentHash(key) {
    const hash = crypto.createHash('sha256');
    hash.update(key);
    const digest = hash.digest('hex');
    
    // Converti i primi 8 caratteri dell'hash in un numero
    return parseInt(digest.substring(0, 8), 16);
  }
  
  /**
   * Ottiene un valore
   * @param {string} key - Chiave
   * @returns {Promise<*>} - Valore
   */
  async get(key) {
    if (!this.isInitialized || this.isShuttingDown) {
      throw new Error('Database shardato non inizializzato o in fase di arresto');
    }
    
    const startTime = performance.now();
    
    try {
      // Prova a ottenere il valore dalla cache
      if (this.config.enableCache && this.cache) {
        const cachedValue = await this.cache.get(key);
        
        if (cachedValue !== null && cachedValue !== undefined) {
          const endTime = performance.now();
          this.metrics.recordLatency('get_cache_hit', endTime - startTime);
          this.metrics.incrementCounter('cache_hits');
          
          return cachedValue;
        }
      }
      
      // Ottieni lo shard per la chiave
      const shard = this.getShardForKey(key);
      
      // Ottieni il valore dallo shard
      const result = await shard.getState(key);
      
      // Estrai il valore
      const value = result.rows.length > 0 ? result.rows[0].value : null;
      
      // Memorizza il valore nella cache
      if (this.config.enableCache && this.cache && value !== null) {
        await this.cache.set(key, value);
      }
      
      const endTime = performance.now();
      this.metrics.recordLatency('get', endTime - startTime);
      
      return value;
    } catch (error) {
      const endTime = performance.now();
      this.metrics.recordLatency('get_failed', endTime - startTime);
      this.metrics.incrementCounter('get_failures');
      
      console.error(`Errore durante l'ottenimento del valore per la chiave ${key}:`, error);
      throw error;
    }
  }
  
  /**
   * Imposta un valore
   * @param {string} key - Chiave
   * @param {*} value - Valore
   * @returns {Promise<boolean>} - True se l'operazione è riuscita
   */
  async set(key, value) {
    if (!this.isInitialized || this.isShuttingDown) {
      throw new Error('Database shardato non inizializzato o in fase di arresto');
    }
    
    const startTime = performance.now();
    
    try {
      // Ottieni lo shard per la chiave
      const shard = this.getShardForKey(key);
      
      // Genera una nuova versione
      const version = Date.now();
      
      // Aggiorna il valore nello shard
      await shard.upsertState(key, value, version);
      
      // Replica l'operazione su altri shard se necessario
      if (this.config.replicationFactor > 1) {
        await this._replicateOperation('set', key, value, version);
      }
      
      // Aggiorna la cache
      if (this.config.enableCache && this.cache) {
        await this.cache.set(key, value);
      }
      
      const endTime = performance.now();
      this.metrics.recordLatency('set', endTime - startTime);
      
      return true;
    } catch (error) {
      const endTime = performance.now();
      this.metrics.recordLatency('set_failed', endTime - startTime);
      this.metrics.incrementCounter('set_failures');
      
      console.error(`Errore durante l'impostazione del valore per la chiave ${key}:`, error);
      throw error;
    }
  }
  
  /**
   * Replica un'operazione su altri shard
   * @param {string} operation - Operazione
   * @param {string} key - Chiave
   * @param {*} value - Valore
   * @param {number} version - Versione
   * @private
   */
  async _replicateOperation(operation, key, value, version) {
    // Ottieni lo shard primario per la chiave
    const primaryShardId = `shard-${this._consistentHash(key) % this.config.shardCount}`;
    
    // Ottieni le repliche
    const replicaIds = this.shardReplicas.get(primaryShardId) || [];
    
    // Replica l'operazione su tutte le repliche
    const replicationPromises = [];
    
    for (const replicaId of replicaIds) {
      // Trova la replica
      const replica = this.shards.find(s => s.id === replicaId);
      
      if (replica && this.shardStatus.get(replicaId) === 'healthy') {
        // Replica l'operazione
        if (operation === 'set') {
          replicationPromises.push(replica.upsertState(key, value, version));
        }
      }
    }
    
    // Attendi il completamento di tutte le replicazioni
    if (replicationPromises.length > 0) {
      await Promise.all(replicationPromises);
    }
  }
  
  /**
   * Elimina un valore
   * @param {string} key - Chiave
   * @returns {Promise<boolean>} - True se l'operazione è riuscita
   */
  async delete(key) {
    if (!this.isInitialized || this.isShuttingDown) {
      throw new Error('Database shardato non inizializzato o in fase di arresto');
    }
    
    const startTime = performance.now();
    
    try {
      // Ottieni lo shard per la chiave
      const shard = this.getShardForKey(key);
      
      // Elimina il valore dallo shard
      await shard.query('DELETE FROM state WHERE key = $1', [key]);
      
      // Replica l'operazione su altri shard se necessario
      if (this.config.replicationFactor > 1) {
        // Ottieni lo shard primario per la chiave
        const primaryShardId = `shard-${this._consistentHash(key) % this.config.shardCount}`;
        
        // Ottieni le repliche
        const replicaIds = this.shardReplicas.get(primaryShardId) || [];
        
        // Replica l'operazione su tutte le repliche
        const replicationPromises = [];
        
        for (const replicaId of replicaIds) {
          // Trova la replica
          const replica = this.shards.find(s => s.id === replicaId);
          
          if (replica && this.shardStatus.get(replicaId) === 'healthy') {
            // Replica l'operazione
            replicationPromises.push(replica.query('DELETE FROM state WHERE key = $1', [key]));
          }
        }
        
        // Attendi il completamento di tutte le replicazioni
        if (replicationPromises.length > 0) {
          await Promise.all(replicationPromises);
        }
      }
      
      // Invalida la cache
      if (this.config.enableCache && this.cache) {
        await this.cache.delete(key);
      }
      
      const endTime = performance.now();
      this.metrics.recordLatency('delete', endTime - startTime);
      
      return true;
    } catch (error) {
      const endTime = performance.now();
      this.metrics.recordLatency('delete_failed', endTime - startTime);
      this.metrics.incrementCounter('delete_failures');
      
      console.error(`Errore durante l'eliminazione del valore per la chiave ${key}:`, error);
      throw error;
    }
  }
  
  /**
   * Esegue una query su tutti gli shard
   * @param {string} text - Testo della query
   * @param {Array} params - Parametri della query
   * @param {Object} options - Opzioni
   * @returns {Promise<Array<Object>>} - Risultati
   */
  async queryAll(text, params = [], options = {}) {
    if (!this.isInitialized || this.isShuttingDown) {
      throw new Error('Database shardato non inizializzato o in fase di arresto');
    }
    
    const startTime = performance.now();
    
    try {
      // Esegui la query su tutti gli shard primari
      const queryPromises = [];
      
      for (let i = 0; i < this.config.shardCount; i++) {
        const shardId = `shard-${i}`;
        const shard = this.shards.find(s => s.id === shardId);
        
        if (shard && this.shardStatus.get(shardId) === 'healthy') {
          queryPromises.push(shard.query(text, params, options));
        }
      }
      
      // Attendi il completamento di tutte le query
      const results = await Promise.all(queryPromises);
      
      // Combina i risultati
      const combinedResults = {
        rows: [],
        rowCount: 0
      };
      
      for (const result of results) {
        combinedResults.rows.push(...result.rows);
        combinedResults.rowCount += result.rowCount;
      }
      
      const endTime = performance.now();
      this.metrics.recordLatency('query_all', endTime - startTime);
      
      return combinedResults;
    } catch (error) {
      const endTime = performance.now();
      this.metrics.recordLatency('query_all_failed', endTime - startTime);
      this.metrics.incrementCounter('query_all_failures');
      
      console.error('Errore durante l\'esecuzione della query su tutti gli shard:', error);
      throw error;
    }
  }
  
  /**
   * Ottiene le metriche del database
   * @returns {Promise<Object>} - Metriche
   */
  async getMetrics() {
    return this.metrics.getMetrics();
  }
  
  /**
   * Ottiene lo stato di salute del database
   * @returns {Promise<Object>} - Stato di salute
   */
  async getHealthStatus() {
    // Ottieni lo stato di salute di tutti gli shard
    const shardStatus = {};
    
    for (const shard of this.shards) {
      shardStatus[shard.id] = shard.getHealthStatus();
    }
    
    // Calcola lo stato di salute complessivo
    let overallStatus = 'healthy';
    let healthyShards = 0;
    let totalShards = this.shards.length;
    
    for (const status of Object.values(shardStatus)) {
      if (status.status === 'healthy') {
        healthyShards++;
      }
    }
    
    // Se meno del 50% degli shard è sano, lo stato è critico
    if (healthyShards < totalShards * 0.5) {
      overallStatus = 'critical';
    } else if (healthyShards < totalShards) {
      // Se almeno uno shard non è sano, lo stato è degradato
      overallStatus = 'degraded';
    }
    
    return {
      status: overallStatus,
      healthyShards,
      totalShards,
      shardStatus
    };
  }
  
  /**
   * Chiude il database
   */
  async close() {
    if (this.isShuttingDown) {
      return;
    }
    
    this.isShuttingDown = true;
    
    try {
      console.log('Chiusura del database shardato...');
      
      // Ferma il timer di controllo dello stato
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = null;
      }
      
      // Chiudi tutti gli shard
      await Promise.all(this.shards.map(shard => shard.close()));
      
      // Chiudi la cache
      if (this.config.enableCache && this.cache) {
        // Chiudi la cache
      }
      
      this.isInitialized = false;
      console.log('Database shardato chiuso');
      
      // Emetti evento di chiusura
      this.emit('closed');
      
      return true;
    } catch (error) {
      console.error('Errore durante la chiusura del database shardato:', error);
      throw error;
    }
  }
}

module.exports = {
  ShardedDatabase,
  DatabaseShard
};
