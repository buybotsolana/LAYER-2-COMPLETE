/**
 * @file token_program.test.ts
 * @description Comprehensive tests for the token program using Anchor framework.
 * This file contains tests for all functionality of the token program, including
 * initialization, tax processing, buyback, burn, liquidity locking, anti-rug mechanisms,
 * launch management, market maker operations, and bundle execution.
 */

import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { TokenProgram } from '../target/types/token_program';
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { expect } from 'chai';

describe('token_program', () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TokenProgram as Program<TokenProgram>;
  
  // Generate keypairs for testing
  const tokenMintAuthority = anchor.web3.Keypair.generate();
  const tokenAuthority = anchor.web3.Keypair.generate();
  const treasuryWallet = anchor.web3.Keypair.generate();
  const buybackWallet = anchor.web3.Keypair.generate();
  const insuranceFundWallet = anchor.web3.Keypair.generate();
  const user1 = anchor.web3.Keypair.generate();
  const user2 = anchor.web3.Keypair.generate();
  
  // Token mint and accounts
  let tokenMint: anchor.web3.PublicKey;
  let tokenConfigPDA: anchor.web3.PublicKey;
  let tokenStatsPDA: anchor.web3.PublicKey;
  let liquidityLockPDA: anchor.web3.PublicKey;
  let buybackQueuePDA: anchor.web3.PublicKey;
  let burnQueuePDA: anchor.web3.PublicKey;
  let antiRugInfoPDA: anchor.web3.PublicKey;
  let launchInfoPDA: anchor.web3.PublicKey;
  let marketMakerConfigPDA: anchor.web3.PublicKey;
  let bundleConfigPDA: anchor.web3.PublicKey;
  
  // Token accounts
  let authorityTokenAccount: anchor.web3.PublicKey;
  let treasuryTokenAccount: anchor.web3.PublicKey;
  let buybackTokenAccount: anchor.web3.PublicKey;
  let user1TokenAccount: anchor.web3.PublicKey;
  let user2TokenAccount: anchor.web3.PublicKey;
  let liquidityPoolTokenAccount: anchor.web3.PublicKey;
  
  // PDA bumps
  let tokenConfigBump: number;
  let tokenStatsBump: number;
  let liquidityLockBump: number;
  let buybackQueueBump: number;
  let burnQueueBump: number;
  let antiRugInfoBump: number;
  let launchInfoBump: number;
  let marketMakerConfigBump: number;
  let bundleConfigBump: number;
  
  // Constants for testing
  const INITIAL_MINT_AMOUNT = 1_000_000_000; // 1 billion tokens
  const BUY_TAX_BPS = 500; // 5%
  const SELL_TAX_BPS = 800; // 8%
  const TRANSFER_TAX_BPS = 300; // 3%
  const BUYBACK_ALLOCATION_BPS = 3000; // 30%
  const TREASURY_ALLOCATION_BPS = 3000; // 30%
  const LIQUIDITY_ALLOCATION_BPS = 2000; // 20%
  const BURN_ALLOCATION_BPS = 2000; // 20%
  const BUYBACK_THRESHOLD = 1000; // 1000 tokens
  const BURN_THRESHOLD = 1000; // 1000 tokens
  const MAX_TRANSACTION_BPS = 100; // 1% of total supply
  const MAX_WALLET_BPS = 500; // 5% of total supply
  
  // Progressive tax thresholds and rates
  const PROGRESSIVE_TAX_THRESHOLDS = [
    1000, // 1,000 tokens
    10000, // 10,000 tokens
    100000, // 100,000 tokens
    1000000, // 1,000,000 tokens
    10000000, // 10,000,000 tokens
  ];
  
  const PROGRESSIVE_TAX_RATES = [
    800, // 8%
    1000, // 10%
    1200, // 12%
    1500, // 15%
    2000, // 20%
  ];
  
  // Setup before tests
  before(async () => {
    // Airdrop SOL to test accounts
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(tokenAuthority.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL)
    );
    
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(tokenMintAuthority.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL)
    );
    
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user1.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL)
    );
    
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user2.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL)
    );
    
    // Create token mint
    tokenMint = await createMint(
      provider.connection,
      tokenMintAuthority,
      tokenMintAuthority.publicKey,
      null,
      9 // 9 decimals
    );
    
    // Create token accounts
    authorityTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      tokenAuthority,
      tokenMint,
      tokenAuthority.publicKey
    );
    
    treasuryTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      tokenAuthority,
      tokenMint,
      treasuryWallet.publicKey
    );
    
    buybackTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      tokenAuthority,
      tokenMint,
      buybackWallet.publicKey
    );
    
    user1TokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      user1,
      tokenMint,
      user1.publicKey
    );
    
    user2TokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      user2,
      tokenMint,
      user2.publicKey
    );
    
    // Create a liquidity pool token account (simplified for testing)
    liquidityPoolTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      tokenAuthority,
      tokenMint,
      tokenAuthority.publicKey
    );
    
    // Mint initial tokens to authority
    await mintTo(
      provider.connection,
      tokenMintAuthority,
      tokenMint,
      authorityTokenAccount,
      tokenMintAuthority.publicKey,
      INITIAL_MINT_AMOUNT
    );
    
    // Mint initial tokens to liquidity pool
    await mintTo(
      provider.connection,
      tokenMintAuthority,
      tokenMint,
      liquidityPoolTokenAccount,
      tokenMintAuthority.publicKey,
      INITIAL_MINT_AMOUNT / 2
    );
    
    // Find PDA addresses
    [tokenConfigPDA, tokenConfigBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from('token_config'), tokenMint.toBuffer()],
      program.programId
    );
    
    [tokenStatsPDA, tokenStatsBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from('token_stats'), tokenMint.toBuffer()],
      program.programId
    );
    
    [liquidityLockPDA, liquidityLockBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from('liquidity_lock'), tokenMint.toBuffer()],
      program.programId
    );
    
    [buybackQueuePDA, buybackQueueBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from('buyback_queue'), tokenMint.toBuffer()],
      program.programId
    );
    
    [burnQueuePDA, burnQueueBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from('burn_queue'), tokenMint.toBuffer()],
      program.programId
    );
    
    [antiRugInfoPDA, antiRugInfoBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from('anti_rug_info'), tokenMint.toBuffer()],
      program.programId
    );
    
    [launchInfoPDA, launchInfoBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from('launch_info'), tokenMint.toBuffer()],
      program.programId
    );
    
    [marketMakerConfigPDA, marketMakerConfigBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from('market_maker_config'), tokenMint.toBuffer()],
      program.programId
    );
    
    [bundleConfigPDA, bundleConfigBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from('bundle_config'), tokenMint.toBuffer()],
      program.programId
    );
  });
  
  /**
   * Test suite for token configuration initialization and management
   */
  describe('Token Configuration', () => {
    it('should initialize token config', async () => {
      await program.methods
        .initializeTokenConfig(
          tokenConfigBump,
          BUY_TAX_BPS,
          SELL_TAX_BPS,
          TRANSFER_TAX_BPS,
          PROGRESSIVE_TAX_THRESHOLDS,
          PROGRESSIVE_TAX_RATES,
          BUYBACK_ALLOCATION_BPS,
          TREASURY_ALLOCATION_BPS,
          LIQUIDITY_ALLOCATION_BPS,
          BURN_ALLOCATION_BPS,
          BUYBACK_THRESHOLD,
          BURN_THRESHOLD,
          MAX_TRANSACTION_BPS,
          MAX_WALLET_BPS,
          true, // anti_whale_enabled
          true, // buyback_enabled
          false, // launch_mode_enabled
          86400, // launch_mode_duration (1 day)
          true // trading_enabled
        )
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          authority: tokenAuthority.publicKey,
          treasuryWallet: treasuryWallet.publicKey,
          buybackWallet: buybackWallet.publicKey,
          liquidityPool: liquidityPoolTokenAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Fetch and verify the token config
      const tokenConfig = await program.account.tokenConfig.fetch(tokenConfigPDA);
      expect(tokenConfig.tokenMint.toString()).to.equal(tokenMint.toString());
      expect(tokenConfig.authority.toString()).to.equal(tokenAuthority.publicKey.toString());
      expect(tokenConfig.treasuryWallet.toString()).to.equal(treasuryWallet.publicKey.toString());
      expect(tokenConfig.buybackWallet.toString()).to.equal(buybackWallet.publicKey.toString());
      expect(tokenConfig.buyTaxBps).to.equal(BUY_TAX_BPS);
      expect(tokenConfig.sellTaxBps).to.equal(SELL_TAX_BPS);
      expect(tokenConfig.transferTaxBps).to.equal(TRANSFER_TAX_BPS);
      expect(tokenConfig.buybackAllocationBps).to.equal(BUYBACK_ALLOCATION_BPS);
      expect(tokenConfig.treasuryAllocationBps).to.equal(TREASURY_ALLOCATION_BPS);
      expect(tokenConfig.liquidityAllocationBps).to.equal(LIQUIDITY_ALLOCATION_BPS);
      expect(tokenConfig.burnAllocationBps).to.equal(BURN_ALLOCATION_BPS);
      expect(tokenConfig.antiWhaleEnabled).to.be.true;
      expect(tokenConfig.buybackEnabled).to.be.true;
      expect(tokenConfig.launchModeEnabled).to.be.false;
      expect(tokenConfig.tradingEnabled).to.be.true;
    });
    
    it('should initialize token stats', async () => {
      await program.methods
        .initializeTokenStats(tokenStatsBump)
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          tokenStats: tokenStatsPDA,
          authority: tokenAuthority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Fetch and verify the token stats
      const tokenStats = await program.account.tokenStats.fetch(tokenStatsPDA);
      expect(tokenStats.tokenMint.toString()).to.equal(tokenMint.toString());
      expect(tokenStats.totalBuyVolume.toNumber()).to.equal(0);
      expect(tokenStats.totalSellVolume.toNumber()).to.equal(0);
      expect(tokenStats.totalTransferVolume.toNumber()).to.equal(0);
      expect(tokenStats.totalBuyCount.toNumber()).to.equal(0);
      expect(tokenStats.totalSellCount.toNumber()).to.equal(0);
      expect(tokenStats.totalTransferCount.toNumber()).to.equal(0);
      expect(tokenStats.totalTaxesCollected.toNumber()).to.equal(0);
    });
    
    it('should initialize liquidity lock', async () => {
      // Get current timestamp
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const lockPeriod = 30 * 24 * 60 * 60; // 30 days
      const lockUntil = currentTimestamp + lockPeriod;
      
      await program.methods
        .initializeLiquidityLock(
          liquidityLockBump,
          new anchor.BN(lockUntil),
          false // is_permanent
        )
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          liquidityLock: liquidityLockPDA,
          authority: tokenAuthority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Fetch and verify the liquidity lock
      const liquidityLock = await program.account.liquidityLock.fetch(liquidityLockPDA);
      expect(liquidityLock.tokenMint.toString()).to.equal(tokenMint.toString());
      expect(liquidityLock.liquidity_pool.toString()).to.equal(liquidityPoolTokenAccount.toString());
      expect(liquidityLock.lockedAmount.toNumber()).to.equal(0);
      expect(liquidityLock.lockedUntil.toNumber()).to.be.approximately(lockUntil, 5); // Allow small timestamp difference
      expect(liquidityLock.authority.toString()).to.equal(tokenAuthority.publicKey.toString());
      expect(liquidityLock.isPermanent).to.be.false;
      
      // Verify token config was updated
      const tokenConfig = await program.account.tokenConfig.fetch(tokenConfigPDA);
      expect(tokenConfig.liquidityLocked).to.be.true;
      expect(tokenConfig.liquidityLockUntil.toNumber()).to.be.approximately(lockUntil, 5);
    });
    
    it('should initialize buyback queue', async () => {
      await program.methods
        .initializeBuybackQueue(
          buybackQueueBump,
          new anchor.BN(BUYBACK_THRESHOLD)
        )
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          buybackQueue: buybackQueuePDA,
          authority: tokenAuthority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Fetch and verify the buyback queue
      const buybackQueue = await program.account.buybackQueue.fetch(buybackQueuePDA);
      expect(buybackQueue.tokenMint.toString()).to.equal(tokenMint.toString());
      expect(buybackQueue.accumulatedAmount.toNumber()).to.equal(0);
      expect(buybackQueue.threshold.toNumber()).to.equal(BUYBACK_THRESHOLD);
      expect(buybackQueue.buybackInProgress).to.be.false;
      expect(buybackQueue.authority.toString()).to.equal(tokenAuthority.publicKey.toString());
    });
    
    it('should initialize burn queue', async () => {
      await program.methods
        .initializeBurnQueue(
          burnQueueBump,
          new anchor.BN(BURN_THRESHOLD)
        )
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          burnQueue: burnQueuePDA,
          authority: tokenAuthority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Fetch and verify the burn queue
      const burnQueue = await program.account.burnQueue.fetch(burnQueuePDA);
      expect(burnQueue.tokenMint.toString()).to.equal(tokenMint.toString());
      expect(burnQueue.accumulatedAmount.toNumber()).to.equal(0);
      expect(burnQueue.threshold.toNumber()).to.equal(BURN_THRESHOLD);
      expect(burnQueue.burnInProgress).to.be.false;
      expect(burnQueue.authority.toString()).to.equal(tokenAuthority.publicKey.toString());
    });
    
    it('should initialize anti-rug info', async () => {
      const auditor = Buffer.alloc(32);
      Buffer.from('Certik').copy(auditor);
      
      await program.methods
        .initializeAntiRugInfo(
          antiRugInfoBump,
          true, // is_team_kyc_verified
          true, // is_contract_audited
          Array.from(auditor), // auditor
          80, // score
          new anchor.BN(1000000) // insurance_fund_amount
        )
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          antiRugInfo: antiRugInfoPDA,
          insuranceFundWallet: insuranceFundWallet.publicKey,
          authority: tokenAuthority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Fetch and verify the anti-rug info
      const antiRugInfo = await program.account.antiRugInfo.fetch(antiRugInfoPDA);
      expect(antiRugInfo.tokenMint.toString()).to.equal(tokenMint.toString());
      expect(antiRugInfo.isTeamKycVerified).to.be.true;
      expect(antiRugInfo.isContractAudited).to.be.true;
      expect(Buffer.from(antiRugInfo.auditor.slice(0, 6)).toString()).to.equal('Certik');
      expect(antiRugInfo.score).to.equal(80);
      expect(antiRugInfo.insuranceFundAmount.toNumber()).to.equal(1000000);
      expect(antiRugInfo.insuranceFundWallet.toString()).to.equal(insuranceFundWallet.publicKey.toString());
      expect(antiRugInfo.authority.toString()).to.equal(tokenAuthority.publicKey.toString());
      
      // Verify token config was updated
      const tokenConfig = await program.account.tokenConfig.fetch(tokenConfigPDA);
      expect(tokenConfig.antiRugScore).to.equal(80);
    });
    
    it('should initialize launch info', async () => {
      await program.methods
        .initializeLaunchInfo(
          launchInfoBump,
          new anchor.BN(1000000), // initial_price
          new anchor.BN(500000), // initial_liquidity
          new anchor.BN(800000), // presale_price
          true, // had_presale
          new anchor.BN(1000000) // presale_amount_raised
        )
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          launchInfo: launchInfoPDA,
          authority: tokenAuthority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Fetch and verify the launch info
      const launchInfo = await program.account.launchInfo.fetch(launchInfoPDA);
      expect(launchInfo.tokenMint.toString()).to.equal(tokenMint.toString());
      expect(launchInfo.launchTimestamp.toNumber()).to.equal(0); // Not launched yet
      expect(launchInfo.initialPrice.toNumber()).to.equal(1000000);
      expect(launchInfo.initialLiquidity.toNumber()).to.equal(500000);
      expect(launchInfo.presalePrice.toNumber()).to.equal(800000);
      expect(launchInfo.hadPresale).to.be.true;
      expect(launchInfo.presaleAmountRaised.toNumber()).to.equal(1000000);
      expect(launchInfo.status.pending).to.not.be.undefined; // Should be in Pending status
      expect(launchInfo.authority.toString()).to.equal(tokenAuthority.publicKey.toString());
    });
    
    it('should initialize market maker config', async () => {
      await program.methods
        .initializeMarketMakerConfig(
          marketMakerConfigBump,
          true, // enabled
          50, // base_spread_bps (0.5%)
          200, // max_deviation_bps (2%)
          new anchor.BN(1000000), // target_price
          new anchor.BN(10000000) // allocated_amount
        )
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          marketMakerConfig: marketMakerConfigPDA,
          authority: tokenAuthority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Fetch and verify the market maker config
      const marketMakerConfig = await program.account.marketMakerConfig.fetch(marketMakerConfigPDA);
      expect(marketMakerConfig.tokenMint.toString()).to.equal(tokenMint.toString());
      expect(marketMakerConfig.enabled).to.be.true;
      expect(marketMakerConfig.baseSpreadBps).to.equal(50);
      expect(marketMakerConfig.maxDeviationBps).to.equal(200);
      expect(marketMakerConfig.targetPrice.toNumber()).to.equal(1000000);
      expect(marketMakerConfig.allocatedAmount.toNumber()).to.equal(10000000);
      expect(marketMakerConfig.authority.toString()).to.equal(tokenAuthority.publicKey.toString());
    });
    
    it('should initialize bundle config', async () => {
      await program.methods
        .initializeBundleConfig(
          bundleConfigBump,
          true, // enabled
          100, // max_bundle_size
          60, // execution_interval (60 seconds)
          50 // min_priority
        )
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          bundleConfig: bundleConfigPDA,
          authority: tokenAuthority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Fetch and verify the bundle config
      const bundleConfig = await program.account.bundleConfig.fetch(bundleConfigPDA);
      expect(bundleConfig.tokenMint.toString()).to.equal(tokenMint.toString());
      expect(bundleConfig.enabled).to.be.true;
      expect(bundleConfig.maxBundleSize).to.equal(100);
      expect(bundleConfig.executionInterval).to.equal(60);
      expect(bundleConfig.minPriority).to.equal(50);
      expect(bundleConfig.authority.toString()).to.equal(tokenAuthority.publicKey.toString());
    });
    
    it('should update token config', async () => {
      // New tax parameters
      const newBuyTaxBps = 400; // 4%
      const newSellTaxBps = 700; // 7%
      const newTransferTaxBps = 200; // 2%
      
      await program.methods
        .updateTokenConfig(
          newBuyTaxBps,
          newSellTaxBps,
          newTransferTaxBps,
          PROGRESSIVE_TAX_THRESHOLDS,
          PROGRESSIVE_TAX_RATES,
          BUYBACK_ALLOCATION_BPS,
          TREASURY_ALLOCATION_BPS,
          LIQUIDITY_ALLOCATION_BPS,
          BURN_ALLOCATION_BPS,
          new anchor.BN(BUYBACK_THRESHOLD),
          new anchor.BN(BURN_THRESHOLD),
          MAX_TRANSACTION_BPS,
          MAX_WALLET_BPS
        )
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          authority: tokenAuthority.publicKey,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Fetch and verify the updated token config
      const tokenConfig = await program.account.tokenConfig.fetch(tokenConfigPDA);
      expect(tokenConfig.buyTaxBps).to.equal(newBuyTaxBps);
      expect(tokenConfig.sellTaxBps).to.equal(newSellTaxBps);
      expect(tokenConfig.transferTaxBps).to.equal(newTransferTaxBps);
    });
  });
  
  /**
   * Test suite for token operations with tax
   */
  describe('Token Operations with Tax', () => {
    // Transfer some tokens to users for testing
    before(async () => {
      // Transfer tokens from authority to user1
      await program.methods
        .processTransferWithTax(new anchor.BN(10000))
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          tokenStats: tokenStatsPDA,
          senderTokenAccount: authorityTokenAccount,
          recipientTokenAccount: user1TokenAccount,
          treasuryTokenAccount: treasuryTokenAccount,
          buybackTokenAccount: buybackTokenAccount,
          burnQueue: burnQueuePDA,
          sender: tokenAuthority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Verify user1 received tokens
      const user1TokenAccountInfo = await getAccount(provider.connection, user1TokenAccount);
      expect(Number(user1TokenAccountInfo.amount)).to.be.greaterThan(0);
    });
    
    it('should process transfer with tax', async () => {
      // Get initial balances
      const initialUser1Balance = (await getAccount(provider.connection, user1TokenAccount)).amount;
      const initialUser2Balance = (await getAccount(provider.connection, user2TokenAccount)).amount;
      const initialTreasuryBalance = (await getAccount(provider.connection, treasuryTokenAccount)).amount;
      const initialBuybackBalance = (await getAccount(provider.connection, buybackTokenAccount)).amount;
      
      // Transfer amount
      const transferAmount = 1000;
      
      // Process transfer with tax
      await program.methods
        .processTransferWithTax(new anchor.BN(transferAmount))
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          tokenStats: tokenStatsPDA,
          senderTokenAccount: user1TokenAccount,
          recipientTokenAccount: user2TokenAccount,
          treasuryTokenAccount: treasuryTokenAccount,
          buybackTokenAccount: buybackTokenAccount,
          burnQueue: burnQueuePDA,
          sender: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();
      
      // Get updated balances
      const updatedUser1Balance = (await getAccount(provider.connection, user1TokenAccount)).amount;
      const updatedUser2Balance = (await getAccount(provider.connection, user2TokenAccount)).amount;
      const updatedTreasuryBalance = (await getAccount(provider.connection, treasuryTokenAccount)).amount;
      const updatedBuybackBalance = (await getAccount(provider.connection, buybackTokenAccount)).amount;
      
      // Get token config for tax rates
      const tokenConfig = await program.account.tokenConfig.fetch(tokenConfigPDA);
      const transferTaxBps = tokenConfig.transferTaxBps;
      
      // Calculate expected tax
      const expectedTaxAmount = Math.floor(transferAmount * transferTaxBps / 10000);
      const expectedTransferAmount = transferAmount - expectedTaxAmount;
      
      // Calculate expected distribution
      const expectedBuybackAmount = Math.floor(expectedTaxAmount * tokenConfig.buybackAllocationBps / 10000);
      const expectedTreasuryAmount = Math.floor(expectedTaxAmount * tokenConfig.treasuryAllocationBps / 10000);
      
      // Verify balances
      expect(Number(updatedUser1Balance)).to.be.approximately(
        Number(initialUser1Balance) - transferAmount,
        5 // Allow small rounding differences
      );
      
      expect(Number(updatedUser2Balance)).to.be.approximately(
        Number(initialUser2Balance) + expectedTransferAmount,
        5
      );
      
      expect(Number(updatedTreasuryBalance)).to.be.approximately(
        Number(initialTreasuryBalance) + expectedTreasuryAmount,
        5
      );
      
      expect(Number(updatedBuybackBalance)).to.be.approximately(
        Number(initialBuybackBalance) + expectedBuybackAmount,
        5
      );
      
      // Verify token stats were updated
      const tokenStats = await program.account.tokenStats.fetch(tokenStatsPDA);
      expect(tokenStats.totalTransferCount.toNumber()).to.be.greaterThan(0);
      expect(tokenStats.totalTransferVolume.toNumber()).to.be.greaterThan(0);
      expect(tokenStats.totalTaxesCollected.toNumber()).to.be.greaterThan(0);
    });
    
    it('should process buy with tax', async () => {
      // Get initial balances
      const initialUser2Balance = (await getAccount(provider.connection, user2TokenAccount)).amount;
      const initialLiquidityPoolBalance = (await getAccount(provider.connection, liquidityPoolTokenAccount)).amount;
      const initialTreasuryBalance = (await getAccount(provider.connection, treasuryTokenAccount)).amount;
      const initialBuybackBalance = (await getAccount(provider.connection, buybackTokenAccount)).amount;
      
      // Buy amount
      const buyAmount = 2000;
      
      // Process buy with tax
      await program.methods
        .processBuyWithTax(new anchor.BN(buyAmount))
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          tokenStats: tokenStatsPDA,
          buyerTokenAccount: user2TokenAccount,
          liquidityPoolTokenAccount: liquidityPoolTokenAccount,
          treasuryTokenAccount: treasuryTokenAccount,
          buybackTokenAccount: buybackTokenAccount,
          buyer: user2.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user2])
        .rpc();
      
      // Get updated balances
      const updatedUser2Balance = (await getAccount(provider.connection, user2TokenAccount)).amount;
      const updatedLiquidityPoolBalance = (await getAccount(provider.connection, liquidityPoolTokenAccount)).amount;
      const updatedTreasuryBalance = (await getAccount(provider.connection, treasuryTokenAccount)).amount;
      const updatedBuybackBalance = (await getAccount(provider.connection, buybackTokenAccount)).amount;
      
      // Get token config for tax rates
      const tokenConfig = await program.account.tokenConfig.fetch(tokenConfigPDA);
      const buyTaxBps = tokenConfig.buyTaxBps;
      
      // Calculate expected tax
      const expectedTaxAmount = Math.floor(buyAmount * buyTaxBps / 10000);
      const expectedBuyAmount = buyAmount - expectedTaxAmount;
      
      // Calculate expected distribution
      const expectedBuybackAmount = Math.floor(expectedTaxAmount * tokenConfig.buybackAllocationBps / 10000);
      const expectedTreasuryAmount = Math.floor(expectedTaxAmount * tokenConfig.treasuryAllocationBps / 10000);
      
      // Verify balances
      expect(Number(updatedUser2Balance)).to.be.approximately(
        Number(initialUser2Balance) + expectedBuyAmount,
        5 // Allow small rounding differences
      );
      
      expect(Number(updatedLiquidityPoolBalance)).to.be.approximately(
        Number(initialLiquidityPoolBalance) - buyAmount,
        5
      );
      
      expect(Number(updatedTreasuryBalance)).to.be.approximately(
        Number(initialTreasuryBalance) + expectedTreasuryAmount,
        5
      );
      
      expect(Number(updatedBuybackBalance)).to.be.approximately(
        Number(initialBuybackBalance) + expectedBuybackAmount,
        5
      );
      
      // Verify token stats were updated
      const tokenStats = await program.account.tokenStats.fetch(tokenStatsPDA);
      expect(tokenStats.totalBuyCount.toNumber()).to.be.greaterThan(0);
      expect(tokenStats.totalBuyVolume.toNumber()).to.be.greaterThan(0);
      expect(tokenStats.totalTaxesCollected.toNumber()).to.be.greaterThan(0);
    });
    
    it('should process sell with tax', async () => {
      // Get initial balances
      const initialUser2Balance = (await getAccount(provider.connection, user2TokenAccount)).amount;
      const initialLiquidityPoolBalance = (await getAccount(provider.connection, liquidityPoolTokenAccount)).amount;
      const initialTreasuryBalance = (await getAccount(provider.connection, treasuryTokenAccount)).amount;
      const initialBuybackBalance = (await getAccount(provider.connection, buybackTokenAccount)).amount;
      
      // Sell amount
      const sellAmount = 1000;
      
      // Process sell with tax
      await program.methods
        .processSellWithTax(new anchor.BN(sellAmount))
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          tokenStats: tokenStatsPDA,
          sellerTokenAccount: user2TokenAccount,
          liquidityPoolTokenAccount: liquidityPoolTokenAccount,
          treasuryTokenAccount: treasuryTokenAccount,
          buybackTokenAccount: buybackTokenAccount,
          burnQueue: burnQueuePDA,
          seller: user2.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user2])
        .rpc();
      
      // Get updated balances
      const updatedUser2Balance = (await getAccount(provider.connection, user2TokenAccount)).amount;
      const updatedLiquidityPoolBalance = (await getAccount(provider.connection, liquidityPoolTokenAccount)).amount;
      const updatedTreasuryBalance = (await getAccount(provider.connection, treasuryTokenAccount)).amount;
      const updatedBuybackBalance = (await getAccount(provider.connection, buybackTokenAccount)).amount;
      
      // Get token config for tax rates
      const tokenConfig = await program.account.tokenConfig.fetch(tokenConfigPDA);
      const sellTaxBps = tokenConfig.sellTaxBps;
      
      // Calculate expected tax
      const expectedTaxAmount = Math.floor(sellAmount * sellTaxBps / 10000);
      const expectedSellAmount = sellAmount - expectedTaxAmount;
      
      // Calculate expected distribution
      const expectedBuybackAmount = Math.floor(expectedTaxAmount * tokenConfig.buybackAllocationBps / 10000);
      const expectedTreasuryAmount = Math.floor(expectedTaxAmount * tokenConfig.treasuryAllocationBps / 10000);
      
      // Verify balances
      expect(Number(updatedUser2Balance)).to.be.approximately(
        Number(initialUser2Balance) - sellAmount,
        5 // Allow small rounding differences
      );
      
      expect(Number(updatedLiquidityPoolBalance)).to.be.approximately(
        Number(initialLiquidityPoolBalance) + expectedSellAmount,
        5
      );
      
      expect(Number(updatedTreasuryBalance)).to.be.approximately(
        Number(initialTreasuryBalance) + expectedTreasuryAmount,
        5
      );
      
      expect(Number(updatedBuybackBalance)).to.be.approximately(
        Number(initialBuybackBalance) + expectedBuybackAmount,
        5
      );
      
      // Verify token stats were updated
      const tokenStats = await program.account.tokenStats.fetch(tokenStatsPDA);
      expect(tokenStats.totalSellCount.toNumber()).to.be.greaterThan(0);
      expect(tokenStats.totalSellVolume.toNumber()).to.be.greaterThan(0);
      expect(tokenStats.totalTaxesCollected.toNumber()).to.be.greaterThan(0);
      
      // Verify burn queue was updated
      const burnQueue = await program.account.burnQueue.fetch(burnQueuePDA);
      expect(burnQueue.accumulatedAmount.toNumber()).to.be.greaterThan(0);
    });
  });
  
  /**
   * Test suite for token launch management
   */
  describe('Token Launch Management', () => {
    it('should initialize token launch', async () => {
      await program.methods
        .initializeTokenLaunch()
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          launchInfo: launchInfoPDA,
          liquidityLock: liquidityLockPDA,
          authority: tokenAuthority.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Fetch and verify the launch info
      const launchInfo = await program.account.launchInfo.fetch(launchInfoPDA);
      expect(launchInfo.launchTimestamp.toNumber()).to.be.greaterThan(0);
      expect(launchInfo.status.inProgress).to.not.be.undefined; // Should be in InProgress status
      
      // Verify token config was updated
      const tokenConfig = await program.account.tokenConfig.fetch(tokenConfigPDA);
      expect(tokenConfig.launchModeEnabled).to.be.true;
      expect(tokenConfig.launchModeStart.toNumber()).to.be.greaterThan(0);
      expect(tokenConfig.tradingEnabled).to.be.true;
    });
    
    it('should finalize token launch', async () => {
      await program.methods
        .finalizeTokenLaunch()
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          launchInfo: launchInfoPDA,
          authority: tokenAuthority.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Fetch and verify the launch info
      const launchInfo = await program.account.launchInfo.fetch(launchInfoPDA);
      expect(launchInfo.status.completed).to.not.be.undefined; // Should be in Completed status
      
      // Verify token config was updated
      const tokenConfig = await program.account.tokenConfig.fetch(tokenConfigPDA);
      expect(tokenConfig.launchModeEnabled).to.be.false;
    });
  });
  
  /**
   * Test suite for market maker operations
   */
  describe('Market Maker Operations', () => {
    it('should execute market maker operation', async () => {
      // Get initial token stats
      const initialTokenStats = await program.account.tokenStats.fetch(tokenStatsPDA);
      
      // Execute market maker operation (buy)
      await program.methods
        .executeMarketMakerOperation(
          true, // is_buy
          new anchor.BN(5000) // amount
        )
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          marketMakerConfig: marketMakerConfigPDA,
          tokenStats: tokenStatsPDA,
          marketMakerTokenAccount: authorityTokenAccount,
          liquidityPoolTokenAccount: liquidityPoolTokenAccount,
          authority: tokenAuthority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Get updated token stats
      const updatedTokenStats = await program.account.tokenStats.fetch(tokenStatsPDA);
      
      // Verify token stats were updated
      expect(updatedTokenStats.currentPrice.toNumber()).to.be.greaterThan(0);
    });
  });
  
  /**
   * Test suite for bundle execution
   */
  describe('Bundle Execution', () => {
    it('should execute bundle', async () => {
      await program.methods
        .executeBundle()
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          bundleConfig: bundleConfigPDA,
          authority: tokenAuthority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // In a real implementation, we would verify that the bundle was executed
      // Here we just verify that the instruction doesn't fail
    });
  });
  
  /**
   * Test suite for token configuration updates
   */
  describe('Token Configuration Updates', () => {
    it('should update anti-rug info', async () => {
      const auditor = Buffer.alloc(32);
      Buffer.from('Hacken').copy(auditor);
      
      await program.methods
        .updateAntiRugInfo(
          true, // is_team_kyc_verified
          true, // is_contract_audited
          Array.from(auditor), // auditor
          90, // score
          new anchor.BN(2000000) // insurance_fund_amount
        )
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          antiRugInfo: antiRugInfoPDA,
          authority: tokenAuthority.publicKey,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Fetch and verify the anti-rug info
      const antiRugInfo = await program.account.antiRugInfo.fetch(antiRugInfoPDA);
      expect(Buffer.from(antiRugInfo.auditor.slice(0, 6)).toString()).to.equal('Hacken');
      expect(antiRugInfo.score).to.equal(90);
      expect(antiRugInfo.insuranceFundAmount.toNumber()).to.equal(2000000);
      
      // Verify token config was updated
      const tokenConfig = await program.account.tokenConfig.fetch(tokenConfigPDA);
      expect(tokenConfig.antiRugScore).to.equal(90);
    });
    
    it('should update market maker config', async () => {
      await program.methods
        .updateMarketMakerConfig(
          true, // enabled
          40, // base_spread_bps (0.4%)
          150, // max_deviation_bps (1.5%)
          new anchor.BN(1200000), // target_price
          new anchor.BN(15000000) // allocated_amount
        )
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          marketMakerConfig: marketMakerConfigPDA,
          authority: tokenAuthority.publicKey,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Fetch and verify the market maker config
      const marketMakerConfig = await program.account.marketMakerConfig.fetch(marketMakerConfigPDA);
      expect(marketMakerConfig.baseSpreadBps).to.equal(40);
      expect(marketMakerConfig.maxDeviationBps).to.equal(150);
      expect(marketMakerConfig.targetPrice.toNumber()).to.equal(1200000);
      expect(marketMakerConfig.allocatedAmount.toNumber()).to.equal(15000000);
    });
    
    it('should update bundle config', async () => {
      await program.methods
        .updateBundleConfig(
          true, // enabled
          150, // max_bundle_size
          30, // execution_interval (30 seconds)
          40 // min_priority
        )
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          bundleConfig: bundleConfigPDA,
          authority: tokenAuthority.publicKey,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Fetch and verify the bundle config
      const bundleConfig = await program.account.bundleConfig.fetch(bundleConfigPDA);
      expect(bundleConfig.maxBundleSize).to.equal(150);
      expect(bundleConfig.executionInterval).to.equal(30);
      expect(bundleConfig.minPriority).to.equal(40);
    });
    
    it('should set trading enabled/disabled', async () => {
      // Disable trading
      await program.methods
        .setTradingEnabled(false)
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          authority: tokenAuthority.publicKey,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Verify trading is disabled
      let tokenConfig = await program.account.tokenConfig.fetch(tokenConfigPDA);
      expect(tokenConfig.tradingEnabled).to.be.false;
      
      // Enable trading
      await program.methods
        .setTradingEnabled(true)
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          authority: tokenAuthority.publicKey,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Verify trading is enabled
      tokenConfig = await program.account.tokenConfig.fetch(tokenConfigPDA);
      expect(tokenConfig.tradingEnabled).to.be.true;
    });
    
    it('should set anti-whale enabled/disabled', async () => {
      // Disable anti-whale
      await program.methods
        .setAntiWhaleEnabled(false)
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          authority: tokenAuthority.publicKey,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Verify anti-whale is disabled
      let tokenConfig = await program.account.tokenConfig.fetch(tokenConfigPDA);
      expect(tokenConfig.antiWhaleEnabled).to.be.false;
      
      // Enable anti-whale
      await program.methods
        .setAntiWhaleEnabled(true)
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          authority: tokenAuthority.publicKey,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Verify anti-whale is enabled
      tokenConfig = await program.account.tokenConfig.fetch(tokenConfigPDA);
      expect(tokenConfig.antiWhaleEnabled).to.be.true;
    });
    
    it('should set buyback enabled/disabled', async () => {
      // Disable buyback
      await program.methods
        .setBuybackEnabled(false)
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          authority: tokenAuthority.publicKey,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Verify buyback is disabled
      let tokenConfig = await program.account.tokenConfig.fetch(tokenConfigPDA);
      expect(tokenConfig.buybackEnabled).to.be.false;
      
      // Enable buyback
      await program.methods
        .setBuybackEnabled(true)
        .accounts({
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPDA,
          authority: tokenAuthority.publicKey,
        })
        .signers([tokenAuthority])
        .rpc();
      
      // Verify buyback is enabled
      tokenConfig = await program.account.tokenConfig.fetch(tokenConfigPDA);
      expect(tokenConfig.buybackEnabled).to.be.true;
    });
  });
});
