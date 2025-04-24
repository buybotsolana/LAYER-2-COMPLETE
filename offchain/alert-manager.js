/**
 * Alert Manager per il sistema Layer-2 su Solana
 * 
 * Questo modulo implementa un sistema di gestione degli alert che si integra con
 * il sistema di monitoraggio principale, generando e gestendo alert basati su
 * regole configurabili e inviando notifiche attraverso vari canali.
 */

const EventEmitter = require('events');
const nodemailer = require('nodemailer');
const axios = require('axios');
const { CentralizedLogger } = require('./logger/logger');

/**
 * Classe principale per la gestione degli alert
 */
class AlertManager extends EventEmitter {
  /**
   * Crea una nuova istanza dell'alert manager
   * @param {Object} config - Configurazione dell'alert manager
   * @param {Object} monitoringSystem - Sistema di monitoraggio
   * @param {Object} logger - Logger centralizzato
   */
  constructor(config, monitoringSystem, logger) {
    super();
    
    this.config = {
      evaluationInterval: 15, // secondi
      alertDeduplicationPeriod: 300, // secondi
      alertExpirationPeriod: 86400, // secondi (1 giorno)
      maxAlertsPerRule: 100,
      maxTotalAlerts: 1000,
      notifiers: {
        console: {
          enabled: true
        },
        email: {
          enabled: false,
          from: 'alerts@layer2-solana.com',
          to: [],
          subject: '[ALERT] Layer-2 Solana Alert: {severity} - {name}',
          smtpConfig: {
            host: 'smtp.example.com',
            port: 587,
            secure: false,
            auth: {
              user: 'user',
              pass: 'password'
            }
          }
        },
        slack: {
          enabled: false,
          webhookUrl: '',
          channel: '#alerts',
          username: 'Layer-2 Alert Bot',
          iconEmoji: ':warning:'
        },
        webhook: {
          enabled: false,
          url: '',
          method: 'POST',
          headers: {}
        },
        sms: {
          enabled: false,
          provider: 'twilio',
          config: {
            accountSid: '',
            authToken: '',
            from: '',
            to: []
          }
        },
        pushNotification: {
          enabled: false,
          provider: 'firebase',
          config: {
            serviceAccountKey: '',
            topic: 'alerts'
          }
        }
      },
      rules: [],
      ...config
    };
    
    this.monitoringSystem = monitoringSystem;
    
    this.logger = logger || new CentralizedLogger({
      appName: 'alert-manager',
      logLevel: 'info'
    });
    
    // Stato interno
    this.activeAlerts = new Map();
    this.alertHistory = [];
    this.alertCounts = new Map();
    
    // Inizializza i notificatori
    this._initializeNotifiers();
    
    // Registra gli handler per gli eventi del sistema di monitoraggio
    this._registerEventHandlers();
    
    // Avvia il timer di valutazione delle regole
    this._startEvaluationTimer();
    
    this.logger.info('Alert Manager inizializzato', {
      rules: this.config.rules.length,
      notifiers: Object.keys(this.config.notifiers).filter(
        key => this.config.notifiers[key].enabled
      )
    });
  }
  
  /**
   * Inizializza i notificatori
   * @private
   */
  _initializeNotifiers() {
    this.notifiers = {};
    
    // Notificatore console
    if (this.config.notifiers.console.enabled) {
      this.notifiers.console = this._notifyConsole.bind(this);
    }
    
    // Notificatore email
    if (this.config.notifiers.email.enabled) {
      this._initializeEmailNotifier();
      this.notifiers.email = this._notifyEmail.bind(this);
    }
    
    // Notificatore Slack
    if (this.config.notifiers.slack.enabled) {
      this.notifiers.slack = this._notifySlack.bind(this);
    }
    
    // Notificatore webhook
    if (this.config.notifiers.webhook.enabled) {
      this.notifiers.webhook = this._notifyWebhook.bind(this);
    }
    
    // Notificatore SMS
    if (this.config.notifiers.sms.enabled) {
      this._initializeSmsNotifier();
      this.notifiers.sms = this._notifySms.bind(this);
    }
    
    // Notificatore push
    if (this.config.notifiers.pushNotification.enabled) {
      this._initializePushNotifier();
      this.notifiers.pushNotification = this._notifyPush.bind(this);
    }
  }
  
  /**
   * Inizializza il notificatore email
   * @private
   */
  _initializeEmailNotifier() {
    try {
      this.emailTransporter = nodemailer.createTransport(this.config.notifiers.email.smtpConfig);
      
      // Verifica la connessione
      this.emailTransporter.verify((error) => {
        if (error) {
          this.logger.error('Errore nella verifica del trasporto email', { error });
        } else {
          this.logger.info('Trasporto email verificato');
        }
      });
    } catch (error) {
      this.logger.error('Errore nell\'inizializzazione del notificatore email', { error });
    }
  }
  
  /**
   * Inizializza il notificatore SMS
   * @private
   */
  _initializeSmsNotifier() {
    try {
      const { provider, config } = this.config.notifiers.sms;
      
      if (provider === 'twilio') {
        // In un'implementazione reale, si inizializzerebbe il client Twilio
        this.logger.info('Notificatore SMS (Twilio) inizializzato');
      } else {
        this.logger.warn('Provider SMS non supportato', { provider });
      }
    } catch (error) {
      this.logger.error('Errore nell\'inizializzazione del notificatore SMS', { error });
    }
  }
  
  /**
   * Inizializza il notificatore push
   * @private
   */
  _initializePushNotifier() {
    try {
      const { provider, config } = this.config.notifiers.pushNotification;
      
      if (provider === 'firebase') {
        // In un'implementazione reale, si inizializzerebbe il client Firebase
        this.logger.info('Notificatore push (Firebase) inizializzato');
      } else {
        this.logger.warn('Provider push non supportato', { provider });
      }
    } catch (error) {
      this.logger.error('Errore nell\'inizializzazione del notificatore push', { error });
    }
  }
  
  /**
   * Registra gli handler per gli eventi del sistema di monitoraggio
   * @private
   */
  _registerEventHandlers() {
    if (this.monitoringSystem) {
      // Registra l'handler per gli eventi di alert
      this.monitoringSystem.on('alert', (alert) => {
        this._handleAlert(alert);
      });
      
      this.logger.info('Handler per gli eventi del sistema di monitoraggio registrati');
    } else {
      this.logger.warn('Sistema di monitoraggio non disponibile, gli handler non sono stati registrati');
    }
  }
  
  /**
   * Avvia il timer di valutazione delle regole
   * @private
   */
  _startEvaluationTimer() {
    this.evaluationTimer = setInterval(() => {
      this._evaluateRules();
    }, this.config.evaluationInterval * 1000);
    
    this.logger.info('Timer di valutazione delle regole avviato', {
      interval: this.config.evaluationInterval
    });
  }
  
  /**
   * Valuta le regole di alerting
   * @private
   */
  async _evaluateRules() {
    try {
      this.logger.debug('Valutazione delle regole di alerting');
      
      // Ottieni le metriche dal sistema di monitoraggio
      if (!this.monitoringSystem || !this.monitoringSystem.getMetrics) {
        this.logger.warn('Sistema di monitoraggio non disponibile o non supporta getMetrics');
        return;
      }
      
      const metrics = await this.monitoringSystem.getMetrics();
      
      // Valuta ogni regola
      for (const rule of this.config.rules) {
        this._evaluateRule(rule, metrics);
      }
      
      // Pulisci gli alert scaduti
      this._cleanupExpiredAlerts();
      
      this.logger.debug('Valutazione delle regole completata');
    } catch (error) {
      this.logger.error('Errore nella valutazione delle regole', { error });
    }
  }
  
  /**
   * Valuta una singola regola
   * @private
   * @param {Object} rule - Regola da valutare
   * @param {Array} metrics - Metriche correnti
   */
  _evaluateRule(rule, metrics) {
    try {
      // Verifica se la regola è abilitata
      if (rule.enabled === false) {
        return;
      }
      
      // Trova la metrica corrispondente
      const metric = metrics.find(m => m.name === rule.metric);
      
      if (!metric) {
        this.logger.debug('Metrica non trovata per la regola', { rule });
        return;
      }
      
      // Estrai i valori della metrica
      let values = [];
      
      if (metric.type === 'counter' || metric.type === 'gauge') {
        values = metric.values.map(v => v.value);
      } else if (metric.type === 'histogram') {
        values = metric.values.map(v => v.sum / v.count);
      } else if (metric.type === 'summary') {
        values = metric.values.map(v => v.sum / v.count);
      }
      
      // Applica il filtro delle etichette
      if (rule.labels) {
        values = values.filter(v => {
          for (const [key, value] of Object.entries(rule.labels)) {
            if (v.labels[key] !== value) {
              return false;
            }
          }
          return true;
        });
      }
      
      // Calcola il valore aggregato
      let aggregatedValue;
      
      switch (rule.aggregation) {
        case 'sum':
          aggregatedValue = values.reduce((sum, v) => sum + v, 0);
          break;
        case 'avg':
          aggregatedValue = values.reduce((sum, v) => sum + v, 0) / values.length;
          break;
        case 'min':
          aggregatedValue = Math.min(...values);
          break;
        case 'max':
          aggregatedValue = Math.max(...values);
          break;
        default:
          aggregatedValue = values.length > 0 ? values[0] : 0;
      }
      
      // Valuta la condizione
      let condition = false;
      
      switch (rule.operator) {
        case '>':
          condition = aggregatedValue > rule.threshold;
          break;
        case '>=':
          condition = aggregatedValue >= rule.threshold;
          break;
        case '<':
          condition = aggregatedValue < rule.threshold;
          break;
        case '<=':
          condition = aggregatedValue <= rule.threshold;
          break;
        case '==':
          condition = aggregatedValue === rule.threshold;
          break;
        case '!=':
          condition = aggregatedValue !== rule.threshold;
          break;
      }
      
      // Se la condizione è vera, genera un alert
      if (condition) {
        const alert = {
          id: `${rule.name}-${Date.now()}`,
          name: rule.name,
          metric: rule.metric,
          value: aggregatedValue,
          threshold: rule.threshold,
          operator: rule.operator,
          severity: rule.severity || 'warning',
          message: rule.message || `Alert: ${rule.name}`,
          timestamp: new Date(),
          labels: rule.labels || {},
          annotations: rule.annotations || {}
        };
        
        this._processAlert(alert);
      } else {
        // Se la condizione è falsa, risolvi eventuali alert attivi per questa regola
        this._resolveAlerts(rule.name);
      }
    } catch (error) {
      this.logger.error('Errore nella valutazione della regola', { rule, error });
    }
  }
  
  /**
   * Gestisce un alert generato dal sistema di monitoraggio
   * @private
   * @param {Object} alert - Alert da gestire
   */
  _handleAlert(alert) {
    try {
      // Aggiungi un ID se non presente
      if (!alert.id) {
        alert.id = `${alert.rule || 'unknown'}-${Date.now()}`;
      }
      
      // Aggiungi un timestamp se non presente
      if (!alert.timestamp) {
        alert.timestamp = new Date();
      }
      
      // Processa l'alert
      this._processAlert(alert);
    } catch (error) {
      this.logger.error('Errore nella gestione dell\'alert', { alert, error });
    }
  }
  
  /**
   * Processa un alert
   * @private
   * @param {Object} alert - Alert da processare
   */
  _processAlert(alert) {
    try {
      // Verifica se l'alert è già attivo
      const alertKey = alert.name;
      const existingAlert = this.activeAlerts.get(alertKey);
      
      if (existingAlert) {
        // Verifica se l'alert è ancora nel periodo di deduplicazione
        const now = Date.now();
        const lastNotification = existingAlert.lastNotification || 0;
        
        if (now - lastNotification < this.config.alertDeduplicationPeriod * 1000) {
          this.logger.debug('Alert deduplicato', { alert });
          return;
        }
        
        // Aggiorna l'alert esistente
        existingAlert.value = alert.value;
        existingAlert.count = (existingAlert.count || 1) + 1;
        existingAlert.lastUpdate = now;
        existingAlert.lastNotification = now;
        
        // Notifica l'aggiornamento dell'alert
        this._notifyAlert(existingAlert, 'update');
      } else {
        // Verifica se abbiamo raggiunto il limite di alert per questa regola
        const ruleCount = this.alertCounts.get(alert.name) || 0;
        
        if (ruleCount >= this.config.maxAlertsPerRule) {
          this.logger.warn('Limite di alert per regola raggiunto', { rule: alert.name });
          return;
        }
        
        // Verifica se abbiamo raggiunto il limite totale di alert
        if (this.activeAlerts.size >= this.config.maxTotalAlerts) {
          this.logger.warn('Limite totale di alert raggiunto');
          return;
        }
        
        // Aggiungi l'alert agli alert attivi
        alert.count = 1;
        alert.firstSeen = Date.now();
        alert.lastUpdate = Date.now();
        alert.lastNotification = Date.now();
        
        this.activeAlerts.set(alertKey, alert);
        this.alertCounts.set(alert.name, ruleCount + 1);
        
        // Aggiungi l'alert alla cronologia
        this.alertHistory.push({
          ...alert,
          status: 'active',
          activatedAt: new Date()
        });
        
        // Notifica il nuovo alert
        this._notifyAlert(alert, 'new');
      }
      
      // Emetti l'evento di alert
      this.emit('alert', alert);
    } catch (error) {
      this.logger.error('Errore nel processamento dell\'alert', { alert, error });
    }
  }
  
  /**
   * Risolve gli alert per una regola
   * @private
   * @param {string} ruleName - Nome della regola
   */
  _resolveAlerts(ruleName) {
    try {
      // Verifica se ci sono alert attivi per questa regola
      const alertKey = ruleName;
      const alert = this.activeAlerts.get(alertKey);
      
      if (alert) {
        // Rimuovi l'alert dagli alert attivi
        this.activeAlerts.delete(alertKey);
        
        // Aggiorna la cronologia
        const historyAlert = this.alertHistory.find(a => a.id === alert.id && a.status === 'active');
        
        if (historyAlert) {
          historyAlert.status = 'resolved';
          historyAlert.resolvedAt = new Date();
        }
        
        // Decrementa il contatore degli alert per questa regola
        const ruleCount = this.alertCounts.get(ruleName) || 0;
        this.alertCounts.set(ruleName, Math.max(0, ruleCount - 1));
        
        // Notifica la risoluzione dell'alert
        this._notifyAlert(alert, 'resolve');
        
        // Emetti l'evento di risoluzione
        this.emit('resolve', alert);
      }
    } catch (error) {
      this.logger.error('Errore nella risoluzione degli alert', { ruleName, error });
    }
  }
  
  /**
   * Pulisce gli alert scaduti
   * @private
   */
  _cleanupExpiredAlerts() {
    try {
      const now = Date.now();
      const expiredKeys = [];
      
      // Trova gli alert scaduti
      for (const [key, alert] of this.activeAlerts.entries()) {
        const lastUpdate = alert.lastUpdate || 0;
        
        if (now - lastUpdate > this.config.alertExpirationPeriod * 1000) {
          expiredKeys.push(key);
        }
      }
      
      // Rimuovi gli alert scaduti
      for (const key of expiredKeys) {
        const alert = this.activeAlerts.get(key);
        
        // Rimuovi l'alert dagli alert attivi
        this.activeAlerts.delete(key);
        
        // Aggiorna la cronologia
        const historyAlert = this.alertHistory.find(a => a.id === alert.id && a.status === 'active');
        
        if (historyAlert) {
          historyAlert.status = 'expired';
          historyAlert.expiredAt = new Date();
        }
        
        // Decrementa il contatore degli alert per questa regola
        const ruleCount = this.alertCounts.get(alert.name) || 0;
        this.alertCounts.set(alert.name, Math.max(0, ruleCount - 1));
        
        // Notifica la scadenza dell'alert
        this._notifyAlert(alert, 'expire');
        
        // Emetti l'evento di scadenza
        this.emit('expire', alert);
      }
      
      // Limita la dimensione della cronologia
      if (this.alertHistory.length > this.config.maxTotalAlerts * 10) {
        this.alertHistory = this.alertHistory.slice(-this.config.maxTotalAlerts * 10);
      }
    } catch (error) {
      this.logger.error('Errore nella pulizia degli alert scaduti', { error });
    }
  }
  
  /**
   * Notifica un alert attraverso tutti i canali abilitati
   * @private
   * @param {Object} alert - Alert da notificare
   * @param {string} action - Azione (new, update, resolve, expire)
   */
  _notifyAlert(alert, action) {
    try {
      // Notifica attraverso tutti i canali abilitati
      for (const [name, notifier] of Object.entries(this.notifiers)) {
        notifier(alert, action).catch(error => {
          this.logger.error(`Errore nella notifica dell'alert tramite ${name}`, { alert, action, error });
        });
      }
    } catch (error) {
      this.logger.error('Errore nella notifica dell\'alert', { alert, action, error });
    }
  }
  
  /**
   * Notifica un alert tramite console
   * @private
   * @param {Object} alert - Alert da notificare
   * @param {string} action - Azione (new, update, resolve, expire)
   * @returns {Promise<void>}
   */
  async _notifyConsole(alert, action) {
    try {
      // Formatta il messaggio
      let message = '';
      
      switch (action) {
        case 'new':
          message = `[NEW ALERT] ${alert.severity.toUpperCase()}: ${alert.message}`;
          break;
        case 'update':
          message = `[UPDATED ALERT] ${alert.severity.toUpperCase()}: ${alert.message} (count: ${alert.count})`;
          break;
        case 'resolve':
          message = `[RESOLVED ALERT] ${alert.severity.toUpperCase()}: ${alert.message}`;
          break;
        case 'expire':
          message = `[EXPIRED ALERT] ${alert.severity.toUpperCase()}: ${alert.message}`;
          break;
      }
      
      // Aggiungi dettagli
      message += `\nMetric: ${alert.metric}, Value: ${alert.value}, Threshold: ${alert.threshold}, Operator: ${alert.operator}`;
      
      // Aggiungi etichette
      if (Object.keys(alert.labels || {}).length > 0) {
        message += `\nLabels: ${JSON.stringify(alert.labels)}`;
      }
      
      // Aggiungi annotazioni
      if (Object.keys(alert.annotations || {}).length > 0) {
        message += `\nAnnotations: ${JSON.stringify(alert.annotations)}`;
      }
      
      // Stampa il messaggio
      switch (alert.severity) {
        case 'critical':
          console.error(message);
          break;
        case 'error':
          console.error(message);
          break;
        case 'warning':
          console.warn(message);
          break;
        case 'info':
          console.info(message);
          break;
        default:
          console.log(message);
      }
    } catch (error) {
      this.logger.error('Errore nella notifica console', { alert, action, error });
    }
  }
  
  /**
   * Notifica un alert tramite email
   * @private
   * @param {Object} alert - Alert da notificare
   * @param {string} action - Azione (new, update, resolve, expire)
   * @returns {Promise<void>}
   */
  async _notifyEmail(alert, action) {
    try {
      // Verifica se il trasporto email è disponibile
      if (!this.emailTransporter) {
        this.logger.warn('Trasporto email non disponibile');
        return;
      }
      
      // Verifica se ci sono destinatari
      if (!this.config.notifiers.email.to || this.config.notifiers.email.to.length === 0) {
        this.logger.warn('Nessun destinatario email configurato');
        return;
      }
      
      // Formatta l'oggetto
      const subject = this.config.notifiers.email.subject
        .replace('{severity}', alert.severity.toUpperCase())
        .replace('{name}', alert.name);
      
      // Formatta il corpo
      let html = `<h2>${action.toUpperCase()} ALERT: ${alert.message}</h2>`;
      html += `<p><strong>Severity:</strong> ${alert.severity.toUpperCase()}</p>`;
      html += `<p><strong>Metric:</strong> ${alert.metric}</p>`;
      html += `<p><strong>Value:</strong> ${alert.value}</p>`;
      html += `<p><strong>Threshold:</strong> ${alert.threshold}</p>`;
      html += `<p><strong>Operator:</strong> ${alert.operator}</p>`;
      
      if (alert.count > 1) {
        html += `<p><strong>Count:</strong> ${alert.count}</p>`;
      }
      
      // Aggiungi etichette
      if (Object.keys(alert.labels || {}).length > 0) {
        html += `<h3>Labels</h3><ul>`;
        for (const [key, value] of Object.entries(alert.labels)) {
          html += `<li><strong>${key}:</strong> ${value}</li>`;
        }
        html += `</ul>`;
      }
      
      // Aggiungi annotazioni
      if (Object.keys(alert.annotations || {}).length > 0) {
        html += `<h3>Annotations</h3><ul>`;
        for (const [key, value] of Object.entries(alert.annotations)) {
          html += `<li><strong>${key}:</strong> ${value}</li>`;
        }
        html += `</ul>`;
      }
      
      // Aggiungi timestamp
      html += `<p><strong>Timestamp:</strong> ${alert.timestamp}</p>`;
      
      // Invia l'email
      const mailOptions = {
        from: this.config.notifiers.email.from,
        to: this.config.notifiers.email.to.join(', '),
        subject,
        html
      };
      
      await this.emailTransporter.sendMail(mailOptions);
      
      this.logger.debug('Email inviata', { alert, action });
    } catch (error) {
      this.logger.error('Errore nella notifica email', { alert, action, error });
    }
  }
  
  /**
   * Notifica un alert tramite Slack
   * @private
   * @param {Object} alert - Alert da notificare
   * @param {string} action - Azione (new, update, resolve, expire)
   * @returns {Promise<void>}
   */
  async _notifySlack(alert, action) {
    try {
      // Verifica se l'URL del webhook è configurato
      if (!this.config.notifiers.slack.webhookUrl) {
        this.logger.warn('URL del webhook Slack non configurato');
        return;
      }
      
      // Determina il colore in base alla severità
      let color;
      switch (alert.severity) {
        case 'critical':
          color = '#FF0000'; // Rosso
          break;
        case 'error':
          color = '#FF9900'; // Arancione
          break;
        case 'warning':
          color = '#FFCC00'; // Giallo
          break;
        case 'info':
          color = '#36A64F'; // Verde
          break;
        default:
          color = '#CCCCCC'; // Grigio
      }
      
      // Formatta il titolo
      let title;
      switch (action) {
        case 'new':
          title = `[NEW ALERT] ${alert.message}`;
          break;
        case 'update':
          title = `[UPDATED ALERT] ${alert.message}`;
          break;
        case 'resolve':
          title = `[RESOLVED ALERT] ${alert.message}`;
          break;
        case 'expire':
          title = `[EXPIRED ALERT] ${alert.message}`;
          break;
      }
      
      // Formatta i campi
      const fields = [
        {
          title: 'Severity',
          value: alert.severity.toUpperCase(),
          short: true
        },
        {
          title: 'Metric',
          value: alert.metric,
          short: true
        },
        {
          title: 'Value',
          value: alert.value.toString(),
          short: true
        },
        {
          title: 'Threshold',
          value: alert.threshold.toString(),
          short: true
        },
        {
          title: 'Operator',
          value: alert.operator,
          short: true
        }
      ];
      
      if (alert.count > 1) {
        fields.push({
          title: 'Count',
          value: alert.count.toString(),
          short: true
        });
      }
      
      // Aggiungi etichette
      if (Object.keys(alert.labels || {}).length > 0) {
        fields.push({
          title: 'Labels',
          value: Object.entries(alert.labels)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', '),
          short: false
        });
      }
      
      // Aggiungi annotazioni
      if (Object.keys(alert.annotations || {}).length > 0) {
        fields.push({
          title: 'Annotations',
          value: Object.entries(alert.annotations)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', '),
          short: false
        });
      }
      
      // Crea il payload
      const payload = {
        channel: this.config.notifiers.slack.channel,
        username: this.config.notifiers.slack.username,
        icon_emoji: this.config.notifiers.slack.iconEmoji,
        attachments: [
          {
            fallback: title,
            color,
            title,
            fields,
            footer: `Alert ID: ${alert.id}`,
            ts: Math.floor(new Date(alert.timestamp).getTime() / 1000)
          }
        ]
      };
      
      // Invia il messaggio
      await axios.post(this.config.notifiers.slack.webhookUrl, payload);
      
      this.logger.debug('Messaggio Slack inviato', { alert, action });
    } catch (error) {
      this.logger.error('Errore nella notifica Slack', { alert, action, error });
    }
  }
  
  /**
   * Notifica un alert tramite webhook
   * @private
   * @param {Object} alert - Alert da notificare
   * @param {string} action - Azione (new, update, resolve, expire)
   * @returns {Promise<void>}
   */
  async _notifyWebhook(alert, action) {
    try {
      // Verifica se l'URL del webhook è configurato
      if (!this.config.notifiers.webhook.url) {
        this.logger.warn('URL del webhook non configurato');
        return;
      }
      
      // Crea il payload
      const payload = {
        alert: {
          ...alert,
          action
        }
      };
      
      // Invia la richiesta
      const response = await axios({
        method: this.config.notifiers.webhook.method || 'POST',
        url: this.config.notifiers.webhook.url,
        headers: this.config.notifiers.webhook.headers || {},
        data: payload
      });
      
      this.logger.debug('Webhook inviato', { alert, action, status: response.status });
    } catch (error) {
      this.logger.error('Errore nella notifica webhook', { alert, action, error });
    }
  }
  
  /**
   * Notifica un alert tramite SMS
   * @private
   * @param {Object} alert - Alert da notificare
   * @param {string} action - Azione (new, update, resolve, expire)
   * @returns {Promise<void>}
   */
  async _notifySms(alert, action) {
    try {
      // Verifica se il provider SMS è configurato
      if (!this.config.notifiers.sms.provider || !this.config.notifiers.sms.config) {
        this.logger.warn('Provider SMS non configurato');
        return;
      }
      
      // Verifica se ci sono destinatari
      if (!this.config.notifiers.sms.config.to || this.config.notifiers.sms.config.to.length === 0) {
        this.logger.warn('Nessun destinatario SMS configurato');
        return;
      }
      
      // Formatta il messaggio
      let message = '';
      
      switch (action) {
        case 'new':
          message = `[NEW] ${alert.severity.toUpperCase()}: ${alert.message}`;
          break;
        case 'update':
          message = `[UPDATED] ${alert.severity.toUpperCase()}: ${alert.message}`;
          break;
        case 'resolve':
          message = `[RESOLVED] ${alert.severity.toUpperCase()}: ${alert.message}`;
          break;
        case 'expire':
          message = `[EXPIRED] ${alert.severity.toUpperCase()}: ${alert.message}`;
          break;
      }
      
      message += ` | ${alert.metric}: ${alert.value} ${alert.operator} ${alert.threshold}`;
      
      // In un'implementazione reale, si invierebbe l'SMS tramite il provider configurato
      // Ad esempio, per Twilio:
      /*
      const client = require('twilio')(
        this.config.notifiers.sms.config.accountSid,
        this.config.notifiers.sms.config.authToken
      );
      
      for (const to of this.config.notifiers.sms.config.to) {
        await client.messages.create({
          body: message,
          from: this.config.notifiers.sms.config.from,
          to
        });
      }
      */
      
      this.logger.debug('SMS inviato', { alert, action });
    } catch (error) {
      this.logger.error('Errore nella notifica SMS', { alert, action, error });
    }
  }
  
  /**
   * Notifica un alert tramite notifica push
   * @private
   * @param {Object} alert - Alert da notificare
   * @param {string} action - Azione (new, update, resolve, expire)
   * @returns {Promise<void>}
   */
  async _notifyPush(alert, action) {
    try {
      // Verifica se il provider push è configurato
      if (!this.config.notifiers.pushNotification.provider || !this.config.notifiers.pushNotification.config) {
        this.logger.warn('Provider push non configurato');
        return;
      }
      
      // Formatta il titolo
      let title = '';
      
      switch (action) {
        case 'new':
          title = `New Alert: ${alert.severity.toUpperCase()}`;
          break;
        case 'update':
          title = `Updated Alert: ${alert.severity.toUpperCase()}`;
          break;
        case 'resolve':
          title = `Resolved Alert: ${alert.severity.toUpperCase()}`;
          break;
        case 'expire':
          title = `Expired Alert: ${alert.severity.toUpperCase()}`;
          break;
      }
      
      // Formatta il corpo
      const body = `${alert.message} | ${alert.metric}: ${alert.value} ${alert.operator} ${alert.threshold}`;
      
      // In un'implementazione reale, si invierebbe la notifica push tramite il provider configurato
      // Ad esempio, per Firebase:
      /*
      const admin = require('firebase-admin');
      
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(this.config.notifiers.pushNotification.config.serviceAccountKey)
        });
      }
      
      await admin.messaging().send({
        notification: {
          title,
          body
        },
        topic: this.config.notifiers.pushNotification.config.topic
      });
      */
      
      this.logger.debug('Notifica push inviata', { alert, action });
    } catch (error) {
      this.logger.error('Errore nella notifica push', { alert, action, error });
    }
  }
  
  /**
   * Aggiunge una regola di alerting
   * @param {Object} rule - Regola da aggiungere
   * @returns {boolean} True se la regola è stata aggiunta
   */
  addRule(rule) {
    try {
      // Verifica se la regola è valida
      if (!rule.name || !rule.metric || !rule.operator || rule.threshold === undefined) {
        this.logger.warn('Regola non valida', { rule });
        return false;
      }
      
      // Verifica se la regola esiste già
      const existingRule = this.config.rules.find(r => r.name === rule.name);
      
      if (existingRule) {
        this.logger.warn('Regola già esistente', { rule });
        return false;
      }
      
      // Aggiungi la regola
      this.config.rules.push(rule);
      
      this.logger.info('Regola aggiunta', { rule });
      return true;
    } catch (error) {
      this.logger.error('Errore nell\'aggiunta della regola', { rule, error });
      return false;
    }
  }
  
  /**
   * Aggiorna una regola di alerting
   * @param {string} name - Nome della regola da aggiornare
   * @param {Object} updates - Aggiornamenti da applicare
   * @returns {boolean} True se la regola è stata aggiornata
   */
  updateRule(name, updates) {
    try {
      // Trova la regola
      const index = this.config.rules.findIndex(r => r.name === name);
      
      if (index === -1) {
        this.logger.warn('Regola non trovata', { name });
        return false;
      }
      
      // Aggiorna la regola
      this.config.rules[index] = {
        ...this.config.rules[index],
        ...updates
      };
      
      this.logger.info('Regola aggiornata', { name, updates });
      return true;
    } catch (error) {
      this.logger.error('Errore nell\'aggiornamento della regola', { name, updates, error });
      return false;
    }
  }
  
  /**
   * Rimuove una regola di alerting
   * @param {string} name - Nome della regola da rimuovere
   * @returns {boolean} True se la regola è stata rimossa
   */
  removeRule(name) {
    try {
      // Trova la regola
      const index = this.config.rules.findIndex(r => r.name === name);
      
      if (index === -1) {
        this.logger.warn('Regola non trovata', { name });
        return false;
      }
      
      // Rimuovi la regola
      this.config.rules.splice(index, 1);
      
      // Risolvi eventuali alert attivi per questa regola
      this._resolveAlerts(name);
      
      this.logger.info('Regola rimossa', { name });
      return true;
    } catch (error) {
      this.logger.error('Errore nella rimozione della regola', { name, error });
      return false;
    }
  }
  
  /**
   * Abilita una regola di alerting
   * @param {string} name - Nome della regola da abilitare
   * @returns {boolean} True se la regola è stata abilitata
   */
  enableRule(name) {
    return this.updateRule(name, { enabled: true });
  }
  
  /**
   * Disabilita una regola di alerting
   * @param {string} name - Nome della regola da disabilitare
   * @returns {boolean} True se la regola è stata disabilitata
   */
  disableRule(name) {
    return this.updateRule(name, { enabled: false });
  }
  
  /**
   * Ottiene tutte le regole di alerting
   * @returns {Array} Regole di alerting
   */
  getRules() {
    return this.config.rules;
  }
  
  /**
   * Ottiene una regola di alerting
   * @param {string} name - Nome della regola
   * @returns {Object|null} Regola di alerting o null se non trovata
   */
  getRule(name) {
    return this.config.rules.find(r => r.name === name) || null;
  }
  
  /**
   * Ottiene tutti gli alert attivi
   * @returns {Array} Alert attivi
   */
  getActiveAlerts() {
    return Array.from(this.activeAlerts.values());
  }
  
  /**
   * Ottiene la cronologia degli alert
   * @param {Object} options - Opzioni di filtro
   * @param {string} options.status - Stato degli alert (active, resolved, expired)
   * @param {string} options.severity - Severità degli alert
   * @param {string} options.ruleName - Nome della regola
   * @param {number} options.limit - Limite di alert da restituire
   * @returns {Array} Cronologia degli alert
   */
  getAlertHistory(options = {}) {
    let history = [...this.alertHistory];
    
    // Filtra per stato
    if (options.status) {
      history = history.filter(a => a.status === options.status);
    }
    
    // Filtra per severità
    if (options.severity) {
      history = history.filter(a => a.severity === options.severity);
    }
    
    // Filtra per nome della regola
    if (options.ruleName) {
      history = history.filter(a => a.name === options.ruleName);
    }
    
    // Ordina per timestamp (più recenti prima)
    history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Limita il numero di risultati
    if (options.limit) {
      history = history.slice(0, options.limit);
    }
    
    return history;
  }
  
  /**
   * Abilita un notificatore
   * @param {string} name - Nome del notificatore
   * @returns {boolean} True se il notificatore è stato abilitato
   */
  enableNotifier(name) {
    try {
      // Verifica se il notificatore esiste
      if (!this.config.notifiers[name]) {
        this.logger.warn('Notificatore non trovato', { name });
        return false;
      }
      
      // Abilita il notificatore
      this.config.notifiers[name].enabled = true;
      
      // Reinizializza i notificatori
      this._initializeNotifiers();
      
      this.logger.info('Notificatore abilitato', { name });
      return true;
    } catch (error) {
      this.logger.error('Errore nell\'abilitazione del notificatore', { name, error });
      return false;
    }
  }
  
  /**
   * Disabilita un notificatore
   * @param {string} name - Nome del notificatore
   * @returns {boolean} True se il notificatore è stato disabilitato
   */
  disableNotifier(name) {
    try {
      // Verifica se il notificatore esiste
      if (!this.config.notifiers[name]) {
        this.logger.warn('Notificatore non trovato', { name });
        return false;
      }
      
      // Disabilita il notificatore
      this.config.notifiers[name].enabled = false;
      
      // Reinizializza i notificatori
      this._initializeNotifiers();
      
      this.logger.info('Notificatore disabilitato', { name });
      return true;
    } catch (error) {
      this.logger.error('Errore nella disabilitazione del notificatore', { name, error });
      return false;
    }
  }
  
  /**
   * Configura un notificatore
   * @param {string} name - Nome del notificatore
   * @param {Object} config - Configurazione del notificatore
   * @returns {boolean} True se il notificatore è stato configurato
   */
  configureNotifier(name, config) {
    try {
      // Verifica se il notificatore esiste
      if (!this.config.notifiers[name]) {
        this.logger.warn('Notificatore non trovato', { name });
        return false;
      }
      
      // Aggiorna la configurazione
      this.config.notifiers[name] = {
        ...this.config.notifiers[name],
        ...config
      };
      
      // Reinizializza i notificatori
      this._initializeNotifiers();
      
      this.logger.info('Notificatore configurato', { name, config });
      return true;
    } catch (error) {
      this.logger.error('Errore nella configurazione del notificatore', { name, config, error });
      return false;
    }
  }
  
  /**
   * Ottiene la configurazione di un notificatore
   * @param {string} name - Nome del notificatore
   * @returns {Object|null} Configurazione del notificatore o null se non trovato
   */
  getNotifierConfig(name) {
    return this.config.notifiers[name] || null;
  }
  
  /**
   * Ottiene lo stato di tutti i notificatori
   * @returns {Object} Stato di tutti i notificatori
   */
  getNotifiersStatus() {
    const status = {};
    
    for (const [name, config] of Object.entries(this.config.notifiers)) {
      status[name] = {
        enabled: config.enabled,
        active: !!this.notifiers[name]
      };
    }
    
    return status;
  }
  
  /**
   * Chiude l'alert manager
   */
  close() {
    this.logger.info('Chiusura alert manager');
    
    // Ferma il timer di valutazione
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
    }
    
    // Chiudi il logger
    if (this.logger && typeof this.logger.close === 'function') {
      this.logger.close();
    }
  }
}

module.exports = AlertManager;
