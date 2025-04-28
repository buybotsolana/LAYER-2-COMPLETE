/**
 * Sequencer Worker per il Layer-2 su Solana
 * 
 * Questo modulo implementa il worker del sequencer che gestisce l'elaborazione
 * delle transazioni in background, garantendo alta disponibilità e throughput.
 * 
 * @module sequencer-worker
 */

const { Connection, PublicKey, Transaction } = require('@solana/web3.js');
const { Worker } = require('worker_threads');
const { parentPort, workerData } = require('worker_threads');
const { performance } = require('perf_hooks');
const crypto = require('crypto');
const zlib = require('zlib');
const LRUCache = require('lru-cache');
const { promisify } = require('util');
const { createLogger } = require('./logger');

// Promisify zlib functions
const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

// Configurazione
const DEFAULT_CONFIG = {
  maxBatchSize: 128,
  maxBatchTimeMs: 200,
  maxConcurrentBatches: 4,
  retryAttempts: 5,
  retryDelayMs: 1000,
  cacheSize: 10000,
  metricsInterval: 10000,
  priorityLevels: {
    HIGH: 0,
    MEDIUM: 1,
    LOW: 2
  }
};

class SequencerWorker {
  /**
   * Crea una nuova istanza del SequencerWorker
   * @param {Object} config - Configurazione del worker
   */
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = createLogger('sequencer-worker');
    this.connection = new Connection(this.config.rpcUrl, 'confirmed');
    this.programId = new PublicKey(this.config.programId);
    
    // Inizializza le code di transazioni per priorità
    this.transactionQueues = {
      [this.config.priorityLevels.HIGH]: [],
      [this.config.priorityLevels.MEDIUM]: [],
      [this.config.priorityLevels.LOW]: []
    };
    
    // Cache LRU per le transazioni già elaborate
    this.processedTxCache = new LRUCache({
      max: this.config.cacheSize,
      ttl: 1000 * 60 * 60 // 1 ora
    });
    
    // Stato del worker
    this.isProcessing = false;
    this.currentBatchCount = 0;
    this.metrics = {
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
      avgProcessingTimeMs: 0,
      batchesProcessed: 0,
      lastMetricsTime: performance.now()
    };
    
    // Inizializza il worker
    this.initialize();
  }
  
  /**
   * Inizializza il worker e configura i listener
   */
  initialize() {
    this.logger.info('Inizializzazione SequencerWorker');
    
    // Configura il listener per i messaggi dal thread principale
    if (parentPort) {
      parentPort.on('message', async (message) => {
        try {
          switch (message.type) {
            case 'transaction':
              await this.queueTransaction(message.data);
              break;
            case 'batch':
              await this.queueBatch(message.data);
              break;
            case 'status':
              this.sendStatusUpdate();
              break;
            case 'config':
              this.updateConfig(message.data);
              break;
            default:
              this.logger.warn(`Tipo di messaggio sconosciuto: ${message.type}`);
          }
        } catch (error) {
          this.logger.error(`Errore nell'elaborazione del messaggio: ${error.message}`);
          if (parentPort) {
            parentPort.postMessage({
              type: 'error',
              error: {
                message: error.message,
                stack: error.stack
              }
            });
          }
        }
      });
    }
    
    // Avvia il loop di elaborazione
    this.startProcessingLoop();
    
    // Avvia il reporting delle metriche
    this.startMetricsReporting();
    
    this.logger.info('SequencerWorker inizializzato con successo');
  }
  
  /**
   * Aggiorna la configurazione del worker
   * @param {Object} newConfig - Nuova configurazione
   */
  updateConfig(newConfig) {
    this.logger.info('Aggiornamento configurazione worker');
    this.config = { ...this.config, ...newConfig };
    
    // Aggiorna la cache se la dimensione è cambiata
    if (newConfig.cacheSize && newConfig.cacheSize !== this.processedTxCache.max) {
      this.processedTxCache.max = newConfig.cacheSize;
    }
    
    this.logger.info('Configurazione worker aggiornata');
  }
  
  /**
   * Aggiunge una transazione alla coda appropriata in base alla priorità
   * @param {Object} transaction - Transazione da accodare
   */
  async queueTransaction(transaction) {
    // Genera un ID univoco per la transazione se non presente
    if (!transaction.id) {
      transaction.id = crypto.randomUUID();
    }
    
    // Verifica se la transazione è già stata elaborata
    if (this.processedTxCache.has(transaction.id)) {
      this.logger.debug(`Transazione ${transaction.id} già elaborata, ignorata`);
      return;
    }
    
    // Determina la priorità della transazione (default: MEDIUM)
    const priority = transaction.priority !== undefined 
      ? transaction.priority 
      : this.config.priorityLevels.MEDIUM;
    
    // Aggiungi timestamp se non presente
    if (!transaction.timestamp) {
      transaction.timestamp = Date.now();
    }
    
    // Aggiungi la transazione alla coda appropriata
    this.transactionQueues[priority].push(transaction);
    
    this.logger.debug(`Transazione ${transaction.id} accodata con priorità ${priority}`);
    
    // Notifica il thread principale
    if (parentPort) {
      parentPort.postMessage({
        type: 'queued',
        data: {
          id: transaction.id,
          priority
        }
      });
    }
  }
  
  /**
   * Aggiunge un batch di transazioni alle code appropriate
   * @param {Array} transactions - Array di transazioni
   */
  async queueBatch(transactions) {
    this.logger.info(`Accodamento batch di ${transactions.length} transazioni`);
    
    const results = {
      queued: 0,
      duplicates: 0,
      errors: 0
    };
    
    for (const tx of transactions) {
      try {
        // Verifica se la transazione è già stata elaborata
        if (this.processedTxCache.has(tx.id)) {
          results.duplicates++;
          continue;
        }
        
        await this.queueTransaction(tx);
        results.queued++;
      } catch (error) {
        this.logger.error(`Errore nell'accodamento della transazione: ${error.message}`);
        results.errors++;
      }
    }
    
    this.logger.info(`Batch accodato: ${results.queued} accodate, ${results.duplicates} duplicate, ${results.errors} errori`);
    
    // Notifica il thread principale
    if (parentPort) {
      parentPort.postMessage({
        type: 'batch_queued',
        data: results
      });
    }
  }
  
  /**
   * Avvia il loop di elaborazione delle transazioni
   */
  startProcessingLoop() {
    this.logger.info('Avvio loop di elaborazione transazioni');
    
    const processLoop = async () => {
      try {
        // Se stiamo già elaborando il numero massimo di batch, attendi
        if (this.currentBatchCount >= this.config.maxConcurrentBatches) {
          setTimeout(processLoop, 10);
          return;
        }
        
        // Raccogli transazioni da tutte le code in ordine di priorità
        const batch = this.collectBatch();
        
        if (batch.length > 0) {
          this.currentBatchCount++;
          this.processBatch(batch)
            .finally(() => {
              this.currentBatchCount--;
            });
        }
        
        // Pianifica la prossima iterazione
        setTimeout(processLoop, 10);
      } catch (error) {
        this.logger.error(`Errore nel loop di elaborazione: ${error.message}`);
        setTimeout(processLoop, 1000); // Riprova dopo un secondo in caso di errore
      }
    };
    
    // Avvia il loop
    processLoop();
  }
  
  /**
   * Raccoglie un batch di transazioni dalle code in base alla priorità
   * @returns {Array} Batch di transazioni
   */
  collectBatch() {
    const batch = [];
    const priorityLevels = Object.keys(this.transactionQueues).sort((a, b) => a - b);
    
    // Raccogli transazioni da tutte le code in ordine di priorità
    for (const priority of priorityLevels) {
      const queue = this.transactionQueues[priority];
      
      while (queue.length > 0 && batch.length < this.config.maxBatchSize) {
        batch.push(queue.shift());
      }
      
      // Se abbiamo raggiunto la dimensione massima del batch, interrompi
      if (batch.length >= this.config.maxBatchSize) {
        break;
      }
    }
    
    return batch;
  }
  
  /**
   * Elabora un batch di transazioni
   * @param {Array} batch - Batch di transazioni da elaborare
   */
  async processBatch(batch) {
    if (batch.length === 0) return;
    
    const batchId = crypto.randomUUID();
    const startTime = performance.now();
    
    this.logger.info(`Elaborazione batch ${batchId} con ${batch.length} transazioni`);
    
    try {
      // Comprimi il batch per l'efficienza
      const batchData = await this.compressBatch(batch);
      
      // Elabora il batch on-chain
      const result = await this.submitBatchOnChain(batchData, batch);
      
      // Aggiorna le metriche
      this.metrics.totalProcessed += batch.length;
      this.metrics.successCount += result.successCount;
      this.metrics.failureCount += result.failureCount;
      this.metrics.batchesProcessed++;
      
      // Calcola il tempo di elaborazione medio
      const processingTime = performance.now() - startTime;
      this.metrics.avgProcessingTimeMs = 
        (this.metrics.avgProcessingTimeMs * (this.metrics.batchesProcessed - 1) + processingTime) / 
        this.metrics.batchesProcessed;
      
      // Aggiungi le transazioni elaborate alla cache
      for (const tx of batch) {
        this.processedTxCache.set(tx.id, {
          timestamp: Date.now(),
          success: result.successIds.includes(tx.id)
        });
      }
      
      this.logger.info(`Batch ${batchId} elaborato in ${processingTime.toFixed(2)}ms: ${result.successCount} successi, ${result.failureCount} fallimenti`);
      
      // Notifica il thread principale
      if (parentPort) {
        parentPort.postMessage({
          type: 'batch_processed',
          data: {
            batchId,
            processingTime,
            successCount: result.successCount,
            failureCount: result.failureCount,
            successIds: result.successIds,
            failureIds: result.failureIds
          }
        });
      }
    } catch (error) {
      this.logger.error(`Errore nell'elaborazione del batch ${batchId}: ${error.message}`);
      
      // Rimetti le transazioni nelle code appropriate
      for (const tx of batch) {
        await this.queueTransaction({
          ...tx,
          retryCount: (tx.retryCount || 0) + 1
        });
      }
      
      // Notifica il thread principale
      if (parentPort) {
        parentPort.postMessage({
          type: 'batch_error',
          data: {
            batchId,
            error: {
              message: error.message,
              stack: error.stack
            }
          }
        });
      }
    }
  }
  
  /**
   * Comprime un batch di transazioni
   * @param {Array} batch - Batch di transazioni
   * @returns {Buffer} Batch compresso
   */
  async compressBatch(batch) {
    const batchJson = JSON.stringify(batch);
    return await gzipAsync(Buffer.from(batchJson));
  }
  
  /**
   * Decomprime un batch di transazioni
   * @param {Buffer} compressedBatch - Batch compresso
   * @returns {Array} Batch decompresso
   */
  async decompressBatch(compressedBatch) {
    const decompressed = await gunzipAsync(compressedBatch);
    return JSON.parse(decompressed.toString());
  }
  
  /**
   * Invia un batch di transazioni on-chain
   * @param {Buffer} batchData - Dati del batch compressi
   * @param {Array} originalBatch - Batch originale per riferimento
   * @returns {Object} Risultato dell'elaborazione
   */
  async submitBatchOnChain(batchData, originalBatch) {
    // Implementazione dell'invio on-chain
    // Questa è una versione semplificata, l'implementazione reale
    // dipenderà dal design specifico del programma Solana
    
    const result = {
      successCount: 0,
      failureCount: 0,
      successIds: [],
      failureIds: []
    };
    
    try {
      // Simula l'elaborazione on-chain
      for (const tx of originalBatch) {
        try {
          // Logica di validazione e elaborazione
          const isValid = this.validateTransaction(tx);
          
          if (isValid) {
            result.successCount++;
            result.successIds.push(tx.id);
          } else {
            result.failureCount++;
            result.failureIds.push(tx.id);
          }
        } catch (error) {
          this.logger.error(`Errore nell'elaborazione della transazione ${tx.id}: ${error.message}`);
          result.failureCount++;
          result.failureIds.push(tx.id);
        }
      }
      
      return result;
    } catch (error) {
      this.logger.error(`Errore nell'invio del batch on-chain: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Valida una transazione
   * @param {Object} transaction - Transazione da validare
   * @returns {boolean} True se la transazione è valida
   */
  validateTransaction(transaction) {
    // Implementazione della validazione
    // Questa è una versione semplificata, l'implementazione reale
    // dipenderà dal design specifico del programma Solana
    
    // Verifica che la transazione abbia tutti i campi richiesti
    if (!transaction.id || !transaction.sender || !transaction.data) {
      return false;
    }
    
    // Verifica che la transazione non sia scaduta
    if (transaction.expiryTime && transaction.expiryTime < Date.now()) {
      return false;
    }
    
    // Verifica che la transazione non abbia superato il numero massimo di tentativi
    if (transaction.retryCount && transaction.retryCount >= this.config.retryAttempts) {
      return false;
    }
    
    // Altre verifiche specifiche...
    
    return true;
  }
  
  /**
   * Avvia il reporting periodico delle metriche
   */
  startMetricsReporting() {
    setInterval(() => {
      this.reportMetrics();
    }, this.config.metricsInterval);
  }
  
  /**
   * Riporta le metriche correnti
   */
  reportMetrics() {
    const now = performance.now();
    const elapsedMs = now - this.metrics.lastMetricsTime;
    this.metrics.lastMetricsTime = now;
    
    const queueSizes = {};
    let totalQueued = 0;
    
    for (const [priority, queue] of Object.entries(this.transactionQueues)) {
      queueSizes[priority] = queue.length;
      totalQueued += queue.length;
    }
    
    const metrics = {
      timestamp: Date.now(),
      totalProcessed: this.metrics.totalProcessed,
      successRate: this.metrics.totalProcessed > 0 
        ? (this.metrics.successCount / this.metrics.totalProcessed) * 100 
        : 0,
      avgProcessingTimeMs: this.metrics.avgProcessingTimeMs,
      batchesProcessed: this.metrics.batchesProcessed,
      currentBatchCount: this.currentBatchCount,
      queueSizes,
      totalQueued,
      cacheSize: this.processedTxCache.size,
      throughputTps: elapsedMs > 0 
        ? (this.metrics.totalProcessed / (elapsedMs / 1000)) 
        : 0
    };
    
    this.logger.info(`Metriche: ${JSON.stringify(metrics)}`);
    
    // Notifica il thread principale
    if (parentPort) {
      parentPort.postMessage({
        type: 'metrics',
        data: metrics
      });
    }
  }
  
  /**
   * Invia un aggiornamento di stato al thread principale
   */
  sendStatusUpdate() {
    const queueSizes = {};
    let totalQueued = 0;
    
    for (const [priority, queue] of Object.entries(this.transactionQueues)) {
      queueSizes[priority] = queue.length;
      totalQueued += queue.length;
    }
    
    const status = {
      isProcessing: this.isProcessing,
      currentBatchCount: this.currentBatchCount,
      queueSizes,
      totalQueued,
      cacheSize: this.processedTxCache.size,
      metrics: { ...this.metrics }
    };
    
    // Notifica il thread principale
    if (parentPort) {
      parentPort.postMessage({
        type: 'status_update',
        data: status
      });
    }
  }
}

// Se questo file viene eseguito come worker thread, inizializza il worker
if (require.main === module || !parentPort) {
  const worker = new SequencerWorker(workerData);
} else {
  // Altrimenti, esporta la classe per l'uso in altri moduli
  module.exports = { SequencerWorker };
}
