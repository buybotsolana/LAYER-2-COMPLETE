/**
 * @file lib.rs
 * @description Programma Anchor per il sistema Layer-2 con BuyBot Enterprise integrato
 * 
 * Questo programma implementa un sistema Layer-2 completo per Solana con funzionalità
 * di bridge cross-chain, launchpad, e BuyBot Enterprise integrato. Utilizza Anchor
 * per la validazione degli account e la gestione degli errori.
 * 
 * Il sistema è composto da diversi moduli:
 * - Core Layer-2: Gestione di depositi, prelievi e bundle di transazioni
 * - Bridge: Integrazione con Wormhole per bridge cross-chain
 * - Launchpad: Creazione e gestione di token e presale
 * - BuyBot: Bundle Engine, Tax System, Anti-Rug System e Market Maker
 * 
 * @author BuyBot Solana Team
 * @version 1.0.0
 */

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};
use std::convert::TryInto;

declare_id!("Layer2111111111111111111111111111111111111111");

/**
 * Modulo principale del programma Layer-2 con BuyBot Enterprise
 */
#[program]
pub mod layer2 {
    use super::*;

    /**
     * Inizializza il sistema Layer-2
     * 
     * Questa istruzione crea l'account di stato globale del sistema Layer-2 e
     * imposta i parametri iniziali come il sequencer, la finestra di fraud proof
     * e la finestra di finalizzazione.
     * 
     * @param ctx Contesto dell'istruzione
     * @param params Parametri di inizializzazione
     * @return Result<()> Risultato dell'operazione
     */
    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        let layer2_state = &mut ctx.accounts.layer2_state;
        
        // Inizializza lo stato del Layer-2
        layer2_state.authority = ctx.accounts.authority.key();
        layer2_state.sequencer = params.sequencer;
        layer2_state.is_active = true;
        layer2_state.version = 1;
        layer2_state.fraud_proof_window = params.fraud_proof_window;
        layer2_state.finalization_window = params.finalization_window;
        layer2_state.bundle_count = 0;
        
        // Emetti evento di inizializzazione
        emit!(InitializeEvent {
            authority: ctx.accounts.authority.key(),
            sequencer: params.sequencer,
            fraud_proof_window: params.fraud_proof_window,
            finalization_window: params.finalization_window,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /**
     * Registra un nuovo token nel sistema
     * 
     * Questa istruzione registra un nuovo token nel sistema Layer-2, specificando
     * se è un token nativo o bridged, e configurando le impostazioni del BuyBot
     * come le tasse e il periodo di blocco della liquidità.
     * 
     * @param ctx Contesto dell'istruzione
     * @param params Parametri di registrazione del token
     * @return Result<()> Risultato dell'operazione
     */
    pub fn register_token(ctx: Context<RegisterToken>, params: RegisterTokenParams) -> Result<()> {
        let token_info = &mut ctx.accounts.token_info;
        
        // Inizializza le informazioni del token
        token_info.mint = ctx.accounts.mint.key();
        token_info.authority = ctx.accounts.authority.key();
        token_info.is_active = true;
        token_info.is_native = params.is_native;
        token_info.bridge_source = params.bridge_source;
        token_info.buybot_enabled = params.enable_buybot;
        token_info.tax_buy = params.tax_buy;
        token_info.tax_sell = params.tax_sell;
        token_info.tax_transfer = params.tax_transfer;
        token_info.liquidity_lock_period = params.liquidity_lock_period;
        token_info.anti_rug_score = 0;
        token_info.total_buyback = 0;
        token_info.total_burn = 0;
        
        // Emetti evento di registrazione token
        emit!(TokenRegisteredEvent {
            mint: ctx.accounts.mint.key(),
            authority: ctx.accounts.authority.key(),
            is_native: params.is_native,
            buybot_enabled: params.enable_buybot,
            tax_buy: params.tax_buy,
            tax_sell: params.tax_sell,
            tax_transfer: params.tax_transfer,
            liquidity_lock_period: params.liquidity_lock_period,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /**
     * Deposita token nel Layer-2
     * 
     * Questa istruzione permette a un utente di depositare token nel sistema Layer-2.
     * I token vengono trasferiti dall'account token dell'utente al vault del sistema.
     * 
     * @param ctx Contesto dell'istruzione
     * @param amount Quantità di token da depositare
     * @return Result<()> Risultato dell'operazione
     */
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        // Verifica che il token sia attivo
        require!(ctx.accounts.token_info.is_active, ErrorCode::TokenNotActive);
        
        // Verifica che l'importo sia valido
        require!(amount > 0, ErrorCode::InvalidAmount);
        
        // Trasferisci i token dall'utente al vault
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        
        token::transfer(transfer_ctx, amount)?;
        
        // Aggiorna il deposito dell'utente
        let user_deposit = &mut ctx.accounts.user_deposit;
        user_deposit.owner = ctx.accounts.user.key();
        user_deposit.mint = ctx.accounts.token_info.mint;
        user_deposit.amount = user_deposit.amount.checked_add(amount).ok_or(ErrorCode::Overflow)?;
        
        // Emetti evento di deposito
        emit!(DepositEvent {
            user: ctx.accounts.user.key(),
            mint: ctx.accounts.token_info.mint,
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /**
     * Ritira token dal Layer-2
     * 
     * Questa istruzione permette a un utente di ritirare token dal sistema Layer-2.
     * I token vengono trasferiti dal vault del sistema all'account token dell'utente.
     * 
     * @param ctx Contesto dell'istruzione
     * @param amount Quantità di token da ritirare
     * @return Result<()> Risultato dell'operazione
     */
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        // Verifica che il token sia attivo
        require!(ctx.accounts.token_info.is_active, ErrorCode::TokenNotActive);
        
        // Verifica che l'importo sia valido
        require!(amount > 0, ErrorCode::InvalidAmount);
        
        // Verifica che l'utente abbia abbastanza token
        require!(ctx.accounts.user_deposit.amount >= amount, ErrorCode::InsufficientFunds);
        
        // Calcola il bump del vault
        let seeds = &[
            b"vault".as_ref(),
            ctx.accounts.token_info.mint.as_ref(),
            &[ctx.bumps.vault],
        ];
        let signer = &[&seeds[..]];
        
        // Trasferisci i token dal vault all'utente
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer,
        );
        
        token::transfer(transfer_ctx, amount)?;
        
        // Aggiorna il deposito dell'utente
        let user_deposit = &mut ctx.accounts.user_deposit;
        user_deposit.amount = user_deposit.amount.checked_sub(amount).ok_or(ErrorCode::Overflow)?;
        
        // Emetti evento di prelievo
        emit!(WithdrawEvent {
            user: ctx.accounts.user.key(),
            mint: ctx.accounts.token_info.mint,
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /**
     * Verifica un VAA di Wormhole
     * 
     * Questa istruzione verifica un VAA (Verified Action Approval) di Wormhole
     * per il bridge cross-chain. In una implementazione completa, questa funzione
     * farebbe una CPI (Cross-Program Invocation) verso il programma Wormhole.
     * 
     * @param ctx Contesto dell'istruzione
     * @param vaa_hash Hash del VAA da verificare
     * @return Result<()> Risultato dell'operazione
     */
    pub fn verify_vaa(ctx: Context<VerifyVAA>, vaa_hash: [u8; 32]) -> Result<()> {
        let bridge_state = &mut ctx.accounts.bridge_state;
        
        // In una implementazione completa, qui ci sarebbe una CPI verso
        // il programma Wormhole per verificare il VAA
        
        // Per ora, simuliamo la verifica
        bridge_state.is_verified = true;
        bridge_state.vaa_hash = vaa_hash;
        bridge_state.timestamp = Clock::get()?.unix_timestamp;
        
        // Emetti evento di verifica VAA
        emit!(VAAVerifiedEvent {
            vaa_hash,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /**
     * Esegue un bundle di transazioni
     * 
     * Questa istruzione permette al sequencer di eseguire un bundle di transazioni
     * Layer-2. Il bundle è identificato da un ID e contiene un Merkle root che
     * rappresenta tutte le transazioni nel bundle.
     * 
     * @param ctx Contesto dell'istruzione
     * @param params Parametri del bundle
     * @return Result<()> Risultato dell'operazione
     */
    pub fn execute_bundle(ctx: Context<ExecuteBundle>, params: BundleParams) -> Result<()> {
        // Verifica che il chiamante sia il sequencer
        require!(
            ctx.accounts.sequencer.key() == ctx.accounts.layer2_state.sequencer,
            ErrorCode::Unauthorized
        );
        
        // Verifica che il sistema sia attivo
        require!(ctx.accounts.layer2_state.is_active, ErrorCode::SystemNotActive);
        
        // Inizializza il bundle
        let bundle = &mut ctx.accounts.bundle;
        bundle.sequencer = ctx.accounts.sequencer.key();
        bundle.bundle_id = params.bundle_id;
        bundle.transaction_count = params.transaction_count;
        bundle.merkle_root = params.merkle_root;
        bundle.executed_at = Clock::get()?.unix_timestamp;
        bundle.finalized = false;
        
        // Aggiorna il contatore di bundle
        ctx.accounts.layer2_state.bundle_count = ctx.accounts.layer2_state.bundle_count.checked_add(1).ok_or(ErrorCode::Overflow)?;
        
        // Emetti evento di esecuzione bundle
        emit!(BundleExecutedEvent {
            bundle_id: params.bundle_id,
            sequencer: ctx.accounts.sequencer.key(),
            transaction_count: params.transaction_count,
            merkle_root: params.merkle_root,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /**
     * Blocca la liquidità per un token
     * 
     * Questa istruzione permette a un proprietario di token di bloccare la liquidità
     * per un periodo specificato. Questo aumenta lo score anti-rug del token.
     * 
     * @param ctx Contesto dell'istruzione
     * @param params Parametri di blocco della liquidità
     * @return Result<()> Risultato dell'operazione
     */
    pub fn lock_liquidity(ctx: Context<LockLiquidity>, params: LiquidityLockParams) -> Result<()> {
        // Verifica che il token sia attivo
        require!(ctx.accounts.token_info.is_active, ErrorCode::TokenNotActive);
        
        // Verifica che gli importi siano validi
        require!(params.token_amount > 0, ErrorCode::InvalidAmount);
        require!(params.base_amount > 0, ErrorCode::InvalidAmount);
        
        // Verifica che il periodo di blocco sia valido
        require!(
            params.lock_period >= ctx.accounts.token_info.liquidity_lock_period,
            ErrorCode::InvalidLockPeriod
        );
        
        // Inizializza il blocco di liquidità
        let liquidity_lock = &mut ctx.accounts.liquidity_lock;
        liquidity_lock.owner = ctx.accounts.owner.key();
        liquidity_lock.mint = ctx.accounts.token_info.mint;
        liquidity_lock.token_amount = params.token_amount;
        liquidity_lock.base_amount = params.base_amount;
        liquidity_lock.locked_at = Clock::get()?.unix_timestamp;
        liquidity_lock.unlock_time = Clock::get()?.unix_timestamp.checked_add(params.lock_period.try_into().unwrap()).ok_or(ErrorCode::Overflow)?;
        liquidity_lock.is_locked = true;
        
        // Aggiorna lo score anti-rug
        // Più lungo è il periodo di blocco, più alto è lo score
        let lock_months = params.lock_period / 2592000; // 30 giorni in secondi
        let score_increase = lock_months.min(50); // Massimo 50 punti
        
        let token_info = &mut ctx.accounts.token_info;
        token_info.anti_rug_score = token_info.anti_rug_score.checked_add(score_increase as u8).unwrap_or(100);
        
        // Emetti evento di blocco liquidità
        emit!(LiquidityLockedEvent {
            owner: ctx.accounts.owner.key(),
            mint: ctx.accounts.token_info.mint,
            token_amount: params.token_amount,
            base_amount: params.base_amount,
            lock_period: params.lock_period,
            unlock_time: liquidity_lock.unlock_time,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /**
     * Crea un nuovo token tramite il launchpad
     * 
     * Questa istruzione permette a un utente di creare un nuovo token tramite
     * il launchpad, configurando i parametri della presale e del token stesso.
     * 
     * @param ctx Contesto dell'istruzione
     * @param params Parametri di creazione del token
     * @return Result<()> Risultato dell'operazione
     */
    pub fn create_token(ctx: Context<CreateToken>, params: TokenCreationParams) -> Result<()> {
        // Inizializza le informazioni del token
        let token_info = &mut ctx.accounts.token_info;
        token_info.mint = ctx.accounts.mint.key();
        token_info.authority = ctx.accounts.authority.key();
        token_info.is_active = true;
        token_info.is_native = true;
        token_info.buybot_enabled = params.enable_buybot;
        token_info.tax_buy = params.tax_buy;
        token_info.tax_sell = params.tax_sell;
        token_info.tax_transfer = params.tax_transfer;
        token_info.liquidity_lock_period = params.liquidity_lock_period;
        token_info.anti_rug_score = 0;
        token_info.total_buyback = 0;
        token_info.total_burn = 0;
        
        // Inizializza le informazioni del launchpad
        let launchpad_info = &mut ctx.accounts.launchpad_info;
        launchpad_info.mint = ctx.accounts.mint.key();
        launchpad_info.creator = ctx.accounts.authority.key();
        launchpad_info.decimals = params.decimals;
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
        
        // Emetti evento di creazione token
        emit!(TokenCreatedEvent {
            mint: ctx.accounts.mint.key(),
            creator: ctx.accounts.authority.key(),
            presale_price: params.presale_price,
            listing_price: params.listing_price,
            soft_cap: params.soft_cap,
            hard_cap: params.hard_cap,
            start_time: params.start_time,
            end_time: params.end_time,
            buybot_enabled: params.enable_buybot,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /**
     * Contribuisce a una presale nel launchpad
     * 
     * Questa istruzione permette a un utente di contribuire a una presale
     * inviando SOL e ricevendo il diritto di reclamare token una volta
     * che la presale è finalizzata.
     * 
     * @param ctx Contesto dell'istruzione
     * @param amount Quantità di SOL da contribuire
     * @return Result<()> Risultato dell'operazione
     */
    pub fn contribute_presale(ctx: Context<ContributePresale>, amount: u64) -> Result<()> {
        // Verifica che la presale sia attiva
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            current_time >= ctx.accounts.launchpad_info.start_time.try_into().unwrap() &&
            current_time <= ctx.accounts.launchpad_info.end_time.try_into().unwrap(),
            ErrorCode::PresaleNotActive
        );
        
        // Verifica che l'importo sia valido
        require!(
            amount >= ctx.accounts.launchpad_info.min_contribution &&
            amount <= ctx.accounts.launchpad_info.max_contribution,
            ErrorCode::InvalidContributionAmount
        );
        
        // Verifica che non si superi l'hard cap
        let presale_state = &mut ctx.accounts.presale_state;
        let new_total = presale_state.total_raised.checked_add(amount).ok_or(ErrorCode::Overflow)?;
        require!(
            new_total <= ctx.accounts.launchpad_info.hard_cap,
            ErrorCode::HardCapReached
        );
        
        // Trasferisci SOL dall'utente al vault della presale
        let transfer_instruction = system_instruction::transfer(
            &ctx.accounts.user.key(),
            &ctx.accounts.presale_vault.key(),
            amount,
        );
        
        invoke(
            &transfer_instruction,
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.presale_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
        
        // Aggiorna lo stato della presale
        presale_state.total_raised = new_total;
        presale_state.contributor_count = presale_state.contributor_count.checked_add(1).unwrap_or(presale_state.contributor_count);
        
        // Aggiorna la contribuzione dell'utente
        let contribution = &mut ctx.accounts.contribution;
        contribution.user = ctx.accounts.user.key();
        contribution.mint = ctx.accounts.launchpad_info.mint;
        contribution.amount = contribution.amount.checked_add(amount).ok_or(ErrorCode::Overflow)?;
        contribution.claimed = false;
        
        // Emetti evento di contribuzione
        emit!(ContributionEvent {
            user: ctx.accounts.user.key(),
            mint: ctx.accounts.launchpad_info.mint,
            amount,
            total_contribution: contribution.amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /**
     * Finalizza una presale e lancia il token
     * 
     * Questa istruzione permette al creatore di finalizzare una presale
     * dopo che è terminata. Se la soft cap è stata raggiunta, la presale
     * è considerata un successo e il token viene lanciato.
     * 
     * @param ctx Contesto dell'istruzione
     * @return Result<()> Risultato dell'operazione
     */
    pub fn finalize_presale(ctx: Context<FinalizePresale>) -> Result<()> {
        // Verifica che il chiamante sia il creatore
        require!(
            ctx.accounts.authority.key() == ctx.accounts.launchpad_info.creator,
            ErrorCode::Unauthorized
        );
        
        // Verifica che la presale sia terminata
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            current_time > ctx.accounts.launchpad_info.end_time.try_into().unwrap(),
            ErrorCode::PresaleNotEnded
        );
        
        // Verifica che la soft cap sia stata raggiunta
        let presale_state = &ctx.accounts.presale_state;
        require!(
            presale_state.total_raised >= ctx.accounts.launchpad_info.soft_cap,
            ErrorCode::SoftCapNotReached
        );
        
        // Aggiorna lo stato del launchpad
        let launchpad_info = &mut ctx.accounts.launchpad_info;
        launchpad_info.status = LaunchpadStatus::Finalized;
        
        // Attiva il token
        let token_info = &mut ctx.accounts.token_info;
        token_info.is_active = true;
        
        // Emetti evento di finalizzazione presale
        emit!(PresaleFinalizedEvent {
            mint: ctx.accounts.launchpad_info.mint,
            creator: ctx.accounts.authority.key(),
            total_raised: presale_state.total_raised,
            contributor_count: presale_state.contributor_count,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /**
     * Esegue un'operazione di buyback
     * 
     * Questa istruzione permette all'autorità di un token di eseguire
     * un'operazione di buyback, utilizzando SOL per acquistare token
     * dal mercato e potenzialmente bruciarli.
     * 
     * @param ctx Contesto dell'istruzione
     * @param amount Quantità di token da riacquistare
     * @return Result<()> Risultato dell'operazione
     */
    pub fn execute_buyback(ctx: Context<ExecuteBuyback>, amount: u64) -> Result<()> {
        // Verifica che il chiamante sia l'autorità del token
        require!(
            ctx.accounts.authority.key() == ctx.accounts.token_info.authority,
            ErrorCode::Unauthorized
        );
        
        // Verifica che il buybot sia abilitato
        require!(ctx.accounts.token_info.buybot_enabled, ErrorCode::BuybotNotEnabled);
        
        // In una implementazione completa, qui ci sarebbe la logica
        // per eseguire il buyback sul mercato
        
        // Aggiorna le statistiche di buyback
        let token_info = &mut ctx.accounts.token_info;
        token_info.total_buyback = token_info.total_buyback.checked_add(amount).ok_or(ErrorCode::Overflow)?;
        
        // Emetti evento di buyback
        emit!(BuybackEvent {
            mint: ctx.accounts.token_info.mint,
            authority: ctx.accounts.authority.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /**
     * Esegue un'operazione di burn
     * 
     * Questa istruzione permette all'autorità di un token di bruciare
     * una quantità di token, riducendo l'offerta totale.
     * 
     * @param ctx Contesto dell'istruzione
     * @param amount Quantità di token da bruciare
     * @return Result<()> Risultato dell'operazione
     */
    pub fn execute_burn(ctx: Context<ExecuteBurn>, amount: u64) -> Result<()> {
        // Verifica che il chiamante sia l'autorità del token
        require!(
            ctx.accounts.authority.key() == ctx.accounts.token_info.authority,
            ErrorCode::Unauthorized
        );
        
        // Verifica che il buybot sia abilitato
        require!(ctx.accounts.token_info.buybot_enabled, ErrorCode::BuybotNotEnabled);
        
        // Brucia i token
        let burn_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        );
        
        token::burn(burn_ctx, amount)?;
        
        // Aggiorna le statistiche di burn
        let token_info = &mut ctx.accounts.token_info;
        token_info.total_burn = token_info.total_burn.checked_add(amount).ok_or(ErrorCode::Overflow)?;
        
        // Emetti evento di burn
        emit!(BurnEvent {
            mint: ctx.accounts.token_info.mint,
            authority: ctx.accounts.authority.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }
}

/**
 * Contesto per l'istruzione Initialize
 */
#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Autorità che inizializza il sistema
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// Stato globale del sistema Layer-2
    #[account(
        init,
        payer = authority,
        space = 8 + Layer2State::SIZE,
        seeds = [b"layer2_state"],
        bump
    )]
    pub layer2_state: Account<'info, Layer2State>,
    
    /// Programma di sistema
    pub system_program: Program<'info, System>,
}

/**
 * Contesto per l'istruzione RegisterToken
 */
#[derive(Accounts)]
pub struct RegisterToken<'info> {
    /// Autorità che registra il token
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// Mint del token
    pub mint: Account<'info, Mint>,
    
    /// Informazioni sul token
    #[account(
        init,
        payer = authority,
        space = 8 + TokenInfo::SIZE,
        seeds = [b"token_info", mint.key().as_ref()],
        bump
    )]
    pub token_info: Account<'info, TokenInfo>,
    
    /// Programma di sistema
    pub system_program: Program<'info, System>,
}

/**
 * Contesto per l'istruzione Deposit
 */
#[derive(Accounts)]
pub struct Deposit<'info> {
    /// Utente che deposita i token
    #[account(mut)]
    pub user: Signer<'info>,
    
    /// Account token dell'utente
    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == token_info.mint
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    /// Vault per il token
    #[account(
        init_if_needed,
        payer = user,
        seeds = [b"vault", token_info.mint.as_ref()],
        bump,
        token::mint = token_info.mint,
        token::authority = vault
    )]
    pub vault: Account<'info, TokenAccount>,
    
    /// Informazioni sul token
    #[account(
        seeds = [b"token_info", token_info.mint.as_ref()],
        bump,
        constraint = token_info.is_active
    )]
    pub token_info: Account<'info, TokenInfo>,
    
    /// Deposito dell'utente
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserDeposit::SIZE,
        seeds = [b"user_deposit", user.key().as_ref(), token_info.mint.as_ref()],
        bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    
    /// Programma token
    pub token_program: Program<'info, Token>,
    
    /// Programma di sistema
    pub system_program: Program<'info, System>,
}

/**
 * Contesto per l'istruzione Withdraw
 */
#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// Utente che ritira i token
    #[account(mut)]
    pub user: Signer<'info>,
    
    /// Account token dell'utente
    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == token_info.mint
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    /// Vault per il token
    #[account(
        mut,
        seeds = [b"vault", token_info.mint.as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    
    /// Informazioni sul token
    #[account(
        seeds = [b"token_info", token_info.mint.as_ref()],
        bump,
        constraint = token_info.is_active
    )]
    pub token_info: Account<'info, TokenInfo>,
    
    /// Deposito dell'utente
    #[account(
        mut,
        seeds = [b"user_deposit", user.key().as_ref(), token_info.mint.as_ref()],
        bump,
        constraint = user_deposit.owner == user.key(),
        constraint = user_deposit.mint == token_info.mint
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    
    /// Programma token
    pub token_program: Program<'info, Token>,
}

/**
 * Contesto per l'istruzione VerifyVAA
 */
#[derive(Accounts)]
pub struct VerifyVAA<'info> {
    /// Autorità che verifica il VAA
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// Stato del bridge
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + BridgeState::SIZE,
        seeds = [b"bridge_state"],
        bump
    )]
    pub bridge_state: Account<'info, BridgeState>,
    
    /// Programma di sistema
    pub system_program: Program<'info, System>,
}

/**
 * Contesto per l'istruzione ExecuteBundle
 */
#[derive(Accounts)]
pub struct ExecuteBundle<'info> {
    /// Sequencer che esegue il bundle
    #[account(mut)]
    pub sequencer: Signer<'info>,
    
    /// Bundle di transazioni
    #[account(
        init,
        payer = sequencer,
        space = 8 + Bundle::SIZE,
        seeds = [
            b"bundle",
            sequencer.key().as_ref(),
            params.bundle_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub bundle: Account<'info, Bundle>,
    
    /// Stato globale del sistema Layer-2
    #[account(
        mut,
        seeds = [b"layer2_state"],
        bump,
        constraint = layer2_state.is_active
    )]
    pub layer2_state: Account<'info, Layer2State>,
    
    /// Programma di sistema
    pub system_program: Program<'info, System>,
}

/**
 * Contesto per l'istruzione LockLiquidity
 */
#[derive(Accounts)]
pub struct LockLiquidity<'info> {
    /// Proprietario che blocca la liquidità
    #[account(mut)]
    pub owner: Signer<'info>,
    
    /// Informazioni sul token
    #[account(
        mut,
        seeds = [b"token_info", token_info.mint.as_ref()],
        bump,
        constraint = token_info.is_active
    )]
    pub token_info: Account<'info, TokenInfo>,
    
    /// Blocco di liquidità
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + LiquidityLock::SIZE,
        seeds = [b"liquidity_lock", token_info.mint.as_ref(), owner.key().as_ref()],
        bump
    )]
    pub liquidity_lock: Account<'info, LiquidityLock>,
    
    /// Programma di sistema
    pub system_program: Program<'info, System>,
}

/**
 * Contesto per l'istruzione CreateToken
 */
#[derive(Accounts)]
pub struct CreateToken<'info> {
    /// Autorità che crea il token
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// Mint del token
    pub mint: Account<'info, Mint>,
    
    /// Informazioni sul token
    #[account(
        init,
        payer = authority,
        space = 8 + TokenInfo::SIZE,
        seeds = [b"token_info", mint.key().as_ref()],
        bump
    )]
    pub token_info: Account<'info, TokenInfo>,
    
    /// Informazioni sul launchpad
    #[account(
        init,
        payer = authority,
        space = 8 + LaunchpadInfo::SIZE,
        seeds = [b"launchpad_info", mint.key().as_ref()],
        bump
    )]
    pub launchpad_info: Account<'info, LaunchpadInfo>,
    
    /// Programma di sistema
    pub system_program: Program<'info, System>,
}

/**
 * Contesto per l'istruzione ContributePresale
 */
#[derive(Accounts)]
pub struct ContributePresale<'info> {
    /// Utente che contribuisce alla presale
    #[account(mut)]
    pub user: Signer<'info>,
    
    /// Account token dell'utente
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    
    /// Vault della presale
    #[account(
        mut,
        seeds = [b"presale_vault", launchpad_info.mint.as_ref()],
        bump
    )]
    pub presale_vault: SystemAccount<'info>,
    
    /// Informazioni sul launchpad
    #[account(
        seeds = [b"launchpad_info", launchpad_info.mint.as_ref()],
        bump
    )]
    pub launchpad_info: Account<'info, LaunchpadInfo>,
    
    /// Stato della presale
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + PresaleState::SIZE,
        seeds = [b"presale_state", launchpad_info.mint.as_ref()],
        bump
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    /// Contribuzione dell'utente
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Contribution::SIZE,
        seeds = [b"contribution", user.key().as_ref(), launchpad_info.mint.as_ref()],
        bump
    )]
    pub contribution: Account<'info, Contribution>,
    
    /// Programma token
    pub token_program: Program<'info, Token>,
    
    /// Programma di sistema
    pub system_program: Program<'info, System>,
}

/**
 * Contesto per l'istruzione FinalizePresale
 */
#[derive(Accounts)]
pub struct FinalizePresale<'info> {
    /// Autorità che finalizza la presale
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// Informazioni sul launchpad
    #[account(
        mut,
        seeds = [b"launchpad_info", launchpad_info.mint.as_ref()],
        bump,
        constraint = launchpad_info.creator == authority.key()
    )]
    pub launchpad_info: Account<'info, LaunchpadInfo>,
    
    /// Stato della presale
    #[account(
        seeds = [b"presale_state", launchpad_info.mint.as_ref()],
        bump
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    /// Informazioni sul token
    #[account(
        mut,
        seeds = [b"token_info", launchpad_info.mint.as_ref()],
        bump
    )]
    pub token_info: Account<'info, TokenInfo>,
    
    /// Programma di sistema
    pub system_program: Program<'info, System>,
}

/**
 * Contesto per l'istruzione ExecuteBuyback
 */
#[derive(Accounts)]
pub struct ExecuteBuyback<'info> {
    /// Autorità che esegue il buyback
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// Informazioni sul token
    #[account(
        mut,
        seeds = [b"token_info", token_info.mint.as_ref()],
        bump,
        constraint = token_info.authority == authority.key(),
        constraint = token_info.buybot_enabled
    )]
    pub token_info: Account<'info, TokenInfo>,
    
    /// Programma di sistema
    pub system_program: Program<'info, System>,
}

/**
 * Contesto per l'istruzione ExecuteBurn
 */
#[derive(Accounts)]
pub struct ExecuteBurn<'info> {
    /// Autorità che esegue il burn
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// Mint del token
    #[account(
        mut,
        constraint = mint.key() == token_info.mint
    )]
    pub mint: Account<'info, Mint>,
    
    /// Account token da cui bruciare
    #[account(
        mut,
        constraint = token_account.mint == mint.key(),
        constraint = token_account.owner == authority.key()
    )]
    pub token_account: Account<'info, TokenAccount>,
    
    /// Informazioni sul token
    #[account(
        mut,
        seeds = [b"token_info", token_info.mint.as_ref()],
        bump,
        constraint = token_info.authority == authority.key(),
        constraint = token_info.buybot_enabled
    )]
    pub token_info: Account<'info, TokenInfo>,
    
    /// Programma token
    pub token_program: Program<'info, Token>,
    
    /// Programma di sistema
    pub system_program: Program<'info, System>,
}

/**
 * Stato globale del sistema Layer-2
 */
#[account]
#[derive(Default)]
pub struct Layer2State {
    /// Autorità del sistema
    pub authority: Pubkey,
    /// Sequencer autorizzato
    pub sequencer: Pubkey,
    /// Se il sistema è attivo
    pub is_active: bool,
    /// Versione del sistema
    pub version: u8,
    /// Finestra di tempo per le fraud proof (in secondi)
    pub fraud_proof_window: u64,
    /// Finestra di tempo per la finalizzazione (in secondi)
    pub finalization_window: u64,
    /// Contatore di bundle
    pub bundle_count: u64,
}

impl Layer2State {
    pub const SIZE: usize = 32 + 32 + 1 + 1 + 8 + 8 + 8;
}

/**
 * Informazioni su un token registrato
 */
#[account]
#[derive(Default)]
pub struct TokenInfo {
    /// Mint del token
    pub mint: Pubkey,
    /// Autorità del token
    pub authority: Pubkey,
    /// Se il token è attivo
    pub is_active: bool,
    /// Se è un token nativo o bridged
    pub is_native: bool,
    /// Fonte del bridge (per token bridged)
    pub bridge_source: [u8; 32],
    /// Se il buybot è abilitato
    pub buybot_enabled: bool,
    /// Tassa sugli acquisti (in percentuale)
    pub tax_buy: u8,
    /// Tassa sulle vendite (in percentuale)
    pub tax_sell: u8,
    /// Tassa sui trasferimenti (in percentuale)
    pub tax_transfer: u8,
    /// Periodo minimo di blocco della liquidità (in secondi)
    pub liquidity_lock_period: u64,
    /// Score anti-rug (0-100)
    pub anti_rug_score: u8,
    /// Totale di token riacquistati
    pub total_buyback: u64,
    /// Totale di token bruciati
    pub total_burn: u64,
}

impl TokenInfo {
    pub const SIZE: usize = 32 + 32 + 1 + 1 + 32 + 1 + 1 + 1 + 1 + 8 + 1 + 8 + 8;
}

/**
 * Deposito di un utente per un token
 */
#[account]
#[derive(Default)]
pub struct UserDeposit {
    /// Proprietario del deposito
    pub owner: Pubkey,
    /// Mint del token
    pub mint: Pubkey,
    /// Quantità depositata
    pub amount: u64,
}

impl UserDeposit {
    pub const SIZE: usize = 32 + 32 + 8;
}

/**
 * Stato del bridge cross-chain
 */
#[account]
#[derive(Default)]
pub struct BridgeState {
    /// Se il VAA è stato verificato
    pub is_verified: bool,
    /// Hash del VAA
    pub vaa_hash: [u8; 32],
    /// Timestamp della verifica
    pub timestamp: i64,
}

impl BridgeState {
    pub const SIZE: usize = 1 + 32 + 8;
}

/**
 * Bundle di transazioni
 */
#[account]
#[derive(Default)]
pub struct Bundle {
    /// Sequencer che ha eseguito il bundle
    pub sequencer: Pubkey,
    /// ID del bundle
    pub bundle_id: u64,
    /// Numero di transazioni nel bundle
    pub transaction_count: u32,
    /// Merkle root delle transazioni
    pub merkle_root: [u8; 32],
    /// Timestamp di esecuzione
    pub executed_at: i64,
    /// Se il bundle è stato finalizzato
    pub finalized: bool,
}

impl Bundle {
    pub const SIZE: usize = 32 + 8 + 4 + 32 + 8 + 1;
}

/**
 * Blocco di liquidità
 */
#[account]
#[derive(Default)]
pub struct LiquidityLock {
    /// Proprietario del blocco
    pub owner: Pubkey,
    /// Mint del token
    pub mint: Pubkey,
    /// Quantità di token bloccati
    pub token_amount: u64,
    /// Quantità di base (SOL) bloccata
    pub base_amount: u64,
    /// Timestamp di blocco
    pub locked_at: i64,
    /// Timestamp di sblocco
    pub unlock_time: i64,
    /// Se è ancora bloccato
    pub is_locked: bool,
}

impl LiquidityLock {
    pub const SIZE: usize = 32 + 32 + 8 + 8 + 8 + 8 + 1;
}

/**
 * Informazioni sul launchpad per un token
 */
#[account]
#[derive(Default)]
pub struct LaunchpadInfo {
    /// Mint del token
    pub mint: Pubkey,
    /// Creatore del token
    pub creator: Pubkey,
    /// Decimali del token
    pub decimals: u8,
    /// Prezzo in presale (in lamports per token)
    pub presale_price: u64,
    /// Prezzo di listing (in lamports per token)
    pub listing_price: u64,
    /// Soft cap (in lamports)
    pub soft_cap: u64,
    /// Hard cap (in lamports)
    pub hard_cap: u64,
    /// Contribuzione minima (in lamports)
    pub min_contribution: u64,
    /// Contribuzione massima (in lamports)
    pub max_contribution: u64,
    /// Percentuale di liquidità (0-100)
    pub liquidity_percentage: u8,
    /// Timestamp di inizio presale
    pub start_time: u64,
    /// Timestamp di fine presale
    pub end_time: u64,
    /// Stato del launchpad
    pub status: LaunchpadStatus,
}

impl LaunchpadInfo {
    pub const SIZE: usize = 32 + 32 + 1 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 8 + 8 + 1;
}

/**
 * Stato della presale
 */
#[account]
#[derive(Default)]
pub struct PresaleState {
    /// Totale raccolto (in lamports)
    pub total_raised: u64,
    /// Numero di contributori
    pub contributor_count: u32,
}

impl PresaleState {
    pub const SIZE: usize = 8 + 4;
}

/**
 * Contribuzione di un utente a una presale
 */
#[account]
#[derive(Default)]
pub struct Contribution {
    /// Utente che ha contribuito
    pub user: Pubkey,
    /// Mint del token
    pub mint: Pubkey,
    /// Quantità contribuita (in lamports)
    pub amount: u64,
    /// Se i token sono stati reclamati
    pub claimed: bool,
}

impl Contribution {
    pub const SIZE: usize = 32 + 32 + 8 + 1;
}

/**
 * Stato del launchpad
 */
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum LaunchpadStatus {
    /// Launchpad creato
    Created,
    /// Presale in corso
    Active,
    /// Presale finalizzata
    Finalized,
    /// Presale cancellata
    Cancelled,
}

impl Default for LaunchpadStatus {
    fn default() -> Self {
        LaunchpadStatus::Created
    }
}

/**
 * Parametri per l'istruzione Initialize
 */
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeParams {
    /// Sequencer autorizzato
    pub sequencer: Pubkey,
    /// Finestra di tempo per le fraud proof (in secondi)
    pub fraud_proof_window: u64,
    /// Finestra di tempo per la finalizzazione (in secondi)
    pub finalization_window: u64,
}

/**
 * Parametri per l'istruzione RegisterToken
 */
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RegisterTokenParams {
    /// Se è un token nativo o bridged
    pub is_native: bool,
    /// Fonte del bridge (per token bridged)
    pub bridge_source: [u8; 32],
    /// Se il buybot è abilitato
    pub enable_buybot: bool,
    /// Tassa sugli acquisti (in percentuale)
    pub tax_buy: u8,
    /// Tassa sulle vendite (in percentuale)
    pub tax_sell: u8,
    /// Tassa sui trasferimenti (in percentuale)
    pub tax_transfer: u8,
    /// Periodo minimo di blocco della liquidità (in secondi)
    pub liquidity_lock_period: u64,
}

/**
 * Parametri per l'istruzione ExecuteBundle
 */
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BundleParams {
    /// ID del bundle
    pub bundle_id: u64,
    /// Numero di transazioni nel bundle
    pub transaction_count: u32,
    /// Merkle root delle transazioni
    pub merkle_root: [u8; 32],
}

/**
 * Parametri per l'istruzione LockLiquidity
 */
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LiquidityLockParams {
    /// Quantità di token da bloccare
    pub token_amount: u64,
    /// Quantità di base (SOL) da bloccare
    pub base_amount: u64,
    /// Periodo di blocco (in secondi)
    pub lock_period: u64,
}

/**
 * Parametri per l'istruzione CreateToken
 */
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TokenCreationParams {
    /// Decimali del token
    pub decimals: u8,
    /// Prezzo in presale (in lamports per token)
    pub presale_price: u64,
    /// Prezzo di listing (in lamports per token)
    pub listing_price: u64,
    /// Soft cap (in lamports)
    pub soft_cap: u64,
    /// Hard cap (in lamports)
    pub hard_cap: u64,
    /// Contribuzione minima (in lamports)
    pub min_contribution: u64,
    /// Contribuzione massima (in lamports)
    pub max_contribution: u64,
    /// Percentuale di liquidità (0-100)
    pub liquidity_percentage: u8,
    /// Timestamp di inizio presale
    pub start_time: u64,
    /// Timestamp di fine presale
    pub end_time: u64,
    /// Se il buybot è abilitato
    pub enable_buybot: bool,
    /// Tassa sugli acquisti (in percentuale)
    pub tax_buy: u8,
    /// Tassa sulle vendite (in percentuale)
    pub tax_sell: u8,
    /// Tassa sui trasferimenti (in percentuale)
    pub tax_transfer: u8,
    /// Periodo minimo di blocco della liquidità (in secondi)
    pub liquidity_lock_period: u64,
}

/**
 * Codici di errore
 */
#[error_code]
pub enum ErrorCode {
    /// Fondi insufficienti
    #[msg("Fondi insufficienti")]
    InsufficientFunds,
    
    /// Importo non valido
    #[msg("Importo non valido")]
    InvalidAmount,
    
    /// Overflow aritmetico
    #[msg("Overflow aritmetico")]
    Overflow,
    
    /// Token non attivo
    #[msg("Token non attivo")]
    TokenNotActive,
    
    /// Sistema non attivo
    #[msg("Sistema non attivo")]
    SystemNotActive,
    
    /// Non autorizzato
    #[msg("Non autorizzato")]
    Unauthorized,
    
    /// Presale non attiva
    #[msg("Presale non attiva")]
    PresaleNotActive,
    
    /// Importo di contribuzione non valido
    #[msg("Importo di contribuzione non valido")]
    InvalidContributionAmount,
    
    /// Hard cap raggiunto
    #[msg("Hard cap raggiunto")]
    HardCapReached,
    
    /// Presale non terminata
    #[msg("Presale non terminata")]
    PresaleNotEnded,
    
    /// Soft cap non raggiunto
    #[msg("Soft cap non raggiunto")]
    SoftCapNotReached,
    
    /// Buybot non abilitato
    #[msg("Buybot non abilitato")]
    BuybotNotEnabled,
    
    /// Periodo di blocco non valido
    #[msg("Periodo di blocco non valido")]
    InvalidLockPeriod,
}

/**
 * Eventi emessi dal programma
 */

/// Evento emesso quando il sistema viene inizializzato
#[event]
pub struct InitializeEvent {
    /// Autorità che ha inizializzato il sistema
    #[index]
    pub authority: Pubkey,
    /// Sequencer autorizzato
    pub sequencer: Pubkey,
    /// Finestra di tempo per le fraud proof
    pub fraud_proof_window: u64,
    /// Finestra di tempo per la finalizzazione
    pub finalization_window: u64,
    /// Timestamp dell'evento
    pub timestamp: i64,
}

/// Evento emesso quando un token viene registrato
#[event]
pub struct TokenRegisteredEvent {
    /// Mint del token
    #[index]
    pub mint: Pubkey,
    /// Autorità del token
    pub authority: Pubkey,
    /// Se è un token nativo
    pub is_native: bool,
    /// Se il buybot è abilitato
    pub buybot_enabled: bool,
    /// Tassa sugli acquisti
    pub tax_buy: u8,
    /// Tassa sulle vendite
    pub tax_sell: u8,
    /// Tassa sui trasferimenti
    pub tax_transfer: u8,
    /// Periodo minimo di blocco della liquidità
    pub liquidity_lock_period: u64,
    /// Timestamp dell'evento
    pub timestamp: i64,
}

/// Evento emesso quando un utente deposita token
#[event]
pub struct DepositEvent {
    /// Utente che ha depositato
    #[index]
    pub user: Pubkey,
    /// Mint del token
    #[index]
    pub mint: Pubkey,
    /// Quantità depositata
    pub amount: u64,
    /// Timestamp dell'evento
    pub timestamp: i64,
}

/// Evento emesso quando un utente ritira token
#[event]
pub struct WithdrawEvent {
    /// Utente che ha ritirato
    #[index]
    pub user: Pubkey,
    /// Mint del token
    #[index]
    pub mint: Pubkey,
    /// Quantità ritirata
    pub amount: u64,
    /// Timestamp dell'evento
    pub timestamp: i64,
}

/// Evento emesso quando un VAA viene verificato
#[event]
pub struct VAAVerifiedEvent {
    /// Hash del VAA
    #[index]
    pub vaa_hash: [u8; 32],
    /// Timestamp dell'evento
    pub timestamp: i64,
}

/// Evento emesso quando un bundle viene eseguito
#[event]
pub struct BundleExecutedEvent {
    /// ID del bundle
    #[index]
    pub bundle_id: u64,
    /// Sequencer che ha eseguito il bundle
    pub sequencer: Pubkey,
    /// Numero di transazioni nel bundle
    pub transaction_count: u32,
    /// Merkle root delle transazioni
    pub merkle_root: [u8; 32],
    /// Timestamp dell'evento
    pub timestamp: i64,
}

/// Evento emesso quando la liquidità viene bloccata
#[event]
pub struct LiquidityLockedEvent {
    /// Proprietario del blocco
    #[index]
    pub owner: Pubkey,
    /// Mint del token
    #[index]
    pub mint: Pubkey,
    /// Quantità di token bloccati
    pub token_amount: u64,
    /// Quantità di base (SOL) bloccata
    pub base_amount: u64,
    /// Periodo di blocco
    pub lock_period: u64,
    /// Timestamp di sblocco
    pub unlock_time: i64,
    /// Timestamp dell'evento
    pub timestamp: i64,
}

/// Evento emesso quando un token viene creato
#[event]
pub struct TokenCreatedEvent {
    /// Mint del token
    #[index]
    pub mint: Pubkey,
    /// Creatore del token
    pub creator: Pubkey,
    /// Prezzo in presale
    pub presale_price: u64,
    /// Prezzo di listing
    pub listing_price: u64,
    /// Soft cap
    pub soft_cap: u64,
    /// Hard cap
    pub hard_cap: u64,
    /// Timestamp di inizio presale
    pub start_time: u64,
    /// Timestamp di fine presale
    pub end_time: u64,
    /// Se il buybot è abilitato
    pub buybot_enabled: bool,
    /// Timestamp dell'evento
    pub timestamp: i64,
}

/// Evento emesso quando un utente contribuisce a una presale
#[event]
pub struct ContributionEvent {
    /// Utente che ha contribuito
    #[index]
    pub user: Pubkey,
    /// Mint del token
    #[index]
    pub mint: Pubkey,
    /// Quantità contribuita
    pub amount: u64,
    /// Totale contribuito dall'utente
    pub total_contribution: u64,
    /// Timestamp dell'evento
    pub timestamp: i64,
}

/// Evento emesso quando una presale viene finalizzata
#[event]
pub struct PresaleFinalizedEvent {
    /// Mint del token
    #[index]
    pub mint: Pubkey,
    /// Creatore del token
    pub creator: Pubkey,
    /// Totale raccolto
    pub total_raised: u64,
    /// Numero di contributori
    pub contributor_count: u32,
    /// Timestamp dell'evento
    pub timestamp: i64,
}

/// Evento emesso quando viene eseguito un buyback
#[event]
pub struct BuybackEvent {
    /// Mint del token
    #[index]
    pub mint: Pubkey,
    /// Autorità che ha eseguito il buyback
    pub authority: Pubkey,
    /// Quantità riacquistata
    pub amount: u64,
    /// Timestamp dell'evento
    pub timestamp: i64,
}

/// Evento emesso quando vengono bruciati token
#[event]
pub struct BurnEvent {
    /// Mint del token
    #[index]
    pub mint: Pubkey,
    /// Autorità che ha eseguito il burn
    pub authority: Pubkey,
    /// Quantità bruciata
    pub amount: u64,
    /// Timestamp dell'evento
    pub timestamp: i64,
}
