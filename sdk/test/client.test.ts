import { L2Client } from '../src/client';
import { expect } from 'chai';
import { mock, instance, when, verify, anything } from 'ts-mockito';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';

describe('L2Client', () => {
  let mockConnection: Connection;
  let client: L2Client;

  beforeEach(() => {
    mockConnection = mock(Connection);
    client = new L2Client({
      endpoint: 'http://localhost:8899',
      connection: instance(mockConnection)
    });
  });

  describe('constructor', () => {
    it('should create a client with default options', () => {
      const defaultClient = new L2Client({
        endpoint: 'http://localhost:8899'
      });
      expect(defaultClient).to.be.instanceOf(L2Client);
    });

    it('should create a client with custom options', () => {
      const keypair = Keypair.generate();
      const customClient = new L2Client({
        endpoint: 'http://localhost:8899',
        commitment: 'confirmed',
        keypair
      });
      expect(customClient).to.be.instanceOf(L2Client);
    });
  });

  describe('static factory methods', () => {
    it('should create a devnet client', () => {
      const devnetClient = L2Client.devnet();
      expect(devnetClient).to.be.instanceOf(L2Client);
    });

    it('should create a testnet client', () => {
      const testnetClient = L2Client.testnet();
      expect(testnetClient).to.be.instanceOf(L2Client);
    });

    it('should create a mainnet client', () => {
      const mainnetClient = L2Client.mainnet();
      expect(mainnetClient).to.be.instanceOf(L2Client);
    });
  });

  describe('isConnected', () => {
    it('should return true when connected', async () => {
      when(mockConnection.getVersion()).thenResolve({ 'solana-core': '1.10.0' });
      const result = await client.isConnected();
      expect(result).to.be.true;
      verify(mockConnection.getVersion()).once();
    });

    it('should return false when not connected', async () => {
      when(mockConnection.getVersion()).thenReject(new Error('Connection failed'));
      const result = await client.isConnected();
      expect(result).to.be.false;
      verify(mockConnection.getVersion()).once();
    });
  });

  describe('getConnection', () => {
    it('should return the connection', () => {
      const connection = client.getConnection();
      expect(connection).to.equal(instance(mockConnection));
    });
  });

  describe('account', () => {
    it('should return an AccountManager instance', () => {
      const accountManager = client.account();
      expect(accountManager).to.not.be.undefined;
    });
  });

  describe('transaction', () => {
    it('should return a TransactionManager instance', () => {
      const transactionManager = client.transaction();
      expect(transactionManager).to.not.be.undefined;
    });
  });

  describe('bridge', () => {
    it('should return a BridgeManager instance', () => {
      const bridgeManager = client.bridge();
      expect(bridgeManager).to.not.be.undefined;
    });
  });

  describe('setWalletAdapter', () => {
    it('should set the wallet adapter', () => {
      const mockWalletAdapter = {
        name: 'Test Wallet',
        connected: true,
        publicKey: 'test-public-key',
        connect: async () => {},
        disconnect: async () => {},
        signTransaction: async (tx: any) => tx,
        signMessage: async (msg: Uint8Array) => msg,
        sendTransaction: async (tx: any) => 'signature'
      };
      
      client.setWalletAdapter(mockWalletAdapter);
      
      // Verify that the wallet adapter was set by checking if we can access it
      // This is an indirect test since the wallet adapter is private
      expect(() => client.getWalletAdapter()).to.not.throw();
    });
  });

  describe('getWalletAdapter', () => {
    it('should return the wallet adapter if set', () => {
      const mockWalletAdapter = {
        name: 'Test Wallet',
        connected: true,
        publicKey: 'test-public-key',
        connect: async () => {},
        disconnect: async () => {},
        signTransaction: async (tx: any) => tx,
        signMessage: async (msg: Uint8Array) => msg,
        sendTransaction: async (tx: any) => 'signature'
      };
      
      client.setWalletAdapter(mockWalletAdapter);
      const walletAdapter = client.getWalletAdapter();
      expect(walletAdapter).to.equal(mockWalletAdapter);
    });

    it('should throw an error if wallet adapter is not set', () => {
      expect(() => client.getWalletAdapter()).to.throw('Wallet adapter not set');
    });
  });
});
