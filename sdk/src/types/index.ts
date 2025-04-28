import { PublicKey } from '@solana/web3.js';

/**
 * Informazioni di un account
 */
export interface AccountInfo {
  /** Indirizzo dell'account */
  address: string;
  /** Saldo in lamports */
  lamports: number;
  /** Proprietario dell'account */
  owner: string;
  /** Flag che indica se l'account è eseguibile */
  executable: boolean;
  /** Epoca di affitto */
  rentEpoch: number;
  /** Dati dell'account */
  data: Buffer | Uint8Array;
}

/**
 * Risultato di una transazione
 */
export interface TransactionResult {
  /** Flag che indica se la transazione ha avuto successo */
  success: boolean;
  /** Firma della transazione */
  signature: string | null;
  /** Errore, se presente */
  error: Error | null;
}

/**
 * Opzioni per una transazione
 */
export interface TransactionOptions {
  /** Livello di conferma richiesto */
  commitment?: 'processed' | 'confirmed' | 'finalized';
  /** Livello di conferma per il preflight */
  preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
  /** Flag per saltare il preflight */
  skipPreflight?: boolean;
}

/**
 * Informazioni di un token
 */
export interface TokenInfo {
  /** Indirizzo del token */
  address: string;
  /** Nome del token */
  name: string;
  /** Simbolo del token */
  symbol: string;
  /** Decimali del token */
  decimals: number;
  /** Logo del token (URL) */
  logoURI?: string;
}

/**
 * Informazioni di un deposito
 */
export interface DepositInfo {
  /** ID del deposito */
  id: string;
  /** Indirizzo del mittente su L1 */
  fromAddress: string;
  /** Indirizzo del destinatario su L2 */
  toAddress: string;
  /** Indirizzo del token */
  tokenAddress: string;
  /** Quantità depositata */
  amount: string;
  /** Timestamp del deposito */
  timestamp: number;
  /** Stato del deposito */
  status: 'pending' | 'completed' | 'failed';
  /** Hash della transazione su L1 */
  l1TxHash: string;
  /** Firma della transazione su L2 */
  l2TxSignature?: string;
}

/**
 * Informazioni di un prelievo
 */
export interface WithdrawalInfo {
  /** ID del prelievo */
  id: string;
  /** Indirizzo del mittente su L2 */
  fromAddress: string;
  /** Indirizzo del destinatario su L1 */
  toAddress: string;
  /** Indirizzo del token */
  tokenAddress: string;
  /** Quantità prelevata */
  amount: string;
  /** Timestamp del prelievo */
  timestamp: number;
  /** Stato del prelievo */
  status: 'pending' | 'processing' | 'completed' | 'failed';
  /** Firma della transazione su L2 */
  l2TxSignature: string;
  /** Hash della transazione su L1 */
  l1TxHash?: string;
  /** Periodo di contestazione (in secondi) */
  challengePeriod: number;
  /** Timestamp di fine del periodo di contestazione */
  challengeEndTimestamp?: number;
}

/**
 * Configurazione del bridge
 */
export interface BridgeConfig {
  /** Indirizzo del contratto bridge su L1 */
  l1BridgeAddress: string;
  /** Indirizzo del programma bridge su L2 */
  l2BridgeAddress: string;
  /** Periodo di contestazione (in secondi) */
  challengePeriod: number;
  /** Token supportati */
  supportedTokens: {
    /** Mappa da indirizzo token L1 a indirizzo token L2 */
    [l1TokenAddress: string]: string;
  };
}

/**
 * Stato del bridge
 */
export interface BridgeState {
  /** Numero totale di depositi */
  totalDeposits: number;
  /** Numero totale di prelievi */
  totalWithdrawals: number;
  /** Valore totale bloccato nel bridge (in USD) */
  totalValueLocked: string;
  /** Stato operativo del bridge */
  operational: boolean;
  /** Ultimo blocco L1 processato */
  lastProcessedL1Block: number;
  /** Ultimo blocco L2 finalizzato su L1 */
  lastFinalizedL2Block: number;
}

/**
 * Opzioni per il deposito
 */
export interface DepositOptions {
  /** Gas limit per la transazione L1 */
  gasLimit?: number;
  /** Prezzo del gas per la transazione L1 */
  gasPrice?: string;
  /** Callback per il progresso del deposito */
  onProgress?: (status: 'initiated' | 'l1_confirmed' | 'l2_processing' | 'completed', data?: any) => void;
}

/**
 * Opzioni per il prelievo
 */
export interface WithdrawalOptions {
  /** Callback per il progresso del prelievo */
  onProgress?: (status: 'initiated' | 'l2_confirmed' | 'challenge_period' | 'l1_processing' | 'completed', data?: any) => void;
  /** Flag per il prelievo immediato (con fee maggiore) */
  immediate?: boolean;
}

/**
 * Prova di prelievo
 */
export interface WithdrawalProof {
  /** ID del prelievo */
  withdrawalId: string;
  /** Indirizzo del mittente su L2 */
  fromAddress: string;
  /** Indirizzo del destinatario su L1 */
  toAddress: string;
  /** Indirizzo del token */
  tokenAddress: string;
  /** Quantità prelevata */
  amount: string;
  /** Root dello stato L2 */
  stateRoot: string;
  /** Prova di Merkle */
  merkleProof: string[];
  /** Indice del blocco L2 */
  l2BlockIndex: number;
  /** Timestamp del blocco L2 */
  l2BlockTimestamp: number;
  /** Firma della transazione su L2 */
  l2TxSignature: string;
}

export * from './index';
