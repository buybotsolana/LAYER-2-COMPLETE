import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { Connection, PublicKey } from '@solana/web3.js';
import { createClient } from 'redis';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const port = process.env.PORT || 3001;

// Initialize Prisma client for database access
const prisma = new PrismaClient();

// Initialize Redis client for caching
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

// Connect to Redis
(async () => {
  redisClient.on('error', (err) => console.error('Redis Client Error', err));
  await redisClient.connect();
})();

// Initialize Solana connection
const solanaConnection = new Connection(
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  'confirmed'
);

// Initialize Layer-2 connection
const layer2Connection = new Connection(
  process.env.LAYER2_RPC_URL || 'https://api.l2-solana.com',
  'confirmed'
);

// Middleware
app.use(cors());
app.use(helmet());
app.use(morgan('combined'));
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// API Routes
import balanceRoutes from './routes/balance';
import bridgeRoutes from './routes/bridge';
import marketRoutes from './routes/market';
import transactionRoutes from './routes/transaction';
import accountRoutes from './routes/account';

// Register routes
app.use('/api/balance', balanceRoutes);
app.use('/api/bridge', bridgeRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/transaction', transactionRoutes);
app.use('/api/account', accountRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Backend server running on port ${port}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await prisma.$disconnect();
  await redisClient.quit();
  process.exit(0);
});

export { app, prisma, redisClient, solanaConnection, layer2Connection };
