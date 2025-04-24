/**
 * Benchmark di prestazioni per l'architettura ad alte prestazioni
 * 
 * Questo file contiene i benchmark di prestazioni per misurare le performance
 * dei componenti dell'architettura ad alte prestazioni del Layer-2 su Solana.
 */

const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Importa tutti i componenti necessari
const { ParallelSequencer } = require('../../offchain/parallel-sequencer');
const { ShardedDatabase } = require('../../offchain/sharded-database');
const { OptimizedMerkleTree } = require('../../offchain/optimized-merkle-tree');
const { MultiLevelCache } = require('../../offchain/multi-level-cache');
const { SharedRingBuffer } = require('../../offchain/shared-ring-buffer');
const { PerformanceMetrics } = require('../../offchain/performance-metrics');
const { WorkerThreadPool } = require('../../offchain/worker-thread-pool');

// Configurazione dei benchmark
const BENCHMARK_CONFIG = {
  // Numero di iterazioni per ogni benchmark
  iterations: {
    small: 100,
    medium: 1000,
    large: 10000,
    stress: 100000
  },
  
  // Dimensioni dei batch per i test di batch
  batchSizes: [1, 10, 100, 1000],
  
  // Numero di worker per i test di parallelizzazione
  workerCounts: [1, 2, 4, 8, 16, 32],
  
  // Dimensioni delle cache per i test di caching
  cacheSizes: {
    small: { L1: 100, L2: 1000 },
    medium: { L1: 1000, L2: 10000 },
    large: { L1: 10000, L2: 100000 }
  },
  
  // Dimensioni degli alberi di Merkle per i test
  merkleTreeSizes: [100, 1000, 10000, 100000],
  
  // Dimensioni dei buffer condivisi per i test
  ringBufferSizes: [1024, 4096, 16384, 65536],
  
  // Dimensioni dei database shardati per i test
  databaseShardCounts: [1, 2, 4, 8, 16],
  
  // Percorso per il salvataggio dei risultati
  resultsPath: path.join(__dirname, '../../benchmark-results'),
  
  // Flag per abilitare il salvataggio dei risultati su file
  saveResults: true,
  
  // Flag per abilitare la visualizzazione dei risultati in console
  logResults: true
};

// Funzione di utilità per misurare il tempo di esecuzione
async function measureExecutionTime(fn, iterations = 1) {
  const startTime = performance.now();
  
  for (let i = 0; i < iterations; i++) {
    await fn(i);
  }
  
  const endTime = performance.now();
  const totalTime = endTime - startTime;
  const avgTime = totalTime / iterations;
  
  return {
    totalTime,
    avgTime,
    iterations
  };
}

// Funzione di utilità per generare dati casuali
function generateRandomData(size) {
  return crypto.randomBytes(size).toString('hex');
}

// Funzione di utilità per generare transazioni casuali
function generateRandomTransactions(count) {
  const transactions = [];
  
  for (let i = 0; i < count; i++) {
    transactions.push({
      id: `tx-${i}`,
      sender: `wallet-${Math.floor(Math.random() * 100)}`,
      recipient: `wallet-${Math.floor(Math.random() * 100)}`,
      amount: Math.random() * 1000,
      timestamp: Date.now()
    });
  }
  
  return transactions;
}

// Funzione di utilità per salvare i risultati
function saveResults(name, results) {
  if (!BENCHMARK_CONFIG.saveResults) {
    return;
  }
  
  // Crea la directory se non esiste
  if (!fs.existsSync(BENCHMARK_CONFIG.resultsPath)) {
    fs.mkdirSync(BENCHMARK_CONFIG.resultsPath, { recursive: true });
  }
  
  const filePath = path.join(BENCHMARK_CONFIG.resultsPath, `${name}-${Date.now()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(results, null, 2));
  
  if (BENCHMARK_CONFIG.logResults) {
    console.log(`Risultati salvati in: ${filePath}`);
  }
}

// Funzione di utilità per formattare i risultati
function formatResults(results) {
  const formatted = [];
  
  for (const result of results) {
    formatted.push({
      name: result.name,
      avgTime: `${result.avgTime.toFixed(2)} ms`,
      totalTime: `${result.totalTime.toFixed(2)} ms`,
      iterations: result.iterations,
      throughput: `${(result.iterations / (result.totalTime / 1000)).toFixed(2)} op/s`,
      ...(result.params || {})
    });
  }
  
  return formatted;
}

// Funzione di utilità per stampare i risultati
function logResults(name, results) {
  if (!BENCHMARK_CONFIG.logResults) {
    return;
  }
  
  console.log(`\n=== Risultati del benchmark: ${name} ===`);
  console.table(formatResults(results));
}

// Benchmark del Parallel Sequencer
async function benchmarkParallelSequencer() {
  console.log('\n=== Benchmark del Parallel Sequencer ===');
  
  // Inizializza i componenti necessari
  const workerPool = new WorkerThreadPool({
    minWorkers: 2,
    maxWorkers: 32,
    workerScript: path.join(__dirname, '../../offchain/worker-thread.js')
  });
  
  // Crea mock per il database
  const mockDatabase = {
    execute: async () => ({ rowCount: 1 }),
    query: async () => ({ rows: [{ id: 1, value: 'test' }] }),
    transaction: async (callback) => {
      return await callback({
        execute: async () => ({ rowCount: 1 }),
        query: async () => ({ rows: [{ id: 1, value: 'test' }] })
      });
    },
    getShardIndicesForKey: () => [0],
    connect: async () => {},
    disconnect: async () => {},
    isConnected: true
  };
  
  // Crea mock per l'albero di Merkle
  const mockMerkleTree = {
    addLeaf: async () => 'root-hash',
    addLeaves: async () => 'root-hash',
    generateProof: async () => ({ leaf: 'leaf', index: 0, siblings: [], root: 'root-hash' }),
    verifyProof: async () => true,
    updateLeaf: async () => 'root-hash',
    updateLeavesBatch: async () => 'root-hash',
    reset: () => {}
  };
  
  // Crea mock per la cache
  const mockCache = {
    get: async () => null,
    set: async () => true,
    has: async () => false,
    delete: async () => true,
    clear: async () => true
  };
  
  // Crea mock per il buffer condiviso
  const mockRingBuffer = {
    write: () => true,
    read: () => null,
    isEmpty: () => true,
    isFull: () => false,
    getSize: () => 0,
    getCapacity: () => 1024
  };
  
  // Crea mock per le metriche
  const mockMetrics = {
    collector: {
      recordMetric: async () => {}
    }
  };
  
  // Risultati del benchmark
  const results = [];
  
  // Test 1: Elaborazione di singole transazioni
  for (const workerCount of BENCHMARK_CONFIG.workerCounts) {
    const sequencer = new ParallelSequencer({
      workerPool,
      database: mockDatabase,
      merkleTree: mockMerkleTree,
      cache: mockCache,
      ringBuffer: mockRingBuffer,
      metrics: mockMetrics,
      maxParallelTasks: workerCount
    });
    
    await sequencer.start();
    
    const result = await measureExecutionTime(
      async () => {
        const tx = {
          id: `tx-${Math.random()}`,
          sender: `wallet-${Math.random()}`,
          recipient: `wallet-${Math.random()}`,
          amount: Math.random() * 1000,
          timestamp: Date.now()
        };
        
        return await sequencer.processTransaction(tx);
      },
      BENCHMARK_CONFIG.iterations.medium
    );
    
    results.push({
      name: 'Elaborazione singola transazione',
      ...result,
      params: {
        workerCount
      }
    });
    
    await sequencer.stop();
  }
  
  // Test 2: Elaborazione di batch di transazioni
  for (const workerCount of BENCHMARK_CONFIG.workerCounts) {
    for (const batchSize of BENCHMARK_CONFIG.batchSizes) {
      if (batchSize > 100) continue; // Limita i batch più grandi per evitare test troppo lunghi
      
      const sequencer = new ParallelSequencer({
        workerPool,
        database: mockDatabase,
        merkleTree: mockMerkleTree,
        cache: mockCache,
        ringBuffer: mockRingBuffer,
        metrics: mockMetrics,
        maxParallelTasks: workerCount,
        maxBatchSize: batchSize * 2 // Assicurati che il batch size massimo sia sufficiente
      });
      
      await sequencer.start();
      
      const result = await measureExecutionTime(
        async () => {
          const transactions = generateRandomTransactions(batchSize);
          return await sequencer.processBatch(transactions);
        },
        Math.max(1, Math.floor(BENCHMARK_CONFIG.iterations.small / batchSize))
      );
      
      results.push({
        name: 'Elaborazione batch di transazioni',
        ...result,
        params: {
          workerCount,
          batchSize
        }
      });
      
      await sequencer.stop();
    }
  }
  
  // Test 3: Throughput massimo
  const maxWorkerCount = Math.max(...BENCHMARK_CONFIG.workerCounts);
  const sequencer = new ParallelSequencer({
    workerPool,
    database: mockDatabase,
    merkleTree: mockMerkleTree,
    cache: mockCache,
    ringBuffer: mockRingBuffer,
    metrics: mockMetrics,
    maxParallelTasks: maxWorkerCount,
    maxBatchSize: 1000
  });
  
  await sequencer.start();
  
  // Genera un grande batch di transazioni
  const largeBatch = generateRandomTransactions(1000);
  
  const result = await measureExecutionTime(
    async () => {
      return await sequencer.processBatch(largeBatch);
    },
    10 // Esegui solo 10 iterazioni per evitare test troppo lunghi
  );
  
  results.push({
    name: 'Throughput massimo',
    ...result,
    params: {
      workerCount: maxWorkerCount,
      batchSize: 1000,
      throughput: (1000 / (result.avgTime / 1000)).toFixed(2) + ' tx/s'
    }
  });
  
  await sequencer.stop();
  
  // Termina il worker pool
  await workerPool.terminate();
  
  // Salva e stampa i risultati
  logResults('parallel-sequencer', results);
  saveResults('parallel-sequencer', results);
  
  return results;
}

// Benchmark del Sharded Database
async function benchmarkShardedDatabase() {
  console.log('\n=== Benchmark del Sharded Database ===');
  
  // Risultati del benchmark
  const results = [];
  
  // Crea mock per gli shard
  function createMockShards(count) {
    const shards = [];
    for (let i = 0; i < count; i++) {
      shards.push({
        id: `shard-${i}`,
        connect: async () => {},
        disconnect: async () => {},
        query: async () => ({ rows: [{ id: i, value: `test-${i}` }] }),
        execute: async () => ({ rowCount: 1 }),
        transaction: async (callback) => {
          return await callback({
            query: async () => ({ rows: [{ id: i, value: `test-${i}` }] }),
            execute: async () => ({ rowCount: 1 })
          });
        },
        isConnected: () => true,
        getStats: () => ({
          id: `shard-${i}`,
          connectionPool: { total: 10, active: 2, idle: 8 },
          queries: { total: 100, active: 1 },
          performance: { avgQueryTime: 5 }
        })
      });
    }
    return shards;
  }
  
  // Test 1: Query di lettura con diversi numeri di shard
  for (const shardCount of BENCHMARK_CONFIG.databaseShardCounts) {
    const mockShards = createMockShards(shardCount);
    
    const database = new ShardedDatabase({
      shards: mockShards,
      shardingStrategy: 'consistent-hash',
      replicationFactor: Math.min(2, shardCount),
      readConsistency: 'one',
      writeConsistency: 'all'
    });
    
    await database.connect();
    
    const result = await measureExecutionTime(
      async (i) => {
        return await database.query('SELECT * FROM test WHERE id = $1', [i], { routingKey: `key-${i}` });
      },
      BENCHMARK_CONFIG.iterations.medium
    );
    
    results.push({
      name: 'Query di lettura',
      ...result,
      params: {
        shardCount,
        replicationFactor: Math.min(2, shardCount),
        readConsistency: 'one'
      }
    });
    
    await database.disconnect();
  }
  
  // Test 2: Query di scrittura con diversi numeri di shard
  for (const shardCount of BENCHMARK_CONFIG.databaseShardCounts) {
    const mockShards = createMockShards(shardCount);
    
    const database = new ShardedDatabase({
      shards: mockShards,
      shardingStrategy: 'consistent-hash',
      replicationFactor: Math.min(2, shardCount),
      readConsistency: 'one',
      writeConsistency: 'all'
    });
    
    await database.connect();
    
    const result = await measureExecutionTime(
      async (i) => {
        return await database.execute(
          'INSERT INTO test (id, value) VALUES ($1, $2)',
          [i, `value-${i}`],
          { routingKey: `key-${i}` }
        );
      },
      BENCHMARK_CONFIG.iterations.medium
    );
    
    results.push({
      name: 'Query di scrittura',
      ...result,
      params: {
        shardCount,
        replicationFactor: Math.min(2, shardCount),
        writeConsistency: 'all'
      }
    });
    
    await database.disconnect();
  }
  
  // Test 3: Transazioni con diversi numeri di shard
  for (const shardCount of BENCHMARK_CONFIG.databaseShardCounts) {
    const mockShards = createMockShards(shardCount);
    
    const database = new ShardedDatabase({
      shards: mockShards,
      shardingStrategy: 'consistent-hash',
      replicationFactor: Math.min(2, shardCount),
      readConsistency: 'one',
      writeConsistency: 'all'
    });
    
    await database.connect();
    
    const result = await measureExecutionTime(
      async (i) => {
        return await database.transaction(
          async (client) => {
            const queryResult = await client.query('SELECT * FROM test WHERE id = $1', [i]);
            await client.execute('UPDATE test SET value = $1 WHERE id = $2', [`updated-${i}`, i]);
            return queryResult;
          },
          { routingKey: `key-${i}` }
        );
      },
      BENCHMARK_CONFIG.iterations.medium
    );
    
    results.push({
      name: 'Transazioni',
      ...result,
      params: {
        shardCount,
        replicationFactor: Math.min(2, shardCount)
      }
    });
    
    await database.disconnect();
  }
  
  // Test 4: Confronto tra diverse strategie di sharding
  const shardingStrategies = ['consistent-hash', 'hash', 'range'];
  const shardCount = 4;
  
  for (const strategy of shardingStrategies) {
    const mockShards = createMockShards(shardCount);
    
    const database = new ShardedDatabase({
      shards: mockShards,
      shardingStrategy: strategy,
      replicationFactor: 2,
      readConsistency: 'one',
      writeConsistency: 'all'
    });
    
    await database.connect();
    
    const result = await measureExecutionTime(
      async (i) => {
        return await database.query('SELECT * FROM test WHERE id = $1', [i], { routingKey: `key-${i}` });
      },
      BENCHMARK_CONFIG.iterations.medium
    );
    
    results.push({
      name: 'Confronto strategie di sharding',
      ...result,
      params: {
        shardCount,
        shardingStrategy: strategy
      }
    });
    
    await database.disconnect();
  }
  
  // Salva e stampa i risultati
  logResults('sharded-database', results);
  saveResults('sharded-database', results);
  
  return results;
}

// Benchmark dell'Optimized Merkle Tree
async function benchmarkOptimizedMerkleTree() {
  console.log('\n=== Benchmark dell\'Optimized Merkle Tree ===');
  
  // Inizializza il worker pool
  const workerPool = new WorkerThreadPool({
    minWorkers: 2,
    maxWorkers: 8,
    workerScript: path.join(__dirname, '../../offchain/worker-thread.js')
  });
  
  // Crea mock per la cache
  const mockCache = {
    get: async () => null,
    set: async () => true,
    has: async () => false,
    delete: async () => true,
    clear: async () => true,
    getStats: () => ({
      size: 0,
      hits: 0,
      misses: 0,
      hitRate: 0
    })
  };
  
  // Risultati del benchmark
  const results = [];
  
  // Test 1: Aggiunta di foglie con diverse dimensioni dell'albero
  for (const treeSize of BENCHMARK_CONFIG.merkleTreeSizes) {
    if (treeSize > 10000) continue; // Limita gli alberi più grandi per evitare test troppo lunghi
    
    const tree = new OptimizedMerkleTree({
      hashFunction: 'sha256',
      workerPool,
      cacheManager: mockCache,
      cacheIntermediateStates: true,
      enableParallelVerification: true
    });
    
    // Prepopola l'albero
    const initialLeaves = [];
    for (let i = 0; i < treeSize; i++) {
      initialLeaves.push(`leaf-${i}`);
    }
    
    await tree.addLeaves(initialLeaves);
    
    const result = await measureExecutionTime(
      async (i) => {
        return await tree.addLeaf(`new-leaf-${i}`);
      },
      BENCHMARK_CONFIG.iterations.small
    );
    
    results.push({
      name: 'Aggiunta di foglie',
      ...result,
      params: {
        treeSize,
        cacheEnabled: true,
        parallelVerification: true
      }
    });
    
    tree.reset();
  }
  
  // Test 2: Aggiornamento di foglie con diverse dimensioni dell'albero
  for (const treeSize of BENCHMARK_CONFIG.merkleTreeSizes) {
    if (treeSize > 10000) continue; // Limita gli alberi più grandi per evitare test troppo lunghi
    
    const tree = new OptimizedMerkleTree({
      hashFunction: 'sha256',
      workerPool,
      cacheManager: mockCache,
      cacheIntermediateStates: true,
      enableParallelVerification: true
    });
    
    // Prepopola l'albero
    const initialLeaves = [];
    for (let i = 0; i < treeSize; i++) {
      initialLeaves.push(`leaf-${i}`);
    }
    
    await tree.addLeaves(initialLeaves);
    
    const result = await measureExecutionTime(
      async (i) => {
        const index = i % treeSize;
        return await tree.updateLeaf(index, `updated-leaf-${index}-${i}`);
      },
      BENCHMARK_CONFIG.iterations.small
    );
    
    results.push({
      name: 'Aggiornamento di foglie',
      ...result,
      params: {
        treeSize,
        cacheEnabled: true,
        parallelVerification: true
      }
    });
    
    tree.reset();
  }
  
  // Test 3: Generazione e verifica di prove con diverse dimensioni dell'albero
  for (const treeSize of BENCHMARK_CONFIG.merkleTreeSizes) {
    if (treeSize > 10000) continue; // Limita gli alberi più grandi per evitare test troppo lunghi
    
    const tree = new OptimizedMerkleTree({
      hashFunction: 'sha256',
      workerPool,
      cacheManager: mockCache,
      cacheIntermediateStates: true,
      enableParallelVerification: true
    });
    
    // Prepopola l'albero
    const initialLeaves = [];
    for (let i = 0; i < treeSize; i++) {
      initialLeaves.push(`leaf-${i}`);
    }
    
    await tree.addLeaves(initialLeaves);
    
    // Benchmark della generazione di prove
    const generateResult = await measureExecutionTime(
      async (i) => {
        const index = i % treeSize;
        return await tree.generateProof(index);
      },
      BENCHMARK_CONFIG.iterations.small
    );
    
    results.push({
      name: 'Generazione di prove',
      ...generateResult,
      params: {
        treeSize,
        cacheEnabled: true
      }
    });
    
    // Genera una prova per il benchmark di verifica
    const proof = await tree.generateProof(0);
    
    // Benchmark della verifica di prove
    const verifyResult = await measureExecutionTime(
      async () => {
        return await tree.verifyProof(proof);
      },
      BENCHMARK_CONFIG.iterations.small
    );
    
    results.push({
      name: 'Verifica di prove',
      ...verifyResult,
      params: {
        treeSize,
        cacheEnabled: true,
        parallelVerification: true
      }
    });
    
    tree.reset();
  }
  
  // Test 4: Confronto tra verifica sequenziale e parallela
  const treeSize = 1000;
  
  // Albero con verifica sequenziale
  const sequentialTree = new OptimizedMerkleTree({
    hashFunction: 'sha256',
    workerPool,
    cacheManager: mockCache,
    cacheIntermediateStates: true,
    enableParallelVerification: false
  });
  
  // Prepopola l'albero
  const initialLeaves = [];
  for (let i = 0; i < treeSize; i++) {
    initialLeaves.push(`leaf-${i}`);
  }
  
  await sequentialTree.addLeaves(initialLeaves);
  
  // Genera una prova
  const proof = await sequentialTree.generateProof(0);
  
  // Benchmark della verifica sequenziale
  const sequentialResult = await measureExecutionTime(
    async () => {
      return await sequentialTree.verifyProof(proof);
    },
    BENCHMARK_CONFIG.iterations.small
  );
  
  results.push({
    name: 'Verifica sequenziale',
    ...sequentialResult,
    params: {
      treeSize,
      cacheEnabled: true,
      parallelVerification: false
    }
  });
  
  // Albero con verifica parallela
  const parallelTree = new OptimizedMerkleTree({
    hashFunction: 'sha256',
    workerPool,
    cacheManager: mockCache,
    cacheIntermediateStates: true,
    enableParallelVerification: true
  });
  
  await parallelTree.addLeaves(initialLeaves);
  
  // Benchmark della verifica parallela
  const parallelResult = await measureExecutionTime(
    async () => {
      return await parallelTree.verifyProof(proof);
    },
    BENCHMARK_CONFIG.iterations.small
  );
  
  results.push({
    name: 'Verifica parallela',
    ...parallelResult,
    params: {
      treeSize,
      cacheEnabled: true,
      parallelVerification: true
    }
  });
  
  // Test 5: Confronto tra albero con e senza cache
  // Albero senza cache
  const noCacheTree = new OptimizedMerkleTree({
    hashFunction: 'sha256',
    workerPool,
    cacheIntermediateStates: false,
    enableParallelVerification: true
  });
  
  await noCacheTree.addLeaves(initialLeaves);
  
  // Benchmark dell'aggiornamento senza cache
  const noCacheResult = await measureExecutionTime(
    async (i) => {
      const index = i % treeSize;
      return await noCacheTree.updateLeaf(index, `updated-leaf-${index}-${i}`);
    },
    BENCHMARK_CONFIG.iterations.small
  );
  
  results.push({
    name: 'Aggiornamento senza cache',
    ...noCacheResult,
    params: {
      treeSize,
      cacheEnabled: false,
      parallelVerification: true
    }
  });
  
  // Albero con cache
  const withCacheTree = new OptimizedMerkleTree({
    hashFunction: 'sha256',
    workerPool,
    cacheManager: mockCache,
    cacheIntermediateStates: true,
    enableParallelVerification: true
  });
  
  await withCacheTree.addLeaves(initialLeaves);
  
  // Benchmark dell'aggiornamento con cache
  const withCacheResult = await measureExecutionTime(
    async (i) => {
      const index = i % treeSize;
      return await withCacheTree.updateLeaf(index, `updated-leaf-${index}-${i}`);
    },
    BENCHMARK_CONFIG.iterations.small
  );
  
  results.push({
    name: 'Aggiornamento con cache',
    ...withCacheResult,
    params: {
      treeSize,
      cacheEnabled: true,
      parallelVerification: true
    }
  });
  
  // Termina il worker pool
  await workerPool.terminate();
  
  // Salva e stampa i risultati
  logResults('optimized-merkle-tree', results);
  saveResults('optimized-merkle-tree', results);
  
  return results;
}

// Benchmark del Multi-level Cache System
async function benchmarkMultiLevelCache() {
  console.log('\n=== Benchmark del Multi-level Cache System ===');
  
  // Risultati del benchmark
  const results = [];
  
  // Test 1: Confronto tra diverse dimensioni della cache
  for (const [sizeName, sizes] of Object.entries(BENCHMARK_CONFIG.cacheSizes)) {
    const cache = new MultiLevelCache({
      levels: [
        {
          name: 'L1',
          capacity: sizes.L1,
          ttl: 60000, // 1 minuto
          evictionPolicy: 'lru'
        },
        {
          name: 'L2',
          capacity: sizes.L2,
          ttl: 300000, // 5 minuti
          evictionPolicy: 'lru'
        }
      ],
      enablePrefetching: false,
      enableCompression: false
    });
    
    // Prepopola la cache L2 (ma non L1)
    for (let i = 0; i < sizes.L1 * 2; i++) {
      await cache.levels[1].set(`key-${i}`, { data: `value-${i}` });
    }
    
    // Benchmark dell'accesso alla cache (promozione da L2 a L1)
    const result = await measureExecutionTime(
      async (i) => {
        const key = `key-${i % (sizes.L1 * 2)}`;
        return await cache.get(key);
      },
      BENCHMARK_CONFIG.iterations.medium
    );
    
    results.push({
      name: 'Accesso alla cache',
      ...result,
      params: {
        cacheSize: sizeName,
        L1Size: sizes.L1,
        L2Size: sizes.L2,
        prefetching: false,
        compression: false
      }
    });
  }
  
  // Test 2: Confronto tra diverse politiche di evizione
  const evictionPolicies = ['lru', 'fifo'];
  
  for (const policy of evictionPolicies) {
    const cache = new MultiLevelCache({
      levels: [
        {
          name: 'L1',
          capacity: 1000,
          ttl: 60000, // 1 minuto
          evictionPolicy: policy
        },
        {
          name: 'L2',
          capacity: 10000,
          ttl: 300000, // 5 minuti
          evictionPolicy: policy
        }
      ],
      enablePrefetching: false,
      enableCompression: false
    });
    
    // Prepopola la cache
    for (let i = 0; i < 2000; i++) {
      await cache.set(`key-${i}`, { data: `value-${i}` });
    }
    
    // Benchmark dell'accesso alla cache con pattern LRU-friendly
    const lruResult = await measureExecutionTime(
      async (i) => {
        // Accedi più frequentemente alle chiavi recenti
        const key = `key-${1999 - (i % 100)}`;
        return await cache.get(key);
      },
      BENCHMARK_CONFIG.iterations.medium
    );
    
    results.push({
      name: 'Accesso LRU-friendly',
      ...lruResult,
      params: {
        evictionPolicy: policy
      }
    });
    
    // Benchmark dell'accesso alla cache con pattern FIFO-friendly
    const fifoResult = await measureExecutionTime(
      async (i) => {
        // Accedi sequenzialmente alle chiavi
        const key = `key-${i % 2000}`;
        return await cache.get(key);
      },
      BENCHMARK_CONFIG.iterations.medium
    );
    
    results.push({
      name: 'Accesso FIFO-friendly',
      ...fifoResult,
      params: {
        evictionPolicy: policy
      }
    });
  }
  
  // Test 3: Confronto tra cache con e senza prefetching
  const prefetchingOptions = [true, false];
  
  for (const enablePrefetching of prefetchingOptions) {
    const cache = new MultiLevelCache({
      levels: [
        {
          name: 'L1',
          capacity: 1000,
          ttl: 60000, // 1 minuto
          evictionPolicy: 'lru'
        },
        {
          name: 'L2',
          capacity: 10000,
          ttl: 300000, // 5 minuti
          evictionPolicy: 'lru'
        }
      ],
      enablePrefetching,
      enableCompression: false
    });
    
    // Prepopola la cache
    for (let i = 0; i < 2000; i++) {
      await cache.set(`key-${i}`, { data: `value-${i}` });
    }
    
    // Registra un pattern di accesso prevedibile
    if (enablePrefetching) {
      for (let i = 0; i < 100; i++) {
        // Simula un pattern di accesso dove key-A è sempre seguito da key-B
        cache.prefetcher.recordAccess(`key-A-${i}`);
        cache.prefetcher.recordAccess(`key-B-${i}`);
        
        // Imposta una probabilità alta
        if (!cache.prefetcher.accessPatterns.has(`key-A-${i}`)) {
          cache.prefetcher.accessPatterns.set(`key-A-${i}`, new Map());
        }
        cache.prefetcher.accessPatterns.get(`key-A-${i}`).set(`key-B-${i}`, 0.9);
      }
    }
    
    // Benchmark dell'accesso alla cache con pattern prevedibile
    const result = await measureExecutionTime(
      async (i) => {
        const j = i % 100;
        
        // Prima accedi a key-A, che dovrebbe attivare il prefetching di key-B
        await cache.get(`key-A-${j}`);
        
        // Poi accedi a key-B, che dovrebbe essere già in cache se il prefetching funziona
        return await cache.get(`key-B-${j}`);
      },
      BENCHMARK_CONFIG.iterations.medium
    );
    
    results.push({
      name: 'Accesso con pattern prevedibile',
      ...result,
      params: {
        prefetching: enablePrefetching
      }
    });
  }
  
  // Test 4: Confronto tra cache con e senza compressione
  const compressionOptions = [true, false];
  
  for (const enableCompression of compressionOptions) {
    const cache = new MultiLevelCache({
      levels: [
        {
          name: 'L1',
          capacity: 1000,
          ttl: 60000, // 1 minuto
          evictionPolicy: 'lru'
        },
        {
          name: 'L2',
          capacity: 10000,
          ttl: 300000, // 5 minuti
          evictionPolicy: 'lru'
        }
      ],
      enablePrefetching: false,
      enableCompression,
      compressionThreshold: 100 // Soglia bassa per attivare la compressione
    });
    
    // Benchmark dell'impostazione di valori grandi
    const setResult = await measureExecutionTime(
      async (i) => {
        const key = `key-${i}`;
        const value = { data: 'x'.repeat(1000) }; // Valore grande
        return await cache.set(key, value);
      },
      BENCHMARK_CONFIG.iterations.small
    );
    
    results.push({
      name: 'Impostazione di valori grandi',
      ...setResult,
      params: {
        compression: enableCompression
      }
    });
    
    // Prepopola la cache con valori grandi
    for (let i = 0; i < 100; i++) {
      await cache.set(`key-${i}`, { data: 'x'.repeat(1000) });
    }
    
    // Benchmark dell'accesso a valori grandi
    const getResult = await measureExecutionTime(
      async (i) => {
        const key = `key-${i % 100}`;
        return await cache.get(key);
      },
      BENCHMARK_CONFIG.iterations.medium
    );
    
    results.push({
      name: 'Accesso a valori grandi',
      ...getResult,
      params: {
        compression: enableCompression
      }
    });
  }
  
  // Salva e stampa i risultati
  logResults('multi-level-cache', results);
  saveResults('multi-level-cache', results);
  
  return results;
}

// Benchmark del Shared Ring Buffer
async function benchmarkSharedRingBuffer() {
  console.log('\n=== Benchmark del Shared Ring Buffer ===');
  
  // Risultati del benchmark
  const results = [];
  
  // Test 1: Confronto tra diverse dimensioni del buffer
  for (const bufferSize of BENCHMARK_CONFIG.ringBufferSizes) {
    const ringBuffer = new SharedRingBuffer({
      size: bufferSize,
      itemSize: 256,
      enableOverwrite: false
    });
    
    // Benchmark della scrittura
    const writeResult = await measureExecutionTime(
      (i) => {
        return ringBuffer.write({ id: i, data: `data-${i}` });
      },
      Math.min(BENCHMARK_CONFIG.iterations.medium, bufferSize)
    );
    
    results.push({
      name: 'Scrittura nel buffer',
      ...writeResult,
      params: {
        bufferSize,
        itemSize: 256,
        enableOverwrite: false
      }
    });
    
    // Prepopola il buffer
    for (let i = 0; i < Math.min(100, bufferSize); i++) {
      ringBuffer.write({ id: i, data: `data-${i}` });
    }
    
    // Benchmark della lettura
    const readResult = await measureExecutionTime(
      () => {
        return ringBuffer.read();
      },
      Math.min(BENCHMARK_CONFIG.iterations.medium, 100)
    );
    
    results.push({
      name: 'Lettura dal buffer',
      ...readResult,
      params: {
        bufferSize,
        itemSize: 256,
        enableOverwrite: false
      }
    });
  }
  
  // Test 2: Confronto tra buffer con e senza overwrite
  const overwriteOptions = [true, false];
  
  for (const enableOverwrite of overwriteOptions) {
    const ringBuffer = new SharedRingBuffer({
      size: 1000,
      itemSize: 256,
      enableOverwrite
    });
    
    // Prepopola il buffer fino al limite
    for (let i = 0; i < 1000; i++) {
      ringBuffer.write({ id: i, data: `data-${i}` });
    }
    
    // Benchmark della scrittura oltre il limite
    const result = await measureExecutionTime(
      (i) => {
        return ringBuffer.write({ id: 1000 + i, data: `data-${1000 + i}` });
      },
      BENCHMARK_CONFIG.iterations.small
    );
    
    results.push({
      name: 'Scrittura oltre il limite',
      ...result,
      params: {
        bufferSize: 1000,
        itemSize: 256,
        enableOverwrite
      }
    });
  }
  
  // Test 3: Confronto tra diverse dimensioni degli item
  const itemSizes = [64, 256, 1024, 4096];
  
  for (const itemSize of itemSizes) {
    const ringBuffer = new SharedRingBuffer({
      size: 1000,
      itemSize,
      enableOverwrite: false
    });
    
    // Crea un item di dimensione appropriata
    const createItem = (i) => {
      return {
        id: i,
        data: 'x'.repeat(Math.max(1, itemSize - 20)) // Approssimazione della dimensione
      };
    };
    
    // Benchmark della scrittura
    const writeResult = await measureExecutionTime(
      (i) => {
        return ringBuffer.write(createItem(i));
      },
      BENCHMARK_CONFIG.iterations.small
    );
    
    results.push({
      name: 'Scrittura con diverse dimensioni degli item',
      ...writeResult,
      params: {
        bufferSize: 1000,
        itemSize,
        enableOverwrite: false
      }
    });
    
    // Prepopola il buffer
    for (let i = 0; i < 100; i++) {
      ringBuffer.write(createItem(i));
    }
    
    // Benchmark della lettura
    const readResult = await measureExecutionTime(
      () => {
        return ringBuffer.read();
      },
      BENCHMARK_CONFIG.iterations.small
    );
    
    results.push({
      name: 'Lettura con diverse dimensioni degli item',
      ...readResult,
      params: {
        bufferSize: 1000,
        itemSize,
        enableOverwrite: false
      }
    });
  }
  
  // Test 4: Benchmark delle operazioni di peek
  const ringBuffer = new SharedRingBuffer({
    size: 1000,
    itemSize: 256,
    enableOverwrite: false
  });
  
  // Prepopola il buffer
  for (let i = 0; i < 1000; i++) {
    ringBuffer.write({ id: i, data: `data-${i}` });
  }
  
  // Benchmark di peek
  const peekResult = await measureExecutionTime(
    () => {
      return ringBuffer.peek();
    },
    BENCHMARK_CONFIG.iterations.large
  );
  
  results.push({
    name: 'Operazione peek',
    ...peekResult,
    params: {
      bufferSize: 1000,
      itemSize: 256
    }
  });
  
  // Benchmark di peekMultiple
  const peekMultipleResult = await measureExecutionTime(
    () => {
      return ringBuffer.peekMultiple(10);
    },
    BENCHMARK_CONFIG.iterations.medium
  );
  
  results.push({
    name: 'Operazione peekMultiple',
    ...peekMultipleResult,
    params: {
      bufferSize: 1000,
      itemSize: 256,
      count: 10
    }
  });
  
  // Salva e stampa i risultati
  logResults('shared-ring-buffer', results);
  saveResults('shared-ring-buffer', results);
  
  return results;
}

// Benchmark del Worker Thread Pool
async function benchmarkWorkerThreadPool() {
  console.log('\n=== Benchmark del Worker Thread Pool ===');
  
  // Risultati del benchmark
  const results = [];
  
  // Test 1: Confronto tra diverse dimensioni del pool
  for (const workerCount of BENCHMARK_CONFIG.workerCounts) {
    const pool = new WorkerThreadPool({
      minWorkers: workerCount,
      maxWorkers: workerCount,
      workerScript: path.join(__dirname, '../../offchain/worker-thread.js')
    });
    
    // Benchmark dell'esecuzione di task leggeri
    const lightTaskResult = await measureExecutionTime(
      async () => {
        return await pool.executeTask('echo', { message: 'Hello, World!' });
      },
      BENCHMARK_CONFIG.iterations.medium
    );
    
    results.push({
      name: 'Esecuzione di task leggeri',
      ...lightTaskResult,
      params: {
        workerCount
      }
    });
    
    // Benchmark dell'esecuzione di task pesanti
    const heavyTaskResult = await measureExecutionTime(
      async () => {
        return await pool.executeTask('compute', { iterations: 1000000 });
      },
      BENCHMARK_CONFIG.iterations.small
    );
    
    results.push({
      name: 'Esecuzione di task pesanti',
      ...heavyTaskResult,
      params: {
        workerCount
      }
    });
    
    // Termina il pool
    await pool.terminate();
  }
  
  // Test 2: Confronto tra esecuzione sequenziale e parallela
  const pool = new WorkerThreadPool({
    minWorkers: 4,
    maxWorkers: 4,
    workerScript: path.join(__dirname, '../../offchain/worker-thread.js')
  });
  
  // Crea task per l'esecuzione parallela
  const createTasks = (count) => {
    const tasks = [];
    for (let i = 0; i < count; i++) {
      tasks.push({
        type: 'compute',
        data: { iterations: 1000000 },
        options: {}
      });
    }
    return tasks;
  };
  
  // Benchmark dell'esecuzione sequenziale
  const sequentialResult = await measureExecutionTime(
    async () => {
      const tasks = createTasks(4);
      const results = [];
      
      for (const task of tasks) {
        results.push(await pool.executeTask(task.type, task.data, task.options));
      }
      
      return results;
    },
    BENCHMARK_CONFIG.iterations.small
  );
  
  results.push({
    name: 'Esecuzione sequenziale',
    ...sequentialResult,
    params: {
      workerCount: 4,
      taskCount: 4
    }
  });
  
  // Benchmark dell'esecuzione parallela
  const parallelResult = await measureExecutionTime(
    async () => {
      const tasks = createTasks(4);
      return await pool.executeParallel(tasks);
    },
    BENCHMARK_CONFIG.iterations.small
  );
  
  results.push({
    name: 'Esecuzione parallela',
    ...parallelResult,
    params: {
      workerCount: 4,
      taskCount: 4
    }
  });
  
  // Test 3: Scalabilità con diversi numeri di task
  const taskCounts = [1, 2, 4, 8, 16, 32];
  
  for (const taskCount of taskCounts) {
    const result = await measureExecutionTime(
      async () => {
        const tasks = createTasks(taskCount);
        return await pool.executeParallel(tasks);
      },
      Math.max(1, Math.floor(BENCHMARK_CONFIG.iterations.small / taskCount))
    );
    
    results.push({
      name: 'Scalabilità',
      ...result,
      params: {
        workerCount: 4,
        taskCount
      }
    });
  }
  
  // Test 4: Throughput massimo
  const maxTaskCount = 100;
  const tasks = createTasks(maxTaskCount);
  
  const throughputResult = await measureExecutionTime(
    async () => {
      return await pool.executeParallel(tasks);
    },
    1 // Esegui solo una volta per evitare test troppo lunghi
  );
  
  results.push({
    name: 'Throughput massimo',
    ...throughputResult,
    params: {
      workerCount: 4,
      taskCount: maxTaskCount,
      throughput: (maxTaskCount / (throughputResult.totalTime / 1000)).toFixed(2) + ' task/s'
    }
  });
  
  // Termina il pool
  await pool.terminate();
  
  // Salva e stampa i risultati
  logResults('worker-thread-pool', results);
  saveResults('worker-thread-pool', results);
  
  return results;
}

// Benchmark del Performance Metrics System
async function benchmarkPerformanceMetrics() {
  console.log('\n=== Benchmark del Performance Metrics System ===');
  
  // Risultati del benchmark
  const results = [];
  
  // Crea un'istanza del sistema di metriche
  const metrics = new PerformanceMetrics({
    collectInterval: 1000,
    aggregateInterval: 5000,
    alertCheckInterval: 2000,
    enableHistograms: true
  });
  
  // Registra alcune metriche
  metrics.registerMetrics({
    'test.counter': { type: 'counter', unit: 'count', description: 'Test counter' },
    'test.gauge': { type: 'gauge', unit: 'ms', description: 'Test gauge' },
    'test.histogram': { type: 'histogram', unit: 'ms', description: 'Test histogram' }
  });
  
  // Test 1: Benchmark della registrazione delle metriche
  const recordResult = await measureExecutionTime(
    async (i) => {
      await metrics.collector.recordMetric('test.counter', 1);
      await metrics.collector.recordMetric('test.gauge', i % 100);
      await metrics.collector.recordMetric('test.histogram', i % 100);
    },
    BENCHMARK_CONFIG.iterations.large
  );
  
  results.push({
    name: 'Registrazione delle metriche',
    ...recordResult,
    params: {
      metricCount: 3,
      enableHistograms: true
    }
  });
  
  // Test 2: Benchmark dell'aggregazione delle metriche
  // Prima registra molte metriche
  for (let i = 0; i < 1000; i++) {
    await metrics.collector.recordMetric('test.counter', 1);
    await metrics.collector.recordMetric('test.gauge', i % 100);
    await metrics.collector.recordMetric('test.histogram', i % 100);
  }
  
  const aggregateResult = await measureExecutionTime(
    async () => {
      await metrics.aggregateMetrics();
    },
    BENCHMARK_CONFIG.iterations.small
  );
  
  results.push({
    name: 'Aggregazione delle metriche',
    ...aggregateResult,
    params: {
      metricCount: 3,
      dataPointCount: 1000,
      enableHistograms: true
    }
  });
  
  // Test 3: Benchmark del controllo delle soglie di allerta
  // Aggiungi alcune regole di allerta
  metrics.addAlertRule({
    metric: 'test.gauge',
    threshold: 50,
    operator: '>',
    severity: 'warning'
  });
  
  metrics.addAlertRule({
    metric: 'test.gauge',
    threshold: 80,
    operator: '>',
    severity: 'critical'
  });
  
  metrics.addAlertRule({
    metric: 'test.histogram',
    threshold: 90,
    operator: '>',
    severity: 'warning'
  });
  
  const alertResult = await measureExecutionTime(
    async () => {
      await metrics.checkAlerts();
    },
    BENCHMARK_CONFIG.iterations.medium
  );
  
  results.push({
    name: 'Controllo delle soglie di allerta',
    ...alertResult,
    params: {
      ruleCount: 3
    }
  });
  
  // Test 4: Confronto tra istogrammi abilitati e disabilitati
  const histogramOptions = [true, false];
  
  for (const enableHistograms of histogramOptions) {
    const metricsSystem = new PerformanceMetrics({
      collectInterval: 1000,
      aggregateInterval: 5000,
      alertCheckInterval: 2000,
      enableHistograms
    });
    
    // Registra alcune metriche
    metricsSystem.registerMetrics({
      'test.counter': { type: 'counter', unit: 'count', description: 'Test counter' },
      'test.gauge': { type: 'gauge', unit: 'ms', description: 'Test gauge' },
      'test.histogram': { type: 'histogram', unit: 'ms', description: 'Test histogram' }
    });
    
    // Registra molte metriche
    for (let i = 0; i < 1000; i++) {
      await metricsSystem.collector.recordMetric('test.histogram', i % 100);
    }
    
    const result = await measureExecutionTime(
      async () => {
        await metricsSystem.aggregateMetrics();
      },
      BENCHMARK_CONFIG.iterations.small
    );
    
    results.push({
      name: 'Aggregazione con/senza istogrammi',
      ...result,
      params: {
        enableHistograms
      }
    });
  }
  
  // Salva e stampa i risultati
  logResults('performance-metrics', results);
  saveResults('performance-metrics', results);
  
  return results;
}

// Benchmark completo dell'architettura
async function benchmarkFullArchitecture() {
  console.log('\n=== Benchmark Completo dell\'Architettura ===');
  
  // Inizializza tutti i componenti
  const workerPool = new WorkerThreadPool({
    minWorkers: 4,
    maxWorkers: 8,
    workerScript: path.join(__dirname, '../../offchain/worker-thread.js')
  });
  
  const metrics = new PerformanceMetrics({
    collectInterval: 1000,
    aggregateInterval: 5000,
    alertCheckInterval: 2000,
    enableHistograms: true
  });
  
  // Registra le metriche di base
  metrics.registerMetrics({
    'sequencer.transactions': { type: 'counter', unit: 'count', description: 'Numero di transazioni elaborate' },
    'sequencer.latency': { type: 'gauge', unit: 'ms', description: 'Latenza di elaborazione delle transazioni' },
    'merkle.updates': { type: 'counter', unit: 'count', description: 'Numero di aggiornamenti dell\'albero' },
    'merkle.latency': { type: 'gauge', unit: 'ms', description: 'Latenza di aggiornamento dell\'albero' },
    'cache.hits': { type: 'counter', unit: 'count', description: 'Numero di hit della cache' },
    'cache.misses': { type: 'counter', unit: 'count', description: 'Numero di miss della cache' }
  });
  
  const ringBuffer = new SharedRingBuffer({
    size: 1024,
    itemSize: 256,
    enableOverwrite: false
  });
  
  const cache = new MultiLevelCache({
    levels: [
      {
        name: 'L1',
        capacity: 1000,
        ttl: 60000, // 1 minuto
        evictionPolicy: 'lru'
      },
      {
        name: 'L2',
        capacity: 10000,
        ttl: 300000, // 5 minuti
        evictionPolicy: 'lru'
      }
    ],
    enablePrefetching: true,
    enableCompression: true,
    compressionThreshold: 1024,
    defaultTTL: 3600000 // 1 ora
  });
  
  const merkleTree = new OptimizedMerkleTree({
    hashFunction: 'sha256',
    workerPool,
    cacheManager: cache,
    cacheIntermediateStates: true,
    enableParallelVerification: true,
    batchSize: 10
  });
  
  // Crea mock per il database
  const mockShards = [];
  for (let i = 0; i < 4; i++) {
    mockShards.push({
      id: `shard-${i}`,
      connect: async () => {},
      disconnect: async () => {},
      query: async () => ({ rows: [{ id: i, value: `test-${i}` }] }),
      execute: async () => ({ rowCount: 1 }),
      transaction: async (callback) => {
        return await callback({
          query: async () => ({ rows: [{ id: i, value: `test-${i}` }] }),
          execute: async () => ({ rowCount: 1 })
        });
      },
      isConnected: () => true,
      getStats: () => ({
        id: `shard-${i}`,
        connectionPool: { total: 10, active: 2, idle: 8 },
        queries: { total: 100, active: 1 },
        performance: { avgQueryTime: 5 }
      })
    });
  }
  
  const database = new ShardedDatabase({
    shards: mockShards,
    shardingStrategy: 'consistent-hash',
    replicationFactor: 2,
    readConsistency: 'one',
    writeConsistency: 'all'
  });
  
  const sequencer = new ParallelSequencer({
    workerPool,
    database,
    merkleTree,
    cache,
    ringBuffer,
    metrics,
    maxBatchSize: 100,
    maxParallelTasks: 8,
    enableBackpressure: true
  });
  
  // Avvia tutti i componenti
  await Promise.all([
    workerPool.start(),
    metrics.start(),
    database.connect(),
    sequencer.start()
  ]);
  
  // Risultati del benchmark
  const results = [];
  
  // Test 1: Throughput con diverse dimensioni di batch
  for (const batchSize of BENCHMARK_CONFIG.batchSizes) {
    if (batchSize > 100) continue; // Limita i batch più grandi per evitare test troppo lunghi
    
    // Genera un batch di transazioni
    const transactions = generateRandomTransactions(batchSize);
    
    const result = await measureExecutionTime(
      async () => {
        return await sequencer.processBatch(transactions);
      },
      Math.max(1, Math.floor(BENCHMARK_CONFIG.iterations.small / batchSize))
    );
    
    const throughput = (batchSize / (result.avgTime / 1000)).toFixed(2);
    
    results.push({
      name: 'Throughput con diverse dimensioni di batch',
      ...result,
      params: {
        batchSize,
        throughput: `${throughput} tx/s`
      }
    });
  }
  
  // Test 2: Latenza con diverse dimensioni di batch
  for (const batchSize of BENCHMARK_CONFIG.batchSizes) {
    if (batchSize > 100) continue; // Limita i batch più grandi per evitare test troppo lunghi
    
    // Genera un batch di transazioni
    const transactions = generateRandomTransactions(batchSize);
    
    const result = await measureExecutionTime(
      async () => {
        return await sequencer.processBatch(transactions);
      },
      Math.max(1, Math.floor(BENCHMARK_CONFIG.iterations.small / batchSize))
    );
    
    results.push({
      name: 'Latenza con diverse dimensioni di batch',
      ...result,
      params: {
        batchSize,
        avgLatency: `${result.avgTime.toFixed(2)} ms`
      }
    });
  }
  
  // Test 3: Stress test con carico elevato
  const stressTestBatchSize = 100;
  const stressTestIterations = 10;
  
  // Genera un grande batch di transazioni
  const largeBatch = generateRandomTransactions(stressTestBatchSize);
  
  const stressResult = await measureExecutionTime(
    async () => {
      return await sequencer.processBatch(largeBatch);
    },
    stressTestIterations
  );
  
  const throughput = (stressTestBatchSize / (stressResult.avgTime / 1000)).toFixed(2);
  
  results.push({
    name: 'Stress test',
    ...stressResult,
    params: {
      batchSize: stressTestBatchSize,
      iterations: stressTestIterations,
      throughput: `${throughput} tx/s`
    }
  });
  
  // Test 4: Test di resilienza con errori simulati
  // Simula un errore nel database
  const originalExecute = database.execute;
  database.execute = async () => {
    // Simula un errore casuale nel 50% dei casi
    if (Math.random() < 0.5) {
      throw new Error('Database error');
    }
    return { rowCount: 1 };
  };
  
  const resilienceResult = await measureExecutionTime(
    async () => {
      try {
        const tx = {
          id: `tx-${Math.random()}`,
          sender: `wallet-${Math.random()}`,
          recipient: `wallet-${Math.random()}`,
          amount: Math.random() * 1000,
          timestamp: Date.now()
        };
        
        return await sequencer.processTransaction(tx);
      } catch (error) {
        // Ignora gli errori per il benchmark
        return { success: false, error: error.message };
      }
    },
    BENCHMARK_CONFIG.iterations.small
  );
  
  // Ripristina la funzione originale
  database.execute = originalExecute;
  
  results.push({
    name: 'Test di resilienza',
    ...resilienceResult,
    params: {
      errorRate: '50%'
    }
  });
  
  // Arresta tutti i componenti
  await Promise.all([
    sequencer.stop(),
    database.disconnect(),
    metrics.stop(),
    workerPool.terminate()
  ]);
  
  // Salva e stampa i risultati
  logResults('full-architecture', results);
  saveResults('full-architecture', results);
  
  return results;
}

// Funzione principale per eseguire tutti i benchmark
async function runAllBenchmarks() {
  console.log('=== Esecuzione di tutti i benchmark ===');
  
  // Crea la directory per i risultati se non esiste
  if (BENCHMARK_CONFIG.saveResults && !fs.existsSync(BENCHMARK_CONFIG.resultsPath)) {
    fs.mkdirSync(BENCHMARK_CONFIG.resultsPath, { recursive: true });
  }
  
  // Esegui tutti i benchmark
  const results = {
    parallelSequencer: await benchmarkParallelSequencer(),
    shardedDatabase: await benchmarkShardedDatabase(),
    optimizedMerkleTree: await benchmarkOptimizedMerkleTree(),
    multiLevelCache: await benchmarkMultiLevelCache(),
    sharedRingBuffer: await benchmarkSharedRingBuffer(),
    workerThreadPool: await benchmarkWorkerThreadPool(),
    performanceMetrics: await benchmarkPerformanceMetrics(),
    fullArchitecture: await benchmarkFullArchitecture()
  };
  
  // Salva i risultati completi
  if (BENCHMARK_CONFIG.saveResults) {
    const filePath = path.join(BENCHMARK_CONFIG.resultsPath, `all-benchmarks-${Date.now()}.json`);
    fs.writeFileSync(filePath, JSON.stringify(results, null, 2));
    
    if (BENCHMARK_CONFIG.logResults) {
      console.log(`\nTutti i risultati dei benchmark sono stati salvati in: ${filePath}`);
    }
  }
  
  console.log('\n=== Benchmark completati ===');
}

// Esporta le funzioni
module.exports = {
  benchmarkParallelSequencer,
  benchmarkShardedDatabase,
  benchmarkOptimizedMerkleTree,
  benchmarkMultiLevelCache,
  benchmarkSharedRingBuffer,
  benchmarkWorkerThreadPool,
  benchmarkPerformanceMetrics,
  benchmarkFullArchitecture,
  runAllBenchmarks
};

// Se eseguito direttamente, esegui tutti i benchmark
if (require.main === module) {
  runAllBenchmarks().catch(console.error);
}
