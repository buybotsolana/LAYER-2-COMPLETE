/**
 * Sequencer principale per il Layer-2 su Solana
 * 
 * Questo modulo implementa il sequencer principale che gestisce l'elaborazione
 * delle transazioni off-chain e la loro sottomissione alla blockchain Solana.
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
        this.keypair = null;
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
        };
        this.lastMetricsUpdate = Date.now();
        
        // Cache LRU per evitare l'elaborazione di transazioni duplicate
        this.transactionCache = new Map();
        this.MAX_CACHE_SIZE = 10000;
    }

    /**
     * Inizializza il sequencer
     */
    async initialize() {
        try {
            // Carica la chiave privata
            const privateKeyBuffer = fs.readFileSync(this.config.privateKeyPath);
            const privateKey = new Uint8Array(JSON.parse(privateKeyBuffer));
            this.keypair = Keypair.fromSecretKey(privateKey);
            
            // Inizializza il database
            await this.initializeDatabase();
            
            // Inizializza i worker
            await this.initializeWorkers();
            
            // Inizializza il sistema di metriche
            if (this.config.enableMetrics) {
                this.initializeMetrics();
            }
            
            // Recupera le transazioni non elaborate
            await this.recoverySystem.recoverUnprocessedTransactions();
            
            console.log(`Sequencer inizializzato con successo. Indirizzo: ${this.keypair.publicKey.toString()}`);
            return true;
        } catch (error) {
            console.error('Errore durante l\'inizializzazione del sequencer:', error);
            throw error;
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
                
                CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
                CREATE INDEX IF NOT EXISTS idx_transactions_batch_id ON transactions(batch_id);
                CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
            `);
            
            console.log('Database inizializzato con successo');
            return true;
        } catch (error) {
            console.error('Errore durante l\'inizializzazione del database:', error);
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
            const result = await this.db.get('SELECT COUNT(*) as count FROM transactions WHERE status = 0');
            return result.count;
        } catch (error) {
            console.error('Errore durante il recupero del numero di transazioni in sospeso:', error);
            this.errorManager.handleError('database', error);
            return 0;
        }
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
                
                console.log(`Batch ${batchId} elaborato con successo: ${result.signature}`);
            } else {
                // Gestisci l'errore
                console.error(`Errore durante l'elaborazione del batch ${batchId}:`, result.error);
                
                // Aggiorna lo stato delle transazioni
                await this.updateTransactionsStatus(batch.id, 2, result.error); // 2 = errore
                
                // Aggiorna le metriche
                this.metrics.errors += 1;
                
                // Gestisci l'errore con l'error manager
                this.errorManager.handleError('batch_processing', result.error);
            }
        } catch (error) {
            console.error(`Errore durante l'elaborazione delle transazioni in sospeso per il batch ${batchId}:`, error);
            this.errorManager.handleError('batch_processing', error);
            this.metrics.errors += 1;
        } finally {
            this.processingBatches.delete(batchId);
        }
    }

    /**
     * Ottiene le transazioni in sospeso
     * @returns {Promise<Array>} Le transazioni in sospeso
     */
    async getPendingTransactions() {
        try {
            // Utilizziamo parametri preparati per evitare SQL injection
            const query = `
                SELECT * FROM transactions 
                WHERE status = ? 
                ORDER BY created_at ASC 
                LIMIT ?
            `;
            const params = [0, this.config.batchSize]; // 0 = in sospeso
            
            const transactions = await this.db.all(query, params);
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
            // Crea l'albero di Merkle
            const leaves = transactions.map(tx => {
                const data = Buffer.concat([
                    Buffer.from(tx.sender, 'hex'),
                    Buffer.from(tx.recipient, 'hex'),
                    Buffer.from(tx.amount.toString(16).padStart(16, '0'), 'hex'),
                    Buffer.from(tx.nonce.toString(16).padStart(8, '0'), 'hex'),
                    Buffer.from(tx.expiry_timestamp.toString(16).padStart(16, '0'), 'hex'),
                    Buffer.from([tx.transaction_type]),
                    tx.data ? Buffer.from(tx.data) : Buffer.from([]),
                ]);
                return crypto.createHash('sha256').update(data).digest();
            });
            
            const merkleTree = new MerkleTree(leaves);
            const merkleRoot = merkleTree.getRoot().toString('hex');
            
            // Inserisci il batch nel database
            const query = `
                INSERT INTO batches (
                    merkle_root, 
                    transaction_count, 
                    status, 
                    created_at
                ) VALUES (?, ?, ?, ?)
            `;
            const params = [
                merkleRoot,
                transactions.length,
                0, // 0 = in sospeso
                Date.now()
            ];
            
            const result = await this.db.run(query, params);
            const batchId = result.lastID;
            
            // Aggiorna le transazioni con il batch_id
            await this.updateTransactionsBatchId(transactions, batchId);
            
            return {
                id: batchId,
                merkleRoot,
                transactions,
                merkleTree,
            };
        } catch (error) {
            console.error('Errore durante la creazione del batch:', error);
            this.errorManager.handleError('batch_creation', error);
            throw error;
        }
    }

    /**
     * Aggiorna il batch_id delle transazioni
     * @param {Array} transactions - Le transazioni da aggiornare
     * @param {number} batchId - L'ID del batch
     */
    async updateTransactionsBatchId(transactions, batchId) {
        try {
            // Utilizziamo una transazione per garantire l'atomicità
            await this.db.run('BEGIN TRANSACTION');
            
            const query = `
                UPDATE transactions 
                SET batch_id = ? 
                WHERE id = ?
            `;
            
            for (const tx of transactions) {
                await this.db.run(query, [batchId, tx.id]);
            }
            
            await this.db.run('COMMIT');
        } catch (error) {
            await this.db.run('ROLLBACK');
            console.error('Errore durante l\'aggiornamento del batch_id delle transazioni:', error);
            this.errorManager.handleError('database', error);
            throw error;
        }
    }

    /**
     * Aggiorna lo stato delle transazioni
     * @param {number} batchId - L'ID del batch
     * @param {number} status - Il nuovo stato
     * @param {string} error - L'eventuale errore
     */
    async updateTransactionsStatus(batchId, status, error = null) {
        try {
            // Utilizziamo parametri preparati per evitare SQL injection
            const query = `
                UPDATE transactions 
                SET status = ?, 
                    processed_at = ?, 
                    error = ? 
                WHERE batch_id = ?
            `;
            const params = [status, Date.now(), error, batchId];
            
            await this.db.run(query, params);
        } catch (error) {
            console.error('Errore durante l\'aggiornamento dello stato delle transazioni:', error);
            this.errorManager.handleError('database', error);
            throw error;
        }
    }

    /**
     * Ottiene il prossimo indice del worker
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
     * Aggiunge una transazione
     * @param {Object} transaction - La transazione da aggiungere
     * @returns {Promise<Object>} Il risultato dell'operazione
     */
    async addTransaction(transaction) {
        try {
            // Valida la transazione
            this.validateTransaction(transaction);
            
            // Verifica se la transazione è già nella cache
            const txHash = this.hashTransaction(transaction);
            if (this.transactionCache.has(txHash)) {
                return { success: false, error: 'Transazione duplicata' };
            }
            
            // Sanitizza gli input per prevenire SQL injection
            const sanitizedTransaction = this.sanitizeTransaction(transaction);
            
            // Inserisci la transazione nel database
            const query = `
                INSERT INTO transactions (
                    sender, 
                    recipient, 
                    amount, 
                    nonce, 
                    expiry_timestamp, 
                    transaction_type, 
                    data, 
                    signature, 
                    status, 
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const params = [
                sanitizedTransaction.sender,
                sanitizedTransaction.recipient,
                sanitizedTransaction.amount,
                sanitizedTransaction.nonce,
                sanitizedTransaction.expiry_timestamp,
                sanitizedTransaction.transaction_type,
                sanitizedTransaction.data,
                sanitizedTransaction.signature,
                0, // 0 = in sospeso
                Date.now()
            ];
            
            const result = await this.db.run(query, params);
            const transactionId = result.lastID;
            
            // Aggiungi la transazione alla cache
            this.transactionCache.set(txHash, true);
            
            // Limita la dimensione della cache
            if (this.transactionCache.size > this.MAX_CACHE_SIZE) {
                const oldestKey = this.transactionCache.keys().next().value;
                this.transactionCache.delete(oldestKey);
            }
            
            return { success: true, id: transactionId };
        } catch (error) {
            console.error('Errore durante l\'aggiunta della transazione:', error);
            this.errorManager.handleError('transaction_addition', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Valida una transazione
     * @param {Object} transaction - La transazione da validare
     * @throws {Error} Se la transazione non è valida
     */
    validateTransaction(transaction) {
        // Verifica che tutti i campi obbligatori siano presenti
        if (!transaction.sender) throw new Error('Mittente mancante');
        if (!transaction.recipient) throw new Error('Destinatario mancante');
        if (transaction.amount === undefined) throw new Error('Importo mancante');
        if (transaction.nonce === undefined) throw new Error('Nonce mancante');
        if (transaction.expiry_timestamp === undefined) throw new Error('Timestamp di scadenza mancante');
        if (transaction.transaction_type === undefined) throw new Error('Tipo di transazione mancante');
        
        // Verifica che i campi abbiano il tipo corretto
        if (typeof transaction.sender !== 'string') throw new Error('Il mittente deve essere una stringa');
        if (typeof transaction.recipient !== 'string') throw new Error('Il destinatario deve essere una stringa');
        if (typeof transaction.amount !== 'number' && !(transaction.amount instanceof BN)) throw new Error('L\'importo deve essere un numero o un BN');
        if (typeof transaction.nonce !== 'number') throw new Error('Il nonce deve essere un numero');
        if (typeof transaction.expiry_timestamp !== 'number') throw new Error('Il timestamp di scadenza deve essere un numero');
        if (typeof transaction.transaction_type !== 'number') throw new Error('Il tipo di transazione deve essere un numero');
        
        // Verifica che i valori siano validi
        if (transaction.amount <= 0) throw new Error('L\'importo deve essere positivo');
        if (transaction.nonce < 0) throw new Error('Il nonce deve essere non negativo');
        if (transaction.expiry_timestamp <= Date.now()) throw new Error('Il timestamp di scadenza deve essere nel futuro');
        if (transaction.transaction_type < 0 || transaction.transaction_type > 2) throw new Error('Tipo di transazione non valido');
        
        // Verifica che il mittente e il destinatario siano diversi
        if (transaction.sender === transaction.recipient) throw new Error('Il mittente e il destinatario non possono essere uguali');
        
        // Verifica la firma se presente
        if (transaction.signature) {
            // Implementazione semplificata, in un'implementazione reale
            // verificheremmo la firma crittografica
            if (typeof transaction.signature !== 'string' && !Buffer.isBuffer(transaction.signature)) {
                throw new Error('La firma deve essere una stringa o un Buffer');
            }
        }
    }

    /**
     * Sanitizza una transazione per prevenire SQL injection
     * @param {Object} transaction - La transazione da sanitizzare
     * @returns {Object} La transazione sanitizzata
     */
    sanitizeTransaction(transaction) {
        // Crea una copia della transazione
        const sanitized = { ...transaction };
        
        // Sanitizza le stringhe
        if (typeof sanitized.sender === 'string') {
            sanitized.sender = this.sanitizeString(sanitized.sender);
        }
        
        if (typeof sanitized.recipient === 'string') {
            sanitized.recipient = this.sanitizeString(sanitized.recipient);
        }
        
        // Converti i numeri in valori sicuri
        if (sanitized.amount !== undefined) {
            sanitized.amount = Number(sanitized.amount);
            if (isNaN(sanitized.amount)) {
                throw new Error('Importo non valido');
            }
        }
        
        if (sanitized.nonce !== undefined) {
            sanitized.nonce = Number(sanitized.nonce);
            if (isNaN(sanitized.nonce)) {
                throw new Error('Nonce non valido');
            }
        }
        
        if (sanitized.expiry_timestamp !== undefined) {
            sanitized.expiry_timestamp = Number(sanitized.expiry_timestamp);
            if (isNaN(sanitized.expiry_timestamp)) {
                throw new Error('Timestamp di scadenza non valido');
            }
        }
        
        if (sanitized.transaction_type !== undefined) {
            sanitized.transaction_type = Number(sanitized.transaction_type);
            if (isNaN(sanitized.transaction_type)) {
                throw new Error('Tipo di transazione non valido');
            }
        }
        
        // Sanitizza i dati binari
        if (sanitized.data !== undefined && !Buffer.isBuffer(sanitized.data)) {
            if (typeof sanitized.data === 'string') {
                sanitized.data = Buffer.from(sanitized.data);
            } else {
                throw new Error('I dati devono essere un Buffer o una stringa');
            }
        }
        
        if (sanitized.signature !== undefined && !Buffer.isBuffer(sanitized.signature)) {
            if (typeof sanitized.signature === 'string') {
                sanitized.signature = Buffer.from(sanitized.signature);
            } else {
                throw new Error('La firma deve essere un Buffer o una stringa');
            }
        }
        
        return sanitized;
    }

    /**
     * Sanitizza una stringa per prevenire SQL injection
     * @param {string} str - La stringa da sanitizzare
     * @returns {string} La stringa sanitizzata
     */
    sanitizeString(str) {
        // Rimuovi caratteri potenzialmente pericolosi
        return str.replace(/[^\w\s.-]/gi, '');
    }

    /**
     * Calcola l'hash di una transazione
     * @param {Object} transaction - La transazione
     * @returns {string} L'hash della transazione
     */
    hashTransaction(transaction) {
        const data = Buffer.concat([
            Buffer.from(transaction.sender),
            Buffer.from(transaction.recipient),
            Buffer.from(transaction.amount.toString()),
            Buffer.from(transaction.nonce.toString()),
            Buffer.from(transaction.expiry_timestamp.toString()),
            Buffer.from([transaction.transaction_type]),
            transaction.data ? Buffer.from(transaction.data) : Buffer.from([]),
        ]);
        
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    /**
     * Ottiene lo stato di una transazione
     * @param {string} transactionId - L'ID della transazione
     * @returns {Promise<Object>} Lo stato della transazione
     */
    async getTransactionStatus(transactionId) {
        try {
            // Sanitizza l'input
            const sanitizedId = Number(transactionId);
            if (isNaN(sanitizedId)) {
                throw new Error('ID transazione non valido');
            }
            
            // Utilizziamo parametri preparati per evitare SQL injection
            const query = `
                SELECT t.*, b.signature as batch_signature, b.status as batch_status 
                FROM transactions t 
                LEFT JOIN batches b ON t.batch_id = b.id 
                WHERE t.id = ?
            `;
            const params = [sanitizedId];
            
            const transaction = await this.db.get(query, params);
            
            if (!transaction) {
                return { success: false, error: 'Transazione non trovata' };
            }
            
            // Mappa lo stato numerico a una stringa
            const statusMap = {
                0: 'in sospeso',
                1: 'elaborata',
                2: 'errore',
            };
            
            const batchStatusMap = {
                0: 'in sospeso',
                1: 'inviato',
                2: 'confermato',
                3: 'errore',
            };
            
            return {
                success: true,
                transaction: {
                    id: transaction.id,
                    sender: transaction.sender,
                    recipient: transaction.recipient,
                    amount: transaction.amount,
                    nonce: transaction.nonce,
                    expiry_timestamp: transaction.expiry_timestamp,
                    transaction_type: transaction.transaction_type,
                    status: statusMap[transaction.status] || 'sconosciuto',
                    created_at: transaction.created_at,
                    processed_at: transaction.processed_at,
                    batch_id: transaction.batch_id,
                    batch_status: transaction.batch_status !== null ? batchStatusMap[transaction.batch_status] : null,
                    batch_signature: transaction.batch_signature,
                    error: transaction.error,
                },
            };
        } catch (error) {
            console.error('Errore durante il recupero dello stato della transazione:', error);
            this.errorManager.handleError('transaction_status', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Ottiene lo stato di un batch
     * @param {string} batchId - L'ID del batch
     * @returns {Promise<Object>} Lo stato del batch
     */
    async getBatchStatus(batchId) {
        try {
            // Sanitizza l'input
            const sanitizedId = Number(batchId);
            if (isNaN(sanitizedId)) {
                throw new Error('ID batch non valido');
            }
            
            // Utilizziamo parametri preparati per evitare SQL injection
            const query = `
                SELECT * FROM batches 
                WHERE id = ?
            `;
            const params = [sanitizedId];
            
            const batch = await this.db.get(query, params);
            
            if (!batch) {
                return { success: false, error: 'Batch non trovato' };
            }
            
            // Recupera le transazioni del batch
            const transactionsQuery = `
                SELECT * FROM transactions 
                WHERE batch_id = ?
            `;
            const transactions = await this.db.all(transactionsQuery, params);
            
            // Mappa lo stato numerico a una stringa
            const statusMap = {
                0: 'in sospeso',
                1: 'inviato',
                2: 'confermato',
                3: 'errore',
            };
            
            return {
                success: true,
                batch: {
                    id: batch.id,
                    merkle_root: batch.merkle_root,
                    transaction_count: batch.transaction_count,
                    status: statusMap[batch.status] || 'sconosciuto',
                    created_at: batch.created_at,
                    submitted_at: batch.submitted_at,
                    confirmed_at: batch.confirmed_at,
                    signature: batch.signature,
                    error: batch.error,
                    transactions: transactions.map(tx => ({
                        id: tx.id,
                        sender: tx.sender,
                        recipient: tx.recipient,
                        amount: tx.amount,
                        nonce: tx.nonce,
                        status: tx.status,
                    })),
                },
            };
        } catch (error) {
            console.error('Errore durante il recupero dello stato del batch:', error);
            this.errorManager.handleError('batch_status', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Ottiene il saldo di un account
     * @param {string} address - L'indirizzo dell'account
     * @returns {Promise<Object>} Il saldo dell'account
     */
    async getAccountBalance(address) {
        try {
            // Sanitizza l'input
            const sanitizedAddress = this.sanitizeString(address);
            
            // Utilizziamo parametri preparati per evitare SQL injection
            const query = `
                SELECT * FROM accounts 
                WHERE address = ?
            `;
            const params = [sanitizedAddress];
            
            const account = await this.db.get(query, params);
            
            if (!account) {
                return { success: true, balance: 0, nonce: 0 };
            }
            
            return {
                success: true,
                balance: account.balance,
                nonce: account.nonce,
                last_updated: account.last_updated,
            };
        } catch (error) {
            console.error('Errore durante il recupero del saldo dell\'account:', error);
            this.errorManager.handleError('account_balance', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Ottiene le statistiche del sequencer
     * @returns {Promise<Object>} Le statistiche del sequencer
     */
    async getStats() {
        try {
            // Recupera le statistiche dal database
            const pendingTransactions = await this.db.get('SELECT COUNT(*) as count FROM transactions WHERE status = 0');
            const processedTransactions = await this.db.get('SELECT COUNT(*) as count FROM transactions WHERE status = 1');
            const errorTransactions = await this.db.get('SELECT COUNT(*) as count FROM transactions WHERE status = 2');
            
            const pendingBatches = await this.db.get('SELECT COUNT(*) as count FROM batches WHERE status = 0');
            const submittedBatches = await this.db.get('SELECT COUNT(*) as count FROM batches WHERE status = 1');
            const confirmedBatches = await this.db.get('SELECT COUNT(*) as count FROM batches WHERE status = 2');
            const errorBatches = await this.db.get('SELECT COUNT(*) as count FROM batches WHERE status = 3');
            
            // Calcola le statistiche aggiuntive
            const totalTransactions = pendingTransactions.count + processedTransactions.count + errorTransactions.count;
            const successRate = totalTransactions > 0 ? (processedTransactions.count / totalTransactions) * 100 : 0;
            
            const totalBatches = pendingBatches.count + submittedBatches.count + confirmedBatches.count + errorBatches.count;
            const batchSuccessRate = totalBatches > 0 ? (confirmedBatches.count / totalBatches) * 100 : 0;
            
            return {
                success: true,
                stats: {
                    transactions: {
                        pending: pendingTransactions.count,
                        processed: processedTransactions.count,
                        error: errorTransactions.count,
                        total: totalTransactions,
                        success_rate: successRate,
                    },
                    batches: {
                        pending: pendingBatches.count,
                        submitted: submittedBatches.count,
                        confirmed: confirmedBatches.count,
                        error: errorBatches.count,
                        total: totalBatches,
                        success_rate: batchSuccessRate,
                    },
                    system: {
                        uptime: process.uptime(),
                        memory_usage: process.memoryUsage(),
                        circuit_breaker_status: this.errorManager.isCircuitBreakerOpen() ? 'open' : 'closed',
                        worker_count: this.workers.length,
                        concurrent_batches: this.processingBatches.size,
                    },
                    metrics: this.metrics,
                },
            };
        } catch (error) {
            console.error('Errore durante il recupero delle statistiche:', error);
            this.errorManager.handleError('stats', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = Sequencer;
