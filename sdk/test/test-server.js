const express = require('express');
const path = require('path');
const { Layer2SolanaClient } = require('../src/client');
const { initializeLogging } = require('../src/logging');
const { initializeMonitoring } = require('../src/monitoring');

// Inizializza il logging
const logging = initializeLogging({
  level: 'info',
  service: 'layer2-solana-test-server',
  console: true,
  file: true,
  filename: 'layer2-solana-test-server.log'
});

const logger = logging.logger;

// Crea l'app Express
const app = express();
const port = process.env.PORT || 3000;

// Middleware per il parsing del JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware per il logging delle richieste HTTP
app.use(logging.requestLogger());

// Middleware per il logging degli errori
app.use(logging.errorLogger());

// Inizializza il client Layer-2 Solana
const client = new Layer2SolanaClient({
  logger,
  l1Provider: process.env.L1_PROVIDER || 'http://localhost:8545',
  l2Provider: process.env.L2_PROVIDER || 'http://localhost:8899'
});

// Inizializza il monitoraggio
const monitoring = initializeMonitoring({
  logger,
  express: app,
  metrics: {
    metricsPath: '/metrics',
    healthPath: '/health'
  },
  alerts: {
    alertsPath: '/alerts'
  }
});

// Servi i file statici dalla directory public
app.use(express.static(path.join(__dirname, 'public')));

// Endpoint per ottenere informazioni sul client
app.get('/api/info', (req, res) => {
  res.json({
    l1Provider: client.l1Provider,
    l2Provider: client.l2Provider,
    version: require('../package.json').version,
    timestamp: Date.now()
  });
});

// Endpoint per il bridge deposit
app.post('/api/bridge/deposit', async (req, res) => {
  try {
    const { token, amount, sender, recipient } = req.body;
    
    if (!token || !amount || !sender || !recipient) {
      return res.status(400).json({
        error: 'Missing required parameters: token, amount, sender, recipient'
      });
    }
    
    const result = await client.bridge.deposit({
      token,
      amount,
      sender,
      recipient
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Error processing deposit', { error: error.message });
    res.status(500).json({
      error: error.message
    });
  }
});

// Endpoint per il bridge withdraw
app.post('/api/bridge/withdraw', async (req, res) => {
  try {
    const { token, amount, sender, recipient } = req.body;
    
    if (!token || !amount || !sender || !recipient) {
      return res.status(400).json({
        error: 'Missing required parameters: token, amount, sender, recipient'
      });
    }
    
    const result = await client.bridge.withdraw({
      token,
      amount,
      sender,
      recipient
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Error processing withdrawal', { error: error.message });
    res.status(500).json({
      error: error.message
    });
  }
});

// Endpoint per inviare una transazione
app.post('/api/transaction/send', async (req, res) => {
  try {
    const { signedTransaction } = req.body;
    
    if (!signedTransaction) {
      return res.status(400).json({
        error: 'Missing required parameter: signedTransaction'
      });
    }
    
    const result = await client.sendTransaction(signedTransaction);
    
    res.json(result);
  } catch (error) {
    logger.error('Error sending transaction', { error: error.message });
    res.status(500).json({
      error: error.message
    });
  }
});

// Middleware per la gestione degli errori
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Avvia il server
app.listen(port, () => {
  logger.info(`Layer-2 Solana test server listening on port ${port}`);
});

module.exports = app;
