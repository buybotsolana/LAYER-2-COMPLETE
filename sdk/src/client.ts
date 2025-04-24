/**
 * Client SDK per il Layer-2 su Solana
 * 
 * Questo modulo implementa il client SDK per interagire con il sistema Layer-2 su Solana.
 * Fornisce funzionalità per depositi, trasferimenti, prelievi e query.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  Keypair,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  AccountInfo,
  ParsedAccountData
} from '@solana/web3.js';
import { ethers } from 'ethers';
import * as borsh from 'borsh';
import * as bs58 from 'bs58';
import { Buffer } from 'buffer';
import axios from 'axios';
import { MerkleTree } from './merkle-tree';

// Interfacce per i contratti Ethereum
import TokenBridgeABI from '../abi/TokenBridge.json';
import WithdrawalBridgeABI from '../abi/WithdrawalBridge.json';
import ERC20ABI from '../abi/ERC20.json';

/**
 * Enumerazione dei tipi di transazione
 */
export enum TransactionType {
  DEPOSIT = 0,
  TRANSFER = 1,
  WITHDRAWAL = 2,
  OTHER = 3
}

/**
 * Enumerazione degli stati delle transazioni
 */
export enum TransactionStatus {
  PENDING = 0,
  CONFIRMED = 1,
  REJECTED = 2,
  CHALLENGED = 3
}

/**
 * Interfaccia per la configurazione del client
 */
export interface Layer2ClientConfig {
  // Configurazione Solana
  solanaRpcUrl: string;
  programId: string;
  
  // Configurazione Ethereum (opzionale)
  ethereumRpcUrl?: string;
  tokenBridgeAddress?: string;
  withdrawalBridgeAddress?: string;
  
  // Configurazione API Layer-2
  layer2ApiUrl: string;
  
  // Configurazione opzionale
  commitment?: 'processed' | 'confirmed' | 'finalized';
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Interfaccia per una transazione Layer-2
 */
export interface Layer2Transaction {
  id?: string;
  sender: string;
  recipient: string;
  amount: number | bigint;
  nonce?: number;
  expiry_timestamp?: number;
  transaction_type: TransactionType;
  status?: TransactionStatus;
  data?: Uint8Array;
  signature?: Uint8Array;
}

/**
 * Interfaccia per un account Layer-2
 */
export interface Layer2Account {
  address: string;
  balance: number | bigint;
  nonce: number;
  lastUpdated: number;
}

/**
 * Interfaccia per un token
 */
export interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chainId: number;
  logoURI?: string;
}

/**
 * Interfaccia per le opzioni di deposito
 */
export interface DepositOptions {
  token: string;
  amount: number | bigint;
  recipient: string;
  deadline?: number;
  gasLimit?: number;
  gasPrice?: number;
}

/**
 * Interfaccia per le opzioni di trasferimento
 */
export interface TransferOptions {
  token: string;
  amount: number | bigint;
  recipient: string;
  deadline?: number;
  memo?: string;
}

/**
 * Interfaccia per le opzioni di prelievo
 */
export interface WithdrawalOptions {
  token: string;
  amount: number | bigint;
  recipient: string;
  deadline?: number;
  gasLimit?: number;
  gasPrice?: number;
}

/**
 * Interfaccia per il risultato di una transazione
 */
export interface TransactionResult {
  transactionId: string;
  blockNumber?: number;
  blockHash?: string;
  timestamp: number;
  status: TransactionStatus;
  confirmations: number;
  fee?: number;
}

/**
 * Interfaccia per le statistiche del Layer-2
 */
export interface Layer2Stats {
  totalTransactions: number;
  totalAccounts: number;
  totalValueLocked: number;
  transactionsPerSecond: number;
  averageFee: number;
  blockHeight: number;
  lastBlockTimestamp: number;
}

/**
 * Schema Borsh per la serializzazione delle transazioni
 */
const TransactionSchema = new Map([
  [
    'Layer2Transaction',
    {
      kind: 'struct',
      fields: [
        ['id', { kind: 'option', type: 'string' }],
        ['sender', 'string'],
        ['recipient', 'string'],
        ['amount', 'u64'],
        ['nonce', { kind: 'option', type: 'u32' }],
        ['expiry_timestamp', { kind: 'option', type: 'u64' }],
        ['transaction_type', 'u8'],
        ['status', { kind: 'option', type: 'u8' }],
        ['data', { kind: 'option', type: [32] }],
        ['signature', { kind: 'option', type: [64] }],
      ],
    },
  ],
]);

/**
 * Client per interagire con il Layer-2 su Solana
 */
export class Layer2Client {
  private config: Layer2ClientConfig;
  private solanaConnection: Connection;
  private ethereumProvider?: ethers.providers.JsonRpcProvider;
  private programId: PublicKey;
  private tokenBridge?: ethers.Contract;
  private withdrawalBridge?: ethers.Contract;
  
  /**
   * Costruttore
   * @param config Configurazione del client
   */
  constructor(config: Layer2ClientConfig) {
    this.config = {
      ...config,
      commitment: config.commitment || 'confirmed',
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
    };
    
    // Inizializza la connessione a Solana
    this.solanaConnection = new Connection(
      config.solanaRpcUrl,
      this.config.commitment
    );
    
    // Inizializza il programId
    this.programId = new PublicKey(config.programId);
    
    // Inizializza il provider Ethereum se configurato
    if (config.ethereumRpcUrl) {
      this.ethereumProvider = new ethers.providers.JsonRpcProvider(
        config.ethereumRpcUrl
      );
      
      // Inizializza i contratti Ethereum se configurati
      if (config.tokenBridgeAddress) {
        this.tokenBridge = new ethers.Contract(
          config.tokenBridgeAddress,
          TokenBridgeABI,
          this.ethereumProvider
        );
      }
      
      if (config.withdrawalBridgeAddress) {
        this.withdrawalBridge = new ethers.Contract(
          config.withdrawalBridgeAddress,
          WithdrawalBridgeABI,
          this.ethereumProvider
        );
      }
    }
  }
  
  /**
   * Connette un wallet Solana
   * @param keypair Keypair di Solana
   * @returns Client con wallet connesso
   */
  public connectSolanaWallet(keypair: Keypair): Layer2Client {
    const connectedClient = new Layer2Client(this.config);
    (connectedClient as any).solanaWallet = keypair;
    return connectedClient;
  }
  
  /**
   * Connette un wallet Ethereum
   * @param privateKey Chiave privata di Ethereum
   * @returns Client con wallet connesso
   */
  public connectEthereumWallet(privateKey: string): Layer2Client {
    if (!this.ethereumProvider) {
      throw new Error('Ethereum provider not configured');
    }
    
    const connectedClient = new Layer2Client(this.config);
    (connectedClient as any).ethereumWallet = new ethers.Wallet(
      privateKey,
      this.ethereumProvider
    );
    
    // Connette i contratti al wallet
    if (this.tokenBridge) {
      (connectedClient as any).tokenBridge = this.tokenBridge.connect(
        (connectedClient as any).ethereumWallet
      );
    }
    
    if (this.withdrawalBridge) {
      (connectedClient as any).withdrawalBridge = this.withdrawalBridge.connect(
        (connectedClient as any).ethereumWallet
      );
    }
    
    return connectedClient;
  }
  
  /**
   * Ottiene l'indirizzo del wallet Solana
   * @returns Indirizzo del wallet Solana
   */
  public getSolanaWalletAddress(): string {
    if (!(this as any).solanaWallet) {
      throw new Error('Solana wallet not connected');
    }
    
    return (this as any).solanaWallet.publicKey.toString();
  }
  
  /**
   * Ottiene l'indirizzo del wallet Ethereum
   * @returns Indirizzo del wallet Ethereum
   */
  public getEthereumWalletAddress(): string {
    if (!(this as any).ethereumWallet) {
      throw new Error('Ethereum wallet not connected');
    }
    
    return (this as any).ethereumWallet.address;
  }
  
  /**
   * Deposita token da Ethereum a Solana
   * @param options Opzioni di deposito
   * @returns Risultato della transazione
   */
  public async deposit(options: DepositOptions): Promise<TransactionResult> {
    if (!this.tokenBridge || !(this as any).ethereumWallet) {
      throw new Error('Ethereum wallet or token bridge not configured');
    }
    
    // Verifica che il token sia un indirizzo Ethereum valido
    if (!ethers.utils.isAddress(options.token)) {
      throw new Error('Invalid token address');
    }
    
    // Verifica che il destinatario sia un indirizzo Solana valido
    try {
      new PublicKey(options.recipient);
    } catch (error) {
      throw new Error('Invalid recipient address');
    }
    
    // Ottiene il contratto del token
    const tokenContract = new ethers.Contract(
      options.token,
      ERC20ABI,
      (this as any).ethereumWallet
    );
    
    // Ottiene il numero di decimali del token
    const decimals = await tokenContract.decimals();
    
    // Converte l'importo in unità del token
    const amount = ethers.utils.parseUnits(
      options.amount.toString(),
      decimals
    );
    
    // Verifica che l'importo sia positivo
    if (amount.lte(0)) {
      throw new Error('Amount must be positive');
    }
    
    // Verifica che il wallet abbia abbastanza token
    const balance = await tokenContract.balanceOf((this as any).ethereumWallet.address);
    if (balance.lt(amount)) {
      throw new Error('Insufficient balance');
    }
    
    // Approva il token bridge a spendere i token
    const approveTx = await tokenContract.approve(
      this.tokenBridge.address,
      amount,
      {
        gasLimit: options.gasLimit,
        gasPrice: options.gasPrice ? ethers.utils.parseUnits(options.gasPrice.toString(), 'gwei') : undefined,
      }
    );
    
    // Attende la conferma dell'approvazione
    await approveTx.wait();
    
    // Converte l'indirizzo Solana in bytes32
    const recipientBytes32 = ethers.utils.hexZeroPad(
      ethers.utils.hexlify(bs58.decode(options.recipient)),
      32
    );
    
    // Deposita i token
    const depositTx = await this.tokenBridge.deposit(
      options.token,
      amount,
      recipientBytes32,
      {
        gasLimit: options.gasLimit,
        gasPrice: options.gasPrice ? ethers.utils.parseUnits(options.gasPrice.toString(), 'gwei') : undefined,
      }
    );
    
    // Attende la conferma del deposito
    const receipt = await depositTx.wait();
    
    // Cerca l'evento Deposited
    const depositedEvent = receipt.events?.find(
      (event: any) => event.event === 'Deposited'
    );
    
    if (!depositedEvent) {
      throw new Error('Deposit failed');
    }
    
    // Ottiene l'ID del deposito
    const depositId = depositedEvent.args.id;
    
    return {
      transactionId: depositId,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      timestamp: Math.floor(Date.now() / 1000),
      status: TransactionStatus.CONFIRMED,
      confirmations: receipt.confirmations,
      fee: ethers.utils.formatEther(
        receipt.gasUsed.mul(receipt.effectiveGasPrice)
      ),
    };
  }
  
  /**
   * Trasferisce token all'interno del Layer-2
   * @param options Opzioni di trasferimento
   * @returns Risultato della transazione
   */
  public async transfer(options: TransferOptions): Promise<TransactionResult> {
    if (!(this as any).solanaWallet) {
      throw new Error('Solana wallet not connected');
    }
    
    // Verifica che il token sia un indirizzo Solana valido
    try {
      new PublicKey(options.token);
    } catch (error) {
      throw new Error('Invalid token address');
    }
    
    // Verifica che il destinatario sia un indirizzo Solana valido
    try {
      new PublicKey(options.recipient);
    } catch (error) {
      throw new Error('Invalid recipient address');
    }
    
    // Verifica che l'importo sia positivo
    if (options.amount <= 0) {
      throw new Error('Amount must be positive');
    }
    
    // Ottiene il nonce dell'account
    const senderAddress = (this as any).solanaWallet.publicKey.toString();
    const account = await this.getAccount(senderAddress);
    const nonce = account ? account.nonce : 0;
    
    // Crea la transazione Layer-2
    const layer2Tx: Layer2Transaction = {
      sender: senderAddress,
      recipient: options.recipient,
      amount: options.amount,
      nonce: nonce + 1,
      expiry_timestamp: options.deadline || Math.floor(Date.now() / 1000) + 3600, // 1 ora di scadenza
      transaction_type: TransactionType.TRANSFER,
      data: options.memo ? Buffer.from(options.memo) : undefined,
    };
    
    // Serializza la transazione
    const serializedTx = this.serializeTransaction(layer2Tx);
    
    // Firma la transazione
    const signature = await this.signTransaction(serializedTx);
    layer2Tx.signature = signature;
    
    // Invia la transazione al Layer-2
    const response = await axios.post(
      `${this.config.layer2ApiUrl}/transactions`,
      {
        transaction: layer2Tx,
      }
    );
    
    // Verifica la risposta
    if (!response.data || !response.data.transactionId) {
      throw new Error('Transfer failed');
    }
    
    return {
      transactionId: response.data.transactionId,
      timestamp: Math.floor(Date.now() / 1000),
      status: TransactionStatus.PENDING,
      confirmations: 0,
    };
  }
  
  /**
   * Preleva token da Solana a Ethereum
   * @param options Opzioni di prelievo
   * @returns Risultato della transazione
   */
  public async withdraw(options: WithdrawalOptions): Promise<TransactionResult> {
    if (!(this as any).solanaWallet) {
      throw new Error('Solana wallet not connected');
    }
    
    // Verifica che il token sia un indirizzo Solana valido
    try {
      new PublicKey(options.token);
    } catch (error) {
      throw new Error('Invalid token address');
    }
    
    // Verifica che il destinatario sia un indirizzo Ethereum valido
    if (!ethers.utils.isAddress(options.recipient)) {
      throw new Error('Invalid recipient address');
    }
    
    // Verifica che l'importo sia positivo
    if (options.amount <= 0) {
      throw new Error('Amount must be positive');
    }
    
    // Ottiene il nonce dell'account
    const senderAddress = (this as any).solanaWallet.publicKey.toString();
    const account = await this.getAccount(senderAddress);
    const nonce = account ? account.nonce : 0;
    
    // Crea la transazione Layer-2
    const layer2Tx: Layer2Transaction = {
      sender: senderAddress,
      recipient: options.recipient,
      amount: options.amount,
      nonce: nonce + 1,
      expiry_timestamp: options.deadline || Math.floor(Date.now() / 1000) + 3600, // 1 ora di scadenza
      transaction_type: TransactionType.WITHDRAWAL,
    };
    
    // Serializza la transazione
    const serializedTx = this.serializeTransaction(layer2Tx);
    
    // Firma la transazione
    const signature = await this.signTransaction(serializedTx);
    layer2Tx.signature = signature;
    
    // Invia la transazione al Layer-2
    const response = await axios.post(
      `${this.config.layer2ApiUrl}/withdrawals`,
      {
        transaction: layer2Tx,
      }
    );
    
    // Verifica la risposta
    if (!response.data || !response.data.transactionId) {
      throw new Error('Withdrawal failed');
    }
    
    return {
      transactionId: response.data.transactionId,
      timestamp: Math.floor(Date.now() / 1000),
      status: TransactionStatus.PENDING,
      confirmations: 0,
    };
  }
  
  /**
   * Ottiene un account Layer-2
   * @param address Indirizzo dell'account
   * @returns Account Layer-2
   */
  public async getAccount(address: string): Promise<Layer2Account | null> {
    try {
      // Verifica che l'indirizzo sia un indirizzo Solana valido
      try {
        new PublicKey(address);
      } catch (error) {
        throw new Error('Invalid address');
      }
      
      // Ottiene l'account dal Layer-2
      const response = await axios.get(
        `${this.config.layer2ApiUrl}/accounts/${address}`
      );
      
      // Verifica la risposta
      if (!response.data || !response.data.account) {
        return null;
      }
      
      return {
        address: response.data.account.address,
        balance: BigInt(response.data.account.balance),
        nonce: response.data.account.nonce,
        lastUpdated: response.data.account.lastUpdated,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }
  
  /**
   * Ottiene una transazione Layer-2
   * @param transactionId ID della transazione
   * @returns Transazione Layer-2
   */
  public async getTransaction(transactionId: string): Promise<Layer2Transaction | null> {
    try {
      // Ottiene la transazione dal Layer-2
      const response = await axios.get(
        `${this.config.layer2ApiUrl}/transactions/${transactionId}`
      );
      
      // Verifica la risposta
      if (!response.data || !response.data.transaction) {
        return null;
      }
      
      return {
        id: response.data.transaction.id,
        sender: response.data.transaction.sender,
        recipient: response.data.transaction.recipient,
        amount: BigInt(response.data.transaction.amount),
        nonce: response.data.transaction.nonce,
        expiry_timestamp: response.data.transaction.expiry_timestamp,
        transaction_type: response.data.transaction.transaction_type,
        status: response.data.transaction.status,
        data: response.data.transaction.data ? Buffer.from(response.data.transaction.data) : undefined,
        signature: response.data.transaction.signature ? Buffer.from(response.data.transaction.signature) : undefined,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }
  
  /**
   * Ottiene le transazioni di un account
   * @param address Indirizzo dell'account
   * @param limit Limite di transazioni
   * @param offset Offset per la paginazione
   * @returns Lista di transazioni
   */
  public async getTransactionsByAccount(
    address: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<Layer2Transaction[]> {
    // Verifica che l'indirizzo sia un indirizzo Solana valido
    try {
      new PublicKey(address);
    } catch (error) {
      throw new Error('Invalid address');
    }
    
    // Ottiene le transazioni dal Layer-2
    const response = await axios.get(
      `${this.config.layer2ApiUrl}/accounts/${address}/transactions`,
      {
        params: {
          limit,
          offset,
        },
      }
    );
    
    // Verifica la risposta
    if (!response.data || !response.data.transactions) {
      return [];
    }
    
    // Converte le transazioni
    return response.data.transactions.map((tx: any) => ({
      id: tx.id,
      sender: tx.sender,
      recipient: tx.recipient,
      amount: BigInt(tx.amount),
      nonce: tx.nonce,
      expiry_timestamp: tx.expiry_timestamp,
      transaction_type: tx.transaction_type,
      status: tx.status,
      data: tx.data ? Buffer.from(tx.data) : undefined,
      signature: tx.signature ? Buffer.from(tx.signature) : undefined,
    }));
  }
  
  /**
   * Ottiene il saldo di un token
   * @param address Indirizzo dell'account
   * @param token Indirizzo del token
   * @returns Saldo del token
   */
  public async getTokenBalance(
    address: string,
    token: string
  ): Promise<bigint> {
    // Verifica che l'indirizzo sia un indirizzo Solana valido
    try {
      new PublicKey(address);
    } catch (error) {
      throw new Error('Invalid address');
    }
    
    // Verifica che il token sia un indirizzo Solana valido
    try {
      new PublicKey(token);
    } catch (error) {
      throw new Error('Invalid token address');
    }
    
    // Ottiene il saldo dal Layer-2
    const response = await axios.get(
      `${this.config.layer2ApiUrl}/accounts/${address}/tokens/${token}`
    );
    
    // Verifica la risposta
    if (!response.data || !response.data.balance) {
      return BigInt(0);
    }
    
    return BigInt(response.data.balance);
  }
  
  /**
   * Ottiene i token supportati
   * @returns Lista di token supportati
   */
  public async getSupportedTokens(): Promise<Token[]> {
    // Ottiene i token dal Layer-2
    const response = await axios.get(
      `${this.config.layer2ApiUrl}/tokens`
    );
    
    // Verifica la risposta
    if (!response.data || !response.data.tokens) {
      return [];
    }
    
    return response.data.tokens;
  }
  
  /**
   * Ottiene le statistiche del Layer-2
   * @returns Statistiche del Layer-2
   */
  public async getStats(): Promise<Layer2Stats> {
    // Ottiene le statistiche dal Layer-2
    const response = await axios.get(
      `${this.config.layer2ApiUrl}/stats`
    );
    
    // Verifica la risposta
    if (!response.data || !response.data.stats) {
      throw new Error('Failed to get stats');
    }
    
    return {
      totalTransactions: response.data.stats.totalTransactions,
      totalAccounts: response.data.stats.totalAccounts,
      totalValueLocked: response.data.stats.totalValueLocked,
      transactionsPerSecond: response.data.stats.transactionsPerSecond,
      averageFee: response.data.stats.averageFee,
      blockHeight: response.data.stats.blockHeight,
      lastBlockTimestamp: response.data.stats.lastBlockTimestamp,
    };
  }
  
  /**
   * Verifica lo stato di una transazione
   * @param transactionId ID della transazione
   * @returns Stato della transazione
   */
  public async getTransactionStatus(
    transactionId: string
  ): Promise<TransactionStatus> {
    // Ottiene la transazione
    const transaction = await this.getTransaction(transactionId);
    
    if (!transaction) {
      throw new Error('Transaction not found');
    }
    
    return transaction.status || TransactionStatus.PENDING;
  }
  
  /**
   * Serializza una transazione
   * @param transaction Transazione da serializzare
   * @returns Transazione serializzata
   */
  private serializeTransaction(transaction: Layer2Transaction): Uint8Array {
    // Crea un oggetto per la serializzazione
    const txForSerialization = {
      ...transaction,
      amount: transaction.amount.toString(),
    };
    
    // Serializza la transazione
    return borsh.serialize(
      TransactionSchema,
      txForSerialization
    );
  }
  
  /**
   * Firma una transazione
   * @param transaction Transazione da firmare
   * @returns Firma della transazione
   */
  private async signTransaction(transaction: Uint8Array): Promise<Uint8Array> {
    if (!(this as any).solanaWallet) {
      throw new Error('Solana wallet not connected');
    }
    
    // Calcola l'hash della transazione
    const hash = Buffer.from(
      await crypto.subtle.digest('SHA-256', transaction)
    );
    
    // Firma l'hash
    return (this as any).solanaWallet.sign(hash);
  }
  
  /**
   * Verifica una firma
   * @param transaction Transazione serializzata
   * @param signature Firma della transazione
   * @param publicKey Chiave pubblica del firmatario
   * @returns True se la firma è valida
   */
  public async verifySignature(
    transaction: Uint8Array,
    signature: Uint8Array,
    publicKey: string
  ): Promise<boolean> {
    // Verifica che la chiave pubblica sia un indirizzo Solana valido
    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(publicKey);
    } catch (error) {
      throw new Error('Invalid public key');
    }
    
    // Calcola l'hash della transazione
    const hash = Buffer.from(
      await crypto.subtle.digest('SHA-256', transaction)
    );
    
    // Verifica la firma
    return pubkey.verify(hash, signature);
  }
  
  /**
   * Crea una prova di Merkle
   * @param transactionId ID della transazione
   * @param transactionIds Lista di ID di transazioni
   * @returns Prova di Merkle
   */
  public createMerkleProof(
    transactionId: string,
    transactionIds: string[]
  ): string[] {
    // Crea l'albero di Merkle
    const leaves = transactionIds.map(id => Buffer.from(id));
    const merkleTree = new MerkleTree(leaves);
    
    // Trova l'indice della transazione
    const index = transactionIds.indexOf(transactionId);
    
    if (index === -1) {
      throw new Error('Transaction not found in the list');
    }
    
    // Ottiene la prova
    const proof = merkleTree.getProof(index);
    
    // Converte la prova in stringhe
    return proof.map(p => p.data.toString('hex'));
  }
  
  /**
   * Verifica una prova di Merkle
   * @param transactionId ID della transazione
   * @param proof Prova di Merkle
   * @param root Radice dell'albero di Merkle
   * @returns True se la prova è valida
   */
  public verifyMerkleProof(
    transactionId: string,
    proof: string[],
    root: string
  ): boolean {
    // Converte la prova in buffer
    const proofBuffers = proof.map(p => ({
      data: Buffer.from(p, 'hex'),
      position: 'right', // La posizione non è importante per la verifica
    }));
    
    // Verifica la prova
    return MerkleTree.verify(
      Buffer.from(transactionId),
      proofBuffers,
      Buffer.from(root, 'hex')
    );
  }
}
