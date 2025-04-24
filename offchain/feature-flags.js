/**
 * Sistema di Feature Flags per il Layer-2 su Solana
 * 
 * Questo modulo implementa un sistema di feature flags che permette di abilitare
 * o disabilitare funzionalità in modo dinamico, supportando anche limiti e
 * configurazioni specifiche per ciascuna feature.
 */

const { EventEmitter } = require('events');

/**
 * Classe FeatureFlags
 * 
 * Implementa un sistema di feature flags con supporto per limiti e configurazioni.
 */
class FeatureFlags extends EventEmitter {
    /**
     * Costruttore
     * @param {Object} config - Configurazione del sistema di feature flags
     * @param {Object} [config.features] - Configurazione iniziale delle feature
     * @param {Object} [config.storage] - Configurazione dello storage
     * @param {boolean} [config.persistChanges=true] - Se persistere i cambiamenti
     * @param {Function} [config.logger] - Funzione di logging
     */
    constructor(config = {}) {
        super();
        
        this.config = {
            persistChanges: config.persistChanges !== undefined ? config.persistChanges : true,
            ...config
        };
        
        // Inizializza le feature
        this.features = {};
        
        // Inizializza lo storage
        this.storage = this._initializeStorage(config.storage);
        
        // Stato del sistema
        this.isInitialized = false;
        
        // Logger
        this.logger = this.config.logger || console;
        
        // Registro delle modifiche
        this.changeLog = [];
    }

    /**
     * Inizializza lo storage
     * @param {Object} storageConfig - Configurazione dello storage
     * @returns {Object} - Interfaccia dello storage
     * @private
     */
    _initializeStorage(storageConfig = {}) {
        // Implementazione di default: storage in memoria
        const inMemoryStorage = {
            data: {},
            
            async get(key) {
                return this.data[key];
            },
            
            async set(key, value) {
                this.data[key] = value;
                return true;
            },
            
            async delete(key) {
                delete this.data[key];
                return true;
            },
            
            async getAll() {
                return { ...this.data };
            }
        };
        
        // Se è fornita una configurazione di storage personalizzata, usala
        if (storageConfig.type === 'redis') {
            // Implementazione Redis (esempio)
            return {
                client: storageConfig.client,
                
                async get(key) {
                    const value = await this.client.get(`feature:${key}`);
                    return value ? JSON.parse(value) : null;
                },
                
                async set(key, value) {
                    await this.client.set(`feature:${key}`, JSON.stringify(value));
                    return true;
                },
                
                async delete(key) {
                    await this.client.del(`feature:${key}`);
                    return true;
                },
                
                async getAll() {
                    const keys = await this.client.keys('feature:*');
                    const result = {};
                    
                    for (const key of keys) {
                        const featureKey = key.replace('feature:', '');
                        result[featureKey] = JSON.parse(await this.client.get(key));
                    }
                    
                    return result;
                }
            };
        } else if (storageConfig.type === 'database') {
            // Implementazione database (esempio)
            return {
                db: storageConfig.db,
                
                async get(key) {
                    const result = await this.db.query(
                        'SELECT value FROM feature_flags WHERE key = ?',
                        [key]
                    );
                    
                    return result.length > 0 ? JSON.parse(result[0].value) : null;
                },
                
                async set(key, value) {
                    await this.db.query(
                        'INSERT INTO feature_flags (key, value) VALUES (?, ?) ' +
                        'ON DUPLICATE KEY UPDATE value = ?',
                        [key, JSON.stringify(value), JSON.stringify(value)]
                    );
                    
                    return true;
                },
                
                async delete(key) {
                    await this.db.query(
                        'DELETE FROM feature_flags WHERE key = ?',
                        [key]
                    );
                    
                    return true;
                },
                
                async getAll() {
                    const results = await this.db.query(
                        'SELECT key, value FROM feature_flags'
                    );
                    
                    const data = {};
                    for (const row of results) {
                        data[row.key] = JSON.parse(row.value);
                    }
                    
                    return data;
                }
            };
        } else if (storageConfig.type === 'custom' && storageConfig.implementation) {
            // Implementazione personalizzata
            return storageConfig.implementation;
        }
        
        // Default: storage in memoria
        return inMemoryStorage;
    }

    /**
     * Inizializza il sistema di feature flags
     * @returns {Promise<boolean>} - True se l'inizializzazione è riuscita
     */
    async initialize() {
        try {
            this.logger.info('Inizializzazione del sistema di feature flags...');
            
            // Carica le feature dallo storage
            if (this.config.persistChanges) {
                const storedFeatures = await this.storage.getAll();
                
                for (const [featureName, featureConfig] of Object.entries(storedFeatures)) {
                    this.features[featureName] = featureConfig;
                }
                
                this.logger.info(`Caricate ${Object.keys(storedFeatures).length} feature dallo storage`);
            }
            
            // Inizializza le feature configurate
            if (this.config.features) {
                for (const [featureName, featureConfig] of Object.entries(this.config.features)) {
                    // Non sovrascrivere le feature già caricate dallo storage
                    if (!this.features[featureName]) {
                        this.features[featureName] = featureConfig;
                        
                        // Persisti la feature se richiesto
                        if (this.config.persistChanges) {
                            await this.storage.set(featureName, featureConfig);
                        }
                    }
                }
                
                this.logger.info(`Inizializzate ${Object.keys(this.config.features).length} feature dalla configurazione`);
            }
            
            this.isInitialized = true;
            this.emit('initialized');
            
            this.logger.info('Sistema di feature flags inizializzato con successo');
            return true;
        } catch (error) {
            this.logger.error(`Errore durante l'inizializzazione del sistema di feature flags: ${error.message}`);
            throw error;
        }
    }

    /**
     * Registra una feature
     * @param {string} featureName - Nome della feature
     * @param {Object} featureConfig - Configurazione della feature
     * @param {boolean} [featureConfig.enabled=false] - Se la feature è abilitata
     * @param {Object} [featureConfig.limits={}] - Limiti della feature
     * @param {Object} [featureConfig.config={}] - Configurazione aggiuntiva
     * @param {Object} [metadata] - Metadati della modifica
     * @returns {Promise<Object>} - Configurazione della feature registrata
     */
    async registerFeature(featureName, featureConfig, metadata = {}) {
        if (!featureName) {
            throw new Error('Il nome della feature è obbligatorio');
        }
        
        // Configura la feature
        const feature = {
            enabled: featureConfig.enabled !== undefined ? featureConfig.enabled : false,
            limits: featureConfig.limits || {},
            config: featureConfig.config || {},
            lastUpdated: new Date().toISOString(),
            ...featureConfig
        };
        
        // Salva la feature
        this.features[featureName] = feature;
        
        // Persisti la feature se richiesto
        if (this.config.persistChanges) {
            await this.storage.set(featureName, feature);
        }
        
        // Registra la modifica
        this._logChange('register', featureName, feature, metadata);
        
        this.logger.info(`Feature registrata: ${featureName}`);
        this.emit('feature_registered', { feature: featureName, config: feature, metadata });
        
        return feature;
    }

    /**
     * Verifica se una feature è abilitata
     * @param {string} featureName - Nome della feature
     * @returns {Promise<boolean>} - True se la feature è abilitata
     */
    async isEnabled(featureName) {
        // Verifica se la feature è definita
        if (!this.features[featureName]) {
            return false;
        }
        
        return this.features[featureName].enabled;
    }

    /**
     * Abilita una feature
     * @param {string} featureName - Nome della feature
     * @param {Object} [metadata] - Metadati della modifica
     * @returns {Promise<boolean>} - True se l'operazione è riuscita
     */
    async enable(featureName, metadata = {}) {
        // Verifica se la feature è definita
        if (!this.features[featureName]) {
            await this.registerFeature(featureName, { enabled: true }, metadata);
            return true;
        }
        
        // Aggiorna lo stato della feature
        const feature = this.features[featureName];
        
        if (feature.enabled) {
            return true; // La feature è già abilitata
        }
        
        feature.enabled = true;
        feature.lastUpdated = new Date().toISOString();
        
        // Persisti la feature se richiesto
        if (this.config.persistChanges) {
            await this.storage.set(featureName, feature);
        }
        
        // Registra la modifica
        this._logChange('enable', featureName, feature, metadata);
        
        this.logger.info(`Feature abilitata: ${featureName}`);
        this.emit('feature_enabled', { feature: featureName, metadata });
        
        return true;
    }

    /**
     * Disabilita una feature
     * @param {string} featureName - Nome della feature
     * @param {Object} [metadata] - Metadati della modifica
     * @returns {Promise<boolean>} - True se l'operazione è riuscita
     */
    async disable(featureName, metadata = {}) {
        // Verifica se la feature è definita
        if (!this.features[featureName]) {
            await this.registerFeature(featureName, { enabled: false }, metadata);
            return true;
        }
        
        // Aggiorna lo stato della feature
        const feature = this.features[featureName];
        
        if (!feature.enabled) {
            return true; // La feature è già disabilitata
        }
        
        feature.enabled = false;
        feature.lastUpdated = new Date().toISOString();
        
        // Persisti la feature se richiesto
        if (this.config.persistChanges) {
            await this.storage.set(featureName, feature);
        }
        
        // Registra la modifica
        this._logChange('disable', featureName, feature, metadata);
        
        this.logger.info(`Feature disabilitata: ${featureName}`);
        this.emit('feature_disabled', { feature: featureName, metadata });
        
        return true;
    }

    /**
     * Ottiene i limiti di una feature
     * @param {string} featureName - Nome della feature
     * @returns {Promise<Object>} - Limiti della feature
     */
    async getLimits(featureName) {
        // Verifica se la feature è definita
        if (!this.features[featureName]) {
            return {};
        }
        
        return this.features[featureName].limits || {};
    }

    /**
     * Imposta i limiti di una feature
     * @param {string} featureName - Nome della feature
     * @param {Object} limits - Limiti della feature
     * @param {Object} [metadata] - Metadati della modifica
     * @returns {Promise<boolean>} - True se l'operazione è riuscita
     */
    async setLimits(featureName, limits, metadata = {}) {
        // Verifica se la feature è definita
        if (!this.features[featureName]) {
            await this.registerFeature(featureName, { limits }, metadata);
            return true;
        }
        
        // Aggiorna i limiti della feature
        const feature = this.features[featureName];
        feature.limits = limits;
        feature.lastUpdated = new Date().toISOString();
        
        // Persisti la feature se richiesto
        if (this.config.persistChanges) {
            await this.storage.set(featureName, feature);
        }
        
        // Registra la modifica
        this._logChange('set_limits', featureName, feature, metadata);
        
        this.logger.info(`Limiti impostati per la feature ${featureName}:`, limits);
        this.emit('feature_limits_updated', { feature: featureName, limits, metadata });
        
        return true;
    }

    /**
     * Ottiene la configurazione di una feature
     * @param {string} featureName - Nome della feature
     * @returns {Promise<Object>} - Configurazione della feature
     */
    async getConfig(featureName) {
        // Verifica se la feature è definita
        if (!this.features[featureName]) {
            return {};
        }
        
        return this.features[featureName].config || {};
    }

    /**
     * Imposta la configurazione di una feature
     * @param {string} featureName - Nome della feature
     * @param {Object} config - Configurazione della feature
     * @param {Object} [metadata] - Metadati della modifica
     * @returns {Promise<boolean>} - True se l'operazione è riuscita
     */
    async setConfig(featureName, config, metadata = {}) {
        // Verifica se la feature è definita
        if (!this.features[featureName]) {
            await this.registerFeature(featureName, { config }, metadata);
            return true;
        }
        
        // Aggiorna la configurazione della feature
        const feature = this.features[featureName];
        feature.config = config;
        feature.lastUpdated = new Date().toISOString();
        
        // Persisti la feature se richiesto
        if (this.config.persistChanges) {
            await this.storage.set(featureName, feature);
        }
        
        // Registra la modifica
        this._logChange('set_config', featureName, feature, metadata);
        
        this.logger.info(`Configurazione impostata per la feature ${featureName}:`, config);
        this.emit('feature_config_updated', { feature: featureName, config, metadata });
        
        return true;
    }

    /**
     * Elimina una feature
     * @param {string} featureName - Nome della feature
     * @param {Object} [metadata] - Metadati della modifica
     * @returns {Promise<boolean>} - True se l'operazione è riuscita
     */
    async deleteFeature(featureName, metadata = {}) {
        // Verifica se la feature è definita
        if (!this.features[featureName]) {
            return false;
        }
        
        // Elimina la feature
        const feature = this.features[featureName];
        delete this.features[featureName];
        
        // Elimina la feature dallo storage se richiesto
        if (this.config.persistChanges) {
            await this.storage.delete(featureName);
        }
        
        // Registra la modifica
        this._logChange('delete', featureName, feature, metadata);
        
        this.logger.info(`Feature eliminata: ${featureName}`);
        this.emit('feature_deleted', { feature: featureName, metadata });
        
        return true;
    }

    /**
     * Ottiene tutte le feature
     * @returns {Promise<Object>} - Tutte le feature
     */
    async getAllFeatures() {
        return { ...this.features };
    }

    /**
     * Ottiene il registro delle modifiche
     * @param {number} [limit] - Numero massimo di modifiche da restituire
     * @returns {Array} - Registro delle modifiche
     */
    getChangeLog(limit) {
        if (limit) {
            return this.changeLog.slice(-limit);
        }
        
        return [...this.changeLog];
    }

    /**
     * Registra una modifica nel registro
     * @param {string} action - Azione eseguita
     * @param {string} featureName - Nome della feature
     * @param {Object} feature - Configurazione della feature
     * @param {Object} metadata - Metadati della modifica
     * @private
     */
    _logChange(action, featureName, feature, metadata) {
        const change = {
            action,
            feature: featureName,
            timestamp: new Date().toISOString(),
            data: { ...feature },
            metadata: { ...metadata }
        };
        
        this.changeLog.push(change);
        
        // Limita la dimensione del registro
        if (this.changeLog.length > 1000) {
            this.changeLog = this.changeLog.slice(-1000);
        }
    }
}

module.exports = { FeatureFlags };
