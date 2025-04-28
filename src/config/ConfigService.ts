// English comment for verification
/**
 * @file ConfigService.ts
 * @description Enhanced configuration service with secure secrets management
 * @author Manus AI
 * @date April 27, 2025
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { Logger } from '../utils/Logger';
import { SecretsManager } from './SecretsManager';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

/**
 * Enhanced configuration service with secure secrets management
 */
@Injectable()
export class ConfigService implements OnModuleInit {
  private readonly logger: Logger;
  private readonly configPath: string;
  private config: any = {};
  private isInitialized: boolean = false;
  
  /**
   * Constructor for ConfigService
   * 
   * @param secretsManager - Secrets manager
   */
  constructor(
    private readonly secretsManager: SecretsManager
  ) {
    this.logger = new Logger('ConfigService');
    
    // Set config path
    this.configPath = process.env.CONFIG_PATH || path.resolve(process.cwd(), 'config/config.json');
    
    this.logger.info('ConfigService created');
  }
  
  /**
   * Initialize the service when the module is initialized
   */
  async onModuleInit(): Promise<void> {
    await this.initialize();
  }
  
  /**
   * Initialize the configuration service
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('ConfigService is already initialized');
      return;
    }
    
    this.logger.info(`Initializing ConfigService with config path: ${this.configPath}`);
    
    try {
      // Load environment variables
      this.loadEnvironmentVariables();
      
      // Load configuration file
      await this.loadConfigFile();
      
      // Replace sensitive values with secrets
      await this.replaceSecretsInConfig();
      
      this.isInitialized = true;
      this.logger.info('ConfigService initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize ConfigService', error);
      throw new Error(`Failed to initialize ConfigService: ${error.message}`);
    }
  }
  
  /**
   * Load environment variables
   */
  private loadEnvironmentVariables(): void {
    try {
      // Load .env file if it exists
      const envPath = path.resolve(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        this.logger.info(`Loading environment variables from ${envPath}`);
        dotenv.config({ path: envPath });
      }
      
      // Load environment-specific .env file
      const env = process.env.NODE_ENV || 'development';
      const envSpecificPath = path.resolve(process.cwd(), `.env.${env}`);
      if (fs.existsSync(envSpecificPath)) {
        this.logger.info(`Loading environment variables from ${envSpecificPath}`);
        dotenv.config({ path: envSpecificPath });
      }
    } catch (error) {
      this.logger.warn('Error loading environment variables', error);
    }
  }
  
  /**
   * Load configuration file
   */
  private async loadConfigFile(): Promise<void> {
    try {
      // Check if config file exists
      if (!fs.existsSync(this.configPath)) {
        throw new Error(`Configuration file not found: ${this.configPath}`);
      }
      
      // Read config file
      const configContent = fs.readFileSync(this.configPath, 'utf8');
      
      // Parse JSON
      this.config = JSON.parse(configContent);
      
      this.logger.info('Configuration file loaded successfully');
    } catch (error) {
      this.logger.error('Error loading configuration file', error);
      throw new Error(`Failed to load configuration file: ${error.message}`);
    }
  }
  
  /**
   * Replace sensitive values with secrets
   */
  private async replaceSecretsInConfig(): Promise<void> {
    try {
      // Replace database password
      if (this.config.database?.password) {
        this.config.database.password = await this.secretsManager.getSecret(
          'DATABASE_PASSWORD',
          this.config.database.password
        );
      }
      
      // Replace Ethereum RPC URL
      if (this.config.ethereum?.rpc) {
        this.config.ethereum.rpc = await this.secretsManager.getSecret(
          'ETHEREUM_RPC_URL',
          this.config.ethereum.rpc
        );
      }
      
      // Replace Solana RPC URL
      if (this.config.solana?.rpc) {
        this.config.solana.rpc = await this.secretsManager.getSecret(
          'SOLANA_RPC_URL',
          this.config.solana.rpc
        );
      }
      
      // Replace Slack webhook
      if (this.config.monitoring?.notificationChannels?.slack?.webhook) {
        this.config.monitoring.notificationChannels.slack.webhook = await this.secretsManager.getSecret(
          'SLACK_WEBHOOK_URL',
          this.config.monitoring.notificationChannels.slack.webhook
        );
      }
      
      this.logger.info('Sensitive values replaced with secrets');
    } catch (error) {
      this.logger.error('Error replacing sensitive values with secrets', error);
      throw new Error(`Failed to replace sensitive values with secrets: ${error.message}`);
    }
  }
  
  /**
   * Get a configuration value
   * 
   * @param key - Configuration key (dot notation)
   * @param defaultValue - Default value if key not found
   * @returns Configuration value
   */
  public get<T>(key: string, defaultValue?: T): T {
    if (!this.isInitialized) {
      throw new Error('ConfigService is not initialized');
    }
    
    // Split key by dots
    const keys = key.split('.');
    
    // Traverse config object
    let value: any = this.config;
    for (const k of keys) {
      if (value === undefined || value === null) {
        return defaultValue;
      }
      value = value[k];
    }
    
    // Return value or default
    return value !== undefined ? value : defaultValue;
  }
  
  /**
   * Set a configuration value
   * 
   * @param key - Configuration key (dot notation)
   * @param value - Configuration value
   */
  public set(key: string, value: any): void {
    if (!this.isInitialized) {
      throw new Error('ConfigService is not initialized');
    }
    
    // Split key by dots
    const keys = key.split('.');
    
    // Traverse config object
    let current: any = this.config;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (current[k] === undefined) {
        current[k] = {};
      }
      current = current[k];
    }
    
    // Set value
    current[keys[keys.length - 1]] = value;
  }
  
  /**
   * Save configuration to file
   */
  public async save(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('ConfigService is not initialized');
    }
    
    try {
      // Serialize to JSON
      const configContent = JSON.stringify(this.config, null, 2);
      
      // Write to file
      fs.writeFileSync(this.configPath, configContent, 'utf8');
      
      this.logger.info('Configuration saved successfully');
    } catch (error) {
      this.logger.error('Error saving configuration', error);
      throw new Error(`Failed to save configuration: ${error.message}`);
    }
  }
  
  /**
   * Get database configuration
   * 
   * @returns Database configuration
   */
  public getDatabaseConfig(): any {
    return this.get('database', {});
  }
  
  /**
   * Get Ethereum configuration
   * 
   * @returns Ethereum configuration
   */
  public getEthereumConfig(): any {
    return this.get('ethereum', {});
  }
  
  /**
   * Get Solana configuration
   * 
   * @returns Solana configuration
   */
  public getSolanaConfig(): any {
    return this.get('solana', {});
  }
  
  /**
   * Get Wormhole configuration
   * 
   * @returns Wormhole configuration
   */
  public getWormholeConfig(): any {
    return this.get('wormhole', {});
  }
  
  /**
   * Get server configuration
   * 
   * @returns Server configuration
   */
  public getServerConfig(): any {
    return this.get('server', {});
  }
  
  /**
   * Get logging configuration
   * 
   * @returns Logging configuration
   */
  public getLoggingConfig(): any {
    return this.get('logging', {});
  }
  
  /**
   * Get threading configuration
   * 
   * @returns Threading configuration
   */
  public getThreadingConfig(): any {
    return this.get('threading', {});
  }
  
  /**
   * Get metrics configuration
   * 
   * @returns Metrics configuration
   */
  public getMetricsConfig(): any {
    return this.get('metrics', {});
  }
  
  /**
   * Get cache configuration
   * 
   * @returns Cache configuration
   */
  public getCacheConfig(): any {
    return this.get('cache', {});
  }
  
  /**
   * Get security configuration
   * 
   * @returns Security configuration
   */
  public getSecurityConfig(): any {
    return this.get('security', {});
  }
  
  /**
   * Get transaction configuration
   * 
   * @returns Transaction configuration
   */
  public getTransactionConfig(): any {
    return this.get('transaction', {});
  }
  
  /**
   * Get sequencer configuration
   * 
   * @returns Sequencer configuration
   */
  public getSequencerConfig(): any {
    return this.get('sequencer', {});
  }
  
  /**
   * Get bridge configuration
   * 
   * @returns Bridge configuration
   */
  public getBridgeConfig(): any {
    return this.get('bridge', {});
  }
  
  /**
   * Get Layer-2 configuration
   * 
   * @returns Layer-2 configuration
   */
  public getLayer2Config(): any {
    return this.get('layer2', {});
  }
  
  /**
   * Get monitoring configuration
   * 
   * @returns Monitoring configuration
   */
  public getMonitoringConfig(): any {
    return this.get('monitoring', {});
  }
  
  /**
   * Get environment
   * 
   * @returns Environment
   */
  public getEnvironment(): string {
    return this.get('environment', 'development');
  }
  
  /**
   * Check if environment is production
   * 
   * @returns Whether environment is production
   */
  public isProduction(): boolean {
    return this.getEnvironment() === 'production';
  }
  
  /**
   * Check if environment is development
   * 
   * @returns Whether environment is development
   */
  public isDevelopment(): boolean {
    return this.getEnvironment() === 'development';
  }
  
  /**
   * Check if environment is test
   * 
   * @returns Whether environment is test
   */
  public isTest(): boolean {
    return this.getEnvironment() === 'test';
  }
}
