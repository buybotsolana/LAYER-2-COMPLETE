/**
 * @fileoverview Implementazione del gestore del periodo di grazia per i segreti
 * 
 * Questo modulo implementa un gestore del periodo di grazia per i segreti
 * che permette di mantenere validi i vecchi segreti per un periodo di tempo
 * configurabile dopo la rotazione, facilitando la transizione senza interruzioni.
 */

const { Logger } = require('../logger');

// Configurazione del logger
const logger = new Logger('grace-period-manager');

/**
 * Classe GracePeriodManager
 * 
 * Implementa un gestore del periodo di grazia per i segreti che permette
 * di mantenere validi i vecchi segreti per un periodo di tempo configurabile.
 */
class GracePeriodManager {
  /**
   * Crea una nuova istanza di GracePeriodManager
   * @param {Object} config - Configurazione per il gestore del periodo di grazia
   * @param {number} config.gracePeriod - Periodo di grazia in millisecondi (default: 24 ore)
   * @param {number} config.cleanupInterval - Intervallo di pulizia in millisecondi (default: 1 ora)
   * @param {number} config.maxOldSecrets - Numero massimo di vecchi segreti per chiave (default: 5)
   */
  constructor(config = {}) {
    this.gracePeriod = config.gracePeriod || 24 * 60 * 60 * 1000; // 24 ore di default
    this.cleanupInterval = config.cleanupInterval || 60 * 60 * 1000; // 1 ora di default
    this.maxOldSecrets = config.maxOldSecrets || 5;
    this.oldSecrets = new Map();
    this.currentSecrets = new Map();
    this.cleanupTimer = null;
    
    logger.info('GracePeriodManager inizializzato', {
      gracePeriod: this.gracePeriod,
      cleanupInterval: this.cleanupInterval,
      maxOldSecrets: this.maxOldSecrets
    });
  }
  
  /**
   * Avvia il gestore del periodo di grazia
   */
  start() {
    if (this.cleanupTimer) {
      logger.warn('Il gestore del periodo di grazia è già avviato');
      return;
    }
    
    logger.info('Avvio del gestore del periodo di grazia');
    
    // Imposta il timer per la pulizia periodica
    this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupInterval);
  }
  
  /**
   * Ferma il gestore del periodo di grazia
   */
  stop() {
    if (!this.cleanupTimer) {
      logger.warn('Il gestore del periodo di grazia non è avviato');
      return;
    }
    
    logger.info('Arresto del gestore del periodo di grazia');
    
    // Ferma il timer di pulizia
    clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }
  
  /**
   * Imposta un segreto corrente
   * @param {string} name - Nome del segreto
   * @param {string|Object} value - Valore del segreto
   */
  setCurrentSecret(name, value) {
    logger.debug(`Impostazione del segreto corrente: ${name}`);
    
    // Se esiste già un segreto corrente, spostalo nei vecchi segreti
    if (this.currentSecrets.has(name)) {
      this.addOldSecret(name, this.currentSecrets.get(name));
    }
    
    // Imposta il nuovo segreto corrente
    this.currentSecrets.set(name, value);
  }
  
  /**
   * Aggiunge un vecchio segreto
   * @param {string} name - Nome del segreto
   * @param {string|Object} value - Valore del segreto
   */
  addOldSecret(name, value) {
    logger.debug(`Aggiunta di un vecchio segreto: ${name}`);
    
    // Crea l'entry per il vecchio segreto
    const oldSecret = {
      value,
      expiry: Date.now() + this.gracePeriod
    };
    
    // Ottieni la lista dei vecchi segreti per questo nome
    if (!this.oldSecrets.has(name)) {
      this.oldSecrets.set(name, []);
    }
    
    const oldSecretsList = this.oldSecrets.get(name);
    
    // Aggiungi il nuovo vecchio segreto
    oldSecretsList.push(oldSecret);
    
    // Limita il numero di vecchi segreti
    if (oldSecretsList.length > this.maxOldSecrets) {
      oldSecretsList.shift();
    }
  }
  
  /**
   * Verifica se un valore corrisponde a un segreto valido
   * @param {string} name - Nome del segreto
   * @param {string|Object} value - Valore da verificare
   * @returns {boolean} True se il valore corrisponde a un segreto valido
   */
  isValidSecret(name, value) {
    // Controlla se corrisponde al segreto corrente
    if (this.currentSecrets.has(name)) {
      const currentValue = this.currentSecrets.get(name);
      
      if (this.areValuesEqual(currentValue, value)) {
        logger.debug(`Valore corrispondente al segreto corrente: ${name}`);
        return true;
      }
    }
    
    // Controlla se corrisponde a un vecchio segreto ancora valido
    if (this.oldSecrets.has(name)) {
      const oldSecretsList = this.oldSecrets.get(name);
      const now = Date.now();
      
      for (const oldSecret of oldSecretsList) {
        if (oldSecret.expiry > now && this.areValuesEqual(oldSecret.value, value)) {
          logger.debug(`Valore corrispondente a un vecchio segreto valido: ${name}`);
          return true;
        }
      }
    }
    
    logger.debug(`Valore non corrispondente a nessun segreto valido: ${name}`);
    return false;
  }
  
  /**
   * Confronta due valori per verificare se sono uguali
   * @param {string|Object} value1 - Primo valore
   * @param {string|Object} value2 - Secondo valore
   * @returns {boolean} True se i valori sono uguali
   * @private
   */
  areValuesEqual(value1, value2) {
    // Se entrambi sono oggetti, confronta le loro rappresentazioni JSON
    if (typeof value1 === 'object' && value1 !== null &&
        typeof value2 === 'object' && value2 !== null) {
      return JSON.stringify(value1) === JSON.stringify(value2);
    }
    
    // Altrimenti, confronta direttamente i valori
    return value1 === value2;
  }
  
  /**
   * Pulisce i vecchi segreti scaduti
   */
  cleanup() {
    logger.debug('Pulizia dei vecchi segreti scaduti');
    
    const now = Date.now();
    let removedCount = 0;
    
    // Per ogni nome di segreto
    for (const [name, oldSecretsList] of this.oldSecrets.entries()) {
      // Filtra i segreti non scaduti
      const validSecrets = oldSecretsList.filter(secret => secret.expiry > now);
      
      // Calcola quanti segreti sono stati rimossi
      removedCount += oldSecretsList.length - validSecrets.length;
      
      // Aggiorna la lista o rimuovi l'entry se non ci sono più segreti validi
      if (validSecrets.length > 0) {
        this.oldSecrets.set(name, validSecrets);
      } else {
        this.oldSecrets.delete(name);
      }
    }
    
    if (removedCount > 0) {
      logger.info(`Pulizia completata: ${removedCount} vecchi segreti scaduti rimossi`);
    }
  }
  
  /**
   * Ottiene tutti i segreti validi per un nome
   * @param {string} name - Nome del segreto
   * @returns {Array<Object>} Lista dei segreti validi
   */
  getAllValidSecrets(name) {
    const result = [];
    const now = Date.now();
    
    // Aggiungi il segreto corrente se esiste
    if (this.currentSecrets.has(name)) {
      result.push({
        value: this.currentSecrets.get(name),
        isCurrent: true,
        expiry: null
      });
    }
    
    // Aggiungi i vecchi segreti validi
    if (this.oldSecrets.has(name)) {
      const oldSecretsList = this.oldSecrets.get(name);
      
      for (const oldSecret of oldSecretsList) {
        if (oldSecret.expiry > now) {
          result.push({
            value: oldSecret.value,
            isCurrent: false,
            expiry: new Date(oldSecret.expiry)
          });
        }
      }
    }
    
    return result;
  }
  
  /**
   * Invalida tutti i vecchi segreti per un nome
   * @param {string} name - Nome del segreto
   */
  invalidateOldSecrets(name) {
    logger.info(`Invalidazione di tutti i vecchi segreti per: ${name}`);
    
    // Rimuovi tutti i vecchi segreti per questo nome
    this.oldSecrets.delete(name);
  }
  
  /**
   * Invalida tutti i vecchi segreti
   */
  invalidateAllOldSecrets() {
    logger.info('Invalidazione di tutti i vecchi segreti');
    
    // Rimuovi tutti i vecchi segreti
    this.oldSecrets.clear();
  }
  
  /**
   * Ottiene statistiche sul gestore del periodo di grazia
   * @returns {Object} Statistiche
   */
  getStats() {
    let totalOldSecrets = 0;
    let expiredCount = 0;
    const now = Date.now();
    
    // Conta i vecchi segreti e quelli scaduti
    for (const oldSecretsList of this.oldSecrets.values()) {
      totalOldSecrets += oldSecretsList.length;
      
      for (const oldSecret of oldSecretsList) {
        if (oldSecret.expiry <= now) {
          expiredCount++;
        }
      }
    }
    
    return {
      currentSecretsCount: this.currentSecrets.size,
      oldSecretsCount: totalOldSecrets,
      expiredSecretsCount: expiredCount,
      uniqueSecretNamesCount: new Set([
        ...this.currentSecrets.keys(),
        ...this.oldSecrets.keys()
      ]).size,
      gracePeriod: this.gracePeriod,
      cleanupInterval: this.cleanupInterval,
      maxOldSecrets: this.maxOldSecrets,
      isRunning: !!this.cleanupTimer
    };
  }
  
  /**
   * Modifica il periodo di grazia
   * @param {number} gracePeriod - Nuovo periodo di grazia in millisecondi
   */
  setGracePeriod(gracePeriod) {
    logger.info(`Modifica del periodo di grazia: ${gracePeriod}ms`);
    this.gracePeriod = gracePeriod;
  }
  
  /**
   * Modifica l'intervallo di pulizia
   * @param {number} cleanupInterval - Nuovo intervallo di pulizia in millisecondi
   */
  setCleanupInterval(cleanupInterval) {
    logger.info(`Modifica dell'intervallo di pulizia: ${cleanupInterval}ms`);
    
    this.cleanupInterval = cleanupInterval;
    
    // Aggiorna il timer se è in esecuzione
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupInterval);
    }
  }
  
  /**
   * Modifica il numero massimo di vecchi segreti per chiave
   * @param {number} maxOldSecrets - Nuovo numero massimo di vecchi segreti
   */
  setMaxOldSecrets(maxOldSecrets) {
    logger.info(`Modifica del numero massimo di vecchi segreti: ${maxOldSecrets}`);
    
    this.maxOldSecrets = maxOldSecrets;
    
    // Applica il nuovo limite a tutte le liste esistenti
    for (const [name, oldSecretsList] of this.oldSecrets.entries()) {
      if (oldSecretsList.length > this.maxOldSecrets) {
        this.oldSecrets.set(name, oldSecretsList.slice(-this.maxOldSecrets));
      }
    }
  }
}

module.exports = { GracePeriodManager };
