/**
 * Solana Native Components for Layer-2 Solution
 * 
 * This module provides native Solana components that work alongside Neon EVM
 * to create a comprehensive Layer-2 scaling solution. These components leverage
 * Solana's native capabilities for high throughput and low latency.
 * 
 * @module solana_native_components
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { Token, TOKEN_PROGRAM_ID, AccountLayout } from '@solana/spl-token';
import { Logger } from './utils/logger';

/**
 * Configuration options for Solana native components
 */
export interface SolanaNativeConfig {
  /** Solana RPC endpoint URL */
  solanaRpcUrl: string;
  /** Operator account keypair */
  operatorKeypair: Keypair;
  /** Program ID for the Layer-2 validator program */
  validatorProgramId: string;
  /** Program ID for the state commitment program */
  stateCommitmentProgramId: string;
  /** Confirmation timeout in milliseconds */
  confirmationTimeout?: number;
}

/**
 * Class that implements native Solana components for the Layer-2 solution
 */
export class SolanaNativeComponents {
  private connection: Connection;
  private operatorKeypair: Keypair;
  private validatorProgramId: PublicKey;
  private stateCommitmentProgramId: PublicKey;
  private logger: Logger;
  private confirmationTimeout: number;

  /**
   * Creates a new instance of SolanaNativeComponents
   * 
   * @param config - Configuration options for Solana native components
   */
  constructor(config: SolanaNativeConfig) {
    this.connection = new Connection(config.solanaRpcUrl, 'confirmed');
    this.operatorKeypair = config.operatorKeypair;
    this.validatorProgramId = new PublicKey(config.validatorProgramId);
    this.stateCommitmentProgramId = new PublicKey(config.stateCommitmentProgramId);
    this.confirmationTimeout = config.confirmationTimeout || 60000; // 60 seconds default
    this.logger = new Logger('SolanaNativeComponents');
    
    this.logger.info('SolanaNativeComponents initialized', {
      solanaRpcUrl: config.solanaRpcUrl,
      validatorProgramId: config.validatorProgramId,
      stateCommitmentProgramId: config.stateCommitmentProgramId
    });
  }

  /**
   * Creates a new state commitment account for storing Layer-2 state roots
   * 
   * @param stateRootKeypair - Keypair for the state root account
   * @returns Promise resolving to the public key of the created account
   */
  async createStateCommitmentAccount(stateRootKeypair: Keypair): Promise<PublicKey> {
    try {
      this.logger.info('Creating state commitment account');
      
      // Calculate the required space for the account
      const space = 1024; // Allocate 1KB for state root data
      
      // Calculate rent exemption amount
      const rentExemptionAmount = await this.connection.getMinimumBalanceForRentExemption(space);
      
      // Create transaction to create account
      const transaction = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: this.operatorKeypair.publicKey,
          newAccountPubkey: stateRootKeypair.publicKey,
          lamports: rentExemptionAmount,
          space,
          programId: this.stateCommitmentProgramId
        })
      );
      
      // Send and confirm transaction
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.operatorKeypair, stateRootKeypair],
        { commitment: 'confirmed' }
      );
      
      this.logger.info('State commitment account created successfully', {
        accountPublicKey: stateRootKeypair.publicKey.toBase58(),
        signature
      });
      
      return stateRootKeypair.publicKey;
    } catch (error) {
      this.logger.error('Failed to create state commitment account', { error });
      throw new Error(`Failed to create state commitment account: ${error.message}`);
    }
  }

  /**
   * Submits a state root to the state commitment program
   * 
   * @param stateRootAccount - Public key of the state root account
   * @param stateRoot - State root hash to submit (32 bytes)
   * @param blockNumber - L2 block number
   * @returns Promise resolving to the transaction signature
   */
  async submitStateRoot(stateRootAccount: PublicKey, stateRoot: Buffer, blockNumber: number): Promise<string> {
    try {
      this.logger.info('Submitting state root', {
        stateRootAccount: stateRootAccount.toBase58(),
        blockNumber
      });
      
      // Create instruction data buffer
      const dataLayout = Buffer.alloc(4 + 32 + 8);
      // Command: Submit State Root (1)
      dataLayout.writeUInt32LE(1, 0);
      // State root (32 bytes)
      stateRoot.copy(dataLayout, 4);
      // Block number (8 bytes)
      dataLayout.writeBigUInt64LE(BigInt(blockNumber), 36);
      
      // Create instruction
      const instruction = new TransactionInstruction({
        keys: [
          { pubkey: stateRootAccount, isSigner: false, isWritable: true },
          { pubkey: this.operatorKeypair.publicKey, isSigner: true, isWritable: false }
        ],
        programId: this.stateCommitmentProgramId,
        data: dataLayout
      });
      
      // Create and send transaction
      const transaction = new Transaction().add(instruction);
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.operatorKeypair],
        { commitment: 'confirmed' }
      );
      
      this.logger.info('State root submitted successfully', {
        signature,
        blockNumber
      });
      
      return signature;
    } catch (error) {
      this.logger.error('Failed to submit state root', { error });
      throw new Error(`Failed to submit state root: ${error.message}`);
    }
  }

  /**
   * Creates a validator node account for the Layer-2 solution
   * 
   * @param validatorKeypair - Keypair for the validator account
   * @param stake - Amount of SOL to stake (in lamports)
   * @returns Promise resolving to the public key of the created account
   */
  async createValidatorAccount(validatorKeypair: Keypair, stake: number): Promise<PublicKey> {
    try {
      this.logger.info('Creating validator account', {
        stake: stake / LAMPORTS_PER_SOL
      });
      
      // Calculate the required space for the account
      const space = 1024; // Allocate 1KB for validator data
      
      // Calculate rent exemption amount
      const rentExemptionAmount = await this.connection.getMinimumBalanceForRentExemption(space);
      
      // Total lamports needed: rent exemption + stake
      const totalLamports = rentExemptionAmount + stake;
      
      // Create transaction to create account
      const transaction = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: this.operatorKeypair.publicKey,
          newAccountPubkey: validatorKeypair.publicKey,
          lamports: totalLamports,
          space,
          programId: this.validatorProgramId
        })
      );
      
      // Send and confirm transaction
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.operatorKeypair, validatorKeypair],
        { commitment: 'confirmed' }
      );
      
      this.logger.info('Validator account created successfully', {
        accountPublicKey: validatorKeypair.publicKey.toBase58(),
        signature,
        stake: stake / LAMPORTS_PER_SOL
      });
      
      return validatorKeypair.publicKey;
    } catch (error) {
      this.logger.error('Failed to create validator account', { error });
      throw new Error(`Failed to create validator account: ${error.message}`);
    }
  }

  /**
   * Registers a validator for the Layer-2 solution
   * 
   * @param validatorAccount - Public key of the validator account
   * @param name - Name of the validator
   * @param url - URL of the validator's API endpoint
   * @returns Promise resolving to the transaction signature
   */
  async registerValidator(validatorAccount: PublicKey, name: string, url: string): Promise<string> {
    try {
      this.logger.info('Registering validator', {
        validatorAccount: validatorAccount.toBase58(),
        name,
        url
      });
      
      // Create instruction data buffer
      const nameBuffer = Buffer.from(name.padEnd(32, '\0').slice(0, 32));
      const urlBuffer = Buffer.from(url.padEnd(128, '\0').slice(0, 128));
      const dataLayout = Buffer.alloc(4 + 32 + 128);
      
      // Command: Register Validator (1)
      dataLayout.writeUInt32LE(1, 0);
      // Name (32 bytes)
      nameBuffer.copy(dataLayout, 4);
      // URL (128 bytes)
      urlBuffer.copy(dataLayout, 36);
      
      // Create instruction
      const instruction = new TransactionInstruction({
        keys: [
          { pubkey: validatorAccount, isSigner: false, isWritable: true },
          { pubkey: this.operatorKeypair.publicKey, isSigner: true, isWritable: false }
        ],
        programId: this.validatorProgramId,
        data: dataLayout
      });
      
      // Create and send transaction
      const transaction = new Transaction().add(instruction);
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.operatorKeypair],
        { commitment: 'confirmed' }
      );
      
      this.logger.info('Validator registered successfully', {
        signature
      });
      
      return signature;
    } catch (error) {
      this.logger.error('Failed to register validator', { error });
      throw new Error(`Failed to register validator: ${error.message}`);
    }
  }

  /**
   * Creates a token bridge account for bridging tokens between L1 and L2
   * 
   * @param tokenMint - Public key of the token mint
   * @param bridgeKeypair - Keypair for the bridge account
   * @returns Promise resolving to the public key of the created account
   */
  async createTokenBridgeAccount(tokenMint: PublicKey, bridgeKeypair: Keypair): Promise<PublicKey> {
    try {
      this.logger.info('Creating token bridge account', {
        tokenMint: tokenMint.toBase58()
      });
      
      // Create token account
      const token = new Token(
        this.connection,
        tokenMint,
        TOKEN_PROGRAM_ID,
        this.operatorKeypair
      );
      
      // Create account
      const tokenAccount = await token.createAccount(bridgeKeypair.publicKey);
      
      this.logger.info('Token bridge account created successfully', {
        tokenAccount: tokenAccount.toBase58()
      });
      
      return tokenAccount;
    } catch (error) {
      this.logger.error('Failed to create token bridge account', { error });
      throw new Error(`Failed to create token bridge account: ${error.message}`);
    }
  }

  /**
   * Deposits tokens from L1 to L2
   * 
   * @param userAccount - Public key of the user's token account
   * @param bridgeAccount - Public key of the bridge token account
   * @param amount - Amount of tokens to deposit
   * @param l2Address - L2 address to receive the tokens
   * @returns Promise resolving to the transaction signature
   */
  async depositTokens(
    userAccount: PublicKey,
    bridgeAccount: PublicKey,
    amount: number,
    l2Address: string
  ): Promise<string> {
    try {
      this.logger.info('Depositing tokens to L2', {
        userAccount: userAccount.toBase58(),
        bridgeAccount: bridgeAccount.toBase58(),
        amount,
        l2Address
      });
      
      // Create instruction data buffer
      const l2AddressBuffer = Buffer.from(l2Address.padStart(40, '0').slice(0, 40), 'hex');
      const dataLayout = Buffer.alloc(4 + 8 + 20);
      
      // Command: Deposit (1)
      dataLayout.writeUInt32LE(1, 0);
      // Amount (8 bytes)
      dataLayout.writeBigUInt64LE(BigInt(amount), 4);
      // L2 Address (20 bytes)
      l2AddressBuffer.copy(dataLayout, 12);
      
      // Create instructions
      const transferInstruction = Token.createTransferInstruction(
        TOKEN_PROGRAM_ID,
        userAccount,
        bridgeAccount,
        this.operatorKeypair.publicKey,
        [],
        amount
      );
      
      const bridgeInstruction = new TransactionInstruction({
        keys: [
          { pubkey: bridgeAccount, isSigner: false, isWritable: true },
          { pubkey: this.operatorKeypair.publicKey, isSigner: true, isWritable: false }
        ],
        programId: this.validatorProgramId,
        data: dataLayout
      });
      
      // Create and send transaction
      const transaction = new Transaction()
        .add(transferInstruction)
        .add(bridgeInstruction);
      
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.operatorKeypair],
        { commitment: 'confirmed' }
      );
      
      this.logger.info('Tokens deposited successfully', {
        signature,
        amount
      });
      
      return signature;
    } catch (error) {
      this.logger.error('Failed to deposit tokens', { error });
      throw new Error(`Failed to deposit tokens: ${error.message}`);
    }
  }

  /**
   * Withdraws tokens from L2 to L1
   * 
   * @param bridgeAccount - Public key of the bridge token account
   * @param userAccount - Public key of the user's token account
   * @param amount - Amount of tokens to withdraw
   * @param l2TransactionHash - L2 transaction hash that initiated the withdrawal
   * @returns Promise resolving to the transaction signature
   */
  async withdrawTokens(
    bridgeAccount: PublicKey,
    userAccount: PublicKey,
    amount: number,
    l2TransactionHash: string
  ): Promise<string> {
    try {
      this.logger.info('Withdrawing tokens from L2', {
        bridgeAccount: bridgeAccount.toBase58(),
        userAccount: userAccount.toBase58(),
        amount,
        l2TransactionHash
      });
      
      // Create instruction data buffer
      const txHashBuffer = Buffer.from(l2TransactionHash.padStart(64, '0').slice(0, 64), 'hex');
      const dataLayout = Buffer.alloc(4 + 8 + 32);
      
      // Command: Withdraw (2)
      dataLayout.writeUInt32LE(2, 0);
      // Amount (8 bytes)
      dataLayout.writeBigUInt64LE(BigInt(amount), 4);
      // L2 Transaction Hash (32 bytes)
      txHashBuffer.copy(dataLayout, 12);
      
      // Create instructions
      const bridgeInstruction = new TransactionInstruction({
        keys: [
          { pubkey: bridgeAccount, isSigner: false, isWritable: true },
          { pubkey: userAccount, isSigner: false, isWritable: true },
          { pubkey: this.operatorKeypair.publicKey, isSigner: true, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
        ],
        programId: this.validatorProgramId,
        data: dataLayout
      });
      
      // Create and send transaction
      const transaction = new Transaction().add(bridgeInstruction);
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.operatorKeypair],
        { commitment: 'confirmed' }
      );
      
      this.logger.info('Tokens withdrawn successfully', {
        signature,
        amount
      });
      
      return signature;
    } catch (error) {
      this.logger.error('Failed to withdraw tokens', { error });
      throw new Error(`Failed to withdraw tokens: ${error.message}`);
    }
  }

  /**
   * Gets the current validator set for the Layer-2 solution
   * 
   * @returns Promise resolving to an array of validator public keys
   */
  async getValidatorSet(): Promise<PublicKey[]> {
    try {
      this.logger.info('Getting validator set');
      
      // Get all accounts owned by the validator program
      const accounts = await this.connection.getProgramAccounts(this.validatorProgramId);
      
      // Filter and map to public keys
      const validators = accounts.map(account => account.pubkey);
      
      this.logger.info('Validator set retrieved', {
        count: validators.length
      });
      
      return validators;
    } catch (error) {
      this.logger.error('Failed to get validator set', { error });
      throw new Error(`Failed to get validator set: ${error.message}`);
    }
  }

  /**
   * Gets the latest state root from the state commitment program
   * 
   * @param stateRootAccount - Public key of the state root account
   * @returns Promise resolving to the latest state root and block number
   */
  async getLatestStateRoot(stateRootAccount: PublicKey): Promise<{ stateRoot: Buffer, blockNumber: number }> {
    try {
      this.logger.info('Getting latest state root', {
        stateRootAccount: stateRootAccount.toBase58()
      });
      
      // Get account data
      const accountInfo = await this.connection.getAccountInfo(stateRootAccount);
      
      if (!accountInfo) {
        throw new Error('State root account not found');
      }
      
      // Parse account data
      const stateRoot = Buffer.from(accountInfo.data.slice(0, 32));
      const blockNumber = accountInfo.data.readBigUInt64LE(32);
      
      this.logger.info('Latest state root retrieved', {
        blockNumber: Number(blockNumber)
      });
      
      return {
        stateRoot,
        blockNumber: Number(blockNumber)
      };
    } catch (error) {
      this.logger.error('Failed to get latest state root', { error });
      throw new Error(`Failed to get latest state root: ${error.message}`);
    }
  }
}
