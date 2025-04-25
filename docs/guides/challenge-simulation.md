# Simulazione di Sfida (Challenge)

Questa guida spiega come simulare una sfida nel sistema di prove di frode del Layer-2 su Solana, permettendo agli sviluppatori di comprendere e testare il meccanismo di sicurezza fondamentale del rollup ottimistico.

## Introduzione

Il meccanismo di sfida (challenge) è un componente critico di sicurezza nel Layer-2 su Solana. Permette ai validatori di contestare transizioni di stato invalide, garantendo che solo gli stati validi vengano finalizzati. Questa guida ti mostrerà come simulare una sfida in un ambiente di test, aiutandoti a comprendere il funzionamento interno del sistema di prove di frode.

## Prerequisiti

Prima di iniziare, assicurati di avere:

- Un ambiente di sviluppo locale configurato
- Il repository clonato e le dipendenze installate
- Un ambiente di test locale in esecuzione (vedi [Guida Introduttiva](getting-started.md))
- Conoscenza base del funzionamento dei rollup ottimistici

## Configurazione dell'Ambiente di Test

### 1. Avvia l'Ambiente di Test Locale

```bash
# Dalla directory principale del progetto
cd scripts
./setup-local-testnet.sh
```

Questo script avvierà:
- Un nodo Ethereum locale (Hardhat)
- Un nodo Solana locale
- Un sequencer
- Un validator

### 2. Configura Account di Test

```bash
# Genera account di test
cd scripts
./generate-test-accounts.sh
```

Questo script genererà:
- Account Ethereum con ETH di test
- Account Solana con SOL di test
- Configurerà i contratti bridge
- Distribuirà token di test (USDC, DAI)

## Simulazione di una Transizione di Stato Valida

Prima di simulare una sfida, creiamo una transizione di stato valida come riferimento:

```javascript
const { L2Client } = require('@l2-solana/sdk');
const { Keypair, Transaction, SystemProgram } = require('@solana/web3.js');
const fs = require('fs');

// Carica il keypair Solana
const keypairData = JSON.parse(fs.readFileSync('./test-accounts/user1.json', 'utf8'));
const keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));

// Carica il keypair del destinatario
const recipientData = JSON.parse(fs.readFileSync('./test-accounts/user2.json', 'utf8'));
const recipientKeypair = Keypair.fromSecretKey(new Uint8Array(recipientData));

// Connessione al Layer-2 locale
const l2 = new L2Client('http://localhost:8080');

async function createValidTransaction() {
  // Verifica il saldo
  const balance = await l2.getBalance(keypair.publicKey);
  console.log('Saldo attuale:', balance);
  
  // Importo da inviare (in lamports)
  const amount = 100000000; // 0.1 SOL
  
  // Crea una transazione
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: recipientKeypair.publicKey,
      lamports: amount,
    })
  );
  
  // Invia la transazione
  console.log('Inviando transazione valida...');
  const signature = await l2.sendTransaction(transaction, keypair);
  
  console.log('Transazione inviata:', signature);
  
  // Attendi la conferma
  await l2.confirmTransaction(signature);
  console.log('Transazione confermata!');
  
  // Ottieni il blocco contenente la transazione
  const txInfo = await l2.getTransaction(signature);
  console.log('Transazione inclusa nel blocco:', txInfo.slot);
  
  return {
    signature,
    blockNumber: txInfo.slot
  };
}

createValidTransaction().catch(console.error);
```

## Simulazione di una Transizione di Stato Invalida

Ora simuliamo una transizione di stato invalida che dovrebbe essere contestata:

```javascript
const { L2TestClient } = require('@l2-solana/sdk/test');
const { Keypair, Transaction, SystemProgram } = require('@solana/web3.js');
const fs = require('fs');

// Carica il keypair Solana
const keypairData = JSON.parse(fs.readFileSync('./test-accounts/user1.json', 'utf8'));
const keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));

// Carica il keypair del destinatario
const recipientData = JSON.parse(fs.readFileSync('./test-accounts/user2.json', 'utf8'));
const recipientKeypair = Keypair.fromSecretKey(new Uint8Array(recipientData));

// Connessione al Layer-2 locale in modalità test
// Nota: L2TestClient permette di manipolare lo stato per scopi di test
const l2Test = new L2TestClient('http://localhost:8080');

async function createInvalidTransaction() {
  // Verifica il saldo
  const balance = await l2Test.getBalance(keypair.publicKey);
  console.log('Saldo attuale:', balance);
  
  // Importo da inviare (più del saldo disponibile)
  const amount = balance + BigInt(1000000000); // Saldo + 1 SOL
  
  console.log('Tentativo di inviare più del saldo disponibile:', amount);
  
  // Crea una transazione invalida
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: recipientKeypair.publicKey,
      lamports: amount,
    })
  );
  
  // Bypassa i controlli di validità (solo per test)
  console.log('Bypassando i controlli di validità...');
  const signature = await l2Test.sendInvalidTransaction(transaction, keypair);
  
  console.log('Transazione invalida inviata:', signature);
  
  // Attendi che la transazione venga inclusa in un blocco
  // (il sequencer di test includerà la transazione senza verificarla)
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Ottieni il blocco contenente la transazione
  const txInfo = await l2Test.getTransaction(signature);
  console.log('Transazione invalida inclusa nel blocco:', txInfo.slot);
  
  return {
    signature,
    blockNumber: txInfo.slot
  };
}

createInvalidTransaction().catch(console.error);
```

## Iniziare una Sfida

Una volta che abbiamo una transizione di stato invalida, possiamo iniziare una sfida:

```javascript
const { ethers } = require('ethers');
const { L2Client } = require('@l2-solana/sdk');
const { FraudProofGenerator } = require('@l2-solana/sdk/fraud-proof');
require('dotenv').config();

// Configurazione Ethereum
const provider = new ethers.providers.JsonRpcProvider('http://localhost:8545');
const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Chiave privata di test
const wallet = new ethers.Wallet(privateKey, provider);

// Carica l'ABI del contratto DisputeGame
const disputeGameAbi = require('@l2-solana/sdk/abis/DisputeGame.json');
const disputeGameAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3'; // Indirizzo del contratto in ambiente di test

// Crea un'istanza del contratto
const disputeGame = new ethers.Contract(disputeGameAddress, disputeGameAbi, wallet);

// Connessione al Layer-2 locale
const l2 = new L2Client('http://localhost:8080');

// Blocco con la transazione invalida
const invalidBlockNumber = 123; // Sostituisci con il numero del blocco ottenuto nel passaggio precedente

async function initiateChallenge() {
  console.log(`Iniziando una sfida per il blocco ${invalidBlockNumber}...`);
  
  // Ottieni lo state root del blocco precedente
  const prevBlock = await l2.getBlock(invalidBlockNumber - 1);
  const prevStateRoot = prevBlock.stateRoot;
  
  // Ottieni lo state root del blocco contestato
  const invalidBlock = await l2.getBlock(invalidBlockNumber);
  const claimedStateRoot = invalidBlock.stateRoot;
  
  // Genera la prova di frode
  console.log('Generando la prova di frode...');
  const fraudProofGenerator = new FraudProofGenerator(l2);
  
  // Riesegui le transazioni del blocco in modo corretto
  const correctStateRoot = await fraudProofGenerator.computeCorrectStateRoot(
    invalidBlockNumber,
    prevStateRoot
  );
  
  console.log('State root dichiarato (invalido):', claimedStateRoot);
  console.log('State root corretto:', correctStateRoot);
  
  if (claimedStateRoot === correctStateRoot) {
    console.error('Il blocco sembra valido, non è possibile iniziare una sfida');
    return;
  }
  
  // Genera la prova iniziale
  const initialProof = await fraudProofGenerator.generateInitialProof(
    invalidBlockNumber,
    prevStateRoot,
    claimedStateRoot,
    correctStateRoot
  );
  
  // Inizia la sfida
  console.log('Inviando la sfida al contratto DisputeGame...');
  const tx = await disputeGame.initiateChallenge(
    invalidBlockNumber,
    prevStateRoot,
    claimedStateRoot,
    correctStateRoot,
    initialProof,
    { gasLimit: 500000 }
  );
  
  console.log('Transazione di sfida inviata:', tx.hash);
  
  // Attendi la conferma
  const receipt = await tx.wait();
  console.log('Sfida iniziata nel blocco:', receipt.blockNumber);
  
  // Ottieni l'ID della sfida dall'evento
  const challengeInitiatedEvent = receipt.events.find(e => e.event === 'ChallengeInitiated');
  const challengeId = challengeInitiatedEvent.args.challengeId;
  
  console.log('ID della sfida:', challengeId);
  
  return challengeId;
}

initiateChallenge().catch(console.error);
```

## Gioco di Bisection

Una volta iniziata la sfida, inizia il gioco di bisection per identificare la transazione specifica che causa la divergenza:

```javascript
const { ethers } = require('ethers');
const { FraudProofGenerator } = require('@l2-solana/sdk/fraud-proof');
const { L2Client } = require('@l2-solana/sdk');
require('dotenv').config();

// Configurazione Ethereum
const provider = new ethers.providers.JsonRpcProvider('http://localhost:8545');
const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Chiave privata di test
const wallet = new ethers.Wallet(privateKey, provider);

// Carica l'ABI del contratto DisputeGame
const disputeGameAbi = require('@l2-solana/sdk/abis/DisputeGame.json');
const disputeGameAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3'; // Indirizzo del contratto in ambiente di test

// Crea un'istanza del contratto
const disputeGame = new ethers.Contract(disputeGameAddress, disputeGameAbi, wallet);

// Connessione al Layer-2 locale
const l2 = new L2Client('http://localhost:8080');

// ID della sfida ottenuto nel passaggio precedente
const challengeId = 1; // Sostituisci con l'ID della tua sfida

async function playBisectionGame() {
  console.log(`Giocando il gioco di bisection per la sfida ${challengeId}...`);
  
  // Ottieni lo stato attuale della sfida
  const challenge = await disputeGame.getChallenge(challengeId);
  console.log('Stato attuale della sfida:', challenge);
  
  // Crea il generatore di prove di frode
  const fraudProofGenerator = new FraudProofGenerator(l2);
  
  // Continua il gioco finché non si arriva a una singola transazione
  let currentChallenge = challenge;
  
  while (currentChallenge.status === 1) { // 1 = In corso
    console.log('\nRound di bisection:');
    console.log('Intervallo attuale:', currentChallenge.startIndex, '-', currentChallenge.endIndex);
    
    // Se l'intervallo è ridotto a una singola transazione, esegui la verifica finale
    if (currentChallenge.endIndex - currentChallenge.startIndex === 1) {
      console.log('Intervallo ridotto a una singola transazione. Eseguendo la verifica finale...');
      
      // Genera la prova finale
      const finalProof = await fraudProofGenerator.generateFinalProof(
        challengeId,
        currentChallenge.blockNumber,
        currentChallenge.startIndex
      );
      
      // Invia la prova finale
      const tx = await disputeGame.proveFraud(
        challengeId,
        finalProof,
        { gasLimit: 1000000 }
      );
      
      console.log('Transazione di prova finale inviata:', tx.hash);
      
      // Attendi la conferma
      const receipt = await tx.wait();
      console.log('Prova finale confermata nel blocco:', receipt.blockNumber);
      
      // Verifica il risultato
      const updatedChallenge = await disputeGame.getChallenge(challengeId);
      
      if (updatedChallenge.status === 2) { // 2 = Successo
        console.log('Sfida completata con successo! La frode è stata provata.');
      } else if (updatedChallenge.status === 3) { // 3 = Fallimento
        console.log('Sfida fallita. Non è stata trovata alcuna frode.');
      } else {
        console.log('Stato della sfida inaspettato:', updatedChallenge.status);
      }
      
      break;
    }
    
    // Calcola il punto medio
    const midIndex = Math.floor((currentChallenge.startIndex + currentChallenge.endIndex) / 2);
    console.log('Punto medio:', midIndex);
    
    // Genera la prova per il punto medio
    const bisectionProof = await fraudProofGenerator.generateBisectionProof(
      challengeId,
      currentChallenge.blockNumber,
      currentChallenge.startIndex,
      midIndex,
      currentChallenge.endIndex
    );
    
    // Invia la risposta di bisection
    const tx = await disputeGame.respondBisection(
      challengeId,
      midIndex,
      bisectionProof.midStateRoot,
      bisectionProof.proof,
      { gasLimit: 500000 }
    );
    
    console.log('Risposta di bisection inviata:', tx.hash);
    
    // Attendi la conferma
    const receipt = await tx.wait();
    console.log('Risposta confermata nel blocco:', receipt.blockNumber);
    
    // Attendi che l'avversario risponda (in un ambiente reale)
    // In questo test, simuliamo la risposta dell'avversario
    
    console.log('Simulando la risposta dell\'avversario...');
    
    // Ottieni lo stato aggiornato della sfida
    currentChallenge = await disputeGame.getChallenge(challengeId);
    
    // Simula la scelta dell'intervallo (in un ambiente reale, l'avversario sceglierebbe)
    // Per semplicità, scegliamo sempre la prima metà
    if (currentChallenge.status === 1) { // Ancora in corso
      const tx2 = await disputeGame.selectBisectionHalf(
        challengeId,
        0, // 0 = Prima metà, 1 = Seconda metà
        { gasLimit: 200000 }
      );
      
      console.log('Selezione dell\'intervallo inviata:', tx2.hash);
      
      // Attendi la conferma
      const receipt2 = await tx2.wait();
      console.log('Selezione confermata nel blocco:', receipt2.blockNumber);
      
      // Aggiorna lo stato della sfida
      currentChallenge = await disputeGame.getChallenge(challengeId);
    }
  }
  
  // Verifica lo stato finale della sfida
  const finalChallenge = await disputeGame.getChallenge(challengeId);
  
  console.log('\nStato finale della sfida:');
  console.log('ID:', challengeId);
  console.log('Stato:', ['Non Iniziata', 'In Corso', 'Successo', 'Fallimento'][finalChallenge.status]);
  console.log('Blocco:', finalChallenge.blockNumber.toString());
  console.log('Sfidante:', finalChallenge.challenger);
  console.log('Difensore:', finalChallenge.defender);
  
  if (finalChallenge.status === 2) { // Successo
    // Se la sfida ha successo, il blocco viene invalidato
    console.log('\nLa sfida ha avuto successo!');
    console.log('Il blocco è stato invalidato e rimosso dalla catena di stato.');
    console.log('Lo state root corretto è stato ripristinato.');
    
    // Verifica che il blocco sia stato invalidato
    const stateCommitmentChainAbi = require('@l2-solana/sdk/abis/StateCommitmentChain.json');
    const stateCommitmentChainAddress = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'; // Indirizzo in ambiente di test
    
    const stateCommitmentChain = new ethers.Contract(stateCommitmentChainAddress, stateCommitmentChainAbi, provider);
    const blockStatus = await stateCommitmentChain.getBlockStatus(finalChallenge.blockNumber);
    
    console.log('Stato del blocco:', ['Inesistente', 'Proposto', 'Contestato', 'Finalizzato', 'Invalidato'][blockStatus]);
  }
}

playBisectionGame().catch(console.error);
```

## Verifica del Risultato della Sfida

Dopo che la sfida è stata completata, verifichiamo il risultato e l'impatto sul sistema:

```javascript
const { ethers } = require('ethers');
const { L2Client } = require('@l2-solana/sdk');
require('dotenv').config();

// Configurazione Ethereum
const provider = new ethers.providers.JsonRpcProvider('http://localhost:8545');

// Carica gli ABI dei contratti
const disputeGameAbi = require('@l2-solana/sdk/abis/DisputeGame.json');
const stateCommitmentChainAbi = require('@l2-solana/sdk/abis/StateCommitmentChain.json');
const l2OutputOracleAbi = require('@l2-solana/sdk/abis/L2OutputOracle.json');

// Indirizzi dei contratti in ambiente di test
const disputeGameAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const stateCommitmentChainAddress = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const l2OutputOracleAddress = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';

// Crea istanze dei contratti
const disputeGame = new ethers.Contract(disputeGameAddress, disputeGameAbi, provider);
const stateCommitmentChain = new ethers.Contract(stateCommitmentChainAddress, stateCommitmentChainAbi, provider);
const l2OutputOracle = new ethers.Contract(l2OutputOracleAddress, l2OutputOracleAbi, provider);

// Connessione al Layer-2 locale
const l2 = new L2Client('http://localhost:8080');

// ID della sfida e numero del blocco contestato
const challengeId = 1; // Sostituisci con l'ID della tua sfida
const contestedBlockNumber = 123; // Sostituisci con il numero del blocco contestato

async function verifyChallenge() {
  console.log(`Verificando il risultato della sfida ${challengeId}...`);
  
  // Ottieni lo stato della sfida
  const challenge = await disputeGame.getChallenge(challengeId);
  
  console.log('Stato della sfida:', ['Non Iniziata', 'In Corso', 'Successo', 'Fallimento'][challenge.status]);
  
  if (challenge.status === 2) { // Successo
    console.log('La sfida ha avuto successo!');
    
    // Verifica lo stato del blocco contestato
    const blockStatus = await stateCommitmentChain.getBlockStatus(contestedBlockNumber);
    console.log('Stato del blocco contestato:', ['Inesistente', 'Proposto', 'Contestato', 'Finalizzato', 'Invalidato'][blockStatus]);
    
    if (blockStatus === 4) { // Invalidato
      console.log('Il blocco è stato correttamente invalidato.');
      
      // Verifica l'ultimo blocco valido
      const latestValidBlock = await l2OutputOracle.getLatestBlockNumber();
      console.log('Ultimo blocco valido:', latestValidBlock.toString());
      
      if (latestValidBlock < contestedBlockNumber) {
        console.log('L\'ultimo blocco valido è precedente al blocco contestato, come previsto.');
      } else {
        console.log('ATTENZIONE: L\'ultimo blocco valido non è stato aggiornato correttamente!');
      }
      
      // Verifica lo state root attuale
      const latestStateRoot = await l2OutputOracle.getL2Output(latestValidBlock);
      console.log('State root attuale:', latestStateRoot);
      
      // Verifica l'impatto sulle transazioni successive
      console.log('\nVerificando l\'impatto sulle transazioni successive...');
      
      // Ottieni i blocchi successivi
      const currentL2Block = await l2.getLatestBlockNumber();
      
      console.log('Blocco L2 attuale:', currentL2Block);
      console.log('Blocchi invalidati:');
      
      for (let i = contestedBlockNumber; i <= currentL2Block; i++) {
        try {
          const blockStatus = await stateCommitmentChain.getBlockStatus(i);
          console.log(`- Blocco ${i}: ${['Inesistente', 'Proposto', 'Contestato', 'Finalizzato', 'Invalidato'][blockStatus]}`);
        } catch (error) {
          console.log(`- Blocco ${i}: Errore nel recupero dello stato`);
        }
      }
      
      // Verifica se il sequencer ha riorganizzato la catena
      console.log('\nVerificando la riorganizzazione della catena...');
      
      try {
        const reorgStatus = await l2.getReorgStatus();
        console.log('Stato della riorganizzazione:', reorgStatus);
        
        if (reorgStatus.inProgress) {
          console.log('Riorganizzazione in corso.');
          console.log('Blocco di partenza:', reorgStatus.startBlock);
          console.log('Progresso:', reorgStatus.progress);
        } else {
          console.log('Nessuna riorganizzazione in corso.');
        }
      } catch (error) {
        console.log('Errore nel recupero dello stato di riorganizzazione:', error.message);
      }
    } else {
      console.log('ATTENZIONE: Il blocco non è stato invalidato correttamente!');
    }
  } else if (challenge.status === 3) { // Fallimento
    console.log('La sfida è fallita.');
    console.log('Il blocco rimane valido.');
    
    // Verifica lo stato del blocco contestato
    const blockStatus = await stateCommitmentChain.getBlockStatus(contestedBlockNumber);
    console.log('Stato del blocco contestato:', ['Inesistente', 'Proposto', 'Contestato', 'Finalizzato', 'Invalidato'][blockStatus]);
  } else {
    console.log('La sfida è ancora in corso o non è stata iniziata.');
  }
}

verifyChallenge().catch(console.error);
```

## Impatto della Sfida sul Sistema

Quando una sfida ha successo, ha diversi effetti sul sistema:

1. **Invalidazione del Blocco**: Il blocco contestato viene marcato come invalido
2. **Rimozione dalla Catena di Stato**: Il blocco e tutti i blocchi successivi vengono rimossi dalla catena di stato
3. **Riorganizzazione**: Il sequencer riorganizza la catena a partire dall'ultimo blocco valido
4. **Penalità per il Sequencer**: Il sequencer che ha proposto il blocco invalido perde parte del suo stake
5. **Ricompensa per lo Sfidante**: Lo sfidante riceve una ricompensa per aver identificato la frode

## Considerazioni sulla Sicurezza

### Periodo di Contestazione

Il periodo di contestazione (7 giorni in produzione, 1 giorno in testnet) è un parametro critico per la sicurezza del sistema. Durante questo periodo, i validatori possono contestare i blocchi proposti. Una volta terminato il periodo, i blocchi diventano definitivi e non possono più essere contestati.

### Stake Economico

Per iniziare una sfida, è necessario depositare uno stake. Questo serve a prevenire attacchi di denial-of-service. Se la sfida ha successo, lo stake viene restituito insieme a una ricompensa. Se la sfida fallisce, lo stake viene perso.

### Bisection Game

Il gioco di bisection è progettato per minimizzare i costi on-chain. Invece di verificare tutte le transazioni, il processo identifica in modo efficiente la singola transazione che causa la divergenza.

## Risoluzione dei Problemi

### La Sfida non Viene Accettata

1. **Verifica lo Stake**: Assicurati di aver depositato stake sufficiente
2. **Verifica il Periodo di Contestazione**: Assicurati che il blocco sia ancora nel periodo di contestazione
3. **Verifica la Prova**: Assicurati che la prova di frode sia valida e formattata correttamente

### Errori nel Gioco di Bisection

1. **Timeout**: Se non rispondi entro il timeout, perdi automaticamente la sfida
2. **Prove Invalide**: Assicurati che le prove generate siano valide
3. **Gas Insufficiente**: Le transazioni di bisection possono richiedere molto gas

## Conclusione

La simulazione di una sfida è un ottimo modo per comprendere il funzionamento interno del sistema di prove di frode. Questo meccanismo è fondamentale per garantire la sicurezza del Layer-2 su Solana, permettendo di contestare e invalidare transizioni di stato fraudolente.

## Risorse Aggiuntive

- [Documentazione Tecnica del Sistema di Prove di Frode](../architecture/fraud-proof-system.md)
- [Riferimento API per le Prove di Frode](../api-reference/fraud-proof-api.md)
- [Guida Introduttiva](getting-started.md)
- [Guida all'Utilizzo del Bridge](bridge-usage.md)
- [Esecuzione di un Nodo](running-a-node.md)

## Supporto

Se hai domande o problemi con la simulazione di sfide, puoi:

- Aprire una issue su GitHub: https://github.com/buybotsolana/LAYER-2-COMPLETE/issues
- Contattare il team via email: buybotsolana@tech-center.com
