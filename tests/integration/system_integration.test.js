/**
 * Test di integrazione per il sistema Layer-2 su Solana
 * 
 * Questi test verificano l'integrazione tra i vari componenti ottimizzati:
 * - Albero di Merkle
 * - Worker Pool
 * - Cache Multi-livello
 * - Coda di Priorità
 * - LMAX Disruptor
 */

const { expect } = require('chai');
const { MerkleTree } = require('../../offchain/merkle_tree');
const { WorkerPool } = require('../../offchain/worker-pool');
const { MultiLevelCache } = require('../../offchain/multi-level-cache');
const { PriorityQueue } = require('../../offchain/priority-queue');
const { Disruptor } = require('../../offchain/lmax-disruptor');
const crypto = require('crypto');
const path = require('path');
const os = require('os');

// Funzione di utilità per generare dati di test
function generateTestData(count) {
  const data = [];
  for (let i = 0; i < count; i++) {
    data.push(Buffer.from(`data-${i}`, 'utf8'));
  }
  return data;
}

// Funzione di utilità per calcolare l'hash SHA-256
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

// Funzione di utilità per generare transazioni di test
function generateTestTransactions(count) {
  const transactions = [];
  for (let i = 0; i < count; i++) {
    transactions.push({
      id: `tx-${i}`,
      sender: `sender-${i % 10}`,
      recipient: `recipient-${(i + 5) % 10}`,
      amount: 100 + i,
      fee: 10 + (i % 5),
      timestamp: Date.now() - (i * 1000),
      data: Buffer.from(`tx-data-${i}`, 'utf8'),
      size: 100 + (i % 100)
    });
  }
  return transactions;
}

describe('Layer-2 Integration Tests', function() {
  // Aumenta il timeout per i test di integrazione
  this.timeout(10000);
  
  let merkleTree;
  let workerPool;
  let cache;
  let priorityQueue;
  let disruptor;
  const tempDir = path.join(os.tmpdir(), 'layer2-integration-test-' + Date.now());
  
  before(async function() {
    // Inizializza i componenti
    merkleTree = new MerkleTree({
      hashFunction: sha256,
      enableCaching: true,
      enableParallelVerification: true
    });
    
    workerPool = new WorkerPool({
      workerCount: 2,
      workerScript: path.join(__dirname, '../mocks/test-worker.js'),
      enableMetrics: true
    });
    
    cache = new MultiLevelCache({
      l1: { enabled: true, maxSize: 100 },
      l2: { enabled: false }, // Disabilita L2 per i test
      l3: { enabled: false }, // Disabilita L3 per i test
      prefetching: { enabled: true, workerCount: 1 },
      dependencies: { enabled: true },
      persistence: { enabled: true, path: tempDir }
    });
    
    priorityQueue = new PriorityQueue({
      maxSize: 100,
      workerCount: 1,
      enableParallelProcessing: false, // Disabilita per i test
      enableMetrics: true
    });
    
    disruptor = new Disruptor({
      bufferSize: 16,
      workerCount: 1,
      enableParallelProcessing: false, // Disabilita per i test
      enableMetrics: true,
      enableDependencyTracking: true
    });
    
    // Attendi l'inizializzazione della cache
    await new Promise(resolve => {
      if (cache.isInitialized) {
        resolve();
      } else {
        cache.once('initialized', resolve);
      }
    });
  });
  
  after(async function() {
    // Chiudi i componenti
    if (workerPool) await workerPool.close();
    if (cache) await cache.close();
    if (priorityQueue) await priorityQueue.close();
    if (disruptor) await disruptor.close();
  });
  
  describe('Merkle Tree e Cache Integration', function() {
    it('should cache Merkle proofs for faster verification', async function() {
      // Crea un albero di Merkle con alcuni dati
      const data = generateTestData(16);
      merkleTree.build(data);
      
      // Genera una prova per un elemento
      const index = 5;
      const proof = merkleTree.generateProof(index);
      
      // Memorizza la prova nella cache
      await cache.set(`merkle-proof:${index}`, proof);
      
      // Recupera la prova dalla cache
      const cachedProof = await cache.get(`merkle-proof:${index}`);
      
      // Verifica che la prova recuperata sia valida
      const isValid = merkleTree.verifyProof(data[index], cachedProof, merkleTree.getRoot());
      expect(isValid).to.be.true;
    });
    
    it('should invalidate cached proofs when Merkle tree changes', async function() {
      // Crea un albero di Merkle con alcuni dati
      const data = generateTestData(16);
      merkleTree.build(data);
      
      // Genera prove per alcuni elementi
      for (let i = 0; i < 5; i++) {
        const proof = merkleTree.generateProof(i);
        await cache.set(`merkle-proof:${i}`, proof, {
          dependencies: ['merkle-root']
        });
      }
      
      // Memorizza la radice dell'albero
      await cache.set('merkle-root', merkleTree.getRoot());
      
      // Modifica l'albero
      merkleTree.update(3, Buffer.from('modified-data', 'utf8'));
      
      // Aggiorna la radice nella cache e invalida le dipendenze
      await cache.set('merkle-root', merkleTree.getRoot(), {
        invalidateDependents: true
      });
      
      // Verifica che le prove siano state invalidate
      for (let i = 0; i < 5; i++) {
        const cachedProof = await cache.get(`merkle-proof:${i}`);
        expect(cachedProof).to.be.null;
      }
    });
  });
  
  describe('Worker Pool e Merkle Tree Integration', function() {
    it('should verify Merkle proofs in parallel using worker pool', async function() {
      // Crea un albero di Merkle con molti dati
      const data = generateTestData(100);
      merkleTree.build(data);
      
      // Genera prove per tutti gli elementi
      const proofs = [];
      for (let i = 0; i < data.length; i++) {
        proofs.push({
          index: i,
          data: data[i],
          proof: merkleTree.generateProof(i)
        });
      }
      
      // Verifica le prove in parallelo utilizzando il worker pool
      const tasks = proofs.map(({ data, proof }) => {
        return workerPool.executeTask('verify_merkle_proof', {
          data,
          proof,
          root: merkleTree.getRoot()
        });
      });
      
      // Attendi il completamento di tutti i task
      const results = await Promise.all(tasks);
      
      // Verifica che tutte le prove siano valide
      expect(results.every(result => result.valid)).to.be.true;
    });
  });
  
  describe('Priority Queue e Disruptor Integration', function() {
    it('should process transactions from priority queue through disruptor', async function() {
      // Genera alcune transazioni di test
      const transactions = generateTestTransactions(20);
      
      // Aggiungi le transazioni alla coda di priorità
      for (const tx of transactions) {
        await priorityQueue.enqueue(tx);
      }
      
      // Attendi che le transazioni vengano elaborate
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Preleva le transazioni dalla coda in batch
      const batch = await priorityQueue.dequeue(10);
      expect(batch.length).to.equal(10);
      
      // Elabora le transazioni attraverso il disruptor
      const results = [];
      for (const tx of batch) {
        results.push(disruptor.publish(tx));
      }
      
      // Attendi il completamento di tutte le transazioni
      const processedResults = await Promise.all(results);
      
      // Verifica che tutte le transazioni siano state elaborate
      expect(processedResults.length).to.equal(10);
      processedResults.forEach(result => {
        expect(result).to.have.property('eventId');
        expect(result).to.have.property('result');
      });
    });
  });
  
  describe('Cache e Priority Queue Integration', function() {
    it('should cache transaction results from priority queue', async function() {
      // Genera alcune transazioni di test
      const transactions = generateTestTransactions(5);
      
      // Aggiungi le transazioni alla coda di priorità
      for (const tx of transactions) {
        await priorityQueue.enqueue(tx);
      }
      
      // Attendi che le transazioni vengano elaborate
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Preleva le transazioni dalla coda
      const batch = await priorityQueue.dequeue(5);
      
      // Memorizza i risultati delle transazioni nella cache
      for (const tx of batch) {
        await cache.set(`tx-result:${tx.id}`, {
          status: 'processed',
          timestamp: Date.now()
        });
      }
      
      // Verifica che i risultati siano stati memorizzati
      for (const tx of batch) {
        const result = await cache.get(`tx-result:${tx.id}`);
        expect(result).to.not.be.null;
        expect(result).to.have.property('status', 'processed');
      }
    });
  });
  
  describe('End-to-End Transaction Processing', function() {
    it('should process transactions through the entire pipeline', async function() {
      // Genera alcune transazioni di test
      const transactions = generateTestTransactions(10);
      
      // Crea un albero di Merkle vuoto
      merkleTree.clear();
      
      // Elabora le transazioni attraverso l'intero pipeline
      for (const tx of transactions) {
        // 1. Aggiungi la transazione alla coda di priorità
        await priorityQueue.enqueue(tx);
      }
      
      // Attendi che le transazioni vengano elaborate
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 2. Preleva le transazioni dalla coda
      const batch = await priorityQueue.dequeue(10);
      
      // 3. Elabora le transazioni attraverso il disruptor
      const disruptorPromises = batch.map(tx => disruptor.publish(tx));
      const processedResults = await Promise.all(disruptorPromises);
      
      // 4. Aggiungi le transazioni all'albero di Merkle
      for (const tx of batch) {
        merkleTree.append(tx.data);
      }
      
      // 5. Genera prove per le transazioni
      const proofs = [];
      for (let i = 0; i < batch.length; i++) {
        proofs.push({
          txId: batch[i].id,
          proof: merkleTree.generateProof(i)
        });
      }
      
      // 6. Memorizza i risultati e le prove nella cache
      for (let i = 0; i < batch.length; i++) {
        const tx = batch[i];
        const proof = proofs[i].proof;
        
        // Memorizza il risultato
        await cache.set(`tx-result:${tx.id}`, {
          status: 'confirmed',
          timestamp: Date.now(),
          merkleProof: proof
        });
        
        // Memorizza la prova con dipendenza dalla radice
        await cache.set(`tx-proof:${tx.id}`, proof, {
          dependencies: ['merkle-root']
        });
      }
      
      // 7. Memorizza la radice dell'albero
      await cache.set('merkle-root', merkleTree.getRoot());
      
      // Verifica che tutte le transazioni siano state elaborate correttamente
      for (const tx of batch) {
        // Verifica il risultato nella cache
        const result = await cache.get(`tx-result:${tx.id}`);
        expect(result).to.not.be.null;
        expect(result).to.have.property('status', 'confirmed');
        expect(result).to.have.property('merkleProof');
        
        // Verifica la prova nella cache
        const proof = await cache.get(`tx-proof:${tx.id}`);
        expect(proof).to.not.be.null;
      }
    });
  });
  
  describe('Performance Benchmarks', function() {
    it('should process transactions with acceptable latency', async function() {
      // Genera molte transazioni di test
      const transactions = generateTestTransactions(100);
      
      // Misura il tempo di elaborazione
      const startTime = Date.now();
      
      // Aggiungi le transazioni alla coda di priorità
      for (const tx of transactions) {
        await priorityQueue.enqueue(tx);
      }
      
      // Attendi che le transazioni vengano elaborate
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Preleva le transazioni dalla coda in batch
      const batchSize = 20;
      const batches = [];
      
      for (let i = 0; i < 5; i++) {
        const batch = await priorityQueue.dequeue(batchSize);
        if (batch.length > 0) {
          batches.push(batch);
        }
      }
      
      // Elabora i batch attraverso il disruptor
      const batchPromises = batches.map(batch => {
        return Promise.all(batch.map(tx => disruptor.publish(tx)));
      });
      
      await Promise.all(batchPromises);
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const avgLatency = totalTime / transactions.length;
      
      console.log(`Processed ${transactions.length} transactions in ${totalTime}ms (avg latency: ${avgLatency.toFixed(2)}ms per transaction)`);
      
      // Verifica che la latenza media sia accettabile (meno di 50ms per transazione)
      expect(avgLatency).to.be.lessThan(50);
    });
    
    it('should handle high throughput with worker pool', async function() {
      // Crea molti task per il worker pool
      const taskCount = 1000;
      const tasks = [];
      
      for (let i = 0; i < taskCount; i++) {
        tasks.push(workerPool.executeTask('echo', { message: `Task ${i}` }));
      }
      
      // Misura il tempo di elaborazione
      const startTime = Date.now();
      await Promise.all(tasks);
      const endTime = Date.now();
      
      const totalTime = endTime - startTime;
      const throughput = taskCount / (totalTime / 1000); // task al secondo
      
      console.log(`Processed ${taskCount} tasks in ${totalTime}ms (throughput: ${throughput.toFixed(2)} tasks/second)`);
      
      // Verifica che il throughput sia accettabile (almeno 1000 task al secondo)
      expect(throughput).to.be.greaterThan(1000);
    });
  });
});
