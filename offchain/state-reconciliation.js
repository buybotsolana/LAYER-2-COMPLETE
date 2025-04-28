/**
 * State Reconciliation Module for Solana Layer 2
 * 
 * This module is responsible for detecting and resolving discrepancies between
 * Layer 1 and Layer 2 states, with particular focus on handling failed transactions.
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const MAX_RECONCILIATION_ATTEMPTS = 5;
const RECONCILIATION_INTERVAL = 60000; // 1 minute
const CIRCUIT_BREAKER_THRESHOLD = 10; // Number of consecutive failures to trigger circuit breaker
const CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
const SNAPSHOT_INTERVAL = 3600000; // 1 hour
const MAX_SNAPSHOTS = 24; // Keep 24 hours of snapshots

class StateReconciliation {
  constructor(config = {}) {
    this.config = {
      solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
      ethereumRpcUrl: process.env.ETHEREUM_RPC_URL || 'https://goerli.infura.io/v3/your-api-key',
      bridgeContractAddress: process.env.BRIDGE_CONTRACT_ADDRESS,
      layer2ProgramId: process.env.LAYER2_PROGRAM_ID,
      reconciliationInterval: RECONCILIATION_INTERVAL,
      maxReconciliationAttempts: MAX_RECONCILIATION_ATTEMPTS,
      circuitBreakerThreshold: CIRCUIT_BREAKER_THRESHOLD,
      circuitBreakerResetTime: CIRCUIT_BREAKER_RESET_TIME,
      snapshotInterval: SNAPSHOT_INTERVAL,
      maxSnapshots: MAX_SNAPSHOTS,
      snapshotDir: path.join(__dirname, '../data/snapshots'),
      ...config
    };
    
    this.solanaConnection = null;
    this.ethereumProvider = null;
    this.bridgeContract = null;
    this.layer2ProgramId = null;
    
    this.reconciliationInterval = null;
    this.snapshotInterval = null;
    this.isReconciling = false;
    this.circuitBreakerActive = false;
    this.consecutiveFailures = 0;
    
    this.stats = {
      totalDiscrepancies: 0,
      resolvedDiscrepancies: 0,
      failedReconciliations: 0,
      pendingReconciliations: 0,
      lastReconciliationTime: null,
      avgReconciliationDuration: 0,
      totalReconciliationTime: 0,
      reconciliationCount: 0
    };
    
    this.pendingReconciliations = new Map();
    this.processedTransactions = new Set();
  }
  
  /**
   * Initialize the state reconciliation module
   */
  async initialize() {
    console.log('Initializing state reconciliation module');
    
    try {
      this.solanaConnection = new Connection(this.config.solanaRpcUrl);
      
      this.layer2ProgramId = new PublicKey(this.config.layer2ProgramId);
      
      
      if (!fs.existsSync(this.config.snapshotDir)) {
        fs.mkdirSync(this.config.snapshotDir, { recursive: true });
      }
      
      await this._loadLatestSnapshot();
      
      console.log('State reconciliation module initialized successfully');
      return true;
    } catch (error) {
      console.error(`Failed to initialize state reconciliation: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Start the reconciliation process
   */
  start() {
    if (this.reconciliationInterval) {
      console.warn('Reconciliation already running');
      return;
    }
    
    console.log('Starting state reconciliation');
    
    this.reconciliationInterval = setInterval(async () => {
      if (this.isReconciling || this.circuitBreakerActive) {
        return;
      }
      
      try {
        await this.performReconciliation();
      } catch (error) {
        console.error(`Error during scheduled reconciliation: ${error.message}`);
        this._incrementFailureCounter();
      }
    }, this.config.reconciliationInterval);
    
    this.snapshotInterval = setInterval(async () => {
      try {
        await this._createStateSnapshot();
      } catch (error) {
        console.error(`Error creating state snapshot: ${error.message}`);
      }
    }, this.config.snapshotInterval);
  }
  
  /**
   * Stop the reconciliation process
   */
  stop() {
    console.log('Stopping state reconciliation');
    
    if (this.reconciliationInterval) {
      clearInterval(this.reconciliationInterval);
      this.reconciliationInterval = null;
    }
    
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }
  }
  
  /**
   * Perform a reconciliation cycle
   */
  async performReconciliation() {
    if (this.isReconciling) {
      console.warn('Reconciliation already in progress');
      return;
    }
    
    if (this.circuitBreakerActive) {
      console.warn('Circuit breaker active, skipping reconciliation');
      return;
    }
    
    this.isReconciling = true;
    const startTime = Date.now();
    
    try {
      console.log('Starting reconciliation cycle');
      
      const layer1State = await this._getLayer1State();
      
      const layer2State = await this._getLayer2State();
      
      const discrepancies = this._findDiscrepancies(layer1State, layer2State);
      
      const results = await this._resolveDiscrepancies(discrepancies);
      
      this._updateStats(results, startTime);
      
      this.consecutiveFailures = 0;
      
      console.log(`Reconciliation completed: ${results.resolved} resolved, ${results.failed} failed, ${results.pending} pending`);
    } catch (error) {
      console.error(`Reconciliation failed: ${error.message}`);
      this._incrementFailureCounter();
      this.stats.failedReconciliations++;
    } finally {
      this.isReconciling = false;
      this.stats.lastReconciliationTime = new Date().toISOString();
    }
  }
  
  /**
   * Get current statistics
   */
  getStats() {
    return {
      ...this.stats,
      pendingReconciliations: this.pendingReconciliations.size,
      processedTransactions: this.processedTransactions.size,
      circuitBreakerActive: this.circuitBreakerActive,
      isReconciling: this.isReconciling
    };
  }
  
  /**
   * Get Layer 1 state from Solana
   */
  async _getLayer1State() {
    console.log('Fetching Layer 1 state');
    
    try {
      const accounts = await this.solanaConnection.getProgramAccounts(this.layer2ProgramId);
      
      const state = {
        batches: [],
        transactions: [],
        challenges: [],
        deposits: [],
        withdrawals: []
      };
      
      for (const { pubkey, account } of accounts) {
        
        const data = account.data;
        
        if (data.length > 1000) {
          state.batches.push({ pubkey: pubkey.toString(), data });
        } else if (data.length > 500) {
          state.transactions.push({ pubkey: pubkey.toString(), data });
        } else if (data.length > 200) {
          state.challenges.push({ pubkey: pubkey.toString(), data });
        } else if (data.length > 100) {
          state.deposits.push({ pubkey: pubkey.toString(), data });
        } else {
          state.withdrawals.push({ pubkey: pubkey.toString(), data });
        }
      }
      
      return state;
    } catch (error) {
      console.error(`Error fetching Layer 1 state: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get Layer 2 state from the off-chain database
   */
  async _getLayer2State() {
    console.log('Fetching Layer 2 state');
    
    try {
      
      return {
        batches: [],
        transactions: [],
        challenges: [],
        deposits: [],
        withdrawals: []
      };
    } catch (error) {
      console.error(`Error fetching Layer 2 state: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Find discrepancies between Layer 1 and Layer 2 states
   */
  _findDiscrepancies(layer1State, layer2State) {
    console.log('Finding discrepancies between Layer 1 and Layer 2 states');
    
    const discrepancies = {
      missingFromLayer1: {
        batches: [],
        transactions: [],
        deposits: [],
        withdrawals: []
      },
      missingFromLayer2: {
        batches: [],
        transactions: [],
        deposits: [],
        withdrawals: []
      },
      inconsistent: {
        batches: [],
        transactions: [],
        deposits: [],
        withdrawals: []
      }
    };
    
    
    return discrepancies;
  }
  
  /**
   * Resolve discrepancies between Layer 1 and Layer 2 states
   */
  async _resolveDiscrepancies(discrepancies) {
    console.log('Resolving discrepancies');
    
    const results = {
      resolved: 0,
      failed: 0,
      pending: 0
    };
    
    for (const category of ['batches', 'transactions', 'deposits', 'withdrawals']) {
      for (const item of discrepancies.missingFromLayer1[category]) {
        try {
          await this._submitToLayer1(category, item);
          results.resolved++;
        } catch (error) {
          console.error(`Failed to submit ${category} to Layer 1: ${error.message}`);
          
          const id = `${category}-${item.id}`;
          if (!this.pendingReconciliations.has(id)) {
            this.pendingReconciliations.set(id, {
              type: 'submitToLayer1',
              category,
              item,
              attempts: 1,
              lastAttempt: Date.now()
            });
            results.pending++;
          } else {
            results.failed++;
          }
        }
      }
    }
    
    for (const category of ['batches', 'transactions', 'deposits', 'withdrawals']) {
      for (const item of discrepancies.missingFromLayer2[category]) {
        try {
          await this._addToLayer2(category, item);
          results.resolved++;
        } catch (error) {
          console.error(`Failed to add ${category} to Layer 2: ${error.message}`);
          
          const id = `${category}-${item.id}`;
          if (!this.pendingReconciliations.has(id)) {
            this.pendingReconciliations.set(id, {
              type: 'addToLayer2',
              category,
              item,
              attempts: 1,
              lastAttempt: Date.now()
            });
            results.pending++;
          } else {
            results.failed++;
          }
        }
      }
    }
    
    for (const category of ['batches', 'transactions', 'deposits', 'withdrawals']) {
      for (const item of discrepancies.inconsistent[category]) {
        try {
          await this._updateItem(category, item);
          results.resolved++;
        } catch (error) {
          console.error(`Failed to update ${category}: ${error.message}`);
          
          const id = `${category}-${item.id}`;
          if (!this.pendingReconciliations.has(id)) {
            this.pendingReconciliations.set(id, {
              type: 'updateItem',
              category,
              item,
              attempts: 1,
              lastAttempt: Date.now()
            });
            results.pending++;
          } else {
            results.failed++;
          }
        }
      }
    }
    
    await this._processPendingReconciliations();
    
    return results;
  }
  
  /**
   * Process pending reconciliations
   */
  async _processPendingReconciliations() {
    console.log(`Processing ${this.pendingReconciliations.size} pending reconciliations`);
    
    const maxAttempts = this.config.maxReconciliationAttempts;
    const now = Date.now();
    
    for (const [id, reconciliation] of this.pendingReconciliations.entries()) {
      if (reconciliation.attempts >= maxAttempts) {
        console.warn(`Reconciliation ${id} exceeded max attempts (${maxAttempts}), removing from queue`);
        this.pendingReconciliations.delete(id);
        this.stats.failedReconciliations++;
        continue;
      }
      
      const backoffTime = Math.pow(2, reconciliation.attempts) * 1000; // Exponential backoff
      
      if (now - reconciliation.lastAttempt < backoffTime) {
        continue;
      }
      
      try {
        let success = false;
        
        if (reconciliation.type === 'submitToLayer1') {
          await this._submitToLayer1(reconciliation.category, reconciliation.item);
          success = true;
        } else if (reconciliation.type === 'addToLayer2') {
          await this._addToLayer2(reconciliation.category, reconciliation.item);
          success = true;
        } else if (reconciliation.type === 'updateItem') {
          await this._updateItem(reconciliation.category, reconciliation.item);
          success = true;
        }
        
        if (success) {
          console.log(`Successfully processed pending reconciliation ${id}`);
          this.pendingReconciliations.delete(id);
          this.stats.resolvedDiscrepancies++;
        }
      } catch (error) {
        console.error(`Failed to process pending reconciliation ${id}: ${error.message}`);
        
        reconciliation.attempts++;
        reconciliation.lastAttempt = now;
        this.pendingReconciliations.set(id, reconciliation);
      }
    }
  }
  
  /**
   * Submit an item to Layer 1
   */
  async _submitToLayer1(category, item) {
    console.log(`Submitting ${category} to Layer 1: ${JSON.stringify(item)}`);
    
    if (Math.random() < 0.9) {
      return true;
    } else {
      throw new Error('Simulated failure');
    }
  }
  
  /**
   * Add an item to Layer 2
   */
  async _addToLayer2(category, item) {
    console.log(`Adding ${category} to Layer 2: ${JSON.stringify(item)}`);
    
    if (Math.random() < 0.9) {
      return true;
    } else {
      throw new Error('Simulated failure');
    }
  }
  
  /**
   * Update an inconsistent item
   */
  async _updateItem(category, item) {
    console.log(`Updating ${category}: ${JSON.stringify(item)}`);
    
    if (Math.random() < 0.9) {
      return true;
    } else {
      throw new Error('Simulated failure');
    }
  }
  
  /**
   * Update statistics based on reconciliation results
   */
  _updateStats(results, startTime) {
    const duration = Date.now() - startTime;
    
    this.stats.totalDiscrepancies += results.resolved + results.failed + results.pending;
    this.stats.resolvedDiscrepancies += results.resolved;
    this.stats.failedReconciliations += results.failed;
    this.stats.pendingReconciliations = this.pendingReconciliations.size;
    
    this.stats.totalReconciliationTime += duration;
    this.stats.reconciliationCount++;
    this.stats.avgReconciliationDuration = this.stats.totalReconciliationTime / this.stats.reconciliationCount;
  }
  
  /**
   * Increment the failure counter and check if circuit breaker should be activated
   */
  _incrementFailureCounter() {
    this.consecutiveFailures++;
    
    if (this.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      console.error(`Circuit breaker activated after ${this.consecutiveFailures} consecutive failures`);
      this.circuitBreakerActive = true;
      
      setTimeout(() => {
        console.log('Circuit breaker reset');
        this.circuitBreakerActive = false;
        this.consecutiveFailures = 0;
      }, this.config.circuitBreakerResetTime);
    }
  }
  
  /**
   * Create a snapshot of the current state
   */
  async _createStateSnapshot() {
    console.log('Creating state snapshot');
    
    try {
      const snapshot = {
        timestamp: new Date().toISOString(),
        layer1State: await this._getLayer1State(),
        layer2State: await this._getLayer2State(),
        stats: this.getStats()
      };
      
      const filename = `snapshot-${Date.now()}.json`;
      const filepath = path.join(this.config.snapshotDir, filename);
      
      fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2));
      
      console.log(`Snapshot created: ${filepath}`);
      
      this._cleanupOldSnapshots();
      
      return filepath;
    } catch (error) {
      console.error(`Failed to create state snapshot: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Load the latest state snapshot
   */
  async _loadLatestSnapshot() {
    console.log('Loading latest state snapshot');
    
    try {
      const files = fs.readdirSync(this.config.snapshotDir);
      
      if (files.length === 0) {
        console.log('No snapshots found');
        return false;
      }
      
      const snapshotFiles = files
        .filter(file => file.startsWith('snapshot-') && file.endsWith('.json'))
        .sort()
        .reverse();
      
      if (snapshotFiles.length === 0) {
        console.log('No valid snapshots found');
        return false;
      }
      
      const latestSnapshot = snapshotFiles[0];
      const filepath = path.join(this.config.snapshotDir, latestSnapshot);
      
      console.log(`Loading snapshot: ${filepath}`);
      
      const snapshot = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      
      this.stats = snapshot.stats;
      
      console.log(`Loaded snapshot from ${snapshot.timestamp}`);
      
      return true;
    } catch (error) {
      console.error(`Failed to load state snapshot: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Clean up old snapshots
   */
  _cleanupOldSnapshots() {
    try {
      const files = fs.readdirSync(this.config.snapshotDir);
      
      const snapshotFiles = files
        .filter(file => file.startsWith('snapshot-') && file.endsWith('.json'))
        .sort();
      
      if (snapshotFiles.length <= this.config.maxSnapshots) {
        return;
      }
      
      const filesToRemove = snapshotFiles.slice(0, snapshotFiles.length - this.config.maxSnapshots);
      
      for (const file of filesToRemove) {
        const filepath = path.join(this.config.snapshotDir, file);
        fs.unlinkSync(filepath);
        console.log(`Removed old snapshot: ${filepath}`);
      }
    } catch (error) {
      console.error(`Failed to clean up old snapshots: ${error.message}`);
    }
  }
}

module.exports = { StateReconciliation };
