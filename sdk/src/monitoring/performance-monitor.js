const { defaultLogger } = require('../logging/logger');
const { MetricsCollector } = require('./metrics-collector');
const os = require('os');
const { EventEmitter } = require('events');

/**
 * Classe per l'esportazione delle metriche verso sistemi esterni come Prometheus
 * 
 * Questa classe fornisce metodi per:
 * - Esporre le metriche in formato Prometheus
 * - Configurare endpoint HTTP per lo scraping delle metriche
 * - Inviare metriche a sistemi esterni
 */
class MetricsExporter {
  /**
   * Crea una nuova istanza dell'esportatore di metriche
   * @param {Object} options - Opzioni di configurazione
   * @param {Object} options.logger - Istanza del logger (opzionale)
   * @param {MetricsCollector} options.collector - Istanza del collector di metriche
   * @param {string} options.format - Formato di esportazione ('prometheus', 'json')
   */
  constructor(options = {}) {
    this.logger = options.logger || defaultLogger.child('metrics-exporter');
    this.collector = options.collector || new MetricsCollector({ logger: this.logger });
    this.format = options.format || 'prometheus';
    
    // Mappa delle metriche Prometheus
    this.prometheusMetrics = new Map();
    
    // Inizializza le metriche Prometheus di base
    this._initializePrometheusMetrics();
  }

  /**
   * Inizializza le metriche Prometheus di base
   * @private
   */
  _initializePrometheusMetrics() {
    // Metriche di sistema
    this._addGauge('system_memory_total', 'Total system memory in bytes');
    this._addGauge('system_memory_used', 'Used system memory in bytes');
    this._addGauge('system_memory_free', 'Free system memory in bytes');
    this._addGauge('system_memory_used_percentage', 'Percentage of system memory used');
    this._addGauge('system_cpu_load_1m', '1-minute load average');
    this._addGauge('system_cpu_load_5m', '5-minute load average');
    this._addGauge('system_cpu_load_15m', '15-minute load average');
    
    // Metriche di processo
    this._addGauge('process_uptime', 'Process uptime in seconds');
    this._addGauge('process_memory_rss', 'Process RSS memory usage in bytes');
    this._addGauge('process_memory_heap_total', 'Process total heap size in bytes');
    this._addGauge('process_memory_heap_used', 'Process used heap size in bytes');
    
    // Metriche di operazioni
    this._addCounter('operation_total', 'Total number of operations', ['operation']);
    this._addCounter('operation_success_total', 'Total number of successful operations', ['operation']);
    this._addCounter('operation_failure_total', 'Total number of failed operations', ['operation']);
    this._addGauge('operation_duration_seconds', 'Operation duration in seconds', ['operation', 'status']);
    
    // Metriche di transazioni
    this._addCounter('transaction_total', 'Total number of transactions', ['type']);
    this._addCounter('transaction_success_total', 'Total number of successful transactions', ['type']);
    this._addCounter('transaction_failure_total', 'Total number of failed transactions', ['type']);
  }

  /**
   * Aggiunge una metrica di tipo gauge
   * @param {string} name - Nome della metrica
   * @param {string} help - Descrizione della metrica
   * @param {Array<string>} labels - Etichette della metrica
   * @private
   */
  _addGauge(name, help, labels = []) {
    this.prometheusMetrics.set(name, {
      type: 'gauge',
      name,
      help,
      labels,
      values: new Map()
    });
  }

  /**
   * Aggiunge una metrica di tipo counter
   * @param {string} name - Nome della metrica
   * @param {string} help - Descrizione della metrica
   * @param {Array<string>} labels - Etichette della metrica
   * @private
   */
  _addCounter(name, help, labels = []) {
    this.prometheusMetrics.set(name, {
      type: 'counter',
      name,
      help,
      labels,
      values: new Map()
    });
  }

  /**
   * Aggiorna le metriche Prometheus con i dati più recenti
   * @private
   */
  _updatePrometheusMetrics() {
    const metrics = this.collector.getAllMetrics();
    
    // Aggiorna metriche di sistema
    if (metrics.system && metrics.system.memory) {
      this._setGaugeValue('system_memory_total', metrics.system.memory.total);
      this._setGaugeValue('system_memory_used', metrics.system.memory.used);
      this._setGaugeValue('system_memory_free', metrics.system.memory.free);
      this._setGaugeValue('system_memory_used_percentage', metrics.system.memory.usedPercentage);
    }
    
    if (metrics.system && metrics.system.cpu && metrics.system.cpu.loadAverage) {
      this._setGaugeValue('system_cpu_load_1m', metrics.system.cpu.loadAverage['1m']);
      this._setGaugeValue('system_cpu_load_5m', metrics.system.cpu.loadAverage['5m']);
      this._setGaugeValue('system_cpu_load_15m', metrics.system.cpu.loadAverage['15m']);
    }
    
    // Aggiorna metriche di processo
    if (metrics.system && metrics.system.process) {
      this._setGaugeValue('process_uptime', metrics.system.process.uptime);
      this._setGaugeValue('process_memory_rss', metrics.system.process.memory.rss);
      this._setGaugeValue('process_memory_heap_total', metrics.system.process.memory.heapTotal);
      this._setGaugeValue('process_memory_heap_used', metrics.system.process.memory.heapUsed);
    }
    
    // Aggiorna metriche di operazioni
    if (metrics.operations) {
      Object.entries(metrics.operations).forEach(([opName, opMetrics]) => {
        this._setCounterValue('operation_total', opMetrics.count, { operation: opName });
        this._setCounterValue('operation_success_total', opMetrics.successCount, { operation: opName });
        this._setCounterValue('operation_failure_total', opMetrics.failureCount, { operation: opName });
        
        if (opMetrics.count > 0) {
          this._setGaugeValue('operation_duration_seconds', opMetrics.avgDuration / 1000, { 
            operation: opName, 
            status: 'avg' 
          });
          this._setGaugeValue('operation_duration_seconds', opMetrics.minDuration / 1000, { 
            operation: opName, 
            status: 'min' 
          });
          this._setGaugeValue('operation_duration_seconds', opMetrics.maxDuration / 1000, { 
            operation: opName, 
            status: 'max' 
          });
        }
      });
    }
    
    // Aggiorna metriche di transazioni
    if (metrics.transactions) {
      Object.entries(metrics.transactions).forEach(([txType, txMetrics]) => {
        this._setCounterValue('transaction_total', txMetrics.count, { type: txType });
        this._setCounterValue('transaction_success_total', txMetrics.successCount, { type: txType });
        this._setCounterValue('transaction_failure_total', txMetrics.failureCount, { type: txType });
      });
    }
  }

  /**
   * Imposta il valore di una metrica gauge
   * @param {string} name - Nome della metrica
   * @param {number} value - Valore della metrica
   * @param {Object} labelValues - Valori delle etichette
   * @private
   */
  _setGaugeValue(name, value, labelValues = {}) {
    const metric = this.prometheusMetrics.get(name);
    if (!metric) return;
    
    const labelKey = this._getLabelKey(labelValues);
    metric.values.set(labelKey, { value, labelValues });
  }

  /**
   * Imposta il valore di una metrica counter
   * @param {string} name - Nome della metrica
   * @param {number} value - Valore della metrica
   * @param {Object} labelValues - Valori delle etichette
   * @private
   */
  _setCounterValue(name, value, labelValues = {}) {
    const metric = this.prometheusMetrics.get(name);
    if (!metric) return;
    
    const labelKey = this._getLabelKey(labelValues);
    metric.values.set(labelKey, { value, labelValues });
  }

  /**
   * Genera una chiave univoca per le etichette
   * @param {Object} labelValues - Valori delle etichette
   * @returns {string} Chiave univoca
   * @private
   */
  _getLabelKey(labelValues) {
    return Object.entries(labelValues)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  /**
   * Genera le metriche in formato Prometheus
   * @returns {string} Metriche in formato Prometheus
   */
  getPrometheusMetrics() {
    this._updatePrometheusMetrics();
    
    let output = '';
    
    for (const metric of this.prometheusMetrics.values()) {
      // Aggiungi header della metrica
      output += `# HELP ${metric.name} ${metric.help}\n`;
      output += `# TYPE ${metric.name} ${metric.type}\n`;
      
      // Aggiungi valori della metrica
      for (const { value, labelValues } of metric.values.values()) {
        const labels = Object.entries(labelValues)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',');
        
        const labelStr = labels ? `{${labels}}` : '';
        output += `${metric.name}${labelStr} ${value}\n`;
      }
      
      output += '\n';
    }
    
    return output;
  }

  /**
   * Genera le metriche in formato JSON
   * @returns {Object} Metriche in formato JSON
   */
  getJsonMetrics() {
    return this.collector.getAllMetrics();
  }

  /**
   * Ottiene le metriche nel formato configurato
   * @returns {string|Object} Metriche nel formato configurato
   */
  getMetrics() {
    if (this.format === 'prometheus') {
      return this.getPrometheusMetrics();
    } else {
      return this.getJsonMetrics();
    }
  }

  /**
   * Configura un endpoint Express per esporre le metriche
   * @param {Object} app - Istanza di Express
   * @param {string} path - Percorso dell'endpoint (default: /metrics)
   */
  setupExpressEndpoint(app, path = '/metrics') {
    if (!app) {
      this.logger.error('Express app is required to setup metrics endpoint');
      return;
    }
    
    this.logger.info(`Setting up metrics endpoint at ${path}`);
    
    app.get(path, (req, res) => {
      if (this.format === 'prometheus') {
        res.set('Content-Type', 'text/plain');
        res.send(this.getPrometheusMetrics());
      } else {
        res.json(this.getJsonMetrics());
      }
    });
  }
}

/**
 * Classe per il monitoraggio delle prestazioni del sistema e dell'applicazione
 * 
 * Questa classe integra la raccolta e l'esportazione delle metriche e fornisce
 * funzionalità aggiuntive come:
 * - Monitoraggio della salute del sistema
 * - Rilevamento di anomalie
 * - Notifiche di eventi critici
 */
class PerformanceMonitor extends EventEmitter {
  /**
   * Crea una nuova istanza del monitor di prestazioni
   * @param {Object} options - Opzioni di configurazione
   * @param {Object} options.logger - Istanza del logger (opzionale)
   * @param {MetricsCollector} options.collector - Istanza del collector di metriche (opzionale)
   * @param {MetricsExporter} options.exporter - Istanza dell'esportatore di metriche (opzionale)
   */
  constructor(options = {}) {
    super();
    
    this.logger = options.logger || defaultLogger.child('performance-monitor');
    this.collector = options.collector || new MetricsCollector({ logger: this.logger });
    this.exporter = options.exporter || new MetricsExporter({ 
      logger: this.logger,
      collector: this.collector
    });
    
    // Configurazione dei limiti per gli alert
    this.thresholds = {
      memory: {
        warning: options.memoryWarningThreshold || 80, // percentuale
        critical: options.memoryCriticalThreshold || 90 // percentuale
      },
      cpu: {
        warning: options.cpuWarningThreshold || 70, // percentuale
        critical: options.cpuCriticalThreshold || 85 // percentuale
      },
      operationDuration: {
        warning: options.operationWarningThreshold || 1000, // ms
        critical: options.operationCriticalThreshold || 5000 // ms
      },
      errorRate: {
        warning: options.errorRateWarningThreshold || 5, // percentuale
        critical: options.errorRateCriticalThreshold || 10 // percentuale
      }
    };
    
    // Stato corrente del sistema
    this.systemStatus = {
      healthy: true,
      issues: []
    };
    
    // Intervallo di controllo della salute del sistema (in ms)
    this.healthCheckInterval = options.healthCheckInterval || 60000; // Default: 1 minuto
    
    // Flag per indicare se il monitoraggio è attivo
    this.isMonitoring = false;
    
    // Riferimento all'intervallo di controllo
    this.healthCheckIntervalRef = null;
  }

  /**
   * Avvia il monitoraggio delle prestazioni
   * @returns {boolean} true se il monitoraggio è stato avviato, false altrimenti
   */
  start() {
    if (this.isMonitoring) {
      this.logger.warn('Performance monitoring is already running');
      return false;
    }
    
    // Avvia la raccolta delle metriche
    this.collector.startCollection();
    
    // Avvia il controllo della salute del sistema
    this.isMonitoring = true;
    this.checkSystemHealth();
    
    this.healthCheckIntervalRef = setInterval(() => {
      this.checkSystemHealth();
    }, this.healthCheckInterval);
    
    this.logger.info(`Started performance monitoring with health check interval of ${this.healthCheckInterval}ms`);
    this.emit('monitoring:started');
    
    return true;
  }

  /**
   * Ferma il monitoraggio delle prestazioni
   * @returns {boolean} true se il monitoraggio è stato fermato, false altrimenti
   */
  stop() {
    if (!this.isMonitoring) {
      this.logger.warn('Performance monitoring is not running');
      return false;
    }
    
    // Ferma la raccolta delle metriche
    this.collector.stopCollection();
    
    // Ferma il controllo della salute del sistema
    clearInterval(this.healthCheckIntervalRef);
    this.healthCheckIntervalRef = null;
    this.isMonitoring = false;
    
    this.logger.info('Stopped performance monitoring');
    this.emit('monitoring:stopped');
    
    return true;
  }

  /**
   * Controlla la salute del sistema
   * @returns {Object} Stato del sistema
   */
  checkSystemHealth() {
    try {
      const metrics = this.collector.getAllMetrics();
      const issues = [];
      
      // Controlla utilizzo memoria
      if (metrics.system && metrics.system.memory) {
        const memoryUsage = metrics.system.memory.usedPercentage;
        
        if (memoryUsage > this.thresholds.memory.critical) {
          issues.push({
            type: 'memory',
            level: 'critical',
            message: `Memory usage is critical: ${memoryUsage.toFixed(2)}%`,
            value: memoryUsage,
            threshold: this.thresholds.memory.critical,
            timestamp: Date.now()
          });
        } else if (memoryUsage > this.thresholds.memory.warning) {
          issues.push({
            type: 'memory',
            level: 'warning',
            message: `Memory usage is high: ${memoryUsage.toFixed(2)}%`,
            value: memoryUsage,
            threshold: this.thresholds.memory.warning,
            timestamp: Date.now()
          });
        }
      }
      
      // Controlla carico CPU
      if (metrics.system && metrics.system.cpu && metrics.system.cpu.loadAverage) {
        const cpuCores = os.cpus().length;
        const cpuLoad = (metrics.system.cpu.loadAverage['1m'] / cpuCores) * 100;
        
        if (cpuLoad > this.thresholds.cpu.critical) {
          issues.push({
            type: 'cpu',
            level: 'critical',
            message: `CPU load is critical: ${cpuLoad.toFixed(2)}%`,
            value: cpuLoad,
            threshold: this.thresholds.cpu.critical,
            timestamp: Date.now()
          });
        } else if (cpuLoad > this.thresholds.cpu.warning) {
          issues.push({
            type: 'cpu',
            level: 'warning',
            message: `CPU load is high: ${cpuLoad.toFixed(2)}%`,
            value: cpuLoad,
            threshold: this.thresholds.cpu.warning,
            timestamp: Date.now()
          });
        }
      }
      
      // Controlla durata delle operazioni
      if (metrics.operations) {
        Object.entries(metrics.operations).forEach(([opName, opMetrics]) => {
          if (opMetrics.count > 0 && opMetrics.avgDuration > this.thresholds.operationDuration.critical) {
            issues.push({
              type: 'operation_duration',
              level: 'critical',
              message: `Operation ${opName} average duration is critical: ${opMetrics.avgDuration.toFixed(2)}ms`,
              operation: opName,
              value: opMetrics.avgDuration,
              threshold: this.thresholds.operationDuration.critical,
              timestamp: Date.now()
            });
          } else if (opMetrics.count > 0 && opMetrics.avgDuration > this.thresholds.operationDuration.warning) {
            issues.push({
              type: 'operation_duration',
              level: 'warning',
              message: `Operation ${opName} average duration is high: ${opMetrics.avgDuration.toFixed(2)}ms`,
              operation: opName,
              value: opMetrics.avgDuration,
              threshold: this.thresholds.operationDuration.warning,
              timestamp: Date.now()
            });
          }
        });
      }
      
      // Controlla tasso di errore delle operazioni
      if (metrics.operations) {
        Object.entries(metrics.operations).forEach(([opName, opMetrics]) => {
          if (opMetrics.count > 10) { // Solo se abbiamo abbastanza dati
            const errorRate = (opMetrics.failureCount / opMetrics.count) * 100;
            
            if (errorRate > this.thresholds.errorRate.critical) {
              issues.push({
                type: 'error_rate',
                level: 'critical',
                message: `Operation ${opName} error rate is critical: ${errorRate.toFixed(2)}%`,
                operation: opName,
                value: errorRate,
                threshold: this.thresholds.errorRate.critical,
                timestamp: Date.now()
              });
            } else if (errorRate > this.thresholds.errorRate.warning) {
              issues.push({
                type: 'error_rate',
                level: 'warning',
                message: `Operation ${opName} error rate is high: ${errorRate.toFixed(2)}%`,
                operation: opName,
                value: errorRate,
                threshold: this.thresholds.errorRate.warning,
                timestamp: Date.now()
              });
            }
          }
        });
      }
      
      // Aggiorna lo stato del sistema
      const previousStatus = { ...this.systemStatus };
      this.systemStatus = {
        healthy: issues.length === 0,
        issues
      };
      
      // Emetti eventi per i cambiamenti di stato
      if (previousStatus.healthy && !this.systemStatus.healthy) {
        this.logger.warn('System health status changed to unhealthy', { issues });
        this.emit('health:degraded', this.systemStatus);
      } else if (!previousStatus.healthy && this.systemStatus.healthy) {
        this.logger.info('System health status changed to healthy');
        this.emit('health:recovered', this.systemStatus);
      }
      
      // Emetti eventi per nuovi problemi critici
      const criticalIssues = issues.filter(issue => issue.level === 'critical');
      if (criticalIssues.length > 0) {
        criticalIssues.forEach(issue => {
          this.logger.error(issue.message, issue);
          this.emit('issue:critical', issue);
        });
      }
      
      // Emetti eventi per nuovi problemi di warning
      const warningIssues = issues.filter(issue => issue.level === 'warning');
      if (warningIssues.length > 0) {
        warningIssues.forEach(issue => {
          this.logger.warn(issue.message, issue);
          this.emit('issue:warning', issue);
        });
      }
      
      return this.systemStatus;
    } catch (error) {
      this.logger.error('Error checking system health', { error: error.message });
      return {
        healthy: false,
        issues: [{
          type: 'system',
          level: 'critical',
          message: `Error checking system health: ${error.message}`,
          timestamp: Date.now()
        }]
      };
    }
  }

  /**
   * Ottiene lo stato corrente del sistema
   * @returns {Object} Stato del sistema
   */
  getSystemStatus() {
    return this.systemStatus;
  }

  /**
   * Ottiene le metriche nel formato configurato
   * @returns {string|Object} Metriche nel formato configurato
   */
  getMetrics() {
    return this.exporter.getMetrics();
  }

  /**
   * Configura un endpoint Express per esporre le metriche
   * @param {Object} app - Istanza di Express
   * @param {string} metricsPath - Percorso dell'endpoint per le metriche (default: /metrics)
   * @param {string} healthPath - Percorso dell'endpoint per lo stato di salute (default: /health)
   */
  setupExpressEndpoints(app, metricsPath = '/metrics', healthPath = '/health') {
    if (!app) {
      this.logger.error('Express app is required to setup monitoring endpoints');
      return;
    }
    
    // Configura endpoint per le metriche
    this.exporter.setupExpressEndpoint(app, metricsPath);
    
    // Configura endpoint per lo stato di salute
    this.logger.info(`Setting up health endpoint at ${healthPath}`);
    app.get(healthPath, (req, res) => {
      const status = this.checkSystemHealth();
      
      if (status.healthy) {
        res.status(200).json({
          status: 'ok',
          healthy: true,
          timestamp: Date.now()
        });
      } else {
        res.status(503).json({
          status: 'degraded',
          healthy: false,
          issues: status.issues,
          timestamp: Date.now()
        });
      }
    });
  }
}

module.exports = {
  MetricsCollector,
  MetricsExporter,
  PerformanceMonitor
};
