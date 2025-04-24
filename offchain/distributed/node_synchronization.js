/**
 * @fileoverview Implementazione del meccanismo di sincronizzazione per nuovi nodi
 * 
 * Questo modulo implementa un meccanismo di sincronizzazione che permette ai nuovi nodi
 * di unirsi al cluster e sincronizzarsi con lo stato corrente del sistema.
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { Logger } = require('../logger');

// Configurazione del logger
const logger = new Logger('node-synchronization');

/**
 * Classe NodeSynchronization
 * 
 * Implementa un meccanismo di sincronizzazione per nuovi nodi che si uniscono al cluster.
 */
class NodeSynchronization extends EventEmitter {
  /**
   * Crea una nuova istanza di NodeSynchronization
   * @param {Object} config - Configurazione per la sincronizzazione
   * @param {Object} stateReplication - Istanza di StateReplication
   * @param {Object} raftConsensus - Istanza di RaftConsensus
   */
  constructor(config, stateReplication, raftConsensus) {
    super();
    this.config = config;
    this.stateReplication = stateReplication;
    this.raftConsensus = raftConsensus;
    this.syncInProgress = new Map();
    this.syncHistory = [];
    
    // Metriche
    this.metrics = {
      syncRequests: 0,
      syncSuccesses: 0,
      syncFailures: 0,
      snapshotsSent: 0,
      entriesSent: 0,
      avgSyncTimeMs: 0
    };
    
    logger.info('NodeSynchronization inizializzato');
  }
  
  /**
   * Sincronizza un nuovo nodo con lo stato corrente
   * @param {string} nodeId - ID del nodo da sincronizzare
   * @returns {Promise<boolean>} True se la sincronizzazione è riuscita
   */
  async syncNewNode(nodeId) {
    try {
      // Verifica che non ci sia già una sincronizzazione in corso per questo nodo
      if (this.syncInProgress.has(nodeId)) {
        throw new Error(`Sincronizzazione già in corso per il nodo ${nodeId}`);
      }
      
      logger.info(`Avvio sincronizzazione per il nodo ${nodeId}`);
      
      // Aggiorna le metriche
      this.metrics.syncRequests++;
      
      // Registra l'inizio della sincronizzazione
      const syncStart = Date.now();
      this.syncInProgress.set(nodeId, {
        startTime: syncStart,
        status: 'in-progress'
      });
      
      // Emetti evento di sincronizzazione iniziata
      this.emit('sync-started', {
        nodeId,
        timestamp: syncStart
      });
      
      // Ottieni l'ultimo indice del log
      const lastIndex = await this.stateReplication.replicationLog.getLastIndex();
      
      // Crea uno snapshot dello stato corrente
      const snapshot = await this.stateReplication.createSnapshot();
      snapshot.lastIncludedIndex = lastIndex;
      
      // Invia lo snapshot al nuovo nodo
      const snapshotSent = await this.sendSnapshot(nodeId, snapshot);
      
      if (!snapshotSent) {
        throw new Error(`Invio snapshot al nodo ${nodeId} fallito`);
      }
      
      // Aggiorna le metriche
      this.metrics.snapshotsSent++;
      
      // Ottieni le entry mancanti dopo lo snapshot
      const missingEntries = await this.stateReplication.replicationLog.getEntriesAfter(
        snapshot.lastIncludedIndex
      );
      
      // Invia le entry mancanti al nuovo nodo
      const entriesSent = await this.sendEntries(nodeId, missingEntries);
      
      if (!entriesSent) {
        throw new Error(`Invio entry al nodo ${nodeId} fallito`);
      }
      
      // Aggiorna le metriche
      this.metrics.entriesSent += missingEntries.length;
      
      // Calcola il tempo di sincronizzazione
      const syncEnd = Date.now();
      const syncTimeMs = syncEnd - syncStart;
      
      // Aggiorna le metriche
      this.metrics.syncSuccesses++;
      this.metrics.avgSyncTimeMs = (this.metrics.avgSyncTimeMs * (this.metrics.syncSuccesses - 1) + syncTimeMs) / this.metrics.syncSuccesses;
      
      // Aggiorna la storia delle sincronizzazioni
      this.syncHistory.push({
        nodeId,
        startTime: syncStart,
        endTime: syncEnd,
        duration: syncTimeMs,
        success: true,
        snapshotSize: Buffer.byteLength(JSON.stringify(snapshot), 'utf8'),
        entriesCount: missingEntries.length
      });
      
      // Rimuovi la sincronizzazione in corso
      this.syncInProgress.delete(nodeId);
      
      // Emetti evento di sincronizzazione completata
      this.emit('sync-completed', {
        nodeId,
        startTime: syncStart,
        endTime: syncEnd,
        duration: syncTimeMs,
        snapshotSize: Buffer.byteLength(JSON.stringify(snapshot), 'utf8'),
        entriesCount: missingEntries.length
      });
      
      logger.info(`Sincronizzazione del nodo ${nodeId} completata con successo in ${syncTimeMs}ms`);
      return true;
    } catch (error) {
      logger.error(`Errore durante la sincronizzazione del nodo ${nodeId}: ${error.message}`);
      
      // Aggiorna le metriche
      this.metrics.syncFailures++;
      
      // Aggiorna la storia delle sincronizzazioni
      if (this.syncInProgress.has(nodeId)) {
        const syncStart = this.syncInProgress.get(nodeId).startTime;
        const syncEnd = Date.now();
        const syncTimeMs = syncEnd - syncStart;
        
        this.syncHistory.push({
          nodeId,
          startTime: syncStart,
          endTime: syncEnd,
          duration: syncTimeMs,
          success: false,
          error: error.message
        });
        
        // Rimuovi la sincronizzazione in corso
        this.syncInProgress.delete(nodeId);
        
        // Emetti evento di sincronizzazione fallita
        this.emit('sync-failed', {
          nodeId,
          startTime: syncStart,
          endTime: syncEnd,
          duration: syncTimeMs,
          error: error.message
        });
      }
      
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
   * Invia entry del log a un nodo
   * @param {string} nodeId - ID del nodo destinatario
   * @param {Array<Object>} entries - Entry da inviare
   * @returns {Promise<boolean>} True se l'invio è riuscito
   */
  async sendEntries(nodeId, entries) {
    try {
      logger.info(`Invio ${entries.length} entry al nodo ${nodeId}`);
      
      // Nella versione reale, questo invierebbe le entry al nodo tramite RPC
      // Per ora, simuliamo una risposta
      
      // Simula un ritardo di rete (10-50ms per entry)
      await new Promise(resolve => setTimeout(resolve, 10 + Math.min(entries.length * 5, 500)));
      
      // Simula una risposta con 95% di probabilità di successo
      const success = Math.random() < 0.95;
      
      if (success) {
        logger.info(`Entry inviate con successo al nodo ${nodeId}`);
      } else {
        logger.warn(`Invio entry al nodo ${nodeId} fallito`);
      }
      
      return success;
    } catch (error) {
      logger.error(`Errore durante l'invio delle entry al nodo ${nodeId}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Gestisce una richiesta di sincronizzazione da un nuovo nodo
   * @param {Object} request - Richiesta di sincronizzazione
   * @returns {Promise<Object>} Risposta alla richiesta
   */
  async handleSyncRequest(request) {
    try {
      logger.info(`Ricevuta richiesta di sincronizzazione dal nodo ${request.nodeId}`);
      
      // Verifica che siamo leader
      if (!this.raftConsensus || this.raftConsensus.state !== 'leader') {
        return {
          success: false,
          error: 'Solo il leader può sincronizzare nuovi nodi'
        };
      }
      
      // Avvia la sincronizzazione
      const syncResult = await this.syncNewNode(request.nodeId);
      
      return {
        success: syncResult,
        lastIncludedIndex: this.stateReplication.replicationLog.getLastIndex()
      };
    } catch (error) {
      logger.error(`Errore durante la gestione della richiesta di sincronizzazione: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Richiede una sincronizzazione al leader
   * @returns {Promise<boolean>} True se la sincronizzazione è riuscita
   */
  async requestSync() {
    try {
      logger.info('Richiesta sincronizzazione al leader');
      
      // Verifica che non siamo leader
      if (this.raftConsensus && this.raftConsensus.state === 'leader') {
        throw new Error('Il leader non può richiedere una sincronizzazione');
      }
      
      // Ottieni l'ID del leader
      const leaderId = this.raftConsensus ? this.raftConsensus.leaderId : null;
      
      if (!leaderId) {
        throw new Error('Nessun leader disponibile per la sincronizzazione');
      }
      
      // Prepara la richiesta
      const request = {
        nodeId: this.raftConsensus ? this.raftConsensus.nodeId : 'unknown',
        lastIndex: this.stateReplication ? this.stateReplication.replicationLog.getLastIndex() : -1
      };
      
      // Nella versione reale, questo invierebbe una richiesta RPC al leader
      // Per ora, simuliamo una risposta
      
      // Simula un ritardo di rete (50-200ms)
      await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 150));
      
      // Simula una risposta con 80% di probabilità di successo
      const success = Math.random() < 0.8;
      
      if (success) {
        logger.info('Sincronizzazione richiesta con successo');
        
        // Emetti evento di sincronizzazione richiesta
        this.emit('sync-requested', {
          leaderId,
          timestamp: Date.now()
        });
      } else {
        logger.warn('Richiesta di sincronizzazione fallita');
      }
      
      return success;
    } catch (error) {
      logger.error(`Errore durante la richiesta di sincronizzazione: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Applica uno snapshot ricevuto
   * @param {Object} snapshot - Snapshot da applicare
   * @returns {Promise<boolean>} True se l'applicazione è riuscita
   */
  async applyReceivedSnapshot(snapshot) {
    try {
      logger.info(`Applicazione snapshot ricevuto (lastIncludedIndex: ${snapshot.lastIncludedIndex})`);
      
      // Applica lo snapshot allo stato
      await this.stateReplication.applySnapshot(snapshot);
      
      logger.info('Snapshot applicato con successo');
      
      // Emetti evento di snapshot applicato
      this.emit('snapshot-applied', {
        lastIncludedIndex: snapshot.lastIncludedIndex,
        timestamp: Date.now()
      });
      
      return true;
    } catch (error) {
      logger.error(`Errore durante l'applicazione dello snapshot ricevuto: ${error.message}`);
      
      // Emetti evento di errore
      this.emit('error', {
        error: error.message,
        operation: 'apply-snapshot',
        timestamp: Date.now()
      });
      
      return false;
    }
  }
  
  /**
   * Applica entry del log ricevute
   * @param {Array<Object>} entries - Entry da applicare
   * @returns {Promise<boolean>} True se l'applicazione è riuscita
   */
  async applyReceivedEntries(entries) {
    try {
      logger.info(`Applicazione ${entries.length} entry ricevute`);
      
      // Applica le entry una per una
      for (const entry of entries) {
        await this.stateReplication.applyTransaction(entry.transaction);
      }
      
      logger.info('Entry applicate con successo');
      
      // Emetti evento di entry applicate
      this.emit('entries-applied', {
        count: entries.length,
        timestamp: Date.now()
      });
      
      return true;
    } catch (error) {
      logger.error(`Errore durante l'applicazione delle entry ricevute: ${error.message}`);
      
      // Emetti evento di errore
      this.emit('error', {
        error: error.message,
        operation: 'apply-entries',
        timestamp: Date.now()
      });
      
      return false;
    }
  }
  
  /**
   * Ottiene lo stato corrente della sincronizzazione
   * @returns {Object} Stato corrente
   */
  getStatus() {
    return {
      syncInProgress: Array.from(this.syncInProgress.entries()).map(([nodeId, info]) => ({
        nodeId,
        startTime: info.startTime,
        elapsedMs: Date.now() - info.startTime,
        status: info.status
      })),
      syncHistory: this.syncHistory.slice(-10), // Ultimi 10 elementi
      metrics: this.metrics,
      timestamp: Date.now()
    };
  }
}

module.exports = { NodeSynchronization };
