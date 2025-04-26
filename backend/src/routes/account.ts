import express from 'express';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { solanaConnection, layer2Connection, redisClient } from '../index';

const router = express.Router();

/**
 * Get account information
 * @route GET /api/account/:address
 */
router.get('/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { network = 'layer2' } = req.query;
    
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
    
    // Check cache first
    const cacheKey = `account:${network}:${address}`;
    const cachedData = await redisClient.get(cacheKey);
    
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }
    
    // Determine which connection to use
    const connection = network === 'solana' ? solanaConnection : layer2Connection;
    
    // Get account info
    const accountInfo = await connection.getAccountInfo(pubkey);
    
    if (!accountInfo) {
      return res.status(404).json({
        error: 'Account Not Found',
        message: `Account ${address} not found on ${network}`
      });
    }
    
    // Get balance
    const balance = await connection.getBalance(pubkey);
    
    // Format account data
    const formattedAccount = {
      address,
      balance,
      executable: accountInfo.executable,
      owner: accountInfo.owner.toString(),
      rentEpoch: accountInfo.rentEpoch,
      space: accountInfo.data.length,
      network
    };
    
    // Cache result for 10 seconds
    await redisClient.set(cacheKey, JSON.stringify(formattedAccount), { EX: 10 });
    
    res.json(formattedAccount);
  } catch (error) {
    console.error(`Error getting account ${req.params.address}:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get account information'
    });
  }
});

/**
 * Get token accounts for a wallet
 * @route GET /api/account/:address/tokens
 */
router.get('/:address/tokens', async (req, res) => {
  try {
    const { address } = req.params;
    const { network = 'layer2' } = req.query;
    
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
    
    // Check cache first
    const cacheKey = `account:tokens:${network}:${address}`;
    const cachedData = await redisClient.get(cacheKey);
    
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }
    
    // Determine which connection to use
    const connection = network === 'solana' ? solanaConnection : layer2Connection;
    
    // Get token accounts
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      pubkey,
      { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
    );
    
    // Format token accounts
    const formattedTokens = tokenAccounts.value.map(account => {
      const parsedInfo = account.account.data.parsed.info;
      return {
        address: account.pubkey.toString(),
        mint: parsedInfo.mint,
        owner: parsedInfo.owner,
        amount: parsedInfo.tokenAmount.amount,
        decimals: parsedInfo.tokenAmount.decimals,
        uiAmount: parsedInfo.tokenAmount.uiAmount
      };
    });
    
    // Cache result for 10 seconds
    await redisClient.set(cacheKey, JSON.stringify(formattedTokens), { EX: 10 });
    
    res.json(formattedTokens);
  } catch (error) {
    console.error(`Error getting token accounts for ${req.params.address}:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get token accounts'
    });
  }
});

/**
 * Get stake accounts for a wallet
 * @route GET /api/account/:address/stakes
 */
router.get('/:address/stakes', async (req, res) => {
  try {
    const { address } = req.params;
    const { network = 'layer2' } = req.query;
    
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
    
    // Check cache first
    const cacheKey = `account:stakes:${network}:${address}`;
    const cachedData = await redisClient.get(cacheKey);
    
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }
    
    // Determine which connection to use
    const connection = network === 'solana' ? solanaConnection : layer2Connection;
    
    // Get stake accounts
    const stakeAccounts = await connection.getParsedProgramAccounts(
      new PublicKey('Stake11111111111111111111111111111111111111'),
      {
        filters: [
          {
            memcmp: {
              offset: 12, // Offset of stake authority
              bytes: pubkey.toBase58(),
            },
          },
        ],
      }
    );
    
    // Format stake accounts
    const formattedStakes = stakeAccounts.map(account => {
      // This is a simplified implementation
      // In a real system, you would parse the stake account data properly
      return {
        address: account.pubkey.toString(),
        lamports: account.account.lamports,
        data: 'Stake account data would be parsed here',
        owner: account.account.owner.toString()
      };
    });
    
    // Cache result for 10 seconds
    await redisClient.set(cacheKey, JSON.stringify(formattedStakes), { EX: 10 });
    
    res.json(formattedStakes);
  } catch (error) {
    console.error(`Error getting stake accounts for ${req.params.address}:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get stake accounts'
    });
  }
});

/**
 * Get validator information
 * @route GET /api/account/:address/validator
 */
router.get('/:address/validator', async (req, res) => {
  try {
    const { address } = req.params;
    const { network = 'layer2' } = req.query;
    
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
    
    // Check cache first
    const cacheKey = `account:validator:${network}:${address}`;
    const cachedData = await redisClient.get(cacheKey);
    
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }
    
    // Determine which connection to use
    const connection = network === 'solana' ? solanaConnection : layer2Connection;
    
    // Get validator info
    // This is a simplified implementation
    // In a real system, you would use the getVoteAccounts method
    // and filter for the specific validator
    
    // For demonstration purposes, we'll return mock data
    const validatorInfo = {
      address,
      identity: address,
      votePubkey: `vote${address.substring(4)}`,
      commission: Math.floor(Math.random() * 10) + 1,
      lastVote: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 100),
      rootSlot: Math.floor(Math.random() * 10000) + 100000,
      activatedStake: Math.floor(Math.random() * 1000000) + 100000,
      delinquent: false,
      skipRate: Math.random() * 0.1, // 0-10%
      network
    };
    
    // Cache result for 60 seconds
    await redisClient.set(cacheKey, JSON.stringify(validatorInfo), { EX: 60 });
    
    res.json(validatorInfo);
  } catch (error) {
    console.error(`Error getting validator info for ${req.params.address}:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get validator information'
    });
  }
});

/**
 * Create a new account
 * @route POST /api/account/create
 */
router.post('/create', async (req, res) => {
  try {
    const { network = 'layer2' } = req.body;
    
    // Generate a new keypair
    const keypair = new PublicKey(Buffer.from(Array(32).fill(0))); // This is just a placeholder
    
    // In a real implementation, you would generate a real keypair
    // and potentially fund it with a small amount of SOL
    
    res.json({
      address: keypair.toString(),
      secretKey: '[Secret key would be returned here]',
      network
    });
  } catch (error) {
    console.error('Error creating account:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create account'
    });
  }
});

export default router;
