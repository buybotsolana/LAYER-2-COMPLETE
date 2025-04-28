/**
 * @file sequencer.service.test.ts
 * @description Test suite for the SequencerService
 */

import { SequencerService, CreateBundleParams, BundleQueryParams } from '../src/sequencer/sequencer.service';
import { Bundle, BundleStatus, BundlePriority, BundleType } from '../src/sequencer/bundle.entity';
import { TransactionService } from '../src/transaction/transaction.service';
import { Transaction, TransactionStatus, TransactionType } from '../src/transaction/transaction.entity';
import { DatabaseService } from '../src/database/database.service';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';

describe('SequencerService', () => {
  let sequencerService: SequencerService;
  let databaseServiceStub: sinon.SinonStubbedInstance<DatabaseService>;
  let transactionServiceStub: sinon.SinonStubbedInstance<TransactionService>;
  let repositoryStub: any;
  
  beforeEach(() => {
    // Reset the singleton instance before each test
    (SequencerService as any).instance = null;
    
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
    
    // Stub TransactionService
    transactionServiceStub = sinon.createStubInstance(TransactionService);
    sinon.stub(TransactionService, 'getInstance').returns(transactionServiceStub as unknown as TransactionService);
    
    // Get the SequencerService instance
    sequencerService = SequencerService.getInstance();
  });
  
  afterEach(() => {
    // Restore the stubs after each test
    sinon.restore();
  });
  
  describe('getInstance', () => {
    it('should return a singleton instance', () => {
      const instance1 = SequencerService.getInstance();
      const instance2 = SequencerService.getInstance();
      
      expect(instance1).to.equal(instance2);
    });
  });
  
  describe('initialize', () => {
    it('should initialize the sequencer service', async () => {
      // Setup
      const pendingBundle = {
        id: uuidv4(),
        status: BundleStatus.PENDING,
        createdAt: new Date(),
        transactions: []
      };
      
      repositoryStub.find.resolves([pendingBundle]);
      
      // Execute
      await sequencerService.initialize();
      
      // Verify
      expect(repositoryStub.find.calledOnce).to.be.true;
      expect(sequencerService.getCurrentBundle()).to.deep.equal(pendingBundle);
    });
    
    it('should create a new bundle if no pending bundles exist', async () => {
      // Setup
      repositoryStub.find.resolves([]);
      
      const newBundle = {
        id: uuidv4(),
        status: BundleStatus.PENDING,
        createdAt: new Date(),
        transactions: []
      };
      
      // Stub createBundle to return a new bundle
      sinon.stub(sequencerService, 'createBundle').resolves(newBundle as Bundle);
      
      // Execute
      await sequencerService.initialize();
      
      // Verify
      expect(repositoryStub.find.calledOnce).to.be.true;
      expect(sequencerService.createBundle).to.have.been.calledOnce;
      expect(sequencerService.getCurrentBundle()).to.deep.equal(newBundle);
    });
  });
  
  describe('createBundle', () => {
    it('should create a new bundle with default parameters', async () => {
      // Setup
      const bundleId = uuidv4();
      const newBundle = {
        id: bundleId,
        status: BundleStatus.PENDING,
        priority: BundlePriority.MEDIUM,
        type: BundleType.STANDARD,
        hash: null,
        maxTransactions: 100,
        maxGas: 10000000,
        currentGas: 0,
        priorityFee: '1000000000',
        baseFee: '0',
        totalFee: '0',
        transactionCount: 0,
        retryCount: 0,
        maxRetries: 3,
        expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
        finalizedAt: null,
        processedAt: null,
        submittedAt: null,
        confirmedAt: null,
        blockNumber: null,
        blockTimestamp: null,
        errorMessage: null,
        sequencerId: sinon.match.string,
        parentBundleId: null,
        rawTransaction: null,
        submissionGasPrice: null,
        gasUsed: null,
        effectiveGasPrice: null,
        metadata: {},
        optimizationSettings: {
          optimizeGasPrice: true,
          reorderTransactions: true,
          retryFailedTransactions: true,
          gasPriceBoostFactor: 1.1
        },
        performanceMetrics: {},
        transactions: []
      };
      
      repositoryStub.save.resolves(newBundle);
      
      // Execute
      const result = await sequencerService.createBundle();
      
      // Verify
      expect(repositoryStub.save.calledOnce).to.be.true;
      expect(result).to.deep.equal(newBundle);
      expect(sequencerService.getCurrentBundle()).to.deep.equal(newBundle);
    });
    
    it('should create a new bundle with custom parameters', async () => {
      // Setup
      const bundleParams: CreateBundleParams = {
        maxTransactions: 50,
        maxGas: 5000000,
        priorityFee: '2000000000',
        baseFee: '1000000000',
        priority: BundlePriority.HIGH,
        type: BundleType.SWAP,
        expiresAt: new Date(Date.now() + 7200000), // 2 hours from now
        metadata: { custom: 'value' },
        optimizationSettings: {
          optimizeGasPrice: false,
          gasPriceBoostFactor: 1.0
        }
      };
      
      const newBundle = {
        id: uuidv4(),
        status: BundleStatus.PENDING,
        priority: BundlePriority.HIGH,
        type: BundleType.SWAP,
        hash: null,
        maxTransactions: 50,
        maxGas: 5000000,
        currentGas: 0,
        priorityFee: '2000000000',
        baseFee: '1000000000',
        totalFee: '0',
        transactionCount: 0,
        retryCount: 0,
        maxRetries: 3,
        expiresAt: bundleParams.expiresAt,
        finalizedAt: null,
        processedAt: null,
        submittedAt: null,
        confirmedAt: null,
        blockNumber: null,
        blockTimestamp: null,
        errorMessage: null,
        sequencerId: sinon.match.string,
        parentBundleId: null,
        rawTransaction: null,
        submissionGasPrice: null,
        gasUsed: null,
        effectiveGasPrice: null,
        metadata: { custom: 'value' },
        optimizationSettings: {
          optimizeGasPrice: false,
          gasPriceBoostFactor: 1.0
        },
        performanceMetrics: {},
        transactions: []
      };
      
      repositoryStub.save.resolves(newBundle);
      
      // Execute
      const result = await sequencerService.createBundle(bundleParams);
      
      // Verify
      expect(repositoryStub.save.calledOnce).to.be.true;
      expect(result).to.deep.equal(newBundle);
      expect(sequencerService.getCurrentBundle()).to.deep.equal(newBundle);
    });
  });
  
  describe('addTransactionToBundle', () => {
    it('should add transaction to current bundle', async () => {
      // Setup
      const transactionId = uuidv4();
      const bundleId = uuidv4();
      
      const transaction = {
        id: transactionId,
        status: TransactionStatus.PENDING,
        gasLimit: 100000,
        fee: '1000000000',
        type: TransactionType.TRANSFER
      };
      
      const currentBundle = {
        id: bundleId,
        status: BundleStatus.PENDING,
        transactionCount: 0,
        maxTransactions: 100,
        currentGas: 0,
        maxGas: 10000000,
        totalFee: '0',
        transactions: []
      };
      
      const updatedBundle = {
        ...currentBundle,
        transactionCount: 1,
        currentGas: 100000,
        totalFee: '1000000000',
        transactions: [transaction]
      };
      
      // Set current bundle
      (sequencerService as any).currentBundle = currentBundle;
      
      // Stub getTransactionById to return the transaction
      transactionServiceStub.getTransactionById.resolves(transaction as Transaction);
      
      // Stub assignTransactionToBundle
      transactionServiceStub.assignTransactionToBundle.resolves(transaction as Transaction);
      
      // Stub repository save
      repositoryStub.save.resolves(updatedBundle);
      
      // Execute
      const result = await sequencerService.addTransactionToBundle(transactionId);
      
      // Verify
      expect(transactionServiceStub.getTransactionById.calledOnce).to.be.true;
      expect(transactionServiceStub.assignTransactionToBundle.calledOnce).to.be.true;
      expect(repositoryStub.save.calledOnce).to.be.true;
      expect(result).to.deep.equal(updatedBundle);
    });
    
    it('should create a new bundle if current bundle is null', async () => {
      // Setup
      const transactionId = uuidv4();
      const bundleId = uuidv4();
      
      const transaction = {
        id: transactionId,
        status: TransactionStatus.PENDING,
        gasLimit: 100000,
        fee: '1000000000',
        type: TransactionType.TRANSFER
      };
      
      const newBundle = {
        id: bundleId,
        status: BundleStatus.PENDING,
        transactionCount: 0,
        maxTransactions: 100,
        currentGas: 0,
        maxGas: 10000000,
        totalFee: '0',
        transactions: []
      };
      
      const updatedBundle = {
        ...newBundle,
        transactionCount: 1,
        currentGas: 100000,
        totalFee: '1000000000',
        transactions: [transaction]
      };
      
      // Set current bundle to null
      (sequencerService as any).currentBundle = null;
      
      // Stub createBundle to return a new bundle
      sinon.stub(sequencerService, 'createBundle').resolves(newBundle as Bundle);
      
      // Stub getTransactionById to return the transaction
      transactionServiceStub.getTransactionById.resolves(transaction as Transaction);
      
      // Stub assignTransactionToBundle
      transactionServiceStub.assignTransactionToBundle.resolves(transaction as Transaction);
      
      // Stub repository save
      repositoryStub.save.resolves(updatedBundle);
      
      // Execute
      const result = await sequencerService.addTransactionToBundle(transactionId);
      
      // Verify
      expect(sequencerService.createBundle).to.have.been.calledOnce;
      expect(transactionServiceStub.getTransactionById.calledOnce).to.be.true;
      expect(transactionServiceStub.assignTransactionToBundle.calledOnce).to.be.true;
      expect(repositoryStub.save.calledOnce).to.be.true;
      expect(result).to.deep.equal(updatedBundle);
    });
    
    it('should create a new bundle if current bundle is full', async () => {
      // Setup
      const transactionId = uuidv4();
      const oldBundleId = uuidv4();
      const newBundleId = uuidv4();
      
      const transaction = {
        id: transactionId,
        status: TransactionStatus.PENDING,
        gasLimit: 100000,
        fee: '1000000000',
        type: TransactionType.TRANSFER
      };
      
      const fullBundle = {
        id: oldBundleId,
        status: BundleStatus.PENDING,
        transactionCount: 100,
        maxTransactions: 100,
        currentGas: 9000000,
        maxGas: 10000000,
        totalFee: '10000000000',
        transactions: Array(100).fill({})
      };
      
      const newBundle = {
        id: newBundleId,
        status: BundleStatus.PENDING,
        transactionCount: 0,
        maxTransactions: 100,
        currentGas: 0,
        maxGas: 10000000,
        totalFee: '0',
        transactions: []
      };
      
      const updatedBundle = {
        ...newBundle,
        transactionCount: 1,
        currentGas: 100000,
        totalFee: '1000000000',
        transactions: [transaction]
      };
      
      // Set current bundle to full bundle
      (sequencerService as any).currentBundle = fullBundle;
      
      // Stub createBundle to return a new bundle
      sinon.stub(sequencerService, 'createBundle').resolves(newBundle as Bundle);
      
      // Stub getTransactionById to return the transaction
      transactionServiceStub.getTransactionById.resolves(transaction as Transaction);
      
      // Stub assignTransactionToBundle
      transactionServiceStub.assignTransactionToBundle.resolves(transaction as Transaction);
      
      // Stub repository save
      repositoryStub.save.resolves(updatedBundle);
      
      // Execute
      const result = await sequencerService.addTransactionToBundle(transactionId);
      
      // Verify
      expect(sequencerService.createBundle).to.have.been.calledOnce;
      expect(transactionServiceStub.getTransactionById.calledOnce).to.be.true;
      expect(transactionServiceStub.assignTransactionToBundle.calledOnce).to.be.true;
      expect(repositoryStub.save.calledOnce).to.be.true;
      expect(result).to.deep.equal(updatedBundle);
    });
    
    it('should create a new bundle if transaction would exceed bundle gas limit', async () => {
      // Setup
      const transactionId = uuidv4();
      const oldBundleId = uuidv4();
      const newBundleId = uuidv4();
      
      const transaction = {
        id: transactionId,
        status: TransactionStatus.PENDING,
        gasLimit: 2000000, // Large gas limit
        fee: '1000000000',
        type: TransactionType.TRANSFER
      };
      
      const currentBundle = {
        id: oldBundleId,
        status: BundleStatus.PENDING,
        transactionCount: 50,
        maxTransactions: 100,
        currentGas: 9000000,
        maxGas: 10000000, // Max gas is 10M
        totalFee: '5000000000',
        transactions: Array(50).fill({})
      };
      
      const newBundle = {
        id: newBundleId,
        status: BundleStatus.PENDING,
        transactionCount: 0,
        maxTransactions: 100,
        currentGas: 0,
        maxGas: 10000000,
        totalFee: '0',
        transactions: []
      };
      
      const updatedBundle = {
        ...newBundle,
        transactionCount: 1,
        currentGas: 2000000,
        totalFee: '1000000000',
        transactions: [transaction]
      };
      
      // Set current bundle
      (sequencerService as any).currentBundle = currentBundle;
      
      // Stub createBundle to return a new bundle
      sinon.stub(sequencerService, 'createBundle').resolves(newBundle as Bundle);
      
      // Stub getTransactionById to return the transaction
      transactionServiceStub.getTransactionById.resolves(transaction as Transaction);
      
      // Stub assignTransactionToBundle
      transactionServiceStub.assignTransactionToBundle.resolves(transaction as Transaction);
      
      // Stub repository save
      repositoryStub.save.resolves(updatedBundle);
      
      // Execute
      const result = await sequencerService.addTransactionToBundle(transactionId);
      
      // Verify
      expect(sequencerService.createBundle).to.have.been.calledOnce;
      expect(transactionServiceStub.getTransactionById.calledOnce).to.be.true;
      expect(transactionServiceStub.assignTransactionToBundle.calledOnce).to.be.true;
      expect(repositoryStub.save.calledOnce).to.be.true;
      expect(result).to.deep.equal(updatedBundle);
    });
    
    it('should throw error if transaction not found', async () => {
      // Setup
      const transactionId = uuidv4();
      
      // Stub getTransactionById to return null
      transactionServiceStub.getTransactionById.resolves(null);
      
      // Execute & Verify
      try {
        await sequencerService.addTransactionToBundle(transactionId);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Transaction not found');
      }
    });
    
    it('should throw error if transaction is not pending', async () => {
      // Setup
      const transactionId = uuidv4();
      
      const transaction = {
        id: transactionId,
        status: TransactionStatus.CONFIRMED, // Not pending
        gasLimit: 100000,
        fee: '1000000000'
      };
      
      // Stub getTransactionById to return the transaction
      transactionServiceStub.getTransactionById.resolves(transaction as Transaction);
      
      // Execute & Verify
      try {
        await sequencerService.addTransactionToBundle(transactionId);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Transaction is not pending');
      }
    });
  });
  
  describe('addTransactionsToBundleBatch', () => {
    it('should add multiple transactions to bundles sequentially', async () => {
      // Setup
      const transactionIds = [uuidv4(), uuidv4()];
      
      // Stub addTransactionToBundle to succeed
      sinon.stub(sequencerService, 'addTransactionToBundle').resolves({} as Bundle);
      
      // Execute
      const result = await sequencerService.addTransactionsToBundleBatch(transactionIds);
      
      // Verify
      expect(sequencerService.addTransactionToBundle).to.have.been.calledTwice;
      expect(result).to.equal(2);
    });
    
    it('should handle errors during batch addition', async () => {
      // Setup
      const transactionIds = [uuidv4(), uuidv4()];
      
      // Stub addTransactionToBundle to fail for the first transaction
      const addTransactionStub = sinon.stub(sequencerService, 'addTransactionToBundle');
      addTransactionStub.onFirstCall().rejects(new Error('Failed to add transaction'));
      addTransactionStub.onSecondCall().resolves({} as Bundle);
      
      // Execute
      const result = await sequencerService.addTransactionsToBundleBatch(transactionIds);
      
      // Verify
      expect(sequencerService.addTransactionToBundle).to.have.been.calledTwice;
      expect(result).to.equal(1); // Only one transaction was added successfully
    });
  });
  
  describe('processPendingTransactions', () => {
    it('should process pending transactions', async () => {
      // Setup
      const pendingTransactions = [
        { id: uuidv4() },
        { id: uuidv4() }
      ];
      
      // Stub getPendingTransactions to return pending transactions
      transactionServiceStub.getPendingTransactions.resolves(pendingTransactions as Transaction[]);
      
      // Stub addTransactionToBundle to succeed
      sinon.stub(sequencerService, 'addTransactionToBundle').resolves({} as Bundle);
      
      // Execute
      const result = await sequencerService.processPendingTransactions(10);
      
      // Verify
      expect(transactionServiceStub.getPendingTransactions.calledOnce).to.be.true;
      expect(sequencerService.addTransactionToBundle).to.have.been.calledTwice;
      expect(result).to.equal(2);
    });
    
    it('should return 0 if no pending transactions', async () => {
      // Setup
      // Stub getPendingTransactions to return empty array
      transactionServiceStub.getPendingTransactions.resolves([]);
      
      // Execute
      const result = await sequencerService.processPendingTransactions(10);
      
      // Verify
      expect(transactionServiceStub.getPendingTransactions.calledOnce).to.be.true;
      expect(result).to.equal(0);
    });
  });
  
  describe('finalizeBundle', () => {
    it('should finalize the current bundle', async () => {
      // Setup
      const bundleId = uuidv4();
      
      const currentBundle = {
        id: bundleId,
        status: BundleStatus.PENDING,
        transactionCount: 10,
        transactions: Array(10).fill({})
      };
      
      const finalizedBundle = {
        ...currentBundle,
        status: BundleStatus.READY,
        finalizedAt: new Date(),
        performanceMetrics: {
          finalizationTime: sinon.match.number
        }
      };
      
      // Set current bundle
      (sequencerService as any).currentBundle = currentBundle;
      
      // Stub repository save
      repositoryStub.save.resolves(finalizedBundle);
      
      // Stub createBundle
      sinon.stub(sequencerService, 'createBundle').resolves({} as Bundle);
      
      // Execute
      const result = await sequencerService.finalizeBundle();
      
      // Verify
      expect(repositoryStub.save.calledOnce).to.be.true;
      expect(sequencerService.createBundle).to.have.been.calledOnce;
      expect(result).to.deep.equal(finalizedBundle);
    });
    
    it('should throw error if no current bundle', async () => {
      // Setup
      // Set current bundle to null
      (sequencerService as any).currentBundle = null;
      
      // Execute & Verify
      try {
        await sequencerService.finalizeBundle();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('No current bundle to finalize');
      }
    });
    
    it('should throw error if current bundle has no transactions', async () => {
      // Setup
      const bundleId = uuidv4();
      
      const emptyBundle = {
        id: bundleId,
        status: BundleStatus.PENDING,
        transactionCount: 0,
        transactions: []
      };
      
      // Set current bundle to empty bundle
      (sequencerService as any).currentBundle = emptyBundle;
      
      // Execute & Verify
      try {
        await sequencerService.finalizeBundle();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Cannot finalize empty bundle');
      }
    });
  });
  
  describe('submitBundle', () => {
    it('should submit a bundle to the blockchain', async () => {
      // Setup
      const bundleId = uuidv4();
      
      const readyBundle = {
        id: bundleId,
        status: BundleStatus.READY,
        transactions: [
          { id: uuidv4(), hash: '0xhash1' },
          { id: uuidv4(), hash: '0xhash2' }
        ]
      };
      
      const processingBundle = {
        ...readyBundle,
        status: BundleStatus.PROCESSING,
        processedAt: new Date(),
        performanceMetrics: {
          processingTime: 0
        }
      };
      
      const submittingBundle = {
        ...processingBundle,
        status: BundleStatus.SUBMITTING,
        submittedAt: new Date()
      };
      
      const confirmedBundle = {
        ...submittingBundle,
        status: BundleStatus.CONFIRMED,
        hash: '0xbundlehash',
        blockNumber: 12345,
        blockTimestamp: new Date(),
        confirmedAt: new Date(),
        gasUsed: 150000,
        effectiveGasPrice: '1500000000',
        performanceMetrics: {
          processingTime: sinon.match.number,
          submissionTime: sinon.match.number,
          confirmationTime: sinon.match.number,
          totalTime: sinon.match.number
        }
      };
      
      // Stub repository findOne to return the ready bundle
      repositoryStub.findOne.resolves(readyBundle);
      
      // Stub repository save
      const saveStub = repositoryStub.save;
      saveStub.onFirstCall().resolves(processingBundle);
      saveStub.onSecondCall().resolves(submittingBundle);
      saveStub.onThirdCall().resolves(confirmedBundle);
      
      // Stub updateTransactionStatusBatch
      transactionServiceStub.updateTransactionStatusBatch.resolves(2);
      
      // Execute
      const result = await sequencerService.submitBundle(bundleId);
      
      // Verify
      expect(repositoryStub.findOne.calledOnce).to.be.true;
      expect(repositoryStub.save.calledThrice).to.be.true;
      expect(transactionServiceStub.updateTransactionStatusBatch.calledOnce).to.be.true;
      expect(result).to.deep.equal(confirmedBundle);
    });
    
    it('should throw error if bundle not found', async () => {
      // Setup
      const bundleId = uuidv4();
      
      // Stub repository findOne to return null
      repositoryStub.findOne.resolves(null);
      
      // Execute & Verify
      try {
        await sequencerService.submitBundle(bundleId);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Bundle not found');
      }
    });
    
    it('should throw error if bundle is not ready', async () => {
      // Setup
      const bundleId = uuidv4();
      
      const pendingBundle = {
        id: bundleId,
        status: BundleStatus.PENDING // Not ready
      };
      
      // Stub repository findOne to return the pending bundle
      repositoryStub.findOne.resolves(pendingBundle);
      
      // Execute & Verify
      try {
        await sequencerService.submitBundle(bundleId);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Bundle is not ready for submission');
      }
    });
    
    it('should retry bundle if submission fails and retries are available', async () => {
      // Setup
      const bundleId = uuidv4();
      
      const readyBundle = {
        id: bundleId,
        status: BundleStatus.READY,
        retryCount: 0,
        maxRetries: 3,
        transactions: [
          { id: uuidv4(), hash: '0xhash1' },
          { id: uuidv4(), hash: '0xhash2' }
        ],
        optimizationSettings: {
          gasPriceBoostFactor: 1.1
        }
      };
      
      const processingBundle = {
        ...readyBundle,
        status: BundleStatus.PROCESSING,
        processedAt: new Date()
      };
      
      const submittingBundle = {
        ...processingBundle,
        status: BundleStatus.SUBMITTING,
        submittedAt: new Date()
      };
      
      const failedBundle = {
        ...submittingBundle,
        status: BundleStatus.FAILED,
        errorMessage: 'Submission failed'
      };
      
      const retryBundle = {
        id: uuidv4(), // New ID
        status: BundleStatus.READY,
        retryCount: 1,
        maxRetries: 3,
        parentBundleId: bundleId,
        optimizationSettings: {
          gasPriceBoostFactor: 1.32 // Increased
        },
        metadata: {
          isRetry: true,
          originalBundleId: bundleId
        },
        finalizedAt: new Date()
      };
      
      // Stub repository findOne to return the ready bundle
      repositoryStub.findOne.resolves(readyBundle);
      
      // Stub repository save
      const saveStub = repositoryStub.save;
      saveStub.onFirstCall().resolves(processingBundle);
      saveStub.onSecondCall().resolves(submittingBundle);
      
      // Stub the submission to fail
      const submissionError = new Error('Submission failed');
      saveStub.onThirdCall().callsFake(() => {
        throw submissionError;
      });
      
      // After failure, save the failed bundle and retry bundle
      saveStub.onCall(3).resolves(failedBundle);
      saveStub.onCall(4).resolves(retryBundle);
      
      // Stub assignTransactionsToBundleBatch
      transactionServiceStub.assignTransactionsToBundleBatch.resolves(2);
      
      // Stub submitBundle to succeed for the retry
      const submitBundleStub = sinon.stub(sequencerService, 'submitBundle');
      submitBundleStub.onFirstCall().callThrough(); // Use the real implementation first
      submitBundleStub.onSecondCall().resolves(retryBundle as Bundle); // Return retry bundle on second call
      
      // Execute
      const result = await sequencerService.submitBundle(bundleId);
      
      // Verify
      expect(repositoryStub.findOne.calledOnce).to.be.true;
      expect(repositoryStub.save.callCount).to.be.at.least(4);
      expect(transactionServiceStub.assignTransactionsToBundleBatch.calledOnce).to.be.true;
      expect(submitBundleStub.calledTwice).to.be.true;
      expect(result).to.deep.equal(retryBundle);
    });
  });
  
  describe('getBundleById', () => {
    it('should get bundle by ID', async () => {
      // Setup
      const bundleId = uuidv4();
      const bundle = {
        id: bundleId,
        status: BundleStatus.PENDING
      };
      
      repositoryStub.findOne.resolves(bundle);
      
      // Execute
      const result = await sequencerService.getBundleById(bundleId);
      
      // Verify
      expect(repositoryStub.findOne.calledOnce).to.be.true;
      expect(result).to.deep.equal(bundle);
    });
    
    it('should return null if bundle not found', async () => {
      // Setup
      const bundleId = uuidv4();
      repositoryStub.findOne.resolves(null);
      
      // Execute
      const result = await sequencerService.getBundleById(bundleId);
      
      // Verify
      expect(repositoryStub.findOne.calledOnce).to.be.true;
      expect(result).to.be.null;
    });
  });
  
  describe('getBundleByHash', () => {
    it('should get bundle by hash', async () => {
      // Setup
      const bundleHash = '0xbundlehash';
      const bundle = {
        id: uuidv4(),
        hash: bundleHash,
        status: BundleStatus.CONFIRMED
      };
      
      repositoryStub.findOne.resolves(bundle);
      
      // Execute
      const result = await sequencerService.getBundleByHash(bundleHash);
      
      // Verify
      expect(repositoryStub.findOne.calledOnce).to.be.true;
      expect(result).to.deep.equal(bundle);
    });
  });
  
  describe('getBundles', () => {
    it('should get bundles by query parameters', async () => {
      // Setup
      const queryParams: BundleQueryParams = {
        status: BundleStatus.PENDING,
        limit: 10,
        offset: 0
      };
      
      const bundles = [
        {
          id: uuidv4(),
          status: BundleStatus.PENDING
        },
        {
          id: uuidv4(),
          status: BundleStatus.PENDING
        }
      ];
      
      const queryBuilderStub = repositoryStub.createQueryBuilder();
      queryBuilderStub.getMany.resolves(bundles);
      
      // Execute
      const result = await sequencerService.getBundles(queryParams);
      
      // Verify
      expect(queryBuilderStub.getMany.calledOnce).to.be.true;
      expect(result).to.deep.equal(bundles);
    });
  });
  
  describe('getReadyBundles', () => {
    it('should get ready bundles', async () => {
      // Setup
      const readyBundles = [
        {
          id: uuidv4(),
          status: BundleStatus.READY
        },
        {
          id: uuidv4(),
          status: BundleStatus.READY
        }
      ];
      
      const queryBuilderStub = repositoryStub.createQueryBuilder();
      queryBuilderStub.getMany.resolves(readyBundles);
      
      // Execute
      const result = await sequencerService.getReadyBundles(10);
      
      // Verify
      expect(queryBuilderStub.getMany.calledOnce).to.be.true;
      expect(result).to.deep.equal(readyBundles);
    });
  });
  
  describe('getExpiredBundles', () => {
    it('should get expired bundles', async () => {
      // Setup
      const expiredBundles = [
        {
          id: uuidv4(),
          status: BundleStatus.PENDING,
          expiresAt: new Date(Date.now() - 3600000) // 1 hour ago
        }
      ];
      
      const queryBuilderStub = repositoryStub.createQueryBuilder();
      queryBuilderStub.getMany.resolves(expiredBundles);
      
      // Execute
      const result = await sequencerService.getExpiredBundles(10);
      
      // Verify
      expect(queryBuilderStub.getMany.calledOnce).to.be.true;
      expect(result).to.deep.equal(expiredBundles);
    });
  });
  
  describe('markExpiredBundles', () => {
    it('should mark expired bundles', async () => {
      // Setup
      const queryBuilderStub = repositoryStub.createQueryBuilder();
      queryBuilderStub.execute.resolves({ affected: 3 });
      
      // Execute
      const result = await sequencerService.markExpiredBundles();
      
      // Verify
      expect(queryBuilderStub.execute.calledOnce).to.be.true;
      expect(result).to.equal(3);
    });
  });
  
  describe('abortBundle', () => {
    it('should abort a bundle', async () => {
      // Setup
      const bundleId = uuidv4();
      
      const pendingBundle = {
        id: bundleId,
        status: BundleStatus.PENDING,
        transactions: [
          { id: uuidv4() },
          { id: uuidv4() }
        ]
      };
      
      const abortedBundle = {
        ...pendingBundle,
        status: BundleStatus.ABORTED,
        errorMessage: 'Bundle aborted manually'
      };
      
      // Stub repository findOne to return the pending bundle
      repositoryStub.findOne.resolves(pendingBundle);
      
      // Stub repository save
      repositoryStub.save.resolves(abortedBundle);
      
      // Stub updateTransactionStatusBatch
      transactionServiceStub.updateTransactionStatusBatch.resolves(2);
      
      // Execute
      const result = await sequencerService.abortBundle(bundleId);
      
      // Verify
      expect(repositoryStub.findOne.calledOnce).to.be.true;
      expect(repositoryStub.save.calledOnce).to.be.true;
      expect(transactionServiceStub.updateTransactionStatusBatch.calledOnce).to.be.true;
      expect(result).to.deep.equal(abortedBundle);
    });
    
    it('should throw error if bundle not found', async () => {
      // Setup
      const bundleId = uuidv4();
      
      // Stub repository findOne to return null
      repositoryStub.findOne.resolves(null);
      
      // Execute & Verify
      try {
        await sequencerService.abortBundle(bundleId);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Bundle not found');
      }
    });
    
    it('should throw error if bundle cannot be aborted', async () => {
      // Setup
      const bundleId = uuidv4();
      
      const confirmedBundle = {
        id: bundleId,
        status: BundleStatus.CONFIRMED // Cannot be aborted
      };
      
      // Stub repository findOne to return the confirmed bundle
      repositoryStub.findOne.resolves(confirmedBundle);
      
      // Execute & Verify
      try {
        await sequencerService.abortBundle(bundleId);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Bundle cannot be aborted');
      }
    });
    
    it('should create a new bundle if current bundle is aborted', async () => {
      // Setup
      const bundleId = uuidv4();
      
      const currentBundle = {
        id: bundleId,
        status: BundleStatus.PENDING,
        transactions: []
      };
      
      const abortedBundle = {
        ...currentBundle,
        status: BundleStatus.ABORTED,
        errorMessage: 'Bundle aborted manually'
      };
      
      // Set current bundle
      (sequencerService as any).currentBundle = currentBundle;
      
      // Stub repository findOne to return the current bundle
      repositoryStub.findOne.resolves(currentBundle);
      
      // Stub repository save
      repositoryStub.save.resolves(abortedBundle);
      
      // Stub createBundle
      sinon.stub(sequencerService, 'createBundle').resolves({} as Bundle);
      
      // Execute
      const result = await sequencerService.abortBundle(bundleId);
      
      // Verify
      expect(repositoryStub.findOne.calledOnce).to.be.true;
      expect(repositoryStub.save.calledOnce).to.be.true;
      expect(sequencerService.createBundle).to.have.been.calledOnce;
      expect(result).to.deep.equal(abortedBundle);
    });
  });
  
  describe('getBundleStatistics', () => {
    it('should get bundle statistics', async () => {
      // Setup
      repositoryStub.count.resolves(100);
      
      const queryBuilderStub = repositoryStub.createQueryBuilder();
      queryBuilderStub.getRawOne.resolves({ avgTime: '10.5', avgTransactions: '5.2', avgGas: '500000', totalFees: '10000000000' });
      
      // Execute
      const result = await sequencerService.getBundleStatistics(true);
      
      // Verify
      expect(result).to.exist;
      expect(result).to.have.property('totalCount', 100);
      expect(result).to.have.property('averageConfirmationTime', 10.5);
      expect(result).to.have.property('averageTransactionsPerBundle', 5.2);
      expect(result).to.have.property('averageGasPerBundle', 500000);
      expect(result).to.have.property('totalFeesCollected', '10000000000');
    });
    
    it('should use cached statistics if available and not forced to refresh', async () => {
      // Setup
      repositoryStub.count.resolves(100);
      
      const queryBuilderStub = repositoryStub.createQueryBuilder();
      queryBuilderStub.getRawOne.resolves({ avgTime: '10.5', avgTransactions: '5.2', avgGas: '500000', totalFees: '10000000000' });
      
      // Execute first call to populate cache
      await sequencerService.getBundleStatistics(true);
      
      // Reset stubs to verify they're not called again
      repositoryStub.count.resetHistory();
      queryBuilderStub.getRawOne.resetHistory();
      
      // Execute second call with cache
      const result = await sequencerService.getBundleStatistics(false);
      
      // Verify
      expect(repositoryStub.count.called).to.be.false;
      expect(result).to.exist;
    });
  });
  
  describe('cleanupOldBundles', () => {
    it('should clean up old bundles', async () => {
      // Setup
      const queryBuilderStub = repositoryStub.createQueryBuilder();
      queryBuilderStub.execute.resolves({ affected: 10 });
      
      // Execute
      const result = await sequencerService.cleanupOldBundles(30);
      
      // Verify
      expect(queryBuilderStub.execute.calledOnce).to.be.true;
      expect(result).to.equal(10);
    });
  });
});
