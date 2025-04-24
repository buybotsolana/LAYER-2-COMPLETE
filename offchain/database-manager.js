/**
 * Implementazione di Database Sharding per il Layer-2 su Solana
 * 
 * Questo modulo implementa un sistema di sharding per il database che consente
 * di distribuire i dati su più nodi per migliorare la scalabilità e le prestazioni.
 */

const { Pool } = require('pg');
const { Logger } = require('../logger/structured_logger');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Classe per la gestione del database sharding
 */
class DatabaseShardingManager {
  /**
   * Crea una nuova istanza del gestore di sharding
   * @param {Object} config - Configurazione del sistema
   * @param {Array} config.shards - Configurazione degli shard
   * @param {Object} config.shardingStrategy - Strategia di sharding
   * @param {Object} logger - Logger strutturato
   */
  constructor(config, logger = null) {
    this.config = config;
    this.logger = logger || new Logger({ service: 'database-sharding-manager' });
    
    // Inizializza le connessioni agli shard
    this.shards = new Map();
    this.initializeShards();
    
    // Carica la strategia di sharding
    this.shardingStrategy = config.shardingStrategy || {
      type: 'hash',
      keyField: 'id',
      function: 'md5'
    };
    
    this.logger.info('Database Sharding Manager inizializzato', { 
      shardCount: config.shards.length,
      strategyType: this.shardingStrategy.type
    });
  }
  
  /**
   * Inizializza le connessioni agli shard
   * @private
   */
  initializeShards() {
    for (let i = 0; i < this.config.shards.length; i++) {
      const shardConfig = this.config.shards[i];
      
      // Crea un pool di connessioni per lo shard
      const pool = new Pool({
        host: shardConfig.host,
        port: shardConfig.port,
        database: shardConfig.database,
        user: shardConfig.user,
        password: shardConfig.password,
        max: shardConfig.maxConnections || 20,
        idleTimeoutMillis: shardConfig.idleTimeout || 30000,
        connectionTimeoutMillis: shardConfig.connectionTimeout || 2000
      });
      
      // Gestione degli errori del pool
      pool.on('error', (err, client) => {
        this.logger.error('Errore nel pool di connessioni dello shard', {
          error: err.message,
          shardId: i,
          host: shardConfig.host,
          database: shardConfig.database
        });
      });
      
      // Memorizza il pool
      this.shards.set(i, {
        id: i,
        config: shardConfig,
        pool,
        status: 'initialized'
      });
      
      this.logger.info('Shard inizializzato', {
        shardId: i,
        host: shardConfig.host,
        database: shardConfig.database
      });
    }
  }
  
  /**
   * Determina lo shard per una chiave
   * @param {string|number|Object} key - Chiave di sharding
   * @returns {number} ID dello shard
   */
  getShardForKey(key) {
    let shardKey;
    
    // Estrai la chiave di sharding in base al tipo di input
    if (typeof key === 'object' && key !== null) {
      // Se la chiave è un oggetto, estrai il campo specificato nella strategia
      shardKey = key[this.shardingStrategy.keyField];
      
      if (shardKey === undefined) {
        throw new Error(`Campo di sharding '${this.shardingStrategy.keyField}' non trovato nell'oggetto`);
      }
    } else {
      // Altrimenti usa la chiave direttamente
      shardKey = key;
    }
    
    // Calcola l'ID dello shard in base alla strategia
    let shardId;
    
    switch (this.shardingStrategy.type) {
      case 'hash':
        shardId = this._hashSharding(shardKey);
        break;
      case 'range':
        shardId = this._rangeSharding(shardKey);
        break;
      case 'lookup':
        shardId = this._lookupSharding(shardKey);
        break;
      case 'consistent-hash':
        shardId = this._consistentHashSharding(shardKey);
        break;
      default:
        throw new Error(`Strategia di sharding '${this.shardingStrategy.type}' non supportata`);
    }
    
    this.logger.debug('Shard determinato per chiave', {
      key: typeof shardKey === 'object' ? JSON.stringify(shardKey) : shardKey,
      shardId
    });
    
    return shardId;
  }
  
  /**
   * Implementa lo sharding basato su hash
   * @private
   * @param {string|number} key - Chiave di sharding
   * @returns {number} ID dello shard
   */
  _hashSharding(key) {
    // Converti la chiave in stringa
    const keyStr = String(key);
    
    // Calcola l'hash della chiave
    let hash;
    switch (this.shardingStrategy.function) {
      case 'md5':
        hash = crypto.createHash('md5').update(keyStr).digest('hex');
        break;
      case 'sha1':
        hash = crypto.createHash('sha1').update(keyStr).digest('hex');
        break;
      case 'crc32':
        // Implementazione semplificata di CRC32
        const crc32 = require('crc-32');
        hash = crc32.str(keyStr).toString(16);
        break;
      default:
        hash = crypto.createHash('md5').update(keyStr).digest('hex');
    }
    
    // Converti l'hash in un numero e calcola il modulo per ottenere l'ID dello shard
    const hashNum = parseInt(hash.substring(0, 8), 16);
    return hashNum % this.shards.size;
  }
  
  /**
   * Implementa lo sharding basato su range
   * @private
   * @param {number} key - Chiave di sharding
   * @returns {number} ID dello shard
   */
  _rangeSharding(key) {
    // Verifica che la chiave sia un numero
    const keyNum = Number(key);
    
    if (isNaN(keyNum)) {
      throw new Error('La chiave deve essere un numero per lo sharding basato su range');
    }
    
    // Ottieni i range dalla configurazione
    const ranges = this.shardingStrategy.ranges || [];
    
    // Trova il range che contiene la chiave
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];
      
      if (keyNum >= range.min && keyNum <= range.max) {
        return range.shardId;
      }
    }
    
    // Se non è stato trovato un range, usa un fallback
    return keyNum % this.shards.size;
  }
  
  /**
   * Implementa lo sharding basato su lookup
   * @private
   * @param {string} key - Chiave di sharding
   * @returns {number} ID dello shard
   */
  _lookupSharding(key) {
    // Ottieni la tabella di lookup dalla configurazione
    const lookupTable = this.shardingStrategy.lookupTable || {};
    
    // Cerca la chiave nella tabella
    if (lookupTable[key] !== undefined) {
      return lookupTable[key];
    }
    
    // Se la chiave non è nella tabella, usa un fallback
    return this._hashSharding(key);
  }
  
  /**
   * Implementa lo sharding basato su consistent hashing
   * @private
   * @param {string|number} key - Chiave di sharding
   * @returns {number} ID dello shard
   */
  _consistentHashSharding(key) {
    // Converti la chiave in stringa
    const keyStr = String(key);
    
    // Ottieni il ring dalla configurazione o creane uno nuovo
    if (!this.consistentHashRing) {
      this._initializeConsistentHashRing();
    }
    
    // Calcola l'hash della chiave
    const keyHash = crypto.createHash('md5').update(keyStr).digest('hex');
    const keyHashNum = parseInt(keyHash.substring(0, 8), 16);
    
    // Trova il nodo nel ring
    let selectedNode = null;
    for (const node of this.consistentHashRing) {
      if (node.position > keyHashNum) {
        selectedNode = node;
        break;
      }
    }
    
    // Se non è stato trovato un nodo, usa il primo
    if (!selectedNode && this.consistentHashRing.length > 0) {
      selectedNode = this.consistentHashRing[0];
    }
    
    return selectedNode ? selectedNode.shardId : 0;
  }
  
  /**
   * Inizializza il ring per il consistent hashing
   * @private
   */
  _initializeConsistentHashRing() {
    const virtualNodes = this.shardingStrategy.virtualNodes || 100;
    this.consistentHashRing = [];
    
    // Crea nodi virtuali per ogni shard
    for (let shardId = 0; shardId < this.shards.size; shardId++) {
      for (let i = 0; i < virtualNodes; i++) {
        const nodeKey = `shard-${shardId}-vnode-${i}`;
        const hash = crypto.createHash('md5').update(nodeKey).digest('hex');
        const position = parseInt(hash.substring(0, 8), 16);
        
        this.consistentHashRing.push({
          shardId,
          virtualNode: i,
          position
        });
      }
    }
    
    // Ordina il ring per posizione
    this.consistentHashRing.sort((a, b) => a.position - b.position);
    
    this.logger.info('Ring di consistent hashing inizializzato', {
      shardCount: this.shards.size,
      virtualNodesPerShard: virtualNodes,
      totalNodes: this.consistentHashRing.length
    });
  }
  
  /**
   * Esegue una query su uno shard specifico
   * @param {number} shardId - ID dello shard
   * @param {string} query - Query SQL
   * @param {Array} params - Parametri della query
   * @returns {Promise<Object>} Risultato della query
   */
  async queryOnShard(shardId, query, params = []) {
    try {
      // Verifica che lo shard esista
      if (!this.shards.has(shardId)) {
        throw new Error(`Shard ${shardId} non trovato`);
      }
      
      const shard = this.shards.get(shardId);
      
      // Esegui la query
      const startTime = Date.now();
      const result = await shard.pool.query(query, params);
      const duration = Date.now() - startTime;
      
      this.logger.debug('Query eseguita su shard', {
        shardId,
        query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
        rowCount: result.rowCount,
        duration
      });
      
      return result;
    } catch (error) {
      this.logger.error('Errore nell\'esecuzione della query su shard', {
        error: error.message,
        shardId,
        query: query.substring(0, 100) + (query.length > 100 ? '...' : '')
      });
      throw error;
    }
  }
  
  /**
   * Esegue una query su tutti gli shard
   * @param {string} query - Query SQL
   * @param {Array} params - Parametri della query
   * @returns {Promise<Array>} Risultati della query per ogni shard
   */
  async queryAllShards(query, params = []) {
    try {
      const results = [];
      
      // Esegui la query su ogni shard
      for (const [shardId, shard] of this.shards.entries()) {
        try {
          const result = await this.queryOnShard(shardId, query, params);
          results.push({
            shardId,
            result
          });
        } catch (error) {
          this.logger.error('Errore nell\'esecuzione della query su shard', {
            error: error.message,
            shardId,
            query: query.substring(0, 100) + (query.length > 100 ? '...' : '')
          });
          
          // Aggiungi un risultato di errore
          results.push({
            shardId,
            error: error.message
          });
        }
      }
      
      this.logger.info('Query eseguita su tutti gli shard', {
        shardCount: this.shards.size,
        successCount: results.filter(r => !r.error).length
      });
      
      return results;
    } catch (error) {
      this.logger.error('Errore nell\'esecuzione della query su tutti gli shard', {
        error: error.message,
        query: query.substring(0, 100) + (query.length > 100 ? '...' : '')
      });
      throw error;
    }
  }
  
  /**
   * Esegue una query su uno shard determinato dalla chiave
   * @param {string|number|Object} key - Chiave di sharding
   * @param {string} query - Query SQL
   * @param {Array} params - Parametri della query
   * @returns {Promise<Object>} Risultato della query
   */
  async queryByKey(key, query, params = []) {
    try {
      // Determina lo shard per la chiave
      const shardId = this.getShardForKey(key);
      
      // Esegui la query sullo shard
      return await this.queryOnShard(shardId, query, params);
    } catch (error) {
      this.logger.error('Errore nell\'esecuzione della query per chiave', {
        error: error.message,
        key: typeof key === 'object' ? JSON.stringify(key) : key,
        query: query.substring(0, 100) + (query.length > 100 ? '...' : '')
      });
      throw error;
    }
  }
  
  /**
   * Esegue una transazione su uno shard specifico
   * @param {number} shardId - ID dello shard
   * @param {Function} callback - Funzione di callback che riceve un client e deve restituire una Promise
   * @returns {Promise<any>} Risultato della transazione
   */
  async transactionOnShard(shardId, callback) {
    try {
      // Verifica che lo shard esista
      if (!this.shards.has(shardId)) {
        throw new Error(`Shard ${shardId} non trovato`);
      }
      
      const shard = this.shards.get(shardId);
      const client = await shard.pool.connect();
      
      try {
        // Inizia la transazione
        await client.query('BEGIN');
        
        // Esegui il callback
        const result = await callback(client);
        
        // Commit della transazione
        await client.query('COMMIT');
        
        this.logger.debug('Transazione completata su shard', {
          shardId
        });
        
        return result;
      } catch (error) {
        // Rollback della transazione in caso di errore
        await client.query('ROLLBACK');
        
        this.logger.error('Errore nella transazione su shard', {
          error: error.message,
          shardId
        });
        
        throw error;
      } finally {
        // Rilascia il client
        client.release();
      }
    } catch (error) {
      this.logger.error('Errore nell\'esecuzione della transazione su shard', {
        error: error.message,
        shardId
      });
      throw error;
    }
  }
  
  /**
   * Esegue una transazione su uno shard determinato dalla chiave
   * @param {string|number|Object} key - Chiave di sharding
   * @param {Function} callback - Funzione di callback che riceve un client e deve restituire una Promise
   * @returns {Promise<any>} Risultato della transazione
   */
  async transactionByKey(key, callback) {
    try {
      // Determina lo shard per la chiave
      const shardId = this.getShardForKey(key);
      
      // Esegui la transazione sullo shard
      return await this.transactionOnShard(shardId, callback);
    } catch (error) {
      this.logger.error('Errore nell\'esecuzione della transazione per chiave', {
        error: error.message,
        key: typeof key === 'object' ? JSON.stringify(key) : key
      });
      throw error;
    }
  }
  
  /**
   * Esegue una migrazione su tutti gli shard
   * @param {string} migrationFile - Percorso del file di migrazione
   * @returns {Promise<Array>} Risultati della migrazione per ogni shard
   */
  async migrateAllShards(migrationFile) {
    try {
      // Leggi il file di migrazione
      const migrationSql = fs.readFileSync(migrationFile, 'utf8');
      
      // Esegui la migrazione su ogni shard
      const results = [];
      
      for (const [shardId, shard] of this.shards.entries()) {
        try {
          const result = await this.transactionOnShard(shardId, async (client) => {
            return await client.query(migrationSql);
          });
          
          results.push({
            shardId,
            success: true,
            result
          });
          
          this.logger.info('Migrazione completata su shard', {
            shardId,
            migrationFile: path.basename(migrationFile)
          });
        } catch (error) {
          results.push({
            shardId,
            success: false,
            error: error.message
          });
          
          this.logger.error('Errore nella migrazione su shard', {
            error: error.message,
            shardId,
            migrationFile: path.basename(migrationFile)
          });
        }
      }
      
      this.logger.info('Migrazione completata su tutti gli shard', {
        shardCount: this.shards.size,
        successCount: results.filter(r => r.success).length,
        migrationFile: path.basename(migrationFile)
      });
      
      return results;
    } catch (error) {
      this.logger.error('Errore nella migrazione su tutti gli shard', {
        error: error.message,
        migrationFile: path.basename(migrationFile)
      });
      throw error;
    }
  }
  
  /**
   * Verifica lo stato di tutti gli shard
   * @returns {Promise<Array>} Stato di ogni shard
   */
  async checkShardStatus() {
    const results = [];
    
    for (const [shardId, shard] of this.shards.entries()) {
      try {
        // Esegui una query di test
        const startTime = Date.now();
        const result = await shard.pool.query('SELECT 1 AS test');
        const duration = Date.now() - startTime;
        
        results.push({
          shardId,
          status: 'online',
          responseTime: duration,
          host: shard.config.host,
          database: shard.config.database
        });
        
        // Aggiorna lo stato dello shard
        shard.status = 'online';
        shard.lastCheck = Date.now();
        shard.responseTime = duration;
      } catch (error) {
        results.push({
          shardId,
          status: 'offline',
          error: error.message,
          host: shard.config.host,
          database: shard.config.database
        });
        
        // Aggiorna lo stato dello shard
        shard.status = 'offline';
        shard.lastCheck = Date.now();
        shard.lastError = error.message;
        
        this.logger.error('Shard non disponibile', {
          error: error.message,
          shardId,
          host: shard.config.host,
          database: shard.config.database
        });
      }
    }
    
    this.logger.info('Controllo stato shard completato', {
      shardCount: this.shards.size,
      onlineCount: results.filter(r => r.status === 'online').length
    });
    
    return results;
  }
  
  /**
   * Ottiene statistiche sugli shard
   * @returns {Promise<Object>} Statistiche sugli shard
   */
  async getShardStats() {
    const stats = {
      totalShards: this.shards.size,
      onlineShards: 0,
      offlineShards: 0,
      shardDetails: []
    };
    
    for (const [shardId, shard] of this.shards.entries()) {
      try {
        // Esegui una query per ottenere statistiche
        const result = await shard.pool.query(`
          SELECT
            (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS active_connections,
            pg_database_size(current_database()) AS database_size
        `);
        
        const shardStats = {
          shardId,
          status: 'online',
          host: shard.config.host,
          database: shard.config.database,
          activeConnections: parseInt(result.rows[0].active_connections),
          databaseSize: parseInt(result.rows[0].database_size),
          responseTime: shard.responseTime || 0,
          lastCheck: shard.lastCheck || 0
        };
        
        stats.shardDetails.push(shardStats);
        stats.onlineShards++;
      } catch (error) {
        const shardStats = {
          shardId,
          status: 'offline',
          host: shard.config.host,
          database: shard.config.database,
          error: error.message,
          lastCheck: shard.lastCheck || 0,
          lastError: shard.lastError || error.message
        };
        
        stats.shardDetails.push(shardStats);
        stats.offlineShards++;
        
        this.logger.error('Errore nell\'ottenere statistiche dello shard', {
          error: error.message,
          shardId,
          host: shard.config.host,
          database: shard.config.database
        });
      }
    }
    
    this.logger.info('Statistiche shard ottenute', {
      totalShards: stats.totalShards,
      onlineShards: stats.onlineShards,
      offlineShards: stats.offlineShards
    });
    
    return stats;
  }
  
  /**
   * Chiude tutte le connessioni agli shard
   * @returns {Promise<void>}
   */
  async close() {
    for (const [shardId, shard] of this.shards.entries()) {
      try {
        await shard.pool.end();
        
        this.logger.info('Connessione allo shard chiusa', {
          shardId,
          host: shard.config.host,
          database: shard.config.database
        });
      } catch (error) {
        this.logger.error('Errore nella chiusura della connessione allo shard', {
          error: error.message,
          shardId,
          host: shard.config.host,
          database: shard.config.database
        });
      }
    }
    
    this.logger.info('Tutte le connessioni agli shard chiuse');
  }
}

module.exports = DatabaseShardingManager;
