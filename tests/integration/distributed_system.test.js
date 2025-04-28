/**
 * @fileoverview Test di integrazione per il sistema di sequencer distribuito
 * 
 * Questo file contiene test di integrazione per verificare il corretto funzionamento
 * del sistema di sequencer distribuito nel suo complesso, inclusa l'interazione
 * tra i vari componenti.
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { DistributedSequencer } = require('../../offchain/distributed/distributed_sequencer');
const { RaftConsensus } = require('../../offchain/distributed/raft_consensus');
const { StateReplication } = require('../../offchain/distributed/state_replication');
const { NodeSynchronization } = require('../../offchain/distributed/node_synchronization');
const { SecretsManager } = require('../../offchain/secrets/secrets_manager');
const { SecretCache } = require('../../offchain/secrets/secret_cache');
const { initializeSecretsSystem } = require('../../offchain/secrets_integration');

describe('Sistema Integrato', function() {
  // Aumenta il timeout per i test di integrazione
  this.timeout(10000);
  
  // Test per l'integrazione del sistema di sequencer distribuito
  describe('Sequencer Distribuito', () => {
    let node1, node2, node3;
    let raftConsensus1, raftConsensus2, raftConsensus3;
    let stateReplication1, stateReplication2, stateReplication3;
    let nodeSync1, nodeSync2, nodeSync3;
    
    before(async () => {
      // Crea le configurazioni per i nodi
      const config1 = {
        nodeId: 'node1',
        peers: ['node2', 'node3'],
        raftConfig: {
          electionTimeoutMin: 300,
          electionTimeoutMax: 600,
          heartbeatInterval: 100,
          logPath: './test-logs/node1'
        },
        stateConfig: {
          storeConfig: { storePath: './test-data/node1' },
          logConfig: { logPath: './test-logs/replication/node1' }
        }
      };
      
      const config2 = {
        nodeId: 'node2',
        peers: ['node1', 'node3'],
        raftConfig: {
          electionTimeoutMin: 300,
          electionTimeoutMax: 600,
          heartbeatInterval: 100,
          logPath: './test-logs/node2'
        },
        stateConfig: {
          storeConfig: { storePath: './test-data/node2' },
          logConfig: { logPath: './test-logs/replication/node2' }
        }
      };
      
      const config3 = {
        nodeId: 'node3',
        peers: ['node1', 'node2'],
        raftConfig: {
          electionTimeoutMin: 300,
          electionTimeoutMax: 600,
          heartbeatInterval: 100,
          logPath: './test-logs/node3'
        },
        stateConfig: {
          storeConfig: { storePath: './test-data/node3' },
          logConfig: { logPath: './test-logs/replication/node3' }
        }
      };
      
      // Crea i componenti per il nodo 1
      raftConsensus1 = new RaftConsensus({
        nodeId: config1.nodeId,
        peers: config1.peers,
        ...config1.raftConfig
      });
      
      stateReplication1 = new StateReplication(config1.stateConfig);
      
      nodeSync1 = new NodeSynchronization({}, stateReplication1, raftConsensus1);
      
      node1 = new DistributedSequencer({
        nodeId: config1.nodeId,
        peers: config1.peers,
        raftConsensus: raftConsensus1,
        stateReplication: stateReplication1,
        nodeSync: nodeSync1
      });
      
      // Crea i componenti per il nodo 2
      raftConsensus2 = new RaftConsensus({
        nodeId: config2.nodeId,
        peers: config2.peers,
        ...config2.raftConfig
      });
      
      stateReplication2 = new StateReplication(config2.stateConfig);
      
      nodeSync2 = new NodeSynchronization({}, stateReplication2, raftConsensus2);
      
      node2 = new DistributedSequencer({
        nodeId: config2.nodeId,
        peers: config2.peers,
        raftConsensus: raftConsensus2,
        stateReplication: stateReplication2,
        nodeSync: nodeSync2
      });
      
      // Crea i componenti per il nodo 3
      raftConsensus3 = new RaftConsensus({
        nodeId: config3.nodeId,
        peers: config3.peers,
        ...config3.raftConfig
      });
      
      stateReplication3 = new StateReplication(config3.stateConfig);
      
      nodeSync3 = new NodeSynchronization({}, stateReplication3, raftConsensus3);
      
      node3 = new DistributedSequencer({
        nodeId: config3.nodeId,
        peers: config3.peers,
        raftConsensus: raftConsensus3,
        stateReplication: stateReplication3,
        nodeSync: nodeSync3
      });
      
      // Stub per i metodi che interagiscono con il filesystem o la rete
      sinon.stub(raftConsensus1, '_ensureLogDirectory').resolves();
      sinon.stub(raftConsensus1, '_loadPersistentState').resolves();
      sinon.stub(raftConsensus1, '_savePersistentState').resolves();
      sinon.stub(raftConsensus1, '_appendEntries').resolves(true);
      sinon.stub(raftConsensus1, '_requestVote').resolves(true);
      
      sinon.stub(raftConsensus2, '_ensureLogDirectory').resolves();
      sinon.stub(raftConsensus2, '_loadPersistentState').resolves();
      sinon.stub(raftConsensus2, '_savePersistentState').resolves();
      sinon.stub(raftConsensus2, '_appendEntries').resolves(true);
      sinon.stub(raftConsensus2, '_requestVote').resolves(true);
      
      sinon.stub(raftConsensus3, '_ensureLogDirectory').resolves();
      sinon.stub(raftConsensus3, '_loadPersistentState').resolves();
      sinon.stub(raftConsensus3, '_savePersistentState').resolves();
      sinon.stub(raftConsensus3, '_appendEntries').resolves(true);
      sinon.stub(raftConsensus3, '_requestVote').resolves(true);
      
      sinon.stub(stateReplication1.stateStore, 'initialize').resolves(true);
      sinon.stub(stateReplication1.stateStore, 'close').resolves(true);
      sinon.stub(stateReplication1.stateStore, 'apply').resolves({ success: true });
      sinon.stub(stateReplication1.stateStore, 'getStateSize').resolves(1024);
      sinon.stub(stateReplication1.replicationLog, 'initialize').resolves(true);
      sinon.stub(stateReplication1.replicationLog, 'close').resolves(true);
      sinon.stub(stateReplication1.replicationLog, 'append').resolves({ index: 0, transaction: {} });
      
      sinon.stub(stateReplication2.stateStore, 'initialize').resolves(true);
      sinon.stub(stateReplication2.stateStore, 'close').resolves(true);
      sinon.stub(stateReplication2.stateStore, 'apply').resolves({ success: true });
      sinon.stub(stateReplication2.stateStore, 'getStateSize').resolves(1024);
      sinon.stub(stateReplication2.replicationLog, 'initialize').resolves(true);
      sinon.stub(stateReplication2.replicationLog, 'close').resolves(true);
      sinon.stub(stateReplication2.replicationLog, 'append').resolves({ index: 0, transaction: {} });
      
      sinon.stub(stateReplication3.stateStore, 'initialize').resolves(true);
      sinon.stub(stateReplication3.stateStore, 'close').resolves(true);
      sinon.stub(stateReplication3.stateStore, 'apply').resolves({ success: true });
      sinon.stub(stateReplication3.stateStore, 'getStateSize').resolves(1024);
      sinon.stub(stateReplication3.replicationLog, 'initialize').resolves(true);
      sinon.stub(stateReplication3.replicationLog, 'close').resolves(true);
      sinon.stub(stateReplication3.replicationLog, 'append').resolves({ index: 0, transaction: {} });
      
      // Avvia i nodi
      await node1.start();
      await node2.start();
      await node3.start();
    });
    
    after(async () => {
      // Arresta i nodi
      await node1.stop();
      await node2.stop();
      await node3.stop();
      
      // Ripristina tutti gli stub
      sinon.restore();
    });
    
    it('dovrebbe avviare correttamente tutti i nodi', () => {
      expect(node1.isRunning()).to.be.true;
      expect(node2.isRunning()).to.be.true;
      expect(node3.isRunning()).to.be.true;
    });
    
    it('dovrebbe eleggere un leader', async () => {
      // Simula l'elezione del nodo 1 come leader
      const leaderEvent = { term: 1, nodeId: 'node1' };
      raftConsensus1.emit('leader', leaderEvent);
      
      // Simula gli eventi di follower per gli altri nodi
      const followerEvent = { term: 1, nodeId: 'node1' };
      raftConsensus2.emit('follower', followerEvent);
      raftConsensus3.emit('follower', followerEvent);
      
      // Attendi che gli eventi siano elaborati
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verifica che il nodo 1 sia leader
      const status1 = node1.getStatus();
      expect(status1.isLeader).to.be.true;
      
      // Verifica che gli altri nodi non siano leader
      const status2 = node2.getStatus();
      const status3 = node3.getStatus();
      expect(status2.isLeader).to.be.false;
      expect(status3.isLeader).to.be.false;
    });
    
    it('dovrebbe elaborare una transazione attraverso il leader', async () => {
      // Configura il nodo 1 come leader
      raftConsensus1.state = 'leader';
      stateReplication1.isLeader = true;
      
      // Configura gli altri nodi come follower
      raftConsensus2.state = 'follower';
      stateReplication2.isLeader = false;
      raftConsensus3.state = 'follower';
      stateReplication3.isLeader = false;
      
      // Crea una transazione di test
      const transaction = {
        type: 'deposit',
        amount: 100,
        account: 'user1',
        timestamp: new Date().toISOString()
      };
      
      // Elabora la transazione attraverso il leader
      const result = await node1.processTransaction(transaction);
      
      // Verifica che la transazione sia stata elaborata correttamente
      expect(result).to.have.property('id');
      expect(result).to.have.property('status', 'pending');
      
      // Verifica che la transazione sia stata aggiunta al log
      expect(raftConsensus1.appendLogEntry.calledOnce).to.be.true;
    });
    
    it('dovrebbe inoltrare una transazione dal follower al leader', async () => {
      // Configura il nodo 2 come follower
      raftConsensus2.state = 'follower';
      raftConsensus2.leaderId = 'node1';
      stateReplication2.isLeader = false;
      
      // Stub per il metodo forwardTransactionToLeader
      const mockResponse = { id: 'tx123', status: 'pending' };
      sinon.stub(node2, 'forwardTransactionToLeader').resolves(mockResponse);
      
      // Crea una transazione di test
      const transaction = {
        type: 'withdraw',
        amount: 50,
        account: 'user1',
        timestamp: new Date().toISOString()
      };
      
      // Elabora la transazione attraverso il follower
      const result = await node2.processTransaction(transaction);
      
      // Verifica che la transazione sia stata inoltrata al leader
      expect(result).to.deep.equal(mockResponse);
      expect(node2.forwardTransactionToLeader.calledOnce).to.be.true;
      expect(node2.forwardTransactionToLeader.calledWith('node1', transaction)).to.be.true;
      
      // Ripristina lo stub
      node2.forwardTransactionToLeader.restore();
    });
    
    it('dovrebbe gestire il failover del leader', async () => {
      // Simula il fallimento del leader (nodo 1)
      raftConsensus1.state = 'follower';
      stateReplication1.isLeader = false;
      
      // Simula l'elezione del nodo 2 come nuovo leader
      const leaderEvent = { term: 2, nodeId: 'node2' };
      raftConsensus2.state = 'leader';
      raftConsensus2.emit('leader', leaderEvent);
      
      // Simula gli eventi di follower per gli altri nodi
      const followerEvent = { term: 2, nodeId: 'node2' };
      raftConsensus1.emit('follower', followerEvent);
      raftConsensus3.emit('follower', followerEvent);
      
      // Attendi che gli eventi siano elaborati
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verifica che il nodo 2 sia ora il leader
      const status2 = node2.getStatus();
      expect(status2.isLeader).to.be.true;
      
      // Verifica che gli altri nodi non siano leader
      const status1 = node1.getStatus();
      const status3 = node3.getStatus();
      expect(status1.isLeader).to.be.false;
      expect(status3.isLeader).to.be.false;
    });
    
    it('dovrebbe sincronizzare un nuovo nodo', async () => {
      // Configura il nodo 2 come leader
      raftConsensus2.state = 'leader';
      stateReplication2.isLeader = true;
      
      // Stub per i metodi di sincronizzazione
      sinon.stub(nodeSync2, 'syncNewNode').resolves(true);
      
      // Simula la richiesta di sincronizzazione dal nodo 3
      const request = { nodeId: 'node3' };
      const response = await nodeSync2.handleSyncRequest(request);
      
      // Verifica che la sincronizzazione sia stata avviata
      expect(response.success).to.be.true;
      expect(nodeSync2.syncNewNode.calledOnce).to.be.true;
      expect(nodeSync2.syncNewNode.calledWith('node3')).to.be.true;
      
      // Ripristina lo stub
      nodeSync2.syncNewNode.restore();
    });
  });
  
  // Test per l'integrazione del sistema di gestione dei segreti
  describe('Gestione dei Segreti', () => {
    let secretsManager;
    let secretCache;
    
    before(async () => {
      // Crea un mock per AWS.SecretsManager
      const mockAWSSecretsManager = {
        getSecretValue: sinon.stub().returns({
          promise: sinon.stub().resolves({
            SecretString: JSON.stringify({ username: 'admin', password: 'password123' })
          })
        }),
        createSecret: sinon.stub().returns({
          promise: sinon.stub().resolves({ ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret' })
        }),
        updateSecret: sinon.stub().returns({
          promise: sinon.stub().resolves({ ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret' })
        }),
        deleteSecret: sinon.stub().returns({
          promise: sinon.stub().resolves({ ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret' })
        }),
        listSecrets: sinon.stub().returns({
          promise: sinon.stub().resolves({
            SecretList: [
              { Name: 'test-secret-1' },
              { Name: 'test-secret-2' }
            ]
          })
        }),
        describeSecret: sinon.stub().returns({
          promise: sinon.stub().resolves({ Name: 'test-secret' })
        })
      };
      
      // Stub per il costruttore di AWS.SecretsManager
      sinon.stub(global, 'AWS').returns({
        SecretsManager: sinon.stub().returns(mockAWSSecretsManager)
      });
      
      // Inizializza il sistema di gestione dei segreti
      const secretsSystem = initializeSecretsSystem({
        provider: 'aws',
        awsRegion: 'us-east-1',
        cacheTtl: 60000,
        cacheMaxSize: 10,
        encryptInMemory: true
      });
      
      secretsManager = secretsSystem.secretsManager;
      secretCache = secretsSystem.secretCache;
    });
    
    after(() => {
      // Ripristina tutti gli stub
      sinon.restore();
    });
    
    it('dovrebbe inizializzare correttamente il sistema di gestione dei segreti', () => {
      expect(secretsManager).to.be.an.instanceOf(SecretsManager);
      expect(secretCache).to.be.an.instanceOf(SecretCache);
    });
    
    it('dovrebbe ottenere un segreto dalla cache', async () => {
      // Stub per il metodo getSecret del gestore dei segreti
      sinon.stub(secretsManager, 'getSecret').resolves({ username: 'admin', password: 'password123' });
      
      // Ottieni il segreto dalla cache
      const secret = await secretCache.getSecret('test-secret');
      
      // Verifica che il segreto sia stato ottenuto correttamente
      expect(secret).to.deep.equal({ username: 'admin', password: 'password123' });
      expect(secretsManager.getSecret.calledOnce).to.be.true;
      expect(secretsManager.getSecret.calledWith('test-secret')).to.be.true;
      
      // Ottieni di nuovo lo stesso segreto (dovrebbe essere in cache)
      const cachedSecret = await secretCache.getSecret('test-secret');
      
      // Verifica che il segreto sia stato ottenuto dalla cache
      expect(cachedSecret).to.deep.equal({ username: 'admin', password: 'password123' });
      expect(secretsManager.getSecret.calledOnce).to.be.true; // Non dovrebbe essere chiamato di nuovo
      
      // Ripristina lo stub
      secretsManager.getSecret.restore();
    });
    
    it('dovrebbe impostare un segreto e aggiornare la cache', async () => {
      // Stub per il metodo setSecret del gestore dei segreti
      sinon.stub(secretsManager, 'setSecret').resolves(true);
      
      // Imposta un nuovo segreto
      const result = await secretCache.setSecret('new-secret', { apiKey: 'abc123' });
      
      // Verifica che il segreto sia stato impostato correttamente
      expect(result).to.be.true;
      expect(secretsManager.setSecret.calledOnce).to.be.true;
      expect(secretsManager.setSecret.calledWith('new-secret', { apiKey: 'abc123' })).to.be.true;
      
      // Ottieni il segreto dalla cache
      const secret = await secretCache.getSecret('new-secret');
      
      // Verifica che il segreto sia stato memorizzato nella cache
      expect(secret).to.deep.equal({ apiKey: 'abc123' });
      
      // Ripristina lo stub
      secretsManager.setSecret.restore();
    });
    
    it('dovrebbe eliminare un segreto e rimuoverlo dalla cache', async () => {
      // Prima imposta un segreto
      sinon.stub(secretsManager, 'setSecret').resolves(true);
      await secretCache.setSecret('secret-to-delete', 'delete-me');
      secretsManager.setSecret.restore();
      
      // Stub per il metodo deleteSecret del gestore dei segreti
      sinon.stub(secretsManager, 'deleteSecret').resolves(true);
      
      // Elimina il segreto
      const result = await secretCache.deleteSecret('secret-to-delete');
      
      // Verifica che il segreto sia stato eliminato correttamente
      expect(result).to.be.true;
      expect(secretsManager.deleteSecret.calledOnce).to.be.true;
      expect(secretsManager.deleteSecret.calledWith('secret-to-delete')).to.be.true;
      
      // Stub per il metodo getSecret del gestore dei segreti
      sinon.stub(secretsManager, 'getSecret').resolves('new-value');
      
      // Prova a ottenere il segreto eliminato
      const secret = await secretCache.getSecret('secret-to-delete');
      
      // Verifica che il segreto non sia più in cache
      expect(secret).to.equal('new-value');
      expect(secretsManager.getSecret.calledOnce).to.be.true;
      
      // Ripristina gli stub
      secretsManager.deleteSecret.restore();
      secretsManager.getSecret.restore();
    });
    
    it('dovrebbe ruotare un segreto e aggiornare la cache', async () => {
      // Stub per il metodo rotateSecret del gestore dei segreti
      sinon.stub(secretsManager, 'rotateSecret').resolves('new-rotated-value');
      
      // Ruota il segreto
      const newValue = await secretCache.rotateSecret('rotated-secret');
      
      // Verifica che il segreto sia stato ruotato correttamente
      expect(newValue).to.equal('new-rotated-value');
      expect(secretsManager.rotateSecret.calledOnce).to.be.true;
      expect(secretsManager.rotateSecret.calledWith('rotated-secret')).to.be.true;
      
      // Ottieni il segreto dalla cache
      const secret = await secretCache.getSecret('rotated-secret');
      
      // Verifica che il segreto ruotato sia stato memorizzato nella cache
      expect(secret).to.equal('new-rotated-value');
      
      // Ripristina lo stub
      secretsManager.rotateSecret.restore();
    });
    
    it('dovrebbe invalidare un segreto nella cache', async () => {
      // Prima imposta un segreto
      sinon.stub(secretsManager, 'setSecret').resolves(true);
      await secretCache.setSecret('secret-to-invalidate', 'old-value');
      secretsManager.setSecret.restore();
      
      // Stub per il metodo getSecret del gestore dei segreti
      sinon.stub(secretsManager, 'getSecret').resolves('new-value');
      
      // Invalida il segreto nella cache
      secretCache.invalidate('secret-to-invalidate');
      
      // Ottieni il segreto
      const secret = await secretCache.getSecret('secret-to-invalidate');
      
      // Verifica che il segreto sia stato ottenuto dal gestore dei segreti
      expect(secret).to.equal('new-value');
      expect(secretsManager.getSecret.calledOnce).to.be.true;
      
      // Ripristina lo stub
      secretsManager.getSecret.restore();
    });
  });
  
  // Test per l'integrazione completa del sistema
  describe('Integrazione Completa', () => {
    let sequencer;
    let secretsSystem;
    
    before(async () => {
      // Crea un mock per AWS.SecretsManager
      const mockAWSSecretsManager = {
        getSecretValue: sinon.stub().returns({
          promise: sinon.stub().resolves({
            SecretString: JSON.stringify({ apiKey: 'test-api-key' })
          })
        }),
        createSecret: sinon.stub().returns({
          promise: sinon.stub().resolves({})
        }),
        updateSecret: sinon.stub().returns({
          promise: sinon.stub().resolves({})
        }),
        deleteSecret: sinon.stub().returns({
          promise: sinon.stub().resolves({})
        }),
        listSecrets: sinon.stub().returns({
          promise: sinon.stub().resolves({
            SecretList: []
          })
        }),
        describeSecret: sinon.stub().returns({
          promise: sinon.stub().resolves({})
        })
      };
      
      // Stub per il costruttore di AWS.SecretsManager
      sinon.stub(global, 'AWS').returns({
        SecretsManager: sinon.stub().returns(mockAWSSecretsManager)
      });
      
      // Inizializza il sistema di gestione dei segreti
      secretsSystem = initializeSecretsSystem({
        provider: 'aws',
        awsRegion: 'us-east-1'
      });
      
      // Crea i componenti per il sequencer
      const raftConsensus = new RaftConsensus({
        nodeId: 'node1',
        peers: ['node2', 'node3'],
        electionTimeoutMin: 300,
        electionTimeoutMax: 600,
        heartbeatInterval: 100,
        logPath: './test-logs/integration'
      });
      
      const stateReplication = new StateReplication({
        storeConfig: { storePath: './test-data/integration' },
        logConfig: { logPath: './test-logs/replication/integration' }
      });
      
      const nodeSync = new NodeSynchronization({}, stateReplication, raftConsensus);
      
      sequencer = new DistributedSequencer({
        nodeId: 'node1',
        peers: ['node2', 'node3'],
        raftConsensus,
        stateReplication,
        nodeSync
      });
      
      // Stub per i metodi che interagiscono con il filesystem o la rete
      sinon.stub(raftConsensus, '_ensureLogDirectory').resolves();
      sinon.stub(raftConsensus, '_loadPersistentState').resolves();
      sinon.stub(raftConsensus, '_savePersistentState').resolves();
      sinon.stub(raftConsensus, '_appendEntries').resolves(true);
      sinon.stub(raftConsensus, '_requestVote').resolves(true);
      
      sinon.stub(stateReplication.stateStore, 'initialize').resolves(true);
      sinon.stub(stateReplication.stateStore, 'close').resolves(true);
      sinon.stub(stateReplication.stateStore, 'apply').resolves({ success: true });
      sinon.stub(stateReplication.stateStore, 'getStateSize').resolves(1024);
      sinon.stub(stateReplication.replicationLog, 'initialize').resolves(true);
      sinon.stub(stateReplication.replicationLog, 'close').resolves(true);
      sinon.stub(stateReplication.replicationLog, 'append').resolves({ index: 0, transaction: {} });
      
      // Avvia il sequencer
      await sequencer.start();
      
      // Configura il sequencer come leader
      raftConsensus.state = 'leader';
      raftConsensus.emit('leader', { term: 1, nodeId: 'node1' });
      stateReplication.setAsLeader(['node2', 'node3']);
    });
    
    after(async () => {
      // Arresta il sequencer
      await sequencer.stop();
      
      // Ripristina tutti gli stub
      sinon.restore();
    });
    
    it('dovrebbe elaborare una transazione utilizzando un segreto', async () => {
      // Ottieni un segreto dal sistema di gestione dei segreti
      const apiKey = await secretsSystem.secretCache.getSecret('api-key');
      
      // Crea una transazione di test che utilizza il segreto
      const transaction = {
        type: 'api-call',
        endpoint: 'https://api.example.com/data',
        apiKey: apiKey.apiKey,
        timestamp: new Date().toISOString()
      };
      
      // Elabora la transazione
      const result = await sequencer.processTransaction(transaction);
      
      // Verifica che la transazione sia stata elaborata correttamente
      expect(result).to.have.property('id');
      expect(result).to.have.property('status', 'pending');
    });
    
    it('dovrebbe gestire un ciclo completo di elaborazione delle transazioni', async () => {
      // Crea una serie di transazioni di test
      const transactions = [
        {
          type: 'deposit',
          amount: 100,
          account: 'user1',
          timestamp: new Date().toISOString()
        },
        {
          type: 'deposit',
          amount: 200,
          account: 'user2',
          timestamp: new Date().toISOString()
        },
        {
          type: 'transfer',
          amount: 50,
          fromAccount: 'user1',
          toAccount: 'user2',
          timestamp: new Date().toISOString()
        }
      ];
      
      // Elabora le transazioni in sequenza
      const results = [];
      for (const transaction of transactions) {
        const result = await sequencer.processTransaction(transaction);
        results.push(result);
      }
      
      // Verifica che tutte le transazioni siano state elaborate correttamente
      expect(results).to.have.lengthOf(3);
      results.forEach(result => {
        expect(result).to.have.property('id');
        expect(result).to.have.property('status', 'pending');
      });
      
      // Verifica che lo stato sia stato aggiornato correttamente
      expect(sequencer.stateReplication.stateStore.apply.callCount).to.equal(3);
    });
  });
});
