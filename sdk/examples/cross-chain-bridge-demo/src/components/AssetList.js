import React from 'react';
import './AssetList.css';

function AssetList({ assets, loading }) {
  if (loading) {
    return (
      <div className="asset-list loading">
        <h2>I tuoi asset</h2>
        <div className="loading-spinner">Caricamento asset in corso...</div>
      </div>
    );
  }

  return (
    <div className="asset-list">
      <h2>I tuoi asset</h2>
      
      {assets.length === 0 ? (
        <div className="no-assets">
          <p>Non hai ancora asset nel tuo wallet.</p>
        </div>
      ) : (
        <div className="assets-grid">
          {assets.map((asset) => (
            <div key={asset.address} className="asset-card">
              <div className="asset-icon">
                <img src={asset.icon} alt={asset.symbol} />
              </div>
              <div className="asset-details">
                <h3>{asset.name} ({asset.symbol})</h3>
                <p className="asset-balance">{asset.balance.toFixed(6)} {asset.symbol}</p>
                <p className="asset-address">{asset.address.substring(0, 8)}...{asset.address.substring(asset.address.length - 8)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default AssetList;
