/**
 * @fileoverview Modulo per la gestione del batching delle transazioni nel Layer 2 di Solana
 */

import { PublicKey } from '@solana/web3.js';
import { Layer2Client } from './client';
import { Layer2Error, ErrorCode } from './types/errors';
import { validateBatchConfig } from './utils/validation';

/**
 * Configurazione per il batching delle transazioni
 */
export interface BatchConfig {
  /** Dimensione massima del batch (numero di transazioni) */
  maxBatchSize?: number;
  /** Tempo massimo di attesa per il completamento di un batch (ms) */
  maxBatchWaitTime?: number;
  /** Priorità del batch (1-10, dove 10 è la massima priorità) */
  priority?: number;
  /** Strategia di ordinamento delle transazioni nel batch */
  orderingStrategy?: 'fifo' | 'priority' | 'gas-price' | 'optimized';
}

/**
 * Stato di un batch
 */
export enum BatchStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMMITTED = 'committed',
  FINALIZED = 'finalized',
  FAILED = 'failed'
}

/**
 * Informazioni su un batch
 */
export interface BatchInfo {
  /** ID univoco del batch */
  id: string;
  /** Numero di transazioni nel batch */
  transactionCount: number;
  /** Stato attuale del batch */
  status: BatchStatus;
  /** Timestamp di creazione del batch */
  createdAt: number;
  /** Timestamp di commit del batch (se disponibile) */
  committedAt?: number;
  /** Timestamp di finalizzazione del batch (se disponibile) */
  finalizedAt?: number;
  /** Hash del root di Merkle del batch */
  merkleRoot?: string;
  /** ID delle transazioni incluse nel batch */
  transactionIds: string[];
  /** Metriche di performance del batch */
  metrics?: {
    /** Tempo medio di elaborazione per transazione (ms) */
    avgProcessingTime?: number;
    /** Throughput del batch (TPS) */
    throughput?: number;
    /** Gas totale utilizzato */
    totalGas?: number;
  };
}

/**
 * Gestore del batching delle transazioni
 */
export class BatchManager {
  private client: Layer2Client;
  private config: BatchConfig;

  /**
   * Crea una nuova istanza del BatchManager
   * @param client Client Layer 2
   * @param config Configurazione opzionale per il batching
   */
  constructor(client: Layer2Client, config: BatchConfig = {}) {
    this.client = client;
    
    // Configurazione di default
    this.config = {
      maxBatchSize: 100,
      maxBatchWaitTime: 5000,
      priority: 5,
      orderingStrategy: 'optimized',
      ...config
    };

    // Validazione della configurazione
    if (!validateBatchConfig(this.config)) {
      throw new Layer2Error(
        'Configurazione del batch non valida',
        ErrorCode.INVALID_BATCH_CONFIG
      );
    }
  }

  /**
   * Crea un nuovo batch di transazioni
   * @param config Configurazione opzionale per questo specifico batch
   * @returns Promise che si risolve con l'ID del batch creato
   */
  public async createBatch(config: BatchConfig = {}): Promise<string> {
    try {
      const mergedConfig = { ...this.config, ...config };
      
      // Chiamata all'API del Layer 2 per creare un nuovo batch
      const response = await fetch(`${this.client.getConfig().rpcUrl}/batch/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mergedConfig),
      });

      if (!response.ok) {
        throw new Layer2Error(
          `Errore nella creazione del batch: ${response.statusText}`,
          ErrorCode.BATCH_CREATION_FAILED
        );
      }

      const data = await response.json();
      return data.batchId;
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nella creazione del batch: ${error.message}`,
        ErrorCode.BATCH_CREATION_FAILED
      );
    }
  }

  /**
   * Aggiunge una transazione a un batch esistente
   * @param batchId ID del batch
   * @param transactionId ID della transazione da aggiungere
   * @returns Promise che si risolve con true se l'operazione ha successo
   */
  public async addTransactionToBatch(batchId: string, transactionId: string): Promise<boolean> {
    try {
      // Chiamata all'API del Layer 2 per aggiungere una transazione al batch
      const response = await fetch(`${this.client.getConfig().rpcUrl}/batch/${batchId}/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transactionId }),
      });

      if (!response.ok) {
        throw new Layer2Error(
          `Errore nell'aggiunta della transazione al batch: ${response.statusText}`,
          ErrorCode.BATCH_ADD_TRANSACTION_FAILED
        );
      }

      const data = await response.json();
      return data.success;
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nell'aggiunta della transazione al batch: ${error.message}`,
        ErrorCode.BATCH_ADD_TRANSACTION_FAILED
      );
    }
  }

  /**
   * Finalizza un batch e lo invia per l'elaborazione
   * @param batchId ID del batch da finalizzare
   * @returns Promise che si risolve con true se l'operazione ha successo
   */
  public async finalizeBatch(batchId: string): Promise<boolean> {
    try {
      // Chiamata all'API del Layer 2 per finalizzare il batch
      const response = await fetch(`${this.client.getConfig().rpcUrl}/batch/${batchId}/finalize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Layer2Error(
          `Errore nella finalizzazione del batch: ${response.statusText}`,
          ErrorCode.BATCH_FINALIZATION_FAILED
        );
      }

      const data = await response.json();
      return data.success;
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nella finalizzazione del batch: ${error.message}`,
        ErrorCode.BATCH_FINALIZATION_FAILED
      );
    }
  }

  /**
   * Ottiene informazioni su un batch
   * @param batchId ID del batch
   * @returns Promise che si risolve con le informazioni sul batch
   */
  public async getBatchInfo(batchId: string): Promise<BatchInfo> {
    try {
      // Chiamata all'API del Layer 2 per ottenere informazioni sul batch
      const response = await fetch(`${this.client.getConfig().rpcUrl}/batch/${batchId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Layer2Error(
          `Errore nell'ottenimento delle informazioni sul batch: ${response.statusText}`,
          ErrorCode.BATCH_INFO_FAILED
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nell'ottenimento delle informazioni sul batch: ${error.message}`,
        ErrorCode.BATCH_INFO_FAILED
      );
    }
  }

  /**
   * Ottiene lo stato attuale di un batch
   * @param batchId ID del batch
   * @returns Promise che si risolve con lo stato del batch
   */
  public async getBatchStatus(batchId: string): Promise<BatchStatus> {
    try {
      const batchInfo = await this.getBatchInfo(batchId);
      return batchInfo.status;
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nell'ottenimento dello stato del batch: ${error.message}`,
        ErrorCode.BATCH_STATUS_FAILED
      );
    }
  }

  /**
   * Ottiene le metriche di performance di un batch
   * @param batchId ID del batch
   * @returns Promise che si risolve con le metriche di performance del batch
   */
  public async getBatchMetrics(batchId: string): Promise<BatchInfo['metrics']> {
    try {
      const batchInfo = await this.getBatchInfo(batchId);
      return batchInfo.metrics || {};
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nell'ottenimento delle metriche del batch: ${error.message}`,
        ErrorCode.BATCH_METRICS_FAILED
      );
    }
  }

  /**
   * Ottiene la lista dei batch per un utente
   * @param owner Indirizzo pubblico del proprietario (opzionale, default: utente corrente)
   * @param limit Numero massimo di batch da restituire
   * @param offset Offset per la paginazione
   * @returns Promise che si risolve con la lista dei batch
   */
  public async getBatchesByOwner(
    owner?: PublicKey,
    limit: number = 10,
    offset: number = 0
  ): Promise<BatchInfo[]> {
    try {
      // Se non viene fornito un proprietario, usa l'utente corrente
      const ownerKey = owner || await this.client.getPublicKey();
      
      // Chiamata all'API del Layer 2 per ottenere i batch dell'utente
      const response = await fetch(
        `${this.client.getConfig().rpcUrl}/batch/list?owner=${ownerKey.toString()}&limit=${limit}&offset=${offset}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Layer2Error(
          `Errore nell'ottenimento dei batch: ${response.statusText}`,
          ErrorCode.BATCH_LIST_FAILED
        );
      }

      const data = await response.json();
      return data.batches;
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nell'ottenimento dei batch: ${error.message}`,
        ErrorCode.BATCH_LIST_FAILED
      );
    }
  }

  /**
   * Ottiene la prova di inclusione di una transazione in un batch
   * @param batchId ID del batch
   * @param transactionId ID della transazione
   * @returns Promise che si risolve con la prova di inclusione
   */
  public async getInclusionProof(batchId: string, transactionId: string): Promise<string> {
    try {
      // Chiamata all'API del Layer 2 per ottenere la prova di inclusione
      const response = await fetch(
        `${this.client.getConfig().rpcUrl}/batch/${batchId}/proof/${transactionId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Layer2Error(
          `Errore nell'ottenimento della prova di inclusione: ${response.statusText}`,
          ErrorCode.INCLUSION_PROOF_FAILED
        );
      }

      const data = await response.json();
      return data.proof;
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nell'ottenimento della prova di inclusione: ${error.message}`,
        ErrorCode.INCLUSION_PROOF_FAILED
      );
    }
  }
}
