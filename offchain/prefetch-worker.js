/**
 * Implementazione del worker per il prefetching predittivo della cache
 * 
 * Questo modulo implementa un worker thread dedicato al prefetching predittivo
 * basato su pattern di accesso, frequenza e analisi temporale.
 */

const { parentPort, workerData } = require('worker_threads');
const crypto = require('crypto');

// Configurazione del prefetching
const prefetchConfig = workerData.prefetchConfig || {
  strategy: 'pattern', // 'pattern', 'frequency', 'temporal', 'hybrid'
  threshold: 0.7,
  patternLength: 5,
  maxPrefetchItems: 10
};

// Stato interno del worker
const state = {
  accessPatterns: new Map(), // Mappa dei pattern di accesso
  keyFrequency: new Map(),   // Frequenza di accesso per chiave
  temporalData: new Map(),   // Dati temporali per chiave
  lastPrefetch: null,        // Timestamp dell'ultimo prefetch
  prefetchStats: {
    requested: 0,
    successful: 0,
    patterns: 0
  }
};

/**
 * Analizza un pattern di accesso e determina le chiavi da prefetchare
 * @param {Object} data - Dati del pattern
 * @returns {Array<string>} Chiavi da prefetchare
 */
function analyzePrefetchPattern(data) {
  const { keys, pattern, timestamp } = data;
  
  // Aggiorna le statistiche
  state.prefetchStats.requested++;
  
  // Seleziona la strategia di prefetching
  switch (prefetchConfig.strategy) {
    case 'pattern':
      return patternBasedPrefetch(pattern, keys);
      
    case 'frequency':
      return frequencyBasedPrefetch(keys);
      
    case 'temporal':
      return temporalBasedPrefetch(keys, timestamp);
      
    case 'hybrid':
      return hybridPrefetch(pattern, keys, timestamp);
      
    default:
      return patternBasedPrefetch(pattern, keys);
  }
}

/**
 * Prefetching basato su pattern di accesso
 * @param {string} pattern - Pattern di accesso
 * @param {Array<string>} keys - Chiavi candidate
 * @returns {Array<string>} Chiavi da prefetchare
 */
function patternBasedPrefetch(pattern, keys) {
  // Aggiorna la mappa dei pattern
  if (!state.accessPatterns.has(pattern)) {
    state.accessPatterns.set(pattern, new Map());
    state.prefetchStats.patterns++;
  }
  
  const patternMap = state.accessPatterns.get(pattern);
  
  // Aggiorna le frequenze per questo pattern
  for (const key of keys) {
    patternMap.set(key, (patternMap.get(key) || 0) + 1);
  }
  
  // Calcola il totale delle frequenze
  const totalFrequency = Array.from(patternMap.values()).reduce((sum, freq) => sum + freq, 0);
  
  // Seleziona le chiavi con probabilità superiore alla soglia
  const candidates = [];
  
  for (const [key, frequency] of patternMap.entries()) {
    const probability = frequency / totalFrequency;
    
    if (probability >= prefetchConfig.threshold) {
      candidates.push({ key, probability });
    }
  }
  
  // Ordina i candidati per probabilità (dal più probabile al meno probabile)
  candidates.sort((a, b) => b.probability - a.probability);
  
  // Limita il numero di chiavi da prefetchare
  return candidates
    .slice(0, prefetchConfig.maxPrefetchItems)
    .map(c => c.key);
}

/**
 * Prefetching basato su frequenza di accesso
 * @param {Array<string>} keys - Chiavi candidate
 * @returns {Array<string>} Chiavi da prefetchare
 */
function frequencyBasedPrefetch(keys) {
  // Aggiorna le frequenze di accesso
  for (const key of keys) {
    state.keyFrequency.set(key, (state.keyFrequency.get(key) || 0) + 1);
  }
  
  // Trova le chiavi correlate (chiavi che vengono spesso accedute insieme)
  const relatedKeys = new Map();
  
  for (const key of keys) {
    // Cerca altre chiavi che sono state accedute frequentemente
    for (const [otherKey, frequency] of state.keyFrequency.entries()) {
      if (otherKey !== key && frequency >= 3) {
        relatedKeys.set(otherKey, frequency);
      }
    }
  }
  
  // Ordina le chiavi correlate per frequenza
  const candidates = Array.from(relatedKeys.entries())
    .map(([key, frequency]) => ({ key, probability: frequency / Math.max(10, state.keyFrequency.size) }))
    .filter(item => item.probability >= prefetchConfig.threshold)
    .sort((a, b) => b.probability - a.probability);
  
  // Limita il numero di chiavi da prefetchare
  return candidates
    .slice(0, prefetchConfig.maxPrefetchItems)
    .map(c => c.key);
}

/**
 * Prefetching basato su analisi temporale
 * @param {Array<string>} keys - Chiavi candidate
 * @param {number} timestamp - Timestamp corrente
 * @returns {Array<string>} Chiavi da prefetchare
 */
function temporalBasedPrefetch(keys, timestamp) {
  const now = timestamp || Date.now();
  
  // Aggiorna i dati temporali
  for (const key of keys) {
    if (!state.temporalData.has(key)) {
      state.temporalData.set(key, []);
    }
    
    const timestamps = state.temporalData.get(key);
    timestamps.push(now);
    
    // Mantieni solo gli ultimi 10 timestamp
    if (timestamps.length > 10) {
      timestamps.shift();
    }
  }
  
  // Trova le chiavi che vengono accedute in sequenza temporale
  const sequentialKeys = new Map();
  
  for (const key of keys) {
    const keyTimestamps = state.temporalData.get(key);
    
    // Cerca altre chiavi che vengono accedute subito dopo questa
    for (const [otherKey, otherTimestamps] of state.temporalData.entries()) {
      if (otherKey === key) continue;
      
      // Conta quante volte l'altra chiave viene acceduta subito dopo questa
      let sequentialCount = 0;
      
      for (const ts of keyTimestamps) {
        // Cerca un timestamp dell'altra chiave che è poco dopo questo
        const isSequential = otherTimestamps.some(otherTs => 
          otherTs > ts && otherTs - ts < 5000 // Entro 5 secondi
        );
        
        if (isSequential) {
          sequentialCount++;
        }
      }
      
      // Se c'è una sequenza temporale significativa, aggiungi alla mappa
      if (sequentialCount >= 2) {
        const probability = sequentialCount / keyTimestamps.length;
        sequentialKeys.set(otherKey, probability);
      }
    }
  }
  
  // Ordina le chiavi sequenziali per probabilità
  const candidates = Array.from(sequentialKeys.entries())
    .map(([key, probability]) => ({ key, probability }))
    .filter(item => item.probability >= prefetchConfig.threshold)
    .sort((a, b) => b.probability - a.probability);
  
  // Limita il numero di chiavi da prefetchare
  return candidates
    .slice(0, prefetchConfig.maxPrefetchItems)
    .map(c => c.key);
}

/**
 * Prefetching ibrido che combina pattern, frequenza e analisi temporale
 * @param {string} pattern - Pattern di accesso
 * @param {Array<string>} keys - Chiavi candidate
 * @param {number} timestamp - Timestamp corrente
 * @returns {Array<string>} Chiavi da prefetchare
 */
function hybridPrefetch(pattern, keys, timestamp) {
  // Ottieni i risultati da ciascuna strategia
  const patternResults = patternBasedPrefetch(pattern, keys);
  const frequencyResults = frequencyBasedPrefetch(keys);
  const temporalResults = temporalBasedPrefetch(keys, timestamp);
  
  // Combina i risultati con pesi
  const combinedResults = new Map();
  
  // Peso per ciascuna strategia
  const weights = {
    pattern: 0.5,
    frequency: 0.3,
    temporal: 0.2
  };
  
  // Aggiungi i risultati del pattern con il loro peso
  for (const key of patternResults) {
    combinedResults.set(key, (combinedResults.get(key) || 0) + weights.pattern);
  }
  
  // Aggiungi i risultati della frequenza con il loro peso
  for (const key of frequencyResults) {
    combinedResults.set(key, (combinedResults.get(key) || 0) + weights.frequency);
  }
  
  // Aggiungi i risultati temporali con il loro peso
  for (const key of temporalResults) {
    combinedResults.set(key, (combinedResults.get(key) || 0) + weights.temporal);
  }
  
  // Ordina i risultati combinati per peso
  const candidates = Array.from(combinedResults.entries())
    .map(([key, weight]) => ({ key, weight }))
    .filter(item => item.weight >= prefetchConfig.threshold)
    .sort((a, b) => b.weight - a.weight);
  
  // Limita il numero di chiavi da prefetchare
  return candidates
    .slice(0, prefetchConfig.maxPrefetchItems)
    .map(c => c.key);
}

// Gestisci i messaggi dal thread principale
parentPort.on('message', (message) => {
  try {
    switch (message.type) {
      case 'prefetch':
        // Analizza il pattern e determina le chiavi da prefetchare
        const keysToFetch = analyzePrefetchPattern(message);
        
        // Invia il risultato al thread principale
        parentPort.postMessage({
          type: 'prefetch_result',
          requestId: message.requestId,
          pattern: message.pattern,
          fetched: keysToFetch,
          timestamp: Date.now()
        });
        
        // Aggiorna le statistiche
        state.prefetchStats.successful++;
        state.lastPrefetch = Date.now();
        break;
        
      case 'update_config':
        // Aggiorna la configurazione
        Object.assign(prefetchConfig, message.config);
        
        // Invia conferma al thread principale
        parentPort.postMessage({
          type: 'config_updated',
          config: prefetchConfig
        });
        break;
        
      case 'get_stats':
        // Invia le statistiche al thread principale
        parentPort.postMessage({
          type: 'stats',
          stats: {
            ...state.prefetchStats,
            patternCount: state.accessPatterns.size,
            keyFrequencyCount: state.keyFrequency.size,
            temporalDataCount: state.temporalData.size,
            lastPrefetch: state.lastPrefetch
          }
        });
        break;
        
      case 'clear':
        // Pulisci lo stato
        state.accessPatterns.clear();
        state.keyFrequency.clear();
        state.temporalData.clear();
        state.prefetchStats = {
          requested: 0,
          successful: 0,
          patterns: 0
        };
        state.lastPrefetch = null;
        
        // Invia conferma al thread principale
        parentPort.postMessage({
          type: 'cleared'
        });
        break;
        
      default:
        console.error(`Tipo di messaggio sconosciuto: ${message.type}`);
    }
  } catch (error) {
    // Invia l'errore al thread principale
    parentPort.postMessage({
      type: 'error',
      error: error.message,
      stack: error.stack
    });
  }
});

// Notifica al thread principale che il worker è pronto
parentPort.postMessage({
  type: 'ready',
  workerId: workerData.workerId
});
