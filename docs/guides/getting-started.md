# Guida Introduttiva al Layer-2 su Solana

Questa guida ti aiuterà a iniziare a utilizzare il Layer-2 su Solana, mostrando come configurare l'ambiente, creare un wallet, effettuare depositi, inviare transazioni e prelevare fondi.

## Prerequisiti

Prima di iniziare, assicurati di avere installato:

- Node.js v16 o superiore
- Rust 1.60 o superiore
- Solana CLI
- Metamask o altro wallet Ethereum
- Git

## Installazione

### 1. Clona il Repository

```bash
git clone https://github.com/buybotsolana/LAYER-2-COMPLETE.git
cd LAYER-2-COMPLETE
```

### 2. Installa le Dipendenze

```bash
# Installa le dipendenze JavaScript
npm install

# Compila i contratti Solidity
cd ethereum
npm install
npx hardhat compile
cd ..

# Compila i componenti Rust
cargo build --release
```

### 3. Configura l'Ambiente

Crea un file `.env` nella directory principale con le seguenti variabili:

```
# Ethereum
ETH_RPC_URL=https://mainnet.infura.io/v3/YOUR_INFURA_KEY
ETH_PRIVATE_KEY=your_ethereum_private_key_without_0x_prefix

# Solana
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_KEYPAIR_PATH=/path/to/your/solana/keypair.json

# Layer-2
L2_RPC_URL=https://rpc.l2-solana.example.com
```

Per l'ambiente di test, puoi utilizzare:

```
ETH_RPC_URL=https://goerli.infura.io/v3/YOUR_INFURA_KEY
SOLANA_RPC_URL=https://api.devnet.solana.com
L2_RPC_URL=https://testnet-rpc.l2-solana.example.com
```

## Creazione di un Wallet

### 1. Wallet Ethereum (L1)

Se non hai già un wallet Ethereum, puoi crearne uno con Metamask o utilizzare il seguente comando:

```bash
cd ethereum
npx hardhat run scripts/create-wallet.js
```

Questo comando genererà un nuovo wallet Ethereum e mostrerà l'indirizzo e la chiave privata. **Conserva la chiave privata in modo sicuro!**

### 2. Wallet Solana (L2)

Per creare un wallet Solana da utilizzare sul Layer-2:

```bash
solana-keygen new --outfile ~/.config/solana/l2-wallet.json
```

Questo comando genererà un nuovo keypair Solana e lo salverà nel file specificato. Prendi nota della pubkey mostrata.

## Connessione al Layer-2

### Utilizzo della SDK JavaScript

Crea un nuovo file `connect.js`:

```javascript
const { L2Client } = require('@l2-solana/sdk');
const { Connection, Keypair } = require('@solana/web3.js');
const fs = require('fs');

// Carica il keypair Solana
const keypairData = JSON.parse(fs.readFileSync('/path/to/your/l2-wallet.json', 'utf8'));
const keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));

// Connessione al Layer-2
const l2 = new L2Client('https://testnet-rpc.l2-solana.example.com');

async function main() {
  // Verifica la connessione
  const status = await l2.getStatus();
  console.log('Layer-2 Status:', status);
  
  // Verifica il saldo
  const balance = await l2.getBalance(keypair.publicKey);
  console.log('L2 Balance:', balance);
}

main().catch(console.error);
```

Esegui lo script:

```bash
node connect.js
```

## Deposito da Ethereum (L1) al Layer-2

### 1. Utilizzo della SDK JavaScript

Crea un nuovo file `deposit.js`:

```javascript
const { ethers } = require('ethers');
const { L2Client } = require('@l2-solana/sdk');
const { PublicKey } = require('@solana/web3.js');
require('dotenv').config();

// Configurazione Ethereum
const provider = new ethers.providers.JsonRpcProvider(process.env.ETH_RPC_URL);
const wallet = new ethers.Wallet(process.env.ETH_PRIVATE_KEY, provider);

// Carica l'ABI del contratto di deposito
const depositBridgeAbi = require('./ethereum/artifacts/contracts/L1ToL2DepositBridge.sol/L1ToL2DepositBridge.json').abi;
const depositBridgeAddress = '0x...'; // Indirizzo del contratto di deposito

// Crea un'istanza del contratto
const depositBridge = new ethers.Contract(depositBridgeAddress, depositBridgeAbi, wallet);

// Indirizzo del destinatario su L2 (Solana pubkey)
const l2RecipientPublicKey = new PublicKey('your_l2_recipient_pubkey');

async function depositEth() {
  // Importo da depositare (in ETH)
  const amount = ethers.utils.parseEther('0.1');
  
  console.log(`Depositando ${ethers.utils.formatEther(amount)} ETH su L2...`);
  
  // Converti la pubkey Solana in un buffer
  const l2RecipientBuffer = Buffer.from(l2RecipientPublicKey.toBytes());
  
  // Esegui il deposito
  const tx = await depositBridge.deposit(l2RecipientBuffer, {
    value: amount,
    gasLimit: 200000
  });
  
  console.log(`Transazione inviata: ${tx.hash}`);
  console.log('In attesa di conferma...');
  
  // Attendi la conferma della transazione
  const receipt = await tx.wait();
  console.log(`Transazione confermata nel blocco ${receipt.blockNumber}`);
  
  // Connessione al Layer-2 per verificare il deposito
  const l2 = new L2Client(process.env.L2_RPC_URL);
  
  console.log('Attendi qualche minuto affinché il deposito venga processato su L2...');
  console.log('Puoi verificare il saldo su L2 con lo script connect.js');
}

depositEth().catch(console.error);
```

### 2. Deposito di Token ERC20

Per depositare token ERC20 (come USDC o DAI), crea un file `deposit-erc20.js`:

```javascript
const { ethers } = require('ethers');
const { L2Client } = require('@l2-solana/sdk');
const { PublicKey } = require('@solana/web3.js');
require('dotenv').config();

// Configurazione Ethereum
const provider = new ethers.providers.JsonRpcProvider(process.env.ETH_RPC_URL);
const wallet = new ethers.Wallet(process.env.ETH_PRIVATE_KEY, provider);

// Carica l'ABI del contratto di deposito
const depositBridgeAbi = require('./ethereum/artifacts/contracts/L1ToL2DepositBridge.sol/L1ToL2DepositBridge.json').abi;
const depositBridgeAddress = '0x...'; // Indirizzo del contratto di deposito

// Carica l'ABI del token ERC20
const erc20Abi = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)"
];
const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC su Ethereum mainnet

// Crea istanze dei contratti
const depositBridge = new ethers.Contract(depositBridgeAddress, depositBridgeAbi, wallet);
const usdcToken = new ethers.Contract(usdcAddress, erc20Abi, wallet);

// Indirizzo del destinatario su L2 (Solana pubkey)
const l2RecipientPublicKey = new PublicKey('your_l2_recipient_pubkey');

async function depositUsdc() {
  // Importo da depositare (in USDC, con 6 decimali)
  const amount = ethers.utils.parseUnits('10', 6); // 10 USDC
  
  console.log(`Depositando 10 USDC su L2...`);
  
  // Verifica il saldo
  const balance = await usdcToken.balanceOf(wallet.address);
  console.log(`Saldo USDC: ${ethers.utils.formatUnits(balance, 6)} USDC`);
  
  if (balance.lt(amount)) {
    console.error('Saldo insufficiente');
    return;
  }
  
  // Approva il contratto di deposito a spendere i token
  console.log('Approvando il contratto di deposito...');
  const approveTx = await usdcToken.approve(depositBridgeAddress, amount);
  await approveTx.wait();
  console.log('Approvazione completata');
  
  // Converti la pubkey Solana in un buffer
  const l2RecipientBuffer = Buffer.from(l2RecipientPublicKey.toBytes());
  
  // Esegui il deposito
  console.log('Eseguendo il deposito...');
  const tx = await depositBridge.depositERC20(
    usdcAddress,
    amount,
    l2RecipientBuffer,
    { gasLimit: 300000 }
  );
  
  console.log(`Transazione inviata: ${tx.hash}`);
  console.log('In attesa di conferma...');
  
  // Attendi la conferma della transazione
  const receipt = await tx.wait();
  console.log(`Transazione confermata nel blocco ${receipt.blockNumber}`);
  
  console.log('Attendi qualche minuto affinché il deposito venga processato su L2...');
}

depositUsdc().catch(console.error);
```

## Invio di Transazioni su Layer-2

Una volta che hai fondi sul Layer-2, puoi inviare transazioni:

```javascript
const { L2Client } = require('@l2-solana/sdk');
const { Connection, Keypair, PublicKey, Transaction, SystemProgram } = require('@solana/web3.js');
const fs = require('fs');
require('dotenv').config();

// Carica il keypair Solana
const keypairData = JSON.parse(fs.readFileSync('/path/to/your/l2-wallet.json', 'utf8'));
const keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));

// Connessione al Layer-2
const l2 = new L2Client(process.env.L2_RPC_URL);

// Indirizzo del destinatario
const recipientPublicKey = new PublicKey('recipient_pubkey_here');

async function sendTransaction() {
  // Verifica il saldo
  const balance = await l2.getBalance(keypair.publicKey);
  console.log('Saldo attuale:', balance);
  
  // Importo da inviare (in lamports, 1 SOL = 1,000,000,000 lamports)
  const amount = 100000000; // 0.1 SOL
  
  if (balance < amount) {
    console.error('Saldo insufficiente');
    return;
  }
  
  // Crea una transazione
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: recipientPublicKey,
      lamports: amount,
    })
  );
  
  // Invia la transazione
  console.log('Inviando la transazione...');
  const signature = await l2.sendTransaction(transaction, keypair);
  
  console.log('Transazione inviata:', signature);
  console.log('In attesa di conferma...');
  
  // Attendi la conferma
  const confirmation = await l2.confirmTransaction(signature);
  console.log('Transazione confermata!');
  
  // Verifica il nuovo saldo
  const newBalance = await l2.getBalance(keypair.publicKey);
  console.log('Nuovo saldo:', newBalance);
}

sendTransaction().catch(console.error);
```

## Prelievo dal Layer-2 a Ethereum (L1)

Il processo di prelievo richiede due passaggi:

1. Iniziare il prelievo su L2
2. Completare il prelievo su L1 dopo il periodo di contestazione (7 giorni)

### 1. Iniziare il Prelievo su L2

```javascript
const { L2Client } = require('@l2-solana/sdk');
const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
require('dotenv').config();

// Carica il keypair Solana
const keypairData = JSON.parse(fs.readFileSync('/path/to/your/l2-wallet.json', 'utf8'));
const keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));

// Connessione al Layer-2
const l2 = new L2Client(process.env.L2_RPC_URL);

// Indirizzo Ethereum del destinatario
const ethRecipientAddress = '0xYourEthereumAddress';

async function initiateWithdrawal() {
  // Verifica il saldo
  const balance = await l2.getBalance(keypair.publicKey);
  console.log('Saldo attuale:', balance);
  
  // Importo da prelevare (in lamports, 1 SOL = 1,000,000,000 lamports)
  const amount = 500000000; // 0.5 SOL
  
  if (balance < amount) {
    console.error('Saldo insufficiente');
    return;
  }
  
  // Inizia il prelievo
  console.log(`Iniziando il prelievo di 0.5 SOL a ${ethRecipientAddress}...`);
  const withdrawalId = await l2.initiateWithdrawal(
    keypair,
    ethRecipientAddress,
    amount
  );
  
  console.log('Prelievo iniziato con ID:', withdrawalId);
  console.log('Il prelievo sarà disponibile su Ethereum dopo il periodo di contestazione (7 giorni)');
  console.log('Salva questo ID per completare il prelievo su Ethereum');
}

initiateWithdrawal().catch(console.error);
```

### 2. Completare il Prelievo su L1

Dopo 7 giorni, puoi completare il prelievo su Ethereum:

```javascript
const { ethers } = require('ethers');
require('dotenv').config();

// Configurazione Ethereum
const provider = new ethers.providers.JsonRpcProvider(process.env.ETH_RPC_URL);
const wallet = new ethers.Wallet(process.env.ETH_PRIVATE_KEY, provider);

// Carica l'ABI del contratto di prelievo
const withdrawalBridgeAbi = require('./ethereum/artifacts/contracts/L2ToL1WithdrawalBridge.sol/L2ToL1WithdrawalBridge.json').abi;
const withdrawalBridgeAddress = '0x...'; // Indirizzo del contratto di prelievo

// Crea un'istanza del contratto
const withdrawalBridge = new ethers.Contract(withdrawalBridgeAddress, withdrawalBridgeAbi, wallet);

// ID del prelievo da completare
const withdrawalId = 123; // Sostituisci con l'ID del tuo prelievo

async function completeWithdrawal() {
  console.log(`Completando il prelievo con ID ${withdrawalId}...`);
  
  // Verifica se il prelievo è pronto
  const isReady = await withdrawalBridge.isWithdrawalReady(withdrawalId);
  
  if (!isReady) {
    console.error('Il prelievo non è ancora pronto. Verifica che siano passati 7 giorni.');
    return;
  }
  
  // Completa il prelievo
  const tx = await withdrawalBridge.completeWithdrawal(withdrawalId, {
    gasLimit: 200000
  });
  
  console.log(`Transazione inviata: ${tx.hash}`);
  console.log('In attesa di conferma...');
  
  // Attendi la conferma della transazione
  const receipt = await tx.wait();
  console.log(`Transazione confermata nel blocco ${receipt.blockNumber}`);
  console.log('Prelievo completato con successo!');
}

completeWithdrawal().catch(console.error);
```

## Monitoraggio dello Stato di Finalizzazione

Per verificare lo stato di finalizzazione di un blocco L2:

```javascript
const { L2Client } = require('@l2-solana/sdk');
require('dotenv').config();

// Connessione al Layer-2
const l2 = new L2Client(process.env.L2_RPC_URL);

async function checkFinalization() {
  // Ottieni l'ultimo blocco
  const latestBlock = await l2.getLatestBlock();
  console.log('Ultimo blocco:', latestBlock.number);
  
  // Verifica lo stato di finalizzazione
  const finalizationStatus = await l2.getBlockFinalizationStatus(latestBlock.number);
  console.log('Stato di finalizzazione:', finalizationStatus);
  
  // Ottieni l'ultimo blocco finalizzato
  const latestFinalizedBlock = await l2.getLatestFinalizedBlock();
  console.log('Ultimo blocco finalizzato:', latestFinalizedBlock.number);
  
  // Calcola il tempo rimanente per la finalizzazione
  if (finalizationStatus === 'Submitted') {
    const submissionTime = latestBlock.timestamp;
    const currentTime = Math.floor(Date.now() / 1000);
    const challengePeriod = 7 * 24 * 60 * 60; // 7 giorni in secondi
    
    const timeElapsed = currentTime - submissionTime;
    const timeRemaining = challengePeriod - timeElapsed;
    
    const days = Math.floor(timeRemaining / (24 * 60 * 60));
    const hours = Math.floor((timeRemaining % (24 * 60 * 60)) / (60 * 60));
    
    console.log(`Tempo rimanente per la finalizzazione: ${days} giorni e ${hours} ore`);
  }
}

checkFinalization().catch(console.error);
```

## Risoluzione dei Problemi

### Deposito non Ricevuto su L2

1. Verifica che la transazione di deposito sia stata confermata su Ethereum
2. Attendi almeno 5-10 minuti per l'elaborazione del deposito
3. Verifica che l'indirizzo del destinatario L2 sia corretto
4. Controlla lo stato del sequencer su https://status.l2-solana.example.com

### Transazione Fallita su L2

1. Verifica di avere saldo sufficiente (incluse le commissioni)
2. Controlla che la transazione sia formattata correttamente
3. Verifica che il nonce sia corretto
4. Prova ad aumentare la priorità della transazione

### Prelievo non Completato

1. Verifica che siano passati 7 giorni dall'inizio del prelievo
2. Controlla che l'ID del prelievo sia corretto
3. Verifica che il prelievo non sia già stato completato
4. Assicurati di avere ETH sufficiente per pagare il gas della transazione di completamento

## Risorse Aggiuntive

- [Documentazione API completa](../api-reference/l2-node-api.md)
- [Riferimento Smart Contract](../api-reference/smart-contracts.md)
- [Guida al Bridge](bridge-usage.md)
- [Simulazione di Sfida](challenge-simulation.md)
- [Esecuzione di un Nodo](running-a-node.md)

## Supporto

Se hai domande o problemi, puoi:

- Aprire una issue su GitHub: https://github.com/buybotsolana/LAYER-2-COMPLETE/issues
- Contattare il team via email: buybotsolana@tech-center.com
