import { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram, Keypair, sendAndConfirmTransaction } from '@solana/web3.js';
import { L2Client } from './client';
import { AccountInfo } from './types';

/**
 * Classe per la gestione degli account su Layer-2 Solana
 */
export class AccountManager {
  private client: L2Client;

  /**
   * Costruttore della classe AccountManager
   * @param client - Istanza di L2Client
   */
  constructor(client: L2Client) {
    this.client = client;
  }

  /**
   * Ottiene il saldo di un account su L2
   * @param address - Indirizzo dell'account
   * @returns Saldo dell'account in lamports
   */
  async getBalance(address: string | PublicKey): Promise<number> {
    const publicKey = typeof address === 'string' ? new PublicKey(address) : address;
    return await this.client.getConnection().getBalance(publicKey);
  }

  /**
   * Ottiene le informazioni di un account su L2
   * @param address - Indirizzo dell'account
   * @returns Informazioni dell'account
   */
  async getAccountInfo(address: string | PublicKey): Promise<AccountInfo | null> {
    const publicKey = typeof address === 'string' ? new PublicKey(address) : address;
    const accountInfo = await this.client.getConnection().getAccountInfo(publicKey);
    
    if (!accountInfo) {
      return null;
    }

    return {
      address: publicKey.toString(),
      lamports: accountInfo.lamports,
      owner: accountInfo.owner.toString(),
      executable: accountInfo.executable,
      rentEpoch: accountInfo.rentEpoch,
      data: accountInfo.data
    };
  }

  /**
   * Crea un nuovo account su L2
   * @param fromKeypair - Keypair del mittente
   * @param toPublicKey - PublicKey del destinatario
   * @param lamports - Quantità di lamports da trasferire
   * @returns Firma della transazione
   */
  async createAccount(fromKeypair: Keypair, toPublicKey: PublicKey, lamports: number): Promise<string> {
    const connection = this.client.getConnection();
    
    const transaction = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: fromKeypair.publicKey,
        newAccountPubkey: toPublicKey,
        lamports,
        space: 0,
        programId: SystemProgram.programId,
      }),
    );

    return await sendAndConfirmTransaction(connection, transaction, [fromKeypair]);
  }

  /**
   * Trasferisce lamports da un account a un altro su L2
   * @param fromKeypair - Keypair del mittente
   * @param toPublicKey - PublicKey del destinatario
   * @param lamports - Quantità di lamports da trasferire
   * @returns Firma della transazione
   */
  async transfer(fromKeypair: Keypair, toPublicKey: PublicKey | string, lamports: number): Promise<string> {
    const connection = this.client.getConnection();
    const toPubkey = typeof toPublicKey === 'string' ? new PublicKey(toPublicKey) : toPublicKey;
    
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey,
        lamports,
      }),
    );

    return await sendAndConfirmTransaction(connection, transaction, [fromKeypair]);
  }

  /**
   * Verifica se un account esiste su L2
   * @param address - Indirizzo dell'account
   * @returns true se l'account esiste, false altrimenti
   */
  async accountExists(address: string | PublicKey): Promise<boolean> {
    const publicKey = typeof address === 'string' ? new PublicKey(address) : address;
    const accountInfo = await this.client.getConnection().getAccountInfo(publicKey);
    return accountInfo !== null;
  }
}
