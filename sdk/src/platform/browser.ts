/**
 * @fileoverview Modulo per garantire la compatibilità con browser dell'SDK Layer 2 di Solana
 */

import { Layer2Client, Layer2ClientConfig } from '../client';
import { setupEnvironment, isBrowser } from '../utils/platform';

/**
 * Configurazione specifica per browser
 */
export interface BrowserConfig {
  /** Abilitare il supporto per Web Workers */
  enableWebWorkers?: boolean;
  /** Abilitare il supporto per IndexedDB per la persistenza */
  enableIndexedDB?: boolean;
  /** Abilitare il supporto per localStorage */
  enableLocalStorage?: boolean;
  /** Abilitare il supporto per WebSocket */
  enableWebSocket?: boolean;
  /** Timeout per le richieste in millisecondi */
  requestTimeout?: number;
}

/**
 * Classe wrapper per garantire la compatibilità con browser
 */
export class BrowserLayer2Client extends Layer2Client {
  private browserConfig: BrowserConfig;
  private workers: Worker[] = [];
  private db: IDBDatabase | null = null;

  /**
   * Crea una nuova istanza del client Layer 2 compatibile con browser
   * @param config Configurazione del client
   * @param browserConfig Configurazione specifica per browser
   */
  constructor(config: Layer2ClientConfig, browserConfig: BrowserConfig = {}) {
    // Verifica che l'ambiente sia un browser
    if (!isBrowser()) {
      throw new Error('BrowserLayer2Client può essere utilizzato solo in ambiente browser');
    }

    // Configura l'ambiente
    setupEnvironment();

    // Chiama il costruttore della classe base
    super(config);

    // Configurazione di default per browser
    this.browserConfig = {
      enableWebWorkers: true,
      enableIndexedDB: true,
      enableLocalStorage: true,
      enableWebSocket: true,
      requestTimeout: 30000,
      ...browserConfig
    };

    // Inizializza le funzionalità specifiche per browser
    this.initBrowserFeatures();
  }

  /**
   * Inizializza le funzionalità specifiche per browser
   */
  private async initBrowserFeatures(): Promise<void> {
    try {
      // Inizializza IndexedDB se abilitato
      if (this.browserConfig.enableIndexedDB) {
        await this.initIndexedDB();
      }

      // Inizializza i Web Workers se abilitati
      if (this.browserConfig.enableWebWorkers) {
        this.initWebWorkers();
      }

      // Inizializza il supporto per WebSocket se abilitato
      if (this.browserConfig.enableWebSocket) {
        this.initWebSocket();
      }

      // Inizializza il supporto per localStorage se abilitato
      if (this.browserConfig.enableLocalStorage) {
        this.initLocalStorage();
      }
    } catch (error) {
      console.error('Errore nell\'inizializzazione delle funzionalità del browser:', error);
    }
  }

  /**
   * Inizializza IndexedDB per la persistenza dei dati
   */
  private initIndexedDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        console.warn('IndexedDB non è supportato in questo browser');
        resolve();
        return;
      }

      const request = window.indexedDB.open('Layer2SolanaSDK', 1);

      request.onerror = (event) => {
        console.error('Errore nell\'apertura di IndexedDB:', event);
        reject(new Error('Errore nell\'apertura di IndexedDB'));
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Crea gli object store necessari
        if (!db.objectStoreNames.contains('transactions')) {
          db.createObjectStore('transactions', { keyPath: 'id' });
        }
        
        if (!db.objectStoreNames.contains('batches')) {
          db.createObjectStore('batches', { keyPath: 'id' });
        }
        
        if (!db.objectStoreNames.contains('proofs')) {
          db.createObjectStore('proofs', { keyPath: 'id' });
        }
        
        if (!db.objectStoreNames.contains('state')) {
          db.createObjectStore('state', { keyPath: 'key' });
        }
      };
    });
  }

  /**
   * Inizializza i Web Workers per l'elaborazione parallela
   */
  private initWebWorkers(): void {
    if (!window.Worker) {
      console.warn('Web Workers non sono supportati in questo browser');
      return;
    }

    // Crea i worker per le operazioni intensive
    try {
      // Worker per la verifica delle prove
      const proofWorkerCode = `
        self.onmessage = function(e) {
          const { proofData, type } = e.data;
          
          // Simula la verifica della prova
          setTimeout(() => {
            self.postMessage({ 
              result: true, 
              type: type, 
              message: 'Prova verificata con successo' 
            });
          }, 500);
        }
      `;
      
      // Worker per il batching delle transazioni
      const batchWorkerCode = `
        self.onmessage = function(e) {
          const { transactions, config } = e.data;
          
          // Simula il batching delle transazioni
          setTimeout(() => {
            self.postMessage({ 
              result: { 
                batchId: 'batch-' + Date.now(), 
                transactionCount: transactions.length 
              }, 
              message: 'Batch creato con successo' 
            });
          }, 300);
        }
      `;

      // Crea i worker
      const proofWorkerBlob = new Blob([proofWorkerCode], { type: 'application/javascript' });
      const batchWorkerBlob = new Blob([batchWorkerCode], { type: 'application/javascript' });
      
      const proofWorker = new Worker(URL.createObjectURL(proofWorkerBlob));
      const batchWorker = new Worker(URL.createObjectURL(batchWorkerBlob));
      
      this.workers.push(proofWorker, batchWorker);
    } catch (error) {
      console.error('Errore nella creazione dei Web Workers:', error);
    }
  }

  /**
   * Inizializza il supporto per WebSocket
   */
  private initWebSocket(): void {
    if (!window.WebSocket) {
      console.warn('WebSocket non è supportato in questo browser');
      return;
    }

    // Implementazione del supporto per WebSocket verrà aggiunta in futuro
  }

  /**
   * Inizializza il supporto per localStorage
   */
  private initLocalStorage(): void {
    if (!window.localStorage) {
      console.warn('localStorage non è supportato in questo browser');
      return;
    }

    // Salva la versione dell'SDK in localStorage
    try {
      localStorage.setItem('layer2-solana-sdk-version', '0.2.0');
      localStorage.setItem('layer2-solana-sdk-init-time', Date.now().toString());
    } catch (error) {
      console.warn('Errore nell\'accesso a localStorage:', error);
    }
  }

  /**
   * Salva i dati in IndexedDB
   * @param storeName Nome dell'object store
   * @param data Dati da salvare
   * @returns Promise che si risolve quando i dati sono stati salvati
   */
  public saveToIndexedDB(storeName: string, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('IndexedDB non è inizializzato'));
        return;
      }

      try {
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(data);

        request.onsuccess = () => {
          resolve();
        };

        request.onerror = (event) => {
          reject(new Error(`Errore nel salvataggio dei dati in IndexedDB: ${event}`));
        };
      } catch (error) {
        reject(new Error(`Errore nella transazione IndexedDB: ${error}`));
      }
    });
  }

  /**
   * Carica i dati da IndexedDB
   * @param storeName Nome dell'object store
   * @param key Chiave dei dati da caricare
   * @returns Promise che si risolve con i dati caricati
   */
  public loadFromIndexedDB(storeName: string, key: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('IndexedDB non è inizializzato'));
        return;
      }

      try {
        const transaction = this.db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);

        request.onsuccess = (event) => {
          resolve((event.target as IDBRequest).result);
        };

        request.onerror = (event) => {
          reject(new Error(`Errore nel caricamento dei dati da IndexedDB: ${event}`));
        };
      } catch (error) {
        reject(new Error(`Errore nella transazione IndexedDB: ${error}`));
      }
    });
  }

  /**
   * Esegue un'operazione in un Web Worker
   * @param workerIndex Indice del worker da utilizzare
   * @param data Dati da inviare al worker
   * @returns Promise che si risolve con il risultato dell'operazione
   */
  public executeInWorker(workerIndex: number, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.browserConfig.enableWebWorkers || this.workers.length === 0) {
        reject(new Error('Web Workers non sono abilitati o inizializzati'));
        return;
      }

      if (workerIndex < 0 || workerIndex >= this.workers.length) {
        reject(new Error('Indice del worker non valido'));
        return;
      }

      const worker = this.workers[workerIndex];
      
      // Imposta il gestore dei messaggi
      const messageHandler = (event: MessageEvent) => {
        worker.removeEventListener('message', messageHandler);
        resolve(event.data);
      };
      
      // Imposta il gestore degli errori
      const errorHandler = (error: ErrorEvent) => {
        worker.removeEventListener('error', errorHandler);
        reject(new Error(`Errore nel Web Worker: ${error.message}`));
      };
      
      worker.addEventListener('message', messageHandler);
      worker.addEventListener('error', errorHandler);
      
      // Invia i dati al worker
      worker.postMessage(data);
    });
  }

  /**
   * Pulisce le risorse del client
   */
  public override disconnect(): void {
    // Chiama il metodo della classe base
    super.disconnect();

    // Termina i Web Workers
    this.workers.forEach(worker => worker.terminate());
    this.workers = [];

    // Chiudi IndexedDB
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
