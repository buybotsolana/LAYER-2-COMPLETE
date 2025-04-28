/**
 * @file layer2.ts
 * @description Test suite completo per il sistema Layer-2 con BuyBot Enterprise integrato
 * 
 * Questo file contiene test unitari e di integrazione per verificare il corretto
 * funzionamento di tutti i componenti del sistema Layer-2, inclusi depositi,
 * prelievi, bridge cross-chain, launchpad, e BuyBot.
 * 
 * @author BuyBot Solana Team
 * @version 1.0.0
 */

import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { Layer2 } from '../target/types/layer2';
import { PublicKey, Keypair, Connection, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';
import { assert, expect } from 'chai';
import { BN } from 'bn.js';

/**
 * Configurazione del provider Anchor per i test
 */
describe('Layer-2 Complete con BuyBot Enterprise', () => {
  // Configura il provider Anchor
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Carica il programma
  const program = anchor.workspace.Layer2 as Program<Layer2>;
  
  // Crea keypair per i test
  const payer = anchor.web3.Keypair.generate();
  const sequencer = anchor.web3.Keypair.generate();
  const tokenCreator = anchor.web3.Keypair.generate();
  const user1 = anchor.web3.Keypair.generate();
  const user2 = anchor.web3.Keypair.generate();
  
  // Variabili per gli account PDA
  let layer2State: PublicKey;
  let bridgeState: PublicKey;
  let tokenMint: PublicKey;
  let tokenInfo: PublicKey;
  let launchpadInfo: PublicKey;
  let presaleState: PublicKey;
  let presaleVault: PublicKey;
  
  /**
   * Setup iniziale prima di tutti i test
   * 
   * Questo hook viene eseguito una volta prima di tutti i test e
   * configura l'ambiente di test, inclusa la distribuzione di SOL
   * ai keypair di test.
   */
  before(async () => {
    // Airdrop di SOL per i test
    const connection = provider.connection;
    
    // Airdrop al payer
    const payerAirdropSignature = await connection.requestAirdrop(
      payer.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(payerAirdropSignature);
    
    // Airdrop al sequencer
    const sequencerAirdropSignature = await connection.requestAirdrop(
      sequencer.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sequencerAirdropSignature);
    
    // Airdrop al token creator
    const tokenCreatorAirdropSignature = await connection.requestAirdrop(
      tokenCreator.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(tokenCreatorAirdropSignature);
    
    // Airdrop agli utenti
    const user1AirdropSignature = await connection.requestAirdrop(
      user1.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(user1AirdropSignature);
    
    const user2AirdropSignature = await connection.requestAirdrop(
      user2.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(user2AirdropSignature);
    
    // Trova gli indirizzi PDA
    [layer2State] = await PublicKey.findProgramAddress(
      [Buffer.from('layer2_state')],
      program.programId
    );
    
    [bridgeState] = await PublicKey.findProgramAddress(
      [Buffer.from('bridge_state')],
      program.programId
    );
  });
  
  /**
   * Test di inizializzazione del sistema Layer-2
   * 
   * Questo test verifica che il sistema Layer-2 possa essere
   * inizializzato correttamente con i parametri specificati.
   */
  it('Inizializza il sistema Layer-2', async () => {
    // Parametri di inizializzazione
    const fraudProofWindow = 86400; // 1 giorno in secondi
    const finalizationWindow = 43200; // 12 ore in secondi
    
    // Esegui l'inizializzazione
    await program.methods
      .initialize({
        sequencer: sequencer.publicKey,
        fraudProofWindow: new BN(fraudProofWindow),
        finalizationWindow: new BN(finalizationWindow)
      })
      .accounts({
        authority: payer.publicKey,
        layer2State,
        systemProgram: SystemProgram.programId
      })
      .signers([payer])
      .rpc();
    
    // Verifica che lo stato sia stato inizializzato correttamente
    const state = await program.account.layer2State.fetch(layer2State);
    assert.ok(state.sequencer.equals(sequencer.publicKey));
    assert.ok(state.fraudProofWindow.eq(new BN(fraudProofWindow)));
    assert.ok(state.finalizationWindow.eq(new BN(finalizationWindow)));
    assert.ok(state.initialized);
  });
  
  /**
   * Test di creazione di un nuovo token
   * 
   * Questo test verifica che un nuovo token possa essere creato
   * tramite il launchpad, con tutti i parametri configurati correttamente.
   */
  it('Crea un nuovo token tramite il launchpad', async () => {
    // Crea un nuovo mint per il token
    tokenMint = await createMint(provider.connection, tokenCreator);
    
    // Trova gli indirizzi PDA per il token
    [tokenInfo] = await PublicKey.findProgramAddress(
      [Buffer.from('token_info'), tokenMint.toBuffer()],
      program.programId
    );
    
    [launchpadInfo] = await PublicKey.findProgramAddress(
      [Buffer.from('launchpad_info'), tokenMint.toBuffer()],
      program.programId
    );
    
    // Parametri del token
    const decimals = 9;
    const presalePrice = 100000; // 0.0001 SOL per token
    const listingPrice = 150000; // 0.00015 SOL per token
    const softCap = 10 * LAMPORTS_PER_SOL; // 10 SOL
    const hardCap = 50 * LAMPORTS_PER_SOL; // 50 SOL
    const minContribution = 0.1 * LAMPORTS_PER_SOL; // 0.1 SOL
    const maxContribution = 5 * LAMPORTS_PER_SOL; // 5 SOL
    const liquidityPercentage = 70; // 70% della liquidità
    const startTime = Math.floor(Date.now() / 1000); // Ora
    const endTime = startTime + 86400; // +1 giorno
    const enableBuybot = true;
    const taxBuy = 5; // 5%
    const taxSell = 10; // 10%
    const taxTransfer = 2; // 2%
    const liquidityLockPeriod = 15552000; // 180 giorni
    
    // Crea il token
    await program.methods
      .createToken({
        decimals,
        presalePrice: new BN(presalePrice),
        listingPrice: new BN(listingPrice),
        softCap: new BN(softCap),
        hardCap: new BN(hardCap),
        minContribution: new BN(minContribution),
        maxContribution: new BN(maxContribution),
        liquidityPercentage,
        startTime: new BN(startTime),
        endTime: new BN(endTime),
        enableBuybot,
        taxBuy,
        taxSell,
        taxTransfer,
        liquidityLockPeriod: new BN(liquidityLockPeriod)
      })
      .accounts({
        authority: tokenCreator.publicKey,
        mint: tokenMint,
        tokenInfo,
        launchpadInfo,
        systemProgram: SystemProgram.programId
      })
      .signers([tokenCreator])
      .rpc();
    
    // Verifica che il token sia stato creato correttamente
    const tokenInfoData = await program.account.tokenInfo.fetch(tokenInfo);
    assert.ok(tokenInfoData.mint.equals(tokenMint));
    assert.ok(tokenInfoData.authority.equals(tokenCreator.publicKey));
    assert.equal(tokenInfoData.decimals, decimals);
    assert.equal(tokenInfoData.enableBuybot, enableBuybot);
    assert.equal(tokenInfoData.taxBuy, taxBuy);
    assert.equal(tokenInfoData.taxSell, taxSell);
    assert.equal(tokenInfoData.taxTransfer, taxTransfer);
    assert.ok(tokenInfoData.liquidityLockPeriod.eq(new BN(liquidityLockPeriod)));
    
    // Verifica che le informazioni del launchpad siano state create correttamente
    const launchpadInfoData = await program.account.launchpadInfo.fetch(launchpadInfo);
    assert.ok(launchpadInfoData.mint.equals(tokenMint));
    assert.ok(launchpadInfoData.authority.equals(tokenCreator.publicKey));
    assert.ok(launchpadInfoData.presalePrice.eq(new BN(presalePrice)));
    assert.ok(launchpadInfoData.listingPrice.eq(new BN(listingPrice)));
    assert.ok(launchpadInfoData.softCap.eq(new BN(softCap)));
    assert.ok(launchpadInfoData.hardCap.eq(new BN(hardCap)));
    assert.ok(launchpadInfoData.minContribution.eq(new BN(minContribution)));
    assert.ok(launchpadInfoData.maxContribution.eq(new BN(maxContribution)));
    assert.equal(launchpadInfoData.liquidityPercentage, liquidityPercentage);
    assert.ok(launchpadInfoData.startTime.eq(new BN(startTime)));
    assert.ok(launchpadInfoData.endTime.eq(new BN(endTime)));
    assert.equal(launchpadInfoData.status, 0); // 0 = Pending
  });
  
  /**
   * Test di contribuzione a una presale
   * 
   * Questo test verifica che gli utenti possano contribuire a una presale
   * inviando SOL e ricevendo il diritto di reclamare token.
   */
  it('Contribuisce a una presale', async () => {
    // Trova gli indirizzi PDA per la presale
    [presaleState] = await PublicKey.findProgramAddress(
      [Buffer.from('presale_state'), tokenMint.toBuffer()],
      program.programId
    );
    
    [presaleVault] = await PublicKey.findProgramAddress(
      [Buffer.from('presale_vault'), tokenMint.toBuffer()],
      program.programId
    );
    
    // Trova l'indirizzo PDA per la contribuzione dell'utente 1
    const [contribution1] = await PublicKey.findProgramAddress(
      [Buffer.from('contribution'), user1.publicKey.toBuffer(), tokenMint.toBuffer()],
      program.programId
    );
    
    // Crea un account token per l'utente 1
    const user1TokenAccount = await createTokenAccount(
      provider.connection,
      user1,
      tokenMint,
      user1.publicKey
    );
    
    // Contribuisci alla presale come utente 1
    const contributionAmount1 = 1 * LAMPORTS_PER_SOL; // 1 SOL
    await program.methods
      .contributePresale(new BN(contributionAmount1))
      .accounts({
        user: user1.publicKey,
        userTokenAccount: user1TokenAccount,
        presaleVault,
        launchpadInfo,
        presaleState,
        contribution: contribution1,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      })
      .signers([user1])
      .rpc();
    
    // Verifica che la contribuzione sia stata registrata correttamente
    const contributionData1 = await program.account.contribution.fetch(contribution1);
    assert.ok(contributionData1.user.equals(user1.publicKey));
    assert.ok(contributionData1.mint.equals(tokenMint));
    assert.ok(contributionData1.amount.eq(new BN(contributionAmount1)));
    assert.equal(contributionData1.claimed, false);
    
    // Trova l'indirizzo PDA per la contribuzione dell'utente 2
    const [contribution2] = await PublicKey.findProgramAddress(
      [Buffer.from('contribution'), user2.publicKey.toBuffer(), tokenMint.toBuffer()],
      program.programId
    );
    
    // Crea un account token per l'utente 2
    const user2TokenAccount = await createTokenAccount(
      provider.connection,
      user2,
      tokenMint,
      user2.publicKey
    );
    
    // Contribuisci alla presale come utente 2
    const contributionAmount2 = 2 * LAMPORTS_PER_SOL; // 2 SOL
    await program.methods
      .contributePresale(new BN(contributionAmount2))
      .accounts({
        user: user2.publicKey,
        userTokenAccount: user2TokenAccount,
        presaleVault,
        launchpadInfo,
        presaleState,
        contribution: contribution2,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      })
      .signers([user2])
      .rpc();
    
    // Verifica che la contribuzione sia stata registrata correttamente
    const contributionData2 = await program.account.contribution.fetch(contribution2);
    assert.ok(contributionData2.user.equals(user2.publicKey));
    assert.ok(contributionData2.mint.equals(tokenMint));
    assert.ok(contributionData2.amount.eq(new BN(contributionAmount2)));
    assert.equal(contributionData2.claimed, false);
    
    // Verifica che lo stato della presale sia stato aggiornato correttamente
    const presaleStateData = await program.account.presaleState.fetch(presaleState);
    assert.ok(presaleStateData.totalRaised.eq(new BN(contributionAmount1 + contributionAmount2)));
    assert.equal(presaleStateData.contributorCount, 2);
  });
  
  /**
   * Test di finalizzazione di una presale
   * 
   * Questo test verifica che una presale possa essere finalizzata
   * dopo che è terminata, e che il token venga lanciato se la soft cap
   * è stata raggiunta.
   */
  it('Finalizza una presale e lancia il token', async () => {
    // Finalizza la presale
    await program.methods
      .finalizePresale()
      .accounts({
        authority: tokenCreator.publicKey,
        launchpadInfo,
        presaleState,
        tokenInfo,
        systemProgram: SystemProgram.programId
      })
      .signers([tokenCreator])
      .rpc();
    
    // Verifica che la presale sia stata finalizzata correttamente
    const launchpadInfoData = await program.account.launchpadInfo.fetch(launchpadInfo);
    assert.equal(launchpadInfoData.status, 1); // 1 = Success
    
    // Verifica che il token sia stato lanciato
    const tokenInfoData = await program.account.tokenInfo.fetch(tokenInfo);
    assert.equal(tokenInfoData.launched, true);
  });
  
  /**
   * Test di blocco della liquidità
   * 
   * Questo test verifica che la liquidità possa essere bloccata
   * per un periodo specificato, aumentando lo score anti-rug del token.
   */
  it('Blocca la liquidità per un token', async () => {
    // Trova l'indirizzo PDA per il blocco di liquidità
    const [liquidityLock] = await PublicKey.findProgramAddress(
      [Buffer.from('liquidity_lock'), tokenMint.toBuffer(), tokenCreator.publicKey.toBuffer()],
      program.programId
    );
    
    // Parametri del blocco di liquidità
    const tokenAmount = 1000000000; // 1000 token
    const baseAmount = 0.1 * LAMPORTS_PER_SOL; // 0.1 SOL
    const lockPeriod = 15552000; // 180 giorni
    
    // Blocca la liquidità
    await program.methods
      .lockLiquidity({
        tokenAmount: new BN(tokenAmount),
        baseAmount: new BN(baseAmount),
        lockPeriod: new BN(lockPeriod)
      })
      .accounts({
        owner: tokenCreator.publicKey,
        tokenInfo,
        liquidityLock,
        systemProgram: SystemProgram.programId
      })
      .signers([tokenCreator])
      .rpc();
    
    // Verifica che la liquidità sia stata bloccata correttamente
    const liquidityLockData = await program.account.liquidityLock.fetch(liquidityLock);
    assert.ok(liquidityLockData.owner.equals(tokenCreator.publicKey));
    assert.ok(liquidityLockData.mint.equals(tokenMint));
    assert.ok(liquidityLockData.tokenAmount.eq(new BN(tokenAmount)));
    assert.ok(liquidityLockData.baseAmount.eq(new BN(baseAmount)));
    assert.ok(liquidityLockData.lockPeriod.eq(new BN(lockPeriod)));
    
    // Calcola la data di sblocco
    const now = Math.floor(Date.now() / 1000);
    const unlockTime = now + lockPeriod;
    
    // Verifica che la data di sblocco sia corretta (con una tolleranza di 10 secondi)
    const unlockTimeDiff = Math.abs(liquidityLockData.unlockTime.toNumber() - unlockTime);
    assert.isBelow(unlockTimeDiff, 10);
  });
  
  /**
   * Test di esecuzione di un bundle di transazioni
   * 
   * Questo test verifica che il sequencer possa eseguire un bundle
   * di transazioni Layer-2.
   */
  it('Esegue un bundle di transazioni', async () => {
    // Parametri del bundle
    const bundleId = 1;
    const transactionCount = 10;
    const merkleRoot = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
    
    // Trova l'indirizzo PDA per il bundle
    const [bundle] = await PublicKey.findProgramAddress(
      [
        Buffer.from('bundle'),
        sequencer.publicKey.toBuffer(),
        new BN(bundleId).toArrayLike(Buffer, 'le', 8)
      ],
      program.programId
    );
    
    // Esegui il bundle
    await program.methods
      .executeBundle({
        bundleId: new BN(bundleId),
        transactionCount,
        merkleRoot: Array.from(merkleRoot)
      })
      .accounts({
        sequencer: sequencer.publicKey,
        bundle,
        layer2State,
        systemProgram: SystemProgram.programId
      })
      .signers([sequencer])
      .rpc();
    
    // Verifica che il bundle sia stato eseguito correttamente
    const bundleData = await program.account.bundle.fetch(bundle);
    assert.ok(bundleData.sequencer.equals(sequencer.publicKey));
    assert.ok(bundleData.bundleId.eq(new BN(bundleId)));
    assert.equal(bundleData.transactionCount, transactionCount);
    
    // Verifica che il merkle root sia stato memorizzato correttamente
    const storedMerkleRoot = Buffer.from(bundleData.merkleRoot);
    assert.deepEqual(storedMerkleRoot, merkleRoot);
  });
  
  /**
   * Test di esecuzione di un'operazione di buyback
   * 
   * Questo test verifica che l'autorità di un token possa eseguire
   * un'operazione di buyback, utilizzando SOL per acquistare token
   * dal mercato.
   */
  it('Esegue un\'operazione di buyback', async () => {
    // Parametri del buyback
    const amount = 0.5 * LAMPORTS_PER_SOL; // 0.5 SOL
    
    // Esegui il buyback
    await program.methods
      .executeBuyback(new BN(amount))
      .accounts({
        authority: tokenCreator.publicKey,
        tokenInfo,
        systemProgram: SystemProgram.programId
      })
      .signers([tokenCreator])
      .rpc();
    
    // Verifica che il buyback sia stato eseguito correttamente
    const tokenInfoData = await program.account.tokenInfo.fetch(tokenInfo);
    assert.ok(tokenInfoData.totalBuyback.eq(new BN(amount)));
  });
  
  /**
   * Test di verifica di un VAA di Wormhole
   * 
   * Questo test verifica che un VAA di Wormhole possa essere verificato
   * per il bridge cross-chain.
   */
  it('Verifica un VAA di Wormhole', async () => {
    // Parametri del VAA
    const vaaHash = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
    
    // Verifica il VAA
    await program.methods
      .verifyVaa(Array.from(vaaHash))
      .accounts({
        authority: payer.publicKey,
        bridgeState,
        systemProgram: SystemProgram.programId
      })
      .signers([payer])
      .rpc();
    
    // Verifica che il VAA sia stato verificato correttamente
    const bridgeStateData = await program.account.bridgeState.fetch(bridgeState);
    assert.equal(bridgeStateData.verifiedVaas, 1);
  });
});

/**
 * Funzione di utilità per creare un mint di token
 * 
 * @param connection - Connessione a Solana
 * @param payer - Keypair del pagatore
 * @returns Promise con la chiave pubblica del mint
 */
async function createMint(connection: Connection, payer: Keypair): Promise<PublicKey> {
  const token = await Token.createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    9,
    TOKEN_PROGRAM_ID
  );
  
  return token.publicKey;
}

/**
 * Funzione di utilità per creare un account token
 * 
 * @param connection - Connessione a Solana
 * @param payer - Keypair del pagatore
 * @param mint - Chiave pubblica del mint
 * @param owner - Chiave pubblica del proprietario
 * @returns Promise con la chiave pubblica dell'account token
 */
async function createTokenAccount(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  const token = new Token(connection, mint, TOKEN_PROGRAM_ID, payer);
  const tokenAccount = await token.createAccount(owner);
  
  return tokenAccount;
}
