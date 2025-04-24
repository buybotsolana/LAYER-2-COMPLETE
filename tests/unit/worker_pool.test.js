/**
 * Test unitari per il modulo worker-pool.js
 * 
 * Questi test verificano il corretto funzionamento dell'implementazione del pool di worker threads,
 * inclusi la distribuzione del carico, la gestione degli errori e il monitoraggio delle prestazioni.
 */

const { WorkerPool } = require('../../offchain/worker-pool');
const path = require('path');
const os = require('os');

// Mock del worker script per i test
const TEST_WORKER_SCRIPT = path.join(__dirname, '../mocks/test-worker.js');

describe('WorkerPool', () => {
  let workerPool;
  
  beforeEach(() => {
    // Crea un nuovo pool di worker per ogni test
    workerPool = new WorkerPool({
      workerCount: 2,
      workerScript: TEST_WORKER_SCRIPT,
      enableMetrics: true,
      maxRetries: 2,
      taskTimeout: 1000
    });
  });
  
  afterEach(async () => {
    // Chiudi il pool di worker dopo ogni test
    if (workerPool) {
      await workerPool.close({ gracefulTimeout: 500 });
    }
  });
  
  describe('Inizializzazione', () => {
    test('Dovrebbe inizializzare il pool con il numero corretto di worker', () => {
      expect(workerPool.workers.length).toBe(2);
      expect(workerPool.workerStats.length).toBe(2);
      expect(workerPool.isShuttingDown).toBe(false);
    });
    
    test('Dovrebbe inizializzare il pool con il numero di worker predefinito se non specificato', () => {
      const defaultPool = new WorkerPool({
        workerScript: TEST_WORKER_SCRIPT
      });
      
      // Il numero predefinito dovrebbe essere basato sul numero di CPU
      const expectedWorkers = Math.max(1, Math.min(os.cpus().length - 1, 8));
      expect(defaultPool.workers.length).toBe(expectedWorkers);
      
      // Chiudi il pool
      return defaultPool.close();
    });
  });
  
  describe('Esecuzione dei task', () => {
    test('Dovrebbe eseguire un task semplice', async () => {
      const result = await workerPool.executeTask('echo', { message: 'Hello, World!' });
      
      expect(result).toBeDefined();
      expect(result.message).toBe('Hello, World!');
    });
    
    test('Dovrebbe eseguire più task in parallelo', async () => {
      const tasks = [];
      
      for (let i = 0; i < 5; i++) {
        tasks.push(workerPool.executeTask('echo', { message: `Task ${i}` }));
      }
      
      const results = await Promise.all(tasks);
      
      expect(results.length).toBe(5);
      for (let i = 0; i < 5; i++) {
        expect(results[i].message).toBe(`Task ${i}`);
      }
    });
    
    test('Dovrebbe eseguire un batch di task', async () => {
      const batch = [
        { taskType: 'echo', data: { message: 'Task 1' } },
        { taskType: 'echo', data: { message: 'Task 2' } },
        { taskType: 'echo', data: { message: 'Task 3' } }
      ];
      
      const results = await workerPool.executeBatch(batch);
      
      expect(results.length).toBe(3);
      expect(results[0].message).toBe('Task 1');
      expect(results[1].message).toBe('Task 2');
      expect(results[2].message).toBe('Task 3');
    });
  });
  
  describe('Gestione degli errori', () => {
    test('Dovrebbe gestire errori nei task', async () => {
      // Esegui un task che genererà un errore
      await expect(workerPool.executeTask('error', { message: 'Test error' }))
        .rejects.toThrow();
    });
    
    test('Dovrebbe riprovare i task falliti', async () => {
      // Mock della funzione di retry
      const originalRetry = workerPool._recreateWorker;
      workerPool._recreateWorker = jest.fn();
      
      // Esegui un task che fallirà
      try {
        await workerPool.executeTask('fail', { retryAfter: 1 });
      } catch (error) {
        // Ignora l'errore
      }
      
      // Verifica che il retry sia stato chiamato
      expect(workerPool._recreateWorker).toHaveBeenCalled();
      
      // Ripristina la funzione originale
      workerPool._recreateWorker = originalRetry;
    });
    
    test('Dovrebbe gestire il timeout dei task', async () => {
      // Esegui un task che non terminerà mai
      await expect(workerPool.executeTask('hang', { duration: 2000 }))
        .rejects.toThrow(/timeout/i);
    }, 3000);
  });
  
  describe('Bilanciamento del carico', () => {
    test('Dovrebbe distribuire i task tra i worker', async () => {
      // Esegui più task di quanti sono i worker
      const tasks = [];
      
      for (let i = 0; i < 10; i++) {
        tasks.push(workerPool.executeTask('echo', { message: `Task ${i}` }));
      }
      
      await Promise.all(tasks);
      
      // Verifica che entrambi i worker abbiano elaborato dei task
      const stats = workerPool.getStats();
      
      expect(stats.workerStats[0].tasksProcessed).toBeGreaterThan(0);
      expect(stats.workerStats[1].tasksProcessed).toBeGreaterThan(0);
    });
    
    test('Dovrebbe selezionare il worker meno occupato', async () => {
      // Mock della funzione di selezione
      const originalSelect = workerPool._selectWorker;
      workerPool._selectWorker = jest.fn().mockImplementation((availableWorkers) => {
        // Simula la strategia "least-busy"
        return availableWorkers[0];
      });
      
      // Esegui alcuni task
      await workerPool.executeTask('echo', { message: 'Test' });
      
      // Verifica che la funzione di selezione sia stata chiamata
      expect(workerPool._selectWorker).toHaveBeenCalled();
      
      // Ripristina la funzione originale
      workerPool._selectWorker = originalSelect;
    });
  });
  
  describe('Backpressure', () => {
    test('Dovrebbe attivare il backpressure quando la coda è piena', async () => {
      // Crea un pool con una coda piccola
      const smallPool = new WorkerPool({
        workerCount: 1,
        workerScript: TEST_WORKER_SCRIPT,
        maxQueueSize: 5,
        backpressureThreshold: 0.6, // 3 elementi
        taskTimeout: 500
      });
      
      // Mock della funzione di elaborazione per bloccare i task
      smallPool._processQueue = jest.fn();
      
      // Registra l'evento di backpressure
      const backpressurePromise = new Promise(resolve => {
        smallPool.on('backpressure', (isActive) => {
          if (isActive) resolve(true);
        });
      });
      
      // Invia più task di quanti ne può gestire la coda
      for (let i = 0; i < 10; i++) {
        smallPool.executeTask('echo', { message: `Task ${i}` }).catch(() => {});
      }
      
      // Attendi l'attivazione del backpressure
      const backpressureActivated = await backpressurePromise;
      expect(backpressureActivated).toBe(true);
      
      // Chiudi il pool
      await smallPool.close();
    });
    
    test('Dovrebbe rifiutare i task quando il backpressure è attivo', async () => {
      // Crea un pool con backpressure attivo
      const pool = new WorkerPool({
        workerCount: 1,
        workerScript: TEST_WORKER_SCRIPT,
        maxQueueSize: 5,
        backpressureThreshold: 0.1 // Attiva subito
      });
      
      // Forza l'attivazione del backpressure
      pool.isBackpressureActive = true;
      
      // Prova a inviare un task
      await expect(pool.executeTask('echo', { message: 'Test' }))
        .rejects.toThrow(/backpressure/i);
      
      // Chiudi il pool
      await pool.close();
    });
  });
  
  describe('Metriche e monitoraggio', () => {
    test('Dovrebbe tracciare le metriche di utilizzo', async () => {
      // Esegui alcuni task
      await workerPool.executeTask('echo', { message: 'Test 1' });
      await workerPool.executeTask('echo', { message: 'Test 2' });
      
      // Ottieni le statistiche
      const stats = workerPool.getStats();
      
      expect(stats).toBeDefined();
      expect(stats.workerCount).toBe(2);
      expect(stats.metrics).toBeDefined();
    });
  });
  
  describe('Chiusura', () => {
    test('Dovrebbe chiudere il pool correttamente', async () => {
      // Esegui alcuni task
      await workerPool.executeTask('echo', { message: 'Test' });
      
      // Chiudi il pool
      await workerPool.close();
      
      expect(workerPool.isShuttingDown).toBe(true);
      expect(workerPool.workers.length).toBe(0);
    });
    
    test('Dovrebbe attendere il completamento dei task in corso durante la chiusura', async () => {
      // Avvia un task lungo
      const taskPromise = workerPool.executeTask('delay', { duration: 200 });
      
      // Chiudi il pool con attesa
      const closePromise = workerPool.close({ gracefulTimeout: 500, forceClose: false });
      
      // Attendi il completamento di entrambe le promesse
      await Promise.all([taskPromise, closePromise]);
      
      // Il task dovrebbe essere completato con successo
      expect(await taskPromise).toBeDefined();
    });
  });
});
