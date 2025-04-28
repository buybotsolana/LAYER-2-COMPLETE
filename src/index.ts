import { BundleEngine } from './src/bundle_engine';
import { TaxSystem } from './src/tax_system';
import { AntiRugSystem } from './src/anti_rug_system';
import { MarketMaker } from './src/market_maker';
import { Launchpad } from './src/launchpad';
import { BuybotTokenIntegration } from './src/buybot_token_integration';
import { Connection, Keypair } from '@solana/web3.js';

/**
 * Punto di ingresso principale per il Layer-2 con BuyBot integrato
 * 
 * Questo file esporta tutti i componenti principali del sistema Layer-2
 * con il BuyBot completamente integrato per supportare il lancio e la crescita
 * del prezzo del token.
 */

// Esporta tutti i componenti principali
export {
  BundleEngine,
  TaxSystem,
  AntiRugSystem,
  MarketMaker,
  Launchpad,
  BuybotTokenIntegration
};

/**
 * Crea un'istanza completa del sistema Layer-2 con BuyBot integrato
 * 
 * @param solanaRpcUrl - URL dell'endpoint RPC di Solana
 * @param operatorKeypair - Keypair dell'operatore
 * @returns Oggetto contenente tutti i componenti inizializzati
 */
export function createLayer2System(solanaRpcUrl: string, operatorKeypair: Keypair) {
  // Crea la connessione a Solana
  const connection = new Connection(solanaRpcUrl);
  
  // Inizializza i componenti del BuyBot
  const bundleEngine = new BundleEngine({
    solanaRpcUrl,
    operatorKeypair,
    maxTransactionsPerBundle: 50
  });
  
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
  
  const antiRugSystem = new AntiRugSystem({
    solanaRpcUrl,
    operatorKeypair
  });
  
  const marketMaker = new MarketMaker({
    solanaRpcUrl,
    operatorKeypair
  });
  
  // Inizializza il Launchpad
  const launchpad = new Launchpad({
    solanaRpcUrl,
    operatorKeypair
  });
  
  return {
    connection,
    bundleEngine,
    taxSystem,
    antiRugSystem,
    marketMaker,
    launchpad,
    
    /**
     * Crea un'integrazione tra il BuyBot e un token specifico
     * 
     * @param tokenAddress - Indirizzo del token
     * @param tokenProgramId - ID del programma del token
     * @returns Istanza di BuybotTokenIntegration
     */
    createTokenIntegration: (tokenAddress: string, tokenProgramId: string) => {
      return new BuybotTokenIntegration({
        solanaRpcUrl,
        operatorKeypair,
        tokenAddress,
        tokenProgramId,
        launchpadAddress: launchpad ? launchpad.getAddress() : undefined
      });
    }
  };
}
