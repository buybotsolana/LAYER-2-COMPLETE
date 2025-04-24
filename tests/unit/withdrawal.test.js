/**
 * Test unitari per il modulo di prelievo del Layer-2 su Solana
 * 
 * Questo file contiene i test unitari per verificare il corretto funzionamento
 * del modulo di prelievo del Layer-2.
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { ethers } = require('ethers');
const { Layer2Client, TransactionType, TransactionStatus } = require('../../sdk/src/client');
const axios = require('axios');

// Mock dei contratti Ethereum
const mockWithdrawalBridge = {
  address: '0x0987654321098765432109876543210987654321',
  confirmWithdrawal: sinon.stub().resolves({
    wait: sinon.stub().resolves({
      blockNumber: 12345,
      blockHash: '0xabcdef1234567890',
      gasUsed: ethers.BigNumber.from('100000'),
      effectiveGasPrice: ethers.BigNumber.from('10000000000'),
      confirmations: 1,
      events: [
        {
          event: 'WithdrawalConfirmed',
          args: {
            id: '0x1234567890123456789012345678901234567890123456789012345678901234',
          },
        },
      ],
    }),
  }),
  processWithdrawal: sinon.stub().resolves({
    wait: sinon.stub().resolves({
      blockNumber: 12345,
      blockHash: '0xabcdef1234567890',
      gasUsed: ethers.BigNumber.from('100000'),
      effectiveGasPrice: ethers.BigNumber.from('10000000000'),
      confirmations: 1,
      events: [
        {
          event: 'WithdrawalProcessed',
          args: {
            id: '0x1234567890123456789012345678901234567890123456789012345678901234',
            token: '0x1234567890123456789012345678901234567890',
            recipient: '0xabcdef1234567890abcdef1234567890abcdef12',
            amount: ethers.utils.parseEther('10'),
          },
        },
      ],
    }),
  }),
  verifyWithdrawalProof: sinon.stub().resolves(true),
};

// Mock di axios
const axiosMock = {
  get: sinon.stub(),
  post: sinon.stub(),
};

describe('Withdrawal Tests', () => {
  let client;
  let ethereumWallet;
  let solanaWallet;
  
  beforeEach(() => {
    // Reset dei mock
    sinon.reset();
    
    // Configurazione del client
    client = new Layer2Client({
      solanaRpcUrl: 'https://api.devnet.solana.com',
      programId: 'Layer2ProgramId11111111111111111111111111111111',
      ethereumRpcUrl: 'https://rinkeby.infura.io/v3/your-api-key',
      tokenBridgeAddress: '0x1234567890123456789012345678901234567890',
      withdrawalBridgeAddress: '0x0987654321098765432109876543210987654321',
      layer2ApiUrl: 'https://api.layer2.example.com',
    });
    
    // Mock del wallet Ethereum
    ethereumWallet = {
      address: '0xabcdef1234567890abcdef1234567890abcdef12',
    };
    
    // Mock del wallet Solana
    solanaWallet = Keypair.generate();
    
    // Assegna i wallet al client
    client.ethereumWallet = ethereumWallet;
    client.solanaWallet = solanaWallet;
    
    // Assegna il mock del withdrawal bridge
    client.withdrawalBridge = mockWithdrawalBridge;
    
    // Mock di axios
    axios.get = axiosMock.get;
    axios.post = axiosMock.post;
    
    // Configura il mock di axios.get per getAccount
    axiosMock.get.withArgs(`https://api.layer2.example.com/accounts/${solanaWallet.publicKey.toString()}`).resolves({
      data: {
        account: {
          address: solanaWallet.publicKey.toString(),
          balance: '1000000000',
          nonce: 5,
          lastUpdated: 1619712000,
        },
      },
    });
    
    // Configura il mock di axios.post per withdrawal
    axiosMock.post.withArgs('https://api.layer2.example.com/withdrawals').resolves({
      data: {
        transactionId: '0x1234567890123456789012345678901234567890123456789012345678901234',
      },
    });
    
    // Mock della funzione di firma
    client.signTransaction = sinon.stub().resolves(Buffer.from('signature'));
  });
  
  afterEach(() => {
    // Ripristina i mock
    sinon.restore();
  });
  
  describe('withdraw', () => {
    it('should withdraw tokens from Solana to Ethereum', async () => {
      // Configura le opzioni di prelievo
      const options = {
        token: new PublicKey(Buffer.alloc(32)).toString(),
        amount: 10,
        recipient: '0x1234567890123456789012345678901234567890',
      };
      
      // Esegue il prelievo
      const result = await client.withdraw(options);
      
      // Verifica che axios.post sia stato chiamato con i parametri corretti
      expect(axiosMock.post.calledWith(
        'https://api.layer2.example.com/withdrawals',
        sinon.match.object
      )).to.be.true;
      
      // Verifica che la transazione sia stata firmata
      expect(client.signTransaction.calledOnce).to.be.true;
      
      // Verifica il risultato
      expect(result).to.deep.include({
        transactionId: '0x1234567890123456789012345678901234567890123456789012345678901234',
        status: TransactionStatus.PENDING,
        confirmations: 0,
      });
    });
    
    it('should throw an error if Solana wallet is not connected', async () => {
      // Rimuove il wallet Solana
      delete client.solanaWallet;
      
      // Configura le opzioni di prelievo
      const options = {
        token: new PublicKey(Buffer.alloc(32)).toString(),
        amount: 10,
        recipient: '0x1234567890123456789012345678901234567890',
      };
      
      // Verifica che venga lanciato un errore
      await expect(client.withdraw(options)).to.be.rejectedWith('Solana wallet not connected');
    });
    
    it('should throw an error if token address is invalid', async () => {
      // Configura le opzioni di prelievo con un indirizzo di token non valido
      const options = {
        token: 'invalid-token-address',
        amount: 10,
        recipient: '0x1234567890123456789012345678901234567890',
      };
      
      // Verifica che venga lanciato un errore
      await expect(client.withdraw(options)).to.be.rejectedWith('Invalid token address');
    });
    
    it('should throw an error if recipient address is invalid', async () => {
      // Configura le opzioni di prelievo con un indirizzo di destinatario non valido
      const options = {
        token: new PublicKey(Buffer.alloc(32)).toString(),
        amount: 10,
        recipient: 'invalid-recipient-address',
      };
      
      // Verifica che venga lanciato un errore
      await expect(client.withdraw(options)).to.be.rejectedWith('Invalid recipient address');
    });
    
    it('should throw an error if amount is not positive', async () => {
      // Configura le opzioni di prelievo con un importo non positivo
      const options = {
        token: new PublicKey(Buffer.alloc(32)).toString(),
        amount: 0,
        recipient: '0x1234567890123456789012345678901234567890',
      };
      
      // Verifica che venga lanciato un errore
      await expect(client.withdraw(options)).to.be.rejectedWith('Amount must be positive');
    });
  });
  
  describe('confirmWithdrawal', () => {
    it('should confirm a withdrawal as a validator', async () => {
      // Configura il client come validatore
      client.isValidator = true;
      
      // ID del prelievo
      const withdrawalId = '0x1234567890123456789012345678901234567890123456789012345678901234';
      
      // Conferma il prelievo
      const result = await client.confirmWithdrawal(withdrawalId);
      
      // Verifica che il withdrawal bridge sia stato chiamato con i parametri corretti
      expect(mockWithdrawalBridge.confirmWithdrawal.calledWith(withdrawalId)).to.be.true;
      
      // Verifica il risultato
      expect(result).to.deep.include({
        transactionId: withdrawalId,
        blockNumber: 12345,
        blockHash: '0xabcdef1234567890',
        status: TransactionStatus.CONFIRMED,
        confirmations: 1,
      });
    });
    
    it('should throw an error if not a validator', async () => {
      // Configura il client come non validatore
      client.isValidator = false;
      
      // ID del prelievo
      const withdrawalId = '0x1234567890123456789012345678901234567890123456789012345678901234';
      
      // Verifica che venga lanciato un errore
      await expect(client.confirmWithdrawal(withdrawalId)).to.be.rejectedWith('Not authorized as validator');
    });
    
    it('should throw an error if withdrawal ID is invalid', async () => {
      // Configura il client come validatore
      client.isValidator = true;
      
      // ID del prelievo non valido
      const withdrawalId = 'invalid-withdrawal-id';
      
      // Verifica che venga lanciato un errore
      await expect(client.confirmWithdrawal(withdrawalId)).to.be.rejectedWith('Invalid withdrawal ID');
    });
  });
  
  describe('processWithdrawal', () => {
    it('should process a withdrawal as a validator', async () => {
      // Configura il client come validatore
      client.isValidator = true;
      
      // ID del prelievo
      const withdrawalId = '0x1234567890123456789012345678901234567890123456789012345678901234';
      
      // Processa il prelievo
      const result = await client.processWithdrawal(withdrawalId);
      
      // Verifica che il withdrawal bridge sia stato chiamato con i parametri corretti
      expect(mockWithdrawalBridge.processWithdrawal.calledWith(withdrawalId)).to.be.true;
      
      // Verifica il risultato
      expect(result).to.deep.include({
        transactionId: withdrawalId,
        blockNumber: 12345,
        blockHash: '0xabcdef1234567890',
        status: TransactionStatus.CONFIRMED,
        confirmations: 1,
      });
    });
    
    it('should throw an error if not a validator', async () => {
      // Configura il client come non validatore
      client.isValidator = false;
      
      // ID del prelievo
      const withdrawalId = '0x1234567890123456789012345678901234567890123456789012345678901234';
      
      // Verifica che venga lanciato un errore
      await expect(client.processWithdrawal(withdrawalId)).to.be.rejectedWith('Not authorized as validator');
    });
    
    it('should throw an error if withdrawal ID is invalid', async () => {
      // Configura il client come validatore
      client.isValidator = true;
      
      // ID del prelievo non valido
      const withdrawalId = 'invalid-withdrawal-id';
      
      // Verifica che venga lanciato un errore
      await expect(client.processWithdrawal(withdrawalId)).to.be.rejectedWith('Invalid withdrawal ID');
    });
  });
  
  describe('verifyWithdrawalProof', () => {
    it('should verify a withdrawal proof', async () => {
      // ID del prelievo
      const withdrawalId = '0x1234567890123456789012345678901234567890123456789012345678901234';
      
      // Prova di Merkle
      const proof = [
        '0x1111111111111111111111111111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222222222222222222222222222',
      ];
      
      // Verifica la prova
      const result = await client.verifyWithdrawalProof(withdrawalId, proof);
      
      // Verifica che il withdrawal bridge sia stato chiamato con i parametri corretti
      expect(mockWithdrawalBridge.verifyWithdrawalProof.calledWith(withdrawalId, proof)).to.be.true;
      
      // Verifica il risultato
      expect(result).to.be.true;
    });
    
    it('should throw an error if withdrawal ID is invalid', async () => {
      // ID del prelievo non valido
      const withdrawalId = 'invalid-withdrawal-id';
      
      // Prova di Merkle
      const proof = [
        '0x1111111111111111111111111111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222222222222222222222222222',
      ];
      
      // Verifica che venga lanciato un errore
      await expect(client.verifyWithdrawalProof(withdrawalId, proof)).to.be.rejectedWith('Invalid withdrawal ID');
    });
    
    it('should throw an error if proof is invalid', async () => {
      // ID del prelievo
      const withdrawalId = '0x1234567890123456789012345678901234567890123456789012345678901234';
      
      // Prova di Merkle non valida
      const proof = ['invalid-proof'];
      
      // Verifica che venga lanciato un errore
      await expect(client.verifyWithdrawalProof(withdrawalId, proof)).to.be.rejectedWith('Invalid Merkle proof');
    });
  });
  
  describe('getWithdrawalStatus', () => {
    it('should get the status of a withdrawal', async () => {
      // ID del prelievo
      const withdrawalId = '0x1234567890123456789012345678901234567890123456789012345678901234';
      
      // Configura il mock di axios.get per getWithdrawal
      axiosMock.get.withArgs(`https://api.layer2.example.com/withdrawals/${withdrawalId}`).resolves({
        data: {
          withdrawal: {
            id: withdrawalId,
            token: '0x1234567890123456789012345678901234567890',
            recipient: '0xabcdef1234567890abcdef1234567890abcdef12',
            amount: '10000000000000000000',
            status: TransactionStatus.CONFIRMED,
            timestamp: 1619712000,
            confirmations: 5,
          },
        },
      });
      
      // Ottiene lo stato del prelievo
      const status = await client.getWithdrawalStatus(withdrawalId);
      
      // Verifica che axios.get sia stato chiamato con i parametri corretti
      expect(axiosMock.get.calledWith(`https://api.layer2.example.com/withdrawals/${withdrawalId}`)).to.be.true;
      
      // Verifica il risultato
      expect(status).to.equal(TransactionStatus.CONFIRMED);
    });
    
    it('should throw an error if withdrawal ID is invalid', async () => {
      // ID del prelievo non valido
      const withdrawalId = 'invalid-withdrawal-id';
      
      // Verifica che venga lanciato un errore
      await expect(client.getWithdrawalStatus(withdrawalId)).to.be.rejectedWith('Invalid withdrawal ID');
    });
    
    it('should throw an error if withdrawal is not found', async () => {
      // ID del prelievo
      const withdrawalId = '0x1234567890123456789012345678901234567890123456789012345678901234';
      
      // Configura il mock di axios.get per lanciare un errore 404
      axiosMock.get.withArgs(`https://api.layer2.example.com/withdrawals/${withdrawalId}`).rejects({
        response: {
          status: 404,
        },
      });
      
      // Verifica che venga lanciato un errore
      await expect(client.getWithdrawalStatus(withdrawalId)).to.be.rejectedWith('Withdrawal not found');
    });
  });
  
  describe('getWithdrawalsByAccount', () => {
    it('should get withdrawals by account', async () => {
      // Indirizzo dell'account
      const address = '0xabcdef1234567890abcdef1234567890abcdef12';
      
      // Configura il mock di axios.get per getWithdrawalsByAccount
      axiosMock.get.withArgs(`https://api.layer2.example.com/accounts/${address}/withdrawals`).resolves({
        data: {
          withdrawals: [
            {
              id: '0x1111111111111111111111111111111111111111111111111111111111111111',
              token: '0x1234567890123456789012345678901234567890',
              recipient: address,
              amount: '10000000000000000000',
              status: TransactionStatus.CONFIRMED,
              timestamp: 1619712000,
              confirmations: 5,
            },
            {
              id: '0x2222222222222222222222222222222222222222222222222222222222222222',
              token: '0x1234567890123456789012345678901234567890',
              recipient: address,
              amount: '20000000000000000000',
              status: TransactionStatus.PENDING,
              timestamp: 1619712100,
              confirmations: 0,
            },
          ],
        },
      });
      
      // Ottiene i prelievi dell'account
      const withdrawals = await client.getWithdrawalsByAccount(address);
      
      // Verifica che axios.get sia stato chiamato con i parametri corretti
      expect(axiosMock.get.calledWith(`https://api.layer2.example.com/accounts/${address}/withdrawals`)).to.be.true;
      
      // Verifica il risultato
      expect(withdrawals).to.be.an('array').with.lengthOf(2);
      expect(withdrawals[0].id).to.equal('0x1111111111111111111111111111111111111111111111111111111111111111');
      expect(withdrawals[0].status).to.equal(TransactionStatus.CONFIRMED);
      expect(withdrawals[1].id).to.equal('0x2222222222222222222222222222222222222222222222222222222222222222');
      expect(withdrawals[1].status).to.equal(TransactionStatus.PENDING);
    });
    
    it('should throw an error if address is invalid', async () => {
      // Indirizzo non valido
      const address = 'invalid-address';
      
      // Verifica che venga lanciato un errore
      await expect(client.getWithdrawalsByAccount(address)).to.be.rejectedWith('Invalid address');
    });
    
    it('should return an empty array if no withdrawals are found', async () => {
      // Indirizzo dell'account
      const address = '0xabcdef1234567890abcdef1234567890abcdef12';
      
      // Configura il mock di axios.get per restituire un array vuoto
      axiosMock.get.withArgs(`https://api.layer2.example.com/accounts/${address}/withdrawals`).resolves({
        data: {
          withdrawals: [],
        },
      });
      
      // Ottiene i prelievi dell'account
      const withdrawals = await client.getWithdrawalsByAccount(address);
      
      // Verifica che axios.get sia stato chiamato con i parametri corretti
      expect(axiosMock.get.calledWith(`https://api.layer2.example.com/accounts/${address}/withdrawals`)).to.be.true;
      
      // Verifica il risultato
      expect(withdrawals).to.be.an('array').that.is.empty;
    });
  });
});
