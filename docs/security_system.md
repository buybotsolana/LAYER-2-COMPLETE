# Sistema di Sicurezza Layer-2 - Documentazione

## Panoramica

Il Sistema di Sicurezza Layer-2 è un sistema completo e integrato che fornisce funzionalità avanzate di sicurezza per l'infrastruttura Layer-2 su Solana. Il sistema include logging strutturato, redazione di informazioni sensibili, correlazione delle richieste, rilevamento anomalie, regole di sicurezza, notifiche di alert e gestione della rotazione dei segreti.

## Componenti

### 1. Logger Strutturato

Il logger strutturato fornisce un sistema di logging avanzato con supporto per:

- Formati di output JSON e testo
- Livelli di log configurabili
- Rotazione dei file di log
- Integrazione con sistemi di logging centralizzati
- Metadati contestuali per ogni log

**Utilizzo base:**

```javascript
const { Logger } = require('./offchain/logger/structured_logger');
const logger = new Logger('my-service');

logger.info('Operazione completata', { userId: 123, duration: 45 });
logger.error('Errore durante l\'elaborazione', { error: err.message });
```

### 2. Redazione Informazioni Sensibili

Il sistema di redazione automatica nasconde informazioni sensibili nei log e nelle risposte API:

- Redazione basata su pattern configurabili
- Supporto per redazione profonda di oggetti annidati
- Redazione automatica di header HTTP sensibili
- Middleware Express per redazione automatica

**Utilizzo base:**

```javascript
const { SensitiveDataRedactor } = require('./offchain/logger/sensitive_data_redactor');
const redactor = new SensitiveDataRedactor();

// Redazione manuale
const redactedData = redactor.redact({
  username: 'user123',
  password: 'secret',
  details: { creditCard: '1234-5678-9012-3456' }
});

// Middleware Express
app.use(redactor.createExpressMiddleware());
```

### 3. Correlazione delle Richieste

Il sistema di correlazione delle richieste permette di tracciare le richieste attraverso diversi servizi:

- Generazione e propagazione di ID di correlazione
- Contesto condiviso tra componenti
- Middleware Express per correlazione automatica
- Supporto per header di correlazione personalizzati

**Utilizzo base:**

```javascript
const { RequestCorrelator } = require('./offchain/logger/request_correlator');
const correlator = new RequestCorrelator();

// Middleware Express
app.use(correlator.createExpressMiddleware());

// Accesso all'ID di correlazione
app.get('/api/resource', (req, res) => {
  const correlationId = req.getCorrelationId();
  // ...
});

// Esecuzione con contesto
correlator.runWithContext(() => {
  // Codice con accesso al contesto di correlazione
}, { correlationId: 'custom-id' });
```

### 4. Rilevamento Anomalie

Il sistema di rilevamento anomalie monitora vari parametri e identifica comportamenti anomali:

- Calcolo di statistiche di base (media, deviazione standard)
- Soglie dinamiche basate su dati storici
- Notifiche di anomalie in tempo reale
- Supporto per metriche personalizzate

**Utilizzo base:**

```javascript
const { AnomalyDetector } = require('./offchain/security/anomaly_detector');
const detector = new AnomalyDetector();

// Avvio del rilevatore
await detector.start();

// Aggiornamento delle statistiche
detector.updateStats({
  transactionsPerMinute: 120,
  responseTime: 250,
  cpuUsage: 0.75
});

// Ascolto delle anomalie
detector.on('anomalies', (anomalies) => {
  console.log(`Rilevate ${anomalies.length} anomalie`);
});
```

### 5. Regole di Sicurezza

Il sistema di regole di sicurezza rileva attività sospette basate su regole predefinite o personalizzate:

- Regole predefinite per scenari comuni (login falliti, prelievi sospetti)
- Supporto per regole personalizzate con valutazione condizionale
- Generazione di alert con diversi livelli di severità
- Integrazione con il sistema di rilevamento anomalie

**Utilizzo base:**

```javascript
const { SecurityRules } = require('./offchain/security/security_rules');
const rules = new SecurityRules();

// Avvio del sistema di regole
await rules.start();

// Aggiunta di eventi
rules.addEvent({
  type: 'login',
  userId: 'user123',
  success: false,
  ip: '192.168.1.1',
  timestamp: Date.now()
});

// Ascolto degli alert
rules.on('alert', (alert) => {
  console.log(`Alert: ${alert.ruleName} (${alert.severity})`);
});
```

### 6. Notifiche di Alert

Il sistema di notifiche invia alert in tempo reale attraverso diversi canali:

- Supporto per email, Slack, webhook, SMS e notifiche push
- Filtri personalizzabili per ridurre il rumore
- Throttling per evitare tempeste di notifiche
- Template personalizzabili per ogni canale

**Utilizzo base:**

```javascript
const { AlertNotifier } = require('./offchain/security/alert_notifier');
const notifier = new AlertNotifier({
  channels: ['email', 'slack'],
  contacts: {
    email: {
      recipients: ['security@example.com'],
      config: { /* configurazione SMTP */ }
    },
    slack: {
      webhookUrl: 'https://hooks.slack.com/services/...'
    }
  }
});

// Invio di una notifica
await notifier.notify({
  ruleName: 'multiple-failed-logins',
  severity: 'high',
  category: 'account-security',
  timestamp: Date.now(),
  result: { /* dettagli dell'alert */ }
});
```

### 7. Rotazione dei Segreti

Il sistema di rotazione dei segreti gestisce il ciclo di vita delle chiavi crittografiche:

- Pianificazione automatica delle rotazioni
- Esecuzione delle rotazioni con periodi di grazia
- Supporto per rotazioni manuali e di emergenza
- Cronologia delle rotazioni per audit

**Utilizzo base:**

```javascript
const { SecretRotationService } = require('./offchain/secrets/secret_rotation_service');
const rotationService = new SecretRotationService();

// Avvio del servizio
await rotationService.start();

// Pianificazione di una rotazione
await rotationService.scheduleRotation({
  keyId: 'api-key-1',
  scheduledTime: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 giorni
});

// Rotazione manuale
await rotationService.rotateKey('api-key-2');
```

### 8. Gestione Periodi di Grazia

Il sistema di gestione dei periodi di grazia permette l'uso temporaneo di chiavi scadute:

- Configurazione della durata dei periodi di grazia
- Monitoraggio delle chiavi in periodo di grazia
- Notifiche di scadenza imminente
- Pulizia automatica delle chiavi scadute

**Utilizzo base:**

```javascript
const { GracePeriodManager } = require('./offchain/secrets/grace_period_manager');
const gracePeriodManager = new GracePeriodManager();

// Avvio del gestore
await gracePeriodManager.start();

// Avvio di un periodo di grazia
await gracePeriodManager.startGracePeriod({
  keyId: 'old-key-123',
  expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 giorni
  metadata: { /* metadati aggiuntivi */ }
});

// Verifica se una chiave è in periodo di grazia
const isInGracePeriod = gracePeriodManager.isInGracePeriod('old-key-123');
```

## Sistema di Sicurezza Integrato

Il `SecuritySystem` integra tutti i componenti sopra descritti in un sistema unificato:

**Utilizzo base:**

```javascript
const { SecuritySystem } = require('./offchain/security_system');

// Inizializzazione del sistema
const securitySystem = new SecuritySystem({
  // Configurazione dei vari componenti
});

// Avvio del sistema
await securitySystem.start();

// Middleware Express
app.use(securitySystem.createExpressMiddleware());

// Utilizzo delle funzionalità
securitySystem.addSecurityEvent({
  type: 'transaction',
  amount: 5000,
  userId: 'user123'
});

// Fermare il sistema
await securitySystem.stop();
```

## Configurazione

Il sistema di sicurezza è altamente configurabile. Ecco un esempio di configurazione completa:

```javascript
const securitySystem = new SecuritySystem({
  logger: {
    level: 'info',
    format: 'json',
    serviceName: 'layer2-service'
  },
  redactor: {
    paths: ['password', 'secret', 'token', '*.creditCard'],
    replacement: '[REDACTED]'
  },
  correlator: {
    headerName: 'x-correlation-id',
    generateId: true
  },
  anomalyDetector: {
    alertThreshold: 3,
    baselinePeriod: 24 * 60 * 60 * 1000, // 24 ore
    metrics: {
      transactionsPerMinute: { weight: 1 },
      failureRate: { weight: 2 }
    }
  },
  securityRules: {
    evaluationInterval: 60 * 1000, // 1 minuto
    context: {
      largeWithdrawalThreshold: 1000000
    }
  },
  alertNotifier: {
    channels: ['email', 'slack'],
    contacts: {
      email: {
        recipients: ['security@example.com']
      },
      slack: {
        webhookUrl: 'https://hooks.slack.com/services/...'
      }
    },
    filters: {
      minSeverity: 'medium'
    }
  },
  secretRotation: {
    defaultRotationInterval: 90 * 24 * 60 * 60 * 1000, // 90 giorni
    defaultGracePeriod: 7 * 24 * 60 * 60 * 1000 // 7 giorni
  }
});
```

## Test

Il sistema include test unitari e di integrazione completi:

- Test unitari per ogni componente
- Test di integrazione per il sistema completo
- Mocking delle dipendenze esterne
- Controllo del tempo per testare comportamenti temporali

Per eseguire i test:

```bash
# Test unitari
npm run test:unit

# Test di integrazione
npm run test:integration

# Tutti i test
npm test
```

## Integrazione con HSM

Il sistema di sicurezza è integrato con Hardware Security Module (HSM) per la gestione sicura delle chiavi critiche:

- Supporto per AWS CloudHSM e YubiHSM
- Sistema di failover a più livelli
- Rotazione automatica delle chiavi
- Conformità con standard di sicurezza (FIPS 140-2, SOC 2, PCI DSS)

Per la configurazione e l'utilizzo dell'HSM, consultare la documentazione specifica in `docs/hsm/`.

## Best Practices

- Avviare il sistema di sicurezza all'inizializzazione dell'applicazione
- Utilizzare il middleware Express per la correlazione e la redazione automatica
- Configurare notifiche per almeno un canale di comunicazione
- Pianificare rotazioni regolari delle chiavi critiche
- Monitorare regolarmente gli alert e le anomalie
- Eseguire test di sicurezza periodici

## Risoluzione dei Problemi

### Log Mancanti

- Verificare il livello di log configurato
- Controllare i percorsi dei file di log
- Verificare i permessi di scrittura

### Notifiche Non Ricevute

- Verificare la configurazione dei canali di notifica
- Controllare i filtri di severità
- Verificare le impostazioni di throttling

### Anomalie Non Rilevate

- Verificare la soglia di allerta
- Controllare che il rilevatore sia avviato
- Verificare che le statistiche vengano aggiornate regolarmente

### Rotazioni Non Eseguite

- Verificare che il servizio di rotazione sia avviato
- Controllare la pianificazione delle rotazioni
- Verificare l'accesso all'HSM o al gestore delle chiavi

## Riferimenti

- [Documentazione HSM](./hsm/setup.md)
- [Guida all'integrazione HSM](./hsm/integration.md)
- [Specifiche OpenAPI](./api/openapi.json)
