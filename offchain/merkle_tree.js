/**
 * Implementazione dell'albero di Merkle per il Layer-2 su Solana
 * 
 * Questo modulo implementa l'albero di Merkle utilizzato per verificare
 * l'inclusione delle transazioni nei batch.
 */

const crypto = require('crypto');

/**
 * Classe per l'albero di Merkle
 */
class MerkleTree {
  /**
   * Costruttore
   * @param {Array<Buffer>} leaves - Foglie dell'albero
   */
  constructor(leaves) {
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
    
    // Salva le foglie
    this.leaves = leaves;
    
    // Costruisce l'albero
    this.layers = this.buildTree(leaves);
  }
  
  /**
   * Costruisce l'albero di Merkle
   * @param {Array<Buffer>} leaves - Foglie dell'albero
   * @returns {Array<Array<Buffer>>} Livelli dell'albero
   */
  buildTree(leaves) {
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
          const parent = this.hashPair(left, right);
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
   */
  hashPair(left, right) {
    // Ordina i nodi per garantire la coerenza
    const pair = Buffer.concat(
      Buffer.compare(left, right) <= 0 ? [left, right] : [right, left]
    );
    
    // Calcola l'hash SHA-256
    return crypto.createHash('sha256').update(pair).digest();
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
   * @returns {Array<Buffer>} Prova di inclusione
   */
  getProof(index) {
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
    
    return proof;
  }
  
  /**
   * Verifica una prova di inclusione
   * @param {Buffer} leaf - Foglia da verificare
   * @param {Array<Object>} proof - Prova di inclusione
   * @param {Buffer} root - Radice dell'albero
   * @returns {boolean} True se la prova è valida
   */
  static verify(leaf, proof, root) {
    let currentHash = leaf;
    
    // Applica la prova
    for (const { data, position } of proof) {
      if (position === 'left') {
        currentHash = MerkleTree.hashPair(data, currentHash);
      } else {
        currentHash = MerkleTree.hashPair(currentHash, data);
      }
    }
    
    // Verifica che l'hash finale sia uguale alla radice
    return Buffer.compare(currentHash, root) === 0;
  }
  
  /**
   * Calcola l'hash di una coppia di nodi (metodo statico)
   * @param {Buffer} left - Nodo sinistro
   * @param {Buffer} right - Nodo destro
   * @returns {Buffer} Hash della coppia
   */
  static hashPair(left, right) {
    // Ordina i nodi per garantire la coerenza
    const pair = Buffer.concat(
      Buffer.compare(left, right) <= 0 ? [left, right] : [right, left]
    );
    
    // Calcola l'hash SHA-256
    return crypto.createHash('sha256').update(pair).digest();
  }
}

module.exports = { MerkleTree };
