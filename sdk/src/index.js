const { MetricsCollector, MetricsExporter, PerformanceMonitor, AlertManager, initializeMonitoring } = require('./monitoring');
const { initializeLogging } = require('./logging');
const { Layer2SolanaClient } = require('./client');
const { Account } = require('./account');
const { Transaction } = require('./transaction');
const { BridgeService } = require('./bridge');
const { PhantomWallet, MetamaskWallet, BackpackWallet } = require('./wallet');

/**
 * Inizializza l'SDK Layer-2 Solana completo
 * 
 * @param {Object} options - Opzioni di configurazione
 * @param {string} options.l1Provider - URL del provider Ethereum L1
 * @param {string} options.l2Provider - URL del provider Solana L2
 * @param {Object} options.logging - Opzioni per il sistema di logging
 * @param {Object} options.monitoring - Opzioni per il sistema di monitoraggio
 * @param {Object} options.express - Istanza di Express per configurare gli endpoint (opzionale)
 * @returns {Object} Oggetto contenente tutte le istanze configurate
 */
function initialize(options = {}) {
  // Verifica i parametri obbligatori
  if (!options.l1Provider) {
    throw new Error('L1 provider URL is required');
  }
  
  if (!options.l2Provider) {
    throw new Error('L2 provider URL is required');
  }
  
  // Inizializza il logging
  const logging = initializeLogging({
    level: options.logging?.level || 'info',
    service: options.logging?.service || 'layer2-solana',
    console: options.logging?.console !== undefined ? options.logging.console : true,
    file: options.logging?.file !== undefined ? options.logging.file : false,
    filename: options.logging?.filename || 'layer2-solana.log',
    json: options.logging?.json !== undefined ? options.logging.json : false,
    elkConfig: options.logging?.elkConfig
  });
  
  // Crea il bridge service
  const bridgeService = new BridgeService({
    logger: logging.logger,
    l1Provider: options.l1Provider,
    l2Provider: options.l2Provider,
    contracts: options.contracts
  });
  
  // Crea il client principale
  const client = new Layer2SolanaClient({
    logger: logging.logger,
    l1Provider: options.l1Provider,
    l2Provider: options.l2Provider,
    bridge: bridgeService
  });
  
  // Inizializza il monitoraggio se richiesto
  let monitoring = null;
  if (options.monitoring !== false) {
    monitoring = initializeMonitoring({
      logger: logging.logger,
      autoStart: options.monitoring?.autoStart !== undefined ? options.monitoring.autoStart : true,
      metrics: options.monitoring?.metrics,
      alerts: options.monitoring?.alerts,
      express: options.express
    });
  }
  
  return {
    client,
    bridge: bridgeService,
    logging,
    monitoring,
    Account,
    Transaction,
    wallets: {
      PhantomWallet,
      MetamaskWallet,
      BackpackWallet
    }
  };
}

module.exports = {
  initialize,
  Layer2SolanaClient,
  Account,
  Transaction,
  BridgeService,
  PhantomWallet,
  MetamaskWallet,
  BackpackWallet,
  initializeLogging,
  initializeMonitoring,
  MetricsCollector,
  MetricsExporter,
  PerformanceMonitor,
  AlertManager
};
