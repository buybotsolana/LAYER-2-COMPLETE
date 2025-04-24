/**
 * Implementazione del worker thread per l'elaborazione parallela
 * 
 * Questo file viene eseguito in un worker thread separato e gestisce
 * l'elaborazione dei task inviati dal thread principale.
 */

const { parentPort, workerData } = require('worker_threads');
const crypto = require('crypto');

// Recupera l'ID del worker dai dati passati
const workerId = workerData.workerId;

// Stato interno del worker
const workerState = {
  status: 'idle',
  tasksProcessed: 0,
  tasksSucceeded: 0,
  tasksFailed: 0,
  totalProcessingTime: 0,
  currentTaskId: null,
  currentTaskStartTime: null,
  lastTaskEndTime: null
};

// Mappa dei gestori di task
const taskHandlers = {
  // Gestore per il task di hash
  'hash': (data) => {
    const { algorithm, input } = data;
    return crypto.createHash(algorithm || 'sha256').update(input).digest('hex');
  },
  
  // Gestore per il task di verifica Merkle
  'merkle_verify': (data) => {
    const { leaf, proof, root, hashAlgorithm } = data;
    
    // Converti i buffer se necessario
    const leafBuffer = Buffer.isBuffer(leaf) ? leaf : Buffer.from(leaf, 'hex');
    const rootBuffer = Buffer.isBuffer(root) ? root : Buffer.from(root, 'hex');
    
    // Verifica la prova
    let currentHash = leafBuffer;
    
    for (const { data, position } of proof) {
      const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'hex');
      
      if (position === 'left') {
        currentHash = hashPair(dataBuffer, currentHash, hashAlgorithm);
      } else {
        currentHash = hashPair(currentHash, dataBuffer, hashAlgorithm);
      }
    }
    
    // Verifica che l'hash finale sia uguale alla radice
    return Buffer.compare(currentHash, rootBuffer) === 0;
  },
  
  // Gestore per il task di compressione
  'compress': (data) => {
    const { input, algorithm } = data;
    const zlib = require('zlib');
    
    // Converti l'input in buffer se necessario
    const inputBuffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
    
    // Comprimi i dati in base all'algoritmo
    switch (algorithm) {
      case 'gzip':
        return zlib.gzipSync(inputBuffer);
      case 'deflate':
        return zlib.deflateSync(inputBuffer);
      case 'brotli':
        return zlib.brotliCompressSync(inputBuffer);
      default:
        return zlib.deflateSync(inputBuffer);
    }
  },
  
  // Gestore per il task di decompressione
  'decompress': (data) => {
    const { input, algorithm } = data;
    const zlib = require('zlib');
    
    // Converti l'input in buffer se necessario
    const inputBuffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
    
    // Decomprimi i dati in base all'algoritmo
    switch (algorithm) {
      case 'gzip':
        return zlib.gunzipSync(inputBuffer);
      case 'deflate':
        return zlib.inflateSync(inputBuffer);
      case 'brotli':
        return zlib.brotliDecompressSync(inputBuffer);
      default:
        return zlib.inflateSync(inputBuffer);
    }
  },
  
  // Gestore per il task di crittografia
  'encrypt': (data) => {
    const { input, key, algorithm, iv } = data;
    
    // Converti l'input e la chiave in buffer se necessario
    const inputBuffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
    const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key);
    const ivBuffer = iv ? (Buffer.isBuffer(iv) ? iv : Buffer.from(iv)) : crypto.randomBytes(16);
    
    // Crea il cipher
    const cipher = crypto.createCipheriv(algorithm || 'aes-256-cbc', keyBuffer, ivBuffer);
    
    // Cifra i dati
    const encrypted = Buffer.concat([cipher.update(inputBuffer), cipher.final()]);
    
    return {
      encrypted,
      iv: ivBuffer
    };
  },
  
  // Gestore per il task di decrittografia
  'decrypt': (data) => {
    const { input, key, algorithm, iv } = data;
    
    // Converti l'input, la chiave e l'IV in buffer se necessario
    const inputBuffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
    const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key);
    const ivBuffer = Buffer.isBuffer(iv) ? iv : Buffer.from(iv);
    
    // Crea il decipher
    const decipher = crypto.createDecipheriv(algorithm || 'aes-256-cbc', keyBuffer, ivBuffer);
    
    // Decifra i dati
    return Buffer.concat([decipher.update(inputBuffer), decipher.final()]);
  },
  
  // Gestore per il task di calcolo JSON
  'json_process': (data) => {
    const { input, operations } = data;
    
    // Clona l'input per evitare modifiche indesiderate
    let result = JSON.parse(JSON.stringify(input));
    
    // Esegui le operazioni in sequenza
    for (const op of operations) {
      switch (op.type) {
        case 'filter':
          if (Array.isArray(result)) {
            result = result.filter(item => {
              // Valuta la condizione di filtro
              try {
                const condition = new Function('item', `return ${op.condition}`);
                return condition(item);
              } catch (error) {
                throw new Error(`Invalid filter condition: ${error.message}`);
              }
            });
          }
          break;
          
        case 'map':
          if (Array.isArray(result)) {
            result = result.map(item => {
              // Applica la trasformazione
              try {
                const transform = new Function('item', op.transform);
                return transform(item);
              } catch (error) {
                throw new Error(`Invalid map transform: ${error.message}`);
              }
            });
          }
          break;
          
        case 'sort':
          if (Array.isArray(result)) {
            result.sort((a, b) => {
              // Applica il criterio di ordinamento
              try {
                const compare = new Function('a', 'b', `return ${op.compare}`);
                return compare(a, b);
              } catch (error) {
                throw new Error(`Invalid sort compare: ${error.message}`);
              }
            });
          }
          break;
          
        case 'reduce':
          if (Array.isArray(result)) {
            try {
              const reducer = new Function('acc', 'item', op.reducer);
              result = result.reduce(reducer, op.initialValue);
            } catch (error) {
              throw new Error(`Invalid reducer: ${error.message}`);
            }
          }
          break;
          
        case 'transform':
          try {
            const transform = new Function('data', op.code);
            result = transform(result);
          } catch (error) {
            throw new Error(`Invalid transform: ${error.message}`);
          }
          break;
          
        default:
          throw new Error(`Unknown operation type: ${op.type}`);
      }
    }
    
    return result;
  }
};

/**
 * Calcola l'hash di una coppia di nodi
 * @param {Buffer} left - Nodo sinistro
 * @param {Buffer} right - Nodo destro
 * @param {string} hashAlgorithm - Algoritmo di hash da utilizzare
 * @returns {Buffer} Hash della coppia
 */
function hashPair(left, right, hashAlgorithm = 'sha256') {
  // Ordina i nodi per garantire la coerenza
  const pair = Buffer.concat(
    Buffer.compare(left, right) <= 0 ? [left, right] : [right, left]
  );
  
  // Calcola l'hash
  return crypto.createHash(hashAlgorithm).update(pair).digest();
}

// Notifica al thread principale che il worker è pronto
parentPort.postMessage({
  type: 'worker_ready',
  workerId
});

// Gestisci i messaggi dal thread principale
parentPort.on('message', (message) => {
  switch (message.type) {
    case 'execute_task':
      executeTask(message.taskId, message.taskType, message.data);
      break;
      
    case 'update_config':
      // Aggiorna la configurazione del worker
      Object.assign(workerData, message.config);
      break;
      
    case 'get_stats':
      // Invia le statistiche del worker
      parentPort.postMessage({
        type: 'worker_stats',
        stats: { ...workerState }
      });
      break;
      
    case 'ping':
      // Risponde al ping
      parentPort.postMessage({
        type: 'pong',
        workerId,
        timestamp: Date.now()
      });
      break;
      
    default:
      console.error(`Unknown message type: ${message.type}`);
  }
});

/**
 * Esegue un task
 * @param {string} taskId - ID del task
 * @param {string} taskType - Tipo di task
 * @param {*} data - Dati del task
 */
function executeTask(taskId, taskType, data) {
  // Aggiorna lo stato del worker
  workerState.status = 'busy';
  workerState.currentTaskId = taskId;
  workerState.currentTaskStartTime = Date.now();
  
  // Notifica al thread principale che il worker è occupato
  parentPort.postMessage({
    type: 'worker_busy',
    workerId,
    taskId
  });
  
  try {
    // Verifica se esiste un gestore per questo tipo di task
    if (!taskHandlers[taskType]) {
      throw new Error(`Unknown task type: ${taskType}`);
    }
    
    // Esegui il task
    const result = taskHandlers[taskType](data);
    
    // Aggiorna le statistiche
    workerState.tasksProcessed++;
    workerState.tasksSucceeded++;
    workerState.totalProcessingTime += Date.now() - workerState.currentTaskStartTime;
    workerState.lastTaskEndTime = Date.now();
    
    // Invia il risultato al thread principale
    parentPort.postMessage({
      type: 'task_result',
      workerId,
      taskId,
      result
    });
  } catch (error) {
    // Aggiorna le statistiche
    workerState.tasksProcessed++;
    workerState.tasksFailed++;
    workerState.totalProcessingTime += Date.now() - workerState.currentTaskStartTime;
    workerState.lastTaskEndTime = Date.now();
    
    // Invia l'errore al thread principale
    parentPort.postMessage({
      type: 'task_error',
      workerId,
      taskId,
      error: error.message
    });
  } finally {
    // Aggiorna lo stato del worker
    workerState.status = 'idle';
    workerState.currentTaskId = null;
    workerState.currentTaskStartTime = null;
  }
}

// Gestisci gli errori non catturati
process.on('uncaughtException', (error) => {
  console.error(`Worker ${workerId} uncaught exception:`, error);
  
  // Invia l'errore al thread principale
  parentPort.postMessage({
    type: 'error',
    workerId,
    error: error.message
  });
});

// Log di inizializzazione
console.log(`Worker ${workerId} initialized`);
