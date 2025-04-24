/**
 * Circuit Breaker Pattern per il Layer-2 su Solana
 * 
 * Questo modulo implementa il pattern Circuit Breaker per proteggere il sistema
 * da fallimenti a cascata quando i servizi esterni non sono disponibili o rispondono
 * con errori. Il circuit breaker ha tre stati:
 * - CLOSED: il circuito è chiuso e le operazioni vengono eseguite normalmente
 * - OPEN: il circuito è aperto e le operazioni vengono rifiutate immediatamente
 * - HALF_OPEN: il circuito è parzialmente aperto e viene testato con alcune operazioni
 */

/**
 * Classe CircuitBreaker
 * 
 * Implementa il pattern Circuit Breaker per proteggere il sistema da fallimenti a cascata.
 */
class CircuitBreaker {
    /**
     * Costruttore
     * @param {Object} config - Configurazione del circuit breaker
     * @param {number} [config.failureThreshold=5] - Numero di fallimenti consecutivi prima di aprire il circuito
     * @param {number} [config.resetTimeout=30000] - Tempo in ms prima di passare da OPEN a HALF_OPEN
     * @param {number} [config.halfOpenTimeout=10000] - Tempo in ms prima di testare nuovamente in stato HALF_OPEN
     * @param {number} [config.successThreshold=2] - Numero di successi consecutivi in HALF_OPEN prima di chiudere il circuito
     * @param {Function} [config.onStateChange] - Callback chiamata quando lo stato del circuito cambia
     * @param {Function} [config.isFailure] - Funzione per determinare se un errore è considerato un fallimento
     * @param {boolean} [config.trackHealthMetrics=true] - Se tracciare le metriche di salute
     */
    constructor(config = {}) {
        this.failureThreshold = config.failureThreshold || 5;
        this.resetTimeout = config.resetTimeout || 30000; // ms
        this.halfOpenTimeout = config.halfOpenTimeout || 10000; // ms
        this.successThreshold = config.successThreshold || 2;
        this.onStateChange = config.onStateChange || (() => {});
        this.isFailure = config.isFailure || (() => true);
        this.trackHealthMetrics = config.trackHealthMetrics !== undefined ? config.trackHealthMetrics : true;
        
        // Stato iniziale
        this.state = 'CLOSED';
        this.failures = 0;
        this.successes = 0;
        this.lastFailureTime = null;
        this.lastStateChangeTime = Date.now();
        this.lastAttemptTime = null;
        
        // Registro dei servizi
        this.services = {};
        
        // Metriche
        this.metrics = {
            totalCalls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            rejectedCalls: 0,
            stateChanges: 0,
            lastStateChange: null,
            averageResponseTime: 0,
            totalResponseTime: 0
        };
    }

    /**
     * Esegue un'operazione con la protezione del circuit breaker
     * @param {string} serviceName - Nome del servizio
     * @param {Function} operation - Funzione da eseguire
     * @param {Object} [options] - Opzioni aggiuntive
     * @param {boolean} [options.forceExecution=false] - Se forzare l'esecuzione anche con circuito aperto
     * @param {number} [options.timeout] - Timeout in ms per l'operazione
     * @returns {Promise<any>} - Risultato dell'operazione
     * @throws {Error} - Se il circuito è aperto o l'operazione fallisce
     */
    async executeWithBreaker(serviceName, operation, options = {}) {
        // Verifica se il servizio è già registrato
        if (!this.services[serviceName]) {
            this.services[serviceName] = {
                state: 'CLOSED',
                failures: 0,
                successes: 0,
                lastFailureTime: null,
                lastStateChangeTime: Date.now(),
                lastAttemptTime: null,
                metrics: {
                    totalCalls: 0,
                    successfulCalls: 0,
                    failedCalls: 0,
                    rejectedCalls: 0,
                    stateChanges: 0,
                    lastStateChange: null,
                    averageResponseTime: 0,
                    totalResponseTime: 0
                }
            };
        }
        
        const service = this.services[serviceName];
        
        // Aggiorna le metriche
        service.metrics.totalCalls++;
        this.metrics.totalCalls++;
        service.lastAttemptTime = Date.now();
        this.lastAttemptTime = Date.now();
        
        // Verifica lo stato del circuit breaker
        if (service.state === 'OPEN') {
            // Verifica se è tempo di passare a half-open
            if (Date.now() - service.lastFailureTime > this.resetTimeout) {
                this._changeState(serviceName, 'HALF_OPEN');
            } else if (!options.forceExecution) {
                // Rifiuta l'operazione se il circuito è aperto e non è forzata l'esecuzione
                service.metrics.rejectedCalls++;
                this.metrics.rejectedCalls++;
                throw new Error(`Circuit breaker open for service: ${serviceName}`);
            }
        }
        
        try {
            const startTime = Date.now();
            
            // Esegui l'operazione con timeout se specificato
            let result;
            if (options.timeout) {
                result = await this._executeWithTimeout(operation, options.timeout);
            } else {
                result = await operation();
            }
            
            const responseTime = Date.now() - startTime;
            
            // Aggiorna le metriche di risposta
            service.metrics.totalResponseTime += responseTime;
            service.metrics.averageResponseTime = service.metrics.totalResponseTime / service.metrics.successfulCalls;
            this.metrics.totalResponseTime += responseTime;
            this.metrics.averageResponseTime = this.metrics.totalResponseTime / this.metrics.successfulCalls;
            
            // Reset in caso di successo
            if (service.state === 'HALF_OPEN') {
                service.successes++;
                this.successes++;
                
                // Se abbiamo raggiunto il numero di successi consecutivi, chiudi il circuito
                if (service.successes >= this.successThreshold) {
                    this._changeState(serviceName, 'CLOSED');
                }
            } else {
                service.failures = 0;
                this.failures = 0;
                service.successes = 0;
                this.successes = 0;
            }
            
            // Aggiorna le metriche di successo
            service.metrics.successfulCalls++;
            this.metrics.successfulCalls++;
            
            return result;
        } catch (error) {
            // Verifica se l'errore è considerato un fallimento
            if (!this.isFailure(error)) {
                throw error;
            }
            
            // Incrementa il contatore di fallimenti
            service.failures++;
            service.lastFailureTime = Date.now();
            this.failures++;
            this.lastFailureTime = Date.now();
            
            // Aggiorna le metriche di fallimento
            service.metrics.failedCalls++;
            this.metrics.failedCalls++;
            
            // Verifica se aprire il circuit breaker
            if (service.failures >= this.failureThreshold || service.state === 'HALF_OPEN') {
                this._changeState(serviceName, 'OPEN');
            }
            
            throw error;
        }
    }

    /**
     * Esegue un'operazione con timeout
     * @param {Function} operation - Funzione da eseguire
     * @param {number} timeout - Timeout in ms
     * @returns {Promise<any>} - Risultato dell'operazione
     * @throws {Error} - Se l'operazione fallisce o va in timeout
     * @private
     */
    async _executeWithTimeout(operation, timeout) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Operation timed out'));
            }, timeout);
            
            operation()
                .then(result => {
                    clearTimeout(timeoutId);
                    resolve(result);
                })
                .catch(error => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
    }

    /**
     * Cambia lo stato del circuit breaker
     * @param {string} serviceName - Nome del servizio
     * @param {string} newState - Nuovo stato (CLOSED, OPEN, HALF_OPEN)
     * @private
     */
    _changeState(serviceName, newState) {
        const service = this.services[serviceName];
        const oldState = service.state;
        
        if (oldState === newState) {
            return;
        }
        
        service.state = newState;
        service.lastStateChangeTime = Date.now();
        service.metrics.stateChanges++;
        service.metrics.lastStateChange = {
            from: oldState,
            to: newState,
            timestamp: new Date().toISOString()
        };
        
        this.metrics.stateChanges++;
        this.metrics.lastStateChange = {
            service: serviceName,
            from: oldState,
            to: newState,
            timestamp: new Date().toISOString()
        };
        
        // Reset dei contatori
        if (newState === 'CLOSED') {
            service.failures = 0;
            service.successes = 0;
        } else if (newState === 'HALF_OPEN') {
            service.successes = 0;
        }
        
        // Notifica il cambiamento di stato
        this.onStateChange({
            service: serviceName,
            from: oldState,
            to: newState,
            timestamp: new Date().toISOString()
        });
        
        console.log(`Circuit breaker for service ${serviceName} changed from ${oldState} to ${newState}`);
    }

    /**
     * Ottiene lo stato attuale del circuit breaker per un servizio
     * @param {string} serviceName - Nome del servizio
     * @returns {Object} - Stato del circuit breaker
     */
    getState(serviceName) {
        if (!this.services[serviceName]) {
            return null;
        }
        
        const service = this.services[serviceName];
        
        return {
            service: serviceName,
            state: service.state,
            failures: service.failures,
            successes: service.successes,
            lastFailureTime: service.lastFailureTime,
            lastStateChangeTime: service.lastStateChangeTime,
            lastAttemptTime: service.lastAttemptTime,
            metrics: { ...service.metrics }
        };
    }

    /**
     * Ottiene lo stato di tutti i servizi
     * @returns {Object} - Stato di tutti i servizi
     */
    getAllStates() {
        const states = {};
        
        for (const [serviceName, service] of Object.entries(this.services)) {
            states[serviceName] = {
                state: service.state,
                failures: service.failures,
                successes: service.successes,
                lastFailureTime: service.lastFailureTime,
                lastStateChangeTime: service.lastStateChangeTime,
                lastAttemptTime: service.lastAttemptTime,
                metrics: { ...service.metrics }
            };
        }
        
        return states;
    }

    /**
     * Ottiene le metriche globali del circuit breaker
     * @returns {Object} - Metriche globali
     */
    getMetrics() {
        return { ...this.metrics };
    }

    /**
     * Resetta lo stato del circuit breaker per un servizio
     * @param {string} serviceName - Nome del servizio
     */
    resetState(serviceName) {
        if (!this.services[serviceName]) {
            return;
        }
        
        const service = this.services[serviceName];
        const oldState = service.state;
        
        service.state = 'CLOSED';
        service.failures = 0;
        service.successes = 0;
        service.lastFailureTime = null;
        service.lastStateChangeTime = Date.now();
        
        // Notifica il cambiamento di stato
        this.onStateChange({
            service: serviceName,
            from: oldState,
            to: 'CLOSED',
            timestamp: new Date().toISOString()
        });
        
        console.log(`Circuit breaker for service ${serviceName} reset to CLOSED`);
    }

    /**
     * Resetta lo stato di tutti i servizi
     */
    resetAllStates() {
        for (const serviceName of Object.keys(this.services)) {
            this.resetState(serviceName);
        }
    }
}

module.exports = { CircuitBreaker };
