import React from 'react';
import './Header.css';

function Header() {
  return (
    <header className="header">
      <div className="logo">
        <img src="/logo.svg" alt="Layer-2 Solana Bridge" />
        <h1>Layer-2 Solana Bridge</h1>
      </div>
      <nav className="nav">
        <ul>
          <li><a href="#home">Home</a></li>
          <li><a href="#docs">Documentazione</a></li>
          <li><a href="#faq">FAQ</a></li>
          <li><a href="https://github.com/buybotsolana/LAYER-2-COMPLETE" target="_blank" rel="noopener noreferrer">GitHub</a></li>
        </ul>
      </nav>
    </header>
  );
}

export default Header;
