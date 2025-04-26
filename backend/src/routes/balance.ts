import express from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import { solanaConnection, layer2Connection, redisClient } from '../index';
import { getTokenAccountsByOwner } from '@solana/spl-token';

const router = express.Router();

/**
 * Get balance for a wallet address on Solana L1
 * @route GET /api/balance/solana/:address
 */
router.get('/solana/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
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
    const cacheKey = `balance:solana:${address}`;
    const cachedBalance = await redisClient.get(cacheKey);
    
    if (cachedBalance) {
      return res.json(JSON.parse(cachedBalance));
    }
    
    // Get SOL balance
    const solBalance = await solanaConnection.getBalance(pubkey);
    
    // Get token balances
    const tokenAccounts = await solanaConnection.getParsedTokenAccountsByOwner(
      pubkey,
      { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
    );
    
    const tokenBalances = tokenAccounts.value.map(account => {
      const parsedInfo = account.account.data.parsed.info;
      return {
        mint: parsedInfo.mint,
        amount: parsedInfo.tokenAmount.amount,
        decimals: parsedInfo.tokenAmount.decimals,
        uiAmount: parsedInfo.tokenAmount.uiAmount
      };
    });
    
    const result = {
      address,
      solBalance,
      tokenBalances
    };
    
    // Cache result for 30 seconds
    await redisClient.set(cacheKey, JSON.stringify(result), { EX: 30 });
    
    res.json(result);
  } catch (error) {
    console.error('Error getting Solana balance:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get Solana balance'
    });
  }
});

/**
 * Get balance for a wallet address on Layer-2
 * @route GET /api/balance/layer2/:address
 */
router.get('/layer2/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
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
    const cacheKey = `balance:layer2:${address}`;
    const cachedBalance = await redisClient.get(cacheKey);
    
    if (cachedBalance) {
      return res.json(JSON.parse(cachedBalance));
    }
    
    // Get SOL balance on Layer-2
    const solBalance = await layer2Connection.getBalance(pubkey);
    
    // Get token balances on Layer-2
    const tokenAccounts = await layer2Connection.getParsedTokenAccountsByOwner(
      pubkey,
      { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
    );
    
    const tokenBalances = tokenAccounts.value.map(account => {
      const parsedInfo = account.account.data.parsed.info;
      return {
        mint: parsedInfo.mint,
        amount: parsedInfo.tokenAmount.amount,
        decimals: parsedInfo.tokenAmount.decimals,
        uiAmount: parsedInfo.tokenAmount.uiAmount
      };
    });
    
    const result = {
      address,
      solBalance,
      tokenBalances
    };
    
    // Cache result for 30 seconds
    await redisClient.set(cacheKey, JSON.stringify(result), { EX: 30 });
    
    res.json(result);
  } catch (error) {
    console.error('Error getting Layer-2 balance:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get Layer-2 balance'
    });
  }
});

/**
 * Get combined balances for a wallet address on both Solana L1 and Layer-2
 * @route GET /api/balance/combined/:address
 */
router.get('/combined/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
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
    const cacheKey = `balance:combined:${address}`;
    const cachedBalance = await redisClient.get(cacheKey);
    
    if (cachedBalance) {
      return res.json(JSON.parse(cachedBalance));
    }
    
    // Get Solana L1 balance
    const solanaResponse = await fetch(`http://localhost:${process.env.PORT || 3001}/api/balance/solana/${address}`);
    const solanaData = await solanaResponse.json();
    
    // Get Layer-2 balance
    const layer2Response = await fetch(`http://localhost:${process.env.PORT || 3001}/api/balance/layer2/${address}`);
    const layer2Data = await layer2Response.json();
    
    const result = {
      address,
      solana: solanaData,
      layer2: layer2Data
    };
    
    // Cache result for 30 seconds
    await redisClient.set(cacheKey, JSON.stringify(result), { EX: 30 });
    
    res.json(result);
  } catch (error) {
    console.error('Error getting combined balance:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get combined balance'
    });
  }
});

export default router;
