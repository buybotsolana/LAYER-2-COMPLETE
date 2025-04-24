/**
 * Sistema Layer-2 principale su Solana
 * 
 * Questo modulo implementa il sistema Layer-2 principale che coordina
 * tutti i componenti del sistema.
 */

const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { TransactionManager, TransactionType } = require('./transaction_manager');
const { GasOptimizer } = require('./gas_optimizer');
const { RecoverySystem } = require('./recovery_system');
const { ErrorManager } = require('./error_manager');
const { MerkleTree } = require('./merkle_tree');
const { performance } = require('perf_hooks');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * Classe per il sistema Layer-2
 */
class Layer2System {
  /**
   * Costruttore
   * @param {Object} config - Configurazione del sistema
   * @param {string} config.rpcEndpoint - Endpoint RPC di Solana
   * @param {string} config.programId - ID del programma Layer-2
   * @param {string} config.sequencerPrivateKey - Chiave privata del sequencer
   * @param {string} config.databaseUrl - URL del database
   * @param {string} config.logDir - Directory per i log
   * @param {number} config.batchInterval - Intervallo di invio dei batch in millisecondi
   * @param {number} config.maxBatchSize - Dimensione massima del batch
   * @param {number} config.maxTransactionAge - Età massima delle transazioni in secondi
   * @param {boolean} config.enableMetrics - Abilita le metriche
   * @param {boolean} config.enableRecovery - Abilita il sistema di recupero
   * @param {boolean} config.enableGasOptimization - Abilita l'ottimizzazione del gas
   */
  constructor(config) {
    this.config = config;
    
    // Inizializza la connessione a Solana
    this.connection = new Connection(config.rpcEndpoint, 'confirmed');
    
    // Inizializza il programId
    this.programId = new PublicKey(config.programId);
    
    // Inizializza il keypair del sequencer
    this.sequencerKeypair = Keypair.fromSecretKey(
      Buffer.from(config.sequencerPrivateKey, 'hex')
    );
    
    // Inizializza il gestore delle transazioni
    this.transactionManager = new TransactionManager({
      connection: this.connection,
      programId: this.programId,
      sequencerKeypair: this.sequencerKeypair,
      maxBatchSize: config.maxBatchSize || 1000,
      maxTransactionAge: config.maxTransactionAge || 3600,
      batchInterval: config.batchInterval || 10000,
      rpcEndpoint: config.rpcEndpoint,
      databaseUrl: config.databaseUrl,
    });
    
    // Inizializza l'ottimizzatore del gas
    this.gasOptimizer = new GasOptimizer({
      connection: this.connection,
      priorityFeeMultiplier: 1.5,
      baseFeeMultiplier: 1.2,
      maxPriorityFee: 100000,
    });
    
    // Inizializza il sistema di recupero
    this.recoverySystem = new RecoverySystem({
      connection: this.connection,
      programId: this.programId,
      sequencerKeypair: this.sequencerKeypair,
      databaseUrl: config.databaseUrl,
      checkpointDir: path.join(config.logDir || os.tmpdir(), 'checkpoints'),
      checkpointInterval: 100,
      maxCheckpoints: 10,
    });
    
    // Inizializza il gestore degli errori
    this.errorManager = new ErrorManager({
      maxRetries: 5,
      initialBackoff: 1000,
      maxBackoff: 30000,
      backoffFactor: 2,
      jitterFactor: 0.1,
    });
    
    // Flag per indicare se il sistema è in esecuzione
    this.isRunning = false;
    
    // Timestamp di avvio
    this.startTimestamp = 0;
    
    // Metriche
    this.metrics = {
      uptime: 0,
      transactionsProcessed: 0,
      batchesSent: 0,
      averageBatchSize: 0,
      averageTransactionTime: 0,
      peakTransactionsPerSecond: 0,
      currentTransactionsPerSecond: 0,
      cpuUsage: 0,
      memoryUsage: 0,
      diskUsage: 0,
      networkUsage: 0,
    };
    
    // Intervallo per il calcolo delle metriche
    this.metricsInterval = null;
    
    // Bind dei metodi
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
    this.addTransaction = this.addTransaction.bind(this);
    this.addPriorityTransaction = this.addPriorityTransaction.bind(this);
    this.getTransactionById = this.getTransactionById.bind(this);
    this.getTransactionsByAccount = this.getTransactionsByAccount.bind(this);
    this.getMetrics = this.getMetrics.bind(this);
    this.updateMetrics = this.updateMetrics.bind(this);
    this.resetMetrics = this.resetMetrics.bind(this);
    this.handleError = this.handleError.bind(this);
    
    console.log('Layer2System inizializzato con successo');
  }
  
  /**
   * Avvia il sistema
   * @returns {Promise<boolean>} True se l'avvio è riuscito
   */
  async start() {
    if (this.isRunning) {
      console.log('Il sistema è già in esecuzione');
      return true;
    }
    
    console.log('Avvio del sistema Layer-2...');
    
    try {
      // Verifica la connessione a Solana
      const version = await this.connection.getVersion();
      console.log(`Connesso a Solana v${version['solana-core']}`);
      
      // Verifica il saldo del sequencer
      const balance = await this.connection.getBalance(this.sequencerKeypair.publicKey);
      console.log(`Saldo del sequencer: ${balance / 1e9} SOL`);
      
      if (balance < 1e9) { // 1 SOL
        console.warn('Attenzione: il saldo del sequencer è basso');
      }
      
      // Avvia il gestore delle transazioni
      await this.transactionManager.start();
      
      // Imposta il flag di esecuzione
      this.isRunning = true;
      
      // Imposta il timestamp di avvio
      this.startTimestamp = Date.now();
      
      // Avvia l'intervallo per il calcolo delle metriche
      if (this.config.enableMetrics) {
        this.metricsInterval = setInterval(this.updateMetrics, 1000);
      }
      
      console.log('Sistema Layer-2 avviato con successo');
      
      return true;
    } catch (error) {
      console.error('Errore durante l\'avvio del sistema:', error);
      
      // Gestisce l'errore
      await this.handleError(error, {
        context: 'start',
        retryCallback: this.start.bind(this),
      });
      
      return false;
    }
  }
  
  /**
   * Ferma il sistema
   * @returns {Promise<boolean>} True se l'arresto è riuscito
   */
  async stop() {
    if (!this.isRunning) {
      console.log('Il sistema non è in esecuzione');
      return true;
    }
    
    console.log('Arresto del sistema Layer-2...');
    
    try {
      // Ferma il gestore delle transazioni
      await this.transactionManager.stop();
      
      // Cancella l'intervallo per il calcolo delle metriche
      if (this.metricsInterval) {
        clearInterval(this.metricsInterval);
        this.metricsInterval = null;
      }
      
      // Imposta il flag di esecuzione
      this.isRunning = false;
      
      console.log('Sistema Layer-2 arrestato con successo');
      
      return true;
    } catch (error) {
      console.error('Errore durante l\'arresto del sistema:', error);
      
      // Gestisce l'errore
      await this.handleError(error, {
        context: 'stop',
        retryCallback: this.stop.bind(this),
      });
      
      return false;
    }
  }
  
  /**
   * Aggiunge una transazione al sistema
   * @param {Object} transaction - Transazione da aggiungere
   * @returns {Promise<string>} ID della transazione
   */
  async addTransaction(transaction) {
    if (!this.isRunning) {
      throw new Error('Il sistema non è in esecuzione');
    }
    
    try {
      // Aggiunge la transazione al gestore delle transazioni
      return await this.transactionManager.addTransaction(transaction);
    } catch (error) {
      console.error('Errore durante l\'aggiunta della transazione:', error);
      
      // Gestisce l'errore
      await this.handleError(error, {
        context: 'addTransaction',
        retryCallback: () => this.addTransaction(transaction),
      });
      
      throw error;
    }
  }
  
  /**
   * Aggiunge una transazione con priorità al sistema
   * @param {Object} transaction - Transazione da aggiungere
   * @param {number} priority - Priorità della transazione (1-10)
   * @returns {Promise<string>} ID della transazione
   */
  async addPriorityTransaction(transaction, priority = 5) {
    if (!this.isRunning) {
      throw new Error('Il sistema non è in esecuzione');
    }
    
    try {
      // Aggiunge la transazione al gestore delle transazioni
      return await this.transactionManager.addPriorityTransaction(transaction, priority);
    } catch (error) {
      console.error('Errore durante l\'aggiunta della transazione con priorità:', error);
      
      // Gestisce l'errore
      await this.handleError(error, {
        context: 'addPriorityTransaction',
        retryCallback: () => this.addPriorityTransaction(transaction, priority),
      });
      
      throw error;
    }
  }
  
  /**
   * Ottiene una transazione per ID
   * @param {string} id - ID della transazione
   * @returns {Promise<Object|null>} Transazione o null se non trovata
   */
  async getTransactionById(id) {
    if (!this.isRunning) {
      throw new Error('Il sistema non è in esecuzione');
    }
    
    try {
      // Ottiene la transazione dal gestore delle transazioni
      return this.transactionManager.getTransactionById(id);
    } catch (error) {
      console.error('Errore durante l\'ottenimento della transazione:', error);
      
      // Gestisce l'errore
      await this.handleError(error, {
        context: 'getTransactionById',
        retryCallback: () => this.getTransactionById(id),
      });
      
      throw error;
    }
  }
  
  /**
   * Ottiene le transazioni per account
   * @param {string} account - Indirizzo dell'account
   * @returns {Promise<Array>} Lista di transazioni
   */
  async getTransactionsByAccount(account) {
    if (!this.isRunning) {
      throw new Error('Il sistema non è in esecuzione');
    }
    
    try {
      // Ottiene le transazioni dal gestore delle transazioni
      return this.transactionManager.getTransactionsByAccount(account);
    } catch (error) {
      console.error('Errore durante l\'ottenimento delle transazioni:', error);
      
      // Gestisce l'errore
      await this.handleError(error, {
        context: 'getTransactionsByAccount',
        retryCallback: () => this.getTransactionsByAccount(account),
      });
      
      throw error;
    }
  }
  
  /**
   * Gestisce un errore
   * @param {Error} error - Errore da gestire
   * @param {Object} options - Opzioni per la gestione dell'errore
   * @returns {Promise<any>} Risultato del retry o null
   */
  async handleError(error, options = {}) {
    return this.errorManager.handleError(error, options);
  }
  
  /**
   * Aggiorna le metriche
   */
  updateMetrics() {
    // Calcola l'uptime
    this.metrics.uptime = Math.floor((Date.now() - this.startTimestamp) / 1000);
    
    // Ottiene le metriche dal gestore delle transazioni
    const transactionManagerMetrics = this.transactionManager.getMetrics();
    
    // Aggiorna le metriche
    this.metrics.transactionsProcessed = transactionManagerMetrics.transactionsProcessed;
    this.metrics.batchesSent = transactionManagerMetrics.batchesSent;
    this.metrics.averageBatchSize = transactionManagerMetrics.averageBatchSize;
    this.metrics.averageTransactionTime = transactionManagerMetrics.averageProcessingTime;
    this.metrics.peakTransactionsPerSecond = transactionManagerMetrics.peakTransactionsPerSecond;
    this.metrics.currentTransactionsPerSecond = transactionManagerMetrics.currentTransactionsPerSecond;
    
    // Ottiene le metriche di sistema
    const memoryUsage = process.memoryUsage();
    this.metrics.memoryUsage = Math.floor(memoryUsage.heapUsed / 1024 / 1024); // MB
    
    // Ottiene le metriche di CPU
    const cpuUsage = process.cpuUsage();
    this.metrics.cpuUsage = Math.floor((cpuUsage.user + cpuUsage.system) / 1000000); // secondi
  }
  
  /**
   * Ottiene le metriche
   * @returns {Object} Metriche
   */
  getMetrics() {
    // Aggiorna le metriche
    this.updateMetrics();
    
    // Ottiene le metriche dal gestore delle transazioni
    const transactionManagerMetrics = this.transactionManager.getMetrics();
    
    // Ottiene le metriche dal gestore degli errori
    const errorManagerMetrics = this.errorManager.getMetrics();
    
    // Ottiene le metriche dal sistema di recupero
    const recoverySystemMetrics = this.recoverySystem.getMetrics();
    
    // Ottiene le metriche dall'ottimizzatore del gas
    const gasOptimizerMetrics = this.gasOptimizer.getMetrics();
    
    // Combina le metriche
    return {
      system: { ...this.metrics },
      transactionManager: transactionManagerMetrics,
      errorManager: errorManagerMetrics,
      recoverySystem: recoverySystemMetrics,
      gasOptimizer: gasOptimizerMetrics,
    };
  }
  
  /**
   * Resetta le metriche
   */
  resetMetrics() {
    this.metrics = {
      uptime: 0,
      transactionsProcessed: 0,
      batchesSent: 0,
      averageBatchSize: 0,
      averageTransactionTime: 0,
      peakTransactionsPerSecond: 0,
      currentTransactionsPerSecond: 0,
      cpuUsage: 0,
      memoryUsage: 0,
      diskUsage: 0,
      networkUsage: 0,
    };
    
    // Resetta le metriche del gestore delle transazioni
    this.transactionManager.resetMetrics();
    
    // Resetta le metriche del gestore degli errori
    this.errorManager.resetMetrics();
  }
}

module.exports = { Layer2System, TransactionType };
