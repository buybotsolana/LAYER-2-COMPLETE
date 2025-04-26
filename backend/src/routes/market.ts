import express from 'express';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { solanaConnection, layer2Connection, redisClient } from '../index';

const router = express.Router();

/**
 * Get market overview
 * @route GET /api/market/overview
 */
router.get('/overview', async (req, res) => {
  try {
    // Check cache first
    const cacheKey = 'market:overview';
    const cachedData = await redisClient.get(cacheKey);
    
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }
    
    // In a real implementation, this would fetch data from various sources
    // For demonstration purposes, we'll return mock data
    const marketData = {
      totalValueLocked: 1250000000, // $1.25B
      dailyVolume: 75000000, // $75M
      transactions: {
        last24h: 1250000,
        avgBlockTime: 0.4, // seconds
        tps: 2500
      },
      tokens: {
        count: 150,
        topByVolume: [
          { symbol: 'SOL', volume: 25000000, priceChange24h: 3.5 },
          { symbol: 'USDC', volume: 15000000, priceChange24h: 0.01 },
          { symbol: 'ETH', volume: 10000000, priceChange24h: 2.1 },
          { symbol: 'BTC', volume: 8000000, priceChange24h: 1.8 },
          { symbol: 'USDT', volume: 7000000, priceChange24h: 0.02 }
        ]
      },
      layer2Stats: {
        blockHeight: 12345678,
        finalizedHeight: 12345670,
        pendingTransactions: 1250,
        activeValidators: 100,
        totalStake: 5000000 // 5M SOL
      },
      timestamp: new Date().toISOString()
    };
    
    // Cache result for 60 seconds
    await redisClient.set(cacheKey, JSON.stringify(marketData), { EX: 60 });
    
    res.json(marketData);
  } catch (error) {
    console.error('Error getting market overview:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get market overview'
    });
  }
});

/**
 * Get token price data
 * @route GET /api/market/token/:symbol
 */
router.get('/token/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    // Check cache first
    const cacheKey = `market:token:${symbol.toLowerCase()}`;
    const cachedData = await redisClient.get(cacheKey);
    
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }
    
    // In a real implementation, this would fetch data from price oracles or APIs
    // For demonstration purposes, we'll return mock data
    const mockTokenData = {
      symbol: symbol.toUpperCase(),
      name: getTokenName(symbol),
      price: getRandomPrice(symbol),
      marketCap: getRandomMarketCap(symbol),
      volume24h: getRandomVolume(symbol),
      priceChange: {
        '1h': getRandomPriceChange(),
        '24h': getRandomPriceChange(),
        '7d': getRandomPriceChange(),
        '30d': getRandomPriceChange()
      },
      high24h: getRandomHighPrice(symbol),
      low24h: getRandomLowPrice(symbol),
      allTimeHigh: getRandomATH(symbol),
      allTimeHighDate: '2021-11-10T14:24:11.000Z',
      priceHistory: generatePriceHistory(),
      timestamp: new Date().toISOString()
    };
    
    // Cache result for 30 seconds
    await redisClient.set(cacheKey, JSON.stringify(mockTokenData), { EX: 30 });
    
    res.json(mockTokenData);
  } catch (error) {
    console.error(`Error getting token data for ${req.params.symbol}:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get token data'
    });
  }
});

/**
 * Get top tokens by volume
 * @route GET /api/market/top-tokens
 */
router.get('/top-tokens', async (req, res) => {
  try {
    const { limit = '10' } = req.query;
    const limitNum = parseInt(limit as string, 10);
    
    // Check cache first
    const cacheKey = `market:top-tokens:${limitNum}`;
    const cachedData = await redisClient.get(cacheKey);
    
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }
    
    // In a real implementation, this would fetch data from a database or API
    // For demonstration purposes, we'll return mock data
    const topTokens = [
      { symbol: 'SOL', name: 'Solana', volume: 25000000, price: 150.25, priceChange24h: 3.5 },
      { symbol: 'USDC', name: 'USD Coin', volume: 15000000, price: 1.00, priceChange24h: 0.01 },
      { symbol: 'ETH', name: 'Ethereum', volume: 10000000, price: 3500.75, priceChange24h: 2.1 },
      { symbol: 'BTC', name: 'Bitcoin', volume: 8000000, price: 65000.50, priceChange24h: 1.8 },
      { symbol: 'USDT', name: 'Tether', volume: 7000000, price: 1.00, priceChange24h: 0.02 },
      { symbol: 'BONK', name: 'Bonk', volume: 5000000, price: 0.00002, priceChange24h: 15.0 },
      { symbol: 'RAY', name: 'Raydium', volume: 4500000, price: 2.75, priceChange24h: 5.2 },
      { symbol: 'SRM', name: 'Serum', volume: 4000000, price: 1.85, priceChange24h: 4.3 },
      { symbol: 'ORCA', name: 'Orca', volume: 3500000, price: 1.25, priceChange24h: 3.8 },
      { symbol: 'MNGO', name: 'Mango', volume: 3000000, price: 0.45, priceChange24h: 7.2 },
      { symbol: 'SAMO', name: 'Samoyedcoin', volume: 2500000, price: 0.025, priceChange24h: 9.5 },
      { symbol: 'ATLAS', name: 'Star Atlas', volume: 2000000, price: 0.015, priceChange24h: 6.7 },
      { symbol: 'POLIS', name: 'Star Atlas DAO', volume: 1800000, price: 0.85, priceChange24h: 5.9 },
      { symbol: 'COPE', name: 'Cope', volume: 1600000, price: 0.35, priceChange24h: 4.1 },
      { symbol: 'FIDA', name: 'Bonfida', volume: 1400000, price: 0.65, priceChange24h: 3.2 }
    ].slice(0, limitNum);
    
    // Cache result for 60 seconds
    await redisClient.set(cacheKey, JSON.stringify(topTokens), { EX: 60 });
    
    res.json(topTokens);
  } catch (error) {
    console.error('Error getting top tokens:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get top tokens'
    });
  }
});

/**
 * Get Layer-2 statistics
 * @route GET /api/market/layer2-stats
 */
router.get('/layer2-stats', async (req, res) => {
  try {
    // Check cache first
    const cacheKey = 'market:layer2-stats';
    const cachedData = await redisClient.get(cacheKey);
    
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }
    
    // Get actual block height from Layer-2
    const blockHeight = await layer2Connection.getBlockHeight();
    
    // In a real implementation, this would fetch more data from Layer-2
    // For demonstration purposes, we'll combine real and mock data
    const layer2Stats = {
      blockHeight,
      finalizedHeight: blockHeight - 8, // Assume 8 blocks behind
      pendingTransactions: Math.floor(Math.random() * 2000) + 500,
      activeValidators: 100,
      totalStake: 5000000, // 5M SOL
      tps: {
        current: Math.floor(Math.random() * 1500) + 1000,
        peak: 3500,
        average: 2200
      },
      gasPrice: {
        slow: 5,
        average: 10,
        fast: 20
      },
      bridgeStats: {
        totalBridged: 750000000, // $750M
        activeTransfers: Math.floor(Math.random() * 100) + 50,
        last24h: {
          deposits: Math.floor(Math.random() * 5000) + 2000,
          withdrawals: Math.floor(Math.random() * 4000) + 1000
        }
      },
      timestamp: new Date().toISOString()
    };
    
    // Cache result for 15 seconds
    await redisClient.set(cacheKey, JSON.stringify(layer2Stats), { EX: 15 });
    
    res.json(layer2Stats);
  } catch (error) {
    console.error('Error getting Layer-2 stats:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get Layer-2 stats'
    });
  }
});

// Helper functions for generating mock data
function getTokenName(symbol: string): string {
  const tokenNames = {
    'SOL': 'Solana',
    'USDC': 'USD Coin',
    'ETH': 'Ethereum',
    'BTC': 'Bitcoin',
    'USDT': 'Tether',
    'BONK': 'Bonk',
    'RAY': 'Raydium',
    'SRM': 'Serum',
    'ORCA': 'Orca',
    'MNGO': 'Mango'
  };
  
  return tokenNames[symbol.toUpperCase()] || 'Unknown Token';
}

function getRandomPrice(symbol: string): number {
  const basePrices = {
    'SOL': 150,
    'USDC': 1,
    'ETH': 3500,
    'BTC': 65000,
    'USDT': 1,
    'BONK': 0.00002,
    'RAY': 2.75,
    'SRM': 1.85,
    'ORCA': 1.25,
    'MNGO': 0.45
  };
  
  const basePrice = basePrices[symbol.toUpperCase()] || 1;
  const variation = basePrice * 0.05; // 5% variation
  
  return basePrice + (Math.random() * variation * 2 - variation);
}

function getRandomMarketCap(symbol: string): number {
  const baseMarketCaps = {
    'SOL': 50000000000, // $50B
    'USDC': 25000000000, // $25B
    'ETH': 400000000000, // $400B
    'BTC': 1200000000000, // $1.2T
    'USDT': 80000000000, // $80B
    'BONK': 500000000, // $500M
    'RAY': 300000000, // $300M
    'SRM': 200000000, // $200M
    'ORCA': 150000000, // $150M
    'MNGO': 100000000 // $100M
  };
  
  return baseMarketCaps[symbol.toUpperCase()] || 10000000;
}

function getRandomVolume(symbol: string): number {
  const baseVolumes = {
    'SOL': 25000000,
    'USDC': 15000000,
    'ETH': 10000000,
    'BTC': 8000000,
    'USDT': 7000000,
    'BONK': 5000000,
    'RAY': 4500000,
    'SRM': 4000000,
    'ORCA': 3500000,
    'MNGO': 3000000
  };
  
  const baseVolume = baseVolumes[symbol.toUpperCase()] || 1000000;
  const variation = baseVolume * 0.2; // 20% variation
  
  return baseVolume + (Math.random() * variation * 2 - variation);
}

function getRandomPriceChange(): number {
  return (Math.random() * 20 - 10).toFixed(2) as unknown as number; // -10% to +10%
}

function getRandomHighPrice(symbol: string): number {
  const price = getRandomPrice(symbol);
  return price * (1 + Math.random() * 0.1); // Up to 10% higher
}

function getRandomLowPrice(symbol: string): number {
  const price = getRandomPrice(symbol);
  return price * (1 - Math.random() * 0.1); // Up to 10% lower
}

function getRandomATH(symbol: string): number {
  const price = getRandomPrice(symbol);
  return price * (1.5 + Math.random()); // 1.5x to 2.5x current price
}

function generatePriceHistory(): Array<{ timestamp: string; price: number }> {
  const now = new Date();
  const history = [];
  
  // Generate 24 hourly data points
  for (let i = 0; i < 24; i++) {
    const timestamp = new Date(now.getTime() - (23 - i) * 60 * 60 * 1000).toISOString();
    const price = 100 + Math.sin(i / 3) * 10 + (Math.random() * 5 - 2.5);
    
    history.push({
      timestamp,
      price
    });
  }
  
  return history;
}

export default router;
