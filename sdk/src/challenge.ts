/**
 * @fileoverview Modulo per le operazioni di challenge su Layer 2
 */

import { PublicKey } from '@solana/web3.js';
import { Layer2Client } from './client';
import { serializeData, deserializeData } from './utils/serialization';
import { Layer2Error, ErrorCode } from './types/errors';

/**
 * Parametri per la sottomissione di una challenge
 */
export interface SubmitChallengeParams {
  /** ID della transazione da contestare */
  transactionId: string;
  /** Prova di invalidità */
  proof: string | string[];
  /** Motivo della challenge */
  reason: 'invalid_signature' | 'invalid_state_transition' | 'double_spend' | 'other';
  /** Descrizione dettagliata del motivo (obbligatoria se reason è 'other') */
  description?: string;
}

/**
 * Risultato di una challenge
 */
export interface ChallengeResult {
  /** ID della challenge */
  challengeId: string;
  /** ID della transazione contestata */
  transactionId: string;
  /** Stato della challenge */
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  /** Timestamp della challenge */
  timestamp: number;
}

/**
 * Stato dettagliato di una challenge
 */
export interface ChallengeStatus {
  /** ID della challenge */
  challengeId: string;
  /** ID della transazione contestata */
  transactionId: string;
  /** Stato della challenge */
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  /** Timestamp dell'ultimo aggiornamento */
  lastUpdated: number;
  /** Dettagli della challenge */
  details: {
    /** Indirizzo del challenger */
    challenger: string;
    /** Motivo della challenge */
    reason: string;
    /** Descrizione dettagliata del motivo */
    description?: string;
    /** Prova fornita */
    proof: string | string[];
    /** Numero del batch contestato */
    batchNumber?: number;
    /** Indice della transazione nel batch */
    indexInBatch?: number;
    /** Timestamp di scadenza della challenge */
    expirationTime?: number;
    /** Risultato della verifica della challenge */
    verificationResult?: 'valid' | 'invalid';
    /** Messaggio di risposta in caso di rifiuto */
    responseMessage?: string;
  };
}

/**
 * Classe per le operazioni di challenge su Layer 2
 */
export class Challenge {
  private client: Layer2Client;

  /**
   * Crea una nuova istanza del modulo Challenge
   * @param client Client Layer 2
   */
  constructor(client: Layer2Client) {
    this.client = client;
  }

  /**
   * Sottomette una challenge per una transazione
   * @param params Parametri della challenge
   * @returns Promise con il risultato della challenge
   */
  public async submit(params: SubmitChallengeParams): Promise<ChallengeResult> {
    try {
      const config = this.client.getConfig();
      
      // Ottieni l'indirizzo pubblico del challenger
      const challenger = await this.client.getPublicKey();
      
      // Verifica che il motivo sia valido
      if (params.reason === 'other' && !params.description) {
        throw new Layer2Error(
          'È necessario fornire una descrizione quando il motivo è "other"',
          ErrorCode.INVALID_CHALLENGE_REASON
        );
      }
      
      // Crea i dati della challenge
      const challengeData = {
        transactionId: params.transactionId,
        challenger: challenger.toBase58(),
        reason: params.reason,
        description: params.description || '',
        proof: params.proof,
        timestamp: Date.now(),
      };
      
      // Serializza i dati della challenge
      const serializedData = serializeData(challengeData);
      
      // Simula l'invio della challenge al Layer 2
      // In una implementazione reale, qui si invierebbe una richiesta all'API del Layer 2
      
      // Genera un ID univoco per la challenge
      const challengeId = `chl_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}`;
      
      // Restituisci il risultato della challenge
      return {
        challengeId,
        transactionId: params.transactionId,
        status: 'pending',
        timestamp: Date.now(),
      };
    } catch (error) {
      if (config.debug) {
        console.error('Errore durante la sottomissione della challenge:', error);
      }
      
      throw new Layer2Error(
        `Errore durante la sottomissione della challenge: ${error.message}`,
        ErrorCode.SUBMIT_CHALLENGE_FAILED
      );
    }
  }

  /**
   * Ottiene lo stato di una challenge
   * @param challengeId ID della challenge
   * @returns Promise con lo stato della challenge
   */
  public async getStatus(challengeId: string): Promise<ChallengeStatus> {
    try {
      const config = this.client.getConfig();
      
      // Simula il recupero dello stato della challenge
      // In una implementazione reale, qui si invierebbe una richiesta all'API del Layer 2
      
      // Genera uno stato simulato
      const status: ChallengeStatus = {
        challengeId,
        transactionId: `tx_${challengeId.slice(4, 12)}`,
        status: 'pending',
        lastUpdated: Date.now(),
        details: {
          challenger: 'challenger_address',
          reason: 'invalid_state_transition',
          proof: ['proof1', 'proof2', 'proof3'],
          batchNumber: 12345,
          indexInBatch: 42,
          expirationTime: Date.now() + 86400000, // 24 ore
        },
      };
      
      return status;
    } catch (error) {
      if (config.debug) {
        console.error('Errore durante il recupero dello stato della challenge:', error);
      }
      
      throw new Layer2Error(
        `Errore durante il recupero dello stato della challenge: ${error.message}`,
        ErrorCode.GET_CHALLENGE_STATUS_FAILED
      );
    }
  }

  /**
   * Ottiene lo storico delle challenge per l'utente corrente
   * @param limit Numero massimo di challenge da restituire
   * @param offset Offset per la paginazione
   * @returns Promise con l'elenco delle challenge
   */
  public async getHistory(limit: number = 10, offset: number = 0): Promise<ChallengeStatus[]> {
    try {
      const config = this.client.getConfig();
      
      // Simula il recupero dello storico delle challenge
      // In una implementazione reale, qui si invierebbe una richiesta all'API del Layer 2
      
      // Genera uno storico simulato
      const history: ChallengeStatus[] = [];
      
      for (let i = 0; i < limit; i++) {
        const challengeId = `chl_${Date.now().toString(36)}_${i}`;
        const txId = `tx_${Date.now().toString(36)}_${i}`;
        
        // Genera uno stato casuale
        const statuses = ['pending', 'accepted', 'rejected', 'expired'];
        const randomStatus = statuses[Math.floor(Math.random() * statuses.length)] as 'pending' | 'accepted' | 'rejected' | 'expired';
        
        // Genera un motivo casuale
        const reasons = ['invalid_signature', 'invalid_state_transition', 'double_spend', 'other'];
        const randomReason = reasons[Math.floor(Math.random() * reasons.length)];
        
        history.push({
          challengeId,
          transactionId: txId,
          status: randomStatus,
          lastUpdated: Date.now() - i * 60000, // Ogni challenge è più vecchia della precedente
          details: {
            challenger: 'challenger_address',
            reason: randomReason,
            description: randomReason === 'other' ? 'Descrizione personalizzata' : undefined,
            proof: ['proof1', 'proof2', 'proof3'],
            batchNumber: 12345 - i,
            indexInBatch: Math.floor(Math.random() * 100),
            expirationTime: Date.now() + 86400000 - i * 3600000, // Scadenza tra 0-24 ore
            verificationResult: randomStatus === 'accepted' ? 'valid' : randomStatus === 'rejected' ? 'invalid' : undefined,
            responseMessage: randomStatus === 'rejected' ? 'La prova fornita non è sufficiente' : undefined,
          },
        });
      }
      
      return history;
    } catch (error) {
      if (config.debug) {
        console.error('Errore durante il recupero dello storico delle challenge:', error);
      }
      
      throw new Layer2Error(
        `Errore durante il recupero dello storico delle challenge: ${error.message}`,
        ErrorCode.GET_CHALLENGE_HISTORY_FAILED
      );
    }
  }

  /**
   * Verifica se una transazione è stata contestata
   * @param transactionId ID della transazione
   * @returns Promise con il risultato della verifica
   */
  public async isTransactionChallenged(transactionId: string): Promise<{
    challenged: boolean;
    challengeId?: string;
    status?: 'pending' | 'accepted' | 'rejected' | 'expired';
  }> {
    try {
      const config = this.client.getConfig();
      
      // Simula la verifica
      // In una implementazione reale, qui si invierebbe una richiesta all'API del Layer 2
      
      // Genera un risultato simulato (50% di probabilità che la transazione sia stata contestata)
      const challenged = Math.random() > 0.5;
      
      if (challenged) {
        const challengeId = `chl_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}`;
        const statuses = ['pending', 'accepted', 'rejected', 'expired'];
        const randomStatus = statuses[Math.floor(Math.random() * statuses.length)] as 'pending' | 'accepted' | 'rejected' | 'expired';
        
        return {
          challenged: true,
          challengeId,
          status: randomStatus,
        };
      }
      
      return {
        challenged: false,
      };
    } catch (error) {
      if (config.debug) {
        console.error('Errore durante la verifica della challenge:', error);
      }
      
      throw new Layer2Error(
        `Errore durante la verifica della challenge: ${error.message}`,
        ErrorCode.CHECK_TRANSACTION_CHALLENGED_FAILED
      );
    }
  }
}
