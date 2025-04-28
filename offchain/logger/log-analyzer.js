/**
 * Sistema di Analisi dei Log in Tempo Reale per il Layer-2 su Solana
 * 
 * Questo modulo implementa un sistema di analisi dei log in tempo reale con supporto per
 * pattern matching, rilevamento anomalie, aggregazioni e visualizzazioni.
 */

const EventEmitter = require('events');
const { promisify } = require('util');
const redis = require('redis');
const elasticsearch = require('@elastic/elasticsearch');
const { CentralizedLogger } = require('./logger');
const { SensitiveDataRedactor } = require('./sensitive_data_redactor');

/**
 * Classe per l'analisi dei log in tempo reale
 */
class LogAnalyzer extends EventEmitter {
  /**
   * Crea una nuova istanza dell'analizzatore di log
   * @param {Object} config - Configurazione dell'analizzatore
   * @param {Object} logger - Logger centralizzato
   */
  constructor(config, logger) {
    super();
    
    this.config = {
      patterns: [],
      anomalyDetection: {
        enabled: true,
        baselineWindow: 3600, // 1 ora
        sensitivityThreshold: 2.0, // Deviazioni standard
        minSampleSize: 30
      },
      aggregations: {
        enabled: true,
        windowSize: 60, // 1 minuto
        metrics: ['count', 'avg', 'min', 'max', 'p95', 'p99']
      },
      alerting: {
        enabled: true,
        channels: ['console', 'email', 'slack', 'webhook'],
        throttling: {
          enabled: true,
          window: 300, // 5 minuti
          maxAlerts: 10
        }
      },
      storage: {
        type: 'redis', // 'redis', 'elasticsearch', 'memory'
        redis: {
          host: 'localhost',
          port: 6379,
          keyPrefix: 'log-analyzer:'
        },
        elasticsearch: {
          node: 'http://localhost:9200',
          index: 'log-metrics'
        },
        retention: {
          raw: 86400 * 7, // 7 giorni
          aggregated: 86400 * 90 // 90 giorni
        }
      },
      ...config
    };
    
    this.logger = logger || new CentralizedLogger({
      appName: 'log-analyzer',
      logLevel: 'info'
    });
    
    // Inizializza il redattore di dati sensibili
    this.redactor = new SensitiveDataRedactor({
      enabled: true,
      patterns: [
        { regex: /("password"\s*:\s*)"[^"]*"/g, replacement: '$1"[REDACTED]"' },
        { regex: /("privateKey"\s*:\s*)"[^"]*"/g, replacement: '$1"[REDACTED]"' },
        { regex: /("secret"\s*:\s*)"[^"]*"/g, replacement: '$1"[REDACTED]"' },
        { regex: /("token"\s*:\s*)"[^"]*"/g, replacement: '$1"[REDACTED]"' }
      ]
    });
    
    // Inizializza lo storage
    this._initializeStorage();
    
    // Inizializza le strutture dati per l'analisi
    this.metrics = new Map();
    this.baselines = new Map();
    this.alertHistory = new Map();
    
    // Inizializza i timer per le aggregazioni periodiche
    this._initializeTimers();
    
    this.logger.info('Analizzatore di log inizializzato', {
      patternsCount: this.config.patterns.length,
      anomalyDetection: this.config.anomalyDetection.enabled,
      aggregations: this.config.aggregations.enabled,
      alerting: this.config.alerting.enabled,
      storageType: this.config.storage.type
    });
  }
  
  /**
   * Inizializza lo storage per i dati di analisi
   * @private
   */
  _initializeStorage() {
    switch (this.config.storage.type) {
      case 'redis':
        this._initializeRedisStorage();
        break;
      case 'elasticsearch':
        this._initializeElasticsearchStorage();
        break;
      case 'memory':
        // Nessuna inizializzazione speciale necessaria
        break;
      default:
        throw new Error(`Tipo di storage non supportato: ${this.config.storage.type}`);
    }
  }
  
  /**
   * Inizializza lo storage Redis
   * @private
   */
  _initializeRedisStorage() {
    const { host, port, keyPrefix } = this.config.storage.redis;
    
    this.redisClient = redis.createClient({
      host,
      port,
      prefix: keyPrefix
    });
    
    // Promisify dei metodi Redis
    this.redisGet = promisify(this.redisClient.get).bind(this.redisClient);
    this.redisSet = promisify(this.redisClient.set).bind(this.redisClient);
    this.redisIncr = promisify(this.redisClient.incr).bind(this.redisClient);
    this.redisExpire = promisify(this.redisClient.expire).bind(this.redisClient);
    this.redisDel = promisify(this.redisClient.del).bind(this.redisClient);
    this.redisKeys = promisify(this.redisClient.keys).bind(this.redisClient);
    this.redisHGet = promisify(this.redisClient.hget).bind(this.redisClient);
    this.redisHSet = promisify(this.redisClient.hset).bind(this.redisClient);
    this.redisHGetAll = promisify(this.redisClient.hgetall).bind(this.redisClient);
    this.redisZAdd = promisify(this.redisClient.zadd).bind(this.redisClient);
    this.redisZRange = promisify(this.redisClient.zrange).bind(this.redisClient);
    
    this.redisClient.on('error', (error) => {
      this.logger.error('Errore nella connessione Redis', { error });
    });
    
    this.logger.info('Storage Redis inizializzato', {
      host,
      port,
      keyPrefix
    });
  }
  
  /**
   * Inizializza lo storage Elasticsearch
   * @private
   */
  _initializeElasticsearchStorage() {
    const { node, index } = this.config.storage.elasticsearch;
    
    this.esClient = new elasticsearch.Client({
      node
    });
    
    // Verifica che l'indice esista
    this.esClient.indices.exists({ index })
      .then(exists => {
        if (!exists) {
          // Crea l'indice se non esiste
          return this.esClient.indices.create({
            index,
            body: {
              mappings: {
                properties: {
                  timestamp: { type: 'date' },
                  metricName: { type: 'keyword' },
                  metricType: { type: 'keyword' },
                  value: { type: 'float' },
                  count: { type: 'integer' },
                  min: { type: 'float' },
                  max: { type: 'float' },
                  avg: { type: 'float' },
                  p95: { type: 'float' },
                  p99: { type: 'float' },
                  tags: { type: 'object' }
                }
              }
            }
          });
        }
      })
      .then(() => {
        this.logger.info('Indice Elasticsearch verificato', { index });
      })
      .catch(error => {
        this.logger.error('Errore nella verifica dell\'indice Elasticsearch', { error });
      });
    
    this.logger.info('Storage Elasticsearch inizializzato', {
      node,
      index
    });
  }
  
  /**
   * Inizializza i timer per le aggregazioni periodiche
   * @private
   */
  _initializeTimers() {
    if (this.config.aggregations.enabled) {
      // Timer per le aggregazioni
      this.aggregationTimer = setInterval(() => {
        this._performAggregations();
      }, this.config.aggregations.windowSize * 1000);
      
      // Timer per la pulizia dei dati vecchi
      this.cleanupTimer = setInterval(() => {
        this._cleanupOldData();
      }, 3600 * 1000); // Ogni ora
    }
  }
  
  /**
   * Analizza un log
   * @param {Object} logEntry - Voce di log da analizzare
   */
  async analyzeLog(logEntry) {
    try {
      // Redazione dei dati sensibili
      const redactedLogEntry = this._redactSensitiveData(logEntry);
      
      // Pattern matching
      this._performPatternMatching(redactedLogEntry);
      
      // Aggiornamento delle metriche
      this._updateMetrics(redactedLogEntry);
      
      // Rilevamento anomalie
      if (this.config.anomalyDetection.enabled) {
        await this._detectAnomalies(redactedLogEntry);
      }
      
      // Emetti evento per il log analizzato
      this.emit('logAnalyzed', redactedLogEntry);
    } catch (error) {
      this.logger.error('Errore durante l\'analisi del log', { error });
    }
  }
  
  /**
   * Redazione dei dati sensibili
   * @private
   * @param {Object} logEntry - Voce di log
   * @returns {Object} Voce di log con dati sensibili redatti
   */
  _redactSensitiveData(logEntry) {
    // Crea una copia del log
    const redactedLogEntry = JSON.parse(JSON.stringify(logEntry));
    
    // Redazione del messaggio
    if (redactedLogEntry.message) {
      redactedLogEntry.message = this.redactor.redact(redactedLogEntry.message);
    }
    
    // Redazione dei metadati
    if (redactedLogEntry.metadata) {
      const metadataStr = JSON.stringify(redactedLogEntry.metadata);
      const redactedMetadataStr = this.redactor.redact(metadataStr);
      redactedLogEntry.metadata = JSON.parse(redactedMetadataStr);
    }
    
    return redactedLogEntry;
  }
  
  /**
   * Esegue il pattern matching sul log
   * @private
   * @param {Object} logEntry - Voce di log
   */
  _performPatternMatching(logEntry) {
    for (const pattern of this.config.patterns) {
      let match = false;
      
      // Verifica il livello di log
      if (pattern.level && logEntry.level !== pattern.level) {
        continue;
      }
      
      // Verifica il pattern sul messaggio
      if (pattern.messageRegex) {
        const regex = new RegExp(pattern.messageRegex);
        match = regex.test(logEntry.message);
      } else if (pattern.messageContains) {
        match = logEntry.message.includes(pattern.messageContains);
      }
      
      // Verifica i metadati
      if (pattern.metadata && logEntry.metadata) {
        for (const [key, value] of Object.entries(pattern.metadata)) {
          if (logEntry.metadata[key] !== value) {
            match = false;
            break;
          }
        }
      }
      
      // Se c'è un match, emetti un evento e genera un alert se necessario
      if (match) {
        this.emit('patternMatch', { pattern, logEntry });
        
        if (pattern.generateAlert) {
          this._generateAlert({
            type: 'pattern',
            pattern: pattern.name,
            message: `Pattern match: ${pattern.name}`,
            logEntry,
            severity: pattern.severity || 'info'
          });
        }
      }
    }
  }
  
  /**
   * Aggiorna le metriche in base al log
   * @private
   * @param {Object} logEntry - Voce di log
   */
  _updateMetrics(logEntry) {
    const timestamp = new Date(logEntry.timestamp || Date.now());
    const minute = Math.floor(timestamp.getTime() / 60000) * 60000;
    
    // Metriche per livello di log
    const levelKey = `level:${logEntry.level}:${minute}`;
    this._incrementMetric(levelKey);
    
    // Metriche per servizio
    if (logEntry.service) {
      const serviceKey = `service:${logEntry.service}:${minute}`;
      this._incrementMetric(serviceKey);
    }
    
    // Metriche per host
    if (logEntry.host) {
      const hostKey = `host:${logEntry.host}:${minute}`;
      this._incrementMetric(hostKey);
    }
    
    // Metriche per correlationId
    if (logEntry.correlationId) {
      const correlationKey = `correlation:${logEntry.correlationId}:${minute}`;
      this._incrementMetric(correlationKey);
    }
    
    // Metriche per durata (se presente)
    if (logEntry.metadata && logEntry.metadata.duration) {
      const durationKey = `duration:${logEntry.service || 'unknown'}:${minute}`;
      this._recordMetricValue(durationKey, logEntry.metadata.duration);
    }
    
    // Metriche per codice di stato (se presente)
    if (logEntry.metadata && logEntry.metadata.statusCode) {
      const statusKey = `status:${logEntry.metadata.statusCode}:${minute}`;
      this._incrementMetric(statusKey);
    }
  }
  
  /**
   * Incrementa una metrica
   * @private
   * @param {string} key - Chiave della metrica
   */
  async _incrementMetric(key) {
    // Aggiorna la metrica in memoria
    if (!this.metrics.has(key)) {
      this.metrics.set(key, { count: 1, values: [] });
    } else {
      const metric = this.metrics.get(key);
      metric.count += 1;
    }
    
    // Aggiorna la metrica nello storage
    if (this.config.storage.type === 'redis' && this.redisClient) {
      try {
        await this.redisIncr(`metric:${key}`);
        await this.redisExpire(`metric:${key}`, this.config.storage.retention.raw);
      } catch (error) {
        this.logger.error('Errore nell\'incremento della metrica su Redis', { key, error });
      }
    } else if (this.config.storage.type === 'elasticsearch' && this.esClient) {
      try {
        await this.esClient.index({
          index: this.config.storage.elasticsearch.index,
          body: {
            timestamp: new Date(),
            metricName: key,
            metricType: 'count',
            value: 1
          }
        });
      } catch (error) {
        this.logger.error('Errore nell\'incremento della metrica su Elasticsearch', { key, error });
      }
    }
  }
  
  /**
   * Registra un valore per una metrica
   * @private
   * @param {string} key - Chiave della metrica
   * @param {number} value - Valore da registrare
   */
  async _recordMetricValue(key, value) {
    // Aggiorna la metrica in memoria
    if (!this.metrics.has(key)) {
      this.metrics.set(key, { count: 1, values: [value] });
    } else {
      const metric = this.metrics.get(key);
      metric.count += 1;
      metric.values.push(value);
    }
    
    // Aggiorna la metrica nello storage
    if (this.config.storage.type === 'redis' && this.redisClient) {
      try {
        await this.redisZAdd(`metric-values:${key}`, Date.now(), value);
        await this.redisExpire(`metric-values:${key}`, this.config.storage.retention.raw);
      } catch (error) {
        this.logger.error('Errore nella registrazione del valore della metrica su Redis', { key, value, error });
      }
    } else if (this.config.storage.type === 'elasticsearch' && this.esClient) {
      try {
        await this.esClient.index({
          index: this.config.storage.elasticsearch.index,
          body: {
            timestamp: new Date(),
            metricName: key,
            metricType: 'value',
            value
          }
        });
      } catch (error) {
        this.logger.error('Errore nella registrazione del valore della metrica su Elasticsearch', { key, value, error });
      }
    }
  }
  
  /**
   * Esegue le aggregazioni sulle metriche
   * @private
   */
  async _performAggregations() {
    this.logger.debug('Esecuzione aggregazioni sulle metriche');
    
    const now = Date.now();
    const aggregations = [];
    
    // Itera su tutte le metriche
    for (const [key, metric] of this.metrics.entries()) {
      const [type, name, timestamp] = key.split(':');
      
      // Calcola le aggregazioni
      const aggregation = {
        key,
        type,
        name,
        timestamp: parseInt(timestamp),
        count: metric.count
      };
      
      // Calcola le statistiche sui valori
      if (metric.values && metric.values.length > 0) {
        // Ordina i valori per calcolare i percentili
        const sortedValues = [...metric.values].sort((a, b) => a - b);
        
        aggregation.min = sortedValues[0];
        aggregation.max = sortedValues[sortedValues.length - 1];
        aggregation.avg = sortedValues.reduce((sum, val) => sum + val, 0) / sortedValues.length;
        
        // Calcola i percentili
        const p95Index = Math.floor(sortedValues.length * 0.95);
        const p99Index = Math.floor(sortedValues.length * 0.99);
        
        aggregation.p95 = sortedValues[p95Index];
        aggregation.p99 = sortedValues[p99Index];
      }
      
      aggregations.push(aggregation);
      
      // Salva l'aggregazione nello storage
      await this._saveAggregation(aggregation);
    }
    
    // Emetti evento per le aggregazioni
    this.emit('aggregationsPerformed', aggregations);
    
    // Resetta le metriche per il prossimo periodo
    this.metrics.clear();
  }
  
  /**
   * Salva un'aggregazione nello storage
   * @private
   * @param {Object} aggregation - Aggregazione da salvare
   */
  async _saveAggregation(aggregation) {
    if (this.config.storage.type === 'redis' && this.redisClient) {
      try {
        // Salva l'aggregazione come hash
        const key = `aggregation:${aggregation.type}:${aggregation.name}:${aggregation.timestamp}`;
        
        for (const [field, value] of Object.entries(aggregation)) {
          if (field !== 'key' && field !== 'type' && field !== 'name' && field !== 'timestamp') {
            await this.redisHSet(key, field, value);
          }
        }
        
        // Imposta la scadenza
        await this.redisExpire(key, this.config.storage.retention.aggregated);
      } catch (error) {
        this.logger.error('Errore nel salvataggio dell\'aggregazione su Redis', { aggregation, error });
      }
    } else if (this.config.storage.type === 'elasticsearch' && this.esClient) {
      try {
        // Salva l'aggregazione come documento
        await this.esClient.index({
          index: this.config.storage.elasticsearch.index,
          body: {
            timestamp: new Date(aggregation.timestamp),
            metricName: `${aggregation.type}:${aggregation.name}`,
            metricType: 'aggregation',
            ...aggregation
          }
        });
      } catch (error) {
        this.logger.error('Errore nel salvataggio dell\'aggregazione su Elasticsearch', { aggregation, error });
      }
    }
  }
  
  /**
   * Rileva anomalie nei log
   * @private
   * @param {Object} logEntry - Voce di log
   */
  async _detectAnomalies(logEntry) {
    // Estrai le metriche rilevanti dal log
    const metrics = this._extractMetricsFromLog(logEntry);
    
    for (const [metricName, value] of Object.entries(metrics)) {
      // Ottieni la baseline per questa metrica
      const baseline = await this._getBaseline(metricName);
      
      // Se non c'è una baseline valida, aggiorna la baseline e continua
      if (!baseline || baseline.count < this.config.anomalyDetection.minSampleSize) {
        await this._updateBaseline(metricName, value);
        continue;
      }
      
      // Calcola la deviazione dalla baseline
      const deviation = Math.abs(value - baseline.mean) / baseline.stdDev;
      
      // Se la deviazione supera la soglia, genera un alert
      if (deviation > this.config.anomalyDetection.sensitivityThreshold) {
        this._generateAlert({
          type: 'anomaly',
          metricName,
          value,
          baseline: baseline.mean,
          deviation,
          message: `Anomalia rilevata per ${metricName}: ${value} (deviazione: ${deviation.toFixed(2)})`,
          logEntry,
          severity: this._calculateAnomalySeverity(deviation)
        });
      }
      
      // Aggiorna la baseline con il nuovo valore
      await this._updateBaseline(metricName, value);
    }
  }
  
  /**
   * Estrae le metriche da un log
   * @private
   * @param {Object} logEntry - Voce di log
   * @returns {Object} Metriche estratte
   */
  _extractMetricsFromLog(logEntry) {
    const metrics = {};
    
    // Metrica per il livello di log
    metrics[`level:${logEntry.level}`] = 1;
    
    // Metrica per il servizio
    if (logEntry.service) {
      metrics[`service:${logEntry.service}`] = 1;
    }
    
    // Metrica per la durata (se presente)
    if (logEntry.metadata && logEntry.metadata.duration) {
      metrics[`duration:${logEntry.service || 'unknown'}`] = logEntry.metadata.duration;
    }
    
    // Metrica per il codice di stato (se presente)
    if (logEntry.metadata && logEntry.metadata.statusCode) {
      metrics[`status:${logEntry.metadata.statusCode}`] = 1;
    }
    
    return metrics;
  }
  
  /**
   * Ottiene la baseline per una metrica
   * @private
   * @param {string} metricName - Nome della metrica
   * @returns {Object} Baseline della metrica
   */
  async _getBaseline(metricName) {
    // Prova a ottenere la baseline dalla memoria
    if (this.baselines.has(metricName)) {
      return this.baselines.get(metricName);
    }
    
    // Prova a ottenere la baseline dallo storage
    if (this.config.storage.type === 'redis' && this.redisClient) {
      try {
        const baselineKey = `baseline:${metricName}`;
        const baseline = await this.redisHGetAll(baselineKey);
        
        if (baseline && baseline.count) {
          // Converti i valori in numeri
          baseline.count = parseInt(baseline.count);
          baseline.mean = parseFloat(baseline.mean);
          baseline.stdDev = parseFloat(baseline.stdDev);
          baseline.min = parseFloat(baseline.min);
          baseline.max = parseFloat(baseline.max);
          
          // Memorizza la baseline
          this.baselines.set(metricName, baseline);
          
          return baseline;
        }
      } catch (error) {
        this.logger.error('Errore nel recupero della baseline da Redis', { metricName, error });
      }
    } else if (this.config.storage.type === 'elasticsearch' && this.esClient) {
      try {
        const response = await this.esClient.search({
          index: this.config.storage.elasticsearch.index,
          body: {
            query: {
              bool: {
                must: [
                  { term: { metricName } },
                  { term: { metricType: 'baseline' } }
                ]
              }
            },
            sort: [
              { timestamp: { order: 'desc' } }
            ],
            size: 1
          }
        });
        
        if (response.hits.hits.length > 0) {
          const baseline = response.hits.hits[0]._source;
          
          // Memorizza la baseline
          this.baselines.set(metricName, baseline);
          
          return baseline;
        }
      } catch (error) {
        this.logger.error('Errore nel recupero della baseline da Elasticsearch', { metricName, error });
      }
    }
    
    // Se non è stata trovata una baseline, restituisci null
    return null;
  }
  
  /**
   * Aggiorna la baseline per una metrica
   * @private
   * @param {string} metricName - Nome della metrica
   * @param {number} value - Nuovo valore
   */
  async _updateBaseline(metricName, value) {
    // Ottieni la baseline corrente
    let baseline = this.baselines.get(metricName);
    
    if (!baseline) {
      // Inizializza una nuova baseline
      baseline = {
        count: 0,
        mean: 0,
        stdDev: 0,
        min: value,
        max: value,
        sum: 0,
        sumSquares: 0
      };
    }
    
    // Aggiorna la baseline con il nuovo valore
    baseline.count += 1;
    baseline.sum += value;
    baseline.sumSquares += value * value;
    baseline.min = Math.min(baseline.min, value);
    baseline.max = Math.max(baseline.max, value);
    
    // Calcola la nuova media
    baseline.mean = baseline.sum / baseline.count;
    
    // Calcola la nuova deviazione standard
    if (baseline.count > 1) {
      baseline.stdDev = Math.sqrt(
        (baseline.sumSquares - (baseline.sum * baseline.sum) / baseline.count) / (baseline.count - 1)
      );
    }
    
    // Memorizza la baseline aggiornata
    this.baselines.set(metricName, baseline);
    
    // Salva la baseline nello storage
    if (this.config.storage.type === 'redis' && this.redisClient) {
      try {
        const baselineKey = `baseline:${metricName}`;
        
        // Salva la baseline come hash
        await this.redisHSet(baselineKey, 'count', baseline.count);
        await this.redisHSet(baselineKey, 'mean', baseline.mean);
        await this.redisHSet(baselineKey, 'stdDev', baseline.stdDev);
        await this.redisHSet(baselineKey, 'min', baseline.min);
        await this.redisHSet(baselineKey, 'max', baseline.max);
        await this.redisHSet(baselineKey, 'sum', baseline.sum);
        await this.redisHSet(baselineKey, 'sumSquares', baseline.sumSquares);
        
        // Imposta la scadenza
        await this.redisExpire(baselineKey, this.config.storage.retention.aggregated);
      } catch (error) {
        this.logger.error('Errore nell\'aggiornamento della baseline su Redis', { metricName, value, error });
      }
    } else if (this.config.storage.type === 'elasticsearch' && this.esClient) {
      try {
        // Salva la baseline come documento
        await this.esClient.index({
          index: this.config.storage.elasticsearch.index,
          body: {
            timestamp: new Date(),
            metricName,
            metricType: 'baseline',
            ...baseline
          }
        });
      } catch (error) {
        this.logger.error('Errore nell\'aggiornamento della baseline su Elasticsearch', { metricName, value, error });
      }
    }
  }
  
  /**
   * Calcola la severità di un'anomalia
   * @private
   * @param {number} deviation - Deviazione dalla baseline
   * @returns {string} Severità dell'anomalia
   */
  _calculateAnomalySeverity(deviation) {
    if (deviation > 5) {
      return 'critical';
    } else if (deviation > 4) {
      return 'error';
    } else if (deviation > 3) {
      return 'warn';
    } else {
      return 'info';
    }
  }
  
  /**
   * Genera un alert
   * @private
   * @param {Object} alert - Dati dell'alert
   */
  _generateAlert(alert) {
    // Verifica se l'alert deve essere throttled
    if (this._shouldThrottleAlert(alert)) {
      return;
    }
    
    // Aggiungi timestamp all'alert
    alert.timestamp = new Date();
    
    // Emetti evento per l'alert
    this.emit('alert', alert);
    
    // Invia l'alert ai canali configurati
    this._sendAlertToChannels(alert);
    
    // Aggiorna la storia degli alert
    this._updateAlertHistory(alert);
  }
  
  /**
   * Verifica se un alert deve essere throttled
   * @private
   * @param {Object} alert - Dati dell'alert
   * @returns {boolean} True se l'alert deve essere throttled
   */
  _shouldThrottleAlert(alert) {
    if (!this.config.alerting.throttling.enabled) {
      return false;
    }
    
    const alertKey = `${alert.type}:${alert.metricName || alert.pattern}`;
    const now = Date.now();
    
    // Verifica se l'alert è già stato generato nel periodo di throttling
    if (this.alertHistory.has(alertKey)) {
      const history = this.alertHistory.get(alertKey);
      
      // Verifica se è stato raggiunto il limite di alert
      if (history.count >= this.config.alerting.throttling.maxAlerts) {
        const windowStart = now - (this.config.alerting.throttling.window * 1000);
        
        // Verifica se siamo ancora nel periodo di throttling
        if (history.lastTimestamp > windowStart) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * Aggiorna la storia degli alert
   * @private
   * @param {Object} alert - Dati dell'alert
   */
  _updateAlertHistory(alert) {
    const alertKey = `${alert.type}:${alert.metricName || alert.pattern}`;
    const now = Date.now();
    
    // Aggiorna la storia dell'alert
    if (this.alertHistory.has(alertKey)) {
      const history = this.alertHistory.get(alertKey);
      
      // Verifica se siamo in un nuovo periodo di throttling
      const windowStart = now - (this.config.alerting.throttling.window * 1000);
      
      if (history.lastTimestamp < windowStart) {
        // Resetta il contatore per il nuovo periodo
        history.count = 1;
      } else {
        // Incrementa il contatore
        history.count += 1;
      }
      
      history.lastTimestamp = now;
    } else {
      // Inizializza la storia dell'alert
      this.alertHistory.set(alertKey, {
        count: 1,
        lastTimestamp: now
      });
    }
  }
  
  /**
   * Invia un alert ai canali configurati
   * @private
   * @param {Object} alert - Dati dell'alert
   */
  _sendAlertToChannels(alert) {
    for (const channel of this.config.alerting.channels) {
      switch (channel) {
        case 'console':
          this._sendAlertToConsole(alert);
          break;
        case 'email':
          this._sendAlertToEmail(alert);
          break;
        case 'slack':
          this._sendAlertToSlack(alert);
          break;
        case 'webhook':
          this._sendAlertToWebhook(alert);
          break;
      }
    }
  }
  
  /**
   * Invia un alert alla console
   * @private
   * @param {Object} alert - Dati dell'alert
   */
  _sendAlertToConsole(alert) {
    this.logger.log(alert.severity, `ALERT: ${alert.message}`, {
      alert
    });
  }
  
  /**
   * Invia un alert via email
   * @private
   * @param {Object} alert - Dati dell'alert
   */
  _sendAlertToEmail(alert) {
    // Implementazione dell'invio email
    this.logger.debug('Invio alert via email', { alert });
    
    // Qui andrebbe implementato l'invio effettivo dell'email
    // utilizzando un servizio come nodemailer
  }
  
  /**
   * Invia un alert a Slack
   * @private
   * @param {Object} alert - Dati dell'alert
   */
  _sendAlertToSlack(alert) {
    // Implementazione dell'invio a Slack
    this.logger.debug('Invio alert a Slack', { alert });
    
    // Qui andrebbe implementato l'invio effettivo a Slack
    // utilizzando l'API di Slack
  }
  
  /**
   * Invia un alert a un webhook
   * @private
   * @param {Object} alert - Dati dell'alert
   */
  _sendAlertToWebhook(alert) {
    // Implementazione dell'invio a webhook
    this.logger.debug('Invio alert a webhook', { alert });
    
    // Qui andrebbe implementato l'invio effettivo al webhook
    // utilizzando fetch o axios
  }
  
  /**
   * Pulisce i dati vecchi
   * @private
   */
  async _cleanupOldData() {
    this.logger.debug('Pulizia dati vecchi');
    
    const now = Date.now();
    const rawRetention = this.config.storage.retention.raw * 1000;
    const aggregatedRetention = this.config.storage.retention.aggregated * 1000;
    
    if (this.config.storage.type === 'redis' && this.redisClient) {
      try {
        // Pulizia delle metriche
        const metricKeys = await this.redisKeys('metric:*');
        for (const key of metricKeys) {
          const parts = key.split(':');
          const timestamp = parseInt(parts[parts.length - 1]);
          
          if (now - timestamp > rawRetention) {
            await this.redisDel(key);
          }
        }
        
        // Pulizia dei valori delle metriche
        const valueKeys = await this.redisKeys('metric-values:*');
        for (const key of valueKeys) {
          const parts = key.split(':');
          const timestamp = parseInt(parts[parts.length - 1]);
          
          if (now - timestamp > rawRetention) {
            await this.redisDel(key);
          }
        }
        
        // Pulizia delle aggregazioni
        const aggregationKeys = await this.redisKeys('aggregation:*');
        for (const key of aggregationKeys) {
          const parts = key.split(':');
          const timestamp = parseInt(parts[parts.length - 1]);
          
          if (now - timestamp > aggregatedRetention) {
            await this.redisDel(key);
          }
        }
      } catch (error) {
        this.logger.error('Errore nella pulizia dei dati vecchi su Redis', { error });
      }
    } else if (this.config.storage.type === 'elasticsearch' && this.esClient) {
      try {
        // Pulizia dei dati raw
        await this.esClient.deleteByQuery({
          index: this.config.storage.elasticsearch.index,
          body: {
            query: {
              bool: {
                must: [
                  {
                    range: {
                      timestamp: {
                        lt: new Date(now - rawRetention).toISOString()
                      }
                    }
                  },
                  {
                    terms: {
                      metricType: ['count', 'value']
                    }
                  }
                ]
              }
            }
          }
        });
        
        // Pulizia dei dati aggregati
        await this.esClient.deleteByQuery({
          index: this.config.storage.elasticsearch.index,
          body: {
            query: {
              bool: {
                must: [
                  {
                    range: {
                      timestamp: {
                        lt: new Date(now - aggregatedRetention).toISOString()
                      }
                    }
                  },
                  {
                    terms: {
                      metricType: ['aggregation', 'baseline']
                    }
                  }
                ]
              }
            }
          }
        });
      } catch (error) {
        this.logger.error('Errore nella pulizia dei dati vecchi su Elasticsearch', { error });
      }
    }
  }
  
  /**
   * Ottiene le metriche per un periodo
   * @param {string} metricName - Nome della metrica
   * @param {number} startTime - Timestamp di inizio
   * @param {number} endTime - Timestamp di fine
   * @returns {Array} Metriche per il periodo
   */
  async getMetrics(metricName, startTime, endTime) {
    const metrics = [];
    
    if (this.config.storage.type === 'redis' && this.redisClient) {
      try {
        // Ottieni le chiavi delle aggregazioni per la metrica
        const keys = await this.redisKeys(`aggregation:*:${metricName}:*`);
        
        for (const key of keys) {
          const parts = key.split(':');
          const timestamp = parseInt(parts[parts.length - 1]);
          
          if (timestamp >= startTime && timestamp <= endTime) {
            const aggregation = await this.redisHGetAll(key);
            
            if (aggregation) {
              // Converti i valori in numeri
              for (const [field, value] of Object.entries(aggregation)) {
                if (field !== 'key' && field !== 'type' && field !== 'name') {
                  aggregation[field] = parseFloat(value);
                }
              }
              
              metrics.push({
                timestamp,
                ...aggregation
              });
            }
          }
        }
      } catch (error) {
        this.logger.error('Errore nel recupero delle metriche da Redis', { metricName, startTime, endTime, error });
      }
    } else if (this.config.storage.type === 'elasticsearch' && this.esClient) {
      try {
        const response = await this.esClient.search({
          index: this.config.storage.elasticsearch.index,
          body: {
            query: {
              bool: {
                must: [
                  { term: { metricName } },
                  { term: { metricType: 'aggregation' } },
                  {
                    range: {
                      timestamp: {
                        gte: new Date(startTime).toISOString(),
                        lte: new Date(endTime).toISOString()
                      }
                    }
                  }
                ]
              }
            },
            sort: [
              { timestamp: { order: 'asc' } }
            ],
            size: 10000
          }
        });
        
        for (const hit of response.hits.hits) {
          metrics.push(hit._source);
        }
      } catch (error) {
        this.logger.error('Errore nel recupero delle metriche da Elasticsearch', { metricName, startTime, endTime, error });
      }
    }
    
    return metrics;
  }
  
  /**
   * Ottiene gli alert per un periodo
   * @param {number} startTime - Timestamp di inizio
   * @param {number} endTime - Timestamp di fine
   * @param {string} severity - Severità degli alert
   * @returns {Array} Alert per il periodo
   */
  async getAlerts(startTime, endTime, severity = null) {
    const alerts = [];
    
    if (this.config.storage.type === 'elasticsearch' && this.esClient) {
      try {
        const query = {
          bool: {
            must: [
              { term: { metricType: 'alert' } },
              {
                range: {
                  timestamp: {
                    gte: new Date(startTime).toISOString(),
                    lte: new Date(endTime).toISOString()
                  }
                }
              }
            ]
          }
        };
        
        if (severity) {
          query.bool.must.push({ term: { severity } });
        }
        
        const response = await this.esClient.search({
          index: this.config.storage.elasticsearch.index,
          body: {
            query,
            sort: [
              { timestamp: { order: 'desc' } }
            ],
            size: 1000
          }
        });
        
        for (const hit of response.hits.hits) {
          alerts.push(hit._source);
        }
      } catch (error) {
        this.logger.error('Errore nel recupero degli alert da Elasticsearch', { startTime, endTime, severity, error });
      }
    }
    
    return alerts;
  }
  
  /**
   * Aggiunge un pattern di matching
   * @param {Object} pattern - Pattern da aggiungere
   */
  addPattern(pattern) {
    this.config.patterns.push(pattern);
    
    this.logger.info('Pattern aggiunto', { pattern });
  }
  
  /**
   * Rimuove un pattern di matching
   * @param {string} patternName - Nome del pattern da rimuovere
   * @returns {boolean} True se il pattern è stato rimosso
   */
  removePattern(patternName) {
    const index = this.config.patterns.findIndex(p => p.name === patternName);
    
    if (index !== -1) {
      this.config.patterns.splice(index, 1);
      this.logger.info('Pattern rimosso', { patternName });
      return true;
    }
    
    return false;
  }
  
  /**
   * Aggiorna la configurazione dell'analizzatore
   * @param {Object} config - Nuova configurazione
   */
  updateConfig(config) {
    this.config = {
      ...this.config,
      ...config
    };
    
    this.logger.info('Configurazione aggiornata', {
      patternsCount: this.config.patterns.length,
      anomalyDetection: this.config.anomalyDetection.enabled,
      aggregations: this.config.aggregations.enabled,
      alerting: this.config.alerting.enabled,
      storageType: this.config.storage.type
    });
  }
  
  /**
   * Chiude l'analizzatore e le sue risorse
   */
  close() {
    this.logger.info('Chiusura analizzatore di log');
    
    // Ferma i timer
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
    }
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    // Esegui le aggregazioni finali
    this._performAggregations();
    
    // Chiudi le connessioni
    if (this.redisClient) {
      this.redisClient.quit();
    }
    
    // Chiudi il logger
    if (this.logger && typeof this.logger.close === 'function') {
      this.logger.close();
    }
  }
}

module.exports = LogAnalyzer;
