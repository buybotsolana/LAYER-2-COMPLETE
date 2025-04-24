/**
 * Retry Manager per il Layer-2 su Solana
 * 
 * Questo modulo implementa un sistema di retry con exponential backoff e jitter
 * per gestire i fallimenti temporanei nelle operazioni, in particolare nelle
 * chiamate a servizi esterni o operazioni di rete.
 */

/**
 * Classe RetryManager
 * 
 * Implementa un sistema di retry con exponential backoff e jitter.
 */
class RetryManager {
    /**
     * Costruttore
     * @param {Object} config - Configurazione del retry manager
     * @param {number} [config.maxRetries=5] - Numero massimo di tentativi
     * @param {number} [config.initialBackoff=100] - Backoff iniziale in ms
     * @param {number} [config.maxBackoff=10000] - Backoff massimo in ms
     * @param {number} [config.backoffFactor=2] - Fattore di moltiplicazione per il backoff
     * @param {number} [config.jitter=0.1] - Fattore di jitter (0-1) per randomizzare il backoff
     * @param {Function} [config.retryCondition] - Funzione per determinare se un errore è retriable
     * @param {Function} [config.onRetry] - Callback chiamata prima di ogni retry
     */
    constructor(config = {}) {
        this.maxRetries = config.maxRetries || 5;
        this.initialBackoff = config.initialBackoff || 100; // ms
        this.maxBackoff = config.maxBackoff || 10000; // ms
        this.backoffFactor = config.backoffFactor || 2;
        this.jitter = config.jitter || 0.1;
        this.retryCondition = config.retryCondition || this._defaultRetryCondition;
        this.onRetry = config.onRetry || (() => {});
        
        // Metriche
        this.metrics = {
            totalOperations: 0,
            successfulOperations: 0,
            failedOperations: 0,
            retriedOperations: 0,
            totalRetries: 0,
            averageRetries: 0,
            maxRetriesReached: 0
        };
    }

    /**
     * Esegue un'operazione con retry automatico
     * @param {Function} operation - Funzione da eseguire
     * @param {Object} [options] - Opzioni per l'esecuzione
     * @param {number} [options.maxRetries] - Sovrascrive il numero massimo di tentativi
     * @param {Function} [options.retryCondition] - Sovrascrive la funzione per determinare se un errore è retriable
     * @param {Function} [options.onRetry] - Sovrascrive la callback chiamata prima di ogni retry
     * @param {Object} [options.context] - Contesto da passare alla funzione onRetry
     * @returns {Promise<any>} - Risultato dell'operazione
     * @throws {Error} - Se tutti i tentativi falliscono
     */
    async executeWithRetry(operation, options = {}) {
        const maxRetries = options.maxRetries !== undefined ? options.maxRetries : this.maxRetries;
        const retryCondition = options.retryCondition || this.retryCondition;
        const onRetry = options.onRetry || this.onRetry;
        const context = options.context || {};
        
        let retries = 0;
        let lastError = null;
        
        // Aggiorna le metriche
        this.metrics.totalOperations++;
        
        while (retries <= maxRetries) {
            try {
                const result = await operation();
                
                // Aggiorna le metriche in caso di successo
                this.metrics.successfulOperations++;
                if (retries > 0) {
                    this.metrics.retriedOperations++;
                    this.metrics.totalRetries += retries;
                    this.metrics.averageRetries = this.metrics.totalRetries / this.metrics.retriedOperations;
                }
                
                return result;
            } catch (error) {
                lastError = error;
                
                // Verifica se l'errore è retriable e se abbiamo ancora tentativi disponibili
                if (retries >= maxRetries || !retryCondition(error, retries, context)) {
                    break;
                }
                
                // Calcola il backoff
                const backoff = this.calculateBackoff(retries);
                
                // Notifica il retry
                try {
                    await onRetry(error, retries + 1, backoff, context);
                } catch (callbackError) {
                    console.error('Error in onRetry callback:', callbackError);
                }
                
                // Attendi prima di riprovare
                await this.sleep(backoff);
                
                retries++;
            }
        }
        
        // Aggiorna le metriche in caso di fallimento
        this.metrics.failedOperations++;
        if (retries > 0) {
            this.metrics.retriedOperations++;
            this.metrics.totalRetries += retries;
            this.metrics.averageRetries = this.metrics.totalRetries / this.metrics.retriedOperations;
        }
        if (retries >= maxRetries) {
            this.metrics.maxRetriesReached++;
        }
        
        // Se arriviamo qui, tutti i tentativi sono falliti
        const enhancedError = new Error(`Max retries exceeded: ${lastError.message}`);
        enhancedError.originalError = lastError;
        enhancedError.retries = retries;
        throw enhancedError;
    }

    /**
     * Calcola il tempo di backoff per un determinato tentativo
     * @param {number} retryCount - Numero del tentativo (0-based)
     * @returns {number} - Tempo di backoff in ms
     */
    calculateBackoff(retryCount) {
        // Calcola il backoff base con exponential backoff
        const backoff = this.initialBackoff * Math.pow(this.backoffFactor, retryCount);
        
        // Applica un limite massimo
        const cappedBackoff = Math.min(backoff, this.maxBackoff);
        
        // Aggiungi jitter per evitare il "thundering herd problem"
        const jitterAmount = cappedBackoff * this.jitter;
        return cappedBackoff + (Math.random() * jitterAmount * 2 - jitterAmount);
    }

    /**
     * Funzione di default per determinare se un errore è retriable
     * @param {Error} error - Errore da valutare
     * @param {number} retryCount - Numero del tentativo corrente
     * @param {Object} context - Contesto dell'operazione
     * @returns {boolean} - True se l'errore è retriable
     * @private
     */
    _defaultRetryCondition(error, retryCount, context) {
        // Per default, considera retriable gli errori di rete, timeout e server error (5xx)
        
        // Errori di rete o timeout
        if (error.code === 'ECONNRESET' || 
            error.code === 'ECONNREFUSED' || 
            error.code === 'ETIMEDOUT' || 
            error.code === 'ESOCKETTIMEDOUT' || 
            error.code === 'ENOTFOUND' || 
            error.message.includes('timeout')) {
            return true;
        }
        
        // Errori HTTP 5xx
        if (error.response && error.response.status >= 500 && error.response.status < 600) {
            return true;
        }
        
        // Errori di rate limiting (429)
        if (error.response && error.response.status === 429) {
            return true;
        }
        
        // Errori specifici di Solana
        if (error.message && (
            error.message.includes('Transaction simulation failed') ||
            error.message.includes('failed to send transaction') ||
            error.message.includes('timed out') ||
            error.message.includes('blockhash not found') ||
            error.message.includes('block height exceeded')
        )) {
            return true;
        }
        
        return false;
    }

    /**
     * Attende per un determinato numero di millisecondi
     * @param {number} ms - Millisecondi da attendere
     * @returns {Promise<void>}
     * @private
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Ottiene le metriche del retry manager
     * @returns {Object} - Metriche
     */
    getMetrics() {
        return { ...this.metrics };
    }

    /**
     * Resetta le metriche del retry manager
     */
    resetMetrics() {
        this.metrics = {
            totalOperations: 0,
            successfulOperations: 0,
            failedOperations: 0,
            retriedOperations: 0,
            totalRetries: 0,
            averageRetries: 0,
            maxRetriesReached: 0
        };
    }
}

module.exports = { RetryManager };
