const { expect } = require('chai');
const sinon = require('sinon');
const { Layer2SolanaClient } = require('../src/client');
const { Account } = require('../src/account');
const { Transaction } = require('../src/transaction');
const { BridgeService } = require('../src/bridge');
const { PhantomWallet } = require('../src/wallet/phantom');
const { MetamaskWallet } = require('../src/wallet/metamask');
const { initializeLogging } = require('../src/logging');
const { initializeMonitoring } = require('../src/monitoring');

describe('Layer-2 Solana SDK Integration Tests', function() {
  this.timeout(10000); // Alcuni test potrebbero richiedere più tempo
  
  let client;
  let account;
  let bridgeService;
  let phantomWallet;
  let metamaskWallet;
  let logging;
  let monitoring;
  
  before(async function() {
    // Inizializza il logging con output solo su console per i test
    logging = initializeLogging({
      level: 'error', // Riduci il livello di log durante i test
      service: 'layer2-solana-test',
      console: true,
      file: false
    });
    
    // Inizializza il monitoraggio ma non avviarlo automaticamente
    monitoring = initializeMonitoring({
      logger: logging.logger,
      autoStart: false,
      metrics: {
        collectionInterval: 5000 // Intervallo più breve per i test
      }
    });
    
    // Crea un account di test
    account = new Account({
      privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', // Chiave di test
      logger: logging.logger
    });
    
    // Crea stub per i wallet
    phantomWallet = new PhantomWallet({
      logger: logging.logger
    });
    
    metamaskWallet = new MetamaskWallet({
      logger: logging.logger
    });
    
    // Stub dei metodi dei wallet
    sinon.stub(phantomWallet, 'connect').resolves({
      publicKey: 'phantom-public-key',
      connected: true
    });
    
    sinon.stub(metamaskWallet, 'connect').resolves({
      address: '0xmetamask-address',
      connected: true
    });
    
    // Crea il bridge service
    bridgeService = new BridgeService({
      logger: logging.logger,
      l1Provider: 'http://localhost:8545', // URL di test
      l2Provider: 'http://localhost:8899'  // URL di test
    });
    
    // Stub dei metodi del bridge
    sinon.stub(bridgeService, 'deposit').resolves({
      txHash: 'deposit-tx-hash',
      status: 'success'
    });
    
    sinon.stub(bridgeService, 'withdraw').resolves({
      txHash: 'withdraw-tx-hash',
      status: 'success'
    });
    
    // Crea il client principale
    client = new Layer2SolanaClient({
      logger: logging.logger,
      l1Provider: 'http://localhost:8545', // URL di test
      l2Provider: 'http://localhost:8899', // URL di test
      bridge: bridgeService
    });
  });
  
  after(function() {
    // Ripristina tutti gli stub
    sinon.restore();
  });
  
  describe('Client Initialization', function() {
    it('should initialize the client with correct configuration', function() {
      expect(client).to.be.an('object');
      expect(client.l1Provider).to.equal('http://localhost:8545');
      expect(client.l2Provider).to.equal('http://localhost:8899');
      expect(client.bridge).to.equal(bridgeService);
    });
    
    it('should have access to the logger', function() {
      expect(client.logger).to.exist;
      expect(typeof client.logger.info).to.equal('function');
    });
  });
  
  describe('Account Management', function() {
    it('should create an account from private key', function() {
      expect(account).to.be.an('object');
      expect(account.privateKey).to.equal('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
      expect(account.publicKey).to.exist;
    });
    
    it('should generate a new account when no private key is provided', function() {
      const newAccount = new Account({
        logger: logging.logger
      });
      
      expect(newAccount).to.be.an('object');
      expect(newAccount.privateKey).to.exist;
      expect(newAccount.publicKey).to.exist;
    });
  });
  
  describe('Wallet Integration', function() {
    it('should connect to Phantom wallet', async function() {
      const result = await phantomWallet.connect();
      
      expect(result.connected).to.be.true;
      expect(result.publicKey).to.equal('phantom-public-key');
      expect(phantomWallet.connect.calledOnce).to.be.true;
    });
    
    it('should connect to Metamask wallet', async function() {
      const result = await metamaskWallet.connect();
      
      expect(result.connected).to.be.true;
      expect(result.address).to.equal('0xmetamask-address');
      expect(metamaskWallet.connect.calledOnce).to.be.true;
    });
  });
  
  describe('Bridge Operations', function() {
    it('should deposit from L1 to L2', async function() {
      const result = await bridgeService.deposit({
        token: 'ETH',
        amount: '1.0',
        sender: account.publicKey,
        recipient: account.publicKey
      });
      
      expect(result.status).to.equal('success');
      expect(result.txHash).to.equal('deposit-tx-hash');
      expect(bridgeService.deposit.calledOnce).to.be.true;
    });
    
    it('should withdraw from L2 to L1', async function() {
      const result = await bridgeService.withdraw({
        token: 'ETH',
        amount: '0.5',
        sender: account.publicKey,
        recipient: '0xmetamask-address'
      });
      
      expect(result.status).to.equal('success');
      expect(result.txHash).to.equal('withdraw-tx-hash');
      expect(bridgeService.withdraw.calledOnce).to.be.true;
    });
  });
  
  describe('Transaction Handling', function() {
    it('should create and sign a transaction', function() {
      const tx = new Transaction({
        from: account.publicKey,
        to: 'destination-address',
        value: '1.0',
        data: '0x',
        logger: logging.logger
      });
      
      const signedTx = tx.sign(account);
      
      expect(tx).to.be.an('object');
      expect(tx.from).to.equal(account.publicKey);
      expect(tx.to).to.equal('destination-address');
      expect(tx.value).to.equal('1.0');
      expect(signedTx).to.exist;
      expect(signedTx.signature).to.exist;
    });
  });
  
  describe('Monitoring and Logging', function() {
    it('should initialize monitoring system', function() {
      expect(monitoring).to.be.an('object');
      expect(monitoring.metricsCollector).to.exist;
      expect(monitoring.performanceMonitor).to.exist;
      expect(monitoring.alertManager).to.exist;
    });
    
    it('should collect system metrics', function() {
      const metrics = monitoring.metricsCollector.collectSystemMetrics();
      
      expect(metrics).to.be.an('object');
      expect(metrics.cpu).to.exist;
      expect(metrics.memory).to.exist;
      expect(metrics.process).to.exist;
    });
    
    it('should record operation metrics', function() {
      const opMetrics = monitoring.metricsCollector.recordOperation(
        'test-operation',
        100, // 100ms
        true, // success
        { test: 'metadata' }
      );
      
      expect(opMetrics).to.be.an('object');
      expect(opMetrics.count).to.equal(1);
      expect(opMetrics.successCount).to.equal(1);
      expect(opMetrics.totalDuration).to.equal(100);
      expect(opMetrics.avgDuration).to.equal(100);
    });
    
    it('should format metrics in Prometheus format', function() {
      const prometheusMetrics = monitoring.metricsExporter.getPrometheusMetrics();
      
      expect(prometheusMetrics).to.be.a('string');
      expect(prometheusMetrics).to.include('# HELP');
      expect(prometheusMetrics).to.include('# TYPE');
    });
  });
  
  describe('End-to-End Flow', function() {
    it('should perform a complete deposit-withdraw cycle', async function() {
      // 1. Deposit da L1 a L2
      const depositResult = await client.bridge.deposit({
        token: 'ETH',
        amount: '1.0',
        sender: account.publicKey,
        recipient: account.publicKey
      });
      
      expect(depositResult.status).to.equal('success');
      
      // 2. Esegui una transazione su L2
      const tx = new Transaction({
        from: account.publicKey,
        to: 'destination-address',
        value: '0.1',
        data: '0x',
        logger: logging.logger
      });
      
      const signedTx = tx.sign(account);
      
      // Stub per l'invio della transazione
      const sendTransactionStub = sinon.stub(client, 'sendTransaction').resolves({
        txHash: 'l2-tx-hash',
        status: 'success'
      });
      
      const txResult = await client.sendTransaction(signedTx);
      
      expect(txResult.status).to.equal('success');
      expect(sendTransactionStub.calledOnce).to.be.true;
      
      // 3. Prelievo da L2 a L1
      const withdrawResult = await client.bridge.withdraw({
        token: 'ETH',
        amount: '0.5',
        sender: account.publicKey,
        recipient: '0xmetamask-address'
      });
      
      expect(withdrawResult.status).to.equal('success');
      
      // Ripristina lo stub
      sendTransactionStub.restore();
    });
  });
});
