#!/bin/bash

# Script di installazione per il Layer-2 su Solana
# Questo script installa e configura tutti i componenti necessari per il Layer-2 su Solana

# Colori per output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Funzione per stampare messaggi di log
log() {
  echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

# Funzione per stampare messaggi di successo
success() {
  echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

# Funzione per stampare messaggi di errore
error() {
  echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

# Funzione per stampare messaggi di avviso
warning() {
  echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

# Verifica che lo script sia eseguito come root
if [ "$EUID" -ne 0 ]; then
  error "Questo script deve essere eseguito come root"
  exit 1
fi

# Verifica che Docker sia installato
if ! command -v docker &> /dev/null; then
  log "Docker non è installato. Installazione in corso..."
  apt-get update
  apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io
  success "Docker installato con successo"
else
  success "Docker è già installato"
fi

# Verifica che Docker Compose sia installato
if ! command -v docker-compose &> /dev/null; then
  log "Docker Compose non è installato. Installazione in corso..."
  curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
  chmod +x /usr/local/bin/docker-compose
  success "Docker Compose installato con successo"
else
  success "Docker Compose è già installato"
fi

# Verifica che Node.js sia installato
if ! command -v node &> /dev/null; then
  log "Node.js non è installato. Installazione in corso..."
  curl -fsSL https://deb.nodesource.com/setup_16.x | bash -
  apt-get install -y nodejs
  success "Node.js installato con successo"
else
  success "Node.js è già installato"
fi

# Verifica che Rust sia installato
if ! command -v rustc &> /dev/null; then
  log "Rust non è installato. Installazione in corso..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source $HOME/.cargo/env
  success "Rust installato con successo"
else
  success "Rust è già installato"
fi

# Verifica che Solana CLI sia installato
if ! command -v solana &> /dev/null; then
  log "Solana CLI non è installato. Installazione in corso..."
  sh -c "$(curl -sSfL https://release.solana.com/v1.9.0/install)"
  success "Solana CLI installato con successo"
else
  success "Solana CLI è già installato"
fi

# Crea la directory di installazione
INSTALL_DIR="/opt/layer2-solana"
log "Creazione della directory di installazione: $INSTALL_DIR"
mkdir -p $INSTALL_DIR
cp -r ./* $INSTALL_DIR/
success "Directory di installazione creata con successo"

# Crea un utente dedicato per il Layer-2
LAYER2_USER="layer2"
log "Creazione dell'utente dedicato: $LAYER2_USER"
if id "$LAYER2_USER" &>/dev/null; then
  warning "L'utente $LAYER2_USER esiste già"
else
  useradd -m -s /bin/bash $LAYER2_USER
  success "Utente $LAYER2_USER creato con successo"
fi

# Assegna i permessi corretti
log "Assegnazione dei permessi corretti"
chown -R $LAYER2_USER:$LAYER2_USER $INSTALL_DIR
chmod -R 750 $INSTALL_DIR
success "Permessi assegnati con successo"

# Crea il file .env
log "Creazione del file .env"
cat > $INSTALL_DIR/.env << EOF
# Configurazione generale
NODE_ENV=production
LOG_LEVEL=info

# Configurazione Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
PROGRAM_ID=Layer2ProgramId11111111111111111111111111111111

# Configurazione Ethereum
ETHEREUM_RPC_URL=https://rinkeby.infura.io/v3/your-api-key
TOKEN_BRIDGE_ADDRESS=0x1234567890123456789012345678901234567890
WITHDRAWAL_BRIDGE_ADDRESS=0x0987654321098765432109876543210987654321

# Configurazione MongoDB
MONGO_USERNAME=admin
MONGO_PASSWORD=password
MONGO_DATABASE=layer2
MONGO_PORT=27017

# Configurazione Redis
REDIS_PASSWORD=password
REDIS_PORT=6379

# Configurazione API
API_PORT=3000
JWT_SECRET=your-jwt-secret
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX=100

# Configurazione Sequencer
SEQUENCER_PRIVATE_KEY=your-sequencer-private-key
MAX_BATCH_SIZE=100
BATCH_INTERVAL=1000
WORKER_COUNT=4
DEPOSIT_POLL_INTERVAL=5000
WITHDRAWAL_POLL_INTERVAL=5000

# Configurazione Validator
VALIDATOR_PRIVATE_KEY=your-validator-private-key

# Configurazione Prometheus e Grafana
PROMETHEUS_PORT=9090
GRAFANA_PORT=3001
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=admin

# Configurazione Notifier
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user
SMTP_PASS=password
NOTIFICATION_EMAIL=admin@example.com
SLACK_WEBHOOK_URL=your-slack-webhook-url
EOF
success "File .env creato con successo"

# Crea il servizio systemd
log "Creazione del servizio systemd"
cat > /etc/systemd/system/layer2-solana.service << EOF
[Unit]
Description=Layer-2 su Solana
After=network.target

[Service]
Type=simple
User=$LAYER2_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/local/bin/docker-compose -f $INSTALL_DIR/docker-compose.production.yml up
ExecStop=/usr/local/bin/docker-compose -f $INSTALL_DIR/docker-compose.production.yml down
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
success "Servizio systemd creato con successo"

# Ricarica systemd
log "Ricarica di systemd"
systemctl daemon-reload
success "Systemd ricaricato con successo"

# Avvia il servizio
log "Avvio del servizio"
systemctl enable layer2-solana.service
systemctl start layer2-solana.service
success "Servizio avviato con successo"

# Verifica lo stato del servizio
log "Verifica dello stato del servizio"
systemctl status layer2-solana.service
success "Stato del servizio verificato con successo"

# Istruzioni finali
success "Installazione completata con successo!"
log "Il Layer-2 su Solana è ora installato e in esecuzione."
log "Per verificare lo stato del servizio, esegui: systemctl status layer2-solana.service"
log "Per visualizzare i log, esegui: journalctl -u layer2-solana.service -f"
log "Per accedere all'API REST, visita: http://localhost:3000"
log "Per accedere a Grafana, visita: http://localhost:3001 (credenziali: admin/admin)"
log "Per accedere a Prometheus, visita: http://localhost:9090"
log "Per modificare la configurazione, modifica il file: $INSTALL_DIR/.env"
log "Per ulteriori informazioni, consulta la documentazione: $INSTALL_DIR/docs/README.md"
