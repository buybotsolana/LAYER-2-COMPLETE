/**
 * @fileoverview Implementazione del gestore dei segreti
 * 
 * Questo modulo implementa un gestore dei segreti che integra AWS Secrets Manager
 * e HashiCorp Vault per la gestione sicura delle credenziali e delle chiavi.
 */

const AWS = require('aws-sdk');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { Logger } = require('../logger');

// Configurazione del logger
const logger = new Logger('secrets-manager');

/**
 * Classe SecretsManager
 * 
 * Implementa un gestore dei segreti che integra AWS Secrets Manager
 * e HashiCorp Vault per la gestione sicura delle credenziali e delle chiavi.
 */
class SecretsManager {
  /**
   * Crea una nuova istanza di SecretsManager
   * @param {Object} config - Configurazione per il gestore dei segreti
   * @param {string} config.provider - Provider da utilizzare ('aws' o 'vault')
   * @param {Object} config.aws - Configurazione per AWS Secrets Manager
   * @param {Object} config.vault - Configurazione per HashiCorp Vault
   */
  constructor(config) {
    this.config = config;
    this.provider = config.provider || 'aws';
    
    if (this.provider === 'aws') {
      // Inizializza il client AWS Secrets Manager
      this.client = new AWSSecretsManagerClient(config.aws);
    } else if (this.provider === 'vault') {
      // Inizializza il client HashiCorp Vault
      this.client = new VaultClient(config.vault);
    } else {
      throw new Error(`Provider non supportato: ${this.provider}`);
    }
    
    logger.info(`SecretsManager inizializzato con provider: ${this.provider}`);
  }
  
  /**
   * Ottiene un segreto
   * @param {string} name - Nome del segreto
   * @returns {Promise<string|Object>} Valore del segreto
   */
  async getSecret(name) {
    try {
      logger.debug(`Ottenimento segreto: ${name}`);
      return await this.client.getSecret(name);
    } catch (error) {
      logger.error(`Errore durante l'ottenimento del segreto ${name}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Imposta un segreto
   * @param {string} name - Nome del segreto
   * @param {string|Object} value - Valore del segreto
   * @returns {Promise<boolean>} True se l'operazione è riuscita
   */
  async setSecret(name, value) {
    try {
      logger.debug(`Impostazione segreto: ${name}`);
      return await this.client.setSecret(name, value);
    } catch (error) {
      logger.error(`Errore durante l'impostazione del segreto ${name}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Elimina un segreto
   * @param {string} name - Nome del segreto
   * @returns {Promise<boolean>} True se l'operazione è riuscita
   */
  async deleteSecret(name) {
    try {
      logger.debug(`Eliminazione segreto: ${name}`);
      return await this.client.deleteSecret(name);
    } catch (error) {
      logger.error(`Errore durante l'eliminazione del segreto ${name}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Ruota un segreto
   * @param {string} name - Nome del segreto
   * @returns {Promise<string|Object>} Nuovo valore del segreto
   */
  async rotateSecret(name) {
    try {
      logger.info(`Rotazione segreto: ${name}`);
      
      // Genera un nuovo valore per il segreto
      const newValue = this.generateSecretValue();
      
      // Imposta il nuovo valore
      await this.setSecret(name, newValue);
      
      logger.info(`Segreto ${name} ruotato con successo`);
      
      return newValue;
    } catch (error) {
      logger.error(`Errore durante la rotazione del segreto ${name}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Genera un valore casuale per un segreto
   * @returns {string} Valore generato
   */
  generateSecretValue() {
    // Genera un valore casuale di 32 byte e lo converte in base64
    return crypto.randomBytes(32).toString('base64');
  }
  
  /**
   * Elenca i segreti disponibili
   * @returns {Promise<Array<string>>} Lista dei nomi dei segreti
   */
  async listSecrets() {
    try {
      logger.debug('Elenco segreti');
      return await this.client.listSecrets();
    } catch (error) {
      logger.error(`Errore durante l'elenco dei segreti: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Verifica se un segreto esiste
   * @param {string} name - Nome del segreto
   * @returns {Promise<boolean>} True se il segreto esiste
   */
  async secretExists(name) {
    try {
      logger.debug(`Verifica esistenza segreto: ${name}`);
      return await this.client.secretExists(name);
    } catch (error) {
      logger.error(`Errore durante la verifica dell'esistenza del segreto ${name}: ${error.message}`);
      return false;
    }
  }
}

/**
 * Classe AWSSecretsManagerClient
 * 
 * Implementa un client per AWS Secrets Manager.
 */
class AWSSecretsManagerClient {
  /**
   * Crea una nuova istanza di AWSSecretsManagerClient
   * @param {Object} config - Configurazione per AWS Secrets Manager
   * @param {string} config.region - Regione AWS
   * @param {string} config.accessKeyId - ID della chiave di accesso
   * @param {string} config.secretAccessKey - Chiave di accesso segreta
   */
  constructor(config) {
    this.config = config;
    
    // Configura il client AWS
    const awsConfig = {
      region: config.region || 'us-east-1'
    };
    
    // Aggiungi le credenziali se fornite
    if (config.accessKeyId && config.secretAccessKey) {
      awsConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      };
    }
    
    // Crea il client AWS Secrets Manager
    this.secretsManager = new AWS.SecretsManager(awsConfig);
    
    logger.info(`AWSSecretsManagerClient inizializzato per la regione ${awsConfig.region}`);
  }
  
  /**
   * Ottiene un segreto
   * @param {string} name - Nome del segreto
   * @returns {Promise<string|Object>} Valore del segreto
   */
  async getSecret(name) {
    try {
      // Ottieni il segreto da AWS Secrets Manager
      const data = await this.secretsManager.getSecretValue({ SecretId: name }).promise();
      
      // Estrai il valore del segreto
      let secretValue;
      if ('SecretString' in data) {
        secretValue = data.SecretString;
      } else {
        // Se il segreto è binario, decodificalo
        const buff = Buffer.from(data.SecretBinary, 'base64');
        secretValue = buff.toString('utf8');
      }
      
      // Se il segreto è in formato JSON, parsalo
      try {
        return JSON.parse(secretValue);
      } catch (e) {
        // Se non è JSON, restituisci la stringa
        return secretValue;
      }
    } catch (error) {
      logger.error(`Errore durante l'ottenimento del segreto ${name} da AWS: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Imposta un segreto
   * @param {string} name - Nome del segreto
   * @param {string|Object} value - Valore del segreto
   * @returns {Promise<boolean>} True se l'operazione è riuscita
   */
  async setSecret(name, value) {
    try {
      // Converti il valore in stringa se è un oggetto
      const secretValue = typeof value === 'object' ? JSON.stringify(value) : value;
      
      // Verifica se il segreto esiste già
      const exists = await this.secretExists(name);
      
      if (exists) {
        // Aggiorna il segreto esistente
        await this.secretsManager.updateSecret({
          SecretId: name,
          SecretString: secretValue
        }).promise();
      } else {
        // Crea un nuovo segreto
        await this.secretsManager.createSecret({
          Name: name,
          SecretString: secretValue
        }).promise();
      }
      
      return true;
    } catch (error) {
      logger.error(`Errore durante l'impostazione del segreto ${name} su AWS: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Elimina un segreto
   * @param {string} name - Nome del segreto
   * @returns {Promise<boolean>} True se l'operazione è riuscita
   */
  async deleteSecret(name) {
    try {
      // Elimina il segreto da AWS Secrets Manager
      await this.secretsManager.deleteSecret({
        SecretId: name,
        RecoveryWindowInDays: 7 // Finestra di recupero di 7 giorni
      }).promise();
      
      return true;
    } catch (error) {
      logger.error(`Errore durante l'eliminazione del segreto ${name} da AWS: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Elenca i segreti disponibili
   * @returns {Promise<Array<string>>} Lista dei nomi dei segreti
   */
  async listSecrets() {
    try {
      // Ottieni la lista dei segreti da AWS Secrets Manager
      const data = await this.secretsManager.listSecrets().promise();
      
      // Estrai i nomi dei segreti
      return data.SecretList.map(secret => secret.Name);
    } catch (error) {
      logger.error(`Errore durante l'elenco dei segreti da AWS: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Verifica se un segreto esiste
   * @param {string} name - Nome del segreto
   * @returns {Promise<boolean>} True se il segreto esiste
   */
  async secretExists(name) {
    try {
      // Prova a ottenere il segreto
      await this.secretsManager.describeSecret({ SecretId: name }).promise();
      return true;
    } catch (error) {
      // Se l'errore è ResourceNotFoundException, il segreto non esiste
      if (error.code === 'ResourceNotFoundException') {
        return false;
      }
      
      // Altrimenti, c'è stato un altro errore
      logger.error(`Errore durante la verifica dell'esistenza del segreto ${name} su AWS: ${error.message}`);
      throw error;
    }
  }
}

/**
 * Classe VaultClient
 * 
 * Implementa un client per HashiCorp Vault.
 */
class VaultClient {
  /**
   * Crea una nuova istanza di VaultClient
   * @param {Object} config - Configurazione per HashiCorp Vault
   * @param {string} config.url - URL del server Vault
   * @param {string} config.token - Token di autenticazione
   * @param {string} config.namespace - Namespace (per Vault Enterprise)
   * @param {string} config.mount - Mount point per i segreti (default: 'secret')
   */
  constructor(config) {
    this.config = config;
    this.url = config.url;
    this.token = config.token;
    this.namespace = config.namespace;
    this.mount = config.mount || 'secret';
    
    // Crea il client HTTP
    this.client = axios.create({
      baseURL: this.url,
      headers: {
        'X-Vault-Token': this.token
      }
    });
    
    // Aggiungi l'header del namespace se specificato
    if (this.namespace) {
      this.client.defaults.headers['X-Vault-Namespace'] = this.namespace;
    }
    
    logger.info(`VaultClient inizializzato per ${this.url}`);
  }
  
  /**
   * Ottiene un segreto
   * @param {string} name - Nome del segreto
   * @returns {Promise<string|Object>} Valore del segreto
   */
  async getSecret(name) {
    try {
      // Ottieni il segreto da Vault
      const response = await this.client.get(`/v1/${this.mount}/data/${name}`);
      
      // Estrai il valore del segreto
      return response.data.data.data;
    } catch (error) {
      logger.error(`Errore durante l'ottenimento del segreto ${name} da Vault: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Imposta un segreto
   * @param {string} name - Nome del segreto
   * @param {string|Object} value - Valore del segreto
   * @returns {Promise<boolean>} True se l'operazione è riuscita
   */
  async setSecret(name, value) {
    try {
      // Imposta il segreto su Vault
      await this.client.post(`/v1/${this.mount}/data/${name}`, {
        data: typeof value === 'object' ? value : { value }
      });
      
      return true;
    } catch (error) {
      logger.error(`Errore durante l'impostazione del segreto ${name} su Vault: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Elimina un segreto
   * @param {string} name - Nome del segreto
   * @returns {Promise<boolean>} True se l'operazione è riuscita
   */
  async deleteSecret(name) {
    try {
      // Elimina il segreto da Vault
      await this.client.delete(`/v1/${this.mount}/data/${name}`);
      
      return true;
    } catch (error) {
      logger.error(`Errore durante l'eliminazione del segreto ${name} da Vault: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Elenca i segreti disponibili
   * @returns {Promise<Array<string>>} Lista dei nomi dei segreti
   */
  async listSecrets() {
    try {
      // Ottieni la lista dei segreti da Vault
      const response = await this.client.get(`/v1/${this.mount}/metadata?list=true`);
      
      // Estrai i nomi dei segreti
      return response.data.data.keys;
    } catch (error) {
      logger.error(`Errore durante l'elenco dei segreti da Vault: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Verifica se un segreto esiste
   * @param {string} name - Nome del segreto
   * @returns {Promise<boolean>} True se il segreto esiste
   */
  async secretExists(name) {
    try {
      // Prova a ottenere i metadati del segreto
      await this.client.get(`/v1/${this.mount}/metadata/${name}`);
      return true;
    } catch (error) {
      // Se lo status è 404, il segreto non esiste
      if (error.response && error.response.status === 404) {
        return false;
      }
      
      // Altrimenti, c'è stato un altro errore
      logger.error(`Errore durante la verifica dell'esistenza del segreto ${name} su Vault: ${error.message}`);
      throw error;
    }
  }
}

module.exports = { SecretsManager, AWSSecretsManagerClient, VaultClient };
