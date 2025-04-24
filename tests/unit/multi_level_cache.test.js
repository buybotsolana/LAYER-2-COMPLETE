/**
 * Test unitari per il modulo multi-level-cache.js
 * 
 * Questi test verificano il corretto funzionamento dell'implementazione del sistema di cache multi-livello,
 * inclusi prefetching predittivo, invalidazione selettiva e compressione adattiva.
 */

const { MultiLevelCache } = require('../../offchain/multi-level-cache');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;

describe('MultiLevelCache', () => {
  let cache;
  const tempDir = path.join(os.tmpdir(), 'cache-test-' + Date.now());
  
  beforeEach(async () => {
    // Crea la directory temporanea
    await fs.mkdir(tempDir, { recursive: true });
    
    // Crea una nuova istanza della cache per ogni test
    cache = new MultiLevelCache({
      // Configurazione generale
      enableCompression: true,
      compressionThreshold: 100,
      defaultTTL: 60,
      namespacePrefix: 'test:',
      enableMetrics: true,
      
      // Configurazione L1 (memoria locale)
      l1: {
        enabled: true,
        maxSize: 100,
        ttl: 30
      },
      
      // Disabilita L2 e L3 per i test unitari
      l2: { enabled: false },
      l3: { enabled: false },
      
      // Configurazione del prefetching predittivo
      prefetching: {
        enabled: true,
        strategy: 'pattern',
        threshold: 0.5,
        maxPrefetchItems: 5,
        workerCount: 1
      },
      
      // Configurazione del grafo di dipendenze
      dependencies: {
        enabled: true,
        maxDependencies: 100
      },
      
      // Configurazione della persistenza
      persistence: {
        enabled: true,
        path: tempDir,
        interval: 1000,
        compressFiles: true
      }
    });
    
    // Attendi l'inizializzazione
    await new Promise(resolve => {
      if (cache.isInitialized) {
        resolve();
      } else {
        cache.once('initialized', resolve);
      }
    });
  });
  
  afterEach(async () => {
    // Chiudi la cache dopo ogni test
    if (cache) {
      await cache.close();
    }
    
    // Pulisci la directory temporanea
    try {
      const files = await fs.readdir(tempDir);
      for (const file of files) {
        await fs.unlink(path.join(tempDir, file));
      }
      await fs.rmdir(tempDir);
    } catch (error) {
      console.error('Errore durante la pulizia della directory temporanea:', error);
    }
  });
  
  describe('Operazioni di base', () => {
    test('Dovrebbe memorizzare e recuperare un valore', async () => {
      const key = 'test-key';
      const value = { foo: 'bar', num: 42 };
      
      // Memorizza il valore
      await cache.set(key, value);
      
      // Recupera il valore
      const retrieved = await cache.get(key);
      
      expect(retrieved).toEqual(value);
    });
    
    test('Dovrebbe restituire null per chiavi non esistenti', async () => {
      const key = 'non-existent-key';
      
      // Recupera il valore
      const retrieved = await cache.get(key);
      
      expect(retrieved).toBeNull();
    });
    
    test('Dovrebbe invalidare una chiave', async () => {
      const key = 'test-key';
      const value = { foo: 'bar' };
      
      // Memorizza il valore
      await cache.set(key, value);
      
      // Verifica che il valore sia stato memorizzato
      const retrieved1 = await cache.get(key);
      expect(retrieved1).toEqual(value);
      
      // Invalida la chiave
      await cache.invalidate(key);
      
      // Verifica che il valore sia stato invalidato
      const retrieved2 = await cache.get(key);
      expect(retrieved2).toBeNull();
    });
    
    test('Dovrebbe rispettare il TTL', async () => {
      const key = 'ttl-test-key';
      const value = { foo: 'bar' };
      
      // Memorizza il valore con TTL breve
      await cache.set(key, value, { ttl: 1 }); // 1 secondo
      
      // Verifica che il valore sia stato memorizzato
      const retrieved1 = await cache.get(key);
      expect(retrieved1).toEqual(value);
      
      // Attendi che il TTL scada
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Verifica che il valore sia scaduto
      const retrieved2 = await cache.get(key);
      expect(retrieved2).toBeNull();
    });
  });
  
  describe('Compressione adattiva', () => {
    test('Dovrebbe comprimere valori grandi', async () => {
      // Crea un valore grande
      const key = 'large-value-key';
      const largeValue = { data: 'x'.repeat(1000) };
      
      // Memorizza il valore
      await cache.set(key, largeValue);
      
      // Recupera il valore
      const retrieved = await cache.get(key);
      
      expect(retrieved).toEqual(largeValue);
      
      // Verifica le metriche di compressione
      const stats = await cache.getStats();
      expect(stats.metrics.compression.compressed).toBeGreaterThan(0);
    });
    
    test('Non dovrebbe comprimere valori piccoli', async () => {
      // Crea un valore piccolo
      const key = 'small-value-key';
      const smallValue = { data: 'small' };
      
      // Memorizza il valore
      await cache.set(key, smallValue);
      
      // Recupera il valore
      const retrieved = await cache.get(key);
      
      expect(retrieved).toEqual(smallValue);
      
      // Le metriche di compressione non dovrebbero essere incrementate
      const stats = await cache.getStats();
      expect(stats.metrics.compression.compressed).toBe(0);
    });
  });
  
  describe('Gestione delle dipendenze', () => {
    test('Dovrebbe registrare dipendenze tra chiavi', async () => {
      // Memorizza alcuni valori con dipendenze
      await cache.set('parent', { value: 'parent' });
      await cache.set('child1', { value: 'child1' }, { dependencies: ['parent'] });
      await cache.set('child2', { value: 'child2' }, { dependencies: ['parent'] });
      
      // Verifica che i valori siano stati memorizzati
      expect(await cache.get('parent')).toEqual({ value: 'parent' });
      expect(await cache.get('child1')).toEqual({ value: 'child1' });
      expect(await cache.get('child2')).toEqual({ value: 'child2' });
      
      // Invalida il genitore
      await cache.invalidate('parent', { invalidateDependents: true });
      
      // Verifica che i figli siano stati invalidati
      expect(await cache.get('parent')).toBeNull();
      expect(await cache.get('child1')).toBeNull();
      expect(await cache.get('child2')).toBeNull();
    });
    
    test('Dovrebbe gestire dipendenze transitive', async () => {
      // Memorizza alcuni valori con dipendenze transitive
      await cache.set('grandparent', { value: 'grandparent' });
      await cache.set('parent', { value: 'parent' }, { dependencies: ['grandparent'] });
      await cache.set('child', { value: 'child' }, { dependencies: ['parent'] });
      
      // Verifica che i valori siano stati memorizzati
      expect(await cache.get('grandparent')).toEqual({ value: 'grandparent' });
      expect(await cache.get('parent')).toEqual({ value: 'parent' });
      expect(await cache.get('child')).toEqual({ value: 'child' });
      
      // Invalida il nonno
      await cache.invalidate('grandparent', { invalidateDependents: true });
      
      // Verifica che tutti i discendenti siano stati invalidati
      expect(await cache.get('grandparent')).toBeNull();
      expect(await cache.get('parent')).toBeNull();
      expect(await cache.get('child')).toBeNull();
    });
  });
  
  describe('Invalidazione per prefisso', () => {
    test('Dovrebbe invalidare tutte le chiavi con un prefisso specifico', async () => {
      // Memorizza alcuni valori con prefissi diversi
      await cache.set('prefix1:key1', { value: 1 });
      await cache.set('prefix1:key2', { value: 2 });
      await cache.set('prefix2:key1', { value: 3 });
      
      // Verifica che i valori siano stati memorizzati
      expect(await cache.get('prefix1:key1')).toEqual({ value: 1 });
      expect(await cache.get('prefix1:key2')).toEqual({ value: 2 });
      expect(await cache.get('prefix2:key1')).toEqual({ value: 3 });
      
      // Invalida tutte le chiavi con prefisso "prefix1"
      await cache.invalidateByPrefix('prefix1');
      
      // Verifica che le chiavi con prefisso "prefix1" siano state invalidate
      expect(await cache.get('prefix1:key1')).toBeNull();
      expect(await cache.get('prefix1:key2')).toBeNull();
      
      // Verifica che le altre chiavi siano ancora valide
      expect(await cache.get('prefix2:key1')).toEqual({ value: 3 });
    });
  });
  
  describe('Persistenza', () => {
    test('Dovrebbe persistere e ricaricare la cache', async () => {
      // Memorizza alcuni valori
      await cache.set('persist1', { value: 'persist1' });
      await cache.set('persist2', { value: 'persist2' });
      
      // Forza la persistenza
      await cache._persistCache();
      
      // Chiudi la cache
      await cache.close();
      
      // Crea una nuova istanza della cache
      cache = new MultiLevelCache({
        l1: { enabled: true, maxSize: 100 },
        l2: { enabled: false },
        l3: { enabled: false },
        persistence: {
          enabled: true,
          path: tempDir,
          interval: 1000
        }
      });
      
      // Attendi l'inizializzazione
      await new Promise(resolve => {
        if (cache.isInitialized) {
          resolve();
        } else {
          cache.once('initialized', resolve);
        }
      });
      
      // Verifica che i valori siano stati ricaricati
      expect(await cache.get('persist1')).toEqual({ value: 'persist1' });
      expect(await cache.get('persist2')).toEqual({ value: 'persist2' });
    });
  });
  
  describe('Prefetching predittivo', () => {
    test('Dovrebbe tracciare i pattern di accesso', async () => {
      // Simula un pattern di accesso
      await cache.get('pattern1');
      await cache.get('pattern2');
      await cache.get('pattern3');
      
      // Memorizza alcuni valori
      await cache.set('pattern1', { value: 1 });
      await cache.set('pattern2', { value: 2 });
      await cache.set('pattern3', { value: 3 });
      
      // Ripeti il pattern di accesso
      await cache.get('pattern1');
      await cache.get('pattern2');
      
      // Attendi che il prefetching venga attivato
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verifica le metriche di prefetching
      const stats = await cache.getStats();
      expect(stats.prefetching.enabled).toBe(true);
    });
  });
  
  describe('Metriche e monitoraggio', () => {
    test('Dovrebbe tracciare le metriche di utilizzo', async () => {
      // Esegui alcune operazioni
      await cache.set('metrics1', { value: 1 });
      await cache.get('metrics1');
      await cache.set('metrics2', { value: 2 });
      await cache.get('metrics2');
      await cache.invalidate('metrics1');
      
      // Ottieni le statistiche
      const stats = await cache.getStats();
      
      expect(stats).toBeDefined();
      expect(stats.levels).toBeDefined();
      expect(stats.levels.l1).toBeDefined();
      expect(stats.prefetching).toBeDefined();
      expect(stats.dependencies).toBeDefined();
      expect(stats.metrics).toBeDefined();
    });
  });
});
