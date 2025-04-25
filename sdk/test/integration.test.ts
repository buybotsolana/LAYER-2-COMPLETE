import { expect } from 'chai';
import { createL2Client, L2Client, VERSION } from '../src/index';

describe('SDK Integration Tests', () => {
  describe('Exported components', () => {
    it('should export all required components', () => {
      // Verifica che tutte le componenti principali siano esportate
      expect(createL2Client).to.be.a('function');
      expect(L2Client).to.be.a('function');
      expect(VERSION).to.be.a('string');
    });
    
    it('should create a client with the factory function', () => {
      const client = createL2Client('http://localhost:8899');
      expect(client).to.be.instanceOf(L2Client);
    });
  });
  
  describe('Client factory functions', () => {
    it('should create a devnet client', () => {
      const client = L2Client.devnet();
      expect(client).to.be.instanceOf(L2Client);
      expect(client.getConnection().rpcEndpoint).to.include('devnet');
    });
    
    it('should create a testnet client', () => {
      const client = L2Client.testnet();
      expect(client).to.be.instanceOf(L2Client);
      expect(client.getConnection().rpcEndpoint).to.include('testnet');
    });
    
    it('should create a mainnet client', () => {
      const client = L2Client.mainnet();
      expect(client).to.be.instanceOf(L2Client);
      expect(client.getConnection().rpcEndpoint).to.include('mainnet');
    });
  });
  
  describe('Client component access', () => {
    let client: L2Client;
    
    beforeEach(() => {
      client = createL2Client('http://localhost:8899');
    });
    
    it('should provide access to AccountManager', () => {
      const accountManager = client.account();
      expect(accountManager).to.not.be.undefined;
      expect(accountManager.getBalance).to.be.a('function');
      expect(accountManager.getAccountInfo).to.be.a('function');
      expect(accountManager.accountExists).to.be.a('function');
      expect(accountManager.createAccount).to.be.a('function');
      expect(accountManager.transfer).to.be.a('function');
    });
    
    it('should provide access to TransactionManager', () => {
      const transactionManager = client.transaction();
      expect(transactionManager).to.not.be.undefined;
      expect(transactionManager.sendTransaction).to.be.a('function');
      expect(transactionManager.sendInstructions).to.be.a('function');
      expect(transactionManager.getTransaction).to.be.a('function');
      expect(transactionManager.getTransactionStatus).to.be.a('function');
      expect(transactionManager.waitForConfirmation).to.be.a('function');
      expect(transactionManager.simulateTransaction).to.be.a('function');
    });
    
    it('should provide access to BridgeManager', () => {
      const bridgeManager = client.bridge();
      expect(bridgeManager).to.not.be.undefined;
      expect(bridgeManager.initialize).to.be.a('function');
      expect(bridgeManager.getConfig).to.be.a('function');
      expect(bridgeManager.depositETH).to.be.a('function');
      expect(bridgeManager.depositERC20).to.be.a('function');
      expect(bridgeManager.withdrawETH).to.be.a('function');
      expect(bridgeManager.withdrawToken).to.be.a('function');
      expect(bridgeManager.getDepositStatus).to.be.a('function');
      expect(bridgeManager.getWithdrawalStatus).to.be.a('function');
      expect(bridgeManager.generateWithdrawalProof).to.be.a('function');
      expect(bridgeManager.finalizeWithdrawal).to.be.a('function');
      expect(bridgeManager.getDepositsForAddress).to.be.a('function');
      expect(bridgeManager.getWithdrawalsForAddress).to.be.a('function');
    });
  });
  
  describe('Error handling', () => {
    let client: L2Client;
    
    beforeEach(() => {
      client = createL2Client('http://invalid-endpoint.example.com');
    });
    
    it('should handle connection errors gracefully', async () => {
      const isConnected = await client.isConnected();
      expect(isConnected).to.be.false;
    });
    
    it('should return appropriate error when wallet adapter is not set', () => {
      expect(() => client.getWalletAdapter()).to.throw('Wallet adapter not set');
    });
  });
});
