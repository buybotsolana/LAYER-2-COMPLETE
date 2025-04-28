import { WalletAdapter } from './adapter';
import { PublicKey, Transaction, Keypair } from '@solana/web3.js';

/**
 * Adapter per il wallet Backpack
 */
export class BackpackWalletAdapter implements WalletAdapter {
  name = 'Backpack';
  icon = 'https://backpack.app/assets/backpack-logo.svg';
  connected = false;
  publicKey?: string;
  private wallet: any;

  /**
   * Costruttore della classe BackpackWalletAdapter
   */
  constructor() {
    // Verifica se Backpack è disponibile nel browser
    if (typeof window !== 'undefined' && window.backpack) {
      this.wallet = window.backpack;
      
      // Imposta lo stato iniziale
      this.connected = this.wallet.isConnected;
      if (this.connected && this.wallet.publicKey) {
        this.publicKey = this.wallet.publicKey.toString();
      }
      
      // Registra i listener per gli eventi
      this.registerEventListeners();
    } else {
      console.warn('Backpack non è installato o non è disponibile');
    }
  }

  /**
   * Connette il wallet
   */
  async connect(): Promise<void> {
    if (!this.wallet) {
      throw new Error('Backpack non è installato o non è disponibile');
    }
    
    try {
      const response = await this.wallet.connect();
      this.connected = true;
      this.publicKey = response.publicKey.toString();
    } catch (error) {
      console.error('Errore nella connessione a Backpack:', error);
      throw error;
    }
  }

  /**
   * Disconnette il wallet
   */
  async disconnect(): Promise<void> {
    if (!this.wallet) {
      throw new Error('Backpack non è installato o non è disponibile');
    }
    
    try {
      await this.wallet.disconnect();
      this.connected = false;
      this.publicKey = undefined;
    } catch (error) {
      console.error('Errore nella disconnessione da Backpack:', error);
      throw error;
    }
  }

  /**
   * Firma una transazione
   * @param transaction - Transazione da firmare
   * @returns Transazione firmata
   */
  async signTransaction(transaction: Transaction): Promise<Transaction> {
    if (!this.wallet) {
      throw new Error('Backpack non è installato o non è disponibile');
    }
    
    if (!this.connected) {
      throw new Error('Wallet non connesso');
    }
    
    try {
      return await this.wallet.signTransaction(transaction);
    } catch (error) {
      console.error('Errore nella firma della transazione con Backpack:', error);
      throw error;
    }
  }

  /**
   * Firma un messaggio
   * @param message - Messaggio da firmare
   * @returns Messaggio firmato
   */
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this.wallet) {
      throw new Error('Backpack non è installato o non è disponibile');
    }
    
    if (!this.connected) {
      throw new Error('Wallet non connesso');
    }
    
    try {
      const { signature } = await this.wallet.signMessage(message, 'utf8');
      return signature;
    } catch (error) {
      console.error('Errore nella firma del messaggio con Backpack:', error);
      throw error;
    }
  }

  /**
   * Invia una transazione
   * @param transaction - Transazione da inviare
   * @returns Firma della transazione
   */
  async sendTransaction(transaction: Transaction): Promise<string> {
    if (!this.wallet) {
      throw new Error('Backpack non è installato o non è disponibile');
    }
    
    if (!this.connected) {
      throw new Error('Wallet non connesso');
    }
    
    try {
      return await this.wallet.sendTransaction(transaction);
    } catch (error) {
      console.error('Errore nell\'invio della transazione con Backpack:', error);
      throw error;
    }
  }

  /**
   * Registra i listener per gli eventi del wallet
   */
  private registerEventListeners(): void {
    if (!this.wallet) {
      return;
    }
    
    this.wallet.on('connect', () => {
      this.connected = true;
      if (this.wallet.publicKey) {
        this.publicKey = this.wallet.publicKey.toString();
      }
    });
    
    this.wallet.on('disconnect', () => {
      this.connected = false;
      this.publicKey = undefined;
    });
    
    this.wallet.on('accountChanged', () => {
      if (this.wallet.publicKey) {
        this.publicKey = this.wallet.publicKey.toString();
      } else {
        this.publicKey = undefined;
      }
    });
  }
}
