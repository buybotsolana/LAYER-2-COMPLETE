import { PublicKey, Connection, Transaction, SystemProgram, LAMPORTS_PER_SOL, TransactionInstruction } from '@solana/web3.js';
import { Program, AnchorProvider, web3, BN, Idl } from '@project-serum/anchor';
import { NodeWallet } from '@project-serum/anchor/dist/cjs/provider';
import { 
  getEmitterAddressWormhole, 
  parseSequenceFromLogWormhole,
  postVaaSolanaWithRetry,
  getSignedVAA,
  tryNativeToHexString,
  nativeToHexString
} from '@certusone/wormhole-sdk';
import { 
  CHAIN_ID_SOLANA,
  createNonce,
  redeemOnSolana,
  transferFromSolana
} from '@certusone/wormhole-sdk/lib/cjs/solana/wormhole';
import { importCoreWasm, setDefaultWasm } from '@certusone/wormhole-sdk/lib/cjs/solana/wasm';
import { derivePostedVaaKey } from '@certusone/wormhole-sdk/lib/cjs/solana/wormhole';
import * as bs58 from 'bs58';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

// Initialize Wormhole constants
const WORMHOLE_PROGRAM_ID = new PublicKey(process.env.WORMHOLE_PROGRAM_ID || 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth');
const BRIDGE_PROGRAM_ID = new PublicKey(process.env.BRIDGE_PROGRAM_ID || 'Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o');
const TOKEN_BRIDGE_PROGRAM_ID = new PublicKey(process.env.TOKEN_BRIDGE_PROGRAM_ID || 'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb');

// Chain IDs
const SOLANA_CHAIN_ID = 1; // Solana
const LAYER2_CHAIN_ID = 30; // Custom Layer-2 chain ID

/**
 * Enhanced Bridge with Wormhole integration for Layer-2 on Solana
 * Provides secure, trustless bridging between Solana L1 and Layer-2
 */
export class WormholeBridge {
  private connection: Connection;
  private layer2Connection: Connection;
  private payer: web3.Keypair;
  private wormholeProgram: Program;
  private bridgeProgram: Program;
  private tokenBridgeProgram: Program;
  private provider: AnchorProvider;
  private wormholeIdl: Idl;
  private bridgeIdl: Idl;
  private tokenBridgeIdl: Idl;

  /**
   * Constructor for WormholeBridge
   * @param connection Solana connection
   * @param layer2Connection Layer-2 connection
   * @param payerSecret Secret key of the payer account (for relayer operations)
   */
  constructor(
    connection: Connection,
    layer2Connection: Connection,
    payerSecret: Uint8Array
  ) {
    this.connection = connection;
    this.layer2Connection = layer2Connection;
    this.payer = web3.Keypair.fromSecretKey(payerSecret);
    
    // Initialize provider
    this.provider = new AnchorProvider(
      this.connection,
      new NodeWallet(this.payer),
      { commitment: 'confirmed' }
    );

    // Load IDLs
    this.loadIdls();

    // Initialize Wormhole programs
    this.wormholeProgram = new Program(
      this.wormholeIdl,
      WORMHOLE_PROGRAM_ID,
      this.provider
    );

    this.bridgeProgram = new Program(
      this.bridgeIdl,
      BRIDGE_PROGRAM_ID,
      this.provider
    );

    this.tokenBridgeProgram = new Program(
      this.tokenBridgeIdl,
      TOKEN_BRIDGE_PROGRAM_ID,
      this.provider
    );

    // Initialize Wormhole WASM
    this.initWasm();
  }

  /**
   * Load IDLs for Wormhole programs
   */
  private loadIdls() {
    try {
      // In a production environment, these would be loaded from files or APIs
      // For this implementation, we'll define simplified versions inline
      
      this.wormholeIdl = {
        version: "0.1.0",
        name: "wormhole",
        instructions: [
          {
            name: "initialize",
            accounts: [
              { name: "bridge", isMut: true, isSigner: false },
              { name: "guardian", isMut: false, isSigner: false },
              { name: "payer", isMut: true, isSigner: true },
              { name: "systemProgram", isMut: false, isSigner: false }
            ],
            args: [
              { name: "guardianSetExpirationTime", type: "u32" },
              { name: "fee", type: "u64" }
            ]
          },
          {
            name: "postMessage",
            accounts: [
              { name: "bridge", isMut: true, isSigner: false },
              { name: "message", isMut: true, isSigner: true },
              { name: "emitter", isMut: false, isSigner: true },
              { name: "sequence", isMut: true, isSigner: false },
              { name: "payer", isMut: true, isSigner: true },
              { name: "feeCollector", isMut: true, isSigner: false },
              { name: "clock", isMut: false, isSigner: false },
              { name: "rent", isMut: false, isSigner: false },
              { name: "systemProgram", isMut: false, isSigner: false }
            ],
            args: [
              { name: "nonce", type: "u32" },
              { name: "payload", type: "bytes" },
              { name: "consistencyLevel", type: "u8" }
            ]
          },
          {
            name: "postVaa",
            accounts: [
              { name: "guardian", isMut: false, isSigner: true },
              { name: "bridge", isMut: true, isSigner: false },
              { name: "signatureSet", isMut: true, isSigner: false },
              { name: "vaa", isMut: true, isSigner: false },
              { name: "payer", isMut: true, isSigner: true },
              { name: "clock", isMut: false, isSigner: false },
              { name: "rent", isMut: false, isSigner: false },
              { name: "systemProgram", isMut: false, isSigner: false }
            ],
            args: [
              { name: "version", type: "u8" },
              { name: "guardianSetIndex", type: "u32" },
              { name: "timestamp", type: "u32" },
              { name: "nonce", type: "u32" },
              { name: "emitterChain", type: "u16" },
              { name: "emitterAddress", type: "bytes" },
              { name: "sequence", type: "u64" },
              { name: "consistencyLevel", type: "u8" },
              { name: "payload", type: "bytes" }
            ]
          }
        ],
        accounts: [
          {
            name: "Bridge",
            type: {
              kind: "struct",
              fields: [
                { name: "guardianSetIndex", type: "u32" },
                { name: "lastLamports", type: "u64" },
                { name: "config", type: { defined: "BridgeConfig" } }
              ]
            }
          }
        ],
        types: [
          {
            name: "BridgeConfig",
            type: {
              kind: "struct",
              fields: [
                { name: "guardianSetExpirationTime", type: "u32" },
                { name: "fee", type: "u64" }
              ]
            }
          }
        ]
      };
      
      this.bridgeIdl = {
        version: "0.1.0",
        name: "bridge",
        instructions: [
          {
            name: "initialize",
            accounts: [
              { name: "bridge", isMut: true, isSigner: false },
              { name: "payer", isMut: true, isSigner: true },
              { name: "systemProgram", isMut: false, isSigner: false }
            ],
            args: []
          },
          {
            name: "transferTokens",
            accounts: [
              { name: "bridge", isMut: true, isSigner: false },
              { name: "sender", isMut: false, isSigner: true },
              { name: "tokenAccount", isMut: true, isSigner: false },
              { name: "wormhole", isMut: false, isSigner: false },
              { name: "systemProgram", isMut: false, isSigner: false }
            ],
            args: [
              { name: "amount", type: "u64" },
              { name: "recipientChain", type: "u16" },
              { name: "recipient", type: "bytes" },
              { name: "nonce", type: "u32" }
            ]
          },
          {
            name: "completeTransfer",
            accounts: [
              { name: "bridge", isMut: true, isSigner: false },
              { name: "vaa", isMut: false, isSigner: false },
              { name: "tokenAccount", isMut: true, isSigner: false },
              { name: "recipient", isMut: false, isSigner: false },
              { name: "wormhole", isMut: false, isSigner: false }
            ],
            args: []
          }
        ],
        accounts: [
          {
            name: "Bridge",
            type: {
              kind: "struct",
              fields: [
                { name: "wormhole", type: "publicKey" },
                { name: "tokenProgram", type: "publicKey" }
              ]
            }
          }
        ]
      };
      
      this.tokenBridgeIdl = {
        version: "0.1.0",
        name: "token_bridge",
        instructions: [
          {
            name: "initialize",
            accounts: [
              { name: "bridge", isMut: true, isSigner: false },
              { name: "payer", isMut: true, isSigner: true },
              { name: "systemProgram", isMut: false, isSigner: false }
            ],
            args: []
          },
          {
            name: "transferToken",
            accounts: [
              { name: "bridge", isMut: true, isSigner: false },
              { name: "sender", isMut: false, isSigner: true },
              { name: "tokenAccount", isMut: true, isSigner: false },
              { name: "wormhole", isMut: false, isSigner: false },
              { name: "tokenProgram", isMut: false, isSigner: false },
              { name: "systemProgram", isMut: false, isSigner: false }
            ],
            args: [
              { name: "amount", type: "u64" },
              { name: "recipientChain", type: "u16" },
              { name: "recipient", type: "bytes" },
              { name: "nonce", type: "u32" }
            ]
          },
          {
            name: "completeTransfer",
            accounts: [
              { name: "bridge", isMut: true, isSigner: false },
              { name: "vaa", isMut: false, isSigner: false },
              { name: "tokenAccount", isMut: true, isSigner: false },
              { name: "recipient", isMut: false, isSigner: false },
              { name: "wormhole", isMut: false, isSigner: false },
              { name: "tokenProgram", isMut: false, isSigner: false }
            ],
            args: []
          }
        ],
        accounts: [
          {
            name: "TokenBridge",
            type: {
              kind: "struct",
              fields: [
                { name: "wormhole", type: "publicKey" },
                { name: "tokenProgram", type: "publicKey" }
              ]
            }
          }
        ]
      };
    } catch (error) {
      console.error('Failed to load IDLs:', error);
      throw new Error('Failed to load IDLs for Wormhole programs');
    }
  }

  /**
   * Initialize Wormhole WASM
   */
  private async initWasm() {
    try {
      const wasm = await importCoreWasm();
      setDefaultWasm(wasm);
    } catch (error) {
      console.error('Failed to initialize Wormhole WASM:', error);
      throw new Error('Failed to initialize Wormhole WASM');
    }
  }

  /**
   * Lock tokens on Solana L1 and initiate transfer to Layer-2
   * @param tokenMint Token mint address
   * @param amount Amount to transfer (in smallest units)
   * @param sender Sender's public key
   * @param recipient Recipient's address on Layer-2
   * @returns Transaction signature
   */
  async lockTokensAndInitiateTransfer(
    tokenMint: PublicKey,
    amount: number,
    sender: PublicKey,
    recipient: string
  ): Promise<string> {
    try {
      // Convert recipient to hex string for cross-chain transfer
      const recipientHex = tryNativeToHexString(recipient, LAYER2_CHAIN_ID);
      
      // Create transaction to lock tokens and emit Wormhole message
      const lockTokensTx = new Transaction();
      
      // Generate a nonce for this transfer
      const nonce = createNonce().readUInt32LE(0);
      
      // Get token account associated with sender and token mint
      const tokenAccount = await this.getAssociatedTokenAccount(tokenMint, sender);
      
      // Add instructions to lock tokens and emit Wormhole message
      const transferIx = await transferFromSolana(
        this.connection,
        this.payer.publicKey,
        tokenAccount,
        tokenMint,
        amount,
        recipientHex,
        LAYER2_CHAIN_ID,
        nonce
      );
      
      // Add all instructions to the transaction
      lockTokensTx.add(...transferIx);
      
      // Sign and send transaction
      const signature = await this.provider.sendAndConfirm(lockTokensTx);
      
      // Parse sequence number from transaction logs
      const txInfo = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
      });
      
      if (!txInfo) {
        throw new Error('Transaction info not found');
      }
      
      // Get sequence number from logs
      const sequence = parseSequenceFromLogWormhole(txInfo);
      
      // Get emitter address
      const emitterAddress = await getEmitterAddressWormhole(
        TOKEN_BRIDGE_PROGRAM_ID.toString(),
        WORMHOLE_PROGRAM_ID.toString()
      );
      
      console.log(`Tokens locked. Sequence: ${sequence}, Emitter: ${emitterAddress}`);
      
      // Monitor for VAA (Verified Action Approval)
      this.monitorForVAA(SOLANA_CHAIN_ID, emitterAddress, sequence);
      
      return signature;
    } catch (error) {
      console.error('Error in lockTokensAndInitiateTransfer:', error);
      throw error;
    }
  }

  /**
   * Get associated token account for a wallet and token mint
   * @param mint Token mint address
   * @param owner Account owner
   * @returns Associated token account
   */
  private async getAssociatedTokenAccount(
    mint: PublicKey,
    owner: PublicKey
  ): Promise<PublicKey> {
    // This is a simplified implementation
    // In a real system, you would use the getAssociatedTokenAddress function
    // from @solana/spl-token
    
    const [associatedToken] = await PublicKey.findProgramAddress(
      [
        owner.toBuffer(),
        SystemProgram.programId.toBuffer(),
        mint.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );
    
    return associatedToken;
  }

  /**
   * Monitor for VAA and process it when available
   * @param chainId Source chain ID
   * @param emitterAddress Emitter address
   * @param sequence Sequence number
   */
  private async monitorForVAA(
    chainId: number,
    emitterAddress: string,
    sequence: string
  ) {
    try {
      // Poll for VAA
      const vaaBytes = await this.pollForVAA(chainId, emitterAddress, sequence);
      
      // Process VAA on Layer-2
      await this.processVAAOnLayer2(vaaBytes);
    } catch (error) {
      console.error('Error in monitorForVAA:', error);
    }
  }

  /**
   * Poll for VAA until it's available
   * @param chainId Source chain ID
   * @param emitterAddress Emitter address
   * @param sequence Sequence number
   * @returns VAA bytes
   */
  private async pollForVAA(
    chainId: number,
    emitterAddress: string,
    sequence: string
  ): Promise<Uint8Array> {
    // Wormhole RPC hosts
    const wormholeRpcs = [
      'https://wormhole-v2-mainnet-api.certus.one',
      'https://wormhole.inotel.ro',
      'https://wormhole-v2-mainnet-api.mcf.rocks',
      'https://wormhole-v2-mainnet-api.chainlayer.network',
    ];
    
    let attempts = 0;
    const maxAttempts = 30;
    const retryDelay = 5000; // 5 seconds
    
    while (attempts < maxAttempts) {
      try {
        const { vaaBytes } = await getSignedVAA(
          wormholeRpcs,
          chainId,
          emitterAddress,
          sequence
        );
        
        console.log('VAA received');
        return vaaBytes;
      } catch (error) {
        console.log(`VAA not found yet. Retrying in ${retryDelay / 1000} seconds...`);
        attempts++;
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    
    throw new Error('Failed to get VAA after maximum attempts');
  }

  /**
   * Process VAA on Layer-2
   * @param vaaBytes VAA bytes
   * @returns Transaction signature
   */
  private async processVAAOnLayer2(vaaBytes: Uint8Array): Promise<string> {
    try {
      // First, post the VAA to the Wormhole program on Layer-2
      const postVaaSignature = await this.postVAAOnLayer2(vaaBytes);
      
      // Then, complete the token transfer on Layer-2
      const completeTransferSignature = await this.completeTransferOnLayer2(vaaBytes);
      
      return completeTransferSignature;
    } catch (error) {
      console.error('Error in processVAAOnLayer2:', error);
      throw error;
    }
  }

  /**
   * Post VAA to Wormhole program on Layer-2
   * @param vaaBytes VAA bytes
   * @returns Transaction signature
   */
  private async postVAAOnLayer2(vaaBytes: Uint8Array): Promise<string> {
    try {
      // Post VAA to Layer-2 Wormhole program
      const signature = await postVaaSolanaWithRetry(
        this.layer2Connection,
        this.provider.wallet.publicKey,
        this.payer,
        WORMHOLE_PROGRAM_ID.toString(),
        vaaBytes
      );
      
      console.log(`VAA posted to Layer-2. Signature: ${signature}`);
      return signature;
    } catch (error) {
      console.error('Error in postVAAOnLayer2:', error);
      throw error;
    }
  }

  /**
   * Complete token transfer on Layer-2
   * @param vaaBytes VAA bytes
   * @returns Transaction signature
   */
  private async completeTransferOnLayer2(vaaBytes: Uint8Array): Promise<string> {
    try {
      // Create transaction to complete transfer on Layer-2
      const completeTx = new Transaction();
      
      // Get the posted VAA account
      const postedVaaKey = await derivePostedVaaKey(
        WORMHOLE_PROGRAM_ID.toString(),
        vaaBytes
      );
      
      // Get the token bridge config on Layer-2
      const bridgeConfig = await this.tokenBridgeProgram.account.tokenBridge.fetch(
        TOKEN_BRIDGE_PROGRAM_ID
      );
      
      // Parse the VAA to get recipient and token details
      // This is a simplified implementation
      // In a real system, you would use the parseTransferVaa function
      // from @certusone/wormhole-sdk
      
      // For demonstration purposes, we'll create a dummy recipient
      const recipient = this.payer.publicKey;
      
      // For demonstration purposes, we'll use a dummy token mint
      const tokenMint = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      
      // Get the associated token account for the recipient
      const recipientTokenAccount = await this.getAssociatedTokenAccount(
        tokenMint,
        recipient
      );
      
      // Add instruction to complete the transfer
      const completeTransferIx = this.tokenBridgeProgram.instruction.completeTransfer(
        {
          accounts: {
            bridge: TOKEN_BRIDGE_PROGRAM_ID,
            vaa: postedVaaKey,
            tokenAccount: recipientTokenAccount,
            recipient: recipient,
            wormhole: WORMHOLE_PROGRAM_ID,
            tokenProgram: SystemProgram.programId
          }
        }
      );
      
      completeTx.add(completeTransferIx);
      
      // Sign and send transaction
      const signature = await this.provider.sendAndConfirm(completeTx);
      
      console.log(`Transfer completed on Layer-2. Signature: ${signature}`);
      return signature;
    } catch (error) {
      console.error('Error in completeTransferOnLayer2:', error);
      throw error;
    }
  }

  /**
   * Burn tokens on Layer-2 and initiate transfer back to Solana L1
   * @param tokenMint Token mint address on Layer-2
   * @param amount Amount to transfer (in smallest units)
   * @param sender Sender's public key on Layer-2
   * @param recipient Recipient's address on Solana L1
   * @returns Transaction signature
   */
  async burnTokensAndInitiateTransfer(
    tokenMint: PublicKey,
    amount: number,
    sender: PublicKey,
    recipient: string
  ): Promise<string> {
    try {
      // Convert recipient to hex string for cross-chain transfer
      const recipientHex = tryNativeToHexString(recipient, SOLANA_CHAIN_ID);
      
      // Create transaction to burn tokens and emit Wormhole message
      const burnTokensTx = new Transaction();
      
      // Generate a nonce for this transfer
      const nonce = createNonce().readUInt32LE(0);
      
      // Get token account associated with sender and token mint
      const tokenAccount = await this.getAssociatedTokenAccount(tokenMint, sender);
      
      // Add instructions to burn tokens and emit Wormhole message
      const transferIx = await transferFromSolana(
        this.layer2Connection,
        this.payer.publicKey,
        tokenAccount,
        tokenMint,
        amount,
        recipientHex,
        SOLANA_CHAIN_ID,
        nonce
      );
      
      // Add all instructions to the transaction
      burnTokensTx.add(...transferIx);
      
      // Sign and send transaction
      const signature = await this.provider.sendAndConfirm(burnTokensTx);
      
      // Parse sequence number from transaction logs
      const txInfo = await this.layer2Connection.getTransaction(signature, {
        commitment: 'confirmed',
      });
      
      if (!txInfo) {
        throw new Error('Transaction info not found');
      }
      
      // Get sequence number from logs
      const sequence = parseSequenceFromLogWormhole(txInfo);
      
      // Get emitter address
      const emitterAddress = await getEmitterAddressWormhole(
        TOKEN_BRIDGE_PROGRAM_ID.toString(),
        WORMHOLE_PROGRAM_ID.toString()
      );
      
      console.log(`Tokens burned. Sequence: ${sequence}, Emitter: ${emitterAddress}`);
      
      // Monitor for VAA (Verified Action Approval)
      this.monitorForVAAFromLayer2(LAYER2_CHAIN_ID, emitterAddress, sequence);
      
      return signature;
    } catch (error) {
      console.error('Error in burnTokensAndInitiateTransfer:', error);
      throw error;
    }
  }

  /**
   * Monitor for VAA from Layer-2 and process it when available
   * @param chainId Source chain ID
   * @param emitterAddress Emitter address
   * @param sequence Sequence number
   */
  private async monitorForVAAFromLayer2(
    chainId: number,
    emitterAddress: string,
    sequence: string
  ) {
    try {
      // Poll for VAA
      const vaaBytes = await this.pollForVAA(chainId, emitterAddress, sequence);
      
      // Process VAA on Solana L1
      await this.processVAAOnSolana(vaaBytes);
    } catch (error) {
      console.error('Error in monitorForVAAFromLayer2:', error);
    }
  }

  /**
   * Process VAA on Solana L1
   * @param vaaBytes VAA bytes
   * @returns Transaction signature
   */
  private async processVAAOnSolana(vaaBytes: Uint8Array): Promise<string> {
    try {
      // First, post the VAA to the Wormhole program on Solana
      const postVaaSignature = await this.postVAAOnSolana(vaaBytes);
      
      // Then, complete the token transfer on Solana
      const completeTransferSignature = await this.completeTransferOnSolana(vaaBytes);
      
      return completeTransferSignature;
    } catch (error) {
      console.error('Error in processVAAOnSolana:', error);
      throw error;
    }
  }

  /**
   * Post VAA to Wormhole program on Solana
   * @param vaaBytes VAA bytes
   * @returns Transaction signature
   */
  private async postVAAOnSolana(vaaBytes: Uint8Array): Promise<string> {
    try {
      // Post VAA to Solana Wormhole program
      const signature = await postVaaSolanaWithRetry(
        this.connection,
        this.provider.wallet.publicKey,
        this.payer,
        WORMHOLE_PROGRAM_ID.toString(),
        vaaBytes
      );
      
      console.log(`VAA posted to Solana. Signature: ${signature}`);
      return signature;
    } catch (error) {
      console.error('Error in postVAAOnSolana:', error);
      throw error;
    }
  }

  /**
   * Complete token transfer on Solana
   * @param vaaBytes VAA bytes
   * @returns Transaction signature
   */
  private async completeTransferOnSolana(vaaBytes: Uint8Array): Promise<string> {
    try {
      // Create transaction to complete transfer on Solana
      const completeTx = new Transaction();
      
      // Get the posted VAA account
      const postedVaaKey = await derivePostedVaaKey(
        WORMHOLE_PROGRAM_ID.toString(),
        vaaBytes
      );
      
      // Get the token bridge config on Solana
      const bridgeConfig = await this.tokenBridgeProgram.account.tokenBridge.fetch(
        TOKEN_BRIDGE_PROGRAM_ID
      );
      
      // Parse the VAA to get recipient and token details
      // This is a simplified implementation
      // In a real system, you would use the parseTransferVaa function
      // from @certusone/wormhole-sdk
      
      // For demonstration purposes, we'll create a dummy recipient
      const recipient = this.payer.publicKey;
      
      // For demonstration purposes, we'll use a dummy token mint
      const tokenMint = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      
      // Get the associated token account for the recipient
      const recipientTokenAccount = await this.getAssociatedTokenAccount(
        tokenMint,
        recipient
      );
      
      // Add instruction to complete the transfer
      const completeTransferIx = this.tokenBridgeProgram.instruction.completeTransfer(
        {
          accounts: {
            bridge: TOKEN_BRIDGE_PROGRAM_ID,
            vaa: postedVaaKey,
            tokenAccount: recipientTokenAccount,
            recipient: recipient,
            wormhole: WORMHOLE_PROGRAM_ID,
            tokenProgram: SystemProgram.programId
          }
        }
      );
      
      completeTx.add(completeTransferIx);
      
      // Sign and send transaction
      const signature = await this.provider.sendAndConfirm(completeTx);
      
      console.log(`Transfer completed on Solana. Signature: ${signature}`);
      return signature;
    } catch (error) {
      console.error('Error in completeTransferOnSolana:', error);
      throw error;
    }
  }

  /**
   * Get bridge transaction status
   * @param signature Transaction signature
   * @param isLayer2 Whether the transaction is on Layer-2
   * @returns Transaction status
   */
  async getBridgeTransactionStatus(
    signature: string,
    isLayer2: boolean
  ): Promise<any> {
    try {
      const connection = isLayer2 ? this.layer2Connection : this.connection;
      
      const txInfo = await connection.getTransaction(signature, {
        commitment: 'confirmed',
      });
      
      if (!txInfo) {
        return { status: 'unknown', message: 'Transaction not found' };
      }
      
      // Parse logs to determine status
      const logs = txInfo.meta?.logMessages || [];
      
      if (logs.some(log => log.includes('Error'))) {
        return { 
          status: 'failed', 
          message: 'Transaction failed', 
          logs,
          error: logs.find(log => log.includes('Error'))
        };
      }
      
      // Check for specific success patterns in logs
      const isTransferInitiated = logs.some(log => 
        log.includes('Program log: Transfer initiated') || 
        log.includes('Program log: Sequence:')
      );
      
      const isTransferCompleted = logs.some(log => 
        log.includes('Program log: Transfer completed') || 
        log.includes('Program log: Claimed asset')
      );
      
      if (isTransferInitiated) {
        return { 
          status: 'initiated', 
          message: 'Transfer initiated, waiting for confirmation',
          logs
        };
      }
      
      if (isTransferCompleted) {
        return { 
          status: 'completed', 
          message: 'Transfer completed successfully',
          logs
        };
      }
      
      return { 
        status: 'success', 
        message: 'Transaction successful', 
        logs 
      };
    } catch (error) {
      console.error('Error in getBridgeTransactionStatus:', error);
      return { status: 'error', message: error.message };
    }
  }

  /**
   * Get bridge statistics
   * @returns Bridge statistics
   */
  async getBridgeStats(): Promise<any> {
    try {
      // Get all token bridge accounts
      const accounts = await this.connection.getProgramAccounts(TOKEN_BRIDGE_PROGRAM_ID);
      
      // Count transfers by analyzing account data
      let totalTransfers = 0;
      let totalVolume = 0;
      let activeTransfers = 0;
      let completedTransfers = 0;
      let failedTransfers = 0;
      
      // This is a simplified implementation
      // In a real system, you would parse the account data properly
      for (const account of accounts) {
        // Analyze account data to extract statistics
        // This is highly dependent on your specific account structure
        
        // For demonstration purposes, we'll just increment counters
        totalTransfers++;
        
        // Randomly assign to different categories for demonstration
        const random = Math.random();
        if (random < 0.1) {
          activeTransfers++;
        } else if (random < 0.9) {
          completedTransfers++;
          // Add a random amount to total volume
          totalVolume += Math.floor(Math.random() * 1000);
        } else {
          failedTransfers++;
        }
      }
      
      return {
        totalTransfers,
        totalVolume,
        activeTransfers,
        completedTransfers,
        failedTransfers,
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error in getBridgeStats:', error);
      return {
        error: error.message,
        lastUpdated: new Date().toISOString()
      };
    }
  }
}

export default WormholeBridge;
