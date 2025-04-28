/**
 * Real-time Performance Monitoring System for Solana Layer 2
 * 
 * This module provides a comprehensive metrics collection, analysis, and reporting
 * system for the Layer 2 infrastructure, tracking key performance indicators such as
 * transactions per second (TPS), confirmation latency, and queue sizes.
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { Registry, Counter, Gauge, Histogram } = require('prom-client');

const DEFAULT_PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data', 'metrics');
const MAX_HISTORICAL_DATAPOINTS = 1440; // 24 hours at 1 minute intervals
const SNAPSHOT_INTERVAL = 300000; // 5 minutes

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const MetricType = {
  THROUGHPUT: 'throughput',
  LATENCY: 'latency',
  QUEUE_SIZE: 'queue_size',
  BATCH_SIZE: 'batch_size',
  SUCCESS_RATE: 'success_rate',
  ERROR_RATE: 'error_rate',
  MEMORY_USAGE: 'memory_usage',
  CPU_USAGE: 'cpu_usage',
  DISK_USAGE: 'disk_usage',
  NETWORK_USAGE: 'network_usage'
};

const MetricTimeframe = {
  LAST_MINUTE: '1m',
  LAST_FIVE_MINUTES: '5m',
  LAST_HOUR: '1h',
  LAST_DAY: '1d',
  LAST_WEEK: '1w'
};

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const register = new Registry();

const promMetrics = {
  tps: new Gauge({
    name: 'layer2_transactions_per_second',
    help: 'Current transactions per second',
    registers: [register]
  }),
  latency: new Histogram({
    name: 'layer2_transaction_latency_milliseconds',
    help: 'Transaction confirmation latency in milliseconds',
    buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000, 10000],
    registers: [register]
  }),
  queueSize: new Gauge({
    name: 'layer2_transaction_queue_size',
    help: 'Current size of the transaction queue',
    registers: [register]
  }),
  batchSize: new Histogram({
    name: 'layer2_batch_size',
    help: 'Size of transaction batches',
    buckets: [1, 5, 10, 20, 50, 100, 200, 500],
    registers: [register]
  }),
  successRate: new Gauge({
    name: 'layer2_transaction_success_rate_percent',
    help: 'Percentage of successful transactions',
    registers: [register]
  }),
  errorRate: new Gauge({
    name: 'layer2_transaction_error_rate_percent',
    help: 'Percentage of failed transactions',
    registers: [register]
  }),
  componentStatus: new Gauge({
    name: 'layer2_component_status',
    help: 'Status of Layer 2 components (1 = healthy, 0 = unhealthy)',
    labelNames: ['component'],
    registers: [register]
  })
};

let metricsData = {
  system: {
    tps: 0,
    avgLatency: 0,
    queueSize: 0,
    successRate: 100,
    errorRate: 0,
    lastUpdate: new Date().toISOString()
  },
  components: {
    sequencer: {
      activeWorkers: 0,
      pendingTransactions: 0,
      processedBatches: 0,
      avgBatchProcessingTime: 0,
      totalProcessed: 0,
      throughput: 0,
      lastUpdate: new Date().toISOString()
    },
    bridge: {
      pendingDeposits: 0,
      pendingWithdrawals: 0,
      successfulTransfers: 0,
      failedTransfers: 0,
      lastUpdate: new Date().toISOString()
    },
    relayer: {
      pendingMessages: 0,
      processedMessages: 0,
      failedMessages: 0,
      lastUpdate: new Date().toISOString()
    },
    recovery: {
      totalDiscrepancies: 0,
      resolvedDiscrepancies: 0,
      failedReconciliations: 0,
      pendingReconciliations: 0,
      avgReconciliationDuration: 0,
      circuitBreakerActive: false,
      isReconciling: false,
      lastUpdate: new Date().toISOString()
    }
  },
  historical: {
    [MetricType.THROUGHPUT]: [],
    [MetricType.LATENCY]: [],
    [MetricType.QUEUE_SIZE]: [],
    [MetricType.BATCH_SIZE]: [],
    [MetricType.SUCCESS_RATE]: [],
    [MetricType.ERROR_RATE]: []
  }
};

/**
 * Record a metric value
 * @param {string} type - Metric type from MetricType enum
 * @param {number} value - Metric value
 * @param {Object} metadata - Additional metadata for the metric
 */
function recordMetric(type, value, metadata = {}) {
  if (!MetricType[type.toUpperCase()]) {
    console.warn(`Unknown metric type: ${type}`);
    return;
  }

  const timestamp = Date.now();
  const metricData = {
    timestamp,
    value,
    ...metadata
  };

  if (metricsData.historical[type]) {
    metricsData.historical[type].push(metricData);
    
    if (metricsData.historical[type].length > MAX_HISTORICAL_DATAPOINTS) {
      metricsData.historical[type].shift();
    }
  }

  updatePrometheusMetrics(type, value, metadata);

  io.emit('metric', { type, ...metricData });

  return metricData;
}

/**
 * Update Prometheus metrics
 * @param {string} type - Metric type
 * @param {number} value - Metric value
 * @param {Object} metadata - Additional metadata
 */
function updatePrometheusMetrics(type, value, metadata = {}) {
  switch (type) {
    case MetricType.THROUGHPUT:
      promMetrics.tps.set(value);
      break;
    case MetricType.LATENCY:
      promMetrics.latency.observe(value);
      break;
    case MetricType.QUEUE_SIZE:
      promMetrics.queueSize.set(value);
      break;
    case MetricType.BATCH_SIZE:
      promMetrics.batchSize.observe(value);
      break;
    case MetricType.SUCCESS_RATE:
      promMetrics.successRate.set(value);
      break;
    case MetricType.ERROR_RATE:
      promMetrics.errorRate.set(value);
      break;
  }
}

/**
 * Update system-wide metrics
 * @param {Object} metrics - System metrics object
 */
function updateSystemMetrics(metrics) {
  const timestamp = Date.now();
  
  metricsData.system = {
    ...metricsData.system,
    ...metrics,
    lastUpdate: new Date().toISOString()
  };

  if (metrics.tps !== undefined) {
    recordMetric(MetricType.THROUGHPUT, metrics.tps);
  }
  
  if (metrics.avgLatency !== undefined) {
    recordMetric(MetricType.LATENCY, metrics.avgLatency);
  }
  
  if (metrics.queueSize !== undefined) {
    recordMetric(MetricType.QUEUE_SIZE, metrics.queueSize);
  }
  
  if (metrics.successRate !== undefined) {
    recordMetric(MetricType.SUCCESS_RATE, metrics.successRate);
  }
  
  if (metrics.errorRate !== undefined) {
    recordMetric(MetricType.ERROR_RATE, metrics.errorRate);
  }

  io.emit('system_metrics', metricsData.system);
  
  return metricsData.system;
}

/**
 * Update component-specific metrics
 * @param {string} component - Component name (sequencer, bridge, relayer, recovery)
 * @param {Object} metrics - Component metrics object
 */
function updateComponentMetrics(component, metrics) {
  if (!metricsData.components[component]) {
    console.warn(`Unknown component: ${component}`);
    return null;
  }

  metricsData.components[component] = {
    ...metricsData.components[component],
    ...metrics,
    lastUpdate: new Date().toISOString()
  };

  promMetrics.componentStatus.set({ component }, 1);

  io.emit('component_metrics', {
    component,
    metrics: metricsData.components[component]
  });
  
  return metricsData.components[component];
}

/**
 * Get metrics for a specific timeframe
 * @param {string} type - Metric type
 * @param {string} timeframe - Timeframe from MetricTimeframe enum
 * @returns {Array} - Array of metric data points
 */
function getMetricsForTimeframe(type, timeframe) {
  if (!metricsData.historical[type]) {
    return [];
  }

  const now = Date.now();
  let timeframeMs;

  switch (timeframe) {
    case MetricTimeframe.LAST_MINUTE:
      timeframeMs = 60 * 1000;
      break;
    case MetricTimeframe.LAST_FIVE_MINUTES:
      timeframeMs = 5 * 60 * 1000;
      break;
    case MetricTimeframe.LAST_HOUR:
      timeframeMs = 60 * 60 * 1000;
      break;
    case MetricTimeframe.LAST_DAY:
      timeframeMs = 24 * 60 * 60 * 1000;
      break;
    case MetricTimeframe.LAST_WEEK:
      timeframeMs = 7 * 24 * 60 * 60 * 1000;
      break;
    default:
      timeframeMs = 60 * 60 * 1000; // Default to 1 hour
  }

  const cutoffTime = now - timeframeMs;
  return metricsData.historical[type].filter(point => point.timestamp >= cutoffTime);
}

/**
 * Calculate metrics analysis for a specific type and timeframe
 * @param {string} type - Metric type
 * @param {string} timeframe - Timeframe from MetricTimeframe enum
 * @returns {Object} - Analysis results
 */
function calculateMetricsAnalysis(type, timeframe) {
  const data = getMetricsForTimeframe(type, timeframe);
  
  if (data.length === 0) {
    return {
      count: 0,
      min: 0,
      max: 0,
      avg: 0,
      median: 0,
      p95: 0,
      p99: 0,
      stdDev: 0
    };
  }

  const values = data.map(point => point.value);
  values.sort((a, b) => a - b);

  const count = values.length;
  const min = values[0];
  const max = values[count - 1];
  const sum = values.reduce((acc, val) => acc + val, 0);
  const avg = sum / count;
  
  const median = count % 2 === 0
    ? (values[count / 2 - 1] + values[count / 2]) / 2
    : values[Math.floor(count / 2)];
  
  const p95Index = Math.floor(count * 0.95);
  const p99Index = Math.floor(count * 0.99);
  
  const p95 = values[p95Index];
  const p99 = values[p99Index];
  
  const squaredDiffs = values.map(val => Math.pow(val - avg, 2));
  const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / count;
  const stdDev = Math.sqrt(variance);

  return {
    count,
    min,
    max,
    avg,
    median,
    p95,
    p99,
    stdDev
  };
}

/**
 * Save metrics data to disk
 */
async function saveMetricsSnapshot() {
  const timestamp = Date.now();
  const filename = `metrics_${timestamp}.json`;
  const filePath = path.join(DATA_DIR, filename);
  
  try {
    await promisify(fs.writeFile)(
      filePath,
      JSON.stringify(metricsData, null, 2)
    );
    
    console.log(`Metrics snapshot saved to ${filePath}`);
    
    const files = await promisify(fs.readdir)(DATA_DIR);
    const metricsFiles = files
      .filter(file => file.startsWith('metrics_') && file.endsWith('.json'))
      .sort((a, b) => {
        const timestampA = parseInt(a.replace('metrics_', '').replace('.json', ''));
        const timestampB = parseInt(b.replace('metrics_', '').replace('.json', ''));
        return timestampB - timestampA; // Sort descending
      });
    
    if (metricsFiles.length > 24) {
      const filesToDelete = metricsFiles.slice(24);
      for (const file of filesToDelete) {
        await promisify(fs.unlink)(path.join(DATA_DIR, file));
        console.log(`Deleted old metrics snapshot: ${file}`);
      }
    }
  } catch (error) {
    console.error('Error saving metrics snapshot:', error);
  }
}

/**
 * Load the most recent metrics snapshot
 */
async function loadLatestMetricsSnapshot() {
  try {
    const files = await promisify(fs.readdir)(DATA_DIR);
    const metricsFiles = files
      .filter(file => file.startsWith('metrics_') && file.endsWith('.json'))
      .sort((a, b) => {
        const timestampA = parseInt(a.replace('metrics_', '').replace('.json', ''));
        const timestampB = parseInt(b.replace('metrics_', '').replace('.json', ''));
        return timestampB - timestampA; // Sort descending
      });
    
    if (metricsFiles.length > 0) {
      const latestFile = metricsFiles[0];
      const filePath = path.join(DATA_DIR, latestFile);
      const data = await promisify(fs.readFile)(filePath, 'utf8');
      metricsData = JSON.parse(data);
      console.log(`Loaded metrics snapshot from ${filePath}`);
    }
  } catch (error) {
    console.error('Error loading metrics snapshot:', error);
  }
}


app.get('/api/metrics/system', (req, res) => {
  res.json(metricsData.system);
});

app.get('/api/metrics/components', (req, res) => {
  const { component } = req.query;
  
  if (component && metricsData.components[component]) {
    res.json(metricsData.components[component]);
  } else {
    res.json(metricsData.components);
  }
});

app.get('/api/metrics/historical', (req, res) => {
  const { type, timeframe } = req.query;
  
  if (!type || !MetricType[type.toUpperCase()]) {
    return res.status(400).json({ error: 'Invalid metric type' });
  }
  
  const data = getMetricsForTimeframe(type, timeframe || MetricTimeframe.LAST_HOUR);
  res.json(data);
});

app.get('/api/metrics/analysis', (req, res) => {
  const { type, timeframe } = req.query;
  
  if (!type || !MetricType[type.toUpperCase()]) {
    return res.status(400).json({ error: 'Invalid metric type' });
  }
  
  const analysis = calculateMetricsAnalysis(type, timeframe || MetricTimeframe.LAST_HOUR);
  res.json(analysis);
});

app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end(error);
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  console.log('Client connected to metrics server');
  
  socket.emit('system_metrics', metricsData.system);
  socket.emit('all_components', metricsData.components);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected from metrics server');
  });
});

function startServer(port = DEFAULT_PORT) {
  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`Metrics server running on port ${port}`);
      resolve(server);
    });
  });
}

const snapshotInterval = setInterval(saveMetricsSnapshot, SNAPSHOT_INTERVAL);

process.on('SIGINT', async () => {
  clearInterval(snapshotInterval);
  await saveMetricsSnapshot();
  server.close(() => {
    console.log('Metrics server stopped');
    process.exit(0);
  });
});

loadLatestMetricsSnapshot();

module.exports = {
  MetricType,
  MetricTimeframe,
  recordMetric,
  updateSystemMetrics,
  updateComponentMetrics,
  getMetricsForTimeframe,
  calculateMetricsAnalysis,
  startServer,
  server
};
