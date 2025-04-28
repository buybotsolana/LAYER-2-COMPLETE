/**
 * Implementazione di Threshold Signature Scheme (TSS) per il Layer-2 su Solana
 * 
 * Questo modulo implementa un sistema di firma a soglia che consente a più parti
 * di collaborare per generare una firma valida, migliorando la sicurezza delle chiavi.
 */

const crypto = require('crypto');
const elliptic = require('elliptic');
const BN = require('bn.js');
const shamir = require('./shamir_secret_sharing');
const { Logger } = require('../logger/structured_logger');

// Inizializza la curva ellittica secp256k1
const ec = new elliptic.ec('secp256k1');

/**
 * Classe per la gestione delle firme a soglia
 */
class ThresholdSignatureScheme {
  /**
   * Crea una nuova istanza del sistema di firma a soglia
   * @param {Object} config - Configurazione del sistema
   * @param {number} config.threshold - Numero minimo di parti necessarie per firmare
   * @param {number} config.totalParties - Numero totale di parti
   * @param {Object} logger - Logger strutturato
   */
  constructor(config, logger = null) {
    this.threshold = config.threshold;
    this.totalParties = config.totalParties;
    this.logger = logger || new Logger({ service: 'threshold-signature' });
    
    // Verifica che la configurazione sia valida
    if (this.threshold > this.totalParties) {
      const error = new Error('La soglia non può essere maggiore del numero totale di parti');
      this.logger.error('Configurazione TSS non valida', { error: error.message, threshold: this.threshold, totalParties: this.totalParties });
      throw error;
    }
    
    if (this.threshold < 1) {
      const error = new Error('La soglia deve essere almeno 1');
      this.logger.error('Configurazione TSS non valida', { error: error.message, threshold: this.threshold });
      throw error;
    }
    
    this.logger.info('Sistema di firma a soglia inizializzato', { threshold: this.threshold, totalParties: this.totalParties });
  }
  
  /**
   * Genera una chiave condivisa e le parti per ogni partecipante
   * @returns {Object} Chiave pubblica condivisa e parti della chiave privata
   */
  generateSharedKey() {
    try {
      // Genera una chiave privata master
      const masterKeyPair = ec.genKeyPair();
      const masterPrivateKey = masterKeyPair.getPrivate().toString(16);
      const publicKey = masterKeyPair.getPublic('hex');
      
      // Dividi la chiave privata usando Shamir's Secret Sharing
      const shares = shamir.split(masterPrivateKey, this.threshold, this.totalParties);
      
      this.logger.info('Chiave condivisa generata con successo', { 
        threshold: this.threshold, 
        totalParties: this.totalParties,
        publicKeyPrefix: publicKey.substring(0, 8) + '...'
      });
      
      return {
        publicKey,
        shares
      };
    } catch (error) {
      this.logger.error('Errore nella generazione della chiave condivisa', { error: error.message });
      throw new Error(`Errore nella generazione della chiave condivisa: ${error.message}`);
    }
  }
  
  /**
   * Inizia il processo di firma per un messaggio
   * @param {string} message - Messaggio da firmare
   * @returns {Object} Dati di inizializzazione della firma
   */
  initializeSigningSession(message) {
    try {
      // Genera un ID univoco per la sessione di firma
      const sessionId = crypto.randomBytes(16).toString('hex');
      
      // Calcola l'hash del messaggio
      const messageHash = this._hashMessage(message);
      
      // Genera valori casuali k per ogni partecipante
      const kValues = {};
      const rValues = {};
      
      for (let i = 1; i <= this.totalParties; i++) {
        // Genera un valore k casuale
        const k = new BN(crypto.randomBytes(32).toString('hex'), 16).umod(ec.curve.n);
        kValues[i] = k.toString(16);
        
        // Calcola R = k * G (dove G è il punto generatore della curva)
        const R = ec.g.mul(k);
        rValues[i] = {
          x: R.getX().toString(16),
          y: R.getY().toString(16)
        };
      }
      
      this.logger.info('Sessione di firma inizializzata', { 
        sessionId,
        messageHashPrefix: messageHash.substring(0, 8) + '...',
        participants: this.totalParties
      });
      
      return {
        sessionId,
        messageHash,
        kValues,
        rValues
      };
    } catch (error) {
      this.logger.error('Errore nell\'inizializzazione della sessione di firma', { error: error.message });
      throw new Error(`Errore nell'inizializzazione della sessione di firma: ${error.message}`);
    }
  }
  
  /**
   * Genera una firma parziale da parte di un partecipante
   * @param {Object} sessionData - Dati della sessione di firma
   * @param {string} sessionData.sessionId - ID della sessione di firma
   * @param {string} sessionData.messageHash - Hash del messaggio
   * @param {Object} sessionData.kValues - Valori k per ogni partecipante
   * @param {Object} sessionData.rValues - Valori R per ogni partecipante
   * @param {number} participantId - ID del partecipante
   * @param {string} privateKeyShare - Parte della chiave privata del partecipante
   * @returns {Object} Firma parziale
   */
  generatePartialSignature(sessionData, participantId, privateKeyShare) {
    try {
      if (!sessionData || !sessionData.sessionId || !sessionData.messageHash) {
        throw new Error('Dati della sessione di firma non validi');
      }
      
      if (!privateKeyShare) {
        throw new Error('Parte della chiave privata non valida');
      }
      
      // Ottieni il valore k per questo partecipante
      const k = new BN(sessionData.kValues[participantId], 16);
      
      // Calcola il valore R combinato da tutti i partecipanti
      const combinedR = this._combineRValues(sessionData.rValues);
      
      // Converti la parte della chiave privata in BN
      const privateKey = new BN(privateKeyShare, 16);
      
      // Calcola la firma parziale: s_i = k_i^(-1) * (messageHash + r * privateKey_i) mod n
      const messageHash = new BN(sessionData.messageHash, 16);
      const r = new BN(combinedR.x, 16);
      
      // Calcola k^(-1)
      const kInv = k.invm(ec.curve.n);
      
      // Calcola r * privateKey_i
      const rTimesPrivateKey = r.mul(privateKey).umod(ec.curve.n);
      
      // Calcola messageHash + r * privateKey_i
      const sum = messageHash.add(rTimesPrivateKey).umod(ec.curve.n);
      
      // Calcola la firma parziale
      const partialSignature = kInv.mul(sum).umod(ec.curve.n);
      
      this.logger.info('Firma parziale generata', { 
        sessionId: sessionData.sessionId,
        participantId,
        signaturePrefix: partialSignature.toString(16).substring(0, 8) + '...'
      });
      
      return {
        sessionId: sessionData.sessionId,
        participantId,
        r: combinedR.x,
        partialSignature: partialSignature.toString(16)
      };
    } catch (error) {
      this.logger.error('Errore nella generazione della firma parziale', { 
        error: error.message,
        sessionId: sessionData?.sessionId,
        participantId
      });
      throw new Error(`Errore nella generazione della firma parziale: ${error.message}`);
    }
  }
  
  /**
   * Combina le firme parziali per ottenere la firma completa
   * @param {Array} partialSignatures - Array di firme parziali
   * @param {string} r - Valore r comune
   * @returns {Object} Firma completa
   */
  combineSignatures(partialSignatures, r) {
    try {
      if (!partialSignatures || partialSignatures.length < this.threshold) {
        throw new Error(`Sono necessarie almeno ${this.threshold} firme parziali`);
      }
      
      if (!r) {
        throw new Error('Valore r non valido');
      }
      
      // Converti r in BN
      const rBN = new BN(r, 16);
      
      // Combina le firme parziali
      let combinedSignature = new BN(0);
      
      for (const partialSig of partialSignatures) {
        const sig = new BN(partialSig.partialSignature, 16);
        combinedSignature = combinedSignature.add(sig).umod(ec.curve.n);
      }
      
      this.logger.info('Firme parziali combinate con successo', { 
        numberOfSignatures: partialSignatures.length,
        threshold: this.threshold,
        signaturePrefix: combinedSignature.toString(16).substring(0, 8) + '...'
      });
      
      // Restituisci la firma nel formato (r, s)
      return {
        r: rBN.toString(16),
        s: combinedSignature.toString(16)
      };
    } catch (error) {
      this.logger.error('Errore nella combinazione delle firme', { error: error.message });
      throw new Error(`Errore nella combinazione delle firme: ${error.message}`);
    }
  }
  
  /**
   * Verifica una firma
   * @param {string} message - Messaggio originale
   * @param {Object} signature - Firma da verificare
   * @param {string} signature.r - Componente r della firma
   * @param {string} signature.s - Componente s della firma
   * @param {string} publicKey - Chiave pubblica
   * @returns {boolean} True se la firma è valida, false altrimenti
   */
  verifySignature(message, signature, publicKey) {
    try {
      // Calcola l'hash del messaggio
      const messageHash = this._hashMessage(message);
      
      // Crea un oggetto chiave pubblica
      const key = ec.keyFromPublic(publicKey, 'hex');
      
      // Verifica la firma
      const isValid = key.verify(messageHash, {
        r: signature.r,
        s: signature.s
      });
      
      this.logger.info('Verifica della firma', { 
        isValid,
        messageHashPrefix: messageHash.substring(0, 8) + '...',
        publicKeyPrefix: publicKey.substring(0, 8) + '...'
      });
      
      return isValid;
    } catch (error) {
      this.logger.error('Errore nella verifica della firma', { error: error.message });
      throw new Error(`Errore nella verifica della firma: ${error.message}`);
    }
  }
  
  /**
   * Calcola l'hash di un messaggio
   * @private
   * @param {string} message - Messaggio da hashare
   * @returns {string} Hash del messaggio
   */
  _hashMessage(message) {
    return crypto.createHash('sha256').update(message).digest('hex');
  }
  
  /**
   * Combina i valori R di tutti i partecipanti
   * @private
   * @param {Object} rValues - Valori R per ogni partecipante
   * @returns {Object} Valore R combinato
   */
  _combineRValues(rValues) {
    let combinedR = null;
    
    // Combina tutti i valori R sommandoli sulla curva ellittica
    for (const id in rValues) {
      const R = {
        x: new BN(rValues[id].x, 16),
        y: new BN(rValues[id].y, 16)
      };
      
      const point = ec.curve.point(R.x, R.y);
      
      if (!combinedR) {
        combinedR = point;
      } else {
        combinedR = combinedR.add(point);
      }
    }
    
    return {
      x: combinedR.getX().toString(16),
      y: combinedR.getY().toString(16)
    };
  }
}

module.exports = ThresholdSignatureScheme;
