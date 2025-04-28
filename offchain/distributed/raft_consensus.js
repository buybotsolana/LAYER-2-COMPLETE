/**
 * @fileoverview Implementazione dell'algoritmo di consenso Raft
 * 
 * Questo modulo implementa l'algoritmo di consenso Raft per l'elezione del leader
 * e la replicazione del log in un sistema distribuito.
 * 
 * Raft è un algoritmo di consenso progettato per essere facilmente comprensibile.
 * Separa gli elementi chiave del consenso, come l'elezione del leader,
 * la replicazione del log e la sicurezza.
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { Logger } = require('../logger');

// Configurazione del logger
const logger = new Logger('raft-consensus');

// Stati possibili di un nodo Raft
const RaftState = {
  FOLLOWER: 'follower',
  CANDIDATE: 'candidate',
  LEADER: 'leader'
};

/**
 * Classe RaftConsensus
 * 
 * Implementa l'algoritmo di consenso Raft per l'elezione del leader
 * e la replicazione del log in un sistema distribuito.
 */
class RaftConsensus extends EventEmitter {
  /**
   * Crea una nuova istanza di RaftConsensus
   * @param {Object} config - Configurazione per il consenso Raft
   * @param {string} config.nodeId - Identificatore univoco del nodo
   * @param {Array<string>} config.peers - Lista degli indirizzi dei peer
   * @param {number} config.electionTimeoutMin - Timeout minimo per l'elezione (ms)
   * @param {number} config.electionTimeoutMax - Timeout massimo per l'elezione (ms)
   * @param {number} config.heartbeatInterval - Intervallo per l'invio di heartbeat (ms)
   * @param {string} config.logPath - Percorso per il salvataggio del log
   * @param {number} config.snapshotInterval - Intervallo per la creazione di snapshot (numero di entry)
   * @param {number} config.snapshotThreshold - Soglia per la creazione di snapshot (dimensione del log)
   */
  constructor(config) {
    super();
    this.nodeId = config.nodeId;
    this.peers = config.peers || [];
    this.electionTimeoutMin = config.electionTimeoutMin || 150;
    this.electionTimeoutMax = config.electionTimeoutMax || 300;
    this.heartbeatInterval = config.heartbeatInterval || 50;
    this.logPath = config.logPath || './logs/raft';
    this.snapshotInterval = config.snapshotInterval || 1000;
    this.snapshotThreshold = config.snapshotThreshold || 10000;
    
    // Stato del nodo
    this.state = RaftState.FOLLOWER;
    this.currentTerm = 0;
    this.votedFor = null;
    this.log = [];
    this.commitIndex = 0;
    this.lastApplied = 0;
    this.leaderId = null;
    
    // Stato del leader (valido solo se state === LEADER)
    this.nextIndex = {};
    this.matchIndex = {};
    
    // Timer per l'elezione e l'heartbeat
    this.electionTimer = null;
    this.heartbeatTimer = null;
    
    // Flag per indicare se il nodo è in esecuzione
    this.running = false;
    
    // Metriche
    this.metrics = {
      electionsInitiated: 0,
      heartbeatsSent: 0,
      heartbeatsReceived: 0,
      votesReceived: 0,
      logEntriesAppended: 0,
      snapshotsCreated: 0
    };
    
    logger.info(`RaftConsensus inizializzato con nodeId: ${this.nodeId}`);
  }
  
  /**
   * Avvia il nodo Raft
   * @returns {Promise<boolean>} True se l'avvio è riuscito
   */
  async start() {
    try {
      logger.info(`Avvio nodo Raft (nodeId: ${this.nodeId})`);
      
      // Crea la directory per i log se non esiste
      await this._ensureLogDirectory();
      
      // Carica lo stato persistente
      await this._loadPersistentState();
      
      // Imposta il nodo come follower
      this._becomeFollower(this.currentTerm);
      
      // Imposta il flag running
      this.running = true;
      
      logger.info(`Nodo Raft avviato con successo (nodeId: ${this.nodeId})`);
      return true;
    } catch (error) {
      logger.error(`Errore durante l'avvio del nodo Raft: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Arresta il nodo Raft
   * @returns {Promise<boolean>} True se l'arresto è riuscito
   */
  async stop() {
    try {
      logger.info(`Arresto nodo Raft (nodeId: ${this.nodeId})`);
      
      // Ferma i timer
      this._stopElectionTimer();
      this._stopHeartbeatTimer();
      
      // Salva lo stato persistente
      await this._savePersistentState();
      
      // Imposta il flag running
      this.running = false;
      
      logger.info(`Nodo Raft arrestato con successo (nodeId: ${this.nodeId})`);
      return true;
    } catch (error) {
      logger.error(`Errore durante l'arresto del nodo Raft: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Assicura che la directory per i log esista
   * @private
   */
  async _ensureLogDirectory() {
    try {
      await fs.mkdir(this.logPath, { recursive: true });
    } catch (error) {
      logger.error(`Errore durante la creazione della directory per i log: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Carica lo stato persistente dal disco
   * @private
   */
  async _loadPersistentState() {
    try {
      const statePath = path.join(this.logPath, `${this.nodeId}-state.json`);
      const logPath = path.join(this.logPath, `${this.nodeId}-log.json`);
      
      // Carica lo stato
      try {
        const stateData = await fs.readFile(statePath, 'utf8');
        const state = JSON.parse(stateData);
        this.currentTerm = state.currentTerm || 0;
        this.votedFor = state.votedFor || null;
      } catch (error) {
        // Se il file non esiste, usa i valori di default
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
      
      // Carica il log
      try {
        const logData = await fs.readFile(logPath, 'utf8');
        this.log = JSON.parse(logData);
      } catch (error) {
        // Se il file non esiste, usa un array vuoto
        if (error.code !== 'ENOENT') {
          throw error;
        }
        this.log = [];
      }
      
      logger.info(`Stato persistente caricato: term=${this.currentTerm}, votedFor=${this.votedFor}, logEntries=${this.log.length}`);
    } catch (error) {
      logger.error(`Errore durante il caricamento dello stato persistente: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Salva lo stato persistente su disco
   * @private
   */
  async _savePersistentState() {
    try {
      const statePath = path.join(this.logPath, `${this.nodeId}-state.json`);
      const logPath = path.join(this.logPath, `${this.nodeId}-log.json`);
      
      // Salva lo stato
      const state = {
        currentTerm: this.currentTerm,
        votedFor: this.votedFor
      };
      await fs.writeFile(statePath, JSON.stringify(state, null, 2));
      
      // Salva il log
      await fs.writeFile(logPath, JSON.stringify(this.log, null, 2));
      
      logger.debug(`Stato persistente salvato: term=${this.currentTerm}, votedFor=${this.votedFor}, logEntries=${this.log.length}`);
    } catch (error) {
      logger.error(`Errore durante il salvataggio dello stato persistente: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Imposta il nodo come follower
   * @param {number} term - Termine corrente
   * @private
   */
  _becomeFollower(term) {
    logger.info(`Diventando follower per il termine ${term}`);
    
    // Aggiorna lo stato
    const oldState = this.state;
    this.state = RaftState.FOLLOWER;
    this.currentTerm = term;
    this.votedFor = null;
    this.leaderId = null;
    
    // Ferma il timer di heartbeat se era attivo
    this._stopHeartbeatTimer();
    
    // Avvia il timer di elezione
    this._resetElectionTimer();
    
    // Emetti evento solo se lo stato è cambiato
    if (oldState !== RaftState.FOLLOWER) {
      this.emit('follower', {
        term: this.currentTerm,
        nodeId: this.nodeId
      });
    }
  }
  
  /**
   * Imposta il nodo come candidato e inizia un'elezione
   * @private
   */
  _becomeCandidate() {
    logger.info(`Diventando candidato per il termine ${this.currentTerm + 1}`);
    
    // Aggiorna lo stato
    this.state = RaftState.CANDIDATE;
    this.currentTerm += 1;
    this.votedFor = this.nodeId;
    this.metrics.electionsInitiated++;
    
    // Emetti evento
    this.emit('candidate', {
      term: this.currentTerm,
      nodeId: this.nodeId
    });
    
    // Avvia l'elezione
    this._startElection();
  }
  
  /**
   * Imposta il nodo come leader
   * @private
   */
  _becomeLeader() {
    if (this.state !== RaftState.CANDIDATE) {
      return;
    }
    
    logger.info(`Diventando leader per il termine ${this.currentTerm}`);
    
    // Aggiorna lo stato
    this.state = RaftState.LEADER;
    this.leaderId = this.nodeId;
    
    // Inizializza nextIndex e matchIndex per tutti i peer
    const lastLogIndex = this.log.length > 0 ? this.log.length - 1 : 0;
    this.peers.forEach(peerId => {
      this.nextIndex[peerId] = lastLogIndex + 1;
      this.matchIndex[peerId] = 0;
    });
    
    // Ferma il timer di elezione
    this._stopElectionTimer();
    
    // Avvia il timer di heartbeat
    this._startHeartbeatTimer();
    
    // Emetti evento
    this.emit('leader', {
      term: this.currentTerm,
      nodeId: this.nodeId
    });
    
    // Invia immediatamente un heartbeat a tutti i peer
    this._sendHeartbeats();
  }
  
  /**
   * Avvia un'elezione
   * @private
   */
  _startElection() {
    logger.info(`Avvio elezione per il termine ${this.currentTerm}`);
    
    // Vota per se stesso
    let votesReceived = 1; // Il nodo vota per se stesso
    
    // Richiedi voti a tutti i peer
    this.peers.forEach(peerId => {
      this._requestVote(peerId)
        .then(voteGranted => {
          if (!this.running || this.state !== RaftState.CANDIDATE) {
            return;
          }
          
          if (voteGranted) {
            votesReceived++;
            this.metrics.votesReceived++;
            
            // Se abbiamo ricevuto la maggioranza dei voti, diventiamo leader
            const majority = Math.floor((this.peers.length + 1) / 2) + 1;
            if (votesReceived >= majority) {
              this._becomeLeader();
            }
          }
        })
        .catch(error => {
          logger.error(`Errore durante la richiesta di voto a ${peerId}: ${error.message}`);
        });
    });
    
    // Resetta il timer di elezione
    this._resetElectionTimer();
  }
  
  /**
   * Richiede un voto a un peer
   * @param {string} peerId - ID del peer
   * @returns {Promise<boolean>} True se il voto è stato concesso
   * @private
   */
  async _requestVote(peerId) {
    try {
      logger.debug(`Richiesta voto a ${peerId} per il termine ${this.currentTerm}`);
      
      // Prepara i dati della richiesta
      const lastLogIndex = this.log.length > 0 ? this.log.length - 1 : 0;
      const lastLogTerm = this.log.length > 0 ? this.log[lastLogIndex].term : 0;
      
      const requestVoteArgs = {
        term: this.currentTerm,
        candidateId: this.nodeId,
        lastLogIndex,
        lastLogTerm
      };
      
      // Nella versione reale, questo invierebbe una richiesta RPC al peer
      // Per ora, simuliamo una risposta
      
      // Simula un ritardo di rete (10-50ms)
      await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 40));
      
      // Simula una risposta
      const response = {
        term: this.currentTerm,
        voteGranted: Math.random() > 0.3 // 70% di probabilità di successo
      };
      
      // Se il termine nella risposta è maggiore del nostro, diventiamo follower
      if (response.term > this.currentTerm) {
        this._becomeFollower(response.term);
        return false;
      }
      
      return response.voteGranted;
    } catch (error) {
      logger.error(`Errore durante la richiesta di voto a ${peerId}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Gestisce una richiesta di voto da un candidato
   * @param {Object} request - Richiesta di voto
   * @returns {Object} Risposta alla richiesta
   */
  handleRequestVote(request) {
    try {
      logger.debug(`Ricevuta richiesta di voto da ${request.candidateId} per il termine ${request.term}`);
      
      // Se il termine nella richiesta è minore del nostro, rifiuta il voto
      if (request.term < this.currentTerm) {
        return {
          term: this.currentTerm,
          voteGranted: false
        };
      }
      
      // Se il termine nella richiesta è maggiore del nostro, diventiamo follower
      if (request.term > this.currentTerm) {
        this._becomeFollower(request.term);
      }
      
      // Controlla se possiamo votare per questo candidato
      const canVote = (
        // Non abbiamo ancora votato in questo termine o abbiamo già votato per questo candidato
        (this.votedFor === null || this.votedFor === request.candidateId) &&
        // Il log del candidato è almeno aggiornato quanto il nostro
        this._isLogUpToDate(request.lastLogIndex, request.lastLogTerm)
      );
      
      if (canVote) {
        // Vota per il candidato
        this.votedFor = request.candidateId;
        
        // Resetta il timer di elezione
        this._resetElectionTimer();
        
        logger.info(`Votato per ${request.candidateId} nel termine ${this.currentTerm}`);
      }
      
      return {
        term: this.currentTerm,
        voteGranted: canVote
      };
    } catch (error) {
      logger.error(`Errore durante la gestione della richiesta di voto: ${error.message}`);
      return {
        term: this.currentTerm,
        voteGranted: false
      };
    }
  }
  
  /**
   * Verifica se il log del candidato è almeno aggiornato quanto il nostro
   * @param {number} lastLogIndex - Ultimo indice del log del candidato
   * @param {number} lastLogTerm - Ultimo termine del log del candidato
   * @returns {boolean} True se il log del candidato è almeno aggiornato quanto il nostro
   * @private
   */
  _isLogUpToDate(lastLogIndex, lastLogTerm) {
    const myLastLogIndex = this.log.length > 0 ? this.log.length - 1 : 0;
    const myLastLogTerm = this.log.length > 0 ? this.log[myLastLogIndex].term : 0;
    
    // Se i termini sono diversi, il log più aggiornato è quello con il termine maggiore
    if (lastLogTerm !== myLastLogTerm) {
      return lastLogTerm > myLastLogTerm;
    }
    
    // Se i termini sono uguali, il log più aggiornato è quello più lungo
    return lastLogIndex >= myLastLogIndex;
  }
  
  /**
   * Avvia il timer di heartbeat
   * @private
   */
  _startHeartbeatTimer() {
    // Ferma il timer esistente se presente
    this._stopHeartbeatTimer();
    
    // Avvia un nuovo timer
    this.heartbeatTimer = setInterval(() => {
      this._sendHeartbeats();
    }, this.heartbeatInterval);
  }
  
  /**
   * Ferma il timer di heartbeat
   * @private
   */
  _stopHeartbeatTimer() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  
  /**
   * Invia heartbeat a tutti i peer
   * @private
   */
  _sendHeartbeats() {
    if (this.state !== RaftState.LEADER) {
      return;
    }
    
    logger.debug(`Invio heartbeat a tutti i peer (term=${this.currentTerm})`);
    
    this.peers.forEach(peerId => {
      this._appendEntries(peerId, [])
        .catch(error => {
          logger.error(`Errore durante l'invio dell'heartbeat a ${peerId}: ${error.message}`);
        });
    });
    
    this.metrics.heartbeatsSent += this.peers.length;
  }
  
  /**
   * Invia una richiesta AppendEntries a un peer
   * @param {string} peerId - ID del peer
   * @param {Array} entries - Entry da aggiungere
   * @returns {Promise<boolean>} True se l'operazione è riuscita
   * @private
   */
  async _appendEntries(peerId, entries = []) {
    try {
      // Prepara i dati della richiesta
      const prevLogIndex = this.nextIndex[peerId] - 1;
      const prevLogTerm = prevLogIndex >= 0 && this.log[prevLogIndex]
        ? this.log[prevLogIndex].term
        : 0;
      
      const appendEntriesArgs = {
        term: this.currentTerm,
        leaderId: this.nodeId,
        prevLogIndex,
        prevLogTerm,
        entries: entries.length > 0 ? entries : [],
        leaderCommit: this.commitIndex
      };
      
      // Nella versione reale, questo invierebbe una richiesta RPC al peer
      // Per ora, simuliamo una risposta
      
      // Simula un ritardo di rete (5-20ms)
      await new Promise(resolve => setTimeout(resolve, 5 + Math.random() * 15));
      
      // Simula una risposta
      const response = {
        term: this.currentTerm,
        success: Math.random() > 0.1 // 90% di probabilità di successo
      };
      
      // Se il termine nella risposta è maggiore del nostro, diventiamo follower
      if (response.term > this.currentTerm) {
        this._becomeFollower(response.term);
        return false;
      }
      
      // Se l'operazione è riuscita
      if (response.success) {
        if (entries.length > 0) {
          // Aggiorna nextIndex e matchIndex
          this.nextIndex[peerId] = prevLogIndex + entries.length + 1;
          this.matchIndex[peerId] = prevLogIndex + entries.length;
          
          // Aggiorna commitIndex se necessario
          this._updateCommitIndex();
        }
        return true;
      } else {
        // Se l'operazione è fallita, decrementa nextIndex e riprova
        this.nextIndex[peerId] = Math.max(1, this.nextIndex[peerId] - 1);
        return false;
      }
    } catch (error) {
      logger.error(`Errore durante l'invio di AppendEntries a ${peerId}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Gestisce una richiesta AppendEntries da un leader
   * @param {Object} request - Richiesta AppendEntries
   * @returns {Object} Risposta alla richiesta
   */
  handleAppendEntries(request) {
    try {
      // Se il termine nella richiesta è minore del nostro, rifiuta la richiesta
      if (request.term < this.currentTerm) {
        return {
          term: this.currentTerm,
          success: false
        };
      }
      
      // Resetta il timer di elezione
      this._resetElectionTimer();
      
      // Se il termine nella richiesta è maggiore del nostro, diventiamo follower
      if (request.term > this.currentTerm) {
        this._becomeFollower(request.term);
      } else if (this.state === RaftState.CANDIDATE) {
        // Se siamo candidati e riceviamo un AppendEntries valido, diventiamo follower
        this._becomeFollower(request.term);
      }
      
      // Aggiorna il leaderId
      this.leaderId = request.leaderId;
      
      // Emetti evento di heartbeat
      this.emit('heartbeat', {
        leaderId: request.leaderId,
        term: request.term,
        nodeId: this.nodeId
      });
      
      this.metrics.heartbeatsReceived++;
      
      // Verifica la consistenza del log
      if (request.prevLogIndex >= 0) {
        // Se il nostro log è più corto del prevLogIndex, rifiuta la richiesta
        if (this.log.length <= request.prevLogIndex) {
          return {
            term: this.currentTerm,
            success: false
          };
        }
        
        // Se il termine dell'entry al prevLogIndex non corrisponde, rifiuta la richiesta
        if (this.log[request.prevLogIndex] && this.log[request.prevLogIndex].term !== request.prevLogTerm) {
          // Elimina l'entry conflittuale e tutte quelle successive
          this.log = this.log.slice(0, request.prevLogIndex);
          return {
            term: this.currentTerm,
            success: false
          };
        }
      }
      
      // Aggiungi le nuove entry al log
      if (request.entries.length > 0) {
        // Elimina le entry conflittuali
        this.log = this.log.slice(0, request.prevLogIndex + 1);
        
        // Aggiungi le nuove entry
        this.log = [...this.log, ...request.entries];
        
        this.metrics.logEntriesAppended += request.entries.length;
        
        logger.debug(`Aggiunte ${request.entries.length} entry al log (indice: ${request.prevLogIndex + 1})`);
      }
      
      // Aggiorna commitIndex se necessario
      if (request.leaderCommit > this.commitIndex) {
        const lastNewIndex = request.prevLogIndex + request.entries.length;
        this.commitIndex = Math.min(request.leaderCommit, lastNewIndex);
        
        // Applica le entry committate
        this._applyCommittedEntries();
      }
      
      return {
        term: this.currentTerm,
        success: true
      };
    } catch (error) {
      logger.error(`Errore durante la gestione di AppendEntries: ${error.message}`);
      return {
        term: this.currentTerm,
        success: false
      };
    }
  }
  
  /**
   * Aggiorna il commitIndex del leader
   * @private
   */
  _updateCommitIndex() {
    if (this.state !== RaftState.LEADER) {
      return;
    }
    
    // Per ogni indice N > commitIndex
    for (let n = this.commitIndex + 1; n < this.log.length; n++) {
      // Se l'entry è del termine corrente
      if (this.log[n].term === this.currentTerm) {
        // Conta quanti nodi hanno replicato questa entry
        let replicatedCount = 1; // Il leader stesso
        
        for (const peerId of this.peers) {
          if (this.matchIndex[peerId] >= n) {
            replicatedCount++;
          }
        }
        
        // Se la maggioranza ha replicato questa entry, aggiorna commitIndex
        const majority = Math.floor((this.peers.length + 1) / 2) + 1;
        if (replicatedCount >= majority) {
          this.commitIndex = n;
          
          // Applica le entry committate
          this._applyCommittedEntries();
        }
      }
    }
  }
  
  /**
   * Applica le entry committate
   * @private
   */
  _applyCommittedEntries() {
    // Applica tutte le entry committate ma non ancora applicate
    for (let i = this.lastApplied + 1; i <= this.commitIndex; i++) {
      const entry = this.log[i];
      
      // Applica l'entry
      this._applyLogEntry(entry, i);
      
      // Aggiorna lastApplied
      this.lastApplied = i;
    }
  }
  
  /**
   * Applica un'entry del log
   * @param {Object} entry - Entry da applicare
   * @param {number} index - Indice dell'entry
   * @private
   */
  _applyLogEntry(entry, index) {
    try {
      logger.debug(`Applicazione entry ${index}: ${JSON.stringify(entry)}`);
      
      // Emetti evento di entry applicata
      this.emit('entry-applied', {
        entry,
        index,
        term: entry.term,
        nodeId: this.nodeId
      });
    } catch (error) {
      logger.error(`Errore durante l'applicazione dell'entry ${index}: ${error.message}`);
    }
  }
  
  /**
   * Aggiunge una nuova entry al log
   * @param {Object} data - Dati da aggiungere al log
   * @returns {Promise<number>} Indice dell'entry aggiunta
   */
  async appendLogEntry(data) {
    try {
      // Verifica che siamo leader
      if (this.state !== RaftState.LEADER) {
        throw new Error('Solo il leader può aggiungere entry al log');
      }
      
      // Crea una nuova entry
      const entry = {
        term: this.currentTerm,
        data,
        timestamp: Date.now()
      };
      
      // Aggiungi l'entry al log
      this.log.push(entry);
      const entryIndex = this.log.length - 1;
      
      logger.debug(`Aggiunta entry al log (indice: ${entryIndex}): ${JSON.stringify(data)}`);
      
      // Replica l'entry a tutti i peer
      const replicationPromises = this.peers.map(peerId => {
        return this._replicateEntryToPeer(peerId, entryIndex);
      });
      
      // Attendi che la maggioranza dei nodi abbia replicato l'entry
      const majority = Math.floor((this.peers.length + 1) / 2) + 1;
      let replicatedCount = 1; // Il leader stesso
      
      for (const success of await Promise.allSettled(replicationPromises)) {
        if (success.status === 'fulfilled' && success.value) {
          replicatedCount++;
          
          // Se abbiamo raggiunto la maggioranza, possiamo committare l'entry
          if (replicatedCount >= majority) {
            this.commitIndex = entryIndex;
            this._applyCommittedEntries();
            break;
          }
        }
      }
      
      // Salva lo stato persistente
      await this._savePersistentState();
      
      // Crea uno snapshot se necessario
      if (this.log.length % this.snapshotInterval === 0 || this.log.length >= this.snapshotThreshold) {
        await this._createSnapshot();
      }
      
      return entryIndex;
    } catch (error) {
      logger.error(`Errore durante l'aggiunta di un'entry al log: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Replica un'entry a un peer
   * @param {string} peerId - ID del peer
   * @param {number} entryIndex - Indice dell'entry da replicare
   * @returns {Promise<boolean>} True se la replicazione è riuscita
   * @private
   */
  async _replicateEntryToPeer(peerId, entryIndex) {
    try {
      // Ottieni le entry da inviare
      const entries = this.log.slice(this.nextIndex[peerId]);
      
      // Se non ci sono entry da inviare, invia un heartbeat
      if (entries.length === 0) {
        return true;
      }
      
      // Invia le entry al peer
      const success = await this._appendEntries(peerId, entries);
      
      return success;
    } catch (error) {
      logger.error(`Errore durante la replicazione dell'entry a ${peerId}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Crea uno snapshot del log
   * @returns {Promise<Object>} Snapshot creato
   * @private
   */
  async _createSnapshot() {
    try {
      logger.info(`Creazione snapshot (lastApplied: ${this.lastApplied})`);
      
      // Crea lo snapshot
      const snapshot = {
        lastIncludedIndex: this.lastApplied,
        lastIncludedTerm: this.log[this.lastApplied].term,
        data: this.log.slice(0, this.lastApplied + 1),
        timestamp: Date.now()
      };
      
      // Salva lo snapshot su disco
      const snapshotPath = path.join(this.logPath, `${this.nodeId}-snapshot-${snapshot.lastIncludedIndex}.json`);
      await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));
      
      // Aggiorna le metriche
      this.metrics.snapshotsCreated++;
      
      logger.info(`Snapshot creato con successo (lastIncludedIndex: ${snapshot.lastIncludedIndex})`);
      
      return snapshot;
    } catch (error) {
      logger.error(`Errore durante la creazione dello snapshot: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Avvia il timer di elezione
   * @private
   */
  _resetElectionTimer() {
    // Ferma il timer esistente se presente
    this._stopElectionTimer();
    
    // Calcola un timeout casuale
    const timeout = this.electionTimeoutMin + Math.random() * (this.electionTimeoutMax - this.electionTimeoutMin);
    
    // Avvia un nuovo timer
    this.electionTimer = setTimeout(() => {
      // Se siamo ancora follower o candidato, inizia una nuova elezione
      if ((this.state === RaftState.FOLLOWER || this.state === RaftState.CANDIDATE) && this.running) {
        this._becomeCandidate();
      }
    }, timeout);
  }
  
  /**
   * Ferma il timer di elezione
   * @private
   */
  _stopElectionTimer() {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }
  }
  
  /**
   * Ottiene lo stato corrente del nodo Raft
   * @returns {Object} Stato corrente
   */
  getStatus() {
    return {
      nodeId: this.nodeId,
      state: this.state,
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
      leaderId: this.leaderId,
      commitIndex: this.commitIndex,
      lastApplied: this.lastApplied,
      logLength: this.log.length,
      peers: this.peers,
      metrics: this.metrics,
      timestamp: Date.now()
    };
  }
}

module.exports = { RaftConsensus, RaftState };
