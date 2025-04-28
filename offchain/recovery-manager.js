/**
 * Recovery Manager for Solana Layer 2
 * 
 * This module provides a high-level interface for managing the state reconciliation
 * and recovery processes between Layer 1 and Layer 2.
 */

const { StateReconciliation } = require('./state-reconciliation');
const metricsServer = require('./metrics-server');

class RecoveryManager {
  constructor(config = {}) {
    this.config = {
      enableMetrics: true,
      metricsUpdateInterval: 30000, // 30 seconds
      reconciliationInterval: 60000, // 1 minute
      maxReconciliationAttempts: 5,
      circuitBreakerThreshold: 10,
      circuitBreakerResetTime: 300000, // 5 minutes
      solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
      ethereumRpcUrl: process.env.ETHEREUM_RPC_URL || 'https://goerli.infura.io/v3/your-api-key',
      bridgeContractAddress: process.env.BRIDGE_CONTRACT_ADDRESS,
      layer2ProgramId: process.env.LAYER2_PROGRAM_ID,
      ...config
    };
    
    this.stateReconciliation = new StateReconciliation(config);
    this.metricsInterval = null;
    this.isRunning = false;
    this.lastMetricsUpdate = Date.now();
  }
  
  /**
   * Initialize the recovery manager
   */
  async initialize() {
    console.log('Initializing recovery manager');
    
    try {
      await this.stateReconciliation.initialize();
      console.log('Recovery manager initialized successfully');
      return true;
    } catch (error) {
      console.error(`Failed to initialize recovery manager: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Start the recovery manager
   */
  start() {
    if (this.isRunning) {
      console.warn('Recovery manager already running');
      return;
    }
    
    console.log('Starting recovery manager');
    
    this.stateReconciliation.start();
    
    if (this.config.enableMetrics) {
      this.metricsInterval = setInterval(() => {
        this._updateMetrics();
      }, this.config.metricsUpdateInterval);
    }
    
    this.isRunning = true;
  }
  
  /**
   * Stop the recovery manager
   */
  stop() {
    if (!this.isRunning) {
      return;
    }
    
    console.log('Stopping recovery manager');
    
    this.stateReconciliation.stop();
    
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
    
    this.isRunning = false;
  }
  
  /**
   * Get the current status of the recovery manager
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      stateReconciliation: this.stateReconciliation.getStats(),
      lastUpdate: new Date().toISOString(),
      uptime: this.isRunning ? Date.now() - this.lastMetricsUpdate : 0
    };
  }
  
  /**
   * Force a reconciliation cycle
   */
  async forceReconciliation() {
    if (!this.isRunning) {
      console.warn('Recovery manager is not running');
      return false;
    }
    
    console.log('Forcing reconciliation cycle');
    await this.stateReconciliation.performReconciliation();
    return true;
  }
  
  /**
   * Handle a failed transaction
   * @param {Object} transaction The failed transaction
   * @param {string} reason The reason for failure
   */
  async handleFailedTransaction(transaction, reason) {
    console.log(`Handling failed transaction ${transaction.id}: ${reason}`);
    
    try {
      await this.stateReconciliation.addPendingReconciliation({
        type: 'failedTransaction',
        transaction,
        reason,
        timestamp: Date.now()
      });
      
      if (this.config.reconcileOnFailure) {
        await this.forceReconciliation();
      }
      
      return true;
    } catch (error) {
      console.error(`Failed to handle failed transaction: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Update metrics with current recovery status
   */
  _updateMetrics() {
    if (!this.config.enableMetrics) {
      return;
    }
    
    try {
      const stats = this.stateReconciliation.getStats();
      
      metricsServer.updateComponentMetrics('recovery', {
        totalDiscrepancies: stats.totalDiscrepancies,
        resolvedDiscrepancies: stats.resolvedDiscrepancies,
        failedReconciliations: stats.failedReconciliations,
        pendingReconciliations: stats.pendingReconciliations,
        avgReconciliationDuration: stats.avgReconciliationDuration,
        circuitBreakerActive: stats.circuitBreakerActive,
        isReconciling: stats.isReconciling
      });
      
      const successRate = stats.totalDiscrepancies > 0
        ? (stats.resolvedDiscrepancies / stats.totalDiscrepancies) * 100
        : 100;
      
      metricsServer.recordMetric(metricsServer.MetricType.SUCCESS_RATE, successRate);
      
      if (stats.avgReconciliationDuration > 0) {
        metricsServer.recordMetric(
          metricsServer.MetricType.LATENCY, 
          stats.avgReconciliationDuration,
          { component: 'recovery' }
        );
      }
      
      this.lastMetricsUpdate = Date.now();
    } catch (error) {
      console.error(`Failed to update recovery metrics: ${error.message}`);
    }
  }
}

module.exports = { RecoveryManager };
