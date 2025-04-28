import { Connection, PublicKey, Transaction, TransactionInstruction, Keypair, sendAndConfirmTransaction } from '@solana/web3.js';
import { L2Client } from './client';
import { TransactionResult, TransactionOptions } from './types';

/**
 * Classe per la gestione delle transazioni su Layer-2 Solana
 */
export class TransactionManager {
  private client: L2Client;

  /**
   * Costruttore della classe TransactionManager
   * @param client - Istanza di L2Client
   */
  constructor(client: L2Client) {
    this.client = client;
  }

  /**
   * Invia una transazione al Layer-2
   * @param transaction - Transazione da inviare
   * @param signers - Firmatari della transazione
   * @param options - Opzioni per la transazione
   * @returns Risultato della transazione
   */
  async sendTransaction(
    transaction: Transaction,
    signers: Keypair[],
    options?: TransactionOptions
  ): Promise<TransactionResult> {
    const connection = this.client.getConnection();
    
    try {
      // Imposta il recente blockhash
      transaction.recentBlockhash = (
        await connection.getRecentBlockhash(options?.commitment || 'confirmed')
      ).blockhash;
      
      // Imposta il pagatore se non è già impostato
      if (!transaction.feePayer && signers.length > 0) {
        transaction.feePayer = signers[0].publicKey;
      }

      // Invia la transazione
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        signers,
        {
          commitment: options?.commitment || 'confirmed',
          preflightCommitment: options?.preflightCommitment || 'confirmed',
          skipPreflight: options?.skipPreflight || false,
        }
      );

      return {
        success: true,
        signature,
        error: null
      };
    } catch (error) {
      console.error('Errore nell\'invio della transazione:', error);
      return {
        success: false,
        signature: null,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  /**
   * Crea e invia una transazione con le istruzioni specificate
   * @param instructions - Istruzioni da includere nella transazione
   * @param signers - Firmatari della transazione
   * @param options - Opzioni per la transazione
   * @returns Risultato della transazione
   */
  async sendInstructions(
    instructions: TransactionInstruction[],
    signers: Keypair[],
    options?: TransactionOptions
  ): Promise<TransactionResult> {
    const transaction = new Transaction();
    
    // Aggiungi le istruzioni alla transazione
    for (const instruction of instructions) {
      transaction.add(instruction);
    }

    return await this.sendTransaction(transaction, signers, options);
  }

  /**
   * Ottiene i dettagli di una transazione
   * @param signature - Firma della transazione
   * @returns Dettagli della transazione
   */
  async getTransaction(signature: string): Promise<any> {
    const connection = this.client.getConnection();
    return await connection.getTransaction(signature, {
      commitment: 'confirmed',
    });
  }

  /**
   * Verifica lo stato di una transazione
   * @param signature - Firma della transazione
   * @returns Stato della transazione
   */
  async getTransactionStatus(signature: string): Promise<'confirmed' | 'finalized' | 'processed' | 'error'> {
    const connection = this.client.getConnection();
    
    try {
      const status = await connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });
      
      if (!status || !status.value) {
        return 'error';
      }
      
      return status.value.confirmationStatus || 'error';
    } catch (error) {
      console.error('Errore nel recupero dello stato della transazione:', error);
      return 'error';
    }
  }

  /**
   * Attende la conferma di una transazione
   * @param signature - Firma della transazione
   * @param timeout - Timeout in millisecondi
   * @returns true se la transazione è confermata, false altrimenti
   */
  async waitForConfirmation(signature: string, timeout = 30000): Promise<boolean> {
    const connection = this.client.getConnection();
    
    try {
      const startTime = Date.now();
      
      while (Date.now() - startTime < timeout) {
        const status = await connection.getSignatureStatus(signature);
        
        if (status && status.value) {
          if (status.value.confirmationStatus === 'confirmed' || 
              status.value.confirmationStatus === 'finalized') {
            return true;
          }
          
          if (status.value.err) {
            return false;
          }
        }
        
        // Attendi 1 secondo prima di controllare di nuovo
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      return false;
    } catch (error) {
      console.error('Errore nell\'attesa della conferma della transazione:', error);
      return false;
    }
  }

  /**
   * Simula una transazione senza inviarla
   * @param transaction - Transazione da simulare
   * @param signers - Firmatari della transazione
   * @returns Risultato della simulazione
   */
  async simulateTransaction(transaction: Transaction, signers: Keypair[]): Promise<any> {
    const connection = this.client.getConnection();
    
    try {
      // Imposta il recente blockhash
      transaction.recentBlockhash = (
        await connection.getRecentBlockhash('confirmed')
      ).blockhash;
      
      // Imposta il pagatore se non è già impostato
      if (!transaction.feePayer && signers.length > 0) {
        transaction.feePayer = signers[0].publicKey;
      }
      
      // Firma la transazione
      transaction.sign(...signers);
      
      // Simula la transazione
      return await connection.simulateTransaction(transaction);
    } catch (error) {
      console.error('Errore nella simulazione della transazione:', error);
      throw error;
    }
  }
}
