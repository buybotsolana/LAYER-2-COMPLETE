/**
 * @fileoverview Implementazione del sistema di replicazione dello stato
 * 
 * Questo modulo implementa un sistema di replicazione dello stato per il sequencer distribuito,
 * garantendo che tutti i nodi mantengano una visione coerente dello stato del sistema.
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { Logger } = require('../logger');
const { ReplicationLog } = require('./replication_log');
const { StateStore } = require('./state_store');

// Configurazione del logger
const logger = new Logger('state-replication');

/**
 * Classe StateReplication
 * 
 * Implementa un sistema di replicazione dello stato per il sequencer distribuito,
 * garantendo che tutti i nodi mantengano una visione coerente dello stato del sistema.
 */
class StateReplication extends EventEmitter {
  /**
   * Crea una nuova istanza di StateReplication
   * @param {Object} config - Configurazione per la replicazione dello stato
   * @param {Object} config.storeConfig - Configurazione per lo StateStore
   * @param {Object} config.logConfig - Configurazione per il ReplicationLog
   */
  constructor(config) {
    super();
    this.config = config;
    this.isLeader = false;
    this.followers = [];
    this.stateStore = new StateStore(config.storeConfig || {});
    this.replicationLog = new ReplicationLog(config.logConfig || {});
    this.running = false;
    
    // Metriche
    this.metrics = {
      transactionsApplied: 0,
      replicationRequests: 0,
      replicationSuccesses: 0,
      replicationFailures: 0,
      snapshotsCreated: 0,
      snapshotsSent: 0,
      stateSize: 0
    };
    
    logger.info('StateReplication inizializzato');
  }
  
  /**
   * Avvia il sistema di replicazione dello stato
   * @returns {Promise<boolean>} True se l'avvio è riuscito
   */
  async start() {
    try {
      logger.info('Avvio StateReplication');
      
      // Inizializza lo StateStore
      await this.stateStore.initialize();
      
      // Inizializza il ReplicationLog
      await this.replicationLog.initialize();
      
      // Imposta il flag running
      this.running = true;
      
      // Aggiorna le metriche
      this.metrics.stateSize = await this.stateStore.getStateSize();
      
      logger.info('StateReplication avviato con successo');
      return true;
    } catch (error) {
      logger.error(`Errore durante l'avvio di StateReplication: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Arresta il sistema di replicazione dello stato
   * @returns {Promise<boolean>} True se l'arresto è riuscito
   */
  async stop() {
    try {
      logger.info('Arresto StateReplication');
      
      // Arresta lo StateStore
      await this.stateStore.close();
      
      // Arresta il ReplicationLog
      await this.replicationLog.close();
      
      // Imposta il flag running
      this.running = false;
      
      logger.info('StateReplication arrestato con successo');
      return true;
    } catch (error) {
      logger.error(`Errore durante l'arresto di StateReplication: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Imposta il nodo come leader
   * @param {Array<string>} followers - Lista degli ID dei follower
   */
  setAsLeader(followers) {
    this.isLeader = true;
    this.followers = followers || [];
    logger.info(`Impostato come leader con ${this.followers.length} follower`);
  }
  
  /**
   * Imposta il nodo come follower
   */
  setAsFollower() {
    this.isLeader = false;
    this.followers = [];
    logger.info('Impostato come follower');
  }
  
  /**
   * Applica una transazione allo stato
   * @param {Object} transaction - Transazione da applicare
   * @returns {Promise<Object>} Risultato dell'applicazione
   */
  async applyTransaction(transaction) {
    try {
      logger.debug(`Applicazione transazione: ${JSON.stringify(transaction)}`);
      
      // Aggiungi la transazione al log di replicazione
      const logEntry = await this.replicationLog.append(transaction);
      
      // Se siamo leader, replica la transazione ai follower
      if (this.isLeader) {
        await this.replicateToFollowers(logEntry);
      }
      
      // Applica la transazione allo stato
      const result = await this.stateStore.apply(transaction);
      
      // Aggiorna le metriche
      this.metrics.transactionsApplied++;
      this.metrics.stateSize = await this.stateStore.getStateSize();
      
      // Emetti evento di transazione applicata
      this.emit('transaction-applied', {
        transaction,
        result,
        logIndex: logEntry.index,
        timestamp: Date.now()
      });
      
      // Emetti evento di stato replicato
      this.emit('state-replicated', {
        logIndex: logEntry.index,
        stateSize: this.metrics.stateSize,
        timestamp: Date.now()
      });
      
      logger.debug(`Transazione applicata con successo: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      logger.error(`Errore durante l'applicazione della transazione: ${error.message}`);
      
      // Emetti evento di errore
      this.emit('error', {
        error: error.message,
        transaction,
        timestamp: Date.now()
      });
      
      throw error;
    }
  }
  
  /**
   * Replica una transazione a tutti i follower
   * @param {Object} logEntry - Entry del log da replicare
   * @returns {Promise<Object>} Risultato della replicazione
   */
  async replicateToFollowers(logEntry) {
    try {
      logger.debug(`Replicazione entry ${logEntry.index} a ${this.followers.length} follower`);
      
      // Aggiorna le metriche
      this.metrics.replicationRequests += this.followers.length;
      
      // Crea le promesse per la replicazione a ciascun follower
      const promises = this.followers.map(followerId => 
        this.replicateToFollower(followerId, logEntry)
      );
      
      // Attendi che tutte le replicazioni siano completate
      const results = await Promise.allSettled(promises);
      
      // Conta i successi e i fallimenti
      const successes = results.filter(r => r.status === 'fulfilled' && r.value).length;
      const failures = this.followers.length - successes;
      
      // Aggiorna le metriche
      this.metrics.replicationSuccesses += successes;
      this.metrics.replicationFailures += failures;
      
      logger.debug(`Replicazione completata: ${successes} successi, ${failures} fallimenti`);
      
      return {
        successes,
        failures,
        total: this.followers.length
      };
    } catch (error) {
      logger.error(`Errore durante la replicazione ai follower: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Replica una transazione a un follower specifico
   * @param {string} followerId - ID del follower
   * @param {Object} logEntry - Entry del log da replicare
   * @returns {Promise<boolean>} True se la replicazione è riuscita
   */
  async replicateToFollower(followerId, logEntry) {
    try {
      logger.debug(`Replicazione entry ${logEntry.index} al follower ${followerId}`);
      
      // Nella versione reale, questo invierebbe una richiesta RPC al follower
      // Per ora, simuliamo una risposta
      
      // Simula un ritardo di rete (10-50ms)
      await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 40));
      
      // Simula una risposta con 95% di probabilità di successo
      const success = Math.random() < 0.95;
      
      if (success) {
        logger.debug(`Replicazione al follower ${followerId} riuscita`);
      } else {
        logger.warn(`Replicazione al follower ${followerId} fallita`);
      }
      
      return success;
    } catch (error) {
      logger.error(`Errore durante la replicazione al follower ${followerId}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Crea uno snapshot dello stato corrente
   * @returns {Promise<Object>} Snapshot creato
   */
  async createSnapshot() {
    try {
      logger.info('Creazione snapshot dello stato');
      
      // Crea uno snapshot dello stato
      const snapshot = await this.stateStore.createSnapshot();
      
      // Aggiorna le metriche
      this.metrics.snapshotsCreated++;
      
      logger.info(`Snapshot creato con successo (lastIncludedIndex: ${snapshot.lastIncludedIndex})`);
      
      return snapshot;
    } catch (error) {
      logger.error(`Errore durante la creazione dello snapshot: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Invia uno snapshot a un nodo
   * @param {string} nodeId - ID del nodo destinatario
   * @param {Object} snapshot - Snapshot da inviare
   * @returns {Promise<boolean>} True se l'invio è riuscito
   */
  async sendSnapshot(nodeId, snapshot) {
    try {
      logger.info(`Invio snapshot al nodo ${nodeId} (lastIncludedIndex: ${snapshot.lastIncludedIndex})`);
      
      // Nella versione reale, questo invierebbe lo snapshot al nodo tramite RPC
      // Per ora, simuliamo una risposta
      
      // Simula un ritardo di rete (100-500ms per snapshot grandi)
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 400));
      
      // Simula una risposta con 90% di probabilità di successo
      const success = Math.random() < 0.9;
      
      if (success) {
        // Aggiorna le metriche
        this.metrics.snapshotsSent++;
        
        logger.info(`Snapshot inviato con successo al nodo ${nodeId}`);
      } else {
        logger.warn(`Invio snapshot al nodo ${nodeId} fallito`);
      }
      
      return success;
    } catch (error) {
      logger.error(`Errore durante l'invio dello snapshot al nodo ${nodeId}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Applica uno snapshot ricevuto
   * @param {Object} snapshot - Snapshot da applicare
   * @returns {Promise<boolean>} True se l'applicazione è riuscita
   */
  async applySnapshot(snapshot) {
    try {
      logger.info(`Applicazione snapshot (lastIncludedIndex: ${snapshot.lastIncludedIndex})`);
      
      // Applica lo snapshot allo stato
      await this.stateStore.applySnapshot(snapshot);
      
      // Aggiorna il log di replicazione
      await this.replicationLog.truncateUntil(snapshot.lastIncludedIndex);
      
      // Aggiorna le metriche
      this.metrics.stateSize = await this.stateStore.getStateSize();
      
      logger.info('Snapshot applicato con successo');
      
      // Emetti evento di snapshot applicato
      this.emit('snapshot-applied', {
        lastIncludedIndex: snapshot.lastIncludedIndex,
        stateSize: this.metrics.stateSize,
        timestamp: Date.now()
      });
      
      return true;
    } catch (error) {
      logger.error(`Errore durante l'applicazione dello snapshot: ${error.message}`);
      
      // Emetti evento di errore
      this.emit('error', {
        error: error.message,
        operation: 'apply-snapshot',
        timestamp: Date.now()
      });
      
      throw error;
    }
  }
  
  /**
   * Ottiene lo stato corrente del sistema di replicazione
   * @returns {Object} Stato corrente
   */
  getStatus() {
    return {
      isLeader: this.isLeader,
      followers: this.followers,
      running: this.running,
      metrics: this.metrics,
      logSize: this.replicationLog.getSize(),
      stateSize: this.metrics.stateSize,
      timestamp: Date.now()
    };
  }
}

/**
 * Classe ReplicationLog
 * 
 * Implementa un log di replicazione per il sistema di replicazione dello stato.
 */
class ReplicationLog {
  /**
   * Crea una nuova istanza di ReplicationLog
   * @param {Object} config - Configurazione per il log di replicazione
   * @param {string} config.logPath - Percorso per il salvataggio del log
   * @param {number} config.syncInterval - Intervallo per la sincronizzazione su disco (ms)
   */
  constructor(config) {
    this.config = config;
    this.logPath = config.logPath || './logs/replication';
    this.syncInterval = config.syncInterval || 1000;
    this.log = [];
    this.lastIndex = -1;
    this.syncTimer = null;
    
    logger.info('ReplicationLog inizializzato');
  }
  
  /**
   * Inizializza il log di replicazione
   * @returns {Promise<boolean>} True se l'inizializzazione è riuscita
   */
  async initialize() {
    try {
      logger.info('Inizializzazione ReplicationLog');
      
      // Crea la directory per i log se non esiste
      await fs.mkdir(this.logPath, { recursive: true });
      
      // Carica il log dal disco
      await this._loadLog();
      
      // Avvia il timer per la sincronizzazione
      this._startSyncTimer();
      
      logger.info(`ReplicationLog inizializzato con ${this.log.length} entry`);
      return true;
    } catch (error) {
      logger.error(`Errore durante l'inizializzazione del ReplicationLog: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Chiude il log di replicazione
   * @returns {Promise<boolean>} True se la chiusura è riuscita
   */
  async close() {
    try {
      logger.info('Chiusura ReplicationLog');
      
      // Ferma il timer per la sincronizzazione
      this._stopSyncTimer();
      
      // Salva il log su disco
      await this._saveLog();
      
      logger.info('ReplicationLog chiuso con successo');
      return true;
    } catch (error) {
      logger.error(`Errore durante la chiusura del ReplicationLog: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Aggiunge una transazione al log
   * @param {Object} transaction - Transazione da aggiungere
   * @returns {Promise<Object>} Entry aggiunta
   */
  async append(transaction) {
    try {
      // Crea una nuova entry
      const entry = {
        index: this.lastIndex + 1,
        transaction,
        timestamp: Date.now()
      };
      
      // Aggiungi l'entry al log
      this.log.push(entry);
      this.lastIndex = entry.index;
      
      logger.debug(`Aggiunta entry ${entry.index} al log`);
      
      return entry;
    } catch (error) {
      logger.error(`Errore durante l'aggiunta di un'entry al log: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Ottiene le entry dopo un certo indice
   * @param {number} index - Indice di partenza
   * @returns {Promise<Array<Object>>} Entry trovate
   */
  async getEntriesAfter(index) {
    try {
      // Verifica che l'indice sia valido
      if (index < -1 || index > this.lastIndex) {
        throw new Error(`Indice non valido: ${index}`);
      }
      
      // Ottieni le entry dopo l'indice specificato
      const entries = this.log.filter(entry => entry.index > index);
      
      logger.debug(`Ottenute ${entries.length} entry dopo l'indice ${index}`);
      
      return entries;
    } catch (error) {
      logger.error(`Errore durante l'ottenimento delle entry dopo l'indice ${index}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Tronca il log fino a un certo indice
   * @param {number} index - Indice fino al quale troncare
   * @returns {Promise<boolean>} True se la troncatura è riuscita
   */
  async truncateUntil(index) {
    try {
      // Verifica che l'indice sia valido
      if (index < -1 || index > this.lastIndex) {
        throw new Error(`Indice non valido: ${index}`);
      }
      
      // Tronca il log
      this.log = this.log.filter(entry => entry.index > index);
      
      logger.info(`Log troncato fino all'indice ${index}, ${this.log.length} entry rimanenti`);
      
      return true;
    } catch (error) {
      logger.error(`Errore durante la troncatura del log fino all'indice ${index}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Ottiene l'ultimo indice del log
   * @returns {number} Ultimo indice
   */
  getLastIndex() {
    return this.lastIndex;
  }
  
  /**
   * Ottiene la dimensione del log
   * @returns {number} Numero di entry nel log
   */
  getSize() {
    return this.log.length;
  }
  
  /**
   * Carica il log dal disco
   * @private
   */
  async _loadLog() {
    try {
      const logFile = path.join(this.logPath, 'replication-log.json');
      
      try {
        const data = await fs.readFile(logFile, 'utf8');
        this.log = JSON.parse(data);
        this.lastIndex = this.log.length > 0 ? this.log[this.log.length - 1].index : -1;
      } catch (error) {
        // Se il file non esiste, usa un array vuoto
        if (error.code === 'ENOENT') {
          this.log = [];
          this.lastIndex = -1;
        } else {
          throw error;
        }
      }
    } catch (error) {
      logger.error(`Errore durante il caricamento del log: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Salva il log su disco
   * @private
   */
  async _saveLog() {
    try {
      const logFile = path.join(this.logPath, 'replication-log.json');
      await fs.writeFile(logFile, JSON.stringify(this.log, null, 2));
      logger.debug(`Log salvato su disco (${this.log.length} entry)`);
    } catch (error) {
      logger.error(`Errore durante il salvataggio del log: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Avvia il timer per la sincronizzazione
   * @private
   */
  _startSyncTimer() {
    this.syncTimer = setInterval(async () => {
      try {
        await this._saveLog();
      } catch (error) {
        logger.error(`Errore durante la sincronizzazione del log: ${error.message}`);
      }
    }, this.syncInterval);
  }
  
  /**
   * Ferma il timer per la sincronizzazione
   * @private
   */
  _stopSyncTimer() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }
}

/**
 * Classe StateStore
 * 
 * Implementa un archivio per lo stato del sistema.
 */
class StateStore {
  /**
   * Crea una nuova istanza di StateStore
   * @param {Object} config - Configurazione per lo StateStore
   * @param {string} config.storePath - Percorso per il salvataggio dello stato
   * @param {number} config.syncInterval - Intervallo per la sincronizzazione su disco (ms)
   */
  constructor(config) {
    this.config = config;
    this.storePath = config.storePath || './data/state';
    this.syncInterval = config.syncInterval || 5000;
    this.state = {};
    this.syncTimer = null;
    this.lastSyncTime = 0;
    this.dirty = false;
    
    logger.info('StateStore inizializzato');
  }
  
  /**
   * Inizializza lo StateStore
   * @returns {Promise<boolean>} True se l'inizializzazione è riuscita
   */
  async initialize() {
    try {
      logger.info('Inizializzazione StateStore');
      
      // Crea la directory per lo stato se non esiste
      await fs.mkdir(this.storePath, { recursive: true });
      
      // Carica lo stato dal disco
      await this._loadState();
      
      // Avvia il timer per la sincronizzazione
      this._startSyncTimer();
      
      logger.info('StateStore inizializzato con successo');
      return true;
    } catch (error) {
      logger.error(`Errore durante l'inizializzazione dello StateStore: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Chiude lo StateStore
   * @returns {Promise<boolean>} True se la chiusura è riuscita
   */
  async close() {
    try {
      logger.info('Chiusura StateStore');
      
      // Ferma il timer per la sincronizzazione
      this._stopSyncTimer();
      
      // Salva lo stato su disco
      if (this.dirty) {
        await this._saveState();
      }
      
      logger.info('StateStore chiuso con successo');
      return true;
    } catch (error) {
      logger.error(`Errore durante la chiusura dello StateStore: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Applica una transazione allo stato
   * @param {Object} transaction - Transazione da applicare
   * @returns {Promise<Object>} Risultato dell'applicazione
   */
  async apply(transaction) {
    try {
      logger.debug(`Applicazione transazione allo stato: ${JSON.stringify(transaction)}`);
      
      // Implementazione dell'applicazione della transazione
      // Questa è una versione semplificata, l'implementazione reale
      // dipenderà dal design specifico dello stato
      
      // Esempio: aggiorna lo stato in base al tipo di transazione
      if (transaction.type === 'deposit') {
        // Aggiorna il saldo dell'account
        const account = transaction.account || '';
        const amount = transaction.amount || 0;
        
        if (!this.state.accounts) {
          this.state.accounts = {};
        }
        
        if (!this.state.accounts[account]) {
          this.state.accounts[account] = { balance: 0 };
        }
        
        this.state.accounts[account].balance += amount;
        
        logger.debug(`Deposito di ${amount} nell'account ${account}, nuovo saldo: ${this.state.accounts[account].balance}`);
      } else if (transaction.type === 'withdraw') {
        // Aggiorna il saldo dell'account
        const account = transaction.account || '';
        const amount = transaction.amount || 0;
        
        if (!this.state.accounts) {
          this.state.accounts = {};
        }
        
        if (!this.state.accounts[account]) {
          this.state.accounts[account] = { balance: 0 };
        }
        
        if (this.state.accounts[account].balance < amount) {
          throw new Error(`Saldo insufficiente per l'account ${account}`);
        }
        
        this.state.accounts[account].balance -= amount;
        
        logger.debug(`Prelievo di ${amount} dall'account ${account}, nuovo saldo: ${this.state.accounts[account].balance}`);
      } else if (transaction.type === 'transfer') {
        // Trasferimento tra account
        const fromAccount = transaction.fromAccount || '';
        const toAccount = transaction.toAccount || '';
        const amount = transaction.amount || 0;
        
        if (!this.state.accounts) {
          this.state.accounts = {};
        }
        
        if (!this.state.accounts[fromAccount]) {
          this.state.accounts[fromAccount] = { balance: 0 };
        }
        
        if (!this.state.accounts[toAccount]) {
          this.state.accounts[toAccount] = { balance: 0 };
        }
        
        if (this.state.accounts[fromAccount].balance < amount) {
          throw new Error(`Saldo insufficiente per l'account ${fromAccount}`);
        }
        
        this.state.accounts[fromAccount].balance -= amount;
        this.state.accounts[toAccount].balance += amount;
        
        logger.debug(`Trasferimento di ${amount} da ${fromAccount} a ${toAccount}`);
      } else {
        // Tipo di transazione sconosciuto
        logger.warn(`Tipo di transazione sconosciuto: ${transaction.type}`);
      }
      
      // Imposta il flag dirty
      this.dirty = true;
      
      // Risultato dell'applicazione
      const result = {
        success: true,
        timestamp: Date.now()
      };
      
      return result;
    } catch (error) {
      logger.error(`Errore durante l'applicazione della transazione: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Crea uno snapshot dello stato corrente
   * @returns {Promise<Object>} Snapshot creato
   */
  async createSnapshot() {
    try {
      logger.info('Creazione snapshot dello stato');
      
      // Crea lo snapshot
      const snapshot = {
        lastIncludedIndex: 0, // Questo dovrebbe essere fornito dal chiamante
        state: JSON.parse(JSON.stringify(this.state)),
        timestamp: Date.now()
      };
      
      // Salva lo snapshot su disco
      const snapshotFile = path.join(this.storePath, `snapshot-${Date.now()}.json`);
      await fs.writeFile(snapshotFile, JSON.stringify(snapshot, null, 2));
      
      logger.info(`Snapshot creato con successo: ${snapshotFile}`);
      
      return snapshot;
    } catch (error) {
      logger.error(`Errore durante la creazione dello snapshot: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Applica uno snapshot allo stato
   * @param {Object} snapshot - Snapshot da applicare
   * @returns {Promise<boolean>} True se l'applicazione è riuscita
   */
  async applySnapshot(snapshot) {
    try {
      logger.info('Applicazione snapshot allo stato');
      
      // Applica lo snapshot
      this.state = JSON.parse(JSON.stringify(snapshot.state));
      
      // Imposta il flag dirty
      this.dirty = true;
      
      logger.info('Snapshot applicato con successo');
      
      return true;
    } catch (error) {
      logger.error(`Errore durante l'applicazione dello snapshot: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Ottiene la dimensione dello stato
   * @returns {Promise<number>} Dimensione dello stato in byte
   */
  async getStateSize() {
    try {
      // Calcola la dimensione dello stato
      const stateJson = JSON.stringify(this.state);
      return Buffer.byteLength(stateJson, 'utf8');
    } catch (error) {
      logger.error(`Errore durante il calcolo della dimensione dello stato: ${error.message}`);
      return 0;
    }
  }
  
  /**
   * Carica lo stato dal disco
   * @private
   */
  async _loadState() {
    try {
      const stateFile = path.join(this.storePath, 'state.json');
      
      try {
        const data = await fs.readFile(stateFile, 'utf8');
        this.state = JSON.parse(data);
      } catch (error) {
        // Se il file non esiste, usa un oggetto vuoto
        if (error.code === 'ENOENT') {
          this.state = {};
        } else {
          throw error;
        }
      }
      
      logger.info('Stato caricato dal disco');
    } catch (error) {
      logger.error(`Errore durante il caricamento dello stato: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Salva lo stato su disco
   * @private
   */
  async _saveState() {
    try {
      const stateFile = path.join(this.storePath, 'state.json');
      await fs.writeFile(stateFile, JSON.stringify(this.state, null, 2));
      this.lastSyncTime = Date.now();
      this.dirty = false;
      logger.debug('Stato salvato su disco');
    } catch (error) {
      logger.error(`Errore durante il salvataggio dello stato: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Avvia il timer per la sincronizzazione
   * @private
   */
  _startSyncTimer() {
    this.syncTimer = setInterval(async () => {
      try {
        if (this.dirty) {
          await this._saveState();
        }
      } catch (error) {
        logger.error(`Errore durante la sincronizzazione dello stato: ${error.message}`);
      }
    }, this.syncInterval);
  }
  
  /**
   * Ferma il timer per la sincronizzazione
   * @private
   */
  _stopSyncTimer() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }
}

module.exports = { StateReplication, ReplicationLog, StateStore };
