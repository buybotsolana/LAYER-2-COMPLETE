/**
 * @fileoverview Modulo per la gestione delle transazioni in batch nel Layer 2 di Solana
 */

import { Layer2Client } from './client';
import { BatchManager } from './batch';
import { ProofManager } from './proof';
import { MetricsManager, MetricType } from './metrics';
import { Layer2Error, ErrorCode } from './types/errors';
import { getFetch } from './utils/platform';

/**
 * Configurazione per il batching automatico delle transazioni
 */
export interface AutoBatchConfig {
  /** Abilitare il batching automatico */
  enabled: boolean;
  /** Dimensione massima del batch (numero di transazioni) */
  maxBatchSize?: number;
  /** Tempo massimo di attesa per il completamento di un batch (ms) */
  maxBatchWaitTime?: number;
  /** Priorità del batch (1-10, dove 10 è la massima priorità) */
  priority?: number;
  /** Strategia di ordinamento delle transazioni nel batch */
  orderingStrategy?: 'fifo' | 'priority' | 'gas-price' | 'optimized';
  /** Callback per gli eventi di batching */
  onBatchEvent?: (event: BatchEvent) => void;
}

/**
 * Tipo di evento di batching
 */
export enum BatchEventType {
  BATCH_CREATED = 'batch-created',
  TRANSACTION_ADDED = 'transaction-added',
  BATCH_FINALIZED = 'batch-finalized',
  BATCH_COMMITTED = 'batch-committed',
  BATCH_FAILED = 'batch-failed'
}

/**
 * Evento di batching
 */
export interface BatchEvent {
  /** Tipo di evento */
  type: BatchEventType;
  /** ID del batch */
  batchId: string;
  /** Timestamp dell'evento */
  timestamp: number;
  /** Dati aggiuntivi dell'evento */
  data?: any;
}

/**
 * Gestore del batching automatico delle transazioni
 */
export class AutoBatchManager {
  private client: Layer2Client;
  private batchManager: BatchManager;
  private proofManager: ProofManager;
  private metricsManager?: MetricsManager;
  private config: AutoBatchConfig;
  private currentBatchId: string | null = null;
  private transactionQueue: string[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private fetch: typeof fetch;

  /**
   * Crea una nuova istanza dell'AutoBatchManager
   * @param client Client Layer 2
   * @param batchManager Gestore dei batch
   * @param proofManager Gestore delle prove
   * @param metricsManager Gestore delle metriche (opzionale)
   * @param config Configurazione per il batching automatico
   */
  constructor(
    client: Layer2Client,
    batchManager: BatchManager,
    proofManager: ProofManager,
    metricsManager?: MetricsManager,
    config: AutoBatchConfig = { enabled: true }
  ) {
    this.client = client;
    this.batchManager = batchManager;
    this.proofManager = proofManager;
    this.metricsManager = metricsManager;
    
    // Configurazione di default
    this.config = {
      enabled: true,
      maxBatchSize: 100,
      maxBatchWaitTime: 5000,
      priority: 5,
      orderingStrategy: 'optimized',
      ...config
    };

    // Ottieni l'implementazione di fetch compatibile con l'ambiente
    this.fetch = getFetch();

    // Avvia il batching automatico se abilitato
    if (this.config.enabled) {
      this.startAutoBatching();
    }
  }

  /**
   * Avvia il batching automatico delle transazioni
   */
  public startAutoBatching(): void {
    if (!this.config.enabled) {
      this.config.enabled = true;
    }

    // Crea un nuovo batch se non esiste
    this.ensureCurrentBatch();
  }

  /**
   * Ferma il batching automatico delle transazioni
   */
  public stopAutoBatching(): void {
    this.config.enabled = false;

    // Finalizza il batch corrente se esiste
    if (this.currentBatchId) {
      this.finalizeBatch();
    }

    // Cancella il timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  /**
   * Aggiunge una transazione al batch automatico
   * @param transactionId ID della transazione da aggiungere
   * @returns Promise che si risolve con true se l'operazione ha successo
   */
  public async addTransaction(transactionId: string): Promise<boolean> {
    if (!this.config.enabled) {
      throw new Layer2Error(
        'Il batching automatico non è abilitato',
        ErrorCode.AUTO_BATCH_DISABLED
      );
    }

    // Assicurati che esista un batch corrente
    await this.ensureCurrentBatch();

    try {
      // Aggiungi la transazione al batch
      const success = await this.batchManager.addTransactionToBatch(
        this.currentBatchId!,
        transactionId
      );

      if (success) {
        // Notifica l'evento
        this.notifyBatchEvent(BatchEventType.TRANSACTION_ADDED, {
          transactionId
        });

        // Registra la metrica
        if (this.metricsManager) {
          this.metricsManager.recordMetric(MetricType.BATCH_SIZE, this.transactionQueue.length + 1, {
            batchId: this.currentBatchId!
          });
        }

        // Aggiungi alla coda locale
        this.transactionQueue.push(transactionId);

        // Finalizza il batch se ha raggiunto la dimensione massima
        if (this.transactionQueue.length >= this.config.maxBatchSize!) {
          this.finalizeBatch();
        }

        return true;
      }

      return false;
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nell'aggiunta della transazione al batch: ${error.message}`,
        ErrorCode.AUTO_BATCH_ADD_TRANSACTION_FAILED
      );
    }
  }

  /**
   * Assicura che esista un batch corrente
   */
  private async ensureCurrentBatch(): Promise<void> {
    if (!this.currentBatchId) {
      try {
        // Crea un nuovo batch
        this.currentBatchId = await this.batchManager.createBatch({
          maxBatchSize: this.config.maxBatchSize,
          priority: this.config.priority,
          orderingStrategy: this.config.orderingStrategy
        });

        // Resetta la coda delle transazioni
        this.transactionQueue = [];

        // Notifica l'evento
        this.notifyBatchEvent(BatchEventType.BATCH_CREATED, {});

        // Imposta il timer per la finalizzazione automatica
        this.setBatchTimer();
      } catch (error) {
        throw new Layer2Error(
          `Errore nella creazione del batch: ${error.message}`,
          ErrorCode.AUTO_BATCH_CREATION_FAILED
        );
      }
    }
  }

  /**
   * Imposta il timer per la finalizzazione automatica del batch
   */
  private setBatchTimer(): void {
    // Cancella il timer esistente se presente
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    // Imposta un nuovo timer
    this.batchTimer = setTimeout(() => {
      // Finalizza il batch se contiene transazioni
      if (this.transactionQueue.length > 0) {
        this.finalizeBatch();
      } else {
        // Altrimenti, reimposta il timer
        this.setBatchTimer();
      }
    }, this.config.maxBatchWaitTime);
  }

  /**
   * Finalizza il batch corrente
   */
  private async finalizeBatch(): Promise<void> {
    if (!this.currentBatchId || this.transactionQueue.length === 0) {
      return;
    }

    const batchId = this.currentBatchId;
    
    try {
      // Finalizza il batch
      const success = await this.batchManager.finalizeBatch(batchId);

      if (success) {
        // Notifica l'evento
        this.notifyBatchEvent(BatchEventType.BATCH_FINALIZED, {
          transactionCount: this.transactionQueue.length
        });

        // Registra la metrica
        if (this.metricsManager) {
          this.metricsManager.recordMetric(MetricType.BATCH_SIZE, this.transactionQueue.length, {
            batchId,
            finalized: true
          });
        }

        // Monitora lo stato del batch
        this.monitorBatchStatus(batchId);
      } else {
        // Notifica l'evento di fallimento
        this.notifyBatchEvent(BatchEventType.BATCH_FAILED, {
          reason: 'Finalizzazione fallita'
        });
      }
    } catch (error) {
      // Notifica l'evento di fallimento
      this.notifyBatchEvent(BatchEventType.BATCH_FAILED, {
        reason: error.message
      });
    } finally {
      // Resetta lo stato corrente
      this.currentBatchId = null;
      this.transactionQueue = [];

      // Cancella il timer
      if (this.batchTimer) {
        clearTimeout(this.batchTimer);
        this.batchTimer = null;
      }

      // Crea un nuovo batch se il batching automatico è ancora abilitato
      if (this.config.enabled) {
        this.ensureCurrentBatch();
      }
    }
  }

  /**
   * Monitora lo stato di un batch
   * @param batchId ID del batch da monitorare
   */
  private async monitorBatchStatus(batchId: string): Promise<void> {
    try {
      // Polling dello stato del batch
      const checkStatus = async () => {
        try {
          const batchInfo = await this.batchManager.getBatchInfo(batchId);

          if (batchInfo.status === 'committed') {
            // Notifica l'evento
            this.notifyBatchEvent(BatchEventType.BATCH_COMMITTED, {
              merkleRoot: batchInfo.merkleRoot,
              transactionCount: batchInfo.transactionCount
            });

            // Registra la metrica
            if (this.metricsManager) {
              this.metricsManager.recordMetric(MetricType.FINALIZATION_TIME, 
                batchInfo.committedAt! - batchInfo.createdAt, {
                batchId
              });
            }

            return;
          } else if (batchInfo.status === 'failed') {
            // Notifica l'evento di fallimento
            this.notifyBatchEvent(BatchEventType.BATCH_FAILED, {
              reason: 'Commit fallito'
            });
            return;
          }

          // Continua il polling
          setTimeout(checkStatus, 2000);
        } catch (error) {
          console.error('Errore nel monitoraggio dello stato del batch:', error);
        }
      };

      // Avvia il polling
      checkStatus();
    } catch (error) {
      console.error('Errore nell\'avvio del monitoraggio del batch:', error);
    }
  }

  /**
   * Notifica un evento di batching
   * @param type Tipo di evento
   * @param data Dati aggiuntivi dell'evento
   */
  private notifyBatchEvent(type: BatchEventType, data: any): void {
    if (!this.config.onBatchEvent) return;

    const event: BatchEvent = {
      type,
      batchId: this.currentBatchId!,
      timestamp: Date.now(),
      data
    };

    this.config.onBatchEvent(event);
  }

  /**
   * Ottiene lo stato corrente del batching automatico
   * @returns Stato corrente del batching automatico
   */
  public getStatus(): {
    enabled: boolean;
    currentBatchId: string | null;
    queuedTransactions: number;
    config: AutoBatchConfig;
  } {
    return {
      enabled: this.config.enabled,
      currentBatchId: this.currentBatchId,
      queuedTransactions: this.transactionQueue.length,
      config: { ...this.config }
    };
  }

  /**
   * Aggiorna la configurazione del batching automatico
   * @param config Nuova configurazione
   */
  public updateConfig(config: Partial<AutoBatchConfig>): void {
    // Aggiorna la configurazione
    this.config = {
      ...this.config,
      ...config
    };

    // Se il batching è stato abilitato, avvialo
    if (config.enabled && !this.currentBatchId) {
      this.startAutoBatching();
    }
    // Se il batching è stato disabilitato, fermalo
    else if (config.enabled === false && this.config.enabled) {
      this.stopAutoBatching();
    }
    // Se è cambiato il tempo massimo di attesa, aggiorna il timer
    else if (config.maxBatchWaitTime && this.batchTimer) {
      this.setBatchTimer();
    }
  }
}
