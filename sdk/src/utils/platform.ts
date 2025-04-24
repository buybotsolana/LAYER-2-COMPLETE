/**
 * @fileoverview Modulo per garantire la compatibilità cross-platform dell'SDK Layer 2 di Solana
 */

// Importazioni necessarie
import { Buffer } from 'buffer';

/**
 * Determina se l'ambiente di esecuzione è un browser
 * @returns true se l'ambiente è un browser, false altrimenti
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.document !== 'undefined';
}

/**
 * Determina se l'ambiente di esecuzione è Node.js
 * @returns true se l'ambiente è Node.js, false altrimenti
 */
export function isNode(): boolean {
  return typeof process !== 'undefined' && 
         process.versions != null && 
         process.versions.node != null;
}

/**
 * Polyfill per fetch API in ambiente Node.js
 * @returns Una funzione fetch compatibile con l'ambiente corrente
 */
export function getFetch(): typeof fetch {
  if (isBrowser()) {
    return window.fetch.bind(window);
  }
  
  if (isNode()) {
    try {
      // In Node.js, utilizziamo node-fetch o il fetch nativo se disponibile
      if (typeof global.fetch === 'function') {
        return global.fetch;
      } else {
        // Se non è disponibile, dobbiamo importarlo dinamicamente
        // Nota: questo richiede che node-fetch sia installato come dipendenza
        const nodeFetch = require('node-fetch');
        return nodeFetch;
      }
    } catch (error) {
      throw new Error('node-fetch non è installato. Installalo con: npm install node-fetch');
    }
  }
  
  throw new Error('Ambiente non supportato: né browser né Node.js');
}

/**
 * Ottiene un'implementazione di localStorage compatibile con l'ambiente corrente
 * @returns Un oggetto compatibile con l'API localStorage
 */
export function getLocalStorage(): Storage {
  if (isBrowser()) {
    return window.localStorage;
  }
  
  if (isNode()) {
    // Implementazione di localStorage per Node.js
    const nodeLocalStorage: Storage = {
      _data: new Map<string, string>(),
      
      getItem(key: string): string | null {
        return this._data.has(key) ? this._data.get(key) || null : null;
      },
      
      setItem(key: string, value: string): void {
        this._data.set(key, value);
      },
      
      removeItem(key: string): void {
        this._data.delete(key);
      },
      
      clear(): void {
        this._data.clear();
      },
      
      key(index: number): string | null {
        const keys = Array.from(this._data.keys());
        return index >= 0 && index < keys.length ? keys[index] : null;
      },
      
      get length(): number {
        return this._data.size;
      }
    };
    
    return nodeLocalStorage;
  }
  
  throw new Error('Ambiente non supportato: né browser né Node.js');
}

/**
 * Ottiene un'implementazione di WebSocket compatibile con l'ambiente corrente
 * @returns Una classe WebSocket compatibile con l'ambiente corrente
 */
export function getWebSocket(): typeof WebSocket {
  if (isBrowser()) {
    return WebSocket;
  }
  
  if (isNode()) {
    try {
      // In Node.js, utilizziamo ws
      const WebSocketNode = require('ws');
      return WebSocketNode;
    } catch (error) {
      throw new Error('ws non è installato. Installalo con: npm install ws');
    }
  }
  
  throw new Error('Ambiente non supportato: né browser né Node.js');
}

/**
 * Ottiene un'implementazione di crypto compatibile con l'ambiente corrente
 * @returns Un oggetto con funzionalità crittografiche compatibili con l'ambiente corrente
 */
export function getCrypto(): any {
  if (isBrowser()) {
    if (window.crypto) {
      return window.crypto;
    }
    throw new Error('Web Crypto API non supportata in questo browser');
  }
  
  if (isNode()) {
    try {
      return require('crypto');
    } catch (error) {
      throw new Error('Modulo crypto non disponibile in Node.js');
    }
  }
  
  throw new Error('Ambiente non supportato: né browser né Node.js');
}

/**
 * Genera un ID univoco compatibile con l'ambiente corrente
 * @returns Una stringa ID univoca
 */
export function generateUniqueId(): string {
  const crypto = getCrypto();
  
  if (isBrowser()) {
    // Utilizziamo Web Crypto API nei browser
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    
    // Convertiamo in formato UUID
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  
  if (isNode()) {
    // Utilizziamo il modulo crypto di Node.js
    return crypto.randomBytes(16).toString('hex');
  }
  
  // Fallback per ambienti non supportati
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * Ottiene un'implementazione di Buffer compatibile con l'ambiente corrente
 * @returns Una classe Buffer compatibile con l'ambiente corrente
 */
export function getBuffer(): typeof Buffer {
  if (isBrowser()) {
    // Nei browser moderni, Buffer è disponibile tramite il polyfill buffer
    return Buffer;
  }
  
  if (isNode()) {
    // In Node.js, Buffer è globale
    return Buffer;
  }
  
  throw new Error('Ambiente non supportato: né browser né Node.js');
}

/**
 * Configura l'ambiente per l'SDK
 * Questa funzione deve essere chiamata all'inizio dell'applicazione
 */
export function setupEnvironment(): void {
  if (isBrowser()) {
    // Configurazione specifica per browser
    // Polyfill per Buffer nei browser più vecchi
    if (typeof window.Buffer === 'undefined') {
      window.Buffer = Buffer;
    }
  }
  
  if (isNode()) {
    // Configurazione specifica per Node.js
    // Nessuna configurazione aggiuntiva necessaria per ora
  }
}
