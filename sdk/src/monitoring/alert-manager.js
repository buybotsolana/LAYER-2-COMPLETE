const { defaultLogger } = require('../logging/logger');
const { PerformanceMonitor } = require('./performance-monitor');
const nodemailer = require('nodemailer');
const axios = require('axios');
const { EventEmitter } = require('events');

/**
 * Classe per la gestione degli alert e delle notifiche
 * 
 * Questa classe fornisce metodi per:
 * - Configurare diversi canali di notifica (email, Slack, webhook)
 * - Definire regole di alerting basate su soglie e condizioni
 * - Gestire la frequenza e l'aggregazione degli alert
 * - Tracciare lo stato degli alert e gestire la risoluzione
 */
class AlertManager extends EventEmitter {
  /**
   * Crea una nuova istanza del gestore di alert
   * @param {Object} options - Opzioni di configurazione
   * @param {Object} options.logger - Istanza del logger (opzionale)
   * @param {PerformanceMonitor} options.monitor - Istanza del monitor di prestazioni
   */
  constructor(options = {}) {
    super();
    
    this.logger = options.logger || defaultLogger.child('alert-manager');
    this.monitor = options.monitor || new PerformanceMonitor({ logger: this.logger });
    
    // Configurazione dei canali di notifica
    this.channels = {
      email: null,
      slack: null,
      webhook: null,
      console: true // Sempre abilitato di default
    };
    
    // Configurazione delle regole di alerting
    this.rules = [];
    
    // Stato corrente degli alert
    this.activeAlerts = new Map();
    
    // Configurazione della frequenza degli alert
    this.alertFrequency = {
      critical: options.criticalAlertFrequency || 5 * 60 * 1000, // 5 minuti
      warning: options.warningAlertFrequency || 30 * 60 * 1000, // 30 minuti
      info: options.infoAlertFrequency || 60 * 60 * 1000 // 1 ora
    };
    
    // Registro degli alert inviati
    this.alertHistory = [];
    
    // Limite della dimensione della storia degli alert
    this.historyLimit = options.historyLimit || 1000;
    
    // Flag per indicare se il gestore è attivo
    this.isActive = false;
    
    // Inizializza i listener di eventi
    this._setupEventListeners();
  }

  /**
   * Configura i listener di eventi dal monitor di prestazioni
   * @private
   */
  _setupEventListeners() {
    // Ascolta eventi di degradazione della salute del sistema
    this.monitor.on('health:degraded', (status) => {
      this.logger.warn('System health degraded', { issues: status.issues });
      this._processSystemIssues(status.issues);
    });
    
    // Ascolta eventi di problemi critici
    this.monitor.on('issue:critical', (issue) => {
      this.logger.error(`Critical issue detected: ${issue.message}`, issue);
      this._processIssue(issue);
    });
    
    // Ascolta eventi di problemi di warning
    this.monitor.on('issue:warning', (issue) => {
      this.logger.warn(`Warning issue detected: ${issue.message}`, issue);
      this._processIssue(issue);
    });
    
    // Ascolta eventi di recupero della salute del sistema
    this.monitor.on('health:recovered', (status) => {
      this.logger.info('System health recovered');
      this._resolveAllAlerts('System health recovered');
    });
  }

  /**
   * Processa i problemi del sistema e genera alert se necessario
   * @param {Array<Object>} issues - Lista dei problemi rilevati
   * @private
   */
  _processSystemIssues(issues) {
    issues.forEach(issue => {
      this._processIssue(issue);
    });
  }

  /**
   * Processa un singolo problema e genera un alert se necessario
   * @param {Object} issue - Problema rilevato
   * @private
   */
  _processIssue(issue) {
    // Genera un ID univoco per il problema
    const issueId = `${issue.type}:${issue.level}:${issue.operation || ''}`;
    
    // Verifica se esiste già un alert attivo per questo problema
    if (this.activeAlerts.has(issueId)) {
      const existingAlert = this.activeAlerts.get(issueId);
      
      // Aggiorna l'alert esistente
      existingAlert.count++;
      existingAlert.lastOccurrence = Date.now();
      existingAlert.value = issue.value;
      
      // Verifica se è necessario inviare nuovamente l'alert
      const timeSinceLastSent = Date.now() - existingAlert.lastSent;
      if (timeSinceLastSent >= this.alertFrequency[issue.level]) {
        this._sendAlert(existingAlert);
      }
    } else {
      // Crea un nuovo alert
      const alert = {
        id: issueId,
        type: issue.type,
        level: issue.level,
        message: issue.message,
        operation: issue.operation,
        value: issue.value,
        threshold: issue.threshold,
        firstOccurrence: Date.now(),
        lastOccurrence: Date.now(),
        lastSent: 0, // Non ancora inviato
        count: 1,
        status: 'active'
      };
      
      // Aggiungi l'alert alla mappa degli alert attivi
      this.activeAlerts.set(issueId, alert);
      
      // Invia l'alert
      this._sendAlert(alert);
    }
  }

  /**
   * Invia un alert attraverso i canali configurati
   * @param {Object} alert - Alert da inviare
   * @private
   */
  _sendAlert(alert) {
    if (!this.isActive) {
      this.logger.debug('Alert manager is not active, skipping alert', { alert });
      return;
    }
    
    this.logger.info(`Sending alert: ${alert.message}`, { alert });
    
    // Aggiorna il timestamp dell'ultimo invio
    alert.lastSent = Date.now();
    
    // Prepara il contenuto dell'alert
    const alertContent = this._formatAlertContent(alert);
    
    // Invia l'alert attraverso i canali configurati
    if (this.channels.console) {
      this._sendConsoleAlert(alert, alertContent);
    }
    
    if (this.channels.email) {
      this._sendEmailAlert(alert, alertContent);
    }
    
    if (this.channels.slack) {
      this._sendSlackAlert(alert, alertContent);
    }
    
    if (this.channels.webhook) {
      this._sendWebhookAlert(alert, alertContent);
    }
    
    // Aggiungi l'alert alla storia
    this.alertHistory.push({
      ...alert,
      sentAt: Date.now()
    });
    
    // Limita la dimensione della storia
    if (this.alertHistory.length > this.historyLimit) {
      this.alertHistory.shift();
    }
    
    // Emetti un evento per l'alert inviato
    this.emit('alert:sent', alert);
  }

  /**
   * Formatta il contenuto dell'alert
   * @param {Object} alert - Alert da formattare
   * @returns {Object} Contenuto formattato dell'alert
   * @private
   */
  _formatAlertContent(alert) {
    const levelEmoji = {
      critical: '🔴',
      warning: '🟠',
      info: '🔵'
    };
    
    const emoji = levelEmoji[alert.level] || '⚪';
    
    return {
      title: `${emoji} ${alert.level.toUpperCase()}: ${alert.type}`,
      message: alert.message,
      details: {
        type: alert.type,
        level: alert.level,
        operation: alert.operation,
        value: alert.value,
        threshold: alert.threshold,
        occurrences: alert.count,
        firstOccurrence: new Date(alert.firstOccurrence).toISOString(),
        lastOccurrence: new Date(alert.lastOccurrence).toISOString()
      }
    };
  }

  /**
   * Invia un alert alla console
   * @param {Object} alert - Alert da inviare
   * @param {Object} content - Contenuto formattato dell'alert
   * @private
   */
  _sendConsoleAlert(alert, content) {
    const logMethod = alert.level === 'critical' ? 'error' : (alert.level === 'warning' ? 'warn' : 'info');
    
    this.logger[logMethod](content.title, {
      message: content.message,
      ...content.details
    });
  }

  /**
   * Invia un alert via email
   * @param {Object} alert - Alert da inviare
   * @param {Object} content - Contenuto formattato dell'alert
   * @private
   */
  _sendEmailAlert(alert, content) {
    if (!this.channels.email || !this.channels.email.transport) {
      this.logger.warn('Email channel not configured, skipping email alert');
      return;
    }
    
    const { transport, from, to, subject } = this.channels.email;
    
    const emailSubject = subject
      ? subject.replace('{level}', alert.level.toUpperCase()).replace('{type}', alert.type)
      : `[${alert.level.toUpperCase()}] Layer-2 Solana Alert: ${alert.type}`;
    
    const emailHtml = `
      <h2>${content.title}</h2>
      <p><strong>${content.message}</strong></p>
      <h3>Details:</h3>
      <ul>
        <li><strong>Type:</strong> ${content.details.type}</li>
        <li><strong>Level:</strong> ${content.details.level}</li>
        ${content.details.operation ? `<li><strong>Operation:</strong> ${content.details.operation}</li>` : ''}
        <li><strong>Value:</strong> ${content.details.value}</li>
        <li><strong>Threshold:</strong> ${content.details.threshold}</li>
        <li><strong>Occurrences:</strong> ${content.details.occurrences}</li>
        <li><strong>First Occurrence:</strong> ${content.details.firstOccurrence}</li>
        <li><strong>Last Occurrence:</strong> ${content.details.lastOccurrence}</li>
      </ul>
    `;
    
    const mailOptions = {
      from,
      to,
      subject: emailSubject,
      html: emailHtml,
      text: `${content.title}\n\n${content.message}\n\nDetails:\n` +
        `Type: ${content.details.type}\n` +
        `Level: ${content.details.level}\n` +
        (content.details.operation ? `Operation: ${content.details.operation}\n` : '') +
        `Value: ${content.details.value}\n` +
        `Threshold: ${content.details.threshold}\n` +
        `Occurrences: ${content.details.occurrences}\n` +
        `First Occurrence: ${content.details.firstOccurrence}\n` +
        `Last Occurrence: ${content.details.lastOccurrence}`
    };
    
    transport.sendMail(mailOptions, (error, info) => {
      if (error) {
        this.logger.error('Error sending email alert', { error: error.message, alert });
      } else {
        this.logger.debug('Email alert sent', { messageId: info.messageId, alert });
      }
    });
  }

  /**
   * Invia un alert via Slack
   * @param {Object} alert - Alert da inviare
   * @param {Object} content - Contenuto formattato dell'alert
   * @private
   */
  _sendSlackAlert(alert, content) {
    if (!this.channels.slack || !this.channels.slack.webhookUrl) {
      this.logger.warn('Slack channel not configured, skipping Slack alert');
      return;
    }
    
    const { webhookUrl, channel, username } = this.channels.slack;
    
    const color = alert.level === 'critical' ? '#FF0000' : (alert.level === 'warning' ? '#FFA500' : '#0000FF');
    
    const slackMessage = {
      channel,
      username: username || 'Layer-2 Solana Alert',
      attachments: [
        {
          color,
          title: content.title,
          text: content.message,
          fields: [
            {
              title: 'Type',
              value: content.details.type,
              short: true
            },
            {
              title: 'Level',
              value: content.details.level,
              short: true
            }
          ],
          footer: `Occurrences: ${content.details.occurrences} | Last: ${content.details.lastOccurrence}`
        }
      ]
    };
    
    // Aggiungi campo operation se presente
    if (content.details.operation) {
      slackMessage.attachments[0].fields.push({
        title: 'Operation',
        value: content.details.operation,
        short: true
      });
    }
    
    // Aggiungi campi value e threshold
    slackMessage.attachments[0].fields.push({
      title: 'Value',
      value: content.details.value.toString(),
      short: true
    });
    
    slackMessage.attachments[0].fields.push({
      title: 'Threshold',
      value: content.details.threshold.toString(),
      short: true
    });
    
    axios.post(webhookUrl, slackMessage)
      .then(response => {
        this.logger.debug('Slack alert sent', { statusCode: response.status, alert });
      })
      .catch(error => {
        this.logger.error('Error sending Slack alert', { error: error.message, alert });
      });
  }

  /**
   * Invia un alert via webhook
   * @param {Object} alert - Alert da inviare
   * @param {Object} content - Contenuto formattato dell'alert
   * @private
   */
  _sendWebhookAlert(alert, content) {
    if (!this.channels.webhook || !this.channels.webhook.url) {
      this.logger.warn('Webhook channel not configured, skipping webhook alert');
      return;
    }
    
    const { url, headers } = this.channels.webhook;
    
    const webhookPayload = {
      id: alert.id,
      title: content.title,
      message: content.message,
      level: alert.level,
      type: alert.type,
      operation: alert.operation,
      value: alert.value,
      threshold: alert.threshold,
      occurrences: alert.count,
      firstOccurrence: alert.firstOccurrence,
      lastOccurrence: alert.lastOccurrence,
      timestamp: Date.now()
    };
    
    axios.post(url, webhookPayload, { headers })
      .then(response => {
        this.logger.debug('Webhook alert sent', { statusCode: response.status, alert });
      })
      .catch(error => {
        this.logger.error('Error sending webhook alert', { error: error.message, alert });
      });
  }

  /**
   * Risolve tutti gli alert attivi
   * @param {string} reason - Motivo della risoluzione
   * @private
   */
  _resolveAllAlerts(reason) {
    if (this.activeAlerts.size === 0) {
      return;
    }
    
    this.logger.info(`Resolving all active alerts: ${reason}`);
    
    for (const [id, alert] of this.activeAlerts.entries()) {
      this._resolveAlert(id, reason);
    }
  }

  /**
   * Risolve un alert specifico
   * @param {string} alertId - ID dell'alert da risolvere
   * @param {string} reason - Motivo della risoluzione
   * @private
   */
  _resolveAlert(alertId, reason) {
    if (!this.activeAlerts.has(alertId)) {
      return;
    }
    
    const alert = this.activeAlerts.get(alertId);
    
    this.logger.info(`Resolving alert ${alertId}: ${reason}`);
    
    // Aggiorna lo stato dell'alert
    alert.status = 'resolved';
    alert.resolvedAt = Date.now();
    alert.resolveReason = reason;
    
    // Rimuovi l'alert dalla mappa degli alert attivi
    this.activeAlerts.delete(alertId);
    
    // Emetti un evento per l'alert risolto
    this.emit('alert:resolved', alert);
    
    // Invia una notifica di risoluzione se necessario
    if (this.isActive) {
      this._sendResolutionNotification(alert);
    }
  }

  /**
   * Invia una notifica di risoluzione di un alert
   * @param {Object} alert - Alert risolto
   * @private
   */
  _sendResolutionNotification(alert) {
    const content = {
      title: `✅ RESOLVED: ${alert.type}`,
      message: `The issue "${alert.message}" has been resolved.`,
      details: {
        type: alert.type,
        level: alert.level,
        operation: alert.operation,
        occurrences: alert.count,
        firstOccurrence: new Date(alert.firstOccurrence).toISOString(),
        lastOccurrence: new Date(alert.lastOccurrence).toISOString(),
        resolvedAt: new Date(alert.resolvedAt).toISOString(),
        reason: alert.resolveReason
      }
    };
    
    // Invia la notifica attraverso i canali configurati
    if (this.channels.console) {
      this.logger.info(content.title, {
        message: content.message,
        ...content.details
      });
    }
    
    // Altre notifiche di risoluzione potrebbero essere implementate qui
    // (email, Slack, webhook)
  }

  /**
   * Avvia il gestore di alert
   * @returns {boolean} true se il gestore è stato avviato, false altrimenti
   */
  start() {
    if (this.isActive) {
      this.logger.warn('Alert manager is already active');
      return false;
    }
    
    this.isActive = true;
    this.logger.info('Started alert manager');
    
    // Avvia il monitor di prestazioni se non è già attivo
    if (!this.monitor.isMonitoring) {
      this.monitor.start();
    }
    
    return true;
  }

  /**
   * Ferma il gestore di alert
   * @returns {boolean} true se il gestore è stato fermato, false altrimenti
   */
  stop() {
    if (!this.isActive) {
      this.logger.warn('Alert manager is not active');
      return false;
    }
    
    this.isActive = false;
    this.logger.info('Stopped alert manager');
    
    return true;
  }

  /**
   * Configura il canale di notifica email
   * @param {Object} config - Configurazione del canale email
   * @param {string} config.host - Host del server SMTP
   * @param {number} config.port - Porta del server SMTP
   * @param {boolean} config.secure - Se utilizzare una connessione sicura
   * @param {Object} config.auth - Credenziali di autenticazione
   * @param {string} config.from - Indirizzo email del mittente
   * @param {string|Array<string>} config.to - Indirizzo/i email del/i destinatario/i
   * @param {string} config.subject - Oggetto dell'email (opzionale)
   * @returns {Object} Configurazione del canale email
   */
  configureEmailChannel(config) {
    if (!config.host || !config.port || !config.from || !config.to) {
      throw new Error('Invalid email configuration: host, port, from, and to are required');
    }
    
    // Crea il trasporto SMTP
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure || false,
      auth: config.auth
    });
    
    this.channels.email = {
      transport,
      from: config.from,
      to: Array.isArray(config.to) ? config.to.join(',') : config.to,
      subject: config.subject
    };
    
    this.logger.info('Configured email alert channel', {
      host: config.host,
      port: config.port,
      from: config.from,
      to: this.channels.email.to
    });
    
    return this.channels.email;
  }

  /**
   * Configura il canale di notifica Slack
   * @param {Object} config - Configurazione del canale Slack
   * @param {string} config.webhookUrl - URL del webhook Slack
   * @param {string} config.channel - Canale Slack (opzionale)
   * @param {string} config.username - Nome utente del bot (opzionale)
   * @returns {Object} Configurazione del canale Slack
   */
  configureSlackChannel(config) {
    if (!config.webhookUrl) {
      throw new Error('Invalid Slack configuration: webhookUrl is required');
    }
    
    this.channels.slack = {
      webhookUrl: config.webhookUrl,
      channel: config.channel,
      username: config.username
    };
    
    this.logger.info('Configured Slack alert channel', {
      webhookUrl: config.webhookUrl,
      channel: config.channel,
      username: config.username
    });
    
    return this.channels.slack;
  }

  /**
   * Configura il canale di notifica webhook
   * @param {Object} config - Configurazione del canale webhook
   * @param {string} config.url - URL del webhook
   * @param {Object} config.headers - Header HTTP (opzionale)
   * @returns {Object} Configurazione del canale webhook
   */
  configureWebhookChannel(config) {
    if (!config.url) {
      throw new Error('Invalid webhook configuration: url is required');
    }
    
    this.channels.webhook = {
      url: config.url,
      headers: config.headers || {}
    };
    
    this.logger.info('Configured webhook alert channel', {
      url: config.url
    });
    
    return this.channels.webhook;
  }

  /**
   * Aggiunge una regola di alerting personalizzata
   * @param {Object} rule - Regola di alerting
   * @param {string} rule.name - Nome della regola
   * @param {Function} rule.condition - Funzione che valuta la condizione
   * @param {string} rule.level - Livello dell'alert (critical, warning, info)
   * @param {string} rule.message - Messaggio dell'alert
   * @param {Object} rule.metadata - Metadati aggiuntivi
   * @returns {Array<Object>} Lista delle regole configurate
   */
  addRule(rule) {
    if (!rule.name || !rule.condition || typeof rule.condition !== 'function' || !rule.level || !rule.message) {
      throw new Error('Invalid rule configuration: name, condition, level, and message are required');
    }
    
    this.rules.push({
      id: `rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: rule.name,
      condition: rule.condition,
      level: rule.level,
      message: rule.message,
      metadata: rule.metadata || {},
      createdAt: Date.now(),
      enabled: true
    });
    
    this.logger.info(`Added alert rule: ${rule.name}`, {
      level: rule.level,
      message: rule.message
    });
    
    return this.rules;
  }

  /**
   * Rimuove una regola di alerting
   * @param {string} ruleId - ID della regola da rimuovere
   * @returns {boolean} true se la regola è stata rimossa, false altrimenti
   */
  removeRule(ruleId) {
    const index = this.rules.findIndex(rule => rule.id === ruleId);
    
    if (index === -1) {
      return false;
    }
    
    const removedRule = this.rules.splice(index, 1)[0];
    
    this.logger.info(`Removed alert rule: ${removedRule.name}`);
    
    return true;
  }

  /**
   * Abilita o disabilita una regola di alerting
   * @param {string} ruleId - ID della regola
   * @param {boolean} enabled - Se la regola deve essere abilitata o disabilitata
   * @returns {boolean} true se la regola è stata aggiornata, false altrimenti
   */
  setRuleEnabled(ruleId, enabled) {
    const rule = this.rules.find(rule => rule.id === ruleId);
    
    if (!rule) {
      return false;
    }
    
    rule.enabled = enabled;
    
    this.logger.info(`${enabled ? 'Enabled' : 'Disabled'} alert rule: ${rule.name}`);
    
    return true;
  }

  /**
   * Ottiene la lista degli alert attivi
   * @returns {Array<Object>} Lista degli alert attivi
   */
  getActiveAlerts() {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Ottiene la storia degli alert
   * @param {number} limit - Numero massimo di alert da restituire
   * @returns {Array<Object>} Storia degli alert
   */
  getAlertHistory(limit = 100) {
    return this.alertHistory.slice(-limit);
  }

  /**
   * Configura un endpoint Express per esporre lo stato degli alert
   * @param {Object} app - Istanza di Express
   * @param {string} path - Percorso dell'endpoint (default: /alerts)
   */
  setupExpressEndpoint(app, path = '/alerts') {
    if (!app) {
      this.logger.error('Express app is required to setup alerts endpoint');
      return;
    }
    
    this.logger.info(`Setting up alerts endpoint at ${path}`);
    
    app.get(path, (req, res) => {
      const activeAlerts = this.getActiveAlerts();
      const recentHistory = this.getAlertHistory(10);
      
      res.json({
        status: activeAlerts.length === 0 ? 'ok' : 'alert',
        activeAlerts,
        recentHistory,
        timestamp: Date.now()
      });
    });
  }
}

module.exports = {
  AlertManager
};
