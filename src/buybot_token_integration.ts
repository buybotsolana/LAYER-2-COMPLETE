import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { BundleEngine } from './bundle_engine';
import { TaxSystem } from './tax_system';
import { AntiRugSystem } from './anti_rug_system';
import { MarketMaker } from './market_maker';
import { Launchpad } from './launchpad';
import { Logger } from './utils/logger';

/**
 * Configurazione dell'integrazione Buybot-Token
 */
export interface BuybotTokenIntegrationConfig {
  solanaRpcUrl: string;
  operatorKeypair: Keypair;
  tokenAddress: string;
  tokenProgramId: string;
  launchpadAddress?: string;
}

/**
 * Integrazione tra il Buybot e il Token Contract
 * 
 * Questa classe gestisce l'integrazione tra il buybot e il token contract,
 * permettendo al buybot di interagire direttamente con il token per supportare
 * il prezzo durante e dopo il lancio.
 */
export class BuybotTokenIntegration {
  private connection: Connection;
  private operatorKeypair: Keypair;
  private logger: Logger;
  
  private tokenAddress: PublicKey;
  private tokenProgramId: PublicKey;
  private launchpadAddress?: PublicKey;
  
  private bundleEngine: BundleEngine;
  private taxSystem: TaxSystem;
  private antiRugSystem: AntiRugSystem;
  private marketMaker: MarketMaker;
  private launchpad?: Launchpad;
  
  /**
   * Costruttore
   * 
   * @param config - Configurazione dell'integrazione
   */
  constructor(config: BuybotTokenIntegrationConfig) {
    this.connection = new Connection(config.solanaRpcUrl);
    this.operatorKeypair = config.operatorKeypair;
    this.logger = new Logger({ module: 'BuybotTokenIntegration' });
    
    this.tokenAddress = new PublicKey(config.tokenAddress);
    this.tokenProgramId = new PublicKey(config.tokenProgramId);
    
    if (config.launchpadAddress) {
      this.launchpadAddress = new PublicKey(config.launchpadAddress);
    }
    
    // Inizializza i componenti del buybot
    this.initializeBuybotComponents();
  }
  
  /**
   * Inizializza i componenti del buybot
   * 
   * @private
   */
  private initializeBuybotComponents(): void {
    this.logger.info('Inizializzazione dei componenti del buybot');
    
    // Inizializza Bundle Engine
    this.bundleEngine = new BundleEngine({
      solanaRpcUrl: this.connection.rpcEndpoint,
      operatorKeypair: this.operatorKeypair,
      maxTransactionsPerBundle: 50
    });
    
    // Inizializza Tax System
    this.taxSystem = new TaxSystem({
      solanaRpcUrl: this.connection.rpcEndpoint,
      operatorKeypair: this.operatorKeypair,
      buyTaxPercentage: 0.05,
      sellTaxPercentage: 0.10,
      transferTaxPercentage: 0.02,
      taxDistribution: {
        liquidity: 0.3,
        marketing: 0.2,
        development: 0.2,
        burn: 0.15,
        buyback: 0.15
      }
    });
    
    // Inizializza Anti-Rug System
    this.antiRugSystem = new AntiRugSystem({
      solanaRpcUrl: this.connection.rpcEndpoint,
      operatorKeypair: this.operatorKeypair
    });
    
    // Inizializza Market Maker
    this.marketMaker = new MarketMaker({
      solanaRpcUrl: this.connection.rpcEndpoint,
      operatorKeypair: this.operatorKeypair
    });
    
    // Inizializza Launchpad se è stato fornito un indirizzo
    if (this.launchpadAddress) {
      this.launchpad = new Launchpad({
        solanaRpcUrl: this.connection.rpcEndpoint,
        operatorKeypair: this.operatorKeypair
      });
    }
    
    this.logger.info('Componenti del buybot inizializzati con successo');
  }
  
  /**
   * Collega il buybot al token contract
   * 
   * @returns Promise che risolve quando il collegamento è completato
   */
  async connectToToken(): Promise<void> {
    try {
      this.logger.info('Collegamento al token contract', {
        tokenAddress: this.tokenAddress.toString()
      });
      
      // In una implementazione reale, qui creeremmo una connessione al token contract
      // e registreremmo i listener per gli eventi
      
      // Registra il Bundle Engine come gestore autorizzato per il token
      await this.registerBundleEngine();
      
      // Registra il Tax System come gestore autorizzato per il token
      await this.registerTaxSystem();
      
      // Registra l'Anti-Rug System come gestore autorizzato per il token
      await this.registerAntiRugSystem();
      
      // Registra il Market Maker come gestore autorizzato per il token
      await this.registerMarketMaker();
      
      // Se c'è un launchpad, registralo come gestore autorizzato per il token
      if (this.launchpad) {
        await this.registerLaunchpad();
      }
      
      this.logger.info('Collegamento al token contract completato con successo');
    } catch (error) {
      this.logger.error('Errore durante il collegamento al token contract', { error });
      throw new Error(`Errore durante il collegamento al token contract: ${error.message}`);
    }
  }
  
  /**
   * Registra il Bundle Engine come gestore autorizzato per il token
   * 
   * @private
   */
  private async registerBundleEngine(): Promise<void> {
    try {
      this.logger.info('Registrazione del Bundle Engine');
      
      // In una implementazione reale, qui registreremmo il Bundle Engine
      // come gestore autorizzato per il token
      
      // Configura il Bundle Engine per il token
      await this.configureBundleEngineForToken();
      
      this.logger.info('Bundle Engine registrato con successo');
    } catch (error) {
      this.logger.error('Errore durante la registrazione del Bundle Engine', { error });
      throw new Error(`Errore durante la registrazione del Bundle Engine: ${error.message}`);
    }
  }
  
  /**
   * Configura il Bundle Engine per il token
   * 
   * @private
   */
  private async configureBundleEngineForToken(): Promise<void> {
    try {
      this.logger.info('Configurazione del Bundle Engine per il token');
      
      // Configura il Bundle Engine per ottimizzare le transazioni del token
      await this.bundleEngine.updateConfig({
        maxTransactionsPerBundle: 50,
        timeoutSeconds: 60,
        priorityFee: 10
      });
      
      // Configura la prioritizzazione delle transazioni
      // Le transazioni di acquisto hanno priorità più alta delle vendite
      await this.bundleEngine.setPrioritizationRules([
        {
          type: 'buy',
          priority: 80
        },
        {
          type: 'sell',
          priority: 60
        },
        {
          type: 'transfer',
          priority: 40
        }
      ]);
      
      this.logger.info('Bundle Engine configurato con successo per il token');
    } catch (error) {
      this.logger.error('Errore durante la configurazione del Bundle Engine per il token', { error });
      throw new Error(`Errore durante la configurazione del Bundle Engine per il token: ${error.message}`);
    }
  }
  
  /**
   * Registra il Tax System come gestore autorizzato per il token
   * 
   * @private
   */
  private async registerTaxSystem(): Promise<void> {
    try {
      this.logger.info('Registrazione del Tax System');
      
      // In una implementazione reale, qui registreremmo il Tax System
      // come gestore autorizzato per il token
      
      // Configura il Tax System per il token
      await this.configureTaxSystemForToken();
      
      this.logger.info('Tax System registrato con successo');
    } catch (error) {
      this.logger.error('Errore durante la registrazione del Tax System', { error });
      throw new Error(`Errore durante la registrazione del Tax System: ${error.message}`);
    }
  }
  
  /**
   * Configura il Tax System per il token
   * 
   * @private
   */
  private async configureTaxSystemForToken(): Promise<void> {
    try {
      this.logger.info('Configurazione del Tax System per il token');
      
      // Configura il Tax System per applicare le tasse alle transazioni del token
      await this.taxSystem.updateTaxPercentages(
        0.05, // 5% tassa di acquisto
        0.10, // 10% tassa di vendita
        0.02  // 2% tassa di trasferimento
      );
      
      // Configura la distribuzione delle tasse
      await this.taxSystem.updateTaxDistribution({
        liquidity: 0.3,  // 30% per la liquidità
        marketing: 0.2,  // 20% per il marketing
        development: 0.2, // 20% per lo sviluppo
        burn: 0.15,      // 15% per il burn
        buyback: 0.15    // 15% per il buyback
      });
      
      // Configura il buyback e burn automatico
      await this.taxSystem.updateMinimumAmounts(
        BigInt(1000000000), // 1B unità per il buyback
        BigInt(500000000)   // 500M unità per il burn
      );
      
      // Configura l'intervallo di buyback e burn
      await this.taxSystem.updateBuybackBurnInterval(
        3600000 // 1 ora
      );
      
      this.logger.info('Tax System configurato con successo per il token');
    } catch (error) {
      this.logger.error('Errore durante la configurazione del Tax System per il token', { error });
      throw new Error(`Errore durante la configurazione del Tax System per il token: ${error.message}`);
    }
  }
  
  /**
   * Registra l'Anti-Rug System come gestore autorizzato per il token
   * 
   * @private
   */
  private async registerAntiRugSystem(): Promise<void> {
    try {
      this.logger.info('Registrazione dell\'Anti-Rug System');
      
      // In una implementazione reale, qui registreremmo l'Anti-Rug System
      // come gestore autorizzato per il token
      
      // Configura l'Anti-Rug System per il token
      await this.configureAntiRugSystemForToken();
      
      this.logger.info('Anti-Rug System registrato con successo');
    } catch (error) {
      this.logger.error('Errore durante la registrazione dell\'Anti-Rug System', { error });
      throw new Error(`Errore durante la registrazione dell'Anti-Rug System: ${error.message}`);
    }
  }
  
  /**
   * Configura l'Anti-Rug System per il token
   * 
   * @private
   */
  private async configureAntiRugSystemForToken(): Promise<void> {
    try {
      this.logger.info('Configurazione dell\'Anti-Rug System per il token');
      
      // Configura l'Anti-Rug System per proteggere gli investitori
      await this.antiRugSystem.updateConfig({
        maxContributionPercentage: 0.05, // 5% contribuzione massima
        minLockPeriod: 180 * 24 * 60 * 60, // 180 giorni di lock minimo
        scoringThreshold: 70 // Punteggio minimo di 70/100
      });
      
      // Registra il token nell'Anti-Rug System
      await this.antiRugSystem.registerToken(
        this.tokenAddress,
        {
          name: 'Token Name', // In una implementazione reale, otterremmo il nome dal token
          symbol: 'TKN',      // In una implementazione reale, otterremmo il simbolo dal token
          owner: this.operatorKeypair.publicKey,
          createdAt: Date.now()
        }
      );
      
      // Valuta il rischio del token
      const safetyScore = await this.antiRugSystem.evaluateTokenRisk(this.tokenAddress);
      
      this.logger.info('Anti-Rug System configurato con successo per il token', {
        safetyScore
      });
    } catch (error) {
      this.logger.error('Errore durante la configurazione dell\'Anti-Rug System per il token', { error });
      throw new Error(`Errore durante la configurazione dell'Anti-Rug System per il token: ${error.message}`);
    }
  }
  
  /**
   * Registra il Market Maker come gestore autorizzato per il token
   * 
   * @private
   */
  private async registerMarketMaker(): Promise<void> {
    try {
      this.logger.info('Registrazione del Market Maker');
      
      // In una implementazione reale, qui registreremmo il Market Maker
      // come gestore autorizzato per il token
      
      // Configura il Market Maker per il token
      await this.configureMarketMakerForToken();
      
      this.logger.info('Market Maker registrato con successo');
    } catch (error) {
      this.logger.error('Errore durante la registrazione del Market Maker', { error });
      throw new Error(`Errore durante la registrazione del Market Maker: ${error.message}`);
    }
  }
  
  /**
   * Configura il Market Maker per il token
   * 
   * @private
   */
  private async configureMarketMakerForToken(): Promise<void> {
    try {
      this.logger.info('Configurazione del Market Maker per il token');
      
      // Configura il Market Maker per stabilizzare il prezzo del token
      await this.marketMaker.updateSpreadPercentage(0.02); // 2% spread
      await this.marketMaker.updatePriceRangePercentage(0.05); // 5% range di prezzo
      await this.marketMaker.updateRebalanceThreshold(0.1); // 10% soglia di ribilanciamento
      await this.marketMaker.updateMaxTradeSize(1000000); // 1M unità per trade
      
      // Crea una strategia di market making per il token
      await this.marketMaker.createStrategy({
        tokenAddress: this.tokenAddress.toString(),
        initialPrice: 0.001, // Prezzo iniziale
        targetPrice: 0.001,  // Prezzo target
        minPrice: 0.0008,    // Prezzo minimo
        maxPrice: 0.0012,    // Prezzo massimo
        liquidityDepth: 10,  // Profondità della liquidità
        enabled: true
      });
      
      this.logger.info('Market Maker configurato con successo per il token');
    } catch (error) {
      this.logger.error('Errore durante la configurazione del Market Maker per il token', { error });
      throw new Error(`Errore durante la configurazione del Market Maker per il token: ${error.message}`);
    }
  }
  
  /**
   * Registra il Launchpad come gestore autorizzato per il token
   * 
   * @private
   */
  private async registerLaunchpad(): Promise<void> {
    try {
      this.logger.info('Registrazione del Launchpad');
      
      // In una implementazione reale, qui registreremmo il Launchpad
      // come gestore autorizzato per il token
      
      this.logger.info('Launchpad registrato con successo');
    } catch (error) {
      this.logger.error('Errore durante la registrazione del Launchpad', { error });
      throw new Error(`Errore durante la registrazione del Launchpad: ${error.message}`);
    }
  }
  
  /**
   * Abilita il buybot per il token
   * 
   * @returns Promise che risolve con un booleano che indica il successo
   */
  async enableBuybot(): Promise<boolean> {
    try {
      this.logger.info('Abilitazione del buybot per il token');
      
      // In una implementazione reale, qui abiliteremmo il buybot nel token contract
      
      // Abilita il Bundle Engine
      await this.bundleEngine.start();
      
      // Abilita il Tax System
      await this.taxSystem.start();
      
      // Abilita il Market Maker
      await this.marketMaker.startStrategy(this.tokenAddress.toString());
      
      this.logger.info('Buybot abilitato con successo per il token');
      
      return true;
    } catch (error) {
      this.logger.error('Errore durante l\'abilitazione del buybot per il token', { error });
      throw new Error(`Errore durante l'abilitazione del buybot per il token: ${error.message}`);
    }
  }
  
  /**
   * Disabilita il buybot per il token
   * 
   * @returns Promise che risolve con un booleano che indica il successo
   */
  async disableBuybot(): Promise<boolean> {
    try {
      this.logger.info('Disabilitazione del buybot per il token');
      
      // In una implementazione reale, qui disabiliteremmo il buybot nel token contract
      
      // Disabilita il Bundle Engine
      await this.bundleEngine.stop();
      
      // Disabilita il Tax System
      await this.taxSystem.stop();
      
      // Disabilita il Market Maker
      await this.marketMaker.stopStrategy(this.tokenAddress.toString());
      
      this.logger.info('Buybot disabilitato con successo per il token');
      
      return true;
    } catch (error) {
      this.logger.error('Errore durante la disabilitazione del buybot per il token', { error });
      throw new Error(`Errore durante la disabilitazione del buybot per il token: ${error.message}`);
    }
  }
  
  /**
   * Abilita la modalità lancio per il token
   * 
   * @param listingPrice - Prezzo di listing
   * @returns Promise che risolve con un booleano che indica il successo
   */
  async enableLaunchMode(listingPrice: number): Promise<boolean> {
    try {
      this.logger.info('Abilitazione della modalità lancio per il token', {
        listingPrice
      });
      
      // In una implementazione reale, qui abiliteremmo la modalità lancio nel token contract
      
      // Configura il Bundle Engine per la modalità lancio
      await this.bundleEngine.updateConfig({
        maxTransactionsPerBundle: 20, // Bundle più piccoli per conferme più rapide
        timeoutSeconds: 30, // Timeout più breve
        priorityFee: 20 // Fee più alta per priorità
      });
      
      // Configura il Tax System per la modalità lancio
      // Durante il lancio, aumentiamo le tasse di vendita per scoraggiare i dump
      await this.taxSystem.updateTaxPercentages(
        0.05, // 5% tassa di acquisto
        0.20, // 20% tassa di vendita (raddoppiata)
        0.02  // 2% tassa di trasferimento
      );
      
      // Configura il Market Maker per la modalità lancio
      // Durante il lancio, aumentiamo lo spread per stabilizzare il prezzo
      await this.marketMaker.updateSpreadPercentage(0.06); // 6% spread (triplicato)
      
      // Aggiorna la strategia di market making con il prezzo di listing
      await this.marketMaker.updateStrategy(
        this.tokenAddress.toString(),
        {
          initialPrice: listingPrice,
          targetPrice: listingPrice,
          minPrice: listingPrice * 0.8,
          maxPrice: listingPrice * 1.2
        }
      );
      
      // Abilita il buybot
      await this.enableBuybot();
      
      // Pianifica il ripristino delle configurazioni normali dopo 24 ore
      setTimeout(async () => {
        await this.disableLaunchMode();
      }, 24 * 60 * 60 * 1000);
      
      this.logger.info('Modalità lancio abilitata con successo per il token');
      
      return true;
    } catch (error) {
      this.logger.error('Errore durante l\'abilitazione della modalità lancio per il token', { error });
      throw new Error(`Errore durante l'abilitazione della modalità lancio per il token: ${error.message}`);
    }
  }
  
  /**
   * Disabilita la modalità lancio per il token
   * 
   * @returns Promise che risolve con un booleano che indica il successo
   */
  async disableLaunchMode(): Promise<boolean> {
    try {
      this.logger.info('Disabilitazione della modalità lancio per il token');
      
      // In una implementazione reale, qui disabiliteremmo la modalità lancio nel token contract
      
      // Ripristina la configurazione normale del Bundle Engine
      await this.bundleEngine.updateConfig({
        maxTransactionsPerBundle: 50,
        timeoutSeconds: 60,
        priorityFee: 10
      });
      
      // Ripristina la configurazione normale del Tax System
      await this.taxSystem.updateTaxPercentages(
        0.05, // 5% tassa di acquisto
        0.10, // 10% tassa di vendita
        0.02  // 2% tassa di trasferimento
      );
      
      // Ripristina la configurazione normale del Market Maker
      await this.marketMaker.updateSpreadPercentage(0.02); // 2% spread
      
      this.logger.info('Modalità lancio disabilitata con successo per il token');
      
      return true;
    } catch (error) {
      this.logger.error('Errore durante la disabilitazione della modalità lancio per il token', { error });
      throw new Error(`Errore durante la disabilitazione della modalità lancio per il token: ${error.message}`);
    }
  }
  
  /**
   * Esegue un buyback
   * 
   * @param amount - Importo del buyback
   * @returns Promise che risolve con un booleano che indica il successo
   */
  async executeBuyback(amount: bigint): Promise<boolean> {
    try {
      this.logger.info('Esecuzione di un buyback', {
        amount: amount.toString()
      });
      
      // In una implementazione reale, qui eseguiremmo un buyback nel token contract
      
      // Esegui il buyback tramite il Tax System
      await this.taxSystem.executeBuyback(amount);
      
      this.logger.info('Buyback eseguito con successo');
      
      return true;
    } catch (error) {
      this.logger.error('Errore durante l\'esecuzione del buyback', { error });
      throw new Error(`Errore durante l'esecuzione del buyback: ${error.message}`);
    }
  }
  
  /**
   * Esegue un burn
   * 
   * @param amount - Importo del burn
   * @returns Promise che risolve con un booleano che indica il successo
   */
  async executeBurn(amount: bigint): Promise<boolean> {
    try {
      this.logger.info('Esecuzione di un burn', {
        amount: amount.toString()
      });
      
      // In una implementazione reale, qui eseguiremmo un burn nel token contract
      
      // Esegui il burn tramite il Tax System
      await this.taxSystem.executeBurn(amount);
      
      this.logger.info('Burn eseguito con successo');
      
      return true;
    } catch (error) {
      this.logger.error('Errore durante l\'esecuzione del burn', { error });
      throw new Error(`Errore durante l'esecuzione del burn: ${error.message}`);
    }
  }
  
  /**
   * Esegue un intervento di supporto al prezzo
   * 
   * @param amount - Importo dell'intervento
   * @returns Promise che risolve con un booleano che indica il successo
   */
  async executePriceSupport(amount: bigint): Promise<boolean> {
    try {
      this.logger.info('Esecuzione di un intervento di supporto al prezzo', {
        amount: amount.toString()
      });
      
      // In una implementazione reale, qui eseguiremmo un intervento di supporto al prezzo nel token contract
      
      // Esegui un buyback per supportare il prezzo
      await this.executeBuyback(amount);
      
      // Aggiorna la strategia di market making per stabilizzare il prezzo
      const currentPrice = await this.getCurrentPrice();
      await this.marketMaker.updateStrategy(
        this.tokenAddress.toString(),
        {
          targetPrice: currentPrice,
          minPrice: currentPrice * 0.95,
          maxPrice: currentPrice * 1.05
        }
      );
      
      this.logger.info('Intervento di supporto al prezzo eseguito con successo');
      
      return true;
    } catch (error) {
      this.logger.error('Errore durante l\'esecuzione dell\'intervento di supporto al prezzo', { error });
      throw new Error(`Errore durante l'esecuzione dell'intervento di supporto al prezzo: ${error.message}`);
    }
  }
  
  /**
   * Ottiene il prezzo corrente del token
   * 
   * @returns Promise che risolve con il prezzo corrente
   */
  async getCurrentPrice(): Promise<number> {
    try {
      this.logger.info('Recupero del prezzo corrente del token');
      
      // In una implementazione reale, qui otterremmo il prezzo corrente dal mercato
      // Per ora, restituiamo un prezzo simulato
      
      const marketState = this.marketMaker.getMarketState();
      const currentPrice = marketState.currentPrice;
      
      this.logger.info('Prezzo corrente del token recuperato con successo', {
        currentPrice
      });
      
      return currentPrice;
    } catch (error) {
      this.logger.error('Errore durante il recupero del prezzo corrente del token', { error });
      throw new Error(`Errore durante il recupero del prezzo corrente del token: ${error.message}`);
    }
  }
  
  /**
   * Ottiene le statistiche del buybot
   * 
   * @returns Promise che risolve con le statistiche del buybot
   */
  async getBuybotStatistics(): Promise<any> {
    try {
      this.logger.info('Recupero delle statistiche del buybot');
      
      // In una implementazione reale, qui otterremmo le statistiche dal token contract
      // Per ora, restituiamo statistiche simulate
      
      // Ottieni le statistiche delle tasse
      const taxStats = await this.taxSystem.getTaxStatistics();
      
      // Ottieni le statistiche del buyback e burn
      const buybackStats = {
        totalAmount: (await this.taxSystem.getPendingAmounts()).buyback.toString(),
        count: 10, // Simulato
        lastExecuted: Date.now() - 3600000 // 1 ora fa
      };
      
      const burnStats = {
        totalAmount: (await this.taxSystem.getPendingAmounts()).burn.toString(),
        count: 5, // Simulato
        lastExecuted: Date.now() - 7200000 // 2 ore fa
      };
      
      // Ottieni le statistiche del market maker
      const marketMakerStats = {
        currentPrice: (await this.getCurrentPrice()),
        spread: this.marketMaker.getPrices(),
        dailyVolume: this.marketMaker.getDailyVolumeStats()
      };
      
      // Ottieni le statistiche dell'anti-rug system
      const antiRugStats = {
        safetyScore: await this.antiRugSystem.getTokenSafetyScore(this.tokenAddress),
        liquidityLocks: await this.antiRugSystem.getLiquidityLocksByProject(this.tokenAddress.toString()),
        insuranceFund: await this.antiRugSystem.getInsuranceFundBalance()
      };
      
      const buybotStats = {
        taxStats,
        buybackStats,
        burnStats,
        marketMakerStats,
        antiRugStats
      };
      
      this.logger.info('Statistiche del buybot recuperate con successo');
      
      return buybotStats;
    } catch (error) {
      this.logger.error('Errore durante il recupero delle statistiche del buybot', { error });
      throw new Error(`Errore durante il recupero delle statistiche del buybot: ${error.message}`);
    }
  }
  
  /**
   * Lancia il token tramite il launchpad
   * 
   * @param listingPrice - Prezzo di listing
   * @returns Promise che risolve con un booleano che indica il successo
   */
  async launchTokenViaLaunchpad(listingPrice: number): Promise<boolean> {
    try {
      this.logger.info('Lancio del token tramite il launchpad', {
        listingPrice
      });
      
      // Verifica che il launchpad sia inizializzato
      if (!this.launchpad) {
        throw new Error('Launchpad non inizializzato');
      }
      
      // Lancia il token tramite il launchpad
      await this.launchpad.launchToken(this.tokenAddress.toString());
      
      // Abilita la modalità lancio
      await this.enableLaunchMode(listingPrice);
      
      this.logger.info('Token lanciato con successo tramite il launchpad');
      
      return true;
    } catch (error) {
      this.logger.error('Errore durante il lancio del token tramite il launchpad', { error });
      throw new Error(`Errore durante il lancio del token tramite il launchpad: ${error.message}`);
    }
  }
}
