/**
 * Miglioramenti di sicurezza per il Launchpad
 * 
 * Questo modulo implementa miglioramenti di sicurezza per il Launchpad:
 * - Algoritmo Anti-Rug avanzato
 * - Verifiche aggiuntive per i creatori di token
 * - Monitoraggio delle attività sospette
 * 
 * @module launchpad_security_enhancements
 */

import { Logger } from './utils/logger';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { TokenCreationParams } from './launchpad_speed_optimizer'; // Assumendo che sia definito qui

/**
 * Configurazione per i miglioramenti di sicurezza del Launchpad
 */
export interface LaunchpadSecurityConfig {
  /** Livello di sensibilità dell'algoritmo Anti-Rug (0-100) */
  antiRugSensitivity: number;
  /** Abilita le verifiche aggiuntive per i creatori */
  enableCreatorVerification: boolean;
  /** Livello di verifica richiesto per i creatori (1-5) */
  requiredCreatorVerificationLevel: number;
  /** Abilita il monitoraggio delle attività sospette */
  enableSuspiciousActivityMonitoring: boolean;
  /** Soglia per le attività sospette */
  suspiciousActivityThreshold: number;
  /** Periodo di monitoraggio delle attività sospette in millisecondi */
  suspiciousActivityMonitoringPeriodMs: number;
  /** Abilita il blocco automatico dei token sospetti */
  enableAutoLockSuspiciousTokens: boolean;
  /** Durata del blocco automatico in secondi */
  autoLockDurationSeconds: number;
  /** Servizio esterno di verifica dell'identità (opzionale) */
  identityVerificationServiceUrl?: string;
  /** Chiave API per il servizio di verifica dell'identità (opzionale) */
  identityVerificationServiceApiKey?: string;
  /** Servizio esterno di analisi on-chain (opzionale) */
  onChainAnalysisServiceUrl?: string;
  /** Chiave API per il servizio di analisi on-chain (opzionale) */
  onChainAnalysisServiceApiKey?: string;
}

/**
 * Risultato della valutazione Anti-Rug
 */
export interface AntiRugEvaluationResult {
  /** Punteggio di rischio (0-100, 0 = basso rischio, 100 = alto rischio) */
  riskScore: number;
  /** Indica se il token è considerato sospetto */
  isSuspicious: boolean;
  /** Fattori di rischio identificati */
  riskFactors: {
    /** Descrizione del fattore di rischio */
    description: string;
    /** Punteggio di impatto del fattore (0-10) */
    impactScore: number;
  }[];
  /** Raccomandazioni */
  recommendations?: string[];
}

/**
 * Risultato della verifica del creatore
 */
export interface CreatorVerificationResult {
  /** Indica se la verifica è stata superata */
  passed: boolean;
  /** Livello di verifica raggiunto (0-5) */
  verificationLevel: number;
  /** Dettagli della verifica */
  details: {
    /** Verifica dell'identità */
    identityVerified: boolean;
    /** Verifica dell'indirizzo */
    addressVerified: boolean;
    /** Analisi della reputazione on-chain */
    onChainReputationScore?: number; // 0-100
    /** Cronologia dei lanci precedenti */
    previousLaunchHistory?: {
      /** Numero di lanci */
      launchCount: number;
      /** Tasso di successo */
      successRate: number; // 0-100
      /** Punteggio medio Anti-Rug dei lanci precedenti */
      averageAntiRugScore?: number; // 0-100
    };
    /** Verifica dei social media */
    socialMediaVerified?: boolean;
  };
  /** Messaggio di errore in caso di fallimento */
  errorMessage?: string;
}

/**
 * Evento di attività sospetta
 */
export interface SuspiciousActivityEvent {
  /** Indirizzo del token */
  tokenAddress: string;
  /** Tipo di attività sospetta */
  activityType: string;
  /** Dettagli dell'attività */
  details: Record<string, any>;
  /** Timestamp dell'evento */
  timestamp: number;
}

/**
 * Classe che implementa i miglioramenti di sicurezza del Launchpad
 */
export class LaunchpadSecurityEnhancements extends EventEmitter {
  private config: LaunchpadSecurityConfig;
  private logger: Logger;
  private suspiciousActivityMonitor: Map<string, { count: number; lastTimestamp: number }> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private initialized: boolean = false;

  /**
   * Crea una nuova istanza dei miglioramenti di sicurezza del Launchpad
   * 
   * @param config - Configurazione dei miglioramenti di sicurezza
   */
  constructor(config: Partial<LaunchpadSecurityConfig> = {}) {
    super();

    // Configurazione predefinita
    this.config = {
      antiRugSensitivity: 75,
      enableCreatorVerification: true,
      requiredCreatorVerificationLevel: 3,
      enableSuspiciousActivityMonitoring: true,
      suspiciousActivityThreshold: 10,
      suspiciousActivityMonitoringPeriodMs: 3600000, // 1 ora
      enableAutoLockSuspiciousTokens: true,
      autoLockDurationSeconds: 86400, // 1 giorno
      ...config
    };

    this.logger = new Logger('LaunchpadSecurity');

    this.logger.info('LaunchpadSecurityEnhancements inizializzato', {
      antiRugSensitivity: this.config.antiRugSensitivity,
      enableCreatorVerification: this.config.enableCreatorVerification,
      requiredCreatorVerificationLevel: this.config.requiredCreatorVerificationLevel
    });
  }

  /**
   * Inizializza i miglioramenti di sicurezza
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.info('LaunchpadSecurityEnhancements già inizializzato');
      return;
    }

    try {
      this.logger.info('Inizializzazione LaunchpadSecurityEnhancements');

      // Avvia il monitoraggio delle attività sospette se abilitato
      if (this.config.enableSuspiciousActivityMonitoring) {
        this.startSuspiciousActivityMonitoring();
      }

      this.initialized = true;
      this.logger.info('LaunchpadSecurityEnhancements inizializzato con successo');
    } catch (error) {
      this.logger.error('Errore durante l\\'inizializzazione di LaunchpadSecurityEnhancements', { error });
      throw new Error(`Errore durante l'inizializzazione di LaunchpadSecurityEnhancements: ${error.message}`);
    }
  }

  /**
   * Esegue la valutazione Anti-Rug per un token
   * 
   * @param params - Parametri di creazione del token
   * @param tokenAddress - Indirizzo del token (opzionale, se già creato)
   * @returns Promise che si risolve con il risultato della valutazione
   */
  async evaluateAntiRug(params: TokenCreationParams, tokenAddress?: string): Promise<AntiRugEvaluationResult> {
    if (!this.initialized) {
      throw new Error('LaunchpadSecurityEnhancements non inizializzato');
    }

    this.logger.info('Valutazione Anti-Rug in corso', { name: params.name, symbol: params.symbol, tokenAddress });
    const startTime = Date.now();

    let riskScore = 0;
    const riskFactors: AntiRugEvaluationResult['riskFactors'] = [];

    try {
      // 1. Analisi della distribuzione dei token
      if (params.distribution) {
        const { teamPercentage = 0, liquidityPercentage = 0 } = params.distribution;
        if (teamPercentage > 20) {
          riskScore += 15 * (teamPercentage / 100);
          riskFactors.push({ description: 'Alta percentuale di token per il team', impactScore: 7 });
        }
        if (liquidityPercentage < 50) {
          riskScore += 20 * ((100 - liquidityPercentage) / 100);
          riskFactors.push({ description: 'Bassa percentuale di token per la liquidità iniziale', impactScore: 8 });
        }
        // Controllo concentrazione wallet team
        if (params.distribution.addresses && Object.keys(params.distribution.addresses).length === 1 && teamPercentage > 10) {
            riskScore += 10;
            riskFactors.push({ description: 'Token del team concentrati in un unico wallet', impactScore: 6 });
        }
      }

      // 2. Analisi del blocco della liquidità
      if (!params.liquidityLock || params.liquidityLock.percentage < 80 || params.liquidityLock.lockPeriod < 15552000 /* 6 mesi */) {
        riskScore += 25;
        riskFactors.push({ description: 'Blocco della liquidità insufficiente (percentuale o durata)', impactScore: 9 });
      }

      // 3. Analisi delle tasse
      if (params.taxation) {
        const { buyTax = 0, sellTax = 0 } = params.taxation;
        if (buyTax > 10 || sellTax > 10) {
          riskScore += 10 * Math.max(buyTax, sellTax) / 20;
          riskFactors.push({ description: 'Tasse di acquisto/vendita elevate', impactScore: 5 });
        }
        // Controllo honeypot potenziale (tassa di vendita molto alta)
        if (sellTax > 50) {
            riskScore += 30;
            riskFactors.push({ description: 'Tassa di vendita estremamente alta (potenziale honeypot)', impactScore: 10 });
        }
      }

      // 4. Analisi del creatore (se abilitata)
      if (this.config.enableCreatorVerification) {
        const creatorVerification = await this.verifyCreator(params.creatorAddress);
        if (!creatorVerification.passed || creatorVerification.verificationLevel < this.config.requiredCreatorVerificationLevel) {
          riskScore += 15 * (1 - creatorVerification.verificationLevel / 5);
          riskFactors.push({ description: 'Verifica del creatore fallita o livello insufficiente', impactScore: 7 });
        }
        if (creatorVerification.details.onChainReputationScore !== undefined && creatorVerification.details.onChainReputationScore < 50) {
            riskScore += 10 * ((100 - creatorVerification.details.onChainReputationScore) / 100);
            riskFactors.push({ description: 'Bassa reputazione on-chain del creatore', impactScore: 6 });
        }
        if (creatorVerification.details.previousLaunchHistory && creatorVerification.details.previousLaunchHistory.successRate < 70) {
            riskScore += 10 * ((100 - creatorVerification.details.previousLaunchHistory.successRate) / 100);
            riskFactors.push({ description: 'Basso tasso di successo dei lanci precedenti del creatore', impactScore: 6 });
        }
      }

      // 5. Analisi on-chain (se disponibile e configurata)
      if (tokenAddress && this.config.onChainAnalysisServiceUrl) {
        const onChainAnalysis = await this.performOnChainAnalysis(tokenAddress);
        if (onChainAnalysis.isSuspicious) {
          riskScore += onChainAnalysis.suspicionScore || 20; // Aggiungi punteggio basato sull'analisi
          riskFactors.push({ description: `Analisi on-chain ha rilevato attività sospette: ${onChainAnalysis.reason}`, impactScore: 8 });
        }
      }

      // 6. Analisi dei metadati
      if (!params.metadata?.website || !params.metadata?.description) {
        riskScore += 5;
        riskFactors.push({ description: 'Metadati incompleti (manca sito web o descrizione)', impactScore: 3 });
      }

      // Normalizza il punteggio tra 0 e 100
      riskScore = Math.min(100, Math.max(0, riskScore));

      // Determina se è sospetto in base alla sensibilità
      const isSuspicious = riskScore >= this.config.antiRugSensitivity;

      const evaluationTime = Date.now() - startTime;
      this.logger.info('Valutazione Anti-Rug completata', { name: params.name, riskScore, isSuspicious, evaluationTime });

      const result: AntiRugEvaluationResult = {
        riskScore,
        isSuspicious,
        riskFactors,
        recommendations: this.generateRecommendations(riskScore, riskFactors)
      };

      // Emetti evento di valutazione
      this.emit('antiRugEvaluated', { params, result });

      // Blocca automaticamente se sospetto e abilitato
      if (isSuspicious && this.config.enableAutoLockSuspiciousTokens && tokenAddress) {
        this.autoLockToken(tokenAddress, 'Anti-Rug evaluation failed');
      }

      return result;

    } catch (error) {
      this.logger.error('Errore durante la valutazione Anti-Rug', { error });
      // In caso di errore, considera il token ad alto rischio
      return {
        riskScore: 100,
        isSuspicious: true,
        riskFactors: [{ description: 'Errore durante la valutazione', impactScore: 10 }],
        recommendations: ['Procedere con estrema cautela a causa di un errore nella valutazione']
      };
    }
  }

  /**
   * Genera raccomandazioni basate sul punteggio di rischio e sui fattori
   * 
   * @param riskScore - Punteggio di rischio
   * @param riskFactors - Fattori di rischio
   * @returns Array di stringhe con le raccomandazioni
   * @private
   */
  private generateRecommendations(riskScore: number, riskFactors: AntiRugEvaluationResult['riskFactors']): string[] {
    const recommendations: string[] = [];

    if (riskScore >= 80) {
      recommendations.push('Rischio estremamente alto. Si sconsiglia fortemente l\'investimento.');
    } else if (riskScore >= 60) {
      recommendations.push('Rischio alto. Procedere con estrema cautela e fare ulteriori ricerche.');
    } else if (riskScore >= 40) {
      recommendations.push('Rischio moderato. Valutare attentamente i fattori di rischio prima di investire.');
    } else {
      recommendations.push('Rischio basso. Tuttavia, fare sempre le proprie ricerche (DYOR).');
    }

    // Aggiungi raccomandazioni specifiche per i fattori di rischio
    riskFactors.forEach(factor => {
      if (factor.description.includes('liquidità')) {
        recommendations.push('Verificare i dettagli del blocco della liquidità su piattaforme affidabili.');
      }
      if (factor.description.includes('team')) {
        recommendations.push('Analizzare la distribuzione dei token del team e la loro reputazione.');
      }
      if (factor.description.includes('tasse')) {
        recommendations.push('Controllare attentamente le tasse di acquisto/vendita e la loro destinazione.');
      }
      if (factor.description.includes('creatore')) {
        recommendations.push('Approfondire la verifica sull\'identità e la storia del creatore.');
      }
      if (factor.description.includes('honeypot')) {
          recommendations.push('ATTENZIONE: Possibile honeypot rilevato. Non investire.');
      }
    });

    return recommendations;
  }

  /**
   * Verifica l'identità e la reputazione del creatore di un token
   * 
   * @param creatorAddress - Indirizzo del creatore
   * @returns Promise che si risolve con il risultato della verifica
   */
  async verifyCreator(creatorAddress: string): Promise<CreatorVerificationResult> {
    if (!this.initialized) {
      throw new Error('LaunchpadSecurityEnhancements non inizializzato');
    }

    if (!this.config.enableCreatorVerification) {
      return {
        passed: true, // Se la verifica non è abilitata, consideriamo passato
        verificationLevel: 0,
        details: { identityVerified: false, addressVerified: false }
      };
    }

    this.logger.info('Verifica del creatore in corso', { creatorAddress });
    const startTime = Date.now();

    const result: CreatorVerificationResult = {
      passed: false,
      verificationLevel: 0,
      details: {
        identityVerified: false,
        addressVerified: false,
      }
    };

    try {
      // Livello 1: Verifica base dell'indirizzo (es. formato valido)
      if (this.isValidSolanaAddress(creatorAddress)) {
        result.verificationLevel = 1;
        result.details.addressVerified = true;
      } else {
        result.errorMessage = 'Formato indirizzo creatore non valido';
        return result; // Fallimento immediato se l'indirizzo non è valido
      }

      // Livello 2: Analisi on-chain base (es. età del wallet, numero transazioni)
      const onChainBase = await this.performBaseOnChainAnalysis(creatorAddress);
      if (onChainBase.ageDays > 30 && onChainBase.transactionCount > 10) {
        result.verificationLevel = 2;
      }

      // Livello 3: Analisi on-chain avanzata (reputazione, lanci precedenti)
      if (this.config.onChainAnalysisServiceUrl) {
        const onChainAdvanced = await this.performAdvancedOnChainAnalysis(creatorAddress);
        result.details.onChainReputationScore = onChainAdvanced.reputationScore;
        result.details.previousLaunchHistory = onChainAdvanced.launchHistory;
        if (onChainAdvanced.reputationScore >= 60 && onChainAdvanced.launchHistory.successRate >= 75) {
          result.verificationLevel = 3;
        }
      }

      // Livello 4: Verifica Social Media (opzionale, richiede integrazione)
      // const socialMediaVerified = await this.verifySocialMedia(creatorAddress);
      // if (socialMediaVerified) {
      //   result.verificationLevel = 4;
      //   result.details.socialMediaVerified = true;
      // }

      // Livello 5: Verifica Identità (KYC) (opzionale, richiede integrazione)
      if (this.config.identityVerificationServiceUrl) {
        const identityVerified = await this.verifyIdentity(creatorAddress);
        if (identityVerified) {
          result.verificationLevel = 5;
          result.details.identityVerified = true;
        }
      }

      // Verifica se il livello richiesto è stato raggiunto
      result.passed = result.verificationLevel >= this.config.requiredCreatorVerificationLevel;

      const verificationTime = Date.now() - startTime;
      this.logger.info('Verifica del creatore completata', { creatorAddress, passed: result.passed, verificationLevel: result.verificationLevel, verificationTime });

      // Emetti evento di verifica
      this.emit('creatorVerified', { creatorAddress, result });

      return result;

    } catch (error) {
      this.logger.error('Errore durante la verifica del creatore', { creatorAddress, error });
      result.errorMessage = error.message;
      return result;
    }
  }

  /**
   * Verifica se un indirizzo Solana è valido
   * @param address - Indirizzo da verificare
   * @returns true se valido, false altrimenti
   * @private
   */
  private isValidSolanaAddress(address: string): boolean {
    // Implementazione semplificata. Usare @solana/web3.js PublicKey.isOnCurve in produzione
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }

  /**
   * Esegue un'analisi on-chain di base per un indirizzo
   * @param address - Indirizzo da analizzare
   * @returns Risultati dell'analisi base
   * @private
   */
  private async performBaseOnChainAnalysis(address: string): Promise<{ ageDays: number; transactionCount: number }> {
    // Simulazione: in produzione, interrogare la blockchain Solana
    await new Promise(resolve => setTimeout(resolve, 50)); // Simula chiamata API
    const ageDays = Math.floor(Math.random() * 365);
    const transactionCount = Math.floor(Math.random() * 1000);
    return { ageDays, transactionCount };
  }

  /**
   * Esegue un'analisi on-chain avanzata per un indirizzo
   * @param address - Indirizzo da analizzare
   * @returns Risultati dell'analisi avanzata
   * @private
   */
  private async performAdvancedOnChainAnalysis(address: string): Promise<{
    reputationScore: number;
    launchHistory: { launchCount: number; successRate: number; averageAntiRugScore?: number };
  }> {
    // Simulazione: in produzione, chiamare un servizio esterno come Chainalysis, TRM Labs, etc.
    this.logger.debug('Chiamata al servizio di analisi on-chain (simulata)', { address });
    await new Promise(resolve => setTimeout(resolve, 200)); // Simula chiamata API esterna

    if (!this.config.onChainAnalysisServiceUrl) {
        this.logger.warn('URL del servizio di analisi on-chain non configurato');
        return {
            reputationScore: 50, // Default neutro
            launchHistory: { launchCount: 0, successRate: 100 }
        };
    }
    
    // Esempio di chiamata API (simulata)
    // const response = await fetch(this.config.onChainAnalysisServiceUrl, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'Authorization': `Bearer ${this.config.onChainAnalysisServiceApiKey}`
    //   },
    //   body: JSON.stringify({ address })
    // });
    // if (!response.ok) {
    //   throw new Error('Errore dal servizio di analisi on-chain');
    // }
    // const data = await response.json();
    // return data;

    // Dati simulati
    const reputationScore = Math.floor(Math.random() * 50) + 50; // Punteggio tra 50 e 100
    const launchCount = Math.floor(Math.random() * 5);
    const successRate = Math.floor(Math.random() * 30) + 70; // Tasso successo tra 70 e 100
    const averageAntiRugScore = launchCount > 0 ? Math.floor(Math.random() * 40) + 10 : undefined; // Punteggio medio tra 10 e 50

    return {
      reputationScore,
      launchHistory: { launchCount, successRate, averageAntiRugScore }
    };
  }

  /**
   * Verifica l'identità tramite servizio esterno (KYC)
   * @param address - Indirizzo associato all'identità
   * @returns true se verificato, false altrimenti
   * @private
   */
  private async verifyIdentity(address: string): Promise<boolean> {
    // Simulazione: in produzione, chiamare un servizio esterno come Jumio, Veriff, etc.
    this.logger.debug('Chiamata al servizio di verifica identità (simulata)', { address });
    await new Promise(resolve => setTimeout(resolve, 300)); // Simula chiamata API esterna

    if (!this.config.identityVerificationServiceUrl) {
        this.logger.warn('URL del servizio di verifica identità non configurato');
        return false;
    }

    // Esempio di chiamata API (simulata)
    // const response = await fetch(this.config.identityVerificationServiceUrl, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'Authorization': `Bearer ${this.config.identityVerificationServiceApiKey}`
    //   },
    //   body: JSON.stringify({ address })
    // });
    // if (!response.ok) {
    //   throw new Error('Errore dal servizio di verifica identità');
    // }
    // const data = await response.json();
    // return data.verified;

    // Dati simulati (50% di probabilità di successo)
    return Math.random() > 0.5;
  }

  /**
   * Esegue un'analisi on-chain per attività sospette su un token
   * @param tokenAddress - Indirizzo del token
   * @returns Risultati dell'analisi
   * @private
   */
  private async performOnChainAnalysis(tokenAddress: string): Promise<{ isSuspicious: boolean; suspicionScore?: number; reason?: string }> {
    // Simulazione: in produzione, chiamare un servizio esterno o analizzare dati on-chain
    this.logger.debug('Chiamata al servizio di analisi on-chain per token (simulata)', { tokenAddress });
    await new Promise(resolve => setTimeout(resolve, 150)); // Simula chiamata API esterna

    if (!this.config.onChainAnalysisServiceUrl) {
        this.logger.warn('URL del servizio di analisi on-chain non configurato per l\'analisi dei token');
        return { isSuspicious: false };
    }

    // Dati simulati (10% di probabilità di essere sospetto)
    const isSuspicious = Math.random() < 0.1;
    if (isSuspicious) {
      const suspicionScore = Math.floor(Math.random() * 30) + 10; // Punteggio tra 10 e 40
      const reasons = ['Alta concentrazione di token nei top holder', 'Volume di vendita insolitamente alto', 'Interazioni con indirizzi sospetti'];
      const reason = reasons[Math.floor(Math.random() * reasons.length)];
      return { isSuspicious: true, suspicionScore, reason };
    } else {
      return { isSuspicious: false };
    }
  }

  /**
   * Avvia il monitoraggio delle attività sospette
   * @private
   */
  private startSuspiciousActivityMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(() => {
      try {
        this.checkSuspiciousActivities();
      } catch (error) {
        this.logger.error('Errore durante il controllo delle attività sospette', { error });
      }
    }, this.config.suspiciousActivityMonitoringPeriodMs);

    this.logger.info('Monitoraggio attività sospette avviato', {
      periodMs: this.config.suspiciousActivityMonitoringPeriodMs,
      threshold: this.config.suspiciousActivityThreshold
    });
  }

  /**
   * Registra un'attività potenzialmente sospetta
   * 
   * @param tokenAddress - Indirizzo del token
   * @param activityType - Tipo di attività
   * @param details - Dettagli dell'attività
   */
  logSuspiciousActivity(tokenAddress: string, activityType: string, details: Record<string, any>): void {
    if (!this.initialized || !this.config.enableSuspiciousActivityMonitoring) {
      return;
    }

    const key = `${tokenAddress}:${activityType}`;
    const now = Date.now();
    const record = this.suspiciousActivityMonitor.get(key) || { count: 0, lastTimestamp: 0 };

    // Resetta il contatore se il periodo è scaduto
    if (now - record.lastTimestamp > this.config.suspiciousActivityMonitoringPeriodMs) {
      record.count = 0;
    }

    record.count++;
    record.lastTimestamp = now;
    this.suspiciousActivityMonitor.set(key, record);

    this.logger.debug('Attività sospetta registrata', { tokenAddress, activityType, count: record.count });

    // Controlla immediatamente se la soglia è stata superata
    if (record.count >= this.config.suspiciousActivityThreshold) {
      this.handleSuspiciousActivityThresholdReached(tokenAddress, activityType, record.count, details);
      // Resetta il contatore dopo aver gestito l'evento per evitare notifiche multiple immediate
      record.count = 0;
      this.suspiciousActivityMonitor.set(key, record);
    }
  }

  /**
   * Controlla periodicamente le attività sospette registrate
   * @private
   */
  private checkSuspiciousActivities(): void {
    const now = Date.now();
    this.suspiciousActivityMonitor.forEach((record, key) => {
      // Rimuovi i record scaduti
      if (now - record.lastTimestamp > this.config.suspiciousActivityMonitoringPeriodMs) {
        this.suspiciousActivityMonitor.delete(key);
      }
    });
  }

  /**
   * Gestisce il superamento della soglia di attività sospetta
   * @param tokenAddress - Indirizzo del token
   * @param activityType - Tipo di attività
   * @param count - Numero di eventi
   * @param details - Dettagli dell'ultimo evento
   * @private
   */
  private handleSuspiciousActivityThresholdReached(tokenAddress: string, activityType: string, count: number, details: Record<string, any>): void {
    this.logger.warn('Soglia attività sospetta superata!', { tokenAddress, activityType, count });

    const event: SuspiciousActivityEvent = {
      tokenAddress,
      activityType,
      details,
      timestamp: Date.now()
    };

    // Emetti evento
    this.emit('suspiciousActivityDetected', event);

    // Blocca automaticamente se abilitato
    if (this.config.enableAutoLockSuspiciousTokens) {
      this.autoLockToken(tokenAddress, `Suspicious activity detected: ${activityType}`);
    }
  }

  /**
   * Blocca automaticamente un token sospetto
   * @param tokenAddress - Indirizzo del token
   * @param reason - Motivo del blocco
   * @private
   */
  private async autoLockToken(tokenAddress: string, reason: string): Promise<void> {
    this.logger.warn('Blocco automatico del token sospetto', { tokenAddress, reason, durationSeconds: this.config.autoLockDurationSeconds });

    try {
      // Implementazione simulata: in produzione, interagire con il contratto del token o un contratto di blocco
      await new Promise(resolve => setTimeout(resolve, 100)); // Simula operazione on-chain

      this.logger.info('Token bloccato automaticamente', { tokenAddress });

      // Emetti evento
      this.emit('tokenAutoLocked', { tokenAddress, reason, durationSeconds: this.config.autoLockDurationSeconds });

    } catch (error) {
      this.logger.error('Errore durante il blocco automatico del token', { tokenAddress, error });
    }
  }

  /**
   * Ottiene la configurazione
   * 
   * @returns Configurazione
   */
  getConfig(): LaunchpadSecurityConfig {
    return { ...this.config };
  }

  /**
   * Aggiorna la configurazione
   * 
   * @param config - Nuova configurazione
   */
  updateConfig(config: Partial<LaunchpadSecurityConfig>): void {
    const oldMonitoringPeriod = this.config.suspiciousActivityMonitoringPeriodMs;
    this.config = {
      ...this.config,
      ...config
    };

    // Riavvia il monitoraggio se necessario
    if (config.enableSuspiciousActivityMonitoring !== undefined || config.suspiciousActivityMonitoringPeriodMs !== undefined) {
      if (this.config.enableSuspiciousActivityMonitoring) {
        // Riavvia solo se il periodo è cambiato
        if (this.config.suspiciousActivityMonitoringPeriodMs !== oldMonitoringPeriod) {
            this.startSuspiciousActivityMonitoring();
        }
      } else if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
        this.suspiciousActivityMonitor.clear(); // Pulisci i dati quando disabilitato
      }
    }

    this.logger.info('Configurazione di sicurezza aggiornata', {
      antiRugSensitivity: this.config.antiRugSensitivity,
      enableCreatorVerification: this.config.enableCreatorVerification,
      requiredCreatorVerificationLevel: this.config.requiredCreatorVerificationLevel
    });
  }

  /**
   * Arresta i miglioramenti di sicurezza
   */
  async shutdown(): Promise<void> {
    try {
      this.logger.info('Arresto di LaunchpadSecurityEnhancements');

      // Arresta il monitoraggio
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }

      // Pulisci le strutture dati
      this.suspiciousActivityMonitor.clear();

      this.initialized = false;
      this.logger.info('LaunchpadSecurityEnhancements arrestato con successo');
    } catch (error) {
      this.logger.error('Errore durante l\\'arresto di LaunchpadSecurityEnhancements', { error });
      throw new Error(`Errore durante l'arresto di LaunchpadSecurityEnhancements: ${error.message}`);
    }
  }
}

