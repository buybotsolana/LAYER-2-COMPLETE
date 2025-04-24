/**
 * Implementazione dell'Albero di Merkle Ottimizzato per il Layer-2 su Solana
 * 
 * Questo modulo implementa un albero di Merkle altamente ottimizzato con supporto per
 * caching degli stati intermedi, operazioni batch e verifica parallela.
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { performance } = require('perf_hooks');
const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');
const { WorkerPool } = require('./worker-pool');
const { MultiLevelCache } = require('./multi-level-cache');
const { PerformanceMetrics } = require('./performance-metrics');

/**
 * Classe MerkleNode
 * 
 * Rappresenta un nodo nell'albero di Merkle
 */
class MerkleNode {
  /**
   * Costruttore
   * @param {Buffer} hash - Hash del nodo
   * @param {MerkleNode} left - Figlio sinistro
   * @param {MerkleNode} right - Figlio destro
   * @param {boolean} isLeaf - Indica se il nodo è una foglia
   */
  constructor(hash, left = null, right = null, isLeaf = false) {
    this.hash = hash;
    this.left = left;
    this.right = right;
    this.isLeaf = isLeaf;
    this.height = 0; // Altezza del nodo nell'albero
    this.size = 1; // Numero di nodi nel sottoalbero
    this.dirty = true; // Indica se il nodo è stato modificato
    this.cachedProof = null; // Proof pre-calcolato per questo nodo
  }

  /**
   * Clona il nodo
   * @returns {MerkleNode} - Copia del nodo
   */
  clone() {
    const node = new MerkleNode(Buffer.from(this.hash));
    node.left = this.left;
    node.right = this.right;
    node.isLeaf = this.isLeaf;
    node.height = this.height;
    node.size = this.size;
    node.dirty = this.dirty;
    return node;
  }

  /**
   * Verifica se il nodo è una foglia
   * @returns {boolean} - True se il nodo è una foglia
   */
  isLeafNode() {
    return this.isLeaf;
  }

  /**
   * Verifica se il nodo è un nodo interno
   * @returns {boolean} - True se il nodo è un nodo interno
   */
  isInternalNode() {
    return !this.isLeaf;
  }

  /**
   * Verifica se il nodo è la radice
   * @returns {boolean} - True se il nodo è la radice
   */
  isRoot() {
    return this.height === 0;
  }

  /**
   * Ottiene l'hash del nodo
   * @returns {Buffer} - Hash del nodo
   */
  getHash() {
    return this.hash;
  }

  /**
   * Imposta l'hash del nodo
   * @param {Buffer} hash - Nuovo hash
   */
  setHash(hash) {
    this.hash = hash;
    this.dirty = true;
    this.cachedProof = null;
  }

  /**
   * Ottiene il figlio sinistro
   * @returns {MerkleNode} - Figlio sinistro
   */
  getLeft() {
    return this.left;
  }

  /**
   * Imposta il figlio sinistro
   * @param {MerkleNode} node - Nuovo figlio sinistro
   */
  setLeft(node) {
    this.left = node;
    this.dirty = true;
    this.cachedProof = null;
  }

  /**
   * Ottiene il figlio destro
   * @returns {MerkleNode} - Figlio destro
   */
  getRight() {
    return this.right;
  }

  /**
   * Imposta il figlio destro
   * @param {MerkleNode} node - Nuovo figlio destro
   */
  setRight(node) {
    this.right = node;
    this.dirty = true;
    this.cachedProof = null;
  }

  /**
   * Ottiene l'altezza del nodo
   * @returns {number} - Altezza del nodo
   */
  getHeight() {
    return this.height;
  }

  /**
   * Imposta l'altezza del nodo
   * @param {number} height - Nuova altezza
   */
  setHeight(height) {
    this.height = height;
  }

  /**
   * Ottiene la dimensione del sottoalbero
   * @returns {number} - Dimensione del sottoalbero
   */
  getSize() {
    return this.size;
  }

  /**
   * Imposta la dimensione del sottoalbero
   * @param {number} size - Nuova dimensione
   */
  setSize(size) {
    this.size = size;
  }

  /**
   * Verifica se il nodo è stato modificato
   * @returns {boolean} - True se il nodo è stato modificato
   */
  isDirty() {
    return this.dirty;
  }

  /**
   * Imposta lo stato di modifica del nodo
   * @param {boolean} dirty - Nuovo stato di modifica
   */
  setDirty(dirty) {
    this.dirty = dirty;
  }

  /**
   * Ottiene la proof pre-calcolata
   * @returns {Array<Buffer>} - Proof pre-calcolata
   */
  getCachedProof() {
    return this.cachedProof;
  }

  /**
   * Imposta la proof pre-calcolata
   * @param {Array<Buffer>} proof - Nuova proof
   */
  setCachedProof(proof) {
    this.cachedProof = proof;
  }

  /**
   * Aggiorna la dimensione del sottoalbero
   */
  updateSize() {
    if (this.isLeaf) {
      this.size = 1;
    } else {
      this.size = (this.left ? this.left.size : 0) + (this.right ? this.right.size : 0);
    }
  }

  /**
   * Aggiorna l'altezza del nodo
   */
  updateHeight() {
    if (this.isLeaf) {
      this.height = 0;
    } else {
      const leftHeight = this.left ? this.left.height : -1;
      const rightHeight = this.right ? this.right.height : -1;
      this.height = Math.max(leftHeight, rightHeight) + 1;
    }
  }

  /**
   * Verifica se il nodo è bilanciato
   * @returns {boolean} - True se il nodo è bilanciato
   */
  isBalanced() {
    if (this.isLeaf) {
      return true;
    }

    const leftHeight = this.left ? this.left.height : -1;
    const rightHeight = this.right ? this.right.height : -1;

    return Math.abs(leftHeight - rightHeight) <= 1;
  }

  /**
   * Calcola il fattore di bilanciamento
   * @returns {number} - Fattore di bilanciamento
   */
  getBalanceFactor() {
    if (this.isLeaf) {
      return 0;
    }

    const leftHeight = this.left ? this.left.height : -1;
    const rightHeight = this.right ? this.right.height : -1;

    return leftHeight - rightHeight;
  }
}

/**
 * Classe MerkleTree
 * 
 * Implementa un albero di Merkle ottimizzato
 */
class MerkleTree extends EventEmitter {
  /**
   * Costruttore
   * @param {Array<Buffer>} leaves - Foglie iniziali
   * @param {Object} options - Opzioni di configurazione
   */
  constructor(leaves = [], options = {}) {
    super();
    
    this.options = {
      hashFunction: options.hashFunction || 'sha256',
      sortLeaves: options.sortLeaves !== false,
      sortPairs: options.sortPairs !== false,
      duplicateOdd: options.duplicateOdd !== false,
      concatenator: options.concatenator || this._defaultConcatenator,
      enableCaching: options.enableCaching !== false,
      cacheSize: options.cacheSize || 10000,
      cacheTTL: options.cacheTTL || 3600000, // 1 ora
      enableParallelVerification: options.enableParallelVerification !== false,
      workerCount: options.workerCount || Math.max(1, Math.min(os.cpus().length - 1, 4)),
      enableMetrics: options.enableMetrics !== false,
      metricsInterval: options.metricsInterval || 10000, // 10 secondi
      ...options
    };
    
    // Stato interno
    this.root = null;
    this.leaves = [];
    this.leafMap = new Map(); // Mappa chiave -> indice foglia
    this.nodeCache = new Map(); // Cache dei nodi
    this.proofCache = new Map(); // Cache delle proof
    this.dirtyNodes = new Set(); // Nodi modificati
    this.rebuildRequired = false; // Indica se è necessario ricostruire l'albero
    this.isBuilding = false; // Indica se l'albero è in fase di costruzione
    this.lastBuildTime = 0; // Timestamp dell'ultima costruzione
    
    // Worker pool per la verifica parallela
    this.workerPool = null;
    
    // Cache multi-livello
    this.cache = null;
    
    // Metriche
    this.metrics = new PerformanceMetrics('merkle_tree', {
      enableMetrics: this.options.enableMetrics,
      metricsInterval: this.options.metricsInterval
    });
    
    // Inizializza l'albero
    this._initialize(leaves);
  }
  
  /**
   * Inizializza l'albero
   * @param {Array<Buffer>} leaves - Foglie iniziali
   * @private
   */
  _initialize(leaves) {
    // Inizializza la cache
    if (this.options.enableCaching) {
      this.cache = new MultiLevelCache({
        namespacePrefix: 'merkle:',
        enableCompression: true,
        prefetching: {
          enabled: true
        }
      });
    }
    
    // Inizializza il worker pool
    if (this.options.enableParallelVerification) {
      this.workerPool = new WorkerPool({
        workerCount: this.options.workerCount,
        workerScript: path.join(__dirname, 'merkle-worker.js')
      });
    }
    
    // Aggiungi le foglie iniziali
    if (leaves && leaves.length > 0) {
      this.addLeaves(leaves);
      this.buildTree();
    }
  }
  
  /**
   * Concatenatore di default
   * @param {Buffer} left - Hash sinistro
   * @param {Buffer} right - Hash destro
   * @returns {Buffer} - Hash concatenato
   * @private
   */
  _defaultConcatenator(left, right) {
    return Buffer.concat([left, right]);
  }
  
  /**
   * Calcola l'hash di un buffer
   * @param {Buffer} data - Dati da hashare
   * @returns {Buffer} - Hash
   * @private
   */
  _hash(data) {
    return crypto.createHash(this.options.hashFunction).update(data).digest();
  }
  
  /**
   * Calcola l'hash di due nodi
   * @param {MerkleNode} left - Nodo sinistro
   * @param {MerkleNode} right - Nodo destro
   * @returns {Buffer} - Hash
   * @private
   */
  _hashPair(left, right) {
    // Se uno dei nodi è null, duplica l'altro
    if (!left) {
      return right.hash;
    }
    
    if (!right) {
      return left.hash;
    }
    
    // Ottieni gli hash
    const leftHash = left.hash;
    const rightHash = right.hash;
    
    // Ordina gli hash se richiesto
    let combinedHash;
    
    if (this.options.sortPairs) {
      const comparison = Buffer.compare(leftHash, rightHash);
      
      if (comparison <= 0) {
        combinedHash = this.options.concatenator(leftHash, rightHash);
      } else {
        combinedHash = this.options.concatenator(rightHash, leftHash);
      }
    } else {
      combinedHash = this.options.concatenator(leftHash, rightHash);
    }
    
    // Calcola l'hash
    return this._hash(combinedHash);
  }
  
  /**
   * Aggiunge una foglia all'albero
   * @param {Buffer} leaf - Foglia da aggiungere
   * @param {string} key - Chiave associata alla foglia
   * @returns {number} - Indice della foglia
   */
  addLeaf(leaf, key = null) {
    // Verifica che la foglia sia un Buffer
    if (!Buffer.isBuffer(leaf)) {
      throw new Error('La foglia deve essere un Buffer');
    }
    
    // Calcola l'hash della foglia
    const hash = this._hash(leaf);
    
    // Crea il nodo foglia
    const node = new MerkleNode(hash, null, null, true);
    
    // Aggiungi la foglia
    const index = this.leaves.length;
    this.leaves.push(node);
    
    // Memorizza la chiave se presente
    if (key !== null) {
      this.leafMap.set(key, index);
    }
    
    // Imposta il flag di ricostruzione
    this.rebuildRequired = true;
    
    return index;
  }
  
  /**
   * Aggiunge più foglie all'albero
   * @param {Array<Buffer>} leaves - Foglie da aggiungere
   * @param {Array<string>} keys - Chiavi associate alle foglie
   * @returns {Array<number>} - Indici delle foglie
   */
  addLeaves(leaves, keys = null) {
    if (!Array.isArray(leaves)) {
      throw new Error('Le foglie devono essere un array');
    }
    
    const indices = [];
    
    for (let i = 0; i < leaves.length; i++) {
      const key = keys ? keys[i] : null;
      const index = this.addLeaf(leaves[i], key);
      indices.push(index);
    }
    
    return indices;
  }
  
  /**
   * Aggiorna una foglia esistente
   * @param {number} index - Indice della foglia
   * @param {Buffer} leaf - Nuova foglia
   * @returns {boolean} - True se l'aggiornamento è riuscito
   */
  updateLeaf(index, leaf) {
    // Verifica che l'indice sia valido
    if (index < 0 || index >= this.leaves.length) {
      throw new Error('Indice foglia non valido');
    }
    
    // Verifica che la foglia sia un Buffer
    if (!Buffer.isBuffer(leaf)) {
      throw new Error('La foglia deve essere un Buffer');
    }
    
    // Calcola l'hash della foglia
    const hash = this._hash(leaf);
    
    // Aggiorna il nodo foglia
    const node = this.leaves[index];
    node.setHash(hash);
    
    // Aggiorna i nodi genitori
    this._updateParents(index);
    
    return true;
  }
  
  /**
   * Aggiorna una foglia esistente tramite chiave
   * @param {string} key - Chiave della foglia
   * @param {Buffer} leaf - Nuova foglia
   * @returns {boolean} - True se l'aggiornamento è riuscito
   */
  update(key, leaf) {
    // Verifica che la chiave esista
    if (!this.leafMap.has(key)) {
      throw new Error('Chiave non trovata');
    }
    
    // Ottieni l'indice della foglia
    const index = this.leafMap.get(key);
    
    // Aggiorna la foglia
    return this.updateLeaf(index, leaf);
  }
  
  /**
   * Aggiorna i nodi genitori di una foglia
   * @param {number} index - Indice della foglia
   * @private
   */
  _updateParents(index) {
    // Verifica che l'indice sia valido
    if (index < 0 || index >= this.leaves.length) {
      throw new Error('Indice foglia non valido');
    }
    
    // Verifica che l'albero sia costruito
    if (!this.root) {
      this.rebuildRequired = true;
      return;
    }
    
    // Calcola il percorso dalla foglia alla radice
    const path = this._getPathToRoot(index);
    
    // Aggiorna i nodi lungo il percorso
    for (let i = path.length - 2; i >= 0; i--) {
      const node = path[i];
      
      // Calcola il nuovo hash
      const leftHash = node.left ? node.left.hash : null;
      const rightHash = node.right ? node.right.hash : null;
      
      if (leftHash && rightHash) {
        const newHash = this._hashPair(node.left, node.right);
        node.setHash(newHash);
      }
      
      // Aggiungi il nodo alla lista dei nodi modificati
      this.dirtyNodes.add(node);
    }
    
    // Invalida le cache
    this._invalidateCaches();
  }
  
  /**
   * Ottiene il percorso dalla foglia alla radice
   * @param {number} index - Indice della foglia
   * @returns {Array<MerkleNode>} - Percorso
   * @private
   */
  _getPathToRoot(index) {
    // Verifica che l'indice sia valido
    if (index < 0 || index >= this.leaves.length) {
      throw new Error('Indice foglia non valido');
    }
    
    // Verifica che l'albero sia costruito
    if (!this.root) {
      throw new Error('Albero non costruito');
    }
    
    const path = [];
    let currentIndex = index;
    let currentNode = this.leaves[index];
    
    path.push(currentNode);
    
    // Risali l'albero fino alla radice
    while (currentNode !== this.root) {
      // Calcola l'indice del genitore
      const parentIndex = Math.floor(currentIndex / 2);
      
      // Ottieni il nodo genitore
      const parentNode = this._getNodeAtIndex(parentIndex, this.leaves.length);
      
      if (!parentNode) {
        break;
      }
      
      path.push(parentNode);
      
      // Aggiorna l'indice e il nodo corrente
      currentIndex = parentIndex;
      currentNode = parentNode;
    }
    
    return path;
  }
  
  /**
   * Ottiene il nodo all'indice specificato
   * @param {number} index - Indice del nodo
   * @param {number} leafCount - Numero di foglie
   * @returns {MerkleNode} - Nodo
   * @private
   */
  _getNodeAtIndex(index, leafCount) {
    // Verifica che l'indice sia valido
    if (index < 0) {
      return null;
    }
    
    // Se l'indice è una foglia, restituisci la foglia
    if (index < leafCount) {
      return this.leaves[index];
    }
    
    // Calcola l'indice nel livello corrente
    const levelIndex = index - leafCount;
    
    // Verifica che l'indice sia valido
    if (levelIndex >= this.nodeCache.size) {
      return null;
    }
    
    // Restituisci il nodo dalla cache
    return this.nodeCache.get(levelIndex);
  }
  
  /**
   * Invalida le cache
   * @private
   */
  _invalidateCaches() {
    // Invalida la cache delle proof
    this.proofCache.clear();
    
    // Invalida la cache multi-livello
    if (this.cache) {
      this.cache.invalidateAll();
    }
  }
  
  /**
   * Costruisce l'albero
   * @returns {boolean} - True se la costruzione è riuscita
   */
  buildTree() {
    // Verifica che ci siano foglie
    if (this.leaves.length === 0) {
      this.root = null;
      this.rebuildRequired = false;
      return false;
    }
    
    const startTime = performance.now();
    
    // Imposta il flag di costruzione
    this.isBuilding = true;
    
    try {
      // Ordina le foglie se richiesto
      if (this.options.sortLeaves) {
        this.leaves.sort((a, b) => Buffer.compare(a.hash, b.hash));
        
        // Aggiorna la mappa delle chiavi
        this.leafMap.clear();
        for (const [key, index] of this.leafMap.entries()) {
          const newIndex = this.leaves.findIndex(leaf => leaf.hash.equals(this.leaves[index].hash));
          if (newIndex !== -1) {
            this.leafMap.set(key, newIndex);
          }
        }
      }
      
      // Costruisci l'albero
      this.root = this._buildTreeFromLeaves(this.leaves);
      
      // Resetta i flag
      this.rebuildRequired = false;
      this.dirtyNodes.clear();
      
      // Aggiorna il timestamp
      this.lastBuildTime = Date.now();
      
      const endTime = performance.now();
      this.metrics.recordLatency('build_tree', endTime - startTime);
      
      // Emetti evento di costruzione completata
      this.emit('built', {
        root: this.root.hash.toString('hex'),
        leaves: this.leaves.length
      });
      
      return true;
    } catch (error) {
      console.error('Errore durante la costruzione dell\'albero:', error);
      
      const endTime = performance.now();
      this.metrics.recordLatency('build_tree_failed', endTime - startTime);
      this.metrics.incrementCounter('build_tree_failures');
      
      // Emetti evento di errore
      this.emit('error', {
        error,
        operation: 'buildTree'
      });
      
      return false;
    } finally {
      // Resetta il flag di costruzione
      this.isBuilding = false;
    }
  }
  
  /**
   * Costruisce l'albero dalle foglie
   * @param {Array<MerkleNode>} leaves - Foglie
   * @returns {MerkleNode} - Radice dell'albero
   * @private
   */
  _buildTreeFromLeaves(leaves) {
    // Verifica che ci siano foglie
    if (leaves.length === 0) {
      return null;
    }
    
    // Se c'è una sola foglia, restituiscila come radice
    if (leaves.length === 1) {
      return leaves[0];
    }
    
    // Resetta la cache dei nodi
    this.nodeCache.clear();
    
    // Costruisci l'albero livello per livello
    let currentLevel = leaves;
    let levelIndex = 0;
    
    while (currentLevel.length > 1) {
      const nextLevel = [];
      
      // Costruisci il livello successivo
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : null;
        
        // Se non c'è un nodo destro e l'opzione duplicateOdd è attiva, duplica il nodo sinistro
        const rightNode = right || (this.options.duplicateOdd ? left : null);
        
        // Calcola l'hash del nodo
        const hash = this._hashPair(left, rightNode);
        
        // Crea il nodo
        const node = new MerkleNode(hash, left, rightNode);
        
        // Aggiorna altezza e dimensione
        node.updateHeight();
        node.updateSize();
        
        // Aggiungi il nodo al livello successivo
        nextLevel.push(node);
        
        // Memorizza il nodo nella cache
        this.nodeCache.set(levelIndex++, node);
      }
      
      // Passa al livello successivo
      currentLevel = nextLevel;
    }
    
    // La radice è l'unico nodo rimasto
    return currentLevel[0];
  }
  
  /**
   * Ottiene la radice dell'albero
   * @returns {Buffer} - Hash della radice
   */
  getRoot() {
    // Verifica che l'albero sia costruito
    if (this.rebuildRequired) {
      this.buildTree();
    }
    
    return this.root ? this.root.hash : null;
  }
  
  /**
   * Ottiene la proof per una foglia
   * @param {number} index - Indice della foglia
   * @returns {Array<Buffer>} - Proof
   */
  getProof(index) {
    // Verifica che l'indice sia valido
    if (index < 0 || index >= this.leaves.length) {
      throw new Error('Indice foglia non valido');
    }
    
    // Verifica che l'albero sia costruito
    if (this.rebuildRequired) {
      this.buildTree();
    }
    
    // Verifica che l'albero sia costruito
    if (!this.root) {
      throw new Error('Albero non costruito');
    }
    
    // Verifica se la proof è in cache
    if (this.proofCache.has(index)) {
      return this.proofCache.get(index);
    }
    
    const startTime = performance.now();
    
    try {
      // Calcola la proof
      const proof = this._calculateProof(index);
      
      // Memorizza la proof in cache
      this.proofCache.set(index, proof);
      
      const endTime = performance.now();
      this.metrics.recordLatency('get_proof', endTime - startTime);
      
      return proof;
    } catch (error) {
      console.error('Errore durante il calcolo della proof:', error);
      
      const endTime = performance.now();
      this.metrics.recordLatency('get_proof_failed', endTime - startTime);
      this.metrics.incrementCounter('get_proof_failures');
      
      // Emetti evento di errore
      this.emit('error', {
        error,
        operation: 'getProof',
        index
      });
      
      throw error;
    }
  }
  
  /**
   * Ottiene la proof per una foglia tramite chiave
   * @param {string} key - Chiave della foglia
   * @returns {Array<Buffer>} - Proof
   */
  getProofByKey(key) {
    // Verifica che la chiave esista
    if (!this.leafMap.has(key)) {
      throw new Error('Chiave non trovata');
    }
    
    // Ottieni l'indice della foglia
    const index = this.leafMap.get(key);
    
    // Ottieni la proof
    return this.getProof(index);
  }
  
  /**
   * Calcola la proof per una foglia
   * @param {number} index - Indice della foglia
   * @returns {Array<Buffer>} - Proof
   * @private
   */
  _calculateProof(index) {
    // Verifica che l'indice sia valido
    if (index < 0 || index >= this.leaves.length) {
      throw new Error('Indice foglia non valido');
    }
    
    // Verifica che l'albero sia costruito
    if (!this.root) {
      throw new Error('Albero non costruito');
    }
    
    const proof = [];
    let currentIndex = index;
    
    // Calcola la proof
    while (currentIndex < this.leaves.length - 1 || Math.floor(currentIndex / 2) > 0) {
      // Calcola l'indice del fratello
      const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      
      // Verifica che l'indice del fratello sia valido
      if (siblingIndex < this.leaves.length) {
        // Ottieni il nodo fratello
        const siblingNode = siblingIndex < this.leaves.length ? this.leaves[siblingIndex] : null;
        
        if (siblingNode) {
          // Aggiungi l'hash del fratello alla proof
          proof.push({
            position: currentIndex % 2 === 0 ? 'right' : 'left',
            data: siblingNode.hash
          });
        }
      }
      
      // Passa al livello successivo
      currentIndex = Math.floor(currentIndex / 2);
    }
    
    return proof;
  }
  
  /**
   * Verifica una proof
   * @param {Buffer} leaf - Foglia
   * @param {Array<Object>} proof - Proof
   * @param {Buffer} root - Radice
   * @returns {boolean} - True se la proof è valida
   */
  verify(leaf, proof, root) {
    // Verifica che la foglia sia un Buffer
    if (!Buffer.isBuffer(leaf)) {
      throw new Error('La foglia deve essere un Buffer');
    }
    
    // Verifica che la proof sia un array
    if (!Array.isArray(proof)) {
      throw new Error('La proof deve essere un array');
    }
    
    // Verifica che la radice sia un Buffer
    if (!Buffer.isBuffer(root)) {
      throw new Error('La radice deve essere un Buffer');
    }
    
    const startTime = performance.now();
    
    try {
      // Se la verifica parallela è abilitata e ci sono worker disponibili, usa i worker
      if (this.options.enableParallelVerification && this.workerPool) {
        return this._verifyParallel(leaf, proof, root);
      }
      
      // Altrimenti, verifica sequenzialmente
      return this._verifySequential(leaf, proof, root);
    } catch (error) {
      console.error('Errore durante la verifica della proof:', error);
      
      const endTime = performance.now();
      this.metrics.recordLatency('verify_failed', endTime - startTime);
      this.metrics.incrementCounter('verify_failures');
      
      // Emetti evento di errore
      this.emit('error', {
        error,
        operation: 'verify'
      });
      
      return false;
    }
  }
  
  /**
   * Verifica una proof sequenzialmente
   * @param {Buffer} leaf - Foglia
   * @param {Array<Object>} proof - Proof
   * @param {Buffer} root - Radice
   * @returns {boolean} - True se la proof è valida
   * @private
   */
  _verifySequential(leaf, proof, root) {
    const startTime = performance.now();
    
    // Calcola l'hash della foglia
    let hash = this._hash(leaf);
    
    // Verifica la proof
    for (const { position, data } of proof) {
      // Concatena gli hash in base alla posizione
      if (position === 'left') {
        hash = this._hash(this.options.concatenator(data, hash));
      } else {
        hash = this._hash(this.options.concatenator(hash, data));
      }
    }
    
    // Verifica che l'hash calcolato sia uguale alla radice
    const result = hash.equals(root);
    
    const endTime = performance.now();
    this.metrics.recordLatency('verify_sequential', endTime - startTime);
    
    if (result) {
      this.metrics.incrementCounter('verify_successes');
    } else {
      this.metrics.incrementCounter('verify_failures');
    }
    
    return result;
  }
  
  /**
   * Verifica una proof in parallelo
   * @param {Buffer} leaf - Foglia
   * @param {Array<Object>} proof - Proof
   * @param {Buffer} root - Radice
   * @returns {Promise<boolean>} - True se la proof è valida
   * @private
   */
  async _verifyParallel(leaf, proof, root) {
    const startTime = performance.now();
    
    try {
      // Crea il task per il worker
      const task = {
        type: 'verify',
        leaf: leaf,
        proof: proof,
        root: root,
        options: {
          hashFunction: this.options.hashFunction,
          sortPairs: this.options.sortPairs
        }
      };
      
      // Esegui il task
      const result = await this.workerPool.executeTask(task);
      
      const endTime = performance.now();
      this.metrics.recordLatency('verify_parallel', endTime - startTime);
      
      if (result) {
        this.metrics.incrementCounter('verify_successes');
      } else {
        this.metrics.incrementCounter('verify_failures');
      }
      
      return result;
    } catch (error) {
      console.error('Errore durante la verifica parallela della proof:', error);
      
      const endTime = performance.now();
      this.metrics.recordLatency('verify_parallel_failed', endTime - startTime);
      this.metrics.incrementCounter('verify_failures');
      
      // Fallback alla verifica sequenziale
      return this._verifySequential(leaf, proof, root);
    }
  }
  
  /**
   * Verifica più proof in parallelo
   * @param {Array<Buffer>} leaves - Foglie
   * @param {Array<Array<Object>>} proofs - Proof
   * @param {Buffer} root - Radice
   * @returns {Promise<Array<boolean>>} - Risultati delle verifiche
   */
  async verifyBatch(leaves, proofs, root) {
    // Verifica che le foglie siano un array
    if (!Array.isArray(leaves)) {
      throw new Error('Le foglie devono essere un array');
    }
    
    // Verifica che le proof siano un array
    if (!Array.isArray(proofs)) {
      throw new Error('Le proof devono essere un array');
    }
    
    // Verifica che le foglie e le proof abbiano la stessa lunghezza
    if (leaves.length !== proofs.length) {
      throw new Error('Le foglie e le proof devono avere la stessa lunghezza');
    }
    
    // Verifica che la radice sia un Buffer
    if (!Buffer.isBuffer(root)) {
      throw new Error('La radice deve essere un Buffer');
    }
    
    const startTime = performance.now();
    
    try {
      // Se la verifica parallela è abilitata e ci sono worker disponibili, usa i worker
      if (this.options.enableParallelVerification && this.workerPool) {
        // Crea i task per i worker
        const tasks = leaves.map((leaf, i) => ({
          type: 'verify',
          leaf: leaf,
          proof: proofs[i],
          root: root,
          options: {
            hashFunction: this.options.hashFunction,
            sortPairs: this.options.sortPairs
          }
        }));
        
        // Esegui i task in parallelo
        const results = await this.workerPool.executeBatch(tasks);
        
        const endTime = performance.now();
        this.metrics.recordLatency('verify_batch_parallel', endTime - startTime);
        this.metrics.recordThroughput('verifications_per_second', 
                                   leaves.length / ((endTime - startTime) / 1000));
        
        // Conta i successi e i fallimenti
        const successes = results.filter(r => r).length;
        const failures = results.length - successes;
        
        this.metrics.incrementCounter('verify_successes', successes);
        this.metrics.incrementCounter('verify_failures', failures);
        
        return results;
      } else {
        // Altrimenti, verifica sequenzialmente
        const results = [];
        
        for (let i = 0; i < leaves.length; i++) {
          results.push(this._verifySequential(leaves[i], proofs[i], root));
        }
        
        const endTime = performance.now();
        this.metrics.recordLatency('verify_batch_sequential', endTime - startTime);
        this.metrics.recordThroughput('verifications_per_second', 
                                   leaves.length / ((endTime - startTime) / 1000));
        
        // Conta i successi e i fallimenti
        const successes = results.filter(r => r).length;
        const failures = results.length - successes;
        
        this.metrics.incrementCounter('verify_successes', successes);
        this.metrics.incrementCounter('verify_failures', failures);
        
        return results;
      }
    } catch (error) {
      console.error('Errore durante la verifica batch delle proof:', error);
      
      const endTime = performance.now();
      this.metrics.recordLatency('verify_batch_failed', endTime - startTime);
      this.metrics.incrementCounter('verify_batch_failures');
      
      // Emetti evento di errore
      this.emit('error', {
        error,
        operation: 'verifyBatch'
      });
      
      throw error;
    }
  }
  
  /**
   * Ottiene le metriche dell'albero
   * @returns {Object} - Metriche
   */
  getMetrics() {
    return {
      leaves: this.leaves.length,
      height: this.root ? this.root.height : 0,
      cacheSize: this.nodeCache.size,
      proofCacheSize: this.proofCache.size,
      dirtyNodes: this.dirtyNodes.size,
      lastBuildTime: this.lastBuildTime,
      ...this.metrics.getMetrics()
    };
  }
  
  /**
   * Ottiene le statistiche dell'albero
   * @returns {Object} - Statistiche
   */
  getStats() {
    return {
      leaves: this.leaves.length,
      height: this.root ? this.root.height : 0,
      isBalanced: this.root ? this.root.isBalanced() : true,
      size: this.root ? this.root.size : 0,
      root: this.root ? this.root.hash.toString('hex') : null
    };
  }
  
  /**
   * Esegue operazioni batch sull'albero
   * @param {Array<Object>} operations - Operazioni
   * @returns {Promise<Object>} - Risultati
   */
  async executeBatch(operations) {
    if (!Array.isArray(operations)) {
      throw new Error('Le operazioni devono essere un array');
    }
    
    const startTime = performance.now();
    
    try {
      const results = [];
      let rebuildNeeded = false;
      
      // Esegui le operazioni
      for (const operation of operations) {
        const { type, ...params } = operation;
        
        switch (type) {
          case 'addLeaf':
            const { leaf, key } = params;
            const index = this.addLeaf(leaf, key);
            results.push({ success: true, index });
            rebuildNeeded = true;
            break;
            
          case 'updateLeaf':
            const { index: updateIndex, leaf: updateLeaf } = params;
            const updateResult = this.updateLeaf(updateIndex, updateLeaf);
            results.push({ success: updateResult });
            break;
            
          case 'update':
            const { key: updateKey, leaf: updateKeyLeaf } = params;
            const updateKeyResult = this.update(updateKey, updateKeyLeaf);
            results.push({ success: updateKeyResult });
            break;
            
          case 'getProof':
            const { index: proofIndex } = params;
            const proof = this.getProof(proofIndex);
            results.push({ success: true, proof });
            break;
            
          case 'getProofByKey':
            const { key: proofKey } = params;
            const proofByKey = this.getProofByKey(proofKey);
            results.push({ success: true, proof: proofByKey });
            break;
            
          case 'verify':
            const { leaf: verifyLeaf, proof: verifyProof, root: verifyRoot } = params;
            const verifyResult = await this.verify(verifyLeaf, verifyProof, verifyRoot);
            results.push({ success: true, result: verifyResult });
            break;
            
          default:
            results.push({ success: false, error: `Tipo di operazione non supportato: ${type}` });
        }
      }
      
      // Ricostruisci l'albero se necessario
      if (rebuildNeeded && this.rebuildRequired) {
        this.buildTree();
      }
      
      const endTime = performance.now();
      this.metrics.recordLatency('execute_batch', endTime - startTime);
      this.metrics.recordThroughput('operations_per_second', 
                                 operations.length / ((endTime - startTime) / 1000));
      
      return {
        success: true,
        results
      };
    } catch (error) {
      console.error('Errore durante l\'esecuzione batch:', error);
      
      const endTime = performance.now();
      this.metrics.recordLatency('execute_batch_failed', endTime - startTime);
      this.metrics.incrementCounter('execute_batch_failures');
      
      // Emetti evento di errore
      this.emit('error', {
        error,
        operation: 'executeBatch'
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Chiude l'albero
   */
  async close() {
    // Chiudi il worker pool
    if (this.workerPool) {
      await this.workerPool.close();
      this.workerPool = null;
    }
    
    // Chiudi la cache
    if (this.cache) {
      await this.cache.close();
      this.cache = null;
    }
    
    // Resetta lo stato
    this.root = null;
    this.leaves = [];
    this.leafMap.clear();
    this.nodeCache.clear();
    this.proofCache.clear();
    this.dirtyNodes.clear();
    
    // Emetti evento di chiusura
    this.emit('closed');
  }
}

/**
 * Crea un worker per l'albero di Merkle
 */
function createMerkleWorker() {
  // Verifica che sia un worker thread
  if (isMainThread) {
    throw new Error('Questa funzione deve essere chiamata da un worker thread');
  }
  
  // Gestisci i messaggi
  parentPort.on('message', async (message) => {
    try {
      const { type, ...params } = message;
      
      switch (type) {
        case 'verify':
          const { leaf, proof, root, options } = params;
          const result = verifyProof(leaf, proof, root, options);
          parentPort.postMessage({ success: true, result });
          break;
          
        default:
          parentPort.postMessage({ success: false, error: `Tipo di operazione non supportato: ${type}` });
      }
    } catch (error) {
      parentPort.postMessage({ success: false, error: error.message });
    }
  });
  
  /**
   * Verifica una proof
   * @param {Buffer} leaf - Foglia
   * @param {Array<Object>} proof - Proof
   * @param {Buffer} root - Radice
   * @param {Object} options - Opzioni
   * @returns {boolean} - True se la proof è valida
   */
  function verifyProof(leaf, proof, root, options = {}) {
    // Opzioni di default
    const opts = {
      hashFunction: options.hashFunction || 'sha256',
      sortPairs: options.sortPairs !== false,
      ...options
    };
    
    // Funzione di hash
    const hash = (data) => crypto.createHash(opts.hashFunction).update(data).digest();
    
    // Funzione di concatenazione
    const concatenate = (left, right) => Buffer.concat([left, right]);
    
    // Calcola l'hash della foglia
    let currentHash = hash(leaf);
    
    // Verifica la proof
    for (const { position, data } of proof) {
      // Concatena gli hash in base alla posizione
      if (position === 'left') {
        currentHash = hash(concatenate(data, currentHash));
      } else {
        currentHash = hash(concatenate(currentHash, data));
      }
    }
    
    // Verifica che l'hash calcolato sia uguale alla radice
    return currentHash.equals(root);
  }
}

module.exports = {
  MerkleTree,
  MerkleNode,
  createMerkleWorker
};
