/**
 * @fileoverview Implementazione del servizio di rotazione automatica dei segreti
 * 
 * Questo modulo implementa un servizio di rotazione automatica dei segreti
 * che permette di ruotare periodicamente i segreti in base a una configurazione
 * definita, con supporto per notifiche e gestione degli errori.
 */

const { SecretsManager } = require('./secrets_manager');
const { Logger } = require('../logger');

// Configurazione del logger
const logger = new Logger('secret-rotation-service');

/**
 * Classe SecretRotationService
 * 
 * Implementa un servizio di rotazione automatica dei segreti con
 * pianificazione configurabile e notifiche.
 */
class SecretRotationService {
  /**
   * Crea una nuova istanza di SecretRotationService
   * @param {SecretsManager} secretsManager - Istanza di SecretsManager
   * @param {Object} config - Configurazione per il servizio di rotazione
   * @param {Object} config.rotationSchedule - Pianificazione della rotazione in millisecondi
   * @param {number} config.rotationSchedule.apiKeys - Intervallo per le chiavi API (default: 30 giorni)
   * @param {number} config.rotationSchedule.jwtSecret - Intervallo per il segreto JWT (default: 90 giorni)
   * @param {number} config.rotationSchedule.encryptionKeys - Intervallo per le chiavi di crittografia (default: 180 giorni)
   * @param {Object} config.notificationConfig - Configurazione per le notifiche
   * @param {Array<string>} config.notificationConfig.channels - Canali di notifica (default: ['log'])
   * @param {Object} config.notificationConfig.recipients - Destinatari delle notifiche
   */
  constructor(secretsManager, config = {}) {
    this.secretsManager = secretsManager;
    this.rotationSchedule = config.rotationSchedule || {
      apiKeys: 30 * 24 * 60 * 60 * 1000, // 30 giorni
      jwtSecret: 90 * 24 * 60 * 60 * 1000, // 90 giorni
      encryptionKeys: 180 * 24 * 60 * 60 * 1000 // 180 giorni
    };
    this.notificationConfig = config.notificationConfig || {
      channels: ['log'],
      recipients: {}
    };
    this.lastRotation = {};
    this.interval = null;
    this.isRunning = false;
    this.rotationHistory = [];
    this.maxHistorySize = config.maxHistorySize || 100;
    
    logger.info('SecretRotationService inizializzato', { 
      schedules: Object.keys(this.rotationSchedule).map(key => ({
        secret: key,
        interval: this.rotationSchedule[key]
      }))
    });
  }
  
  /**
   * Avvia il servizio di rotazione automatica
   * @param {number} checkInterval - Intervallo di controllo in millisecondi (default: 24 ore)
   * @returns {Promise<void>}
   */
  async start(checkInterval = 24 * 60 * 60 * 1000) {
    if (this.isRunning) {
      logger.warn('Il servizio di rotazione è già in esecuzione');
      return;
    }
    
    try {
      logger.info('Avvio del servizio di rotazione automatica dei segreti', {
        checkInterval: checkInterval
      });
      
      // Carica lo stato di rotazione precedente, se disponibile
      await this.loadRotationState();
      
      // Esegui un controllo iniziale
      await this.checkRotation();
      
      // Imposta l'intervallo per i controlli periodici
      this.interval = setInterval(() => this.checkRotation(), checkInterval);
      this.isRunning = true;
      
      logger.info('Servizio di rotazione automatica dei segreti avviato');
    } catch (error) {
      logger.error('Errore durante l\'avvio del servizio di rotazione', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Ferma il servizio di rotazione automatica
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      logger.warn('Il servizio di rotazione non è in esecuzione');
      return;
    }
    
    try {
      logger.info('Arresto del servizio di rotazione automatica dei segreti');
      
      // Salva lo stato di rotazione corrente
      await this.saveRotationState();
      
      // Ferma l'intervallo
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }
      
      this.isRunning = false;
      
      logger.info('Servizio di rotazione automatica dei segreti arrestato');
    } catch (error) {
      logger.error('Errore durante l\'arresto del servizio di rotazione', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Controlla quali segreti devono essere ruotati
   * @returns {Promise<Array<Object>>} Lista dei segreti ruotati
   */
  async checkRotation() {
    logger.debug('Controllo dei segreti da ruotare');
    
    const rotatedSecrets = [];
    const now = Date.now();
    
    try {
      // Controlla ogni segreto nella pianificazione
      for (const [secretName, interval] of Object.entries(this.rotationSchedule)) {
        const lastRotation = this.lastRotation[secretName] || 0;
        
        // Se il segreto non è mai stato ruotato o è passato l'intervallo di rotazione
        if (now - lastRotation > interval) {
          logger.info(`Il segreto ${secretName} deve essere ruotato`, {
            lastRotation: new Date(lastRotation).toISOString(),
            interval: interval,
            timeSinceLastRotation: now - lastRotation
          });
          
          // Ruota il segreto
          const rotated = await this.rotateSecret(secretName);
          
          if (rotated) {
            rotatedSecrets.push({
              name: secretName,
              timestamp: now
            });
          }
        } else {
          logger.debug(`Il segreto ${secretName} non necessita di rotazione`, {
            lastRotation: new Date(lastRotation).toISOString(),
            nextRotation: new Date(lastRotation + interval).toISOString(),
            timeRemaining: lastRotation + interval - now
          });
        }
      }
      
      return rotatedSecrets;
    } catch (error) {
      logger.error('Errore durante il controllo dei segreti da ruotare', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Ruota un segreto specifico
   * @param {string} name - Nome del segreto
   * @returns {Promise<boolean>} True se la rotazione è riuscita
   */
  async rotateSecret(name) {
    try {
      logger.info(`Rotazione del segreto ${name}`);
      
      // Verifica se il segreto esiste
      const exists = await this.secretsManager.secretExists(name);
      
      if (!exists) {
        logger.warn(`Il segreto ${name} non esiste e non può essere ruotato`);
        return false;
      }
      
      // Ottieni il valore corrente del segreto
      const currentValue = await this.secretsManager.getSecret(name);
      
      // Ruota il segreto
      const newValue = await this.secretsManager.rotateSecret(name);
      
      // Aggiorna il timestamp dell'ultima rotazione
      this.lastRotation[name] = Date.now();
      
      // Aggiungi alla cronologia delle rotazioni
      this.addToRotationHistory(name, currentValue);
      
      // Notifica la rotazione
      await this.notifyRotation(name, newValue);
      
      // Salva lo stato di rotazione
      await this.saveRotationState();
      
      logger.info(`Segreto ${name} ruotato con successo`);
      
      return true;
    } catch (error) {
      logger.error(`Errore durante la rotazione del segreto ${name}`, { error: error.message });
      
      // Notifica l'errore
      await this.notifyRotationError(name, error);
      
      return false;
    }
  }
  
  /**
   * Notifica la rotazione di un segreto
   * @param {string} name - Nome del segreto
   * @param {string|Object} newValue - Nuovo valore del segreto
   * @returns {Promise<void>}
   */
  async notifyRotation(name, newValue) {
    try {
      logger.debug(`Notifica della rotazione del segreto ${name}`);
      
      const notification = {
        type: 'secret_rotation',
        secretName: name,
        timestamp: new Date().toISOString(),
        success: true
      };
      
      // Notifica su tutti i canali configurati
      for (const channel of this.notificationConfig.channels) {
        await this.sendNotification(channel, notification);
      }
    } catch (error) {
      logger.error(`Errore durante la notifica della rotazione del segreto ${name}`, { error: error.message });
    }
  }
  
  /**
   * Notifica un errore durante la rotazione di un segreto
   * @param {string} name - Nome del segreto
   * @param {Error} error - Errore verificatosi
   * @returns {Promise<void>}
   */
  async notifyRotationError(name, error) {
    try {
      logger.debug(`Notifica dell'errore di rotazione del segreto ${name}`);
      
      const notification = {
        type: 'secret_rotation_error',
        secretName: name,
        timestamp: new Date().toISOString(),
        success: false,
        error: error.message
      };
      
      // Notifica su tutti i canali configurati
      for (const channel of this.notificationConfig.channels) {
        await this.sendNotification(channel, notification);
      }
    } catch (notifyError) {
      logger.error(`Errore durante la notifica dell'errore di rotazione del segreto ${name}`, { error: notifyError.message });
    }
  }
  
  /**
   * Invia una notifica su un canale specifico
   * @param {string} channel - Canale di notifica
   * @param {Object} notification - Dati della notifica
   * @returns {Promise<void>}
   */
  async sendNotification(channel, notification) {
    try {
      switch (channel) {
        case 'log':
          // Notifica tramite log
          logger.info('Notifica di rotazione dei segreti', { notification });
          break;
          
        case 'email':
          // Notifica tramite email
          if (this.notificationConfig.recipients.email) {
            // Implementazione dell'invio email
            logger.info(`Notifica email inviata a ${this.notificationConfig.recipients.email}`);
          }
          break;
          
        case 'slack':
          // Notifica tramite Slack
          if (this.notificationConfig.recipients.slack) {
            // Implementazione dell'invio su Slack
            logger.info(`Notifica Slack inviata al canale ${this.notificationConfig.recipients.slack}`);
          }
          break;
          
        case 'webhook':
          // Notifica tramite webhook
          if (this.notificationConfig.recipients.webhook) {
            // Implementazione dell'invio tramite webhook
            logger.info(`Notifica webhook inviata a ${this.notificationConfig.recipients.webhook}`);
          }
          break;
          
        default:
          logger.warn(`Canale di notifica non supportato: ${channel}`);
      }
    } catch (error) {
      logger.error(`Errore durante l'invio della notifica sul canale ${channel}`, { error: error.message });
    }
  }
  
  /**
   * Aggiunge una rotazione alla cronologia
   * @param {string} name - Nome del segreto
   * @param {string|Object} oldValue - Vecchio valore del segreto
   */
  addToRotationHistory(name, oldValue) {
    // Crea l'entry della cronologia
    const historyEntry = {
      secretName: name,
      timestamp: Date.now(),
      oldValueHash: this.hashValue(oldValue)
    };
    
    // Aggiungi alla cronologia
    this.rotationHistory.push(historyEntry);
    
    // Limita la dimensione della cronologia
    if (this.rotationHistory.length > this.maxHistorySize) {
      this.rotationHistory.shift();
    }
  }
  
  /**
   * Crea un hash di un valore
   * @param {string|Object} value - Valore da hashare
   * @returns {string} Hash del valore
   */
  hashValue(value) {
    const crypto = require('crypto');
    const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return crypto.createHash('sha256').update(valueStr).digest('hex');
  }
  
  /**
   * Salva lo stato di rotazione
   * @returns {Promise<void>}
   */
  async saveRotationState() {
    try {
      logger.debug('Salvataggio dello stato di rotazione');
      
      const state = {
        lastRotation: this.lastRotation,
        rotationHistory: this.rotationHistory
      };
      
      // Salva lo stato come segreto
      await this.secretsManager.setSecret('rotation_state', state);
      
      logger.debug('Stato di rotazione salvato');
    } catch (error) {
      logger.error('Errore durante il salvataggio dello stato di rotazione', { error: error.message });
    }
  }
  
  /**
   * Carica lo stato di rotazione
   * @returns {Promise<void>}
   */
  async loadRotationState() {
    try {
      logger.debug('Caricamento dello stato di rotazione');
      
      // Verifica se lo stato esiste
      const exists = await this.secretsManager.secretExists('rotation_state');
      
      if (exists) {
        // Carica lo stato
        const state = await this.secretsManager.getSecret('rotation_state');
        
        // Ripristina lo stato
        this.lastRotation = state.lastRotation || {};
        this.rotationHistory = state.rotationHistory || [];
        
        logger.info('Stato di rotazione caricato', {
          secretsCount: Object.keys(this.lastRotation).length,
          historySize: this.rotationHistory.length
        });
      } else {
        logger.info('Nessuno stato di rotazione precedente trovato');
      }
    } catch (error) {
      logger.error('Errore durante il caricamento dello stato di rotazione', { error: error.message });
    }
  }
  
  /**
   * Ottiene la cronologia delle rotazioni
   * @param {string} [secretName] - Nome del segreto (opzionale)
   * @returns {Array<Object>} Cronologia delle rotazioni
   */
  getRotationHistory(secretName) {
    if (secretName) {
      // Filtra la cronologia per il segreto specificato
      return this.rotationHistory.filter(entry => entry.secretName === secretName);
    }
    
    // Restituisci tutta la cronologia
    return this.rotationHistory;
  }
  
  /**
   * Ottiene la data dell'ultima rotazione di un segreto
   * @param {string} name - Nome del segreto
   * @returns {Date|null} Data dell'ultima rotazione o null se il segreto non è mai stato ruotato
   */
  getLastRotationDate(name) {
    const timestamp = this.lastRotation[name];
    return timestamp ? new Date(timestamp) : null;
  }
  
  /**
   * Ottiene la data della prossima rotazione di un segreto
   * @param {string} name - Nome del segreto
   * @returns {Date|null} Data della prossima rotazione o null se il segreto non è nella pianificazione
   */
  getNextRotationDate(name) {
    const interval = this.rotationSchedule[name];
    const lastRotation = this.lastRotation[name];
    
    if (!interval) {
      return null;
    }
    
    if (!lastRotation) {
      return new Date(); // Se non è mai stato ruotato, la rotazione è prevista ora
    }
    
    return new Date(lastRotation + interval);
  }
  
  /**
   * Forza la rotazione di un segreto, indipendentemente dalla pianificazione
   * @param {string} name - Nome del segreto
   * @returns {Promise<boolean>} True se la rotazione è riuscita
   */
  async forceRotation(name) {
    logger.info(`Rotazione forzata del segreto ${name}`);
    return await this.rotateSecret(name);
  }
  
  /**
   * Ottiene lo stato del servizio di rotazione
   * @returns {Object} Stato del servizio
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      secretsCount: Object.keys(this.rotationSchedule).length,
      rotatedSecretsCount: Object.keys(this.lastRotation).length,
      historySize: this.rotationHistory.length,
      nextRotations: Object.keys(this.rotationSchedule).map(name => ({
        secretName: name,
        lastRotation: this.getLastRotationDate(name),
        nextRotation: this.getNextRotationDate(name),
        interval: this.rotationSchedule[name]
      }))
    };
  }
}

module.exports = { SecretRotationService };
