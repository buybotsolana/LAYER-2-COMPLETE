/**
 * Implementazione di Multi-Party Computation (MPC) per il Layer-2 su Solana
 * 
 * Questo modulo implementa un sistema di calcolo multi-parte che consente a più parti
 * di collaborare per eseguire calcoli su dati privati senza rivelare i dati stessi.
 */

const crypto = require('crypto');
const BN = require('bn.js');
const { Logger } = require('../logger/structured_logger');
const ThresholdSignatureScheme = require('./threshold-signature');

/**
 * Classe per la gestione del calcolo multi-parte
 */
class MultiPartyComputation {
  /**
   * Crea una nuova istanza del sistema MPC
   * @param {Object} config - Configurazione del sistema
   * @param {number} config.parties - Numero di parti partecipanti
   * @param {number} config.threshold - Soglia minima per le operazioni
   * @param {Object} logger - Logger strutturato
   */
  constructor(config, logger = null) {
    this.parties = config.parties;
    this.threshold = config.threshold || Math.floor(this.parties / 2) + 1;
    this.logger = logger || new Logger({ service: 'multi-party-computation' });
    
    // Inizializza il sistema di firma a soglia
    this.tss = new ThresholdSignatureScheme({
      threshold: this.threshold,
      totalParties: this.parties
    }, this.logger);
    
    // Stato delle sessioni MPC
    this.sessions = new Map();
    
    this.logger.info('Sistema MPC inizializzato', { 
      parties: this.parties, 
      threshold: this.threshold 
    });
  }
  
  /**
   * Inizializza una nuova sessione MPC
   * @param {string} operation - Tipo di operazione (sign, encrypt, decrypt, etc.)
   * @param {Object} params - Parametri specifici dell'operazione
   * @returns {Object} Dati di inizializzazione della sessione
   */
  initializeSession(operation, params = {}) {
    try {
      // Genera un ID univoco per la sessione
      const sessionId = crypto.randomBytes(16).toString('hex');
      
      // Crea la sessione
      const session = {
        id: sessionId,
        operation,
        params,
        state: 'initialized',
        participants: new Set(),
        shares: {},
        results: {},
        startTime: Date.now(),
        expiryTime: Date.now() + 3600000, // 1 ora di validità
      };
      
      // Memorizza la sessione
      this.sessions.set(sessionId, session);
      
      this.logger.info('Sessione MPC inizializzata', { 
        sessionId,
        operation,
        threshold: this.threshold,
        parties: this.parties
      });
      
      return {
        sessionId,
        operation,
        threshold: this.threshold,
        parties: this.parties,
        expiryTime: session.expiryTime
      };
    } catch (error) {
      this.logger.error('Errore nell\'inizializzazione della sessione MPC', { 
        error: error.message,
        operation
      });
      throw new Error(`Errore nell'inizializzazione della sessione MPC: ${error.message}`);
    }
  }
  
  /**
   * Partecipa a una sessione MPC
   * @param {string} sessionId - ID della sessione
   * @param {number} partyId - ID della parte partecipante
   * @param {Object} data - Dati specifici dell'operazione
   * @returns {Object} Risultato della partecipazione
   */
  participate(sessionId, partyId, data) {
    try {
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
      
      // Aggiungi la parte ai partecipanti
      session.participants.add(partyId);
      
      // Elabora i dati in base al tipo di operazione
      let result;
      switch (session.operation) {
        case 'sign':
          result = this._processSignParticipation(session, partyId, data);
          break;
        case 'encrypt':
          result = this._processEncryptParticipation(session, partyId, data);
          break;
        case 'decrypt':
          result = this._processDecryptParticipation(session, partyId, data);
          break;
        case 'compute':
          result = this._processComputeParticipation(session, partyId, data);
          break;
        default:
          throw new Error(`Operazione ${session.operation} non supportata`);
      }
      
      // Verifica se abbiamo raggiunto la soglia
      if (session.participants.size >= this.threshold) {
        session.state = 'threshold_reached';
        
        // Tenta di completare la sessione
        this._tryCompleteSession(session);
      }
      
      this.logger.info('Partecipazione alla sessione MPC registrata', { 
        sessionId,
        partyId,
        operation: session.operation,
        participantsCount: session.participants.size,
        threshold: this.threshold,
        state: session.state
      });
      
      return {
        sessionId,
        partyId,
        state: session.state,
        participantsCount: session.participants.size,
        threshold: this.threshold,
        result
      };
    } catch (error) {
      this.logger.error('Errore nella partecipazione alla sessione MPC', { 
        error: error.message,
        sessionId,
        partyId
      });
      throw new Error(`Errore nella partecipazione alla sessione MPC: ${error.message}`);
    }
  }
  
  /**
   * Elabora la partecipazione per un'operazione di firma
   * @private
   * @param {Object} session - Sessione MPC
   * @param {number} partyId - ID della parte partecipante
   * @param {Object} data - Dati per l'operazione di firma
   * @returns {Object} Risultato dell'elaborazione
   */
  _processSignParticipation(session, partyId, data) {
    // Verifica che i dati contengano la parte della chiave privata e il messaggio
    if (!data.privateKeyShare) {
      throw new Error('Parte della chiave privata mancante');
    }
    
    // Se è il primo partecipante, inizializza la sessione di firma
    if (session.participants.size === 1) {
      const signingSession = this.tss.initializeSigningSession(session.params.message);
      session.signingSession = signingSession;
    }
    
    // Genera la firma parziale
    const partialSignature = this.tss.generatePartialSignature(
      session.signingSession,
      partyId,
      data.privateKeyShare
    );
    
    // Memorizza la firma parziale
    session.shares[partyId] = partialSignature;
    
    return {
      partialSignature: {
        r: partialSignature.r,
        partialSignature: partialSignature.partialSignature.substring(0, 8) + '...'
      }
    };
  }
  
  /**
   * Elabora la partecipazione per un'operazione di cifratura
   * @private
   * @param {Object} session - Sessione MPC
   * @param {number} partyId - ID della parte partecipante
   * @param {Object} data - Dati per l'operazione di cifratura
   * @returns {Object} Risultato dell'elaborazione
   */
  _processEncryptParticipation(session, partyId, data) {
    // Verifica che i dati contengano la parte della chiave
    if (!data.keyShare) {
      throw new Error('Parte della chiave mancante');
    }
    
    // Genera una parte casuale per la cifratura
    const randomShare = crypto.randomBytes(32).toString('hex');
    
    // Memorizza la parte
    session.shares[partyId] = {
      keyShare: data.keyShare,
      randomShare
    };
    
    return {
      randomShare: randomShare.substring(0, 8) + '...'
    };
  }
  
  /**
   * Elabora la partecipazione per un'operazione di decifratura
   * @private
   * @param {Object} session - Sessione MPC
   * @param {number} partyId - ID della parte partecipante
   * @param {Object} data - Dati per l'operazione di decifratura
   * @returns {Object} Risultato dell'elaborazione
   */
  _processDecryptParticipation(session, partyId, data) {
    // Verifica che i dati contengano la parte della chiave
    if (!data.keyShare) {
      throw new Error('Parte della chiave mancante');
    }
    
    // Calcola la parte di decifratura
    const decryptionShare = this._computeDecryptionShare(
      data.keyShare,
      session.params.ciphertext
    );
    
    // Memorizza la parte
    session.shares[partyId] = {
      keyShare: data.keyShare,
      decryptionShare
    };
    
    return {
      decryptionShare: decryptionShare.substring(0, 8) + '...'
    };
  }
  
  /**
   * Elabora la partecipazione per un'operazione di calcolo generico
   * @private
   * @param {Object} session - Sessione MPC
   * @param {number} partyId - ID della parte partecipante
   * @param {Object} data - Dati per l'operazione di calcolo
   * @returns {Object} Risultato dell'elaborazione
   */
  _processComputeParticipation(session, partyId, data) {
    // Verifica che i dati contengano l'input
    if (!data.input) {
      throw new Error('Input mancante');
    }
    
    // Memorizza l'input
    session.shares[partyId] = {
      input: data.input
    };
    
    return {
      inputProcessed: true
    };
  }
  
  /**
   * Tenta di completare una sessione MPC
   * @private
   * @param {Object} session - Sessione MPC
   * @returns {boolean} True se la sessione è stata completata, false altrimenti
   */
  _tryCompleteSession(session) {
    // Verifica che abbiamo raggiunto la soglia
    if (session.participants.size < this.threshold) {
      return false;
    }
    
    try {
      // Completa la sessione in base al tipo di operazione
      let result;
      switch (session.operation) {
        case 'sign':
          result = this._completeSignSession(session);
          break;
        case 'encrypt':
          result = this._completeEncryptSession(session);
          break;
        case 'decrypt':
          result = this._completeDecryptSession(session);
          break;
        case 'compute':
          result = this._completeComputeSession(session);
          break;
        default:
          throw new Error(`Operazione ${session.operation} non supportata`);
      }
      
      // Aggiorna lo stato della sessione
      session.state = 'completed';
      session.completionTime = Date.now();
      session.result = result;
      
      this.logger.info('Sessione MPC completata', { 
        sessionId: session.id,
        operation: session.operation,
        participantsCount: session.participants.size,
        threshold: this.threshold,
        duration: session.completionTime - session.startTime
      });
      
      return true;
    } catch (error) {
      // Aggiorna lo stato della sessione
      session.state = 'failed';
      session.error = error.message;
      
      this.logger.error('Errore nel completamento della sessione MPC', { 
        error: error.message,
        sessionId: session.id,
        operation: session.operation
      });
      
      return false;
    }
  }
  
  /**
   * Completa una sessione di firma
   * @private
   * @param {Object} session - Sessione MPC
   * @returns {Object} Risultato della firma
   */
  _completeSignSession(session) {
    // Raccogli le firme parziali
    const partialSignatures = Object.values(session.shares);
    
    // Combina le firme parziali
    const signature = this.tss.combineSignatures(
      partialSignatures,
      session.signingSession.rValues[1].x // Usa il valore r della prima parte
    );
    
    return {
      signature,
      message: session.params.message
    };
  }
  
  /**
   * Completa una sessione di cifratura
   * @private
   * @param {Object} session - Sessione MPC
   * @returns {Object} Risultato della cifratura
   */
  _completeEncryptSession(session) {
    // Combina le parti casuali
    let combinedRandom = '';
    for (const partyId of session.participants) {
      combinedRandom += session.shares[partyId].randomShare;
    }
    
    // Calcola un hash del valore combinato per ottenere una chiave di cifratura
    const encryptionKey = crypto.createHash('sha256').update(combinedRandom).digest();
    
    // Cifra il messaggio
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, iv);
    let encrypted = cipher.update(session.params.plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return {
      ciphertext: encrypted,
      iv: iv.toString('hex')
    };
  }
  
  /**
   * Completa una sessione di decifratura
   * @private
   * @param {Object} session - Sessione MPC
   * @returns {Object} Risultato della decifratura
   */
  _completeDecryptSession(session) {
    // Combina le parti di decifratura
    let combinedShares = '';
    for (const partyId of session.participants) {
      combinedShares += session.shares[partyId].decryptionShare;
    }
    
    // Calcola un hash del valore combinato per ottenere la chiave di decifratura
    const decryptionKey = crypto.createHash('sha256').update(combinedShares).digest();
    
    // Decifra il messaggio
    const decipher = crypto.createDecipheriv('aes-256-cbc', decryptionKey, Buffer.from(session.params.iv, 'hex'));
    let decrypted = decipher.update(session.params.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return {
      plaintext: decrypted
    };
  }
  
  /**
   * Completa una sessione di calcolo generico
   * @private
   * @param {Object} session - Sessione MPC
   * @returns {Object} Risultato del calcolo
   */
  _completeComputeSession(session) {
    // Raccogli gli input
    const inputs = [];
    for (const partyId of session.participants) {
      inputs.push(session.shares[partyId].input);
    }
    
    // Esegui il calcolo specificato nei parametri della sessione
    const result = this._executeComputation(inputs, session.params.computation);
    
    return {
      result
    };
  }
  
  /**
   * Esegue un calcolo generico sugli input
   * @private
   * @param {Array} inputs - Input per il calcolo
   * @param {string} computation - Tipo di calcolo da eseguire
   * @returns {*} Risultato del calcolo
   */
  _executeComputation(inputs, computation) {
    switch (computation) {
      case 'sum':
        return inputs.reduce((sum, input) => sum + parseFloat(input), 0);
      case 'average':
        return inputs.reduce((sum, input) => sum + parseFloat(input), 0) / inputs.length;
      case 'max':
        return Math.max(...inputs.map(input => parseFloat(input)));
      case 'min':
        return Math.min(...inputs.map(input => parseFloat(input)));
      case 'and':
        return inputs.every(input => Boolean(input));
      case 'or':
        return inputs.some(input => Boolean(input));
      default:
        throw new Error(`Tipo di calcolo ${computation} non supportato`);
    }
  }
  
  /**
   * Calcola una parte di decifratura
   * @private
   * @param {string} keyShare - Parte della chiave
   * @param {string} ciphertext - Testo cifrato
   * @returns {string} Parte di decifratura
   */
  _computeDecryptionShare(keyShare, ciphertext) {
    // Questo è un esempio semplificato. In un'implementazione reale,
    // si utilizzerebbe un algoritmo di crittografia a soglia più complesso.
    const hash = crypto.createHash('sha256')
      .update(keyShare + ciphertext)
      .digest('hex');
    
    return hash;
  }
  
  /**
   * Ottiene il risultato di una sessione MPC
   * @param {string} sessionId - ID della sessione
   * @returns {Object} Risultato della sessione
   */
  getSessionResult(sessionId) {
    try {
      // Verifica che la sessione esista
      if (!this.sessions.has(sessionId)) {
        throw new Error(`Sessione ${sessionId} non trovata`);
      }
      
      const session = this.sessions.get(sessionId);
      
      // Verifica che la sessione sia completata
      if (session.state !== 'completed') {
        throw new Error(`Sessione ${sessionId} non completata (stato: ${session.state})`);
      }
      
      this.logger.info('Risultato della sessione MPC richiesto', { 
        sessionId,
        operation: session.operation,
        state: session.state
      });
      
      return {
        sessionId,
        operation: session.operation,
        state: session.state,
        participantsCount: session.participants.size,
        threshold: this.threshold,
        startTime: session.startTime,
        completionTime: session.completionTime,
        result: session.result
      };
    } catch (error) {
      this.logger.error('Errore nel recupero del risultato della sessione MPC', { 
        error: error.message,
        sessionId
      });
      throw new Error(`Errore nel recupero del risultato della sessione MPC: ${error.message}`);
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
      this.logger.info('Sessioni MPC scadute pulite', { cleanedCount });
    }
    
    return cleanedCount;
  }
}

module.exports = MultiPartyComputation;
