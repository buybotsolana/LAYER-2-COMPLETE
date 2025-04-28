import React, { useState } from 'react';
import { WalletAdapterFactory } from 'layer2-solana-sdk';
import './WalletConnect.css';

function WalletConnect({ onConnect, loading, error }) {
  const [selectedWallet, setSelectedWallet] = useState(null);
  
  // Ottieni la lista dei wallet supportati
  const supportedWallets = WalletAdapterFactory.getSupportedWallets();
  
  // Gestisce la selezione di un wallet
  const handleWalletSelect = (walletName) => {
    setSelectedWallet(walletName);
  };
  
  // Gestisce la connessione al wallet selezionato
  const handleConnect = () => {
    if (selectedWallet) {
      onConnect(selectedWallet);
    }
  };
  
  // Verifica se il wallet è installato
  const isWalletInstalled = (walletName) => {
    return WalletAdapterFactory.isWalletInstalled(walletName);
  };
  
  return (
    <div className="wallet-connect">
      <h2>Connetti il tuo wallet</h2>
      <p>Seleziona un wallet per iniziare a utilizzare il bridge Layer-2 Solana.</p>
      
      <div className="wallet-list">
        {supportedWallets.map((wallet) => (
          <div 
            key={wallet.name.toLowerCase()} 
            className={`wallet-option ${selectedWallet === wallet.name.toLowerCase() ? 'selected' : ''}`}
            onClick={() => handleWalletSelect(wallet.name.toLowerCase())}
          >
            <img src={wallet.icon} alt={wallet.name} />
            <span>{wallet.name}</span>
            {!isWalletInstalled(wallet.name.toLowerCase()) && (
              <span className="not-installed">Non installato</span>
            )}
          </div>
        ))}
      </div>
      
      <button 
        className="connect-button" 
        onClick={handleConnect} 
        disabled={!selectedWallet || loading || !isWalletInstalled(selectedWallet)}
      >
        {loading ? 'Connessione in corso...' : 'Connetti'}
      </button>
      
      {error && <div className="error-message">{error}</div>}
      
      <div className="wallet-instructions">
        <h3>Non hai un wallet?</h3>
        <p>Installa uno dei wallet supportati per utilizzare il bridge:</p>
        <ul>
          <li>
            <a href="https://phantom.app/" target="_blank" rel="noopener noreferrer">
              Phantom Wallet
            </a>
          </li>
          <li>
            <a href="https://www.backpack.app/" target="_blank" rel="noopener noreferrer">
              Backpack Wallet
            </a>
          </li>
          <li>
            <a href="https://metamask.io/" target="_blank" rel="noopener noreferrer">
              MetaMask
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}

export default WalletConnect;
