/**
 * Interfaccia per gli adapter dei wallet
 */
export interface WalletAdapter {
  /** Nome del wallet */
  name: string;
  /** Icona del wallet (URL) */
  icon?: string;
  /** Flag che indica se il wallet è connesso */
  connected: boolean;
  /** Indirizzo pubblico del wallet */
  publicKey?: string;
  /** Metodo per connettere il wallet */
  connect(): Promise<void>;
  /** Metodo per disconnettere il wallet */
  disconnect(): Promise<void>;
  /** Metodo per firmare una transazione */
  signTransaction(transaction: any): Promise<any>;
  /** Metodo per firmare un messaggio */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  /** Metodo per inviare una transazione */
  sendTransaction(transaction: any): Promise<string>;
}
