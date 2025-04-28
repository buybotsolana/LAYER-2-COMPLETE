/**
 * Example: NFT Operations
 */
import { Layer2Client } from '../src';
import { NFTClient } from '../src/nft';

const layer2Client = new Layer2Client({
  rpcUrl: 'https://api.devnet.solana.com',
  keypair: loadKeypair() // Your implementation to load a keypair
});

const bridgeClient = layer2Client.bridge;
const nftClient = new NFTClient(layer2Client, bridgeClient);

async function createCollection() {
  const collection = await nftClient.createCollection({
    name: 'My NFT Collection',
    symbol: 'MNFT',
    ethereumAddress: '0x1234567890123456789012345678901234567890' // Optional
  });
  
  console.log(`Collection created with address: ${collection.address}`);
  return collection;
}

async function mintNFT(collection) {
  const nft = await nftClient.mintNFT({
    collection: collection.address,
    recipient: 'recipient_solana_address',
    metadataUri: 'https://example.com/metadata/1',
    tokenId: '1' // Optional, will be auto-generated if not provided
  });
  
  console.log(`NFT minted with ID: ${nft.id}`);
  return nft;
}

async function transferNFT(nft) {
  const transferSignature = await nftClient.transferNFT({
    nft: nft.id,
    recipient: 'new_owner_solana_address'
  });
  
  console.log(`NFT transferred with signature: ${transferSignature}`);
  return transferSignature;
}

async function bridgeNFT(nft) {
  const bridgeSignature = await nftClient.bridgeNFT({
    nft: nft.id,
    destinationChain: 'ethereum',
    recipient: '0xabcdef1234567890abcdef1234567890abcdef12'
  });
  
  console.log(`NFT bridging initiated with signature: ${bridgeSignature}`);
  return bridgeSignature;
}

async function executeNFTOperations() {
  try {
    console.log('Creating NFT collection...');
    const collection = await createCollection();
    
    console.log('Minting NFT...');
    const nft = await mintNFT(collection);
    
    console.log('Transferring NFT...');
    await transferNFT(nft);
    
    console.log('Bridging NFT to Ethereum...');
    await bridgeNFT(nft);
    
    console.log('NFT operations completed successfully');
  } catch (error) {
    console.error('NFT operation failed:', error);
  }
}

executeNFTOperations();