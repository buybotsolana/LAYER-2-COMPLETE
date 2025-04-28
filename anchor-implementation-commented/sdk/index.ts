/**
 * @file index.ts
 * @description SDK TypeScript per il sistema Layer-2 con BuyBot Enterprise integrato
 * 
 * Questo SDK fornisce un'interfaccia client per interagire con il programma Anchor
 * del sistema Layer-2 con BuyBot Enterprise integrato. Offre metodi per tutte le
 * funzionalità del sistema, inclusi depositi, prelievi, bridge cross-chain,
 * launchpad, e BuyBot.
 * 
 * @author BuyBot Solana Team
 * @version 1.0.0
 */

import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { PublicKey, Connection, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';
import { Layer2 } from '../target/types/layer2';
import { BN } from 'bn.js';

/**
 * Client principale per interagire con il programma Layer-2
 * 
 * Questa classe fornisce metodi per tutte le funzionalità del sistema Layer-2,
 * inclusi depositi, prelievi, bridge cross-chain, launchpad, e BuyBot.
 */
export class Layer2Client {
  /** Programma Anchor */
  program: Program<Layer2>;
  /** Connessione a Solana */
  connection: Connection;
  /** Wallet dell'utente */
  wallet: anchor.Wallet;

  /**
   * Costruttore del client Layer-2
   * 
   * @param connection - Connessione a Solana
   * @param wallet - Wallet dell'utente
   * @param programId - ID del programma Layer-2 (opzionale, default: Layer2111111111111111111111111111111111111111)
   */
  constructor(
    connection: Connection,
    wallet: anchor.Wallet,
    programId: PublicKey = new PublicKey('Layer2111111111111111111111111111111111111111')
  ) {
    this.connection = connection;
    this.wallet = wallet;
    
    // Crea il provider Anchor
    const provider = new anchor.AnchorProvider(
      connection,
      wallet,
      { commitment: 'confirmed' }
    );
    
    // Inizializza il programma
    this.program = new Program<Layer2>(
      require('../target/idl/layer2.json'),
      programId,
      provider
    );
  }

  /**
   * Inizializza il sistema Layer-2
   * 
   * Questa funzione crea l'account di stato globale del sistema Layer-2 e
   * imposta i parametri iniziali come il sequencer, la finestra di fraud proof
   * e la finestra di finalizzazione.
   * 
   * @param sequencer - Chiave pubblica del sequencer autorizzato
   * @param fraudProofWindow - Finestra di tempo per le fraud proof (in secondi)
   * @param finalizationWindow - Finestra di tempo per la finalizzazione (in secondi)
   * @returns Promise con la firma della transazione
   */
  async initialize(
    sequencer: PublicKey,
    fraudProofWindow: number,
    finalizationWindow: number
  ): Promise<string> {
    // Trova l'indirizzo PDA per lo stato del Layer-2
    const [layer2State, bump] = await PublicKey.findProgramAddress(
      [Buffer.from('layer2_state')],
      this.program.programId
    );

    // Invia la transazione di inizializzazione
    const tx = await this.program.methods
      .initialize({
        sequencer,
        fraudProofWindow: new BN(fraudProofWindow),
        finalizationWindow: new BN(finalizationWindow)
      })
      .accounts({
        authority: this.wallet.publicKey,
        layer2State,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    return tx;
  }

  /**
   * Registra un nuovo token nel sistema
   * 
   * Questa funzione registra un nuovo token nel sistema Layer-2, specificando
   * se è un token nativo o bridged, e configurando le impostazioni del BuyBot
   * come le tasse e il periodo di blocco della liquidità.
   * 
   * @param mint - Chiave pubblica del mint del token
   * @param isNative - Se il token è nativo (true) o bridged (false)
   * @param bridgeSource - Fonte del bridge (per token bridged)
   * @param enableBuybot - Se abilitare il BuyBot per questo token
   * @param taxBuy - Tassa sugli acquisti (in percentuale)
   * @param taxSell - Tassa sulle vendite (in percentuale)
   * @param taxTransfer - Tassa sui trasferimenti (in percentuale)
   * @param liquidityLockPeriod - Periodo minimo di blocco della liquidità (in secondi)
   * @returns Promise con la firma della transazione
   */
  async registerToken(
    mint: PublicKey,
    isNative: boolean,
    bridgeSource: Buffer,
    enableBuybot: boolean,
    taxBuy: number,
    taxSell: number,
    taxTransfer: number,
    liquidityLockPeriod: number
  ): Promise<string> {
    // Trova l'indirizzo PDA per le informazioni del token
    const [tokenInfo, bump] = await PublicKey.findProgramAddress(
      [Buffer.from('token_info'), mint.toBuffer()],
      this.program.programId
    );

    // Invia la transazione di registrazione token
    const tx = await this.program.methods
      .registerToken({
        isNative,
        bridgeSource: bridgeSource.toJSON().data as unknown as number[],
        enableBuybot,
        taxBuy,
        taxSell,
        taxTransfer,
        liquidityLockPeriod: new BN(liquidityLockPeriod)
      })
      .accounts({
        authority: this.wallet.publicKey,
        mint,
        tokenInfo,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    return tx;
  }

  /**
   * Deposita token nel Layer-2
   * 
   * Questa funzione permette a un utente di depositare token nel sistema Layer-2.
   * I token vengono trasferiti dall'account token dell'utente al vault del sistema.
   * 
   * @param mint - Chiave pubblica del mint del token
   * @param userTokenAccount - Account token dell'utente
   * @param amount - Quantità di token da depositare
   * @returns Promise con la firma della transazione
   */
  async deposit(
    mint: PublicKey,
    userTokenAccount: PublicKey,
    amount: number
  ): Promise<string> {
    // Trova gli indirizzi PDA necessari
    const [tokenInfo, tokenInfoBump] = await PublicKey.findProgramAddress(
      [Buffer.from('token_info'), mint.toBuffer()],
      this.program.programId
    );

    const [vault, vaultBump] = await PublicKey.findProgramAddress(
      [Buffer.from('vault'), mint.toBuffer()],
      this.program.programId
    );

    const [userDeposit, userDepositBump] = await PublicKey.findProgramAddress(
      [Buffer.from('user_deposit'), this.wallet.publicKey.toBuffer(), mint.toBuffer()],
      this.program.programId
    );

    // Invia la transazione di deposito
    const tx = await this.program.methods
      .deposit(new BN(amount))
      .accounts({
        user: this.wallet.publicKey,
        userTokenAccount,
        vault,
        tokenInfo,
        userDeposit,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    return tx;
  }

  /**
   * Ritira token dal Layer-2
   * 
   * Questa funzione permette a un utente di ritirare token dal sistema Layer-2.
   * I token vengono trasferiti dal vault del sistema all'account token dell'utente.
   * 
   * @param mint - Chiave pubblica del mint del token
   * @param userTokenAccount - Account token dell'utente
   * @param amount - Quantità di token da ritirare
   * @returns Promise con la firma della transazione
   */
  async withdraw(
    mint: PublicKey,
    userTokenAccount: PublicKey,
    amount: number
  ): Promise<string> {
    // Trova gli indirizzi PDA necessari
    const [tokenInfo, tokenInfoBump] = await PublicKey.findProgramAddress(
      [Buffer.from('token_info'), mint.toBuffer()],
      this.program.programId
    );

    const [vault, vaultBump] = await PublicKey.findProgramAddress(
      [Buffer.from('vault'), mint.toBuffer()],
      this.program.programId
    );

    const [userDeposit, userDepositBump] = await PublicKey.findProgramAddress(
      [Buffer.from('user_deposit'), this.wallet.publicKey.toBuffer(), mint.toBuffer()],
      this.program.programId
    );

    // Invia la transazione di prelievo
    const tx = await this.program.methods
      .withdraw(new BN(amount))
      .accounts({
        user: this.wallet.publicKey,
        userTokenAccount,
        vault,
        tokenInfo,
        userDeposit,
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .rpc();

    return tx;
  }

  /**
   * Verifica un VAA di Wormhole per il bridge
   * 
   * Questa funzione verifica un VAA (Verified Action Approval) di Wormhole
   * per il bridge cross-chain. In una implementazione completa, questa funzione
   * farebbe una CPI (Cross-Program Invocation) verso il programma Wormhole.
   * 
   * @param vaaHash - Hash del VAA da verificare
   * @returns Promise con la firma della transazione
   */
  async verifyVAA(vaaHash: Buffer): Promise<string> {
    // Trova l'indirizzo PDA per lo stato del bridge
    const [bridgeState, bridgeStateBump] = await PublicKey.findProgramAddress(
      [Buffer.from('bridge_state')],
      this.program.programId
    );

    // Invia la transazione di verifica VAA
    const tx = await this.program.methods
      .verifyVaa(vaaHash.toJSON().data as unknown as number[])
      .accounts({
        authority: this.wallet.publicKey,
        bridgeState,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    return tx;
  }

  /**
   * Esegue un bundle di transazioni
   * 
   * Questa funzione permette al sequencer di eseguire un bundle di transazioni
   * Layer-2. Il bundle è identificato da un ID e contiene un Merkle root che
   * rappresenta tutte le transazioni nel bundle.
   * 
   * @param bundleId - ID del bundle
   * @param transactionCount - Numero di transazioni nel bundle
   * @param merkleRoot - Merkle root delle transazioni
   * @returns Promise con la firma della transazione
   */
  async executeBundle(
    bundleId: number,
    transactionCount: number,
    merkleRoot: Buffer
  ): Promise<string> {
    // Trova gli indirizzi PDA necessari
    const [layer2State, layer2StateBump] = await PublicKey.findProgramAddress(
      [Buffer.from('layer2_state')],
      this.program.programId
    );

    const [bundle, bundleBump] = await PublicKey.findProgramAddress(
      [
        Buffer.from('bundle'),
        this.wallet.publicKey.toBuffer(),
        new BN(bundleId).toArrayLike(Buffer, 'le', 8)
      ],
      this.program.programId
    );

    // Invia la transazione di esecuzione bundle
    const tx = await this.program.methods
      .executeBundle({
        bundleId: new BN(bundleId),
        transactionCount,
        merkleRoot: merkleRoot.toJSON().data as unknown as number[]
      })
      .accounts({
        sequencer: this.wallet.publicKey,
        bundle,
        layer2State,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    return tx;
  }

  /**
   * Blocca la liquidità per un token
   * 
   * Questa funzione permette a un proprietario di token di bloccare la liquidità
   * per un periodo specificato. Questo aumenta lo score anti-rug del token.
   * 
   * @param mint - Chiave pubblica del mint del token
   * @param tokenAmount - Quantità di token da bloccare
   * @param baseAmount - Quantità di base (SOL) da bloccare
   * @param lockPeriod - Periodo di blocco (in secondi)
   * @returns Promise con la firma della transazione
   */
  async lockLiquidity(
    mint: PublicKey,
    tokenAmount: number,
    baseAmount: number,
    lockPeriod: number
  ): Promise<string> {
    // Trova gli indirizzi PDA necessari
    const [tokenInfo, tokenInfoBump] = await PublicKey.findProgramAddress(
      [Buffer.from('token_info'), mint.toBuffer()],
      this.program.programId
    );

    const [liquidityLock, liquidityLockBump] = await PublicKey.findProgramAddress(
      [Buffer.from('liquidity_lock'), mint.toBuffer(), this.wallet.publicKey.toBuffer()],
      this.program.programId
    );

    // Invia la transazione di blocco liquidità
    const tx = await this.program.methods
      .lockLiquidity({
        tokenAmount: new BN(tokenAmount),
        baseAmount: new BN(baseAmount),
        lockPeriod: new BN(lockPeriod)
      })
      .accounts({
        owner: this.wallet.publicKey,
        tokenInfo,
        liquidityLock,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    return tx;
  }

  /**
   * Crea un nuovo token tramite il launchpad
   * 
   * Questa funzione permette a un utente di creare un nuovo token tramite
   * il launchpad, configurando i parametri della presale e del token stesso.
   * 
   * @param mint - Chiave pubblica del mint del token
   * @param params - Parametri di creazione del token
   * @returns Promise con la firma della transazione
   */
  async createToken(
    mint: PublicKey,
    params: {
      decimals: number;
      presalePrice: number;
      listingPrice: number;
      softCap: number;
      hardCap: number;
      minContribution: number;
      maxContribution: number;
      liquidityPercentage: number;
      startTime: number;
      endTime: number;
      enableBuybot: boolean;
      taxBuy: number;
      taxSell: number;
      taxTransfer: number;
      liquidityLockPeriod: number;
    }
  ): Promise<string> {
    // Trova gli indirizzi PDA necessari
    const [tokenInfo, tokenInfoBump] = await PublicKey.findProgramAddress(
      [Buffer.from('token_info'), mint.toBuffer()],
      this.program.programId
    );

    const [launchpadInfo, launchpadInfoBump] = await PublicKey.findProgramAddress(
      [Buffer.from('launchpad_info'), mint.toBuffer()],
      this.program.programId
    );

    // Invia la transazione di creazione token
    const tx = await this.program.methods
      .createToken({
        decimals: params.decimals,
        presalePrice: new BN(params.presalePrice),
        listingPrice: new BN(params.listingPrice),
        softCap: new BN(params.softCap),
        hardCap: new BN(params.hardCap),
        minContribution: new BN(params.minContribution),
        maxContribution: new BN(params.maxContribution),
        liquidityPercentage: params.liquidityPercentage,
        startTime: new BN(params.startTime),
        endTime: new BN(params.endTime),
        enableBuybot: params.enableBuybot,
        taxBuy: params.taxBuy,
        taxSell: params.taxSell,
        taxTransfer: params.taxTransfer,
        liquidityLockPeriod: new BN(params.liquidityLockPeriod)
      })
      .accounts({
        authority: this.wallet.publicKey,
        mint,
        tokenInfo,
        launchpadInfo,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    return tx;
  }

  /**
   * Contribuisce a una presale nel launchpad
   * 
   * Questa funzione permette a un utente di contribuire a una presale
   * inviando SOL e ricevendo il diritto di reclamare token una volta
   * che la presale è finalizzata.
   * 
   * @param mint - Chiave pubblica del mint del token
   * @param userTokenAccount - Account token dell'utente
   * @param amount - Quantità di SOL da contribuire
   * @returns Promise con la firma della transazione
   */
  async contributePresale(
    mint: PublicKey,
    userTokenAccount: PublicKey,
    amount: number
  ): Promise<string> {
    // Trova gli indirizzi PDA necessari
    const [launchpadInfo, launchpadInfoBump] = await PublicKey.findProgramAddress(
      [Buffer.from('launchpad_info'), mint.toBuffer()],
      this.program.programId
    );

    const [presaleVault, presaleVaultBump] = await PublicKey.findProgramAddress(
      [Buffer.from('presale_vault'), mint.toBuffer()],
      this.program.programId
    );

    const [presaleState, presaleStateBump] = await PublicKey.findProgramAddress(
      [Buffer.from('presale_state'), mint.toBuffer()],
      this.program.programId
    );

    const [contribution, contributionBump] = await PublicKey.findProgramAddress(
      [Buffer.from('contribution'), this.wallet.publicKey.toBuffer(), mint.toBuffer()],
      this.program.programId
    );

    // Invia la transazione di contribuzione presale
    const tx = await this.program.methods
      .contributePresale(new BN(amount))
      .accounts({
        user: this.wallet.publicKey,
        userTokenAccount,
        presaleVault,
        launchpadInfo,
        presaleState,
        contribution,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    return tx;
  }

  /**
   * Finalizza una presale e lancia il token
   * 
   * Questa funzione permette al creatore di finalizzare una presale
   * dopo che è terminata. Se la soft cap è stata raggiunta, la presale
   * è considerata un successo e il token viene lanciato.
   * 
   * @param mint - Chiave pubblica del mint del token
   * @returns Promise con la firma della transazione
   */
  async finalizePresale(mint: PublicKey): Promise<string> {
    // Trova gli indirizzi PDA necessari
    const [launchpadInfo, launchpadInfoBump] = await PublicKey.findProgramAddress(
      [Buffer.from('launchpad_info'), mint.toBuffer()],
      this.program.programId
    );

    const [presaleState, presaleStateBump] = await PublicKey.findProgramAddress(
      [Buffer.from('presale_state'), mint.toBuffer()],
      this.program.programId
    );

    const [tokenInfo, tokenInfoBump] = await PublicKey.findProgramAddress(
      [Buffer.from('token_info'), mint.toBuffer()],
      this.program.programId
    );

    // Invia la transazione di finalizzazione presale
    const tx = await this.program.methods
      .finalizePresale()
      .accounts({
        authority: this.wallet.publicKey,
        launchpadInfo,
        presaleState,
        tokenInfo,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    return tx;
  }

  /**
   * Esegue un'operazione di buyback
   * 
   * Questa funzione permette all'autorità di un token di eseguire
   * un'operazione di buyback, utilizzando SOL per acquistare token
   * dal mercato e potenzialmente bruciarli.
   * 
   * @param mint - Chiave pubblica del mint del token
   * @param amount - Quantità di token da riacquistare
   * @returns Promise con la firma della transazione
   */
  async executeBuyback(mint: PublicKey, amount: number): Promise<string> {
    // Trova l'indirizzo PDA per le informazioni del token
    const [tokenInfo, tokenInfoBump] = await PublicKey.findProgramAddress(
      [Buffer.from('token_info'), mint.toBuffer()],
      this.program.programId
    );

    // Invia la transazione di buyback
    const tx = await this.program.methods
      .executeBuyback(new BN(amount))
      .accounts({
        authority: this.wallet.publicKey,
        tokenInfo,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    return tx;
  }

  /**
   * Esegue un'operazione di burn
   * 
   * Questa funzione permette all'autorità di un token di bruciare
   * una quantità di token, riducendo l'offerta totale.
   * 
   * @param mint - Chiave pubblica del mint del token
   * @param tokenAccount - Account token da cui bruciare
   * @param amount - Quantità di token da bruciare
   * @returns Promise con la firma della transazione
   */
  async executeBurn(
    mint: PublicKey,
    tokenAccount: PublicKey,
    amount: number
  ): Promise<string> {
    // Trova l'indirizzo PDA per le informazioni del token
    const [tokenInfo, tokenInfoBump] = await PublicKey.findProgramAddress(
      [Buffer.from('token_info'), mint.toBuffer()],
      this.program.programId
    );

    // Invia la transazione di burn
    const tx = await this.program.methods
      .executeBurn(new BN(amount))
      .accounts({
        authority: this.wallet.publicKey,
        mint,
        tokenAccount,
        tokenInfo,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    return tx;
  }

  /**
   * Ottiene le informazioni di un token
   * 
   * Questa funzione recupera le informazioni di un token registrato
   * nel sistema Layer-2.
   * 
   * @param mint - Chiave pubblica del mint del token
   * @returns Promise con le informazioni del token
   */
  async getTokenInfo(mint: PublicKey): Promise<any> {
    // Trova l'indirizzo PDA per le informazioni del token
    const [tokenInfo, bump] = await PublicKey.findProgramAddress(
      [Buffer.from('token_info'), mint.toBuffer()],
      this.program.programId
    );

    // Recupera le informazioni del token
    return await this.program.account.tokenInfo.fetch(tokenInfo);
  }

  /**
   * Ottiene le informazioni di un launchpad
   * 
   * Questa funzione recupera le informazioni di un launchpad
   * per un token specifico.
   * 
   * @param mint - Chiave pubblica del mint del token
   * @returns Promise con le informazioni del launchpad
   */
  async getLaunchpadInfo(mint: PublicKey): Promise<any> {
    // Trova l'indirizzo PDA per le informazioni del launchpad
    const [launchpadInfo, bump] = await PublicKey.findProgramAddress(
      [Buffer.from('launchpad_info'), mint.toBuffer()],
      this.program.programId
    );

    // Recupera le informazioni del launchpad
    return await this.program.account.launchpadInfo.fetch(launchpadInfo);
  }

  /**
   * Ottiene lo stato di una presale
   * 
   * Questa funzione recupera lo stato di una presale
   * per un token specifico.
   * 
   * @param mint - Chiave pubblica del mint del token
   * @returns Promise con lo stato della presale
   */
  async getPresaleState(mint: PublicKey): Promise<any> {
    // Trova l'indirizzo PDA per lo stato della presale
    const [presaleState, bump] = await PublicKey.findProgramAddress(
      [Buffer.from('presale_state'), mint.toBuffer()],
      this.program.programId
    );

    // Recupera lo stato della presale
    return await this.program.account.presaleState.fetch(presaleState);
  }

  /**
   * Ottiene la contribuzione di un utente a una presale
   * 
   * Questa funzione recupera la contribuzione di un utente
   * a una presale per un token specifico.
   * 
   * @param user - Chiave pubblica dell'utente
   * @param mint - Chiave pubblica del mint del token
   * @returns Promise con la contribuzione dell'utente
   */
  async getContribution(user: PublicKey, mint: PublicKey): Promise<any> {
    // Trova l'indirizzo PDA per la contribuzione
    const [contribution, bump] = await PublicKey.findProgramAddress(
      [Buffer.from('contribution'), user.toBuffer(), mint.toBuffer()],
      this.program.programId
    );

    // Recupera la contribuzione
    return await this.program.account.contribution.fetch(contribution);
  }

  /**
   * Ottiene le informazioni di un blocco di liquidità
   * 
   * Questa funzione recupera le informazioni di un blocco di liquidità
   * per un token specifico e un proprietario specifico.
   * 
   * @param owner - Chiave pubblica del proprietario
   * @param mint - Chiave pubblica del mint del token
   * @returns Promise con le informazioni del blocco di liquidità
   */
  async getLiquidityLock(owner: PublicKey, mint: PublicKey): Promise<any> {
    // Trova l'indirizzo PDA per il blocco di liquidità
    const [liquidityLock, bump] = await PublicKey.findProgramAddress(
      [Buffer.from('liquidity_lock'), mint.toBuffer(), owner.toBuffer()],
      this.program.programId
    );

    // Recupera le informazioni del blocco di liquidità
    return await this.program.account.liquidityLock.fetch(liquidityLock);
  }
}

export default Layer2Client;
