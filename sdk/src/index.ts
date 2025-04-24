/**
 * @fileoverview Entry point dell'SDK Layer 2 di Solana
 */

import { Layer2Client, Layer2ClientConfig } from './client';
import { Bridge } from './bridge';
import { TransactionManager } from './transaction';
import { Challenge } from './challenge';
import { BatchManager } from './batch';
import { ProofManager } from './proof';
import { StateManager } from './state';

// Esporta tutte le classi e le interfacce principali
export {
  // Client principale
  Layer2Client,
  Layer2ClientConfig,
  
  // Moduli
  Bridge,
  TransactionManager,
  Challenge,
  BatchManager,
  ProofManager,
  StateManager,
  
  // Tipi da batch.ts
  BatchConfig,
  BatchStatus,
  BatchInfo,
  
  // Tipi da proof.ts
  ProofType,
  Proof,
  VerifyProofOptions,
  VerifyProofResult,
  
  // Tipi da state.ts
  Layer2AccountType,
  Layer2AccountInfo,
  Layer2StateInfo,
  StateMonitorOptions,
};

// Esporta anche i tipi di errore
export * from './types/errors';

// Funzione di utilità per creare un client Layer 2
export function createLayer2Client(config: Layer2ClientConfig): Layer2Client {
  return new Layer2Client(config);
}

// Versione dell'SDK
export const SDK_VERSION = '0.2.0';

// Informazioni sull'SDK
export const SDK_INFO = {
  name: 'layer2-solana-sdk',
  version: SDK_VERSION,
  description: 'JavaScript SDK per interagire con il Layer 2 di Solana',
  isNodeCompatible: true,
  isBrowserCompatible: true,
};
