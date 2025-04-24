/**
 * Auth Manager per il Layer-2 su Solana
 * 
 * Questo modulo implementa un sistema di autorizzazione a più livelli con supporto per
 * JWT con rotazione dei token, RBAC (Role-Based Access Control) e 
 * ABAC (Attribute-Based Access Control).
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

/**
 * Classe AuthManager
 * 
 * Gestisce l'autenticazione e l'autorizzazione degli utenti
 * con supporto per JWT, RBAC e ABAC.
 */
class AuthManager {
    /**
     * Costruttore
     * @param {Object} options - Opzioni di configurazione
     * @param {Object} databaseManager - Istanza di DatabaseManager
     */
    constructor(options = {}, databaseManager) {
        this.config = {
            jwtSecret: options.jwtSecret || process.env.JWT_SECRET || this._generateRandomSecret(),
            jwtRefreshSecret: options.jwtRefreshSecret || process.env.JWT_REFRESH_SECRET || this._generateRandomSecret(),
            jwtExpiresIn: options.jwtExpiresIn || process.env.JWT_EXPIRES_IN || '1h',
            jwtRefreshExpiresIn: options.jwtRefreshExpiresIn || process.env.JWT_REFRESH_EXPIRES_IN || '7d',
            jwtIssuer: options.jwtIssuer || process.env.JWT_ISSUER || 'layer2-solana',
            jwtAudience: options.jwtAudience || process.env.JWT_AUDIENCE || 'layer2-solana-api',
            bcryptSaltRounds: options.bcryptSaltRounds || parseInt(process.env.BCRYPT_SALT_ROUNDS || '10'),
            tokenRotationEnabled: options.tokenRotationEnabled !== undefined ? options.tokenRotationEnabled : true,
            tokenRotationInterval: options.tokenRotationInterval || parseInt(process.env.TOKEN_ROTATION_INTERVAL || '3600000'), // 1 ora
            tokenBlacklistEnabled: options.tokenBlacklistEnabled !== undefined ? options.tokenBlacklistEnabled : true,
            tokenBlacklistTTL: options.tokenBlacklistTTL || parseInt(process.env.TOKEN_BLACKLIST_TTL || '86400000'), // 24 ore
            rbacEnabled: options.rbacEnabled !== undefined ? options.rbacEnabled : true,
            abacEnabled: options.abacEnabled !== undefined ? options.abacEnabled : true,
            defaultRole: options.defaultRole || 'user',
            superAdminRole: options.superAdminRole || 'superadmin',
            logAuthEvents: options.logAuthEvents !== undefined ? options.logAuthEvents : true,
        };
        
        this.db = databaseManager;
        this.tokenBlacklist = new Map();
        this.roleCache = new Map();
        this.permissionCache = new Map();
        
        // Intervallo per la pulizia della blacklist
        if (this.config.tokenBlacklistEnabled) {
            this.blacklistCleanupInterval = setInterval(() => {
                this._cleanupTokenBlacklist();
            }, 3600000); // Ogni ora
        }
        
        // Intervallo per la rotazione dei segreti JWT
        if (this.config.tokenRotationEnabled) {
            this.tokenRotationInterval = setInterval(() => {
                this._rotateJwtSecrets();
            }, this.config.tokenRotationInterval);
        }
        
        // Mantieni i vecchi segreti per un periodo di grazia
        this.oldSecrets = [];
    }

    /**
     * Inizializza l'auth manager
     * @returns {Promise<boolean>} True se l'inizializzazione è riuscita
     */
    async initialize() {
        try {
            if (!this.db || !this.db.isInitialized) {
                throw new Error('DatabaseManager non è inizializzato');
            }
            
            // Prepara gli statement SQL necessari
            await this._prepareStatements();
            
            // Inizializza i ruoli predefiniti
            await this._initializeDefaultRoles();
            
            console.log('AuthManager inizializzato con successo');
            return true;
        } catch (error) {
            console.error('Errore durante l\'inizializzazione dell\'AuthManager:', error);
            throw error;
        }
    }

    /**
     * Prepara gli statement SQL necessari
     * @returns {Promise<boolean>} True se la preparazione è riuscita
     */
    async _prepareStatements() {
        try {
            // Prepared statements per gli utenti
            await this.db.prepareStatement(
                'auth_getUserById',
                'SELECT * FROM users WHERE id = ?'
            );
            
            await this.db.prepareStatement(
                'auth_getUserByUsername',
                'SELECT * FROM users WHERE username = ?'
            );
            
            await this.db.prepareStatement(
                'auth_createUser',
                'INSERT INTO users (id, username, password_hash, salt, role, attributes, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            );
            
            await this.db.prepareStatement(
                'auth_updateUserPassword',
                'UPDATE users SET password_hash = ?, salt = ? WHERE id = ?'
            );
            
            await this.db.prepareStatement(
                'auth_updateUserRole',
                'UPDATE users SET role = ? WHERE id = ?'
            );
            
            await this.db.prepareStatement(
                'auth_updateUserStatus',
                'UPDATE users SET status = ? WHERE id = ?'
            );
            
            await this.db.prepareStatement(
                'auth_updateUserLastLogin',
                'UPDATE users SET last_login = ? WHERE id = ?'
            );
            
            // Prepared statements per i token
            await this.db.prepareStatement(
                'auth_createToken',
                'INSERT INTO auth_tokens (user_id, token, refresh_token, scope, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
            );
            
            await this.db.prepareStatement(
                'auth_getTokenByToken',
                'SELECT * FROM auth_tokens WHERE token = ? AND revoked = 0 AND expires_at > ?'
            );
            
            await this.db.prepareStatement(
                'auth_getTokenByRefreshToken',
                'SELECT * FROM auth_tokens WHERE refresh_token = ? AND revoked = 0 AND expires_at > ?'
            );
            
            await this.db.prepareStatement(
                'auth_revokeToken',
                'UPDATE auth_tokens SET revoked = 1 WHERE token = ?'
            );
            
            await this.db.prepareStatement(
                'auth_revokeAllUserTokens',
                'UPDATE auth_tokens SET revoked = 1 WHERE user_id = ?'
            );
            
            await this.db.prepareStatement(
                'auth_updateTokenLastUsed',
                'UPDATE auth_tokens SET last_used_at = ? WHERE token = ?'
            );
            
            // Prepared statements per i ruoli
            await this.db.prepareStatement(
                'auth_getRoleById',
                'SELECT * FROM roles WHERE id = ?'
            );
            
            await this.db.prepareStatement(
                'auth_getRoleByName',
                'SELECT * FROM roles WHERE name = ?'
            );
            
            await this.db.prepareStatement(
                'auth_createRole',
                'INSERT INTO roles (id, name, permissions, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
            );
            
            await this.db.prepareStatement(
                'auth_updateRolePermissions',
                'UPDATE roles SET permissions = ?, updated_at = ? WHERE id = ?'
            );
            
            // Prepared statements per l'audit log
            await this.db.prepareStatement(
                'auth_createAuditLog',
                'INSERT INTO audit_log (user_id, action, resource, details, ip_address, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
            );
            
            await this.db.prepareStatement(
                'auth_getAuditLogByUserId',
                'SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
            );
            
            return true;
        } catch (error) {
            console.error('Errore durante la preparazione degli statement SQL:', error);
            throw error;
        }
    }

    /**
     * Inizializza i ruoli predefiniti
     * @returns {Promise<boolean>} True se l'inizializzazione è riuscita
     */
    async _initializeDefaultRoles() {
        try {
            // Definisci i ruoli predefiniti
            const defaultRoles = [
                {
                    id: 'user',
                    name: 'User',
                    permissions: [
                        'transactions:read:own',
                        'transactions:create:own',
                        'accounts:read:own',
                    ]
                },
                {
                    id: 'admin',
                    name: 'Administrator',
                    permissions: [
                        'transactions:read:any',
                        'transactions:create:any',
                        'transactions:update:any',
                        'accounts:read:any',
                        'accounts:update:any',
                        'users:read:any',
                        'users:create:any',
                        'users:update:any',
                        'roles:read:any',
                    ]
                },
                {
                    id: 'superadmin',
                    name: 'Super Administrator',
                    permissions: [
                        '*' // Tutti i permessi
                    ]
                }
            ];
            
            // Crea o aggiorna i ruoli predefiniti
            for (const role of defaultRoles) {
                // Verifica se il ruolo esiste già
                const existingRole = await this.db.queryOne('auth_getRoleById', [role.id]);
                
                if (!existingRole) {
                    // Crea il ruolo
                    await this.db.execute('auth_createRole', [
                        role.id,
                        role.name,
                        JSON.stringify(role.permissions),
                        Date.now(),
                        Date.now()
                    ]);
                    
                    console.log(`Ruolo creato: ${role.name}`);
                } else {
                    // Aggiorna il ruolo solo se necessario
                    const currentPermissions = JSON.parse(existingRole.permissions);
                    const newPermissions = role.permissions;
                    
                    // Verifica se i permessi sono cambiati
                    if (JSON.stringify(currentPermissions) !== JSON.stringify(newPermissions)) {
                        await this.db.execute('auth_updateRolePermissions', [
                            JSON.stringify(newPermissions),
                            Date.now(),
                            role.id
                        ]);
                        
                        console.log(`Ruolo aggiornato: ${role.name}`);
                    }
                }
                
                // Aggiungi il ruolo alla cache
                this.roleCache.set(role.id, {
                    id: role.id,
                    name: role.name,
                    permissions: role.permissions
                });
            }
            
            return true;
        } catch (error) {
            console.error('Errore durante l\'inizializzazione dei ruoli predefiniti:', error);
            throw error;
        }
    }

    /**
     * Registra un nuovo utente
     * @param {Object} userData - I dati dell'utente
     * @returns {Promise<Object>} L'utente creato
     */
    async registerUser(userData) {
        try {
            // Valida i dati dell'utente
            if (!userData.username || !userData.password) {
                throw new Error('Username e password sono obbligatori');
            }
            
            // Verifica se l'utente esiste già
            const existingUser = await this.db.queryOne('auth_getUserByUsername', [userData.username]);
            
            if (existingUser) {
                throw new Error('Username già in uso');
            }
            
            // Genera salt e hash della password
            const salt = await bcrypt.genSalt(this.config.bcryptSaltRounds);
            const passwordHash = await bcrypt.hash(userData.password, salt);
            
            // Genera ID utente
            const userId = userData.id || uuidv4();
            
            // Determina il ruolo
            const role = userData.role || this.config.defaultRole;
            
            // Prepara gli attributi
            const attributes = userData.attributes ? JSON.stringify(userData.attributes) : null;
            
            // Crea l'utente
            await this.db.execute('auth_createUser', [
                userId,
                userData.username,
                passwordHash,
                salt,
                role,
                attributes,
                Date.now(),
                1 // status: 1 = attivo
            ]);
            
            // Registra l'evento di audit
            if (this.config.logAuthEvents) {
                await this.logAuditEvent({
                    userId: null, // Nessun utente autenticato
                    action: 'USER_REGISTER',
                    resource: `users/${userId}`,
                    details: { username: userData.username, role },
                    ipAddress: userData.ipAddress,
                    userAgent: userData.userAgent
                });
            }
            
            // Restituisci l'utente creato (senza password)
            return {
                id: userId,
                username: userData.username,
                role,
                attributes: userData.attributes || {},
                createdAt: Date.now(),
                status: 1
            };
        } catch (error) {
            console.error('Errore durante la registrazione dell\'utente:', error);
            throw error;
        }
    }

    /**
     * Autentica un utente
     * @param {string} username - Il nome utente
     * @param {string} password - La password
     * @param {Object} options - Opzioni aggiuntive
     * @returns {Promise<Object>} I token di autenticazione
     */
    async login(username, password, options = {}) {
        try {
            // Recupera l'utente
            const user = await this.db.queryOne('auth_getUserByUsername', [username]);
            
            if (!user) {
                throw new Error('Credenziali non valide');
            }
            
            // Verifica che l'utente sia attivo
            if (user.status !== 1) {
                throw new Error('Account disabilitato');
            }
            
            // Verifica la password
            const passwordMatch = await bcrypt.compare(password, user.password_hash);
            
            if (!passwordMatch) {
                throw new Error('Credenziali non valide');
            }
            
            // Aggiorna l'ultimo accesso
            await this.db.execute('auth_updateUserLastLogin', [Date.now(), user.id]);
            
            // Genera i token
            const tokens = await this._generateTokens(user, options.scope || '*');
            
            // Salva i token nel database
            await this.db.execute('auth_createToken', [
                user.id,
                tokens.token,
                tokens.refreshToken,
                options.scope || '*',
                tokens.expiresAt,
                Date.now()
            ]);
            
            // Registra l'evento di audit
            if (this.config.logAuthEvents) {
                await this.logAuditEvent({
                    userId: user.id,
                    action: 'USER_LOGIN',
                    resource: `users/${user.id}`,
                    details: { username: user.username },
                    ipAddress: options.ipAddress,
                    userAgent: options.userAgent
                });
            }
            
            return {
                userId: user.id,
                username: user.username,
                role: user.role,
                ...tokens
            };
        } catch (error) {
            console.error('Errore durante il login:', error);
            throw error;
        }
    }

    /**
     * Aggiorna i token utilizzando un refresh token
     * @param {string} refreshToken - Il refresh token
     * @param {Object} options - Opzioni aggiuntive
     * @returns {Promise<Object>} I nuovi token
     */
    async refreshTokens(refreshToken, options = {}) {
        try {
            // Verifica il refresh token
            const tokenData = await this.db.queryOne('auth_getTokenByRefreshToken', [refreshToken, Date.now()]);
            
            if (!tokenData) {
                throw new Error('Refresh token non valido o scaduto');
            }
            
            // Recupera l'utente
            const user = await this.db.queryOne('auth_getUserById', [tokenData.user_id]);
            
            if (!user || user.status !== 1) {
                throw new Error('Utente non trovato o disabilitato');
            }
            
            // Revoca il vecchio token
            await this.db.execute('auth_revokeToken', [tokenData.token]);
            
            // Aggiungi il vecchio token alla blacklist
            if (this.config.tokenBlacklistEnabled) {
                this._addToBlacklist(tokenData.token, tokenData.expires_at);
            }
            
            // Genera nuovi token
            const newTokens = await this._generateTokens(user, tokenData.scope);
            
            // Salva i nuovi token nel database
            await this.db.execute('auth_createToken', [
                user.id,
                newTokens.token,
                newTokens.refreshToken,
                tokenData.scope,
                newTokens.expiresAt,
                Date.now()
            ]);
            
            // Registra l'evento di audit
            if (this.config.logAuthEvents) {
                await this.logAuditEvent({
                    userId: user.id,
                    action: 'TOKEN_REFRESH',
                    resource: `users/${user.id}`,
                    details: { username: user.username },
                    ipAddress: options.ipAddress,
                    userAgent: options.userAgent
                });
            }
            
            return {
                userId: user.id,
                username: user.username,
                role: user.role,
                ...newTokens
            };
        } catch (error) {
            console.error('Errore durante il refresh dei token:', error);
            throw error;
        }
    }

    /**
     * Verifica un token JWT
     * @param {string} token - Il token da verificare
     * @returns {Promise<Object>} I dati del token verificato
     */
    async verifyToken(token) {
        try {
            // Verifica se il token è nella blacklist
            if (this.config.tokenBlacklistEnabled && this._isBlacklisted(token)) {
                throw new Error('Token revocato');
            }
            
            // Verifica il token nel database
            const tokenData = await this.db.queryOne('auth_getTokenByToken', [token, Date.now()]);
            
            if (!tokenData) {
                throw new Error('Token non valido o scaduto');
            }
            
            // Verifica il token JWT
            let decoded;
            try {
                // Prova con il segreto corrente
                decoded = jwt.verify(token, this.config.jwtSecret, {
                    issuer: this.config.jwtIssuer,
                    audience: this.config.jwtAudience
                });
            } catch (jwtError) {
                // Se fallisce, prova con i vecchi segreti
                let verified = false;
                
                for (const oldSecret of this.oldSecrets) {
                    try {
                        decoded = jwt.verify(token, oldSecret, {
                            issuer: this.config.jwtIssuer,
                            audience: this.config.jwtAudience
                        });
                        verified = true;
                        break;
                    } catch (e) {
                        // Continua con il prossimo segreto
                    }
                }
                
                if (!verified) {
                    throw jwtError;
                }
            }
            
            // Recupera l'utente
            const user = await this.db.queryOne('auth_getUserById', [decoded.sub]);
            
            if (!user || user.status !== 1) {
                throw new Error('Utente non trovato o disabilitato');
            }
            
            // Aggiorna l'ultimo utilizzo del token
            await this.db.execute('auth_updateTokenLastUsed', [Date.now(), token]);
            
            // Restituisci i dati dell'utente e del token
            return {
                userId: user.id,
                username: user.username,
                role: user.role,
                attributes: user.attributes ? JSON.parse(user.attributes) : {},
                scope: tokenData.scope,
                expiresAt: tokenData.expires_at
            };
        } catch (error) {
            console.error('Errore durante la verifica del token:', error);
            throw error;
        }
    }

    /**
     * Revoca un token
     * @param {string} token - Il token da revocare
     * @returns {Promise<boolean>} True se la revoca è riuscita
     */
    async revokeToken(token) {
        try {
            // Revoca il token nel database
            await this.db.execute('auth_revokeToken', [token]);
            
            // Aggiungi il token alla blacklist
            if (this.config.tokenBlacklistEnabled) {
                // Decodifica il token per ottenere la data di scadenza
                try {
                    const decoded = jwt.decode(token);
                    if (decoded && decoded.exp) {
                        const expiresAt = decoded.exp * 1000; // Converti da secondi a millisecondi
                        this._addToBlacklist(token, expiresAt);
                    }
                } catch (e) {
                    // Se non riesci a decodificare, usa un TTL predefinito
                    this._addToBlacklist(token, Date.now() + this.config.tokenBlacklistTTL);
                }
            }
            
            return true;
        } catch (error) {
            console.error('Errore durante la revoca del token:', error);
            throw error;
        }
    }

    /**
     * Revoca tutti i token di un utente
     * @param {string} userId - L'ID dell'utente
     * @returns {Promise<boolean>} True se la revoca è riuscita
     */
    async revokeAllUserTokens(userId) {
        try {
            // Revoca tutti i token dell'utente nel database
            await this.db.execute('auth_revokeAllUserTokens', [userId]);
            
            // Nota: non possiamo aggiungere tutti i token alla blacklist perché
            // non abbiamo accesso ai token specifici qui
            
            // Registra l'evento di audit
            if (this.config.logAuthEvents) {
                await this.logAuditEvent({
                    userId,
                    action: 'REVOKE_ALL_TOKENS',
                    resource: `users/${userId}`,
                    details: { userId }
                });
            }
            
            return true;
        } catch (error) {
            console.error('Errore durante la revoca di tutti i token dell\'utente:', error);
            throw error;
        }
    }

    /**
     * Cambia la password di un utente
     * @param {string} userId - L'ID dell'utente
     * @param {string} currentPassword - La password attuale
     * @param {string} newPassword - La nuova password
     * @returns {Promise<boolean>} True se il cambio è riuscito
     */
    async changePassword(userId, currentPassword, newPassword) {
        try {
            // Recupera l'utente
            const user = await this.db.queryOne('auth_getUserById', [userId]);
            
            if (!user) {
                throw new Error('Utente non trovato');
            }
            
            // Verifica la password attuale
            const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
            
            if (!passwordMatch) {
                throw new Error('Password attuale non valida');
            }
            
            // Genera salt e hash della nuova password
            const salt = await bcrypt.genSalt(this.config.bcryptSaltRounds);
            const passwordHash = await bcrypt.hash(newPassword, salt);
            
            // Aggiorna la password
            await this.db.execute('auth_updateUserPassword', [passwordHash, salt, userId]);
            
            // Revoca tutti i token dell'utente
            await this.revokeAllUserTokens(userId);
            
            // Registra l'evento di audit
            if (this.config.logAuthEvents) {
                await this.logAuditEvent({
                    userId,
                    action: 'PASSWORD_CHANGE',
                    resource: `users/${userId}`,
                    details: { username: user.username }
                });
            }
            
            return true;
        } catch (error) {
            console.error('Errore durante il cambio password:', error);
            throw error;
        }
    }

    /**
     * Reimposta la password di un utente (admin)
     * @param {string} userId - L'ID dell'utente
     * @param {string} newPassword - La nuova password
     * @returns {Promise<boolean>} True se il reset è riuscito
     */
    async resetPassword(userId, newPassword) {
        try {
            // Recupera l'utente
            const user = await this.db.queryOne('auth_getUserById', [userId]);
            
            if (!user) {
                throw new Error('Utente non trovato');
            }
            
            // Genera salt e hash della nuova password
            const salt = await bcrypt.genSalt(this.config.bcryptSaltRounds);
            const passwordHash = await bcrypt.hash(newPassword, salt);
            
            // Aggiorna la password
            await this.db.execute('auth_updateUserPassword', [passwordHash, salt, userId]);
            
            // Revoca tutti i token dell'utente
            await this.revokeAllUserTokens(userId);
            
            // Registra l'evento di audit
            if (this.config.logAuthEvents) {
                await this.logAuditEvent({
                    userId: null, // L'admin che esegue l'operazione dovrebbe essere registrato separatamente
                    action: 'PASSWORD_RESET',
                    resource: `users/${userId}`,
                    details: { username: user.username }
                });
            }
            
            return true;
        } catch (error) {
            console.error('Errore durante il reset della password:', error);
            throw error;
        }
    }

    /**
     * Aggiorna il ruolo di un utente
     * @param {string} userId - L'ID dell'utente
     * @param {string} newRole - Il nuovo ruolo
     * @returns {Promise<boolean>} True se l'aggiornamento è riuscito
     */
    async updateUserRole(userId, newRole) {
        try {
            // Recupera l'utente
            const user = await this.db.queryOne('auth_getUserById', [userId]);
            
            if (!user) {
                throw new Error('Utente non trovato');
            }
            
            // Verifica che il ruolo esista
            const role = await this.db.queryOne('auth_getRoleById', [newRole]);
            
            if (!role) {
                throw new Error('Ruolo non valido');
            }
            
            // Aggiorna il ruolo
            await this.db.execute('auth_updateUserRole', [newRole, userId]);
            
            // Revoca tutti i token dell'utente
            await this.revokeAllUserTokens(userId);
            
            // Registra l'evento di audit
            if (this.config.logAuthEvents) {
                await this.logAuditEvent({
                    userId: null, // L'admin che esegue l'operazione dovrebbe essere registrato separatamente
                    action: 'ROLE_UPDATE',
                    resource: `users/${userId}`,
                    details: { username: user.username, oldRole: user.role, newRole }
                });
            }
            
            return true;
        } catch (error) {
            console.error('Errore durante l\'aggiornamento del ruolo:', error);
            throw error;
        }
    }

    /**
     * Verifica se un utente ha un permesso specifico
     * @param {string} userId - L'ID dell'utente
     * @param {string} permission - Il permesso da verificare
     * @param {Object} context - Il contesto della richiesta
     * @returns {Promise<boolean>} True se l'utente ha il permesso
     */
    async hasPermission(userId, permission, context = {}) {
        try {
            // Recupera l'utente
            const user = await this.db.queryOne('auth_getUserById', [userId]);
            
            if (!user || user.status !== 1) {
                return false;
            }
            
            // Recupera il ruolo dell'utente
            let role;
            
            // Prova prima dalla cache
            if (this.roleCache.has(user.role)) {
                role = this.roleCache.get(user.role);
            } else {
                // Altrimenti recupera dal database
                const roleData = await this.db.queryOne('auth_getRoleById', [user.role]);
                
                if (!roleData) {
                    return false;
                }
                
                role = {
                    id: roleData.id,
                    name: roleData.name,
                    permissions: JSON.parse(roleData.permissions)
                };
                
                // Aggiungi alla cache
                this.roleCache.set(user.role, role);
            }
            
            // Verifica se il ruolo ha il permesso wildcard
            if (role.permissions.includes('*')) {
                return true;
            }
            
            // Verifica se il ruolo ha il permesso specifico
            if (role.permissions.includes(permission)) {
                return true;
            }
            
            // Verifica i permessi con wildcard parziale
            // Esempio: 'transactions:*:own' corrisponde a 'transactions:read:own'
            for (const rolePerm of role.permissions) {
                if (this._matchWildcardPermission(rolePerm, permission)) {
                    return true;
                }
            }
            
            // Se ABAC è abilitato, verifica gli attributi
            if (this.config.abacEnabled && user.attributes) {
                const attributes = JSON.parse(user.attributes);
                return this._evaluateAttributeBasedRules(attributes, permission, context);
            }
            
            return false;
        } catch (error) {
            console.error('Errore durante la verifica del permesso:', error);
            return false;
        }
    }

    /**
     * Verifica se un utente può accedere a una risorsa
     * @param {string} userId - L'ID dell'utente
     * @param {string} resource - La risorsa da accedere
     * @param {string} action - L'azione da eseguire
     * @param {Object} context - Il contesto della richiesta
     * @returns {Promise<boolean>} True se l'utente può accedere alla risorsa
     */
    async canAccess(userId, resource, action, context = {}) {
        try {
            // Costruisci il permesso nel formato 'resource:action:scope'
            // Esempio: 'transactions:read:any'
            
            // Determina lo scope (own o any)
            let scope = 'any';
            
            // Se la risorsa include un ID e l'ID è uguale all'ID dell'utente, lo scope è 'own'
            if (context.resourceOwnerId && context.resourceOwnerId === userId) {
                scope = 'own';
            }
            
            // Costruisci il permesso
            const permission = `${resource}:${action}:${scope}`;
            
            // Verifica il permesso
            return await this.hasPermission(userId, permission, context);
        } catch (error) {
            console.error('Errore durante la verifica dell\'accesso:', error);
            return false;
        }
    }

    /**
     * Registra un evento di audit
     * @param {Object} event - L'evento da registrare
     * @returns {Promise<boolean>} True se la registrazione è riuscita
     */
    async logAuditEvent(event) {
        try {
            await this.db.execute('auth_createAuditLog', [
                event.userId,
                event.action,
                event.resource,
                event.details ? JSON.stringify(event.details) : null,
                event.ipAddress,
                event.userAgent,
                Date.now()
            ]);
            
            return true;
        } catch (error) {
            console.error('Errore durante la registrazione dell\'evento di audit:', error);
            return false;
        }
    }

    /**
     * Genera un token JWT e un refresh token
     * @param {Object} user - L'utente
     * @param {string} scope - Lo scope del token
     * @returns {Promise<Object>} I token generati
     */
    async _generateTokens(user, scope) {
        // Calcola la data di scadenza
        const expiresIn = this.config.jwtExpiresIn;
        const refreshExpiresIn = this.config.jwtRefreshExpiresIn;
        
        // Converti la durata in millisecondi
        const expiresInMs = this._parseDuration(expiresIn);
        const refreshExpiresInMs = this._parseDuration(refreshExpiresIn);
        
        // Calcola la data di scadenza
        const expiresAt = Date.now() + expiresInMs;
        const refreshExpiresAt = Date.now() + refreshExpiresInMs;
        
        // Payload del token
        const payload = {
            sub: user.id,
            username: user.username,
            role: user.role,
            scope
        };
        
        // Opzioni del token
        const options = {
            expiresIn,
            issuer: this.config.jwtIssuer,
            audience: this.config.jwtAudience,
            jwtid: uuidv4()
        };
        
        // Genera il token
        const token = jwt.sign(payload, this.config.jwtSecret, options);
        
        // Genera il refresh token
        const refreshToken = crypto.randomBytes(40).toString('hex');
        
        return {
            token,
            refreshToken,
            expiresAt,
            refreshExpiresAt
        };
    }

    /**
     * Aggiunge un token alla blacklist
     * @param {string} token - Il token da aggiungere
     * @param {number} expiresAt - La data di scadenza del token
     */
    _addToBlacklist(token, expiresAt) {
        if (!this.config.tokenBlacklistEnabled) {
            return;
        }
        
        // Aggiungi il token alla blacklist
        this.tokenBlacklist.set(token, expiresAt);
    }

    /**
     * Verifica se un token è nella blacklist
     * @param {string} token - Il token da verificare
     * @returns {boolean} True se il token è nella blacklist
     */
    _isBlacklisted(token) {
        if (!this.config.tokenBlacklistEnabled) {
            return false;
        }
        
        return this.tokenBlacklist.has(token);
    }

    /**
     * Pulisce la blacklist dei token scaduti
     */
    _cleanupTokenBlacklist() {
        if (!this.config.tokenBlacklistEnabled) {
            return;
        }
        
        const now = Date.now();
        
        // Rimuovi i token scaduti
        for (const [token, expiresAt] of this.tokenBlacklist.entries()) {
            if (expiresAt <= now) {
                this.tokenBlacklist.delete(token);
            }
        }
    }

    /**
     * Ruota i segreti JWT
     */
    _rotateJwtSecrets() {
        if (!this.config.tokenRotationEnabled) {
            return;
        }
        
        // Salva il vecchio segreto
        this.oldSecrets.unshift(this.config.jwtSecret);
        
        // Limita il numero di vecchi segreti
        if (this.oldSecrets.length > 3) {
            this.oldSecrets.pop();
        }
        
        // Genera nuovi segreti
        this.config.jwtSecret = this._generateRandomSecret();
        this.config.jwtRefreshSecret = this._generateRandomSecret();
        
        console.log('Segreti JWT ruotati con successo');
    }

    /**
     * Genera un segreto casuale
     * @returns {string} Il segreto generato
     */
    _generateRandomSecret() {
        return crypto.randomBytes(64).toString('hex');
    }

    /**
     * Converte una durata in millisecondi
     * @param {string|number} duration - La durata
     * @returns {number} La durata in millisecondi
     */
    _parseDuration(duration) {
        if (typeof duration === 'number') {
            return duration;
        }
        
        const regex = /^(\d+)([smhdw])$/;
        const match = duration.match(regex);
        
        if (!match) {
            return 3600000; // Default: 1 ora
        }
        
        const value = parseInt(match[1], 10);
        const unit = match[2];
        
        switch (unit) {
            case 's': return value * 1000; // secondi
            case 'm': return value * 60 * 1000; // minuti
            case 'h': return value * 60 * 60 * 1000; // ore
            case 'd': return value * 24 * 60 * 60 * 1000; // giorni
            case 'w': return value * 7 * 24 * 60 * 60 * 1000; // settimane
            default: return 3600000; // Default: 1 ora
        }
    }

    /**
     * Verifica se un permesso con wildcard corrisponde a un permesso specifico
     * @param {string} wildcardPermission - Il permesso con wildcard
     * @param {string} specificPermission - Il permesso specifico
     * @returns {boolean} True se il permesso corrisponde
     */
    _matchWildcardPermission(wildcardPermission, specificPermission) {
        // Se il permesso è esattamente uguale, corrisponde
        if (wildcardPermission === specificPermission) {
            return true;
        }
        
        // Se il permesso è '*', corrisponde a tutto
        if (wildcardPermission === '*') {
            return true;
        }
        
        // Dividi i permessi in parti
        const wildcardParts = wildcardPermission.split(':');
        const specificParts = specificPermission.split(':');
        
        // Se il numero di parti è diverso, non corrisponde
        if (wildcardParts.length !== specificParts.length) {
            return false;
        }
        
        // Verifica ogni parte
        for (let i = 0; i < wildcardParts.length; i++) {
            if (wildcardParts[i] !== '*' && wildcardParts[i] !== specificParts[i]) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * Valuta le regole basate sugli attributi
     * @param {Object} attributes - Gli attributi dell'utente
     * @param {string} permission - Il permesso da verificare
     * @param {Object} context - Il contesto della richiesta
     * @returns {boolean} True se le regole sono soddisfatte
     */
    _evaluateAttributeBasedRules(attributes, permission, context) {
        // Implementazione di base delle regole ABAC
        // In una implementazione reale, qui ci sarebbe un motore di regole più complesso
        
        // Esempio: verifica se l'utente ha un attributo che corrisponde al permesso
        if (attributes.permissions && attributes.permissions.includes(permission)) {
            return true;
        }
        
        // Esempio: verifica se l'utente ha un attributo che corrisponde alla risorsa
        const [resource] = permission.split(':');
        if (attributes.resources && attributes.resources.includes(resource)) {
            return true;
        }
        
        // Esempio: verifica regole basate sul contesto
        if (context.resourceOwnerId && attributes.ownedResources && 
            attributes.ownedResources.includes(context.resourceOwnerId)) {
            return true;
        }
        
        return false;
    }

    /**
     * Chiude l'auth manager e rilascia le risorse
     */
    close() {
        // Ferma gli intervalli
        if (this.blacklistCleanupInterval) {
            clearInterval(this.blacklistCleanupInterval);
            this.blacklistCleanupInterval = null;
        }
        
        if (this.tokenRotationInterval) {
            clearInterval(this.tokenRotationInterval);
            this.tokenRotationInterval = null;
        }
        
        // Pulisci le cache
        this.tokenBlacklist.clear();
        this.roleCache.clear();
        this.permissionCache.clear();
        
        console.log('AuthManager chiuso con successo');
    }
}

module.exports = AuthManager;
