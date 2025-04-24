/**
 * @fileoverview Implementazione di un sistema di caching sicuro per i segreti
 * 
 * Questo modulo implementa un sistema di caching sicuro per i segreti che
 * permette di memorizzare temporaneamente i segreti in memoria per migliorare
 * le performance, con meccanismi di sicurezza per proteggere i dati sensibili.
 */

const crypto = require('crypto');
const { Logger } = require('../logger');
const { SecretsManager } = require('./secrets_manager');

// Configurazione del logger
const logger = new Logger('secret-cache');

/**
 * Classe SecretCache
 * 
 * Implementa un sistema di caching sicuro per i segreti con TTL configurabile
 * e meccanismi di sicurezza per proteggere i dati sensibili.
 */
class SecretCache {
  /**
   * Crea una nuova istanza di SecretCache
   * @param {SecretsManager} secretsManager - Istanza di SecretsManager
   * @param {Object} config - Configurazione per il cache
   * @param {number} config.ttl - Time-to-live in millisecondi (default: 3600000 = 1 ora)
   * @param {number} config.maxSize - Dimensione massima della cache (default: 100)
   * @param {boolean} config.encryptInMemory - Se crittografare i segreti in memoria (default: true)
   * @param {string} config.encryptionKey - Chiave per la crittografia in memoria (generata se non fornita)
   */
  constructor(secretsManager, config = {}) {
    this.secretsManager = secretsManager;
    this.ttl = config.ttl || 3600000; // 1 ora di default
    this.maxSize = config.maxSize || 100;
    this.encryptInMemory = config.encryptInMemory !== false; // true di default
    
    // Genera o usa la chiave di crittografia fornita
    this.encryptionKey = config.encryptionKey || 
      crypto.randomBytes(32).toString('hex');
    
    // Inizializza la cache
    this.cache = new Map();
    this.accessOrder = []; // Per implementare LRU (Least Recently Used)
    
    // Inizializza il timer per la pulizia periodica
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // Ogni minuto
    
    logger.info(`SecretCache inizializzato (TTL: ${this.ttl}ms, maxSize: ${this.maxSize}, encrypt: ${this.encryptInMemory})`);
  }
  
  /**
   * Ottiene un segreto, dalla cache se disponibile o dal gestore dei segreti
   * @param {string} name - Nome del segreto
   * @returns {Promise<string|Object>} Valore del segreto
   */
  async getSecret(name) {
    try {
      // Verifica se il segreto è nella cache e non è scaduto
      const cached = this.cache.get(name);
      if (cached && Date.now() - cached.timestamp < this.ttl) {
        logger.debug(`Cache hit per il segreto: ${name}`);
        
        // Aggiorna l'ordine di accesso (LRU)
        this._updateAccessOrder(name);
        
        // Decrittografa il valore se necessario
        return this.encryptInMemory ? 
          this._decrypt(cached.value) : cached.value;
      }
      
      logger.debug(`Cache miss per il segreto: ${name}`);
      
      // Ottieni il segreto dal gestore dei segreti
      const value = await this.secretsManager.getSecret(name);
      
      // Memorizza il segreto nella cache
      this._cacheSecret(name, value);
      
      return value;
    } catch (error) {
      logger.error(`Errore durante l'ottenimento del segreto ${name}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Imposta un segreto nel gestore dei segreti e aggiorna la cache
   * @param {string} name - Nome del segreto
   * @param {string|Object} value - Valore del segreto
   * @returns {Promise<boolean>} True se l'operazione è riuscita
   */
  async setSecret(name, value) {
    try {
      // Imposta il segreto nel gestore dei segreti
      await this.secretsManager.setSecret(name, value);
      
      // Aggiorna la cache
      this._cacheSecret(name, value);
      
      return true;
    } catch (error) {
      logger.error(`Errore durante l'impostazione del segreto ${name}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Elimina un segreto dal gestore dei segreti e dalla cache
   * @param {string} name - Nome del segreto
   * @returns {Promise<boolean>} True se l'operazione è riuscita
   */
  async deleteSecret(name) {
    try {
      // Elimina il segreto dal gestore dei segreti
      await this.secretsManager.deleteSecret(name);
      
      // Rimuovi il segreto dalla cache
      this.cache.delete(name);
      this.accessOrder = this.accessOrder.filter(item => item !== name);
      
      logger.debug(`Segreto ${name} eliminato dalla cache`);
      
      return true;
    } catch (error) {
      logger.error(`Errore durante l'eliminazione del segreto ${name}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Ruota un segreto nel gestore dei segreti e aggiorna la cache
   * @param {string} name - Nome del segreto
   * @returns {Promise<string|Object>} Nuovo valore del segreto
   */
  async rotateSecret(name) {
    try {
      // Ruota il segreto nel gestore dei segreti
      const newValue = await this.secretsManager.rotateSecret(name);
      
      // Aggiorna la cache
      this._cacheSecret(name, newValue);
      
      return newValue;
    } catch (error) {
      logger.error(`Errore durante la rotazione del segreto ${name}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Invalida un segreto nella cache
   * @param {string} name - Nome del segreto
   */
  invalidate(name) {
    if (this.cache.has(name)) {
      this.cache.delete(name);
      this.accessOrder = this.accessOrder.filter(item => item !== name);
      logger.debug(`Segreto ${name} invalidato nella cache`);
    }
  }
  
  /**
   * Invalida tutti i segreti nella cache
   */
  invalidateAll() {
    this.cache.clear();
    this.accessOrder = [];
    logger.info('Cache dei segreti completamente invalidata');
  }
  
  /**
   * Pulisce i segreti scaduti dalla cache
   */
  cleanup() {
    const now = Date.now();
    let expiredCount = 0;
    
    // Rimuovi i segreti scaduti
    for (const [name, cached] of this.cache.entries()) {
      if (now - cached.timestamp >= this.ttl) {
        this.cache.delete(name);
        expiredCount++;
      }
    }
    
    // Aggiorna l'ordine di accesso
    this.accessOrder = this.accessOrder.filter(name => this.cache.has(name));
    
    if (expiredCount > 0) {
      logger.debug(`Pulizia cache: ${expiredCount} segreti scaduti rimossi`);
    }
  }
  
  /**
   * Memorizza un segreto nella cache
   * @param {string} name - Nome del segreto
   * @param {string|Object} value - Valore del segreto
   * @private
   */
  _cacheSecret(name, value) {
    // Crittografa il valore se necessario
    const cachedValue = this.encryptInMemory ? 
      this._encrypt(value) : value;
    
    // Memorizza il segreto nella cache
    this.cache.set(name, {
      value: cachedValue,
      timestamp: Date.now()
    });
    
    // Aggiorna l'ordine di accesso (LRU)
    this._updateAccessOrder(name);
    
    // Se la cache ha superato la dimensione massima, rimuovi il segreto meno recentemente usato
    if (this.cache.size > this.maxSize) {
      const oldest = this.accessOrder[0];
      this.cache.delete(oldest);
      this.accessOrder.shift();
      logger.debug(`Cache piena: rimosso il segreto meno recentemente usato (${oldest})`);
    }
    
    logger.debug(`Segreto ${name} memorizzato nella cache`);
  }
  
  /**
   * Aggiorna l'ordine di accesso per l'algoritmo LRU
   * @param {string} name - Nome del segreto
   * @private
   */
  _updateAccessOrder(name) {
    // Rimuovi il nome dall'ordine di accesso se presente
    this.accessOrder = this.accessOrder.filter(item => item !== name);
    
    // Aggiungi il nome alla fine dell'ordine di accesso
    this.accessOrder.push(name);
  }
  
  /**
   * Crittografa un valore
   * @param {string|Object} value - Valore da crittografare
   * @returns {string} Valore crittografato
   * @private
   */
  _encrypt(value) {
    try {
      // Converti il valore in stringa se è un oggetto
      const valueStr = typeof value === 'object' ? 
        JSON.stringify(value) : String(value);
      
      // Genera un IV casuale
      const iv = crypto.randomBytes(16);
      
      // Crea la chiave derivata dalla chiave di crittografia
      const key = crypto.createHash('sha256')
        .update(this.encryptionKey)
        .digest();
      
      // Crea il cifrario
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      
      // Crittografa il valore
      let encrypted = cipher.update(valueStr, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      
      // Restituisci il valore crittografato con l'IV
      return `${iv.toString('hex')}:${encrypted}`;
    } catch (error) {
      logger.error(`Errore durante la crittografia: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Decrittografa un valore
   * @param {string} encryptedValue - Valore crittografato
   * @returns {string|Object} Valore decrittografato
   * @private
   */
  _decrypt(encryptedValue) {
    try {
      // Estrai l'IV e il valore crittografato
      const [ivHex, encrypted] = encryptedValue.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      
      // Crea la chiave derivata dalla chiave di crittografia
      const key = crypto.createHash('sha256')
        .update(this.encryptionKey)
        .digest();
      
      // Crea il decifrario
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      
      // Decrittografa il valore
      let decrypted = decipher.update(encrypted, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      
      // Se il valore è in formato JSON, parsalo
      try {
        return JSON.parse(decrypted);
      } catch (e) {
        // Se non è JSON, restituisci la stringa
        return decrypted;
      }
    } catch (error) {
      logger.error(`Errore durante la decrittografia: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Ferma il timer di pulizia
   */
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
  
  /**
   * Ottiene statistiche sulla cache
   * @returns {Object} Statistiche sulla cache
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl,
      encryptInMemory: this.encryptInMemory,
      oldestTimestamp: this.accessOrder.length > 0 ? 
        this.cache.get(this.accessOrder[0]).timestamp : null,
      newestTimestamp: this.accessOrder.length > 0 ? 
        this.cache.get(this.accessOrder[this.accessOrder.length - 1]).timestamp : null
    };
  }
}

module.exports = { SecretCache };
