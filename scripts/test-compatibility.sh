#!/bin/bash

# Script per testare la compatibilità delle nuove versioni delle dipendenze
# Questo script verifica che tutte le dipendenze aggiornate siano compatibili
# con il codice esistente eseguendo test e build in tutti i sottomoduli.

echo "=== Test di compatibilità delle nuove versioni delle dipendenze ==="
echo "Data: $(date)"
echo

# Colori per l'output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Directory di lavoro
WORK_DIR="/home/ubuntu/github-upload/LAYER-2-COMPLETE"
cd $WORK_DIR

# Funzione per eseguire i test in un sottomodulo
run_tests() {
    local module=$1
    local module_dir=$2
    
    echo -e "\n=== Testando il modulo $module ==="
    
    cd $module_dir
    
    echo -n "Installazione delle dipendenze... "
    if npm install --no-audit --no-fund > /dev/null 2>&1; then
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${RED}FALLITO${NC}"
        echo "Errore durante l'installazione delle dipendenze in $module"
        return 1
    fi
    
    if [ -f "package.json" ]; then
        if grep -q "\"test\":" "package.json"; then
            echo -n "Esecuzione dei test... "
            if npm test --silent > /dev/null 2>&1; then
                echo -e "${GREEN}OK${NC}"
            else
                echo -e "${RED}FALLITO${NC}"
                echo "Errore durante l'esecuzione dei test in $module"
                return 1
            fi
        else
            echo -e "Nessun test configurato in $module... ${YELLOW}SALTATO${NC}"
        fi
        
        if grep -q "\"build\":" "package.json"; then
            echo -n "Esecuzione del build... "
            if npm run build --silent > /dev/null 2>&1; then
                echo -e "${GREEN}OK${NC}"
            else
                echo -e "${RED}FALLITO${NC}"
                echo "Errore durante l'esecuzione del build in $module"
                return 1
            fi
        else
            echo -e "Nessun build configurato in $module... ${YELLOW}SALTATO${NC}"
        fi
    fi
    
    cd $WORK_DIR
    return 0
}

# Funzione per testare le dipendenze Rust
test_rust_dependencies() {
    echo -e "\n=== Testando le dipendenze Rust ==="
    
    cd $WORK_DIR/onchain
    
    echo -n "Verifica della compilazione... "
    if cargo check --quiet > /dev/null 2>&1; then
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${RED}FALLITO${NC}"
        echo "Errore durante la verifica della compilazione Rust"
        return 1
    fi
    
    echo -n "Esecuzione dei test Rust... "
    if cargo test --quiet > /dev/null 2>&1; then
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${RED}FALLITO${NC}"
        echo "Errore durante l'esecuzione dei test Rust"
        return 1
    fi
    
    cd $WORK_DIR
    return 0
}

# Installa le dipendenze principali
echo -n "Installazione delle dipendenze principali... "
if npm install --no-audit --no-fund > /dev/null 2>&1; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FALLITO${NC}"
    echo "Errore durante l'installazione delle dipendenze principali"
    exit 1
fi

# Testa ogni sottomodulo
modules=(
    "offchain:$WORK_DIR/offchain"
    "bridge:$WORK_DIR/bridge"
    "relayer:$WORK_DIR/relayer"
    "sdk:$WORK_DIR/sdk"
    "evm-compatibility:$WORK_DIR/evm-compatibility"
)

errors=0

for module in "${modules[@]}"; do
    IFS=':' read -r name dir <<< "$module"
    if ! run_tests "$name" "$dir"; then
        ((errors++))
    fi
done

# Testa le dipendenze Rust
if ! test_rust_dependencies; then
    ((errors++))
fi

# Risultato finale
echo -e "\n=== Risultato finale ==="

if [ $errors -eq 0 ]; then
    echo -e "${GREEN}Tutte le dipendenze aggiornate sono compatibili con il codice esistente.${NC}"
    echo "L'aggiornamento delle dipendenze è stato completato con successo."
else
    echo -e "${RED}Sono stati rilevati $errors errori durante i test di compatibilità.${NC}"
    echo "Correggere gli errori prima di procedere con l'aggiornamento delle dipendenze."
fi

echo
echo "=== Fine dei test di compatibilità ==="
