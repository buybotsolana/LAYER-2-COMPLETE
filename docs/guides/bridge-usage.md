# Guida all'Utilizzo del Bridge

Questa guida dettagliata spiega come utilizzare il bridge bidirezionale tra Ethereum (L1) e il Layer-2 su Solana per trasferire asset in modo sicuro e trustless.

## Introduzione

Il bridge è un componente fondamentale che consente di spostare asset tra Ethereum e il Layer-2 su Solana. Supporta sia ETH nativo che token ERC20 (inizialmente USDC e DAI). Questa guida copre entrambe le direzioni di trasferimento:

1. **Deposito**: Da Ethereum (L1) al Layer-2 su Solana
2. **Prelievo**: Dal Layer-2 su Solana a Ethereum (L1)

## Prerequisiti

Prima di iniziare, assicurati di avere:

- Un wallet Ethereum con ETH per le commissioni di gas
- Un wallet Solana configurato per il Layer-2
- Gli asset che desideri trasferire (ETH, USDC, o DAI)
- La SDK del Layer-2 installata (`npm install @l2-solana/sdk`)

## Deposito da Ethereum (L1) al Layer-2

### Deposito di ETH

#### Tramite Interfaccia Web

1. Visita il portale bridge all'indirizzo https://bridge.l2-solana.example.com
2. Connetti il tuo wallet Ethereum (Metamask, WalletConnect, ecc.)
3. Seleziona "Deposito" e scegli "ETH" come asset
4. Inserisci l'importo da depositare
5. Inserisci l'indirizzo del destinatario su Layer-2 (pubkey Solana)
6. Clicca su "Deposita" e conferma la transazione nel tuo wallet
7. Attendi la conferma della transazione su Ethereum
8. Il deposito sarà disponibile sul Layer-2 dopo circa 5-10 minuti

#### Tramite SDK

```javascript
const { ethers } = require('ethers');
const { L2Client } = require('@l2-solana/sdk');
const { PublicKey } = require('@solana/web3.js');

// Configurazione Ethereum
const provider = new ethers.providers.Web3Provider(window.ethereum);
await provider.send("eth_requestAccounts", []);
const signer = provider.getSigner();

// Carica l'ABI del contratto di deposito
const depositBridgeAbi = require('@l2-solana/sdk/abis/L1ToL2DepositBridge.json');
const depositBridgeAddress = '0x123...'; // Indirizzo del contratto di deposito

// Crea un'istanza del contratto
const depositBridge = new ethers.Contract(depositBridgeAddress, depositBridgeAbi, signer);

// Indirizzo del destinatario su L2 (Solana pubkey)
const l2RecipientPublicKey = new PublicKey('your_l2_recipient_pubkey');

async function depositEth() {
  // Importo da depositare (in ETH)
  const amount = ethers.utils.parseEther('1.0'); // 1 ETH
  
  // Converti la pubkey Solana in un buffer
  const l2RecipientBuffer = Buffer.from(l2RecipientPublicKey.toBytes());
  
  // Esegui il deposito
  const tx = await depositBridge.deposit(l2RecipientBuffer, {
    value: amount,
    gasLimit: 200000
  });
  
  console.log(`Transazione inviata: ${tx.hash}`);
  
  // Attendi la conferma della transazione
  const receipt = await tx.wait();
  console.log(`Deposito confermato nel blocco ${receipt.blockNumber}`);
  
  // Connessione al Layer-2 per monitorare il deposito
  const l2 = new L2Client('https://rpc.l2-solana.example.com');
  
  // Funzione per verificare il saldo
  async function checkBalance() {
    const balance = await l2.getBalance(l2RecipientPublicKey);
    console.log(`Saldo su L2: ${ethers.utils.formatEther(balance)} ETH`);
    return balance;
  }
  
  // Verifica il saldo iniziale
  const initialBalance = await checkBalance();
  
  // Monitora il saldo fino a quando il deposito non viene accreditato
  console.log('In attesa che il deposito venga accreditato su L2...');
  
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      const currentBalance = await checkBalance();
      
      if (currentBalance.gt(initialBalance)) {
        clearInterval(interval);
        console.log('Deposito accreditato con successo su L2!');
        resolve(currentBalance);
      }
    }, 30000); // Controlla ogni 30 secondi
  });
}
```

### Deposito di Token ERC20 (USDC, DAI)

#### Tramite Interfaccia Web

1. Visita il portale bridge all'indirizzo https://bridge.l2-solana.example.com
2. Connetti il tuo wallet Ethereum (Metamask, WalletConnect, ecc.)
3. Seleziona "Deposito" e scegli il token desiderato (USDC o DAI)
4. Inserisci l'importo da depositare
5. Inserisci l'indirizzo del destinatario su Layer-2 (pubkey Solana)
6. Clicca su "Deposita"
7. Approva l'accesso al token (se è la prima volta)
8. Conferma la transazione di deposito
9. Attendi la conferma della transazione su Ethereum
10. Il deposito sarà disponibile sul Layer-2 dopo circa 5-10 minuti

#### Tramite SDK

```javascript
const { ethers } = require('ethers');
const { L2Client } = require('@l2-solana/sdk');
const { PublicKey } = require('@solana/web3.js');

// Configurazione Ethereum
const provider = new ethers.providers.Web3Provider(window.ethereum);
await provider.send("eth_requestAccounts", []);
const signer = provider.getSigner();

// Carica l'ABI del contratto di deposito
const depositBridgeAbi = require('@l2-solana/sdk/abis/L1ToL2DepositBridge.json');
const depositBridgeAddress = '0x123...'; // Indirizzo del contratto di deposito

// Carica l'ABI del token ERC20
const erc20Abi = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)"
];

// Indirizzi dei token (mainnet)
const tokenAddresses = {
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F'
};

// Crea un'istanza del contratto di deposito
const depositBridge = new ethers.Contract(depositBridgeAddress, depositBridgeAbi, signer);

// Indirizzo del destinatario su L2 (Solana pubkey)
const l2RecipientPublicKey = new PublicKey('your_l2_recipient_pubkey');

async function depositToken(tokenSymbol, amount) {
  // Verifica che il token sia supportato
  if (!tokenAddresses[tokenSymbol]) {
    throw new Error(`Token ${tokenSymbol} non supportato`);
  }
  
  const tokenAddress = tokenAddresses[tokenSymbol];
  const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, signer);
  
  // Ottieni il numero di decimali del token
  const decimals = await tokenContract.decimals();
  
  // Converti l'importo in unità del token
  const tokenAmount = ethers.utils.parseUnits(amount.toString(), decimals);
  
  // Verifica il saldo
  const balance = await tokenContract.balanceOf(await signer.getAddress());
  if (balance.lt(tokenAmount)) {
    throw new Error(`Saldo insufficiente. Hai ${ethers.utils.formatUnits(balance, decimals)} ${tokenSymbol}`);
  }
  
  console.log(`Depositando ${amount} ${tokenSymbol} su L2...`);
  
  // Approva il contratto di deposito a spendere i token
  console.log('Approvando il contratto di deposito...');
  const approveTx = await tokenContract.approve(depositBridgeAddress, tokenAmount);
  await approveTx.wait();
  console.log('Approvazione completata');
  
  // Converti la pubkey Solana in un buffer
  const l2RecipientBuffer = Buffer.from(l2RecipientPublicKey.toBytes());
  
  // Esegui il deposito
  console.log('Eseguendo il deposito...');
  const tx = await depositBridge.depositERC20(
    tokenAddress,
    tokenAmount,
    l2RecipientBuffer,
    { gasLimit: 300000 }
  );
  
  console.log(`Transazione inviata: ${tx.hash}`);
  
  // Attendi la conferma della transazione
  const receipt = await tx.wait();
  console.log(`Deposito confermato nel blocco ${receipt.blockNumber}`);
  
  // Connessione al Layer-2 per monitorare il deposito
  const l2 = new L2Client('https://rpc.l2-solana.example.com');
  
  console.log('In attesa che il deposito venga accreditato su L2...');
  console.log('Questo processo può richiedere 5-10 minuti.');
  
  // Funzione per verificare il saldo del token su L2
  async function checkTokenBalance() {
    const balance = await l2.getTokenBalance(l2RecipientPublicKey, tokenSymbol);
    console.log(`Saldo ${tokenSymbol} su L2: ${ethers.utils.formatUnits(balance, decimals)}`);
    return balance;
  }
  
  // Verifica il saldo iniziale
  const initialBalance = await checkTokenBalance();
  
  // Monitora il saldo fino a quando il deposito non viene accreditato
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      const currentBalance = await checkTokenBalance();
      
      if (currentBalance.gt(initialBalance)) {
        clearInterval(interval);
        console.log('Deposito accreditato con successo su L2!');
        resolve(currentBalance);
      }
    }, 30000); // Controlla ogni 30 secondi
  });
}

// Esempio di utilizzo
// depositToken('USDC', 100); // Deposita 100 USDC
// depositToken('DAI', 50);   // Deposita 50 DAI
```

## Prelievo dal Layer-2 a Ethereum (L1)

Il processo di prelievo richiede due passaggi:

1. Iniziare il prelievo su Layer-2
2. Completare il prelievo su Ethereum dopo il periodo di contestazione (7 giorni)

### Iniziare il Prelievo su Layer-2

#### Tramite Interfaccia Web

1. Visita il portale bridge all'indirizzo https://bridge.l2-solana.example.com
2. Connetti il tuo wallet Solana (Phantom, Solflare, ecc.)
3. Seleziona "Prelievo" e scegli l'asset da prelevare (ETH, USDC, o DAI)
4. Inserisci l'importo da prelevare
5. Inserisci l'indirizzo del destinatario su Ethereum
6. Clicca su "Preleva" e conferma la transazione
7. Prendi nota dell'ID di prelievo mostrato (necessario per completare il prelievo)
8. Attendi 7 giorni per il periodo di contestazione

#### Tramite SDK

```javascript
const { L2Client } = require('@l2-solana/sdk');
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

// Carica il keypair Solana
const privateKey = bs58.decode('your_private_key_here');
const keypair = Keypair.fromSecretKey(privateKey);

// Connessione al Layer-2
const l2 = new L2Client('https://rpc.l2-solana.example.com');

// Indirizzo Ethereum del destinatario
const ethRecipientAddress = '0xYourEthereumAddress';

async function initiateWithdrawal(asset, amount) {
  console.log(`Iniziando il prelievo di ${amount} ${asset} a ${ethRecipientAddress}...`);
  
  let withdrawalId;
  
  if (asset === 'ETH') {
    // Converti l'importo in lamports (1 ETH = 10^18 wei)
    const lamports = BigInt(amount * 1e18);
    
    // Inizia il prelievo di ETH
    withdrawalId = await l2.initiateWithdrawal(
      keypair,
      ethRecipientAddress,
      lamports
    );
  } else {
    // Per token (USDC, DAI)
    // Ottieni i decimali del token
    const tokenInfo = await l2.getTokenInfo(asset);
    const tokenAmount = BigInt(amount * 10**tokenInfo.decimals);
    
    // Inizia il prelievo del token
    withdrawalId = await l2.initiateTokenWithdrawal(
      keypair,
      ethRecipientAddress,
      asset,
      tokenAmount
    );
  }
  
  console.log('Prelievo iniziato con ID:', withdrawalId);
  console.log('Il prelievo sarà disponibile su Ethereum dopo il periodo di contestazione (7 giorni)');
  console.log('Salva questo ID per completare il prelievo su Ethereum');
  
  // Calcola la data di disponibilità
  const now = new Date();
  const availableDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  console.log('Data di disponibilità stimata:', availableDate.toLocaleString());
  
  return withdrawalId;
}

// Esempio di utilizzo
// initiateWithdrawal('ETH', 0.5);    // Preleva 0.5 ETH
// initiateWithdrawal('USDC', 100);   // Preleva 100 USDC
// initiateWithdrawal('DAI', 50);     // Preleva 50 DAI
```

### Completare il Prelievo su Ethereum

#### Tramite Interfaccia Web

1. Dopo 7 giorni, visita il portale bridge all'indirizzo https://bridge.l2-solana.example.com
2. Connetti il tuo wallet Ethereum
3. Vai alla sezione "Completa Prelievo"
4. Inserisci l'ID di prelievo
5. Clicca su "Completa Prelievo" e conferma la transazione
6. Attendi la conferma della transazione
7. I fondi saranno disponibili nel tuo wallet Ethereum

#### Tramite SDK

```javascript
const { ethers } = require('ethers');

// Configurazione Ethereum
const provider = new ethers.providers.Web3Provider(window.ethereum);
await provider.send("eth_requestAccounts", []);
const signer = provider.getSigner();

// Carica l'ABI del contratto di prelievo
const withdrawalBridgeAbi = require('@l2-solana/sdk/abis/L2ToL1WithdrawalBridge.json');
const withdrawalBridgeAddress = '0x456...'; // Indirizzo del contratto di prelievo

// Crea un'istanza del contratto
const withdrawalBridge = new ethers.Contract(withdrawalBridgeAddress, withdrawalBridgeAbi, signer);

// ID del prelievo da completare
const withdrawalId = 123; // Sostituisci con l'ID del tuo prelievo

async function completeWithdrawal(withdrawalId) {
  console.log(`Completando il prelievo con ID ${withdrawalId}...`);
  
  // Verifica se il prelievo è pronto
  const isReady = await withdrawalBridge.isWithdrawalReady(withdrawalId);
  
  if (!isReady) {
    const challengePeriod = await withdrawalBridge.getChallengePeriod();
    const withdrawalInfo = await withdrawalBridge.getWithdrawal(withdrawalId);
    const submissionTime = withdrawalInfo.submissionTime.toNumber();
    const currentTime = Math.floor(Date.now() / 1000);
    const timeElapsed = currentTime - submissionTime;
    const timeRemaining = challengePeriod.toNumber() - timeElapsed;
    
    if (timeRemaining > 0) {
      const days = Math.floor(timeRemaining / (24 * 60 * 60));
      const hours = Math.floor((timeRemaining % (24 * 60 * 60)) / (60 * 60));
      
      console.error(`Il prelievo non è ancora pronto. Tempo rimanente: ${days} giorni e ${hours} ore.`);
      return;
    }
  }
  
  // Completa il prelievo
  const tx = await withdrawalBridge.completeWithdrawal(withdrawalId, {
    gasLimit: 200000
  });
  
  console.log(`Transazione inviata: ${tx.hash}`);
  
  // Attendi la conferma della transazione
  const receipt = await tx.wait();
  console.log(`Transazione confermata nel blocco ${receipt.blockNumber}`);
  console.log('Prelievo completato con successo!');
  
  // Ottieni informazioni sul prelievo
  const withdrawalInfo = await withdrawalBridge.getWithdrawal(withdrawalId);
  
  // Verifica il tipo di asset
  if (withdrawalInfo.token === ethers.constants.AddressZero) {
    // Prelievo di ETH
    console.log(`Hai ricevuto ${ethers.utils.formatEther(withdrawalInfo.amount)} ETH`);
  } else {
    // Prelievo di token ERC20
    const tokenContract = new ethers.Contract(withdrawalInfo.token, [
      "function symbol() external view returns (string)",
      "function decimals() external view returns (uint8)"
    ], provider);
    
    const symbol = await tokenContract.symbol();
    const decimals = await tokenContract.decimals();
    
    console.log(`Hai ricevuto ${ethers.utils.formatUnits(withdrawalInfo.amount, decimals)} ${symbol}`);
  }
  
  return receipt;
}

// Esempio di utilizzo
// completeWithdrawal(123); // Completa il prelievo con ID 123
```

## Monitoraggio dei Depositi e Prelievi

### Monitoraggio dei Depositi

```javascript
const { L2Client } = require('@l2-solana/sdk');
const { PublicKey } = require('@solana/web3.js');

// Connessione al Layer-2
const l2 = new L2Client('https://rpc.l2-solana.example.com');

// Indirizzo L2 da monitorare
const l2Address = new PublicKey('your_l2_address');

async function monitorDeposits() {
  // Ottieni la cronologia dei depositi
  const deposits = await l2.getDepositHistory(l2Address);
  
  console.log(`Trovati ${deposits.length} depositi:`);
  
  deposits.forEach((deposit, index) => {
    console.log(`Deposito #${index + 1}:`);
    console.log(`  L1 Sender: ${deposit.l1Sender}`);
    console.log(`  Asset: ${deposit.asset}`);
    console.log(`  Amount: ${deposit.amount}`);
    console.log(`  Timestamp: ${new Date(deposit.timestamp * 1000).toLocaleString()}`);
    console.log(`  Transaction Hash: ${deposit.txHash}`);
    console.log(`  Status: ${deposit.status}`);
    console.log('---');
  });
  
  return deposits;
}
```

### Monitoraggio dei Prelievi

```javascript
const { L2Client } = require('@l2-solana/sdk');
const { PublicKey } = require('@solana/web3.js');
const { ethers } = require('ethers');

// Connessione al Layer-2
const l2 = new L2Client('https://rpc.l2-solana.example.com');

// Configurazione Ethereum
const provider = new ethers.providers.JsonRpcProvider('https://mainnet.infura.io/v3/your_infura_key');

// Carica l'ABI del contratto di prelievo
const withdrawalBridgeAbi = require('@l2-solana/sdk/abis/L2ToL1WithdrawalBridge.json');
const withdrawalBridgeAddress = '0x456...'; // Indirizzo del contratto di prelievo

// Crea un'istanza del contratto
const withdrawalBridge = new ethers.Contract(withdrawalBridgeAddress, withdrawalBridgeAbi, provider);

// Indirizzo L2 da monitorare
const l2Address = new PublicKey('your_l2_address');

// Indirizzo L1 da monitorare
const l1Address = '0xYourEthereumAddress';

async function monitorWithdrawals() {
  // Ottieni la cronologia dei prelievi da L2
  const l2Withdrawals = await l2.getWithdrawalHistory(l2Address);
  
  console.log(`Trovati ${l2Withdrawals.length} prelievi iniziati su L2:`);
  
  for (const withdrawal of l2Withdrawals) {
    console.log(`Prelievo ID: ${withdrawal.id}`);
    console.log(`  L1 Recipient: ${withdrawal.l1Recipient}`);
    console.log(`  Asset: ${withdrawal.asset}`);
    console.log(`  Amount: ${withdrawal.amount}`);
    console.log(`  Timestamp: ${new Date(withdrawal.timestamp * 1000).toLocaleString()}`);
    
    // Verifica lo stato su L1
    try {
      const l1Status = await withdrawalBridge.getWithdrawalStatus(withdrawal.id);
      
      let statusText;
      switch (l1Status) {
        case 0: statusText = "Non Esistente"; break;
        case 1: statusText = "In Attesa"; break;
        case 2: statusText = "Pronto"; break;
        case 3: statusText = "Completato"; break;
        default: statusText = "Sconosciuto";
      }
      
      console.log(`  Stato su L1: ${statusText}`);
      
      if (l1Status === 1) { // In Attesa
        const challengePeriod = await withdrawalBridge.getChallengePeriod();
        const withdrawalInfo = await withdrawalBridge.getWithdrawal(withdrawal.id);
        const submissionTime = withdrawalInfo.submissionTime.toNumber();
        const currentTime = Math.floor(Date.now() / 1000);
        const timeElapsed = currentTime - submissionTime;
        const timeRemaining = challengePeriod.toNumber() - timeElapsed;
        
        if (timeRemaining > 0) {
          const days = Math.floor(timeRemaining / (24 * 60 * 60));
          const hours = Math.floor((timeRemaining % (24 * 60 * 60)) / (60 * 60));
          
          console.log(`  Tempo rimanente: ${days} giorni e ${hours} ore`);
        } else {
          console.log(`  Pronto per essere completato!`);
        }
      }
    } catch (error) {
      console.log(`  Errore nel recupero dello stato su L1: ${error.message}`);
    }
    
    console.log('---');
  }
  
  // Ottieni i prelievi completati su L1
  const filter = withdrawalBridge.filters.WithdrawalCompleted(null, l1Address);
  const events = await withdrawalBridge.queryFilter(filter);
  
  console.log(`Trovati ${events.length} prelievi completati su L1:`);
  
  for (const event of events) {
    const withdrawalId = event.args.withdrawalId.toString();
    const recipient = event.args.recipient;
    const amount = event.args.amount;
    const token = event.args.token;
    
    console.log(`Prelievo Completato ID: ${withdrawalId}`);
    console.log(`  Recipient: ${recipient}`);
    
    if (token === ethers.constants.AddressZero) {
      console.log(`  Asset: ETH`);
      console.log(`  Amount: ${ethers.utils.formatEther(amount)} ETH`);
    } else {
      try {
        const tokenContract = new ethers.Contract(token, [
          "function symbol() external view returns (string)",
          "function decimals() external view returns (uint8)"
        ], provider);
        
        const symbol = await tokenContract.symbol();
        const decimals = await tokenContract.decimals();
        
        console.log(`  Asset: ${symbol}`);
        console.log(`  Amount: ${ethers.utils.formatUnits(amount, decimals)} ${symbol}`);
      } catch (error) {
        console.log(`  Asset: Token (${token})`);
        console.log(`  Amount: ${amount.toString()}`);
      }
    }
    
    console.log(`  Block: ${event.blockNumber}`);
    console.log(`  Transaction: ${event.transactionHash}`);
    console.log('---');
  }
}
```

## Considerazioni sulla Sicurezza

### Periodo di Contestazione

I prelievi dal Layer-2 a Ethereum richiedono un periodo di contestazione di 7 giorni. Questo è un meccanismo di sicurezza fondamentale del rollup ottimistico che garantisce che solo le transizioni di stato valide vengano finalizzate.

Durante questo periodo:
- I fondi sono bloccati nel contratto bridge
- Il prelievo può essere contestato se si rileva una frode
- Nessuno può completare il prelievo fino alla fine del periodo

### Verifica degli Indirizzi

Quando effettui depositi o prelievi, verifica sempre attentamente gli indirizzi:

1. **Per i depositi**: Assicurati che l'indirizzo del destinatario su Layer-2 (pubkey Solana) sia corretto. Un errore nell'indirizzo potrebbe causare la perdita permanente dei fondi.

2. **Per i prelievi**: Verifica che l'indirizzo Ethereum del destinatario sia corretto. Anche in questo caso, un errore potrebbe causare la perdita dei fondi.

### Limiti di Deposito e Prelievo

Il bridge ha limiti configurati per motivi di sicurezza:

- **Limiti di deposito**: Importi massimi che possono essere depositati in un'unica transazione o in un periodo di tempo
- **Limiti di prelievo**: Importi massimi che possono essere prelevati in un'unica transazione o in un periodo di tempo

Questi limiti possono variare in base all'asset e possono essere modificati nel tempo. Consulta la documentazione aggiornata o l'interfaccia del bridge per i limiti attuali.

## Risoluzione dei Problemi

### Deposito non Ricevuto su L2

1. **Verifica la transazione su Ethereum**:
   - Controlla che la transazione di deposito sia stata confermata su Ethereum
   - Verifica che l'evento `DepositInitiated` sia stato emesso correttamente

2. **Attendi il tempo necessario**:
   - I depositi richiedono generalmente 5-10 minuti per essere elaborati
   - In periodi di congestione, potrebbe richiedere più tempo

3. **Verifica l'indirizzo del destinatario**:
   - Assicurati che l'indirizzo del destinatario su L2 sia corretto
   - Controlla che il formato della pubkey Solana sia valido

4. **Controlla lo stato del sequencer**:
   - Verifica lo stato del sequencer su https://status.l2-solana.example.com
   - Se il sequencer è inattivo, i depositi potrebbero essere ritardati

5. **Contatta il supporto**:
   - Se il problema persiste, contatta il supporto fornendo l'hash della transazione di deposito

### Prelievo non Completabile

1. **Verifica il periodo di contestazione**:
   - Assicurati che siano passati 7 giorni dall'inizio del prelievo
   - Utilizza la funzione `isWithdrawalReady` per verificare lo stato

2. **Controlla l'ID del prelievo**:
   - Verifica che l'ID del prelievo sia corretto
   - Assicurati di utilizzare l'ID esatto fornito durante l'iniziazione del prelievo

3. **Verifica che il prelievo non sia già stato completato**:
   - Utilizza la funzione `getWithdrawalStatus` per verificare lo stato
   - Un prelievo può essere completato solo una volta

4. **Assicurati di avere ETH sufficiente per il gas**:
   - La transazione di completamento richiede gas su Ethereum
   - Assicurati di avere ETH sufficiente nel tuo wallet

5. **Verifica la rete corretta**:
   - Assicurati di essere connesso alla rete Ethereum corretta (mainnet o testnet)
   - Verifica che l'indirizzo del contratto bridge sia corretto per la rete

## Risorse Aggiuntive

- [Documentazione API completa](../api-reference/l2-node-api.md)
- [Riferimento Smart Contract](../api-reference/smart-contracts.md)
- [Guida Introduttiva](getting-started.md)
- [Simulazione di Sfida](challenge-simulation.md)
- [Esecuzione di un Nodo](running-a-node.md)

## Supporto

Se hai domande o problemi con il bridge, puoi:

- Aprire una issue su GitHub: https://github.com/buybotsolana/LAYER-2-COMPLETE/issues
- Contattare il team via email: buybotsolana@tech-center.com
