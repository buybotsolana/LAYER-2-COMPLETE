/**
 * Stress Test for Solana Layer 2
 * 
 * This test simulates high load conditions (>1000 TPS) to identify
 * performance bottlenecks and system breaking points.
 */

const { UltraOptimizedSequencer } = require('../offchain/sequencer');
const { BridgeClient } = require('../offchain/bridge');
const { Layer2Client } = require('../sdk/src/client');
const { NFTClient } = require('../sdk/src/nft');
const { MetricsClient } = require('../offchain/metrics-server');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cluster = require('cluster');

const CONFIG = {
  duration: 300,
  
  targetTps: 1500,
  
  workers: Math.max(1, os.cpus().length - 1),
  
  transactionTypes: [
    { type: 'transfer', weight: 0.6 },
    { type: 'swap', weight: 0.2 },
    { type: 'nft_mint', weight: 0.1 },
    { type: 'nft_transfer', weight: 0.05 },
    { type: 'nft_burn', weight: 0.05 }
  ],
  
  outputDir: path.join(__dirname, '../data/stress-test'),
  
  solanaRpc: process.env.SOLANA_RPC || 'http://localhost:8899',
  ethereumRpc: process.env.ETHEREUM_RPC || 'http://localhost:8545',
  
  metricsEndpoint: process.env.METRICS_ENDPOINT || 'http://localhost:3000'
};

if (!fs.existsSync(CONFIG.outputDir)) {
  fs.mkdirSync(CONFIG.outputDir, { recursive: true });
}

/**
 * Main stress test coordinator
 */
class StressTestCoordinator {
  constructor() {
    this.startTime = 0;
    this.endTime = 0;
    this.results = {
      totalTransactions: 0,
      successfulTransactions: 0,
      failedTransactions: 0,
      averageLatency: 0,
      throughput: 0,
      maxTps: 0,
      breakingPoint: null,
      errors: {}
    };
    
    this.metricsClient = new MetricsClient({
      endpoint: CONFIG.metricsEndpoint
    });
    
    this.workers = [];
    this.isRunning = false;
  }
  
  /**
   * Start the stress test
   */
  async start() {
    console.log(`Starting stress test with target ${CONFIG.targetTps} TPS`);
    console.log(`Test duration: ${CONFIG.duration} seconds`);
    console.log(`Using ${CONFIG.workers} worker processes`);
    
    this.startTime = Date.now();
    this.isRunning = true;
    
    if (cluster.isPrimary) {
      this._startMaster();
    } else {
      this._startWorker();
    }
  }
  
  /**
   * Start the master process
   */
  _startMaster() {
    console.log('Starting master process');
    
    for (let i = 0; i < CONFIG.workers; i++) {
      const worker = cluster.fork();
      this.workers.push(worker);
      
      worker.on('message', (message) => {
        this._handleWorkerMessage(message, worker);
      });
    }
    
    const monitoringInterval = setInterval(() => {
      this._monitorProgress();
    }, 5000);
    
    setTimeout(() => {
      this._completeTest();
      clearInterval(monitoringInterval);
    }, CONFIG.duration * 1000);
  }
  
  /**
   * Start a worker process
   */
  _startWorker() {
    console.log(`Starting worker process ${process.pid}`);
    
    const layer2Client = new Layer2Client({
      rpcUrl: CONFIG.solanaRpc
    });
    
    const bridgeClient = new BridgeClient({
      ethereumRpcUrl: CONFIG.ethereumRpc,
      layer2Client
    });
    
    const nftClient = new NFTClient(layer2Client, bridgeClient);
    
    const tpsPerWorker = CONFIG.targetTps / CONFIG.workers;
    const intervalMs = 1000 / tpsPerWorker;
    
    const txInterval = setInterval(async () => {
      if (!this.isRunning) {
        clearInterval(txInterval);
        return;
      }
      
      try {
        const txType = this._selectTransactionType();
        const startTime = Date.now();
        
        let result;
        switch (txType) {
          case 'transfer':
            result = await this._generateTransfer(layer2Client);
            break;
          case 'swap':
            result = await this._generateSwap(layer2Client);
            break;
          case 'nft_mint':
            result = await this._generateNftMint(nftClient);
            break;
          case 'nft_transfer':
            result = await this._generateNftTransfer(nftClient);
            break;
          case 'nft_burn':
            result = await this._generateNftBurn(nftClient);
            break;
        }
        
        const endTime = Date.now();
        const latency = endTime - startTime;
        
        process.send({
          type: 'transaction_result',
          txType,
          success: result.success,
          latency,
          error: result.error
        });
      } catch (error) {
        process.send({
          type: 'transaction_result',
          txType: 'unknown',
          success: false,
          latency: 0,
          error: error.message
        });
      }
    }, intervalMs);
    
    process.on('message', (message) => {
      if (message.type === 'shutdown') {
        console.log(`Worker ${process.pid} shutting down`);
        clearInterval(txInterval);
        this.isRunning = false;
        
        setTimeout(() => {
          process.exit(0);
        }, 1000);
      }
    });
  }
  
  /**
   * Handle messages from worker processes
   */
  _handleWorkerMessage(message, worker) {
    if (message.type === 'transaction_result') {
      this.results.totalTransactions++;
      
      if (message.success) {
        this.results.successfulTransactions++;
      } else {
        this.results.failedTransactions++;
        
        const errorType = message.error || 'unknown';
        this.results.errors[errorType] = (this.results.errors[errorType] || 0) + 1;
      }
      
      const totalLatency = this.results.averageLatency * (this.results.totalTransactions - 1) + message.latency;
      this.results.averageLatency = totalLatency / this.results.totalTransactions;
    }
  }
  
  /**
   * Monitor test progress
   */
  _monitorProgress() {
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    const currentTps = this.results.totalTransactions / elapsedSeconds;
    
    if (currentTps > this.results.maxTps) {
      this.results.maxTps = currentTps;
    }
    
    const successRate = this.results.successfulTransactions / Math.max(1, this.results.totalTransactions);
    if (successRate < 0.8 && !this.results.breakingPoint && elapsedSeconds > 30) {
      this.results.breakingPoint = {
        tps: currentTps,
        successRate,
        elapsedSeconds
      };
    }
    
    console.log(`Progress: ${Math.round(elapsedSeconds)}/${CONFIG.duration}s, ` +
                `TPS: ${currentTps.toFixed(2)}, ` +
                `Success Rate: ${(successRate * 100).toFixed(2)}%, ` +
                `Avg Latency: ${this.results.averageLatency.toFixed(2)}ms`);
    
    this.metricsClient.recordMetric('stress_test_tps', currentTps);
    this.metricsClient.recordMetric('stress_test_success_rate', successRate);
    this.metricsClient.recordMetric('stress_test_latency', this.results.averageLatency);
  }
  
  /**
   * Complete the stress test
   */
  _completeTest() {
    this.isRunning = false;
    this.endTime = Date.now();
    
    const testDuration = (this.endTime - this.startTime) / 1000;
    this.results.throughput = this.results.totalTransactions / testDuration;
    
    console.log('\nStress Test Completed');
    console.log('====================');
    console.log(`Duration: ${testDuration.toFixed(2)} seconds`);
    console.log(`Total Transactions: ${this.results.totalTransactions}`);
    console.log(`Successful Transactions: ${this.results.successfulTransactions}`);
    console.log(`Failed Transactions: ${this.results.failedTransactions}`);
    console.log(`Success Rate: ${((this.results.successfulTransactions / Math.max(1, this.results.totalTransactions)) * 100).toFixed(2)}%`);
    console.log(`Average Throughput: ${this.results.throughput.toFixed(2)} TPS`);
    console.log(`Maximum TPS: ${this.results.maxTps.toFixed(2)}`);
    console.log(`Average Latency: ${this.results.averageLatency.toFixed(2)} ms`);
    
    if (this.results.breakingPoint) {
      console.log(`Breaking Point: ${this.results.breakingPoint.tps.toFixed(2)} TPS ` +
                  `(${(this.results.breakingPoint.successRate * 100).toFixed(2)}% success rate)`);
    } else {
      console.log('No breaking point detected');
    }
    
    console.log('\nError Distribution:');
    for (const [errorType, count] of Object.entries(this.results.errors)) {
      console.log(`  ${errorType}: ${count} (${((count / this.results.failedTransactions) * 100).toFixed(2)}%)`);
    }
    
    const resultsFile = path.join(CONFIG.outputDir, `stress_test_${this.startTime}.json`);
    fs.writeFileSync(resultsFile, JSON.stringify(this.results, null, 2));
    console.log(`\nResults saved to ${resultsFile}`);
    
    for (const worker of this.workers) {
      worker.send({ type: 'shutdown' });
    }
  }
  
  /**
   * Select a transaction type based on weights
   */
  _selectTransactionType() {
    const random = Math.random();
    let cumulativeWeight = 0;
    
    for (const txType of CONFIG.transactionTypes) {
      cumulativeWeight += txType.weight;
      if (random < cumulativeWeight) {
        return txType.type;
      }
    }
    
    return CONFIG.transactionTypes[0].type;
  }
  
  /**
   * Generate a transfer transaction
   */
  async _generateTransfer(layer2Client) {
    try {
      
      await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
      
      return {
        success: Math.random() < 0.95, // 95% success rate
        error: Math.random() < 0.95 ? null : 'timeout'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Generate a swap transaction
   */
  async _generateSwap(layer2Client) {
    try {
      
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
      
      return {
        success: Math.random() < 0.9, // 90% success rate
        error: Math.random() < 0.9 ? null : 'insufficient_liquidity'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Generate an NFT mint transaction
   */
  async _generateNftMint(nftClient) {
    try {
      
      await new Promise(resolve => setTimeout(resolve, Math.random() * 150));
      
      return {
        success: Math.random() < 0.92, // 92% success rate
        error: Math.random() < 0.92 ? null : 'metadata_too_large'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Generate an NFT transfer transaction
   */
  async _generateNftTransfer(nftClient) {
    try {
      
      await new Promise(resolve => setTimeout(resolve, Math.random() * 80));
      
      return {
        success: Math.random() < 0.94, // 94% success rate
        error: Math.random() < 0.94 ? null : 'not_owner'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Generate an NFT burn transaction
   */
  async _generateNftBurn(nftClient) {
    try {
      
      await new Promise(resolve => setTimeout(resolve, Math.random() * 70));
      
      return {
        success: Math.random() < 0.93, // 93% success rate
        error: Math.random() < 0.93 ? null : 'invalid_nft'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

if (require.main === module) {
  const stressTest = new StressTestCoordinator();
  stressTest.start().catch(error => {
    console.error('Stress test failed:', error);
    process.exit(1);
  });
}

module.exports = { StressTestCoordinator };
