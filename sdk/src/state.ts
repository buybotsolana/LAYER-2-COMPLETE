/**
 * @fileoverview Modulo per la gestione dello stato del Layer 2 di Solana
 */

import { PublicKey } from '@solana/web3.js';
import { Layer2Client } from './client';
import { Layer2Error, ErrorCode } from './types/errors';

/**
 * Tipo di account nel Layer 2
 */
export enum Layer2AccountType {
  USER = 'user',
  CONTRACT = 'contract',
  SYSTEM = 'system'
}

/**
 * Informazioni su un account nel Layer 2
 */
export interface Layer2AccountInfo {
  /** Indirizzo pubblico dell'account */
  address: string;
  /** Tipo di account */
  type: Layer2AccountType;
  /** Saldo dell'account in lamports */
  balance: number;
  /** Nonce dell'account */
  nonce: number;
  /** Hash dello stato dell'account */
  stateHash: string;
  /** Timestamp dell'ultimo aggiornamento */
  lastUpdated: number;
  /** Dati specifici dell'account */
  data?: any;
}

/**
 * Informazioni sullo stato globale del Layer 2
 */
export interface Layer2StateInfo {
  /** Hash del root di stato corrente */
  stateRoot: string;
  /** Numero di blocco corrente */
  blockNumber: number;
  /** Timestamp dell'ultimo aggiornamento */
  lastUpdated: number;
  /** Numero totale di account */
  totalAccounts: number;
  /** Numero totale di transazioni */
  totalTransactions: number;
  /** Numero totale di batch */
  totalBatches: number;
  /** Metriche di performance */
  metrics: {
    /** Transazioni al secondo */
    tps: number;
    /** Tempo medio di finalizzazione */
    avgFinalizationTime: number;
    /** Tempo medio di conferma */
    avgConfirmationTime: number;
  };
}

/**
 * Opzioni per il monitoraggio dello stato
 */
export interface StateMonitorOptions {
  /** Intervallo di polling in millisecondi */
  pollingInterval?: number;
  /** Callback per gli aggiornamenti di stato */
  onStateUpdate?: (state: Layer2StateInfo) => void;
  /** Callback per gli errori */
  onError?: (error: Error) => void;
}

/**
 * Gestore dello stato del Layer 2
 */
export class StateManager {
  private client: Layer2Client;
  private monitoringInterval: NodeJS.Timeout | null = null;

  /**
   * Crea una nuova istanza dello StateManager
   * @param client Client Layer 2
   */
  constructor(client: Layer2Client) {
    this.client = client;
  }

  /**
   * Ottiene lo stato globale del Layer 2
   * @returns Promise che si risolve con le informazioni sullo stato globale
   */
  public async getGlobalState(): Promise<Layer2StateInfo> {
    try {
      // Chiamata all'API del Layer 2 per ottenere lo stato globale
      const response = await fetch(
        `${this.client.getConfig().rpcUrl}/state`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Layer2Error(
          `Errore nell'ottenimento dello stato globale: ${response.statusText}`,
          ErrorCode.STATE_FETCH_FAILED
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nell'ottenimento dello stato globale: ${error.message}`,
        ErrorCode.STATE_FETCH_FAILED
      );
    }
  }

  /**
   * Ottiene le informazioni su un account nel Layer 2
   * @param address Indirizzo pubblico dell'account
   * @returns Promise che si risolve con le informazioni sull'account
   */
  public async getAccountInfo(address: PublicKey | string): Promise<Layer2AccountInfo> {
    try {
      const addressStr = typeof address === 'string' ? address : address.toString();
      
      // Chiamata all'API del Layer 2 per ottenere le informazioni sull'account
      const response = await fetch(
        `${this.client.getConfig().rpcUrl}/state/account/${addressStr}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Layer2Error(
          `Errore nell'ottenimento delle informazioni sull'account: ${response.statusText}`,
          ErrorCode.ACCOUNT_INFO_FAILED
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nell'ottenimento delle informazioni sull'account: ${error.message}`,
        ErrorCode.ACCOUNT_INFO_FAILED
      );
    }
  }

  /**
   * Ottiene il saldo di un account nel Layer 2
   * @param address Indirizzo pubblico dell'account
   * @returns Promise che si risolve con il saldo dell'account in lamports
   */
  public async getBalance(address: PublicKey | string): Promise<number> {
    try {
      const accountInfo = await this.getAccountInfo(address);
      return accountInfo.balance;
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nell'ottenimento del saldo: ${error.message}`,
        ErrorCode.BALANCE_FETCH_FAILED
      );
    }
  }

  /**
   * Ottiene il nonce di un account nel Layer 2
   * @param address Indirizzo pubblico dell'account
   * @returns Promise che si risolve con il nonce dell'account
   */
  public async getNonce(address: PublicKey | string): Promise<number> {
    try {
      const accountInfo = await this.getAccountInfo(address);
      return accountInfo.nonce;
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nell'ottenimento del nonce: ${error.message}`,
        ErrorCode.NONCE_FETCH_FAILED
      );
    }
  }

  /**
   * Inizia il monitoraggio dello stato del Layer 2
   * @param options Opzioni per il monitoraggio
   * @returns Promise che si risolve quando il monitoraggio è avviato
   */
  public startStateMonitoring(options: StateMonitorOptions = {}): void {
    // Se il monitoraggio è già attivo, fermalo prima di riavviarlo
    if (this.monitoringInterval) {
      this.stopStateMonitoring();
    }

    const defaultOptions: StateMonitorOptions = {
      pollingInterval: 5000,
      onStateUpdate: () => {},
      onError: () => {}
    };

    const mergedOptions = { ...defaultOptions, ...options };

    // Funzione di polling
    const pollState = async () => {
      try {
        const state = await this.getGlobalState();
        if (mergedOptions.onStateUpdate) {
          mergedOptions.onStateUpdate(state);
        }
      } catch (error) {
        if (mergedOptions.onError) {
          mergedOptions.onError(error);
        }
      }
    };

    // Esegui subito il primo polling
    pollState();

    // Imposta l'intervallo di polling
    this.monitoringInterval = setInterval(pollState, mergedOptions.pollingInterval);
  }

  /**
   * Ferma il monitoraggio dello stato del Layer 2
   */
  public stopStateMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  /**
   * Verifica se un account esiste nel Layer 2
   * @param address Indirizzo pubblico dell'account
   * @returns Promise che si risolve con true se l'account esiste, false altrimenti
   */
  public async accountExists(address: PublicKey | string): Promise<boolean> {
    try {
      await this.getAccountInfo(address);
      return true;
    } catch (error) {
      if (error instanceof Layer2Error && error.code === ErrorCode.ACCOUNT_INFO_FAILED) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Ottiene la differenza di stato tra due blocchi
   * @param fromBlock Numero del blocco iniziale
   * @param toBlock Numero del blocco finale (default: blocco corrente)
   * @returns Promise che si risolve con la differenza di stato
   */
  public async getStateDiff(fromBlock: number, toBlock?: number): Promise<any> {
    try {
      // Se toBlock non è specificato, usa il blocco corrente
      const targetToBlock = toBlock || (await this.getGlobalState()).blockNumber;
      
      // Chiamata all'API del Layer 2 per ottenere la differenza di stato
      const response = await fetch(
        `${this.client.getConfig().rpcUrl}/state/diff?fromBlock=${fromBlock}&toBlock=${targetToBlock}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Layer2Error(
          `Errore nell'ottenimento della differenza di stato: ${response.statusText}`,
          ErrorCode.STATE_DIFF_FAILED
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nell'ottenimento della differenza di stato: ${error.message}`,
        ErrorCode.STATE_DIFF_FAILED
      );
    }
  }
}
