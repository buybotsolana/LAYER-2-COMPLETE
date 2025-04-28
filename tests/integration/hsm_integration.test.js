/**
 * Test di integrazione per il sistema HSM con il Layer-2 su Solana
 * 
 * Questi test verificano l'integrazione tra il sistema di gestione delle chiavi HSM
 * e il sequencer del Layer-2, utilizzando ambienti HSM simulati.
 */

const { expect } = require('chai');
const sinon = require('sinon');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { 
    KeyManager, 
    AWSCloudHSMManager, 
    YubiHSMManager, 
    EmergencyKeyProvider, 
    FailoverManager, 
    KeyRotationSystem,
    createKeyManager
} = require('../../offchain/key_manager');
const Sequencer = require('../../offchain/sequencer');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');

// Configurazione di test
const TEST_CONFIG = {
    solanaRpcUrl: 'https://api.devnet.solana.com',
    databasePath: ':memory:', // Database SQLite in memoria per i test
    programId: Keypair.generate().publicKey.toString(),
    batchSize: 10,
    batchInterval: 1000,
    maxRetries: 3,
    retryDelay: 100,
    workerCount: 1,
    
    // Configurazione HSM
    hsmType: 'aws',
    hsmEnableFailover: true,
    
    // AWS CloudHSM
    hsmAwsRegion: 'us-west-2',
    hsmAwsClusterId: 'test-cluster-id',
    hsmAwsKeyId: 'sequencer_main',
    hsmAwsUsername: 'test-username',
    hsmAwsPassword: 'test-password',
    hsmAwsAccessKeyId: 'test-access-key-id',
    hsmAwsSecretAccessKey: 'test-secret-access-key',
    hsmAwsAlgorithm: 'ECDSA_SHA256',
    hsmAwsEnableFipsMode: true,
    
    // YubiHSM
    hsmYubiConnector: 'http://localhost:12345',
    hsmYubiAuthKeyId: 1,
    hsmYubiPassword: 'test-password',
    hsmYubiKeyId: 1,
    
    // Failover
    hsmFailoverLogPath: path.join(__dirname, '../../logs/failover'),
    
    // Emergency
    hsmEmergencyKeyLifetimeMinutes: 60,
    hsmEmergencyMaxTransactions: 100,
    hsmEmergencyLogPath: path.join(__dirname, '../../logs/emergency-keys'),
    
    // Key Rotation
    hsmEnableKeyRotation: true,
    hsmKeyRotationIntervalDays: 90,
    hsmKeyRotationOverlapHours: 24,
    hsmKeyRotationLogPath: path.join(__dirname, '../../logs/key-rotation'),
    hsmKeyRotationCheckIntervalMs: 3600000,
};

describe('Integrazione HSM con Layer-2', function() {
    // Aumenta il timeout per i test di integrazione
    this.timeout(30000);
    
    // Sandbox per gli stub e i mock
    let sandbox;
    
    // Istanze per i test
    let sequencer;
    let mockConnection;
    let mockWorker;
    
    beforeEach(async () => {
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
        
        // Mock per la connessione Solana
        mockConnection = {
            getBalance: sandbox.stub().resolves(1000000000),
            getRecentBlockhash: sandbox.stub().resolves({
                blockhash: 'test-blockhash',
                feeCalculator: { lamportsPerSignature: 5000 }
            }),
            sendTransaction: sandbox.stub().resolves('test-signature'),
            confirmTransaction: sandbox.stub().resolves({ value: { err: null } })
        };
        
        // Stub per la classe Connection
        sandbox.stub(Connection.prototype, 'getBalance').callsFake(mockConnection.getBalance);
        sandbox.stub(Connection.prototype, 'getRecentBlockhash').callsFake(mockConnection.getRecentBlockhash);
        sandbox.stub(Connection.prototype, 'sendTransaction').callsFake(mockConnection.sendTransaction);
        sandbox.stub(Connection.prototype, 'confirmTransaction').callsFake(mockConnection.confirmTransaction);
        
        // Mock per il worker del sequencer
        mockWorker = {
            initialize: sandbox.stub().resolves(),
            processBatch: sandbox.stub().resolves({
                success: true,
                signature: 'test-signature'
            })
        };
        
        // Stub per il modulo worker
        sandbox.stub(global, 'require').callsFake((module) => {
            if (module === './sequencer-worker') {
                return mockWorker;
            }
            return require(module);
        });
        
        // Stub per AWS SDK
        const awsCloudHsmStub = {
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
        
        const awsCloudHsmV2Stub = {
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
        
        const awsCloudWatchStub = {
            putMetricData: sandbox.stub().returns({
                promise: sandbox.stub().resolves({})
            })
        };
        
        const awsCloudWatchLogsStub = {
            putLogEvents: sandbox.stub().returns({
                promise: sandbox.stub().resolves({})
            })
        };
        
        // Stub per AWS SDK
        sandbox.stub(global, 'AWS', {
            CloudHSM: sandbox.stub().returns(awsCloudHsmStub),
            CloudHSMV2: sandbox.stub().returns(awsCloudHsmV2Stub),
            CloudWatch: sandbox.stub().returns(awsCloudWatchStub),
            CloudWatchLogs: sandbox.stub().returns(awsCloudWatchLogsStub)
        });
        
        // Crea un'istanza del sequencer con la configurazione di test
        sequencer = new Sequencer(TEST_CONFIG);
    });
    
    afterEach(async () => {
        // Ferma il sequencer se è in esecuzione
        if (sequencer && sequencer.isRunning) {
            await sequencer.stop();
        }
        
        // Ripristina tutti gli stub e i mock
        sandbox.restore();
    });
    
    describe('Inizializzazione del sequencer con HSM', () => {
        it('dovrebbe inizializzare il sequencer con AWS CloudHSM', async () => {
            // Inizializza il sequencer
            await sequencer.initialize();
            
            // Verifica che il sequencer sia inizializzato
            expect(sequencer.keyManager).to.not.be.null;
            expect(sequencer.publicKey).to.be.an.instanceOf(PublicKey);
            
            // Verifica che il sistema di rotazione delle chiavi sia inizializzato
            expect(sequencer.keyRotationSystem).to.not.be.null;
            
            // Verifica che le metriche HSM siano inizializzate
            expect(sequencer.metrics.hsmStatus).to.equal('active');
        });
        
        it('dovrebbe gestire errori durante l\'inizializzazione dell\'HSM', async () => {
            // Modifica la configurazione per simulare un errore
            sequencer.config.hsmAwsClusterId = 'invalid-cluster-id';
            
            // Modifica lo stub per simulare un errore
            global.AWS.CloudHSM().describeClusters.returns({
                promise: sandbox.stub().rejects(new Error('Cluster non trovato'))
            });
            
            try {
                await sequencer.initialize();
                // Se arriviamo qui, il test fallisce
                expect.fail('Dovrebbe lanciare un\'eccezione');
            } catch (error) {
                // Verifica che l'errore sia quello atteso
                expect(error.message).to.include('Cluster non trovato');
                
                // Verifica che le metriche HSM siano aggiornate
                expect(sequencer.metrics.hsmStatus).to.equal('error');
            }
        });
        
        it('dovrebbe inizializzare il sequencer con failover abilitato', async () => {
            // Modifica la configurazione per abilitare il failover
            sequencer.config.hsmEnableFailover = true;
            
            // Inizializza il sequencer
            await sequencer.initialize();
            
            // Verifica che il sequencer sia inizializzato
            expect(sequencer.keyManager).to.not.be.null;
            expect(sequencer.publicKey).to.be.an.instanceOf(PublicKey);
            
            // Verifica che il key manager supporti il failover
            expect(sequencer.keyManager.getStatus).to.be.a('function');
            
            // Verifica lo stato del failover
            const status = await sequencer.getHsmStatus();
            expect(status).to.have.property('currentProvider');
        });
    });
    
    describe('Operazioni di firma con HSM', () => {
        beforeEach(async () => {
            // Inizializza il sequencer
            await sequencer.initialize();
        });
        
        it('dovrebbe firmare un messaggio utilizzando l\'HSM', async () => {
            const message = 'test-message';
            const signature = await sequencer.signMessage(message);
            
            // Verifica che la firma sia un Buffer
            expect(Buffer.isBuffer(signature)).to.be.true;
            
            // Verifica che le metriche HSM siano aggiornate
            expect(sequencer.metrics.hsmOperations).to.equal(1);
        });
        
        it('dovrebbe verificare una firma utilizzando l\'HSM', async () => {
            const message = 'test-message';
            const signature = await sequencer.signMessage(message);
            const isValid = await sequencer.verifySignature(message, signature);
            
            // Verifica che la firma sia valida
            expect(isValid).to.be.true;
            
            // Verifica che le metriche HSM siano aggiornate
            expect(sequencer.metrics.hsmOperations).to.equal(2);
        });
        
        it('dovrebbe registrare eventi HSM nel database', async () => {
            // Firma un messaggio per generare un evento
            await sequencer.signMessage('test-message');
            
            // Verifica che l'evento sia stato registrato
            const events = await sequencer.db.all('SELECT * FROM hsm_events WHERE event_type = ?', ['MESSAGE_SIGNED']);
            expect(events.length).to.be.at.least(1);
            
            // Verifica che l'evento contenga i dati attesi
            const eventData = JSON.parse(events[0].event_data);
            expect(eventData).to.have.property('messageHash');
        });
    });
    
    describe('Failover HSM', () => {
        beforeEach(async () => {
            // Modifica la configurazione per abilitare il failover
            sequencer.config.hsmEnableFailover = true;
            
            // Inizializza il sequencer
            await sequencer.initialize();
        });
        
        it('dovrebbe gestire il failover quando l\'HSM primario non è disponibile', async () => {
            // Modifica lo stub per simulare un HSM primario non disponibile
            global.AWS.CloudHSM().describeClusters.returns({
                promise: sandbox.stub().rejects(new Error('HSM non disponibile'))
            });
            
            // Firma un messaggio per attivare il failover
            const signature = await sequencer.signMessage('test-message');
            
            // Verifica che la firma sia un Buffer
            expect(Buffer.isBuffer(signature)).to.be.true;
            
            // Verifica che le metriche HSM siano aggiornate
            expect(sequencer.metrics.hsmFailovers).to.be.at.least(1);
            
            // Verifica che lo stato HSM sia aggiornato
            const status = await sequencer.getHsmStatus();
            expect(status.currentProvider).to.not.equal('primary');
        });
        
        it('dovrebbe registrare eventi di failover nel database', async () => {
            // Modifica lo stub per simulare un HSM primario non disponibile
            global.AWS.CloudHSM().describeClusters.returns({
                promise: sandbox.stub().rejects(new Error('HSM non disponibile'))
            });
            
            // Firma un messaggio per attivare il failover
            await sequencer.signMessage('test-message');
            
            // Verifica che l'evento sia stato registrato
            const events = await sequencer.db.all('SELECT * FROM hsm_events WHERE event_type LIKE ?', ['%FAILOVER%']);
            expect(events.length).to.be.at.least(1);
        });
    });
    
    describe('Rotazione delle chiavi', () => {
        beforeEach(async () => {
            // Modifica la configurazione per abilitare la rotazione delle chiavi
            sequencer.config.hsmEnableKeyRotation = true;
            sequencer.config.hsmKeyRotationIntervalDays = 90;
            
            // Inizializza il sequencer
            await sequencer.initialize();
            
            // Modifica la data dell'ultima rotazione per forzare una rotazione
            if (sequencer.keyRotationSystem) {
                sequencer.keyRotationSystem.lastRotation = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000); // 91 giorni fa
                sequencer.keyRotationSystem.nextRotation = new Date(Date.now() - 1000); // Nel passato
            }
        });
        
        it('dovrebbe eseguire la rotazione delle chiavi quando necessario', async () => {
            // Verifica che il sistema di rotazione delle chiavi sia inizializzato
            expect(sequencer.keyRotationSystem).to.not.be.null;
            
            // Esegui la verifica della rotazione
            await sequencer.keyRotationSystem.checkRotation();
            
            // Verifica che la rotazione sia stata eseguita
            expect(sequencer.keyRotationSystem.lastRotation.getTime()).to.be.greaterThan(Date.now() - 1000 * 60); // Meno di un minuto fa
            
            // Verifica che le metriche siano aggiornate
            expect(sequencer.metrics.keyRotations).to.be.at.least(1);
        });
        
        it('dovrebbe registrare eventi di rotazione delle chiavi nel database', async () => {
            // Esegui la verifica della rotazione
            await sequencer.keyRotationSystem.checkRotation();
            
            // Verifica che l'evento sia stato registrato
            const events = await sequencer.db.all('SELECT * FROM hsm_events WHERE event_type LIKE ?', ['%ROTATION%']);
            expect(events.length).to.be.at.least(1);
        });
    });
    
    describe('Integrazione con il sequencer', () => {
        beforeEach(async () => {
            // Inizializza il sequencer
            await sequencer.initialize();
            
            // Avvia il sequencer
            await sequencer.start();
        });
        
        afterEach(async () => {
            // Ferma il sequencer
            await sequencer.stop();
        });
        
        it('dovrebbe elaborare transazioni utilizzando l\'HSM per la firma', async () => {
            // Aggiungi una transazione
            const transaction = {
                sender: 'sender-address',
                recipient: 'recipient-address',
                amount: 100,
                nonce: 1,
                expiry_timestamp: Date.now() + 3600000, // 1 ora nel futuro
                transaction_type: 1,
                data: Buffer.from('test-data')
            };
            
            const result = await sequencer.addTransaction(transaction);
            
            // Verifica che la transazione sia stata aggiunta con successo
            expect(result.success).to.be.true;
            
            // Forza l'elaborazione delle transazioni in sospeso
            await sequencer.processPendingTransactions();
            
            // Verifica che il worker sia stato chiamato per elaborare il batch
            expect(mockWorker.processBatch.calledOnce).to.be.true;
            
            // Verifica che le metriche siano aggiornate
            expect(sequencer.metrics.transactionsProcessed).to.equal(1);
            expect(sequencer.metrics.batchesSubmitted).to.equal(1);
            expect(sequencer.metrics.hsmOperations).to.be.at.least(1);
        });
        
        it('dovrebbe gestire errori durante l\'elaborazione delle transazioni', async () => {
            // Modifica il mock del worker per simulare un errore
            mockWorker.processBatch.resolves({
                success: false,
                error: 'Errore durante l\'elaborazione del batch'
            });
            
            // Aggiungi una transazione
            const transaction = {
                sender: 'sender-address',
                recipient: 'recipient-address',
                amount: 100,
                nonce: 1,
                expiry_timestamp: Date.now() + 3600000, // 1 ora nel futuro
                transaction_type: 1,
                data: Buffer.from('test-data')
            };
            
            await sequencer.addTransaction(transaction);
            
            // Forza l'elaborazione delle transazioni in sospeso
            await sequencer.processPendingTransactions();
            
            // Verifica che il worker sia stato chiamato per elaborare il batch
            expect(mockWorker.processBatch.calledOnce).to.be.true;
            
            // Verifica che le metriche siano aggiornate
            expect(sequencer.metrics.errors).to.equal(1);
            
            // Verifica che l'evento sia stato registrato
            const events = await sequencer.db.all('SELECT * FROM hsm_events WHERE event_type = ?', ['BATCH_SIGNING_ERROR']);
            expect(events.length).to.be.at.least(1);
        });
    });
    
    describe('Gestione degli errori HSM', () => {
        beforeEach(async () => {
            // Inizializza il sequencer
            await sequencer.initialize();
        });
        
        it('dovrebbe gestire errori durante la firma con HSM', async () => {
            // Modifica lo stub per simulare un errore durante la firma
            global.AWS.CloudHSMV2().sign.returns({
                promise: sandbox.stub().rejects(new Error('Errore durante la firma'))
            });
            
            try {
                await sequencer.signMessage('test-message');
                // Se arriviamo qui, il test fallisce
                expect.fail('Dovrebbe lanciare un\'eccezione');
            } catch (error) {
                // Verifica che l'errore sia quello atteso
                expect(error.message).to.include('Errore durante la firma');
                
                // Verifica che l'evento sia stato registrato
                const events = await sequencer.db.all('SELECT * FROM hsm_events WHERE event_type = ?', ['MESSAGE_SIGNING_ERROR']);
                expect(events.length).to.be.at.least(1);
            }
        });
        
        it('dovrebbe gestire errori durante la verifica con HSM', async () => {
            // Modifica lo stub per simulare un errore durante la verifica
            global.AWS.CloudHSMV2().verify.returns({
                promise: sandbox.stub().rejects(new Error('Errore durante la verifica'))
            });
            
            try {
                await sequencer.verifySignature('test-message', Buffer.from('test-signature'));
                // Se arriviamo qui, il test fallisce
                expect.fail('Dovrebbe lanciare un\'eccezione');
            } catch (error) {
                // Verifica che l'errore sia quello atteso
                expect(error.message).to.include('Errore durante la verifica');
                
                // Verifica che l'evento sia stato registrato
                const events = await sequencer.db.all('SELECT * FROM hsm_events WHERE event_type = ?', ['SIGNATURE_VERIFICATION_ERROR']);
                expect(events.length).to.be.at.least(1);
            }
        });
    });
});
