/**
 * Sistema di Analisi delle Performance per il Layer-2 su Solana
 * 
 * Questo modulo implementa un sistema di analisi delle performance che monitora
 * e analizza le prestazioni del sistema, identificando colli di bottiglia e
 * suggerendo ottimizzazioni.
 */

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

/**
 * Classe PerformanceAnalyzer
 * 
 * Implementa un sistema di analisi delle performance con supporto per
 * monitoraggio in tempo reale, analisi storica e suggerimenti di ottimizzazione.
 */
class PerformanceAnalyzer extends EventEmitter {
    /**
     * Costruttore
     * @param {Object} config - Configurazione del sistema di analisi
     * @param {string} [config.dataDir] - Directory per i dati di performance
     * @param {number} [config.sampleInterval=5000] - Intervallo di campionamento in ms
     * @param {number} [config.retentionPeriod=7] - Periodo di conservazione dei dati in giorni
     * @param {Object} [config.thresholds] - Soglie per gli alert
     * @param {Function} [config.logger] - Funzione di logging
     */
    constructor(config = {}) {
        super();
        
        this.config = {
            dataDir: config.dataDir || path.join(process.cwd(), 'performance-data'),
            sampleInterval: config.sampleInterval || 5000, // 5 secondi
            retentionPeriod: config.retentionPeriod || 7, // 7 giorni
            thresholds: {
                cpu: 80, // percentuale
                memory: 80, // percentuale
                disk: 80, // percentuale
                responseTime: 500, // ms
                errorRate: 5, // percentuale
                ...config.thresholds
            },
            ...config
        };
        
        // Stato del sistema
        this.isInitialized = false;
        this.isRunning = false;
        this.samplingTimer = null;
        
        // Logger
        this.logger = this.config.logger || console;
        
        // Dati di performance
        this.currentMetrics = {};
        this.historicalMetrics = [];
        this.anomalies = [];
        this.optimizationSuggestions = [];
        
        // Contatori
        this.counters = {
            requests: 0,
            errors: 0,
            transactions: 0,
            processingTime: 0
        };
        
        // Metriche personalizzate
        this.customMetrics = {};
    }

    /**
     * Inizializza il sistema di analisi delle performance
     * @returns {Promise<boolean>} - True se l'inizializzazione è riuscita
     */
    async initialize() {
        try {
            this.logger.info('Inizializzazione del sistema di analisi delle performance...');
            
            // Crea la directory dei dati se non esiste
            await fs.mkdir(this.config.dataDir, { recursive: true });
            
            // Carica i dati storici se esistono
            await this._loadHistoricalData();
            
            this.isInitialized = true;
            this.emit('initialized');
            
            this.logger.info('Sistema di analisi delle performance inizializzato con successo');
            return true;
        } catch (error) {
            this.logger.error(`Errore durante l'inizializzazione del sistema di analisi delle performance: ${error.message}`);
            throw error;
        }
    }

    /**
     * Carica i dati storici
     * @returns {Promise<void>}
     * @private
     */
    async _loadHistoricalData() {
        try {
            const dataFile = path.join(this.config.dataDir, 'historical-metrics.json');
            
            try {
                await fs.access(dataFile);
            } catch (error) {
                // Il file non esiste, inizializza con un array vuoto
                this.historicalMetrics = [];
                return;
            }
            
            // Leggi il file
            const data = await fs.readFile(dataFile, 'utf8');
            
            // Parsa il JSON
            this.historicalMetrics = JSON.parse(data);
            
            // Filtra i dati in base al periodo di conservazione
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionPeriod);
            
            this.historicalMetrics = this.historicalMetrics.filter(metric => 
                new Date(metric.timestamp) >= cutoffDate
            );
            
            this.logger.info(`Caricati ${this.historicalMetrics.length} record di metriche storiche`);
        } catch (error) {
            this.logger.error(`Errore durante il caricamento dei dati storici: ${error.message}`);
            this.historicalMetrics = [];
        }
    }

    /**
     * Salva i dati storici
     * @returns {Promise<boolean>} - True se il salvataggio è riuscito
     * @private
     */
    async _saveHistoricalData() {
        try {
            const dataFile = path.join(this.config.dataDir, 'historical-metrics.json');
            
            // Filtra i dati in base al periodo di conservazione
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionPeriod);
            
            this.historicalMetrics = this.historicalMetrics.filter(metric => 
                new Date(metric.timestamp) >= cutoffDate
            );
            
            // Scrivi il file
            await fs.writeFile(dataFile, JSON.stringify(this.historicalMetrics), 'utf8');
            
            return true;
        } catch (error) {
            this.logger.error(`Errore durante il salvataggio dei dati storici: ${error.message}`);
            return false;
        }
    }

    /**
     * Avvia il monitoraggio delle performance
     * @returns {Promise<boolean>} - True se l'avvio è riuscito
     */
    async start() {
        if (!this.isInitialized) {
            throw new Error('Il sistema di analisi delle performance non è inizializzato');
        }
        
        if (this.isRunning) {
            this.logger.warn('Il sistema di analisi delle performance è già in esecuzione');
            return true;
        }
        
        try {
            this.logger.info('Avvio del monitoraggio delle performance...');
            
            // Esegui un campionamento iniziale
            await this._sampleMetrics();
            
            // Avvia il timer per il campionamento periodico
            this.samplingTimer = setInterval(async () => {
                try {
                    await this._sampleMetrics();
                } catch (error) {
                    this.logger.error(`Errore durante il campionamento delle metriche: ${error.message}`);
                }
            }, this.config.sampleInterval);
            
            this.isRunning = true;
            this.emit('started');
            
            this.logger.info('Monitoraggio delle performance avviato con successo');
            return true;
        } catch (error) {
            this.logger.error(`Errore durante l'avvio del monitoraggio delle performance: ${error.message}`);
            throw error;
        }
    }

    /**
     * Ferma il monitoraggio delle performance
     * @returns {Promise<boolean>} - True se l'arresto è riuscito
     */
    async stop() {
        if (!this.isRunning) {
            this.logger.warn('Il sistema di analisi delle performance non è in esecuzione');
            return true;
        }
        
        try {
            this.logger.info('Arresto del monitoraggio delle performance...');
            
            // Ferma il timer
            if (this.samplingTimer) {
                clearInterval(this.samplingTimer);
                this.samplingTimer = null;
            }
            
            // Salva i dati storici
            await this._saveHistoricalData();
            
            this.isRunning = false;
            this.emit('stopped');
            
            this.logger.info('Monitoraggio delle performance arrestato con successo');
            return true;
        } catch (error) {
            this.logger.error(`Errore durante l'arresto del monitoraggio delle performance: ${error.message}`);
            throw error;
        }
    }

    /**
     * Campiona le metriche di performance
     * @returns {Promise<Object>} - Metriche campionate
     * @private
     */
    async _sampleMetrics() {
        try {
            // Campiona le metriche di sistema
            const systemMetrics = await this._sampleSystemMetrics();
            
            // Campiona le metriche dell'applicazione
            const appMetrics = this._sampleApplicationMetrics();
            
            // Campiona le metriche di rete
            const networkMetrics = await this._sampleNetworkMetrics();
            
            // Campiona le metriche del database
            const dbMetrics = await this._sampleDatabaseMetrics();
            
            // Campiona le metriche personalizzate
            const customMetrics = this._sampleCustomMetrics();
            
            // Combina tutte le metriche
            const metrics = {
                timestamp: new Date().toISOString(),
                system: systemMetrics,
                application: appMetrics,
                network: networkMetrics,
                database: dbMetrics,
                custom: customMetrics
            };
            
            // Aggiorna le metriche correnti
            this.currentMetrics = metrics;
            
            // Aggiungi alle metriche storiche
            this.historicalMetrics.push(metrics);
            
            // Limita la dimensione delle metriche storiche in memoria
            if (this.historicalMetrics.length > 1000) {
                this.historicalMetrics = this.historicalMetrics.slice(-1000);
            }
            
            // Analizza le metriche
            this._analyzeMetrics(metrics);
            
            // Emetti evento
            this.emit('metrics_sampled', metrics);
            
            return metrics;
        } catch (error) {
            this.logger.error(`Errore durante il campionamento delle metriche: ${error.message}`);
            throw error;
        }
    }

    /**
     * Campiona le metriche di sistema
     * @returns {Promise<Object>} - Metriche di sistema
     * @private
     */
    async _sampleSystemMetrics() {
        try {
            // CPU
            const cpuUsage = await this._getCpuUsage();
            
            // Memoria
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            const memoryUsage = (usedMem / totalMem) * 100;
            
            // Disco
            const diskUsage = await this._getDiskUsage();
            
            // Carico di sistema
            const loadAvg = os.loadavg();
            
            return {
                cpu: {
                    usage: cpuUsage,
                    cores: os.cpus().length,
                    model: os.cpus()[0].model,
                    speed: os.cpus()[0].speed
                },
                memory: {
                    total: totalMem,
                    free: freeMem,
                    used: usedMem,
                    usage: memoryUsage
                },
                disk: diskUsage,
                load: {
                    avg1: loadAvg[0],
                    avg5: loadAvg[1],
                    avg15: loadAvg[2]
                },
                uptime: os.uptime()
            };
        } catch (error) {
            this.logger.error(`Errore durante il campionamento delle metriche di sistema: ${error.message}`);
            return {
                error: error.message
            };
        }
    }

    /**
     * Ottiene l'utilizzo della CPU
     * @returns {Promise<number>} - Utilizzo della CPU in percentuale
     * @private
     */
    async _getCpuUsage() {
        return new Promise((resolve) => {
            const startMeasure = this._getCpuInfo();
            
            // Attendi 100ms per un campionamento più accurato
            setTimeout(() => {
                const endMeasure = this._getCpuInfo();
                const idleDifference = endMeasure.idle - startMeasure.idle;
                const totalDifference = endMeasure.total - startMeasure.total;
                
                const usage = 100 - (100 * idleDifference / totalDifference);
                resolve(usage);
            }, 100);
        });
    }

    /**
     * Ottiene le informazioni sulla CPU
     * @returns {Object} - Informazioni sulla CPU
     * @private
     */
    _getCpuInfo() {
        const cpus = os.cpus();
        
        let idle = 0;
        let total = 0;
        
        for (const cpu of cpus) {
            for (const type in cpu.times) {
                total += cpu.times[type];
            }
            idle += cpu.times.idle;
        }
        
        return {
            idle,
            total
        };
    }

    /**
     * Ottiene l'utilizzo del disco
     * @returns {Promise<Object>} - Utilizzo del disco
     * @private
     */
    async _getDiskUsage() {
        try {
            // Esegui il comando df
            const { stdout } = await exec('df -k / | tail -1');
            
            // Parsa l'output
            const parts = stdout.trim().split(/\s+/);
            
            const total = parseInt(parts[1]) * 1024; // KB to bytes
            const used = parseInt(parts[2]) * 1024; // KB to bytes
            const free = parseInt(parts[3]) * 1024; // KB to bytes
            const usage = (used / total) * 100;
            
            return {
                total,
                used,
                free,
                usage
            };
        } catch (error) {
            this.logger.error(`Errore durante il campionamento dell'utilizzo del disco: ${error.message}`);
            return {
                error: error.message
            };
        }
    }

    /**
     * Campiona le metriche dell'applicazione
     * @returns {Object} - Metriche dell'applicazione
     * @private
     */
    _sampleApplicationMetrics() {
        try {
            // Calcola il tasso di errore
            const errorRate = this.counters.requests > 0 
                ? (this.counters.errors / this.counters.requests) * 100 
                : 0;
            
            // Calcola il tempo medio di risposta
            const avgResponseTime = this.counters.requests > 0 
                ? this.counters.processingTime / this.counters.requests 
                : 0;
            
            // Ottieni le metriche del processo Node.js
            const processMetrics = process.memoryUsage();
            
            return {
                requests: this.counters.requests,
                errors: this.counters.errors,
                errorRate,
                transactions: this.counters.transactions,
                avgResponseTime,
                process: {
                    rss: processMetrics.rss,
                    heapTotal: processMetrics.heapTotal,
                    heapUsed: processMetrics.heapUsed,
                    external: processMetrics.external,
                    arrayBuffers: processMetrics.arrayBuffers
                }
            };
        } catch (error) {
            this.logger.error(`Errore durante il campionamento delle metriche dell'applicazione: ${error.message}`);
            return {
                error: error.message
            };
        }
    }

    /**
     * Campiona le metriche di rete
     * @returns {Promise<Object>} - Metriche di rete
     * @private
     */
    async _sampleNetworkMetrics() {
        try {
            // Esegui il comando netstat
            const { stdout } = await exec('netstat -an | grep ESTABLISHED | wc -l');
            
            // Parsa l'output
            const connections = parseInt(stdout.trim());
            
            return {
                connections
            };
        } catch (error) {
            this.logger.error(`Errore durante il campionamento delle metriche di rete: ${error.message}`);
            return {
                error: error.message
            };
        }
    }

    /**
     * Campiona le metriche del database
     * @returns {Promise<Object>} - Metriche del database
     * @private
     */
    async _sampleDatabaseMetrics() {
        try {
            // In un sistema reale, questo metodo interrogherebbe il database
            // per ottenere metriche come connessioni attive, query al secondo, ecc.
            
            return {
                // Metriche di esempio
                connections: 10,
                queriesPerSecond: 100,
                avgQueryTime: 5
            };
        } catch (error) {
            this.logger.error(`Errore durante il campionamento delle metriche del database: ${error.message}`);
            return {
                error: error.message
            };
        }
    }

    /**
     * Campiona le metriche personalizzate
     * @returns {Object} - Metriche personalizzate
     * @private
     */
    _sampleCustomMetrics() {
        return { ...this.customMetrics };
    }

    /**
     * Analizza le metriche
     * @param {Object} metrics - Metriche da analizzare
     * @private
     */
    _analyzeMetrics(metrics) {
        try {
            // Verifica le soglie
            this._checkThresholds(metrics);
            
            // Identifica le anomalie
            this._identifyAnomalies(metrics);
            
            // Genera suggerimenti di ottimizzazione
            this._generateOptimizationSuggestions(metrics);
        } catch (error) {
            this.logger.error(`Errore durante l'analisi delle metriche: ${error.message}`);
        }
    }

    /**
     * Verifica le soglie
     * @param {Object} metrics - Metriche da verificare
     * @private
     */
    _checkThresholds(metrics) {
        const alerts = [];
        
        // Verifica la CPU
        if (metrics.system.cpu.usage > this.config.thresholds.cpu) {
            alerts.push({
                type: 'threshold',
                metric: 'cpu',
                value: metrics.system.cpu.usage,
                threshold: this.config.thresholds.cpu,
                message: `Utilizzo della CPU (${metrics.system.cpu.usage.toFixed(2)}%) superiore alla soglia (${this.config.thresholds.cpu}%)`
            });
        }
        
        // Verifica la memoria
        if (metrics.system.memory.usage > this.config.thresholds.memory) {
            alerts.push({
                type: 'threshold',
                metric: 'memory',
                value: metrics.system.memory.usage,
                threshold: this.config.thresholds.memory,
                message: `Utilizzo della memoria (${metrics.system.memory.usage.toFixed(2)}%) superiore alla soglia (${this.config.thresholds.memory}%)`
            });
        }
        
        // Verifica il disco
        if (metrics.system.disk.usage > this.config.thresholds.disk) {
            alerts.push({
                type: 'threshold',
                metric: 'disk',
                value: metrics.system.disk.usage,
                threshold: this.config.thresholds.disk,
                message: `Utilizzo del disco (${metrics.system.disk.usage.toFixed(2)}%) superiore alla soglia (${this.config.thresholds.disk}%)`
            });
        }
        
        // Verifica il tempo di risposta
        if (metrics.application.avgResponseTime > this.config.thresholds.responseTime) {
            alerts.push({
                type: 'threshold',
                metric: 'responseTime',
                value: metrics.application.avgResponseTime,
                threshold: this.config.thresholds.responseTime,
                message: `Tempo medio di risposta (${metrics.application.avgResponseTime.toFixed(2)}ms) superiore alla soglia (${this.config.thresholds.responseTime}ms)`
            });
        }
        
        // Verifica il tasso di errore
        if (metrics.application.errorRate > this.config.thresholds.errorRate) {
            alerts.push({
                type: 'threshold',
                metric: 'errorRate',
                value: metrics.application.errorRate,
                threshold: this.config.thresholds.errorRate,
                message: `Tasso di errore (${metrics.application.errorRate.toFixed(2)}%) superiore alla soglia (${this.config.thresholds.errorRate}%)`
            });
        }
        
        // Emetti eventi per gli alert
        for (const alert of alerts) {
            this.emit('threshold_exceeded', alert);
            this.logger.warn(alert.message);
        }
    }

    /**
     * Identifica le anomalie
     * @param {Object} metrics - Metriche da analizzare
     * @private
     */
    _identifyAnomalies(metrics) {
        // Verifica se ci sono abbastanza dati storici
        if (this.historicalMetrics.length < 10) {
            return;
        }
        
        const anomalies = [];
        
        // Calcola le statistiche per le metriche principali
        const cpuStats = this._calculateStats(this.historicalMetrics.map(m => m.system.cpu.usage));
        const memoryStats = this._calculateStats(this.historicalMetrics.map(m => m.system.memory.usage));
        const responseTimeStats = this._calculateStats(this.historicalMetrics.map(m => m.application.avgResponseTime));
        const errorRateStats = this._calculateStats(this.historicalMetrics.map(m => m.application.errorRate));
        
        // Verifica le anomalie della CPU
        if (Math.abs(metrics.system.cpu.usage - cpuStats.mean) > 3 * cpuStats.stdDev) {
            anomalies.push({
                type: 'anomaly',
                metric: 'cpu',
                value: metrics.system.cpu.usage,
                expected: cpuStats.mean,
                deviation: Math.abs(metrics.system.cpu.usage - cpuStats.mean) / cpuStats.stdDev,
                message: `Anomalia nell'utilizzo della CPU: ${metrics.system.cpu.usage.toFixed(2)}% (atteso: ${cpuStats.mean.toFixed(2)}% ± ${cpuStats.stdDev.toFixed(2)}%)`
            });
        }
        
        // Verifica le anomalie della memoria
        if (Math.abs(metrics.system.memory.usage - memoryStats.mean) > 3 * memoryStats.stdDev) {
            anomalies.push({
                type: 'anomaly',
                metric: 'memory',
                value: metrics.system.memory.usage,
                expected: memoryStats.mean,
                deviation: Math.abs(metrics.system.memory.usage - memoryStats.mean) / memoryStats.stdDev,
                message: `Anomalia nell'utilizzo della memoria: ${metrics.system.memory.usage.toFixed(2)}% (atteso: ${memoryStats.mean.toFixed(2)}% ± ${memoryStats.stdDev.toFixed(2)}%)`
            });
        }
        
        // Verifica le anomalie del tempo di risposta
        if (Math.abs(metrics.application.avgResponseTime - responseTimeStats.mean) > 3 * responseTimeStats.stdDev) {
            anomalies.push({
                type: 'anomaly',
                metric: 'responseTime',
                value: metrics.application.avgResponseTime,
                expected: responseTimeStats.mean,
                deviation: Math.abs(metrics.application.avgResponseTime - responseTimeStats.mean) / responseTimeStats.stdDev,
                message: `Anomalia nel tempo medio di risposta: ${metrics.application.avgResponseTime.toFixed(2)}ms (atteso: ${responseTimeStats.mean.toFixed(2)}ms ± ${responseTimeStats.stdDev.toFixed(2)}ms)`
            });
        }
        
        // Verifica le anomalie del tasso di errore
        if (Math.abs(metrics.application.errorRate - errorRateStats.mean) > 3 * errorRateStats.stdDev) {
            anomalies.push({
                type: 'anomaly',
                metric: 'errorRate',
                value: metrics.application.errorRate,
                expected: errorRateStats.mean,
                deviation: Math.abs(metrics.application.errorRate - errorRateStats.mean) / errorRateStats.stdDev,
                message: `Anomalia nel tasso di errore: ${metrics.application.errorRate.toFixed(2)}% (atteso: ${errorRateStats.mean.toFixed(2)}% ± ${errorRateStats.stdDev.toFixed(2)}%)`
            });
        }
        
        // Aggiungi le anomalie alla lista
        for (const anomaly of anomalies) {
            this.anomalies.push({
                ...anomaly,
                timestamp: metrics.timestamp
            });
            
            // Limita la dimensione della lista
            if (this.anomalies.length > 100) {
                this.anomalies = this.anomalies.slice(-100);
            }
            
            // Emetti evento
            this.emit('anomaly_detected', anomaly);
            this.logger.warn(anomaly.message);
        }
    }

    /**
     * Calcola le statistiche per un array di valori
     * @param {Array<number>} values - Valori
     * @returns {Object} - Statistiche
     * @private
     */
    _calculateStats(values) {
        const n = values.length;
        
        // Calcola la media
        const mean = values.reduce((sum, value) => sum + value, 0) / n;
        
        // Calcola la deviazione standard
        const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / n;
        const stdDev = Math.sqrt(variance);
        
        // Calcola il minimo e il massimo
        const min = Math.min(...values);
        const max = Math.max(...values);
        
        return {
            mean,
            stdDev,
            min,
            max,
            count: n
        };
    }

    /**
     * Genera suggerimenti di ottimizzazione
     * @param {Object} metrics - Metriche da analizzare
     * @private
     */
    _generateOptimizationSuggestions(metrics) {
        const suggestions = [];
        
        // Suggerimenti per l'utilizzo della CPU
        if (metrics.system.cpu.usage > 70) {
            suggestions.push({
                type: 'optimization',
                metric: 'cpu',
                priority: metrics.system.cpu.usage > 90 ? 'high' : 'medium',
                message: 'Considerare l\'ottimizzazione del codice o lo scaling orizzontale per ridurre l\'utilizzo della CPU',
                actions: [
                    'Identificare e ottimizzare le operazioni CPU-intensive',
                    'Implementare il caching per ridurre il carico di lavoro',
                    'Considerare l\'aggiunta di più istanze (scaling orizzontale)'
                ]
            });
        }
        
        // Suggerimenti per l'utilizzo della memoria
        if (metrics.system.memory.usage > 70) {
            suggestions.push({
                type: 'optimization',
                metric: 'memory',
                priority: metrics.system.memory.usage > 90 ? 'high' : 'medium',
                message: 'Considerare l\'ottimizzazione dell\'utilizzo della memoria',
                actions: [
                    'Verificare la presenza di memory leak',
                    'Ottimizzare le strutture dati per ridurre l\'utilizzo della memoria',
                    'Implementare la pulizia periodica della cache',
                    'Considerare l\'aggiunta di più memoria (scaling verticale)'
                ]
            });
        }
        
        // Suggerimenti per il tempo di risposta
        if (metrics.application.avgResponseTime > this.config.thresholds.responseTime) {
            suggestions.push({
                type: 'optimization',
                metric: 'responseTime',
                priority: metrics.application.avgResponseTime > this.config.thresholds.responseTime * 2 ? 'high' : 'medium',
                message: 'Considerare l\'ottimizzazione del tempo di risposta',
                actions: [
                    'Implementare o migliorare il caching',
                    'Ottimizzare le query del database',
                    'Ridurre il numero di chiamate API esterne',
                    'Implementare l\'elaborazione asincrona per le operazioni lunghe'
                ]
            });
        }
        
        // Suggerimenti per il tasso di errore
        if (metrics.application.errorRate > this.config.thresholds.errorRate) {
            suggestions.push({
                type: 'optimization',
                metric: 'errorRate',
                priority: metrics.application.errorRate > this.config.thresholds.errorRate * 2 ? 'high' : 'medium',
                message: 'Considerare l\'ottimizzazione per ridurre il tasso di errore',
                actions: [
                    'Analizzare i log per identificare le cause degli errori',
                    'Implementare meccanismi di retry per le operazioni fallite',
                    'Migliorare la gestione degli errori',
                    'Implementare circuit breaker per i servizi esterni inaffidabili'
                ]
            });
        }
        
        // Aggiungi i suggerimenti alla lista
        for (const suggestion of suggestions) {
            // Verifica se esiste già un suggerimento simile
            const existingSuggestion = this.optimizationSuggestions.find(s => 
                s.type === suggestion.type && 
                s.metric === suggestion.metric
            );
            
            if (existingSuggestion) {
                // Aggiorna la priorità se necessario
                if (suggestion.priority === 'high' && existingSuggestion.priority !== 'high') {
                    existingSuggestion.priority = 'high';
                    existingSuggestion.updatedAt = metrics.timestamp;
                }
            } else {
                // Aggiungi il nuovo suggerimento
                this.optimizationSuggestions.push({
                    ...suggestion,
                    createdAt: metrics.timestamp,
                    updatedAt: metrics.timestamp
                });
                
                // Emetti evento
                this.emit('optimization_suggested', suggestion);
                this.logger.info(suggestion.message);
            }
        }
        
        // Limita la dimensione della lista
        if (this.optimizationSuggestions.length > 100) {
            this.optimizationSuggestions = this.optimizationSuggestions.slice(-100);
        }
    }

    /**
     * Registra una richiesta
     * @param {Object} options - Opzioni della richiesta
     * @param {number} options.processingTime - Tempo di elaborazione in ms
     * @param {boolean} [options.error=false] - Se la richiesta ha generato un errore
     * @param {boolean} [options.transaction=false] - Se la richiesta ha generato una transazione
     */
    recordRequest(options) {
        this.counters.requests++;
        
        if (options.error) {
            this.counters.errors++;
        }
        
        if (options.transaction) {
            this.counters.transactions++;
        }
        
        this.counters.processingTime += options.processingTime;
    }

    /**
     * Registra una metrica personalizzata
     * @param {string} name - Nome della metrica
     * @param {number|Object} value - Valore della metrica
     */
    recordCustomMetric(name, value) {
        this.customMetrics[name] = value;
    }

    /**
     * Resetta i contatori
     */
    resetCounters() {
        this.counters = {
            requests: 0,
            errors: 0,
            transactions: 0,
            processingTime: 0
        };
    }

    /**
     * Genera un report delle performance
     * @param {Object} [options] - Opzioni del report
     * @param {string} [options.format='json'] - Formato del report
     * @param {string} [options.period='day'] - Periodo del report
     * @param {string} [options.startDate] - Data di inizio
     * @param {string} [options.endDate] - Data di fine
     * @returns {Promise<Object>} - Report delle performance
     */
    async generateReport(options = {}) {
        if (!this.isInitialized) {
            throw new Error('Il sistema di analisi delle performance non è inizializzato');
        }
        
        try {
            const format = options.format || 'json';
            const period = options.period || 'day';
            
            // Determina l'intervallo di date
            let startDate, endDate;
            
            if (options.startDate && options.endDate) {
                startDate = new Date(options.startDate);
                endDate = new Date(options.endDate);
            } else {
                endDate = new Date();
                
                switch (period) {
                    case 'hour':
                        startDate = new Date(endDate);
                        startDate.setHours(endDate.getHours() - 1);
                        break;
                    case 'day':
                        startDate = new Date(endDate);
                        startDate.setDate(endDate.getDate() - 1);
                        break;
                    case 'week':
                        startDate = new Date(endDate);
                        startDate.setDate(endDate.getDate() - 7);
                        break;
                    case 'month':
                        startDate = new Date(endDate);
                        startDate.setMonth(endDate.getMonth() - 1);
                        break;
                    default:
                        throw new Error(`Periodo non valido: ${period}`);
                }
            }
            
            // Filtra le metriche in base all'intervallo di date
            const filteredMetrics = this.historicalMetrics.filter(metric => {
                const metricDate = new Date(metric.timestamp);
                return metricDate >= startDate && metricDate <= endDate;
            });
            
            // Calcola le statistiche
            const cpuStats = this._calculateStats(filteredMetrics.map(m => m.system.cpu.usage));
            const memoryStats = this._calculateStats(filteredMetrics.map(m => m.system.memory.usage));
            const diskStats = this._calculateStats(filteredMetrics.map(m => m.system.disk.usage));
            const responseTimeStats = this._calculateStats(filteredMetrics.map(m => m.application.avgResponseTime));
            const errorRateStats = this._calculateStats(filteredMetrics.map(m => m.application.errorRate));
            
            // Calcola le tendenze
            const cpuTrend = this._calculateTrend(filteredMetrics.map(m => ({ x: new Date(m.timestamp).getTime(), y: m.system.cpu.usage })));
            const memoryTrend = this._calculateTrend(filteredMetrics.map(m => ({ x: new Date(m.timestamp).getTime(), y: m.system.memory.usage })));
            const responseTimeTrend = this._calculateTrend(filteredMetrics.map(m => ({ x: new Date(m.timestamp).getTime(), y: m.application.avgResponseTime })));
            const errorRateTrend = this._calculateTrend(filteredMetrics.map(m => ({ x: new Date(m.timestamp).getTime(), y: m.application.errorRate })));
            
            // Crea il report
            const report = {
                period,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                metrics: {
                    count: filteredMetrics.length,
                    cpu: {
                        ...cpuStats,
                        trend: cpuTrend
                    },
                    memory: {
                        ...memoryStats,
                        trend: memoryTrend
                    },
                    disk: diskStats,
                    responseTime: {
                        ...responseTimeStats,
                        trend: responseTimeTrend
                    },
                    errorRate: {
                        ...errorRateStats,
                        trend: errorRateTrend
                    }
                },
                anomalies: this.anomalies.filter(anomaly => {
                    const anomalyDate = new Date(anomaly.timestamp);
                    return anomalyDate >= startDate && anomalyDate <= endDate;
                }),
                optimizationSuggestions: this.optimizationSuggestions.filter(suggestion => {
                    const suggestionDate = new Date(suggestion.createdAt);
                    return suggestionDate >= startDate && suggestionDate <= endDate;
                })
            };
            
            // Genera il report nel formato richiesto
            switch (format) {
                case 'json':
                    return report;
                case 'html':
                    return this._generateHtmlReport(report);
                case 'csv':
                    return this._generateCsvReport(report);
                default:
                    throw new Error(`Formato non valido: ${format}`);
            }
        } catch (error) {
            this.logger.error(`Errore durante la generazione del report: ${error.message}`);
            throw error;
        }
    }

    /**
     * Calcola la tendenza per un array di punti
     * @param {Array<Object>} points - Punti (x, y)
     * @returns {Object} - Tendenza
     * @private
     */
    _calculateTrend(points) {
        if (points.length < 2) {
            return {
                slope: 0,
                direction: 'stable'
            };
        }
        
        // Calcola la regressione lineare
        let sumX = 0;
        let sumY = 0;
        let sumXY = 0;
        let sumX2 = 0;
        
        for (const point of points) {
            sumX += point.x;
            sumY += point.y;
            sumXY += point.x * point.y;
            sumX2 += point.x * point.x;
        }
        
        const n = points.length;
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        
        // Determina la direzione
        let direction;
        
        if (slope > 0.01) {
            direction = 'increasing';
        } else if (slope < -0.01) {
            direction = 'decreasing';
        } else {
            direction = 'stable';
        }
        
        return {
            slope,
            direction
        };
    }

    /**
     * Genera un report HTML
     * @param {Object} report - Report
     * @returns {string} - Report HTML
     * @private
     */
    _generateHtmlReport(report) {
        // In un sistema reale, questo metodo genererebbe un report HTML completo
        // con grafici e tabelle
        
        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Performance Report</title>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 1200px; margin: 0 auto; padding: 20px; }
                    h1 { border-bottom: 2px solid #eee; padding-bottom: 10px; }
                    h2 { margin-top: 30px; border-bottom: 1px solid #eee; padding-bottom: 5px; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
                    th { background-color: #f2f2f2; }
                    .high { color: red; }
                    .medium { color: orange; }
                    .low { color: green; }
                </style>
            </head>
            <body>
                <h1>Performance Report</h1>
                <p>Period: ${report.period}</p>
                <p>Start Date: ${report.startDate}</p>
                <p>End Date: ${report.endDate}</p>
                
                <h2>Metrics Summary</h2>
                <table>
                    <tr>
                        <th>Metric</th>
                        <th>Min</th>
                        <th>Max</th>
                        <th>Mean</th>
                        <th>Std Dev</th>
                        <th>Trend</th>
                    </tr>
                    <tr>
                        <td>CPU Usage (%)</td>
                        <td>${report.metrics.cpu.min.toFixed(2)}</td>
                        <td>${report.metrics.cpu.max.toFixed(2)}</td>
                        <td>${report.metrics.cpu.mean.toFixed(2)}</td>
                        <td>${report.metrics.cpu.stdDev.toFixed(2)}</td>
                        <td>${report.metrics.cpu.trend.direction}</td>
                    </tr>
                    <tr>
                        <td>Memory Usage (%)</td>
                        <td>${report.metrics.memory.min.toFixed(2)}</td>
                        <td>${report.metrics.memory.max.toFixed(2)}</td>
                        <td>${report.metrics.memory.mean.toFixed(2)}</td>
                        <td>${report.metrics.memory.stdDev.toFixed(2)}</td>
                        <td>${report.metrics.memory.trend.direction}</td>
                    </tr>
                    <tr>
                        <td>Disk Usage (%)</td>
                        <td>${report.metrics.disk.min.toFixed(2)}</td>
                        <td>${report.metrics.disk.max.toFixed(2)}</td>
                        <td>${report.metrics.disk.mean.toFixed(2)}</td>
                        <td>${report.metrics.disk.stdDev.toFixed(2)}</td>
                        <td>N/A</td>
                    </tr>
                    <tr>
                        <td>Response Time (ms)</td>
                        <td>${report.metrics.responseTime.min.toFixed(2)}</td>
                        <td>${report.metrics.responseTime.max.toFixed(2)}</td>
                        <td>${report.metrics.responseTime.mean.toFixed(2)}</td>
                        <td>${report.metrics.responseTime.stdDev.toFixed(2)}</td>
                        <td>${report.metrics.responseTime.trend.direction}</td>
                    </tr>
                    <tr>
                        <td>Error Rate (%)</td>
                        <td>${report.metrics.errorRate.min.toFixed(2)}</td>
                        <td>${report.metrics.errorRate.max.toFixed(2)}</td>
                        <td>${report.metrics.errorRate.mean.toFixed(2)}</td>
                        <td>${report.metrics.errorRate.stdDev.toFixed(2)}</td>
                        <td>${report.metrics.errorRate.trend.direction}</td>
                    </tr>
                </table>
                
                <h2>Anomalies (${report.anomalies.length})</h2>
                ${report.anomalies.length > 0 ? `
                <table>
                    <tr>
                        <th>Timestamp</th>
                        <th>Metric</th>
                        <th>Value</th>
                        <th>Expected</th>
                        <th>Deviation</th>
                        <th>Message</th>
                    </tr>
                    ${report.anomalies.map(anomaly => `
                    <tr>
                        <td>${anomaly.timestamp}</td>
                        <td>${anomaly.metric}</td>
                        <td>${anomaly.value.toFixed(2)}</td>
                        <td>${anomaly.expected.toFixed(2)}</td>
                        <td>${anomaly.deviation.toFixed(2)}</td>
                        <td>${anomaly.message}</td>
                    </tr>
                    `).join('')}
                </table>
                ` : '<p>No anomalies detected.</p>'}
                
                <h2>Optimization Suggestions (${report.optimizationSuggestions.length})</h2>
                ${report.optimizationSuggestions.length > 0 ? `
                <table>
                    <tr>
                        <th>Created At</th>
                        <th>Metric</th>
                        <th>Priority</th>
                        <th>Message</th>
                        <th>Actions</th>
                    </tr>
                    ${report.optimizationSuggestions.map(suggestion => `
                    <tr>
                        <td>${suggestion.createdAt}</td>
                        <td>${suggestion.metric}</td>
                        <td class="${suggestion.priority}">${suggestion.priority}</td>
                        <td>${suggestion.message}</td>
                        <td>
                            <ul>
                                ${suggestion.actions.map(action => `<li>${action}</li>`).join('')}
                            </ul>
                        </td>
                    </tr>
                    `).join('')}
                </table>
                ` : '<p>No optimization suggestions.</p>'}
            </body>
            </html>
        `;
        
        return html;
    }

    /**
     * Genera un report CSV
     * @param {Object} report - Report
     * @returns {string} - Report CSV
     * @private
     */
    _generateCsvReport(report) {
        // In un sistema reale, questo metodo genererebbe un report CSV completo
        
        let csv = 'Metric,Min,Max,Mean,StdDev,Trend\n';
        
        csv += `CPU Usage (%),${report.metrics.cpu.min.toFixed(2)},${report.metrics.cpu.max.toFixed(2)},${report.metrics.cpu.mean.toFixed(2)},${report.metrics.cpu.stdDev.toFixed(2)},${report.metrics.cpu.trend.direction}\n`;
        csv += `Memory Usage (%),${report.metrics.memory.min.toFixed(2)},${report.metrics.memory.max.toFixed(2)},${report.metrics.memory.mean.toFixed(2)},${report.metrics.memory.stdDev.toFixed(2)},${report.metrics.memory.trend.direction}\n`;
        csv += `Disk Usage (%),${report.metrics.disk.min.toFixed(2)},${report.metrics.disk.max.toFixed(2)},${report.metrics.disk.mean.toFixed(2)},${report.metrics.disk.stdDev.toFixed(2)},N/A\n`;
        csv += `Response Time (ms),${report.metrics.responseTime.min.toFixed(2)},${report.metrics.responseTime.max.toFixed(2)},${report.metrics.responseTime.mean.toFixed(2)},${report.metrics.responseTime.stdDev.toFixed(2)},${report.metrics.responseTime.trend.direction}\n`;
        csv += `Error Rate (%),${report.metrics.errorRate.min.toFixed(2)},${report.metrics.errorRate.max.toFixed(2)},${report.metrics.errorRate.mean.toFixed(2)},${report.metrics.errorRate.stdDev.toFixed(2)},${report.metrics.errorRate.trend.direction}\n`;
        
        return csv;
    }

    /**
     * Ottiene lo stato del sistema di analisi delle performance
     * @returns {Object} - Stato del sistema
     */
    getStatus() {
        return {
            isInitialized: this.isInitialized,
            isRunning: this.isRunning,
            sampleInterval: this.config.sampleInterval,
            retentionPeriod: this.config.retentionPeriod,
            historicalMetrics: this.historicalMetrics.length,
            anomalies: this.anomalies.length,
            optimizationSuggestions: this.optimizationSuggestions.length,
            counters: { ...this.counters },
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = { PerformanceAnalyzer };
