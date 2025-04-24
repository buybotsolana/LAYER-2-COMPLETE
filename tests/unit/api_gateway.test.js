/**
 * Test unitari per l'API Gateway
 */

const { ApiGateway } = require('../../offchain/api-gateway');
const { CircuitBreaker } = require('../../offchain/circuit-breaker');
const { RetryManager } = require('../../offchain/retry-manager');
const { GracefulDegradation } = require('../../offchain/graceful-degradation');
const { expect } = require('chai');
const sinon = require('sinon');
const express = require('express');
const request = require('supertest');

describe('ApiGateway', () => {
    let apiGateway;
    let circuitBreaker;
    let retryManager;
    let gracefulDegradation;
    let app;
    
    beforeEach(async () => {
        // Crea le dipendenze
        circuitBreaker = new CircuitBreaker({
            logger: {
                info: sinon.spy(),
                warn: sinon.spy(),
                error: sinon.spy(),
                debug: sinon.spy()
            }
        });
        
        retryManager = new RetryManager({
            logger: {
                info: sinon.spy(),
                warn: sinon.spy(),
                error: sinon.spy(),
                debug: sinon.spy()
            }
        });
        
        gracefulDegradation = new GracefulDegradation({
            logger: {
                info: sinon.spy(),
                warn: sinon.spy(),
                error: sinon.spy(),
                debug: sinon.spy()
            }
        });
        
        // Inizializza le dipendenze
        await circuitBreaker.initialize();
        await gracefulDegradation.initialize();
        
        // Crea un'istanza di ApiGateway con configurazione di test
        apiGateway = new ApiGateway({
            port: 0, // Porta casuale
            circuitBreaker,
            retryManager,
            gracefulDegradation,
            logger: {
                info: sinon.spy(),
                warn: sinon.spy(),
                error: sinon.spy(),
                debug: sinon.spy()
            }
        });
        
        // Inizializza il gateway
        await apiGateway.initialize();
        
        // Ottieni l'app Express per i test
        app = apiGateway.getExpressApp();
    });
    
    afterEach(async () => {
        // Ferma il gateway
        await apiGateway.stop();
        
        // Ripristina tutti i mock
        sinon.restore();
    });
    
    describe('initialize()', () => {
        it('dovrebbe inizializzare correttamente il gateway', () => {
            expect(apiGateway.isInitialized).to.be.true;
            expect(apiGateway.routes).to.be.an('object');
        });
    });
    
    describe('registerRoute()', () => {
        it('dovrebbe registrare una rotta correttamente', () => {
            const handler = async (req, res) => {
                res.json({ success: true });
            };
            
            const route = apiGateway.registerRoute({
                method: 'GET',
                path: '/test',
                handler,
                middlewares: [],
                circuitBreaker: true,
                retry: true,
                gracefulDegradation: true
            });
            
            expect(route).to.be.an('object');
            expect(route.method).to.equal('GET');
            expect(route.path).to.equal('/test');
            expect(route.handler).to.equal(handler);
            expect(route.circuitBreaker).to.be.true;
            expect(route.retry).to.be.true;
            expect(route.gracefulDegradation).to.be.true;
        });
        
        it('dovrebbe lanciare un errore se il gateway non è inizializzato', () => {
            const uninitializedGateway = new ApiGateway({
                port: 0
            });
            
            expect(() => uninitializedGateway.registerRoute({
                method: 'GET',
                path: '/test',
                handler: () => {}
            })).to.throw(
                'L\'API Gateway non è inizializzato'
            );
        });
        
        it('dovrebbe lanciare un errore se il metodo non è specificato', () => {
            expect(() => apiGateway.registerRoute({
                path: '/test',
                handler: () => {}
            })).to.throw(
                'Il metodo è obbligatorio'
            );
        });
        
        it('dovrebbe lanciare un errore se il path non è specificato', () => {
            expect(() => apiGateway.registerRoute({
                method: 'GET',
                handler: () => {}
            })).to.throw(
                'Il path è obbligatorio'
            );
        });
        
        it('dovrebbe lanciare un errore se l\'handler non è specificato', () => {
            expect(() => apiGateway.registerRoute({
                method: 'GET',
                path: '/test'
            })).to.throw(
                'L\'handler è obbligatorio'
            );
        });
    });
    
    describe('start() e stop()', () => {
        it('dovrebbe avviare e fermare il server correttamente', async () => {
            // Ferma il server (è stato avviato in beforeEach)
            await apiGateway.stop();
            
            expect(apiGateway.isRunning).to.be.false;
            
            // Riavvia il server
            await apiGateway.start();
            
            expect(apiGateway.isRunning).to.be.true;
            
            // Ferma di nuovo il server
            await apiGateway.stop();
            
            expect(apiGateway.isRunning).to.be.false;
        });
    });
    
    describe('Gestione delle richieste', () => {
        it('dovrebbe gestire una richiesta GET correttamente', async () => {
            // Registra una rotta
            apiGateway.registerRoute({
                method: 'GET',
                path: '/test',
                handler: (req, res) => {
                    res.json({ success: true, data: 'test' });
                }
            });
            
            // Esegui la richiesta
            const response = await request(app)
                .get('/test')
                .expect('Content-Type', /json/)
                .expect(200);
            
            expect(response.body).to.deep.equal({ success: true, data: 'test' });
        });
        
        it('dovrebbe gestire una richiesta POST correttamente', async () => {
            // Registra una rotta
            apiGateway.registerRoute({
                method: 'POST',
                path: '/test',
                handler: (req, res) => {
                    res.json({ success: true, data: req.body });
                }
            });
            
            // Esegui la richiesta
            const response = await request(app)
                .post('/test')
                .send({ name: 'Test', value: 123 })
                .expect('Content-Type', /json/)
                .expect(200);
            
            expect(response.body).to.deep.equal({ success: true, data: { name: 'Test', value: 123 } });
        });
        
        it('dovrebbe gestire gli errori correttamente', async () => {
            // Registra una rotta che genera un errore
            apiGateway.registerRoute({
                method: 'GET',
                path: '/error',
                handler: () => {
                    throw new Error('Test error');
                }
            });
            
            // Esegui la richiesta
            const response = await request(app)
                .get('/error')
                .expect('Content-Type', /json/)
                .expect(500);
            
            expect(response.body).to.have.property('error');
            expect(response.body.error).to.include('Test error');
        });
        
        it('dovrebbe applicare il circuit breaker quando configurato', async () => {
            // Registra un servizio nel circuit breaker
            circuitBreaker.registerService('testService');
            
            // Stub del metodo executeWithBreaker
            const executeWithBreakerStub = sinon.stub(circuitBreaker, 'executeWithBreaker').callsFake(
                async (serviceName, fn) => fn()
            );
            
            // Registra una rotta con circuit breaker
            apiGateway.registerRoute({
                method: 'GET',
                path: '/with-circuit-breaker',
                handler: (req, res) => {
                    res.json({ success: true });
                },
                circuitBreaker: {
                    serviceName: 'testService'
                }
            });
            
            // Esegui la richiesta
            await request(app)
                .get('/with-circuit-breaker')
                .expect(200);
            
            expect(executeWithBreakerStub.calledOnce).to.be.true;
            expect(executeWithBreakerStub.firstCall.args[0]).to.equal('testService');
        });
        
        it('dovrebbe applicare il retry quando configurato', async () => {
            // Stub del metodo executeWithRetry
            const executeWithRetryStub = sinon.stub(retryManager, 'executeWithRetry').callsFake(
                async (fn) => fn()
            );
            
            // Registra una rotta con retry
            apiGateway.registerRoute({
                method: 'GET',
                path: '/with-retry',
                handler: (req, res) => {
                    res.json({ success: true });
                },
                retry: true
            });
            
            // Esegui la richiesta
            await request(app)
                .get('/with-retry')
                .expect(200);
            
            expect(executeWithRetryStub.calledOnce).to.be.true;
        });
        
        it('dovrebbe applicare la degradazione graduale quando configurato', async () => {
            // Registra una feature nel sistema di degradazione graduale
            gracefulDegradation.registerFeature('testFeature');
            
            // Stub del metodo checkFeatureAvailability
            const checkFeatureAvailabilityStub = sinon.stub(gracefulDegradation, 'checkFeatureAvailability').resolves(true);
            
            // Registra una rotta con degradazione graduale
            apiGateway.registerRoute({
                method: 'GET',
                path: '/with-graceful-degradation',
                handler: (req, res) => {
                    res.json({ success: true });
                },
                gracefulDegradation: {
                    featureName: 'testFeature'
                }
            });
            
            // Esegui la richiesta
            await request(app)
                .get('/with-graceful-degradation')
                .expect(200);
            
            expect(checkFeatureAvailabilityStub.calledOnce).to.be.true;
            expect(checkFeatureAvailabilityStub.firstCall.args[0]).to.equal('testFeature');
        });
    });
    
    describe('getStatus()', () => {
        it('dovrebbe restituire lo stato corrente del gateway', async () => {
            // Registra alcune rotte
            apiGateway.registerRoute({
                method: 'GET',
                path: '/test1',
                handler: () => {}
            });
            
            apiGateway.registerRoute({
                method: 'POST',
                path: '/test2',
                handler: () => {}
            });
            
            const status = await apiGateway.getStatus();
            
            expect(status).to.be.an('object');
            expect(status.isInitialized).to.be.true;
            expect(status.isRunning).to.be.true;
            expect(status.port).to.be.a('number');
            expect(status.routes).to.be.an('array');
            expect(status.routes).to.have.lengthOf(2);
            expect(status.routes[0].method).to.equal('GET');
            expect(status.routes[0].path).to.equal('/test1');
            expect(status.routes[1].method).to.equal('POST');
            expect(status.routes[1].path).to.equal('/test2');
        });
    });
    
    describe('getMetrics()', () => {
        it('dovrebbe restituire le metriche correnti', async () => {
            // Registra una rotta
            apiGateway.registerRoute({
                method: 'GET',
                path: '/test',
                handler: (req, res) => {
                    res.json({ success: true });
                }
            });
            
            // Esegui alcune richieste
            await request(app).get('/test');
            await request(app).get('/test');
            await request(app).get('/nonexistent').expect(404);
            
            const metrics = await apiGateway.getMetrics();
            
            expect(metrics).to.be.an('object');
            expect(metrics.totalRequests).to.equal(3);
            expect(metrics.successfulRequests).to.equal(2);
            expect(metrics.failedRequests).to.equal(1);
            expect(metrics.routes).to.be.an('object');
            expect(metrics.routes['/test']).to.be.an('object');
            expect(metrics.routes['/test'].GET).to.be.an('object');
            expect(metrics.routes['/test'].GET.count).to.equal(2);
        });
    });
});
