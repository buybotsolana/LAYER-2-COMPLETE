/**
 * Gestore degli errori per il Layer-2 su Solana
 * 
 * Questo modulo implementa il gestore degli errori che si occupa di gestire
 * gli errori del sistema Layer-2 in modo robusto e resiliente.
 */

const { performance } = require('perf_hooks');

/**
 * Classe per la gestione degli errori
 */
class ErrorManager {
  /**
   * Costruttore
   * @param {Object} config - Configurazione del gestore degli errori
   * @param {number} config.maxRetries - Numero massimo di tentativi
   * @param {number} config.initialBackoff - Backoff iniziale in millisecondi
   * @param {number} config.maxBackoff - Backoff massimo in millisecondi
   * @param {number} config.backoffFactor - Fattore di moltiplicazione per il backoff
   * @param {number} config.jitterFactor - Fattore di jitter per il backoff
   */
  constructor(config) {
    this.maxRetries = config.maxRetries || 3;
    this.initialBackoff = config.initialBackoff || 1000;
    this.maxBackoff = config.maxBackoff || 30000;
    this.backoffFactor = config.backoffFactor || 2;
    this.jitterFactor = config.jitterFactor || 0.1;
    
    // Mappa degli errori per tipo
    this.errorsByType = new Map();
    
    // Mappa dei tentativi per contesto
    this.retryCountByContext = new Map();
    
    // Mappa dei circuit breaker per contesto
    this.circuitBreakerByContext = new Map();
    
    // Mappa dei timestamp di ripristino per contesto
    this.resetTimeByContext = new Map();
    
    // Metriche
    this.metrics = {
      totalErrors: 0,
      handledErrors: 0,
      unhandledErrors: 0,
      retriedErrors: 0,
      successfulRetries: 0,
      failedRetries: 0,
      circuitBreakerTrips: 0,
      errorsByType: {},
      errorsByContext: {},
    };
    
    // Bind dei metodi
    this.handleError = this.handleError.bind(this);
    this.classifyError = this.classifyError.bind(this);
    this.shouldRetry = this.shouldRetry.bind(this);
    this.calculateBackoff = this.calculateBackoff.bind(this);
    this.isCircuitBreakerOpen = this.isCircuitBreakerOpen.bind(this);
    this.tripCircuitBreaker = this.tripCircuitBreaker.bind(this);
    this.resetCircuitBreaker = this.resetCircuitBreaker.bind(this);
    this.getMetrics = this.getMetrics.bind(this);
    this.resetMetrics = this.resetMetrics.bind(this);
    
    console.log('ErrorManager inizializzato con successo');
  }
  
  /**
   * Gestisce un errore
   * @param {Error} error - Errore da gestire
   * @param {Object} options - Opzioni per la gestione dell'errore
   * @param {string} options.context - Contesto dell'errore
   * @param {Function} options.retryCallback - Funzione da richiamare per riprovare
   * @param {number} options.maxRetries - Numero massimo di tentativi per questo errore
   * @param {boolean} options.ignoreCircuitBreaker - Ignora il circuit breaker
   * @returns {Promise<any>} Risultato del retry o null
   */
  async handleError(error, options = {}) {
    const startTime = performance.now();
    
    try {
      console.error(`Errore in ${options.context || 'unknown'}:`, error);
      
      // Incrementa il contatore degli errori
      this.metrics.totalErrors++;
      
      // Classifica l'errore
      const errorType = this.classifyError(error);
      
      // Aggiorna le metriche per tipo di errore
      this.metrics.errorsByType[errorType] = (this.metrics.errorsByType[errorType] || 0) + 1;
      
      // Aggiorna le metriche per contesto
      const context = options.context || 'unknown';
      this.metrics.errorsByContext[context] = (this.metrics.errorsByContext[context] || 0) + 1;
      
      // Aggiunge l'errore alla mappa per tipo
      if (!this.errorsByType.has(errorType)) {
        this.errorsByType.set(errorType, []);
      }
      
      this.errorsByType.get(errorType).push({
        error,
        timestamp: Date.now(),
        context,
      });
      
      // Verifica se è possibile riprovare
      if (!options.retryCallback) {
        console.log(`Nessuna funzione di retry fornita per l'errore in ${context}`);
        this.metrics.unhandledErrors++;
        return null;
      }
      
      // Verifica se il circuit breaker è aperto
      if (!options.ignoreCircuitBreaker && this.isCircuitBreakerOpen(context)) {
        console.log(`Circuit breaker aperto per ${context}, impossibile riprovare`);
        this.metrics.unhandledErrors++;
        return null;
      }
      
      // Ottiene il contatore dei tentativi
      const retryCount = this.retryCountByContext.get(context) || 0;
      
      // Verifica se è possibile riprovare
      const maxRetries = options.maxRetries || this.maxRetries;
      
      if (retryCount >= maxRetries) {
        console.log(`Numero massimo di tentativi raggiunto per ${context}`);
        
        // Apre il circuit breaker
        this.tripCircuitBreaker(context);
        
        this.metrics.failedRetries++;
        this.metrics.unhandledErrors++;
        
        return null;
      }
      
      // Verifica se è opportuno riprovare
      if (!this.shouldRetry(error, context)) {
        console.log(`Errore non riprovabile in ${context}`);
        this.metrics.unhandledErrors++;
        return null;
      }
      
      // Incrementa il contatore dei tentativi
      this.retryCountByContext.set(context, retryCount + 1);
      
      // Calcola il backoff
      const backoff = this.calculateBackoff(retryCount);
      
      console.log(`Attesa di ${backoff}ms prima di riprovare (tentativo ${retryCount + 1}/${maxRetries})`);
      
      // Attende il backoff
      await new Promise(resolve => setTimeout(resolve, backoff));
      
      // Incrementa il contatore degli errori riprovati
      this.metrics.retriedErrors++;
      
      // Riprova
      console.log(`Riprovando l'operazione in ${context}...`);
      
      try {
        const result = await options.retryCallback();
        
        // Resetta il contatore dei tentativi
        this.retryCountByContext.set(context, 0);
        
        // Incrementa il contatore dei retry riusciti
        this.metrics.successfulRetries++;
        
        // Incrementa il contatore degli errori gestiti
        this.metrics.handledErrors++;
        
        console.log(`Operazione in ${context} completata con successo dopo ${retryCount + 1} tentativi`);
        
        return result;
      } catch (retryError) {
        console.error(`Errore durante il retry in ${context}:`, retryError);
        
        // Incrementa il contatore dei retry falliti
        this.metrics.failedRetries++;
        
        // Richiama ricorsivamente la funzione di gestione degli errori
        return this.handleError(retryError, options);
      }
    } catch (handlerError) {
      console.error('Errore durante la gestione dell\'errore:', handlerError);
      
      // Incrementa il contatore degli errori non gestiti
      this.metrics.unhandledErrors++;
      
      return null;
    } finally {
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`Gestione dell'errore completata in ${duration.toFixed(2)}ms`);
    }
  }
  
  /**
   * Classifica un errore
   * @param {Error} error - Errore da classificare
   * @returns {string} Tipo di errore
   */
  classifyError(error) {
    // Verifica se l'errore è null o undefined
    if (!error) {
      return 'unknown';
    }
    
    // Verifica se l'errore ha un nome
    if (error.name) {
      return error.name;
    }
    
    // Verifica se l'errore ha un codice
    if (error.code) {
      return `code:${error.code}`;
    }
    
    // Verifica se l'errore è un'istanza di Error
    if (error instanceof Error) {
      return error.constructor.name;
    }
    
    // Verifica se l'errore è un oggetto
    if (typeof error === 'object') {
      return 'object';
    }
    
    // Verifica se l'errore è una stringa
    if (typeof error === 'string') {
      return 'string';
    }
    
    // Tipo di errore sconosciuto
    return 'unknown';
  }
  
  /**
   * Verifica se è opportuno riprovare un errore
   * @param {Error} error - Errore da verificare
   * @param {string} context - Contesto dell'errore
   * @returns {boolean} True se è opportuno riprovare
   */
  shouldRetry(error, context) {
    // Verifica se l'errore è null o undefined
    if (!error) {
      return false;
    }
    
    // Errori che non dovrebbero essere riprovati
    const nonRetryableErrors = [
      'InvalidArgumentError',
      'AuthenticationError',
      'AuthorizationError',
      'ValidationError',
      'NotFoundError',
      'AlreadyExistsError',
      'InvalidStateError',
    ];
    
    // Verifica se l'errore è nella lista dei non riprovabili
    const errorType = this.classifyError(error);
    
    if (nonRetryableErrors.includes(errorType)) {
      return false;
    }
    
    // Errori che dovrebbero essere riprovati
    const retryableErrors = [
      'TimeoutError',
      'NetworkError',
      'ConnectionError',
      'ServiceUnavailableError',
      'RateLimitError',
      'InternalServerError',
      'code:ECONNRESET',
      'code:ETIMEDOUT',
      'code:ECONNREFUSED',
      'code:ENOTFOUND',
      'code:ESOCKETTIMEDOUT',
    ];
    
    // Verifica se l'errore è nella lista dei riprovabili
    if (retryableErrors.includes(errorType)) {
      return true;
    }
    
    // Verifica se l'errore ha un messaggio che indica che è riprovabile
    if (error.message) {
      const retryableMessages = [
        'timeout',
        'timed out',
        'connection',
        'network',
        'unavailable',
        'rate limit',
        'too many requests',
        'internal server error',
        'server error',
        'temporary',
        'retry',
      ];
      
      const message = error.message.toLowerCase();
      
      for (const retryableMessage of retryableMessages) {
        if (message.includes(retryableMessage)) {
          return true;
        }
      }
    }
    
    // Per impostazione predefinita, riprova
    return true;
  }
  
  /**
   * Calcola il backoff per un tentativo
   * @param {number} retryCount - Numero di tentativi
   * @returns {number} Backoff in millisecondi
   */
  calculateBackoff(retryCount) {
    // Calcola il backoff esponenziale
    const backoff = Math.min(
      this.initialBackoff * Math.pow(this.backoffFactor, retryCount),
      this.maxBackoff
    );
    
    // Aggiunge il jitter
    const jitter = backoff * this.jitterFactor * (Math.random() * 2 - 1);
    
    return Math.max(0, Math.floor(backoff + jitter));
  }
  
  /**
   * Verifica se il circuit breaker è aperto
   * @param {string} context - Contesto dell'errore
   * @returns {boolean} True se il circuit breaker è aperto
   */
  isCircuitBreakerOpen(context) {
    // Verifica se il circuit breaker è aperto
    const isOpen = this.circuitBreakerByContext.get(context) || false;
    
    if (!isOpen) {
      return false;
    }
    
    // Verifica se è il momento di resettare il circuit breaker
    const resetTime = this.resetTimeByContext.get(context) || 0;
    
    if (Date.now() >= resetTime) {
      // Resetta il circuit breaker
      this.resetCircuitBreaker(context);
      return false;
    }
    
    return true;
  }
  
  /**
   * Apre il circuit breaker
   * @param {string} context - Contesto dell'errore
   * @param {number} resetTimeMs - Tempo di reset in millisecondi
   */
  tripCircuitBreaker(context, resetTimeMs = 60000) {
    console.log(`Apertura del circuit breaker per ${context}`);
    
    // Imposta il circuit breaker come aperto
    this.circuitBreakerByContext.set(context, true);
    
    // Imposta il timestamp di reset
    this.resetTimeByContext.set(context, Date.now() + resetTimeMs);
    
    // Incrementa il contatore dei circuit breaker aperti
    this.metrics.circuitBreakerTrips++;
  }
  
  /**
   * Resetta il circuit breaker
   * @param {string} context - Contesto dell'errore
   */
  resetCircuitBreaker(context) {
    console.log(`Reset del circuit breaker per ${context}`);
    
    // Imposta il circuit breaker come chiuso
    this.circuitBreakerByContext.set(context, false);
    
    // Resetta il timestamp di reset
    this.resetTimeByContext.delete(context);
  }
  
  /**
   * Ottiene le metriche
   * @returns {Object} Metriche
   */
  getMetrics() {
    return { ...this.metrics };
  }
  
  /**
   * Resetta le metriche
   */
  resetMetrics() {
    this.metrics = {
      totalErrors: 0,
      handledErrors: 0,
      unhandledErrors: 0,
      retriedErrors: 0,
      successfulRetries: 0,
      failedRetries: 0,
      circuitBreakerTrips: 0,
      errorsByType: {},
      errorsByContext: {},
    };
  }
}

module.exports = { ErrorManager };
