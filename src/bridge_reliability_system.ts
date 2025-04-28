/**
 * Sistema di affidabilità del bridge con retry automatico
 * 
 * Questo modulo implementa un sistema di affidabilità per il bridge tra Ethereum e Solana:
 * - Sistema di retry automatico per le transazioni fallite
 * - Monitoraggio avanzato delle transazioni in corso
 * - Gestione degli errori e recupero automatico
 * 
 * @module bridge_reliability_system
 */

import { Logger } from './utils/logger';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

/**
 * Configurazione per il sistema di affidabilità del bridge
 */
export interface BridgeReliabilityConfig {
  /** Numero massimo di tentativi per transazione */
  maxRetries: number;
  /** Ritardo iniziale tra i tentativi in millisecondi */
  initialRetryDelayMs: number;
  /** Fattore di backoff per i tentativi */
  retryBackoffFactor: number;
  /** Ritardo massimo tra i tentativi in millisecondi */
  maxRetryDelayMs: number;
  /** Timeout per le transazioni in millisecondi */
  transactionTimeoutMs: number;
  /** Intervallo di controllo delle transazioni in millisecondi */
  transactionCheckIntervalMs: number;
  /** Abilita il monitoraggio avanzato */
  enableAdvancedMonitoring: boolean;
  /** Intervallo di monitoraggio in millisecondi */
  monitoringIntervalMs: number;
  /** Soglia di errore per il circuit breaker */
  circuitBreakerErrorThreshold: number;
  /** Finestra di tempo per il circuit breaker in millisecondi */
  circuitBreakerWindowMs: number;
  /** Periodo di reset del circuit breaker in millisecondi */
  circuitBreakerResetMs: number;
  /** Abilita la modalità di debug */
  debugMode: boolean;
}

/**
 * Stato di una transazione
 */
export enum TransactionStatus {
  /** Transazione in attesa */
  PENDING = 'PENDING',
  /** Transazione in corso */
  IN_PROGRESS = 'IN_PROGRESS',
  /** Transazione completata con successo */
  COMPLETED = 'COMPLETED',
  /** Transazione fallita */
  FAILED = 'FAILED',
  /** Transazione in retry */
  RETRYING = 'RETRYING',
  /** Transazione scaduta */
  TIMED_OUT = 'TIMED_OUT',
  /** Transazione annullata */
  CANCELLED = 'CANCELLED'
}

/**
 * Tipo di transazione
 */
export enum TransactionType {
  /** Deposito da Ethereum a Solana */
  DEPOSIT = 'DEPOSIT',
  /** Prelievo da Solana a Ethereum */
  WITHDRAWAL = 'WITHDRAWAL',
  /** Trasferimento di token */
  TRANSFER = 'TRANSFER',
  /** Altro tipo di transazione */
  OTHER = 'OTHER'
}

/**
 * Transazione del bridge
 */
export interface BridgeTransaction {
  /** ID della transazione */
  id: string;
  /** Tipo di transazione */
  type: TransactionType;
  /** Stato della transazione */
  status: TransactionStatus;
  /** Timestamp di creazione */
  createdAt: number;
  /** Timestamp dell'ultimo aggiornamento */
  updatedAt: number;
  /** Timestamp di completamento */
  completedAt?: number;
  /** Hash della transazione di origine */
  sourceHash?: string;
  /** Hash della transazione di destinazione */
  destinationHash?: string;
  /** Catena di origine */
  sourceChain: string;
  /** Catena di destinazione */
  destinationChain: string;
  /** Indirizzo di origine */
  sourceAddress: string;
  /** Indirizzo di destinazione */
  destinationAddress: string;
  /** Token */
  token: string;
  /** Importo */
  amount: string;
  /** Tentativi effettuati */
  attempts: number;
  /** Errori */
  errors: {
    /** Timestamp dell'errore */
    timestamp: number;
    /** Messaggio di errore */
    message: string;
    /** Codice di errore */
    code?: string;
    /** Dettagli dell'errore */
    details?: any;
  }[];
  /** Dati aggiuntivi */
  data?: any;
}

/**
 * Risultato dell'esecuzione di una transazione
 */
export interface TransactionExecutionResult {
  /** Successo dell'esecuzione */
  success: boolean;
  /** Hash della transazione */
  hash?: string;
  /** Errore */
  error?: {
    /** Messaggio di errore */
    message: string;
    /** Codice di errore */
    code?: string;
    /** Dettagli dell'errore */
    details?: any;
    /** Errore recuperabile */
    recoverable: boolean;
  };
}

/**
 * Funzione di esecuzione di una transazione
 */
export type TransactionExecutor = (
  transaction: BridgeTransaction,
  attempt: number
) => Promise<TransactionExecutionResult>;

/**
 * Funzione di verifica di una transazione
 */
export type TransactionVerifier = (
  transaction: BridgeTransaction
) => Promise<{
  /** Stato della transazione */
  status: TransactionStatus;
  /** Hash della transazione di destinazione */
  destinationHash?: string;
  /** Errore */
  error?: {
    /** Messaggio di errore */
    message: string;
    /** Codice di errore */
    code?: string;
  };
}>;

/**
 * Statistiche del sistema di affidabilità
 */
export interface ReliabilityStats {
  /** Totale transazioni */
  totalTransactions: number;
  /** Transazioni completate */
  completedTransactions: number;
  /** Transazioni fallite */
  failedTransactions: number;
  /** Transazioni in corso */
  inProgressTransactions: number;
  /** Transazioni in retry */
  retryingTransactions: number;
  /** Transazioni scadute */
  timedOutTransactions: number;
  /** Tasso di successo */
  successRate: number;
  /** Tempo medio di completamento in millisecondi */
  averageCompletionTimeMs: number;
  /** Numero medio di tentativi */
  averageAttempts: number;
  /** Stato del circuit breaker */
  circuitBreakerStatus: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  /** Errori recenti */
  recentErrors: number;
  /** Statistiche per tipo di transazione */
  byType: Record<TransactionType, {
    /** Totale transazioni */
    total: number;
    /** Transazioni completate */
    completed: number;
    /** Transazioni fallite */
    failed: number;
    /** Tasso di successo */
    successRate: number;
  }>;
}

/**
 * Classe che implementa il sistema di affidabilità del bridge
 */
export class BridgeReliabilitySystem extends EventEmitter {
  private config: BridgeReliabilityConfig;
  private logger: Logger;
  private transactions: Map<string, BridgeTransaction> = new Map();
  private executors: Map<TransactionType, TransactionExecutor> = new Map();
  private verifiers: Map<TransactionType, TransactionVerifier> = new Map();
  private transactionCheckInterval: NodeJS.Timeout | null = null;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private circuitBreakerStatus: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private recentErrors: { timestamp: number; transactionId: string }[] = [];
  private initialized: boolean = false;

  /**
   * Crea una nuova istanza del sistema di affidabilità del bridge
   * 
   * @param config - Configurazione del sistema
   */
  constructor(config: Partial<BridgeReliabilityConfig> = {}) {
    super();
    
    // Configurazione predefinita
    this.config = {
      maxRetries: 5,
      initialRetryDelayMs: 1000,
      retryBackoffFactor: 2,
      maxRetryDelayMs: 60000,
      transactionTimeoutMs: 3600000, // 1 ora
      transactionCheckIntervalMs: 10000,
      enableAdvancedMonitoring: true,
      monitoringIntervalMs: 60000,
      circuitBreakerErrorThreshold: 10,
      circuitBreakerWindowMs: 300000, // 5 minuti
      circuitBreakerResetMs: 600000, // 10 minuti
      debugMode: false,
      ...config
    };
    
    this.logger = new Logger('BridgeReliabilitySystem');
    
    this.logger.info('BridgeReliabilitySystem inizializzato', {
      maxRetries: this.config.maxRetries,
      initialRetryDelayMs: this.config.initialRetryDelayMs,
      transactionTimeoutMs: this.config.transactionTimeoutMs
    });
  }

  /**
   * Inizializza il sistema di affidabilità del bridge
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.info('BridgeReliabilitySystem già inizializzato');
      return;
    }
    
    try {
      this.logger.info('Inizializzazione BridgeReliabilitySystem');
      
      // Avvia il controllo periodico delle transazioni
      this.startTransactionCheck();
      
      // Avvia il monitoraggio se abilitato
      if (this.config.enableAdvancedMonitoring) {
        this.startMonitoring();
      }
      
      this.initialized = true;
      this.logger.info('BridgeReliabilitySystem inizializzato con successo');
    } catch (error) {
      this.logger.error('Errore durante l\'inizializzazione di BridgeReliabilitySystem', { error });
      throw new Error(`Errore durante l'inizializzazione di BridgeReliabilitySystem: ${error.message}`);
    }
  }

  /**
   * Avvia il controllo periodico delle transazioni
   * 
   * @private
   */
  private startTransactionCheck(): void {
    if (this.transactionCheckInterval) {
      clearInterval(this.transactionCheckInterval);
    }
    
    this.transactionCheckInterval = setInterval(() => {
      try {
        this.checkTransactions();
      } catch (error) {
        this.logger.error('Errore durante il controllo delle transazioni', { error });
      }
    }, this.config.transactionCheckIntervalMs);
    
    this.logger.info('Controllo periodico delle transazioni avviato', {
      intervalMs: this.config.transactionCheckIntervalMs
    });
  }

  /**
   * Avvia il monitoraggio
   * 
   * @private
   */
  private startMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    this.monitoringInterval = setInterval(() => {
      try {
        this.monitorSystem();
      } catch (error) {
        this.logger.error('Errore durante il monitoraggio del sistema', { error });
      }
    }, this.config.monitoringIntervalMs);
    
    this.logger.info('Monitoraggio avviato', {
      intervalMs: this.config.monitoringIntervalMs
    });
  }

  /**
   * Controlla le transazioni in corso
   * 
   * @private
   */
  private async checkTransactions(): Promise<void> {
    const now = Date.now();
    let pendingCount = 0;
    let inProgressCount = 0;
    let retryingCount = 0;
    let completedCount = 0;
    let failedCount = 0;
    let timedOutCount = 0;
    
    // Crea una copia delle transazioni per evitare problemi di concorrenza
    const transactions = Array.from(this.transactions.values());
    
    for (const transaction of transactions) {
      try {
        switch (transaction.status) {
          case TransactionStatus.PENDING:
            pendingCount++;
            await this.processPendingTransaction(transaction);
            break;
          
          case TransactionStatus.IN_PROGRESS:
            inProgressCount++;
            await this.checkInProgressTransaction(transaction, now);
            break;
          
          case TransactionStatus.RETRYING:
            retryingCount++;
            await this.processRetryingTransaction(transaction, now);
            break;
          
          case TransactionStatus.COMPLETED:
            completedCount++;
            // Nessuna azione necessaria per le transazioni completate
            break;
          
          case TransactionStatus.FAILED:
            failedCount++;
            // Nessuna azione necessaria per le transazioni fallite
            break;
          
          case TransactionStatus.TIMED_OUT:
            timedOutCount++;
            // Nessuna azione necessaria per le transazioni scadute
            break;
          
          case TransactionStatus.CANCELLED:
            // Nessuna azione necessaria per le transazioni annullate
            break;
        }
      } catch (error) {
        this.logger.error('Errore durante il controllo della transazione', {
          transactionId: transaction.id,
          status: transaction.status,
          error
        });
      }
    }
    
    // Registra le statistiche se ci sono transazioni attive
    if (pendingCount + inProgressCount + retryingCount > 0) {
      this.logger.info('Stato delle transazioni', {
        pending: pendingCount,
        inProgress: inProgressCount,
        retrying: retryingCount,
        completed: completedCount,
        failed: failedCount,
        timedOut: timedOutCount,
        total: transactions.length
      });
    }
  }

  /**
   * Elabora una transazione in attesa
   * 
   * @param transaction - Transazione in attesa
   * @private
   */
  private async processPendingTransaction(transaction: BridgeTransaction): Promise<void> {
    // Verifica se il circuit breaker è aperto
    if (this.circuitBreakerStatus === 'OPEN') {
      this.logger.warn('Circuit breaker aperto, transazione in attesa', {
        transactionId: transaction.id
      });
      return;
    }
    
    // Ottieni l'executor per il tipo di transazione
    const executor = this.executors.get(transaction.type);
    
    if (!executor) {
      this.logger.error('Executor non trovato per il tipo di transazione', {
        transactionId: transaction.id,
        type: transaction.type
      });
      
      // Aggiorna lo stato della transazione
      transaction.status = TransactionStatus.FAILED;
      transaction.updatedAt = Date.now();
      transaction.errors.push({
        timestamp: Date.now(),
        message: `Executor non trovato per il tipo di transazione: ${transaction.type}`
      });
      
      // Emetti l'evento di transazione fallita
      this.emit('transactionFailed', transaction);
      
      return;
    }
    
    try {
      // Aggiorna lo stato della transazione
      transaction.status = TransactionStatus.IN_PROGRESS;
      transaction.updatedAt = Date.now();
      transaction.attempts++;
      
      this.logger.info('Esecuzione della transazione', {
        transactionId: transaction.id,
        type: transaction.type,
        attempt: transaction.attempts
      });
      
      // Esegui la transazione
      const result = await executor(transaction, transaction.attempts);
      
      if (result.success) {
        // Aggiorna lo stato della transazione
        transaction.status = TransactionStatus.COMPLETED;
        transaction.updatedAt = Date.now();
        transaction.completedAt = Date.now();
        transaction.sourceHash = result.hash;
        
        this.logger.info('Transazione completata con successo', {
          transactionId: transaction.id,
          hash: result.hash
        });
        
        // Emetti l'evento di transazione completata
        this.emit('transactionCompleted', transaction);
      } else {
        // Gestisci l'errore
        this.handleTransactionError(transaction, result.error);
      }
    } catch (error) {
      // Gestisci l'errore
      this.handleTransactionError(transaction, {
        message: error.message,
        recoverable: true
      });
    }
  }

  /**
   * Controlla una transazione in corso
   * 
   * @param transaction - Transazione in corso
   * @param now - Timestamp corrente
   * @private
   */
  private async checkInProgressTransaction(transaction: BridgeTransaction, now: number): Promise<void> {
    // Verifica se la transazione è scaduta
    if (now - transaction.updatedAt > this.config.transactionTimeoutMs) {
      this.logger.warn('Transazione scaduta', {
        transactionId: transaction.id,
        elapsedMs: now - transaction.updatedAt,
        timeoutMs: this.config.transactionTimeoutMs
      });
      
      // Aggiorna lo stato della transazione
      transaction.status = TransactionStatus.TIMED_OUT;
      transaction.updatedAt = now;
      transaction.errors.push({
        timestamp: now,
        message: `Transazione scaduta dopo ${now - transaction.updatedAt}ms`
      });
      
      // Emetti l'evento di transazione scaduta
      this.emit('transactionTimedOut', transaction);
      
      return;
    }
    
    // Ottieni il verifier per il tipo di transazione
    const verifier = this.verifiers.get(transaction.type);
    
    if (!verifier) {
      this.logger.error('Verifier non trovato per il tipo di transazione', {
        transactionId: transaction.id,
        type: transaction.type
      });
      return;
    }
    
    try {
      // Verifica lo stato della transazione
      const result = await verifier(transaction);
      
      switch (result.status) {
        case TransactionStatus.COMPLETED:
          // Aggiorna lo stato della transazione
          transaction.status = TransactionStatus.COMPLETED;
          transaction.updatedAt = now;
          transaction.completedAt = now;
          transaction.destinationHash = result.destinationHash;
          
          this.logger.info('Transazione completata con successo', {
            transactionId: transaction.id,
            destinationHash: result.destinationHash
          });
          
          // Emetti l'evento di transazione completata
          this.emit('transactionCompleted', transaction);
          break;
        
        case TransactionStatus.FAILED:
          // Gestisci l'errore
          this.handleTransactionError(transaction, {
            message: result.error?.message || 'Transazione fallita durante la verifica',
            code: result.error?.code,
            recoverable: true
          });
          break;
        
        case TransactionStatus.IN_PROGRESS:
          // La transazione è ancora in corso, nessuna azione necessaria
          this.logger.debug('Transazione ancora in corso', {
            transactionId: transaction.id,
            elapsedMs: now - transaction.updatedAt
          });
          break;
        
        default:
          this.logger.warn('Stato non gestito durante la verifica della transazione', {
            transactionId: transaction.id,
            status: result.status
          });
      }
    } catch (error) {
      this.logger.error('Errore durante la verifica della transazione', {
        transactionId: transaction.id,
        error
      });
    }
  }

  /**
   * Elabora una transazione in retry
   * 
   * @param transaction - Transazione in retry
   * @param now - Timestamp corrente
   * @private
   */
  private async processRetryingTransaction(transaction: BridgeTransaction, now: number): Promise<void> {
    // Verifica se il circuit breaker è aperto
    if (this.circuitBreakerStatus === 'OPEN') {
      this.logger.warn('Circuit breaker aperto, transazione in attesa', {
        transactionId: transaction.id
      });
      return;
    }
    
    // Calcola il ritardo di retry
    const retryDelay = this.calculateRetryDelay(transaction.attempts);
    
    // Verifica se è il momento di riprovare
    if (now - transaction.updatedAt < retryDelay) {
      return;
    }
    
    // Ottieni l'executor per il tipo di transazione
    const executor = this.executors.get(transaction.type);
    
    if (!executor) {
      this.logger.error('Executor non trovato per il tipo di transazione', {
        transactionId: transaction.id,
        type: transaction.type
      });
      
      // Aggiorna lo stato della transazione
      transaction.status = TransactionStatus.FAILED;
      transaction.updatedAt = now;
      transaction.errors.push({
        timestamp: now,
        message: `Executor non trovato per il tipo di transazione: ${transaction.type}`
      });
      
      // Emetti l'evento di transazione fallita
      this.emit('transactionFailed', transaction);
      
      return;
    }
    
    try {
      // Aggiorna lo stato della transazione
      transaction.status = TransactionStatus.IN_PROGRESS;
      transaction.updatedAt = now;
      transaction.attempts++;
      
      this.logger.info('Nuovo tentativo di esecuzione della transazione', {
        transactionId: transaction.id,
        type: transaction.type,
        attempt: transaction.attempts
      });
      
      // Esegui la transazione
      const result = await executor(transaction, transaction.attempts);
      
      if (result.success) {
        // Aggiorna lo stato della transazione
        transaction.status = TransactionStatus.COMPLETED;
        transaction.updatedAt = now;
        transaction.completedAt = now;
        transaction.sourceHash = result.hash;
        
        this.logger.info('Transazione completata con successo dopo retry', {
          transactionId: transaction.id,
          hash: result.hash,
          attempts: transaction.attempts
        });
        
        // Emetti l'evento di transazione completata
        this.emit('transactionCompleted', transaction);
      } else {
        // Gestisci l'errore
        this.handleTransactionError(transaction, result.error);
      }
    } catch (error) {
      // Gestisci l'errore
      this.handleTransactionError(transaction, {
        message: error.message,
        recoverable: true
      });
    }
  }

  /**
   * Gestisce un errore di transazione
   * 
   * @param transaction - Transazione
   * @param error - Errore
   * @private
   */
  private handleTransactionError(
    transaction: BridgeTransaction,
    error?: {
      message: string;
      code?: string;
      details?: any;
      recoverable?: boolean;
    }
  ): void {
    const now = Date.now();
    
    // Aggiungi l'errore alla transazione
    transaction.errors.push({
      timestamp: now,
      message: error?.message || 'Errore sconosciuto',
      code: error?.code,
      details: error?.details
    });
    
    // Aggiorna il timestamp
    transaction.updatedAt = now;
    
    // Aggiungi l'errore alla lista degli errori recenti per il circuit breaker
    this.recentErrors.push({
      timestamp: now,
      transactionId: transaction.id
    });
    
    // Verifica se l'errore è recuperabile e se non abbiamo superato il numero massimo di tentativi
    const recoverable = error?.recoverable !== false;
    const canRetry = transaction.attempts < this.config.maxRetries;
    
    if (recoverable && canRetry) {
      // Imposta lo stato a RETRYING
      transaction.status = TransactionStatus.RETRYING;
      
      this.logger.warn('Transazione fallita, verrà riprovata', {
        transactionId: transaction.id,
        attempt: transaction.attempts,
        maxRetries: this.config.maxRetries,
        error: error?.message
      });
      
      // Emetti l'evento di transazione in retry
      this.emit('transactionRetrying', transaction);
    } else {
      // Imposta lo stato a FAILED
      transaction.status = TransactionStatus.FAILED;
      
      this.logger.error('Transazione fallita definitivamente', {
        transactionId: transaction.id,
        attempts: transaction.attempts,
        maxRetries: this.config.maxRetries,
        recoverable,
        error: error?.message
      });
      
      // Emetti l'evento di transazione fallita
      this.emit('transactionFailed', transaction);
    }
    
    // Verifica se dobbiamo aprire il circuit breaker
    this.checkCircuitBreaker();
  }

  /**
   * Calcola il ritardo di retry
   * 
   * @param attempt - Numero del tentativo
   * @returns Ritardo in millisecondi
   * @private
   */
  private calculateRetryDelay(attempt: number): number {
    // Implementa un backoff esponenziale con jitter
    const baseDelay = this.config.initialRetryDelayMs * Math.pow(this.config.retryBackoffFactor, attempt - 1);
    const jitter = baseDelay * 0.2 * Math.random();
    return Math.min(baseDelay + jitter, this.config.maxRetryDelayMs);
  }

  /**
   * Verifica se dobbiamo aprire il circuit breaker
   * 
   * @private
   */
  private checkCircuitBreaker(): void {
    // Se il circuit breaker è già aperto, non fare nulla
    if (this.circuitBreakerStatus === 'OPEN') {
      return;
    }
    
    const now = Date.now();
    
    // Filtra gli errori recenti all'interno della finestra di tempo
    const recentErrorsInWindow = this.recentErrors.filter(
      error => now - error.timestamp < this.config.circuitBreakerWindowMs
    );
    
    // Aggiorna la lista degli errori recenti
    this.recentErrors = recentErrorsInWindow;
    
    // Verifica se abbiamo superato la soglia di errori
    if (recentErrorsInWindow.length >= this.config.circuitBreakerErrorThreshold) {
      this.openCircuitBreaker();
    }
  }

  /**
   * Apre il circuit breaker
   * 
   * @private
   */
  private openCircuitBreaker(): void {
    this.circuitBreakerStatus = 'OPEN';
    
    this.logger.warn('Circuit breaker aperto', {
      recentErrors: this.recentErrors.length,
      threshold: this.config.circuitBreakerErrorThreshold,
      resetMs: this.config.circuitBreakerResetMs
    });
    
    // Emetti l'evento di circuit breaker aperto
    this.emit('circuitBreakerOpen', {
      recentErrors: this.recentErrors.length,
      threshold: this.config.circuitBreakerErrorThreshold,
      resetMs: this.config.circuitBreakerResetMs
    });
    
    // Imposta un timer per resettare il circuit breaker
    setTimeout(() => {
      this.halfOpenCircuitBreaker();
    }, this.config.circuitBreakerResetMs);
  }

  /**
   * Imposta il circuit breaker in stato half-open
   * 
   * @private
   */
  private halfOpenCircuitBreaker(): void {
    this.circuitBreakerStatus = 'HALF_OPEN';
    
    this.logger.info('Circuit breaker in stato half-open');
    
    // Emetti l'evento di circuit breaker half-open
    this.emit('circuitBreakerHalfOpen');
    
    // Pulisci la lista degli errori recenti
    this.recentErrors = [];
  }

  /**
   * Chiude il circuit breaker
   * 
   * @private
   */
  private closeCircuitBreaker(): void {
    this.circuitBreakerStatus = 'CLOSED';
    
    this.logger.info('Circuit breaker chiuso');
    
    // Emetti l'evento di circuit breaker chiuso
    this.emit('circuitBreakerClosed');
  }

  /**
   * Monitora il sistema
   * 
   * @private
   */
  private monitorSystem(): void {
    try {
      // Calcola le statistiche
      const stats = this.calculateStats();
      
      // Registra le statistiche
      this.logger.info('Statistiche del sistema', {
        totalTransactions: stats.totalTransactions,
        completedTransactions: stats.completedTransactions,
        failedTransactions: stats.failedTransactions,
        inProgressTransactions: stats.inProgressTransactions,
        successRate: stats.successRate,
        circuitBreakerStatus: this.circuitBreakerStatus
      });
      
      // Emetti l'evento di statistiche
      this.emit('stats', stats);
      
      // Se il circuit breaker è in stato half-open e abbiamo avuto successo, chiudilo
      if (this.circuitBreakerStatus === 'HALF_OPEN' && this.recentErrors.length === 0) {
        this.closeCircuitBreaker();
      }
    } catch (error) {
      this.logger.error('Errore durante il monitoraggio del sistema', { error });
    }
  }

  /**
   * Calcola le statistiche del sistema
   * 
   * @returns Statistiche del sistema
   * @private
   */
  private calculateStats(): ReliabilityStats {
    const now = Date.now();
    
    // Inizializza le statistiche
    const stats: ReliabilityStats = {
      totalTransactions: this.transactions.size,
      completedTransactions: 0,
      failedTransactions: 0,
      inProgressTransactions: 0,
      retryingTransactions: 0,
      timedOutTransactions: 0,
      successRate: 0,
      averageCompletionTimeMs: 0,
      averageAttempts: 0,
      circuitBreakerStatus: this.circuitBreakerStatus,
      recentErrors: this.recentErrors.length,
      byType: {} as Record<TransactionType, {
        total: number;
        completed: number;
        failed: number;
        successRate: number;
      }>
    };
    
    // Inizializza le statistiche per tipo
    for (const type of Object.values(TransactionType)) {
      stats.byType[type] = {
        total: 0,
        completed: 0,
        failed: 0,
        successRate: 0
      };
    }
    
    // Calcola le statistiche
    let totalCompletionTime = 0;
    let totalAttempts = 0;
    let completedCount = 0;
    
    for (const transaction of this.transactions.values()) {
      // Aggiorna le statistiche per tipo
      stats.byType[transaction.type].total++;
      
      switch (transaction.status) {
        case TransactionStatus.COMPLETED:
          stats.completedTransactions++;
          stats.byType[transaction.type].completed++;
          
          if (transaction.completedAt) {
            totalCompletionTime += transaction.completedAt - transaction.createdAt;
            completedCount++;
          }
          
          totalAttempts += transaction.attempts;
          break;
        
        case TransactionStatus.FAILED:
        case TransactionStatus.TIMED_OUT:
          stats.failedTransactions++;
          stats.byType[transaction.type].failed++;
          
          if (transaction.status === TransactionStatus.TIMED_OUT) {
            stats.timedOutTransactions++;
          }
          break;
        
        case TransactionStatus.IN_PROGRESS:
          stats.inProgressTransactions++;
          break;
        
        case TransactionStatus.RETRYING:
          stats.retryingTransactions++;
          break;
      }
    }
    
    // Calcola il tasso di successo
    const finishedTransactions = stats.completedTransactions + stats.failedTransactions;
    
    if (finishedTransactions > 0) {
      stats.successRate = stats.completedTransactions / finishedTransactions;
    }
    
    // Calcola il tempo medio di completamento
    if (completedCount > 0) {
      stats.averageCompletionTimeMs = totalCompletionTime / completedCount;
    }
    
    // Calcola il numero medio di tentativi
    if (completedCount > 0) {
      stats.averageAttempts = totalAttempts / completedCount;
    }
    
    // Calcola il tasso di successo per tipo
    for (const type of Object.values(TransactionType)) {
      const typeStats = stats.byType[type];
      const typeFinishedTransactions = typeStats.completed + typeStats.failed;
      
      if (typeFinishedTransactions > 0) {
        typeStats.successRate = typeStats.completed / typeFinishedTransactions;
      }
    }
    
    return stats;
  }

  /**
   * Registra un executor per un tipo di transazione
   * 
   * @param type - Tipo di transazione
   * @param executor - Funzione di esecuzione
   */
  registerExecutor(type: TransactionType, executor: TransactionExecutor): void {
    this.executors.set(type, executor);
    
    this.logger.info('Executor registrato', {
      type
    });
  }

  /**
   * Registra un verifier per un tipo di transazione
   * 
   * @param type - Tipo di transazione
   * @param verifier - Funzione di verifica
   */
  registerVerifier(type: TransactionType, verifier: TransactionVerifier): void {
    this.verifiers.set(type, verifier);
    
    this.logger.info('Verifier registrato', {
      type
    });
  }

  /**
   * Crea una nuova transazione
   * 
   * @param type - Tipo di transazione
   * @param data - Dati della transazione
   * @returns ID della transazione
   */
  createTransaction(
    type: TransactionType,
    data: {
      sourceChain: string;
      destinationChain: string;
      sourceAddress: string;
      destinationAddress: string;
      token: string;
      amount: string;
      data?: any;
    }
  ): string {
    // Genera un ID univoco
    const id = crypto.randomUUID();
    
    // Crea la transazione
    const transaction: BridgeTransaction = {
      id,
      type,
      status: TransactionStatus.PENDING,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sourceChain: data.sourceChain,
      destinationChain: data.destinationChain,
      sourceAddress: data.sourceAddress,
      destinationAddress: data.destinationAddress,
      token: data.token,
      amount: data.amount,
      attempts: 0,
      errors: [],
      data: data.data
    };
    
    // Salva la transazione
    this.transactions.set(id, transaction);
    
    this.logger.info('Transazione creata', {
      id,
      type,
      sourceChain: data.sourceChain,
      destinationChain: data.destinationChain,
      token: data.token,
      amount: data.amount
    });
    
    // Emetti l'evento di transazione creata
    this.emit('transactionCreated', transaction);
    
    return id;
  }

  /**
   * Ottiene una transazione
   * 
   * @param id - ID della transazione
   * @returns Transazione o undefined se non trovata
   */
  getTransaction(id: string): BridgeTransaction | undefined {
    return this.transactions.get(id);
  }

  /**
   * Ottiene tutte le transazioni
   * 
   * @returns Array di transazioni
   */
  getAllTransactions(): BridgeTransaction[] {
    return Array.from(this.transactions.values());
  }

  /**
   * Ottiene le transazioni per stato
   * 
   * @param status - Stato delle transazioni
   * @returns Array di transazioni
   */
  getTransactionsByStatus(status: TransactionStatus): BridgeTransaction[] {
    return Array.from(this.transactions.values()).filter(tx => tx.status === status);
  }

  /**
   * Ottiene le transazioni per tipo
   * 
   * @param type - Tipo di transazione
   * @returns Array di transazioni
   */
  getTransactionsByType(type: TransactionType): BridgeTransaction[] {
    return Array.from(this.transactions.values()).filter(tx => tx.type === type);
  }

  /**
   * Annulla una transazione
   * 
   * @param id - ID della transazione
   * @returns true se la transazione è stata annullata, false altrimenti
   */
  cancelTransaction(id: string): boolean {
    const transaction = this.transactions.get(id);
    
    if (!transaction) {
      this.logger.error('Transazione non trovata', { id });
      return false;
    }
    
    // Verifica se la transazione può essere annullata
    if (transaction.status === TransactionStatus.COMPLETED ||
        transaction.status === TransactionStatus.FAILED ||
        transaction.status === TransactionStatus.TIMED_OUT ||
        transaction.status === TransactionStatus.CANCELLED) {
      this.logger.error('Impossibile annullare la transazione nello stato corrente', {
        id,
        status: transaction.status
      });
      return false;
    }
    
    // Aggiorna lo stato della transazione
    transaction.status = TransactionStatus.CANCELLED;
    transaction.updatedAt = Date.now();
    
    this.logger.info('Transazione annullata', { id });
    
    // Emetti l'evento di transazione annullata
    this.emit('transactionCancelled', transaction);
    
    return true;
  }

  /**
   * Riprova una transazione fallita
   * 
   * @param id - ID della transazione
   * @returns true se la transazione è stata riprovata, false altrimenti
   */
  retryTransaction(id: string): boolean {
    const transaction = this.transactions.get(id);
    
    if (!transaction) {
      this.logger.error('Transazione non trovata', { id });
      return false;
    }
    
    // Verifica se la transazione può essere riprovata
    if (transaction.status !== TransactionStatus.FAILED &&
        transaction.status !== TransactionStatus.TIMED_OUT) {
      this.logger.error('Impossibile riprovare la transazione nello stato corrente', {
        id,
        status: transaction.status
      });
      return false;
    }
    
    // Aggiorna lo stato della transazione
    transaction.status = TransactionStatus.PENDING;
    transaction.updatedAt = Date.now();
    
    this.logger.info('Transazione riprovata', { id });
    
    // Emetti l'evento di transazione riprovata
    this.emit('transactionRetried', transaction);
    
    return true;
  }

  /**
   * Pulisce le transazioni vecchie
   * 
   * @param maxAgeMs - Età massima in millisecondi
   * @returns Numero di transazioni rimosse
   */
  cleanupOldTransactions(maxAgeMs: number): number {
    const now = Date.now();
    let removedCount = 0;
    
    for (const [id, transaction] of this.transactions.entries()) {
      // Rimuovi solo le transazioni completate, fallite, scadute o annullate
      if ((transaction.status === TransactionStatus.COMPLETED ||
           transaction.status === TransactionStatus.FAILED ||
           transaction.status === TransactionStatus.TIMED_OUT ||
           transaction.status === TransactionStatus.CANCELLED) &&
          now - transaction.updatedAt > maxAgeMs) {
        this.transactions.delete(id);
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      this.logger.info('Transazioni vecchie rimosse', {
        count: removedCount,
        maxAgeMs
      });
    }
    
    return removedCount;
  }

  /**
   * Ottiene le statistiche del sistema
   * 
   * @returns Statistiche del sistema
   */
  getStats(): ReliabilityStats {
    return this.calculateStats();
  }

  /**
   * Ottiene la configurazione
   * 
   * @returns Configurazione
   */
  getConfig(): BridgeReliabilityConfig {
    return { ...this.config };
  }

  /**
   * Aggiorna la configurazione
   * 
   * @param config - Nuova configurazione
   */
  updateConfig(config: Partial<BridgeReliabilityConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
    
    // Aggiorna gli intervalli se necessario
    if (config.transactionCheckIntervalMs !== undefined) {
      this.startTransactionCheck();
    }
    
    if (config.enableAdvancedMonitoring !== undefined || config.monitoringIntervalMs !== undefined) {
      if (this.config.enableAdvancedMonitoring) {
        this.startMonitoring();
      } else if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }
    }
    
    this.logger.info('Configurazione aggiornata', {
      maxRetries: this.config.maxRetries,
      initialRetryDelayMs: this.config.initialRetryDelayMs,
      transactionTimeoutMs: this.config.transactionTimeoutMs
    });
  }

  /**
   * Arresta il sistema di affidabilità del bridge
   */
  async shutdown(): Promise<void> {
    try {
      this.logger.info('Arresto di BridgeReliabilitySystem');
      
      // Arresta il controllo periodico delle transazioni
      if (this.transactionCheckInterval) {
        clearInterval(this.transactionCheckInterval);
        this.transactionCheckInterval = null;
      }
      
      // Arresta il monitoraggio
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }
      
      this.logger.info('BridgeReliabilitySystem arrestato con successo');
    } catch (error) {
      this.logger.error('Errore durante l\'arresto di BridgeReliabilitySystem', { error });
      throw new Error(`Errore durante l'arresto di BridgeReliabilitySystem: ${error.message}`);
    }
  }
}
