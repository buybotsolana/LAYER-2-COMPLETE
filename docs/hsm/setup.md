# Configurazione e Gestione HSM per Layer-2 su Solana

Questa documentazione fornisce istruzioni dettagliate per la configurazione e la gestione di Hardware Security Module (HSM) per il sistema Layer-2 su Solana. L'integrazione HSM garantisce la massima sicurezza per le chiavi crittografiche utilizzate dal sequencer, conforme agli standard FIPS 140-2 Livello 3, SOC 2 Tipo II e PCI DSS.

## Indice

1. [Panoramica](#panoramica)
2. [Requisiti](#requisiti)
3. [Configurazione AWS CloudHSM](#configurazione-aws-cloudhsm)
4. [Configurazione YubiHSM](#configurazione-yubihsm)
5. [Configurazione del Failover](#configurazione-del-failover)
6. [Rotazione delle Chiavi](#rotazione-delle-chiavi)
7. [Monitoraggio e Logging](#monitoraggio-e-logging)
8. [Risoluzione dei Problemi](#risoluzione-dei-problemi)
9. [Best Practices di Sicurezza](#best-practices-di-sicurezza)

## Panoramica

Il sistema Layer-2 su Solana utilizza Hardware Security Module (HSM) per proteggere le chiavi crittografiche utilizzate dal sequencer. L'HSM offre i seguenti vantaggi:

- **Sicurezza hardware**: Le chiavi private non lasciano mai il dispositivo HSM
- **Conformità agli standard**: FIPS 140-2 Livello 3, SOC 2 Tipo II e PCI DSS
- **Failover automatico**: Sistema di failover a più livelli per garantire alta disponibilità
- **Rotazione delle chiavi**: Rotazione automatica delle chiavi per migliorare la sicurezza
- **Audit logging**: Registrazione dettagliata di tutte le operazioni per conformità e audit

Il sistema supporta due provider HSM principali:

1. **AWS CloudHSM**: Soluzione cloud-based gestita da AWS
2. **YubiHSM**: Soluzione hardware on-premise

Inoltre, il sistema include un provider di chiavi di emergenza che viene utilizzato solo in caso di indisponibilità di entrambi i provider HSM principali.

## Requisiti

### Requisiti Generali

- Node.js 16.x o superiore
- Accesso amministrativo al sistema Layer-2
- Connessione Internet per AWS CloudHSM

### Requisiti per AWS CloudHSM

- Account AWS con permessi per creare e gestire risorse CloudHSM
- VPC configurato con subnet in almeno due zone di disponibilità
- Credenziali IAM con permessi appropriati

### Requisiti per YubiHSM

- Dispositivo YubiHSM 2 o superiore
- YubiHSM Connector installato e configurato
- Accesso fisico al server per l'installazione iniziale

## Configurazione AWS CloudHSM

### 1. Creazione del Cluster CloudHSM

1. Accedi alla Console AWS e naviga al servizio CloudHSM
2. Crea un nuovo cluster CloudHSM:
   ```
   aws cloudhsm create-cluster \
     --hsm-type hsm1.medium \
     --subnet-ids subnet-12345678 subnet-87654321 \
     --tag-list Key=Name,Value=Layer2Sequencer
   ```

3. Attendi che il cluster sia attivo:
   ```
   aws cloudhsm describe-clusters
   ```

### 2. Inizializzazione del Cluster

1. Inizializza il cluster:
   ```
   aws cloudhsm initialize-cluster --cluster-id cluster-12345678
   ```

2. Crea un utente crypto officer (CO):
   ```
   aws cloudhsm create-hsm-user \
     --cluster-id cluster-12345678 \
     --username admin \
     --password YourStrongPassword \
     --role CO
   ```

### 3. Generazione delle Chiavi

1. Genera una coppia di chiavi EC per il sequencer:
   ```
   aws cloudhsm generate-key \
     --cluster-id cluster-12345678 \
     --key-type EC \
     --key-size 256 \
     --label sequencer_main
   ```

2. Prendi nota del KeyId restituito, sarà necessario per la configurazione del sequencer.

### 4. Configurazione del Sequencer

Aggiorna il file di configurazione del sequencer con i seguenti parametri:

```
# Configurazione HSM
HSM_TYPE=aws
HSM_ENABLE_FAILOVER=true

# AWS CloudHSM
HSM_AWS_REGION=us-west-2
HSM_AWS_CLUSTER_ID=cluster-12345678
HSM_AWS_KEY_ID=sequencer_main
HSM_AWS_USERNAME=crypto-user
HSM_AWS_PASSWORD=YourStrongPassword
HSM_AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX
HSM_AWS_SECRET_ACCESS_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
HSM_AWS_ALGORITHM=ECDSA_SHA256
HSM_AWS_ENABLE_FIPS_MODE=true
HSM_AWS_ENABLE_AUDIT_LOGGING=true
HSM_AWS_CLOUDTRAIL_LOG_GROUP=/aws/cloudhsm/layer2
```

## Configurazione YubiHSM

### 1. Installazione di YubiHSM Connector

1. Scarica YubiHSM Connector dal sito web di Yubico
2. Installa il connector:
   ```
   sudo dpkg -i yubihsm-connector_2.3.0_amd64.deb
   ```

3. Avvia il servizio:
   ```
   sudo systemctl start yubihsm-connector
   ```

### 2. Configurazione di YubiHSM

1. Connetti il dispositivo YubiHSM alla porta USB del server
2. Utilizza YubiHSM Shell per configurare il dispositivo:
   ```
   yubihsm-shell
   ```

3. Autenticati con le credenziali predefinite:
   ```
   connect
   session open 1 password
   ```

4. Cambia la password predefinita:
   ```
   put authkey 0 1 password YourNewStrongPassword 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16
   ```

5. Genera una coppia di chiavi EC per il sequencer:
   ```
   generate asymmetric 0 1 sequencer_main 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16
   ```

6. Prendi nota del KeyId restituito, sarà necessario per la configurazione del sequencer.

### 3. Configurazione del Sequencer

Aggiorna il file di configurazione del sequencer con i seguenti parametri:

```
# Configurazione HSM
HSM_TYPE=yubi
HSM_ENABLE_FAILOVER=true

# YubiHSM
HSM_YUBI_CONNECTOR=http://localhost:12345
HSM_YUBI_AUTH_KEY_ID=1
HSM_YUBI_PASSWORD=YourNewStrongPassword
HSM_YUBI_KEY_ID=2  # Il KeyId restituito dal comando generate asymmetric
```

## Configurazione del Failover

Il sistema supporta un meccanismo di failover a più livelli per garantire alta disponibilità. Configura il failover con i seguenti parametri:

```
# Configurazione Failover
HSM_ENABLE_FAILOVER=true
HSM_FAILOVER_LOG_PATH=/path/to/logs/failover
HSM_FAILOVER_ENABLE_AUDIT_LOGGING=true

# Provider di Chiavi di Emergenza
HSM_EMERGENCY_KEY_LIFETIME_MINUTES=60
HSM_EMERGENCY_MAX_TRANSACTIONS=100
HSM_EMERGENCY_LOG_PATH=/path/to/logs/emergency-keys
HSM_EMERGENCY_ENABLE_AUDIT_LOGGING=true
```

### Configurazione di Provider Multipli

Per configurare sia AWS CloudHSM che YubiHSM per il failover:

1. Configura AWS CloudHSM come provider primario (vedi sezione precedente)
2. Configura YubiHSM come provider secondario (vedi sezione precedente)
3. Abilita il failover impostando `HSM_ENABLE_FAILOVER=true`

Il sistema tenterà di utilizzare il provider primario (AWS CloudHSM) per tutte le operazioni. In caso di errore o indisponibilità, passerà automaticamente al provider secondario (YubiHSM). Se anche il provider secondario non è disponibile, utilizzerà il provider di chiavi di emergenza.

### Provider di Chiavi di Emergenza

Il provider di chiavi di emergenza genera chiavi effimere localmente con le seguenti limitazioni:

- Le chiavi hanno una durata limitata (configurabile con `HSM_EMERGENCY_KEY_LIFETIME_MINUTES`)
- Le chiavi possono essere utilizzate per un numero limitato di transazioni (configurabile con `HSM_EMERGENCY_MAX_TRANSACTIONS`)
- Tutte le operazioni vengono registrate in un log di audit dedicato
- Le chiavi vengono distrutte in modo sicuro dopo l'uso

## Rotazione delle Chiavi

Il sistema supporta la rotazione automatica delle chiavi per migliorare la sicurezza. Configura la rotazione delle chiavi con i seguenti parametri:

```
# Rotazione delle Chiavi
HSM_ENABLE_KEY_ROTATION=true
HSM_KEY_ROTATION_INTERVAL_DAYS=90
HSM_KEY_ROTATION_OVERLAP_HOURS=24
HSM_KEY_ROTATION_LOG_PATH=/path/to/logs/key-rotation
HSM_KEY_ROTATION_ENABLE_AUDIT_LOGGING=true
HSM_KEY_ROTATION_CHECK_INTERVAL_MS=3600000
```

### Processo di Rotazione delle Chiavi

Il processo di rotazione delle chiavi funziona come segue:

1. Il sistema verifica periodicamente se è necessaria una rotazione delle chiavi (ogni `HSM_KEY_ROTATION_CHECK_INTERVAL_MS` millisecondi)
2. Se l'ultima rotazione è avvenuta più di `HSM_KEY_ROTATION_INTERVAL_DAYS` giorni fa, viene avviata una nuova rotazione
3. Viene generata una nuova coppia di chiavi nell'HSM
4. La nuova chiave viene utilizzata per le nuove transazioni, mentre la vecchia chiave rimane attiva per `HSM_KEY_ROTATION_OVERLAP_HOURS` ore
5. Dopo il periodo di sovrapposizione, la vecchia chiave viene disattivata
6. Tutte le operazioni vengono registrate in un log di audit dedicato

## Monitoraggio e Logging

### CloudWatch Metrics (AWS CloudHSM)

Se utilizzi AWS CloudHSM, il sistema pubblica automaticamente le seguenti metriche su CloudWatch:

- `HSMOperations`: Numero di operazioni HSM eseguite
- `HSMErrors`: Numero di errori HSM
- `HSMLatency`: Latenza delle operazioni HSM
- `HSMFailovers`: Numero di failover HSM
- `KeyRotations`: Numero di rotazioni delle chiavi

### Logging

Il sistema registra tutti gli eventi HSM in file di log dedicati:

- **Log di Failover**: `/path/to/logs/failover`
- **Log di Emergenza**: `/path/to/logs/emergency-keys`
- **Log di Rotazione delle Chiavi**: `/path/to/logs/key-rotation`
- **Log di Notifiche HSM**: `/path/to/logs/hsm-notifications`

Inoltre, tutti gli eventi HSM vengono registrati nel database nella tabella `hsm_events`.

### Monitoraggio via API

Il sequencer espone un endpoint `/metrics` che include informazioni sullo stato dell'HSM:

```json
{
  "hsmStatus": "active",
  "hsmFailovers": 0,
  "hsmOperations": 1234,
  "keyRotations": 2,
  "lastKeyRotation": "2025-01-15T12:00:00Z",
  "nextKeyRotation": "2025-04-15T12:00:00Z"
}
```

## Risoluzione dei Problemi

### Problemi Comuni con AWS CloudHSM

1. **Errore di connessione al cluster**:
   - Verifica che il cluster sia attivo: `aws cloudhsm describe-clusters`
   - Verifica che le subnet siano accessibili
   - Verifica che i gruppi di sicurezza permettano il traffico sulla porta 2223

2. **Errore di autenticazione**:
   - Verifica le credenziali IAM
   - Verifica le credenziali dell'utente crypto

3. **Errore durante le operazioni di firma**:
   - Verifica che la chiave esista: `aws cloudhsm list-keys`
   - Verifica che l'utente abbia i permessi necessari per utilizzare la chiave

### Problemi Comuni con YubiHSM

1. **Errore di connessione al connector**:
   - Verifica che il connector sia in esecuzione: `systemctl status yubihsm-connector`
   - Verifica che la porta 12345 sia accessibile

2. **Errore di autenticazione**:
   - Verifica l'ID della chiave di autenticazione
   - Verifica la password

3. **Errore durante le operazioni di firma**:
   - Verifica che la chiave esista: `yubihsm-shell -a list-objects`
   - Verifica che l'utente abbia i permessi necessari per utilizzare la chiave

### Log di Debug

Per abilitare i log di debug, imposta la variabile d'ambiente `LOG_LEVEL=debug` prima di avviare il sequencer.

## Best Practices di Sicurezza

### Gestione delle Credenziali

- Utilizza credenziali diverse per ogni ambiente (sviluppo, test, produzione)
- Ruota regolarmente le credenziali
- Utilizza un sistema di gestione delle credenziali come AWS Secrets Manager o HashiCorp Vault

### Configurazione di AWS CloudHSM

- Utilizza un VPC dedicato per CloudHSM
- Configura gruppi di sicurezza restrittivi
- Abilita CloudTrail per registrare tutte le operazioni API
- Utilizza almeno due HSM in zone di disponibilità diverse

### Configurazione di YubiHSM

- Conserva il dispositivo YubiHSM in un luogo sicuro
- Utilizza una password forte per la chiave di autenticazione
- Limita l'accesso fisico al server
- Configura il connector per accettare connessioni solo da localhost

### Monitoraggio e Alerting

- Configura allarmi CloudWatch per le metriche HSM
- Configura notifiche per eventi di failover e rotazione delle chiavi
- Monitora regolarmente i log di audit
- Esegui audit di sicurezza periodici
