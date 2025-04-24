/**
 * Unit tests per il Multi-level Cache System
 * 
 * Questo file contiene i test unitari per il componente Multi-level Cache System
 * dell'architettura ad alte prestazioni del Layer-2 su Solana.
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { MultiLevelCache, CacheLevel, CacheEntry, PrefetchStrategy } = require('../../offchain/multi-level-cache');

describe('MultiLevelCache', function() {
  // Aumenta il timeout per i test più lunghi
  this.timeout(10000);
  
  let cache;
  let mockLevels;
  let mockPrefetcher;
  
  beforeEach(() => {
    // Crea mock per i livelli di cache
    mockLevels = [
      {
        name: 'L1',
        get: sinon.stub(),
        set: sinon.stub().returns(true),
        has: sinon.stub(),
        delete: sinon.stub().returns(true),
        clear: sinon.stub().returns(true),
        getStats: sinon.stub().returns({
          size: 0,
          capacity: 100,
          hits: 0,
          misses: 0,
          hitRate: 0
        })
      },
      {
        name: 'L2',
        get: sinon.stub(),
        set: sinon.stub().returns(true),
        has: sinon.stub(),
        delete: sinon.stub().returns(true),
        clear: sinon.stub().returns(true),
        getStats: sinon.stub().returns({
          size: 0,
          capacity: 1000,
          hits: 0,
          misses: 0,
          hitRate: 0
        })
      }
    ];
    
    // Configura il comportamento dei mock
    mockLevels[0].has.returns(false);
    mockLevels[0].get.returns(null);
    mockLevels[1].has.returns(false);
    mockLevels[1].get.returns(null);
    
    // Crea mock per il prefetcher
    mockPrefetcher = {
      prefetch: sinon.stub().resolves(),
      registerCache: sinon.stub(),
      getStats: sinon.stub().returns({
        prefetchCount: 0,
        hitCount: 0,
        missCount: 0,
        hitRate: 0
      })
    };
    
    // Crea un'istanza della cache
    cache = new MultiLevelCache({
      levels: mockLevels,
      prefetcher: mockPrefetcher,
      enablePrefetching: true,
      enableCompression: true,
      compressionThreshold: 1024,
      defaultTTL: 3600,
      keyDependencies: new Map(),
      invalidationStrategy: 'cascade'
    });
  });
  
  afterEach(() => {
    // Ripristina i mock
    sinon.restore();
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente la cache', () => {
      expect(cache).to.be.an.instanceOf(MultiLevelCache);
      expect(cache.options.enablePrefetching).to.be.true;
      expect(cache.options.enableCompression).to.be.true;
      expect(cache.options.compressionThreshold).to.equal(1024);
      expect(cache.options.defaultTTL).to.equal(3600);
      expect(cache.options.invalidationStrategy).to.equal('cascade');
      expect(cache.levels).to.have.lengthOf(2);
      expect(cache.prefetcher).to.equal(mockPrefetcher);
    });
    
    it('dovrebbe usare valori predefiniti se non specificati', () => {
      const defaultCache = new MultiLevelCache({
        levels: mockLevels
      });
      
      expect(defaultCache.options.enablePrefetching).to.be.a('boolean');
      expect(defaultCache.options.enableCompression).to.be.a('boolean');
      expect(defaultCache.options.compressionThreshold).to.be.a('number');
      expect(defaultCache.options.defaultTTL).to.be.a('number');
      expect(defaultCache.options.invalidationStrategy).to.be.a('string');
    });
    
    it('dovrebbe lanciare un errore se non vengono forniti livelli', () => {
      expect(() => new MultiLevelCache({})).to.throw(/levels/);
    });
    
    it('dovrebbe registrare la cache con il prefetcher', () => {
      expect(mockPrefetcher.registerCache.calledOnce).to.be.true;
      expect(mockPrefetcher.registerCache.calledWith(cache)).to.be.true;
    });
  });
  
  describe('Operazioni di base', () => {
    it('dovrebbe impostare un valore nella cache', async () => {
      const key = 'test-key';
      const value = { data: 'test-value' };
      
      await cache.set(key, value);
      
      // Verifica che il valore sia stato impostato nel livello L1
      expect(mockLevels[0].set.calledOnce).to.be.true;
      expect(mockLevels[0].set.firstCall.args[0]).to.equal(key);
      expect(mockLevels[0].set.firstCall.args[1]).to.deep.include({ data: 'test-value' });
    });
    
    it('dovrebbe ottenere un valore dalla cache (hit L1)', async () => {
      const key = 'test-key';
      const value = { data: 'test-value' };
      
      // Simula un hit nel livello L1
      mockLevels[0].has.withArgs(key).returns(true);
      mockLevels[0].get.withArgs(key).returns(new CacheEntry(value));
      
      const result = await cache.get(key);
      
      expect(result).to.deep.equal(value);
      expect(mockLevels[0].has.calledWith(key)).to.be.true;
      expect(mockLevels[0].get.calledWith(key)).to.be.true;
      expect(mockLevels[1].has.called).to.be.false;
    });
    
    it('dovrebbe ottenere un valore dalla cache (hit L2, promozione a L1)', async () => {
      const key = 'test-key';
      const value = { data: 'test-value' };
      
      // Simula un miss nel livello L1 e un hit nel livello L2
      mockLevels[0].has.withArgs(key).returns(false);
      mockLevels[1].has.withArgs(key).returns(true);
      mockLevels[1].get.withArgs(key).returns(new CacheEntry(value));
      
      const result = await cache.get(key);
      
      expect(result).to.deep.equal(value);
      expect(mockLevels[0].has.calledWith(key)).to.be.true;
      expect(mockLevels[1].has.calledWith(key)).to.be.true;
      expect(mockLevels[1].get.calledWith(key)).to.be.true;
      
      // Verifica che il valore sia stato promosso al livello L1
      expect(mockLevels[0].set.calledOnce).to.be.true;
      expect(mockLevels[0].set.firstCall.args[0]).to.equal(key);
      expect(mockLevels[0].set.firstCall.args[1]).to.be.an.instanceOf(CacheEntry);
    });
    
    it('dovrebbe restituire null se il valore non è presente in nessun livello', async () => {
      const key = 'nonexistent-key';
      
      // Simula un miss in tutti i livelli
      mockLevels[0].has.withArgs(key).returns(false);
      mockLevels[1].has.withArgs(key).returns(false);
      
      const result = await cache.get(key);
      
      expect(result).to.be.null;
      expect(mockLevels[0].has.calledWith(key)).to.be.true;
      expect(mockLevels[1].has.calledWith(key)).to.be.true;
    });
    
    it('dovrebbe verificare se un valore è presente nella cache', async () => {
      const key = 'test-key';
      
      // Simula un hit nel livello L1
      mockLevels[0].has.withArgs(key).returns(true);
      
      const result = await cache.has(key);
      
      expect(result).to.be.true;
      expect(mockLevels[0].has.calledWith(key)).to.be.true;
      expect(mockLevels[1].has.called).to.be.false;
    });
    
    it('dovrebbe eliminare un valore dalla cache', async () => {
      const key = 'test-key';
      
      await cache.delete(key);
      
      // Verifica che il valore sia stato eliminato da tutti i livelli
      expect(mockLevels[0].delete.calledWith(key)).to.be.true;
      expect(mockLevels[1].delete.calledWith(key)).to.be.true;
    });
    
    it('dovrebbe svuotare la cache', async () => {
      await cache.clear();
      
      // Verifica che tutti i livelli siano stati svuotati
      expect(mockLevels[0].clear.calledOnce).to.be.true;
      expect(mockLevels[1].clear.calledOnce).to.be.true;
    });
  });
  
  describe('Prefetching', () => {
    it('dovrebbe attivare il prefetching quando abilitato', async () => {
      const key = 'test-key';
      const value = { data: 'test-value' };
      
      // Simula un hit nel livello L1
      mockLevels[0].has.withArgs(key).returns(true);
      mockLevels[0].get.withArgs(key).returns(new CacheEntry(value));
      
      await cache.get(key);
      
      // Verifica che il prefetcher sia stato chiamato
      expect(mockPrefetcher.prefetch.calledOnce).to.be.true;
      expect(mockPrefetcher.prefetch.firstCall.args[0]).to.equal(key);
    });
    
    it('non dovrebbe attivare il prefetching quando disabilitato', async () => {
      // Disabilita il prefetching
      cache.options.enablePrefetching = false;
      
      const key = 'test-key';
      const value = { data: 'test-value' };
      
      // Simula un hit nel livello L1
      mockLevels[0].has.withArgs(key).returns(true);
      mockLevels[0].get.withArgs(key).returns(new CacheEntry(value));
      
      await cache.get(key);
      
      // Verifica che il prefetcher non sia stato chiamato
      expect(mockPrefetcher.prefetch.called).to.be.false;
    });
  });
  
  describe('Compressione', () => {
    it('dovrebbe comprimere i valori grandi', async () => {
      // Spia il metodo di compressione
      const compressSpy = sinon.spy(cache, 'compressValue');
      
      const key = 'test-key';
      const value = { data: 'x'.repeat(2000) }; // Valore grande
      
      await cache.set(key, value);
      
      // Verifica che il valore sia stato compresso
      expect(compressSpy.calledOnce).to.be.true;
      expect(compressSpy.firstCall.args[0]).to.deep.equal(value);
    });
    
    it('non dovrebbe comprimere i valori piccoli', async () => {
      // Spia il metodo di compressione
      const compressSpy = sinon.spy(cache, 'compressValue');
      
      const key = 'test-key';
      const value = { data: 'small-value' }; // Valore piccolo
      
      await cache.set(key, value);
      
      // Verifica che il valore non sia stato compresso
      expect(compressSpy.called).to.be.false;
    });
    
    it('dovrebbe decomprimere i valori compressi', async () => {
      // Spia il metodo di decompressione
      const decompressSpy = sinon.spy(cache, 'decompressValue');
      
      const key = 'test-key';
      const value = { data: 'test-value', _compressed: true };
      
      // Simula un hit nel livello L1 con un valore compresso
      mockLevels[0].has.withArgs(key).returns(true);
      mockLevels[0].get.withArgs(key).returns(new CacheEntry(value));
      
      await cache.get(key);
      
      // Verifica che il valore sia stato decompresso
      expect(decompressSpy.calledOnce).to.be.true;
      expect(decompressSpy.firstCall.args[0]).to.deep.equal(value);
    });
  });
  
  describe('Gestione delle dipendenze', () => {
    it('dovrebbe registrare una dipendenza tra chiavi', async () => {
      const key = 'parent-key';
      const dependentKey = 'dependent-key';
      
      cache.addDependency(key, dependentKey);
      
      // Verifica che la dipendenza sia stata registrata
      expect(cache.keyDependencies.has(key)).to.be.true;
      expect(cache.keyDependencies.get(key)).to.include(dependentKey);
    });
    
    it('dovrebbe invalidare le chiavi dipendenti (strategia cascade)', async () => {
      const key = 'parent-key';
      const dependentKey = 'dependent-key';
      
      // Registra la dipendenza
      cache.addDependency(key, dependentKey);
      
      // Elimina la chiave principale
      await cache.delete(key);
      
      // Verifica che la chiave dipendente sia stata eliminata
      expect(mockLevels[0].delete.calledWith(dependentKey)).to.be.true;
      expect(mockLevels[1].delete.calledWith(dependentKey)).to.be.true;
    });
    
    it('non dovrebbe invalidare le chiavi dipendenti (strategia none)', async () => {
      // Cambia la strategia di invalidazione
      cache.options.invalidationStrategy = 'none';
      
      const key = 'parent-key';
      const dependentKey = 'dependent-key';
      
      // Registra la dipendenza
      cache.addDependency(key, dependentKey);
      
      // Elimina la chiave principale
      await cache.delete(key);
      
      // Verifica che la chiave dipendente non sia stata eliminata
      expect(mockLevels[0].delete.calledWith(dependentKey)).to.be.false;
      expect(mockLevels[1].delete.calledWith(dependentKey)).to.be.false;
    });
  });
  
  describe('Statistiche', () => {
    it('dovrebbe fornire statistiche corrette', () => {
      const stats = cache.getStats();
      
      expect(stats).to.be.an('object');
      expect(stats.levels).to.be.an('array').with.lengthOf(2);
      expect(stats.levels[0].name).to.equal('L1');
      expect(stats.levels[1].name).to.equal('L2');
      expect(stats.prefetcher).to.be.an('object');
      expect(stats.options).to.be.an('object');
    });
  });
});

describe('CacheLevel', function() {
  let level;
  
  beforeEach(() => {
    level = new CacheLevel({
      name: 'TestLevel',
      capacity: 100,
      ttl: 3600,
      evictionPolicy: 'lru'
    });
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente un livello di cache', () => {
      expect(level).to.be.an.instanceOf(CacheLevel);
      expect(level.name).to.equal('TestLevel');
      expect(level.capacity).to.equal(100);
      expect(level.ttl).to.equal(3600);
      expect(level.evictionPolicy).to.equal('lru');
      expect(level.size).to.equal(0);
      expect(level.hits).to.equal(0);
      expect(level.misses).to.equal(0);
    });
    
    it('dovrebbe usare valori predefiniti se non specificati', () => {
      const defaultLevel = new CacheLevel({
        name: 'DefaultLevel'
      });
      
      expect(defaultLevel.name).to.equal('DefaultLevel');
      expect(defaultLevel.capacity).to.be.a('number');
      expect(defaultLevel.ttl).to.be.a('number');
      expect(defaultLevel.evictionPolicy).to.be.a('string');
    });
  });
  
  describe('Operazioni di base', () => {
    it('dovrebbe impostare e ottenere un valore', () => {
      const key = 'test-key';
      const value = { data: 'test-value' };
      
      level.set(key, value);
      
      expect(level.has(key)).to.be.true;
      expect(level.get(key).value).to.deep.equal(value);
      expect(level.size).to.equal(1);
    });
    
    it('dovrebbe eliminare un valore', () => {
      const key = 'test-key';
      const value = { data: 'test-value' };
      
      level.set(key, value);
      const result = level.delete(key);
      
      expect(result).to.be.true;
      expect(level.has(key)).to.be.false;
      expect(level.size).to.equal(0);
    });
    
    it('dovrebbe svuotare la cache', () => {
      level.set('key1', 'value1');
      level.set('key2', 'value2');
      
      const result = level.clear();
      
      expect(result).to.be.true;
      expect(level.size).to.equal(0);
      expect(level.has('key1')).to.be.false;
      expect(level.has('key2')).to.be.false;
    });
  });
  
  describe('Gestione TTL', () => {
    it('dovrebbe rispettare il TTL predefinito', () => {
      const key = 'test-key';
      const value = { data: 'test-value' };
      
      level.set(key, value);
      
      const entry = level.get(key);
      expect(entry.expiry).to.be.a('number');
      expect(entry.expiry).to.be.greaterThan(Date.now());
    });
    
    it('dovrebbe rispettare il TTL personalizzato', () => {
      const key = 'test-key';
      const value = { data: 'test-value' };
      const ttl = 60; // 60 secondi
      
      level.set(key, value, ttl);
      
      const entry = level.get(key);
      expect(entry.expiry).to.be.a('number');
      expect(entry.expiry).to.be.lessThan(Date.now() + 3600 * 1000);
      expect(entry.expiry).to.be.greaterThan(Date.now() + 59 * 1000);
    });
    
    it('dovrebbe considerare scaduti i valori con TTL passato', () => {
      const key = 'test-key';
      const value = { data: 'test-value' };
      
      // Imposta un valore con TTL già scaduto
      const expiredEntry = new CacheEntry(value);
      expiredEntry.expiry = Date.now() - 1000; // 1 secondo fa
      
      // Inserisci direttamente l'entry nella cache
      level.cache.set(key, expiredEntry);
      
      expect(level.has(key)).to.be.false;
      expect(level.get(key)).to.be.null;
    });
  });
  
  describe('Politiche di evizione', () => {
    it('dovrebbe applicare la politica LRU', () => {
      // Imposta la capacità a 2
      level.capacity = 2;
      
      // Aggiungi 3 elementi
      level.set('key1', 'value1');
      level.set('key2', 'value2');
      
      // Accedi a key1 per aggiornare il suo timestamp di accesso
      level.get('key1');
      
      // Aggiungi un terzo elemento, dovrebbe eliminare key2 (meno recentemente usato)
      level.set('key3', 'value3');
      
      expect(level.has('key1')).to.be.true;
      expect(level.has('key2')).to.be.false;
      expect(level.has('key3')).to.be.true;
    });
    
    it('dovrebbe applicare la politica FIFO', () => {
      // Cambia la politica di evizione
      level.evictionPolicy = 'fifo';
      
      // Imposta la capacità a 2
      level.capacity = 2;
      
      // Aggiungi 3 elementi
      level.set('key1', 'value1');
      level.set('key2', 'value2');
      
      // Accedi a key1 per aggiornare il suo timestamp di accesso (non dovrebbe influire con FIFO)
      level.get('key1');
      
      // Aggiungi un terzo elemento, dovrebbe eliminare key1 (primo inserito)
      level.set('key3', 'value3');
      
      expect(level.has('key1')).to.be.false;
      expect(level.has('key2')).to.be.true;
      expect(level.has('key3')).to.be.true;
    });
  });
  
  describe('Statistiche', () => {
    it('dovrebbe tracciare hit e miss', () => {
      const key = 'test-key';
      const value = { data: 'test-value' };
      
      level.set(key, value);
      
      // Hit
      level.get(key);
      
      // Miss
      level.get('nonexistent-key');
      
      expect(level.hits).to.equal(1);
      expect(level.misses).to.equal(1);
      expect(level.hitRate).to.equal(0.5);
    });
    
    it('dovrebbe fornire statistiche corrette', () => {
      const key = 'test-key';
      const value = { data: 'test-value' };
      
      level.set(key, value);
      level.get(key);
      
      const stats = level.getStats();
      
      expect(stats).to.be.an('object');
      expect(stats.name).to.equal('TestLevel');
      expect(stats.size).to.equal(1);
      expect(stats.capacity).to.equal(100);
      expect(stats.hits).to.equal(1);
      expect(stats.misses).to.equal(0);
      expect(stats.hitRate).to.equal(1);
    });
  });
});

describe('PrefetchStrategy', function() {
  let strategy;
  let mockCache;
  
  beforeEach(() => {
    // Crea un mock della cache
    mockCache = {
      get: sinon.stub().resolves({ data: 'test-value' }),
      set: sinon.stub().resolves(true),
      has: sinon.stub().resolves(false),
      getKeyDependencies: sinon.stub().returns([])
    };
    
    // Crea un'istanza della strategia di prefetching
    strategy = new PrefetchStrategy({
      type: 'predictive',
      maxPrefetchCount: 10,
      prefetchThreshold: 0.5,
      accessPatterns: new Map(),
      cache: mockCache
    });
  });
  
  afterEach(() => {
    // Ripristina i mock
    sinon.restore();
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente una strategia di prefetching', () => {
      expect(strategy).to.be.an.instanceOf(PrefetchStrategy);
      expect(strategy.type).to.equal('predictive');
      expect(strategy.maxPrefetchCount).to.equal(10);
      expect(strategy.prefetchThreshold).to.equal(0.5);
      expect(strategy.accessPatterns).to.be.an.instanceOf(Map);
      expect(strategy.cache).to.equal(mockCache);
      expect(strategy.prefetchCount).to.equal(0);
      expect(strategy.hitCount).to.equal(0);
      expect(strategy.missCount).to.equal(0);
    });
    
    it('dovrebbe usare valori predefiniti se non specificati', () => {
      const defaultStrategy = new PrefetchStrategy({
        cache: mockCache
      });
      
      expect(defaultStrategy.type).to.be.a('string');
      expect(defaultStrategy.maxPrefetchCount).to.be.a('number');
      expect(defaultStrategy.prefetchThreshold).to.be.a('number');
      expect(defaultStrategy.accessPatterns).to.be.an.instanceOf(Map);
      expect(defaultStrategy.cache).to.equal(mockCache);
    });
  });
  
  describe('Registrazione degli accessi', () => {
    it('dovrebbe registrare un pattern di accesso', () => {
      const key1 = 'key1';
      const key2 = 'key2';
      
      // Registra una sequenza di accessi
      strategy.recordAccess(key1);
      strategy.recordAccess(key2);
      
      // Verifica che il pattern sia stato registrato
      expect(strategy.accessPatterns.has(key1)).to.be.true;
      expect(strategy.accessPatterns.get(key1).has(key2)).to.be.true;
    });
    
    it('dovrebbe aggiornare la probabilità di un pattern esistente', () => {
      const key1 = 'key1';
      const key2 = 'key2';
      
      // Registra più volte la stessa sequenza
      strategy.recordAccess(key1);
      strategy.recordAccess(key2);
      
      strategy.recordAccess(key1);
      strategy.recordAccess(key2);
      
      // Verifica che la probabilità sia stata aggiornata
      expect(strategy.accessPatterns.get(key1).get(key2)).to.be.greaterThan(0);
    });
  });
  
  describe('Prefetching', () => {
    it('dovrebbe prefetchare le chiavi correlate', async () => {
      const key1 = 'key1';
      const key2 = 'key2';
      
      // Registra un pattern di accesso
      strategy.recordAccess(key1);
      strategy.recordAccess(key2);
      
      // Imposta una probabilità alta
      strategy.accessPatterns.set(key1, new Map([[key2, 0.8]]));
      
      // Esegui il prefetching
      await strategy.prefetch(key1);
      
      // Verifica che la chiave correlata sia stata prefetchata
      expect(mockCache.get.calledWith(key2)).to.be.true;
      expect(strategy.prefetchCount).to.equal(1);
    });
    
    it('non dovrebbe prefetchare chiavi con probabilità bassa', async () => {
      const key1 = 'key1';
      const key2 = 'key2';
      
      // Registra un pattern di accesso
      strategy.recordAccess(key1);
      strategy.recordAccess(key2);
      
      // Imposta una probabilità bassa
      strategy.accessPatterns.set(key1, new Map([[key2, 0.2]]));
      
      // Esegui il prefetching
      await strategy.prefetch(key1);
      
      // Verifica che la chiave correlata non sia stata prefetchata
      expect(mockCache.get.called).to.be.false;
      expect(strategy.prefetchCount).to.equal(0);
    });
    
    it('dovrebbe limitare il numero di chiavi prefetchate', async () => {
      const key1 = 'key1';
      
      // Crea molte chiavi correlate con probabilità alta
      const relatedKeys = new Map();
      for (let i = 0; i < 20; i++) {
        relatedKeys.set(`key${i + 2}`, 0.9);
      }
      
      strategy.accessPatterns.set(key1, relatedKeys);
      
      // Esegui il prefetching
      await strategy.prefetch(key1);
      
      // Verifica che solo il numero massimo di chiavi sia stato prefetchato
      expect(mockCache.get.callCount).to.equal(strategy.maxPrefetchCount);
      expect(strategy.prefetchCount).to.equal(strategy.maxPrefetchCount);
    });
  });
  
  describe('Statistiche', () => {
    it('dovrebbe tracciare hit e miss di prefetching', async () => {
      const key1 = 'key1';
      const key2 = 'key2';
      
      // Registra un pattern di accesso
      strategy.recordAccess(key1);
      strategy.recordAccess(key2);
      
      // Imposta una probabilità alta
      strategy.accessPatterns.set(key1, new Map([[key2, 0.8]]));
      
      // Esegui il prefetching
      await strategy.prefetch(key1);
      
      // Simula un hit (la chiave prefetchata viene effettivamente richiesta)
      strategy.recordHit(key2);
      
      // Simula un miss (una chiave prefetchata non viene richiesta)
      strategy.recordMiss('key3');
      
      expect(strategy.hitCount).to.equal(1);
      expect(strategy.missCount).to.equal(1);
      expect(strategy.hitRate).to.equal(0.5);
    });
    
    it('dovrebbe fornire statistiche corrette', () => {
      // Imposta alcuni valori di test
      strategy.prefetchCount = 10;
      strategy.hitCount = 7;
      strategy.missCount = 3;
      
      const stats = strategy.getStats();
      
      expect(stats).to.be.an('object');
      expect(stats.type).to.equal('predictive');
      expect(stats.prefetchCount).to.equal(10);
      expect(stats.hitCount).to.equal(7);
      expect(stats.missCount).to.equal(3);
      expect(stats.hitRate).to.equal(0.7);
    });
  });
});
