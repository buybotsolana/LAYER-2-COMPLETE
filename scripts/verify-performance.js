/**
 * Script per verificare che l'implementazione soddisfi i requisiti di prestazione
 * 
 * Questo script esegue test mirati per verificare che le ottimizzazioni implementate
 * soddisfino i requisiti di prestazione specificati:
 * - Latenza massima: 5ms per aggiornamento dell'albero di Merkle
 * - Throughput minimo: 20.000 operazioni/secondo
 */

const { MerkleTree } = require('../offchain/merkle_tree');
const { WorkerPool } = require('../offchain/worker-pool');
const { MultiLevelCache } = require('../offchain/multi-level-cache');
const { PriorityQueue } = require('../offchain/priority-queue');
const { Disruptor } = require('../offchain/lmax-disruptor');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Requisiti di prestazione
const REQUIREMENTS = {
  merkleUpdateLatency: 5, // ms
  systemThroughput: 20000 // operazioni/secondo
};

// Funzione di utilità per generare dati di test
function generateTestData(count, size = 32) {
  const data = [];
  for (let i = 0; i < count; i++) {
    data.push(crypto.randomBytes(size));
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
      data: crypto.randomBytes(100),
      size: 100 + (i % 100)
    });
  }
  return transactions;
}

// Funzione di utilità per misurare il tempo di esecuzione
async function measureExecutionTime(fn) {
  const startTime = process.hrtime.bigint();
  const result = await fn();
  const endTime = process.hrtime.bigint();
  const duration = Number(endTime - startTime) / 1e6; // Converti in millisecondi
  return { duration, result };
}

// Funzione principale per eseguire i test di verifica
async function verifyPerformanceRequirements() {
  console.log('Verifica dei requisiti di prestazione...');
  console.log('----------------------------------------');
  console.log(`Requisiti:`);
  console.log(`- Latenza massima per aggiornamento dell'albero di Merkle: ${REQUIREMENTS.merkleUpdateLatency}ms`);
  console.log(`- Throughput minimo: ${REQUIREMENTS.systemThroughput} operazioni/secondo`);
  console.log('----------------------------------------');
  
  const results = {
    merkleUpdateLatency: {
      requirement: REQUIREMENTS.merkleUpdateLatency,
      actual: 0,
      passed: false
    },
    systemThroughput: {
      requirement: REQUIREMENTS.systemThroughput,
      actual: 0,
      passed: false
    }
  };
  
  const tempDir = path.join(os.tmpdir(), 'layer2-verification-' + Date.now());
  await fs.mkdir(tempDir, { recursive: true });
  
  console.log('Inizializzazione dei componenti...');
  
  // Inizializza i componenti
  const merkleTree = new MerkleTree({
    hashFunction: sha256,
    enableCaching: true,
    enableParallelVerification: true
  });
  
  const workerPool = new WorkerPool({
    workerCount: 4,
    workerScript: path.join(__dirname, '../offchain/worker-thread.js'),
    enableMetrics: true
  });
  
  const cache = new MultiLevelCache({
    l1: { enabled: true, maxSize: 100000 },
    l2: { enabled: false }, // Disabilita L2 per i test
    l3: { enabled: false }, // Disabilita L3 per i test
    prefetching: { enabled: true, workerCount: 2 },
    dependencies: { enabled: true },
    persistence: { enabled: true, path: tempDir }
  });
  
  // Attendi l'inizializzazione della cache
  await new Promise(resolve => {
    if (cache.isInitialized) {
      resolve();
    } else {
      cache.once('initialized', resolve);
    }
  });
  
  const priorityQueue = new PriorityQueue({
    maxSize: 1000000,
    workerCount: 4,
    enableParallelProcessing: true,
    enableMetrics: true
  });
  
  const disruptor = new Disruptor({
    bufferSize: 16384,
    workerCount: 4,
    enableParallelProcessing: true,
    enableMetrics: true,
    enableDependencyTracking: true
  });
  
  try {
    // Test 1: Verifica della latenza per aggiornamento dell'albero di Merkle
    console.log('\nTest 1: Verifica della latenza per aggiornamento dell\'albero di Merkle');
    console.log('Esecuzione di 1000 aggiornamenti dell\'albero di Merkle...');
    
    const merkleUpdateLatencies = [];
    
    // Esegui 10 iterazioni per ottenere una media affidabile
    for (let i = 0; i < 10; i++) {
      const data = generateTestData(1000);
      merkleTree.clear();
      
      // Misura il tempo per 1000 aggiornamenti
      for (let j = 0; j < 1000; j++) {
        const { duration } = await measureExecutionTime(() => {
          merkleTree.append(data[j]);
          return merkleTree.getRoot();
        });
        
        merkleUpdateLatencies.push(duration);
      }
    }
    
    // Calcola la latenza media
    const avgMerkleUpdateLatency = merkleUpdateLatencies.reduce((sum, val) => sum + val, 0) / merkleUpdateLatencies.length;
    
    results.merkleUpdateLatency.actual = avgMerkleUpdateLatency;
    results.merkleUpdateLatency.passed = avgMerkleUpdateLatency <= REQUIREMENTS.merkleUpdateLatency;
    
    console.log(`Latenza media per aggiornamento dell'albero di Merkle: ${avgMerkleUpdateLatency.toFixed(2)}ms`);
    console.log(`Requisito soddisfatto: ${results.merkleUpdateLatency.passed ? 'Sì ✅' : 'No ❌'}`);
    
    // Test 2: Verifica del throughput del sistema
    console.log('\nTest 2: Verifica del throughput del sistema');
    console.log('Esecuzione di un test di throughput end-to-end...');
    
    const throughputResults = [];
    
    // Esegui 5 iterazioni per ottenere una media affidabile
    for (let i = 0; i < 5; i++) {
      // Pulisci i componenti
      merkleTree.clear();
      await cache.invalidateByPrefix('tx');
      await priorityQueue.close();
      const newPriorityQueue = new PriorityQueue({
        maxSize: 1000000,
        workerCount: 4,
        enableParallelProcessing: true,
        enableMetrics: true
      });
      
      await disruptor.close();
      const newDisruptor = new Disruptor({
        bufferSize: 16384,
        workerCount: 4,
        enableParallelProcessing: true,
        enableMetrics: true,
        enableDependencyTracking: true
      });
      
      // Numero di transazioni per il test
      const transactionCount = 10000;
      const transactions = generateTestTransactions(transactionCount);
      
      // Misura il tempo per elaborare tutte le transazioni
      const { duration } = await measureExecutionTime(async () => {
        // 1. Aggiungi le transazioni alla coda di priorità
        for (const tx of transactions) {
          await newPriorityQueue.enqueue(tx);
        }
        
        // Attendi che le transazioni vengano elaborate
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 2. Preleva le transazioni dalla coda
        const batch = await newPriorityQueue.dequeue(transactionCount);
        
        // 3. Elabora le transazioni attraverso il disruptor
        const disruptorPromises = batch.map(tx => newDisruptor.publish(tx));
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
        const cachePromises = [];
        for (let i = 0; i < batch.length; i++) {
          const tx = batch[i];
          const proof = proofs[i].proof;
          
          cachePromises.push(
            cache.set(`tx-result:${tx.id}`, {
              status: 'confirmed',
              timestamp: Date.now(),
              merkleProof: proof
            })
          );
        }
        
        await Promise.all(cachePromises);
        
        // 7. Memorizza la radice dell'albero
        await cache.set('merkle-root', merkleTree.getRoot());
      });
      
      // Calcola il throughput (transazioni al secondo)
      const throughput = transactionCount / (duration / 1000);
      throughputResults.push(throughput);
      
      // Chiudi i componenti
      await newPriorityQueue.close();
      await newDisruptor.close();
    }
    
    // Calcola il throughput medio
    const avgThroughput = throughputResults.reduce((sum, val) => sum + val, 0) / throughputResults.length;
    
    results.systemThroughput.actual = avgThroughput;
    results.systemThroughput.passed = avgThroughput >= REQUIREMENTS.systemThroughput;
    
    console.log(`Throughput medio del sistema: ${avgThroughput.toFixed(2)} operazioni/secondo`);
    console.log(`Requisito soddisfatto: ${results.systemThroughput.passed ? 'Sì ✅' : 'No ❌'}`);
    
    // Riepilogo dei risultati
    console.log('\nRiepilogo dei risultati:');
    console.log('----------------------------------------');
    console.log(`Latenza per aggiornamento dell'albero di Merkle:`);
    console.log(`- Requisito: ${REQUIREMENTS.merkleUpdateLatency}ms`);
    console.log(`- Attuale: ${results.merkleUpdateLatency.actual.toFixed(2)}ms`);
    console.log(`- Risultato: ${results.merkleUpdateLatency.passed ? 'SUPERATO ✅' : 'NON SUPERATO ❌'}`);
    
    console.log(`\nThroughput del sistema:`);
    console.log(`- Requisito: ${REQUIREMENTS.systemThroughput} operazioni/secondo`);
    console.log(`- Attuale: ${results.systemThroughput.actual.toFixed(2)} operazioni/secondo`);
    console.log(`- Risultato: ${results.systemThroughput.passed ? 'SUPERATO ✅' : 'NON SUPERATO ❌'}`);
    
    console.log('\nVerifica complessiva:');
    const allPassed = results.merkleUpdateLatency.passed && results.systemThroughput.passed;
    console.log(`- Tutti i requisiti soddisfatti: ${allPassed ? 'Sì ✅' : 'No ❌'}`);
    
    // Salva i risultati in un file JSON
    const resultsFile = path.join(__dirname, '../verification-results.json');
    await fs.writeFile(resultsFile, JSON.stringify(results, null, 2));
    console.log(`\nRisultati salvati in ${resultsFile}`);
    
    return { results, allPassed };
  } finally {
    // Chiudi i componenti
    await workerPool.close();
    await cache.close();
    await priorityQueue.close();
    await disruptor.close();
    
    // Pulisci la directory temporanea
    try {
      const files = await fs.readdir(tempDir);
      for (const file of files) {
        await fs.unlink(path.join(tempDir, file));
      }
      await fs.rmdir(tempDir);
    } catch (error) {
      console.error('Errore durante la pulizia della directory temporanea:', error);
    }
  }
}

// Esegui la verifica
verifyPerformanceRequirements().catch(console.error);
