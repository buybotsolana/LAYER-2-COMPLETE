import { L2Client } from './client';
import { AccountManager } from './account';
import { TransactionManager } from './transaction';
import { BridgeManager } from './bridge';
import { WalletAdapterFactory } from './wallet';
import { WalletAdapter } from './wallet/adapter';
import { PhantomWalletAdapter } from './wallet/phantom';
import { BackpackWalletAdapter } from './wallet/backpack';
import { MetaMaskWalletAdapter } from './wallet/metamask';

// Esporta tutte le classi e interfacce principali
export {
  L2Client,
  AccountManager,
  TransactionManager,
  BridgeManager,
  WalletAdapterFactory,
  WalletAdapter,
  PhantomWalletAdapter,
  BackpackWalletAdapter,
  MetaMaskWalletAdapter
};

// Esporta tutti i tipi
export * from './types';

// Funzione di utilità per creare un client L2
export function createL2Client(endpoint: string, options?: any): L2Client {
  return new L2Client({
    endpoint,
    ...options
  });
}

// Funzione di utilità per creare un client L2 connesso al devnet
export function createDevnetClient(options?: any): L2Client {
  return L2Client.devnet();
}

// Funzione di utilità per creare un client L2 connesso al testnet
export function createTestnetClient(options?: any): L2Client {
  return L2Client.testnet();
}

// Funzione di utilità per creare un client L2 connesso al mainnet
export function createMainnetClient(options?: any): L2Client {
  return L2Client.mainnet();
}

// Versione del SDK
export const VERSION = '1.0.0';
