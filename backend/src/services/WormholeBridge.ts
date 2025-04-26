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
import * as AsyncLock from 'async-lock';

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
  private lock: AsyncLock; // Lock for concurrent operations
  private nonceRegistry: Map<string, number>; // Registry to prevent nonce reuse
  private connectionRetryConfig: ConnectionRetryConfig; // Configuration for connection retries
  private initialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;

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
    this.lock = new AsyncLock();
    this.nonceRegistry = new Map();
    
    // Default connection retry configuration
    this.connectionRetryConfig = {
      maxRetries: 5,
      initialDelayMs: 100,
      maxDelayMs: 5000,
      backoffFactor: 2,
      timeoutMs: 30000
    };
    
    // Initialize provider
    this.provider = new AnchorProvider(
      this.connection,
      new NodeWallet(this.payer),
      { commitment: 'confirmed' }
    );

    // Start initialization process
    this.initializationPromise = this.initialize();
  }

  /**
   * Initialize the bridge
   * This method loads IDLs and initializes Wormhole WASM
   */
  private async initialize(): Promise<void> {
    try {
      console.log('Initializing WormholeBridge...');
      
      // Load IDLs
      await this.loadIdls();

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
      await this.initWasm();
      
      this.initialized = true;
      console.log('WormholeBridge initialized successfully');
    } catch (error) {
      console.error('Failed to initialize WormholeBridge:', error);
      throw error;
    }
  }

  /**
   * Ensure the bridge is initialized before performing operations
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    if (this.initializationPromise) {
      await this.initializationPromise;
    } else {
      this.initializationPromise = this.initialize();
      await this.initializationPromise;
    }
  }

  /**
   * Load IDLs for Wormhole programs
   */
  private async loadIdls() {
    try {
      console.log('Loading IDLs for Wormhole programs...');
      
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
      
      console.log('IDLs loaded successfully');
    } catch (error) {
      console.error('Failed to load IDLs:', error);
      throw new Error(`Failed to load IDLs for Wormhole programs: ${error.message}`);
    }
  }

  /**
   * Initialize Wormhole WASM
   */
  private async initWasm() {
    try {
      console.log('Initializing Wormhole WASM...');
      const wasm = await importCoreWasm();
      setDefaultWasm(wasm);
      console.log('Wormhole WASM initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Wormhole WASM:', error);
      throw new Error(`Failed to initialize Wormhole WASM: ${error.message}`);
    }
  }

  /**
   * Execute with retry mechanism
   * @param operation Function to execute
   * @param operationName Name of the operation (for logging)
   * @returns Result of the operation
   */
  private async executeWithRetry<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    let retries = 0;
    let delay = this.connectionRetryConfig.initialDelayMs;
    let lastError: Error | null = null;

    while (retries <= this.connectionRetryConfig.maxRetries) {
      try {
        // Set a timeout for the operation
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Operation ${operationName} timed out after ${this.connectionRetryConfig.timeoutMs}ms`));
          }, this.connectionRetryConfig.timeoutMs);
        });

        // Execute the operation with timeout
        return await Promise.race([
          operation(),
          timeoutPromise
        ]);
      } catch (error) {
        lastError = error;
        retries++;
        
        if (retries > this.connectionRetryConfig.maxRetries) {
          console.error(`Failed to execute ${operationName} after ${retries} retries:`, error);
          break;
        }
        
        console.warn(`Error executing ${operationName} (retry ${retries}/${this.connectionRetryConfig.maxRetries}): ${error.message}`);
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * this.connectionRetryConfig.backoffFactor, this.connectionRetryConfig.maxDelayMs);
      }
    }

    throw new Error(`Failed to execute ${operationName} after ${retries} retries: ${lastError?.message}`);
  }

  /**
   * Generate a unique nonce for transactions
   * @returns Unique nonce
   */
  private async generateUniqueNonce(): Promise<number> {
    return this.lock.acquire('nonce', () => {
      // Create a nonce
      const nonce = createNonce().readUInt32LE(0);
      
      // Check if nonce is already in use
      if (this.nonceRegistry.has(nonce.toString())) {
        // If nonce is in use, recursively try again
        return this.generateUniqueNonce();
      }
      
      // Register the nonce
      this.nonceRegistry.set(nonce.toString(), Date.now());
      
      // Clean up old nonces (older than 1 hour)
      const now = Date.now();
      const expirationTime = 60 * 60 * 1000; // 1 hour
      
      for (const [nonceStr, timestamp] of this.nonceRegistry.entries()) {
        if (now - timestamp > expirationTime) {
          this.nonceRegistry.delete(nonceStr);
        }
      }
      
      return nonce;
    });
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
    // Validate inputs
    if (!tokenMint || !amount || amount <= 0 || !sender || !recipient) {
      throw new Error('Invalid input parameters for token transfer');
    }

    // Ensure bridge is initialized
    await this.ensureInitialized();

    try {
      return await this.executeWithRetry(async () => {
        console.log(`Initiating transfer of ${amount} tokens from ${sender.toString()} to ${recipient} on Layer-2`);
        
        // Convert recipient to hex string for cross-chain transfer
        const recipientHex = tryNativeToHexString(recipient, LAYER2_CHAIN_ID);
        if (!recipientHex) {
          throw new Error(`Failed to convert recipient address ${recipient} to hex string`);
        }
        
        // Create transaction to lock tokens and emit Wormhole message
        const lockTokensTx = new Transaction();
        
        // Generate a unique nonce for this transfer
        const nonce = await this.generateUniqueNonce();
        console.log(`Generated nonce: ${nonce}`);
        
        // Get token account associated with sender and token mint
        const tokenAccount = await this.getAssociatedTokenAccount(tokenMint, sender);
        console.log(`Using token account: ${tokenAccount.toString()}`);
        
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
        console.log('Sending lock tokens transaction...');
        const signature = await this.provider.sendAndConfirm(lockTokensTx);
        console.log(`Lock tokens transaction sent. Signature: ${signature}`);
        
        // Parse sequence number from transaction logs
        console.log('Getting transaction info...');
        const txInfo = await this.connection.getTransaction(signature, {
          commitment: 'confirmed',
        });
        
        if (!txInfo) {
          throw new Error('Transaction info not found');
        }
        
        // Get sequence number from logs
        const sequence = parseSequenceFromLogWormhole(txInfo);
        console.log(`Parsed sequence number: ${sequence}`);
        
        // Get emitter address
        const emitterAddress = await getEmitterAddressWormhole(
          TOKEN_BRIDGE_PROGRAM_ID.toString(),
          WORMHOLE_PROGRAM_ID.toString()
        );
        
        console.log(`Tokens locked. Sequence: ${sequence}, Emitter: ${emitterAddress}`);
        
        // Monitor for VAA (Verified Action Approval)
        this.monitorForVAA(SOLANA_CHAIN_ID, emitterAddress, sequence);
        
        return signature;
      }, 'lockTokensAndInitiateTransfer');
    } catch (error) {
      console.error('Error in lockTokensAndInitiateTransfer:', error);
      throw new Error(`Failed to lock tokens and initiate transfer: ${error.message}`);
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
    if (!mint || !owner) {
      throw new Error('Invalid mint or owner for associated token account');
    }

    try {
      return await this.executeWithRetry(async () => {
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
      }, 'getAssociatedTokenAccount');
    } catch (error) {
      console.error('Error in getAssociatedTokenAccount:', error);
      throw new Error(`Failed to get associated token account: ${error.message}`);
    }
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
    if (!chainId || !emitterAddress || !sequence) {
      console.error('Invalid parameters for monitorForVAA');
      return;
    }

    try {
      console.log(`Monitoring for VAA: chainId=${chainId}, emitter=${emitterAddress}, sequence=${sequence}`);
      
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
    if (!chainId || !emitterAddress || !sequence) {
      throw new Error('Invalid parameters for pollForVAA');
    }

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
        console.log(`Polling for VAA (attempt ${attempts + 1}/${maxAttempts})...`);
        
        // Try each RPC endpoint until one succeeds
        for (const rpc of wormholeRpcs) {
          try {
            const { vaaBytes } = await getSignedVAA(
              [rpc],
              chainId,
              emitterAddress,
              sequence
            );
            
            console.log('VAA received successfully');
            return vaaBytes;
          } catch (rpcError) {
            console.warn(`Failed to get VAA from ${rpc}: ${rpcError.message}`);
            // Continue to next RPC
          }
        }
        
        // If we get here, all RPCs failed
        console.log(`VAA not found yet. Retrying in ${retryDelay / 1000} seconds...`);
        attempts++;
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } catch (error) {
        console.error(`Error polling for VAA (attempt ${attempts + 1}/${maxAttempts}):`, error);
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
    if (!vaaBytes || vaaBytes.length === 0) {
      throw new Error('Invalid VAA bytes');
    }

    try {
      return await this.executeWithRetry(async () => {
        console.log('Processing VAA on Layer-2...');
        
        // First, post the VAA to the Wormhole program on Layer-2
        const postVaaSignature = await this.postVAAOnLayer2(vaaBytes);
        console.log(`VAA posted to Layer-2. Signature: ${postVaaSignature}`);
        
        // Then, complete the token transfer on Layer-2
        const completeTransferSignature = await this.completeTransferOnLayer2(vaaBytes);
        console.log(`Transfer completed on Layer-2. Signature: ${completeTransferSignature}`);
        
        return completeTransferSignature;
      }, 'processVAAOnLayer2');
    } catch (error) {
      console.error('Error in processVAAOnLayer2:', error);
      throw new Error(`Failed to process VAA on Layer-2: ${error.message}`);
    }
  }

  /**
   * Post VAA to Wormhole program on Layer-2
   * @param vaaBytes VAA bytes
   * @returns Transaction signature
   */
  private async postVAAOnLayer2(vaaBytes: Uint8Array): Promise<string> {
    if (!vaaBytes || vaaBytes.length === 0) {
      throw new Error('Invalid VAA bytes');
    }

    try {
      return await this.executeWithRetry(async () => {
        console.log('Posting VAA to Layer-2 Wormhole program...');
        
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
      }, 'postVAAOnLayer2');
    } catch (error) {
      console.error('Error in postVAAOnLayer2:', error);
      throw new Error(`Failed to post VAA to Layer-2: ${error.message}`);
    }
  }

  /**
   * Complete token transfer on Layer-2
   * @param vaaBytes VAA bytes
   * @returns Transaction signature
   */
  private async completeTransferOnLayer2(vaaBytes: Uint8Array): Promise<string> {
    if (!vaaBytes || vaaBytes.length === 0) {
      throw new Error('Invalid VAA bytes');
    }

    try {
      return await this.executeWithRetry(async () => {
        console.log('Completing token transfer on Layer-2...');
        
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
      }, 'completeTransferOnLayer2');
    } catch (error) {
      console.error('Error in completeTransferOnLayer2:', error);
      throw new Error(`Failed to complete transfer on Layer-2: ${error.message}`);
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
    // Validate inputs
    if (!tokenMint || !amount || amount <= 0 || !sender || !recipient) {
      throw new Error('Invalid input parameters for token transfer');
    }

    // Ensure bridge is initialized
    await this.ensureInitialized();

    try {
      return await this.executeWithRetry(async () => {
        console.log(`Initiating transfer of ${amount} tokens from ${sender.toString()} on Layer-2 to ${recipient} on Solana`);
        
        // Convert recipient to hex string for cross-chain transfer
        const recipientHex = tryNativeToHexString(recipient, SOLANA_CHAIN_ID);
        if (!recipientHex) {
          throw new Error(`Failed to convert recipient address ${recipient} to hex string`);
        }
        
        // Create transaction to burn tokens and emit Wormhole message
        const burnTokensTx = new Transaction();
        
        // Generate a unique nonce for this transfer
        const nonce = await this.generateUniqueNonce();
        console.log(`Generated nonce: ${nonce}`);
        
        // Get token account associated with sender and token mint
        const tokenAccount = await this.getAssociatedTokenAccount(tokenMint, sender);
        console.log(`Using token account: ${tokenAccount.toString()}`);
        
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
        console.log('Sending burn tokens transaction...');
        const signature = await this.provider.sendAndConfirm(burnTokensTx);
        console.log(`Burn tokens transaction sent. Signature: ${signature}`);
        
        // Parse sequence number from transaction logs
        console.log('Getting transaction info...');
        const txInfo = await this.layer2Connection.getTransaction(signature, {
          commitment: 'confirmed',
        });
        
        if (!txInfo) {
          throw new Error('Transaction info not found');
        }
        
        // Get sequence number from logs
        const sequence = parseSequenceFromLogWormhole(txInfo);
        console.log(`Parsed sequence number: ${sequence}`);
        
        // Get emitter address
        const emitterAddress = await getEmitterAddressWormhole(
          TOKEN_BRIDGE_PROGRAM_ID.toString(),
          WORMHOLE_PROGRAM_ID.toString()
        );
        
        console.log(`Tokens burned. Sequence: ${sequence}, Emitter: ${emitterAddress}`);
        
        // Monitor for VAA (Verified Action Approval)
        this.monitorForVAAFromLayer2(LAYER2_CHAIN_ID, emitterAddress, sequence);
        
        return signature;
      }, 'burnTokensAndInitiateTransfer');
    } catch (error) {
      console.error('Error in burnTokensAndInitiateTransfer:', error);
      throw new Error(`Failed to burn tokens and initiate transfer: ${error.message}`);
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
    if (!chainId || !emitterAddress || !sequence) {
      console.error('Invalid parameters for monitorForVAAFromLayer2');
      return;
    }

    try {
      console.log(`Monitoring for VAA from Layer-2: chainId=${chainId}, emitter=${emitterAddress}, sequence=${sequence}`);
      
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
    if (!vaaBytes || vaaBytes.length === 0) {
      throw new Error('Invalid VAA bytes');
    }

    try {
      return await this.executeWithRetry(async () => {
        console.log('Processing VAA on Solana L1...');
        
        // First, post the VAA to the Wormhole program on Solana
        const postVaaSignature = await this.postVAAOnSolana(vaaBytes);
        console.log(`VAA posted to Solana. Signature: ${postVaaSignature}`);
        
        // Then, complete the token transfer on Solana
        const completeTransferSignature = await this.completeTransferOnSolana(vaaBytes);
        console.log(`Transfer completed on Solana. Signature: ${completeTransferSignature}`);
        
        return completeTransferSignature;
      }, 'processVAAOnSolana');
    } catch (error) {
      console.error('Error in processVAAOnSolana:', error);
      throw new Error(`Failed to process VAA on Solana: ${error.message}`);
    }
  }

  /**
   * Post VAA to Wormhole program on Solana
   * @param vaaBytes VAA bytes
   * @returns Transaction signature
   */
  private async postVAAOnSolana(vaaBytes: Uint8Array): Promise<string> {
    if (!vaaBytes || vaaBytes.length === 0) {
      throw new Error('Invalid VAA bytes');
    }

    try {
      return await this.executeWithRetry(async () => {
        console.log('Posting VAA to Solana Wormhole program...');
        
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
      }, 'postVAAOnSolana');
    } catch (error) {
      console.error('Error in postVAAOnSolana:', error);
      throw new Error(`Failed to post VAA to Solana: ${error.message}`);
    }
  }

  /**
   * Complete token transfer on Solana
   * @param vaaBytes VAA bytes
   * @returns Transaction signature
   */
  private async completeTransferOnSolana(vaaBytes: Uint8Array): Promise<string> {
    if (!vaaBytes || vaaBytes.length === 0) {
      throw new Error('Invalid VAA bytes');
    }

    try {
      return await this.executeWithRetry(async () => {
        console.log('Completing token transfer on Solana...');
        
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
      }, 'completeTransferOnSolana');
    } catch (error) {
      console.error('Error in completeTransferOnSolana:', error);
      throw new Error(`Failed to complete transfer on Solana: ${error.message}`);
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
    isLayer2: boolean = false
  ): Promise<BridgeTransactionStatus> {
    if (!signature) {
      throw new Error('Transaction signature is required');
    }

    // Ensure bridge is initialized
    await this.ensureInitialized();

    try {
      return await this.executeWithRetry(async () => {
        console.log(`Getting status for transaction ${signature} on ${isLayer2 ? 'Layer-2' : 'Solana'}`);
        
        // Get the connection based on whether the transaction is on Layer-2
        const connection = isLayer2 ? this.layer2Connection : this.connection;
        
        // Get transaction info
        const txInfo = await connection.getTransaction(signature, {
          commitment: 'confirmed',
        });
        
        if (!txInfo) {
          return {
            signature,
            status: 'unknown',
            confirmations: 0,
            isLayer2,
          };
        }
        
        // Determine status based on confirmations
        let status: TransactionStatus = 'pending';
        const confirmations = txInfo.confirmations || 0;
        
        if (confirmations >= 32) {
          status = 'finalized';
        } else if (confirmations >= 1) {
          status = 'confirmed';
        }
        
        // Check if transaction was successful
        if (txInfo.meta?.err) {
          status = 'failed';
        }
        
        return {
          signature,
          status,
          confirmations,
          isLayer2,
          timestamp: txInfo.blockTime ? new Date(txInfo.blockTime * 1000).toISOString() : undefined,
          error: txInfo.meta?.err ? JSON.stringify(txInfo.meta.err) : undefined,
        };
      }, 'getBridgeTransactionStatus');
    } catch (error) {
      console.error('Error in getBridgeTransactionStatus:', error);
      return {
        signature,
        status: 'error',
        confirmations: 0,
        isLayer2,
        error: error.message,
      };
    }
  }

  /**
   * Check if the bridge is healthy
   * @returns Health status
   */
  async checkHealth(): Promise<BridgeHealthStatus> {
    try {
      return await this.executeWithRetry(async () => {
        console.log('Checking bridge health...');
        
        // Check Solana connection
        const solanaHealth = await this.checkConnectionHealth(this.connection, 'Solana');
        
        // Check Layer-2 connection
        const layer2Health = await this.checkConnectionHealth(this.layer2Connection, 'Layer-2');
        
        // Check Wormhole connection
        const wormholeHealth = await this.checkWormholeHealth();
        
        // Overall health is healthy only if all components are healthy
        const isHealthy = solanaHealth.isHealthy && layer2Health.isHealthy && wormholeHealth.isHealthy;
        
        return {
          isHealthy,
          components: {
            solana: solanaHealth,
            layer2: layer2Health,
            wormhole: wormholeHealth,
          },
          timestamp: new Date().toISOString(),
        };
      }, 'checkHealth');
    } catch (error) {
      console.error('Error in checkHealth:', error);
      return {
        isHealthy: false,
        components: {
          solana: { isHealthy: false, error: 'Failed to check Solana health' },
          layer2: { isHealthy: false, error: 'Failed to check Layer-2 health' },
          wormhole: { isHealthy: false, error: 'Failed to check Wormhole health' },
        },
        timestamp: new Date().toISOString(),
        error: error.message,
      };
    }
  }

  /**
   * Check connection health
   * @param connection Connection to check
   * @param name Connection name
   * @returns Connection health status
   */
  private async checkConnectionHealth(connection: Connection, name: string): Promise<ComponentHealth> {
    try {
      // Get the latest block height
      const blockHeight = await connection.getBlockHeight();
      
      // Get the latest block time
      const slot = await connection.getSlot();
      const blockTime = await connection.getBlockTime(slot);
      
      // Check if block time is recent (within last 5 minutes)
      const isRecent = blockTime && (Date.now() / 1000 - blockTime) < 300;
      
      return {
        isHealthy: isRecent,
        blockHeight,
        blockTime: blockTime ? new Date(blockTime * 1000).toISOString() : undefined,
        latency: 0, // Would measure actual latency in a real implementation
      };
    } catch (error) {
      console.error(`Error checking ${name} connection health:`, error);
      return {
        isHealthy: false,
        error: error.message,
      };
    }
  }

  /**
   * Check Wormhole health
   * @returns Wormhole health status
   */
  private async checkWormholeHealth(): Promise<ComponentHealth> {
    try {
      // Wormhole RPC hosts
      const wormholeRpcs = [
        'https://wormhole-v2-mainnet-api.certus.one',
        'https://wormhole.inotel.ro',
        'https://wormhole-v2-mainnet-api.mcf.rocks',
        'https://wormhole-v2-mainnet-api.chainlayer.network',
      ];
      
      // Check if at least one RPC is responsive
      let isHealthy = false;
      let error = 'All Wormhole RPCs are unreachable';
      
      for (const rpc of wormholeRpcs) {
        try {
          // Make a simple request to check if RPC is responsive
          const response = await fetch(`${rpc}/v1/guardianset/current`);
          
          if (response.ok) {
            isHealthy = true;
            error = undefined;
            break;
          }
        } catch (rpcError) {
          // Continue to next RPC
        }
      }
      
      return {
        isHealthy,
        error,
      };
    } catch (error) {
      console.error('Error checking Wormhole health:', error);
      return {
        isHealthy: false,
        error: error.message,
      };
    }
  }
}

/**
 * Connection retry configuration
 */
interface ConnectionRetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  timeoutMs: number;
}

/**
 * Transaction status
 */
type TransactionStatus = 'pending' | 'confirmed' | 'finalized' | 'failed' | 'unknown' | 'error';

/**
 * Bridge transaction status
 */
interface BridgeTransactionStatus {
  signature: string;
  status: TransactionStatus;
  confirmations: number;
  isLayer2: boolean;
  timestamp?: string;
  error?: string;
}

/**
 * Component health status
 */
interface ComponentHealth {
  isHealthy: boolean;
  blockHeight?: number;
  blockTime?: string;
  latency?: number;
  error?: string;
}

/**
 * Bridge health status
 */
interface BridgeHealthStatus {
  isHealthy: boolean;
  components: {
    solana: ComponentHealth;
    layer2: ComponentHealth;
    wormhole: ComponentHealth;
  };
  timestamp: string;
  error?: string;
}

export default WormholeBridge;
