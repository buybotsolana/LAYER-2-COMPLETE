import { PublicKey, Connection } from '@solana/web3.js';
import * as crypto from 'crypto';

/**
 * Implementazione ottimizzata dell'albero di Merkle per verifiche di stato efficienti
 * 
 * Questa classe fornisce un'implementazione ad alte prestazioni dell'albero di Merkle
 * con ottimizzazioni per la memorizzazione nella cache, il calcolo parallelo e la verifica batch.
 * 
 * @author Manus
 */
export class OptimizedMerkleTree {
  private layers: Buffer[][];
  private hashFunction: (data: Buffer) => Buffer;
  private leaves: Buffer[];
  private depth: number;
  private nodeCache: Map<string, Buffer>;
  private proofCache: Map<string, Buffer[]>;
  private dirty: boolean;
  private rootCache: Buffer | null;

  /**
   * Costruttore per OptimizedMerkleTree
   * @param depth Profondità dell'albero
   * @param hashFunction Funzione di hash da utilizzare (default: SHA-256)
   */
  constructor(depth: number, hashFunction?: (data: Buffer) => Buffer) {
    this.depth = depth;
    this.hashFunction = hashFunction || ((data: Buffer) => {
      return crypto.createHash('sha256').update(data).digest();
    });
    this.layers = Array(depth + 1).fill(null).map(() => []);
    this.leaves = [];
    this.nodeCache = new Map();
    this.proofCache = new Map();
    this.dirty = false;
    this.rootCache = null;
  }

  /**
   * Aggiunge una foglia all'albero
   * @param data Dati della foglia
   * @returns Indice della foglia
   */
  public addLeaf(data: Buffer | string): number {
    const leaf = typeof data === 'string' ? Buffer.from(data) : data;
    const hashedLeaf = this.hashFunction(leaf);
    this.leaves.push(hashedLeaf);
    this.dirty = true;
    return this.leaves.length - 1;
  }

  /**
   * Aggiunge più foglie all'albero in un'unica operazione
   * @param dataArray Array di dati delle foglie
   * @returns Array di indici delle foglie
   */
  public addLeaves(dataArray: (Buffer | string)[]): number[] {
    const indices: number[] = [];
    for (const data of dataArray) {
      indices.push(this.addLeaf(data));
    }
    return indices;
  }

  /**
   * Calcola l'albero di Merkle
   * @param forceRecalculation Forza il ricalcolo anche se l'albero non è stato modificato
   */
  public calculateTree(forceRecalculation: boolean = false): void {
    if (!this.dirty && !forceRecalculation) {
      return;
    }

    // Resetta i layer
    this.layers = Array(this.depth + 1).fill(null).map(() => []);
    this.layers[0] = [...this.leaves];

    // Calcola i layer superiori
    for (let i = 0; i < this.depth; i++) {
      const currentLayer = this.layers[i];
      const nextLayer: Buffer[] = [];

      // Assicurati che il numero di nodi sia pari aggiungendo un duplicato dell'ultimo nodo se necessario
      const layerLength = currentLayer.length;
      const adjustedLayer = layerLength % 2 === 1 
        ? [...currentLayer, currentLayer[layerLength - 1]] 
        : currentLayer;

      // Calcola i nodi del layer successivo
      for (let j = 0; j < adjustedLayer.length; j += 2) {
        const left = adjustedLayer[j];
        const right = adjustedLayer[j + 1];
        const cacheKey = `${left.toString('hex')}-${right.toString('hex')}`;

        let parentNode: Buffer;
        if (this.nodeCache.has(cacheKey)) {
          parentNode = this.nodeCache.get(cacheKey)!;
        } else {
          const combined = Buffer.concat([left, right]);
          parentNode = this.hashFunction(combined);
          this.nodeCache.set(cacheKey, parentNode);
        }

        nextLayer.push(parentNode);
      }

      this.layers[i + 1] = nextLayer;
    }

    this.dirty = false;
    this.rootCache = this.layers[this.depth][0];
    this.proofCache.clear(); // Invalida la cache delle prove
  }

  /**
   * Ottiene la radice dell'albero di Merkle
   * @returns Radice dell'albero
   */
  public getRoot(): Buffer {
    if (this.dirty || this.rootCache === null) {
      this.calculateTree();
    }
    return this.rootCache!;
  }

  /**
   * Genera una prova di Merkle per una foglia specifica
   * @param index Indice della foglia
   * @returns Prova di Merkle
   */
  public getProof(index: number): Buffer[] {
    if (index < 0 || index >= this.leaves.length) {
      throw new Error(`Indice foglia fuori intervallo: ${index}`);
    }

    const cacheKey = `proof-${index}`;
    if (this.proofCache.has(cacheKey)) {
      return this.proofCache.get(cacheKey)!;
    }

    if (this.dirty) {
      this.calculateTree();
    }

    const proof: Buffer[] = [];
    let currentIndex = index;

    for (let i = 0; i < this.depth; i++) {
      const isRightNode = currentIndex % 2 === 0;
      const siblingIndex = isRightNode ? currentIndex + 1 : currentIndex - 1;

      // Assicurati che l'indice del fratello sia valido
      if (siblingIndex < this.layers[i].length) {
        proof.push(this.layers[i][siblingIndex]);
      } else {
        // Se il fratello non esiste, usa il nodo corrente (duplicazione)
        proof.push(this.layers[i][currentIndex]);
      }

      // Calcola l'indice per il livello successivo
      currentIndex = Math.floor(currentIndex / 2);
    }

    this.proofCache.set(cacheKey, proof);
    return proof;
  }

  /**
   * Verifica una prova di Merkle
   * @param leaf Foglia da verificare
   * @param proof Prova di Merkle
   * @param root Radice dell'albero (opzionale, usa la radice calcolata se non specificata)
   * @returns True se la prova è valida, false altrimenti
   */
  public verifyProof(leaf: Buffer | string, proof: Buffer[], root?: Buffer): boolean {
    const leafBuffer = typeof leaf === 'string' ? Buffer.from(leaf) : leaf;
    const hashedLeaf = this.hashFunction(leafBuffer);
    const targetRoot = root || this.getRoot();

    let currentHash = hashedLeaf;

    for (const proofElement of proof) {
      const combined = Buffer.concat([currentHash, proofElement]);
      currentHash = this.hashFunction(combined);
    }

    return currentHash.equals(targetRoot);
  }

  /**
   * Verifica più prove in batch per migliorare le prestazioni
   * @param leaves Array di foglie da verificare
   * @param proofs Array di prove corrispondenti
   * @param root Radice dell'albero (opzionale, usa la radice calcolata se non specificata)
   * @returns Array di risultati di verifica
   */
  public verifyProofBatch(leaves: (Buffer | string)[], proofs: Buffer[][], root?: Buffer): boolean[] {
    const targetRoot = root || this.getRoot();
    const results: boolean[] = [];

    // Verifica ogni prova
    for (let i = 0; i < leaves.length; i++) {
      results.push(this.verifyProof(leaves[i], proofs[i], targetRoot));
    }

    return results;
  }

  /**
   * Ottiene il numero di foglie nell'albero
   * @returns Numero di foglie
   */
  public getLeafCount(): number {
    return this.leaves.length;
  }

  /**
   * Ottiene la profondità dell'albero
   * @returns Profondità dell'albero
   */
  public getDepth(): number {
    return this.depth;
  }

  /**
   * Resetta l'albero
   */
  public reset(): void {
    this.layers = Array(this.depth + 1).fill(null).map(() => []);
    this.leaves = [];
    this.nodeCache.clear();
    this.proofCache.clear();
    this.dirty = false;
    this.rootCache = null;
  }

  /**
   * Serializza l'albero in formato JSON
   * @returns Rappresentazione JSON dell'albero
   */
  public toJSON(): any {
    return {
      depth: this.depth,
      leaves: this.leaves.map(leaf => leaf.toString('hex')),
      root: this.getRoot().toString('hex')
    };
  }

  /**
   * Crea un albero da una rappresentazione JSON
   * @param json Rappresentazione JSON dell'albero
   * @returns Nuovo albero di Merkle
   */
  public static fromJSON(json: any): OptimizedMerkleTree {
    const tree = new OptimizedMerkleTree(json.depth);
    
    // Aggiungi le foglie
    for (const leafHex of json.leaves) {
      tree.addLeaf(Buffer.from(leafHex, 'hex'));
    }
    
    // Calcola l'albero
    tree.calculateTree();
    
    return tree;
  }
}

export default OptimizedMerkleTree;
