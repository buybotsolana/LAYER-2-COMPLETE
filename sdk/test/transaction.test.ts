import { TransactionManager } from '../src/transaction';
import { L2Client } from '../src/client';
import { expect } from 'chai';
import { mock, instance, when, verify, anything } from 'ts-mockito';
import { 
  Connection, 
  PublicKey, 
  Keypair, 
  Transaction, 
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction
} from '@solana/web3.js';

describe('TransactionManager', () => {
  let mockConnection: Connection;
  let mockClient: L2Client;
  let transactionManager: TransactionManager;
  
  beforeEach(() => {
    mockConnection = mock(Connection);
    mockClient = mock(L2Client);
    when(mockClient.getConnection()).thenReturn(instance(mockConnection));
    
    transactionManager = new TransactionManager(instance(mockClient));
  });
  
  describe('sendTransaction', () => {
    it('should send a transaction and return success result', async () => {
      const transaction = new Transaction();
      const signer = Keypair.generate();
      const mockSignature = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
      
      when(mockConnection.sendTransaction(anything(), anything())).thenResolve(mockSignature);
      
      const result = await transactionManager.sendTransaction(transaction, [signer]);
      
      expect(result.success).to.be.true;
      expect(result.signature).to.equal(mockSignature);
      expect(result.error).to.be.null;
      verify(mockConnection.sendTransaction(anything(), anything())).once();
    });
    
    it('should handle errors and return failure result', async () => {
      const transaction = new Transaction();
      const signer = Keypair.generate();
      const mockError = new Error('Transaction failed');
      
      when(mockConnection.sendTransaction(anything(), anything())).thenReject(mockError);
      
      const result = await transactionManager.sendTransaction(transaction, [signer]);
      
      expect(result.success).to.be.false;
      expect(result.signature).to.be.null;
      expect(result.error).to.equal(mockError);
      verify(mockConnection.sendTransaction(anything(), anything())).once();
    });
  });
  
  describe('sendInstructions', () => {
    it('should create a transaction from instructions and send it', async () => {
      const fromPubkey = Keypair.generate().publicKey;
      const toPubkey = new PublicKey('11111111111111111111111111111111');
      const instruction = SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports: 1000000
      });
      
      const signer = Keypair.generate();
      const mockSignature = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
      
      when(mockConnection.sendTransaction(anything(), anything())).thenResolve(mockSignature);
      
      const result = await transactionManager.sendInstructions([instruction], [signer]);
      
      expect(result.success).to.be.true;
      expect(result.signature).to.equal(mockSignature);
      expect(result.error).to.be.null;
      verify(mockConnection.sendTransaction(anything(), anything())).once();
    });
  });
  
  describe('getTransaction', () => {
    it('should return transaction details for a valid signature', async () => {
      const signature = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
      const mockTransactionResponse = {
        slot: 1234,
        transaction: {
          signatures: [signature],
          message: {
            accountKeys: [],
            instructions: []
          }
        },
        meta: {
          fee: 5000,
          err: null
        }
      };
      
      when(mockConnection.getTransaction(signature)).thenResolve(mockTransactionResponse);
      
      const txDetails = await transactionManager.getTransaction(signature);
      
      expect(txDetails).to.deep.equal(mockTransactionResponse);
      verify(mockConnection.getTransaction(signature)).once();
    });
    
    it('should return null for a non-existent transaction', async () => {
      const signature = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
      
      when(mockConnection.getTransaction(signature)).thenResolve(null);
      
      const txDetails = await transactionManager.getTransaction(signature);
      
      expect(txDetails).to.be.null;
      verify(mockConnection.getTransaction(signature)).once();
    });
  });
  
  describe('getTransactionStatus', () => {
    it('should return "confirmed" for a successful transaction', async () => {
      const signature = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
      const mockSignatureStatus = {
        slot: 1234,
        confirmations: 1,
        err: null,
        confirmationStatus: 'confirmed'
      };
      
      when(mockConnection.getSignatureStatus(signature)).thenResolve({ value: mockSignatureStatus });
      
      const status = await transactionManager.getTransactionStatus(signature);
      
      expect(status).to.equal('confirmed');
      verify(mockConnection.getSignatureStatus(signature)).once();
    });
    
    it('should return "failed" for a failed transaction', async () => {
      const signature = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
      const mockSignatureStatus = {
        slot: 1234,
        confirmations: 1,
        err: { InstructionError: [0, 'Custom'] },
        confirmationStatus: 'confirmed'
      };
      
      when(mockConnection.getSignatureStatus(signature)).thenResolve({ value: mockSignatureStatus });
      
      const status = await transactionManager.getTransactionStatus(signature);
      
      expect(status).to.equal('failed');
      verify(mockConnection.getSignatureStatus(signature)).once();
    });
    
    it('should return "pending" for a pending transaction', async () => {
      const signature = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
      
      when(mockConnection.getSignatureStatus(signature)).thenResolve({ value: null });
      
      const status = await transactionManager.getTransactionStatus(signature);
      
      expect(status).to.equal('pending');
      verify(mockConnection.getSignatureStatus(signature)).once();
    });
  });
  
  describe('waitForConfirmation', () => {
    it('should resolve when transaction is confirmed', async () => {
      const signature = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
      
      when(mockConnection.confirmTransaction(signature, anything())).thenResolve({ value: { err: null } });
      
      const confirmed = await transactionManager.waitForConfirmation(signature, 30000);
      
      expect(confirmed).to.be.true;
      verify(mockConnection.confirmTransaction(signature, anything())).once();
    });
    
    it('should resolve to false when transaction fails', async () => {
      const signature = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
      
      when(mockConnection.confirmTransaction(signature, anything())).thenResolve({ value: { err: { InstructionError: [0, 'Custom'] } } });
      
      const confirmed = await transactionManager.waitForConfirmation(signature, 30000);
      
      expect(confirmed).to.be.false;
      verify(mockConnection.confirmTransaction(signature, anything())).once();
    });
    
    it('should reject when timeout occurs', async () => {
      const signature = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
      
      when(mockConnection.confirmTransaction(signature, anything())).thenReject(new Error('Timeout'));
      
      try {
        await transactionManager.waitForConfirmation(signature, 30000);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect(error.message).to.include('Timeout');
      }
      
      verify(mockConnection.confirmTransaction(signature, anything())).once();
    });
  });
  
  describe('simulateTransaction', () => {
    it('should simulate a transaction and return the result', async () => {
      const transaction = new Transaction();
      const mockSimulationResponse = {
        err: null,
        logs: ['Program log: Hello, World!'],
        accounts: null,
        unitsConsumed: 1000
      };
      
      when(mockConnection.simulateTransaction(anything())).thenResolve({ value: mockSimulationResponse });
      
      const simulation = await transactionManager.simulateTransaction(transaction);
      
      expect(simulation).to.deep.equal(mockSimulationResponse);
      verify(mockConnection.simulateTransaction(anything())).once();
    });
    
    it('should handle errors during simulation', async () => {
      const transaction = new Transaction();
      const mockError = new Error('Simulation failed');
      
      when(mockConnection.simulateTransaction(anything())).thenReject(mockError);
      
      try {
        await transactionManager.simulateTransaction(transaction);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.equal(mockError);
      }
      
      verify(mockConnection.simulateTransaction(anything())).once();
    });
  });
});
