# Layer-2 su Solana

Un sistema Layer-2 completo per Solana con rollup ottimistico, bridge trustless, sequencer per transazioni e ottimizzazione delle fee.

[![Build Status](https://img.shields.io/github/workflow/status/buybotsolana/LAYER-2-COMPLETE/CI)](https://github.com/buybotsolana/LAYER-2-COMPLETE/actions)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Documentation](https://img.shields.io/badge/docs-latest-brightgreen.svg)](docs/)

## Panoramica del Progetto

Layer-2 su Solana è una soluzione di scaling per Solana che implementa un rollup ottimistico. Il sistema eredita la sicurezza di Solana mentre offre maggiore throughput e costi ridotti.

### Caratteristiche Principali

- **Alta Velocità**: Throughput di oltre 10,000 TPS
- **Basse Commissioni**: Costi di transazione ridotti rispetto a Solana L1
- **Sicurezza Garantita da Solana**: Tutti gli stati sono ancorati su Solana
- **Bridge Trustless**: Trasferimento sicuro di asset tra Solana e il Layer-2
- **Transazioni Gasless**: Supporto per meta-transazioni senza gas
- **Anti-Rug System**: Prevenzione dei rug pull e protezione degli investitori
- **Bundle Engine**: Aggregazione di transazioni per un'elaborazione efficiente

## Architettura

Il sistema è composto dai seguenti componenti principali:

1. **Sistema di Rollup Ottimistico**:
   - Creazione e gestione di batch di transazioni
   - Verifica delle transazioni e calcolo dello stato
   - Meccanismo di challenge per contestare transazioni fraudolente
   - Finalizzazione dei batch dopo il periodo di challenge

2. **Bridge Trustless**:
   - Supporto per token nativi, SPL e NFT
   - Integrazione con Wormhole per messaggi cross-chain
   - Protezione replay tramite nonce
   - Meccanismi di deposito e prelievo

3. **Sequencer per Transazioni**:
   - Raccolta e ordinamento delle transazioni
   - Prioritizzazione basata su gas price e altri fattori
   - Creazione e sottomissione di batch
   - Gestione delle transazioni scadute

4. **Sistema di Ottimizzazione delle Fee**:
   - Supporto per meta-transazioni (transazioni gasless)
   - Sistema di relayer per pagare le fee per conto degli utenti
   - Whitelist di contratti e sussidi per utenti
   - Pool di sussidio per sovvenzionare le fee

## Guida Rapida

### Prerequisiti

- Node.js v16+
- Rust 1.60+
- Solana CLI

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
cargo run --release -- --solana-rpc http://localhost:8899

# In un altro terminale, avvia il validator
cd validator
cargo run --release -- --solana-rpc http://localhost:8899
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

# Esegui il test completo del Layer-2
./test_layer2_core.sh
```

### Esempio: Transazione su L2

```rust
// Connessione al Layer-2
let l2_client = L2Client::new("http://localhost:3000");

// Creazione di un wallet
let wallet = Keypair::new();

// Invio di una transazione
let transaction = RollupTransaction {
    sender: wallet.pubkey(),
    recipient: recipient_pubkey,
    amount: 1000000,
    data: vec![],
    signature: wallet.sign_message(&message),
    nonce: 1,
    gas_price: 10,
    gas_limit: 5,
};

let tx_hash = l2_client.send_transaction(transaction).await?;
println!("Transazione inviata: {}", tx_hash);
```

## Documentazione

Per una documentazione più dettagliata, consulta:

- [Documentazione Italiana](documentation-it.md)
- [Documentazione Inglese](documentation-en.md)
- [Guida per Sviluppatori](docs/developer-guide.md)

## Roadmap

- [x] Implementazione del sistema di rollup ottimistico
- [x] Implementazione del bridge trustless
- [x] Implementazione del sequencer per transazioni
- [x] Implementazione del sistema di ottimizzazione delle fee
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
