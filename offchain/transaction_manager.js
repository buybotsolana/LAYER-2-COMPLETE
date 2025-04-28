/**
 * Gestore delle transazioni per il Layer-2 su Solana
 * 
 * Questo modulo implementa il gestore delle transazioni che si occupa di
 * raccogliere, validare e organizzare le transazioni prima di inviarle al sequencer.
 */

const { Connection, PublicKey, Transaction, SystemProgram, Keypair } = require('@solana/web3.js');
const { MerkleTree } = require('./merkle_tree');
const { ErrorManager } = require('./error_manager');
const { GasOptimizer } = require('./gas_optimizer');
const { RecoverySystem } = require('./recovery_system');
const { performance } = require('perf_hooks');
const crypto = require('crypto');
const BN = require('bn.js');
const bs58 = require('bs58');
const borsh = require('borsh');

// Definizione degli schemi Borsh per la serializzazione
const TransactionSchema = new Map([
  [
    'Layer2Transaction',
    {
      kind: 'struct',
      fields: [
        ['id', [32]],
        ['sender', [32]],
        ['recipient', [32]],
        ['amount', 'u64'],
        ['nonce', 'u64'],
        ['expiry_timestamp', 'u64'],
        ['transaction_type', 'u8'],
        ['status', 'u8'],
        ['data', ['u8']],
        ['signature', ['u8']],
      ],
    },
  ],
]);

// Enumerazione dei tipi di transazione
const TransactionType = {
  DEPOSIT: 0,
  TRANSFER: 1,
  WITHDRAWAL: 2,
  OTHER: 3,
};

// Enumerazione degli stati delle transazioni
const TransactionStatus = {
  PENDING: 0,
  CONFIRMED: 1,
  REJECTED: 2,
  CHALLENGED: 3,
};

/**
 * Classe per la gestione delle transazioni Layer-2
 */
class TransactionManager {
  /**
   * Costruttore
   * @param {Object} config - Configurazione del gestore delle transazioni
   * @param {Connection} config.connection - Connessione a Solana
   * @param {PublicKey} config.programId - ID del programma Layer-2
   * @param {Keypair} config.sequencerKeypair - Keypair del sequencer
   * @param {number} config.maxBatchSize - Dimensione massima del batch
   * @param {number} config.maxTransactionAge - Età massima delle transazioni in secondi
   * @param {number} config.batchInterval - Intervallo di invio dei batch in millisecondi
   * @param {string} config.rpcEndpoint - Endpoint RPC di Solana
   * @param {string} config.databaseUrl - URL del database
   */
  constructor(config) {
    this.connection = config.connection;
    this.programId = config.programId;
    this.sequencerKeypair = config.sequencerKeypair;
    this.maxBatchSize = config.maxBatchSize || 1000;
    this.maxTransactionAge = config.maxTransactionAge || 3600; // 1 ora
    this.batchInterval = config.batchInterval || 10000; // 10 secondi
    this.rpcEndpoint = config.rpcEndpoint;
    this.databaseUrl = config.databaseUrl;
    
    // Coda delle transazioni in attesa
    this.pendingTransactions = [];
    
    // Coda delle transazioni con priorità
    this.priorityTransactions = [];
    
    // Mappa delle transazioni per ID
    this.transactionsById = new Map();
    
    // Mappa dei nonce per account
    this.nonceByAccount = new Map();
    
    // Contatore delle transazioni elaborate
    this.processedTransactionCount = 0;
    
    // Contatore dei batch inviati
    this.batchCount = 0;
    
    // Timestamp dell'ultimo batch inviato
    this.lastBatchTimestamp = 0;
    
    // Flag per indicare se il gestore è in esecuzione
    this.isRunning = false;
    
    // Inizializza il gestore degli errori
    this.errorManager = new ErrorManager({
      maxRetries: 5,
      initialBackoff: 1000,
      maxBackoff: 30000,
      backoffFactor: 2,
      jitterFactor: 0.1,
    });
    
    // Inizializza l'ottimizzatore del gas
    this.gasOptimizer = new GasOptimizer({
      connection: this.connection,
      priorityFeeMultiplier: 1.5,
      baseFeeMultiplier: 1.2,
      maxPriorityFee: 100000, // lamports
    });
    
    // Inizializza il sistema di recupero
    this.recoverySystem = new RecoverySystem({
      connection: this.connection,
      programId: this.programId,
      sequencerKeypair: this.sequencerKeypair,
      databaseUrl: this.databaseUrl,
      checkpointInterval: 100, // ogni 100 transazioni
    });
    
    // Metriche di performance
    this.metrics = {
      transactionsReceived: 0,
      transactionsProcessed: 0,
      transactionsRejected: 0,
      batchesSent: 0,
      averageBatchSize: 0,
      averageProcessingTime: 0,
      totalProcessingTime: 0,
      lastBatchProcessingTime: 0,
      peakTransactionsPerSecond: 0,
      currentTransactionsPerSecond: 0,
    };
    
    // Intervallo per il calcolo delle metriche
    this.metricsInterval = null;
    
    // Bind dei metodi
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
    this.addTransaction = this.addTransaction.bind(this);
    this.addPriorityTransaction = this.addPriorityTransaction.bind(this);
    this.processTransactions = this.processTransactions.bind(this);
    this.createBatch = this.createBatch.bind(this);
    this.submitBatch = this.submitBatch.bind(this);
    this.validateTransaction = this.validateTransaction.bind(this);
    this.getTransactionById = this.getTransactionById.bind(this);
    this.getTransactionsByAccount = this.getTransactionsByAccount.bind(this);
    this.getNextNonce = this.getNextNonce.bind(this);
    this.updateMetrics = this.updateMetrics.bind(this);
    this.getMetrics = this.getMetrics.bind(this);
    this.resetMetrics = this.resetMetrics.bind(this);
    
    // Inizializza le metriche
    this.resetMetrics();
    
    console.log('TransactionManager inizializzato con successo');
  }
  
  /**
   * Avvia il gestore delle transazioni
   */
  async start() {
    if (this.isRunning) {
      console.log('TransactionManager è già in esecuzione');
      return;
    }
    
    console.log('Avvio del TransactionManager...');
    
    try {
      // Verifica la connessione a Solana
      const version = await this.connection.getVersion();
      console.log(`Connesso a Solana v${version['solana-core']}`);
      
      // Verifica il saldo del sequencer
      const balance = await this.connection.getBalance(this.sequencerKeypair.publicKey);
      console.log(`Saldo del sequencer: ${balance / 1e9} SOL`);
      
      if (balance < 1e9) { // 1 SOL
        console.warn('Attenzione: il saldo del sequencer è basso');
      }
      
      // Carica lo stato dal sistema di recupero
      await this.recoverySystem.loadState();
      
      // Imposta il flag di esecuzione
      this.isRunning = true;
      
      // Avvia l'intervallo per l'elaborazione delle transazioni
      this.processingInterval = setInterval(this.processTransactions, this.batchInterval);
      
      // Avvia l'intervallo per il calcolo delle metriche
      this.metricsInterval = setInterval(this.updateMetrics, 1000);
      
      console.log('TransactionManager avviato con successo');
    } catch (error) {
      console.error('Errore durante l\'avvio del TransactionManager:', error);
      throw error;
    }
  }
  
  /**
   * Ferma il gestore delle transazioni
   */
  async stop() {
    if (!this.isRunning) {
      console.log('TransactionManager non è in esecuzione');
      return;
    }
    
    console.log('Arresto del TransactionManager...');
    
    try {
      // Elabora le transazioni rimanenti
      await this.processTransactions();
      
      // Salva lo stato nel sistema di recupero
      await this.recoverySystem.saveState({
        pendingTransactions: this.pendingTransactions,
        priorityTransactions: this.priorityTransactions,
        nonceByAccount: this.nonceByAccount,
        processedTransactionCount: this.processedTransactionCount,
        batchCount: this.batchCount,
        lastBatchTimestamp: this.lastBatchTimestamp,
      });
      
      // Cancella gli intervalli
      clearInterval(this.processingInterval);
      clearInterval(this.metricsInterval);
      
      // Imposta il flag di esecuzione
      this.isRunning = false;
      
      console.log('TransactionManager arrestato con successo');
    } catch (error) {
      console.error('Errore durante l\'arresto del TransactionManager:', error);
      throw error;
    }
  }
  
  /**
   * Aggiunge una transazione alla coda
   * @param {Object} transaction - Transazione da aggiungere
   * @returns {string} ID della transazione
   */
  addTransaction(transaction) {
    const startTime = performance.now();
    
    try {
      // Valida la transazione
      this.validateTransaction(transaction);
      
      // Genera un ID per la transazione
      const id = this.generateTransactionId(transaction);
      
      // Imposta l'ID della transazione
      transaction.id = id;
      
      // Imposta lo stato della transazione
      transaction.status = TransactionStatus.PENDING;
      
      // Imposta il timestamp di scadenza se non è già impostato
      if (!transaction.expiry_timestamp) {
        transaction.expiry_timestamp = Math.floor(Date.now() / 1000) + this.maxTransactionAge;
      }
      
      // Aggiunge la transazione alla coda
      this.pendingTransactions.push(transaction);
      
      // Aggiunge la transazione alla mappa per ID
      this.transactionsById.set(id, transaction);
      
      // Aggiorna le metriche
      this.metrics.transactionsReceived++;
      
      console.log(`Transazione aggiunta alla coda: ${id}`);
      
      return id;
    } catch (error) {
      console.error('Errore durante l\'aggiunta della transazione:', error);
      
      // Aggiorna le metriche
      this.metrics.transactionsRejected++;
      
      throw error;
    } finally {
      const endTime = performance.now();
      const processingTime = endTime - startTime;
      
      // Aggiorna le metriche di performance
      this.metrics.totalProcessingTime += processingTime;
      this.metrics.averageProcessingTime = this.metrics.totalProcessingTime / (this.metrics.transactionsReceived + this.metrics.transactionsRejected);
    }
  }
  
  /**
   * Aggiunge una transazione con priorità alla coda
   * @param {Object} transaction - Transazione da aggiungere
   * @param {number} priority - Priorità della transazione (1-10)
   * @returns {string} ID della transazione
   */
  addPriorityTransaction(transaction, priority = 5) {
    const startTime = performance.now();
    
    try {
      // Valida la transazione
      this.validateTransaction(transaction);
      
      // Valida la priorità
      if (priority < 1 || priority > 10) {
        throw new Error('La priorità deve essere compresa tra 1 e 10');
      }
      
      // Genera un ID per la transazione
      const id = this.generateTransactionId(transaction);
      
      // Imposta l'ID della transazione
      transaction.id = id;
      
      // Imposta lo stato della transazione
      transaction.status = TransactionStatus.PENDING;
      
      // Imposta il timestamp di scadenza se non è già impostato
      if (!transaction.expiry_timestamp) {
        transaction.expiry_timestamp = Math.floor(Date.now() / 1000) + this.maxTransactionAge;
      }
      
      // Aggiunge la transazione alla coda con priorità
      this.priorityTransactions.push({ transaction, priority });
      
      // Ordina la coda per priorità (decrescente)
      this.priorityTransactions.sort((a, b) => b.priority - a.priority);
      
      // Aggiunge la transazione alla mappa per ID
      this.transactionsById.set(id, transaction);
      
      // Aggiorna le metriche
      this.metrics.transactionsReceived++;
      
      console.log(`Transazione con priorità ${priority} aggiunta alla coda: ${id}`);
      
      return id;
    } catch (error) {
      console.error('Errore durante l\'aggiunta della transazione con priorità:', error);
      
      // Aggiorna le metriche
      this.metrics.transactionsRejected++;
      
      throw error;
    } finally {
      const endTime = performance.now();
      const processingTime = endTime - startTime;
      
      // Aggiorna le metriche di performance
      this.metrics.totalProcessingTime += processingTime;
      this.metrics.averageProcessingTime = this.metrics.totalProcessingTime / (this.metrics.transactionsReceived + this.metrics.transactionsRejected);
    }
  }
  
  /**
   * Elabora le transazioni in coda
   */
  async processTransactions() {
    if (!this.isRunning) {
      console.log('TransactionManager non è in esecuzione');
      return;
    }
    
    const startTime = performance.now();
    
    try {
      console.log('Elaborazione delle transazioni in coda...');
      
      // Verifica se ci sono transazioni da elaborare
      if (this.pendingTransactions.length === 0 && this.priorityTransactions.length === 0) {
        console.log('Nessuna transazione da elaborare');
        return;
      }
      
      // Crea un batch di transazioni
      const batch = await this.createBatch();
      
      // Verifica se il batch è vuoto
      if (batch.transactions.length === 0) {
        console.log('Nessuna transazione valida da elaborare');
        return;
      }
      
      // Invia il batch
      const result = await this.submitBatch(batch);
      
      // Aggiorna le metriche
      this.metrics.batchesSent++;
      this.metrics.transactionsProcessed += batch.transactions.length;
      this.metrics.averageBatchSize = this.metrics.transactionsProcessed / this.metrics.batchesSent;
      
      console.log(`Batch inviato con successo: ${batch.id}`);
      console.log(`Transazioni elaborate: ${batch.transactions.length}`);
      
      // Aggiorna il contatore dei batch
      this.batchCount++;
      
      // Aggiorna il timestamp dell'ultimo batch
      this.lastBatchTimestamp = Date.now();
      
      // Salva lo stato nel sistema di recupero
      await this.recoverySystem.saveState({
        pendingTransactions: this.pendingTransactions,
        priorityTransactions: this.priorityTransactions,
        nonceByAccount: this.nonceByAccount,
        processedTransactionCount: this.processedTransactionCount,
        batchCount: this.batchCount,
        lastBatchTimestamp: this.lastBatchTimestamp,
      });
      
      return result;
    } catch (error) {
      console.error('Errore durante l\'elaborazione delle transazioni:', error);
      
      // Gestisce l'errore con il gestore degli errori
      await this.errorManager.handleError(error, {
        context: 'processTransactions',
        retryCallback: this.processTransactions.bind(this),
      });
      
      throw error;
    } finally {
      const endTime = performance.now();
      const processingTime = endTime - startTime;
      
      // Aggiorna le metriche di performance
      this.metrics.lastBatchProcessingTime = processingTime;
    }
  }
  
  /**
   * Crea un batch di transazioni
   * @returns {Object} Batch di transazioni
   */
  async createBatch() {
    const startTime = performance.now();
    
    try {
      console.log('Creazione di un batch di transazioni...');
      
      // Combina le transazioni con priorità e quelle normali
      const allTransactions = [
        ...this.priorityTransactions.map(item => item.transaction),
        ...this.pendingTransactions,
      ];
      
      // Filtra le transazioni valide
      const validTransactions = allTransactions.filter(tx => {
        // Verifica che la transazione non sia scaduta
        const now = Math.floor(Date.now() / 1000);
        return tx.expiry_timestamp > now;
      });
      
      // Limita il numero di transazioni al massimo consentito
      const batchTransactions = validTransactions.slice(0, this.maxBatchSize);
      
      // Rimuove le transazioni selezionate dalle code
      const batchTransactionIds = new Set(batchTransactions.map(tx => tx.id));
      
      this.priorityTransactions = this.priorityTransactions.filter(
        item => !batchTransactionIds.has(item.transaction.id)
      );
      
      this.pendingTransactions = this.pendingTransactions.filter(
        tx => !batchTransactionIds.has(tx.id)
      );
      
      // Crea l'albero di Merkle delle transazioni
      const merkleTree = new MerkleTree(
        batchTransactions.map(tx => this.hashTransaction(tx))
      );
      
      // Crea il batch
      const batch = {
        id: this.generateBatchId(),
        transactions: batchTransactions,
        merkle_root: merkleTree.getRoot(),
        sequencer: this.sequencerKeypair.publicKey.toBuffer(),
        timestamp: Math.floor(Date.now() / 1000),
        expiry_timestamp: Math.floor(Date.now() / 1000) + 3600, // 1 ora
        signature: null,
      };
      
      // Firma il batch
      batch.signature = this.signBatch(batch);
      
      console.log(`Batch creato con ${batchTransactions.length} transazioni`);
      
      return batch;
    } catch (error) {
      console.error('Errore durante la creazione del batch:', error);
      throw error;
    } finally {
      const endTime = performance.now();
      const processingTime = endTime - startTime;
      
      // Aggiorna le metriche di performance
      this.metrics.lastBatchProcessingTime = processingTime;
    }
  }
  
  /**
   * Invia un batch di transazioni
   * @param {Object} batch - Batch di transazioni
   * @returns {Object} Risultato dell'invio
   */
  async submitBatch(batch) {
    const startTime = performance.now();
    
    try {
      console.log(`Invio del batch ${batch.id}...`);
      
      // Serializza il batch
      const serializedBatch = this.serializeBatch(batch);
      
      // Ottimizza le commissioni
      const { priorityFee, baseFee } = await this.gasOptimizer.optimizeFees();
      
      // Crea l'istruzione per inviare il batch
      const instruction = this.createSubmitBatchInstruction(
        this.programId,
        this.sequencerKeypair.publicKey,
        serializedBatch,
        batch.timestamp,
        batch.expiry_timestamp
      );
      
      // Crea la transazione Solana
      const transaction = new Transaction().add(instruction);
      
      // Imposta il pagatore
      transaction.feePayer = this.sequencerKeypair.publicKey;
      
      // Imposta la commissione di priorità
      transaction.setRecentBlockhash((await this.connection.getRecentBlockhash()).blockhash);
      
      // Firma la transazione
      transaction.sign(this.sequencerKeypair);
      
      // Invia la transazione
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3,
        }
      );
      
      // Attende la conferma della transazione
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
      
      console.log(`Batch inviato con successo: ${signature}`);
      
      // Aggiorna lo stato delle transazioni
      batch.transactions.forEach(tx => {
        tx.status = TransactionStatus.CONFIRMED;
        this.processedTransactionCount++;
      });
      
      return {
        batchId: batch.id,
        signature,
        confirmation,
        transactionCount: batch.transactions.length,
      };
    } catch (error) {
      console.error('Errore durante l\'invio del batch:', error);
      
      // Gestisce l'errore con il gestore degli errori
      await this.errorManager.handleError(error, {
        context: 'submitBatch',
        retryCallback: () => this.submitBatch(batch),
        maxRetries: 3,
      });
      
      throw error;
    } finally {
      const endTime = performance.now();
      const processingTime = endTime - startTime;
      
      // Aggiorna le metriche di performance
      this.metrics.lastBatchProcessingTime = processingTime;
    }
  }
  
  /**
   * Valida una transazione
   * @param {Object} transaction - Transazione da validare
   * @throws {Error} Se la transazione non è valida
   */
  validateTransaction(transaction) {
    // Verifica che la transazione abbia tutti i campi necessari
    if (!transaction.sender) {
      throw new Error('Il mittente è obbligatorio');
    }
    
    if (!transaction.recipient) {
      throw new Error('Il destinatario è obbligatorio');
    }
    
    if (transaction.amount === undefined || transaction.amount === null) {
      throw new Error('L\'importo è obbligatorio');
    }
    
    if (transaction.amount <= 0) {
      throw new Error('L\'importo deve essere positivo');
    }
    
    // Verifica che il mittente e il destinatario siano validi
    try {
      const sender = new PublicKey(transaction.sender);
      const recipient = new PublicKey(transaction.recipient);
      
      // Verifica che il mittente e il destinatario siano diversi
      if (sender.equals(recipient)) {
        throw new Error('Il mittente e il destinatario non possono essere uguali');
      }
    } catch (error) {
      throw new Error(`Indirizzo non valido: ${error.message}`);
    }
    
    // Verifica che il tipo di transazione sia valido
    if (transaction.transaction_type === undefined || transaction.transaction_type === null) {
      transaction.transaction_type = TransactionType.TRANSFER; // Default
    } else if (![
      TransactionType.DEPOSIT,
      TransactionType.TRANSFER,
      TransactionType.WITHDRAWAL,
      TransactionType.OTHER,
    ].includes(transaction.transaction_type)) {
      throw new Error('Tipo di transazione non valido');
    }
    
    // Verifica che il nonce sia valido
    if (transaction.nonce === undefined || transaction.nonce === null) {
      // Genera un nuovo nonce
      const senderKey = transaction.sender.toString();
      transaction.nonce = this.getNextNonce(senderKey);
    }
    
    // Verifica che il timestamp di scadenza sia valido
    if (transaction.expiry_timestamp) {
      const now = Math.floor(Date.now() / 1000);
      if (transaction.expiry_timestamp <= now) {
        throw new Error('La transazione è già scaduta');
      }
    }
    
    // Verifica la firma se presente
    if (transaction.signature && transaction.signature.length > 0) {
      // In un'implementazione reale, qui verificheremmo la firma
    }
    
    return true;
  }
  
  /**
   * Ottiene una transazione per ID
   * @param {string} id - ID della transazione
   * @returns {Object|null} Transazione o null se non trovata
   */
  getTransactionById(id) {
    return this.transactionsById.get(id) || null;
  }
  
  /**
   * Ottiene le transazioni per account
   * @param {string} account - Indirizzo dell'account
   * @returns {Array} Lista di transazioni
   */
  getTransactionsByAccount(account) {
    const accountKey = account.toString();
    
    return Array.from(this.transactionsById.values()).filter(tx => {
      const sender = tx.sender.toString();
      const recipient = tx.recipient.toString();
      return sender === accountKey || recipient === accountKey;
    });
  }
  
  /**
   * Ottiene il prossimo nonce per un account
   * @param {string} account - Indirizzo dell'account
   * @returns {number} Prossimo nonce
   */
  getNextNonce(account) {
    const accountKey = account.toString();
    
    // Ottiene il nonce corrente o inizializza a 0
    const currentNonce = this.nonceByAccount.get(accountKey) || 0;
    
    // Incrementa il nonce
    const nextNonce = currentNonce + 1;
    
    // Salva il nuovo nonce
    this.nonceByAccount.set(accountKey, nextNonce);
    
    return nextNonce;
  }
  
  /**
   * Genera un ID per una transazione
   * @param {Object} transaction - Transazione
   * @returns {string} ID della transazione
   */
  generateTransactionId(transaction) {
    // Crea un buffer con i dati della transazione
    const buffer = Buffer.concat([
      Buffer.from(transaction.sender.toString()),
      Buffer.from(transaction.recipient.toString()),
      Buffer.from(transaction.amount.toString()),
      Buffer.from(transaction.nonce.toString()),
      Buffer.from((transaction.expiry_timestamp || 0).toString()),
      Buffer.from([transaction.transaction_type || 0]),
      Buffer.from(transaction.data || []),
    ]);
    
    // Calcola l'hash SHA-256
    const hash = crypto.createHash('sha256').update(buffer).digest();
    
    return hash;
  }
  
  /**
   * Genera un ID per un batch
   * @returns {string} ID del batch
   */
  generateBatchId() {
    // Crea un buffer con i dati del batch
    const buffer = Buffer.concat([
      this.sequencerKeypair.publicKey.toBuffer(),
      Buffer.from(Date.now().toString()),
      Buffer.from(this.batchCount.toString()),
      crypto.randomBytes(16), // Aggiunge casualità
    ]);
    
    // Calcola l'hash SHA-256
    const hash = crypto.createHash('sha256').update(buffer).digest();
    
    return hash;
  }
  
  /**
   * Calcola l'hash di una transazione
   * @param {Object} transaction - Transazione
   * @returns {Buffer} Hash della transazione
   */
  hashTransaction(transaction) {
    // Crea un buffer con i dati della transazione
    const buffer = Buffer.concat([
      Buffer.from(transaction.id),
      Buffer.from(transaction.sender.toString()),
      Buffer.from(transaction.recipient.toString()),
      Buffer.from(transaction.amount.toString()),
      Buffer.from(transaction.nonce.toString()),
      Buffer.from((transaction.expiry_timestamp || 0).toString()),
      Buffer.from([transaction.transaction_type || 0]),
      Buffer.from([transaction.status || 0]),
      Buffer.from(transaction.data || []),
    ]);
    
    // Calcola l'hash SHA-256
    return crypto.createHash('sha256').update(buffer).digest();
  }
  
  /**
   * Firma un batch
   * @param {Object} batch - Batch da firmare
   * @returns {Buffer} Firma del batch
   */
  signBatch(batch) {
    // Crea un buffer con i dati del batch
    const buffer = Buffer.concat([
      Buffer.from(batch.id),
      Buffer.from(batch.merkle_root),
      this.sequencerKeypair.publicKey.toBuffer(),
      Buffer.from(batch.timestamp.toString()),
      Buffer.from(batch.expiry_timestamp.toString()),
    ]);
    
    // Calcola l'hash SHA-256
    const hash = crypto.createHash('sha256').update(buffer).digest();
    
    // Firma l'hash con la chiave privata del sequencer
    return Buffer.from(this.sequencerKeypair.secretKey.slice(0, 32));
  }
  
  /**
   * Serializza un batch
   * @param {Object} batch - Batch da serializzare
   * @returns {Buffer} Batch serializzato
   */
  serializeBatch(batch) {
    // Serializza le transazioni
    const serializedTransactions = batch.transactions.map(tx => {
      const layer2Tx = {
        id: tx.id,
        sender: new PublicKey(tx.sender).toBuffer(),
        recipient: new PublicKey(tx.recipient).toBuffer(),
        amount: new BN(tx.amount),
        nonce: new BN(tx.nonce),
        expiry_timestamp: new BN(tx.expiry_timestamp),
        transaction_type: tx.transaction_type,
        status: tx.status,
        data: tx.data || [],
        signature: tx.signature || [],
      };
      
      return borsh.serialize(TransactionSchema, layer2Tx);
    });
    
    // Concatena le transazioni serializzate
    return Buffer.concat(serializedTransactions);
  }
  
  /**
   * Crea un'istruzione per inviare un batch
   * @param {PublicKey} programId - ID del programma
   * @param {PublicKey} sequencer - Chiave pubblica del sequencer
   * @param {Buffer} transactions - Transazioni serializzate
   * @param {number} timestamp - Timestamp del batch
   * @param {number} expiry_timestamp - Timestamp di scadenza del batch
   * @returns {TransactionInstruction} Istruzione per inviare un batch
   */
  createSubmitBatchInstruction(
    programId,
    sequencer,
    transactions,
    timestamp,
    expiry_timestamp
  ) {
    // In un'implementazione reale, qui creeremmo l'istruzione per inviare un batch
    // utilizzando l'API di Solana
    
    return {
      keys: [
        { pubkey: sequencer, isSigner: true, isWritable: true },
      ],
      programId,
      data: Buffer.from([]),
    };
  }
  
  /**
   * Aggiorna le metriche
   */
  updateMetrics() {
    // Calcola le transazioni al secondo
    const now = Date.now();
    const elapsed = (now - this.metrics.lastMetricsUpdate) / 1000;
    
    if (elapsed > 0) {
      const newTransactions = this.metrics.transactionsReceived - this.metrics.lastTransactionsReceived;
      this.metrics.currentTransactionsPerSecond = newTransactions / elapsed;
      
      // Aggiorna il picco se necessario
      if (this.metrics.currentTransactionsPerSecond > this.metrics.peakTransactionsPerSecond) {
        this.metrics.peakTransactionsPerSecond = this.metrics.currentTransactionsPerSecond;
      }
      
      // Aggiorna i valori per il prossimo calcolo
      this.metrics.lastTransactionsReceived = this.metrics.transactionsReceived;
      this.metrics.lastMetricsUpdate = now;
    }
  }
  
  /**
   * Ottiene le metriche
   * @returns {Object} Metriche
   */
  getMetrics() {
    return { ...this.metrics };
  }
  
  /**
   * Resetta le metriche
   */
  resetMetrics() {
    this.metrics = {
      transactionsReceived: 0,
      transactionsProcessed: 0,
      transactionsRejected: 0,
      batchesSent: 0,
      averageBatchSize: 0,
      averageProcessingTime: 0,
      totalProcessingTime: 0,
      lastBatchProcessingTime: 0,
      peakTransactionsPerSecond: 0,
      currentTransactionsPerSecond: 0,
      lastTransactionsReceived: 0,
      lastMetricsUpdate: Date.now(),
    };
  }
}

module.exports = { TransactionManager, TransactionType, TransactionStatus };
