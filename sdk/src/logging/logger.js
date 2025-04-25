const winston = require('winston');
const { format, transports } = winston;
const { combine, timestamp, label, printf, json, colorize, align } = format;

/**
 * Configurazione del logger per il Layer-2 Solana
 * 
 * Questo modulo fornisce un logger configurabile che può essere utilizzato
 * in tutta l'applicazione per registrare eventi, errori e informazioni di debug.
 * 
 * Supporta diversi livelli di log (error, warn, info, debug) e può essere
 * configurato per scrivere su console, file o servizi esterni come ELK.
 */
class Logger {
  /**
   * Crea una nuova istanza del logger
   * @param {Object} options - Opzioni di configurazione
   * @param {string} options.level - Livello di log (error, warn, info, debug)
   * @param {string} options.service - Nome del servizio o componente
   * @param {boolean} options.console - Se abilitare il log su console
   * @param {boolean} options.file - Se abilitare il log su file
   * @param {string} options.filename - Nome del file di log
   * @param {boolean} options.json - Se formattare i log come JSON
   * @param {Object} options.elkConfig - Configurazione per ELK (opzionale)
   */
  constructor(options = {}) {
    this.options = {
      level: options.level || 'info',
      service: options.service || 'layer2-solana',
      console: options.console !== undefined ? options.console : true,
      file: options.file !== undefined ? options.file : false,
      filename: options.filename || 'layer2-solana.log',
      json: options.json !== undefined ? options.json : false,
      elkConfig: options.elkConfig || null
    };

    this.createLogger();
  }

  /**
   * Crea e configura l'istanza del logger Winston
   * @private
   */
  createLogger() {
    // Formato personalizzato per i log
    const customFormat = printf(({ level, message, label, timestamp, ...metadata }) => {
      let msg = `${timestamp} [${label}] ${level}: ${message}`;
      
      if (Object.keys(metadata).length > 0) {
        msg += ` ${JSON.stringify(metadata)}`;
      }
      
      return msg;
    });

    // Configurazione dei formati
    const logFormat = this.options.json 
      ? combine(
          label({ label: this.options.service }),
          timestamp(),
          json()
        )
      : combine(
          colorize(),
          label({ label: this.options.service }),
          timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          align(),
          customFormat
        );

    // Configurazione dei trasporti
    const logTransports = [];
    
    if (this.options.console) {
      logTransports.push(new transports.Console());
    }
    
    if (this.options.file) {
      logTransports.push(
        new transports.File({ 
          filename: this.options.filename,
          maxsize: 5242880, // 5MB
          maxFiles: 5,
          tailable: true
        })
      );
    }
    
    // Aggiunta del trasporto ELK se configurato
    if (this.options.elkConfig) {
      // Qui si potrebbe aggiungere un trasporto personalizzato per ELK
      // come winston-elasticsearch
      // Esempio:
      // const { ElasticsearchTransport } = require('winston-elasticsearch');
      // logTransports.push(new ElasticsearchTransport(this.options.elkConfig));
    }

    // Creazione del logger
    this.logger = winston.createLogger({
      level: this.options.level,
      format: logFormat,
      transports: logTransports,
      exitOnError: false
    });
  }

  /**
   * Registra un messaggio di errore
   * @param {string} message - Messaggio di errore
   * @param {Object} metadata - Metadati aggiuntivi
   */
  error(message, metadata = {}) {
    this.logger.error(message, metadata);
  }

  /**
   * Registra un avviso
   * @param {string} message - Messaggio di avviso
   * @param {Object} metadata - Metadati aggiuntivi
   */
  warn(message, metadata = {}) {
    this.logger.warn(message, metadata);
  }

  /**
   * Registra un'informazione
   * @param {string} message - Messaggio informativo
   * @param {Object} metadata - Metadati aggiuntivi
   */
  info(message, metadata = {}) {
    this.logger.info(message, metadata);
  }

  /**
   * Registra un messaggio di debug
   * @param {string} message - Messaggio di debug
   * @param {Object} metadata - Metadati aggiuntivi
   */
  debug(message, metadata = {}) {
    this.logger.debug(message, metadata);
  }

  /**
   * Registra l'inizio di un'operazione
   * @param {string} operation - Nome dell'operazione
   * @param {Object} metadata - Metadati aggiuntivi
   * @returns {Function} Funzione per registrare la fine dell'operazione
   */
  startOperation(operation, metadata = {}) {
    const startTime = Date.now();
    this.info(`Starting operation: ${operation}`, { ...metadata, status: 'started' });
    
    return (result = {}, error = null) => {
      const duration = Date.now() - startTime;
      
      if (error) {
        this.error(`Operation failed: ${operation}`, { 
          ...metadata, 
          status: 'failed', 
          duration, 
          error: error.message || error 
        });
      } else {
        this.info(`Completed operation: ${operation}`, { 
          ...metadata, 
          status: 'completed', 
          duration, 
          ...result 
        });
      }
      
      return { duration, ...result };
    };
  }

  /**
   * Crea un logger per un componente specifico
   * @param {string} component - Nome del componente
   * @returns {Logger} Nuova istanza del logger
   */
  child(component) {
    return new Logger({
      ...this.options,
      service: `${this.options.service}:${component}`
    });
  }
}

// Esporta un'istanza predefinita del logger
const defaultLogger = new Logger();

module.exports = {
  Logger,
  defaultLogger,
  // Esporta anche l'istanza winston per usi avanzati
  winston
};
