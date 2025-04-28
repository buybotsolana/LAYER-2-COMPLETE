# Layer-2 Solana SDK - Documentazione

## Panoramica

Il Layer-2 Solana SDK è una libreria JavaScript/TypeScript completa che permette agli sviluppatori di interagire facilmente con il Layer-2 su Solana. Questo SDK fornisce funzionalità per:

- Connessione al Layer-2 e gestione degli account
- Creazione e invio di transazioni
- Interazione con il bridge tra Ethereum (L1) e Layer-2 Solana
- Integrazione con wallet Solana (Phantom, Backpack) ed Ethereum (MetaMask)

## Installazione

```bash
npm install layer2-solana-sdk
```

## Utilizzo Base

```typescript
import { createL2Client, WalletAdapterFactory } from 'layer2-solana-sdk';

// Crea un client L2 connesso al testnet
const client = createL2Client('https://testnet-node.layer2-solana.com');

// Verifica la connessione
const isConnected = await client.isConnected();
console.log(`Connesso al Layer-2: ${isConnected}`);

// Connetti un wallet Phantom
const phantomAdapter = WalletAdapterFactory.createPhantomAdapter();
await phantomAdapter.connect();
client.setWalletAdapter(phantomAdapter);

// Ottieni il saldo di un account
const balance = await client.account().getBalance(phantomAdapter.publicKey!);
console.log(`Saldo: ${balance} lamports`);
```

## Componenti Principali

### L2Client

Il punto di ingresso principale per interagire con il Layer-2 su Solana.

```typescript
import { L2Client } from 'layer2-solana-sdk';

// Crea un client connesso al devnet
const client = L2Client.devnet();

// Crea un client connesso al testnet
const client = L2Client.testnet();

// Crea un client connesso al mainnet
const client = L2Client.mainnet();

// Crea un client con opzioni personalizzate
const client = new L2Client({
  endpoint: 'https://custom-node.layer2-solana.com',
  commitment: 'confirmed',
  keypair: myKeypair // opzionale
});
```

### AccountManager

Gestisce gli account e i saldi sul Layer-2.

```typescript
// Ottieni il saldo di un account
const balance = await client.account().getBalance('11111111111111111111111111111111');

// Ottieni le informazioni di un account
const accountInfo = await client.account().getAccountInfo('11111111111111111111111111111111');

// Crea un nuovo account
const signature = await client.account().createAccount(fromKeypair, toPublicKey, 1000000);

// Trasferisci lamports
const signature = await client.account().transfer(fromKeypair, toPublicKey, 1000000);

// Verifica se un account esiste
const exists = await client.account().accountExists('11111111111111111111111111111111');
```

### TransactionManager

Gestisce la creazione e l'invio di transazioni sul Layer-2.

```typescript
// Invia una transazione
const result = await client.transaction().sendTransaction(transaction, [signer1, signer2]);

// Invia istruzioni
const result = await client.transaction().sendInstructions([instruction1, instruction2], [signer]);

// Ottieni i dettagli di una transazione
const txDetails = await client.transaction().getTransaction('tx_signature');

// Verifica lo stato di una transazione
const status = await client.transaction().getTransactionStatus('tx_signature');

// Attendi la conferma di una transazione
const confirmed = await client.transaction().waitForConfirmation('tx_signature', 30000);

// Simula una transazione
const simulation = await client.transaction().simulateTransaction(transaction, [signer]);
```

### BridgeManager

Gestisce il bridge tra Ethereum (L1) e Layer-2 Solana.

```typescript
// Inizializza il bridge
await client.bridge().initialize({
  l1BridgeAddress: '0x1234567890123456789012345678901234567890',
  l2BridgeAddress: '11111111111111111111111111111111',
  challengePeriod: 604800, // 7 giorni in secondi
  supportedTokens: {
    '0x0000000000000000000000000000000000000000': 'So11111111111111111111111111111111111111111', // ETH -> Wrapped SOL
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // USDC -> USDC
  }
});

// Ottieni lo stato del bridge
const bridgeState = await client.bridge().getState();

// Deposita ETH da L1 a L2
const deposit = await client.bridge().depositETH(
  '1000000000000000000', // 1 ETH in wei
  '11111111111111111111111111111111', // Indirizzo L2
  {
    onProgress: (status, data) => {
      console.log(`Stato deposito: ${status}`, data);
    }
  }
);

// Deposita token ERC20 da L1 a L2
const deposit = await client.bridge().depositERC20(
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
  '1000000', // 1 USDC (6 decimali)
  '11111111111111111111111111111111', // Indirizzo L2
  {
    onProgress: (status, data) => {
      console.log(`Stato deposito: ${status}`, data);
    }
  }
);

// Preleva ETH da L2 a L1
const withdrawal = await client.bridge().withdrawETH(
  '1000000000', // 1 SOL in lamports
  '0x1234567890123456789012345678901234567890', // Indirizzo L1
  keypair,
  {
    onProgress: (status, data) => {
      console.log(`Stato prelievo: ${status}`, data);
    }
  }
);

// Preleva token da L2 a L1
const withdrawal = await client.bridge().withdrawToken(
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC su Solana
  '1000000', // 1 USDC (6 decimali)
  '0x1234567890123456789012345678901234567890', // Indirizzo L1
  keypair,
  {
    onProgress: (status, data) => {
      console.log(`Stato prelievo: ${status}`, data);
    }
  }
);

// Ottieni lo stato di un deposito
const depositStatus = await client.bridge().getDepositStatus('deposit_id');

// Ottieni lo stato di un prelievo
const withdrawalStatus = await client.bridge().getWithdrawalStatus('withdrawal_id');

// Genera una prova di prelievo
const proof = await client.bridge().generateWithdrawalProof('withdrawal_id');

// Finalizza un prelievo su L1
const txHash = await client.bridge().finalizeWithdrawal(
  'withdrawal_id',
  proof,
  ethProvider
);

// Ottieni l'elenco dei depositi per un indirizzo
const deposits = await client.bridge().getDepositsForAddress('11111111111111111111111111111111', 10, 0);

// Ottieni l'elenco dei prelievi per un indirizzo
const withdrawals = await client.bridge().getWithdrawalsForAddress('11111111111111111111111111111111', 10, 0);
```

### Integrazione Wallet

L'SDK supporta l'integrazione con wallet Solana (Phantom, Backpack) ed Ethereum (MetaMask).

```typescript
import { WalletAdapterFactory } from 'layer2-solana-sdk';

// Crea un adapter per Phantom
const phantomAdapter = WalletAdapterFactory.createPhantomAdapter();
await phantomAdapter.connect();

// Crea un adapter per Backpack
const backpackAdapter = WalletAdapterFactory.createBackpackAdapter();
await backpackAdapter.connect();

// Crea un adapter per MetaMask
const metamaskAdapter = WalletAdapterFactory.createMetaMaskAdapter();
await metamaskAdapter.connect();

// Verifica se un wallet è installato
const isPhantomInstalled = WalletAdapterFactory.isWalletInstalled('phantom');
const isBackpackInstalled = WalletAdapterFactory.isWalletInstalled('backpack');
const isMetaMaskInstalled = WalletAdapterFactory.isWalletInstalled('metamask');

// Ottieni l'elenco dei wallet supportati
const supportedWallets = WalletAdapterFactory.getSupportedWallets();

// Imposta l'adapter del wallet nel client
client.setWalletAdapter(phantomAdapter);

// Firma una transazione con il wallet
const signedTx = await phantomAdapter.signTransaction(transaction);

// Firma un messaggio con il wallet
const signedMessage = await phantomAdapter.signMessage(message);

// Invia una transazione con il wallet
const signature = await phantomAdapter.sendTransaction(transaction);
```

## Esempi Completi

### Deposito e Prelievo

```typescript
import { createL2Client, WalletAdapterFactory } from 'layer2-solana-sdk';
import { ethers } from 'ethers';

// Inizializza il client L2
const client = createL2Client('https://testnet-node.layer2-solana.com');

// Configura il bridge
await client.bridge().initialize({
  l1BridgeAddress: '0x1234567890123456789012345678901234567890',
  l2BridgeAddress: '11111111111111111111111111111111',
  challengePeriod: 604800, // 7 giorni in secondi
  supportedTokens: {
    '0x0000000000000000000000000000000000000000': 'So11111111111111111111111111111111111111111',
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  }
});

// Connetti wallet Ethereum (MetaMask)
const metamaskAdapter = WalletAdapterFactory.createMetaMaskAdapter();
await metamaskAdapter.connect();

// Connetti wallet Solana (Phantom)
const phantomAdapter = WalletAdapterFactory.createPhantomAdapter();
await phantomAdapter.connect();
client.setWalletAdapter(phantomAdapter);

// Deposita ETH da L1 a L2
const deposit = await client.bridge().depositETH(
  '1000000000000000000', // 1 ETH in wei
  phantomAdapter.publicKey!, // Indirizzo L2
  {
    onProgress: (status, data) => {
      console.log(`Stato deposito: ${status}`, data);
    }
  }
);

// Attendi che il deposito sia completato
console.log(`Deposito iniziato con ID: ${deposit.id}`);
console.log(`Transazione L1: ${deposit.l1TxHash}`);

// Verifica il saldo su L2 dopo il deposito
const balance = await client.account().getBalance(phantomAdapter.publicKey!);
console.log(`Saldo su L2: ${balance} lamports`);

// Preleva ETH da L2 a L1
const withdrawal = await client.bridge().withdrawETH(
  '500000000000000000', // 0.5 ETH in wei
  metamaskAdapter.publicKey!, // Indirizzo L1
  phantomKeypair, // Keypair Solana
  {
    onProgress: (status, data) => {
      console.log(`Stato prelievo: ${status}`, data);
    }
  }
);

// Attendi che il prelievo sia completato
console.log(`Prelievo iniziato con ID: ${withdrawal.id}`);
console.log(`Transazione L2: ${withdrawal.l2TxSignature}`);
console.log(`Periodo di contestazione: ${withdrawal.challengePeriod} secondi`);
console.log(`Fine periodo di contestazione: ${new Date(withdrawal.challengeEndTimestamp! * 1000)}`);

// Dopo il periodo di contestazione, finalizza il prelievo
const ethProvider = new ethers.providers.Web3Provider(window.ethereum);
const proof = await client.bridge().generateWithdrawalProof(withdrawal.id);
const txHash = await client.bridge().finalizeWithdrawal(
  withdrawal.id,
  proof,
  ethProvider
);

console.log(`Prelievo finalizzato con transazione L1: ${txHash}`);
```

### Trasferimento di Token su L2

```typescript
import { createL2Client, WalletAdapterFactory } from 'layer2-solana-sdk';
import { PublicKey, Keypair } from '@solana/web3.js';

// Inizializza il client L2
const client = createL2Client('https://testnet-node.layer2-solana.com');

// Connetti wallet Solana (Phantom)
const phantomAdapter = WalletAdapterFactory.createPhantomAdapter();
await phantomAdapter.connect();
client.setWalletAdapter(phantomAdapter);

// Ottieni il saldo dell'account
const balance = await client.account().getBalance(phantomAdapter.publicKey!);
console.log(`Saldo: ${balance} lamports`);

// Trasferisci token a un altro account
const destinationAddress = new PublicKey('11111111111111111111111111111111');
const amount = 100000000; // 0.1 SOL in lamports

// Ottieni il keypair dal wallet
const keypair = Keypair.fromSecretKey(/* ... */);

// Esegui il trasferimento
const result = await client.account().transfer(keypair, destinationAddress, amount);

// Verifica lo stato della transazione
const status = await client.transaction().getTransactionStatus(result);
console.log(`Stato transazione: ${status}`);

// Attendi la conferma della transazione
const confirmed = await client.transaction().waitForConfirmation(result, 30000);
console.log(`Transazione confermata: ${confirmed}`);

// Ottieni il nuovo saldo
const newBalance = await client.account().getBalance(phantomAdapter.publicKey!);
console.log(`Nuovo saldo: ${newBalance} lamports`);
```

## Tipi di Dati

L'SDK fornisce definizioni TypeScript complete per tutti i tipi di dati utilizzati.

```typescript
// Informazioni di un account
interface AccountInfo {
  address: string;
  lamports: number;
  owner: string;
  executable: boolean;
  rentEpoch: number;
  data: Buffer | Uint8Array;
}

// Risultato di una transazione
interface TransactionResult {
  success: boolean;
  signature: string | null;
  error: Error | null;
}

// Opzioni per una transazione
interface TransactionOptions {
  commitment?: 'processed' | 'confirmed' | 'finalized';
  preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
  skipPreflight?: boolean;
}

// Informazioni di un token
interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
}

// Informazioni di un deposito
interface DepositInfo {
  id: string;
  fromAddress: string;
  toAddress: string;
  tokenAddress: string;
  amount: string;
  timestamp: number;
  status: 'pending' | 'completed' | 'failed';
  l1TxHash: string;
  l2TxSignature?: string;
}

// Informazioni di un prelievo
interface WithdrawalInfo {
  id: string;
  fromAddress: string;
  toAddress: string;
  tokenAddress: string;
  amount: string;
  timestamp: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  l2TxSignature: string;
  l1TxHash?: string;
  challengePeriod: number;
  challengeEndTimestamp?: number;
}

// Configurazione del bridge
interface BridgeConfig {
  l1BridgeAddress: string;
  l2BridgeAddress: string;
  challengePeriod: number;
  supportedTokens: {
    [l1TokenAddress: string]: string;
  };
}

// Stato del bridge
interface BridgeState {
  totalDeposits: number;
  totalWithdrawals: number;
  totalValueLocked: string;
  operational: boolean;
  lastProcessedL1Block: number;
  lastFinalizedL2Block: number;
}

// Opzioni per il deposito
interface DepositOptions {
  gasLimit?: number;
  gasPrice?: string;
  onProgress?: (status: 'initiated' | 'l1_confirmed' | 'l2_processing' | 'completed', data?: any) => void;
}

// Opzioni per il prelievo
interface WithdrawalOptions {
  onProgress?: (status: 'initiated' | 'l2_confirmed' | 'challenge_period' | 'l1_processing' | 'completed', data?: any) => void;
  immediate?: boolean;
}

// Prova di prelievo
interface WithdrawalProof {
  withdrawalId: string;
  fromAddress: string;
  toAddress: string;
  tokenAddress: string;
  amount: string;
  stateRoot: string;
  merkleProof: string[];
  l2BlockIndex: number;
  l2BlockTimestamp: number;
  l2TxSignature: string;
}
```

## Gestione degli Errori

L'SDK fornisce gestione degli errori completa per tutte le operazioni.

```typescript
try {
  const result = await client.transaction().sendTransaction(transaction, [signer]);
  if (result.success) {
    console.log(`Transazione inviata con successo: ${result.signature}`);
  } else {
    console.error(`Errore nell'invio della transazione: ${result.error?.message}`);
  }
} catch (error) {
  console.error('Errore imprevisto:', error);
}
```

## Compatibilità Browser e Node.js

L'SDK è compatibile sia con ambienti browser che Node.js.

```typescript
// Browser
import { createL2Client } from 'layer2-solana-sdk';
const client = createL2Client('https://testnet-node.layer2-solana.com');

// Node.js
const { createL2Client } = require('layer2-solana-sdk');
const client = createL2Client('https://testnet-node.layer2-solana.com');
```

## Licenza

MIT
