import express from 'express';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { solanaConnection, layer2Connection, redisClient } from '../index';

const router = express.Router();

/**
 * Get transaction details
 * @route GET /api/transaction/:signature
 */
router.get('/:signature', async (req, res) => {
  try {
    const { signature } = req.params;
    const { network = 'layer2' } = req.query;
    
    // Determine which connection to use
    const connection = network === 'solana' ? solanaConnection : layer2Connection;
    
    // Check cache first
    const cacheKey = `transaction:${network}:${signature}`;
    const cachedData = await redisClient.get(cacheKey);
    
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }
    
    // Get transaction details
    const txInfo = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });
    
    if (!txInfo) {
      return res.status(404).json({
        error: 'Transaction Not Found',
        message: `Transaction with signature ${signature} not found on ${network}`
      });
    }
    
    // Format transaction data
    const formattedTx = {
      signature,
      slot: txInfo.slot,
      blockTime: txInfo.blockTime,
      confirmations: txInfo.confirmations,
      fee: txInfo.meta?.fee || 0,
      status: txInfo.meta?.err ? 'failed' : 'success',
      error: txInfo.meta?.err ? JSON.stringify(txInfo.meta.err) : null,
      instructions: txInfo.transaction.message.instructions.map((ix, index) => {
        return {
          programId: ix.programId.toString(),
          accounts: ix.accounts.map(acc => txInfo.transaction.message.accountKeys[acc].toString()),
          data: ix.data
        };
      }),
      logs: txInfo.meta?.logMessages || [],
      network
    };
    
    // Cache result for 5 minutes (transactions are immutable)
    await redisClient.set(cacheKey, JSON.stringify(formattedTx), { EX: 300 });
    
    res.json(formattedTx);
  } catch (error) {
    console.error(`Error getting transaction ${req.params.signature}:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get transaction details'
    });
  }
});

/**
 * Get recent transactions
 * @route GET /api/transaction/recent/:limit
 */
router.get('/recent/:limit', async (req, res) => {
  try {
    const { limit = '10' } = req.params;
    const { network = 'layer2' } = req.query;
    const limitNum = Math.min(parseInt(limit, 10), 50); // Cap at 50
    
    // Determine which connection to use
    const connection = network === 'solana' ? solanaConnection : layer2Connection;
    
    // Check cache first
    const cacheKey = `transactions:recent:${network}:${limitNum}`;
    const cachedData = await redisClient.get(cacheKey);
    
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }
    
    // Get recent block signatures
    const signatures = await connection.getSignaturesForAddress(
      new PublicKey('11111111111111111111111111111111'), // System program
      { limit: limitNum }
    );
    
    // Get transaction details for each signature
    const transactions = await Promise.all(
      signatures.map(async (sig) => {
        try {
          const txInfo = await connection.getTransaction(sig.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          });
          
          if (!txInfo) return null;
          
          return {
            signature: sig.signature,
            slot: txInfo.slot,
            blockTime: txInfo.blockTime,
            fee: txInfo.meta?.fee || 0,
            status: txInfo.meta?.err ? 'failed' : 'success',
            programIds: [...new Set(txInfo.transaction.message.instructions.map(ix => 
              txInfo.transaction.message.accountKeys[ix.programId].toString()
            ))],
            network
          };
        } catch (error) {
          console.error(`Error getting transaction ${sig.signature}:`, error);
          return null;
        }
      })
    );
    
    // Filter out null values
    const validTransactions = transactions.filter(tx => tx !== null);
    
    // Cache result for 10 seconds
    await redisClient.set(cacheKey, JSON.stringify(validTransactions), { EX: 10 });
    
    res.json(validTransactions);
  } catch (error) {
    console.error('Error getting recent transactions:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get recent transactions'
    });
  }
});

/**
 * Get transactions for an account
 * @route GET /api/transaction/account/:address
 */
router.get('/account/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { network = 'layer2', limit = '20', before = null } = req.query;
    const limitNum = Math.min(parseInt(limit as string, 10), 50); // Cap at 50
    
    // Validate address
    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(address);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid address',
        message: 'The provided address is not a valid Solana address'
      });
    }
    
    // Determine which connection to use
    const connection = network === 'solana' ? solanaConnection : layer2Connection;
    
    // Check cache first (only if not using 'before' parameter)
    if (!before) {
      const cacheKey = `transactions:account:${network}:${address}:${limitNum}`;
      const cachedData = await redisClient.get(cacheKey);
      
      if (cachedData) {
        return res.json(JSON.parse(cachedData));
      }
    }
    
    // Get signatures for address
    const options: any = { limit: limitNum };
    if (before) {
      options.before = before;
    }
    
    const signatures = await connection.getSignaturesForAddress(pubkey, options);
    
    // Get transaction details for each signature
    const transactions = await Promise.all(
      signatures.map(async (sig) => {
        try {
          const txInfo = await connection.getTransaction(sig.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          });
          
          if (!txInfo) return null;
          
          return {
            signature: sig.signature,
            slot: txInfo.slot,
            blockTime: txInfo.blockTime,
            fee: txInfo.meta?.fee || 0,
            status: txInfo.meta?.err ? 'failed' : 'success',
            programIds: [...new Set(txInfo.transaction.message.instructions.map(ix => 
              txInfo.transaction.message.accountKeys[ix.programId].toString()
            ))],
            network
          };
        } catch (error) {
          console.error(`Error getting transaction ${sig.signature}:`, error);
          return null;
        }
      })
    );
    
    // Filter out null values
    const validTransactions = transactions.filter(tx => tx !== null);
    
    // Add pagination info
    const result = {
      transactions: validTransactions,
      pagination: {
        hasMore: validTransactions.length === limitNum,
        nextBefore: validTransactions.length > 0 ? validTransactions[validTransactions.length - 1].signature : null
      }
    };
    
    // Cache result for 10 seconds (only if not using 'before' parameter)
    if (!before) {
      await redisClient.set(`transactions:account:${network}:${address}:${limitNum}`, JSON.stringify(result), { EX: 10 });
    }
    
    res.json(result);
  } catch (error) {
    console.error(`Error getting transactions for account ${req.params.address}:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get account transactions'
    });
  }
});

/**
 * Submit a transaction
 * @route POST /api/transaction/submit
 */
router.post('/submit', async (req, res) => {
  try {
    const { serializedTransaction, network = 'layer2' } = req.body;
    
    if (!serializedTransaction) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing serialized transaction'
      });
    }
    
    // Determine which connection to use
    const connection = network === 'solana' ? solanaConnection : layer2Connection;
    
    // Deserialize and send transaction
    const transaction = Transaction.from(Buffer.from(serializedTransaction, 'base64'));
    
    // Send transaction
    const signature = await connection.sendRawTransaction(transaction.serialize());
    
    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    res.json({
      signature,
      status: confirmation.value.err ? 'failed' : 'success',
      error: confirmation.value.err ? JSON.stringify(confirmation.value.err) : null
    });
  } catch (error) {
    console.error('Error submitting transaction:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to submit transaction'
    });
  }
});

/**
 * Simulate a transaction
 * @route POST /api/transaction/simulate
 */
router.post('/simulate', async (req, res) => {
  try {
    const { serializedTransaction, network = 'layer2' } = req.body;
    
    if (!serializedTransaction) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing serialized transaction'
      });
    }
    
    // Determine which connection to use
    const connection = network === 'solana' ? solanaConnection : layer2Connection;
    
    // Deserialize transaction
    const transaction = Transaction.from(Buffer.from(serializedTransaction, 'base64'));
    
    // Simulate transaction
    const simulation = await connection.simulateTransaction(transaction);
    
    res.json({
      success: simulation.value.err === null,
      error: simulation.value.err ? JSON.stringify(simulation.value.err) : null,
      logs: simulation.value.logs || [],
      unitsConsumed: simulation.value.unitsConsumed || 0
    });
  } catch (error) {
    console.error('Error simulating transaction:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to simulate transaction'
    });
  }
});

export default router;
