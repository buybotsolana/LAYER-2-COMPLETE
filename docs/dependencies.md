# Gestione delle Dipendenze

Questo documento descrive le dipendenze utilizzate nel progetto Layer-2 su Solana e le procedure per la loro gestione e aggiornamento.

## Indice

1. [Dipendenze JavaScript](#dipendenze-javascript)
2. [Dipendenze Rust](#dipendenze-rust)
3. [Gestione dei Conflitti](#gestione-dei-conflitti)
4. [Controlli di Sicurezza](#controlli-di-sicurezza)
5. [Procedure di Aggiornamento](#procedure-di-aggiornamento)

## Dipendenze JavaScript

### Dipendenze Principali

Il progetto utilizza le seguenti dipendenze JavaScript principali:

| Dipendenza | Versione | Descrizione |
|------------|----------|-------------|
| @solana/web3.js | ^1.73.0 | SDK ufficiale di Solana per JavaScript |
| web3 | ^1.10.0 | Libreria per interagire con blockchain Ethereum |
| ethers | ^5.7.2 | Alternativa a web3 per interazioni Ethereum |
| merkletreejs | ^0.3.10 | Implementazione di Merkle Tree |
| crypto-js | ^4.1.1 | Funzionalità crittografiche |
| express | ^4.18.2 | Framework web per Node.js |
| mongodb | ^4.13.0 | Driver per MongoDB |
| redis | ^4.6.4 | Client per Redis |
| axios | ^1.3.4 | Client HTTP |
| dotenv | ^16.0.3 | Gestione variabili d'ambiente |

### Struttura dei Package

Il progetto è organizzato in diversi sottomoduli, ognuno con il proprio file `package.json`:

- `/package.json` - Dipendenze principali del progetto
- `/offchain/package.json` - Componenti offchain
- `/bridge/package.json` - Bridge per Layer 2
- `/relayer/package.json` - Relayer per Wormhole
- `/sdk/package.json` - SDK per sviluppatori
- `/evm-compatibility/package.json` - Compatibilità con EVM

## Dipendenze Rust

### Dipendenze Principali

I componenti Rust utilizzano le seguenti dipendenze principali:

| Dipendenza | Versione | Descrizione |
|------------|----------|-------------|
| solana-program | 1.14.10 | SDK ufficiale di Solana per Rust |
| borsh | 0.9.3 | Serializzazione binaria |
| thiserror | 1.0.38 | Gestione degli errori |
| spl-token | 3.5.0 | Interfaccia per token SPL |
| serde | 1.0.152 | Serializzazione/deserializzazione |

### Struttura dei Crate

I componenti Rust sono organizzati nel seguente modo:

- `/onchain/Cargo.toml` - Programma Solana per Layer 2

## Gestione dei Conflitti

Per gestire i conflitti tra dipendenze transitive, utilizziamo la funzionalità `resolutions` di npm:

```json
"resolutions": {
  "minimist": "^1.2.6",
  "node-fetch": "^2.6.7"
}
```

Questa configurazione forza l'uso di versioni specifiche per le dipendenze transitive, risolvendo potenziali vulnerabilità di sicurezza.

## Controlli di Sicurezza

### Controlli Automatici

Il progetto utilizza GitHub Actions per eseguire controlli automatici di sicurezza:

1. **JavaScript Dependencies Check**: Esegue `npm audit` su tutti i package.json
2. **Rust Dependencies Check**: Esegue `cargo audit` sui componenti Rust
3. **Dependency Review**: Analizza le dipendenze nelle pull request

Il workflow è configurato in `.github/workflows/security-checks.yml` e viene eseguito:
- Ad ogni push sui branch principali
- Ad ogni pull request
- Settimanalmente (ogni domenica a mezzanotte)

### Controlli Manuali

Per eseguire controlli di sicurezza manualmente:

```bash
# Controllo di sicurezza per tutte le dipendenze
npm run security-check

# Controllo di sicurezza per un sottomodulo specifico
cd offchain && npm run security-check
```

Per i componenti Rust:

```bash
cd onchain && cargo audit
```

## Procedure di Aggiornamento

### Aggiornamento Regolare

1. Eseguire controlli di sicurezza per identificare dipendenze obsolete:
   ```bash
   npm run security-check
   ```

2. Aggiornare le dipendenze nei file package.json e Cargo.toml

3. Testare la compatibilità delle nuove versioni:
   ```bash
   ./scripts/test-compatibility.sh
   ```

4. Aggiornare la documentazione se necessario

### Aggiornamento di Emergenza

In caso di vulnerabilità critiche:

1. Identificare le dipendenze vulnerabili:
   ```bash
   npm audit --json
   ```

2. Aggiornare immediatamente le dipendenze vulnerabili:
   ```bash
   npm audit fix --force
   ```

3. Aggiungere resolutions se necessario

4. Testare la compatibilità e distribuire l'aggiornamento

### Script di Utilità

Il progetto include i seguenti script di utilità:

- `scripts/test-compatibility.sh`: Testa la compatibilità delle nuove versioni delle dipendenze
- `npm run security-check`: Esegue controlli di sicurezza su tutte le dipendenze
- `npm run audit:fix`: Corregge automaticamente le vulnerabilità quando possibile
