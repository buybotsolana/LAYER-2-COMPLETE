/**
 * Quantum-Resistant Signature Module for Ethereum-Solana Layer 2 Bridge
 * 
 * This module implements post-quantum cryptographic signature schemes to protect
 * the bridge against quantum computing attacks. It uses a hybrid approach with
 * both classical ECDSA and post-quantum algorithms for backward compatibility.
 */

const { ethers } = require('ethers');
const crypto = require('crypto');
const { Buffer } = require('buffer');
const nacl = require('tweetnacl');
const falcon = require('falcon-crypto'); // Falcon signature scheme (NIST PQC finalist)
const dilithium = require('dilithium-crystals'); // Dilithium signature scheme (NIST PQC standard)

const SIGNATURE_TYPES = {
  ECDSA: 0,
  FALCON: 1,
  DILITHIUM: 2,
  HYBRID_FALCON: 3,
  HYBRID_DILITHIUM: 4
};

/**
 * Quantum-Resistant Signature class
 */
class QuantumResistantSignatures {
  /**
   * Generate a new key pair
   * @param {number} type - Signature type (from SIGNATURE_TYPES)
   * @returns {Object} Key pair object
   */
  static generateKeyPair(type = SIGNATURE_TYPES.HYBRID_FALCON) {
    switch (type) {
      case SIGNATURE_TYPES.ECDSA:
        const wallet = ethers.Wallet.createRandom();
        return {
          type: SIGNATURE_TYPES.ECDSA,
          publicKey: wallet.publicKey,
          privateKey: wallet.privateKey,
          address: wallet.address
        };
        
      case SIGNATURE_TYPES.FALCON:
        const falconKeyPair = falcon.keyPair();
        return {
          type: SIGNATURE_TYPES.FALCON,
          publicKey: Buffer.from(falconKeyPair.publicKey).toString('hex'),
          privateKey: Buffer.from(falconKeyPair.secretKey).toString('hex')
        };
        
      case SIGNATURE_TYPES.DILITHIUM:
        const dilithiumKeyPair = dilithium.keyPair();
        return {
          type: SIGNATURE_TYPES.DILITHIUM,
          publicKey: Buffer.from(dilithiumKeyPair.publicKey).toString('hex'),
          privateKey: Buffer.from(dilithiumKeyPair.secretKey).toString('hex')
        };
        
      case SIGNATURE_TYPES.HYBRID_FALCON:
        const ecdsaWallet = ethers.Wallet.createRandom();
        const hybridFalconKeyPair = falcon.keyPair();
        
        return {
          type: SIGNATURE_TYPES.HYBRID_FALCON,
          ecdsaPublicKey: ecdsaWallet.publicKey,
          ecdsaPrivateKey: ecdsaWallet.privateKey,
          ecdsaAddress: ecdsaWallet.address,
          falconPublicKey: Buffer.from(hybridFalconKeyPair.publicKey).toString('hex'),
          falconPrivateKey: Buffer.from(hybridFalconKeyPair.secretKey).toString('hex')
        };
        
      case SIGNATURE_TYPES.HYBRID_DILITHIUM:
        const ecdsaWallet2 = ethers.Wallet.createRandom();
        const hybridDilithiumKeyPair = dilithium.keyPair();
        
        return {
          type: SIGNATURE_TYPES.HYBRID_DILITHIUM,
          ecdsaPublicKey: ecdsaWallet2.publicKey,
          ecdsaPrivateKey: ecdsaWallet2.privateKey,
          ecdsaAddress: ecdsaWallet2.address,
          dilithiumPublicKey: Buffer.from(hybridDilithiumKeyPair.publicKey).toString('hex'),
          dilithiumPrivateKey: Buffer.from(hybridDilithiumKeyPair.secretKey).toString('hex')
        };
        
      default:
        throw new Error(`Unsupported signature type: ${type}`);
    }
  }
  
  /**
   * Sign a message using the specified key pair
   * @param {string} message - Message to sign
   * @param {Object} keyPair - Key pair object
   * @returns {Object} Signature object
   */
  static sign(message, keyPair) {
    const messageBuffer = Buffer.from(ethers.utils.arrayify(ethers.utils.keccak256(message)));
    
    switch (keyPair.type) {
      case SIGNATURE_TYPES.ECDSA:
        const wallet = new ethers.Wallet(keyPair.privateKey);
        const signature = wallet.signMessage(messageBuffer);
        
        return {
          type: SIGNATURE_TYPES.ECDSA,
          signature,
          signer: wallet.address
        };
        
      case SIGNATURE_TYPES.FALCON:
        const falconSignature = falcon.sign(
          messageBuffer,
          Buffer.from(keyPair.privateKey, 'hex')
        );
        
        return {
          type: SIGNATURE_TYPES.FALCON,
          signature: Buffer.from(falconSignature).toString('hex'),
          publicKey: keyPair.publicKey
        };
        
      case SIGNATURE_TYPES.DILITHIUM:
        const dilithiumSignature = dilithium.sign(
          messageBuffer,
          Buffer.from(keyPair.privateKey, 'hex')
        );
        
        return {
          type: SIGNATURE_TYPES.DILITHIUM,
          signature: Buffer.from(dilithiumSignature).toString('hex'),
          publicKey: keyPair.publicKey
        };
        
      case SIGNATURE_TYPES.HYBRID_FALCON:
        const hybridWallet = new ethers.Wallet(keyPair.ecdsaPrivateKey);
        const ecdsaSignature = hybridWallet.signMessage(messageBuffer);
        
        const falconSig = falcon.sign(
          messageBuffer,
          Buffer.from(keyPair.falconPrivateKey, 'hex')
        );
        
        return {
          type: SIGNATURE_TYPES.HYBRID_FALCON,
          ecdsaSignature,
          ecdsaSigner: hybridWallet.address,
          falconSignature: Buffer.from(falconSig).toString('hex'),
          falconPublicKey: keyPair.falconPublicKey
        };
        
      case SIGNATURE_TYPES.HYBRID_DILITHIUM:
        const hybridWallet2 = new ethers.Wallet(keyPair.ecdsaPrivateKey);
        const ecdsaSignature2 = hybridWallet2.signMessage(messageBuffer);
        
        const dilithiumSig = dilithium.sign(
          messageBuffer,
          Buffer.from(keyPair.dilithiumPrivateKey, 'hex')
        );
        
        return {
          type: SIGNATURE_TYPES.HYBRID_DILITHIUM,
          ecdsaSignature: ecdsaSignature2,
          ecdsaSigner: hybridWallet2.address,
          dilithiumSignature: Buffer.from(dilithiumSig).toString('hex'),
          dilithiumPublicKey: keyPair.dilithiumPublicKey
        };
        
      default:
        throw new Error(`Unsupported signature type: ${keyPair.type}`);
    }
  }
  
  /**
   * Verify a signature
   * @param {string} message - Original message
   * @param {Object} signatureObj - Signature object
   * @returns {boolean} True if signature is valid
   */
  static verify(message, signatureObj) {
    const messageBuffer = Buffer.from(ethers.utils.arrayify(ethers.utils.keccak256(message)));
    
    switch (signatureObj.type) {
      case SIGNATURE_TYPES.ECDSA:
        try {
          const recoveredAddress = ethers.utils.verifyMessage(
            messageBuffer,
            signatureObj.signature
          );
          
          return recoveredAddress.toLowerCase() === signatureObj.signer.toLowerCase();
        } catch (error) {
          console.error('ECDSA signature verification failed:', error.message);
          return false;
        }
        
      case SIGNATURE_TYPES.FALCON:
        try {
          return falcon.verify(
            messageBuffer,
            Buffer.from(signatureObj.signature, 'hex'),
            Buffer.from(signatureObj.publicKey, 'hex')
          );
        } catch (error) {
          console.error('Falcon signature verification failed:', error.message);
          return false;
        }
        
      case SIGNATURE_TYPES.DILITHIUM:
        try {
          return dilithium.verify(
            messageBuffer,
            Buffer.from(signatureObj.signature, 'hex'),
            Buffer.from(signatureObj.publicKey, 'hex')
          );
        } catch (error) {
          console.error('Dilithium signature verification failed:', error.message);
          return false;
        }
        
      case SIGNATURE_TYPES.HYBRID_FALCON:
        try {
          const recoveredAddress = ethers.utils.verifyMessage(
            messageBuffer,
            signatureObj.ecdsaSignature
          );
          
          const ecdsaValid = recoveredAddress.toLowerCase() === signatureObj.ecdsaSigner.toLowerCase();
          
          const falconValid = falcon.verify(
            messageBuffer,
            Buffer.from(signatureObj.falconSignature, 'hex'),
            Buffer.from(signatureObj.falconPublicKey, 'hex')
          );
          
          return ecdsaValid && falconValid;
        } catch (error) {
          console.error('Hybrid Falcon signature verification failed:', error.message);
          return false;
        }
        
      case SIGNATURE_TYPES.HYBRID_DILITHIUM:
        try {
          const recoveredAddress = ethers.utils.verifyMessage(
            messageBuffer,
            signatureObj.ecdsaSignature
          );
          
          const ecdsaValid = recoveredAddress.toLowerCase() === signatureObj.ecdsaSigner.toLowerCase();
          
          const dilithiumValid = dilithium.verify(
            messageBuffer,
            Buffer.from(signatureObj.dilithiumSignature, 'hex'),
            Buffer.from(signatureObj.dilithiumPublicKey, 'hex')
          );
          
          return ecdsaValid && dilithiumValid;
        } catch (error) {
          console.error('Hybrid Dilithium signature verification failed:', error.message);
          return false;
        }
        
      default:
        throw new Error(`Unsupported signature type: ${signatureObj.type}`);
    }
  }
  
  /**
   * Serialize a signature object to JSON
   * @param {Object} signatureObj - Signature object
   * @returns {string} JSON string
   */
  static serializeSignature(signatureObj) {
    return JSON.stringify(signatureObj);
  }
  
  /**
   * Deserialize a signature object from JSON
   * @param {string} json - JSON string
   * @returns {Object} Signature object
   */
  static deserializeSignature(json) {
    return JSON.parse(json);
  }
  
  /**
   * Convert a signature to a format compatible with Ethereum contracts
   * @param {Object} signatureObj - Signature object
   * @returns {Object} Ethereum-compatible signature
   */
  static toEthereumFormat(signatureObj) {
    switch (signatureObj.type) {
      case SIGNATURE_TYPES.ECDSA:
        return {
          signatureType: signatureObj.type,
          signature: signatureObj.signature,
          signer: signatureObj.signer
        };
        
      case SIGNATURE_TYPES.FALCON:
      case SIGNATURE_TYPES.DILITHIUM:
        return {
          signatureType: signatureObj.type,
          signature: '0x' + signatureObj.signature,
          publicKey: '0x' + signatureObj.publicKey
        };
        
      case SIGNATURE_TYPES.HYBRID_FALCON:
        return {
          signatureType: signatureObj.type,
          ecdsaSignature: signatureObj.ecdsaSignature,
          ecdsaSigner: signatureObj.ecdsaSigner,
          falconSignature: '0x' + signatureObj.falconSignature,
          falconPublicKey: '0x' + signatureObj.falconPublicKey
        };
        
      case SIGNATURE_TYPES.HYBRID_DILITHIUM:
        return {
          signatureType: signatureObj.type,
          ecdsaSignature: signatureObj.ecdsaSignature,
          ecdsaSigner: signatureObj.ecdsaSigner,
          dilithiumSignature: '0x' + signatureObj.dilithiumSignature,
          dilithiumPublicKey: '0x' + signatureObj.dilithiumPublicKey
        };
        
      default:
        throw new Error(`Unsupported signature type: ${signatureObj.type}`);
    }
  }
  
  /**
   * Convert a signature to a format compatible with Solana programs
   * @param {Object} signatureObj - Signature object
   * @returns {Object} Solana-compatible signature
   */
  static toSolanaFormat(signatureObj) {
    switch (signatureObj.type) {
      case SIGNATURE_TYPES.ECDSA:
        return {
          signatureType: signatureObj.type,
          signature: Buffer.from(signatureObj.signature.slice(2), 'hex'),
          signer: Buffer.from(signatureObj.signer.slice(2), 'hex')
        };
        
      case SIGNATURE_TYPES.FALCON:
      case SIGNATURE_TYPES.DILITHIUM:
        return {
          signatureType: signatureObj.type,
          signature: Buffer.from(signatureObj.signature, 'hex'),
          publicKey: Buffer.from(signatureObj.publicKey, 'hex')
        };
        
      case SIGNATURE_TYPES.HYBRID_FALCON:
        return {
          signatureType: signatureObj.type,
          ecdsaSignature: Buffer.from(signatureObj.ecdsaSignature.slice(2), 'hex'),
          ecdsaSigner: Buffer.from(signatureObj.ecdsaSigner.slice(2), 'hex'),
          falconSignature: Buffer.from(signatureObj.falconSignature, 'hex'),
          falconPublicKey: Buffer.from(signatureObj.falconPublicKey, 'hex')
        };
        
      case SIGNATURE_TYPES.HYBRID_DILITHIUM:
        return {
          signatureType: signatureObj.type,
          ecdsaSignature: Buffer.from(signatureObj.ecdsaSignature.slice(2), 'hex'),
          ecdsaSigner: Buffer.from(signatureObj.ecdsaSigner.slice(2), 'hex'),
          dilithiumSignature: Buffer.from(signatureObj.dilithiumSignature, 'hex'),
          dilithiumPublicKey: Buffer.from(signatureObj.dilithiumPublicKey, 'hex')
        };
        
      default:
        throw new Error(`Unsupported signature type: ${signatureObj.type}`);
    }
  }
}

module.exports = {
  SIGNATURE_TYPES,
  QuantumResistantSignatures
};
