/**
 * @fileoverview Utilità per la validazione dei dati
 */

import { Layer2ClientConfig } from '../client';
import { Layer2Error, ErrorCode } from '../types/errors';

/**
 * Valida la configurazione del client Layer 2
 * @param config Configurazione da validare
 * @returns true se la configurazione è valida, false altrimenti
 */
export function validateConfig(config: Layer2ClientConfig): boolean {
  // Verifica che l'URL RPC sia definito
  if (!config.rpcUrl) {
    throw new Layer2Error(
      'L\'URL RPC è obbligatorio',
      ErrorCode.MISSING_RPC_URL
    );
  }

  // Verifica che l'URL RPC sia valido
  try {
    new URL(config.rpcUrl);
  } catch (error) {
    throw new Layer2Error(
      `L'URL RPC non è valido: ${error.message}`,
      ErrorCode.INVALID_RPC_URL
    );
  }

  // Verifica che sia fornito un wallet adapter o un keypair
  if (!config.walletAdapter && !config.keypair) {
    throw new Layer2Error(
      'È necessario fornire un walletAdapter o un keypair',
      ErrorCode.NO_WALLET_OR_KEYPAIR
    );
  }

  // Verifica che il timeout sia un numero positivo
  if (config.timeout !== undefined && (typeof config.timeout !== 'number' || config.timeout <= 0)) {
    throw new Layer2Error(
      'Il timeout deve essere un numero positivo',
      ErrorCode.INVALID_TIMEOUT
    );
  }

  // Verifica che il numero massimo di tentativi sia un numero positivo
  if (config.maxRetries !== undefined && (typeof config.maxRetries !== 'number' || config.maxRetries <= 0)) {
    throw new Layer2Error(
      'Il numero massimo di tentativi deve essere un numero positivo',
      ErrorCode.INVALID_MAX_RETRIES
    );
  }

  // Verifica che l'intervallo tra i tentativi sia un numero positivo
  if (config.retryInterval !== undefined && (typeof config.retryInterval !== 'number' || config.retryInterval <= 0)) {
    throw new Layer2Error(
      'L\'intervallo tra i tentativi deve essere un numero positivo',
      ErrorCode.INVALID_RETRY_INTERVAL
    );
  }

  return true;
}

/**
 * Valida un indirizzo pubblico
 * @param address Indirizzo da validare
 * @returns true se l'indirizzo è valido, false altrimenti
 */
export function validateAddress(address: string): boolean {
  // Verifica che l'indirizzo sia definito
  if (!address) {
    return false;
  }

  // Verifica che l'indirizzo abbia la lunghezza corretta (44 caratteri per Solana)
  if (address.length !== 44) {
    return false;
  }

  // Verifica che l'indirizzo contenga solo caratteri validi in base58
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
  return base58Regex.test(address);
}

/**
 * Valida un importo
 * @param amount Importo da validare
 * @returns true se l'importo è valido, false altrimenti
 */
export function validateAmount(amount: number): boolean {
  // Verifica che l'importo sia definito
  if (amount === undefined || amount === null) {
    return false;
  }

  // Verifica che l'importo sia un numero
  if (typeof amount !== 'number') {
    return false;
  }

  // Verifica che l'importo sia positivo
  if (amount <= 0) {
    return false;
  }

  // Verifica che l'importo sia un intero
  if (!Number.isInteger(amount)) {
    return false;
  }

  return true;
}

/**
 * Valida un token
 * @param token Token da validare
 * @returns true se il token è valido, false altrimenti
 */
export function validateToken(token: string): boolean {
  // Verifica che il token sia definito
  if (!token) {
    return false;
  }

  // Per ora supportiamo solo SOL
  return token === 'SOL';
}

/**
 * Valida una transazione
 * @param transaction Transazione da validare
 * @returns true se la transazione è valida, false altrimenti
 */
export function validateTransaction(transaction: any): boolean {
  // Verifica che la transazione sia definita
  if (!transaction) {
    return false;
  }

  // Verifica che la transazione abbia un mittente
  if (!transaction.from) {
    return false;
  }

  // Verifica che la transazione abbia un destinatario
  if (!transaction.to) {
    return false;
  }

  // Verifica che la transazione abbia un importo
  if (!validateAmount(transaction.amount)) {
    return false;
  }

  // Verifica che la transazione abbia un token valido
  if (!validateToken(transaction.token)) {
    return false;
  }

  return true;
}
