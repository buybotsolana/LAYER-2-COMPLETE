const { MetricsCollector, MetricsExporter, PerformanceMonitor } = require('./performance-monitor');
const { AlertManager } = require('./alert-manager');

/**
 * Inizializza il sistema di monitoraggio e alerting
 * 
 * @param {Object} options - Opzioni di configurazione
 * @param {Object} options.logger - Istanza del logger (opzionale)
 * @param {Object} options.metrics - Opzioni per il collector di metriche
 * @param {Object} options.alerts - Opzioni per il gestore di alert
 * @param {Object} options.express - Istanza di Express per configurare gli endpoint (opzionale)
 * @returns {Object} Oggetto contenente le istanze configurate
 */
function initializeMonitoring(options = {}) {
  // Crea il collector di metriche
  const metricsCollector = new MetricsCollector({
    logger: options.logger,
    collectionInterval: options.metrics?.collectionInterval
  });
  
  // Crea l'esportatore di metriche
  const metricsExporter = new MetricsExporter({
    logger: options.logger,
    collector: metricsCollector,
    format: options.metrics?.format || 'prometheus'
  });
  
  // Crea il monitor di prestazioni
  const performanceMonitor = new PerformanceMonitor({
    logger: options.logger,
    collector: metricsCollector,
    exporter: metricsExporter,
    memoryWarningThreshold: options.alerts?.memoryWarningThreshold,
    memoryCriticalThreshold: options.alerts?.memoryCriticalThreshold,
    cpuWarningThreshold: options.alerts?.cpuWarningThreshold,
    cpuCriticalThreshold: options.alerts?.cpuCriticalThreshold,
    operationWarningThreshold: options.alerts?.operationWarningThreshold,
    operationCriticalThreshold: options.alerts?.operationCriticalThreshold,
    errorRateWarningThreshold: options.alerts?.errorRateWarningThreshold,
    errorRateCriticalThreshold: options.alerts?.errorRateCriticalThreshold,
    healthCheckInterval: options.alerts?.healthCheckInterval
  });
  
  // Crea il gestore di alert
  const alertManager = new AlertManager({
    logger: options.logger,
    monitor: performanceMonitor,
    criticalAlertFrequency: options.alerts?.criticalAlertFrequency,
    warningAlertFrequency: options.alerts?.warningAlertFrequency,
    infoAlertFrequency: options.alerts?.infoAlertFrequency,
    historyLimit: options.alerts?.historyLimit
  });
  
  // Configura gli endpoint Express se fornito
  if (options.express) {
    performanceMonitor.setupExpressEndpoints(
      options.express,
      options.metrics?.metricsPath || '/metrics',
      options.metrics?.healthPath || '/health'
    );
    
    alertManager.setupExpressEndpoint(
      options.express,
      options.alerts?.alertsPath || '/alerts'
    );
  }
  
  // Avvia il monitoraggio e gli alert se richiesto
  if (options.autoStart !== false) {
    performanceMonitor.start();
    alertManager.start();
  }
  
  return {
    metricsCollector,
    metricsExporter,
    performanceMonitor,
    alertManager
  };
}

module.exports = {
  MetricsCollector,
  MetricsExporter,
  PerformanceMonitor,
  AlertManager,
  initializeMonitoring
};
