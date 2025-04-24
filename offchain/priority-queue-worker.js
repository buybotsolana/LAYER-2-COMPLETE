/**
 * Implementazione del worker per la coda di priorità
 * 
 * Questo modulo implementa un worker thread per il calcolo parallelo
 * delle priorità delle transazioni nella coda di priorità.
 */

const { parentPort, workerData } = require('worker_threads');

// Ottieni i dati del worker
const { workerId, priorityLevels, priorityWeights } = workerData;

// Stato interno
let weights = { ...priorityWeights };

// Gestisci i messaggi dal thread principale
parentPort.on('message', (message) => {
  try {
    switch (message.type) {
      case 'calculate_priority':
        // Calcola la priorità della transazione
        const priority = calculatePriority(message.transaction);
        
        // Invia il risultato al thread principale
        parentPort.postMessage({
          type: 'priority_calculated',
          transaction: message.transaction,
          priority
        });
        break;
        
      case 'update_weights':
        // Aggiorna i pesi di prioritizzazione
        weights = { ...message.weights };
        break;
        
      default:
        throw new Error(`Tipo di messaggio sconosciuto: ${message.type}`);
    }
  } catch (error) {
    // Invia l'errore al thread principale
    parentPort.postMessage({
      type: 'error',
      error: error.message
    });
  }
});

/**
 * Calcola la priorità di una transazione
 * @param {Object} transaction - Transazione
 * @returns {number} Priorità normalizzata (0-1)
 */
function calculatePriority(transaction) {
  // Estrai i fattori di priorità
  const fee = transaction.fee || 0;
  const age = Date.now() - (transaction.timestamp || Date.now());
  const size = transaction.size || 1;
  const sender = transaction.sender || '';
  
  // Normalizza i fattori
  const maxFee = 1000000; // Valore massimo atteso per le commissioni
  const maxAge = 3600000; // 1 ora in millisecondi
  const maxSize = 10000; // Dimensione massima attesa per una transazione
  
  const normalizedFee = Math.min(1, fee / maxFee);
  const normalizedAge = Math.min(1, age / maxAge);
  const normalizedSize = 1 - Math.min(1, size / maxSize); // Inverti per dare priorità alle transazioni più piccole
  
  // Calcola lo score del mittente (semplificato nel worker)
  const senderScore = 0.5; // Valore predefinito nel worker
  
  // Calcola la priorità ponderata
  const priority = 
    weights.fee * normalizedFee +
    weights.age * normalizedAge +
    weights.size * normalizedSize +
    weights.sender * senderScore;
  
  return Math.min(1, Math.max(0, priority));
}

// Notifica che il worker è pronto
parentPort.postMessage({
  type: 'ready',
  workerId
});

console.log(`Worker ${workerId} inizializzato`);
