// English comment for verification
/**
 * @file SecretsManager.ts
 * @description Secure secrets management service for the Layer-2 system
 * @author Manus AI
 * @date April 27, 2025
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { Logger } from '../utils/Logger';
import { MetricsService } from '../monitoring/MetricsService';
import { MonitoringService } from '../monitoring/MonitoringService';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as AWS from 'aws-sdk';
import * as GCP from '@google-cloud/secret-manager';
import * as Azure from '@azure/keyvault-secrets';
import * as AzureIdentity from '@azure/identity';

/**
 * Secret provider types
 */
export enum SecretProviderType {
  ENV = 'env',
  FILE = 'file',
  AWS_SECRETS_MANAGER = 'aws',
  GCP_SECRET_MANAGER = 'gcp',
  AZURE_KEY_VAULT = 'azure',
  VAULT = 'vault',
  HSM = 'hsm'
}

/**
 * Secret configuration
 */
export interface SecretConfig {
  // Provider type
  provider: SecretProviderType;
  
  // Environment variables configuration
  env?: {
    prefix: string;
  };
  
  // File configuration
  file?: {
    path: string;
    encryptionKey?: string;
  };
  
  // AWS Secrets Manager configuration
  aws?: {
    region: string;
    secretName: string;
  };
  
  // GCP Secret Manager configuration
  gcp?: {
    projectId: string;
  };
  
  // Azure Key Vault configuration
  azure?: {
    vaultUrl: string;
  };
  
  // HashiCorp Vault configuration
  vault?: {
    url: string;
    token: string;
    path: string;
  };
  
  // HSM configuration
  hsm?: {
    libraryPath: string;
    slotId: number;
    pin: string;
  };
}

/**
 * Secrets Manager service for secure secrets management
 */
@Injectable()
export class SecretsManager implements OnModuleInit {
  private readonly logger: Logger;
  private readonly config: SecretConfig;
  private isInitialized: boolean = false;
  
  // Secret providers
  private awsSecretsManager: AWS.SecretsManager;
  private gcpSecretManager: GCP.SecretManagerServiceClient;
  private azureKeyVaultClient: Azure.SecretClient;
  
  // Cached secrets
  private secrets: Map<string, string> = new Map();
  
  // Encryption key
  private encryptionKey: Buffer;
  
  /**
   * Constructor for SecretsManager
   * 
   * @param metricsService - Metrics service
   * @param monitoringService - Monitoring service
   */
  constructor(
    private readonly metricsService: MetricsService,
    private readonly monitoringService: MonitoringService
  ) {
    this.logger = new Logger('SecretsManager');
    
    // Load configuration
    this.config = this.loadConfig();
    
    this.logger.info('SecretsManager created');
  }
  
  /**
   * Initialize the service when the module is initialized
   */
  async onModuleInit(): Promise<void> {
    await this.initialize();
  }
  
  /**
   * Load secrets configuration
   * 
   * @returns Secret configuration
   */
  private loadConfig(): SecretConfig {
    // Load from environment variables
    const provider = process.env.SECRETS_PROVIDER || SecretProviderType.ENV;
    
    // Default configuration
    const config: SecretConfig = {
      provider: provider as SecretProviderType,
      env: {
        prefix: 'LAYER2_'
      },
      file: {
        path: process.env.SECRETS_FILE_PATH || './.secrets.json',
        encryptionKey: process.env.SECRETS_ENCRYPTION_KEY
      },
      aws: {
        region: process.env.AWS_REGION || 'us-east-1',
        secretName: process.env.AWS_SECRET_NAME || 'layer2-secrets'
      },
      gcp: {
        projectId: process.env.GCP_PROJECT_ID || 'layer2-project'
      },
      azure: {
        vaultUrl: process.env.AZURE_VAULT_URL || 'https://layer2-vault.vault.azure.net/'
      },
      vault: {
        url: process.env.VAULT_URL || 'http://localhost:8200',
        token: process.env.VAULT_TOKEN || '',
        path: process.env.VAULT_PATH || 'secret/layer2'
      },
      hsm: {
        libraryPath: process.env.HSM_LIBRARY_PATH || '/usr/local/lib/softhsm/libsofthsm2.so',
        slotId: parseInt(process.env.HSM_SLOT_ID || '0', 10),
        pin: process.env.HSM_PIN || '1234'
      }
    };
    
    return config;
  }
  
  /**
   * Initialize the secrets manager
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('SecretsManager is already initialized');
      return;
    }
    
    this.logger.info(`Initializing SecretsManager with provider: ${this.config.provider}`);
    
    try {
      // Load .env file if it exists
      this.loadDotEnv();
      
      // Initialize encryption key if needed
      if (this.config.file?.encryptionKey) {
        this.encryptionKey = crypto.createHash('sha256')
          .update(this.config.file.encryptionKey)
          .digest();
      }
      
      // Initialize provider
      switch (this.config.provider) {
        case SecretProviderType.ENV:
          await this.initializeEnvProvider();
          break;
        case SecretProviderType.FILE:
          await this.initializeFileProvider();
          break;
        case SecretProviderType.AWS_SECRETS_MANAGER:
          await this.initializeAwsProvider();
          break;
        case SecretProviderType.GCP_SECRET_MANAGER:
          await this.initializeGcpProvider();
          break;
        case SecretProviderType.AZURE_KEY_VAULT:
          await this.initializeAzureProvider();
          break;
        case SecretProviderType.VAULT:
          await this.initializeVaultProvider();
          break;
        case SecretProviderType.HSM:
          await this.initializeHsmProvider();
          break;
        default:
          throw new Error(`Unsupported secrets provider: ${this.config.provider}`);
      }
      
      this.isInitialized = true;
      this.logger.info('SecretsManager initialized successfully');
      
      // Record metrics
      this.metricsService.recordMetric('secrets_manager.initialization', {
        success: true,
        provider: this.config.provider
      });
    } catch (error) {
      this.logger.error('Failed to initialize SecretsManager', error);
      
      // Record error metric
      this.metricsService.recordMetric('secrets_manager.initialization_error', {
        provider: this.config.provider,
        error: error.message
      });
      
      // Send alert
      this.monitoringService.sendAlert({
        level: 'error',
        source: 'secrets_manager',
        message: `Failed to initialize SecretsManager: ${error.message}`
      });
      
      throw new Error(`Failed to initialize SecretsManager: ${error.message}`);
    }
  }
  
  /**
   * Load .env file if it exists
   */
  private loadDotEnv(): void {
    try {
      // Check for .env file
      const envPath = path.resolve(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        this.logger.info(`Loading environment variables from ${envPath}`);
        dotenv.config({ path: envPath });
      }
      
      // Check for environment-specific .env file
      const env = process.env.NODE_ENV || 'development';
      const envSpecificPath = path.resolve(process.cwd(), `.env.${env}`);
      if (fs.existsSync(envSpecificPath)) {
        this.logger.info(`Loading environment variables from ${envSpecificPath}`);
        dotenv.config({ path: envSpecificPath });
      }
    } catch (error) {
      this.logger.warn('Error loading .env file', error);
    }
  }
  
  /**
   * Initialize environment variables provider
   */
  private async initializeEnvProvider(): Promise<void> {
    this.logger.info('Initializing environment variables provider');
    
    // No initialization needed for environment variables
    // Just log the number of environment variables with the prefix
    const prefix = this.config.env?.prefix || 'LAYER2_';
    const envVars = Object.keys(process.env).filter(key => key.startsWith(prefix));
    
    this.logger.info(`Found ${envVars.length} environment variables with prefix ${prefix}`);
  }
  
  /**
   * Initialize file provider
   */
  private async initializeFileProvider(): Promise<void> {
    this.logger.info('Initializing file provider');
    
    const filePath = path.resolve(process.cwd(), this.config.file?.path || './.secrets.json');
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      this.logger.warn(`Secrets file not found: ${filePath}`);
      return;
    }
    
    try {
      // Read file
      const fileContent = fs.readFileSync(filePath, 'utf8');
      
      // Decrypt if encryption key is provided
      let secretsJson: string;
      if (this.encryptionKey) {
        secretsJson = this.decrypt(fileContent);
      } else {
        secretsJson = fileContent;
      }
      
      // Parse JSON
      const secrets = JSON.parse(secretsJson);
      
      // Store in cache
      for (const [key, value] of Object.entries(secrets)) {
        this.secrets.set(key, value as string);
      }
      
      this.logger.info(`Loaded ${Object.keys(secrets).length} secrets from file`);
    } catch (error) {
      this.logger.error(`Error loading secrets from file: ${filePath}`, error);
      throw new Error(`Failed to load secrets from file: ${error.message}`);
    }
  }
  
  /**
   * Initialize AWS Secrets Manager provider
   */
  private async initializeAwsProvider(): Promise<void> {
    this.logger.info('Initializing AWS Secrets Manager provider');
    
    try {
      // Initialize AWS Secrets Manager client
      this.awsSecretsManager = new AWS.SecretsManager({
        region: this.config.aws?.region || 'us-east-1'
      });
      
      // Test connection by getting secret
      const secretName = this.config.aws?.secretName || 'layer2-secrets';
      const result = await this.awsSecretsManager.getSecretValue({ SecretId: secretName }).promise();
      
      if (result.SecretString) {
        // Parse JSON
        const secrets = JSON.parse(result.SecretString);
        
        // Store in cache
        for (const [key, value] of Object.entries(secrets)) {
          this.secrets.set(key, value as string);
        }
        
        this.logger.info(`Loaded ${Object.keys(secrets).length} secrets from AWS Secrets Manager`);
      } else {
        this.logger.warn('No secrets found in AWS Secrets Manager');
      }
    } catch (error) {
      this.logger.error('Error initializing AWS Secrets Manager provider', error);
      throw new Error(`Failed to initialize AWS Secrets Manager provider: ${error.message}`);
    }
  }
  
  /**
   * Initialize GCP Secret Manager provider
   */
  private async initializeGcpProvider(): Promise<void> {
    this.logger.info('Initializing GCP Secret Manager provider');
    
    try {
      // Initialize GCP Secret Manager client
      this.gcpSecretManager = new GCP.SecretManagerServiceClient();
      
      // Test connection by listing secrets
      const projectId = this.config.gcp?.projectId || 'layer2-project';
      const [secrets] = await this.gcpSecretManager.listSecrets({
        parent: `projects/${projectId}`
      });
      
      this.logger.info(`Found ${secrets.length} secrets in GCP Secret Manager`);
    } catch (error) {
      this.logger.error('Error initializing GCP Secret Manager provider', error);
      throw new Error(`Failed to initialize GCP Secret Manager provider: ${error.message}`);
    }
  }
  
  /**
   * Initialize Azure Key Vault provider
   */
  private async initializeAzureProvider(): Promise<void> {
    this.logger.info('Initializing Azure Key Vault provider');
    
    try {
      // Initialize Azure Key Vault client
      const credential = new AzureIdentity.DefaultAzureCredential();
      this.azureKeyVaultClient = new Azure.SecretClient(
        this.config.azure?.vaultUrl || 'https://layer2-vault.vault.azure.net/',
        credential
      );
      
      // Test connection by listing secrets
      const secrets = this.azureKeyVaultClient.listPropertiesOfSecrets();
      let count = 0;
      for await (const secret of secrets) {
        count++;
      }
      
      this.logger.info(`Found ${count} secrets in Azure Key Vault`);
    } catch (error) {
      this.logger.error('Error initializing Azure Key Vault provider', error);
      throw new Error(`Failed to initialize Azure Key Vault provider: ${error.message}`);
    }
  }
  
  /**
   * Initialize HashiCorp Vault provider
   */
  private async initializeVaultProvider(): Promise<void> {
    this.logger.info('Initializing HashiCorp Vault provider');
    
    try {
      // In a real implementation, this would initialize a Vault client
      // For now, we'll just log a message
      this.logger.info('HashiCorp Vault provider initialized (simulated)');
    } catch (error) {
      this.logger.error('Error initializing HashiCorp Vault provider', error);
      throw new Error(`Failed to initialize HashiCorp Vault provider: ${error.message}`);
    }
  }
  
  /**
   * Initialize HSM provider
   */
  private async initializeHsmProvider(): Promise<void> {
    this.logger.info('Initializing HSM provider');
    
    try {
      // In a real implementation, this would initialize an HSM client
      // For now, we'll just log a message
      this.logger.info('HSM provider initialized (simulated)');
    } catch (error) {
      this.logger.error('Error initializing HSM provider', error);
      throw new Error(`Failed to initialize HSM provider: ${error.message}`);
    }
  }
  
  /**
   * Get a secret value
   * 
   * @param key - Secret key
   * @param defaultValue - Default value if secret not found
   * @returns Secret value
   */
  public async getSecret(key: string, defaultValue?: string): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    try {
      // Check cache first
      if (this.secrets.has(key)) {
        return this.secrets.get(key);
      }
      
      // Get from provider
      let value: string;
      
      switch (this.config.provider) {
        case SecretProviderType.ENV:
          value = this.getSecretFromEnv(key);
          break;
        case SecretProviderType.FILE:
          // Already loaded in initialization
          value = null;
          break;
        case SecretProviderType.AWS_SECRETS_MANAGER:
          value = await this.getSecretFromAws(key);
          break;
        case SecretProviderType.GCP_SECRET_MANAGER:
          value = await this.getSecretFromGcp(key);
          break;
        case SecretProviderType.AZURE_KEY_VAULT:
          value = await this.getSecretFromAzure(key);
          break;
        case SecretProviderType.VAULT:
          value = await this.getSecretFromVault(key);
          break;
        case SecretProviderType.HSM:
          value = await this.getSecretFromHsm(key);
          break;
        default:
          throw new Error(`Unsupported secrets provider: ${this.config.provider}`);
      }
      
      // If value is found, cache it
      if (value) {
        this.secrets.set(key, value);
        return value;
      }
      
      // Return default value if provided
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      
      throw new Error(`Secret not found: ${key}`);
    } catch (error) {
      this.logger.error(`Error getting secret: ${key}`, error);
      
      // Record error metric
      this.metricsService.recordMetric('secrets_manager.get_secret_error', {
        key,
        provider: this.config.provider,
        error: error.message
      });
      
      // Return default value if provided
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      
      throw new Error(`Failed to get secret ${key}: ${error.message}`);
    }
  }
  
  /**
   * Get a secret from environment variables
   * 
   * @param key - Secret key
   * @returns Secret value
   */
  private getSecretFromEnv(key: string): string {
    const prefix = this.config.env?.prefix || 'LAYER2_';
    const envKey = `${prefix}${key}`;
    
    return process.env[envKey];
  }
  
  /**
   * Get a secret from AWS Secrets Manager
   * 
   * @param key - Secret key
   * @returns Secret value
   */
  private async getSecretFromAws(key: string): Promise<string> {
    try {
      const secretName = this.config.aws?.secretName || 'layer2-secrets';
      const result = await this.awsSecretsManager.getSecretValue({ SecretId: secretName }).promise();
      
      if (result.SecretString) {
        const secrets = JSON.parse(result.SecretString);
        return secrets[key];
      }
      
      return null;
    } catch (error) {
      this.logger.error(`Error getting secret from AWS Secrets Manager: ${key}`, error);
      throw error;
    }
  }
  
  /**
   * Get a secret from GCP Secret Manager
   * 
   * @param key - Secret key
   * @returns Secret value
   */
  private async getSecretFromGcp(key: string): Promise<string> {
    try {
      const projectId = this.config.gcp?.projectId || 'layer2-project';
      const name = `projects/${projectId}/secrets/${key}/versions/latest`;
      
      const [version] = await this.gcpSecretManager.accessSecretVersion({ name });
      
      if (version.payload?.data) {
        return version.payload.data.toString();
      }
      
      return null;
    } catch (error) {
      this.logger.error(`Error getting secret from GCP Secret Manager: ${key}`, error);
      throw error;
    }
  }
  
  /**
   * Get a secret from Azure Key Vault
   * 
   * @param key - Secret key
   * @returns Secret value
   */
  private async getSecretFromAzure(key: string): Promise<string> {
    try {
      const result = await this.azureKeyVaultClient.getSecret(key);
      return result.value;
    } catch (error) {
      this.logger.error(`Error getting secret from Azure Key Vault: ${key}`, error);
      throw error;
    }
  }
  
  /**
   * Get a secret from HashiCorp Vault
   * 
   * @param key - Secret key
   * @returns Secret value
   */
  private async getSecretFromVault(key: string): Promise<string> {
    // In a real implementation, this would get a secret from Vault
    // For now, we'll just return null
    return null;
  }
  
  /**
   * Get a secret from HSM
   * 
   * @param key - Secret key
   * @returns Secret value
   */
  private async getSecretFromHsm(key: string): Promise<string> {
    // In a real implementation, this would get a secret from HSM
    // For now, we'll just return null
    return null;
  }
  
  /**
   * Set a secret value
   * 
   * @param key - Secret key
   * @param value - Secret value
   */
  public async setSecret(key: string, value: string): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    try {
      // Set in cache
      this.secrets.set(key, value);
      
      // Set in provider
      switch (this.config.provider) {
        case SecretProviderType.ENV:
          this.setSecretInEnv(key, value);
          break;
        case SecretProviderType.FILE:
          await this.setSecretInFile(key, value);
          break;
        case SecretProviderType.AWS_SECRETS_MANAGER:
          await this.setSecretInAws(key, value);
          break;
        case SecretProviderType.GCP_SECRET_MANAGER:
          await this.setSecretInGcp(key, value);
          break;
        case SecretProviderType.AZURE_KEY_VAULT:
          await this.setSecretInAzure(key, value);
          break;
        case SecretProviderType.VAULT:
          await this.setSecretInVault(key, value);
          break;
        case SecretProviderType.HSM:
          await this.setSecretInHsm(key, value);
          break;
        default:
          throw new Error(`Unsupported secrets provider: ${this.config.provider}`);
      }
      
      this.logger.info(`Secret set: ${key}`);
      
      // Record metrics
      this.metricsService.recordMetric('secrets_manager.set_secret', {
        key,
        provider: this.config.provider
      });
    } catch (error) {
      this.logger.error(`Error setting secret: ${key}`, error);
      
      // Record error metric
      this.metricsService.recordMetric('secrets_manager.set_secret_error', {
        key,
        provider: this.config.provider,
        error: error.message
      });
      
      throw new Error(`Failed to set secret ${key}: ${error.message}`);
    }
  }
  
  /**
   * Set a secret in environment variables
   * 
   * @param key - Secret key
   * @param value - Secret value
   */
  private setSecretInEnv(key: string, value: string): void {
    const prefix = this.config.env?.prefix || 'LAYER2_';
    const envKey = `${prefix}${key}`;
    
    process.env[envKey] = value;
  }
  
  /**
   * Set a secret in file
   * 
   * @param key - Secret key
   * @param value - Secret value
   */
  private async setSecretInFile(key: string, value: string): Promise<void> {
    const filePath = path.resolve(process.cwd(), this.config.file?.path || './.secrets.json');
    
    try {
      // Read existing secrets
      let secrets: Record<string, string> = {};
      
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        
        // Decrypt if encryption key is provided
        let secretsJson: string;
        if (this.encryptionKey) {
          secretsJson = this.decrypt(fileContent);
        } else {
          secretsJson = fileContent;
        }
        
        // Parse JSON
        secrets = JSON.parse(secretsJson);
      }
      
      // Update secret
      secrets[key] = value;
      
      // Serialize to JSON
      let secretsJson = JSON.stringify(secrets, null, 2);
      
      // Encrypt if encryption key is provided
      let fileContent: string;
      if (this.encryptionKey) {
        fileContent = this.encrypt(secretsJson);
      } else {
        fileContent = secretsJson;
      }
      
      // Write to file
      fs.writeFileSync(filePath, fileContent, 'utf8');
      
      // Set permissions to restrict access
      fs.chmodSync(filePath, 0o600);
    } catch (error) {
      this.logger.error(`Error setting secret in file: ${key}`, error);
      throw error;
    }
  }
  
  /**
   * Set a secret in AWS Secrets Manager
   * 
   * @param key - Secret key
   * @param value - Secret value
   */
  private async setSecretInAws(key: string, value: string): Promise<void> {
    try {
      const secretName = this.config.aws?.secretName || 'layer2-secrets';
      
      // Get existing secret
      let secrets: Record<string, string> = {};
      
      try {
        const result = await this.awsSecretsManager.getSecretValue({ SecretId: secretName }).promise();
        
        if (result.SecretString) {
          secrets = JSON.parse(result.SecretString);
        }
      } catch (error) {
        // Secret might not exist yet
        if (error.code !== 'ResourceNotFoundException') {
          throw error;
        }
      }
      
      // Update secret
      secrets[key] = value;
      
      // Save secret
      await this.awsSecretsManager.putSecretValue({
        SecretId: secretName,
        SecretString: JSON.stringify(secrets)
      }).promise();
    } catch (error) {
      this.logger.error(`Error setting secret in AWS Secrets Manager: ${key}`, error);
      throw error;
    }
  }
  
  /**
   * Set a secret in GCP Secret Manager
   * 
   * @param key - Secret key
   * @param value - Secret value
   */
  private async setSecretInGcp(key: string, value: string): Promise<void> {
    try {
      const projectId = this.config.gcp?.projectId || 'layer2-project';
      const parent = `projects/${projectId}`;
      
      // Check if secret exists
      let secretExists = false;
      
      try {
        const [secrets] = await this.gcpSecretManager.listSecrets({
          parent
        });
        
        secretExists = secrets.some(secret => secret.name.endsWith(`/${key}`));
      } catch (error) {
        // Ignore error
      }
      
      // Create secret if it doesn't exist
      if (!secretExists) {
        await this.gcpSecretManager.createSecret({
          parent,
          secretId: key,
          secret: {
            replication: {
              automatic: {}
            }
          }
        });
      }
      
      // Add new version
      await this.gcpSecretManager.addSecretVersion({
        parent: `${parent}/secrets/${key}`,
        payload: {
          data: Buffer.from(value)
        }
      });
    } catch (error) {
      this.logger.error(`Error setting secret in GCP Secret Manager: ${key}`, error);
      throw error;
    }
  }
  
  /**
   * Set a secret in Azure Key Vault
   * 
   * @param key - Secret key
   * @param value - Secret value
   */
  private async setSecretInAzure(key: string, value: string): Promise<void> {
    try {
      await this.azureKeyVaultClient.setSecret(key, value);
    } catch (error) {
      this.logger.error(`Error setting secret in Azure Key Vault: ${key}`, error);
      throw error;
    }
  }
  
  /**
   * Set a secret in HashiCorp Vault
   * 
   * @param key - Secret key
   * @param value - Secret value
   */
  private async setSecretInVault(key: string, value: string): Promise<void> {
    // In a real implementation, this would set a secret in Vault
    // For now, we'll just log a message
    this.logger.info(`Setting secret in HashiCorp Vault: ${key} (simulated)`);
  }
  
  /**
   * Set a secret in HSM
   * 
   * @param key - Secret key
   * @param value - Secret value
   */
  private async setSecretInHsm(key: string, value: string): Promise<void> {
    // In a real implementation, this would set a secret in HSM
    // For now, we'll just log a message
    this.logger.info(`Setting secret in HSM: ${key} (simulated)`);
  }
  
  /**
   * Delete a secret
   * 
   * @param key - Secret key
   */
  public async deleteSecret(key: string): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    try {
      // Remove from cache
      this.secrets.delete(key);
      
      // Delete from provider
      switch (this.config.provider) {
        case SecretProviderType.ENV:
          this.deleteSecretFromEnv(key);
          break;
        case SecretProviderType.FILE:
          await this.deleteSecretFromFile(key);
          break;
        case SecretProviderType.AWS_SECRETS_MANAGER:
          await this.deleteSecretFromAws(key);
          break;
        case SecretProviderType.GCP_SECRET_MANAGER:
          await this.deleteSecretFromGcp(key);
          break;
        case SecretProviderType.AZURE_KEY_VAULT:
          await this.deleteSecretFromAzure(key);
          break;
        case SecretProviderType.VAULT:
          await this.deleteSecretFromVault(key);
          break;
        case SecretProviderType.HSM:
          await this.deleteSecretFromHsm(key);
          break;
        default:
          throw new Error(`Unsupported secrets provider: ${this.config.provider}`);
      }
      
      this.logger.info(`Secret deleted: ${key}`);
      
      // Record metrics
      this.metricsService.recordMetric('secrets_manager.delete_secret', {
        key,
        provider: this.config.provider
      });
    } catch (error) {
      this.logger.error(`Error deleting secret: ${key}`, error);
      
      // Record error metric
      this.metricsService.recordMetric('secrets_manager.delete_secret_error', {
        key,
        provider: this.config.provider,
        error: error.message
      });
      
      throw new Error(`Failed to delete secret ${key}: ${error.message}`);
    }
  }
  
  /**
   * Delete a secret from environment variables
   * 
   * @param key - Secret key
   */
  private deleteSecretFromEnv(key: string): void {
    const prefix = this.config.env?.prefix || 'LAYER2_';
    const envKey = `${prefix}${key}`;
    
    delete process.env[envKey];
  }
  
  /**
   * Delete a secret from file
   * 
   * @param key - Secret key
   */
  private async deleteSecretFromFile(key: string): Promise<void> {
    const filePath = path.resolve(process.cwd(), this.config.file?.path || './.secrets.json');
    
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return;
      }
      
      // Read existing secrets
      const fileContent = fs.readFileSync(filePath, 'utf8');
      
      // Decrypt if encryption key is provided
      let secretsJson: string;
      if (this.encryptionKey) {
        secretsJson = this.decrypt(fileContent);
      } else {
        secretsJson = fileContent;
      }
      
      // Parse JSON
      const secrets = JSON.parse(secretsJson);
      
      // Delete secret
      delete secrets[key];
      
      // Serialize to JSON
      secretsJson = JSON.stringify(secrets, null, 2);
      
      // Encrypt if encryption key is provided
      let newFileContent: string;
      if (this.encryptionKey) {
        newFileContent = this.encrypt(secretsJson);
      } else {
        newFileContent = secretsJson;
      }
      
      // Write to file
      fs.writeFileSync(filePath, newFileContent, 'utf8');
    } catch (error) {
      this.logger.error(`Error deleting secret from file: ${key}`, error);
      throw error;
    }
  }
  
  /**
   * Delete a secret from AWS Secrets Manager
   * 
   * @param key - Secret key
   */
  private async deleteSecretFromAws(key: string): Promise<void> {
    try {
      const secretName = this.config.aws?.secretName || 'layer2-secrets';
      
      // Get existing secret
      let secrets: Record<string, string> = {};
      
      try {
        const result = await this.awsSecretsManager.getSecretValue({ SecretId: secretName }).promise();
        
        if (result.SecretString) {
          secrets = JSON.parse(result.SecretString);
        }
      } catch (error) {
        // Secret might not exist
        if (error.code === 'ResourceNotFoundException') {
          return;
        }
        throw error;
      }
      
      // Delete secret
      delete secrets[key];
      
      // Save secret
      await this.awsSecretsManager.putSecretValue({
        SecretId: secretName,
        SecretString: JSON.stringify(secrets)
      }).promise();
    } catch (error) {
      this.logger.error(`Error deleting secret from AWS Secrets Manager: ${key}`, error);
      throw error;
    }
  }
  
  /**
   * Delete a secret from GCP Secret Manager
   * 
   * @param key - Secret key
   */
  private async deleteSecretFromGcp(key: string): Promise<void> {
    try {
      const projectId = this.config.gcp?.projectId || 'layer2-project';
      const name = `projects/${projectId}/secrets/${key}`;
      
      // Delete secret
      await this.gcpSecretManager.deleteSecret({ name });
    } catch (error) {
      // Secret might not exist
      if (error.code === 5) {
        return;
      }
      this.logger.error(`Error deleting secret from GCP Secret Manager: ${key}`, error);
      throw error;
    }
  }
  
  /**
   * Delete a secret from Azure Key Vault
   * 
   * @param key - Secret key
   */
  private async deleteSecretFromAzure(key: string): Promise<void> {
    try {
      await this.azureKeyVaultClient.beginDeleteSecret(key);
    } catch (error) {
      this.logger.error(`Error deleting secret from Azure Key Vault: ${key}`, error);
      throw error;
    }
  }
  
  /**
   * Delete a secret from HashiCorp Vault
   * 
   * @param key - Secret key
   */
  private async deleteSecretFromVault(key: string): Promise<void> {
    // In a real implementation, this would delete a secret from Vault
    // For now, we'll just log a message
    this.logger.info(`Deleting secret from HashiCorp Vault: ${key} (simulated)`);
  }
  
  /**
   * Delete a secret from HSM
   * 
   * @param key - Secret key
   */
  private async deleteSecretFromHsm(key: string): Promise<void> {
    // In a real implementation, this would delete a secret from HSM
    // For now, we'll just log a message
    this.logger.info(`Deleting secret from HSM: ${key} (simulated)`);
  }
  
  /**
   * Encrypt a string
   * 
   * @param text - Text to encrypt
   * @returns Encrypted text
   */
  private encrypt(text: string): string {
    if (!this.encryptionKey) {
      return text;
    }
    
    // Generate initialization vector
    const iv = crypto.randomBytes(16);
    
    // Create cipher
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    
    // Encrypt
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    // Combine IV and encrypted text
    return `${iv.toString('hex')}:${encrypted}`;
  }
  
  /**
   * Decrypt a string
   * 
   * @param text - Text to decrypt
   * @returns Decrypted text
   */
  private decrypt(text: string): string {
    if (!this.encryptionKey) {
      return text;
    }
    
    // Split IV and encrypted text
    const parts = text.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted text format');
    }
    
    // Get IV and encrypted text
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    // Create decipher
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    
    // Decrypt
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
  
  /**
   * Get all secrets
   * 
   * @returns All secrets
   */
  public async getAllSecrets(): Promise<Record<string, string>> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    // Convert map to object
    const secrets: Record<string, string> = {};
    for (const [key, value] of this.secrets.entries()) {
      secrets[key] = value;
    }
    
    return secrets;
  }
  
  /**
   * Get a decrypted secret
   * 
   * @param key - Secret key
   * @returns Decrypted secret value
   */
  public async getDecryptedSecret(key: string): Promise<string> {
    const encryptedValue = await this.getSecret(key);
    
    if (!encryptedValue) {
      return null;
    }
    
    // If the value is not encrypted, return as is
    if (!encryptedValue.includes(':')) {
      return encryptedValue;
    }
    
    try {
      return this.decrypt(encryptedValue);
    } catch (error) {
      this.logger.error(`Error decrypting secret: ${key}`, error);
      throw new Error(`Failed to decrypt secret ${key}: ${error.message}`);
    }
  }
}
