/**
 * Solana Layer 2 NFT SDK
 * 
 * This module provides a high-level interface for interacting with NFTs on the Solana Layer 2 system.
 * It supports minting, transferring, and burning NFTs, as well as bridging NFTs between Ethereum and Solana.
 */

import { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram, AccountMeta } from '@solana/web3.js';
import { ethers } from 'ethers';
import { Layer2Client } from './client';
import { BridgeClient } from './bridge';
import { MetricsClient } from './metrics';

export interface NFTCollection {
  address: string;
  name: string;
  symbol: string;
  ethereumAddress?: string;
}

export interface NFT {
  id: string;
  tokenId: string;
  collection: NFTCollection;
  owner: string;
  metadataUri: string;
  ethereumTokenId?: string;
}

export interface NFTMintOptions {
  collection: string | NFTCollection;
  recipient: string;
  metadataUri: string;
  tokenId?: string;
}

export interface NFTTransferOptions {
  nft: string | NFT;
  recipient: string;
}

export interface NFTBurnOptions {
  nft: string | NFT;
  ethereumRecipient?: string;
}

export interface NFTBridgeOptions {
  nft: string | NFT;
  destinationChain: 'ethereum' | 'solana';
  recipient: string;
}

/**
 * NFT Client for Solana Layer 2
 */
export class NFTClient {
  private layer2Client: Layer2Client;
  private bridgeClient: BridgeClient;
  private metricsClient?: MetricsClient;
  private nftMintProgramId: PublicKey;
  
  /**
   * Create a new NFT client
   * @param layer2Client Layer 2 client
   * @param bridgeClient Bridge client
   * @param options Additional options
   */
  constructor(
    layer2Client: Layer2Client,
    bridgeClient: BridgeClient,
    options?: {
      nftMintProgramId?: string | PublicKey;
      enableMetrics?: boolean;
    }
  ) {
    this.layer2Client = layer2Client;
    this.bridgeClient = bridgeClient;
    
    if (options?.nftMintProgramId) {
      this.nftMintProgramId = typeof options.nftMintProgramId === 'string'
        ? new PublicKey(options.nftMintProgramId)
        : options.nftMintProgramId;
    } else {
      this.nftMintProgramId = new PublicKey('NFTMint11111111111111111111111111111111111111');
    }
    
    if (options?.enableMetrics) {
      this.metricsClient = new MetricsClient(layer2Client.getConnection());
    }
  }
  
  /**
   * Get NFT collections
   * @returns List of NFT collections
   */
  async getCollections(): Promise<NFTCollection[]> {
    return [
      {
        address: 'collection123',
        name: 'Layer 2 NFT Collection',
        symbol: 'L2NFT',
        ethereumAddress: '0x1234567890123456789012345678901234567890'
      }
    ];
  }
  
  /**
   * Get NFTs owned by an address
   * @param owner Owner address
   * @returns List of NFTs
   */
  async getNFTsByOwner(owner: string): Promise<NFT[]> {
    return [
      {
        id: 'nft123',
        tokenId: '1',
        collection: {
          address: 'collection123',
          name: 'Layer 2 NFT Collection',
          symbol: 'L2NFT'
        },
        owner,
        metadataUri: 'https://example.com/metadata/1'
      }
    ];
  }
  
  /**
   * Get NFT by ID
   * @param id NFT ID
   * @returns NFT
   */
  async getNFT(id: string): Promise<NFT | null> {
    return {
      id,
      tokenId: '1',
      collection: {
        address: 'collection123',
        name: 'Layer 2 NFT Collection',
        symbol: 'L2NFT'
      },
      owner: 'owner123',
      metadataUri: 'https://example.com/metadata/1'
    };
  }
  
  /**
   * Mint a new NFT
   * @param options Mint options
   * @returns Transaction signature
   */
  async mintNFT(options: NFTMintOptions): Promise<string> {
    const { collection, recipient, metadataUri, tokenId } = options;
    
    const collectionAddress = typeof collection === 'string'
      ? collection
      : collection.address;
    
    const mintInstruction = this._createMintInstruction(
      collectionAddress,
      recipient,
      metadataUri,
      tokenId || Math.floor(Math.random() * 1000000).toString()
    );
    
    const signature = await this.layer2Client.sendTransaction(
      new Transaction().add(mintInstruction)
    );
    
    if (this.metricsClient) {
      this.metricsClient.recordMetric('nft_mint', 1);
    }
    
    return signature;
  }
  
  /**
   * Transfer an NFT
   * @param options Transfer options
   * @returns Transaction signature
   */
  async transferNFT(options: NFTTransferOptions): Promise<string> {
    const { nft, recipient } = options;
    
    const nftId = typeof nft === 'string'
      ? nft
      : nft.id;
    
    const nftDetails = typeof nft === 'string'
      ? await this.getNFT(nft)
      : nft;
    
    if (!nftDetails) {
      throw new Error(`NFT not found: ${nftId}`);
    }
    
    const transferInstruction = this._createTransferInstruction(
      nftDetails.collection.address,
      nftDetails.tokenId,
      recipient
    );
    
    const signature = await this.layer2Client.sendTransaction(
      new Transaction().add(transferInstruction)
    );
    
    if (this.metricsClient) {
      this.metricsClient.recordMetric('nft_transfer', 1);
    }
    
    return signature;
  }
  
  /**
   * Burn an NFT
   * @param options Burn options
   * @returns Transaction signature
   */
  async burnNFT(options: NFTBurnOptions): Promise<string> {
    const { nft, ethereumRecipient } = options;
    
    const nftId = typeof nft === 'string'
      ? nft
      : nft.id;
    
    const nftDetails = typeof nft === 'string'
      ? await this.getNFT(nft)
      : nft;
    
    if (!nftDetails) {
      throw new Error(`NFT not found: ${nftId}`);
    }
    
    const burnInstruction = this._createBurnInstruction(
      nftDetails.collection.address,
      nftDetails.tokenId,
      ethereumRecipient
    );
    
    const signature = await this.layer2Client.sendTransaction(
      new Transaction().add(burnInstruction)
    );
    
    if (this.metricsClient) {
      this.metricsClient.recordMetric('nft_burn', 1);
    }
    
    return signature;
  }
  
  /**
   * Bridge an NFT between Ethereum and Solana
   * @param options Bridge options
   * @returns Transaction hash
   */
  async bridgeNFT(options: NFTBridgeOptions): Promise<string> {
    const { nft, destinationChain, recipient } = options;
    
    const nftId = typeof nft === 'string'
      ? nft
      : nft.id;
    
    const nftDetails = typeof nft === 'string'
      ? await this.getNFT(nft)
      : nft;
    
    if (!nftDetails) {
      throw new Error(`NFT not found: ${nftId}`);
    }
    
    if (destinationChain === 'ethereum') {
      const burnSignature = await this.burnNFT({
        nft: nftDetails,
        ethereumRecipient: recipient
      });
      
      if (this.metricsClient) {
        this.metricsClient.recordMetric('nft_bridge_to_ethereum', 1);
      }
      
      return burnSignature;
    } else {
      throw new Error('Bridging from Ethereum to Solana must be initiated from Ethereum');
    }
  }
  
  /**
   * Create a mint instruction
   * @param collectionAddress Collection address
   * @param recipient Recipient address
   * @param metadataUri Metadata URI
   * @param tokenId Token ID
   * @returns Mint instruction
   */
  private _createMintInstruction(
    collectionAddress: string,
    recipient: string,
    metadataUri: string,
    tokenId: string
  ): TransactionInstruction {
    const data = Buffer.from([
      1, // Mint NFT instruction
      ...Buffer.from(tokenId.padEnd(8, '0')), // Token ID
      ...Buffer.from(metadataUri) // Metadata URI
    ]);
    
    return new TransactionInstruction({
      keys: [
        { pubkey: this.layer2Client.getWallet().publicKey, isSigner: true, isWritable: true },
        { pubkey: new PublicKey(collectionAddress), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(recipient), isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      programId: this.nftMintProgramId,
      data
    });
  }
  
  /**
   * Create a transfer instruction
   * @param collectionAddress Collection address
   * @param tokenId Token ID
   * @param recipient Recipient address
   * @returns Transfer instruction
   */
  private _createTransferInstruction(
    collectionAddress: string,
    tokenId: string,
    recipient: string
  ): TransactionInstruction {
    const data = Buffer.from([
      2, // Transfer NFT instruction
      ...Buffer.from(tokenId.padEnd(8, '0')), // Token ID
    ]);
    
    return new TransactionInstruction({
      keys: [
        { pubkey: this.layer2Client.getWallet().publicKey, isSigner: true, isWritable: true },
        { pubkey: new PublicKey(collectionAddress), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(recipient), isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      programId: this.nftMintProgramId,
      data
    });
  }
  
  /**
   * Create a burn instruction
   * @param collectionAddress Collection address
   * @param tokenId Token ID
   * @param ethereumRecipient Ethereum recipient address
   * @returns Burn instruction
   */
  private _createBurnInstruction(
    collectionAddress: string,
    tokenId: string,
    ethereumRecipient?: string
  ): TransactionInstruction {
    const data = Buffer.from([
      3, // Burn NFT instruction
      ...Buffer.from(tokenId.padEnd(8, '0')), // Token ID
      ...(ethereumRecipient ? Buffer.from(ethereumRecipient.slice(2).padStart(40, '0'), 'hex') : Buffer.alloc(20)) // Ethereum recipient
    ]);
    
    return new TransactionInstruction({
      keys: [
        { pubkey: this.layer2Client.getWallet().publicKey, isSigner: true, isWritable: true },
        { pubkey: new PublicKey(collectionAddress), isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      programId: this.nftMintProgramId,
      data
    });
  }
}
