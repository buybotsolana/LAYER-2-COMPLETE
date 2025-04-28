# Layer-2 Solana SDK

Un SDK completo per interagire con il Layer-2 su Solana, gestire il bridge tra Ethereum e Solana, e integrare wallet come Phantom e MetaMask.

## Caratteristiche

- **Client Layer-2 Solana**: Interagisci facilmente con il Layer-2 su Solana
- **Bridge Trustless**: Trasferisci asset tra Ethereum (L1) e Solana Layer-2
- **Integrazione Wallet**: Supporto per Phantom, MetaMask e Backpack
- **Gestione Account**: Creazione e gestione di account
- **Gestione Transazioni**: Creazione, firma e invio di transazioni
- **Logging Avanzato**: Sistema di logging strutturato con supporto per ELK Stack
- **Monitoraggio Completo**: Raccolta di metriche, monitoraggio delle prestazioni e integrazione con Prometheus
- **Sistema di Alerting**: Notifiche multi-canale (email, Slack, webhook) per eventi critici

## Installazione

```bash
npm install layer2-solana-sdk
```

## Utilizzo Base

```javascript
const { initialize } = require('layer2-solana-sdk');

// Inizializza l'SDK
const sdk = initialize({
  l1Provider: 'https://mainnet.infura.io/v3/your-api-key',
  l2Provider: 'https://api.mainnet-beta.solana.com',
  logging: {
    level: 'info',
    console: true,
    file: true,
    filename: 'layer2-solana.log'
  }
});

// Accedi al client principale
const { client } = sdk;

// Crea un nuovo account
const { Account } = sdk;
const account = new Account();
console.log('Nuovo account creato:', account.publicKey);

// Connetti un wallet Phantom
const { PhantomWallet } = sdk.wallets;
const phantomWallet = new PhantomWallet();
phantomWallet.connect()
  .then(result => {
    console.log('Connesso a Phantom:', result.publicKey);
  })
  .catch(error => {
    console.error('Errore di connessione a Phantom:', error);
  });
```

## Bridge tra Ethereum e Solana Layer-2

```javascript
// Deposita ETH da Ethereum a Solana Layer-2
client.bridge.deposit({
  token: 'ETH',
  amount: '1.0',
  sender: account.publicKey,
  recipient: account.publicKey
})
.then(result => {
  console.log('Deposito completato:', result);
})
.catch(error => {
  console.error('Errore durante il deposito:', error);
});

// Preleva ETH da Solana Layer-2 a Ethereum
client.bridge.withdraw({
  token: 'ETH',
  amount: '0.5',
  sender: account.publicKey,
  recipient: '0xmetamask-address'
})
.then(result => {
  console.log('Prelievo completato:', result);
})
.catch(error => {
  console.error('Errore durante il prelievo:', error);
});
```

## Monitoraggio e Logging

```javascript
// Inizializza l'SDK con monitoraggio
const express = require('express');
const app = express();

const sdk = initialize({
  l1Provider: 'https://mainnet.infura.io/v3/your-api-key',
  l2Provider: 'https://api.mainnet-beta.solana.com',
  logging: {
    level: 'info',
    console: true,
    file: true,
    filename: 'layer2-solana.log'
  },
  monitoring: {
    metrics: {
      format: 'prometheus',
      collectionInterval: 60000 // 1 minuto
    },
    alerts: {
      memoryWarningThreshold: 80,
      cpuWarningThreshold: 70
    }
  },
  express: app
});

// Avvia il server Express
app.listen(3000, () => {
  console.log('Server avviato sulla porta 3000');
  console.log('Metriche disponibili su http://localhost:3000/metrics');
  console.log('Stato di salute disponibile su http://localhost:3000/health');
  console.log('Stato degli alert disponibile su http://localhost:3000/alerts');
});
```

## Configurazione degli Alert

```javascript
// Configura il canale email per gli alert
sdk.monitoring.alertManager.configureEmailChannel({
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  auth: {
    user: 'alerts@example.com',
    pass: 'password'
  },
  from: 'alerts@example.com',
  to: 'admin@example.com'
});

// Configura il canale Slack per gli alert
sdk.monitoring.alertManager.configureSlackChannel({
  webhookUrl: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX',
  channel: '#alerts',
  username: 'Layer-2 Solana Monitor'
});
```

## Documentazione Completa

Per una documentazione completa, consulta la [documentazione ufficiale](./docs/README.md).

## Esempi

Nella directory `examples` sono disponibili applicazioni di esempio che mostrano l'utilizzo dell'SDK in scenari reali:

- **Cross-Chain Bridge Demo**: Dimostra il trasferimento di asset tra Ethereum e Solana Layer-2
- **DEX Demo**: Mostra le capacità di trading su Layer-2

## Licenza

MIT
