/**
 * @fileoverview Test di integrazione per il sistema di sicurezza completo
 * 
 * Questo file contiene i test di integrazione per il sistema di sicurezza completo,
 * verificando il corretto funzionamento di tutti i componenti integrati insieme.
 */

const { expect } = require('chai');
const sinon = require('sinon');
const express = require('express');
const request = require('supertest');
const { SecuritySystem } = require('../../offchain/security_system');
const { Logger } = require('../../offchain/logger/structured_logger');

describe('SecuritySystem Integration Tests', () => {
  let securitySystem;
  let app;
  let clock;
  let loggerSpy;
  
  beforeEach(() => {
    // Usa sinon per controllare il tempo
    clock = sinon.useFakeTimers(Date.now());
    
    // Spia sul logger
    loggerSpy = sinon.spy(Logger.prototype, 'info');
    
    // Inizializza il sistema di sicurezza con configurazione di test
    securitySystem = new SecuritySystem({
      logger: {
        level: 'debug',
        serviceName: 'security-system-test'
      },
      anomalyDetector: {
        alertThreshold: 2, // Soglia più bassa per i test
        updateInterval: 1000 // Intervallo più breve per i test
      },
      securityRules: {
        evaluationInterval: 1000 // Intervallo più breve per i test
      },
      alertNotifier: {
        channels: ['log'], // Solo log per i test
        throttling: {
          enabled: false // Disabilita il throttling per i test
        }
      },
      secretRotation: {
        defaultRotationInterval: 1000, // Intervallo più breve per i test
        defaultGracePeriod: 500 // Periodo di grazia più breve per i test
      }
    });
    
    // Crea un'app Express per testare il middleware
    app = express();
    app.use(express.json());
    app.use(securitySystem.createExpressMiddleware());
    
    // Aggiungi una route di test
    app.post('/api/test', (req, res) => {
      res.json({
        success: true,
        correlationId: req.getCorrelationId(),
        data: {
          sensitive: 'This should be redacted',
          password: 'secret123'
        }
      });
    });
    
    // Aggiungi una route che genera un evento di sicurezza
    app.post('/api/login', (req, res) => {
      const { username, password } = req.body;
      
      // Aggiungi un evento alle regole di sicurezza
      securitySystem.addSecurityEvent({
        type: 'login',
        username,
        success: username === 'admin' && password === 'correct',
        ip: req.ip,
        timestamp: Date.now()
      });
      
      if (username === 'admin' && password === 'correct') {
        res.json({ success: true });
      } else {
        res.status(401).json({ success: false });
      }
    });
    
    // Aggiungi una route che genera un'anomalia
    app.post('/api/transactions', (req, res) => {
      const { amount } = req.body;
      
      // Aggiorna le statistiche del rilevatore di anomalie
      securitySystem.updateStats({
        transactionsPerMinute: amount > 1000 ? 100 : 10, // Genera un'anomalia se l'importo è elevato
        responseTime: amount > 1000 ? 500 : 50
      });
      
      res.json({ success: true });
    });
  });
  
  afterEach(async () => {
    // Ferma il sistema di sicurezza
    await securitySystem.stop();
    
    // Ripristina il tempo reale
    clock.restore();
    
    // Ripristina le spie
    sinon.restore();
  });
  
  describe('Middleware Express', () => {
    it('dovrebbe aggiungere l\'ID di correlazione alle richieste', async () => {
      const response = await request(app)
        .post('/api/test')
        .send({})
        .expect(200);
      
      expect(response.body.correlationId).to.be.a('string');
    });
    
    it('dovrebbe redarre le informazioni sensibili nelle risposte', async () => {
      const response = await request(app)
        .post('/api/test')
        .send({})
        .expect(200);
      
      // Verifica che i dati sensibili siano stati redatti
      expect(response.body.data.password).to.equal('[REDACTED]');
    });
    
    it('dovrebbe registrare gli eventi di richiesta API', async () => {
      await request(app)
        .post('/api/test')
        .send({})
        .expect(200);
      
      // Verifica che l'evento sia stato aggiunto alle regole di sicurezza
      const events = securitySystem.securityRules.getEvents({
        types: ['api-request']
      });
      
      expect(events).to.be.an('array').that.is.not.empty;
      expect(events[0].type).to.equal('api-request');
      expect(events[0].path).to.equal('/api/test');
    });
  });
  
  describe('Rilevamento anomalie e regole di sicurezza', () => {
    it('dovrebbe rilevare anomalie e generare alert', async () => {
      // Avvia il sistema di sicurezza
      await securitySystem.start();
      
      // Spia sul metodo notify dell'alertNotifier
      const notifySpy = sinon.spy(securitySystem.alertNotifier, 'notify');
      
      // Invia una richiesta che genera un'anomalia
      await request(app)
        .post('/api/transactions')
        .send({ amount: 2000 }) // Importo elevato
        .expect(200);
      
      // Avanza il tempo per permettere al rilevatore di anomalie di elaborare
      clock.tick(2000);
      
      // Verifica che sia stata rilevata un'anomalia
      const anomalies = securitySystem.anomalyDetector.getAnomalies();
      expect(anomalies).to.be.an('array').that.is.not.empty;
      
      // Verifica che sia stato generato un alert
      expect(notifySpy.called).to.be.true;
    });
    
    it('dovrebbe rilevare attività sospette e generare alert', async () => {
      // Avvia il sistema di sicurezza
      await securitySystem.start();
      
      // Spia sul metodo notify dell'alertNotifier
      const notifySpy = sinon.spy(securitySystem.alertNotifier, 'notify');
      
      // Invia più richieste di login fallite
      for (let i = 0; i < 6; i++) {
        await request(app)
          .post('/api/login')
          .send({ username: 'admin', password: 'wrong' })
          .expect(401);
      }
      
      // Avanza il tempo per permettere alle regole di sicurezza di elaborare
      clock.tick(2000);
      
      // Verifica che sia stato generato un alert
      expect(notifySpy.called).to.be.true;
      
      // Verifica che l'alert sia relativo a tentativi di login falliti
      const alerts = securitySystem.securityRules.getAlerts();
      expect(alerts).to.be.an('array').that.is.not.empty;
      
      // Almeno un alert dovrebbe essere relativo a tentativi di login falliti
      const loginAlert = alerts.find(a => a.ruleName.includes('failed'));
      expect(loginAlert).to.exist;
    });
  });
  
  describe('Rotazione dei segreti e periodi di grazia', () => {
    it('dovrebbe pianificare e eseguire rotazioni dei segreti', async () => {
      // Avvia il sistema di sicurezza
      await securitySystem.start();
      
      // Pianifica una rotazione immediata
      const result = await securitySystem.scheduleSecretRotation({
        keyId: 'test-key',
        scheduledTime: Date.now()
      });
      
      expect(result).to.be.an('object');
      expect(result.keyId).to.equal('test-key');
      
      // Avanza il tempo per permettere alla rotazione di essere eseguita
      clock.tick(2000);
      
      // Verifica che la rotazione sia stata eseguita
      const history = securitySystem.secretRotationService.getRotationHistory();
      expect(history).to.be.an('array').that.is.not.empty;
    });
    
    it('dovrebbe gestire i periodi di grazia per le chiavi ruotate', async () => {
      // Avvia il sistema di sicurezza
      await securitySystem.start();
      
      // Spia sull'evento di rotazione
      const rotationSpy = sinon.spy();
      securitySystem.secretRotationService.on('rotation', rotationSpy);
      
      // Spia sull'evento di inizio periodo di grazia
      const gracePeriodSpy = sinon.spy();
      securitySystem.gracePeriodManager.on('started', gracePeriodSpy);
      
      // Esegui una rotazione
      await securitySystem.secretRotationService.rotateKey('test-key');
      
      // Verifica che l'evento di rotazione sia stato emesso
      expect(rotationSpy.called).to.be.true;
      
      // Verifica che sia stato avviato un periodo di grazia
      expect(gracePeriodSpy.called).to.be.true;
      
      // Verifica che la chiave sia in periodo di grazia
      const oldKeyId = rotationSpy.args[0][0].oldKeyId;
      expect(securitySystem.isKeyInGracePeriod(oldKeyId)).to.be.true;
      
      // Avanza il tempo oltre il periodo di grazia
      clock.tick(1000);
      
      // Verifica che la chiave non sia più in periodo di grazia
      expect(securitySystem.isKeyInGracePeriod(oldKeyId)).to.be.false;
    });
  });
  
  describe('Integrazione complessiva', () => {
    it('dovrebbe integrare correttamente tutti i componenti', async () => {
      // Avvia il sistema di sicurezza
      await securitySystem.start();
      
      // Verifica che tutti i componenti siano stati avviati
      const status = securitySystem.getStatus();
      expect(status.anomalyDetector.isRunning).to.be.true;
      expect(status.securityRules.isRunning).to.be.true;
      expect(status.secretRotation.isRunning).to.be.true;
      expect(status.gracePeriod.isRunning).to.be.true;
      
      // Esegui una serie di operazioni che coinvolgono tutti i componenti
      
      // 1. Invia una richiesta che genera un evento di sicurezza
      await request(app)
        .post('/api/login')
        .send({ username: 'admin', password: 'wrong' })
        .expect(401);
      
      // 2. Invia una richiesta che genera un'anomalia
      await request(app)
        .post('/api/transactions')
        .send({ amount: 5000 })
        .expect(200);
      
      // 3. Pianifica una rotazione dei segreti
      await securitySystem.scheduleSecretRotation({
        keyId: 'integration-test-key',
        scheduledTime: Date.now()
      });
      
      // Avanza il tempo per permettere a tutti i componenti di elaborare
      clock.tick(2000);
      
      // Verifica che tutti i componenti abbiano funzionato correttamente
      
      // Verifica che siano stati registrati eventi di sicurezza
      const events = securitySystem.securityRules.getEvents();
      expect(events).to.be.an('array').that.is.not.empty;
      
      // Verifica che siano state rilevate anomalie
      const anomalies = securitySystem.anomalyDetector.getAnomalies();
      expect(anomalies).to.be.an('array').that.is.not.empty;
      
      // Verifica che siano stati generati alert
      const alerts = securitySystem.securityRules.getAlerts();
      expect(alerts).to.be.an('array').that.is.not.empty;
      
      // Verifica che siano state eseguite rotazioni dei segreti
      const rotations = securitySystem.secretRotationService.getRotationHistory();
      expect(rotations).to.be.an('array').that.is.not.empty;
      
      // Verifica che il logger sia stato utilizzato
      expect(loggerSpy.called).to.be.true;
    });
    
    it('dovrebbe gestire correttamente lo stop e il riavvio', async () => {
      // Avvia il sistema di sicurezza
      await securitySystem.start();
      
      // Verifica che tutti i componenti siano stati avviati
      let status = securitySystem.getStatus();
      expect(status.anomalyDetector.isRunning).to.be.true;
      
      // Ferma il sistema di sicurezza
      await securitySystem.stop();
      
      // Verifica che tutti i componenti siano stati fermati
      status = securitySystem.getStatus();
      expect(status.anomalyDetector.isRunning).to.be.false;
      expect(status.securityRules.isRunning).to.be.false;
      
      // Riavvia il sistema di sicurezza
      await securitySystem.start();
      
      // Verifica che tutti i componenti siano stati riavviati
      status = securitySystem.getStatus();
      expect(status.anomalyDetector.isRunning).to.be.true;
      expect(status.securityRules.isRunning).to.be.true;
    });
  });
});
