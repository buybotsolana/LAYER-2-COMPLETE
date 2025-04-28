/**
 * @fileoverview Modulo per le operazioni di bridge tra Layer 1 e Layer 2
 */

import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Layer2Client } from './client';
import { serializeData, deserializeData } from './utils/serialization';
import { Layer2Error, ErrorCode } from './types/errors';

/**
 * Parametri per il deposito da Layer 1 a Layer 2
 */
export interface DepositParams {
  /** Importo da depositare in lamports */
  amount: number;
  /** Token da depositare (default: 'SOL') */
  token?: string;
  /** Destinatario su Layer 2 (default: indirizzo del mittente) */
  recipient?: PublicKey;
  /** Riferimento opzionale per il deposito */
  reference?: string;
}

/**
 * Parametri per il prelievo da Layer 2 a Layer 1
 */
export interface WithdrawParams {
  /** Importo da prelevare in lamports */
  amount: number;
  /** Token da prelevare (default: 'SOL') */
  token?: string;
  /** Destinatario su Layer 1 (default: indirizzo del mittente) */
  recipient?: PublicKey;
  /** Riferimento opzionale per il prelievo */
  reference?: string;
}

/**
 * Risultato di un'operazione di deposito
 */
export interface DepositResult {
  /** ID del deposito */
  depositId: string;
  /** Hash della transazione su Layer 1 */
  txHash: string;
  /** Stato del deposito */
  status: 'pending' | 'confirmed' | 'completed' | 'failed';
  /** Timestamp del deposito */
  timestamp: number;
}

/**
 * Risultato di un'operazione di prelievo
 */
export interface WithdrawResult {
  /** ID del prelievo */
  withdrawId: string;
  /** Hash della transazione su Layer 2 */
  txHash: string;
  /** Stato del prelievo */
  status: 'pending' | 'confirmed' | 'completed' | 'failed';
  /** Timestamp del prelievo */
  timestamp: number;
}

/**
 * Stato di un deposito o prelievo
 */
export interface BridgeOperationStatus {
  /** ID dell'operazione */
  operationId: string;
  /** Tipo di operazione */
  type: 'deposit' | 'withdraw';
  /** Stato dell'operazione */
  status: 'pending' | 'confirmed' | 'completed' | 'failed';
  /** Timestamp dell'ultimo aggiornamento */
  lastUpdated: number;
  /** Dettagli dell'operazione */
  details: {
    /** Importo dell'operazione in lamports */
    amount: number;
    /** Token dell'operazione */
    token: string;
    /** Mittente dell'operazione */
    sender: string;
    /** Destinatario dell'operazione */
    recipient: string;
    /** Hash della transazione */
    txHash: string;
    /** Blocco di conferma */
    confirmationBlock?: number;
    /** Messaggio di errore in caso di fallimento */
    errorMessage?: string;
  };
}

/**
 * Classe per le operazioni di bridge tra Layer 1 e Layer 2
 */
export class Bridge {
  private client: Layer2Client;
  private bridgeProgramId: PublicKey;

  /**
   * Crea una nuova istanza del modulo Bridge
   * @param client Client Layer 2
   */
  constructor(client: Layer2Client) {
    this.client = client;
    // Indirizzo del programma di bridge su Solana
    this.bridgeProgramId = new PublicKey('Bridge111111111111111111111111111111111111');
  }

  /**
   * Deposita asset da Layer 1 a Layer 2
   * @param params Parametri del deposito
   * @returns Promise con il risultato del deposito
   */
  public async deposit(params: DepositParams): Promise<DepositResult> {
    try {
      const config = this.client.getConfig();
      const connection = this.client.getConnection();
      
      // Ottieni l'indirizzo pubblico dell'utente
      const sender = await this.client.getPublicKey();
      
      // Imposta il destinatario (default: stesso indirizzo del mittente)
      const recipient = params.recipient || sender;
      
      // Imposta il token (default: SOL)
      const token = params.token || 'SOL';
      
      // Crea la transazione di deposito
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: sender,
          toPubkey: this.bridgeProgramId,
          lamports: params.amount,
        })
      );
      
      // Aggiungi i dati del deposito alla transazione
      const depositData = {
        action: 'deposit',
        token,
        recipient: recipient.toBase58(),
        reference: params.reference || '',
        timestamp: Date.now(),
      };
      
      // Serializza i dati del deposito
      const serializedData = serializeData(depositData);
      
      // Firma la transazione
      const signedTransaction = await this.client.signTransaction(transaction);
      
      // Invia la transazione
      const txHash = await connection.sendRawTransaction(signedTransaction.serialize());
      
      // Attendi la conferma della transazione
      await connection.confirmTransaction(txHash, 'confirmed');
      
      // Genera un ID univoco per il deposito
      const depositId = `dep_${txHash.slice(0, 8)}_${Date.now()}`;
      
      // Restituisci il risultato del deposito
      return {
        depositId,
        txHash,
        status: 'confirmed',
        timestamp: Date.now(),
      };
    } catch (error) {
      if (config.debug) {
        console.error('Errore durante il deposito:', error);
      }
      
      throw new Layer2Error(
        `Errore durante il deposito: ${error.message}`,
        ErrorCode.DEPOSIT_FAILED
      );
    }
  }

  /**
   * Preleva asset da Layer 2 a Layer 1
   * @param params Parametri del prelievo
   * @returns Promise con il risultato del prelievo
   */
  public async withdraw(params: WithdrawParams): Promise<WithdrawResult> {
    try {
      const config = this.client.getConfig();
      
      // Ottieni l'indirizzo pubblico dell'utente
      const sender = await this.client.getPublicKey();
      
      // Imposta il destinatario (default: stesso indirizzo del mittente)
      const recipient = params.recipient || sender;
      
      // Imposta il token (default: SOL)
      const token = params.token || 'SOL';
      
      // Crea i dati del prelievo
      const withdrawData = {
        action: 'withdraw',
        token,
        amount: params.amount,
        recipient: recipient.toBase58(),
        reference: params.reference || '',
        timestamp: Date.now(),
      };
      
      // Serializza i dati del prelievo
      const serializedData = serializeData(withdrawData);
      
      // Simula l'invio della richiesta di prelievo al Layer 2
      // In una implementazione reale, qui si invierebbe una richiesta all'API del Layer 2
      
      // Genera un ID univoco per il prelievo e un hash di transazione simulato
      const withdrawId = `wit_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}`;
      const txHash = `sim_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 8)}`;
      
      // Restituisci il risultato del prelievo
      return {
        withdrawId,
        txHash,
        status: 'pending',
        timestamp: Date.now(),
      };
    } catch (error) {
      if (config.debug) {
        console.error('Errore durante il prelievo:', error);
      }
      
      throw new Layer2Error(
        `Errore durante il prelievo: ${error.message}`,
        ErrorCode.WITHDRAW_FAILED
      );
    }
  }

  /**
   * Ottiene lo stato di un'operazione di bridge
   * @param operationId ID dell'operazione
   * @returns Promise con lo stato dell'operazione
   */
  public async getOperationStatus(operationId: string): Promise<BridgeOperationStatus> {
    try {
      const config = this.client.getConfig();
      
      // Determina il tipo di operazione in base al prefisso dell'ID
      const type = operationId.startsWith('dep') ? 'deposit' : 'withdraw';
      
      // Simula il recupero dello stato dell'operazione
      // In una implementazione reale, qui si invierebbe una richiesta all'API del Layer 2
      
      // Genera uno stato simulato
      const status: BridgeOperationStatus = {
        operationId,
        type,
        status: 'confirmed',
        lastUpdated: Date.now(),
        details: {
          amount: 1 * LAMPORTS_PER_SOL,
          token: 'SOL',
          sender: 'sender_address',
          recipient: 'recipient_address',
          txHash: `tx_${operationId.slice(4, 12)}`,
          confirmationBlock: 12345678,
        },
      };
      
      return status;
    } catch (error) {
      if (config.debug) {
        console.error('Errore durante il recupero dello stato dell\'operazione:', error);
      }
      
      throw new Layer2Error(
        `Errore durante il recupero dello stato dell'operazione: ${error.message}`,
        ErrorCode.GET_OPERATION_STATUS_FAILED
      );
    }
  }

  /**
   * Ottiene lo storico delle operazioni di bridge per l'utente corrente
   * @param limit Numero massimo di operazioni da restituire
   * @param offset Offset per la paginazione
   * @returns Promise con l'elenco delle operazioni
   */
  public async getOperationHistory(limit: number = 10, offset: number = 0): Promise<BridgeOperationStatus[]> {
    try {
      const config = this.client.getConfig();
      
      // Simula il recupero dello storico delle operazioni
      // In una implementazione reale, qui si invierebbe una richiesta all'API del Layer 2
      
      // Genera uno storico simulato
      const history: BridgeOperationStatus[] = [];
      
      for (let i = 0; i < limit; i++) {
        const isDeposit = Math.random() > 0.5;
        const operationId = isDeposit 
          ? `dep_${Date.now().toString(36)}_${i}` 
          : `wit_${Date.now().toString(36)}_${i}`;
        
        history.push({
          operationId,
          type: isDeposit ? 'deposit' : 'withdraw',
          status: 'completed',
          lastUpdated: Date.now() - i * 60000, // Ogni operazione è più vecchia della precedente
          details: {
            amount: Math.floor(Math.random() * 10 + 1) * LAMPORTS_PER_SOL,
            token: 'SOL',
            sender: 'sender_address',
            recipient: 'recipient_address',
            txHash: `tx_${Math.random().toString(36).substr(2, 8)}`,
            confirmationBlock: 12345678 - i * 10,
          },
        });
      }
      
      return history;
    } catch (error) {
      if (config.debug) {
        console.error('Errore durante il recupero dello storico delle operazioni:', error);
      }
      
      throw new Layer2Error(
        `Errore durante il recupero dello storico delle operazioni: ${error.message}`,
        ErrorCode.GET_OPERATION_HISTORY_FAILED
      );
    }
  }
}
