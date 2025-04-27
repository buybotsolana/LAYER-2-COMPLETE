import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { PublicKey, Connection, Keypair, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';
import { Layer2 } from '../target/types/layer2';
import { expect } from 'chai';
import { Layer2Client } from '../sdk';

describe('Layer2 Tests', () => {
  // Configura il provider Anchor
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Carica il programma
  const program = anchor.workspace.Layer2 as Program<Layer2>;
  
  // Crea un client Layer2
  const layer2Client = new Layer2Client(
    provider.connection,
    provider.wallet as anchor.Wallet
  );
  
  // Genera keypair per i test
  const payer = anchor.web3.Keypair.generate();
  const sequencer = anchor.web3.Keypair.generate();
  const mintAuthority = anchor.web3.Keypair.generate();
  
  // Variabili per i test
  let mint: PublicKey;
  let userTokenAccount: PublicKey;
  
  before(async () => {
    // Airdrop di SOL al payer
    const airdropSignature = await provider.connection.requestAirdrop(
      payer.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    
    await provider.connection.confirmTransaction(airdropSignature);
    
    // Crea un nuovo token per i test
    const token = await Token.createMint(
      provider.connection,
      payer,
      mintAuthority.publicKey,
      null,
      9,
      TOKEN_PROGRAM_ID
    );
    
    mint = token.publicKey;
    
    // Crea un account token per l'utente
    userTokenAccount = await token.createAccount(provider.wallet.publicKey);
    
    // Minta alcuni token all'utente
    await token.mintTo(
      userTokenAccount,
      mintAuthority.publicKey,
      [mintAuthority],
      1000000000
    );
  });
  
  it('Inizializza il sistema Layer-2', async () => {
    const tx = await layer2Client.initialize(
      sequencer.publicKey,
      86400, // 1 giorno per la finestra di fraud proof
      43200  // 12 ore per la finestra di finalizzazione
    );
    
    // Verifica che la transazione sia stata confermata
    await provider.connection.confirmTransaction(tx);
    
    // Ottieni l'account Layer2State
    const [layer2State, _] = await PublicKey.findProgramAddress(
      [Buffer.from('layer2_state')],
      program.programId
    );
    
    const state = await program.account.layer2State.fetch(layer2State);
    
    // Verifica che lo stato sia stato inizializzato correttamente
    expect(state.authority.toString()).to.equal(provider.wallet.publicKey.toString());
    expect(state.sequencer.toString()).to.equal(sequencer.publicKey.toString());
    expect(state.isActive).to.be.true;
    expect(state.version).to.equal(1);
    expect(state.fraudProofWindow.toNumber()).to.equal(86400);
    expect(state.finalizationWindow.toNumber()).to.equal(43200);
  });
  
  it('Registra un token nel sistema', async () => {
    const bridgeSource = Buffer.alloc(32, 0);
    
    const tx = await layer2Client.registerToken(
      mint,
      true, // isNative
      bridgeSource,
      true, // enableBuybot
      5,    // taxBuy (5%)
      10,   // taxSell (10%)
      2,    // taxTransfer (2%)
      15552000 // liquidityLockPeriod (180 giorni in secondi)
    );
    
    // Verifica che la transazione sia stata confermata
    await provider.connection.confirmTransaction(tx);
    
    // Ottieni le informazioni del token
    const tokenInfo = await layer2Client.getTokenInfo(mint);
    
    // Verifica che il token sia stato registrato correttamente
    expect(tokenInfo.mint.toString()).to.equal(mint.toString());
    expect(tokenInfo.authority.toString()).to.equal(provider.wallet.publicKey.toString());
    expect(tokenInfo.isActive).to.be.true;
    expect(tokenInfo.isNative).to.be.true;
    expect(tokenInfo.buybotEnabled).to.be.true;
    expect(tokenInfo.taxBuy).to.equal(5);
    expect(tokenInfo.taxSell).to.equal(10);
    expect(tokenInfo.taxTransfer).to.equal(2);
    expect(tokenInfo.liquidityLockPeriod.toNumber()).to.equal(15552000);
  });
  
  it('Crea un token tramite il launchpad', async () => {
    // Genera un nuovo keypair per il mint
    const newMintKeypair = anchor.web3.Keypair.generate();
    
    // Crea il token tramite il launchpad
    const tx = await layer2Client.createToken(
      newMintKeypair.publicKey,
      {
        decimals: 9,
        presalePrice: 100000, // 0.0001 SOL per token
        listingPrice: 200000, // 0.0002 SOL per token
        softCap: 10 * anchor.web3.LAMPORTS_PER_SOL, // 10 SOL
        hardCap: 50 * anchor.web3.LAMPORTS_PER_SOL, // 50 SOL
        minContribution: 0.1 * anchor.web3.LAMPORTS_PER_SOL, // 0.1 SOL
        maxContribution: 5 * anchor.web3.LAMPORTS_PER_SOL, // 5 SOL
        liquidityPercentage: 80, // 80% della liquidità
        startTime: Math.floor(Date.now() / 1000), // Ora
        endTime: Math.floor(Date.now() / 1000) + 604800, // Una settimana da ora
        enableBuybot: true,
        taxBuy: 5,
        taxSell: 10,
        taxTransfer: 2,
        liquidityLockPeriod: 15552000 // 180 giorni in secondi
      }
    );
    
    // Verifica che la transazione sia stata confermata
    await provider.connection.confirmTransaction(tx);
    
    // Ottieni le informazioni del launchpad
    const launchpadInfo = await layer2Client.getLaunchpadInfo(newMintKeypair.publicKey);
    
    // Verifica che il launchpad sia stato creato correttamente
    expect(launchpadInfo.mint.toString()).to.equal(newMintKeypair.publicKey.toString());
    expect(launchpadInfo.creator.toString()).to.equal(provider.wallet.publicKey.toString());
    expect(launchpadInfo.presalePrice.toNumber()).to.equal(100000);
    expect(launchpadInfo.listingPrice.toNumber()).to.equal(200000);
    expect(launchpadInfo.softCap.toNumber()).to.equal(10 * anchor.web3.LAMPORTS_PER_SOL);
    expect(launchpadInfo.hardCap.toNumber()).to.equal(50 * anchor.web3.LAMPORTS_PER_SOL);
    expect(launchpadInfo.minContribution.toNumber()).to.equal(0.1 * anchor.web3.LAMPORTS_PER_SOL);
    expect(launchpadInfo.maxContribution.toNumber()).to.equal(5 * anchor.web3.LAMPORTS_PER_SOL);
    expect(launchpadInfo.liquidityPercentage).to.equal(80);
    expect(launchpadInfo.status.created).to.exist;
    
    // Ottieni le informazioni del token
    const tokenInfo = await layer2Client.getTokenInfo(newMintKeypair.publicKey);
    
    // Verifica che il token sia stato registrato correttamente
    expect(tokenInfo.mint.toString()).to.equal(newMintKeypair.publicKey.toString());
    expect(tokenInfo.buybotEnabled).to.be.true;
    expect(tokenInfo.taxBuy).to.equal(5);
    expect(tokenInfo.taxSell).to.equal(10);
    expect(tokenInfo.taxTransfer).to.equal(2);
  });
  
  it('Blocca la liquidità per un token', async () => {
    const tx = await layer2Client.lockLiquidity(
      mint,
      500000000, // 500 token
      1 * anchor.web3.LAMPORTS_PER_SOL, // 1 SOL
      15552000 // 180 giorni in secondi
    );
    
    // Verifica che la transazione sia stata confermata
    await provider.connection.confirmTransaction(tx);
    
    // Ottieni le informazioni del blocco di liquidità
    const liquidityLock = await layer2Client.getLiquidityLock(
      provider.wallet.publicKey,
      mint
    );
    
    // Verifica che la liquidità sia stata bloccata correttamente
    expect(liquidityLock.owner.toString()).to.equal(provider.wallet.publicKey.toString());
    expect(liquidityLock.mint.toString()).to.equal(mint.toString());
    expect(liquidityLock.tokenAmount.toNumber()).to.equal(500000000);
    expect(liquidityLock.baseAmount.toNumber()).to.equal(1 * anchor.web3.LAMPORTS_PER_SOL);
    expect(liquidityLock.isLocked).to.be.true;
    
    // Verifica che lo score anti-rug sia stato aggiornato
    const tokenInfo = await layer2Client.getTokenInfo(mint);
    expect(tokenInfo.antiRugScore).to.be.at.least(20);
  });
  
  // Test per verificare la CPI verso Wormhole (simulato)
  it('Verifica un VAA di Wormhole', async () => {
    const vaaHash = Buffer.alloc(32, 1); // VAA hash di esempio
    
    const tx = await layer2Client.verifyVAA(vaaHash);
    
    // Verifica che la transazione sia stata confermata
    await provider.connection.confirmTransaction(tx);
    
    // Ottieni lo stato del bridge
    const [bridgeState, _] = await PublicKey.findProgramAddress(
      [Buffer.from('bridge_state')],
      program.programId
    );
    
    const state = await program.account.bridgeState.fetch(bridgeState);
    
    // Verifica che il VAA sia stato verificato correttamente
    expect(state.isVerified).to.be.true;
    expect(Buffer.from(state.vaaHash)).to.deep.equal(vaaHash);
  });
  
  // Test per il buyback e burn
  it('Esegue operazioni di buyback e burn', async () => {
    // Esegue un buyback
    const buybackTx = await layer2Client.executeBuyback(
      mint,
      100000000 // 100 token
    );
    
    // Verifica che la transazione sia stata confermata
    await provider.connection.confirmTransaction(buybackTx);
    
    // Esegue un burn
    const burnTx = await layer2Client.executeBurn(
      mint,
      userTokenAccount,
      50000000 // 50 token
    );
    
    // Verifica che la transazione sia stata confermata
    await provider.connection.confirmTransaction(burnTx);
    
    // Verifica il saldo dell'account token dopo il burn
    const tokenAccountInfo = await provider.connection.getTokenAccountBalance(userTokenAccount);
    expect(parseInt(tokenAccountInfo.value.amount)).to.be.at.most(950000000); // 1000 - 50 = 950 token
  });
});
