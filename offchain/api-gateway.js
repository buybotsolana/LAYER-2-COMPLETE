/**
 * API Gateway per il Layer-2 su Solana
 * 
 * Questo modulo implementa un API Gateway che fornisce un punto di accesso
 * unificato per tutte le API del sistema, con supporto per autenticazione,
 * autorizzazione, rate limiting e altre funzionalità di sicurezza.
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');
const { CircuitBreaker } = require('./circuit-breaker');
const { RetryManager } = require('./retry-manager');
const { GracefulDegradation } = require('./graceful-degradation');
const { AuthManager } = require('./auth-manager');

/**
 * Classe ApiGateway
 * 
 * Implementa un API Gateway con supporto per autenticazione, autorizzazione,
 * rate limiting, circuit breaker e altre funzionalità di sicurezza e robustezza.
 */
class ApiGateway extends EventEmitter {
    /**
     * Costruttore
     * @param {Object} config - Configurazione dell'API Gateway
     * @param {number} [config.port=3000] - Porta su cui ascoltare
     * @param {string} [config.host='0.0.0.0'] - Host su cui ascoltare
     * @param {Object} [config.security] - Configurazione di sicurezza
     * @param {Object} [config.rateLimiting] - Configurazione del rate limiting
     * @param {Object} [config.circuitBreaker] - Configurazione del circuit breaker
     * @param {Object} [config.gracefulDegradation] - Configurazione della degradazione graduale
     * @param {Object} [config.auth] - Configurazione dell'autenticazione
     * @param {Function} [config.logger] - Funzione di logging
     */
    constructor(config = {}) {
        super();
        
        this.config = {
            port: config.port || 3000,
            host: config.host || '0.0.0.0',
            security: {
                helmet: true,
                cors: true,
                xssProtection: true,
                noSniff: true,
                hidePoweredBy: true,
                ...config.security
            },
            rateLimiting: {
                enabled: true,
                windowMs: 15 * 60 * 1000, // 15 minuti
                max: 100, // 100 richieste per IP
                standardHeaders: true,
                legacyHeaders: false,
                ...config.rateLimiting
            },
            ...config
        };
        
        // Inizializza l'app Express
        this.app = express();
        
        // Stato del gateway
        this.isInitialized = false;
        this.isRunning = false;
        this.server = null;
        
        // Logger
        this.logger = this.config.logger || console;
        
        // Registro delle route
        this.routes = [];
        
        // Registro dei middleware
        this.middlewares = [];
        
        // Registro degli errori
        this.errors = [];
        
        // Componenti
        this.circuitBreaker = null;
        this.retryManager = null;
        this.gracefulDegradation = null;
        this.authManager = null;
    }

    /**
     * Inizializza l'API Gateway
     * @returns {Promise<boolean>} - True se l'inizializzazione è riuscita
     */
    async initialize() {
        try {
            this.logger.info('Inizializzazione dell\'API Gateway...');
            
            // Inizializza i componenti
            await this._initializeComponents();
            
            // Configura l'app Express
            this._configureExpress();
            
            // Registra le route di default
            this._registerDefaultRoutes();
            
            this.isInitialized = true;
            this.emit('initialized');
            
            this.logger.info('API Gateway inizializzato con successo');
            return true;
        } catch (error) {
            this.logger.error(`Errore durante l'inizializzazione dell'API Gateway: ${error.message}`);
            throw error;
        }
    }

    /**
     * Inizializza i componenti
     * @returns {Promise<void>}
     * @private
     */
    async _initializeComponents() {
        // Inizializza il circuit breaker
        if (this.config.circuitBreaker) {
            this.circuitBreaker = new CircuitBreaker(this.config.circuitBreaker);
            await this.circuitBreaker.initialize();
        }
        
        // Inizializza il retry manager
        if (this.config.retry) {
            this.retryManager = new RetryManager(this.config.retry);
        }
        
        // Inizializza la degradazione graduale
        if (this.config.gracefulDegradation) {
            this.gracefulDegradation = new GracefulDegradation(this.config.gracefulDegradation);
            await this.gracefulDegradation.initialize();
        }
        
        // Inizializza l'auth manager
        if (this.config.auth) {
            this.authManager = new AuthManager(this.config.auth);
            await this.authManager.initialize();
        }
    }

    /**
     * Configura l'app Express
     * @private
     */
    _configureExpress() {
        // Aggiungi middleware per il logging delle richieste
        this.app.use(this._requestLogger.bind(this));
        
        // Aggiungi middleware per la generazione di ID di correlazione
        this.app.use(this._correlationIdMiddleware.bind(this));
        
        // Configura la sicurezza
        if (this.config.security.helmet) {
            this.app.use(helmet());
        }
        
        if (this.config.security.cors) {
            this.app.use(cors());
        }
        
        // Configura il parsing del body
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        
        // Configura il rate limiting
        if (this.config.rateLimiting.enabled) {
            const limiter = rateLimit({
                windowMs: this.config.rateLimiting.windowMs,
                max: this.config.rateLimiting.max,
                standardHeaders: this.config.rateLimiting.standardHeaders,
                legacyHeaders: this.config.rateLimiting.legacyHeaders
            });
            
            this.app.use(limiter);
        }
        
        // Aggiungi middleware per la gestione degli errori
        this.app.use(this._errorHandler.bind(this));
    }

    /**
     * Middleware per il logging delle richieste
     * @param {Object} req - Richiesta
     * @param {Object} res - Risposta
     * @param {Function} next - Callback
     * @private
     */
    _requestLogger(req, res, next) {
        const start = Date.now();
        
        // Aggiungi un listener per il completamento della risposta
        res.on('finish', () => {
            const duration = Date.now() - start;
            const message = `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;
            
            if (res.statusCode >= 500) {
                this.logger.error(message);
            } else if (res.statusCode >= 400) {
                this.logger.warn(message);
            } else {
                this.logger.info(message);
            }
        });
        
        next();
    }

    /**
     * Middleware per la generazione di ID di correlazione
     * @param {Object} req - Richiesta
     * @param {Object} res - Risposta
     * @param {Function} next - Callback
     * @private
     */
    _correlationIdMiddleware(req, res, next) {
        // Genera un ID di correlazione se non è già presente
        req.correlationId = req.headers['x-correlation-id'] || uuidv4();
        
        // Aggiungi l'ID di correlazione alle risposte
        res.setHeader('X-Correlation-ID', req.correlationId);
        
        next();
    }

    /**
     * Middleware per la gestione degli errori
     * @param {Error} err - Errore
     * @param {Object} req - Richiesta
     * @param {Object} res - Risposta
     * @param {Function} next - Callback
     * @private
     */
    _errorHandler(err, req, res, next) {
        // Registra l'errore
        this.errors.push({
            error: err,
            request: {
                method: req.method,
                url: req.originalUrl,
                correlationId: req.correlationId
            },
            timestamp: new Date().toISOString()
        });
        
        // Limita la dimensione del registro
        if (this.errors.length > 1000) {
            this.errors = this.errors.slice(-1000);
        }
        
        // Logga l'errore
        this.logger.error(`Errore nella richiesta ${req.method} ${req.originalUrl}: ${err.message}`);
        
        // Emetti evento
        this.emit('error', {
            error: err,
            request: {
                method: req.method,
                url: req.originalUrl,
                correlationId: req.correlationId
            },
            timestamp: new Date().toISOString()
        });
        
        // Invia la risposta
        res.status(err.status || 500).json({
            error: {
                message: err.message,
                code: err.code || 'INTERNAL_SERVER_ERROR',
                correlationId: req.correlationId
            }
        });
    }

    /**
     * Registra le route di default
     * @private
     */
    _registerDefaultRoutes() {
        // Route di health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                correlationId: req.correlationId
            });
        });
        
        // Route di readiness
        this.app.get('/ready', async (req, res) => {
            const status = {
                status: this.isRunning ? 'ok' : 'not_ready',
                timestamp: new Date().toISOString(),
                correlationId: req.correlationId
            };
            
            // Aggiungi lo stato dei componenti
            if (this.circuitBreaker) {
                status.circuitBreaker = this.circuitBreaker.getStatus();
            }
            
            if (this.gracefulDegradation) {
                status.gracefulDegradation = await this.gracefulDegradation.getStatus();
            }
            
            res.json(status);
        });
        
        // Route di metriche
        this.app.get('/metrics', (req, res) => {
            const metrics = {
                timestamp: new Date().toISOString(),
                correlationId: req.correlationId,
                routes: this.routes.length,
                errors: this.errors.length
            };
            
            // Aggiungi le metriche dei componenti
            if (this.circuitBreaker) {
                metrics.circuitBreaker = this.circuitBreaker.getMetrics();
            }
            
            if (this.retryManager) {
                metrics.retryManager = this.retryManager.getMetrics();
            }
            
            res.json(metrics);
        });
    }

    /**
     * Avvia il server
     * @returns {Promise<boolean>} - True se l'avvio è riuscito
     */
    async start() {
        if (!this.isInitialized) {
            throw new Error('L\'API Gateway non è inizializzato');
        }
        
        if (this.isRunning) {
            this.logger.warn('L\'API Gateway è già in esecuzione');
            return true;
        }
        
        return new Promise((resolve, reject) => {
            try {
                this.server = this.app.listen(this.config.port, this.config.host, () => {
                    this.isRunning = true;
                    this.logger.info(`API Gateway in ascolto su ${this.config.host}:${this.config.port}`);
                    this.emit('started');
                    resolve(true);
                });
                
                this.server.on('error', (error) => {
                    this.logger.error(`Errore nel server: ${error.message}`);
                    this.emit('server_error', error);
                    reject(error);
                });
            } catch (error) {
                this.logger.error(`Errore durante l'avvio del server: ${error.message}`);
                reject(error);
            }
        });
    }

    /**
     * Ferma il server
     * @returns {Promise<boolean>} - True se l'arresto è riuscito
     */
    async stop() {
        if (!this.isRunning || !this.server) {
            this.logger.warn('L\'API Gateway non è in esecuzione');
            return true;
        }
        
        return new Promise((resolve, reject) => {
            try {
                this.server.close(() => {
                    this.isRunning = false;
                    this.logger.info('API Gateway arrestato');
                    this.emit('stopped');
                    resolve(true);
                });
            } catch (error) {
                this.logger.error(`Errore durante l'arresto del server: ${error.message}`);
                reject(error);
            }
        });
    }

    /**
     * Registra una route
     * @param {string} method - Metodo HTTP
     * @param {string} path - Path della route
     * @param {Object} options - Opzioni della route
     * @param {Function[]} handlers - Handler della route
     * @returns {Object} - Route registrata
     */
    registerRoute(method, path, options = {}, ...handlers) {
        if (!this.isInitialized) {
            throw new Error('L\'API Gateway non è inizializzato');
        }
        
        // Normalizza il metodo
        method = method.toLowerCase();
        
        // Verifica se il metodo è valido
        if (!['get', 'post', 'put', 'delete', 'patch', 'options', 'head'].includes(method)) {
            throw new Error(`Metodo HTTP non valido: ${method}`);
        }
        
        // Prepara gli handler
        const routeHandlers = [];
        
        // Aggiungi middleware di autenticazione se richiesto
        if (options.auth && this.authManager) {
            routeHandlers.push(this.authManager.authenticate(options.auth));
        }
        
        // Aggiungi middleware di autorizzazione se richiesto
        if (options.roles && this.authManager) {
            routeHandlers.push(this.authManager.authorize(options.roles));
        }
        
        // Aggiungi middleware di rate limiting specifico se richiesto
        if (options.rateLimit) {
            const routeLimiter = rateLimit({
                windowMs: options.rateLimit.windowMs || this.config.rateLimiting.windowMs,
                max: options.rateLimit.max || this.config.rateLimiting.max,
                standardHeaders: options.rateLimit.standardHeaders !== undefined ? options.rateLimit.standardHeaders : this.config.rateLimiting.standardHeaders,
                legacyHeaders: options.rateLimit.legacyHeaders !== undefined ? options.rateLimit.legacyHeaders : this.config.rateLimiting.legacyHeaders
            });
            
            routeHandlers.push(routeLimiter);
        }
        
        // Aggiungi middleware di circuit breaker se richiesto
        if (options.circuitBreaker && this.circuitBreaker) {
            routeHandlers.push(this._circuitBreakerMiddleware(options.circuitBreaker));
        }
        
        // Aggiungi middleware di degradazione graduale se richiesto
        if (options.gracefulDegradation && this.gracefulDegradation) {
            routeHandlers.push(this._gracefulDegradationMiddleware(options.gracefulDegradation));
        }
        
        // Aggiungi gli handler specifici della route
        routeHandlers.push(...handlers);
        
        // Registra la route
        this.app[method](path, ...routeHandlers);
        
        // Aggiungi al registro delle route
        const route = {
            method,
            path,
            options,
            handlers: routeHandlers.length
        };
        
        this.routes.push(route);
        
        this.logger.info(`Route registrata: ${method.toUpperCase()} ${path}`);
        
        return route;
    }

    /**
     * Middleware per il circuit breaker
     * @param {Object} options - Opzioni del circuit breaker
     * @returns {Function} - Middleware
     * @private
     */
    _circuitBreakerMiddleware(options) {
        const serviceName = options.service || 'default';
        
        return async (req, res, next) => {
            try {
                await this.circuitBreaker.executeWithBreaker(
                    serviceName,
                    async () => {
                        // Passa al prossimo middleware
                        return new Promise((resolve, reject) => {
                            const nextError = (err) => {
                                if (err) {
                                    reject(err);
                                } else {
                                    resolve();
                                }
                            };
                            
                            // Sostituisci temporaneamente la funzione next
                            const originalNext = next;
                            next = nextError;
                            
                            try {
                                // Chiama il prossimo middleware
                                originalNext();
                            } catch (error) {
                                reject(error);
                            }
                        });
                    }
                );
            } catch (error) {
                // Se il circuit breaker è aperto, invia una risposta di errore
                if (error.message.includes('Circuit breaker is open')) {
                    res.status(503).json({
                        error: {
                            message: 'Service temporarily unavailable',
                            code: 'SERVICE_UNAVAILABLE',
                            correlationId: req.correlationId
                        }
                    });
                } else {
                    next(error);
                }
            }
        };
    }

    /**
     * Middleware per la degradazione graduale
     * @param {Object} options - Opzioni della degradazione graduale
     * @returns {Function} - Middleware
     * @private
     */
    _gracefulDegradationMiddleware(options) {
        const featureName = options.feature || 'default';
        
        return async (req, res, next) => {
            try {
                // Verifica se la feature è disponibile
                const isAvailable = await this.gracefulDegradation.checkFeatureAvailability(featureName);
                
                if (isAvailable) {
                    // La feature è disponibile, continua normalmente
                    next();
                } else {
                    // La feature non è disponibile, cerca un'alternativa
                    const alternative = await this.gracefulDegradation.degradeGracefully(featureName);
                    
                    if (alternative) {
                        // Usa l'alternativa
                        req.alternativeFeature = alternative;
                        next();
                    } else {
                        // Nessuna alternativa disponibile, invia una risposta di errore
                        res.status(503).json({
                            error: {
                                message: 'Feature temporarily unavailable',
                                code: 'FEATURE_UNAVAILABLE',
                                correlationId: req.correlationId
                            }
                        });
                    }
                }
            } catch (error) {
                next(error);
            }
        };
    }

    /**
     * Registra un middleware globale
     * @param {Function} middleware - Middleware da registrare
     * @param {Object} [options] - Opzioni del middleware
     * @returns {Object} - Middleware registrato
     */
    registerMiddleware(middleware, options = {}) {
        if (!this.isInitialized) {
            throw new Error('L\'API Gateway non è inizializzato');
        }
        
        // Registra il middleware
        this.app.use(middleware);
        
        // Aggiungi al registro dei middleware
        const registeredMiddleware = {
            middleware,
            options
        };
        
        this.middlewares.push(registeredMiddleware);
        
        this.logger.info('Middleware registrato');
        
        return registeredMiddleware;
    }

    /**
     * Registra un router
     * @param {string} basePath - Path base del router
     * @param {Object} router - Router Express
     * @param {Object} [options] - Opzioni del router
     * @returns {Object} - Router registrato
     */
    registerRouter(basePath, router, options = {}) {
        if (!this.isInitialized) {
            throw new Error('L\'API Gateway non è inizializzato');
        }
        
        // Aggiungi middleware di autenticazione se richiesto
        if (options.auth && this.authManager) {
            router.use(this.authManager.authenticate(options.auth));
        }
        
        // Aggiungi middleware di rate limiting specifico se richiesto
        if (options.rateLimit) {
            const routerLimiter = rateLimit({
                windowMs: options.rateLimit.windowMs || this.config.rateLimiting.windowMs,
                max: options.rateLimit.max || this.config.rateLimiting.max,
                standardHeaders: options.rateLimit.standardHeaders !== undefined ? options.rateLimit.standardHeaders : this.config.rateLimiting.standardHeaders,
                legacyHeaders: options.rateLimit.legacyHeaders !== undefined ? options.rateLimit.legacyHeaders : this.config.rateLimiting.legacyHeaders
            });
            
            router.use(routerLimiter);
        }
        
        // Registra il router
        this.app.use(basePath, router);
        
        this.logger.info(`Router registrato: ${basePath}`);
        
        return {
            basePath,
            router,
            options
        };
    }

    /**
     * Ottiene lo stato dell'API Gateway
     * @returns {Object} - Stato dell'API Gateway
     */
    getStatus() {
        return {
            isInitialized: this.isInitialized,
            isRunning: this.isRunning,
            port: this.config.port,
            host: this.config.host,
            routes: this.routes.length,
            middlewares: this.middlewares.length,
            errors: this.errors.length,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = { ApiGateway };
