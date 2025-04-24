/**
 * @fileoverview Test unitari per il sistema di sequencer distribuito
 * 
 * Questo file contiene test unitari per verificare il corretto funzionamento
 * del sistema di sequencer distribuito basato su Raft.
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { DistributedSequencer } = require('../../offchain/distributed/distributed_sequencer');
const { RaftConsensus, RaftState } = require('../../offchain/distributed/raft_consensus');
const { StateReplication } = require('../../offchain/distributed/state_replication');
const { NodeSynchronization } = require('../../offchain/distributed/node_synchronization');

describe('Distributed Sequencer System', () => {
  // Test per DistributedSequencer
  describe('DistributedSequencer', () => {
    let sequencer;
    let mockRaftConsensus;
    let mockStateReplication;
    let mockNodeSync;
    
    beforeEach(() => {
      // Crea mock per le dipendenze
      mockRaftConsensus = {
        start: sinon.stub().resolves(true),
        stop: sinon.stub().resolves(true),
        on: sinon.stub(),
        getStatus: sinon.stub().returns({
          state: RaftState.FOLLOWER,
          currentTerm: 1,
          leaderId: 'node2',
          nodeId: 'node1'
        }),
        appendLogEntry: sinon.stub().resolves(0),
        setAsLeader: sinon.stub(),
        setAsFollower: sinon.stub()
      };
      
      mockStateReplication = {
        start: sinon.stub().resolves(true),
        stop: sinon.stub().resolves(true),
        applyTransaction: sinon.stub().resolves({ success: true }),
        on: sinon.stub(),
        getStatus: sinon.stub().returns({
          isLeader: false,
          metrics: { transactionsApplied: 0 }
        }),
        setAsLeader: sinon.stub(),
        setAsFollower: sinon.stub()
      };
      
      mockNodeSync = {
        syncNewNode: sinon.stub().resolves(true),
        on: sinon.stub()
      };
      
      // Crea l'istanza di DistributedSequencer con i mock
      sequencer = new DistributedSequencer({
        nodeId: 'node1',
        peers: ['node2', 'node3'],
        raftConsensus: mockRaftConsensus,
        stateReplication: mockStateReplication,
        nodeSync: mockNodeSync
      });
    });
    
    afterEach(() => {
      sinon.restore();
    });
    
    it('dovrebbe inizializzarsi correttamente', () => {
      expect(sequencer).to.be.an.instanceOf(DistributedSequencer);
      expect(sequencer.nodeId).to.equal('node1');
      expect(sequencer.peers).to.deep.equal(['node2', 'node3']);
    });
    
    it('dovrebbe avviarsi correttamente', async () => {
      const result = await sequencer.start();
      
      expect(result).to.be.true;
      expect(mockRaftConsensus.start.calledOnce).to.be.true;
      expect(mockStateReplication.start.calledOnce).to.be.true;
    });
    
    it('dovrebbe arrestarsi correttamente', async () => {
      const result = await sequencer.stop();
      
      expect(result).to.be.true;
      expect(mockRaftConsensus.stop.calledOnce).to.be.true;
      expect(mockStateReplication.stop.calledOnce).to.be.true;
    });
    
    it('dovrebbe elaborare una transazione come follower', async () => {
      // Configura il mock per simulare un nodo follower
      mockRaftConsensus.getStatus.returns({
        state: RaftState.FOLLOWER,
        currentTerm: 1,
        leaderId: 'node2',
        nodeId: 'node1'
      });
      
      const transaction = { type: 'deposit', amount: 100, account: 'user1' };
      
      // Simula una risposta dal leader
      const mockResponse = { id: 'tx123', status: 'pending' };
      sequencer.forwardTransactionToLeader = sinon.stub().resolves(mockResponse);
      
      const result = await sequencer.processTransaction(transaction);
      
      expect(result).to.deep.equal(mockResponse);
      expect(sequencer.forwardTransactionToLeader.calledOnce).to.be.true;
      expect(sequencer.forwardTransactionToLeader.calledWith('node2', transaction)).to.be.true;
    });
    
    it('dovrebbe elaborare una transazione come leader', async () => {
      // Configura il mock per simulare un nodo leader
      mockRaftConsensus.getStatus.returns({
        state: RaftState.LEADER,
        currentTerm: 1,
        leaderId: 'node1',
        nodeId: 'node1'
      });
      
      mockStateReplication.getStatus.returns({
        isLeader: true,
        metrics: { transactionsApplied: 0 }
      });
      
      const transaction = { type: 'deposit', amount: 100, account: 'user1' };
      
      // Simula l'aggiunta dell'entry al log
      mockRaftConsensus.appendLogEntry.resolves(5);
      
      const result = await sequencer.processTransaction(transaction);
      
      expect(result).to.have.property('id');
      expect(result).to.have.property('status', 'pending');
      expect(mockRaftConsensus.appendLogEntry.calledOnce).to.be.true;
    });
    
    it('dovrebbe gestire correttamente l\'evento di elezione a leader', () => {
      // Simula l'evento di elezione a leader
      const leaderCallback = mockRaftConsensus.on.withArgs('leader').getCall(0).args[1];
      leaderCallback({ term: 2, nodeId: 'node1' });
      
      expect(mockStateReplication.setAsLeader.calledOnce).to.be.true;
      expect(mockStateReplication.setAsLeader.calledWith(['node2', 'node3'])).to.be.true;
    });
    
    it('dovrebbe gestire correttamente l\'evento di diventare follower', () => {
      // Simula l'evento di diventare follower
      const followerCallback = mockRaftConsensus.on.withArgs('follower').getCall(0).args[1];
      followerCallback({ term: 2, nodeId: 'node1' });
      
      expect(mockStateReplication.setAsFollower.calledOnce).to.be.true;
    });
    
    it('dovrebbe ottenere lo stato correttamente', () => {
      const status = sequencer.getStatus();
      
      expect(status).to.have.property('nodeId', 'node1');
      expect(status).to.have.property('isLeader', false);
      expect(status).to.have.property('raftStatus');
      expect(status).to.have.property('replicationStatus');
    });
  });
  
  // Test per RaftConsensus
  describe('RaftConsensus', () => {
    let raftConsensus;
    
    beforeEach(() => {
      // Crea l'istanza di RaftConsensus
      raftConsensus = new RaftConsensus({
        nodeId: 'node1',
        peers: ['node2', 'node3'],
        electionTimeoutMin: 150,
        electionTimeoutMax: 300,
        heartbeatInterval: 50,
        logPath: './test-logs/raft'
      });
      
      // Stub per i metodi che interagiscono con il filesystem
      sinon.stub(raftConsensus, '_ensureLogDirectory').resolves();
      sinon.stub(raftConsensus, '_loadPersistentState').resolves();
      sinon.stub(raftConsensus, '_savePersistentState').resolves();
      
      // Stub per i timer
      sinon.stub(raftConsensus, '_resetElectionTimer');
      sinon.stub(raftConsensus, '_stopElectionTimer');
      sinon.stub(raftConsensus, '_startHeartbeatTimer');
      sinon.stub(raftConsensus, '_stopHeartbeatTimer');
    });
    
    afterEach(() => {
      sinon.restore();
    });
    
    it('dovrebbe inizializzarsi correttamente', () => {
      expect(raftConsensus).to.be.an.instanceOf(RaftConsensus);
      expect(raftConsensus.nodeId).to.equal('node1');
      expect(raftConsensus.peers).to.deep.equal(['node2', 'node3']);
      expect(raftConsensus.state).to.equal(RaftState.FOLLOWER);
    });
    
    it('dovrebbe avviarsi correttamente', async () => {
      const result = await raftConsensus.start();
      
      expect(result).to.be.true;
      expect(raftConsensus._ensureLogDirectory.calledOnce).to.be.true;
      expect(raftConsensus._loadPersistentState.calledOnce).to.be.true;
      expect(raftConsensus._resetElectionTimer.calledOnce).to.be.true;
      expect(raftConsensus.running).to.be.true;
    });
    
    it('dovrebbe arrestarsi correttamente', async () => {
      // Prima avvia il nodo
      await raftConsensus.start();
      
      const result = await raftConsensus.stop();
      
      expect(result).to.be.true;
      expect(raftConsensus._stopElectionTimer.calledOnce).to.be.true;
      expect(raftConsensus._stopHeartbeatTimer.calledOnce).to.be.true;
      expect(raftConsensus._savePersistentState.calledOnce).to.be.true;
      expect(raftConsensus.running).to.be.false;
    });
    
    it('dovrebbe diventare candidato e iniziare un\'elezione', () => {
      // Stub per il metodo _startElection
      sinon.stub(raftConsensus, '_startElection');
      
      // Chiama il metodo _becomeCandidate
      raftConsensus._becomeCandidate();
      
      expect(raftConsensus.state).to.equal(RaftState.CANDIDATE);
      expect(raftConsensus.currentTerm).to.equal(1); // Incrementato da 0 a 1
      expect(raftConsensus.votedFor).to.equal('node1'); // Vota per se stesso
      expect(raftConsensus._startElection.calledOnce).to.be.true;
    });
    
    it('dovrebbe diventare leader dopo aver ricevuto la maggioranza dei voti', () => {
      // Configura il nodo come candidato
      raftConsensus.state = RaftState.CANDIDATE;
      raftConsensus.currentTerm = 1;
      raftConsensus.votedFor = 'node1';
      
      // Stub per il metodo _sendHeartbeats
      sinon.stub(raftConsensus, '_sendHeartbeats');
      
      // Chiama il metodo _becomeLeader
      raftConsensus._becomeLeader();
      
      expect(raftConsensus.state).to.equal(RaftState.LEADER);
      expect(raftConsensus.leaderId).to.equal('node1');
      expect(raftConsensus._stopElectionTimer.calledOnce).to.be.true;
      expect(raftConsensus._startHeartbeatTimer.calledOnce).to.be.true;
      expect(raftConsensus._sendHeartbeats.calledOnce).to.be.true;
    });
    
    it('dovrebbe gestire correttamente una richiesta di voto', () => {
      // Configura il nodo
      raftConsensus.currentTerm = 1;
      raftConsensus.votedFor = null;
      raftConsensus.log = [];
      
      // Crea una richiesta di voto
      const request = {
        term: 2, // Termine maggiore del termine corrente
        candidateId: 'node2',
        lastLogIndex: 0,
        lastLogTerm: 0
      };
      
      // Gestisci la richiesta di voto
      const response = raftConsensus.handleRequestVote(request);
      
      expect(response.term).to.equal(2); // Il termine è stato aggiornato
      expect(response.voteGranted).to.be.true; // Il voto è stato concesso
      expect(raftConsensus.state).to.equal(RaftState.FOLLOWER); // Il nodo è diventato follower
      expect(raftConsensus.currentTerm).to.equal(2); // Il termine è stato aggiornato
      expect(raftConsensus.votedFor).to.equal('node2'); // Ha votato per il candidato
    });
    
    it('dovrebbe aggiungere una entry al log', async () => {
      // Configura il nodo come leader
      raftConsensus.state = RaftState.LEADER;
      raftConsensus.currentTerm = 1;
      raftConsensus.log = [];
      raftConsensus.commitIndex = 0;
      raftConsensus.lastApplied = 0;
      
      // Stub per i metodi che interagiscono con i peer
      sinon.stub(raftConsensus, '_replicateEntryToPeer').resolves(true);
      
      // Dati da aggiungere al log
      const data = { type: 'deposit', amount: 100, account: 'user1' };
      
      // Aggiungi l'entry al log
      const entryIndex = await raftConsensus.appendLogEntry(data);
      
      expect(entryIndex).to.equal(0); // Prima entry, indice 0
      expect(raftConsensus.log.length).to.equal(1);
      expect(raftConsensus.log[0].term).to.equal(1);
      expect(raftConsensus.log[0].data).to.deep.equal(data);
      expect(raftConsensus._replicateEntryToPeer.callCount).to.equal(2); // Una chiamata per ogni peer
    });
  });
  
  // Test per StateReplication
  describe('StateReplication', () => {
    let stateReplication;
    
    beforeEach(() => {
      // Crea l'istanza di StateReplication
      stateReplication = new StateReplication({
        storeConfig: {
          storePath: './test-data/state'
        },
        logConfig: {
          logPath: './test-logs/replication'
        }
      });
      
      // Stub per i metodi delle classi interne
      sinon.stub(stateReplication.stateStore, 'initialize').resolves(true);
      sinon.stub(stateReplication.stateStore, 'close').resolves(true);
      sinon.stub(stateReplication.stateStore, 'apply').resolves({ success: true });
      sinon.stub(stateReplication.stateStore, 'getStateSize').resolves(1024);
      
      sinon.stub(stateReplication.replicationLog, 'initialize').resolves(true);
      sinon.stub(stateReplication.replicationLog, 'close').resolves(true);
      sinon.stub(stateReplication.replicationLog, 'append').resolves({ index: 0, transaction: {} });
    });
    
    afterEach(() => {
      sinon.restore();
    });
    
    it('dovrebbe inizializzarsi correttamente', () => {
      expect(stateReplication).to.be.an.instanceOf(StateReplication);
      expect(stateReplication.isLeader).to.be.false;
      expect(stateReplication.followers).to.be.an('array').that.is.empty;
    });
    
    it('dovrebbe avviarsi correttamente', async () => {
      const result = await stateReplication.start();
      
      expect(result).to.be.true;
      expect(stateReplication.stateStore.initialize.calledOnce).to.be.true;
      expect(stateReplication.replicationLog.initialize.calledOnce).to.be.true;
      expect(stateReplication.running).to.be.true;
    });
    
    it('dovrebbe arrestarsi correttamente', async () => {
      // Prima avvia il sistema
      await stateReplication.start();
      
      const result = await stateReplication.stop();
      
      expect(result).to.be.true;
      expect(stateReplication.stateStore.close.calledOnce).to.be.true;
      expect(stateReplication.replicationLog.close.calledOnce).to.be.true;
      expect(stateReplication.running).to.be.false;
    });
    
    it('dovrebbe impostarsi come leader', () => {
      const followers = ['node2', 'node3'];
      
      stateReplication.setAsLeader(followers);
      
      expect(stateReplication.isLeader).to.be.true;
      expect(stateReplication.followers).to.deep.equal(followers);
    });
    
    it('dovrebbe impostarsi come follower', () => {
      // Prima imposta come leader
      stateReplication.setAsLeader(['node2', 'node3']);
      
      stateReplication.setAsFollower();
      
      expect(stateReplication.isLeader).to.be.false;
      expect(stateReplication.followers).to.be.an('array').that.is.empty;
    });
    
    it('dovrebbe applicare una transazione', async () => {
      const transaction = { type: 'deposit', amount: 100, account: 'user1' };
      
      // Stub per il metodo replicateToFollowers
      sinon.stub(stateReplication, 'replicateToFollowers').resolves({ successes: 0, failures: 0 });
      
      const result = await stateReplication.applyTransaction(transaction);
      
      expect(result).to.deep.equal({ success: true });
      expect(stateReplication.replicationLog.append.calledOnce).to.be.true;
      expect(stateReplication.stateStore.apply.calledOnce).to.be.true;
      expect(stateReplication.stateStore.apply.calledWith(transaction)).to.be.true;
    });
    
    it('dovrebbe replicare ai follower quando è leader', async () => {
      // Imposta come leader
      stateReplication.setAsLeader(['node2', 'node3']);
      
      // Stub per il metodo replicateToFollower
      sinon.stub(stateReplication, 'replicateToFollower').resolves(true);
      
      const logEntry = { index: 0, transaction: { type: 'deposit', amount: 100, account: 'user1' } };
      
      const result = await stateReplication.replicateToFollowers(logEntry);
      
      expect(result.successes).to.equal(2);
      expect(result.failures).to.equal(0);
      expect(result.total).to.equal(2);
      expect(stateReplication.replicateToFollower.callCount).to.equal(2);
    });
  });
  
  // Test per NodeSynchronization
  describe('NodeSynchronization', () => {
    let nodeSync;
    let mockStateReplication;
    let mockRaftConsensus;
    
    beforeEach(() => {
      // Crea mock per le dipendenze
      mockStateReplication = {
        createSnapshot: sinon.stub().resolves({ lastIncludedIndex: 0, state: {} }),
        replicationLog: {
          getLastIndex: sinon.stub().returns(10),
          getEntriesAfter: sinon.stub().resolves([])
        }
      };
      
      mockRaftConsensus = {
        state: 'leader',
        nodeId: 'node1'
      };
      
      // Crea l'istanza di NodeSynchronization
      nodeSync = new NodeSynchronization({}, mockStateReplication, mockRaftConsensus);
      
      // Stub per i metodi che interagiscono con i nodi remoti
      sinon.stub(nodeSync, 'sendSnapshot').resolves(true);
      sinon.stub(nodeSync, 'sendEntries').resolves(true);
    });
    
    afterEach(() => {
      sinon.restore();
    });
    
    it('dovrebbe inizializzarsi correttamente', () => {
      expect(nodeSync).to.be.an.instanceOf(NodeSynchronization);
      expect(nodeSync.stateReplication).to.equal(mockStateReplication);
      expect(nodeSync.raftConsensus).to.equal(mockRaftConsensus);
    });
    
    it('dovrebbe sincronizzare un nuovo nodo', async () => {
      const result = await nodeSync.syncNewNode('node4');
      
      expect(result).to.be.true;
      expect(mockStateReplication.createSnapshot.calledOnce).to.be.true;
      expect(mockStateReplication.replicationLog.getLastIndex.calledOnce).to.be.true;
      expect(mockStateReplication.replicationLog.getEntriesAfter.calledOnce).to.be.true;
      expect(nodeSync.sendSnapshot.calledOnce).to.be.true;
      expect(nodeSync.sendEntries.calledOnce).to.be.true;
      expect(nodeSync.metrics.syncSuccesses).to.equal(1);
    });
    
    it('dovrebbe gestire una richiesta di sincronizzazione', async () => {
      const request = { nodeId: 'node4' };
      
      // Stub per il metodo syncNewNode
      sinon.stub(nodeSync, 'syncNewNode').resolves(true);
      
      const response = await nodeSync.handleSyncRequest(request);
      
      expect(response.success).to.be.true;
      expect(nodeSync.syncNewNode.calledOnce).to.be.true;
      expect(nodeSync.syncNewNode.calledWith('node4')).to.be.true;
    });
    
    it('dovrebbe fallire la sincronizzazione se non è leader', async () => {
      // Modifica il mock per simulare un nodo non leader
      mockRaftConsensus.state = 'follower';
      
      const request = { nodeId: 'node4' };
      
      const response = await nodeSync.handleSyncRequest(request);
      
      expect(response.success).to.be.false;
      expect(response.error).to.equal('Solo il leader può sincronizzare nuovi nodi');
    });
    
    it('dovrebbe aggiornare le metriche dopo una sincronizzazione', async () => {
      await nodeSync.syncNewNode('node4');
      
      expect(nodeSync.metrics.syncRequests).to.equal(1);
      expect(nodeSync.metrics.syncSuccesses).to.equal(1);
      expect(nodeSync.metrics.snapshotsSent).to.equal(1);
      expect(nodeSync.metrics.entriesSent).to.equal(0); // Nessuna entry inviata nel test
    });
  });
});
