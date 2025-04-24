/**
 * @fileoverview Integrazione di tutti i componenti di sicurezza in un sistema unificato
 * 
 * Questo modulo integra tutti i componenti di sicurezza (logging strutturato,
 * redazione di informazioni sensibili, correlazione delle richieste, rilevamento
 * anomalie, regole di sicurezza e notifiche) in un sistema unificato.
 */

const { Logger } = require('./logger/structured_logger');
const { SensitiveDataRedactor } = require('./logger/sensitive_data_redactor');
const { RequestCorrelator } = require('./logger/request_correlator');
const { AnomalyDetector } = require('./security/anomaly_detector');
const { SecurityRules } = require('./security/security_rules');
const { AlertNotifier } = require('./security/alert_notifier');
const { SecretRotationService } = require('./secrets/secret_rotation_service');
const { GracePeriodManager } = require('./secrets/grace_period_manager');

// Configurazione del logger
const logger = new Logger('security-system');

/**
 * Classe SecuritySystem
 * 
 * Integra tutti i componenti di sicurezza in un sistema unificato,
 * fornendo un'interfaccia semplificata per l'utilizzo di tutte le funzionalità.
 */
class SecuritySystem {
  /**
   * Crea una nuova istanza di SecuritySystem
   * @param {Object} config - Configurazione per il sistema di sicurezza
   * @param {Object} config.logger - Configurazione per il logger
   * @param {Object} config.redactor - Configurazione per il redattore
   * @param {Object} config.correlator - Configurazione per il correlatore
   * @param {Object} config.anomalyDetector - Configurazione per il rilevatore di anomalie
   * @param {Object} config.securityRules - Configurazione per le regole di sicurezza
   * @param {Object} config.alertNotifier - Configurazione per il notificatore
   * @param {Object} config.secretRotation - Configurazione per la rotazione dei segreti
   * @param {Object} config.gracePeriod - Configurazione per il gestore dei periodi di grazia
   */
  constructor(config = {}) {
    // Inizializza i componenti
    this.logger = new Logger(config.logger || {});
    this.redactor = new SensitiveDataRedactor(config.redactor || {});
    this.correlator = new RequestCorrelator(config.correlator || {});
    this.anomalyDetector = new AnomalyDetector(config.anomalyDetector || {});
    this.securityRules = new SecurityRules({
      ...config.securityRules,
      anomalyDetector: this.anomalyDetector
    });
    this.alertNotifier = new AlertNotifier(config.alertNotifier || {});
    this.secretRotationService = new SecretRotationService(config.secretRotation || {});
    this.gracePeriodManager = new GracePeriodManager(config.gracePeriod || {});
    
    // Collega i componenti
    this._connectComponents();
    
    logger.info('SecuritySystem inizializzato', {
      components: [
        'logger',
        'redactor',
        'correlator',
        'anomalyDetector',
        'securityRules',
        'alertNotifier',
        'secretRotationService',
        'gracePeriodManager'
      ]
    });
  }
  
  /**
   * Collega i componenti
   * @private
   */
  _connectComponents() {
    // Collega le regole di sicurezza al notificatore
    this.securityRules.on('alert', (alert) => {
      logger.debug('Alert ricevuto dalle regole di sicurezza', { alert });
      this.alertNotifier.notify(alert);
    });
    
    // Collega il rilevatore di anomalie alle regole di sicurezza
    this.anomalyDetector.on('anomalies', (anomalies) => {
      logger.debug('Anomalie ricevute dal rilevatore', { count: anomalies.length });
      
      // Converti le anomalie in eventi per le regole di sicurezza
      for (const anomaly of anomalies) {
        this.securityRules.addEvent({
          type: 'anomaly',
          metric: anomaly.metric,
          value: anomaly.value,
          zScore: anomaly.zScore,
          severity: anomaly.severity,
          timestamp: anomaly.timestamp
        });
      }
    });
    
    // Collega il servizio di rotazione dei segreti al gestore dei periodi di grazia
    this.secretRotationService.on('rotation', (rotationEvent) => {
      logger.debug('Evento di rotazione ricevuto', { rotationEvent });
      
      // Avvia un periodo di grazia per la vecchia chiave
      this.gracePeriodManager.startGracePeriod({
        keyId: rotationEvent.oldKeyId,
        expiresAt: Date.now() + rotationEvent.gracePeriod,
        metadata: {
          rotationId: rotationEvent.id,
          newKeyId: rotationEvent.newKeyId
        }
      });
    });
    
    // Collega il gestore dei periodi di grazia al servizio di rotazione dei segreti
    this.gracePeriodManager.on('expired', (expiredKey) => {
      logger.debug('Chiave scaduta', { expiredKey });
      
      // Notifica il servizio di rotazione dei segreti
      this.secretRotationService.handleExpiredKey(expiredKey);
    });
    
    logger.info('Componenti collegati');
  }
  
  /**
   * Avvia il sistema di sicurezza
   * @returns {Promise<void>}
   */
  async start() {
    logger.info('Avvio del sistema di sicurezza');
    
    try {
      // Avvia i componenti
      await this.anomalyDetector.start();
      await this.securityRules.start();
      await this.secretRotationService.start();
      await this.gracePeriodManager.start();
      
      logger.info('Sistema di sicurezza avviato');
    } catch (error) {
      logger.error('Errore durante l\'avvio del sistema di sicurezza', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Ferma il sistema di sicurezza
   * @returns {Promise<void>}
   */
  async stop() {
    logger.info('Arresto del sistema di sicurezza');
    
    try {
      // Ferma i componenti
      await this.anomalyDetector.stop();
      await this.securityRules.stop();
      await this.secretRotationService.stop();
      await this.gracePeriodManager.stop();
      
      logger.info('Sistema di sicurezza arrestato');
    } catch (error) {
      logger.error('Errore durante l\'arresto del sistema di sicurezza', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Crea un middleware Express per il sistema di sicurezza
   * @returns {Function} Middleware Express
   */
  createExpressMiddleware() {
    return (req, res, next) => {
      // Applica il middleware del correlatore
      const correlatorMiddleware = this.correlator.createExpressMiddleware();
      
      // Applica il middleware del redattore
      const redactorMiddleware = this.redactor.createExpressMiddleware();
      
      // Esegui i middleware in sequenza
      correlatorMiddleware(req, res, (err) => {
        if (err) return next(err);
        
        redactorMiddleware(req, res, (err) => {
          if (err) return next(err);
          
          // Aggiungi l'evento di richiesta alle regole di sicurezza
          this.securityRules.addEvent({
            type: 'api-request',
            method: req.method,
            path: req.path,
            ip: req.ip,
            correlationId: req.getCorrelationId(),
            timestamp: Date.now()
          });
          
          // Continua con il middleware successivo
          next();
        });
      });
    };
  }
  
  /**
   * Aggiorna le statistiche del rilevatore di anomalie
   * @param {Object} stats - Nuove statistiche
   * @returns {Array<Object>} Anomalie rilevate
   */
  updateStats(stats) {
    return this.anomalyDetector.updateStats(stats);
  }
  
  /**
   * Aggiunge un evento alle regole di sicurezza
   * @param {Object} event - Evento da aggiungere
   */
  addSecurityEvent(event) {
    this.securityRules.addEvent(event);
  }
  
  /**
   * Notifica un alert
   * @param {Object} alert - Alert da notificare
   * @returns {Promise<Object>} Risultato della notifica
   */
  async notifyAlert(alert) {
    return this.alertNotifier.notify(alert);
  }
  
  /**
   * Redige un oggetto
   * @param {Object} obj - Oggetto da redarre
   * @returns {Object} Oggetto redatto
   */
  redactSensitiveData(obj) {
    return this.redactor.redact(obj);
  }
  
  /**
   * Ottiene l'ID di correlazione dal contesto corrente
   * @returns {string|null} ID di correlazione
   */
  getCorrelationId() {
    return this.correlator.getCorrelationId();
  }
  
  /**
   * Esegue una funzione all'interno di un contesto di correlazione
   * @param {Function} fn - Funzione da eseguire
   * @param {Object} [context] - Contesto iniziale
   * @returns {*} Risultato della funzione
   */
  withCorrelation(fn, context) {
    return this.correlator.runWithContext(fn, context);
  }
  
  /**
   * Pianifica una rotazione dei segreti
   * @param {Object} options - Opzioni per la rotazione
   * @returns {Promise<Object>} Risultato della pianificazione
   */
  async scheduleSecretRotation(options) {
    return this.secretRotationService.scheduleRotation(options);
  }
  
  /**
   * Verifica se una chiave è in periodo di grazia
   * @param {string} keyId - ID della chiave
   * @returns {boolean} True se la chiave è in periodo di grazia
   */
  isKeyInGracePeriod(keyId) {
    return this.gracePeriodManager.isInGracePeriod(keyId);
  }
  
  /**
   * Ottiene lo stato del sistema
   * @returns {Object} Stato del sistema
   */
  getStatus() {
    return {
      anomalyDetector: this.anomalyDetector.getStatus(),
      securityRules: this.securityRules.getStatus(),
      alertNotifier: this.alertNotifier.getConfig(),
      secretRotation: this.secretRotationService.getStatus(),
      gracePeriod: this.gracePeriodManager.getStatus()
    };
  }
  
  /**
   * Ottiene le statistiche del sistema
   * @returns {Object} Statistiche del sistema
   */
  getStats() {
    return {
      anomalies: this.anomalyDetector.getAnomalies().length,
      alerts: this.securityRules.getAlerts().length,
      events: this.securityRules.getEvents().length,
      rotations: this.secretRotationService.getRotationHistory().length,
      gracePeriods: this.gracePeriodManager.getActivePeriods().length
    };
  }
}

module.exports = { SecuritySystem };
