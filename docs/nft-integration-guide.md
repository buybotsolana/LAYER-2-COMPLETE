# NFT Integration Guide for Solana Layer 2

This guide provides comprehensive documentation for integrating NFT functionality with the Solana Layer 2 system. It covers collection initialization, minting, transferring, and burning NFTs, as well as cross-chain bridging between Ethereum and Solana.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Getting Started](#getting-started)
4. [SDK Usage](#sdk-usage)
5. [Solana Program Interface](#solana-program-interface)
6. [Ethereum Contract Interface](#ethereum-contract-interface)
7. [Cross-Chain Bridging](#cross-chain-bridging)
8. [Security Considerations](#security-considerations)
9. [Performance Optimization](#performance-optimization)
10. [Troubleshooting](#troubleshooting)

## Overview

The Solana Layer 2 NFT system enables:

- Creation and management of NFT collections
- Minting NFTs with metadata
- Transferring NFTs between accounts
- Burning NFTs for cross-chain withdrawals
- Bridging NFTs between Ethereum and Solana

The system is designed for high throughput, low latency, and secure cross-chain operations with quantum-resistant signature verification.

## Architecture

The NFT system consists of the following components:

1. **Solana NFT Mint Program**: Handles on-chain NFT operations on Solana Layer 2
2. **Ethereum NFT Vault Contract**: Manages NFT deposits and withdrawals on Ethereum
3. **NFT Relayer**: Monitors events on both chains and facilitates cross-chain transfers
4. **TypeScript SDK**: Provides a high-level interface for developers

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Solana Layer 2 │     │   NFT Relayer   │     │     Ethereum    │
│                 │     │                 │     │                 │
│  ┌───────────┐  │     │  ┌───────────┐  │     │  ┌───────────┐  │
│  │ NFT Mint  │◄─┼─────┼──┤ Event     │◄─┼─────┼──┤ NFT Vault │  │
│  │ Program   │  │     │  │ Processor │  │     │  │ Contract  │  │
│  └───────────┘  │     │  └───────────┘  │     │  └───────────┘  │
│        ▲        │     │        ▲        │     │        ▲        │
└────────┼────────┘     └────────┼────────┘     └────────┼────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                        TypeScript SDK                           │
└─────────────────────────────────────────────────────────────────┘
                                 ▲
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        dApp Integration                         │
└─────────────────────────────────────────────────────────────────┘
```

## Getting Started

### Prerequisites

- Solana Layer 2 SDK installed
- Ethereum Web3 provider
- Private keys for both chains

### Installation

```bash
npm install @solana-layer2/sdk
```

### Configuration

```typescript
import { Layer2Client, BridgeClient, NFTClient } from '@solana-layer2/sdk';

// Initialize Layer 2 client
const layer2Client = new Layer2Client({
  rpcUrl: 'https://api.layer2.solana.com',
  privateKey: 'your_solana_private_key'
});

// Initialize Bridge client
const bridgeClient = new BridgeClient({
  ethereumRpcUrl: 'https://mainnet.infura.io/v3/your_infura_key',
  ethereumPrivateKey: 'your_ethereum_private_key',
  layer2Client
});

// Initialize NFT client
const nftClient = new NFTClient(layer2Client, bridgeClient, {
  nftMintProgramId: 'NFTMint11111111111111111111111111111111111111',
  enableMetrics: true
});
```

## SDK Usage

### Creating an NFT Collection

```typescript
// Initialize a new NFT collection
const collection = await nftClient.createCollection({
  name: 'My NFT Collection',
  symbol: 'MNFT',
  ethereumAddress: '0x1234567890123456789012345678901234567890' // Optional
});

console.log(`Collection created with address: ${collection.address}`);
```

### Minting an NFT

```typescript
// Mint a new NFT
const nft = await nftClient.mintNFT({
  collection: collection.address,
  recipient: 'recipient_solana_address',
  metadataUri: 'https://example.com/metadata/1',
  tokenId: '1' // Optional, will be auto-generated if not provided
});

console.log(`NFT minted with ID: ${nft.id}`);
```

### Transferring an NFT

```typescript
// Transfer an NFT to another account
const transferSignature = await nftClient.transferNFT({
  nft: nft.id,
  recipient: 'new_owner_solana_address'
});

console.log(`NFT transferred with signature: ${transferSignature}`);
```

### Burning an NFT

```typescript
// Burn an NFT
const burnSignature = await nftClient.burnNFT({
  nft: nft.id,
  ethereumRecipient: '0xabcdef1234567890abcdef1234567890abcdef12' // Optional, for cross-chain withdrawals
});

console.log(`NFT burned with signature: ${burnSignature}`);
```

### Bridging an NFT

```typescript
// Bridge an NFT from Solana to Ethereum
const bridgeSignature = await nftClient.bridgeNFT({
  nft: nft.id,
  destinationChain: 'ethereum',
  recipient: '0xabcdef1234567890abcdef1234567890abcdef12'
});

console.log(`NFT bridging initiated with signature: ${bridgeSignature}`);
```

## Solana Program Interface

The Solana NFT Mint Program exposes the following instructions:

### Initialize NFT Collection

```rust
/// Initialize a new NFT collection
///
/// Accounts:
/// 0. `[signer]` Initializer account
/// 1. `[writable]` Collection state account
/// 2. `[]` Authority account
/// 3. `[]` Rent sysvar
///
/// Data:
/// - Ethereum collection address (20 bytes)
/// - Name length (1 byte)
/// - Name (variable)
/// - Symbol length (1 byte)
/// - Symbol (variable)
pub fn initialize_nft_collection(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    ethereum_collection_address: [u8; 20],
    name: String,
    symbol: String,
) -> ProgramResult;
```

### Mint NFT

```rust
/// Mint a new NFT
///
/// Accounts:
/// 0. `[signer]` Authority account
/// 1. `[]` Collection state account
/// 2. `[writable]` Metadata account
/// 3. `[writable]` Mint account
/// 4. `[writable]` Destination token account
/// 5. `[]` Token program
/// 6. `[]` Rent sysvar
///
/// Data:
/// - Token ID (8 bytes)
/// - Metadata URI length (1 byte)
/// - Metadata URI (variable)
/// - Ethereum transaction hash (32 bytes, optional)
/// - Nonce (8 bytes, optional)
pub fn mint_nft(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: u64,
    metadata_uri: String,
    ethereum_tx_hash: Option<[u8; 32]>,
    nonce: Option<u64>,
) -> ProgramResult;
```

### Transfer NFT

```rust
/// Transfer an NFT to a new owner
///
/// Accounts:
/// 0. `[signer]` Owner account
/// 1. `[]` Metadata account
/// 2. `[writable]` Source token account
/// 3. `[writable]` Destination token account
/// 4. `[]` Token program
///
/// Data:
/// - Token ID (8 bytes)
pub fn transfer_nft(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: u64,
) -> ProgramResult;
```

### Burn NFT

```rust
/// Burn an NFT
///
/// Accounts:
/// 0. `[signer]` Owner account
/// 1. `[writable]` Metadata account
/// 2. `[writable]` Mint account
/// 3. `[writable]` Token account
/// 4. `[]` Token program
///
/// Data:
/// - Token ID (8 bytes)
/// - Ethereum recipient (20 bytes, optional)
pub fn burn_nft(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: u64,
    ethereum_recipient: Option<[u8; 20]>,
) -> ProgramResult;
```

## Ethereum Contract Interface

The Ethereum NFT Vault Contract exposes the following functions:

### Deposit NFT

```solidity
/**
 * @notice Deposit an NFT to the bridge
 * @param collection The address of the NFT collection
 * @param tokenId The ID of the NFT
 * @param solanaRecipient The Solana recipient address
 * @return nonce The unique nonce for this deposit
 */
function depositNFT(
    address collection,
    uint256 tokenId,
    bytes32 solanaRecipient
) external returns (uint256 nonce);
```

### Withdraw NFT

```solidity
/**
 * @notice Withdraw an NFT from the bridge
 * @param collection The address of the NFT collection
 * @param tokenId The ID of the NFT
 * @param recipient The recipient address
 * @param signature The signature from the validator
 * @param nonce The unique nonce for this withdrawal
 */
function withdrawNFT(
    address collection,
    uint256 tokenId,
    address recipient,
    bytes memory signature,
    uint256 nonce
) external;
```

### Emergency Withdraw

```solidity
/**
 * @notice Emergency withdraw an NFT
 * @param collection The address of the NFT collection
 * @param tokenId The ID of the NFT
 */
function emergencyWithdraw(
    address collection,
    uint256 tokenId
) external;
```

## Cross-Chain Bridging

### Solana to Ethereum

1. User burns NFT on Solana Layer 2 with Ethereum recipient
2. NFT Relayer monitors burn events
3. Relayer submits withdrawal proof to Ethereum
4. NFT is released to recipient on Ethereum

### Ethereum to Solana

1. User deposits NFT to NFT Vault on Ethereum
2. NFT Relayer monitors deposit events
3. Relayer mints equivalent NFT on Solana Layer 2
4. NFT is available to recipient on Solana

## Security Considerations

### Replay Attack Prevention

The system uses unique nonces for each transaction to prevent replay attacks:

```typescript
// Example of nonce generation
const nonce = crypto.randomBytes(8).readUInt64LE(0);
```

### Double-Spending Prevention

NFTs are locked in the vault contract on the source chain until they are withdrawn on the destination chain:

```solidity
// Check if NFT is already deposited
require(!isDeposited[collection][tokenId], "NFT already deposited");
```

### Quantum-Resistant Signatures

The system uses post-quantum cryptography for signature verification:

```typescript
// Example of quantum-resistant signature verification
const isValid = await quantumVerifier.verify(
  message,
  signature,
  publicKey
);
```

## Performance Optimization

### Batch Processing

For improved performance, batch multiple NFT operations:

```typescript
// Batch mint multiple NFTs
const batchResults = await nftClient.batchMintNFTs([
  {
    collection: collection.address,
    recipient: 'recipient1_solana_address',
    metadataUri: 'https://example.com/metadata/1'
  },
  {
    collection: collection.address,
    recipient: 'recipient2_solana_address',
    metadataUri: 'https://example.com/metadata/2'
  }
]);
```

### Sharding

The system uses sharding to distribute NFT operations across multiple validators:

```typescript
// Example of sharded NFT collection access
const shardId = tokenId % NUM_SHARDS;
const shardedCollection = `${collection.address}-${shardId}`;
```

## Troubleshooting

### Common Issues

1. **InvalidAccountData Error**: Ensure proper serialization/deserialization of NFT data structures
2. **Insufficient Balance**: Check if the account has enough SOL for transaction fees
3. **Unauthorized Access**: Verify that the signer is the owner or authority
4. **Bridge Timeout**: Check the relayer status and network conditions

### Debugging

Enable verbose logging for troubleshooting:

```typescript
// Enable debug logging
nftClient.setLogLevel('debug');

// Check relayer status
const relayerStatus = await nftClient.getRelayerStatus();
console.log(relayerStatus);
```

## Sequence Diagrams

### NFT Minting Process

```
┌─────────┐          ┌─────────────┐          ┌──────────────┐
│   dApp  │          │  NFT Client │          │  NFT Program │
└────┬────┘          └──────┬──────┘          └──────┬───────┘
     │                      │                        │
     │ mintNFT()            │                        │
     │─────────────────────>│                        │
     │                      │                        │
     │                      │ Create Mint Account    │
     │                      │───────────────────────>│
     │                      │                        │
     │                      │ Initialize Mint        │
     │                      │───────────────────────>│
     │                      │                        │
     │                      │ Create Metadata        │
     │                      │───────────────────────>│
     │                      │                        │
     │                      │ Create Token Account   │
     │                      │───────────────────────>│
     │                      │                        │
     │                      │ Mint Token             │
     │                      │───────────────────────>│
     │                      │                        │
     │                      │ Update Metadata        │
     │                      │───────────────────────>│
     │                      │                        │
     │                      │ Return Success         │
     │                      │<───────────────────────│
     │                      │                        │
     │ Return NFT Details   │                        │
     │<─────────────────────│                        │
     │                      │                        │
```

### Cross-Chain NFT Bridge Process

```
┌─────────┐     ┌─────────────┐     ┌────────────┐     ┌──────────────┐     ┌───────────┐
│   dApp  │     │  NFT Client │     │ NFT Relayer│     │  NFT Program │     │ NFT Vault │
└────┬────┘     └──────┬──────┘     └─────┬──────┘     └──────┬───────┘     └─────┬─────┘
     │                 │                   │                   │                   │
     │ bridgeNFT()     │                   │                   │                   │
     │────────────────>│                   │                   │                   │
     │                 │                   │                   │                   │
     │                 │ Burn NFT          │                   │                   │
     │                 │──────────────────────────────────────>│                   │
     │                 │                   │                   │                   │
     │                 │ Return Signature  │                   │                   │
     │                 │<──────────────────────────────────────│                   │
     │                 │                   │                   │                   │
     │ Return Signature│                   │                   │                   │
     │<────────────────│                   │                   │                   │
     │                 │                   │                   │                   │
     │                 │                   │ Monitor Burn Event│                   │
     │                 │                   │<──────────────────│                   │
     │                 │                   │                   │                   │
     │                 │                   │ Generate Proof    │                   │
     │                 │                   │─────────────────────────────────────>│
     │                 │                   │                   │                   │
     │                 │                   │ Withdraw NFT      │                   │
     │                 │                   │─────────────────────────────────────>│
     │                 │                   │                   │                   │
     │                 │                   │ Return Success    │                   │
     │                 │                   │<─────────────────────────────────────│
     │                 │                   │                   │                   │
```

## Conclusion

This guide provides a comprehensive overview of the NFT functionality in the Solana Layer 2 system. By following these instructions, developers can integrate NFT capabilities into their applications, enabling secure and efficient cross-chain NFT operations.

For additional support, please refer to the API reference documentation or contact the development team.
