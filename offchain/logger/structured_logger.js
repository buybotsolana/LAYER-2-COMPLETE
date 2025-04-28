/**
 * @fileoverview Sistema di logging strutturato con Winston
 * 
 * Questo modulo implementa un sistema di logging strutturato utilizzando
 * la libreria Winston, con supporto per formati JSON, rotazione dei log,
 * livelli di logging configurabili e integrazione con servizi esterni.
 */

const winston = require('winston');
const { format, createLogger, transports } = winston;
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const cls = require('cls-hooked');

// Crea il namespace per il contesto delle richieste
const namespace = cls.createNamespace('request-context');

// Configurazione predefinita
const DEFAULT_CONFIG = {
  level: process.env.LOG_LEVEL || 'info',
  serviceName: process.env.SERVICE_NAME || 'layer2-service',
  logDir: process.env.LOG_DIR || 'logs',
  console: {
    enabled: process.env.LOG_CONSOLE !== 'false',
    level: process.env.LOG_CONSOLE_LEVEL || 'info'
  },
  file: {
    enabled: process.env.LOG_FILE !== 'false',
    level: process.env.LOG_FILE_LEVEL || 'info',
    maxSize: process.env.LOG_FILE_MAX_SIZE || '10m',
    maxFiles: process.env.LOG_FILE_MAX_FILES || 5
  },
  json: process.env.LOG_JSON !== 'false'
};

/**
 * Classe StructuredLogger
 * 
 * Implementa un sistema di logging strutturato con Winston, con supporto
 * per formati JSON, rotazione dei log, livelli di logging configurabili
 * e integrazione con servizi esterni.
 */
class StructuredLogger {
  /**
   * Crea una nuova istanza di StructuredLogger
   * @param {Object} config - Configurazione per il logger
   * @param {string} config.level - Livello di logging predefinito
   * @param {string} config.serviceName - Nome del servizio
   * @param {string} config.logDir - Directory per i file di log
   * @param {Object} config.console - Configurazione per il logging su console
   * @param {boolean} config.console.enabled - Se abilitare il logging su console
   * @param {string} config.console.level - Livello di logging per la console
   * @param {Object} config.file - Configurazione per il logging su file
   * @param {boolean} config.file.enabled - Se abilitare il logging su file
   * @param {string} config.file.level - Livello di logging per i file
   * @param {string} config.file.maxSize - Dimensione massima dei file di log
   * @param {number} config.file.maxFiles - Numero massimo di file di log
   * @param {boolean} config.json - Se utilizzare il formato JSON
   */
  constructor(config = {}) {
    // Unisci la configurazione predefinita con quella fornita
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Crea la directory dei log se non esiste
    if (this.config.file.enabled) {
      const logDir = path.resolve(this.config.logDir);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
    }
    
    // Crea il logger
    this.logger = this._createLogger();
    
    // Genera un ID univoco per questa istanza del logger
    this.instanceId = uuidv4();
    
    // Informazioni sull'host
    this.hostInfo = {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      type: os.type()
    };
    
    // Registra l'avvio del logger
    this.info('Logger inizializzato', {
      config: this._sanitizeConfig(this.config),
      instanceId: this.instanceId,
      hostInfo: this.hostInfo
    });
  }
  
  /**
   * Crea il logger Winston
   * @returns {winston.Logger} Logger Winston
   * @private
   */
  _createLogger() {
    // Definisci i formati
    const logFormat = this.config.json ? 
      this._createJsonFormat() : 
      this._createTextFormat();
    
    // Definisci i trasporti
    const logTransports = [];
    
    // Aggiungi il trasporto console se abilitato
    if (this.config.console.enabled) {
      logTransports.push(new transports.Console({
        level: this.config.console.level,
        format: logFormat
      }));
    }
    
    // Aggiungi il trasporto file se abilitato
    if (this.config.file.enabled) {
      // File di log combinato
      logTransports.push(new transports.File({
        filename: path.join(this.config.logDir, 'combined.log'),
        level: this.config.file.level,
        format: logFormat,
        maxsize: this._parseSize(this.config.file.maxSize),
        maxFiles: this.config.file.maxFiles,
        tailable: true
      }));
      
      // File di log degli errori
      logTransports.push(new transports.File({
        filename: path.join(this.config.logDir, 'error.log'),
        level: 'error',
        format: logFormat,
        maxsize: this._parseSize(this.config.file.maxSize),
        maxFiles: this.config.file.maxFiles,
        tailable: true
      }));
    }
    
    // Crea il logger
    return createLogger({
      level: this.config.level,
      defaultMeta: {
        service: this.config.serviceName
      },
      transports: logTransports,
      exitOnError: false
    });
  }
  
  /**
   * Crea il formato JSON per il logger
   * @returns {winston.Format} Formato Winston
   * @private
   */
  _createJsonFormat() {
    return format.combine(
      format.timestamp(),
      format.errors({ stack: true }),
      format((info) => {
        // Aggiungi il request ID se disponibile
        const requestId = this._getRequestId();
        if (requestId) {
          info.requestId = requestId;
        }
        
        // Aggiungi l'ID dell'istanza
        info.instanceId = this.instanceId;
        
        return info;
      })(),
      format.json()
    );
  }
  
  /**
   * Crea il formato testo per il logger
   * @returns {winston.Format} Formato Winston
   * @private
   */
  _createTextFormat() {
    return format.combine(
      format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      format.errors({ stack: true }),
      format((info) => {
        // Aggiungi il request ID se disponibile
        const requestId = this._getRequestId();
        if (requestId) {
          info.requestId = requestId;
        }
        
        // Aggiungi l'ID dell'istanza
        info.instanceId = this.instanceId;
        
        return info;
      })(),
      format.printf((info) => {
        const { timestamp, level, message, requestId, instanceId, ...rest } = info;
        
        // Formatta il messaggio base
        let log = `${timestamp} [${level.toUpperCase()}] [${instanceId}]`;
        
        // Aggiungi il request ID se disponibile
        if (requestId) {
          log += ` [${requestId}]`;
        }
        
        // Aggiungi il messaggio
        log += `: ${message}`;
        
        // Aggiungi i metadati aggiuntivi
        if (Object.keys(rest).length > 0) {
          // Rimuovi il service dai metadati (già incluso nel formato)
          const { service, ...metadata } = rest;
          
          // Aggiungi i metadati
          log += ` ${JSON.stringify(metadata)}`;
        }
        
        return log;
      })
    );
  }
  
  /**
   * Ottiene l'ID della richiesta dal contesto
   * @returns {string|null} ID della richiesta o null se non disponibile
   * @private
   */
  _getRequestId() {
    try {
      return namespace.get('requestId');
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Converte una stringa di dimensione in byte
   * @param {string} size - Dimensione (es. '10m', '1g')
   * @returns {number} Dimensione in byte
   * @private
   */
  _parseSize(size) {
    const units = {
      b: 1,
      k: 1024,
      m: 1024 * 1024,
      g: 1024 * 1024 * 1024
    };
    
    const match = size.toString().match(/^(\d+)([bkmg])?$/i);
    if (!match) {
      return parseInt(size, 10);
    }
    
    const value = parseInt(match[1], 10);
    const unit = match[2]?.toLowerCase() || 'b';
    
    return value * units[unit];
  }
  
  /**
   * Rimuove informazioni sensibili dalla configurazione
   * @param {Object} config - Configurazione
   * @returns {Object} Configurazione senza informazioni sensibili
   * @private
   */
  _sanitizeConfig(config) {
    // Crea una copia della configurazione
    const sanitized = JSON.parse(JSON.stringify(config));
    
    // Rimuovi eventuali informazioni sensibili
    if (sanitized.credentials) {
      sanitized.credentials = '[REDACTED]';
    }
    
    if (sanitized.apiKey) {
      sanitized.apiKey = '[REDACTED]';
    }
    
    if (sanitized.secret) {
      sanitized.secret = '[REDACTED]';
    }
    
    return sanitized;
  }
  
  /**
   * Registra un messaggio di log a livello 'error'
   * @param {string} message - Messaggio di log
   * @param {Object} [meta] - Metadati aggiuntivi
   */
  error(message, meta = {}) {
    this.logger.error(message, meta);
  }
  
  /**
   * Registra un messaggio di log a livello 'warn'
   * @param {string} message - Messaggio di log
   * @param {Object} [meta] - Metadati aggiuntivi
   */
  warn(message, meta = {}) {
    this.logger.warn(message, meta);
  }
  
  /**
   * Registra un messaggio di log a livello 'info'
   * @param {string} message - Messaggio di log
   * @param {Object} [meta] - Metadati aggiuntivi
   */
  info(message, meta = {}) {
    this.logger.info(message, meta);
  }
  
  /**
   * Registra un messaggio di log a livello 'debug'
   * @param {string} message - Messaggio di log
   * @param {Object} [meta] - Metadati aggiuntivi
   */
  debug(message, meta = {}) {
    this.logger.debug(message, meta);
  }
  
  /**
   * Registra un messaggio di log a livello 'verbose'
   * @param {string} message - Messaggio di log
   * @param {Object} [meta] - Metadati aggiuntivi
   */
  verbose(message, meta = {}) {
    this.logger.verbose(message, meta);
  }
  
  /**
   * Registra un messaggio di log a livello 'silly'
   * @param {string} message - Messaggio di log
   * @param {Object} [meta] - Metadati aggiuntivi
   */
  silly(message, meta = {}) {
    this.logger.silly(message, meta);
  }
  
  /**
   * Registra un messaggio di log a un livello specifico
   * @param {string} level - Livello di log
   * @param {string} message - Messaggio di log
   * @param {Object} [meta] - Metadati aggiuntivi
   */
  log(level, message, meta = {}) {
    this.logger.log(level, message, meta);
  }
  
  /**
   * Registra un'eccezione
   * @param {Error} error - Eccezione da registrare
   * @param {Object} [meta] - Metadati aggiuntivi
   */
  exception(error, meta = {}) {
    this.logger.error(error.message, {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      ...meta
    });
  }
  
  /**
   * Crea un middleware Express per la correlazione delle richieste
   * @param {Object} [options] - Opzioni per il middleware
   * @param {string} [options.headerName] - Nome dell'header per l'ID della richiesta
   * @param {boolean} [options.generateId] - Se generare un ID se non presente
   * @returns {Function} Middleware Express
   */
  createRequestIdMiddleware(options = {}) {
    const headerName = options.headerName || 'x-request-id';
    const generateId = options.generateId !== false;
    
    return (req, res, next) => {
      namespace.run(() => {
        // Ottieni l'ID della richiesta dall'header o generane uno nuovo
        const requestId = req.headers[headerName.toLowerCase()] || 
          (generateId ? uuidv4() : null);
        
        if (requestId) {
          // Imposta l'ID della richiesta nel contesto
          namespace.set('requestId', requestId);
          
          // Imposta l'header nella risposta
          res.setHeader(headerName, requestId);
          
          // Registra l'inizio della richiesta
          this.info(`Richiesta ricevuta: ${req.method} ${req.url}`, {
            request: {
              method: req.method,
              url: req.url,
              headers: this._sanitizeHeaders(req.headers),
              ip: req.ip || req.connection.remoteAddress
            }
          });
          
          // Registra la fine della richiesta
          res.on('finish', () => {
            this.info(`Richiesta completata: ${req.method} ${req.url}`, {
              response: {
                statusCode: res.statusCode,
                statusMessage: res.statusMessage,
                headers: this._sanitizeHeaders(res.getHeaders())
              }
            });
          });
        }
        
        next();
      });
    };
  }
  
  /**
   * Rimuove informazioni sensibili dagli header
   * @param {Object} headers - Header HTTP
   * @returns {Object} Header senza informazioni sensibili
   * @private
   */
  _sanitizeHeaders(headers) {
    const sensitiveHeaders = [
      'authorization',
      'cookie',
      'set-cookie',
      'x-api-key',
      'x-auth-token'
    ];
    
    const sanitized = { ...headers };
    
    for (const header of sensitiveHeaders) {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }
  
  /**
   * Crea un child logger con metadati aggiuntivi
   * @param {Object} meta - Metadati aggiuntivi
   * @returns {StructuredLogger} Child logger
   */
  child(meta) {
    const childLogger = new StructuredLogger(this.config);
    childLogger.logger = this.logger.child(meta);
    return childLogger;
  }
  
  /**
   * Imposta il livello di logging
   * @param {string} level - Livello di logging
   */
  setLevel(level) {
    this.logger.level = level;
    this.info(`Livello di logging impostato a: ${level}`);
  }
  
  /**
   * Ottiene il livello di logging corrente
   * @returns {string} Livello di logging
   */
  getLevel() {
    return this.logger.level;
  }
  
  /**
   * Ottiene l'ID dell'istanza del logger
   * @returns {string} ID dell'istanza
   */
  getInstanceId() {
    return this.instanceId;
  }
  
  /**
   * Ottiene le informazioni sull'host
   * @returns {Object} Informazioni sull'host
   */
  getHostInfo() {
    return this.hostInfo;
  }
  
  /**
   * Ottiene la configurazione del logger
   * @returns {Object} Configurazione
   */
  getConfig() {
    return this._sanitizeConfig(this.config);
  }
}

// Esporta l'istanza predefinita del logger
const defaultLogger = new StructuredLogger();

module.exports = {
  StructuredLogger,
  defaultLogger,
  namespace
};
