import express from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import { solanaConnection, layer2Connection, redisClient } from '../index';
import SecurityManager from '../security/SecurityManager';

const router = express.Router();

// Initialize Security Manager
const initSecurityManager = () => {
  try {
    return new SecurityManager(
      solanaConnection,
      layer2Connection,
      {
        maxRequestsPerMinute: parseInt(process.env.SECURITY_MAX_REQUESTS_PER_MINUTE || '60'),
        maxTransactionsPerBlock: parseInt(process.env.SECURITY_MAX_TRANSACTIONS_PER_BLOCK || '1000'),
        nonceExpirationBlocks: parseInt(process.env.SECURITY_NONCE_EXPIRATION_BLOCKS || '100'),
        maxTransactionSize: parseInt(process.env.SECURITY_MAX_TRANSACTION_SIZE || '10240'),
        apiKeySecret: process.env.SECURITY_API_KEY_SECRET || 'default_secret_change_me',
        replayCacheTTLSeconds: parseInt(process.env.SECURITY_REPLAY_CACHE_TTL_SECONDS || '3600'),
        lockTimeoutMs: parseInt(process.env.SECURITY_LOCK_TIMEOUT_MS || '5000')
      }
    );
  } catch (error) {
    console.error('Failed to initialize Security Manager:', error);
    throw error;
  }
};

let securityManager: SecurityManager;

// Lazy initialization of Security Manager
const getSecurityManager = () => {
  if (!securityManager) {
    securityManager = initSecurityManager();
  }
  return securityManager;
};

/**
 * Get security status
 * @route GET /api/security/status
 */
router.get('/status', async (req, res) => {
  try {
    const security = getSecurityManager();
    
    // Get current block height for nonce cleanup reference
    const blockHeight = await layer2Connection.getBlockHeight();
    
    res.json({
      status: 'operational',
      blockHeight,
      nonceExpirationBlocks: security.securityConfig?.nonceExpirationBlocks || 100,
      maxRequestsPerMinute: security.securityConfig?.maxRequestsPerMinute || 60,
      maxTransactionSize: security.securityConfig?.maxTransactionSize || 10240
    });
  } catch (error) {
    console.error('Error getting security status:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get security status'
    });
  }
});

/**
 * Verify transaction nonce
 * @route POST /api/security/verify-nonce
 */
router.post('/verify-nonce', async (req, res) => {
  try {
    const { transaction, nonce } = req.body;
    
    if (!transaction || !nonce) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required parameters: transaction, nonce'
      });
    }
    
    const security = getSecurityManager();
    
    // Verify nonce
    const isValid = await security.verifyNonce(transaction, nonce);
    
    res.json({
      valid: isValid,
      nonce
    });
  } catch (error) {
    console.error('Error verifying nonce:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to verify nonce'
    });
  }
});

/**
 * Validate transaction
 * @route POST /api/security/validate-transaction
 */
router.post('/validate-transaction', async (req, res) => {
  try {
    const { transaction } = req.body;
    
    if (!transaction) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required parameter: transaction'
      });
    }
    
    const security = getSecurityManager();
    
    // Validate transaction
    const validationResult = security.validateTransaction(transaction);
    
    res.json(validationResult);
  } catch (error) {
    console.error('Error validating transaction:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to validate transaction'
    });
  }
});

/**
 * Check for replay attacks
 * @route POST /api/security/check-replay
 */
router.post('/check-replay', async (req, res) => {
  try {
    const { transactionId } = req.body;
    
    if (!transactionId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required parameter: transactionId'
      });
    }
    
    const security = getSecurityManager();
    
    // Check for replay attack
    const isReplay = security.checkReplayAttack(transactionId);
    
    res.json({
      isReplay,
      transactionId
    });
  } catch (error) {
    console.error('Error checking for replay attack:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to check for replay attack'
    });
  }
});

/**
 * Verify API key
 * @route POST /api/security/verify-api-key
 */
router.post('/verify-api-key', async (req, res) => {
  try {
    const { apiKey, timestamp, signature } = req.body;
    
    if (!apiKey || !timestamp || !signature) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required parameters: apiKey, timestamp, signature'
      });
    }
    
    const security = getSecurityManager();
    
    // Verify API key
    const isValid = security.verifyApiKey(apiKey, timestamp, signature);
    
    res.json({
      valid: isValid,
      apiKey
    });
  } catch (error) {
    console.error('Error verifying API key:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to verify API key'
    });
  }
});

/**
 * Generate API key
 * @route POST /api/security/generate-api-key
 */
router.post('/generate-api-key', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required parameter: userId'
      });
    }
    
    const security = getSecurityManager();
    
    // Generate API key
    const apiKeyInfo = security.generateApiKey(userId);
    
    // In a real implementation, you would store this in a database
    
    res.json(apiKeyInfo);
  } catch (error) {
    console.error('Error generating API key:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to generate API key'
    });
  }
});

/**
 * Detect fraud in block
 * @route GET /api/security/detect-fraud/:blockNumber
 */
router.get('/detect-fraud/:blockNumber', async (req, res) => {
  try {
    const { blockNumber } = req.params;
    
    if (!blockNumber || isNaN(parseInt(blockNumber))) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid block number'
      });
    }
    
    const security = getSecurityManager();
    
    // Detect fraud in block
    const fraudDetectionResult = await security.detectFraudInBlock(parseInt(blockNumber));
    
    res.json(fraudDetectionResult);
  } catch (error) {
    console.error(`Error detecting fraud in block ${req.params.blockNumber}:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to detect fraud in block'
    });
  }
});

/**
 * Verify validator stake
 * @route GET /api/security/verify-validator-stake/:address
 */
router.get('/verify-validator-stake/:address', async (req, res) => {
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
    
    const security = getSecurityManager();
    
    // Verify validator stake
    const hasStake = await security.verifyValidatorStake(pubkey);
    
    res.json({
      address,
      hasStake,
      minStakeRequired: security.securityConfig?.minStakeForValidator.toString() || 'unknown'
    });
  } catch (error) {
    console.error(`Error verifying validator stake for ${req.params.address}:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to verify validator stake'
    });
  }
});

/**
 * Check rate limit
 * @route GET /api/security/check-rate-limit/:clientId
 */
router.get('/check-rate-limit/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    
    if (!clientId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required parameter: clientId'
      });
    }
    
    const security = getSecurityManager();
    
    // Check rate limit
    const allowed = security.checkRateLimit(clientId);
    
    res.json({
      clientId,
      allowed,
      maxRequestsPerMinute: security.securityConfig?.maxRequestsPerMinute || 60
    });
  } catch (error) {
    console.error(`Error checking rate limit for ${req.params.clientId}:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to check rate limit'
    });
  }
});

export default router;
