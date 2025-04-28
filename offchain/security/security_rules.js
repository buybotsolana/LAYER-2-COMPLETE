/**
 * @fileoverview Implementazione di regole di sicurezza per il rilevamento di attività sospette
 * 
 * Questo modulo implementa un sistema di regole di sicurezza per il rilevamento
 * di attività sospette, con supporto per regole personalizzate, valutazione
 * condizionale e integrazione con il sistema di rilevamento anomalie.
 */

const { Logger } = require('../logger');
const { EventEmitter } = require('events');
const { AnomalyDetector } = require('./anomaly_detector');

// Configurazione del logger
const logger = new Logger('security-rules');

/**
 * Classe SecurityRules
 * 
 * Implementa un sistema di regole di sicurezza per il rilevamento di attività sospette,
 * con supporto per regole personalizzate, valutazione condizionale e integrazione
 * con il sistema di rilevamento anomalie.
 */
class SecurityRules extends EventEmitter {
  /**
   * Crea una nuova istanza di SecurityRules
   * @param {Object} config - Configurazione per le regole di sicurezza
   * @param {Array<Object>} config.rules - Regole di sicurezza predefinite
   * @param {AnomalyDetector} config.anomalyDetector - Istanza di AnomalyDetector
   * @param {number} config.evaluationInterval - Intervallo di valutazione in millisecondi (default: 1 minuto)
   * @param {number} config.maxEvents - Numero massimo di eventi da memorizzare (default: 1000)
   * @param {number} config.maxAlerts - Numero massimo di alert da memorizzare (default: 100)
   */
  constructor(config = {}) {
    super();
    
    this.rules = config.rules || [];
    this.anomalyDetector = config.anomalyDetector;
    this.evaluationInterval = config.evaluationInterval || 60 * 1000; // 1 minuto
    this.maxEvents = config.maxEvents || 1000;
    this.maxAlerts = config.maxAlerts || 100;
    
    // Eventi memorizzati
    this.events = [];
    
    // Alert generati
    this.alerts = [];
    
    // Contesto per la valutazione delle regole
    this.context = config.context || {
      largeWithdrawalThreshold: 1000000, // 1 milione di unità
      maxFailedAttempts: 5,
      suspiciousIPs: [],
      trustedIPs: [],
      rateLimit: {
        requestsPerMinute: 100,
        requestsPerHour: 1000
      }
    };
    
    // Intervallo di valutazione
    this.evaluationIntervalId = null;
    
    // Inizializza le regole predefinite se non fornite
    if (this.rules.length === 0) {
      this._initializeDefaultRules();
    }
    
    // Collega il rilevatore di anomalie se fornito
    if (this.anomalyDetector) {
      this._connectAnomalyDetector();
    }
    
    logger.info('SecurityRules inizializzato', {
      rulesCount: this.rules.length,
      evaluationInterval: this.evaluationInterval,
      maxEvents: this.maxEvents,
      maxAlerts: this.maxAlerts
    });
  }
  
  /**
   * Inizializza le regole predefinite
   * @private
   */
  _initializeDefaultRules() {
    this.rules = [
      {
        name: 'multiple-failed-withdrawals',
        description: 'Rileva tentativi multipli di prelievo falliti',
        condition: (events, context) => {
          const failedWithdrawals = events.filter(e => 
            e.type === 'withdrawal' && e.status === 'failed'
          );
          
          // Raggruppa per utente
          const userGroups = {};
          for (const event of failedWithdrawals) {
            const userId = event.userId || 'anonymous';
            if (!userGroups[userId]) {
              userGroups[userId] = [];
            }
            userGroups[userId].push(event);
          }
          
          // Verifica se ci sono utenti con troppi tentativi falliti
          const suspiciousUsers = Object.entries(userGroups)
            .filter(([userId, events]) => events.length >= context.maxFailedAttempts)
            .map(([userId, events]) => ({
              userId,
              count: events.length,
              events
            }));
          
          return suspiciousUsers.length > 0 ? suspiciousUsers : false;
        },
        severity: 'high',
        category: 'fraud',
        action: 'notify'
      },
      {
        name: 'large-withdrawal',
        description: 'Rileva prelievi di importo elevato',
        condition: (events, context) => {
          const largeWithdrawals = events.filter(e => 
            e.type === 'withdrawal' && 
            e.amount > context.largeWithdrawalThreshold
          );
          
          return largeWithdrawals.length > 0 ? largeWithdrawals : false;
        },
        severity: 'medium',
        category: 'suspicious-activity',
        action: 'notify'
      },
      {
        name: 'unusual-login-location',
        description: 'Rileva accessi da località inusuali',
        condition: (events, context) => {
          // Trova gli eventi di login
          const loginEvents = events.filter(e => e.type === 'login' && e.success);
          
          // Raggruppa per utente
          const userLogins = {};
          for (const event of loginEvents) {
            const userId = event.userId || 'anonymous';
            if (!userLogins[userId]) {
              userLogins[userId] = [];
            }
            userLogins[userId].push(event);
          }
          
          // Verifica cambi di località sospetti
          const suspiciousLogins = [];
          
          for (const [userId, logins] of Object.entries(userLogins)) {
            if (logins.length < 2) continue;
            
            // Ordina per timestamp
            logins.sort((a, b) => a.timestamp - b.timestamp);
            
            for (let i = 1; i < logins.length; i++) {
              const prevLogin = logins[i - 1];
              const currLogin = logins[i];
              
              // Se la località è cambiata
              if (prevLogin.location && currLogin.location && 
                  prevLogin.location !== currLogin.location) {
                
                // Calcola il tempo trascorso
                const timeDiff = currLogin.timestamp - prevLogin.timestamp;
                
                // Se il tempo è troppo breve per un cambio di località
                if (timeDiff < 3600000) { // 1 ora
                  suspiciousLogins.push({
                    userId,
                    previousLogin: prevLogin,
                    currentLogin: currLogin,
                    timeDiff
                  });
                }
              }
            }
          }
          
          return suspiciousLogins.length > 0 ? suspiciousLogins : false;
        },
        severity: 'high',
        category: 'account-security',
        action: 'notify'
      },
      {
        name: 'api-rate-limit-exceeded',
        description: 'Rileva superamento dei limiti di frequenza delle API',
        condition: (events, context) => {
          // Trova gli eventi di richiesta API
          const apiEvents = events.filter(e => e.type === 'api-request');
          
          // Raggruppa per IP
          const ipGroups = {};
          for (const event of apiEvents) {
            const ip = event.ip || 'unknown';
            if (!ipGroups[ip]) {
              ipGroups[ip] = [];
            }
            ipGroups[ip].push(event);
          }
          
          // Verifica se ci sono IP che superano i limiti
          const now = Date.now();
          const oneMinuteAgo = now - 60000;
          const oneHourAgo = now - 3600000;
          
          const suspiciousIPs = [];
          
          for (const [ip, requests] of Object.entries(ipGroups)) {
            // Salta gli IP fidati
            if (context.trustedIPs.includes(ip)) continue;
            
            // Conta le richieste nell'ultimo minuto
            const requestsLastMinute = requests.filter(r => r.timestamp >= oneMinuteAgo).length;
            
            // Conta le richieste nell'ultima ora
            const requestsLastHour = requests.filter(r => r.timestamp >= oneHourAgo).length;
            
            // Verifica se i limiti sono superati
            if (requestsLastMinute > context.rateLimit.requestsPerMinute ||
                requestsLastHour > context.rateLimit.requestsPerHour) {
              suspiciousIPs.push({
                ip,
                requestsLastMinute,
                requestsLastHour,
                minuteLimit: context.rateLimit.requestsPerMinute,
                hourLimit: context.rateLimit.requestsPerHour
              });
            }
          }
          
          return suspiciousIPs.length > 0 ? suspiciousIPs : false;
        },
        severity: 'medium',
        category: 'dos-protection',
        action: 'rate-limit'
      },
      {
        name: 'suspicious-transaction-pattern',
        description: 'Rileva pattern sospetti nelle transazioni',
        condition: (events, context) => {
          // Trova gli eventi di transazione
          const txEvents = events.filter(e => 
            e.type === 'transaction' && e.status === 'completed'
          );
          
          // Raggruppa per utente
          const userTxs = {};
          for (const event of txEvents) {
            const userId = event.userId || 'anonymous';
            if (!userTxs[userId]) {
              userTxs[userId] = [];
            }
            userTxs[userId].push(event);
          }
          
          // Verifica pattern sospetti
          const suspiciousPatterns = [];
          
          for (const [userId, transactions] of Object.entries(userTxs)) {
            if (transactions.length < 3) continue;
            
            // Ordina per timestamp
            transactions.sort((a, b) => a.timestamp - b.timestamp);
            
            // Verifica transazioni multiple di importo simile in rapida successione
            const similarAmountTxs = [];
            for (let i = 1; i < transactions.length; i++) {
              const prevTx = transactions[i - 1];
              const currTx = transactions[i];
              
              // Calcola la differenza di importo in percentuale
              const amountDiff = Math.abs(currTx.amount - prevTx.amount) / Math.max(currTx.amount, prevTx.amount);
              
              // Calcola il tempo trascorso
              const timeDiff = currTx.timestamp - prevTx.timestamp;
              
              // Se l'importo è simile e il tempo è breve
              if (amountDiff < 0.1 && timeDiff < 300000) { // 10% di differenza, 5 minuti
                similarAmountTxs.push({
                  previous: prevTx,
                  current: currTx,
                  amountDiff,
                  timeDiff
                });
              }
            }
            
            if (similarAmountTxs.length >= 2) {
              suspiciousPatterns.push({
                userId,
                pattern: 'similar-amount-rapid-succession',
                transactions: similarAmountTxs
              });
            }
            
            // Verifica transazioni che svuotano il saldo
            const balanceDrainTxs = transactions.filter(tx => 
              tx.balanceAfter !== undefined && 
              tx.balanceBefore !== undefined &&
              tx.balanceAfter / tx.balanceBefore < 0.1 && // Meno del 10% del saldo rimasto
              tx.balanceBefore > context.largeWithdrawalThreshold / 10 // Saldo significativo
            );
            
            if (balanceDrainTxs.length > 0) {
              suspiciousPatterns.push({
                userId,
                pattern: 'balance-drain',
                transactions: balanceDrainTxs
              });
            }
          }
          
          return suspiciousPatterns.length > 0 ? suspiciousPatterns : false;
        },
        severity: 'high',
        category: 'fraud',
        action: 'notify'
      }
    ];
    
    logger.info('Regole predefinite inizializzate', { count: this.rules.length });
  }
  
  /**
   * Collega il rilevatore di anomalie
   * @private
   */
  _connectAnomalyDetector() {
    this.anomalyDetector.on('anomalies', (anomalies) => {
      logger.debug('Anomalie ricevute dal rilevatore', { count: anomalies.length });
      
      // Converti le anomalie in eventi
      for (const anomaly of anomalies) {
        this.addEvent({
          type: 'anomaly',
          metric: anomaly.metric,
          value: anomaly.value,
          zScore: anomaly.zScore,
          severity: anomaly.severity,
          timestamp: anomaly.timestamp
        });
      }
    });
    
    logger.info('Rilevatore di anomalie collegato');
  }
  
  /**
   * Avvia il sistema di regole di sicurezza
   * @returns {Promise<void>}
   */
  async start() {
    if (this.evaluationIntervalId) {
      logger.warn('Il sistema di regole di sicurezza è già avviato');
      return;
    }
    
    logger.info('Avvio del sistema di regole di sicurezza');
    
    // Imposta l'intervallo di valutazione
    this.evaluationIntervalId = setInterval(() => this.evaluateRules(), this.evaluationInterval);
    
    logger.info('Sistema di regole di sicurezza avviato');
  }
  
  /**
   * Ferma il sistema di regole di sicurezza
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.evaluationIntervalId) {
      logger.warn('Il sistema di regole di sicurezza non è avviato');
      return;
    }
    
    logger.info('Arresto del sistema di regole di sicurezza');
    
    // Ferma l'intervallo di valutazione
    clearInterval(this.evaluationIntervalId);
    this.evaluationIntervalId = null;
    
    logger.info('Sistema di regole di sicurezza arrestato');
  }
  
  /**
   * Aggiunge un evento
   * @param {Object} event - Evento da aggiungere
   */
  addEvent(event) {
    // Assicura che l'evento abbia un timestamp
    if (!event.timestamp) {
      event.timestamp = Date.now();
    }
    
    // Aggiungi l'evento
    this.events.push(event);
    
    // Limita il numero di eventi
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
    
    logger.debug('Evento aggiunto', { event });
    
    // Valuta le regole se necessario
    if (event.evaluateImmediately) {
      this.evaluateRules();
    }
  }
  
  /**
   * Valuta tutte le regole
   * @returns {Array<Object>} Alert generati
   */
  evaluateRules() {
    logger.debug('Valutazione delle regole di sicurezza');
    
    const newAlerts = [];
    
    // Valuta ogni regola
    for (const rule of this.rules) {
      try {
        // Valuta la condizione della regola
        const result = rule.condition(this.events, this.context);
        
        // Se la condizione è soddisfatta
        if (result) {
          // Crea l'alert
          const alert = {
            ruleId: rule.id || rule.name,
            ruleName: rule.name,
            description: rule.description,
            severity: rule.severity,
            category: rule.category,
            action: rule.action,
            timestamp: Date.now(),
            result
          };
          
          // Aggiungi l'alert
          this.alerts.push(alert);
          newAlerts.push(alert);
          
          // Limita il numero di alert
          if (this.alerts.length > this.maxAlerts) {
            this.alerts = this.alerts.slice(-this.maxAlerts);
          }
          
          // Emetti l'evento per il nuovo alert
          this.emit('alert', alert);
          
          // Registra l'alert
          logger.warn(`Alert di sicurezza: ${rule.name}`, {
            alert,
            rule: {
              name: rule.name,
              severity: rule.severity,
              category: rule.category,
              action: rule.action
            }
          });
        }
      } catch (error) {
        logger.error(`Errore durante la valutazione della regola ${rule.name}`, { error: error.message });
      }
    }
    
    // Se ci sono nuovi alert, emetti l'evento
    if (newAlerts.length > 0) {
      this.emit('alerts', newAlerts);
    }
    
    return newAlerts;
  }
  
  /**
   * Aggiunge una regola
   * @param {Object} rule - Regola da aggiungere
   * @returns {string} ID della regola
   */
  addRule(rule) {
    // Genera un ID se non fornito
    if (!rule.id) {
      rule.id = `rule-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    }
    
    // Aggiungi la regola
    this.rules.push(rule);
    
    logger.info(`Regola aggiunta: ${rule.name}`, { ruleId: rule.id });
    
    return rule.id;
  }
  
  /**
   * Rimuove una regola
   * @param {string} ruleId - ID della regola
   * @returns {boolean} True se la regola è stata rimossa
   */
  removeRule(ruleId) {
    const index = this.rules.findIndex(r => r.id === ruleId || r.name === ruleId);
    
    if (index === -1) {
      logger.warn(`Regola non trovata: ${ruleId}`);
      return false;
    }
    
    // Rimuovi la regola
    const rule = this.rules.splice(index, 1)[0];
    
    logger.info(`Regola rimossa: ${rule.name}`, { ruleId: rule.id || rule.name });
    
    return true;
  }
  
  /**
   * Aggiorna una regola
   * @param {string} ruleId - ID della regola
   * @param {Object} updates - Aggiornamenti da applicare
   * @returns {boolean} True se la regola è stata aggiornata
   */
  updateRule(ruleId, updates) {
    const index = this.rules.findIndex(r => r.id === ruleId || r.name === ruleId);
    
    if (index === -1) {
      logger.warn(`Regola non trovata: ${ruleId}`);
      return false;
    }
    
    // Aggiorna la regola
    const rule = this.rules[index];
    this.rules[index] = { ...rule, ...updates };
    
    logger.info(`Regola aggiornata: ${rule.name}`, { ruleId: rule.id || rule.name });
    
    return true;
  }
  
  /**
   * Ottiene una regola
   * @param {string} ruleId - ID della regola
   * @returns {Object|null} Regola o null se non trovata
   */
  getRule(ruleId) {
    const rule = this.rules.find(r => r.id === ruleId || r.name === ruleId);
    
    if (!rule) {
      logger.warn(`Regola non trovata: ${ruleId}`);
      return null;
    }
    
    return rule;
  }
  
  /**
   * Ottiene tutte le regole
   * @returns {Array<Object>} Regole
   */
  getRules() {
    return this.rules;
  }
  
  /**
   * Ottiene gli alert
   * @param {Object} [options] - Opzioni di filtro
   * @param {number} [options.since] - Timestamp minimo
   * @param {number} [options.until] - Timestamp massimo
   * @param {Array<string>} [options.severities] - Severità da includere
   * @param {Array<string>} [options.categories] - Categorie da includere
   * @param {Array<string>} [options.ruleIds] - ID delle regole da includere
   * @returns {Array<Object>} Alert filtrati
   */
  getAlerts(options = {}) {
    let filtered = [...this.alerts];
    
    // Filtra per timestamp
    if (options.since) {
      filtered = filtered.filter(a => a.timestamp >= options.since);
    }
    
    if (options.until) {
      filtered = filtered.filter(a => a.timestamp <= options.until);
    }
    
    // Filtra per severità
    if (options.severities && options.severities.length > 0) {
      filtered = filtered.filter(a => options.severities.includes(a.severity));
    }
    
    // Filtra per categoria
    if (options.categories && options.categories.length > 0) {
      filtered = filtered.filter(a => options.categories.includes(a.category));
    }
    
    // Filtra per ID regola
    if (options.ruleIds && options.ruleIds.length > 0) {
      filtered = filtered.filter(a => options.ruleIds.includes(a.ruleId));
    }
    
    return filtered;
  }
  
  /**
   * Ottiene gli eventi
   * @param {Object} [options] - Opzioni di filtro
   * @param {number} [options.since] - Timestamp minimo
   * @param {number} [options.until] - Timestamp massimo
   * @param {Array<string>} [options.types] - Tipi di evento da includere
   * @returns {Array<Object>} Eventi filtrati
   */
  getEvents(options = {}) {
    let filtered = [...this.events];
    
    // Filtra per timestamp
    if (options.since) {
      filtered = filtered.filter(e => e.timestamp >= options.since);
    }
    
    if (options.until) {
      filtered = filtered.filter(e => e.timestamp <= options.until);
    }
    
    // Filtra per tipo
    if (options.types && options.types.length > 0) {
      filtered = filtered.filter(e => options.types.includes(e.type));
    }
    
    return filtered;
  }
  
  /**
   * Aggiorna il contesto
   * @param {Object} updates - Aggiornamenti da applicare
   */
  updateContext(updates) {
    this.context = { ...this.context, ...updates };
    
    logger.info('Contesto aggiornato', { 
      keys: Object.keys(updates)
    });
  }
  
  /**
   * Ottiene il contesto
   * @returns {Object} Contesto
   */
  getContext() {
    return this.context;
  }
  
  /**
   * Cancella gli eventi
   */
  clearEvents() {
    this.events = [];
    logger.info('Eventi cancellati');
  }
  
  /**
   * Cancella gli alert
   */
  clearAlerts() {
    this.alerts = [];
    logger.info('Alert cancellati');
  }
  
  /**
   * Ottiene lo stato del sistema
   * @returns {Object} Stato del sistema
   */
  getStatus() {
    return {
      isRunning: !!this.evaluationIntervalId,
      rulesCount: this.rules.length,
      eventsCount: this.events.length,
      alertsCount: this.alerts.length,
      evaluationInterval: this.evaluationInterval,
      lastAlert: this.alerts.length > 0 ? 
        this.alerts[this.alerts.length - 1].timestamp : null
    };
  }
}

module.exports = { SecurityRules };
