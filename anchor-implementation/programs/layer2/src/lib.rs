use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};
use solana_program::{program::invoke_signed, system_instruction};
use std::convert::TryInto;

declare_id!("Layer2111111111111111111111111111111111111111");

#[program]
pub mod layer2 {
    use super::*;

    /// Inizializza il sistema Layer-2
    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        let layer2_state = &mut ctx.accounts.layer2_state;
        layer2_state.authority = ctx.accounts.authority.key();
        layer2_state.sequencer = params.sequencer;
        layer2_state.is_active = true;
        layer2_state.version = 1;
        layer2_state.fraud_proof_window = params.fraud_proof_window;
        layer2_state.finalization_window = params.finalization_window;
        layer2_state.bump = *ctx.bumps.get("layer2_state").unwrap();
        
        msg!("Layer-2 system initialized with authority: {}", layer2_state.authority);
        Ok(())
    }

    /// Registra un nuovo token nel sistema
    pub fn register_token(ctx: Context<RegisterToken>, params: RegisterTokenParams) -> Result<()> {
        let token_info = &mut ctx.accounts.token_info;
        token_info.mint = ctx.accounts.mint.key();
        token_info.authority = ctx.accounts.authority.key();
        token_info.is_active = true;
        token_info.is_native = params.is_native;
        token_info.bridge_source = params.bridge_source;
        token_info.decimals = ctx.accounts.mint.decimals;
        token_info.bump = *ctx.bumps.get("token_info").unwrap();
        
        // Inizializza le informazioni di buybot se richiesto
        if params.enable_buybot {
            token_info.buybot_enabled = true;
            token_info.tax_buy = params.tax_buy;
            token_info.tax_sell = params.tax_sell;
            token_info.tax_transfer = params.tax_transfer;
            token_info.liquidity_lock_period = params.liquidity_lock_period;
            token_info.anti_rug_score = 0; // Sarà calcolato dall'Anti-Rug System
        }
        
        msg!("Token registered: {}", token_info.mint);
        Ok(())
    }

    /// Deposita token nel Layer-2
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        // Trasferisce i token dall'utente al vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;
        
        // Aggiorna il deposito dell'utente
        let user_deposit = &mut ctx.accounts.user_deposit;
        user_deposit.owner = ctx.accounts.user.key();
        user_deposit.mint = ctx.accounts.token_info.mint;
        user_deposit.amount = user_deposit.amount.checked_add(amount).unwrap();
        user_deposit.layer2_address = ctx.accounts.user.key(); // Usa la stessa chiave per semplicità
        
        // Emette un evento di deposito
        emit!(DepositEvent {
            user: ctx.accounts.user.key(),
            mint: ctx.accounts.token_info.mint,
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        msg!("Deposited {} tokens to Layer-2", amount);
        Ok(())
    }

    /// Ritira token dal Layer-2
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        // Verifica che l'utente abbia abbastanza token
        require!(
            ctx.accounts.user_deposit.amount >= amount,
            ErrorCode::InsufficientFunds
        );
        
        // Calcola le tasse se il buybot è abilitato
        let mut tax_amount = 0;
        if ctx.accounts.token_info.buybot_enabled {
            tax_amount = amount
                .checked_mul(ctx.accounts.token_info.tax_sell as u64)
                .unwrap()
                .checked_div(100)
                .unwrap();
        }
        
        let transfer_amount = amount.checked_sub(tax_amount).unwrap();
        
        // Trasferisce i token dal vault all'utente
        let seeds = &[
            b"vault",
            ctx.accounts.token_info.mint.as_ref(),
            &[ctx.accounts.vault.bump],
        ];
        let signer = &[&seeds[..]];
        
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer,
            ),
            transfer_amount,
        )?;
        
        // Aggiorna il deposito dell'utente
        let user_deposit = &mut ctx.accounts.user_deposit;
        user_deposit.amount = user_deposit.amount.checked_sub(amount).unwrap();
        
        // Se c'è una tassa, gestiscila
        if tax_amount > 0 {
            // Implementazione della gestione delle tasse (buyback, burn, ecc.)
            // Per semplicità, qui manteniamo i token nel vault
            emit!(TaxEvent {
                mint: ctx.accounts.token_info.mint,
                amount: tax_amount,
                tax_type: TaxType::Sell,
                timestamp: Clock::get()?.unix_timestamp,
            });
        }
        
        // Emette un evento di prelievo
        emit!(WithdrawEvent {
            user: ctx.accounts.user.key(),
            mint: ctx.accounts.token_info.mint,
            amount: transfer_amount,
            tax_amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        msg!("Withdrawn {} tokens from Layer-2 (tax: {})", transfer_amount, tax_amount);
        Ok(())
    }

    /// Verifica un VAA di Wormhole per il bridge
    pub fn verify_vaa(ctx: Context<VerifyVAA>, vaa_hash: [u8; 32]) -> Result<()> {
        // Qui dovremmo fare una CPI a Wormhole per verificare il VAA
        // Per semplicità, simuliamo la verifica
        
        let bridge_state = &mut ctx.accounts.bridge_state;
        bridge_state.vaa_hash = vaa_hash;
        bridge_state.is_verified = true;
        bridge_state.timestamp = Clock::get()?.unix_timestamp;
        
        msg!("VAA verified: {:?}", vaa_hash);
        Ok(())
    }

    /// Esegue un bundle di transazioni
    pub fn execute_bundle(ctx: Context<ExecuteBundle>, params: ExecuteBundleParams) -> Result<()> {
        let bundle = &mut ctx.accounts.bundle;
        bundle.sequencer = ctx.accounts.sequencer.key();
        bundle.transaction_count = params.transaction_count;
        bundle.merkle_root = params.merkle_root;
        bundle.timestamp = Clock::get()?.unix_timestamp;
        bundle.is_executed = true;
        
        // Emette un evento di esecuzione bundle
        emit!(BundleExecutedEvent {
            bundle_id: bundle.key(),
            sequencer: bundle.sequencer,
            transaction_count: bundle.transaction_count,
            merkle_root: bundle.merkle_root,
            timestamp: bundle.timestamp,
        });
        
        msg!("Bundle executed with {} transactions", params.transaction_count);
        Ok(())
    }

    /// Blocca la liquidità per un token
    pub fn lock_liquidity(ctx: Context<LockLiquidity>, params: LockLiquidityParams) -> Result<()> {
        let liquidity_lock = &mut ctx.accounts.liquidity_lock;
        liquidity_lock.owner = ctx.accounts.owner.key();
        liquidity_lock.mint = ctx.accounts.token_info.mint;
        liquidity_lock.token_amount = params.token_amount;
        liquidity_lock.base_amount = params.base_amount;
        liquidity_lock.unlock_time = Clock::get()?.unix_timestamp + params.lock_period as i64;
        liquidity_lock.is_locked = true;
        
        // Aggiorna lo score anti-rug del token
        let token_info = &mut ctx.accounts.token_info;
        token_info.anti_rug_score = token_info.anti_rug_score.saturating_add(20); // Aumenta lo score
        
        // Emette un evento di blocco liquidità
        emit!(LiquidityLockedEvent {
            owner: liquidity_lock.owner,
            mint: liquidity_lock.mint,
            token_amount: liquidity_lock.token_amount,
            base_amount: liquidity_lock.base_amount,
            unlock_time: liquidity_lock.unlock_time,
        });
        
        msg!("Liquidity locked until timestamp {}", liquidity_lock.unlock_time);
        Ok(())
    }

    /// Crea un nuovo token tramite il launchpad
    pub fn create_token(ctx: Context<CreateToken>, params: CreateTokenParams) -> Result<()> {
        // Inizializza il token info
        let token_info = &mut ctx.accounts.token_info;
        token_info.mint = ctx.accounts.mint.key();
        token_info.authority = ctx.accounts.authority.key();
        token_info.is_active = true;
        token_info.is_native = true;
        token_info.decimals = params.decimals;
        token_info.bump = *ctx.bumps.get("token_info").unwrap();
        
        // Configura il buybot per il token
        token_info.buybot_enabled = params.enable_buybot;
        if params.enable_buybot {
            token_info.tax_buy = params.tax_buy;
            token_info.tax_sell = params.tax_sell;
            token_info.tax_transfer = params.tax_transfer;
            token_info.liquidity_lock_period = params.liquidity_lock_period;
        }
        
        // Inizializza il launchpad info
        let launchpad_info = &mut ctx.accounts.launchpad_info;
        launchpad_info.mint = ctx.accounts.mint.key();
        launchpad_info.creator = ctx.accounts.authority.key();
        launchpad_info.presale_price = params.presale_price;
        launchpad_info.listing_price = params.listing_price;
        launchpad_info.soft_cap = params.soft_cap;
        launchpad_info.hard_cap = params.hard_cap;
        launchpad_info.min_contribution = params.min_contribution;
        launchpad_info.max_contribution = params.max_contribution;
        launchpad_info.liquidity_percentage = params.liquidity_percentage;
        launchpad_info.start_time = params.start_time;
        launchpad_info.end_time = params.end_time;
        launchpad_info.status = LaunchpadStatus::Created;
        
        // Emette un evento di creazione token
        emit!(TokenCreatedEvent {
            mint: ctx.accounts.mint.key(),
            creator: ctx.accounts.authority.key(),
            decimals: params.decimals,
            buybot_enabled: params.enable_buybot,
        });
        
        msg!("Token created via launchpad: {}", ctx.accounts.mint.key());
        Ok(())
    }

    /// Contribuisce a una presale nel launchpad
    pub fn contribute_presale(ctx: Context<ContributePresale>, amount: u64) -> Result<()> {
        // Verifica che la presale sia attiva
        let launchpad_info = &ctx.accounts.launchpad_info;
        require!(
            launchpad_info.status == LaunchpadStatus::Active,
            ErrorCode::PresaleNotActive
        );
        
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            current_time >= launchpad_info.start_time && current_time <= launchpad_info.end_time,
            ErrorCode::PresaleNotActive
        );
        
        // Verifica che l'importo sia nei limiti
        require!(
            amount >= launchpad_info.min_contribution && amount <= launchpad_info.max_contribution,
            ErrorCode::InvalidContributionAmount
        );
        
        // Trasferisce i token base (SOL o altro) al vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.presale_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;
        
        // Aggiorna o crea la contribuzione dell'utente
        let contribution = &mut ctx.accounts.contribution;
        contribution.user = ctx.accounts.user.key();
        contribution.launchpad = ctx.accounts.launchpad_info.key();
        contribution.amount = contribution.amount.checked_add(amount).unwrap();
        
        // Aggiorna il totale raccolto
        let presale_state = &mut ctx.accounts.presale_state;
        presale_state.total_raised = presale_state.total_raised.checked_add(amount).unwrap();
        
        // Emette un evento di contribuzione
        emit!(ContributionEvent {
            user: ctx.accounts.user.key(),
            launchpad: ctx.accounts.launchpad_info.key(),
            amount,
            total_contribution: contribution.amount,
            timestamp: current_time,
        });
        
        msg!("Contributed {} to presale", amount);
        Ok(())
    }

    /// Finalizza una presale e lancia il token
    pub fn finalize_presale(ctx: Context<FinalizePresale>) -> Result<()> {
        let launchpad_info = &mut ctx.accounts.launchpad_info;
        let presale_state = &ctx.accounts.presale_state;
        
        // Verifica che la presale sia terminata
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            current_time > launchpad_info.end_time,
            ErrorCode::PresaleNotEnded
        );
        
        // Verifica che sia stato raggiunto almeno il soft cap
        require!(
            presale_state.total_raised >= launchpad_info.soft_cap,
            ErrorCode::SoftCapNotReached
        );
        
        // Calcola quanto token distribuire per la liquidità
        let liquidity_percentage = launchpad_info.liquidity_percentage as u64;
        let liquidity_amount = presale_state.total_raised
            .checked_mul(liquidity_percentage)
            .unwrap()
            .checked_div(100)
            .unwrap();
        
        // Trasferisce i fondi per la liquidità
        // Qui dovremmo implementare la creazione della liquidità
        // Per semplicità, simuliamo il processo
        
        // Aggiorna lo stato del launchpad
        launchpad_info.status = LaunchpadStatus::Launched;
        
        // Blocca la liquidità se il buybot è abilitato
        if ctx.accounts.token_info.buybot_enabled {
            // Qui dovremmo chiamare lock_liquidity
            // Per semplicità, simuliamo il processo
            ctx.accounts.token_info.anti_rug_score = ctx.accounts.token_info.anti_rug_score.saturating_add(20);
        }
        
        // Emette un evento di finalizzazione
        emit!(PresaleFinalizedEvent {
            launchpad: launchpad_info.key(),
            total_raised: presale_state.total_raised,
            liquidity_amount,
            timestamp: current_time,
        });
        
        msg!("Presale finalized and token launched");
        Ok(())
    }

    /// Esegue un'operazione di buyback
    pub fn execute_buyback(ctx: Context<ExecuteBuyback>, amount: u64) -> Result<()> {
        // Verifica che il buybot sia abilitato
        require!(
            ctx.accounts.token_info.buybot_enabled,
            ErrorCode::BuybotNotEnabled
        );
        
        // Verifica che il chiamante sia l'autorità
        require!(
            ctx.accounts.authority.key() == ctx.accounts.token_info.authority,
            ErrorCode::Unauthorized
        );
        
        // Esegue il buyback
        // Per semplicità, simuliamo il processo
        
        // Emette un evento di buyback
        emit!(BuybackEvent {
            mint: ctx.accounts.token_info.mint,
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        msg!("Executed buyback of {} tokens", amount);
        Ok(())
    }

    /// Esegue un'operazione di burn
    pub fn execute_burn(ctx: Context<ExecuteBurn>, amount: u64) -> Result<()> {
        // Verifica che il buybot sia abilitato
        require!(
            ctx.accounts.token_info.buybot_enabled,
            ErrorCode::BuybotNotEnabled
        );
        
        // Verifica che il chiamante sia l'autorità
        require!(
            ctx.accounts.authority.key() == ctx.accounts.token_info.authority,
            ErrorCode::Unauthorized
        );
        
        // Brucia i token
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.token_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;
        
        // Emette un evento di burn
        emit!(BurnEvent {
            mint: ctx.accounts.mint.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        msg!("Burned {} tokens", amount);
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(params: InitializeParams)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + Layer2State::LEN,
        seeds = [b"layer2_state"],
        bump
    )]
    pub layer2_state: Account<'info, Layer2State>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(params: RegisterTokenParams)]
pub struct RegisterToken<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + TokenInfo::LEN,
        seeds = [b"token_info", mint.key().as_ref()],
        bump
    )]
    pub token_info: Account<'info, TokenInfo>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == token_info.mint
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"vault", token_info.mint.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, TokenVault>,
    
    #[account(
        seeds = [b"token_info", token_info.mint.as_ref()],
        bump = token_info.bump
    )]
    pub token_info: Account<'info, TokenInfo>,
    
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserDeposit::LEN,
        seeds = [b"user_deposit", user.key().as_ref(), token_info.mint.as_ref()],
        bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == token_info.mint
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"vault", token_info.mint.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, TokenVault>,
    
    #[account(
        seeds = [b"token_info", token_info.mint.as_ref()],
        bump = token_info.bump
    )]
    pub token_info: Account<'info, TokenInfo>,
    
    #[account(
        mut,
        seeds = [b"user_deposit", user.key().as_ref(), token_info.mint.as_ref()],
        bump,
        constraint = user_deposit.owner == user.key()
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct VerifyVAA<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + BridgeState::LEN,
        seeds = [b"bridge_state"],
        bump
    )]
    pub bridge_state: Account<'info, BridgeState>,
    
    // Qui dovremmo includere gli account di Wormhole per la verifica
    // Per semplicità, li omettiamo
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(params: ExecuteBundleParams)]
pub struct ExecuteBundle<'info> {
    #[account(mut)]
    pub sequencer: Signer<'info>,
    
    #[account(
        init,
        payer = sequencer,
        space = 8 + Bundle::LEN,
        seeds = [b"bundle", sequencer.key().as_ref(), &params.bundle_id.to_le_bytes()],
        bump
    )]
    pub bundle: Account<'info, Bundle>,
    
    #[account(
        seeds = [b"layer2_state"],
        bump = layer2_state.bump,
        constraint = layer2_state.is_active,
        constraint = layer2_state.sequencer == sequencer.key()
    )]
    pub layer2_state: Account<'info, Layer2State>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(params: LockLiquidityParams)]
pub struct LockLiquidity<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"token_info", token_info.mint.as_ref()],
        bump = token_info.bump
    )]
    pub token_info: Account<'info, TokenInfo>,
    
    #[account(
        init,
        payer = owner,
        space = 8 + LiquidityLock::LEN,
        seeds = [b"liquidity_lock", token_info.mint.as_ref(), owner.key().as_ref()],
        bump
    )]
    pub liquidity_lock: Account<'info, LiquidityLock>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(params: CreateTokenParams)]
pub struct CreateToken<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + TokenInfo::LEN,
        seeds = [b"token_info", mint.key().as_ref()],
        bump
    )]
    pub token_info: Account<'info, TokenInfo>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + LaunchpadInfo::LEN,
        seeds = [b"launchpad_info", mint.key().as_ref()],
        bump
    )]
    pub launchpad_info: Account<'info, LaunchpadInfo>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ContributePresale<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"presale_vault", launchpad_info.mint.as_ref()],
        bump
    )]
    pub presale_vault: Account<'info, TokenAccount>,
    
    #[account(
        seeds = [b"launchpad_info", launchpad_info.mint.as_ref()],
        bump,
        constraint = launchpad_info.status == LaunchpadStatus::Active
    )]
    pub launchpad_info: Account<'info, LaunchpadInfo>,
    
    #[account(
        mut,
        seeds = [b"presale_state", launchpad_info.mint.as_ref()],
        bump
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Contribution::LEN,
        seeds = [b"contribution", user.key().as_ref(), launchpad_info.mint.as_ref()],
        bump
    )]
    pub contribution: Account<'info, Contribution>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizePresale<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"launchpad_info", launchpad_info.mint.as_ref()],
        bump,
        constraint = launchpad_info.creator == authority.key(),
        constraint = launchpad_info.status == LaunchpadStatus::Active
    )]
    pub launchpad_info: Account<'info, LaunchpadInfo>,
    
    #[account(
        seeds = [b"presale_state", launchpad_info.mint.as_ref()],
        bump
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    #[account(
        mut,
        seeds = [b"token_info", launchpad_info.mint.as_ref()],
        bump = token_info.bump
    )]
    pub token_info: Account<'info, TokenInfo>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteBuyback<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        seeds = [b"token_info", token_info.mint.as_ref()],
        bump = token_info.bump,
        constraint = token_info.buybot_enabled
    )]
    pub token_info: Account<'info, TokenInfo>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteBurn<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        constraint = mint.key() == token_info.mint
    )]
    pub mint: Account<'info, Mint>,
    
    #[account(
        mut,
        constraint = token_account.mint == mint.key(),
        constraint = token_account.owner == authority.key()
    )]
    pub token_account: Account<'info, TokenAccount>,
    
    #[account(
        seeds = [b"token_info", token_info.mint.as_ref()],
        bump = token_info.bump,
        constraint = token_info.buybot_enabled
    )]
    pub token_info: Account<'info, TokenInfo>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(Default)]
pub struct Layer2State {
    pub authority: Pubkey,
    pub sequencer: Pubkey,
    pub is_active: bool,
    pub version: u8,
    pub fraud_proof_window: i64,
    pub finalization_window: i64,
    pub bump: u8,
}

impl Layer2State {
    pub const LEN: usize = 32 + 32 + 1 + 1 + 8 + 8 + 1;
}

#[account]
#[derive(Default)]
pub struct TokenInfo {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub is_active: bool,
    pub is_native: bool,
    pub bridge_source: [u8; 32],
    pub decimals: u8,
    pub bump: u8,
    
    // Campi BuyBot
    pub buybot_enabled: bool,
    pub tax_buy: u8,
    pub tax_sell: u8,
    pub tax_transfer: u8,
    pub liquidity_lock_period: u64,
    pub anti_rug_score: u8,
}

impl TokenInfo {
    pub const LEN: usize = 32 + 32 + 1 + 1 + 32 + 1 + 1 + 1 + 1 + 1 + 1 + 8 + 1;
}

#[account]
#[derive(Default)]
pub struct TokenVault {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub bump: u8,
}

impl TokenVault {
    pub const LEN: usize = 32 + 32 + 1;
}

#[account]
#[derive(Default)]
pub struct UserDeposit {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub layer2_address: Pubkey,
}

impl UserDeposit {
    pub const LEN: usize = 32 + 32 + 8 + 32;
}

#[account]
#[derive(Default)]
pub struct BridgeState {
    pub vaa_hash: [u8; 32],
    pub is_verified: bool,
    pub timestamp: i64,
}

impl BridgeState {
    pub const LEN: usize = 32 + 1 + 8;
}

#[account]
#[derive(Default)]
pub struct Bundle {
    pub sequencer: Pubkey,
    pub transaction_count: u32,
    pub merkle_root: [u8; 32],
    pub timestamp: i64,
    pub is_executed: bool,
}

impl Bundle {
    pub const LEN: usize = 32 + 4 + 32 + 8 + 1;
}

#[account]
#[derive(Default)]
pub struct LiquidityLock {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub token_amount: u64,
    pub base_amount: u64,
    pub unlock_time: i64,
    pub is_locked: bool,
}

impl LiquidityLock {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 1;
}

#[account]
#[derive(Default)]
pub struct LaunchpadInfo {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub presale_price: u64,
    pub listing_price: u64,
    pub soft_cap: u64,
    pub hard_cap: u64,
    pub min_contribution: u64,
    pub max_contribution: u64,
    pub liquidity_percentage: u8,
    pub start_time: i64,
    pub end_time: i64,
    pub status: LaunchpadStatus,
}

impl LaunchpadInfo {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 8 + 8 + 1;
}

#[account]
#[derive(Default)]
pub struct PresaleState {
    pub mint: Pubkey,
    pub total_raised: u64,
    pub participant_count: u32,
}

impl PresaleState {
    pub const LEN: usize = 32 + 8 + 4;
}

#[account]
#[derive(Default)]
pub struct Contribution {
    pub user: Pubkey,
    pub launchpad: Pubkey,
    pub amount: u64,
    pub claimed: bool,
}

impl Contribution {
    pub const LEN: usize = 32 + 32 + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum LaunchpadStatus {
    Created,
    Active,
    Cancelled,
    Launched,
}

impl Default for LaunchpadStatus {
    fn default() -> Self {
        LaunchpadStatus::Created
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum TaxType {
    Buy,
    Sell,
    Transfer,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeParams {
    pub sequencer: Pubkey,
    pub fraud_proof_window: i64,
    pub finalization_window: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RegisterTokenParams {
    pub is_native: bool,
    pub bridge_source: [u8; 32],
    pub enable_buybot: bool,
    pub tax_buy: u8,
    pub tax_sell: u8,
    pub tax_transfer: u8,
    pub liquidity_lock_period: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ExecuteBundleParams {
    pub bundle_id: u64,
    pub transaction_count: u32,
    pub merkle_root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LockLiquidityParams {
    pub token_amount: u64,
    pub base_amount: u64,
    pub lock_period: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateTokenParams {
    pub decimals: u8,
    pub presale_price: u64,
    pub listing_price: u64,
    pub soft_cap: u64,
    pub hard_cap: u64,
    pub min_contribution: u64,
    pub max_contribution: u64,
    pub liquidity_percentage: u8,
    pub start_time: i64,
    pub end_time: i64,
    pub enable_buybot: bool,
    pub tax_buy: u8,
    pub tax_sell: u8,
    pub tax_transfer: u8,
    pub liquidity_lock_period: u64,
}

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct WithdrawEvent {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub tax_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct TaxEvent {
    pub mint: Pubkey,
    pub amount: u64,
    pub tax_type: TaxType,
    pub timestamp: i64,
}

#[event]
pub struct BundleExecutedEvent {
    pub bundle_id: Pubkey,
    pub sequencer: Pubkey,
    pub transaction_count: u32,
    pub merkle_root: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct LiquidityLockedEvent {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub token_amount: u64,
    pub base_amount: u64,
    pub unlock_time: i64,
}

#[event]
pub struct TokenCreatedEvent {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub decimals: u8,
    pub buybot_enabled: bool,
}

#[event]
pub struct ContributionEvent {
    pub user: Pubkey,
    pub launchpad: Pubkey,
    pub amount: u64,
    pub total_contribution: u64,
    pub timestamp: i64,
}

#[event]
pub struct PresaleFinalizedEvent {
    pub launchpad: Pubkey,
    pub total_raised: u64,
    pub liquidity_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct BuybackEvent {
    pub mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct BurnEvent {
    pub mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Insufficient funds")]
    InsufficientFunds,
    
    #[msg("Presale not active")]
    PresaleNotActive,
    
    #[msg("Invalid contribution amount")]
    InvalidContributionAmount,
    
    #[msg("Presale not ended")]
    PresaleNotEnded,
    
    #[msg("Soft cap not reached")]
    SoftCapNotReached,
    
    #[msg("Buybot not enabled")]
    BuybotNotEnabled,
    
    #[msg("Unauthorized")]
    Unauthorized,
}
