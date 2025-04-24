/**
 * Test di integrazione per il sistema di robustezza
 * 
 * Questo test verifica l'integrazione tra i vari componenti del sistema di robustezza:
 * - Circuit Breaker
 * - Retry Manager
 * - Graceful Degradation
 * - Automatic Recovery
 * - API Gateway
 */

const { CircuitBreaker } = require('../../offchain/circuit-breaker');
const { RetryManager } = require('../../offchain/retry-manager');
const { GracefulDegradation } = require('../../offchain/graceful-degradation');
const { AutomaticRecovery } = require('../../offchain/automatic-recovery');
const { StateManager } = require('../../offchain/state-manager');
const { AlertManager } = require('../../offchain/alert-manager');
const { ApiGateway } = require('../../offchain/api-gateway');
const { ExternalServiceClient } = require('../../offchain/external-service-client');
const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');
const path = require('path');
const fs = require('fs').promises;

describe('Sistema di Robustezza - Test di Integrazione', function() {
    // Aumenta il timeout per i test di integrazione
    this.timeout(10000);
    
    let circuitBreaker;
    let retryManager;
    let gracefulDegradation;
    let stateManager;
    let alertManager;
    let automaticRecovery;
    let apiGateway;
    let externalServiceClient;
    let tempDir;
    let app;
    
    beforeEach(async () => {
        // Crea una directory temporanea per i test
        tempDir = path.join(__dirname, '..', '..', 'temp-test-' + Date.now());
        const stateDir = path.join(tempDir, 'state');
        const alertsDir = path.join(tempDir, 'alerts');
        const recoveryDir = path.join(tempDir, 'recovery');
        
        await fs.mkdir(tempDir, { recursive: true });
        await fs.mkdir(stateDir, { recursive: true });
        await fs.mkdir(alertsDir, { recursive: true });
        await fs.mkdir(recoveryDir, { recursive: true });
        
        // Crea un logger comune
        const logger = {
            info: sinon.spy(),
            warn: sinon.spy(),
            error: sinon.spy(),
            debug: sinon.spy()
        };
        
        // Inizializza i componenti
        circuitBreaker = new CircuitBreaker({
            failureThreshold: 3,
            resetTimeout: 1000,
            logger
        });
        
        retryManager = new RetryManager({
            maxRetries: 3,
            initialDelay: 100,
            maxDelay: 1000,
            backoffFactor: 2,
            logger
        });
        
        gracefulDegradation = new GracefulDegradation({
            logger
        });
        
        stateManager = new StateManager({
            stateDir,
            logger
        });
        
        alertManager = new AlertManager({
            alertsDir,
            logger
        });
        
        automaticRecovery = new AutomaticRecovery({
            stateManager,
            alertManager,
            recoveryDir,
            logger
        });
        
        apiGateway = new ApiGateway({
            port: 0, // Porta casuale
            circuitBreaker,
            retryManager,
            gracefulDegradation,
            logger
        });
        
        externalServiceClient = new ExternalServiceClient({
            circuitBreaker,
            retryManager,
            logger
        });
        
        // Inizializza i componenti
        await circuitBreaker.initialize();
        await gracefulDegradation.initialize();
        await stateManager.initialize();
        await alertManager.initialize();
        await automaticRecovery.initialize();
        await apiGateway.initialize();
        await externalServiceClient.initialize();
        
        // Ottieni l'app Express per i test
        app = apiGateway.getExpressApp();
    });
    
    afterEach(async () => {
        // Ferma i componenti
        if (apiGateway.isRunning) {
            await apiGateway.stop();
        }
        
        // Pulisci la directory temporanea
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
            console.error(`Errore durante la pulizia della directory temporanea: ${error.message}`);
        }
        
        // Ripristina tutti i mock
        sinon.restore();
    });
    
    describe('Integrazione Circuit Breaker e Retry Manager', () => {
        it('dovrebbe gestire correttamente un servizio esterno instabile', async () => {
            // Registra un servizio nel circuit breaker
            circuitBreaker.registerService('unstableService');
            
            // Crea un servizio esterno instabile che fallisce le prime 2 chiamate e poi ha successo
            const unstableService = sinon.stub();
            unstableService.onFirstCall().rejects(new Error('Service unavailable'));
            unstableService.onSecondCall().rejects(new Error('Service unavailable'));
            unstableService.onThirdCall().resolves({ data: 'success' });
            
            // Configura il client per utilizzare il servizio instabile
            externalServiceClient.registerService('unstableService', {
                serviceFunction: unstableService,
                circuitBreakerOptions: {
                    serviceName: 'unstableService'
                },
                retryOptions: {
                    maxRetries: 3
                }
            });
            
            // Chiama il servizio
            const result = await externalServiceClient.callService('unstableService');
            
            // Verifica che il servizio sia stato chiamato 3 volte (2 fallimenti + 1 successo)
            expect(unstableService.callCount).to.equal(3);
            
            // Verifica che il risultato sia corretto
            expect(result).to.deep.equal({ data: 'success' });
        });
        
        it('dovrebbe aprire il circuit breaker dopo troppi fallimenti', async () => {
            // Registra un servizio nel circuit breaker con una soglia bassa
            circuitBreaker.registerService('failingService', {
                failureThreshold: 2
            });
            
            // Crea un servizio esterno che fallisce sempre
            const failingService = sinon.stub().rejects(new Error('Service unavailable'));
            
            // Configura il client per utilizzare il servizio che fallisce
            externalServiceClient.registerService('failingService', {
                serviceFunction: failingService,
                circuitBreakerOptions: {
                    serviceName: 'failingService'
                },
                retryOptions: {
                    maxRetries: 1
                }
            });
            
            try {
                // Prima chiamata (fallirà ma il circuit breaker rimane chiuso)
                await externalServiceClient.callService('failingService');
                expect.fail('La chiamata dovrebbe fallire');
            } catch (error) {
                expect(error.message).to.include('Service unavailable');
            }
            
            try {
                // Seconda chiamata (fallirà e aprirà il circuit breaker)
                await externalServiceClient.callService('failingService');
                expect.fail('La chiamata dovrebbe fallire');
            } catch (error) {
                expect(error.message).to.include('Service unavailable');
            }
            
            try {
                // Terza chiamata (dovrebbe essere rifiutata dal circuit breaker)
                await externalServiceClient.callService('failingService');
                expect.fail('La chiamata dovrebbe essere rifiutata dal circuit breaker');
            } catch (error) {
                expect(error.message).to.include('Circuit breaker is open');
            }
            
            // Verifica che il servizio sia stato chiamato solo 2 volte
            // (la terza chiamata è stata rifiutata dal circuit breaker)
            expect(failingService.callCount).to.equal(2);
        });
    });
    
    describe('Integrazione Graceful Degradation e API Gateway', () => {
        it('dovrebbe degradare gradualmente quando una feature non è disponibile', async () => {
            // Registra le feature nel sistema di degradazione graduale
            gracefulDegradation.registerFeature('primaryFeature', {
                description: 'Feature primaria',
                importance: 'high',
                alternatives: ['fallbackFeature']
            });
            
            gracefulDegradation.registerFeature('fallbackFeature', {
                description: 'Feature di fallback',
                importance: 'medium'
            });
            
            // Imposta la feature primaria come non disponibile
            gracefulDegradation.setFeatureAvailability('primaryFeature', false);
            
            // Registra gli handler per le feature
            const primaryHandler = sinon.stub().resolves({ data: 'primary' });
            const fallbackHandler = sinon.stub().resolves({ data: 'fallback' });
            
            // Registra una rotta con degradazione graduale
            apiGateway.registerRoute({
                method: 'GET',
                path: '/test-degradation',
                handler: async (req, res) => {
                    const featureName = await gracefulDegradation.degradeGracefully('primaryFeature');
                    
                    if (featureName === 'primaryFeature') {
                        const result = await primaryHandler();
                        res.json(result);
                    } else if (featureName === 'fallbackFeature') {
                        const result = await fallbackHandler();
                        res.json(result);
                    } else {
                        res.status(503).json({ error: 'Service unavailable' });
                    }
                }
            });
            
            // Esegui la richiesta
            const response = await request(app)
                .get('/test-degradation')
                .expect('Content-Type', /json/)
                .expect(200);
            
            // Verifica che sia stato utilizzato l'handler di fallback
            expect(primaryHandler.called).to.be.false;
            expect(fallbackHandler.called).to.be.true;
            expect(response.body).to.deep.equal({ data: 'fallback' });
        });
        
        it('dovrebbe restituire un errore quando non ci sono alternative disponibili', async () => {
            // Registra una feature senza alternative
            gracefulDegradation.registerFeature('criticalFeature');
            
            // Imposta la feature come non disponibile
            gracefulDegradation.setFeatureAvailability('criticalFeature', false);
            
            // Registra una rotta con degradazione graduale
            apiGateway.registerRoute({
                method: 'GET',
                path: '/test-critical',
                handler: async (req, res) => {
                    const featureName = await gracefulDegradation.degradeGracefully('criticalFeature');
                    
                    if (featureName) {
                        res.json({ success: true });
                    } else {
                        res.status(503).json({ error: 'Service unavailable' });
                    }
                }
            });
            
            // Esegui la richiesta
            const response = await request(app)
                .get('/test-critical')
                .expect('Content-Type', /json/)
                .expect(503);
            
            // Verifica che sia stato restituito un errore
            expect(response.body).to.deep.equal({ error: 'Service unavailable' });
        });
    });
    
    describe('Integrazione Automatic Recovery e Circuit Breaker', () => {
        it('dovrebbe rilevare e recuperare da un circuit breaker aperto', async () => {
            // Registra un servizio nel circuit breaker
            circuitBreaker.registerService('recoveryTestService', {
                failureThreshold: 2
            });
            
            // Registra un detector di errori che rileva circuit breaker aperti
            automaticRecovery.registerErrorDetector('circuitBreakerDetector', {
                description: 'Rileva circuit breaker aperti',
                handler: async () => {
                    const status = circuitBreaker.getStatus();
                    const openServices = status.services.filter(s => s.state === 'open');
                    
                    if (openServices.length > 0) {
                        return {
                            detected: true,
                            errorType: 'circuitBreakerOpen',
                            details: {
                                services: openServices.map(s => s.name)
                            }
                        };
                    }
                    
                    return { detected: false };
                }
            });
            
            // Registra una strategia di recovery per circuit breaker aperti
            automaticRecovery.registerRecoveryStrategy('circuitBreakerRecovery', {
                description: 'Resetta circuit breaker aperti',
                errorTypes: ['circuitBreakerOpen'],
                handler: async (error) => {
                    const services = error.details.services;
                    
                    for (const serviceName of services) {
                        circuitBreaker.resetService(serviceName);
                    }
                    
                    return {
                        success: true,
                        actions: [`Reset circuit breaker for services: ${services.join(', ')}`]
                    };
                }
            });
            
            // Apri il circuit breaker
            circuitBreaker.services['recoveryTestService'].state = 'open';
            circuitBreaker.services['recoveryTestService'].failureCount = 3;
            
            // Esegui il rilevamento e il recovery
            const result = await automaticRecovery.detectAndRecover();
            
            // Verifica che l'errore sia stato rilevato e recuperato
            expect(result.detected).to.be.true;
            expect(result.recovered).to.be.true;
            expect(result.errorType).to.equal('circuitBreakerOpen');
            
            // Verifica che il circuit breaker sia stato resettato
            expect(circuitBreaker.services['recoveryTestService'].state).to.equal('closed');
            expect(circuitBreaker.services['recoveryTestService'].failureCount).to.equal(0);
        });
    });
    
    describe('Integrazione completa del sistema', () => {
        it('dovrebbe gestire correttamente un flusso completo con tutti i componenti', async () => {
            // Registra un servizio nel circuit breaker
            circuitBreaker.registerService('integrationTestService');
            
            // Registra le feature nel sistema di degradazione graduale
            gracefulDegradation.registerFeature('primaryIntegration', {
                alternatives: ['fallbackIntegration']
            });
            
            gracefulDegradation.registerFeature('fallbackIntegration');
            
            // Crea un servizio esterno instabile
            const unstableService = sinon.stub();
            unstableService.onFirstCall().rejects(new Error('Service unavailable'));
            unstableService.onSecondCall().resolves({ data: 'primary' });
            
            // Crea un servizio di fallback
            const fallbackService = sinon.stub().resolves({ data: 'fallback' });
            
            // Configura il client per utilizzare il servizio instabile
            externalServiceClient.registerService('integrationTestService', {
                serviceFunction: unstableService,
                circuitBreakerOptions: {
                    serviceName: 'integrationTestService'
                },
                retryOptions: {
                    maxRetries: 2
                }
            });
            
            // Registra una rotta che utilizza tutti i componenti
            apiGateway.registerRoute({
                method: 'GET',
                path: '/integration-test',
                handler: async (req, res) => {
                    try {
                        // Determina quale feature utilizzare
                        const featureName = await gracefulDegradation.degradeGracefully('primaryIntegration');
                        
                        if (featureName === 'primaryIntegration') {
                            // Chiama il servizio primario
                            const result = await externalServiceClient.callService('integrationTestService');
                            res.json(result);
                        } else if (featureName === 'fallbackIntegration') {
                            // Chiama il servizio di fallback
                            const result = await fallbackService();
                            res.json(result);
                        } else {
                            res.status(503).json({ error: 'Service unavailable' });
                        }
                    } catch (error) {
                        res.status(500).json({ error: error.message });
                    }
                },
                circuitBreaker: true,
                retry: true,
                gracefulDegradation: true
            });
            
            // Esegui la richiesta
            const response = await request(app)
                .get('/integration-test')
                .expect('Content-Type', /json/)
                .expect(200);
            
            // Verifica che il servizio instabile sia stato chiamato due volte
            // (una fallita e una riuscita grazie al retry)
            expect(unstableService.callCount).to.equal(2);
            
            // Verifica che il risultato sia corretto
            expect(response.body).to.deep.equal({ data: 'primary' });
            
            // Verifica che il servizio di fallback non sia stato chiamato
            expect(fallbackService.called).to.be.false;
        });
        
        it('dovrebbe utilizzare il servizio di fallback quando il primario non è disponibile', async () => {
            // Registra un servizio nel circuit breaker
            circuitBreaker.registerService('failingIntegrationService');
            
            // Registra le feature nel sistema di degradazione graduale
            gracefulDegradation.registerFeature('primaryIntegration', {
                alternatives: ['fallbackIntegration']
            });
            
            gracefulDegradation.registerFeature('fallbackIntegration');
            
            // Imposta la feature primaria come non disponibile
            gracefulDegradation.setFeatureAvailability('primaryIntegration', false);
            
            // Crea un servizio primario che non dovrebbe essere chiamato
            const primaryService = sinon.stub().resolves({ data: 'primary' });
            
            // Crea un servizio di fallback
            const fallbackService = sinon.stub().resolves({ data: 'fallback' });
            
            // Configura il client per utilizzare il servizio primario
            externalServiceClient.registerService('failingIntegrationService', {
                serviceFunction: primaryService,
                circuitBreakerOptions: {
                    serviceName: 'failingIntegrationService'
                },
                retryOptions: {
                    maxRetries: 2
                }
            });
            
            // Registra una rotta che utilizza tutti i componenti
            apiGateway.registerRoute({
                method: 'GET',
                path: '/integration-fallback-test',
                handler: async (req, res) => {
                    try {
                        // Determina quale feature utilizzare
                        const featureName = await gracefulDegradation.degradeGracefully('primaryIntegration');
                        
                        if (featureName === 'primaryIntegration') {
                            // Chiama il servizio primario
                            const result = await externalServiceClient.callService('failingIntegrationService');
                            res.json(result);
                        } else if (featureName === 'fallbackIntegration') {
                            // Chiama il servizio di fallback
                            const result = await fallbackService();
                            res.json(result);
                        } else {
                            res.status(503).json({ error: 'Service unavailable' });
                        }
                    } catch (error) {
                        res.status(500).json({ error: error.message });
                    }
                },
                circuitBreaker: true,
                retry: true,
                gracefulDegradation: true
            });
            
            // Esegui la richiesta
            const response = await request(app)
                .get('/integration-fallback-test')
                .expect('Content-Type', /json/)
                .expect(200);
            
            // Verifica che il servizio primario non sia stato chiamato
            expect(primaryService.called).to.be.false;
            
            // Verifica che il servizio di fallback sia stato chiamato
            expect(fallbackService.called).to.be.true;
            
            // Verifica che il risultato sia corretto
            expect(response.body).to.deep.equal({ data: 'fallback' });
        });
    });
});
