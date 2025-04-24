/**
 * Unit tests per il Worker Thread Pool
 * 
 * Questo file contiene i test unitari per il componente Worker Thread Pool
 * dell'architettura ad alte prestazioni del Layer-2 su Solana.
 */

const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const { WorkerThreadPool, Task, TaskQueue } = require('../../offchain/worker-thread-pool');

describe('WorkerThreadPool', function() {
  // Aumenta il timeout per i test più lunghi
  this.timeout(15000);
  
  let pool;
  
  beforeEach(() => {
    // Crea un'istanza del pool con configurazione minima per i test
    pool = new WorkerThreadPool({
      minWorkers: 1,
      maxWorkers: 2,
      workerScript: path.join(__dirname, '../../offchain/worker-thread.js'),
      taskQueueSize: 100,
      taskTimeout: 1000,
      workerIdleTimeout: 2000,
      enableMetrics: false
    });
  });
  
  afterEach(async () => {
    // Cleanup
    if (pool) {
      await pool.terminate();
    }
    
    // Ripristina i mock
    sinon.restore();
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente il pool', () => {
      expect(pool).to.be.an.instanceOf(WorkerThreadPool);
      expect(pool.isRunning).to.be.true;
      expect(pool.options.minWorkers).to.equal(1);
      expect(pool.options.maxWorkers).to.equal(2);
      expect(pool.options.taskQueueSize).to.equal(100);
      expect(pool.workers.size).to.equal(1);
    });
    
    it('dovrebbe usare valori predefiniti se non specificati', () => {
      const defaultPool = new WorkerThreadPool();
      
      expect(defaultPool.options.minWorkers).to.be.greaterThan(0);
      expect(defaultPool.options.maxWorkers).to.be.greaterThan(0);
      expect(defaultPool.options.taskQueueSize).to.be.greaterThan(0);
      expect(defaultPool.workers.size).to.equal(defaultPool.options.minWorkers);
      
      // Cleanup
      defaultPool.terminate();
    });
  });
  
  describe('Gestione dei task', () => {
    it('dovrebbe eseguire un task semplice', async () => {
      const result = await pool.executeTask('echo', { message: 'Hello, World!' });
      
      expect(result).to.deep.include({ message: 'Hello, World!' });
    });
    
    it('dovrebbe eseguire più task in parallelo', async () => {
      const tasks = [
        { type: 'echo', data: { message: 'Task 1' }, options: {} },
        { type: 'echo', data: { message: 'Task 2' }, options: {} },
        { type: 'echo', data: { message: 'Task 3' }, options: {} }
      ];
      
      const results = await pool.executeParallel(tasks);
      
      expect(results).to.be.an('array').with.lengthOf(3);
      expect(results[0]).to.deep.include({ message: 'Task 1' });
      expect(results[1]).to.deep.include({ message: 'Task 2' });
      expect(results[2]).to.deep.include({ message: 'Task 3' });
    });
    
    it('dovrebbe gestire gli errori nei task', async () => {
      try {
        await pool.executeTask('error', { message: 'Test error' });
        expect.fail('Dovrebbe lanciare un errore');
      } catch (error) {
        expect(error.message).to.include('Test error');
      }
    });
    
    it('dovrebbe annullare un task', async () => {
      // Crea un task che dura a lungo
      const taskPromise = pool.executeTask('sleep', { duration: 5000 });
      
      // Attendi un po' per assicurarsi che il task sia iniziato
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Ottieni lo stato di tutti i task
      const allTasks = pool.getAllTaskStatus();
      
      // Trova il task in esecuzione
      const runningTask = allTasks.running[0];
      
      if (runningTask) {
        // Annulla il task
        const result = pool.cancelTask(runningTask.id);
        expect(result).to.be.true;
      }
      
      try {
        await taskPromise;
        expect.fail('Il task dovrebbe essere stato annullato');
      } catch (error) {
        expect(error.message).to.include('cancelled');
      }
    });
  });
  
  describe('Ridimensionamento del pool', () => {
    it('dovrebbe ridimensionare il pool', () => {
      const result = pool.resize({ minWorkers: 2, maxWorkers: 4 });
      
      expect(result).to.be.true;
      expect(pool.options.minWorkers).to.equal(2);
      expect(pool.options.maxWorkers).to.equal(4);
      
      // Verifica che il numero di worker sia stato aggiornato
      expect(pool.workers.size).to.be.at.least(2);
    });
    
    it('dovrebbe gestire valori non validi', () => {
      const result = pool.resize({ minWorkers: 5, maxWorkers: 3 });
      
      expect(result).to.be.true;
      expect(pool.options.minWorkers).to.equal(3);
      expect(pool.options.maxWorkers).to.equal(3);
    });
  });
  
  describe('Statistiche', () => {
    it('dovrebbe fornire statistiche corrette', () => {
      const stats = pool.getStats();
      
      expect(stats).to.be.an('object');
      expect(stats.id).to.be.a('string');
      expect(stats.isRunning).to.be.true;
      expect(stats.workers).to.be.an('object');
      expect(stats.workers.total).to.equal(1);
      expect(stats.tasks).to.be.an('object');
    });
    
    it('dovrebbe fornire lo stato di tutti i worker', () => {
      const workerStatus = pool.getAllWorkerStatus();
      
      expect(workerStatus).to.be.an('array').with.lengthOf(1);
      expect(workerStatus[0]).to.be.an('object');
      expect(workerStatus[0].id).to.be.a('string');
      expect(workerStatus[0].status).to.be.a('string');
    });
    
    it('dovrebbe fornire lo stato di tutti i task', () => {
      const taskStatus = pool.getAllTaskStatus();
      
      expect(taskStatus).to.be.an('object');
      expect(taskStatus.pending).to.be.an('array');
      expect(taskStatus.running).to.be.an('array');
    });
  });
  
  describe('Terminazione', () => {
    it('dovrebbe terminare il pool', async () => {
      const result = await pool.terminate();
      
      expect(result).to.be.true;
      expect(pool.isRunning).to.be.false;
      expect(pool.workers.size).to.equal(0);
    });
    
    it('dovrebbe gestire la terminazione di un pool già terminato', async () => {
      await pool.terminate();
      const result = await pool.terminate();
      
      expect(result).to.be.false;
    });
  });
});

describe('Task', function() {
  let task;
  
  beforeEach(() => {
    task = new Task('task-1', 'test', { value: 'test-data' }, {
      priority: 10,
      timeout: 1000,
      maxRetries: 3
    });
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente un task', () => {
      expect(task.id).to.equal('task-1');
      expect(task.type).to.equal('test');
      expect(task.data).to.deep.equal({ value: 'test-data' });
      expect(task.priority).to.equal(10);
      expect(task.status).to.equal('pending');
      expect(task.retries).to.equal(0);
      expect(task.maxRetries).to.equal(3);
      expect(task.timeout).to.equal(1000);
    });
    
    it('dovrebbe generare un ID se non fornito', () => {
      const autoIdTask = new Task(null, 'test', {});
      
      expect(autoIdTask.id).to.be.a('string');
      expect(autoIdTask.id).to.include('task-');
    });
  });
  
  describe('Gestione dello stato', () => {
    it('dovrebbe aggiornare lo stato', () => {
      task.setStatus('running');
      
      expect(task.status).to.equal('running');
      expect(task.startedAt).to.be.a('number');
      
      task.setStatus('completed');
      
      expect(task.status).to.equal('completed');
      expect(task.completedAt).to.be.a('number');
    });
    
    it('dovrebbe impostare il risultato', () => {
      const result = { success: true };
      const onSuccessSpy = sinon.spy();
      const onCompleteSpy = sinon.spy();
      
      task.callbacks.onSuccess = onSuccessSpy;
      task.callbacks.onComplete = onCompleteSpy;
      
      task.setResult(result);
      
      expect(task.result).to.equal(result);
      expect(task.status).to.equal('completed');
      expect(onSuccessSpy.calledOnce).to.be.true;
      expect(onSuccessSpy.calledWith(result, task)).to.be.true;
      expect(onCompleteSpy.calledOnce).to.be.true;
      expect(onCompleteSpy.calledWith(result, null, task)).to.be.true;
    });
    
    it('dovrebbe impostare l\'errore', () => {
      const error = new Error('Test error');
      const onErrorSpy = sinon.spy();
      const onCompleteSpy = sinon.spy();
      
      task.callbacks.onError = onErrorSpy;
      task.callbacks.onComplete = onCompleteSpy;
      
      task.setError(error);
      
      expect(task.error).to.equal(error);
      expect(task.status).to.equal('failed');
      expect(onErrorSpy.calledOnce).to.be.true;
      expect(onErrorSpy.calledWith(error, task)).to.be.true;
      expect(onCompleteSpy.calledOnce).to.be.true;
      expect(onCompleteSpy.calledWith(null, error, task)).to.be.true;
    });
    
    it('dovrebbe annullare il task', () => {
      const onCancelSpy = sinon.spy();
      const onCompleteSpy = sinon.spy();
      
      task.callbacks.onCancel = onCancelSpy;
      task.callbacks.onComplete = onCompleteSpy;
      
      const result = task.cancel();
      
      expect(result).to.be.true;
      expect(task.status).to.equal('cancelled');
      expect(onCancelSpy.calledOnce).to.be.true;
      expect(onCancelSpy.calledWith(task)).to.be.true;
      expect(onCompleteSpy.calledOnce).to.be.true;
      expect(onCompleteSpy.firstCall.args[0]).to.be.null;
      expect(onCompleteSpy.firstCall.args[1]).to.be.an.instanceOf(Error);
      expect(onCompleteSpy.firstCall.args[1].message).to.include('cancelled');
    });
    
    it('dovrebbe gestire il timeout', (done) => {
      const onTimeoutSpy = sinon.spy();
      const onErrorSpy = sinon.spy();
      
      task.callbacks.onTimeout = onTimeoutSpy;
      task.callbacks.onError = onErrorSpy;
      
      // Imposta un timeout breve per il test
      task.timeout = 50;
      
      // Imposta lo stato a running
      task.setStatus('running');
      
      // Imposta il timeout
      task.setTimeout();
      
      // Attendi che il timeout scada
      setTimeout(() => {
        expect(task.status).to.equal('failed');
        expect(task.error).to.be.an.instanceOf(Error);
        expect(task.error.message).to.include('timeout');
        expect(onTimeoutSpy.calledOnce).to.be.true;
        expect(onTimeoutSpy.calledWith(task)).to.be.true;
        expect(onErrorSpy.calledOnce).to.be.true;
        expect(onErrorSpy.firstCall.args[0]).to.be.an.instanceOf(Error);
        expect(onErrorSpy.firstCall.args[0].message).to.include('timeout');
        done();
      }, 100);
    });
  });
  
  describe('Gestione dei tentativi', () => {
    it('dovrebbe incrementare i tentativi', () => {
      const count = task.incrementRetries();
      
      expect(count).to.equal(1);
      expect(task.retries).to.equal(1);
    });
    
    it('dovrebbe verificare se il task può essere ritentato', () => {
      expect(task.canRetry()).to.be.true;
      
      task.retries = 3;
      
      expect(task.canRetry()).to.be.false;
    });
  });
  
  describe('Gestione delle dipendenze', () => {
    it('dovrebbe aggiungere una dipendenza', () => {
      task.addDependency('dep-1');
      
      expect(task.dependencies).to.include('dep-1');
    });
    
    it('dovrebbe aggiungere un dipendente', () => {
      task.addDependent('dep-1');
      
      expect(task.dependents).to.include('dep-1');
    });
    
    it('dovrebbe rimuovere una dipendenza', () => {
      task.addDependency('dep-1');
      task.removeDependency('dep-1');
      
      expect(task.dependencies).to.not.include('dep-1');
    });
    
    it('dovrebbe rimuovere un dipendente', () => {
      task.addDependent('dep-1');
      task.removeDependent('dep-1');
      
      expect(task.dependents).to.not.include('dep-1');
    });
    
    it('dovrebbe verificare se il task ha dipendenze', () => {
      expect(task.hasDependencies()).to.be.false;
      
      task.addDependency('dep-1');
      
      expect(task.hasDependencies()).to.be.true;
    });
    
    it('dovrebbe verificare se il task ha dipendenti', () => {
      expect(task.hasDependents()).to.be.false;
      
      task.addDependent('dep-1');
      
      expect(task.hasDependents()).to.be.true;
    });
  });
  
  describe('Verifica dello stato', () => {
    it('dovrebbe verificare se il task è in attesa', () => {
      expect(task.isPending()).to.be.true;
      
      task.setStatus('running');
      
      expect(task.isPending()).to.be.false;
    });
    
    it('dovrebbe verificare se il task è in esecuzione', () => {
      expect(task.isRunning()).to.be.false;
      
      task.setStatus('running');
      
      expect(task.isRunning()).to.be.true;
    });
    
    it('dovrebbe verificare se il task è completato', () => {
      expect(task.isCompleted()).to.be.false;
      
      task.setStatus('completed');
      
      expect(task.isCompleted()).to.be.true;
    });
    
    it('dovrebbe verificare se il task è fallito', () => {
      expect(task.isFailed()).to.be.false;
      
      task.setStatus('failed');
      
      expect(task.isFailed()).to.be.true;
    });
    
    it('dovrebbe verificare se il task è annullato', () => {
      expect(task.isCancelled()).to.be.false;
      
      task.setStatus('cancelled');
      
      expect(task.isCancelled()).to.be.true;
    });
    
    it('dovrebbe verificare se il task è terminato', () => {
      expect(task.isFinished()).to.be.false;
      
      task.setStatus('completed');
      
      expect(task.isFinished()).to.be.true;
      
      task.setStatus('failed');
      
      expect(task.isFinished()).to.be.true;
      
      task.setStatus('cancelled');
      
      expect(task.isFinished()).to.be.true;
    });
  });
  
  describe('Calcolo dei tempi', () => {
    it('dovrebbe calcolare la durata del task', () => {
      task.setStatus('running');
      
      // Simula il passaggio del tempo
      const startTime = task.startedAt;
      task.startedAt = startTime - 1000;
      
      const duration = task.getDuration();
      
      expect(duration).to.be.at.least(1000);
    });
    
    it('dovrebbe calcolare il tempo di attesa del task', () => {
      // Simula il passaggio del tempo
      const createdAt = task.createdAt;
      task.createdAt = createdAt - 1000;
      
      const waitTime = task.getWaitTime();
      
      expect(waitTime).to.be.at.least(1000);
    });
    
    it('dovrebbe calcolare il tempo totale del task', () => {
      // Simula il passaggio del tempo
      const createdAt = task.createdAt;
      task.createdAt = createdAt - 1000;
      
      const totalTime = task.getTotalTime();
      
      expect(totalTime).to.be.at.least(1000);
    });
  });
  
  describe('Serializzazione', () => {
    it('dovrebbe serializzare il task', () => {
      const serialized = task.serialize();
      
      expect(serialized).to.be.an('object');
      expect(serialized.id).to.equal('task-1');
      expect(serialized.type).to.equal('test');
      expect(serialized.data).to.deep.equal({ value: 'test-data' });
      expect(serialized.priority).to.equal(10);
      expect(serialized.status).to.equal('pending');
    });
    
    it('dovrebbe deserializzare il task', () => {
      const serialized = task.serialize();
      const deserialized = Task.deserialize(serialized);
      
      expect(deserialized).to.be.an.instanceOf(Task);
      expect(deserialized.id).to.equal('task-1');
      expect(deserialized.type).to.equal('test');
      expect(deserialized.data).to.deep.equal({ value: 'test-data' });
      expect(deserialized.priority).to.equal(10);
      expect(deserialized.status).to.equal('pending');
    });
  });
});

describe('TaskQueue', function() {
  let queue;
  
  beforeEach(() => {
    queue = new TaskQueue({ maxSize: 100 });
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente una coda', () => {
      expect(queue).to.be.an.instanceOf(TaskQueue);
      expect(queue.options.maxSize).to.equal(100);
      expect(queue.queue).to.be.an('array').that.is.empty;
      expect(queue.taskMap).to.be.an.instanceOf(Map).that.is.empty;
      expect(queue.dependencyGraph).to.be.an.instanceOf(Map).that.is.empty;
    });
  });
  
  describe('Gestione dei task', () => {
    it('dovrebbe aggiungere un task alla coda', () => {
      const task = new Task('task-1', 'test', {});
      const result = queue.enqueue(task);
      
      expect(result).to.be.true;
      expect(queue.size()).to.equal(1);
      expect(queue.hasTask('task-1')).to.be.true;
      expect(queue.getTask('task-1')).to.equal(task);
    });
    
    it('dovrebbe rimuovere un task dalla coda', () => {
      const task = new Task('task-1', 'test', {});
      queue.enqueue(task);
      
      const removedTask = queue.remove('task-1');
      
      expect(removedTask).to.equal(task);
      expect(queue.size()).to.equal(0);
      expect(queue.hasTask('task-1')).to.be.false;
    });
    
    it('dovrebbe ottenere il prossimo task dalla coda', () => {
      const task1 = new Task('task-1', 'test', {});
      const task2 = new Task('task-2', 'test', {});
      
      queue.enqueue(task1);
      queue.enqueue(task2);
      
      const nextTask = queue.dequeue();
      
      expect(nextTask).to.equal(task1);
      expect(queue.size()).to.equal(1);
      expect(queue.hasTask('task-1')).to.be.false;
      expect(queue.hasTask('task-2')).to.be.true;
    });
    
    it('dovrebbe gestire le dipendenze tra task', () => {
      const task1 = new Task('task-1', 'test', {});
      const task2 = new Task('task-2', 'test', {}, { dependencies: ['task-1'] });
      
      queue.enqueue(task1);
      queue.enqueue(task2);
      
      // Il primo task dovrebbe essere task1 perché task2 dipende da task1
      const nextTask = queue.dequeue();
      
      expect(nextTask).to.equal(task1);
      
      // Notifica il completamento di task1
      queue.notifyTaskCompletion('task-1');
      
      // Ora task2 dovrebbe essere disponibile
      const nextTask2 = queue.dequeue();
      
      expect(nextTask2).to.equal(task2);
    });
    
    it('dovrebbe aggiornare la priorità di un task', () => {
      const task1 = new Task('task-1', 'test', {}, { priority: 1 });
      const task2 = new Task('task-2', 'test', {}, { priority: 2 });
      
      queue.enqueue(task1);
      queue.enqueue(task2);
      
      // Il primo task dovrebbe essere task2 perché ha priorità più alta
      let nextTask = queue.dequeue();
      expect(nextTask).to.equal(task2);
      
      // Riaggiungi task2 alla coda
      queue.enqueue(task2);
      
      // Aggiorna la priorità di task1
      queue.updatePriority('task-1', 3);
      
      // Ora il primo task dovrebbe essere task1 perché ha priorità più alta
      nextTask = queue.dequeue();
      expect(nextTask).to.equal(task1);
    });
  });
  
  describe('Statistiche', () => {
    it('dovrebbe fornire statistiche corrette', () => {
      const task1 = new Task('task-1', 'test', {}, { priority: 1 });
      const task2 = new Task('task-2', 'test', {}, { priority: 2 });
      
      queue.enqueue(task1);
      queue.enqueue(task2);
      
      const stats = queue.getStats();
      
      expect(stats).to.be.an('object');
      expect(stats.size).to.equal(2);
      expect(stats.maxSize).to.equal(100);
      expect(stats.usage).to.equal(0.02);
      expect(stats.statusCount).to.be.an('object');
      expect(stats.statusCount.pending).to.equal(2);
    });
  });
});
