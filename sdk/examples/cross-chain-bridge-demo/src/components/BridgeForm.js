import React, { useState, useEffect } from 'react';
import './BridgeForm.css';

function BridgeForm({ type, assets, onDeposit, onWithdraw, loading, error }) {
  // Stato del form
  const [selectedAsset, setSelectedAsset] = useState('');
  const [amount, setAmount] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState(false);
  const [transaction, setTransaction] = useState(null);

  // Reset del form quando cambia il tipo (deposit/withdraw)
  useEffect(() => {
    setSelectedAsset('');
    setAmount('');
    setDestinationAddress('');
    setFormError('');
    setSuccess(false);
    setTransaction(null);
  }, [type]);

  // Validazione del form
  const validateForm = () => {
    if (!selectedAsset) {
      setFormError('Seleziona un asset');
      return false;
    }

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      setFormError('Inserisci un importo valido');
      return false;
    }

    if (!destinationAddress) {
      setFormError('Inserisci un indirizzo di destinazione');
      return false;
    }

    // Validazione specifica per deposito (indirizzo Solana)
    if (type === 'deposit' && !destinationAddress.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)) {
      setFormError('Indirizzo Solana non valido');
      return false;
    }

    // Validazione specifica per prelievo (indirizzo Ethereum)
    if (type === 'withdraw' && !destinationAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      setFormError('Indirizzo Ethereum non valido');
      return false;
    }

    setFormError('');
    return true;
  };

  // Gestione del submit del form
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    try {
      let result;
      
      if (type === 'deposit') {
        // Esegui deposito
        const asset = assets.find(a => a.address === selectedAsset);
        const tokenAddress = asset.symbol === 'ETH' 
          ? '0x0000000000000000000000000000000000000000' 
          : getEthereumTokenAddress(asset.symbol);
        
        result = await onDeposit(
          tokenAddress,
          convertToSmallestUnit(amount, asset.symbol),
          destinationAddress
        );
      } else {
        // Esegui prelievo
        result = await onWithdraw(
          selectedAsset,
          convertToSmallestUnit(amount, getAssetSymbolByAddress(selectedAsset, assets)),
          destinationAddress
        );
      }
      
      setSuccess(true);
      setTransaction(result);
    } catch (err) {
      setFormError(err.message || 'Si è verificato un errore durante l\'operazione');
    }
  };

  // Converti l'importo nell'unità più piccola (wei, lamports, ecc.)
  const convertToSmallestUnit = (amount, symbol) => {
    const value = parseFloat(amount);
    
    switch (symbol) {
      case 'ETH':
        return (value * 1e18).toString(); // Wei
      case 'SOL':
        return (value * 1e9).toString(); // Lamports
      case 'USDC':
      case 'DAI':
        return (value * 1e6).toString(); // 6 decimali
      default:
        return (value * 1e9).toString(); // Default a 9 decimali
    }
  };

  // Ottieni l'indirizzo Ethereum di un token dato il simbolo
  const getEthereumTokenAddress = (symbol) => {
    switch (symbol) {
      case 'USDC':
        return '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      case 'DAI':
        return '0x6B175474E89094C44Da98b954EedeAC495271d0F';
      default:
        return '0x0000000000000000000000000000000000000000';
    }
  };

  // Ottieni il simbolo di un asset dato l'indirizzo
  const getAssetSymbolByAddress = (address, assetsList) => {
    const asset = assetsList.find(a => a.address === address);
    return asset ? asset.symbol : '';
  };

  // Filtra gli asset in base al tipo di operazione
  const filteredAssets = type === 'deposit'
    ? assets.filter(asset => asset.symbol === 'ETH' || asset.symbol === 'USDC' || asset.symbol === 'DAI')
    : assets;

  // Rendering del form di successo
  if (success && transaction) {
    return (
      <div className="bridge-form success">
        <h3>{type === 'deposit' ? 'Deposito completato!' : 'Prelievo avviato!'}</h3>
        
        <div className="transaction-details">
          <p><strong>ID Transazione:</strong> {transaction.id}</p>
          <p><strong>Da:</strong> {transaction.fromAddress.substring(0, 8)}...{transaction.fromAddress.substring(transaction.fromAddress.length - 8)}</p>
          <p><strong>A:</strong> {transaction.toAddress.substring(0, 8)}...{transaction.toAddress.substring(transaction.toAddress.length - 8)}</p>
          <p><strong>Importo:</strong> {parseFloat(transaction.amount) / (10 ** (transaction.tokenAddress === '0x0000000000000000000000000000000000000000' ? 18 : 6))}</p>
          <p><strong>Stato:</strong> {transaction.status}</p>
          
          {type === 'withdraw' && (
            <div className="challenge-period">
              <p>Periodo di contestazione: 7 giorni</p>
              <p>I fondi saranno disponibili su Ethereum dopo il periodo di contestazione.</p>
            </div>
          )}
        </div>
        
        <button onClick={() => {
          setSuccess(false);
          setTransaction(null);
          setSelectedAsset('');
          setAmount('');
          setDestinationAddress('');
        }}>
          Nuova operazione
        </button>
      </div>
    );
  }

  return (
    <div className="bridge-form">
      <h3>{type === 'deposit' ? 'Deposita da Ethereum a Solana' : 'Preleva da Solana a Ethereum'}</h3>
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="asset">Asset</label>
          <select 
            id="asset" 
            value={selectedAsset} 
            onChange={(e) => setSelectedAsset(e.target.value)}
            disabled={loading}
          >
            <option value="">Seleziona un asset</option>
            {filteredAssets.map((asset) => (
              <option key={asset.address} value={asset.address}>
                {asset.symbol} - {asset.name}
              </option>
            ))}
          </select>
        </div>
        
        <div className="form-group">
          <label htmlFor="amount">Importo</label>
          <input 
            type="number" 
            id="amount" 
            value={amount} 
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            step="0.000001"
            min="0"
            disabled={loading}
          />
        </div>
        
        <div className="form-group">
          <label htmlFor="destination">
            {type === 'deposit' ? 'Indirizzo Solana di destinazione' : 'Indirizzo Ethereum di destinazione'}
          </label>
          <input 
            type="text" 
            id="destination" 
            value={destinationAddress} 
            onChange={(e) => setDestinationAddress(e.target.value)}
            placeholder={type === 'deposit' ? 'Es. 11111111111111111111111111111111' : 'Es. 0x1234...'}
            disabled={loading}
          />
        </div>
        
        {(formError || error) && (
          <div className="error-message">
            {formError || error}
          </div>
        )}
        
        <button 
          type="submit" 
          className="submit-button" 
          disabled={loading}
        >
          {loading ? 'Elaborazione in corso...' : type === 'deposit' ? 'Deposita' : 'Preleva'}
        </button>
      </form>
      
      <div className="bridge-info">
        <h4>Informazioni sul bridge</h4>
        <p>
          {type === 'deposit' 
            ? 'I depositi da Ethereum a Solana sono generalmente confermati entro 5 minuti.' 
            : 'I prelievi da Solana a Ethereum richiedono un periodo di contestazione di 7 giorni prima che i fondi siano disponibili.'}
        </p>
        <p>
          {type === 'deposit'
            ? 'Assicurati di inserire un indirizzo Solana valido per ricevere i tuoi fondi.'
            : 'Assicurati di inserire un indirizzo Ethereum valido per ricevere i tuoi fondi.'}
        </p>
      </div>
    </div>
  );
}

export default BridgeForm;
