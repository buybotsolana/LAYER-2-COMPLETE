// src/performance/benchmark.js
const { ethers } = require('ethers');
const { Connection, Keypair, PublicKey, Transaction } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

/**
 * Layer-2 Performance Benchmark Tool
 * 
 * This tool measures the performance of the Layer-2 solution in terms of:
 * - Transactions per second (TPS)
 * - Transaction latency
 * - Resource usage
 * 
 * Usage:
 *   node benchmark.js --rpc-url=http://localhost:3000 --duration=60 --threads=8 --batch-size=100
 */

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.split('=');
  acc[key.replace('--', '')] = value;
  return acc;
}, {});

const rpcUrl = args['rpc-url'] || 'http://localhost:3000';
const duration = parseInt(args['duration'] || '60', 10);
const threadCount = parseInt(args['threads'] || '8', 10);
const batchSize = parseInt(args['batch-size'] || '100', 10);

console.log('Starting benchmark with settings:');
console.log('RPC URL:', rpcUrl);
console.log('Duration:', duration, 'seconds');
console.log('Threads:', threadCount);
console.log('Batch size:', batchSize);

// Create L2 client
const l2Client = new L2Client(rpcUrl);

// Create wallets
const wallets = Array(threadCount).fill(0).map(() => Keypair.generate());

// Fund wallets
async function fundWallets() {
  console.log('Funding test wallets...');
  
  // In a real implementation, we would fund these wallets from a faucet or existing account
  // For this mock implementation, we'll just set balances directly
  for (const wallet of wallets) {
    await l2Client.setBalance(wallet.publicKey, ethers.utils.parseEther('1000.0'));
  }
  
  console.log('Wallets funded successfully');
}

// Run benchmark
async function runBenchmark() {
  // Fund wallets
  await fundWallets();
  
  // Create shared counters
  let totalTxCount = 0;
  let successfulTxCount = 0;
  let totalLatency = 0;
  
  // Create recipients
  const recipients = Array(threadCount * 10).fill(0).map(() => Keypair.generate());
  
  // Start benchmark
  console.log('Starting benchmark...');
  const startTime = Date.now();
  const endTime = startTime + (duration * 1000);
  
  // Create promises for each thread
  const threadPromises = wallets.map((wallet, i) => {
    return new Promise(async (resolve) => {
      while (Date.now() < endTime) {
        // Generate batch of transactions
        const txPromises = [];
        
        for (let j = 0; j < batchSize; j++) {
          const recipientIndex = (i * batchSize + j) % recipients.length;
          const recipient = recipients[recipientIndex];
          const amount = ethers.utils.parseEther('0.001');
          
          const txStartTime = Date.now();
          
          const txPromise = l2Client.transfer(wallet, recipient.publicKey, amount)
            .then(() => {
              const latency = Date.now() - txStartTime;
              totalLatency += latency;
              successfulTxCount++;
              return true;
            })
            .catch(() => {
              return false;
            });
          
          txPromises.push(txPromise);
          totalTxCount++;
        }
        
        // Wait for batch to complete
        await Promise.all(txPromises);
        
        // Small delay to prevent overwhelming the client
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      resolve();
    });
  });
  
  // Wait for all threads to complete
  await Promise.all(threadPromises);
  
  // Calculate results
  const actualDuration = (Date.now() - startTime) / 1000;
  const tps = successfulTxCount / actualDuration;
  const averageLatency = totalLatency / successfulTxCount;
  
  // Print results
  console.log('\nBenchmark Results:');
  console.log('Total Transactions:', totalTxCount);
  console.log('Successful Transactions:', successfulTxCount);
  console.log('Duration:', actualDuration.toFixed(2), 'seconds');
  console.log('Throughput:', tps.toFixed(2), 'TPS');
  console.log('Average Latency:', averageLatency.toFixed(2), 'ms');
  
  // Save results to file
  const results = {
    timestamp: new Date().toISOString(),
    settings: {
      rpcUrl,
      duration,
      threadCount,
      batchSize
    },
    results: {
      totalTransactions: totalTxCount,
      successfulTransactions: successfulTxCount,
      duration: actualDuration,
      tps,
      averageLatency
    }
  };
  
  const resultsDir = path.join(__dirname, 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  
  const resultsFile = path.join(resultsDir, `benchmark-${Date.now()}.json`);
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  
  console.log(`Results saved to ${resultsFile}`);
}

// Run the benchmark
runBenchmark().catch(console.error);

// Mock L2Client class for testing
// In a real implementation, this would be replaced with actual SDK
class L2Client {
  constructor(url) {
    this.url = url;
    this.balances = new Map();
  }
  
  async getBalance(publicKey) {
    const key = publicKey.toString();
    return this.balances.get(key) || ethers.BigNumber.from(0);
  }
  
  async setBalance(publicKey, amount) {
    const key = publicKey.toString();
    this.balances.set(key, amount);
  }
  
  async transfer(fromWallet, toPublicKey, amount) {
    const fromKey = fromWallet.publicKey.toString();
    const toKey = toPublicKey.toString();
    
    const fromBalance = await this.getBalance(fromWallet.publicKey);
    
    if (fromBalance.lt(amount)) {
      throw new Error("Insufficient balance");
    }
    
    // Update balances
    this.balances.set(fromKey, fromBalance.sub(amount));
    
    const toBalance = await this.getBalance(toPublicKey);
    this.balances.set(toKey, toBalance.add(amount));
    
    // Simulate network latency
    await new Promise(resolve => setTimeout(resolve, Math.random() * 50 + 10));
    
    return true;
  }
}
