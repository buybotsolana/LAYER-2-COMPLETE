# Solana Layer 2 Program - README

## Panoramica

Questo programma Solana implementa un sistema Layer 2 scalabile per Solana, consentendo transazioni ad alto throughput con costi ridotti mantenendo la sicurezza della blockchain principale. Il sistema utilizza un modello di rollup ottimistico con un meccanismo di contestazione per garantire la correttezza delle transazioni.

## Caratteristiche principali

- **Sequencer ottimizzato**: Elaborazione parallela delle transazioni con sharding dinamico
- **Batching efficiente**: Raggruppamento intelligente delle transazioni per massimizzare il throughput
- **Sistema di contestazione**: Meccanismo di sicurezza per contestare transazioni invalide
- **Bridge Layer 1 ↔ Layer 2**: Trasferimento sicuro di asset tra Solana e il Layer 2
- **Verifica crittografica**: Utilizzo di Merkle proofs per verificare l'integrità delle transazioni

## Struttura del codice

- `src/lib.rs`: Entrypoint del programma e funzioni principali
- `src/instruction.rs`: Definizione delle istruzioni supportate dal programma
- `src/processor.rs`: Elaborazione delle istruzioni
- `src/state.rs`: Strutture dati per lo stato del sistema
- `src/verification.rs`: Funzioni di verifica delle prove crittografiche
- `src/error.rs`: Definizione degli errori specifici del programma
- `src/security.rs`: Funzioni di sicurezza e validazione

## Istruzioni supportate

1. **Initialize**: Inizializza il sistema Layer 2
2. **RegisterSequencer**: Registra un nuovo sequencer
3. **RemoveSequencer**: Rimuove un sequencer esistente
4. **CommitBatch**: Commit di un batch di transazioni
5. **ChallengeBatch**: Contesta un batch di transazioni
6. **ResolveChallenge**: Risolve una contestazione
7. **FinalizeBatch**: Finalizza un batch dopo il periodo di contestazione
8. **Deposit**: Deposita asset da Layer 1 a Layer 2
9. **Withdraw**: Preleva asset da Layer 2 a Layer 1
10. **UpdateParameters**: Aggiorna i parametri del sistema

## Prerequisiti

- Rust e Cargo (versione 1.68.0 o superiore)
- Solana CLI (versione 1.16.0 o superiore)
- Account Solana con SOL per il deployment

## Compilazione

```bash
# Compilare il programma
cargo build-bpf
```

## Test

```bash
# Eseguire i test
cargo test-bpf
```

## Deployment

Per deployare il programma sulla devnet di Solana, utilizzare lo script `deploy_devnet.sh`:

```bash
# Rendere lo script eseguibile
chmod +x deploy_devnet.sh

# Eseguire lo script
./deploy_devnet.sh
```

Lo script eseguirà le seguenti operazioni:
1. Verificare che tutti i prerequisiti siano installati
2. Compilare il programma
3. Deployare il programma sulla devnet di Solana
4. Salvare il Program ID in un file per riferimento futuro
5. Eseguire i test di verifica

## Sicurezza

Questo programma implementa diverse misure di sicurezza:

- Validazione rigorosa degli input
- Controlli di autorizzazione per operazioni privilegiate
- Verifica crittografica delle transazioni
- Meccanismo di contestazione per identificare e correggere transazioni invalide
- Protezione contro attacchi di front-running

**Nota**: Prima del deployment in mainnet, è fortemente consigliato un audit di sicurezza completo da parte di una società specializzata.

## Licenza

MIT
