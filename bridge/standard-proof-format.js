/**
 * Standard Proof Format for Ethereum-Solana Layer 2 Bridge
 * 
 * This module defines the standard format for proofs used in the Ethereum-Solana Layer 2 bridge.
 * It provides utilities for creating, validating, and serializing/deserializing proofs.
 * 
 * Enhanced with quantum-resistant signature verification for improved security.
 */

const { ethers } = require('ethers');
const { PublicKey, Transaction } = require('@solana/web3.js');
const { MerkleTree } = require('merkletreejs');
const { keccak256 } = require('js-sha3');
const { Buffer } = require('buffer');
const { QuantumResistantSignatures, SIGNATURE_TYPES } = require('./quantum-resistant-signatures');
const { KeyManager, KEY_TYPES } = require('./key-management');

/**
 * Standard Proof Format class
 */
class StandardProofFormat {
  /**
   * Create a new proof
   * @param {Object} data - Proof data
   * @param {string} data.sourceChain - Source chain ('ethereum' or 'solana')
   * @param {string} data.targetChain - Target chain ('ethereum' or 'solana')
   * @param {string} data.sourceAddress - Source address
   * @param {string} data.targetAddress - Target address
   * @param {string} data.tokenAddress - Token address
   * @param {string} data.amount - Token amount
   * @param {string} data.nonce - Transaction nonce
   * @param {string} data.timestamp - Transaction timestamp
   * @param {string} data.transactionHash - Transaction hash
   * @param {Array} data.signatures - Array of signatures
   * @param {Array} data.merkleProof - Merkle proof (optional)
   * @param {string} data.merkleRoot - Merkle root (optional)
   * @returns {Object} Proof object
   */
  static createProof(data) {
    // Validate required fields
    this.validateProofData(data);
    
    // Create proof object
    const proof = {
      version: '1.0',
      sourceChain: data.sourceChain,
      targetChain: data.targetChain,
      sourceAddress: data.sourceAddress,
      targetAddress: data.targetAddress,
      tokenAddress: data.tokenAddress,
      amount: data.amount,
      nonce: data.nonce,
      timestamp: data.timestamp,
      transactionHash: data.transactionHash,
      signatures: data.signatures || [],
      merkleProof: data.merkleProof || [],
      merkleRoot: data.merkleRoot || '',
      status: 'pending'
    };
    
    // Generate proof hash
    proof.hash = this.hashProof(proof);
    
    return proof;
  }
  
  /**
   * Validate proof data
   * @param {Object} data - Proof data
   * @throws {Error} If data is invalid
   */
  static validateProofData(data) {
    // Check required fields
    const requiredFields = [
      'sourceChain', 'targetChain', 'sourceAddress', 
      'targetAddress', 'tokenAddress', 'amount', 
      'nonce', 'timestamp', 'transactionHash'
    ];
    
    for (const field of requiredFields) {
      if (!data[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    // Validate chain values
    if (data.sourceChain !== 'ethereum' && data.sourceChain !== 'solana') {
      throw new Error('sourceChain must be "ethereum" or "solana"');
    }
    
    if (data.targetChain !== 'ethereum' && data.targetChain !== 'solana') {
      throw new Error('targetChain must be "ethereum" or "solana"');
    }
    
    if (data.sourceChain === data.targetChain) {
      throw new Error('sourceChain and targetChain must be different');
    }
    
    // Validate addresses based on chain
    if (data.sourceChain === 'ethereum') {
      if (!ethers.utils.isAddress(data.sourceAddress)) {
        throw new Error('Invalid Ethereum source address');
      }
    } else {
      try {
        new PublicKey(data.sourceAddress);
      } catch (error) {
        throw new Error('Invalid Solana source address');
      }
    }
    
    if (data.targetChain === 'ethereum') {
      if (!ethers.utils.isAddress(data.targetAddress)) {
        throw new Error('Invalid Ethereum target address');
      }
    } else {
      try {
        new PublicKey(data.targetAddress);
      } catch (error) {
        throw new Error('Invalid Solana target address');
      }
    }
    
    // Validate token address
    if (data.sourceChain === 'ethereum') {
      if (!ethers.utils.isAddress(data.tokenAddress)) {
        throw new Error('Invalid Ethereum token address');
      }
    } else {
      try {
        new PublicKey(data.tokenAddress);
      } catch (error) {
        throw new Error('Invalid Solana token address');
      }
    }
    
    // Validate amount (must be a valid number string)
    if (!/^\d+$/.test(data.amount)) {
      throw new Error('Amount must be a valid number string');
    }
    
    // Validate nonce (must be a valid number string)
    if (!/^\d+$/.test(data.nonce)) {
      throw new Error('Nonce must be a valid number string');
    }
    
    // Validate timestamp (must be a valid number string)
    if (!/^\d+$/.test(data.timestamp)) {
      throw new Error('Timestamp must be a valid number string');
    }
    
    // Validate transaction hash
    if (!/^0x[a-fA-F0-9]{64}$/.test(data.transactionHash)) {
      throw new Error('Transaction hash must be a valid hex string with 0x prefix');
    }
  }
  
  /**
   * Hash a proof
   * @param {Object} proof - Proof object
   * @returns {string} Proof hash
   */
  static hashProof(proof) {
    // Create hash of the proof data
    const hashData = ethers.utils.solidityPack(
      ['string', 'string', 'string', 'string', 'string', 'uint256', 'uint256', 'uint256', 'bytes32'],
      [
        proof.sourceChain,
        proof.targetChain,
        proof.sourceAddress,
        proof.targetAddress,
        proof.tokenAddress,
        proof.amount,
        proof.nonce,
        proof.timestamp,
        proof.transactionHash
      ]
    );
    
    return ethers.utils.keccak256(hashData);
  }
  
  /**
   * Verify a proof
   * @param {Object} proof - Proof object
   * @returns {boolean} True if proof is valid
   */
  static verifyProof(proof) {
    try {
      // Validate proof structure
      this.validateProofData(proof);
      
      // Verify hash
      const calculatedHash = this.hashProof(proof);
      if (proof.hash !== calculatedHash) {
        return false;
      }
      
      // If merkle proof is provided, verify it
      if (proof.merkleProof && proof.merkleProof.length > 0 && proof.merkleRoot) {
        return this.verifyMerkleProof(proof.hash, proof.merkleProof, proof.merkleRoot);
      }
      
      return true;
    } catch (error) {
      console.error('Proof verification failed:', error.message);
      return false;
    }
  }
  
  /**
   * Verify a Merkle proof
   * @param {string} leafHash - Leaf hash
   * @param {Array} proof - Merkle proof
   * @param {string} root - Merkle root
   * @returns {boolean} True if proof is valid
   */
  static verifyMerkleProof(leafHash, proof, root) {
    let currentHash = leafHash;
    
    for (const proofElement of proof) {
      if (currentHash < proofElement) {
        currentHash = ethers.utils.keccak256(
          ethers.utils.concat([currentHash, proofElement])
        );
      } else {
        currentHash = ethers.utils.keccak256(
          ethers.utils.concat([proofElement, currentHash])
        );
      }
    }
    
    return currentHash === root;
  }
  
  /**
   * Create a Merkle tree from an array of proofs
   * @param {Array} proofs - Array of proof objects
   * @returns {Object} Merkle tree object with root and proofs
   */
  static createMerkleTree(proofs) {
    // Extract proof hashes
    const leaves = proofs.map(proof => proof.hash);
    
    // Create Merkle tree
    const tree = new MerkleTree(leaves, keccak256, { sort: true });
    const root = '0x' + tree.getRoot().toString('hex');
    
    // Generate proofs for each leaf
    const merkleProofs = {};
    for (let i = 0; i < leaves.length; i++) {
      const proof = tree.getProof(leaves[i]).map(x => '0x' + x.data.toString('hex'));
      merkleProofs[leaves[i]] = proof;
    }
    
    return {
      root,
      proofs: merkleProofs
    };
  }
  
  /**
   * Add a Merkle proof to a proof object
   * @param {Object} proof - Proof object
   * @param {Array} merkleProof - Merkle proof
   * @param {string} merkleRoot - Merkle root
   * @returns {Object} Updated proof object
   */
  static addMerkleProof(proof, merkleProof, merkleRoot) {
    proof.merkleProof = merkleProof;
    proof.merkleRoot = merkleRoot;
    return proof;
  }
  
  /**
   * Add a signature to a proof
   * @param {Object} proof - Proof object
   * @param {Object} signatureObj - Signature object (can be ECDSA or quantum-resistant)
   * @returns {Object} Updated proof object
   */
  static addSignature(proof, signatureObj) {
    if (!proof.signatures) {
      proof.signatures = [];
    }
    
    if (signatureObj.type !== undefined) {
      // This is a quantum-resistant signature
      
      // For ECDSA and hybrid signatures, check if signer already signed
      if (signatureObj.type === SIGNATURE_TYPES.ECDSA) {
        const existingSignature = proof.signatures.find(
          sig => sig.signer === signatureObj.signer
        );
        
        if (existingSignature) {
          throw new Error(`Signer ${signatureObj.signer} already signed this proof`);
        }
      } else if (signatureObj.type === SIGNATURE_TYPES.HYBRID_FALCON || 
                signatureObj.type === SIGNATURE_TYPES.HYBRID_DILITHIUM) {
        const existingSignature = proof.signatures.find(
          sig => sig.ecdsaSigner === signatureObj.ecdsaSigner
        );
        
        if (existingSignature) {
          throw new Error(`Signer ${signatureObj.ecdsaSigner} already signed this proof`);
        }
      } else {
        const existingSignature = proof.signatures.find(sig => {
          if (signatureObj.type === SIGNATURE_TYPES.FALCON && sig.falconPublicKey) {
            return sig.falconPublicKey === signatureObj.falconPublicKey;
          } else if (signatureObj.type === SIGNATURE_TYPES.DILITHIUM && sig.dilithiumPublicKey) {
            return sig.dilithiumPublicKey === signatureObj.dilithiumPublicKey;
          }
          return false;
        });
        
        if (existingSignature) {
          throw new Error('This public key has already signed this proof');
        }
      }
      
      // Add the quantum-resistant signature
      proof.signatures.push(signatureObj);
    } else {
      const signature = signatureObj.signature || signatureObj;
      const signer = signatureObj.signer;
      
      if (!signer) {
        throw new Error('Signer address is required for legacy signatures');
      }
      
      // Check if signer already signed
      const existingSignature = proof.signatures.find(sig => sig.signer === signer);
      if (existingSignature) {
        throw new Error(`Signer ${signer} already signed this proof`);
      }
      
      proof.signatures.push({
        signature,
        signer
      });
    }
    
    return proof;
  }
  
  /**
   * Verify signatures on a proof
   * @param {Object} proof - Proof object
   * @param {Array} validSigners - Array of valid signer addresses
   * @param {number} threshold - Minimum number of valid signatures required
   * @returns {boolean} True if signatures are valid
   */
  static verifySignatures(proof, validSigners, threshold) {
    if (!proof.signatures || proof.signatures.length < threshold) {
      return false;
    }
    
    let validCount = 0;
    
    for (const sig of proof.signatures) {
      // Check if signer is valid
      if (!validSigners.includes(sig.signer)) {
        continue;
      }
      
      // Verify signature based on type
      try {
        // Check if this is a quantum-resistant signature
        if (sig.signatureType !== undefined) {
          const isValid = QuantumResistantSignatures.verify(
            ethers.utils.arrayify(proof.hash),
            sig
          );
          
          if (isValid) {
            validCount++;
          }
        } else {
          const recoveredAddress = ethers.utils.verifyMessage(
            ethers.utils.arrayify(proof.hash),
            sig.signature
          );
          
          if (recoveredAddress.toLowerCase() === sig.signer.toLowerCase()) {
            validCount++;
          }
        }
      } catch (error) {
        console.error('Signature verification failed:', error.message);
      }
      
      // If we have enough valid signatures, return early
      if (validCount >= threshold) {
        return true;
      }
    }
    
    return validCount >= threshold;
  }
  
  /**
   * Serialize a proof to JSON
   * @param {Object} proof - Proof object
   * @returns {string} JSON string
   */
  static serializeProof(proof) {
    return JSON.stringify(proof);
  }
  
  /**
   * Deserialize a proof from JSON
   * @param {string} json - JSON string
   * @returns {Object} Proof object
   */
  static deserializeProof(json) {
    return JSON.parse(json);
  }
  
  /**
   * Convert a proof to a format compatible with Ethereum contracts
   * @param {Object} proof - Proof object
   * @returns {Object} Ethereum-compatible proof
   */
  static toEthereumFormat(proof) {
    // Extract signatures
    const signatures = proof.signatures.map(sig => sig.signature);
    
    // Create Ethereum-compatible proof
    return {
      sourceChain: proof.sourceChain === 'ethereum' ? 0 : 1, // 0 = Ethereum, 1 = Solana
      sourceAddress: proof.sourceAddress,
      targetAddress: proof.targetAddress,
      tokenAddress: proof.tokenAddress,
      amount: ethers.BigNumber.from(proof.amount),
      nonce: ethers.BigNumber.from(proof.nonce),
      timestamp: ethers.BigNumber.from(proof.timestamp),
      transactionHash: proof.transactionHash,
      signatures,
      merkleProof: proof.merkleProof || [],
      merkleRoot: proof.merkleRoot || ethers.constants.HashZero
    };
  }
  
  /**
   * Convert a proof to a format compatible with Solana programs
   * @param {Object} proof - Proof object
   * @returns {Object} Solana-compatible proof
   */
  static toSolanaFormat(proof) {
    // Extract signatures
    const signatures = proof.signatures.map(sig => ({
      signature: Buffer.from(sig.signature.slice(2), 'hex'),
      signer: Buffer.from(sig.signer.slice(2), 'hex')
    }));
    
    // Create Solana-compatible proof
    return {
      sourceChain: proof.sourceChain === 'ethereum' ? 0 : 1, // 0 = Ethereum, 1 = Solana
      sourceAddress: proof.sourceChain === 'ethereum' 
        ? Buffer.from(proof.sourceAddress.slice(2), 'hex')
        : new PublicKey(proof.sourceAddress).toBuffer(),
      targetAddress: proof.targetChain === 'ethereum'
        ? Buffer.from(proof.targetAddress.slice(2), 'hex')
        : new PublicKey(proof.targetAddress).toBuffer(),
      tokenAddress: proof.sourceChain === 'ethereum'
        ? Buffer.from(proof.tokenAddress.slice(2), 'hex')
        : new PublicKey(proof.tokenAddress).toBuffer(),
      amount: Buffer.from(ethers.BigNumber.from(proof.amount).toHexString().slice(2).padStart(64, '0'), 'hex'),
      nonce: Buffer.from(ethers.BigNumber.from(proof.nonce).toHexString().slice(2).padStart(16, '0'), 'hex'),
      timestamp: Buffer.from(ethers.BigNumber.from(proof.timestamp).toHexString().slice(2).padStart(16, '0'), 'hex'),
      transactionHash: Buffer.from(proof.transactionHash.slice(2), 'hex'),
      signatures,
      merkleProof: (proof.merkleProof || []).map(p => Buffer.from(p.slice(2), 'hex')),
      merkleRoot: proof.merkleRoot ? Buffer.from(proof.merkleRoot.slice(2), 'hex') : Buffer.alloc(32)
    };
  }
  
  /**
   * Update proof status
   * @param {Object} proof - Proof object
   * @param {string} status - New status ('pending', 'confirmed', 'rejected', 'finalized')
   * @returns {Object} Updated proof object
   */
  static updateStatus(proof, status) {
    const validStatuses = ['pending', 'confirmed', 'rejected', 'finalized'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
    }
    
    proof.status = status;
    return proof;
  }
}

module.exports = StandardProofFormat;
