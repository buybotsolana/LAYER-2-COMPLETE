// EVM Compatibility Layer for Solana Layer 2
// This module provides compatibility with Ethereum Virtual Machine (EVM)
// allowing Ethereum smart contracts to be executed on Solana Layer 2

const { ethers } = require('ethers');
const { Connection, PublicKey, Transaction, TransactionInstruction } = require('@solana/web3.js');
const { BN } = require('bn.js');
const { keccak256 } = require('js-sha3');
const { Buffer } = require('buffer');

/**
 * EVM Compatibility Layer for Solana Layer 2
 * 
 * This class provides a compatibility layer that allows Ethereum smart contracts
 * to be executed on Solana Layer 2. It translates EVM bytecode and transactions
 * to Solana instructions and handles state mapping between the two environments.
 */
class EVMCompatibilityLayer {
  /**
   * Constructor
   * @param {Object} config - Configuration object
   * @param {string} config.solanaRpcUrl - Solana RPC URL
   * @param {string} config.programId - Solana program ID for the Layer 2
   * @param {string} config.evmStateAccount - Public key of the EVM state account
   * @param {Object} config.adapters - EVM adapters configuration
   */
  constructor(config) {
    this.config = config;
    this.connection = new Connection(config.solanaRpcUrl);
    this.programId = new PublicKey(config.programId);
    this.evmStateAccount = new PublicKey(config.evmStateAccount);
    this.adapters = {};
    
    // Initialize adapters
    if (config.adapters) {
      if (config.adapters.neonEVM) {
        this.adapters.neonEVM = require('./adapters/neon-evm-adapter')(config.adapters.neonEVM);
      }
      
      if (config.adapters.eclipseEVM) {
        this.adapters.eclipseEVM = require('./adapters/eclipse-evm-adapter')(config.adapters.eclipseEVM);
      }
    }
    
    // Default to Neon EVM if available
    this.activeAdapter = this.adapters.neonEVM || this.adapters.eclipseEVM;
    
    if (!this.activeAdapter) {
      throw new Error('No EVM adapter configured');
    }
  }
  
  /**
   * Set the active EVM adapter
   * @param {string} adapterName - Name of the adapter to use
   */
  setActiveAdapter(adapterName) {
    if (!this.adapters[adapterName]) {
      throw new Error(`Adapter ${adapterName} not found`);
    }
    
    this.activeAdapter = this.adapters[adapterName];
  }
  
  /**
   * Deploy an Ethereum contract on Solana Layer 2
   * @param {string} bytecode - EVM bytecode of the contract
   * @param {Array} constructorArgs - Constructor arguments
   * @param {Object} wallet - Solana wallet for signing
   * @param {Object} options - Deployment options
   * @returns {Object} Deployment result with contract address
   */
  async deployContract(bytecode, constructorArgs, wallet, options = {}) {
    try {
      // Encode constructor arguments if provided
      let deployData = bytecode;
      if (constructorArgs && constructorArgs.length > 0) {
        const abiCoder = new ethers.utils.AbiCoder();
        const encodedArgs = abiCoder.encode(
          options.constructorTypes || [],
          constructorArgs
        ).slice(2); // Remove '0x' prefix
        
        deployData = bytecode + encodedArgs;
      }
      
      // Calculate the Ethereum contract address
      const ethAddress = this._calculateContractAddress(wallet.publicKey.toString(), options.nonce || 0);
      
      // Prepare Solana transaction for contract deployment
      const deploymentIx = await this._createDeploymentInstruction(
        deployData,
        ethAddress,
        wallet.publicKey,
        options
      );
      
      // Create and sign transaction
      const transaction = new Transaction().add(deploymentIx);
      transaction.feePayer = wallet.publicKey;
      transaction.recentBlockhash = (await this.connection.getRecentBlockhash()).blockhash;
      
      // Sign and send transaction
      const signedTx = await wallet.signTransaction(transaction);
      const signature = await this.connection.sendRawTransaction(signedTx.serialize());
      
      // Wait for confirmation
      await this.connection.confirmTransaction(signature);
      
      return {
        contractAddress: ethAddress,
        transactionHash: signature,
        solanaAddress: this._getContractAccountAddress(ethAddress)
      };
    } catch (error) {
      throw new Error(`Contract deployment failed: ${error.message}`);
    }
  }
  
  /**
   * Call a contract method (read-only)
   * @param {string} contractAddress - Ethereum contract address
   * @param {string} methodName - Method name
   * @param {Array} methodParams - Method parameters
   * @param {Array} methodTypes - Method parameter types
   * @param {string} returnType - Return type
   * @returns {any} Method result
   */
  async callContractMethod(contractAddress, methodName, methodParams, methodTypes, returnType) {
    try {
      // Calculate method signature
      const methodSignature = `${methodName}(${methodTypes.join(',')})`;
      const methodId = '0x' + keccak256(methodSignature).slice(0, 8);
      
      // Encode parameters
      const abiCoder = new ethers.utils.AbiCoder();
      const encodedParams = methodParams.length > 0
        ? abiCoder.encode(methodTypes, methodParams).slice(2) // Remove '0x' prefix
        : '';
      
      // Create call data
      const callData = methodId + encodedParams;
      
      // Get contract account
      const contractAccount = this._getContractAccountAddress(contractAddress);
      
      // Use adapter to make the call
      const result = await this.activeAdapter.callContract(
        this.connection,
        this.programId,
        contractAccount,
        callData,
        returnType
      );
      
      return result;
    } catch (error) {
      throw new Error(`Contract call failed: ${error.message}`);
    }
  }
  
  /**
   * Execute a contract method (state-changing)
   * @param {string} contractAddress - Ethereum contract address
   * @param {string} methodName - Method name
   * @param {Array} methodParams - Method parameters
   * @param {Array} methodTypes - Method parameter types
   * @param {Object} wallet - Solana wallet for signing
   * @param {Object} options - Transaction options
   * @returns {Object} Transaction result
   */
  async executeContractMethod(contractAddress, methodName, methodParams, methodTypes, wallet, options = {}) {
    try {
      // Calculate method signature
      const methodSignature = `${methodName}(${methodTypes.join(',')})`;
      const methodId = '0x' + keccak256(methodSignature).slice(0, 8);
      
      // Encode parameters
      const abiCoder = new ethers.utils.AbiCoder();
      const encodedParams = methodParams.length > 0
        ? abiCoder.encode(methodTypes, methodParams).slice(2) // Remove '0x' prefix
        : '';
      
      // Create call data
      const callData = methodId + encodedParams;
      
      // Get contract account
      const contractAccount = this._getContractAccountAddress(contractAddress);
      
      // Prepare Solana transaction for contract execution
      const executeIx = await this._createExecutionInstruction(
        contractAddress,
        callData,
        wallet.publicKey,
        options
      );
      
      // Create and sign transaction
      const transaction = new Transaction().add(executeIx);
      transaction.feePayer = wallet.publicKey;
      transaction.recentBlockhash = (await this.connection.getRecentBlockhash()).blockhash;
      
      // Sign and send transaction
      const signedTx = await wallet.signTransaction(transaction);
      const signature = await this.connection.sendRawTransaction(signedTx.serialize());
      
      // Wait for confirmation
      await this.connection.confirmTransaction(signature);
      
      return {
        transactionHash: signature,
        contractAddress: contractAddress,
        solanaAddress: contractAccount.toString()
      };
    } catch (error) {
      throw new Error(`Contract execution failed: ${error.message}`);
    }
  }
  
  /**
   * Get contract state
   * @param {string} contractAddress - Ethereum contract address
   * @param {string} slot - Storage slot (hex string)
   * @returns {string} Storage value (hex string)
   */
  async getContractState(contractAddress, slot) {
    try {
      const contractAccount = this._getContractAccountAddress(contractAddress);
      
      // Use adapter to get state
      const value = await this.activeAdapter.getContractState(
        this.connection,
        contractAccount,
        slot
      );
      
      return value;
    } catch (error) {
      throw new Error(`Failed to get contract state: ${error.message}`);
    }
  }
  
  /**
   * Get contract logs (events)
   * @param {string} contractAddress - Ethereum contract address
   * @param {Object} filter - Event filter
   * @returns {Array} Array of logs
   */
  async getContractLogs(contractAddress, filter = {}) {
    try {
      const contractAccount = this._getContractAccountAddress(contractAddress);
      
      // Use adapter to get logs
      const logs = await this.activeAdapter.getContractLogs(
        this.connection,
        contractAccount,
        filter
      );
      
      return logs;
    } catch (error) {
      throw new Error(`Failed to get contract logs: ${error.message}`);
    }
  }
  
  /**
   * Get contract code
   * @param {string} contractAddress - Ethereum contract address
   * @returns {string} Contract bytecode (hex string)
   */
  async getContractCode(contractAddress) {
    try {
      const contractAccount = this._getContractAccountAddress(contractAddress);
      
      // Use adapter to get code
      const code = await this.activeAdapter.getContractCode(
        this.connection,
        contractAccount
      );
      
      return code;
    } catch (error) {
      throw new Error(`Failed to get contract code: ${error.message}`);
    }
  }
  
  /**
   * Estimate gas for a contract call
   * @param {string} contractAddress - Ethereum contract address
   * @param {string} callData - Encoded call data
   * @returns {string} Estimated gas (as hex string)
   */
  async estimateGas(contractAddress, callData) {
    try {
      const contractAccount = this._getContractAccountAddress(contractAddress);
      
      // Use adapter to estimate gas
      const gas = await this.activeAdapter.estimateGas(
        this.connection,
        this.programId,
        contractAccount,
        callData
      );
      
      return gas;
    } catch (error) {
      throw new Error(`Gas estimation failed: ${error.message}`);
    }
  }
  
  /**
   * Get transaction receipt
   * @param {string} txHash - Solana transaction signature
   * @returns {Object} Transaction receipt in Ethereum format
   */
  async getTransactionReceipt(txHash) {
    try {
      // Get Solana transaction
      const tx = await this.connection.getTransaction(txHash, {
        commitment: 'confirmed'
      });
      
      if (!tx) {
        throw new Error('Transaction not found');
      }
      
      // Use adapter to convert to Ethereum receipt format
      const receipt = await this.activeAdapter.getTransactionReceipt(
        tx,
        this.programId
      );
      
      return receipt;
    } catch (error) {
      throw new Error(`Failed to get transaction receipt: ${error.message}`);
    }
  }
  
  /**
   * Get transaction count (nonce) for an address
   * @param {string} address - Ethereum address
   * @returns {number} Transaction count
   */
  async getTransactionCount(address) {
    try {
      // Use adapter to get transaction count
      const count = await this.activeAdapter.getTransactionCount(
        this.connection,
        this.programId,
        address
      );
      
      return count;
    } catch (error) {
      throw new Error(`Failed to get transaction count: ${error.message}`);
    }
  }
  
  /**
   * Get balance of an Ethereum address
   * @param {string} address - Ethereum address
   * @returns {string} Balance in wei (as hex string)
   */
  async getBalance(address) {
    try {
      // Use adapter to get balance
      const balance = await this.activeAdapter.getBalance(
        this.connection,
        this.programId,
        address
      );
      
      return balance;
    } catch (error) {
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }
  
  /**
   * Create a deployment instruction
   * @private
   * @param {string} bytecode - Contract bytecode
   * @param {string} ethAddress - Ethereum contract address
   * @param {PublicKey} payer - Transaction fee payer
   * @param {Object} options - Deployment options
   * @returns {TransactionInstruction} Solana transaction instruction
   */
  async _createDeploymentInstruction(bytecode, ethAddress, payer, options) {
    // Convert bytecode to Buffer
    const bytecodeBuffer = Buffer.from(bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode, 'hex');
    
    // Calculate contract account address
    const contractAccount = this._getContractAccountAddress(ethAddress);
    
    // Create instruction data
    // Format: [0 (deploy opcode), ...bytecode]
    const data = Buffer.concat([
      Buffer.from([0]), // Deploy opcode
      bytecodeBuffer
    ]);
    
    // Create instruction
    return new TransactionInstruction({
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: contractAccount, isSigner: false, isWritable: true },
        { pubkey: this.evmStateAccount, isSigner: false, isWritable: true }
      ],
      programId: this.programId,
      data
    });
  }
  
  /**
   * Create an execution instruction
   * @private
   * @param {string} contractAddress - Ethereum contract address
   * @param {string} callData - Encoded call data
   * @param {PublicKey} payer - Transaction fee payer
   * @param {Object} options - Execution options
   * @returns {TransactionInstruction} Solana transaction instruction
   */
  async _createExecutionInstruction(contractAddress, callData, payer, options) {
    // Convert call data to Buffer
    const callDataBuffer = Buffer.from(callData.startsWith('0x') ? callData.slice(2) : callData, 'hex');
    
    // Calculate contract account address
    const contractAccount = this._getContractAccountAddress(contractAddress);
    
    // Create instruction data
    // Format: [1 (execute opcode), ...callData]
    const data = Buffer.concat([
      Buffer.from([1]), // Execute opcode
      callDataBuffer
    ]);
    
    // Create instruction
    return new TransactionInstruction({
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: contractAccount, isSigner: false, isWritable: true },
        { pubkey: this.evmStateAccount, isSigner: false, isWritable: true }
      ],
      programId: this.programId,
      data
    });
  }
  
  /**
   * Calculate Ethereum contract address
   * @private
   * @param {string} deployer - Deployer address
   * @param {number} nonce - Nonce
   * @returns {string} Ethereum contract address
   */
  _calculateContractAddress(deployer, nonce) {
    // Convert Solana address to Ethereum format
    const ethDeployer = this._solanaToEthAddress(deployer);
    
    // Calculate address using Ethereum's CREATE formula
    const input = ethers.utils.RLP.encode([
      ethDeployer,
      ethers.utils.hexlify(nonce)
    ]);
    
    const ethAddress = '0x' + keccak256(Buffer.from(input.slice(2), 'hex')).slice(-40);
    
    return ethAddress;
  }
  
  /**
   * Convert Solana address to Ethereum format
   * @private
   * @param {string} solanaAddress - Solana address
   * @returns {string} Ethereum address
   */
  _solanaToEthAddress(solanaAddress) {
    // Take the last 20 bytes of the keccak256 hash of the Solana address
    const hash = keccak256(solanaAddress);
    return '0x' + hash.slice(-40);
  }
  
  /**
   * Get Solana account address for an Ethereum contract
   * @private
   * @param {string} ethAddress - Ethereum contract address
   * @returns {PublicKey} Solana account address
   */
  _getContractAccountAddress(ethAddress) {
    // Remove '0x' prefix if present
    const addressHex = ethAddress.startsWith('0x') ? ethAddress.slice(2) : ethAddress;
    
    // Find program derived address for the contract
    const [contractAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('evm_contract'),
        Buffer.from(addressHex, 'hex')
      ],
      this.programId
    );
    
    return contractAccount;
  }
}

module.exports = EVMCompatibilityLayer;
