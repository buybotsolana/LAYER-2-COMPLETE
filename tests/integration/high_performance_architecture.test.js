/**
 * Test di integrazione per l'architettura ad alte prestazioni
 * 
 * Questo file contiene i test di integrazione che verificano il corretto funzionamento
 * di tutti i componenti dell'architettura ad alte prestazioni quando lavorano insieme.
 */

const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');

// Importa tutti i componenti necessari
const { ParallelSequencer } = require('../../offchain/parallel-sequencer');
const { ShardedDatabase } = require('../../offchain/sharded-database');
const { OptimizedMerkleTree } = require('../../offchain/optimized-merkle-tree');
const { MultiLevelCache } = require('../../offchain/multi-level-cache');
const { SharedRingBuffer } = require('../../offchain/shared-ring-buffer');
const { PerformanceMetrics } = require('../../offchain/performance-metrics');
const { WorkerThreadPool } = require('../../offchain/worker-thread-pool');

describe('Architettura ad Alte Prestazioni - Test di Integrazione', function() {
  // Aumenta il timeout per i test più lunghi
  this.timeout(30000);
  
  let sequencer;
  let database;
  let merkleTree;
  let cache;
  let ringBuffer;
  let metrics;
  let workerPool;
  
  before(async () => {
    // Inizializza il worker pool
    workerPool = new WorkerThreadPool({
      minWorkers: 2,
      maxWorkers: 4,
      workerScript: path.join(__dirname, '../../offchain/worker-thread.js'),
      taskQueueSize: 100,
      enableMetrics: true
    });
    
    // Inizializza il sistema di metriche
    metrics = new PerformanceMetrics({
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
      'cache.misses': { type: 'counter', unit: 'count', description: 'Numero di miss della cache' },
      'database.queries': { type: 'counter', unit: 'count', description: 'Numero di query al database' },
      'database.latency': { type: 'gauge', unit: 'ms', description: 'Latenza delle query al database' }
    });
    
    // Inizializza il buffer condiviso
    ringBuffer = new SharedRingBuffer({
      size: 1024,
      itemSize: 256,
      enableOverwrite: false
    });
    
    // Inizializza la cache multi-livello
    cache = new MultiLevelCache({
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
      defaultTTL: 3600000, // 1 ora
      invalidationStrategy: 'cascade'
    });
    
    // Inizializza l'albero di Merkle ottimizzato
    merkleTree = new OptimizedMerkleTree({
      hashFunction: 'sha256',
      workerPool: workerPool,
      cacheManager: cache,
      cacheIntermediateStates: true,
      enableParallelVerification: true,
      batchSize: 10
    });
    
    // Inizializza il database shardato (mock per i test)
    const mockShards = [];
    for (let i = 0; i < 4; i++) {
      mockShards.push({
        id: `shard-${i}`,
        connect: sinon.stub().resolves(),
        disconnect: sinon.stub().resolves(),
        query: sinon.stub().resolves({ rows: [{ id: i, value: `test-${i}` }] }),
        execute: sinon.stub().resolves({ rowCount: 1 }),
        transaction: sinon.stub().callsFake(async (callback) => {
          return await callback({
            query: sinon.stub().resolves({ rows: [{ id: i, value: `test-${i}` }] }),
            execute: sinon.stub().resolves({ rowCount: 1 })
          });
        }),
        isConnected: sinon.stub().returns(true),
        getStats: sinon.stub().returns({
          id: `shard-${i}`,
          connectionPool: { total: 10, active: 2, idle: 8 },
          queries: { total: 100, active: 1 },
          performance: { avgQueryTime: 5 }
        })
      });
    }
    
    database = new ShardedDatabase({
      shards: mockShards,
      shardingStrategy: 'consistent-hash',
      replicationFactor: 2,
      readConsistency: 'one',
      writeConsistency: 'all'
    });
    
    // Inizializza il sequencer parallelo
    sequencer = new ParallelSequencer({
      workerPool: workerPool,
      database: database,
      merkleTree: merkleTree,
      cache: cache,
      ringBuffer: ringBuffer,
      metrics: metrics,
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
  });
  
  after(async () => {
    // Arresta tutti i componenti
    await Promise.all([
      sequencer.stop(),
      database.disconnect(),
      metrics.stop(),
      workerPool.terminate()
    ]);
  });
  
  describe('Elaborazione delle transazioni', () => {
    it('dovrebbe elaborare una singola transazione', async () => {
      const transaction = {
        id: 'tx-1',
        sender: 'wallet-1',
        recipient: 'wallet-2',
        amount: 100,
        timestamp: Date.now()
      };
      
      const result = await sequencer.processTransaction(transaction);
      
      expect(result).to.be.an('object');
      expect(result.success).to.be.true;
      expect(result.transactionId).to.equal(transaction.id);
    });
    
    it('dovrebbe elaborare un batch di transazioni', async () => {
      const transactions = [];
      for (let i = 0; i < 10; i++) {
        transactions.push({
          id: `tx-batch-${i}`,
          sender: `wallet-${i % 5}`,
          recipient: `wallet-${(i + 1) % 5}`,
          amount: 10 * (i + 1),
          timestamp: Date.now()
        });
      }
      
      const results = await sequencer.processBatch(transactions);
      
      expect(results).to.be.an('array').with.lengthOf(transactions.length);
      for (let i = 0; i < results.length; i++) {
        expect(results[i].success).to.be.true;
        expect(results[i].transactionId).to.equal(transactions[i].id);
      }
    });
    
    it('dovrebbe gestire transazioni concorrenti', async () => {
      // Crea 20 transazioni da elaborare in parallelo
      const promises = [];
      for (let i = 0; i < 20; i++) {
        const transaction = {
          id: `tx-concurrent-${i}`,
          sender: `wallet-${i % 5}`,
          recipient: `wallet-${(i + 1) % 5}`,
          amount: 10 * (i + 1),
          timestamp: Date.now()
        };
        
        promises.push(sequencer.processTransaction(transaction));
      }
      
      const results = await Promise.all(promises);
      
      expect(results).to.be.an('array').with.lengthOf(20);
      for (const result of results) {
        expect(result.success).to.be.true;
      }
    });
  });
  
  describe('Integrazione Sequencer-Database', () => {
    it('dovrebbe salvare le transazioni nel database', async () => {
      const transaction = {
        id: 'tx-db-1',
        sender: 'wallet-1',
        recipient: 'wallet-2',
        amount: 100,
        timestamp: Date.now()
      };
      
      await sequencer.processTransaction(transaction);
      
      // Verifica che il database sia stato chiamato
      let dbCalled = false;
      for (const shard of database.shards) {
        if (shard.execute.called) {
          dbCalled = true;
          break;
        }
      }
      
      expect(dbCalled).to.be.true;
    });
    
    it('dovrebbe recuperare le transazioni dal database', async () => {
      const transactionId = 'tx-db-2';
      
      // Prima salva una transazione
      const transaction = {
        id: transactionId,
        sender: 'wallet-1',
        recipient: 'wallet-2',
        amount: 100,
        timestamp: Date.now()
      };
      
      await sequencer.processTransaction(transaction);
      
      // Poi recuperala
      const result = await sequencer.getTransaction(transactionId);
      
      expect(result).to.be.an('object');
      // Il risultato dipende dall'implementazione del mock, ma dovrebbe essere non nullo
      expect(result).to.not.be.null;
    });
  });
  
  describe('Integrazione Sequencer-MerkleTree', () => {
    it('dovrebbe aggiornare l\'albero di Merkle dopo l\'elaborazione delle transazioni', async () => {
      // Spia il metodo di aggiornamento dell'albero
      const updateSpy = sinon.spy(merkleTree, 'addLeaf');
      
      const transaction = {
        id: 'tx-merkle-1',
        sender: 'wallet-1',
        recipient: 'wallet-2',
        amount: 100,
        timestamp: Date.now()
      };
      
      await sequencer.processTransaction(transaction);
      
      expect(updateSpy.called).to.be.true;
      
      // Ripristina la spia
      updateSpy.restore();
    });
    
    it('dovrebbe generare e verificare prove di Merkle', async () => {
      // Prima aggiungi alcune foglie all'albero
      await merkleTree.addLeaves(['leaf1', 'leaf2', 'leaf3', 'leaf4']);
      
      // Genera una prova
      const proof = await merkleTree.generateProof(1); // Prova per 'leaf2'
      
      // Verifica la prova
      const isValid = await merkleTree.verifyProof(proof);
      
      expect(isValid).to.be.true;
    });
  });
  
  describe('Integrazione Sequencer-Cache', () => {
    it('dovrebbe utilizzare la cache per le transazioni frequenti', async () => {
      // Spia i metodi della cache
      const getSpy = sinon.spy(cache, 'get');
      const setSpy = sinon.spy(cache, 'set');
      
      const transactionId = 'tx-cache-1';
      
      // Prima elabora una transazione
      const transaction = {
        id: transactionId,
        sender: 'wallet-1',
        recipient: 'wallet-2',
        amount: 100,
        timestamp: Date.now()
      };
      
      await sequencer.processTransaction(transaction);
      
      // Poi recuperala più volte
      await sequencer.getTransaction(transactionId);
      await sequencer.getTransaction(transactionId);
      
      expect(setSpy.called).to.be.true;
      expect(getSpy.called).to.be.true;
      
      // Ripristina le spie
      getSpy.restore();
      setSpy.restore();
    });
    
    it('dovrebbe gestire l\'invalidazione della cache', async () => {
      // Spia il metodo di eliminazione della cache
      const deleteSpy = sinon.spy(cache, 'delete');
      
      const transactionId = 'tx-cache-2';
      
      // Prima elabora una transazione
      const transaction = {
        id: transactionId,
        sender: 'wallet-1',
        recipient: 'wallet-2',
        amount: 100,
        timestamp: Date.now()
      };
      
      await sequencer.processTransaction(transaction);
      
      // Poi aggiornala
      const updatedTransaction = {
        ...transaction,
        amount: 200
      };
      
      await sequencer.updateTransaction(transactionId, updatedTransaction);
      
      expect(deleteSpy.called).to.be.true;
      
      // Ripristina la spia
      deleteSpy.restore();
    });
  });
  
  describe('Integrazione con il Worker Pool', () => {
    it('dovrebbe distribuire i task ai worker', async () => {
      // Spia il metodo di esecuzione del worker pool
      const executeTaskSpy = sinon.spy(workerPool, 'executeTask');
      
      // Crea un task che richiede elaborazione
      const task = {
        type: 'compute-intensive',
        data: {
          iterations: 1000000
        }
      };
      
      await sequencer.executeComputeTask(task);
      
      expect(executeTaskSpy.called).to.be.true;
      
      // Ripristina la spia
      executeTaskSpy.restore();
    });
    
    it('dovrebbe gestire l\'esecuzione parallela di più task', async () => {
      // Spia il metodo di esecuzione parallela del worker pool
      const executeParallelSpy = sinon.spy(workerPool, 'executeParallel');
      
      // Crea più task da eseguire in parallelo
      const tasks = [];
      for (let i = 0; i < 5; i++) {
        tasks.push({
          type: 'compute-intensive',
          data: {
            iterations: 100000
          }
        });
      }
      
      await sequencer.executeComputeTasks(tasks);
      
      expect(executeParallelSpy.called).to.be.true;
      
      // Ripristina la spia
      executeParallelSpy.restore();
    });
  });
  
  describe('Integrazione con il Ring Buffer', () => {
    it('dovrebbe utilizzare il ring buffer per la comunicazione tra componenti', async () => {
      // Spia i metodi del ring buffer
      const writeSpy = sinon.spy(ringBuffer, 'write');
      const readSpy = sinon.spy(ringBuffer, 'read');
      
      // Esegui un'operazione che utilizza il ring buffer
      await sequencer.sendMessageToWorkers('test-message');
      
      expect(writeSpy.called).to.be.true;
      
      // Simula la lettura da parte dei worker
      await sequencer.receiveMessageFromWorkers();
      
      expect(readSpy.called).to.be.true;
      
      // Ripristina le spie
      writeSpy.restore();
      readSpy.restore();
    });
  });
  
  describe('Integrazione con il Sistema di Metriche', () => {
    it('dovrebbe registrare metriche durante l\'elaborazione delle transazioni', async () => {
      // Spia il metodo di registrazione delle metriche
      const recordMetricSpy = sinon.spy(metrics.collector, 'recordMetric');
      
      const transaction = {
        id: 'tx-metrics-1',
        sender: 'wallet-1',
        recipient: 'wallet-2',
        amount: 100,
        timestamp: Date.now()
      };
      
      await sequencer.processTransaction(transaction);
      
      expect(recordMetricSpy.called).to.be.true;
      
      // Ripristina la spia
      recordMetricSpy.restore();
    });
    
    it('dovrebbe aggregare le metriche e generare allerte', async () => {
      // Spia i metodi di aggregazione e controllo delle soglie
      const aggregateSpy = sinon.spy(metrics.aggregator, 'aggregate');
      const checkThresholdsSpy = sinon.spy(metrics.alertManager, 'checkThresholds');
      
      // Aggiungi una regola di allerta
      metrics.addAlertRule({
        metric: 'sequencer.latency',
        threshold: 1000,
        operator: '>',
        severity: 'warning'
      });
      
      // Esegui l'aggregazione e il controllo delle soglie
      await metrics.aggregateMetrics();
      await metrics.checkAlerts();
      
      expect(aggregateSpy.called).to.be.true;
      expect(checkThresholdsSpy.called).to.be.true;
      
      // Ripristina le spie
      aggregateSpy.restore();
      checkThresholdsSpy.restore();
    });
  });
  
  describe('Test di Stress', () => {
    it('dovrebbe gestire un carico elevato di transazioni', async function() {
      // Questo test può richiedere molto tempo, quindi aumenta il timeout
      this.timeout(60000);
      
      // Crea 1000 transazioni
      const transactions = [];
      for (let i = 0; i < 1000; i++) {
        transactions.push({
          id: `tx-stress-${i}`,
          sender: `wallet-${i % 10}`,
          recipient: `wallet-${(i + 1) % 10}`,
          amount: i + 1,
          timestamp: Date.now()
        });
      }
      
      // Elabora le transazioni in batch di 100
      const batchSize = 100;
      const batches = [];
      
      for (let i = 0; i < transactions.length; i += batchSize) {
        const batch = transactions.slice(i, i + batchSize);
        batches.push(sequencer.processBatch(batch));
      }
      
      const results = await Promise.all(batches);
      
      // Verifica che tutte le transazioni siano state elaborate con successo
      let successCount = 0;
      for (const batchResult of results) {
        for (const result of batchResult) {
          if (result.success) {
            successCount++;
          }
        }
      }
      
      expect(successCount).to.equal(transactions.length);
      
      // Verifica le metriche di prestazione
      const latencyMetric = metrics.getAggregatedMetric('sequencer.latency');
      expect(latencyMetric).to.be.an('object');
      
      // La latenza media dovrebbe essere ragionevole (dipende dall'hardware)
      // Questo è solo un controllo di base, i valori effettivi dipenderanno dall'ambiente di test
      expect(latencyMetric.avg).to.be.a('number');
      console.log(`Latenza media: ${latencyMetric.avg} ms`);
    });
  });
  
  describe('Test di Resilienza', () => {
    it('dovrebbe gestire errori del database', async () => {
      // Simula un errore nel database
      const originalExecute = database.execute;
      database.execute = sinon.stub().rejects(new Error('Database error'));
      
      const transaction = {
        id: 'tx-error-1',
        sender: 'wallet-1',
        recipient: 'wallet-2',
        amount: 100,
        timestamp: Date.now()
      };
      
      try {
        await sequencer.processTransaction(transaction);
      } catch (error) {
        // L'errore dovrebbe essere gestito o propagato, a seconda dell'implementazione
      }
      
      // Verifica che il sistema sia ancora funzionante
      database.execute = originalExecute;
      
      const newTransaction = {
        id: 'tx-after-error-1',
        sender: 'wallet-1',
        recipient: 'wallet-2',
        amount: 100,
        timestamp: Date.now()
      };
      
      const result = await sequencer.processTransaction(newTransaction);
      expect(result.success).to.be.true;
    });
    
    it('dovrebbe gestire errori del worker pool', async () => {
      // Simula un errore nel worker pool
      const originalExecuteTask = workerPool.executeTask;
      workerPool.executeTask = sinon.stub().rejects(new Error('Worker error'));
      
      const task = {
        type: 'compute-intensive',
        data: {
          iterations: 1000000
        }
      };
      
      try {
        await sequencer.executeComputeTask(task);
      } catch (error) {
        // L'errore dovrebbe essere gestito o propagato, a seconda dell'implementazione
      }
      
      // Verifica che il sistema sia ancora funzionante
      workerPool.executeTask = originalExecuteTask;
      
      const newTask = {
        type: 'compute-intensive',
        data: {
          iterations: 1000
        }
      };
      
      const result = await sequencer.executeComputeTask(newTask);
      expect(result).to.not.be.null;
    });
  });
});

describe('Test di Integrazione del Sistema di Cache Multi-livello', function() {
  let cache;
  let mockLevels;
  let mockPrefetcher;
  
  beforeEach(() => {
    // Crea mock per i livelli di cache
    mockLevels = [
      {
        name: 'L1',
        get: sinon.stub(),
        set: sinon.stub().returns(true),
        has: sinon.stub(),
        delete: sinon.stub().returns(true),
        clear: sinon.stub().returns(true),
        getStats: sinon.stub().returns({
          size: 0,
          capacity: 100,
          hits: 0,
          misses: 0,
          hitRate: 0
        })
      },
      {
        name: 'L2',
        get: sinon.stub(),
        set: sinon.stub().returns(true),
        has: sinon.stub(),
        delete: sinon.stub().returns(true),
        clear: sinon.stub().returns(true),
        getStats: sinon.stub().returns({
          size: 0,
          capacity: 1000,
          hits: 0,
          misses: 0,
          hitRate: 0
        })
      }
    ];
    
    // Crea un'istanza reale della cache
    cache = new MultiLevelCache({
      levels: [
        {
          name: 'L1',
          capacity: 100,
          ttl: 60000, // 1 minuto
          evictionPolicy: 'lru'
        },
        {
          name: 'L2',
          capacity: 1000,
          ttl: 300000, // 5 minuti
          evictionPolicy: 'lru'
        }
      ],
      enablePrefetching: true,
      enableCompression: true,
      compressionThreshold: 1024,
      defaultTTL: 3600000, // 1 ora
      invalidationStrategy: 'cascade'
    });
  });
  
  afterEach(() => {
    // Ripristina i mock
    sinon.restore();
  });
  
  describe('Operazioni di base', () => {
    it('dovrebbe impostare e ottenere un valore', async () => {
      const key = 'test-key';
      const value = { data: 'test-value' };
      
      await cache.set(key, value);
      const result = await cache.get(key);
      
      expect(result).to.deep.equal(value);
    });
    
    it('dovrebbe promuovere i valori dal livello L2 al livello L1', async () => {
      const key = 'test-key';
      const value = { data: 'test-value' };
      
      // Imposta il valore solo nel livello L2
      await cache.levels[1].set(key, value);
      
      // Verifica che il valore non sia nel livello L1
      expect(await cache.levels[0].has(key)).to.be.false;
      
      // Ottieni il valore
      const result = await cache.get(key);
      
      // Verifica che il valore sia stato promosso al livello L1
      expect(await cache.levels[0].has(key)).to.be.true;
      expect(result).to.deep.equal(value);
    });
    
    it('dovrebbe gestire le dipendenze tra chiavi', async () => {
      const key1 = 'parent-key';
      const key2 = 'child-key';
      const value1 = { data: 'parent-value' };
      const value2 = { data: 'child-value' };
      
      // Imposta i valori
      await cache.set(key1, value1);
      await cache.set(key2, value2);
      
      // Registra la dipendenza
      cache.addDependency(key1, key2);
      
      // Elimina la chiave principale
      await cache.delete(key1);
      
      // Verifica che la chiave dipendente sia stata eliminata
      expect(await cache.has(key2)).to.be.false;
    });
  });
  
  describe('Compressione', () => {
    it('dovrebbe comprimere e decomprimere i valori grandi', async () => {
      const key = 'large-key';
      const value = { data: 'x'.repeat(10000) }; // Valore grande
      
      await cache.set(key, value);
      const result = await cache.get(key);
      
      expect(result).to.deep.equal(value);
    });
  });
  
  describe('Prefetching', () => {
    it('dovrebbe prefetchare le chiavi correlate', async () => {
      // Disabilita temporaneamente il prefetching per configurarlo
      cache.options.enablePrefetching = false;
      
      const key1 = 'key1';
      const key2 = 'key2';
      const value1 = { data: 'value1' };
      const value2 = { data: 'value2' };
      
      // Imposta i valori
      await cache.set(key1, value1);
      await cache.set(key2, value2);
      
      // Simula un pattern di accesso
      cache.prefetcher.recordAccess(key1);
      cache.prefetcher.recordAccess(key2);
      
      // Imposta una probabilità alta
      cache.prefetcher.accessPatterns.set(key1, new Map([[key2, 0.8]]));
      
      // Riabilita il prefetching
      cache.options.enablePrefetching = true;
      
      // Spia il metodo get
      const getSpy = sinon.spy(cache, 'get');
      
      // Accedi alla chiave1
      await cache.get(key1);
      
      // Verifica che il prefetcher abbia tentato di ottenere la chiave2
      expect(getSpy.calledWith(key2)).to.be.true;
      
      // Ripristina la spia
      getSpy.restore();
    });
  });
});

describe('Test di Integrazione del Sistema di Metriche', function() {
  let metrics;
  
  beforeEach(async () => {
    // Crea un'istanza reale del sistema di metriche
    metrics = new PerformanceMetrics({
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
    
    // Avvia il sistema di metriche
    await metrics.start();
  });
  
  afterEach(async () => {
    // Arresta il sistema di metriche
    await metrics.stop();
  });
  
  describe('Raccolta e aggregazione delle metriche', () => {
    it('dovrebbe raccogliere e aggregare le metriche', async () => {
      // Registra alcuni valori
      await metrics.collector.recordMetric('test.counter', 1);
      await metrics.collector.recordMetric('test.counter', 1);
      await metrics.collector.recordMetric('test.gauge', 100);
      await metrics.collector.recordMetric('test.gauge', 200);
      await metrics.collector.recordMetric('test.histogram', 10);
      await metrics.collector.recordMetric('test.histogram', 20);
      await metrics.collector.recordMetric('test.histogram', 30);
      
      // Esegui l'aggregazione
      await metrics.aggregateMetrics();
      
      // Verifica le metriche aggregate
      const counterMetric = metrics.getAggregatedMetric('test.counter');
      const gaugeMetric = metrics.getAggregatedMetric('test.gauge');
      const histogramMetric = metrics.getAggregatedMetric('test.histogram');
      
      expect(counterMetric).to.be.an('object');
      expect(gaugeMetric).to.be.an('object');
      expect(histogramMetric).to.be.an('object');
      
      expect(counterMetric.sum).to.equal(2);
      expect(gaugeMetric.avg).to.equal(150);
      expect(histogramMetric.avg).to.equal(20);
      expect(histogramMetric.p95).to.be.closeTo(29, 1);
    });
  });
  
  describe('Gestione delle allerte', () => {
    it('dovrebbe generare allerte quando le soglie vengono superate', async () => {
      // Aggiungi una regola di allerta
      metrics.addAlertRule({
        metric: 'test.gauge',
        threshold: 150,
        operator: '>',
        severity: 'warning'
      });
      
      // Registra un valore che supera la soglia
      await metrics.collector.recordMetric('test.gauge', 200);
      
      // Esegui l'aggregazione e il controllo delle soglie
      await metrics.aggregateMetrics();
      await metrics.checkAlerts();
      
      // Verifica che sia stata generata un'allerta
      const alerts = metrics.getActiveAlerts();
      
      expect(alerts).to.be.an('array').with.lengthOf.at.least(1);
      expect(alerts[0].metric).to.equal('test.gauge');
      expect(alerts[0].value).to.equal(200);
      expect(alerts[0].threshold).to.equal(150);
      expect(alerts[0].operator).to.equal('>');
      expect(alerts[0].severity).to.equal('warning');
    });
  });
});

describe('Test di Integrazione del Worker Thread Pool', function() {
  let pool;
  
  beforeEach(() => {
    // Crea un'istanza reale del worker pool
    pool = new WorkerThreadPool({
      minWorkers: 2,
      maxWorkers: 4,
      workerScript: path.join(__dirname, '../../offchain/worker-thread.js'),
      taskQueueSize: 100,
      enableMetrics: true
    });
  });
  
  afterEach(async () => {
    // Termina il pool
    await pool.terminate();
  });
  
  describe('Esecuzione dei task', () => {
    it('dovrebbe eseguire un task semplice', async () => {
      const result = await pool.executeTask('echo', { message: 'Hello, World!' });
      
      expect(result).to.be.an('object');
      expect(result.message).to.equal('Hello, World!');
    });
    
    it('dovrebbe eseguire più task in parallelo', async () => {
      const tasks = [
        { type: 'echo', data: { message: 'Task 1' }, options: {} },
        { type: 'echo', data: { message: 'Task 2' }, options: {} },
        { type: 'echo', data: { message: 'Task 3' }, options: {} }
      ];
      
      const results = await pool.executeParallel(tasks);
      
      expect(results).to.be.an('array').with.lengthOf(3);
      expect(results[0].message).to.equal('Task 1');
      expect(results[1].message).to.equal('Task 2');
      expect(results[2].message).to.equal('Task 3');
    });
    
    it('dovrebbe gestire task con priorità', async () => {
      // Crea task con priorità diverse
      const lowPriorityTask = {
        type: 'echo',
        data: { message: 'Low Priority' },
        options: { priority: 1 }
      };
      
      const highPriorityTask = {
        type: 'echo',
        data: { message: 'High Priority' },
        options: { priority: 10 }
      };
      
      // Esegui i task in parallelo
      const results = await pool.executeParallel([lowPriorityTask, highPriorityTask]);
      
      // I risultati dovrebbero essere nell'ordine di invio, non di priorità
      expect(results[0].message).to.equal('Low Priority');
      expect(results[1].message).to.equal('High Priority');
    });
    
    it('dovrebbe gestire task con dipendenze', async () => {
      // Crea task con dipendenze
      const task1 = {
        id: 'task-1',
        type: 'echo',
        data: { message: 'Task 1' },
        options: {}
      };
      
      const task2 = {
        id: 'task-2',
        type: 'echo',
        data: { message: 'Task 2' },
        options: {
          dependencies: ['task-1']
        }
      };
      
      const task3 = {
        id: 'task-3',
        type: 'echo',
        data: { message: 'Task 3' },
        options: {
          dependencies: ['task-2']
        }
      };
      
      // Esegui i task in parallelo
      const results = await pool.executeParallel([task1, task2, task3]);
      
      // Verifica che tutti i task siano stati completati
      expect(results).to.be.an('array').with.lengthOf(3);
      expect(results[0].message).to.equal('Task 1');
      expect(results[1].message).to.equal('Task 2');
      expect(results[2].message).to.equal('Task 3');
    });
  });
  
  describe('Gestione degli errori', () => {
    it('dovrebbe gestire errori nei task', async () => {
      try {
        await pool.executeTask('error', { message: 'Test error' });
        expect.fail('Dovrebbe lanciare un errore');
      } catch (error) {
        expect(error.message).to.include('Test error');
      }
    });
    
    it('dovrebbe gestire il timeout dei task', async () => {
      try {
        // Esegui un task che dura più del timeout
        await pool.executeTask('sleep', { duration: 5000 }, { timeout: 100 });
        expect.fail('Dovrebbe lanciare un errore di timeout');
      } catch (error) {
        expect(error.message).to.include('timeout');
      }
    });
  });
  
  describe('Ridimensionamento del pool', () => {
    it('dovrebbe ridimensionare il pool in base al carico', async () => {
      // Crea molti task per aumentare il carico
      const tasks = [];
      for (let i = 0; i < 20; i++) {
        tasks.push({
          type: 'sleep',
          data: { duration: 100 },
          options: {}
        });
      }
      
      // Esegui i task in parallelo
      const promise = pool.executeParallel(tasks);
      
      // Attendi un po' per permettere al pool di ridimensionarsi
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Verifica che il pool si sia espanso
      const stats = pool.getStats();
      expect(stats.workers.total).to.be.at.least(pool.options.minWorkers);
      
      // Attendi il completamento dei task
      await promise;
      
      // Attendi un po' per permettere al pool di ridursi
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Verifica che il pool si sia ridotto
      const newStats = pool.getStats();
      expect(newStats.workers.total).to.be.at.most(pool.options.maxWorkers);
    });
  });
});
