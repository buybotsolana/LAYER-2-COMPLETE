/**
 * Sistema di State Manager per il Layer-2 su Solana
 * 
 * Questo modulo implementa un gestore dello stato del sistema che fornisce
 * un'interfaccia unificata per accedere e modificare lo stato del sistema,
 * mantenendo la coerenza tra i vari componenti.
 */

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');

/**
 * Classe StateManager
 * 
 * Implementa un gestore dello stato del sistema con supporto per transazioni,
 * account, sequencer e bridge.
 */
class StateManager extends EventEmitter {
    /**
     * Costruttore
     * @param {Object} config - Configurazione del gestore dello stato
     * @param {string} [config.stateDir] - Directory per lo stato persistente
     * @param {boolean} [config.persistState=true] - Se persistere lo stato
     * @param {number} [config.syncInterval=30000] - Intervallo di sincronizzazione in ms
     * @param {Function} [config.logger] - Funzione di logging
     */
    constructor(config = {}) {
        super();
        
        this.config = {
            stateDir: config.stateDir || path.join(process.cwd(), 'state'),
            persistState: config.persistState !== undefined ? config.persistState : true,
            syncInterval: config.syncInterval || 30000, // 30 secondi
            ...config
        };
        
        // Stato del sistema
        this.state = {
            transactions: {},
            accounts: {},
            sequencers: {},
            bridges: {},
            recoveries: [],
            lastUpdated: null
        };
        
        // Stato del gestore
        this.isInitialized = false;
        this.isSyncing = false;
        this.syncInterval = null;
        this.lastSyncTime = null;
        
        // Logger
        this.logger = this.config.logger || console;
    }

    /**
     * Inizializza il gestore dello stato
     * @returns {Promise<boolean>} - True se l'inizializzazione è riuscita
     */
    async initialize() {
        try {
            this.logger.info('Inizializzazione del gestore dello stato...');
            
            // Crea la directory dello stato se non esiste
            if (this.config.persistState) {
                await fs.mkdir(this.config.stateDir, { recursive: true });
            }
            
            // Carica lo stato se esiste
            await this._loadState();
            
            // Avvia la sincronizzazione periodica
            if (this.config.persistState) {
                this.startSync();
            }
            
            this.isInitialized = true;
            this.emit('initialized');
            
            this.logger.info('Gestore dello stato inizializzato con successo');
            return true;
        } catch (error) {
            this.logger.error(`Errore durante l'inizializzazione del gestore dello stato: ${error.message}`);
            throw error;
        }
    }

    /**
     * Carica lo stato dal disco
     * @returns {Promise<boolean>} - True se il caricamento è riuscito
     * @private
     */
    async _loadState() {
        if (!this.config.persistState) {
            return false;
        }
        
        try {
            const stateFile = path.join(this.config.stateDir, 'state.json');
            
            // Verifica se il file esiste
            try {
                await fs.access(stateFile);
            } catch (error) {
                this.logger.info('File di stato non trovato, inizializzazione con stato vuoto');
                return false;
            }
            
            // Leggi il file
            const stateData = await fs.readFile(stateFile, 'utf8');
            
            // Parsa il JSON
            const loadedState = JSON.parse(stateData);
            
            // Aggiorna lo stato
            this.state = loadedState;
            
            this.logger.info('Stato caricato con successo');
            return true;
        } catch (error) {
            this.logger.error(`Errore durante il caricamento dello stato: ${error.message}`);
            return false;
        }
    }

    /**
     * Salva lo stato su disco
     * @returns {Promise<boolean>} - True se il salvataggio è riuscito
     * @private
     */
    async _saveState() {
        if (!this.config.persistState) {
            return false;
        }
        
        try {
            const stateFile = path.join(this.config.stateDir, 'state.json');
            
            // Aggiorna il timestamp
            this.state.lastUpdated = new Date().toISOString();
            
            // Serializza lo stato
            const stateData = JSON.stringify(this.state, null, 2);
            
            // Scrivi il file
            await fs.writeFile(stateFile, stateData, 'utf8');
            
            this.logger.debug('Stato salvato con successo');
            return true;
        } catch (error) {
            this.logger.error(`Errore durante il salvataggio dello stato: ${error.message}`);
            return false;
        }
    }

    /**
     * Avvia la sincronizzazione periodica
     */
    startSync() {
        if (this.isSyncing) {
            this.logger.warn('La sincronizzazione è già attiva');
            return;
        }
        
        this.logger.info(`Avvio della sincronizzazione periodica (intervallo: ${this.config.syncInterval}ms)`);
        
        this.syncInterval = setInterval(() => {
            this._saveState().catch(error => {
                this.logger.error(`Errore durante la sincronizzazione: ${error.message}`);
            });
            
            this.lastSyncTime = Date.now();
        }, this.config.syncInterval);
        
        this.isSyncing = true;
        this.emit('syncing_started');
    }

    /**
     * Ferma la sincronizzazione periodica
     */
    stopSync() {
        if (!this.isSyncing) {
            return;
        }
        
        this.logger.info('Arresto della sincronizzazione periodica');
        
        clearInterval(this.syncInterval);
        this.syncInterval = null;
        this.isSyncing = false;
        this.emit('syncing_stopped');
    }

    /**
     * Ottiene lo stato attuale del sistema
     * @returns {Promise<Object>} - Stato attuale del sistema
     */
    async getCurrentState() {
        return { ...this.state };
    }

    /**
     * Ottiene le transazioni recenti
     * @param {number} [limit=100] - Numero massimo di transazioni da restituire
     * @returns {Promise<Array>} - Lista di transazioni recenti
     */
    async getRecentTransactions(limit = 100) {
        const transactions = Object.values(this.state.transactions);
        
        // Ordina per timestamp decrescente
        transactions.sort((a, b) => {
            return new Date(b.timestamp) - new Date(a.timestamp);
        });
        
        return transactions.slice(0, limit);
    }

    /**
     * Ottiene lo stato di una transazione su Layer-1
     * @param {string} transactionId - ID della transazione
     * @returns {Promise<string>} - Stato della transazione
     */
    async getLayer1TransactionStatus(transactionId) {
        const transaction = this.state.transactions[transactionId];
        
        if (!transaction) {
            return 'unknown';
        }
        
        return transaction.layer1Status || 'unknown';
    }

    /**
     * Ottiene lo stato di una transazione su Layer-2
     * @param {string} transactionId - ID della transazione
     * @returns {Promise<string>} - Stato della transazione
     */
    async getLayer2TransactionStatus(transactionId) {
        const transaction = this.state.transactions[transactionId];
        
        if (!transaction) {
            return 'unknown';
        }
        
        return transaction.layer2Status || 'unknown';
    }

    /**
     * Aggiorna lo stato di una transazione su Layer-2
     * @param {string} transactionId - ID della transazione
     * @param {string} status - Nuovo stato
     * @returns {Promise<boolean>} - True se l'aggiornamento è riuscito
     */
    async updateLayer2TransactionStatus(transactionId, status) {
        const transaction = this.state.transactions[transactionId];
        
        if (!transaction) {
            return false;
        }
        
        transaction.layer2Status = status;
        transaction.lastUpdated = new Date().toISOString();
        
        this.emit('transaction_updated', {
            id: transactionId,
            status,
            timestamp: new Date().toISOString()
        });
        
        return true;
    }

    /**
     * Marca una transazione per il riprocessamento
     * @param {string} transactionId - ID della transazione
     * @returns {Promise<boolean>} - True se l'operazione è riuscita
     */
    async markTransactionForReprocessing(transactionId) {
        const transaction = this.state.transactions[transactionId];
        
        if (!transaction) {
            return false;
        }
        
        transaction.needsReprocessing = true;
        transaction.lastUpdated = new Date().toISOString();
        
        this.emit('transaction_marked_for_reprocessing', {
            id: transactionId,
            timestamp: new Date().toISOString()
        });
        
        return true;
    }

    /**
     * Ottiene gli account attivi
     * @param {number} [limit=100] - Numero massimo di account da restituire
     * @returns {Promise<Array>} - Lista di account attivi
     */
    async getActiveAccounts(limit = 100) {
        const accounts = Object.values(this.state.accounts);
        
        // Filtra gli account attivi
        const activeAccounts = accounts.filter(account => account.active);
        
        // Ordina per ultimo aggiornamento
        activeAccounts.sort((a, b) => {
            return new Date(b.lastUpdated) - new Date(a.lastUpdated);
        });
        
        return activeAccounts.slice(0, limit);
    }

    /**
     * Calcola il saldo di un account in base alle transazioni confermate
     * @param {string} address - Indirizzo dell'account
     * @returns {Promise<number>} - Saldo calcolato
     */
    async calculateAccountBalance(address) {
        // Implementazione di esempio: in un sistema reale, questo calcolo
        // sarebbe molto più complesso e coinvolgerebbe l'analisi di tutte
        // le transazioni confermate che coinvolgono l'account
        
        const account = this.state.accounts[address];
        
        if (!account) {
            return 0;
        }
        
        // Ottieni tutte le transazioni confermate che coinvolgono l'account
        const transactions = Object.values(this.state.transactions).filter(tx => {
            return (tx.sender === address || tx.recipient === address) &&
                   tx.layer1Status === 'confirmed' &&
                   tx.layer2Status === 'confirmed';
        });
        
        // Calcola il saldo
        let balance = 0;
        
        for (const tx of transactions) {
            if (tx.sender === address) {
                balance -= tx.amount;
            }
            
            if (tx.recipient === address) {
                balance += tx.amount;
            }
        }
        
        return balance;
    }

    /**
     * Aggiorna il saldo di un account
     * @param {string} address - Indirizzo dell'account
     * @param {number} balance - Nuovo saldo
     * @returns {Promise<boolean>} - True se l'aggiornamento è riuscito
     */
    async updateAccountBalance(address, balance) {
        const account = this.state.accounts[address];
        
        if (!account) {
            return false;
        }
        
        account.balance = balance;
        account.lastUpdated = new Date().toISOString();
        
        this.emit('account_balance_updated', {
            address,
            balance,
            timestamp: new Date().toISOString()
        });
        
        return true;
    }

    /**
     * Calcola il nonce di un account in base alle transazioni confermate
     * @param {string} address - Indirizzo dell'account
     * @returns {Promise<number>} - Nonce calcolato
     */
    async calculateAccountNonce(address) {
        // Implementazione di esempio: in un sistema reale, questo calcolo
        // sarebbe basato sul numero di transazioni confermate inviate dall'account
        
        const account = this.state.accounts[address];
        
        if (!account) {
            return 0;
        }
        
        // Ottieni tutte le transazioni confermate inviate dall'account
        const transactions = Object.values(this.state.transactions).filter(tx => {
            return tx.sender === address &&
                   tx.layer1Status === 'confirmed' &&
                   tx.layer2Status === 'confirmed';
        });
        
        return transactions.length;
    }

    /**
     * Aggiorna il nonce di un account
     * @param {string} address - Indirizzo dell'account
     * @param {number} nonce - Nuovo nonce
     * @returns {Promise<boolean>} - True se l'aggiornamento è riuscito
     */
    async updateAccountNonce(address, nonce) {
        const account = this.state.accounts[address];
        
        if (!account) {
            return false;
        }
        
        account.nonce = nonce;
        account.lastUpdated = new Date().toISOString();
        
        this.emit('account_nonce_updated', {
            address,
            nonce,
            timestamp: new Date().toISOString()
        });
        
        return true;
    }

    /**
     * Ottiene i sequencer
     * @returns {Promise<Array>} - Lista di sequencer
     */
    async getSequencers() {
        return Object.values(this.state.sequencers);
    }

    /**
     * Verifica se un sequencer è attivo
     * @param {string} sequencerId - ID del sequencer
     * @returns {Promise<boolean>} - True se il sequencer è attivo
     */
    async isSequencerActive(sequencerId) {
        const sequencer = this.state.sequencers[sequencerId];
        
        if (!sequencer) {
            return false;
        }
        
        // Implementazione di esempio: in un sistema reale, questo controllo
        // coinvolgerebbe la verifica dello stato del sequencer tramite heartbeat
        // o altri meccanismi di monitoraggio
        
        // Verifica se l'ultimo heartbeat è recente (ultimi 5 minuti)
        if (!sequencer.lastHeartbeat) {
            return false;
        }
        
        const lastHeartbeat = new Date(sequencer.lastHeartbeat);
        const now = new Date();
        
        return (now - lastHeartbeat) < 5 * 60 * 1000; // 5 minuti
    }

    /**
     * Aggiorna lo stato di un sequencer
     * @param {string} sequencerId - ID del sequencer
     * @param {string} status - Nuovo stato
     * @returns {Promise<boolean>} - True se l'aggiornamento è riuscito
     */
    async updateSequencerStatus(sequencerId, status) {
        const sequencer = this.state.sequencers[sequencerId];
        
        if (!sequencer) {
            return false;
        }
        
        sequencer.status = status;
        sequencer.lastUpdated = new Date().toISOString();
        
        this.emit('sequencer_status_updated', {
            id: sequencerId,
            status,
            timestamp: new Date().toISOString()
        });
        
        return true;
    }

    /**
     * Ottiene i bridge
     * @returns {Promise<Array>} - Lista di bridge
     */
    async getBridges() {
        return Object.values(this.state.bridges);
    }

    /**
     * Verifica se un bridge è operativo
     * @param {string} bridgeId - ID del bridge
     * @returns {Promise<boolean>} - True se il bridge è operativo
     */
    async isBridgeOperational(bridgeId) {
        const bridge = this.state.bridges[bridgeId];
        
        if (!bridge) {
            return false;
        }
        
        // Implementazione di esempio: in un sistema reale, questo controllo
        // coinvolgerebbe la verifica dello stato del bridge tramite chiamate
        // ai contratti o altri meccanismi di monitoraggio
        
        // Verifica se l'ultimo controllo è recente (ultimi 10 minuti)
        if (!bridge.lastCheck) {
            return false;
        }
        
        const lastCheck = new Date(bridge.lastCheck);
        const now = new Date();
        
        if ((now - lastCheck) > 10 * 60 * 1000) { // 10 minuti
            return false;
        }
        
        return bridge.operational;
    }

    /**
     * Aggiorna lo stato di un bridge
     * @param {string} bridgeId - ID del bridge
     * @param {string} status - Nuovo stato
     * @returns {Promise<boolean>} - True se l'aggiornamento è riuscito
     */
    async updateBridgeStatus(bridgeId, status) {
        const bridge = this.state.bridges[bridgeId];
        
        if (!bridge) {
            return false;
        }
        
        bridge.status = status;
        bridge.lastUpdated = new Date().toISOString();
        
        this.emit('bridge_status_updated', {
            id: bridgeId,
            status,
            timestamp: new Date().toISOString()
        });
        
        return true;
    }

    /**
     * Registra un recovery
     * @param {Object} recovery - Informazioni sul recovery
     * @returns {Promise<boolean>} - True se la registrazione è riuscita
     */
    async recordRecovery(recovery) {
        this.state.recoveries.push({
            ...recovery,
            recordedAt: new Date().toISOString()
        });
        
        // Limita la dimensione del registro
        if (this.state.recoveries.length > 1000) {
            this.state.recoveries = this.state.recoveries.slice(-1000);
        }
        
        this.emit('recovery_recorded', {
            recovery,
            timestamp: new Date().toISOString()
        });
        
        return true;
    }

    /**
     * Ottiene la storia dei recovery
     * @param {number} [limit] - Numero massimo di recovery da restituire
     * @returns {Promise<Array>} - Storia dei recovery
     */
    async getRecoveryHistory(limit) {
        if (limit) {
            return this.state.recoveries.slice(-limit);
        }
        
        return [...this.state.recoveries];
    }
}

module.exports = { StateManager };
