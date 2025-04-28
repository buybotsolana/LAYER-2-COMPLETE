/**
 * @file metrics.service.test.ts
 * @description Comprehensive tests for the MetricsService
 * @author Manus AI
 * @date April 27, 2025
 */

import { MetricsService } from '../src/monitoring/MetricsService';
import { Logger } from '../src/utils/Logger';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock Logger
class MockLogger {
  createChild() {
    return this;
  }
  
  debug() {}
  info() {}
  warn() {}
  error() {}
}

describe('MetricsService', () => {
  let metricsService: MetricsService;
  let tempDir: string;
  
  beforeEach(() => {
    // Create temp directory for metrics files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-test-'));
    
    // Create metrics service with test configuration
    metricsService = new MetricsService(new MockLogger() as unknown as Logger, {
      enabled: true,
      collectInterval: 1000, // 1 second for faster testing
      retentionPeriod: 1, // 1 day
      
      storage: {
        memory: {
          enabled: true,
          maxItems: 100
        },
        file: {
          enabled: true,
          directory: tempDir,
          rotateInterval: 10000 // 10 seconds for faster testing
        },
        prometheus: {
          enabled: false
        },
        influxdb: {
          enabled: false
        }
      }
    });
  });
  
  afterEach(async () => {
    // Stop metrics service
    await metricsService.stop();
    
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  test('should start and stop correctly', async () => {
    // Start metrics service
    await metricsService.start();
    
    // Check status
    const status = metricsService.getStatus();
    expect(status.isRunning).toBe(true);
    expect(status.enabled).toBe(true);
    
    // Stop metrics service
    await metricsService.stop();
    
    // Check status
    const statusAfterStop = metricsService.getStatus();
    expect(statusAfterStop.isRunning).toBe(false);
  });
  
  test('should record and retrieve metrics', async () => {
    // Start metrics service
    await metricsService.start();
    
    // Record some metrics
    metricsService.recordMetric('test.metric1', 42);
    metricsService.recordMetric('test.metric2', 123);
    metricsService.recordMetric('test.metric1', 43);
    
    // Get metrics
    const metric1 = metricsService.getMetrics('test.metric1');
    const metric2 = metricsService.getMetrics('test.metric2');
    
    // Check metrics
    expect(metric1).not.toBeNull();
    expect(metric2).not.toBeNull();
    
    if (metric1) {
      expect(metric1.name).toBe('test.metric1');
      expect(metric1.dataPoints.length).toBe(2);
      expect(metric1.dataPoints[0].value).toBe(42);
      expect(metric1.dataPoints[1].value).toBe(43);
    }
    
    if (metric2) {
      expect(metric2.name).toBe('test.metric2');
      expect(metric2.dataPoints.length).toBe(1);
      expect(metric2.dataPoints[0].value).toBe(123);
    }
    
    // Get latest values
    const latest1 = metricsService.getLatestValue('test.metric1');
    const latest2 = metricsService.getLatestValue('test.metric2');
    
    expect(latest1).toBe(43);
    expect(latest2).toBe(123);
  });
  
  test('should filter metrics by time range', async () => {
    // Start metrics service
    await metricsService.start();
    
    // Record metrics with different timestamps
    const now = Date.now();
    
    // Manually create metrics with specific timestamps
    (metricsService as any).storeMetricInMemory({
      name: 'test.metric',
      value: 1,
      timestamp: now - 3000 // 3 seconds ago
    });
    
    (metricsService as any).storeMetricInMemory({
      name: 'test.metric',
      value: 2,
      timestamp: now - 2000 // 2 seconds ago
    });
    
    (metricsService as any).storeMetricInMemory({
      name: 'test.metric',
      value: 3,
      timestamp: now - 1000 // 1 second ago
    });
    
    // Get metrics with time range
    const metrics = metricsService.getMetrics('test.metric', now - 2500, now - 500);
    
    // Check metrics
    expect(metrics).not.toBeNull();
    if (metrics) {
      expect(metrics.dataPoints.length).toBe(2);
      expect(metrics.dataPoints[0].value).toBe(2);
      expect(metrics.dataPoints[1].value).toBe(3);
    }
  });
  
  test('should write metrics to file', async () => {
    // Start metrics service
    await metricsService.start();
    
    // Record some metrics
    metricsService.recordMetric('test.metric1', 42);
    metricsService.recordMetric('test.metric2', 123);
    
    // Wait for file writes to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check if metrics file exists
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    const filePath = path.join(
      tempDir,
      `${year}-${month}-${day}.metrics.jsonl`
    );
    
    expect(fs.existsSync(filePath)).toBe(true);
    
    // Read file content
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    
    expect(lines.length).toBe(2);
    
    // Parse lines
    const metric1 = JSON.parse(lines[0]);
    const metric2 = JSON.parse(lines[1]);
    
    expect(metric1.name).toBe('test.metric1');
    expect(metric1.value).toBe(42);
    
    expect(metric2.name).toBe('test.metric2');
    expect(metric2.value).toBe(123);
  });
  
  test('should emit events for metrics and alerts', async () => {
    // Create metrics service with alerts
    const metricsWithAlerts = new MetricsService(new MockLogger() as unknown as Logger, {
      enabled: true,
      
      alerting: {
        enabled: true,
        thresholds: {
          'test.alert': {
            warning: 50,
            critical: 80
          }
        }
      }
    });
    
    // Start metrics service
    await metricsWithAlerts.start();
    
    // Set up event listeners
    const metricEvents: any[] = [];
    const alertEvents: any[] = [];
    
    metricsWithAlerts.on('metric', (metric) => {
      metricEvents.push(metric);
    });
    
    metricsWithAlerts.on('alert', (alert) => {
      alertEvents.push(alert);
    });
    
    // Record metrics
    metricsWithAlerts.recordMetric('test.normal', 30);
    metricsWithAlerts.recordMetric('test.alert', 60); // Should trigger warning
    metricsWithAlerts.recordMetric('test.alert', 90); // Should trigger critical
    
    // Check events
    expect(metricEvents.length).toBe(3);
    expect(alertEvents.length).toBe(2);
    
    expect(alertEvents[0].level).toBe('warning');
    expect(alertEvents[0].value).toBe(60);
    
    expect(alertEvents[1].level).toBe('critical');
    expect(alertEvents[1].value).toBe(90);
    
    // Clean up
    await metricsWithAlerts.stop();
  });
  
  test('should handle system metrics collection', async () => {
    // Mock collectSystemMetrics method
    const mockSystemMetrics = {
      cpu: {
        usage: 50,
        loadAvg1m: 1.5,
        loadAvg5m: 1.2,
        loadAvg15m: 1.0
      },
      memory: {
        total: 16000000000,
        free: 8000000000,
        used: 8000000000,
        usedPercent: 50
      },
      disk: {
        total: 1000000000000,
        free: 500000000000,
        used: 500000000000,
        usedPercent: 50
      },
      network: {
        bytesIn: 1000,
        bytesOut: 2000,
        packetsIn: 100,
        packetsOut: 200
      }
    };
    
    // Replace collectSystemMetrics with mock
    const originalCollectSystemMetrics = (metricsService as any).collectSystemMetrics;
    (metricsService as any).collectSystemMetrics = jest.fn().mockResolvedValue(mockSystemMetrics);
    
    // Start metrics service
    await metricsService.start();
    
    // Trigger metrics collection
    await (metricsService as any).collectMetrics();
    
    // Check if system metrics were recorded
    const cpuUsage = metricsService.getLatestValue('system.cpu.usage');
    const memoryUsed = metricsService.getLatestValue('system.memory.used');
    const diskUsedPercent = metricsService.getLatestValue('system.disk.usedPercent');
    const networkBytesIn = metricsService.getLatestValue('system.network.bytesIn');
    
    expect(cpuUsage).toBe(50);
    expect(memoryUsed).toBe(8000000000);
    expect(diskUsedPercent).toBe(50);
    expect(networkBytesIn).toBe(1000);
    
    // Restore original method
    (metricsService as any).collectSystemMetrics = originalCollectSystemMetrics;
  });
  
  test('should handle metrics with tags', async () => {
    // Start metrics service
    await metricsService.start();
    
    // Record metrics with tags
    metricsService.recordMetric('test.tagged', 42, { host: 'server1', region: 'us-east' });
    metricsService.recordMetric('test.tagged', 43, { host: 'server2', region: 'us-west' });
    
    // Get metrics
    const metrics = metricsService.getMetrics('test.tagged');
    
    // Check metrics
    expect(metrics).not.toBeNull();
    if (metrics) {
      expect(metrics.dataPoints.length).toBe(2);
      expect(metrics.dataPoints[0].value).toBe(42);
      expect(metrics.dataPoints[1].value).toBe(43);
      expect(metrics.tags).toEqual({ host: 'server2', region: 'us-west' }); // Last tags win
    }
  });
  
  test('should get all metrics', async () => {
    // Start metrics service
    await metricsService.start();
    
    // Record some metrics
    metricsService.recordMetric('test.metric1', 42);
    metricsService.recordMetric('test.metric2', 123);
    metricsService.recordMetric('test.metric3', 456);
    
    // Get all metrics
    const allMetrics = metricsService.getAllMetrics();
    
    // Check metrics
    expect(allMetrics.length).toBe(3);
    
    // Check metric names
    const metricNames = allMetrics.map(m => m.name);
    expect(metricNames).toContain('test.metric1');
    expect(metricNames).toContain('test.metric2');
    expect(metricNames).toContain('test.metric3');
  });
  
  test('should handle non-existent metrics', async () => {
    // Start metrics service
    await metricsService.start();
    
    // Try to get non-existent metric
    const nonExistentMetric = metricsService.getMetrics('non.existent');
    const nonExistentValue = metricsService.getLatestValue('non.existent');
    
    // Check results
    expect(nonExistentMetric).toBeNull();
    expect(nonExistentValue).toBeNull();
  });
  
  test('should limit number of data points in memory', async () => {
    // Create metrics service with small maxItems
    const metricsWithLimit = new MetricsService(new MockLogger() as unknown as Logger, {
      enabled: true,
      storage: {
        memory: {
          enabled: true,
          maxItems: 3 // Only keep 3 data points
        }
      }
    });
    
    // Start metrics service
    await metricsWithLimit.start();
    
    // Record more metrics than the limit
    metricsWithLimit.recordMetric('test.limited', 1);
    metricsWithLimit.recordMetric('test.limited', 2);
    metricsWithLimit.recordMetric('test.limited', 3);
    metricsWithLimit.recordMetric('test.limited', 4);
    metricsWithLimit.recordMetric('test.limited', 5);
    
    // Get metrics
    const metrics = metricsWithLimit.getMetrics('test.limited');
    
    // Check metrics
    expect(metrics).not.toBeNull();
    if (metrics) {
      expect(metrics.dataPoints.length).toBe(3);
      // Should have the 3 most recent data points
      expect(metrics.dataPoints[0].value).toBe(3);
      expect(metrics.dataPoints[1].value).toBe(4);
      expect(metrics.dataPoints[2].value).toBe(5);
    }
    
    // Clean up
    await metricsWithLimit.stop();
  });
});
