/**
 * Test unitari per il Retry Manager
 */

const { RetryManager } = require('../../offchain/retry-manager');
const { expect } = require('chai');
const sinon = require('sinon');

describe('RetryManager', () => {
    let retryManager;
    let clock;
    
    beforeEach(() => {
        // Crea un'istanza di RetryManager con configurazione di test
        retryManager = new RetryManager({
            maxRetries: 3,
            initialDelay: 100,
            maxDelay: 1000,
            backoffFactor: 2,
            logger: {
                info: sinon.spy(),
                warn: sinon.spy(),
                error: sinon.spy(),
                debug: sinon.spy()
            }
        });
    });
    
    afterEach(() => {
        // Ripristina il clock se è stato utilizzato
        if (clock) {
            clock.restore();
            clock = null;
        }
        
        // Ripristina tutti i mock
        sinon.restore();
    });
    
    describe('executeWithRetry()', () => {
        it('dovrebbe eseguire la funzione correttamente al primo tentativo', async () => {
            const operation = sinon.stub().resolves('success');
            
            const result = await retryManager.executeWithRetry(operation);
            
            expect(result).to.equal('success');
            expect(operation.callCount).to.equal(1);
        });
        
        it('dovrebbe riprovare quando la funzione fallisce', async () => {
            const operation = sinon.stub();
            operation.onFirstCall().rejects(new Error('Test error'));
            operation.onSecondCall().resolves('success');
            
            clock = sinon.useFakeTimers();
            
            const resultPromise = retryManager.executeWithRetry(operation);
            
            // Avanza il tempo per permettere il primo retry
            await clock.tickAsync(100);
            
            const result = await resultPromise;
            
            expect(result).to.equal('success');
            expect(operation.callCount).to.equal(2);
        });
        
        it('dovrebbe utilizzare il backoff esponenziale per i ritardi', async () => {
            const operation = sinon.stub();
            operation.onFirstCall().rejects(new Error('Test error 1'));
            operation.onSecondCall().rejects(new Error('Test error 2'));
            operation.onThirdCall().rejects(new Error('Test error 3'));
            operation.onCall(3).resolves('success');
            
            clock = sinon.useFakeTimers();
            
            const resultPromise = retryManager.executeWithRetry(operation);
            
            // Avanza il tempo per permettere il primo retry (100ms)
            await clock.tickAsync(100);
            
            // Avanza il tempo per permettere il secondo retry (200ms)
            await clock.tickAsync(200);
            
            // Avanza il tempo per permettere il terzo retry (400ms)
            await clock.tickAsync(400);
            
            const result = await resultPromise;
            
            expect(result).to.equal('success');
            expect(operation.callCount).to.equal(4);
        });
        
        it('dovrebbe fallire dopo aver esaurito i tentativi', async () => {
            const operation = sinon.stub().rejects(new Error('Test error'));
            
            clock = sinon.useFakeTimers();
            
            const resultPromise = retryManager.executeWithRetry(operation);
            
            // Avanza il tempo per permettere tutti i retry
            await clock.tickAsync(100); // Primo retry
            await clock.tickAsync(200); // Secondo retry
            await clock.tickAsync(400); // Terzo retry
            
            try {
                await resultPromise;
                
                // La funzione dovrebbe lanciare un errore, quindi non dovremmo arrivare qui
                expect.fail('La funzione non ha lanciato un errore');
            } catch (error) {
                expect(error.message).to.equal('Test error');
                expect(operation.callCount).to.equal(4); // Tentativo iniziale + 3 retry
            }
        });
        
        it('dovrebbe rispettare il maxDelay configurato', async () => {
            const customRetryManager = new RetryManager({
                maxRetries: 5,
                initialDelay: 100,
                maxDelay: 300,
                backoffFactor: 2
            });
            
            const operation = sinon.stub();
            operation.onFirstCall().rejects(new Error('Test error 1'));
            operation.onSecondCall().rejects(new Error('Test error 2'));
            operation.onThirdCall().rejects(new Error('Test error 3'));
            operation.onCall(3).rejects(new Error('Test error 4'));
            operation.onCall(4).resolves('success');
            
            clock = sinon.useFakeTimers();
            
            const resultPromise = customRetryManager.executeWithRetry(operation);
            
            // Avanza il tempo per permettere il primo retry (100ms)
            await clock.tickAsync(100);
            
            // Avanza il tempo per permettere il secondo retry (200ms)
            await clock.tickAsync(200);
            
            // Avanza il tempo per permettere il terzo retry (300ms, non 400ms a causa del maxDelay)
            await clock.tickAsync(300);
            
            // Avanza il tempo per permettere il quarto retry (300ms, non 800ms a causa del maxDelay)
            await clock.tickAsync(300);
            
            const result = await resultPromise;
            
            expect(result).to.equal('success');
            expect(operation.callCount).to.equal(5);
        });
        
        it('dovrebbe applicare jitter se configurato', async () => {
            const jitterRetryManager = new RetryManager({
                maxRetries: 3,
                initialDelay: 100,
                maxDelay: 1000,
                backoffFactor: 2,
                jitter: true
            });
            
            const operation = sinon.stub();
            operation.onFirstCall().rejects(new Error('Test error'));
            operation.onSecondCall().resolves('success');
            
            // Mock Math.random per avere un comportamento deterministico
            const randomStub = sinon.stub(Math, 'random').returns(0.5);
            
            clock = sinon.useFakeTimers();
            
            const resultPromise = jitterRetryManager.executeWithRetry(operation);
            
            // Con jitter e Math.random = 0.5, il delay dovrebbe essere 100 * (1 + 0.5) = 150ms
            await clock.tickAsync(150);
            
            const result = await resultPromise;
            
            expect(result).to.equal('success');
            expect(operation.callCount).to.equal(2);
            expect(randomStub.called).to.be.true;
        });
    });
    
    describe('executeWithRetryAndTimeout()', () => {
        it('dovrebbe eseguire la funzione correttamente entro il timeout', async () => {
            const operation = sinon.stub().resolves('success');
            
            const result = await retryManager.executeWithRetryAndTimeout(operation, 1000);
            
            expect(result).to.equal('success');
            expect(operation.callCount).to.equal(1);
        });
        
        it('dovrebbe fallire se l\'operazione supera il timeout', async () => {
            const operation = () => new Promise(resolve => setTimeout(() => resolve('success'), 2000));
            
            clock = sinon.useFakeTimers();
            
            const resultPromise = retryManager.executeWithRetryAndTimeout(operation, 1000);
            
            // Avanza il tempo oltre il timeout
            await clock.tickAsync(1100);
            
            try {
                await resultPromise;
                
                // La funzione dovrebbe lanciare un errore, quindi non dovremmo arrivare qui
                expect.fail('La funzione non ha lanciato un errore');
            } catch (error) {
                expect(error.message).to.include('Timeout');
            }
        });
    });
    
    describe('getMetrics()', () => {
        it('dovrebbe restituire le metriche correnti', async () => {
            const operation = sinon.stub().resolves('success');
            
            await retryManager.executeWithRetry(operation);
            
            const metrics = retryManager.getMetrics();
            
            expect(metrics).to.be.an('object');
            expect(metrics.totalOperations).to.equal(1);
            expect(metrics.successfulOperations).to.equal(1);
            expect(metrics.failedOperations).to.equal(0);
            expect(metrics.totalRetries).to.equal(0);
        });
        
        it('dovrebbe aggiornare correttamente le metriche dopo i retry', async () => {
            const operation = sinon.stub();
            operation.onFirstCall().rejects(new Error('Test error'));
            operation.onSecondCall().resolves('success');
            
            clock = sinon.useFakeTimers();
            
            const resultPromise = retryManager.executeWithRetry(operation);
            
            // Avanza il tempo per permettere il retry
            await clock.tickAsync(100);
            
            await resultPromise;
            
            const metrics = retryManager.getMetrics();
            
            expect(metrics.totalOperations).to.equal(1);
            expect(metrics.successfulOperations).to.equal(1);
            expect(metrics.failedOperations).to.equal(0);
            expect(metrics.totalRetries).to.equal(1);
        });
        
        it('dovrebbe aggiornare correttamente le metriche dopo un fallimento', async () => {
            const operation = sinon.stub().rejects(new Error('Test error'));
            
            clock = sinon.useFakeTimers();
            
            const resultPromise = retryManager.executeWithRetry(operation);
            
            // Avanza il tempo per permettere tutti i retry
            await clock.tickAsync(100); // Primo retry
            await clock.tickAsync(200); // Secondo retry
            await clock.tickAsync(400); // Terzo retry
            
            try {
                await resultPromise;
            } catch (error) {
                // Ignora l'errore, ci interessa solo verificare le metriche
            }
            
            const metrics = retryManager.getMetrics();
            
            expect(metrics.totalOperations).to.equal(1);
            expect(metrics.successfulOperations).to.equal(0);
            expect(metrics.failedOperations).to.equal(1);
            expect(metrics.totalRetries).to.equal(3);
        });
    });
    
    describe('resetMetrics()', () => {
        it('dovrebbe resettare tutte le metriche', async () => {
            const operation = sinon.stub().resolves('success');
            
            await retryManager.executeWithRetry(operation);
            
            retryManager.resetMetrics();
            
            const metrics = retryManager.getMetrics();
            
            expect(metrics.totalOperations).to.equal(0);
            expect(metrics.successfulOperations).to.equal(0);
            expect(metrics.failedOperations).to.equal(0);
            expect(metrics.totalRetries).to.equal(0);
        });
    });
});
