/**
 * Example of using the Metrics module to monitor Layer 2 performance
 */

import { createLayer2Client, Layer2ClientConfig } from '../../src/index';
import { MetricsManager, MetricType, MetricTimeframe } from '../../src/metrics';

async function monitorPerformance() {
  const config: Layer2ClientConfig = {
    rpcUrl: 'https://api.devnet.solana.com',
    debug: true,
    timeout: 30000,
    maxRetries: 3
  };

  const client = createLayer2Client(config);

  const metricsManager = new MetricsManager(client, {
    enabled: true,
    samplingInterval: 5000, // 5 seconds
    detailLevel: 'detailed',
    sendToServer: true,
    onMetric: (metric) => {
      console.log(`Metric recorded: ${metric.type} = ${metric.value}`);
    }
  });

  metricsManager.recordMetric(MetricType.THROUGHPUT, 1250, {
    operation: 'batch_processing',
    batchId: 'batch_12345'
  });

  const analysis = await metricsManager.getMetricsAnalysis(
    MetricType.LATENCY,
    MetricTimeframe.LAST_HOUR
  );

  console.log('Metrics Analysis:', analysis);

  const localAnalysis = metricsManager.calculateLocalMetricsAnalysis(
    MetricType.THROUGHPUT,
    Date.now() - 3600000, // Last hour
    Date.now()
  );

  console.log('Local Metrics Analysis:', localAnalysis);

  metricsManager.stopSampling();
}

monitorPerformance().catch(console.error);
