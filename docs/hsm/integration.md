# Guida all'Integrazione HSM per Layer-2 su Solana

Questa guida fornisce istruzioni dettagliate per l'integrazione di Hardware Security Module (HSM) con il sistema Layer-2 su Solana. L'integrazione HSM migliora significativamente la sicurezza del sistema proteggendo le chiavi crittografiche utilizzate dal sequencer.

## Indice

1. [Architettura](#architettura)
2. [Componenti Principali](#componenti-principali)
3. [Flusso di Integrazione](#flusso-di-integrazione)
4. [Configurazione](#configurazione)
5. [Test e Verifica](#test-e-verifica)
6. [Monitoraggio](#monitoraggio)
7. [Risoluzione dei Problemi](#risoluzione-dei-problemi)

## Architettura

L'integrazione HSM si basa su un'architettura a più livelli che garantisce sia sicurezza che disponibilità:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│   Sequencer     │────▶│   KeyManager    │────▶│   HSM Provider  │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                │                        │
                                │                        │
                                ▼                        ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │                 │     │                 │
                        │ FailoverManager │     │ AWS CloudHSM /  │
                        │                 │     │   YubiHSM      │
                        └─────────────────┘     └─────────────────┘
                                │
                                │
                                ▼
                        ┌─────────────────┐
                        │                 │
                        │ KeyRotationSystem│
                        │                 │
                        └─────────────────┘
```

## Componenti Principali

### KeyManager

Interfaccia astratta che definisce le operazioni di base per la gestione delle chiavi:

```javascript
class KeyManager {
  async sign(message) { /* ... */ }
  async verify(message, signature) { /* ... */ }
  async getPublicKey() { /* ... */ }
  async isAvailable() { /* ... */ }
}
```

### Provider HSM

Implementazioni concrete di KeyManager per diversi tipi di HSM:

1. **AWSCloudHSMManager**: Integrazione con AWS CloudHSM
2. **YubiHSMManager**: Integrazione con YubiHSM
3. **EmergencyKeyProvider**: Provider di chiavi di emergenza per situazioni di failover

### FailoverManager

Gestisce il failover automatico tra diversi provider HSM:

```javascript
class FailoverManager {
  constructor(config) {
    this.primaryHsm = /* ... */;
    this.secondaryHsm = /* ... */;
    this.emergencyProvider = /* ... */;
  }
  
  async executeWithFailover(method, args) {
    // Tenta l'operazione con il provider primario
    // In caso di errore, passa al provider secondario
    // In caso di ulteriore errore, passa al provider di emergenza
  }
}
```

### KeyRotationSystem

Gestisce la rotazione automatica delle chiavi:

```javascript
class KeyRotationSystem {
  constructor(config, keyManager) {
    this.rotationIntervalDays = config.rotationIntervalDays;
    this.overlapHours = config.overlapHours;
    this.keyManager = keyManager;
  }
  
  async checkRotation() {
    // Verifica se è necessaria una rotazione delle chiavi
    // Se sì, esegue la rotazione
  }
}
```

## Flusso di Integrazione

1. **Inizializzazione**:
   - Il sequencer inizializza il KeyManager con la configurazione appropriata
   - Il KeyManager crea le istanze dei provider HSM necessari
   - Se il failover è abilitato, viene creato un FailoverManager
   - Se la rotazione delle chiavi è abilitata, viene creato un KeyRotationSystem

2. **Operazioni di firma**:
   - Il sequencer richiede una firma al KeyManager
   - Il KeyManager (o il FailoverManager) inoltra la richiesta al provider HSM appropriato
   - Il provider HSM esegue l'operazione di firma e restituisce il risultato

3. **Failover**:
   - In caso di errore con il provider HSM primario, il FailoverManager passa automaticamente al provider secondario
   - In caso di errore con entrambi i provider, viene utilizzato il provider di emergenza
   - Gli eventi di failover vengono registrati e notificati

4. **Rotazione delle chiavi**:
   - Il KeyRotationSystem verifica periodicamente se è necessaria una rotazione delle chiavi
   - Se sì, viene generata una nuova coppia di chiavi
   - La nuova chiave viene utilizzata per le nuove transazioni, mentre la vecchia chiave rimane attiva per un periodo di sovrapposizione
   - Gli eventi di rotazione vengono registrati e notificati

## Configurazione

La configurazione dell'integrazione HSM avviene tramite variabili d'ambiente o file di configurazione. Ecco un esempio di configurazione completa:

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

# YubiHSM (per failover)
HSM_YUBI_CONNECTOR=http://localhost:12345
HSM_YUBI_AUTH_KEY_ID=1
HSM_YUBI_PASSWORD=YourStrongPassword
HSM_YUBI_KEY_ID=2

# Failover
HSM_FAILOVER_LOG_PATH=/path/to/logs/failover
HSM_FAILOVER_ENABLE_AUDIT_LOGGING=true

# Emergency
HSM_EMERGENCY_KEY_LIFETIME_MINUTES=60
HSM_EMERGENCY_MAX_TRANSACTIONS=100
HSM_EMERGENCY_LOG_PATH=/path/to/logs/emergency-keys
HSM_EMERGENCY_ENABLE_AUDIT_LOGGING=true

# Key Rotation
HSM_ENABLE_KEY_ROTATION=true
HSM_KEY_ROTATION_INTERVAL_DAYS=90
HSM_KEY_ROTATION_OVERLAP_HOURS=24
HSM_KEY_ROTATION_LOG_PATH=/path/to/logs/key-rotation
HSM_KEY_ROTATION_ENABLE_AUDIT_LOGGING=true
HSM_KEY_ROTATION_CHECK_INTERVAL_MS=3600000
```

## Test e Verifica

Per verificare l'integrazione HSM, esegui i test unitari e di integrazione:

```bash
# Test unitari
npm run test:unit:hsm

# Test di integrazione
npm run test:integration:hsm
```

I test verificano:

1. **Funzionalità di base**: Inizializzazione, firma, verifica
2. **Failover**: Comportamento in caso di errore del provider primario
3. **Rotazione delle chiavi**: Funzionamento del sistema di rotazione
4. **Integrazione con il sequencer**: Funzionamento dell'intero sistema

## Monitoraggio

L'integrazione HSM include un sistema di monitoraggio completo:

1. **Metriche**:
   - `hsmStatus`: Stato corrente dell'HSM
   - `hsmFailovers`: Numero di failover
   - `hsmOperations`: Numero di operazioni HSM
   - `keyRotations`: Numero di rotazioni delle chiavi
   - `lastKeyRotation`: Data dell'ultima rotazione
   - `nextKeyRotation`: Data della prossima rotazione

2. **Logging**:
   - Log di failover
   - Log di emergenza
   - Log di rotazione delle chiavi
   - Log di notifiche HSM

3. **Eventi nel database**:
   - Tutti gli eventi HSM vengono registrati nella tabella `hsm_events`

## Risoluzione dei Problemi

### Problemi di Inizializzazione

Se il sequencer non riesce a inizializzare il KeyManager:

1. Verifica la configurazione HSM
2. Verifica che l'HSM sia accessibile
3. Controlla i log per errori specifici

### Problemi di Firma

Se le operazioni di firma falliscono:

1. Verifica che la chiave esista nell'HSM
2. Verifica che l'utente abbia i permessi necessari
3. Controlla i log per errori specifici

### Problemi di Failover

Se il failover non funziona correttamente:

1. Verifica che il provider secondario sia configurato correttamente
2. Verifica che il provider secondario sia accessibile
3. Controlla i log di failover per errori specifici

### Problemi di Rotazione delle Chiavi

Se la rotazione delle chiavi non funziona correttamente:

1. Verifica che la rotazione delle chiavi sia abilitata
2. Verifica che l'HSM supporti la generazione di nuove chiavi
3. Controlla i log di rotazione per errori specifici
