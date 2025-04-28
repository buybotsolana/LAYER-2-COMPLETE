/**
 * Key Management Module for Ethereum-Solana Layer 2 Bridge
 * 
 * This module implements secure key management with key rotation and encryption at rest.
 * It provides utilities for generating, storing, rotating, and securely accessing keys.
 */

const { ethers } = require('ethers');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { QuantumResistantSignatures, SIGNATURE_TYPES } = require('./quantum-resistant-signatures');

const KEY_TYPES = {
  RELAYER: 'relayer',
  SEQUENCER: 'sequencer',
  VALIDATOR: 'validator',
  ADMIN: 'admin'
};

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const KEY_ROTATION_INTERVAL = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

/**
 * Key Management class
 */
class KeyManager {
  constructor(options = {}) {
    this.options = {
      keyStorePath: options.keyStorePath || path.join(process.env.HOME, '.layer2-keys'),
      encryptionKey: options.encryptionKey || process.env.LAYER2_ENCRYPTION_KEY,
      rotationInterval: options.rotationInterval || KEY_ROTATION_INTERVAL,
      signatureType: options.signatureType || SIGNATURE_TYPES.HYBRID_FALCON,
      ...options
    };
    
    if (!this.options.encryptionKey) {
      throw new Error('Encryption key is required. Set LAYER2_ENCRYPTION_KEY environment variable or provide in options.');
    }
    
    if (!fs.existsSync(this.options.keyStorePath)) {
      fs.mkdirSync(this.options.keyStorePath, { recursive: true, mode: 0o700 });
    }
    
    this.setupRotationCheck();
  }
  
  /**
   * Set up periodic check for key rotation
   */
  setupRotationCheck() {
    setInterval(() => {
      this.checkAndRotateKeys();
    }, 24 * 60 * 60 * 1000); // 24 hours
    
    this.checkAndRotateKeys();
  }
  
  /**
   * Check and rotate keys that have exceeded the rotation interval
   */
  checkAndRotateKeys() {
    try {
      const keyFiles = fs.readdirSync(this.options.keyStorePath);
      
      for (const file of keyFiles) {
        if (file.endsWith('.key')) {
          const keyPath = path.join(this.options.keyStorePath, file);
          const stats = fs.statSync(keyPath);
          const keyAge = Date.now() - stats.mtime.getTime();
          
          if (keyAge > this.options.rotationInterval) {
            const keyInfo = this.parseKeyFilename(file);
            console.log(`Rotating key: ${keyInfo.id} (${keyInfo.type})`);
            this.rotateKey(keyInfo.id, keyInfo.type);
          }
        }
      }
    } catch (error) {
      console.error('Error checking for key rotation:', error);
    }
  }
  
  /**
   * Parse key filename to extract key info
   * @param {string} filename - Key filename
   * @returns {Object} Key info object
   */
  parseKeyFilename(filename) {
    const parts = filename.replace('.key', '').split('-');
    return {
      type: parts[0],
      id: parts[1],
      timestamp: parseInt(parts[2])
    };
  }
  
  /**
   * Generate a new key
   * @param {string} keyType - Key type (from KEY_TYPES)
   * @param {string} keyId - Unique identifier for the key
   * @returns {Object} Key object
   */
  generateKey(keyType, keyId) {
    if (!Object.values(KEY_TYPES).includes(keyType)) {
      throw new Error(`Invalid key type: ${keyType}`);
    }
    
    if (!keyId) {
      keyId = crypto.randomBytes(8).toString('hex');
    }
    
    const keyPair = QuantumResistantSignatures.generateKeyPair(this.options.signatureType);
    
    const keyObject = {
      id: keyId,
      type: keyType,
      createdAt: Date.now(),
      rotationDue: Date.now() + this.options.rotationInterval,
      signatureType: this.options.signatureType,
      ...keyPair
    };
    
    this.storeKey(keyObject);
    
    return keyObject;
  }
  
  /**
   * Store a key securely
   * @param {Object} keyObject - Key object
   */
  storeKey(keyObject) {
    const keyToStore = JSON.parse(JSON.stringify(keyObject));
    
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(
      ENCRYPTION_ALGORITHM,
      Buffer.from(this.options.encryptionKey, 'hex'),
      iv
    );
    
    const aad = Buffer.from(`${keyToStore.type}-${keyToStore.id}`);
    cipher.setAAD(aad);
    
    const keyData = JSON.stringify(keyToStore);
    let encrypted = cipher.update(keyData, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    const encryptedKey = {
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      data: encrypted
    };
    
    const filename = `${keyToStore.type}-${keyToStore.id}-${keyToStore.createdAt}.key`;
    const keyPath = path.join(this.options.keyStorePath, filename);
    
    fs.writeFileSync(keyPath, JSON.stringify(encryptedKey), { mode: 0o600 });
    
    return keyPath;
  }
  
  /**
   * Load a key securely
   * @param {string} keyId - Key ID
   * @param {string} keyType - Key type
   * @returns {Object} Key object
   */
  loadKey(keyId, keyType) {
    const keyFiles = fs.readdirSync(this.options.keyStorePath);
    const keyFile = keyFiles.find(file => 
      file.startsWith(`${keyType}-${keyId}-`) && file.endsWith('.key')
    );
    
    if (!keyFile) {
      throw new Error(`Key not found: ${keyType}-${keyId}`);
    }
    
    const keyPath = path.join(this.options.keyStorePath, keyFile);
    const encryptedKey = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      Buffer.from(this.options.encryptionKey, 'hex'),
      Buffer.from(encryptedKey.iv, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(encryptedKey.authTag, 'hex'));
    
    const aad = Buffer.from(`${keyType}-${keyId}`);
    decipher.setAAD(aad);
    
    let decrypted = decipher.update(encryptedKey.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  }
  
  /**
   * Rotate a key
   * @param {string} keyId - Key ID
   * @param {string} keyType - Key type
   * @returns {Object} New key object
   */
  rotateKey(keyId, keyType) {
    const oldKey = this.loadKey(keyId, keyType);
    
    const newKey = this.generateKey(keyType, keyId);
    
    this.archiveKey(keyId, keyType);
    
    return newKey;
  }
  
  /**
   * Archive a key
   * @param {string} keyId - Key ID
   * @param {string} keyType - Key type
   */
  archiveKey(keyId, keyType) {
    const keyFiles = fs.readdirSync(this.options.keyStorePath);
    const keyFile = keyFiles.find(file => 
      file.startsWith(`${keyType}-${keyId}-`) && file.endsWith('.key')
    );
    
    if (!keyFile) {
      throw new Error(`Key not found: ${keyType}-${keyId}`);
    }
    
    const archivePath = path.join(this.options.keyStorePath, 'archive');
    if (!fs.existsSync(archivePath)) {
      fs.mkdirSync(archivePath, { recursive: true, mode: 0o700 });
    }
    
    const oldPath = path.join(this.options.keyStorePath, keyFile);
    const newPath = path.join(archivePath, `${keyFile}.${Date.now()}.archived`);
    
    fs.renameSync(oldPath, newPath);
  }
  
  /**
   * Sign a message using a key
   * @param {string} message - Message to sign
   * @param {string} keyId - Key ID
   * @param {string} keyType - Key type
   * @returns {Object} Signature object
   */
  sign(message, keyId, keyType) {
    const key = this.loadKey(keyId, keyType);
    
    return QuantumResistantSignatures.sign(message, key);
  }
  
  /**
   * Verify a signature
   * @param {string} message - Original message
   * @param {Object} signatureObj - Signature object
   * @returns {boolean} True if signature is valid
   */
  verify(message, signatureObj) {
    return QuantumResistantSignatures.verify(message, signatureObj);
  }
  
  /**
   * List all keys
   * @param {string} keyType - Optional key type filter
   * @returns {Array} Array of key metadata objects
   */
  listKeys(keyType = null) {
    const keyFiles = fs.readdirSync(this.options.keyStorePath);
    const keys = [];
    
    for (const file of keyFiles) {
      if (file.endsWith('.key')) {
        const keyInfo = this.parseKeyFilename(file);
        
        if (!keyType || keyInfo.type === keyType) {
          try {
            const key = this.loadKey(keyInfo.id, keyInfo.type);
            keys.push({
              id: key.id,
              type: key.type,
              createdAt: key.createdAt,
              rotationDue: key.rotationDue,
              signatureType: key.signatureType
            });
          } catch (error) {
            console.error(`Error loading key ${file}:`, error);
          }
        }
      }
    }
    
    return keys;
  }
  
  /**
   * Change the encryption key (re-encrypts all keys)
   * @param {string} newEncryptionKey - New encryption key
   */
  changeEncryptionKey(newEncryptionKey) {
    if (!newEncryptionKey) {
      throw new Error('New encryption key is required');
    }
    
    const keyFiles = fs.readdirSync(this.options.keyStorePath);
    const oldEncryptionKey = this.options.encryptionKey;
    
    this.options.encryptionKey = newEncryptionKey;
    
    for (const file of keyFiles) {
      if (file.endsWith('.key')) {
        try {
          const keyInfo = this.parseKeyFilename(file);
          
          this.options.encryptionKey = oldEncryptionKey;
          
          const key = this.loadKey(keyInfo.id, keyInfo.type);
          
          this.options.encryptionKey = newEncryptionKey;
          
          this.storeKey(key);
          
        } catch (error) {
          console.error(`Error re-encrypting key ${file}:`, error);
        }
      }
    }
    
    this.options.encryptionKey = newEncryptionKey;
  }
}

module.exports = {
  KEY_TYPES,
  KeyManager
};
