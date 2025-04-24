/**
 * Test di sicurezza per il Layer-2 su Solana
 * 
 * Questo file contiene i test di sicurezza per verificare la robustezza
 * del sistema Layer-2 contro varie vulnerabilità.
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { ethers } = require('ethers');
const { Layer2Client, TransactionType, TransactionStatus } = require('../../sdk/src/client');
const { TransactionManager } = require('../../offchain/transaction_manager');
const { ErrorManager } = require('../../offchain/error_manager');
const { GasOptimizer } = require('../../offchain/gas_optimizer');
const { RecoverySystem } = require('../../offchain/recovery_system');
const crypto = require('crypto');
const axios = require('axios');

describe('Security Tests', () => {
  let client;
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
    
    // Configurazione del client
    client = new Layer2Client({
      solanaRpcUrl: 'https://api.devnet.solana.com',
      programId: 'Layer2ProgramId11111111111111111111111111111111',
      ethereumRpcUrl: 'https://rinkeby.infura.io/v3/your-api-key',
      tokenBridgeAddress: '0x1234567890123456789012345678901234567890',
      withdrawalBridgeAddress: '0x0987654321098765432109876543210987654321',
      layer2ApiUrl: 'https://api.layer2.example.com',
    });
    
    // Mock del wallet Solana
    const solanaWallet = Keypair.generate();
    
    // Assegna il wallet al client
    client.solanaWallet = solanaWallet;
    
    // Mock di axios
    axios.get = sinon.stub();
    axios.post = sinon.stub();
    
    // Configura il mock di axios.get per getAccount
    axios.get.withArgs(`https://api.layer2.example.com/accounts/${solanaWallet.publicKey.toString()}`).resolves({
      data: {
        account: {
          address: solanaWallet.publicKey.toString(),
          balance: '1000000000',
          nonce: 5,
          lastUpdated: 1619712000,
        },
      },
    });
    
    // Configura il mock di axios.post per transfer
    axios.post.withArgs('https://api.layer2.example.com/transactions').resolves({
      data: {
        transactionId: '0x1234567890123456789012345678901234567890123456789012345678901234',
      },
    });
    
    // Mock della funzione di firma
    client.signTransaction = sinon.stub().resolves(Buffer.from('signature'));
  });
  
  afterEach(() => {
    // Ripristina i mock
    sinon.restore();
  });
  
  describe('Input Validation', () => {
    it('should reject transactions with invalid sender', async () => {
      // Crea una transazione con mittente non valido
      const transaction = {
        sender: 'invalid-sender',
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
      };
      
      // Verifica che venga lanciato un errore
      await expect(transactionManager.addTransaction(transaction)).to.be.rejectedWith('Indirizzo non valido');
    });
    
    it('should reject transactions with invalid recipient', async () => {
      // Crea una transazione con destinatario non valido
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: 'invalid-recipient',
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
      };
      
      // Verifica che venga lanciato un errore
      await expect(transactionManager.addTransaction(transaction)).to.be.rejectedWith('Indirizzo non valido');
    });
    
    it('should reject transactions with negative amount', async () => {
      // Crea una transazione con importo negativo
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: -1000000,
        transaction_type: TransactionType.TRANSFER,
      };
      
      // Verifica che venga lanciato un errore
      await expect(transactionManager.addTransaction(transaction)).to.be.rejectedWith('L\'importo deve essere positivo');
    });
    
    it('should reject transactions with zero amount', async () => {
      // Crea una transazione con importo zero
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 0,
        transaction_type: TransactionType.TRANSFER,
      };
      
      // Verifica che venga lanciato un errore
      await expect(transactionManager.addTransaction(transaction)).to.be.rejectedWith('L\'importo deve essere positivo');
    });
    
    it('should reject transactions with invalid type', async () => {
      // Crea una transazione con tipo non valido
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: 10, // Tipo non valido
      };
      
      // Verifica che venga lanciato un errore
      await expect(transactionManager.addTransaction(transaction)).to.be.rejectedWith('Tipo di transazione non valido');
    });
    
    it('should reject transactions with excessive data', async () => {
      // Crea una transazione con dati eccessivi
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
        data: Buffer.alloc(10000), // Dati eccessivi
      };
      
      // Verifica che venga lanciato un errore
      await expect(transactionManager.addTransaction(transaction)).to.be.rejectedWith('Dati troppo grandi');
    });
  });
  
  describe('Signature Verification', () => {
    it('should verify valid signatures', async () => {
      // Crea un keypair
      const keypair = Keypair.generate();
      
      // Crea un messaggio
      const message = Buffer.from('test message');
      
      // Firma il messaggio
      const signature = keypair.sign(message);
      
      // Verifica la firma
      const isValid = keypair.publicKey.verify(message, signature);
      
      // Verifica che la firma sia valida
      expect(isValid).to.be.true;
    });
    
    it('should reject invalid signatures', async () => {
      // Crea due keypair
      const keypair1 = Keypair.generate();
      const keypair2 = Keypair.generate();
      
      // Crea un messaggio
      const message = Buffer.from('test message');
      
      // Firma il messaggio con il primo keypair
      const signature = keypair1.sign(message);
      
      // Verifica la firma con il secondo keypair
      const isValid = keypair2.publicKey.verify(message, signature);
      
      // Verifica che la firma non sia valida
      expect(isValid).to.be.false;
    });
    
    it('should reject transactions with invalid signatures', async () => {
      // Crea una transazione
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
      };
      
      // Serializza la transazione
      const serializedTx = Buffer.from(JSON.stringify(transaction));
      
      // Crea una firma non valida
      const invalidSignature = Buffer.alloc(64);
      
      // Verifica la firma
      const isValid = await client.verifySignature(
        serializedTx,
        invalidSignature,
        transaction.sender
      );
      
      // Verifica che la firma non sia valida
      expect(isValid).to.be.false;
    });
  });
  
  describe('Replay Attack Prevention', () => {
    it('should reject transactions with duplicate nonce', async () => {
      // Crea una transazione
      const transaction1 = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
        nonce: 5,
      };
      
      // Crea una transazione con lo stesso nonce
      const transaction2 = {
        sender: transaction1.sender,
        recipient: transaction1.recipient,
        amount: 2000000,
        transaction_type: TransactionType.TRANSFER,
        nonce: 5, // Stesso nonce
      };
      
      // Aggiunge la prima transazione
      await transactionManager.addTransaction(transaction1);
      
      // Verifica che la seconda transazione venga rifiutata
      await expect(transactionManager.addTransaction(transaction2)).to.be.rejectedWith('Nonce già utilizzato');
    });
    
    it('should reject transactions with nonce out of sequence', async () => {
      // Crea una transazione con nonce fuori sequenza
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
        nonce: 10, // Nonce fuori sequenza (dovrebbe essere 6)
      };
      
      // Configura il mock di getAccount per restituire un nonce specifico
      axios.get.withArgs(`https://api.layer2.example.com/accounts/${transaction.sender}`).resolves({
        data: {
          account: {
            address: transaction.sender,
            balance: '1000000000',
            nonce: 5, // Ultimo nonce utilizzato
            lastUpdated: 1619712000,
          },
        },
      });
      
      // Verifica che la transazione venga rifiutata
      await expect(transactionManager.addTransaction(transaction)).to.be.rejectedWith('Nonce non valido');
    });
  });
  
  describe('Rate Limiting', () => {
    it('should limit the number of transactions per account', async () => {
      // Configura il limite di transazioni per account
      transactionManager.maxTransactionsPerAccount = 3;
      
      // Crea un mittente
      const sender = new PublicKey(Buffer.alloc(32, 1)).toString();
      
      // Crea e aggiunge alcune transazioni
      for (let i = 0; i < 3; i++) {
        const transaction = {
          sender,
          recipient: new PublicKey(Buffer.alloc(32, i + 2)).toString(),
          amount: 1000000 * (i + 1),
          transaction_type: TransactionType.TRANSFER,
          nonce: i + 6, // Nonce in sequenza
        };
        
        // Configura il mock di getAccount per restituire un nonce specifico
        axios.get.withArgs(`https://api.layer2.example.com/accounts/${sender}`).resolves({
          data: {
            account: {
              address: sender,
              balance: '1000000000',
              nonce: i + 5, // Ultimo nonce utilizzato
              lastUpdated: 1619712000,
            },
          },
        });
        
        // Aggiunge la transazione
        await transactionManager.addTransaction(transaction);
      }
      
      // Crea una transazione oltre il limite
      const transaction = {
        sender,
        recipient: new PublicKey(Buffer.alloc(32, 5)).toString(),
        amount: 4000000,
        transaction_type: TransactionType.TRANSFER,
        nonce: 9, // Nonce in sequenza
      };
      
      // Configura il mock di getAccount per restituire un nonce specifico
      axios.get.withArgs(`https://api.layer2.example.com/accounts/${sender}`).resolves({
        data: {
          account: {
            address: sender,
            balance: '1000000000',
            nonce: 8, // Ultimo nonce utilizzato
            lastUpdated: 1619712000,
          },
        },
      });
      
      // Verifica che la transazione venga rifiutata
      await expect(transactionManager.addTransaction(transaction)).to.be.rejectedWith('Limite di transazioni raggiunto');
    });
    
    it('should limit the total number of transactions', async () => {
      // Configura il limite totale di transazioni
      transactionManager.maxTotalTransactions = 3;
      
      // Crea e aggiunge alcune transazioni
      for (let i = 0; i < 3; i++) {
        const transaction = {
          sender: new PublicKey(Buffer.alloc(32, i + 1)).toString(),
          recipient: new PublicKey(Buffer.alloc(32, i + 10)).toString(),
          amount: 1000000 * (i + 1),
          transaction_type: TransactionType.TRANSFER,
          nonce: 6, // Nonce in sequenza
        };
        
        // Configura il mock di getAccount per restituire un nonce specifico
        axios.get.withArgs(`https://api.layer2.example.com/accounts/${transaction.sender}`).resolves({
          data: {
            account: {
              address: transaction.sender,
              balance: '1000000000',
              nonce: 5, // Ultimo nonce utilizzato
              lastUpdated: 1619712000,
            },
          },
        });
        
        // Aggiunge la transazione
        await transactionManager.addTransaction(transaction);
      }
      
      // Crea una transazione oltre il limite
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 4)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 13)).toString(),
        amount: 4000000,
        transaction_type: TransactionType.TRANSFER,
        nonce: 6, // Nonce in sequenza
      };
      
      // Configura il mock di getAccount per restituire un nonce specifico
      axios.get.withArgs(`https://api.layer2.example.com/accounts/${transaction.sender}`).resolves({
        data: {
          account: {
            address: transaction.sender,
            balance: '1000000000',
            nonce: 5, // Ultimo nonce utilizzato
            lastUpdated: 1619712000,
          },
        },
      });
      
      // Verifica che la transazione venga rifiutata
      await expect(transactionManager.addTransaction(transaction)).to.be.rejectedWith('Limite totale di transazioni raggiunto');
    });
  });
  
  describe('Transaction Expiry', () => {
    it('should reject expired transactions', async () => {
      // Crea una transazione scaduta
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
        expiry_timestamp: Math.floor(Date.now() / 1000) - 3600, // Scaduta un'ora fa
      };
      
      // Verifica che la transazione venga rifiutata
      await expect(transactionManager.addTransaction(transaction)).to.be.rejectedWith('Transazione scaduta');
    });
    
    it('should accept transactions with future expiry', async () => {
      // Crea una transazione con scadenza futura
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
        expiry_timestamp: Math.floor(Date.now() / 1000) + 3600, // Scade tra un'ora
      };
      
      // Configura il mock di getAccount per restituire un nonce specifico
      axios.get.withArgs(`https://api.layer2.example.com/accounts/${transaction.sender}`).resolves({
        data: {
          account: {
            address: transaction.sender,
            balance: '1000000000',
            nonce: 5, // Ultimo nonce utilizzato
            lastUpdated: 1619712000,
          },
        },
      });
      
      // Aggiunge la transazione
      const transactionId = await transactionManager.addTransaction(transaction);
      
      // Verifica che la transazione sia stata aggiunta
      expect(transactionId).to.be.a('string');
    });
  });
  
  describe('Balance Checks', () => {
    it('should reject transactions with insufficient balance', async () => {
      // Crea una transazione con importo superiore al saldo
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 2000000000, // 2 miliardi, superiore al saldo di 1 miliardo
        transaction_type: TransactionType.TRANSFER,
      };
      
      // Configura il mock di getAccount per restituire un saldo specifico
      axios.get.withArgs(`https://api.layer2.example.com/accounts/${transaction.sender}`).resolves({
        data: {
          account: {
            address: transaction.sender,
            balance: '1000000000', // 1 miliardo
            nonce: 5,
            lastUpdated: 1619712000,
          },
        },
      });
      
      // Verifica che la transazione venga rifiutata
      await expect(transactionManager.addTransaction(transaction)).to.be.rejectedWith('Saldo insufficiente');
    });
    
    it('should accept transactions with sufficient balance', async () => {
      // Crea una transazione con importo inferiore al saldo
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 500000000, // 500 milioni, inferiore al saldo di 1 miliardo
        transaction_type: TransactionType.TRANSFER,
      };
      
      // Configura il mock di getAccount per restituire un saldo specifico
      axios.get.withArgs(`https://api.layer2.example.com/accounts/${transaction.sender}`).resolves({
        data: {
          account: {
            address: transaction.sender,
            balance: '1000000000', // 1 miliardo
            nonce: 5,
            lastUpdated: 1619712000,
          },
        },
      });
      
      // Aggiunge la transazione
      const transactionId = await transactionManager.addTransaction(transaction);
      
      // Verifica che la transazione sia stata aggiunta
      expect(transactionId).to.be.a('string');
    });
  });
  
  describe('Merkle Tree Verification', () => {
    it('should verify valid Merkle proofs', async () => {
      // Crea un array di transazioni
      const transactions = [
        'transaction1',
        'transaction2',
        'transaction3',
        'transaction4',
      ];
      
      // Crea un albero di Merkle
      const leaves = transactions.map(tx => crypto.createHash('sha256').update(tx).digest());
      const tree = new MerkleTree(leaves);
      
      // Ottiene la radice dell'albero
      const root = tree.getRoot();
      
      // Ottiene una prova per una transazione
      const proof = tree.getProof(1); // Prova per transaction2
      
      // Verifica la prova
      const isValid = MerkleTree.verify(leaves[1], proof, root);
      
      // Verifica che la prova sia valida
      expect(isValid).to.be.true;
    });
    
    it('should reject invalid Merkle proofs', async () => {
      // Crea un array di transazioni
      const transactions = [
        'transaction1',
        'transaction2',
        'transaction3',
        'transaction4',
      ];
      
      // Crea un albero di Merkle
      const leaves = transactions.map(tx => crypto.createHash('sha256').update(tx).digest());
      const tree = new MerkleTree(leaves);
      
      // Ottiene la radice dell'albero
      const root = tree.getRoot();
      
      // Ottiene una prova per una transazione
      const proof = tree.getProof(1); // Prova per transaction2
      
      // Verifica la prova con una transazione diversa
      const isValid = MerkleTree.verify(leaves[2], proof, root);
      
      // Verifica che la prova non sia valida
      expect(isValid).to.be.false;
    });
  });
  
  describe('Front-Running Prevention', () => {
    it('should process transactions in order of nonce', async () => {
      // Crea alcune transazioni con nonce diversi
      const transaction1 = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
        nonce: 7, // Nonce più alto
      };
      
      const transaction2 = {
        sender: transaction1.sender,
        recipient: transaction1.recipient,
        amount: 2000000,
        transaction_type: TransactionType.TRANSFER,
        nonce: 6, // Nonce più basso
      };
      
      // Configura il mock di getAccount per restituire un nonce specifico
      axios.get.withArgs(`https://api.layer2.example.com/accounts/${transaction1.sender}`).resolves({
        data: {
          account: {
            address: transaction1.sender,
            balance: '1000000000',
            nonce: 5, // Ultimo nonce utilizzato
            lastUpdated: 1619712000,
          },
        },
      });
      
      // Aggiunge le transazioni in ordine inverso
      await transactionManager.addTransaction(transaction1);
      await transactionManager.addTransaction(transaction2);
      
      // Verifica che le transazioni siano ordinate per nonce
      expect(transactionManager.pendingTransactions[0].nonce).to.equal(6);
      expect(transactionManager.pendingTransactions[1].nonce).to.equal(7);
    });
  });
  
  describe('Denial of Service Prevention', () => {
    it('should limit batch size', async () => {
      // Configura la dimensione massima del batch
      transactionManager.maxBatchSize = 2;
      
      // Crea e aggiunge alcune transazioni
      for (let i = 0; i < 5; i++) {
        const transaction = {
          sender: new PublicKey(Buffer.alloc(32, i + 1)).toString(),
          recipient: new PublicKey(Buffer.alloc(32, i + 10)).toString(),
          amount: 1000000 * (i + 1),
          transaction_type: TransactionType.TRANSFER,
        };
        
        // Configura il mock di getAccount per restituire un nonce specifico
        axios.get.withArgs(`https://api.layer2.example.com/accounts/${transaction.sender}`).resolves({
          data: {
            account: {
              address: transaction.sender,
              balance: '1000000000',
              nonce: 5, // Ultimo nonce utilizzato
              lastUpdated: 1619712000,
            },
          },
        });
        
        // Aggiunge la transazione
        await transactionManager.addTransaction(transaction);
      }
      
      // Crea un batch
      const batch = await transactionManager.createBatch();
      
      // Verifica che il batch contenga solo il numero massimo di transazioni
      expect(batch.transactions.length).to.equal(2);
    });
    
    it('should limit transaction size', async () => {
      // Configura la dimensione massima della transazione
      transactionManager.maxTransactionSize = 100;
      
      // Crea una transazione con dati di grandi dimensioni
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
        data: Buffer.alloc(200), // Dati di grandi dimensioni
      };
      
      // Verifica che la transazione venga rifiutata
      await expect(transactionManager.addTransaction(transaction)).to.be.rejectedWith('Transazione troppo grande');
    });
  });
  
  describe('Error Handling', () => {
    it('should handle network errors with retry', async () => {
      // Crea una transazione
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
      };
      
      // Configura il mock di getAccount per lanciare un errore di rete
      axios.get.withArgs(`https://api.layer2.example.com/accounts/${transaction.sender}`)
        .onFirstCall().rejects(new Error('Network error'))
        .onSecondCall().resolves({
          data: {
            account: {
              address: transaction.sender,
              balance: '1000000000',
              nonce: 5,
              lastUpdated: 1619712000,
            },
          },
        });
      
      // Spy sul metodo handleError
      sinon.spy(errorManager, 'handleError');
      
      // Aggiunge la transazione
      const transactionId = await transactionManager.addTransaction(transaction);
      
      // Verifica che l'errore sia stato gestito
      expect(errorManager.handleError.calledOnce).to.be.true;
      
      // Verifica che la transazione sia stata aggiunta dopo il retry
      expect(transactionId).to.be.a('string');
    });
    
    it('should implement circuit breaker pattern', async () => {
      // Configura il circuit breaker
      errorManager.failureThreshold = 3;
      errorManager.resetTimeout = 1000;
      
      // Crea una transazione
      const transaction = {
        sender: new PublicKey(Buffer.alloc(32, 1)).toString(),
        recipient: new PublicKey(Buffer.alloc(32, 2)).toString(),
        amount: 1000000,
        transaction_type: TransactionType.TRANSFER,
      };
      
      // Configura il mock di getAccount per lanciare sempre un errore
      axios.get.withArgs(`https://api.layer2.example.com/accounts/${transaction.sender}`)
        .rejects(new Error('Network error'));
      
      // Spy sul metodo handleError
      sinon.spy(errorManager, 'handleError');
      
      // Tenta di aggiungere la transazione più volte
      for (let i = 0; i < 3; i++) {
        try {
          await transactionManager.addTransaction(transaction);
        } catch (error) {
          // Ignora l'errore
        }
      }
      
      // Verifica che il circuit breaker sia aperto
      expect(errorManager.isCircuitOpen).to.be.true;
      
      // Verifica che ulteriori tentativi vengano rifiutati immediatamente
      const startTime = Date.now();
      try {
        await transactionManager.addTransaction(transaction);
        // Se non viene lanciato un errore, il test fallisce
        expect.fail('Should have thrown an error');
      } catch (error) {
        // Verifica che l'errore sia stato lanciato immediatamente
        const endTime = Date.now();
        expect(endTime - startTime).to.be.lessThan(100);
        expect(error.message).to.equal('Circuit breaker open');
      }
    });
  });
});

// Classe MerkleTree per i test
class MerkleTree {
  constructor(leaves) {
    this.leaves = leaves;
    this.layers = [leaves];
    this.createHashes(leaves);
  }
  
  createHashes(nodes) {
    if (nodes.length === 1) {
      return;
    }
    
    const layer = [];
    for (let i = 0; i < nodes.length; i += 2) {
      if (i + 1 === nodes.length) {
        layer.push(nodes[i]);
      } else {
        const left = nodes[i];
        const right = nodes[i + 1];
        const data = Buffer.concat([left, right]);
        const hash = crypto.createHash('sha256').update(data).digest();
        layer.push(hash);
      }
    }
    
    this.layers.push(layer);
    this.createHashes(layer);
  }
  
  getRoot() {
    return this.layers[this.layers.length - 1][0];
  }
  
  getProof(index) {
    let idx = index;
    const proof = [];
    
    for (let i = 0; i < this.layers.length - 1; i++) {
      const layer = this.layers[i];
      const isRight = idx % 2 === 0;
      const pairIndex = isRight ? idx + 1 : idx - 1;
      
      if (pairIndex < layer.length) {
        proof.push({
          data: layer[pairIndex],
          position: isRight ? 'right' : 'left',
        });
      }
      
      idx = Math.floor(idx / 2);
    }
    
    return proof;
  }
  
  static verify(leaf, proof, root) {
    let hash = leaf;
    
    for (const { data, position } of proof) {
      const buffers = position === 'left'
        ? [data, hash]
        : [hash, data];
      
      hash = crypto.createHash('sha256').update(Buffer.concat(buffers)).digest();
    }
    
    return Buffer.compare(hash, root) === 0;
  }
}
