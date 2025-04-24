/**
 * Unit tests per lo Shared Ring Buffer
 * 
 * Questo file contiene i test unitari per il componente Shared Ring Buffer
 * dell'architettura ad alte prestazioni del Layer-2 su Solana.
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { SharedRingBuffer, BufferEntry, RingBufferCursor, RingBufferWorker } = require('../../offchain/shared-ring-buffer');

describe('SharedRingBuffer', function() {
  // Aumenta il timeout per i test più lunghi
  this.timeout(10000);
  
  let buffer;
  
  beforeEach(() => {
    // Crea un'istanza del buffer
    buffer = new SharedRingBuffer({
      size: 128,
      entrySize: 1024,
      waitStrategy: 'yield',
      claimStrategy: 'single',
      overflowStrategy: 'block',
      stalledThreshold: 1000,
      cleanupInterval: 500,
      enableMetrics: true
    });
  });
  
  afterEach(() => {
    // Cleanup
    if (buffer) {
      buffer.close();
    }
    
    // Ripristina i mock
    sinon.restore();
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente il buffer', () => {
      expect(buffer).to.be.an.instanceOf(SharedRingBuffer);
      expect(buffer.options.size).to.equal(128);
      expect(buffer.options.entrySize).to.equal(1024);
      expect(buffer.options.waitStrategy).to.equal('yield');
      expect(buffer.options.claimStrategy).to.equal('single');
      expect(buffer.options.overflowStrategy).to.equal('block');
      expect(buffer.buffer).to.have.lengthOf(128);
      expect(buffer.isOpen).to.be.true;
    });
    
    it('dovrebbe usare valori predefiniti se non specificati', () => {
      const defaultBuffer = new SharedRingBuffer();
      
      expect(defaultBuffer.options.size).to.be.greaterThan(0);
      expect(defaultBuffer.options.entrySize).to.be.greaterThan(0);
      expect(defaultBuffer.options.waitStrategy).to.be.a('string');
      expect(defaultBuffer.options.claimStrategy).to.be.a('string');
      expect(defaultBuffer.options.overflowStrategy).to.be.a('string');
      expect(defaultBuffer.buffer).to.have.lengthOf(defaultBuffer.options.size);
      expect(defaultBuffer.isOpen).to.be.true;
    });
    
    it('dovrebbe inizializzare tutte le entry del buffer', () => {
      for (let i = 0; i < buffer.options.size; i++) {
        expect(buffer.buffer[i]).to.be.an.instanceOf(BufferEntry);
        expect(buffer.buffer[i].index).to.equal(i);
        expect(buffer.buffer[i].size).to.equal(buffer.options.entrySize);
        expect(buffer.buffer[i].isEmpty()).to.be.true;
      }
    });
  });
  
  describe('Registrazione di produttori e consumatori', () => {
    it('dovrebbe registrare un produttore', () => {
      const cursor = buffer.registerProducer('producer-1');
      
      expect(cursor).to.be.an.instanceOf(RingBufferCursor);
      expect(cursor.id).to.equal('producer-1');
      expect(cursor.type).to.equal('producer');
      expect(cursor.position).to.equal(0);
      expect(buffer.producers.has('producer-1')).to.be.true;
    });
    
    it('dovrebbe registrare un consumatore', () => {
      const cursor = buffer.registerConsumer('consumer-1');
      
      expect(cursor).to.be.an.instanceOf(RingBufferCursor);
      expect(cursor.id).to.equal('consumer-1');
      expect(cursor.type).to.equal('consumer');
      expect(cursor.position).to.equal(0);
      expect(buffer.consumers.has('consumer-1')).to.be.true;
    });
    
    it('dovrebbe generare ID univoci se non forniti', () => {
      const producer1 = buffer.registerProducer();
      const producer2 = buffer.registerProducer();
      const consumer1 = buffer.registerConsumer();
      const consumer2 = buffer.registerConsumer();
      
      expect(producer1.id).to.not.equal(producer2.id);
      expect(consumer1.id).to.not.equal(consumer2.id);
      expect(producer1.id).to.not.equal(consumer1.id);
    });
    
    it('dovrebbe lanciare un errore se si registra un produttore con ID duplicato', () => {
      buffer.registerProducer('producer-1');
      
      expect(() => buffer.registerProducer('producer-1')).to.throw(/già registrato/);
    });
    
    it('dovrebbe lanciare un errore se si registra un consumatore con ID duplicato', () => {
      buffer.registerConsumer('consumer-1');
      
      expect(() => buffer.registerConsumer('consumer-1')).to.throw(/già registrato/);
    });
    
    it('dovrebbe deregistrare un produttore', () => {
      buffer.registerProducer('producer-1');
      const result = buffer.deregisterProducer('producer-1');
      
      expect(result).to.be.true;
      expect(buffer.producers.has('producer-1')).to.be.false;
    });
    
    it('dovrebbe deregistrare un consumatore', () => {
      buffer.registerConsumer('consumer-1');
      const result = buffer.deregisterConsumer('consumer-1');
      
      expect(result).to.be.true;
      expect(buffer.consumers.has('consumer-1')).to.be.false;
    });
    
    it('dovrebbe restituire false se si tenta di deregistrare un produttore inesistente', () => {
      const result = buffer.deregisterProducer('producer-nonexistent');
      
      expect(result).to.be.false;
    });
    
    it('dovrebbe restituire false se si tenta di deregistrare un consumatore inesistente', () => {
      const result = buffer.deregisterConsumer('consumer-nonexistent');
      
      expect(result).to.be.false;
    });
  });
  
  describe('Pubblicazione e consumo', () => {
    it('dovrebbe pubblicare un elemento nel buffer', async () => {
      const data = { id: 1, value: 'test' };
      const metadata = { timestamp: Date.now() };
      const producerId = 'producer-1';
      
      buffer.registerProducer(producerId);
      const index = await buffer.publish(data, metadata, producerId);
      
      expect(index).to.be.a('number');
      expect(index).to.be.greaterThan(-1);
      expect(index).to.be.lessThan(buffer.options.size);
      
      const entry = buffer.buffer[index];
      expect(entry.isReady()).to.be.true;
      expect(entry.data).to.deep.equal(data);
      expect(entry.metadata).to.deep.equal(metadata);
      expect(entry.producerId).to.equal(producerId);
    });
    
    it('dovrebbe consumare un elemento dal buffer', async () => {
      const data = { id: 1, value: 'test' };
      const metadata = { timestamp: Date.now() };
      const producerId = 'producer-1';
      const consumerId = 'consumer-1';
      
      buffer.registerProducer(producerId);
      buffer.registerConsumer(consumerId);
      
      await buffer.publish(data, metadata, producerId);
      const result = await buffer.consume(consumerId);
      
      expect(result).to.be.an('object');
      expect(result.data).to.deep.equal(data);
      expect(result.metadata).to.deep.equal(metadata);
      expect(result.producerId).to.equal(producerId);
    });
    
    it('dovrebbe pubblicare e consumare elementi in ordine FIFO', async () => {
      const producerId = 'producer-1';
      const consumerId = 'consumer-1';
      
      buffer.registerProducer(producerId);
      buffer.registerConsumer(consumerId);
      
      // Pubblica 3 elementi
      await buffer.publish({ id: 1 }, {}, producerId);
      await buffer.publish({ id: 2 }, {}, producerId);
      await buffer.publish({ id: 3 }, {}, producerId);
      
      // Consuma gli elementi
      const result1 = await buffer.consume(consumerId);
      const result2 = await buffer.consume(consumerId);
      const result3 = await buffer.consume(consumerId);
      
      expect(result1.data.id).to.equal(1);
      expect(result2.data.id).to.equal(2);
      expect(result3.data.id).to.equal(3);
    });
    
    it('dovrebbe gestire la pubblicazione senza produttore', async () => {
      const data = { id: 1, value: 'test' };
      const index = await buffer.publish(data);
      
      expect(index).to.be.a('number');
      expect(index).to.be.greaterThan(-1);
      
      const entry = buffer.buffer[index];
      expect(entry.isReady()).to.be.true;
      expect(entry.data).to.deep.equal(data);
    });
    
    it('dovrebbe gestire il consumo senza consumatore', async () => {
      const data = { id: 1, value: 'test' };
      
      await buffer.publish(data);
      const result = await buffer.consume();
      
      expect(result).to.be.an('object');
      expect(result.data).to.deep.equal(data);
    });
    
    it('dovrebbe lanciare un errore se si pubblica con un produttore non registrato', async () => {
      try {
        await buffer.publish({}, {}, 'producer-nonexistent');
        expect.fail('Dovrebbe lanciare un errore');
      } catch (error) {
        expect(error.message).to.include('non registrato');
      }
    });
    
    it('dovrebbe lanciare un errore se si consuma con un consumatore non registrato', async () => {
      try {
        await buffer.consume('consumer-nonexistent');
        expect.fail('Dovrebbe lanciare un errore');
      } catch (error) {
        expect(error.message).to.include('non registrato');
      }
    });
  });
  
  describe('Gestione delle entry', () => {
    it('dovrebbe resettare una entry', async () => {
      const data = { id: 1, value: 'test' };
      const index = await buffer.publish(data);
      
      const result = buffer.resetEntry(index);
      
      expect(result).to.be.true;
      expect(buffer.buffer[index].isEmpty()).to.be.true;
      expect(buffer.buffer[index].data).to.be.null;
    });
    
    it('dovrebbe resettare tutte le entry', async () => {
      await buffer.publish({ id: 1 });
      await buffer.publish({ id: 2 });
      
      const count = buffer.resetAllEntries();
      
      expect(count).to.be.greaterThan(0);
      
      for (const entry of buffer.buffer) {
        expect(entry.isEmpty()).to.be.true;
      }
    });
    
    it('dovrebbe restituire false se si tenta di resettare una entry con indice non valido', () => {
      const result = buffer.resetEntry(-1);
      
      expect(result).to.be.false;
    });
  });
  
  describe('Statistiche', () => {
    it('dovrebbe fornire statistiche corrette', async () => {
      const producerId = 'producer-1';
      const consumerId = 'consumer-1';
      
      buffer.registerProducer(producerId);
      buffer.registerConsumer(consumerId);
      
      await buffer.publish({ id: 1 }, {}, producerId);
      await buffer.publish({ id: 2 }, {}, producerId);
      
      const stats = buffer.getStats();
      
      expect(stats).to.be.an('object');
      expect(stats.id).to.be.a('string');
      expect(stats.size).to.equal(128);
      expect(stats.entrySize).to.equal(1024);
      expect(stats.isOpen).to.be.true;
      expect(stats.entries).to.be.an('object');
      expect(stats.producers).to.be.an('object');
      expect(stats.producers.count).to.equal(1);
      expect(stats.consumers).to.be.an('object');
      expect(stats.consumers.count).to.equal(1);
      expect(stats.sequences).to.be.an('object');
    });
  });
  
  describe('Chiusura', () => {
    it('dovrebbe chiudere il buffer', () => {
      buffer.close();
      
      expect(buffer.isOpen).to.be.false;
    });
    
    it('dovrebbe lanciare un errore se si pubblica dopo la chiusura', async () => {
      buffer.close();
      
      try {
        await buffer.publish({ id: 1 });
        expect.fail('Dovrebbe lanciare un errore');
      } catch (error) {
        expect(error.message).to.include('chiuso');
      }
    });
    
    it('dovrebbe lanciare un errore se si consuma dopo la chiusura', async () => {
      buffer.close();
      
      try {
        await buffer.consume();
        expect.fail('Dovrebbe lanciare un errore');
      } catch (error) {
        expect(error.message).to.include('chiuso');
      }
    });
  });
});

describe('RingBufferWorker', function() {
  // Aumenta il timeout per i test più lunghi
  this.timeout(5000);
  
  let buffer;
  let worker;
  
  beforeEach(() => {
    // Crea un'istanza del buffer
    buffer = new SharedRingBuffer({
      size: 32,
      entrySize: 512
    });
    
    // Crea un'istanza del worker
    worker = new RingBufferWorker({
      workerId: 'worker-1',
      producerId: 'producer-1',
      consumerId: 'consumer-1',
      buffer,
      processFunction: async (items) => {
        return items.map(item => ({ processed: true, original: item }));
      },
      errorHandler: (error) => {
        console.error('Test error handler:', error);
      },
      batchSize: 5,
      pollInterval: 10
    });
  });
  
  afterEach(() => {
    // Cleanup
    if (worker && worker.isRunning) {
      worker.stop();
    }
    
    if (buffer) {
      buffer.close();
    }
    
    // Ripristina i mock
    sinon.restore();
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente il worker', () => {
      expect(worker).to.be.an.instanceOf(RingBufferWorker);
      expect(worker.options.workerId).to.equal('worker-1');
      expect(worker.options.producerId).to.equal('producer-1');
      expect(worker.options.consumerId).to.equal('consumer-1');
      expect(worker.options.batchSize).to.equal(5);
      expect(worker.options.pollInterval).to.equal(10);
      expect(worker.isRunning).to.be.false;
      expect(worker.processedCount).to.equal(0);
      expect(worker.errorCount).to.equal(0);
    });
  });
  
  describe('Avvio e arresto', () => {
    it('dovrebbe avviare il worker', () => {
      worker.start();
      
      expect(worker.isRunning).to.be.true;
      expect(worker.startTime).to.be.a('number');
    });
    
    it('dovrebbe fermare il worker', () => {
      worker.start();
      worker.stop();
      
      expect(worker.isRunning).to.be.false;
      expect(worker.stopTime).to.be.a('number');
    });
  });
  
  describe('Pubblicazione', () => {
    it('dovrebbe pubblicare un elemento nel buffer', async () => {
      // Spia il metodo publish del buffer
      const publishSpy = sinon.spy(buffer, 'publish');
      
      // Registra il produttore
      buffer.registerProducer('producer-1');
      
      // Pubblica un elemento
      const data = { id: 1, value: 'test' };
      const metadata = { timestamp: Date.now() };
      
      await worker.publish(data, metadata);
      
      // Verifica che il metodo publish sia stato chiamato
      expect(publishSpy.calledOnce).to.be.true;
      expect(publishSpy.firstCall.args[0]).to.deep.equal(data);
      expect(publishSpy.firstCall.args[1]).to.deep.equal(metadata);
      expect(publishSpy.firstCall.args[2]).to.equal('producer-1');
    });
  });
  
  describe('Elaborazione', () => {
    it('dovrebbe elaborare elementi dal buffer', async () => {
      // Spia il metodo consume del buffer
      const consumeSpy = sinon.stub(buffer, 'consume').resolves({
        data: { id: 1, value: 'test' },
        metadata: { timestamp: Date.now() }
      });
      
      // Spia la funzione di elaborazione
      const processFunctionSpy = sinon.spy(worker.options, 'processFunction');
      
      // Registra il consumatore
      buffer.registerConsumer('consumer-1');
      
      // Avvia il worker
      worker.start();
      
      // Attendi che il worker elabori almeno un elemento
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Ferma il worker
      worker.stop();
      
      // Verifica che il metodo consume sia stato chiamato
      expect(consumeSpy.called).to.be.true;
      
      // Verifica che la funzione di elaborazione sia stata chiamata
      expect(processFunctionSpy.called).to.be.true;
    });
  });
  
  describe('Statistiche', () => {
    it('dovrebbe fornire statistiche corrette', () => {
      worker.start();
      
      const stats = worker.getStats();
      
      expect(stats).to.be.an('object');
      expect(stats.workerId).to.equal('worker-1');
      expect(stats.producerId).to.equal('producer-1');
      expect(stats.consumerId).to.equal('consumer-1');
      expect(stats.isRunning).to.be.true;
      expect(stats.processedCount).to.equal(0);
      expect(stats.errorCount).to.equal(0);
      expect(stats.startTime).to.be.a('number');
      expect(stats.uptime).to.be.a('number');
      
      worker.stop();
    });
  });
});
