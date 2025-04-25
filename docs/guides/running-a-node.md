# Esecuzione di un Nodo

Questa guida spiega come configurare e gestire un nodo del Layer-2 su Solana, sia come validator che come sequencer, permettendo di partecipare attivamente alla rete.

## Introduzione

Il Layer-2 su Solana è composto da diversi tipi di nodi che svolgono ruoli specifici:

1. **Sequencer**: Ordina e processa le transazioni, producendo nuovi blocchi
2. **Validator**: Verifica le transazioni e genera prove di frode se necessario
3. **Full Node**: Mantiene una copia completa dello stato, ma non partecipa attivamente alla produzione o verifica dei blocchi

Questa guida ti mostrerà come configurare e gestire ciascuno di questi tipi di nodo.

## Prerequisiti

Prima di iniziare, assicurati di avere:

- Un server con almeno 8 CPU, 16 GB di RAM e 500 GB di spazio su disco SSD
- Ubuntu 20.04 o superiore (consigliato)
- Connessione Internet stabile con almeno 100 Mbps
- Conoscenza base di Linux e della riga di comando
- Conoscenza base di Ethereum e Solana

## Configurazione dell'Ambiente

### 1. Installazione delle Dipendenze

```bash
# Aggiorna il sistema
sudo apt update && sudo apt upgrade -y

# Installa le dipendenze di base
sudo apt install -y build-essential git curl jq pkg-config libssl-dev libudev-dev

# Installa Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Installa Node.js
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt install -y nodejs

# Installa Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.10.0/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Installa Ethereum client (Geth)
sudo add-apt-repository -y ppa:ethereum/ethereum
sudo apt update
sudo apt install -y ethereum
```

### 2. Clona il Repository

```bash
git clone https://github.com/buybotsolana/LAYER-2-COMPLETE.git
cd LAYER-2-COMPLETE
```

### 3. Compila il Codice

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

## Configurazione di un Full Node

Un full node mantiene una copia completa dello stato del Layer-2, ma non partecipa attivamente alla produzione o verifica dei blocchi.

### 1. Crea un File di Configurazione

Crea un file `config.json` nella directory principale:

```json
{
  "network": "mainnet", // o "testnet" per la rete di test
  "ethereum": {
    "rpc_url": "https://mainnet.infura.io/v3/YOUR_INFURA_KEY",
    "ws_url": "wss://mainnet.infura.io/ws/v3/YOUR_INFURA_KEY",
    "contracts": {
      "state_commitment_chain": "0x...",
      "deposit_bridge": "0x...",
      "withdrawal_bridge": "0x..."
    }
  },
  "solana": {
    "rpc_url": "https://api.mainnet-beta.solana.com",
    "ws_url": "wss://api.mainnet-beta.solana.com",
    "programs": {
      "deposit_handler": "...",
      "withdrawal_handler": "..."
    }
  },
  "node": {
    "type": "full",
    "data_dir": "/path/to/data",
    "rpc": {
      "enabled": true,
      "port": 8080,
      "host": "0.0.0.0"
    },
    "metrics": {
      "enabled": true,
      "port": 9090
    },
    "log_level": "info"
  }
}
```

Sostituisci i valori con quelli appropriati per la tua configurazione.

### 2. Avvia il Full Node

```bash
./target/release/l2-node --config config.json
```

Il nodo inizierà a sincronizzarsi con la rete, scaricando lo stato completo del Layer-2.

## Configurazione di un Validator

Un validator verifica le transazioni e genera prove di frode se rileva transizioni di stato invalide.

### 1. Crea un Keypair Ethereum

```bash
cd ethereum
npx hardhat run scripts/create-wallet.js
```

Questo comando genererà un nuovo wallet Ethereum e mostrerà l'indirizzo e la chiave privata. **Conserva la chiave privata in modo sicuro!**

### 2. Registra il Validator

Per diventare un validator, devi registrarti e depositare uno stake:

```bash
cd ethereum
npx hardhat run scripts/register-validator.js --network mainnet
```

Questo script ti guiderà attraverso il processo di registrazione e deposito dello stake.

### 3. Crea un File di Configurazione per il Validator

Crea un file `validator-config.json`:

```json
{
  "network": "mainnet", // o "testnet" per la rete di test
  "ethereum": {
    "rpc_url": "https://mainnet.infura.io/v3/YOUR_INFURA_KEY",
    "ws_url": "wss://mainnet.infura.io/ws/v3/YOUR_INFURA_KEY",
    "private_key": "YOUR_ETHEREUM_PRIVATE_KEY",
    "contracts": {
      "state_commitment_chain": "0x...",
      "deposit_bridge": "0x...",
      "withdrawal_bridge": "0x...",
      "dispute_game": "0x..."
    }
  },
  "solana": {
    "rpc_url": "https://api.mainnet-beta.solana.com",
    "ws_url": "wss://api.mainnet-beta.solana.com",
    "keypair_path": "/path/to/solana/keypair.json",
    "programs": {
      "deposit_handler": "...",
      "withdrawal_handler": "..."
    }
  },
  "node": {
    "type": "validator",
    "data_dir": "/path/to/data",
    "rpc": {
      "enabled": true,
      "port": 8080,
      "host": "0.0.0.0"
    },
    "metrics": {
      "enabled": true,
      "port": 9090
    },
    "log_level": "info"
  },
  "validator": {
    "auto_challenge": true,
    "challenge_threshold": 1000000000, // Importo minimo per iniziare una sfida (in wei)
    "max_challenges_per_day": 10,
    "monitoring": {
      "blocks_to_monitor": 1000,
      "check_interval_ms": 5000
    }
  }
}
```

### 4. Avvia il Validator

```bash
./target/release/l2-node --config validator-config.json
```

Il validator inizierà a sincronizzarsi con la rete e a monitorare i blocchi proposti dal sequencer.

## Configurazione di un Sequencer

Un sequencer ordina e processa le transazioni, producendo nuovi blocchi. Attualmente, il sequencer è centralizzato, ma in futuro sarà decentralizzato.

> **Nota**: La configurazione di un sequencer richiede l'autorizzazione del team di sviluppo. Contatta buybotsolana@tech-center.com per maggiori informazioni.

### 1. Crea un Keypair Ethereum

```bash
cd ethereum
npx hardhat run scripts/create-wallet.js
```

### 2. Registra il Sequencer

```bash
cd ethereum
npx hardhat run scripts/register-sequencer.js --network mainnet
```

### 3. Crea un File di Configurazione per il Sequencer

Crea un file `sequencer-config.json`:

```json
{
  "network": "mainnet", // o "testnet" per la rete di test
  "ethereum": {
    "rpc_url": "https://mainnet.infura.io/v3/YOUR_INFURA_KEY",
    "ws_url": "wss://mainnet.infura.io/ws/v3/YOUR_INFURA_KEY",
    "private_key": "YOUR_ETHEREUM_PRIVATE_KEY",
    "contracts": {
      "state_commitment_chain": "0x...",
      "deposit_bridge": "0x...",
      "withdrawal_bridge": "0x..."
    }
  },
  "solana": {
    "rpc_url": "https://api.mainnet-beta.solana.com",
    "ws_url": "wss://api.mainnet-beta.solana.com",
    "keypair_path": "/path/to/solana/keypair.json",
    "programs": {
      "deposit_handler": "...",
      "withdrawal_handler": "..."
    }
  },
  "node": {
    "type": "sequencer",
    "data_dir": "/path/to/data",
    "rpc": {
      "enabled": true,
      "port": 8080,
      "host": "0.0.0.0"
    },
    "metrics": {
      "enabled": true,
      "port": 9090
    },
    "log_level": "info"
  },
  "sequencer": {
    "batch_size": 100, // Numero massimo di transazioni per batch
    "batch_timeout_ms": 2000, // Timeout per la creazione di un batch
    "max_gas_per_batch": 15000000, // Gas massimo per batch
    "min_tx_fee": 1000000000, // Fee minima per transazione (in wei)
    "state_commitment_interval": 10, // Intervallo di blocchi per il commitment dello stato su L1
    "deposit_processing": {
      "enabled": true,
      "check_interval_ms": 5000
    }
  }
}
```

### 4. Avvia il Sequencer

```bash
./target/release/l2-node --config sequencer-config.json
```

Il sequencer inizierà a sincronizzarsi con la rete, a processare le transazioni e a produrre nuovi blocchi.

## Monitoraggio e Manutenzione

### Monitoraggio con Prometheus e Grafana

Il nodo espone metriche in formato Prometheus sulla porta specificata nella configurazione (default: 9090).

#### 1. Installa Prometheus

```bash
sudo apt install -y prometheus
```

#### 2. Configura Prometheus

Crea un file di configurazione per Prometheus:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'l2-node'
    static_configs:
      - targets: ['localhost:9090']
```

#### 3. Installa e Configura Grafana

```bash
sudo apt install -y grafana
sudo systemctl enable grafana-server
sudo systemctl start grafana-server
```

Accedi a Grafana all'indirizzo `http://your-server-ip:3000` (default: admin/admin) e configura una dashboard per visualizzare le metriche del nodo.

### Logging

I log del nodo vengono scritti su stdout e nel file specificato nella configurazione.

Per visualizzare i log in tempo reale:

```bash
tail -f /path/to/data/logs/node.log
```

### Backup dei Dati

È importante eseguire regolarmente il backup dei dati del nodo:

```bash
# Arresta il nodo
sudo systemctl stop l2-node

# Esegui il backup
tar -czf l2-node-backup-$(date +%Y%m%d).tar.gz /path/to/data

# Riavvia il nodo
sudo systemctl start l2-node
```

### Aggiornamento del Nodo

Per aggiornare il nodo a una nuova versione:

```bash
# Arresta il nodo
sudo systemctl stop l2-node

# Aggiorna il repository
cd /path/to/LAYER-2-COMPLETE
git pull

# Compila il codice
cargo build --release

# Riavvia il nodo
sudo systemctl start l2-node
```

## Configurazione come Servizio Systemd

Per eseguire il nodo come servizio systemd:

### 1. Crea un File di Servizio

```bash
sudo nano /etc/systemd/system/l2-node.service
```

Aggiungi il seguente contenuto:

```
[Unit]
Description=Layer-2 on Solana Node
After=network.target

[Service]
User=ubuntu
Group=ubuntu
WorkingDirectory=/path/to/LAYER-2-COMPLETE
ExecStart=/path/to/LAYER-2-COMPLETE/target/release/l2-node --config /path/to/config.json
Restart=on-failure
RestartSec=10
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

### 2. Abilita e Avvia il Servizio

```bash
sudo systemctl daemon-reload
sudo systemctl enable l2-node
sudo systemctl start l2-node
```

### 3. Verifica lo Stato del Servizio

```bash
sudo systemctl status l2-node
```

## Risoluzione dei Problemi

### Nodo Non Sincronizzato

Se il nodo non si sincronizza correttamente:

1. Verifica la connessione Internet
2. Verifica che gli endpoint RPC di Ethereum e Solana siano corretti e funzionanti
3. Controlla i log per errori specifici
4. Verifica che lo spazio su disco sia sufficiente

```bash
# Verifica lo spazio su disco
df -h

# Verifica lo stato di sincronizzazione
curl -X POST http://localhost:8080/v1/status -H "Content-Type: application/json"
```

### Errori di Connessione a Ethereum o Solana

Se il nodo non riesce a connettersi a Ethereum o Solana:

1. Verifica che gli endpoint RPC siano corretti
2. Verifica che il firewall non blocchi le connessioni
3. Prova con endpoint RPC alternativi

### Problemi di Performance

Se il nodo ha problemi di performance:

1. Verifica l'utilizzo di CPU, memoria e disco
2. Considera di aumentare le risorse del server
3. Ottimizza la configurazione del nodo

```bash
# Verifica l'utilizzo delle risorse
top
iostat -x 1
```

## Considerazioni di Sicurezza

### Protezione delle Chiavi Private

Le chiavi private sono estremamente sensibili. Non conservarle mai in file di testo non criptati o in repository pubblici.

Considera l'utilizzo di un gestore di segreti come HashiCorp Vault o AWS KMS.

### Firewall

Configura un firewall per limitare l'accesso alle porte del nodo:

```bash
# Consenti solo le porte necessarie
sudo ufw allow 22/tcp # SSH
sudo ufw allow 8080/tcp # RPC
sudo ufw enable
```

### Monitoraggio della Sicurezza

Configura un sistema di monitoraggio per rilevare attività sospette:

```bash
# Installa fail2ban per proteggere SSH
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

## Conclusione

Configurare e gestire un nodo del Layer-2 su Solana richiede attenzione ai dettagli e una buona comprensione dei sistemi distribuiti. Seguendo questa guida, dovresti essere in grado di configurare e gestire un nodo in modo efficace.

## Risorse Aggiuntive

- [Documentazione Tecnica dell'Architettura](../architecture/overview.md)
- [Riferimento API del Nodo](../api-reference/l2-node-api.md)
- [Guida Introduttiva](getting-started.md)
- [Guida all'Utilizzo del Bridge](bridge-usage.md)
- [Simulazione di Sfida](challenge-simulation.md)

## Supporto

Se hai domande o problemi con la configurazione del nodo, puoi:

- Aprire una issue su GitHub: https://github.com/buybotsolana/LAYER-2-COMPLETE/issues
- Contattare il team via email: buybotsolana@tech-center.com
