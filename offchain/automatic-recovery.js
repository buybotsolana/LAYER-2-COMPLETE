/**
 * Sistema di Recovery Automatico per il Layer-2 su Solana
 * 
 * Questo modulo implementa un sistema di recovery automatico che rileva
 * inconsistenze nello stato del sistema e applica strategie di recovery
 * appropriate per ripristinare la coerenza.
 */

const { EventEmitter } = require('events');
const { StateManager } = require('./state-manager');
const { AlertManager } = require('./alert-manager');

/**
 * Classe AutomaticRecovery
 * 
 * Implementa un sistema di recovery automatico per rilevare e risolvere
 * inconsistenze nello stato del sistema.
 */
class AutomaticRecovery extends EventEmitter {
    /**
     * Costruttore
     * @param {Object} config - Configurazione del sistema di recovery
     * @param {number} [config.checkInterval=60000] - Intervallo di controllo in ms
     * @param {Object} [config.recoveryStrategies={}] - Strategie di recovery
     * @param {boolean} [config.autoRecover=true] - Se eseguire il recovery automatico
     * @param {number} [config.maxRecoveryAttempts=3] - Numero massimo di tentativi di recovery
     * @param {Function} [config.logger] - Funzione di logging
     */
    constructor(config = {}) {
        super();
        
        this.config = {
            checkInterval: config.checkInterval || 60000, // 60 secondi
            recoveryStrategies: config.recoveryStrategies || {},
            autoRecover: config.autoRecover !== undefined ? config.autoRecover : true,
            maxRecoveryAttempts: config.maxRecoveryAttempts || 3,
            ...config
        };
        
        // Inizializza il gestore dello stato
        this.stateManager = new StateManager(config.stateManager || {});
        
        // Inizializza il gestore degli alert
        this.alertManager = new AlertManager(config.alertManager || {});
        
        // Stato del sistema
        this.isInitialized = false;
        this.isChecking = false;
        this.checkInterval = null;
        this.lastCheckTime = null;
        this.recoveryAttempts = {};
        
        // Logger
        this.logger = this.config.logger || console;
        
        // Registro delle inconsistenze rilevate
        this.detectedInconsistencies = [];
        
        // Registro dei recovery eseguiti
        this.recoveryHistory = [];
    }

    /**
     * Inizializza il sistema di recovery automatico
     * @returns {Promise<boolean>} - True se l'inizializzazione è riuscita
     */
    async initialize() {
        try {
            this.logger.info('Inizializzazione del sistema di recovery automatico...');
            
            // Inizializza il gestore dello stato
            await this.stateManager.initialize();
            
            // Inizializza il gestore degli alert
            await this.alertManager.initialize();
            
            // Registra le strategie di recovery di default
            this._registerDefaultRecoveryStrategies();
            
            // Avvia il loop di controllo
            if (this.config.autoRecover) {
                this.startCheckLoop();
            }
            
            this.isInitialized = true;
            this.emit('initialized');
            
            this.logger.info('Sistema di recovery automatico inizializzato con successo');
            return true;
        } catch (error) {
            this.logger.error(`Errore durante l'inizializzazione del sistema di recovery automatico: ${error.message}`);
            throw error;
        }
    }

    /**
     * Registra le strategie di recovery di default
     * @private
     */
    _registerDefaultRecoveryStrategies() {
        // Strategia per inconsistenze di transazioni
        this.registerRecoveryStrategy('transaction_inconsistency', {
            description: 'Risolve inconsistenze nelle transazioni',
            apply: async (inconsistency) => {
                this.logger.info(`Applicazione della strategia di recovery per inconsistenza di transazione: ${inconsistency.id}`);
                
                // Ottieni i dettagli della transazione
                const transaction = inconsistency.data;
                
                // Verifica lo stato della transazione su Layer-1
                const layer1Status = await this.stateManager.getLayer1TransactionStatus(transaction.id);
                
                // Verifica lo stato della transazione su Layer-2
                const layer2Status = await this.stateManager.getLayer2TransactionStatus(transaction.id);
                
                if (layer1Status === 'confirmed' && layer2Status !== 'confirmed') {
                    // La transazione è confermata su Layer-1 ma non su Layer-2
                    await this.stateManager.updateLayer2TransactionStatus(transaction.id, 'confirmed');
                    return { success: true, action: 'layer2_status_updated' };
                } else if (layer1Status !== 'confirmed' && layer2Status === 'confirmed') {
                    // La transazione è confermata su Layer-2 ma non su Layer-1
                    // Questo è un caso più complesso che potrebbe richiedere un rollback
                    await this.stateManager.markTransactionForReprocessing(transaction.id);
                    return { success: true, action: 'marked_for_reprocessing' };
                } else if (layer1Status === 'failed' && layer2Status !== 'failed') {
                    // La transazione è fallita su Layer-1 ma non su Layer-2
                    await this.stateManager.updateLayer2TransactionStatus(transaction.id, 'failed');
                    return { success: true, action: 'layer2_status_updated' };
                }
                
                return { success: false, reason: 'Inconsistenza non risolvibile automaticamente' };
            }
        });
        
        // Strategia per inconsistenze di saldo
        this.registerRecoveryStrategy('balance_inconsistency', {
            description: 'Risolve inconsistenze nei saldi degli account',
            apply: async (inconsistency) => {
                this.logger.info(`Applicazione della strategia di recovery per inconsistenza di saldo: ${inconsistency.id}`);
                
                // Ottieni i dettagli dell'account
                const account = inconsistency.data;
                
                // Calcola il saldo corretto in base alle transazioni confermate
                const calculatedBalance = await this.stateManager.calculateAccountBalance(account.address);
                
                // Aggiorna il saldo dell'account
                await this.stateManager.updateAccountBalance(account.address, calculatedBalance);
                
                return { success: true, action: 'balance_recalculated' };
            }
        });
        
        // Strategia per inconsistenze di nonce
        this.registerRecoveryStrategy('nonce_inconsistency', {
            description: 'Risolve inconsistenze nei nonce degli account',
            apply: async (inconsistency) => {
                this.logger.info(`Applicazione della strategia di recovery per inconsistenza di nonce: ${inconsistency.id}`);
                
                // Ottieni i dettagli dell'account
                const account = inconsistency.data;
                
                // Calcola il nonce corretto in base alle transazioni confermate
                const calculatedNonce = await this.stateManager.calculateAccountNonce(account.address);
                
                // Aggiorna il nonce dell'account
                await this.stateManager.updateAccountNonce(account.address, calculatedNonce);
                
                return { success: true, action: 'nonce_recalculated' };
            }
        });
        
        // Strategia per inconsistenze di stato del sequencer
        this.registerRecoveryStrategy('sequencer_state_inconsistency', {
            description: 'Risolve inconsistenze nello stato del sequencer',
            apply: async (inconsistency) => {
                this.logger.info(`Applicazione della strategia di recovery per inconsistenza di stato del sequencer: ${inconsistency.id}`);
                
                // Ottieni i dettagli del sequencer
                const sequencer = inconsistency.data;
                
                // Verifica lo stato del sequencer
                const isActive = await this.stateManager.isSequencerActive(sequencer.id);
                
                if (sequencer.status === 'active' && !isActive) {
                    // Il sequencer è segnato come attivo ma non è attivo
                    await this.stateManager.updateSequencerStatus(sequencer.id, 'inactive');
                    return { success: true, action: 'sequencer_status_updated' };
                } else if (sequencer.status !== 'active' && isActive) {
                    // Il sequencer è segnato come inattivo ma è attivo
                    await this.stateManager.updateSequencerStatus(sequencer.id, 'active');
                    return { success: true, action: 'sequencer_status_updated' };
                }
                
                return { success: false, reason: 'Inconsistenza non risolvibile automaticamente' };
            }
        });
        
        // Strategia per inconsistenze di stato del bridge
        this.registerRecoveryStrategy('bridge_state_inconsistency', {
            description: 'Risolve inconsistenze nello stato del bridge',
            apply: async (inconsistency) => {
                this.logger.info(`Applicazione della strategia di recovery per inconsistenza di stato del bridge: ${inconsistency.id}`);
                
                // Ottieni i dettagli del bridge
                const bridge = inconsistency.data;
                
                // Verifica lo stato del bridge
                const isOperational = await this.stateManager.isBridgeOperational(bridge.id);
                
                if (bridge.status === 'operational' && !isOperational) {
                    // Il bridge è segnato come operativo ma non è operativo
                    await this.stateManager.updateBridgeStatus(bridge.id, 'degraded');
                    return { success: true, action: 'bridge_status_updated' };
                } else if (bridge.status !== 'operational' && isOperational) {
                    // Il bridge è segnato come non operativo ma è operativo
                    await this.stateManager.updateBridgeStatus(bridge.id, 'operational');
                    return { success: true, action: 'bridge_status_updated' };
                }
                
                return { success: false, reason: 'Inconsistenza non risolvibile automaticamente' };
            }
        });
    }

    /**
     * Avvia il loop di controllo
     */
    startCheckLoop() {
        if (this.isChecking) {
            this.logger.warn('Il loop di controllo è già attivo');
            return;
        }
        
        this.logger.info(`Avvio del loop di controllo (intervallo: ${this.config.checkInterval}ms)`);
        
        this.checkInterval = setInterval(() => {
            this.checkAndRecover().catch(error => {
                this.logger.error(`Errore durante il controllo e recovery: ${error.message}`);
            });
        }, this.config.checkInterval);
        
        this.isChecking = true;
        this.emit('checking_started');
    }

    /**
     * Ferma il loop di controllo
     */
    stopCheckLoop() {
        if (!this.isChecking) {
            return;
        }
        
        this.logger.info('Arresto del loop di controllo');
        
        clearInterval(this.checkInterval);
        this.checkInterval = null;
        this.isChecking = false;
        this.emit('checking_stopped');
    }

    /**
     * Controlla lo stato del sistema e applica strategie di recovery
     * @returns {Promise<Object>} - Risultati del controllo e recovery
     */
    async checkAndRecover() {
        if (!this.isInitialized) {
            throw new Error('Il sistema di recovery automatico non è inizializzato');
        }
        
        this.lastCheckTime = Date.now();
        this.logger.debug('Esecuzione del controllo e recovery...');
        
        // Ottieni lo stato attuale
        const currentState = await this.stateManager.getCurrentState();
        
        // Rileva inconsistenze
        const inconsistencies = await this.detectInconsistencies(currentState);
        
        if (inconsistencies.length === 0) {
            this.logger.debug('Nessuna inconsistenza rilevata');
            return { inconsistencies: [], recoveries: [] };
        }
        
        this.logger.info(`Rilevate ${inconsistencies.length} inconsistenze`);
        
        // Registra le inconsistenze rilevate
        this.detectedInconsistencies.push(...inconsistencies.map(inc => ({
            ...inc,
            detectedAt: new Date().toISOString()
        })));
        
        // Limita la dimensione del registro
        if (this.detectedInconsistencies.length > 1000) {
            this.detectedInconsistencies = this.detectedInconsistencies.slice(-1000);
        }
        
        // Applica strategie di recovery per ciascuna inconsistenza
        const recoveryResults = [];
        
        for (const inconsistency of inconsistencies) {
            try {
                const result = await this.applyRecoveryStrategy(inconsistency);
                recoveryResults.push(result);
            } catch (error) {
                this.logger.error(`Errore durante l'applicazione della strategia di recovery per ${inconsistency.type}: ${error.message}`);
                recoveryResults.push({
                    inconsistency,
                    success: false,
                    error: error.message
                });
            }
        }
        
        // Emetti evento con i risultati
        this.emit('check_and_recover_completed', {
            inconsistencies,
            recoveryResults,
            timestamp: new Date().toISOString()
        });
        
        return {
            inconsistencies,
            recoveries: recoveryResults
        };
    }

    /**
     * Rileva inconsistenze nello stato del sistema
     * @param {Object} state - Stato attuale del sistema
     * @returns {Promise<Array>} - Lista di inconsistenze rilevate
     */
    async detectInconsistencies(state) {
        const inconsistencies = [];
        
        // Rileva inconsistenze nelle transazioni
        const transactionInconsistencies = await this._detectTransactionInconsistencies(state);
        inconsistencies.push(...transactionInconsistencies);
        
        // Rileva inconsistenze nei saldi degli account
        const balanceInconsistencies = await this._detectBalanceInconsistencies(state);
        inconsistencies.push(...balanceInconsistencies);
        
        // Rileva inconsistenze nei nonce degli account
        const nonceInconsistencies = await this._detectNonceInconsistencies(state);
        inconsistencies.push(...nonceInconsistencies);
        
        // Rileva inconsistenze nello stato del sequencer
        const sequencerInconsistencies = await this._detectSequencerInconsistencies(state);
        inconsistencies.push(...sequencerInconsistencies);
        
        // Rileva inconsistenze nello stato del bridge
        const bridgeInconsistencies = await this._detectBridgeInconsistencies(state);
        inconsistencies.push(...bridgeInconsistencies);
        
        return inconsistencies;
    }

    /**
     * Rileva inconsistenze nelle transazioni
     * @param {Object} state - Stato attuale del sistema
     * @returns {Promise<Array>} - Lista di inconsistenze rilevate
     * @private
     */
    async _detectTransactionInconsistencies(state) {
        const inconsistencies = [];
        
        try {
            // Ottieni le transazioni recenti
            const recentTransactions = await this.stateManager.getRecentTransactions();
            
            for (const transaction of recentTransactions) {
                // Verifica lo stato della transazione su Layer-1
                const layer1Status = await this.stateManager.getLayer1TransactionStatus(transaction.id);
                
                // Verifica lo stato della transazione su Layer-2
                const layer2Status = await this.stateManager.getLayer2TransactionStatus(transaction.id);
                
                // Rileva inconsistenze
                if (layer1Status !== layer2Status) {
                    inconsistencies.push({
                        id: `tx-${transaction.id}`,
                        type: 'transaction_inconsistency',
                        data: transaction,
                        details: {
                            layer1Status,
                            layer2Status
                        },
                        severity: 'high',
                        timestamp: new Date().toISOString()
                    });
                }
            }
        } catch (error) {
            this.logger.error(`Errore durante il rilevamento di inconsistenze nelle transazioni: ${error.message}`);
        }
        
        return inconsistencies;
    }

    /**
     * Rileva inconsistenze nei saldi degli account
     * @param {Object} state - Stato attuale del sistema
     * @returns {Promise<Array>} - Lista di inconsistenze rilevate
     * @private
     */
    async _detectBalanceInconsistencies(state) {
        const inconsistencies = [];
        
        try {
            // Ottieni gli account attivi
            const activeAccounts = await this.stateManager.getActiveAccounts();
            
            for (const account of activeAccounts) {
                // Calcola il saldo corretto in base alle transazioni confermate
                const calculatedBalance = await this.stateManager.calculateAccountBalance(account.address);
                
                // Verifica se il saldo corrente è diverso dal saldo calcolato
                if (account.balance !== calculatedBalance) {
                    inconsistencies.push({
                        id: `balance-${account.address}`,
                        type: 'balance_inconsistency',
                        data: account,
                        details: {
                            currentBalance: account.balance,
                            calculatedBalance
                        },
                        severity: 'medium',
                        timestamp: new Date().toISOString()
                    });
                }
            }
        } catch (error) {
            this.logger.error(`Errore durante il rilevamento di inconsistenze nei saldi: ${error.message}`);
        }
        
        return inconsistencies;
    }

    /**
     * Rileva inconsistenze nei nonce degli account
     * @param {Object} state - Stato attuale del sistema
     * @returns {Promise<Array>} - Lista di inconsistenze rilevate
     * @private
     */
    async _detectNonceInconsistencies(state) {
        const inconsistencies = [];
        
        try {
            // Ottieni gli account attivi
            const activeAccounts = await this.stateManager.getActiveAccounts();
            
            for (const account of activeAccounts) {
                // Calcola il nonce corretto in base alle transazioni confermate
                const calculatedNonce = await this.stateManager.calculateAccountNonce(account.address);
                
                // Verifica se il nonce corrente è diverso dal nonce calcolato
                if (account.nonce !== calculatedNonce) {
                    inconsistencies.push({
                        id: `nonce-${account.address}`,
                        type: 'nonce_inconsistency',
                        data: account,
                        details: {
                            currentNonce: account.nonce,
                            calculatedNonce
                        },
                        severity: 'medium',
                        timestamp: new Date().toISOString()
                    });
                }
            }
        } catch (error) {
            this.logger.error(`Errore durante il rilevamento di inconsistenze nei nonce: ${error.message}`);
        }
        
        return inconsistencies;
    }

    /**
     * Rileva inconsistenze nello stato del sequencer
     * @param {Object} state - Stato attuale del sistema
     * @returns {Promise<Array>} - Lista di inconsistenze rilevate
     * @private
     */
    async _detectSequencerInconsistencies(state) {
        const inconsistencies = [];
        
        try {
            // Ottieni i sequencer
            const sequencers = await this.stateManager.getSequencers();
            
            for (const sequencer of sequencers) {
                // Verifica lo stato del sequencer
                const isActive = await this.stateManager.isSequencerActive(sequencer.id);
                
                // Rileva inconsistenze
                if ((sequencer.status === 'active' && !isActive) || 
                    (sequencer.status !== 'active' && isActive)) {
                    inconsistencies.push({
                        id: `sequencer-${sequencer.id}`,
                        type: 'sequencer_state_inconsistency',
                        data: sequencer,
                        details: {
                            currentStatus: sequencer.status,
                            actuallyActive: isActive
                        },
                        severity: 'high',
                        timestamp: new Date().toISOString()
                    });
                }
            }
        } catch (error) {
            this.logger.error(`Errore durante il rilevamento di inconsistenze nei sequencer: ${error.message}`);
        }
        
        return inconsistencies;
    }

    /**
     * Rileva inconsistenze nello stato del bridge
     * @param {Object} state - Stato attuale del sistema
     * @returns {Promise<Array>} - Lista di inconsistenze rilevate
     * @private
     */
    async _detectBridgeInconsistencies(state) {
        const inconsistencies = [];
        
        try {
            // Ottieni i bridge
            const bridges = await this.stateManager.getBridges();
            
            for (const bridge of bridges) {
                // Verifica lo stato del bridge
                const isOperational = await this.stateManager.isBridgeOperational(bridge.id);
                
                // Rileva inconsistenze
                if ((bridge.status === 'operational' && !isOperational) || 
                    (bridge.status !== 'operational' && isOperational)) {
                    inconsistencies.push({
                        id: `bridge-${bridge.id}`,
                        type: 'bridge_state_inconsistency',
                        data: bridge,
                        details: {
                            currentStatus: bridge.status,
                            actuallyOperational: isOperational
                        },
                        severity: 'high',
                        timestamp: new Date().toISOString()
                    });
                }
            }
        } catch (error) {
            this.logger.error(`Errore durante il rilevamento di inconsistenze nei bridge: ${error.message}`);
        }
        
        return inconsistencies;
    }

    /**
     * Applica una strategia di recovery per un'inconsistenza
     * @param {Object} inconsistency - Inconsistenza rilevata
     * @returns {Promise<Object>} - Risultato del recovery
     */
    async applyRecoveryStrategy(inconsistency) {
        // Ottieni la strategia appropriata
        const strategy = this.config.recoveryStrategies[inconsistency.type];
        
        if (!strategy) {
            // Nessuna strategia disponibile, invia alert
            await this.alertManager.sendAlert({
                severity: 'high',
                message: `No recovery strategy for inconsistency: ${inconsistency.type}`,
                details: inconsistency
            });
            
            return {
                inconsistency,
                success: false,
                reason: 'No recovery strategy available'
            };
        }
        
        // Verifica se abbiamo già tentato troppi recovery per questa inconsistenza
        const attemptKey = `${inconsistency.type}-${inconsistency.id}`;
        this.recoveryAttempts[attemptKey] = (this.recoveryAttempts[attemptKey] || 0) + 1;
        
        if (this.recoveryAttempts[attemptKey] > this.config.maxRecoveryAttempts) {
            // Troppi tentativi, invia alert
            await this.alertManager.sendAlert({
                severity: 'critical',
                message: `Max recovery attempts exceeded for inconsistency: ${inconsistency.type}`,
                details: {
                    inconsistency,
                    attempts: this.recoveryAttempts[attemptKey]
                }
            });
            
            return {
                inconsistency,
                success: false,
                reason: 'Max recovery attempts exceeded'
            };
        }
        
        try {
            // Applica la strategia di recovery
            this.logger.info(`Applicazione della strategia di recovery per ${inconsistency.type}: ${inconsistency.id}`);
            
            const recoveryResult = await strategy.apply(inconsistency);
            
            // Registra il recovery
            const recoveryRecord = {
                inconsistency,
                result: recoveryResult,
                timestamp: new Date().toISOString(),
                attempt: this.recoveryAttempts[attemptKey]
            };
            
            this.recoveryHistory.push(recoveryRecord);
            
            // Limita la dimensione del registro
            if (this.recoveryHistory.length > 1000) {
                this.recoveryHistory = this.recoveryHistory.slice(-1000);
            }
            
            if (recoveryResult.success) {
                // Recovery riuscito, registra il successo
                await this.stateManager.recordRecovery({
                    type: inconsistency.type,
                    id: inconsistency.id,
                    result: recoveryResult,
                    timestamp: new Date().toISOString()
                });
                
                // Invia notifica di successo
                await this.alertManager.sendNotification({
                    severity: 'info',
                    message: `Successfully recovered from inconsistency: ${inconsistency.type}`,
                    details: {
                        inconsistency,
                        result: recoveryResult
                    }
                });
                
                // Reset del contatore di tentativi
                delete this.recoveryAttempts[attemptKey];
                
                this.emit('recovery_success', {
                    inconsistency,
                    result: recoveryResult,
                    timestamp: new Date().toISOString()
                });
            } else {
                // Recovery fallito, invia alert
                await this.alertManager.sendAlert({
                    severity: 'high',
                    message: `Recovery failed for inconsistency: ${inconsistency.type}`,
                    details: {
                        inconsistency,
                        result: recoveryResult,
                        attempt: this.recoveryAttempts[attemptKey]
                    }
                });
                
                this.emit('recovery_failure', {
                    inconsistency,
                    result: recoveryResult,
                    timestamp: new Date().toISOString(),
                    attempt: this.recoveryAttempts[attemptKey]
                });
            }
            
            return {
                inconsistency,
                success: recoveryResult.success,
                result: recoveryResult,
                attempt: this.recoveryAttempts[attemptKey]
            };
        } catch (error) {
            // Recovery fallito con errore, invia alert
            await this.alertManager.sendAlert({
                severity: 'critical',
                message: `Recovery failed with error for inconsistency: ${inconsistency.type}`,
                details: {
                    inconsistency,
                    error: error.message,
                    attempt: this.recoveryAttempts[attemptKey]
                }
            });
            
            this.emit('recovery_error', {
                inconsistency,
                error: error.message,
                timestamp: new Date().toISOString(),
                attempt: this.recoveryAttempts[attemptKey]
            });
            
            return {
                inconsistency,
                success: false,
                error: error.message,
                attempt: this.recoveryAttempts[attemptKey]
            };
        }
    }

    /**
     * Registra una strategia di recovery
     * @param {string} inconsistencyType - Tipo di inconsistenza
     * @param {Object} strategy - Strategia di recovery
     * @param {string} strategy.description - Descrizione della strategia
     * @param {Function} strategy.apply - Funzione che applica la strategia
     * @returns {Object} - Strategia registrata
     */
    registerRecoveryStrategy(inconsistencyType, strategy) {
        if (!inconsistencyType) {
            throw new Error('Il tipo di inconsistenza è obbligatorio');
        }
        
        if (!strategy || typeof strategy.apply !== 'function') {
            throw new Error('La strategia deve avere una funzione apply');
        }
        
        this.config.recoveryStrategies[inconsistencyType] = strategy;
        
        this.logger.info(`Strategia di recovery registrata per ${inconsistencyType}: ${strategy.description}`);
        
        return strategy;
    }

    /**
     * Ottiene le inconsistenze rilevate
     * @param {number} [limit] - Numero massimo di inconsistenze da restituire
     * @returns {Array} - Inconsistenze rilevate
     */
    getDetectedInconsistencies(limit) {
        if (limit) {
            return this.detectedInconsistencies.slice(-limit);
        }
        
        return [...this.detectedInconsistencies];
    }

    /**
     * Ottiene la storia dei recovery
     * @param {number} [limit] - Numero massimo di recovery da restituire
     * @returns {Array} - Storia dei recovery
     */
    getRecoveryHistory(limit) {
        if (limit) {
            return this.recoveryHistory.slice(-limit);
        }
        
        return [...this.recoveryHistory];
    }

    /**
     * Ottiene lo stato del sistema di recovery
     * @returns {Object} - Stato del sistema
     */
    getStatus() {
        return {
            isInitialized: this.isInitialized,
            isChecking: this.isChecking,
            lastCheckTime: this.lastCheckTime,
            recoveryAttempts: { ...this.recoveryAttempts },
            detectedInconsistencies: this.detectedInconsistencies.length,
            recoveryHistory: this.recoveryHistory.length,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = { AutomaticRecovery };
