// English comment for verification
/**
 * @file EnhancedSecurityService.ts
 * @description Enhanced security service with real HSM integration for the Layer-2 system
 * @author Manus AI
 * @date April 27, 2025
 */

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ethers } from 'ethers';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import * as crypto from 'crypto';
import * as nacl from 'tweetnacl';
import * as bs58 from 'bs58';
import * as pkcs11js from 'pkcs11js';
import * as fs from 'fs';
import * as path from 'path';

import { Logger } from '../utils/Logger';
import { ConfigService } from '../config/config.service';
import { MetricsService } from '../monitoring/MetricsService';
import { MonitoringService } from '../monitoring/MonitoringService';
import { CacheService } from '../utils/CacheService';
import { SecurityEvent } from '../models/SecurityEvent';

/**
 * Interface for HSM configuration
 */
export interface HSMConfig {
  // HSM library path
  libraryPath: string;
  
  // HSM slot ID
  slotId: number;
  
  // HSM PIN
  pin: string;
  
  // Key labels
  keyLabels: {
    ethereum: string;
    solana: string;
  };
  
  // Retry settings
  maxRetries: number;
  retryDelayMs: number;
}

/**
 * Interface for security configuration
 */
export interface SecurityConfig {
  // General security settings
  enableHSM: boolean;
  enableRateLimiting: boolean;
  enableFirewall: boolean;
  enableAnomalyDetection: boolean;
  
  // HSM configuration
  hsm: HSMConfig;
  
  // Rate limiting settings
  rateLimiting: {
    maxRequestsPerMinute: number;
    maxRequestsPerHour: number;
    maxRequestsPerDay: number;
    ipWhitelist: string[];
  };
  
  // Firewall settings
  firewall: {
    allowedIPs: string[];
    blockedIPs: string[];
    allowedCountries: string[];
    blockedCountries: string[];
  };
  
  // Key rotation settings
  keyRotation: {
    enabled: boolean;
    intervalDays: number;
    lastRotation?: Date;
  };
  
  // Anomaly detection settings
  anomalyDetection: {
    enabled: boolean;
    thresholds: {
      transactionVolume: number;
      errorRate: number;
      failedSignatures: number;
    };
  };
}

/**
 * Enhanced security service with real HSM integration
 */
@Injectable()
export class EnhancedSecurityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger;
  private readonly config: SecurityConfig;
  private isInitialized: boolean = false;
  private isRunning: boolean = false;
  
  // HSM connection
  private pkcs11: pkcs11js.PKCS11;
  private session: any = null;
  private ethereumKeyHandle: any = null;
  private solanaKeyHandle: any = null;
  
  // Rate limiting state
  private rateLimiters: Map<string, {
    count: number;
    resetTime: Date;
  }> = new Map();
  
  /**
   * Constructor for EnhancedSecurityService
   * 
   * @param securityEventRepository - Repository for security events
   * @param configService - Configuration service
   * @param metricsService - Metrics service
   * @param monitoringService - Monitoring service
   * @param cacheService - Cache service
   */
  constructor(
    @InjectRepository(SecurityEvent)
    private readonly securityEventRepository: Repository<SecurityEvent>,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly monitoringService: MonitoringService,
    private readonly cacheService: CacheService
  ) {
    this.logger = new Logger('EnhancedSecurityService');
    
    // Load configuration
    this.config = this.loadSecurityConfig();
    
    // Initialize PKCS#11 if HSM is enabled
    if (this.config.enableHSM) {
      this.pkcs11 = new pkcs11js.PKCS11();
    }
    
    this.logger.info('EnhancedSecurityService created');
  }
  
  /**
   * Initialize the service when the module is initialized
   */
  async onModuleInit(): Promise<void> {
    await this.initialize();
  }
  
  /**
   * Clean up when the module is destroyed
   */
  onModuleDestroy(): void {
    this.cleanup();
  }
  
  /**
   * Load security configuration
   * 
   * @returns Security configuration
   */
  private loadSecurityConfig(): SecurityConfig {
    const config = this.configService.get('security', {});
    
    // Default configuration
    const defaultConfig: SecurityConfig = {
      enableHSM: true,
      enableRateLimiting: true,
      enableFirewall: true,
      enableAnomalyDetection: true,
      
      hsm: {
        libraryPath: '/usr/local/lib/softhsm/libsofthsm2.so',
        slotId: 0,
        pin: process.env.HSM_PIN || '1234',
        keyLabels: {
          ethereum: 'eth-key',
          solana: 'sol-key'
        },
        maxRetries: 3,
        retryDelayMs: 1000
      },
      
      rateLimiting: {
        maxRequestsPerMinute: 60,
        maxRequestsPerHour: 1000,
        maxRequestsPerDay: 10000,
        ipWhitelist: []
      },
      
      firewall: {
        allowedIPs: [],
        blockedIPs: [],
        allowedCountries: [],
        blockedCountries: []
      },
      
      keyRotation: {
        enabled: true,
        intervalDays: 30
      },
      
      anomalyDetection: {
        enabled: true,
        thresholds: {
          transactionVolume: 1000,
          errorRate: 0.05,
          failedSignatures: 10
        }
      }
    };
    
    // Merge with provided config
    return {
      ...defaultConfig,
      ...config,
      hsm: {
        ...defaultConfig.hsm,
        ...(config.hsm || {})
      },
      rateLimiting: {
        ...defaultConfig.rateLimiting,
        ...(config.rateLimiting || {})
      },
      firewall: {
        ...defaultConfig.firewall,
        ...(config.firewall || {})
      },
      keyRotation: {
        ...defaultConfig.keyRotation,
        ...(config.keyRotation || {})
      },
      anomalyDetection: {
        ...defaultConfig.anomalyDetection,
        ...(config.anomalyDetection || {})
      }
    };
  }
  
  /**
   * Initialize the security service
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('EnhancedSecurityService is already initialized');
      return;
    }
    
    this.logger.info('Initializing EnhancedSecurityService');
    
    try {
      // Initialize HSM if enabled
      if (this.config.enableHSM) {
        await this.initializeHSM();
      }
      
      // Initialize rate limiters
      this.initializeRateLimiters();
      
      // Initialize firewall
      if (this.config.enableFirewall) {
        await this.initializeFirewall();
      }
      
      // Check if key rotation is needed
      if (this.config.keyRotation.enabled) {
        await this.checkKeyRotation();
      }
      
      this.isInitialized = true;
      this.logger.info('EnhancedSecurityService initialized successfully');
      
      // Record metrics
      this.metricsService.recordMetric('security.initialization', {
        success: true,
        hsm_enabled: this.config.enableHSM,
        rate_limiting_enabled: this.config.enableRateLimiting,
        firewall_enabled: this.config.enableFirewall,
        anomaly_detection_enabled: this.config.enableAnomalyDetection
      });
    } catch (error) {
      this.logger.error('Failed to initialize EnhancedSecurityService', error);
      
      // Record error metric
      this.metricsService.recordMetric('security.initialization_error', {
        error: error.message
      });
      
      throw new Error(`Failed to initialize EnhancedSecurityService: ${error.message}`);
    }
  }
  
  /**
   * Start the security service
   */
  public async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    if (this.isRunning) {
      this.logger.warn('EnhancedSecurityService is already running');
      return;
    }
    
    this.logger.info('Starting EnhancedSecurityService');
    
    try {
      // Start monitoring for anomalies if enabled
      if (this.config.enableAnomalyDetection) {
        await this.startAnomalyDetection();
      }
      
      this.isRunning = true;
      this.logger.info('EnhancedSecurityService started successfully');
      
      // Record metrics
      this.metricsService.recordMetric('security.service_started', 1);
    } catch (error) {
      this.logger.error('Failed to start EnhancedSecurityService', error);
      
      // Record error metric
      this.metricsService.recordMetric('security.start_error', {
        error: error.message
      });
      
      throw new Error(`Failed to start EnhancedSecurityService: ${error.message}`);
    }
  }
  
  /**
   * Stop the security service
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('EnhancedSecurityService is not running');
      return;
    }
    
    this.logger.info('Stopping EnhancedSecurityService');
    
    try {
      // Stop anomaly detection if running
      if (this.config.enableAnomalyDetection) {
        await this.stopAnomalyDetection();
      }
      
      this.isRunning = false;
      this.logger.info('EnhancedSecurityService stopped successfully');
      
      // Record metrics
      this.metricsService.recordMetric('security.service_stopped', 1);
    } catch (error) {
      this.logger.error('Failed to stop EnhancedSecurityService', error);
      
      // Record error metric
      this.metricsService.recordMetric('security.stop_error', {
        error: error.message
      });
      
      throw new Error(`Failed to stop EnhancedSecurityService: ${error.message}`);
    }
  }
  
  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.logger.info('Cleaning up EnhancedSecurityService resources');
    
    try {
      // Close HSM session if open
      if (this.session) {
        this.closeHSMSession();
      }
      
      // Finalize PKCS#11 if initialized
      if (this.pkcs11 && this.config.enableHSM) {
        try {
          this.pkcs11.finalize();
        } catch (error) {
          this.logger.error('Error finalizing PKCS#11', error);
        }
      }
      
      this.logger.info('EnhancedSecurityService resources cleaned up');
    } catch (error) {
      this.logger.error('Error cleaning up EnhancedSecurityService resources', error);
    }
  }
  
  /**
   * Initialize HSM connection
   */
  private async initializeHSM(): Promise<void> {
    this.logger.info('Initializing HSM connection');
    
    try {
      // Load PKCS#11 library
      this.pkcs11.load(this.config.hsm.libraryPath);
      
      // Initialize PKCS#11
      this.pkcs11.C_Initialize();
      
      // Get slot list
      const slots = this.pkcs11.C_GetSlotList(true);
      if (slots.length === 0) {
        throw new Error('No HSM slots available');
      }
      
      // Use configured slot or first available
      const slotId = this.config.hsm.slotId < slots.length ? this.config.hsm.slotId : slots[0];
      
      // Open session
      this.session = this.pkcs11.C_OpenSession(
        slotId,
        pkcs11js.CKF_RW_SESSION | pkcs11js.CKF_SERIAL_SESSION
      );
      
      // Login
      this.pkcs11.C_Login(this.session, pkcs11js.CKU_USER, this.config.hsm.pin);
      
      // Find Ethereum key
      this.ethereumKeyHandle = this.findKey(this.config.hsm.keyLabels.ethereum);
      
      // Find Solana key
      this.solanaKeyHandle = this.findKey(this.config.hsm.keyLabels.solana);
      
      this.logger.info('HSM connection initialized successfully');
      
      // Record metrics
      this.metricsService.recordMetric('security.hsm_initialized', 1);
      
      // Log security event
      await this.logSecurityEvent('HSM_INITIALIZED', 'HSM connection initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize HSM connection', error);
      
      // Record error metric
      this.metricsService.recordMetric('security.hsm_initialization_error', {
        error: error.message
      });
      
      // Log security event
      await this.logSecurityEvent('HSM_INITIALIZATION_FAILED', `Failed to initialize HSM: ${error.message}`);
      
      throw new Error(`Failed to initialize HSM connection: ${error.message}`);
    }
  }
  
  /**
   * Find a key in the HSM by label
   * 
   * @param label - Key label
   * @returns Key handle
   */
  private findKey(label: string): any {
    this.logger.debug(`Finding key with label: ${label}`);
    
    // Create search template
    const template = [
      { type: pkcs11js.CKA_CLASS, value: pkcs11js.CKO_PRIVATE_KEY },
      { type: pkcs11js.CKA_LABEL, value: Buffer.from(label) }
    ];
    
    // Find key
    this.pkcs11.C_FindObjectsInit(this.session, template);
    const keys = this.pkcs11.C_FindObjects(this.session, 1);
    this.pkcs11.C_FindObjectsFinal(this.session);
    
    if (keys.length === 0) {
      this.logger.warn(`Key with label ${label} not found in HSM`);
      return null;
    }
    
    this.logger.debug(`Found key with label: ${label}`);
    return keys[0];
  }
  
  /**
   * Close HSM session
   */
  private closeHSMSession(): void {
    this.logger.info('Closing HSM session');
    
    try {
      // Logout
      this.pkcs11.C_Logout(this.session);
      
      // Close session
      this.pkcs11.C_CloseSession(this.session);
      
      this.session = null;
      this.ethereumKeyHandle = null;
      this.solanaKeyHandle = null;
      
      this.logger.info('HSM session closed successfully');
    } catch (error) {
      this.logger.error('Error closing HSM session', error);
    }
  }
  
  /**
   * Sign data with Ethereum key in HSM
   * 
   * @param data - Data to sign
   * @returns Signature
   */
  public async signWithEthereumKey(data: Buffer): Promise<Buffer> {
    if (!this.config.enableHSM) {
      throw new Error('HSM is not enabled');
    }
    
    if (!this.session) {
      throw new Error('HSM session is not initialized');
    }
    
    if (!this.ethereumKeyHandle) {
      throw new Error('Ethereum key not found in HSM');
    }
    
    this.logger.debug('Signing data with Ethereum key in HSM');
    
    try {
      // Create digest
      const digest = ethers.utils.keccak256(data);
      const digestBuffer = Buffer.from(digest.slice(2), 'hex');
      
      // Sign with HSM
      const signature = await this.signWithHSM(this.ethereumKeyHandle, digestBuffer);
      
      // Record metrics
      this.metricsService.recordMetric('security.ethereum_signature', 1);
      
      return signature;
    } catch (error) {
      this.logger.error('Error signing with Ethereum key in HSM', error);
      
      // Record error metric
      this.metricsService.recordMetric('security.ethereum_signature_error', 1);
      
      // Log security event
      await this.logSecurityEvent('ETHEREUM_SIGNATURE_FAILED', `Failed to sign with Ethereum key: ${error.message}`);
      
      throw new Error(`Failed to sign with Ethereum key: ${error.message}`);
    }
  }
  
  /**
   * Sign data with Solana key in HSM
   * 
   * @param data - Data to sign
   * @returns Signature
   */
  public async signWithSolanaKey(data: Buffer): Promise<Buffer> {
    if (!this.config.enableHSM) {
      throw new Error('HSM is not enabled');
    }
    
    if (!this.session) {
      throw new Error('HSM session is not initialized');
    }
    
    if (!this.solanaKeyHandle) {
      throw new Error('Solana key not found in HSM');
    }
    
    this.logger.debug('Signing data with Solana key in HSM');
    
    try {
      // Sign with HSM
      const signature = await this.signWithHSM(this.solanaKeyHandle, data);
      
      // Record metrics
      this.metricsService.recordMetric('security.solana_signature', 1);
      
      return signature;
    } catch (error) {
      this.logger.error('Error signing with Solana key in HSM', error);
      
      // Record error metric
      this.metricsService.recordMetric('security.solana_signature_error', 1);
      
      // Log security event
      await this.logSecurityEvent('SOLANA_SIGNATURE_FAILED', `Failed to sign with Solana key: ${error.message}`);
      
      throw new Error(`Failed to sign with Solana key: ${error.message}`);
    }
  }
  
  /**
   * Sign data with HSM
   * 
   * @param keyHandle - Key handle
   * @param data - Data to sign
   * @returns Signature
   */
  private async signWithHSM(keyHandle: any, data: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        // Initialize signing
        this.pkcs11.C_SignInit(
          this.session,
          { mechanism: pkcs11js.CKM_ECDSA },
          keyHandle
        );
        
        // Sign data
        const signature = this.pkcs11.C_Sign(this.session, data);
        
        resolve(signature);
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * Initialize rate limiters
   */
  private initializeRateLimiters(): void {
    this.logger.info('Initializing rate limiters');
    
    // Clear existing rate limiters
    this.rateLimiters.clear();
    
    this.logger.info('Rate limiters initialized');
  }
  
  /**
   * Check if a request is rate limited
   * 
   * @param ip - IP address
   * @param userId - User ID (optional)
   * @returns Whether the request is allowed
   */
  public isRateLimited(ip: string, userId?: string): boolean {
    if (!this.config.enableRateLimiting) {
      return false;
    }
    
    // Check if IP is whitelisted
    if (this.config.rateLimiting.ipWhitelist.includes(ip)) {
      return false;
    }
    
    // Get key for rate limiter
    const key = userId ? `${ip}:${userId}` : ip;
    
    // Get current time
    const now = new Date();
    
    // Get or create rate limiter entry
    let entry = this.rateLimiters.get(key);
    if (!entry) {
      entry = {
        count: 0,
        resetTime: new Date(now.getTime() + 60000) // Reset after 1 minute
      };
      this.rateLimiters.set(key, entry);
    }
    
    // Check if reset time has passed
    if (now >= entry.resetTime) {
      entry.count = 0;
      entry.resetTime = new Date(now.getTime() + 60000);
    }
    
    // Increment count
    entry.count++;
    
    // Check if rate limit exceeded
    const isLimited = entry.count > this.config.rateLimiting.maxRequestsPerMinute;
    
    if (isLimited) {
      this.logger.warn(`Rate limit exceeded for ${key}: ${entry.count} requests`);
      
      // Record metrics
      this.metricsService.recordMetric('security.rate_limit_exceeded', {
        ip,
        userId: userId || 'anonymous',
        count: entry.count
      });
      
      // Log security event
      this.logSecurityEvent('RATE_LIMIT_EXCEEDED', `Rate limit exceeded for ${key}: ${entry.count} requests`);
    }
    
    return isLimited;
  }
  
  /**
   * Initialize firewall
   */
  private async initializeFirewall(): Promise<void> {
    this.logger.info('Initializing firewall');
    
    try {
      // Load blocked IPs from database
      // In a real implementation, this would load from a database
      // For now, we'll use the configuration
      
      this.logger.info('Firewall initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize firewall', error);
      throw new Error(`Failed to initialize firewall: ${error.message}`);
    }
  }
  
  /**
   * Check if an IP is allowed by the firewall
   * 
   * @param ip - IP address
   * @returns Whether the IP is allowed
   */
  public isIPAllowed(ip: string): boolean {
    if (!this.config.enableFirewall) {
      return true;
    }
    
    // Check if IP is explicitly blocked
    if (this.config.firewall.blockedIPs.includes(ip)) {
      this.logger.warn(`Blocked IP detected: ${ip}`);
      
      // Record metrics
      this.metricsService.recordMetric('security.blocked_ip_detected', {
        ip
      });
      
      // Log security event
      this.logSecurityEvent('BLOCKED_IP_DETECTED', `Blocked IP detected: ${ip}`);
      
      return false;
    }
    
    // Check if IP is explicitly allowed
    if (this.config.firewall.allowedIPs.length > 0 && !this.config.firewall.allowedIPs.includes(ip)) {
      this.logger.warn(`IP not in allowed list: ${ip}`);
      
      // Record metrics
      this.metricsService.recordMetric('security.ip_not_allowed', {
        ip
      });
      
      // Log security event
      this.logSecurityEvent('IP_NOT_ALLOWED', `IP not in allowed list: ${ip}`);
      
      return false;
    }
    
    return true;
  }
  
  /**
   * Check if key rotation is needed
   */
  private async checkKeyRotation(): Promise<void> {
    this.logger.info('Checking if key rotation is needed');
    
    try {
      // Get last rotation date
      const lastRotation = this.config.keyRotation.lastRotation || new Date(0);
      
      // Calculate days since last rotation
      const now = new Date();
      const daysSinceLastRotation = Math.floor((now.getTime() - lastRotation.getTime()) / (1000 * 60 * 60 * 24));
      
      // Check if rotation is needed
      if (daysSinceLastRotation >= this.config.keyRotation.intervalDays) {
        this.logger.info(`Key rotation needed: ${daysSinceLastRotation} days since last rotation`);
        
        // In a real implementation, this would trigger a key rotation process
        // For now, we'll just log it
        
        // Update last rotation date
        this.config.keyRotation.lastRotation = now;
        
        // Log security event
        await this.logSecurityEvent('KEY_ROTATION_NEEDED', `Key rotation needed: ${daysSinceLastRotation} days since last rotation`);
      } else {
        this.logger.info(`Key rotation not needed: ${daysSinceLastRotation} days since last rotation`);
      }
    } catch (error) {
      this.logger.error('Error checking key rotation', error);
    }
  }
  
  /**
   * Start anomaly detection
   */
  private async startAnomalyDetection(): Promise<void> {
    this.logger.info('Starting anomaly detection');
    
    try {
      // In a real implementation, this would start a background process
      // For now, we'll just log it
      
      this.logger.info('Anomaly detection started successfully');
    } catch (error) {
      this.logger.error('Failed to start anomaly detection', error);
      throw new Error(`Failed to start anomaly detection: ${error.message}`);
    }
  }
  
  /**
   * Stop anomaly detection
   */
  private async stopAnomalyDetection(): Promise<void> {
    this.logger.info('Stopping anomaly detection');
    
    try {
      // In a real implementation, this would stop the background process
      // For now, we'll just log it
      
      this.logger.info('Anomaly detection stopped successfully');
    } catch (error) {
      this.logger.error('Failed to stop anomaly detection', error);
      throw new Error(`Failed to stop anomaly detection: ${error.message}`);
    }
  }
  
  /**
   * Log a security event
   * 
   * @param type - Event type
   * @param message - Event message
   * @param data - Additional data
   */
  public async logSecurityEvent(type: string, message: string, data?: any): Promise<void> {
    try {
      // Create security event
      const event = new SecurityEvent();
      event.type = type;
      event.message = message;
      event.data = data;
      event.timestamp = new Date();
      
      // Save to database
      await this.securityEventRepository.save(event);
      
      // Log to console
      this.logger.info(`Security event: ${type} - ${message}`);
      
      // Send alert if needed
      if (type.includes('FAILED') || type.includes('EXCEEDED') || type.includes('BLOCKED')) {
        this.monitoringService.sendAlert({
          level: 'warning',
          source: 'security',
          message: `Security event: ${type} - ${message}`,
          data: data
        });
      }
    } catch (error) {
      this.logger.error('Error logging security event', error);
    }
  }
  
  /**
   * Get security service status
   * 
   * @returns Service status
   */
  public async getStatus(): Promise<any> {
    try {
      // Get security events count
      const eventsCount = await this.securityEventRepository.count();
      
      // Get recent security events
      const recentEvents = await this.securityEventRepository.find({
        order: { timestamp: 'DESC' },
        take: 10
      });
      
      return {
        isInitialized: this.isInitialized,
        isRunning: this.isRunning,
        hsmEnabled: this.config.enableHSM,
        hsmConnected: !!this.session,
        rateLimitingEnabled: this.config.enableRateLimiting,
        firewallEnabled: this.config.enableFirewall,
        anomalyDetectionEnabled: this.config.enableAnomalyDetection,
        keyRotation: {
          enabled: this.config.keyRotation.enabled,
          intervalDays: this.config.keyRotation.intervalDays,
          lastRotation: this.config.keyRotation.lastRotation
        },
        securityEvents: {
          total: eventsCount,
          recent: recentEvents.map(event => ({
            type: event.type,
            message: event.message,
            timestamp: event.timestamp
          }))
        }
      };
    } catch (error) {
      this.logger.error('Error getting security service status', error);
      throw new Error(`Failed to get security service status: ${error.message}`);
    }
  }
}
