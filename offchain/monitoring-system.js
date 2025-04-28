/**
 * Sistema di Monitoraggio in Tempo Reale per il Layer-2 su Solana
 * 
 * Questo modulo implementa un sistema di monitoraggio completo con raccolta di metriche,
 * dashboard, alerting e integrazione con Prometheus e Grafana.
 */

const EventEmitter = require('events');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const client = require('prom-client');
const { CentralizedLogger } = require('./logger/logger');

/**
 * Classe principale per il sistema di monitoraggio
 */
class MonitoringSystem extends EventEmitter {
  /**
   * Crea una nuova istanza del sistema di monitoraggio
   * @param {Object} config - Configurazione del sistema
   * @param {Object} logger - Logger centralizzato
   */
  constructor(config, logger) {
    super();
    
    this.config = {
      port: 9090,
      metricsEndpoint: '/metrics',
      healthEndpoint: '/health',
      collectDefaultMetrics: true,
      defaultLabels: {
        app: 'layer2-solana'
      },
      scrapeInterval: 15, // secondi
      retentionPeriod: 86400 * 15, // 15 giorni
      exporters: {
        prometheus: {
          enabled: true
        },
        json: {
          enabled: true,
          path: './metrics'
        },
        pushgateway: {
          enabled: false,
          url: 'http://localhost:9091',
          jobName: 'layer2-solana'
        }
      },
      alerting: {
        enabled: true,
        rules: []
      },
      ...config
    };
    
    this.logger = logger || new CentralizedLogger({
      appName: 'monitoring-system',
      logLevel: 'info'
    });
    
    // Inizializza il registro delle metriche
    this.registry = new client.Registry();
    
    // Aggiungi le etichette di default
    this.registry.setDefaultLabels(this.config.defaultLabels);
    
    // Inizializza le metriche
    this._initializeMetrics();
    
    // Inizializza gli esportatori
    this._initializeExporters();
    
    // Inizializza il server HTTP
    if (this.config.exporters.prometheus.enabled) {
      this._initializeServer();
    }
    
    // Inizializza il sistema di alerting
    if (this.config.alerting.enabled) {
      this._initializeAlerting();
    }
    
    this.logger.info('Sistema di monitoraggio inizializzato', {
      port: this.config.port,
      metricsEndpoint: this.config.metricsEndpoint,
      healthEndpoint: this.config.healthEndpoint,
      exporters: Object.keys(this.config.exporters).filter(
        key => this.config.exporters[key].enabled
      )
    });
  }
  
  /**
   * Inizializza le metriche di base
   * @private
   */
  _initializeMetrics() {
    // Raccogli le metriche di default se abilitato
    if (this.config.collectDefaultMetrics) {
      client.collectDefaultMetrics({
        register: this.registry,
        timeout: this.config.scrapeInterval * 1000
      });
    }
    
    // Metriche personalizzate
    
    // Contatori
    this.counters = {
      // Transazioni
      transactions: new client.Counter({
        name: 'layer2_transactions_total',
        help: 'Numero totale di transazioni processate',
        labelNames: ['type', 'status'],
        registers: [this.registry]
      }),
      
      // Errori
      errors: new client.Counter({
        name: 'layer2_errors_total',
        help: 'Numero totale di errori',
        labelNames: ['component', 'type'],
        registers: [this.registry]
      }),
      
      // Richieste API
      apiRequests: new client.Counter({
        name: 'layer2_api_requests_total',
        help: 'Numero totale di richieste API',
        labelNames: ['method', 'endpoint', 'status'],
        registers: [this.registry]
      }),
      
      // Operazioni database
      dbOperations: new client.Counter({
        name: 'layer2_db_operations_total',
        help: 'Numero totale di operazioni database',
        labelNames: ['operation', 'table', 'status'],
        registers: [this.registry]
      }),
      
      // Operazioni HSM
      hsmOperations: new client.Counter({
        name: 'layer2_hsm_operations_total',
        help: 'Numero totale di operazioni HSM',
        labelNames: ['operation', 'status'],
        registers: [this.registry]
      })
    };
    
    // Gauge
    this.gauges = {
      // Connessioni attive
      activeConnections: new client.Gauge({
        name: 'layer2_active_connections',
        help: 'Numero di connessioni attive',
        labelNames: ['type'],
        registers: [this.registry]
      }),
      
      // Dimensione della coda
      queueSize: new client.Gauge({
        name: 'layer2_queue_size',
        help: 'Dimensione della coda',
        labelNames: ['queue'],
        registers: [this.registry]
      }),
      
      // Utilizzo memoria
      memoryUsage: new client.Gauge({
        name: 'layer2_memory_usage_bytes',
        help: 'Utilizzo della memoria in bytes',
        labelNames: ['type'],
        registers: [this.registry]
      }),
      
      // Utilizzo CPU
      cpuUsage: new client.Gauge({
        name: 'layer2_cpu_usage_percent',
        help: 'Utilizzo della CPU in percentuale',
        labelNames: ['core'],
        registers: [this.registry]
      }),
      
      // Utilizzo disco
      diskUsage: new client.Gauge({
        name: 'layer2_disk_usage_bytes',
        help: 'Utilizzo del disco in bytes',
        labelNames: ['mount'],
        registers: [this.registry]
      }),
      
      // Stato shard
      shardStatus: new client.Gauge({
        name: 'layer2_shard_status',
        help: 'Stato dello shard (1 = online, 0 = offline)',
        labelNames: ['shard'],
        registers: [this.registry]
      }),
      
      // Carico shard
      shardLoad: new client.Gauge({
        name: 'layer2_shard_load',
        help: 'Carico dello shard',
        labelNames: ['shard'],
        registers: [this.registry]
      })
    };
    
    // Istogrammi
    this.histograms = {
      // Latenza transazioni
      transactionLatency: new client.Histogram({
        name: 'layer2_transaction_latency_seconds',
        help: 'Latenza delle transazioni in secondi',
        labelNames: ['type'],
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
        registers: [this.registry]
      }),
      
      // Latenza API
      apiLatency: new client.Histogram({
        name: 'layer2_api_latency_seconds',
        help: 'Latenza delle richieste API in secondi',
        labelNames: ['method', 'endpoint'],
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
        registers: [this.registry]
      }),
      
      // Latenza database
      dbLatency: new client.Histogram({
        name: 'layer2_db_latency_seconds',
        help: 'Latenza delle operazioni database in secondi',
        labelNames: ['operation', 'table'],
        buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
        registers: [this.registry]
      }),
      
      // Dimensione transazioni
      transactionSize: new client.Histogram({
        name: 'layer2_transaction_size_bytes',
        help: 'Dimensione delle transazioni in bytes',
        labelNames: ['type'],
        buckets: [100, 500, 1000, 5000, 10000, 50000, 100000],
        registers: [this.registry]
      }),
      
      // Latenza HSM
      hsmLatency: new client.Histogram({
        name: 'layer2_hsm_latency_seconds',
        help: 'Latenza delle operazioni HSM in secondi',
        labelNames: ['operation'],
        buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
        registers: [this.registry]
      })
    };
    
    // Summary
    this.summaries = {
      // Tempo di risposta API
      apiResponseTime: new client.Summary({
        name: 'layer2_api_response_time_seconds',
        help: 'Tempo di risposta delle richieste API in secondi',
        labelNames: ['method', 'endpoint'],
        percentiles: [0.5, 0.9, 0.95, 0.99],
        registers: [this.registry]
      }),
      
      // Tempo di elaborazione transazioni
      transactionProcessingTime: new client.Summary({
        name: 'layer2_transaction_processing_time_seconds',
        help: 'Tempo di elaborazione delle transazioni in secondi',
        labelNames: ['type'],
        percentiles: [0.5, 0.9, 0.95, 0.99],
        registers: [this.registry]
      })
    };
  }
  
  /**
   * Inizializza gli esportatori di metriche
   * @private
   */
  _initializeExporters() {
    // Esportatore JSON
    if (this.config.exporters.json.enabled) {
      // Crea la directory se non esiste
      const metricsPath = this.config.exporters.json.path;
      if (!fs.existsSync(metricsPath)) {
        fs.mkdirSync(metricsPath, { recursive: true });
      }
      
      // Pianifica l'esportazione periodica
      this.jsonExportTimer = setInterval(() => {
        this._exportMetricsToJson();
      }, this.config.scrapeInterval * 1000);
    }
    
    // Esportatore Pushgateway
    if (this.config.exporters.pushgateway.enabled) {
      // Pianifica l'esportazione periodica
      this.pushgatewayTimer = setInterval(() => {
        this._exportMetricsToPushgateway();
      }, this.config.scrapeInterval * 1000);
    }
  }
  
  /**
   * Inizializza il server HTTP per le metriche
   * @private
   */
  _initializeServer() {
    // Crea l'app Express
    this.app = express();
    
    // Endpoint per le metriche
    this.app.get(this.config.metricsEndpoint, async (req, res) => {
      try {
        res.set('Content-Type', this.registry.contentType);
        res.end(await this.registry.metrics());
      } catch (error) {
        this.logger.error('Errore nella generazione delle metriche', { error });
        res.status(500).end();
      }
    });
    
    // Endpoint per lo stato di salute
    this.app.get(this.config.healthEndpoint, (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime()
      });
    });
    
    // Avvia il server
    this.server = http.createServer(this.app);
    this.server.listen(this.config.port, () => {
      this.logger.info(`Server di monitoraggio in ascolto sulla porta ${this.config.port}`);
    });
    
    // Gestione degli errori del server
    this.server.on('error', (error) => {
      this.logger.error('Errore nel server di monitoraggio', { error });
    });
  }
  
  /**
   * Inizializza il sistema di alerting
   * @private
   */
  _initializeAlerting() {
    // Carica le regole di alerting
    this.alertRules = this.config.alerting.rules;
    
    // Pianifica la valutazione periodica delle regole
    this.alertingTimer = setInterval(() => {
      this._evaluateAlertRules();
    }, this.config.scrapeInterval * 1000);
    
    this.logger.info('Sistema di alerting inizializzato', {
      rulesCount: this.alertRules.length
    });
  }
  
  /**
   * Esporta le metriche in formato JSON
   * @private
   */
  async _exportMetricsToJson() {
    try {
      // Ottieni le metriche
      const metrics = await this.registry.getMetricsAsJSON();
      
      // Crea il file di output
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const filePath = path.join(this.config.exporters.json.path, `metrics-${timestamp}.json`);
      
      // Scrivi le metriche nel file
      fs.writeFileSync(filePath, JSON.stringify(metrics, null, 2));
      
      this.logger.debug('Metriche esportate in JSON', { filePath });
      
      // Pulisci i file vecchi
      this._cleanupOldMetricsFiles();
    } catch (error) {
      this.logger.error('Errore nell\'esportazione delle metriche in JSON', { error });
    }
  }
  
  /**
   * Esporta le metriche a Pushgateway
   * @private
   */
  async _exportMetricsToPushgateway() {
    try {
      // Ottieni le metriche
      const metrics = await this.registry.metrics();
      
      // Invia le metriche a Pushgateway
      const response = await fetch(`${this.config.exporters.pushgateway.url}/metrics/job/${this.config.exporters.pushgateway.jobName}`, {
        method: 'POST',
        body: metrics,
        headers: {
          'Content-Type': this.registry.contentType
        }
      });
      
      if (!response.ok) {
        throw new Error(`Errore nell'invio delle metriche a Pushgateway: ${response.statusText}`);
      }
      
      this.logger.debug('Metriche esportate a Pushgateway');
    } catch (error) {
      this.logger.error('Errore nell\'esportazione delle metriche a Pushgateway', { error });
    }
  }
  
  /**
   * Pulisce i file di metriche vecchi
   * @private
   */
  _cleanupOldMetricsFiles() {
    try {
      const metricsPath = this.config.exporters.json.path;
      const files = fs.readdirSync(metricsPath);
      
      const now = Date.now();
      const retentionMs = this.config.retentionPeriod * 1000;
      
      for (const file of files) {
        if (file.startsWith('metrics-') && file.endsWith('.json')) {
          const filePath = path.join(metricsPath, file);
          const stats = fs.statSync(filePath);
          
          if (now - stats.mtime.getTime() > retentionMs) {
            fs.unlinkSync(filePath);
            this.logger.debug('File di metriche vecchio eliminato', { filePath });
          }
        }
      }
    } catch (error) {
      this.logger.error('Errore nella pulizia dei file di metriche vecchi', { error });
    }
  }
  
  /**
   * Valuta le regole di alerting
   * @private
   */
  async _evaluateAlertRules() {
    try {
      // Ottieni le metriche
      const metrics = await this.registry.getMetricsAsJSON();
      
      // Valuta ogni regola
      for (const rule of this.alertRules) {
        this._evaluateAlertRule(rule, metrics);
      }
    } catch (error) {
      this.logger.error('Errore nella valutazione delle regole di alerting', { error });
    }
  }
  
  /**
   * Valuta una singola regola di alerting
   * @private
   * @param {Object} rule - Regola da valutare
   * @param {Array} metrics - Metriche correnti
   */
  _evaluateAlertRule(rule, metrics) {
    try {
      // Trova la metrica corrispondente
      const metric = metrics.find(m => m.name === rule.metric);
      
      if (!metric) {
        return;
      }
      
      // Estrai i valori della metrica
      let values = [];
      
      if (metric.type === 'counter' || metric.type === 'gauge') {
        values = metric.values.map(v => v.value);
      } else if (metric.type === 'histogram') {
        values = metric.values.map(v => v.sum / v.count);
      } else if (metric.type === 'summary') {
        values = metric.values.map(v => v.sum / v.count);
      }
      
      // Applica il filtro delle etichette
      if (rule.labels) {
        values = values.filter(v => {
          for (const [key, value] of Object.entries(rule.labels)) {
            if (v.labels[key] !== value) {
              return false;
            }
          }
          return true;
        });
      }
      
      // Calcola il valore aggregato
      let aggregatedValue;
      
      switch (rule.aggregation) {
        case 'sum':
          aggregatedValue = values.reduce((sum, v) => sum + v, 0);
          break;
        case 'avg':
          aggregatedValue = values.reduce((sum, v) => sum + v, 0) / values.length;
          break;
        case 'min':
          aggregatedValue = Math.min(...values);
          break;
        case 'max':
          aggregatedValue = Math.max(...values);
          break;
        default:
          aggregatedValue = values.length > 0 ? values[0] : 0;
      }
      
      // Valuta la condizione
      let condition = false;
      
      switch (rule.operator) {
        case '>':
          condition = aggregatedValue > rule.threshold;
          break;
        case '>=':
          condition = aggregatedValue >= rule.threshold;
          break;
        case '<':
          condition = aggregatedValue < rule.threshold;
          break;
        case '<=':
          condition = aggregatedValue <= rule.threshold;
          break;
        case '==':
          condition = aggregatedValue === rule.threshold;
          break;
        case '!=':
          condition = aggregatedValue !== rule.threshold;
          break;
      }
      
      // Se la condizione è vera, genera un alert
      if (condition) {
        this._generateAlert({
          rule: rule.name,
          metric: rule.metric,
          value: aggregatedValue,
          threshold: rule.threshold,
          operator: rule.operator,
          severity: rule.severity || 'warning',
          message: rule.message || `Alert: ${rule.name}`,
          timestamp: new Date()
        });
      }
    } catch (error) {
      this.logger.error('Errore nella valutazione della regola di alerting', { rule, error });
    }
  }
  
  /**
   * Genera un alert
   * @private
   * @param {Object} alert - Dati dell'alert
   */
  _generateAlert(alert) {
    // Emetti evento per l'alert
    this.emit('alert', alert);
    
    // Registra l'alert nel log
    this.logger.log(alert.severity, `ALERT: ${alert.message}`, {
      alert
    });
    
    // Incrementa il contatore degli alert
    this.counters.errors.inc({
      component: 'monitoring',
      type: 'alert'
    });
  }
  
  /**
   * Aggiorna le metriche di sistema
   */
  updateSystemMetrics() {
    try {
      // Memoria
      const memoryUsage = process.memoryUsage();
      this.gauges.memoryUsage.set({ type: 'rss' }, memoryUsage.rss);
      this.gauges.memoryUsage.set({ type: 'heapTotal' }, memoryUsage.heapTotal);
      this.gauges.memoryUsage.set({ type: 'heapUsed' }, memoryUsage.heapUsed);
      this.gauges.memoryUsage.set({ type: 'external' }, memoryUsage.external);
      
      // CPU
      const cpus = os.cpus();
      let totalIdle = 0;
      let totalTick = 0;
      
      for (let i = 0; i < cpus.length; i++) {
        const cpu = cpus[i];
        const total = Object.values(cpu.times).reduce((acc, tv) => acc + tv, 0);
        const idle = cpu.times.idle;
        
        totalIdle += idle;
        totalTick += total;
        
        const usagePercent = 100 - (idle / total * 100);
        this.gauges.cpuUsage.set({ core: i }, usagePercent);
      }
      
      // Disco
      const diskInfo = this._getDiskInfo();
      for (const [mount, info] of Object.entries(diskInfo)) {
        this.gauges.diskUsage.set({ mount }, info.used);
      }
    } catch (error) {
      this.logger.error('Errore nell\'aggiornamento delle metriche di sistema', { error });
    }
  }
  
  /**
   * Ottiene informazioni sull'utilizzo del disco
   * @private
   * @returns {Object} Informazioni sull'utilizzo del disco
   */
  _getDiskInfo() {
    // Questa è una funzione di esempio, in un'implementazione reale
    // si utilizzerebbe una libreria come 'diskusage' o si eseguirebbe
    // un comando di sistema come 'df'
    return {
      '/': {
        total: 1000000000,
        used: 500000000,
        free: 500000000
      }
    };
  }
  
  /**
   * Registra una transazione
   * @param {string} type - Tipo di transazione
   * @param {string} status - Stato della transazione
   * @param {number} latency - Latenza della transazione in secondi
   * @param {number} size - Dimensione della transazione in bytes
   */
  recordTransaction(type, status, latency, size) {
    try {
      // Incrementa il contatore delle transazioni
      this.counters.transactions.inc({ type, status });
      
      // Registra la latenza
      this.histograms.transactionLatency.observe({ type }, latency);
      
      // Registra la dimensione
      this.histograms.transactionSize.observe({ type }, size);
      
      // Registra il tempo di elaborazione
      this.summaries.transactionProcessingTime.observe({ type }, latency);
    } catch (error) {
      this.logger.error('Errore nella registrazione della transazione', { type, status, latency, size, error });
    }
  }
  
  /**
   * Registra una richiesta API
   * @param {string} method - Metodo HTTP
   * @param {string} endpoint - Endpoint API
   * @param {string} status - Stato della risposta
   * @param {number} latency - Latenza della richiesta in secondi
   */
  recordApiRequest(method, endpoint, status, latency) {
    try {
      // Incrementa il contatore delle richieste API
      this.counters.apiRequests.inc({ method, endpoint, status });
      
      // Registra la latenza
      this.histograms.apiLatency.observe({ method, endpoint }, latency);
      
      // Registra il tempo di risposta
      this.summaries.apiResponseTime.observe({ method, endpoint }, latency);
    } catch (error) {
      this.logger.error('Errore nella registrazione della richiesta API', { method, endpoint, status, latency, error });
    }
  }
  
  /**
   * Registra un'operazione database
   * @param {string} operation - Tipo di operazione
   * @param {string} table - Tabella coinvolta
   * @param {string} status - Stato dell'operazione
   * @param {number} latency - Latenza dell'operazione in secondi
   */
  recordDbOperation(operation, table, status, latency) {
    try {
      // Incrementa il contatore delle operazioni database
      this.counters.dbOperations.inc({ operation, table, status });
      
      // Registra la latenza
      this.histograms.dbLatency.observe({ operation, table }, latency);
    } catch (error) {
      this.logger.error('Errore nella registrazione dell\'operazione database', { operation, table, status, latency, error });
    }
  }
  
  /**
   * Registra un'operazione HSM
   * @param {string} operation - Tipo di operazione
   * @param {string} status - Stato dell'operazione
   * @param {number} latency - Latenza dell'operazione in secondi
   */
  recordHsmOperation(operation, status, latency) {
    try {
      // Incrementa il contatore delle operazioni HSM
      this.counters.hsmOperations.inc({ operation, status });
      
      // Registra la latenza
      this.histograms.hsmLatency.observe({ operation }, latency);
    } catch (error) {
      this.logger.error('Errore nella registrazione dell\'operazione HSM', { operation, status, latency, error });
    }
  }
  
  /**
   * Aggiorna il numero di connessioni attive
   * @param {string} type - Tipo di connessione
   * @param {number} count - Numero di connessioni
   */
  updateActiveConnections(type, count) {
    try {
      this.gauges.activeConnections.set({ type }, count);
    } catch (error) {
      this.logger.error('Errore nell\'aggiornamento delle connessioni attive', { type, count, error });
    }
  }
  
  /**
   * Aggiorna la dimensione di una coda
   * @param {string} queue - Nome della coda
   * @param {number} size - Dimensione della coda
   */
  updateQueueSize(queue, size) {
    try {
      this.gauges.queueSize.set({ queue }, size);
    } catch (error) {
      this.logger.error('Errore nell\'aggiornamento della dimensione della coda', { queue, size, error });
    }
  }
  
  /**
   * Aggiorna lo stato di uno shard
   * @param {string} shard - ID dello shard
   * @param {boolean} online - Stato dello shard (true = online, false = offline)
   * @param {number} load - Carico dello shard
   */
  updateShardStatus(shard, online, load) {
    try {
      this.gauges.shardStatus.set({ shard }, online ? 1 : 0);
      this.gauges.shardLoad.set({ shard }, load);
    } catch (error) {
      this.logger.error('Errore nell\'aggiornamento dello stato dello shard', { shard, online, load, error });
    }
  }
  
  /**
   * Registra un errore
   * @param {string} component - Componente che ha generato l'errore
   * @param {string} type - Tipo di errore
   */
  recordError(component, type) {
    try {
      this.counters.errors.inc({ component, type });
    } catch (error) {
      this.logger.error('Errore nella registrazione dell\'errore', { component, type, error });
    }
  }
  
  /**
   * Crea un middleware Express per il monitoraggio delle richieste
   * @returns {Function} Middleware Express
   */
  expressMiddleware() {
    return (req, res, next) => {
      // Inizializza il timer
      const start = Date.now();
      
      // Intercetta la risposta
      const originalEnd = res.end;
      res.end = function(chunk, encoding) {
        // Ripristina il metodo originale
        res.end = originalEnd;
        
        // Calcola la durata
        const duration = (Date.now() - start) / 1000;
        
        // Registra la richiesta API
        this.recordApiRequest(
          req.method,
          req.path,
          res.statusCode.toString(),
          duration
        );
        
        // Chiama il metodo originale
        return originalEnd.call(res, chunk, encoding);
      }.bind(this);
      
      next();
    };
  }
  
  /**
   * Aggiunge una regola di alerting
   * @param {Object} rule - Regola da aggiungere
   */
  addAlertRule(rule) {
    this.alertRules.push(rule);
    
    this.logger.info('Regola di alerting aggiunta', { rule });
  }
  
  /**
   * Rimuove una regola di alerting
   * @param {string} ruleName - Nome della regola da rimuovere
   * @returns {boolean} True se la regola è stata rimossa
   */
  removeAlertRule(ruleName) {
    const index = this.alertRules.findIndex(r => r.name === ruleName);
    
    if (index !== -1) {
      this.alertRules.splice(index, 1);
      this.logger.info('Regola di alerting rimossa', { ruleName });
      return true;
    }
    
    return false;
  }
  
  /**
   * Ottiene tutte le metriche
   * @returns {Promise<Array>} Metriche
   */
  async getMetrics() {
    return this.registry.getMetricsAsJSON();
  }
  
  /**
   * Ottiene una metrica specifica
   * @param {string} name - Nome della metrica
   * @returns {Promise<Object>} Metrica
   */
  async getMetric(name) {
    const metrics = await this.registry.getMetricsAsJSON();
    return metrics.find(m => m.name === name);
  }
  
  /**
   * Chiude il sistema di monitoraggio
   */
  close() {
    this.logger.info('Chiusura sistema di monitoraggio');
    
    // Ferma i timer
    if (this.jsonExportTimer) {
      clearInterval(this.jsonExportTimer);
    }
    
    if (this.pushgatewayTimer) {
      clearInterval(this.pushgatewayTimer);
    }
    
    if (this.alertingTimer) {
      clearInterval(this.alertingTimer);
    }
    
    // Chiudi il server
    if (this.server) {
      this.server.close();
    }
    
    // Chiudi il logger
    if (this.logger && typeof this.logger.close === 'function') {
      this.logger.close();
    }
  }
}

module.exports = MonitoringSystem;
