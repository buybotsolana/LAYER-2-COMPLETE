/**
 * @file lib.rs
 * @description Complete token program with taxation, buyback, anti-rug mechanisms using Anchor framework
 * 
 * This program implements a comprehensive token system with advanced features:
 * - Progressive taxation based on transaction size
 * - Automatic buyback and burn mechanisms
 * - Anti-rug protection with liquidity locking
 * - Launchpad functionality for token creation
 * - Market maker integration
 * 
 * All functionality is implemented using proper Anchor patterns, PDAs, and security validations.
 * 
 * @author BuyBot Solana Team
 * @version 1.0.0
 */

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer, Burn};
use anchor_spl::associated_token::AssociatedToken;
use solana_program::{program::invoke_signed, system_instruction};
use std::convert::TryInto;

declare_id!("TokenProg1111111111111111111111111111111111111");

/**
 * Main module for the token program
 * Contains all instructions, accounts, and state definitions
 */
#[program]
pub mod token_program {
    use super::*;

    /**
     * Initializes the program with global configuration
     * 
     * This instruction sets up the global state for the program, including
     * the authority that can perform administrative actions.
     * 
     * @param ctx - Context containing accounts
     * @param params - Initialization parameters
     * @return ProgramResult indicating success or failure
     */
    pub fn initialize(
        ctx: Context<Initialize>,
        params: InitializeParams,
    ) -> Result<()> {
        let global_state = &mut ctx.accounts.global_state;
        global_state.authority = ctx.accounts.authority.key();
        global_state.treasury = ctx.accounts.treasury.key();
        global_state.buyback_fund = params.buyback_fund;
        global_state.burn_percentage = params.burn_percentage;
        global_state.insurance_fund = params.insurance_fund;
        global_state.default_lock_period = params.default_lock_period;
        global_state.bump = *ctx.bumps.get("global_state").unwrap();
        
        msg!("Program initialized with authority: {}", global_state.authority);
        emit!(ProgramInitializedEvent {
            authority: global_state.authority,
            treasury: global_state.treasury,
            buyback_fund: global_state.buyback_fund,
            burn_percentage: global_state.burn_percentage,
            insurance_fund: global_state.insurance_fund,
            default_lock_period: global_state.default_lock_period,
        });
        
        Ok(())
    }

    /**
     * Creates a new token with advanced features
     * 
     * This instruction creates a new token with configurable taxation,
     * buyback, and anti-rug features. It initializes all necessary PDAs
     * and sets up the token configuration.
     * 
     * @param ctx - Context containing accounts
     * @param params - Token creation parameters
     * @return ProgramResult indicating success or failure
     */
    pub fn create_token(
        ctx: Context<CreateToken>,
        params: CreateTokenParams,
    ) -> Result<()> {
        let token_config = &mut ctx.accounts.token_config;
        token_config.mint = ctx.accounts.mint.key();
        token_config.authority = ctx.accounts.authority.key();
        token_config.treasury = ctx.accounts.treasury.key();
        token_config.tax_buy = params.tax_buy;
        token_config.tax_sell = params.tax_sell;
        token_config.tax_transfer = params.tax_transfer;
        token_config.progressive_tax_enabled = params.progressive_tax_enabled;
        token_config.buyback_enabled = params.buyback_enabled;
        token_config.burn_enabled = params.burn_enabled;
        token_config.anti_rug_enabled = params.anti_rug_enabled;
        token_config.liquidity_lock_period = params.liquidity_lock_period;
        token_config.total_supply = params.total_supply;
        token_config.circulating_supply = 0;
        token_config.total_burned = 0;
        token_config.total_buyback = 0;
        token_config.launch_time = Clock::get()?.unix_timestamp;
        token_config.bump = *ctx.bumps.get("token_config").unwrap();
        
        // Initialize tax tiers if progressive taxation is enabled
        if params.progressive_tax_enabled {
            let tax_tiers = &mut ctx.accounts.tax_tiers;
            tax_tiers.mint = ctx.accounts.mint.key();
            tax_tiers.tier1_threshold = params.tier1_threshold;
            tax_tiers.tier1_tax_multiplier = params.tier1_tax_multiplier;
            tax_tiers.tier2_threshold = params.tier2_threshold;
            tax_tiers.tier2_tax_multiplier = params.tier2_tax_multiplier;
            tax_tiers.tier3_threshold = params.tier3_threshold;
            tax_tiers.tier3_tax_multiplier = params.tier3_tax_multiplier;
            tax_tiers.bump = *ctx.bumps.get("tax_tiers").unwrap();
        }
        
        // Initialize buyback config if buyback is enabled
        if params.buyback_enabled {
            let buyback_config = &mut ctx.accounts.buyback_config;
            buyback_config.mint = ctx.accounts.mint.key();
            buyback_config.auto_buyback_enabled = params.auto_buyback_enabled;
            buyback_config.buyback_interval = params.buyback_interval;
            buyback_config.min_buyback_amount = params.min_buyback_amount;
            buyback_config.last_buyback_time = 0;
            buyback_config.accumulated_buyback_amount = 0;
            buyback_config.bump = *ctx.bumps.get("buyback_config").unwrap();
        }
        
        // Initialize anti-rug config if anti-rug is enabled
        if params.anti_rug_enabled {
            let anti_rug_config = &mut ctx.accounts.anti_rug_config;
            anti_rug_config.mint = ctx.accounts.mint.key();
            anti_rug_config.liquidity_lock_period = params.liquidity_lock_period;
            anti_rug_config.team_tokens_locked = params.team_tokens_locked;
            anti_rug_config.team_tokens_lock_period = params.team_tokens_lock_period;
            anti_rug_config.team_tokens_vesting_schedule = params.team_tokens_vesting_schedule;
            anti_rug_config.insurance_fund_contribution = params.insurance_fund_contribution;
            anti_rug_config.rug_pull_protection_score = calculate_protection_score(
                params.liquidity_lock_period,
                params.team_tokens_locked,
                params.team_tokens_lock_period,
                params.insurance_fund_contribution,
            );
            anti_rug_config.bump = *ctx.bumps.get("anti_rug_config").unwrap();
        }
        
        // Initialize market maker config if market maker is enabled
        if params.market_maker_enabled {
            let market_maker_config = &mut ctx.accounts.market_maker_config;
            market_maker_config.mint = ctx.accounts.mint.key();
            market_maker_config.enabled = true;
            market_maker_config.base_spread = params.market_maker_base_spread;
            market_maker_config.max_spread = params.market_maker_max_spread;
            market_maker_config.volatility_threshold = params.market_maker_volatility_threshold;
            market_maker_config.inventory_management_enabled = params.market_maker_inventory_management;
            market_maker_config.target_inventory_ratio = params.market_maker_target_inventory;
            market_maker_config.bump = *ctx.bumps.get("market_maker_config").unwrap();
        }
        
        msg!("Token created: {}", ctx.accounts.mint.key());
        emit!(TokenCreatedEvent {
            mint: ctx.accounts.mint.key(),
            authority: ctx.accounts.authority.key(),
            total_supply: params.total_supply,
            tax_buy: params.tax_buy,
            tax_sell: params.tax_sell,
            tax_transfer: params.tax_transfer,
            progressive_tax_enabled: params.progressive_tax_enabled,
            buyback_enabled: params.buyback_enabled,
            burn_enabled: params.burn_enabled,
            anti_rug_enabled: params.anti_rug_enabled,
            liquidity_lock_period: params.liquidity_lock_period,
        });
        
        Ok(())
    }

    /**
     * Processes a token transfer with taxation
     * 
     * This instruction handles token transfers with automatic taxation.
     * It calculates the appropriate tax based on transaction type and size,
     * distributes the tax to various funds, and transfers the remaining amount.
     * 
     * @param ctx - Context containing accounts
     * @param amount - Amount of tokens to transfer
     * @return ProgramResult indicating success or failure
     */
    pub fn process_transfer(
        ctx: Context<ProcessTransfer>,
        amount: u64,
    ) -> Result<()> {
        // Verify the token config exists and is valid
        let token_config = &ctx.accounts.token_config;
        require!(token_config.mint == ctx.accounts.mint.key(), TokenError::InvalidMint);
        
        // Determine transaction type (buy, sell, transfer)
        let transaction_type = determine_transaction_type(
            &ctx.accounts.from.owner,
            &ctx.accounts.to.owner,
            &token_config.authority,
        );
        
        // Calculate tax based on transaction type and amount
        let (tax_amount, tax_percentage) = calculate_tax(
            transaction_type,
            amount,
            token_config,
            &ctx.accounts.tax_tiers,
        )?;
        
        // Calculate net transfer amount after tax
        let net_amount = amount.checked_sub(tax_amount).ok_or(TokenError::ArithmeticOverflow)?;
        
        // If tax amount is greater than 0, distribute tax
        if tax_amount > 0 {
            // Split tax between treasury, buyback, and burn
            let (treasury_amount, buyback_amount, burn_amount) = distribute_tax(
                tax_amount,
                &ctx.accounts.global_state,
            )?;
            
            // Transfer treasury portion to treasury account
            if treasury_amount > 0 {
                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: ctx.accounts.from.to_account_info(),
                            to: ctx.accounts.treasury.to_account_info(),
                            authority: ctx.accounts.authority.to_account_info(),
                        },
                    ),
                    treasury_amount,
                )?;
            }
            
            // Transfer buyback portion to buyback account
            if buyback_amount > 0 {
                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: ctx.accounts.from.to_account_info(),
                            to: ctx.accounts.buyback.to_account_info(),
                            authority: ctx.accounts.authority.to_account_info(),
                        },
                    ),
                    buyback_amount,
                )?;
                
                // Update buyback config if enabled
                if token_config.buyback_enabled {
                    let buyback_config = &mut ctx.accounts.buyback_config;
                    buyback_config.accumulated_buyback_amount = buyback_config
                        .accumulated_buyback_amount
                        .checked_add(buyback_amount)
                        .ok_or(TokenError::ArithmeticOverflow)?;
                }
            }
            
            // Burn tokens if burn is enabled and burn amount > 0
            if token_config.burn_enabled && burn_amount > 0 {
                token::burn(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        Burn {
                            mint: ctx.accounts.mint.to_account_info(),
                            from: ctx.accounts.from.to_account_info(),
                            authority: ctx.accounts.authority.to_account_info(),
                        },
                    ),
                    burn_amount,
                )?;
                
                // Update token config with burn amount
                let token_config = &mut ctx.accounts.token_config;
                token_config.total_burned = token_config
                    .total_burned
                    .checked_add(burn_amount)
                    .ok_or(TokenError::ArithmeticOverflow)?;
                token_config.circulating_supply = token_config
                    .circulating_supply
                    .checked_sub(burn_amount)
                    .ok_or(TokenError::ArithmeticOverflow)?;
            }
        }
        
        // Transfer net amount to recipient
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.from.to_account_info(),
                    to: ctx.accounts.to.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            net_amount,
        )?;
        
        // Emit transfer event
        emit!(TransferEvent {
            mint: ctx.accounts.mint.key(),
            from: ctx.accounts.from.owner.key(),
            to: ctx.accounts.to.owner.key(),
            amount: amount,
            net_amount: net_amount,
            tax_amount: tax_amount,
            tax_percentage: tax_percentage,
            transaction_type: transaction_type as u8,
        });
        
        Ok(())
    }

    /**
     * Locks liquidity for a token
     * 
     * This instruction locks liquidity for a specified period, enhancing
     * the anti-rug protection score of the token.
     * 
     * @param ctx - Context containing accounts
     * @param params - Liquidity locking parameters
     * @return ProgramResult indicating success or failure
     */
    pub fn lock_liquidity(
        ctx: Context<LockLiquidity>,
        params: LockLiquidityParams,
    ) -> Result<()> {
        // Verify the token config exists and is valid
        let token_config = &ctx.accounts.token_config;
        require!(token_config.mint == ctx.accounts.mint.key(), TokenError::InvalidMint);
        
        // Create new liquidity lock
        let liquidity_lock = &mut ctx.accounts.liquidity_lock;
        liquidity_lock.mint = ctx.accounts.mint.key();
        liquidity_lock.owner = ctx.accounts.owner.key();
        liquidity_lock.token_amount = params.token_amount;
        liquidity_lock.base_amount = params.base_amount;
        liquidity_lock.lock_period = params.lock_period;
        liquidity_lock.lock_time = Clock::get()?.unix_timestamp;
        liquidity_lock.unlock_time = Clock::get()?.unix_timestamp.checked_add(params.lock_period as i64).ok_or(TokenError::ArithmeticOverflow)?;
        liquidity_lock.is_unlocked = false;
        liquidity_lock.bump = *ctx.bumps.get("liquidity_lock").unwrap();
        
        // Transfer tokens to lock account
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.token_account.to_account_info(),
                    to: ctx.accounts.lock_token_account.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            params.token_amount,
        )?;
        
        // Transfer SOL to lock account
        invoke_signed(
            &system_instruction::transfer(
                &ctx.accounts.owner.key(),
                &ctx.accounts.lock_base_account.key(),
                params.base_amount,
            ),
            &[
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.lock_base_account.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[],
        )?;
        
        // Update anti-rug config if it exists
        if token_config.anti_rug_enabled {
            let anti_rug_config = &mut ctx.accounts.anti_rug_config;
            
            // Recalculate protection score with new liquidity lock
            let new_score = recalculate_protection_score(
                anti_rug_config.rug_pull_protection_score,
                params.lock_period,
                params.token_amount,
                params.base_amount,
            );
            
            anti_rug_config.rug_pull_protection_score = new_score;
        }
        
        // Emit liquidity lock event
        emit!(LiquidityLockedEvent {
            mint: ctx.accounts.mint.key(),
            owner: ctx.accounts.owner.key(),
            token_amount: params.token_amount,
            base_amount: params.base_amount,
            lock_period: params.lock_period,
            unlock_time: liquidity_lock.unlock_time,
        });
        
        Ok(())
    }

    /**
     * Unlocks liquidity after lock period has expired
     * 
     * This instruction allows the owner to unlock liquidity after
     * the lock period has expired.
     * 
     * @param ctx - Context containing accounts
     * @return ProgramResult indicating success or failure
     */
    pub fn unlock_liquidity(ctx: Context<UnlockLiquidity>) -> Result<()> {
        // Verify the liquidity lock exists and belongs to the owner
        let liquidity_lock = &mut ctx.accounts.liquidity_lock;
        require!(liquidity_lock.owner == ctx.accounts.owner.key(), TokenError::Unauthorized);
        require!(!liquidity_lock.is_unlocked, TokenError::AlreadyUnlocked);
        
        // Check if lock period has expired
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time >= liquidity_lock.unlock_time, TokenError::LockPeriodNotExpired);
        
        // Mark as unlocked
        liquidity_lock.is_unlocked = true;
        
        // Transfer tokens back to owner
        let seeds = &[
            b"liquidity_lock",
            liquidity_lock.mint.as_ref(),
            liquidity_lock.owner.as_ref(),
            &[liquidity_lock.bump],
        ];
        let signer = &[&seeds[..]];
        
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.lock_token_account.to_account_info(),
                    to: ctx.accounts.token_account.to_account_info(),
                    authority: ctx.accounts.lock_authority.to_account_info(),
                },
                signer,
            ),
            liquidity_lock.token_amount,
        )?;
        
        // Transfer SOL back to owner
        invoke_signed(
            &system_instruction::transfer(
                &ctx.accounts.lock_base_account.key(),
                &ctx.accounts.owner.key(),
                liquidity_lock.base_amount,
            ),
            &[
                ctx.accounts.lock_base_account.to_account_info(),
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer,
        )?;
        
        // Update anti-rug config if it exists
        if ctx.accounts.token_config.anti_rug_enabled {
            let anti_rug_config = &mut ctx.accounts.anti_rug_config;
            
            // Recalculate protection score after liquidity unlock
            let new_score = recalculate_protection_score_after_unlock(
                anti_rug_config.rug_pull_protection_score,
                liquidity_lock.lock_period,
                liquidity_lock.token_amount,
                liquidity_lock.base_amount,
            );
            
            anti_rug_config.rug_pull_protection_score = new_score;
        }
        
        // Emit liquidity unlock event
        emit!(LiquidityUnlockedEvent {
            mint: ctx.accounts.mint.key(),
            owner: ctx.accounts.owner.key(),
            token_amount: liquidity_lock.token_amount,
            base_amount: liquidity_lock.base_amount,
        });
        
        Ok(())
    }

    /**
     * Executes a buyback operation
     * 
     * This instruction uses accumulated funds to buy back tokens
     * from the market and optionally burn them.
     * 
     * @param ctx - Context containing accounts
     * @param amount - Amount of base currency to use for buyback
     * @return ProgramResult indicating success or failure
     */
    pub fn execute_buyback(
        ctx: Context<ExecuteBuyback>,
        amount: u64,
    ) -> Result<()> {
        // Verify the token config exists and buyback is enabled
        let token_config = &mut ctx.accounts.token_config;
        require!(token_config.mint == ctx.accounts.mint.key(), TokenError::InvalidMint);
        require!(token_config.buyback_enabled, TokenError::BuybackDisabled);
        
        // Verify the buyback config exists
        let buyback_config = &mut ctx.accounts.buyback_config;
        
        // Check if there are enough funds for buyback
        require!(
            buyback_config.accumulated_buyback_amount >= amount,
            TokenError::InsufficientBuybackFunds
        );
        
        // Calculate tokens to buy back (simplified calculation)
        // In a real implementation, this would interact with a DEX or AMM
        let tokens_to_buyback = calculate_buyback_amount(amount);
        
        // Transfer base currency to market for buyback
        invoke_signed(
            &system_instruction::transfer(
                &ctx.accounts.buyback_account.key(),
                &ctx.accounts.market.key(),
                amount,
            ),
            &[
                ctx.accounts.buyback_account.to_account_info(),
                ctx.accounts.market.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[],
        )?;
        
        // Transfer bought back tokens to buyback token account
        // In a real implementation, this would be handled by the DEX or AMM
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.market_token_account.to_account_info(),
                    to: ctx.accounts.buyback_token_account.to_account_info(),
                    authority: ctx.accounts.market_authority.to_account_info(),
                },
            ),
            tokens_to_buyback,
        )?;
        
        // If burn is enabled, burn the bought back tokens
        if token_config.burn_enabled {
            token::burn(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Burn {
                        mint: ctx.accounts.mint.to_account_info(),
                        from: ctx.accounts.buyback_token_account.to_account_info(),
                        authority: ctx.accounts.authority.to_account_info(),
                    },
                ),
                tokens_to_buyback,
            )?;
            
            // Update token config with burn amount
            token_config.total_burned = token_config
                .total_burned
                .checked_add(tokens_to_buyback)
                .ok_or(TokenError::ArithmeticOverflow)?;
            token_config.circulating_supply = token_config
                .circulating_supply
                .checked_sub(tokens_to_buyback)
                .ok_or(TokenError::ArithmeticOverflow)?;
        }
        
        // Update buyback config
        buyback_config.accumulated_buyback_amount = buyback_config
            .accumulated_buyback_amount
            .checked_sub(amount)
            .ok_or(TokenError::ArithmeticOverflow)?;
        buyback_config.last_buyback_time = Clock::get()?.unix_timestamp;
        
        // Update token config
        token_config.total_buyback = token_config
            .total_buyback
            .checked_add(amount)
            .ok_or(TokenError::ArithmeticOverflow)?;
        
        // Emit buyback event
        emit!(BuybackExecutedEvent {
            mint: ctx.accounts.mint.key(),
            amount: amount,
            tokens_bought: tokens_to_buyback,
            burned: token_config.burn_enabled,
        });
        
        Ok(())
    }

    /**
     * Updates market maker parameters
     * 
     * This instruction allows the authority to update market maker
     * parameters to adjust to market conditions.
     * 
     * @param ctx - Context containing accounts
     * @param params - Market maker update parameters
     * @return ProgramResult indicating success or failure
     */
    pub fn update_market_maker(
        ctx: Context<UpdateMarketMaker>,
        params: UpdateMarketMakerParams,
    ) -> Result<()> {
        // Verify the token config exists and is valid
        let token_config = &ctx.accounts.token_config;
        require!(token_config.mint == ctx.accounts.mint.key(), TokenError::InvalidMint);
        
        // Update market maker config
        let market_maker_config = &mut ctx.accounts.market_maker_config;
        
        if params.update_enabled {
            market_maker_config.enabled = params.enabled;
        }
        
        if params.update_base_spread {
            market_maker_config.base_spread = params.base_spread;
        }
        
        if params.update_max_spread {
            market_maker_config.max_spread = params.max_spread;
        }
        
        if params.update_volatility_threshold {
            market_maker_config.volatility_threshold = params.volatility_threshold;
        }
        
        if params.update_inventory_management {
            market_maker_config.inventory_management_enabled = params.inventory_management_enabled;
        }
        
        if params.update_target_inventory {
            market_maker_config.target_inventory_ratio = params.target_inventory_ratio;
        }
        
        // Emit market maker update event
        emit!(MarketMakerUpdatedEvent {
            mint: ctx.accounts.mint.key(),
            enabled: market_maker_config.enabled,
            base_spread: market_maker_config.base_spread,
            max_spread: market_maker_config.max_spread,
            volatility_threshold: market_maker_config.volatility_threshold,
            inventory_management_enabled: market_maker_config.inventory_management_enabled,
            target_inventory_ratio: market_maker_config.target_inventory_ratio,
        });
        
        Ok(())
    }

    /**
     * Updates token configuration
     * 
     * This instruction allows the authority to update token configuration
     * parameters.
     * 
     * @param ctx - Context containing accounts
     * @param params - Token configuration update parameters
     * @return ProgramResult indicating success or failure
     */
    pub fn update_token_config(
        ctx: Context<UpdateTokenConfig>,
        params: UpdateTokenConfigParams,
    ) -> Result<()> {
        // Verify the token config exists and is valid
        let token_config = &mut ctx.accounts.token_config;
        require!(token_config.mint == ctx.accounts.mint.key(), TokenError::InvalidMint);
        
        // Update token config parameters
        if params.update_tax_buy {
            token_config.tax_buy = params.tax_buy;
        }
        
        if params.update_tax_sell {
            token_config.tax_sell = params.tax_sell;
        }
        
        if params.update_tax_transfer {
            token_config.tax_transfer = params.tax_transfer;
        }
        
        if params.update_progressive_tax {
            token_config.progressive_tax_enabled = params.progressive_tax_enabled;
        }
        
        if params.update_buyback_enabled {
            token_config.buyback_enabled = params.buyback_enabled;
        }
        
        if params.update_burn_enabled {
            token_config.burn_enabled = params.burn_enabled;
        }
        
        if params.update_anti_rug_enabled {
            token_config.anti_rug_enabled = params.anti_rug_enabled;
        }
        
        if params.update_liquidity_lock_period {
            token_config.liquidity_lock_period = params.liquidity_lock_period;
        }
        
        // Update tax tiers if progressive taxation is enabled and update is requested
        if token_config.progressive_tax_enabled && params.update_tax_tiers {
            let tax_tiers = &mut ctx.accounts.tax_tiers;
            
            if params.update_tier1 {
                tax_tiers.tier1_threshold = params.tier1_threshold;
                tax_tiers.tier1_tax_multiplier = params.tier1_tax_multiplier;
            }
            
            if params.update_tier2 {
                tax_tiers.tier2_threshold = params.tier2_threshold;
                tax_tiers.tier2_tax_multiplier = params.tier2_tax_multiplier;
            }
            
            if params.update_tier3 {
                tax_tiers.tier3_threshold = params.tier3_threshold;
                tax_tiers.tier3_tax_multiplier = params.tier3_tax_multiplier;
            }
        }
        
        // Update buyback config if buyback is enabled and update is requested
        if token_config.buyback_enabled && params.update_buyback_config {
            let buyback_config = &mut ctx.accounts.buyback_config;
            
            if params.update_auto_buyback {
                buyback_config.auto_buyback_enabled = params.auto_buyback_enabled;
            }
            
            if params.update_buyback_interval {
                buyback_config.buyback_interval = params.buyback_interval;
            }
            
            if params.update_min_buyback_amount {
                buyback_config.min_buyback_amount = params.min_buyback_amount;
            }
        }
        
        // Emit token config update event
        emit!(TokenConfigUpdatedEvent {
            mint: ctx.accounts.mint.key(),
            tax_buy: token_config.tax_buy,
            tax_sell: token_config.tax_sell,
            tax_transfer: token_config.tax_transfer,
            progressive_tax_enabled: token_config.progressive_tax_enabled,
            buyback_enabled: token_config.buyback_enabled,
            burn_enabled: token_config.burn_enabled,
            anti_rug_enabled: token_config.anti_rug_enabled,
            liquidity_lock_period: token_config.liquidity_lock_period,
        });
        
        Ok(())
    }

    /**
     * Creates a presale for a token
     * 
     * This instruction sets up a presale for a token, allowing users
     * to contribute before the token is launched.
     * 
     * @param ctx - Context containing accounts
     * @param params - Presale creation parameters
     * @return ProgramResult indicating success or failure
     */
    pub fn create_presale(
        ctx: Context<CreatePresale>,
        params: CreatePresaleParams,
    ) -> Result<()> {
        // Verify the token config exists and is valid
        let token_config = &ctx.accounts.token_config;
        require!(token_config.mint == ctx.accounts.mint.key(), TokenError::InvalidMint);
        
        // Initialize presale config
        let presale_config = &mut ctx.accounts.presale_config;
        presale_config.mint = ctx.accounts.mint.key();
        presale_config.authority = ctx.accounts.authority.key();
        presale_config.token_price = params.token_price;
        presale_config.soft_cap = params.soft_cap;
        presale_config.hard_cap = params.hard_cap;
        presale_config.min_contribution = params.min_contribution;
        presale_config.max_contribution = params.max_contribution;
        presale_config.start_time = params.start_time;
        presale_config.end_time = params.end_time;
        presale_config.total_raised = 0;
        presale_config.total_tokens_sold = 0;
        presale_config.status = PresaleStatus::Pending as u8;
        presale_config.bump = *ctx.bumps.get("presale_config").unwrap();
        
        // Emit presale created event
        emit!(PresaleCreatedEvent {
            mint: ctx.accounts.mint.key(),
            authority: ctx.accounts.authority.key(),
            token_price: params.token_price,
            soft_cap: params.soft_cap,
            hard_cap: params.hard_cap,
            min_contribution: params.min_contribution,
            max_contribution: params.max_contribution,
            start_time: params.start_time,
            end_time: params.end_time,
        });
        
        Ok(())
    }

    /**
     * Contributes to a presale
     * 
     * This instruction allows users to contribute to a presale by
     * sending base currency and receiving the right to claim tokens.
     * 
     * @param ctx - Context containing accounts
     * @param amount - Amount of base currency to contribute
     * @return ProgramResult indicating success or failure
     */
    pub fn contribute_presale(
        ctx: Context<ContributePresale>,
        amount: u64,
    ) -> Result<()> {
        // Verify the presale config exists and is valid
        let presale_config = &mut ctx.accounts.presale_config;
        require!(presale_config.mint == ctx.accounts.mint.key(), TokenError::InvalidMint);
        
        // Check presale status
        require!(
            presale_config.status == PresaleStatus::Active as u8,
            TokenError::PresaleNotActive
        );
        
        // Check presale time
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            current_time >= presale_config.start_time && current_time <= presale_config.end_time,
            TokenError::PresaleNotActive
        );
        
        // Check contribution limits
        require!(
            amount >= presale_config.min_contribution,
            TokenError::ContributionTooSmall
        );
        
        // Get or create contribution account
        let contribution = &mut ctx.accounts.contribution;
        
        // If contribution already exists, check max contribution
        if contribution.initialized {
            let new_total = contribution
                .amount
                .checked_add(amount)
                .ok_or(TokenError::ArithmeticOverflow)?;
            
            require!(
                new_total <= presale_config.max_contribution,
                TokenError::ContributionTooLarge
            );
            
            // Update contribution amount
            contribution.amount = new_total;
        } else {
            // Initialize new contribution
            require!(
                amount <= presale_config.max_contribution,
                TokenError::ContributionTooLarge
            );
            
            contribution.mint = ctx.accounts.mint.key();
            contribution.contributor = ctx.accounts.contributor.key();
            contribution.amount = amount;
            contribution.tokens_owed = 0;
            contribution.claimed = false;
            contribution.initialized = true;
            contribution.bump = *ctx.bumps.get("contribution").unwrap();
        }
        
        // Check if hard cap would be exceeded
        let new_total_raised = presale_config
            .total_raised
            .checked_add(amount)
            .ok_or(TokenError::ArithmeticOverflow)?;
        
        require!(
            new_total_raised <= presale_config.hard_cap,
            TokenError::HardCapReached
        );
        
        // Calculate tokens owed
        let tokens_owed = calculate_tokens_from_contribution(amount, presale_config.token_price);
        
        // Update contribution tokens owed
        contribution.tokens_owed = contribution
            .tokens_owed
            .checked_add(tokens_owed)
            .ok_or(TokenError::ArithmeticOverflow)?;
        
        // Update presale config
        presale_config.total_raised = new_total_raised;
        presale_config.total_tokens_sold = presale_config
            .total_tokens_sold
            .checked_add(tokens_owed)
            .ok_or(TokenError::ArithmeticOverflow)?;
        
        // Transfer contribution to presale vault
        invoke_signed(
            &system_instruction::transfer(
                &ctx.accounts.contributor.key(),
                &ctx.accounts.presale_vault.key(),
                amount,
            ),
            &[
                ctx.accounts.contributor.to_account_info(),
                ctx.accounts.presale_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[],
        )?;
        
        // Emit contribution event
        emit!(PresaleContributionEvent {
            mint: ctx.accounts.mint.key(),
            contributor: ctx.accounts.contributor.key(),
            amount: amount,
            tokens_owed: tokens_owed,
            total_contribution: contribution.amount,
            total_tokens_owed: contribution.tokens_owed,
        });
        
        Ok(())
    }

    /**
     * Finalizes a presale
     * 
     * This instruction allows the authority to finalize a presale after
     * it has ended. If the soft cap was reached, the presale is successful
     * and tokens can be claimed. Otherwise, contributions can be refunded.
     * 
     * @param ctx - Context containing accounts
     * @return ProgramResult indicating success or failure
     */
    pub fn finalize_presale(ctx: Context<FinalizePresale>) -> Result<()> {
        // Verify the presale config exists and is valid
        let presale_config = &mut ctx.accounts.presale_config;
        require!(presale_config.mint == ctx.accounts.mint.key(), TokenError::InvalidMint);
        
        // Check presale status
        require!(
            presale_config.status == PresaleStatus::Active as u8,
            TokenError::PresaleNotActive
        );
        
        // Check if presale has ended
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            current_time > presale_config.end_time,
            TokenError::PresaleNotEnded
        );
        
        // Determine if presale was successful
        let success = presale_config.total_raised >= presale_config.soft_cap;
        
        // Update presale status
        presale_config.status = if success {
            PresaleStatus::Successful as u8
        } else {
            PresaleStatus::Failed as u8
        };
        
        // If successful, set up token for launch
        if success {
            // Update token config
            let token_config = &mut ctx.accounts.token_config;
            token_config.circulating_supply = presale_config.total_tokens_sold;
            
            // Set up liquidity (in a real implementation, this would add liquidity to a DEX)
            // For simplicity, we're just updating the state here
            
            // Emit presale success event
            emit!(PresaleSuccessEvent {
                mint: ctx.accounts.mint.key(),
                total_raised: presale_config.total_raised,
                total_tokens_sold: presale_config.total_tokens_sold,
            });
        } else {
            // Emit presale failure event
            emit!(PresaleFailureEvent {
                mint: ctx.accounts.mint.key(),
                total_raised: presale_config.total_raised,
                soft_cap: presale_config.soft_cap,
            });
        }
        
        Ok(())
    }

    /**
     * Claims tokens from a successful presale
     * 
     * This instruction allows contributors to claim their tokens
     * after a successful presale.
     * 
     * @param ctx - Context containing accounts
     * @return ProgramResult indicating success or failure
     */
    pub fn claim_presale_tokens(ctx: Context<ClaimPresaleTokens>) -> Result<()> {
        // Verify the presale config exists and is valid
        let presale_config = &ctx.accounts.presale_config;
        require!(presale_config.mint == ctx.accounts.mint.key(), TokenError::InvalidMint);
        
        // Check presale status
        require!(
            presale_config.status == PresaleStatus::Successful as u8,
            TokenError::PresaleNotSuccessful
        );
        
        // Verify the contribution exists and belongs to the contributor
        let contribution = &mut ctx.accounts.contribution;
        require!(contribution.mint == ctx.accounts.mint.key(), TokenError::InvalidMint);
        require!(contribution.contributor == ctx.accounts.contributor.key(), TokenError::Unauthorized);
        require!(!contribution.claimed, TokenError::AlreadyClaimed);
        
        // Mark as claimed
        contribution.claimed = true;
        
        // Transfer tokens to contributor
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.token_vault.to_account_info(),
                    to: ctx.accounts.contributor_token_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            contribution.tokens_owed,
        )?;
        
        // Emit claim event
        emit!(PresaleClaimEvent {
            mint: ctx.accounts.mint.key(),
            contributor: ctx.accounts.contributor.key(),
            tokens_claimed: contribution.tokens_owed,
        });
        
        Ok(())
    }

    /**
     * Refunds a contribution from a failed presale
     * 
     * This instruction allows contributors to get a refund
     * after a failed presale.
     * 
     * @param ctx - Context containing accounts
     * @return ProgramResult indicating success or failure
     */
    pub fn refund_presale_contribution(ctx: Context<RefundPresaleContribution>) -> Result<()> {
        // Verify the presale config exists and is valid
        let presale_config = &ctx.accounts.presale_config;
        require!(presale_config.mint == ctx.accounts.mint.key(), TokenError::InvalidMint);
        
        // Check presale status
        require!(
            presale_config.status == PresaleStatus::Failed as u8,
            TokenError::PresaleNotFailed
        );
        
        // Verify the contribution exists and belongs to the contributor
        let contribution = &mut ctx.accounts.contribution;
        require!(contribution.mint == ctx.accounts.mint.key(), TokenError::InvalidMint);
        require!(contribution.contributor == ctx.accounts.contributor.key(), TokenError::Unauthorized);
        require!(!contribution.claimed, TokenError::AlreadyClaimed);
        
        // Mark as claimed (refunded)
        contribution.claimed = true;
        
        // Transfer refund to contributor
        let seeds = &[
            b"presale_vault",
            presale_config.mint.as_ref(),
            &[*ctx.bumps.get("presale_vault").unwrap()],
        ];
        let signer = &[&seeds[..]];
        
        invoke_signed(
            &system_instruction::transfer(
                &ctx.accounts.presale_vault.key(),
                &ctx.accounts.contributor.key(),
                contribution.amount,
            ),
            &[
                ctx.accounts.presale_vault.to_account_info(),
                ctx.accounts.contributor.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer,
        )?;
        
        // Emit refund event
        emit!(PresaleRefundEvent {
            mint: ctx.accounts.mint.key(),
            contributor: ctx.accounts.contributor.key(),
            amount_refunded: contribution.amount,
        });
        
        Ok(())
    }
}

/**
 * Helper function to determine transaction type
 * 
 * @param from_owner - Owner of the source account
 * @param to_owner - Owner of the destination account
 * @param authority - Token authority
 * @return TransactionType enum value
 */
fn determine_transaction_type(
    from_owner: &Pubkey,
    to_owner: &Pubkey,
    authority: &Pubkey,
) -> TransactionType {
    if from_owner == authority {
        TransactionType::Buy
    } else if to_owner == authority {
        TransactionType::Sell
    } else {
        TransactionType::Transfer
    }
}

/**
 * Helper function to calculate tax amount
 * 
 * @param transaction_type - Type of transaction (buy, sell, transfer)
 * @param amount - Transaction amount
 * @param token_config - Token configuration
 * @param tax_tiers - Tax tier configuration (optional)
 * @return Tuple of (tax_amount, tax_percentage)
 */
fn calculate_tax(
    transaction_type: TransactionType,
    amount: u64,
    token_config: &TokenConfig,
    tax_tiers: &Option<Account<'_, TaxTiers>>,
) -> Result<(u64, u16)> {
    // Get base tax percentage based on transaction type
    let base_tax_percentage = match transaction_type {
        TransactionType::Buy => token_config.tax_buy,
        TransactionType::Sell => token_config.tax_sell,
        TransactionType::Transfer => token_config.tax_transfer,
    };
    
    // If progressive tax is not enabled, use base tax
    if !token_config.progressive_tax_enabled || tax_tiers.is_none() {
        let tax_amount = calculate_percentage(amount, base_tax_percentage)?;
        return Ok((tax_amount, base_tax_percentage));
    }
    
    // Apply progressive tax based on amount and tiers
    let tax_tiers = tax_tiers.as_ref().unwrap();
    
    let tax_multiplier = if amount >= tax_tiers.tier3_threshold {
        tax_tiers.tier3_tax_multiplier
    } else if amount >= tax_tiers.tier2_threshold {
        tax_tiers.tier2_tax_multiplier
    } else if amount >= tax_tiers.tier1_threshold {
        tax_tiers.tier1_tax_multiplier
    } else {
        100 // 100% of base tax (no multiplier)
    };
    
    // Calculate effective tax percentage
    let effective_tax_percentage = (base_tax_percentage as u32)
        .checked_mul(tax_multiplier as u32)
        .ok_or(TokenError::ArithmeticOverflow)?
        .checked_div(100)
        .ok_or(TokenError::ArithmeticOverflow)? as u16;
    
    // Calculate tax amount
    let tax_amount = calculate_percentage(amount, effective_tax_percentage)?;
    
    Ok((tax_amount, effective_tax_percentage))
}

/**
 * Helper function to distribute tax between treasury, buyback, and burn
 * 
 * @param tax_amount - Total tax amount
 * @param global_state - Global program state
 * @return Tuple of (treasury_amount, buyback_amount, burn_amount)
 */
fn distribute_tax(
    tax_amount: u64,
    global_state: &GlobalState,
) -> Result<(u64, u64, u64)> {
    // Calculate buyback amount
    let buyback_amount = calculate_percentage(
        tax_amount,
        global_state.buyback_fund,
    )?;
    
    // Calculate burn amount
    let burn_amount = calculate_percentage(
        tax_amount,
        global_state.burn_percentage,
    )?;
    
    // Calculate treasury amount (remainder)
    let treasury_amount = tax_amount
        .checked_sub(buyback_amount)
        .ok_or(TokenError::ArithmeticOverflow)?
        .checked_sub(burn_amount)
        .ok_or(TokenError::ArithmeticOverflow)?;
    
    Ok((treasury_amount, buyback_amount, burn_amount))
}

/**
 * Helper function to calculate a percentage of an amount
 * 
 * @param amount - Base amount
 * @param percentage - Percentage to calculate (basis points, 1% = 100)
 * @return Calculated amount
 */
fn calculate_percentage(amount: u64, percentage: u16) -> Result<u64> {
    let result = (amount as u128)
        .checked_mul(percentage as u128)
        .ok_or(TokenError::ArithmeticOverflow)?
        .checked_div(10000)
        .ok_or(TokenError::ArithmeticOverflow)? as u64;
    
    Ok(result)
}

/**
 * Helper function to calculate anti-rug protection score
 * 
 * @param liquidity_lock_period - Period for which liquidity is locked
 * @param team_tokens_locked - Whether team tokens are locked
 * @param team_tokens_lock_period - Period for which team tokens are locked
 * @param insurance_fund_contribution - Contribution to insurance fund
 * @return Protection score (0-100)
 */
fn calculate_protection_score(
    liquidity_lock_period: u64,
    team_tokens_locked: bool,
    team_tokens_lock_period: u64,
    insurance_fund_contribution: u16,
) -> u8 {
    // Base score starts at 0
    let mut score: u32 = 0;
    
    // Add points for liquidity lock period (max 40 points)
    // 1 month = 10 points, 3 months = 20 points, 6 months = 30 points, 12+ months = 40 points
    let liquidity_lock_months = liquidity_lock_period / (30 * 24 * 60 * 60);
    score += match liquidity_lock_months {
        0 => 0,
        1..=2 => 10,
        3..=5 => 20,
        6..=11 => 30,
        _ => 40,
    };
    
    // Add points for team tokens lock (max 40 points)
    if team_tokens_locked {
        // Add points for team tokens lock period
        // 1 month = 10 points, 3 months = 20 points, 6 months = 30 points, 12+ months = 40 points
        let team_lock_months = team_tokens_lock_period / (30 * 24 * 60 * 60);
        score += match team_lock_months {
            0 => 0,
            1..=2 => 10,
            3..=5 => 20,
            6..=11 => 30,
            _ => 40,
        };
    }
    
    // Add points for insurance fund contribution (max 20 points)
    // 0.1% = 2 points, 0.5% = 10 points, 1%+ = 20 points
    score += match insurance_fund_contribution {
        0 => 0,
        1..=10 => 2,
        11..=50 => 10,
        _ => 20,
    };
    
    // Ensure score is between 0 and 100
    score = score.min(100);
    
    score as u8
}

/**
 * Helper function to recalculate protection score after new liquidity lock
 * 
 * @param current_score - Current protection score
 * @param lock_period - New lock period
 * @param token_amount - Amount of tokens locked
 * @param base_amount - Amount of base currency locked
 * @return Updated protection score
 */
fn recalculate_protection_score(
    current_score: u8,
    lock_period: u64,
    token_amount: u64,
    base_amount: u64,
) -> u8 {
    // This is a simplified implementation
    // In a real implementation, this would consider the size of the lock relative to total supply
    
    // Add points for new lock period (max 10 additional points)
    let lock_months = lock_period / (30 * 24 * 60 * 60);
    let additional_points = match lock_months {
        0 => 0,
        1..=2 => 2,
        3..=5 => 5,
        6..=11 => 8,
        _ => 10,
    };
    
    // Add points based on lock size (simplified)
    let size_points = if token_amount > 1_000_000_000 && base_amount > 1_000_000_000 {
        5
    } else {
        2
    };
    
    // Calculate new score
    let new_score = current_score as u32 + additional_points + size_points;
    
    // Ensure score is between 0 and 100
    (new_score.min(100)) as u8
}

/**
 * Helper function to recalculate protection score after liquidity unlock
 * 
 * @param current_score - Current protection score
 * @param lock_period - Lock period that ended
 * @param token_amount - Amount of tokens unlocked
 * @param base_amount - Amount of base currency unlocked
 * @return Updated protection score
 */
fn recalculate_protection_score_after_unlock(
    current_score: u8,
    lock_period: u64,
    token_amount: u64,
    base_amount: u64,
) -> u8 {
    // This is a simplified implementation
    // In a real implementation, this would consider the size of the lock relative to total supply
    
    // Subtract points for ended lock period (max 15 points reduction)
    let lock_months = lock_period / (30 * 24 * 60 * 60);
    let points_reduction = match lock_months {
        0 => 0,
        1..=2 => 3,
        3..=5 => 7,
        6..=11 => 10,
        _ => 15,
    };
    
    // Subtract points based on lock size (simplified)
    let size_reduction = if token_amount > 1_000_000_000 && base_amount > 1_000_000_000 {
        5
    } else {
        2
    };
    
    // Calculate new score
    let new_score = current_score as i32 - points_reduction as i32 - size_reduction as i32;
    
    // Ensure score is between 0 and 100
    (new_score.max(0)) as u8
}

/**
 * Helper function to calculate buyback amount
 * 
 * @param amount - Amount of base currency for buyback
 * @return Amount of tokens to buy back
 */
fn calculate_buyback_amount(amount: u64) -> u64 {
    // This is a simplified implementation
    // In a real implementation, this would interact with a DEX or AMM
    
    // For simplicity, assume 1:1 exchange rate
    amount
}

/**
 * Helper function to calculate tokens from contribution
 * 
 * @param amount - Contribution amount
 * @param token_price - Token price
 * @return Amount of tokens
 */
fn calculate_tokens_from_contribution(amount: u64, token_price: u64) -> u64 {
    // This is a simplified implementation
    // In a real implementation, this would handle decimals properly
    
    // Calculate tokens: amount / token_price
    amount.checked_mul(10000).unwrap_or(0) / token_price
}

/**
 * Initialization parameters
 */
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeParams {
    pub buyback_fund: u16,
    pub burn_percentage: u16,
    pub insurance_fund: u16,
    pub default_lock_period: u64,
}

/**
 * Token creation parameters
 */
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateTokenParams {
    pub total_supply: u64,
    pub tax_buy: u16,
    pub tax_sell: u16,
    pub tax_transfer: u16,
    pub progressive_tax_enabled: bool,
    pub buyback_enabled: bool,
    pub burn_enabled: bool,
    pub anti_rug_enabled: bool,
    pub liquidity_lock_period: u64,
    
    // Progressive tax parameters
    pub tier1_threshold: u64,
    pub tier1_tax_multiplier: u16,
    pub tier2_threshold: u64,
    pub tier2_tax_multiplier: u16,
    pub tier3_threshold: u64,
    pub tier3_tax_multiplier: u16,
    
    // Buyback parameters
    pub auto_buyback_enabled: bool,
    pub buyback_interval: i64,
    pub min_buyback_amount: u64,
    
    // Anti-rug parameters
    pub team_tokens_locked: bool,
    pub team_tokens_lock_period: u64,
    pub team_tokens_vesting_schedule: u8,
    pub insurance_fund_contribution: u16,
    
    // Market maker parameters
    pub market_maker_enabled: bool,
    pub market_maker_base_spread: u16,
    pub market_maker_max_spread: u16,
    pub market_maker_volatility_threshold: u16,
    pub market_maker_inventory_management: bool,
    pub market_maker_target_inventory: u16,
}

/**
 * Liquidity locking parameters
 */
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LockLiquidityParams {
    pub token_amount: u64,
    pub base_amount: u64,
    pub lock_period: u64,
}

/**
 * Market maker update parameters
 */
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateMarketMakerParams {
    pub update_enabled: bool,
    pub enabled: bool,
    
    pub update_base_spread: bool,
    pub base_spread: u16,
    
    pub update_max_spread: bool,
    pub max_spread: u16,
    
    pub update_volatility_threshold: bool,
    pub volatility_threshold: u16,
    
    pub update_inventory_management: bool,
    pub inventory_management_enabled: bool,
    
    pub update_target_inventory: bool,
    pub target_inventory_ratio: u16,
}

/**
 * Token configuration update parameters
 */
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateTokenConfigParams {
    pub update_tax_buy: bool,
    pub tax_buy: u16,
    
    pub update_tax_sell: bool,
    pub tax_sell: u16,
    
    pub update_tax_transfer: bool,
    pub tax_transfer: u16,
    
    pub update_progressive_tax: bool,
    pub progressive_tax_enabled: bool,
    
    pub update_buyback_enabled: bool,
    pub buyback_enabled: bool,
    
    pub update_burn_enabled: bool,
    pub burn_enabled: bool,
    
    pub update_anti_rug_enabled: bool,
    pub anti_rug_enabled: bool,
    
    pub update_liquidity_lock_period: bool,
    pub liquidity_lock_period: u64,
    
    // Tax tiers update
    pub update_tax_tiers: bool,
    
    pub update_tier1: bool,
    pub tier1_threshold: u64,
    pub tier1_tax_multiplier: u16,
    
    pub update_tier2: bool,
    pub tier2_threshold: u64,
    pub tier2_tax_multiplier: u16,
    
    pub update_tier3: bool,
    pub tier3_threshold: u64,
    pub tier3_tax_multiplier: u16,
    
    // Buyback config update
    pub update_buyback_config: bool,
    
    pub update_auto_buyback: bool,
    pub auto_buyback_enabled: bool,
    
    pub update_buyback_interval: bool,
    pub buyback_interval: i64,
    
    pub update_min_buyback_amount: bool,
    pub min_buyback_amount: u64,
}

/**
 * Presale creation parameters
 */
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreatePresaleParams {
    pub token_price: u64,
    pub soft_cap: u64,
    pub hard_cap: u64,
    pub min_contribution: u64,
    pub max_contribution: u64,
    pub start_time: i64,
    pub end_time: i64,
}

/**
 * Global state account
 */
#[account]
pub struct GlobalState {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub buyback_fund: u16,
    pub burn_percentage: u16,
    pub insurance_fund: u16,
    pub default_lock_period: u64,
    pub bump: u8,
}

/**
 * Token configuration account
 */
#[account]
pub struct TokenConfig {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub tax_buy: u16,
    pub tax_sell: u16,
    pub tax_transfer: u16,
    pub progressive_tax_enabled: bool,
    pub buyback_enabled: bool,
    pub burn_enabled: bool,
    pub anti_rug_enabled: bool,
    pub liquidity_lock_period: u64,
    pub total_supply: u64,
    pub circulating_supply: u64,
    pub total_burned: u64,
    pub total_buyback: u64,
    pub launch_time: i64,
    pub bump: u8,
}

/**
 * Tax tiers account
 */
#[account]
pub struct TaxTiers {
    pub mint: Pubkey,
    pub tier1_threshold: u64,
    pub tier1_tax_multiplier: u16,
    pub tier2_threshold: u64,
    pub tier2_tax_multiplier: u16,
    pub tier3_threshold: u64,
    pub tier3_tax_multiplier: u16,
    pub bump: u8,
}

/**
 * Buyback configuration account
 */
#[account]
pub struct BuybackConfig {
    pub mint: Pubkey,
    pub auto_buyback_enabled: bool,
    pub buyback_interval: i64,
    pub min_buyback_amount: u64,
    pub last_buyback_time: i64,
    pub accumulated_buyback_amount: u64,
    pub bump: u8,
}

/**
 * Anti-rug configuration account
 */
#[account]
pub struct AntiRugConfig {
    pub mint: Pubkey,
    pub liquidity_lock_period: u64,
    pub team_tokens_locked: bool,
    pub team_tokens_lock_period: u64,
    pub team_tokens_vesting_schedule: u8,
    pub insurance_fund_contribution: u16,
    pub rug_pull_protection_score: u8,
    pub bump: u8,
}

/**
 * Market maker configuration account
 */
#[account]
pub struct MarketMakerConfig {
    pub mint: Pubkey,
    pub enabled: bool,
    pub base_spread: u16,
    pub max_spread: u16,
    pub volatility_threshold: u16,
    pub inventory_management_enabled: bool,
    pub target_inventory_ratio: u16,
    pub bump: u8,
}

/**
 * Liquidity lock account
 */
#[account]
pub struct LiquidityLock {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub token_amount: u64,
    pub base_amount: u64,
    pub lock_period: u64,
    pub lock_time: i64,
    pub unlock_time: i64,
    pub is_unlocked: bool,
    pub bump: u8,
}

/**
 * Presale configuration account
 */
#[account]
pub struct PresaleConfig {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub token_price: u64,
    pub soft_cap: u64,
    pub hard_cap: u64,
    pub min_contribution: u64,
    pub max_contribution: u64,
    pub start_time: i64,
    pub end_time: i64,
    pub total_raised: u64,
    pub total_tokens_sold: u64,
    pub status: u8,
    pub bump: u8,
}

/**
 * Presale contribution account
 */
#[account]
pub struct Contribution {
    pub mint: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
    pub tokens_owed: u64,
    pub claimed: bool,
    pub initialized: bool,
    pub bump: u8,
}

/**
 * Transaction type enum
 */
#[derive(Clone, Copy, PartialEq)]
pub enum TransactionType {
    Buy = 0,
    Sell = 1,
    Transfer = 2,
}

/**
 * Presale status enum
 */
#[derive(Clone, Copy, PartialEq)]
pub enum PresaleStatus {
    Pending = 0,
    Active = 1,
    Successful = 2,
    Failed = 3,
}

/**
 * Token error enum
 */
#[error_code]
pub enum TokenError {
    #[msg("Invalid mint address")]
    InvalidMint,
    
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    
    #[msg("Unauthorized operation")]
    Unauthorized,
    
    #[msg("Buyback is disabled for this token")]
    BuybackDisabled,
    
    #[msg("Insufficient funds for buyback")]
    InsufficientBuybackFunds,
    
    #[msg("Lock period has not expired")]
    LockPeriodNotExpired,
    
    #[msg("Already unlocked")]
    AlreadyUnlocked,
    
    #[msg("Presale is not active")]
    PresaleNotActive,
    
    #[msg("Presale has not ended")]
    PresaleNotEnded,
    
    #[msg("Contribution is too small")]
    ContributionTooSmall,
    
    #[msg("Contribution is too large")]
    ContributionTooLarge,
    
    #[msg("Hard cap reached")]
    HardCapReached,
    
    #[msg("Presale was not successful")]
    PresaleNotSuccessful,
    
    #[msg("Presale was not failed")]
    PresaleNotFailed,
    
    #[msg("Already claimed")]
    AlreadyClaimed,
}

/**
 * Initialize context
 */
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub treasury: SystemAccount<'info>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<GlobalState>(),
        seeds = [b"global_state"],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,
    
    pub system_program: Program<'info, System>,
}

/**
 * Create token context
 */
#[derive(Accounts)]
pub struct CreateToken<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub treasury: SystemAccount<'info>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<TokenConfig>(),
        seeds = [b"token_config", mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + std::mem::size_of::<TaxTiers>(),
        seeds = [b"tax_tiers", mint.key().as_ref()],
        bump
    )]
    pub tax_tiers: Account<'info, TaxTiers>,
    
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + std::mem::size_of::<BuybackConfig>(),
        seeds = [b"buyback_config", mint.key().as_ref()],
        bump
    )]
    pub buyback_config: Account<'info, BuybackConfig>,
    
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + std::mem::size_of::<AntiRugConfig>(),
        seeds = [b"anti_rug_config", mint.key().as_ref()],
        bump
    )]
    pub anti_rug_config: Account<'info, AntiRugConfig>,
    
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + std::mem::size_of::<MarketMakerConfig>(),
        seeds = [b"market_maker_config", mint.key().as_ref()],
        bump
    )]
    pub market_maker_config: Account<'info, MarketMakerConfig>,
    
    pub system_program: Program<'info, System>,
}

/**
 * Process transfer context
 */
#[derive(Accounts)]
pub struct ProcessTransfer<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(
        mut,
        constraint = token_config.mint == mint.key()
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    #[account(
        mut,
        constraint = tax_tiers.mint == mint.key()
    )]
    pub tax_tiers: Account<'info, TaxTiers>,
    
    #[account(
        mut,
        constraint = buyback_config.mint == mint.key()
    )]
    pub buyback_config: Account<'info, BuybackConfig>,
    
    pub global_state: Account<'info, GlobalState>,
    
    #[account(mut)]
    pub from: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub to: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub treasury: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub buyback: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

/**
 * Lock liquidity context
 */
#[derive(Accounts)]
pub struct LockLiquidity<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(
        constraint = token_config.mint == mint.key()
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    #[account(
        mut,
        constraint = anti_rug_config.mint == mint.key()
    )]
    pub anti_rug_config: Account<'info, AntiRugConfig>,
    
    #[account(
        init,
        payer = owner,
        space = 8 + std::mem::size_of::<LiquidityLock>(),
        seeds = [b"liquidity_lock", mint.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub liquidity_lock: Account<'info, LiquidityLock>,
    
    #[account(mut)]
    pub token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub lock_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub lock_base_account: SystemAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/**
 * Unlock liquidity context
 */
#[derive(Accounts)]
pub struct UnlockLiquidity<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(
        constraint = token_config.mint == mint.key()
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    #[account(
        mut,
        constraint = anti_rug_config.mint == mint.key()
    )]
    pub anti_rug_config: Account<'info, AntiRugConfig>,
    
    #[account(
        mut,
        constraint = liquidity_lock.mint == mint.key(),
        constraint = liquidity_lock.owner == owner.key(),
        seeds = [b"liquidity_lock", mint.key().as_ref(), owner.key().as_ref()],
        bump = liquidity_lock.bump
    )]
    pub liquidity_lock: Account<'info, LiquidityLock>,
    
    /// CHECK: This is the PDA that owns the locked tokens
    #[account(
        seeds = [b"liquidity_lock", mint.key().as_ref(), owner.key().as_ref()],
        bump = liquidity_lock.bump
    )]
    pub lock_authority: AccountInfo<'info>,
    
    #[account(mut)]
    pub token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub lock_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub lock_base_account: SystemAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/**
 * Execute buyback context
 */
#[derive(Accounts)]
pub struct ExecuteBuyback<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(
        mut,
        constraint = token_config.mint == mint.key()
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    #[account(
        mut,
        constraint = buyback_config.mint == mint.key()
    )]
    pub buyback_config: Account<'info, BuybackConfig>,
    
    #[account(mut)]
    pub buyback_account: SystemAccount<'info>,
    
    #[account(mut)]
    pub buyback_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub market: SystemAccount<'info>,
    
    #[account(mut)]
    pub market_token_account: Account<'info, TokenAccount>,
    
    /// CHECK: This is the market authority
    pub market_authority: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/**
 * Update market maker context
 */
#[derive(Accounts)]
pub struct UpdateMarketMaker<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(
        constraint = token_config.mint == mint.key(),
        constraint = token_config.authority == authority.key()
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    #[account(
        mut,
        constraint = market_maker_config.mint == mint.key()
    )]
    pub market_maker_config: Account<'info, MarketMakerConfig>,
}

/**
 * Update token config context
 */
#[derive(Accounts)]
pub struct UpdateTokenConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(
        mut,
        constraint = token_config.mint == mint.key(),
        constraint = token_config.authority == authority.key()
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    #[account(
        mut,
        constraint = tax_tiers.mint == mint.key()
    )]
    pub tax_tiers: Account<'info, TaxTiers>,
    
    #[account(
        mut,
        constraint = buyback_config.mint == mint.key()
    )]
    pub buyback_config: Account<'info, BuybackConfig>,
}

/**
 * Create presale context
 */
#[derive(Accounts)]
pub struct CreatePresale<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(
        constraint = token_config.mint == mint.key(),
        constraint = token_config.authority == authority.key()
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<PresaleConfig>(),
        seeds = [b"presale_config", mint.key().as_ref()],
        bump
    )]
    pub presale_config: Account<'info, PresaleConfig>,
    
    pub system_program: Program<'info, System>,
}

/**
 * Contribute presale context
 */
#[derive(Accounts)]
pub struct ContributePresale<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(
        mut,
        constraint = presale_config.mint == mint.key()
    )]
    pub presale_config: Account<'info, PresaleConfig>,
    
    #[account(
        mut,
        seeds = [b"presale_vault", mint.key().as_ref()],
        bump
    )]
    pub presale_vault: SystemAccount<'info>,
    
    #[account(
        init_if_needed,
        payer = contributor,
        space = 8 + std::mem::size_of::<Contribution>(),
        seeds = [b"contribution", contributor.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub contribution: Account<'info, Contribution>,
    
    pub system_program: Program<'info, System>,
}

/**
 * Finalize presale context
 */
#[derive(Accounts)]
pub struct FinalizePresale<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(
        mut,
        constraint = presale_config.mint == mint.key(),
        constraint = presale_config.authority == authority.key()
    )]
    pub presale_config: Account<'info, PresaleConfig>,
    
    #[account(
        mut,
        constraint = token_config.mint == mint.key(),
        constraint = token_config.authority == authority.key()
    )]
    pub token_config: Account<'info, TokenConfig>,
}

/**
 * Claim presale tokens context
 */
#[derive(Accounts)]
pub struct ClaimPresaleTokens<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(
        constraint = presale_config.mint == mint.key()
    )]
    pub presale_config: Account<'info, PresaleConfig>,
    
    #[account(
        mut,
        constraint = contribution.mint == mint.key(),
        constraint = contribution.contributor == contributor.key(),
        seeds = [b"contribution", contributor.key().as_ref(), mint.key().as_ref()],
        bump = contribution.bump
    )]
    pub contribution: Account<'info, Contribution>,
    
    /// CHECK: This is the authority that can transfer tokens
    pub authority: AccountInfo<'info>,
    
    #[account(mut)]
    pub token_vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub contributor_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

/**
 * Refund presale contribution context
 */
#[derive(Accounts)]
pub struct RefundPresaleContribution<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(
        constraint = presale_config.mint == mint.key()
    )]
    pub presale_config: Account<'info, PresaleConfig>,
    
    #[account(
        mut,
        seeds = [b"presale_vault", mint.key().as_ref()],
        bump
    )]
    pub presale_vault: SystemAccount<'info>,
    
    #[account(
        mut,
        constraint = contribution.mint == mint.key(),
        constraint = contribution.contributor == contributor.key(),
        seeds = [b"contribution", contributor.key().as_ref(), mint.key().as_ref()],
        bump = contribution.bump
    )]
    pub contribution: Account<'info, Contribution>,
    
    pub system_program: Program<'info, System>,
}

/**
 * Program initialized event
 */
#[event]
pub struct ProgramInitializedEvent {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub buyback_fund: u16,
    pub burn_percentage: u16,
    pub insurance_fund: u16,
    pub default_lock_period: u64,
}

/**
 * Token created event
 */
#[event]
pub struct TokenCreatedEvent {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub total_supply: u64,
    pub tax_buy: u16,
    pub tax_sell: u16,
    pub tax_transfer: u16,
    pub progressive_tax_enabled: bool,
    pub buyback_enabled: bool,
    pub burn_enabled: bool,
    pub anti_rug_enabled: bool,
    pub liquidity_lock_period: u64,
}

/**
 * Transfer event
 */
#[event]
pub struct TransferEvent {
    pub mint: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub net_amount: u64,
    pub tax_amount: u64,
    pub tax_percentage: u16,
    pub transaction_type: u8,
}

/**
 * Liquidity locked event
 */
#[event]
pub struct LiquidityLockedEvent {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub token_amount: u64,
    pub base_amount: u64,
    pub lock_period: u64,
    pub unlock_time: i64,
}

/**
 * Liquidity unlocked event
 */
#[event]
pub struct LiquidityUnlockedEvent {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub token_amount: u64,
    pub base_amount: u64,
}

/**
 * Buyback executed event
 */
#[event]
pub struct BuybackExecutedEvent {
    pub mint: Pubkey,
    pub amount: u64,
    pub tokens_bought: u64,
    pub burned: bool,
}

/**
 * Market maker updated event
 */
#[event]
pub struct MarketMakerUpdatedEvent {
    pub mint: Pubkey,
    pub enabled: bool,
    pub base_spread: u16,
    pub max_spread: u16,
    pub volatility_threshold: u16,
    pub inventory_management_enabled: bool,
    pub target_inventory_ratio: u16,
}

/**
 * Token config updated event
 */
#[event]
pub struct TokenConfigUpdatedEvent {
    pub mint: Pubkey,
    pub tax_buy: u16,
    pub tax_sell: u16,
    pub tax_transfer: u16,
    pub progressive_tax_enabled: bool,
    pub buyback_enabled: bool,
    pub burn_enabled: bool,
    pub anti_rug_enabled: bool,
    pub liquidity_lock_period: u64,
}

/**
 * Presale created event
 */
#[event]
pub struct PresaleCreatedEvent {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub token_price: u64,
    pub soft_cap: u64,
    pub hard_cap: u64,
    pub min_contribution: u64,
    pub max_contribution: u64,
    pub start_time: i64,
    pub end_time: i64,
}

/**
 * Presale contribution event
 */
#[event]
pub struct PresaleContributionEvent {
    pub mint: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
    pub tokens_owed: u64,
    pub total_contribution: u64,
    pub total_tokens_owed: u64,
}

/**
 * Presale success event
 */
#[event]
pub struct PresaleSuccessEvent {
    pub mint: Pubkey,
    pub total_raised: u64,
    pub total_tokens_sold: u64,
}

/**
 * Presale failure event
 */
#[event]
pub struct PresaleFailureEvent {
    pub mint: Pubkey,
    pub total_raised: u64,
    pub soft_cap: u64,
}

/**
 * Presale claim event
 */
#[event]
pub struct PresaleClaimEvent {
    pub mint: Pubkey,
    pub contributor: Pubkey,
    pub tokens_claimed: u64,
}

/**
 * Presale refund event
 */
#[event]
pub struct PresaleRefundEvent {
    pub mint: Pubkey,
    pub contributor: Pubkey,
    pub amount_refunded: u64,
}
