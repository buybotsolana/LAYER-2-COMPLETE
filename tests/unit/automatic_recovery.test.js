/**
 * Test unitari per il sistema di Automatic Recovery
 */

const { AutomaticRecovery } = require('../../offchain/automatic-recovery');
const { StateManager } = require('../../offchain/state-manager');
const { AlertManager } = require('../../offchain/alert-manager');
const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const fs = require('fs').promises;

describe('AutomaticRecovery', () => {
    let automaticRecovery;
    let stateManager;
    let alertManager;
    let tempDir;
    
    beforeEach(async () => {
        // Crea una directory temporanea per i test
        tempDir = path.join(__dirname, '..', '..', 'temp-test-' + Date.now());
        await fs.mkdir(tempDir, { recursive: true });
        
        // Crea le dipendenze
        stateManager = new StateManager({
            stateDir: path.join(tempDir, 'state'),
            logger: {
                info: sinon.spy(),
                warn: sinon.spy(),
                error: sinon.spy(),
                debug: sinon.spy()
            }
        });
        
        alertManager = new AlertManager({
            alertsDir: path.join(tempDir, 'alerts'),
            logger: {
                info: sinon.spy(),
                warn: sinon.spy(),
                error: sinon.spy(),
                debug: sinon.spy()
            }
        });
        
        // Inizializza le dipendenze
        await stateManager.initialize();
        await alertManager.initialize();
        
        // Crea un'istanza di AutomaticRecovery con configurazione di test
        automaticRecovery = new AutomaticRecovery({
            stateManager,
            alertManager,
            recoveryDir: path.join(tempDir, 'recovery'),
            logger: {
                info: sinon.spy(),
                warn: sinon.spy(),
                error: sinon.spy(),
                debug: sinon.spy()
            }
        });
        
        // Inizializza il sistema
        await automaticRecovery.initialize();
    });
    
    afterEach(async () => {
        // Pulisci la directory temporanea
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
            console.error(`Errore durante la pulizia della directory temporanea: ${error.message}`);
        }
        
        // Ripristina tutti i mock
        sinon.restore();
    });
    
    describe('initialize()', () => {
        it('dovrebbe inizializzare correttamente il sistema', () => {
            expect(automaticRecovery.isInitialized).to.be.true;
            expect(automaticRecovery.recoveryStrategies).to.be.an('object');
        });
    });
    
    describe('registerRecoveryStrategy()', () => {
        it('dovrebbe registrare una strategia di recovery correttamente', () => {
            const strategy = automaticRecovery.registerRecoveryStrategy('testStrategy', {
                description: 'Test strategy',
                handler: async () => true
            });
            
            expect(strategy).to.be.an('object');
            expect(strategy.name).to.equal('testStrategy');
            expect(strategy.description).to.equal('Test strategy');
            expect(strategy.handler).to.be.a('function');
        });
        
        it('dovrebbe lanciare un errore se il sistema non è inizializzato', () => {
            const uninitializedRecovery = new AutomaticRecovery({
                stateManager,
                alertManager
            });
            
            expect(() => uninitializedRecovery.registerRecoveryStrategy('testStrategy')).to.throw(
                'Il sistema di recovery automatico non è inizializzato'
            );
        });
        
        it('dovrebbe lanciare un errore se il nome della strategia non è specificato', () => {
            expect(() => automaticRecovery.registerRecoveryStrategy()).to.throw(
                'Il nome della strategia è obbligatorio'
            );
        });
        
        it('dovrebbe lanciare un errore se l\'handler non è specificato', () => {
            expect(() => automaticRecovery.registerRecoveryStrategy('testStrategy', {
                description: 'Test strategy'
            })).to.throw(
                'L\'handler della strategia è obbligatorio'
            );
        });
    });
    
    describe('registerErrorDetector()', () => {
        it('dovrebbe registrare un detector di errori correttamente', () => {
            const detector = automaticRecovery.registerErrorDetector('testDetector', {
                description: 'Test detector',
                handler: async () => true
            });
            
            expect(detector).to.be.an('object');
            expect(detector.name).to.equal('testDetector');
            expect(detector.description).to.equal('Test detector');
            expect(detector.handler).to.be.a('function');
        });
        
        it('dovrebbe lanciare un errore se il sistema non è inizializzato', () => {
            const uninitializedRecovery = new AutomaticRecovery({
                stateManager,
                alertManager
            });
            
            expect(() => uninitializedRecovery.registerErrorDetector('testDetector')).to.throw(
                'Il sistema di recovery automatico non è inizializzato'
            );
        });
        
        it('dovrebbe lanciare un errore se il nome del detector non è specificato', () => {
            expect(() => automaticRecovery.registerErrorDetector()).to.throw(
                'Il nome del detector è obbligatorio'
            );
        });
        
        it('dovrebbe lanciare un errore se l\'handler non è specificato', () => {
            expect(() => automaticRecovery.registerErrorDetector('testDetector', {
                description: 'Test detector'
            })).to.throw(
                'L\'handler del detector è obbligatorio'
            );
        });
    });
    
    describe('detectAndRecover()', () => {
        it('dovrebbe rilevare un errore e applicare la strategia di recovery', async () => {
            // Registra un detector che rileva sempre un errore
            automaticRecovery.registerErrorDetector('testDetector', {
                description: 'Test detector',
                handler: async () => ({
                    detected: true,
                    errorType: 'testError',
                    details: { message: 'Test error' }
                })
            });
            
            // Registra una strategia di recovery
            const recoveryHandler = sinon.stub().resolves({
                success: true,
                actions: ['action1', 'action2']
            });
            
            automaticRecovery.registerRecoveryStrategy('testStrategy', {
                description: 'Test strategy',
                errorTypes: ['testError'],
                handler: recoveryHandler
            });
            
            // Esegui il rilevamento e il recovery
            const result = await automaticRecovery.detectAndRecover();
            
            expect(result).to.be.an('object');
            expect(result.detected).to.be.true;
            expect(result.recovered).to.be.true;
            expect(result.errorType).to.equal('testError');
            expect(recoveryHandler.calledOnce).to.be.true;
        });
        
        it('dovrebbe restituire detected: false se non viene rilevato alcun errore', async () => {
            // Registra un detector che non rileva mai errori
            automaticRecovery.registerErrorDetector('testDetector', {
                description: 'Test detector',
                handler: async () => ({
                    detected: false
                })
            });
            
            // Esegui il rilevamento e il recovery
            const result = await automaticRecovery.detectAndRecover();
            
            expect(result).to.be.an('object');
            expect(result.detected).to.be.false;
            expect(result.recovered).to.be.false;
        });
        
        it('dovrebbe restituire recovered: false se non esiste una strategia per l\'errore rilevato', async () => {
            // Registra un detector che rileva sempre un errore
            automaticRecovery.registerErrorDetector('testDetector', {
                description: 'Test detector',
                handler: async () => ({
                    detected: true,
                    errorType: 'unknownError',
                    details: { message: 'Unknown error' }
                })
            });
            
            // Registra una strategia di recovery per un tipo di errore diverso
            automaticRecovery.registerRecoveryStrategy('testStrategy', {
                description: 'Test strategy',
                errorTypes: ['testError'],
                handler: async () => ({
                    success: true,
                    actions: ['action1', 'action2']
                })
            });
            
            // Esegui il rilevamento e il recovery
            const result = await automaticRecovery.detectAndRecover();
            
            expect(result).to.be.an('object');
            expect(result.detected).to.be.true;
            expect(result.recovered).to.be.false;
            expect(result.errorType).to.equal('unknownError');
        });
        
        it('dovrebbe gestire il fallimento di una strategia di recovery', async () => {
            // Registra un detector che rileva sempre un errore
            automaticRecovery.registerErrorDetector('testDetector', {
                description: 'Test detector',
                handler: async () => ({
                    detected: true,
                    errorType: 'testError',
                    details: { message: 'Test error' }
                })
            });
            
            // Registra una strategia di recovery che fallisce
            automaticRecovery.registerRecoveryStrategy('testStrategy', {
                description: 'Test strategy',
                errorTypes: ['testError'],
                handler: async () => ({
                    success: false,
                    error: 'Recovery failed'
                })
            });
            
            // Esegui il rilevamento e il recovery
            const result = await automaticRecovery.detectAndRecover();
            
            expect(result).to.be.an('object');
            expect(result.detected).to.be.true;
            expect(result.recovered).to.be.false;
            expect(result.errorType).to.equal('testError');
            expect(result.recoveryError).to.equal('Recovery failed');
        });
    });
    
    describe('startMonitoring()', () => {
        let clock;
        
        beforeEach(() => {
            clock = sinon.useFakeTimers();
        });
        
        afterEach(() => {
            clock.restore();
        });
        
        it('dovrebbe avviare il monitoraggio periodico', async () => {
            // Stub del metodo detectAndRecover
            const detectAndRecoverStub = sinon.stub(automaticRecovery, 'detectAndRecover').resolves({
                detected: false,
                recovered: false
            });
            
            // Avvia il monitoraggio
            automaticRecovery.startMonitoring(1000); // 1 secondo
            
            // Avanza il tempo
            await clock.tickAsync(1100);
            
            expect(detectAndRecoverStub.calledOnce).to.be.true;
            
            // Avanza ulteriormente il tempo
            await clock.tickAsync(1000);
            
            expect(detectAndRecoverStub.calledTwice).to.be.true;
            
            // Ferma il monitoraggio
            automaticRecovery.stopMonitoring();
        });
        
        it('dovrebbe fermare il monitoraggio quando richiesto', async () => {
            // Stub del metodo detectAndRecover
            const detectAndRecoverStub = sinon.stub(automaticRecovery, 'detectAndRecover').resolves({
                detected: false,
                recovered: false
            });
            
            // Avvia il monitoraggio
            automaticRecovery.startMonitoring(1000); // 1 secondo
            
            // Avanza il tempo
            await clock.tickAsync(1100);
            
            expect(detectAndRecoverStub.calledOnce).to.be.true;
            
            // Ferma il monitoraggio
            automaticRecovery.stopMonitoring();
            
            // Avanza ulteriormente il tempo
            await clock.tickAsync(2000);
            
            // Il metodo non dovrebbe essere chiamato di nuovo
            expect(detectAndRecoverStub.calledOnce).to.be.true;
        });
    });
    
    describe('getRecoveryHistory()', () => {
        it('dovrebbe restituire la storia dei recovery', async () => {
            // Registra un detector che rileva sempre un errore
            automaticRecovery.registerErrorDetector('testDetector', {
                description: 'Test detector',
                handler: async () => ({
                    detected: true,
                    errorType: 'testError',
                    details: { message: 'Test error' }
                })
            });
            
            // Registra una strategia di recovery
            automaticRecovery.registerRecoveryStrategy('testStrategy', {
                description: 'Test strategy',
                errorTypes: ['testError'],
                handler: async () => ({
                    success: true,
                    actions: ['action1', 'action2']
                })
            });
            
            // Esegui il rilevamento e il recovery
            await automaticRecovery.detectAndRecover();
            
            // Ottieni la storia dei recovery
            const history = await automaticRecovery.getRecoveryHistory();
            
            expect(history).to.be.an('array');
            expect(history).to.have.lengthOf(1);
            expect(history[0].errorType).to.equal('testError');
            expect(history[0].recovered).to.be.true;
        });
    });
    
    describe('getStatus()', () => {
        it('dovrebbe restituire lo stato corrente del sistema', async () => {
            // Registra alcune strategie e detector
            automaticRecovery.registerErrorDetector('testDetector', {
                description: 'Test detector',
                handler: async () => ({ detected: false })
            });
            
            automaticRecovery.registerRecoveryStrategy('testStrategy', {
                description: 'Test strategy',
                errorTypes: ['testError'],
                handler: async () => ({ success: true })
            });
            
            const status = await automaticRecovery.getStatus();
            
            expect(status).to.be.an('object');
            expect(status.isInitialized).to.be.true;
            expect(status.isMonitoring).to.be.false;
            expect(status.errorDetectors).to.be.an('array');
            expect(status.errorDetectors).to.have.lengthOf(1);
            expect(status.recoveryStrategies).to.be.an('array');
            expect(status.recoveryStrategies).to.have.lengthOf(1);
        });
    });
});
