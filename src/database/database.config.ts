// English comment for verification
/**
 * @file database.config.ts
 * @description Configuration for database connection and ORM settings
 * @module database/config
 */

import { ConnectionOptions } from 'typeorm';
import { Transaction } from '../transaction/transaction.entity';
import { Bundle } from '../sequencer/bundle.entity';
import { GasPrice } from '../gas/gas-price.entity';
import { BridgeTransaction } from '../bridge/bridge-transaction.entity';
import { SystemState } from '../system/system-state.entity';
import { TokenMapping } from '../bridge/token-mapping.entity';
import { FeeStatistic } from '../gas/fee-statistic.entity';
import { MonitoringEvent } from '../monitoring/monitoring-event.entity';

/**
 * Database connection configuration for PostgreSQL
 * In production, these values should be loaded from environment variables
 */
export const databaseConfig: ConnectionOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'layer2_complete',
  synchronize: process.env.NODE_ENV !== 'production', // Auto-create schema in development
  logging: process.env.NODE_ENV !== 'production',
  entities: [
    Transaction,
    Bundle,
    GasPrice,
    BridgeTransaction,
    SystemState,
    TokenMapping,
    FeeStatistic,
    MonitoringEvent
  ],
  migrations: ['src/database/migrations/**/*.ts'],
  subscribers: ['src/database/subscribers/**/*.ts'],
  cli: {
    entitiesDir: 'src/database/entities',
    migrationsDir: 'src/database/migrations',
    subscribersDir: 'src/database/subscribers'
  },
  // Connection pool settings for high performance
  extra: {
    // Maximum number of clients the pool should contain
    max: parseInt(process.env.DB_POOL_SIZE || '20', 10),
    // Connection timeout in milliseconds
    connectionTimeoutMillis: 10000,
    // Idle timeout in milliseconds
    idleTimeoutMillis: 30000
  }
};

/**
 * Database connection configuration for testing
 * Uses in-memory SQLite database for fast test execution
 */
export const testDatabaseConfig: ConnectionOptions = {
  type: 'sqlite',
  database: ':memory:',
  dropSchema: true,
  synchronize: true,
  logging: false,
  entities: [
    Transaction,
    Bundle,
    GasPrice,
    BridgeTransaction,
    SystemState,
    TokenMapping,
    FeeStatistic,
    MonitoringEvent
  ]
};
