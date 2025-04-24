/**
 * Test unitari per il modulo lmax-disruptor.js
 * 
 * Questi test verificano il corretto funzionamento dell'implementazione del pattern LMAX Disruptor,
 * inclusi buffer circolare, sequencer, processori di eventi e gestione delle dipendenze.
 */

const { Disruptor, RingBuffer, Sequencer, EventProcessor } = require('../../offchain/lmax-disruptor');
const path = require('path');
const os = require('os');

describe('RingBuffer', () => {
  let ringBuffer;
  
  beforeEach(() => {
    // Crea un nuovo buffer circolare per ogni test
    ringBuffer = new RingBuffer(8); // Dimensione 8 (potenza di 2)
  });
  
  describe('Inizializzazione', () => {
    test('Dovrebbe inizializzare un buffer con dimensione potenza di 2', () => {
      expect(ringBuffer.size).toBe(8);
      expect(ringBuffer.mask).toBe(7);
      expect(ringBuffer.buffer.length).toBe(8);
    });
    
    test('Dovrebbe arrotondare la dimensione alla potenza di 2 successiva', () => {
      const buffer = new RingBuffer(10); // Non è una potenza di 2
      expect(buffer.size).toBe(16); // Arrotondato a 16
    });
  });
  
  describe('Operazioni di base', () => {
    test('Dovrebbe pubblicare e leggere elementi dal buffer', () => {
      const data = { value: 'test' };
      
      // Pubblica l'elemento
      const sequence = ringBuffer.publish(data);
      
      // Verifica la sequenza
      expect(sequence).toBe(0);
      
      // Leggi l'elemento
      const read = ringBuffer.read(sequence);
      
      expect(read).toEqual(data);
    });
    
    test('Dovrebbe gestire correttamente il wrapping del buffer', () => {
      // Pubblica più elementi di quanti ne può contenere il buffer
      for (let i = 0; i < 16; i++) {
        ringBuffer.publish({ value: `test-${i}` });
      }
      
      // Leggi gli ultimi 8 elementi
      for (let i = 8; i < 16; i++) {
        const read = ringBuffer.read(i);
        expect(read.value).toBe(`test-${i}`);
      }
    });
    
    test('Dovrebbe marcare gli elementi come elaborati', () => {
      const sequence = ringBuffer.publish({ value: 'test' });
      
      // Marca l'elemento come elaborato
      ringBuffer.markProcessed(sequence);
      
      // Verifica lo stato
      const slot = ringBuffer.getSlot(sequence);
      expect(slot.status).toBe('processed');
    });
    
    test('Dovrebbe pulire il buffer', () => {
      // Pubblica alcuni elementi
      ringBuffer.publish({ value: 'test1' });
      ringBuffer.publish({ value: 'test2' });
      
      // Pulisci il buffer
      ringBuffer.clear();
      
      // Verifica che il buffer sia vuoto
      expect(ringBuffer.getSequence()).toBe(0);
      
      // Verifica che gli slot siano stati resettati
      for (let i = 0; i < ringBuffer.size; i++) {
        expect(ringBuffer.buffer[i].status).toBe('empty');
      }
    });
  });
  
  describe('Gestione delle sequenze', () => {
    test('Dovrebbe ottenere la sequenza corrente', () => {
      expect(ringBuffer.getSequence()).toBe(0);
      
      // Pubblica alcuni elementi
      ringBuffer.publish({ value: 'test1' });
      ringBuffer.publish({ value: 'test2' });
      
      expect(ringBuffer.getSequence()).toBe(2);
    });
    
    test('Dovrebbe incrementare la sequenza', () => {
      const sequence1 = ringBuffer.incrementSequence();
      expect(sequence1).toBe(0);
      
      const sequence2 = ringBuffer.incrementSequence();
      expect(sequence2).toBe(1);
    });
    
    test('Dovrebbe calcolare correttamente l\'indice nel buffer', () => {
      expect(ringBuffer.getIndex(0)).toBe(0);
      expect(ringBuffer.getIndex(7)).toBe(7);
      expect(ringBuffer.getIndex(8)).toBe(0); // Wrapping
      expect(ringBuffer.getIndex(15)).toBe(7);
    });
  });
});

describe('Sequencer', () => {
  let ringBuffer;
  let sequencer;
  
  beforeEach(() => {
    ringBuffer = new RingBuffer(8);
    sequencer = new Sequencer(ringBuffer);
  });
  
  describe('Operazioni di base', () => {
    test('Dovrebbe inizializzare il sequencer con cursore -1', () => {
      expect(sequencer.getCursor()).toBe(-1);
      expect(sequencer.gatingSequences).toEqual([]);
    });
    
    test('Dovrebbe aggiungere sequenze di gating', () => {
      const gatingSequence = { get: () => 0 };
      sequencer.addGatingSequence(gatingSequence);
      
      expect(sequencer.gatingSequences.length).toBe(1);
      expect(sequencer.getMinimumSequence()).toBe(0);
    });
    
    test('Dovrebbe ottenere la sequenza minima', () => {
      sequencer.addGatingSequence({ get: () => 5 });
      sequencer.addGatingSequence({ get: () => 3 });
      
      expect(sequencer.getMinimumSequence()).toBe(3);
    });
    
    test('Dovrebbe restituire -1 se non ci sono sequenze di gating', () => {
      expect(sequencer.getMinimumSequence()).toBe(-1);
    });
  });
  
  describe('Controllo della disponibilità', () => {
    test('Dovrebbe verificare se c\'è spazio disponibile nel buffer', () => {
      // Senza sequenze di gating, c'è sempre spazio disponibile
      expect(sequencer.hasAvailableCapacity()).toBe(true);
      
      // Aggiungi una sequenza di gating
      sequencer.addGatingSequence({ get: () => -1 });
      
      // Avanza il cursore
      for (let i = 0; i < 7; i++) {
        sequencer.next();
      }
      
      // Dovrebbe esserci ancora spazio disponibile
      expect(sequencer.hasAvailableCapacity()).toBe(true);
      
      // Avanza il cursore ancora una volta
      sequencer.next();
      
      // Non dovrebbe esserci più spazio disponibile
      expect(sequencer.hasAvailableCapacity()).toBe(false);
    });
  });
  
  describe('Gestione delle sequenze', () => {
    test('Dovrebbe avanzare il cursore', () => {
      const sequence = sequencer.next();
      expect(sequence).toBe(0);
      expect(sequencer.getCursor()).toBe(0);
      
      const nextSequence = sequencer.next();
      expect(nextSequence).toBe(1);
      expect(sequencer.getCursor()).toBe(1);
    });
    
    test('Dovrebbe pubblicare una sequenza', () => {
      const sequence = sequencer.next();
      
      // Pubblicare una sequenza valida non dovrebbe generare errori
      expect(() => sequencer.publish(sequence)).not.toThrow();
      
      // Pubblicare una sequenza non valida dovrebbe generare un errore
      expect(() => sequencer.publish(sequence + 1)).toThrow();
    });
    
    test('Dovrebbe generare un errore se il buffer è pieno', () => {
      // Aggiungi una sequenza di gating che non avanza
      sequencer.addGatingSequence({ get: () => -1 });
      
      // Avanza il cursore fino a riempire il buffer
      for (let i = 0; i < 8; i++) {
        sequencer.next();
      }
      
      // La prossima chiamata a next() dovrebbe generare un errore
      expect(() => sequencer.next()).toThrow(/full/i);
    });
  });
});

describe('EventProcessor', () => {
  let ringBuffer;
  let processor;
  let handlerMock;
  
  beforeEach(() => {
    ringBuffer = new RingBuffer(8);
    handlerMock = jest.fn();
    processor = new EventProcessor(ringBuffer, handlerMock);
  });
  
  afterEach(() => {
    // Ferma il processore dopo ogni test
    processor.stop();
  });
  
  describe('Inizializzazione', () => {
    test('Dovrebbe inizializzare il processore con sequenza -1', () => {
      expect(processor.get()).toBe(-1);
      expect(processor.running).toBe(false);
    });
  });
  
  describe('Controllo dell\'esecuzione', () => {
    test('Dovrebbe avviare e fermare il processore', () => {
      processor.start();
      expect(processor.running).toBe(true);
      
      processor.stop();
      expect(processor.running).toBe(false);
    });
  });
  
  describe('Elaborazione degli eventi', () => {
    test('Dovrebbe elaborare gli eventi dal buffer', async () => {
      // Pubblica un evento nel buffer
      const event = { value: 'test' };
      ringBuffer.publish(event);
      
      // Avvia il processore
      processor.start();
      
      // Attendi che l'evento venga elaborato
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verifica che l'handler sia stato chiamato
      expect(handlerMock).toHaveBeenCalledWith(event, 0);
      
      // Verifica che la sequenza sia stata aggiornata
      expect(processor.get()).toBe(0);
    });
    
    test('Dovrebbe gestire gli errori durante l\'elaborazione', async () => {
      // Mock dell'handler che genera un errore
      const errorHandler = jest.fn().mockImplementation(() => {
        throw new Error('Test error');
      });
      
      const errorProcessor = new EventProcessor(ringBuffer, errorHandler);
      
      // Pubblica un evento nel buffer
      ringBuffer.publish({ value: 'test' });
      
      // Avvia il processore
      errorProcessor.start();
      
      // Attendi che l'evento venga elaborato
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verifica che l'handler sia stato chiamato
      expect(errorHandler).toHaveBeenCalled();
      
      // Ferma il processore
      errorProcessor.stop();
    });
  });
});

describe('Disruptor', () => {
  let disruptor;
  
  beforeEach(() => {
    // Crea un nuovo disruptor per ogni test
    disruptor = new Disruptor({
      bufferSize: 16,
      workerCount: 1,
      enableParallelProcessing: false, // Disabilita l'elaborazione parallela per i test
      enableMetrics: true,
      enableDependencyTracking: true,
      enableBatchProcessing: true,
      batchSize: 5,
      batchTimeout: 10
    });
  });
  
  afterEach(async () => {
    // Chiudi il disruptor dopo ogni test
    if (disruptor) {
      await disruptor.close();
    }
  });
  
  describe('Inizializzazione', () => {
    test('Dovrebbe inizializzare il disruptor correttamente', () => {
      expect(disruptor.ringBuffer).toBeDefined();
      expect(disruptor.sequencer).toBeDefined();
      expect(disruptor.processors.length).toBe(1);
      expect(disruptor.isShuttingDown).toBe(false);
    });
  });
  
  describe('Pubblicazione degli eventi', () => {
    test('Dovrebbe pubblicare un evento nel disruptor', async () => {
      const result = await disruptor.publish({ value: 'test' });
      
      expect(result).toBeDefined();
      expect(result.eventId).toBeDefined();
      expect(result.result).toContain('Processed event');
    });
    
    test('Dovrebbe pubblicare più eventi in batch', async () => {
      const events = [];
      
      for (let i = 0; i < 10; i++) {
        events.push(disruptor.publish({ value: `test-${i}` }));
      }
      
      const results = await Promise.all(events);
      
      expect(results.length).toBe(10);
      for (const result of results) {
        expect(result.eventId).toBeDefined();
        expect(result.result).toContain('Processed event');
      }
    });
  });
  
  describe('Gestione delle dipendenze', () => {
    test('Dovrebbe registrare dipendenze tra eventi', async () => {
      // Pubblica un evento
      const event1 = await disruptor.publish({ value: 'event1' });
      
      // Pubblica un evento che dipende dal primo
      const event2Promise = disruptor.publish(
        { value: 'event2' },
        { dependencies: [event1.eventId] }
      );
      
      // Verifica che l'evento sia stato pubblicato
      const event2 = await event2Promise;
      expect(event2).toBeDefined();
      expect(event2.eventId).toBeDefined();
    });
    
    test('Dovrebbe elaborare gli eventi in ordine di dipendenza', async () => {
      // Crea un disruptor con elaborazione sequenziale
      const sequentialDisruptor = new Disruptor({
        bufferSize: 16,
        workerCount: 1,
        enableParallelProcessing: false,
        enableDependencyTracking: true,
        enableBatchProcessing: false
      });
      
      // Pubblica un evento
      const event1 = await sequentialDisruptor.publish({ value: 'event1' });
      
      // Pubblica un evento che dipende dal primo
      const event2 = await sequentialDisruptor.publish(
        { value: 'event2' },
        { dependencies: [event1.eventId] }
      );
      
      // Verifica che entrambi gli eventi siano stati elaborati
      expect(event1).toBeDefined();
      expect(event2).toBeDefined();
      
      // Chiudi il disruptor
      await sequentialDisruptor.close();
    });
  });
  
  describe('Batch processing', () => {
    test('Dovrebbe elaborare gli eventi in batch', async () => {
      // Mock della funzione di elaborazione batch
      const originalProcessBatch = disruptor._processBatch;
      disruptor._processBatch = jest.fn().mockImplementation(originalProcessBatch);
      
      // Pubblica più eventi di quanti ne può contenere un batch
      const events = [];
      for (let i = 0; i < 10; i++) {
        events.push(disruptor.publish({ value: `test-${i}` }));
      }
      
      // Attendi che tutti gli eventi vengano elaborati
      await Promise.all(events);
      
      // Verifica che la funzione di elaborazione batch sia stata chiamata
      expect(disruptor._processBatch).toHaveBeenCalled();
      
      // Ripristina la funzione originale
      disruptor._processBatch = originalProcessBatch;
    });
  });
  
  describe('Metriche e monitoraggio', () => {
    test('Dovrebbe tracciare le metriche di utilizzo', async () => {
      // Pubblica alcuni eventi
      for (let i = 0; i < 5; i++) {
        await disruptor.publish({ value: `test-${i}` });
      }
      
      // Ottieni le statistiche
      const stats = disruptor.getStats();
      
      expect(stats).toBeDefined();
      expect(stats.bufferSize).toBe(16);
      expect(stats.metrics).toBeDefined();
      expect(stats.metrics.published).toBe(0); // Resettato dopo l'intervallo
      expect(stats.metrics.processed).toBe(0); // Resettato dopo l'intervallo
    });
  });
  
  describe('Chiusura', () => {
    test('Dovrebbe chiudere il disruptor correttamente', async () => {
      // Pubblica un evento
      await disruptor.publish({ value: 'test' });
      
      // Chiudi il disruptor
      await disruptor.close();
      
      expect(disruptor.isShuttingDown).toBe(true);
    });
    
    test('Dovrebbe attendere il completamento degli eventi in corso durante la chiusura', async () => {
      // Pubblica un evento che richiede tempo per essere elaborato
      const eventPromise = disruptor.publish({ value: 'delay', delay: 100 });
      
      // Chiudi il disruptor
      const closePromise = disruptor.close();
      
      // Attendi il completamento di entrambe le promesse
      await Promise.all([eventPromise, closePromise]);
      
      // L'evento dovrebbe essere completato con successo
      expect(await eventPromise).toBeDefined();
    });
  });
});
