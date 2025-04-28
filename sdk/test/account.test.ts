import { AccountManager } from '../src/account';
import { L2Client } from '../src/client';
import { expect } from 'chai';
import { mock, instance, when, verify, anything } from 'ts-mockito';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram } from '@solana/web3.js';

describe('AccountManager', () => {
  let mockConnection: Connection;
  let mockClient: L2Client;
  let accountManager: AccountManager;
  
  beforeEach(() => {
    mockConnection = mock(Connection);
    mockClient = mock(L2Client);
    when(mockClient.getConnection()).thenReturn(instance(mockConnection));
    
    accountManager = new AccountManager(instance(mockClient));
  });
  
  describe('getBalance', () => {
    it('should return the balance for a valid address', async () => {
      const address = new PublicKey('11111111111111111111111111111111');
      when(mockConnection.getBalance(address)).thenResolve(1000000);
      
      const balance = await accountManager.getBalance(address);
      
      expect(balance).to.equal(1000000);
      verify(mockConnection.getBalance(address)).once();
    });
    
    it('should accept a string address', async () => {
      const addressStr = '11111111111111111111111111111111';
      const address = new PublicKey(addressStr);
      when(mockConnection.getBalance(address)).thenResolve(1000000);
      
      const balance = await accountManager.getBalance(addressStr);
      
      expect(balance).to.equal(1000000);
      verify(mockConnection.getBalance(address)).once();
    });
    
    it('should throw an error for an invalid address', async () => {
      try {
        await accountManager.getBalance('invalid-address');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
      }
    });
  });
  
  describe('getAccountInfo', () => {
    it('should return account info for a valid address', async () => {
      const address = new PublicKey('11111111111111111111111111111111');
      const mockAccountInfo = {
        lamports: 1000000,
        owner: new PublicKey('11111111111111111111111111111111'),
        executable: false,
        data: Buffer.from([]),
        rentEpoch: 0
      };
      
      when(mockConnection.getAccountInfo(address)).thenResolve(mockAccountInfo);
      
      const accountInfo = await accountManager.getAccountInfo(address);
      
      expect(accountInfo).to.deep.equal({
        address: address.toString(),
        lamports: 1000000,
        owner: '11111111111111111111111111111111',
        executable: false,
        rentEpoch: 0,
        data: Buffer.from([])
      });
      
      verify(mockConnection.getAccountInfo(address)).once();
    });
    
    it('should return null for a non-existent account', async () => {
      const address = new PublicKey('11111111111111111111111111111111');
      
      when(mockConnection.getAccountInfo(address)).thenResolve(null);
      
      const accountInfo = await accountManager.getAccountInfo(address);
      
      expect(accountInfo).to.be.null;
      verify(mockConnection.getAccountInfo(address)).once();
    });
  });
  
  describe('accountExists', () => {
    it('should return true for an existing account', async () => {
      const address = new PublicKey('11111111111111111111111111111111');
      const mockAccountInfo = {
        lamports: 1000000,
        owner: new PublicKey('11111111111111111111111111111111'),
        executable: false,
        data: Buffer.from([]),
        rentEpoch: 0
      };
      
      when(mockConnection.getAccountInfo(address)).thenResolve(mockAccountInfo);
      
      const exists = await accountManager.accountExists(address);
      
      expect(exists).to.be.true;
      verify(mockConnection.getAccountInfo(address)).once();
    });
    
    it('should return false for a non-existent account', async () => {
      const address = new PublicKey('11111111111111111111111111111111');
      
      when(mockConnection.getAccountInfo(address)).thenResolve(null);
      
      const exists = await accountManager.accountExists(address);
      
      expect(exists).to.be.false;
      verify(mockConnection.getAccountInfo(address)).once();
    });
  });
  
  describe('createAccount', () => {
    it('should create a new account', async () => {
      const fromKeypair = Keypair.generate();
      const toPublicKey = new PublicKey('11111111111111111111111111111111');
      const lamports = 1000000;
      const mockSignature = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
      
      when(mockConnection.sendTransaction(anything(), anything())).thenResolve(mockSignature);
      when(mockConnection.confirmTransaction(mockSignature)).thenResolve({ value: { err: null } });
      
      const signature = await accountManager.createAccount(fromKeypair, toPublicKey, lamports);
      
      expect(signature).to.equal(mockSignature);
      verify(mockConnection.sendTransaction(anything(), anything())).once();
      verify(mockConnection.confirmTransaction(mockSignature)).once();
    });
  });
  
  describe('transfer', () => {
    it('should transfer lamports between accounts', async () => {
      const fromKeypair = Keypair.generate();
      const toPublicKey = new PublicKey('11111111111111111111111111111111');
      const lamports = 1000000;
      const mockSignature = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
      
      when(mockConnection.sendTransaction(anything(), anything())).thenResolve(mockSignature);
      when(mockConnection.confirmTransaction(mockSignature)).thenResolve({ value: { err: null } });
      
      const signature = await accountManager.transfer(fromKeypair, toPublicKey, lamports);
      
      expect(signature).to.equal(mockSignature);
      verify(mockConnection.sendTransaction(anything(), anything())).once();
      verify(mockConnection.confirmTransaction(mockSignature)).once();
    });
    
    it('should accept a string for the recipient address', async () => {
      const fromKeypair = Keypair.generate();
      const toAddressStr = '11111111111111111111111111111111';
      const toPublicKey = new PublicKey(toAddressStr);
      const lamports = 1000000;
      const mockSignature = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
      
      when(mockConnection.sendTransaction(anything(), anything())).thenResolve(mockSignature);
      when(mockConnection.confirmTransaction(mockSignature)).thenResolve({ value: { err: null } });
      
      const signature = await accountManager.transfer(fromKeypair, toAddressStr, lamports);
      
      expect(signature).to.equal(mockSignature);
      verify(mockConnection.sendTransaction(anything(), anything())).once();
      verify(mockConnection.confirmTransaction(mockSignature)).once();
    });
  });
});
