import { BuybotTokenIntegration } from '../src/buybot_token_integration';
import { Keypair } from '@solana/web3.js';
import { expect } from 'chai';
import * as sinon from 'sinon';

describe('BuybotTokenIntegration Tests', () => {
  let buybotTokenIntegration: BuybotTokenIntegration;
  let mockBundleEngine: any;
  let mockTaxSystem: any;
  let mockAntiRugSystem: any;
  let mockMarketMaker: any;
  let mockLaunchpad: any;
  
  const operatorKeypair = Keypair.generate();
  const tokenAddress = 'TokenAddressMock111111111111111111111111111';
  const tokenProgramId = 'TokenProgramMock111111111111111111111111111';
  
  beforeEach(() => {
    // Crea mock per i componenti del buybot
    mockBundleEngine = {
      updateConfig: sinon.stub().resolves(),
      setPrioritizationRules: sinon.stub().resolves(),
      start: sinon.stub().resolves(),
      stop: sinon.stub().resolves()
    };
    
    mockTaxSystem = {
      updateTaxPercentages: sinon.stub().resolves(),
      updateTaxDistribution: sinon.stub().resolves(),
      updateMinimumAmounts: sinon.stub().resolves(),
      updateBuybackBurnInterval: sinon.stub().resolves(),
      start: sinon.stub().resolves(),
      stop: sinon.stub().resolves(),
      executeBuyback: sinon.stub().resolves(),
      executeBurn: sinon.stub().resolves(),
      getTaxStatistics: sinon.stub().resolves({
        totalTaxesCollected: '1000000',
        buyTaxes: '300000',
        sellTaxes: '600000',
        transferTaxes: '100000'
      }),
      getPendingAmounts: sinon.stub().resolves({
        buyback: BigInt(500000),
        burn: BigInt(1000000)
      })
    };
    
    mockAntiRugSystem = {
      updateConfig: sinon.stub().resolves(),
      registerToken: sinon.stub().resolves(),
      evaluateTokenRisk: sinon.stub().resolves(85),
      getTokenSafetyScore: sinon.stub().resolves(85),
      getLiquidityLocksByProject: sinon.stub().resolves([
        {
          id: 'lock1',
          tokenAmount: '1000000',
          baseAmount: '500000',
          lockPeriod: 15552000,
          isLocked: true
        }
      ]),
      getInsuranceFundBalance: sinon.stub().resolves('1000000')
    };
    
    mockMarketMaker = {
      updateSpreadPercentage: sinon.stub().resolves(),
      updatePriceRangePercentage: sinon.stub().resolves(),
      updateRebalanceThreshold: sinon.stub().resolves(),
      updateMaxTradeSize: sinon.stub().resolves(),
      createStrategy: sinon.stub().resolves(),
      updateStrategy: sinon.stub().resolves(),
      startStrategy: sinon.stub().resolves(),
      stopStrategy: sinon.stub().resolves(),
      getMarketState: sinon.stub().returns({
        currentPrice: 0.001
      }),
      getPrices: sinon.stub().returns({
        bid: 0.00095,
        ask: 0.00105
      }),
      getDailyVolumeStats: sinon.stub().returns({
        buy: 1000000,
        sell: 800000,
        total: 1800000
      })
    };
    
    mockLaunchpad = {
      launchToken: sinon.stub().resolves()
    };
    
    // Crea l'istanza di BuybotTokenIntegration con i mock
    buybotTokenIntegration = new BuybotTokenIntegration({
      solanaRpcUrl: 'https://api.devnet.solana.com',
      operatorKeypair,
      tokenAddress,
      tokenProgramId
    });
    
    // Sostituisci i componenti reali con i mock
    (buybotTokenIntegration as any).bundleEngine = mockBundleEngine;
    (buybotTokenIntegration as any).taxSystem = mockTaxSystem;
    (buybotTokenIntegration as any).antiRugSystem = mockAntiRugSystem;
    (buybotTokenIntegration as any).marketMaker = mockMarketMaker;
    (buybotTokenIntegration as any).launchpad = mockLaunchpad;
  });
  
  afterEach(() => {
    sinon.restore();
  });
  
  describe('connectToToken', () => {
    it('dovrebbe collegare correttamente il buybot al token contract', async () => {
      await buybotTokenIntegration.connectToToken();
      
      // Verifica che i metodi di registrazione siano stati chiamati
      expect(mockBundleEngine.updateConfig.calledOnce).to.be.true;
      expect(mockTaxSystem.updateTaxPercentages.calledOnce).to.be.true;
      expect(mockAntiRugSystem.registerToken.calledOnce).to.be.true;
      expect(mockMarketMaker.createStrategy.calledOnce).to.be.true;
    });
  });
  
  describe('enableBuybot', () => {
    it('dovrebbe abilitare correttamente il buybot', async () => {
      const result = await buybotTokenIntegration.enableBuybot();
      
      expect(result).to.be.true;
      expect(mockBundleEngine.start.calledOnce).to.be.true;
      expect(mockTaxSystem.start.calledOnce).to.be.true;
      expect(mockMarketMaker.startStrategy.calledOnce).to.be.true;
    });
  });
  
  describe('disableBuybot', () => {
    it('dovrebbe disabilitare correttamente il buybot', async () => {
      const result = await buybotTokenIntegration.disableBuybot();
      
      expect(result).to.be.true;
      expect(mockBundleEngine.stop.calledOnce).to.be.true;
      expect(mockTaxSystem.stop.calledOnce).to.be.true;
      expect(mockMarketMaker.stopStrategy.calledOnce).to.be.true;
    });
  });
  
  describe('enableLaunchMode', () => {
    it('dovrebbe abilitare correttamente la modalità lancio', async () => {
      const listingPrice = 0.001;
      const result = await buybotTokenIntegration.enableLaunchMode(listingPrice);
      
      expect(result).to.be.true;
      expect(mockBundleEngine.updateConfig.calledOnce).to.be.true;
      expect(mockTaxSystem.updateTaxPercentages.calledOnce).to.be.true;
      expect(mockMarketMaker.updateSpreadPercentage.calledOnce).to.be.true;
      expect(mockMarketMaker.updateStrategy.calledOnce).to.be.true;
    });
  });
  
  describe('disableLaunchMode', () => {
    it('dovrebbe disabilitare correttamente la modalità lancio', async () => {
      const result = await buybotTokenIntegration.disableLaunchMode();
      
      expect(result).to.be.true;
      expect(mockBundleEngine.updateConfig.calledOnce).to.be.true;
      expect(mockTaxSystem.updateTaxPercentages.calledOnce).to.be.true;
      expect(mockMarketMaker.updateSpreadPercentage.calledOnce).to.be.true;
    });
  });
  
  describe('executeBuyback', () => {
    it('dovrebbe eseguire correttamente un buyback', async () => {
      const amount = BigInt(1000000);
      const result = await buybotTokenIntegration.executeBuyback(amount);
      
      expect(result).to.be.true;
      expect(mockTaxSystem.executeBuyback.calledOnce).to.be.true;
      expect(mockTaxSystem.executeBuyback.calledWith(amount)).to.be.true;
    });
  });
  
  describe('executeBurn', () => {
    it('dovrebbe eseguire correttamente un burn', async () => {
      const amount = BigInt(1000000);
      const result = await buybotTokenIntegration.executeBurn(amount);
      
      expect(result).to.be.true;
      expect(mockTaxSystem.executeBurn.calledOnce).to.be.true;
      expect(mockTaxSystem.executeBurn.calledWith(amount)).to.be.true;
    });
  });
  
  describe('executePriceSupport', () => {
    it('dovrebbe eseguire correttamente un intervento di supporto al prezzo', async () => {
      const amount = BigInt(1000000);
      const result = await buybotTokenIntegration.executePriceSupport(amount);
      
      expect(result).to.be.true;
      expect(mockTaxSystem.executeBuyback.calledOnce).to.be.true;
      expect(mockMarketMaker.updateStrategy.calledOnce).to.be.true;
    });
  });
  
  describe('getCurrentPrice', () => {
    it('dovrebbe recuperare correttamente il prezzo corrente', async () => {
      const price = await buybotTokenIntegration.getCurrentPrice();
      
      expect(price).to.equal(0.001);
      expect(mockMarketMaker.getMarketState.calledOnce).to.be.true;
    });
  });
  
  describe('getBuybotStatistics', () => {
    it('dovrebbe recuperare correttamente le statistiche del buybot', async () => {
      const stats = await buybotTokenIntegration.getBuybotStatistics();
      
      expect(stats).to.have.property('taxStats');
      expect(stats).to.have.property('buybackStats');
      expect(stats).to.have.property('burnStats');
      expect(stats).to.have.property('marketMakerStats');
      expect(stats).to.have.property('antiRugStats');
      
      expect(mockTaxSystem.getTaxStatistics.calledOnce).to.be.true;
      expect(mockTaxSystem.getPendingAmounts.calledOnce).to.be.true;
      expect(mockAntiRugSystem.getTokenSafetyScore.calledOnce).to.be.true;
      expect(mockAntiRugSystem.getLiquidityLocksByProject.calledOnce).to.be.true;
      expect(mockAntiRugSystem.getInsuranceFundBalance.calledOnce).to.be.true;
    });
  });
  
  describe('launchTokenViaLaunchpad', () => {
    it('dovrebbe lanciare correttamente il token tramite il launchpad', async () => {
      const listingPrice = 0.001;
      const result = await buybotTokenIntegration.launchTokenViaLaunchpad(listingPrice);
      
      expect(result).to.be.true;
      expect(mockLaunchpad.launchToken.calledOnce).to.be.true;
      expect(mockLaunchpad.launchToken.calledWith(tokenAddress)).to.be.true;
    });
  });
});
