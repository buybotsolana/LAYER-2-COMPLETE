/**
 * Test unitari per il Circuit Breaker Pattern
 */

const { CircuitBreaker } = require('../../offchain/circuit-breaker');
const { expect } = require('chai');
const sinon = require('sinon');

describe('CircuitBreaker', () => {
    let circuitBreaker;
    let clock;
    
    beforeEach(() => {
        // Crea un'istanza di CircuitBreaker con configurazione di test
        circuitBreaker = new CircuitBreaker({
            failureThreshold: 3,
            resetTimeout: 5000,
            logger: {
                info: sinon.spy(),
                warn: sinon.spy(),
                error: sinon.spy(),
                debug: sinon.spy()
            }
        });
        
        // Inizializza il circuit breaker
        return circuitBreaker.initialize();
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
    
    describe('initialize()', () => {
        it('dovrebbe inizializzare correttamente il circuit breaker', () => {
            expect(circuitBreaker.isInitialized).to.be.true;
            expect(circuitBreaker.services).to.be.an('object');
        });
    });
    
    describe('registerService()', () => {
        it('dovrebbe registrare un servizio correttamente', () => {
            const service = circuitBreaker.registerService('testService', {
                failureThreshold: 5,
                resetTimeout: 10000
            });
            
            expect(service).to.be.an('object');
            expect(service.name).to.equal('testService');
            expect(service.state).to.equal('closed');
            expect(service.failureCount).to.equal(0);
            expect(service.failureThreshold).to.equal(5);
            expect(service.resetTimeout).to.equal(10000);
        });
        
        it('dovrebbe lanciare un errore se il circuit breaker non è inizializzato', () => {
            const uninitializedCircuitBreaker = new CircuitBreaker();
            
            expect(() => uninitializedCircuitBreaker.registerService('testService')).to.throw(
                'Il circuit breaker non è inizializzato'
            );
        });
        
        it('dovrebbe lanciare un errore se il nome del servizio non è specificato', () => {
            expect(() => circuitBreaker.registerService()).to.throw(
                'Il nome del servizio è obbligatorio'
            );
        });
    });
    
    describe('executeWithBreaker()', () => {
        it('dovrebbe eseguire la funzione correttamente quando il circuit breaker è chiuso', async () => {
            const serviceName = 'testService';
            circuitBreaker.registerService(serviceName);
            
            const result = await circuitBreaker.executeWithBreaker(serviceName, () => {
                return 'success';
            });
            
            expect(result).to.equal('success');
            expect(circuitBreaker.services[serviceName].state).to.equal('closed');
            expect(circuitBreaker.services[serviceName].failureCount).to.equal(0);
        });
        
        it('dovrebbe incrementare il contatore di fallimenti quando la funzione fallisce', async () => {
            const serviceName = 'testService';
            circuitBreaker.registerService(serviceName);
            
            try {
                await circuitBreaker.executeWithBreaker(serviceName, () => {
                    throw new Error('Test error');
                });
                
                // La funzione dovrebbe lanciare un errore, quindi non dovremmo arrivare qui
                expect.fail('La funzione non ha lanciato un errore');
            } catch (error) {
                expect(error.message).to.equal('Test error');
                expect(circuitBreaker.services[serviceName].state).to.equal('closed');
                expect(circuitBreaker.services[serviceName].failureCount).to.equal(1);
            }
        });
        
        it('dovrebbe aprire il circuit breaker quando il numero di fallimenti supera la soglia', async () => {
            const serviceName = 'testService';
            circuitBreaker.registerService(serviceName, {
                failureThreshold: 2
            });
            
            // Prima esecuzione fallita
            try {
                await circuitBreaker.executeWithBreaker(serviceName, () => {
                    throw new Error('Test error');
                });
            } catch (error) {
                expect(error.message).to.equal('Test error');
                expect(circuitBreaker.services[serviceName].state).to.equal('closed');
                expect(circuitBreaker.services[serviceName].failureCount).to.equal(1);
            }
            
            // Seconda esecuzione fallita
            try {
                await circuitBreaker.executeWithBreaker(serviceName, () => {
                    throw new Error('Test error');
                });
            } catch (error) {
                expect(error.message).to.equal('Test error');
                expect(circuitBreaker.services[serviceName].state).to.equal('open');
                expect(circuitBreaker.services[serviceName].failureCount).to.equal(2);
            }
        });
        
        it('dovrebbe rifiutare le richieste quando il circuit breaker è aperto', async () => {
            const serviceName = 'testService';
            circuitBreaker.registerService(serviceName);
            
            // Imposta manualmente lo stato a 'open'
            circuitBreaker.services[serviceName].state = 'open';
            
            try {
                await circuitBreaker.executeWithBreaker(serviceName, () => {
                    return 'success';
                });
                
                // La funzione dovrebbe lanciare un errore, quindi non dovremmo arrivare qui
                expect.fail('La funzione non ha lanciato un errore');
            } catch (error) {
                expect(error.message).to.include('Circuit breaker is open');
            }
        });
        
        it('dovrebbe passare in stato half-open dopo il timeout di reset', async () => {
            const serviceName = 'testService';
            const resetTimeout = 1000; // 1 secondo
            
            circuitBreaker.registerService(serviceName, {
                resetTimeout
            });
            
            // Imposta manualmente lo stato a 'open'
            circuitBreaker.services[serviceName].state = 'open';
            circuitBreaker.services[serviceName].lastFailureTime = Date.now();
            
            // Avanza il tempo oltre il timeout di reset
            clock = sinon.useFakeTimers(Date.now());
            clock.tick(resetTimeout + 100);
            
            // La prossima esecuzione dovrebbe essere in stato half-open
            const result = await circuitBreaker.executeWithBreaker(serviceName, () => {
                return 'success';
            });
            
            expect(result).to.equal('success');
            expect(circuitBreaker.services[serviceName].state).to.equal('closed');
            expect(circuitBreaker.services[serviceName].failureCount).to.equal(0);
        });
        
        it('dovrebbe tornare in stato open se fallisce in stato half-open', async () => {
            const serviceName = 'testService';
            const resetTimeout = 1000; // 1 secondo
            
            circuitBreaker.registerService(serviceName, {
                resetTimeout
            });
            
            // Imposta manualmente lo stato a 'open'
            circuitBreaker.services[serviceName].state = 'open';
            circuitBreaker.services[serviceName].lastFailureTime = Date.now();
            
            // Avanza il tempo oltre il timeout di reset
            clock = sinon.useFakeTimers(Date.now());
            clock.tick(resetTimeout + 100);
            
            // La prossima esecuzione dovrebbe essere in stato half-open
            try {
                await circuitBreaker.executeWithBreaker(serviceName, () => {
                    throw new Error('Test error');
                });
                
                // La funzione dovrebbe lanciare un errore, quindi non dovremmo arrivare qui
                expect.fail('La funzione non ha lanciato un errore');
            } catch (error) {
                expect(error.message).to.equal('Test error');
                expect(circuitBreaker.services[serviceName].state).to.equal('open');
                expect(circuitBreaker.services[serviceName].failureCount).to.equal(1);
            }
        });
    });
    
    describe('getStatus()', () => {
        it('dovrebbe restituire lo stato corrente del circuit breaker', () => {
            const serviceName = 'testService';
            circuitBreaker.registerService(serviceName);
            
            const status = circuitBreaker.getStatus();
            
            expect(status).to.be.an('object');
            expect(status.isInitialized).to.be.true;
            expect(status.services).to.be.an('array');
            expect(status.services[0].name).to.equal(serviceName);
            expect(status.services[0].state).to.equal('closed');
        });
    });
    
    describe('getMetrics()', () => {
        it('dovrebbe restituire le metriche correnti del circuit breaker', () => {
            const serviceName = 'testService';
            circuitBreaker.registerService(serviceName);
            
            const metrics = circuitBreaker.getMetrics();
            
            expect(metrics).to.be.an('object');
            expect(metrics.services).to.be.an('object');
            expect(metrics.services[serviceName]).to.be.an('object');
            expect(metrics.services[serviceName].successCount).to.equal(0);
            expect(metrics.services[serviceName].failureCount).to.equal(0);
            expect(metrics.services[serviceName].rejectionCount).to.equal(0);
            expect(metrics.services[serviceName].timeouts).to.equal(0);
        });
    });
    
    describe('resetService()', () => {
        it('dovrebbe resettare lo stato di un servizio', () => {
            const serviceName = 'testService';
            circuitBreaker.registerService(serviceName);
            
            // Imposta manualmente lo stato a 'open'
            circuitBreaker.services[serviceName].state = 'open';
            circuitBreaker.services[serviceName].failureCount = 5;
            
            circuitBreaker.resetService(serviceName);
            
            expect(circuitBreaker.services[serviceName].state).to.equal('closed');
            expect(circuitBreaker.services[serviceName].failureCount).to.equal(0);
        });
        
        it('dovrebbe lanciare un errore se il servizio non esiste', () => {
            expect(() => circuitBreaker.resetService('nonExistentService')).to.throw(
                'Servizio non trovato: nonExistentService'
            );
        });
    });
});
