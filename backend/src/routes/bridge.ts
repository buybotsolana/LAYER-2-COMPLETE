import express from 'express';
import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { solanaConnection, layer2Connection, redisClient } from '../index';
import WormholeBridge from '../services/WormholeBridge';
import * as bs58 from 'bs58';

const router = express.Router();

// Initialize Wormhole Bridge
const initWormholeBridge = () => {
  try {
    // Get payer secret key from environment variable
    const payerSecretKey = process.env.BRIDGE_PAYER_SECRET_KEY;
    if (!payerSecretKey) {
      throw new Error('BRIDGE_PAYER_SECRET_KEY environment variable not set');
    }
    
    const payerSecret = bs58.decode(payerSecretKey);
    
    return new WormholeBridge(
      solanaConnection,
      layer2Connection,
      payerSecret
    );
  } catch (error) {
    console.error('Failed to initialize Wormhole Bridge:', error);
    throw error;
  }
};

let wormholeBridge: WormholeBridge;

// Lazy initialization of Wormhole Bridge
const getWormholeBridge = () => {
  if (!wormholeBridge) {
    wormholeBridge = initWormholeBridge();
  }
  return wormholeBridge;
};

/**
 * Get bridge status
 * @route GET /api/bridge/status
 */
router.get('/status', async (req, res) => {
  try {
    const bridge = getWormholeBridge();
    const stats = await bridge.getBridgeStats();
    
    res.json({
      status: 'operational',
      stats
    });
  } catch (error) {
    console.error('Error getting bridge status:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get bridge status'
    });
  }
});

/**
 * Transfer tokens from Solana L1 to Layer-2
 * @route POST /api/bridge/deposit
 */
router.post('/deposit', async (req, res) => {
  try {
    const { tokenMint, amount, sender, recipient } = req.body;
    
    // Validate parameters
    if (!tokenMint || !amount || !sender || !recipient) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required parameters: tokenMint, amount, sender, recipient'
      });
    }
    
    // Validate token mint
    let tokenMintPubkey: PublicKey;
    try {
      tokenMintPubkey = new PublicKey(tokenMint);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid token mint',
        message: 'The provided token mint is not a valid Solana address'
      });
    }
    
    // Validate sender
    let senderPubkey: PublicKey;
    try {
      senderPubkey = new PublicKey(sender);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid sender',
        message: 'The provided sender is not a valid Solana address'
      });
    }
    
    // Initialize bridge
    const bridge = getWormholeBridge();
    
    // Lock tokens and initiate transfer
    const signature = await bridge.lockTokensAndInitiateTransfer(
      tokenMintPubkey,
      amount,
      senderPubkey,
      recipient
    );
    
    res.json({
      success: true,
      signature,
      message: 'Transfer initiated successfully'
    });
  } catch (error) {
    console.error('Error initiating bridge deposit:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to initiate bridge deposit'
    });
  }
});

/**
 * Transfer tokens from Layer-2 to Solana L1
 * @route POST /api/bridge/withdraw
 */
router.post('/withdraw', async (req, res) => {
  try {
    const { tokenMint, amount, sender, recipient } = req.body;
    
    // Validate parameters
    if (!tokenMint || !amount || !sender || !recipient) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required parameters: tokenMint, amount, sender, recipient'
      });
    }
    
    // Validate token mint
    let tokenMintPubkey: PublicKey;
    try {
      tokenMintPubkey = new PublicKey(tokenMint);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid token mint',
        message: 'The provided token mint is not a valid Solana address'
      });
    }
    
    // Validate sender
    let senderPubkey: PublicKey;
    try {
      senderPubkey = new PublicKey(sender);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid sender',
        message: 'The provided sender is not a valid Solana address'
      });
    }
    
    // Initialize bridge
    const bridge = getWormholeBridge();
    
    // Burn tokens and initiate transfer
    const signature = await bridge.burnTokensAndInitiateTransfer(
      tokenMintPubkey,
      amount,
      senderPubkey,
      recipient
    );
    
    res.json({
      success: true,
      signature,
      message: 'Transfer initiated successfully'
    });
  } catch (error) {
    console.error('Error initiating bridge withdrawal:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to initiate bridge withdrawal'
    });
  }
});

/**
 * Get transaction status
 * @route GET /api/bridge/transaction/:signature
 */
router.get('/transaction/:signature', async (req, res) => {
  try {
    const { signature } = req.params;
    const { isLayer2 } = req.query;
    
    // Initialize bridge
    const bridge = getWormholeBridge();
    
    // Get transaction status
    const status = await bridge.getBridgeTransactionStatus(
      signature,
      isLayer2 === 'true'
    );
    
    res.json(status);
  } catch (error) {
    console.error('Error getting transaction status:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get transaction status'
    });
  }
});

/**
 * Get supported tokens
 * @route GET /api/bridge/tokens
 */
router.get('/tokens', async (req, res) => {
  try {
    // This would typically come from a database or configuration
    // For demonstration purposes, we'll return a static list
    const supportedTokens = [
      {
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
        logoUri: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
        solanaAddress: 'So11111111111111111111111111111111111111112',
        layer2Address: 'So11111111111111111111111111111111111111112'
      },
      {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        logoUri: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
        solanaAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        layer2Address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      },
      {
        symbol: 'USDT',
        name: 'Tether USD',
        decimals: 6,
        logoUri: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg',
        solanaAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        layer2Address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
      }
    ];
    
    res.json(supportedTokens);
  } catch (error) {
    console.error('Error getting supported tokens:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get supported tokens'
    });
  }
});

export default router;
