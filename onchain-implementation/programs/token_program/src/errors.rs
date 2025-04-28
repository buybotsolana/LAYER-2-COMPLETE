/**
 * @file errors.rs
 * @description Defines all error types for the token program.
 * This file contains custom error definitions for all possible error conditions
 * that can occur during program execution, with clear error codes and messages.
 */

use anchor_lang::prelude::*;

#[error_code]
pub enum TokenProgramError {
    #[msg("The operation is not allowed because trading is disabled")]
    TradingDisabled,
    
    #[msg("The operation is not allowed because the token is in launch mode")]
    LaunchModeActive,
    
    #[msg("The transaction amount exceeds the maximum allowed transaction size")]
    TransactionTooLarge,
    
    #[msg("The resulting wallet balance would exceed the maximum allowed wallet size")]
    WalletSizeTooLarge,
    
    #[msg("The liquidity is locked and cannot be withdrawn")]
    LiquidityLocked,
    
    #[msg("The buyback threshold has not been reached")]
    BuybackThresholdNotReached,
    
    #[msg("A buyback operation is already in progress")]
    BuybackInProgress,
    
    #[msg("The burn threshold has not been reached")]
    BurnThresholdNotReached,
    
    #[msg("A burn operation is already in progress")]
    BurnInProgress,
    
    #[msg("The anti-rug score is too low for this operation")]
    AntiRugScoreTooLow,
    
    #[msg("The token launch has not been initialized")]
    LaunchNotInitialized,
    
    #[msg("The token launch has already been finalized")]
    LaunchAlreadyFinalized,
    
    #[msg("The token launch is still in progress")]
    LaunchInProgress,
    
    #[msg("The market maker is not enabled")]
    MarketMakerNotEnabled,
    
    #[msg("The bundle engine is not enabled")]
    BundleEngineNotEnabled,
    
    #[msg("The bundle is full and cannot accept more transactions")]
    BundleFull,
    
    #[msg("The transaction priority is too low for inclusion in the bundle")]
    PriorityTooLow,
    
    #[msg("The tax allocation percentages must sum to 10000 basis points (100%)")]
    InvalidTaxAllocation,
    
    #[msg("The progressive tax thresholds must be in ascending order")]
    InvalidProgressiveTaxThresholds,
    
    #[msg("The progressive tax rates must be in ascending order")]
    InvalidProgressiveTaxRates,
    
    #[msg("The operation is not allowed because the sender is blacklisted")]
    SenderBlacklisted,
    
    #[msg("The operation is not allowed because the recipient is blacklisted")]
    RecipientBlacklisted,
    
    #[msg("The insurance fund is insufficient for this operation")]
    InsufficientInsuranceFund,
    
    #[msg("The liquidity lock period has not expired")]
    LiquidityLockNotExpired,
    
    #[msg("The token config has not been initialized")]
    TokenConfigNotInitialized,
    
    #[msg("The token stats have not been initialized")]
    TokenStatsNotInitialized,
    
    #[msg("The anti-rug info has not been initialized")]
    AntiRugInfoNotInitialized,
    
    #[msg("The launch info has not been initialized")]
    LaunchInfoNotInitialized,
    
    #[msg("The market maker config has not been initialized")]
    MarketMakerConfigNotInitialized,
    
    #[msg("The bundle config has not been initialized")]
    BundleConfigNotInitialized,
    
    #[msg("The buyback queue has not been initialized")]
    BuybackQueueNotInitialized,
    
    #[msg("The burn queue has not been initialized")]
    BurnQueueNotInitialized,
    
    #[msg("The liquidity lock has not been initialized")]
    LiquidityLockNotInitialized,
    
    #[msg("The operation is not allowed because the token is not in launch mode")]
    NotInLaunchMode,
    
    #[msg("The operation is not allowed because anti-whale protection is enabled")]
    AntiWhaleProtectionEnabled,
    
    #[msg("The operation is not allowed because buyback is disabled")]
    BuybackDisabled,
    
    #[msg("The operation is not allowed because the token has not been audited")]
    TokenNotAudited,
    
    #[msg("The operation is not allowed because the team is not KYC verified")]
    TeamNotVerified,
    
    #[msg("The operation is not allowed because the token has a low anti-rug score")]
    LowAntiRugScore,
    
    #[msg("The operation is not allowed because the token is not yet launched")]
    TokenNotLaunched,
    
    #[msg("The operation is not allowed because the token launch has failed")]
    LaunchFailed,
    
    #[msg("The operation is not allowed because the market price deviation is too high")]
    PriceDeviationTooHigh,
    
    #[msg("The operation is not allowed because the market maker has insufficient funds")]
    InsufficientMarketMakerFunds,
    
    #[msg("The operation is not allowed because the bundle execution interval has not elapsed")]
    BundleExecutionIntervalNotElapsed,
    
    #[msg("The operation is not allowed because the bundle is empty")]
    BundleEmpty,
    
    #[msg("The operation is not allowed because the bundle has expired")]
    BundleExpired,
    
    #[msg("The operation is not allowed because the bundle has been aborted")]
    BundleAborted,
    
    #[msg("The operation is not allowed because the bundle has already been executed")]
    BundleAlreadyExecuted,
    
    #[msg("The operation is not allowed because the bundle has not been finalized")]
    BundleNotFinalized,
    
    #[msg("The operation is not allowed because the bundle has already been finalized")]
    BundleAlreadyFinalized,
    
    #[msg("The operation is not allowed because the bundle has not been initialized")]
    BundleNotInitialized,
    
    #[msg("The operation is not allowed because the bundle has already been initialized")]
    BundleAlreadyInitialized,
    
    #[msg("The operation is not allowed because the bundle is not active")]
    BundleNotActive,
    
    #[msg("The operation is not allowed because the bundle is already active")]
    BundleAlreadyActive,
    
    #[msg("The operation is not allowed because the bundle is not ready for execution")]
    BundleNotReady,
    
    #[msg("The operation is not allowed because the bundle is already ready for execution")]
    BundleAlreadyReady,
    
    #[msg("The operation is not allowed because the bundle is not pending")]
    BundleNotPending,
    
    #[msg("The operation is not allowed because the bundle is already pending")]
    BundleAlreadyPending,
    
    #[msg("The operation is not allowed because the bundle is not completed")]
    BundleNotCompleted,
    
    #[msg("The operation is not allowed because the bundle is already completed")]
    BundleAlreadyCompleted,
    
    #[msg("The operation is not allowed because the bundle is not failed")]
    BundleNotFailed,
    
    #[msg("The operation is not allowed because the bundle is already failed")]
    BundleAlreadyFailed,
    
    #[msg("The operation is not allowed because the bundle is not cancelled")]
    BundleNotCancelled,
    
    #[msg("The operation is not allowed because the bundle is already cancelled")]
    BundleAlreadyCancelled,
}
