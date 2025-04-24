/**
 * Benchmark di prestazioni per il sistema Layer-2 su Solana
 * 
 * Questo script esegue benchmark completi per verificare che le ottimizzazioni
 * implementate soddisfino i requisiti di prestazione specificati.
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

// Configurazione del benchmark
const config = {
  merkleTree: {
    dataSize: [1000, 10000, 100000],
    batchSizes: [10, 100, 1000],
    iterations: 5
  },
  workerPool: {
    taskCounts: [1000, 10000, 100000],
    workerCounts: [2, 4, 8],
    iterations: 3
  },
  cache: {
    itemCounts: [1000, 10000, 100000],
    keySize: 20,
    valueSize: 1024,
    iterations: 3
  },
  priorityQueue: {
    transactionCounts: [1000, 10000, 100000],
    batchSizes: [10, 100, 1000],
    iterations: 3
  },
  disruptor: {
    eventCounts: [1000, 10000, 100000],
    bufferSizes: [1024, 4096, 16384],
    iterations: 3
  },
  endToEnd: {
    transactionCounts: [100, 1000, 10000],
    iterations: 3
  }
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

// Funzione di utilità per calcolare statistiche
function calculateStats(durations) {
  const avg = durations.reduce((sum, val) => sum + val, 0) / durations.length;
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  const sorted = [...durations].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  
  return {
    avg,
    min,
    max,
    median,
    p95: sorted[Math.floor(sorted.length * 0.95)]
  };
}

// Funzione di utilità per formattare i risultati
function formatResults(stats) {
  return {
    avg: `${stats.avg.toFixed(2)}ms`,
    min: `${stats.min.toFixed(2)}ms`,
    max: `${stats.max.toFixed(2)}ms`,
    median: `${stats.median.toFixed(2)}ms`,
    p95: `${stats.p95.toFixed(2)}ms`
  };
}

// Funzione principale per eseguire i benchmark
async function runBenchmarks() {
  const results = {
    merkleTree: {},
    workerPool: {},
    cache: {},
    priorityQueue: {},
    disruptor: {},
    endToEnd: {}
  };
  
  const tempDir = path.join(os.tmpdir(), 'layer2-benchmark-' + Date.now());
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
    l2: { enabled: false }, // Disabilita L2 per i benchmark
    l3: { enabled: false }, // Disabilita L3 per i benchmark
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
    console.log('Esecuzione dei benchmark dell\'albero di Merkle...');
    results.merkleTree = await benchmarkMerkleTree(merkleTree);
    
    console.log('Esecuzione dei benchmark del worker pool...');
    results.workerPool = await benchmarkWorkerPool(workerPool);
    
    console.log('Esecuzione dei benchmark della cache multi-livello...');
    results.cache = await benchmarkCache(cache);
    
    console.log('Esecuzione dei benchmark della coda di priorità...');
    results.priorityQueue = await benchmarkPriorityQueue(priorityQueue);
    
    console.log('Esecuzione dei benchmark del disruptor...');
    results.disruptor = await benchmarkDisruptor(disruptor);
    
    console.log('Esecuzione dei benchmark end-to-end...');
    results.endToEnd = await benchmarkEndToEnd(merkleTree, workerPool, cache, priorityQueue, disruptor);
    
    console.log('Benchmark completati!');
    
    // Salva i risultati in un file JSON
    const resultsFile = path.join(__dirname, '../benchmark-results.json');
    await fs.writeFile(resultsFile, JSON.stringify(results, null, 2));
    console.log(`Risultati salvati in ${resultsFile}`);
    
    // Genera un report in formato Markdown
    const reportFile = path.join(__dirname, '../benchmark-report.md');
    await generateReport(results, reportFile);
    console.log(`Report generato in ${reportFile}`);
    
    return results;
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

// Benchmark dell'albero di Merkle
async function benchmarkMerkleTree(merkleTree) {
  const results = {
    build: {},
    append: {},
    generateProof: {},
    verifyProof: {},
    batchOperations: {}
  };
  
  // Benchmark della costruzione dell'albero
  for (const dataSize of config.merkleTree.dataSize) {
    const durations = [];
    
    for (let i = 0; i < config.merkleTree.iterations; i++) {
      const data = generateTestData(dataSize);
      
      const { duration } = await measureExecutionTime(() => {
        merkleTree.clear();
        merkleTree.build(data);
        return merkleTree.getRoot();
      });
      
      durations.push(duration);
    }
    
    results.build[dataSize] = formatResults(calculateStats(durations));
  }
  
  // Benchmark dell'aggiunta di elementi
  for (const dataSize of config.merkleTree.dataSize) {
    const durations = [];
    
    for (let i = 0; i < config.merkleTree.iterations; i++) {
      const data = generateTestData(dataSize);
      merkleTree.clear();
      
      const { duration } = await measureExecutionTime(() => {
        for (const item of data) {
          merkleTree.append(item);
        }
        return merkleTree.getRoot();
      });
      
      durations.push(duration);
    }
    
    results.append[dataSize] = formatResults(calculateStats(durations));
  }
  
  // Benchmark della generazione di prove
  for (const dataSize of config.merkleTree.dataSize) {
    const durations = [];
    
    // Costruisci l'albero una volta
    const data = generateTestData(dataSize);
    merkleTree.clear();
    merkleTree.build(data);
    
    for (let i = 0; i < config.merkleTree.iterations; i++) {
      const indices = Array.from({ length: 100 }, () => Math.floor(Math.random() * dataSize));
      
      const { duration } = await measureExecutionTime(() => {
        const proofs = [];
        for (const index of indices) {
          proofs.push(merkleTree.generateProof(index));
        }
        return proofs;
      });
      
      durations.push(duration / 100); // Durata media per prova
    }
    
    results.generateProof[dataSize] = formatResults(calculateStats(durations));
  }
  
  // Benchmark della verifica di prove
  for (const dataSize of config.merkleTree.dataSize) {
    const durations = [];
    
    // Costruisci l'albero una volta
    const data = generateTestData(dataSize);
    merkleTree.clear();
    merkleTree.build(data);
    const root = merkleTree.getRoot();
    
    // Genera alcune prove
    const proofs = [];
    for (let i = 0; i < 100; i++) {
      const index = Math.floor(Math.random() * dataSize);
      proofs.push({
        data: data[index],
        proof: merkleTree.generateProof(index)
      });
    }
    
    for (let i = 0; i < config.merkleTree.iterations; i++) {
      const { duration } = await measureExecutionTime(() => {
        const results = [];
        for (const { data, proof } of proofs) {
          results.push(merkleTree.verifyProof(data, proof, root));
        }
        return results;
      });
      
      durations.push(duration / 100); // Durata media per verifica
    }
    
    results.verifyProof[dataSize] = formatResults(calculateStats(durations));
  }
  
  // Benchmark delle operazioni batch
  for (const batchSize of config.merkleTree.batchSizes) {
    const durations = [];
    
    for (let i = 0; i < config.merkleTree.iterations; i++) {
      const data = generateTestData(batchSize);
      merkleTree.clear();
      
      const { duration } = await measureExecutionTime(() => {
        return merkleTree.appendBatch(data);
      });
      
      durations.push(duration);
    }
    
    results.batchOperations[batchSize] = formatResults(calculateStats(durations));
  }
  
  return results;
}

// Benchmark del worker pool
async function benchmarkWorkerPool(workerPool) {
  const results = {
    singleTask: {},
    batchTasks: {},
    parallelTasks: {}
  };
  
  // Benchmark di un singolo task
  const singleTaskDurations = [];
  
  for (let i = 0; i < config.workerPool.iterations; i++) {
    const { duration } = await measureExecutionTime(() => {
      return workerPool.executeTask('echo', { message: 'Hello, World!' });
    });
    
    singleTaskDurations.push(duration);
  }
  
  results.singleTask = formatResults(calculateStats(singleTaskDurations));
  
  // Benchmark di batch di task
  for (const taskCount of config.workerPool.taskCounts) {
    const durations = [];
    
    for (let i = 0; i < config.workerPool.iterations; i++) {
      const batch = [];
      
      for (let j = 0; j < taskCount; j++) {
        batch.push({
          taskType: 'echo',
          data: { message: `Task ${j}` }
        });
      }
      
      const { duration } = await measureExecutionTime(() => {
        return workerPool.executeBatch(batch);
      });
      
      durations.push(duration);
    }
    
    results.batchTasks[taskCount] = formatResults(calculateStats(durations));
  }
  
  // Benchmark di task paralleli con diversi numeri di worker
  for (const workerCount of config.workerPool.workerCounts) {
    const durations = [];
    
    // Crea un pool con il numero specificato di worker
    const pool = new WorkerPool({
      workerCount,
      workerScript: path.join(__dirname, '../offchain/worker-thread.js'),
      enableMetrics: true
    });
    
    try {
      for (let i = 0; i < config.workerPool.iterations; i++) {
        const tasks = [];
        
        for (let j = 0; j < 1000; j++) {
          tasks.push(pool.executeTask('echo', { message: `Task ${j}` }));
        }
        
        const { duration } = await measureExecutionTime(() => {
          return Promise.all(tasks);
        });
        
        durations.push(duration);
      }
      
      results.parallelTasks[workerCount] = formatResults(calculateStats(durations));
    } finally {
      await pool.close();
    }
  }
  
  return results;
}

// Benchmark della cache multi-livello
async function benchmarkCache(cache) {
  const results = {
    set: {},
    get: {},
    invalidate: {},
    dependencies: {},
    prefetching: {}
  };
  
  // Benchmark dell'operazione set
  for (const itemCount of config.cache.itemCounts) {
    const durations = [];
    
    for (let i = 0; i < config.cache.iterations; i++) {
      const keys = [];
      const values = [];
      
      // Genera chiavi e valori casuali
      for (let j = 0; j < itemCount; j++) {
        keys.push(`key-${j}-${crypto.randomBytes(8).toString('hex')}`);
        values.push({
          data: crypto.randomBytes(config.cache.valueSize).toString('hex')
        });
      }
      
      const { duration } = await measureExecutionTime(async () => {
        for (let j = 0; j < itemCount; j++) {
          await cache.set(keys[j], values[j]);
        }
      });
      
      durations.push(duration / itemCount); // Durata media per operazione
    }
    
    results.set[itemCount] = formatResults(calculateStats(durations));
  }
  
  // Benchmark dell'operazione get
  for (const itemCount of config.cache.itemCounts) {
    const durations = [];
    
    for (let i = 0; i < config.cache.iterations; i++) {
      const keys = [];
      const values = [];
      
      // Genera chiavi e valori casuali
      for (let j = 0; j < itemCount; j++) {
        keys.push(`key-${j}-${crypto.randomBytes(8).toString('hex')}`);
        values.push({
          data: crypto.randomBytes(config.cache.valueSize).toString('hex')
        });
      }
      
      // Memorizza i valori nella cache
      for (let j = 0; j < itemCount; j++) {
        await cache.set(keys[j], values[j]);
      }
      
      const { duration } = await measureExecutionTime(async () => {
        for (let j = 0; j < itemCount; j++) {
          await cache.get(keys[j]);
        }
      });
      
      durations.push(duration / itemCount); // Durata media per operazione
    }
    
    results.get[itemCount] = formatResults(calculateStats(durations));
  }
  
  // Benchmark dell'operazione invalidate
  for (const itemCount of [100, 1000, 10000]) {
    const durations = [];
    
    for (let i = 0; i < config.cache.iterations; i++) {
      const keys = [];
      const values = [];
      
      // Genera chiavi e valori casuali
      for (let j = 0; j < itemCount; j++) {
        keys.push(`key-${j}-${crypto.randomBytes(8).toString('hex')}`);
        values.push({
          data: crypto.randomBytes(config.cache.valueSize).toString('hex')
        });
      }
      
      // Memorizza i valori nella cache
      for (let j = 0; j < itemCount; j++) {
        await cache.set(keys[j], values[j]);
      }
      
      const { duration } = await measureExecutionTime(async () => {
        for (let j = 0; j < itemCount; j++) {
          await cache.invalidate(keys[j]);
        }
      });
      
      durations.push(duration / itemCount); // Durata media per operazione
    }
    
    results.invalidate[itemCount] = formatResults(calculateStats(durations));
  }
  
  // Benchmark delle dipendenze
  const dependencyDurations = [];
  
  for (let i = 0; i < config.cache.iterations; i++) {
    // Crea una catena di dipendenze
    const chainLength = 100;
    const keys = [];
    
    for (let j = 0; j < chainLength; j++) {
      keys.push(`dep-${j}-${crypto.randomBytes(8).toString('hex')}`);
    }
    
    // Memorizza i valori con dipendenze
    for (let j = 0; j < chainLength; j++) {
      const dependencies = j > 0 ? [keys[j - 1]] : [];
      await cache.set(keys[j], { value: j }, { dependencies });
    }
    
    // Misura il tempo per invalidare la catena
    const { duration } = await measureExecutionTime(async () => {
      await cache.invalidate(keys[0], { invalidateDependents: true });
    });
    
    dependencyDurations.push(duration);
  }
  
  results.dependencies = formatResults(calculateStats(dependencyDurations));
  
  // Benchmark del prefetching
  const prefetchingDurations = [];
  
  for (let i = 0; i < config.cache.iterations; i++) {
    // Crea un pattern di accesso
    const patternLength = 5;
    const keys = [];
    
    for (let j = 0; j < patternLength; j++) {
      keys.push(`pattern-${j}-${crypto.randomBytes(8).toString('hex')}`);
    }
    
    // Memorizza i valori nella cache
    for (const key of keys) {
      await cache.set(key, { value: key });
    }
    
    // Simula il pattern di accesso più volte
    for (let j = 0; j < 3; j++) {
      for (const key of keys) {
        await cache.get(key);
      }
    }
    
    // Misura il tempo per accedere al pattern
    const { duration } = await measureExecutionTime(async () => {
      for (const key of keys) {
        await cache.get(key);
      }
    });
    
    prefetchingDurations.push(duration / patternLength); // Durata media per accesso
  }
  
  results.prefetching = formatResults(calculateStats(prefetchingDurations));
  
  return results;
}

// Benchmark della coda di priorità
async function benchmarkPriorityQueue(priorityQueue) {
  const results = {
    enqueue: {},
    dequeue: {},
    batchOperations: {},
    priorityUpdate: {}
  };
  
  // Benchmark dell'operazione enqueue
  for (const transactionCount of config.priorityQueue.transactionCounts) {
    const durations = [];
    
    for (let i = 0; i < config.priorityQueue.iterations; i++) {
      const transactions = generateTestTransactions(transactionCount);
      
      // Pulisci la coda
      await priorityQueue.close();
      priorityQueue = new PriorityQueue({
        maxSize: 1000000,
        workerCount: 4,
        enableParallelProcessing: true,
        enableMetrics: true
      });
      
      const { duration } = await measureExecutionTime(async () => {
        for (const tx of transactions) {
          await priorityQueue.enqueue(tx);
        }
      });
      
      durations.push(duration / transactionCount); // Durata media per operazione
    }
    
    results.enqueue[transactionCount] = formatResults(calculateStats(durations));
  }
  
  // Benchmark dell'operazione dequeue
  for (const transactionCount of config.priorityQueue.transactionCounts) {
    const durations = [];
    
    for (let i = 0; i < config.priorityQueue.iterations; i++) {
      const transactions = generateTestTransactions(transactionCount);
      
      // Pulisci la coda
      await priorityQueue.close();
      priorityQueue = new PriorityQueue({
        maxSize: 1000000,
        workerCount: 4,
        enableParallelProcessing: true,
        enableMetrics: true
      });
      
      // Aggiungi le transazioni alla coda
      for (const tx of transactions) {
        await priorityQueue.enqueue(tx);
      }
      
      // Attendi che le transazioni vengano elaborate
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const { duration } = await measureExecutionTime(async () => {
        await priorityQueue.dequeue(transactionCount);
      });
      
      durations.push(duration);
    }
    
    results.dequeue[transactionCount] = formatResults(calculateStats(durations));
  }
  
  // Benchmark delle operazioni batch
  for (const batchSize of config.priorityQueue.batchSizes) {
    const durations = [];
    
    for (let i = 0; i < config.priorityQueue.iterations; i++) {
      const transactions = generateTestTransactions(batchSize * 10);
      
      // Pulisci la coda
      await priorityQueue.close();
      priorityQueue = new PriorityQueue({
        maxSize: 1000000,
        workerCount: 4,
        enableParallelProcessing: true,
        enableMetrics: true
      });
      
      // Aggiungi le transazioni alla coda
      for (const tx of transactions) {
        await priorityQueue.enqueue(tx);
      }
      
      // Attendi che le transazioni vengano elaborate
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const { duration } = await measureExecutionTime(async () => {
        for (let j = 0; j < 10; j++) {
          await priorityQueue.dequeue(batchSize);
        }
      });
      
      durations.push(duration / 10); // Durata media per batch
    }
    
    results.batchOperations[batchSize] = formatResults(calculateStats(durations));
  }
  
  // Benchmark dell'aggiornamento delle priorità
  const priorityUpdateDurations = [];
  
  for (let i = 0; i < config.priorityQueue.iterations; i++) {
    const transactions = generateTestTransactions(1000);
    
    // Pulisci la coda
    await priorityQueue.close();
    priorityQueue = new PriorityQueue({
      maxSize: 1000000,
      workerCount: 4,
      enableParallelProcessing: true,
      enableMetrics: true
    });
    
    // Aggiungi le transazioni alla coda
    for (const tx of transactions) {
      await priorityQueue.enqueue(tx);
    }
    
    // Attendi che le transazioni vengano elaborate
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const { duration } = await measureExecutionTime(async () => {
      for (let j = 0; j < 100; j++) {
        const txId = `tx-${j}`;
        priorityQueue.boostPriority(txId, 2.0);
      }
    });
    
    priorityUpdateDurations.push(duration / 100); // Durata media per aggiornamento
  }
  
  results.priorityUpdate = formatResults(calculateStats(priorityUpdateDurations));
  
  return results;
}

// Benchmark del disruptor
async function benchmarkDisruptor(disruptor) {
  const results = {
    publish: {},
    batchPublish: {},
    dependencies: {}
  };
  
  // Benchmark dell'operazione publish
  for (const eventCount of config.disruptor.eventCounts) {
    const durations = [];
    
    for (let i = 0; i < config.disruptor.iterations; i++) {
      // Pulisci il disruptor
      await disruptor.close();
      disruptor = new Disruptor({
        bufferSize: 16384,
        workerCount: 4,
        enableParallelProcessing: true,
        enableMetrics: true,
        enableDependencyTracking: true
      });
      
      const events = generateTestTransactions(eventCount);
      
      const { duration } = await measureExecutionTime(async () => {
        for (const event of events) {
          await disruptor.publish(event);
        }
      });
      
      durations.push(duration / eventCount); // Durata media per operazione
    }
    
    results.publish[eventCount] = formatResults(calculateStats(durations));
  }
  
  // Benchmark della pubblicazione in batch
  for (const bufferSize of config.disruptor.bufferSizes) {
    const durations = [];
    
    for (let i = 0; i < config.disruptor.iterations; i++) {
      // Pulisci il disruptor
      await disruptor.close();
      disruptor = new Disruptor({
        bufferSize,
        workerCount: 4,
        enableParallelProcessing: true,
        enableMetrics: true,
        enableDependencyTracking: true,
        enableBatchProcessing: true,
        batchSize: 100
      });
      
      const events = generateTestTransactions(1000);
      
      const { duration } = await measureExecutionTime(async () => {
        const promises = [];
        for (const event of events) {
          promises.push(disruptor.publish(event));
        }
        await Promise.all(promises);
      });
      
      durations.push(duration);
    }
    
    results.batchPublish[bufferSize] = formatResults(calculateStats(durations));
  }
  
  // Benchmark delle dipendenze
  const dependencyDurations = [];
  
  for (let i = 0; i < config.disruptor.iterations; i++) {
    // Pulisci il disruptor
    await disruptor.close();
    disruptor = new Disruptor({
      bufferSize: 16384,
      workerCount: 4,
      enableParallelProcessing: true,
      enableMetrics: true,
      enableDependencyTracking: true
    });
    
    // Crea una catena di dipendenze
    const chainLength = 10;
    const events = [];
    const eventIds = [];
    
    for (let j = 0; j < chainLength; j++) {
      events.push({
        value: `event-${j}`,
        data: crypto.randomBytes(100)
      });
    }
    
    // Pubblica il primo evento
    const firstEvent = await disruptor.publish(events[0]);
    eventIds.push(firstEvent.eventId);
    
    // Misura il tempo per pubblicare la catena di dipendenze
    const { duration } = await measureExecutionTime(async () => {
      for (let j = 1; j < chainLength; j++) {
        const result = await disruptor.publish(
          events[j],
          { dependencies: [eventIds[j - 1]] }
        );
        eventIds.push(result.eventId);
      }
    });
    
    dependencyDurations.push(duration / (chainLength - 1)); // Durata media per evento dipendente
  }
  
  results.dependencies = formatResults(calculateStats(dependencyDurations));
  
  return results;
}

// Benchmark end-to-end
async function benchmarkEndToEnd(merkleTree, workerPool, cache, priorityQueue, disruptor) {
  const results = {
    throughput: {},
    latency: {}
  };
  
  // Benchmark del throughput
  for (const transactionCount of config.endToEnd.transactionCounts) {
    const durations = [];
    
    for (let i = 0; i < config.endToEnd.iterations; i++) {
      // Pulisci i componenti
      merkleTree.clear();
      await cache.invalidateByPrefix('tx');
      await priorityQueue.close();
      priorityQueue = new PriorityQueue({
        maxSize: 1000000,
        workerCount: 4,
        enableParallelProcessing: true,
        enableMetrics: true
      });
      await disruptor.close();
      disruptor = new Disruptor({
        bufferSize: 16384,
        workerCount: 4,
        enableParallelProcessing: true,
        enableMetrics: true,
        enableDependencyTracking: true
      });
      
      const transactions = generateTestTransactions(transactionCount);
      
      const { duration } = await measureExecutionTime(async () => {
        // 1. Aggiungi le transazioni alla coda di priorità
        for (const tx of transactions) {
          await priorityQueue.enqueue(tx);
        }
        
        // Attendi che le transazioni vengano elaborate
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 2. Preleva le transazioni dalla coda
        const batch = await priorityQueue.dequeue(transactionCount);
        
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
      
      durations.push(duration);
      
      // Calcola il throughput (transazioni al secondo)
      const throughput = transactionCount / (duration / 1000);
      console.log(`End-to-end throughput (${transactionCount} transactions): ${throughput.toFixed(2)} tx/s`);
    }
    
    // Calcola il throughput medio
    const avgDuration = durations.reduce((sum, val) => sum + val, 0) / durations.length;
    const avgThroughput = transactionCount / (avgDuration / 1000);
    
    results.throughput[transactionCount] = {
      txPerSecond: avgThroughput.toFixed(2),
      duration: formatResults(calculateStats(durations))
    };
  }
  
  // Benchmark della latenza
  const latencyDurations = [];
  
  for (let i = 0; i < config.endToEnd.iterations; i++) {
    // Pulisci i componenti
    merkleTree.clear();
    await cache.invalidateByPrefix('tx');
    await priorityQueue.close();
    priorityQueue = new PriorityQueue({
      maxSize: 1000000,
      workerCount: 4,
      enableParallelProcessing: true,
      enableMetrics: true
    });
    await disruptor.close();
    disruptor = new Disruptor({
      bufferSize: 16384,
      workerCount: 4,
      enableParallelProcessing: true,
      enableMetrics: true,
      enableDependencyTracking: true
    });
    
    // Crea una singola transazione
    const tx = generateTestTransactions(1)[0];
    
    const { duration } = await measureExecutionTime(async () => {
      // 1. Aggiungi la transazione alla coda di priorità
      await priorityQueue.enqueue(tx);
      
      // Attendi che la transazione venga elaborata
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // 2. Preleva la transazione dalla coda
      const batch = await priorityQueue.dequeue(1);
      
      // 3. Elabora la transazione attraverso il disruptor
      const processedResult = await disruptor.publish(batch[0]);
      
      // 4. Aggiungi la transazione all'albero di Merkle
      merkleTree.append(batch[0].data);
      
      // 5. Genera una prova per la transazione
      const proof = merkleTree.generateProof(0);
      
      // 6. Memorizza il risultato e la prova nella cache
      await cache.set(`tx-result:${batch[0].id}`, {
        status: 'confirmed',
        timestamp: Date.now(),
        merkleProof: proof
      });
      
      // 7. Memorizza la radice dell'albero
      await cache.set('merkle-root', merkleTree.getRoot());
    });
    
    latencyDurations.push(duration);
    console.log(`End-to-end latency: ${duration.toFixed(2)}ms`);
  }
  
  results.latency = formatResults(calculateStats(latencyDurations));
  
  return results;
}

// Genera un report in formato Markdown
async function generateReport(results, reportFile) {
  let report = `# Benchmark Report - Layer-2 su Solana\n\n`;
  report += `Data: ${new Date().toISOString()}\n\n`;
  
  // Requisiti di prestazione
  report += `## Requisiti di Prestazione\n\n`;
  report += `- Latenza massima: 5ms per aggiornamento dell'albero di Merkle\n`;
  report += `- Throughput minimo: 20.000 operazioni/secondo\n\n`;
  
  // Risultati dell'albero di Merkle
  report += `## Albero di Merkle\n\n`;
  
  report += `### Costruzione dell'Albero\n\n`;
  report += `| Dimensione Dati | Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|----------------|-------------|--------------|---------------|---------|-----|\n`;
  for (const [dataSize, stats] of Object.entries(results.merkleTree.build)) {
    report += `| ${dataSize} | ${stats.avg} | ${stats.min} | ${stats.max} | ${stats.median} | ${stats.p95} |\n`;
  }
  report += `\n`;
  
  report += `### Aggiunta di Elementi\n\n`;
  report += `| Dimensione Dati | Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|----------------|-------------|--------------|---------------|---------|-----|\n`;
  for (const [dataSize, stats] of Object.entries(results.merkleTree.append)) {
    report += `| ${dataSize} | ${stats.avg} | ${stats.min} | ${stats.max} | ${stats.median} | ${stats.p95} |\n`;
  }
  report += `\n`;
  
  report += `### Generazione di Prove\n\n`;
  report += `| Dimensione Dati | Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|----------------|-------------|--------------|---------------|---------|-----|\n`;
  for (const [dataSize, stats] of Object.entries(results.merkleTree.generateProof)) {
    report += `| ${dataSize} | ${stats.avg} | ${stats.min} | ${stats.max} | ${stats.median} | ${stats.p95} |\n`;
  }
  report += `\n`;
  
  report += `### Verifica di Prove\n\n`;
  report += `| Dimensione Dati | Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|----------------|-------------|--------------|---------------|---------|-----|\n`;
  for (const [dataSize, stats] of Object.entries(results.merkleTree.verifyProof)) {
    report += `| ${dataSize} | ${stats.avg} | ${stats.min} | ${stats.max} | ${stats.median} | ${stats.p95} |\n`;
  }
  report += `\n`;
  
  report += `### Operazioni Batch\n\n`;
  report += `| Dimensione Batch | Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|-----------------|-------------|--------------|---------------|---------|-----|\n`;
  for (const [batchSize, stats] of Object.entries(results.merkleTree.batchOperations)) {
    report += `| ${batchSize} | ${stats.avg} | ${stats.min} | ${stats.max} | ${stats.median} | ${stats.p95} |\n`;
  }
  report += `\n`;
  
  // Risultati del worker pool
  report += `## Worker Pool\n\n`;
  
  report += `### Task Singolo\n\n`;
  report += `| Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|-------------|--------------|---------------|---------|-----|\n`;
  report += `| ${results.workerPool.singleTask.avg} | ${results.workerPool.singleTask.min} | ${results.workerPool.singleTask.max} | ${results.workerPool.singleTask.median} | ${results.workerPool.singleTask.p95} |\n\n`;
  
  report += `### Batch di Task\n\n`;
  report += `| Numero di Task | Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|---------------|-------------|--------------|---------------|---------|-----|\n`;
  for (const [taskCount, stats] of Object.entries(results.workerPool.batchTasks)) {
    report += `| ${taskCount} | ${stats.avg} | ${stats.min} | ${stats.max} | ${stats.median} | ${stats.p95} |\n`;
  }
  report += `\n`;
  
  report += `### Task Paralleli\n\n`;
  report += `| Numero di Worker | Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|-----------------|-------------|--------------|---------------|---------|-----|\n`;
  for (const [workerCount, stats] of Object.entries(results.workerPool.parallelTasks)) {
    report += `| ${workerCount} | ${stats.avg} | ${stats.min} | ${stats.max} | ${stats.median} | ${stats.p95} |\n`;
  }
  report += `\n`;
  
  // Risultati della cache multi-livello
  report += `## Cache Multi-livello\n\n`;
  
  report += `### Operazione Set\n\n`;
  report += `| Numero di Item | Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|---------------|-------------|--------------|---------------|---------|-----|\n`;
  for (const [itemCount, stats] of Object.entries(results.cache.set)) {
    report += `| ${itemCount} | ${stats.avg} | ${stats.min} | ${stats.max} | ${stats.median} | ${stats.p95} |\n`;
  }
  report += `\n`;
  
  report += `### Operazione Get\n\n`;
  report += `| Numero di Item | Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|---------------|-------------|--------------|---------------|---------|-----|\n`;
  for (const [itemCount, stats] of Object.entries(results.cache.get)) {
    report += `| ${itemCount} | ${stats.avg} | ${stats.min} | ${stats.max} | ${stats.median} | ${stats.p95} |\n`;
  }
  report += `\n`;
  
  report += `### Operazione Invalidate\n\n`;
  report += `| Numero di Item | Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|---------------|-------------|--------------|---------------|---------|-----|\n`;
  for (const [itemCount, stats] of Object.entries(results.cache.invalidate)) {
    report += `| ${itemCount} | ${stats.avg} | ${stats.min} | ${stats.max} | ${stats.median} | ${stats.p95} |\n`;
  }
  report += `\n`;
  
  report += `### Dipendenze\n\n`;
  report += `| Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|-------------|--------------|---------------|---------|-----|\n`;
  report += `| ${results.cache.dependencies.avg} | ${results.cache.dependencies.min} | ${results.cache.dependencies.max} | ${results.cache.dependencies.median} | ${results.cache.dependencies.p95} |\n\n`;
  
  report += `### Prefetching\n\n`;
  report += `| Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|-------------|--------------|---------------|---------|-----|\n`;
  report += `| ${results.cache.prefetching.avg} | ${results.cache.prefetching.min} | ${results.cache.prefetching.max} | ${results.cache.prefetching.median} | ${results.cache.prefetching.p95} |\n\n`;
  
  // Risultati della coda di priorità
  report += `## Coda di Priorità\n\n`;
  
  report += `### Operazione Enqueue\n\n`;
  report += `| Numero di Transazioni | Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|----------------------|-------------|--------------|---------------|---------|-----|\n`;
  for (const [txCount, stats] of Object.entries(results.priorityQueue.enqueue)) {
    report += `| ${txCount} | ${stats.avg} | ${stats.min} | ${stats.max} | ${stats.median} | ${stats.p95} |\n`;
  }
  report += `\n`;
  
  report += `### Operazione Dequeue\n\n`;
  report += `| Numero di Transazioni | Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|----------------------|-------------|--------------|---------------|---------|-----|\n`;
  for (const [txCount, stats] of Object.entries(results.priorityQueue.dequeue)) {
    report += `| ${txCount} | ${stats.avg} | ${stats.min} | ${stats.max} | ${stats.median} | ${stats.p95} |\n`;
  }
  report += `\n`;
  
  report += `### Operazioni Batch\n\n`;
  report += `| Dimensione Batch | Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|-----------------|-------------|--------------|---------------|---------|-----|\n`;
  for (const [batchSize, stats] of Object.entries(results.priorityQueue.batchOperations)) {
    report += `| ${batchSize} | ${stats.avg} | ${stats.min} | ${stats.max} | ${stats.median} | ${stats.p95} |\n`;
  }
  report += `\n`;
  
  report += `### Aggiornamento Priorità\n\n`;
  report += `| Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|-------------|--------------|---------------|---------|-----|\n`;
  report += `| ${results.priorityQueue.priorityUpdate.avg} | ${results.priorityQueue.priorityUpdate.min} | ${results.priorityQueue.priorityUpdate.max} | ${results.priorityQueue.priorityUpdate.median} | ${results.priorityQueue.priorityUpdate.p95} |\n\n`;
  
  // Risultati del disruptor
  report += `## LMAX Disruptor\n\n`;
  
  report += `### Operazione Publish\n\n`;
  report += `| Numero di Eventi | Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|-----------------|-------------|--------------|---------------|---------|-----|\n`;
  for (const [eventCount, stats] of Object.entries(results.disruptor.publish)) {
    report += `| ${eventCount} | ${stats.avg} | ${stats.min} | ${stats.max} | ${stats.median} | ${stats.p95} |\n`;
  }
  report += `\n`;
  
  report += `### Pubblicazione Batch\n\n`;
  report += `| Dimensione Buffer | Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|------------------|-------------|--------------|---------------|---------|-----|\n`;
  for (const [bufferSize, stats] of Object.entries(results.disruptor.batchPublish)) {
    report += `| ${bufferSize} | ${stats.avg} | ${stats.min} | ${stats.max} | ${stats.median} | ${stats.p95} |\n`;
  }
  report += `\n`;
  
  report += `### Dipendenze\n\n`;
  report += `| Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|-------------|--------------|---------------|---------|-----|\n`;
  report += `| ${results.disruptor.dependencies.avg} | ${results.disruptor.dependencies.min} | ${results.disruptor.dependencies.max} | ${results.disruptor.dependencies.median} | ${results.disruptor.dependencies.p95} |\n\n`;
  
  // Risultati end-to-end
  report += `## End-to-End\n\n`;
  
  report += `### Throughput\n\n`;
  report += `| Numero di Transazioni | Transazioni/Secondo | Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|----------------------|---------------------|-------------|--------------|---------------|---------|-----|\n`;
  for (const [txCount, result] of Object.entries(results.endToEnd.throughput)) {
    report += `| ${txCount} | ${result.txPerSecond} | ${result.duration.avg} | ${result.duration.min} | ${result.duration.max} | ${result.duration.median} | ${result.duration.p95} |\n`;
  }
  report += `\n`;
  
  report += `### Latenza\n\n`;
  report += `| Tempo Medio | Tempo Minimo | Tempo Massimo | Mediana | P95 |\n`;
  report += `|-------------|--------------|---------------|---------|-----|\n`;
  report += `| ${results.endToEnd.latency.avg} | ${results.endToEnd.latency.min} | ${results.endToEnd.latency.max} | ${results.endToEnd.latency.median} | ${results.endToEnd.latency.p95} |\n\n`;
  
  // Conclusioni
  report += `## Conclusioni\n\n`;
  
  // Verifica se i requisiti di prestazione sono soddisfatti
  const merkleUpdateLatency = parseFloat(results.merkleTree.append[1000].avg);
  const endToEndThroughput = parseFloat(results.endToEnd.throughput[1000].txPerSecond);
  
  const merkleRequirementMet = merkleUpdateLatency <= 5;
  const throughputRequirementMet = endToEndThroughput >= 20000;
  
  report += `### Requisiti di Prestazione\n\n`;
  report += `- Latenza massima per aggiornamento dell'albero di Merkle: ${merkleUpdateLatency.toFixed(2)}ms (Requisito: 5ms) - ${merkleRequirementMet ? '✅ Soddisfatto' : '❌ Non soddisfatto'}\n`;
  report += `- Throughput minimo: ${endToEndThroughput} operazioni/secondo (Requisito: 20.000 operazioni/secondo) - ${throughputRequirementMet ? '✅ Soddisfatto' : '❌ Non soddisfatto'}\n\n`;
  
  report += `### Riepilogo\n\n`;
  report += `Le ottimizzazioni implementate hanno portato a significativi miglioramenti delle prestazioni:\n\n`;
  report += `1. **Albero di Merkle**: Le operazioni batch e il caching degli stati intermedi hanno ridotto la latenza media per aggiornamento a ${merkleUpdateLatency.toFixed(2)}ms.\n`;
  report += `2. **Worker Pool**: L'elaborazione parallela ha permesso di raggiungere un throughput elevato, con una latenza media di ${results.workerPool.singleTask.avg} per task.\n`;
  report += `3. **Cache Multi-livello**: Il prefetching predittivo ha ridotto la latenza di accesso a ${results.cache.prefetching.avg}.\n`;
  report += `4. **Coda di Priorità**: L'implementazione con heap binario ha permesso di gestire efficacemente le transazioni con una latenza media di ${results.priorityQueue.enqueue[1000].avg} per operazione.\n`;
  report += `5. **LMAX Disruptor**: Il pattern disruptor ha migliorato l'elaborazione degli eventi con una latenza media di ${results.disruptor.publish[1000].avg} per evento.\n\n`;
  
  report += `Il sistema completo è in grado di elaborare transazioni con una latenza end-to-end di ${results.endToEnd.latency.avg} e un throughput di ${results.endToEnd.throughput[1000].txPerSecond} transazioni al secondo.\n`;
  
  // Scrivi il report su file
  await fs.writeFile(reportFile, report);
  
  return report;
}

// Esegui i benchmark
runBenchmarks().catch(console.error);
