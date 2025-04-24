// Bridge ottimizzato per il Layer 2 di Solana
// Questo file implementa un bridge ad alte prestazioni tra Layer 1 e Layer 2

const { Connection, PublicKey, Keypair, Transaction, SystemProgram } = require('@solana/web3.js');
const { MerkleTree } = require('merkletreejs');
const { sha256 } = require('crypto-js');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

/**
 * Configurazione del bridge ottimizzato
 */
class BridgeConfig {
  constructor(options = {}) {
    // Parametri di configurazione con valori predefiniti
    this.batchSize = options.batchSize || 100;
    this.maxParallelism = options.maxParallelism || 8;
    this.confirmationLevels = options.confirmationLevels || 2;
    this.adaptiveConfirmations = options.adaptiveConfirmations !== false;
    this.maxConfirmationLevel = options.maxConfirmationLevel || 5;
    this.minConfirmationLevel = options.minConfirmationLevel || 1;
    this.highValueThreshold = options.highValueThreshold || 100 * 1e9; // 100 SOL
    this.optimisticExecution = options.optimisticExecution !== false;
    this.prefetchingEnabled = options.prefetchingEnabled !== false;
    this.cachingEnabled = options.cachingEnabled !== false;
    this.cacheSize = options.cacheSize || 10000;
    this.cacheTTL = options.cacheTTL || 3600000; // 1 ora in ms
    this.priorityLevels = options.priorityLevels || 3;
    this.monitoringEnabled = options.monitoringEnabled !== false;
    this.metricsInterval = options.metricsInterval || 10000; // ms
    
    // Endpoint RPC di Solana
    this.rpcEndpoint = options.rpcEndpoint || 'https://api.devnet.solana.com';
    
    // Chiave del bridge
    this.bridgeKeypair = options.bridgeKeypair || Keypair.generate();
    
    // Program ID del Layer 2
    this.programId = options.programId || new PublicKey('Layer2ProgramIdXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
    
    // Validazione della configurazione
    this._validateConfig();
  }
  
  _validateConfig() {
    if (this.batchSize < 1 || this.batchSize > 1000) {
      throw new Error('batchSize deve essere compreso tra 1 e 1000');
    }
    
    if (this.maxParallelism < 1 || this.maxParallelism > 32) {
      throw new Error('maxParallelism deve essere compreso tra 1 e 32');
    }
    
    if (this.confirmationLevels < 1 || this.confirmationLevels > 10) {
      throw new Error('confirmationLevels deve essere compreso tra 1 e 10');
    }
  }
}

/**
 * Classe principale del bridge ottimizzato
 */
class UltraOptimizedBridge {
  constructor(config = {}) {
    this.config = new BridgeConfig(config);
    this.connection = new Connection(this.config.rpcEndpoint);
    this.pendingDeposits = [];
    this.pendingWithdrawals = [];
    this.processingBatch = false;
    this.workers = [];
    this.cache = new Map();
    this.cacheTimestamps = new Map();
    this.metrics = {
      totalDeposits: 0,
      totalWithdrawals: 0,
      averageDepositTime: 0,
      averageWithdrawalTime: 0,
      lastMetricsTime: Date.now(),
      processingTimes: {
        deposits: [],
        withdrawals: []
      }
    };
    
    // Inizializzazione delle code di priorità
    this.priorityQueues = {
      deposits: Array(this.config.priorityLevels).fill().map(() => []),
      withdrawals: Array(this.config.priorityLevels).fill().map(() => [])
    };
    
    // Inizializzazione degli worker threads
    this._initializeWorkers();
    
    // Avvio del monitoraggio
    if (this.config.monitoringEnabled) {
      this._startMonitoring();
    }
    
    // Avvio del garbage collector della cache
    if (this.config.cachingEnabled) {
      this._startCacheGC();
    }
    
    console.log(`Bridge ottimizzato inizializzato con ${this.config.maxParallelism} worker threads`);
  }
  
  /**
   * Inizializza i worker threads per l'elaborazione parallela
   */
  _initializeWorkers() {
    const numWorkers = Math.min(this.config.maxParallelism, os.cpus().length);
    
    for (let i = 0; i < numWorkers; i++) {
      const worker = new Worker(`${__dirname}/bridge-worker.js`, {
        workerData: {
          workerId: i,
          config: this.config
        }
      });
      
      worker.on('message', (message) => {
        if (message.type === 'batch_processed') {
          this._handleProcessedBatch(message.result);
        } else if (message.type === 'error') {
          console.error(`Worker ${i} error:`, message.error);
        }
      });
      
      worker.on('error', (err) => {
        console.error(`Worker ${i} error:`, err);
        // Ricrea il worker in caso di errore
        this.workers[i] = this._createWorker(i);
      });
      
      this.workers.push(worker);
    }
  }
  
  /**
   * Avvia il monitoraggio delle metriche
   */
  _startMonitoring() {
    setInterval(() => {
      const now = Date.now();
      const elapsed = (now - this.metrics.lastMetricsTime) / 1000;
      
      if (elapsed > 0) {
        // Calcola i tempi medi
        const avgDepositTime = this.metrics.processingTimes.deposits.length > 0
          ? this.metrics.processingTimes.deposits.reduce((sum, time) => sum + time, 0) / this.metrics.processingTimes.deposits.length
          : 0;
        
        const avgWithdrawalTime = this.metrics.processingTimes.withdrawals.length > 0
          ? this.metrics.processingTimes.withdrawals.reduce((sum, time) => sum + time, 0) / this.metrics.processingTimes.withdrawals.length
          : 0;
        
        this.metrics.averageDepositTime = avgDepositTime;
        this.metrics.averageWithdrawalTime = avgWithdrawalTime;
        this.metrics.lastMetricsTime = now;
        this.metrics.processingTimes.deposits = [];
        this.metrics.processingTimes.withdrawals = [];
        
        console.log(`Metriche bridge - Depositi totali: ${this.metrics.totalDeposits}, Prelievi totali: ${this.metrics.totalWithdrawals}`);
        console.log(`Tempo medio deposito: ${avgDepositTime.toFixed(2)} ms, Tempo medio prelievo: ${avgWithdrawalTime.toFixed(2)} ms`);
        console.log(`Hit rate cache: ${this._getCacheHitRate().toFixed(2)}%`);
      }
    }, this.config.metricsInterval);
  }
  
  /**
   * Avvia il garbage collector della cache
   */
  _startCacheGC() {
    setInterval(() => {
      const now = Date.now();
      let expiredCount = 0;
      
      // Rimuovi le entry scadute
      for (const [key, timestamp] of this.cacheTimestamps.entries()) {
        if (now - timestamp > this.config.cacheTTL) {
          this.cache.delete(key);
          this.cacheTimestamps.delete(key);
          expiredCount++;
        }
      }
      
      // Se la cache è ancora troppo grande, rimuovi le entry più vecchie
      if (this.cache.size > this.config.cacheSize) {
        const entriesToRemove = this.cache.size - this.config.cacheSize;
        const sortedEntries = [...this.cacheTimestamps.entries()].sort((a, b) => a[1] - b[1]);
        
        for (let i = 0; i < entriesToRemove && i < sortedEntries.length; i++) {
          const key = sortedEntries[i][0];
          this.cache.delete(key);
          this.cacheTimestamps.delete(key);
          expiredCount++;
        }
      }
      
      if (expiredCount > 0) {
        console.log(`Cache GC: rimosse ${expiredCount} entry, dimensione attuale: ${this.cache.size}`);
      }
    }, 60000); // Esegui ogni minuto
  }
  
  /**
   * Calcola l'hit rate della cache
   * @returns {number} Hit rate in percentuale
   */
  _getCacheHitRate() {
    const hits = this.metrics.cacheHits || 0;
    const misses = this.metrics.cacheMisses || 0;
    const total = hits + misses;
    
    return total > 0 ? (hits / total) * 100 : 0;
  }
  
  /**
   * Deposita asset da Layer 1 a Layer 2
   * @param {Object} params - Parametri del deposito
   * @returns {Promise<string>} ID dell'operazione
   */
  async deposit(params) {
    if (!params || !params.amount || !params.sender || !params.recipient) {
      throw new Error('Parametri mancanti per il deposito');
    }
    
    // Validazione dei parametri
    if (typeof params.amount !== 'number' || params.amount <= 0) {
      throw new Error('Importo non valido');
    }
    
    try {
      // Genera un ID univoco per l'operazione
      const operationId = Buffer.from(
        Array.from(Array(16)).map(() => Math.floor(Math.random() * 256))
      ).toString('hex');
      
      // Determina il livello di priorità
      const priority = params.priority || 0;
      
      // Determina il livello di conferma in base all'importo
      let confirmationLevel = this.config.confirmationLevels;
      
      if (this.config.adaptiveConfirmations) {
        if (params.amount >= this.config.highValueThreshold) {
          confirmationLevel = this.config.maxConfirmationLevel;
        } else {
          // Scala il livello di conferma in base all'importo
          const ratio = Math.min(1, params.amount / this.config.highValueThreshold);
          confirmationLevel = Math.max(
            this.config.minConfirmationLevel,
            Math.floor(this.config.minConfirmationLevel + ratio * (this.config.maxConfirmationLevel - this.config.minConfirmationLevel))
          );
        }
      }
      
      // Crea l'oggetto deposito
      const deposit = {
        id: operationId,
        amount: params.amount,
        sender: params.sender,
        recipient: params.recipient,
        token: params.token || null, // null per SOL nativo
        timestamp: Date.now(),
        priority,
        confirmationLevel,
        status: 'pending'
      };
      
      // Aggiungi il deposito alla coda di priorità appropriata
      this.priorityQueues.deposits[priority].push(deposit);
      
      // Avvia l'elaborazione del batch se non è già in corso
      if (!this.processingBatch && this._shouldProcessBatch('deposits')) {
        this._processBatch('deposits');
      }
      
      // Se l'esecuzione ottimistica è abilitata, avvia immediatamente l'elaborazione
      if (this.config.optimisticExecution) {
        this._processOptimistically(deposit, 'deposit');
      }
      
      return operationId;
    } catch (error) {
      console.error('Errore durante il deposito:', error);
      throw error;
    }
  }
  
  /**
   * Preleva asset da Layer 2 a Layer 1
   * @param {Object} params - Parametri del prelievo
   * @returns {Promise<string>} ID dell'operazione
   */
  async withdraw(params) {
    if (!params || !params.amount || !params.sender || !params.recipient) {
      throw new Error('Parametri mancanti per il prelievo');
    }
    
    // Validazione dei parametri
    if (typeof params.amount !== 'number' || params.amount <= 0) {
      throw new Error('Importo non valido');
    }
    
    try {
      // Genera un ID univoco per l'operazione
      const operationId = Buffer.from(
        Array.from(Array(16)).map(() => Math.floor(Math.random() * 256))
      ).toString('hex');
      
      // Determina il livello di priorità
      const priority = params.priority || 0;
      
      // Verifica la prova di Merkle
      if (params.merkleProof) {
        const isValid = await this._verifyMerkleProof(params.merkleProof, params.sender, params.amount);
        if (!isValid) {
          throw new Error('Prova di Merkle non valida');
        }
      }
      
      // Crea l'oggetto prelievo
      const withdrawal = {
        id: operationId,
        amount: params.amount,
        sender: params.sender,
        recipient: params.recipient,
        token: params.token || null, // null per SOL nativo
        merkleProof: params.merkleProof,
        timestamp: Date.now(),
        priority,
        status: 'pending'
      };
      
      // Aggiungi il prelievo alla coda di priorità appropriata
      this.priorityQueues.withdrawals[priority].push(withdrawal);
      
      // Avvia l'elaborazione del batch se non è già in corso
      if (!this.processingBatch && this._shouldProcessBatch('withdrawals')) {
        this._processBatch('withdrawals');
      }
      
      // Se l'esecuzione ottimistica è abilitata, avvia immediatamente l'elaborazione
      if (this.config.optimisticExecution) {
        this._processOptimistically(withdrawal, 'withdraw');
      }
      
      return operationId;
    } catch (error) {
      console.error('Errore durante il prelievo:', error);
      throw error;
    }
  }
  
  /**
   * Verifica una prova di Merkle
   * @param {Array} proof - Prova di Merkle
   * @param {string} sender - Indirizzo del mittente
   * @param {number} amount - Importo
   * @returns {Promise<boolean>} True se la prova è valida
   */
  async _verifyMerkleProof(proof, sender, amount) {
    try {
      // Verifica se la prova è nella cache
      const cacheKey = `proof_${sender}_${amount}_${proof.join('')}`;
      
      if (this.config.cachingEnabled && this.cache.has(cacheKey)) {
        this.metrics.cacheHits = (this.metrics.cacheHits || 0) + 1;
        return this.cache.get(cacheKey);
      }
      
      this.metrics.cacheMisses = (this.metrics.cacheMisses || 0) + 1;
      
      // Calcola l'hash della foglia
      const leaf = sha256(JSON.stringify({ sender, amount })).toString();
      
      // Verifica la prova
      let currentHash = leaf;
      
      for (const proofElement of proof) {
        if (currentHash < proofElement) {
          currentHash = sha256(currentHash + proofElement).toString();
        } else {
          currentHash = sha256(proofElement + currentHash).toString();
        }
      }
      
      // Ottieni la radice dell'albero di Merkle dal programma on-chain
      // Questa è una versione semplificata, l'implementazione reale
      // dovrebbe ottenere la radice dal programma Layer 2
      const merkleRoot = await this._getMerkleRoot();
      
      // Verifica se l'hash calcolato corrisponde alla radice
      const isValid = currentHash === merkleRoot;
      
      // Memorizza il risultato nella cache
      if (this.config.cachingEnabled) {
        this.cache.set(cacheKey, isValid);
        this.cacheTimestamps.set(cacheKey, Date.now());
      }
      
      return isValid;
    } catch (error) {
      console.error('Errore durante la verifica della prova di Merkle:', error);
      return false;
    }
  }
  
  /**
   * Ottiene la radice dell'albero di Merkle dal programma on-chain
   * @returns {Promise<string>} Radice dell'albero di Merkle
   */
  async _getMerkleRoot() {
    // Questa è una versione semplificata, l'implementazione reale
    // dovrebbe ottenere la radice dal programma Layer 2
    return 'merkleRootHashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  }
  
  /**
   * Determina se è il momento di elaborare un batch
   * @param {string} type - Tipo di operazione ('deposits' o 'withdrawals')
   * @returns {boolean} True se è il momento di elaborare un batch
   */
  _shouldProcessBatch(type) {
    // Controlla se ci sono abbastanza operazioni per un batch completo
    const totalPending = this.priorityQueues[type].reduce((sum, queue) => sum + queue.length, 0);
    
    if (totalPending >= this.config.batchSize) {
      return true;
    }
    
    // Controlla se ci sono operazioni ad alta priorità in attesa
    if (this.priorityQueues[type][this.config.priorityLevels - 1].length > 0) {
      return true;
    }
    
    // Controlla se ci sono operazioni in attesa da troppo tempo
    const oldestTime = this._getOldestOperationTime(type);
    if (oldestTime && (Date.now() - oldestTime > 10000)) { // 10 secondi
      return true;
    }
    
    return false;
  }
  
  /**
   * Ottiene il timestamp dell'operazione più vecchia in coda
   * @param {string} type - Tipo di operazione ('deposits' o 'withdrawals')
   * @returns {number|null} Timestamp dell'operazione più vecchia o null se non ci sono operazioni
   */
  _getOldestOperationTime(type) {
    let oldestTime = null;
    
    for (const queue of this.priorityQueues[type]) {
      if (queue.length > 0) {
        const queueOldest = Math.min(...queue.map(op => op.timestamp));
        if (oldestTime === null || queueOldest < oldestTime) {
          oldestTime = queueOldest;
        }
      }
    }
    
    return oldestTime;
  }
  
  /**
   * Ottimizza un batch di transazioni per ridurre il gas
   * @param {Array} transactions - Transazioni da ottimizzare
   * @returns {Array} Transazioni ottimizzate per il gas
   */
  _optimizeBatchForGas(transactions) {
    transactions.sort((a, b) => {
      const aEfficiency = a.amount / (a.estimatedGas || 100000);
      const bEfficiency = b.amount / (b.estimatedGas || 100000);
      return bEfficiency - aEfficiency; // Higher efficiency first
    });
    
    const grouped = this._groupSimilarTransactions(transactions);
    
    return this._reorderForGasOptimization(grouped);
  }
  
  /**
   * Raggruppa transazioni simili per ottimizzare l'accesso allo storage
   * @param {Array} transactions - Transazioni da raggruppare
   * @returns {Array} Array di gruppi di transazioni
   */
  _groupSimilarTransactions(transactions) {
    const groups = {};
    
    transactions.forEach(tx => {
      const key = `${tx.token || 'native'}-${tx.recipient || 'unknown'}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(tx);
    });
    
    return Object.values(groups);
  }
  
  /**
   * Riordina le transazioni all'interno dei gruppi per ottimizzare il gas
   * @param {Array} groupedTransactions - Gruppi di transazioni
   * @returns {Array} Transazioni riordinate
   */
  _reorderForGasOptimization(groupedTransactions) {
    const result = [];
    
    groupedTransactions.forEach(group => {
      group.sort((a, b) => {
        if (a.amount === 0 && b.amount > 0) return -1;
        if (b.amount === 0 && a.amount > 0) return 1;
        return 0;
      });
      
      result.push(...group);
    });
    
    return result;
  }

  /**
   * Elabora un batch di operazioni
   * @param {string} type - Tipo di operazione ('deposits' o 'withdrawals')
   */
  async _processBatch(type) {
    if (this.processingBatch) {
      return;
    }
    
    this.processingBatch = true;
    const batchStartTime = Date.now();
    
    try {
      // Seleziona le operazioni per il batch corrente
      let batch = this._selectOperationsForBatch(type);
      
      if (batch.length === 0) {
        this.processingBatch = false;
        return;
      }
      
      if (type === 'withdrawals' && this.config.gasOptimizationEnabled) {
        batch = this._optimizeBatchForGas(batch);
      }
      
      console.log(`Elaborazione batch di ${batch.length} ${type}`);
      
      // Elabora il batch in parallelo
      const results = await this._processOperationsInParallel(batch, type);
      
      // Aggiorna le metriche
      const processingTime = Date.now() - batchStartTime;
      
      if (type === 'deposits') {
        this.metrics.totalDeposits += results.successful.length;
        this.metrics.processingTimes.deposits.push(processingTime);
      } else {
        this.metrics.totalWithdrawals += results.successful.length;
        this.metrics.processingTimes.withdrawals.push(processingTime);
      }
      
      console.log(`Batch di ${type} elaborato in ${processingTime}ms, ${results.successful.length} operazioni riuscite, ${results.failed.length} fallite`);
    } catch (error) {
      console.error(`Errore durante l'elaborazione del batch di ${type}:`, error);
    } finally {
      this.processingBatch = false;
      
      // Verifica se ci sono ancora operazioni da elaborare
      if (this._shouldProcessBatch(type)) {
        setImmediate(() => this._processBatch(type));
      }
    }
  }
  
  /**
   * Seleziona le operazioni per il batch corrente
   * @param {string} type - Tipo di operazione ('deposits' o 'withdrawals')
   * @returns {Array} Operazioni selezionate per il batch
   */
  _selectOperationsForBatch(type) {
    const selectedOperations = [];
    let remainingSlots = this.config.batchSize;
    
    // Seleziona prima le operazioni ad alta priorità
    for (let p = this.config.priorityLevels - 1; p >= 0; p--) {
      const queue = this.priorityQueues[type][p];
      
      // Ordina la coda per timestamp (le più vecchie prima)
      queue.sort((a, b) => a.timestamp - b.timestamp);
      
      // Seleziona le operazioni fino a riempire il batch
      while (queue.length > 0 && remainingSlots > 0) {
        selectedOperations.push(queue.shift());
        remainingSlots--;
      }
    }
    
    return selectedOperations;
  }
  
  /**
   * Elabora le operazioni in parallelo utilizzando i worker threads
   * @param {Array} operations - Operazioni da elaborare
   * @param {string} type - Tipo di operazione ('deposits' o 'withdrawals')
   * @returns {Promise<Object>} Risultati dell'elaborazione
   */
  async _processOperationsInParallel(operations, type) {
    // Suddividi le operazioni tra i worker
    const chunks = [];
    const chunkSize = Math.ceil(operations.length / this.workers.length);
    
    for (let i = 0; i < operations.length; i += chunkSize) {
      chunks.push(operations.slice(i, i + chunkSize));
    }
    
    const promises = chunks.map((chunk, index) => {
      return new Promise((resolve, reject) => {
        if (chunk.length === 0) {
          resolve({ successful: [], failed: [] });
          return;
        }
        
        const worker = this.workers[index % this.workers.length];
        
        // Handler per la risposta del worker
        const messageHandler = (message) => {
          if (message.type === 'operations_processed' && message.operationType === type) {
            worker.removeListener('message', messageHandler);
            resolve(message.result);
          }
        };
        
        worker.on('message', messageHandler);
        
        // Invia le operazioni al worker
        worker.postMessage({
          type: 'process_operations',
          operations: chunk,
          operationType: type
        });
        
        // Timeout di sicurezza
        setTimeout(() => {
          worker.removeListener('message', messageHandler);
          reject(new Error(`Timeout durante l'elaborazione delle operazioni`));
        }, 30000);
      });
    });
    
    const results = await Promise.all(promises);
    
    // Combina i risultati
    return results.reduce((combined, result) => {
      combined.successful.push(...result.successful);
      combined.failed.push(...result.failed);
      return combined;
    }, { successful: [], failed: [] });
  }
  
  /**
   * Elabora un'operazione in modo ottimistico
   * @param {Object} operation - Operazione da elaborare
   * @param {string} type - Tipo di operazione ('deposit' o 'withdraw')
   */
  async _processOptimistically(operation, type) {
    try {
      console.log(`Elaborazione ottimistica di ${type} con ID ${operation.id}`);
      
      // Simula l'elaborazione ottimistica
      // In un'implementazione reale, questo dovrebbe avviare l'elaborazione
      // senza attendere la conferma on-chain
      
      // Aggiorna lo stato dell'operazione
      operation.status = 'processing_optimistic';
      
      // Prefetching dei dati necessari
      if (this.config.prefetchingEnabled) {
        if (type === 'withdraw') {
          // Prefetch della prova di Merkle
          this._prefetchMerkleProof(operation.sender, operation.amount);
        }
      }
      
      console.log(`Elaborazione ottimistica completata per ${type} con ID ${operation.id}`);
    } catch (error) {
      console.error(`Errore durante l'elaborazione ottimistica di ${type}:`, error);
    }
  }
  
  /**
   * Prefetch di una prova di Merkle
   * @param {string} sender - Indirizzo del mittente
   * @param {number} amount - Importo
   */
  async _prefetchMerkleProof(sender, amount) {
    try {
      // Questa è una versione semplificata, l'implementazione reale
      // dovrebbe ottenere la prova dal programma Layer 2
      const proof = ['proofElement1', 'proofElement2', 'proofElement3'];
      
      // Memorizza la prova nella cache
      if (this.config.cachingEnabled) {
        const cacheKey = `proof_${sender}_${amount}`;
        this.cache.set(cacheKey, proof);
        this.cacheTimestamps.set(cacheKey, Date.now());
      }
    } catch (error) {
      console.error('Errore durante il prefetch della prova di Merkle:', error);
    }
  }
  
  /**
   * Ottiene lo stato di un'operazione
   * @param {string} operationId - ID dell'operazione
   * @returns {Promise<Object>} Stato dell'operazione
   */
  async getOperationStatus(operationId) {
    // Cerca nelle code di depositi
    for (const queue of this.priorityQueues.deposits) {
      const operation = queue.find(op => op.id === operationId);
      if (operation) {
        return {
          id: operation.id,
          type: 'deposit',
          status: operation.status,
          amount: operation.amount,
          sender: operation.sender,
          recipient: operation.recipient,
          timestamp: operation.timestamp
        };
      }
    }
    
    // Cerca nelle code di prelievi
    for (const queue of this.priorityQueues.withdrawals) {
      const operation = queue.find(op => op.id === operationId);
      if (operation) {
        return {
          id: operation.id,
          type: 'withdrawal',
          status: operation.status,
          amount: operation.amount,
          sender: operation.sender,
          recipient: operation.recipient,
          timestamp: operation.timestamp
        };
      }
    }
    
    // Cerca nelle operazioni completate (simulato)
    // In un'implementazione reale, questo dovrebbe cercare nel database
    return {
      id: operationId,
      status: 'unknown',
      message: 'Operazione non trovata'
    };
  }
  
  /**
   * Ottiene lo stato attuale del bridge
   * @returns {Object} Stato del bridge
   */
  getStatus() {
    const totalPendingDeposits = this.priorityQueues.deposits.reduce((sum, queue) => sum + queue.length, 0);
    const totalPendingWithdrawals = this.priorityQueues.withdrawals.reduce((sum, queue) => sum + queue.length, 0);
    
    return {
      pendingDeposits: totalPendingDeposits,
      pendingWithdrawals: totalPendingWithdrawals,
      processingBatch: this.processingBatch,
      metrics: {
        totalDeposits: this.metrics.totalDeposits,
        totalWithdrawals: this.metrics.totalWithdrawals,
        averageDepositTime: this.metrics.averageDepositTime,
        averageWithdrawalTime: this.metrics.averageWithdrawalTime,
        cacheHitRate: this._getCacheHitRate()
      },
      config: {
        batchSize: this.config.batchSize,
        maxParallelism: this.config.maxParallelism,
        confirmationLevels: this.config.confirmationLevels,
        adaptiveConfirmations: this.config.adaptiveConfirmations
      }
    };
  }
  
  /**
   * Chiude il bridge e tutti i worker threads
   */
  async close() {
    console.log('Chiusura del bridge...');
    
    // Termina tutti i worker threads
    for (const worker of this.workers) {
      worker.terminate();
    }
    
    console.log('Bridge chiuso');
  }
}

module.exports = {
  UltraOptimizedBridge,
  BridgeConfig
};
