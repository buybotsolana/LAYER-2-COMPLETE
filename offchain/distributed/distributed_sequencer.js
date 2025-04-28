/**
 * @fileoverview Implementazione di un sistema di sequencer distribuito basato su Raft
 * 
 * Questo modulo implementa un sistema di sequencer distribuito che utilizza
 * l'algoritmo di consenso Raft per l'elezione del leader e la replicazione dello stato.
 * Garantisce alta disponibilità e coerenza dei dati in un ambiente distribuito.
 */

const EventEmitter = require('events');
const { Logger } = require('../logger');
const { RaftConsensus } = require('./raft_consensus');
const { StateReplication } = require('./state_replication');
const { ReplicationLog } = require('./replication_log');
const { StateStore } = require('./state_store');

// Configurazione del logger
const logger = new Logger('distributed-sequencer');

/**
 * Classe DistributedSequencer
 * 
 * Implementa un sequencer distribuito che utilizza l'algoritmo di consenso Raft
 * per l'elezione del leader e la replicazione dello stato.
 */
class DistributedSequencer extends EventEmitter {
  /**
   * Crea una nuova istanza di DistributedSequencer
   * @param {Object} config - Configurazione del sequencer distribuito
   * @param {string} config.nodeId - Identificatore univoco del nodo
   * @param {Array<string>} config.peers - Lista degli indirizzi dei peer
   * @param {Object} config.raftConfig - Configurazione per il consenso Raft
   * @param {Object} config.stateConfig - Configurazione per la gestione dello stato
   * @param {Object} config.sequencerConfig - Configurazione per il sequencer
   */
  constructor(config) {
    super();
    this.nodeId = config.nodeId;
    this.peers = config.peers;
    this.isLeader = false;
    this.sequencer = null;
    this.config = config;
    
    // Inizializza il consenso Raft
    this.raftConsensus = new RaftConsensus({
      nodeId: this.nodeId,
      peers: this.peers,
      electionTimeoutMin: config.raftConfig?.electionTimeoutMin || 150,
      electionTimeoutMax: config.raftConfig?.electionTimeoutMax || 300,
      heartbeatInterval: config.raftConfig?.heartbeatInterval || 50,
      logPath: config.raftConfig?.logPath || './logs/raft',
      snapshotInterval: config.raftConfig?.snapshotInterval || 1000,
      snapshotThreshold: config.raftConfig?.snapshotThreshold || 10000
    });
    
    // Inizializza la replicazione dello stato
    this.stateReplication = new StateReplication({
      storeConfig: config.stateConfig?.storeConfig || {},
      logConfig: config.stateConfig?.logConfig || {}
    });
    
    // Configurazione per il sequencer
    this.sequencerConfig = config.sequencerConfig || {};
    
    // Stato del nodo
    this.state = {
      status: 'initialized',
      term: 0,
      lastHeartbeat: Date.now(),
      leaderNodeId: null,
      followers: [],
      metrics: {
        transactionsProcessed: 0,
        batchesSubmitted: 0,
        stateSize: 0,
        lastLeaderElection: null,
        uptime: 0
      }
    };
    
    // Inizializza i listener per gli eventi
    this._setupEventListeners();
    
    logger.info(`DistributedSequencer inizializzato con nodeId: ${this.nodeId}`);
  }
  
  /**
   * Configura i listener per gli eventi del consenso Raft
   * @private
   */
  _setupEventListeners() {
    // Evento quando il nodo diventa leader
    this.raftConsensus.on('leader', this.onBecomeLeader.bind(this));
    
    // Evento quando il nodo diventa follower
    this.raftConsensus.on('follower', this.onBecomeFollower.bind(this));
    
    // Evento quando il nodo riceve un heartbeat dal leader
    this.raftConsensus.on('heartbeat', this.onHeartbeat.bind(this));
    
    // Evento quando il termine Raft cambia
    this.raftConsensus.on('term-change', this.onTermChange.bind(this));
    
    // Evento quando lo stato viene replicato
    this.stateReplication.on('state-replicated', this.onStateReplicated.bind(this));
    
    // Evento quando si verifica un errore
    this.raftConsensus.on('error', this.onError.bind(this));
    this.stateReplication.on('error', this.onError.bind(this));
  }
  
  /**
   * Avvia il sequencer distribuito
   * @returns {Promise<boolean>} True se l'avvio è riuscito
   */
  async start() {
    try {
      logger.info(`Avvio DistributedSequencer (nodeId: ${this.nodeId})`);
      
      // Avvia il consenso Raft
      await this.raftConsensus.start();
      
      // Avvia la replicazione dello stato
      await this.stateReplication.start();
      
      // Aggiorna lo stato
      this.state.status = 'running';
      this.state.startTime = Date.now();
      
      // Emetti evento di avvio
      this.emit('started', {
        nodeId: this.nodeId,
        timestamp: Date.now(),
        state: this.state
      });
      
      // Avvia il timer per le metriche
      this._startMetricsTimer();
      
      logger.info(`DistributedSequencer avviato con successo (nodeId: ${this.nodeId})`);
      return true;
    } catch (error) {
      logger.error(`Errore durante l'avvio del DistributedSequencer: ${error.message}`);
      this.state.status = 'error';
      this.emit('error', error);
      throw error;
    }
  }
  
  /**
   * Arresta il sequencer distribuito
   * @returns {Promise<boolean>} True se l'arresto è riuscito
   */
  async stop() {
    try {
      logger.info(`Arresto DistributedSequencer (nodeId: ${this.nodeId})`);
      
      // Se siamo leader, ferma il sequencer
      if (this.isLeader && this.sequencer) {
        await this.sequencer.stop();
        this.sequencer = null;
      }
      
      // Arresta il consenso Raft
      await this.raftConsensus.stop();
      
      // Arresta la replicazione dello stato
      await this.stateReplication.stop();
      
      // Aggiorna lo stato
      this.state.status = 'stopped';
      
      // Emetti evento di arresto
      this.emit('stopped', {
        nodeId: this.nodeId,
        timestamp: Date.now(),
        state: this.state
      });
      
      // Ferma il timer per le metriche
      if (this.metricsTimer) {
        clearInterval(this.metricsTimer);
        this.metricsTimer = null;
      }
      
      logger.info(`DistributedSequencer arrestato con successo (nodeId: ${this.nodeId})`);
      return true;
    } catch (error) {
      logger.error(`Errore durante l'arresto del DistributedSequencer: ${error.message}`);
      this.state.status = 'error';
      this.emit('error', error);
      throw error;
    }
  }
  
  /**
   * Callback chiamato quando il nodo diventa leader
   * @private
   */
  async onBecomeLeader() {
    try {
      logger.info(`Nodo ${this.nodeId} è diventato leader per il termine ${this.raftConsensus.currentTerm}`);
      
      // Aggiorna lo stato
      this.isLeader = true;
      this.state.status = 'leader';
      this.state.leaderNodeId = this.nodeId;
      this.state.lastLeaderElection = Date.now();
      
      // Inizializza il sequencer
      const UltraOptimizedSequencer = require('../sequencer');
      this.sequencer = new UltraOptimizedSequencer(this.sequencerConfig);
      
      // Avvia il sequencer
      await this.sequencer.initialize();
      
      // Configura i listener per gli eventi del sequencer
      this._setupSequencerListeners();
      
      // Emetti evento di cambio ruolo
      this.emit('role-change', {
        nodeId: this.nodeId,
        role: 'leader',
        term: this.raftConsensus.currentTerm,
        timestamp: Date.now()
      });
      
      // Aggiorna la lista dei follower
      this.state.followers = this.peers.filter(peer => peer !== this.nodeId);
      
      logger.info(`Sequencer avviato come leader (nodeId: ${this.nodeId})`);
    } catch (error) {
      logger.error(`Errore durante l'inizializzazione come leader: ${error.message}`);
      this.isLeader = false;
      this.state.status = 'error';
      this.emit('error', error);
    }
  }
  
  /**
   * Callback chiamato quando il nodo diventa follower
   * @private
   */
  async onBecomeFollower() {
    try {
      logger.info(`Nodo ${this.nodeId} è diventato follower per il termine ${this.raftConsensus.currentTerm}`);
      
      // Aggiorna lo stato
      this.isLeader = false;
      this.state.status = 'follower';
      
      // Se il sequencer è in esecuzione, fermalo
      if (this.sequencer) {
        await this.sequencer.stop();
        this.sequencer = null;
      }
      
      // Emetti evento di cambio ruolo
      this.emit('role-change', {
        nodeId: this.nodeId,
        role: 'follower',
        term: this.raftConsensus.currentTerm,
        timestamp: Date.now()
      });
      
      logger.info(`Sequencer fermato come follower (nodeId: ${this.nodeId})`);
    } catch (error) {
      logger.error(`Errore durante la transizione a follower: ${error.message}`);
      this.state.status = 'error';
      this.emit('error', error);
    }
  }
  
  /**
   * Callback chiamato quando il nodo riceve un heartbeat dal leader
   * @param {Object} data - Dati del heartbeat
   * @private
   */
  onHeartbeat(data) {
    // Aggiorna lo stato
    this.state.lastHeartbeat = Date.now();
    this.state.leaderNodeId = data.leaderId;
    
    // Emetti evento di heartbeat
    this.emit('heartbeat', {
      nodeId: this.nodeId,
      leaderId: data.leaderId,
      term: data.term,
      timestamp: Date.now()
    });
  }
  
  /**
   * Callback chiamato quando il termine Raft cambia
   * @param {Object} data - Dati del cambio di termine
   * @private
   */
  onTermChange(data) {
    // Aggiorna lo stato
    this.state.term = data.term;
    
    // Emetti evento di cambio termine
    this.emit('term-change', {
      nodeId: this.nodeId,
      term: data.term,
      timestamp: Date.now()
    });
  }
  
  /**
   * Callback chiamato quando lo stato viene replicato
   * @param {Object} data - Dati della replicazione
   * @private
   */
  onStateReplicated(data) {
    // Aggiorna le metriche
    this.state.metrics.stateSize = data.stateSize;
    
    // Emetti evento di replicazione
    this.emit('state-replicated', {
      nodeId: this.nodeId,
      logIndex: data.logIndex,
      stateSize: data.stateSize,
      timestamp: Date.now()
    });
  }
  
  /**
   * Callback chiamato quando si verifica un errore
   * @param {Error} error - Errore verificatosi
   * @private
   */
  onError(error) {
    logger.error(`Errore nel DistributedSequencer: ${error.message}`);
    
    // Emetti evento di errore
    this.emit('error', {
      nodeId: this.nodeId,
      error: error.message,
      stack: error.stack,
      timestamp: Date.now()
    });
  }
  
  /**
   * Configura i listener per gli eventi del sequencer
   * @private
   */
  _setupSequencerListeners() {
    if (!this.sequencer) return;
    
    // Evento quando una transazione viene elaborata
    this.sequencer.on('transaction-processed', async (data) => {
      // Aggiorna le metriche
      this.state.metrics.transactionsProcessed++;
      
      // Replica la transazione ai follower
      if (this.isLeader) {
        try {
          await this.stateReplication.applyTransaction(data);
        } catch (error) {
          logger.error(`Errore durante la replicazione della transazione: ${error.message}`);
        }
      }
    });
    
    // Evento quando un batch viene inviato
    this.sequencer.on('batch-submitted', (data) => {
      // Aggiorna le metriche
      this.state.metrics.batchesSubmitted++;
    });
  }
  
  /**
   * Avvia il timer per l'aggiornamento delle metriche
   * @private
   */
  _startMetricsTimer() {
    // Aggiorna le metriche ogni 10 secondi
    this.metricsTimer = setInterval(() => {
      // Calcola l'uptime
      this.state.metrics.uptime = Math.floor((Date.now() - this.state.startTime) / 1000);
      
      // Emetti evento di metriche
      this.emit('metrics', {
        nodeId: this.nodeId,
        metrics: this.state.metrics,
        timestamp: Date.now()
      });
    }, 10000);
  }
  
  /**
   * Applica una transazione al sistema distribuito
   * @param {Object} transaction - Transazione da applicare
   * @returns {Promise<Object>} Risultato dell'applicazione
   */
  async applyTransaction(transaction) {
    try {
      // Se siamo leader, elabora la transazione direttamente
      if (this.isLeader && this.sequencer) {
        const result = await this.sequencer.processTransaction(transaction);
        
        // Replica la transazione ai follower
        await this.stateReplication.applyTransaction(transaction);
        
        return result;
      } else if (this.state.leaderNodeId) {
        // Se non siamo leader, inoltra la transazione al leader
        logger.info(`Inoltro transazione al leader ${this.state.leaderNodeId}`);
        
        // Implementazione dell'inoltro al leader
        // Nella versione reale, questo invierebbe la transazione al leader tramite RPC
        throw new Error('Inoltro al leader non ancora implementato');
      } else {
        throw new Error('Nessun leader disponibile per elaborare la transazione');
      }
    } catch (error) {
      logger.error(`Errore durante l'applicazione della transazione: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Sincronizza un nuovo nodo con lo stato corrente
   * @param {string} nodeId - ID del nodo da sincronizzare
   * @returns {Promise<boolean>} True se la sincronizzazione è riuscita
   */
  async syncNewNode(nodeId) {
    try {
      logger.info(`Sincronizzazione del nodo ${nodeId}`);
      
      // Verifica che siamo leader
      if (!this.isLeader) {
        throw new Error('Solo il leader può sincronizzare nuovi nodi');
      }
      
      // Ottieni l'ultimo indice del log
      const lastIndex = await this.stateReplication.replicationLog.getLastIndex();
      
      // Crea uno snapshot dello stato corrente
      const snapshot = await this.stateReplication.stateStore.createSnapshot();
      
      // Invia lo snapshot al nuovo nodo
      await this.sendSnapshot(nodeId, snapshot);
      
      // Ottieni le entry mancanti dopo lo snapshot
      const missingEntries = await this.stateReplication.replicationLog.getEntriesAfter(
        snapshot.lastIncludedIndex
      );
      
      // Invia le entry mancanti al nuovo nodo
      await this.sendEntries(nodeId, missingEntries);
      
      logger.info(`Sincronizzazione del nodo ${nodeId} completata con successo`);
      return true;
    } catch (error) {
      logger.error(`Errore durante la sincronizzazione del nodo ${nodeId}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Invia uno snapshot a un nodo
   * @param {string} nodeId - ID del nodo destinatario
   * @param {Object} snapshot - Snapshot da inviare
   * @private
   */
  async sendSnapshot(nodeId, snapshot) {
    // Implementazione dell'invio dello snapshot
    // Nella versione reale, questo invierebbe lo snapshot al nodo tramite RPC
    logger.info(`Invio snapshot al nodo ${nodeId} (lastIncludedIndex: ${snapshot.lastIncludedIndex})`);
    
    // Simulazione dell'invio
    return new Promise((resolve) => {
      setTimeout(() => {
        logger.info(`Snapshot inviato al nodo ${nodeId}`);
        resolve(true);
      }, 100);
    });
  }
  
  /**
   * Invia entry del log a un nodo
   * @param {string} nodeId - ID del nodo destinatario
   * @param {Array<Object>} entries - Entry da inviare
   * @private
   */
  async sendEntries(nodeId, entries) {
    // Implementazione dell'invio delle entry
    // Nella versione reale, questo invierebbe le entry al nodo tramite RPC
    logger.info(`Invio ${entries.length} entry al nodo ${nodeId}`);
    
    // Simulazione dell'invio
    return new Promise((resolve) => {
      setTimeout(() => {
        logger.info(`Entry inviate al nodo ${nodeId}`);
        resolve(true);
      }, 100);
    });
  }
  
  /**
   * Ottiene lo stato corrente del sequencer distribuito
   * @returns {Object} Stato corrente
   */
  getStatus() {
    return {
      nodeId: this.nodeId,
      isLeader: this.isLeader,
      status: this.state.status,
      term: this.state.term,
      leaderNodeId: this.state.leaderNodeId,
      lastHeartbeat: this.state.lastHeartbeat,
      metrics: this.state.metrics,
      peers: this.peers,
      timestamp: Date.now()
    };
  }
}

module.exports = { DistributedSequencer };
