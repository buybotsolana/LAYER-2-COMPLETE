/**
 * Sistema di Graceful Degradation per il Layer-2 su Solana
 * 
 * Questo modulo implementa un sistema di degradazione graduale che permette
 * al sistema di continuare a funzionare in modo limitato quando alcuni componenti
 * non sono disponibili o funzionano in modo degradato.
 */

const { EventEmitter } = require('events');
const { HealthChecks } = require('./health-checks');
const { FeatureFlags } = require('./feature-flags');

/**
 * Classe GracefulDegradation
 * 
 * Implementa un sistema di degradazione graduale basato su feature flags e health checks.
 */
class GracefulDegradation extends EventEmitter {
    /**
     * Costruttore
     * @param {Object} config - Configurazione del sistema di degradazione
     * @param {Object} [config.features] - Definizione delle feature e delle loro dipendenze
     * @param {Object} [config.healthChecks] - Configurazione dei controlli di salute
     * @param {Object} [config.featureFlags] - Configurazione dei feature flags
     * @param {number} [config.monitoringInterval=30000] - Intervallo di monitoraggio in ms
     * @param {boolean} [config.autoAdjust=true] - Se regolare automaticamente i feature flags
     * @param {Function} [config.logger] - Funzione di logging
     */
    constructor(config = {}) {
        super();
        
        this.config = {
            monitoringInterval: config.monitoringInterval || 30000, // 30 secondi
            autoAdjust: config.autoAdjust !== undefined ? config.autoAdjust : true,
            ...config
        };
        
        // Inizializza le feature
        this.features = this.config.features || {};
        
        // Inizializza i controlli di salute
        this.healthChecks = new HealthChecks(this.config.healthChecks || {});
        
        // Inizializza i feature flags
        this.featureFlags = new FeatureFlags(this.config.featureFlags || {});
        
        // Stato del sistema
        this.isInitialized = false;
        this.isMonitoring = false;
        this.monitoringInterval = null;
        this.lastMonitoringTime = null;
        
        // Logger
        this.logger = this.config.logger || console;
    }

    /**
     * Inizializza il sistema di degradazione
     * @returns {Promise<boolean>} - True se l'inizializzazione è riuscita
     */
    async initialize() {
        try {
            this.logger.info('Inizializzazione del sistema di degradazione graduale...');
            
            // Inizializza i controlli di salute
            await this.healthChecks.initialize();
            
            // Inizializza i feature flags
            await this.featureFlags.initialize();
            
            // Avvia il loop di monitoraggio se richiesto
            if (this.config.autoAdjust) {
                this.startMonitoringLoop();
            }
            
            this.isInitialized = true;
            this.emit('initialized');
            
            this.logger.info('Sistema di degradazione graduale inizializzato con successo');
            return true;
        } catch (error) {
            this.logger.error(`Errore durante l'inizializzazione del sistema di degradazione: ${error.message}`);
            throw error;
        }
    }

    /**
     * Avvia il loop di monitoraggio
     */
    startMonitoringLoop() {
        if (this.isMonitoring) {
            this.logger.warn('Il loop di monitoraggio è già attivo');
            return;
        }
        
        this.logger.info(`Avvio del loop di monitoraggio (intervallo: ${this.config.monitoringInterval}ms)`);
        
        this.monitoringInterval = setInterval(() => {
            this.monitorAndAdjust().catch(error => {
                this.logger.error(`Errore durante il monitoraggio: ${error.message}`);
            });
        }, this.config.monitoringInterval);
        
        this.isMonitoring = true;
        this.emit('monitoring_started');
    }

    /**
     * Ferma il loop di monitoraggio
     */
    stopMonitoringLoop() {
        if (!this.isMonitoring) {
            return;
        }
        
        this.logger.info('Arresto del loop di monitoraggio');
        
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
        this.isMonitoring = false;
        this.emit('monitoring_stopped');
    }

    /**
     * Verifica la disponibilità di una feature
     * @param {string} featureName - Nome della feature
     * @returns {Promise<boolean>} - True se la feature è disponibile
     */
    async checkFeatureAvailability(featureName) {
        // Verifica se la feature è definita
        if (!this.features[featureName]) {
            this.logger.warn(`Feature non definita: ${featureName}`);
            return false;
        }
        
        // Verifica se la feature è abilitata
        if (!await this.featureFlags.isEnabled(featureName)) {
            this.logger.debug(`Feature disabilitata: ${featureName}`);
            return false;
        }
        
        // Verifica la salute dei componenti richiesti
        const requiredComponents = this.features[featureName].requiredComponents || [];
        
        if (requiredComponents.length === 0) {
            return true;
        }
        
        const healthStatus = await this.healthChecks.checkComponents(requiredComponents);
        
        if (!healthStatus.allHealthy) {
            this.logger.debug(`Feature ${featureName} non disponibile: componenti non sani`, 
                healthStatus.components);
        }
        
        return healthStatus.allHealthy;
    }

    /**
     * Trova un'alternativa per una feature non disponibile
     * @param {string} featureName - Nome della feature
     * @returns {Promise<string|null>} - Nome dell'alternativa o null se non disponibile
     */
    async degradeGracefully(featureName) {
        // Verifica se la feature è definita
        if (!this.features[featureName]) {
            this.logger.warn(`Feature non definita: ${featureName}`);
            return null;
        }
        
        // Ottieni le alternative per la feature
        const alternatives = this.features[featureName].alternatives || [];
        
        // Trova la prima alternativa disponibile
        for (const alternative of alternatives) {
            const isAvailable = await this.checkFeatureAvailability(alternative);
            
            if (isAvailable) {
                this.logger.info(`Degradazione graduale: usando ${alternative} al posto di ${featureName}`);
                this.emit('feature_degraded', { 
                    feature: featureName, 
                    alternative, 
                    timestamp: new Date().toISOString() 
                });
                return alternative;
            }
        }
        
        this.logger.warn(`Nessuna alternativa disponibile per la feature: ${featureName}`);
        this.emit('feature_unavailable', { 
            feature: featureName, 
            timestamp: new Date().toISOString() 
        });
        
        return null;
    }

    /**
     * Monitora lo stato del sistema e regola i feature flags
     * @returns {Promise<Object>} - Stato del sistema dopo la regolazione
     */
    async monitorAndAdjust() {
        if (!this.isInitialized) {
            throw new Error('Il sistema di degradazione non è inizializzato');
        }
        
        this.lastMonitoringTime = Date.now();
        this.logger.debug('Esecuzione del monitoraggio e regolazione...');
        
        // Controlla la salute di tutti i componenti
        const healthStatus = await this.healthChecks.checkAllComponents();
        
        // Aggiusta i feature flags in base allo stato di salute
        const adjustments = [];
        
        for (const [component, status] of Object.entries(healthStatus.components)) {
            if (!status.healthy) {
                // Disabilita le feature che dipendono da questo componente
                const disabledFeatures = await this._disableDependentFeatures(component);
                adjustments.push(...disabledFeatures.map(feature => ({
                    feature,
                    component,
                    action: 'disabled',
                    reason: status.reason || 'Component unhealthy'
                })));
            } else if (status.degraded) {
                // Limita le feature che dipendono da questo componente
                const limitedFeatures = await this._limitDependentFeatures(component, status.metrics);
                adjustments.push(...limitedFeatures.map(feature => ({
                    feature,
                    component,
                    action: 'limited',
                    reason: status.reason || 'Component degraded',
                    metrics: status.metrics
                })));
            } else {
                // Riabilita le feature se tutti i componenti richiesti sono sani
                const enabledFeatures = await this._enableFeaturesIfPossible(component);
                adjustments.push(...enabledFeatures.map(feature => ({
                    feature,
                    component,
                    action: 'enabled',
                    reason: 'All required components healthy'
                })));
            }
        }
        
        if (adjustments.length > 0) {
            this.logger.info(`Regolazioni applicate: ${adjustments.length}`, adjustments);
            this.emit('adjustments_applied', { 
                adjustments, 
                timestamp: new Date().toISOString() 
            });
        }
        
        return {
            healthStatus,
            adjustments,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Disabilita le feature che dipendono da un componente
     * @param {string} component - Nome del componente
     * @returns {Promise<string[]>} - Lista delle feature disabilitate
     * @private
     */
    async _disableDependentFeatures(component) {
        const disabledFeatures = [];
        
        for (const [featureName, feature] of Object.entries(this.features)) {
            const requiredComponents = feature.requiredComponents || [];
            
            if (requiredComponents.includes(component)) {
                // Disabilita la feature
                const wasEnabled = await this.featureFlags.isEnabled(featureName);
                
                if (wasEnabled) {
                    await this.featureFlags.disable(featureName, {
                        reason: `Component ${component} is unhealthy`,
                        automatic: true,
                        timestamp: new Date().toISOString()
                    });
                    
                    disabledFeatures.push(featureName);
                    
                    this.logger.info(`Feature ${featureName} disabilitata: componente ${component} non sano`);
                    this.emit('feature_disabled', { 
                        feature: featureName, 
                        component, 
                        timestamp: new Date().toISOString() 
                    });
                }
            }
        }
        
        return disabledFeatures;
    }

    /**
     * Limita le feature che dipendono da un componente degradato
     * @param {string} component - Nome del componente
     * @param {Object} metrics - Metriche del componente
     * @returns {Promise<string[]>} - Lista delle feature limitate
     * @private
     */
    async _limitDependentFeatures(component, metrics) {
        const limitedFeatures = [];
        
        for (const [featureName, feature] of Object.entries(this.features)) {
            const requiredComponents = feature.requiredComponents || [];
            
            if (requiredComponents.includes(component)) {
                // Limita la feature
                const currentLimits = await this.featureFlags.getLimits(featureName);
                const newLimits = this._calculateLimits(featureName, component, metrics, currentLimits);
                
                if (JSON.stringify(currentLimits) !== JSON.stringify(newLimits)) {
                    await this.featureFlags.setLimits(featureName, newLimits, {
                        reason: `Component ${component} is degraded`,
                        automatic: true,
                        timestamp: new Date().toISOString()
                    });
                    
                    limitedFeatures.push(featureName);
                    
                    this.logger.info(`Feature ${featureName} limitata: componente ${component} degradato`, newLimits);
                    this.emit('feature_limited', { 
                        feature: featureName, 
                        component, 
                        limits: newLimits,
                        timestamp: new Date().toISOString() 
                    });
                }
            }
        }
        
        return limitedFeatures;
    }

    /**
     * Calcola i limiti per una feature in base alle metriche di un componente
     * @param {string} featureName - Nome della feature
     * @param {string} component - Nome del componente
     * @param {Object} metrics - Metriche del componente
     * @param {Object} currentLimits - Limiti attuali
     * @returns {Object} - Nuovi limiti
     * @private
     */
    _calculateLimits(featureName, component, metrics, currentLimits) {
        // Implementazione di default: riduce il rate limit in base alla latenza
        const newLimits = { ...currentLimits };
        
        if (metrics.latency) {
            // Esempio: riduce il rate limit in base alla latenza
            const latencyFactor = Math.min(1, 100 / metrics.latency);
            
            if (newLimits.rateLimit) {
                const baseRateLimit = this.features[featureName].baseLimits?.rateLimit || 1000;
                newLimits.rateLimit = Math.max(1, Math.floor(baseRateLimit * latencyFactor));
            }
        }
        
        if (metrics.errorRate) {
            // Esempio: riduce il batch size in base all'error rate
            const errorFactor = Math.max(0, 1 - metrics.errorRate);
            
            if (newLimits.batchSize) {
                const baseBatchSize = this.features[featureName].baseLimits?.batchSize || 100;
                newLimits.batchSize = Math.max(1, Math.floor(baseBatchSize * errorFactor));
            }
        }
        
        if (metrics.cpuUsage) {
            // Esempio: riduce la concurrency in base all'utilizzo della CPU
            const cpuFactor = Math.max(0, 1 - metrics.cpuUsage);
            
            if (newLimits.concurrency) {
                const baseConcurrency = this.features[featureName].baseLimits?.concurrency || 10;
                newLimits.concurrency = Math.max(1, Math.floor(baseConcurrency * cpuFactor));
            }
        }
        
        return newLimits;
    }

    /**
     * Riabilita le feature se tutti i componenti richiesti sono sani
     * @param {string} component - Nome del componente
     * @returns {Promise<string[]>} - Lista delle feature riabilitate
     * @private
     */
    async _enableFeaturesIfPossible(component) {
        const enabledFeatures = [];
        
        for (const [featureName, feature] of Object.entries(this.features)) {
            const requiredComponents = feature.requiredComponents || [];
            
            if (requiredComponents.includes(component)) {
                // Verifica se tutti i componenti richiesti sono sani
                const healthStatus = await this.healthChecks.checkComponents(requiredComponents);
                
                if (healthStatus.allHealthy) {
                    const wasDisabled = !(await this.featureFlags.isEnabled(featureName));
                    
                    if (wasDisabled) {
                        await this.featureFlags.enable(featureName, {
                            reason: 'All required components are healthy',
                            automatic: true,
                            timestamp: new Date().toISOString()
                        });
                        
                        // Ripristina i limiti di base
                        if (feature.baseLimits) {
                            await this.featureFlags.setLimits(featureName, feature.baseLimits, {
                                reason: 'All required components are healthy',
                                automatic: true,
                                timestamp: new Date().toISOString()
                            });
                        }
                        
                        enabledFeatures.push(featureName);
                        
                        this.logger.info(`Feature ${featureName} riabilitata: tutti i componenti sono sani`);
                        this.emit('feature_enabled', { 
                            feature: featureName, 
                            timestamp: new Date().toISOString() 
                        });
                    }
                }
            }
        }
        
        return enabledFeatures;
    }

    /**
     * Registra una feature
     * @param {string} featureName - Nome della feature
     * @param {Object} featureConfig - Configurazione della feature
     * @param {string[]} [featureConfig.requiredComponents] - Componenti richiesti
     * @param {string[]} [featureConfig.alternatives] - Alternative in caso di degradazione
     * @param {Object} [featureConfig.baseLimits] - Limiti di base
     * @returns {Object} - Configurazione della feature registrata
     */
    registerFeature(featureName, featureConfig) {
        if (!featureConfig) {
            throw new Error('La configurazione della feature è obbligatoria');
        }
        
        this.features[featureName] = {
            requiredComponents: featureConfig.requiredComponents || [],
            alternatives: featureConfig.alternatives || [],
            baseLimits: featureConfig.baseLimits || {},
            ...featureConfig
        };
        
        this.logger.info(`Feature registrata: ${featureName}`);
        
        return this.features[featureName];
    }

    /**
     * Ottiene lo stato di tutte le feature
     * @returns {Promise<Object>} - Stato di tutte le feature
     */
    async getFeatureStatus() {
        const status = {};
        
        for (const featureName of Object.keys(this.features)) {
            status[featureName] = {
                enabled: await this.featureFlags.isEnabled(featureName),
                limits: await this.featureFlags.getLimits(featureName),
                available: await this.checkFeatureAvailability(featureName),
                config: this.features[featureName]
            };
        }
        
        return status;
    }

    /**
     * Ottiene lo stato del sistema
     * @returns {Promise<Object>} - Stato del sistema
     */
    async getStatus() {
        return {
            isInitialized: this.isInitialized,
            isMonitoring: this.isMonitoring,
            lastMonitoringTime: this.lastMonitoringTime,
            features: await this.getFeatureStatus(),
            health: await this.healthChecks.checkAllComponents()
        };
    }
}

module.exports = { GracefulDegradation };
