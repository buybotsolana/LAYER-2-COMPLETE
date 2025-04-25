import React from 'react';
import './TransactionHistory.css';

function TransactionHistory({ transactions, loading }) {
  if (loading) {
    return (
      <div className="transaction-history loading">
        <h2>Cronologia transazioni</h2>
        <div className="loading-spinner">Caricamento transazioni in corso...</div>
      </div>
    );
  }

  // Funzione per formattare la data
  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Funzione per formattare l'importo
  const formatAmount = (amount, tokenAddress) => {
    // Determina il numero di decimali in base al token
    let decimals = 9; // Default per token sconosciuti
    
    if (tokenAddress === '0x0000000000000000000000000000000000000000') {
      decimals = 18; // ETH
    } else if (
      tokenAddress === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' || 
      tokenAddress === '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    ) {
      decimals = 6; // USDC
    } else if (
      tokenAddress === 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' ||
      tokenAddress === '0x6B175474E89094C44Da98b954EedeAC495271d0F'
    ) {
      decimals = 6; // DAI
    } else if (tokenAddress === 'native' || tokenAddress === 'So11111111111111111111111111111111111111111') {
      decimals = 9; // SOL
    }
    
    // Converti da unità più piccola a unità principale
    const value = parseFloat(amount) / (10 ** decimals);
    
    // Formatta con 6 decimali massimo
    return value.toFixed(6);
  };

  // Funzione per ottenere il simbolo del token
  const getTokenSymbol = (tokenAddress) => {
    if (tokenAddress === '0x0000000000000000000000000000000000000000') {
      return 'ETH';
    } else if (
      tokenAddress === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' || 
      tokenAddress === '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    ) {
      return 'USDC';
    } else if (
      tokenAddress === 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' ||
      tokenAddress === '0x6B175474E89094C44Da98b954EedeAC495271d0F'
    ) {
      return 'DAI';
    } else if (tokenAddress === 'native' || tokenAddress === 'So11111111111111111111111111111111111111111') {
      return 'SOL';
    }
    
    return 'TOKEN';
  };

  // Funzione per determinare il tipo di transazione
  const getTransactionType = (transaction) => {
    // Se ha l1TxHash è un deposito completato
    if (transaction.l1TxHash) {
      return 'Deposito';
    }
    
    // Se ha challengeEndTimestamp è un prelievo
    if (transaction.challengeEndTimestamp) {
      return 'Prelievo';
    }
    
    // Altrimenti, determina in base agli indirizzi
    if (transaction.fromAddress.startsWith('0x') && !transaction.toAddress.startsWith('0x')) {
      return 'Deposito';
    } else if (!transaction.fromAddress.startsWith('0x') && transaction.toAddress.startsWith('0x')) {
      return 'Prelievo';
    }
    
    return 'Transazione';
  };

  // Funzione per determinare lo stato della transazione
  const getStatusLabel = (status) => {
    switch (status) {
      case 'completed':
        return 'Completata';
      case 'processing':
        return 'In elaborazione';
      case 'pending':
        return 'In attesa';
      case 'failed':
        return 'Fallita';
      default:
        return status;
    }
  };

  // Funzione per determinare la classe CSS dello stato
  const getStatusClass = (status) => {
    switch (status) {
      case 'completed':
        return 'status-completed';
      case 'processing':
        return 'status-processing';
      case 'pending':
        return 'status-pending';
      case 'failed':
        return 'status-failed';
      default:
        return '';
    }
  };

  return (
    <div className="transaction-history">
      <h2>Cronologia transazioni</h2>
      
      {transactions.length === 0 ? (
        <div className="no-transactions">
          <p>Non hai ancora effettuato transazioni.</p>
        </div>
      ) : (
        <div className="transactions-table-container">
          <table className="transactions-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Data</th>
                <th>Da</th>
                <th>A</th>
                <th>Importo</th>
                <th>Stato</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td>{getTransactionType(tx)}</td>
                  <td>{formatDate(tx.timestamp)}</td>
                  <td title={tx.fromAddress}>
                    {tx.fromAddress.substring(0, 6)}...{tx.fromAddress.substring(tx.fromAddress.length - 4)}
                  </td>
                  <td title={tx.toAddress}>
                    {tx.toAddress.substring(0, 6)}...{tx.toAddress.substring(tx.toAddress.length - 4)}
                  </td>
                  <td>
                    {formatAmount(tx.amount, tx.tokenAddress)} {getTokenSymbol(tx.tokenAddress)}
                  </td>
                  <td>
                    <span className={`status-badge ${getStatusClass(tx.status)}`}>
                      {getStatusLabel(tx.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default TransactionHistory;
