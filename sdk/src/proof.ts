/**
 * @fileoverview Modulo per la gestione delle prove crittografiche nel Layer 2 di Solana
 */

import { Layer2Client } from './client';
import { Layer2Error, ErrorCode } from './types/errors';

/**
 * Tipi di prove supportati
 */
export enum ProofType {
  MERKLE = 'merkle',
  STATE_TRANSITION = 'state-transition',
  INCLUSION = 'inclusion',
  EXCLUSION = 'exclusion',
  VALIDITY = 'validity'
}

/**
 * Struttura di una prova
 */
export interface Proof {
  /** Tipo di prova */
  type: ProofType;
  /** Dati della prova in formato serializzato */
  data: string;
  /** Metadati associati alla prova */
  metadata?: {
    /** Timestamp di creazione della prova */
    createdAt: number;
    /** Hash del blocco associato alla prova */
    blockHash?: string;
    /** Altezza del blocco associato alla prova */
    blockHeight?: number;
  };
}

/**
 * Opzioni per la verifica di una prova
 */
export interface VerifyProofOptions {
  /** Verifica on-chain (default: false) */
  onChain?: boolean;
  /** Timeout per la verifica in millisecondi */
  timeout?: number;
}

/**
 * Risultato della verifica di una prova
 */
export interface VerifyProofResult {
  /** Indica se la prova è valida */
  isValid: boolean;
  /** Messaggio di errore (se presente) */
  errorMessage?: string;
  /** Dettagli della verifica */
  details?: {
    /** Timestamp della verifica */
    verifiedAt: number;
    /** Indirizzo del verificatore (se on-chain) */
    verifier?: string;
    /** Firma della verifica (se on-chain) */
    signature?: string;
  };
}

/**
 * Gestore delle prove crittografiche
 */
export class ProofManager {
  private client: Layer2Client;

  /**
   * Crea una nuova istanza del ProofManager
   * @param client Client Layer 2
   */
  constructor(client: Layer2Client) {
    this.client = client;
  }

  /**
   * Genera una prova di Merkle per una transazione in un batch
   * @param batchId ID del batch
   * @param transactionId ID della transazione
   * @returns Promise che si risolve con la prova di Merkle
   */
  public async generateMerkleProof(batchId: string, transactionId: string): Promise<Proof> {
    try {
      // Chiamata all'API del Layer 2 per generare la prova di Merkle
      const response = await fetch(
        `${this.client.getConfig().rpcUrl}/proof/merkle?batchId=${batchId}&transactionId=${transactionId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Layer2Error(
          `Errore nella generazione della prova di Merkle: ${response.statusText}`,
          ErrorCode.PROOF_GENERATION_FAILED
        );
      }

      const data = await response.json();
      return {
        type: ProofType.MERKLE,
        data: data.proof,
        metadata: data.metadata
      };
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nella generazione della prova di Merkle: ${error.message}`,
        ErrorCode.PROOF_GENERATION_FAILED
      );
    }
  }

  /**
   * Genera una prova di transizione di stato
   * @param fromStateRoot Hash del root di stato iniziale
   * @param toStateRoot Hash del root di stato finale
   * @param transactionIds Array di ID delle transazioni che causano la transizione
   * @returns Promise che si risolve con la prova di transizione di stato
   */
  public async generateStateTransitionProof(
    fromStateRoot: string,
    toStateRoot: string,
    transactionIds: string[]
  ): Promise<Proof> {
    try {
      // Chiamata all'API del Layer 2 per generare la prova di transizione di stato
      const response = await fetch(
        `${this.client.getConfig().rpcUrl}/proof/state-transition`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fromStateRoot,
            toStateRoot,
            transactionIds
          }),
        }
      );

      if (!response.ok) {
        throw new Layer2Error(
          `Errore nella generazione della prova di transizione di stato: ${response.statusText}`,
          ErrorCode.PROOF_GENERATION_FAILED
        );
      }

      const data = await response.json();
      return {
        type: ProofType.STATE_TRANSITION,
        data: data.proof,
        metadata: data.metadata
      };
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nella generazione della prova di transizione di stato: ${error.message}`,
        ErrorCode.PROOF_GENERATION_FAILED
      );
    }
  }

  /**
   * Genera una prova di inclusione per una transazione
   * @param transactionId ID della transazione
   * @returns Promise che si risolve con la prova di inclusione
   */
  public async generateInclusionProof(transactionId: string): Promise<Proof> {
    try {
      // Chiamata all'API del Layer 2 per generare la prova di inclusione
      const response = await fetch(
        `${this.client.getConfig().rpcUrl}/proof/inclusion?transactionId=${transactionId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Layer2Error(
          `Errore nella generazione della prova di inclusione: ${response.statusText}`,
          ErrorCode.PROOF_GENERATION_FAILED
        );
      }

      const data = await response.json();
      return {
        type: ProofType.INCLUSION,
        data: data.proof,
        metadata: data.metadata
      };
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nella generazione della prova di inclusione: ${error.message}`,
        ErrorCode.PROOF_GENERATION_FAILED
      );
    }
  }

  /**
   * Genera una prova di validità per una transazione
   * @param transactionId ID della transazione
   * @returns Promise che si risolve con la prova di validità
   */
  public async generateValidityProof(transactionId: string): Promise<Proof> {
    try {
      // Chiamata all'API del Layer 2 per generare la prova di validità
      const response = await fetch(
        `${this.client.getConfig().rpcUrl}/proof/validity?transactionId=${transactionId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Layer2Error(
          `Errore nella generazione della prova di validità: ${response.statusText}`,
          ErrorCode.PROOF_GENERATION_FAILED
        );
      }

      const data = await response.json();
      return {
        type: ProofType.VALIDITY,
        data: data.proof,
        metadata: data.metadata
      };
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nella generazione della prova di validità: ${error.message}`,
        ErrorCode.PROOF_GENERATION_FAILED
      );
    }
  }

  /**
   * Verifica una prova
   * @param proof Prova da verificare
   * @param options Opzioni per la verifica
   * @returns Promise che si risolve con il risultato della verifica
   */
  public async verifyProof(proof: Proof, options: VerifyProofOptions = {}): Promise<VerifyProofResult> {
    try {
      const defaultOptions: VerifyProofOptions = {
        onChain: false,
        timeout: 30000
      };
      
      const mergedOptions = { ...defaultOptions, ...options };
      
      // Chiamata all'API del Layer 2 per verificare la prova
      const response = await fetch(
        `${this.client.getConfig().rpcUrl}/proof/verify`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            proof,
            options: mergedOptions
          }),
        }
      );

      if (!response.ok) {
        throw new Layer2Error(
          `Errore nella verifica della prova: ${response.statusText}`,
          ErrorCode.PROOF_VERIFICATION_FAILED
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Layer2Error) {
        throw error;
      }
      throw new Layer2Error(
        `Errore nella verifica della prova: ${error.message}`,
        ErrorCode.PROOF_VERIFICATION_FAILED
      );
    }
  }

  /**
   * Verifica una prova on-chain
   * @param proof Prova da verificare
   * @param options Opzioni per la verifica
   * @returns Promise che si risolve con il risultato della verifica
   */
  public async verifyProofOnChain(proof: Proof, options: VerifyProofOptions = {}): Promise<VerifyProofResult> {
    return this.verifyProof(proof, { ...options, onChain: true });
  }

  /**
   * Serializza una prova in formato stringa
   * @param proof Prova da serializzare
   * @returns Prova serializzata
   */
  public serializeProof(proof: Proof): string {
    return JSON.stringify(proof);
  }

  /**
   * Deserializza una prova da formato stringa
   * @param serializedProof Prova serializzata
   * @returns Prova deserializzata
   */
  public deserializeProof(serializedProof: string): Proof {
    try {
      return JSON.parse(serializedProof);
    } catch (error) {
      throw new Layer2Error(
        `Errore nella deserializzazione della prova: ${error.message}`,
        ErrorCode.PROOF_DESERIALIZATION_FAILED
      );
    }
  }
}
