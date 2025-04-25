import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { AccountManager } from './account';
import { TransactionManager } from './transaction';
import { BridgeManager } from './bridge';
import { WalletAdapter } from './wallet/adapter';

/**
 * Opzioni di configurazione per il client L2
 */
export interface L2ClientOptions {
  /** URL del nodo L2 */
  endpoint: string;
  /** Opzioni di connessione */
  commitment?: 'processed' | 'confirmed' | 'finalized';
  /** Keypair per l'autenticazione (opzionale) */
  keypair?: Keypair;
  /** Adapter per il wallet (opzionale) */
  walletAdapter?: WalletAdapter;
}

/**
 * Client principale per interagire con il Layer-2 su Solana
 */
export class L2Client {
  private connection: Connection;
  private keypair?: Keypair;
  private walletAdapter?: WalletAdapter;
  private accountManager: AccountManager;
  private transactionManager: TransactionManager;
  private bridgeManager: BridgeManager;

  /**
   * Costruttore della classe L2Client
   * @param options - Opzioni di configurazione
   */
  constructor(options: L2ClientOptions) {
    this.connection = new Connection(
      options.endpoint,
      options.commitment || 'confirmed'
    );
    this.keypair = options.keypair;
    this.walletAdapter = options.walletAdapter;
    
    // Inizializza i manager
    this.accountManager = new AccountManager(this);
    this.transactionManager = new TransactionManager(this);
    this.bridgeManager = new BridgeManager(this);
  }

  /**
   * Ottiene la connessione al nodo L2
   * @returns Istanza di Connection
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Ottiene il keypair configurato
   * @returns Keypair o undefined se non configurato
   */
  getKeypair(): Keypair | undefined {
    return this.keypair;
  }

  /**
   * Imposta un nuovo keypair
   * @param keypair - Nuovo keypair
   */
  setKeypair(keypair: Keypair): void {
    this.keypair = keypair;
  }

  /**
   * Ottiene l'adapter del wallet
   * @returns WalletAdapter o undefined se non configurato
   */
  getWalletAdapter(): WalletAdapter | undefined {
    return this.walletAdapter;
  }

  /**
   * Imposta un nuovo adapter per il wallet
   * @param walletAdapter - Nuovo adapter per il wallet
   */
  setWalletAdapter(walletAdapter: WalletAdapter): void {
    this.walletAdapter = walletAdapter;
  }

  /**
   * Ottiene il manager degli account
   * @returns Istanza di AccountManager
   */
  account(): AccountManager {
    return this.accountManager;
  }

  /**
   * Ottiene il manager delle transazioni
   * @returns Istanza di TransactionManager
   */
  transaction(): TransactionManager {
    return this.transactionManager;
  }

  /**
   * Ottiene il manager del bridge
   * @returns Istanza di BridgeManager
   */
  bridge(): BridgeManager {
    return this.bridgeManager;
  }

  /**
   * Verifica la connessione al nodo L2
   * @returns true se la connessione è attiva, false altrimenti
   */
  async isConnected(): Promise<boolean> {
    try {
      const version = await this.connection.getVersion();
      return !!version;
    } catch (error) {
      console.error('Errore nella verifica della connessione:', error);
      return false;
    }
  }

  /**
   * Crea un'istanza di L2Client connessa al devnet
   * @returns Istanza di L2Client connessa al devnet
   */
  static devnet(): L2Client {
    return new L2Client({
      endpoint: clusterApiUrl('devnet')
    });
  }

  /**
   * Crea un'istanza di L2Client connessa al testnet
   * @returns Istanza di L2Client connessa al testnet
   */
  static testnet(): L2Client {
    return new L2Client({
      endpoint: clusterApiUrl('testnet')
    });
  }

  /**
   * Crea un'istanza di L2Client connessa al mainnet
   * @returns Istanza di L2Client connessa al mainnet
   */
  static mainnet(): L2Client {
    return new L2Client({
      endpoint: clusterApiUrl('mainnet-beta')
    });
  }
}
