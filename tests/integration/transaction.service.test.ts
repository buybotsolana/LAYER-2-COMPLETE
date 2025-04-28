/**
 * @file transaction.service.test.ts
 * @description Test suite for the TransactionService
 */

import { TransactionService, CreateTransactionParams, TransactionQueryParams } from '../src/transaction/transaction.service';
import { Transaction, TransactionStatus, TransactionType } from '../src/transaction/transaction.entity';
import { DatabaseService } from '../src/database/database.service';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';

describe('TransactionService', () => {
  let transactionService: TransactionService;
  let databaseServiceStub: sinon.SinonStubbedInstance<DatabaseService>;
  let repositoryStub: any;
  
  beforeEach(() => {
    // Reset the singleton instance before each test
    (TransactionService as any).instance = null;
    
    // Create repository stub
    repositoryStub = {
      find: sinon.stub().resolves([]),
      findOne: sinon.stub().resolves(null),
      save: sinon.stub().resolves({}),
      remove: sinon.stub().resolves({}),
      count: sinon.stub().resolves(0),
      createQueryBuilder: sinon.stub().returns({
        where: sinon.stub().returnsThis(),
        andWhere: sinon.stub().returnsThis(),
        orderBy: sinon.stub().returnsThis(),
        addOrderBy: sinon.stub().returnsThis(),
        take: sinon.stub().returnsThis(),
        skip: sinon.stub().returnsThis(),
        leftJoinAndSelect: sinon.stub().returnsThis(),
        getMany: sinon.stub().resolves([]),
        getOne: sinon.stub().resolves({}),
        getCount: sinon.stub().resolves(0),
        update: sinon.stub().returnsThis(),
        set: sinon.stub().returnsThis(),
        execute: sinon.stub().resolves({ affected: 0 }),
        delete: sinon.stub().returnsThis(),
        from: sinon.stub().returnsThis(),
        select: sinon.stub().returnsThis(),
        getRawOne: sinon.stub().resolves({}),
        getRawMany: sinon.stub().resolves([])
      })
    };
    
    // Stub DatabaseService
    databaseServiceStub = sinon.createStubInstance(DatabaseService);
    databaseServiceStub.getRepository.returns(repositoryStub);
    sinon.stub(DatabaseService, 'getInstance').returns(databaseServiceStub as unknown as DatabaseService);
    
    // Get the TransactionService instance
    transactionService = TransactionService.getInstance();
  });
  
  afterEach(() => {
    // Restore the stubs after each test
    sinon.restore();
  });
  
  describe('getInstance', () => {
    it('should return a singleton instance', () => {
      const instance1 = TransactionService.getInstance();
      const instance2 = TransactionService.getInstance();
      
      expect(instance1).to.equal(instance2);
    });
  });
  
  describe('createTransaction', () => {
    it('should create a new transaction', async () => {
      // Setup
      const transactionParams: CreateTransactionParams = {
        sender: '0x1234',
        recipient: '0x5678',
        amount: '1000000000',
        gasLimit: 100000,
        gasPrice: '1000000000',
        nonce: 1,
        data: '0x',
        signature: '0xsignature',
        type: TransactionType.TRANSFER
      };
      
      const savedTransaction = {
        id: uuidv4(),
        hash: '0xhash',
        sender: transactionParams.sender,
        recipient: transactionParams.recipient,
        amount: transactionParams.amount,
        gasLimit: transactionParams.gasLimit,
        gasPrice: transactionParams.gasPrice,
        nonce: transactionParams.nonce,
        data: transactionParams.data,
        signature: transactionParams.signature,
        type: transactionParams.type,
        status: TransactionStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      repositoryStub.save.resolves(savedTransaction);
      
      // Execute
      const result = await transactionService.createTransaction(transactionParams);
      
      // Verify
      expect(repositoryStub.save.calledOnce).to.be.true;
      expect(result).to.deep.equal(savedTransaction);
    });
    
    it('should return existing transaction if hash already exists', async () => {
      // Setup
      const transactionParams: CreateTransactionParams = {
        sender: '0x1234',
        recipient: '0x5678',
        amount: '1000000000',
        gasLimit: 100000,
        gasPrice: '1000000000',
        nonce: 1,
        data: '0x',
        signature: '0xsignature',
        type: TransactionType.TRANSFER
      };
      
      const existingTransaction = {
        id: uuidv4(),
        hash: '0xhash',
        sender: transactionParams.sender,
        recipient: transactionParams.recipient,
        amount: transactionParams.amount,
        gasLimit: transactionParams.gasLimit,
        gasPrice: transactionParams.gasPrice,
        nonce: transactionParams.nonce,
        data: transactionParams.data,
        signature: transactionParams.signature,
        type: transactionParams.type,
        status: TransactionStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      // Stub getTransactionByHash to return an existing transaction
      sinon.stub(transactionService, 'getTransactionByHash').resolves(existingTransaction as Transaction);
      
      // Execute
      const result = await transactionService.createTransaction(transactionParams);
      
      // Verify
      expect(repositoryStub.save.called).to.be.false;
      expect(result).to.deep.equal(existingTransaction);
    });
    
    it('should handle errors during transaction creation', async () => {
      // Setup
      const transactionParams: CreateTransactionParams = {
        sender: '0x1234',
        recipient: '0x5678',
        amount: '1000000000',
        gasLimit: 100000,
        gasPrice: '1000000000',
        nonce: 1,
        data: '0x',
        signature: '0xsignature',
        type: TransactionType.TRANSFER
      };
      
      repositoryStub.save.rejects(new Error('Database error'));
      
      // Execute & Verify
      try {
        await transactionService.createTransaction(transactionParams);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Failed to create transaction');
      }
    });
  });
  
  describe('createTransactionBatch', () => {
    it('should create multiple transactions sequentially', async () => {
      // Setup
      const transactionParams: CreateTransactionParams[] = [
        {
          sender: '0x1234',
          recipient: '0x5678',
          amount: '1000000000',
          gasLimit: 100000,
          gasPrice: '1000000000',
          nonce: 1,
          data: '0x',
          signature: '0xsignature1',
          type: TransactionType.TRANSFER
        },
        {
          sender: '0x1234',
          recipient: '0x5678',
          amount: '2000000000',
          gasLimit: 100000,
          gasPrice: '1000000000',
          nonce: 2,
          data: '0x',
          signature: '0xsignature2',
          type: TransactionType.TRANSFER
        }
      ];
      
      const savedTransactions = transactionParams.map((params, index) => ({
        id: uuidv4(),
        hash: `0xhash${index}`,
        sender: params.sender,
        recipient: params.recipient,
        amount: params.amount,
        gasLimit: params.gasLimit,
        gasPrice: params.gasPrice,
        nonce: params.nonce,
        data: params.data,
        signature: params.signature,
        type: params.type,
        status: TransactionStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date()
      }));
      
      // Stub createTransaction to return saved transactions
      const createTransactionStub = sinon.stub(transactionService, 'createTransaction');
      createTransactionStub.onFirstCall().resolves(savedTransactions[0] as Transaction);
      createTransactionStub.onSecondCall().resolves(savedTransactions[1] as Transaction);
      
      // Execute
      const result = await transactionService.createTransactionBatch(transactionParams);
      
      // Verify
      expect(createTransactionStub.calledTwice).to.be.true;
      expect(result).to.have.length(2);
      expect(result[0]).to.deep.equal(savedTransactions[0]);
      expect(result[1]).to.deep.equal(savedTransactions[1]);
    });
    
    it('should handle errors during batch creation', async () => {
      // Setup
      const transactionParams: CreateTransactionParams[] = [
        {
          sender: '0x1234',
          recipient: '0x5678',
          amount: '1000000000',
          gasLimit: 100000,
          gasPrice: '1000000000',
          nonce: 1,
          data: '0x',
          signature: '0xsignature1',
          type: TransactionType.TRANSFER
        },
        {
          sender: '0x1234',
          recipient: '0x5678',
          amount: '2000000000',
          gasLimit: 100000,
          gasPrice: '1000000000',
          nonce: 2,
          data: '0x',
          signature: '0xsignature2',
          type: TransactionType.TRANSFER
        }
      ];
      
      // Stub createTransaction to throw an error
      sinon.stub(transactionService, 'createTransaction').rejects(new Error('Database error'));
      
      // Execute & Verify
      try {
        await transactionService.createTransactionBatch(transactionParams);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Failed to create transaction batch');
      }
    });
  });
  
  describe('updateTransactionStatus', () => {
    it('should update transaction status', async () => {
      // Setup
      const transactionId = uuidv4();
      const transaction = {
        id: transactionId,
        status: TransactionStatus.PENDING,
        errorMessage: null,
        blockNumber: null,
        blockTimestamp: null
      };
      
      repositoryStub.findOne.resolves(transaction);
      repositoryStub.save.resolves({
        ...transaction,
        status: TransactionStatus.CONFIRMED,
        blockNumber: 12345,
        blockTimestamp: new Date()
      });
      
      // Execute
      const result = await transactionService.updateTransactionStatus(
        transactionId,
        TransactionStatus.CONFIRMED,
        null,
        12345,
        new Date()
      );
      
      // Verify
      expect(repositoryStub.findOne.calledOnce).to.be.true;
      expect(repositoryStub.save.calledOnce).to.be.true;
      expect(result.status).to.equal(TransactionStatus.CONFIRMED);
      expect(result.blockNumber).to.equal(12345);
    });
    
    it('should throw error if transaction not found', async () => {
      // Setup
      const transactionId = uuidv4();
      repositoryStub.findOne.resolves(null);
      
      // Execute & Verify
      try {
        await transactionService.updateTransactionStatus(
          transactionId,
          TransactionStatus.CONFIRMED
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Transaction not found');
      }
    });
  });
  
  describe('updateTransactionStatusBatch', () => {
    it('should update multiple transaction statuses', async () => {
      // Setup
      const updates = [
        {
          id: uuidv4(),
          status: TransactionStatus.CONFIRMED,
          blockNumber: 12345,
          blockTimestamp: new Date()
        },
        {
          id: uuidv4(),
          status: TransactionStatus.FAILED,
          errorMessage: 'Transaction failed'
        }
      ];
      
      // Stub updateTransactionStatus to return updated transactions
      const updateTransactionStatusStub = sinon.stub(transactionService, 'updateTransactionStatus');
      updateTransactionStatusStub.resolves({} as Transaction);
      
      // Execute
      const result = await transactionService.updateTransactionStatusBatch(updates);
      
      // Verify
      expect(updateTransactionStatusStub.calledTwice).to.be.true;
      expect(result).to.equal(2);
    });
  });
  
  describe('assignTransactionToBundle', () => {
    it('should assign transaction to bundle', async () => {
      // Setup
      const transactionId = uuidv4();
      const bundleId = uuidv4();
      const transaction = {
        id: transactionId,
        bundleId: null,
        status: TransactionStatus.PENDING
      };
      
      repositoryStub.findOne.resolves(transaction);
      repositoryStub.save.resolves({
        ...transaction,
        bundleId: bundleId,
        status: TransactionStatus.BUNDLED
      });
      
      // Execute
      const result = await transactionService.assignTransactionToBundle(transactionId, bundleId);
      
      // Verify
      expect(repositoryStub.findOne.calledOnce).to.be.true;
      expect(repositoryStub.save.calledOnce).to.be.true;
      expect(result.bundleId).to.equal(bundleId);
      expect(result.status).to.equal(TransactionStatus.BUNDLED);
    });
    
    it('should throw error if transaction not found', async () => {
      // Setup
      const transactionId = uuidv4();
      const bundleId = uuidv4();
      repositoryStub.findOne.resolves(null);
      
      // Execute & Verify
      try {
        await transactionService.assignTransactionToBundle(transactionId, bundleId);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Transaction not found');
      }
    });
  });
  
  describe('assignTransactionsToBundleBatch', () => {
    it('should assign multiple transactions to bundle', async () => {
      // Setup
      const transactionIds = [uuidv4(), uuidv4()];
      const bundleId = uuidv4();
      
      const queryBuilderStub = repositoryStub.createQueryBuilder();
      queryBuilderStub.execute.resolves({ affected: 2 });
      
      // Execute
      const result = await transactionService.assignTransactionsToBundleBatch(transactionIds, bundleId);
      
      // Verify
      expect(queryBuilderStub.execute.calledOnce).to.be.true;
      expect(result).to.equal(2);
    });
  });
  
  describe('getTransactionById', () => {
    it('should get transaction by ID', async () => {
      // Setup
      const transactionId = uuidv4();
      const transaction = {
        id: transactionId,
        status: TransactionStatus.PENDING
      };
      
      repositoryStub.findOne.resolves(transaction);
      
      // Execute
      const result = await transactionService.getTransactionById(transactionId);
      
      // Verify
      expect(repositoryStub.findOne.calledOnce).to.be.true;
      expect(result).to.deep.equal(transaction);
    });
    
    it('should return null if transaction not found', async () => {
      // Setup
      const transactionId = uuidv4();
      repositoryStub.findOne.resolves(null);
      
      // Execute
      const result = await transactionService.getTransactionById(transactionId);
      
      // Verify
      expect(repositoryStub.findOne.calledOnce).to.be.true;
      expect(result).to.be.null;
    });
  });
  
  describe('getTransactionByHash', () => {
    it('should get transaction by hash', async () => {
      // Setup
      const transactionHash = '0xhash';
      const transaction = {
        id: uuidv4(),
        hash: transactionHash,
        status: TransactionStatus.PENDING
      };
      
      repositoryStub.findOne.resolves(transaction);
      
      // Execute
      const result = await transactionService.getTransactionByHash(transactionHash);
      
      // Verify
      expect(repositoryStub.findOne.calledOnce).to.be.true;
      expect(result).to.deep.equal(transaction);
    });
  });
  
  describe('getTransactions', () => {
    it('should get transactions by query parameters', async () => {
      // Setup
      const queryParams: TransactionQueryParams = {
        status: TransactionStatus.PENDING,
        sender: '0x1234',
        limit: 10,
        offset: 0
      };
      
      const transactions = [
        {
          id: uuidv4(),
          status: TransactionStatus.PENDING,
          sender: '0x1234'
        },
        {
          id: uuidv4(),
          status: TransactionStatus.PENDING,
          sender: '0x1234'
        }
      ];
      
      const queryBuilderStub = repositoryStub.createQueryBuilder();
      queryBuilderStub.getMany.resolves(transactions);
      
      // Execute
      const result = await transactionService.getTransactions(queryParams);
      
      // Verify
      expect(queryBuilderStub.getMany.calledOnce).to.be.true;
      expect(result).to.deep.equal(transactions);
    });
  });
  
  describe('getPendingTransactions', () => {
    it('should get pending transactions', async () => {
      // Setup
      const pendingTransactions = [
        {
          id: uuidv4(),
          status: TransactionStatus.PENDING
        },
        {
          id: uuidv4(),
          status: TransactionStatus.PENDING
        }
      ];
      
      const queryBuilderStub = repositoryStub.createQueryBuilder();
      queryBuilderStub.getMany.resolves(pendingTransactions);
      
      // Execute
      const result = await transactionService.getPendingTransactions(10, 0);
      
      // Verify
      expect(queryBuilderStub.getMany.calledOnce).to.be.true;
      expect(result).to.deep.equal(pendingTransactions);
    });
  });
  
  describe('getExpiredTransactions', () => {
    it('should get expired transactions', async () => {
      // Setup
      const expiredTransactions = [
        {
          id: uuidv4(),
          status: TransactionStatus.PENDING,
          expiresAt: new Date(Date.now() - 3600000) // 1 hour ago
        }
      ];
      
      const queryBuilderStub = repositoryStub.createQueryBuilder();
      queryBuilderStub.getMany.resolves(expiredTransactions);
      
      // Execute
      const result = await transactionService.getExpiredTransactions(10);
      
      // Verify
      expect(queryBuilderStub.getMany.calledOnce).to.be.true;
      expect(result).to.deep.equal(expiredTransactions);
    });
  });
  
  describe('markExpiredTransactions', () => {
    it('should mark expired transactions', async () => {
      // Setup
      const queryBuilderStub = repositoryStub.createQueryBuilder();
      queryBuilderStub.execute.resolves({ affected: 5 });
      
      // Execute
      const result = await transactionService.markExpiredTransactions();
      
      // Verify
      expect(queryBuilderStub.execute.calledOnce).to.be.true;
      expect(result).to.equal(5);
    });
  });
  
  describe('getPendingTransactionCount', () => {
    it('should get pending transaction count', async () => {
      // Setup
      repositoryStub.count.resolves(10);
      
      // Execute
      const result = await transactionService.getPendingTransactionCount();
      
      // Verify
      expect(repositoryStub.count.calledOnce).to.be.true;
      expect(result).to.equal(10);
    });
  });
  
  describe('getTransactionStatistics', () => {
    it('should get transaction statistics', async () => {
      // Setup
      repositoryStub.count.resolves(100);
      
      const queryBuilderStub = repositoryStub.createQueryBuilder();
      queryBuilderStub.getRawOne.resolves({ avgTime: '10.5', avgFee: '1500000000' });
      
      // Execute
      const result = await transactionService.getTransactionStatistics(true);
      
      // Verify
      expect(result).to.exist;
      expect(result).to.have.property('totalCount', 100);
      expect(result).to.have.property('averageConfirmationTime', 10.5);
      expect(result).to.have.property('averageFee', '1500000000');
    });
    
    it('should use cached statistics if available and not forced to refresh', async () => {
      // Setup
      repositoryStub.count.resolves(100);
      
      const queryBuilderStub = repositoryStub.createQueryBuilder();
      queryBuilderStub.getRawOne.resolves({ avgTime: '10.5', avgFee: '1500000000' });
      
      // Execute first call to populate cache
      await transactionService.getTransactionStatistics(true);
      
      // Reset stubs to verify they're not called again
      repositoryStub.count.resetHistory();
      queryBuilderStub.getRawOne.resetHistory();
      
      // Execute second call with cache
      const result = await transactionService.getTransactionStatistics(false);
      
      // Verify
      expect(repositoryStub.count.called).to.be.false;
      expect(result).to.exist;
    });
  });
  
  describe('cleanupOldTransactions', () => {
    it('should clean up old transactions', async () => {
      // Setup
      const queryBuilderStub = repositoryStub.createQueryBuilder();
      queryBuilderStub.execute.resolves({ affected: 15 });
      
      // Execute
      const result = await transactionService.cleanupOldTransactions(30);
      
      // Verify
      expect(queryBuilderStub.execute.calledOnce).to.be.true;
      expect(result).to.equal(15);
    });
  });
});
