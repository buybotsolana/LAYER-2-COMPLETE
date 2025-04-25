import { WalletAdapter } from '../src/wallet/adapter';
import { PhantomWalletAdapter } from '../src/wallet/phantom';
import { BackpackWalletAdapter } from '../src/wallet/backpack';
import { MetaMaskWalletAdapter } from '../src/wallet/metamask';
import { WalletAdapterFactory } from '../src/wallet';
import { expect } from 'chai';
import { mock, instance, when, verify, anything } from 'ts-mockito';
import { PublicKey, Transaction } from '@solana/web3.js';

describe('WalletAdapterFactory', () => {
  describe('createPhantomAdapter', () => {
    it('should create a PhantomWalletAdapter instance', () => {
      const adapter = WalletAdapterFactory.createPhantomAdapter();
      expect(adapter).to.be.instanceOf(PhantomWalletAdapter);
    });
  });
  
  describe('createBackpackAdapter', () => {
    it('should create a BackpackWalletAdapter instance', () => {
      const adapter = WalletAdapterFactory.createBackpackAdapter();
      expect(adapter).to.be.instanceOf(BackpackWalletAdapter);
    });
  });
  
  describe('createMetaMaskAdapter', () => {
    it('should create a MetaMaskWalletAdapter instance', () => {
      const adapter = WalletAdapterFactory.createMetaMaskAdapter();
      expect(adapter).to.be.instanceOf(MetaMaskWalletAdapter);
    });
  });
  
  describe('createAdapter', () => {
    it('should create a PhantomWalletAdapter when "phantom" is specified', () => {
      const adapter = WalletAdapterFactory.createAdapter('phantom');
      expect(adapter).to.be.instanceOf(PhantomWalletAdapter);
    });
    
    it('should create a BackpackWalletAdapter when "backpack" is specified', () => {
      const adapter = WalletAdapterFactory.createAdapter('backpack');
      expect(adapter).to.be.instanceOf(BackpackWalletAdapter);
    });
    
    it('should create a MetaMaskWalletAdapter when "metamask" is specified', () => {
      const adapter = WalletAdapterFactory.createAdapter('metamask');
      expect(adapter).to.be.instanceOf(MetaMaskWalletAdapter);
    });
    
    it('should throw an error for unsupported wallet', () => {
      expect(() => {
        // @ts-ignore - Testing invalid input
        WalletAdapterFactory.createAdapter('unsupported');
      }).to.throw('Wallet non supportato');
    });
  });
  
  describe('getSupportedWallets', () => {
    it('should return a list of supported wallets with names and icons', () => {
      const wallets = WalletAdapterFactory.getSupportedWallets();
      
      expect(wallets).to.be.an('array').with.lengthOf(3);
      expect(wallets[0]).to.have.property('name', 'Phantom');
      expect(wallets[0]).to.have.property('icon').that.includes('phantom');
      expect(wallets[1]).to.have.property('name', 'Backpack');
      expect(wallets[1]).to.have.property('icon').that.includes('backpack');
      expect(wallets[2]).to.have.property('name', 'MetaMask');
      expect(wallets[2]).to.have.property('icon').that.includes('metamask');
    });
  });
  
  describe('isWalletInstalled', () => {
    let originalWindow: any;
    
    before(() => {
      originalWindow = global.window;
      // @ts-ignore - Mock window for testing
      global.window = {};
    });
    
    after(() => {
      // @ts-ignore - Restore original window
      global.window = originalWindow;
    });
    
    it('should check if Phantom is installed', () => {
      // @ts-ignore - Mock window.solana
      global.window.solana = { isPhantom: true };
      
      expect(WalletAdapterFactory.isWalletInstalled('phantom')).to.be.true;
      
      // @ts-ignore - Remove mock
      delete global.window.solana;
      
      expect(WalletAdapterFactory.isWalletInstalled('phantom')).to.be.false;
    });
    
    it('should check if Backpack is installed', () => {
      // @ts-ignore - Mock window.backpack
      global.window.backpack = {};
      
      expect(WalletAdapterFactory.isWalletInstalled('backpack')).to.be.true;
      
      // @ts-ignore - Remove mock
      delete global.window.backpack;
      
      expect(WalletAdapterFactory.isWalletInstalled('backpack')).to.be.false;
    });
    
    it('should check if MetaMask is installed', () => {
      // @ts-ignore - Mock window.ethereum
      global.window.ethereum = {};
      
      expect(WalletAdapterFactory.isWalletInstalled('metamask')).to.be.true;
      
      // @ts-ignore - Remove mock
      delete global.window.ethereum;
      
      expect(WalletAdapterFactory.isWalletInstalled('metamask')).to.be.false;
    });
  });
});

// Test di base per PhantomWalletAdapter
describe('PhantomWalletAdapter', () => {
  let adapter: PhantomWalletAdapter;
  let mockWallet: any;
  
  beforeEach(() => {
    // Mock di window.solana
    mockWallet = {
      isPhantom: true,
      isConnected: false,
      publicKey: null,
      connect: async () => ({ publicKey: { toString: () => 'phantom-public-key' } }),
      disconnect: async () => {},
      signTransaction: async (tx: any) => tx,
      signMessage: async (msg: any) => ({ signature: Buffer.from('signature') }),
      sendTransaction: async (tx: any) => 'transaction-signature',
      on: (event: string, callback: Function) => {}
    };
    
    // @ts-ignore - Assegna il mock a window.solana
    global.window = { solana: mockWallet };
    
    adapter = new PhantomWalletAdapter();
  });
  
  it('should initialize with correct name and icon', () => {
    expect(adapter.name).to.equal('Phantom');
    expect(adapter.icon).to.include('phantom');
  });
  
  it('should connect to wallet', async () => {
    await adapter.connect();
    
    expect(adapter.connected).to.be.true;
    expect(adapter.publicKey).to.equal('phantom-public-key');
  });
});

// Test di base per MetaMaskWalletAdapter
describe('MetaMaskWalletAdapter', () => {
  let adapter: MetaMaskWalletAdapter;
  let mockProvider: any;
  
  beforeEach(() => {
    // Mock di window.ethereum
    mockProvider = {
      request: async (params: any) => {
        if (params.method === 'eth_requestAccounts') {
          return ['metamask-address'];
        }
        return null;
      },
      on: (event: string, callback: Function) => {}
    };
    
    // @ts-ignore - Assegna il mock a window.ethereum
    global.window = { ethereum: mockProvider };
    
    adapter = new MetaMaskWalletAdapter();
  });
  
  it('should initialize with correct name and icon', () => {
    expect(adapter.name).to.equal('MetaMask');
    expect(adapter.icon).to.include('metamask');
  });
  
  it('should connect to wallet', async () => {
    await adapter.connect();
    
    expect(adapter.connected).to.be.true;
    expect(adapter.publicKey).to.equal('metamask-address');
  });
});
