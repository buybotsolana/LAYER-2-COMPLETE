# Layer 2 Developer Integration Tutorial

This step-by-step guide will help you integrate your decentralized application (dApp) with our Solana Layer 2 scaling solution. By following this tutorial, you'll be able to leverage high throughput and low transaction costs while maintaining EVM compatibility.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Setting Up the SDK](#setting-up-the-sdk)
3. [Initializing the Layer 2 Client](#initializing-the-layer-2-client)
4. [Cross-Chain Asset Transfers](#cross-chain-asset-transfers)
   - [Depositing Assets from Layer 1 to Layer 2](#depositing-assets-from-layer-1-to-layer-2)
   - [Withdrawing Assets from Layer 2 to Layer 1](#withdrawing-assets-from-layer-2-to-layer-1)
   - [Monitoring Bridge Operations](#monitoring-bridge-operations)
5. [Submitting and Managing Transactions](#submitting-and-managing-transactions)
   - [Sending Transactions](#sending-transactions)
   - [Checking Transaction Status](#checking-transaction-status)
   - [Transaction History](#transaction-history)
6. [Advanced Features](#advanced-features)
   - [Batch Processing](#batch-processing)
   - [Challenge Mechanism](#challenge-mechanism)
   - [Merkle Proofs](#merkle-proofs)
7. [Error Handling and Recovery](#error-handling-and-recovery)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

## Prerequisites

Before you begin, make sure you have:

- Node.js v14 or higher
- npm or yarn package manager
- Basic knowledge of Solana and Ethereum development
- Solana wallet (e.g., Phantom, Solflare) or keypair for testing

## Setting Up the SDK

First, install the Layer 2 SDK in your project:

```bash
npm install @solana/layer2-sdk
# or
yarn add @solana/layer2-sdk
```

## Initializing the Layer 2 Client

The `Layer2Client` is the main entry point for interacting with the Layer 2 system. You can initialize it with a wallet adapter or a keypair.

```typescript
import { Layer2Client } from '@solana/layer2-sdk';
import { Keypair } from '@solana/web3.js';

// Option 1: Initialize with a wallet adapter (recommended for browser environments)
const walletAdapter = window.solana; // or any other wallet adapter
const client = new Layer2Client({
  rpcUrl: 'https://api.layer2.solana.com',
  walletAdapter,
  debug: true, // Set to false in production
});

// Option 2: Initialize with a keypair (for backend or testing)
const keypair = Keypair.generate(); // or load from a file
const client = new Layer2Client({
  rpcUrl: 'https://api.layer2.solana.com',
  keypair,
  debug: true, // Set to false in production
});

// Check if connected
const isConnected = await client.isConnected();
console.log(`Connected to Layer 2: ${isConnected}`);
```

## Cross-Chain Asset Transfers

### Depositing Assets from Layer 1 to Layer 2

To deposit assets from Layer 1 (Solana) to Layer 2:

```typescript
// Deposit 1 SOL to Layer 2
const depositResult = await client.bridge.deposit({
  amount: 1_000_000_000, // 1 SOL in lamports
  token: 'SOL', // Default is 'SOL'
  // recipient: new PublicKey('...'), // Optional: specify a different recipient
  reference: 'My first deposit', // Optional: add a reference
});

console.log(`Deposit initiated with ID: ${depositResult.depositId}`);
console.log(`Transaction hash: ${depositResult.txHash}`);
console.log(`Status: ${depositResult.status}`);
```

### Withdrawing Assets from Layer 2 to Layer 1

To withdraw assets from Layer 2 back to Layer 1:

```typescript
// Withdraw 0.5 SOL from Layer 2
const withdrawResult = await client.bridge.withdraw({
  amount: 500_000_000, // 0.5 SOL in lamports
  token: 'SOL', // Default is 'SOL'
  // recipient: new PublicKey('...'), // Optional: specify a different recipient
  reference: 'My first withdrawal', // Optional: add a reference
});

console.log(`Withdrawal initiated with ID: ${withdrawResult.withdrawId}`);
console.log(`Transaction hash: ${withdrawResult.txHash}`);
console.log(`Status: ${withdrawResult.status}`);
```

### Monitoring Bridge Operations

You can check the status of bridge operations and get historical data:

```typescript
// Check status of a specific operation
const operationStatus = await client.bridge.getOperationStatus('dep_12345678');
console.log(`Operation status: ${operationStatus.status}`);
console.log(`Details:`, operationStatus.details);

// Get operation history
const operationHistory = await client.bridge.getOperationHistory(10, 0); // limit, offset
console.log(`Recent operations:`, operationHistory);
```

## Submitting and Managing Transactions

### Sending Transactions

Once you have assets on Layer 2, you can send transactions:

```typescript
// Send 0.1 SOL to another address on Layer 2
const txResult = await client.transaction.send({
  to: 'recipient_address_or_public_key',
  amount: 100_000_000, // 0.1 SOL in lamports
  token: 'SOL', // Default is 'SOL'
  // fee: 5000, // Optional: specify custom fee
  data: { memo: 'Payment for services' }, // Optional: include additional data
  reference: 'Invoice #123', // Optional: add a reference
});

console.log(`Transaction ID: ${txResult.txId}`);
console.log(`Status: ${txResult.status}`);
console.log(`Details:`, txResult.details);
```

### Checking Transaction Status

You can check the status of a transaction:

```typescript
// Get status of a transaction
const txStatus = await client.transaction.getStatus('tx_12345678');
console.log(`Transaction status: ${txStatus.status}`);
console.log(`Details:`, txStatus.details);

// Check if a transaction is finalized
const finalizationStatus = await client.transaction.getFinalizationStatus('tx_12345678');
console.log(`Is finalized: ${finalizationStatus.isFinalized}`);
if (finalizationStatus.isFinalized) {
  console.log(`Finalized at block: ${finalizationStatus.finalizationBlock}`);
  console.log(`Finalization time: ${new Date(finalizationStatus.finalizationTime).toISOString()}`);
}
```

### Transaction History

You can retrieve the transaction history for the current user:

```typescript
// Get transaction history
const txHistory = await client.transaction.getHistory(20, 0); // limit, offset
console.log(`Recent transactions:`, txHistory);
```

## Advanced Features

### Batch Processing

For improved efficiency, you can use the auto-batch feature to group multiple transactions:

```typescript
import { AutoBatchManager } from '@solana/layer2-sdk';

// Create an auto-batch manager
const batchManager = new AutoBatchManager(client, {
  maxBatchSize: 100, // Maximum number of transactions in a batch
  batchTimeoutMs: 5000, // Time to wait before processing a batch
});

// Add transactions to the batch
await batchManager.addTransaction({
  to: 'recipient1_address',
  amount: 100_000_000,
});

await batchManager.addTransaction({
  to: 'recipient2_address',
  amount: 200_000_000,
});

// Transactions will be automatically processed after the timeout
// or when maxBatchSize is reached

// You can also force process the current batch
const batchResult = await batchManager.processBatch();
console.log(`Batch processed with ID: ${batchResult.batchId}`);
```

### Challenge Mechanism

The Layer 2 system includes a challenge mechanism to ensure the integrity of transactions:

```typescript
// Submit a challenge for a suspicious transaction
const challengeResult = await client.challenge.submit({
  txId: 'tx_12345678',
  reason: 'invalid_signature',
  evidence: { /* evidence data */ },
});

console.log(`Challenge submitted with ID: ${challengeResult.challengeId}`);

// Check the status of a challenge
const challengeStatus = await client.challenge.getStatus('challenge_12345678');
console.log(`Challenge status: ${challengeStatus.status}`);
```

### Merkle Proofs

You can verify the inclusion of a transaction in a batch using Merkle proofs:

```typescript
// Verify a transaction's inclusion in a batch
const verificationResult = await client.transaction.verifyInclusion('tx_12345678');
console.log(`Verification result: ${verificationResult.isValid}`);
if (verificationResult.isValid) {
  console.log(`Batch: ${verificationResult.batchNumber}`);
  console.log(`Merkle root: ${verificationResult.merkleRoot}`);
}
```

## Error Handling and Recovery

The SDK includes robust error handling and recovery mechanisms:

```typescript
try {
  const result = await client.bridge.deposit({
    amount: 1_000_000_000,
  });
  // Process result
} catch (error) {
  if (error instanceof Layer2Error) {
    console.error(`Layer 2 error (code ${error.code}): ${error.message}`);
    
    // Handle specific error codes
    switch (error.code) {
      case ErrorCode.INSUFFICIENT_FUNDS:
        // Handle insufficient funds
        break;
      case ErrorCode.NETWORK_ERROR:
        // Retry with exponential backoff
        await retry(() => client.bridge.deposit({ amount: 1_000_000_000 }));
        break;
      default:
        // Handle other errors
        break;
    }
  } else {
    console.error(`Unexpected error: ${error.message}`);
  }
}

// Helper retry function with exponential backoff
async function retry(fn, maxRetries = 3, initialDelay = 1000) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      return await fn();
    } catch (error) {
      retries++;
      if (retries >= maxRetries) throw error;
      const delay = initialDelay * Math.pow(2, retries - 1);
      console.log(`Retrying after ${delay}ms (attempt ${retries}/${maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

## Best Practices

1. **Always check transaction status**: Don't assume transactions are immediately finalized. Always check their status.

2. **Implement proper error handling**: Use try-catch blocks and handle specific error codes appropriately.

3. **Use batch processing for multiple transactions**: Batching transactions reduces fees and improves throughput.

4. **Keep your dependencies updated**: Regularly update the SDK to benefit from the latest features and security fixes.

5. **Implement retry logic with exponential backoff**: Network issues can occur, so implement proper retry mechanisms.

6. **Monitor bridge operations**: Regularly check the status of cross-chain transfers to ensure they complete successfully.

7. **Test thoroughly on testnet before mainnet**: Always test your integration on the testnet before deploying to production.

8. **Implement proper logging**: Log all operations and their results for debugging and auditing purposes.

9. **Use webhooks for notifications**: Set up webhooks to receive notifications about important events.

10. **Secure your private keys**: If using keypairs, ensure they are stored securely and not exposed in your code.

## Troubleshooting

### Common Issues and Solutions

1. **Transaction Pending for Too Long**
   - Check network congestion
   - Verify that the fee is sufficient
   - Check if the transaction is included in a batch

2. **Bridge Operation Failed**
   - Verify that you have sufficient funds
   - Check if the recipient address is valid
   - Ensure that the token is supported

3. **Connection Issues**
   - Verify that the RPC URL is correct
   - Check your internet connection
   - Try using a different RPC endpoint

4. **Wallet Not Connected**
   - Ensure that the wallet is unlocked
   - Check if the wallet adapter is properly initialized
   - Verify that the wallet supports the required methods

For more assistance, please refer to the [API Reference](https://docs.layer2.solana.com/api) or contact our support team.
