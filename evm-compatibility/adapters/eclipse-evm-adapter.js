/**
 * Eclipse EVM Adapter for Solana Layer 2
 * 
 * This adapter provides integration with Eclipse EVM, allowing Ethereum smart contracts
 * to be executed on Solana Layer 2 using Eclipse's infrastructure.
 */

const { Connection, PublicKey, Transaction } = require('@solana/web3.js');
const { ethers } = require('ethers');
const { Buffer } = require('buffer');
const axios = require('axios');

/**
 * Eclipse EVM Adapter
 * @param {Object} config - Adapter configuration
 * @returns {Object} Adapter interface
 */
module.exports = function(config) {
  // Default configuration
  const defaultConfig = {
    eclipseRpcUrl: 'https://api.evm.eclipse.builders',
    eclipseProgramId: 'EVM1111111111111111111111111111111111111111',
    gasPrice: '0x3b9aca00', // 1 Gwei
    gasLimit: '0x5f5e100', // 100,000,000
  };
  
  // Merge with provided config
  const adapterConfig = { ...defaultConfig, ...config };
  
  // Convert program ID to PublicKey
  const eclipseProgramId = new PublicKey(adapterConfig.eclipseProgramId);
  
  /**
   * Call a contract (read-only)
   * @param {Connection} connection - Solana connection
   * @param {PublicKey} programId - Layer 2 program ID
   * @param {PublicKey} contractAccount - Contract account
   * @param {string} callData - Encoded call data
   * @param {string} returnType - Return type
   * @returns {any} Call result
   */
  async function callContract(connection, programId, contractAccount, callData, returnType) {
    try {
      // Get contract state account data
      const accountInfo = await connection.getAccountInfo(contractAccount);
      if (!accountInfo) {
        throw new Error('Contract account not found');
      }
      
      // Extract contract address from account data
      // First 20 bytes after the header (8 bytes) contain the Ethereum address
      const ethAddress = '0x' + Buffer.from(accountInfo.data.slice(8, 28)).toString('hex');
      
      // Prepare call request for Eclipse EVM
      const callRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [
          {
            from: '0x0000000000000000000000000000000000000000',
            to: ethAddress,
            data: callData.startsWith('0x') ? callData : '0x' + callData,
            gas: adapterConfig.gasLimit,
            gasPrice: adapterConfig.gasPrice
          },
          'latest'
        ]
      };
      
      // Send request to Eclipse RPC
      const response = await axios.post(adapterConfig.eclipseRpcUrl, callRequest);
      
      if (response.data.error) {
        throw new Error(`Eclipse EVM call failed: ${response.data.error.message}`);
      }
      
      // Decode result based on return type
      const result = response.data.result;
      return decodeResult(result, returnType);
    } catch (error) {
      throw new Error(`Eclipse EVM adapter call failed: ${error.message}`);
    }
  }
  
  /**
   * Get contract state
   * @param {Connection} connection - Solana connection
   * @param {PublicKey} contractAccount - Contract account
   * @param {string} slot - Storage slot (hex string)
   * @returns {string} Storage value (hex string)
   */
  async function getContractState(connection, contractAccount, slot) {
    try {
      // Get contract state account data
      const accountInfo = await connection.getAccountInfo(contractAccount);
      if (!accountInfo) {
        throw new Error('Contract account not found');
      }
      
      // Extract contract address from account data
      const ethAddress = '0x' + Buffer.from(accountInfo.data.slice(8, 28)).toString('hex');
      
      // Prepare request for Eclipse EVM
      const stateRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getStorageAt',
        params: [
          ethAddress,
          slot.startsWith('0x') ? slot : '0x' + slot,
          'latest'
        ]
      };
      
      // Send request to Eclipse RPC
      const response = await axios.post(adapterConfig.eclipseRpcUrl, stateRequest);
      
      if (response.data.error) {
        throw new Error(`Eclipse EVM state retrieval failed: ${response.data.error.message}`);
      }
      
      return response.data.result;
    } catch (error) {
      throw new Error(`Eclipse EVM adapter state retrieval failed: ${error.message}`);
    }
  }
  
  /**
   * Get contract logs (events)
   * @param {Connection} connection - Solana connection
   * @param {PublicKey} contractAccount - Contract account
   * @param {Object} filter - Event filter
   * @returns {Array} Array of logs
   */
  async function getContractLogs(connection, contractAccount, filter = {}) {
    try {
      // Get contract state account data
      const accountInfo = await connection.getAccountInfo(contractAccount);
      if (!accountInfo) {
        throw new Error('Contract account not found');
      }
      
      // Extract contract address from account data
      const ethAddress = '0x' + Buffer.from(accountInfo.data.slice(8, 28)).toString('hex');
      
      // Prepare filter for Eclipse EVM
      const eclipseFilter = {
        address: ethAddress
      };
      
      // Add topics if provided
      if (filter.topics) {
        eclipseFilter.topics = filter.topics;
      }
      
      // Add block range if provided
      if (filter.fromBlock) {
        eclipseFilter.fromBlock = filter.fromBlock;
      }
      
      if (filter.toBlock) {
        eclipseFilter.toBlock = filter.toBlock;
      }
      
      // Prepare request for Eclipse EVM
      const logsRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getLogs',
        params: [eclipseFilter]
      };
      
      // Send request to Eclipse RPC
      const response = await axios.post(adapterConfig.eclipseRpcUrl, logsRequest);
      
      if (response.data.error) {
        throw new Error(`Eclipse EVM logs retrieval failed: ${response.data.error.message}`);
      }
      
      return response.data.result;
    } catch (error) {
      throw new Error(`Eclipse EVM adapter logs retrieval failed: ${error.message}`);
    }
  }
  
  /**
   * Get contract code
   * @param {Connection} connection - Solana connection
   * @param {PublicKey} contractAccount - Contract account
   * @returns {string} Contract bytecode (hex string)
   */
  async function getContractCode(connection, contractAccount) {
    try {
      // Get contract state account data
      const accountInfo = await connection.getAccountInfo(contractAccount);
      if (!accountInfo) {
        throw new Error('Contract account not found');
      }
      
      // Extract contract address from account data
      const ethAddress = '0x' + Buffer.from(accountInfo.data.slice(8, 28)).toString('hex');
      
      // Prepare request for Eclipse EVM
      const codeRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getCode',
        params: [
          ethAddress,
          'latest'
        ]
      };
      
      // Send request to Eclipse RPC
      const response = await axios.post(adapterConfig.eclipseRpcUrl, codeRequest);
      
      if (response.data.error) {
        throw new Error(`Eclipse EVM code retrieval failed: ${response.data.error.message}`);
      }
      
      return response.data.result;
    } catch (error) {
      throw new Error(`Eclipse EVM adapter code retrieval failed: ${error.message}`);
    }
  }
  
  /**
   * Estimate gas for a contract call
   * @param {Connection} connection - Solana connection
   * @param {PublicKey} programId - Layer 2 program ID
   * @param {PublicKey} contractAccount - Contract account
   * @param {string} callData - Encoded call data
   * @returns {string} Estimated gas (as hex string)
   */
  async function estimateGas(connection, programId, contractAccount, callData) {
    try {
      // Get contract state account data
      const accountInfo = await connection.getAccountInfo(contractAccount);
      if (!accountInfo) {
        throw new Error('Contract account not found');
      }
      
      // Extract contract address from account data
      const ethAddress = '0x' + Buffer.from(accountInfo.data.slice(8, 28)).toString('hex');
      
      // Prepare request for Eclipse EVM
      const gasRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_estimateGas',
        params: [
          {
            to: ethAddress,
            data: callData.startsWith('0x') ? callData : '0x' + callData
          }
        ]
      };
      
      // Send request to Eclipse RPC
      const response = await axios.post(adapterConfig.eclipseRpcUrl, gasRequest);
      
      if (response.data.error) {
        throw new Error(`Eclipse EVM gas estimation failed: ${response.data.error.message}`);
      }
      
      return response.data.result;
    } catch (error) {
      throw new Error(`Eclipse EVM adapter gas estimation failed: ${error.message}`);
    }
  }
  
  /**
   * Get transaction receipt
   * @param {Object} tx - Solana transaction
   * @param {PublicKey} programId - Layer 2 program ID
   * @returns {Object} Transaction receipt in Ethereum format
   */
  async function getTransactionReceipt(tx, programId) {
    try {
      // Extract Eclipse EVM transaction hash from Solana transaction logs
      let eclipseTxHash = null;
      
      if (tx.meta && tx.meta.logMessages) {
        for (const log of tx.meta.logMessages) {
          // Look for Eclipse EVM transaction hash in logs
          const match = log.match(/Eclipse EVM Transaction: (0x[a-fA-F0-9]{64})/);
          if (match) {
            eclipseTxHash = match[1];
            break;
          }
        }
      }
      
      if (!eclipseTxHash) {
        // Try to derive Eclipse transaction hash from Solana signature
        // This is a fallback method specific to Eclipse's implementation
        eclipseTxHash = '0x' + ethers.utils.keccak256(
          '0x' + Buffer.from(tx.transaction.signatures[0], 'base58').toString('hex')
        ).slice(2);
      }
      
      // Prepare request for Eclipse EVM
      const receiptRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionReceipt',
        params: [eclipseTxHash]
      };
      
      // Send request to Eclipse RPC
      const response = await axios.post(adapterConfig.eclipseRpcUrl, receiptRequest);
      
      if (response.data.error) {
        throw new Error(`Eclipse EVM receipt retrieval failed: ${response.data.error.message}`);
      }
      
      // Add Solana-specific fields to the receipt
      const receipt = response.data.result;
      if (receipt) {
        receipt.solanaTransactionId = tx.transaction.signatures[0];
        receipt.solanaBlockNumber = tx.slot;
        receipt.solanaBlockTime = tx.blockTime;
      }
      
      return receipt;
    } catch (error) {
      throw new Error(`Eclipse EVM adapter receipt retrieval failed: ${error.message}`);
    }
  }
  
  /**
   * Get transaction count (nonce) for an address
   * @param {Connection} connection - Solana connection
   * @param {PublicKey} programId - Layer 2 program ID
   * @param {string} address - Ethereum address
   * @returns {number} Transaction count
   */
  async function getTransactionCount(connection, programId, address) {
    try {
      // Prepare request for Eclipse EVM
      const countRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionCount',
        params: [
          address.startsWith('0x') ? address : '0x' + address,
          'latest'
        ]
      };
      
      // Send request to Eclipse RPC
      const response = await axios.post(adapterConfig.eclipseRpcUrl, countRequest);
      
      if (response.data.error) {
        throw new Error(`Eclipse EVM transaction count retrieval failed: ${response.data.error.message}`);
      }
      
      // Convert hex to number
      return parseInt(response.data.result, 16);
    } catch (error) {
      throw new Error(`Eclipse EVM adapter transaction count retrieval failed: ${error.message}`);
    }
  }
  
  /**
   * Get balance of an Ethereum address
   * @param {Connection} connection - Solana connection
   * @param {PublicKey} programId - Layer 2 program ID
   * @param {string} address - Ethereum address
   * @returns {string} Balance in wei (as hex string)
   */
  async function getBalance(connection, programId, address) {
    try {
      // Prepare request for Eclipse EVM
      const balanceRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getBalance',
        params: [
          address.startsWith('0x') ? address : '0x' + address,
          'latest'
        ]
      };
      
      // Send request to Eclipse RPC
      const response = await axios.post(adapterConfig.eclipseRpcUrl, balanceRequest);
      
      if (response.data.error) {
        throw new Error(`Eclipse EVM balance retrieval failed: ${response.data.error.message}`);
      }
      
      return response.data.result;
    } catch (error) {
      throw new Error(`Eclipse EVM adapter balance retrieval failed: ${error.message}`);
    }
  }
  
  /**
   * Decode result based on return type
   * @param {string} result - Hex string result
   * @param {string} returnType - Return type
   * @returns {any} Decoded result
   */
  function decodeResult(result, returnType) {
    if (!result || result === '0x') {
      return null;
    }
    
    // Remove '0x' prefix
    const hexData = result.startsWith('0x') ? result.slice(2) : result;
    
    // Decode based on return type
    switch (returnType) {
      case 'uint256':
      case 'uint':
        return ethers.BigNumber.from(result).toString();
        
      case 'int256':
      case 'int':
        return ethers.BigNumber.from(result).toString();
        
      case 'address':
        // Last 20 bytes
        return '0x' + hexData.slice(-40);
        
      case 'bool':
        return hexData !== '0000000000000000000000000000000000000000000000000000000000000000';
        
      case 'string':
        try {
          // Decode string according to Solidity ABI encoding
          const abiCoder = new ethers.utils.AbiCoder();
          return abiCoder.decode(['string'], result)[0];
        } catch (error) {
          return hexData;
        }
        
      case 'bytes':
      case 'bytes32':
        return result;
        
      default:
        // For complex types, return raw result
        return result;
    }
  }
  
  // Return adapter interface
  return {
    callContract,
    getContractState,
    getContractLogs,
    getContractCode,
    estimateGas,
    getTransactionReceipt,
    getTransactionCount,
    getBalance
  };
};
