import React, { useState, useEffect } from 'react';
import { createL2Client, WalletAdapterFactory } from 'layer2-solana-sdk';
import { PublicKey } from '@solana/web3.js';
import './App.css';

// Componenti
import Header from './components/Header';
import WalletConnect from './components/WalletConnect';
import AssetList from './components/AssetList';
import BridgeForm from './components/BridgeForm';
import TransactionHistory from './components/TransactionHistory';
import Footer from './components/Footer';

// Configurazione
const BRIDGE_CONFIG = {
  l1BridgeAddress: '0x1234567890123456789012345678901234567890',
  l2BridgeAddress: '11111111111111111111111111111111',
  challengePeriod: 604800, // 7 giorni in secondi
  supportedTokens: {
    '0x0000000000000000000000000000000000000000': 'So11111111111111111111111111111111111111111', // ETH -> Wrapped SOL
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC -> USDC
    '0x6B175474E89094C44Da98b954EedeAC495271d0F': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'  // DAI -> DAI
  }
};

function App() {
  // Stato
  const [client, setClient] = useState(null);
  const [walletAdapter, setWalletAdapter] = useState(null);
  const [connected, setConnected] = useState(false);
  const [publicKey, setPublicKey] = useState(null);
  const [assets, setAssets] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('deposit'); // 'deposit' o 'withdraw'

  // Inizializzazione del client
  useEffect(() => {
    const initClient = async () => {
      try {
        // Crea il client per l'ambiente di sviluppo
        const l2Client = createL2Client('https://api.devnet.solana.com');
        
        // Inizializza il bridge
        await l2Client.bridge().initialize(BRIDGE_CONFIG);
        
        setClient(l2Client);
      } catch (err) {
        console.error('Errore durante l\'inizializzazione del client:', err);
        setError('Impossibile connettersi alla rete Solana. Riprova più tardi.');
      }
    };

    initClient();
  }, []);

  // Connessione al wallet
  const connectWallet = async (walletName) => {
    try {
      setLoading(true);
      setError(null);

      // Crea l'adapter per il wallet selezionato
      const adapter = WalletAdapterFactory.createAdapter(walletName);
      
      // Connetti il wallet
      await adapter.connect();
      
      // Imposta l'adapter nel client
      client.setWalletAdapter(adapter);
      
      setWalletAdapter(adapter);
      setConnected(adapter.connected);
      setPublicKey(adapter.publicKey);
      
      // Carica gli asset e le transazioni
      if (adapter.connected) {
        loadAssets(adapter.publicKey);
        loadTransactions(adapter.publicKey);
      }
    } catch (err) {
      console.error('Errore durante la connessione al wallet:', err);
      setError(`Impossibile connettersi al wallet ${walletName}. ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Disconnessione dal wallet
  const disconnectWallet = async () => {
    try {
      if (walletAdapter) {
        await walletAdapter.disconnect();
        setConnected(false);
        setPublicKey(null);
        setAssets([]);
        setTransactions([]);
      }
    } catch (err) {
      console.error('Errore durante la disconnessione dal wallet:', err);
    }
  };

  // Caricamento degli asset
  const loadAssets = async (address) => {
    try {
      setLoading(true);
      
      // Ottieni il saldo SOL
      const solBalance = await client.account().getBalance(address);
      
      // Ottieni i saldi dei token
      const assets = [
        {
          symbol: 'SOL',
          name: 'Solana',
          balance: solBalance / 1e9, // Converti da lamports a SOL
          address: 'native',
          icon: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png'
        }
      ];
      
      // Aggiungi altri token (in un'app reale, questi sarebbero caricati dinamicamente)
      // Per semplicità, aggiungiamo solo USDC e DAI come esempio
      assets.push({
        symbol: 'USDC',
        name: 'USD Coin',
        balance: 0, // In un'app reale, questo sarebbe il saldo effettivo
        address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        icon: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png'
      });
      
      assets.push({
        symbol: 'DAI',
        name: 'Dai Stablecoin',
        balance: 0, // In un'app reale, questo sarebbe il saldo effettivo
        address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        icon: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/FYpdBuyAHSbdaAyD1sKkxyLWbAP8uUW9h6uvdhK74ij1/logo.png'
      });
      
      setAssets(assets);
    } catch (err) {
      console.error('Errore durante il caricamento degli asset:', err);
      setError('Impossibile caricare gli asset. Riprova più tardi.');
    } finally {
      setLoading(false);
    }
  };

  // Caricamento delle transazioni
  const loadTransactions = async (address) => {
    try {
      setLoading(true);
      
      // Ottieni i depositi
      const deposits = await client.bridge().getDepositsForAddress(address, 10, 0);
      
      // Ottieni i prelievi
      const withdrawals = await client.bridge().getWithdrawalsForAddress(address, 10, 0);
      
      // Combina e ordina per timestamp (più recenti prima)
      const allTransactions = [...deposits, ...withdrawals].sort((a, b) => b.timestamp - a.timestamp);
      
      setTransactions(allTransactions);
    } catch (err) {
      console.error('Errore durante il caricamento delle transazioni:', err);
      setError('Impossibile caricare la cronologia delle transazioni. Riprova più tardi.');
    } finally {
      setLoading(false);
    }
  };

  // Esecuzione di un deposito
  const executeDeposit = async (tokenAddress, amount, l2Address) => {
    try {
      setLoading(true);
      setError(null);
      
      let depositInfo;
      
      // Controlla se è ETH o un token ERC20
      if (tokenAddress === '0x0000000000000000000000000000000000000000') {
        // Deposito di ETH
        depositInfo = await client.bridge().depositETH(
          amount,
          new PublicKey(l2Address),
          {
            onProgress: (status, data) => {
              console.log(`Deposito ETH: ${status}`, data);
            }
          }
        );
      } else {
        // Deposito di token ERC20
        depositInfo = await client.bridge().depositERC20(
          tokenAddress,
          amount,
          new PublicKey(l2Address),
          {
            onProgress: (status, data) => {
              console.log(`Deposito token: ${status}`, data);
            }
          }
        );
      }
      
      // Aggiorna la lista delle transazioni
      loadTransactions(publicKey);
      
      // Aggiorna gli asset
      loadAssets(publicKey);
      
      return depositInfo;
    } catch (err) {
      console.error('Errore durante il deposito:', err);
      setError(`Impossibile completare il deposito. ${err.message}`);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // Esecuzione di un prelievo
  const executeWithdrawal = async (tokenAddress, amount, l1Address) => {
    try {
      setLoading(true);
      setError(null);
      
      let withdrawalInfo;
      
      // Controlla se è SOL o un token SPL
      if (tokenAddress === 'native') {
        // Prelievo di SOL
        withdrawalInfo = await client.bridge().withdrawETH(
          amount,
          l1Address,
          null, // In un'app reale, qui andrebbe la keypair o la firma del wallet
          {
            onProgress: (status, data) => {
              console.log(`Prelievo SOL: ${status}`, data);
            }
          }
        );
      } else {
        // Prelievo di token SPL
        withdrawalInfo = await client.bridge().withdrawToken(
          new PublicKey(tokenAddress),
          amount,
          l1Address,
          null, // In un'app reale, qui andrebbe la keypair o la firma del wallet
          {
            onProgress: (status, data) => {
              console.log(`Prelievo token: ${status}`, data);
            }
          }
        );
      }
      
      // Aggiorna la lista delle transazioni
      loadTransactions(publicKey);
      
      // Aggiorna gli asset
      loadAssets(publicKey);
      
      return withdrawalInfo;
    } catch (err) {
      console.error('Errore durante il prelievo:', err);
      setError(`Impossibile completare il prelievo. ${err.message}`);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <Header />
      
      <main className="main-content">
        {!connected ? (
          <WalletConnect 
            onConnect={connectWallet} 
            loading={loading} 
            error={error} 
          />
        ) : (
          <>
            <div className="wallet-info">
              <h2>Wallet connesso</h2>
              <p>Indirizzo: {publicKey}</p>
              <button onClick={disconnectWallet}>Disconnetti</button>
            </div>
            
            <AssetList assets={assets} loading={loading} />
            
            <div className="bridge-container">
              <div className="tabs">
                <button 
                  className={activeTab === 'deposit' ? 'active' : ''} 
                  onClick={() => setActiveTab('deposit')}
                >
                  Deposita
                </button>
                <button 
                  className={activeTab === 'withdraw' ? 'active' : ''} 
                  onClick={() => setActiveTab('withdraw')}
                >
                  Preleva
                </button>
              </div>
              
              <BridgeForm 
                type={activeTab} 
                assets={assets} 
                onDeposit={executeDeposit} 
                onWithdraw={executeWithdrawal} 
                loading={loading} 
                error={error} 
              />
            </div>
            
            <TransactionHistory transactions={transactions} loading={loading} />
          </>
        )}
      </main>
      
      <Footer />
    </div>
  );
}

export default App;
