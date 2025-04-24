#!/bin/bash

# Script di deployment per Solana Layer 2 Program su Devnet
# Questo script compila e distribuisce il programma Solana Layer 2 sulla rete Devnet

set -e

# Colori per output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Iniziando il deployment del programma Solana Layer 2 su Devnet...${NC}"

# Verifica che Solana CLI sia installato
if ! command -v solana &> /dev/null; then
    echo -e "${RED}Errore: Solana CLI non trovato. Installare Solana CLI prima di procedere.${NC}"
    exit 1
fi

# Verifica che Rust e Cargo siano installati
if ! command -v cargo &> /dev/null; then
    echo -e "${RED}Errore: Cargo non trovato. Installare Rust e Cargo prima di procedere.${NC}"
    exit 1
fi

# Verifica che il compilatore BPF sia installato
if ! command -v cargo-build-bpf &> /dev/null; then
    echo -e "${YELLOW}Installazione del compilatore BPF...${NC}"
    cargo install cargo-build-bpf
fi

# Imposta la rete Devnet
echo -e "${YELLOW}Impostazione della rete Devnet...${NC}"
solana config set --url https://api.devnet.solana.com

# Verifica che il wallet sia configurato
if ! solana address &> /dev/null; then
    echo -e "${YELLOW}Creazione di un nuovo wallet per il deployment...${NC}"
    solana-keygen new --no-passphrase
fi

# Mostra l'indirizzo del wallet
WALLET_ADDRESS=$(solana address)
echo -e "${GREEN}Utilizzo del wallet: ${WALLET_ADDRESS}${NC}"

# Verifica il saldo del wallet
BALANCE=$(solana balance)
echo -e "${GREEN}Saldo attuale: ${BALANCE}${NC}"

# Richiedi SOL dal faucet se necessario
if (( $(echo "$BALANCE < 1" | bc -l) )); then
    echo -e "${YELLOW}Richiesta di SOL dal faucet...${NC}"
    solana airdrop 2
    echo -e "${GREEN}Nuovo saldo: $(solana balance)${NC}"
fi

# Compila il programma
echo -e "${YELLOW}Compilazione del programma Solana Layer 2...${NC}"
cargo build-bpf --manifest-path=Cargo.toml

# Ottieni il percorso del file compilato
PROGRAM_PATH=$(find ./target/deploy -name "solana_layer2_program-keypair.json" -type f)
if [ -z "$PROGRAM_PATH" ]; then
    echo -e "${RED}Errore: File keypair del programma non trovato dopo la compilazione.${NC}"
    exit 1
fi

# Ottieni l'ID del programma
PROGRAM_ID=$(solana-keygen pubkey "$PROGRAM_PATH")
echo -e "${GREEN}ID del programma: ${PROGRAM_ID}${NC}"

# Distribuisci il programma
echo -e "${YELLOW}Distribuzione del programma su Devnet...${NC}"
solana program deploy --program-id "$PROGRAM_PATH" ./target/deploy/solana_layer2_program.so

# Verifica che il programma sia stato distribuito correttamente
if solana program show "$PROGRAM_ID" &> /dev/null; then
    echo -e "${GREEN}Programma Solana Layer 2 distribuito con successo su Devnet!${NC}"
    echo -e "${GREEN}ID del programma: ${PROGRAM_ID}${NC}"
    
    # Salva l'ID del programma in un file per riferimento futuro
    echo "$PROGRAM_ID" > program_id.txt
    echo -e "${GREEN}ID del programma salvato in program_id.txt${NC}"
else
    echo -e "${RED}Errore: Verifica del deployment fallita.${NC}"
    exit 1
fi

echo -e "${GREEN}Deployment completato con successo!${NC}"
