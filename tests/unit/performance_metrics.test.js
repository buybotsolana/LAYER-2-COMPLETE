/**
 * Unit tests per il Performance Metrics System
 * 
 * Questo file contiene i test unitari per il componente Performance Metrics System
 * dell'architettura ad alte prestazioni del Layer-2 su Solana.
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { PerformanceMetrics, MetricCollector, MetricAggregator, AlertManager } = require('../../offchain/performance-metrics');

describe('PerformanceMetrics', function() {
  // Aumenta il timeout per i test più lunghi
  this.timeout(10000);
  
  let metrics;
  let mockCollector;
  let mockAggregator;
  let mockAlertManager;
  
  beforeEach(() => {
    // Crea mock per il collector
    mockCollector = {
      collect: sinon.stub().resolves(),
      registerMetric: sinon.stub(),
      getMetrics: sinon.stub().returns({
        'cpu.usage': [{ timestamp: Date.now(), value: 50 }],
        'memory.usage': [{ timestamp: Date.now(), value: 1024 }],
        'transaction.latency': [{ timestamp: Date.now(), value: 5 }]
      }),
      getMetricNames: sinon.stub().returns(['cpu.usage', 'memory.usage', 'transaction.latency']),
      start: sinon.stub().resolves(),
      stop: sinon.stub().resolves(),
      isRunning: sinon.stub().returns(true)
    };
    
    // Crea mock per l'aggregator
    mockAggregator = {
      aggregate: sinon.stub().resolves(),
      getAggregatedMetrics: sinon.stub().returns({
        'cpu.usage': { avg: 50, min: 30, max: 70, p95: 65, p99: 68 },
        'memory.usage': { avg: 1024, min: 512, max: 2048, p95: 1800, p99: 2000 },
        'transaction.latency': { avg: 5, min: 2, max: 15, p95: 10, p99: 12 }
      }),
      registerMetric: sinon.stub(),
      start: sinon.stub().resolves(),
      stop: sinon.stub().resolves(),
      isRunning: sinon.stub().returns(true)
    };
    
    // Crea mock per l'alert manager
    mockAlertManager = {
      checkThresholds: sinon.stub().resolves(),
      addRule: sinon.stub(),
      removeRule: sinon.stub(),
      getRules: sinon.stub().returns([
        { metric: 'cpu.usage', threshold: 80, operator: '>', severity: 'warning' },
        { metric: 'memory.usage', threshold: 4096, operator: '>', severity: 'critical' },
        { metric: 'transaction.latency', threshold: 20, operator: '>', severity: 'warning' }
      ]),
      getAlerts: sinon.stub().returns([]),
      start: sinon.stub().resolves(),
      stop: sinon.stub().resolves(),
      isRunning: sinon.stub().returns(true),
      on: sinon.stub()
    };
    
    // Crea un'istanza del sistema di metriche
    metrics = new PerformanceMetrics({
      collector: mockCollector,
      aggregator: mockAggregator,
      alertManager: mockAlertManager,
      collectInterval: 1000,
      aggregateInterval: 10000,
      alertCheckInterval: 5000,
      retentionPeriod: 86400000, // 1 giorno
      enableHistograms: true
    });
  });
  
  afterEach(() => {
    // Cleanup
    if (metrics) {
      metrics.stop();
    }
    
    // Ripristina i mock
    sinon.restore();
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente il sistema di metriche', () => {
      expect(metrics).to.be.an.instanceOf(PerformanceMetrics);
      expect(metrics.options.collectInterval).to.equal(1000);
      expect(metrics.options.aggregateInterval).to.equal(10000);
      expect(metrics.options.alertCheckInterval).to.equal(5000);
      expect(metrics.options.retentionPeriod).to.equal(86400000);
      expect(metrics.options.enableHistograms).to.be.true;
      expect(metrics.collector).to.equal(mockCollector);
      expect(metrics.aggregator).to.equal(mockAggregator);
      expect(metrics.alertManager).to.equal(mockAlertManager);
      expect(metrics.isRunning).to.be.false;
    });
    
    it('dovrebbe usare valori predefiniti se non specificati', () => {
      const defaultMetrics = new PerformanceMetrics();
      
      expect(defaultMetrics.options.collectInterval).to.be.a('number');
      expect(defaultMetrics.options.aggregateInterval).to.be.a('number');
      expect(defaultMetrics.options.alertCheckInterval).to.be.a('number');
      expect(defaultMetrics.options.retentionPeriod).to.be.a('number');
      expect(defaultMetrics.options.enableHistograms).to.be.a('boolean');
      expect(defaultMetrics.collector).to.be.an.instanceOf(MetricCollector);
      expect(defaultMetrics.aggregator).to.be.an.instanceOf(MetricAggregator);
      expect(defaultMetrics.alertManager).to.be.an.instanceOf(AlertManager);
      expect(defaultMetrics.isRunning).to.be.false;
    });
  });
  
  describe('Avvio e arresto', () => {
    it('dovrebbe avviare il sistema di metriche', async () => {
      await metrics.start();
      
      expect(metrics.isRunning).to.be.true;
      expect(mockCollector.start.calledOnce).to.be.true;
      expect(mockAggregator.start.calledOnce).to.be.true;
      expect(mockAlertManager.start.calledOnce).to.be.true;
    });
    
    it('dovrebbe arrestare il sistema di metriche', async () => {
      await metrics.start();
      await metrics.stop();
      
      expect(metrics.isRunning).to.be.false;
      expect(mockCollector.stop.calledOnce).to.be.true;
      expect(mockAggregator.stop.calledOnce).to.be.true;
      expect(mockAlertManager.stop.calledOnce).to.be.true;
    });
    
    it('non dovrebbe avviare il sistema se è già in esecuzione', async () => {
      await metrics.start();
      
      // Resetta i contatori delle chiamate
      mockCollector.start.resetHistory();
      mockAggregator.start.resetHistory();
      mockAlertManager.start.resetHistory();
      
      await metrics.start();
      
      expect(mockCollector.start.called).to.be.false;
      expect(mockAggregator.start.called).to.be.false;
      expect(mockAlertManager.start.called).to.be.false;
    });
    
    it('non dovrebbe arrestare il sistema se non è in esecuzione', async () => {
      await metrics.stop();
      
      expect(mockCollector.stop.called).to.be.false;
      expect(mockAggregator.stop.called).to.be.false;
      expect(mockAlertManager.stop.called).to.be.false;
    });
  });
  
  describe('Registrazione delle metriche', () => {
    it('dovrebbe registrare una metrica', () => {
      const metricName = 'test.metric';
      const metricConfig = {
        type: 'gauge',
        unit: 'ms',
        description: 'Test metric'
      };
      
      metrics.registerMetric(metricName, metricConfig);
      
      expect(mockCollector.registerMetric.calledWith(metricName, metricConfig)).to.be.true;
      expect(mockAggregator.registerMetric.calledWith(metricName, metricConfig)).to.be.true;
    });
    
    it('dovrebbe registrare più metriche', () => {
      const metricsConfig = {
        'test.metric1': {
          type: 'gauge',
          unit: 'ms',
          description: 'Test metric 1'
        },
        'test.metric2': {
          type: 'counter',
          unit: 'count',
          description: 'Test metric 2'
        }
      };
      
      metrics.registerMetrics(metricsConfig);
      
      expect(mockCollector.registerMetric.calledTwice).to.be.true;
      expect(mockAggregator.registerMetric.calledTwice).to.be.true;
    });
  });
  
  describe('Raccolta delle metriche', () => {
    beforeEach(async () => {
      await metrics.start();
    });
    
    it('dovrebbe raccogliere le metriche', async () => {
      await metrics.collectMetrics();
      
      expect(mockCollector.collect.calledOnce).to.be.true;
    });
    
    it('dovrebbe aggregare le metriche', async () => {
      await metrics.aggregateMetrics();
      
      expect(mockAggregator.aggregate.calledOnce).to.be.true;
    });
    
    it('dovrebbe controllare le soglie di allerta', async () => {
      await metrics.checkAlerts();
      
      expect(mockAlertManager.checkThresholds.calledOnce).to.be.true;
    });
  });
  
  describe('Recupero delle metriche', () => {
    it('dovrebbe ottenere le metriche grezze', () => {
      const rawMetrics = metrics.getRawMetrics();
      
      expect(rawMetrics).to.be.an('object');
      expect(rawMetrics).to.have.property('cpu.usage');
      expect(rawMetrics).to.have.property('memory.usage');
      expect(rawMetrics).to.have.property('transaction.latency');
      expect(mockCollector.getMetrics.calledOnce).to.be.true;
    });
    
    it('dovrebbe ottenere le metriche aggregate', () => {
      const aggregatedMetrics = metrics.getAggregatedMetrics();
      
      expect(aggregatedMetrics).to.be.an('object');
      expect(aggregatedMetrics).to.have.property('cpu.usage');
      expect(aggregatedMetrics).to.have.property('memory.usage');
      expect(aggregatedMetrics).to.have.property('transaction.latency');
      expect(mockAggregator.getAggregatedMetrics.calledOnce).to.be.true;
    });
    
    it('dovrebbe ottenere una metrica specifica', () => {
      const metricName = 'cpu.usage';
      const metric = metrics.getMetric(metricName);
      
      expect(metric).to.be.an('array');
      expect(metric[0]).to.have.property('timestamp');
      expect(metric[0]).to.have.property('value');
      expect(mockCollector.getMetrics.calledOnce).to.be.true;
    });
    
    it('dovrebbe ottenere una metrica aggregata specifica', () => {
      const metricName = 'cpu.usage';
      const metric = metrics.getAggregatedMetric(metricName);
      
      expect(metric).to.be.an('object');
      expect(metric).to.have.property('avg');
      expect(metric).to.have.property('min');
      expect(metric).to.have.property('max');
      expect(metric).to.have.property('p95');
      expect(metric).to.have.property('p99');
      expect(mockAggregator.getAggregatedMetrics.calledOnce).to.be.true;
    });
  });
  
  describe('Gestione delle regole di allerta', () => {
    it('dovrebbe aggiungere una regola di allerta', () => {
      const rule = {
        metric: 'test.metric',
        threshold: 100,
        operator: '>',
        severity: 'warning'
      };
      
      metrics.addAlertRule(rule);
      
      expect(mockAlertManager.addRule.calledWith(rule)).to.be.true;
    });
    
    it('dovrebbe rimuovere una regola di allerta', () => {
      const ruleId = 'rule-1';
      
      metrics.removeAlertRule(ruleId);
      
      expect(mockAlertManager.removeRule.calledWith(ruleId)).to.be.true;
    });
    
    it('dovrebbe ottenere le regole di allerta', () => {
      const rules = metrics.getAlertRules();
      
      expect(rules).to.be.an('array');
      expect(rules).to.have.lengthOf(3);
      expect(mockAlertManager.getRules.calledOnce).to.be.true;
    });
    
    it('dovrebbe ottenere le allerte attive', () => {
      const alerts = metrics.getActiveAlerts();
      
      expect(alerts).to.be.an('array');
      expect(mockAlertManager.getAlerts.calledOnce).to.be.true;
    });
  });
  
  describe('Gestione degli eventi', () => {
    it('dovrebbe registrare un handler per gli eventi di allerta', () => {
      const handler = sinon.spy();
      
      metrics.on('alert', handler);
      
      expect(mockAlertManager.on.calledWith('alert', handler)).to.be.true;
    });
  });
  
  describe('Pulizia delle metriche', () => {
    it('dovrebbe pulire le metriche più vecchie del periodo di retention', async () => {
      // Spia il metodo di pulizia
      const cleanupSpy = sinon.spy(metrics, 'cleanupMetrics');
      
      // Imposta un periodo di retention breve per il test
      metrics.options.retentionPeriod = 1000; // 1 secondo
      
      await metrics.start();
      
      // Attendi che il cleanup venga eseguito
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      expect(cleanupSpy.called).to.be.true;
    });
  });
  
  describe('Esportazione delle metriche', () => {
    it('dovrebbe esportare le metriche in formato JSON', () => {
      const json = metrics.exportMetricsAsJson();
      
      expect(json).to.be.a('string');
      
      const parsed = JSON.parse(json);
      expect(parsed).to.be.an('object');
      expect(parsed).to.have.property('raw');
      expect(parsed).to.have.property('aggregated');
    });
    
    it('dovrebbe esportare le metriche in formato CSV', () => {
      const csv = metrics.exportMetricsAsCsv();
      
      expect(csv).to.be.a('string');
      expect(csv).to.include('timestamp');
      expect(csv).to.include('metric');
      expect(csv).to.include('value');
    });
  });
});

describe('MetricCollector', function() {
  let collector;
  
  beforeEach(() => {
    collector = new MetricCollector({
      enableHistograms: true,
      maxDataPoints: 1000
    });
  });
  
  afterEach(() => {
    // Cleanup
    if (collector) {
      collector.stop();
    }
    
    // Ripristina i mock
    sinon.restore();
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente il collector', () => {
      expect(collector).to.be.an.instanceOf(MetricCollector);
      expect(collector.options.enableHistograms).to.be.true;
      expect(collector.options.maxDataPoints).to.equal(1000);
      expect(collector.metrics).to.be.an('object');
      expect(collector.metricConfigs).to.be.an('object');
      expect(collector.isRunning).to.be.false;
    });
  });
  
  describe('Registrazione delle metriche', () => {
    it('dovrebbe registrare una metrica', () => {
      const metricName = 'test.metric';
      const metricConfig = {
        type: 'gauge',
        unit: 'ms',
        description: 'Test metric'
      };
      
      collector.registerMetric(metricName, metricConfig);
      
      expect(collector.metricConfigs).to.have.property(metricName);
      expect(collector.metricConfigs[metricName]).to.deep.equal(metricConfig);
      expect(collector.metrics).to.have.property(metricName);
      expect(collector.metrics[metricName]).to.be.an('array').that.is.empty;
    });
    
    it('dovrebbe aggiornare la configurazione di una metrica esistente', () => {
      const metricName = 'test.metric';
      const metricConfig1 = {
        type: 'gauge',
        unit: 'ms',
        description: 'Test metric'
      };
      const metricConfig2 = {
        type: 'gauge',
        unit: 's',
        description: 'Updated test metric'
      };
      
      collector.registerMetric(metricName, metricConfig1);
      collector.registerMetric(metricName, metricConfig2);
      
      expect(collector.metricConfigs[metricName]).to.deep.equal(metricConfig2);
    });
  });
  
  describe('Raccolta delle metriche', () => {
    it('dovrebbe raccogliere una metrica', async () => {
      const metricName = 'test.metric';
      const metricValue = 42;
      
      collector.registerMetric(metricName, { type: 'gauge' });
      await collector.recordMetric(metricName, metricValue);
      
      expect(collector.metrics[metricName]).to.have.lengthOf(1);
      expect(collector.metrics[metricName][0].value).to.equal(metricValue);
      expect(collector.metrics[metricName][0].timestamp).to.be.a('number');
    });
    
    it('dovrebbe limitare il numero di punti dati', async () => {
      const metricName = 'test.metric';
      
      collector.options.maxDataPoints = 3;
      collector.registerMetric(metricName, { type: 'gauge' });
      
      // Registra più punti dati del limite
      await collector.recordMetric(metricName, 1);
      await collector.recordMetric(metricName, 2);
      await collector.recordMetric(metricName, 3);
      await collector.recordMetric(metricName, 4);
      await collector.recordMetric(metricName, 5);
      
      expect(collector.metrics[metricName]).to.have.lengthOf(3);
      expect(collector.metrics[metricName][0].value).to.equal(3);
      expect(collector.metrics[metricName][1].value).to.equal(4);
      expect(collector.metrics[metricName][2].value).to.equal(5);
    });
    
    it('dovrebbe raccogliere metriche di sistema', async () => {
      // Registra metriche di sistema
      collector.registerSystemMetrics();
      
      // Raccoglie le metriche
      await collector.collect();
      
      // Verifica che le metriche di sistema siano state raccolte
      expect(collector.metrics).to.have.property('system.cpu.usage');
      expect(collector.metrics).to.have.property('system.memory.usage');
      expect(collector.metrics).to.have.property('system.memory.free');
    });
  });
  
  describe('Recupero delle metriche', () => {
    it('dovrebbe ottenere tutte le metriche', async () => {
      collector.registerMetric('metric1', { type: 'gauge' });
      collector.registerMetric('metric2', { type: 'counter' });
      
      await collector.recordMetric('metric1', 10);
      await collector.recordMetric('metric2', 20);
      
      const metrics = collector.getMetrics();
      
      expect(metrics).to.be.an('object');
      expect(metrics).to.have.property('metric1');
      expect(metrics).to.have.property('metric2');
      expect(metrics.metric1).to.be.an('array').with.lengthOf(1);
      expect(metrics.metric2).to.be.an('array').with.lengthOf(1);
      expect(metrics.metric1[0].value).to.equal(10);
      expect(metrics.metric2[0].value).to.equal(20);
    });
    
    it('dovrebbe ottenere i nomi delle metriche', () => {
      collector.registerMetric('metric1', { type: 'gauge' });
      collector.registerMetric('metric2', { type: 'counter' });
      
      const metricNames = collector.getMetricNames();
      
      expect(metricNames).to.be.an('array');
      expect(metricNames).to.include('metric1');
      expect(metricNames).to.include('metric2');
    });
    
    it('dovrebbe ottenere la configurazione di una metrica', () => {
      const metricName = 'test.metric';
      const metricConfig = {
        type: 'gauge',
        unit: 'ms',
        description: 'Test metric'
      };
      
      collector.registerMetric(metricName, metricConfig);
      
      const config = collector.getMetricConfig(metricName);
      
      expect(config).to.deep.equal(metricConfig);
    });
  });
  
  describe('Avvio e arresto', () => {
    it('dovrebbe avviare e arrestare il collector', async () => {
      await collector.start();
      
      expect(collector.isRunning).to.be.true;
      
      await collector.stop();
      
      expect(collector.isRunning).to.be.false;
    });
  });
});

describe('MetricAggregator', function() {
  let aggregator;
  let mockCollector;
  
  beforeEach(() => {
    // Crea mock per il collector
    mockCollector = {
      getMetrics: sinon.stub().returns({
        'test.metric': [
          { timestamp: Date.now() - 5000, value: 10 },
          { timestamp: Date.now() - 4000, value: 20 },
          { timestamp: Date.now() - 3000, value: 30 },
          { timestamp: Date.now() - 2000, value: 40 },
          { timestamp: Date.now() - 1000, value: 50 }
        ]
      }),
      getMetricNames: sinon.stub().returns(['test.metric']),
      getMetricConfig: sinon.stub().returns({ type: 'gauge', unit: 'ms' })
    };
    
    // Crea un'istanza dell'aggregator
    aggregator = new MetricAggregator({
      collector: mockCollector,
      windowSize: 10000, // 10 secondi
      enablePercentiles: true
    });
  });
  
  afterEach(() => {
    // Cleanup
    if (aggregator) {
      aggregator.stop();
    }
    
    // Ripristina i mock
    sinon.restore();
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente l\'aggregator', () => {
      expect(aggregator).to.be.an.instanceOf(MetricAggregator);
      expect(aggregator.options.windowSize).to.equal(10000);
      expect(aggregator.options.enablePercentiles).to.be.true;
      expect(aggregator.collector).to.equal(mockCollector);
      expect(aggregator.aggregatedMetrics).to.be.an('object');
      expect(aggregator.metricConfigs).to.be.an('object');
      expect(aggregator.isRunning).to.be.false;
    });
  });
  
  describe('Registrazione delle metriche', () => {
    it('dovrebbe registrare una metrica', () => {
      const metricName = 'new.metric';
      const metricConfig = {
        type: 'gauge',
        unit: 'ms',
        description: 'New metric'
      };
      
      aggregator.registerMetric(metricName, metricConfig);
      
      expect(aggregator.metricConfigs).to.have.property(metricName);
      expect(aggregator.metricConfigs[metricName]).to.deep.equal(metricConfig);
    });
  });
  
  describe('Aggregazione delle metriche', () => {
    it('dovrebbe aggregare le metriche', async () => {
      await aggregator.aggregate();
      
      expect(aggregator.aggregatedMetrics).to.have.property('test.metric');
      expect(aggregator.aggregatedMetrics['test.metric']).to.be.an('object');
      expect(aggregator.aggregatedMetrics['test.metric']).to.have.property('avg');
      expect(aggregator.aggregatedMetrics['test.metric']).to.have.property('min');
      expect(aggregator.aggregatedMetrics['test.metric']).to.have.property('max');
      expect(aggregator.aggregatedMetrics['test.metric']).to.have.property('count');
      expect(aggregator.aggregatedMetrics['test.metric']).to.have.property('sum');
      expect(aggregator.aggregatedMetrics['test.metric'].avg).to.equal(30); // (10+20+30+40+50)/5
      expect(aggregator.aggregatedMetrics['test.metric'].min).to.equal(10);
      expect(aggregator.aggregatedMetrics['test.metric'].max).to.equal(50);
      expect(aggregator.aggregatedMetrics['test.metric'].count).to.equal(5);
      expect(aggregator.aggregatedMetrics['test.metric'].sum).to.equal(150);
    });
    
    it('dovrebbe calcolare i percentili quando abilitati', async () => {
      await aggregator.aggregate();
      
      expect(aggregator.aggregatedMetrics['test.metric']).to.have.property('p50');
      expect(aggregator.aggregatedMetrics['test.metric']).to.have.property('p90');
      expect(aggregator.aggregatedMetrics['test.metric']).to.have.property('p95');
      expect(aggregator.aggregatedMetrics['test.metric']).to.have.property('p99');
      expect(aggregator.aggregatedMetrics['test.metric'].p50).to.equal(30);
      expect(aggregator.aggregatedMetrics['test.metric'].p90).to.be.closeTo(46, 1);
      expect(aggregator.aggregatedMetrics['test.metric'].p95).to.be.closeTo(48, 1);
      expect(aggregator.aggregatedMetrics['test.metric'].p99).to.be.closeTo(49.6, 1);
    });
    
    it('non dovrebbe calcolare i percentili quando disabilitati', async () => {
      aggregator.options.enablePercentiles = false;
      
      await aggregator.aggregate();
      
      expect(aggregator.aggregatedMetrics['test.metric']).to.not.have.property('p50');
      expect(aggregator.aggregatedMetrics['test.metric']).to.not.have.property('p90');
      expect(aggregator.aggregatedMetrics['test.metric']).to.not.have.property('p95');
      expect(aggregator.aggregatedMetrics['test.metric']).to.not.have.property('p99');
    });
    
    it('dovrebbe rispettare la finestra temporale', async () => {
      // Modifica il mock per simulare dati fuori dalla finestra temporale
      mockCollector.getMetrics.returns({
        'test.metric': [
          { timestamp: Date.now() - 15000, value: 10 }, // Fuori dalla finestra
          { timestamp: Date.now() - 12000, value: 20 }, // Fuori dalla finestra
          { timestamp: Date.now() - 8000, value: 30 }, // Dentro la finestra
          { timestamp: Date.now() - 5000, value: 40 }, // Dentro la finestra
          { timestamp: Date.now() - 2000, value: 50 }  // Dentro la finestra
        ]
      });
      
      await aggregator.aggregate();
      
      expect(aggregator.aggregatedMetrics['test.metric'].avg).to.equal(40); // (30+40+50)/3
      expect(aggregator.aggregatedMetrics['test.metric'].min).to.equal(30);
      expect(aggregator.aggregatedMetrics['test.metric'].max).to.equal(50);
      expect(aggregator.aggregatedMetrics['test.metric'].count).to.equal(3);
      expect(aggregator.aggregatedMetrics['test.metric'].sum).to.equal(120);
    });
  });
  
  describe('Recupero delle metriche aggregate', () => {
    it('dovrebbe ottenere tutte le metriche aggregate', async () => {
      await aggregator.aggregate();
      
      const metrics = aggregator.getAggregatedMetrics();
      
      expect(metrics).to.be.an('object');
      expect(metrics).to.have.property('test.metric');
      expect(metrics['test.metric']).to.be.an('object');
      expect(metrics['test.metric']).to.have.property('avg');
      expect(metrics['test.metric']).to.have.property('min');
      expect(metrics['test.metric']).to.have.property('max');
    });
    
    it('dovrebbe ottenere una metrica aggregata specifica', async () => {
      await aggregator.aggregate();
      
      const metric = aggregator.getAggregatedMetric('test.metric');
      
      expect(metric).to.be.an('object');
      expect(metric).to.have.property('avg');
      expect(metric).to.have.property('min');
      expect(metric).to.have.property('max');
    });
  });
  
  describe('Avvio e arresto', () => {
    it('dovrebbe avviare e arrestare l\'aggregator', async () => {
      await aggregator.start();
      
      expect(aggregator.isRunning).to.be.true;
      
      await aggregator.stop();
      
      expect(aggregator.isRunning).to.be.false;
    });
  });
});

describe('AlertManager', function() {
  let alertManager;
  let mockAggregator;
  
  beforeEach(() => {
    // Crea mock per l'aggregator
    mockAggregator = {
      getAggregatedMetrics: sinon.stub().returns({
        'cpu.usage': { avg: 50, min: 30, max: 70, p95: 65, p99: 68 },
        'memory.usage': { avg: 1024, min: 512, max: 2048, p95: 1800, p99: 2000 },
        'transaction.latency': { avg: 5, min: 2, max: 15, p95: 10, p99: 12 }
      }),
      getAggregatedMetric: sinon.stub().callsFake((metricName) => {
        const metrics = {
          'cpu.usage': { avg: 50, min: 30, max: 70, p95: 65, p99: 68 },
          'memory.usage': { avg: 1024, min: 512, max: 2048, p95: 1800, p99: 2000 },
          'transaction.latency': { avg: 5, min: 2, max: 15, p95: 10, p99: 12 }
        };
        return metrics[metricName];
      })
    };
    
    // Crea un'istanza dell'alert manager
    alertManager = new AlertManager({
      aggregator: mockAggregator,
      maxAlerts: 100,
      alertTTL: 3600000 // 1 ora
    });
  });
  
  afterEach(() => {
    // Cleanup
    if (alertManager) {
      alertManager.stop();
    }
    
    // Ripristina i mock
    sinon.restore();
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente l\'alert manager', () => {
      expect(alertManager).to.be.an.instanceOf(AlertManager);
      expect(alertManager.options.maxAlerts).to.equal(100);
      expect(alertManager.options.alertTTL).to.equal(3600000);
      expect(alertManager.aggregator).to.equal(mockAggregator);
      expect(alertManager.rules).to.be.an('array').that.is.empty;
      expect(alertManager.alerts).to.be.an('array').that.is.empty;
      expect(alertManager.isRunning).to.be.false;
    });
  });
  
  describe('Gestione delle regole', () => {
    it('dovrebbe aggiungere una regola', () => {
      const rule = {
        metric: 'cpu.usage',
        threshold: 80,
        operator: '>',
        severity: 'warning'
      };
      
      const ruleId = alertManager.addRule(rule);
      
      expect(ruleId).to.be.a('string');
      expect(alertManager.rules).to.have.lengthOf(1);
      expect(alertManager.rules[0].id).to.equal(ruleId);
      expect(alertManager.rules[0].metric).to.equal(rule.metric);
      expect(alertManager.rules[0].threshold).to.equal(rule.threshold);
      expect(alertManager.rules[0].operator).to.equal(rule.operator);
      expect(alertManager.rules[0].severity).to.equal(rule.severity);
    });
    
    it('dovrebbe rimuovere una regola', () => {
      const rule = {
        metric: 'cpu.usage',
        threshold: 80,
        operator: '>',
        severity: 'warning'
      };
      
      const ruleId = alertManager.addRule(rule);
      const result = alertManager.removeRule(ruleId);
      
      expect(result).to.be.true;
      expect(alertManager.rules).to.be.empty;
    });
    
    it('dovrebbe ottenere tutte le regole', () => {
      const rule1 = {
        metric: 'cpu.usage',
        threshold: 80,
        operator: '>',
        severity: 'warning'
      };
      
      const rule2 = {
        metric: 'memory.usage',
        threshold: 4096,
        operator: '>',
        severity: 'critical'
      };
      
      alertManager.addRule(rule1);
      alertManager.addRule(rule2);
      
      const rules = alertManager.getRules();
      
      expect(rules).to.be.an('array').with.lengthOf(2);
      expect(rules[0].metric).to.equal(rule1.metric);
      expect(rules[1].metric).to.equal(rule2.metric);
    });
  });
  
  describe('Controllo delle soglie', () => {
    it('dovrebbe generare un\'allerta quando una soglia viene superata', async () => {
      // Aggiungi una regola che sarà violata
      alertManager.addRule({
        metric: 'cpu.usage',
        threshold: 40,
        operator: '>',
        severity: 'warning'
      });
      
      // Spia l'evento di allerta
      const alertSpy = sinon.spy();
      alertManager.on('alert', alertSpy);
      
      await alertManager.checkThresholds();
      
      expect(alertManager.alerts).to.have.lengthOf(1);
      expect(alertManager.alerts[0].metric).to.equal('cpu.usage');
      expect(alertManager.alerts[0].value).to.equal(50);
      expect(alertManager.alerts[0].threshold).to.equal(40);
      expect(alertManager.alerts[0].operator).to.equal('>');
      expect(alertManager.alerts[0].severity).to.equal('warning');
      expect(alertSpy.calledOnce).to.be.true;
    });
    
    it('non dovrebbe generare un\'allerta quando una soglia non viene superata', async () => {
      // Aggiungi una regola che non sarà violata
      alertManager.addRule({
        metric: 'cpu.usage',
        threshold: 80,
        operator: '>',
        severity: 'warning'
      });
      
      // Spia l'evento di allerta
      const alertSpy = sinon.spy();
      alertManager.on('alert', alertSpy);
      
      await alertManager.checkThresholds();
      
      expect(alertManager.alerts).to.be.empty;
      expect(alertSpy.called).to.be.false;
    });
    
    it('dovrebbe supportare diversi operatori di confronto', async () => {
      // Aggiungi regole con diversi operatori
      alertManager.addRule({
        metric: 'cpu.usage',
        threshold: 40,
        operator: '>',
        severity: 'warning'
      });
      
      alertManager.addRule({
        metric: 'cpu.usage',
        threshold: 60,
        operator: '<',
        severity: 'warning'
      });
      
      alertManager.addRule({
        metric: 'cpu.usage',
        threshold: 50,
        operator: '=',
        severity: 'warning'
      });
      
      alertManager.addRule({
        metric: 'cpu.usage',
        threshold: 40,
        operator: '>=',
        severity: 'warning'
      });
      
      alertManager.addRule({
        metric: 'cpu.usage',
        threshold: 60,
        operator: '<=',
        severity: 'warning'
      });
      
      await alertManager.checkThresholds();
      
      // Dovrebbero essere generate 5 allerte (tutte le regole sono violate)
      expect(alertManager.alerts).to.have.lengthOf(5);
    });
    
    it('dovrebbe limitare il numero di allerte', async () => {
      // Imposta un limite basso
      alertManager.options.maxAlerts = 2;
      
      // Aggiungi più regole che saranno violate
      alertManager.addRule({
        metric: 'cpu.usage',
        threshold: 40,
        operator: '>',
        severity: 'warning'
      });
      
      alertManager.addRule({
        metric: 'memory.usage',
        threshold: 512,
        operator: '>',
        severity: 'warning'
      });
      
      alertManager.addRule({
        metric: 'transaction.latency',
        threshold: 2,
        operator: '>',
        severity: 'warning'
      });
      
      await alertManager.checkThresholds();
      
      // Dovrebbero essere generate solo 2 allerte (limite)
      expect(alertManager.alerts).to.have.lengthOf(2);
    });
  });
  
  describe('Gestione delle allerte', () => {
    it('dovrebbe ottenere tutte le allerte', async () => {
      // Aggiungi una regola che sarà violata
      alertManager.addRule({
        metric: 'cpu.usage',
        threshold: 40,
        operator: '>',
        severity: 'warning'
      });
      
      await alertManager.checkThresholds();
      
      const alerts = alertManager.getAlerts();
      
      expect(alerts).to.be.an('array').with.lengthOf(1);
      expect(alerts[0].metric).to.equal('cpu.usage');
    });
    
    it('dovrebbe pulire le allerte scadute', async () => {
      // Imposta un TTL breve
      alertManager.options.alertTTL = 1; // 1 millisecondo
      
      // Aggiungi una regola che sarà violata
      alertManager.addRule({
        metric: 'cpu.usage',
        threshold: 40,
        operator: '>',
        severity: 'warning'
      });
      
      await alertManager.checkThresholds();
      
      // Attendi che le allerte scadano
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Pulisci le allerte scadute
      alertManager.cleanupAlerts();
      
      expect(alertManager.alerts).to.be.empty;
    });
  });
  
  describe('Avvio e arresto', () => {
    it('dovrebbe avviare e arrestare l\'alert manager', async () => {
      await alertManager.start();
      
      expect(alertManager.isRunning).to.be.true;
      
      await alertManager.stop();
      
      expect(alertManager.isRunning).to.be.false;
    });
  });
});
