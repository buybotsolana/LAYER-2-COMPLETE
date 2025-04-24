/**
 * Test unitari per il modulo priority-queue.js
 * 
 * Questi test verificano il corretto funzionamento dell'implementazione della coda di priorità
 * con heap binario, inclusi riprogrammazione dinamica delle priorità, backpressure avanzato
 * e monitoraggio delle prestazioni.
 */

const { PriorityQueue, BinaryHeap } = require('../../offchain/priority-queue');
const path = require('path');
const os = require('os');

describe('BinaryHeap', () => {
  let heap;
  
  beforeEach(() => {
    // Crea un nuovo heap per ogni test
    heap = new BinaryHeap((a, b) => b.priority - a.priority); // Max heap
  });
  
  describe('Operazioni di base', () => {
    test('Dovrebbe inizializzare un heap vuoto', () => {
      expect(heap.size).toBe(0);
      expect(heap.isEmpty()).toBe(true);
      expect(heap.peek()).toBeNull();
    });
    
    test('Dovrebbe inserire elementi nell\'heap', () => {
      heap.insert({ id: 'item1', priority: 5 }, 'item1');
      heap.insert({ id: 'item2', priority: 10 }, 'item2');
      
      expect(heap.size).toBe(2);
      expect(heap.isEmpty()).toBe(false);
      expect(heap.peek().id).toBe('item2'); // L'elemento con priorità più alta
    });
    
    test('Dovrebbe estrarre l\'elemento con priorità più alta', () => {
      heap.insert({ id: 'item1', priority: 5 }, 'item1');
      heap.insert({ id: 'item2', priority: 10 }, 'item2');
      heap.insert({ id: 'item3', priority: 7 }, 'item3');
      
      const max = heap.extractMax();
      expect(max.id).toBe('item2');
      expect(heap.size).toBe(2);
      
      const nextMax = heap.extractMax();
      expect(nextMax.id).toBe('item3');
      expect(heap.size).toBe(1);
    });
    
    test('Dovrebbe aggiornare la priorità di un elemento', () => {
      heap.insert({ id: 'item1', priority: 5 }, 'item1');
      heap.insert({ id: 'item2', priority: 10 }, 'item2');
      
      // Aggiorna la priorità di item1
      heap.updatePriority('item1', 15);
      
      // Ora item1 dovrebbe avere la priorità più alta
      expect(heap.peek().id).toBe('item1');
    });
    
    test('Dovrebbe rimuovere un elemento dall\'heap', () => {
      heap.insert({ id: 'item1', priority: 5 }, 'item1');
      heap.insert({ id: 'item2', priority: 10 }, 'item2');
      
      // Rimuovi item2
      const removed = heap.remove('item2');
      expect(removed).toBe(true);
      expect(heap.size).toBe(1);
      expect(heap.peek().id).toBe('item1');
    });
    
    test('Dovrebbe verificare se un elemento è presente nell\'heap', () => {
      heap.insert({ id: 'item1', priority: 5 }, 'item1');
      
      expect(heap.contains('item1')).toBe(true);
      expect(heap.contains('item2')).toBe(false);
    });
    
    test('Dovrebbe ottenere un elemento dall\'heap', () => {
      const item = { id: 'item1', priority: 5 };
      heap.insert(item, 'item1');
      
      const retrieved = heap.get('item1');
      expect(retrieved).toEqual(item);
    });
    
    test('Dovrebbe convertire l\'heap in un array', () => {
      heap.insert({ id: 'item1', priority: 5 }, 'item1');
      heap.insert({ id: 'item2', priority: 10 }, 'item2');
      
      const array = heap.toArray();
      expect(array.length).toBe(2);
      expect(array.some(item => item.id === 'item1')).toBe(true);
      expect(array.some(item => item.id === 'item2')).toBe(true);
    });
    
    test('Dovrebbe pulire l\'heap', () => {
      heap.insert({ id: 'item1', priority: 5 }, 'item1');
      heap.insert({ id: 'item2', priority: 10 }, 'item2');
      
      heap.clear();
      expect(heap.size).toBe(0);
      expect(heap.isEmpty()).toBe(true);
    });
  });
  
  describe('Proprietà dell\'heap', () => {
    test('Dovrebbe mantenere la proprietà dell\'heap dopo le inserzioni', () => {
      // Inserisci elementi in ordine casuale
      heap.insert({ id: 'item1', priority: 5 }, 'item1');
      heap.insert({ id: 'item2', priority: 10 }, 'item2');
      heap.insert({ id: 'item3', priority: 7 }, 'item3');
      heap.insert({ id: 'item4', priority: 3 }, 'item4');
      
      // Estrai gli elementi e verifica che siano in ordine di priorità
      expect(heap.extractMax().id).toBe('item2'); // Priorità 10
      expect(heap.extractMax().id).toBe('item3'); // Priorità 7
      expect(heap.extractMax().id).toBe('item1'); // Priorità 5
      expect(heap.extractMax().id).toBe('item4'); // Priorità 3
    });
    
    test('Dovrebbe mantenere la proprietà dell\'heap dopo gli aggiornamenti di priorità', () => {
      heap.insert({ id: 'item1', priority: 5 }, 'item1');
      heap.insert({ id: 'item2', priority: 10 }, 'item2');
      heap.insert({ id: 'item3', priority: 7 }, 'item3');
      
      // Aumenta la priorità di item1
      heap.updatePriority('item1', 15);
      
      // Diminuisci la priorità di item2
      heap.updatePriority('item2', 6);
      
      // Estrai gli elementi e verifica che siano in ordine di priorità
      expect(heap.extractMax().id).toBe('item1'); // Priorità 15
      expect(heap.extractMax().id).toBe('item3'); // Priorità 7
      expect(heap.extractMax().id).toBe('item2'); // Priorità 6
    });
    
    test('Dovrebbe mantenere la proprietà dell\'heap dopo le rimozioni', () => {
      heap.insert({ id: 'item1', priority: 5 }, 'item1');
      heap.insert({ id: 'item2', priority: 10 }, 'item2');
      heap.insert({ id: 'item3', priority: 7 }, 'item3');
      heap.insert({ id: 'item4', priority: 3 }, 'item4');
      
      // Rimuovi item3
      heap.remove('item3');
      
      // Estrai gli elementi e verifica che siano in ordine di priorità
      expect(heap.extractMax().id).toBe('item2'); // Priorità 10
      expect(heap.extractMax().id).toBe('item1'); // Priorità 5
      expect(heap.extractMax().id).toBe('item4'); // Priorità 3
    });
  });
});

describe('PriorityQueue', () => {
  let queue;
  
  beforeEach(() => {
    // Crea una nuova coda di priorità per ogni test
    queue = new PriorityQueue({
      maxSize: 100,
      workerCount: 1,
      enableParallelProcessing: false, // Disabilita l'elaborazione parallela per i test
      priorityLevels: 3,
      enableMetrics: true,
      enableBackpressure: true,
      backpressureThreshold: 0.8,
      enableBatchProcessing: true,
      batchSize: 10
    });
  });
  
  afterEach(async () => {
    // Chiudi la coda dopo ogni test
    if (queue) {
      await queue.close();
    }
  });
  
  describe('Operazioni di base', () => {
    test('Dovrebbe inizializzare la coda correttamente', () => {
      expect(queue.size).toBe(0);
      expect(queue.isShuttingDown).toBe(false);
    });
    
    test('Dovrebbe aggiungere transazioni alla coda', async () => {
      const tx1 = { id: 'tx1', fee: 10, timestamp: Date.now() };
      const tx2 = { id: 'tx2', fee: 20, timestamp: Date.now() };
      
      await queue.enqueue(tx1);
      await queue.enqueue(tx2);
      
      expect(queue.getSize()).toBe(2);
    });
    
    test('Dovrebbe prelevare transazioni dalla coda in ordine di priorità', async () => {
      const tx1 = { id: 'tx1', fee: 10, timestamp: Date.now() };
      const tx2 = { id: 'tx2', fee: 20, timestamp: Date.now() };
      const tx3 = { id: 'tx3', fee: 15, timestamp: Date.now() };
      
      await queue.enqueue(tx1);
      await queue.enqueue(tx2);
      await queue.enqueue(tx3);
      
      // Attendi che le transazioni vengano elaborate
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Preleva le transazioni
      const result = await queue.dequeue(3);
      
      expect(result.length).toBe(3);
      
      // Le transazioni dovrebbero essere in ordine di priorità (fee)
      expect(result[0].id).toBe('tx2'); // Fee più alta
      expect(result[1].id).toBe('tx3');
      expect(result[2].id).toBe('tx1'); // Fee più bassa
    });
    
    test('Dovrebbe prelevare un batch di transazioni', async () => {
      // Aggiungi 5 transazioni
      for (let i = 0; i < 5; i++) {
        await queue.enqueue({
          id: `tx${i}`,
          fee: 10 + i,
          timestamp: Date.now()
        });
      }
      
      // Attendi che le transazioni vengano elaborate
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Preleva un batch di 3 transazioni
      const batch = await queue.dequeue(3);
      
      expect(batch.length).toBe(3);
      expect(queue.getSize()).toBe(2);
    });
  });
  
  describe('Gestione delle priorità', () => {
    test('Dovrebbe calcolare la priorità in base a diversi fattori', async () => {
      const now = Date.now();
      
      // Transazione con fee alta ma vecchia
      const tx1 = {
        id: 'tx1',
        fee: 100,
        timestamp: now - 3600000, // 1 ora fa
        size: 1000
      };
      
      // Transazione con fee bassa ma recente
      const tx2 = {
        id: 'tx2',
        fee: 10,
        timestamp: now - 60000, // 1 minuto fa
        size: 100
      };
      
      await queue.enqueue(tx1);
      await queue.enqueue(tx2);
      
      // Attendi che le transazioni vengano elaborate
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // La priorità dovrebbe considerare sia la fee che l'età
      const highest = queue.peekHighest();
      expect(highest).not.toBeNull();
    });
    
    test('Dovrebbe aggiornare la priorità di una transazione', async () => {
      const tx = {
        id: 'tx1',
        fee: 10,
        timestamp: Date.now()
      };
      
      await queue.enqueue(tx);
      
      // Attendi che la transazione venga elaborata
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Aumenta la priorità
      const updated = queue.boostPriority('tx1', 2.0);
      expect(updated).toBe(true);
      
      // La transazione dovrebbe avere una priorità più alta
      const highest = queue.peekHighest();
      expect(highest.id).toBe('tx1');
    });
    
    test('Dovrebbe diminuire la priorità di una transazione', async () => {
      const tx1 = {
        id: 'tx1',
        fee: 20,
        timestamp: Date.now()
      };
      
      const tx2 = {
        id: 'tx2',
        fee: 10,
        timestamp: Date.now()
      };
      
      await queue.enqueue(tx1);
      await queue.enqueue(tx2);
      
      // Attendi che le transazioni vengano elaborate
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Diminuisci la priorità di tx1
      const updated = queue.decreasePriority('tx1', 0.1);
      expect(updated).toBe(true);
      
      // tx2 dovrebbe ora avere la priorità più alta
      const highest = queue.peekHighest();
      expect(highest.id).toBe('tx2');
    });
  });
  
  describe('Backpressure', () => {
    test('Dovrebbe attivare il backpressure quando la coda è piena', async () => {
      // Crea una coda con dimensione massima piccola
      const smallQueue = new PriorityQueue({
        maxSize: 5,
        backpressureThreshold: 0.6, // 3 elementi
        enableBackpressure: true
      });
      
      // Registra l'evento di backpressure
      const backpressurePromise = new Promise(resolve => {
        smallQueue.on('backpressure', (isActive) => {
          if (isActive) resolve(true);
        });
      });
      
      // Aggiungi più transazioni di quante ne può contenere la coda
      for (let i = 0; i < 10; i++) {
        smallQueue.enqueue({
          id: `tx${i}`,
          fee: 10,
          timestamp: Date.now()
        }).catch(() => {});
      }
      
      // Attendi l'attivazione del backpressure
      const backpressureActivated = await backpressurePromise;
      expect(backpressureActivated).toBe(true);
      
      // Chiudi la coda
      await smallQueue.close();
    });
    
    test('Dovrebbe rifiutare le transazioni quando il backpressure è attivo', async () => {
      // Forza l'attivazione del backpressure
      queue.isBackpressureActive = true;
      
      // Prova ad aggiungere una transazione
      const result = await queue.enqueue({
        id: 'tx1',
        fee: 10,
        timestamp: Date.now()
      });
      
      expect(result).toBe(false);
    });
  });
  
  describe('Elaborazione batch', () => {
    test('Dovrebbe elaborare le transazioni in batch', async () => {
      // Mock della funzione di elaborazione batch
      const originalProcessBatch = queue._processBatch;
      queue._processBatch = jest.fn();
      
      // Aggiungi alcune transazioni
      for (let i = 0; i < 15; i++) {
        await queue.enqueue({
          id: `tx${i}`,
          fee: 10 + i,
          timestamp: Date.now()
        });
      }
      
      // Verifica che la funzione di elaborazione batch sia stata chiamata
      expect(queue._processBatch).toHaveBeenCalled();
      
      // Ripristina la funzione originale
      queue._processBatch = originalProcessBatch;
    });
  });
  
  describe('Metriche e monitoraggio', () => {
    test('Dovrebbe tracciare le metriche di utilizzo', async () => {
      // Aggiungi alcune transazioni
      for (let i = 0; i < 5; i++) {
        await queue.enqueue({
          id: `tx${i}`,
          fee: 10 + i,
          timestamp: Date.now()
        });
      }
      
      // Attendi che le transazioni vengano elaborate
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Preleva alcune transazioni
      await queue.dequeue(3);
      
      // Ottieni la distribuzione delle priorità
      const distribution = queue.getPriorityDistribution();
      expect(distribution).toBeDefined();
      expect(distribution.length).toBe(queue.options.priorityLevels);
      
      // Aggiorna le statistiche di una transazione
      queue.updateTransactionStats({ id: 'tx0', sender: 'sender1' }, true, 10);
      
      // Verifica che le metriche siano state aggiornate
      expect(queue.metrics.avgProcessingTime).toBeGreaterThan(0);
    });
  });
  
  describe('Chiusura', () => {
    test('Dovrebbe chiudere la coda correttamente', async () => {
      // Aggiungi alcune transazioni
      await queue.enqueue({
        id: 'tx1',
        fee: 10,
        timestamp: Date.now()
      });
      
      // Chiudi la coda
      await queue.close();
      
      expect(queue.isShuttingDown).toBe(true);
    });
  });
});
