# Layer-2 su Solana - Infrastruttura di Testing e QA

Questo repository contiene l'infrastruttura di testing e QA completa per il Layer-2 su Solana, che include test unitari, test di integrazione, test end-to-end e strumenti di benchmark delle performance.

## Struttura del Repository

```
layer2-testing/
├── unit/                  # Test unitari per componenti individuali
│   ├── merkle_tree_test.rs
│   ├── state_transition_test.rs
│   ├── fraud_proof_test.rs
│   ├── block_finalization_test.rs
│   └── bridge_test.rs
├── integration/           # Test di integrazione per interazioni tra moduli
│   ├── deposit_flow_test.js
│   ├── withdrawal_flow_test.js
│   └── challenge_mechanism_test.js
├── e2e/                   # Test end-to-end per flussi utente completi
│   ├── setup-local-testnet.sh
│   └── deposit_transact_withdraw_test.js
├── performance/           # Strumenti di benchmark delle performance
│   ├── benchmark.js
│   └── results/           # Directory per i risultati dei benchmark
└── ci/                    # Configurazione CI/CD
    └── github-actions.yml
```

## Test Unitari

I test unitari verificano il corretto funzionamento dei singoli componenti del sistema. Sono implementati utilizzando il framework di test nativo di Rust e coprono i seguenti componenti:

- **Merkle Tree**: Verifica la creazione dell'albero, la generazione e verifica delle prove, e l'aggiornamento delle foglie.
- **State Transition**: Verifica le transizioni di stato per transazioni valide e invalide, inclusi casi di firma invalida, saldo insufficiente e nonce invalido.
- **Fraud Proof**: Verifica la generazione, serializzazione e verifica delle prove di frode per diversi tipi di frode.
- **Block Finalization**: Verifica il processo di finalizzazione dei blocchi, inclusi i casi di sfida e risoluzione delle sfide.
- **Bridge**: Verifica i meccanismi di deposito e prelievo per ETH e token ERC20.

## Test di Integrazione

I test di integrazione verificano le interazioni tra i vari moduli del sistema. Sono implementati utilizzando JavaScript con Mocha e Chai, e coprono i seguenti flussi:

- **Deposit Flow**: Verifica il flusso completo di deposito da L1 a L2, inclusi depositi multipli e token ERC20.
- **Withdrawal Flow**: Verifica il flusso completo di prelievo da L2 a L1, inclusi prelievi multipli e token ERC20.
- **Challenge Mechanism**: Verifica il meccanismo di sfida, inclusi il gioco di bisection e la risoluzione delle dispute.

## Test End-to-End

I test end-to-end verificano il funzionamento dell'intero sistema in un ambiente simile alla produzione. Includono:

- **Setup Local Testnet**: Script per configurare un ambiente di test locale con nodi Ethereum e Solana, contratti L1 e componenti L2.
- **Deposit-Transact-Withdraw**: Test che simula un flusso utente completo di deposito, transazione su L2 e prelievo.

## Benchmark delle Performance

Gli strumenti di benchmark misurano le prestazioni del sistema in termini di throughput, latenza e utilizzo delle risorse. Includono:

- **Benchmark Tool**: Strumento configurabile per misurare TPS e latenza con parametri regolabili per durata, thread e dimensione dei batch.
- **Results Directory**: Directory per salvare i risultati dei benchmark per analisi e confronti.

## Come Eseguire i Test

### Test Unitari

```bash
cd layer2-testing
cargo test --all
```

### Test di Integrazione

```bash
cd layer2-testing/integration
npm install
npm test
```

### Test End-to-End

```bash
cd layer2-testing/e2e
chmod +x setup-local-testnet.sh
./setup-local-testnet.sh
npm test
```

### Benchmark delle Performance

```bash
cd layer2-testing/performance
node benchmark.js --rpc-url=http://localhost:3000 --duration=60 --threads=8 --batch-size=100
```

## Configurazione CI/CD

Il repository include configurazione per GitHub Actions che automatizza l'esecuzione dei test su ogni commit e pull request. La pipeline CI/CD include:

- Esecuzione dei test unitari
- Esecuzione dei test di integrazione
- Esecuzione dei test end-to-end
- Verifica della copertura del codice

## Contribuire

Per contribuire all'infrastruttura di testing:

1. Clona il repository
2. Crea un branch per le tue modifiche
3. Aggiungi o modifica i test
4. Verifica che tutti i test passino
5. Invia una pull request

## Licenza

[Inserire informazioni sulla licenza]
