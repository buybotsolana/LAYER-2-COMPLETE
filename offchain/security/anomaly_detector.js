/**
 * @fileoverview Implementazione di un sistema di rilevamento anomalie
 * 
 * Questo modulo implementa un sistema di rilevamento anomalie che monitora
 * vari parametri del sistema e identifica comportamenti anomali in base
 * a soglie statistiche e regole predefinite.
 */

const { Logger } = require('../logger');
const { EventEmitter } = require('events');

// Configurazione del logger
const logger = new Logger('anomaly-detector');

/**
 * Classe AnomalyDetector
 * 
 * Implementa un sistema di rilevamento anomalie con supporto per
 * statistiche di base, calcolo di soglie dinamiche e notifiche.
 */
class AnomalyDetector extends EventEmitter {
  /**
   * Crea una nuova istanza di AnomalyDetector
   * @param {Object} config - Configurazione per il rilevatore
   * @param {number} config.alertThreshold - Soglia di allerta in deviazioni standard (default: 3)
   * @param {number} config.baselinePeriod - Periodo per il calcolo della baseline in millisecondi (default: 24 ore)
   * @param {number} config.updateInterval - Intervallo di aggiornamento in millisecondi (default: 5 minuti)
   * @param {Object} config.metrics - Metriche da monitorare con configurazioni specifiche
   */
  constructor(config = {}) {
    super();
    
    this.alertThreshold = config.alertThreshold || 3;
    this.baselinePeriod = config.baselinePeriod || 24 * 60 * 60 * 1000; // 24 ore
    this.updateInterval = config.updateInterval || 5 * 60 * 1000; // 5 minuti
    this.metrics = config.metrics || {
      transactionsPerMinute: { weight: 1 },
      failureRate: { weight: 2 },
      responseTime: { weight: 1 },
      cpuUsage: { weight: 1 },
      memoryUsage: { weight: 1 }
    };
    
    // Statistiche di base per ogni metrica
    this.baselineStats = {};
    
    // Valori correnti per ogni metrica
    this.currentStats = {};
    
    // Storico dei valori per ogni metrica
    this.history = {};
    
    // Anomalie rilevate
    this.anomalies = [];
    
    // Massimo numero di anomalie da memorizzare
    this.maxAnomalies = config.maxAnomalies || 100;
    
    // Intervallo di aggiornamento
    this.updateIntervalId = null;
    
    // Inizializza le statistiche
    this._initializeStats();
    
    logger.info('AnomalyDetector inizializzato', {
      alertThreshold: this.alertThreshold,
      baselinePeriod: this.baselinePeriod,
      updateInterval: this.updateInterval,
      metricsCount: Object.keys(this.metrics).length
    });
  }
  
  /**
   * Inizializza le statistiche
   * @private
   */
  _initializeStats() {
    for (const metric of Object.keys(this.metrics)) {
      this.baselineStats[metric] = {
        mean: 0,
        stdDev: 0,
        min: Infinity,
        max: -Infinity,
        count: 0,
        sum: 0,
        sumSquares: 0,
        lastUpdate: 0
      };
      
      this.currentStats[metric] = 0;
      this.history[metric] = [];
    }
  }
  
  /**
   * Avvia il rilevatore di anomalie
   * @returns {Promise<void>}
   */
  async start() {
    if (this.updateIntervalId) {
      logger.warn('Il rilevatore di anomalie è già avviato');
      return;
    }
    
    logger.info('Avvio del rilevatore di anomalie');
    
    // Carica i dati storici se disponibili
    await this._loadHistoricalData();
    
    // Imposta l'intervallo di aggiornamento
    this.updateIntervalId = setInterval(() => this._updateBaseline(), this.updateInterval);
    
    logger.info('Rilevatore di anomalie avviato');
  }
  
  /**
   * Ferma il rilevatore di anomalie
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.updateIntervalId) {
      logger.warn('Il rilevatore di anomalie non è avviato');
      return;
    }
    
    logger.info('Arresto del rilevatore di anomalie');
    
    // Ferma l'intervallo di aggiornamento
    clearInterval(this.updateIntervalId);
    this.updateIntervalId = null;
    
    // Salva i dati storici
    await this._saveHistoricalData();
    
    logger.info('Rilevatore di anomalie arrestato');
  }
  
  /**
   * Aggiorna le statistiche con nuovi valori
   * @param {Object} stats - Nuovi valori per le metriche
   * @returns {Array<Object>} Anomalie rilevate
   */
  updateStats(stats) {
    logger.debug('Aggiornamento statistiche', { stats });
    
    const now = Date.now();
    const anomalies = [];
    
    // Aggiorna le statistiche correnti
    for (const [metric, value] of Object.entries(stats)) {
      if (!(metric in this.metrics)) {
        logger.warn(`Metrica sconosciuta: ${metric}`);
        continue;
      }
      
      // Aggiorna il valore corrente
      this.currentStats[metric] = value;
      
      // Aggiungi il valore alla storia
      this.history[metric].push({
        timestamp: now,
        value
      });
      
      // Limita la dimensione della storia
      const maxHistorySize = Math.ceil(this.baselinePeriod / this.updateInterval) * 2;
      if (this.history[metric].length > maxHistorySize) {
        this.history[metric] = this.history[metric].slice(-maxHistorySize);
      }
    }
    
    // Controlla le anomalie
    const newAnomalies = this._checkAnomalies();
    
    // Aggiungi le nuove anomalie alla lista
    if (newAnomalies.length > 0) {
      this.anomalies.push(...newAnomalies);
      
      // Limita la dimensione della lista di anomalie
      if (this.anomalies.length > this.maxAnomalies) {
        this.anomalies = this.anomalies.slice(-this.maxAnomalies);
      }
      
      // Emetti l'evento per le nuove anomalie
      this.emit('anomalies', newAnomalies);
      
      // Registra le anomalie
      logger.warn('Anomalie rilevate', { anomalies: newAnomalies });
    }
    
    return newAnomalies;
  }
  
  /**
   * Controlla le anomalie in base alle statistiche correnti
   * @returns {Array<Object>} Anomalie rilevate
   * @private
   */
  _checkAnomalies() {
    const anomalies = [];
    const now = Date.now();
    
    for (const [metric, value] of Object.entries(this.currentStats)) {
      if (!(metric in this.baselineStats)) {
        continue;
      }
      
      const stats = this.baselineStats[metric];
      
      // Salta se non ci sono abbastanza dati
      if (stats.count < 10) {
        continue;
      }
      
      // Calcola lo z-score
      const zScore = Math.abs((value - stats.mean) / stats.stdDev);
      
      // Se lo z-score supera la soglia, è un'anomalia
      if (zScore > this.alertThreshold) {
        const anomaly = {
          metric,
          value,
          timestamp: now,
          zScore,
          threshold: this.alertThreshold,
          baseline: {
            mean: stats.mean,
            stdDev: stats.stdDev,
            min: stats.min,
            max: stats.max
          },
          severity: this._calculateSeverity(zScore, this.metrics[metric].weight || 1)
        };
        
        anomalies.push(anomaly);
      }
    }
    
    return anomalies;
  }
  
  /**
   * Calcola la severità di un'anomalia
   * @param {number} zScore - Z-score dell'anomalia
   * @param {number} weight - Peso della metrica
   * @returns {string} Severità (low, medium, high, critical)
   * @private
   */
  _calculateSeverity(zScore, weight) {
    const weightedScore = zScore * weight;
    
    if (weightedScore > this.alertThreshold * 3) {
      return 'critical';
    } else if (weightedScore > this.alertThreshold * 2) {
      return 'high';
    } else if (weightedScore > this.alertThreshold * 1.5) {
      return 'medium';
    } else {
      return 'low';
    }
  }
  
  /**
   * Aggiorna la baseline in base ai dati storici
   * @private
   */
  _updateBaseline() {
    const now = Date.now();
    const cutoff = now - this.baselinePeriod;
    
    for (const metric of Object.keys(this.metrics)) {
      // Filtra i dati storici nel periodo di baseline
      const recentData = this.history[metric].filter(item => item.timestamp >= cutoff);
      
      if (recentData.length < 2) {
        logger.debug(`Dati insufficienti per aggiornare la baseline di ${metric}`);
        continue;
      }
      
      // Calcola le statistiche
      let sum = 0;
      let sumSquares = 0;
      let min = Infinity;
      let max = -Infinity;
      
      for (const item of recentData) {
        sum += item.value;
        sumSquares += item.value * item.value;
        min = Math.min(min, item.value);
        max = Math.max(max, item.value);
      }
      
      const count = recentData.length;
      const mean = sum / count;
      const variance = (sumSquares / count) - (mean * mean);
      const stdDev = Math.sqrt(Math.max(0, variance));
      
      // Aggiorna le statistiche di base
      this.baselineStats[metric] = {
        mean,
        stdDev,
        min,
        max,
        count,
        sum,
        sumSquares,
        lastUpdate: now
      };
      
      logger.debug(`Baseline aggiornata per ${metric}`, {
        mean,
        stdDev,
        min,
        max,
        count
      });
    }
  }
  
  /**
   * Carica i dati storici
   * @returns {Promise<void>}
   * @private
   */
  async _loadHistoricalData() {
    try {
      logger.debug('Caricamento dati storici');
      
      // Implementazione del caricamento dei dati storici
      // (da un database, file, ecc.)
      
      logger.info('Dati storici caricati');
    } catch (error) {
      logger.error('Errore durante il caricamento dei dati storici', { error: error.message });
    }
  }
  
  /**
   * Salva i dati storici
   * @returns {Promise<void>}
   * @private
   */
  async _saveHistoricalData() {
    try {
      logger.debug('Salvataggio dati storici');
      
      // Implementazione del salvataggio dei dati storici
      // (su un database, file, ecc.)
      
      logger.info('Dati storici salvati');
    } catch (error) {
      logger.error('Errore durante il salvataggio dei dati storici', { error: error.message });
    }
  }
  
  /**
   * Ottiene le anomalie rilevate
   * @param {Object} [options] - Opzioni di filtro
   * @param {number} [options.since] - Timestamp minimo
   * @param {number} [options.until] - Timestamp massimo
   * @param {Array<string>} [options.metrics] - Metriche da includere
   * @param {Array<string>} [options.severities] - Severità da includere
   * @returns {Array<Object>} Anomalie filtrate
   */
  getAnomalies(options = {}) {
    let filtered = [...this.anomalies];
    
    // Filtra per timestamp
    if (options.since) {
      filtered = filtered.filter(a => a.timestamp >= options.since);
    }
    
    if (options.until) {
      filtered = filtered.filter(a => a.timestamp <= options.until);
    }
    
    // Filtra per metrica
    if (options.metrics && options.metrics.length > 0) {
      filtered = filtered.filter(a => options.metrics.includes(a.metric));
    }
    
    // Filtra per severità
    if (options.severities && options.severities.length > 0) {
      filtered = filtered.filter(a => options.severities.includes(a.severity));
    }
    
    return filtered;
  }
  
  /**
   * Ottiene le statistiche di base
   * @param {string} [metric] - Metrica specifica (opzionale)
   * @returns {Object} Statistiche di base
   */
  getBaselineStats(metric) {
    if (metric) {
      return this.baselineStats[metric];
    }
    
    return this.baselineStats;
  }
  
  /**
   * Ottiene i valori correnti
   * @param {string} [metric] - Metrica specifica (opzionale)
   * @returns {Object} Valori correnti
   */
  getCurrentStats(metric) {
    if (metric) {
      return this.currentStats[metric];
    }
    
    return this.currentStats;
  }
  
  /**
   * Ottiene lo storico dei valori
   * @param {string} metric - Metrica
   * @param {Object} [options] - Opzioni di filtro
   * @param {number} [options.since] - Timestamp minimo
   * @param {number} [options.until] - Timestamp massimo
   * @param {number} [options.limit] - Numero massimo di valori
   * @returns {Array<Object>} Storico dei valori
   */
  getHistory(metric, options = {}) {
    if (!(metric in this.history)) {
      return [];
    }
    
    let filtered = [...this.history[metric]];
    
    // Filtra per timestamp
    if (options.since) {
      filtered = filtered.filter(item => item.timestamp >= options.since);
    }
    
    if (options.until) {
      filtered = filtered.filter(item => item.timestamp <= options.until);
    }
    
    // Limita il numero di valori
    if (options.limit) {
      filtered = filtered.slice(-options.limit);
    }
    
    return filtered;
  }
  
  /**
   * Aggiunge una metrica da monitorare
   * @param {string} metric - Nome della metrica
   * @param {Object} [config] - Configurazione della metrica
   * @param {number} [config.weight] - Peso della metrica (default: 1)
   */
  addMetric(metric, config = {}) {
    if (metric in this.metrics) {
      logger.warn(`La metrica ${metric} è già monitorata`);
      return;
    }
    
    this.metrics[metric] = {
      weight: config.weight || 1
    };
    
    this.baselineStats[metric] = {
      mean: 0,
      stdDev: 0,
      min: Infinity,
      max: -Infinity,
      count: 0,
      sum: 0,
      sumSquares: 0,
      lastUpdate: 0
    };
    
    this.currentStats[metric] = 0;
    this.history[metric] = [];
    
    logger.info(`Metrica ${metric} aggiunta al monitoraggio`);
  }
  
  /**
   * Rimuove una metrica dal monitoraggio
   * @param {string} metric - Nome della metrica
   */
  removeMetric(metric) {
    if (!(metric in this.metrics)) {
      logger.warn(`La metrica ${metric} non è monitorata`);
      return;
    }
    
    delete this.metrics[metric];
    delete this.baselineStats[metric];
    delete this.currentStats[metric];
    delete this.history[metric];
    
    // Rimuovi le anomalie relative a questa metrica
    this.anomalies = this.anomalies.filter(a => a.metric !== metric);
    
    logger.info(`Metrica ${metric} rimossa dal monitoraggio`);
  }
  
  /**
   * Imposta la soglia di allerta
   * @param {number} threshold - Soglia in deviazioni standard
   */
  setAlertThreshold(threshold) {
    this.alertThreshold = threshold;
    logger.info(`Soglia di allerta impostata a ${threshold} deviazioni standard`);
  }
  
  /**
   * Imposta il periodo di baseline
   * @param {number} period - Periodo in millisecondi
   */
  setBaselinePeriod(period) {
    this.baselinePeriod = period;
    logger.info(`Periodo di baseline impostato a ${period}ms`);
  }
  
  /**
   * Imposta l'intervallo di aggiornamento
   * @param {number} interval - Intervallo in millisecondi
   */
  setUpdateInterval(interval) {
    this.updateInterval = interval;
    
    // Aggiorna l'intervallo se il rilevatore è avviato
    if (this.updateIntervalId) {
      clearInterval(this.updateIntervalId);
      this.updateIntervalId = setInterval(() => this._updateBaseline(), this.updateInterval);
    }
    
    logger.info(`Intervallo di aggiornamento impostato a ${interval}ms`);
  }
  
  /**
   * Ottiene lo stato del rilevatore
   * @returns {Object} Stato del rilevatore
   */
  getStatus() {
    return {
      isRunning: !!this.updateIntervalId,
      metricsCount: Object.keys(this.metrics).length,
      anomaliesCount: this.anomalies.length,
      lastUpdate: Math.max(...Object.values(this.baselineStats).map(s => s.lastUpdate)),
      alertThreshold: this.alertThreshold,
      baselinePeriod: this.baselinePeriod,
      updateInterval: this.updateInterval
    };
  }
  
  /**
   * Resetta le statistiche di base
   * @param {string} [metric] - Metrica specifica (opzionale)
   */
  resetBaselineStats(metric) {
    if (metric) {
      if (!(metric in this.baselineStats)) {
        logger.warn(`La metrica ${metric} non è monitorata`);
        return;
      }
      
      this.baselineStats[metric] = {
        mean: 0,
        stdDev: 0,
        min: Infinity,
        max: -Infinity,
        count: 0,
        sum: 0,
        sumSquares: 0,
        lastUpdate: 0
      };
      
      logger.info(`Statistiche di base resettate per la metrica ${metric}`);
    } else {
      this._initializeStats();
      logger.info('Tutte le statistiche di base resettate');
    }
  }
  
  /**
   * Cancella le anomalie
   */
  clearAnomalies() {
    this.anomalies = [];
    logger.info('Anomalie cancellate');
  }
}

module.exports = { AnomalyDetector };
