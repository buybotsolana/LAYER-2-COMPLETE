import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { PublicKey, Connection, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';
import { Layer2 } from '../target/types/layer2';
import { BN } from 'bn.js';

export class Layer2Client {
  program: Program<Layer2>;
  connection: Connection;
  wallet: anchor.Wallet;

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
   */
  async initialize(
    sequencer: PublicKey,
    fraudProofWindow: number,
    finalizationWindow: number
  ): Promise<string> {
    const [layer2State, bump] = await PublicKey.findProgramAddress(
      [Buffer.from('layer2_state')],
      this.program.programId
    );

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
    const [tokenInfo, bump] = await PublicKey.findProgramAddress(
      [Buffer.from('token_info'), mint.toBuffer()],
      this.program.programId
    );

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
   */
  async deposit(
    mint: PublicKey,
    userTokenAccount: PublicKey,
    amount: number
  ): Promise<string> {
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
   */
  async withdraw(
    mint: PublicKey,
    userTokenAccount: PublicKey,
    amount: number
  ): Promise<string> {
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
   */
  async verifyVAA(vaaHash: Buffer): Promise<string> {
    const [bridgeState, bridgeStateBump] = await PublicKey.findProgramAddress(
      [Buffer.from('bridge_state')],
      this.program.programId
    );

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
   */
  async executeBundle(
    bundleId: number,
    transactionCount: number,
    merkleRoot: Buffer
  ): Promise<string> {
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
   */
  async lockLiquidity(
    mint: PublicKey,
    tokenAmount: number,
    baseAmount: number,
    lockPeriod: number
  ): Promise<string> {
    const [tokenInfo, tokenInfoBump] = await PublicKey.findProgramAddress(
      [Buffer.from('token_info'), mint.toBuffer()],
      this.program.programId
    );

    const [liquidityLock, liquidityLockBump] = await PublicKey.findProgramAddress(
      [Buffer.from('liquidity_lock'), mint.toBuffer(), this.wallet.publicKey.toBuffer()],
      this.program.programId
    );

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
    const [tokenInfo, tokenInfoBump] = await PublicKey.findProgramAddress(
      [Buffer.from('token_info'), mint.toBuffer()],
      this.program.programId
    );

    const [launchpadInfo, launchpadInfoBump] = await PublicKey.findProgramAddress(
      [Buffer.from('launchpad_info'), mint.toBuffer()],
      this.program.programId
    );

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
   */
  async contributePresale(
    mint: PublicKey,
    userTokenAccount: PublicKey,
    amount: number
  ): Promise<string> {
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
   */
  async finalizePresale(mint: PublicKey): Promise<string> {
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
   */
  async executeBuyback(mint: PublicKey, amount: number): Promise<string> {
    const [tokenInfo, tokenInfoBump] = await PublicKey.findProgramAddress(
      [Buffer.from('token_info'), mint.toBuffer()],
      this.program.programId
    );

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
   */
  async executeBurn(
    mint: PublicKey,
    tokenAccount: PublicKey,
    amount: number
  ): Promise<string> {
    const [tokenInfo, tokenInfoBump] = await PublicKey.findProgramAddress(
      [Buffer.from('token_info'), mint.toBuffer()],
      this.program.programId
    );

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
   */
  async getTokenInfo(mint: PublicKey): Promise<any> {
    const [tokenInfo, bump] = await PublicKey.findProgramAddress(
      [Buffer.from('token_info'), mint.toBuffer()],
      this.program.programId
    );

    return await this.program.account.tokenInfo.fetch(tokenInfo);
  }

  /**
   * Ottiene le informazioni di un launchpad
   */
  async getLaunchpadInfo(mint: PublicKey): Promise<any> {
    const [launchpadInfo, bump] = await PublicKey.findProgramAddress(
      [Buffer.from('launchpad_info'), mint.toBuffer()],
      this.program.programId
    );

    return await this.program.account.launchpadInfo.fetch(launchpadInfo);
  }

  /**
   * Ottiene lo stato di una presale
   */
  async getPresaleState(mint: PublicKey): Promise<any> {
    const [presaleState, bump] = await PublicKey.findProgramAddress(
      [Buffer.from('presale_state'), mint.toBuffer()],
      this.program.programId
    );

    return await this.program.account.presaleState.fetch(presaleState);
  }

  /**
   * Ottiene la contribuzione di un utente a una presale
   */
  async getContribution(user: PublicKey, mint: PublicKey): Promise<any> {
    const [contribution, bump] = await PublicKey.findProgramAddress(
      [Buffer.from('contribution'), user.toBuffer(), mint.toBuffer()],
      this.program.programId
    );

    return await this.program.account.contribution.fetch(contribution);
  }

  /**
   * Ottiene le informazioni di un blocco di liquidità
   */
  async getLiquidityLock(owner: PublicKey, mint: PublicKey): Promise<any> {
    const [liquidityLock, bump] = await PublicKey.findProgramAddress(
      [Buffer.from('liquidity_lock'), mint.toBuffer(), owner.toBuffer()],
      this.program.programId
    );

    return await this.program.account.liquidityLock.fetch(liquidityLock);
  }
}

export default Layer2Client;
