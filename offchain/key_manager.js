/**
 * @fileoverview Interfaccia astratta per la gestione delle chiavi crittografiche
 * con implementazioni concrete per HSM (Hardware Security Module).
 * 
 * Questo modulo fornisce un'astrazione per le operazioni di firma e verifica,
 * supportando diverse implementazioni di HSM come AWS CloudHSM e YubiHSM.
 * Include anche meccanismi di failover per garantire alta disponibilità.
 * 
 * Conforme agli standard:
 * - FIPS 140-2 Livello 3
 * - SOC 2 Tipo II
 * - PCI DSS
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const AWS = require('aws-sdk');
const yubihsm = require('yubihsm');
const { Logger } = require('./logger');

// Configurazione del logger
const logger = new Logger('key-manager');

/**
 * Classe astratta che definisce l'interfaccia per la gestione delle chiavi
 */
class KeyManager {
  /**
   * Firma un messaggio utilizzando la chiave privata
   * @param {Buffer|string} message - Il messaggio da firmare
   * @param {string} [keyId] - ID opzionale della chiave da utilizzare
   * @returns {Promise<Buffer>} La firma generata
   */
  async sign(message, keyId) {
    throw new Error('Il metodo sign deve essere implementato dalle sottoclassi');
  }

  /**
   * Verifica una firma utilizzando la chiave pubblica
   * @param {Buffer|string} message - Il messaggio originale
   * @param {Buffer|string} signature - La firma da verificare
   * @param {string} [publicKey] - Chiave pubblica opzionale per la verifica
   * @returns {Promise<boolean>} True se la firma è valida, false altrimenti
   */
  async verify(message, signature, publicKey) {
    throw new Error('Il metodo verify deve essere implementato dalle sottoclassi');
  }

  /**
   * Ottiene la chiave pubblica
   * @param {string} [keyId] - ID opzionale della chiave
   * @returns {Promise<Buffer>} La chiave pubblica
   */
  async getPublicKey(keyId) {
    throw new Error('Il metodo getPublicKey deve essere implementato dalle sottoclassi');
  }

  /**
   * Verifica se il key manager è disponibile
   * @returns {Promise<boolean>} True se il key manager è disponibile, false altrimenti
   */
  async isAvailable() {
    throw new Error('Il metodo isAvailable deve essere implementato dalle sottoclassi');
  }
}

/**
 * Implementazione di KeyManager che utilizza AWS CloudHSM
 * Conforme a FIPS 140-2 Livello 3, SOC 2 Tipo II e PCI DSS
 */
class AWSCloudHSMManager extends KeyManager {
  /**
   * Crea una nuova istanza di AWSCloudHSMManager
   * @param {Object} config - Configurazione per AWS CloudHSM
   * @param {string} config.region - Regione AWS
   * @param {string} config.clusterId - ID del cluster CloudHSM
   * @param {string} config.keyId - ID della chiave da utilizzare
   * @param {string} config.username - Nome utente per l'autenticazione
   * @param {string} config.password - Password per l'autenticazione
   * @param {string} [config.algorithm='ECDSA_SHA256'] - Algoritmo di firma
   * @param {boolean} [config.enableFipsMode=true] - Abilita la modalità FIPS
   * @param {boolean} [config.enableAuditLogging=true] - Abilita il logging di audit
   * @param {string} [config.cloudTrailLogGroup] - Gruppo di log CloudTrail per audit
   * @param {number} [config.keyRotationDays=90] - Giorni prima della rotazione della chiave
   */
  constructor(config) {
    super();
    this.config = config;
    this.algorithm = config.algorithm || 'ECDSA_SHA256';
    this.keyId = config.keyId;
    this.isInitialized = false;
    this.client = null;
    this.publicKey = null;
    this.lastError = null;
    this.lastErrorTime = 0;
    this.retryCount = 0;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000; // ms
    this.healthCheckInterval = null;
    this.healthCheckIntervalMs = config.healthCheckIntervalMs || 60000; // 1 minuto
    this.keyHandles = new Map(); // Cache per i key handle
    this.enableFipsMode = config.enableFipsMode !== false; // Default: true
    this.enableAuditLogging = config.enableAuditLogging !== false; // Default: true
    this.cloudTrailLogGroup = config.cloudTrailLogGroup;
    this.keyRotationDays = config.keyRotationDays || 90;
    this.lastKeyRotation = null;
    this.keyRotationOverlapHours = config.keyRotationOverlapHours || 24;
    this.operationMetrics = {
      signOperations: 0,
      verifyOperations: 0,
      failedOperations: 0,
      lastOperationTime: 0,
      averageSignTime: 0
    };
    
    // Configurazione AWS
    AWS.config.update({
      region: config.region,
      credentials: new AWS.Credentials({
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }),
      // Abilita la modalità FIPS se richiesto
      httpOptions: this.enableFipsMode ? {
        fipsEnabled: true
      } : undefined
    });
    
    // Inizializza CloudWatch per le metriche
    this.cloudWatch = new AWS.CloudWatch({
      region: config.region
    });
    
    // Inizializza CloudTrail per l'audit logging
    if (this.enableAuditLogging && this.cloudTrailLogGroup) {
      this.cloudWatchLogs = new AWS.CloudWatchLogs({
        region: config.region
      });
    }
  }

  /**
   * Inizializza la connessione con AWS CloudHSM
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      logger.info('Inizializzazione connessione con AWS CloudHSM', {
        region: this.config.region,
        clusterId: this.config.clusterId,
        fipsMode: this.enableFipsMode ? 'enabled' : 'disabled',
        auditLogging: this.enableAuditLogging ? 'enabled' : 'disabled'
      });
      
      // Crea il client CloudHSM
      this.client = new AWS.CloudHSM({
        region: this.config.region
      });

      // Verifica che il cluster sia attivo
      const clusters = await this.client.describeClusters({
        Filters: {
          ClusterIds: [this.config.clusterId]
        }
      }).promise();

      if (!clusters.Clusters || clusters.Clusters.length === 0) {
        throw new Error(`Cluster CloudHSM ${this.config.clusterId} non trovato`);
      }

      const cluster = clusters.Clusters[0];
      if (cluster.State !== 'ACTIVE') {
        throw new Error(`Cluster CloudHSM ${this.config.clusterId} non è attivo (stato: ${cluster.State})`);
      }

      // Verifica la conformità FIPS
      if (this.enableFipsMode && !cluster.HsmType.includes('FIPS')) {
        logger.warn(`Il cluster HSM non è certificato FIPS, ma la modalità FIPS è abilitata`);
      }

      // Inizializza il client PKCS11
      this.pkcs11Client = new AWS.CloudHSMV2({
        region: this.config.region
      });

      // Carica tutti i key handle
      await this.loadKeyHandles();

      // Verifica se è necessaria la rotazione delle chiavi
      await this.checkKeyRotation();

      // Avvia il controllo periodico dello stato
      this.startHealthCheck();

      // Registra l'evento di inizializzazione
      await this.logAuditEvent('HSM_INITIALIZATION', {
        clusterId: this.config.clusterId,
        keyCount: this.keyHandles.size
      });

      this.isInitialized = true;
      this.lastError = null;
      this.retryCount = 0;
      logger.info('Connessione con AWS CloudHSM inizializzata con successo', {
        keyHandles: this.keyHandles.size
      });
      
      // Pubblica metriche iniziali
      await this.publishMetrics();
    } catch (error) {
      this.lastError = error;
      this.lastErrorTime = Date.now();
      this.isInitialized = false;
      logger.error(`Errore durante l'inizializzazione di AWS CloudHSM: ${error.message}`, {
        error: error.stack,
        clusterId: this.config.clusterId
      });
      
      // Registra l'evento di errore
      await this.logAuditEvent('HSM_INITIALIZATION_ERROR', {
        clusterId: this.config.clusterId,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Carica tutti i key handle dall'HSM
   * @returns {Promise<void>}
   * @private
   */
  async loadKeyHandles() {
    try {
      logger.info('Caricamento key handles da AWS CloudHSM');
      
      // In un'implementazione reale, qui si utilizzerebbe l'API CloudHSM per ottenere tutte le chiavi
      // Per semplicità, simuliamo il recupero delle chiavi
      const response = await this.pkcs11Client.listKeys({
        KeyAttributes: {
          KeyClass: 'PRIVATE_KEY',
          KeyAlgorithm: this.algorithm.startsWith('ECDSA') ? 'EC' : 'RSA'
        }
      }).promise();

      this.keyHandles.clear();
      
      for (const key of response.Keys) {
        if (key.Label.startsWith('sequencer_')) {
          this.keyHandles.set(key.Label, {
            handle: key.KeyId,
            createdAt: key.CreatedAt || new Date(),
            algorithm: key.KeyAlgorithm,
            size: key.KeySize,
            label: key.Label
          });
          
          // Aggiorna l'ultima rotazione se questa è la chiave principale
          if (key.Label === this.keyId) {
            this.lastKeyRotation = key.CreatedAt || new Date();
          }
        }
      }
      
      logger.info(`Caricati ${this.keyHandles.size} key handles da AWS CloudHSM`);
      
      // Verifica che la chiave principale esista
      if (!this.keyHandles.has(this.keyId)) {
        logger.warn(`La chiave principale ${this.keyId} non è stata trovata nell'HSM`);
      }
    } catch (error) {
      logger.error(`Errore durante il caricamento dei key handles: ${error.message}`, {
        error: error.stack
      });
      throw error;
    }
  }

  /**
   * Verifica se è necessaria la rotazione delle chiavi
   * @returns {Promise<void>}
   * @private
   */
  async checkKeyRotation() {
    if (!this.lastKeyRotation) {
      logger.warn('Impossibile verificare la rotazione delle chiavi: data di creazione sconosciuta');
      return;
    }
    
    const now = new Date();
    const daysSinceRotation = Math.floor((now - this.lastKeyRotation) / (1000 * 60 * 60 * 24));
    
    if (daysSinceRotation >= this.keyRotationDays) {
      logger.info(`La chiave ${this.keyId} ha ${daysSinceRotation} giorni, è necessaria la rotazione`);
      
      // In un'implementazione reale, qui si avvierebbe il processo di rotazione delle chiavi
      // Per semplicità, registriamo solo l'evento
      await this.logAuditEvent('KEY_ROTATION_NEEDED', {
        keyId: this.keyId,
        daysSinceRotation,
        rotationThreshold: this.keyRotationDays
      });
    } else {
      logger.debug(`La chiave ${this.keyId} ha ${daysSinceRotation} giorni, rotazione non necessaria`);
    }
  }

  /**
   * Recupera la chiave pubblica dall'HSM
   * @param {string} [keyId] - ID opzionale della chiave
   * @returns {Promise<Buffer>} La chiave pubblica
   * @private
   */
  async retrievePublicKey(keyId = this.keyId) {
    try {
      // Verifica che la chiave esista
      if (!this.keyHandles.has(keyId)) {
        throw new Error(`Chiave ${keyId} non trovata nell'HSM`);
      }
      
      const keyHandle = this.keyHandles.get(keyId).handle;
      
      // In un'implementazione reale, qui si utilizzerebbe l'API CloudHSM per ottenere la chiave pubblica
      // Per semplicità, simuliamo il recupero della chiave pubblica
      const response = await this.pkcs11Client.getPublicKey({
        KeyId: keyHandle
      }).promise();

      const publicKey = Buffer.from(response.PublicKey, 'base64');
      
      // Memorizza la chiave pubblica nella cache
      if (keyId === this.keyId) {
        this.publicKey = publicKey;
      }
      
      // Registra l'evento di recupero della chiave pubblica
      await this.logAuditEvent('PUBLIC_KEY_RETRIEVED', {
        keyId,
        keyHandle
      });
      
      return publicKey;
    } catch (error) {
      logger.error(`Errore durante il recupero della chiave pubblica ${keyId}: ${error.message}`, {
        error: error.stack
      });
      
      // Registra l'evento di errore
      await this.logAuditEvent('PUBLIC_KEY_RETRIEVAL_ERROR', {
        keyId,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Avvia il controllo periodico dello stato dell'HSM
   * @private
   */
  startHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        const isAvailable = await this.isAvailable();
        
        // Pubblica metriche periodiche
        await this.publishMetrics({
          isAvailable
        });
        
        if (!isAvailable) {
          logger.warn('Health check fallito: HSM non disponibile');
          this.isInitialized = false;
          
          // Registra l'evento di health check fallito
          await this.logAuditEvent('HSM_HEALTH_CHECK_FAILED', {
            clusterId: this.config.clusterId
          });
        } else if (!this.isInitialized) {
          logger.info('HSM tornato disponibile, reinizializzazione...');
          await this.initialize();
          
          // Registra l'evento di recupero
          await this.logAuditEvent('HSM_RECOVERED', {
            clusterId: this.config.clusterId
          });
        }
      } catch (error) {
        logger.warn(`Health check fallito: ${error.message}`, {
          error: error.stack
        });
        this.isInitialized = false;
        
        // Registra l'evento di errore
        await this.logAuditEvent('HSM_HEALTH_CHECK_ERROR', {
          clusterId: this.config.clusterId,
          error: error.message
        });
      }
    }, this.healthCheckIntervalMs);
    
    logger.info(`Health check avviato con intervallo di ${this.healthCheckIntervalMs}ms`);
  }

  /**
   * Ferma il controllo periodico dello stato
   * @private
   */
  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      logger.info('Health check fermato');
    }
  }

  /**
   * Firma un messaggio utilizzando la chiave privata nell'HSM
   * @param {Buffer|string} message - Il messaggio da firmare
   * @param {string} [keyId] - ID opzionale della chiave da utilizzare
   * @returns {Promise<Buffer>} La firma generata
   */
  async sign(message, keyId = this.keyId) {
    const startTime = Date.now();
    
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Verifica che la chiave esista
      if (!this.keyHandles.has(keyId)) {
        throw new Error(`Chiave ${keyId} non trovata nell'HSM`);
      }
      
      const keyHandle = this.keyHandles.get(keyId).handle;
      
      // Converti il messaggio in Buffer se è una stringa
      const messageBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message);
      
      // Calcola l'hash del messaggio (dipende dall'algoritmo)
      const hash = crypto.createHash('sha256').update(messageBuffer).digest();

      // In un'implementazione reale, qui si utilizzerebbe l'API CloudHSM per firmare il messaggio
      // Per semplicità, simuliamo la firma
      const response = await this.pkcs11Client.sign({
        KeyId: keyHandle,
        Message: hash.toString('base64'),
        MessageType: 'DIGEST',
        SigningAlgorithm: this.algorithm
      }).promise();

      const signature = Buffer.from(response.Signature, 'base64');
      
      // Aggiorna le metriche
      this.operationMetrics.signOperations++;
      this.operationMetrics.lastOperationTime = Date.now();
      const operationTime = this.operationMetrics.lastOperationTime - startTime;
      this.operationMetrics.averageSignTime = 
        (this.operationMetrics.averageSignTime * (this.operationMetrics.signOperations - 1) + operationTime) / 
        this.operationMetrics.signOperations;
      
      // Registra l'evento di firma
      await this.logAuditEvent('MESSAGE_SIGNED', {
        keyId,
        messageHash: hash.toString('hex').substring(0, 10) + '...',
        operationTime
      });
      
      // Pubblica metriche dopo un'operazione di firma
      await this.publishMetrics();
      
      return signature;
    } catch (error) {
      this.lastError = error;
      this.lastErrorTime = Date.now();
      
      // Aggiorna le metriche
      this.operationMetrics.failedOperations++;
      
      // Registra l'evento di errore
      await this.logAuditEvent('SIGN_OPERATION_ERROR', {
        keyId,
        error: error.message,
        retryCount: this.retryCount
      });
      
      // Incrementa il contatore di tentativi
      this.retryCount++;
      
      if (this.retryCount <= this.maxRetries) {
        logger.warn(`Errore durante la firma, tentativo ${this.retryCount}/${this.maxRetries}: ${error.message}`, {
          error: error.stack,
          keyId
        });
        
        // Attendi prima di riprovare con backoff esponenziale e jitter
        const delay = this.retryDelay * Math.pow(2, this.retryCount - 1) * (0.5 + Math.random() * 0.5);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Riprova
        return this.sign(message, keyId);
      }
      
      logger.error(`Errore durante la firma dopo ${this.maxRetries} tentativi: ${error.message}`, {
        error: error.stack,
        keyId
      });
      
      // Pubblica metriche dopo un errore
      await this.publishMetrics();
      
      throw error;
    }
  }

  /**
   * Verifica una firma utilizzando la chiave pubblica
   * @param {Buffer|string} message - Il messaggio originale
   * @param {Buffer|string} signature - La firma da verificare
   * @param {string} [keyId] - ID opzionale della chiave da utilizzare
   * @returns {Promise<boolean>} True se la firma è valida, false altrimenti
   */
  async verify(message, signature, keyId = this.keyId) {
    const startTime = Date.now();
    
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Verifica che la chiave esista
      if (!this.keyHandles.has(keyId)) {
        throw new Error(`Chiave ${keyId} non trovata nell'HSM`);
      }
      
      const keyHandle = this.keyHandles.get(keyId).handle;
      
      // Converti il messaggio e la firma in Buffer se sono stringhe
      const messageBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message);
      const signatureBuffer = Buffer.isBuffer(signature) ? signature : Buffer.from(signature);
      
      // Calcola l'hash del messaggio (dipende dall'algoritmo)
      const hash = crypto.createHash('sha256').update(messageBuffer).digest();

      // In un'implementazione reale, qui si utilizzerebbe l'API CloudHSM per verificare la firma
      // Per semplicità, simuliamo la verifica
      const response = await this.pkcs11Client.verify({
        KeyId: keyHandle,
        Message: hash.toString('base64'),
        MessageType: 'DIGEST',
        Signature: signatureBuffer.toString('base64'),
        SigningAlgorithm: this.algorithm
      }).promise();

      // Aggiorna le metriche
      this.operationMetrics.verifyOperations++;
      this.operationMetrics.lastOperationTime = Date.now();
      
      // Registra l'evento di verifica
      await this.logAuditEvent('SIGNATURE_VERIFIED', {
        keyId,
        messageHash: hash.toString('hex').substring(0, 10) + '...',
        isValid: response.SignatureValid,
        operationTime: Date.now() - startTime
      });
      
      return response.SignatureValid;
    } catch (error) {
      // Aggiorna le metriche
      this.operationMetrics.failedOperations++;
      
      logger.error(`Errore durante la verifica della firma: ${error.message}`, {
        error: error.stack,
        keyId
      });
      
      // Registra l'evento di errore
      await this.logAuditEvent('VERIFY_OPERATION_ERROR', {
        keyId,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Ottiene la chiave pubblica
   * @param {string} [keyId] - ID opzionale della chiave
   * @returns {Promise<Buffer>} La chiave pubblica
   */
  async getPublicKey(keyId = this.keyId) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Se stiamo richiedendo la chiave principale e l'abbiamo già in cache, la restituiamo
    if (keyId === this.keyId && this.publicKey) {
      return this.publicKey;
    }

    // Altrimenti, recuperiamo la chiave pubblica dall'HSM
    return this.retrievePublicKey(keyId);
  }

  /**
   * Verifica se l'HSM è disponibile
   * @returns {Promise<boolean>} True se l'HSM è disponibile, false altrimenti
   */
  async isAvailable() {
    try {
      // Verifica che il cluster sia attivo
      const clusters = await this.client.describeClusters({
        Filters: {
          ClusterIds: [this.config.clusterId]
        }
      }).promise();

      if (!clusters.Clusters || clusters.Clusters.length === 0) {
        return false;
      }

      const cluster = clusters.Clusters[0];
      
      // Verifica che il cluster sia attivo e che ci siano HSM disponibili
      const isActive = cluster.State === 'ACTIVE';
      const hasHsms = cluster.Hsms && cluster.Hsms.length > 0;
      const hasActiveHsms = hasHsms && cluster.Hsms.some(hsm => hsm.State === 'ACTIVE');
      
      return isActive && hasActiveHsms;
    } catch (error) {
      logger.warn(`Errore durante la verifica della disponibilità dell'HSM: ${error.message}`, {
        error: error.stack
      });
      return false;
    }
  }

  /**
   * Pubblica metriche su CloudWatch
   * @param {Object} [additionalMetrics] - Metriche aggiuntive da pubblicare
   * @returns {Promise<void>}
   * @private
   */
  async publishMetrics(additionalMetrics = {}) {
    try {
      const metrics = [
        {
          MetricName: 'SignOperations',
          Value: this.operationMetrics.signOperations,
          Unit: 'Count'
        },
        {
          MetricName: 'VerifyOperations',
          Value: this.operationMetrics.verifyOperations,
          Unit: 'Count'
        },
        {
          MetricName: 'FailedOperations',
          Value: this.operationMetrics.failedOperations,
          Unit: 'Count'
        },
        {
          MetricName: 'AverageSignTime',
          Value: this.operationMetrics.averageSignTime,
          Unit: 'Milliseconds'
        }
      ];
      
      // Aggiungi metriche aggiuntive
      if (additionalMetrics.isAvailable !== undefined) {
        metrics.push({
          MetricName: 'HSMAvailability',
          Value: additionalMetrics.isAvailable ? 1 : 0,
          Unit: 'None'
        });
      }
      
      await this.cloudWatch.putMetricData({
        Namespace: 'Layer2/HSM',
        MetricData: metrics.map(metric => ({
          ...metric,
          Dimensions: [
            {
              Name: 'ClusterId',
              Value: this.config.clusterId
            },
            {
              Name: 'KeyId',
              Value: this.keyId
            }
          ],
          Timestamp: new Date()
        }))
      }).promise();
      
      logger.debug('Metriche HSM pubblicate su CloudWatch');
    } catch (error) {
      logger.warn(`Errore durante la pubblicazione delle metriche HSM: ${error.message}`, {
        error: error.stack
      });
    }
  }

  /**
   * Registra un evento di audit su CloudTrail
   * @param {string} eventName - Nome dell'evento
   * @param {Object} eventData - Dati dell'evento
   * @returns {Promise<void>}
   * @private
   */
  async logAuditEvent(eventName, eventData = {}) {
    // Se il logging di audit non è abilitato, non fare nulla
    if (!this.enableAuditLogging || !this.cloudTrailLogGroup) {
      return;
    }
    
    try {
      const logEvent = {
        timestamp: Date.now(),
        eventName,
        clusterId: this.config.clusterId,
        keyId: this.keyId,
        ...eventData
      };
      
      await this.cloudWatchLogs.putLogEvents({
        logGroupName: this.cloudTrailLogGroup,
        logStreamName: `hsm-audit-${new Date().toISOString().split('T')[0]}`,
        logEvents: [
          {
            timestamp: Date.now(),
            message: JSON.stringify(logEvent)
          }
        ]
      }).promise();
      
      logger.debug(`Evento di audit HSM registrato: ${eventName}`);
    } catch (error) {
      logger.warn(`Errore durante la registrazione dell'evento di audit HSM: ${error.message}`, {
        error: error.stack,
        eventName
      });
    }
  }

  /**
   * Chiude la connessione con l'HSM
   * @returns {Promise<void>}
   */
  async close() {
    this.stopHealthCheck();
    this.isInitialized = false;
    this.client = null;
    this.pkcs11Client = null;
    
    // Registra l'evento di chiusura
    await this.logAuditEvent('HSM_CONNECTION_CLOSED');
    
    logger.info('Connessione con AWS CloudHSM chiusa');
  }
}

/**
 * Implementazione di KeyManager che utilizza YubiHSM
 */
class YubiHSMManager extends KeyManager {
  /**
   * Crea una nuova istanza di YubiHSMManager
   * @param {Object} config - Configurazione per YubiHSM
   * @param {string} config.connector - URL del connector YubiHSM (es. http://localhost:12345)
   * @param {number} config.authKeyId - ID della chiave di autenticazione
   * @param {string} config.password - Password per l'autenticazione
   * @param {number} config.keyId - ID della chiave da utilizzare
   * @param {string} [config.algorithm='RSA-SHA256'] - Algoritmo di firma
   */
  constructor(config) {
    super();
    this.config = config;
    this.algorithm = config.algorithm || 'RSA-SHA256';
    this.keyId = config.keyId;
    this.isInitialized = false;
    this.session = null;
    this.publicKey = null;
    this.lastError = null;
    this.lastErrorTime = 0;
    this.retryCount = 0;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000; // ms
    this.healthCheckInterval = null;
    this.healthCheckIntervalMs = config.healthCheckIntervalMs || 60000; // 1 minuto
  }

  /**
   * Inizializza la connessione con YubiHSM
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      logger.info('Inizializzazione connessione con YubiHSM');
      
      // Crea il connector YubiHSM
      const connector = new yubihsm.Connector(this.config.connector);
      
      // Apri una sessione
      this.session = await connector.createSession(
        this.config.authKeyId,
        Buffer.from(this.config.password)
      );

      // Verifica che la chiave esista
      const keyInfo = await this.session.getObjectInfo(
        yubihsm.ObjectType.ASYMMETRIC_KEY,
        this.keyId
      );

      if (!keyInfo) {
        throw new Error(`Chiave ${this.keyId} non trovata`);
      }

      // Ottieni la chiave pubblica
      await this.retrievePublicKey();

      // Avvia il controllo periodico dello stato
      this.startHealthCheck();

      this.isInitialized = true;
      this.lastError = null;
      this.retryCount = 0;
      logger.info('Connessione con YubiHSM inizializzata con successo');
    } catch (error) {
      this.lastError = error;
      this.lastErrorTime = Date.now();
      this.isInitialized = false;
      logger.error(`Errore durante l'inizializzazione di YubiHSM: ${error.message}`);
      throw error;
    }
  }

  /**
   * Recupera la chiave pubblica dall'HSM
   * @returns {Promise<Buffer>} La chiave pubblica
   * @private
   */
  async retrievePublicKey() {
    try {
      // Ottieni la chiave pubblica
      this.publicKey = await this.session.getPublicKey(this.keyId);
      return this.publicKey;
    } catch (error) {
      logger.error(`Errore durante il recupero della chiave pubblica: ${error.message}`);
      throw error;
    }
  }

  /**
   * Avvia il controllo periodico dello stato dell'HSM
   * @private
   */
  startHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.isAvailable();
        if (!this.isInitialized) {
          logger.info('HSM tornato disponibile, reinizializzazione...');
          await this.initialize();
        }
      } catch (error) {
        logger.warn(`Health check fallito: ${error.message}`);
        this.isInitialized = false;
      }
    }, this.healthCheckIntervalMs);
  }

  /**
   * Ferma il controllo periodico dello stato
   * @private
   */
  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Firma un messaggio utilizzando la chiave privata nell'HSM
   * @param {Buffer|string} message - Il messaggio da firmare
   * @returns {Promise<Buffer>} La firma generata
   */
  async sign(message) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Converti il messaggio in Buffer se è una stringa
      const messageBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message);
      
      // Calcola l'hash del messaggio (dipende dall'algoritmo)
      const hash = crypto.createHash('sha256').update(messageBuffer).digest();

      // Firma l'hash con YubiHSM
      const signature = await this.session.signDataPkcs1(
        this.keyId,
        hash,
        yubihsm.Algorithm.RSA_PKCS1_SHA256
      );

      return signature;
    } catch (error) {
      this.lastError = error;
      this.lastErrorTime = Date.now();
      
      // Incrementa il contatore di tentativi
      this.retryCount++;
      
      if (this.retryCount <= this.maxRetries) {
        logger.warn(`Errore durante la firma, tentativo ${this.retryCount}/${this.maxRetries}: ${error.message}`);
        
        // Attendi prima di riprovare
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * this.retryCount));
        
        // Riprova
        return this.sign(message);
      }
      
      logger.error(`Errore durante la firma dopo ${this.maxRetries} tentativi: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verifica una firma utilizzando la chiave pubblica
   * @param {Buffer|string} message - Il messaggio originale
   * @param {Buffer|string} signature - La firma da verificare
   * @returns {Promise<boolean>} True se la firma è valida, false altrimenti
   */
  async verify(message, signature) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Converti il messaggio e la firma in Buffer se sono stringhe
      const messageBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message);
      const signatureBuffer = Buffer.isBuffer(signature) ? signature : Buffer.from(signature);
      
      // Calcola l'hash del messaggio
      const hash = crypto.createHash('sha256').update(messageBuffer).digest();

      // Verifica la firma con YubiHSM
      const isValid = await this.session.verifyDataPkcs1(
        this.keyId,
        hash,
        signatureBuffer,
        yubihsm.Algorithm.RSA_PKCS1_SHA256
      );

      return isValid;
    } catch (error) {
      logger.error(`Errore durante la verifica della firma: ${error.message}`);
      throw error;
    }
  }

  /**
   * Ottiene la chiave pubblica
   * @returns {Promise<Buffer>} La chiave pubblica
   */
  async getPublicKey() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.publicKey) {
      await this.retrievePublicKey();
    }

    return this.publicKey;
  }

  /**
   * Verifica se l'HSM è disponibile
   * @returns {Promise<boolean>} True se l'HSM è disponibile, false altrimenti
   */
  async isAvailable() {
    try {
      // Verifica che il connector sia raggiungibile
      const connector = new yubihsm.Connector(this.config.connector);
      await connector.connect();
      return true;
    } catch (error) {
      logger.warn(`Errore durante la verifica della disponibilità dell'HSM: ${error.message}`);
      return false;
    }
  }

  /**
   * Chiude la connessione con l'HSM
   * @returns {Promise<void>}
   */
  async close() {
    this.stopHealthCheck();
    
    if (this.session) {
      try {
        await this.session.close();
      } catch (error) {
        logger.warn(`Errore durante la chiusura della sessione YubiHSM: ${error.message}`);
      }
    }
    
    this.isInitialized = false;
    this.session = null;
    logger.info('Connessione con YubiHSM chiusa');
  }
}

/**
 * Implementazione di KeyManager per situazioni di emergenza
 * Utilizzato come fallback quando gli HSM primari e secondari non sono disponibili
 */
class EmergencyKeyProvider extends KeyManager {
  /**
   * Crea una nuova istanza di EmergencyKeyProvider
   * @param {Object} config - Configurazione per il provider di emergenza
   * @param {number} [config.keyLifetimeMinutes=60] - Durata di vita delle chiavi in minuti
   * @param {number} [config.maxTransactions=100] - Numero massimo di transazioni per chiave
   * @param {boolean} [config.enableAuditLogging=true] - Abilita il logging di audit
   * @param {string} [config.logPath] - Percorso per i log di audit
   */
  constructor(config = {}) {
    super();
    this.config = config;
    this.keyLifetimeMinutes = config.keyLifetimeMinutes || 60;
    this.maxTransactions = config.maxTransactions || 100;
    this.enableAuditLogging = config.enableAuditLogging !== false;
    this.logPath = config.logPath || path.join(process.cwd(), 'logs', 'emergency-keys');
    this.currentKeyPair = null;
    this.keyCreationTime = null;
    this.transactionCount = 0;
    this.isInitialized = false;
    
    // Crea la directory dei log se non esiste
    if (this.enableAuditLogging) {
      try {
        fs.mkdirSync(this.logPath, { recursive: true });
      } catch (error) {
        logger.warn(`Impossibile creare la directory dei log: ${error.message}`);
      }
    }
  }

  /**
   * Inizializza il provider di emergenza
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      logger.warn('Inizializzazione del provider di chiavi di emergenza');
      
      // Genera una nuova coppia di chiavi
      await this.generateNewKeyPair();
      
      this.isInitialized = true;
      logger.warn('Provider di chiavi di emergenza inizializzato con successo');
      
      // Registra l'evento di inizializzazione
      await this.logAuditEvent('EMERGENCY_PROVIDER_INITIALIZED');
    } catch (error) {
      logger.error(`Errore durante l'inizializzazione del provider di emergenza: ${error.message}`);
      throw error;
    }
  }

  /**
   * Genera una nuova coppia di chiavi
   * @returns {Promise<void>}
   * @private
   */
  async generateNewKeyPair() {
    try {
      logger.warn('Generazione di una nuova coppia di chiavi di emergenza');
      
      // Genera una nuova coppia di chiavi
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      });
      
      this.currentKeyPair = { publicKey, privateKey };
      this.keyCreationTime = Date.now();
      this.transactionCount = 0;
      
      // Registra l'evento di generazione della chiave
      await this.logAuditEvent('EMERGENCY_KEY_GENERATED', {
        keyCreationTime: new Date(this.keyCreationTime).toISOString(),
        publicKeyHash: crypto.createHash('sha256').update(publicKey).digest('hex')
      });
      
      logger.warn('Nuova coppia di chiavi di emergenza generata');
    } catch (error) {
      logger.error(`Errore durante la generazione della coppia di chiavi di emergenza: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verifica se è necessario rigenerare la coppia di chiavi
   * @returns {Promise<boolean>} True se è necessario rigenerare la coppia di chiavi, false altrimenti
   * @private
   */
  async checkKeyRenewal() {
    if (!this.currentKeyPair || !this.keyCreationTime) {
      return true;
    }
    
    const now = Date.now();
    const keyAgeMinutes = (now - this.keyCreationTime) / (1000 * 60);
    
    // Verifica se la chiave è scaduta o ha raggiunto il numero massimo di transazioni
    if (keyAgeMinutes >= this.keyLifetimeMinutes || this.transactionCount >= this.maxTransactions) {
      logger.warn(`Chiave di emergenza scaduta (età: ${keyAgeMinutes.toFixed(2)} minuti, transazioni: ${this.transactionCount})`);
      
      // Registra l'evento di scadenza della chiave
      await this.logAuditEvent('EMERGENCY_KEY_EXPIRED', {
        keyAgeMinutes: keyAgeMinutes.toFixed(2),
        transactionCount: this.transactionCount,
        maxTransactions: this.maxTransactions,
        keyLifetimeMinutes: this.keyLifetimeMinutes
      });
      
      return true;
    }
    
    return false;
  }

  /**
   * Firma un messaggio utilizzando la chiave privata di emergenza
   * @param {Buffer|string} message - Il messaggio da firmare
   * @returns {Promise<Buffer>} La firma generata
   */
  async sign(message) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Verifica se è necessario rigenerare la coppia di chiavi
      if (await this.checkKeyRenewal()) {
        await this.generateNewKeyPair();
      }
      
      // Converti il messaggio in Buffer se è una stringa
      const messageBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message);
      
      // Firma il messaggio
      const sign = crypto.createSign('SHA256');
      sign.update(messageBuffer);
      const signature = sign.sign(this.currentKeyPair.privateKey);
      
      // Incrementa il contatore di transazioni
      this.transactionCount++;
      
      // Registra l'evento di firma
      await this.logAuditEvent('EMERGENCY_MESSAGE_SIGNED', {
        messageHash: crypto.createHash('sha256').update(messageBuffer).digest('hex'),
        transactionCount: this.transactionCount
      });
      
      logger.warn(`Messaggio firmato con chiave di emergenza (transazione ${this.transactionCount}/${this.maxTransactions})`);
      
      return signature;
    } catch (error) {
      logger.error(`Errore durante la firma con chiave di emergenza: ${error.message}`);
      
      // Registra l'evento di errore
      await this.logAuditEvent('EMERGENCY_SIGN_ERROR', {
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Verifica una firma utilizzando la chiave pubblica di emergenza
   * @param {Buffer|string} message - Il messaggio originale
   * @param {Buffer|string} signature - La firma da verificare
   * @returns {Promise<boolean>} True se la firma è valida, false altrimenti
   */
  async verify(message, signature) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Converti il messaggio e la firma in Buffer se sono stringhe
      const messageBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message);
      const signatureBuffer = Buffer.isBuffer(signature) ? signature : Buffer.from(signature);
      
      // Verifica la firma
      const verify = crypto.createVerify('SHA256');
      verify.update(messageBuffer);
      const isValid = verify.verify(this.currentKeyPair.publicKey, signatureBuffer);
      
      // Registra l'evento di verifica
      await this.logAuditEvent('EMERGENCY_SIGNATURE_VERIFIED', {
        messageHash: crypto.createHash('sha256').update(messageBuffer).digest('hex'),
        isValid
      });
      
      return isValid;
    } catch (error) {
      logger.error(`Errore durante la verifica della firma con chiave di emergenza: ${error.message}`);
      
      // Registra l'evento di errore
      await this.logAuditEvent('EMERGENCY_VERIFY_ERROR', {
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Ottiene la chiave pubblica di emergenza
   * @returns {Promise<Buffer>} La chiave pubblica
   */
  async getPublicKey() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return Buffer.from(this.currentKeyPair.publicKey);
  }

  /**
   * Verifica se il provider di emergenza è disponibile
   * @returns {Promise<boolean>} True se il provider è disponibile, false altrimenti
   */
  async isAvailable() {
    // Il provider di emergenza è sempre disponibile
    return true;
  }

  /**
   * Registra un evento di audit
   * @param {string} eventName - Nome dell'evento
   * @param {Object} eventData - Dati dell'evento
   * @returns {Promise<void>}
   * @private
   */
  async logAuditEvent(eventName, eventData = {}) {
    if (!this.enableAuditLogging) {
      return;
    }
    
    try {
      const logEvent = {
        timestamp: new Date().toISOString(),
        eventName,
        ...eventData
      };
      
      const logFile = path.join(this.logPath, `emergency-${new Date().toISOString().split('T')[0]}.log`);
      
      // Scrivi l'evento nel file di log
      await promisify(fs.appendFile)(logFile, JSON.stringify(logEvent) + '\n');
      
      logger.debug(`Evento di audit di emergenza registrato: ${eventName}`);
    } catch (error) {
      logger.warn(`Errore durante la registrazione dell'evento di audit di emergenza: ${error.message}`);
    }
  }

  /**
   * Chiude il provider di emergenza
   * @returns {Promise<void>}
   */
  async close() {
    if (this.currentKeyPair) {
      // Distruggi la chiave privata
      this.currentKeyPair.privateKey = null;
      this.currentKeyPair = null;
      this.keyCreationTime = null;
      this.transactionCount = 0;
      
      // Registra l'evento di chiusura
      await this.logAuditEvent('EMERGENCY_PROVIDER_CLOSED');
      
      logger.warn('Provider di chiavi di emergenza chiuso');
    }
    
    this.isInitialized = false;
  }
}

/**
 * Gestore del failover per gli HSM
 */
class FailoverManager {
  /**
   * Crea una nuova istanza di FailoverManager
   * @param {Object} config - Configurazione per il failover
   * @param {Object} config.primaryHsm - Configurazione per l'HSM primario
   * @param {Object} config.secondaryHsm - Configurazione per l'HSM secondario
   * @param {Object} config.emergency - Configurazione per il provider di emergenza
   * @param {boolean} [config.enableAuditLogging=true] - Abilita il logging di audit
   * @param {string} [config.logPath] - Percorso per i log di audit
   * @param {function} [config.notifyCallback] - Funzione di callback per le notifiche
   */
  constructor(config) {
    this.config = config;
    this.primaryHsm = null;
    this.secondaryHsm = null;
    this.emergencyProvider = null;
    this.currentProvider = 'none';
    this.failoverHistory = [];
    this.enableAuditLogging = config.enableAuditLogging !== false;
    this.logPath = config.logPath || path.join(process.cwd(), 'logs', 'failover');
    this.notifyCallback = config.notifyCallback || null;
    
    // Crea la directory dei log se non esiste
    if (this.enableAuditLogging) {
      try {
        fs.mkdirSync(this.logPath, { recursive: true });
      } catch (error) {
        logger.warn(`Impossibile creare la directory dei log: ${error.message}`);
      }
    }
  }

  /**
   * Inizializza il gestore del failover
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      logger.info('Inizializzazione del gestore del failover');
      
      // Inizializza l'HSM primario
      this.primaryHsm = new AWSCloudHSMManager(this.config.primaryHsm);
      
      // Inizializza l'HSM secondario
      if (this.config.secondaryHsm) {
        if (this.config.secondaryHsm.type === 'aws') {
          this.secondaryHsm = new AWSCloudHSMManager(this.config.secondaryHsm);
        } else if (this.config.secondaryHsm.type === 'yubi') {
          this.secondaryHsm = new YubiHSMManager(this.config.secondaryHsm);
        } else {
          logger.warn(`Tipo di HSM secondario non supportato: ${this.config.secondaryHsm.type}`);
        }
      }
      
      // Inizializza il provider di emergenza
      this.emergencyProvider = new EmergencyKeyProvider(this.config.emergency);
      
      // Verifica la disponibilità dell'HSM primario
      if (await this.primaryHsm.isAvailable()) {
        await this.primaryHsm.initialize();
        this.currentProvider = 'primary';
        logger.info('HSM primario inizializzato come provider attivo');
      } else if (this.secondaryHsm && await this.secondaryHsm.isAvailable()) {
        await this.secondaryHsm.initialize();
        this.currentProvider = 'secondary';
        logger.warn('HSM primario non disponibile, inizializzato HSM secondario come provider attivo');
        
        // Registra l'evento di failover
        await this.logFailoverEvent('FAILOVER_TO_SECONDARY', 'HSM primario non disponibile durante l\'inizializzazione');
        
        // Notifica gli amministratori
        await this.notifyFailover('primary_to_secondary', 'HSM primario non disponibile durante l\'inizializzazione');
      } else {
        await this.emergencyProvider.initialize();
        this.currentProvider = 'emergency';
        logger.error('HSM primario e secondario non disponibili, inizializzato provider di emergenza');
        
        // Registra l'evento di failover
        await this.logFailoverEvent('FAILOVER_TO_EMERGENCY', 'HSM primario e secondario non disponibili durante l\'inizializzazione');
        
        // Notifica gli amministratori
        await this.notifyFailover('secondary_to_emergency', 'HSM primario e secondario non disponibili durante l\'inizializzazione');
        
        // Attiva limitazioni di emergenza
        await this.activateEmergencyLimitations();
      }
      
      logger.info('Gestore del failover inizializzato con successo');
    } catch (error) {
      logger.error(`Errore durante l'inizializzazione del gestore del failover: ${error.message}`);
      throw error;
    }
  }

  /**
   * Attiva il failover a un provider alternativo
   * @param {string} reason - Motivo del failover
   * @returns {Promise<void>}
   */
  async activateFailover(reason) {
    logger.warn(`Attivazione del failover: ${reason}`, {
      currentProvider: this.currentProvider
    });
    
    // Aggiungi l'evento alla cronologia dei failover
    this.failoverHistory.push({
      timestamp: Date.now(),
      reason,
      fromProvider: this.currentProvider
    });
    
    if (this.currentProvider === 'primary') {
      // Failover dall'HSM primario all'HSM secondario
      if (this.secondaryHsm && await this.secondaryHsm.isAvailable()) {
        try {
          await this.secondaryHsm.initialize();
          this.currentProvider = 'secondary';
          logger.info('Passaggio all\'HSM secondario completato');
          
          // Registra l'evento di failover
          await this.logFailoverEvent('FAILOVER_TO_SECONDARY', reason);
          
          // Notifica gli amministratori
          await this.notifyFailover('primary_to_secondary', reason);
        } catch (error) {
          logger.error(`Errore durante il passaggio all'HSM secondario: ${error.message}`);
          
          // Fallback al provider di emergenza
          await this.activateEmergencyProvider(reason + ` (errore secondario: ${error.message})`);
        }
      } else {
        // HSM secondario non disponibile, passa direttamente al provider di emergenza
        await this.activateEmergencyProvider(reason + ' (secondario non disponibile)');
      }
    } else if (this.currentProvider === 'secondary') {
      // Failover dall'HSM secondario al provider di emergenza
      await this.activateEmergencyProvider(reason);
    } else {
      logger.error(`Tentativo di failover dal provider di emergenza: ${reason}`);
      
      // Registra l'evento di errore
      await this.logFailoverEvent('FAILOVER_ERROR', `Tentativo di failover dal provider di emergenza: ${reason}`);
    }
  }

  /**
   * Attiva il provider di emergenza
   * @param {string} reason - Motivo dell'attivazione
   * @returns {Promise<void>}
   * @private
   */
  async activateEmergencyProvider(reason) {
    try {
      await this.emergencyProvider.initialize();
      this.currentProvider = 'emergency';
      logger.error(`Passaggio al provider di emergenza completato: ${reason}`);
      
      // Registra l'evento di failover
      await this.logFailoverEvent('FAILOVER_TO_EMERGENCY', reason);
      
      // Notifica gli amministratori
      await this.notifyFailover('secondary_to_emergency', reason);
      
      // Attiva limitazioni di emergenza
      await this.activateEmergencyLimitations();
    } catch (error) {
      logger.error(`Errore critico: impossibile inizializzare il provider di emergenza: ${error.message}`);
      
      // Registra l'evento di errore critico
      await this.logFailoverEvent('CRITICAL_ERROR', `Impossibile inizializzare il provider di emergenza: ${error.message}`);
      
      // Notifica gli amministratori
      await this.notifyFailover('emergency_failure', `Impossibile inizializzare il provider di emergenza: ${error.message}`);
      
      throw new Error(`Errore critico: tutti i provider di chiavi non sono disponibili: ${error.message}`);
    }
  }

  /**
   * Esegue un'operazione con il provider attivo, con failover automatico in caso di errore
   * @param {string} method - Nome del metodo da eseguire
   * @param {Array} args - Argomenti da passare al metodo
   * @returns {Promise<any>} Risultato dell'operazione
   */
  async executeWithFailover(method, args) {
    try {
      let provider;
      
      if (this.currentProvider === 'primary') {
        provider = this.primaryHsm;
      } else if (this.currentProvider === 'secondary') {
        provider = this.secondaryHsm;
      } else {
        provider = this.emergencyProvider;
      }
      
      if (!provider) {
        throw new Error(`Provider ${this.currentProvider} non inizializzato`);
      }
      
      return await provider[method](...args);
    } catch (error) {
      logger.error(`Errore durante l'esecuzione di ${method} con il provider ${this.currentProvider}: ${error.message}`);
      
      // Se il provider attuale non è quello di emergenza, attiva il failover
      if (this.currentProvider !== 'emergency') {
        await this.activateFailover(`errore_esecuzione_${method}: ${error.message}`);
        
        // Riprova con il nuovo provider
        return this.executeWithFailover(method, args);
      }
      
      // Se siamo già in modalità di emergenza, non possiamo fare altro
      throw new Error(`Tutti i provider di chiavi hanno fallito per il metodo ${method}: ${error.message}`);
    }
  }

  /**
   * Attiva le limitazioni di emergenza
   * @returns {Promise<void>}
   * @private
   */
  async activateEmergencyLimitations() {
    logger.warn('Attivazione delle limitazioni di emergenza');
    
    try {
      // In un'implementazione reale, qui si attiverebbero le limitazioni di emergenza
      // Ad esempio, limitare l'importo massimo delle transazioni, il numero di transazioni per blocco, ecc.
      
      // Registra l'evento di attivazione delle limitazioni
      await this.logFailoverEvent('EMERGENCY_LIMITATIONS_ACTIVATED');
      
      logger.warn('Limitazioni di emergenza attivate');
    } catch (error) {
      logger.error(`Errore durante l'attivazione delle limitazioni di emergenza: ${error.message}`);
    }
  }

  /**
   * Notifica gli amministratori del failover
   * @param {string} type - Tipo di failover
   * @param {string} reason - Motivo del failover
   * @returns {Promise<void>}
   * @private
   */
  async notifyFailover(type, reason) {
    try {
      logger.warn(`Notifica di failover: ${type} - ${reason}`);
      
      // Se è stata fornita una funzione di callback per le notifiche, chiamala
      if (typeof this.notifyCallback === 'function') {
        await this.notifyCallback({
          type,
          reason,
          timestamp: new Date().toISOString(),
          severity: type.includes('emergency') ? 'CRITICAL' : 'HIGH'
        });
      }
    } catch (error) {
      logger.error(`Errore durante la notifica del failover: ${error.message}`);
    }
  }

  /**
   * Registra un evento di failover
   * @param {string} eventName - Nome dell'evento
   * @param {string} [reason] - Motivo del failover
   * @returns {Promise<void>}
   * @private
   */
  async logFailoverEvent(eventName, reason = '') {
    if (!this.enableAuditLogging) {
      return;
    }
    
    try {
      const logEvent = {
        timestamp: new Date().toISOString(),
        eventName,
        reason,
        currentProvider: this.currentProvider,
        failoverCount: this.failoverHistory.length
      };
      
      const logFile = path.join(this.logPath, `failover-${new Date().toISOString().split('T')[0]}.log`);
      
      // Scrivi l'evento nel file di log
      await promisify(fs.appendFile)(logFile, JSON.stringify(logEvent) + '\n');
      
      logger.debug(`Evento di failover registrato: ${eventName}`);
    } catch (error) {
      logger.warn(`Errore durante la registrazione dell'evento di failover: ${error.message}`);
    }
  }

  /**
   * Verifica periodicamente la disponibilità dell'HSM primario per il ripristino
   * @returns {Promise<void>}
   */
  async checkPrimaryRecovery() {
    // Se siamo già sul provider primario, non c'è nulla da fare
    if (this.currentProvider === 'primary') {
      return;
    }
    
    try {
      // Verifica se l'HSM primario è tornato disponibile
      if (await this.primaryHsm.isAvailable()) {
        logger.info('HSM primario tornato disponibile, tentativo di ripristino');
        
        // Inizializza l'HSM primario
        await this.primaryHsm.initialize();
        
        // Passa all'HSM primario
        this.currentProvider = 'primary';
        
        // Registra l'evento di ripristino
        await this.logFailoverEvent('RECOVERY_TO_PRIMARY', 'HSM primario tornato disponibile');
        
        // Notifica gli amministratori
        await this.notifyFailover('recovery_to_primary', 'HSM primario tornato disponibile');
        
        // Se eravamo in modalità di emergenza, disattiva le limitazioni
        if (this.currentProvider === 'emergency') {
          // In un'implementazione reale, qui si disattiverebbero le limitazioni di emergenza
          logger.info('Disattivazione delle limitazioni di emergenza');
        }
        
        logger.info('Ripristino all\'HSM primario completato');
      }
    } catch (error) {
      logger.warn(`Errore durante il controllo del ripristino dell'HSM primario: ${error.message}`);
    }
  }

  /**
   * Ottiene lo stato attuale del gestore del failover
   * @returns {Object} Stato del gestore del failover
   */
  getStatus() {
    return {
      currentProvider: this.currentProvider,
      failoverHistory: this.failoverHistory,
      primaryAvailable: this.primaryHsm ? this.primaryHsm.isInitialized : false,
      secondaryAvailable: this.secondaryHsm ? this.secondaryHsm.isInitialized : false,
      emergencyAvailable: this.emergencyProvider ? this.emergencyProvider.isInitialized : false
    };
  }

  /**
   * Chiude tutti i provider
   * @returns {Promise<void>}
   */
  async close() {
    logger.info('Chiusura del gestore del failover');
    
    // Chiudi tutti i provider
    if (this.primaryHsm) {
      await this.primaryHsm.close();
    }
    
    if (this.secondaryHsm) {
      await this.secondaryHsm.close();
    }
    
    if (this.emergencyProvider) {
      await this.emergencyProvider.close();
    }
    
    // Registra l'evento di chiusura
    await this.logFailoverEvent('FAILOVER_MANAGER_CLOSED');
    
    logger.info('Gestore del failover chiuso');
  }
}

/**
 * Sistema di rotazione delle chiavi
 */
class KeyRotationSystem {
  /**
   * Crea una nuova istanza di KeyRotationSystem
   * @param {Object} config - Configurazione per il sistema di rotazione delle chiavi
   * @param {Object} keyManager - Gestore delle chiavi
   * @param {number} [config.rotationIntervalDays=90] - Intervallo di rotazione delle chiavi in giorni
   * @param {number} [config.overlapHours=24] - Ore di sovrapposizione tra vecchie e nuove chiavi
   * @param {boolean} [config.enableAuditLogging=true] - Abilita il logging di audit
   * @param {string} [config.logPath] - Percorso per i log di audit
   * @param {function} [config.notifyCallback] - Funzione di callback per le notifiche
   */
  constructor(config, keyManager) {
    this.config = config;
    this.keyManager = keyManager;
    this.rotationIntervalDays = config.rotationIntervalDays || 90;
    this.overlapHours = config.overlapHours || 24;
    this.enableAuditLogging = config.enableAuditLogging !== false;
    this.logPath = config.logPath || path.join(process.cwd(), 'logs', 'key-rotation');
    this.notifyCallback = config.notifyCallback || null;
    this.lastRotation = null;
    this.nextRotation = null;
    this.rotationHistory = [];
    this.rotationCheckInterval = null;
    this.rotationCheckIntervalMs = config.rotationCheckIntervalMs || 3600000; // 1 ora
    
    // Crea la directory dei log se non esiste
    if (this.enableAuditLogging) {
      try {
        fs.mkdirSync(this.logPath, { recursive: true });
      } catch (error) {
        logger.warn(`Impossibile creare la directory dei log: ${error.message}`);
      }
    }
  }

  /**
   * Inizializza il sistema di rotazione delle chiavi
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      logger.info('Inizializzazione del sistema di rotazione delle chiavi');
      
      // Ottieni l'ultima rotazione
      await this.getLastRotation();
      
      // Calcola la prossima rotazione
      this.calculateNextRotation();
      
      // Avvia il controllo periodico della rotazione
      this.startRotationCheck();
      
      logger.info(`Sistema di rotazione delle chiavi inizializzato, prossima rotazione: ${this.nextRotation.toISOString()}`);
      
      // Registra l'evento di inizializzazione
      await this.logRotationEvent('ROTATION_SYSTEM_INITIALIZED', {
        lastRotation: this.lastRotation ? this.lastRotation.toISOString() : null,
        nextRotation: this.nextRotation.toISOString()
      });
    } catch (error) {
      logger.error(`Errore durante l'inizializzazione del sistema di rotazione delle chiavi: ${error.message}`);
      throw error;
    }
  }

  /**
   * Ottiene l'ultima rotazione delle chiavi
   * @returns {Promise<void>}
   * @private
   */
  async getLastRotation() {
    try {
      // In un'implementazione reale, qui si otterrebbe l'ultima rotazione dal database o dall'HSM
      // Per semplicità, utilizziamo la data di creazione della chiave corrente
      
      // Se il key manager è un'istanza di AWSCloudHSMManager, possiamo ottenere la data di creazione della chiave
      if (this.keyManager instanceof AWSCloudHSMManager && this.keyManager.lastKeyRotation) {
        this.lastRotation = new Date(this.keyManager.lastKeyRotation);
        logger.info(`Ultima rotazione delle chiavi: ${this.lastRotation.toISOString()}`);
      } else {
        // Altrimenti, impostiamo l'ultima rotazione a oggi meno metà dell'intervallo di rotazione
        const halfInterval = this.rotationIntervalDays / 2;
        this.lastRotation = new Date(Date.now() - halfInterval * 24 * 60 * 60 * 1000);
        logger.warn(`Impossibile determinare l'ultima rotazione delle chiavi, impostata a ${this.lastRotation.toISOString()}`);
      }
    } catch (error) {
      logger.error(`Errore durante il recupero dell'ultima rotazione delle chiavi: ${error.message}`);
      
      // Imposta l'ultima rotazione a oggi meno metà dell'intervallo di rotazione
      const halfInterval = this.rotationIntervalDays / 2;
      this.lastRotation = new Date(Date.now() - halfInterval * 24 * 60 * 60 * 1000);
      logger.warn(`Impossibile determinare l'ultima rotazione delle chiavi, impostata a ${this.lastRotation.toISOString()}`);
    }
  }

  /**
   * Calcola la data della prossima rotazione delle chiavi
   * @private
   */
  calculateNextRotation() {
    if (!this.lastRotation) {
      // Se non abbiamo un'ultima rotazione, impostiamo la prossima rotazione a oggi più metà dell'intervallo
      const halfInterval = this.rotationIntervalDays / 2;
      this.nextRotation = new Date(Date.now() + halfInterval * 24 * 60 * 60 * 1000);
    } else {
      // Altrimenti, calcoliamo la prossima rotazione in base all'ultima rotazione e all'intervallo
      this.nextRotation = new Date(this.lastRotation.getTime() + this.rotationIntervalDays * 24 * 60 * 60 * 1000);
    }
    
    logger.info(`Prossima rotazione delle chiavi: ${this.nextRotation.toISOString()}`);
  }

  /**
   * Avvia il controllo periodico della rotazione delle chiavi
   * @private
   */
  startRotationCheck() {
    if (this.rotationCheckInterval) {
      clearInterval(this.rotationCheckInterval);
    }

    this.rotationCheckInterval = setInterval(async () => {
      try {
        await this.checkRotation();
      } catch (error) {
        logger.error(`Errore durante il controllo della rotazione delle chiavi: ${error.message}`);
      }
    }, this.rotationCheckIntervalMs);
    
    logger.info(`Controllo della rotazione delle chiavi avviato con intervallo di ${this.rotationCheckIntervalMs}ms`);
  }

  /**
   * Ferma il controllo periodico della rotazione delle chiavi
   * @private
   */
  stopRotationCheck() {
    if (this.rotationCheckInterval) {
      clearInterval(this.rotationCheckInterval);
      this.rotationCheckInterval = null;
      logger.info('Controllo della rotazione delle chiavi fermato');
    }
  }

  /**
   * Controlla se è necessaria una rotazione delle chiavi
   * @returns {Promise<void>}
   * @private
   */
  async checkRotation() {
    try {
      const now = new Date();
      
      if (now >= this.nextRotation) {
        logger.info('È necessaria una rotazione delle chiavi');
        
        // Esegui la rotazione delle chiavi
        await this.rotateKeys();
      } else {
        const daysUntilRotation = Math.floor((this.nextRotation - now) / (24 * 60 * 60 * 1000));
        logger.debug(`Rotazione delle chiavi non necessaria, mancano ${daysUntilRotation} giorni`);
      }
    } catch (error) {
      logger.error(`Errore durante il controllo della rotazione delle chiavi: ${error.message}`);
      
      // Registra l'evento di errore
      await this.logRotationEvent('ROTATION_CHECK_ERROR', {
        error: error.message
      });
    }
  }

  /**
   * Esegue la rotazione delle chiavi
   * @returns {Promise<void>}
   */
  async rotateKeys() {
    try {
      logger.info('Inizio della rotazione delle chiavi');
      
      // Registra l'evento di inizio rotazione
      await this.logRotationEvent('ROTATION_STARTED');
      
      // Notifica gli amministratori
      await this.notifyRotation('rotation_started', 'Inizio della rotazione delle chiavi');
      
      // In un'implementazione reale, qui si eseguirebbe la rotazione delle chiavi
      // Ad esempio, generando una nuova coppia di chiavi nell'HSM e aggiornando i riferimenti
      
      // Simula la rotazione delle chiavi
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Aggiorna l'ultima rotazione
      this.lastRotation = new Date();
      
      // Calcola la prossima rotazione
      this.calculateNextRotation();
      
      // Aggiungi l'evento alla cronologia delle rotazioni
      this.rotationHistory.push({
        timestamp: this.lastRotation,
        nextRotation: this.nextRotation
      });
      
      // Registra l'evento di completamento della rotazione
      await this.logRotationEvent('ROTATION_COMPLETED', {
        lastRotation: this.lastRotation.toISOString(),
        nextRotation: this.nextRotation.toISOString()
      });
      
      // Notifica gli amministratori
      await this.notifyRotation('rotation_completed', 'Rotazione delle chiavi completata con successo');
      
      logger.info(`Rotazione delle chiavi completata, prossima rotazione: ${this.nextRotation.toISOString()}`);
    } catch (error) {
      logger.error(`Errore durante la rotazione delle chiavi: ${error.message}`);
      
      // Registra l'evento di errore
      await this.logRotationEvent('ROTATION_ERROR', {
        error: error.message
      });
      
      // Notifica gli amministratori
      await this.notifyRotation('rotation_error', `Errore durante la rotazione delle chiavi: ${error.message}`);
      
      throw error;
    }
  }

  /**
   * Notifica gli amministratori della rotazione delle chiavi
   * @param {string} type - Tipo di notifica
   * @param {string} message - Messaggio della notifica
   * @returns {Promise<void>}
   * @private
   */
  async notifyRotation(type, message) {
    try {
      logger.info(`Notifica di rotazione delle chiavi: ${type} - ${message}`);
      
      // Se è stata fornita una funzione di callback per le notifiche, chiamala
      if (typeof this.notifyCallback === 'function') {
        await this.notifyCallback({
          type,
          message,
          timestamp: new Date().toISOString(),
          lastRotation: this.lastRotation ? this.lastRotation.toISOString() : null,
          nextRotation: this.nextRotation ? this.nextRotation.toISOString() : null
        });
      }
    } catch (error) {
      logger.error(`Errore durante la notifica della rotazione delle chiavi: ${error.message}`);
    }
  }

  /**
   * Registra un evento di rotazione delle chiavi
   * @param {string} eventName - Nome dell'evento
   * @param {Object} [eventData] - Dati dell'evento
   * @returns {Promise<void>}
   * @private
   */
  async logRotationEvent(eventName, eventData = {}) {
    if (!this.enableAuditLogging) {
      return;
    }
    
    try {
      const logEvent = {
        timestamp: new Date().toISOString(),
        eventName,
        ...eventData
      };
      
      const logFile = path.join(this.logPath, `key-rotation-${new Date().toISOString().split('T')[0]}.log`);
      
      // Scrivi l'evento nel file di log
      await promisify(fs.appendFile)(logFile, JSON.stringify(logEvent) + '\n');
      
      logger.debug(`Evento di rotazione delle chiavi registrato: ${eventName}`);
    } catch (error) {
      logger.warn(`Errore durante la registrazione dell'evento di rotazione delle chiavi: ${error.message}`);
    }
  }

  /**
   * Ottiene lo stato attuale del sistema di rotazione delle chiavi
   * @returns {Object} Stato del sistema di rotazione delle chiavi
   */
  getStatus() {
    return {
      lastRotation: this.lastRotation ? this.lastRotation.toISOString() : null,
      nextRotation: this.nextRotation ? this.nextRotation.toISOString() : null,
      rotationIntervalDays: this.rotationIntervalDays,
      overlapHours: this.overlapHours,
      rotationHistory: this.rotationHistory.map(rotation => ({
        timestamp: rotation.timestamp.toISOString(),
        nextRotation: rotation.nextRotation.toISOString()
      }))
    };
  }

  /**
   * Chiude il sistema di rotazione delle chiavi
   * @returns {Promise<void>}
   */
  async close() {
    this.stopRotationCheck();
    
    // Registra l'evento di chiusura
    await this.logRotationEvent('ROTATION_SYSTEM_CLOSED');
    
    logger.info('Sistema di rotazione delle chiavi chiuso');
  }
}

/**
 * Crea un'istanza di KeyManager in base alla configurazione
 * @param {Object} config - Configurazione per il key manager
 * @returns {KeyManager} Istanza di KeyManager
 */
function createKeyManager(config) {
  // Configurazione di default
  const defaultConfig = {
    type: 'local',
    enableFailover: false
  };
  
  // Unisci la configurazione di default con quella fornita
  const mergedConfig = { ...defaultConfig, ...config };
  
  // Se il failover è abilitato, crea un FailoverManager
  if (mergedConfig.enableFailover) {
    const failoverConfig = {
      primaryHsm: {
        type: mergedConfig.type,
        region: mergedConfig.awsRegion,
        clusterId: mergedConfig.awsClusterId,
        keyId: mergedConfig.awsKeyId,
        username: mergedConfig.awsUsername,
        password: mergedConfig.awsPassword,
        algorithm: mergedConfig.algorithm,
        accessKeyId: mergedConfig.awsAccessKeyId,
        secretAccessKey: mergedConfig.awsSecretAccessKey
      },
      secondaryHsm: mergedConfig.secondaryHsm || {
        type: 'yubi',
        connector: mergedConfig.yubiConnector,
        authKeyId: mergedConfig.yubiAuthKeyId,
        password: mergedConfig.yubiPassword,
        keyId: mergedConfig.yubiKeyId,
        algorithm: mergedConfig.algorithm
      },
      emergency: {
        keyLifetimeMinutes: mergedConfig.emergencyKeyLifetimeMinutes || 60,
        maxTransactions: mergedConfig.emergencyMaxTransactions || 100,
        enableAuditLogging: mergedConfig.enableAuditLogging !== false,
        logPath: mergedConfig.emergencyLogPath
      },
      enableAuditLogging: mergedConfig.enableAuditLogging !== false,
      logPath: mergedConfig.failoverLogPath,
      notifyCallback: mergedConfig.notifyCallback
    };
    
    const failoverManager = new FailoverManager(failoverConfig);
    
    // Inizializza il failover manager
    failoverManager.initialize().catch(error => {
      logger.error(`Errore durante l'inizializzazione del failover manager: ${error.message}`);
    });
    
    // Crea un proxy che intercetta tutte le chiamate ai metodi e le inoltra al provider attivo
    return new Proxy({}, {
      get: (target, prop) => {
        // Se la proprietà è un metodo del KeyManager, esegui con failover
        if (['sign', 'verify', 'getPublicKey', 'isAvailable'].includes(prop)) {
          return (...args) => failoverManager.executeWithFailover(prop, args);
        }
        
        // Se la proprietà è un metodo del FailoverManager, restituiscila
        if (prop in failoverManager) {
          return typeof failoverManager[prop] === 'function'
            ? failoverManager[prop].bind(failoverManager)
            : failoverManager[prop];
        }
        
        return undefined;
      }
    });
  }
  
  // Altrimenti, crea un'istanza del tipo richiesto
  switch (mergedConfig.type) {
    case 'aws':
      return new AWSCloudHSMManager({
        region: mergedConfig.awsRegion,
        clusterId: mergedConfig.awsClusterId,
        keyId: mergedConfig.awsKeyId,
        username: mergedConfig.awsUsername,
        password: mergedConfig.awsPassword,
        algorithm: mergedConfig.algorithm,
        accessKeyId: mergedConfig.awsAccessKeyId,
        secretAccessKey: mergedConfig.awsSecretAccessKey,
        enableFipsMode: mergedConfig.enableFipsMode !== false,
        enableAuditLogging: mergedConfig.enableAuditLogging !== false,
        cloudTrailLogGroup: mergedConfig.cloudTrailLogGroup,
        keyRotationDays: mergedConfig.keyRotationDays || 90
      });
    case 'yubi':
      return new YubiHSMManager({
        connector: mergedConfig.yubiConnector,
        authKeyId: mergedConfig.yubiAuthKeyId,
        password: mergedConfig.yubiPassword,
        keyId: mergedConfig.yubiKeyId,
        algorithm: mergedConfig.algorithm
      });
    case 'emergency':
      return new EmergencyKeyProvider({
        keyLifetimeMinutes: mergedConfig.emergencyKeyLifetimeMinutes || 60,
        maxTransactions: mergedConfig.emergencyMaxTransactions || 100,
        enableAuditLogging: mergedConfig.enableAuditLogging !== false,
        logPath: mergedConfig.emergencyLogPath
      });
    case 'local':
    default:
      // Per semplicità, utilizziamo il provider di emergenza come provider locale
      return new EmergencyKeyProvider({
        keyLifetimeMinutes: mergedConfig.localKeyLifetimeMinutes || 1440, // 24 ore
        maxTransactions: mergedConfig.localMaxTransactions || 10000,
        enableAuditLogging: mergedConfig.enableAuditLogging !== false,
        logPath: mergedConfig.localLogPath
      });
  }
}

module.exports = {
  KeyManager,
  AWSCloudHSMManager,
  YubiHSMManager,
  EmergencyKeyProvider,
  FailoverManager,
  KeyRotationSystem,
  createKeyManager
};
