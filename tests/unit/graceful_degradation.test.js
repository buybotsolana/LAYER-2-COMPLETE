/**
 * Test unitari per il sistema di Graceful Degradation
 */

const { GracefulDegradation } = require('../../offchain/graceful-degradation');
const { expect } = require('chai');
const sinon = require('sinon');

describe('GracefulDegradation', () => {
    let gracefulDegradation;
    
    beforeEach(async () => {
        // Crea un'istanza di GracefulDegradation con configurazione di test
        gracefulDegradation = new GracefulDegradation({
            logger: {
                info: sinon.spy(),
                warn: sinon.spy(),
                error: sinon.spy(),
                debug: sinon.spy()
            }
        });
        
        // Inizializza il sistema
        await gracefulDegradation.initialize();
    });
    
    afterEach(() => {
        // Ripristina tutti i mock
        sinon.restore();
    });
    
    describe('initialize()', () => {
        it('dovrebbe inizializzare correttamente il sistema', () => {
            expect(gracefulDegradation.isInitialized).to.be.true;
            expect(gracefulDegradation.features).to.be.an('object');
        });
    });
    
    describe('registerFeature()', () => {
        it('dovrebbe registrare una feature correttamente', () => {
            const feature = gracefulDegradation.registerFeature('testFeature', {
                description: 'Test feature',
                importance: 'high',
                alternatives: ['altFeature1', 'altFeature2']
            });
            
            expect(feature).to.be.an('object');
            expect(feature.name).to.equal('testFeature');
            expect(feature.description).to.equal('Test feature');
            expect(feature.importance).to.equal('high');
            expect(feature.alternatives).to.deep.equal(['altFeature1', 'altFeature2']);
            expect(feature.isAvailable).to.be.true;
        });
        
        it('dovrebbe lanciare un errore se il sistema non è inizializzato', () => {
            const uninitializedGracefulDegradation = new GracefulDegradation();
            
            expect(() => uninitializedGracefulDegradation.registerFeature('testFeature')).to.throw(
                'Il sistema di degradazione graduale non è inizializzato'
            );
        });
        
        it('dovrebbe lanciare un errore se il nome della feature non è specificato', () => {
            expect(() => gracefulDegradation.registerFeature()).to.throw(
                'Il nome della feature è obbligatorio'
            );
        });
    });
    
    describe('setFeatureAvailability()', () => {
        it('dovrebbe impostare la disponibilità di una feature', () => {
            gracefulDegradation.registerFeature('testFeature');
            
            gracefulDegradation.setFeatureAvailability('testFeature', false);
            
            expect(gracefulDegradation.features.testFeature.isAvailable).to.be.false;
        });
        
        it('dovrebbe lanciare un errore se la feature non esiste', () => {
            expect(() => gracefulDegradation.setFeatureAvailability('nonExistentFeature', false)).to.throw(
                'Feature non trovata: nonExistentFeature'
            );
        });
    });
    
    describe('checkFeatureAvailability()', () => {
        it('dovrebbe restituire true se la feature è disponibile', async () => {
            gracefulDegradation.registerFeature('testFeature');
            
            const isAvailable = await gracefulDegradation.checkFeatureAvailability('testFeature');
            
            expect(isAvailable).to.be.true;
        });
        
        it('dovrebbe restituire false se la feature non è disponibile', async () => {
            gracefulDegradation.registerFeature('testFeature');
            gracefulDegradation.setFeatureAvailability('testFeature', false);
            
            const isAvailable = await gracefulDegradation.checkFeatureAvailability('testFeature');
            
            expect(isAvailable).to.be.false;
        });
        
        it('dovrebbe lanciare un errore se la feature non esiste', async () => {
            try {
                await gracefulDegradation.checkFeatureAvailability('nonExistentFeature');
                
                // La funzione dovrebbe lanciare un errore, quindi non dovremmo arrivare qui
                expect.fail('La funzione non ha lanciato un errore');
            } catch (error) {
                expect(error.message).to.include('Feature non trovata');
            }
        });
    });
    
    describe('degradeGracefully()', () => {
        it('dovrebbe restituire un\'alternativa se la feature non è disponibile', async () => {
            gracefulDegradation.registerFeature('testFeature', {
                alternatives: ['altFeature1', 'altFeature2']
            });
            gracefulDegradation.registerFeature('altFeature1');
            gracefulDegradation.registerFeature('altFeature2');
            
            gracefulDegradation.setFeatureAvailability('testFeature', false);
            
            const alternative = await gracefulDegradation.degradeGracefully('testFeature');
            
            expect(alternative).to.equal('altFeature1');
        });
        
        it('dovrebbe restituire la seconda alternativa se la prima non è disponibile', async () => {
            gracefulDegradation.registerFeature('testFeature', {
                alternatives: ['altFeature1', 'altFeature2']
            });
            gracefulDegradation.registerFeature('altFeature1');
            gracefulDegradation.registerFeature('altFeature2');
            
            gracefulDegradation.setFeatureAvailability('testFeature', false);
            gracefulDegradation.setFeatureAvailability('altFeature1', false);
            
            const alternative = await gracefulDegradation.degradeGracefully('testFeature');
            
            expect(alternative).to.equal('altFeature2');
        });
        
        it('dovrebbe restituire null se non ci sono alternative disponibili', async () => {
            gracefulDegradation.registerFeature('testFeature', {
                alternatives: ['altFeature1', 'altFeature2']
            });
            gracefulDegradation.registerFeature('altFeature1');
            gracefulDegradation.registerFeature('altFeature2');
            
            gracefulDegradation.setFeatureAvailability('testFeature', false);
            gracefulDegradation.setFeatureAvailability('altFeature1', false);
            gracefulDegradation.setFeatureAvailability('altFeature2', false);
            
            const alternative = await gracefulDegradation.degradeGracefully('testFeature');
            
            expect(alternative).to.be.null;
        });
        
        it('dovrebbe restituire null se la feature non ha alternative', async () => {
            gracefulDegradation.registerFeature('testFeature');
            
            gracefulDegradation.setFeatureAvailability('testFeature', false);
            
            const alternative = await gracefulDegradation.degradeGracefully('testFeature');
            
            expect(alternative).to.be.null;
        });
    });
    
    describe('registerHealthCheck()', () => {
        it('dovrebbe registrare un health check per una feature', () => {
            gracefulDegradation.registerFeature('testFeature');
            
            const healthCheck = sinon.stub().resolves(true);
            gracefulDegradation.registerHealthCheck('testFeature', healthCheck);
            
            expect(gracefulDegradation.features.testFeature.healthCheck).to.equal(healthCheck);
        });
        
        it('dovrebbe lanciare un errore se la feature non esiste', () => {
            const healthCheck = sinon.stub().resolves(true);
            
            expect(() => gracefulDegradation.registerHealthCheck('nonExistentFeature', healthCheck)).to.throw(
                'Feature non trovata: nonExistentFeature'
            );
        });
    });
    
    describe('runHealthChecks()', () => {
        it('dovrebbe eseguire gli health check per tutte le feature', async () => {
            gracefulDegradation.registerFeature('feature1');
            gracefulDegradation.registerFeature('feature2');
            
            const healthCheck1 = sinon.stub().resolves(true);
            const healthCheck2 = sinon.stub().resolves(false);
            
            gracefulDegradation.registerHealthCheck('feature1', healthCheck1);
            gracefulDegradation.registerHealthCheck('feature2', healthCheck2);
            
            await gracefulDegradation.runHealthChecks();
            
            expect(healthCheck1.calledOnce).to.be.true;
            expect(healthCheck2.calledOnce).to.be.true;
            expect(gracefulDegradation.features.feature1.isAvailable).to.be.true;
            expect(gracefulDegradation.features.feature2.isAvailable).to.be.false;
        });
    });
    
    describe('getStatus()', () => {
        it('dovrebbe restituire lo stato corrente del sistema', async () => {
            gracefulDegradation.registerFeature('feature1', { importance: 'high' });
            gracefulDegradation.registerFeature('feature2', { importance: 'medium' });
            gracefulDegradation.setFeatureAvailability('feature2', false);
            
            const status = await gracefulDegradation.getStatus();
            
            expect(status).to.be.an('object');
            expect(status.isInitialized).to.be.true;
            expect(status.features).to.be.an('array');
            expect(status.features).to.have.lengthOf(2);
            expect(status.features[0].name).to.equal('feature1');
            expect(status.features[0].isAvailable).to.be.true;
            expect(status.features[1].name).to.equal('feature2');
            expect(status.features[1].isAvailable).to.be.false;
        });
    });
});
