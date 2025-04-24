/**
 * Ottimizzatore del gas per il Layer-2 su Solana
 * 
 * Questo modulo implementa l'ottimizzatore del gas che si occupa di calcolare
 * le commissioni ottimali per le transazioni Solana.
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { performance } = require('perf_hooks');

/**
 * Classe per l'ottimizzazione del gas
 */
class GasOptimizer {
  /**
   * Costruttore
   * @param {Object} config - Configurazione dell'ottimizzatore
   * @param {Connection} config.connection - Connessione a Solana
   * @param {number} config.priorityFeeMultiplier - Moltiplicatore per la commissione di priorità
   * @param {number} config.baseFeeMultiplier - Moltiplicatore per la commissione base
   * @param {number} config.maxPriorityFee - Commissione di priorità massima in lamports
   * @param {number} config.minPriorityFee - Commissione di priorità minima in lamports
   * @param {number} config.updateInterval - Intervallo di aggiornamento in millisecondi
   * @param {number} config.historySize - Dimensione della cronologia delle commissioni
   */
  constructor(config) {
    this.connection = config.connection;
    this.priorityFeeMultiplier = config.priorityFeeMultiplier || 1.5;
    this.baseFeeMultiplier = config.baseFeeMultiplier || 1.2;
    this.maxPriorityFee = config.maxPriorityFee || 100000; // 0.0001 SOL
    this.minPriorityFee = config.minPriorityFee || 5000; // 0.000005 SOL
    this.updateInterval = config.updateInterval || 60000; // 1 minuto
    this.historySize = config.historySize || 10;
    
    // Commissioni correnti
    this.currentBaseFee = 5000; // 0.000005 SOL
    this.currentPriorityFee = 10000; // 0.00001 SOL
    
    // Cronologia delle commissioni
    this.feeHistory = [];
    
    // Timestamp dell'ultimo aggiornamento
    this.lastUpdateTimestamp = 0;
    
    // Metriche
    this.metrics = {
      averageBaseFee: 0,
      averagePriorityFee: 0,
      minBaseFee: 0,
      maxBaseFee: 0,
      minPriorityFee: 0,
      maxPriorityFee: 0,
      lastUpdateDuration: 0,
    };
    
    // Bind dei metodi
    this.updateFees = this.updateFees.bind(this);
    this.optimizeFees = this.optimizeFees.bind(this);
    this.getRecentPriorityFees = this.getRecentPriorityFees.bind(this);
    this.calculateOptimalFees = this.calculateOptimalFees.bind(this);
    this.getMetrics = this.getMetrics.bind(this);
    
    console.log('GasOptimizer inizializzato con successo');
  }
  
  /**
   * Aggiorna le commissioni
   * @returns {Promise<Object>} Commissioni aggiornate
   */
  async updateFees() {
    const startTime = performance.now();
    
    try {
      console.log('Aggiornamento delle commissioni...');
      
      // Verifica se è necessario aggiornare le commissioni
      const now = Date.now();
      if (now - this.lastUpdateTimestamp < this.updateInterval) {
        console.log('Aggiornamento delle commissioni non necessario');
        return {
          baseFee: this.currentBaseFee,
          priorityFee: this.currentPriorityFee,
        };
      }
      
      // Ottiene le commissioni di priorità recenti
      const recentPriorityFees = await this.getRecentPriorityFees();
      
      // Ottiene la commissione base corrente
      const { feeCalculator } = await this.connection.getRecentBlockhash();
      const baseFee = feeCalculator.lamportsPerSignature;
      
      // Calcola le commissioni ottimali
      const { optimalBaseFee, optimalPriorityFee } = this.calculateOptimalFees(
        baseFee,
        recentPriorityFees
      );
      
      // Aggiorna le commissioni correnti
      this.currentBaseFee = optimalBaseFee;
      this.currentPriorityFee = optimalPriorityFee;
      
      // Aggiorna la cronologia delle commissioni
      this.feeHistory.push({
        timestamp: now,
        baseFee: optimalBaseFee,
        priorityFee: optimalPriorityFee,
      });
      
      // Limita la dimensione della cronologia
      if (this.feeHistory.length > this.historySize) {
        this.feeHistory.shift();
      }
      
      // Aggiorna il timestamp dell'ultimo aggiornamento
      this.lastUpdateTimestamp = now;
      
      // Aggiorna le metriche
      this.updateMetrics();
      
      console.log(`Commissioni aggiornate: base=${optimalBaseFee}, priorità=${optimalPriorityFee}`);
      
      return {
        baseFee: optimalBaseFee,
        priorityFee: optimalPriorityFee,
      };
    } catch (error) {
      console.error('Errore durante l\'aggiornamento delle commissioni:', error);
      
      // In caso di errore, utilizza le commissioni correnti
      return {
        baseFee: this.currentBaseFee,
        priorityFee: this.currentPriorityFee,
      };
    } finally {
      const endTime = performance.now();
      this.metrics.lastUpdateDuration = endTime - startTime;
    }
  }
  
  /**
   * Ottimizza le commissioni
   * @returns {Promise<Object>} Commissioni ottimizzate
   */
  async optimizeFees() {
    // Aggiorna le commissioni se necessario
    await this.updateFees();
    
    // Restituisce le commissioni correnti
    return {
      baseFee: this.currentBaseFee,
      priorityFee: this.currentPriorityFee,
    };
  }
  
  /**
   * Ottiene le commissioni di priorità recenti
   * @returns {Promise<Array<number>>} Commissioni di priorità recenti
   */
  async getRecentPriorityFees() {
    try {
      // In un'implementazione reale, qui otterremmo le commissioni di priorità
      // dalle transazioni recenti utilizzando l'API di Solana
      
      // Simuliamo le commissioni di priorità recenti
      const recentPriorityFees = [
        10000, // 0.00001 SOL
        15000, // 0.000015 SOL
        20000, // 0.00002 SOL
        12000, // 0.000012 SOL
        18000, // 0.000018 SOL
      ];
      
      return recentPriorityFees;
    } catch (error) {
      console.error('Errore durante l\'ottenimento delle commissioni di priorità recenti:', error);
      
      // In caso di errore, restituisce un array vuoto
      return [];
    }
  }
  
  /**
   * Calcola le commissioni ottimali
   * @param {number} baseFee - Commissione base
   * @param {Array<number>} priorityFees - Commissioni di priorità
   * @returns {Object} Commissioni ottimali
   */
  calculateOptimalFees(baseFee, priorityFees) {
    // Calcola la commissione base ottimale
    const optimalBaseFee = Math.max(
      baseFee * this.baseFeeMultiplier,
      this.currentBaseFee
    );
    
    // Calcola la commissione di priorità ottimale
    let optimalPriorityFee = this.minPriorityFee;
    
    if (priorityFees.length > 0) {
      // Calcola la media delle commissioni di priorità
      const sum = priorityFees.reduce((acc, fee) => acc + fee, 0);
      const average = sum / priorityFees.length;
      
      // Calcola la commissione di priorità ottimale
      optimalPriorityFee = Math.min(
        Math.max(
          average * this.priorityFeeMultiplier,
          this.minPriorityFee
        ),
        this.maxPriorityFee
      );
    }
    
    return {
      optimalBaseFee: Math.round(optimalBaseFee),
      optimalPriorityFee: Math.round(optimalPriorityFee),
    };
  }
  
  /**
   * Aggiorna le metriche
   */
  updateMetrics() {
    if (this.feeHistory.length === 0) {
      return;
    }
    
    // Calcola le metriche
    const baseFees = this.feeHistory.map(item => item.baseFee);
    const priorityFees = this.feeHistory.map(item => item.priorityFee);
    
    // Media
    const sumBaseFees = baseFees.reduce((acc, fee) => acc + fee, 0);
    const sumPriorityFees = priorityFees.reduce((acc, fee) => acc + fee, 0);
    
    this.metrics.averageBaseFee = sumBaseFees / baseFees.length;
    this.metrics.averagePriorityFee = sumPriorityFees / priorityFees.length;
    
    // Min e max
    this.metrics.minBaseFee = Math.min(...baseFees);
    this.metrics.maxBaseFee = Math.max(...baseFees);
    this.metrics.minPriorityFee = Math.min(...priorityFees);
    this.metrics.maxPriorityFee = Math.max(...priorityFees);
  }
  
  /**
   * Ottiene le metriche
   * @returns {Object} Metriche
   */
  getMetrics() {
    return { ...this.metrics };
  }
}

module.exports = { GasOptimizer };
