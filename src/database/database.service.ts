// English comment for verification
/**
 * @file database.service.ts
 * @description Enhanced service for database connection management and operations with PostgreSQL
 * @module database/service
 */

import { createConnection, Connection, Repository, EntityTarget, QueryRunner } from 'typeorm';
import { databaseConfig } from './database.config';
import { Logger } from '../utils/logger';

/**
 * Service that manages database connections and provides access to repositories
 * Implements singleton pattern to ensure only one database connection is created
 * Enhanced with PostgreSQL-specific features and performance optimizations
 */
export class DatabaseService {
  private static instance: DatabaseService;
  private connection: Connection | null = null;
  private logger: Logger;
  private repositories: Map<string, Repository<any>> = new Map();
  private isInitialized: boolean = false;
  private maintenanceLastRun: Date | null = null;

  /**
   * Private constructor to prevent direct instantiation
   * Use DatabaseService.getInstance() instead
   */
  private constructor() {
    this.logger = new Logger('DatabaseService');
  }

  /**
   * Gets the singleton instance of DatabaseService
   * 
   * @returns The singleton instance
   */
  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  /**
   * Initializes the database connection
   * 
   * @returns Promise resolving to the database connection
   * @throws Error if connection fails
   */
  public async initialize(): Promise<Connection> {
    try {
      if (!this.connection || !this.connection.isConnected) {
        this.logger.info('Initializing database connection to PostgreSQL');
        this.connection = await createConnection(databaseConfig);
        this.logger.info('Database connection established successfully');
        
        // Run migrations if in production mode
        if (process.env.NODE_ENV === 'production') {
          this.logger.info('Running database migrations');
          await this.connection.runMigrations();
          this.logger.info('Database migrations completed successfully');
        }
        
        this.isInitialized = true;
      }
      return this.connection;
    } catch (error) {
      this.logger.error('Failed to initialize database connection', { error });
      throw new Error(`Database connection failed: ${error.message}`);
    }
  }

  /**
   * Gets a repository for the specified entity
   * 
   * @param entity - Entity class
   * @returns Repository for the entity
   * @throws Error if database is not initialized
   */
  public getRepository<T>(entity: EntityTarget<T>): Repository<T> {
    if (!this.connection || !this.connection.isConnected) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    const entityName = entity.toString();
    
    // Return cached repository if available
    if (this.repositories.has(entityName)) {
      return this.repositories.get(entityName) as Repository<T>;
    }

    // Create and cache new repository
    const repository = this.connection.getRepository(entity);
    this.repositories.set(entityName, repository);
    return repository;
  }

  /**
   * Closes the database connection
   * 
   * @returns Promise resolving when connection is closed
   */
  public async close(): Promise<void> {
    if (this.connection && this.connection.isConnected) {
      this.logger.info('Closing database connection');
      await this.connection.close();
      this.connection = null;
      this.repositories.clear();
      this.isInitialized = false;
      this.logger.info('Database connection closed successfully');
    }
  }

  /**
   * Executes a function within a transaction
   * 
   * @param callback - Function to execute within the transaction
   * @returns Promise resolving to the result of the callback
   * @throws Error if transaction fails
   */
  public async transaction<T>(callback: (queryRunner: QueryRunner) => Promise<T>): Promise<T> {
    if (!this.connection || !this.connection.isConnected) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    const queryRunner = this.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const result = await callback(queryRunner);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      this.logger.error('Transaction failed, rolling back', { error });
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Checks if the database service is initialized
   * 
   * @returns True if the database service is initialized, false otherwise
   */
  public isInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Checks if the database connection is established
   * 
   * @returns Promise resolving to true if connected, false otherwise
   */
  public async isConnected(): Promise<boolean> {
    return this.connection !== null && this.connection.isConnected;
  }

  /**
   * Performs database maintenance tasks
   * - Vacuums the database to reclaim storage
   * - Analyzes tables for query optimization
   * - Removes old monitoring events
   * 
   * @returns Promise resolving when maintenance is complete
   */
  public async performMaintenance(): Promise<void> {
    if (!this.connection || !this.connection.isConnected) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    // Only run maintenance once per day
    const now = new Date();
    if (this.maintenanceLastRun && 
        now.getTime() - this.maintenanceLastRun.getTime() < 24 * 60 * 60 * 1000) {
      this.logger.debug('Skipping database maintenance, last run less than 24 hours ago');
      return;
    }

    this.logger.info('Performing database maintenance');

    try {
      // Run VACUUM to reclaim storage and update statistics
      await this.connection.query('VACUUM ANALYZE');
      
      // Remove old monitoring events (older than 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const monitoringEventRepo = this.getRepository('MonitoringEvent');
      await monitoringEventRepo.createQueryBuilder()
        .delete()
        .where('createdAt < :date', { date: thirtyDaysAgo })
        .execute();
      
      // Update maintenance timestamp
      this.maintenanceLastRun = now;
      
      this.logger.info('Database maintenance completed successfully');
    } catch (error) {
      this.logger.error('Failed to perform database maintenance', { error });
      throw new Error(`Database maintenance failed: ${error.message}`);
    }
  }

  /**
   * Creates a database backup
   * 
   * @param backupPath - Path where the backup should be stored
   * @returns Promise resolving to the backup file path
   */
  public async createBackup(backupPath: string): Promise<string> {
    if (!this.connection || !this.connection.isConnected) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    this.logger.info('Creating database backup', { backupPath });

    try {
      // Use pg_dump to create a backup
      const { exec } = require('child_process');
      const util = require('util');
      const execPromise = util.promisify(exec);
      
      const dbConfig = databaseConfig as any;
      const command = `PGPASSWORD="${dbConfig.password}" pg_dump -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.username} -F c -b -v -f "${backupPath}" ${dbConfig.database}`;
      
      await execPromise(command);
      
      this.logger.info('Database backup created successfully', { backupPath });
      return backupPath;
    } catch (error) {
      this.logger.error('Failed to create database backup', { error, backupPath });
      throw new Error(`Database backup failed: ${error.message}`);
    }
  }

  /**
   * Restores a database from backup
   * 
   * @param backupPath - Path to the backup file
   * @returns Promise resolving when restore is complete
   */
  public async restoreFromBackup(backupPath: string): Promise<void> {
    if (this.connection && this.connection.isConnected) {
      await this.close();
    }

    this.logger.info('Restoring database from backup', { backupPath });

    try {
      // Use pg_restore to restore from backup
      const { exec } = require('child_process');
      const util = require('util');
      const execPromise = util.promisify(exec);
      
      const dbConfig = databaseConfig as any;
      const command = `PGPASSWORD="${dbConfig.password}" pg_restore -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.username} -d ${dbConfig.database} -c -v "${backupPath}"`;
      
      await execPromise(command);
      
      // Reconnect to the database
      await this.initialize();
      
      this.logger.info('Database restored successfully from backup', { backupPath });
    } catch (error) {
      this.logger.error('Failed to restore database from backup', { error, backupPath });
      throw new Error(`Database restore failed: ${error.message}`);
    }
  }

  /**
   * Gets database statistics
   * 
   * @returns Promise resolving to database statistics
   */
  public async getStatistics(): Promise<any> {
    if (!this.connection || !this.connection.isConnected) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    try {
      // Get database size
      const sizeResult = await this.connection.query(`
        SELECT pg_size_pretty(pg_database_size(current_database())) as size,
               pg_database_size(current_database()) as size_bytes
      `);
      
      // Get table statistics
      const tableStatsResult = await this.connection.query(`
        SELECT
          relname as table_name,
          n_live_tup as row_count,
          pg_size_pretty(pg_total_relation_size(relid)) as total_size,
          pg_size_pretty(pg_relation_size(relid)) as table_size,
          pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) as index_size
        FROM pg_stat_user_tables
        ORDER BY n_live_tup DESC
      `);
      
      // Get connection statistics
      const connectionStatsResult = await this.connection.query(`
        SELECT count(*) as active_connections
        FROM pg_stat_activity
        WHERE datname = current_database()
      `);
      
      return {
        database: {
          name: databaseConfig.database,
          size: sizeResult[0].size,
          size_bytes: parseInt(sizeResult[0].size_bytes, 10)
        },
        tables: tableStatsResult,
        connections: {
          active: parseInt(connectionStatsResult[0].active_connections, 10),
          pool_size: (databaseConfig as any).extra.max
        },
        maintenance_last_run: this.maintenanceLastRun
      };
    } catch (error) {
      this.logger.error('Failed to get database statistics', { error });
      throw new Error(`Failed to get database statistics: ${error.message}`);
    }
  }
}
