/**
 * Main entry point for Layer 2 offchain components with recovery system
 * Starts the sequencer, metrics server, and recovery manager
 */

const { UltraOptimizedSequencer } = require('./sequencer');
const metricsServer = require('./metrics-server');
const { RecoveryManager } = require('./recovery-manager');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const snapshotsDir = path.join(dataDir, 'snapshots');
if (!fs.existsSync(snapshotsDir)) {
  fs.mkdirSync(snapshotsDir, { recursive: true });
}

async function main() {
  console.log('Starting Layer 2 offchain components with recovery system');
  
  try {
    await metricsServer.initialize({
      port: process.env.PORT || 3000,
      metricsInterval: 5000, // 5 seconds
      maxHistoricalDatapoints: 1440, // 24 hours at 1 minute intervals
      enablePersistence: true,
      persistenceDir: path.join(dataDir, 'metrics')
    });
    
    console.log(`Metrics server running on port ${process.env.PORT || 3000}`);
  } catch (error) {
    console.error(`Failed to start metrics server: ${error.message}`);
    process.exit(1);
  }
  
  const sequencer = new UltraOptimizedSequencer({
    monitoringEnabled: true,
    metricsInterval: 5000, // 5 seconds
    maxParallelism: process.env.MAX_PARALLELISM || 4,
    priorityLevels: process.env.PRIORITY_LEVELS || 3,
    batchSize: process.env.BATCH_SIZE || 100,
    batchTimeout: process.env.BATCH_TIMEOUT || 5000,
    timelockEnabled: process.env.TIMELOCK_ENABLED === 'true',
    timelockDuration: process.env.TIMELOCK_DURATION || 10000
  });
  
  await sequencer.initialize();
  console.log('Sequencer initialized successfully');
  
  const recoveryManager = new RecoveryManager({
    enableMetrics: true,
    metricsUpdateInterval: 30000, // 30 seconds
    reconciliationInterval: 60000, // 1 minute
    maxReconciliationAttempts: 5,
    circuitBreakerThreshold: 10,
    circuitBreakerResetTime: 300000, // 5 minutes
    solanaRpcUrl: process.env.SOLANA_RPC_URL,
    ethereumRpcUrl: process.env.ETHEREUM_RPC_URL,
    bridgeContractAddress: process.env.BRIDGE_CONTRACT_ADDRESS,
    layer2ProgramId: process.env.LAYER2_PROGRAM_ID,
    snapshotDir: snapshotsDir
  });
  
  try {
    await recoveryManager.initialize();
    recoveryManager.start();
    console.log('Recovery manager started successfully');
  } catch (error) {
    console.error(`Failed to start recovery manager: ${error.message}`);
  }
  
  sequencer.setRecoveryManager(recoveryManager);
  
  console.log(`Layer 2 offchain components running with recovery system`);
  console.log('Use Ctrl+C to stop');
  
  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    
    recoveryManager.stop();
    console.log('Recovery manager stopped');
    
    await sequencer.close();
    console.log('Sequencer stopped');
    
    await metricsServer.shutdown();
    console.log('Metrics server stopped');
    
    process.exit(0);
  });
}

if (typeof UltraOptimizedSequencer.prototype.setRecoveryManager !== 'function') {
  UltraOptimizedSequencer.prototype.setRecoveryManager = function(recoveryManager) {
    this.recoveryManager = recoveryManager;
    
    const originalHandleError = this._handleTransactionError || function() {};
    
    this._handleTransactionError = async function(transaction, error) {
      originalHandleError.call(this, transaction, error);
      
      if (this.recoveryManager) {
        await this.recoveryManager.handleFailedTransaction(transaction, error.message);
      }
    };
    
    console.log('Recovery manager registered with sequencer');
  };
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main };
