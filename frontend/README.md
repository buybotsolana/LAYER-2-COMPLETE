# Layer-2 su Solana - Frontend

Questo repository contiene l'implementazione frontend del Layer-2 su Solana, sviluppata utilizzando React, TypeScript e Next.js.

## Tecnologie utilizzate

- **React**: Libreria JavaScript per la costruzione di interfacce utente
- **TypeScript**: Superset tipizzato di JavaScript per una maggiore robustezza del codice
- **Next.js**: Framework React per applicazioni web con rendering lato server e generazione di siti statici
- **Solana Wallet Adapter**: Libreria ufficiale per l'integrazione dei wallet Solana
- **Chakra UI**: Sistema di design per un'interfaccia coerente e responsive
- **Redux Toolkit**: Gestione dello stato dell'applicazione
- **Web3.js Solana**: Libreria per interagire con la blockchain Solana

## Struttura del progetto

```
frontend/
├── public/              # File statici
├── src/
│   ├── components/      # Componenti React riutilizzabili
│   │   ├── common/      # Componenti comuni (button, input, ecc.)
│   │   ├── layout/      # Componenti di layout (header, footer, ecc.)
│   │   ├── wallet/      # Componenti relativi al wallet
│   │   ├── bridge/      # Componenti per il bridge L1-L2
│   │   ├── swap/        # Componenti per lo swap
│   │   └── lending/     # Componenti per il lending
│   ├── hooks/           # Custom React hooks
│   ├── pages/           # Pagine Next.js
│   ├── store/           # Store Redux
│   ├── services/        # Servizi API e blockchain
│   ├── utils/           # Funzioni di utilità
│   ├── constants/       # Costanti dell'applicazione
│   ├── types/           # Definizioni TypeScript
│   └── styles/          # Stili globali
├── tests/               # Test unitari e di integrazione
├── .env.example         # Esempio di variabili d'ambiente
├── next.config.js       # Configurazione Next.js
├── tsconfig.json        # Configurazione TypeScript
└── package.json         # Dipendenze e script
```

## Funzionalità principali

### Integrazione Wallet

- Supporto per molteplici wallet Solana (Phantom, Solflare, Backpack, ecc.)
- Connessione al Layer-2 tramite endpoint RPC personalizzato
- Visualizzazione del saldo e delle attività dell'utente

### Bridge L1-L2

- Interfaccia per il trasferimento di token tra Solana L1 e Layer-2
- Monitoraggio dello stato dei trasferimenti
- Supporto per token SPL e NFT

### Swap

- Interfaccia per lo scambio di token sul Layer-2
- Visualizzazione dei tassi di cambio e della liquidità
- Stima dello slippage e dell'impatto sul prezzo

### Lending

- Interfaccia per il deposito e il prestito di token
- Visualizzazione dei tassi di interesse
- Gestione del collaterale

### Composabilità

- Supporto per operazioni composte (es. swap + lending in un'unica transazione)
- Visualizzazione del flusso di operazioni composte

## Installazione e configurazione

### Prerequisiti

- Node.js v16 o superiore
- npm v7 o superiore

### Installazione

```bash
# Clona il repository
git clone https://github.com/buybotsolana/LAYER-2-COMPLETE.git
cd LAYER-2-COMPLETE/frontend

# Installa le dipendenze
npm install

# Copia il file di esempio delle variabili d'ambiente
cp .env.example .env.local

# Modifica il file .env.local con i tuoi valori
```

### Configurazione

Modifica il file `.env.local` con i seguenti valori:

```
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.l2-solana.com
NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta
NEXT_PUBLIC_BRIDGE_PROGRAM_ID=your_bridge_program_id
NEXT_PUBLIC_SWAP_PROGRAM_ID=your_swap_program_id
NEXT_PUBLIC_LENDING_PROGRAM_ID=your_lending_program_id
```

### Avvio in modalità sviluppo

```bash
npm run dev
```

L'applicazione sarà disponibile all'indirizzo `http://localhost:3000`.

### Build per la produzione

```bash
npm run build
npm run start
```

## Test

```bash
# Esegui i test unitari
npm run test

# Esegui i test con coverage
npm run test:coverage

# Esegui i test end-to-end
npm run test:e2e
```

## Deployment

L'applicazione può essere deployata su servizi come Vercel o Netlify, o su un server dedicato.

### Deployment su Vercel

```bash
npm install -g vercel
vercel
```

### Deployment su Netlify

```bash
npm install -g netlify-cli
netlify deploy
```

## Best Practices

### Sicurezza

- Utilizzo di HTTPS per tutte le comunicazioni
- Implementazione di Content Security Policy
- Validazione degli input utente
- Protezione contro attacchi XSS e CSRF

### Performance

- Ottimizzazione del caricamento delle pagine
- Code splitting per ridurre la dimensione dei bundle
- Lazy loading dei componenti
- Caching delle risorse statiche

### Accessibilità

- Supporto per screen reader
- Contrasto adeguato per la leggibilità
- Navigazione da tastiera
- Supporto per diverse dimensioni di schermo

## Contribuire

1. Forka il repository
2. Crea un branch per la tua feature (`git checkout -b feature/amazing-feature`)
3. Committa le tue modifiche (`git commit -m 'Add some amazing feature'`)
4. Pusha il branch (`git push origin feature/amazing-feature`)
5. Apri una Pull Request

## Licenza

Questo progetto è sotto licenza MIT. Vedi il file `LICENSE` per i dettagli.
