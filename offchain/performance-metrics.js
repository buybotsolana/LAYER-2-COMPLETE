/**
 * Implementazione del Performance Metrics System per il Layer-2 su Solana
 * 
 * Questo modulo implementa un sistema di metriche di performance completo
 * per monitorare e analizzare le prestazioni del sistema.
 */

const { EventEmitter } = require('events');
const { performance, PerformanceObserver } = require('perf_hooks');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Classe MetricValue
 * 
 * Rappresenta il valore di una metrica
 */
class MetricValue {
  /**
   * Costruttore
   * @param {string} name - Nome della metrica
   * @param {string} type - Tipo di metrica (counter, gauge, histogram, summary)
   */
  constructor(name, type) {
    this.name = name;
    this.type = type;
    this.value = 0;
    this.timestamp = Date.now();
    this.labels = {};
    this.samples = [];
    this.maxSamples = 1000;
    this.sum = 0;
    this.min = Infinity;
    this.max = -Infinity;
    this.count = 0;
    this.lastReset = Date.now();
  }

  /**
   * Imposta il valore della metrica
   * @param {number} value - Nuovo valore
   */
  setValue(value) {
    this.value = value;
    this.timestamp = Date.now();
  }

  /**
   * Incrementa il valore della metrica
   * @param {number} increment - Incremento
   * @returns {number} - Nuovo valore
   */
  increment(increment = 1) {
    this.value += increment;
    this.timestamp = Date.now();
    return this.value;
  }

  /**
   * Decrementa il valore della metrica
   * @param {number} decrement - Decremento
   * @returns {number} - Nuovo valore
   */
  decrement(decrement = 1) {
    this.value -= decrement;
    this.timestamp = Date.now();
    return this.value;
  }

  /**
   * Aggiunge un campione alla metrica
   * @param {number} value - Valore del campione
   */
  addSample(value) {
    // Aggiorna le statistiche
    this.sum += value;
    this.min = Math.min(this.min, value);
    this.max = Math.max(this.max, value);
    this.count++;
    this.value = this.count > 0 ? this.sum / this.count : 0;
    this.timestamp = Date.now();

    // Aggiungi il campione
    this.samples.push({
      value,
      timestamp: Date.now()
    });

    // Limita il numero di campioni
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  /**
   * Resetta la metrica
   */
  reset() {
    this.value = 0;
    this.sum = 0;
    this.min = Infinity;
    this.max = -Infinity;
    this.count = 0;
    this.samples = [];
    this.lastReset = Date.now();
  }

  /**
   * Imposta le etichette della metrica
   * @param {Object} labels - Etichette
   */
  setLabels(labels) {
    this.labels = { ...labels };
  }

  /**
   * Ottiene il valore della metrica
   * @returns {Object} - Valore e metadati
   */
  getValue() {
    return {
      name: this.name,
      type: this.type,
      value: this.value,
      timestamp: this.timestamp,
      labels: this.labels,
      sum: this.sum,
      min: this.min === Infinity ? 0 : this.min,
      max: this.max === -Infinity ? 0 : this.max,
      count: this.count,
      lastReset: this.lastReset
    };
  }

  /**
   * Calcola i percentili
   * @param {Array<number>} percentiles - Percentili da calcolare
   * @returns {Object} - Valori dei percentili
   */
  getPercentiles(percentiles = [50, 75, 90, 95, 99]) {
    if (this.samples.length === 0) {
      return percentiles.reduce((acc, p) => {
        acc[`p${p}`] = 0;
        return acc;
      }, {});
    }

    // Ordina i campioni
    const sortedSamples = [...this.samples].sort((a, b) => a.value - b.value);

    // Calcola i percentili
    const result = {};
    for (const p of percentiles) {
      const index = Math.ceil((p / 100) * sortedSamples.length) - 1;
      result[`p${p}`] = sortedSamples[Math.max(0, index)].value;
    }

    return result;
  }

  /**
   * Calcola la frequenza di aggiornamento
   * @returns {number} - Frequenza in aggiornamenti al secondo
   */
  getUpdateRate() {
    if (this.samples.length < 2) {
      return 0;
    }

    const timeRange = this.samples[this.samples.length - 1].timestamp - this.samples[0].timestamp;
    return timeRange > 0 ? (this.samples.length - 1) / (timeRange / 1000) : 0;
  }

  /**
   * Calcola la deviazione standard
   * @returns {number} - Deviazione standard
   */
  getStandardDeviation() {
    if (this.count <= 1) {
      return 0;
    }

    const mean = this.sum / this.count;
    const squaredDiffs = this.samples.reduce((sum, sample) => {
      const diff = sample.value - mean;
      return sum + diff * diff;
    }, 0);

    return Math.sqrt(squaredDiffs / (this.count - 1));
  }

  /**
   * Esporta la metrica in formato Prometheus
   * @returns {string} - Metrica in formato Prometheus
   */
  toPrometheusFormat() {
    const labelStr = Object.entries(this.labels)
      .map(([key, value]) => `${key}="${value}"`)
      .join(',');

    const labelsFormatted = labelStr ? `{${labelStr}}` : '';

    switch (this.type) {
      case 'counter':
        return `# TYPE ${this.name} counter\n${this.name}${labelsFormatted} ${this.value}`;

      case 'gauge':
        return `# TYPE ${this.name} gauge\n${this.name}${labelsFormatted} ${this.value}`;

      case 'histogram':
        const percentiles = this.getPercentiles();
        let result = `# TYPE ${this.name} histogram\n`;
        result += `${this.name}_sum${labelsFormatted} ${this.sum}\n`;
        result += `${this.name}_count${labelsFormatted} ${this.count}\n`;
        result += `${this.name}_min${labelsFormatted} ${this.min === Infinity ? 0 : this.min}\n`;
        result += `${this.name}_max${labelsFormatted} ${this.max === -Infinity ? 0 : this.max}\n`;

        for (const [p, value] of Object.entries(percentiles)) {
          result += `${this.name}_${p}${labelsFormatted} ${value}\n`;
        }

        return result;

      case 'summary':
        const summaryPercentiles = this.getPercentiles();
        let summaryResult = `# TYPE ${this.name} summary\n`;
        summaryResult += `${this.name}_sum${labelsFormatted} ${this.sum}\n`;
        summaryResult += `${this.name}_count${labelsFormatted} ${this.count}\n`;

        for (const [p, value] of Object.entries(summaryPercentiles)) {
          const percentile = parseInt(p.substring(1)) / 100;
          summaryResult += `${this.name}{${labelStr ? `${labelStr},` : ''}quantile="${percentile}"} ${value}\n`;
        }

        return summaryResult;

      default:
        return `# TYPE ${this.name} untyped\n${this.name}${labelsFormatted} ${this.value}`;
    }
  }
}

/**
 * Classe PerformanceMetrics
 * 
 * Implementa un sistema di metriche di performance
 */
class PerformanceMetrics extends EventEmitter {
  /**
   * Costruttore
   * @param {string} namespace - Namespace delle metriche
   * @param {Object} options - Opzioni
   */
  constructor(namespace, options = {}) {
    super();
    
    this.namespace = namespace;
    this.options = {
      enableMetrics: options.enableMetrics !== false,
      metricsInterval: options.metricsInterval || 10000, // 10 secondi
      exportPath: options.exportPath || null,
      exportInterval: options.exportInterval || 60000, // 1 minuto
      maxSamples: options.maxSamples || 1000,
      enablePerformanceObserver: options.enablePerformanceObserver !== false,
      defaultLabels: options.defaultLabels || {},
      ...options
    };
    
    // Metriche
    this.metrics = new Map();
    
    // Timer di esportazione
    this.exportTimer = null;
    
    // Performance observer
    this.observer = null;
    
    // Timestamp di avvio
    this.startTime = Date.now();
    
    // Inizializza le metriche
    this._initialize();
  }
  
  /**
   * Inizializza le metriche
   * @private
   */
  _initialize() {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return;
    }
    
    // Crea le metriche di base
    this._createMetric('uptime', 'gauge');
    this._createMetric('cpu_usage', 'gauge');
    this._createMetric('memory_usage', 'gauge');
    this._createMetric('memory_total', 'gauge');
    this._createMetric('memory_free', 'gauge');
    
    // Avvia il timer di aggiornamento
    this._startUpdateTimer();
    
    // Avvia il timer di esportazione
    if (this.options.exportPath) {
      this._startExportTimer();
    }
    
    // Inizializza il performance observer
    if (this.options.enablePerformanceObserver) {
      this._initializePerformanceObserver();
    }
    
    console.log(`PerformanceMetrics inizializzato con namespace ${this.namespace}`);
  }
  
  /**
   * Avvia il timer di aggiornamento
   * @private
   */
  _startUpdateTimer() {
    // Aggiorna le metriche di base
    this._updateBaseMetrics();
    
    // Avvia il timer
    setInterval(() => {
      this._updateBaseMetrics();
    }, this.options.metricsInterval);
  }
  
  /**
   * Avvia il timer di esportazione
   * @private
   */
  _startExportTimer() {
    // Verifica che il percorso di esportazione sia valido
    if (!this.options.exportPath) {
      return;
    }
    
    // Avvia il timer
    this.exportTimer = setInterval(() => {
      this._exportMetrics();
    }, this.options.exportInterval);
    
    // Evita che il timer impedisca al processo di terminare
    this.exportTimer.unref();
  }
  
  /**
   * Inizializza il performance observer
   * @private
   */
  _initializePerformanceObserver() {
    try {
      // Crea l'observer
      this.observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        
        for (const entry of entries) {
          // Registra la metrica
          this.recordLatency(entry.name, entry.duration);
        }
      });
      
      // Inizia a osservare
      this.observer.observe({ entryTypes: ['measure'] });
    } catch (error) {
      console.error('Errore durante l\'inizializzazione del performance observer:', error);
    }
  }
  
  /**
   * Aggiorna le metriche di base
   * @private
   */
  _updateBaseMetrics() {
    try {
      // Aggiorna l'uptime
      const uptime = (Date.now() - this.startTime) / 1000;
      this.setGauge('uptime', uptime);
      
      // Aggiorna l'utilizzo della CPU
      const cpuUsage = process.cpuUsage();
      const cpuUsagePercent = (cpuUsage.user + cpuUsage.system) / 1000000 / os.cpus().length * 100;
      this.setGauge('cpu_usage', cpuUsagePercent);
      
      // Aggiorna l'utilizzo della memoria
      const memoryUsage = process.memoryUsage();
      this.setGauge('memory_usage', memoryUsage.rss);
      
      // Aggiorna la memoria totale e libera
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      this.setGauge('memory_total', totalMemory);
      this.setGauge('memory_free', freeMemory);
    } catch (error) {
      console.error('Errore durante l\'aggiornamento delle metriche di base:', error);
    }
  }
  
  /**
   * Crea una metrica
   * @param {string} name - Nome della metrica
   * @param {string} type - Tipo di metrica (counter, gauge, histogram, summary)
   * @param {Object} labels - Etichette
   * @returns {MetricValue} - Metrica
   * @private
   */
  _createMetric(name, type, labels = {}) {
    // Formatta il nome
    const formattedName = this._formatMetricName(name);
    
    // Verifica se la metrica esiste già
    if (this.metrics.has(formattedName)) {
      return this.metrics.get(formattedName);
    }
    
    // Crea la metrica
    const metric = new MetricValue(formattedName, type);
    
    // Imposta le etichette
    metric.setLabels({
      ...this.options.defaultLabels,
      ...labels
    });
    
    // Memorizza la metrica
    this.metrics.set(formattedName, metric);
    
    return metric;
  }
  
  /**
   * Formatta il nome di una metrica
   * @param {string} name - Nome della metrica
   * @returns {string} - Nome formattato
   * @private
   */
  _formatMetricName(name) {
    // Sostituisci i caratteri non validi
    const sanitized = name.replace(/[^a-zA-Z0-9_]/g, '_');
    
    // Aggiungi il namespace
    return this.namespace ? `${this.namespace}_${sanitized}` : sanitized;
  }
  
  /**
   * Esporta le metriche
   * @private
   */
  _exportMetrics() {
    try {
      // Verifica che il percorso di esportazione sia valido
      if (!this.options.exportPath) {
        return;
      }
      
      // Crea la directory se non esiste
      const dir = path.dirname(this.options.exportPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Esporta le metriche
      const metrics = this.getMetrics();
      
      // Scrivi le metriche su file
      fs.writeFileSync(this.options.exportPath, JSON.stringify(metrics, null, 2));
      
      // Emetti evento
      this.emit('metrics_exported', {
        path: this.options.exportPath,
        metrics
      });
    } catch (error) {
      console.error('Errore durante l\'esportazione delle metriche:', error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'exportMetrics',
        error
      });
    }
  }
  
  /**
   * Incrementa un contatore
   * @param {string} name - Nome del contatore
   * @param {number} increment - Incremento
   * @param {Object} labels - Etichette
   * @returns {number} - Nuovo valore
   */
  incrementCounter(name, increment = 1, labels = {}) {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return 0;
    }
    
    try {
      // Ottieni o crea il contatore
      const counter = this._createMetric(name, 'counter', labels);
      
      // Incrementa il contatore
      const value = counter.increment(increment);
      
      // Emetti evento
      this.emit('counter_incremented', {
        name: counter.name,
        value,
        increment,
        labels: counter.labels
      });
      
      return value;
    } catch (error) {
      console.error(`Errore durante l'incremento del contatore ${name}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'incrementCounter',
        name,
        error
      });
      
      return 0;
    }
  }
  
  /**
   * Decrementa un contatore
   * @param {string} name - Nome del contatore
   * @param {number} decrement - Decremento
   * @param {Object} labels - Etichette
   * @returns {number} - Nuovo valore
   */
  decrementCounter(name, decrement = 1, labels = {}) {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return 0;
    }
    
    try {
      // Ottieni o crea il contatore
      const counter = this._createMetric(name, 'counter', labels);
      
      // Decrementa il contatore
      const value = counter.decrement(decrement);
      
      // Emetti evento
      this.emit('counter_decremented', {
        name: counter.name,
        value,
        decrement,
        labels: counter.labels
      });
      
      return value;
    } catch (error) {
      console.error(`Errore durante il decremento del contatore ${name}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'decrementCounter',
        name,
        error
      });
      
      return 0;
    }
  }
  
  /**
   * Imposta un gauge
   * @param {string} name - Nome del gauge
   * @param {number} value - Valore
   * @param {Object} labels - Etichette
   * @returns {number} - Valore impostato
   */
  setGauge(name, value, labels = {}) {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return 0;
    }
    
    try {
      // Ottieni o crea il gauge
      const gauge = this._createMetric(name, 'gauge', labels);
      
      // Imposta il valore
      gauge.setValue(value);
      
      // Emetti evento
      this.emit('gauge_set', {
        name: gauge.name,
        value,
        labels: gauge.labels
      });
      
      return value;
    } catch (error) {
      console.error(`Errore durante l'impostazione del gauge ${name}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'setGauge',
        name,
        error
      });
      
      return 0;
    }
  }
  
  /**
   * Incrementa un gauge
   * @param {string} name - Nome del gauge
   * @param {number} increment - Incremento
   * @param {Object} labels - Etichette
   * @returns {number} - Nuovo valore
   */
  incrementGauge(name, increment = 1, labels = {}) {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return 0;
    }
    
    try {
      // Ottieni o crea il gauge
      const gauge = this._createMetric(name, 'gauge', labels);
      
      // Incrementa il gauge
      const value = gauge.increment(increment);
      
      // Emetti evento
      this.emit('gauge_incremented', {
        name: gauge.name,
        value,
        increment,
        labels: gauge.labels
      });
      
      return value;
    } catch (error) {
      console.error(`Errore durante l'incremento del gauge ${name}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'incrementGauge',
        name,
        error
      });
      
      return 0;
    }
  }
  
  /**
   * Decrementa un gauge
   * @param {string} name - Nome del gauge
   * @param {number} decrement - Decremento
   * @param {Object} labels - Etichette
   * @returns {number} - Nuovo valore
   */
  decrementGauge(name, decrement = 1, labels = {}) {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return 0;
    }
    
    try {
      // Ottieni o crea il gauge
      const gauge = this._createMetric(name, 'gauge', labels);
      
      // Decrementa il gauge
      const value = gauge.decrement(decrement);
      
      // Emetti evento
      this.emit('gauge_decremented', {
        name: gauge.name,
        value,
        decrement,
        labels: gauge.labels
      });
      
      return value;
    } catch (error) {
      console.error(`Errore durante il decremento del gauge ${name}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'decrementGauge',
        name,
        error
      });
      
      return 0;
    }
  }
  
  /**
   * Registra un valore in un istogramma
   * @param {string} name - Nome dell'istogramma
   * @param {number} value - Valore
   * @param {Object} labels - Etichette
   */
  recordHistogram(name, value, labels = {}) {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return;
    }
    
    try {
      // Ottieni o crea l'istogramma
      const histogram = this._createMetric(name, 'histogram', labels);
      
      // Aggiungi il campione
      histogram.addSample(value);
      
      // Emetti evento
      this.emit('histogram_recorded', {
        name: histogram.name,
        value,
        labels: histogram.labels
      });
    } catch (error) {
      console.error(`Errore durante la registrazione dell'istogramma ${name}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'recordHistogram',
        name,
        error
      });
    }
  }
  
  /**
   * Registra un valore in un summary
   * @param {string} name - Nome del summary
   * @param {number} value - Valore
   * @param {Object} labels - Etichette
   */
  recordSummary(name, value, labels = {}) {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return;
    }
    
    try {
      // Ottieni o crea il summary
      const summary = this._createMetric(name, 'summary', labels);
      
      // Aggiungi il campione
      summary.addSample(value);
      
      // Emetti evento
      this.emit('summary_recorded', {
        name: summary.name,
        value,
        labels: summary.labels
      });
    } catch (error) {
      console.error(`Errore durante la registrazione del summary ${name}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'recordSummary',
        name,
        error
      });
    }
  }
  
  /**
   * Registra la latenza di un'operazione
   * @param {string} name - Nome dell'operazione
   * @param {number} latency - Latenza in millisecondi
   * @param {Object} labels - Etichette
   */
  recordLatency(name, latency, labels = {}) {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return;
    }
    
    try {
      // Registra la latenza come istogramma
      this.recordHistogram(`${name}_latency`, latency, labels);
      
      // Emetti evento
      this.emit('latency_recorded', {
        name,
        latency,
        labels
      });
    } catch (error) {
      console.error(`Errore durante la registrazione della latenza ${name}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'recordLatency',
        name,
        error
      });
    }
  }
  
  /**
   * Registra il throughput di un'operazione
   * @param {string} name - Nome dell'operazione
   * @param {number} throughput - Throughput in operazioni al secondo
   * @param {Object} labels - Etichette
   */
  recordThroughput(name, throughput, labels = {}) {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return;
    }
    
    try {
      // Registra il throughput come gauge
      this.setGauge(`${name}_throughput`, throughput, labels);
      
      // Emetti evento
      this.emit('throughput_recorded', {
        name,
        throughput,
        labels
      });
    } catch (error) {
      console.error(`Errore durante la registrazione del throughput ${name}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'recordThroughput',
        name,
        error
      });
    }
  }
  
  /**
   * Misura il tempo di esecuzione di una funzione
   * @param {string} name - Nome dell'operazione
   * @param {Function} fn - Funzione da misurare
   * @param {Object} labels - Etichette
   * @returns {*} - Risultato della funzione
   */
  async measureAsync(name, fn, labels = {}) {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return fn();
    }
    
    try {
      // Misura il tempo di esecuzione
      const startTime = performance.now();
      
      try {
        // Esegui la funzione
        const result = await fn();
        
        // Calcola la latenza
        const endTime = performance.now();
        const latency = endTime - startTime;
        
        // Registra la latenza
        this.recordLatency(name, latency, labels);
        
        return result;
      } catch (error) {
        // Calcola la latenza
        const endTime = performance.now();
        const latency = endTime - startTime;
        
        // Registra la latenza
        this.recordLatency(`${name}_error`, latency, labels);
        
        // Rilancia l'errore
        throw error;
      }
    } catch (error) {
      console.error(`Errore durante la misurazione dell'operazione ${name}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'measureAsync',
        name,
        error
      });
      
      throw error;
    }
  }
  
  /**
   * Misura il tempo di esecuzione di una funzione sincrona
   * @param {string} name - Nome dell'operazione
   * @param {Function} fn - Funzione da misurare
   * @param {Object} labels - Etichette
   * @returns {*} - Risultato della funzione
   */
  measure(name, fn, labels = {}) {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return fn();
    }
    
    try {
      // Misura il tempo di esecuzione
      const startTime = performance.now();
      
      try {
        // Esegui la funzione
        const result = fn();
        
        // Calcola la latenza
        const endTime = performance.now();
        const latency = endTime - startTime;
        
        // Registra la latenza
        this.recordLatency(name, latency, labels);
        
        return result;
      } catch (error) {
        // Calcola la latenza
        const endTime = performance.now();
        const latency = endTime - startTime;
        
        // Registra la latenza
        this.recordLatency(`${name}_error`, latency, labels);
        
        // Rilancia l'errore
        throw error;
      }
    } catch (error) {
      console.error(`Errore durante la misurazione dell'operazione ${name}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'measure',
        name,
        error
      });
      
      throw error;
    }
  }
  
  /**
   * Inizia una misurazione
   * @param {string} name - Nome dell'operazione
   * @returns {Function} - Funzione per terminare la misurazione
   */
  startMeasurement(name) {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return () => {};
    }
    
    try {
      // Registra il timestamp di inizio
      const startTime = performance.now();
      
      // Crea un ID univoco per la misurazione
      const id = crypto.randomBytes(8).toString('hex');
      
      // Emetti evento
      this.emit('measurement_started', {
        name,
        id,
        startTime
      });
      
      // Restituisci la funzione per terminare la misurazione
      return (labels = {}) => {
        try {
          // Calcola la latenza
          const endTime = performance.now();
          const latency = endTime - startTime;
          
          // Registra la latenza
          this.recordLatency(name, latency, labels);
          
          // Emetti evento
          this.emit('measurement_ended', {
            name,
            id,
            startTime,
            endTime,
            latency,
            labels
          });
          
          return latency;
        } catch (error) {
          console.error(`Errore durante la terminazione della misurazione ${name}:`, error);
          
          // Emetti evento di errore
          this.emit('error', {
            operation: 'endMeasurement',
            name,
            id,
            error
          });
          
          return 0;
        }
      };
    } catch (error) {
      console.error(`Errore durante l'avvio della misurazione ${name}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'startMeasurement',
        name,
        error
      });
      
      return () => {};
    }
  }
  
  /**
   * Resetta una metrica
   * @param {string} name - Nome della metrica
   * @returns {boolean} - True se il reset è riuscito
   */
  resetMetric(name) {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return false;
    }
    
    try {
      // Formatta il nome
      const formattedName = this._formatMetricName(name);
      
      // Verifica se la metrica esiste
      if (!this.metrics.has(formattedName)) {
        return false;
      }
      
      // Resetta la metrica
      this.metrics.get(formattedName).reset();
      
      // Emetti evento
      this.emit('metric_reset', {
        name: formattedName
      });
      
      return true;
    } catch (error) {
      console.error(`Errore durante il reset della metrica ${name}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'resetMetric',
        name,
        error
      });
      
      return false;
    }
  }
  
  /**
   * Resetta tutte le metriche
   * @returns {number} - Numero di metriche resettate
   */
  resetAllMetrics() {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return 0;
    }
    
    try {
      let count = 0;
      
      // Resetta tutte le metriche
      for (const metric of this.metrics.values()) {
        metric.reset();
        count++;
      }
      
      // Emetti evento
      this.emit('all_metrics_reset', {
        count
      });
      
      return count;
    } catch (error) {
      console.error('Errore durante il reset di tutte le metriche:', error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'resetAllMetrics',
        error
      });
      
      return 0;
    }
  }
  
  /**
   * Ottiene il valore di una metrica
   * @param {string} name - Nome della metrica
   * @returns {Object} - Valore della metrica
   */
  getMetricValue(name) {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return null;
    }
    
    try {
      // Formatta il nome
      const formattedName = this._formatMetricName(name);
      
      // Verifica se la metrica esiste
      if (!this.metrics.has(formattedName)) {
        return null;
      }
      
      // Ottieni il valore
      return this.metrics.get(formattedName).getValue();
    } catch (error) {
      console.error(`Errore durante l'ottenimento del valore della metrica ${name}:`, error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'getMetricValue',
        name,
        error
      });
      
      return null;
    }
  }
  
  /**
   * Ottiene tutte le metriche
   * @returns {Object} - Metriche
   */
  getMetrics() {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return {};
    }
    
    try {
      const metrics = {};
      
      // Ottieni tutte le metriche
      for (const [name, metric] of this.metrics.entries()) {
        metrics[name] = metric.getValue();
      }
      
      return metrics;
    } catch (error) {
      console.error('Errore durante l\'ottenimento di tutte le metriche:', error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'getMetrics',
        error
      });
      
      return {};
    }
  }
  
  /**
   * Esporta le metriche in formato Prometheus
   * @returns {string} - Metriche in formato Prometheus
   */
  getPrometheusMetrics() {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return '';
    }
    
    try {
      let result = '';
      
      // Ottieni tutte le metriche
      for (const metric of this.metrics.values()) {
        result += metric.toPrometheusFormat() + '\n';
      }
      
      return result;
    } catch (error) {
      console.error('Errore durante l\'esportazione delle metriche in formato Prometheus:', error);
      
      // Emetti evento di errore
      this.emit('error', {
        operation: 'getPrometheusMetrics',
        error
      });
      
      return '';
    }
  }
  
  /**
   * Chiude il sistema di metriche
   */
  close() {
    // Verifica che le metriche siano abilitate
    if (!this.options.enableMetrics) {
      return;
    }
    
    try {
      // Ferma il timer di esportazione
      if (this.exportTimer) {
        clearInterval(this.exportTimer);
        this.exportTimer = null;
      }
      
      // Disconnetti il performance observer
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      
      // Esporta le metriche
      if (this.options.exportPath) {
        this._exportMetrics();
      }
      
      // Emetti evento
      this.emit('closed');
      
      // Rimuovi tutti i listener
      this.removeAllListeners();
    } catch (error) {
      console.error('Errore durante la chiusura del sistema di metriche:', error);
    }
  }
}

/**
 * Classe PerformanceProfiler
 * 
 * Implementa un profiler per le prestazioni
 */
class PerformanceProfiler {
  /**
   * Costruttore
   * @param {Object} options - Opzioni
   */
  constructor(options = {}) {
    this.options = {
      enabled: options.enabled !== false,
      sampleRate: options.sampleRate || 0.1, // 10%
      maxStackDepth: options.maxStackDepth || 50,
      maxSamples: options.maxSamples || 1000,
      ...options
    };
    
    this.samples = [];
    this.activeProfiles = new Map();
    this.isRunning = false;
    this.startTime = null;
    this.stopTime = null;
  }
  
  /**
   * Avvia il profiler
   */
  start() {
    // Verifica che il profiler sia abilitato
    if (!this.options.enabled) {
      return;
    }
    
    // Verifica che il profiler non sia già in esecuzione
    if (this.isRunning) {
      return;
    }
    
    // Imposta il flag di esecuzione
    this.isRunning = true;
    this.startTime = Date.now();
    
    console.log('PerformanceProfiler avviato');
  }
  
  /**
   * Ferma il profiler
   */
  stop() {
    // Verifica che il profiler sia abilitato
    if (!this.options.enabled) {
      return;
    }
    
    // Verifica che il profiler sia in esecuzione
    if (!this.isRunning) {
      return;
    }
    
    // Imposta il flag di esecuzione
    this.isRunning = false;
    this.stopTime = Date.now();
    
    console.log('PerformanceProfiler fermato');
  }
  
  /**
   * Inizia un profilo
   * @param {string} name - Nome del profilo
   * @returns {Function} - Funzione per terminare il profilo
   */
  profile(name) {
    // Verifica che il profiler sia abilitato
    if (!this.options.enabled || !this.isRunning) {
      return () => {};
    }
    
    // Verifica se il campionamento è attivo
    if (Math.random() > this.options.sampleRate) {
      return () => {};
    }
    
    try {
      // Registra il timestamp di inizio
      const startTime = performance.now();
      
      // Crea un ID univoco per il profilo
      const id = crypto.randomBytes(8).toString('hex');
      
      // Memorizza il profilo
      this.activeProfiles.set(id, {
        name,
        startTime,
        stack: new Error().stack
      });
      
      // Restituisci la funzione per terminare il profilo
      return () => {
        try {
          // Verifica se il profilo esiste
          if (!this.activeProfiles.has(id)) {
            return;
          }
          
          // Ottieni il profilo
          const profile = this.activeProfiles.get(id);
          
          // Calcola la durata
          const endTime = performance.now();
          const duration = endTime - profile.startTime;
          
          // Aggiungi il campione
          this.samples.push({
            name: profile.name,
            startTime: profile.startTime,
            endTime,
            duration,
            stack: profile.stack
          });
          
          // Limita il numero di campioni
          if (this.samples.length > this.options.maxSamples) {
            this.samples.shift();
          }
          
          // Rimuovi il profilo
          this.activeProfiles.delete(id);
        } catch (error) {
          console.error(`Errore durante la terminazione del profilo ${name}:`, error);
        }
      };
    } catch (error) {
      console.error(`Errore durante l'avvio del profilo ${name}:`, error);
      return () => {};
    }
  }
  
  /**
   * Profila una funzione asincrona
   * @param {string} name - Nome del profilo
   * @param {Function} fn - Funzione da profilare
   * @returns {Promise<*>} - Risultato della funzione
   */
  async profileAsync(name, fn) {
    // Verifica che il profiler sia abilitato
    if (!this.options.enabled || !this.isRunning) {
      return fn();
    }
    
    // Verifica se il campionamento è attivo
    if (Math.random() > this.options.sampleRate) {
      return fn();
    }
    
    try {
      // Inizia il profilo
      const endProfile = this.profile(name);
      
      try {
        // Esegui la funzione
        const result = await fn();
        
        // Termina il profilo
        endProfile();
        
        return result;
      } catch (error) {
        // Termina il profilo
        endProfile();
        
        // Rilancia l'errore
        throw error;
      }
    } catch (error) {
      console.error(`Errore durante la profilazione della funzione ${name}:`, error);
      throw error;
    }
  }
  
  /**
   * Profila una funzione sincrona
   * @param {string} name - Nome del profilo
   * @param {Function} fn - Funzione da profilare
   * @returns {*} - Risultato della funzione
   */
  profileSync(name, fn) {
    // Verifica che il profiler sia abilitato
    if (!this.options.enabled || !this.isRunning) {
      return fn();
    }
    
    // Verifica se il campionamento è attivo
    if (Math.random() > this.options.sampleRate) {
      return fn();
    }
    
    try {
      // Inizia il profilo
      const endProfile = this.profile(name);
      
      try {
        // Esegui la funzione
        const result = fn();
        
        // Termina il profilo
        endProfile();
        
        return result;
      } catch (error) {
        // Termina il profilo
        endProfile();
        
        // Rilancia l'errore
        throw error;
      }
    } catch (error) {
      console.error(`Errore durante la profilazione della funzione ${name}:`, error);
      throw error;
    }
  }
  
  /**
   * Ottiene i campioni
   * @returns {Array<Object>} - Campioni
   */
  getSamples() {
    return [...this.samples];
  }
  
  /**
   * Ottiene le statistiche
   * @returns {Object} - Statistiche
   */
  getStats() {
    // Verifica che il profiler sia abilitato
    if (!this.options.enabled) {
      return {};
    }
    
    try {
      // Calcola le statistiche
      const stats = {
        isRunning: this.isRunning,
        startTime: this.startTime,
        stopTime: this.stopTime,
        uptime: this.startTime ? (this.stopTime || Date.now()) - this.startTime : 0,
        sampleCount: this.samples.length,
        activeProfiles: this.activeProfiles.size
      };
      
      // Calcola le statistiche per nome
      const profileStats = {};
      
      for (const sample of this.samples) {
        if (!profileStats[sample.name]) {
          profileStats[sample.name] = {
            count: 0,
            totalDuration: 0,
            minDuration: Infinity,
            maxDuration: -Infinity,
            avgDuration: 0
          };
        }
        
        const stat = profileStats[sample.name];
        
        stat.count++;
        stat.totalDuration += sample.duration;
        stat.minDuration = Math.min(stat.minDuration, sample.duration);
        stat.maxDuration = Math.max(stat.maxDuration, sample.duration);
        stat.avgDuration = stat.totalDuration / stat.count;
      }
      
      // Aggiungi le statistiche per nome
      stats.profiles = profileStats;
      
      return stats;
    } catch (error) {
      console.error('Errore durante l\'ottenimento delle statistiche:', error);
      return {};
    }
  }
  
  /**
   * Resetta il profiler
   */
  reset() {
    // Verifica che il profiler sia abilitato
    if (!this.options.enabled) {
      return;
    }
    
    try {
      // Resetta i campioni
      this.samples = [];
      
      // Resetta i profili attivi
      this.activeProfiles.clear();
      
      console.log('PerformanceProfiler resettato');
    } catch (error) {
      console.error('Errore durante il reset del profiler:', error);
    }
  }
  
  /**
   * Esporta i campioni
   * @param {string} path - Percorso del file
   * @returns {boolean} - True se l'esportazione è riuscita
   */
  exportSamples(path) {
    // Verifica che il profiler sia abilitato
    if (!this.options.enabled) {
      return false;
    }
    
    try {
      // Crea la directory se non esiste
      const dir = path.dirname(path);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Esporta i campioni
      fs.writeFileSync(path, JSON.stringify(this.samples, null, 2));
      
      console.log(`Campioni esportati in ${path}`);
      
      return true;
    } catch (error) {
      console.error(`Errore durante l'esportazione dei campioni in ${path}:`, error);
      return false;
    }
  }
}

/**
 * Classe PerformanceAnalyzer
 * 
 * Implementa un analizzatore di prestazioni
 */
class PerformanceAnalyzer {
  /**
   * Costruttore
   * @param {PerformanceMetrics} metrics - Sistema di metriche
   * @param {Object} options - Opzioni
   */
  constructor(metrics, options = {}) {
    this.metrics = metrics;
    this.options = {
      enabled: options.enabled !== false,
      anomalyThreshold: options.anomalyThreshold || 3.0, // 3 deviazioni standard
      historySize: options.historySize || 100,
      ...options
    };
    
    this.history = new Map();
    this.anomalies = [];
    this.maxAnomalies = options.maxAnomalies || 100;
  }
  
  /**
   * Analizza le metriche
   * @returns {Array<Object>} - Anomalie rilevate
   */
  analyze() {
    // Verifica che l'analizzatore sia abilitato
    if (!this.options.enabled) {
      return [];
    }
    
    try {
      // Ottieni le metriche
      const metrics = this.metrics.getMetrics();
      
      // Analizza le metriche
      const newAnomalies = [];
      
      for (const [name, metric] of Object.entries(metrics)) {
        // Verifica se la metrica è un istogramma o un summary
        if (metric.type !== 'histogram' && metric.type !== 'summary') {
          continue;
        }
        
        // Verifica se la metrica ha abbastanza campioni
        if (metric.count < 10) {
          continue;
        }
        
        // Ottieni la cronologia della metrica
        if (!this.history.has(name)) {
          this.history.set(name, []);
        }
        
        const history = this.history.get(name);
        
        // Aggiungi il valore corrente alla cronologia
        history.push(metric.value);
        
        // Limita la dimensione della cronologia
        if (history.length > this.options.historySize) {
          history.shift();
        }
        
        // Verifica se la cronologia ha abbastanza campioni
        if (history.length < 10) {
          continue;
        }
        
        // Calcola la media e la deviazione standard
        const mean = history.reduce((sum, value) => sum + value, 0) / history.length;
        const variance = history.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / history.length;
        const stdDev = Math.sqrt(variance);
        
        // Verifica se il valore corrente è un'anomalia
        const zScore = Math.abs(metric.value - mean) / stdDev;
        
        if (zScore > this.options.anomalyThreshold) {
          // Crea l'anomalia
          const anomaly = {
            name,
            value: metric.value,
            mean,
            stdDev,
            zScore,
            timestamp: Date.now()
          };
          
          // Aggiungi l'anomalia
          newAnomalies.push(anomaly);
          this.anomalies.push(anomaly);
          
          // Limita il numero di anomalie
          if (this.anomalies.length > this.maxAnomalies) {
            this.anomalies.shift();
          }
        }
      }
      
      return newAnomalies;
    } catch (error) {
      console.error('Errore durante l\'analisi delle metriche:', error);
      return [];
    }
  }
  
  /**
   * Ottiene le anomalie
   * @returns {Array<Object>} - Anomalie
   */
  getAnomalies() {
    return [...this.anomalies];
  }
  
  /**
   * Resetta l'analizzatore
   */
  reset() {
    // Verifica che l'analizzatore sia abilitato
    if (!this.options.enabled) {
      return;
    }
    
    try {
      // Resetta la cronologia
      this.history.clear();
      
      // Resetta le anomalie
      this.anomalies = [];
      
      console.log('PerformanceAnalyzer resettato');
    } catch (error) {
      console.error('Errore durante il reset dell\'analizzatore:', error);
    }
  }
}

module.exports = {
  PerformanceMetrics,
  MetricValue,
  PerformanceProfiler,
  PerformanceAnalyzer
};
