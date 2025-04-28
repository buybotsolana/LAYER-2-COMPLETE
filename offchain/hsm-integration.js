/**
 * Integrazione HSM con sistema multisig per il Layer-2 su Solana
 * 
 * Questo modulo implementa l'integrazione tra Hardware Security Module (HSM)
 * e il sistema di firma a soglia (TSS) per garantire la massima sicurezza
 * delle chiavi critiche del sistema.
 */

const crypto = require('crypto');
const { Logger } = require('../logger/structured_logger');
const ThresholdSignatureScheme = require('./threshold-signature');
const MultiPartyComputation = require('./multi-party-computation');
const KeyManager = require('./key_manager');

/**
 * Classe per l'integrazione HSM con multisig
 */
class HSMMultisigIntegration {
  /**
   * Crea una nuova istanza dell'integrazione HSM-multisig
   * @param {Object} config - Configurazione del sistema
   * @param {Object} config.hsm - Configurazione HSM
   * @param {string} config.hsm.provider - Provider HSM ('aws', 'yubi', o 'azure')
   * @param {Object} config.hsm.options - Opzioni specifiche del provider HSM
   * @param {Object} config.multisig - Configurazione multisig
   * @param {number} config.multisig.threshold - Soglia per le firme
   * @param {number} config.multisig.parties - Numero di parti
   * @param {Object} logger - Logger strutturato
   */
  constructor(config, logger = null) {
    this.config = config;
    this.logger = logger || new Logger({ service: 'hsm-multisig-integration' });
    
    // Inizializza il KeyManager per l'HSM
    this.initializeHSM();
    
    // Inizializza il sistema di firma a soglia
    this.tss = new ThresholdSignatureScheme({
      threshold: config.multisig.threshold,
      totalParties: config.multisig.parties
    }, this.logger);
    
    // Inizializza il sistema MPC
    this.mpc = new MultiPartyComputation({
      threshold: config.multisig.threshold,
      parties: config.multisig.parties
    }, this.logger);
    
    // Stato delle chiavi e delle sessioni
    this.keys = new Map();
    this.sessions = new Map();
    
    this.logger.info('Integrazione HSM-multisig inizializzata', { 
      hsmProvider: config.hsm.provider,
      threshold: config.multisig.threshold,
      parties: config.multisig.parties
    });
  }
  
  /**
   * Inizializza l'HSM in base al provider configurato
   * @private
   */
  initializeHSM() {
    try {
      switch (this.config.hsm.provider.toLowerCase()) {
        case 'aws':
          this.keyManager = new KeyManager.AWSCloudHSMManager(this.config.hsm.options);
          break;
        case 'yubi':
          this.keyManager = new KeyManager.YubiHSMManager(this.config.hsm.options);
          break;
        case 'azure':
          this.keyManager = new KeyManager.AzureKeyVaultManager(this.config.hsm.options);
          break;
        default:
          throw new Error(`Provider HSM non supportato: ${this.config.hsm.provider}`);
      }
      
      this.logger.info('HSM inizializzato', { provider: this.config.hsm.provider });
    } catch (error) {
      this.logger.error('Errore nell\'inizializzazione dell\'HSM', { 
        error: error.message,
        provider: this.config.hsm.provider
      });
      throw new Error(`Errore nell'inizializzazione dell'HSM: ${error.message}`);
    }
  }
  
  /**
   * Genera una nuova chiave multisig protetta da HSM
   * @param {string} keyId - Identificatore della chiave
   * @param {Object} options - Opzioni per la generazione della chiave
   * @returns {Object} Informazioni sulla chiave generata
   */
  async generateKey(keyId, options = {}) {
    try {
      this.logger.info('Generazione chiave multisig protetta da HSM', { keyId });
      
      // Verifica che la chiave non esista già
      if (this.keys.has(keyId)) {
        throw new Error(`Chiave ${keyId} già esistente`);
      }
      
      // Genera una chiave master nell'HSM
      const masterKeyInfo = await this.keyManager.generateKey({
        keyId: `${keyId}_master`,
        keyType: options.keyType || 'EC_SECP256K1',
        keyUsage: options.keyUsage || ['SIGN', 'VERIFY'],
        keyAttributes: {
          ...options.keyAttributes,
          isExportable: false,
          isExtractable: false
        }
      });
      
      // Ottieni la chiave pubblica dall'HSM
      const publicKey = await this.keyManager.getPublicKey(`${keyId}_master`);
      
      // Genera le parti della chiave per il sistema multisig
      const sharedKeyInfo = this.tss.generateSharedKey();
      
      // Memorizza le informazioni sulla chiave
      const keyInfo = {
        keyId,
        masterKeyInfo,
        publicKey,
        sharedKeyInfo: {
          publicKey: sharedKeyInfo.publicKey,
          threshold: this.config.multisig.threshold,
          parties: this.config.multisig.parties
        },
        creationTime: Date.now(),
        status: 'active',
        metadata: options.metadata || {}
      };
      
      this.keys.set(keyId, keyInfo);
      
      this.logger.info('Chiave multisig protetta da HSM generata', { 
        keyId,
        publicKeyPrefix: publicKey.substring(0, 8) + '...',
        threshold: this.config.multisig.threshold,
        parties: this.config.multisig.parties
      });
      
      // Restituisci le informazioni sulla chiave (senza le parti private)
      return {
        keyId,
        publicKey,
        threshold: this.config.multisig.threshold,
        parties: this.config.multisig.parties,
        creationTime: keyInfo.creationTime,
        status: keyInfo.status,
        metadata: keyInfo.metadata,
        shares: sharedKeyInfo.shares
      };
    } catch (error) {
      this.logger.error('Errore nella generazione della chiave multisig', { 
        error: error.message,
        keyId
      });
      throw new Error(`Errore nella generazione della chiave multisig: ${error.message}`);
    }
  }
  
  /**
   * Inizia una sessione di firma multisig con protezione HSM
   * @param {string} keyId - Identificatore della chiave
   * @param {string} message - Messaggio da firmare
   * @param {Object} options - Opzioni per la sessione di firma
   * @returns {Object} Informazioni sulla sessione di firma
   */
  async initializeSigningSession(keyId, message, options = {}) {
    try {
      this.logger.info('Inizializzazione sessione di firma multisig', { keyId });
      
      // Verifica che la chiave esista
      if (!this.keys.has(keyId)) {
        throw new Error(`Chiave ${keyId} non trovata`);
      }
      
      const keyInfo = this.keys.get(keyId);
      
      // Verifica che la chiave sia attiva
      if (keyInfo.status !== 'active') {
        throw new Error(`Chiave ${keyId} non attiva (stato: ${keyInfo.status})`);
      }
      
      // Genera un ID univoco per la sessione
      const sessionId = crypto.randomBytes(16).toString('hex');
      
      // Inizializza la sessione MPC per la firma
      const mpcSession = this.mpc.initializeSession('sign', {
        message,
        keyId,
        options
      });
      
      // Calcola l'hash del messaggio
      const messageHash = crypto.createHash('sha256').update(message).digest('hex');
      
      // Firma l'hash del messaggio con la chiave master nell'HSM
      const hsmSignature = await this.keyManager.sign(messageHash, `${keyId}_master`);
      
      // Inizializza la sessione di firma TSS
      const tssSession = this.tss.initializeSigningSession(message);
      
      // Memorizza le informazioni sulla sessione
      const sessionInfo = {
        sessionId,
        keyId,
        message,
        messageHash,
        hsmSignature,
        mpcSessionId: mpcSession.sessionId,
        tssSession,
        participants: new Set(),
        partialSignatures: {},
        startTime: Date.now(),
        expiryTime: Date.now() + (options.sessionTimeout || 3600000), // Default: 1 ora
        status: 'initialized',
        options
      };
      
      this.sessions.set(sessionId, sessionInfo);
      
      this.logger.info('Sessione di firma multisig inizializzata', { 
        sessionId,
        keyId,
        messageHashPrefix: messageHash.substring(0, 8) + '...',
        threshold: this.config.multisig.threshold,
        parties: this.config.multisig.parties
      });
      
      // Restituisci le informazioni sulla sessione
      return {
        sessionId,
        keyId,
        messageHash,
        threshold: this.config.multisig.threshold,
        parties: this.config.multisig.parties,
        expiryTime: sessionInfo.expiryTime,
        kValues: tssSession.kValues,
        rValues: tssSession.rValues
      };
    } catch (error) {
      this.logger.error('Errore nell\'inizializzazione della sessione di firma', { 
        error: error.message,
        keyId
      });
      throw new Error(`Errore nell'inizializzazione della sessione di firma: ${error.message}`);
    }
  }
  
  /**
   * Partecipa a una sessione di firma multisig
   * @param {string} sessionId - Identificatore della sessione
   * @param {number} partyId - Identificatore della parte
   * @param {string} keyShare - Parte della chiave privata
   * @returns {Object} Risultato della partecipazione
   */
  async participateInSigning(sessionId, partyId, keyShare) {
    try {
      this.logger.info('Partecipazione a sessione di firma multisig', { sessionId, partyId });
      
      // Verifica che la sessione esista
      if (!this.sessions.has(sessionId)) {
        throw new Error(`Sessione ${sessionId} non trovata`);
      }
      
      const session = this.sessions.get(sessionId);
      
      // Verifica che la sessione non sia scaduta
      if (Date.now() > session.expiryTime) {
        throw new Error(`Sessione ${sessionId} scaduta`);
      }
      
      // Verifica che la parte non abbia già partecipato
      if (session.participants.has(partyId)) {
        throw new Error(`La parte ${partyId} ha già partecipato alla sessione ${sessionId}`);
      }
      
      // Genera la firma parziale
      const partialSignature = this.tss.generatePartialSignature(
        session.tssSession,
        partyId,
        keyShare
      );
      
      // Partecipa alla sessione MPC
      this.mpc.participate(session.mpcSessionId, partyId, {
        privateKeyShare: keyShare
      });
      
      // Aggiungi la parte ai partecipanti
      session.participants.add(partyId);
      session.partialSignatures[partyId] = partialSignature;
      
      // Verifica se abbiamo raggiunto la soglia
      if (session.participants.size >= this.config.multisig.threshold) {
        session.status = 'threshold_reached';
        
        // Tenta di completare la sessione
        await this._tryCompleteSigningSession(session);
      }
      
      this.logger.info('Partecipazione alla sessione di firma registrata', { 
        sessionId,
        partyId,
        participantsCount: session.participants.size,
        threshold: this.config.multisig.threshold,
        status: session.status
      });
      
      return {
        sessionId,
        partyId,
        status: session.status,
        participantsCount: session.participants.size,
        threshold: this.config.multisig.threshold,
        partialSignature: {
          r: partialSignature.r,
          partialSignature: partialSignature.partialSignature.substring(0, 8) + '...'
        }
      };
    } catch (error) {
      this.logger.error('Errore nella partecipazione alla sessione di firma', { 
        error: error.message,
        sessionId,
        partyId
      });
      throw new Error(`Errore nella partecipazione alla sessione di firma: ${error.message}`);
    }
  }
  
  /**
   * Tenta di completare una sessione di firma
   * @private
   * @param {Object} session - Sessione di firma
   * @returns {boolean} True se la sessione è stata completata, false altrimenti
   */
  async _tryCompleteSigningSession(session) {
    // Verifica che abbiamo raggiunto la soglia
    if (session.participants.size < this.config.multisig.threshold) {
      return false;
    }
    
    try {
      // Raccogli le firme parziali
      const partialSignatures = Object.values(session.partialSignatures);
      
      // Combina le firme parziali
      const tssSignature = this.tss.combineSignatures(
        partialSignatures,
        session.tssSession.rValues[1].x // Usa il valore r della prima parte
      );
      
      // Verifica la firma TSS
      const isTssValid = this.tss.verifySignature(
        session.message,
        tssSignature,
        this.keys.get(session.keyId).sharedKeyInfo.publicKey
      );
      
      if (!isTssValid) {
        throw new Error('Firma TSS non valida');
      }
      
      // Verifica la firma HSM
      const isHsmValid = await this.keyManager.verify(
        session.messageHash,
        session.hsmSignature,
        `${session.keyId}_master`
      );
      
      if (!isHsmValid) {
        throw new Error('Firma HSM non valida');
      }
      
      // Combina le firme HSM e TSS
      const combinedSignature = this._combineSignatures(
        session.hsmSignature,
        tssSignature
      );
      
      // Aggiorna lo stato della sessione
      session.status = 'completed';
      session.completionTime = Date.now();
      session.result = {
        hsmSignature: session.hsmSignature,
        tssSignature,
        combinedSignature
      };
      
      this.logger.info('Sessione di firma completata', { 
        sessionId: session.sessionId,
        keyId: session.keyId,
        participantsCount: session.participants.size,
        threshold: this.config.multisig.threshold,
        duration: session.completionTime - session.startTime
      });
      
      return true;
    } catch (error) {
      // Aggiorna lo stato della sessione
      session.status = 'failed';
      session.error = error.message;
      
      this.logger.error('Errore nel completamento della sessione di firma', { 
        error: error.message,
        sessionId: session.sessionId,
        keyId: session.keyId
      });
      
      return false;
    }
  }
  
  /**
   * Combina le firme HSM e TSS
   * @private
   * @param {string} hsmSignature - Firma HSM
   * @param {Object} tssSignature - Firma TSS
   * @returns {string} Firma combinata
   */
  _combineSignatures(hsmSignature, tssSignature) {
    // Concatena le firme con un delimitatore
    return `${hsmSignature}:${tssSignature.r}:${tssSignature.s}`;
  }
  
  /**
   * Ottiene il risultato di una sessione di firma
   * @param {string} sessionId - Identificatore della sessione
   * @returns {Object} Risultato della sessione
   */
  async getSigningResult(sessionId) {
    try {
      // Verifica che la sessione esista
      if (!this.sessions.has(sessionId)) {
        throw new Error(`Sessione ${sessionId} non trovata`);
      }
      
      const session = this.sessions.get(sessionId);
      
      // Verifica che la sessione sia completata
      if (session.status !== 'completed') {
        throw new Error(`Sessione ${sessionId} non completata (stato: ${session.status})`);
      }
      
      this.logger.info('Risultato della sessione di firma richiesto', { 
        sessionId,
        keyId: session.keyId,
        status: session.status
      });
      
      return {
        sessionId,
        keyId: session.keyId,
        status: session.status,
        participantsCount: session.participants.size,
        threshold: this.config.multisig.threshold,
        startTime: session.startTime,
        completionTime: session.completionTime,
        messageHash: session.messageHash,
        result: session.result
      };
    } catch (error) {
      this.logger.error('Errore nel recupero del risultato della sessione di firma', { 
        error: error.message,
        sessionId
      });
      throw new Error(`Errore nel recupero del risultato della sessione di firma: ${error.message}`);
    }
  }
  
  /**
   * Verifica una firma combinata
   * @param {string} message - Messaggio originale
   * @param {string} combinedSignature - Firma combinata
   * @param {string} keyId - Identificatore della chiave
   * @returns {boolean} True se la firma è valida, false altrimenti
   */
  async verifySignature(message, combinedSignature, keyId) {
    try {
      // Verifica che la chiave esista
      if (!this.keys.has(keyId)) {
        throw new Error(`Chiave ${keyId} non trovata`);
      }
      
      const keyInfo = this.keys.get(keyId);
      
      // Calcola l'hash del messaggio
      const messageHash = crypto.createHash('sha256').update(message).digest('hex');
      
      // Estrai le firme
      const [hsmSignature, tssR, tssS] = combinedSignature.split(':');
      
      // Verifica la firma HSM
      const isHsmValid = await this.keyManager.verify(
        messageHash,
        hsmSignature,
        `${keyId}_master`
      );
      
      if (!isHsmValid) {
        this.logger.warn('Verifica firma HSM fallita', { keyId, messageHashPrefix: messageHash.substring(0, 8) + '...' });
        return false;
      }
      
      // Verifica la firma TSS
      const isTssValid = this.tss.verifySignature(
        message,
        { r: tssR, s: tssS },
        keyInfo.sharedKeyInfo.publicKey
      );
      
      if (!isTssValid) {
        this.logger.warn('Verifica firma TSS fallita', { keyId, messageHashPrefix: messageHash.substring(0, 8) + '...' });
        return false;
      }
      
      this.logger.info('Verifica firma combinata completata', { 
        keyId,
        messageHashPrefix: messageHash.substring(0, 8) + '...',
        isValid: true
      });
      
      return true;
    } catch (error) {
      this.logger.error('Errore nella verifica della firma', { 
        error: error.message,
        keyId
      });
      throw new Error(`Errore nella verifica della firma: ${error.message}`);
    }
  }
  
  /**
   * Ruota una chiave multisig protetta da HSM
   * @param {string} keyId - Identificatore della chiave
   * @param {Object} options - Opzioni per la rotazione
   * @returns {Object} Informazioni sulla nuova chiave
   */
  async rotateKey(keyId, options = {}) {
    try {
      this.logger.info('Rotazione chiave multisig protetta da HSM', { keyId });
      
      // Verifica che la chiave esista
      if (!this.keys.has(keyId)) {
        throw new Error(`Chiave ${keyId} non trovata`);
      }
      
      const oldKeyInfo = this.keys.get(keyId);
      
      // Verifica che la chiave sia attiva
      if (oldKeyInfo.status !== 'active') {
        throw new Error(`Chiave ${keyId} non attiva (stato: ${oldKeyInfo.status})`);
      }
      
      // Genera un nuovo ID per la chiave
      const newKeyId = options.newKeyId || `${keyId}_${Date.now()}`;
      
      // Genera una nuova chiave
      const newKeyInfo = await this.generateKey(newKeyId, {
        ...options,
        metadata: {
          ...options.metadata,
          previousKeyId: keyId,
          rotationTime: Date.now()
        }
      });
      
      // Aggiorna lo stato della vecchia chiave
      oldKeyInfo.status = 'rotating';
      oldKeyInfo.rotationInfo = {
        newKeyId,
        rotationTime: Date.now(),
        gracePeriod: options.gracePeriod || 86400000 // Default: 24 ore
      };
      
      // Pianifica la disattivazione della vecchia chiave
      setTimeout(() => {
        if (this.keys.has(keyId)) {
          const keyInfo = this.keys.get(keyId);
          keyInfo.status = 'inactive';
          
          this.logger.info('Chiave disattivata dopo periodo di grazia', { 
            keyId,
            newKeyId,
            gracePeriod: keyInfo.rotationInfo.gracePeriod
          });
        }
      }, options.gracePeriod || 86400000);
      
      this.logger.info('Chiave multisig protetta da HSM ruotata', { 
        oldKeyId: keyId,
        newKeyId,
        gracePeriod: options.gracePeriod || 86400000
      });
      
      return newKeyInfo;
    } catch (error) {
      this.logger.error('Errore nella rotazione della chiave multisig', { 
        error: error.message,
        keyId
      });
      throw new Error(`Errore nella rotazione della chiave multisig: ${error.message}`);
    }
  }
  
  /**
   * Esegue il backup di una chiave multisig protetta da HSM
   * @param {string} keyId - Identificatore della chiave
   * @param {Object} options - Opzioni per il backup
   * @returns {Object} Informazioni sul backup
   */
  async backupKey(keyId, options = {}) {
    try {
      this.logger.info('Backup chiave multisig protetta da HSM', { keyId });
      
      // Verifica che la chiave esista
      if (!this.keys.has(keyId)) {
        throw new Error(`Chiave ${keyId} non trovata`);
      }
      
      const keyInfo = this.keys.get(keyId);
      
      // Esegui il backup della chiave master nell'HSM
      const masterKeyBackup = await this.keyManager.backupKey(`${keyId}_master`, {
        ...options,
        encryptionKey: options.encryptionKey || crypto.randomBytes(32).toString('hex')
      });
      
      // Crea un backup delle informazioni sulla chiave
      const keyInfoBackup = {
        keyId,
        publicKey: keyInfo.publicKey,
        sharedKeyInfo: keyInfo.sharedKeyInfo,
        creationTime: keyInfo.creationTime,
        status: keyInfo.status,
        metadata: keyInfo.metadata,
        backupTime: Date.now(),
        backupId: options.backupId || crypto.randomBytes(16).toString('hex')
      };
      
      // Cifra il backup
      const encryptedBackup = this._encryptBackup(
        JSON.stringify(keyInfoBackup),
        options.encryptionKey || masterKeyBackup.encryptionKey
      );
      
      this.logger.info('Backup chiave multisig completato', { 
        keyId,
        backupId: keyInfoBackup.backupId
      });
      
      return {
        backupId: keyInfoBackup.backupId,
        keyId,
        backupTime: keyInfoBackup.backupTime,
        masterKeyBackup,
        encryptedBackup
      };
    } catch (error) {
      this.logger.error('Errore nel backup della chiave multisig', { 
        error: error.message,
        keyId
      });
      throw new Error(`Errore nel backup della chiave multisig: ${error.message}`);
    }
  }
  
  /**
   * Cifra un backup
   * @private
   * @param {string} data - Dati da cifrare
   * @param {string} encryptionKey - Chiave di cifratura
   * @returns {Object} Dati cifrati
   */
  _encryptBackup(data, encryptionKey) {
    // Deriva una chiave di cifratura dall'encryption key
    const key = crypto.createHash('sha256').update(encryptionKey).digest();
    
    // Genera un IV casuale
    const iv = crypto.randomBytes(16);
    
    // Cifra i dati
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return {
      iv: iv.toString('hex'),
      encryptedData: encrypted,
      algorithm: 'aes-256-cbc'
    };
  }
  
  /**
   * Decifra un backup
   * @private
   * @param {Object} encryptedBackup - Backup cifrato
   * @param {string} encryptionKey - Chiave di cifratura
   * @returns {string} Dati decifrati
   */
  _decryptBackup(encryptedBackup, encryptionKey) {
    // Deriva una chiave di cifratura dall'encryption key
    const key = crypto.createHash('sha256').update(encryptionKey).digest();
    
    // Decifra i dati
    const decipher = crypto.createDecipheriv(
      encryptedBackup.algorithm,
      key,
      Buffer.from(encryptedBackup.iv, 'hex')
    );
    
    let decrypted = decipher.update(encryptedBackup.encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
  
  /**
   * Ripristina una chiave multisig protetta da HSM
   * @param {Object} backup - Backup della chiave
   * @param {string} encryptionKey - Chiave di cifratura
   * @param {Object} options - Opzioni per il ripristino
   * @returns {Object} Informazioni sulla chiave ripristinata
   */
  async restoreKey(backup, encryptionKey, options = {}) {
    try {
      this.logger.info('Ripristino chiave multisig protetta da HSM', { 
        backupId: backup.backupId,
        keyId: backup.keyId
      });
      
      // Decifra il backup
      const decryptedBackup = this._decryptBackup(backup.encryptedBackup, encryptionKey);
      const keyInfoBackup = JSON.parse(decryptedBackup);
      
      // Verifica che la chiave non esista già
      if (this.keys.has(keyInfoBackup.keyId) && !options.overwrite) {
        throw new Error(`Chiave ${keyInfoBackup.keyId} già esistente`);
      }
      
      // Ripristina la chiave master nell'HSM
      await this.keyManager.restoreKey(backup.masterKeyBackup, encryptionKey);
      
      // Memorizza le informazioni sulla chiave
      this.keys.set(keyInfoBackup.keyId, {
        ...keyInfoBackup,
        masterKeyInfo: {
          keyId: `${keyInfoBackup.keyId}_master`,
          restored: true,
          restoreTime: Date.now()
        },
        status: options.status || 'active',
        restoreTime: Date.now(),
        metadata: {
          ...keyInfoBackup.metadata,
          restored: true,
          restoreTime: Date.now()
        }
      });
      
      this.logger.info('Chiave multisig protetta da HSM ripristinata', { 
        keyId: keyInfoBackup.keyId,
        backupId: backup.backupId,
        status: options.status || 'active'
      });
      
      return {
        keyId: keyInfoBackup.keyId,
        publicKey: keyInfoBackup.publicKey,
        threshold: keyInfoBackup.sharedKeyInfo.threshold,
        parties: keyInfoBackup.sharedKeyInfo.parties,
        creationTime: keyInfoBackup.creationTime,
        restoreTime: Date.now(),
        status: options.status || 'active',
        metadata: keyInfoBackup.metadata
      };
    } catch (error) {
      this.logger.error('Errore nel ripristino della chiave multisig', { 
        error: error.message,
        backupId: backup.backupId,
        keyId: backup.keyId
      });
      throw new Error(`Errore nel ripristino della chiave multisig: ${error.message}`);
    }
  }
  
  /**
   * Ottiene informazioni su una chiave
   * @param {string} keyId - Identificatore della chiave
   * @returns {Object} Informazioni sulla chiave
   */
  getKeyInfo(keyId) {
    try {
      // Verifica che la chiave esista
      if (!this.keys.has(keyId)) {
        throw new Error(`Chiave ${keyId} non trovata`);
      }
      
      const keyInfo = this.keys.get(keyId);
      
      this.logger.info('Informazioni chiave richieste', { keyId });
      
      // Restituisci le informazioni sulla chiave (senza le parti private)
      return {
        keyId,
        publicKey: keyInfo.publicKey,
        threshold: keyInfo.sharedKeyInfo.threshold,
        parties: keyInfo.sharedKeyInfo.parties,
        creationTime: keyInfo.creationTime,
        status: keyInfo.status,
        metadata: keyInfo.metadata,
        rotationInfo: keyInfo.rotationInfo
      };
    } catch (error) {
      this.logger.error('Errore nel recupero delle informazioni sulla chiave', { 
        error: error.message,
        keyId
      });
      throw new Error(`Errore nel recupero delle informazioni sulla chiave: ${error.message}`);
    }
  }
  
  /**
   * Elenca tutte le chiavi
   * @param {Object} options - Opzioni per la lista
   * @returns {Array} Lista delle chiavi
   */
  listKeys(options = {}) {
    try {
      const keys = [];
      
      for (const [keyId, keyInfo] of this.keys.entries()) {
        // Filtra per stato se specificato
        if (options.status && keyInfo.status !== options.status) {
          continue;
        }
        
        keys.push({
          keyId,
          publicKey: keyInfo.publicKey,
          threshold: keyInfo.sharedKeyInfo.threshold,
          parties: keyInfo.sharedKeyInfo.parties,
          creationTime: keyInfo.creationTime,
          status: keyInfo.status,
          metadata: keyInfo.metadata
        });
      }
      
      this.logger.info('Lista chiavi richiesta', { 
        count: keys.length,
        statusFilter: options.status
      });
      
      return keys;
    } catch (error) {
      this.logger.error('Errore nella lista delle chiavi', { 
        error: error.message
      });
      throw new Error(`Errore nella lista delle chiavi: ${error.message}`);
    }
  }
  
  /**
   * Pulisce le sessioni scadute
   * @returns {number} Numero di sessioni pulite
   */
  cleanupExpiredSessions() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now > session.expiryTime) {
        this.sessions.delete(sessionId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      this.logger.info('Sessioni scadute pulite', { cleanedCount });
    }
    
    return cleanedCount;
  }
}

module.exports = HSMMultisigIntegration;
