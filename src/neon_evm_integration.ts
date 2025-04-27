/**
 * Neon EVM Integration for Solana Layer-2
 * 
 * This module provides integration with Neon EVM, allowing execution of Ethereum
 * smart contracts on Solana blockchain. It leverages Solana's high throughput and
 * low fees while maintaining compatibility with Ethereum's ecosystem.
 * 
 * @module neon_evm_integration
 */

import { Connection, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { NeonEVMLoader, NeonEVMProgram } from '@neonevm/sdk';
import { Keypair } from '@solana/web3.js';
import { Logger } from './utils/logger';

/**
 * Configuration options for Neon EVM integration
 */
export interface NeonEVMConfig {
  /** Solana RPC endpoint URL */
  solanaRpcUrl: string;
  /** Neon EVM program ID on Solana */
  neonEvmProgramId: string;
  /** Operator account keypair */
  operatorKeypair: Keypair;
  /** Gas price in Neon (wei) */
  gasPrice?: number;
  /** Gas limit for transactions */
  gasLimit?: number;
  /** Timeout for transaction confirmation in milliseconds */
  confirmationTimeout?: number;
}

/**
 * Class that handles integration with Neon EVM on Solana
 */
export class NeonEVMIntegration {
  private connection: Connection;
  private neonEvmProgramId: PublicKey;
  private operatorKeypair: Keypair;
  private logger: Logger;
  private gasPrice: number;
  private gasLimit: number;
  private confirmationTimeout: number;

  /**
   * Creates a new instance of NeonEVMIntegration
   * 
   * @param config - Configuration options for Neon EVM integration
   */
  constructor(config: NeonEVMConfig) {
    this.connection = new Connection(config.solanaRpcUrl, 'confirmed');
    this.neonEvmProgramId = new PublicKey(config.neonEvmProgramId);
    this.operatorKeypair = config.operatorKeypair;
    this.gasPrice = config.gasPrice || 20000000000; // 20 Gwei default
    this.gasLimit = config.gasLimit || 500000; // 500k gas default
    this.confirmationTimeout = config.confirmationTimeout || 60000; // 60 seconds default
    this.logger = new Logger('NeonEVMIntegration');
    
    this.logger.info('NeonEVMIntegration initialized', {
      solanaRpcUrl: config.solanaRpcUrl,
      neonEvmProgramId: config.neonEvmProgramId,
      gasPrice: this.gasPrice,
      gasLimit: this.gasLimit
    });
  }

  /**
   * Initializes the Neon EVM loader
   * 
   * @returns Promise resolving to the initialized NeonEVMLoader
   */
  async initializeLoader(): Promise<NeonEVMLoader> {
    try {
      const loader = new NeonEVMLoader({
        connection: this.connection,
        programId: this.neonEvmProgramId
      });
      
      await loader.initialize();
      this.logger.info('Neon EVM loader initialized successfully');
      return loader;
    } catch (error) {
      this.logger.error('Failed to initialize Neon EVM loader', { error });
      throw new Error(`Failed to initialize Neon EVM loader: ${error.message}`);
    }
  }

  /**
   * Deploys an Ethereum smart contract to Neon EVM on Solana
   * 
   * @param bytecode - Contract bytecode to deploy
   * @param constructorArgs - ABI-encoded constructor arguments (if any)
   * @returns Promise resolving to the deployed contract address
   */
  async deployContract(bytecode: string, constructorArgs: string = ''): Promise<string> {
    try {
      const loader = await this.initializeLoader();
      const program = new NeonEVMProgram(loader);
      
      this.logger.info('Deploying contract to Neon EVM');
      
      // Combine bytecode and constructor args
      const deployData = bytecode + (constructorArgs.startsWith('0x') ? constructorArgs.slice(2) : constructorArgs);
      
      // Create and send deployment transaction
      const deploymentResult = await program.deployContract(
        this.operatorKeypair,
        deployData,
        this.gasLimit,
        this.gasPrice
      );
      
      this.logger.info('Contract deployed successfully', {
        contractAddress: deploymentResult.contractAddress,
        transactionHash: deploymentResult.transactionHash
      });
      
      return deploymentResult.contractAddress;
    } catch (error) {
      this.logger.error('Contract deployment failed', { error });
      throw new Error(`Contract deployment failed: ${error.message}`);
    }
  }

  /**
   * Calls a method on an Ethereum smart contract deployed on Neon EVM
   * 
   * @param contractAddress - Address of the deployed contract
   * @param callData - ABI-encoded function call data
   * @param value - Amount of Neon to send with the call (in wei)
   * @returns Promise resolving to the transaction result
   */
  async callContract(contractAddress: string, callData: string, value: number = 0): Promise<any> {
    try {
      const loader = await this.initializeLoader();
      const program = new NeonEVMProgram(loader);
      
      this.logger.info('Calling contract method', {
        contractAddress,
        callDataLength: callData.length,
        value
      });
      
      // Create and send transaction
      const callResult = await program.callContract(
        this.operatorKeypair,
        contractAddress,
        callData,
        value,
        this.gasLimit,
        this.gasPrice
      );
      
      this.logger.info('Contract call successful', {
        transactionHash: callResult.transactionHash,
        gasUsed: callResult.gasUsed
      });
      
      return callResult;
    } catch (error) {
      this.logger.error('Contract call failed', { error });
      throw new Error(`Contract call failed: ${error.message}`);
    }
  }

  /**
   * Performs a read-only call to a contract (does not modify state)
   * 
   * @param contractAddress - Address of the deployed contract
   * @param callData - ABI-encoded function call data
   * @returns Promise resolving to the call result
   */
  async viewContract(contractAddress: string, callData: string): Promise<string> {
    try {
      const loader = await this.initializeLoader();
      const program = new NeonEVMProgram(loader);
      
      this.logger.info('Performing view call to contract', {
        contractAddress,
        callDataLength: callData.length
      });
      
      // Perform static call
      const viewResult = await program.viewContract(
        contractAddress,
        callData
      );
      
      this.logger.info('View call successful');
      
      return viewResult;
    } catch (error) {
      this.logger.error('View call failed', { error });
      throw new Error(`View call failed: ${error.message}`);
    }
  }

  /**
   * Gets the Ethereum address associated with a Solana public key in Neon EVM
   * 
   * @param solanaPublicKey - Solana public key
   * @returns Promise resolving to the Ethereum address
   */
  async getEthereumAddress(solanaPublicKey: PublicKey): Promise<string> {
    try {
      const loader = await this.initializeLoader();
      
      this.logger.info('Getting Ethereum address for Solana public key', {
        solanaPublicKey: solanaPublicKey.toBase58()
      });
      
      const ethAddress = await loader.getEthereumAddress(solanaPublicKey);
      
      this.logger.info('Ethereum address retrieved', {
        ethAddress
      });
      
      return ethAddress;
    } catch (error) {
      this.logger.error('Failed to get Ethereum address', { error });
      throw new Error(`Failed to get Ethereum address: ${error.message}`);
    }
  }

  /**
   * Gets the Neon EVM transaction receipt
   * 
   * @param transactionHash - Ethereum transaction hash
   * @returns Promise resolving to the transaction receipt
   */
  async getTransactionReceipt(transactionHash: string): Promise<any> {
    try {
      const loader = await this.initializeLoader();
      const program = new NeonEVMProgram(loader);
      
      this.logger.info('Getting transaction receipt', {
        transactionHash
      });
      
      const receipt = await program.getTransactionReceipt(transactionHash);
      
      this.logger.info('Transaction receipt retrieved', {
        blockNumber: receipt.blockNumber,
        status: receipt.status
      });
      
      return receipt;
    } catch (error) {
      this.logger.error('Failed to get transaction receipt', { error });
      throw new Error(`Failed to get transaction receipt: ${error.message}`);
    }
  }

  /**
   * Gets the current Neon EVM block number
   * 
   * @returns Promise resolving to the current block number
   */
  async getBlockNumber(): Promise<number> {
    try {
      const loader = await this.initializeLoader();
      const program = new NeonEVMProgram(loader);
      
      this.logger.info('Getting current block number');
      
      const blockNumber = await program.getBlockNumber();
      
      this.logger.info('Block number retrieved', {
        blockNumber
      });
      
      return blockNumber;
    } catch (error) {
      this.logger.error('Failed to get block number', { error });
      throw new Error(`Failed to get block number: ${error.message}`);
    }
  }
}
