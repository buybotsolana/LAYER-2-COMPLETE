/**
 * Unit tests per l'Optimized Merkle Tree
 * 
 * Questo file contiene i test unitari per il componente Optimized Merkle Tree
 * dell'architettura ad alte prestazioni del Layer-2 su Solana.
 */

const { expect } = require('chai');
const sinon = require('sinon');
const crypto = require('crypto');
const { OptimizedMerkleTree, MerkleProof, MerkleNode, CacheManager } = require('../../offchain/optimized-merkle-tree');
const { WorkerThreadPool } = require('../../offchain/worker-thread-pool');

describe('OptimizedMerkleTree', function() {
  // Aumenta il timeout per i test più lunghi
  this.timeout(10000);
  
  let tree;
  let mockWorkerPool;
  let mockCacheManager;
  
  beforeEach(() => {
    // Crea mock per il worker pool
    mockWorkerPool = {
      executeTask: sinon.stub().resolves({ hash: 'mock-hash' }),
      executeParallel: sinon.stub().resolves([{ hash: 'mock-hash-1' }, { hash: 'mock-hash-2' }]),
      on: sinon.stub()
    };
    
    // Crea mock per il cache manager
    mockCacheManager = {
      get: sinon.stub().returns(null),
      set: sinon.stub().returns(true),
      has: sinon.stub().returns(false),
      delete: sinon.stub().returns(true),
      clear: sinon.stub().returns(true),
      getStats: sinon.stub().returns({
        size: 0,
        hits: 0,
        misses: 0,
        hitRate: 0
      })
    };
    
    // Crea un'istanza dell'albero
    tree = new OptimizedMerkleTree({
      hashFunction: 'sha256',
      workerPool: mockWorkerPool,
      cacheManager: mockCacheManager,
      cacheIntermediateStates: true,
      enableParallelVerification: true,
      batchSize: 10,
      maxDepth: 32
    });
  });
  
  afterEach(() => {
    // Ripristina i mock
    sinon.restore();
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente l\'albero', () => {
      expect(tree).to.be.an.instanceOf(OptimizedMerkleTree);
      expect(tree.options.hashFunction).to.equal('sha256');
      expect(tree.options.cacheIntermediateStates).to.be.true;
      expect(tree.options.enableParallelVerification).to.be.true;
      expect(tree.options.batchSize).to.equal(10);
      expect(tree.options.maxDepth).to.equal(32);
      expect(tree.root).to.be.null;
      expect(tree.leaves).to.be.an('array').that.is.empty;
    });
    
    it('dovrebbe usare valori predefiniti se non specificati', () => {
      const defaultTree = new OptimizedMerkleTree();
      
      expect(defaultTree.options.hashFunction).to.be.a('string');
      expect(defaultTree.options.cacheIntermediateStates).to.be.a('boolean');
      expect(defaultTree.options.enableParallelVerification).to.be.a('boolean');
      expect(defaultTree.options.batchSize).to.be.a('number');
      expect(defaultTree.options.maxDepth).to.be.a('number');
      expect(defaultTree.root).to.be.null;
      expect(defaultTree.leaves).to.be.an('array').that.is.empty;
    });
    
    it('dovrebbe creare un albero con foglie iniziali', () => {
      const leaves = ['leaf1', 'leaf2', 'leaf3', 'leaf4'];
      const treeWithLeaves = new OptimizedMerkleTree({
        initialLeaves: leaves,
        workerPool: mockWorkerPool,
        cacheManager: mockCacheManager
      });
      
      expect(treeWithLeaves.leaves).to.have.lengthOf(leaves.length);
      expect(treeWithLeaves.root).to.not.be.null;
    });
  });
  
  describe('Operazioni di base', () => {
    it('dovrebbe aggiungere una foglia', async () => {
      const leaf = 'test-leaf';
      await tree.addLeaf(leaf);
      
      expect(tree.leaves).to.have.lengthOf(1);
      expect(tree.root).to.not.be.null;
    });
    
    it('dovrebbe aggiungere più foglie in batch', async () => {
      const leaves = ['leaf1', 'leaf2', 'leaf3', 'leaf4'];
      await tree.addLeaves(leaves);
      
      expect(tree.leaves).to.have.lengthOf(leaves.length);
      expect(tree.root).to.not.be.null;
    });
    
    it('dovrebbe generare una prova per una foglia', async () => {
      const leaves = ['leaf1', 'leaf2', 'leaf3', 'leaf4'];
      await tree.addLeaves(leaves);
      
      const proof = await tree.generateProof(1); // Prova per 'leaf2'
      
      expect(proof).to.be.an.instanceOf(MerkleProof);
      expect(proof.leaf).to.equal(leaves[1]);
      expect(proof.index).to.equal(1);
      expect(proof.siblings).to.be.an('array');
      expect(proof.root).to.equal(tree.root);
    });
    
    it('dovrebbe verificare una prova valida', async () => {
      const leaves = ['leaf1', 'leaf2', 'leaf3', 'leaf4'];
      await tree.addLeaves(leaves);
      
      const proof = await tree.generateProof(1); // Prova per 'leaf2'
      const isValid = await tree.verifyProof(proof);
      
      expect(isValid).to.be.true;
    });
    
    it('dovrebbe rifiutare una prova non valida', async () => {
      const leaves = ['leaf1', 'leaf2', 'leaf3', 'leaf4'];
      await tree.addLeaves(leaves);
      
      const proof = await tree.generateProof(1); // Prova per 'leaf2'
      
      // Modifica la prova per renderla non valida
      proof.leaf = 'tampered-leaf';
      
      const isValid = await tree.verifyProof(proof);
      
      expect(isValid).to.be.false;
    });
    
    it('dovrebbe aggiornare una foglia', async () => {
      const leaves = ['leaf1', 'leaf2', 'leaf3', 'leaf4'];
      await tree.addLeaves(leaves);
      
      const oldRoot = tree.root;
      
      await tree.updateLeaf(1, 'updated-leaf2');
      
      expect(tree.leaves[1]).to.equal('updated-leaf2');
      expect(tree.root).to.not.equal(oldRoot);
    });
    
    it('dovrebbe resettare l\'albero', async () => {
      const leaves = ['leaf1', 'leaf2', 'leaf3', 'leaf4'];
      await tree.addLeaves(leaves);
      
      tree.reset();
      
      expect(tree.leaves).to.be.an('array').that.is.empty;
      expect(tree.root).to.be.null;
    });
  });
  
  describe('Caching e ottimizzazioni', () => {
    it('dovrebbe utilizzare la cache per gli stati intermedi', async () => {
      // Configura il mock per simulare un hit di cache
      mockCacheManager.has.returns(true);
      mockCacheManager.get.returns({
        hash: 'cached-hash',
        left: 'left-hash',
        right: 'right-hash'
      });
      
      const leaves = ['leaf1', 'leaf2'];
      await tree.addLeaves(leaves);
      
      // Verifica che la cache sia stata consultata
      expect(mockCacheManager.has.called).to.be.true;
      expect(mockCacheManager.get.called).to.be.true;
    });
    
    it('dovrebbe memorizzare gli stati intermedi nella cache', async () => {
      const leaves = ['leaf1', 'leaf2'];
      await tree.addLeaves(leaves);
      
      // Verifica che la cache sia stata aggiornata
      expect(mockCacheManager.set.called).to.be.true;
    });
    
    it('dovrebbe utilizzare la verifica parallela', async () => {
      const leaves = ['leaf1', 'leaf2', 'leaf3', 'leaf4', 'leaf5', 'leaf6', 'leaf7', 'leaf8'];
      await tree.addLeaves(leaves);
      
      const proof = await tree.generateProof(3); // Prova per 'leaf4'
      
      // Abilita la verifica parallela
      tree.options.enableParallelVerification = true;
      
      await tree.verifyProof(proof);
      
      // Verifica che il worker pool sia stato utilizzato per la verifica parallela
      expect(mockWorkerPool.executeParallel.called).to.be.true;
    });
    
    it('dovrebbe eseguire operazioni batch per aggiornamenti multipli', async () => {
      const updates = [
        { index: 0, value: 'updated-leaf1' },
        { index: 1, value: 'updated-leaf2' },
        { index: 2, value: 'updated-leaf3' }
      ];
      
      // Prima aggiungi alcune foglie
      await tree.addLeaves(['leaf1', 'leaf2', 'leaf3', 'leaf4']);
      
      const oldRoot = tree.root;
      
      // Esegui gli aggiornamenti in batch
      await tree.updateLeavesBatch(updates);
      
      expect(tree.leaves[0]).to.equal('updated-leaf1');
      expect(tree.leaves[1]).to.equal('updated-leaf2');
      expect(tree.leaves[2]).to.equal('updated-leaf3');
      expect(tree.root).to.not.equal(oldRoot);
      
      // Verifica che il worker pool sia stato utilizzato per gli aggiornamenti in batch
      expect(mockWorkerPool.executeParallel.called).to.be.true;
    });
  });
  
  describe('Gestione degli errori', () => {
    it('dovrebbe gestire indici di foglia non validi', async () => {
      const leaves = ['leaf1', 'leaf2', 'leaf3', 'leaf4'];
      await tree.addLeaves(leaves);
      
      try {
        await tree.generateProof(10); // Indice non valido
        expect.fail('Dovrebbe lanciare un errore');
      } catch (error) {
        expect(error.message).to.include('indice');
      }
      
      try {
        await tree.updateLeaf(10, 'updated-leaf'); // Indice non valido
        expect.fail('Dovrebbe lanciare un errore');
      } catch (error) {
        expect(error.message).to.include('indice');
      }
    });
    
    it('dovrebbe gestire errori durante il calcolo dell\'hash', async () => {
      // Configura il mock per simulare un errore
      mockWorkerPool.executeTask.rejects(new Error('Hash error'));
      
      try {
        await tree.addLeaf('test-leaf');
        expect.fail('Dovrebbe lanciare un errore');
      } catch (error) {
        expect(error.message).to.include('Hash error');
      }
    });
  });
  
  describe('Prestazioni e metriche', () => {
    it('dovrebbe fornire statistiche corrette', async () => {
      const leaves = ['leaf1', 'leaf2', 'leaf3', 'leaf4'];
      await tree.addLeaves(leaves);
      
      const stats = tree.getStats();
      
      expect(stats).to.be.an('object');
      expect(stats.leaves).to.equal(leaves.length);
      expect(stats.depth).to.be.a('number');
      expect(stats.root).to.equal(tree.root);
      expect(stats.cache).to.be.an('object');
    });
    
    it('dovrebbe tracciare le metriche di prestazione', async () => {
      // Spia il metodo per tracciare le metriche
      const trackMetricSpy = sinon.spy(tree, 'trackMetric');
      
      const leaves = ['leaf1', 'leaf2', 'leaf3', 'leaf4'];
      await tree.addLeaves(leaves);
      
      expect(trackMetricSpy.called).to.be.true;
    });
  });
});

describe('MerkleProof', function() {
  let proof;
  
  beforeEach(() => {
    proof = new MerkleProof({
      leaf: 'test-leaf',
      index: 1,
      siblings: ['sibling1', 'sibling2', 'sibling3'],
      root: 'root-hash',
      depth: 3
    });
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente una prova', () => {
      expect(proof).to.be.an.instanceOf(MerkleProof);
      expect(proof.leaf).to.equal('test-leaf');
      expect(proof.index).to.equal(1);
      expect(proof.siblings).to.deep.equal(['sibling1', 'sibling2', 'sibling3']);
      expect(proof.root).to.equal('root-hash');
      expect(proof.depth).to.equal(3);
    });
  });
  
  describe('Serializzazione', () => {
    it('dovrebbe serializzare una prova', () => {
      const serialized = proof.serialize();
      
      expect(serialized).to.be.an('object');
      expect(serialized.leaf).to.equal('test-leaf');
      expect(serialized.index).to.equal(1);
      expect(serialized.siblings).to.deep.equal(['sibling1', 'sibling2', 'sibling3']);
      expect(serialized.root).to.equal('root-hash');
      expect(serialized.depth).to.equal(3);
    });
    
    it('dovrebbe deserializzare una prova', () => {
      const serialized = proof.serialize();
      const deserialized = MerkleProof.deserialize(serialized);
      
      expect(deserialized).to.be.an.instanceOf(MerkleProof);
      expect(deserialized.leaf).to.equal('test-leaf');
      expect(deserialized.index).to.equal(1);
      expect(deserialized.siblings).to.deep.equal(['sibling1', 'sibling2', 'sibling3']);
      expect(deserialized.root).to.equal('root-hash');
      expect(deserialized.depth).to.equal(3);
    });
  });
});

describe('MerkleNode', function() {
  let node;
  
  beforeEach(() => {
    node = new MerkleNode({
      hash: 'node-hash',
      left: 'left-hash',
      right: 'right-hash',
      isLeaf: false,
      height: 1
    });
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente un nodo', () => {
      expect(node).to.be.an.instanceOf(MerkleNode);
      expect(node.hash).to.equal('node-hash');
      expect(node.left).to.equal('left-hash');
      expect(node.right).to.equal('right-hash');
      expect(node.isLeaf).to.be.false;
      expect(node.height).to.equal(1);
    });
    
    it('dovrebbe inizializzare un nodo foglia', () => {
      const leafNode = new MerkleNode({
        hash: 'leaf-hash',
        isLeaf: true,
        height: 0
      });
      
      expect(leafNode.isLeaf).to.be.true;
      expect(leafNode.height).to.equal(0);
      expect(leafNode.left).to.be.null;
      expect(leafNode.right).to.be.null;
    });
  });
  
  describe('Serializzazione', () => {
    it('dovrebbe serializzare un nodo', () => {
      const serialized = node.serialize();
      
      expect(serialized).to.be.an('object');
      expect(serialized.hash).to.equal('node-hash');
      expect(serialized.left).to.equal('left-hash');
      expect(serialized.right).to.equal('right-hash');
      expect(serialized.isLeaf).to.be.false;
      expect(serialized.height).to.equal(1);
    });
    
    it('dovrebbe deserializzare un nodo', () => {
      const serialized = node.serialize();
      const deserialized = MerkleNode.deserialize(serialized);
      
      expect(deserialized).to.be.an.instanceOf(MerkleNode);
      expect(deserialized.hash).to.equal('node-hash');
      expect(deserialized.left).to.equal('left-hash');
      expect(deserialized.right).to.equal('right-hash');
      expect(deserialized.isLeaf).to.be.false;
      expect(deserialized.height).to.equal(1);
    });
  });
});
