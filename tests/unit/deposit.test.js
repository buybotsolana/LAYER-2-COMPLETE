/**
 * Test unitari per il modulo di deposito del Layer-2 su Solana
 * 
 * Questo file contiene i test unitari per verificare il corretto funzionamento
 * del modulo di deposito del Layer-2.
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { ethers } = require('ethers');
const { Layer2Client, TransactionType, TransactionStatus } = require('../../sdk/src/client');
const axios = require('axios');

// Mock dei contratti Ethereum
const mockTokenContract = {
  decimals: sinon.stub().resolves(18),
  balanceOf: sinon.stub().resolves(ethers.utils.parseEther('100')),
  approve: sinon.stub().resolves({
    wait: sinon.stub().resolves({}),
  }),
};

const mockTokenBridge = {
  address: '0x1234567890123456789012345678901234567890',
  deposit: sinon.stub().resolves({
    wait: sinon.stub().resolves({
      blockNumber: 12345,
      blockHash: '0xabcdef1234567890',
      gasUsed: ethers.BigNumber.from('100000'),
      effectiveGasPrice: ethers.BigNumber.from('10000000000'),
      confirmations: 1,
      events: [
        {
          event: 'Deposited',
          args: {
            id: '0x1234567890123456789012345678901234567890123456789012345678901234',
          },
        },
      ],
    }),
  }),
};

// Mock di ethers.Contract
const mockContract = sinon.stub().returns(mockTokenContract);
ethers.Contract = mockContract;

// Mock di axios
const axiosMock = {
  get: sinon.stub(),
  post: sinon.stub(),
};

describe('Deposit Tests', () => {
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
    
    // Assegna il mock del token bridge
    client.tokenBridge = mockTokenBridge;
    
    // Mock di axios
    axios.get = axiosMock.get;
    axios.post = axiosMock.post;
    
    // Configura il mock di axios.get per getAccount
    axiosMock.get.withArgs('https://api.layer2.example.com/accounts/any-address').resolves({
      data: {
        account: {
          address: 'any-address',
          balance: '1000000000',
          nonce: 5,
          lastUpdated: 1619712000,
        },
      },
    });
    
    // Configura il mock di axios.post per transfer
    axiosMock.post.withArgs('https://api.layer2.example.com/transactions').resolves({
      data: {
        transactionId: '0x1234567890123456789012345678901234567890123456789012345678901234',
      },
    });
  });
  
  afterEach(() => {
    // Ripristina i mock
    sinon.restore();
  });
  
  describe('deposit', () => {
    it('should deposit tokens from Ethereum to Solana', async () => {
      // Configura le opzioni di deposito
      const options = {
        token: '0x1234567890123456789012345678901234567890',
        amount: 10,
        recipient: solanaWallet.publicKey.toString(),
      };
      
      // Esegue il deposito
      const result = await client.deposit(options);
      
      // Verifica che il contratto del token sia stato chiamato con i parametri corretti
      expect(mockTokenContract.decimals.calledOnce).to.be.true;
      expect(mockTokenContract.balanceOf.calledWith(ethereumWallet.address)).to.be.true;
      expect(mockTokenContract.approve.calledWith(
        mockTokenBridge.address,
        ethers.utils.parseEther('10')
      )).to.be.true;
      
      // Verifica che il token bridge sia stato chiamato con i parametri corretti
      expect(mockTokenBridge.deposit.calledWith(
        options.token,
        ethers.utils.parseEther('10'),
        sinon.match.any
      )).to.be.true;
      
      // Verifica il risultato
      expect(result).to.deep.include({
        transactionId: '0x1234567890123456789012345678901234567890123456789012345678901234',
        blockNumber: 12345,
        blockHash: '0xabcdef1234567890',
        status: TransactionStatus.CONFIRMED,
        confirmations: 1,
      });
    });
    
    it('should throw an error if Ethereum wallet is not connected', async () => {
      // Rimuove il wallet Ethereum
      delete client.ethereumWallet;
      delete client.tokenBridge;
      
      // Configura le opzioni di deposito
      const options = {
        token: '0x1234567890123456789012345678901234567890',
        amount: 10,
        recipient: solanaWallet.publicKey.toString(),
      };
      
      // Verifica che venga lanciato un errore
      await expect(client.deposit(options)).to.be.rejectedWith('Ethereum wallet or token bridge not configured');
    });
    
    it('should throw an error if token address is invalid', async () => {
      // Configura le opzioni di deposito con un indirizzo di token non valido
      const options = {
        token: 'invalid-token-address',
        amount: 10,
        recipient: solanaWallet.publicKey.toString(),
      };
      
      // Verifica che venga lanciato un errore
      await expect(client.deposit(options)).to.be.rejectedWith('Invalid token address');
    });
    
    it('should throw an error if recipient address is invalid', async () => {
      // Configura le opzioni di deposito con un indirizzo di destinatario non valido
      const options = {
        token: '0x1234567890123456789012345678901234567890',
        amount: 10,
        recipient: 'invalid-recipient-address',
      };
      
      // Verifica che venga lanciato un errore
      await expect(client.deposit(options)).to.be.rejectedWith('Invalid recipient address');
    });
    
    it('should throw an error if amount is not positive', async () => {
      // Configura le opzioni di deposito con un importo non positivo
      const options = {
        token: '0x1234567890123456789012345678901234567890',
        amount: 0,
        recipient: solanaWallet.publicKey.toString(),
      };
      
      // Modifica il mock per simulare un importo non positivo
      mockTokenContract.decimals.resolves(18);
      
      // Verifica che venga lanciato un errore
      await expect(client.deposit(options)).to.be.rejectedWith('Amount must be positive');
    });
    
    it('should throw an error if balance is insufficient', async () => {
      // Configura le opzioni di deposito
      const options = {
        token: '0x1234567890123456789012345678901234567890',
        amount: 1000,
        recipient: solanaWallet.publicKey.toString(),
      };
      
      // Modifica il mock per simulare un saldo insufficiente
      mockTokenContract.balanceOf.resolves(ethers.utils.parseEther('10'));
      
      // Verifica che venga lanciato un errore
      await expect(client.deposit(options)).to.be.rejectedWith('Insufficient balance');
    });
  });
});

describe('Transfer Tests', () => {
  let client;
  let solanaWallet;
  
  beforeEach(() => {
    // Reset dei mock
    sinon.reset();
    
    // Configurazione del client
    client = new Layer2Client({
      solanaRpcUrl: 'https://api.devnet.solana.com',
      programId: 'Layer2ProgramId11111111111111111111111111111111',
      layer2ApiUrl: 'https://api.layer2.example.com',
    });
    
    // Mock del wallet Solana
    solanaWallet = Keypair.generate();
    
    // Assegna il wallet al client
    client.solanaWallet = solanaWallet;
    
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
    
    // Configura il mock di axios.post per transfer
    axiosMock.post.withArgs('https://api.layer2.example.com/transactions').resolves({
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
  
  describe('transfer', () => {
    it('should transfer tokens within Layer-2', async () => {
      // Configura le opzioni di trasferimento
      const recipientKeypair = Keypair.generate();
      const options = {
        token: new PublicKey(Buffer.alloc(32)).toString(),
        amount: 10,
        recipient: recipientKeypair.publicKey.toString(),
        memo: 'Test transfer',
      };
      
      // Esegue il trasferimento
      const result = await client.transfer(options);
      
      // Verifica che axios.post sia stato chiamato con i parametri corretti
      expect(axiosMock.post.calledWith(
        'https://api.layer2.example.com/transactions',
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
      
      // Configura le opzioni di trasferimento
      const recipientKeypair = Keypair.generate();
      const options = {
        token: new PublicKey(Buffer.alloc(32)).toString(),
        amount: 10,
        recipient: recipientKeypair.publicKey.toString(),
      };
      
      // Verifica che venga lanciato un errore
      await expect(client.transfer(options)).to.be.rejectedWith('Solana wallet not connected');
    });
    
    it('should throw an error if token address is invalid', async () => {
      // Configura le opzioni di trasferimento con un indirizzo di token non valido
      const recipientKeypair = Keypair.generate();
      const options = {
        token: 'invalid-token-address',
        amount: 10,
        recipient: recipientKeypair.publicKey.toString(),
      };
      
      // Verifica che venga lanciato un errore
      await expect(client.transfer(options)).to.be.rejectedWith('Invalid token address');
    });
    
    it('should throw an error if recipient address is invalid', async () => {
      // Configura le opzioni di trasferimento con un indirizzo di destinatario non valido
      const options = {
        token: new PublicKey(Buffer.alloc(32)).toString(),
        amount: 10,
        recipient: 'invalid-recipient-address',
      };
      
      // Verifica che venga lanciato un errore
      await expect(client.transfer(options)).to.be.rejectedWith('Invalid recipient address');
    });
    
    it('should throw an error if amount is not positive', async () => {
      // Configura le opzioni di trasferimento con un importo non positivo
      const recipientKeypair = Keypair.generate();
      const options = {
        token: new PublicKey(Buffer.alloc(32)).toString(),
        amount: 0,
        recipient: recipientKeypair.publicKey.toString(),
      };
      
      // Verifica che venga lanciato un errore
      await expect(client.transfer(options)).to.be.rejectedWith('Amount must be positive');
    });
  });
});

describe('Withdrawal Tests', () => {
  let client;
  let solanaWallet;
  
  beforeEach(() => {
    // Reset dei mock
    sinon.reset();
    
    // Configurazione del client
    client = new Layer2Client({
      solanaRpcUrl: 'https://api.devnet.solana.com',
      programId: 'Layer2ProgramId11111111111111111111111111111111',
      layer2ApiUrl: 'https://api.layer2.example.com',
    });
    
    // Mock del wallet Solana
    solanaWallet = Keypair.generate();
    
    // Assegna il wallet al client
    client.solanaWallet = solanaWallet;
    
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
});
