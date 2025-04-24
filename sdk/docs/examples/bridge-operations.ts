/**
 * Example: Bridge Operations
 */
import { Layer2Client } from '../src';

const client = new Layer2Client({
  rpcUrl: 'https://api.devnet.solana.com',
  keypair: loadKeypair() // Your implementation to load a keypair
});

async function depositTokens() {
  const result = await client.bridge.depositTokens({
    tokenAddress: '0x1234567890123456789012345678901234567890', // Ethereum token address
    amount: '1000000000', // Amount in smallest units
    recipient: 'solana_recipient_address',
    fee: '1000000' // Fee in smallest units
  });
  
  console.log(`Deposit transaction hash: ${result.transactionHash}`);
  console.log(`Estimated confirmation time: ${result.estimatedConfirmationTime} seconds`);
  
  return result;
}

async function withdrawTokens() {
  const result = await client.bridge.withdrawTokens({
    tokenAddress: 'solana_token_address',
    amount: '1000000000', // Amount in smallest units
    recipient: '0x1234567890123456789012345678901234567890', // Ethereum recipient address
    fee: '1000000' // Fee in smallest units
  });
  
  console.log(`Withdrawal transaction signature: ${result.signature}`);
  console.log(`Estimated finalization time: ${result.estimatedFinalizationTime} seconds`);
  
  return result;
}

async function executeBridgeOperations() {
  try {
    console.log('Depositing tokens...');
    const depositResult = await depositTokens();
    
    console.log('Withdrawing tokens...');
    const withdrawResult = await withdrawTokens();
    
    console.log('Bridge operations completed successfully');
  } catch (error) {
    console.error('Bridge operation failed:', error);
  }
}

executeBridgeOperations();