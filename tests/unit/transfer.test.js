/**
 * Test unitari per il modulo di trasferimento del Layer-2 su Solana
 * 
 * Questo file contiene i test unitari per verificare il corretto funzionamento
 * del modulo di trasferimento del Layer-2.
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { TransactionManager, TransactionType, TransactionStatus } = require('../../offchain/transaction_manager');
const { ErrorManager } = require('../../offchain/error_manager');
const { GasOptimizer } = require('../../offchain/gas_optimizer');
const { RecoverySystem } = require('../../offchain/recovery_system');

describe('Transfer Module Tests', () => {
  let transactionManager;
  let connection;
  let programId;
  let sequencerKeypair;
  let errorManager;
  let gasOptimizer;
  let recoverySystem;
  
  beforeEach(() => {
    // Mock della connessione Solana
    connection = {
      getVersion: sinon.stub().resolves({ 'solana-core': '1.9.0' }),
      getBalance: sinon.stub().resolves(10000000000), // 10 SOL
      getRecentBlockhash: sinon.stub().resolves({
        blockhash: 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k',
        feeCalculator: {
          lamportsPerSignature: 5000,
        },
      }),
      sendRawTransaction: sinon.stub().resolves('transaction-signature'),
      confirmTransaction: sinon.stub().resolves({ value: { err: null } }),
    };
    
    // Crea un programId
    programId = new PublicKey('Layer2ProgramId11111111111111111111111111111111');
    
    // Crea un keypair per il sequencer
    sequencerKeypair = Keypair.generate();
    
    // Mock del gestore degli errori
    errorManager = new ErrorManager({
      maxRetries: 3,
      initialBackoff: 100,
      maxBackoff: 1000,
      backoffFactor: 2,
      jitterFactor: 0.1,
    });
    
    // Mock dell'ottimizzatore del gas
    gasOptimizer = new GasOptimizer({
      connection,
      priorityFeeMultiplier: 1.5,
      baseFeeMultiplier: 1.2,
      maxPriorityFee: 100000,
    });
    
    // Mock del sistema di recupero
    recoverySystem = new RecoverySystem({
      connection,
      programId,
      sequencerKeypair,
      databaseUrl: 'mongodb://localhost:27017/layer2',
      checkpointDir: './checkpoints',
      checkpointInterval: 100,
      maxCheckpoints: 10,
    });
    
    // Spy su alcuni metodi
    sinon.spy(errorManager, 'handleError');
    sinon.spy(gasOptimizer, 'optimizeFees');
    sinon.stub(recoverySystem, 'saveState').resolves(true);
    sinon.stub(recoverySystem, 'loadState').resolves({
      pendingTransactions: [],
      priorityTransactions: [],
      nonceByAccount: new Map(),
      processedTransactionCount: 0,
      batchCount: 0,
      lastBatchTimestamp: 0,
    });
    
    // Inizializza il gestore delle transazioni
    transactionManager = new TransactionManager({
      connection,
      programId,
      sequencerKeypair,
      maxBatchSize: 100,
      maxTransactionAge: 3600,
      batchInterval: 1000,
      rpcEndpoint: 'https://api.devnet.solana.com',
      databaseUrl: 'mongodb://localhost:27017/layer2',
    });
    
    // Sostituisce i componenti con i mock
    transactionManager.errorManager = errorManager;
    transactionManager.gasOptimizer = gasOptimizer;
    transactionManager.recoverySystem = recoverySystem;
    
    // Spy su alcuni metodi
    sinon.spy(transactionManager, 'addTransaction');
    sinon.spy(transactionManager, 'addPriorityTransaction');
    sinon.spy(transactionManager, 'validateTransaction');
    sinon.spy(transactionManager, 'hashTransaction');
    sinon.spy(transactionManager, 'generateTransactionId');
    
    // Stub del metodo processTransactions
    sinon.stub(transactionManager, 'processTransactions').resolves({
      batchId: 'batch-id',
      signature: 'transaction-signature',
      confirmation: { value: { err: null } },
      transactionCount: 1,
    });
  });
  
  afterEach(() => {
    // Ripristina i mock
    sinon.restore();
  });
  
  describe('addTransaction', () => {
    it('should add a transaction to the pending queue', async () => {
      // Crea una transazione
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
      };
      
      // Aggiunge la transazione
      const transactionId = await transactionManager.addTransaction(transaction);
      
      // Verifica che la transazione sia stata aggiunta
      expect(transactionId).to.be.a('string');
      expect(transactionManager.pendingTransactions.length).to.equal(1);
      expect(transactionManager.pendingTransactions[0].sender).to.equal(transaction.sender);
      expect(transactionManager.pendingTransactions[0].recipient).to.equal(transaction.recipient);
      expect(transactionManager.pendingTransactions[0].amount).to.equal(transaction.amount);
      expect(transactionManager.pendingTransactions[0].transaction_type).to.equal(transaction.transaction_type);
      expect(transactionManager.pendingTransactions[0].status).to.equal(TransactionStatus.PENDING);
      
      // Verifica che la transazione sia stata validata
      expect(transactionManager.validateTransaction.calledOnce).to.be.true;
      
      // Verifica che la transazione sia stata aggiunta alla mappa per ID
      expect(transactionManager.transactionsById.has(transactionId)).to.be.true;
      
      // Verifica che le metriche siano state aggiornate
      expect(transactionManager.metrics.transactionsReceived).to.equal(1);
    });
    
    it('should reject a transaction with invalid sender', async () => {
      // Crea una transazione con mittente non valido
      const transaction = {
        sender: 'invalid-sender',
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
      };
      
      // Verifica che venga lanciato un errore
      await expect(transactionManager.addTransaction(transaction)).to.be.rejectedWith('Indirizzo non valido');
      
      // Verifica che la transazione non sia stata aggiunta
      expect(transactionManager.pendingTransactions.length).to.equal(0);
      
      // Verifica che le metriche siano state aggiornate
      expect(transactionManager.metrics.transactionsRejected).to.equal(1);
    });
    
    it('should reject a transaction with invalid recipient', async () => {
      // Crea una transazione con destinatario non valido
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: 'invalid-recipient',
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
      };
      
      // Verifica che venga lanciato un errore
      await expect(transactionManager.addTransaction(transaction)).to.be.rejectedWith('Indirizzo non valido');
      
      // Verifica che la transazione non sia stata aggiunta
      expect(transactionManager.pendingTransactions.length).to.equal(0);
      
      // Verifica che le metriche siano state aggiornate
      expect(transactionManager.metrics.transactionsRejected).to.equal(1);
    });
    
    it('should reject a transaction with invalid amount', async () => {
      // Crea una transazione con importo non valido
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 0,
        transaction_type: TransactionType.TRANSFER,
      };
      
      // Verifica che venga lanciato un errore
      await expect(transactionManager.addTransaction(transaction)).to.be.rejectedWith('L\'importo deve essere positivo');
      
      // Verifica che la transazione non sia stata aggiunta
      expect(transactionManager.pendingTransactions.length).to.equal(0);
      
      // Verifica che le metriche siano state aggiornate
      expect(transactionManager.metrics.transactionsRejected).to.equal(1);
    });
    
    it('should reject a transaction with invalid type', async () => {
      // Crea una transazione con tipo non valido
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: 10, // Tipo non valido
      };
      
      // Verifica che venga lanciato un errore
      await expect(transactionManager.addTransaction(transaction)).to.be.rejectedWith('Tipo di transazione non valido');
      
      // Verifica che la transazione non sia stata aggiunta
      expect(transactionManager.pendingTransactions.length).to.equal(0);
      
      // Verifica che le metriche siano state aggiornate
      expect(transactionManager.metrics.transactionsRejected).to.equal(1);
    });
  });
  
  describe('addPriorityTransaction', () => {
    it('should add a transaction to the priority queue', async () => {
      // Crea una transazione
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
      };
      
      // Aggiunge la transazione con priorità
      const transactionId = await transactionManager.addPriorityTransaction(transaction, 8);
      
      // Verifica che la transazione sia stata aggiunta
      expect(transactionId).to.be.a('string');
      expect(transactionManager.priorityTransactions.length).to.equal(1);
      expect(transactionManager.priorityTransactions[0].transaction.sender).to.equal(transaction.sender);
      expect(transactionManager.priorityTransactions[0].transaction.recipient).to.equal(transaction.recipient);
      expect(transactionManager.priorityTransactions[0].transaction.amount).to.equal(transaction.amount);
      expect(transactionManager.priorityTransactions[0].transaction.transaction_type).to.equal(transaction.transaction_type);
      expect(transactionManager.priorityTransactions[0].transaction.status).to.equal(TransactionStatus.PENDING);
      expect(transactionManager.priorityTransactions[0].priority).to.equal(8);
      
      // Verifica che la transazione sia stata validata
      expect(transactionManager.validateTransaction.calledOnce).to.be.true;
      
      // Verifica che la transazione sia stata aggiunta alla mappa per ID
      expect(transactionManager.transactionsById.has(transactionId)).to.be.true;
      
      // Verifica che le metriche siano state aggiornate
      expect(transactionManager.metrics.transactionsReceived).to.equal(1);
    });
    
    it('should reject a transaction with invalid priority', async () => {
      // Crea una transazione
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
      };
      
      // Verifica che venga lanciato un errore con priorità non valida
      await expect(transactionManager.addPriorityTransaction(transaction, 11)).to.be.rejectedWith('La priorità deve essere compresa tra 1 e 10');
      
      // Verifica che la transazione non sia stata aggiunta
      expect(transactionManager.priorityTransactions.length).to.equal(0);
      
      // Verifica che le metriche siano state aggiornate
      expect(transactionManager.metrics.transactionsRejected).to.equal(1);
    });
    
    it('should sort transactions by priority', async () => {
      // Crea tre transazioni
      const transaction1 = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
      };
      
      const transaction2 = {
        sender: new PublicKey(Buffer.alloc(32, 3)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 4)).toString(),
        amount: 2000000,
        transaction_type: TransactionType.TRANSFER,
      };
      
      const transaction3 = {
        sender: new PublicKey(Buffer.alloc(32, 5)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 6)).toString(),
        amount: 3000000,
        transaction_type: TransactionType.TRANSFER,
      };
      
      // Aggiunge le transazioni con priorità diverse
      await transactionManager.addPriorityTransaction(transaction1, 3);
      await transactionManager.addPriorityTransaction(transaction2, 7);
      await transactionManager.addPriorityTransaction(transaction3, 5);
      
      // Verifica che le transazioni siano state ordinate per priorità (decrescente)
      expect(transactionManager.priorityTransactions.length).to.equal(3);
      expect(transactionManager.priorityTransactions[0].priority).to.equal(7);
      expect(transactionManager.priorityTransactions[1].priority).to.equal(5);
      expect(transactionManager.priorityTransactions[2].priority).to.equal(3);
    });
  });
  
  describe('processTransactions', () => {
    it('should process pending transactions', async () => {
      // Imposta il flag di esecuzione
      transactionManager.isRunning = true;
      
      // Crea e aggiunge alcune transazioni
      const transaction1 = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
      };
      
      const transaction2 = {
        sender: new PublicKey(Buffer.alloc(32, 3)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 4)).toString(),
        amount: 2000000,
        transaction_type: TransactionType.TRANSFER,
      };
      
      await transactionManager.addTransaction(transaction1);
      await transactionManager.addTransaction(transaction2);
      
      // Ripristina lo stub di processTransactions
      transactionManager.processTransactions.restore();
      
      // Stub del metodo createBatch
      sinon.stub(transactionManager, 'createBatch').resolves({
        id: 'batch-id',
        transactions: transactionManager.pendingTransactions,
        merkle_root: Buffer.alloc(32),
        sequencer: sequencerKeypair.publicKey.toBuffer(),
        timestamp: Math.floor(Date.now() / 1000),
        expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
        signature: Buffer.alloc(64),
      });
      
      // Stub del metodo submitBatch
      sinon.stub(transactionManager, 'submitBatch').resolves({
        batchId: 'batch-id',
        signature: 'transaction-signature',
        confirmation: { value: { err: null } },
        transactionCount: 2,
      });
      
      // Processa le transazioni
      const result = await transactionManager.processTransactions();
      
      // Verifica che il batch sia stato creato
      expect(transactionManager.createBatch.calledOnce).to.be.true;
      
      // Verifica che il batch sia stato inviato
      expect(transactionManager.submitBatch.calledOnce).to.be.true;
      
      // Verifica il risultato
      expect(result).to.deep.include({
        batchId: 'batch-id',
        signature: 'transaction-signature',
        transactionCount: 2,
      });
      
      // Verifica che le metriche siano state aggiornate
      expect(transactionManager.metrics.batchesSent).to.equal(1);
      expect(transactionManager.metrics.transactionsProcessed).to.equal(2);
      
      // Verifica che il contatore dei batch sia stato incrementato
      expect(transactionManager.batchCount).to.equal(1);
      
      // Verifica che il timestamp dell'ultimo batch sia stato aggiornato
      expect(transactionManager.lastBatchTimestamp).to.be.a('number');
      
      // Verifica che lo stato sia stato salvato
      expect(recoverySystem.saveState.calledOnce).to.be.true;
    });
    
    it('should not process transactions if not running', async () => {
      // Imposta il flag di esecuzione a false
      transactionManager.isRunning = false;
      
      // Crea e aggiunge una transazione
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
      };
      
      await transactionManager.addTransaction(transaction);
      
      // Ripristina lo stub di processTransactions
      transactionManager.processTransactions.restore();
      
      // Processa le transazioni
      const result = await transactionManager.processTransactions();
      
      // Verifica che non sia stato fatto nulla
      expect(result).to.be.undefined;
    });
    
    it('should not process transactions if queue is empty', async () => {
      // Imposta il flag di esecuzione
      transactionManager.isRunning = true;
      
      // Ripristina lo stub di processTransactions
      transactionManager.processTransactions.restore();
      
      // Processa le transazioni
      const result = await transactionManager.processTransactions();
      
      // Verifica che non sia stato fatto nulla
      expect(result).to.be.undefined;
    });
    
    it('should handle errors during processing', async () => {
      // Imposta il flag di esecuzione
      transactionManager.isRunning = true;
      
      // Crea e aggiunge una transazione
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
      };
      
      await transactionManager.addTransaction(transaction);
      
      // Ripristina lo stub di processTransactions
      transactionManager.processTransactions.restore();
      
      // Stub del metodo createBatch per lanciare un errore
      sinon.stub(transactionManager, 'createBatch').throws(new Error('Test error'));
      
      // Processa le transazioni
      try {
        await transactionManager.processTransactions();
        // Se non viene lanciato un errore, il test fallisce
        expect.fail('Should have thrown an error');
      } catch (error) {
        // Verifica che l'errore sia stato gestito
        expect(error.message).to.equal('Test error');
        expect(errorManager.handleError.calledOnce).to.be.true;
      }
    });
  });
  
  describe('createBatch', () => {
    it('should create a batch from pending transactions', async () => {
      // Crea e aggiunge alcune transazioni
      const transaction1 = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
        expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
      };
      
      const transaction2 = {
        sender: new PublicKey(Buffer.alloc(32, 3)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 4)).toString(),
        amount: 2000000,
        transaction_type: TransactionType.TRANSFER,
        expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
      };
      
      await transactionManager.addTransaction(transaction1);
      await transactionManager.addTransaction(transaction2);
      
      // Crea un batch
      const batch = await transactionManager.createBatch();
      
      // Verifica che il batch sia stato creato correttamente
      expect(batch.id).to.be.a('string');
      expect(batch.transactions.length).to.equal(2);
      expect(batch.merkle_root).to.be.an.instanceOf(Buffer);
      expect(batch.sequencer).to.deep.equal(sequencerKeypair.publicKey.toBuffer());
      expect(batch.timestamp).to.be.a('number');
      expect(batch.expiry_timestamp).to.be.a('number');
      expect(batch.signature).to.be.an.instanceOf(Buffer);
      
      // Verifica che le transazioni siano state rimosse dalle code
      expect(transactionManager.pendingTransactions.length).to.equal(0);
    });
    
    it('should create a batch from priority transactions', async () => {
      // Crea e aggiunge alcune transazioni con priorità
      const transaction1 = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
        expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
      };
      
      const transaction2 = {
        sender: new PublicKey(Buffer.alloc(32, 3)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 4)).toString(),
        amount: 2000000,
        transaction_type: TransactionType.TRANSFER,
        expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
      };
      
      await transactionManager.addPriorityTransaction(transaction1, 5);
      await transactionManager.addPriorityTransaction(transaction2, 8);
      
      // Crea un batch
      const batch = await transactionManager.createBatch();
      
      // Verifica che il batch sia stato creato correttamente
      expect(batch.id).to.be.a('string');
      expect(batch.transactions.length).to.equal(2);
      expect(batch.merkle_root).to.be.an.instanceOf(Buffer);
      expect(batch.sequencer).to.deep.equal(sequencerKeypair.publicKey.toBuffer());
      expect(batch.timestamp).to.be.a('number');
      expect(batch.expiry_timestamp).to.be.a('number');
      expect(batch.signature).to.be.an.instanceOf(Buffer);
      
      // Verifica che le transazioni siano state rimosse dalle code
      expect(transactionManager.priorityTransactions.length).to.equal(0);
    });
    
    it('should filter out expired transactions', async () => {
      // Crea e aggiunge alcune transazioni, una scaduta e una valida
      const expiredTransaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
        expiry_timestamp: Math.floor(Date.now() / 1000) - 3600, // Scaduta
      };
      
      const validTransaction = {
        sender: new PublicKey(Buffer.alloc(32, 3)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 4)).toString(),
        amount: 2000000,
        transaction_type: TransactionType.TRANSFER,
        expiry_timestamp: Math.floor(Date.now() / 1000) + 3600, // Valida
      };
      
      await transactionManager.addTransaction(expiredTransaction);
      await transactionManager.addTransaction(validTransaction);
      
      // Crea un batch
      const batch = await transactionManager.createBatch();
      
      // Verifica che il batch contenga solo la transazione valida
      expect(batch.transactions.length).to.equal(1);
      expect(batch.transactions[0].amount).to.equal(validTransaction.amount);
      
      // Verifica che entrambe le transazioni siano state rimosse dalle code
      expect(transactionManager.pendingTransactions.length).to.equal(0);
    });
    
    it('should limit batch size', async () => {
      // Imposta la dimensione massima del batch
      transactionManager.maxBatchSize = 2;
      
      // Crea e aggiunge più transazioni del limite
      for (let i = 0; i < 5; i++) {
        const transaction = {
          sender: new PublicKey(Buffer.alloc(32, i + 1)).toString(),
          recipient: new PublicKey(Buffer.alloc(32, i + 10)).toString(),
          amount: 1000000 * (i + 1),
          transaction_type: TransactionType.TRANSFER,
          expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
        };
        
        await transactionManager.addTransaction(transaction);
      }
      
      // Crea un batch
      const batch = await transactionManager.createBatch();
      
      // Verifica che il batch contenga solo il numero massimo di transazioni
      expect(batch.transactions.length).to.equal(2);
      
      // Verifica che le transazioni rimanenti siano ancora nella coda
      expect(transactionManager.pendingTransactions.length).to.equal(3);
    });
  });
  
  describe('submitBatch', () => {
    it('should submit a batch to the blockchain', async () => {
      // Crea un batch
      const batch = {
        id: Buffer.alloc(32),
        transactions: [
          {
            id: Buffer.alloc(32, 1),
            sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
            recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
            amount: 1000000,
            transaction_type: TransactionType.TRANSFER,
            status: TransactionStatus.PENDING,
          },
        ],
        merkle_root: Buffer.alloc(32),
        sequencer: sequencerKeypair.publicKey.toBuffer(),
        timestamp: Math.floor(Date.now() / 1000),
        expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
        signature: Buffer.alloc(64),
      };
      
      // Stub del metodo serializeBatch
      sinon.stub(transactionManager, 'serializeBatch').returns(Buffer.alloc(100));
      
      // Stub del metodo createSubmitBatchInstruction
      sinon.stub(transactionManager, 'createSubmitBatchInstruction').returns({
        keys: [
          { pubkey: sequencerKeypair.publicKey, isSigner: true, isWritable: true },
        ],
        programId,
        data: Buffer.from([]),
      });
      
      // Invia il batch
      const result = await transactionManager.submitBatch(batch);
      
      // Verifica che il batch sia stato serializzato
      expect(transactionManager.serializeBatch.calledOnce).to.be.true;
      
      // Verifica che l'istruzione sia stata creata
      expect(transactionManager.createSubmitBatchInstruction.calledOnce).to.be.true;
      
      // Verifica che la transazione sia stata inviata
      expect(connection.sendRawTransaction.calledOnce).to.be.true;
      
      // Verifica che la conferma sia stata attesa
      expect(connection.confirmTransaction.calledOnce).to.be.true;
      
      // Verifica il risultato
      expect(result).to.deep.include({
        batchId: batch.id.toString(),
        signature: 'transaction-signature',
        transactionCount: 1,
      });
      
      // Verifica che lo stato delle transazioni sia stato aggiornato
      expect(batch.transactions[0].status).to.equal(TransactionStatus.CONFIRMED);
    });
    
    it('should handle errors during submission', async () => {
      // Crea un batch
      const batch = {
        id: Buffer.alloc(32),
        transactions: [
          {
            id: Buffer.alloc(32, 1),
            sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
            recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
            amount: 1000000,
            transaction_type: TransactionType.TRANSFER,
            status: TransactionStatus.PENDING,
          },
        ],
        merkle_root: Buffer.alloc(32),
        sequencer: sequencerKeypair.publicKey.toBuffer(),
        timestamp: Math.floor(Date.now() / 1000),
        expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
        signature: Buffer.alloc(64),
      };
      
      // Stub del metodo serializeBatch
      sinon.stub(transactionManager, 'serializeBatch').returns(Buffer.alloc(100));
      
      // Stub del metodo createSubmitBatchInstruction
      sinon.stub(transactionManager, 'createSubmitBatchInstruction').returns({
        keys: [
          { pubkey: sequencerKeypair.publicKey, isSigner: true, isWritable: true },
        ],
        programId,
        data: Buffer.from([]),
      });
      
      // Modifica il mock di sendRawTransaction per lanciare un errore
      connection.sendRawTransaction.throws(new Error('Transaction failed'));
      
      // Invia il batch
      try {
        await transactionManager.submitBatch(batch);
        // Se non viene lanciato un errore, il test fallisce
        expect.fail('Should have thrown an error');
      } catch (error) {
        // Verifica che l'errore sia stato gestito
        expect(error.message).to.equal('Transaction failed');
        expect(errorManager.handleError.calledOnce).to.be.true;
      }
    });
  });
});
