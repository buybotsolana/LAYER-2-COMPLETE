import { WalletAdapter } from './adapter';
import { PhantomWalletAdapter } from './phantom';
import { BackpackWalletAdapter } from './backpack';
import { MetaMaskWalletAdapter } from './metamask';

/**
 * Factory per la creazione di adapter per wallet
 */
export class WalletAdapterFactory {
  /**
   * Crea un adapter per Phantom
   * @returns Istanza di PhantomWalletAdapter
   */
  static createPhantomAdapter(): PhantomWalletAdapter {
    return new PhantomWalletAdapter();
  }

  /**
   * Crea un adapter per Backpack
   * @returns Istanza di BackpackWalletAdapter
   */
  static createBackpackAdapter(): BackpackWalletAdapter {
    return new BackpackWalletAdapter();
  }

  /**
   * Crea un adapter per MetaMask
   * @returns Istanza di MetaMaskWalletAdapter
   */
  static createMetaMaskAdapter(): MetaMaskWalletAdapter {
    return new MetaMaskWalletAdapter();
  }

  /**
   * Crea un adapter per il wallet specificato
   * @param walletName - Nome del wallet
   * @returns Istanza di WalletAdapter
   * @throws Error se il wallet non è supportato
   */
  static createAdapter(walletName: 'phantom' | 'backpack' | 'metamask'): WalletAdapter {
    switch (walletName) {
      case 'phantom':
        return this.createPhantomAdapter();
      case 'backpack':
        return this.createBackpackAdapter();
      case 'metamask':
        return this.createMetaMaskAdapter();
      default:
        throw new Error(`Wallet non supportato: ${walletName}`);
    }
  }

  /**
   * Ottiene l'elenco dei wallet supportati
   * @returns Elenco dei wallet supportati
   */
  static getSupportedWallets(): { name: string; icon?: string }[] {
    return [
      { name: 'Phantom', icon: 'https://phantom.app/img/logo.png' },
      { name: 'Backpack', icon: 'https://backpack.app/assets/backpack-logo.svg' },
      { name: 'MetaMask', icon: 'https://metamask.io/images/metamask-fox.svg' }
    ];
  }

  /**
   * Verifica se un wallet è installato
   * @param walletName - Nome del wallet
   * @returns true se il wallet è installato, false altrimenti
   */
  static isWalletInstalled(walletName: 'phantom' | 'backpack' | 'metamask'): boolean {
    switch (walletName) {
      case 'phantom':
        return typeof window !== 'undefined' && !!window.solana && !!window.solana.isPhantom;
      case 'backpack':
        return typeof window !== 'undefined' && !!window.backpack;
      case 'metamask':
        return typeof window !== 'undefined' && !!window.ethereum;
      default:
        return false;
    }
  }
}
