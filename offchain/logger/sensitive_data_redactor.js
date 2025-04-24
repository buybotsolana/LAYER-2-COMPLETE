/**
 * @fileoverview Implementazione di un sistema di redazione automatica di informazioni sensibili
 * 
 * Questo modulo implementa un sistema di redazione automatica di informazioni sensibili
 * che permette di nascondere dati sensibili nei log e nelle risposte API.
 */

const { Logger } = require('../logger');

// Configurazione del logger
const logger = new Logger('sensitive-data-redactor');

/**
 * Classe SensitiveDataRedactor
 * 
 * Implementa un sistema di redazione automatica di informazioni sensibili
 * con supporto per pattern personalizzati e redazione profonda di oggetti.
 */
class SensitiveDataRedactor {
  /**
   * Crea una nuova istanza di SensitiveDataRedactor
   * @param {Object} config - Configurazione per il redattore
   * @param {Array<string|RegExp>} config.paths - Percorsi da redarre (es. 'password', '*.secret')
   * @param {string} config.replacement - Testo di sostituzione (default: '[REDACTED]')
   * @param {boolean} config.redactArrays - Se redarre gli array (default: true)
   * @param {number} config.maxDepth - Profondità massima di redazione (default: 10)
   */
  constructor(config = {}) {
    this.paths = config.paths || [
      'password', 'secret', 'key', 'token', 'credential', 'auth',
      '*.password', '*.secret', '*.key', '*.token', '*.credential', '*.auth',
      'creditCard', 'ssn', 'socialSecurity', 'dob', 'dateOfBirth',
      '*.creditCard', '*.ssn', '*.socialSecurity', '*.dob', '*.dateOfBirth'
    ];
    this.replacement = config.replacement || '[REDACTED]';
    this.redactArrays = config.redactArrays !== false;
    this.maxDepth = config.maxDepth || 10;
    
    // Compila i pattern
    this.compiledPatterns = this._compilePatterns(this.paths);
    
    logger.info('SensitiveDataRedactor inizializzato', {
      pathsCount: this.paths.length,
      redactArrays: this.redactArrays,
      maxDepth: this.maxDepth
    });
  }
  
  /**
   * Compila i pattern di redazione
   * @param {Array<string|RegExp>} paths - Percorsi da redarre
   * @returns {Array<Object>} Pattern compilati
   * @private
   */
  _compilePatterns(paths) {
    return paths.map(path => {
      if (path instanceof RegExp) {
        return { type: 'regex', pattern: path };
      }
      
      if (typeof path === 'string') {
        if (path.includes('*')) {
          // Converte il pattern con wildcard in regex
          const regexPattern = path
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*');
          return { type: 'wildcard', pattern: new RegExp(`^${regexPattern}$`) };
        }
        
        return { type: 'exact', pattern: path };
      }
      
      logger.warn(`Pattern di redazione non valido ignorato: ${path}`);
      return null;
    }).filter(Boolean);
  }
  
  /**
   * Redige un oggetto
   * @param {Object} obj - Oggetto da redarre
   * @returns {Object} Oggetto redatto
   */
  redact(obj) {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }
    
    return this._redactObject(obj, [], 0);
  }
  
  /**
   * Redige un oggetto ricorsivamente
   * @param {Object} obj - Oggetto da redarre
   * @param {Array<string>} path - Percorso corrente
   * @param {number} depth - Profondità corrente
   * @returns {Object} Oggetto redatto
   * @private
   */
  _redactObject(obj, path, depth) {
    // Controlla la profondità massima
    if (depth > this.maxDepth) {
      logger.debug(`Profondità massima raggiunta (${this.maxDepth}), interruzione della redazione`);
      return obj;
    }
    
    // Se non è un oggetto o è null, restituisci l'oggetto originale
    if (!obj || typeof obj !== 'object') {
      return obj;
    }
    
    // Se è un array e la redazione degli array è abilitata
    if (Array.isArray(obj) && this.redactArrays) {
      return obj.map((item, index) => {
        const newPath = [...path, index.toString()];
        return this._redactObject(item, newPath, depth + 1);
      });
    }
    
    // Se è un oggetto Date, Buffer o altro tipo non redabile
    if (obj instanceof Date || obj instanceof Buffer || obj instanceof RegExp) {
      return obj;
    }
    
    // Crea una copia dell'oggetto
    const result = Array.isArray(obj) ? [...obj] : { ...obj };
    
    // Redige le proprietà
    for (const [key, value] of Object.entries(obj)) {
      const newPath = [...path, key];
      const pathString = newPath.join('.');
      
      // Controlla se il percorso corrente deve essere redatto
      if (this._shouldRedact(key, pathString)) {
        result[key] = this.replacement;
      } else if (typeof value === 'object' && value !== null) {
        // Redigi ricorsivamente
        result[key] = this._redactObject(value, newPath, depth + 1);
      }
    }
    
    return result;
  }
  
  /**
   * Verifica se un percorso deve essere redatto
   * @param {string} key - Chiave corrente
   * @param {string} path - Percorso completo
   * @returns {boolean} True se il percorso deve essere redatto
   * @private
   */
  _shouldRedact(key, path) {
    for (const pattern of this.compiledPatterns) {
      switch (pattern.type) {
        case 'exact':
          if (key === pattern.pattern) {
            return true;
          }
          break;
          
        case 'wildcard':
        case 'regex':
          if (pattern.pattern.test(path)) {
            return true;
          }
          break;
      }
    }
    
    return false;
  }
  
  /**
   * Redige una stringa di testo
   * @param {string} text - Testo da redarre
   * @returns {string} Testo redatto
   */
  redactText(text) {
    if (typeof text !== 'string') {
      return text;
    }
    
    let redactedText = text;
    
    // Redigi numeri di carte di credito
    redactedText = redactedText.replace(
      /\b(?:\d{4}[ -]?){3}\d{4}\b/g,
      this.replacement
    );
    
    // Redigi numeri di previdenza sociale (SSN)
    redactedText = redactedText.replace(
      /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g,
      this.replacement
    );
    
    // Redigi indirizzi email
    redactedText = redactedText.replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      this.replacement
    );
    
    // Redigi token JWT
    redactedText = redactedText.replace(
      /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
      this.replacement
    );
    
    // Redigi chiavi API (pattern generico)
    redactedText = redactedText.replace(
      /\b[A-Za-z0-9]{32,}\b/g,
      this.replacement
    );
    
    return redactedText;
  }
  
  /**
   * Redige gli header HTTP
   * @param {Object} headers - Header HTTP
   * @returns {Object} Header redatti
   */
  redactHeaders(headers) {
    if (!headers || typeof headers !== 'object') {
      return headers;
    }
    
    const sensitiveHeaders = [
      'authorization',
      'cookie',
      'set-cookie',
      'x-api-key',
      'x-auth-token',
      'api-key',
      'auth-token',
      'x-access-token',
      'access-token'
    ];
    
    const redactedHeaders = { ...headers };
    
    for (const header of Object.keys(redactedHeaders)) {
      if (sensitiveHeaders.includes(header.toLowerCase())) {
        redactedHeaders[header] = this.replacement;
      }
    }
    
    return redactedHeaders;
  }
  
  /**
   * Redige i parametri di una query
   * @param {Object} query - Parametri della query
   * @returns {Object} Parametri redatti
   */
  redactQuery(query) {
    if (!query || typeof query !== 'object') {
      return query;
    }
    
    const sensitiveParams = [
      'password',
      'token',
      'key',
      'secret',
      'auth',
      'credential',
      'apiKey',
      'api_key',
      'accessToken',
      'access_token'
    ];
    
    const redactedQuery = { ...query };
    
    for (const param of Object.keys(redactedQuery)) {
      if (sensitiveParams.includes(param.toLowerCase()) ||
          sensitiveParams.some(p => param.toLowerCase().includes(p))) {
        redactedQuery[param] = this.replacement;
      }
    }
    
    return redactedQuery;
  }
  
  /**
   * Crea un middleware Express per la redazione automatica
   * @returns {Function} Middleware Express
   */
  createExpressMiddleware() {
    return (req, res, next) => {
      // Redigi gli header della richiesta
      req.redactedHeaders = this.redactHeaders(req.headers);
      
      // Redigi i parametri della query
      req.redactedQuery = this.redactQuery(req.query);
      
      // Redigi il corpo della richiesta
      if (req.body && typeof req.body === 'object') {
        req.redactedBody = this.redact(req.body);
      }
      
      // Intercetta la risposta per redarre i dati sensibili
      const originalSend = res.send;
      res.send = function(body) {
        let redactedBody = body;
        
        // Redigi il corpo della risposta se è un oggetto JSON
        if (typeof body === 'object' && body !== null) {
          redactedBody = JSON.stringify(this.redact(body));
        } else if (typeof body === 'string') {
          try {
            // Prova a parsare come JSON
            const parsedBody = JSON.parse(body);
            redactedBody = JSON.stringify(this.redact(parsedBody));
          } catch (e) {
            // Non è JSON, redigi come testo
            redactedBody = this.redactText(body);
          }
        }
        
        return originalSend.call(this, redactedBody);
      }.bind(this);
      
      next();
    };
  }
  
  /**
   * Aggiunge un pattern di redazione
   * @param {string|RegExp} pattern - Pattern da aggiungere
   */
  addPattern(pattern) {
    if (!pattern) {
      return;
    }
    
    const compiled = this._compilePatterns([pattern]);
    if (compiled.length > 0) {
      this.compiledPatterns.push(compiled[0]);
      this.paths.push(pattern);
      
      logger.debug(`Pattern di redazione aggiunto: ${pattern}`);
    }
  }
  
  /**
   * Rimuove un pattern di redazione
   * @param {string|RegExp} pattern - Pattern da rimuovere
   */
  removePattern(pattern) {
    if (!pattern) {
      return;
    }
    
    const index = this.paths.findIndex(p => 
      p instanceof RegExp ? 
        p.toString() === pattern.toString() : 
        p === pattern
    );
    
    if (index !== -1) {
      this.paths.splice(index, 1);
      this.compiledPatterns = this._compilePatterns(this.paths);
      
      logger.debug(`Pattern di redazione rimosso: ${pattern}`);
    }
  }
  
  /**
   * Imposta il testo di sostituzione
   * @param {string} replacement - Testo di sostituzione
   */
  setReplacement(replacement) {
    this.replacement = replacement;
    logger.debug(`Testo di sostituzione impostato: ${replacement}`);
  }
  
  /**
   * Ottiene la configurazione del redattore
   * @returns {Object} Configurazione
   */
  getConfig() {
    return {
      paths: this.paths,
      replacement: this.replacement,
      redactArrays: this.redactArrays,
      maxDepth: this.maxDepth
    };
  }
}

// Crea un'istanza predefinita del redattore
const defaultRedactor = new SensitiveDataRedactor();

// Funzione di utilità per redarre oggetti
function redact(obj) {
  return defaultRedactor.redact(obj);
}

module.exports = {
  SensitiveDataRedactor,
  defaultRedactor,
  redact
};
