/**
 * Test unitari per il sistema di Deployment Automation
 */

const { DeploymentAutomation } = require('../../offchain/deployment-automation');
const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const fs = require('fs').promises;

describe('DeploymentAutomation', () => {
    let deploymentAutomation;
    let tempDir;
    let deploymentDir;
    let artifactsDir;
    
    beforeEach(async () => {
        // Crea una directory temporanea per i test
        tempDir = path.join(__dirname, '..', '..', 'temp-test-' + Date.now());
        deploymentDir = path.join(tempDir, 'deployments');
        artifactsDir = path.join(tempDir, 'artifacts');
        
        await fs.mkdir(tempDir, { recursive: true });
        await fs.mkdir(deploymentDir, { recursive: true });
        await fs.mkdir(artifactsDir, { recursive: true });
        
        // Crea un file di esempio per i test
        const sampleArtifact = path.join(artifactsDir, 'sample-app-1.0.0.zip');
        await fs.writeFile(sampleArtifact, 'Sample artifact content');
        
        // Crea un'istanza di DeploymentAutomation con configurazione di test
        deploymentAutomation = new DeploymentAutomation({
            deploymentDir,
            artifactsDir,
            logger: {
                info: sinon.spy(),
                warn: sinon.spy(),
                error: sinon.spy(),
                debug: sinon.spy()
            }
        });
        
        // Inizializza il sistema
        await deploymentAutomation.initialize();
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
            expect(deploymentAutomation.isInitialized).to.be.true;
            expect(deploymentAutomation.deployments).to.be.an('object');
        });
    });
    
    describe('registerDeployment()', () => {
        it('dovrebbe registrare un deployment correttamente', () => {
            const deployment = deploymentAutomation.registerDeployment('test-app', {
                description: 'Test application',
                version: '1.0.0',
                artifactPath: path.join(artifactsDir, 'sample-app-1.0.0.zip'),
                deploymentStrategy: 'blue-green',
                healthCheckUrl: 'http://localhost:8080/health'
            });
            
            expect(deployment).to.be.an('object');
            expect(deployment.name).to.equal('test-app');
            expect(deployment.description).to.equal('Test application');
            expect(deployment.version).to.equal('1.0.0');
            expect(deployment.artifactPath).to.equal(path.join(artifactsDir, 'sample-app-1.0.0.zip'));
            expect(deployment.deploymentStrategy).to.equal('blue-green');
            expect(deployment.healthCheckUrl).to.equal('http://localhost:8080/health');
            expect(deployment.status).to.equal('registered');
        });
        
        it('dovrebbe lanciare un errore se il sistema non è inizializzato', () => {
            const uninitializedDeployment = new DeploymentAutomation({
                deploymentDir,
                artifactsDir
            });
            
            expect(() => uninitializedDeployment.registerDeployment('test-app')).to.throw(
                'Il sistema di deployment automatico non è inizializzato'
            );
        });
        
        it('dovrebbe lanciare un errore se il nome del deployment non è specificato', () => {
            expect(() => deploymentAutomation.registerDeployment()).to.throw(
                'Il nome del deployment è obbligatorio'
            );
        });
        
        it('dovrebbe lanciare un errore se il percorso dell\'artifact non esiste', () => {
            expect(() => deploymentAutomation.registerDeployment('test-app', {
                artifactPath: path.join(artifactsDir, 'non-existent.zip')
            })).to.throw(
                'Il percorso dell\'artifact non esiste'
            );
        });
    });
    
    describe('deploy()', () => {
        it('dovrebbe eseguire un deployment correttamente', async () => {
            // Registra un deployment
            deploymentAutomation.registerDeployment('test-app', {
                description: 'Test application',
                version: '1.0.0',
                artifactPath: path.join(artifactsDir, 'sample-app-1.0.0.zip'),
                deploymentStrategy: 'rolling',
                healthCheckUrl: 'http://localhost:8080/health',
                preDeployHook: sinon.stub().resolves(true),
                postDeployHook: sinon.stub().resolves(true)
            });
            
            // Stub delle funzioni di deployment
            const executeRollingDeploymentStub = sinon.stub(deploymentAutomation, '_executeRollingDeployment').resolves({
                success: true,
                deploymentId: '123456',
                details: { message: 'Deployment successful' }
            });
            
            // Esegui il deployment
            const result = await deploymentAutomation.deploy('test-app');
            
            expect(result).to.be.an('object');
            expect(result.success).to.be.true;
            expect(result.deploymentId).to.equal('123456');
            expect(result.details).to.be.an('object');
            expect(result.details.message).to.equal('Deployment successful');
            
            // Verifica che la strategia di deployment corretta sia stata chiamata
            expect(executeRollingDeploymentStub.calledOnce).to.be.true;
            
            // Verifica che gli hook siano stati chiamati
            expect(deploymentAutomation.deployments['test-app'].preDeployHook.calledOnce).to.be.true;
            expect(deploymentAutomation.deployments['test-app'].postDeployHook.calledOnce).to.be.true;
        });
        
        it('dovrebbe gestire un errore durante il pre-deploy hook', async () => {
            // Registra un deployment con un pre-deploy hook che fallisce
            deploymentAutomation.registerDeployment('test-app', {
                description: 'Test application',
                version: '1.0.0',
                artifactPath: path.join(artifactsDir, 'sample-app-1.0.0.zip'),
                deploymentStrategy: 'rolling',
                preDeployHook: sinon.stub().rejects(new Error('Pre-deploy hook failed'))
            });
            
            // Stub delle funzioni di deployment
            const executeRollingDeploymentStub = sinon.stub(deploymentAutomation, '_executeRollingDeployment');
            
            // Esegui il deployment
            const result = await deploymentAutomation.deploy('test-app');
            
            expect(result).to.be.an('object');
            expect(result.success).to.be.false;
            expect(result.error).to.include('Pre-deploy hook failed');
            
            // Verifica che la strategia di deployment non sia stata chiamata
            expect(executeRollingDeploymentStub.called).to.be.false;
        });
        
        it('dovrebbe gestire un errore durante il deployment', async () => {
            // Registra un deployment
            deploymentAutomation.registerDeployment('test-app', {
                description: 'Test application',
                version: '1.0.0',
                artifactPath: path.join(artifactsDir, 'sample-app-1.0.0.zip'),
                deploymentStrategy: 'rolling',
                preDeployHook: sinon.stub().resolves(true)
            });
            
            // Stub delle funzioni di deployment che fallisce
            const executeRollingDeploymentStub = sinon.stub(deploymentAutomation, '_executeRollingDeployment').rejects(
                new Error('Deployment failed')
            );
            
            // Esegui il deployment
            const result = await deploymentAutomation.deploy('test-app');
            
            expect(result).to.be.an('object');
            expect(result.success).to.be.false;
            expect(result.error).to.include('Deployment failed');
            
            // Verifica che la strategia di deployment sia stata chiamata
            expect(executeRollingDeploymentStub.calledOnce).to.be.true;
        });
    });
    
    describe('rollback()', () => {
        it('dovrebbe eseguire un rollback correttamente', async () => {
            // Registra un deployment
            deploymentAutomation.registerDeployment('test-app', {
                description: 'Test application',
                version: '1.0.0',
                artifactPath: path.join(artifactsDir, 'sample-app-1.0.0.zip'),
                deploymentStrategy: 'blue-green'
            });
            
            // Simula un deployment precedente
            deploymentAutomation.deployments['test-app'].deploymentHistory = [
                {
                    id: '123456',
                    version: '1.0.0',
                    timestamp: new Date().toISOString(),
                    success: true
                }
            ];
            
            // Stub della funzione di rollback
            const executeRollbackStub = sinon.stub(deploymentAutomation, '_executeRollback').resolves({
                success: true,
                details: { message: 'Rollback successful' }
            });
            
            // Esegui il rollback
            const result = await deploymentAutomation.rollback('test-app', '123456');
            
            expect(result).to.be.an('object');
            expect(result.success).to.be.true;
            expect(result.details).to.be.an('object');
            expect(result.details.message).to.equal('Rollback successful');
            
            // Verifica che la funzione di rollback sia stata chiamata
            expect(executeRollbackStub.calledOnce).to.be.true;
        });
        
        it('dovrebbe gestire un errore durante il rollback', async () => {
            // Registra un deployment
            deploymentAutomation.registerDeployment('test-app', {
                description: 'Test application',
                version: '1.0.0',
                artifactPath: path.join(artifactsDir, 'sample-app-1.0.0.zip'),
                deploymentStrategy: 'blue-green'
            });
            
            // Simula un deployment precedente
            deploymentAutomation.deployments['test-app'].deploymentHistory = [
                {
                    id: '123456',
                    version: '1.0.0',
                    timestamp: new Date().toISOString(),
                    success: true
                }
            ];
            
            // Stub della funzione di rollback che fallisce
            const executeRollbackStub = sinon.stub(deploymentAutomation, '_executeRollback').rejects(
                new Error('Rollback failed')
            );
            
            // Esegui il rollback
            const result = await deploymentAutomation.rollback('test-app', '123456');
            
            expect(result).to.be.an('object');
            expect(result.success).to.be.false;
            expect(result.error).to.include('Rollback failed');
            
            // Verifica che la funzione di rollback sia stata chiamata
            expect(executeRollbackStub.calledOnce).to.be.true;
        });
        
        it('dovrebbe lanciare un errore se il deployment non esiste', async () => {
            try {
                await deploymentAutomation.rollback('non-existent-app', '123456');
                
                // La funzione dovrebbe lanciare un errore, quindi non dovremmo arrivare qui
                expect.fail('La funzione non ha lanciato un errore');
            } catch (error) {
                expect(error.message).to.include('Deployment non trovato');
            }
        });
        
        it('dovrebbe lanciare un errore se l\'ID del deployment non esiste nella storia', async () => {
            // Registra un deployment
            deploymentAutomation.registerDeployment('test-app', {
                description: 'Test application',
                version: '1.0.0',
                artifactPath: path.join(artifactsDir, 'sample-app-1.0.0.zip'),
                deploymentStrategy: 'blue-green'
            });
            
            try {
                await deploymentAutomation.rollback('test-app', 'non-existent-id');
                
                // La funzione dovrebbe lanciare un errore, quindi non dovremmo arrivare qui
                expect.fail('La funzione non ha lanciato un errore');
            } catch (error) {
                expect(error.message).to.include('Deployment ID non trovato');
            }
        });
    });
    
    describe('getDeploymentStatus()', () => {
        it('dovrebbe restituire lo stato di un deployment', async () => {
            // Registra un deployment
            deploymentAutomation.registerDeployment('test-app', {
                description: 'Test application',
                version: '1.0.0',
                artifactPath: path.join(artifactsDir, 'sample-app-1.0.0.zip'),
                deploymentStrategy: 'blue-green'
            });
            
            // Simula un deployment precedente
            deploymentAutomation.deployments['test-app'].deploymentHistory = [
                {
                    id: '123456',
                    version: '1.0.0',
                    timestamp: new Date().toISOString(),
                    success: true
                }
            ];
            
            // Ottieni lo stato del deployment
            const status = await deploymentAutomation.getDeploymentStatus('test-app');
            
            expect(status).to.be.an('object');
            expect(status.name).to.equal('test-app');
            expect(status.description).to.equal('Test application');
            expect(status.version).to.equal('1.0.0');
            expect(status.status).to.equal('registered');
            expect(status.deploymentHistory).to.be.an('array');
            expect(status.deploymentHistory).to.have.lengthOf(1);
            expect(status.deploymentHistory[0].id).to.equal('123456');
        });
        
        it('dovrebbe lanciare un errore se il deployment non esiste', async () => {
            try {
                await deploymentAutomation.getDeploymentStatus('non-existent-app');
                
                // La funzione dovrebbe lanciare un errore, quindi non dovremmo arrivare qui
                expect.fail('La funzione non ha lanciato un errore');
            } catch (error) {
                expect(error.message).to.include('Deployment non trovato');
            }
        });
    });
    
    describe('getStatus()', () => {
        it('dovrebbe restituire lo stato corrente del sistema', async () => {
            // Registra alcuni deployment
            deploymentAutomation.registerDeployment('app1', {
                description: 'Application 1',
                version: '1.0.0',
                artifactPath: path.join(artifactsDir, 'sample-app-1.0.0.zip'),
                deploymentStrategy: 'blue-green'
            });
            
            deploymentAutomation.registerDeployment('app2', {
                description: 'Application 2',
                version: '2.0.0',
                artifactPath: path.join(artifactsDir, 'sample-app-1.0.0.zip'),
                deploymentStrategy: 'rolling'
            });
            
            const status = await deploymentAutomation.getStatus();
            
            expect(status).to.be.an('object');
            expect(status.isInitialized).to.be.true;
            expect(status.deployments).to.be.an('array');
            expect(status.deployments).to.have.lengthOf(2);
            expect(status.deployments[0].name).to.equal('app1');
            expect(status.deployments[1].name).to.equal('app2');
        });
    });
});
