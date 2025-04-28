/**
 * @fileoverview Utilità per la serializzazione e deserializzazione dei dati
 */

import * as bs58 from 'bs58';
import { Layer2Error, ErrorCode } from '../types/errors';

/**
 * Serializza un oggetto in una stringa
 * @param data Oggetto da serializzare
 * @returns Stringa serializzata
 */
export function serializeData(data: any): string {
  try {
    // Converti l'oggetto in JSON
    const jsonString = JSON.stringify(data);
    
    // Converti la stringa JSON in un Buffer
    const buffer = Buffer.from(jsonString, 'utf-8');
    
    // Codifica il Buffer in base58
    return bs58.encode(buffer);
  } catch (error) {
    throw new Layer2Error(
      `Errore durante la serializzazione dei dati: ${error.message}`,
      ErrorCode.SERIALIZATION_FAILED
    );
  }
}

/**
 * Deserializza una stringa in un oggetto
 * @param serializedData Stringa serializzata
 * @returns Oggetto deserializzato
 */
export function deserializeData<T = any>(serializedData: string): T {
  try {
    // Decodifica la stringa base58 in un Buffer
    const buffer = bs58.decode(serializedData);
    
    // Converti il Buffer in una stringa JSON
    const jsonString = buffer.toString('utf-8');
    
    // Converti la stringa JSON in un oggetto
    return JSON.parse(jsonString);
  } catch (error) {
    throw new Layer2Error(
      `Errore durante la deserializzazione dei dati: ${error.message}`,
      ErrorCode.DESERIALIZATION_FAILED
    );
  }
}

/**
 * Serializza un oggetto in un formato compatto per l'invio su blockchain
 * @param data Oggetto da serializzare
 * @returns Stringa serializzata in formato compatto
 */
export function serializeCompact(data: any): string {
  try {
    // Rimuovi le proprietà nulle o undefined
    const cleanData = Object.entries(data).reduce((acc, [key, value]) => {
      if (value !== null && value !== undefined) {
        acc[key] = value;
      }
      return acc;
    }, {} as Record<string, any>);
    
    // Converti l'oggetto in JSON
    const jsonString = JSON.stringify(cleanData);
    
    // Converti la stringa JSON in un Buffer
    const buffer = Buffer.from(jsonString, 'utf-8');
    
    // Codifica il Buffer in base58
    return bs58.encode(buffer);
  } catch (error) {
    throw new Layer2Error(
      `Errore durante la serializzazione compatta dei dati: ${error.message}`,
      ErrorCode.COMPACT_SERIALIZATION_FAILED
    );
  }
}

/**
 * Deserializza una stringa in formato compatto in un oggetto
 * @param serializedData Stringa serializzata in formato compatto
 * @returns Oggetto deserializzato
 */
export function deserializeCompact<T = any>(serializedData: string): T {
  try {
    // Decodifica la stringa base58 in un Buffer
    const buffer = bs58.decode(serializedData);
    
    // Converti il Buffer in una stringa JSON
    const jsonString = buffer.toString('utf-8');
    
    // Converti la stringa JSON in un oggetto
    return JSON.parse(jsonString);
  } catch (error) {
    throw new Layer2Error(
      `Errore durante la deserializzazione compatta dei dati: ${error.message}`,
      ErrorCode.COMPACT_DESERIALIZATION_FAILED
    );
  }
}

/**
 * Serializza un array di oggetti in una stringa
 * @param dataArray Array di oggetti da serializzare
 * @returns Stringa serializzata
 */
export function serializeArray(dataArray: any[]): string {
  try {
    // Converti l'array in JSON
    const jsonString = JSON.stringify(dataArray);
    
    // Converti la stringa JSON in un Buffer
    const buffer = Buffer.from(jsonString, 'utf-8');
    
    // Codifica il Buffer in base58
    return bs58.encode(buffer);
  } catch (error) {
    throw new Layer2Error(
      `Errore durante la serializzazione dell'array: ${error.message}`,
      ErrorCode.ARRAY_SERIALIZATION_FAILED
    );
  }
}

/**
 * Deserializza una stringa in un array di oggetti
 * @param serializedData Stringa serializzata
 * @returns Array di oggetti deserializzati
 */
export function deserializeArray<T = any>(serializedData: string): T[] {
  try {
    // Decodifica la stringa base58 in un Buffer
    const buffer = bs58.decode(serializedData);
    
    // Converti il Buffer in una stringa JSON
    const jsonString = buffer.toString('utf-8');
    
    // Converti la stringa JSON in un array di oggetti
    return JSON.parse(jsonString);
  } catch (error) {
    throw new Layer2Error(
      `Errore durante la deserializzazione dell'array: ${error.message}`,
      ErrorCode.ARRAY_DESERIALIZATION_FAILED
    );
  }
}
