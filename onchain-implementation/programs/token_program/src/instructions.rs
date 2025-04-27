/**
 * @file instructions.rs
 * @description Defines all instructions and their handlers for the token program.
 * This file contains the implementation of all instruction handlers, including
 * validation logic, business logic, and account validation using Anchor constraints.
 */

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer, Burn, MintTo};
use anchor_spl::associated_token::AssociatedToken;
use solana_program::program::invoke_signed;
use solana_program::system_instruction;

use crate::state::*;
use crate::errors::*;

/// Initialize a new token configuration
/// This instruction creates a new TokenConfig account for a token
/// and initializes it with the provided parameters.
#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct InitializeTokenConfig<'info> {
    /// The token mint
    #[account(mut)]
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account to be created
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<TokenConfig>(),
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The authority that can update the config
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// The treasury wallet that receives a portion of the taxes
    /// CHECK: This is just a pubkey that will receive funds
    pub treasury_wallet: UncheckedAccount<'info>,
    
    /// The buyback wallet that accumulates funds for buyback operations
    /// CHECK: This is just a pubkey that will receive funds
    pub buyback_wallet: UncheckedAccount<'info>,
    
    /// The liquidity pool address
    /// CHECK: This is just a pubkey that represents the liquidity pool
    pub liquidity_pool: UncheckedAccount<'info>,
    
    /// System program
    pub system_program: Program<'info, System>,
    
    /// Token program
    pub token_program: Program<'info, Token>,
    
    /// Rent sysvar
    pub rent: Sysvar<'info, Rent>,
}

/// Initialize token statistics
/// This instruction creates a new TokenStats account for a token
/// and initializes it with default values.
#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct InitializeTokenStats<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The token stats account to be created
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<TokenStats>(),
        seeds = [b"token_stats", token_mint.key().as_ref()],
        bump
    )]
    pub token_stats: Account<'info, TokenStats>,
    
    /// The authority that can initialize the stats
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// System program
    pub system_program: Program<'info, System>,
    
    /// Rent sysvar
    pub rent: Sysvar<'info, Rent>,
}

/// Initialize liquidity lock
/// This instruction creates a new LiquidityLock account for a token
/// and initializes it with the provided parameters.
#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct InitializeLiquidityLock<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The liquidity lock account to be created
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<LiquidityLock>(),
        seeds = [b"liquidity_lock", token_mint.key().as_ref()],
        bump
    )]
    pub liquidity_lock: Account<'info, LiquidityLock>,
    
    /// The authority that can initialize the liquidity lock
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// System program
    pub system_program: Program<'info, System>,
    
    /// Rent sysvar
    pub rent: Sysvar<'info, Rent>,
}

/// Initialize buyback queue
/// This instruction creates a new BuybackQueue account for a token
/// and initializes it with the provided parameters.
#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct InitializeBuybackQueue<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The buyback queue account to be created
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<BuybackQueue>(),
        seeds = [b"buyback_queue", token_mint.key().as_ref()],
        bump
    )]
    pub buyback_queue: Account<'info, BuybackQueue>,
    
    /// The authority that can initialize the buyback queue
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// System program
    pub system_program: Program<'info, System>,
    
    /// Rent sysvar
    pub rent: Sysvar<'info, Rent>,
}

/// Initialize burn queue
/// This instruction creates a new BurnQueue account for a token
/// and initializes it with the provided parameters.
#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct InitializeBurnQueue<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The burn queue account to be created
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<BurnQueue>(),
        seeds = [b"burn_queue", token_mint.key().as_ref()],
        bump
    )]
    pub burn_queue: Account<'info, BurnQueue>,
    
    /// The authority that can initialize the burn queue
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// System program
    pub system_program: Program<'info, System>,
    
    /// Rent sysvar
    pub rent: Sysvar<'info, Rent>,
}

/// Initialize anti-rug info
/// This instruction creates a new AntiRugInfo account for a token
/// and initializes it with the provided parameters.
#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct InitializeAntiRugInfo<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The anti-rug info account to be created
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<AntiRugInfo>(),
        seeds = [b"anti_rug_info", token_mint.key().as_ref()],
        bump
    )]
    pub anti_rug_info: Account<'info, AntiRugInfo>,
    
    /// The insurance fund wallet
    /// CHECK: This is just a pubkey that will hold the insurance fund
    pub insurance_fund_wallet: UncheckedAccount<'info>,
    
    /// The authority that can initialize the anti-rug info
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// System program
    pub system_program: Program<'info, System>,
    
    /// Rent sysvar
    pub rent: Sysvar<'info, Rent>,
}

/// Initialize launch info
/// This instruction creates a new LaunchInfo account for a token
/// and initializes it with the provided parameters.
#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct InitializeLaunchInfo<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The launch info account to be created
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<LaunchInfo>(),
        seeds = [b"launch_info", token_mint.key().as_ref()],
        bump
    )]
    pub launch_info: Account<'info, LaunchInfo>,
    
    /// The authority that can initialize the launch info
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// System program
    pub system_program: Program<'info, System>,
    
    /// Rent sysvar
    pub rent: Sysvar<'info, Rent>,
}

/// Initialize market maker config
/// This instruction creates a new MarketMakerConfig account for a token
/// and initializes it with the provided parameters.
#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct InitializeMarketMakerConfig<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The market maker config account to be created
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<MarketMakerConfig>(),
        seeds = [b"market_maker_config", token_mint.key().as_ref()],
        bump
    )]
    pub market_maker_config: Account<'info, MarketMakerConfig>,
    
    /// The authority that can initialize the market maker config
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// System program
    pub system_program: Program<'info, System>,
    
    /// Rent sysvar
    pub rent: Sysvar<'info, Rent>,
}

/// Initialize bundle config
/// This instruction creates a new BundleConfig account for a token
/// and initializes it with the provided parameters.
#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct InitializeBundleConfig<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The bundle config account to be created
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<BundleConfig>(),
        seeds = [b"bundle_config", token_mint.key().as_ref()],
        bump
    )]
    pub bundle_config: Account<'info, BundleConfig>,
    
    /// The authority that can initialize the bundle config
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// System program
    pub system_program: Program<'info, System>,
    
    /// Rent sysvar
    pub rent: Sysvar<'info, Rent>,
}

/// Update token config
/// This instruction updates an existing TokenConfig account with new parameters.
#[derive(Accounts)]
pub struct UpdateTokenConfig<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account to be updated
    #[account(
        mut,
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The authority that can update the config
    pub authority: Signer<'info>,
}

/// Process a token transfer with tax
/// This instruction processes a token transfer, applying the appropriate tax
/// and distributing it according to the token configuration.
#[derive(Accounts)]
pub struct ProcessTransferWithTax<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The token stats account
    #[account(
        mut,
        seeds = [b"token_stats", token_mint.key().as_ref()],
        bump
    )]
    pub token_stats: Account<'info, TokenStats>,
    
    /// The sender's token account
    #[account(mut)]
    pub sender_token_account: Account<'info, TokenAccount>,
    
    /// The recipient's token account
    #[account(mut)]
    pub recipient_token_account: Account<'info, TokenAccount>,
    
    /// The treasury token account
    #[account(mut)]
    pub treasury_token_account: Account<'info, TokenAccount>,
    
    /// The buyback token account
    #[account(mut)]
    pub buyback_token_account: Account<'info, TokenAccount>,
    
    /// The burn queue account
    #[account(
        mut,
        seeds = [b"burn_queue", token_mint.key().as_ref()],
        bump
    )]
    pub burn_queue: Account<'info, BurnQueue>,
    
    /// The sender who must sign the transaction
    pub sender: Signer<'info>,
    
    /// Token program
    pub token_program: Program<'info, Token>,
}

/// Process a token buy with tax
/// This instruction processes a token buy, applying the appropriate tax
/// and distributing it according to the token configuration.
#[derive(Accounts)]
pub struct ProcessBuyWithTax<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The token stats account
    #[account(
        mut,
        seeds = [b"token_stats", token_mint.key().as_ref()],
        bump
    )]
    pub token_stats: Account<'info, TokenStats>,
    
    /// The buyer's token account
    #[account(mut)]
    pub buyer_token_account: Account<'info, TokenAccount>,
    
    /// The liquidity pool token account
    #[account(mut)]
    pub liquidity_pool_token_account: Account<'info, TokenAccount>,
    
    /// The treasury token account
    #[account(mut)]
    pub treasury_token_account: Account<'info, TokenAccount>,
    
    /// The buyback token account
    #[account(mut)]
    pub buyback_token_account: Account<'info, TokenAccount>,
    
    /// The buyer who must sign the transaction
    pub buyer: Signer<'info>,
    
    /// Token program
    pub token_program: Program<'info, Token>,
}

/// Process a token sell with tax
/// This instruction processes a token sell, applying the appropriate tax
/// and distributing it according to the token configuration.
#[derive(Accounts)]
pub struct ProcessSellWithTax<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The token stats account
    #[account(
        mut,
        seeds = [b"token_stats", token_mint.key().as_ref()],
        bump
    )]
    pub token_stats: Account<'info, TokenStats>,
    
    /// The seller's token account
    #[account(mut)]
    pub seller_token_account: Account<'info, TokenAccount>,
    
    /// The liquidity pool token account
    #[account(mut)]
    pub liquidity_pool_token_account: Account<'info, TokenAccount>,
    
    /// The treasury token account
    #[account(mut)]
    pub treasury_token_account: Account<'info, TokenAccount>,
    
    /// The buyback token account
    #[account(mut)]
    pub buyback_token_account: Account<'info, TokenAccount>,
    
    /// The burn queue account
    #[account(
        mut,
        seeds = [b"burn_queue", token_mint.key().as_ref()],
        bump
    )]
    pub burn_queue: Account<'info, BurnQueue>,
    
    /// The seller who must sign the transaction
    pub seller: Signer<'info>,
    
    /// Token program
    pub token_program: Program<'info, Token>,
}

/// Execute buyback
/// This instruction executes a buyback operation, using accumulated funds
/// to buy tokens from the market and distribute them according to the configuration.
#[derive(Accounts)]
pub struct ExecuteBuyback<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The token stats account
    #[account(
        mut,
        seeds = [b"token_stats", token_mint.key().as_ref()],
        bump
    )]
    pub token_stats: Account<'info, TokenStats>,
    
    /// The buyback queue account
    #[account(
        mut,
        seeds = [b"buyback_queue", token_mint.key().as_ref()],
        bump
    )]
    pub buyback_queue: Account<'info, BuybackQueue>,
    
    /// The buyback wallet token account
    #[account(mut)]
    pub buyback_wallet_token_account: Account<'info, TokenAccount>,
    
    /// The liquidity pool token account
    #[account(mut)]
    pub liquidity_pool_token_account: Account<'info, TokenAccount>,
    
    /// The authority that can execute the buyback
    #[account(
        constraint = authority.key() == buyback_queue.authority || 
                    authority.key() == token_config.authority
    )]
    pub authority: Signer<'info>,
    
    /// Token program
    pub token_program: Program<'info, Token>,
}

/// Execute burn
/// This instruction executes a burn operation, burning accumulated tokens
/// to reduce the total supply.
#[derive(Accounts)]
pub struct ExecuteBurn<'info> {
    /// The token mint
    #[account(mut)]
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The token stats account
    #[account(
        mut,
        seeds = [b"token_stats", token_mint.key().as_ref()],
        bump
    )]
    pub token_stats: Account<'info, TokenStats>,
    
    /// The burn queue account
    #[account(
        mut,
        seeds = [b"burn_queue", token_mint.key().as_ref()],
        bump
    )]
    pub burn_queue: Account<'info, BurnQueue>,
    
    /// The burn wallet token account
    #[account(mut)]
    pub burn_wallet_token_account: Account<'info, TokenAccount>,
    
    /// The authority that can execute the burn
    #[account(
        constraint = authority.key() == burn_queue.authority || 
                    authority.key() == token_config.authority
    )]
    pub authority: Signer<'info>,
    
    /// Token program
    pub token_program: Program<'info, Token>,
}

/// Lock liquidity
/// This instruction locks liquidity tokens for a specified period,
/// preventing them from being withdrawn.
#[derive(Accounts)]
pub struct LockLiquidity<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        mut,
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The liquidity lock account
    #[account(
        mut,
        seeds = [b"liquidity_lock", token_mint.key().as_ref()],
        bump
    )]
    pub liquidity_lock: Account<'info, LiquidityLock>,
    
    /// The liquidity pool token account
    #[account(mut)]
    pub liquidity_pool_token_account: Account<'info, TokenAccount>,
    
    /// The authority that can lock the liquidity
    #[account(
        constraint = authority.key() == token_config.authority
    )]
    pub authority: Signer<'info>,
    
    /// Token program
    pub token_program: Program<'info, Token>,
}

/// Update anti-rug info
/// This instruction updates the anti-rug information for a token,
/// including KYC verification, audit status, and insurance fund.
#[derive(Accounts)]
pub struct UpdateAntiRugInfo<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The anti-rug info account
    #[account(
        mut,
        seeds = [b"anti_rug_info", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub anti_rug_info: Account<'info, AntiRugInfo>,
    
    /// The authority that can update the anti-rug info
    pub authority: Signer<'info>,
}

/// Update launch info
/// This instruction updates the launch information for a token,
/// including launch status, price, and liquidity.
#[derive(Accounts)]
pub struct UpdateLaunchInfo<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The launch info account
    #[account(
        mut,
        seeds = [b"launch_info", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub launch_info: Account<'info, LaunchInfo>,
    
    /// The authority that can update the launch info
    pub authority: Signer<'info>,
}

/// Update market maker config
/// This instruction updates the market maker configuration for a token,
/// including spread, target price, and allocation.
#[derive(Accounts)]
pub struct UpdateMarketMakerConfig<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The market maker config account
    #[account(
        mut,
        seeds = [b"market_maker_config", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub market_maker_config: Account<'info, MarketMakerConfig>,
    
    /// The authority that can update the market maker config
    pub authority: Signer<'info>,
}

/// Update bundle config
/// This instruction updates the bundle configuration for a token,
/// including bundle size, execution interval, and priority.
#[derive(Accounts)]
pub struct UpdateBundleConfig<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The bundle config account
    #[account(
        mut,
        seeds = [b"bundle_config", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub bundle_config: Account<'info, BundleConfig>,
    
    /// The authority that can update the bundle config
    pub authority: Signer<'info>,
}

/// Enable/disable trading
/// This instruction enables or disables trading for a token.
#[derive(Accounts)]
pub struct SetTradingEnabled<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        mut,
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The authority that can enable/disable trading
    pub authority: Signer<'info>,
}

/// Enable/disable launch mode
/// This instruction enables or disables launch mode for a token,
/// which applies higher taxes during the launch period.
#[derive(Accounts)]
pub struct SetLaunchModeEnabled<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        mut,
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The authority that can enable/disable launch mode
    pub authority: Signer<'info>,
}

/// Enable/disable anti-whale protection
/// This instruction enables or disables anti-whale protection for a token,
/// which limits transaction and wallet sizes.
#[derive(Accounts)]
pub struct SetAntiWhaleEnabled<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        mut,
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The authority that can enable/disable anti-whale protection
    pub authority: Signer<'info>,
}

/// Enable/disable buyback
/// This instruction enables or disables automatic buyback for a token.
#[derive(Accounts)]
pub struct SetBuybackEnabled<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        mut,
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The authority that can enable/disable buyback
    pub authority: Signer<'info>,
}

/// Initialize a token launch
/// This instruction initializes a token launch, setting up the initial
/// parameters and enabling launch mode.
#[derive(Accounts)]
pub struct InitializeTokenLaunch<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        mut,
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The launch info account
    #[account(
        mut,
        seeds = [b"launch_info", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub launch_info: Account<'info, LaunchInfo>,
    
    /// The liquidity lock account
    #[account(
        mut,
        seeds = [b"liquidity_lock", token_mint.key().as_ref()],
        bump
    )]
    pub liquidity_lock: Account<'info, LiquidityLock>,
    
    /// The authority that can initialize the launch
    pub authority: Signer<'info>,
    
    /// Clock sysvar for timestamp
    pub clock: Sysvar<'info, Clock>,
}

/// Finalize a token launch
/// This instruction finalizes a token launch, transitioning from launch mode
/// to normal trading mode.
#[derive(Accounts)]
pub struct FinalizeTokenLaunch<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        mut,
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The launch info account
    #[account(
        mut,
        seeds = [b"launch_info", token_mint.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub launch_info: Account<'info, LaunchInfo>,
    
    /// The authority that can finalize the launch
    pub authority: Signer<'info>,
    
    /// Clock sysvar for timestamp
    pub clock: Sysvar<'info, Clock>,
}

/// Execute market maker operation
/// This instruction executes a market maker operation, buying or selling
/// tokens to maintain the target price and spread.
#[derive(Accounts)]
pub struct ExecuteMarketMakerOperation<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The market maker config account
    #[account(
        seeds = [b"market_maker_config", token_mint.key().as_ref()],
        bump,
        constraint = market_maker_config.enabled == true
    )]
    pub market_maker_config: Account<'info, MarketMakerConfig>,
    
    /// The token stats account
    #[account(
        mut,
        seeds = [b"token_stats", token_mint.key().as_ref()],
        bump
    )]
    pub token_stats: Account<'info, TokenStats>,
    
    /// The market maker token account
    #[account(mut)]
    pub market_maker_token_account: Account<'info, TokenAccount>,
    
    /// The liquidity pool token account
    #[account(mut)]
    pub liquidity_pool_token_account: Account<'info, TokenAccount>,
    
    /// The authority that can execute the market maker operation
    #[account(
        constraint = authority.key() == market_maker_config.authority || 
                    authority.key() == token_config.authority
    )]
    pub authority: Signer<'info>,
    
    /// Token program
    pub token_program: Program<'info, Token>,
}

/// Execute bundle
/// This instruction executes a bundle of transactions, processing them
/// in batch according to their priority.
#[derive(Accounts)]
pub struct ExecuteBundle<'info> {
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// The token config account
    #[account(
        seeds = [b"token_config", token_mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// The bundle config account
    #[account(
        seeds = [b"bundle_config", token_mint.key().as_ref()],
        bump,
        constraint = bundle_config.enabled == true
    )]
    pub bundle_config: Account<'info, BundleConfig>,
    
    /// The authority that can execute the bundle
    #[account(
        constraint = authority.key() == bundle_config.authority || 
                    authority.key() == token_config.authority
    )]
    pub authority: Signer<'info>,
    
    /// Token program
    pub token_program: Program<'info, Token>,
}
