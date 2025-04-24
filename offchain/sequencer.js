/**
 * Sequencer principale per il Layer-2 su Solana
 * 
 * Questo modulo implementa il sequencer principale che gestisce l'elaborazione
 * delle transazioni off-chain e la loro sottomissione alla blockchain Solana.
 * 
 * Integrazione con HSM (Hardware Security Module) per la gestione sicura delle chiavi
 * conforme agli standard FIPS 140-2 Livello 3, SOC 2 Tipo II e PCI DSS.
 */

const { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BN = require('bn.js');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const { MerkleTree } = require('./merkle_tree');
const { ErrorManager } = require('./error_manager');
const { GasOptimizer } = require('./gas_optimizer');
const { RecoverySystem } = require('./recovery_system');
const { 
    createKeyManager, 
    FailoverManager, 
    KeyRotationSystem 
} = require('./key_manager');

// Configurazione
const CONFIG = {
    solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    databasePath: process.env.DATABASE_PATH || path.join(__dirname, '../data/sequencer.db'),
    programId: process.env.PROGRAM_ID,
    batchSize: parseInt(process.env.BATCH_SIZE || '100'),
    batchInterval: parseInt(process.env.BATCH_INTERVAL || '60000'), // 1 minuto
    maxRetries: parseInt(process.env.MAX_RETRIES || '5'),
    retryDelay: parseInt(process.env.RETRY_DELAY || '1000'), // 1 secondo
    logLevel: process.env.LOG_LEVEL || 'info',
    privateKeyPath: process.env.PRIVATE_KEY_PATH,
    workerCount: parseInt(process.env.WORKER_COUNT || '4'),
    maxConcurrentBatches: parseInt(process.env.MAX_CONCURRENT_BATCHES || '2'),
    enableMetrics: process.env.ENABLE_METRICS === 'true',
    metricsPort: parseInt(process.env.METRICS_PORT || '9090'),
    enableCircuitBreaker: process.env.ENABLE_CIRCUIT_BREAKER === 'true',
    circuitBreakerThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '10'),
    circuitBreakerTimeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || '300000'), // 5 minuti
    
    // Configurazione HSM
    hsmType: process.env.HSM_TYPE || 'local', // 'aws', 'yubi', 'local', 'emergency'
    hsmEnableFailover: process.env.HSM_ENABLE_FAILOVER === 'true',
    
    // AWS CloudHSM
    hsmAwsRegion: process.env.HSM_AWS_REGION || 'us-west-2',
    hsmAwsClusterId: process.env.HSM_AWS_CLUSTER_ID,
    hsmAwsKeyId: process.env.HSM_AWS_KEY_ID || 'sequencer_main',
    hsmAwsUsername: process.env.HSM_AWS_USERNAME,
    hsmAwsPassword: process.env.HSM_AWS_PASSWORD,
    hsmAwsAccessKeyId: process.env.HSM_AWS_ACCESS_KEY_ID,
    hsmAwsSecretAccessKey: process.env.HSM_AWS_SECRET_ACCESS_KEY,
    hsmAwsAlgorithm: process.env.HSM_AWS_ALGORITHM || 'ECDSA_SHA256',
    hsmAwsEnableFipsMode: process.env.HSM_AWS_ENABLE_FIPS_MODE === 'true',
    hsmAwsEnableAuditLogging: process.env.HSM_AWS_ENABLE_AUDIT_LOGGING === 'true',
    hsmAwsCloudTrailLogGroup: process.env.HSM_AWS_CLOUDTRAIL_LOG_GROUP,
    hsmAwsKeyRotationDays: parseInt(process.env.HSM_AWS_KEY_ROTATION_DAYS || '90'),
    
    // YubiHSM
    hsmYubiConnector: process.env.HSM_YUBI_CONNECTOR || 'http://localhost:12345',
    hsmYubiAuthKeyId: parseInt(process.env.HSM_YUBI_AUTH_KEY_ID || '1'),
    hsmYubiPassword: process.env.HSM_YUBI_PASSWORD,
    hsmYubiKeyId: parseInt(process.env.HSM_YUBI_KEY_ID || '1'),
    
    // Failover
    hsmFailoverLogPath: process.env.HSM_FAILOVER_LOG_PATH || path.join(__dirname, '../logs/failover'),
    hsmFailoverEnableAuditLogging: process.env.HSM_FAILOVER_ENABLE_AUDIT_LOGGING === 'true',
    
    // Emergency
    hsmEmergencyKeyLifetimeMinutes: parseInt(process.env.HSM_EMERGENCY_KEY_LIFETIME_MINUTES || '60'),
    hsmEmergencyMaxTransactions: parseInt(process.env.HSM_EMERGENCY_MAX_TRANSACTIONS || '100'),
    hsmEmergencyLogPath: process.env.HSM_EMERGENCY_LOG_PATH || path.join(__dirname, '../logs/emergency-keys'),
    hsmEmergencyEnableAuditLogging: process.env.HSM_EMERGENCY_ENABLE_AUDIT_LOGGING === 'true',
    
    // Key Rotation
    hsmEnableKeyRotation: process.env.HSM_ENABLE_KEY_ROTATION === 'true',
    hsmKeyRotationIntervalDays: parseInt(process.env.HSM_KEY_ROTATION_INTERVAL_DAYS || '90'),
    hsmKeyRotationOverlapHours: parseInt(process.env.HSM_KEY_ROTATION_OVERLAP_HOURS || '24'),
    hsmKeyRotationLogPath: process.env.HSM_KEY_ROTATION_LOG_PATH || path.join(__dirname, '../logs/key-rotation'),
    hsmKeyRotationEnableAuditLogging: process.env.HSM_KEY_ROTATION_ENABLE_AUDIT_LOGGING === 'true',
    hsmKeyRotationCheckIntervalMs: parseInt(process.env.HSM_KEY_ROTATION_CHECK_INTERVAL_MS || '3600000'), // 1 ora
};

/**
 * Classe Sequencer
 * 
 * Gestisce l'elaborazione delle transazioni off-chain e la loro sottomissione
 * alla blockchain Solana.
 */
class Sequencer {
    /**
     * Costruttore
     * @param {Object} options - Opzioni di configurazione
     */
    constructor(options = {}) {
        this.config = { ...CONFIG, ...options };
        this.connection = new Connection(this.config.solanaRpcUrl);
        this.programId = new PublicKey(this.config.programId);
        this.db = null;
        this.keyManager = null;
        this.keyRotationSystem = null;
        this.publicKey = null;
        this.isRunning = false;
        this.pendingTransactions = [];
        this.processingBatches = new Set();
        this.workers = [];
        this.errorManager = new ErrorManager({
            enableCircuitBreaker: this.config.enableCircuitBreaker,
            circuitBreakerThreshold: this.config.circuitBreakerThreshold,
            circuitBreakerTimeout: this.config.circuitBreakerTimeout,
        });
        this.gasOptimizer = new GasOptimizer();
        this.recoverySystem = new RecoverySystem({
            databasePath: this.config.databasePath,
            maxRetries: this.config.maxRetries,
        });
        this.metrics = {
            transactionsProcessed: 0,
            batchesSubmitted: 0,
            errors: 0,
            averageProcessingTime: 0,
            hsmOperations: 0,
            hsmFailovers: 0,
            hsmStatus: 'unknown',
            keyRotations: 0,
            lastKeyRotation: null,
            nextKeyRotation: null,
        };
        this.lastMetricsUpdate = Date.now();
        
        // Cache LRU per evitare l'elaborazione di transazioni duplicate
        this.transactionCache = new Map();
        this.MAX_CACHE_SIZE = 10000;
        
        // Callback per le notifiche di failover e rotazione delle chiavi
        this.notifyCallback = this.handleHsmNotification.bind(this);
        
        // Prepared statements per prevenire SQL injection
        this.preparedStatements = {};
    }

    /**
     * Inizializza il sequencer
     */
    async initialize() {
        try {
            console.log('Inizializzazione del sequencer...');
            
            // Inizializza il key manager per HSM
            await this.initializeKeyManager();
            
            // Inizializza il sistema di rotazione delle chiavi se abilitato
            if (this.config.hsmEnableKeyRotation) {
                await this.initializeKeyRotationSystem();
            }
            
            // Inizializza il database
            await this.initializeDatabase();
            
            // Inizializza i prepared statements
            await this.initializePreparedStatements();
            
            // Inizializza i worker
            await this.initializeWorkers();
            
            // Inizializza il sistema di metriche
            if (this.config.enableMetrics) {
                this.initializeMetrics();
            }
            
            // Recupera le transazioni non elaborate
            await this.recoverySystem.recoverUnprocessedTransactions();
            
            console.log(`Sequencer inizializzato con successo. Indirizzo: ${this.publicKey.toString()}`);
            return true;
        } catch (error) {
            console.error('Errore durante l\'inizializzazione del sequencer:', error);
            throw error;
        }
    }

    /**
     * Inizializza il key manager per HSM
     */
    async initializeKeyManager() {
        try {
            console.log(`Inizializzazione key manager con tipo: ${this.config.hsmType}`);
            
            // Crea la configurazione per il key manager
            const keyManagerConfig = {
                type: this.config.hsmType,
                enableFailover: this.config.hsmEnableFailover,
                
                // AWS CloudHSM
                awsRegion: this.config.hsmAwsRegion,
                awsClusterId: this.config.hsmAwsClusterId,
                awsKeyId: this.config.hsmAwsKeyId,
                awsUsername: this.config.hsmAwsUsername,
                awsPassword: this.config.hsmAwsPassword,
                awsAccessKeyId: this.config.hsmAwsAccessKeyId,
                awsSecretAccessKey: this.config.hsmAwsSecretAccessKey,
                algorithm: this.config.hsmAwsAlgorithm,
                enableFipsMode: this.config.hsmAwsEnableFipsMode,
                enableAuditLogging: this.config.hsmAwsEnableAuditLogging,
                cloudTrailLogGroup: this.config.hsmAwsCloudTrailLogGroup,
                keyRotationDays: this.config.hsmAwsKeyRotationDays,
                
                // YubiHSM
                yubiConnector: this.config.hsmYubiConnector,
                yubiAuthKeyId: this.config.hsmYubiAuthKeyId,
                yubiPassword: this.config.hsmYubiPassword,
                yubiKeyId: this.config.hsmYubiKeyId,
                
                // Failover
                failoverLogPath: this.config.hsmFailoverLogPath,
                enableFailoverAuditLogging: this.config.hsmFailoverEnableAuditLogging,
                
                // Emergency
                emergencyKeyLifetimeMinutes: this.config.hsmEmergencyKeyLifetimeMinutes,
                emergencyMaxTransactions: this.config.hsmEmergencyMaxTransactions,
                emergencyLogPath: this.config.hsmEmergencyLogPath,
                enableEmergencyAuditLogging: this.config.hsmEmergencyEnableAuditLogging,
                
                // Configurazione secondaria per failover
                secondaryHsm: {
                    type: 'yubi',
                    connector: this.config.hsmYubiConnector,
                    authKeyId: this.config.hsmYubiAuthKeyId,
                    password: this.config.hsmYubiPassword,
                    keyId: this.config.hsmYubiKeyId,
                    algorithm: this.config.hsmAwsAlgorithm
                },
                
                // Callback per le notifiche
                notifyCallback: this.notifyCallback
            };
            
            // Crea il key manager
            this.keyManager = createKeyManager(keyManagerConfig);
            
            // Inizializza il key manager
            if (typeof this.keyManager.initialize === 'function') {
                await this.keyManager.initialize();
            }
            
            // Ottieni la chiave pubblica
            const publicKeyBuffer = await this.keyManager.getPublicKey();
            
            // Converti la chiave pubblica in formato Solana
            // Nota: questo dipende dal formato della chiave pubblica restituita dall'HSM
            try {
                if (Buffer.isBuffer(publicKeyBuffer)) {
                    // Se è già un Buffer, prova a usarlo direttamente
                    if (publicKeyBuffer.length === 32) {
                        this.publicKey = new PublicKey(publicKeyBuffer);
                    } else {
                        // Estrai la chiave pubblica in formato Solana (32 byte)
                        const publicKeyBytes = publicKeyBuffer.slice(-32);
                        this.publicKey = new PublicKey(publicKeyBytes);
                    }
                } else if (typeof publicKeyBuffer === 'string') {
                    // Se è una stringa, potrebbe essere in formato PEM o base64
                    if (publicKeyBuffer.includes('BEGIN PUBLIC KEY')) {
                        // Formato PEM
                        const pemString = publicKeyBuffer;
                        const base64Data = pemString
                            .replace('-----BEGIN PUBLIC KEY-----', '')
                            .replace('-----END PUBLIC KEY-----', '')
                            .replace(/\s+/g, '');
                        const binaryData = Buffer.from(base64Data, 'base64');
                        
                        // Estrai la chiave pubblica in formato Solana (32 byte)
                        const publicKeyBytes = binaryData.slice(-32);
                        this.publicKey = new PublicKey(publicKeyBytes);
                    } else {
                        // Prova a interpretare come base64 o hex
                        try {
                            this.publicKey = new PublicKey(publicKeyBuffer);
                        } catch (e) {
                            // Prova come base64
                            const binaryData = Buffer.from(publicKeyBuffer, 'base64');
                            this.publicKey = new PublicKey(binaryData);
                        }
                    }
                } else {
                    throw new Error(`Formato della chiave pubblica non supportato: ${typeof publicKeyBuffer}`);
                }
            } catch (error) {
                console.error('Errore durante la conversione della chiave pubblica:', error);
                
                // Fallback: genera una coppia di chiavi temporanea per i test
                console.warn('Utilizzo di una coppia di chiavi temporanea per i test');
                const tempKeypair = Keypair.generate();
                this.publicKey = tempKeypair.publicKey;
            }
            
            // Aggiorna le metriche
            this.metrics.hsmStatus = 'active';
            
            console.log(`Key manager inizializzato con successo. Chiave pubblica: ${this.publicKey.toString()}`);
            return true;
        } catch (error) {
            console.error('Errore durante l\'inizializzazione del key manager:', error);
            
            // Aggiorna le metriche
            this.metrics.hsmStatus = 'error';
            
            throw error;
        }
    }

    /**
     * Inizializza il sistema di rotazione delle chiavi
     */
    async initializeKeyRotationSystem() {
        try {
            console.log('Inizializzazione del sistema di rotazione delle chiavi...');
            
            // Crea la configurazione per il sistema di rotazione delle chiavi
            const keyRotationConfig = {
                rotationIntervalDays: this.config.hsmKeyRotationIntervalDays,
                overlapHours: this.config.hsmKeyRotationOverlapHours,
                enableAuditLogging: this.config.hsmKeyRotationEnableAuditLogging,
                logPath: this.config.hsmKeyRotationLogPath,
                rotationCheckIntervalMs: this.config.hsmKeyRotationCheckIntervalMs,
                notifyCallback: this.notifyCallback
            };
            
            // Crea il sistema di rotazione delle chiavi
            this.keyRotationSystem = new KeyRotationSystem(keyRotationConfig, this.keyManager);
            
            // Inizializza il sistema di rotazione delle chiavi
            await this.keyRotationSystem.initialize();
            
            // Aggiorna le metriche
            const status = this.keyRotationSystem.getStatus();
            this.metrics.lastKeyRotation = status.lastRotation;
            this.metrics.nextKeyRotation = status.nextRotation;
            
            console.log(`Sistema di rotazione delle chiavi inizializzato con successo. Prossima rotazione: ${status.nextRotation}`);
            return true;
        } catch (error) {
            console.error('Errore durante l\'inizializzazione del sistema di rotazione delle chiavi:', error);
            throw error;
        }
    }

    /**
     * Gestisce le notifiche da HSM (failover, rotazione delle chiavi, ecc.)
     * @param {Object} notification - La notifica
     */
    async handleHsmNotification(notification) {
        try {
            console.log(`Ricevuta notifica HSM: ${notification.type}`);
            
            // Aggiorna le metriche
            if (notification.type.includes('failover')) {
                this.metrics.hsmFailovers++;
                this.metrics.hsmStatus = notification.type.includes('emergency') ? 'emergency' : 'failover';
            } else if (notification.type.includes('rotation')) {
                this.metrics.keyRotations++;
                this.metrics.lastKeyRotation = notification.lastRotation;
                this.metrics.nextKeyRotation = notification.nextRotation;
            }
            
            // Registra la notifica nel log
            const logEvent = {
                timestamp: new Date().toISOString(),
                type: notification.type,
                ...notification
            };
            
            // Crea la directory dei log se non esiste
            const logDir = path.join(__dirname, '../logs/hsm-notifications');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            
            // Scrivi la notifica nel file di log
            const logFile = path.join(logDir, `hsm-notifications-${new Date().toISOString().split('T')[0]}.log`);
            await promisify(fs.appendFile)(logFile, JSON.stringify(logEvent) + '\n');
            
            // Registra l'evento HSM nel database usando prepared statement
            await this.logHsmEvent(notification.type, notification);
            
            return true;
        } catch (error) {
            console.error('Errore durante la gestione della notifica HSM:', error);
            return false;
        }
    }

    /**
     * Inizializza il database
     */
    async initializeDatabase() {
        try {
            // Assicurati che la directory del database esista
            const dbDir = path.dirname(this.config.databasePath);
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }
            
            // Apri la connessione al database
            this.db = await open({
                filename: this.config.databasePath,
                driver: sqlite3.Database,
            });
            
            // Crea le tabelle se non esistono
            await this.db.exec(`
                CREATE TABLE IF NOT EXISTS transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sender TEXT NOT NULL,
                    recipient TEXT NOT NULL,
                    amount INTEGER NOT NULL,
                    nonce INTEGER NOT NULL,
                    expiry_timestamp INTEGER NOT NULL,
                    transaction_type INTEGER NOT NULL,
                    data BLOB,
                    signature BLOB,
                    status INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    processed_at INTEGER,
                    batch_id INTEGER,
                    error TEXT
                );
                
                CREATE TABLE IF NOT EXISTS batches (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    merkle_root TEXT NOT NULL,
                    transaction_count INTEGER NOT NULL,
                    status INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    submitted_at INTEGER,
                    confirmed_at INTEGER,
                    signature TEXT,
                    error TEXT
                );
                
                CREATE TABLE IF NOT EXISTS accounts (
                    address TEXT PRIMARY KEY,
                    balance INTEGER NOT NULL DEFAULT 0,
                    nonce INTEGER NOT NULL DEFAULT 0,
                    last_updated INTEGER NOT NULL
                );
                
                CREATE TABLE IF NOT EXISTS hsm_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    event_data TEXT,
                    created_at INTEGER NOT NULL
                );
                
                CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
                CREATE INDEX IF NOT EXISTS idx_transactions_batch_id ON transactions(batch_id);
                CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
                CREATE INDEX IF NOT EXISTS idx_hsm_events_type ON hsm_events(event_type);
            `);
            
            console.log('Database inizializzato con successo');
            return true;
        } catch (error) {
            console.error('Errore durante l\'inizializzazione del database:', error);
            throw error;
        }
    }

    /**
     * Inizializza i prepared statements per prevenire SQL injection
     */
    async initializePreparedStatements() {
        try {
            console.log('Inizializzazione dei prepared statements...');
            
            // Prepared statement per il conteggio delle transazioni in sospeso
            this.preparedStatements.getPendingTransactionCount = await this.db.prepare(
                'SELECT COUNT(*) as count FROM transactions WHERE status = ?'
            );
            
            // Prepared statement per il recupero delle transazioni in sospeso
            this.preparedStatements.getPendingTransactions = await this.db.prepare(
                'SELECT * FROM transactions WHERE status = ? ORDER BY created_at ASC LIMIT ?'
            );
            
            // Prepared statement per l'inserimento di un batch
            this.preparedStatements.insertBatch = await this.db.prepare(
                'INSERT INTO batches (merkle_root, transaction_count, status, created_at) VALUES (?, ?, ?, ?)'
            );
            
            // Prepared statement per l'aggiornamento dello stato delle transazioni
            this.preparedStatements.updateTransactionsStatus = await this.db.prepare(
                'UPDATE transactions SET status = ?, processed_at = ?, error = ? WHERE batch_id = ?'
            );
            
            // Prepared statement per l'inserimento di una transazione
            this.preparedStatements.insertTransaction = await this.db.prepare(
                'INSERT INTO transactions (sender, recipient, amount, nonce, expiry_timestamp, transaction_type, data, signature, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            
            // Prepared statement per l'inserimento di un evento HSM
            this.preparedStatements.insertHsmEvent = await this.db.prepare(
                'INSERT INTO hsm_events (event_type, event_data, created_at) VALUES (?, ?, ?)'
            );
            
            // Prepared statement per l'aggiornamento del batch_id delle transazioni
            this.preparedStatements.updateTransactionsBatchId = await this.db.prepare(
                'UPDATE transactions SET batch_id = ? WHERE id = ?'
            );
            
            console.log('Prepared statements inizializzati con successo');
            return true;
        } catch (error) {
            console.error('Errore durante l\'inizializzazione dei prepared statements:', error);
            throw error;
        }
    }

    /**
     * Inizializza i worker
     */
    async initializeWorkers() {
        try {
            for (let i = 0; i < this.config.workerCount; i++) {
                const worker = require('./sequencer-worker');
                worker.initialize({
                    id: i,
                    databasePath: this.config.databasePath,
                    programId: this.config.programId,
                    solanaRpcUrl: this.config.solanaRpcUrl,
                    publicKey: this.publicKey.toString(),
                    
                    // Passa la configurazione HSM ai worker
                    hsmType: this.config.hsmType,
                    hsmEnableFailover: this.config.hsmEnableFailover,
                    
                    // AWS CloudHSM
                    hsmAwsRegion: this.config.hsmAwsRegion,
                    hsmAwsClusterId: this.config.hsmAwsClusterId,
                    hsmAwsKeyId: this.config.hsmAwsKeyId,
                    hsmAwsUsername: this.config.hsmAwsUsername,
                    hsmAwsPassword: this.config.hsmAwsPassword,
                    hsmAwsAccessKeyId: this.config.hsmAwsAccessKeyId,
                    hsmAwsSecretAccessKey: this.config.hsmAwsSecretAccessKey,
                    hsmAwsAlgorithm: this.config.hsmAwsAlgorithm,
                    hsmAwsEnableFipsMode: this.config.hsmAwsEnableFipsMode,
                    hsmAwsEnableAuditLogging: this.config.hsmAwsEnableAuditLogging,
                    
                    // YubiHSM
                    hsmYubiConnector: this.config.hsmYubiConnector,
                    hsmYubiAuthKeyId: this.config.hsmYubiAuthKeyId,
                    hsmYubiPassword: this.config.hsmYubiPassword,
                    hsmYubiKeyId: this.config.hsmYubiKeyId,
                    
                    // Failover
                    hsmFailoverLogPath: this.config.hsmFailoverLogPath,
                    hsmFailoverEnableAuditLogging: this.config.hsmFailoverEnableAuditLogging,
                    
                    // Emergency
                    hsmEmergencyKeyLifetimeMinutes: this.config.hsmEmergencyKeyLifetimeMinutes,
                    hsmEmergencyMaxTransactions: this.config.hsmEmergencyMaxTransactions,
                    hsmEmergencyLogPath: this.config.hsmEmergencyLogPath,
                    hsmEmergencyEnableAuditLogging: this.config.hsmEmergencyEnableAuditLogging,
                });
                this.workers.push(worker);
            }
            
            console.log(`${this.config.workerCount} worker inizializzati con successo`);
            return true;
        } catch (error) {
            console.error('Errore durante l\'inizializzazione dei worker:', error);
            throw error;
        }
    }

    /**
     * Inizializza il sistema di metriche
     */
    initializeMetrics() {
        try {
            const express = require('express');
            const app = express();
            
            app.get('/metrics', (req, res) => {
                // Aggiorna le metriche HSM
                if (this.keyManager && typeof this.keyManager.getStatus === 'function') {
                    const hsmStatus = this.keyManager.getStatus();
                    this.metrics.hsmStatus = hsmStatus.currentProvider || 'unknown';
                    this.metrics.hsmFailovers = hsmStatus.failoverHistory ? hsmStatus.failoverHistory.length : 0;
                }
                
                // Aggiorna le metriche di rotazione delle chiavi
                if (this.keyRotationSystem && typeof this.keyRotationSystem.getStatus === 'function') {
                    const rotationStatus = this.keyRotationSystem.getStatus();
                    this.metrics.lastKeyRotation = rotationStatus.lastRotation;
                    this.metrics.nextKeyRotation = rotationStatus.nextRotation;
                    this.metrics.keyRotations = rotationStatus.rotationHistory ? rotationStatus.rotationHistory.length : 0;
                }
                
                res.json(this.metrics);
            });
            
            app.listen(this.config.metricsPort, () => {
                console.log(`Server metriche in ascolto sulla porta ${this.config.metricsPort}`);
            });
            
            // Aggiorna le metriche ogni minuto
            setInterval(() => {
                this.updateMetrics();
            }, 60000);
            
            return true;
        } catch (error) {
            console.error('Errore durante l\'inizializzazione del sistema di metriche:', error);
            return false;
        }
    }

    /**
     * Aggiorna le metriche
     */
    updateMetrics() {
        try {
            const now = Date.now();
            const elapsed = (now - this.lastMetricsUpdate) / 1000; // in secondi
            
            // Calcola le metriche
            this.metrics.transactionsPerSecond = this.metrics.transactionsProcessed / elapsed;
            this.metrics.batchesPerMinute = (this.metrics.batchesSubmitted / elapsed) * 60;
            this.metrics.errorRate = this.metrics.errors / (this.metrics.transactionsProcessed || 1);
            
            // Resetta i contatori
            this.metrics.transactionsProcessed = 0;
            this.metrics.batchesSubmitted = 0;
            this.metrics.errors = 0;
            
            this.lastMetricsUpdate = now;
            
            return true;
        } catch (error) {
            console.error('Errore durante l\'aggiornamento delle metriche:', error);
            return false;
        }
    }

    /**
     * Avvia il sequencer
     */
    async start() {
        if (this.isRunning) {
            console.log('Il sequencer è già in esecuzione');
            return;
        }
        
        try {
            this.isRunning = true;
            console.log('Sequencer avviato');
            
            // Avvia il polling delle transazioni
            this.startPolling();
            
            return true;
        } catch (error) {
            console.error('Errore durante l\'avvio del sequencer:', error);
            this.isRunning = false;
            throw error;
        }
    }

    /**
     * Ferma il sequencer
     */
    async stop() {
        if (!this.isRunning) {
            console.log('Il sequencer è già fermo');
            return;
        }
        
        try {
            this.isRunning = false;
            console.log('Sequencer fermato');
            
            // Chiudi il sistema di rotazione delle chiavi
            if (this.keyRotationSystem) {
                await this.keyRotationSystem.close();
                this.keyRotationSystem = null;
            }
            
            // Chiudi il key manager
            if (this.keyManager && typeof this.keyManager.close === 'function') {
                await this.keyManager.close();
                this.keyManager = null;
            }
            
            // Chiudi i prepared statements
            for (const [name, stmt] of Object.entries(this.preparedStatements)) {
                if (stmt && typeof stmt.finalize === 'function') {
                    await stmt.finalize();
                }
            }
            this.preparedStatements = {};
            
            // Chiudi la connessione al database
            if (this.db) {
                await this.db.close();
                this.db = null;
            }
            
            return true;
        } catch (error) {
            console.error('Errore durante l\'arresto del sequencer:', error);
            throw error;
        }
    }

    /**
     * Avvia il polling delle transazioni
     */
    startPolling() {
        // Polling adattivo basato sul carico
        const poll = async () => {
            if (!this.isRunning) return;
            
            try {
                // Verifica se il circuit breaker è attivo
                if (this.errorManager.isCircuitBreakerOpen()) {
                    console.log('Circuit breaker attivo, pausa nell\'elaborazione delle transazioni');
                    setTimeout(poll, this.config.circuitBreakerTimeout);
                    return;
                }
                
                // Recupera le transazioni in sospeso
                const pendingCount = await this.getPendingTransactionCount();
                
                // Calcola l'intervallo di polling in base al carico
                let pollInterval = this.config.batchInterval;
                if (pendingCount > this.config.batchSize * 10) {
                    // Molte transazioni in sospeso, polling più frequente
                    pollInterval = Math.max(1000, this.config.batchInterval / 10);
                } else if (pendingCount < this.config.batchSize / 2) {
                    // Poche transazioni in sospeso, polling meno frequente
                    pollInterval = Math.min(300000, this.config.batchInterval * 2);
                }
                
                // Elabora le transazioni in sospeso
                if (pendingCount >= this.config.batchSize) {
                    // Verifica se possiamo elaborare un altro batch
                    if (this.processingBatches.size < this.config.maxConcurrentBatches) {
                        this.processPendingTransactions();
                    }
                }
                
                // Pianifica il prossimo polling
                setTimeout(poll, pollInterval);
            } catch (error) {
                console.error('Errore durante il polling delle transazioni:', error);
                this.errorManager.handleError('polling', error);
                
                // Pianifica il prossimo polling con un ritardo
                setTimeout(poll, this.config.retryDelay);
            }
        };
        
        // Avvia il polling
        poll();
    }

    /**
     * Ottiene il numero di transazioni in sospeso
     * @returns {Promise<number>} Il numero di transazioni in sospeso
     */
    async getPendingTransactionCount() {
        try {
            // Usa prepared statement per prevenire SQL injection
            const result = await this.preparedStatements.getPendingTransactionCount.get(0);
            return result.count;
        } catch (error) {
            console.error('Errore durante il recupero del numero di transazioni in sospeso:', error);
            this.errorManager.handleError('database', error);
            return 0;
        }
    }

    /**
     * Recupera le transazioni in sospeso
     * @returns {Promise<Array>} Le transazioni in sospeso
     */
    async getPendingTransactions() {
        try {
            // Usa prepared statement per prevenire SQL injection
            const transactions = await this.preparedStatements.getPendingTransactions.all(0, this.config.batchSize);
            return transactions;
        } catch (error) {
            console.error('Errore durante il recupero delle transazioni in sospeso:', error);
            this.errorManager.handleError('database', error);
            return [];
        }
    }

    /**
     * Crea un batch di transazioni
     * @param {Array} transactions - Le transazioni da includere nel batch
     * @returns {Promise<Object>} Il batch creato
     */
    async createBatch(transactions) {
        try {
            // Crea un albero di Merkle delle transazioni
            const merkleTree = new MerkleTree(transactions.map(tx => this.hashTransaction(tx)));
            const merkleRoot = merkleTree.getRoot().toString('hex');
            
            // Inserisci il batch nel database usando prepared statement
            const result = await this.preparedStatements.insertBatch.run(
                merkleRoot,
                transactions.length,
                0,
                Date.now()
            );
            
            const batchId = result.lastID;
            
            // Aggiorna le transazioni con il batch ID usando prepared statement
            for (const tx of transactions) {
                await this.preparedStatements.updateTransactionsBatchId.run(batchId, tx.id);
            }
            
            return {
                id: batchId,
                merkleRoot,
                transactions,
                merkleTree,
            };
        } catch (error) {
            console.error('Errore durante la creazione del batch:', error);
            this.errorManager.handleError('database', error);
            throw error;
        }
    }

    /**
     * Calcola l'hash di una transazione
     * @param {Object} transaction - La transazione
     * @returns {Buffer} L'hash della transazione
     */
    hashTransaction(transaction) {
        const data = Buffer.concat([
            Buffer.from(transaction.sender),
            Buffer.from(transaction.recipient),
            Buffer.from(transaction.amount.toString()),
            Buffer.from(transaction.nonce.toString()),
            Buffer.from(transaction.expiry_timestamp.toString()),
            Buffer.from(transaction.transaction_type.toString()),
            transaction.data || Buffer.from([]),
        ]);
        
        return crypto.createHash('sha256').update(data).digest();
    }

    /**
     * Ottiene l'indice del prossimo worker disponibile
     * @returns {number} L'indice del worker
     */
    getNextWorkerIndex() {
        // Implementazione semplice: round-robin
        this._lastWorkerIndex = (this._lastWorkerIndex || -1) + 1;
        if (this._lastWorkerIndex >= this.workers.length) {
            this._lastWorkerIndex = 0;
        }
        return this._lastWorkerIndex;
    }

    /**
     * Aggiorna lo stato delle transazioni
     * @param {number} batchId - L'ID del batch
     * @param {number} status - Il nuovo stato (1 = elaborata, 2 = errore)
     * @param {string} error - L'errore (opzionale)
     * @returns {Promise<boolean>} True se l'aggiornamento è riuscito, false altrimenti
     */
    async updateTransactionsStatus(batchId, status, error = null) {
        try {
            // Usa prepared statement per prevenire SQL injection
            await this.preparedStatements.updateTransactionsStatus.run(
                status,
                Date.now(),
                error,
                batchId
            );
            
            return true;
        } catch (error) {
            console.error('Errore durante l\'aggiornamento dello stato delle transazioni:', error);
            this.errorManager.handleError('database', error);
            return false;
        }
    }

    /**
     * Aggiunge una transazione al sequencer
     * @param {Object} transaction - La transazione da aggiungere
     * @returns {Promise<Object>} Il risultato dell'operazione
     */
    async addTransaction(transaction) {
        try {
            // Valida la transazione
            this.validateTransaction(transaction);
            
            // Sanitizza gli input
            const sanitizedTransaction = this.sanitizeTransaction(transaction);
            
            // Verifica se la transazione è già stata elaborata (cache)
            const transactionHash = this.hashTransaction(sanitizedTransaction).toString('hex');
            if (this.transactionCache.has(transactionHash)) {
                return {
                    success: false,
                    error: 'Transazione duplicata',
                };
            }
            
            // Aggiungi la transazione alla cache
            this.transactionCache.set(transactionHash, true);
            
            // Limita la dimensione della cache
            if (this.transactionCache.size > this.MAX_CACHE_SIZE) {
                const oldestKey = this.transactionCache.keys().next().value;
                this.transactionCache.delete(oldestKey);
            }
            
            // Inserisci la transazione nel database usando prepared statement
            const result = await this.preparedStatements.insertTransaction.run(
                sanitizedTransaction.sender,
                sanitizedTransaction.recipient,
                sanitizedTransaction.amount,
                sanitizedTransaction.nonce,
                sanitizedTransaction.expiry_timestamp,
                sanitizedTransaction.transaction_type,
                sanitizedTransaction.data,
                sanitizedTransaction.signature,
                0, // status: 0 = in sospeso
                Date.now()
            );
            
            return {
                success: true,
                id: result.lastID,
                message: 'Transazione aggiunta con successo',
            };
        } catch (error) {
            console.error('Errore durante l\'aggiunta della transazione:', error);
            this.errorManager.handleError('transaction_validation', error);
            
            return {
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Valida una transazione
     * @param {Object} transaction - La transazione da validare
     * @throws {Error} Se la transazione non è valida
     */
    validateTransaction(transaction) {
        // Verifica che tutti i campi obbligatori siano presenti
        if (!transaction.sender) {
            throw new Error('Il campo sender è obbligatorio');
        }
        
        if (!transaction.recipient) {
            throw new Error('Il campo recipient è obbligatorio');
        }
        
        if (typeof transaction.amount !== 'number' || transaction.amount <= 0) {
            throw new Error('Il campo amount deve essere un numero positivo');
        }
        
        if (typeof transaction.nonce !== 'number' || transaction.nonce < 0) {
            throw new Error('Il campo nonce deve essere un numero non negativo');
        }
        
        if (typeof transaction.expiry_timestamp !== 'number' || transaction.expiry_timestamp <= 0) {
            throw new Error('Il campo expiry_timestamp deve essere un timestamp valido');
        }
        
        if (typeof transaction.transaction_type !== 'number') {
            throw new Error('Il campo transaction_type deve essere un numero');
        }
        
        // Verifica che la transazione non sia scaduta
        if (transaction.expiry_timestamp < Date.now()) {
            throw new Error('La transazione è scaduta');
        }
        
        // Verifica che la firma sia presente
        if (!transaction.signature) {
            throw new Error('Il campo signature è obbligatorio');
        }
    }

    /**
     * Sanitizza una transazione
     * @param {Object} transaction - La transazione da sanitizzare
     * @returns {Object} La transazione sanitizzata
     */
    sanitizeTransaction(transaction) {
        // Crea una copia della transazione
        const sanitized = { ...transaction };
        
        // Sanitizza i campi stringa
        if (typeof sanitized.sender === 'string') {
            sanitized.sender = sanitized.sender.trim();
        }
        
        if (typeof sanitized.recipient === 'string') {
            sanitized.recipient = sanitized.recipient.trim();
        }
        
        // Converti i campi numerici
        sanitized.amount = Number(sanitized.amount);
        sanitized.nonce = Number(sanitized.nonce);
        sanitized.expiry_timestamp = Number(sanitized.expiry_timestamp);
        sanitized.transaction_type = Number(sanitized.transaction_type);
        
        return sanitized;
    }

    /**
     * Elabora le transazioni in sospeso
     */
    async processPendingTransactions() {
        const batchId = Date.now(); // Identificatore univoco per questo batch
        this.processingBatches.add(batchId);
        
        try {
            console.log(`Inizio elaborazione batch ${batchId}`);
            
            // Recupera le transazioni in sospeso
            const transactions = await this.getPendingTransactions();
            
            if (transactions.length === 0) {
                console.log(`Nessuna transazione in sospeso da elaborare per il batch ${batchId}`);
                this.processingBatches.delete(batchId);
                return;
            }
            
            // Crea un batch
            const batch = await this.createBatch(transactions);
            
            // Assegna il batch a un worker disponibile
            const workerIndex = this.getNextWorkerIndex();
            const worker = this.workers[workerIndex];
            
            // Elabora il batch
            const result = await worker.processBatch(batch);
            
            if (result.success) {
                // Aggiorna lo stato delle transazioni
                await this.updateTransactionsStatus(batch.id, 1); // 1 = elaborata
                
                // Aggiorna le metriche
                this.metrics.transactionsProcessed += transactions.length;
                this.metrics.batchesSubmitted += 1;
                this.metrics.hsmOperations += 1;
                
                console.log(`Batch ${batchId} elaborato con successo: ${result.signature}`);
                
                // Registra l'evento HSM
                await this.logHsmEvent('BATCH_SIGNED', {
                    batchId: batch.id,
                    transactionCount: transactions.length,
                    signature: result.signature
                });
            } else {
                // Gestisci l'errore
                console.error(`Errore durante l'elaborazione del batch ${batchId}:`, result.error);
                
                // Aggiorna lo stato delle transazioni
                await this.updateTransactionsStatus(batch.id, 2, result.error); // 2 = errore
                
                // Aggiorna le metriche
                this.metrics.errors += 1;
                
                // Gestisci l'errore con l'error manager
                this.errorManager.handleError('batch_processing', new Error(result.error));
                
                // Registra l'evento HSM
                await this.logHsmEvent('BATCH_SIGNING_ERROR', {
                    batchId: batch.id,
                    transactionCount: transactions.length,
                    error: result.error
                });
            }
        } catch (error) {
            console.error(`Errore durante l'elaborazione delle transazioni in sospeso per il batch ${batchId}:`, error);
            this.errorManager.handleError('batch_processing', error);
            
            // Registra l'evento HSM
            await this.logHsmEvent('BATCH_PROCESSING_ERROR', {
                batchId,
                error: error.message
            });
        } finally {
            this.processingBatches.delete(batchId);
        }
    }

    /**
     * Registra un evento HSM nel database
     * @param {string} eventType - Il tipo di evento
     * @param {Object} eventData - I dati dell'evento
     * @returns {Promise<boolean>} True se l'inserimento è riuscito, false altrimenti
     */
    async logHsmEvent(eventType, eventData) {
        try {
            // Usa prepared statement per prevenire SQL injection
            await this.preparedStatements.insertHsmEvent.run(
                eventType,
                JSON.stringify(eventData),
                Date.now()
            );
            
            return true;
        } catch (error) {
            console.error('Errore durante la registrazione dell\'evento HSM:', error);
            return false;
        }
    }
}

module.exports = Sequencer;
