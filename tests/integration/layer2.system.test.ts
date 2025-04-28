/**
 * @file layer2.system.test.ts
 * @description Test suite for the Layer2System
 */

import { Layer2System, SystemConfig, SystemStatistics } from '../src/layer2/layer2.system';
import { DatabaseService } from '../src/database/database.service';
import { TransactionService } from '../src/transaction/transaction.service';
import { SequencerService } from '../src/sequencer/sequencer.service';
import { GasOptimizerService } from '../src/utils/gas.optimizer.service';
import { RecoveryService } from '../src/utils/recovery.service';
import { BridgeService } from '../src/bridge/bridge.service';
import { WatchdogService } from '../src/utils/watchdog.service';
import { ConfigService } from '../src/config/config.service';
import { MonitoringService } from '../src/monitoring/monitoring.service';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';

describe('Layer2System', () => {
  let layer2System: Layer2System;
  let databaseServiceStub: sinon.SinonStubbedInstance<DatabaseService>;
  let transactionServiceStub: sinon.SinonStubbedInstance<TransactionService>;
  let sequencerServiceStub: sinon.SinonStubbedInstance<SequencerService>;
  let gasOptimizerServiceStub: sinon.SinonStubbedInstance<GasOptimizerService>;
  let recoveryServiceStub: sinon.SinonStubbedInstance<RecoveryService>;
  let bridgeServiceStub: sinon.SinonStubbedInstance<BridgeService>;
  let watchdogServiceStub: sinon.SinonStubbedInstance<WatchdogService>;
  let configServiceStub: sinon.SinonStubbedInstance<ConfigService>;
  let monitoringServiceStub: sinon.SinonStubbedInstance<MonitoringService>;
  
  beforeEach(() => {
    // Reset the singleton instance before each test
    (Layer2System as any).instance = null;
    
    // Stub all service dependencies
    databaseServiceStub = sinon.createStubInstance(DatabaseService);
    transactionServiceStub = sinon.createStubInstance(TransactionService);
    sequencerServiceStub = sinon.createStubInstance(SequencerService);
    gasOptimizerServiceStub = sinon.createStubInstance(GasOptimizerService);
    recoveryServiceStub = sinon.createStubInstance(RecoveryService);
    bridgeServiceStub = sinon.createStubInstance(BridgeService);
    watchdogServiceStub = sinon.createStubInstance(WatchdogService);
    configServiceStub = sinon.createStubInstance(ConfigService);
    monitoringServiceStub = sinon.createStubInstance(MonitoringService);
    
    // Stub getInstance methods for all services
    sinon.stub(DatabaseService, 'getInstance').returns(databaseServiceStub as unknown as DatabaseService);
    sinon.stub(TransactionService, 'getInstance').returns(transactionServiceStub as unknown as TransactionService);
    sinon.stub(SequencerService, 'getInstance').returns(sequencerServiceStub as unknown as SequencerService);
    sinon.stub(GasOptimizerService, 'getInstance').returns(gasOptimizerServiceStub as unknown as GasOptimizerService);
    sinon.stub(RecoveryService, 'getInstance').returns(recoveryServiceStub as unknown as RecoveryService);
    sinon.stub(BridgeService, 'getInstance').returns(bridgeServiceStub as unknown as BridgeService);
    sinon.stub(WatchdogService, 'getInstance').returns(watchdogServiceStub as unknown as WatchdogService);
    sinon.stub(ConfigService, 'getInstance').returns(configServiceStub as unknown as ConfigService);
    sinon.stub(MonitoringService, 'getInstance').returns(monitoringServiceStub as unknown as MonitoringService);
    
    // Configure default behavior for stubs
    databaseServiceStub.isInitialized.returns(false);
    databaseServiceStub.isConnected.resolves(true);
    databaseServiceStub.getConnectionPoolStats.resolves({ total: 10, idle: 8, active: 2 });
    
    sequencerServiceStub.getCurrentBundle.returns({
      id: uuidv4(),
      transactionCount: 5,
      currentGas: 500000,
      maxGas: 10000000,
      createdAt: new Date(),
      type: 'standard',
      priority: 'medium'
    } as any);
    
    transactionServiceStub.getPendingTransactionCount.resolves(10);
    sequencerServiceStub.getReadyBundleCount.resolves(2);
    sequencerServiceStub.getProcessingBundleCount.resolves(1);
    sequencerServiceStub.getConfirmedBundleCount.resolves(50);
    sequencerServiceStub.getFailedBundleCount.resolves(3);
    
    bridgeServiceStub.getStatus.resolves({ connected: true, lastSyncBlock: 12345 });
    gasOptimizerServiceStub.getCurrentGasPrice.resolves('1500000000');
    
    watchdogServiceStub.getStatus.resolves({ healthy: true, lastHeartbeat: new Date() });
    
    // Get the Layer2System instance
    layer2System = Layer2System.getInstance();
  });
  
  afterEach(() => {
    // Restore the stubs after each test
    sinon.restore();
    
    // Clear any intervals that might have been set
    if ((layer2System as any).processingInterval) {
      clearInterval((layer2System as any).processingInterval);
    }
    if ((layer2System as any).submissionInterval) {
      clearInterval((layer2System as any).submissionInterval);
    }
    if ((layer2System as any).maintenanceInterval) {
      clearInterval((layer2System as any).maintenanceInterval);
    }
    if ((layer2System as any).monitoringInterval) {
      clearInterval((layer2System as any).monitoringInterval);
    }
  });
  
  describe('getInstance', () => {
    it('should return a singleton instance', () => {
      const instance1 = Layer2System.getInstance();
      const instance2 = Layer2System.getInstance();
      
      expect(instance1).to.equal(instance2);
    });
  });
  
  describe('initialize', () => {
    it('should initialize all services', async () => {
      // Execute
      await layer2System.initialize();
      
      // Verify
      expect(databaseServiceStub.initialize.calledOnce).to.be.true;
      expect(sequencerServiceStub.initialize.calledOnce).to.be.true;
      expect(gasOptimizerServiceStub.initialize.calledOnce).to.be.true;
      expect(recoveryServiceStub.initialize.calledOnce).to.be.true;
      expect(bridgeServiceStub.initialize.calledOnce).to.be.true;
      expect(watchdogServiceStub.initialize.calledOnce).to.be.true;
      expect(monitoringServiceStub.initialize.calledOnce).to.be.true;
    });
    
    it('should initialize with custom configuration', async () => {
      // Setup
      const config: Partial<SystemConfig> = {
        processing: {
          enabled: true,
          intervalMs: 10000,
          maxTransactionsPerBatch: 200,
          useMultiThreading: false
        },
        gasOptimization: {
          enabled: false
        }
      };
      
      // Execute
      await layer2System.initialize(config);
      
      // Verify
      expect(databaseServiceStub.initialize.calledOnce).to.be.true;
      
      // Check that config was applied
      const systemConfig = layer2System.getConfig();
      expect(systemConfig.processing.intervalMs).to.equal(10000);
      expect(systemConfig.processing.maxTransactionsPerBatch).to.equal(200);
      expect(systemConfig.processing.useMultiThreading).to.be.false;
      expect(systemConfig.gasOptimization.enabled).to.be.false;
    });
    
    it('should handle initialization errors', async () => {
      // Setup
      databaseServiceStub.initialize.rejects(new Error('Database initialization error'));
      
      // Execute & Verify
      try {
        await layer2System.initialize();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Failed to initialize Layer-2 system');
      }
    });
  });
  
  describe('updateConfig', () => {
    it('should update system configuration', () => {
      // Setup
      const config: Partial<SystemConfig> = {
        processing: {
          enabled: false,
          intervalMs: 15000
        },
        submission: {
          maxBundlesPerSubmission: 10
        }
      };
      
      // Execute
      layer2System.updateConfig(config);
      
      // Verify
      const systemConfig = layer2System.getConfig();
      expect(systemConfig.processing.enabled).to.be.false;
      expect(systemConfig.processing.intervalMs).to.equal(15000);
      expect(systemConfig.submission.maxBundlesPerSubmission).to.equal(10);
      
      // Original values should be preserved
      expect(systemConfig.maintenance.enabled).to.be.true;
    });
    
    it('should reset intervals when system is running', async () => {
      // Setup
      // Start the system
      sinon.stub(layer2System, 'processPendingTransactions').resolves(0);
      sinon.stub(layer2System, 'submitReadyBundles').resolves(0);
      sinon.stub(layer2System, 'performMaintenance').resolves();
      sinon.stub(layer2System, 'collectAndReportMetrics').resolves();
      
      await layer2System.start();
      
      // Update config
      const config: Partial<SystemConfig> = {
        processing: {
          intervalMs: 15000
        }
      };
      
      // Execute
      layer2System.updateConfig(config);
      
      // Verify
      const systemConfig = layer2System.getConfig();
      expect(systemConfig.processing.intervalMs).to.equal(15000);
      
      // Intervals should be reset
      expect((layer2System as any).processingInterval).to.not.be.null;
    });
  });
  
  describe('start', () => {
    it('should start the system and set up intervals', async () => {
      // Setup
      sinon.stub(layer2System, 'processPendingTransactions').resolves(0);
      sinon.stub(layer2System, 'submitReadyBundles').resolves(0);
      sinon.stub(layer2System, 'performMaintenance').resolves();
      sinon.stub(layer2System, 'collectAndReportMetrics').resolves();
      
      // Execute
      await layer2System.start();
      
      // Verify
      expect(layer2System.isSystemRunning()).to.be.true;
      expect(watchdogServiceStub.start.calledOnce).to.be.true;
      expect(monitoringServiceStub.start.calledOnce).to.be.true;
      
      // Intervals should be set
      expect((layer2System as any).processingInterval).to.not.be.null;
      expect((layer2System as any).submissionInterval).to.not.be.null;
      expect((layer2System as any).maintenanceInterval).to.not.be.null;
      expect((layer2System as any).monitoringInterval).to.not.be.null;
    });
    
    it('should initialize system if not already initialized', async () => {
      // Setup
      sinon.stub(layer2System, 'initialize').resolves();
      sinon.stub(layer2System, 'processPendingTransactions').resolves(0);
      sinon.stub(layer2System, 'submitReadyBundles').resolves(0);
      sinon.stub(layer2System, 'performMaintenance').resolves();
      sinon.stub(layer2System, 'collectAndReportMetrics').resolves();
      
      // Execute
      await layer2System.start();
      
      // Verify
      expect(layer2System.initialize).to.have.been.calledOnce;
    });
    
    it('should not start if already running', async () => {
      // Setup
      // Start the system first
      sinon.stub(layer2System, 'processPendingTransactions').resolves(0);
      sinon.stub(layer2System, 'submitReadyBundles').resolves(0);
      sinon.stub(layer2System, 'performMaintenance').resolves();
      sinon.stub(layer2System, 'collectAndReportMetrics').resolves();
      
      await layer2System.start();
      
      // Reset stubs to verify they're not called again
      (layer2System.processPendingTransactions as sinon.SinonStub).resetHistory();
      watchdogServiceStub.start.resetHistory();
      
      // Execute
      await layer2System.start();
      
      // Verify
      expect(watchdogServiceStub.start.called).to.be.false;
    });
    
    it('should handle start errors', async () => {
      // Setup
      watchdogServiceStub.start.rejects(new Error('Watchdog start error'));
      
      // Execute & Verify
      try {
        await layer2System.start();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Failed to start Layer-2 system');
      }
    });
  });
  
  describe('stop', () => {
    it('should stop the system and clear intervals', async () => {
      // Setup
      // Start the system first
      sinon.stub(layer2System, 'processPendingTransactions').resolves(0);
      sinon.stub(layer2System, 'submitReadyBundles').resolves(0);
      sinon.stub(layer2System, 'performMaintenance').resolves();
      sinon.stub(layer2System, 'collectAndReportMetrics').resolves();
      
      await layer2System.start();
      
      // Execute
      await layer2System.stop();
      
      // Verify
      expect(layer2System.isSystemRunning()).to.be.false;
      expect(watchdogServiceStub.stop.calledOnce).to.be.true;
      expect(monitoringServiceStub.stop.calledOnce).to.be.true;
      
      // Intervals should be cleared
      expect((layer2System as any).processingInterval).to.be.null;
      expect((layer2System as any).submissionInterval).to.be.null;
      expect((layer2System as any).maintenanceInterval).to.be.null;
      expect((layer2System as any).monitoringInterval).to.be.null;
    });
    
    it('should not stop if not running', async () => {
      // Execute
      await layer2System.stop();
      
      // Verify
      expect(watchdogServiceStub.stop.called).to.be.false;
    });
    
    it('should handle stop errors', async () => {
      // Setup
      // Start the system first
      sinon.stub(layer2System, 'processPendingTransactions').resolves(0);
      sinon.stub(layer2System, 'submitReadyBundles').resolves(0);
      sinon.stub(layer2System, 'performMaintenance').resolves();
      sinon.stub(layer2System, 'collectAndReportMetrics').resolves();
      
      await layer2System.start();
      
      // Setup error
      watchdogServiceStub.stop.rejects(new Error('Watchdog stop error'));
      
      // Execute & Verify
      try {
        await layer2System.stop();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Failed to stop Layer-2 system');
      }
    });
  });
  
  describe('processPendingTransactions', () => {
    it('should process pending transactions', async () => {
      // Setup
      transactionServiceStub.markExpiredTransactions.resolves(2);
      sequencerServiceStub.processPendingTransactions.resolves(5);
      
      // Execute
      const result = await (layer2System as any).processPendingTransactions();
      
      // Verify
      expect(transactionServiceStub.markExpiredTransactions.calledOnce).to.be.true;
      expect(sequencerServiceStub.processPendingTransactions.calledOnce).to.be.true;
      expect(result).to.equal(5);
    });
    
    it('should finalize bundle if it has enough transactions', async () => {
      // Setup
      const currentBundle = {
        id: uuidv4(),
        transactionCount: 50, // Enough to finalize
        createdAt: new Date(),
        transactions: Array(50).fill({})
      };
      
      sequencerServiceStub.getCurrentBundle.returns(currentBundle as any);
      sequencerServiceStub.processPendingTransactions.resolves(5);
      
      // Set config
      const config: Partial<SystemConfig> = {
        processing: {
          minTransactionsToFinalize: 50
        }
      };
      layer2System.updateConfig(config);
      
      // Execute
      await (layer2System as any).processPendingTransactions();
      
      // Verify
      expect(sequencerServiceStub.finalizeBundle.calledOnce).to.be.true;
    });
    
    it('should finalize bundle if it has been open for too long', async () => {
      // Setup
      const oldDate = new Date();
      oldDate.setTime(oldDate.getTime() - 120000); // 2 minutes ago
      
      const currentBundle = {
        id: uuidv4(),
        transactionCount: 10, // Not enough to finalize normally
        createdAt: oldDate, // But old enough
        transactions: Array(10).fill({})
      };
      
      sequencerServiceStub.getCurrentBundle.returns(currentBundle as any);
      sequencerServiceStub.processPendingTransactions.resolves(5);
      
      // Set config
      const config: Partial<SystemConfig> = {
        processing: {
          minTransactionsToFinalize: 50,
          maxBundleAgeMs: 60000 // 1 minute
        }
      };
      layer2System.updateConfig(config);
      
      // Execute
      await (layer2System as any).processPendingTransactions();
      
      // Verify
      expect(sequencerServiceStub.finalizeBundle.calledOnce).to.be.true;
    });
    
    it('should not finalize empty bundle even if old', async () => {
      // Setup
      const oldDate = new Date();
      oldDate.setTime(oldDate.getTime() - 120000); // 2 minutes ago
      
      const currentBundle = {
        id: uuidv4(),
        transactionCount: 0, // Empty
        createdAt: oldDate, // Old
        transactions: []
      };
      
      sequencerServiceStub.getCurrentBundle.returns(currentBundle as any);
      sequencerServiceStub.processPendingTransactions.resolves(0);
      
      // Set config
      const config: Partial<SystemConfig> = {
        processing: {
          minTransactionsToFinalize: 50,
          maxBundleAgeMs: 60000 // 1 minute
        }
      };
      layer2System.updateConfig(config);
      
      // Execute
      await (layer2System as any).processPendingTransactions();
      
      // Verify
      expect(sequencerServiceStub.finalizeBundle.called).to.be.false;
    });
    
    it('should handle errors during processing', async () => {
      // Setup
      transactionServiceStub.markExpiredTransactions.rejects(new Error('Mark expired error'));
      
      // Execute & Verify
      try {
        await (layer2System as any).processPendingTransactions();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Mark expired error');
      }
    });
  });
  
  describe('submitReadyBundles', () => {
    it('should submit ready bundles', async () => {
      // Setup
      const readyBundles = [
        { id: uuidv4() },
        { id: uuidv4() }
      ];
      
      sequencerServiceStub.getReadyBundles.resolves(readyBundles as any);
      
      // Execute
      const result = await (layer2System as any).submitReadyBundles();
      
      // Verify
      expect(sequencerServiceStub.getReadyBundles.calledOnce).to.be.true;
      expect(sequencerServiceStub.submitBundle.calledTwice).to.be.true;
      expect(result).to.equal(2);
    });
    
    it('should optimize gas price if enabled', async () => {
      // Setup
      const readyBundles = [
        { id: uuidv4() }
      ];
      
      sequencerServiceStub.getReadyBundles.resolves(readyBundles as any);
      
      // Set config
      const config: Partial<SystemConfig> = {
        gasOptimization: {
          enabled: true
        }
      };
      layer2System.updateConfig(config);
      
      // Execute
      await (layer2System as any).submitReadyBundles();
      
      // Verify
      expect(gasOptimizerServiceStub.optimizeBundleGas.calledOnce).to.be.true;
      expect(sequencerServiceStub.submitBundle.calledOnce).to.be.true;
    });
    
    it('should return 0 if no ready bundles', async () => {
      // Setup
      sequencerServiceStub.getReadyBundles.resolves([]);
      
      // Execute
      const result = await (layer2System as any).submitReadyBundles();
      
      // Verify
      expect(sequencerServiceStub.getReadyBundles.calledOnce).to.be.true;
      expect(sequencerServiceStub.submitBundle.called).to.be.false;
      expect(result).to.equal(0);
    });
    
    it('should continue with next bundle if one fails', async () => {
      // Setup
      const readyBundles = [
        { id: uuidv4() },
        { id: uuidv4() }
      ];
      
      sequencerServiceStub.getReadyBundles.resolves(readyBundles as any);
      
      // First bundle submission fails
      sequencerServiceStub.submitBundle.onFirstCall().rejects(new Error('Submission error'));
      sequencerServiceStub.submitBundle.onSecondCall().resolves({} as any);
      
      // Execute
      const result = await (layer2System as any).submitReadyBundles();
      
      // Verify
      expect(sequencerServiceStub.submitBundle.calledTwice).to.be.true;
      expect(result).to.equal(1); // Only one succeeded
    });
  });
  
  describe('performMaintenance', () => {
    it('should perform maintenance tasks', async () => {
      // Execute
      await (layer2System as any).performMaintenance();
      
      // Verify
      expect(transactionServiceStub.markExpiredTransactions.calledOnce).to.be.true;
      expect(sequencerServiceStub.markExpiredBundles.calledOnce).to.be.true;
      expect(bridgeServiceStub.performMaintenance.calledOnce).to.be.true;
      expect(databaseServiceStub.performMaintenance.calledOnce).to.be.true;
    });
    
    it('should run recovery checks if enabled', async () => {
      // Set config
      const config: Partial<SystemConfig> = {
        recovery: {
          enabled: true,
          maxStuckTimeMs: 300000,
          autoAbortEnabled: true
        }
      };
      layer2System.updateConfig(config);
      
      // Execute
      await (layer2System as any).performMaintenance();
      
      // Verify
      expect(recoveryServiceStub.checkStuckTransactions.calledOnce).to.be.true;
      expect(recoveryServiceStub.checkStuckBundles.calledOnce).to.be.true;
      expect(recoveryServiceStub.autoAbortStuckBundles.calledOnce).to.be.true;
    });
    
    it('should clean up old data if enabled', async () => {
      // Set config
      const config: Partial<SystemConfig> = {
        maintenance: {
          cleanupEnabled: true,
          dataRetentionDays: 15
        }
      };
      layer2System.updateConfig(config);
      
      // Execute
      await (layer2System as any).performMaintenance();
      
      // Verify
      expect(transactionServiceStub.cleanupOldTransactions.calledOnce).to.be.true;
      expect(transactionServiceStub.cleanupOldTransactions.calledWith(15)).to.be.true;
      expect(sequencerServiceStub.cleanupOldBundles.calledOnce).to.be.true;
      expect(sequencerServiceStub.cleanupOldBundles.calledWith(15)).to.be.true;
    });
  });
  
  describe('collectAndReportMetrics', () => {
    it('should collect and report metrics if monitoring is enabled', async () => {
      // Setup
      transactionServiceStub.getTransactionStatistics.resolves({} as any);
      sequencerServiceStub.getBundleStatistics.resolves({} as any);
      monitoringServiceStub.getErrorsByHour.resolves([]);
      monitoringServiceStub.getMostFrequentErrors.resolves([]);
      
      // Set config
      const config: Partial<SystemConfig> = {
        monitoring: {
          enabled: true,
          alertingEnabled: true
        }
      };
      layer2System.updateConfig(config);
      
      // Execute
      await (layer2System as any).collectAndReportMetrics();
      
      // Verify
      expect(transactionServiceStub.getTransactionStatistics.calledOnce).to.be.true;
      expect(sequencerServiceStub.getBundleStatistics.calledOnce).to.be.true;
      expect(monitoringServiceStub.reportMetrics.calledOnce).to.be.true;
      expect(monitoringServiceStub.checkAlerts.calledOnce).to.be.true;
    });
    
    it('should not collect metrics if monitoring is disabled', async () => {
      // Set config
      const config: Partial<SystemConfig> = {
        monitoring: {
          enabled: false
        }
      };
      layer2System.updateConfig(config);
      
      // Execute
      await (layer2System as any).collectAndReportMetrics();
      
      // Verify
      expect(transactionServiceStub.getTransactionStatistics.called).to.be.false;
      expect(monitoringServiceStub.reportMetrics.called).to.be.false;
    });
  });
  
  describe('getStatus', () => {
    it('should return system status', async () => {
      // Execute
      const status = await layer2System.getStatus();
      
      // Verify
      expect(status).to.exist;
      expect(status).to.have.property('isRunning');
      expect(status).to.have.property('currentBundle');
      expect(status).to.have.property('pendingTransactionCount', 10);
      expect(status).to.have.property('readyBundleCount', 2);
      expect(status).to.have.property('processingBundleCount', 1);
      expect(status).to.have.property('confirmedBundleCount', 50);
      expect(status).to.have.property('failedBundleCount', 3);
      expect(status).to.have.property('bridgeStatus');
      expect(status).to.have.property('gasPrice', '1500000000');
      expect(status).to.have.property('performanceMetrics');
      expect(status).to.have.property('config');
    });
    
    it('should handle errors during status retrieval', async () => {
      // Setup
      transactionServiceStub.getPendingTransactionCount.rejects(new Error('Database error'));
      
      // Execute & Verify
      try {
        await layer2System.getStatus();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Failed to get system status');
      }
    });
  });
  
  describe('getHealth', () => {
    it('should return healthy status when all components are healthy', async () => {
      // Execute
      const health = await layer2System.getHealth();
      
      // Verify
      expect(health).to.exist;
      expect(health).to.have.property('status', 'healthy');
      expect(health.components).to.have.property('database');
      expect(health.components).to.have.property('watchdog');
      expect(health.components).to.have.property('bridge');
      expect(health.components).to.have.property('workers');
      expect(health.components).to.have.property('errors');
      expect(health.components).to.have.property('processing');
      expect(health.components).to.have.property('submission');
    });
    
    it('should return unhealthy status when database is disconnected', async () => {
      // Setup
      databaseServiceStub.isConnected.resolves(false);
      
      // Execute
      const health = await layer2System.getHealth();
      
      // Verify
      expect(health).to.have.property('status', 'unhealthy');
      expect(health.components.database.connected).to.be.false;
    });
    
    it('should return unhealthy status when watchdog is unhealthy', async () => {
      // Setup
      watchdogServiceStub.getStatus.resolves({ healthy: false, lastHeartbeat: new Date() });
      
      // Execute
      const health = await layer2System.getHealth();
      
      // Verify
      expect(health).to.have.property('status', 'unhealthy');
      expect(health.components.watchdog.healthy).to.be.false;
    });
    
    it('should return unhealthy status when bridge is disconnected', async () => {
      // Setup
      bridgeServiceStub.isConnected.resolves(false);
      
      // Execute
      const health = await layer2System.getHealth();
      
      // Verify
      expect(health).to.have.property('status', 'unhealthy');
      expect(health.components.bridge.connected).to.be.false;
    });
    
    it('should handle errors during health check', async () => {
      // Setup
      databaseServiceStub.isConnected.rejects(new Error('Database error'));
      
      // Execute
      const health = await layer2System.getHealth();
      
      // Verify
      expect(health).to.have.property('status', 'unhealthy');
      expect(health).to.have.property('error');
    });
  });
  
  describe('getStatistics', () => {
    it('should return system statistics', async () => {
      // Setup
      transactionServiceStub.getTransactionStatistics.resolves({
        totalCount: 1000,
        pendingCount: 10,
        bundledCount: 20,
        confirmedCount: 950,
        failedCount: 15,
        expiredCount: 5,
        averageConfirmationTime: 15.5,
        averageFee: '1500000000',
        transactionsByType: {},
        transactionsByHour: []
      } as any);
      
      sequencerServiceStub.getBundleStatistics.resolves({
        totalCount: 100,
        pendingCount: 1,
        readyCount: 2,
        processingCount: 1,
        submittingCount: 0,
        confirmedCount: 90,
        failedCount: 5,
        expiredCount: 1,
        abortedCount: 1,
        averageConfirmationTime: 30.2,
        averageTransactionsPerBundle: 10,
        averageGasPerBundle: 1000000,
        totalFeesCollected: '150000000000',
        bundlesByType: {},
        bundlesByPriority: {},
        bundlesByHour: [],
        successRate: 90
      } as any);
      
      databaseServiceStub.getConnectionPoolStats.resolves({ total: 10, idle: 8, active: 2 });
      monitoringServiceStub.getErrorsByHour.resolves([]);
      monitoringServiceStub.getMostFrequentErrors.resolves([]);
      
      // Execute
      const stats = await layer2System.getStatistics(true);
      
      // Verify
      expect(stats).to.exist;
      expect(stats).to.have.property('transactionStats');
      expect(stats).to.have.property('bundleStats');
      expect(stats).to.have.property('performanceMetrics');
      expect(stats).to.have.property('errorStats');
      
      expect(stats.transactionStats.totalCount).to.equal(1000);
      expect(stats.bundleStats.totalCount).to.equal(100);
      expect(stats.performanceMetrics).to.have.property('cpuUsage');
      expect(stats.performanceMetrics).to.have.property('memoryUsage');
      expect(stats.performanceMetrics).to.have.property('uptime');
      expect(stats.performanceMetrics).to.have.property('databaseConnectionPool');
      expect(stats.errorStats).to.have.property('totalErrors');
      expect(stats.errorStats).to.have.property('errorsByType');
    });
    
    it('should handle errors during statistics retrieval', async () => {
      // Setup
      transactionServiceStub.getTransactionStatistics.rejects(new Error('Statistics error'));
      
      // Execute & Verify
      try {
        await layer2System.getStatistics();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Failed to get system statistics');
      }
    });
  });
  
  describe('utility methods', () => {
    it('should return system ID', () => {
      const systemId = layer2System.getSystemId();
      expect(systemId).to.be.a('string');
      expect(systemId.length).to.be.greaterThan(0);
    });
    
    it('should return uptime', () => {
      // Setup
      (layer2System as any).startTime = new Date(Date.now() - 60000); // 1 minute ago
      
      // Execute
      const uptime = layer2System.getUptime();
      
      // Verify
      expect(uptime).to.be.closeTo(60, 5); // Within 5 seconds of 60
    });
    
    it('should return 0 uptime if not started', () => {
      // Setup
      (layer2System as any).startTime = null;
      
      // Execute
      const uptime = layer2System.getUptime();
      
      // Verify
      expect(uptime).to.equal(0);
    });
    
    it('should calculate transactions per second', () => {
      // Setup
      (layer2System as any).startTime = new Date(Date.now() - 60000); // 1 minute ago
      (layer2System as any).transactionsProcessedCounter = 600; // 10 TPS
      
      // Execute
      const tps = (layer2System as any).calculateTransactionsPerSecond();
      
      // Verify
      expect(tps).to.be.closeTo(10, 1); // Within 1 TPS of 10
    });
    
    it('should calculate bundles per hour', () => {
      // Setup
      (layer2System as any).startTime = new Date(Date.now() - 3600000); // 1 hour ago
      (layer2System as any).bundlesSubmittedCounter = 30; // 30 BPH
      
      // Execute
      const bph = (layer2System as any).calculateBundlesPerHour();
      
      // Verify
      expect(bph).to.be.closeTo(30, 3); // Within 3 BPH of 30
    });
  });
  
  describe('stress tests', () => {
    it('should handle high transaction volume', async () => {
      // Setup
      const highVolumeConfig: Partial<SystemConfig> = {
        processing: {
          maxTransactionsPerBatch: 1000,
          useMultiThreading: true,
          maxWorkers: 4
        }
      };
      
      // Initialize with high volume config
      await layer2System.initialize(highVolumeConfig);
      
      // Simulate high transaction volume
      transactionServiceStub.getPendingTransactionCount.resolves(5000);
      sequencerServiceStub.processPendingTransactions.resolves(1000);
      
      // Execute
      const result = await (layer2System as any).processPendingTransactions();
      
      // Verify
      expect(result).to.equal(1000);
      expect(sequencerServiceStub.processPendingTransactions.calledWith(1000)).to.be.true;
    });
    
    it('should handle multiple bundle submissions simultaneously', async () => {
      // Setup
      const readyBundles = Array(20).fill(null).map(() => ({ id: uuidv4() }));
      
      sequencerServiceStub.getReadyBundles.resolves(readyBundles as any);
      
      // Set config for high volume
      const config: Partial<SystemConfig> = {
        submission: {
          maxBundlesPerSubmission: 20
        }
      };
      layer2System.updateConfig(config);
      
      // Execute
      const result = await (layer2System as any).submitReadyBundles();
      
      // Verify
      expect(sequencerServiceStub.submitBundle.callCount).to.equal(20);
      expect(result).to.equal(20);
    });
    
    it('should recover from database connection issues', async () => {
      // Setup
      // First check fails, second succeeds
      databaseServiceStub.isConnected.onFirstCall().resolves(false);
      databaseServiceStub.isConnected.onSecondCall().resolves(true);
      
      // Execute
      const health1 = await layer2System.getHealth();
      const health2 = await layer2System.getHealth();
      
      // Verify
      expect(health1.status).to.equal('unhealthy');
      expect(health2.status).to.equal('healthy');
    });
    
    it('should handle error spikes', async () => {
      // Setup
      // Simulate error spike
      for (let i = 0; i < 100; i++) {
        (layer2System as any).incrementErrorCounter('test_error');
      }
      
      monitoringServiceStub.getErrorsByHour.resolves([{ hour: new Date(), count: 100 }]);
      monitoringServiceStub.getMostFrequentErrors.resolves([{ message: 'test_error', count: 100 }]);
      
      // Execute
      const stats = await layer2System.getStatistics();
      
      // Verify
      expect(stats.errorStats.totalErrors).to.be.at.least(100);
      expect(stats.errorStats.errorsByType).to.have.property('test_error', 100);
    });
  });
});
