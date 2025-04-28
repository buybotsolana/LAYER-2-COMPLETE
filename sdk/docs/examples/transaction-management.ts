/**
 * Example: Transaction Management
 */
import { Layer2Client, TransactionManager } from '../src';
import { PublicKey } from '@solana/web3.js';

const client = new Layer2Client({
  rpcUrl: 'https://api.devnet.solana.com',
  keypair: loadKeypair() // Your implementation to load a keypair
});

async function sendTransaction() {
  const recipient = new PublicKey('recipient_address');
  const amount = 1000000000; // 1 SOL in lamports
  
  const result = await client.transaction.send({
    recipient,
    amount,
    memo: 'Payment for services'
  });
  
  console.log(`Transaction signature: ${result.signature}`);
  console.log(`Transaction status: ${result.status}`);
  
  return result;
}

async function getTransactionHistory() {
  const history = await client.transaction.getHistory({
    limit: 10,
    beforeSignature: null // Start from the most recent
  });
  
  console.log(`Found ${history.transactions.length} transactions`);
  
  history.transactions.forEach((tx, index) => {
    console.log(`Transaction ${index + 1}:`);
    console.log(`  Signature: ${tx.signature}`);
    console.log(`  Status: ${tx.status}`);
    console.log(`  Timestamp: ${new Date(tx.timestamp * 1000).toISOString()}`);
    console.log(`  Amount: ${tx.amount}`);
  });
  
  return history;
}

async function executeTransactionOperations() {
  try {
    console.log('Sending transaction...');
    const txResult = await sendTransaction();
    
    console.log('Getting transaction history...');
    const history = await getTransactionHistory();
    
    console.log('Transaction operations completed successfully');
  } catch (error) {
    console.error('Transaction operation failed:', error);
  }
}

executeTransactionOperations();