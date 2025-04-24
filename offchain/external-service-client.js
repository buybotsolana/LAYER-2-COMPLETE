/**
 * Client per servizi esterni con integrazione del Circuit Breaker
 * 
 * Questo modulo fornisce un client generico per i servizi esterni
 * con integrazione del pattern Circuit Breaker per gestire i fallimenti
 * e prevenire cascate di errori.
 */

const { CircuitBreaker } = require('./circuit-breaker');
const axios = require('axios');
const { promisify } = require('util');
const dns = require('dns');
const { RetryManager } = require('./retry-manager');

// Promisify DNS lookup
const dnsLookup = promisify(dns.lookup);

/**
 * Classe ExternalServiceClient
 * 
 * Client generico per servizi esterni con integrazione del Circuit Breaker
 * e gestione automatica dei retry.
 */
class ExternalServiceClient {
    /**
     * Costruttore
     * @param {Object} config - Configurazione del client
     * @param {Object} [config.circuitBreaker] - Configurazione del circuit breaker
     * @param {Object} [config.retry] - Configurazione del retry manager
     * @param {Object} [config.timeout] - Configurazione dei timeout
     * @param {Object} [config.logging] - Configurazione del logging
     */
    constructor(config = {}) {
        // Configurazione di default
        this.config = {
            circuitBreaker: {
                enabled: true,
                failureThreshold: 5,
                resetTimeout: 30000, // 30 secondi
                halfOpenTimeout: 10000, // 10 secondi
                successThreshold: 2,
                trackHealthMetrics: true
            },
            retry: {
                enabled: true,
                maxRetries: 3,
                initialBackoff: 100, // ms
                maxBackoff: 10000, // 10 secondi
                backoffFactor: 2,
                jitter: 0.1
            },
            timeout: {
                connect: 5000, // 5 secondi
                request: 30000, // 30 secondi
                dns: 5000 // 5 secondi
            },
            logging: {
                enabled: true,
                logLevel: 'info', // debug, info, warn, error
                logRequests: true,
                logResponses: false,
                logErrors: true
            },
            ...config
        };
        
        // Inizializza il circuit breaker
        if (this.config.circuitBreaker.enabled) {
            this.circuitBreaker = new CircuitBreaker({
                failureThreshold: this.config.circuitBreaker.failureThreshold,
                resetTimeout: this.config.circuitBreaker.resetTimeout,
                halfOpenTimeout: this.config.circuitBreaker.halfOpenTimeout,
                successThreshold: this.config.circuitBreaker.successThreshold,
                trackHealthMetrics: this.config.circuitBreaker.trackHealthMetrics,
                onStateChange: this._handleCircuitBreakerStateChange.bind(this),
                isFailure: this._isFailure.bind(this)
            });
        }
        
        // Inizializza il retry manager
        if (this.config.retry.enabled) {
            this.retryManager = new RetryManager({
                maxRetries: this.config.retry.maxRetries,
                initialBackoff: this.config.retry.initialBackoff,
                maxBackoff: this.config.retry.maxBackoff,
                backoffFactor: this.config.retry.backoffFactor,
                jitter: this.config.retry.jitter
            });
        }
        
        // Inizializza il client HTTP
        this.httpClient = axios.create({
            timeout: this.config.timeout.request,
            validateStatus: status => status >= 200 && status < 500
        });
        
        // Registro dei servizi
        this.services = {};
    }

    /**
     * Registra un servizio esterno
     * @param {string} serviceName - Nome del servizio
     * @param {Object} serviceConfig - Configurazione del servizio
     * @param {string} serviceConfig.baseUrl - URL base del servizio
     * @param {Object} [serviceConfig.headers] - Headers HTTP di default
     * @param {Object} [serviceConfig.auth] - Configurazione dell'autenticazione
     * @param {Object} [serviceConfig.circuitBreaker] - Configurazione specifica del circuit breaker
     * @param {Object} [serviceConfig.retry] - Configurazione specifica del retry
     * @param {Object} [serviceConfig.timeout] - Configurazione specifica dei timeout
     * @returns {Object} - Configurazione del servizio registrato
     */
    registerService(serviceName, serviceConfig) {
        if (!serviceConfig.baseUrl) {
            throw new Error('baseUrl is required for service registration');
        }
        
        // Merge della configurazione specifica del servizio con quella di default
        this.services[serviceName] = {
            baseUrl: serviceConfig.baseUrl,
            headers: serviceConfig.headers || {},
            auth: serviceConfig.auth || null,
            circuitBreaker: {
                ...this.config.circuitBreaker,
                ...(serviceConfig.circuitBreaker || {})
            },
            retry: {
                ...this.config.retry,
                ...(serviceConfig.retry || {})
            },
            timeout: {
                ...this.config.timeout,
                ...(serviceConfig.timeout || {})
            },
            metrics: {
                totalRequests: 0,
                successfulRequests: 0,
                failedRequests: 0,
                retries: 0,
                totalResponseTime: 0,
                averageResponseTime: 0
            }
        };
        
        this._log('info', `Service ${serviceName} registered with baseUrl ${serviceConfig.baseUrl}`);
        
        return this.services[serviceName];
    }

    /**
     * Esegue una richiesta HTTP a un servizio esterno
     * @param {string} serviceName - Nome del servizio
     * @param {Object} requestConfig - Configurazione della richiesta
     * @param {string} requestConfig.method - Metodo HTTP (GET, POST, PUT, DELETE, ecc.)
     * @param {string} requestConfig.path - Path della richiesta (relativo al baseUrl)
     * @param {Object} [requestConfig.params] - Parametri query string
     * @param {Object} [requestConfig.data] - Dati da inviare nel body
     * @param {Object} [requestConfig.headers] - Headers HTTP aggiuntivi
     * @param {Object} [options] - Opzioni aggiuntive
     * @param {boolean} [options.bypassCircuitBreaker=false] - Se bypassare il circuit breaker
     * @param {boolean} [options.bypassRetry=false] - Se bypassare il retry
     * @returns {Promise<Object>} - Risposta HTTP
     * @throws {Error} - Se la richiesta fallisce
     */
    async request(serviceName, requestConfig, options = {}) {
        // Verifica se il servizio è registrato
        if (!this.services[serviceName]) {
            throw new Error(`Service ${serviceName} is not registered`);
        }
        
        const service = this.services[serviceName];
        const startTime = Date.now();
        
        // Prepara la configurazione della richiesta
        const fullRequestConfig = {
            method: requestConfig.method || 'GET',
            url: `${service.baseUrl}${requestConfig.path}`,
            params: requestConfig.params || {},
            data: requestConfig.data || {},
            headers: {
                ...service.headers,
                ...requestConfig.headers
            },
            timeout: service.timeout.request,
            validateStatus: status => status >= 200 && status < 500
        };
        
        // Aggiungi autenticazione se configurata
        if (service.auth) {
            if (service.auth.type === 'basic') {
                fullRequestConfig.auth = {
                    username: service.auth.username,
                    password: service.auth.password
                };
            } else if (service.auth.type === 'bearer') {
                fullRequestConfig.headers.Authorization = `Bearer ${service.auth.token}`;
            }
        }
        
        // Log della richiesta
        if (this.config.logging.enabled && this.config.logging.logRequests) {
            this._log('info', `Request to ${serviceName}: ${fullRequestConfig.method} ${fullRequestConfig.url}`);
            this._log('debug', 'Request config:', fullRequestConfig);
        }
        
        // Aggiorna le metriche
        service.metrics.totalRequests++;
        
        try {
            let response;
            
            // Funzione per eseguire la richiesta
            const executeRequest = async () => {
                // Verifica la disponibilità del DNS prima della richiesta
                await this._checkDns(new URL(fullRequestConfig.url).hostname);
                
                // Esegui la richiesta HTTP
                return await this.httpClient(fullRequestConfig);
            };
            
            // Esegui con circuit breaker e retry se abilitati
            if (this.config.circuitBreaker.enabled && !options.bypassCircuitBreaker) {
                if (this.config.retry.enabled && !options.bypassRetry) {
                    // Esegui con circuit breaker e retry
                    response = await this.circuitBreaker.executeWithBreaker(
                        serviceName,
                        () => this.retryManager.executeWithRetry(
                            executeRequest,
                            {
                                maxRetries: service.retry.maxRetries,
                                onRetry: (error, retryCount) => {
                                    service.metrics.retries++;
                                    this._log('warn', `Retry ${retryCount} for ${serviceName} due to: ${error.message}`);
                                }
                            }
                        ),
                        { timeout: service.timeout.request }
                    );
                } else {
                    // Esegui solo con circuit breaker
                    response = await this.circuitBreaker.executeWithBreaker(
                        serviceName,
                        executeRequest,
                        { timeout: service.timeout.request }
                    );
                }
            } else if (this.config.retry.enabled && !options.bypassRetry) {
                // Esegui solo con retry
                response = await this.retryManager.executeWithRetry(
                    executeRequest,
                    {
                        maxRetries: service.retry.maxRetries,
                        onRetry: (error, retryCount) => {
                            service.metrics.retries++;
                            this._log('warn', `Retry ${retryCount} for ${serviceName} due to: ${error.message}`);
                        }
                    }
                );
            } else {
                // Esegui senza circuit breaker e retry
                response = await executeRequest();
            }
            
            // Calcola il tempo di risposta
            const responseTime = Date.now() - startTime;
            
            // Aggiorna le metriche
            service.metrics.successfulRequests++;
            service.metrics.totalResponseTime += responseTime;
            service.metrics.averageResponseTime = service.metrics.totalResponseTime / service.metrics.successfulRequests;
            
            // Log della risposta
            if (this.config.logging.enabled) {
                if (this.config.logging.logResponses) {
                    this._log('info', `Response from ${serviceName}: ${response.status} (${responseTime}ms)`);
                    this._log('debug', 'Response data:', response.data);
                } else {
                    this._log('info', `Request to ${serviceName} completed: ${response.status} (${responseTime}ms)`);
                }
            }
            
            return response;
        } catch (error) {
            // Aggiorna le metriche
            service.metrics.failedRequests++;
            
            // Log dell'errore
            if (this.config.logging.enabled && this.config.logging.logErrors) {
                this._log('error', `Request to ${serviceName} failed: ${error.message}`);
                if (error.response) {
                    this._log('debug', 'Error response:', error.response.data);
                }
            }
            
            // Rilancia l'errore con informazioni aggiuntive
            const enhancedError = new Error(`Request to ${serviceName} failed: ${error.message}`);
            enhancedError.originalError = error;
            enhancedError.service = serviceName;
            enhancedError.request = fullRequestConfig;
            enhancedError.response = error.response;
            
            throw enhancedError;
        }
    }

    /**
     * Esegue una richiesta GET
     * @param {string} serviceName - Nome del servizio
     * @param {string} path - Path della richiesta
     * @param {Object} [params] - Parametri query string
     * @param {Object} [options] - Opzioni aggiuntive
     * @returns {Promise<Object>} - Risposta HTTP
     */
    async get(serviceName, path, params = {}, options = {}) {
        return this.request(serviceName, {
            method: 'GET',
            path,
            params
        }, options);
    }

    /**
     * Esegue una richiesta POST
     * @param {string} serviceName - Nome del servizio
     * @param {string} path - Path della richiesta
     * @param {Object} data - Dati da inviare nel body
     * @param {Object} [options] - Opzioni aggiuntive
     * @returns {Promise<Object>} - Risposta HTTP
     */
    async post(serviceName, path, data = {}, options = {}) {
        return this.request(serviceName, {
            method: 'POST',
            path,
            data
        }, options);
    }

    /**
     * Esegue una richiesta PUT
     * @param {string} serviceName - Nome del servizio
     * @param {string} path - Path della richiesta
     * @param {Object} data - Dati da inviare nel body
     * @param {Object} [options] - Opzioni aggiuntive
     * @returns {Promise<Object>} - Risposta HTTP
     */
    async put(serviceName, path, data = {}, options = {}) {
        return this.request(serviceName, {
            method: 'PUT',
            path,
            data
        }, options);
    }

    /**
     * Esegue una richiesta DELETE
     * @param {string} serviceName - Nome del servizio
     * @param {string} path - Path della richiesta
     * @param {Object} [params] - Parametri query string
     * @param {Object} [options] - Opzioni aggiuntive
     * @returns {Promise<Object>} - Risposta HTTP
     */
    async delete(serviceName, path, params = {}, options = {}) {
        return this.request(serviceName, {
            method: 'DELETE',
            path,
            params
        }, options);
    }

    /**
     * Ottiene le metriche di un servizio
     * @param {string} serviceName - Nome del servizio
     * @returns {Object} - Metriche del servizio
     */
    getServiceMetrics(serviceName) {
        if (!this.services[serviceName]) {
            return null;
        }
        
        const service = this.services[serviceName];
        const circuitBreakerState = this.config.circuitBreaker.enabled
            ? this.circuitBreaker.getState(serviceName)
            : null;
        
        return {
            service: serviceName,
            baseUrl: service.baseUrl,
            metrics: { ...service.metrics },
            circuitBreaker: circuitBreakerState
        };
    }

    /**
     * Ottiene le metriche di tutti i servizi
     * @returns {Object} - Metriche di tutti i servizi
     */
    getAllServiceMetrics() {
        const metrics = {};
        
        for (const [serviceName, service] of Object.entries(this.services)) {
            const circuitBreakerState = this.config.circuitBreaker.enabled
                ? this.circuitBreaker.getState(serviceName)
                : null;
            
            metrics[serviceName] = {
                baseUrl: service.baseUrl,
                metrics: { ...service.metrics },
                circuitBreaker: circuitBreakerState
            };
        }
        
        return metrics;
    }

    /**
     * Resetta lo stato del circuit breaker per un servizio
     * @param {string} serviceName - Nome del servizio
     */
    resetCircuitBreaker(serviceName) {
        if (!this.config.circuitBreaker.enabled) {
            return;
        }
        
        this.circuitBreaker.resetState(serviceName);
    }

    /**
     * Resetta lo stato del circuit breaker per tutti i servizi
     */
    resetAllCircuitBreakers() {
        if (!this.config.circuitBreaker.enabled) {
            return;
        }
        
        this.circuitBreaker.resetAllStates();
    }

    /**
     * Verifica la disponibilità del DNS
     * @param {string} hostname - Hostname da verificare
     * @returns {Promise<void>}
     * @throws {Error} - Se il DNS non è disponibile
     * @private
     */
    async _checkDns(hostname) {
        try {
            await Promise.race([
                dnsLookup(hostname),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('DNS lookup timeout')), this.config.timeout.dns)
                )
            ]);
        } catch (error) {
            throw new Error(`DNS lookup failed for ${hostname}: ${error.message}`);
        }
    }

    /**
     * Gestisce il cambiamento di stato del circuit breaker
     * @param {Object} stateChange - Informazioni sul cambiamento di stato
     * @private
     */
    _handleCircuitBreakerStateChange(stateChange) {
        this._log('warn', `Circuit breaker for service ${stateChange.service} changed from ${stateChange.from} to ${stateChange.to}`);
    }

    /**
     * Determina se un errore è considerato un fallimento per il circuit breaker
     * @param {Error} error - Errore da valutare
     * @returns {boolean} - True se l'errore è considerato un fallimento
     * @private
     */
    _isFailure(error) {
        // Considera come fallimenti gli errori di rete, timeout e server error (5xx)
        if (!error.response) {
            // Errore di rete o timeout
            return true;
        }
        
        // Considera come fallimenti solo gli errori 5xx
        return error.response.status >= 500;
    }

    /**
     * Logga un messaggio
     * @param {string} level - Livello di log (debug, info, warn, error)
     * @param {string} message - Messaggio da loggare
     * @param {any} [data] - Dati aggiuntivi
     * @private
     */
    _log(level, message, data) {
        if (!this.config.logging.enabled) {
            return;
        }
        
        const logLevels = {
            debug: 0,
            info: 1,
            warn: 2,
            error: 3
        };
        
        if (logLevels[level] < logLevels[this.config.logging.logLevel]) {
            return;
        }
        
        const timestamp = new Date().toISOString();
        
        if (data) {
            console[level](`[${timestamp}] [ExternalServiceClient] ${message}`, data);
        } else {
            console[level](`[${timestamp}] [ExternalServiceClient] ${message}`);
        }
    }
}

module.exports = { ExternalServiceClient };
