/**
 * @fileoverview Implementazione di un sistema di correlazione delle richieste
 * 
 * Questo modulo implementa un sistema di correlazione delle richieste che permette
 * di tracciare le richieste attraverso diversi servizi e componenti, facilitando
 * il debugging e l'analisi delle performance.
 */

const { v4: uuidv4 } = require('uuid');
const cls = require('cls-hooked');
const { Logger } = require('../logger');

// Configurazione del logger
const logger = new Logger('request-correlator');

// Crea il namespace per il contesto delle richieste
const namespace = cls.createNamespace('request-context');

/**
 * Classe RequestCorrelator
 * 
 * Implementa un sistema di correlazione delle richieste con supporto per
 * ID di correlazione, propagazione del contesto e integrazione con Express.
 */
class RequestCorrelator {
  /**
   * Crea una nuova istanza di RequestCorrelator
   * @param {Object} config - Configurazione per il correlatore
   * @param {string} config.headerName - Nome dell'header per l'ID di correlazione (default: 'x-correlation-id')
   * @param {boolean} config.generateId - Se generare un ID se non presente (default: true)
   * @param {Array<string>} config.additionalHeaders - Header aggiuntivi da propagare
   * @param {Object} config.contextDefaults - Valori predefiniti per il contesto
   */
  constructor(config = {}) {
    this.headerName = config.headerName || 'x-correlation-id';
    this.generateId = config.generateId !== false;
    this.additionalHeaders = config.additionalHeaders || [
      'x-request-id',
      'x-session-id',
      'x-user-id',
      'x-tenant-id',
      'x-device-id'
    ];
    this.contextDefaults = config.contextDefaults || {};
    
    logger.info('RequestCorrelator inizializzato', {
      headerName: this.headerName,
      generateId: this.generateId,
      additionalHeadersCount: this.additionalHeaders.length
    });
  }
  
  /**
   * Crea un middleware Express per la correlazione delle richieste
   * @returns {Function} Middleware Express
   */
  createExpressMiddleware() {
    return (req, res, next) => {
      namespace.run(() => {
        // Ottieni l'ID di correlazione dall'header o generane uno nuovo
        const correlationId = req.headers[this.headerName.toLowerCase()] || 
          (this.generateId ? uuidv4() : null);
        
        if (correlationId) {
          // Imposta l'ID di correlazione nel contesto
          namespace.set('correlationId', correlationId);
          
          // Imposta l'header nella risposta
          res.setHeader(this.headerName, correlationId);
          
          // Registra l'ID di correlazione
          logger.debug(`ID di correlazione: ${correlationId}`);
        }
        
        // Propaga gli header aggiuntivi nel contesto
        for (const header of this.additionalHeaders) {
          const headerValue = req.headers[header.toLowerCase()];
          if (headerValue) {
            namespace.set(header, headerValue);
            
            // Imposta l'header nella risposta
            res.setHeader(header, headerValue);
          }
        }
        
        // Imposta i valori predefiniti nel contesto
        for (const [key, value] of Object.entries(this.contextDefaults)) {
          if (!namespace.get(key)) {
            namespace.set(key, value);
          }
        }
        
        // Aggiungi metodi di utilità all'oggetto request
        req.getCorrelationId = () => namespace.get('correlationId');
        req.getContextValue = (key) => namespace.get(key);
        req.setContextValue = (key, value) => namespace.set(key, value);
        
        // Aggiungi metodi di utilità all'oggetto response
        res.getCorrelationId = () => namespace.get('correlationId');
        res.getContextValue = (key) => namespace.get(key);
        res.setContextValue = (key, value) => namespace.set(key, value);
        
        next();
      });
    };
  }
  
  /**
   * Ottiene l'ID di correlazione dal contesto corrente
   * @returns {string|null} ID di correlazione o null se non disponibile
   */
  getCorrelationId() {
    try {
      return namespace.get('correlationId');
    } catch (error) {
      logger.error('Errore durante l\'ottenimento dell\'ID di correlazione', { error: error.message });
      return null;
    }
  }
  
  /**
   * Imposta l'ID di correlazione nel contesto corrente
   * @param {string} correlationId - ID di correlazione
   * @returns {boolean} True se l'operazione è riuscita
   */
  setCorrelationId(correlationId) {
    try {
      namespace.set('correlationId', correlationId);
      return true;
    } catch (error) {
      logger.error('Errore durante l\'impostazione dell\'ID di correlazione', { error: error.message });
      return false;
    }
  }
  
  /**
   * Ottiene un valore dal contesto corrente
   * @param {string} key - Chiave del valore
   * @returns {*} Valore o undefined se non disponibile
   */
  getContextValue(key) {
    try {
      return namespace.get(key);
    } catch (error) {
      logger.error(`Errore durante l'ottenimento del valore di contesto ${key}`, { error: error.message });
      return undefined;
    }
  }
  
  /**
   * Imposta un valore nel contesto corrente
   * @param {string} key - Chiave del valore
   * @param {*} value - Valore da impostare
   * @returns {boolean} True se l'operazione è riuscita
   */
  setContextValue(key, value) {
    try {
      namespace.set(key, value);
      return true;
    } catch (error) {
      logger.error(`Errore durante l'impostazione del valore di contesto ${key}`, { error: error.message });
      return false;
    }
  }
  
  /**
   * Esegue una funzione all'interno di un nuovo contesto
   * @param {Function} fn - Funzione da eseguire
   * @param {Object} [context] - Contesto iniziale
   * @returns {*} Risultato della funzione
   */
  runWithContext(fn, context = {}) {
    return namespace.run(() => {
      // Imposta i valori del contesto
      for (const [key, value] of Object.entries(context)) {
        namespace.set(key, value);
      }
      
      // Esegui la funzione
      return fn();
    });
  }
  
  /**
   * Esegue una funzione asincrona all'interno di un nuovo contesto
   * @param {Function} fn - Funzione asincrona da eseguire
   * @param {Object} [context] - Contesto iniziale
   * @returns {Promise<*>} Risultato della funzione
   */
  async runWithContextAsync(fn, context = {}) {
    return namespace.runPromise(() => {
      // Imposta i valori del contesto
      for (const [key, value] of Object.entries(context)) {
        namespace.set(key, value);
      }
      
      // Esegui la funzione
      return fn();
    });
  }
  
  /**
   * Crea un wrapper per una funzione che propaga il contesto
   * @param {Function} fn - Funzione da wrappare
   * @returns {Function} Funzione wrappata
   */
  bindContext(fn) {
    return namespace.bind(fn);
  }
  
  /**
   * Crea un oggetto di intestazioni HTTP con l'ID di correlazione e gli header aggiuntivi
   * @returns {Object} Intestazioni HTTP
   */
  createHeaders() {
    const headers = {};
    
    // Aggiungi l'ID di correlazione
    const correlationId = this.getCorrelationId();
    if (correlationId) {
      headers[this.headerName] = correlationId;
    }
    
    // Aggiungi gli header aggiuntivi
    for (const header of this.additionalHeaders) {
      const value = this.getContextValue(header);
      if (value) {
        headers[header] = value;
      }
    }
    
    return headers;
  }
  
  /**
   * Estrae l'ID di correlazione e gli header aggiuntivi da un oggetto di intestazioni HTTP
   * @param {Object} headers - Intestazioni HTTP
   * @returns {Object} Contesto estratto
   */
  extractContextFromHeaders(headers) {
    const context = {};
    
    // Estrai l'ID di correlazione
    const correlationId = headers[this.headerName.toLowerCase()];
    if (correlationId) {
      context.correlationId = correlationId;
    }
    
    // Estrai gli header aggiuntivi
    for (const header of this.additionalHeaders) {
      const value = headers[header.toLowerCase()];
      if (value) {
        context[header] = value;
      }
    }
    
    return context;
  }
  
  /**
   * Genera un nuovo ID di correlazione
   * @returns {string} ID di correlazione
   */
  generateCorrelationId() {
    return uuidv4();
  }
  
  /**
   * Ottiene il namespace CLS
   * @returns {Object} Namespace CLS
   */
  getNamespace() {
    return namespace;
  }
  
  /**
   * Ottiene la configurazione del correlatore
   * @returns {Object} Configurazione
   */
  getConfig() {
    return {
      headerName: this.headerName,
      generateId: this.generateId,
      additionalHeaders: this.additionalHeaders,
      contextDefaults: this.contextDefaults
    };
  }
}

// Crea un'istanza predefinita del correlatore
const defaultCorrelator = new RequestCorrelator();

module.exports = {
  RequestCorrelator,
  defaultCorrelator,
  namespace
};
