import { WalletAdapter } from './adapter';
import { ethers } from 'ethers';

/**
 * Adapter per il wallet MetaMask
 */
export class MetaMaskWalletAdapter implements WalletAdapter {
  name = 'MetaMask';
  icon = 'https://metamask.io/images/metamask-fox.svg';
  connected = false;
  publicKey?: string;
  private provider?: ethers.providers.Web3Provider;
  private signer?: ethers.Signer;

  /**
   * Costruttore della classe MetaMaskWalletAdapter
   */
  constructor() {
    // Verifica se MetaMask è disponibile nel browser
    if (typeof window !== 'undefined' && window.ethereum) {
      this.provider = new ethers.providers.Web3Provider(window.ethereum);
      
      // Verifica se l'utente è già connesso
      this.checkConnection();
      
      // Registra i listener per gli eventi
      this.registerEventListeners();
    } else {
      console.warn('MetaMask non è installato o non è disponibile');
    }
  }

  /**
   * Verifica se l'utente è già connesso a MetaMask
   */
  private async checkConnection(): Promise<void> {
    if (!this.provider) {
      return;
    }
    
    try {
      const accounts = await this.provider.listAccounts();
      if (accounts.length > 0) {
        this.connected = true;
        this.publicKey = accounts[0];
        this.signer = this.provider.getSigner();
      }
    } catch (error) {
      console.error('Errore nella verifica della connessione a MetaMask:', error);
    }
  }

  /**
   * Connette il wallet
   */
  async connect(): Promise<void> {
    if (!this.provider) {
      throw new Error('MetaMask non è installato o non è disponibile');
    }
    
    try {
      // Richiedi l'accesso agli account
      const accounts = await this.provider.send('eth_requestAccounts', []);
      
      if (accounts.length > 0) {
        this.connected = true;
        this.publicKey = accounts[0];
        this.signer = this.provider.getSigner();
      } else {
        throw new Error('Nessun account disponibile');
      }
    } catch (error) {
      console.error('Errore nella connessione a MetaMask:', error);
      throw error;
    }
  }

  /**
   * Disconnette il wallet
   */
  async disconnect(): Promise<void> {
    // MetaMask non supporta la disconnessione via API
    // Possiamo solo resettare lo stato locale
    this.connected = false;
    this.publicKey = undefined;
    this.signer = undefined;
  }

  /**
   * Firma una transazione
   * @param transaction - Transazione da firmare
   * @returns Transazione firmata
   */
  async signTransaction(transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>): Promise<ethers.providers.TransactionResponse> {
    if (!this.provider || !this.signer) {
      throw new Error('MetaMask non è installato o non è disponibile');
    }
    
    if (!this.connected) {
      throw new Error('Wallet non connesso');
    }
    
    try {
      // Per MetaMask, signTransaction e sendTransaction sono la stessa operazione
      return await this.signer.sendTransaction(transaction);
    } catch (error) {
      console.error('Errore nella firma della transazione con MetaMask:', error);
      throw error;
    }
  }

  /**
   * Firma un messaggio
   * @param message - Messaggio da firmare
   * @returns Messaggio firmato
   */
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this.provider || !this.signer) {
      throw new Error('MetaMask non è installato o non è disponibile');
    }
    
    if (!this.connected) {
      throw new Error('Wallet non connesso');
    }
    
    try {
      const messageString = ethers.utils.toUtf8String(message);
      const signature = await this.signer.signMessage(messageString);
      return ethers.utils.arrayify(signature);
    } catch (error) {
      console.error('Errore nella firma del messaggio con MetaMask:', error);
      throw error;
    }
  }

  /**
   * Invia una transazione
   * @param transaction - Transazione da inviare
   * @returns Hash della transazione
   */
  async sendTransaction(transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>): Promise<string> {
    if (!this.provider || !this.signer) {
      throw new Error('MetaMask non è installato o non è disponibile');
    }
    
    if (!this.connected) {
      throw new Error('Wallet non connesso');
    }
    
    try {
      const tx = await this.signer.sendTransaction(transaction);
      return tx.hash;
    } catch (error) {
      console.error('Errore nell\'invio della transazione con MetaMask:', error);
      throw error;
    }
  }

  /**
   * Registra i listener per gli eventi del wallet
   */
  private registerEventListeners(): void {
    if (typeof window === 'undefined' || !window.ethereum) {
      return;
    }
    
    window.ethereum.on('accountsChanged', (accounts: string[]) => {
      if (accounts.length > 0) {
        this.connected = true;
        this.publicKey = accounts[0];
        this.signer = this.provider?.getSigner();
      } else {
        this.connected = false;
        this.publicKey = undefined;
        this.signer = undefined;
      }
    });
    
    window.ethereum.on('chainChanged', () => {
      // Ricarica la pagina quando la chain cambia
      window.location.reload();
    });
    
    window.ethereum.on('disconnect', () => {
      this.connected = false;
      this.publicKey = undefined;
      this.signer = undefined;
    });
  }
}
