/**
 * Ottimizzatore per l'elaborazione di transazioni miste per Layer-2 Solana
 * 
 * Questo modulo implementa un sistema avanzato per l'elaborazione efficiente di transazioni miste con:
 * - Worker specializzati per tipi specifici di transazione
 * - Code separate per diversi tipi di transazione
 * - Bilanciamento del carico adattivo
 * 
 * @module mixed_transaction_optimizer
 */

import { EventEmitter } from 'events';
import { Logger } from './utils/logger';
import { Transaction } from './optimized_bundle_engine';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Configurazione per l'ottimizzatore di transazioni miste
 */
export interface MixedTransactionOptimizerConfig {
  /** Numero di worker per tipo di transazione */
  workersPerType: number;
  /** Dimensione massima della coda per tipo di transazione */
  maxQueueSizePerType: number;
  /** Intervallo di elaborazione in millisecondi */
  processingIntervalMs: number;
  /** Timeout per l'elaborazione delle transazioni in millisecondi */
  transactionTimeoutMs: number;
  /** Fattore di priorità per le transazioni in attesa */
  waitingPriorityFactor: number;
  /** Abilita il bilanciamento del carico adattivo */
  enableAdaptiveLoadBalancing: boolean;
  /** Intervallo di adattamento del bilanciamento del carico in millisecondi */
  adaptiveLoadBalancingIntervalMs: number;
  /** Fattore di adattamento del bilanciamento del carico */
  adaptiveLoadBalancingFactor: number;
  /** Tipi di transazione supportati */
  supportedTransactionTypes: string[];
  /** Percorso del file worker */
  workerFilePath?: string;
}

/**
 * Stato della coda di transazioni
 */
export interface QueueStatus {
  /** Dimensione totale della coda */
  totalSize: number;
  /** Dimensione della coda per tipo di transazione */
  sizeByType: Record<string, number>;
  /** Percentuale di riempimento per tipo di transazione */
  fillPercentageByType: Record<string, number>;
  /** Tempo medio di attesa per tipo di transazione in millisecondi */
  averageWaitTimeByType: Record<string, number>;
  /** Transazione più vecchia per tipo di transazione in millisecondi */
  oldestTransactionByType: Record<string, number>;
}

/**
 * Stato dei worker
 */
export interface WorkerStatus {
  /** Numero totale di worker */
  totalWorkers: number;
  /** Numero di worker per tipo di transazione */
  workersByType: Record<string, number>;
  /** Numero di worker attivi per tipo di transazione */
  activeWorkersByType: Record<string, number>;
  /** Carico medio dei worker per tipo di transazione */
  averageLoadByType: Record<string, number>;
}

/**
 * Metriche di elaborazione
 */
export interface ProcessingMetrics {
  /** Numero totale di transazioni elaborate */
  totalProcessed: number;
  /** Numero di transazioni elaborate per tipo */
  processedByType: Record<string, number>;
  /** Tempo medio di elaborazione per tipo in millisecondi */
  averageProcessingTimeByType: Record<string, number>;
  /** Tasso di successo per tipo */
  successRateByType: Record<string, number>;
  /** Throughput per tipo (transazioni al secondo) */
  throughputByType: Record<string, number>;
}

/**
 * Transazione con timestamp di ingresso nella coda
 */
interface QueuedTransaction {
  /** Transazione */
  transaction: Transaction;
  /** Timestamp di ingresso nella coda */
  enqueuedAt: number;
  /** Priorità della transazione */
  priority: number;
  /** Tentativi di elaborazione */
  attempts: number;
}

/**
 * Messaggio del worker
 */
interface WorkerMessage {
  /** Tipo di messaggio */
  type: 'result' | 'status' | 'error';
  /** Dati del messaggio */
  data: any;
}

/**
 * Risultato dell'elaborazione di una transazione
 */
interface TransactionResult {
  /** ID della transazione */
  id: string;
  /** Successo dell'elaborazione */
  success: boolean;
  /** Hash della transazione (se successo) */
  hash?: string;
  /** Errore (se fallimento) */
  error?: string;
  /** Tempo di elaborazione in millisecondi */
  processingTimeMs: number;
}

/**
 * Classe che implementa l'ottimizzatore di transazioni miste
 */
export class MixedTransactionOptimizer extends EventEmitter {
  private config: MixedTransactionOptimizerConfig;
  private logger: Logger;
  private transactionQueues: Map<string, QueuedTransaction[]> = new Map();
  private workers: Map<string, Worker[]> = new Map();
  private workerStatus: Map<string, { active: boolean, lastActive: number, load: number }[]> = new Map();
  private processingInterval: NodeJS.Timeout | null = null;
  private adaptiveLoadBalancingInterval: NodeJS.Timeout | null = null;
  private processingMetrics: {
    totalProcessed: number;
    processedByType: Record<string, number>;
    processingTimeByType: Record<string, number[]>;
    successByType: Record<string, number>;
    failureByType: Record<string, number>;
    lastProcessedTimestamps: Record<string, number[]>;
  };
  private initialized: boolean = false;

  /**
   * Crea una nuova istanza dell'ottimizzatore di transazioni miste
   * 
   * @param config - Configurazione dell'ottimizzatore
   */
  constructor(config: Partial<MixedTransactionOptimizerConfig> = {}) {
    super();
    
    // Configurazione predefinita
    this.config = {
      workersPerType: Math.max(1, Math.floor(os.cpus().length / 4)),
      maxQueueSizePerType: 10000,
      processingIntervalMs: 100,
      transactionTimeoutMs: 30000,
      waitingPriorityFactor: 0.1,
      enableAdaptiveLoadBalancing: true,
      adaptiveLoadBalancingIntervalMs: 10000,
      adaptiveLoadBalancingFactor: 0.2,
      supportedTransactionTypes: ['buy', 'sell', 'transfer', 'swap', 'deposit', 'withdraw'],
      workerFilePath: path.join(__dirname, 'transaction_worker.js'),
      ...config
    };
    
    this.logger = new Logger('MixedTransactionOptimizer');
    
    // Inizializza le code di transazioni
    for (const type of this.config.supportedTransactionTypes) {
      this.transactionQueues.set(type, []);
      this.workerStatus.set(type, []);
    }
    
    // Inizializza le metriche di elaborazione
    this.processingMetrics = {
      totalProcessed: 0,
      processedByType: {},
      processingTimeByType: {},
      successByType: {},
      failureByType: {},
      lastProcessedTimestamps: {}
    };
    
    for (const type of this.config.supportedTransactionTypes) {
      this.processingMetrics.processedByType[type] = 0;
      this.processingMetrics.processingTimeByType[type] = [];
      this.processingMetrics.successByType[type] = 0;
      this.processingMetrics.failureByType[type] = 0;
      this.processingMetrics.lastProcessedTimestamps[type] = [];
    }
    
    this.logger.info('MixedTransactionOptimizer inizializzato', {
      supportedTypes: this.config.supportedTransactionTypes,
      workersPerType: this.config.workersPerType,
      maxQueueSizePerType: this.config.maxQueueSizePerType
    });
  }

  /**
   * Inizializza l'ottimizzatore di transazioni miste
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.info('MixedTransactionOptimizer già inizializzato');
      return;
    }
    
    try {
      this.logger.info('Inizializzazione MixedTransactionOptimizer');
      
      // Inizializza i worker per ogni tipo di transazione
      for (const type of this.config.supportedTransactionTypes) {
        await this.initializeWorkersForType(type);
      }
      
      // Avvia l'elaborazione delle transazioni
      this.startProcessing();
      
      // Avvia il bilanciamento del carico adattivo se abilitato
      if (this.config.enableAdaptiveLoadBalancing) {
        this.startAdaptiveLoadBalancing();
      }
      
      this.initialized = true;
      this.logger.info('MixedTransactionOptimizer inizializzato con successo', {
        totalWorkers: this.getTotalWorkerCount()
      });
    } catch (error) {
      this.logger.error('Errore durante l\'inizializzazione di MixedTransactionOptimizer', { error });
      throw new Error(`Errore durante l'inizializzazione di MixedTransactionOptimizer: ${error.message}`);
    }
  }

  /**
   * Inizializza i worker per un tipo di transazione
   * 
   * @param type - Tipo di transazione
   * @private
   */
  private async initializeWorkersForType(type: string): Promise<void> {
    try {
      this.logger.info(`Inizializzazione worker per il tipo di transazione: ${type}`);
      
      const workers: Worker[] = [];
      const workerStatusArray: { active: boolean, lastActive: number, load: number }[] = [];
      
      for (let i = 0; i < this.config.workersPerType; i++) {
        // Crea un nuovo worker
        const worker = new Worker(this.config.workerFilePath!, {
          workerData: {
            workerId: i,
            transactionType: type
          }
        });
        
        // Configura il gestore dei messaggi
        worker.on('message', (message: WorkerMessage) => {
          this.handleWorkerMessage(type, i, message);
        });
        
        // Configura il gestore degli errori
        worker.on('error', (error) => {
          this.logger.error(`Errore nel worker ${i} per il tipo ${type}`, { error });
          // Segna il worker come inattivo
          if (workerStatusArray[i]) {
            workerStatusArray[i].active = false;
          }
        });
        
        // Configura il gestore di uscita
        worker.on('exit', (code) => {
          this.logger.warn(`Worker ${i} per il tipo ${type} uscito con codice ${code}`);
          // Segna il worker come inattivo
          if (workerStatusArray[i]) {
            workerStatusArray[i].active = false;
          }
          // Ricrea il worker
          this.recreateWorker(type, i);
        });
        
        workers.push(worker);
        workerStatusArray.push({
          active: true,
          lastActive: Date.now(),
          load: 0
        });
      }
      
      this.workers.set(type, workers);
      this.workerStatus.set(type, workerStatusArray);
      
      this.logger.info(`Worker inizializzati per il tipo di transazione: ${type}`, {
        count: workers.length
      });
    } catch (error) {
      this.logger.error(`Errore durante l'inizializzazione dei worker per il tipo ${type}`, { error });
      throw new Error(`Errore durante l'inizializzazione dei worker per il tipo ${type}: ${error.message}`);
    }
  }

  /**
   * Ricrea un worker
   * 
   * @param type - Tipo di transazione
   * @param index - Indice del worker
   * @private
   */
  private recreateWorker(type: string, index: number): void {
    try {
      this.logger.info(`Ricreazione worker ${index} per il tipo ${type}`);
      
      const workers = this.workers.get(type);
      const workerStatusArray = this.workerStatus.get(type);
      
      if (!workers || !workerStatusArray) {
        this.logger.error(`Worker o stato non trovato per il tipo ${type}`);
        return;
      }
      
      // Crea un nuovo worker
      const worker = new Worker(this.config.workerFilePath!, {
        workerData: {
          workerId: index,
          transactionType: type
        }
      });
      
      // Configura il gestore dei messaggi
      worker.on('message', (message: WorkerMessage) => {
        this.handleWorkerMessage(type, index, message);
      });
      
      // Configura il gestore degli errori
      worker.on('error', (error) => {
        this.logger.error(`Errore nel worker ${index} per il tipo ${type}`, { error });
        // Segna il worker come inattivo
        if (workerStatusArray[index]) {
          workerStatusArray[index].active = false;
        }
      });
      
      // Configura il gestore di uscita
      worker.on('exit', (code) => {
        this.logger.warn(`Worker ${index} per il tipo ${type} uscito con codice ${code}`);
        // Segna il worker come inattivo
        if (workerStatusArray[index]) {
          workerStatusArray[index].active = false;
        }
        // Ricrea il worker
        this.recreateWorker(type, index);
      });
      
      // Sostituisci il worker
      workers[index] = worker;
      
      // Aggiorna lo stato del worker
      workerStatusArray[index] = {
        active: true,
        lastActive: Date.now(),
        load: 0
      };
      
      this.logger.info(`Worker ${index} per il tipo ${type} ricreato con successo`);
    } catch (error) {
      this.logger.error(`Errore durante la ricreazione del worker ${index} per il tipo ${type}`, { error });
      
      // Riprova dopo un ritardo
      setTimeout(() => {
        this.recreateWorker(type, index);
      }, 5000);
    }
  }

  /**
   * Gestisce i messaggi dai worker
   * 
   * @param type - Tipo di transazione
   * @param workerId - ID del worker
   * @param message - Messaggio dal worker
   * @private
   */
  private handleWorkerMessage(type: string, workerId: number, message: WorkerMessage): void {
    try {
      const workerStatusArray = this.workerStatus.get(type);
      
      if (!workerStatusArray || !workerStatusArray[workerId]) {
        this.logger.error(`Stato del worker non trovato per il tipo ${type} e l'ID ${workerId}`);
        return;
      }
      
      // Aggiorna il timestamp dell'ultima attività
      workerStatusArray[workerId].lastActive = Date.now();
      
      switch (message.type) {
        case 'result':
          this.handleTransactionResult(type, workerId, message.data);
          break;
        case 'status':
          this.updateWorkerStatus(type, workerId, message.data);
          break;
        case 'error':
          this.handleWorkerError(type, workerId, message.data);
          break;
        default:
          this.logger.warn(`Tipo di messaggio sconosciuto dal worker ${workerId} per il tipo ${type}`, { message });
      }
    } catch (error) {
      this.logger.error(`Errore durante la gestione del messaggio dal worker ${workerId} per il tipo ${type}`, { error });
    }
  }

  /**
   * Gestisce i risultati dell'elaborazione delle transazioni
   * 
   * @param type - Tipo di transazione
   * @param workerId - ID del worker
   * @param result - Risultato dell'elaborazione
   * @private
   */
  private handleTransactionResult(type: string, workerId: number, result: TransactionResult): void {
    try {
      this.logger.info(`Risultato dell'elaborazione della transazione dal worker ${workerId} per il tipo ${type}`, {
        transactionId: result.id,
        success: result.success,
        processingTimeMs: result.processingTimeMs
      });
      
      // Aggiorna le metriche di elaborazione
      this.processingMetrics.totalProcessed++;
      this.processingMetrics.processedByType[type]++;
      this.processingMetrics.processingTimeByType[type].push(result.processingTimeMs);
      
      // Limita l'array dei tempi di elaborazione
      if (this.processingMetrics.processingTimeByType[type].length > 1000) {
        this.processingMetrics.processingTimeByType[type] = this.processingMetrics.processingTimeByType[type].slice(-1000);
      }
      
      // Aggiorna i contatori di successo/fallimento
      if (result.success) {
        this.processingMetrics.successByType[type]++;
      } else {
        this.processingMetrics.failureByType[type]++;
      }
      
      // Aggiorna i timestamp di elaborazione
      const now = Date.now();
      this.processingMetrics.lastProcessedTimestamps[type].push(now);
      
      // Limita l'array dei timestamp
      if (this.processingMetrics.lastProcessedTimestamps[type].length > 1000) {
        this.processingMetrics.lastProcessedTimestamps[type] = this.processingMetrics.lastProcessedTimestamps[type].slice(-1000);
      }
      
      // Aggiorna lo stato del worker
      const workerStatusArray = this.workerStatus.get(type);
      if (workerStatusArray && workerStatusArray[workerId]) {
        // Riduce il carico del worker
        workerStatusArray[workerId].load = Math.max(0, workerStatusArray[workerId].load - 1);
      }
      
      // Emette l'evento di transazione elaborata
      this.emit('transactionProcessed', {
        id: result.id,
        type,
        success: result.success,
        hash: result.hash,
        error: result.error,
        processingTimeMs: result.processingTimeMs
      });
      
      // Elabora la prossima transazione per questo tipo
      this.processNextTransaction(type);
    } catch (error) {
      this.logger.error(`Errore durante la gestione del risultato della transazione dal worker ${workerId} per il tipo ${type}`, { error });
    }
  }

  /**
   * Aggiorna lo stato di un worker
   * 
   * @param type - Tipo di transazione
   * @param workerId - ID del worker
   * @param status - Stato del worker
   * @private
   */
  private updateWorkerStatus(type: string, workerId: number, status: { load: number }): void {
    try {
      const workerStatusArray = this.workerStatus.get(type);
      
      if (!workerStatusArray || !workerStatusArray[workerId]) {
        this.logger.error(`Stato del worker non trovato per il tipo ${type} e l'ID ${workerId}`);
        return;
      }
      
      // Aggiorna il carico del worker
      workerStatusArray[workerId].load = status.load;
      
      this.logger.debug(`Stato del worker ${workerId} per il tipo ${type} aggiornato`, {
        load: status.load
      });
    } catch (error) {
      this.logger.error(`Errore durante l'aggiornamento dello stato del worker ${workerId} per il tipo ${type}`, { error });
    }
  }

  /**
   * Gestisce gli errori dei worker
   * 
   * @param type - Tipo di transazione
   * @param workerId - ID del worker
   * @param error - Errore
   * @private
   */
  private handleWorkerError(type: string, workerId: number, error: any): void {
    try {
      this.logger.error(`Errore dal worker ${workerId} per il tipo ${type}`, { error });
      
      // Aggiorna lo stato del worker
      const workerStatusArray = this.workerStatus.get(type);
      
      if (!workerStatusArray || !workerStatusArray[workerId]) {
        this.logger.error(`Stato del worker non trovato per il tipo ${type} e l'ID ${workerId}`);
        return;
      }
      
      // Riduce il carico del worker in caso di errore
      workerStatusArray[workerId].load = Math.max(0, workerStatusArray[workerId].load - 1);
      
      // Emette l'evento di errore del worker
      this.emit('workerError', {
        type,
        workerId,
        error
      });
    } catch (error) {
      this.logger.error(`Errore durante la gestione dell'errore dal worker ${workerId} per il tipo ${type}`, { error });
    }
  }

  /**
   * Avvia l'elaborazione delle transazioni
   * 
   * @private
   */
  private startProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    
    this.processingInterval = setInterval(() => {
      try {
        // Elabora le transazioni per ogni tipo
        for (const type of this.config.supportedTransactionTypes) {
          this.processNextTransaction(type);
        }
        
        // Pulisci le transazioni scadute
        this.cleanupExpiredTransactions();
      } catch (error) {
        this.logger.error('Errore durante l\'elaborazione delle transazioni', { error });
      }
    }, this.config.processingIntervalMs);
    
    this.logger.info('Elaborazione delle transazioni avviata', {
      intervalMs: this.config.processingIntervalMs
    });
  }

  /**
   * Avvia il bilanciamento del carico adattivo
   * 
   * @private
   */
  private startAdaptiveLoadBalancing(): void {
    if (this.adaptiveLoadBalancingInterval) {
      clearInterval(this.adaptiveLoadBalancingInterval);
    }
    
    this.adaptiveLoadBalancingInterval = setInterval(() => {
      try {
        this.balanceWorkersAdaptively();
      } catch (error) {
        this.logger.error('Errore durante il bilanciamento del carico adattivo', { error });
      }
    }, this.config.adaptiveLoadBalancingIntervalMs);
    
    this.logger.info('Bilanciamento del carico adattivo avviato', {
      intervalMs: this.config.adaptiveLoadBalancingIntervalMs
    });
  }

  /**
   * Bilancia i worker in modo adattivo
   * 
   * @private
   */
  private balanceWorkersAdaptively(): void {
    try {
      this.logger.info('Esecuzione del bilanciamento del carico adattivo');
      
      // Calcola il carico per ogni tipo di transazione
      const typeLoads: Record<string, number> = {};
      let totalLoad = 0;
      
      for (const type of this.config.supportedTransactionTypes) {
        const queue = this.transactionQueues.get(type) || [];
        const queueSize = queue.length;
        
        // Calcola il throughput recente
        const recentTimestamps = this.processingMetrics.lastProcessedTimestamps[type] || [];
        const recentCount = recentTimestamps.filter(ts => Date.now() - ts < 60000).length;
        const throughput = recentCount / 60; // Transazioni al secondo
        
        // Calcola il carico come combinazione di dimensione della coda e throughput
        const load = (queueSize * 0.7) + (throughput * 0.3);
        
        typeLoads[type] = load;
        totalLoad += load;
      }
      
      // Se il carico totale è zero, non fare nulla
      if (totalLoad === 0) {
        this.logger.info('Carico totale zero, nessun bilanciamento necessario');
        return;
      }
      
      // Calcola la distribuzione ideale dei worker
      const totalWorkers = this.getTotalWorkerCount();
      const idealDistribution: Record<string, number> = {};
      
      for (const type of this.config.supportedTransactionTypes) {
        const loadPercentage = typeLoads[type] / totalLoad;
        idealDistribution[type] = Math.max(1, Math.round(totalWorkers * loadPercentage));
      }
      
      // Assicurati che la somma sia uguale al totale
      let sum = Object.values(idealDistribution).reduce((a, b) => a + b, 0);
      
      while (sum !== totalWorkers) {
        if (sum < totalWorkers) {
          // Aggiungi worker al tipo con il carico più alto
          const typeWithHighestLoad = Object.entries(typeLoads)
            .sort((a, b) => b[1] - a[1])[0][0];
          idealDistribution[typeWithHighestLoad]++;
        } else {
          // Rimuovi worker dal tipo con il carico più basso
          const typeWithLowestLoad = Object.entries(typeLoads)
            .sort((a, b) => a[1] - b[1])[0][0];
          
          if (idealDistribution[typeWithLowestLoad] > 1) {
            idealDistribution[typeWithLowestLoad]--;
          } else {
            // Se non possiamo ridurre ulteriormente, riduci dal secondo più basso
            const types = Object.entries(typeLoads)
              .sort((a, b) => a[1] - b[1])
              .map(([type]) => type);
            
            for (let i = 1; i < types.length; i++) {
              if (idealDistribution[types[i]] > 1) {
                idealDistribution[types[i]]--;
                break;
              }
            }
          }
        }
        
        sum = Object.values(idealDistribution).reduce((a, b) => a + b, 0);
      }
      
      // Ottieni la distribuzione attuale
      const currentDistribution: Record<string, number> = {};
      
      for (const type of this.config.supportedTransactionTypes) {
        const workers = this.workers.get(type) || [];
        currentDistribution[type] = workers.length;
      }
      
      // Calcola le differenze
      const differences: Record<string, number> = {};
      
      for (const type of this.config.supportedTransactionTypes) {
        differences[type] = idealDistribution[type] - currentDistribution[type];
      }
      
      // Applica le modifiche gradualmente
      for (const type of this.config.supportedTransactionTypes) {
        const diff = differences[type];
        
        if (diff > 0) {
          // Aggiungi worker
          const toAdd = Math.ceil(diff * this.config.adaptiveLoadBalancingFactor);
          this.addWorkersForType(type, toAdd);
        } else if (diff < 0) {
          // Rimuovi worker
          const toRemove = Math.ceil(Math.abs(diff) * this.config.adaptiveLoadBalancingFactor);
          this.removeWorkersForType(type, toRemove);
        }
      }
      
      this.logger.info('Bilanciamento del carico adattivo completato', {
        typeLoads,
        idealDistribution,
        currentDistribution,
        differences
      });
    } catch (error) {
      this.logger.error('Errore durante il bilanciamento del carico adattivo', { error });
    }
  }

  /**
   * Aggiunge worker per un tipo di transazione
   * 
   * @param type - Tipo di transazione
   * @param count - Numero di worker da aggiungere
   * @private
   */
  private addWorkersForType(type: string, count: number): void {
    try {
      this.logger.info(`Aggiunta di ${count} worker per il tipo ${type}`);
      
      const workers = this.workers.get(type) || [];
      const workerStatusArray = this.workerStatus.get(type) || [];
      
      for (let i = 0; i < count; i++) {
        const workerId = workers.length;
        
        // Crea un nuovo worker
        const worker = new Worker(this.config.workerFilePath!, {
          workerData: {
            workerId,
            transactionType: type
          }
        });
        
        // Configura il gestore dei messaggi
        worker.on('message', (message: WorkerMessage) => {
          this.handleWorkerMessage(type, workerId, message);
        });
        
        // Configura il gestore degli errori
        worker.on('error', (error) => {
          this.logger.error(`Errore nel worker ${workerId} per il tipo ${type}`, { error });
          // Segna il worker come inattivo
          if (workerStatusArray[workerId]) {
            workerStatusArray[workerId].active = false;
          }
        });
        
        // Configura il gestore di uscita
        worker.on('exit', (code) => {
          this.logger.warn(`Worker ${workerId} per il tipo ${type} uscito con codice ${code}`);
          // Segna il worker come inattivo
          if (workerStatusArray[workerId]) {
            workerStatusArray[workerId].active = false;
          }
          // Ricrea il worker
          this.recreateWorker(type, workerId);
        });
        
        workers.push(worker);
        workerStatusArray.push({
          active: true,
          lastActive: Date.now(),
          load: 0
        });
      }
      
      this.workers.set(type, workers);
      this.workerStatus.set(type, workerStatusArray);
      
      this.logger.info(`Aggiunti ${count} worker per il tipo ${type}`, {
        totalWorkers: workers.length
      });
    } catch (error) {
      this.logger.error(`Errore durante l'aggiunta di worker per il tipo ${type}`, { error });
    }
  }

  /**
   * Rimuove worker per un tipo di transazione
   * 
   * @param type - Tipo di transazione
   * @param count - Numero di worker da rimuovere
   * @private
   */
  private removeWorkersForType(type: string, count: number): void {
    try {
      this.logger.info(`Rimozione di ${count} worker per il tipo ${type}`);
      
      const workers = this.workers.get(type) || [];
      const workerStatusArray = this.workerStatus.get(type) || [];
      
      // Assicurati di mantenere almeno un worker
      const actualCount = Math.min(count, workers.length - 1);
      
      if (actualCount <= 0) {
        this.logger.info(`Nessun worker da rimuovere per il tipo ${type}`);
        return;
      }
      
      // Rimuovi i worker con il carico più basso
      const workersToRemove = workerStatusArray
        .map((status, index) => ({ index, load: status.load }))
        .sort((a, b) => a.load - b.load)
        .slice(0, actualCount)
        .map(w => w.index);
      
      for (const index of workersToRemove) {
        const worker = workers[index];
        
        if (worker) {
          // Termina il worker
          worker.terminate();
          
          // Segna il worker come inattivo
          if (workerStatusArray[index]) {
            workerStatusArray[index].active = false;
          }
        }
      }
      
      // Rimuovi i worker terminati
      const newWorkers = workers.filter((_, index) => !workersToRemove.includes(index));
      const newWorkerStatus = workerStatusArray.filter((_, index) => !workersToRemove.includes(index));
      
      this.workers.set(type, newWorkers);
      this.workerStatus.set(type, newWorkerStatus);
      
      this.logger.info(`Rimossi ${actualCount} worker per il tipo ${type}`, {
        totalWorkers: newWorkers.length
      });
    } catch (error) {
      this.logger.error(`Errore durante la rimozione di worker per il tipo ${type}`, { error });
    }
  }

  /**
   * Elabora la prossima transazione per un tipo
   * 
   * @param type - Tipo di transazione
   * @private
   */
  private processNextTransaction(type: string): void {
    try {
      const queue = this.transactionQueues.get(type);
      
      if (!queue || queue.length === 0) {
        return;
      }
      
      const workers = this.workers.get(type);
      const workerStatusArray = this.workerStatus.get(type);
      
      if (!workers || !workerStatusArray || workers.length === 0) {
        this.logger.error(`Worker non trovati per il tipo ${type}`);
        return;
      }
      
      // Trova un worker disponibile
      const availableWorkerIndex = workerStatusArray.findIndex(status => 
        status.active && status.load === 0);
      
      if (availableWorkerIndex === -1) {
        // Nessun worker disponibile
        return;
      }
      
      // Ordina la coda per priorità e tempo di attesa
      queue.sort((a, b) => {
        // Calcola la priorità effettiva considerando il tempo di attesa
        const waitTimeA = Date.now() - a.enqueuedAt;
        const waitTimeB = Date.now() - b.enqueuedAt;
        
        const effectivePriorityA = a.priority + (waitTimeA / 1000) * this.config.waitingPriorityFactor;
        const effectivePriorityB = b.priority + (waitTimeB / 1000) * this.config.waitingPriorityFactor;
        
        // Ordina per priorità effettiva (decrescente)
        return effectivePriorityB - effectivePriorityA;
      });
      
      // Prendi la transazione con la priorità più alta
      const queuedTransaction = queue.shift();
      
      if (!queuedTransaction) {
        return;
      }
      
      // Aggiorna lo stato del worker
      workerStatusArray[availableWorkerIndex].load = 1;
      workerStatusArray[availableWorkerIndex].lastActive = Date.now();
      
      // Invia la transazione al worker
      workers[availableWorkerIndex].postMessage({
        type: 'process',
        data: {
          transaction: queuedTransaction.transaction,
          enqueuedAt: queuedTransaction.enqueuedAt,
          priority: queuedTransaction.priority,
          attempts: queuedTransaction.attempts
        }
      });
      
      this.logger.info(`Transazione inviata al worker ${availableWorkerIndex} per il tipo ${type}`, {
        transactionId: queuedTransaction.transaction.id,
        priority: queuedTransaction.priority,
        waitTimeMs: Date.now() - queuedTransaction.enqueuedAt,
        attempts: queuedTransaction.attempts
      });
    } catch (error) {
      this.logger.error(`Errore durante l'elaborazione della prossima transazione per il tipo ${type}`, { error });
    }
  }

  /**
   * Pulisce le transazioni scadute
   * 
   * @private
   */
  private cleanupExpiredTransactions(): void {
    try {
      const now = Date.now();
      let totalExpired = 0;
      
      for (const type of this.config.supportedTransactionTypes) {
        const queue = this.transactionQueues.get(type);
        
        if (!queue) {
          continue;
        }
        
        const expiredTransactions = queue.filter(tx => 
          now - tx.enqueuedAt > this.config.transactionTimeoutMs);
        
        if (expiredTransactions.length > 0) {
          // Rimuovi le transazioni scadute dalla coda
          this.transactionQueues.set(type, queue.filter(tx => 
            now - tx.enqueuedAt <= this.config.transactionTimeoutMs));
          
          totalExpired += expiredTransactions.length;
          
          this.logger.warn(`Transazioni scadute rimosse per il tipo ${type}`, {
            count: expiredTransactions.length,
            maxAgeMs: this.config.transactionTimeoutMs
          });
          
          // Emetti l'evento di transazioni scadute
          for (const tx of expiredTransactions) {
            this.emit('transactionExpired', {
              id: tx.transaction.id,
              type,
              waitTimeMs: now - tx.enqueuedAt
            });
          }
        }
      }
      
      if (totalExpired > 0) {
        this.logger.warn(`Totale transazioni scadute rimosse: ${totalExpired}`);
      }
    } catch (error) {
      this.logger.error('Errore durante la pulizia delle transazioni scadute', { error });
    }
  }

  /**
   * Aggiunge una transazione alla coda appropriata
   * 
   * @param transaction - Transazione da aggiungere
   * @param type - Tipo di transazione
   * @param priority - Priorità della transazione (maggiore = più importante)
   * @returns Promise che si risolve con true se la transazione è stata aggiunta, false altrimenti
   */
  async addTransaction(transaction: Transaction, type: string, priority: number = 1): Promise<boolean> {
    try {
      // Verifica se il tipo è supportato
      if (!this.config.supportedTransactionTypes.includes(type)) {
        this.logger.error('Tipo di transazione non supportato', {
          transactionId: transaction.id,
          type
        });
        return false;
      }
      
      const queue = this.transactionQueues.get(type);
      
      if (!queue) {
        this.logger.error('Coda non trovata per il tipo di transazione', {
          transactionId: transaction.id,
          type
        });
        return false;
      }
      
      // Verifica se la coda è piena
      if (queue.length >= this.config.maxQueueSizePerType) {
        this.logger.error('Coda piena per il tipo di transazione', {
          transactionId: transaction.id,
          type,
          queueSize: queue.length,
          maxQueueSize: this.config.maxQueueSizePerType
        });
        
        // Emette l'evento di coda piena
        this.emit('queueFull', {
          id: transaction.id,
          type
        });
        
        return false;
      }
      
      // Crea la transazione in coda
      const queuedTransaction: QueuedTransaction = {
        transaction,
        enqueuedAt: Date.now(),
        priority,
        attempts: 0
      };
      
      // Aggiunge la transazione alla coda
      queue.push(queuedTransaction);
      
      this.logger.info('Transazione aggiunta alla coda', {
        transactionId: transaction.id,
        type,
        priority,
        queueSize: queue.length
      });
      
      // Emette l'evento di transazione aggiunta
      this.emit('transactionQueued', {
        id: transaction.id,
        type,
        priority
      });
      
      // Prova a elaborare la transazione immediatamente se ci sono worker disponibili
      this.processNextTransaction(type);
      
      return true;
    } catch (error) {
      this.logger.error('Errore durante l\'aggiunta della transazione alla coda', { error });
      return false;
    }
  }

  /**
   * Ottiene lo stato della coda
   * 
   * @returns Stato della coda
   */
  getQueueStatus(): QueueStatus {
    try {
      const now = Date.now();
      let totalSize = 0;
      const sizeByType: Record<string, number> = {};
      const fillPercentageByType: Record<string, number> = {};
      const averageWaitTimeByType: Record<string, number> = {};
      const oldestTransactionByType: Record<string, number> = {};
      
      for (const type of this.config.supportedTransactionTypes) {
        const queue = this.transactionQueues.get(type) || [];
        totalSize += queue.length;
        sizeByType[type] = queue.length;
        fillPercentageByType[type] = (queue.length / this.config.maxQueueSizePerType) * 100;
        
        // Calcola il tempo medio di attesa
        if (queue.length > 0) {
          const totalWaitTime = queue.reduce((sum, tx) => sum + (now - tx.enqueuedAt), 0);
          averageWaitTimeByType[type] = totalWaitTime / queue.length;
          
          // Trova la transazione più vecchia
          const oldestTime = Math.min(...queue.map(tx => tx.enqueuedAt));
          oldestTransactionByType[type] = now - oldestTime;
        } else {
          averageWaitTimeByType[type] = 0;
          oldestTransactionByType[type] = 0;
        }
      }
      
      return {
        totalSize,
        sizeByType,
        fillPercentageByType,
        averageWaitTimeByType,
        oldestTransactionByType
      };
    } catch (error) {
      this.logger.error('Errore durante l\'ottenimento dello stato della coda', { error });
      
      // Restituisce uno stato predefinito in caso di errore
      return {
        totalSize: 0,
        sizeByType: {},
        fillPercentageByType: {},
        averageWaitTimeByType: {},
        oldestTransactionByType: {}
      };
    }
  }

  /**
   * Ottiene lo stato dei worker
   * 
   * @returns Stato dei worker
   */
  getWorkerStatus(): WorkerStatus {
    try {
      let totalWorkers = 0;
      const workersByType: Record<string, number> = {};
      const activeWorkersByType: Record<string, number> = {};
      const averageLoadByType: Record<string, number> = {};
      
      for (const type of this.config.supportedTransactionTypes) {
        const workers = this.workers.get(type) || [];
        const workerStatusArray = this.workerStatus.get(type) || [];
        
        totalWorkers += workers.length;
        workersByType[type] = workers.length;
        
        // Conta i worker attivi
        const activeWorkers = workerStatusArray.filter(status => status.active);
        activeWorkersByType[type] = activeWorkers.length;
        
        // Calcola il carico medio
        if (activeWorkers.length > 0) {
          const totalLoad = activeWorkers.reduce((sum, status) => sum + status.load, 0);
          averageLoadByType[type] = totalLoad / activeWorkers.length;
        } else {
          averageLoadByType[type] = 0;
        }
      }
      
      return {
        totalWorkers,
        workersByType,
        activeWorkersByType,
        averageLoadByType
      };
    } catch (error) {
      this.logger.error('Errore durante l\'ottenimento dello stato dei worker', { error });
      
      // Restituisce uno stato predefinito in caso di errore
      return {
        totalWorkers: 0,
        workersByType: {},
        activeWorkersByType: {},
        averageLoadByType: {}
      };
    }
  }

  /**
   * Ottiene le metriche di elaborazione
   * 
   * @returns Metriche di elaborazione
   */
  getProcessingMetrics(): ProcessingMetrics {
    try {
      const processedByType: Record<string, number> = {};
      const averageProcessingTimeByType: Record<string, number> = {};
      const successRateByType: Record<string, number> = {};
      const throughputByType: Record<string, number> = {};
      
      for (const type of this.config.supportedTransactionTypes) {
        processedByType[type] = this.processingMetrics.processedByType[type] || 0;
        
        // Calcola il tempo medio di elaborazione
        const processingTimes = this.processingMetrics.processingTimeByType[type] || [];
        if (processingTimes.length > 0) {
          const totalTime = processingTimes.reduce((sum, time) => sum + time, 0);
          averageProcessingTimeByType[type] = totalTime / processingTimes.length;
        } else {
          averageProcessingTimeByType[type] = 0;
        }
        
        // Calcola il tasso di successo
        const success = this.processingMetrics.successByType[type] || 0;
        const failure = this.processingMetrics.failureByType[type] || 0;
        const total = success + failure;
        
        if (total > 0) {
          successRateByType[type] = (success / total) * 100;
        } else {
          successRateByType[type] = 0;
        }
        
        // Calcola il throughput
        const recentTimestamps = this.processingMetrics.lastProcessedTimestamps[type] || [];
        const recentCount = recentTimestamps.filter(ts => Date.now() - ts < 60000).length;
        throughputByType[type] = recentCount / 60; // Transazioni al secondo
      }
      
      return {
        totalProcessed: this.processingMetrics.totalProcessed,
        processedByType,
        averageProcessingTimeByType,
        successRateByType,
        throughputByType
      };
    } catch (error) {
      this.logger.error('Errore durante l\'ottenimento delle metriche di elaborazione', { error });
      
      // Restituisce metriche predefinite in caso di errore
      return {
        totalProcessed: 0,
        processedByType: {},
        averageProcessingTimeByType: {},
        successRateByType: {},
        throughputByType: {}
      };
    }
  }

  /**
   * Ottiene il numero totale di worker
   * 
   * @returns Numero totale di worker
   * @private
   */
  private getTotalWorkerCount(): number {
    let total = 0;
    
    for (const type of this.config.supportedTransactionTypes) {
      const workers = this.workers.get(type) || [];
      total += workers.length;
    }
    
    return total;
  }

  /**
   * Ottiene la configurazione
   * 
   * @returns Configurazione
   */
  getConfig(): MixedTransactionOptimizerConfig {
    return { ...this.config };
  }

  /**
   * Aggiorna la configurazione
   * 
   * @param config - Nuova configurazione
   */
  updateConfig(config: Partial<MixedTransactionOptimizerConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
    
    this.logger.info('Configurazione aggiornata', {
      workersPerType: this.config.workersPerType,
      maxQueueSizePerType: this.config.maxQueueSizePerType,
      processingIntervalMs: this.config.processingIntervalMs
    });
  }

  /**
   * Arresta l'ottimizzatore di transazioni miste
   */
  async shutdown(): Promise<void> {
    try {
      this.logger.info('Arresto di MixedTransactionOptimizer');
      
      // Arresta l'elaborazione delle transazioni
      if (this.processingInterval) {
        clearInterval(this.processingInterval);
        this.processingInterval = null;
      }
      
      // Arresta il bilanciamento del carico adattivo
      if (this.adaptiveLoadBalancingInterval) {
        clearInterval(this.adaptiveLoadBalancingInterval);
        this.adaptiveLoadBalancingInterval = null;
      }
      
      // Termina tutti i worker
      for (const type of this.config.supportedTransactionTypes) {
        const workers = this.workers.get(type) || [];
        
        for (const worker of workers) {
          worker.terminate();
        }
      }
      
      // Pulisci le mappe
      this.workers.clear();
      this.workerStatus.clear();
      
      this.logger.info('MixedTransactionOptimizer arrestato con successo');
    } catch (error) {
      this.logger.error('Errore durante l\'arresto di MixedTransactionOptimizer', { error });
      throw new Error(`Errore durante l'arresto di MixedTransactionOptimizer: ${error.message}`);
    }
  }
}

// Codice del worker
if (!isMainThread) {
  const { workerId, transactionType } = workerData;
  const logger = new Logger(`TransactionWorker-${workerId}-${transactionType}`);
  
  logger.info('Worker avviato', { workerId, transactionType });
  
  // Configura il gestore dei messaggi
  parentPort!.on('message', async (message: any) => {
    try {
      if (message.type === 'process') {
        await processTransaction(message.data);
      } else {
        logger.warn('Tipo di messaggio sconosciuto', { message });
      }
    } catch (error) {
      logger.error('Errore durante l\'elaborazione del messaggio', { error });
      
      // Invia l'errore al thread principale
      parentPort!.postMessage({
        type: 'error',
        data: {
          error: error.message,
          stack: error.stack
        }
      });
    }
  });
  
  /**
   * Elabora una transazione
   * 
   * @param data - Dati della transazione
   */
  async function processTransaction(data: {
    transaction: Transaction,
    enqueuedAt: number,
    priority: number,
    attempts: number
  }): Promise<void> {
    try {
      const startTime = Date.now();
      
      logger.info('Elaborazione transazione', {
        id: data.transaction.id,
        type: data.transaction.type,
        priority: data.priority,
        waitTimeMs: startTime - data.enqueuedAt,
        attempts: data.attempts
      });
      
      // Invia lo stato al thread principale
      parentPort!.postMessage({
        type: 'status',
        data: {
          load: 1
        }
      });
      
      // Simula l'elaborazione della transazione
      // In un'implementazione reale, qui ci sarebbe la logica specifica per il tipo di transazione
      const processingTime = getProcessingTimeForType(transactionType, data.transaction);
      await new Promise(resolve => setTimeout(resolve, processingTime));
      
      // Simula un tasso di successo del 98%
      const success = Math.random() < 0.98;
      
      const processingTimeMs = Date.now() - startTime;
      
      if (success) {
        // Genera un hash di transazione
        const hash = `0x${crypto.randomBytes(32).toString('hex')}`;
        
        logger.info('Transazione elaborata con successo', {
          id: data.transaction.id,
          hash,
          processingTimeMs
        });
        
        // Invia il risultato al thread principale
        parentPort!.postMessage({
          type: 'result',
          data: {
            id: data.transaction.id,
            success: true,
            hash,
            processingTimeMs
          }
        });
      } else {
        logger.error('Elaborazione della transazione fallita', {
          id: data.transaction.id,
          processingTimeMs
        });
        
        // Invia il risultato al thread principale
        parentPort!.postMessage({
          type: 'result',
          data: {
            id: data.transaction.id,
            success: false,
            error: 'Errore durante l\'elaborazione della transazione',
            processingTimeMs
          }
        });
      }
      
      // Aggiorna lo stato del worker
      parentPort!.postMessage({
        type: 'status',
        data: {
          load: 0
        }
      });
    } catch (error) {
      logger.error('Errore durante l\'elaborazione della transazione', { error });
      
      // Invia il risultato al thread principale
      parentPort!.postMessage({
        type: 'result',
        data: {
          id: data.transaction.id,
          success: false,
          error: error.message,
          processingTimeMs: Date.now() - data.enqueuedAt
        }
      });
      
      // Aggiorna lo stato del worker
      parentPort!.postMessage({
        type: 'status',
        data: {
          load: 0
        }
      });
    }
  }
  
  /**
   * Ottiene il tempo di elaborazione per un tipo di transazione
   * 
   * @param type - Tipo di transazione
   * @param transaction - Transazione
   * @returns Tempo di elaborazione in millisecondi
   */
  function getProcessingTimeForType(type: string, transaction: Transaction): number {
    // Simula tempi di elaborazione diversi per tipi diversi
    switch (type) {
      case 'buy':
        return Math.floor(Math.random() * 20) + 30; // 30-50ms
      case 'sell':
        return Math.floor(Math.random() * 20) + 30; // 30-50ms
      case 'transfer':
        return Math.floor(Math.random() * 10) + 20; // 20-30ms
      case 'swap':
        return Math.floor(Math.random() * 30) + 40; // 40-70ms
      case 'deposit':
        return Math.floor(Math.random() * 40) + 60; // 60-100ms
      case 'withdraw':
        return Math.floor(Math.random() * 40) + 60; // 60-100ms
      default:
        return Math.floor(Math.random() * 30) + 50; // 50-80ms
    }
  }
}
