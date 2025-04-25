# Layer-2 su Solana

Un Optimistic Rollup che utilizza la Solana Virtual Machine (SVM) come layer di esecuzione su Ethereum.

[![Build Status](https://img.shields.io/github/workflow/status/buybotsolana/LAYER-2-COMPLETE/CI)](https://github.com/buybotsolana/LAYER-2-COMPLETE/actions)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Documentation](https://img.shields.io/badge/docs-latest-brightgreen.svg)](docs/)

## Panoramica del Progetto

Layer-2 su Solana è una soluzione di scaling per Ethereum che utilizza la Solana Virtual Machine (SVM) come layer di esecuzione. Implementa un rollup ottimistico che eredita la sicurezza di Ethereum mentre sfrutta la velocità e l'efficienza della SVM.

### Caratteristiche Principali

- **Alta Velocità**: Throughput di oltre 1,000 TPS, con obiettivo futuro di 10,000 TPS
- **Basse Commissioni**: Costi di transazione ridotti rispetto a Ethereum L1
- **Sicurezza Garantita da Ethereum**: Tutti gli stati sono ancorati su Ethereum
- **Compatibilità con Solana**: Supporto per programmi Solana esistenti
- **Bridge Trustless**: Trasferimento sicuro di asset tra Ethereum e il Layer-2

## Architettura

Il sistema è composto dai seguenti componenti principali:

1. **Contratti su Ethereum (L1)**:
   - Contratti di bridge per depositi e prelievi
   - Sistema di commitment degli stati
   - Meccanismo di sfida per le prove di frode

2. **Nodi Layer-2**:
   - Sequencer: ordina e processa le transazioni
   - Validator: verifica le transazioni e genera prove di frode

3. **Bridge Bidirezionale**:
   - Supporto per ETH, USDC, DAI e altri token
   - Meccanismo di deposito (L1 → L2)
   - Meccanismo di prelievo (L2 → L1)

4. **Sistema di Prove di Frode**:
   - Verifica dell'esecuzione corretta delle transazioni
   - Gioco di bisection per identificare transizioni di stato invalide
   - Integrazione con Solana Runtime in modalità deterministica

## Guida Rapida

### Prerequisiti

- Node.js v16+
- Rust 1.60+
- Solana CLI
- Ethereum client (Geth, Hardhat, ecc.)

### Installazione

```bash
# Clona il repository
git clone https://github.com/buybotsolana/LAYER-2-COMPLETE.git
cd LAYER-2-COMPLETE

# Installa le dipendenze
npm install
cargo build --release
```

### Avvio dell'Ambiente Locale

```bash
# Avvia l'ambiente di test locale
./scripts/setup-local-testnet.sh

# In un altro terminale, avvia il sequencer
cd sequencer
cargo run --release -- --ethereum-rpc http://localhost:8545 --solana-rpc http://localhost:8899

# In un altro terminale, avvia il validator
cd validator
cargo run --release -- --ethereum-rpc http://localhost:8545 --solana-rpc http://localhost:8899
```

### Esecuzione dei Test

```bash
# Esegui i test unitari
cargo test --all

# Esegui i test di integrazione
cd integration
npm test

# Esegui i test end-to-end
cd e2e
npm test
```

### Esempio: Hello World su L2

```javascript
// Connessione al Layer-2
const l2 = new L2Client("http://localhost:3000");

// Creazione di un wallet
const wallet = Keypair.generate();

// Invio di una transazione
const tx = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: recipient,
    lamports: 1000000,
  })
);

const signature = await l2.sendTransaction(tx, wallet);
console.log("Transazione inviata:", signature);
```

## Documentazione

Per una documentazione più dettagliata, consulta:

- [Documentazione Architetturale](docs/architecture/)
- [Riferimento API](docs/api-reference/)
- [Guide per Sviluppatori](docs/guides/)

## Roadmap

- [x] Implementazione del sistema di prove di frode
- [x] Implementazione della logica di finalizzazione
- [x] Implementazione del bridge trustless
- [ ] Supporto per token SPL nativi
- [ ] Integrazione con wallet Solana esistenti
- [ ] Supporto per composability tra programmi
- [ ] Mainnet beta

## Contribuire

Siamo aperti ai contributi! Per favore, leggi le [linee guida per contribuire](CONTRIBUTING.md) prima di inviare pull request.

## Licenza

Questo progetto è rilasciato sotto la licenza MIT. Vedi il file [LICENSE](LICENSE) per i dettagli.

## Contatti

- GitHub: [buybotsolana](https://github.com/buybotsolana)
- Email: buybotsolana@tech-center.com
