/**
 * Test unitari per il Performance Analyzer
 */

const { PerformanceAnalyzer } = require('../../offchain/performance-analyzer');
const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

describe('PerformanceAnalyzer', () => {
    let performanceAnalyzer;
    let tempDir;
    let dataDir;
    let clock;
    
    beforeEach(async () => {
        // Crea una directory temporanea per i test
        tempDir = path.join(__dirname, '..', '..', 'temp-test-' + Date.now());
        dataDir = path.join(tempDir, 'performance-data');
        
        await fs.mkdir(tempDir, { recursive: true });
        await fs.mkdir(dataDir, { recursive: true });
        
        // Crea un'istanza di PerformanceAnalyzer con configurazione di test
        performanceAnalyzer = new PerformanceAnalyzer({
            dataDir,
            sampleInterval: 100, // 100ms per i test
            retentionPeriod: 1, // 1 giorno
            logger: {
                info: sinon.spy(),
                warn: sinon.spy(),
                error: sinon.spy(),
                debug: sinon.spy()
            }
        });
        
        // Stub delle funzioni di sistema
        sinon.stub(os, 'cpus').returns([
            { model: 'Test CPU', speed: 2000, times: { user: 100, nice: 0, sys: 50, idle: 200, irq: 0 } }
        ]);
        
        sinon.stub(os, 'totalmem').returns(8 * 1024 * 1024 * 1024); // 8GB
        sinon.stub(os, 'freemem').returns(4 * 1024 * 1024 * 1024); // 4GB
        sinon.stub(os, 'loadavg').returns([1.0, 1.5, 2.0]);
        sinon.stub(os, 'uptime').returns(3600); // 1 ora
        
        // Stub della funzione exec per simulare l'output di df
        const execStub = sinon.stub(require('child_process'), 'exec');
        execStub.withArgs('df -k / | tail -1').callsFake((cmd, callback) => {
            callback(null, {
                stdout: 'Filesystem     1K-blocks    Used Available Use% Mounted on\n/dev/sda1      100000000 50000000  50000000  50% /'
            });
        });
        
        execStub.withArgs('netstat -an | grep ESTABLISHED | wc -l').callsFake((cmd, callback) => {
            callback(null, {
                stdout: '10'
            });
        });
        
        // Inizializza l'analyzer
        await performanceAnalyzer.initialize();
    });
    
    afterEach(async () => {
        // Ferma il monitoraggio se è in esecuzione
        if (performanceAnalyzer.isRunning) {
            await performanceAnalyzer.stop();
        }
        
        // Ripristina il clock se è stato utilizzato
        if (clock) {
            clock.restore();
            clock = null;
        }
        
        // Pulisci la directory temporanea
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
            console.error(`Errore durante la pulizia della directory temporanea: ${error.message}`);
        }
        
        // Ripristina tutti i mock
        sinon.restore();
    });
    
    describe('initialize()', () => {
        it('dovrebbe inizializzare correttamente l\'analyzer', () => {
            expect(performanceAnalyzer.isInitialized).to.be.true;
            expect(performanceAnalyzer.currentMetrics).to.be.an('object');
            expect(performanceAnalyzer.historicalMetrics).to.be.an('array');
        });
    });
    
    describe('start() e stop()', () => {
        it('dovrebbe avviare e fermare il monitoraggio correttamente', async () => {
            // Avvia il monitoraggio
            await performanceAnalyzer.start();
            
            expect(performanceAnalyzer.isRunning).to.be.true;
            expect(performanceAnalyzer.samplingTimer).to.not.be.null;
            
            // Ferma il monitoraggio
            await performanceAnalyzer.stop();
            
            expect(performanceAnalyzer.isRunning).to.be.false;
            expect(performanceAnalyzer.samplingTimer).to.be.null;
        });
        
        it('dovrebbe lanciare un errore se l\'analyzer non è inizializzato', async () => {
            const uninitializedAnalyzer = new PerformanceAnalyzer({
                dataDir
            });
            
            try {
                await uninitializedAnalyzer.start();
                
                // La funzione dovrebbe lanciare un errore, quindi non dovremmo arrivare qui
                expect.fail('La funzione non ha lanciato un errore');
            } catch (error) {
                expect(error.message).to.include('non è inizializzato');
            }
        });
    });
    
    describe('_sampleMetrics()', () => {
        it('dovrebbe campionare le metriche correttamente', async () => {
            const metrics = await performanceAnalyzer._sampleMetrics();
            
            expect(metrics).to.be.an('object');
            expect(metrics.timestamp).to.be.a('string');
            expect(metrics.system).to.be.an('object');
            expect(metrics.system.cpu).to.be.an('object');
            expect(metrics.system.memory).to.be.an('object');
            expect(metrics.system.disk).to.be.an('object');
            expect(metrics.system.load).to.be.an('object');
            expect(metrics.application).to.be.an('object');
            expect(metrics.network).to.be.an('object');
            expect(metrics.database).to.be.an('object');
            expect(metrics.custom).to.be.an('object');
        });
        
        it('dovrebbe aggiungere le metriche alla storia', async () => {
            const initialLength = performanceAnalyzer.historicalMetrics.length;
            
            await performanceAnalyzer._sampleMetrics();
            
            expect(performanceAnalyzer.historicalMetrics.length).to.equal(initialLength + 1);
        });
    });
    
    describe('_analyzeMetrics()', () => {
        it('dovrebbe verificare le soglie correttamente', () => {
            // Crea metriche di test che superano le soglie
            const metrics = {
                timestamp: new Date().toISOString(),
                system: {
                    cpu: {
                        usage: 90 // Supera la soglia di default (80%)
                    },
                    memory: {
                        usage: 70 // Non supera la soglia
                    },
                    disk: {
                        usage: 85 // Supera la soglia di default (80%)
                    }
                },
                application: {
                    avgResponseTime: 600, // Supera la soglia di default (500ms)
                    errorRate: 3 // Non supera la soglia
                }
            };
            
            // Spy sull'evento threshold_exceeded
            const thresholdExceededSpy = sinon.spy();
            performanceAnalyzer.on('threshold_exceeded', thresholdExceededSpy);
            
            // Analizza le metriche
            performanceAnalyzer._analyzeMetrics(metrics);
            
            // Verifica che l'evento sia stato emesso per le metriche che superano le soglie
            expect(thresholdExceededSpy.callCount).to.equal(3); // CPU, disk, responseTime
            expect(thresholdExceededSpy.firstCall.args[0].metric).to.equal('cpu');
            expect(thresholdExceededSpy.secondCall.args[0].metric).to.equal('disk');
            expect(thresholdExceededSpy.thirdCall.args[0].metric).to.equal('responseTime');
        });
        
        it('dovrebbe identificare le anomalie correttamente', () => {
            // Popola la storia con metriche normali
            for (let i = 0; i < 10; i++) {
                performanceAnalyzer.historicalMetrics.push({
                    timestamp: new Date().toISOString(),
                    system: {
                        cpu: { usage: 50 },
                        memory: { usage: 60 }
                    },
                    application: {
                        avgResponseTime: 200,
                        errorRate: 1
                    }
                });
            }
            
            // Crea metriche di test con anomalie
            const metrics = {
                timestamp: new Date().toISOString(),
                system: {
                    cpu: {
                        usage: 90 // Anomalia rispetto alla media (50%)
                    },
                    memory: {
                        usage: 60 // Normale
                    }
                },
                application: {
                    avgResponseTime: 800, // Anomalia rispetto alla media (200ms)
                    errorRate: 1 // Normale
                }
            };
            
            // Spy sull'evento anomaly_detected
            const anomalyDetectedSpy = sinon.spy();
            performanceAnalyzer.on('anomaly_detected', anomalyDetectedSpy);
            
            // Analizza le metriche
            performanceAnalyzer._analyzeMetrics(metrics);
            
            // Verifica che l'evento sia stato emesso per le metriche anomale
            expect(anomalyDetectedSpy.callCount).to.equal(2); // CPU, responseTime
            expect(anomalyDetectedSpy.firstCall.args[0].metric).to.equal('cpu');
            expect(anomalyDetectedSpy.secondCall.args[0].metric).to.equal('responseTime');
        });
        
        it('dovrebbe generare suggerimenti di ottimizzazione correttamente', () => {
            // Crea metriche di test che richiedono ottimizzazioni
            const metrics = {
                timestamp: new Date().toISOString(),
                system: {
                    cpu: {
                        usage: 90 // Alto utilizzo della CPU
                    },
                    memory: {
                        usage: 85 // Alto utilizzo della memoria
                    },
                    disk: {
                        usage: 70 // Normale
                    }
                },
                application: {
                    avgResponseTime: 600, // Alto tempo di risposta
                    errorRate: 10 // Alto tasso di errore
                }
            };
            
            // Spy sull'evento optimization_suggested
            const optimizationSuggestedSpy = sinon.spy();
            performanceAnalyzer.on('optimization_suggested', optimizationSuggestedSpy);
            
            // Analizza le metriche
            performanceAnalyzer._analyzeMetrics(metrics);
            
            // Verifica che l'evento sia stato emesso per le metriche che richiedono ottimizzazioni
            expect(optimizationSuggestedSpy.callCount).to.equal(4); // CPU, memory, responseTime, errorRate
            expect(optimizationSuggestedSpy.firstCall.args[0].metric).to.equal('cpu');
            expect(optimizationSuggestedSpy.secondCall.args[0].metric).to.equal('memory');
            expect(optimizationSuggestedSpy.thirdCall.args[0].metric).to.equal('responseTime');
            expect(optimizationSuggestedSpy.getCall(3).args[0].metric).to.equal('errorRate');
        });
    });
    
    describe('recordRequest()', () => {
        it('dovrebbe registrare una richiesta correttamente', () => {
            // Registra una richiesta di successo
            performanceAnalyzer.recordRequest({
                processingTime: 100
            });
            
            expect(performanceAnalyzer.counters.requests).to.equal(1);
            expect(performanceAnalyzer.counters.errors).to.equal(0);
            expect(performanceAnalyzer.counters.transactions).to.equal(0);
            expect(performanceAnalyzer.counters.processingTime).to.equal(100);
            
            // Registra una richiesta con errore
            performanceAnalyzer.recordRequest({
                processingTime: 200,
                error: true
            });
            
            expect(performanceAnalyzer.counters.requests).to.equal(2);
            expect(performanceAnalyzer.counters.errors).to.equal(1);
            expect(performanceAnalyzer.counters.processingTime).to.equal(300);
            
            // Registra una richiesta con transazione
            performanceAnalyzer.recordRequest({
                processingTime: 300,
                transaction: true
            });
            
            expect(performanceAnalyzer.counters.requests).to.equal(3);
            expect(performanceAnalyzer.counters.transactions).to.equal(1);
            expect(performanceAnalyzer.counters.processingTime).to.equal(600);
        });
    });
    
    describe('recordCustomMetric()', () => {
        it('dovrebbe registrare una metrica personalizzata correttamente', () => {
            // Registra una metrica personalizzata semplice
            performanceAnalyzer.recordCustomMetric('testMetric', 42);
            
            expect(performanceAnalyzer.customMetrics.testMetric).to.equal(42);
            
            // Registra una metrica personalizzata complessa
            performanceAnalyzer.recordCustomMetric('complexMetric', {
                value: 100,
                min: 50,
                max: 150
            });
            
            expect(performanceAnalyzer.customMetrics.complexMetric).to.be.an('object');
            expect(performanceAnalyzer.customMetrics.complexMetric.value).to.equal(100);
        });
    });
    
    describe('resetCounters()', () => {
        it('dovrebbe resettare i contatori correttamente', () => {
            // Registra alcune richieste
            performanceAnalyzer.recordRequest({ processingTime: 100 });
            performanceAnalyzer.recordRequest({ processingTime: 200, error: true });
            
            // Verifica che i contatori siano stati aggiornati
            expect(performanceAnalyzer.counters.requests).to.equal(2);
            expect(performanceAnalyzer.counters.errors).to.equal(1);
            
            // Resetta i contatori
            performanceAnalyzer.resetCounters();
            
            // Verifica che i contatori siano stati resettati
            expect(performanceAnalyzer.counters.requests).to.equal(0);
            expect(performanceAnalyzer.counters.errors).to.equal(0);
            expect(performanceAnalyzer.counters.transactions).to.equal(0);
            expect(performanceAnalyzer.counters.processingTime).to.equal(0);
        });
    });
    
    describe('generateReport()', () => {
        it('dovrebbe generare un report correttamente', async () => {
            // Popola la storia con alcune metriche
            for (let i = 0; i < 10; i++) {
                performanceAnalyzer.historicalMetrics.push({
                    timestamp: new Date().toISOString(),
                    system: {
                        cpu: { usage: 50 + i },
                        memory: { usage: 60 + i },
                        disk: { usage: 40 + i }
                    },
                    application: {
                        avgResponseTime: 200 + i * 10,
                        errorRate: 1 + i * 0.5
                    }
                });
            }
            
            // Genera un report
            const report = await performanceAnalyzer.generateReport({
                period: 'day'
            });
            
            expect(report).to.be.an('object');
            expect(report.period).to.equal('day');
            expect(report.metrics).to.be.an('object');
            expect(report.metrics.cpu).to.be.an('object');
            expect(report.metrics.memory).to.be.an('object');
            expect(report.metrics.disk).to.be.an('object');
            expect(report.metrics.responseTime).to.be.an('object');
            expect(report.metrics.errorRate).to.be.an('object');
        });
        
        it('dovrebbe generare un report HTML correttamente', async () => {
            // Popola la storia con alcune metriche
            for (let i = 0; i < 10; i++) {
                performanceAnalyzer.historicalMetrics.push({
                    timestamp: new Date().toISOString(),
                    system: {
                        cpu: { usage: 50 + i },
                        memory: { usage: 60 + i },
                        disk: { usage: 40 + i }
                    },
                    application: {
                        avgResponseTime: 200 + i * 10,
                        errorRate: 1 + i * 0.5
                    }
                });
            }
            
            // Genera un report HTML
            const report = await performanceAnalyzer.generateReport({
                period: 'day',
                format: 'html'
            });
            
            expect(report).to.be.a('string');
            expect(report).to.include('<!DOCTYPE html>');
            expect(report).to.include('<title>Performance Report</title>');
        });
        
        it('dovrebbe generare un report CSV correttamente', async () => {
            // Popola la storia con alcune metriche
            for (let i = 0; i < 10; i++) {
                performanceAnalyzer.historicalMetrics.push({
                    timestamp: new Date().toISOString(),
                    system: {
                        cpu: { usage: 50 + i },
                        memory: { usage: 60 + i },
                        disk: { usage: 40 + i }
                    },
                    application: {
                        avgResponseTime: 200 + i * 10,
                        errorRate: 1 + i * 0.5
                    }
                });
            }
            
            // Genera un report CSV
            const report = await performanceAnalyzer.generateReport({
                period: 'day',
                format: 'csv'
            });
            
            expect(report).to.be.a('string');
            expect(report).to.include('Metric,Min,Max,Mean,StdDev,Trend');
            expect(report).to.include('CPU Usage (%)');
        });
        
        it('dovrebbe lanciare un errore se il formato non è valido', async () => {
            try {
                await performanceAnalyzer.generateReport({
                    format: 'invalid'
                });
                
                // La funzione dovrebbe lanciare un errore, quindi non dovremmo arrivare qui
                expect.fail('La funzione non ha lanciato un errore');
            } catch (error) {
                expect(error.message).to.include('Formato non valido');
            }
        });
    });
    
    describe('getStatus()', () => {
        it('dovrebbe restituire lo stato corrente dell\'analyzer', () => {
            const status = performanceAnalyzer.getStatus();
            
            expect(status).to.be.an('object');
            expect(status.isInitialized).to.be.true;
            expect(status.isRunning).to.be.false;
            expect(status.sampleInterval).to.equal(100);
            expect(status.retentionPeriod).to.equal(1);
            expect(status.historicalMetrics).to.equal(0);
            expect(status.anomalies).to.equal(0);
            expect(status.optimizationSuggestions).to.equal(0);
            expect(status.counters).to.be.an('object');
            expect(status.timestamp).to.be.a('string');
        });
    });
    
    describe('Monitoraggio in tempo reale', () => {
        it('dovrebbe campionare le metriche periodicamente', async () => {
            // Spy sul metodo _sampleMetrics
            const sampleMetricsSpy = sinon.spy(performanceAnalyzer, '_sampleMetrics');
            
            // Usa un clock finto per controllare il tempo
            clock = sinon.useFakeTimers();
            
            // Avvia il monitoraggio
            await performanceAnalyzer.start();
            
            // Avanza il tempo
            await clock.tickAsync(100); // Prima campionamento
            
            expect(sampleMetricsSpy.callCount).to.equal(2); // Una volta in start() e una volta dopo 100ms
            
            // Avanza ulteriormente il tempo
            await clock.tickAsync(100); // Secondo campionamento
            
            expect(sampleMetricsSpy.callCount).to.equal(3);
            
            // Ferma il monitoraggio
            await performanceAnalyzer.stop();
        });
    });
});
