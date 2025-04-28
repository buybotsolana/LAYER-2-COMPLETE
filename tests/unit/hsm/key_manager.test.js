/**
 * Test unitari per il sistema di gestione delle chiavi HSM
 * 
 * Questi test verificano il corretto funzionamento delle classi:
 * - KeyManager (classe base)
 * - AWSCloudHSMManager
 * - YubiHSMManager
 * - EmergencyKeyProvider
 * - FailoverManager
 * - KeyRotationSystem
 */

const { expect } = require('chai');
const sinon = require('sinon');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');
const { 
    KeyManager, 
    AWSCloudHSMManager, 
    YubiHSMManager, 
    EmergencyKeyProvider, 
    FailoverManager, 
    KeyRotationSystem,
    createKeyManager
} = require('../../offchain/key_manager');

describe('Sistema di gestione delle chiavi HSM', function() {
    // Aumenta il timeout per i test che coinvolgono operazioni asincrone
    this.timeout(10000);
    
    // Sandbox per gli stub e i mock
    let sandbox;
    
    beforeEach(() => {
        // Crea un nuovo sandbox per ogni test
        sandbox = sinon.createSandbox();
        
        // Crea le directory per i log se non esistono
        const logDirs = [
            path.join(__dirname, '../../logs/failover'),
            path.join(__dirname, '../../logs/emergency-keys'),
            path.join(__dirname, '../../logs/key-rotation'),
            path.join(__dirname, '../../logs/hsm-notifications')
        ];
        
        for (const dir of logDirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    });
    
    afterEach(() => {
        // Ripristina tutti gli stub e i mock
        sandbox.restore();
    });
    
    describe('KeyManager (classe base)', () => {
        it('dovrebbe essere una classe astratta con metodi non implementati', () => {
            const keyManager = new KeyManager();
            
            // Verifica che i metodi lancino un'eccezione se non implementati
            expect(() => keyManager.sign('test')).to.throw(/deve essere implementato/);
            expect(() => keyManager.verify('test', 'signature')).to.throw(/deve essere implementato/);
            expect(() => keyManager.getPublicKey()).to.throw(/deve essere implementato/);
            expect(() => keyManager.isAvailable()).to.throw(/deve essere implementato/);
        });
    });
    
    describe('AWSCloudHSMManager', () => {
        let awsCloudHsmManager;
        let awsCloudHsmStub;
        let awsCloudHsmV2Stub;
        let awsCloudWatchStub;
        let awsCloudWatchLogsStub;
        
        beforeEach(() => {
            // Configura gli stub per AWS SDK
            awsCloudHsmStub = {
                describeClusters: sandbox.stub().returns({
                    promise: sandbox.stub().resolves({
                        Clusters: [{
                            State: 'ACTIVE',
                            Hsms: [{ State: 'ACTIVE' }],
                            HsmType: 'FIPS'
                        }]
                    })
                })
            };
            
            awsCloudHsmV2Stub = {
                getPublicKey: sandbox.stub().returns({
                    promise: sandbox.stub().resolves({
                        PublicKey: Buffer.from('test-public-key').toString('base64')
                    })
                }),
                sign: sandbox.stub().returns({
                    promise: sandbox.stub().resolves({
                        Signature: Buffer.from('test-signature').toString('base64')
                    })
                }),
                verify: sandbox.stub().returns({
                    promise: sandbox.stub().resolves({
                        SignatureValid: true
                    })
                }),
                listKeys: sandbox.stub().returns({
                    promise: sandbox.stub().resolves({
                        Keys: [{
                            KeyId: 'test-key-id',
                            Label: 'sequencer_main',
                            CreatedAt: new Date(),
                            KeyAlgorithm: 'EC',
                            KeySize: 256
                        }]
                    })
                })
            };
            
            awsCloudWatchStub = {
                putMetricData: sandbox.stub().returns({
                    promise: sandbox.stub().resolves({})
                })
            };
            
            awsCloudWatchLogsStub = {
                putLogEvents: sandbox.stub().returns({
                    promise: sandbox.stub().resolves({})
                })
            };
            
            // Stub per AWS SDK
            sandbox.stub(AWS, 'CloudHSM').returns(awsCloudHsmStub);
            sandbox.stub(AWS, 'CloudHSMV2').returns(awsCloudHsmV2Stub);
            sandbox.stub(AWS, 'CloudWatch').returns(awsCloudWatchStub);
            sandbox.stub(AWS, 'CloudWatchLogs').returns(awsCloudWatchLogsStub);
            
            // Crea un'istanza di AWSCloudHSMManager
            awsCloudHsmManager = new AWSCloudHSMManager({
                region: 'us-west-2',
                clusterId: 'test-cluster-id',
                keyId: 'sequencer_main',
                username: 'test-username',
                password: 'test-password',
                accessKeyId: 'test-access-key-id',
                secretAccessKey: 'test-secret-access-key',
                algorithm: 'ECDSA_SHA256',
                enableFipsMode: true,
                enableAuditLogging: true,
                cloudTrailLogGroup: 'test-log-group',
                keyRotationDays: 90
            });
        });
        
        it('dovrebbe inizializzare correttamente', async () => {
            await awsCloudHsmManager.initialize();
            
            // Verifica che il client AWS CloudHSM sia stato chiamato
            expect(AWS.CloudHSM.calledOnce).to.be.true;
            expect(AWS.CloudHSMV2.calledOnce).to.be.true;
            
            // Verifica che il metodo describeClusters sia stato chiamato
            expect(awsCloudHsmStub.describeClusters.calledOnce).to.be.true;
            
            // Verifica che il metodo listKeys sia stato chiamato
            expect(awsCloudHsmV2Stub.listKeys.calledOnce).to.be.true;
            
            // Verifica che il manager sia inizializzato
            expect(awsCloudHsmManager.isInitialized).to.be.true;
        });
        
        it('dovrebbe firmare un messaggio correttamente', async () => {
            await awsCloudHsmManager.initialize();
            
            const message = 'test-message';
            const signature = await awsCloudHsmManager.sign(message);
            
            // Verifica che il metodo sign sia stato chiamato
            expect(awsCloudHsmV2Stub.sign.calledOnce).to.be.true;
            
            // Verifica che la firma sia un Buffer
            expect(Buffer.isBuffer(signature)).to.be.true;
        });
        
        it('dovrebbe verificare una firma correttamente', async () => {
            await awsCloudHsmManager.initialize();
            
            const message = 'test-message';
            const signature = Buffer.from('test-signature');
            const isValid = await awsCloudHsmManager.verify(message, signature);
            
            // Verifica che il metodo verify sia stato chiamato
            expect(awsCloudHsmV2Stub.verify.calledOnce).to.be.true;
            
            // Verifica che la firma sia valida
            expect(isValid).to.be.true;
        });
        
        it('dovrebbe ottenere la chiave pubblica correttamente', async () => {
            await awsCloudHsmManager.initialize();
            
            const publicKey = await awsCloudHsmManager.getPublicKey();
            
            // Verifica che la chiave pubblica sia un Buffer
            expect(Buffer.isBuffer(publicKey)).to.be.true;
        });
        
        it('dovrebbe verificare la disponibilità dell\'HSM correttamente', async () => {
            const isAvailable = await awsCloudHsmManager.isAvailable();
            
            // Verifica che il metodo describeClusters sia stato chiamato
            expect(awsCloudHsmStub.describeClusters.calledOnce).to.be.true;
            
            // Verifica che l'HSM sia disponibile
            expect(isAvailable).to.be.true;
        });
        
        it('dovrebbe gestire gli errori durante l\'inizializzazione', async () => {
            // Modifica lo stub per simulare un errore
            awsCloudHsmStub.describeClusters.returns({
                promise: sandbox.stub().rejects(new Error('Test error'))
            });
            
            try {
                await awsCloudHsmManager.initialize();
                // Se arriviamo qui, il test fallisce
                expect.fail('Dovrebbe lanciare un\'eccezione');
            } catch (error) {
                // Verifica che l'errore sia quello atteso
                expect(error.message).to.equal('Test error');
                
                // Verifica che il manager non sia inizializzato
                expect(awsCloudHsmManager.isInitialized).to.be.false;
            }
        });
        
        it('dovrebbe pubblicare metriche su CloudWatch', async () => {
            await awsCloudHsmManager.initialize();
            
            // Esegui un'operazione per generare metriche
            await awsCloudHsmManager.sign('test-message');
            
            // Pubblica le metriche
            await awsCloudHsmManager.publishMetrics();
            
            // Verifica che il metodo putMetricData sia stato chiamato
            expect(awsCloudWatchStub.putMetricData.calledOnce).to.be.true;
        });
        
        it('dovrebbe registrare eventi di audit', async () => {
            await awsCloudHsmManager.initialize();
            
            // Registra un evento di audit
            await awsCloudHsmManager.logAuditEvent('TEST_EVENT', { test: 'data' });
            
            // Verifica che il metodo putLogEvents sia stato chiamato
            expect(awsCloudWatchLogsStub.putLogEvents.calledOnce).to.be.true;
        });
    });
    
    describe('YubiHSMManager', () => {
        let yubiHsmManager;
        let yubiHsmConnectorStub;
        let yubiHsmSessionStub;
        
        beforeEach(() => {
            // Configura gli stub per YubiHSM
            yubiHsmSessionStub = {
                getObjectInfo: sandbox.stub().resolves({ id: 1 }),
                getPublicKey: sandbox.stub().resolves(Buffer.from('test-public-key')),
                signDataPkcs1: sandbox.stub().resolves(Buffer.from('test-signature')),
                verifyDataPkcs1: sandbox.stub().resolves(true),
                close: sandbox.stub().resolves()
            };
            
            yubiHsmConnectorStub = {
                createSession: sandbox.stub().resolves(yubiHsmSessionStub),
                connect: sandbox.stub().resolves()
            };
            
            // Stub per il modulo yubihsm
            const yubihsm = {
                Connector: sandbox.stub().returns(yubiHsmConnectorStub),
                ObjectType: { ASYMMETRIC_KEY: 1 },
                Algorithm: { RSA_PKCS1_SHA256: 1 }
            };
            
            // Sostituisci il modulo yubihsm con lo stub
            sandbox.stub(global, 'require').callsFake((module) => {
                if (module === 'yubihsm') {
                    return yubihsm;
                }
                return require(module);
            });
            
            // Crea un'istanza di YubiHSMManager
            yubiHsmManager = new YubiHSMManager({
                connector: 'http://localhost:12345',
                authKeyId: 1,
                password: 'test-password',
                keyId: 1,
                algorithm: 'RSA-SHA256'
            });
        });
        
        it('dovrebbe inizializzare correttamente', async () => {
            await yubiHsmManager.initialize();
            
            // Verifica che il metodo createSession sia stato chiamato
            expect(yubiHsmConnectorStub.createSession.calledOnce).to.be.true;
            
            // Verifica che il metodo getObjectInfo sia stato chiamato
            expect(yubiHsmSessionStub.getObjectInfo.calledOnce).to.be.true;
            
            // Verifica che il metodo getPublicKey sia stato chiamato
            expect(yubiHsmSessionStub.getPublicKey.calledOnce).to.be.true;
            
            // Verifica che il manager sia inizializzato
            expect(yubiHsmManager.isInitialized).to.be.true;
        });
        
        it('dovrebbe firmare un messaggio correttamente', async () => {
            await yubiHsmManager.initialize();
            
            const message = 'test-message';
            const signature = await yubiHsmManager.sign(message);
            
            // Verifica che il metodo signDataPkcs1 sia stato chiamato
            expect(yubiHsmSessionStub.signDataPkcs1.calledOnce).to.be.true;
            
            // Verifica che la firma sia un Buffer
            expect(Buffer.isBuffer(signature)).to.be.true;
        });
        
        it('dovrebbe verificare una firma correttamente', async () => {
            await yubiHsmManager.initialize();
            
            const message = 'test-message';
            const signature = Buffer.from('test-signature');
            const isValid = await yubiHsmManager.verify(message, signature);
            
            // Verifica che il metodo verifyDataPkcs1 sia stato chiamato
            expect(yubiHsmSessionStub.verifyDataPkcs1.calledOnce).to.be.true;
            
            // Verifica che la firma sia valida
            expect(isValid).to.be.true;
        });
        
        it('dovrebbe ottenere la chiave pubblica correttamente', async () => {
            await yubiHsmManager.initialize();
            
            const publicKey = await yubiHsmManager.getPublicKey();
            
            // Verifica che la chiave pubblica sia un Buffer
            expect(Buffer.isBuffer(publicKey)).to.be.true;
        });
        
        it('dovrebbe verificare la disponibilità dell\'HSM correttamente', async () => {
            const isAvailable = await yubiHsmManager.isAvailable();
            
            // Verifica che il metodo connect sia stato chiamato
            expect(yubiHsmConnectorStub.connect.calledOnce).to.be.true;
            
            // Verifica che l'HSM sia disponibile
            expect(isAvailable).to.be.true;
        });
        
        it('dovrebbe chiudere la connessione correttamente', async () => {
            await yubiHsmManager.initialize();
            await yubiHsmManager.close();
            
            // Verifica che il metodo close sia stato chiamato
            expect(yubiHsmSessionStub.close.calledOnce).to.be.true;
            
            // Verifica che il manager non sia più inizializzato
            expect(yubiHsmManager.isInitialized).to.be.false;
        });
    });
    
    describe('EmergencyKeyProvider', () => {
        let emergencyKeyProvider;
        
        beforeEach(() => {
            // Crea un'istanza di EmergencyKeyProvider
            emergencyKeyProvider = new EmergencyKeyProvider({
                keyLifetimeMinutes: 60,
                maxTransactions: 100,
                enableAuditLogging: true,
                logPath: path.join(__dirname, '../../logs/emergency-keys')
            });
        });
        
        it('dovrebbe inizializzare correttamente', async () => {
            await emergencyKeyProvider.initialize();
            
            // Verifica che il provider sia inizializzato
            expect(emergencyKeyProvider.isInitialized).to.be.true;
            
            // Verifica che sia stata generata una coppia di chiavi
            expect(emergencyKeyProvider.currentKeyPair).to.not.be.null;
            expect(emergencyKeyProvider.keyCreationTime).to.not.be.null;
            expect(emergencyKeyProvider.transactionCount).to.equal(0);
        });
        
        it('dovrebbe firmare un messaggio correttamente', async () => {
            await emergencyKeyProvider.initialize();
            
            const message = 'test-message';
            const signature = await emergencyKeyProvider.sign(message);
            
            // Verifica che la firma sia un Buffer
            expect(Buffer.isBuffer(signature)).to.be.true;
            
            // Verifica che il contatore di transazioni sia stato incrementato
            expect(emergencyKeyProvider.transactionCount).to.equal(1);
        });
        
        it('dovrebbe verificare una firma correttamente', async () => {
            await emergencyKeyProvider.initialize();
            
            const message = 'test-message';
            const signature = await emergencyKeyProvider.sign(message);
            const isValid = await emergencyKeyProvider.verify(message, signature);
            
            // Verifica che la firma sia valida
            expect(isValid).to.be.true;
        });
        
        it('dovrebbe ottenere la chiave pubblica correttamente', async () => {
            await emergencyKeyProvider.initialize();
            
            const publicKey = await emergencyKeyProvider.getPublicKey();
            
            // Verifica che la chiave pubblica sia un Buffer
            expect(Buffer.isBuffer(publicKey)).to.be.true;
        });
        
        it('dovrebbe essere sempre disponibile', async () => {
            const isAvailable = await emergencyKeyProvider.isAvailable();
            
            // Verifica che il provider sia sempre disponibile
            expect(isAvailable).to.be.true;
        });
        
        it('dovrebbe rigenerare le chiavi quando necessario', async () => {
            await emergencyKeyProvider.initialize();
            
            // Modifica il contatore di transazioni per forzare la rigenerazione
            emergencyKeyProvider.transactionCount = emergencyKeyProvider.maxTransactions;
            
            // Salva la chiave pubblica corrente
            const oldPublicKey = await emergencyKeyProvider.getPublicKey();
            
            // Firma un messaggio per forzare la rigenerazione
            await emergencyKeyProvider.sign('test-message');
            
            // Ottieni la nuova chiave pubblica
            const newPublicKey = await emergencyKeyProvider.getPublicKey();
            
            // Verifica che la chiave pubblica sia cambiata
            expect(oldPublicKey.toString('hex')).to.not.equal(newPublicKey.toString('hex'));
            
            // Verifica che il contatore di transazioni sia stato resettato
            expect(emergencyKeyProvider.transactionCount).to.equal(1);
        });
        
        it('dovrebbe chiudere il provider correttamente', async () => {
            await emergencyKeyProvider.initialize();
            await emergencyKeyProvider.close();
            
            // Verifica che il provider non sia più inizializzato
            expect(emergencyKeyProvider.isInitialized).to.be.false;
            
            // Verifica che la coppia di chiavi sia stata distrutta
            expect(emergencyKeyProvider.currentKeyPair).to.be.null;
        });
    });
    
    describe('FailoverManager', () => {
        let failoverManager;
        let primaryHsmStub;
        let secondaryHsmStub;
        let emergencyProviderStub;
        
        beforeEach(() => {
            // Configura gli stub per gli HSM
            primaryHsmStub = {
                initialize: sandbox.stub().resolves(),
                sign: sandbox.stub().resolves(Buffer.from('primary-signature')),
                verify: sandbox.stub().resolves(true),
                getPublicKey: sandbox.stub().resolves(Buffer.from('primary-public-key')),
                isAvailable: sandbox.stub().resolves(true),
                close: sandbox.stub().resolves(),
                isInitialized: true
            };
            
            secondaryHsmStub = {
                initialize: sandbox.stub().resolves(),
                sign: sandbox.stub().resolves(Buffer.from('secondary-signature')),
                verify: sandbox.stub().resolves(true),
                getPublicKey: sandbox.stub().resolves(Buffer.from('secondary-public-key')),
                isAvailable: sandbox.stub().resolves(true),
                close: sandbox.stub().resolves(),
                isInitialized: true
            };
            
            emergencyProviderStub = {
                initialize: sandbox.stub().resolves(),
                sign: sandbox.stub().resolves(Buffer.from('emergency-signature')),
                verify: sandbox.stub().resolves(true),
                getPublicKey: sandbox.stub().resolves(Buffer.from('emergency-public-key')),
                isAvailable: sandbox.stub().resolves(true),
                close: sandbox.stub().resolves(),
                isInitialized: true
            };
            
            // Stub per le classi HSM
            sandbox.stub(AWSCloudHSMManager.prototype, 'initialize').callsFake(function() {
                Object.assign(this, primaryHsmStub);
                return Promise.resolve();
            });
            
            sandbox.stub(YubiHSMManager.prototype, 'initialize').callsFake(function() {
                Object.assign(this, secondaryHsmStub);
                return Promise.resolve();
            });
            
            sandbox.stub(EmergencyKeyProvider.prototype, 'initialize').callsFake(function() {
                Object.assign(this, emergencyProviderStub);
                return Promise.resolve();
            });
            
            // Crea un'istanza di FailoverManager
            failoverManager = new FailoverManager({
                primaryHsm: {
                    type: 'aws',
                    region: 'us-west-2',
                    clusterId: 'test-cluster-id',
                    keyId: 'sequencer_main',
                    username: 'test-username',
                    password: 'test-password'
                },
                secondaryHsm: {
                    type: 'yubi',
                    connector: 'http://localhost:12345',
                    authKeyId: 1,
                    password: 'test-password',
                    keyId: 1
                },
                emergency: {
                    keyLifetimeMinutes: 60,
                    maxTransactions: 100,
                    enableAuditLogging: true,
                    logPath: path.join(__dirname, '../../logs/emergency-keys')
                },
                enableAuditLogging: true,
                logPath: path.join(__dirname, '../../logs/failover'),
                notifyCallback: sandbox.stub().resolves()
            });
        });
        
        it('dovrebbe inizializzare correttamente con HSM primario', async () => {
            await failoverManager.initialize();
            
            // Verifica che l'HSM primario sia stato inizializzato
            expect(AWSCloudHSMManager.prototype.initialize.calledOnce).to.be.true;
            
            // Verifica che il provider attivo sia quello primario
            expect(failoverManager.currentProvider).to.equal('primary');
        });
        
        it('dovrebbe passare all\'HSM secondario se il primario non è disponibile', async () => {
            // Modifica lo stub per simulare un HSM primario non disponibile
            primaryHsmStub.isAvailable = sandbox.stub().resolves(false);
            
            await failoverManager.initialize();
            
            // Verifica che l'HSM secondario sia stato inizializzato
            expect(YubiHSMManager.prototype.initialize.calledOnce).to.be.true;
            
            // Verifica che il provider attivo sia quello secondario
            expect(failoverManager.currentProvider).to.equal('secondary');
        });
        
        it('dovrebbe passare al provider di emergenza se entrambi gli HSM non sono disponibili', async () => {
            // Modifica gli stub per simulare HSM non disponibili
            primaryHsmStub.isAvailable = sandbox.stub().resolves(false);
            secondaryHsmStub.isAvailable = sandbox.stub().resolves(false);
            
            await failoverManager.initialize();
            
            // Verifica che il provider di emergenza sia stato inizializzato
            expect(EmergencyKeyProvider.prototype.initialize.calledOnce).to.be.true;
            
            // Verifica che il provider attivo sia quello di emergenza
            expect(failoverManager.currentProvider).to.equal('emergency');
        });
        
        it('dovrebbe attivare il failover quando richiesto', async () => {
            await failoverManager.initialize();
            
            // Attiva il failover
            await failoverManager.activateFailover('test-reason');
            
            // Verifica che il provider attivo sia cambiato
            expect(failoverManager.currentProvider).to.equal('secondary');
            
            // Verifica che l'evento sia stato registrato nella cronologia
            expect(failoverManager.failoverHistory.length).to.equal(1);
            expect(failoverManager.failoverHistory[0].reason).to.equal('test-reason');
        });
        
        it('dovrebbe eseguire operazioni con il provider attivo', async () => {
            await failoverManager.initialize();
            
            // Esegui un'operazione
            const signature = await failoverManager.executeWithFailover('sign', ['test-message']);
            
            // Verifica che l'operazione sia stata eseguita con il provider primario
            expect(primaryHsmStub.sign.calledOnce).to.be.true;
            
            // Verifica che la firma sia quella attesa
            expect(signature.toString()).to.equal('primary-signature');
        });
        
        it('dovrebbe passare al provider successivo in caso di errore', async () => {
            await failoverManager.initialize();
            
            // Modifica lo stub per simulare un errore
            primaryHsmStub.sign = sandbox.stub().rejects(new Error('Test error'));
            
            // Esegui un'operazione
            const signature = await failoverManager.executeWithFailover('sign', ['test-message']);
            
            // Verifica che l'operazione sia stata tentata con il provider primario
            expect(primaryHsmStub.sign.calledOnce).to.be.true;
            
            // Verifica che l'operazione sia stata eseguita con il provider secondario
            expect(secondaryHsmStub.sign.calledOnce).to.be.true;
            
            // Verifica che la firma sia quella attesa
            expect(signature.toString()).to.equal('secondary-signature');
            
            // Verifica che il provider attivo sia cambiato
            expect(failoverManager.currentProvider).to.equal('secondary');
        });
        
        it('dovrebbe verificare periodicamente il ripristino dell\'HSM primario', async () => {
            // Modifica lo stub per simulare un HSM primario non disponibile
            primaryHsmStub.isAvailable = sandbox.stub().resolves(false);
            
            await failoverManager.initialize();
            
            // Verifica che il provider attivo sia quello secondario
            expect(failoverManager.currentProvider).to.equal('secondary');
            
            // Modifica lo stub per simulare un HSM primario tornato disponibile
            primaryHsmStub.isAvailable = sandbox.stub().resolves(true);
            
            // Verifica il ripristino
            await failoverManager.checkPrimaryRecovery();
            
            // Verifica che l'HSM primario sia stato reinizializzato
            expect(AWSCloudHSMManager.prototype.initialize.calledTwice).to.be.true;
            
            // Verifica che il provider attivo sia tornato quello primario
            expect(failoverManager.currentProvider).to.equal('primary');
        });
        
        it('dovrebbe ottenere lo stato del gestore di failover', () => {
            const status = failoverManager.getStatus();
            
            // Verifica che lo stato contenga le informazioni attese
            expect(status).to.have.property('currentProvider');
            expect(status).to.have.property('failoverHistory');
            expect(status).to.have.property('primaryAvailable');
            expect(status).to.have.property('secondaryAvailable');
            expect(status).to.have.property('emergencyAvailable');
        });
        
        it('dovrebbe chiudere tutti i provider', async () => {
            await failoverManager.initialize();
            await failoverManager.close();
            
            // Verifica che tutti i provider siano stati chiusi
            expect(primaryHsmStub.close.calledOnce).to.be.true;
            expect(secondaryHsmStub.close.calledOnce).to.be.true;
            expect(emergencyProviderStub.close.calledOnce).to.be.true;
        });
    });
    
    describe('KeyRotationSystem', () => {
        let keyRotationSystem;
        let keyManagerStub;
        
        beforeEach(() => {
            // Configura lo stub per il key manager
            keyManagerStub = {
                initialize: sandbox.stub().resolves(),
                sign: sandbox.stub().resolves(Buffer.from('test-signature')),
                verify: sandbox.stub().resolves(true),
                getPublicKey: sandbox.stub().resolves(Buffer.from('test-public-key')),
                isAvailable: sandbox.stub().resolves(true),
                close: sandbox.stub().resolves(),
                lastKeyRotation: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000) // 45 giorni fa
            };
            
            // Crea un'istanza di KeyRotationSystem
            keyRotationSystem = new KeyRotationSystem({
                rotationIntervalDays: 90,
                overlapHours: 24,
                enableAuditLogging: true,
                logPath: path.join(__dirname, '../../logs/key-rotation'),
                rotationCheckIntervalMs: 3600000,
                notifyCallback: sandbox.stub().resolves()
            }, keyManagerStub);
            
            // Stub per il metodo setInterval
            sandbox.stub(global, 'setInterval').returns(123);
            sandbox.stub(global, 'clearInterval');
        });
        
        it('dovrebbe inizializzare correttamente', async () => {
            await keyRotationSystem.initialize();
            
            // Verifica che l'ultima rotazione sia stata impostata
            expect(keyRotationSystem.lastRotation).to.not.be.null;
            
            // Verifica che la prossima rotazione sia stata calcolata
            expect(keyRotationSystem.nextRotation).to.not.be.null;
            
            // Verifica che il controllo periodico sia stato avviato
            expect(global.setInterval.calledOnce).to.be.true;
        });
        
        it('dovrebbe calcolare correttamente la prossima rotazione', () => {
            keyRotationSystem.lastRotation = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000); // 45 giorni fa
            keyRotationSystem.calculateNextRotation();
            
            // Verifica che la prossima rotazione sia tra 45 giorni (90 giorni dall'ultima rotazione)
            const expectedNextRotation = new Date(keyRotationSystem.lastRotation.getTime() + 90 * 24 * 60 * 60 * 1000);
            expect(keyRotationSystem.nextRotation.getTime()).to.equal(expectedNextRotation.getTime());
        });
        
        it('dovrebbe verificare se è necessaria una rotazione', async () => {
            await keyRotationSystem.initialize();
            
            // Imposta la prossima rotazione nel passato
            keyRotationSystem.nextRotation = new Date(Date.now() - 1000);
            
            // Stub per il metodo rotateKeys
            const rotateKeysStub = sandbox.stub(keyRotationSystem, 'rotateKeys').resolves();
            
            // Verifica la rotazione
            await keyRotationSystem.checkRotation();
            
            // Verifica che il metodo rotateKeys sia stato chiamato
            expect(rotateKeysStub.calledOnce).to.be.true;
        });
        
        it('dovrebbe eseguire la rotazione delle chiavi', async () => {
            await keyRotationSystem.initialize();
            
            // Salva l'ultima rotazione
            const oldLastRotation = keyRotationSystem.lastRotation;
            
            // Esegui la rotazione
            await keyRotationSystem.rotateKeys();
            
            // Verifica che l'ultima rotazione sia stata aggiornata
            expect(keyRotationSystem.lastRotation.getTime()).to.be.greaterThan(oldLastRotation.getTime());
            
            // Verifica che la prossima rotazione sia stata calcolata
            expect(keyRotationSystem.nextRotation.getTime()).to.be.greaterThan(keyRotationSystem.lastRotation.getTime());
            
            // Verifica che l'evento sia stato registrato nella cronologia
            expect(keyRotationSystem.rotationHistory.length).to.equal(1);
        });
        
        it('dovrebbe ottenere lo stato del sistema di rotazione', () => {
            const status = keyRotationSystem.getStatus();
            
            // Verifica che lo stato contenga le informazioni attese
            expect(status).to.have.property('lastRotation');
            expect(status).to.have.property('nextRotation');
            expect(status).to.have.property('rotationIntervalDays');
            expect(status).to.have.property('overlapHours');
            expect(status).to.have.property('rotationHistory');
        });
        
        it('dovrebbe chiudere il sistema di rotazione', async () => {
            await keyRotationSystem.initialize();
            await keyRotationSystem.close();
            
            // Verifica che il controllo periodico sia stato fermato
            expect(global.clearInterval.calledOnce).to.be.true;
        });
    });
    
    describe('createKeyManager', () => {
        it('dovrebbe creare un\'istanza di AWSCloudHSMManager', () => {
            const keyManager = createKeyManager({
                type: 'aws',
                awsRegion: 'us-west-2',
                awsClusterId: 'test-cluster-id',
                awsKeyId: 'sequencer_main',
                awsUsername: 'test-username',
                awsPassword: 'test-password'
            });
            
            // Verifica che il key manager sia un'istanza di AWSCloudHSMManager
            expect(keyManager).to.be.an.instanceOf(AWSCloudHSMManager);
        });
        
        it('dovrebbe creare un\'istanza di YubiHSMManager', () => {
            const keyManager = createKeyManager({
                type: 'yubi',
                yubiConnector: 'http://localhost:12345',
                yubiAuthKeyId: 1,
                yubiPassword: 'test-password',
                yubiKeyId: 1
            });
            
            // Verifica che il key manager sia un'istanza di YubiHSMManager
            expect(keyManager).to.be.an.instanceOf(YubiHSMManager);
        });
        
        it('dovrebbe creare un\'istanza di EmergencyKeyProvider', () => {
            const keyManager = createKeyManager({
                type: 'emergency',
                emergencyKeyLifetimeMinutes: 60,
                emergencyMaxTransactions: 100
            });
            
            // Verifica che il key manager sia un'istanza di EmergencyKeyProvider
            expect(keyManager).to.be.an.instanceOf(EmergencyKeyProvider);
        });
        
        it('dovrebbe creare un proxy con failover se abilitato', () => {
            // Stub per il FailoverManager
            sandbox.stub(FailoverManager.prototype, 'initialize').resolves();
            sandbox.stub(FailoverManager.prototype, 'executeWithFailover').callsFake((method, args) => {
                return Promise.resolve(Buffer.from('test-result'));
            });
            
            const keyManager = createKeyManager({
                type: 'aws',
                enableFailover: true,
                awsRegion: 'us-west-2',
                awsClusterId: 'test-cluster-id',
                awsKeyId: 'sequencer_main',
                awsUsername: 'test-username',
                awsPassword: 'test-password',
                secondaryHsm: {
                    type: 'yubi',
                    connector: 'http://localhost:12345',
                    authKeyId: 1,
                    password: 'test-password',
                    keyId: 1
                }
            });
            
            // Verifica che il key manager sia un proxy
            expect(keyManager).to.be.an('object');
            expect(keyManager.sign).to.be.a('function');
            expect(keyManager.verify).to.be.a('function');
            expect(keyManager.getPublicKey).to.be.a('function');
            expect(keyManager.isAvailable).to.be.a('function');
        });
    });
});
