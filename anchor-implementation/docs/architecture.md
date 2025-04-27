# Architettura del Sistema Layer-2 con BuyBot Enterprise

Questo documento descrive l'architettura completa del sistema Layer-2 con BuyBot Enterprise integrato, seguendo le best practice di Solana e utilizzando Anchor per una maggiore robustezza e sicurezza.

## Panoramica dell'Architettura

Il sistema è composto da tre componenti principali:

1. **Programma On-chain (Anchor)**: Implementa la logica core del Layer-2 e del BuyBot direttamente sulla blockchain Solana
2. **SDK TypeScript**: Fornisce un'interfaccia client per interagire con il programma on-chain
3. **Servizi Off-chain**: Gestiscono operazioni che non possono essere eseguite on-chain (relayer, monitoring, ecc.)

## Programma On-chain (Anchor)

### Account e PDAs

Il programma utilizza PDAs (Program Derived Addresses) per tutti gli account di stato, con seeds documentati:

| Account | Seeds | Descrizione |
|---------|-------|-------------|
| `layer2_state` | `["layer2_state"]` | Stato globale del sistema Layer-2 |
| `token_info` | `["token_info", mint]` | Informazioni su un token registrato |
| `vault` | `["vault", mint]` | Vault per un token specifico |
| `user_deposit` | `["user_deposit", user, mint]` | Deposito di un utente per un token |
| `bridge_state` | `["bridge_state"]` | Stato del bridge cross-chain |
| `bundle` | `["bundle", sequencer, bundle_id]` | Bundle di transazioni |
| `liquidity_lock` | `["liquidity_lock", mint, owner]` | Blocco di liquidità |
| `launchpad_info` | `["launchpad_info", mint]` | Informazioni sul launchpad per un token |
| `presale_state` | `["presale_state", mint]` | Stato della presale |
| `contribution` | `["contribution", user, mint]` | Contribuzione di un utente a una presale |

### Istruzioni Principali

Il programma implementa le seguenti istruzioni:

#### Core Layer-2
- `initialize`: Inizializza il sistema Layer-2
- `register_token`: Registra un nuovo token nel sistema
- `deposit`: Deposita token nel Layer-2
- `withdraw`: Ritira token dal Layer-2
- `verify_vaa`: Verifica un VAA di Wormhole per il bridge
- `execute_bundle`: Esegue un bundle di transazioni

#### BuyBot e Launchpad
- `lock_liquidity`: Blocca la liquidità per un token
- `create_token`: Crea un nuovo token tramite il launchpad
- `contribute_presale`: Contribuisce a una presale nel launchpad
- `finalize_presale`: Finalizza una presale e lancia il token
- `execute_buyback`: Esegue un'operazione di buyback
- `execute_burn`: Esegue un'operazione di burn

### Eventi

Il programma emette eventi per tutte le operazioni significative:

- `DepositEvent`: Quando un utente deposita token
- `WithdrawEvent`: Quando un utente ritira token
- `TaxEvent`: Quando vengono applicate tasse
- `BundleExecutedEvent`: Quando viene eseguito un bundle
- `LiquidityLockedEvent`: Quando viene bloccata la liquidità
- `TokenCreatedEvent`: Quando viene creato un nuovo token
- `ContributionEvent`: Quando un utente contribuisce a una presale
- `PresaleFinalizedEvent`: Quando viene finalizzata una presale
- `BuybackEvent`: Quando viene eseguito un buyback
- `BurnEvent`: Quando vengono bruciati token

## SDK TypeScript

L'SDK fornisce un'interfaccia client per interagire con il programma on-chain:

```typescript
const layer2Client = new Layer2Client(
  connection,
  wallet
);

// Esempio: Crea un token tramite il launchpad
const tx = await layer2Client.createToken(
  mint,
  {
    decimals: 9,
    presalePrice: 100000,
    listingPrice: 200000,
    softCap: 10 * LAMPORTS_PER_SOL,
    hardCap: 50 * LAMPORTS_PER_SOL,
    minContribution: 0.1 * LAMPORTS_PER_SOL,
    maxContribution: 5 * LAMPORTS_PER_SOL,
    liquidityPercentage: 80,
    startTime: Math.floor(Date.now() / 1000),
    endTime: Math.floor(Date.now() / 1000) + 604800,
    enableBuybot: true,
    taxBuy: 5,
    taxSell: 10,
    taxTransfer: 2,
    liquidityLockPeriod: 15552000
  }
);
```

## Servizi Off-chain

### Wormhole Relayer

Il relayer Wormhole è responsabile di:
1. Monitorare gli eventi sui contratti Ethereum
2. Verificare i VAA generati dai Guardian
3. Inviare i VAA verificati al programma on-chain tramite l'istruzione `verify_vaa`

### Sequencer

Il sequencer è responsabile di:
1. Raccogliere le transazioni Layer-2
2. Organizzarle in bundle
3. Eseguire i bundle tramite l'istruzione `execute_bundle`

### Monitoring Service

Il servizio di monitoring è responsabile di:
1. Monitorare lo stato del sistema
2. Rilevare anomalie e frodi
3. Attivare le procedure di recovery quando necessario

## Flussi di Lavoro Principali

### Lancio di un Token

1. Il creatore chiama `create_token` per creare un nuovo token e configurare il launchpad
2. Gli utenti chiamano `contribute_presale` per partecipare alla presale
3. Al termine della presale, il creatore chiama `finalize_presale` per finalizzare la presale e lanciare il token
4. Il sistema blocca automaticamente la liquidità se il buybot è abilitato

### Bridge Cross-chain

1. L'utente deposita token su Ethereum
2. Il relayer Wormhole monitora l'evento di deposito
3. I Guardian generano un VAA
4. Il relayer verifica il VAA e lo invia al programma on-chain tramite `verify_vaa`
5. Il programma on-chain verifica il VAA e sblocca i token corrispondenti

### Esecuzione di un Bundle

1. Il sequencer raccoglie le transazioni Layer-2
2. Il sequencer organizza le transazioni in un bundle
3. Il sequencer calcola il Merkle root del bundle
4. Il sequencer esegue il bundle tramite `execute_bundle`
5. Il programma on-chain verifica il Merkle root e aggiorna lo stato

## Sicurezza e Robustezza

### Validazione degli Account

Grazie all'uso di Anchor, tutti gli account sono validati automaticamente:
- Verifica che gli account siano di proprietà del programma corretto
- Verifica che i seeds e i bump siano corretti
- Verifica che i vincoli specificati siano rispettati

### Gestione degli Errori

Il programma utilizza un enum `ErrorCode` per gestire tutti gli errori possibili:
- `InsufficientFunds`: Fondi insufficienti
- `PresaleNotActive`: Presale non attiva
- `InvalidContributionAmount`: Importo di contribuzione non valido
- `PresaleNotEnded`: Presale non terminata
- `SoftCapNotReached`: Soft cap non raggiunto
- `BuybotNotEnabled`: Buybot non abilitato
- `Unauthorized`: Non autorizzato

### Test Completi

Il sistema include test completi per verificare tutte le funzionalità:
- Test unitari per ogni istruzione
- Test di integrazione per i flussi di lavoro completi
- Test di stress per verificare la robustezza sotto carico

## Diagramma di Flusso

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Utente    │     │  Programma  │     │  Sequencer  │
│             │     │  On-chain   │     │             │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │    deposit()      │                   │
       │───────────────────>                   │
       │                   │                   │
       │                   │    execute_bundle()
       │                   │<──────────────────│
       │                   │                   │
       │   withdraw()      │                   │
       │───────────────────>                   │
       │                   │                   │
┌──────┴──────┐     ┌──────┴──────┐     ┌──────┴──────┐
│   Utente    │     │  Programma  │     │  Sequencer  │
│             │     │  On-chain   │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
```

## Conclusione

Questa architettura segue le best practice di Solana e utilizza Anchor per garantire robustezza e sicurezza. La separazione tra programma on-chain, SDK e servizi off-chain permette una maggiore modularità e manutenibilità del sistema.
