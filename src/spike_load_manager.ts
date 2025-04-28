/**
 * Sistema di gestione dei picchi di carico per Layer-2 Solana
 * 
 * Questo modulo implementa un sistema avanzato per la gestione dei picchi di carico con:
 * - Sistema di throttling adattivo
 * - Buffer di transazioni per assorbire i picchi
 * - Monitoraggio in tempo reale del carico di sistema
 * 
 * @module spike_load_manager
 */

import { EventEmitter } from 'events';
import { Logger } from './utils/logger';
import { Transaction } from './optimized_bundle_engine';
import * as os from 'os';

/**
 * Configurazione per il gestore dei picchi di carico
 */
export interface SpikeLoadManagerConfig {
  /** Capacità massima di transazioni al secondo */
  maxTps: number;
  /** Soglia di attivazione del throttling (percentuale della capacità massima) */
  throttlingThreshold: number;
  /** Dimensione massima del buffer di transazioni */
  maxBufferSize: number;
  /** Intervallo di monitoraggio in millisecondi */
  monitoringIntervalMs: number;
  /** Tempo massimo di permanenza di una transazione nel buffer (ms) */
  maxBufferTimeMs: number;
  /** Fattore di riduzione del throttling */
  throttlingReductionFactor: number;
  /** Intervallo di adattamento del throttling (ms) */
  throttlingAdaptIntervalMs: number;
  /** Utilizzo massimo della CPU prima di attivare il throttling */
  maxCpuUtilization: number;
  /** Utilizzo massimo della memoria prima di attivare il throttling */
  maxMemoryUtilization: number;
  /** Priorità minima per l'elaborazione durante il throttling */
  minPriorityDuringThrottling: number;
}

/**
 * Stato del buffer di transazioni
 */
export interface BufferStatus {
  /** Numero di transazioni nel buffer */
  size: number;
  /** Capacità massima del buffer */
  capacity: number;
  /** Percentuale di riempimento */
  fillPercentage: number;
  /** Tempo medio di permanenza nel buffer (ms) */
  averageWaitTimeMs: number;
  /** Transazione più vecchia nel buffer (ms) */
  oldestTransactionMs: number;
  /** Distribuzione delle priorità nel buffer */
  priorityDistribution: Record<string, number>;
}

/**
 * Stato del throttling
 */
export interface ThrottlingStatus {
  /** Se il throttling è attivo */
  active: boolean;
  /** Livello attuale di throttling (0-1, dove 1 è throttling massimo) */
  level: number;
  /** Motivo dell'attivazione del throttling */
  reason: string;
  /** Tempo di attivazione */
  activatedAt: number;
  /** TPS target durante il throttling */
  targetTps: number;
  /** Priorità minima per l'elaborazione */
  minPriority: number;
}

/**
 * Metriche di sistema
 */
export interface SystemMetrics {
  /** Utilizzo della CPU (0-1) */
  cpuUtilization: number;
  /** Utilizzo della memoria (0-1) */
  memoryUtilization: number;
  /** Carico medio del sistema */
  loadAverage: number[];
  /** TPS corrente */
  currentTps: number;
  /** TPS massimo registrato */
  peakTps: number;
  /** Latenza media delle transazioni (ms) */
  averageLatencyMs: number;
}

/**
 * Transazione con timestamp di ingresso nel buffer
 */
interface BufferedTransaction {
  /** Transazione */
  transaction: Transaction;
  /** Timestamp di ingresso nel buffer */
  enqueuedAt: number;
  /** Priorità della transazione */
  priority: number;
}

/**
 * Classe che implementa il gestore dei picchi di carico
 */
export class SpikeLoadManager extends EventEmitter {
  private config: SpikeLoadManagerConfig;
  private logger: Logger;
  private transactionBuffer: BufferedTransaction[] = [];
  private throttlingStatus: ThrottlingStatus;
  private systemMetrics: SystemMetrics;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private throttlingAdaptInterval: NodeJS.Timeout | null = null;
  private transactionCounter: number = 0;
  private lastCounterReset: number = Date.now();
  private latencyMeasurements: number[] = [];
  private initialized: boolean = false;

  /**
   * Crea una nuova istanza del gestore dei picchi di carico
   * 
   * @param config - Configurazione del gestore
   */
  constructor(config: Partial<SpikeLoadManagerConfig> = {}) {
    super();
    
    // Configurazione predefinita
    this.config = {
      maxTps: 12000,
      throttlingThreshold: 0.8,
      maxBufferSize: 50000,
      monitoringIntervalMs: 1000,
      maxBufferTimeMs: 30000,
      throttlingReductionFactor: 0.8,
      throttlingAdaptIntervalMs: 5000,
      maxCpuUtilization: 0.85,
      maxMemoryUtilization: 0.9,
      minPriorityDuringThrottling: 3,
      ...config
    };
    
    this.logger = new Logger('SpikeLoadManager');
    
    // Inizializza lo stato del throttling
    this.throttlingStatus = {
      active: false,
      level: 0,
      reason: 'none',
      activatedAt: 0,
      targetTps: this.config.maxTps,
      minPriority: 0
    };
    
    // Inizializza le metriche di sistema
    this.systemMetrics = {
      cpuUtilization: 0,
      memoryUtilization: 0,
      loadAverage: [0, 0, 0],
      currentTps: 0,
      peakTps: 0,
      averageLatencyMs: 0
    };
    
    this.logger.info('SpikeLoadManager inizializzato', {
      maxTps: this.config.maxTps,
      throttlingThreshold: this.config.throttlingThreshold,
      maxBufferSize: this.config.maxBufferSize
    });
  }

  /**
   * Inizializza il gestore dei picchi di carico
   */
  initialize(): void {
    if (this.initialized) {
      this.logger.info('SpikeLoadManager già inizializzato');
      return;
    }
    
    this.logger.info('Inizializzazione SpikeLoadManager');
    
    // Avvia il monitoraggio del sistema
    this.startMonitoring();
    
    // Avvia l'adattamento del throttling
    this.startThrottlingAdaptation();
    
    this.initialized = true;
    this.logger.info('SpikeLoadManager inizializzato con successo');
  }

  /**
   * Avvia il monitoraggio del sistema
   * 
   * @private
   */
  private startMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    this.monitoringInterval = setInterval(() => {
      this.updateSystemMetrics();
      this.checkThrottlingConditions();
      this.processBuffer();
      this.cleanupOldTransactions();
    }, this.config.monitoringIntervalMs);
    
    this.logger.info('Monitoraggio del sistema avviato', {
      intervalMs: this.config.monitoringIntervalMs
    });
  }

  /**
   * Avvia l'adattamento del throttling
   * 
   * @private
   */
  private startThrottlingAdaptation(): void {
    if (this.throttlingAdaptInterval) {
      clearInterval(this.throttlingAdaptInterval);
    }
    
    this.throttlingAdaptInterval = setInterval(() => {
      this.adaptThrottling();
    }, this.config.throttlingAdaptIntervalMs);
    
    this.logger.info('Adattamento del throttling avviato', {
      intervalMs: this.config.throttlingAdaptIntervalMs
    });
  }

  /**
   * Aggiorna le metriche di sistema
   * 
   * @private
   */
  private updateSystemMetrics(): void {
    try {
      // Calcola l'utilizzo della CPU
      const cpus = os.cpus();
      let totalIdle = 0;
      let totalTick = 0;
      
      for (const cpu of cpus) {
        for (const type in cpu.times) {
          totalTick += cpu.times[type as keyof typeof cpu.times];
        }
        totalIdle += cpu.times.idle;
      }
      
      const idlePercentage = totalIdle / totalTick;
      this.systemMetrics.cpuUtilization = 1 - idlePercentage;
      
      // Calcola l'utilizzo della memoria
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      this.systemMetrics.memoryUtilization = (totalMemory - freeMemory) / totalMemory;
      
      // Ottiene il carico medio del sistema
      this.systemMetrics.loadAverage = os.loadavg();
      
      // Calcola il TPS corrente
      const now = Date.now();
      const elapsed = (now - this.lastCounterReset) / 1000;
      
      if (elapsed >= 1) {
        this.systemMetrics.currentTps = this.transactionCounter / elapsed;
        this.transactionCounter = 0;
        this.lastCounterReset = now;
        
        // Aggiorna il TPS massimo
        if (this.systemMetrics.currentTps > this.systemMetrics.peakTps) {
          this.systemMetrics.peakTps = this.systemMetrics.currentTps;
        }
      }
      
      // Calcola la latenza media
      if (this.latencyMeasurements.length > 0) {
        const sum = this.latencyMeasurements.reduce((a, b) => a + b, 0);
        this.systemMetrics.averageLatencyMs = sum / this.latencyMeasurements.length;
        
        // Limita l'array delle misurazioni di latenza
        if (this.latencyMeasurements.length > 1000) {
          this.latencyMeasurements = this.latencyMeasurements.slice(-1000);
        }
      }
      
      // Emette l'evento di aggiornamento delle metriche
      this.emit('metricsUpdated', this.systemMetrics);
    } catch (error) {
      this.logger.error('Errore durante l\'aggiornamento delle metriche di sistema', { error });
    }
  }

  /**
   * Verifica le condizioni per l'attivazione del throttling
   * 
   * @private
   */
  private checkThrottlingConditions(): void {
    try {
      let shouldThrottle = false;
      let reason = '';
      let throttlingLevel = 0;
      
      // Verifica il TPS
      if (this.systemMetrics.currentTps > this.config.maxTps * this.config.throttlingThreshold) {
        const tpsRatio = this.systemMetrics.currentTps / this.config.maxTps;
        shouldThrottle = true;
        reason = 'TPS elevato';
        throttlingLevel = Math.min(1, (tpsRatio - this.config.throttlingThreshold) / (1 - this.config.throttlingThreshold));
      }
      
      // Verifica l'utilizzo della CPU
      if (this.systemMetrics.cpuUtilization > this.config.maxCpuUtilization) {
        const cpuRatio = (this.systemMetrics.cpuUtilization - this.config.maxCpuUtilization) / 
          (1 - this.config.maxCpuUtilization);
        
        if (cpuRatio > throttlingLevel) {
          shouldThrottle = true;
          reason = 'Utilizzo CPU elevato';
          throttlingLevel = cpuRatio;
        }
      }
      
      // Verifica l'utilizzo della memoria
      if (this.systemMetrics.memoryUtilization > this.config.maxMemoryUtilization) {
        const memRatio = (this.systemMetrics.memoryUtilization - this.config.maxMemoryUtilization) / 
          (1 - this.config.maxMemoryUtilization);
        
        if (memRatio > throttlingLevel) {
          shouldThrottle = true;
          reason = 'Utilizzo memoria elevato';
          throttlingLevel = memRatio;
        }
      }
      
      // Verifica la dimensione del buffer
      const bufferRatio = this.transactionBuffer.length / this.config.maxBufferSize;
      if (bufferRatio > 0.9) {
        if (bufferRatio > throttlingLevel) {
          shouldThrottle = true;
          reason = 'Buffer quasi pieno';
          throttlingLevel = bufferRatio;
        }
      }
      
      // Applica il throttling se necessario
      if (shouldThrottle) {
        if (!this.throttlingStatus.active) {
          this.activateThrottling(reason, throttlingLevel);
        } else {
          // Aggiorna il livello di throttling se è aumentato
          if (throttlingLevel > this.throttlingStatus.level) {
            this.updateThrottlingLevel(throttlingLevel, reason);
          }
        }
      } else if (this.throttlingStatus.active) {
        // Verifica se possiamo disattivare il throttling
        const throttlingDuration = Date.now() - this.throttlingStatus.activatedAt;
        if (throttlingDuration > 10000 && // Almeno 10 secondi di throttling
            this.systemMetrics.currentTps < this.config.maxTps * 0.7 && // TPS sotto il 70% del massimo
            this.systemMetrics.cpuUtilization < this.config.maxCpuUtilization * 0.8 && // CPU sotto l'80% del massimo
            this.systemMetrics.memoryUtilization < this.config.maxMemoryUtilization * 0.8) { // Memoria sotto l'80% del massimo
          this.deactivateThrottling();
        }
      }
    } catch (error) {
      this.logger.error('Errore durante la verifica delle condizioni di throttling', { error });
    }
  }

  /**
   * Attiva il throttling
   * 
   * @param reason - Motivo dell'attivazione
   * @param level - Livello di throttling (0-1)
   * @private
   */
  private activateThrottling(reason: string, level: number): void {
    this.throttlingStatus = {
      active: true,
      level: Math.min(1, Math.max(0, level)),
      reason,
      activatedAt: Date.now(),
      targetTps: Math.floor(this.config.maxTps * (1 - level * 0.5)), // Riduce il TPS target in base al livello
      minPriority: Math.floor(this.config.minPriorityDuringThrottling * level)
    };
    
    this.logger.warn('Throttling attivato', {
      reason,
      level: this.throttlingStatus.level,
      targetTps: this.throttlingStatus.targetTps,
      minPriority: this.throttlingStatus.minPriority
    });
    
    // Emette l'evento di attivazione del throttling
    this.emit('throttlingActivated', this.throttlingStatus);
  }

  /**
   * Aggiorna il livello di throttling
   * 
   * @param level - Nuovo livello di throttling (0-1)
   * @param reason - Motivo dell'aggiornamento
   * @private
   */
  private updateThrottlingLevel(level: number, reason: string): void {
    const previousLevel = this.throttlingStatus.level;
    
    this.throttlingStatus.level = Math.min(1, Math.max(0, level));
    this.throttlingStatus.reason = reason;
    this.throttlingStatus.targetTps = Math.floor(this.config.maxTps * (1 - level * 0.5));
    this.throttlingStatus.minPriority = Math.floor(this.config.minPriorityDuringThrottling * level);
    
    this.logger.info('Livello di throttling aggiornato', {
      previousLevel,
      newLevel: this.throttlingStatus.level,
      reason,
      targetTps: this.throttlingStatus.targetTps,
      minPriority: this.throttlingStatus.minPriority
    });
    
    // Emette l'evento di aggiornamento del throttling
    this.emit('throttlingUpdated', this.throttlingStatus);
  }

  /**
   * Disattiva il throttling
   * 
   * @private
   */
  private deactivateThrottling(): void {
    this.throttlingStatus = {
      active: false,
      level: 0,
      reason: 'none',
      activatedAt: 0,
      targetTps: this.config.maxTps,
      minPriority: 0
    };
    
    this.logger.info('Throttling disattivato');
    
    // Emette l'evento di disattivazione del throttling
    this.emit('throttlingDeactivated');
  }

  /**
   * Adatta il throttling in base alle condizioni del sistema
   * 
   * @private
   */
  private adaptThrottling(): void {
    if (!this.throttlingStatus.active) {
      return;
    }
    
    try {
      // Verifica se possiamo ridurre il livello di throttling
      if (this.systemMetrics.currentTps < this.throttlingStatus.targetTps * 0.8 &&
          this.systemMetrics.cpuUtilization < this.config.maxCpuUtilization * 0.8 &&
          this.systemMetrics.memoryUtilization < this.config.maxMemoryUtilization * 0.8) {
        
        // Riduci il livello di throttling
        const newLevel = this.throttlingStatus.level * this.config.throttlingReductionFactor;
        
        if (newLevel < 0.1) {
          // Se il livello è molto basso, disattiva il throttling
          this.deactivateThrottling();
        } else {
          // Altrimenti, aggiorna il livello
          this.updateThrottlingLevel(newLevel, 'Adattamento automatico');
        }
      }
    } catch (error) {
      this.logger.error('Errore durante l\'adattamento del throttling', { error });
    }
  }

  /**
   * Elabora le transazioni nel buffer
   * 
   * @private
   */
  private processBuffer(): void {
    try {
      if (this.transactionBuffer.length === 0) {
        return;
      }
      
      // Calcola quante transazioni possiamo elaborare in questo intervallo
      const intervalSeconds = this.config.monitoringIntervalMs / 1000;
      let maxTransactionsToProcess = Math.floor(this.throttlingStatus.targetTps * intervalSeconds);
      
      // Limita il numero di transazioni in base al livello di throttling
      if (this.throttlingStatus.active) {
        maxTransactionsToProcess = Math.floor(maxTransactionsToProcess * (1 - this.throttlingStatus.level * 0.5));
      }
      
      // Ordina il buffer per priorità e tempo di attesa
      this.transactionBuffer.sort((a, b) => {
        // Prima per priorità (decrescente)
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        
        // Poi per tempo di attesa (crescente)
        return a.enqueuedAt - b.enqueuedAt;
      });
      
      // Filtra le transazioni in base alla priorità minima durante il throttling
      let transactionsToProcess = this.transactionBuffer;
      if (this.throttlingStatus.active && this.throttlingStatus.minPriority > 0) {
        transactionsToProcess = this.transactionBuffer.filter(tx => 
          tx.priority >= this.throttlingStatus.minPriority);
      }
      
      // Limita il numero di transazioni da elaborare
      transactionsToProcess = transactionsToProcess.slice(0, maxTransactionsToProcess);
      
      // Elabora le transazioni
      const now = Date.now();
      for (const bufferedTx of transactionsToProcess) {
        // Calcola il tempo di attesa
        const waitTime = now - bufferedTx.enqueuedAt;
        
        // Emette l'evento di transazione pronta
        this.emit('transactionReady', bufferedTx.transaction, waitTime);
        
        // Aggiunge la misurazione della latenza
        this.latencyMeasurements.push(waitTime);
        
        // Incrementa il contatore di transazioni
        this.transactionCounter++;
      }
      
      // Rimuove le transazioni elaborate dal buffer
      const processedIds = new Set(transactionsToProcess.map(tx => tx.transaction.id));
      this.transactionBuffer = this.transactionBuffer.filter(tx => 
        !processedIds.has(tx.transaction.id));
      
      this.logger.info('Transazioni elaborate dal buffer', {
        processed: transactionsToProcess.length,
        remaining: this.transactionBuffer.length
      });
    } catch (error) {
      this.logger.error('Errore durante l\'elaborazione del buffer', { error });
    }
  }

  /**
   * Rimuove le transazioni vecchie dal buffer
   * 
   * @private
   */
  private cleanupOldTransactions(): void {
    try {
      const now = Date.now();
      const oldTransactions = this.transactionBuffer.filter(tx => 
        now - tx.enqueuedAt > this.config.maxBufferTimeMs);
      
      if (oldTransactions.length > 0) {
        // Rimuove le transazioni vecchie dal buffer
        this.transactionBuffer = this.transactionBuffer.filter(tx => 
          now - tx.enqueuedAt <= this.config.maxBufferTimeMs);
        
        this.logger.warn('Transazioni vecchie rimosse dal buffer', {
          count: oldTransactions.length,
          maxAgeMs: this.config.maxBufferTimeMs
        });
        
        // Emette l'evento di transazioni scadute
        for (const tx of oldTransactions) {
          this.emit('transactionExpired', tx.transaction, now - tx.enqueuedAt);
        }
      }
    } catch (error) {
      this.logger.error('Errore durante la pulizia delle transazioni vecchie', { error });
    }
  }

  /**
   * Aggiunge una transazione al buffer
   * 
   * @param transaction - Transazione da aggiungere
   * @param priority - Priorità della transazione (maggiore = più importante)
   * @returns Promise che si risolve con true se la transazione è stata aggiunta, false altrimenti
   */
  async addTransaction(transaction: Transaction, priority: number = 1): Promise<boolean> {
    try {
      // Verifica se il buffer è pieno
      if (this.transactionBuffer.length >= this.config.maxBufferSize) {
        this.logger.error('Buffer pieno, transazione rifiutata', {
          transactionId: transaction.id,
          bufferSize: this.transactionBuffer.length,
          maxBufferSize: this.config.maxBufferSize
        });
        
        // Emette l'evento di buffer pieno
        this.emit('bufferFull', transaction);
        
        return false;
      }
      
      // Crea la transazione con buffer
      const bufferedTransaction: BufferedTransaction = {
        transaction,
        enqueuedAt: Date.now(),
        priority
      };
      
      // Aggiunge la transazione al buffer
      this.transactionBuffer.push(bufferedTransaction);
      
      this.logger.info('Transazione aggiunta al buffer', {
        transactionId: transaction.id,
        priority,
        bufferSize: this.transactionBuffer.length
      });
      
      // Emette l'evento di transazione aggiunta
      this.emit('transactionBuffered', transaction, priority);
      
      return true;
    } catch (error) {
      this.logger.error('Errore durante l\'aggiunta della transazione al buffer', { error });
      return false;
    }
  }

  /**
   * Ottiene lo stato del buffer
   * 
   * @returns Stato del buffer
   */
  getBufferStatus(): BufferStatus {
    try {
      const now = Date.now();
      
      // Calcola il tempo medio di attesa
      let totalWaitTime = 0;
      let oldestTransactionTime = now;
      const priorityDistribution: Record<string, number> = {};
      
      for (const tx of this.transactionBuffer) {
        const waitTime = now - tx.enqueuedAt;
        totalWaitTime += waitTime;
        
        if (tx.enqueuedAt < oldestTransactionTime) {
          oldestTransactionTime = tx.enqueuedAt;
        }
        
        // Aggiorna la distribuzione delle priorità
        const priorityKey = tx.priority.toString();
        priorityDistribution[priorityKey] = (priorityDistribution[priorityKey] || 0) + 1;
      }
      
      const averageWaitTimeMs = this.transactionBuffer.length > 0 
        ? totalWaitTime / this.transactionBuffer.length 
        : 0;
      
      const oldestTransactionMs = this.transactionBuffer.length > 0 
        ? now - oldestTransactionTime 
        : 0;
      
      return {
        size: this.transactionBuffer.length,
        capacity: this.config.maxBufferSize,
        fillPercentage: (this.transactionBuffer.length / this.config.maxBufferSize) * 100,
        averageWaitTimeMs,
        oldestTransactionMs,
        priorityDistribution
      };
    } catch (error) {
      this.logger.error('Errore durante l\'ottenimento dello stato del buffer', { error });
      
      // Restituisce uno stato predefinito in caso di errore
      return {
        size: this.transactionBuffer.length,
        capacity: this.config.maxBufferSize,
        fillPercentage: (this.transactionBuffer.length / this.config.maxBufferSize) * 100,
        averageWaitTimeMs: 0,
        oldestTransactionMs: 0,
        priorityDistribution: {}
      };
    }
  }

  /**
   * Ottiene lo stato del throttling
   * 
   * @returns Stato del throttling
   */
  getThrottlingStatus(): ThrottlingStatus {
    return { ...this.throttlingStatus };
  }

  /**
   * Ottiene le metriche di sistema
   * 
   * @returns Metriche di sistema
   */
  getSystemMetrics(): SystemMetrics {
    return { ...this.systemMetrics };
  }

  /**
   * Ottiene la configurazione
   * 
   * @returns Configurazione
   */
  getConfig(): SpikeLoadManagerConfig {
    return { ...this.config };
  }

  /**
   * Aggiorna la configurazione
   * 
   * @param config - Nuova configurazione
   */
  updateConfig(config: Partial<SpikeLoadManagerConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
    
    this.logger.info('Configurazione aggiornata', {
      maxTps: this.config.maxTps,
      throttlingThreshold: this.config.throttlingThreshold,
      maxBufferSize: this.config.maxBufferSize
    });
  }

  /**
   * Arresta il gestore dei picchi di carico
   */
  shutdown(): void {
    try {
      this.logger.info('Arresto del SpikeLoadManager');
      
      // Arresta il monitoraggio
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }
      
      // Arresta l'adattamento del throttling
      if (this.throttlingAdaptInterval) {
        clearInterval(this.throttlingAdaptInterval);
        this.throttlingAdaptInterval = null;
      }
      
      // Elabora le transazioni rimanenti nel buffer
      this.processBuffer();
      
      this.logger.info('SpikeLoadManager arrestato con successo');
    } catch (error) {
      this.logger.error('Errore durante l\'arresto del SpikeLoadManager', { error });
    }
  }
}
