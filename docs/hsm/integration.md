# HSM Integration Guide

This guide provides instructions for integrating Hardware Security Modules (HSMs) with the LAYER-2 system on Solana.

## Table of Contents

1. [Introduction](#introduction)
2. [Architecture Overview](#architecture-overview)
3. [Integration with Sequencer](#integration-with-sequencer)
4. [Failover System](#failover-system)
5. [Key Rotation System](#key-rotation-system)
6. [Security Best Practices](#security-best-practices)
7. [Performance Considerations](#performance-considerations)
8. [Compliance and Audit](#compliance-and-audit)

## Introduction

This guide describes how to integrate Hardware Security Modules (HSMs) with the LAYER-2 system on Solana. The integration provides secure key management for critical operations such as transaction signing, block production, and state validation.

## Architecture Overview

The HSM integration architecture consists of the following components:

1. **Key Manager Interface**: An abstract interface that defines the operations for key management
2. **HSM Implementations**: Concrete implementations for different HSM providers
3. **Failover System**: A multi-level failover system for high availability
4. **Key Rotation System**: Automatic key rotation for enhanced security
5. **Monitoring and Metrics**: Comprehensive monitoring and alerting

### Component Diagram

```
┌─────────────────────────────────────┐
│           Sequencer                 │
└───────────────┬─────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│           Key Manager               │
└───────────────┬─────────────────────┘
                │
        ┌───────┴───────┐
        │               │
        ▼               ▼
┌───────────────┐ ┌─────────────────┐
│ AWS CloudHSM  │ │    YubiHSM      │
└───────┬───────┘ └────────┬────────┘
        │                  │
        │                  │
        ▼                  ▼
┌───────────────┐ ┌─────────────────┐
│ Failover      │ │  Key Rotation   │
└───────────────┘ └─────────────────┘
```

## Integration with Sequencer

The sequencer uses the Key Manager interface to perform cryptographic operations. This section describes how to integrate the HSM with the sequencer.

### Configuration

Update the sequencer configuration file to use the HSM:

```json
{
  "sequencer": {
    "keyManager": {
      "type": "aws-cloudhsm",
      "config": {
        "clusterEndpoint": "<cluster-ip>",
        "username": "sequencer-user",
        "password": "password",
        "keyHandle": "<key-handle>",
        "region": "us-east-1"
      }
    }
  }
}
```

### Code Integration

The sequencer code should be updated to use the Key Manager interface:

```javascript
// Before
const signature = await this.keypair.sign(message);

// After
const signature = await this.keyManager.sign(message);
```

### Example Implementation

```javascript
class Sequencer {
  constructor(config) {
    // Initialize the key manager based on configuration
    this.keyManager = KeyManagerFactory.create(config.keyManager);
  }

  async start() {
    // Initialize the key manager
    await this.keyManager.initialize();
    
    // Start the sequencer
    // ...
  }

  async processTransaction(transaction) {
    // Create a message to sign
    const message = this.createMessage(transaction);
    
    // Sign the message using the HSM
    const signature = await this.keyManager.sign(message);
    
    // Verify the signature
    const isValid = await this.keyManager.verify(message, signature);
    
    if (!isValid) {
      throw new Error('Invalid signature');
    }
    
    // Process the transaction
    // ...
    
    return { id: transaction.id, status: 'processed', signature };
  }

  async stop() {
    // Close the key manager
    await this.keyManager.close();
    
    // Stop the sequencer
    // ...
  }
}
```

## Failover System

The failover system provides high availability for the HSM integration. It supports multiple levels of failover:

1. **Primary Failover**: Between HSM clusters in different availability zones
2. **Secondary Failover**: To an alternative HSM provider
3. **Emergency Failover**: To an ephemeral key provider for critical situations

### Configuration

```json
{
  "keyManager": {
    "failover": {
      "enabled": true,
      "primaryRetryIntervalMs": 5000,
      "maxPrimaryRetries": 3,
      "secondaryRetryIntervalMs": 10000,
      "maxSecondaryRetries": 3,
      "emergencyModeEnabled": true,
      "emergencyModeRestrictions": {
        "maxTransactions": 1000,
        "maxTimeSeconds": 3600,
        "allowedOperations": ["sign"]
      }
    }
  }
}
```

### Failover Flow

The failover system follows this flow:

1. Attempt to use the primary HSM provider
2. If the primary provider fails, retry up to `maxPrimaryRetries` times
3. If all retries fail, switch to the secondary provider
4. If the secondary provider fails, retry up to `maxSecondaryRetries` times
5. If all retries fail and emergency mode is enabled, switch to the emergency provider
6. If emergency mode is disabled or the emergency provider fails, return an error

### Example Implementation

```javascript
class FailoverManager {
  constructor(config, providers) {
    this.config = config;
    this.providers = providers;
    this.currentProvider = providers[0]; // Primary provider
    this.failoverHistory = [];
  }

  async executeWithFailover(operation, ...args) {
    // Try the primary provider
    try {
      return await this.executeWithRetries(
        this.providers[0],
        operation,
        this.config.maxPrimaryRetries,
        this.config.primaryRetryIntervalMs,
        ...args
      );
    } catch (error) {
      this.logFailover('primary', error);
      
      // Try the secondary provider
      try {
        return await this.executeWithRetries(
          this.providers[1],
          operation,
          this.config.maxSecondaryRetries,
          this.config.secondaryRetryIntervalMs,
          ...args
        );
      } catch (secondaryError) {
        this.logFailover('secondary', secondaryError);
        
        // Try the emergency provider if enabled
        if (this.config.emergencyModeEnabled && this.providers.length > 2) {
          try {
            // Check if the operation is allowed in emergency mode
            if (!this.isOperationAllowedInEmergencyMode(operation)) {
              throw new Error(`Operation ${operation} not allowed in emergency mode`);
            }
            
            // Check emergency mode restrictions
            this.checkEmergencyModeRestrictions();
            
            // Execute with the emergency provider
            const result = await this.providers[2][operation](...args);
            this.logEmergencyOperation(operation);
            return result;
          } catch (emergencyError) {
            this.logFailover('emergency', emergencyError);
            throw new Error(`All providers failed: ${error.message}, ${secondaryError.message}, ${emergencyError.message}`);
          }
        } else {
          throw new Error(`All providers failed: ${error.message}, ${secondaryError.message}`);
        }
      }
    }
  }

  async executeWithRetries(provider, operation, maxRetries, retryInterval, ...args) {
    let lastError;
    
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await provider[operation](...args);
      } catch (error) {
        lastError = error;
        
        if (i < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryInterval));
        }
      }
    }
    
    throw lastError;
  }

  isOperationAllowedInEmergencyMode(operation) {
    return this.config.emergencyModeRestrictions.allowedOperations.includes(operation);
  }

  checkEmergencyModeRestrictions() {
    const emergencyOperations = this.failoverHistory.filter(entry => entry.provider === 'emergency');
    
    // Check max transactions
    if (emergencyOperations.length >= this.config.emergencyModeRestrictions.maxTransactions) {
      throw new Error('Emergency mode transaction limit exceeded');
    }
    
    // Check max time
    if (emergencyOperations.length > 0) {
      const firstEmergencyOperation = emergencyOperations[0];
      const currentTime = Date.now();
      const elapsedTimeSeconds = (currentTime - firstEmergencyOperation.timestamp) / 1000;
      
      if (elapsedTimeSeconds > this.config.emergencyModeRestrictions.maxTimeSeconds) {
        throw new Error('Emergency mode time limit exceeded');
      }
    }
  }

  logFailover(provider, error) {
    const entry = {
      provider,
      timestamp: Date.now(),
      error: error.message
    };
    
    this.failoverHistory.push(entry);
    console.error(`Failover from ${provider} provider: ${error.message}`);
    
    // Emit failover event
    this.emit('failover', entry);
  }

  logEmergencyOperation(operation) {
    const entry = {
      provider: 'emergency',
      operation,
      timestamp: Date.now()
    };
    
    this.failoverHistory.push(entry);
    console.warn(`Emergency operation: ${operation}`);
    
    // Emit emergency operation event
    this.emit('emergency-operation', entry);
  }
}
```

## Key Rotation System

The key rotation system automatically rotates keys to limit their exposure. It supports:

1. **Scheduled Rotation**: Automatic rotation based on a schedule
2. **Overlap Period**: Period during which both old and new keys are valid
3. **Backup**: Backup of keys before rotation
4. **Notifications**: Notifications for key rotation events

### Configuration

```json
{
  "keyManager": {
    "keyRotation": {
      "enabled": true,
      "intervalDays": 30,
      "overlapDays": 2,
      "rotationTime": "00:00:00",
      "timeZone": "UTC",
      "backupEnabled": true,
      "backupLocation": "s3://layer2-key-backups"
    }
  }
}
```

### Rotation Flow

The key rotation system follows this flow:

1. Check if rotation is due based on the schedule
2. If rotation is due, create a backup of the current key (if backup is enabled)
3. Generate a new key in the HSM
4. Update the key manager to use the new key
5. Keep the old key active during the overlap period
6. After the overlap period, deactivate the old key
7. Log the rotation event and send notifications

### Example Implementation

```javascript
class KeyRotationSystem {
  constructor(config, keyManager) {
    this.config = config;
    this.keyManager = keyManager;
    this.rotationHistory = [];
    this.nextRotationTime = this.calculateNextRotationTime();
  }

  async initialize() {
    // Schedule the next rotation
    this.scheduleNextRotation();
  }

  scheduleNextRotation() {
    const now = new Date();
    const nextRotation = this.nextRotationTime;
    
    // Calculate the time until the next rotation
    const timeUntilRotation = nextRotation.getTime() - now.getTime();
    
    if (timeUntilRotation > 0) {
      // Schedule the rotation
      setTimeout(() => this.rotateKey(), timeUntilRotation);
      console.log(`Next key rotation scheduled at ${nextRotation.toISOString()}`);
    } else {
      // Rotation is overdue, rotate immediately
      this.rotateKey();
    }
  }

  calculateNextRotationTime() {
    const lastRotation = this.getLastRotationTime();
    const intervalMs = this.config.intervalDays * 24 * 60 * 60 * 1000;
    
    // Calculate the next rotation time
    const nextRotation = new Date(lastRotation.getTime() + intervalMs);
    
    // Set the rotation time
    const [hours, minutes, seconds] = this.config.rotationTime.split(':').map(Number);
    nextRotation.setHours(hours, minutes, seconds, 0);
    
    return nextRotation;
  }

  getLastRotationTime() {
    if (this.rotationHistory.length > 0) {
      return new Date(this.rotationHistory[this.rotationHistory.length - 1].timestamp);
    } else {
      // If no rotation history, use the current time
      return new Date();
    }
  }

  async rotateKey() {
    try {
      console.log('Starting key rotation');
      
      // Create a backup of the current key if enabled
      if (this.config.backupEnabled) {
        await this.backupCurrentKey();
      }
      
      // Generate a new key in the HSM
      const newKeyId = await this.keyManager.generateKey();
      
      // Get the current key ID
      const currentKeyId = await this.keyManager.getCurrentKeyId();
      
      // Update the key manager to use the new key
      await this.keyManager.setCurrentKeyId(newKeyId);
      
      // Keep the old key active during the overlap period
      const overlapMs = this.config.overlapDays * 24 * 60 * 60 * 1000;
      setTimeout(() => this.deactivateKey(currentKeyId), overlapMs);
      
      // Log the rotation event
      const rotationEvent = {
        timestamp: Date.now(),
        oldKeyId: currentKeyId,
        newKeyId: newKeyId
      };
      
      this.rotationHistory.push(rotationEvent);
      console.log(`Key rotation completed: ${currentKeyId} -> ${newKeyId}`);
      
      // Emit rotation event
      this.emit('rotation', rotationEvent);
      
      // Calculate the next rotation time
      this.nextRotationTime = this.calculateNextRotationTime();
      
      // Schedule the next rotation
      this.scheduleNextRotation();
    } catch (error) {
      console.error(`Key rotation failed: ${error.message}`);
      
      // Retry after a delay
      setTimeout(() => this.rotateKey(), 60 * 60 * 1000); // Retry after 1 hour
    }
  }

  async backupCurrentKey() {
    try {
      const currentKeyId = await this.keyManager.getCurrentKeyId();
      const backupData = await this.keyManager.exportKeyBackup(currentKeyId);
      
      // Store the backup
      await this.storeBackup(currentKeyId, backupData);
      
      console.log(`Backup created for key ${currentKeyId}`);
    } catch (error) {
      console.error(`Backup failed: ${error.message}`);
      throw error;
    }
  }

  async storeBackup(keyId, backupData) {
    // Implementation depends on the backup location
    if (this.config.backupLocation.startsWith('s3://')) {
      // Store in S3
      const bucketName = this.config.backupLocation.substring(5).split('/')[0];
      const keyPrefix = this.config.backupLocation.substring(5 + bucketName.length + 1);
      const keyName = `${keyPrefix}/${keyId}_${Date.now()}.backup`;
      
      // Use AWS SDK to store the backup
      // ...
    } else {
      // Store in local file system
      const fs = require('fs');
      const path = require('path');
      const backupPath = path.join(this.config.backupLocation, `${keyId}_${Date.now()}.backup`);
      
      fs.writeFileSync(backupPath, backupData);
    }
  }

  async deactivateKey(keyId) {
    try {
      await this.keyManager.deactivateKey(keyId);
      console.log(`Key ${keyId} deactivated`);
    } catch (error) {
      console.error(`Failed to deactivate key ${keyId}: ${error.message}`);
    }
  }
}
```

## Security Best Practices

When integrating HSMs with the LAYER-2 system, follow these security best practices:

1. **Least Privilege**: Use the principle of least privilege when creating HSM users and roles
2. **Network Security**: Restrict network access to HSM endpoints
3. **Audit Logging**: Enable audit logging for all HSM operations
4. **Multi-Factor Authentication**: Use multi-factor authentication for HSM administration
5. **Key Backup**: Regularly backup keys and test the restoration process
6. **Monitoring**: Implement comprehensive monitoring and alerting for HSM operations
7. **Incident Response**: Develop and test an incident response plan for HSM-related incidents
8. **Compliance**: Ensure compliance with relevant regulations and standards

## Performance Considerations

HSM integration can impact the performance of the LAYER-2 system. Consider the following:

1. **Latency**: HSM operations introduce additional latency
2. **Throughput**: HSMs have limited throughput for cryptographic operations
3. **Caching**: Use caching to reduce the number of HSM operations
4. **Batching**: Batch operations when possible to improve throughput
5. **Scaling**: Scale HSM clusters based on expected load
6. **Monitoring**: Monitor HSM performance metrics to identify bottlenecks

### Performance Optimization

```javascript
class OptimizedKeyManager {
  constructor(config, hsm) {
    this.config = config;
    this.hsm = hsm;
    this.signatureCache = new Map();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  async sign(message) {
    // Check if the signature is in the cache
    const cacheKey = this.getCacheKey(message);
    
    if (this.signatureCache.has(cacheKey)) {
      this.cacheHits++;
      return this.signatureCache.get(cacheKey);
    }
    
    this.cacheMisses++;
    
    // Sign the message using the HSM
    const signature = await this.hsm.sign(message);
    
    // Cache the signature
    this.signatureCache.set(cacheKey, signature);
    
    // Limit the cache size
    if (this.signatureCache.size > this.config.maxCacheSize) {
      // Remove the oldest entry
      const oldestKey = this.signatureCache.keys().next().value;
      this.signatureCache.delete(oldestKey);
    }
    
    return signature;
  }

  getCacheKey(message) {
    // Create a cache key from the message
    return crypto.createHash('sha256').update(message).digest('hex');
  }

  getCacheStats() {
    return {
      size: this.signatureCache.size,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: this.cacheHits / (this.cacheHits + this.cacheMisses)
    };
  }
}
```

## Compliance and Audit

The HSM integration supports compliance with various regulations and standards:

1. **FIPS 140-2**: Federal Information Processing Standard for cryptographic modules
2. **PCI DSS**: Payment Card Industry Data Security Standard
3. **SOC 2**: Service Organization Control 2
4. **GDPR**: General Data Protection Regulation
5. **CCPA**: California Consumer Privacy Act

### Audit Logging

The HSM integration provides comprehensive audit logging:

```javascript
class AuditLogger {
  constructor(config) {
    this.config = config;
    this.logs = [];
  }

  logOperation(operation, params, result) {
    const logEntry = {
      timestamp: Date.now(),
      operation,
      params: this.sanitizeParams(params),
      result: this.sanitizeResult(result),
      user: this.getCurrentUser(),
      source: this.getSourceInfo()
    };
    
    this.logs.push(logEntry);
    
    // Write to the audit log
    this.writeToAuditLog(logEntry);
    
    return logEntry;
  }

  sanitizeParams(params) {
    // Remove sensitive information from parameters
    const sanitized = { ...params };
    
    if (sanitized.password) {
      sanitized.password = '********';
    }
    
    if (sanitized.key) {
      sanitized.key = '********';
    }
    
    return sanitized;
  }

  sanitizeResult(result) {
    // Remove sensitive information from results
    if (typeof result === 'object' && result !== null) {
      const sanitized = { ...result };
      
      if (sanitized.key) {
        sanitized.key = '********';
      }
      
      return sanitized;
    }
    
    return result;
  }

  getCurrentUser() {
    // Get the current user
    return process.env.USER || 'unknown';
  }

  getSourceInfo() {
    // Get information about the source of the operation
    return {
      hostname: os.hostname(),
      pid: process.pid,
      ip: this.getIpAddress()
    };
  }

  getIpAddress() {
    // Get the IP address of the machine
    const interfaces = os.networkInterfaces();
    
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    
    return '127.0.0.1';
  }

  writeToAuditLog(logEntry) {
    // Write to the audit log
    if (this.config.auditLogFile) {
      const fs = require('fs');
      fs.appendFileSync(this.config.auditLogFile, JSON.stringify(logEntry) + '\n');
    }
    
    // Send to CloudWatch Logs if configured
    if (this.config.cloudWatchLogs) {
      // Use AWS SDK to send to CloudWatch Logs
      // ...
    }
  }

  getAuditLogs(startTime, endTime, filter) {
    // Get audit logs within the specified time range
    return this.logs.filter(log => {
      const timestamp = log.timestamp;
      
      if (startTime && timestamp < startTime) {
        return false;
      }
      
      if (endTime && timestamp > endTime) {
        return false;
      }
      
      if (filter) {
        // Apply additional filters
        for (const [key, value] of Object.entries(filter)) {
          if (log[key] !== value) {
            return false;
          }
        }
      }
      
      return true;
    });
  }
}
```

For more information on compliance and audit, refer to the [Compliance Guide](../compliance/index.md).
