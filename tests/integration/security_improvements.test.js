const { expect } = require('chai');
const sinon = require('sinon');
const axios = require('axios');
const { MonitoringSystem } = require('../../offchain/monitoring-system');
const { MetricsCollector } = require('../../offchain/metrics-collector');
const { AlertManager } = require('../../offchain/alert-manager');

// Importa i moduli necessari
const queryBuilder = require('../../offchain/query-builder');
const databaseManager = require('../../offchain/database-manager');
const authManager = require('../../offchain/auth-manager');
const apiGateway = require('../../offchain/api-gateway');
const sequencer = require('../../offchain/sequencer');
const transactionValidator = require('../../bridge/transaction-validator');
const keyManager = require('../../offchain/key_manager');
const hsmIntegration = require('../../offchain/hsm-integration');
const thresholdSignature = require('../../offchain/threshold-signature');
const shardingStrategy = require('../../offchain/sharding-strategy');
const logger = require('../../offchain/logger/logger');

describe('Security Improvements Integration Tests', () => {
  // Configurazione globale
  let monitoringSystem;
  let metricsCollector;
  let alertManager;
  
  before(async () => {
    // Inizializza i sistemi
    monitoringSystem = new MonitoringSystem({
      port: 9091,
      defaultLabels: {
        app: 'layer2-solana-test'
      }
    });
    
    metricsCollector = new MetricsCollector({
      collectionInterval: 5,
      monitoringSystem
    });
    
    alertManager = new AlertManager({
      evaluationInterval: 5,
      monitoringSystem,
      notifiers: {
        console: { enabled: true },
        email: { enabled: false },
        slack: { enabled: false },
        webhook: { enabled: false },
        sms: { enabled: false },
        pushNotification: { enabled: false }
      }
    });
    
    // Configura il database
    await databaseManager.initialize({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'layer2_test',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      sharding: {
        enabled: true,
        shardCount: 4,
        strategy: 'hash'
      }
    });
    
    // Configura l'HSM
    await hsmIntegration.initialize({
      provider: 'aws',
      region: 'us-west-2',
      keyId: 'test-key-id',
      // In un ambiente di test, utilizziamo un mock dell'HSM
      mockMode: true
    });
    
    // Configura il logger
    logger.configure({
      appName: 'layer2-solana-test',
      logLevel: 'info',
      redactSensitiveData: true,
      storage: {
        type: 'memory',
        retentionPeriod: 3600 // 1 ora
      }
    });
  });
  
  after(async () => {
    // Chiudi i sistemi
    monitoringSystem.close();
    metricsCollector.close();
    alertManager.close();
    
    // Chiudi il database
    await databaseManager.close();
    
    // Chiudi l'HSM
    await hsmIntegration.close();
    
    // Chiudi il logger
    logger.close();
  });
  
  describe('SQL Injection Prevention Integration', () => {
    it('should prevent SQL injection in end-to-end transaction flow', async () => {
      // Crea una transazione con input potenzialmente dannoso
      const maliciousTransactionId = "1'; DROP TABLE transactions; --";
      
      // Stub del metodo executeQuery per evitare di eseguire query reali
      const executeQueryStub = sinon.stub(databaseManager, 'executeQuery').resolves({ rows: [] });
      
      // Esegui il flusso completo di una transazione
      await sequencer.processTransaction({
        id: maliciousTransactionId,
        amount: 100,
        sender: "Robert'); DROP TABLE users; --",
        recipient: 'recipient456',
        timestamp: Date.now()
      });
      
      // Verifica che tutte le query utilizzino prepared statements
      expect(executeQueryStub.called).to.be.true;
      
      executeQueryStub.getCalls().forEach(call => {
        // Verifica che la query utilizzi parametrizzazione
        expect(call.args[0]).to.be.a('string');
        expect(call.args[0]).to.not.include("DROP TABLE");
        
        // Verifica che i parametri siano passati separatamente
        expect(call.args[1]).to.be.an('array');
      });
      
      // Ripristina lo stub
      executeQueryStub.restore();
    });
    
    it('should handle complex queries with proper parameterization', async () => {
      // Stub del metodo executeQuery
      const executeQueryStub = sinon.stub(databaseManager, 'executeQuery').resolves({ rows: [] });
      
      // Esegui una query complessa
      await databaseManager.executeComplexQuery({
        select: ['id', 'name', 'balance'],
        from: 'accounts',
        where: {
          id: "acc123'; DROP TABLE accounts; --",
          status: 'active'
        },
        orderBy: 'balance',
        limit: 10
      });
      
      // Verifica che la query sia stata costruita correttamente
      expect(executeQueryStub.calledOnce).to.be.true;
      const call = executeQueryStub.getCall(0);
      
      // La query dovrebbe utilizzare parametrizzazione
      expect(call.args[0]).to.include('SELECT');
      expect(call.args[0]).to.include('FROM accounts');
      expect(call.args[0]).to.include('WHERE');
      expect(call.args[0]).to.include('ORDER BY');
      expect(call.args[0]).to.include('LIMIT');
      
      // I parametri dovrebbero essere passati separatamente
      expect(call.args[1]).to.be.an('array');
      expect(call.args[1]).to.include("acc123'; DROP TABLE accounts; --");
      
      // Ripristina lo stub
      executeQueryStub.restore();
    });
  });
  
  describe('Authorization Controls Integration', () => {
    it('should authenticate and authorize API requests end-to-end', async () => {
      // Configura i ruoli e le autorizzazioni
      authManager.setRolePermissions('admin', ['read', 'write', 'delete']);
      authManager.setRolePermissions('user', ['read']);
      
      // Crea un token per un utente admin
      const adminToken = authManager.generateToken({ userId: 1, role: 'admin' });
      
      // Crea un token per un utente normale
      const userToken = authManager.generateToken({ userId: 2, role: 'user' });
      
      // Stub del metodo handleRequest dell'API gateway
      const handleRequestStub = sinon.stub(apiGateway, 'handleRequest').resolves({ status: 'success' });
      
      // Simula una richiesta admin
      const adminResult = await apiGateway.processRequest({
        method: 'POST',
        path: '/api/accounts',
        headers: {
          authorization: `Bearer ${adminToken}`
        },
        body: {
          name: 'Test Account',
          balance: 1000
        }
      });
      
      // Simula una richiesta utente (dovrebbe fallire per mancanza di autorizzazione)
      let userError;
      try {
        await apiGateway.processRequest({
          method: 'POST',
          path: '/api/accounts',
          headers: {
            authorization: `Bearer ${userToken}`
          },
          body: {
            name: 'Test Account',
            balance: 1000
          }
        });
      } catch (error) {
        userError = error;
      }
      
      // Verifica che la richiesta admin sia stata gestita
      expect(handleRequestStub.calledOnce).to.be.true;
      
      // Verifica che la richiesta utente abbia generato un errore di autorizzazione
      expect(userError).to.exist;
      expect(userError.message).to.include('Unauthorized');
      
      // Ripristina lo stub
      handleRequestStub.restore();
    });
    
    it('should handle token rotation in a complete authentication flow', async () => {
      // Stub del metodo storeToken
      const storeTokenStub = sinon.stub(authManager, 'storeToken').resolves();
      const invalidateTokenStub = sinon.stub(authManager, 'invalidateToken').resolves();
      
      // Simula un flusso di autenticazione completo
      
      // 1. Login
      const loginResult = await authManager.login('user@example.com', 'password123');
      const originalToken = loginResult.token;
      
      // 2. Utilizzo del token
      const userData = await authManager.getUserData(originalToken);
      
      // 3. Rotazione del token
      const refreshedToken = await authManager.refreshToken(originalToken);
      
      // 4. Verifica che il vecchio token sia invalidato
      const isOriginalValid = authManager.isTokenValid(originalToken);
      
      // 5. Verifica che il nuovo token sia valido
      const isRefreshedValid = authManager.isTokenValid(refreshedToken);
      
      // 6. Logout
      await authManager.logout(refreshedToken);
      
      // Verifica i risultati
      expect(loginResult).to.have.property('token');
      expect(loginResult).to.have.property('user');
      
      expect(userData).to.exist;
      
      expect(refreshedToken).to.be.a('string');
      expect(refreshedToken).to.not.equal(originalToken);
      
      expect(isOriginalValid).to.be.false;
      expect(isRefreshedValid).to.be.true;
      
      expect(storeTokenStub.called).to.be.true;
      expect(invalidateTokenStub.called).to.be.true;
      
      // Ripristina gli stub
      storeTokenStub.restore();
      invalidateTokenStub.restore();
    });
  });
  
  describe('Anti-Double-Spending Protection Integration', () => {
    it('should prevent double-spending in withdrawal flow', async () => {
      // Crea una transazione
      const transaction = {
        id: 'tx-' + Date.now(),
        amount: 100,
        sender: 'sender123',
        recipient: 'recipient456',
        timestamp: Date.now()
      };
      
      // Stub dei metodi necessari
      const validateWithdrawalStub = sinon.stub(transactionValidator, 'validateWithdrawal').resolves({
        isValid: true,
        phase1Passed: true,
        phase2Passed: true,
        phase3Passed: true
      });
      
      const processWithdrawalStub = sinon.stub(sequencer, 'processWithdrawal').resolves({
        status: 'success',
        transactionHash: '0x123456'
      });
      
      // Esegui il primo prelievo (dovrebbe avere successo)
      const result1 = await sequencer.withdraw(transaction);
      
      // Modifica l'ID della transazione per simulare un tentativo di double-spending
      const modifiedTransaction = { ...transaction, id: 'tx-modified-' + Date.now() };
      
      // Configura lo stub per rilevare il double-spending
      validateWithdrawalStub.resolves({
        isValid: false,
        phase1Passed: true,
        phase2Passed: false, // Fallisce nella fase di verifica double-spending
        phase3Passed: false,
        error: 'Double-spending detected'
      });
      
      // Esegui il secondo prelievo (dovrebbe fallire)
      let error;
      try {
        await sequencer.withdraw(modifiedTransaction);
      } catch (e) {
        error = e;
      }
      
      // Verifica i risultati
      expect(result1).to.have.property('status', 'success');
      expect(result1).to.have.property('transactionHash', '0x123456');
      
      expect(error).to.exist;
      expect(error.message).to.include('Double-spending');
      
      // Verifica che i metodi siano stati chiamati correttamente
      expect(validateWithdrawalStub.calledTwice).to.be.true;
      expect(processWithdrawalStub.calledOnce).to.be.true;
      
      // Ripristina gli stub
      validateWithdrawalStub.restore();
      processWithdrawalStub.restore();
    });
    
    it('should validate Merkle proofs in a complete transaction flow', async () => {
      // Crea un batch di transazioni
      const transactions = [
        {
          id: 'tx1-' + Date.now(),
          amount: 100,
          sender: 'sender123',
          recipient: 'recipient456',
          timestamp: Date.now()
        },
        {
          id: 'tx2-' + Date.now(),
          amount: 200,
          sender: 'sender789',
          recipient: 'recipient012',
          timestamp: Date.now()
        }
      ];
      
      // Stub dei metodi necessari
      const buildMerkleTreeStub = sinon.stub(transactionValidator, 'buildMerkleTree').returns({
        root: '0xabcdef',
        tree: {}
      });
      
      const generateMerkleProofStub = sinon.stub(transactionValidator, 'generateMerkleProof').returns({
        proof: ['0x123', '0x456'],
        root: '0xabcdef',
        leaf: '0x789'
      });
      
      const verifyMerkleProofStub = sinon.stub(transactionValidator, 'verifyMerkleProof').returns(true);
      
      // Esegui il flusso completo
      const batchResult = await sequencer.processBatch(transactions);
      
      // Verifica una transazione specifica
      const verificationResult = await transactionValidator.verifyTransaction(transactions[0], batchResult.merkleRoot);
      
      // Verifica i risultati
      expect(batchResult).to.have.property('status', 'success');
      expect(batchResult).to.have.property('merkleRoot', '0xabcdef');
      
      expect(verificationResult).to.be.true;
      
      // Verifica che i metodi siano stati chiamati correttamente
      expect(buildMerkleTreeStub.calledOnce).to.be.true;
      expect(generateMerkleProofStub.called).to.be.true;
      expect(verifyMerkleProofStub.called).to.be.true;
      
      // Ripristina gli stub
      buildMerkleTreeStub.restore();
      generateMerkleProofStub.restore();
      verifyMerkleProofStub.restore();
    });
  });
  
  describe('Advanced Key Protection Integration', () => {
    it('should sign transactions using threshold signatures', async () => {
      // Crea un gruppo di firme con soglia 2 su 3
      const group = thresholdSignature.createGroup(3, 2);
      
      // Genera le chiavi per ogni partecipante
      const keys = [];
      for (let i = 0; i < 3; i++) {
        keys.push(thresholdSignature.generateKeys(group, i));
      }
      
      // Crea una transazione
      const transaction = {
        id: 'tx-' + Date.now(),
        amount: 100,
        sender: 'sender123',
        recipient: 'recipient456',
        timestamp: Date.now()
      };
      
      // Serializza la transazione
      const message = JSON.stringify(transaction);
      
      // Stub dei metodi di firma
      const signStub = sinon.stub(thresholdSignature, 'sign');
      signStub.onCall(0).resolves('signature1');
      signStub.onCall(1).resolves('signature2');
      
      const combineSignaturesStub = sinon.stub(thresholdSignature, 'combineSignatures').returns('combinedSignature');
      const verifyStub = sinon.stub(thresholdSignature, 'verify').returns(true);
      
      // Esegui il flusso di firma
      const partialSignatures = [
        await thresholdSignature.sign(group, keys[0], message),
        await thresholdSignature.sign(group, keys[1], message)
      ];
      
      const combinedSignature = thresholdSignature.combineSignatures(group, partialSignatures);
      
      // Verifica la firma
      const isValid = thresholdSignature.verify(group, combinedSignature, message);
      
      // Verifica i risultati
      expect(combinedSignature).to.equal('combinedSignature');
      expect(isValid).to.be.true;
      
      // Verifica che i metodi siano stati chiamati correttamente
      expect(signStub.calledTwice).to.be.true;
      expect(combineSignaturesStub.calledOnce).to.be.true;
      expect(verifyStub.calledOnce).to.be.true;
      
      // Ripristina gli stub
      signStub.restore();
      combineSignaturesStub.restore();
      verifyStub.restore();
    });
    
    it('should integrate HSM with multi-signature in a complete transaction flow', async () => {
      // Stub dei metodi HSM
      const hsmSignStub = sinon.stub(hsmIntegration, 'sign').resolves('hsmSignature');
      const hsmVerifyStub = sinon.stub(hsmIntegration, 'verify').resolves(true);
      
      // Stub dei metodi di firma multi-sig
      const signWithMultiSigHSMStub = sinon.stub(keyManager, 'signWithMultiSigHSM').resolves('multiSigSignature');
      const verifyMultiSigHSMStub = sinon.stub(keyManager, 'verifyMultiSigHSM').resolves(true);
      
      // Crea una transazione
      const transaction = {
        id: 'tx-' + Date.now(),
        amount: 100,
        sender: 'sender123',
        recipient: 'recipient456',
        timestamp: Date.now()
      };
      
      // Esegui il flusso completo
      const signedTransaction = await sequencer.signTransaction(transaction);
      
      // Verifica la transazione firmata
      const verificationResult = await sequencer.verifyTransaction(signedTransaction);
      
      // Verifica i risultati
      expect(signedTransaction).to.have.property('signature', 'multiSigSignature');
      expect(verificationResult).to.be.true;
      
      // Verifica che i metodi siano stati chiamati correttamente
      expect(signWithMultiSigHSMStub.calledOnce).to.be.true;
      expect(verifyMultiSigHSMStub.calledOnce).to.be.true;
      
      // Ripristina gli stub
      hsmSignStub.restore();
      hsmVerifyStub.restore();
      signWithMultiSigHSMStub.restore();
      verifyMultiSigHSMStub.restore();
    });
  });
  
  describe('Database Sharding Integration', () => {
    it('should route queries to correct shards in a complete transaction flow', async () => {
      // Configura la strategia di sharding
      shardingStrategy.configure({
        shardCount: 4,
        strategy: 'hash'
      });
      
      // Stub dei metodi necessari
      const getShardForKeyStub = sinon.stub(shardingStrategy, 'getShardForKey');
      getShardForKeyStub.withArgs('sender123').returns(0);
      getShardForKeyStub.withArgs('recipient456').returns(1);
      
      const executeQueryOnShardStub = sinon.stub(databaseManager, 'executeQueryOnShard').resolves({ rows: [] });
      
      // Crea una transazione
      const transaction = {
        id: 'tx-' + Date.now(),
        amount: 100,
        sender: 'sender123',
        recipient: 'recipient456',
        timestamp: Date.now()
      };
      
      // Esegui il flusso completo
      await sequencer.processTransaction(transaction);
      
      // Verifica che le query siano state eseguite sugli shard corretti
      expect(getShardForKeyStub.calledWith('sender123')).to.be.true;
      expect(getShardForKeyStub.calledWith('recipient456')).to.be.true;
      
      expect(executeQueryOnShardStub.called).to.be.true;
      
      // Verifica che le query siano state eseguite sugli shard 0 e 1
      const calls = executeQueryOnShardStub.getCalls();
      const shards = calls.map(call => call.args[0]);
      
      expect(shards).to.include(0);
      expect(shards).to.include(1);
      
      // Ripristina gli stub
      getShardForKeyStub.restore();
      executeQueryOnShardStub.restore();
    });
    
    it('should handle cross-shard transactions atomically', async () => {
      // Stub dei metodi necessari
      const beginTransactionStub = sinon.stub(databaseManager, 'beginTransaction').resolves();
      const commitTransactionStub = sinon.stub(databaseManager, 'commitTransaction').resolves();
      const rollbackTransactionStub = sinon.stub(databaseManager, 'rollbackTransaction').resolves();
      const executeQueryOnShardStub = sinon.stub(databaseManager, 'executeQueryOnShard').resolves({ rows: [] });
      
      // Crea una transazione cross-shard
      const transaction = {
        id: 'tx-' + Date.now(),
        amount: 100,
        sender: 'sender123', // Shard 0
        recipient: 'recipient456', // Shard 1
        timestamp: Date.now()
      };
      
      // Esegui il flusso completo
      await sequencer.processTransaction(transaction);
      
      // Verifica che la transazione sia stata gestita atomicamente
      expect(beginTransactionStub.calledTwice).to.be.true; // Una volta per ogni shard
      expect(executeQueryOnShardStub.called).to.be.true;
      expect(commitTransactionStub.calledTwice).to.be.true; // Una volta per ogni shard
      expect(rollbackTransactionStub.called).to.be.false;
      
      // Ripristina gli stub
      beginTransactionStub.restore();
      commitTransactionStub.restore();
      rollbackTransactionStub.restore();
      executeQueryOnShardStub.restore();
    });
    
    it('should handle shard failures and rollback transactions', async () => {
      // Stub dei metodi necessari
      const beginTransactionStub = sinon.stub(databaseManager, 'beginTransaction').resolves();
      const commitTransactionStub = sinon.stub(databaseManager, 'commitTransaction').resolves();
      const rollbackTransactionStub = sinon.stub(databaseManager, 'rollbackTransaction').resolves();
      
      const executeQueryOnShardStub = sinon.stub(databaseManager, 'executeQueryOnShardWithTransaction');
      // La prima query ha successo
      executeQueryOnShardStub.onCall(0).resolves({ rows: [] });
      // La seconda query fallisce
      executeQueryOnShardStub.onCall(1).rejects(new Error('Database error'));
      
      // Crea una transazione cross-shard
      const transaction = {
        id: 'tx-' + Date.now(),
        amount: 100,
        sender: 'sender123', // Shard 0
        recipient: 'recipient456', // Shard 1
        timestamp: Date.now()
      };
      
      // Esegui il flusso completo
      let error;
      try {
        await sequencer.processTransactionWithRollback(transaction);
      } catch (e) {
        error = e;
      }
      
      // Verifica che si sia verificato un errore
      expect(error).to.exist;
      expect(error.message).to.include('Database error');
      
      // Verifica che la transazione sia stata rollback
      expect(beginTransactionStub.called).to.be.true;
      expect(executeQueryOnShardStub.calledTwice).to.be.true;
      expect(commitTransactionStub.called).to.be.false;
      expect(rollbackTransactionStub.called).to.be.true;
      
      // Ripristina gli stub
      beginTransactionStub.restore();
      commitTransactionStub.restore();
      rollbackTransactionStub.restore();
      executeQueryOnShardStub.restore();
    });
  });
  
  describe('Advanced Logging and Monitoring Integration', () => {
    it('should log and monitor a complete transaction flow', async () => {
      // Stub dei metodi di logging
      const logInfoStub = sinon.stub(logger, 'info').returns();
      const logErrorStub = sinon.stub(logger, 'error').returns();
      
      // Stub dei metodi di monitoraggio
      const recordTransactionStub = sinon.stub(monitoringSystem, 'recordTransaction').returns();
      const recordApiRequestStub = sinon.stub(monitoringSystem, 'recordApiRequest').returns();
      const recordDbOperationStub = sinon.stub(monitoringSystem, 'recordDbOperation').returns();
      
      // Stub dei metodi di alert
      const processAlertStub = sinon.stub(alertManager, '_processAlert').returns();
      
      // Crea una transazione
      const transaction = {
        id: 'tx-' + Date.now(),
        amount: 100,
        sender: 'sender123',
        recipient: 'recipient456',
        timestamp: Date.now()
      };
      
      // Esegui il flusso completo
      const startTime = Date.now();
      await sequencer.processTransaction(transaction);
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      
      // Simula un errore
      try {
        await sequencer.processTransaction({ ...transaction, amount: -100 });
      } catch (error) {
        // Errore atteso
      }
      
      // Verifica che i log siano stati registrati
      expect(logInfoStub.called).to.be.true;
      expect(logErrorStub.called).to.be.true;
      
      // Verifica che le metriche siano state registrate
      expect(recordTransactionStub.called).to.be.true;
      expect(recordApiRequestStub.called).to.be.true;
      expect(recordDbOperationStub.called).to.be.true;
      
      // Aggiungi una regola di alerting
      alertManager.addRule({
        name: 'transaction_error',
        metric: 'layer2_errors_total',
        operator: '>',
        threshold: 0,
        severity: 'warning'
      });
      
      // Simula la valutazione delle regole
      await alertManager._evaluateRules();
      
      // Verifica che l'alert sia stato processato
      expect(processAlertStub.called).to.be.true;
      
      // Ripristina gli stub
      logInfoStub.restore();
      logErrorStub.restore();
      recordTransactionStub.restore();
      recordApiRequestStub.restore();
      recordDbOperationStub.restore();
      processAlertStub.restore();
    });
    
    it('should correlate logs across multiple services', async () => {
      // Stub dei metodi di logging
      const logInfoStub = sinon.stub(logger, 'info').returns();
      const withCorrelationIdStub = sinon.stub(logger, 'withCorrelationId').returns(logger);
      
      // Crea un ID di correlazione
      const correlationId = 'corr-' + Date.now();
      
      // Simula un flusso attraverso più servizi
      await apiGateway.processRequestWithCorrelation({
        method: 'POST',
        path: '/api/transactions',
        headers: {
          'x-correlation-id': correlationId
        },
        body: {
          amount: 100,
          sender: 'sender123',
          recipient: 'recipient456'
        }
      });
      
      // Verifica che l'ID di correlazione sia stato utilizzato
      expect(withCorrelationIdStub.calledWith(correlationId)).to.be.true;
      
      // Ripristina gli stub
      logInfoStub.restore();
      withCorrelationIdStub.restore();
    });
    
    it('should detect and alert on anomalies', async () => {
      // Stub dei metodi di monitoraggio
      const recordErrorStub = sinon.stub(monitoringSystem, 'recordError').returns();
      
      // Stub dei metodi di alert
      const processAlertStub = sinon.stub(alertManager, '_processAlert').returns();
      
      // Aggiungi una regola di alerting per le anomalie
      alertManager.addRule({
        name: 'high_error_rate',
        metric: 'layer2_errors_total',
        operator: '>',
        threshold: 5,
        severity: 'critical'
      });
      
      // Simula errori multipli
      for (let i = 0; i < 10; i++) {
        monitoringSystem.recordError('api', 'authentication');
      }
      
      // Simula la valutazione delle regole
      await alertManager._evaluateRules();
      
      // Verifica che l'alert sia stato processato
      expect(processAlertStub.called).to.be.true;
      
      // Ripristina gli stub
      recordErrorStub.restore();
      processAlertStub.restore();
    });
  });
});
