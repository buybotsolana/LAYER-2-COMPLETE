const { defaultLogger } = require('./logger');

/**
 * Classe per la gestione dei log di transazione
 * 
 * Questa classe fornisce metodi specializzati per registrare eventi
 * relativi alle transazioni cross-chain, depositi, prelievi e altre
 * operazioni critiche del Layer-2 Solana.
 */
class TransactionLogger {
  /**
   * Crea una nuova istanza del logger di transazioni
   * @param {Object} options - Opzioni di configurazione
   * @param {Object} options.logger - Istanza del logger (opzionale)
   */
  constructor(options = {}) {
    this.logger = options.logger || defaultLogger.child('transactions');
  }

  /**
   * Registra l'inizio di una transazione
   * @param {string} transactionType - Tipo di transazione (deposit, withdraw, etc.)
   * @param {Object} transactionData - Dati della transazione
   * @returns {string} ID della transazione per il tracciamento
   */
  startTransaction(transactionType, transactionData) {
    const txId = transactionData.id || `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    this.logger.info(`Starting ${transactionType} transaction`, {
      transactionId: txId,
      type: transactionType,
      timestamp: Date.now(),
      status: 'started',
      ...this._sanitizeTransactionData(transactionData)
    });
    
    return txId;
  }

  /**
   * Registra il completamento di una transazione
   * @param {string} txId - ID della transazione
   * @param {string} transactionType - Tipo di transazione
   * @param {Object} result - Risultato della transazione
   */
  completeTransaction(txId, transactionType, result) {
    this.logger.info(`Completed ${transactionType} transaction`, {
      transactionId: txId,
      type: transactionType,
      timestamp: Date.now(),
      status: 'completed',
      ...this._sanitizeTransactionData(result)
    });
  }

  /**
   * Registra il fallimento di una transazione
   * @param {string} txId - ID della transazione
   * @param {string} transactionType - Tipo di transazione
   * @param {Error|string} error - Errore che ha causato il fallimento
   * @param {Object} additionalData - Dati aggiuntivi
   */
  failTransaction(txId, transactionType, error, additionalData = {}) {
    this.logger.error(`Failed ${transactionType} transaction`, {
      transactionId: txId,
      type: transactionType,
      timestamp: Date.now(),
      status: 'failed',
      error: error instanceof Error ? error.message : error,
      errorStack: error instanceof Error ? error.stack : undefined,
      ...this._sanitizeTransactionData(additionalData)
    });
  }

  /**
   * Registra un aggiornamento di stato di una transazione
   * @param {string} txId - ID della transazione
   * @param {string} transactionType - Tipo di transazione
   * @param {string} status - Nuovo stato
   * @param {Object} additionalData - Dati aggiuntivi
   */
  updateTransactionStatus(txId, transactionType, status, additionalData = {}) {
    this.logger.info(`Updated ${transactionType} transaction status to ${status}`, {
      transactionId: txId,
      type: transactionType,
      timestamp: Date.now(),
      status,
      ...this._sanitizeTransactionData(additionalData)
    });
  }

  /**
   * Registra un deposito
   * @param {Object} depositData - Dati del deposito
   * @returns {string} ID della transazione
   */
  logDeposit(depositData) {
    return this.startTransaction('deposit', depositData);
  }

  /**
   * Registra un prelievo
   * @param {Object} withdrawalData - Dati del prelievo
   * @returns {string} ID della transazione
   */
  logWithdrawal(withdrawalData) {
    return this.startTransaction('withdrawal', withdrawalData);
  }

  /**
   * Registra una sfida (challenge)
   * @param {Object} challengeData - Dati della sfida
   * @returns {string} ID della transazione
   */
  logChallenge(challengeData) {
    return this.startTransaction('challenge', challengeData);
  }

  /**
   * Registra una finalizzazione di blocco
   * @param {Object} finalizationData - Dati della finalizzazione
   * @returns {string} ID della transazione
   */
  logBlockFinalization(finalizationData) {
    return this.startTransaction('block_finalization', finalizationData);
  }

  /**
   * Sanitizza i dati della transazione rimuovendo informazioni sensibili
   * @param {Object} data - Dati da sanitizzare
   * @returns {Object} Dati sanitizzati
   * @private
   */
  _sanitizeTransactionData(data) {
    if (!data) return {};
    
    const sanitized = { ...data };
    
    // Rimuovi campi sensibili
    ['privateKey', 'secret', 'signature', 'password'].forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }
}

module.exports = {
  TransactionLogger
};
