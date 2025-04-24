/**
 * Unit tests per lo Sharded Database
 * 
 * Questo file contiene i test unitari per il componente Sharded Database
 * dell'architettura ad alte prestazioni del Layer-2 su Solana.
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { ShardedDatabase, DatabaseShard, ShardingStrategy } = require('../../offchain/sharded-database');

describe('ShardedDatabase', function() {
  // Aumenta il timeout per i test più lunghi
  this.timeout(10000);
  
  let database;
  let mockShards;
  
  beforeEach(() => {
    // Crea mock per gli shard
    mockShards = [];
    for (let i = 0; i < 4; i++) {
      mockShards.push({
        id: `shard-${i}`,
        connect: sinon.stub().resolves(),
        disconnect: sinon.stub().resolves(),
        query: sinon.stub().resolves({ rows: [{ id: i, value: `test-${i}` }] }),
        execute: sinon.stub().resolves({ rowCount: 1 }),
        transaction: sinon.stub().callsFake(async (callback) => {
          return await callback({
            query: sinon.stub().resolves({ rows: [{ id: i, value: `test-${i}` }] }),
            execute: sinon.stub().resolves({ rowCount: 1 })
          });
        }),
        isConnected: sinon.stub().returns(true),
        getStats: sinon.stub().returns({
          id: `shard-${i}`,
          connectionPool: { total: 10, active: 2, idle: 8 },
          queries: { total: 100, active: 1 },
          performance: { avgQueryTime: 5 }
        })
      });
    }
    
    // Crea un'istanza del database
    database = new ShardedDatabase({
      shards: mockShards,
      shardingStrategy: 'consistent-hash',
      replicationFactor: 2,
      readConsistency: 'one',
      writeConsistency: 'all',
      connectionPoolSize: 10,
      queryTimeout: 5000,
      retryAttempts: 3,
      retryDelay: 100,
      enableMetrics: true
    });
  });
  
  afterEach(() => {
    // Cleanup
    if (database) {
      database.close();
    }
    
    // Ripristina i mock
    sinon.restore();
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente il database', () => {
      expect(database).to.be.an.instanceOf(ShardedDatabase);
      expect(database.options.shardingStrategy).to.equal('consistent-hash');
      expect(database.options.replicationFactor).to.equal(2);
      expect(database.options.readConsistency).to.equal('one');
      expect(database.options.writeConsistency).to.equal('all');
      expect(database.shards).to.have.lengthOf(4);
      expect(database.isConnected).to.be.false;
    });
    
    it('dovrebbe usare valori predefiniti se non specificati', () => {
      const defaultDatabase = new ShardedDatabase({
        shards: mockShards
      });
      
      expect(defaultDatabase.options.shardingStrategy).to.be.a('string');
      expect(defaultDatabase.options.replicationFactor).to.be.a('number');
      expect(defaultDatabase.options.readConsistency).to.be.a('string');
      expect(defaultDatabase.options.writeConsistency).to.be.a('string');
      expect(defaultDatabase.shards).to.have.lengthOf(4);
      expect(defaultDatabase.isConnected).to.be.false;
    });
    
    it('dovrebbe lanciare un errore se non vengono forniti shard', () => {
      expect(() => new ShardedDatabase({})).to.throw(/shards/);
    });
  });
  
  describe('Connessione e disconnessione', () => {
    it('dovrebbe connettersi a tutti gli shard', async () => {
      await database.connect();
      
      expect(database.isConnected).to.be.true;
      
      for (const shard of mockShards) {
        expect(shard.connect.calledOnce).to.be.true;
      }
    });
    
    it('dovrebbe disconnettersi da tutti gli shard', async () => {
      await database.connect();
      await database.disconnect();
      
      expect(database.isConnected).to.be.false;
      
      for (const shard of mockShards) {
        expect(shard.disconnect.calledOnce).to.be.true;
      }
    });
    
    it('dovrebbe gestire errori di connessione', async () => {
      // Simula un errore di connessione in uno shard
      mockShards[0].connect.rejects(new Error('Connection error'));
      
      try {
        await database.connect();
        expect.fail('Dovrebbe lanciare un errore');
      } catch (error) {
        expect(error.message).to.include('Connection error');
      }
      
      expect(database.isConnected).to.be.false;
    });
  });
  
  describe('Operazioni di base', () => {
    beforeEach(async () => {
      await database.connect();
    });
    
    it('dovrebbe eseguire una query di lettura', async () => {
      const result = await database.query('SELECT * FROM test WHERE id = $1', [1]);
      
      expect(result).to.be.an('object');
      expect(result.rows).to.be.an('array');
      expect(result.rows).to.have.lengthOf(1);
      
      // Verifica che almeno uno shard sia stato interrogato
      let queryExecuted = false;
      for (const shard of mockShards) {
        if (shard.query.called) {
          queryExecuted = true;
          break;
        }
      }
      
      expect(queryExecuted).to.be.true;
    });
    
    it('dovrebbe eseguire una query di scrittura', async () => {
      const result = await database.execute('INSERT INTO test (id, value) VALUES ($1, $2)', [1, 'test']);
      
      expect(result).to.be.an('object');
      expect(result.rowCount).to.equal(1);
      
      // Verifica che almeno uno shard sia stato aggiornato
      let executeExecuted = false;
      for (const shard of mockShards) {
        if (shard.execute.called) {
          executeExecuted = true;
          break;
        }
      }
      
      expect(executeExecuted).to.be.true;
    });
    
    it('dovrebbe eseguire una transazione', async () => {
      const result = await database.transaction(async (client) => {
        const queryResult = await client.query('SELECT * FROM test WHERE id = $1', [1]);
        await client.execute('UPDATE test SET value = $1 WHERE id = $2', ['updated', 1]);
        return queryResult;
      });
      
      expect(result).to.be.an('object');
      expect(result.rows).to.be.an('array');
      
      // Verifica che almeno uno shard abbia eseguito una transazione
      let transactionExecuted = false;
      for (const shard of mockShards) {
        if (shard.transaction.called) {
          transactionExecuted = true;
          break;
        }
      }
      
      expect(transactionExecuted).to.be.true;
    });
  });
  
  describe('Sharding e replicazione', () => {
    beforeEach(async () => {
      await database.connect();
    });
    
    it('dovrebbe determinare lo shard corretto per una chiave', () => {
      const key = 'test-key';
      const shardIndices = database.getShardIndicesForKey(key);
      
      expect(shardIndices).to.be.an('array');
      expect(shardIndices).to.have.lengthOf(database.options.replicationFactor);
      
      for (const index of shardIndices) {
        expect(index).to.be.a('number');
        expect(index).to.be.greaterThan(-1);
        expect(index).to.be.lessThan(database.shards.length);
      }
    });
    
    it('dovrebbe replicare i dati su più shard', async () => {
      const key = 'test-key';
      
      await database.execute('INSERT INTO test (id, value) VALUES ($1, $2)', [key, 'test'], { routingKey: key });
      
      // Ottieni gli indici degli shard per la chiave
      const shardIndices = database.getShardIndicesForKey(key);
      
      // Verifica che tutti gli shard di replica siano stati aggiornati
      for (const index of shardIndices) {
        expect(mockShards[index].execute.called).to.be.true;
      }
    });
    
    it('dovrebbe leggere i dati da uno shard con consistenza "one"', async () => {
      const key = 'test-key';
      
      database.options.readConsistency = 'one';
      
      await database.query('SELECT * FROM test WHERE id = $1', [key], { routingKey: key });
      
      // Ottieni gli indici degli shard per la chiave
      const shardIndices = database.getShardIndicesForKey(key);
      
      // Verifica che almeno uno shard sia stato interrogato
      let queryExecuted = false;
      for (const index of shardIndices) {
        if (mockShards[index].query.called) {
          queryExecuted = true;
          break;
        }
      }
      
      expect(queryExecuted).to.be.true;
    });
    
    it('dovrebbe leggere i dati da tutti gli shard con consistenza "all"', async () => {
      const key = 'test-key';
      
      database.options.readConsistency = 'all';
      
      await database.query('SELECT * FROM test WHERE id = $1', [key], { routingKey: key });
      
      // Ottieni gli indici degli shard per la chiave
      const shardIndices = database.getShardIndicesForKey(key);
      
      // Verifica che tutti gli shard di replica siano stati interrogati
      for (const index of shardIndices) {
        expect(mockShards[index].query.called).to.be.true;
      }
    });
  });
  
  describe('Gestione degli errori e retry', () => {
    beforeEach(async () => {
      await database.connect();
    });
    
    it('dovrebbe gestire errori di query', async () => {
      // Simula un errore di query in tutti gli shard
      for (const shard of mockShards) {
        shard.query.rejects(new Error('Query error'));
      }
      
      try {
        await database.query('SELECT * FROM test WHERE id = $1', [1]);
        expect.fail('Dovrebbe lanciare un errore');
      } catch (error) {
        expect(error.message).to.include('Query error');
      }
    });
    
    it('dovrebbe ritentare le query fallite', async () => {
      // Simula un errore temporaneo seguito da un successo
      mockShards[0].query.onFirstCall().rejects(new Error('Temporary error'));
      mockShards[0].query.onSecondCall().resolves({ rows: [{ id: 1, value: 'test' }] });
      
      // Forza l'uso dello shard 0
      sinon.stub(database, 'getShardIndicesForKey').returns([0]);
      
      const result = await database.query('SELECT * FROM test WHERE id = $1', [1]);
      
      expect(result).to.be.an('object');
      expect(result.rows).to.be.an('array');
      expect(mockShards[0].query.calledTwice).to.be.true;
    });
    
    it('dovrebbe gestire il failover tra shard', async () => {
      // Simula un errore permanente nello shard primario
      mockShards[0].query.rejects(new Error('Permanent error'));
      
      // Forza l'uso degli shard 0 e 1 come repliche
      sinon.stub(database, 'getShardIndicesForKey').returns([0, 1]);
      
      const result = await database.query('SELECT * FROM test WHERE id = $1', [1]);
      
      expect(result).to.be.an('object');
      expect(result.rows).to.be.an('array');
      expect(mockShards[0].query.called).to.be.true;
      expect(mockShards[1].query.called).to.be.true;
    });
  });
  
  describe('Statistiche e monitoraggio', () => {
    beforeEach(async () => {
      await database.connect();
    });
    
    it('dovrebbe fornire statistiche corrette', () => {
      const stats = database.getStats();
      
      expect(stats).to.be.an('object');
      expect(stats.shards).to.be.an('array').with.lengthOf(4);
      expect(stats.shardingStrategy).to.equal('consistent-hash');
      expect(stats.replicationFactor).to.equal(2);
      expect(stats.isConnected).to.be.true;
      
      for (const shardStats of stats.shards) {
        expect(shardStats).to.be.an('object');
        expect(shardStats.id).to.be.a('string');
        expect(shardStats.connectionPool).to.be.an('object');
        expect(shardStats.queries).to.be.an('object');
        expect(shardStats.performance).to.be.an('object');
      }
    });
  });
  
  describe('Chiusura', () => {
    beforeEach(async () => {
      await database.connect();
    });
    
    it('dovrebbe chiudere il database', async () => {
      await database.close();
      
      expect(database.isConnected).to.be.false;
      
      for (const shard of mockShards) {
        expect(shard.disconnect.calledOnce).to.be.true;
      }
    });
  });
});

describe('DatabaseShard', function() {
  let shard;
  let mockPool;
  
  beforeEach(() => {
    // Crea un mock del pool di connessioni
    mockPool = {
      connect: sinon.stub().resolves({
        query: sinon.stub().resolves({ rows: [{ id: 1, value: 'test' }] }),
        release: sinon.stub()
      }),
      query: sinon.stub().resolves({ rows: [{ id: 1, value: 'test' }] }),
      end: sinon.stub().resolves(),
      totalCount: 10,
      idleCount: 8,
      waitingCount: 0
    };
    
    // Crea un'istanza dello shard
    shard = new DatabaseShard({
      id: 'shard-1',
      connectionString: 'postgresql://user:password@localhost:5432/testdb',
      poolSize: 10,
      idleTimeout: 30000,
      connectionTimeout: 5000,
      statementTimeout: 10000,
      pool: mockPool
    });
  });
  
  afterEach(() => {
    // Cleanup
    if (shard) {
      shard.disconnect();
    }
    
    // Ripristina i mock
    sinon.restore();
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente lo shard', () => {
      expect(shard).to.be.an.instanceOf(DatabaseShard);
      expect(shard.id).to.equal('shard-1');
      expect(shard.options.connectionString).to.equal('postgresql://user:password@localhost:5432/testdb');
      expect(shard.options.poolSize).to.equal(10);
      expect(shard.isConnected).to.be.false;
    });
  });
  
  describe('Connessione e disconnessione', () => {
    it('dovrebbe connettersi al database', async () => {
      await shard.connect();
      
      expect(shard.isConnected).to.be.true;
    });
    
    it('dovrebbe disconnettersi dal database', async () => {
      await shard.connect();
      await shard.disconnect();
      
      expect(shard.isConnected).to.be.false;
      expect(mockPool.end.calledOnce).to.be.true;
    });
  });
  
  describe('Operazioni di base', () => {
    beforeEach(async () => {
      await shard.connect();
    });
    
    it('dovrebbe eseguire una query', async () => {
      const result = await shard.query('SELECT * FROM test WHERE id = $1', [1]);
      
      expect(result).to.be.an('object');
      expect(result.rows).to.be.an('array');
      expect(mockPool.query.calledOnce).to.be.true;
    });
    
    it('dovrebbe eseguire una query con un client dedicato', async () => {
      const result = await shard.queryWithClient('SELECT * FROM test WHERE id = $1', [1]);
      
      expect(result).to.be.an('object');
      expect(result.rows).to.be.an('array');
      expect(mockPool.connect.calledOnce).to.be.true;
    });
    
    it('dovrebbe eseguire una transazione', async () => {
      // Mock per il client di transazione
      const mockClient = {
        query: sinon.stub().resolves({ rows: [{ id: 1, value: 'test' }] }),
        release: sinon.stub()
      };
      
      // Configura il mock per supportare le transazioni
      mockClient.query.withArgs('BEGIN').resolves();
      mockClient.query.withArgs('COMMIT').resolves();
      mockClient.query.withArgs('ROLLBACK').resolves();
      
      mockPool.connect.resolves(mockClient);
      
      const result = await shard.transaction(async (client) => {
        const queryResult = await client.query('SELECT * FROM test WHERE id = $1', [1]);
        return queryResult;
      });
      
      expect(result).to.be.an('object');
      expect(result.rows).to.be.an('array');
      expect(mockPool.connect.calledOnce).to.be.true;
      expect(mockClient.query.calledWith('BEGIN')).to.be.true;
      expect(mockClient.query.calledWith('COMMIT')).to.be.true;
      expect(mockClient.release.calledOnce).to.be.true;
    });
    
    it('dovrebbe gestire errori nelle transazioni', async () => {
      // Mock per il client di transazione
      const mockClient = {
        query: sinon.stub(),
        release: sinon.stub()
      };
      
      // Configura il mock per supportare le transazioni
      mockClient.query.withArgs('BEGIN').resolves();
      mockClient.query.withArgs('COMMIT').resolves();
      mockClient.query.withArgs('ROLLBACK').resolves();
      mockClient.query.withArgs('SELECT * FROM test WHERE id = $1').rejects(new Error('Query error'));
      
      mockPool.connect.resolves(mockClient);
      
      try {
        await shard.transaction(async (client) => {
          await client.query('SELECT * FROM test WHERE id = $1', [1]);
        });
        expect.fail('Dovrebbe lanciare un errore');
      } catch (error) {
        expect(error.message).to.include('Query error');
        expect(mockClient.query.calledWith('ROLLBACK')).to.be.true;
        expect(mockClient.release.calledOnce).to.be.true;
      }
    });
  });
  
  describe('Statistiche', () => {
    beforeEach(async () => {
      await shard.connect();
    });
    
    it('dovrebbe fornire statistiche corrette', () => {
      const stats = shard.getStats();
      
      expect(stats).to.be.an('object');
      expect(stats.id).to.equal('shard-1');
      expect(stats.isConnected).to.be.true;
      expect(stats.connectionPool).to.be.an('object');
      expect(stats.connectionPool.total).to.equal(10);
      expect(stats.connectionPool.idle).to.equal(8);
      expect(stats.connectionPool.waiting).to.equal(0);
      expect(stats.queries).to.be.an('object');
      expect(stats.performance).to.be.an('object');
    });
  });
});

describe('ShardingStrategy', function() {
  describe('Consistent Hash', () => {
    it('dovrebbe distribuire le chiavi in modo uniforme', () => {
      const strategy = new ShardingStrategy('consistent-hash', { shardCount: 10, virtualNodes: 100 });
      
      const distribution = {};
      
      // Genera 1000 chiavi casuali
      for (let i = 0; i < 1000; i++) {
        const key = `key-${i}`;
        const shardIndex = strategy.getShardIndex(key);
        
        expect(shardIndex).to.be.a('number');
        expect(shardIndex).to.be.greaterThan(-1);
        expect(shardIndex).to.be.lessThan(10);
        
        distribution[shardIndex] = (distribution[shardIndex] || 0) + 1;
      }
      
      // Verifica che tutte le chiavi siano state distribuite
      expect(Object.keys(distribution).length).to.be.at.most(10);
      
      // Verifica che la distribuzione sia ragionevolmente uniforme
      const counts = Object.values(distribution);
      const avg = counts.reduce((sum, count) => sum + count, 0) / counts.length;
      
      for (const count of counts) {
        // Tollera una deviazione del 30% dalla media
        expect(count).to.be.within(avg * 0.7, avg * 1.3);
      }
    });
    
    it('dovrebbe mantenere la coerenza quando cambiano gli shard', () => {
      const strategy1 = new ShardingStrategy('consistent-hash', { shardCount: 10, virtualNodes: 100 });
      const strategy2 = new ShardingStrategy('consistent-hash', { shardCount: 11, virtualNodes: 100 });
      
      let unchanged = 0;
      
      // Genera 1000 chiavi casuali
      for (let i = 0; i < 1000; i++) {
        const key = `key-${i}`;
        const shardIndex1 = strategy1.getShardIndex(key);
        const shardIndex2 = strategy2.getShardIndex(key);
        
        if (shardIndex1 === shardIndex2) {
          unchanged++;
        }
      }
      
      // Verifica che la maggior parte delle chiavi rimanga sullo stesso shard
      // Con consistent hashing, ci aspettiamo che circa il 90% delle chiavi rimanga invariato
      expect(unchanged / 1000).to.be.above(0.8);
    });
  });
  
  describe('Range Based', () => {
    it('dovrebbe distribuire le chiavi in base al range', () => {
      const strategy = new ShardingStrategy('range', {
        shardCount: 4,
        keyExtractor: (key) => {
          // Estrae un numero dalla chiave (es. "user-123" -> 123)
          const match = key.match(/\d+/);
          return match ? parseInt(match[0]) : 0;
        },
        ranges: [
          { min: 0, max: 250, shard: 0 },
          { min: 251, max: 500, shard: 1 },
          { min: 501, max: 750, shard: 2 },
          { min: 751, max: 1000, shard: 3 }
        ]
      });
      
      expect(strategy.getShardIndex('user-100')).to.equal(0);
      expect(strategy.getShardIndex('user-300')).to.equal(1);
      expect(strategy.getShardIndex('user-600')).to.equal(2);
      expect(strategy.getShardIndex('user-800')).to.equal(3);
    });
  });
  
  describe('Hash Based', () => {
    it('dovrebbe distribuire le chiavi in base all\'hash', () => {
      const strategy = new ShardingStrategy('hash', { shardCount: 10 });
      
      const distribution = {};
      
      // Genera 1000 chiavi casuali
      for (let i = 0; i < 1000; i++) {
        const key = `key-${i}`;
        const shardIndex = strategy.getShardIndex(key);
        
        expect(shardIndex).to.be.a('number');
        expect(shardIndex).to.be.greaterThan(-1);
        expect(shardIndex).to.be.lessThan(10);
        
        distribution[shardIndex] = (distribution[shardIndex] || 0) + 1;
      }
      
      // Verifica che tutte le chiavi siano state distribuite
      expect(Object.keys(distribution).length).to.be.at.most(10);
      
      // Verifica che la distribuzione sia ragionevolmente uniforme
      const counts = Object.values(distribution);
      const avg = counts.reduce((sum, count) => sum + count, 0) / counts.length;
      
      for (const count of counts) {
        // Tollera una deviazione del 30% dalla media
        expect(count).to.be.within(avg * 0.7, avg * 1.3);
      }
    });
  });
});
