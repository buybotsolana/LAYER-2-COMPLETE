/**
 * @fileoverview Modulo per garantire la compatibilità con Node.js dell'SDK Layer 2 di Solana
 */

import { Layer2Client, Layer2ClientConfig } from '../client';
import { setupEnvironment, isNode } from '../utils/platform';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Worker } from 'worker_threads';

/**
 * Configurazione specifica per Node.js
 */
export interface NodeConfig {
  /** Abilitare il supporto per worker threads */
  enableWorkerThreads?: boolean;
  /** Abilitare la persistenza su file system */
  enableFileSystemStorage?: boolean;
  /** Directory per la persistenza dei dati */
  dataDir?: string;
  /** Numero di worker threads da utilizzare */
  numWorkerThreads?: number;
  /** Timeout per le richieste in millisecondi */
  requestTimeout?: number;
}

/**
 * Classe wrapper per garantire la compatibilità con Node.js
 */
export class NodeLayer2Client extends Layer2Client {
  private nodeConfig: NodeConfig;
  private workers: Worker[] = [];
  private dataDir: string;

  /**
   * Crea una nuova istanza del client Layer 2 compatibile con Node.js
   * @param config Configurazione del client
   * @param nodeConfig Configurazione specifica per Node.js
   */
  constructor(config: Layer2ClientConfig, nodeConfig: NodeConfig = {}) {
    // Verifica che l'ambiente sia Node.js
    if (!isNode()) {
      throw new Error('NodeLayer2Client può essere utilizzato solo in ambiente Node.js');
    }

    // Configura l'ambiente
    setupEnvironment();

    // Chiama il costruttore della classe base
    super(config);

    // Configurazione di default per Node.js
    this.nodeConfig = {
      enableWorkerThreads: true,
      enableFileSystemStorage: true,
      dataDir: path.join(os.homedir(), '.layer2-solana-sdk'),
      numWorkerThreads: os.cpus().length,
      requestTimeout: 30000,
      ...nodeConfig
    };

    // Imposta la directory dei dati
    this.dataDir = this.nodeConfig.dataDir!;

    // Inizializza le funzionalità specifiche per Node.js
    this.initNodeFeatures();
  }

  /**
   * Inizializza le funzionalità specifiche per Node.js
   */
  private async initNodeFeatures(): Promise<void> {
    try {
      // Inizializza la persistenza su file system se abilitata
      if (this.nodeConfig.enableFileSystemStorage) {
        await this.initFileSystemStorage();
      }

      // Inizializza i worker threads se abilitati
      if (this.nodeConfig.enableWorkerThreads) {
        this.initWorkerThreads();
      }
    } catch (error) {
      console.error('Errore nell\'inizializzazione delle funzionalità di Node.js:', error);
    }
  }

  /**
   * Inizializza la persistenza su file system
   */
  private async initFileSystemStorage(): Promise<void> {
    try {
      // Crea la directory dei dati se non esiste
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      // Crea le sottodirectory necessarie
      const subdirs = ['transactions', 'batches', 'proofs', 'state'];
      for (const subdir of subdirs) {
        const dirPath = path.join(this.dataDir, subdir);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
      }

      // Salva la versione dell'SDK
      await this.saveToFile('metadata', 'version.json', JSON.stringify({
        version: '0.2.0',
        initTime: Date.now()
      }));
    } catch (error) {
      console.error('Errore nell\'inizializzazione della persistenza su file system:', error);
    }
  }

  /**
   * Inizializza i worker threads per l'elaborazione parallela
   */
  private initWorkerThreads(): void {
    try {
      // Crea i worker per le operazioni intensive
      const numWorkers = this.nodeConfig.numWorkerThreads!;
      
      // Codice per il worker di verifica delle prove
      const proofWorkerCode = `
        const { parentPort } = require('worker_threads');
        
        parentPort.on('message', (data) => {
          const { proofData, type } = data;
          
          // Simula la verifica della prova
          setTimeout(() => {
            parentPort.postMessage({ 
              result: true, 
              type: type, 
              message: 'Prova verificata con successo' 
            });
          }, 500);
        });
      `;
      
      // Codice per il worker di batching delle transazioni
      const batchWorkerCode = `
        const { parentPort } = require('worker_threads');
        
        parentPort.on('message', (data) => {
          const { transactions, config } = data;
          
          // Simula il batching delle transazioni
          setTimeout(() => {
            parentPort.postMessage({ 
              result: { 
                batchId: 'batch-' + Date.now(), 
                transactionCount: transactions.length 
              }, 
              message: 'Batch creato con successo' 
            });
          }, 300);
        });
      `;

      // Salva i file dei worker
      const proofWorkerPath = path.join(this.dataDir, 'proof-worker.js');
      const batchWorkerPath = path.join(this.dataDir, 'batch-worker.js');
      
      fs.writeFileSync(proofWorkerPath, proofWorkerCode);
      fs.writeFileSync(batchWorkerPath, batchWorkerCode);
      
      // Crea i worker
      const proofWorker = new Worker(proofWorkerPath);
      const batchWorker = new Worker(batchWorkerPath);
      
      this.workers.push(proofWorker, batchWorker);
      
      // Crea worker aggiuntivi se necessario
      for (let i = 2; i < numWorkers; i++) {
        const worker = new Worker(i % 2 === 0 ? proofWorkerPath : batchWorkerPath);
        this.workers.push(worker);
      }
    } catch (error) {
      console.error('Errore nella creazione dei worker threads:', error);
    }
  }

  /**
   * Salva i dati su file
   * @param category Categoria dei dati (transactions, batches, proofs, state, metadata)
   * @param filename Nome del file
   * @param data Dati da salvare
   * @returns Promise che si risolve quando i dati sono stati salvati
   */
  public async saveToFile(category: string, filename: string, data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.nodeConfig.enableFileSystemStorage) {
        reject(new Error('La persistenza su file system non è abilitata'));
        return;
      }

      try {
        const filePath = path.join(this.dataDir, category, filename);
        fs.writeFile(filePath, data, (err) => {
          if (err) {
            reject(new Error(`Errore nel salvataggio dei dati su file: ${err.message}`));
          } else {
            resolve();
          }
        });
      } catch (error) {
        reject(new Error(`Errore nel salvataggio dei dati su file: ${error.message}`));
      }
    });
  }

  /**
   * Carica i dati da file
   * @param category Categoria dei dati (transactions, batches, proofs, state, metadata)
   * @param filename Nome del file
   * @returns Promise che si risolve con i dati caricati
   */
  public async loadFromFile(category: string, filename: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.nodeConfig.enableFileSystemStorage) {
        reject(new Error('La persistenza su file system non è abilitata'));
        return;
      }

      try {
        const filePath = path.join(this.dataDir, category, filename);
        fs.readFile(filePath, 'utf8', (err, data) => {
          if (err) {
            reject(new Error(`Errore nel caricamento dei dati da file: ${err.message}`));
          } else {
            resolve(data);
          }
        });
      } catch (error) {
        reject(new Error(`Errore nel caricamento dei dati da file: ${error.message}`));
      }
    });
  }

  /**
   * Esegue un'operazione in un worker thread
   * @param workerIndex Indice del worker da utilizzare
   * @param data Dati da inviare al worker
   * @returns Promise che si risolve con il risultato dell'operazione
   */
  public executeInWorker(workerIndex: number, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.nodeConfig.enableWorkerThreads || this.workers.length === 0) {
        reject(new Error('Worker threads non sono abilitati o inizializzati'));
        return;
      }

      if (workerIndex < 0 || workerIndex >= this.workers.length) {
        reject(new Error('Indice del worker non valido'));
        return;
      }

      const worker = this.workers[workerIndex];
      
      // Imposta il gestore dei messaggi
      const messageHandler = (result: any) => {
        worker.off('message', messageHandler);
        resolve(result);
      };
      
      // Imposta il gestore degli errori
      const errorHandler = (error: Error) => {
        worker.off('error', errorHandler);
        reject(new Error(`Errore nel worker thread: ${error.message}`));
      };
      
      worker.on('message', messageHandler);
      worker.on('error', errorHandler);
      
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

    // Termina i worker threads
    this.workers.forEach(worker => worker.terminate());
    this.workers = [];
  }
}
