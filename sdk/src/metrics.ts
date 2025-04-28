/**
 * @fileoverview Modulo per la gestione delle metriche di performance nel Layer 2 di Solana
 */

import { Layer2Client } from './client';
import { Layer2Error, ErrorCode } from './types/errors';
import { isBrowser, isNode } from './utils/platform';

/**
 * Tipo di metrica
 */
export enum MetricType {
  LATENCY = 'latency',
  THROUGHPUT = 'throughput',
  SUCCESS_RATE = 'success-rate',
  GAS_USAGE = 'gas-usage',
  BATCH_SIZE = 'batch-size',
  FINALIZATION_TIME = 'finalization-time',
  BRIDGE_TIME = 'bridge-time'
}

/**
 * Intervallo di tempo per le metriche
 */
export enum MetricTimeframe {
  LAST_MINUTE = '1m',
  LAST_FIVE_MINUTES = '5m',
  LAST_HOUR = '1h',
  LAST_DAY = '1d',
  LAST_WEEK = '1w'
}

/**
 * Configurazione per il logging delle metriche
 */
export interface MetricsConfig {
  /** Abilitare il logging delle metriche */
  enabled: boolean;
  /** Intervallo di campionamento in millisecondi */
  samplingInterval?: number;
  /** Livello di dettaglio del logging */
  detailLevel?: 'basic' | 'detailed' | 'debug';
  /** Callback per eventi di metrica */
  onMetric?: (metric: MetricEvent) => void;
  /** Abilitare l'invio delle metriche al server */
  sendToServer?: boolean;
}

/**
 * Evento di metrica
 */
export interface MetricEvent {
  /** Tipo di metrica */
  type: MetricType;
  /** Valore della metrica */
  value: number;
  /** Timestamp dell'evento */
  timestamp: number;
  /** Contesto dell'evento */
  context?: {
    /** ID della transazione associata */
    transactionId?: string;
    /** ID del batch associato */
    batchId?: string;
    /** Operazione associata */
    operation?: string;
    /** Dati aggiuntivi */
    [key: string]: any;
  };
}

/**
 * Risultato dell'analisi delle metriche
 */
export interface MetricsAnalysis {
  /** Tipo di metrica */
  type: MetricType;
  /** Intervallo di tempo analizzato */
  timeframe: MetricTimeframe;
  /** Valore medio */
  average: number;
  /** Valore minimo */
  min: number;
  /** Valore massimo */
  max: number;
  /** Deviazione standard */
  stdDev: number;
  /** Percentile 95 */
  p95: number;
  /** Percentile 99 */
  p99: number;
  /** Timestamp dell'analisi */
  timestamp: number;
}

/**
 * Gestore delle metriche di performance
 */
export class MetricsManager {
  private client: Layer2Client;
  private config: MetricsConfig;
  private metrics: MetricEvent[] = [];
  private samplingInterval: NodeJS.Timeout | null = null;

  /**
   * Crea una nuova istanza del MetricsManager
   * @param client Client Layer 2
   * @param config Configurazione per le metriche
   */
  constructor(client: Layer2Client, config: MetricsConfig = { enabled: true }) {
    this.client = client;
    
    // Configurazione di default
    this.config = {
      enabled: true,
      samplingInterval: 5000,
      detailLevel: 'basic',
      sendToServer: true,
      ...config
    };

    // Avvia il campionamento se abilitato
    if (this.config.enabled) {
      this.startSampling();
    }
  }

  /**
   * Registra un evento di metrica
   * @param type Tipo di metrica
   * @param value Valore della metrica
   * @param context Contesto opzionale dell'evento
   */
  public recordMetric(type: MetricType, value: number, context?: MetricEvent['context']): void {
    if (!this.config.enabled) return;

    const metricEvent: MetricEvent = {
      type,
      value,
      timestamp: Date.now(),
      context
    };

    // Aggiungi la metrica alla lista
    this.metrics.push(metricEvent);

    // Notifica il callback se configurato
    if (this.config.onMetric) {
      this.config.onMetric(metricEvent);
    }

    // Invia al server se configurato
    if (this.config.sendToServer) {
      this.sendMetricToServer(metricEvent).catch(error => {
        console.error('Errore nell\'invio della metrica al server:', error);
      });
    }
  }

  /**
   * Avvia il campionamento periodico delle metriche
   */
  private startSampling(): void {
    // Ferma il campionamento esistente se presente
    if (this.samplingInterval) {
      this.stopSampling();
    }

    // Funzione di campionamento
    const sampleMetrics = async () => {
      try {
        // Campiona le metriche di sistema
        await this.sampleSystemMetrics();
      } catch (error) {
        console.error('Errore nel campionamento delle metriche:', error);
      }
    };

    // Esegui subito il primo campionamento
    sampleMetrics();

    // Imposta l'intervallo di campionamento
    if (isNode()) {
      // In Node.js possiamo usare setInterval
      this.samplingInterval = setInterval(sampleMetrics, this.config.samplingInterval);
    } else if (isBrowser()) {
      // Nei browser, usiamo requestAnimationFrame per essere più efficienti
      let lastSampleTime = Date.now();
      const animFrameCallback = () => {
        const now = Date.now();
        if (now - lastSampleTime >= this.config.samplingInterval!) {
          sampleMetrics();
          lastSampleTime = now;
        }
        if (this.config.enabled) {
          requestAnimationFrame(animFrameCallback);
        }
      };
      requestAnimationFrame(animFrameCallback);
    }
  }

  /**
   * Ferma il campionamento periodico delle metriche
   */
  public stopSampling(): void {
    if (this.samplingInterval && isNode()) {
      clearInterval(this.samplingInterval);
      this.samplingInterval = null;
    }
    // Per i browser, il campionamento si fermerà automaticamente quando this.config.enabled diventa false
  }

  /**
   * Campiona le metriche di sistema
   */
  private async sampleSystemMetrics(): Promise<void> {
    try {
      // Ottieni lo stato globale del Layer 2
      const response = await fetch(
        `${this.client.getConfig().rpcUrl}/metrics/system`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Layer2Error(
          `Errore nell'ottenimento delle metriche di sistema: ${response.statusText}`,
          ErrorCode.METRICS_FETCH_FAILED
        );
      }

      const systemMetrics = await response.json();

      // Registra le metriche di sistema
      if (systemMetrics.tps) {
        this.recordMetric(MetricType.THROUGHPUT, systemMetrics.tps);
      }
      if (systemMetrics.avgLatency) {
        this.recordMetric(MetricType.LATENCY, systemMetrics.avgLatency);
      }
      if (systemMetrics.successRate) {
        this.recordMetric(MetricType.SUCCESS_RATE, systemMetrics.successRate);
      }
      if (systemMetrics.avgFinalizationTime) {
        this.recordMetric(MetricType.FINALIZATION_TIME, systemMetrics.avgFinalizationTime);
      }
      if (systemMetrics.avgBatchSize) {
        this.recordMetric(MetricType.BATCH_SIZE, systemMetrics.avgBatchSize);
      }
      if (systemMetrics.avgBridgeTime) {
        this.recordMetric(MetricType.BRIDGE_TIME, systemMetrics.avgBridgeTime);
      }
    } catch (error) {
      console.error('Errore nel campionamento delle metriche di sistema:', error);
    }
  }

  /**
   * Invia una metrica al server
   * @param metric Metrica da inviare
   */
  private async sendMetricToServer(metric: MetricEvent): Promise<void> {
    try {
      // Invia la metrica al server solo se abilitato
      if (!this.config.sendToServer) return;

      await fetch(`${this.client.getConfig().rpcUrl}/metrics/record`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metric),
      });
    } catch (error) {
      console.error('Errore nell\'invio della metrica al server:', error);
    }
  }

  /**
   * Ottiene l'analisi delle metriche per un tipo specifico
   * @param type Tipo di metrica
   * @param timeframe Intervallo di tempo
   * @returns Promise che si risolve con l'analisi delle metriche
   */
  public async getMetricsAnalysis(
    type: MetricType,
    timeframe: MetricTimeframe = MetricTimeframe.LAST_HOUR
  ): Promise<MetricsAnalysis> {
    try {
      // Chiamata all'API del Layer 2 per ottenere l'analisi delle metriche
      const response = await fetch(
        `${this.client.getConfig().rpcUrl}/metrics/analysis?type=${type}&timeframe=${timeframe}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Layer2Error(
          `Errore nell'ottenimento dell'analisi delle metriche: ${response.statusText}`,
          ErrorCode.METRICS_ANALYSIS_FAILED
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nell'ottenimento dell'analisi delle metriche: ${error.message}`,
        ErrorCode.METRICS_ANALYSIS_FAILED
      );
    }
  }

  /**
   * Ottiene le metriche registrate localmente
   * @param type Tipo di metrica opzionale per filtrare
   * @param startTime Timestamp di inizio opzionale
   * @param endTime Timestamp di fine opzionale
   * @returns Array di eventi di metrica
   */
  public getLocalMetrics(
    type?: MetricType,
    startTime?: number,
    endTime?: number
  ): MetricEvent[] {
    let filteredMetrics = this.metrics;

    // Filtra per tipo se specificato
    if (type) {
      filteredMetrics = filteredMetrics.filter(metric => metric.type === type);
    }

    // Filtra per intervallo di tempo se specificato
    if (startTime) {
      filteredMetrics = filteredMetrics.filter(metric => metric.timestamp >= startTime);
    }
    if (endTime) {
      filteredMetrics = filteredMetrics.filter(metric => metric.timestamp <= endTime);
    }

    return filteredMetrics;
  }

  /**
   * Cancella le metriche registrate localmente
   */
  public clearLocalMetrics(): void {
    this.metrics = [];
  }

  /**
   * Calcola l'analisi delle metriche locali
   * @param type Tipo di metrica
   * @param startTime Timestamp di inizio opzionale
   * @param endTime Timestamp di fine opzionale
   * @returns Analisi delle metriche
   */
  public calculateLocalMetricsAnalysis(
    type: MetricType,
    startTime?: number,
    endTime?: number
  ): Omit<MetricsAnalysis, 'timeframe'> {
    const filteredMetrics = this.getLocalMetrics(type, startTime, endTime);
    
    if (filteredMetrics.length === 0) {
      return {
        type,
        average: 0,
        min: 0,
        max: 0,
        stdDev: 0,
        p95: 0,
        p99: 0,
        timestamp: Date.now()
      };
    }

    const values = filteredMetrics.map(metric => metric.value);
    
    // Calcola statistiche di base
    const sum = values.reduce((acc, val) => acc + val, 0);
    const average = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    
    // Calcola deviazione standard
    const squaredDiffs = values.map(value => Math.pow(value - average, 2));
    const avgSquaredDiff = squaredDiffs.reduce((acc, val) => acc + val, 0) / values.length;
    const stdDev = Math.sqrt(avgSquaredDiff);
    
    // Calcola percentili
    const sortedValues = [...values].sort((a, b) => a - b);
    const p95Index = Math.floor(sortedValues.length * 0.95);
    const p99Index = Math.floor(sortedValues.length * 0.99);
    const p95 = sortedValues[p95Index];
    const p99 = sortedValues[p99Index];
    
    return {
      type,
      average,
      min,
      max,
      stdDev,
      p95,
      p99,
      timestamp: Date.now()
    };
  }
}
