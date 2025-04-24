/**
 * Unit tests per il Parallel Sequencer
 * 
 * Questo file contiene i test unitari per il componente Parallel Sequencer
 * dell'architettura ad alte prestazioni del Layer-2 su Solana.
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { ParallelSequencer } = require('../../offchain/parallel-sequencer');
const { WorkerThreadPool } = require('../../offchain/worker-thread-pool');
const { SharedRingBuffer } = require('../../offchain/shared-ring-buffer');

describe('ParallelSequencer', function() {
  // Aumenta il timeout per i test più lunghi
  this.timeout(10000);
  
  let sequencer;
  let workerPool;
  let ringBuffer;
  
  beforeEach(() => {
    // Crea un mock del worker pool
    workerPool = {
      executeTask: sinon.stub().resolves({ success: true }),
      executeParallel: sinon.stub().resolves([{ success: true }, { success: true }]),
      on: sinon.stub(),
      getStats: sinon.stub().returns({
        workers: { total: 4, idle: 2, busy: 2 },
        tasks: { pending: 0, running: 2 }
      })
    };
    
    // Crea un mock del ring buffer
    ringBuffer = {
      publish: sinon.stub().resolves(0),
      consume: sinon.stub().resolves({ data: { txId: '123', payload: {} } }),
      on: sinon.stub(),
      registerProducer: sinon.stub().returns({ id: 'producer-1' }),
      registerConsumer: sinon.stub().returns({ id: 'consumer-1' }),
      getStats: sinon.stub().returns({
        size: 1024,
        usage: 0.1,
        entries: { ready: 100, empty: 924 }
      })
    };
    
    // Crea l'istanza del sequencer
    sequencer = new ParallelSequencer({
      workerPool,
      ringBuffer,
      maxConcurrency: 4,
      batchSize: 10
    });
  });
  
  afterEach(() => {
    // Cleanup
    if (sequencer && sequencer.isRunning) {
      sequencer.stop();
    }
    
    // Ripristina i mock
    sinon.restore();
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente il sequencer', () => {
      expect(sequencer).to.be.an.instanceOf(ParallelSequencer);
      expect(sequencer.isRunning).to.be.false;
      expect(sequencer.options.maxConcurrency).to.equal(4);
      expect(sequencer.options.batchSize).to.equal(10);
    });
    
    it('dovrebbe usare valori predefiniti se non specificati', () => {
      const defaultSequencer = new ParallelSequencer({
        workerPool,
        ringBuffer
      });
      
      expect(defaultSequencer.options.maxConcurrency).to.be.greaterThan(0);
      expect(defaultSequencer.options.batchSize).to.be.greaterThan(0);
    });
    
    it('dovrebbe lanciare un errore se manca il worker pool', () => {
      expect(() => new ParallelSequencer({
        ringBuffer
      })).to.throw(/workerPool/);
    });
    
    it('dovrebbe lanciare un errore se manca il ring buffer', () => {
      expect(() => new ParallelSequencer({
        workerPool
      })).to.throw(/ringBuffer/);
    });
  });
  
  describe('Avvio e arresto', () => {
    it('dovrebbe avviare il sequencer', () => {
      sequencer.start();
      
      expect(sequencer.isRunning).to.be.true;
      expect(ringBuffer.registerProducer.calledOnce).to.be.true;
      expect(ringBuffer.registerConsumer.calledOnce).to.be.true;
    });
    
    it('dovrebbe fermare il sequencer', () => {
      sequencer.start();
      sequencer.stop();
      
      expect(sequencer.isRunning).to.be.false;
    });
    
    it('non dovrebbe avviare il sequencer se è già in esecuzione', () => {
      sequencer.start();
      const result = sequencer.start();
      
      expect(result).to.be.false;
      expect(ringBuffer.registerProducer.calledOnce).to.be.true;
    });
    
    it('non dovrebbe fermare il sequencer se non è in esecuzione', () => {
      const result = sequencer.stop();
      
      expect(result).to.be.false;
    });
  });
  
  describe('Elaborazione delle transazioni', () => {
    it('dovrebbe accodare una transazione', async () => {
      const tx = {
        id: '123',
        sender: 'wallet1',
        recipient: 'wallet2',
        amount: 100,
        timestamp: Date.now()
      };
      
      await sequencer.queueTransaction(tx);
      
      expect(ringBuffer.publish.calledOnce).to.be.true;
      expect(ringBuffer.publish.firstCall.args[0]).to.deep.include({
        type: 'transaction',
        payload: tx
      });
    });
    
    it('dovrebbe elaborare una transazione', async () => {
      const tx = {
        id: '123',
        sender: 'wallet1',
        recipient: 'wallet2',
        amount: 100,
        timestamp: Date.now()
      };
      
      const result = await sequencer.processTransaction(tx);
      
      expect(result).to.deep.equal({ success: true });
      expect(workerPool.executeTask.calledOnce).to.be.true;
      expect(workerPool.executeTask.firstCall.args[0]).to.equal('process_transaction');
      expect(workerPool.executeTask.firstCall.args[1]).to.deep.equal(tx);
    });
    
    it('dovrebbe elaborare un batch di transazioni', async () => {
      const txs = [
        {
          id: '123',
          sender: 'wallet1',
          recipient: 'wallet2',
          amount: 100,
          timestamp: Date.now()
        },
        {
          id: '456',
          sender: 'wallet3',
          recipient: 'wallet4',
          amount: 200,
          timestamp: Date.now()
        }
      ];
      
      const result = await sequencer.processBatch(txs);
      
      expect(result).to.deep.equal([{ success: true }, { success: true }]);
      expect(workerPool.executeParallel.calledOnce).to.be.true;
      expect(workerPool.executeParallel.firstCall.args[0]).to.have.lengthOf(2);
      expect(workerPool.executeParallel.firstCall.args[0][0].type).to.equal('process_transaction');
      expect(workerPool.executeParallel.firstCall.args[0][0].data).to.deep.equal(txs[0]);
    });
  });
  
  describe('Gestione degli errori', () => {
    it('dovrebbe gestire gli errori durante l\'accodamento', async () => {
      ringBuffer.publish.rejects(new Error('Test error'));
      
      const tx = {
        id: '123',
        sender: 'wallet1',
        recipient: 'wallet2',
        amount: 100,
        timestamp: Date.now()
      };
      
      try {
        await sequencer.queueTransaction(tx);
        expect.fail('Dovrebbe lanciare un errore');
      } catch (error) {
        expect(error.message).to.include('Test error');
      }
    });
    
    it('dovrebbe gestire gli errori durante l\'elaborazione', async () => {
      workerPool.executeTask.rejects(new Error('Test error'));
      
      const tx = {
        id: '123',
        sender: 'wallet1',
        recipient: 'wallet2',
        amount: 100,
        timestamp: Date.now()
      };
      
      try {
        await sequencer.processTransaction(tx);
        expect.fail('Dovrebbe lanciare un errore');
      } catch (error) {
        expect(error.message).to.include('Test error');
      }
    });
  });
  
  describe('Metriche e statistiche', () => {
    it('dovrebbe fornire statistiche corrette', () => {
      const stats = sequencer.getStats();
      
      expect(stats).to.be.an('object');
      expect(stats.isRunning).to.be.false;
      expect(stats.workerPool).to.deep.equal({
        workers: { total: 4, idle: 2, busy: 2 },
        tasks: { pending: 0, running: 2 }
      });
      expect(stats.ringBuffer).to.deep.equal({
        size: 1024,
        usage: 0.1,
        entries: { ready: 100, empty: 924 }
      });
    });
  });
  
  describe('Integrazione con worker pool', () => {
    it('dovrebbe registrare i gestori di task nel worker pool', () => {
      // Crea un worker pool reale per questo test
      const realWorkerPool = new WorkerThreadPool({
        minWorkers: 1,
        maxWorkers: 2,
        workerScript: require.resolve('../../offchain/worker-thread.js')
      });
      
      // Spia il metodo executeTask
      const executeTaskSpy = sinon.spy(realWorkerPool, 'executeTask');
      
      // Crea un sequencer con il worker pool reale
      const realSequencer = new ParallelSequencer({
        workerPool: realWorkerPool,
        ringBuffer,
        maxConcurrency: 2
      });
      
      // Avvia il sequencer
      realSequencer.start();
      
      // Verifica che il sequencer abbia registrato i gestori
      expect(realSequencer.isRunning).to.be.true;
      
      // Ferma il sequencer e il worker pool
      realSequencer.stop();
      realWorkerPool.terminate();
    });
  });
  
  describe('Integrazione con ring buffer', () => {
    it('dovrebbe registrare produttori e consumatori nel ring buffer', () => {
      // Crea un ring buffer reale per questo test
      const realRingBuffer = new SharedRingBuffer({
        size: 128,
        entrySize: 1024
      });
      
      // Spia i metodi registerProducer e registerConsumer
      const registerProducerSpy = sinon.spy(realRingBuffer, 'registerProducer');
      const registerConsumerSpy = sinon.spy(realRingBuffer, 'registerConsumer');
      
      // Crea un sequencer con il ring buffer reale
      const realSequencer = new ParallelSequencer({
        workerPool,
        ringBuffer: realRingBuffer,
        maxConcurrency: 2
      });
      
      // Avvia il sequencer
      realSequencer.start();
      
      // Verifica che il sequencer abbia registrato produttori e consumatori
      expect(registerProducerSpy.calledOnce).to.be.true;
      expect(registerConsumerSpy.calledOnce).to.be.true;
      
      // Ferma il sequencer
      realSequencer.stop();
      
      // Chiudi il ring buffer
      realRingBuffer.close();
    });
  });
});
