// English comment for verification
/**
 * @file WormholeConfig.ts
 * @description Configuration interface and utilities for Wormhole integration
 * @author Manus AI
 * @date April 27, 2025
 */

import { ChainId, CHAIN_ID_ETH, CHAIN_ID_SOLANA } from '@certusone/wormhole-sdk';

/**
 * Configuration interface for Wormhole integration
 */
export interface WormholeConfig {
  // Ethereum configuration
  ethereum: {
    rpc: string;
    privateKey: string;
    bridgeAddress: string;
    tokenBridgeAddress: string;
    confirmations: number;
    gasMultiplier: number;
    maxGasPrice: string;
  };
  
  // Solana configuration
  solana: {
    rpc: string;
    privateKey: string;
    bridgeAddress: string;
    tokenBridgeAddress: string;
    confirmations: number;
    commitment: 'processed' | 'confirmed' | 'finalized';
  };
  
  // Wormhole configuration
  wormhole: {
    rpc: string;
    guardianSetIndex: number;
  };
  
  // Relayer configuration
  relayer: {
    pollingInterval: number;
    maxRetries: number;
    retryDelay: number;
    maxConcurrentTransactions: number;
    batchSize: number;
  };
  
  // Monitoring configuration
  monitoring: {
    metricsEnabled: boolean;
    alertThresholds: {
      processingTime: number;
      errorRate: number;
      pendingTransactions: number;
    };
  };
}

/**
 * Default configuration for Wormhole integration
 */
export const DEFAULT_WORMHOLE_CONFIG: WormholeConfig = {
  ethereum: {
    rpc: 'https://mainnet.infura.io/v3/your-infura-key',
    privateKey: '',
    bridgeAddress: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B',
    tokenBridgeAddress: '0x3ee18B2214AFF97000D974cf647E7C347E8fa585',
    confirmations: 15,
    gasMultiplier: 1.2,
    maxGasPrice: '500000000000',
  },
  
  solana: {
    rpc: 'https://api.mainnet-beta.solana.com',
    privateKey: '',
    bridgeAddress: 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth',
    tokenBridgeAddress: 'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb',
    confirmations: 32,
    commitment: 'finalized',
  },
  
  wormhole: {
    rpc: 'https://wormhole-v2-mainnet-api.certus.one',
    guardianSetIndex: 2,
  },
  
  relayer: {
    pollingInterval: 15000, // 15 seconds
    maxRetries: 5,
    retryDelay: 10000, // 10 seconds
    maxConcurrentTransactions: 10,
    batchSize: 20,
  },
  
  monitoring: {
    metricsEnabled: true,
    alertThresholds: {
      processingTime: 60000, // 60 seconds
      errorRate: 0.1, // 10%
      pendingTransactions: 100,
    },
  },
};

/**
 * Get chain name from chain ID
 * 
 * @param chainId - The chain ID
 * @returns The chain name
 */
export function getChainName(chainId: ChainId): string {
  switch (chainId) {
    case CHAIN_ID_ETH:
      return 'Ethereum';
    case CHAIN_ID_SOLANA:
      return 'Solana';
    default:
      return `Chain ${chainId}`;
  }
}

/**
 * Get explorer URL for a transaction
 * 
 * @param chainId - The chain ID
 * @param txHash - The transaction hash
 * @returns The explorer URL
 */
export function getExplorerUrl(chainId: ChainId, txHash: string): string {
  switch (chainId) {
    case CHAIN_ID_ETH:
      return `https://etherscan.io/tx/${txHash}`;
    case CHAIN_ID_SOLANA:
      return `https://explorer.solana.com/tx/${txHash}`;
    default:
      return '';
  }
}

/**
 * Get explorer URL for an address
 * 
 * @param chainId - The chain ID
 * @param address - The address
 * @returns The explorer URL
 */
export function getAddressExplorerUrl(chainId: ChainId, address: string): string {
  switch (chainId) {
    case CHAIN_ID_ETH:
      return `https://etherscan.io/address/${address}`;
    case CHAIN_ID_SOLANA:
      return `https://explorer.solana.com/address/${address}`;
    default:
      return '';
  }
}

/**
 * Get chain-specific configuration
 * 
 * @param config - The Wormhole configuration
 * @param chainId - The chain ID
 * @returns The chain-specific configuration
 */
export function getChainConfig(config: WormholeConfig, chainId: ChainId): any {
  switch (chainId) {
    case CHAIN_ID_ETH:
      return config.ethereum;
    case CHAIN_ID_SOLANA:
      return config.solana;
    default:
      throw new Error(`Unsupported chain ID: ${chainId}`);
  }
}

/**
 * Validate Wormhole configuration
 * 
 * @param config - The Wormhole configuration to validate
 * @returns Validation result with errors if any
 */
export function validateWormholeConfig(config: WormholeConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Validate Ethereum configuration
  if (!config.ethereum.rpc) {
    errors.push('Ethereum RPC URL is required');
  }
  
  if (!config.ethereum.privateKey) {
    errors.push('Ethereum private key is required');
  }
  
  if (!config.ethereum.bridgeAddress) {
    errors.push('Ethereum bridge address is required');
  }
  
  if (!config.ethereum.tokenBridgeAddress) {
    errors.push('Ethereum token bridge address is required');
  }
  
  // Validate Solana configuration
  if (!config.solana.rpc) {
    errors.push('Solana RPC URL is required');
  }
  
  if (!config.solana.privateKey) {
    errors.push('Solana private key is required');
  }
  
  if (!config.solana.bridgeAddress) {
    errors.push('Solana bridge address is required');
  }
  
  if (!config.solana.tokenBridgeAddress) {
    errors.push('Solana token bridge address is required');
  }
  
  // Validate Wormhole configuration
  if (!config.wormhole.rpc) {
    errors.push('Wormhole RPC URL is required');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
