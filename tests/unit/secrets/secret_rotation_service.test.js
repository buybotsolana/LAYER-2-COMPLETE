/**
 * @fileoverview Test unitari per il sistema di rotazione dei segreti
 * 
 * Questo file contiene i test unitari per il sistema di rotazione dei segreti,
 * verificando il corretto funzionamento della pianificazione, esecuzione e
 * gestione della rotazione delle chiavi.
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { SecretRotationService } = require('../../offchain/secrets/secret_rotation_service');

describe('SecretRotationService', () => {
  let secretRotationService;
  let clock;
  let keyManagerMock;
  let eventEmitterSpy;
  
  beforeEach(() => {
    // Mock del KeyManager
    keyManagerMock = {
      rotateKey: sinon.stub().resolves({
        oldKeyId: 'old-key-123',
        newKeyId: 'new-key-456',
        success: true
      }),
      getKeyInfo: sinon.stub().resolves({
        keyId: 'key-123',
        createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 giorni fa
        expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000, // 60 giorni nel futuro
        status: 'active'
      })
    };
    
    // Configura il servizio di rotazione
    secretRotationService = new SecretRotationService({
      keyManager: keyManagerMock,
      defaultRotationInterval: 90 * 24 * 60 * 60 * 1000, // 90 giorni
      defaultGracePeriod: 7 * 24 * 60 * 60 * 1000, // 7 giorni
      autoStart: false
    });
    
    // Spia sull'emissione di eventi
    eventEmitterSpy = sinon.spy(secretRotationService, 'emit');
    
    // Usa sinon per controllare il tempo
    clock = sinon.useFakeTimers(Date.now());
  });
  
  afterEach(() => {
    // Ripristina il tempo reale
    clock.restore();
    
    // Ripristina le spie
    sinon.restore();
  });
  
  describe('Inizializzazione', () => {
    it('dovrebbe inizializzare correttamente con le opzioni predefinite', () => {
      const service = new SecretRotationService();
      expect(service).to.be.an.instanceOf(SecretRotationService);
      expect(service.rotationHistory).to.be.an('array').that.is.empty;
      expect(service.scheduledRotations).to.be.an('array').that.is.empty;
    });
    
    it('dovrebbe inizializzare correttamente con opzioni personalizzate', () => {
      const customInterval = 30 * 24 * 60 * 60 * 1000; // 30 giorni
      const customGracePeriod = 3 * 24 * 60 * 60 * 1000; // 3 giorni
      
      const service = new SecretRotationService({
        defaultRotationInterval: customInterval,
        defaultGracePeriod: customGracePeriod
      });
      
      expect(service.defaultRotationInterval).to.equal(customInterval);
      expect(service.defaultGracePeriod).to.equal(customGracePeriod);
    });
  });
  
  describe('scheduleRotation', () => {
    it('dovrebbe pianificare una rotazione con successo', async () => {
      const keyId = 'test-key-123';
      const scheduledTime = Date.now() + 24 * 60 * 60 * 1000; // 1 giorno nel futuro
      
      const result = await secretRotationService.scheduleRotation({
        keyId,
        scheduledTime
      });
      
      expect(result).to.be.an('object');
      expect(result.keyId).to.equal(keyId);
      expect(result.scheduledTime).to.equal(scheduledTime);
      expect(secretRotationService.scheduledRotations).to.have.lengthOf(1);
      expect(secretRotationService.scheduledRotations[0].keyId).to.equal(keyId);
    });
    
    it('dovrebbe pianificare una rotazione con l\'intervallo predefinito se non specificato', async () => {
      const keyId = 'test-key-123';
      
      const result = await secretRotationService.scheduleRotation({
        keyId
      });
      
      const expectedTime = Date.now() + secretRotationService.defaultRotationInterval;
      
      expect(result).to.be.an('object');
      expect(result.keyId).to.equal(keyId);
      expect(result.scheduledTime).to.be.closeTo(expectedTime, 1000); // Tolleranza di 1 secondo
    });
    
    it('dovrebbe rifiutare la pianificazione se la chiave è già pianificata', async () => {
      const keyId = 'test-key-123';
      
      // Prima pianificazione
      await secretRotationService.scheduleRotation({
        keyId
      });
      
      // Seconda pianificazione (dovrebbe fallire)
      try {
        await secretRotationService.scheduleRotation({
          keyId
        });
        expect.fail('Dovrebbe lanciare un errore');
      } catch (error) {
        expect(error.message).to.include('già pianificata');
      }
    });
  });
  
  describe('cancelRotation', () => {
    it('dovrebbe annullare una rotazione pianificata', async () => {
      const keyId = 'test-key-123';
      
      // Pianifica una rotazione
      await secretRotationService.scheduleRotation({
        keyId
      });
      
      expect(secretRotationService.scheduledRotations).to.have.lengthOf(1);
      
      // Annulla la rotazione
      const result = await secretRotationService.cancelRotation(keyId);
      
      expect(result).to.be.true;
      expect(secretRotationService.scheduledRotations).to.have.lengthOf(0);
    });
    
    it('dovrebbe restituire false se la chiave non è pianificata', async () => {
      const keyId = 'non-existent-key';
      
      const result = await secretRotationService.cancelRotation(keyId);
      
      expect(result).to.be.false;
    });
  });
  
  describe('rotateKey', () => {
    it('dovrebbe ruotare una chiave con successo', async () => {
      const keyId = 'test-key-123';
      
      const result = await secretRotationService.rotateKey(keyId);
      
      expect(result).to.be.an('object');
      expect(result.oldKeyId).to.equal('old-key-123');
      expect(result.newKeyId).to.equal('new-key-456');
      expect(result.success).to.be.true;
      
      // Verifica che l'evento sia stato emesso
      expect(eventEmitterSpy.calledWith('rotation')).to.be.true;
      
      // Verifica che la rotazione sia stata aggiunta alla cronologia
      expect(secretRotationService.rotationHistory).to.have.lengthOf(1);
      expect(secretRotationService.rotationHistory[0].oldKeyId).to.equal('old-key-123');
    });
    
    it('dovrebbe gestire gli errori durante la rotazione', async () => {
      const keyId = 'error-key';
      
      // Configura il mock per lanciare un errore
      keyManagerMock.rotateKey.withArgs(keyId).rejects(new Error('Errore di rotazione'));
      
      try {
        await secretRotationService.rotateKey(keyId);
        expect.fail('Dovrebbe lanciare un errore');
      } catch (error) {
        expect(error.message).to.equal('Errore di rotazione');
      }
      
      // Verifica che nessun evento sia stato emesso
      expect(eventEmitterSpy.calledWith('rotation')).to.be.false;
      
      // Verifica che nessuna rotazione sia stata aggiunta alla cronologia
      expect(secretRotationService.rotationHistory).to.have.lengthOf(0);
    });
  });
  
  describe('checkScheduledRotations', () => {
    it('dovrebbe eseguire le rotazioni pianificate che sono scadute', async () => {
      const keyId1 = 'key-1';
      const keyId2 = 'key-2';
      
      // Pianifica una rotazione nel passato
      await secretRotationService.scheduleRotation({
        keyId: keyId1,
        scheduledTime: Date.now() - 1000 // 1 secondo fa
      });
      
      // Pianifica una rotazione nel futuro
      await secretRotationService.scheduleRotation({
        keyId: keyId2,
        scheduledTime: Date.now() + 24 * 60 * 60 * 1000 // 1 giorno nel futuro
      });
      
      expect(secretRotationService.scheduledRotations).to.have.lengthOf(2);
      
      // Esegui il controllo
      await secretRotationService.checkScheduledRotations();
      
      // Verifica che la rotazione scaduta sia stata eseguita
      expect(keyManagerMock.rotateKey.calledWith(keyId1)).to.be.true;
      
      // Verifica che la rotazione futura non sia stata eseguita
      expect(keyManagerMock.rotateKey.calledWith(keyId2)).to.be.false;
      
      // Verifica che la rotazione scaduta sia stata rimossa dalla lista
      expect(secretRotationService.scheduledRotations).to.have.lengthOf(1);
      expect(secretRotationService.scheduledRotations[0].keyId).to.equal(keyId2);
    });
  });
  
  describe('getRotationHistory', () => {
    it('dovrebbe restituire la cronologia delle rotazioni', async () => {
      // Esegui alcune rotazioni
      await secretRotationService.rotateKey('key-1');
      await secretRotationService.rotateKey('key-2');
      
      const history = secretRotationService.getRotationHistory();
      
      expect(history).to.be.an('array').with.lengthOf(2);
      expect(history[0].oldKeyId).to.equal('old-key-123');
      expect(history[1].oldKeyId).to.equal('old-key-123');
    });
    
    it('dovrebbe filtrare la cronologia per chiave', async () => {
      // Configura il mock per restituire valori diversi
      keyManagerMock.rotateKey.onFirstCall().resolves({
        oldKeyId: 'old-key-1',
        newKeyId: 'new-key-1',
        success: true
      });
      
      keyManagerMock.rotateKey.onSecondCall().resolves({
        oldKeyId: 'old-key-2',
        newKeyId: 'new-key-2',
        success: true
      });
      
      // Esegui alcune rotazioni
      await secretRotationService.rotateKey('key-1');
      await secretRotationService.rotateKey('key-2');
      
      const history = secretRotationService.getRotationHistory('old-key-1');
      
      expect(history).to.be.an('array').with.lengthOf(1);
      expect(history[0].oldKeyId).to.equal('old-key-1');
    });
  });
  
  describe('handleExpiredKey', () => {
    it('dovrebbe gestire correttamente una chiave scaduta', async () => {
      const expiredKey = {
        keyId: 'expired-key',
        expiresAt: Date.now() - 1000, // 1 secondo fa
        metadata: {
          rotationId: 'rotation-123',
          newKeyId: 'new-key-456'
        }
      };
      
      await secretRotationService.handleExpiredKey(expiredKey);
      
      // Verifica che l'evento sia stato emesso
      expect(eventEmitterSpy.calledWith('key-expired')).to.be.true;
      
      // Verifica che l'argomento dell'evento sia corretto
      const eventArg = eventEmitterSpy.args.find(args => args[0] === 'key-expired')[1];
      expect(eventArg).to.be.an('object');
      expect(eventArg.keyId).to.equal('expired-key');
    });
  });
  
  describe('start e stop', () => {
    it('dovrebbe avviare e fermare correttamente il servizio', async () => {
      // Spia sul metodo checkScheduledRotations
      const checkSpy = sinon.spy(secretRotationService, 'checkScheduledRotations');
      
      // Avvia il servizio
      await secretRotationService.start();
      
      // Avanza il tempo di 1 minuto
      clock.tick(60 * 1000);
      
      // Verifica che checkScheduledRotations sia stato chiamato
      expect(checkSpy.called).to.be.true;
      
      // Ferma il servizio
      await secretRotationService.stop();
      
      // Resetta la spia
      checkSpy.resetHistory();
      
      // Avanza il tempo di un altro minuto
      clock.tick(60 * 1000);
      
      // Verifica che checkScheduledRotations non sia stato chiamato
      expect(checkSpy.called).to.be.false;
    });
  });
  
  describe('getStatus', () => {
    it('dovrebbe restituire lo stato corrente del servizio', async () => {
      // Pianifica una rotazione
      await secretRotationService.scheduleRotation({
        keyId: 'test-key',
        scheduledTime: Date.now() + 1000
      });
      
      // Esegui una rotazione
      await secretRotationService.rotateKey('another-key');
      
      // Ottieni lo stato
      const status = secretRotationService.getStatus();
      
      expect(status).to.be.an('object');
      expect(status.isRunning).to.be.false; // Non è stato avviato
      expect(status.scheduledRotationsCount).to.equal(1);
      expect(status.rotationHistoryCount).to.equal(1);
    });
  });
});
