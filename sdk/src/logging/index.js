const { defaultLogger } = require('./logger');
const { TransactionLogger } = require('./transaction-logger');
const { requestLoggerMiddleware, errorLoggerMiddleware } = require('./middleware');

/**
 * Configurazione per l'integrazione con ELK Stack
 * 
 * @param {Object} options - Opzioni di configurazione
 * @param {string} options.elasticsearchUrl - URL del server Elasticsearch
 * @param {string} options.indexPrefix - Prefisso per gli indici (default: 'layer2-solana')
 * @param {Object} options.auth - Credenziali di autenticazione (opzionale)
 * @returns {Object} Configurazione per l'integrazione con ELK
 */
function createElkConfig(options) {
  return {
    elasticsearchUrl: options.elasticsearchUrl,
    indexPrefix: options.indexPrefix || 'layer2-solana',
    auth: options.auth || null,
    level: options.level || 'info',
    bufferSize: options.bufferSize || 100,
    flushInterval: options.flushInterval || 5000, // 5 secondi
    pipeline: options.pipeline || null
  };
}

/**
 * Inizializza il sistema di logging
 * 
 * @param {Object} options - Opzioni di configurazione
 * @returns {Object} Oggetto contenente i logger configurati
 */
function initializeLogging(options = {}) {
  const { Logger } = require('./logger');
  
  // Crea il logger principale
  const mainLogger = new Logger({
    level: options.level || 'info',
    service: options.service || 'layer2-solana',
    console: options.console !== undefined ? options.console : true,
    file: options.file !== undefined ? options.file : false,
    filename: options.filename || 'layer2-solana.log',
    json: options.json !== undefined ? options.json : false,
    elkConfig: options.elkConfig || null
  });
  
  // Crea il logger per le transazioni
  const txLogger = new TransactionLogger({
    logger: mainLogger.child('transactions')
  });
  
  // Crea middleware per Express
  const requestLogger = (middlewareOptions = {}) => 
    requestLoggerMiddleware({ 
      logger: mainLogger.child('http'),
      ...middlewareOptions
    });
  
  const errorLogger = (middlewareOptions = {}) => 
    errorLoggerMiddleware({ 
      logger: mainLogger.child('errors'),
      ...middlewareOptions
    });
  
  return {
    logger: mainLogger,
    transactionLogger: txLogger,
    requestLogger,
    errorLogger
  };
}

module.exports = {
  initializeLogging,
  createElkConfig,
  defaultLogger,
  TransactionLogger,
  requestLoggerMiddleware,
  errorLoggerMiddleware
};
