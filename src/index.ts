/**
 * Punto di ingresso principale per il Layer-2 con BuyBot integrato e ottimizzazioni
 * 
 * Questo file esporta tutti i componenti principali del sistema Layer-2
 * con il BuyBot completamente integrato e le ottimizzazioni di performance e sicurezza.
 */

// Importa i componenti originali e ottimizzati
import { BundleEngine as OriginalBundleEngine } from './bundle_engine';
import { TaxSystem } from './tax_system';
import { AntiRugSystem as OriginalAntiRugSystem } from './anti_rug_system';
import { MarketMaker } from './market_maker';
import { Launchpad as OriginalLaunchpad } from './launchpad';
import { BuybotTokenIntegration } from './buybot_token_integration';
import { Connection, Keypair } from '@solana/web3.js';

// Importa le ottimizzazioni
import { OptimizedBundleEngine } from './optimized_bundle_engine';
import { SpikeLoadManager } from './spike_load_manager';
import { MixedTransactionOptimizer } from './mixed_transaction_optimizer';
import { BridgeLatencyOptimizer } from './bridge_latency_optimizer';
import { BridgeReliabilitySystem } from './bridge_reliability_system';
import { LaunchpadSpeedOptimizer } from './launchpad_speed_optimizer';
import { LaunchpadSecurityEnhancements } from './launchpad_security_enhancements';
import { Logger } from './utils/logger'; // Assumendo che esista un logger

// Esporta i componenti principali (originali e ottimizzati per riferimento)
export {
  OriginalBundleEngine,
  TaxSystem,
  OriginalAntiRugSystem,
  MarketMaker,
  OriginalLaunchpad,
  BuybotTokenIntegration,
  OptimizedBundleEngine,
  SpikeLoadManager,
  MixedTransactionOptimizer,
  BridgeLatencyOptimizer,
  BridgeReliabilitySystem,
  LaunchpadSpeedOptimizer,
  LaunchpadSecurityEnhancements
};

/**
 * Crea un'istanza completa e ottimizzata del sistema Layer-2 con BuyBot integrato
 * 
 * @param solanaRpcUrl - URL dell'endpoint RPC di Solana
 * @param operatorKeypair - Keypair dell'operatore
 * @returns Oggetto contenente tutti i componenti ottimizzati e inizializzati
 */
export async function createOptimizedLayer2System(solanaRpcUrl: string, operatorKeypair: Keypair) {
  const logger = new Logger('OptimizedLayer2System');
  logger.info('Creazione del sistema Layer-2 ottimizzato...');

  // Crea la connessione a Solana
  const connection = new Connection(solanaRpcUrl);
  
  // Inizializza i componenti OTTIMIZZATI
  logger.info('Inizializzazione OptimizedBundleEngine...');
  const bundleEngine = new OptimizedBundleEngine({
    solanaRpcUrl,
    operatorKeypair,
    maxTransactionsPerBundle: 100, // Aumentato rispetto all'originale
    maxConcurrentBundles: 10, // Aggiunto per concorrenza
    bundleIntervalMs: 50, // Intervallo più breve
    priorityFeeMicroLamports: 1000 // Esempio di fee prioritaria
  });
  await bundleEngine.initialize();

  logger.info('Inizializzazione TaxSystem...');
  const taxSystem = new TaxSystem({
    solanaRpcUrl,
    operatorKeypair,
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

  // Nota: L'AntiRugSystem originale potrebbe essere sostituito o integrato
  // con LaunchpadSecurityEnhancements. Qui manteniamo l'originale per ora,
  // ma la logica Anti-Rug è stata potenziata in LaunchpadSecurityEnhancements.
  logger.info('Inizializzazione AntiRugSystem (originale)...');
  const antiRugSystem = new OriginalAntiRugSystem({
    solanaRpcUrl,
    operatorKeypair
  });

  logger.info('Inizializzazione MarketMaker...');
  const marketMaker = new MarketMaker({
    solanaRpcUrl,
    operatorKeypair
  });

  // Inizializza i componenti OTTIMIZZATI del Launchpad
  logger.info('Inizializzazione LaunchpadSpeedOptimizer...');
  const launchpadSpeedOptimizer = new LaunchpadSpeedOptimizer({
      numWorkers: 4, // Esempio: usa 4 worker
      enablePreallocation: true,
      preallocationCacheSize: 20
  });
  await launchpadSpeedOptimizer.initialize();

  logger.info('Inizializzazione LaunchpadSecurityEnhancements...');
  const launchpadSecurityEnhancements = new LaunchpadSecurityEnhancements({
      antiRugSensitivity: 80, // Più sensibile
      enableCreatorVerification: true,
      requiredCreatorVerificationLevel: 4, // Livello più alto richiesto
      enableSuspiciousActivityMonitoring: true
  });
  await launchpadSecurityEnhancements.initialize();

  // Inizializza i componenti OTTIMIZZATI del Bridge
  // Nota: Questi potrebbero dover essere integrati nel servizio bridge esistente
  logger.info('Inizializzazione BridgeLatencyOptimizer...');
  const bridgeLatencyOptimizer = new BridgeLatencyOptimizer({
      enableVaaCaching: true,
      vaaCacheTTLSeconds: 300,
      maxConcurrentVerifications: 5
  });
  await bridgeLatencyOptimizer.initialize();

  logger.info('Inizializzazione BridgeReliabilitySystem...');
  const bridgeReliabilitySystem = new BridgeReliabilitySystem({
      maxRetries: 5,
      initialRetryDelayMs: 1000,
      maxRetryDelayMs: 30000,
      circuitBreakerThreshold: 3,
      circuitBreakerTimeoutMs: 60000
  });
  await bridgeReliabilitySystem.initialize();

  // Inizializza i componenti OTTIMIZZATI per la gestione del carico e transazioni
  logger.info('Inizializzazione SpikeLoadManager...');
  const spikeLoadManager = new SpikeLoadManager({
      throttlingThresholdTps: 12000, // Soglia per attivare il throttling
      bufferSize: 5000 // Dimensione del buffer transazioni
  });
  await spikeLoadManager.initialize();

  logger.info('Inizializzazione MixedTransactionOptimizer...');
  const mixedTransactionOptimizer = new MixedTransactionOptimizer({
      numSpecializedWorkers: 4, // Esempio: 4 worker specializzati
      queueCapacity: 10000 // Capacità delle code
  });
  await mixedTransactionOptimizer.initialize();

  logger.info('Sistema Layer-2 ottimizzato creato con successo.');

  return {
    connection,
    bundleEngine,
    taxSystem,
    antiRugSystem, // Originale, ma la logica potenziata è in launchpadSecurityEnhancements
    marketMaker,
    launchpadSpeedOptimizer,
    launchpadSecurityEnhancements,
    bridgeLatencyOptimizer, // Da integrare nel servizio bridge
    bridgeReliabilitySystem, // Da integrare nel servizio bridge
    spikeLoadManager, // Da integrare nel flusso di gestione richieste
    mixedTransactionOptimizer, // Da integrare nel flusso di elaborazione transazioni
    
    /**
     * Crea un'integrazione tra il BuyBot e un token specifico
     * 
     * @param tokenAddress - Indirizzo del token
     * @param tokenProgramId - ID del programma del token
     * @returns Istanza di BuybotTokenIntegration
     */
    createTokenIntegration: (tokenAddress: string, tokenProgramId: string) => {
      // Nota: L'indirizzo del launchpad potrebbe dover essere recuperato diversamente ora
      // const launchpadAddress = launchpadSpeedOptimizer.getLaunchpadAddress(); // Metodo ipotetico
      return new BuybotTokenIntegration({
        solanaRpcUrl,
        operatorKeypair,
        tokenAddress,
        tokenProgramId,
        // launchpadAddress: launchpadAddress 
      });
    }
  };
}

// Esempio di utilizzo (da rimuovere o commentare in produzione)
/*
async function main() {
  try {
    // Carica il keypair dell'operatore da un file (esempio)
    // const operatorKeypair = Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync('/path/to/operator-keypair.json', 'utf-8'))));
    const operatorKeypair = Keypair.generate(); // Genera un keypair per test
    console.log(`Operator Public Key: ${operatorKeypair.publicKey.toBase58()}`);

    const system = await createOptimizedLayer2System('https://api.devnet.solana.com', operatorKeypair);
    
    // Ora puoi usare i componenti ottimizzati del sistema
    // Esempio: system.bundleEngine.submitTransaction(...);
    // Esempio: system.launchpadSpeedOptimizer.createToken(...);
    // Esempio: system.launchpadSecurityEnhancements.evaluateAntiRug(...);

    console.log('Sistema Layer-2 ottimizzato pronto.');

  } catch (error) {
    console.error('Errore durante l\\'inizializzazione del sistema:', error);
  }
}

main();
*/

