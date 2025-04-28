const { expect } = require('chai');
const sinon = require('sinon');
const { MonitoringSystem } = require('../../offchain/monitoring-system');
const { MetricsCollector } = require('../../offchain/metrics-collector');
const { AlertManager } = require('../../offchain/alert-manager');

describe('Security Improvements Unit Tests', () => {
  describe('SQL Injection Prevention', () => {
    let queryBuilder;
    let databaseManager;
    
    beforeEach(() => {
      // Importa i moduli necessari
      queryBuilder = require('../../offchain/query-builder');
      databaseManager = require('../../offchain/database-manager');
    });
    
    afterEach(() => {
      sinon.restore();
    });
    
    it('should use prepared statements in query builder', () => {
      // Verifica che il metodo buildQuery utilizzi parametrizzazione
      const params = { id: 1, name: 'test' };
      const query = queryBuilder.buildQuery('SELECT * FROM users WHERE id = $1 AND name = $2', params);
      
      expect(query).to.have.property('text');
      expect(query).to.have.property('values');
      expect(query.text).to.equal('SELECT * FROM users WHERE id = $1 AND name = $2');
      expect(query.values).to.deep.equal([1, 'test']);
    });
    
    it('should sanitize inputs in database manager', () => {
      // Verifica che il metodo query utilizzi prepared statements
      const executeQueryStub = sinon.stub(databaseManager, 'executeQuery').resolves({ rows: [] });
      
      const params = { id: 1, name: "Robert'); DROP TABLE users; --" };
      databaseManager.query('SELECT * FROM users WHERE id = $1 AND name = $2', params);
      
      expect(executeQueryStub.calledOnce).to.be.true;
      const call = executeQueryStub.getCall(0);
      expect(call.args[0]).to.equal('SELECT * FROM users WHERE id = $1 AND name = $2');
      expect(call.args[1]).to.deep.equal([1, "Robert'); DROP TABLE users; --"]);
    });
    
    it('should prevent SQL injection in sequencer', async () => {
      // Importa il sequencer
      const sequencer = require('../../offchain/sequencer');
      
      // Stub del metodo query del database manager
      const queryStub = sinon.stub(databaseManager, 'query').resolves({ rows: [] });
      
      // Esegui un metodo del sequencer che utilizza il database
      await sequencer.getTransactionById("1; DROP TABLE transactions; --");
      
      // Verifica che la query sia stata eseguita con prepared statements
      expect(queryStub.calledOnce).to.be.true;
      const call = queryStub.getCall(0);
      expect(call.args[0]).to.include('$1');
      expect(call.args[1]).to.deep.equal(["1; DROP TABLE transactions; --"]);
    });
  });
  
  describe('Authorization Controls', () => {
    let authManager;
    let apiGateway;
    
    beforeEach(() => {
      // Importa i moduli necessari
      authManager = require('../../offchain/auth-manager');
      apiGateway = require('../../offchain/api-gateway');
    });
    
    afterEach(() => {
      sinon.restore();
    });
    
    it('should generate valid JWT tokens', () => {
      const token = authManager.generateToken({ userId: 1, role: 'admin' });
      expect(token).to.be.a('string');
      
      const decoded = authManager.verifyToken(token);
      expect(decoded).to.have.property('userId', 1);
      expect(decoded).to.have.property('role', 'admin');
    });
    
    it('should implement token rotation', async () => {
      const token = authManager.generateToken({ userId: 1, role: 'admin' });
      
      // Simula il passaggio del tempo
      const clock = sinon.useFakeTimers(Date.now() + 3600000); // +1 ora
      
      const refreshedToken = await authManager.refreshToken(token);
      expect(refreshedToken).to.be.a('string');
      expect(refreshedToken).to.not.equal(token);
      
      // Il vecchio token dovrebbe essere invalidato
      const isValid = authManager.isTokenValid(token);
      expect(isValid).to.be.false;
      
      // Il nuovo token dovrebbe essere valido
      const isNewValid = authManager.isTokenValid(refreshedToken);
      expect(isNewValid).to.be.true;
      
      clock.restore();
    });
    
    it('should implement RBAC authorization', () => {
      // Configura i ruoli e le autorizzazioni
      authManager.setRolePermissions('admin', ['read', 'write', 'delete']);
      authManager.setRolePermissions('user', ['read']);
      
      // Verifica le autorizzazioni
      expect(authManager.hasPermission('admin', 'read')).to.be.true;
      expect(authManager.hasPermission('admin', 'write')).to.be.true;
      expect(authManager.hasPermission('admin', 'delete')).to.be.true;
      
      expect(authManager.hasPermission('user', 'read')).to.be.true;
      expect(authManager.hasPermission('user', 'write')).to.be.false;
      expect(authManager.hasPermission('user', 'delete')).to.be.false;
    });
    
    it('should implement ABAC authorization', () => {
      // Configura le regole ABAC
      authManager.addAbacRule('canEditOwnData', (user, resource) => {
        return user.id === resource.ownerId;
      });
      
      // Verifica le regole
      const user = { id: 1, role: 'user' };
      const ownedResource = { id: 100, ownerId: 1 };
      const otherResource = { id: 200, ownerId: 2 };
      
      expect(authManager.evaluateAbacRule('canEditOwnData', user, ownedResource)).to.be.true;
      expect(authManager.evaluateAbacRule('canEditOwnData', user, otherResource)).to.be.false;
    });
    
    it('should integrate auth manager with API gateway', () => {
      // Stub del metodo verifyToken
      const verifyTokenStub = sinon.stub(authManager, 'verifyToken').returns({ userId: 1, role: 'admin' });
      const hasPermissionStub = sinon.stub(authManager, 'hasPermission').returns(true);
      
      // Simula una richiesta
      const req = { headers: { authorization: 'Bearer token123' } };
      const res = { status: sinon.stub().returnsThis(), json: sinon.stub() };
      const next = sinon.stub();
      
      // Esegui il middleware di autenticazione
      apiGateway.authMiddleware('read')(req, res, next);
      
      // Verifica che il token sia stato verificato
      expect(verifyTokenStub.calledOnce).to.be.true;
      expect(verifyTokenStub.calledWith('token123')).to.be.true;
      
      // Verifica che le autorizzazioni siano state controllate
      expect(hasPermissionStub.calledOnce).to.be.true;
      expect(hasPermissionStub.calledWith('admin', 'read')).to.be.true;
      
      // Verifica che next() sia stato chiamato
      expect(next.calledOnce).to.be.true;
    });
  });
  
  describe('Anti-Double-Spending Protection', () => {
    let validationModule;
    let processorWithdrawal;
    let transactionValidator;
    
    beforeEach(() => {
      // Importa i moduli necessari
      validationModule = require('../../onchain/src/validation.rs');
      processorWithdrawal = require('../../onchain/src/processor_withdrawal.rs');
      transactionValidator = require('../../bridge/transaction-validator.js');
    });
    
    afterEach(() => {
      sinon.restore();
    });
    
    it('should validate transaction proofs correctly', () => {
      // Crea una prova di transazione
      const proof = transactionValidator.generateMerkleProof({
        transactionId: '123',
        amount: 100,
        sender: 'sender123',
        recipient: 'recipient456',
        timestamp: Date.now()
      });
      
      // Verifica la prova
      const isValid = transactionValidator.verifyMerkleProof(proof);
      expect(isValid).to.be.true;
    });
    
    it('should detect double-spending attempts', () => {
      // Crea una transazione
      const transaction = {
        id: '123',
        amount: 100,
        sender: 'sender123',
        recipient: 'recipient456',
        timestamp: Date.now()
      };
      
      // Registra la transazione
      transactionValidator.recordTransaction(transaction);
      
      // Verifica che la stessa transazione venga rilevata come double-spending
      const isDoubleSpend = transactionValidator.isDoubleSpend(transaction);
      expect(isDoubleSpend).to.be.true;
    });
    
    it('should implement secure timestamping', () => {
      // Crea un timestamp sicuro
      const timestamp = transactionValidator.createSecureTimestamp();
      
      // Verifica il timestamp
      const isValid = transactionValidator.verifyTimestamp(timestamp);
      expect(isValid).to.be.true;
      
      // Modifica il timestamp
      const tamperedTimestamp = { ...timestamp, time: timestamp.time - 1000 };
      
      // Verifica che il timestamp modificato non sia valido
      const isTamperedValid = transactionValidator.verifyTimestamp(tamperedTimestamp);
      expect(isTamperedValid).to.be.false;
    });
    
    it('should implement multi-phase validation', async () => {
      // Crea una transazione
      const transaction = {
        id: '123',
        amount: 100,
        sender: 'sender123',
        recipient: 'recipient456',
        timestamp: Date.now()
      };
      
      // Esegui la validazione multi-fase
      const validationResult = await transactionValidator.validateWithdrawal(transaction);
      
      // Verifica che tutte le fasi siano state completate
      expect(validationResult).to.have.property('phase1Passed', true);
      expect(validationResult).to.have.property('phase2Passed', true);
      expect(validationResult).to.have.property('phase3Passed', true);
      expect(validationResult).to.have.property('isValid', true);
    });
  });
  
  describe('Advanced Key Protection', () => {
    let keyManager;
    let hsmIntegration;
    let thresholdSignature;
    
    beforeEach(() => {
      // Importa i moduli necessari
      keyManager = require('../../offchain/key_manager');
      hsmIntegration = require('../../offchain/hsm-integration');
      thresholdSignature = require('../../offchain/threshold-signature');
    });
    
    afterEach(() => {
      sinon.restore();
    });
    
    it('should implement threshold signature scheme', async () => {
      // Crea un gruppo di firme con soglia 2 su 3
      const group = thresholdSignature.createGroup(3, 2);
      
      // Genera le chiavi per ogni partecipante
      const keys = [];
      for (let i = 0; i < 3; i++) {
        keys.push(thresholdSignature.generateKeys(group, i));
      }
      
      // Crea firme parziali
      const message = 'test message';
      const partialSignatures = [
        await thresholdSignature.sign(group, keys[0], message),
        await thresholdSignature.sign(group, keys[1], message)
      ];
      
      // Combina le firme
      const combinedSignature = thresholdSignature.combineSignatures(group, partialSignatures);
      
      // Verifica la firma combinata
      const isValid = thresholdSignature.verify(group, combinedSignature, message);
      expect(isValid).to.be.true;
    });
    
    it('should implement multi-party computation', async () => {
      // Crea un'istanza MPC
      const mpc = require('../../offchain/multi-party-computation');
      
      // Simula un calcolo MPC per la generazione di una chiave
      const parties = 3;
      const result = await mpc.generateKeyMPC(parties);
      
      // Verifica che il risultato contenga le parti della chiave
      expect(result).to.have.property('publicKey');
      expect(result).to.have.property('keyShares');
      expect(result.keyShares).to.have.length(parties);
    });
    
    it('should integrate HSM with multi-signature', async () => {
      // Stub del metodo sign dell'HSM
      const hsmSignStub = sinon.stub(hsmIntegration, 'sign').resolves('hsm_signature');
      
      // Crea una firma multi-sig con HSM
      const message = 'test message';
      const signature = await keyManager.signWithMultiSigHSM(message);
      
      // Verifica che l'HSM sia stato utilizzato
      expect(hsmSignStub.calledOnce).to.be.true;
      expect(hsmSignStub.calledWith(message)).to.be.true;
      
      // Verifica la firma
      const isValid = await keyManager.verifyMultiSigHSM(message, signature);
      expect(isValid).to.be.true;
    });
  });
  
  describe('Database Sharding', () => {
    let databaseManager;
    let shardingStrategy;
    
    beforeEach(() => {
      // Importa i moduli necessari
      databaseManager = require('../../offchain/database-manager');
      shardingStrategy = require('../../offchain/sharding-strategy');
    });
    
    afterEach(() => {
      sinon.restore();
    });
    
    it('should determine correct shard for a given key', () => {
      // Configura la strategia di sharding
      shardingStrategy.configure({
        shardCount: 4,
        strategy: 'hash'
      });
      
      // Determina lo shard per diverse chiavi
      const shard1 = shardingStrategy.getShardForKey('user123');
      const shard2 = shardingStrategy.getShardForKey('user456');
      
      // Verifica che gli shard siano validi
      expect(shard1).to.be.a('number');
      expect(shard1).to.be.at.least(0);
      expect(shard1).to.be.at.most(3);
      
      expect(shard2).to.be.a('number');
      expect(shard2).to.be.at.least(0);
      expect(shard2).to.be.at.most(3);
      
      // La stessa chiave dovrebbe sempre mappare allo stesso shard
      const shard1Again = shardingStrategy.getShardForKey('user123');
      expect(shard1Again).to.equal(shard1);
    });
    
    it('should route queries to correct shards', async () => {
      // Stub del metodo executeQueryOnShard
      const executeQueryOnShardStub = sinon.stub(databaseManager, 'executeQueryOnShard').resolves({ rows: [] });
      
      // Esegui una query con sharding
      await databaseManager.executeShardedQuery('SELECT * FROM users WHERE id = $1', ['user123']);
      
      // Verifica che la query sia stata eseguita sullo shard corretto
      expect(executeQueryOnShardStub.calledOnce).to.be.true;
      const call = executeQueryOnShardStub.getCall(0);
      expect(call.args[0]).to.be.a('number'); // Shard ID
      expect(call.args[1]).to.equal('SELECT * FROM users WHERE id = $1');
      expect(call.args[2]).to.deep.equal(['user123']);
    });
    
    it('should handle cross-shard transactions', async () => {
      // Stub dei metodi necessari
      const beginTransactionStub = sinon.stub(databaseManager, 'beginTransaction').resolves();
      const commitTransactionStub = sinon.stub(databaseManager, 'commitTransaction').resolves();
      const rollbackTransactionStub = sinon.stub(databaseManager, 'rollbackTransaction').resolves();
      const executeQueryOnShardStub = sinon.stub(databaseManager, 'executeQueryOnShard').resolves({ rows: [] });
      
      // Esegui una transazione cross-shard
      await databaseManager.executeCrossShardTransaction([
        { query: 'INSERT INTO users VALUES ($1, $2)', params: ['user123', 'John'] },
        { query: 'INSERT INTO accounts VALUES ($1, $2)', params: ['account456', 100] }
      ]);
      
      // Verifica che la transazione sia stata gestita correttamente
      expect(beginTransactionStub.called).to.be.true;
      expect(executeQueryOnShardStub.called).to.be.true;
      expect(commitTransactionStub.called).to.be.true;
      expect(rollbackTransactionStub.called).to.be.false;
    });
  });
  
  describe('Advanced Logging System', () => {
    let logger;
    let logStorage;
    let alertSystem;
    
    beforeEach(() => {
      // Importa i moduli necessari
      logger = require('../../offchain/logger/logger');
      logStorage = require('../../offchain/logger/log-storage');
      alertSystem = require('../../offchain/logger/alert-system');
    });
    
    afterEach(() => {
      sinon.restore();
    });
    
    it('should log structured data in JSON format', () => {
      // Stub del metodo store
      const storeStub = sinon.stub(logStorage, 'store').resolves();
      
      // Crea un log strutturato
      logger.info('Test message', { user: 'user123', action: 'login' });
      
      // Verifica che il log sia stato memorizzato correttamente
      expect(storeStub.calledOnce).to.be.true;
      const call = storeStub.getCall(0);
      expect(call.args[0]).to.have.property('level', 'info');
      expect(call.args[0]).to.have.property('message', 'Test message');
      expect(call.args[0]).to.have.property('metadata');
      expect(call.args[0].metadata).to.deep.equal({ user: 'user123', action: 'login' });
      expect(call.args[0]).to.have.property('timestamp');
    });
    
    it('should redact sensitive information', () => {
      // Stub del metodo store
      const storeStub = sinon.stub(logStorage, 'store').resolves();
      
      // Crea un log con informazioni sensibili
      logger.info('User logged in', {
        user: 'user123',
        password: 'secret123',
        creditCard: '1234-5678-9012-3456',
        ssn: '123-45-6789'
      });
      
      // Verifica che le informazioni sensibili siano state redatte
      expect(storeStub.calledOnce).to.be.true;
      const call = storeStub.getCall(0);
      expect(call.args[0].metadata).to.have.property('user', 'user123');
      expect(call.args[0].metadata).to.have.property('password', '******');
      expect(call.args[0].metadata).to.have.property('creditCard', '****-****-****-3456');
      expect(call.args[0].metadata).to.have.property('ssn', '***-**-6789');
    });
    
    it('should correlate requests across services', () => {
      // Crea un ID di correlazione
      const correlationId = logger.generateCorrelationId();
      
      // Stub del metodo store
      const storeStub = sinon.stub(logStorage, 'store').resolves();
      
      // Crea log con lo stesso ID di correlazione
      logger.withCorrelationId(correlationId).info('Service A: Request received');
      logger.withCorrelationId(correlationId).info('Service B: Processing request');
      logger.withCorrelationId(correlationId).info('Service C: Request completed');
      
      // Verifica che tutti i log abbiano lo stesso ID di correlazione
      expect(storeStub.callCount).to.equal(3);
      storeStub.getCalls().forEach(call => {
        expect(call.args[0].metadata).to.have.property('correlationId', correlationId);
      });
    });
    
    it('should analyze logs in real-time', async () => {
      // Stub del metodo analyze
      const analyzeStub = sinon.stub(logStorage, 'analyze').resolves({
        errorRate: 0.05,
        averageResponseTime: 150,
        anomalies: []
      });
      
      // Esegui l'analisi in tempo reale
      const result = await logger.analyzeLogsRealTime();
      
      // Verifica che l'analisi sia stata eseguita
      expect(analyzeStub.calledOnce).to.be.true;
      expect(result).to.have.property('errorRate', 0.05);
      expect(result).to.have.property('averageResponseTime', 150);
      expect(result).to.have.property('anomalies').that.is.an('array');
    });
    
    it('should trigger alerts based on log patterns', async () => {
      // Stub del metodo triggerAlert
      const triggerAlertStub = sinon.stub(alertSystem, 'triggerAlert').resolves();
      
      // Simula un pattern di log che dovrebbe attivare un alert
      for (let i = 0; i < 5; i++) {
        logger.error('Authentication failed', { user: 'user123', ip: '192.168.1.1' });
      }
      
      // Verifica che l'alert sia stato attivato
      expect(triggerAlertStub.calledOnce).to.be.true;
      const call = triggerAlertStub.getCall(0);
      expect(call.args[0]).to.have.property('name', 'multiple_auth_failures');
      expect(call.args[0]).to.have.property('severity', 'warning');
      expect(call.args[0]).to.have.property('count', 5);
    });
  });
  
  describe('Real-Time Monitoring System', () => {
    let monitoringSystem;
    let metricsCollector;
    let alertManager;
    
    beforeEach(() => {
      // Crea istanze dei sistemi
      monitoringSystem = new MonitoringSystem();
      metricsCollector = new MetricsCollector({ monitoringSystem });
      alertManager = new AlertManager({ monitoringSystem });
    });
    
    afterEach(() => {
      // Chiudi i sistemi
      monitoringSystem.close();
      metricsCollector.close();
      alertManager.close();
      
      sinon.restore();
    });
    
    it('should collect system metrics', async () => {
      // Stub del metodo set del gauge
      const setStub = sinon.stub(monitoringSystem.gauges.cpuUsage, 'set');
      
      // Raccogli le metriche di sistema
      await metricsCollector._collectSystemMetrics();
      
      // Verifica che le metriche siano state raccolte
      expect(setStub.called).to.be.true;
    });
    
    it('should collect process metrics', () => {
      // Stub del metodo set del gauge
      const setStub = sinon.stub(monitoringSystem.gauges.processMemory, 'set');
      
      // Raccogli le metriche di processo
      metricsCollector._collectProcessMetrics();
      
      // Verifica che le metriche siano state raccolte
      expect(setStub.called).to.be.true;
    });
    
    it('should evaluate alert rules', async () => {
      // Aggiungi una regola di alerting
      alertManager.addRule({
        name: 'high_cpu_usage',
        metric: 'layer2_cpu_usage_percent',
        operator: '>',
        threshold: 80,
        severity: 'warning'
      });
      
      // Stub del metodo getMetrics
      const getMetricsStub = sinon.stub(monitoringSystem, 'getMetrics').resolves([
        {
          name: 'layer2_cpu_usage_percent',
          type: 'gauge',
          values: [{ value: 90 }]
        }
      ]);
      
      // Stub del metodo _notifyAlert
      const notifyAlertStub = sinon.stub(alertManager, '_notifyAlert').resolves();
      
      // Valuta le regole
      await alertManager._evaluateRules();
      
      // Verifica che l'alert sia stato generato
      expect(notifyAlertStub.calledOnce).to.be.true;
      const call = notifyAlertStub.getCall(0);
      expect(call.args[0]).to.have.property('name', 'high_cpu_usage');
      expect(call.args[0]).to.have.property('severity', 'warning');
      expect(call.args[1]).to.equal('new');
    });
    
    it('should send notifications through multiple channels', async () => {
      // Stub dei metodi di notifica
      const notifyConsoleStub = sinon.stub(alertManager, '_notifyConsole').resolves();
      const notifyEmailStub = sinon.stub(alertManager, '_notifyEmail').resolves();
      const notifySlackStub = sinon.stub(alertManager, '_notifySlack').resolves();
      
      // Configura i notificatori
      alertManager.notifiers = {
        console: alertManager._notifyConsole.bind(alertManager),
        email: alertManager._notifyEmail.bind(alertManager),
        slack: alertManager._notifySlack.bind(alertManager)
      };
      
      // Crea un alert
      const alert = {
        id: 'test-alert',
        name: 'high_cpu_usage',
        metric: 'layer2_cpu_usage_percent',
        value: 90,
        threshold: 80,
        operator: '>',
        severity: 'warning',
        message: 'CPU usage is too high',
        timestamp: new Date()
      };
      
      // Notifica l'alert
      await alertManager._notifyAlert(alert, 'new');
      
      // Verifica che le notifiche siano state inviate
      expect(notifyConsoleStub.calledOnce).to.be.true;
      expect(notifyEmailStub.calledOnce).to.be.true;
      expect(notifySlackStub.calledOnce).to.be.true;
    });
  });
});
