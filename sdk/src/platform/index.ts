/**
 * @fileoverview Entry point per la compatibilità cross-platform dell'SDK Layer 2 di Solana
 */

import { Layer2Client, Layer2ClientConfig } from '../client';
import { BrowserLayer2Client } from './browser';
import { NodeLayer2Client } from './node';
import { isBrowser, isNode } from '../utils/platform';

/**
 * Configurazione per la creazione di un client cross-platform
 */
export interface CrossPlatformConfig {
  /** Configurazione base del client Layer 2 */
  clientConfig: Layer2ClientConfig;
  /** Configurazione specifica per browser (opzionale) */
  browserConfig?: any;
  /** Configurazione specifica per Node.js (opzionale) */
  nodeConfig?: any;
}

/**
 * Crea un client Layer 2 appropriato per l'ambiente corrente
 * @param config Configurazione per la creazione del client
 * @returns Un client Layer 2 compatibile con l'ambiente corrente
 */
export function createPlatformClient(config: CrossPlatformConfig): Layer2Client {
  if (isBrowser()) {
    return new BrowserLayer2Client(config.clientConfig, config.browserConfig);
  } else if (isNode()) {
    return new NodeLayer2Client(config.clientConfig, config.nodeConfig);
  } else {
    // Fallback al client base
    console.warn('Ambiente non riconosciuto, utilizzo del client base');
    return new Layer2Client(config.clientConfig);
  }
}

// Esporta tutte le classi e le funzioni
export {
  BrowserLayer2Client,
  NodeLayer2Client
};
