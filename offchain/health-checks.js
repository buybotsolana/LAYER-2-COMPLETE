/**
 * Sistema di Health Checks per il Layer-2 su Solana
 * 
 * Questo modulo implementa un sistema di controlli di salute per monitorare
 * lo stato dei vari componenti del sistema e rilevare condizioni di degrado.
 */

const { EventEmitter } = require('events');

/**
 * Classe HealthChecks
 * 
 * Implementa un sistema di controlli di salute per monitorare lo stato dei componenti.
 */
class HealthChecks extends EventEmitter {
    /**
     * Costruttore
     * @param {Object} config - Configurazione dei controlli di salute
     * @param {Object} [config.components] - Definizione dei componenti da monitorare
     * @param {number} [config.checkInterval=60000] - Intervallo di controllo in ms
     * @param {boolean} [config.autoCheck=false] - Se eseguire controlli automatici
     * @param {Function} [config.logger] - Funzione di logging
     */
    constructor(config = {}) {
        super();
        
        this.config = {
            checkInterval: config.checkInterval || 60000, // 60 secondi
            autoCheck: config.autoCheck !== undefined ? config.autoCheck : false,
            ...config
        };
        
        // Inizializza i componenti
        this.components = this.config.components || {};
        
        // Stato del sistema
        this.isInitialized = false;
        this.isChecking = false;
        this.checkInterval = null;
        this.lastCheckTime = null;
        this.lastCheckResults = {};
        
        // Logger
        this.logger = this.config.logger || console;
        
        // Registro dei controlli personalizzati
        this.customChecks = {};
    }

    /**
     * Inizializza il sistema di controlli di salute
     * @returns {Promise<boolean>} - True se l'inizializzazione è riuscita
     */
    async initialize() {
        try {
            this.logger.info('Inizializzazione del sistema di controlli di salute...');
            
            // Registra i controlli di default
            this._registerDefaultChecks();
            
            // Avvia il loop di controllo se richiesto
            if (this.config.autoCheck) {
                this.startCheckLoop();
            }
            
            this.isInitialized = true;
            this.emit('initialized');
            
            this.logger.info('Sistema di controlli di salute inizializzato con successo');
            return true;
        } catch (error) {
            this.logger.error(`Errore durante l'inizializzazione del sistema di controlli di salute: ${error.message}`);
            throw error;
        }
    }

    /**
     * Registra i controlli di default
     * @private
     */
    _registerDefaultChecks() {
        // Controllo di memoria
        this.registerCheck('memory', async () => {
            const memoryUsage = process.memoryUsage();
            const heapUsedPercentage = memoryUsage.heapUsed / memoryUsage.heapTotal;
            
            return {
                healthy: heapUsedPercentage < 0.9, // Considera sano se l'utilizzo è sotto il 90%
                degraded: heapUsedPercentage > 0.7, // Considera degradato se l'utilizzo è sopra il 70%
                metrics: {
                    heapUsed: memoryUsage.heapUsed,
                    heapTotal: memoryUsage.heapTotal,
                    heapUsedPercentage,
                    rss: memoryUsage.rss,
                    external: memoryUsage.external
                },
                reason: heapUsedPercentage > 0.9 ? 'High memory usage' : null
            };
        });
        
        // Controllo di CPU
        this.registerCheck('cpu', async () => {
            // Calcola l'utilizzo della CPU
            const startUsage = process.cpuUsage();
            
            // Attendi un breve periodo
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const endUsage = process.cpuUsage(startUsage);
            const totalUsage = endUsage.user + endUsage.system;
            
            // Converti in percentuale (approssimativa)
            const cpuUsage = totalUsage / 1000000 / 0.1 / require('os').cpus().length;
            
            return {
                healthy: cpuUsage < 0.9, // Considera sano se l'utilizzo è sotto il 90%
                degraded: cpuUsage > 0.7, // Considera degradato se l'utilizzo è sopra il 70%
                metrics: {
                    cpuUsage,
                    user: endUsage.user,
                    system: endUsage.system
                },
                reason: cpuUsage > 0.9 ? 'High CPU usage' : null
            };
        });
        
        // Controllo di disco
        this.registerCheck('disk', async () => {
            try {
                const fs = require('fs').promises;
                const os = require('os');
                
                // Scrivi un file temporaneo per verificare l'accesso al disco
                const tempFile = `${os.tmpdir()}/health-check-${Date.now()}.tmp`;
                const startTime = Date.now();
                
                await fs.writeFile(tempFile, 'health check');
                await fs.readFile(tempFile);
                await fs.unlink(tempFile);
                
                const duration = Date.now() - startTime;
                
                return {
                    healthy: duration < 500, // Considera sano se l'operazione richiede meno di 500ms
                    degraded: duration > 200, // Considera degradato se l'operazione richiede più di 200ms
                    metrics: {
                        ioLatency: duration
                    },
                    reason: duration > 500 ? 'High disk I/O latency' : null
                };
            } catch (error) {
                return {
                    healthy: false,
                    degraded: false,
                    metrics: {},
                    reason: `Disk error: ${error.message}`
                };
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
            this.checkAllComponents().catch(error => {
                this.logger.error(`Errore durante il controllo: ${error.message}`);
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
     * Registra un controllo personalizzato
     * @param {string} componentName - Nome del componente
     * @param {Function} checkFunction - Funzione di controllo
     * @returns {Object} - Configurazione del controllo registrato
     */
    registerCheck(componentName, checkFunction) {
        if (typeof checkFunction !== 'function') {
            throw new Error('La funzione di controllo è obbligatoria');
        }
        
        this.customChecks[componentName] = checkFunction;
        this.logger.info(`Controllo registrato per il componente: ${componentName}`);
        
        return { componentName, checkFunction };
    }

    /**
     * Registra un componente
     * @param {string} componentName - Nome del componente
     * @param {Object} componentConfig - Configurazione del componente
     * @param {string[]} [componentConfig.dependencies] - Dipendenze del componente
     * @param {Function} [componentConfig.checkFunction] - Funzione di controllo personalizzata
     * @returns {Object} - Configurazione del componente registrato
     */
    registerComponent(componentName, componentConfig) {
        if (!componentConfig) {
            throw new Error('La configurazione del componente è obbligatoria');
        }
        
        this.components[componentName] = {
            dependencies: componentConfig.dependencies || [],
            ...componentConfig
        };
        
        if (componentConfig.checkFunction) {
            this.registerCheck(componentName, componentConfig.checkFunction);
        }
        
        this.logger.info(`Componente registrato: ${componentName}`);
        
        return this.components[componentName];
    }

    /**
     * Controlla lo stato di un componente
     * @param {string} componentName - Nome del componente
     * @returns {Promise<Object>} - Stato del componente
     */
    async checkComponent(componentName) {
        // Verifica se il componente è definito
        if (!this.components[componentName] && !this.customChecks[componentName]) {
            this.logger.warn(`Componente non definito: ${componentName}`);
            return {
                healthy: false,
                degraded: false,
                metrics: {},
                reason: 'Component not defined'
            };
        }
        
        try {
            // Esegui il controllo personalizzato se disponibile
            if (this.customChecks[componentName]) {
                const result = await this.customChecks[componentName]();
                
                // Aggiorna i risultati dell'ultimo controllo
                this.lastCheckResults[componentName] = {
                    ...result,
                    timestamp: new Date().toISOString()
                };
                
                return result;
            }
            
            // Altrimenti, controlla le dipendenze
            const component = this.components[componentName];
            const dependencies = component.dependencies || [];
            
            if (dependencies.length === 0) {
                return {
                    healthy: true,
                    degraded: false,
                    metrics: {},
                    reason: null
                };
            }
            
            // Controlla tutte le dipendenze
            const dependencyResults = {};
            let allHealthy = true;
            let anyDegraded = false;
            
            for (const dependency of dependencies) {
                const result = await this.checkComponent(dependency);
                dependencyResults[dependency] = result;
                
                if (!result.healthy) {
                    allHealthy = false;
                }
                
                if (result.degraded) {
                    anyDegraded = true;
                }
            }
            
            const result = {
                healthy: allHealthy,
                degraded: anyDegraded,
                metrics: {},
                dependencies: dependencyResults,
                reason: allHealthy ? null : 'One or more dependencies unhealthy'
            };
            
            // Aggiorna i risultati dell'ultimo controllo
            this.lastCheckResults[componentName] = {
                ...result,
                timestamp: new Date().toISOString()
            };
            
            return result;
        } catch (error) {
            this.logger.error(`Errore durante il controllo del componente ${componentName}: ${error.message}`);
            
            const result = {
                healthy: false,
                degraded: false,
                metrics: {},
                error: error.message,
                reason: `Check error: ${error.message}`
            };
            
            // Aggiorna i risultati dell'ultimo controllo
            this.lastCheckResults[componentName] = {
                ...result,
                timestamp: new Date().toISOString()
            };
            
            return result;
        }
    }

    /**
     * Controlla lo stato di più componenti
     * @param {string[]} componentNames - Nomi dei componenti
     * @returns {Promise<Object>} - Stato dei componenti
     */
    async checkComponents(componentNames) {
        const results = {
            components: {},
            allHealthy: true,
            anyDegraded: false,
            timestamp: new Date().toISOString()
        };
        
        for (const componentName of componentNames) {
            const result = await this.checkComponent(componentName);
            results.components[componentName] = result;
            
            if (!result.healthy) {
                results.allHealthy = false;
            }
            
            if (result.degraded) {
                results.anyDegraded = true;
            }
        }
        
        return results;
    }

    /**
     * Controlla lo stato di tutti i componenti
     * @returns {Promise<Object>} - Stato di tutti i componenti
     */
    async checkAllComponents() {
        const componentNames = [
            ...Object.keys(this.components),
            ...Object.keys(this.customChecks).filter(name => !this.components[name])
        ];
        
        const results = await this.checkComponents(componentNames);
        
        this.lastCheckTime = Date.now();
        this.emit('check_completed', results);
        
        return results;
    }

    /**
     * Ottiene i risultati dell'ultimo controllo
     * @param {string} [componentName] - Nome del componente (opzionale)
     * @returns {Object} - Risultati dell'ultimo controllo
     */
    getLastCheckResults(componentName) {
        if (componentName) {
            return this.lastCheckResults[componentName] || null;
        }
        
        return {
            results: { ...this.lastCheckResults },
            lastCheckTime: this.lastCheckTime,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = { HealthChecks };
