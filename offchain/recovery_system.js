/**
 * Sistema di recupero per il Layer-2 su Solana
 * 
 * Questo modulo implementa il sistema di recupero che si occupa di salvare e ripristinare
 * lo stato del sistema in caso di errori o interruzioni.
 */

const { Connection, PublicKey, Transaction } = require('@solana/web3.js');
const { performance } = require('perf_hooks');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Classe per il sistema di recupero
 */
class RecoverySystem {
  /**
   * Costruttore
   * @param {Object} config - Configurazione del sistema di recupero
   * @param {Connection} config.connection - Connessione a Solana
   * @param {PublicKey} config.programId - ID del programma Layer-2
   * @param {Object} config.sequencerKeypair - Keypair del sequencer
   * @param {string} config.databaseUrl - URL del database
   * @param {string} config.checkpointDir - Directory per i checkpoint
   * @param {number} config.checkpointInterval - Intervallo di checkpoint in numero di transazioni
   * @param {number} config.maxCheckpoints - Numero massimo di checkpoint da mantenere
   */
  constructor(config) {
    this.connection = config.connection;
    this.programId = config.programId;
    this.sequencerKeypair = config.sequencerKeypair;
    this.databaseUrl = config.databaseUrl;
    this.checkpointDir = config.checkpointDir || './checkpoints';
    this.checkpointInterval = config.checkpointInterval || 100;
    this.maxCheckpoints = config.maxCheckpoints || 10;
    
    // Contatore delle transazioni dall'ultimo checkpoint
    this.transactionsSinceLastCheckpoint = 0;
    
    // Timestamp dell'ultimo checkpoint
    this.lastCheckpointTimestamp = 0;
    
    // Lista dei checkpoint
    this.checkpoints = [];
    
    // Metriche
    this.metrics = {
      checkpointsCreated: 0,
      checkpointsLoaded: 0,
      averageCheckpointSize: 0,
      totalCheckpointSize: 0,
      lastCheckpointDuration: 0,
      lastLoadDuration: 0,
      recoveryAttempts: 0,
      successfulRecoveries: 0,
    };
    
    // Bind dei metodi
    this.saveState = this.saveState.bind(this);
    this.loadState = this.loadState.bind(this);
    this.createCheckpoint = this.createCheckpoint.bind(this);
    this.loadCheckpoint = this.loadCheckpoint.bind(this);
    this.listCheckpoints = this.listCheckpoints.bind(this);
    this.deleteCheckpoint = this.deleteCheckpoint.bind(this);
    this.cleanupCheckpoints = this.cleanupCheckpoints.bind(this);
    this.recover = this.recover.bind(this);
    this.getMetrics = this.getMetrics.bind(this);
    
    console.log('RecoverySystem inizializzato con successo');
  }
  
  /**
   * Salva lo stato del sistema
   * @param {Object} state - Stato del sistema
   * @returns {Promise<boolean>} True se il salvataggio è riuscito
   */
  async saveState(state) {
    try {
      console.log('Salvataggio dello stato del sistema...');
      
      // Incrementa il contatore delle transazioni
      this.transactionsSinceLastCheckpoint += state.pendingTransactions.length;
      
      // Verifica se è necessario creare un checkpoint
      if (this.transactionsSinceLastCheckpoint >= this.checkpointInterval) {
        await this.createCheckpoint(state);
        this.transactionsSinceLastCheckpoint = 0;
      }
      
      return true;
    } catch (error) {
      console.error('Errore durante il salvataggio dello stato:', error);
      return false;
    }
  }
  
  /**
   * Carica lo stato del sistema
   * @returns {Promise<Object|null>} Stato del sistema o null se non trovato
   */
  async loadState() {
    const startTime = performance.now();
    
    try {
      console.log('Caricamento dello stato del sistema...');
      
      // Ottiene la lista dei checkpoint
      const checkpoints = await this.listCheckpoints();
      
      if (checkpoints.length === 0) {
        console.log('Nessun checkpoint trovato');
        return null;
      }
      
      // Ordina i checkpoint per timestamp (decrescente)
      checkpoints.sort((a, b) => b.timestamp - a.timestamp);
      
      // Carica il checkpoint più recente
      const latestCheckpoint = checkpoints[0];
      const state = await this.loadCheckpoint(latestCheckpoint.id);
      
      if (!state) {
        console.log('Impossibile caricare il checkpoint più recente');
        return null;
      }
      
      console.log(`Stato caricato dal checkpoint ${latestCheckpoint.id}`);
      
      // Aggiorna le metriche
      this.metrics.checkpointsLoaded++;
      
      return state;
    } catch (error) {
      console.error('Errore durante il caricamento dello stato:', error);
      return null;
    } finally {
      const endTime = performance.now();
      this.metrics.lastLoadDuration = endTime - startTime;
    }
  }
  
  /**
   * Crea un checkpoint dello stato
   * @param {Object} state - Stato del sistema
   * @returns {Promise<string|null>} ID del checkpoint o null se la creazione è fallita
   */
  async createCheckpoint(state) {
    const startTime = performance.now();
    
    try {
      console.log('Creazione di un checkpoint...');
      
      // Crea la directory dei checkpoint se non esiste
      await fs.mkdir(this.checkpointDir, { recursive: true });
      
      // Genera un ID per il checkpoint
      const checkpointId = this.generateCheckpointId();
      
      // Crea il percorso del file
      const checkpointPath = path.join(this.checkpointDir, `${checkpointId}.json`);
      
      // Prepara i dati del checkpoint
      const checkpoint = {
        id: checkpointId,
        timestamp: Date.now(),
        sequencer: this.sequencerKeypair.publicKey.toString(),
        state: {
          pendingTransactions: state.pendingTransactions,
          priorityTransactions: state.priorityTransactions,
          nonceByAccount: Array.from(state.nonceByAccount.entries()),
          processedTransactionCount: state.processedTransactionCount,
          batchCount: state.batchCount,
          lastBatchTimestamp: state.lastBatchTimestamp,
        },
      };
      
      // Serializza il checkpoint
      const checkpointData = JSON.stringify(checkpoint, null, 2);
      
      // Salva il checkpoint su file
      await fs.writeFile(checkpointPath, checkpointData, 'utf8');
      
      // Aggiorna la lista dei checkpoint
      this.checkpoints.push({
        id: checkpointId,
        timestamp: checkpoint.timestamp,
        path: checkpointPath,
        size: checkpointData.length,
      });
      
      // Aggiorna il timestamp dell'ultimo checkpoint
      this.lastCheckpointTimestamp = checkpoint.timestamp;
      
      // Aggiorna le metriche
      this.metrics.checkpointsCreated++;
      this.metrics.totalCheckpointSize += checkpointData.length;
      this.metrics.averageCheckpointSize = this.metrics.totalCheckpointSize / this.metrics.checkpointsCreated;
      
      console.log(`Checkpoint creato: ${checkpointId}`);
      
      // Pulisce i checkpoint vecchi
      await this.cleanupCheckpoints();
      
      return checkpointId;
    } catch (error) {
      console.error('Errore durante la creazione del checkpoint:', error);
      return null;
    } finally {
      const endTime = performance.now();
      this.metrics.lastCheckpointDuration = endTime - startTime;
    }
  }
  
  /**
   * Carica un checkpoint
   * @param {string} checkpointId - ID del checkpoint
   * @returns {Promise<Object|null>} Stato del sistema o null se non trovato
   */
  async loadCheckpoint(checkpointId) {
    try {
      console.log(`Caricamento del checkpoint ${checkpointId}...`);
      
      // Crea il percorso del file
      const checkpointPath = path.join(this.checkpointDir, `${checkpointId}.json`);
      
      // Verifica se il file esiste
      try {
        await fs.access(checkpointPath);
      } catch (error) {
        console.error(`Il checkpoint ${checkpointId} non esiste`);
        return null;
      }
      
      // Legge il file
      const checkpointData = await fs.readFile(checkpointPath, 'utf8');
      
      // Deserializza il checkpoint
      const checkpoint = JSON.parse(checkpointData);
      
      // Converte la mappa dei nonce
      const nonceByAccount = new Map(checkpoint.state.nonceByAccount);
      
      // Restituisce lo stato
      return {
        pendingTransactions: checkpoint.state.pendingTransactions,
        priorityTransactions: checkpoint.state.priorityTransactions,
        nonceByAccount,
        processedTransactionCount: checkpoint.state.processedTransactionCount,
        batchCount: checkpoint.state.batchCount,
        lastBatchTimestamp: checkpoint.state.lastBatchTimestamp,
      };
    } catch (error) {
      console.error(`Errore durante il caricamento del checkpoint ${checkpointId}:`, error);
      return null;
    }
  }
  
  /**
   * Elenca i checkpoint disponibili
   * @returns {Promise<Array>} Lista dei checkpoint
   */
  async listCheckpoints() {
    try {
      console.log('Elenco dei checkpoint...');
      
      // Crea la directory dei checkpoint se non esiste
      await fs.mkdir(this.checkpointDir, { recursive: true });
      
      // Legge la directory
      const files = await fs.readdir(this.checkpointDir);
      
      // Filtra i file JSON
      const checkpointFiles = files.filter(file => file.endsWith('.json'));
      
      // Carica le informazioni sui checkpoint
      const checkpoints = [];
      
      for (const file of checkpointFiles) {
        try {
          // Legge il file
          const checkpointPath = path.join(this.checkpointDir, file);
          const checkpointData = await fs.readFile(checkpointPath, 'utf8');
          
          // Deserializza il checkpoint
          const checkpoint = JSON.parse(checkpointData);
          
          // Aggiunge il checkpoint alla lista
          checkpoints.push({
            id: checkpoint.id,
            timestamp: checkpoint.timestamp,
            sequencer: checkpoint.sequencer,
            path: checkpointPath,
            size: checkpointData.length,
          });
        } catch (error) {
          console.error(`Errore durante il caricamento del checkpoint ${file}:`, error);
        }
      }
      
      // Aggiorna la lista dei checkpoint
      this.checkpoints = checkpoints;
      
      return checkpoints;
    } catch (error) {
      console.error('Errore durante l\'elenco dei checkpoint:', error);
      return [];
    }
  }
  
  /**
   * Elimina un checkpoint
   * @param {string} checkpointId - ID del checkpoint
   * @returns {Promise<boolean>} True se l'eliminazione è riuscita
   */
  async deleteCheckpoint(checkpointId) {
    try {
      console.log(`Eliminazione del checkpoint ${checkpointId}...`);
      
      // Crea il percorso del file
      const checkpointPath = path.join(this.checkpointDir, `${checkpointId}.json`);
      
      // Verifica se il file esiste
      try {
        await fs.access(checkpointPath);
      } catch (error) {
        console.error(`Il checkpoint ${checkpointId} non esiste`);
        return false;
      }
      
      // Elimina il file
      await fs.unlink(checkpointPath);
      
      // Aggiorna la lista dei checkpoint
      this.checkpoints = this.checkpoints.filter(checkpoint => checkpoint.id !== checkpointId);
      
      console.log(`Checkpoint ${checkpointId} eliminato`);
      
      return true;
    } catch (error) {
      console.error(`Errore durante l'eliminazione del checkpoint ${checkpointId}:`, error);
      return false;
    }
  }
  
  /**
   * Pulisce i checkpoint vecchi
   * @returns {Promise<number>} Numero di checkpoint eliminati
   */
  async cleanupCheckpoints() {
    try {
      console.log('Pulizia dei checkpoint vecchi...');
      
      // Ottiene la lista dei checkpoint
      const checkpoints = await this.listCheckpoints();
      
      if (checkpoints.length <= this.maxCheckpoints) {
        console.log('Nessun checkpoint da eliminare');
        return 0;
      }
      
      // Ordina i checkpoint per timestamp (crescente)
      checkpoints.sort((a, b) => a.timestamp - b.timestamp);
      
      // Calcola il numero di checkpoint da eliminare
      const checkpointsToDelete = checkpoints.length - this.maxCheckpoints;
      
      // Elimina i checkpoint più vecchi
      let deletedCount = 0;
      
      for (let i = 0; i < checkpointsToDelete; i++) {
        const checkpoint = checkpoints[i];
        const deleted = await this.deleteCheckpoint(checkpoint.id);
        
        if (deleted) {
          deletedCount++;
        }
      }
      
      console.log(`${deletedCount} checkpoint eliminati`);
      
      return deletedCount;
    } catch (error) {
      console.error('Errore durante la pulizia dei checkpoint:', error);
      return 0;
    }
  }
  
  /**
   * Recupera lo stato del sistema dopo un errore
   * @returns {Promise<Object|null>} Stato del sistema o null se il recupero è fallito
   */
  async recover() {
    try {
      console.log('Recupero dello stato del sistema...');
      
      // Incrementa il contatore dei tentativi di recupero
      this.metrics.recoveryAttempts++;
      
      // Carica lo stato
      const state = await this.loadState();
      
      if (!state) {
        console.error('Impossibile recuperare lo stato del sistema');
        return null;
      }
      
      // Incrementa il contatore dei recuperi riusciti
      this.metrics.successfulRecoveries++;
      
      console.log('Stato del sistema recuperato con successo');
      
      return state;
    } catch (error) {
      console.error('Errore durante il recupero dello stato:', error);
      return null;
    }
  }
  
  /**
   * Genera un ID per un checkpoint
   * @returns {string} ID del checkpoint
   */
  generateCheckpointId() {
    // Crea un buffer con i dati del checkpoint
    const buffer = Buffer.concat([
      this.sequencerKeypair.publicKey.toBuffer(),
      Buffer.from(Date.now().toString()),
      Buffer.from(this.metrics.checkpointsCreated.toString()),
      crypto.randomBytes(16), // Aggiunge casualità
    ]);
    
    // Calcola l'hash SHA-256
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    
    return hash.slice(0, 16); // Utilizza solo i primi 16 caratteri
  }
  
  /**
   * Ottiene le metriche
   * @returns {Object} Metriche
   */
  getMetrics() {
    return { ...this.metrics };
  }
}

module.exports = { RecoverySystem };
