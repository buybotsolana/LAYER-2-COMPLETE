# Getting Started with Solana Layer 2 SDK

This guide will help you get started with the Solana Layer 2 SDK.

## Installation

```bash
npm install solana-layer2-sdk
```

## Basic Usage

```typescript
import { createLayer2Client, Layer2ClientConfig } from 'solana-layer2-sdk';

// Configure the client
const config: Layer2ClientConfig = {
  rpcUrl: 'https://api.devnet.solana.com',
  debug: true,
  timeout: 30000,
  maxRetries: 3
};

// Create a client instance with a wallet adapter
const walletAdapter = getWalletAdapter(); // Your wallet adapter implementation
const client = createLayer2Client({
  ...config,
  walletAdapter
});

// Check connection
async function checkConnection() {
  const isConnected = await client.isConnected();
  console.log(`Client connected: ${isConnected}`);
}

checkConnection();
```

## Key Components

The SDK consists of several key components:

- **Layer2Client**: The main client for interacting with the Layer 2 system
- **Bridge**: For bridging assets between Layer 1 and Layer 2
- **TransactionManager**: For managing transactions on Layer 2
- **Challenge**: For challenging invalid batches
- **BatchManager**: For managing batches of transactions
- **ProofManager**: For generating and verifying proofs
- **StateManager**: For managing Layer 2 state

## Examples

For more detailed examples, see the [Examples](./examples) directory.

## API Reference

For detailed API documentation, see the [API Reference](./api/index.md).
