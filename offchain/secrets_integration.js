/**
 * @fileoverview Integrazione del sistema di gestione dei segreti nel codice esistente
 * 
 * Questo modulo fornisce funzioni di utilità per integrare il sistema di gestione
 * dei segreti nel codice esistente, sostituendo i riferimenti diretti a variabili
 * d'ambiente con chiamate al gestore dei segreti.
 */

const { SecretsManager } = require('./secrets/secrets_manager');
const { SecretCache } = require('./secrets/secret_cache');
const { Logger } = require('./logger');

// Configurazione del logger
const logger = new Logger('secrets-integration');

// Istanza singleton del gestore dei segreti
let secretsManagerInstance = null;

// Istanza singleton della cache dei segreti
let secretCacheInstance = null;

/**
 * Inizializza il sistema di gestione dei segreti
 * @param {Object} config - Configurazione per il gestore dei segreti
 * @returns {Object} Istanze del gestore dei segreti e della cache
 */
function initializeSecretsSystem(config = {}) {
  try {
    logger.info('Inizializzazione del sistema di gestione dei segreti');
    
    // Configura il provider in base all'ambiente
    const provider = config.provider || process.env.SECRETS_PROVIDER || 'aws';
    
    // Crea la configurazione per il gestore dei segreti
    const secretsManagerConfig = {
      provider,
      aws: {
        region: config.awsRegion || process.env.AWS_REGION || 'us-east-1',
        accessKeyId: config.awsAccessKeyId || process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.awsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY
      },
      vault: {
        url: config.vaultUrl || process.env.VAULT_ADDR || 'http://localhost:8200',
        token: config.vaultToken || process.env.VAULT_TOKEN,
        namespace: config.vaultNamespace || process.env.VAULT_NAMESPACE,
        mount: config.vaultMount || process.env.VAULT_MOUNT || 'secret'
      }
    };
    
    // Crea l'istanza del gestore dei segreti
    secretsManagerInstance = new SecretsManager(secretsManagerConfig);
    
    // Crea la configurazione per la cache dei segreti
    const secretCacheConfig = {
      ttl: config.cacheTtl || parseInt(process.env.SECRETS_CACHE_TTL || '3600000'),
      maxSize: config.cacheMaxSize || parseInt(process.env.SECRETS_CACHE_MAX_SIZE || '100'),
      encryptInMemory: config.encryptInMemory !== false && 
        process.env.SECRETS_ENCRYPT_IN_MEMORY !== 'false',
      encryptionKey: config.encryptionKey || process.env.SECRETS_ENCRYPTION_KEY
    };
    
    // Crea l'istanza della cache dei segreti
    secretCacheInstance = new SecretCache(secretsManagerInstance, secretCacheConfig);
    
    logger.info(`Sistema di gestione dei segreti inizializzato con provider: ${provider}`);
    
    return {
      secretsManager: secretsManagerInstance,
      secretCache: secretCacheInstance
    };
  } catch (error) {
    logger.error(`Errore durante l'inizializzazione del sistema di gestione dei segreti: ${error.message}`);
    throw error;
  }
}

/**
 * Ottiene l'istanza del gestore dei segreti
 * @returns {SecretsManager} Istanza del gestore dei segreti
 */
function getSecretsManager() {
  if (!secretsManagerInstance) {
    throw new Error('Il sistema di gestione dei segreti non è stato inizializzato');
  }
  
  return secretsManagerInstance;
}

/**
 * Ottiene l'istanza della cache dei segreti
 * @returns {SecretCache} Istanza della cache dei segreti
 */
function getSecretCache() {
  if (!secretCacheInstance) {
    throw new Error('Il sistema di gestione dei segreti non è stato inizializzato');
  }
  
  return secretCacheInstance;
}

/**
 * Ottiene un segreto dalla cache o dal gestore dei segreti
 * @param {string} name - Nome del segreto
 * @returns {Promise<string|Object>} Valore del segreto
 */
async function getSecret(name) {
  if (!secretCacheInstance) {
    throw new Error('Il sistema di gestione dei segreti non è stato inizializzato');
  }
  
  return secretCacheInstance.getSecret(name);
}

/**
 * Sostituisce le variabili d'ambiente con segreti
 * @param {Object} config - Configurazione con variabili d'ambiente
 * @param {Object} secretMapping - Mappatura tra chiavi di configurazione e nomi di segreti
 * @returns {Promise<Object>} Configurazione con segreti
 */
async function replaceEnvWithSecrets(config, secretMapping) {
  try {
    logger.debug('Sostituzione delle variabili d\'ambiente con segreti');
    
    const result = { ...config };
    
    for (const [configKey, secretName] of Object.entries(secretMapping)) {
      // Se la chiave di configurazione esiste, sostituiscila con il segreto
      if (configKey in result) {
        result[configKey] = await getSecret(secretName);
      }
    }
    
    return result;
  } catch (error) {
    logger.error(`Errore durante la sostituzione delle variabili d'ambiente con segreti: ${error.message}`);
    throw error;
  }
}

module.exports = {
  initializeSecretsSystem,
  getSecretsManager,
  getSecretCache,
  getSecret,
  replaceEnvWithSecrets
};
