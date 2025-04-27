/**
 * @file state.rs
 * @description Defines all state accounts and data structures used in the token program.
 * This file contains the definitions for all PDAs and their seeds, account structures,
 * and related data types used throughout the program.
 */

use anchor_lang::prelude::*;

/// TokenConfig - Stores the configuration for a token including tax rates, thresholds, and settings
/// This account is created once per token and stores all the parameters that control
/// the token's behavior including taxation, buyback, anti-rug mechanisms, etc.
///
/// PDA: ['token_config', token_mint.key().as_ref()]
#[account]
#[derive(Default)]
pub struct TokenConfig {
    /// The mint address of the token
    pub token_mint: Pubkey,
    
    /// The authority that can update the config
    pub authority: Pubkey,
    
    /// The treasury wallet that receives a portion of the taxes
    pub treasury_wallet: Pubkey,
    
    /// The buyback wallet that accumulates funds for buyback operations
    pub buyback_wallet: Pubkey,
    
    /// The liquidity pool address
    pub liquidity_pool: Pubkey,
    
    /// Base buy tax rate in basis points (100 = 1%)
    pub buy_tax_bps: u16,
    
    /// Base sell tax rate in basis points (100 = 1%)
    pub sell_tax_bps: u16,
    
    /// Transfer tax rate in basis points (100 = 1%)
    pub transfer_tax_bps: u16,
    
    /// Progressive tax thresholds for sell operations (in token amount)
    /// Each threshold triggers a higher tax rate
    pub progressive_tax_thresholds: [u64; 5],
    
    /// Progressive tax rates corresponding to thresholds (in basis points)
    pub progressive_tax_rates: [u16; 5],
    
    /// Percentage of tax allocated to buyback (in basis points)
    pub buyback_allocation_bps: u16,
    
    /// Percentage of tax allocated to treasury (in basis points)
    pub treasury_allocation_bps: u16,
    
    /// Percentage of tax allocated to liquidity (in basis points)
    pub liquidity_allocation_bps: u16,
    
    /// Percentage of tax allocated to burn (in basis points)
    pub burn_allocation_bps: u16,
    
    /// Minimum amount accumulated before triggering a buyback
    pub buyback_threshold: u64,
    
    /// Minimum amount accumulated before triggering a burn
    pub burn_threshold: u64,
    
    /// Maximum transaction size as percentage of total supply (in basis points)
    pub max_transaction_bps: u16,
    
    /// Maximum wallet size as percentage of total supply (in basis points)
    pub max_wallet_bps: u16,
    
    /// Whether anti-whale protection is enabled
    pub anti_whale_enabled: bool,
    
    /// Whether buyback and burn is enabled
    pub buyback_enabled: bool,
    
    /// Whether the token is in launch mode (higher taxes)
    pub launch_mode_enabled: bool,
    
    /// Launch mode duration in seconds
    pub launch_mode_duration: i64,
    
    /// Timestamp when launch mode started
    pub launch_mode_start: i64,
    
    /// Whether trading is enabled
    pub trading_enabled: bool,
    
    /// Whether the liquidity is locked
    pub liquidity_locked: bool,
    
    /// Timestamp until which liquidity is locked
    pub liquidity_lock_until: i64,
    
    /// Anti-rug score (0-100)
    pub anti_rug_score: u8,
    
    /// Total amount collected for buyback
    pub total_buyback_collected: u64,
    
    /// Total amount collected for treasury
    pub total_treasury_collected: u64,
    
    /// Total amount collected for liquidity
    pub total_liquidity_collected: u64,
    
    /// Total amount burned
    pub total_burned: u64,
    
    /// Reserved space for future upgrades
    pub reserved: [u8; 64],
}

/// TokenStats - Stores real-time statistics about the token
/// This account tracks various metrics about the token's usage and performance
///
/// PDA: ['token_stats', token_mint.key().as_ref()]
#[account]
#[derive(Default)]
pub struct TokenStats {
    /// The mint address of the token
    pub token_mint: Pubkey,
    
    /// Total buy volume
    pub total_buy_volume: u64,
    
    /// Total sell volume
    pub total_sell_volume: u64,
    
    /// Total transfer volume
    pub total_transfer_volume: u64,
    
    /// Total buy transactions count
    pub total_buy_count: u64,
    
    /// Total sell transactions count
    pub total_sell_count: u64,
    
    /// Total transfer transactions count
    pub total_transfer_count: u64,
    
    /// Total taxes collected
    pub total_taxes_collected: u64,
    
    /// Total buyback operations performed
    pub total_buyback_operations: u64,
    
    /// Total burn operations performed
    pub total_burn_operations: u64,
    
    /// Timestamp of last buyback
    pub last_buyback_timestamp: i64,
    
    /// Timestamp of last burn
    pub last_burn_timestamp: i64,
    
    /// Highest price recorded
    pub highest_price: u64,
    
    /// Lowest price recorded
    pub lowest_price: u64,
    
    /// Current price
    pub current_price: u64,
    
    /// Reserved space for future upgrades
    pub reserved: [u8; 64],
}

/// LiquidityLock - Stores information about locked liquidity
/// This account tracks the liquidity that has been locked as part of the anti-rug mechanism
///
/// PDA: ['liquidity_lock', token_mint.key().as_ref()]
#[account]
#[derive(Default)]
pub struct LiquidityLock {
    /// The mint address of the token
    pub token_mint: Pubkey,
    
    /// The liquidity pool address
    pub liquidity_pool: Pubkey,
    
    /// The amount of liquidity tokens locked
    pub locked_amount: u64,
    
    /// The timestamp until which the liquidity is locked
    pub locked_until: i64,
    
    /// The authority that can extend the lock (but not reduce it)
    pub authority: Pubkey,
    
    /// Whether the lock is permanent
    pub is_permanent: bool,
    
    /// Reserved space for future upgrades
    pub reserved: [u8; 32],
}

/// BuybackQueue - Stores pending buyback operations
/// This account tracks accumulated funds for buyback and manages the buyback queue
///
/// PDA: ['buyback_queue', token_mint.key().as_ref()]
#[account]
#[derive(Default)]
pub struct BuybackQueue {
    /// The mint address of the token
    pub token_mint: Pubkey,
    
    /// The accumulated amount for buyback
    pub accumulated_amount: u64,
    
    /// The threshold to trigger a buyback
    pub threshold: u64,
    
    /// Whether a buyback is currently in progress
    pub buyback_in_progress: bool,
    
    /// The timestamp of the last buyback
    pub last_buyback_timestamp: i64,
    
    /// The authority that can trigger manual buybacks
    pub authority: Pubkey,
    
    /// Reserved space for future upgrades
    pub reserved: [u8; 32],
}

/// BurnQueue - Stores pending burn operations
/// This account tracks accumulated tokens for burning and manages the burn queue
///
/// PDA: ['burn_queue', token_mint.key().as_ref()]
#[account]
#[derive(Default)]
pub struct BurnQueue {
    /// The mint address of the token
    pub token_mint: Pubkey,
    
    /// The accumulated amount for burning
    pub accumulated_amount: u64,
    
    /// The threshold to trigger a burn
    pub threshold: u64,
    
    /// Whether a burn is currently in progress
    pub burn_in_progress: bool,
    
    /// The timestamp of the last burn
    pub last_burn_timestamp: i64,
    
    /// The authority that can trigger manual burns
    pub authority: Pubkey,
    
    /// Reserved space for future upgrades
    pub reserved: [u8; 32],
}

/// AntiRugInfo - Stores information related to anti-rug mechanisms
/// This account tracks various anti-rug protections and verifications
///
/// PDA: ['anti_rug_info', token_mint.key().as_ref()]
#[account]
#[derive(Default)]
pub struct AntiRugInfo {
    /// The mint address of the token
    pub token_mint: Pubkey,
    
    /// Whether the team is KYC verified
    pub is_team_kyc_verified: bool,
    
    /// Whether the contract is audited
    pub is_contract_audited: bool,
    
    /// The audit firm or auditor
    pub auditor: [u8; 32],
    
    /// The anti-rug score (0-100)
    pub score: u8,
    
    /// The insurance fund amount
    pub insurance_fund_amount: u64,
    
    /// The insurance fund wallet
    pub insurance_fund_wallet: Pubkey,
    
    /// The authority that can update the anti-rug info
    pub authority: Pubkey,
    
    /// Reserved space for future upgrades
    pub reserved: [u8; 32],
}

/// LaunchInfo - Stores information about the token launch
/// This account tracks the launch parameters and status
///
/// PDA: ['launch_info', token_mint.key().as_ref()]
#[account]
#[derive(Default)]
pub struct LaunchInfo {
    /// The mint address of the token
    pub token_mint: Pubkey,
    
    /// The launch timestamp
    pub launch_timestamp: i64,
    
    /// The initial price
    pub initial_price: u64,
    
    /// The initial liquidity amount
    pub initial_liquidity: u64,
    
    /// The presale price (if applicable)
    pub presale_price: u64,
    
    /// Whether the token had a presale
    pub had_presale: bool,
    
    /// The total amount raised in presale
    pub presale_amount_raised: u64,
    
    /// The launch status
    pub status: LaunchStatus,
    
    /// The authority that can update the launch info
    pub authority: Pubkey,
    
    /// Reserved space for future upgrades
    pub reserved: [u8; 32],
}

/// LaunchStatus - Enum representing the status of a token launch
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum LaunchStatus {
    /// The launch is pending
    Pending,
    
    /// The launch is in progress
    InProgress,
    
    /// The launch is completed
    Completed,
    
    /// The launch failed
    Failed,
}

// Implement Default for LaunchStatus
impl Default for LaunchStatus {
    fn default() -> Self {
        LaunchStatus::Pending
    }
}

/// MarketMakerConfig - Stores configuration for the market maker
/// This account tracks the market maker parameters and settings
///
/// PDA: ['market_maker_config', token_mint.key().as_ref()]
#[account]
#[derive(Default)]
pub struct MarketMakerConfig {
    /// The mint address of the token
    pub token_mint: Pubkey,
    
    /// Whether the market maker is enabled
    pub enabled: bool,
    
    /// The base spread in basis points
    pub base_spread_bps: u16,
    
    /// The maximum deviation allowed before intervention
    pub max_deviation_bps: u16,
    
    /// The target price
    pub target_price: u64,
    
    /// The amount allocated for market making
    pub allocated_amount: u64,
    
    /// The authority that can update the market maker config
    pub authority: Pubkey,
    
    /// Reserved space for future upgrades
    pub reserved: [u8; 32],
}

/// BundleConfig - Stores configuration for the bundle engine
/// This account tracks the bundle engine parameters and settings
///
/// PDA: ['bundle_config', token_mint.key().as_ref()]
#[account]
#[derive(Default)]
pub struct BundleConfig {
    /// The mint address of the token
    pub token_mint: Pubkey,
    
    /// Whether the bundle engine is enabled
    pub enabled: bool,
    
    /// The maximum bundle size
    pub max_bundle_size: u16,
    
    /// The bundle execution interval in seconds
    pub execution_interval: u16,
    
    /// The minimum priority for inclusion in a bundle
    pub min_priority: u8,
    
    /// The authority that can update the bundle config
    pub authority: Pubkey,
    
    /// Reserved space for future upgrades
    pub reserved: [u8; 32],
}
