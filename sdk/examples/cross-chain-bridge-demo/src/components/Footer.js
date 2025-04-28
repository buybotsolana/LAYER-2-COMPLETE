import React from 'react';
import './Footer.css';

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-content">
        <div className="footer-section">
          <h3>Layer-2 Solana Bridge</h3>
          <p>Un bridge trustless tra Ethereum e Solana Layer-2</p>
        </div>
        
        <div className="footer-section">
          <h3>Risorse</h3>
          <ul>
            <li><a href="#docs">Documentazione</a></li>
            <li><a href="#faq">FAQ</a></li>
            <li><a href="https://github.com/buybotsolana/LAYER-2-COMPLETE" target="_blank" rel="noopener noreferrer">GitHub</a></li>
          </ul>
        </div>
        
        <div className="footer-section">
          <h3>Contatti</h3>
          <ul>
            <li><a href="mailto:support@layer2solana.com">support@layer2solana.com</a></li>
            <li><a href="https://twitter.com/layer2solana" target="_blank" rel="noopener noreferrer">Twitter</a></li>
            <li><a href="https://discord.gg/layer2solana" target="_blank" rel="noopener noreferrer">Discord</a></li>
          </ul>
        </div>
      </div>
      
      <div className="footer-bottom">
        <p>&copy; {new Date().getFullYear()} Layer-2 Solana. Tutti i diritti riservati.</p>
      </div>
    </footer>
  );
}

export default Footer;
