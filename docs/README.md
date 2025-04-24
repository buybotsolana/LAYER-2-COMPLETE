# Layer-2 su Solana - Documentazione

## Panoramica

Il Layer-2 su Solana è una soluzione di scalabilità che consente transazioni ad alta velocità e basso costo sulla blockchain Solana. Questo sistema implementa un'architettura di rollup ottimistico con un bridge bidirezionale tra Ethereum e Solana, consentendo il trasferimento di asset tra le due blockchain.

## Architettura

Il sistema è composto da tre componenti principali:

1. **Componenti Onchain**: Smart contract Solana scritti in Rust che gestiscono la validazione, l'elaborazione e la finalizzazione delle transazioni.
2. **Componenti Offchain**: Sequencer e servizi di supporto scritti in JavaScript che gestiscono l'ordinamento, il batching e l'invio delle transazioni alla blockchain.
3. **Bridge Ethereum-Solana**: Smart contract Ethereum scritti in Solidity che gestiscono il deposito e il prelievo di token tra Ethereum e Solana.

### Componenti Onchain

I componenti onchain sono implementati come un programma Solana scritto in Rust. Il programma è composto da diversi moduli:

- **lib.rs**: Punto di ingresso del programma che definisce le istruzioni supportate.
- **instruction.rs**: Definisce le istruzioni che il programma può eseguire.
- **processor.rs**: Implementa la logica di elaborazione delle istruzioni.
- **processor_deposit.rs**: Gestisce le operazioni di deposito.
- **processor_transfer.rs**: Gestisce le operazioni di trasferimento.
- **processor_withdrawal.rs**: Gestisce le operazioni di prelievo.
- **state.rs**: Definisce le strutture dati per lo stato del programma.
- **error.rs**: Definisce i codici di errore del programma.
- **validation.rs**: Implementa la logica di validazione delle transazioni.
- **security.rs**: Implementa le misure di sicurezza.

### Componenti Offchain

I componenti offchain sono implementati in JavaScript e includono:

- **sequencer-worker.js**: Gestisce l'elaborazione parallela delle transazioni.
- **layer2_system.js**: Coordina tutti i componenti del sistema Layer-2.
- **optimized_sequencer.js**: Implementa un sequencer ottimizzato per alte prestazioni.
- **deposit_sequencer.js**: Gestisce le operazioni di deposito.
- **transfer_sequencer.js**: Gestisce le operazioni di trasferimento.
- **withdrawal_sequencer.js**: Gestisce le operazioni di prelievo.
- **transaction_manager.js**: Gestisce le transazioni e il loro stato.
- **error_manager.js**: Gestisce gli errori e implementa strategie di retry.
- **gas_optimizer.js**: Ottimizza le commissioni di gas.
- **recovery_system.js**: Implementa meccanismi di recupero in caso di errori.
- **merkle_tree.js**: Implementa l'albero di Merkle per le prove di inclusione.

### Bridge Ethereum-Solana

Il bridge Ethereum-Solana è implementato come un insieme di smart contract Ethereum scritti in Solidity:

- **TokenBridge.sol**: Gestisce il deposito di token ERC20 da Ethereum a Solana.
- **WithdrawalBridge.sol**: Gestisce il prelievo di token da Solana a Ethereum.

## SDK e Client

Il sistema fornisce un SDK client in TypeScript che consente agli sviluppatori di interagire facilmente con il Layer-2:

- **client.ts**: Implementa il client SDK con supporto per depositi, trasferimenti, prelievi e query.

## Flusso di Dati

### Deposito (Ethereum -> Solana)

1. L'utente approva il TokenBridge a spendere i suoi token ERC20.
2. L'utente chiama il metodo `deposit` del TokenBridge, specificando il token, l'importo e l'indirizzo di destinazione su Solana.
3. Il TokenBridge blocca i token e emette un evento `Deposited`.
4. Il deposit_sequencer monitora gli eventi `Deposited` e crea una transazione di deposito sul Layer-2.
5. La transazione viene elaborata dal sequencer e inclusa in un batch.
6. Il batch viene inviato al programma Solana per la validazione e l'elaborazione.
7. I token vengono accreditati all'indirizzo di destinazione sul Layer-2.

### Trasferimento (Layer-2 -> Layer-2)

1. L'utente crea una transazione di trasferimento utilizzando il client SDK.
2. La transazione viene firmata con la chiave privata dell'utente.
3. La transazione viene inviata al transfer_sequencer.
4. Il transfer_sequencer verifica la firma e la validità della transazione.
5. La transazione viene aggiunta alla coda di elaborazione.
6. Il sequencer raggruppa le transazioni in batch e le invia al programma Solana.
7. Il programma Solana verifica e elabora le transazioni, aggiornando i saldi degli account.

### Prelievo (Solana -> Ethereum)

1. L'utente crea una transazione di prelievo utilizzando il client SDK.
2. La transazione viene firmata con la chiave privata dell'utente.
3. La transazione viene inviata al withdrawal_sequencer.
4. Il withdrawal_sequencer verifica la firma e la validità della transazione.
5. La transazione viene aggiunta alla coda di elaborazione.
6. Il sequencer raggruppa le transazioni in batch e le invia al programma Solana.
7. Il programma Solana verifica e elabora le transazioni, riducendo il saldo dell'utente.
8. Il withdrawal_sequencer monitora i batch elaborati e crea una prova di Merkle per il prelievo.
9. Il withdrawal_sequencer invia la prova al WithdrawalBridge su Ethereum.
10. Il WithdrawalBridge verifica la prova e sblocca i token per l'utente.

## Sicurezza

Il sistema implementa diverse misure di sicurezza:

- **Firme digitali**: Tutte le transazioni sono firmate con le chiavi private degli utenti.
- **Validazione delle transazioni**: Le transazioni sono validate sia offchain che onchain.
- **Prove di Merkle**: Le prove di Merkle sono utilizzate per verificare l'inclusione delle transazioni nei batch.
- **Sistema di validatori multipli**: Il bridge utilizza un sistema di validatori multipli con soglia di conferma per i prelievi.
- **Circuit Breaker**: Il sistema implementa un pattern Circuit Breaker per prevenire cascate di errori.
- **Rate Limiting**: Il sistema implementa limiti di velocità per prevenire attacchi DoS.
- **Monitoraggio e analisi degli errori**: Il sistema monitora e analizza gli errori per identificare potenziali problemi.

## Prestazioni

Il sistema è progettato per offrire alte prestazioni:

- **Batching adattivo**: Il sistema adatta la dimensione dei batch in base al carico.
- **Elaborazione parallela**: Le transazioni sono elaborate in parallelo per aumentare il throughput.
- **Polling con intervallo adattivo**: Il sistema adatta l'intervallo di polling in base al carico.
- **Cache LRU**: Il sistema utilizza una cache LRU per evitare l'elaborazione di transazioni duplicate.
- **Bilanciamento del carico dinamico**: Il sistema bilancia dinamicamente il carico tra i worker.

## Configurazione e Deployment

Il sistema può essere configurato e deployato in diversi ambienti:

- **Ambiente di sviluppo**: Configurazione per lo sviluppo locale.
- **Ambiente di test**: Configurazione per i test su testnet.
- **Ambiente di produzione**: Configurazione per la produzione su mainnet.

Il deployment può essere effettuato utilizzando Docker e Docker Compose:

- **docker-compose.yml**: Configurazione Docker per l'ambiente di sviluppo.
- **docker-compose.production.yml**: Configurazione Docker per l'ambiente di produzione.

## Test

Il sistema include una suite completa di test:

- **Test unitari**: Verificano il corretto funzionamento dei singoli componenti.
- **Test di integrazione**: Verificano il corretto funzionamento dei componenti integrati.
- **Test di stress**: Verificano le prestazioni del sistema sotto carico.
- **Test di sicurezza**: Verificano la sicurezza del sistema.

## Requisiti di Sistema

- **Node.js**: v14.0.0 o superiore
- **Rust**: 1.55.0 o superiore
- **Solana CLI**: 1.8.0 o superiore
- **Ethereum Node**: Geth o Parity
- **MongoDB**: 4.4 o superiore

## Installazione

### Prerequisiti

Prima di iniziare, assicurati di avere installato:

- Node.js e npm
- Rust e Cargo
- Solana CLI
- Docker e Docker Compose (opzionale)

### Installazione dei componenti onchain

```bash
cd onchain
cargo build-bpf
```

### Installazione dei componenti offchain

```bash
cd offchain
npm install
```

### Installazione del bridge Ethereum-Solana

```bash
cd bridge
npm install
```

### Installazione del SDK client

```bash
cd sdk
npm install
```

## Configurazione

### Configurazione dei componenti onchain

Crea un file `.env` nella directory `onchain` con le seguenti variabili:

```
SOLANA_RPC_URL=https://api.devnet.solana.com
PROGRAM_ID=<program_id>
```

### Configurazione dei componenti offchain

Crea un file `.env` nella directory `offchain` con le seguenti variabili:

```
SOLANA_RPC_URL=https://api.devnet.solana.com
PROGRAM_ID=<program_id>
MONGODB_URI=mongodb://localhost:27017/layer2
SEQUENCER_PRIVATE_KEY=<sequencer_private_key>
```

### Configurazione del bridge Ethereum-Solana

Crea un file `.env` nella directory `bridge` con le seguenti variabili:

```
ETHEREUM_RPC_URL=https://rinkeby.infura.io/v3/<api_key>
TOKEN_BRIDGE_ADDRESS=<token_bridge_address>
WITHDRAWAL_BRIDGE_ADDRESS=<withdrawal_bridge_address>
VALIDATOR_PRIVATE_KEY=<validator_private_key>
```

## Esecuzione

### Esecuzione dei componenti onchain

```bash
cd onchain
cargo run-bpf
```

### Esecuzione dei componenti offchain

```bash
cd offchain
npm start
```

### Esecuzione del bridge Ethereum-Solana

```bash
cd bridge
npm start
```

## Utilizzo del SDK Client

```typescript
import { Layer2Client, TransactionType } from 'layer2-sdk';

// Crea un client
const client = new Layer2Client({
  solanaRpcUrl: 'https://api.devnet.solana.com',
  programId: 'Layer2ProgramId11111111111111111111111111111111',
  ethereumRpcUrl: 'https://rinkeby.infura.io/v3/your-api-key',
  tokenBridgeAddress: '0x1234567890123456789012345678901234567890',
  withdrawalBridgeAddress: '0x0987654321098765432109876543210987654321',
  layer2ApiUrl: 'https://api.layer2.example.com',
});

// Connetti un wallet Solana
const solanaWallet = Keypair.generate();
const connectedClient = client.connectSolanaWallet(solanaWallet);

// Connetti un wallet Ethereum
const ethereumWallet = '0x1234567890abcdef1234567890abcdef12345678';
const connectedClient = client.connectEthereumWallet(ethereumWallet);

// Deposita token da Ethereum a Solana
const depositResult = await client.deposit({
  token: '0x1234567890123456789012345678901234567890',
  amount: 10,
  recipient: solanaWallet.publicKey.toString(),
});

// Trasferisci token all'interno del Layer-2
const transferResult = await client.transfer({
  token: new PublicKey(Buffer.alloc(32)).toString(),
  amount: 5,
  recipient: recipientPublicKey.toString(),
});

// Preleva token da Solana a Ethereum
const withdrawalResult = await client.withdraw({
  token: new PublicKey(Buffer.alloc(32)).toString(),
  amount: 3,
  recipient: '0x1234567890123456789012345678901234567890',
});

// Ottieni un account
const account = await client.getAccount(solanaWallet.publicKey.toString());

// Ottieni una transazione
const transaction = await client.getTransaction(transactionId);

// Ottieni le transazioni di un account
const transactions = await client.getTransactionsByAccount(
  solanaWallet.publicKey.toString(),
  10,
  0
);

// Ottieni il saldo di un token
const balance = await client.getTokenBalance(
  solanaWallet.publicKey.toString(),
  tokenPublicKey.toString()
);

// Ottieni i token supportati
const tokens = await client.getSupportedTokens();

// Ottieni le statistiche del Layer-2
const stats = await client.getStats();

// Verifica lo stato di una transazione
const status = await client.getTransactionStatus(transactionId);
```

## Contribuire

Le contribuzioni sono benvenute! Per contribuire:

1. Forka il repository
2. Crea un branch per la tua feature (`git checkout -b feature/amazing-feature`)
3. Committa le tue modifiche (`git commit -m 'Add some amazing feature'`)
4. Pusha il branch (`git push origin feature/amazing-feature`)
5. Apri una Pull Request

## Licenza

Questo progetto è rilasciato sotto la licenza MIT. Vedi il file `LICENSE` per maggiori dettagli.
