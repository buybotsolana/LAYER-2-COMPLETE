/**
 * Example: Initializing the Layer 2 Client
 */
import { Layer2Client, Layer2ClientConfig } from '../src';

const config: Layer2ClientConfig = {
  rpcUrl: 'https://api.devnet.solana.com',
  debug: true,
  timeout: 30000,
  maxRetries: 3
};

const walletAdapter = getWalletAdapter(); // Your wallet adapter implementation
const client = new Layer2Client({
  ...config,
  walletAdapter
});

import { Keypair } from '@solana/web3.js';
const keypair = Keypair.generate(); // Or load from a file
const clientWithKeypair = new Layer2Client({
  ...config,
  keypair
});

async function checkConnection() {
  const isConnected = await client.isConnected();
  console.log(`Client connected: ${isConnected}`);
}

checkConnection();