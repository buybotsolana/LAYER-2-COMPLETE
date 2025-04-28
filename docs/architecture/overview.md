# Architettura del Layer-2 su Solana

Questo documento descrive l'architettura dettagliata del Layer-2 su Solana, un rollup ottimistico che utilizza la Solana Virtual Machine (SVM) come layer di esecuzione su Ethereum.

## Panoramica dell'Architettura

Il Layer-2 su Solana è composto da diversi componenti che lavorano insieme per fornire un sistema di scaling sicuro ed efficiente:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Ethereum (L1)                           │
│                                                                 │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐   │
│  │ Deposit Bridge│  │State Commitment│  │Withdrawal Bridge │   │
│  └───────┬───────┘  └───────┬───────┘  └────────┬──────────┘   │
└─────────┬───────────────────┼──────────────────┬───────────────┘
          │                   │                  │
          ▼                   ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Layer-2 su Solana                       │
│                                                                 │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐   │
│  │   Sequencer   │◄─┤  Transaction  │◄─┤    Validator      │   │
│  └───────┬───────┘  │     Pool      │  └────────┬──────────┘   │
│          │          └───────────────┘           │              │
│          ▼                                      │              │
│  ┌───────────────┐                   ┌──────────▼──────────┐   │
│  │  Solana VM    │                   │  Fraud Proof System │   │
│  │  (Execution)  │                   │                     │   │
│  └───────┬───────┘                   └─────────────────────┘   │
│          │                                                     │
│          ▼                                                     │
│  ┌───────────────┐                                             │
│  │  State Storage│                                             │
│  └───────────────┘                                             │
└─────────────────────────────────────────────────────────────────┘
```

### Componenti Principali

1. **Contratti Ethereum (L1)**
   - **Deposit Bridge**: Gestisce i depositi da Ethereum al Layer-2
   - **State Commitment Chain**: Memorizza i root degli stati del Layer-2
   - **Withdrawal Bridge**: Gestisce i prelievi dal Layer-2 a Ethereum

2. **Nodi Layer-2**
   - **Sequencer**: Ordina e processa le transazioni
   - **Validator**: Verifica le transazioni e genera prove di frode
   - **Transaction Pool**: Memorizza le transazioni in attesa di essere processate

3. **Execution Layer**
   - **Solana VM**: Esegue le transazioni in modo deterministico
   - **State Storage**: Memorizza lo stato del Layer-2

4. **Fraud Proof System**
   - **Dispute Game**: Implementa il gioco di bisection per le sfide
   - **Merkle Tree**: Gestisce le prove di stato
   - **Verification Logic**: Verifica le transizioni di stato

## Flusso di Dati

### Deposito (L1 → L2)

1. L'utente deposita ETH o token ERC20 nel contratto Deposit Bridge su Ethereum
2. Il contratto emette un evento di deposito
3. Il Sequencer rileva l'evento e crea una transazione corrispondente su L2
4. La transazione viene eseguita dalla Solana VM, aggiornando lo stato di L2
5. L'utente riceve i fondi sul suo account L2

```
User → Deposit Bridge (L1) → Event → Sequencer → Solana VM → User Account (L2)
```

### Transazione su L2

1. L'utente invia una transazione al Transaction Pool
2. Il Sequencer ordina e include la transazione in un batch
3. La Solana VM esegue la transazione, aggiornando lo stato
4. Il nuovo state root viene calcolato e pubblicato su Ethereum

```
User → Transaction Pool → Sequencer → Solana VM → State Update → State Commitment Chain (L1)
```

### Prelievo (L2 → L1)

1. L'utente inizia un prelievo su L2
2. La Solana VM esegue la transazione di prelievo, bruciando i token su L2
3. Il Sequencer pubblica il nuovo state root su Ethereum
4. Dopo il periodo di contestazione (7 giorni), l'utente può completare il prelievo
5. Il contratto Withdrawal Bridge rilascia i fondi all'utente su L1

```
User → Withdrawal Tx (L2) → Solana VM → State Update → State Commitment Chain (L1) → Wait Period → Withdrawal Bridge (L1) → User (L1)
```

### Sfida (Fraud Proof)

1. Un Validator rileva una transizione di stato invalida
2. Il Validator inizia una sfida sul contratto State Commitment Chain
3. Inizia il gioco di bisection per identificare la transazione invalida
4. La Solana VM esegue la transazione contestata in modo deterministico
5. Se la sfida ha successo, lo state root invalido viene rifiutato

```
Validator → Detect Invalid State → Initiate Challenge → Bisection Game → Execute Disputed Tx → Resolve Challenge
```

## Sicurezza e Garanzie

Il Layer-2 su Solana fornisce le seguenti garanzie di sicurezza:

1. **Liveness**: Finché almeno un Validator onesto è attivo, le transazioni valide saranno eventualmente incluse.
2. **Safety**: Nessuna transizione di stato invalida può essere finalizzata grazie al sistema di prove di frode.
3. **Data Availability**: Tutti i dati necessari per verificare lo stato sono disponibili su Ethereum.
4. **Censorship Resistance**: Gli utenti possono forzare l'inclusione delle loro transazioni attraverso il meccanismo di force-inclusion.

## Scalabilità e Performance

Il Layer-2 su Solana è progettato per scalare a:

- **Throughput**: >1,000 TPS inizialmente, con obiettivo futuro di 10,000 TPS
- **Latenza**: Conferma in 0.5-2 secondi (soggetta a finalizzazione su L1 dopo il periodo di contestazione)
- **Costo**: Riduzione delle commissioni di ~100x rispetto a Ethereum L1

## Limitazioni Attuali

1. **Periodo di Prelievo**: I prelievi richiedono un periodo di attesa di 7 giorni per la sicurezza.
2. **Compatibilità Parziale**: Non tutte le funzionalità di Solana sono supportate inizialmente.
3. **Centralizzazione del Sequencer**: Inizialmente, il Sequencer è centralizzato, con piani per la decentralizzazione in futuro.

## Roadmap Tecnica

1. **Fase 1 (Attuale)**: Implementazione core con Sequencer centralizzato
2. **Fase 2**: Miglioramenti di performance e supporto per token SPL
3. **Fase 3**: Decentralizzazione del Sequencer
4. **Fase 4**: Integrazione con ZK-proofs per prelievi istantanei
