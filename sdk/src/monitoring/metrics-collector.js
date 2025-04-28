const { defaultLogger } = require('../logging/logger');
const os = require('os');
const process = require('process');

/**
 * Classe per la raccolta di metriche di sistema e applicazione
 * 
 * Questa classe fornisce metodi per raccogliere metriche relative a:
 * - Utilizzo CPU
 * - Utilizzo memoria
 * - Latenza delle operazioni
 * - Throughput delle transazioni
 * - Stato del sistema
 */
class MetricsCollector {
  /**
   * Crea una nuova istanza del collector di metriche
   * @param {Object} options - Opzioni di configurazione
   * @param {Object} options.logger - Istanza del logger (opzionale)
   */
  constructor(options = {}) {
    this.logger = options.logger || defaultLogger.child('metrics');
    this.metrics = {
      system: {},
      application: {},
      transactions: {},
      operations: {}
    };
    
    // Intervallo di raccolta delle metriche di sistema (in ms)
    this.collectionInterval = options.collectionInterval || 60000; // Default: 1 minuto
    
    // Flag per indicare se la raccolta automatica è attiva
    this.isCollecting = false;
    
    // Riferimento all'intervallo di raccolta
    this.collectionIntervalRef = null;
  }

  /**
   * Avvia la raccolta automatica delle metriche di sistema
   * @returns {boolean} true se la raccolta è stata avviata, false altrimenti
   */
  startCollection() {
    if (this.isCollecting) {
      this.logger.warn('Metrics collection is already running');
      return false;
    }
    
    this.isCollecting = true;
    this.collectSystemMetrics();
    
    this.collectionIntervalRef = setInterval(() => {
      this.collectSystemMetrics();
    }, this.collectionInterval);
    
    this.logger.info(`Started metrics collection with interval of ${this.collectionInterval}ms`);
    return true;
  }

  /**
   * Ferma la raccolta automatica delle metriche di sistema
   * @returns {boolean} true se la raccolta è stata fermata, false altrimenti
   */
  stopCollection() {
    if (!this.isCollecting) {
      this.logger.warn('Metrics collection is not running');
      return false;
    }
    
    clearInterval(this.collectionIntervalRef);
    this.collectionIntervalRef = null;
    this.isCollecting = false;
    
    this.logger.info('Stopped metrics collection');
    return true;
  }

  /**
   * Raccoglie le metriche di sistema (CPU, memoria, etc.)
   * @returns {Object} Metriche di sistema raccolte
   */
  collectSystemMetrics() {
    try {
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memoryUsage = process.memoryUsage();
      const loadAvg = os.loadavg();
      
      const systemMetrics = {
        timestamp: Date.now(),
        cpu: {
          cores: cpus.length,
          model: cpus[0].model,
          speed: cpus[0].speed,
          loadAverage: {
            '1m': loadAvg[0],
            '5m': loadAvg[1],
            '15m': loadAvg[2]
          }
        },
        memory: {
          total: totalMem,
          free: freeMem,
          used: usedMem,
          usedPercentage: (usedMem / totalMem) * 100
        },
        process: {
          uptime: process.uptime(),
          memory: {
            rss: memoryUsage.rss,
            heapTotal: memoryUsage.heapTotal,
            heapUsed: memoryUsage.heapUsed,
            external: memoryUsage.external
          }
        },
        os: {
          platform: process.platform,
          release: os.release(),
          uptime: os.uptime()
        }
      };
      
      this.metrics.system = systemMetrics;
      
      // Log delle metriche a livello debug
      this.logger.debug('Collected system metrics', { metrics: systemMetrics });
      
      // Verifica se ci sono condizioni critiche
      this._checkCriticalConditions(systemMetrics);
      
      return systemMetrics;
    } catch (error) {
      this.logger.error('Error collecting system metrics', { error: error.message });
      return null;
    }
  }

  /**
   * Registra una metrica di operazione (latenza, successo/fallimento)
   * @param {string} operationName - Nome dell'operazione
   * @param {number} duration - Durata dell'operazione in ms
   * @param {boolean} success - Se l'operazione è stata completata con successo
   * @param {Object} metadata - Metadati aggiuntivi
   */
  recordOperation(operationName, duration, success, metadata = {}) {
    if (!this.metrics.operations[operationName]) {
      this.metrics.operations[operationName] = {
        count: 0,
        successCount: 0,
        failureCount: 0,
        totalDuration: 0,
        minDuration: Number.MAX_SAFE_INTEGER,
        maxDuration: 0,
        avgDuration: 0,
        lastExecuted: Date.now(),
        history: []
      };
    }
    
    const op = this.metrics.operations[operationName];
    op.count++;
    op.lastExecuted = Date.now();
    
    if (success) {
      op.successCount++;
    } else {
      op.failureCount++;
    }
    
    op.totalDuration += duration;
    op.avgDuration = op.totalDuration / op.count;
    op.minDuration = Math.min(op.minDuration, duration);
    op.maxDuration = Math.max(op.maxDuration, duration);
    
    // Mantieni una storia limitata delle ultime operazioni
    op.history.push({
      timestamp: Date.now(),
      duration,
      success,
      ...metadata
    });
    
    // Limita la dimensione della storia
    if (op.history.length > 100) {
      op.history.shift();
    }
    
    // Log della metrica a livello debug
    this.logger.debug(`Recorded operation: ${operationName}`, {
      operation: operationName,
      duration,
      success,
      ...metadata
    });
    
    return op;
  }

  /**
   * Registra una metrica di transazione
   * @param {string} transactionType - Tipo di transazione (deposit, withdraw, etc.)
   * @param {boolean} success - Se la transazione è stata completata con successo
   * @param {Object} metadata - Metadati aggiuntivi
   */
  recordTransaction(transactionType, success, metadata = {}) {
    if (!this.metrics.transactions[transactionType]) {
      this.metrics.transactions[transactionType] = {
        count: 0,
        successCount: 0,
        failureCount: 0,
        lastExecuted: Date.now(),
        history: []
      };
    }
    
    const tx = this.metrics.transactions[transactionType];
    tx.count++;
    tx.lastExecuted = Date.now();
    
    if (success) {
      tx.successCount++;
    } else {
      tx.failureCount++;
    }
    
    // Mantieni una storia limitata delle ultime transazioni
    tx.history.push({
      timestamp: Date.now(),
      success,
      ...metadata
    });
    
    // Limita la dimensione della storia
    if (tx.history.length > 100) {
      tx.history.shift();
    }
    
    // Log della metrica a livello debug
    this.logger.debug(`Recorded transaction: ${transactionType}`, {
      transactionType,
      success,
      ...metadata
    });
    
    return tx;
  }

  /**
   * Registra una metrica personalizzata dell'applicazione
   * @param {string} name - Nome della metrica
   * @param {*} value - Valore della metrica
   * @param {Object} metadata - Metadati aggiuntivi
   */
  recordApplicationMetric(name, value, metadata = {}) {
    if (!this.metrics.application[name]) {
      this.metrics.application[name] = {
        current: value,
        history: []
      };
    }
    
    const metric = this.metrics.application[name];
    metric.current = value;
    
    // Mantieni una storia limitata dei valori
    metric.history.push({
      timestamp: Date.now(),
      value,
      ...metadata
    });
    
    // Limita la dimensione della storia
    if (metric.history.length > 100) {
      metric.history.shift();
    }
    
    // Log della metrica a livello debug
    this.logger.debug(`Recorded application metric: ${name}`, {
      name,
      value,
      ...metadata
    });
    
    return metric;
  }

  /**
   * Ottiene tutte le metriche raccolte
   * @returns {Object} Tutte le metriche
   */
  getAllMetrics() {
    return {
      timestamp: Date.now(),
      ...this.metrics
    };
  }

  /**
   * Ottiene le metriche di sistema
   * @returns {Object} Metriche di sistema
   */
  getSystemMetrics() {
    return {
      timestamp: Date.now(),
      system: this.metrics.system
    };
  }

  /**
   * Ottiene le metriche delle operazioni
   * @returns {Object} Metriche delle operazioni
   */
  getOperationMetrics() {
    return {
      timestamp: Date.now(),
      operations: this.metrics.operations
    };
  }

  /**
   * Ottiene le metriche delle transazioni
   * @returns {Object} Metriche delle transazioni
   */
  getTransactionMetrics() {
    return {
      timestamp: Date.now(),
      transactions: this.metrics.transactions
    };
  }

  /**
   * Ottiene le metriche dell'applicazione
   * @returns {Object} Metriche dell'applicazione
   */
  getApplicationMetrics() {
    return {
      timestamp: Date.now(),
      application: this.metrics.application
    };
  }

  /**
   * Verifica se ci sono condizioni critiche nelle metriche di sistema
   * @param {Object} systemMetrics - Metriche di sistema
   * @private
   */
  _checkCriticalConditions(systemMetrics) {
    // Verifica utilizzo memoria
    if (systemMetrics.memory.usedPercentage > 90) {
      this.logger.warn('High memory usage detected', {
        memoryUsage: systemMetrics.memory.usedPercentage.toFixed(2) + '%',
        freeMemory: (systemMetrics.memory.free / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
      });
    }
    
    // Verifica carico CPU
    if (systemMetrics.cpu.loadAverage['1m'] > systemMetrics.cpu.cores * 0.8) {
      this.logger.warn('High CPU load detected', {
        loadAverage: systemMetrics.cpu.loadAverage['1m'].toFixed(2),
        cores: systemMetrics.cpu.cores
      });
    }
    
    // Verifica utilizzo heap
    const heapUsedPercentage = (systemMetrics.process.memory.heapUsed / systemMetrics.process.memory.heapTotal) * 100;
    if (heapUsedPercentage > 85) {
      this.logger.warn('High heap usage detected', {
        heapUsage: heapUsedPercentage.toFixed(2) + '%',
        heapUsed: (systemMetrics.process.memory.heapUsed / (1024 * 1024)).toFixed(2) + ' MB',
        heapTotal: (systemMetrics.process.memory.heapTotal / (1024 * 1024)).toFixed(2) + ' MB'
      });
    }
  }
}

module.exports = {
  MetricsCollector
};
