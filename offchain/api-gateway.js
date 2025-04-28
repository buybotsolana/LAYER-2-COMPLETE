/**
 * API Gateway per il Layer-2 su Solana
 * 
 * Questo modulo implementa un gateway API che integra il sistema di autorizzazione
 * a più livelli per proteggere gli endpoint e gestire le richieste in modo sicuro.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const DatabaseManager = require('./database-manager');
const AuthManager = require('./auth-manager');
const QueryBuilder = require('./query-builder');

/**
 * Classe ApiGateway
 * 
 * Gestisce le richieste API e integra il sistema di autorizzazione
 * per proteggere gli endpoint.
 */
class ApiGateway {
    /**
     * Costruttore
     * @param {Object} options - Opzioni di configurazione
     */
    constructor(options = {}) {
        this.config = {
            port: options.port || process.env.API_PORT || 3000,
            host: options.host || process.env.API_HOST || '0.0.0.0',
            basePath: options.basePath || process.env.API_BASE_PATH || '/api/v1',
            corsOrigin: options.corsOrigin || process.env.CORS_ORIGIN || '*',
            rateLimitWindow: options.rateLimitWindow || parseInt(process.env.RATE_LIMIT_WINDOW || '900000'), // 15 minuti
            rateLimitMax: options.rateLimitMax || parseInt(process.env.RATE_LIMIT_MAX || '100'), // 100 richieste per finestra
            jwtSecret: options.jwtSecret || process.env.JWT_SECRET,
            jwtRefreshSecret: options.jwtRefreshSecret || process.env.JWT_REFRESH_SECRET,
            databasePath: options.databasePath || process.env.DATABASE_PATH,
            logRequests: options.logRequests !== undefined ? options.logRequests : true,
            logErrors: options.logErrors !== undefined ? options.logErrors : true,
            enableSwagger: options.enableSwagger !== undefined ? options.enableSwagger : true,
            swaggerBasePath: options.swaggerBasePath || process.env.SWAGGER_BASE_PATH || '/api-docs',
        };
        
        this.app = express();
        this.server = null;
        this.db = null;
        this.auth = null;
        this.routes = [];
        this.middlewares = [];
        this.errorHandlers = [];
    }

    /**
     * Inizializza l'API gateway
     * @returns {Promise<boolean>} True se l'inizializzazione è riuscita
     */
    async initialize() {
        try {
            console.log('Inizializzazione API Gateway...');
            
            // Inizializza il database manager
            this.db = new DatabaseManager({
                databasePath: this.config.databasePath,
                enableWAL: true,
                enableForeignKeys: true,
                logQueries: this.config.logRequests,
                logErrors: this.config.logErrors,
            });
            
            await this.db.initialize();
            await this.db.createTables();
            await this.db.prepareCommonStatements();
            
            // Inizializza l'auth manager
            this.auth = new AuthManager({
                jwtSecret: this.config.jwtSecret,
                jwtRefreshSecret: this.config.jwtRefreshSecret,
                tokenRotationEnabled: true,
                rbacEnabled: true,
                abacEnabled: true,
                logAuthEvents: true,
            }, this.db);
            
            await this.auth.initialize();
            
            // Configura l'app Express
            this._configureExpress();
            
            // Registra i middleware di base
            this._registerBaseMiddlewares();
            
            // Registra le rotte
            this._registerRoutes();
            
            // Registra i gestori di errori
            this._registerErrorHandlers();
            
            console.log('API Gateway inizializzato con successo');
            return true;
        } catch (error) {
            console.error('Errore durante l\'inizializzazione dell\'API Gateway:', error);
            throw error;
        }
    }

    /**
     * Configura l'app Express
     */
    _configureExpress() {
        // Middleware di sicurezza
        this.app.use(helmet());
        
        // Configurazione CORS
        this.app.use(cors({
            origin: this.config.corsOrigin,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization'],
            exposedHeaders: ['X-Request-ID', 'X-Rate-Limit-Remaining'],
            credentials: true,
            maxAge: 86400, // 24 ore
        }));
        
        // Parsing del corpo della richiesta
        this.app.use(express.json({ limit: '1mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));
        
        // Rate limiting
        const apiLimiter = rateLimit({
            windowMs: this.config.rateLimitWindow,
            max: this.config.rateLimitMax,
            standardHeaders: true,
            legacyHeaders: false,
            message: {
                status: 'error',
                code: 429,
                message: 'Troppe richieste, riprova più tardi',
            },
        });
        
        // Applica il rate limiting a tutte le rotte API
        this.app.use(this.config.basePath, apiLimiter);
        
        // Aggiungi ID richiesta
        this.app.use((req, res, next) => {
            req.id = uuidv4();
            res.setHeader('X-Request-ID', req.id);
            next();
        });
        
        // Configura Swagger se abilitato
        if (this.config.enableSwagger) {
            this._configureSwagger();
        }
    }

    /**
     * Configura Swagger
     */
    _configureSwagger() {
        try {
            const swaggerUi = require('swagger-ui-express');
            const swaggerJsdoc = require('swagger-jsdoc');
            
            const options = {
                definition: {
                    openapi: '3.0.0',
                    info: {
                        title: 'Layer-2 Solana API',
                        version: '1.0.0',
                        description: 'API per il Layer-2 su Solana',
                        license: {
                            name: 'MIT',
                            url: 'https://opensource.org/licenses/MIT',
                        },
                        contact: {
                            name: 'API Support',
                            url: 'https://layer2-solana.com/support',
                            email: 'support@layer2-solana.com',
                        },
                    },
                    servers: [
                        {
                            url: this.config.basePath,
                            description: 'API Server',
                        },
                    ],
                    components: {
                        securitySchemes: {
                            bearerAuth: {
                                type: 'http',
                                scheme: 'bearer',
                                bearerFormat: 'JWT',
                            },
                        },
                    },
                    security: [
                        {
                            bearerAuth: [],
                        },
                    ],
                },
                apis: ['./routes/*.js'], // Percorso ai file con annotazioni JSDoc
            };
            
            const specs = swaggerJsdoc(options);
            this.app.use(this.config.swaggerBasePath, swaggerUi.serve, swaggerUi.setup(specs));
            
            console.log(`Swagger UI disponibile su ${this.config.swaggerBasePath}`);
        } catch (error) {
            console.error('Errore durante la configurazione di Swagger:', error);
        }
    }

    /**
     * Registra i middleware di base
     */
    _registerBaseMiddlewares() {
        // Middleware per il logging delle richieste
        if (this.config.logRequests) {
            this.app.use((req, res, next) => {
                const start = Date.now();
                
                // Funzione per loggare la risposta
                const logResponse = () => {
                    const duration = Date.now() - start;
                    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
                };
                
                // Intercetta il completamento della risposta
                res.on('finish', logResponse);
                
                next();
            });
        }
        
        // Middleware per l'autenticazione
        this.app.use(async (req, res, next) => {
            // Estrai il token dall'header Authorization
            const authHeader = req.headers.authorization;
            
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                // Nessun token, continua senza autenticazione
                return next();
            }
            
            const token = authHeader.split(' ')[1];
            
            try {
                // Verifica il token
                const userData = await this.auth.verifyToken(token);
                
                // Imposta i dati dell'utente nella richiesta
                req.user = userData;
                
                next();
            } catch (error) {
                // Token non valido, continua senza autenticazione
                next();
            }
        });
        
        // Aggiungi i middleware personalizzati
        for (const middleware of this.middlewares) {
            this.app.use(middleware);
        }
    }

    /**
     * Registra le rotte
     */
    _registerRoutes() {
        // Rotta di health check
        this.app.get('/health', (req, res) => {
            res.status(200).json({
                status: 'ok',
                timestamp: new Date().toISOString(),
            });
        });
        
        // Rotte di autenticazione
        this._registerAuthRoutes();
        
        // Rotte delle transazioni
        this._registerTransactionRoutes();
        
        // Rotte degli account
        this._registerAccountRoutes();
        
        // Rotte di amministrazione
        this._registerAdminRoutes();
        
        // Aggiungi le rotte personalizzate
        for (const route of this.routes) {
            const { method, path, handler, middleware = [] } = route;
            this.app[method.toLowerCase()](`${this.config.basePath}${path}`, ...middleware, handler);
        }
        
        // Gestione delle rotte non trovate
        this.app.use((req, res) => {
            res.status(404).json({
                status: 'error',
                code: 404,
                message: 'Risorsa non trovata',
            });
        });
    }

    /**
     * Registra le rotte di autenticazione
     */
    _registerAuthRoutes() {
        const authRouter = express.Router();
        
        /**
         * @swagger
         * /auth/register:
         *   post:
         *     summary: Registra un nuovo utente
         *     tags: [Auth]
         *     requestBody:
         *       required: true
         *       content:
         *         application/json:
         *           schema:
         *             type: object
         *             required:
         *               - username
         *               - password
         *             properties:
         *               username:
         *                 type: string
         *               password:
         *                 type: string
         *     responses:
         *       201:
         *         description: Utente registrato con successo
         *       400:
         *         description: Dati non validi
         *       409:
         *         description: Username già in uso
         */
        authRouter.post('/register', async (req, res) => {
            try {
                const { username, password } = req.body;
                
                if (!username || !password) {
                    return res.status(400).json({
                        status: 'error',
                        code: 400,
                        message: 'Username e password sono obbligatori',
                    });
                }
                
                // Registra l'utente
                const user = await this.auth.registerUser({
                    username,
                    password,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                });
                
                res.status(201).json({
                    status: 'success',
                    data: {
                        id: user.id,
                        username: user.username,
                        role: user.role,
                        createdAt: user.createdAt,
                    },
                });
            } catch (error) {
                if (error.message === 'Username già in uso') {
                    return res.status(409).json({
                        status: 'error',
                        code: 409,
                        message: error.message,
                    });
                }
                
                console.error('Errore durante la registrazione:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante la registrazione',
                });
            }
        });
        
        /**
         * @swagger
         * /auth/login:
         *   post:
         *     summary: Autentica un utente
         *     tags: [Auth]
         *     requestBody:
         *       required: true
         *       content:
         *         application/json:
         *           schema:
         *             type: object
         *             required:
         *               - username
         *               - password
         *             properties:
         *               username:
         *                 type: string
         *               password:
         *                 type: string
         *     responses:
         *       200:
         *         description: Login effettuato con successo
         *       400:
         *         description: Dati non validi
         *       401:
         *         description: Credenziali non valide
         */
        authRouter.post('/login', async (req, res) => {
            try {
                const { username, password } = req.body;
                
                if (!username || !password) {
                    return res.status(400).json({
                        status: 'error',
                        code: 400,
                        message: 'Username e password sono obbligatori',
                    });
                }
                
                // Autentica l'utente
                const result = await this.auth.login(username, password, {
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                });
                
                res.status(200).json({
                    status: 'success',
                    data: {
                        userId: result.userId,
                        username: result.username,
                        role: result.role,
                        token: result.token,
                        refreshToken: result.refreshToken,
                        expiresAt: result.expiresAt,
                    },
                });
            } catch (error) {
                if (error.message === 'Credenziali non valide' || error.message === 'Account disabilitato') {
                    return res.status(401).json({
                        status: 'error',
                        code: 401,
                        message: error.message,
                    });
                }
                
                console.error('Errore durante il login:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante il login',
                });
            }
        });
        
        /**
         * @swagger
         * /auth/refresh:
         *   post:
         *     summary: Aggiorna i token di autenticazione
         *     tags: [Auth]
         *     requestBody:
         *       required: true
         *       content:
         *         application/json:
         *           schema:
         *             type: object
         *             required:
         *               - refreshToken
         *             properties:
         *               refreshToken:
         *                 type: string
         *     responses:
         *       200:
         *         description: Token aggiornati con successo
         *       400:
         *         description: Dati non validi
         *       401:
         *         description: Refresh token non valido
         */
        authRouter.post('/refresh', async (req, res) => {
            try {
                const { refreshToken } = req.body;
                
                if (!refreshToken) {
                    return res.status(400).json({
                        status: 'error',
                        code: 400,
                        message: 'Refresh token obbligatorio',
                    });
                }
                
                // Aggiorna i token
                const result = await this.auth.refreshTokens(refreshToken, {
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                });
                
                res.status(200).json({
                    status: 'success',
                    data: {
                        userId: result.userId,
                        username: result.username,
                        role: result.role,
                        token: result.token,
                        refreshToken: result.refreshToken,
                        expiresAt: result.expiresAt,
                    },
                });
            } catch (error) {
                if (error.message === 'Refresh token non valido o scaduto' || error.message === 'Utente non trovato o disabilitato') {
                    return res.status(401).json({
                        status: 'error',
                        code: 401,
                        message: error.message,
                    });
                }
                
                console.error('Errore durante il refresh dei token:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante il refresh dei token',
                });
            }
        });
        
        /**
         * @swagger
         * /auth/logout:
         *   post:
         *     summary: Effettua il logout
         *     tags: [Auth]
         *     security:
         *       - bearerAuth: []
         *     responses:
         *       200:
         *         description: Logout effettuato con successo
         *       401:
         *         description: Non autenticato
         */
        authRouter.post('/logout', this._requireAuth(), async (req, res) => {
            try {
                // Estrai il token dall'header Authorization
                const authHeader = req.headers.authorization;
                const token = authHeader.split(' ')[1];
                
                // Revoca il token
                await this.auth.revokeToken(token);
                
                res.status(200).json({
                    status: 'success',
                    message: 'Logout effettuato con successo',
                });
            } catch (error) {
                console.error('Errore durante il logout:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante il logout',
                });
            }
        });
        
        /**
         * @swagger
         * /auth/change-password:
         *   post:
         *     summary: Cambia la password dell'utente
         *     tags: [Auth]
         *     security:
         *       - bearerAuth: []
         *     requestBody:
         *       required: true
         *       content:
         *         application/json:
         *           schema:
         *             type: object
         *             required:
         *               - currentPassword
         *               - newPassword
         *             properties:
         *               currentPassword:
         *                 type: string
         *               newPassword:
         *                 type: string
         *     responses:
         *       200:
         *         description: Password cambiata con successo
         *       400:
         *         description: Dati non validi
         *       401:
         *         description: Non autenticato o password attuale non valida
         */
        authRouter.post('/change-password', this._requireAuth(), async (req, res) => {
            try {
                const { currentPassword, newPassword } = req.body;
                
                if (!currentPassword || !newPassword) {
                    return res.status(400).json({
                        status: 'error',
                        code: 400,
                        message: 'Password attuale e nuova password sono obbligatorie',
                    });
                }
                
                // Cambia la password
                await this.auth.changePassword(req.user.userId, currentPassword, newPassword);
                
                res.status(200).json({
                    status: 'success',
                    message: 'Password cambiata con successo',
                });
            } catch (error) {
                if (error.message === 'Password attuale non valida') {
                    return res.status(401).json({
                        status: 'error',
                        code: 401,
                        message: error.message,
                    });
                }
                
                console.error('Errore durante il cambio password:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante il cambio password',
                });
            }
        });
        
        // Registra le rotte di autenticazione
        this.app.use(`${this.config.basePath}/auth`, authRouter);
    }

    /**
     * Registra le rotte delle transazioni
     */
    _registerTransactionRoutes() {
        const transactionRouter = express.Router();
        
        /**
         * @swagger
         * /transactions:
         *   get:
         *     summary: Ottiene le transazioni
         *     tags: [Transactions]
         *     security:
         *       - bearerAuth: []
         *     parameters:
         *       - in: query
         *         name: status
         *         schema:
         *           type: integer
         *         description: Filtra per stato
         *       - in: query
         *         name: limit
         *         schema:
         *           type: integer
         *         description: Numero massimo di risultati
         *       - in: query
         *         name: offset
         *         schema:
         *           type: integer
         *         description: Offset per la paginazione
         *     responses:
         *       200:
         *         description: Elenco delle transazioni
         *       401:
         *         description: Non autenticato
         *       403:
         *         description: Non autorizzato
         */
        transactionRouter.get('/', this._requireAuth(), async (req, res) => {
            try {
                // Verifica i permessi
                const canReadAny = await this.auth.hasPermission(req.user.userId, 'transactions:read:any');
                const canReadOwn = await this.auth.hasPermission(req.user.userId, 'transactions:read:own');
                
                if (!canReadAny && !canReadOwn) {
                    return res.status(403).json({
                        status: 'error',
                        code: 403,
                        message: 'Non autorizzato',
                    });
                }
                
                // Costruisci la query
                const query = new QueryBuilder('transactions');
                
                // Seleziona i campi
                query.select('id', 'sender', 'recipient', 'amount', 'nonce', 'expiry_timestamp', 'transaction_type', 'status', 'created_at', 'processed_at', 'batch_id');
                
                // Filtra per stato se specificato
                if (req.query.status !== undefined) {
                    query.whereEquals('status', parseInt(req.query.status));
                }
                
                // Se l'utente può leggere solo le proprie transazioni, filtra per sender
                if (!canReadAny && canReadOwn) {
                    query.whereEquals('sender', req.user.userId);
                }
                
                // Ordina per data di creazione (più recenti prima)
                query.orderByDesc('created_at');
                
                // Paginazione
                const limit = req.query.limit ? parseInt(req.query.limit) : 20;
                const offset = req.query.offset ? parseInt(req.query.offset) : 0;
                query.limit(limit);
                query.offset(offset);
                
                // Esegui la query
                const { sql, params } = query.build();
                const transactions = await this.db.queryRaw(sql, params);
                
                // Conta il totale
                const countQuery = new QueryBuilder('transactions');
                countQuery.count();
                
                // Filtra per stato se specificato
                if (req.query.status !== undefined) {
                    countQuery.whereEquals('status', parseInt(req.query.status));
                }
                
                // Se l'utente può leggere solo le proprie transazioni, filtra per sender
                if (!canReadAny && canReadOwn) {
                    countQuery.whereEquals('sender', req.user.userId);
                }
                
                const { sql: countSql, params: countParams } = countQuery.build();
                const countResult = await this.db.queryOneRaw(countSql, countParams);
                
                res.status(200).json({
                    status: 'success',
                    data: {
                        transactions,
                        pagination: {
                            total: countResult.count,
                            limit,
                            offset,
                        },
                    },
                });
            } catch (error) {
                console.error('Errore durante il recupero delle transazioni:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante il recupero delle transazioni',
                });
            }
        });
        
        /**
         * @swagger
         * /transactions/{id}:
         *   get:
         *     summary: Ottiene una transazione specifica
         *     tags: [Transactions]
         *     security:
         *       - bearerAuth: []
         *     parameters:
         *       - in: path
         *         name: id
         *         required: true
         *         schema:
         *           type: integer
         *         description: ID della transazione
         *     responses:
         *       200:
         *         description: Dettagli della transazione
         *       401:
         *         description: Non autenticato
         *       403:
         *         description: Non autorizzato
         *       404:
         *         description: Transazione non trovata
         */
        transactionRouter.get('/:id', this._requireAuth(), async (req, res) => {
            try {
                const transactionId = parseInt(req.params.id);
                
                // Recupera la transazione
                const transaction = await this.db.queryOneRaw('SELECT * FROM transactions WHERE id = ?', [transactionId]);
                
                if (!transaction) {
                    return res.status(404).json({
                        status: 'error',
                        code: 404,
                        message: 'Transazione non trovata',
                    });
                }
                
                // Verifica i permessi
                const canReadAny = await this.auth.hasPermission(req.user.userId, 'transactions:read:any');
                const canReadOwn = await this.auth.hasPermission(req.user.userId, 'transactions:read:own');
                
                // Se l'utente può leggere solo le proprie transazioni, verifica che sia il mittente
                if (!canReadAny && canReadOwn && transaction.sender !== req.user.userId) {
                    return res.status(403).json({
                        status: 'error',
                        code: 403,
                        message: 'Non autorizzato',
                    });
                }
                
                res.status(200).json({
                    status: 'success',
                    data: transaction,
                });
            } catch (error) {
                console.error('Errore durante il recupero della transazione:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante il recupero della transazione',
                });
            }
        });
        
        /**
         * @swagger
         * /transactions:
         *   post:
         *     summary: Crea una nuova transazione
         *     tags: [Transactions]
         *     security:
         *       - bearerAuth: []
         *     requestBody:
         *       required: true
         *       content:
         *         application/json:
         *           schema:
         *             type: object
         *             required:
         *               - recipient
         *               - amount
         *               - transaction_type
         *             properties:
         *               recipient:
         *                 type: string
         *               amount:
         *                 type: integer
         *               transaction_type:
         *                 type: integer
         *               data:
         *                 type: string
         *     responses:
         *       201:
         *         description: Transazione creata con successo
         *       400:
         *         description: Dati non validi
         *       401:
         *         description: Non autenticato
         *       403:
         *         description: Non autorizzato
         */
        transactionRouter.post('/', this._requireAuth(), async (req, res) => {
            try {
                // Verifica i permessi
                const canCreateAny = await this.auth.hasPermission(req.user.userId, 'transactions:create:any');
                const canCreateOwn = await this.auth.hasPermission(req.user.userId, 'transactions:create:own');
                
                if (!canCreateAny && !canCreateOwn) {
                    return res.status(403).json({
                        status: 'error',
                        code: 403,
                        message: 'Non autorizzato',
                    });
                }
                
                // Valida i dati
                const { recipient, amount, transaction_type, data } = req.body;
                
                if (!recipient || !amount || !transaction_type) {
                    return res.status(400).json({
                        status: 'error',
                        code: 400,
                        message: 'Destinatario, importo e tipo di transazione sono obbligatori',
                    });
                }
                
                // Recupera il nonce dell'utente
                const account = await this.db.queryOneRaw('SELECT nonce FROM accounts WHERE address = ?', [req.user.userId]);
                const nonce = account ? account.nonce + 1 : 0;
                
                // Crea la transazione
                const result = await this.db.execute('insertTransaction', [
                    req.user.userId, // sender
                    recipient,
                    amount,
                    nonce,
                    Date.now() + 3600000, // expiry_timestamp: 1 ora
                    transaction_type,
                    data || null,
                    null, // signature
                    0, // status: 0 = in sospeso
                    Date.now()
                ]);
                
                // Aggiorna il nonce dell'utente
                if (account) {
                    await this.db.execRaw('UPDATE accounts SET nonce = nonce + 1, last_updated = ? WHERE address = ?', [Date.now(), req.user.userId]);
                } else {
                    await this.db.execute('insertAccount', [req.user.userId, 0, 1, Date.now()]);
                }
                
                // Recupera la transazione creata
                const transaction = await this.db.queryOneRaw('SELECT * FROM transactions WHERE id = ?', [result.lastID]);
                
                res.status(201).json({
                    status: 'success',
                    data: transaction,
                });
            } catch (error) {
                console.error('Errore durante la creazione della transazione:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante la creazione della transazione',
                });
            }
        });
        
        // Registra le rotte delle transazioni
        this.app.use(`${this.config.basePath}/transactions`, transactionRouter);
    }

    /**
     * Registra le rotte degli account
     */
    _registerAccountRoutes() {
        const accountRouter = express.Router();
        
        /**
         * @swagger
         * /accounts/{address}:
         *   get:
         *     summary: Ottiene i dettagli di un account
         *     tags: [Accounts]
         *     security:
         *       - bearerAuth: []
         *     parameters:
         *       - in: path
         *         name: address
         *         required: true
         *         schema:
         *           type: string
         *         description: Indirizzo dell'account
         *     responses:
         *       200:
         *         description: Dettagli dell'account
         *       401:
         *         description: Non autenticato
         *       403:
         *         description: Non autorizzato
         *       404:
         *         description: Account non trovato
         */
        accountRouter.get('/:address', this._requireAuth(), async (req, res) => {
            try {
                const address = req.params.address;
                
                // Verifica i permessi
                const canReadAny = await this.auth.hasPermission(req.user.userId, 'accounts:read:any');
                const canReadOwn = await this.auth.hasPermission(req.user.userId, 'accounts:read:own');
                
                // Se l'utente può leggere solo i propri account, verifica che sia il proprietario
                if (!canReadAny && canReadOwn && address !== req.user.userId) {
                    return res.status(403).json({
                        status: 'error',
                        code: 403,
                        message: 'Non autorizzato',
                    });
                }
                
                // Recupera l'account
                const account = await this.db.queryOne('getAccountByAddress', [address]);
                
                if (!account) {
                    return res.status(404).json({
                        status: 'error',
                        code: 404,
                        message: 'Account non trovato',
                    });
                }
                
                res.status(200).json({
                    status: 'success',
                    data: account,
                });
            } catch (error) {
                console.error('Errore durante il recupero dell\'account:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante il recupero dell\'account',
                });
            }
        });
        
        /**
         * @swagger
         * /accounts/{address}/transactions:
         *   get:
         *     summary: Ottiene le transazioni di un account
         *     tags: [Accounts]
         *     security:
         *       - bearerAuth: []
         *     parameters:
         *       - in: path
         *         name: address
         *         required: true
         *         schema:
         *           type: string
         *         description: Indirizzo dell'account
         *       - in: query
         *         name: limit
         *         schema:
         *           type: integer
         *         description: Numero massimo di risultati
         *       - in: query
         *         name: offset
         *         schema:
         *           type: integer
         *         description: Offset per la paginazione
         *     responses:
         *       200:
         *         description: Elenco delle transazioni dell'account
         *       401:
         *         description: Non autenticato
         *       403:
         *         description: Non autorizzato
         */
        accountRouter.get('/:address/transactions', this._requireAuth(), async (req, res) => {
            try {
                const address = req.params.address;
                
                // Verifica i permessi
                const canReadAny = await this.auth.hasPermission(req.user.userId, 'accounts:read:any');
                const canReadOwn = await this.auth.hasPermission(req.user.userId, 'accounts:read:own');
                
                // Se l'utente può leggere solo i propri account, verifica che sia il proprietario
                if (!canReadAny && canReadOwn && address !== req.user.userId) {
                    return res.status(403).json({
                        status: 'error',
                        code: 403,
                        message: 'Non autorizzato',
                    });
                }
                
                // Costruisci la query
                const query = new QueryBuilder('transactions');
                
                // Seleziona i campi
                query.select('id', 'sender', 'recipient', 'amount', 'nonce', 'expiry_timestamp', 'transaction_type', 'status', 'created_at', 'processed_at', 'batch_id');
                
                // Filtra per indirizzo (mittente o destinatario)
                query.whereOr(q => {
                    q.whereEquals('sender', address);
                    q.whereEquals('recipient', address);
                });
                
                // Ordina per data di creazione (più recenti prima)
                query.orderByDesc('created_at');
                
                // Paginazione
                const limit = req.query.limit ? parseInt(req.query.limit) : 20;
                const offset = req.query.offset ? parseInt(req.query.offset) : 0;
                query.limit(limit);
                query.offset(offset);
                
                // Esegui la query
                const { sql, params } = query.build();
                const transactions = await this.db.queryRaw(sql, params);
                
                // Conta il totale
                const countQuery = new QueryBuilder('transactions');
                countQuery.count();
                
                // Filtra per indirizzo (mittente o destinatario)
                countQuery.whereOr(q => {
                    q.whereEquals('sender', address);
                    q.whereEquals('recipient', address);
                });
                
                const { sql: countSql, params: countParams } = countQuery.build();
                const countResult = await this.db.queryOneRaw(countSql, countParams);
                
                res.status(200).json({
                    status: 'success',
                    data: {
                        transactions,
                        pagination: {
                            total: countResult.count,
                            limit,
                            offset,
                        },
                    },
                });
            } catch (error) {
                console.error('Errore durante il recupero delle transazioni dell\'account:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante il recupero delle transazioni dell\'account',
                });
            }
        });
        
        // Registra le rotte degli account
        this.app.use(`${this.config.basePath}/accounts`, accountRouter);
    }

    /**
     * Registra le rotte di amministrazione
     */
    _registerAdminRoutes() {
        const adminRouter = express.Router();
        
        /**
         * @swagger
         * /admin/users:
         *   get:
         *     summary: Ottiene l'elenco degli utenti
         *     tags: [Admin]
         *     security:
         *       - bearerAuth: []
         *     parameters:
         *       - in: query
         *         name: limit
         *         schema:
         *           type: integer
         *         description: Numero massimo di risultati
         *       - in: query
         *         name: offset
         *         schema:
         *           type: integer
         *         description: Offset per la paginazione
         *     responses:
         *       200:
         *         description: Elenco degli utenti
         *       401:
         *         description: Non autenticato
         *       403:
         *         description: Non autorizzato
         */
        adminRouter.get('/users', this._requireAuth(), this._requirePermission('users:read:any'), async (req, res) => {
            try {
                // Costruisci la query
                const query = new QueryBuilder('users');
                
                // Seleziona i campi (escludi password_hash e salt)
                query.select('id', 'username', 'role', 'attributes', 'created_at', 'last_login', 'status');
                
                // Ordina per data di creazione (più recenti prima)
                query.orderByDesc('created_at');
                
                // Paginazione
                const limit = req.query.limit ? parseInt(req.query.limit) : 20;
                const offset = req.query.offset ? parseInt(req.query.offset) : 0;
                query.limit(limit);
                query.offset(offset);
                
                // Esegui la query
                const { sql, params } = query.build();
                const users = await this.db.queryRaw(sql, params);
                
                // Conta il totale
                const countQuery = new QueryBuilder('users');
                countQuery.count();
                
                const { sql: countSql, params: countParams } = countQuery.build();
                const countResult = await this.db.queryOneRaw(countSql, countParams);
                
                res.status(200).json({
                    status: 'success',
                    data: {
                        users,
                        pagination: {
                            total: countResult.count,
                            limit,
                            offset,
                        },
                    },
                });
            } catch (error) {
                console.error('Errore durante il recupero degli utenti:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante il recupero degli utenti',
                });
            }
        });
        
        /**
         * @swagger
         * /admin/users/{id}:
         *   get:
         *     summary: Ottiene i dettagli di un utente
         *     tags: [Admin]
         *     security:
         *       - bearerAuth: []
         *     parameters:
         *       - in: path
         *         name: id
         *         required: true
         *         schema:
         *           type: string
         *         description: ID dell'utente
         *     responses:
         *       200:
         *         description: Dettagli dell'utente
         *       401:
         *         description: Non autenticato
         *       403:
         *         description: Non autorizzato
         *       404:
         *         description: Utente non trovato
         */
        adminRouter.get('/users/:id', this._requireAuth(), this._requirePermission('users:read:any'), async (req, res) => {
            try {
                const userId = req.params.id;
                
                // Recupera l'utente
                const user = await this.db.queryOne('auth_getUserById', [userId]);
                
                if (!user) {
                    return res.status(404).json({
                        status: 'error',
                        code: 404,
                        message: 'Utente non trovato',
                    });
                }
                
                // Rimuovi i campi sensibili
                delete user.password_hash;
                delete user.salt;
                
                res.status(200).json({
                    status: 'success',
                    data: user,
                });
            } catch (error) {
                console.error('Errore durante il recupero dell\'utente:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante il recupero dell\'utente',
                });
            }
        });
        
        /**
         * @swagger
         * /admin/users/{id}/role:
         *   put:
         *     summary: Aggiorna il ruolo di un utente
         *     tags: [Admin]
         *     security:
         *       - bearerAuth: []
         *     parameters:
         *       - in: path
         *         name: id
         *         required: true
         *         schema:
         *           type: string
         *         description: ID dell'utente
         *     requestBody:
         *       required: true
         *       content:
         *         application/json:
         *           schema:
         *             type: object
         *             required:
         *               - role
         *             properties:
         *               role:
         *                 type: string
         *     responses:
         *       200:
         *         description: Ruolo aggiornato con successo
         *       400:
         *         description: Dati non validi
         *       401:
         *         description: Non autenticato
         *       403:
         *         description: Non autorizzato
         *       404:
         *         description: Utente non trovato
         */
        adminRouter.put('/users/:id/role', this._requireAuth(), this._requirePermission('users:update:any'), async (req, res) => {
            try {
                const userId = req.params.id;
                const { role } = req.body;
                
                if (!role) {
                    return res.status(400).json({
                        status: 'error',
                        code: 400,
                        message: 'Ruolo obbligatorio',
                    });
                }
                
                // Recupera l'utente
                const user = await this.db.queryOne('auth_getUserById', [userId]);
                
                if (!user) {
                    return res.status(404).json({
                        status: 'error',
                        code: 404,
                        message: 'Utente non trovato',
                    });
                }
                
                // Aggiorna il ruolo
                await this.auth.updateUserRole(userId, role);
                
                res.status(200).json({
                    status: 'success',
                    message: 'Ruolo aggiornato con successo',
                });
            } catch (error) {
                console.error('Errore durante l\'aggiornamento del ruolo:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante l\'aggiornamento del ruolo',
                });
            }
        });
        
        /**
         * @swagger
         * /admin/users/{id}/status:
         *   put:
         *     summary: Aggiorna lo stato di un utente
         *     tags: [Admin]
         *     security:
         *       - bearerAuth: []
         *     parameters:
         *       - in: path
         *         name: id
         *         required: true
         *         schema:
         *           type: string
         *         description: ID dell'utente
         *     requestBody:
         *       required: true
         *       content:
         *         application/json:
         *           schema:
         *             type: object
         *             required:
         *               - status
         *             properties:
         *               status:
         *                 type: integer
         *     responses:
         *       200:
         *         description: Stato aggiornato con successo
         *       400:
         *         description: Dati non validi
         *       401:
         *         description: Non autenticato
         *       403:
         *         description: Non autorizzato
         *       404:
         *         description: Utente non trovato
         */
        adminRouter.put('/users/:id/status', this._requireAuth(), this._requirePermission('users:update:any'), async (req, res) => {
            try {
                const userId = req.params.id;
                const { status } = req.body;
                
                if (status === undefined) {
                    return res.status(400).json({
                        status: 'error',
                        code: 400,
                        message: 'Stato obbligatorio',
                    });
                }
                
                // Recupera l'utente
                const user = await this.db.queryOne('auth_getUserById', [userId]);
                
                if (!user) {
                    return res.status(404).json({
                        status: 'error',
                        code: 404,
                        message: 'Utente non trovato',
                    });
                }
                
                // Aggiorna lo stato
                await this.db.execute('auth_updateUserStatus', [status, userId]);
                
                // Se lo stato è disabilitato, revoca tutti i token dell'utente
                if (status === 0) {
                    await this.auth.revokeAllUserTokens(userId);
                }
                
                res.status(200).json({
                    status: 'success',
                    message: 'Stato aggiornato con successo',
                });
            } catch (error) {
                console.error('Errore durante l\'aggiornamento dello stato:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante l\'aggiornamento dello stato',
                });
            }
        });
        
        /**
         * @swagger
         * /admin/users/{id}/reset-password:
         *   post:
         *     summary: Reimposta la password di un utente
         *     tags: [Admin]
         *     security:
         *       - bearerAuth: []
         *     parameters:
         *       - in: path
         *         name: id
         *         required: true
         *         schema:
         *           type: string
         *         description: ID dell'utente
         *     requestBody:
         *       required: true
         *       content:
         *         application/json:
         *           schema:
         *             type: object
         *             required:
         *               - newPassword
         *             properties:
         *               newPassword:
         *                 type: string
         *     responses:
         *       200:
         *         description: Password reimpostata con successo
         *       400:
         *         description: Dati non validi
         *       401:
         *         description: Non autenticato
         *       403:
         *         description: Non autorizzato
         *       404:
         *         description: Utente non trovato
         */
        adminRouter.post('/users/:id/reset-password', this._requireAuth(), this._requirePermission('users:update:any'), async (req, res) => {
            try {
                const userId = req.params.id;
                const { newPassword } = req.body;
                
                if (!newPassword) {
                    return res.status(400).json({
                        status: 'error',
                        code: 400,
                        message: 'Nuova password obbligatoria',
                    });
                }
                
                // Recupera l'utente
                const user = await this.db.queryOne('auth_getUserById', [userId]);
                
                if (!user) {
                    return res.status(404).json({
                        status: 'error',
                        code: 404,
                        message: 'Utente non trovato',
                    });
                }
                
                // Reimposta la password
                await this.auth.resetPassword(userId, newPassword);
                
                res.status(200).json({
                    status: 'success',
                    message: 'Password reimpostata con successo',
                });
            } catch (error) {
                console.error('Errore durante la reimpostazione della password:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante la reimpostazione della password',
                });
            }
        });
        
        /**
         * @swagger
         * /admin/roles:
         *   get:
         *     summary: Ottiene l'elenco dei ruoli
         *     tags: [Admin]
         *     security:
         *       - bearerAuth: []
         *     responses:
         *       200:
         *         description: Elenco dei ruoli
         *       401:
         *         description: Non autenticato
         *       403:
         *         description: Non autorizzato
         */
        adminRouter.get('/roles', this._requireAuth(), this._requirePermission('roles:read:any'), async (req, res) => {
            try {
                // Costruisci la query
                const query = new QueryBuilder('roles');
                
                // Seleziona i campi
                query.select('id', 'name', 'permissions', 'created_at', 'updated_at');
                
                // Ordina per nome
                query.orderBy('name');
                
                // Esegui la query
                const { sql, params } = query.build();
                const roles = await this.db.queryRaw(sql, params);
                
                // Converti le permissions da JSON a array
                for (const role of roles) {
                    role.permissions = JSON.parse(role.permissions);
                }
                
                res.status(200).json({
                    status: 'success',
                    data: roles,
                });
            } catch (error) {
                console.error('Errore durante il recupero dei ruoli:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante il recupero dei ruoli',
                });
            }
        });
        
        /**
         * @swagger
         * /admin/audit-log:
         *   get:
         *     summary: Ottiene il log di audit
         *     tags: [Admin]
         *     security:
         *       - bearerAuth: []
         *     parameters:
         *       - in: query
         *         name: user_id
         *         schema:
         *           type: string
         *         description: Filtra per ID utente
         *       - in: query
         *         name: action
         *         schema:
         *           type: string
         *         description: Filtra per azione
         *       - in: query
         *         name: limit
         *         schema:
         *           type: integer
         *         description: Numero massimo di risultati
         *       - in: query
         *         name: offset
         *         schema:
         *           type: integer
         *         description: Offset per la paginazione
         *     responses:
         *       200:
         *         description: Log di audit
         *       401:
         *         description: Non autenticato
         *       403:
         *         description: Non autorizzato
         */
        adminRouter.get('/audit-log', this._requireAuth(), this._requirePermission('audit:read:any'), async (req, res) => {
            try {
                // Costruisci la query
                const query = new QueryBuilder('audit_log');
                
                // Seleziona i campi
                query.select('id', 'user_id', 'action', 'resource', 'details', 'ip_address', 'user_agent', 'created_at');
                
                // Filtra per ID utente se specificato
                if (req.query.user_id) {
                    query.whereEquals('user_id', req.query.user_id);
                }
                
                // Filtra per azione se specificata
                if (req.query.action) {
                    query.whereEquals('action', req.query.action);
                }
                
                // Ordina per data di creazione (più recenti prima)
                query.orderByDesc('created_at');
                
                // Paginazione
                const limit = req.query.limit ? parseInt(req.query.limit) : 20;
                const offset = req.query.offset ? parseInt(req.query.offset) : 0;
                query.limit(limit);
                query.offset(offset);
                
                // Esegui la query
                const { sql, params } = query.build();
                const auditLog = await this.db.queryRaw(sql, params);
                
                // Conta il totale
                const countQuery = new QueryBuilder('audit_log');
                countQuery.count();
                
                // Filtra per ID utente se specificato
                if (req.query.user_id) {
                    countQuery.whereEquals('user_id', req.query.user_id);
                }
                
                // Filtra per azione se specificata
                if (req.query.action) {
                    countQuery.whereEquals('action', req.query.action);
                }
                
                const { sql: countSql, params: countParams } = countQuery.build();
                const countResult = await this.db.queryOneRaw(countSql, countParams);
                
                // Converti i dettagli da JSON a oggetto
                for (const log of auditLog) {
                    if (log.details) {
                        log.details = JSON.parse(log.details);
                    }
                }
                
                res.status(200).json({
                    status: 'success',
                    data: {
                        auditLog,
                        pagination: {
                            total: countResult.count,
                            limit,
                            offset,
                        },
                    },
                });
            } catch (error) {
                console.error('Errore durante il recupero del log di audit:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante il recupero del log di audit',
                });
            }
        });
        
        // Registra le rotte di amministrazione
        this.app.use(`${this.config.basePath}/admin`, adminRouter);
    }

    /**
     * Registra i gestori di errori
     */
    _registerErrorHandlers() {
        // Gestore per gli errori di sintassi JSON
        this.app.use((err, req, res, next) => {
            if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
                return res.status(400).json({
                    status: 'error',
                    code: 400,
                    message: 'JSON non valido',
                });
            }
            
            next(err);
        });
        
        // Gestore per gli errori generici
        this.app.use((err, req, res, next) => {
            if (this.config.logErrors) {
                console.error('Errore non gestito:', err);
            }
            
            res.status(500).json({
                status: 'error',
                code: 500,
                message: 'Errore interno del server',
            });
        });
        
        // Aggiungi i gestori di errori personalizzati
        for (const errorHandler of this.errorHandlers) {
            this.app.use(errorHandler);
        }
    }

    /**
     * Middleware per richiedere l'autenticazione
     * @returns {Function} Middleware
     */
    _requireAuth() {
        return (req, res, next) => {
            if (!req.user) {
                return res.status(401).json({
                    status: 'error',
                    code: 401,
                    message: 'Non autenticato',
                });
            }
            
            next();
        };
    }

    /**
     * Middleware per richiedere un permesso specifico
     * @param {string} permission - Il permesso richiesto
     * @returns {Function} Middleware
     */
    _requirePermission(permission) {
        return async (req, res, next) => {
            try {
                if (!req.user) {
                    return res.status(401).json({
                        status: 'error',
                        code: 401,
                        message: 'Non autenticato',
                    });
                }
                
                const hasPermission = await this.auth.hasPermission(req.user.userId, permission);
                
                if (!hasPermission) {
                    return res.status(403).json({
                        status: 'error',
                        code: 403,
                        message: 'Non autorizzato',
                    });
                }
                
                next();
            } catch (error) {
                console.error('Errore durante la verifica del permesso:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante la verifica del permesso',
                });
            }
        };
    }

    /**
     * Middleware per richiedere l'accesso a una risorsa
     * @param {string} resource - La risorsa
     * @param {string} action - L'azione
     * @returns {Function} Middleware
     */
    _requireAccess(resource, action) {
        return async (req, res, next) => {
            try {
                if (!req.user) {
                    return res.status(401).json({
                        status: 'error',
                        code: 401,
                        message: 'Non autenticato',
                    });
                }
                
                // Determina l'ID della risorsa
                let resourceOwnerId = null;
                
                // Se la risorsa è nella richiesta, estrai l'ID
                if (req.params.id) {
                    // Recupera la risorsa dal database
                    const resourceData = await this._getResourceOwner(resource, req.params.id);
                    
                    if (resourceData) {
                        resourceOwnerId = resourceData.owner;
                    }
                }
                
                const canAccess = await this.auth.canAccess(req.user.userId, resource, action, {
                    resourceOwnerId,
                });
                
                if (!canAccess) {
                    return res.status(403).json({
                        status: 'error',
                        code: 403,
                        message: 'Non autorizzato',
                    });
                }
                
                next();
            } catch (error) {
                console.error('Errore durante la verifica dell\'accesso:', error);
                
                res.status(500).json({
                    status: 'error',
                    code: 500,
                    message: 'Errore durante la verifica dell\'accesso',
                });
            }
        };
    }

    /**
     * Ottiene il proprietario di una risorsa
     * @param {string} resource - Il tipo di risorsa
     * @param {string} id - L'ID della risorsa
     * @returns {Promise<Object>} Il proprietario della risorsa
     */
    async _getResourceOwner(resource, id) {
        try {
            let query;
            
            switch (resource) {
                case 'transactions':
                    query = 'SELECT sender as owner FROM transactions WHERE id = ?';
                    break;
                case 'accounts':
                    query = 'SELECT address as owner FROM accounts WHERE address = ?';
                    break;
                case 'users':
                    query = 'SELECT id as owner FROM users WHERE id = ?';
                    break;
                default:
                    return null;
            }
            
            return await this.db.queryOneRaw(query, [id]);
        } catch (error) {
            console.error('Errore durante il recupero del proprietario della risorsa:', error);
            return null;
        }
    }

    /**
     * Aggiunge un middleware personalizzato
     * @param {Function} middleware - Il middleware da aggiungere
     * @returns {ApiGateway} L'istanza corrente per il chaining
     */
    addMiddleware(middleware) {
        this.middlewares.push(middleware);
        return this;
    }

    /**
     * Aggiunge una rotta personalizzata
     * @param {string} method - Il metodo HTTP (GET, POST, PUT, DELETE)
     * @param {string} path - Il percorso della rotta
     * @param {Function} handler - Il gestore della rotta
     * @param {Array} middleware - I middleware da applicare alla rotta
     * @returns {ApiGateway} L'istanza corrente per il chaining
     */
    addRoute(method, path, handler, middleware = []) {
        this.routes.push({
            method,
            path,
            handler,
            middleware,
        });
        return this;
    }

    /**
     * Aggiunge un gestore di errori personalizzato
     * @param {Function} errorHandler - Il gestore di errori da aggiungere
     * @returns {ApiGateway} L'istanza corrente per il chaining
     */
    addErrorHandler(errorHandler) {
        this.errorHandlers.push(errorHandler);
        return this;
    }

    /**
     * Avvia il server
     * @returns {Promise<Object>} Il server HTTP
     */
    async start() {
        return new Promise((resolve, reject) => {
            try {
                this.server = this.app.listen(this.config.port, this.config.host, () => {
                    console.log(`API Gateway in ascolto su ${this.config.host}:${this.config.port}`);
                    resolve(this.server);
                });
            } catch (error) {
                console.error('Errore durante l\'avvio del server:', error);
                reject(error);
            }
        });
    }

    /**
     * Ferma il server
     * @returns {Promise<boolean>} True se il server è stato fermato con successo
     */
    async stop() {
        return new Promise((resolve, reject) => {
            try {
                if (!this.server) {
                    console.log('Il server non è in esecuzione');
                    return resolve(true);
                }
                
                this.server.close(async (err) => {
                    if (err) {
                        console.error('Errore durante l\'arresto del server:', err);
                        return reject(err);
                    }
                    
                    // Chiudi l'auth manager
                    if (this.auth) {
                        this.auth.close();
                        this.auth = null;
                    }
                    
                    // Chiudi il database manager
                    if (this.db) {
                        await this.db.close();
                        this.db = null;
                    }
                    
                    this.server = null;
                    console.log('Server fermato con successo');
                    resolve(true);
                });
            } catch (error) {
                console.error('Errore durante l\'arresto del server:', error);
                reject(error);
            }
        });
    }
}

module.exports = ApiGateway;
