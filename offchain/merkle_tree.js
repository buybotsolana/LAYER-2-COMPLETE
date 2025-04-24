/**
 * Implementazione ottimizzata dell'albero di Merkle per il Layer-2 su Solana
 * 
 * Questo modulo implementa un albero di Merkle ad alte prestazioni con:
 * - Caching degli stati intermedi
 * - Operazioni batch per aggiornamenti multipli
 * - Verifica parallela delle prove
 * - Supporto per worker threads
 */

const crypto = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const { EventEmitter } = require('events');

// Numero di worker threads da utilizzare per la verifica parallela
const DEFAULT_WORKER_COUNT = Math.max(1, Math.min(4, os.cpus().length - 1));

/**
 * Classe per l'albero di Merkle ottimizzato
 */
class MerkleTree extends EventEmitter {
  /**
   * Costruttore
   * @param {Array<Buffer>} leaves - Foglie dell'albero
   * @param {Object} options - Opzioni di configurazione
   */
  constructor(leaves, options = {}) {
    super();
    
    // Configurazione
    this.options = {
      workerCount: options.workerCount || DEFAULT_WORKER_COUNT,
      enableParallelVerification: options.enableParallelVerification !== false,
      enableCaching: options.enableCaching !== false,
      cacheSize: options.cacheSize || 10000,
      batchSize: options.batchSize || 1000,
      hashAlgorithm: options.hashAlgorithm || 'sha256',
      enableMetrics: options.enableMetrics !== false,
      metricsInterval: options.metricsInterval || 10000, // 10 secondi
    };
    
    // Verifica che le foglie siano valide
    if (!Array.isArray(leaves) || leaves.length === 0) {
      throw new Error('Le foglie devono essere un array non vuoto');
    }
    
    // Verifica che tutte le foglie siano buffer
    for (const leaf of leaves) {
      if (!Buffer.isBuffer(leaf)) {
        throw new Error('Tutte le foglie devono essere buffer');
      }
    }
    
    // Stato interno
    this.leaves = leaves;
    this.layers = [];
    this.nodeCache = new Map(); // Cache per i nodi intermedi
    this.proofCache = new Map(); // Cache per le prove
    this.workers = []; // Worker threads per la verifica parallela
    this.pendingBatch = []; // Batch di aggiornamenti in attesa
    this.batchUpdateTimer = null;
    this.isProcessingBatch = false;
    
    // Metriche
    this.metrics = {
      buildTime: 0,
      verificationTime: 0,
      proofGenerationTime: 0,
      cacheHits: 0,
      cacheMisses: 0,
      parallelVerifications: 0,
      sequentialVerifications: 0,
      batchUpdates: 0,
      totalUpdates: 0,
      lastReportTime: Date.now()
    };
    
    // Inizializzazione
    this._initialize();
  }
  
  /**
   * Inizializza l'albero di Merkle
   * @private
   */
  _initialize() {
    // Costruisce l'albero
    const startTime = Date.now();
    this.layers = this._buildTree(this.leaves);
    this.metrics.buildTime = Date.now() - startTime;
    
    // Inizializza i worker se la verifica parallela è abilitata
    if (this.options.enableParallelVerification) {
      this._initializeWorkers();
    }
    
    // Avvia il monitoraggio delle metriche se abilitato
    if (this.options.enableMetrics) {
      this._startMetricsMonitoring();
    }
    
    console.log(`MerkleTree inizializzato con ${this.leaves.length} foglie e ${this.options.workerCount} worker`);
  }
  
  /**
   * Inizializza i worker threads per la verifica parallela
   * @private
   */
  _initializeWorkers() {
    for (let i = 0; i < this.options.workerCount; i++) {
      const worker = new Worker(`${__dirname}/merkle-tree-worker.js`, {
        workerData: {
          workerId: i,
          hashAlgorithm: this.options.hashAlgorithm
        }
      });
      
      worker.on('message', (message) => {
        if (message.type === 'verification_result') {
          this._handleVerificationResult(message.id, message.result);
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
   * Crea un worker thread
   * @param {number} id - ID del worker
   * @returns {Worker} Worker thread
   * @private
   */
  _createWorker(id) {
    const worker = new Worker(`${__dirname}/merkle-tree-worker.js`, {
      workerData: {
        workerId: id,
        hashAlgorithm: this.options.hashAlgorithm
      }
    });
    
    worker.on('message', (message) => {
      if (message.type === 'verification_result') {
        this._handleVerificationResult(message.id, message.result);
      } else if (message.type === 'error') {
        console.error(`Worker ${id} error:`, message.error);
      }
    });
    
    worker.on('error', (err) => {
      console.error(`Worker ${id} error:`, err);
      // Ricrea il worker in caso di errore
      setTimeout(() => {
        this.workers[id] = this._createWorker(id);
      }, 1000);
    });
    
    return worker;
  }
  
  /**
   * Gestisce il risultato della verifica parallela
   * @param {string} id - ID della verifica
   * @param {boolean} result - Risultato della verifica
   * @private
   */
  _handleVerificationResult(id, result) {
    // Recupera la callback dalla mappa delle verifiche in corso
    if (this.pendingVerifications && this.pendingVerifications.has(id)) {
      const { resolve } = this.pendingVerifications.get(id);
      this.pendingVerifications.delete(id);
      resolve(result);
    }
  }
  
  /**
   * Avvia il monitoraggio delle metriche
   * @private
   */
  _startMetricsMonitoring() {
    setInterval(() => {
      const now = Date.now();
      const elapsed = (now - this.metrics.lastReportTime) / 1000;
      
      if (elapsed > 0) {
        // Calcola le operazioni al secondo
        const updatesPerSecond = this.metrics.totalUpdates / elapsed;
        const verificationsPerSecond = (this.metrics.parallelVerifications + this.metrics.sequentialVerifications) / elapsed;
        
        // Calcola l'hit rate della cache
        const totalCacheOps = this.metrics.cacheHits + this.metrics.cacheMisses;
        const cacheHitRate = totalCacheOps > 0 ? (this.metrics.cacheHits / totalCacheOps) * 100 : 0;
        
        console.log(`MerkleTree metrics - Updates/sec: ${updatesPerSecond.toFixed(2)}, Verifications/sec: ${verificationsPerSecond.toFixed(2)}`);
        console.log(`Cache hit rate: ${cacheHitRate.toFixed(2)}%, Batch updates: ${this.metrics.batchUpdates}`);
        console.log(`Parallel verifications: ${this.metrics.parallelVerifications}, Sequential verifications: ${this.metrics.sequentialVerifications}`);
        
        // Emetti evento con le metriche
        this.emit('metrics', {
          timestamp: now,
          updatesPerSecond,
          verificationsPerSecond,
          cacheHitRate,
          batchUpdates: this.metrics.batchUpdates,
          parallelVerifications: this.metrics.parallelVerifications,
          sequentialVerifications: this.metrics.sequentialVerifications,
          buildTime: this.metrics.buildTime,
          verificationTime: this.metrics.verificationTime,
          proofGenerationTime: this.metrics.proofGenerationTime
        });
        
        // Resetta i contatori
        this.metrics.totalUpdates = 0;
        this.metrics.parallelVerifications = 0;
        this.metrics.sequentialVerifications = 0;
        this.metrics.batchUpdates = 0;
        this.metrics.cacheHits = 0;
        this.metrics.cacheMisses = 0;
        this.metrics.lastReportTime = now;
      }
    }, this.options.metricsInterval);
  }
  
  /**
   * Costruisce l'albero di Merkle
   * @param {Array<Buffer>} leaves - Foglie dell'albero
   * @returns {Array<Array<Buffer>>} Livelli dell'albero
   * @private
   */
  _buildTree(leaves) {
    // Inizializza i livelli con le foglie
    const layers = [leaves];
    
    // Costruisce i livelli successivi
    let currentLayer = leaves;
    
    while (currentLayer.length > 1) {
      const nextLayer = [];
      
      // Combina le coppie di nodi
      for (let i = 0; i < currentLayer.length; i += 2) {
        if (i + 1 < currentLayer.length) {
          // Combina due nodi
          const left = currentLayer[i];
          const right = currentLayer[i + 1];
          const parent = this._hashPair(left, right);
          
          // Memorizza nella cache
          if (this.options.enableCaching) {
            const cacheKey = this._getCacheKey(left, right);
            this.nodeCache.set(cacheKey, parent);
          }
          
          nextLayer.push(parent);
        } else {
          // Nodo singolo, lo duplica
          nextLayer.push(currentLayer[i]);
        }
      }
      
      // Aggiunge il nuovo livello
      layers.push(nextLayer);
      currentLayer = nextLayer;
    }
    
    return layers;
  }
  
  /**
   * Calcola l'hash di una coppia di nodi
   * @param {Buffer} left - Nodo sinistro
   * @param {Buffer} right - Nodo destro
   * @returns {Buffer} Hash della coppia
   * @private
   */
  _hashPair(left, right) {
    // Verifica se il risultato è già in cache
    if (this.options.enableCaching) {
      const cacheKey = this._getCacheKey(left, right);
      if (this.nodeCache.has(cacheKey)) {
        this.metrics.cacheHits++;
        return this.nodeCache.get(cacheKey);
      }
      this.metrics.cacheMisses++;
    }
    
    // Ordina i nodi per garantire la coerenza
    const pair = Buffer.concat(
      Buffer.compare(left, right) <= 0 ? [left, right] : [right, left]
    );
    
    // Calcola l'hash
    return crypto.createHash(this.options.hashAlgorithm).update(pair).digest();
  }
  
  /**
   * Genera una chiave di cache per una coppia di nodi
   * @param {Buffer} left - Nodo sinistro
   * @param {Buffer} right - Nodo destro
   * @returns {string} Chiave di cache
   * @private
   */
  _getCacheKey(left, right) {
    // Ordina i nodi per garantire la coerenza
    const ordered = Buffer.compare(left, right) <= 0 ? [left, right] : [right, left];
    return ordered[0].toString('hex') + '_' + ordered[1].toString('hex');
  }
  
  /**
   * Ottiene la radice dell'albero
   * @returns {Buffer} Radice dell'albero
   */
  getRoot() {
    return this.layers[this.layers.length - 1][0];
  }
  
  /**
   * Ottiene la prova di inclusione per una foglia
   * @param {number} index - Indice della foglia
   * @returns {Array<Object>} Prova di inclusione
   */
  getProof(index) {
    const startTime = Date.now();
    
    // Verifica se la prova è già in cache
    if (this.options.enableCaching && this.proofCache.has(index)) {
      this.metrics.cacheHits++;
      return this.proofCache.get(index);
    }
    this.metrics.cacheMisses++;
    
    if (index < 0 || index >= this.leaves.length) {
      throw new Error('Indice fuori dai limiti');
    }
    
    const proof = [];
    let currentIndex = index;
    
    // Attraversa i livelli dell'albero
    for (let i = 0; i < this.layers.length - 1; i++) {
      const layer = this.layers[i];
      const isRightNode = currentIndex % 2 === 0;
      const siblingIndex = isRightNode ? currentIndex + 1 : currentIndex - 1;
      
      // Verifica che l'indice del fratello sia valido
      if (siblingIndex < layer.length) {
        proof.push({
          data: layer[siblingIndex],
          position: isRightNode ? 'right' : 'left',
        });
      }
      
      // Calcola l'indice per il livello successivo
      currentIndex = Math.floor(currentIndex / 2);
    }
    
    // Memorizza la prova nella cache
    if (this.options.enableCaching) {
      // Limita la dimensione della cache
      if (this.proofCache.size >= this.options.cacheSize) {
        // Rimuovi la prima chiave (FIFO)
        const firstKey = this.proofCache.keys().next().value;
        this.proofCache.delete(firstKey);
      }
      
      this.proofCache.set(index, proof);
    }
    
    this.metrics.proofGenerationTime = Date.now() - startTime;
    
    return proof;
  }
  
  /**
   * Verifica una prova di inclusione
   * @param {Buffer} leaf - Foglia da verificare
   * @param {Array<Object>} proof - Prova di inclusione
   * @param {Buffer} root - Radice dell'albero
   * @returns {Promise<boolean>} True se la prova è valida
   */
  async verify(leaf, proof, root) {
    const startTime = Date.now();
    
    // Usa la verifica parallela se abilitata e ci sono worker disponibili
    if (this.options.enableParallelVerification && this.workers.length > 0) {
      const result = await this._verifyParallel(leaf, proof, root);
      this.metrics.verificationTime = Date.now() - startTime;
      this.metrics.parallelVerifications++;
      return result;
    } else {
      // Verifica sequenziale
      const result = MerkleTree._verifySequential(leaf, proof, root, this.options.hashAlgorithm);
      this.metrics.verificationTime = Date.now() - startTime;
      this.metrics.sequentialVerifications++;
      return result;
    }
  }
  
  /**
   * Verifica una prova di inclusione in parallelo
   * @param {Buffer} leaf - Foglia da verificare
   * @param {Array<Object>} proof - Prova di inclusione
   * @param {Buffer} root - Radice dell'albero
   * @returns {Promise<boolean>} True se la prova è valida
   * @private
   */
  async _verifyParallel(leaf, proof, root) {
    return new Promise((resolve) => {
      // Genera un ID univoco per questa verifica
      const verificationId = Date.now() + '_' + Math.random().toString(36).substring(2, 15);
      
      // Inizializza la mappa delle verifiche in corso se non esiste
      if (!this.pendingVerifications) {
        this.pendingVerifications = new Map();
      }
      
      // Memorizza la callback nella mappa
      this.pendingVerifications.set(verificationId, { resolve });
      
      // Seleziona un worker in modo round-robin
      const workerIndex = this.metrics.parallelVerifications % this.workers.length;
      const worker = this.workers[workerIndex];
      
      // Invia la richiesta di verifica al worker
      worker.postMessage({
        type: 'verify',
        id: verificationId,
        leaf: leaf,
        proof: proof,
        root: root
      });
    });
  }
  
  /**
   * Verifica una prova di inclusione in modo sequenziale
   * @param {Buffer} leaf - Foglia da verificare
   * @param {Array<Object>} proof - Prova di inclusione
   * @param {Buffer} root - Radice dell'albero
   * @param {string} hashAlgorithm - Algoritmo di hash da utilizzare
   * @returns {boolean} True se la prova è valida
   * @private
   */
  static _verifySequential(leaf, proof, root, hashAlgorithm = 'sha256') {
    let currentHash = leaf;
    
    // Applica la prova
    for (const { data, position } of proof) {
      if (position === 'left') {
        currentHash = MerkleTree._hashPairStatic(data, currentHash, hashAlgorithm);
      } else {
        currentHash = MerkleTree._hashPairStatic(currentHash, data, hashAlgorithm);
      }
    }
    
    // Verifica che l'hash finale sia uguale alla radice
    return Buffer.compare(currentHash, root) === 0;
  }
  
  /**
   * Calcola l'hash di una coppia di nodi (metodo statico)
   * @param {Buffer} left - Nodo sinistro
   * @param {Buffer} right - Nodo destro
   * @param {string} hashAlgorithm - Algoritmo di hash da utilizzare
   * @returns {Buffer} Hash della coppia
   * @private
   */
  static _hashPairStatic(left, right, hashAlgorithm = 'sha256') {
    // Ordina i nodi per garantire la coerenza
    const pair = Buffer.concat(
      Buffer.compare(left, right) <= 0 ? [left, right] : [right, left]
    );
    
    // Calcola l'hash
    return crypto.createHash(hashAlgorithm).update(pair).digest();
  }
  
  /**
   * Aggiorna una foglia dell'albero
   * @param {number} index - Indice della foglia
   * @param {Buffer} newValue - Nuovo valore della foglia
   * @param {boolean} batch - Se true, l'aggiornamento viene aggiunto a un batch
   * @returns {Promise<Buffer>} Nuova radice dell'albero
   */
  async updateLeaf(index, newValue, batch = false) {
    if (index < 0 || index >= this.leaves.length) {
      throw new Error('Indice fuori dai limiti');
    }
    
    if (!Buffer.isBuffer(newValue)) {
      throw new Error('Il nuovo valore deve essere un buffer');
    }
    
    // Aggiorna le metriche
    this.metrics.totalUpdates++;
    
    // Se l'aggiornamento è in batch, aggiungi al batch corrente
    if (batch) {
      this.pendingBatch.push({ index, newValue });
      
      // Se il batch ha raggiunto la dimensione massima, esegui l'aggiornamento
      if (this.pendingBatch.length >= this.options.batchSize) {
        return this._processBatch();
      }
      
      // Altrimenti, avvia un timer per l'aggiornamento batch se non è già attivo
      if (!this.batchUpdateTimer && !this.isProcessingBatch) {
        this.batchUpdateTimer = setTimeout(() => {
          this.batchUpdateTimer = null;
          this._processBatch();
        }, 100); // Attendi 100ms per raccogliere più aggiornamenti
      }
      
      // Restituisci la radice corrente (sarà aggiornata in seguito)
      return this.getRoot();
    }
    
    // Aggiornamento immediato (non in batch)
    return this._updateLeafImmediate(index, newValue);
  }
  
  /**
   * Aggiorna immediatamente una foglia dell'albero
   * @param {number} index - Indice della foglia
   * @param {Buffer} newValue - Nuovo valore della foglia
   * @returns {Buffer} Nuova radice dell'albero
   * @private
   */
  _updateLeafImmediate(index, newValue) {
    // Aggiorna la foglia
    this.leaves[index] = newValue;
    
    // Invalida le cache per questo indice
    if (this.options.enableCaching) {
      this.proofCache.delete(index);
    }
    
    // Ricalcola il percorso dalla foglia alla radice
    let currentIndex = index;
    let currentLayer = 0;
    
    // Attraversa i livelli dell'albero
    while (currentLayer < this.layers.length - 1) {
      const layer = this.layers[currentLayer];
      const isRightNode = currentIndex % 2 === 0;
      const siblingIndex = isRightNode ? currentIndex + 1 : currentIndex - 1;
      const parentIndex = Math.floor(currentIndex / 2);
      
      // Calcola il nuovo hash del nodo padre
      let newHash;
      if (siblingIndex < layer.length) {
        const left = isRightNode ? layer[currentIndex] : layer[siblingIndex];
        const right = isRightNode ? layer[siblingIndex] : layer[currentIndex];
        newHash = this._hashPair(left, right);
      } else {
        // Nodo singolo
        newHash = layer[currentIndex];
      }
      
      // Aggiorna il nodo padre nel livello successivo
      this.layers[currentLayer + 1][parentIndex] = newHash;
      
      // Passa al livello successivo
      currentLayer++;
      currentIndex = parentIndex;
    }
    
    // Restituisci la nuova radice
    return this.getRoot();
  }
  
  /**
   * Processa il batch di aggiornamenti
   * @returns {Promise<Buffer>} Nuova radice dell'albero
   * @private
   */
  async _processBatch() {
    // Imposta il flag di elaborazione batch
    this.isProcessingBatch = true;
    
    // Copia e svuota il batch corrente
    const batch = [...this.pendingBatch];
    this.pendingBatch = [];
    
    // Aggiorna le metriche
    this.metrics.batchUpdates++;
    
    try {
      // Ordina il batch per indice per ottimizzare gli aggiornamenti
      batch.sort((a, b) => a.index - b.index);
      
      // Applica gli aggiornamenti
      for (const { index, newValue } of batch) {
        this.leaves[index] = newValue;
        
        // Invalida le cache per questo indice
        if (this.options.enableCaching) {
          this.proofCache.delete(index);
        }
      }
      
      // Ricostruisci l'albero
      this.layers = this._buildTree(this.leaves);
      
      // Emetti evento di aggiornamento batch completato
      this.emit('batch_update', {
        count: batch.length,
        root: this.getRoot()
      });
      
      return this.getRoot();
    } finally {
      // Resetta il flag di elaborazione batch
      this.isProcessingBatch = false;
      
      // Se ci sono altri aggiornamenti in attesa, processa il prossimo batch
      if (this.pendingBatch.length > 0) {
        setImmediate(() => this._processBatch());
      }
    }
  }
  
  /**
   * Forza l'elaborazione del batch corrente
   * @returns {Promise<Buffer>} Nuova radice dell'albero
   */
  async flushBatch() {
    // Se non ci sono aggiornamenti in attesa, restituisci la radice corrente
    if (this.pendingBatch.length === 0) {
      return this.getRoot();
    }
    
    // Cancella il timer di aggiornamento batch se attivo
    if (this.batchUpdateTimer) {
      clearTimeout(this.batchUpdateTimer);
      this.batchUpdateTimer = null;
    }
    
    // Processa il batch
    return this._processBatch();
  }
  
  /**
   * Verifica in batch multiple prove
   * @param {Array<Object>} verifications - Array di oggetti { leaf, proof, root }
   * @returns {Promise<Array<boolean>>} Array di risultati di verifica
   */
  async verifyBatch(verifications) {
    const startTime = Date.now();
    const results = [];
    
    // Se la verifica parallela è abilitata e ci sono worker disponibili
    if (this.options.enableParallelVerification && this.workers.length > 0) {
      // Distribuisci le verifiche tra i worker
      const promises = [];
      
      for (let i = 0; i < verifications.length; i++) {
        const { leaf, proof, root } = verifications[i];
        const workerIndex = i % this.workers.length;
        
        promises.push(this._verifyParallel(leaf, proof, root));
      }
      
      // Attendi tutti i risultati
      results.push(...(await Promise.all(promises)));
      
      // Aggiorna le metriche
      this.metrics.parallelVerifications += verifications.length;
    } else {
      // Verifica sequenziale
      for (const { leaf, proof, root } of verifications) {
        results.push(MerkleTree._verifySequential(leaf, proof, root, this.options.hashAlgorithm));
      }
      
      // Aggiorna le metriche
      this.metrics.sequentialVerifications += verifications.length;
    }
    
    this.metrics.verificationTime = Date.now() - startTime;
    
    return results;
  }
  
  /**
   * Chiude l'albero di Merkle e termina i worker
   */
  async close() {
    // Termina i worker
    for (const worker of this.workers) {
      worker.terminate();
    }
    
    this.workers = [];
    console.log('MerkleTree chiuso');
  }
}

module.exports = { MerkleTree };
