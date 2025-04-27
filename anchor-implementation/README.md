# Layer-2 Complete con BuyBot Enterprise

Questo repository contiene l'implementazione completa del sistema Layer-2 con BuyBot Enterprise integrato, sviluppato seguendo le best practice di Solana e utilizzando Anchor per una maggiore robustezza e sicurezza.

## Panoramica

Il sistema Layer-2 per Solana offre:

- **Bridge ETH-Solana**: Permette di utilizzare ETH e altri token EVM sulla blockchain di Solana
- **Swap integrato**: Funzionalità complete di swap tra token nativi e bridged
- **Launchpad**: Sistema completo per la creazione, presale e lancio di token
- **BuyBot Enterprise**: Sistema intelligente che supporta il lancio e la crescita del prezzo del token

## Architettura

Il sistema è composto da tre componenti principali:

1. **Programma On-chain (Anchor)**: Implementa la logica core del Layer-2 e del BuyBot direttamente sulla blockchain Solana
2. **SDK TypeScript**: Fornisce un'interfaccia client per interagire con il programma on-chain
3. **Servizi Off-chain**: Gestiscono operazioni che non possono essere eseguite on-chain (relayer, monitoring, ecc.)

Per maggiori dettagli, consulta la [documentazione dell'architettura](./docs/architecture.md).

## Struttura del Progetto

```
LAYER-2-COMPLETE-ANCHOR/
├── programs/
│   └── layer2/           # Programma Anchor on-chain
│       └── src/
│           └── lib.rs    # Implementazione del programma
├── sdk/                  # SDK TypeScript
│   └── index.ts          # Client per interagire con il programma
├── offchain/             # Servizi off-chain
│   ├── relayer/          # Relayer Wormhole
│   └── monitoring/       # Servizio di monitoring
├── tests/                # Test del programma
│   └── layer2.ts         # Test completi
└── docs/                 # Documentazione
    └── architecture.md   # Documentazione dell'architettura
```

## Funzionalità Principali

### Core Layer-2
- Deposito e prelievo di token
- Bridge cross-chain con Ethereum
- Esecuzione di bundle di transazioni
- Verifica di frodi e finalizzazione

### BuyBot Enterprise
- **Bundle Engine**: Aggrega le transazioni in bundle per un'elaborazione efficiente
- **Tax System**: Gestisce le tasse sulle transazioni con funzionalità di buyback e burn
- **Anti-Rug System**: Valuta il rischio di rug pull e include funzionalità di Lock Liquidity
- **Market Maker**: Gestisce la creazione di liquidità e la stabilizzazione dei prezzi

### Launchpad
- Creazione di token con configurazione tokenomics
- Gestione delle presale con contribuzioni
- Finalizzazione delle presale con integrazione del Bundle Engine
- Blocco della liquidità tramite Anti-Rug System
- Creazione di strategie di market making per la liquidità

## Installazione e Utilizzo

### Prerequisiti
- Node.js v14+
- Rust e Solana CLI
- Anchor CLI

### Installazione
```bash
# Clona il repository
git clone https://github.com/buybotsolana/LAYER-2-COMPLETE.git
cd LAYER-2-COMPLETE-ANCHOR

# Installa le dipendenze
yarn install

# Compila il programma Anchor
anchor build
```

### Test
```bash
# Esegui i test
anchor test
```

### Deployment
```bash
# Deploy su devnet
anchor deploy --provider.cluster devnet
```

## Utilizzo dell'SDK

```typescript
import { Connection, Keypair } from '@solana/web3.js';
import { Layer2Client } from './sdk';

// Inizializza il client
const connection = new Connection('https://api.devnet.solana.com');
const wallet = new Wallet(Keypair.generate());
const layer2Client = new Layer2Client(connection, wallet);

// Esempio: Crea un token tramite il launchpad
const tx = await layer2Client.createToken(
  mint,
  {
    decimals: 9,
    presalePrice: 100000,
    listingPrice: 200000,
    softCap: 10 * LAMPORTS_PER_SOL,
    hardCap: 50 * LAMPORTS_PER_SOL,
    minContribution: 0.1 * LAMPORTS_PER_SOL,
    maxContribution: 5 * LAMPORTS_PER_SOL,
    liquidityPercentage: 80,
    startTime: Math.floor(Date.now() / 1000),
    endTime: Math.floor(Date.now() / 1000) + 604800,
    enableBuybot: true,
    taxBuy: 5,
    taxSell: 10,
    taxTransfer: 2,
    liquidityLockPeriod: 15552000
  }
);
```

## Miglioramenti a Livello Enterprise

Questa implementazione include diversi miglioramenti a livello Enterprise rispetto al codice originale:

1. **Uso di Anchor**: Validazione automatica degli account e generazione di IDL
2. **Separation of Concerns**: Chiara separazione tra on-chain, SDK e servizi off-chain
3. **Gestione Robusta degli Errori**: Enum `ErrorCode` per tutti gli errori possibili
4. **Eventi Dettagliati**: Eventi per tutte le operazioni significative
5. **PDAs Documentati**: Tutti i PDAs sono documentati con seeds chiari
6. **Test Completi**: Test unitari e di integrazione per tutte le funzionalità
7. **Documentazione Dettagliata**: Documentazione completa dell'architettura e delle API

## Sicurezza

Il sistema include diverse misure di sicurezza:

- **Validazione degli Account**: Grazie ad Anchor, tutti gli account sono validati automaticamente
- **Verifica On-chain dei VAA**: I VAA di Wormhole sono verificati direttamente on-chain
- **Gestione Robusta degli Errori**: Tutti gli errori possibili sono gestiti in modo appropriato
- **Test di Sicurezza**: Test specifici per verificare la sicurezza del sistema

## Roadmap

- [ ] Implementazione completa del relayer Wormhole
- [ ] Integrazione con Phantom e altri wallet
- [ ] Implementazione di meta-transazioni gasless
- [ ] Audit di sicurezza da parte di terzi
- [ ] Deployment su mainnet

## Contribuire

Le contribuzioni sono benvenute! Per favore, segui questi passaggi:

1. Forka il repository
2. Crea un branch per la tua feature (`git checkout -b feature/amazing-feature`)
3. Committa le tue modifiche (`git commit -m 'Add some amazing feature'`)
4. Pusha il branch (`git push origin feature/amazing-feature`)
5. Apri una Pull Request

## Licenza

Questo progetto è sotto licenza MIT. Vedi il file `LICENSE` per maggiori dettagli.
