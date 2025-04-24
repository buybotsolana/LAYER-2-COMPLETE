/**
 * Implementazione di strategie di sharding per il Layer-2 su Solana
 * 
 * Questo modulo implementa diverse strategie di sharding avanzate per il database
 * che consentono di distribuire i dati in modo ottimale su più nodi.
 */

const crypto = require('crypto');
const { Logger } = require('../logger/structured_logger');
const xxhash = require('xxhash');
const murmurhash = require('murmurhash');

/**
 * Classe per la gestione delle strategie di sharding
 */
class ShardingStrategy {
  /**
   * Crea una nuova istanza della strategia di sharding
   * @param {Object} config - Configurazione della strategia
   * @param {Object} logger - Logger strutturato
   */
  constructor(config, logger = null) {
    this.config = config;
    this.logger = logger || new Logger({ service: 'sharding-strategy' });
    
    // Inizializza la strategia
    this.type = config.type || 'hash';
    this.keyField = config.keyField || 'id';
    this.hashFunction = config.hashFunction || 'md5';
    this.shardCount = config.shardCount || 1;
    
    // Inizializza strutture dati specifiche per la strategia
    this._initializeStrategy();
    
    this.logger.info('Strategia di sharding inizializzata', { 
      type: this.type,
      keyField: this.keyField,
      shardCount: this.shardCount
    });
  }
  
  /**
   * Inizializza la strategia di sharding
   * @private
   */
  _initializeStrategy() {
    switch (this.type) {
      case 'hash':
        // Nessuna inizializzazione specifica necessaria
        break;
      case 'range':
        this._initializeRangeStrategy();
        break;
      case 'lookup':
        this._initializeLookupStrategy();
        break;
      case 'consistent-hash':
        this._initializeConsistentHashStrategy();
        break;
      case 'dynamic':
        this._initializeDynamicStrategy();
        break;
      case 'time-based':
        this._initializeTimeBasedStrategy();
        break;
      case 'geo':
        this._initializeGeoStrategy();
        break;
      case 'composite':
        this._initializeCompositeStrategy();
        break;
      default:
        throw new Error(`Strategia di sharding '${this.type}' non supportata`);
    }
  }
  
  /**
   * Inizializza la strategia di sharding basata su range
   * @private
   */
  _initializeRangeStrategy() {
    this.ranges = this.config.ranges || [];
    
    // Se non ci sono range definiti, crea range equidistanti
    if (this.ranges.length === 0) {
      const min = this.config.minValue || 0;
      const max = this.config.maxValue || 1000000;
      const rangeSize = (max - min) / this.shardCount;
      
      for (let i = 0; i < this.shardCount; i++) {
        this.ranges.push({
          min: min + (i * rangeSize),
          max: min + ((i + 1) * rangeSize) - (i === this.shardCount - 1 ? 0 : 1),
          shardId: i
        });
      }
    }
    
    this.logger.info('Strategia di range inizializzata', { 
      rangeCount: this.ranges.length
    });
  }
  
  /**
   * Inizializza la strategia di sharding basata su lookup
   * @private
   */
  _initializeLookupStrategy() {
    this.lookupTable = this.config.lookupTable || {};
    this.defaultShardId = this.config.defaultShardId || 0;
    
    this.logger.info('Strategia di lookup inizializzata', { 
      entriesCount: Object.keys(this.lookupTable).length,
      defaultShardId: this.defaultShardId
    });
  }
  
  /**
   * Inizializza la strategia di sharding basata su consistent hashing
   * @private
   */
  _initializeConsistentHashStrategy() {
    this.virtualNodes = this.config.virtualNodes || 100;
    this.ring = [];
    
    // Crea nodi virtuali per ogni shard
    for (let shardId = 0; shardId < this.shardCount; shardId++) {
      for (let i = 0; i < this.virtualNodes; i++) {
        const nodeKey = `shard-${shardId}-vnode-${i}`;
        const hash = crypto.createHash('md5').update(nodeKey).digest('hex');
        const position = parseInt(hash.substring(0, 8), 16);
        
        this.ring.push({
          shardId,
          virtualNode: i,
          position
        });
      }
    }
    
    // Ordina il ring per posizione
    this.ring.sort((a, b) => a.position - b.position);
    
    this.logger.info('Strategia di consistent hashing inizializzata', {
      shardCount: this.shardCount,
      virtualNodesPerShard: this.virtualNodes,
      totalNodes: this.ring.length
    });
  }
  
  /**
   * Inizializza la strategia di sharding dinamica
   * @private
   */
  _initializeDynamicStrategy() {
    this.loadThreshold = this.config.loadThreshold || 0.8;
    this.rebalanceInterval = this.config.rebalanceInterval || 3600000; // 1 ora
    this.shardLoads = new Map();
    this.shardCapacities = new Map();
    
    // Inizializza i carichi e le capacità degli shard
    for (let shardId = 0; shardId < this.shardCount; shardId++) {
      this.shardLoads.set(shardId, 0);
      this.shardCapacities.set(shardId, this.config.defaultCapacity || 1000);
    }
    
    // Pianifica il ribilanciamento periodico
    this.rebalanceTimer = setInterval(() => {
      this._rebalanceShards();
    }, this.rebalanceInterval);
    
    this.logger.info('Strategia dinamica inizializzata', {
      loadThreshold: this.loadThreshold,
      rebalanceInterval: this.rebalanceInterval,
      shardCount: this.shardCount
    });
  }
  
  /**
   * Inizializza la strategia di sharding basata sul tempo
   * @private
   */
  _initializeTimeBasedStrategy() {
    this.timeField = this.config.timeField || 'timestamp';
    this.timeUnit = this.config.timeUnit || 'day';
    this.timeFormat = this.config.timeFormat || 'YYYY-MM-DD';
    
    // Calcola il divisore per l'unità di tempo
    switch (this.timeUnit) {
      case 'hour':
        this.timeDivisor = 3600000; // 1 ora in ms
        break;
      case 'day':
        this.timeDivisor = 86400000; // 1 giorno in ms
        break;
      case 'week':
        this.timeDivisor = 604800000; // 1 settimana in ms
        break;
      case 'month':
        this.timeDivisor = 2592000000; // 30 giorni in ms
        break;
      case 'year':
        this.timeDivisor = 31536000000; // 365 giorni in ms
        break;
      default:
        this.timeDivisor = 86400000; // Default: 1 giorno in ms
    }
    
    this.logger.info('Strategia basata sul tempo inizializzata', {
      timeField: this.timeField,
      timeUnit: this.timeUnit,
      timeFormat: this.timeFormat
    });
  }
  
  /**
   * Inizializza la strategia di sharding geografica
   * @private
   */
  _initializeGeoStrategy() {
    this.geoField = this.config.geoField || 'location';
    this.regions = this.config.regions || [];
    
    // Se non ci sono regioni definite, crea regioni di default
    if (this.regions.length === 0) {
      this.regions = [
        { name: 'us-east', shardId: 0, bounds: { minLat: 24, maxLat: 50, minLng: -80, maxLng: -60 } },
        { name: 'us-west', shardId: 1, bounds: { minLat: 24, maxLat: 50, minLng: -125, maxLng: -100 } },
        { name: 'eu', shardId: 2, bounds: { minLat: 35, maxLat: 60, minLng: -10, maxLng: 30 } },
        { name: 'asia', shardId: 3, bounds: { minLat: 0, maxLat: 60, minLng: 60, maxLng: 140 } }
      ];
    }
    
    this.defaultRegion = this.config.defaultRegion || { name: 'default', shardId: 0 };
    
    this.logger.info('Strategia geografica inizializzata', {
      regionCount: this.regions.length,
      geoField: this.geoField
    });
  }
  
  /**
   * Inizializza la strategia di sharding composita
   * @private
   */
  _initializeCompositeStrategy() {
    this.strategies = [];
    
    // Inizializza le strategie componenti
    for (const strategyConfig of this.config.strategies || []) {
      this.strategies.push(new ShardingStrategy(strategyConfig, this.logger));
    }
    
    // Se non ci sono strategie definite, usa una strategia di hash di default
    if (this.strategies.length === 0) {
      this.strategies.push(new ShardingStrategy({
        type: 'hash',
        keyField: this.keyField,
        shardCount: this.shardCount
      }, this.logger));
    }
    
    this.logger.info('Strategia composita inizializzata', {
      strategyCount: this.strategies.length
    });
  }
  
  /**
   * Determina lo shard per una chiave
   * @param {string|number|Object} key - Chiave di sharding
   * @returns {number} ID dello shard
   */
  getShardForKey(key) {
    let shardKey;
    
    // Estrai la chiave di sharding in base al tipo di input
    if (typeof key === 'object' && key !== null) {
      // Se la chiave è un oggetto, estrai il campo specificato nella strategia
      shardKey = key[this.keyField];
      
      if (shardKey === undefined) {
        throw new Error(`Campo di sharding '${this.keyField}' non trovato nell'oggetto`);
      }
    } else {
      // Altrimenti usa la chiave direttamente
      shardKey = key;
    }
    
    // Calcola l'ID dello shard in base alla strategia
    let shardId;
    
    switch (this.type) {
      case 'hash':
        shardId = this._hashSharding(shardKey);
        break;
      case 'range':
        shardId = this._rangeSharding(shardKey);
        break;
      case 'lookup':
        shardId = this._lookupSharding(shardKey);
        break;
      case 'consistent-hash':
        shardId = this._consistentHashSharding(shardKey);
        break;
      case 'dynamic':
        shardId = this._dynamicSharding(shardKey);
        break;
      case 'time-based':
        shardId = this._timeBasedSharding(key);
        break;
      case 'geo':
        shardId = this._geoSharding(key);
        break;
      case 'composite':
        shardId = this._compositeSharding(key);
        break;
      default:
        throw new Error(`Strategia di sharding '${this.type}' non supportata`);
    }
    
    this.logger.debug('Shard determinato per chiave', {
      key: typeof shardKey === 'object' ? JSON.stringify(shardKey) : shardKey,
      shardId
    });
    
    return shardId;
  }
  
  /**
   * Implementa lo sharding basato su hash
   * @private
   * @param {string|number} key - Chiave di sharding
   * @returns {number} ID dello shard
   */
  _hashSharding(key) {
    // Converti la chiave in stringa
    const keyStr = String(key);
    
    // Calcola l'hash della chiave
    let hashValue;
    
    switch (this.hashFunction) {
      case 'md5':
        const md5Hash = crypto.createHash('md5').update(keyStr).digest('hex');
        hashValue = parseInt(md5Hash.substring(0, 8), 16);
        break;
      case 'sha1':
        const sha1Hash = crypto.createHash('sha1').update(keyStr).digest('hex');
        hashValue = parseInt(sha1Hash.substring(0, 8), 16);
        break;
      case 'xxhash':
        // XXHash è più veloce di MD5 e SHA1
        hashValue = xxhash.hash64(Buffer.from(keyStr), 0).readUInt32LE(0);
        break;
      case 'murmur':
        // MurmurHash è un altro algoritmo di hash veloce
        hashValue = murmurhash.v3(keyStr);
        break;
      case 'djb2':
        // Implementazione dell'algoritmo djb2
        let hash = 5381;
        for (let i = 0; i < keyStr.length; i++) {
          hash = ((hash << 5) + hash) + keyStr.charCodeAt(i);
        }
        hashValue = hash >>> 0; // Converti in unsigned
        break;
      default:
        // Default: MD5
        const defaultHash = crypto.createHash('md5').update(keyStr).digest('hex');
        hashValue = parseInt(defaultHash.substring(0, 8), 16);
    }
    
    // Calcola il modulo per ottenere l'ID dello shard
    return hashValue % this.shardCount;
  }
  
  /**
   * Implementa lo sharding basato su range
   * @private
   * @param {number} key - Chiave di sharding
   * @returns {number} ID dello shard
   */
  _rangeSharding(key) {
    // Verifica che la chiave sia un numero
    const keyNum = Number(key);
    
    if (isNaN(keyNum)) {
      throw new Error('La chiave deve essere un numero per lo sharding basato su range');
    }
    
    // Trova il range che contiene la chiave
    for (const range of this.ranges) {
      if (keyNum >= range.min && keyNum <= range.max) {
        return range.shardId;
      }
    }
    
    // Se non è stato trovato un range, usa un fallback
    return keyNum % this.shardCount;
  }
  
  /**
   * Implementa lo sharding basato su lookup
   * @private
   * @param {string} key - Chiave di sharding
   * @returns {number} ID dello shard
   */
  _lookupSharding(key) {
    // Cerca la chiave nella tabella
    if (this.lookupTable[key] !== undefined) {
      return this.lookupTable[key];
    }
    
    // Se la chiave non è nella tabella, usa il default
    return this.defaultShardId;
  }
  
  /**
   * Implementa lo sharding basato su consistent hashing
   * @private
   * @param {string|number} key - Chiave di sharding
   * @returns {number} ID dello shard
   */
  _consistentHashSharding(key) {
    // Converti la chiave in stringa
    const keyStr = String(key);
    
    // Calcola l'hash della chiave
    const keyHash = crypto.createHash('md5').update(keyStr).digest('hex');
    const keyHashNum = parseInt(keyHash.substring(0, 8), 16);
    
    // Trova il nodo nel ring
    let selectedNode = null;
    for (const node of this.ring) {
      if (node.position > keyHashNum) {
        selectedNode = node;
        break;
      }
    }
    
    // Se non è stato trovato un nodo, usa il primo
    if (!selectedNode && this.ring.length > 0) {
      selectedNode = this.ring[0];
    }
    
    return selectedNode ? selectedNode.shardId : 0;
  }
  
  /**
   * Implementa lo sharding dinamico basato sul carico
   * @private
   * @param {string|number} key - Chiave di sharding
   * @returns {number} ID dello shard
   */
  _dynamicSharding(key) {
    // Calcola l'hash della chiave per ottenere uno shard di base
    const baseShardId = this._hashSharding(key);
    
    // Verifica il carico dello shard
    const load = this.shardLoads.get(baseShardId) || 0;
    const capacity = this.shardCapacities.get(baseShardId) || 1000;
    const loadFactor = load / capacity;
    
    // Se il carico è sotto la soglia, usa lo shard di base
    if (loadFactor < this.loadThreshold) {
      // Incrementa il carico dello shard
      this.shardLoads.set(baseShardId, load + 1);
      return baseShardId;
    }
    
    // Altrimenti, trova lo shard con il carico minore
    let minLoadShardId = 0;
    let minLoadFactor = Infinity;
    
    for (let shardId = 0; shardId < this.shardCount; shardId++) {
      const shardLoad = this.shardLoads.get(shardId) || 0;
      const shardCapacity = this.shardCapacities.get(shardId) || 1000;
      const shardLoadFactor = shardLoad / shardCapacity;
      
      if (shardLoadFactor < minLoadFactor) {
        minLoadFactor = shardLoadFactor;
        minLoadShardId = shardId;
      }
    }
    
    // Incrementa il carico dello shard scelto
    const minLoad = this.shardLoads.get(minLoadShardId) || 0;
    this.shardLoads.set(minLoadShardId, minLoad + 1);
    
    return minLoadShardId;
  }
  
  /**
   * Ribilancia gli shard in base al carico
   * @private
   */
  _rebalanceShards() {
    this.logger.info('Inizio ribilanciamento shard', {
      shardCount: this.shardCount
    });
    
    // Calcola il carico totale
    let totalLoad = 0;
    for (const load of this.shardLoads.values()) {
      totalLoad += load;
    }
    
    // Calcola il carico medio
    const avgLoad = totalLoad / this.shardCount;
    
    // Resetta i carichi
    for (let shardId = 0; shardId < this.shardCount; shardId++) {
      // Imposta il carico a una percentuale del carico medio
      // per simulare una distribuzione più realistica
      const randomFactor = 0.8 + (Math.random() * 0.4); // 0.8 - 1.2
      const newLoad = Math.floor(avgLoad * randomFactor);
      this.shardLoads.set(shardId, newLoad);
    }
    
    this.logger.info('Ribilanciamento shard completato', {
      totalLoad,
      avgLoad
    });
  }
  
  /**
   * Implementa lo sharding basato sul tempo
   * @private
   * @param {Object} data - Dati con campo temporale
   * @returns {number} ID dello shard
   */
  _timeBasedSharding(data) {
    // Verifica che i dati siano un oggetto
    if (typeof data !== 'object' || data === null) {
      throw new Error('I dati devono essere un oggetto per lo sharding basato sul tempo');
    }
    
    // Estrai il campo temporale
    const timeValue = data[this.timeField];
    
    if (timeValue === undefined) {
      throw new Error(`Campo temporale '${this.timeField}' non trovato nell'oggetto`);
    }
    
    // Converti il valore temporale in timestamp
    let timestamp;
    
    if (typeof timeValue === 'number') {
      // Assume che sia già un timestamp
      timestamp = timeValue;
    } else if (typeof timeValue === 'string') {
      // Prova a convertire la stringa in timestamp
      timestamp = Date.parse(timeValue);
      
      if (isNaN(timestamp)) {
        throw new Error(`Impossibile convertire '${timeValue}' in timestamp`);
      }
    } else if (timeValue instanceof Date) {
      // Estrai il timestamp dalla data
      timestamp = timeValue.getTime();
    } else {
      throw new Error(`Tipo di valore temporale non supportato: ${typeof timeValue}`);
    }
    
    // Calcola l'ID dello shard in base all'unità di tempo
    const timeUnit = Math.floor(timestamp / this.timeDivisor);
    return timeUnit % this.shardCount;
  }
  
  /**
   * Implementa lo sharding geografico
   * @private
   * @param {Object} data - Dati con campo geografico
   * @returns {number} ID dello shard
   */
  _geoSharding(data) {
    // Verifica che i dati siano un oggetto
    if (typeof data !== 'object' || data === null) {
      throw new Error('I dati devono essere un oggetto per lo sharding geografico');
    }
    
    // Estrai il campo geografico
    const geoValue = data[this.geoField];
    
    if (geoValue === undefined) {
      throw new Error(`Campo geografico '${this.geoField}' non trovato nell'oggetto`);
    }
    
    // Estrai le coordinate
    let lat, lng;
    
    if (typeof geoValue === 'object' && geoValue !== null) {
      // Formato { lat, lng } o { latitude, longitude }
      lat = geoValue.lat || geoValue.latitude;
      lng = geoValue.lng || geoValue.longitude;
    } else if (typeof geoValue === 'string') {
      // Formato "lat,lng"
      const parts = geoValue.split(',');
      if (parts.length === 2) {
        lat = parseFloat(parts[0].trim());
        lng = parseFloat(parts[1].trim());
      }
    }
    
    if (lat === undefined || lng === undefined || isNaN(lat) || isNaN(lng)) {
      throw new Error(`Impossibile estrarre coordinate valide da '${JSON.stringify(geoValue)}'`);
    }
    
    // Trova la regione che contiene le coordinate
    for (const region of this.regions) {
      const bounds = region.bounds;
      
      if (lat >= bounds.minLat && lat <= bounds.maxLat &&
          lng >= bounds.minLng && lng <= bounds.maxLng) {
        return region.shardId;
      }
    }
    
    // Se non è stata trovata una regione, usa il default
    return this.defaultRegion.shardId;
  }
  
  /**
   * Implementa lo sharding composito
   * @private
   * @param {Object} data - Dati da shardare
   * @returns {number} ID dello shard
   */
  _compositeSharding(data) {
    // Applica ogni strategia e combina i risultati
    let combinedShardId = 0;
    
    for (let i = 0; i < this.strategies.length; i++) {
      const strategy = this.strategies[i];
      const shardId = strategy.getShardForKey(data);
      
      // Combina gli ID degli shard usando XOR
      combinedShardId ^= shardId;
    }
    
    // Assicura che l'ID dello shard sia valido
    return combinedShardId % this.shardCount;
  }
  
  /**
   * Aggiorna la configurazione della strategia
   * @param {Object} config - Nuova configurazione
   */
  updateConfig(config) {
    this.logger.info('Aggiornamento configurazione strategia di sharding', {
      oldType: this.type,
      newType: config.type || this.type
    });
    
    // Aggiorna la configurazione
    this.config = { ...this.config, ...config };
    
    // Aggiorna i parametri
    this.type = this.config.type || this.type;
    this.keyField = this.config.keyField || this.keyField;
    this.hashFunction = this.config.hashFunction || this.hashFunction;
    this.shardCount = this.config.shardCount || this.shardCount;
    
    // Reinizializza la strategia
    this._initializeStrategy();
  }
  
  /**
   * Aggiunge un mapping alla tabella di lookup
   * @param {string} key - Chiave
   * @param {number} shardId - ID dello shard
   */
  addLookupMapping(key, shardId) {
    if (this.type !== 'lookup') {
      throw new Error('Operazione valida solo per la strategia di lookup');
    }
    
    this.lookupTable[key] = shardId;
    
    this.logger.info('Mapping aggiunto alla tabella di lookup', {
      key,
      shardId
    });
  }
  
  /**
   * Aggiunge una regione alla strategia geografica
   * @param {Object} region - Definizione della regione
   */
  addGeoRegion(region) {
    if (this.type !== 'geo') {
      throw new Error('Operazione valida solo per la strategia geografica');
    }
    
    this.regions.push(region);
    
    this.logger.info('Regione aggiunta alla strategia geografica', {
      regionName: region.name,
      shardId: region.shardId
    });
  }
  
  /**
   * Aggiorna il carico di uno shard
   * @param {number} shardId - ID dello shard
   * @param {number} load - Nuovo carico
   */
  updateShardLoad(shardId, load) {
    if (this.type !== 'dynamic') {
      throw new Error('Operazione valida solo per la strategia dinamica');
    }
    
    this.shardLoads.set(shardId, load);
    
    this.logger.debug('Carico dello shard aggiornato', {
      shardId,
      load
    });
  }
  
  /**
   * Aggiorna la capacità di uno shard
   * @param {number} shardId - ID dello shard
   * @param {number} capacity - Nuova capacità
   */
  updateShardCapacity(shardId, capacity) {
    if (this.type !== 'dynamic') {
      throw new Error('Operazione valida solo per la strategia dinamica');
    }
    
    this.shardCapacities.set(shardId, capacity);
    
    this.logger.info('Capacità dello shard aggiornata', {
      shardId,
      capacity
    });
  }
  
  /**
   * Forza il ribilanciamento degli shard
   */
  forceRebalance() {
    if (this.type !== 'dynamic') {
      throw new Error('Operazione valida solo per la strategia dinamica');
    }
    
    this._rebalanceShards();
    
    this.logger.info('Ribilanciamento forzato degli shard completato');
  }
  
  /**
   * Ottiene statistiche sulla strategia di sharding
   * @returns {Object} Statistiche
   */
  getStats() {
    const stats = {
      type: this.type,
      keyField: this.keyField,
      shardCount: this.shardCount
    };
    
    // Aggiungi statistiche specifiche per la strategia
    switch (this.type) {
      case 'hash':
        stats.hashFunction = this.hashFunction;
        break;
      case 'range':
        stats.rangeCount = this.ranges.length;
        stats.ranges = this.ranges;
        break;
      case 'lookup':
        stats.mappingCount = Object.keys(this.lookupTable).length;
        stats.defaultShardId = this.defaultShardId;
        break;
      case 'consistent-hash':
        stats.virtualNodes = this.virtualNodes;
        stats.ringSize = this.ring.length;
        break;
      case 'dynamic':
        stats.loadThreshold = this.loadThreshold;
        stats.rebalanceInterval = this.rebalanceInterval;
        
        // Calcola statistiche sui carichi
        let totalLoad = 0;
        let minLoad = Infinity;
        let maxLoad = 0;
        
        for (const [shardId, load] of this.shardLoads.entries()) {
          totalLoad += load;
          minLoad = Math.min(minLoad, load);
          maxLoad = Math.max(maxLoad, load);
          
          stats[`shard_${shardId}_load`] = load;
          stats[`shard_${shardId}_capacity`] = this.shardCapacities.get(shardId) || 0;
        }
        
        stats.totalLoad = totalLoad;
        stats.avgLoad = totalLoad / this.shardCount;
        stats.minLoad = minLoad === Infinity ? 0 : minLoad;
        stats.maxLoad = maxLoad;
        break;
      case 'time-based':
        stats.timeField = this.timeField;
        stats.timeUnit = this.timeUnit;
        stats.timeFormat = this.timeFormat;
        break;
      case 'geo':
        stats.geoField = this.geoField;
        stats.regionCount = this.regions.length;
        stats.regions = this.regions.map(r => ({ name: r.name, shardId: r.shardId }));
        break;
      case 'composite':
        stats.strategyCount = this.strategies.length;
        stats.strategies = this.strategies.map(s => s.getStats());
        break;
    }
    
    return stats;
  }
  
  /**
   * Chiude la strategia di sharding
   */
  close() {
    // Pulisci le risorse
    if (this.type === 'dynamic' && this.rebalanceTimer) {
      clearInterval(this.rebalanceTimer);
    }
    
    // Chiudi le strategie componenti
    if (this.type === 'composite') {
      for (const strategy of this.strategies) {
        strategy.close();
      }
    }
    
    this.logger.info('Strategia di sharding chiusa');
  }
}

module.exports = ShardingStrategy;
