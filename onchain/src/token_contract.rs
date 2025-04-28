use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use std::convert::TryFrom;

declare_id!("TokenContractWithBuybot111111111111111111111111111");

#[program]
pub mod token_contract {
    use super::*;

    /// Inizializza un nuovo token con supporto buybot
    pub fn initialize(
        ctx: Context<Initialize>,
        name: String,
        symbol: String,
        decimals: u8,
        initial_supply: u64,
        max_supply: u64,
    ) -> Result<()> {
        let token_info = &mut ctx.accounts.token_info;
        
        // Inizializza le informazioni sul token
        token_info.name = name;
        token_info.symbol = symbol;
        token_info.decimals = decimals;
        token_info.total_supply = initial_supply;
        token_info.max_supply = max_supply;
        token_info.owner = ctx.accounts.owner.key();
        token_info.buybot_enabled = false;
        token_info.created_at = Clock::get()?.unix_timestamp;
        
        // Inizializza la configurazione delle tasse
        token_info.tax_config = TaxConfig {
            buy_tax_bps: 500, // 5%
            sell_tax_bps: 1000, // 10%
            transfer_tax_bps: 200, // 2%
            distribution: TaxDistribution {
                liquidity_bps: 3000, // 30%
                marketing_bps: 2000, // 20%
                development_bps: 2000, // 20%
                burn_bps: 1500, // 15%
                buyback_bps: 1500, // 15%
            },
            progressive_tax: Some(ProgressiveTaxConfig {
                thresholds: vec![100, 300, 500], // 1%, 3%, 5% della liquidità
                additional_taxes: vec![200, 500, 1000], // +2%, +5%, +10%
            }),
        };
        
        // Inizializza la configurazione del buyback
        token_info.buyback_config = BuybackConfig {
            enabled: true,
            price_threshold_bps: 800, // 80% del prezzo massimo
            max_amount_per_operation: 1_000_000_000, // 1B unità
            max_daily_amount: 5_000_000_000, // 5B unità
            min_interval_seconds: 3600, // 1 ora
        };
        
        // Inizializza la configurazione del burn
        token_info.burn_config = BurnConfig {
            enabled: true,
            amount_per_operation_bps: 100, // 1% dell'offerta totale
            max_daily_amount_bps: 500, // 5% dell'offerta totale
            min_interval_seconds: 86400, // 1 giorno
        };
        
        // Inizializza la configurazione anti-dump
        token_info.anti_dump_config = AntiDumpConfig {
            enabled: true,
            max_sell_per_tx_bps: 200, // 2% della liquidità totale
            max_sell_per_day_bps: 500, // 5% della liquidità totale
            cooldown_seconds: 3600, // 1 ora
            large_sell_threshold_bps: 100, // 1% della liquidità totale
        };
        
        // Inizializza la configurazione del supporto al prezzo
        token_info.price_support_config = PriceSupportConfig {
            enabled: true,
            target_price: 0, // Sarà impostato al prezzo di listing
            tolerance_band_bps: 500, // 5%
            intervention_strength: 5, // Medio (1-10)
            max_daily_budget: 1_000_000_000, // 1B unità
        };
        
        // Inizializza le statistiche
        token_info.tax_stats = TaxStats {
            total_taxes_collected: 0,
            buy_taxes: 0,
            sell_taxes: 0,
            transfer_taxes: 0,
        };
        
        token_info.buyback_stats = BuybackStats {
            total_amount: 0,
            count: 0,
            last_executed: 0,
        };
        
        token_info.burn_stats = BurnStats {
            total_amount: 0,
            count: 0,
            last_executed: 0,
        };
        
        token_info.price_support_stats = PriceSupportStats {
            interventions_today: 0,
            budget_used_today: 0,
            last_intervention: 0,
        };
        
        // Minta l'offerta iniziale al proprietario
        token::mint_to(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
            ),
            initial_supply,
        )?;
        
        msg!("Token inizializzato: {}", token_info.name);
        
        Ok(())
    }
    
    /// Trasferisce token da un account all'altro
    pub fn transfer(
        ctx: Context<TransferTokens>,
        amount: u64,
    ) -> Result<()> {
        let token_info = &ctx.accounts.token_info;
        
        // Determina il tipo di transazione
        let transaction_type = determine_transaction_type(
            &ctx.accounts.from.key(),
            &ctx.accounts.to.key(),
            &ctx.accounts.liquidity_pool.key(),
        );
        
        // Se il buybot è abilitato, applica le tasse
        if token_info.buybot_enabled {
            // Calcola l'importo della tassa
            let tax_amount = calculate_tax(
                amount,
                transaction_type,
                &token_info.tax_config,
                &ctx.accounts.liquidity_pool.key(),
            )?;
            
            // Importo netto dopo le tasse
            let net_amount = amount.checked_sub(tax_amount).ok_or(ErrorCode::ArithmeticError)?;
            
            // Trasferisci l'importo netto al destinatario
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
            
            // Se ci sono tasse, distribuiscile
            if tax_amount > 0 {
                distribute_taxes(
                    ctx.accounts.from.to_account_info(),
                    ctx.accounts.tax_collector.to_account_info(),
                    ctx.accounts.authority.to_account_info(),
                    ctx.accounts.token_program.to_account_info(),
                    tax_amount,
                )?;
                
                // Aggiorna le statistiche delle tasse
                update_tax_stats(
                    &mut ctx.accounts.token_info.to_account_info(),
                    tax_amount,
                    transaction_type,
                )?;
            }
            
            // Se è una vendita, verifica se è necessario un intervento di supporto al prezzo
            if transaction_type == TransactionType::Sell && token_info.price_support_config.enabled {
                check_price_support(
                    &ctx.accounts.token_info,
                    &ctx.accounts.price_oracle,
                )?;
            }
        } else {
            // Se il buybot è disabilitato, esegui un trasferimento normale
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.from.to_account_info(),
                        to: ctx.accounts.to.to_account_info(),
                        authority: ctx.accounts.authority.to_account_info(),
                    },
                ),
                amount,
            )?;
        }
        
        msg!("Trasferimento completato: {} token", amount);
        
        Ok(())
    }
    
    /// Esegue un buyback
    pub fn execute_buyback(
        ctx: Context<ExecuteBuyback>,
        amount: u64,
    ) -> Result<()> {
        let token_info = &mut ctx.accounts.token_info;
        
        // Verifica che il buyback sia abilitato
        if !token_info.buyback_config.enabled {
            return Err(ErrorCode::BuybackDisabled.into());
        }
        
        // Verifica che il chiamante sia autorizzato
        if ctx.accounts.authority.key() != token_info.owner && 
           ctx.accounts.authority.key() != ctx.accounts.buybot_authority.key() {
            return Err(ErrorCode::UnauthorizedBuyback.into());
        }
        
        // Verifica che l'importo non superi il massimo per operazione
        if amount > token_info.buyback_config.max_amount_per_operation {
            return Err(ErrorCode::BuybackAmountTooLarge.into());
        }
        
        // Verifica che sia passato abbastanza tempo dall'ultimo buyback
        let current_time = Clock::get()?.unix_timestamp;
        if current_time - token_info.buyback_stats.last_executed < token_info.buyback_config.min_interval_seconds as i64 {
            return Err(ErrorCode::BuybackTooFrequent.into());
        }
        
        // Esegui il buyback (acquista token dal mercato)
        // In una implementazione reale, qui eseguiremmo l'acquisto di token
        // Per ora, simuliamo l'acquisto
        
        // Aggiorna le statistiche del buyback
        token_info.buyback_stats.total_amount = token_info.buyback_stats.total_amount
            .checked_add(amount)
            .ok_or(ErrorCode::ArithmeticError)?;
        token_info.buyback_stats.count = token_info.buyback_stats.count
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticError)?;
        token_info.buyback_stats.last_executed = current_time;
        
        msg!("Buyback eseguito: {} token", amount);
        
        Ok(())
    }
    
    /// Esegue un burn
    pub fn execute_burn(
        ctx: Context<ExecuteBurn>,
        amount: u64,
    ) -> Result<()> {
        let token_info = &mut ctx.accounts.token_info;
        
        // Verifica che il burn sia abilitato
        if !token_info.burn_config.enabled {
            return Err(ErrorCode::BurnDisabled.into());
        }
        
        // Verifica che il chiamante sia autorizzato
        if ctx.accounts.authority.key() != token_info.owner && 
           ctx.accounts.authority.key() != ctx.accounts.buybot_authority.key() {
            return Err(ErrorCode::UnauthorizedBurn.into());
        }
        
        // Verifica che l'importo non superi il massimo per operazione
        let max_burn_amount = token_info.total_supply
            .checked_mul(token_info.burn_config.amount_per_operation_bps as u64)
            .ok_or(ErrorCode::ArithmeticError)?
            .checked_div(10000)
            .ok_or(ErrorCode::ArithmeticError)?;
        
        if amount > max_burn_amount {
            return Err(ErrorCode::BurnAmountTooLarge.into());
        }
        
        // Verifica che sia passato abbastanza tempo dall'ultimo burn
        let current_time = Clock::get()?.unix_timestamp;
        if current_time - token_info.burn_stats.last_executed < token_info.burn_config.min_interval_seconds as i64 {
            return Err(ErrorCode::BurnTooFrequent.into());
        }
        
        // Esegui il burn
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.burn_from.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;
        
        // Aggiorna l'offerta totale
        token_info.total_supply = token_info.total_supply
            .checked_sub(amount)
            .ok_or(ErrorCode::ArithmeticError)?;
        
        // Aggiorna le statistiche del burn
        token_info.burn_stats.total_amount = token_info.burn_stats.total_amount
            .checked_add(amount)
            .ok_or(ErrorCode::ArithmeticError)?;
        token_info.burn_stats.count = token_info.burn_stats.count
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticError)?;
        token_info.burn_stats.last_executed = current_time;
        
        msg!("Burn eseguito: {} token", amount);
        
        Ok(())
    }
    
    /// Abilita il buybot
    pub fn enable_buybot(
        ctx: Context<ConfigureBuybot>,
    ) -> Result<()> {
        let token_info = &mut ctx.accounts.token_info;
        
        // Verifica che il chiamante sia il proprietario
        if ctx.accounts.authority.key() != token_info.owner {
            return Err(ErrorCode::Unauthorized.into());
        }
        
        // Abilita il buybot
        token_info.buybot_enabled = true;
        
        msg!("Buybot abilitato");
        
        Ok(())
    }
    
    /// Disabilita il buybot
    pub fn disable_buybot(
        ctx: Context<ConfigureBuybot>,
    ) -> Result<()> {
        let token_info = &mut ctx.accounts.token_info;
        
        // Verifica che il chiamante sia il proprietario
        if ctx.accounts.authority.key() != token_info.owner {
            return Err(ErrorCode::Unauthorized.into());
        }
        
        // Disabilita il buybot
        token_info.buybot_enabled = false;
        
        msg!("Buybot disabilitato");
        
        Ok(())
    }
    
    /// Configura le tasse
    pub fn configure_taxes(
        ctx: Context<ConfigureBuybot>,
        buy_tax_bps: u16,
        sell_tax_bps: u16,
        transfer_tax_bps: u16,
        liquidity_bps: u16,
        marketing_bps: u16,
        development_bps: u16,
        burn_bps: u16,
        buyback_bps: u16,
    ) -> Result<()> {
        let token_info = &mut ctx.accounts.token_info;
        
        // Verifica che il chiamante sia il proprietario
        if ctx.accounts.authority.key() != token_info.owner {
            return Err(ErrorCode::Unauthorized.into());
        }
        
        // Verifica che le tasse siano valide
        if buy_tax_bps > 3000 || sell_tax_bps > 3000 || transfer_tax_bps > 3000 {
            return Err(ErrorCode::TaxTooHigh.into());
        }
        
        // Verifica che la distribuzione sommi a 10000 (100%)
        let total_distribution = liquidity_bps
            .checked_add(marketing_bps)
            .ok_or(ErrorCode::ArithmeticError)?
            .checked_add(development_bps)
            .ok_or(ErrorCode::ArithmeticError)?
            .checked_add(burn_bps)
            .ok_or(ErrorCode::ArithmeticError)?
            .checked_add(buyback_bps)
            .ok_or(ErrorCode::ArithmeticError)?;
        
        if total_distribution != 10000 {
            return Err(ErrorCode::InvalidTaxDistribution.into());
        }
        
        // Aggiorna la configurazione delle tasse
        token_info.tax_config.buy_tax_bps = buy_tax_bps;
        token_info.tax_config.sell_tax_bps = sell_tax_bps;
        token_info.tax_config.transfer_tax_bps = transfer_tax_bps;
        token_info.tax_config.distribution.liquidity_bps = liquidity_bps;
        token_info.tax_config.distribution.marketing_bps = marketing_bps;
        token_info.tax_config.distribution.development_bps = development_bps;
        token_info.tax_config.distribution.burn_bps = burn_bps;
        token_info.tax_config.distribution.buyback_bps = buyback_bps;
        
        msg!("Tasse configurate: buy={}bps, sell={}bps, transfer={}bps", 
            buy_tax_bps, sell_tax_bps, transfer_tax_bps);
        
        Ok(())
    }
    
    /// Configura il supporto al prezzo
    pub fn configure_price_support(
        ctx: Context<ConfigureBuybot>,
        enabled: bool,
        target_price: u64,
        tolerance_band_bps: u16,
        intervention_strength: u8,
        max_daily_budget: u64,
    ) -> Result<()> {
        let token_info = &mut ctx.accounts.token_info;
        
        // Verifica che il chiamante sia il proprietario
        if ctx.accounts.authority.key() != token_info.owner {
            return Err(ErrorCode::Unauthorized.into());
        }
        
        // Verifica che i parametri siano validi
        if intervention_strength == 0 || intervention_strength > 10 {
            return Err(ErrorCode::InvalidInterventionStrength.into());
        }
        
        // Aggiorna la configurazione del supporto al prezzo
        token_info.price_support_config.enabled = enabled;
        token_info.price_support_config.target_price = target_price;
        token_info.price_support_config.tolerance_band_bps = tolerance_band_bps;
        token_info.price_support_config.intervention_strength = intervention_strength;
        token_info.price_support_config.max_daily_budget = max_daily_budget;
        
        msg!("Supporto al prezzo configurato: enabled={}, target_price={}", 
            enabled, target_price);
        
        Ok(())
    }
    
    /// Configura la protezione anti-dump
    pub fn configure_anti_dump(
        ctx: Context<ConfigureBuybot>,
        enabled: bool,
        max_sell_per_tx_bps: u16,
        max_sell_per_day_bps: u16,
        cooldown_seconds: u32,
        large_sell_threshold_bps: u16,
    ) -> Result<()> {
        let token_info = &mut ctx.accounts.token_info;
        
        // Verifica che il chiamante sia il proprietario
        if ctx.accounts.authority.key() != token_info.owner {
            return Err(ErrorCode::Unauthorized.into());
        }
        
        // Aggiorna la configurazione anti-dump
        token_info.anti_dump_config.enabled = enabled;
        token_info.anti_dump_config.max_sell_per_tx_bps = max_sell_per_tx_bps;
        token_info.anti_dump_config.max_sell_per_day_bps = max_sell_per_day_bps;
        token_info.anti_dump_config.cooldown_seconds = cooldown_seconds;
        token_info.anti_dump_config.large_sell_threshold_bps = large_sell_threshold_bps;
        
        msg!("Protezione anti-dump configurata: enabled={}", enabled);
        
        Ok(())
    }
    
    /// Lancia il token
    pub fn launch_token(
        ctx: Context<LaunchToken>,
        listing_price: u64,
    ) -> Result<()> {
        let token_info = &mut ctx.accounts.token_info;
        
        // Verifica che il chiamante sia il proprietario o il launchpad autorizzato
        if ctx.accounts.authority.key() != token_info.owner && 
           ctx.accounts.authority.key() != ctx.accounts.launchpad_authority.key() {
            return Err(ErrorCode::Unauthorized.into());
        }
        
        // Imposta il prezzo target per il supporto al prezzo
        token_info.price_support_config.target_price = listing_price;
        
        // Abilita il buybot
        token_info.buybot_enabled = true;
        
        // Imposta la modalità lancio
        token_info.launch_mode = true;
        token_info.launch_timestamp = Clock::get()?.unix_timestamp;
        
        // Durante il lancio, aumentiamo le tasse di vendita per scoraggiare i dump
        token_info.launch_tax_config = TaxConfig {
            buy_tax_bps: token_info.tax_config.buy_tax_bps,
            sell_tax_bps: token_info.tax_config.sell_tax_bps.checked_mul(2).unwrap_or(3000).min(3000), // Raddoppia la tassa di vendita, max 30%
            transfer_tax_bps: token_info.tax_config.transfer_tax_bps,
            distribution: token_info.tax_config.distribution.clone(),
            progressive_tax: token_info.tax_config.progressive_tax.clone(),
        };
        
        // Pianifica la fine della modalità lancio dopo 24 ore
        token_info.launch_end_timestamp = token_info.launch_timestamp + 86400; // 24 ore
        
        msg!("Token lanciato: prezzo={}", listing_price);
        
        Ok(())
    }
    
    /// Processa la fine della modalità lancio
    pub fn process_launch_end(
        ctx: Context<ProcessLaunchEnd>,
    ) -> Result<()> {
        let token_info = &mut ctx.accounts.token_info;
        
        // Verifica che il token sia in modalità lancio
        if !token_info.launch_mode {
            return Err(ErrorCode::NotInLaunchMode.into());
        }
        
        // Verifica che sia passato il tempo di lancio
        let current_time = Clock::get()?.unix_timestamp;
        if current_time < token_info.launch_end_timestamp {
            return Err(ErrorCode::LaunchNotEnded.into());
        }
        
        // Disabilita la modalità lancio
        token_info.launch_mode = false;
        
        msg!("Modalità lancio terminata");
        
        Ok(())
    }
    
    /// Esegue un intervento di supporto al prezzo
    pub fn execute_price_support(
        ctx: Context<ExecutePriceSupport>,
        amount: u64,
    ) -> Result<()> {
        let token_info = &mut ctx.accounts.token_info;
        
        // Verifica che il supporto al prezzo sia abilitato
        if !token_info.price_support_config.enabled {
            return Err(ErrorCode::PriceSupportDisabled.into());
        }
        
        // Verifica che il chiamante sia autorizzato
        if ctx.accounts.authority.key() != token_info.owner && 
           ctx.accounts.authority.key() != ctx.accounts.buybot_authority.key() {
            return Err(ErrorCode::UnauthorizedPriceSupport.into());
        }
        
        // Verifica che l'importo non superi il budget giornaliero rimanente
        let current_time = Clock::get()?.unix_timestamp;
        
        // Se è un nuovo giorno, resetta il budget utilizzato
        if is_new_day(current_time, token_info.price_support_stats.last_intervention) {
            token_info.price_support_stats.budget_used_today = 0;
            token_info.price_support_stats.interventions_today = 0;
        }
        
        let remaining_budget = token_info.price_support_config.max_daily_budget
            .checked_sub(token_info.price_support_stats.budget_used_today)
            .ok_or(ErrorCode::ArithmeticError)?;
        
        if amount > remaining_budget {
            return Err(ErrorCode::InsufficientBudget.into());
        }
        
        // Esegui l'intervento di supporto al prezzo (buyback)
        // In una implementazione reale, qui eseguiremmo l'acquisto di token
        // Per ora, simuliamo l'acquisto
        
        // Aggiorna le statistiche del supporto al prezzo
        token_info.price_support_stats.interventions_today = token_info.price_support_stats.interventions_today
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticError)?;
        token_info.price_support_stats.budget_used_today = token_info.price_support_stats.budget_used_today
            .checked_add(amount)
            .ok_or(ErrorCode::ArithmeticError)?;
        token_info.price_support_stats.last_intervention = current_time;
        
        msg!("Intervento di supporto al prezzo eseguito: {} token", amount);
        
        Ok(())
    }
}

/// Determina il tipo di transazione
fn determine_transaction_type(
    from: &Pubkey,
    to: &Pubkey,
    liquidity_pool: &Pubkey,
) -> TransactionType {
    if to == liquidity_pool {
        TransactionType::Sell
    } else if from == liquidity_pool {
        TransactionType::Buy
    } else {
        TransactionType::Transfer
    }
}

/// Calcola l'importo della tassa
fn calculate_tax(
    amount: u64,
    transaction_type: TransactionType,
    tax_config: &TaxConfig,
    liquidity_pool: &Pubkey,
) -> Result<u64> {
    // Determina la percentuale di tassa in base al tipo di transazione
    let tax_percentage = match transaction_type {
        TransactionType::Buy => tax_config.buy_tax_bps,
        TransactionType::Sell => {
            // Applica tasse progressive se configurate e se è una vendita grande
            if let Some(progressive_tax) = &tax_config.progressive_tax {
                // In una implementazione reale, qui calcoleremmo la percentuale di vendita
                // rispetto alla liquidità totale
                // Per ora, usiamo un valore fisso per la simulazione
                let sell_percentage = 200; // 2% della liquidità
                
                let mut additional_tax = 0;
                for i in 0..progressive_tax.thresholds.len() {
                    if sell_percentage > progressive_tax.thresholds[i] {
                        additional_tax = progressive_tax.additional_taxes[i];
                    }
                }
                
                tax_config.sell_tax_bps.checked_add(additional_tax).unwrap_or(3000).min(3000)
            } else {
                tax_config.sell_tax_bps
            }
        },
        TransactionType::Transfer => tax_config.transfer_tax_bps,
    };
    
    // Calcola l'importo della tassa
    let tax_amount = amount
        .checked_mul(tax_percentage as u64)
        .ok_or(ErrorCode::ArithmeticError)?
        .checked_div(10000)
        .ok_or(ErrorCode::ArithmeticError)?;
    
    Ok(tax_amount)
}

/// Distribuisce le tasse
fn distribute_taxes(
    from: AccountInfo,
    tax_collector: AccountInfo,
    authority: AccountInfo,
    token_program: AccountInfo,
    tax_amount: u64,
) -> Result<()> {
    // Trasferisci le tasse al tax collector
    token::transfer(
        CpiContext::new(
            token_program,
            Transfer {
                from,
                to: tax_collector,
                authority,
            },
        ),
        tax_amount,
    )?;
    
    Ok(())
}

/// Aggiorna le statistiche delle tasse
fn update_tax_stats(
    token_info: &mut AccountInfo,
    tax_amount: u64,
    transaction_type: TransactionType,
) -> Result<()> {
    let mut token_info_data = token_info.try_borrow_mut_data()?;
    let token_info_account = TokenInfo::try_from_slice(&token_info_data)?;
    
    // Aggiorna le statistiche totali
    let total_taxes_collected = token_info_account.tax_stats.total_taxes_collected
        .checked_add(tax_amount)
        .ok_or(ErrorCode::ArithmeticError)?;
    
    // Aggiorna le statistiche per tipo di transazione
    match transaction_type {
        TransactionType::Buy => {
            let buy_taxes = token_info_account.tax_stats.buy_taxes
                .checked_add(tax_amount)
                .ok_or(ErrorCode::ArithmeticError)?;
            token_info_account.tax_stats.buy_taxes = buy_taxes;
        },
        TransactionType::Sell => {
            let sell_taxes = token_info_account.tax_stats.sell_taxes
                .checked_add(tax_amount)
                .ok_or(ErrorCode::ArithmeticError)?;
            token_info_account.tax_stats.sell_taxes = sell_taxes;
        },
        TransactionType::Transfer => {
            let transfer_taxes = token_info_account.tax_stats.transfer_taxes
                .checked_add(tax_amount)
                .ok_or(ErrorCode::ArithmeticError)?;
            token_info_account.tax_stats.transfer_taxes = transfer_taxes;
        },
    }
    
    token_info_account.tax_stats.total_taxes_collected = total_taxes_collected;
    
    token_info_account.serialize(&mut token_info_data)?;
    
    Ok(())
}

/// Verifica se è necessario un intervento di supporto al prezzo
fn check_price_support(
    token_info: &TokenInfo,
    price_oracle: &AccountInfo,
) -> Result<()> {
    // In una implementazione reale, qui leggeremmo il prezzo corrente dall'oracle
    // e verificheremmo se è necessario un intervento
    // Per ora, simuliamo la verifica
    
    // Simula la lettura del prezzo corrente
    let current_price = 100; // Prezzo simulato
    
    // Calcola la banda di tolleranza
    let tolerance = token_info.price_support_config.target_price
        .checked_mul(token_info.price_support_config.tolerance_band_bps as u64)
        .ok_or(ErrorCode::ArithmeticError)?
        .checked_div(10000)
        .ok_or(ErrorCode::ArithmeticError)?;
    
    let lower_bound = token_info.price_support_config.target_price
        .checked_sub(tolerance)
        .ok_or(ErrorCode::ArithmeticError)?;
    
    // Se il prezzo è sotto la banda di tolleranza, intervieni
    if current_price < lower_bound {
        // In una implementazione reale, qui attiveremmo l'intervento di supporto al prezzo
        // Per ora, simuliamo l'attivazione
        msg!("Attivazione intervento di supporto al prezzo: prezzo={}, target={}", 
            current_price, token_info.price_support_config.target_price);
    }
    
    Ok(())
}

/// Verifica se è un nuovo giorno
fn is_new_day(current_time: i64, last_time: i64) -> bool {
    // Converti i timestamp in giorni
    let current_day = current_time / 86400;
    let last_day = last_time / 86400;
    
    current_day > last_day
}

/// Tipo di transazione
#[derive(Clone, Copy, PartialEq)]
pub enum TransactionType {
    Buy,
    Sell,
    Transfer,
}

/// Configurazione delle tasse
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TaxConfig {
    /// Percentuale di tassa sugli acquisti (in basis points, 1% = 100)
    pub buy_tax_bps: u16,
    /// Percentuale di tassa sulle vendite (in basis points)
    pub sell_tax_bps: u16,
    /// Percentuale di tassa sui trasferimenti (in basis points)
    pub transfer_tax_bps: u16,
    /// Distribuzione delle tasse
    pub distribution: TaxDistribution,
    /// Configurazione delle tasse progressive
    pub progressive_tax: Option<ProgressiveTaxConfig>,
}

/// Distribuzione delle tasse
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TaxDistribution {
    /// Percentuale per liquidità (in basis points di tassa totale)
    pub liquidity_bps: u16,
    /// Percentuale per marketing (in basis points di tassa totale)
    pub marketing_bps: u16,
    /// Percentuale per sviluppo (in basis points di tassa totale)
    pub development_bps: u16,
    /// Percentuale per burn (in basis points di tassa totale)
    pub burn_bps: u16,
    /// Percentuale per buyback (in basis points di tassa totale)
    pub buyback_bps: u16,
}

/// Configurazione delle tasse progressive
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProgressiveTaxConfig {
    /// Soglie di vendita (in percentuale della liquidità totale)
    pub thresholds: Vec<u16>,
    /// Tasse aggiuntive per ogni soglia (in basis points)
    pub additional_taxes: Vec<u16>,
}

/// Configurazione del buyback
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BuybackConfig {
    /// Se il buyback automatico è abilitato
    pub enabled: bool,
    /// Soglia di prezzo per il buyback (in percentuale del prezzo massimo)
    pub price_threshold_bps: u16,
    /// Importo massimo per operazione di buyback
    pub max_amount_per_operation: u64,
    /// Importo massimo giornaliero per buyback
    pub max_daily_amount: u64,
    /// Intervallo minimo tra operazioni di buyback (in secondi)
    pub min_interval_seconds: u32,
}

/// Configurazione del burn
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BurnConfig {
    /// Se il burn automatico è abilitato
    pub enabled: bool,
    /// Percentuale dell'offerta totale da bruciare per operazione
    pub amount_per_operation_bps: u16,
    /// Percentuale massima dell'offerta totale da bruciare giornalmente
    pub max_daily_amount_bps: u16,
    /// Intervallo minimo tra operazioni di burn (in secondi)
    pub min_interval_seconds: u32,
}

/// Configurazione anti-dump
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AntiDumpConfig {
    /// Se la protezione anti-dump è abilitata
    pub enabled: bool,
    /// Limite massimo di vendita per transazione (in percentuale della liquidità totale)
    pub max_sell_per_tx_bps: u16,
    /// Limite massimo di vendita per wallet in 24 ore (in percentuale della liquidità totale)
    pub max_sell_per_day_bps: u16,
    /// Periodo di cooldown tra vendite grandi (in secondi)
    pub cooldown_seconds: u32,
    /// Soglia per considerare una vendita come "grande" (in percentuale della liquidità totale)
    pub large_sell_threshold_bps: u16,
}

/// Configurazione del supporto al prezzo
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PriceSupportConfig {
    /// Se il supporto al prezzo è abilitato
    pub enabled: bool,
    /// Prezzo target (in unità di base)
    pub target_price: u64,
    /// Banda di tolleranza attorno al prezzo target (in basis points)
    pub tolerance_band_bps: u16,
    /// Intensità dell'intervento (1-10)
    pub intervention_strength: u8,
    /// Budget massimo giornaliero per supporto al prezzo (in unità di base)
    pub max_daily_budget: u64,
}

/// Statistiche delle tasse
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TaxStats {
    /// Tasse totali raccolte
    pub total_taxes_collected: u64,
    /// Tasse raccolte dagli acquisti
    pub buy_taxes: u64,
    /// Tasse raccolte dalle vendite
    pub sell_taxes: u64,
    /// Tasse raccolte dai trasferimenti
    pub transfer_taxes: u64,
}

/// Statistiche del buyback
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BuybackStats {
    /// Importo totale di buyback
    pub total_amount: u64,
    /// Numero di operazioni di buyback
    pub count: u32,
    /// Timestamp dell'ultimo buyback
    pub last_executed: i64,
}

/// Statistiche del burn
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BurnStats {
    /// Importo totale di burn
    pub total_amount: u64,
    /// Numero di operazioni di burn
    pub count: u32,
    /// Timestamp dell'ultimo burn
    pub last_executed: i64,
}

/// Statistiche del supporto al prezzo
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PriceSupportStats {
    /// Numero di interventi oggi
    pub interventions_today: u32,
    /// Budget utilizzato oggi
    pub budget_used_today: u64,
    /// Timestamp dell'ultimo intervento
    pub last_intervention: i64,
}

/// Account per le informazioni sul token
#[account]
pub struct TokenInfo {
    /// Nome del token
    pub name: String,
    /// Simbolo del token
    pub symbol: String,
    /// Decimali del token
    pub decimals: u8,
    /// Offerta totale
    pub total_supply: u64,
    /// Offerta massima
    pub max_supply: u64,
    /// Indirizzo del proprietario
    pub owner: Pubkey,
    /// Se il buybot è abilitato
    pub buybot_enabled: bool,
    /// Timestamp di creazione
    pub created_at: i64,
    /// Configurazione delle tasse
    pub tax_config: TaxConfig,
    /// Configurazione del buyback
    pub buyback_config: BuybackConfig,
    /// Configurazione del burn
    pub burn_config: BurnConfig,
    /// Configurazione anti-dump
    pub anti_dump_config: AntiDumpConfig,
    /// Configurazione del supporto al prezzo
    pub price_support_config: PriceSupportConfig,
    /// Statistiche delle tasse
    pub tax_stats: TaxStats,
    /// Statistiche del buyback
    pub buyback_stats: BuybackStats,
    /// Statistiche del burn
    pub burn_stats: BurnStats,
    /// Statistiche del supporto al prezzo
    pub price_support_stats: PriceSupportStats,
    /// Se il token è in modalità lancio
    pub launch_mode: bool,
    /// Timestamp di lancio
    pub launch_timestamp: i64,
    /// Timestamp di fine lancio
    pub launch_end_timestamp: i64,
    /// Configurazione delle tasse durante il lancio
    pub launch_tax_config: TaxConfig,
}

/// Contesto per l'inizializzazione del token
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = owner, space = 8 + 1000)]
    pub token_info: Account<'info, TokenInfo>,
    
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub owner_token_account: Account<'info, TokenAccount>,
    
    pub mint_authority: Signer<'info>,
    
    #[account(mut)]
    pub owner: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    
    pub system_program: Program<'info, System>,
}

/// Contesto per il trasferimento di token
#[derive(Accounts)]
pub struct TransferTokens<'info> {
    #[account(mut)]
    pub token_info: Account<'info, TokenInfo>,
    
    #[account(mut)]
    pub from: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub to: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub tax_collector: Account<'info, TokenAccount>,
    
    /// CHECK: Questo account è usato solo per confronto
    pub liquidity_pool: AccountInfo<'info>,
    
    /// CHECK: Questo account è usato solo per leggere il prezzo
    pub price_oracle: AccountInfo<'info>,
    
    pub authority: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

/// Contesto per l'esecuzione di un buyback
#[derive(Accounts)]
pub struct ExecuteBuyback<'info> {
    #[account(mut)]
    pub token_info: Account<'info, TokenInfo>,
    
    #[account(mut)]
    pub buyback_fund: Account<'info, TokenAccount>,
    
    /// CHECK: Questo account è usato solo per autorizzazione
    pub buybot_authority: AccountInfo<'info>,
    
    pub authority: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

/// Contesto per l'esecuzione di un burn
#[derive(Accounts)]
pub struct ExecuteBurn<'info> {
    #[account(mut)]
    pub token_info: Account<'info, TokenInfo>,
    
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub burn_from: Account<'info, TokenAccount>,
    
    /// CHECK: Questo account è usato solo per autorizzazione
    pub buybot_authority: AccountInfo<'info>,
    
    pub authority: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

/// Contesto per la configurazione del buybot
#[derive(Accounts)]
pub struct ConfigureBuybot<'info> {
    #[account(mut)]
    pub token_info: Account<'info, TokenInfo>,
    
    pub authority: Signer<'info>,
}

/// Contesto per il lancio del token
#[derive(Accounts)]
pub struct LaunchToken<'info> {
    #[account(mut)]
    pub token_info: Account<'info, TokenInfo>,
    
    /// CHECK: Questo account è usato solo per autorizzazione
    pub launchpad_authority: AccountInfo<'info>,
    
    pub authority: Signer<'info>,
}

/// Contesto per il processamento della fine del lancio
#[derive(Accounts)]
pub struct ProcessLaunchEnd<'info> {
    #[account(mut)]
    pub token_info: Account<'info, TokenInfo>,
    
    pub authority: Signer<'info>,
}

/// Contesto per l'esecuzione di un intervento di supporto al prezzo
#[derive(Accounts)]
pub struct ExecutePriceSupport<'info> {
    #[account(mut)]
    pub token_info: Account<'info, TokenInfo>,
    
    #[account(mut)]
    pub support_fund: Account<'info, TokenAccount>,
    
    /// CHECK: Questo account è usato solo per autorizzazione
    pub buybot_authority: AccountInfo<'info>,
    
    pub authority: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

/// Codici di errore
#[error_code]
pub enum ErrorCode {
    #[msg("Operazione non autorizzata")]
    Unauthorized,
    
    #[msg("Errore aritmetico")]
    ArithmeticError,
    
    #[msg("Buyback disabilitato")]
    BuybackDisabled,
    
    #[msg("Buyback non autorizzato")]
    UnauthorizedBuyback,
    
    #[msg("Importo di buyback troppo grande")]
    BuybackAmountTooLarge,
    
    #[msg("Buyback troppo frequente")]
    BuybackTooFrequent,
    
    #[msg("Burn disabilitato")]
    BurnDisabled,
    
    #[msg("Burn non autorizzato")]
    UnauthorizedBurn,
    
    #[msg("Importo di burn troppo grande")]
    BurnAmountTooLarge,
    
    #[msg("Burn troppo frequente")]
    BurnTooFrequent,
    
    #[msg("Tassa troppo alta")]
    TaxTooHigh,
    
    #[msg("Distribuzione delle tasse non valida")]
    InvalidTaxDistribution,
    
    #[msg("Intensità di intervento non valida")]
    InvalidInterventionStrength,
    
    #[msg("Supporto al prezzo disabilitato")]
    PriceSupportDisabled,
    
    #[msg("Supporto al prezzo non autorizzato")]
    UnauthorizedPriceSupport,
    
    #[msg("Budget insufficiente")]
    InsufficientBudget,
    
    #[msg("Non in modalità lancio")]
    NotInLaunchMode,
    
    #[msg("Lancio non terminato")]
    LaunchNotEnded,
}
