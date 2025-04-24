/**
 * Sistema di Logging Centralizzato per il Layer-2 su Solana
 * 
 * Questo modulo implementa un sistema di logging centralizzato con supporto per
 * diversi formati, rotazione dei log, analisi in tempo reale e integrazione con
 * sistemi esterni come ELK Stack o Grafana Loki.
 */

const winston = require('winston');
const { format } = winston;
const { combine, timestamp, label, printf, json, colorize, align } = format;
const DailyRotateFile = require('winston-daily-rotate-file');
const Transport = require('winston-transport');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { SensitiveDataRedactor } = require('./sensitive_data_redactor');
const { RequestCorrelator } = require('./request_correlator');

// Formato personalizzato per i log
const customFormat = printf(({ level, message, label, timestamp, ...metadata }) => {
  let metaStr = '';
  if (Object.keys(metadata).length > 0) {
    metaStr = JSON.stringify(metadata);
  }
  return `${timestamp} [${label}] ${level}: ${message} ${metaStr}`;
});

/**
 * Trasporto personalizzato per inviare log a Elasticsearch
 */
class ElasticsearchTransport extends Transport {
  constructor(opts) {
    super(opts);
    this.client = opts.client;
    this.index = opts.index || 'logs';
    this.flushInterval = opts.flushInterval || 5000;
    this.bufferSize = opts.bufferSize || 100;
    this.buffer = [];
    
    // Avvia il timer per il flush periodico
    this.timer = setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }
  
  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });
    
    // Aggiungi il log al buffer
    this.buffer.push({
      '@timestamp': new Date().toISOString(),
      level: info.level,
      message: info.message,
      ...info
    });
    
    // Se il buffer è pieno, esegui il flush
    if (this.buffer.length >= this.bufferSize) {
      this.flush();
    }
    
    callback();
  }
  
  flush() {
    if (this.buffer.length === 0) {
      return;
    }
    
    const bulkBody = [];
    
    // Prepara il corpo della richiesta bulk
    this.buffer.forEach(doc => {
      bulkBody.push(
        { index: { _index: this.index } },
        doc
      );
    });
    
    // Invia i log a Elasticsearch
    this.client.bulk({ body: bulkBody })
      .then(response => {
        if (response.errors) {
          console.error('Errori durante l\'invio dei log a Elasticsearch:', response.errors);
        }
      })
      .catch(error => {
        console.error('Errore durante l\'invio dei log a Elasticsearch:', error);
      });
    
    // Svuota il buffer
    this.buffer = [];
  }
  
  close() {
    clearInterval(this.timer);
    this.flush();
  }
}

/**
 * Trasporto personalizzato per inviare log a Loki
 */
class LokiTransport extends Transport {
  constructor(opts) {
    super(opts);
    this.url = opts.url;
    this.labels = opts.labels || {};
    this.flushInterval = opts.flushInterval || 5000;
    this.bufferSize = opts.bufferSize || 100;
    this.buffer = [];
    
    // Avvia il timer per il flush periodico
    this.timer = setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }
  
  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });
    
    // Aggiungi il log al buffer
    this.buffer.push({
      timestamp: Date.now() * 1000000, // Nanosecondi
      level: info.level,
      message: info.message,
      ...info
    });
    
    // Se il buffer è pieno, esegui il flush
    if (this.buffer.length >= this.bufferSize) {
      this.flush();
    }
    
    callback();
  }
  
  flush() {
    if (this.buffer.length === 0) {
      return;
    }
    
    // Prepara i dati per Loki
    const streams = [{
      stream: this.labels,
      values: this.buffer.map(log => [
        log.timestamp.toString(),
        JSON.stringify(log)
      ])
    }];
    
    // Invia i log a Loki
    fetch(`${this.url}/loki/api/v1/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ streams })
    })
      .then(response => {
        if (!response.ok) {
          console.error('Errore durante l\'invio dei log a Loki:', response.statusText);
        }
      })
      .catch(error => {
        console.error('Errore durante l\'invio dei log a Loki:', error);
      });
    
    // Svuota il buffer
    this.buffer = [];
  }
  
  close() {
    clearInterval(this.timer);
    this.flush();
  }
}

/**
 * Classe principale per il sistema di logging centralizzato
 */
class CentralizedLogger {
  /**
   * Crea una nuova istanza del logger centralizzato
   * @param {Object} config - Configurazione del logger
   * @param {string} config.appName - Nome dell'applicazione
   * @param {string} config.logLevel - Livello di log (debug, info, warn, error)
   * @param {string} config.logDir - Directory per i file di log
   * @param {Object} config.console - Configurazione per il log su console
   * @param {Object} config.file - Configurazione per il log su file
   * @param {Object} config.elasticsearch - Configurazione per Elasticsearch
   * @param {Object} config.loki - Configurazione per Grafana Loki
   * @param {Object} config.redaction - Configurazione per la redazione dei dati sensibili
   * @param {Object} config.correlation - Configurazione per la correlazione delle richieste
   */
  constructor(config) {
    this.config = {
      appName: 'layer2-solana',
      logLevel: 'info',
      logDir: './logs',
      console: {
        enabled: true,
        colorize: true
      },
      file: {
        enabled: true,
        maxSize: '20m',
        maxFiles: '14d'
      },
      elasticsearch: {
        enabled: false,
        url: 'http://localhost:9200',
        index: 'logs',
        flushInterval: 5000,
        bufferSize: 100
      },
      loki: {
        enabled: false,
        url: 'http://localhost:3100',
        labels: {
          app: 'layer2-solana'
        },
        flushInterval: 5000,
        bufferSize: 100
      },
      redaction: {
        enabled: true,
        patterns: [
          { regex: /("password"\s*:\s*)"[^"]*"/g, replacement: '$1"[REDACTED]"' },
          { regex: /("privateKey"\s*:\s*)"[^"]*"/g, replacement: '$1"[REDACTED]"' },
          { regex: /("secret"\s*:\s*)"[^"]*"/g, replacement: '$1"[REDACTED]"' },
          { regex: /("token"\s*:\s*)"[^"]*"/g, replacement: '$1"[REDACTED]"' }
        ]
      },
      correlation: {
        enabled: true,
        headerName: 'x-correlation-id'
      },
      ...config
    };
    
    // Crea la directory dei log se non esiste
    if (this.config.file.enabled) {
      if (!fs.existsSync(this.config.logDir)) {
        fs.mkdirSync(this.config.logDir, { recursive: true });
      }
    }
    
    // Inizializza il redattore di dati sensibili
    if (this.config.redaction.enabled) {
      this.redactor = new SensitiveDataRedactor(this.config.redaction);
    }
    
    // Inizializza il correlatore di richieste
    if (this.config.correlation.enabled) {
      this.correlator = new RequestCorrelator(this.config.correlation);
    }
    
    // Inizializza il logger
    this._initializeLogger();
  }
  
  /**
   * Inizializza il logger con i trasporti configurati
   * @private
   */
  _initializeLogger() {
    const transports = [];
    
    // Aggiungi il trasporto console
    if (this.config.console.enabled) {
      transports.push(new winston.transports.Console({
        level: this.config.logLevel,
        format: combine(
          colorize({ all: this.config.console.colorize }),
          timestamp(),
          align(),
          customFormat
        )
      }));
    }
    
    // Aggiungi il trasporto file
    if (this.config.file.enabled) {
      // Log di tutti i livelli
      transports.push(new DailyRotateFile({
        level: this.config.logLevel,
        dirname: this.config.logDir,
        filename: `${this.config.appName}-%DATE%.log`,
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: this.config.file.maxSize,
        maxFiles: this.config.file.maxFiles,
        format: combine(
          timestamp(),
          json()
        )
      }));
      
      // Log solo degli errori
      transports.push(new DailyRotateFile({
        level: 'error',
        dirname: this.config.logDir,
        filename: `${this.config.appName}-error-%DATE%.log`,
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: this.config.file.maxSize,
        maxFiles: this.config.file.maxFiles,
        format: combine(
          timestamp(),
          json()
        )
      }));
    }
    
    // Aggiungi il trasporto Elasticsearch
    if (this.config.elasticsearch.enabled) {
      const { Client } = require('@elastic/elasticsearch');
      const client = new Client({ node: this.config.elasticsearch.url });
      
      transports.push(new ElasticsearchTransport({
        level: this.config.logLevel,
        client,
        index: this.config.elasticsearch.index,
        flushInterval: this.config.elasticsearch.flushInterval,
        bufferSize: this.config.elasticsearch.bufferSize
      }));
    }
    
    // Aggiungi il trasporto Loki
    if (this.config.loki.enabled) {
      transports.push(new LokiTransport({
        level: this.config.logLevel,
        url: this.config.loki.url,
        labels: {
          app: this.config.appName,
          host: os.hostname(),
          ...this.config.loki.labels
        },
        flushInterval: this.config.loki.flushInterval,
        bufferSize: this.config.loki.bufferSize
      }));
    }
    
    // Crea il logger
    this.logger = winston.createLogger({
      level: this.config.logLevel,
      format: combine(
        label({ label: this.config.appName }),
        timestamp(),
        json()
      ),
      defaultMeta: {
        service: this.config.appName,
        host: os.hostname()
      },
      transports
    });
    
    // Log di inizializzazione
    this.logger.info('Logger centralizzato inizializzato', {
      appName: this.config.appName,
      logLevel: this.config.logLevel,
      transports: transports.map(t => t.name || t.constructor.name)
    });
  }
  
  /**
   * Prepara i metadati per il log
   * @private
   * @param {Object} metadata - Metadati originali
   * @returns {Object} Metadati preparati
   */
  _prepareMetadata(metadata) {
    let preparedMetadata = { ...metadata };
    
    // Aggiungi l'ID di correlazione se disponibile
    if (this.config.correlation.enabled && this.correlator) {
      const correlationId = this.correlator.getCurrentCorrelationId();
      if (correlationId) {
        preparedMetadata.correlationId = correlationId;
      }
    }
    
    // Aggiungi informazioni sul processo
    preparedMetadata.pid = process.pid;
    preparedMetadata.memory = process.memoryUsage().rss;
    
    return preparedMetadata;
  }
  
  /**
   * Prepara il messaggio di log
   * @private
   * @param {string} message - Messaggio originale
   * @returns {string} Messaggio preparato
   */
  _prepareMessage(message) {
    let preparedMessage = message;
    
    // Redazione dei dati sensibili
    if (this.config.redaction.enabled && this.redactor) {
      preparedMessage = this.redactor.redact(preparedMessage);
    }
    
    return preparedMessage;
  }
  
  /**
   * Registra un messaggio di log
   * @param {string} level - Livello di log
   * @param {string} message - Messaggio di log
   * @param {Object} metadata - Metadati aggiuntivi
   */
  log(level, message, metadata = {}) {
    const preparedMessage = this._prepareMessage(message);
    const preparedMetadata = this._prepareMetadata(metadata);
    
    this.logger.log(level, preparedMessage, preparedMetadata);
  }
  
  /**
   * Registra un messaggio di debug
   * @param {string} message - Messaggio di log
   * @param {Object} metadata - Metadati aggiuntivi
   */
  debug(message, metadata = {}) {
    this.log('debug', message, metadata);
  }
  
  /**
   * Registra un messaggio informativo
   * @param {string} message - Messaggio di log
   * @param {Object} metadata - Metadati aggiuntivi
   */
  info(message, metadata = {}) {
    this.log('info', message, metadata);
  }
  
  /**
   * Registra un avviso
   * @param {string} message - Messaggio di log
   * @param {Object} metadata - Metadati aggiuntivi
   */
  warn(message, metadata = {}) {
    this.log('warn', message, metadata);
  }
  
  /**
   * Registra un errore
   * @param {string} message - Messaggio di log
   * @param {Object} metadata - Metadati aggiuntivi
   */
  error(message, metadata = {}) {
    // Se metadata contiene un oggetto Error, estrai le informazioni
    if (metadata.error instanceof Error) {
      const error = metadata.error;
      metadata = {
        ...metadata,
        error: {
          message: error.message,
          name: error.name,
          stack: error.stack,
          ...metadata.error
        }
      };
    }
    
    this.log('error', message, metadata);
  }
  
  /**
   * Registra un errore critico
   * @param {string} message - Messaggio di log
   * @param {Object} metadata - Metadati aggiuntivi
   */
  critical(message, metadata = {}) {
    // Se metadata contiene un oggetto Error, estrai le informazioni
    if (metadata.error instanceof Error) {
      const error = metadata.error;
      metadata = {
        ...metadata,
        error: {
          message: error.message,
          name: error.name,
          stack: error.stack,
          ...metadata.error
        }
      };
    }
    
    this.log('crit', message, metadata);
  }
  
  /**
   * Crea un logger figlio con metadati aggiuntivi
   * @param {Object} metadata - Metadati da aggiungere
   * @returns {Object} Logger figlio
   */
  child(metadata) {
    const childLogger = Object.create(this);
    
    // Sovrascrive i metodi di log per aggiungere i metadati
    ['log', 'debug', 'info', 'warn', 'error', 'critical'].forEach(method => {
      childLogger[method] = (message, childMetadata = {}) => {
        this[method](message, { ...metadata, ...childMetadata });
      };
    });
    
    return childLogger;
  }
  
  /**
   * Crea un middleware Express per il logging delle richieste
   * @returns {Function} Middleware Express
   */
  expressMiddleware() {
    return (req, res, next) => {
      // Inizializza il timer
      const start = Date.now();
      
      // Gestisci l'ID di correlazione
      if (this.config.correlation.enabled && this.correlator) {
        this.correlator.processRequest(req);
      }
      
      // Log della richiesta
      this.info(`Richiesta ${req.method} ${req.url}`, {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('user-agent')
      });
      
      // Intercetta la risposta
      const originalEnd = res.end;
      res.end = function(chunk, encoding) {
        // Ripristina il metodo originale
        res.end = originalEnd;
        
        // Calcola la durata
        const duration = Date.now() - start;
        
        // Log della risposta
        const logLevel = res.statusCode >= 400 ? 'error' : 'info';
        this.log(logLevel, `Risposta ${res.statusCode} ${req.method} ${req.url} (${duration}ms)`, {
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          duration,
          responseSize: res.get('content-length') || 0
        });
        
        // Chiama il metodo originale
        return originalEnd.call(res, chunk, encoding);
      }.bind(this);
      
      next();
    };
  }
  
  /**
   * Crea un middleware Koa per il logging delle richieste
   * @returns {Function} Middleware Koa
   */
  koaMiddleware() {
    return async (ctx, next) => {
      // Inizializza il timer
      const start = Date.now();
      
      // Gestisci l'ID di correlazione
      if (this.config.correlation.enabled && this.correlator) {
        this.correlator.processKoaRequest(ctx);
      }
      
      // Log della richiesta
      this.info(`Richiesta ${ctx.method} ${ctx.url}`, {
        method: ctx.method,
        url: ctx.url,
        ip: ctx.ip,
        userAgent: ctx.get('user-agent')
      });
      
      try {
        // Esegui il middleware successivo
        await next();
        
        // Calcola la durata
        const duration = Date.now() - start;
        
        // Log della risposta
        const logLevel = ctx.status >= 400 ? 'error' : 'info';
        this.log(logLevel, `Risposta ${ctx.status} ${ctx.method} ${ctx.url} (${duration}ms)`, {
          method: ctx.method,
          url: ctx.url,
          statusCode: ctx.status,
          duration,
          responseSize: ctx.response.length || 0
        });
      } catch (error) {
        // Calcola la durata
        const duration = Date.now() - start;
        
        // Log dell'errore
        this.error(`Errore ${ctx.method} ${ctx.url} (${duration}ms)`, {
          method: ctx.method,
          url: ctx.url,
          duration,
          error
        });
        
        // Rilancia l'errore
        throw error;
      }
    };
  }
  
  /**
   * Crea un middleware per il logging delle richieste GraphQL
   * @returns {Function} Middleware GraphQL
   */
  graphqlMiddleware() {
    return async (resolve, root, args, context, info) => {
      // Inizializza il timer
      const start = Date.now();
      
      // Log della richiesta
      this.debug(`Richiesta GraphQL ${info.fieldName}`, {
        operation: info.operation.operation,
        fieldName: info.fieldName,
        args: this.config.redaction.enabled ? this.redactor.redact(JSON.stringify(args)) : args
      });
      
      try {
        // Esegui il resolver
        const result = await resolve(root, args, context, info);
        
        // Calcola la durata
        const duration = Date.now() - start;
        
        // Log della risposta
        this.debug(`Risposta GraphQL ${info.fieldName} (${duration}ms)`, {
          operation: info.operation.operation,
          fieldName: info.fieldName,
          duration
        });
        
        return result;
      } catch (error) {
        // Calcola la durata
        const duration = Date.now() - start;
        
        // Log dell'errore
        this.error(`Errore GraphQL ${info.fieldName} (${duration}ms)`, {
          operation: info.operation.operation,
          fieldName: info.fieldName,
          duration,
          error
        });
        
        // Rilancia l'errore
        throw error;
      }
    };
  }
  
  /**
   * Chiude il logger e i suoi trasporti
   */
  close() {
    this.logger.info('Chiusura logger centralizzato');
    
    // Chiudi i trasporti
    this.logger.transports.forEach(transport => {
      if (typeof transport.close === 'function') {
        transport.close();
      }
    });
  }
}

module.exports = CentralizedLogger;
