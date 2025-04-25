import { BridgeManager } from '../src/bridge';
import { L2Client } from '../src/client';
import { DepositManager } from '../src/bridge/deposit';
import { WithdrawalManager } from '../src/bridge/withdraw';
import { ProofGenerator } from '../src/bridge/proof';
import { BridgeConfig } from '../src/types';
import { expect } from 'chai';
import { mock, instance, when, verify, anything, deepEqual } from 'ts-mockito';
import { PublicKey, Keypair } from '@solana/web3.js';
import { ethers } from 'ethers';

describe('BridgeManager', () => {
  let mockClient: L2Client;
  let mockDepositManager: DepositManager;
  let mockWithdrawalManager: WithdrawalManager;
  let mockProofGenerator: ProofGenerator;
  let bridgeManager: BridgeManager;
  let bridgeConfig: BridgeConfig;
  
  beforeEach(() => {
    mockClient = mock(L2Client);
    mockDepositManager = mock(DepositManager);
    mockWithdrawalManager = mock(WithdrawalManager);
    mockProofGenerator = mock(ProofGenerator);
    
    // Creiamo un'istanza reale di BridgeManager ma iniettiamo i mock
    bridgeManager = new BridgeManager(instance(mockClient));
    
    // Sostituiamo i manager interni con i nostri mock
    (bridgeManager as any).depositManager = instance(mockDepositManager);
    (bridgeManager as any).withdrawalManager = instance(mockWithdrawalManager);
    (bridgeManager as any).proofGenerator = instance(mockProofGenerator);
    
    // Configurazione di esempio per il bridge
    bridgeConfig = {
      l1BridgeAddress: '0x1234567890123456789012345678901234567890',
      l2BridgeAddress: '11111111111111111111111111111111',
      challengePeriod: 604800, // 7 giorni in secondi
      supportedTokens: {
        '0x0000000000000000000000000000000000000000': 'So11111111111111111111111111111111111111111', // ETH -> Wrapped SOL
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // USDC -> USDC
      }
    };
  });
  
  describe('initialize', () => {
    it('should initialize all managers with the provided config', async () => {
      when(mockDepositManager.initialize(deepEqual(bridgeConfig))).thenResolve();
      when(mockWithdrawalManager.initialize(deepEqual(bridgeConfig))).thenResolve();
      when(mockProofGenerator.initialize(deepEqual(bridgeConfig))).thenResolve();
      
      await bridgeManager.initialize(bridgeConfig);
      
      verify(mockDepositManager.initialize(deepEqual(bridgeConfig))).once();
      verify(mockWithdrawalManager.initialize(deepEqual(bridgeConfig))).once();
      verify(mockProofGenerator.initialize(deepEqual(bridgeConfig))).once();
      
      // Verifichiamo che la configurazione sia stata salvata
      expect(bridgeManager.getConfig()).to.deep.equal(bridgeConfig);
    });
  });
  
  describe('getConfig', () => {
    it('should return the bridge configuration', async () => {
      // Inizializziamo prima il bridge
      when(mockDepositManager.initialize(anything())).thenResolve();
      when(mockWithdrawalManager.initialize(anything())).thenResolve();
      when(mockProofGenerator.initialize(anything())).thenResolve();
      
      await bridgeManager.initialize(bridgeConfig);
      
      const config = bridgeManager.getConfig();
      
      expect(config).to.deep.equal(bridgeConfig);
    });
    
    it('should throw an error if bridge is not initialized', () => {
      expect(() => bridgeManager.getConfig()).to.throw('Bridge non inizializzato');
    });
  });
  
  describe('depositETH', () => {
    it('should delegate to DepositManager and return deposit info', async () => {
      // Inizializziamo prima il bridge
      when(mockDepositManager.initialize(anything())).thenResolve();
      when(mockWithdrawalManager.initialize(anything())).thenResolve();
      when(mockProofGenerator.initialize(anything())).thenResolve();
      
      await bridgeManager.initialize(bridgeConfig);
      
      const amount = '1000000000000000000'; // 1 ETH in wei
      const l2Address = new PublicKey('11111111111111111111111111111111');
      const options = {
        onProgress: (status: string, data?: any) => {}
      };
      
      const mockDepositInfo = {
        id: 'dep_123',
        fromAddress: '0x1234567890123456789012345678901234567890',
        toAddress: l2Address.toString(),
        tokenAddress: '0x0000000000000000000000000000000000000000',
        amount,
        timestamp: Date.now(),
        status: 'completed' as const,
        l1TxHash: '0xabcdef',
        l2TxSignature: 'sig_123'
      };
      
      when(mockDepositManager.depositETH(amount, l2Address, options)).thenResolve(mockDepositInfo);
      
      const depositInfo = await bridgeManager.depositETH(amount, l2Address, options);
      
      expect(depositInfo).to.deep.equal(mockDepositInfo);
      verify(mockDepositManager.depositETH(amount, l2Address, options)).once();
    });
    
    it('should throw an error if bridge is not initialized', async () => {
      const amount = '1000000000000000000';
      const l2Address = new PublicKey('11111111111111111111111111111111');
      
      try {
        await bridgeManager.depositETH(amount, l2Address);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect(error.message).to.include('Bridge non inizializzato');
      }
    });
  });
  
  describe('depositERC20', () => {
    it('should delegate to DepositManager and return deposit info', async () => {
      // Inizializziamo prima il bridge
      when(mockDepositManager.initialize(anything())).thenResolve();
      when(mockWithdrawalManager.initialize(anything())).thenResolve();
      when(mockProofGenerator.initialize(anything())).thenResolve();
      
      await bridgeManager.initialize(bridgeConfig);
      
      const tokenAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
      const amount = '1000000'; // 1 USDC (6 decimali)
      const l2Address = new PublicKey('11111111111111111111111111111111');
      const options = {
        onProgress: (status: string, data?: any) => {}
      };
      
      const mockDepositInfo = {
        id: 'dep_123',
        fromAddress: '0x1234567890123456789012345678901234567890',
        toAddress: l2Address.toString(),
        tokenAddress,
        amount,
        timestamp: Date.now(),
        status: 'completed' as const,
        l1TxHash: '0xabcdef',
        l2TxSignature: 'sig_123'
      };
      
      when(mockDepositManager.depositERC20(tokenAddress, amount, l2Address, options)).thenResolve(mockDepositInfo);
      
      const depositInfo = await bridgeManager.depositERC20(tokenAddress, amount, l2Address, options);
      
      expect(depositInfo).to.deep.equal(mockDepositInfo);
      verify(mockDepositManager.depositERC20(tokenAddress, amount, l2Address, options)).once();
    });
  });
  
  describe('withdrawETH', () => {
    it('should delegate to WithdrawalManager and return withdrawal info', async () => {
      // Inizializziamo prima il bridge
      when(mockDepositManager.initialize(anything())).thenResolve();
      when(mockWithdrawalManager.initialize(anything())).thenResolve();
      when(mockProofGenerator.initialize(anything())).thenResolve();
      
      await bridgeManager.initialize(bridgeConfig);
      
      const amount = '1000000000'; // 1 SOL in lamports
      const l1Address = '0x1234567890123456789012345678901234567890';
      const keypair = Keypair.generate();
      const options = {
        onProgress: (status: string, data?: any) => {}
      };
      
      const mockWithdrawalInfo = {
        id: 'wit_123',
        fromAddress: keypair.publicKey.toString(),
        toAddress: l1Address,
        tokenAddress: '0x0000000000000000000000000000000000000000',
        amount,
        timestamp: Date.now(),
        status: 'processing' as const,
        l2TxSignature: 'sig_123',
        challengePeriod: 604800,
        challengeEndTimestamp: Math.floor(Date.now() / 1000) + 604800
      };
      
      when(mockWithdrawalManager.withdrawETH(amount, l1Address, keypair, options)).thenResolve(mockWithdrawalInfo);
      
      const withdrawalInfo = await bridgeManager.withdrawETH(amount, l1Address, keypair, options);
      
      expect(withdrawalInfo).to.deep.equal(mockWithdrawalInfo);
      verify(mockWithdrawalManager.withdrawETH(amount, l1Address, keypair, options)).once();
    });
  });
  
  describe('withdrawToken', () => {
    it('should delegate to WithdrawalManager and return withdrawal info', async () => {
      // Inizializziamo prima il bridge
      when(mockDepositManager.initialize(anything())).thenResolve();
      when(mockWithdrawalManager.initialize(anything())).thenResolve();
      when(mockProofGenerator.initialize(anything())).thenResolve();
      
      await bridgeManager.initialize(bridgeConfig);
      
      const tokenAddress = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC su Solana
      const amount = '1000000'; // 1 USDC (6 decimali)
      const l1Address = '0x1234567890123456789012345678901234567890';
      const keypair = Keypair.generate();
      const options = {
        onProgress: (status: string, data?: any) => {}
      };
      
      const mockWithdrawalInfo = {
        id: 'wit_123',
        fromAddress: keypair.publicKey.toString(),
        toAddress: l1Address,
        tokenAddress: tokenAddress.toString(),
        amount,
        timestamp: Date.now(),
        status: 'processing' as const,
        l2TxSignature: 'sig_123',
        challengePeriod: 604800,
        challengeEndTimestamp: Math.floor(Date.now() / 1000) + 604800
      };
      
      when(mockWithdrawalManager.withdrawToken(tokenAddress, amount, l1Address, keypair, options)).thenResolve(mockWithdrawalInfo);
      
      const withdrawalInfo = await bridgeManager.withdrawToken(tokenAddress, amount, l1Address, keypair, options);
      
      expect(withdrawalInfo).to.deep.equal(mockWithdrawalInfo);
      verify(mockWithdrawalManager.withdrawToken(tokenAddress, amount, l1Address, keypair, options)).once();
    });
  });
  
  describe('generateWithdrawalProof', () => {
    it('should delegate to ProofGenerator and return withdrawal proof', async () => {
      // Inizializziamo prima il bridge
      when(mockDepositManager.initialize(anything())).thenResolve();
      when(mockWithdrawalManager.initialize(anything())).thenResolve();
      when(mockProofGenerator.initialize(anything())).thenResolve();
      
      await bridgeManager.initialize(bridgeConfig);
      
      const withdrawalId = 'wit_123';
      
      const mockProof = {
        withdrawalId,
        fromAddress: '11111111111111111111111111111111',
        toAddress: '0x1234567890123456789012345678901234567890',
        tokenAddress: '0x0000000000000000000000000000000000000000',
        amount: '1000000000000000000',
        stateRoot: '0xabcdef',
        merkleProof: ['0x123', '0x456', '0x789'],
        l2BlockIndex: 12345,
        l2BlockTimestamp: Math.floor(Date.now() / 1000) - 3600,
        l2TxSignature: 'sig_123'
      };
      
      when(mockProofGenerator.generateProof(withdrawalId)).thenResolve(mockProof);
      
      const proof = await bridgeManager.generateWithdrawalProof(withdrawalId);
      
      expect(proof).to.deep.equal(mockProof);
      verify(mockProofGenerator.generateProof(withdrawalId)).once();
    });
  });
  
  describe('finalizeWithdrawal', () => {
    it('should delegate to WithdrawalManager and return transaction hash', async () => {
      // Inizializziamo prima il bridge
      when(mockDepositManager.initialize(anything())).thenResolve();
      when(mockWithdrawalManager.initialize(anything())).thenResolve();
      when(mockProofGenerator.initialize(anything())).thenResolve();
      
      await bridgeManager.initialize(bridgeConfig);
      
      const withdrawalId = 'wit_123';
      const proof = {
        withdrawalId,
        fromAddress: '11111111111111111111111111111111',
        toAddress: '0x1234567890123456789012345678901234567890',
        tokenAddress: '0x0000000000000000000000000000000000000000',
        amount: '1000000000000000000',
        stateRoot: '0xabcdef',
        merkleProof: ['0x123', '0x456', '0x789'],
        l2BlockIndex: 12345,
        l2BlockTimestamp: Math.floor(Date.now() / 1000) - 3600,
        l2TxSignature: 'sig_123'
      };
      
      const mockProvider = {} as ethers.providers.Provider;
      const mockTxHash = '0x0123456789abcdef';
      
      when(mockWithdrawalManager.finalizeWithdrawal(withdrawalId, proof, mockProvider)).thenResolve(mockTxHash);
      
      const txHash = await bridgeManager.finalizeWithdrawal(withdrawalId, proof, mockProvider);
      
      expect(txHash).to.equal(mockTxHash);
      verify(mockWithdrawalManager.finalizeWithdrawal(withdrawalId, proof, mockProvider)).once();
    });
  });
  
  describe('getDepositStatus', () => {
    it('should delegate to DepositManager and return deposit info', async () => {
      // Inizializziamo prima il bridge
      when(mockDepositManager.initialize(anything())).thenResolve();
      when(mockWithdrawalManager.initialize(anything())).thenResolve();
      when(mockProofGenerator.initialize(anything())).thenResolve();
      
      await bridgeManager.initialize(bridgeConfig);
      
      const depositId = 'dep_123';
      
      const mockDepositInfo = {
        id: depositId,
        fromAddress: '0x1234567890123456789012345678901234567890',
        toAddress: '11111111111111111111111111111111',
        tokenAddress: '0x0000000000000000000000000000000000000000',
        amount: '1000000000000000000',
        timestamp: Date.now() - 3600000,
        status: 'completed' as const,
        l1TxHash: '0xabcdef',
        l2TxSignature: 'sig_123'
      };
      
      when(mockDepositManager.getDepositStatus(depositId)).thenResolve(mockDepositInfo);
      
      const depositInfo = await bridgeManager.getDepositStatus(depositId);
      
      expect(depositInfo).to.deep.equal(mockDepositInfo);
      verify(mockDepositManager.getDepositStatus(depositId)).once();
    });
  });
  
  describe('getWithdrawalStatus', () => {
    it('should delegate to WithdrawalManager and return withdrawal info', async () => {
      // Inizializziamo prima il bridge
      when(mockDepositManager.initialize(anything())).thenResolve();
      when(mockWithdrawalManager.initialize(anything())).thenResolve();
      when(mockProofGenerator.initialize(anything())).thenResolve();
      
      await bridgeManager.initialize(bridgeConfig);
      
      const withdrawalId = 'wit_123';
      
      const mockWithdrawalInfo = {
        id: withdrawalId,
        fromAddress: '11111111111111111111111111111111',
        toAddress: '0x1234567890123456789012345678901234567890',
        tokenAddress: '0x0000000000000000000000000000000000000000',
        amount: '1000000000000000000',
        timestamp: Date.now() - 3600000,
        status: 'processing' as const,
        l2TxSignature: 'sig_123',
        challengePeriod: 604800,
        challengeEndTimestamp: Math.floor((Date.now() - 3600000) / 1000) + 604800
      };
      
      when(mockWithdrawalManager.getWithdrawalStatus(withdrawalId)).thenResolve(mockWithdrawalInfo);
      
      const withdrawalInfo = await bridgeManager.getWithdrawalStatus(withdrawalId);
      
      expect(withdrawalInfo).to.deep.equal(mockWithdrawalInfo);
      verify(mockWithdrawalManager.getWithdrawalStatus(withdrawalId)).once();
    });
  });
  
  describe('getDepositsForAddress', () => {
    it('should delegate to DepositManager and return deposits list', async () => {
      // Inizializziamo prima il bridge
      when(mockDepositManager.initialize(anything())).thenResolve();
      when(mockWithdrawalManager.initialize(anything())).thenResolve();
      when(mockProofGenerator.initialize(anything())).thenResolve();
      
      await bridgeManager.initialize(bridgeConfig);
      
      const l2Address = new PublicKey('11111111111111111111111111111111');
      const limit = 10;
      const offset = 0;
      
      const mockDeposits = [
        {
          id: 'dep_1',
          fromAddress: '0x1234567890123456789012345678901234567890',
          toAddress: l2Address.toString(),
          tokenAddress: '0x0000000000000000000000000000000000000000',
          amount: '1000000000000000000',
          timestamp: Date.now() - 86400000,
          status: 'completed' as const,
          l1TxHash: '0xabcdef1',
          l2TxSignature: 'sig_1'
        },
        {
          id: 'dep_2',
          fromAddress: '0x1234567890123456789012345678901234567890',
          toAddress: l2Address.toString(),
          tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          amount: '1000000',
          timestamp: Date.now() - 172800000,
          status: 'completed' as const,
          l1TxHash: '0xabcdef2',
          l2TxSignature: 'sig_2'
        }
      ];
      
      when(mockDepositManager.getDepositsForAddress(l2Address, limit, offset)).thenResolve(mockDeposits);
      
      const deposits = await bridgeManager.getDepositsForAddress(l2Address, limit, offset);
      
      expect(deposits).to.deep.equal(mockDeposits);
      verify(mockDepositManager.getDepositsForAddress(l2Address, limit, offset)).once();
    });
  });
  
  describe('getWithdrawalsForAddress', () => {
    it('should delegate to WithdrawalManager and return withdrawals list', async () => {
      // Inizializziamo prima il bridge
      when(mockDepositManager.initialize(anything())).thenResolve();
      when(mockWithdrawalManager.initialize(anything())).thenResolve();
      when(mockProofGenerator.initialize(anything())).thenResolve();
      
      await bridgeManager.initialize(bridgeConfig);
      
      const l2Address = new PublicKey('11111111111111111111111111111111');
      const limit = 10;
      const offset = 0;
      
      const mockWithdrawals = [
        {
          id: 'wit_1',
          fromAddress: l2Address.toString(),
          toAddress: '0x1234567890123456789012345678901234567890',
          tokenAddress: '0x0000000000000000000000000000000000000000',
          amount: '1000000000000000000',
          timestamp: Date.now() - 86400000,
          status: 'completed' as const,
          l2TxSignature: 'sig_1',
          l1TxHash: '0xabcdef1',
          challengePeriod: 604800,
          challengeEndTimestamp: undefined
        },
        {
          id: 'wit_2',
          fromAddress: l2Address.toString(),
          toAddress: '0x1234567890123456789012345678901234567890',
          tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          amount: '1000000',
          timestamp: Date.now() - 172800000,
          status: 'processing' as const,
          l2TxSignature: 'sig_2',
          challengePeriod: 604800,
          challengeEndTimestamp: Math.floor((Date.now() - 172800000) / 1000) + 604800
        }
      ];
      
      when(mockWithdrawalManager.getWithdrawalsForAddress(l2Address, limit, offset)).thenResolve(mockWithdrawals);
      
      const withdrawals = await bridgeManager.getWithdrawalsForAddress(l2Address, limit, offset);
      
      expect(withdrawals).to.deep.equal(mockWithdrawals);
      verify(mockWithdrawalManager.getWithdrawalsForAddress(l2Address, limit, offset)).once();
    });
  });
});
