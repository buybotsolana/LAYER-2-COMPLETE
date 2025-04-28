import { L2Client } from './client';
import { DepositInfo, WithdrawalInfo, BridgeConfig, BridgeState, DepositOptions, WithdrawalOptions, WithdrawalProof } from './types';
import { ethers } from 'ethers';
import { PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { DepositManager } from './bridge/deposit';
import { WithdrawalManager } from './bridge/withdraw';
import { ProofGenerator } from './bridge/proof';

/**
 * Classe per la gestione del bridge tra Ethereum (L1) e Layer-2 Solana
 */
export class BridgeManager {
  private client: L2Client;
  private depositManager: DepositManager;
  private withdrawalManager: WithdrawalManager;
  private proofGenerator: ProofGenerator;
  private bridgeConfig: BridgeConfig | null = null;

  /**
   * Costruttore della classe BridgeManager
   * @param client - Istanza di L2Client
   */
  constructor(client: L2Client) {
    this.client = client;
    this.depositManager = new DepositManager(client);
    this.withdrawalManager = new WithdrawalManager(client);
    this.proofGenerator = new ProofGenerator(client);
  }

  /**
   * Inizializza il bridge con la configurazione specificata
   * @param config - Configurazione del bridge
   */
  async initialize(config: BridgeConfig): Promise<void> {
    this.bridgeConfig = config;
    await this.depositManager.initialize(config);
    await this.withdrawalManager.initialize(config);
    await this.proofGenerator.initialize(config);
  }

  /**
   * Ottiene la configurazione del bridge
   * @returns Configurazione del bridge
   * @throws Error se il bridge non è inizializzato
   */
  getConfig(): BridgeConfig {
    if (!this.bridgeConfig) {
      throw new Error('Bridge non inizializzato. Chiamare initialize() prima di utilizzare il bridge.');
    }
    return this.bridgeConfig;
  }

  /**
   * Ottiene lo stato attuale del bridge
   * @returns Stato del bridge
   */
  async getState(): Promise<BridgeState> {
    this.ensureInitialized();
    
    // Implementazione di esempio - in un'implementazione reale, queste informazioni
    // verrebbero recuperate dai contratti L1 e dai programmi L2
    return {
      totalDeposits: 0,
      totalWithdrawals: 0,
      totalValueLocked: "0",
      operational: true,
      lastProcessedL1Block: 0,
      lastFinalizedL2Block: 0
    };
  }

  /**
   * Deposita ETH da L1 a L2
   * @param amount - Quantità di ETH da depositare (in wei)
   * @param l2Address - Indirizzo di destinazione su L2
   * @param options - Opzioni per il deposito
   * @returns Informazioni sul deposito
   */
  async depositETH(
    amount: string,
    l2Address: string | PublicKey,
    options?: DepositOptions
  ): Promise<DepositInfo> {
    this.ensureInitialized();
    return await this.depositManager.depositETH(amount, l2Address, options);
  }

  /**
   * Deposita token ERC20 da L1 a L2
   * @param tokenAddress - Indirizzo del token ERC20 su L1
   * @param amount - Quantità di token da depositare
   * @param l2Address - Indirizzo di destinazione su L2
   * @param options - Opzioni per il deposito
   * @returns Informazioni sul deposito
   */
  async depositERC20(
    tokenAddress: string,
    amount: string,
    l2Address: string | PublicKey,
    options?: DepositOptions
  ): Promise<DepositInfo> {
    this.ensureInitialized();
    return await this.depositManager.depositERC20(tokenAddress, amount, l2Address, options);
  }

  /**
   * Preleva ETH da L2 a L1
   * @param amount - Quantità di ETH da prelevare (in lamports)
   * @param l1Address - Indirizzo di destinazione su L1
   * @param keypair - Keypair per firmare la transazione su L2
   * @param options - Opzioni per il prelievo
   * @returns Informazioni sul prelievo
   */
  async withdrawETH(
    amount: string,
    l1Address: string,
    keypair: Keypair,
    options?: WithdrawalOptions
  ): Promise<WithdrawalInfo> {
    this.ensureInitialized();
    return await this.withdrawalManager.withdrawETH(amount, l1Address, keypair, options);
  }

  /**
   * Preleva token da L2 a L1
   * @param tokenAddress - Indirizzo del token su L2
   * @param amount - Quantità di token da prelevare
   * @param l1Address - Indirizzo di destinazione su L1
   * @param keypair - Keypair per firmare la transazione su L2
   * @param options - Opzioni per il prelievo
   * @returns Informazioni sul prelievo
   */
  async withdrawToken(
    tokenAddress: string | PublicKey,
    amount: string,
    l1Address: string,
    keypair: Keypair,
    options?: WithdrawalOptions
  ): Promise<WithdrawalInfo> {
    this.ensureInitialized();
    return await this.withdrawalManager.withdrawToken(tokenAddress, amount, l1Address, keypair, options);
  }

  /**
   * Ottiene lo stato di un deposito
   * @param depositId - ID del deposito
   * @returns Informazioni sul deposito
   */
  async getDepositStatus(depositId: string): Promise<DepositInfo> {
    this.ensureInitialized();
    return await this.depositManager.getDepositStatus(depositId);
  }

  /**
   * Ottiene lo stato di un prelievo
   * @param withdrawalId - ID del prelievo
   * @returns Informazioni sul prelievo
   */
  async getWithdrawalStatus(withdrawalId: string): Promise<WithdrawalInfo> {
    this.ensureInitialized();
    return await this.withdrawalManager.getWithdrawalStatus(withdrawalId);
  }

  /**
   * Genera una prova di prelievo
   * @param withdrawalId - ID del prelievo
   * @returns Prova di prelievo
   */
  async generateWithdrawalProof(withdrawalId: string): Promise<WithdrawalProof> {
    this.ensureInitialized();
    return await this.proofGenerator.generateProof(withdrawalId);
  }

  /**
   * Finalizza un prelievo su L1 dopo il periodo di contestazione
   * @param withdrawalId - ID del prelievo
   * @param proof - Prova di prelievo
   * @param ethProvider - Provider Ethereum
   * @returns Hash della transazione L1
   */
  async finalizeWithdrawal(
    withdrawalId: string,
    proof: WithdrawalProof,
    ethProvider: ethers.providers.Provider
  ): Promise<string> {
    this.ensureInitialized();
    return await this.withdrawalManager.finalizeWithdrawal(withdrawalId, proof, ethProvider);
  }

  /**
   * Ottiene l'elenco dei depositi per un indirizzo L2
   * @param l2Address - Indirizzo L2
   * @param limit - Numero massimo di depositi da restituire
   * @param offset - Offset per la paginazione
   * @returns Elenco dei depositi
   */
  async getDepositsForAddress(
    l2Address: string | PublicKey,
    limit = 10,
    offset = 0
  ): Promise<DepositInfo[]> {
    this.ensureInitialized();
    return await this.depositManager.getDepositsForAddress(l2Address, limit, offset);
  }

  /**
   * Ottiene l'elenco dei prelievi per un indirizzo L2
   * @param l2Address - Indirizzo L2
   * @param limit - Numero massimo di prelievi da restituire
   * @param offset - Offset per la paginazione
   * @returns Elenco dei prelievi
   */
  async getWithdrawalsForAddress(
    l2Address: string | PublicKey,
    limit = 10,
    offset = 0
  ): Promise<WithdrawalInfo[]> {
    this.ensureInitialized();
    return await this.withdrawalManager.getWithdrawalsForAddress(l2Address, limit, offset);
  }

  /**
   * Verifica se il bridge è inizializzato
   * @throws Error se il bridge non è inizializzato
   */
  private ensureInitialized(): void {
    if (!this.bridgeConfig) {
      throw new Error('Bridge non inizializzato. Chiamare initialize() prima di utilizzare il bridge.');
    }
  }
}
