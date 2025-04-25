const { defaultLogger } = require('./logger');

/**
 * Middleware per Express che registra le richieste HTTP
 * 
 * @param {Object} options - Opzioni di configurazione
 * @param {Object} options.logger - Istanza del logger (opzionale)
 * @param {boolean} options.logBody - Se registrare il corpo delle richieste (default: false)
 * @param {boolean} options.logHeaders - Se registrare gli header delle richieste (default: false)
 * @param {Array<string>} options.excludePaths - Percorsi da escludere dal logging
 * @returns {Function} Middleware Express
 */
function requestLoggerMiddleware(options = {}) {
  const logger = options.logger || defaultLogger;
  const logBody = options.logBody || false;
  const logHeaders = options.logHeaders || false;
  const excludePaths = options.excludePaths || [];
  
  return (req, res, next) => {
    // Salta il logging per i percorsi esclusi
    if (excludePaths.some(path => req.path.startsWith(path))) {
      return next();
    }
    
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Aggiungi requestId alla richiesta per tracciamento
    req.requestId = requestId;
    
    // Prepara i metadati della richiesta
    const requestMetadata = {
      requestId,
      method: req.method,
      url: req.originalUrl || req.url,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent']
    };
    
    // Aggiungi headers se richiesto
    if (logHeaders) {
      requestMetadata.headers = { ...req.headers };
      
      // Rimuovi informazioni sensibili
      if (requestMetadata.headers.authorization) {
        requestMetadata.headers.authorization = '[REDACTED]';
      }
      if (requestMetadata.headers.cookie) {
        requestMetadata.headers.cookie = '[REDACTED]';
      }
    }
    
    // Aggiungi body se richiesto
    if (logBody && req.body) {
      const safeBody = { ...req.body };
      
      // Rimuovi campi sensibili
      ['password', 'token', 'secret', 'key', 'apiKey'].forEach(field => {
        if (safeBody[field]) {
          safeBody[field] = '[REDACTED]';
        }
      });
      
      requestMetadata.body = safeBody;
    }
    
    // Log della richiesta
    logger.info(`HTTP Request: ${req.method} ${req.originalUrl || req.url}`, requestMetadata);
    
    // Intercetta la risposta per loggare anche quella
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
      res.end = originalEnd;
      res.end(chunk, encoding);
      
      const duration = Date.now() - startTime;
      
      // Prepara i metadati della risposta
      const responseMetadata = {
        requestId,
        method: req.method,
        url: req.originalUrl || req.url,
        statusCode: res.statusCode,
        duration
      };
      
      // Determina il livello di log in base allo status code
      if (res.statusCode >= 500) {
        logger.error(`HTTP Response: ${res.statusCode} ${req.method} ${req.originalUrl || req.url} - ${duration}ms`, responseMetadata);
      } else if (res.statusCode >= 400) {
        logger.warn(`HTTP Response: ${res.statusCode} ${req.method} ${req.originalUrl || req.url} - ${duration}ms`, responseMetadata);
      } else {
        logger.info(`HTTP Response: ${res.statusCode} ${req.method} ${req.originalUrl || req.url} - ${duration}ms`, responseMetadata);
      }
    };
    
    next();
  };
}

/**
 * Middleware per gestire gli errori e registrarli
 * 
 * @param {Object} options - Opzioni di configurazione
 * @param {Object} options.logger - Istanza del logger (opzionale)
 * @returns {Function} Middleware Express per la gestione degli errori
 */
function errorLoggerMiddleware(options = {}) {
  const logger = options.logger || defaultLogger;
  
  return (err, req, res, next) => {
    const requestId = req.requestId || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Prepara i metadati dell'errore
    const errorMetadata = {
      requestId,
      method: req.method,
      url: req.originalUrl || req.url,
      ip: req.ip || req.connection.remoteAddress,
      statusCode: err.status || 500,
      errorName: err.name,
      errorStack: err.stack
    };
    
    // Registra l'errore
    logger.error(`Error in request: ${err.message}`, errorMetadata);
    
    // Passa al prossimo middleware di gestione errori
    next(err);
  };
}

module.exports = {
  requestLoggerMiddleware,
  errorLoggerMiddleware
};
