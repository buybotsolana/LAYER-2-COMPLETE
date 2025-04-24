# Guida all'installazione e all'uso di Solana Layer 2

Questa guida spiega come installare e utilizzare il progetto Solana Layer 2 dopo le correzioni apportate.

## Prerequisiti

- Node.js v16.0.0 o superiore
- npm v8.0.0 o superiore
- Rust 1.60.0 o superiore (per la parte onchain)
- Solana CLI v1.14.0 o superiore (per la parte onchain)

## Installazione

1. Estrai l'archivio compresso in una directory di tua scelta
2. Configura le variabili d'ambiente:
   ```
   cd layer2_solana_complete_code
   cp .env.example .env
   # Modifica il file .env con i tuoi valori
   ```
3. Installa le dipendenze:
   ```
   npm install
   ```
4. Installa le dipendenze per ogni componente (opzionale):
   ```
   cd offchain && npm install && cd ..
   cd bridge && npm install && cd ..
   cd relayer && npm install && cd ..
   cd sdk && npm install && cd ..
   cd evm-compatibility && npm install && cd ..
   ```

## Avvio dei componenti

### Sequencer
```
npm run start:sequencer
```

### Bridge
```
npm run start:bridge
```

### Relayer
```
npm run start:relayer
```

## Compilazione e deployment della parte onchain

1. Naviga nella directory onchain:
   ```
   cd onchain
   ```
2. Compila il programma:
   ```
   cargo build-bpf
   ```
3. Distribuisci il programma su Devnet:
   ```
   ./deploy_devnet.sh
   ```

## Utilizzo dell'SDK

Consulta gli esempi nel file README.md per l'utilizzo dell'SDK.

## Risoluzione dei problemi

Se riscontri problemi durante l'installazione o l'esecuzione, verifica:

1. Di aver installato tutte le dipendenze necessarie
2. Di aver configurato correttamente il file .env
3. Di avere le versioni corrette di Node.js, npm e Rust

Per ulteriori informazioni, consulta la documentazione nella directory docs.
