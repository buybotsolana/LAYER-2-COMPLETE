/**
 * @fileoverview Implementazione di un sistema di notifiche in tempo reale per gli alert di sicurezza
 * 
 * Questo modulo implementa un sistema di notifiche in tempo reale per gli alert
 * di sicurezza, con supporto per diversi canali di notifica, filtri personalizzati
 * e gestione delle priorità.
 */

const { Logger } = require('../logger');
const { EventEmitter } = require('events');
const nodemailer = require('nodemailer');
const axios = require('axios');

// Configurazione del logger
const logger = new Logger('alert-notifier');

/**
 * Classe AlertNotifier
 * 
 * Implementa un sistema di notifiche in tempo reale per gli alert di sicurezza,
 * con supporto per diversi canali di notifica, filtri personalizzati e gestione
 * delle priorità.
 */
class AlertNotifier extends EventEmitter {
  /**
   * Crea una nuova istanza di AlertNotifier
   * @param {Object} config - Configurazione per il notificatore
   * @param {Array<string>} config.channels - Canali di notifica abilitati (default: ['log'])
   * @param {Object} config.contacts - Contatti per i canali di notifica
   * @param {Object} config.filters - Filtri per le notifiche
   * @param {Object} config.throttling - Configurazione per il throttling delle notifiche
   * @param {Object} config.templates - Template per le notifiche
   */
  constructor(config = {}) {
    super();
    
    this.channels = config.channels || ['log'];
    this.contacts = config.contacts || {};
    this.filters = config.filters || {
      minSeverity: 'low',
      excludedCategories: [],
      includedCategories: []
    };
    this.throttling = config.throttling || {
      enabled: true,
      period: 300000, // 5 minuti
      maxNotifications: 10,
      groupSimilar: true
    };
    this.templates = config.templates || {
      email: {
        subject: 'Alert di sicurezza: {severity} - {ruleName}',
        body: 'È stato rilevato un alert di sicurezza:\n\nRegola: {ruleName}\nSeverità: {severity}\nCategoria: {category}\nTimestamp: {timestamp}\n\nDettagli: {details}'
      },
      slack: {
        text: '*Alert di sicurezza: {severity} - {ruleName}*\n>Categoria: {category}\n>Timestamp: {timestamp}\n\n{details}'
      },
      webhook: {
        format: 'json'
      }
    };
    
    // Coda di notifiche in attesa
    this.notificationQueue = [];
    
    // Contatori per il throttling
    this.notificationCounters = {
      total: 0,
      byChannel: {},
      byRule: {},
      lastReset: Date.now()
    };
    
    // Trasporti per i canali di notifica
    this.transports = {};
    
    // Inizializza i trasporti
    this._initializeTransports();
    
    logger.info('AlertNotifier inizializzato', {
      channels: this.channels,
      filters: this.filters,
      throttling: {
        enabled: this.throttling.enabled,
        period: this.throttling.period,
        maxNotifications: this.throttling.maxNotifications
      }
    });
  }
  
  /**
   * Inizializza i trasporti per i canali di notifica
   * @private
   */
  _initializeTransports() {
    // Inizializza il trasporto email se abilitato
    if (this.channels.includes('email') && this.contacts.email) {
      try {
        // Configurazione del trasporto email
        const emailConfig = this.contacts.email.config || {};
        
        this.transports.email = nodemailer.createTransport({
          host: emailConfig.host || 'smtp.example.com',
          port: emailConfig.port || 587,
          secure: emailConfig.secure || false,
          auth: {
            user: emailConfig.user || 'user@example.com',
            pass: emailConfig.pass || 'password'
          }
        });
        
        logger.info('Trasporto email inizializzato');
      } catch (error) {
        logger.error('Errore durante l\'inizializzazione del trasporto email', { error: error.message });
      }
    }
    
    // Inizializza il trasporto Slack se abilitato
    if (this.channels.includes('slack') && this.contacts.slack) {
      try {
        // Verifica che sia configurato un webhook URL
        if (!this.contacts.slack.webhookUrl) {
          throw new Error('Slack webhook URL non configurato');
        }
        
        this.transports.slack = {
          webhookUrl: this.contacts.slack.webhookUrl,
          channel: this.contacts.slack.channel
        };
        
        logger.info('Trasporto Slack inizializzato');
      } catch (error) {
        logger.error('Errore durante l\'inizializzazione del trasporto Slack', { error: error.message });
      }
    }
    
    // Inizializza il trasporto webhook se abilitato
    if (this.channels.includes('webhook') && this.contacts.webhook) {
      try {
        // Verifica che sia configurato un URL
        if (!this.contacts.webhook.url) {
          throw new Error('Webhook URL non configurato');
        }
        
        this.transports.webhook = {
          url: this.contacts.webhook.url,
          method: this.contacts.webhook.method || 'POST',
          headers: this.contacts.webhook.headers || {
            'Content-Type': 'application/json'
          }
        };
        
        logger.info('Trasporto webhook inizializzato');
      } catch (error) {
        logger.error('Errore durante l\'inizializzazione del trasporto webhook', { error: error.message });
      }
    }
    
    // Inizializza il trasporto SMS se abilitato
    if (this.channels.includes('sms') && this.contacts.sms) {
      try {
        // Configurazione del trasporto SMS
        // (implementazione specifica del provider SMS)
        
        logger.info('Trasporto SMS inizializzato');
      } catch (error) {
        logger.error('Errore durante l\'inizializzazione del trasporto SMS', { error: error.message });
      }
    }
    
    // Inizializza il trasporto push se abilitato
    if (this.channels.includes('push') && this.contacts.push) {
      try {
        // Configurazione del trasporto push
        // (implementazione specifica del provider push)
        
        logger.info('Trasporto push inizializzato');
      } catch (error) {
        logger.error('Errore durante l\'inizializzazione del trasporto push', { error: error.message });
      }
    }
  }
  
  /**
   * Notifica un alert
   * @param {Object} alert - Alert da notificare
   * @returns {Promise<Object>} Risultato della notifica
   */
  async notify(alert) {
    try {
      logger.debug('Notifica di un alert', { alert });
      
      // Verifica se l'alert deve essere filtrato
      if (!this._shouldNotify(alert)) {
        logger.debug('Alert filtrato, nessuna notifica inviata', {
          ruleName: alert.ruleName,
          severity: alert.severity
        });
        return { success: false, reason: 'filtered' };
      }
      
      // Verifica se la notifica deve essere throttled
      if (this._isThrottled(alert)) {
        logger.debug('Notifica throttled', {
          ruleName: alert.ruleName,
          severity: alert.severity
        });
        
        // Aggiungi alla coda se il throttling è abilitato
        if (this.throttling.queueExcess) {
          this.notificationQueue.push({
            alert,
            timestamp: Date.now()
          });
          
          logger.debug('Notifica aggiunta alla coda', {
            queueLength: this.notificationQueue.length
          });
        }
        
        return { success: false, reason: 'throttled' };
      }
      
      // Prepara la notifica
      const notification = this._prepareNotification(alert);
      
      // Invia la notifica su tutti i canali abilitati
      const results = await Promise.all(
        this.channels.map(channel => this._notifyChannel(channel, notification))
      );
      
      // Aggiorna i contatori
      this._updateCounters(alert);
      
      // Emetti l'evento di notifica
      this.emit('notification', {
        alert,
        notification,
        results
      });
      
      // Registra il risultato
      const success = results.some(r => r.success);
      logger.info(`Notifica ${success ? 'inviata' : 'fallita'}`, {
        ruleName: alert.ruleName,
        severity: alert.severity,
        channels: results.map(r => r.channel)
      });
      
      return {
        success,
        results
      };
    } catch (error) {
      logger.error('Errore durante la notifica dell\'alert', { error: error.message });
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Verifica se un alert deve essere notificato
   * @param {Object} alert - Alert da verificare
   * @returns {boolean} True se l'alert deve essere notificato
   * @private
   */
  _shouldNotify(alert) {
    // Verifica la severità minima
    const severityLevels = ['low', 'medium', 'high', 'critical'];
    const alertSeverityIndex = severityLevels.indexOf(alert.severity);
    const minSeverityIndex = severityLevels.indexOf(this.filters.minSeverity);
    
    if (alertSeverityIndex < minSeverityIndex) {
      return false;
    }
    
    // Verifica le categorie escluse
    if (this.filters.excludedCategories.includes(alert.category)) {
      return false;
    }
    
    // Verifica le categorie incluse
    if (this.filters.includedCategories.length > 0 && 
        !this.filters.includedCategories.includes(alert.category)) {
      return false;
    }
    
    // Verifica i filtri personalizzati
    if (typeof this.filters.customFilter === 'function') {
      return this.filters.customFilter(alert);
    }
    
    return true;
  }
  
  /**
   * Verifica se una notifica deve essere throttled
   * @param {Object} alert - Alert da verificare
   * @returns {boolean} True se la notifica deve essere throttled
   * @private
   */
  _isThrottled(alert) {
    if (!this.throttling.enabled) {
      return false;
    }
    
    const now = Date.now();
    
    // Resetta i contatori se è passato il periodo di throttling
    if (now - this.notificationCounters.lastReset > this.throttling.period) {
      this._resetCounters();
    }
    
    // Verifica il numero totale di notifiche
    if (this.notificationCounters.total >= this.throttling.maxNotifications) {
      return true;
    }
    
    // Verifica il numero di notifiche per regola
    const ruleId = alert.ruleId || alert.ruleName;
    if (this.throttling.maxPerRule && 
        this.notificationCounters.byRule[ruleId] >= this.throttling.maxPerRule) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Aggiorna i contatori per il throttling
   * @param {Object} alert - Alert notificato
   * @private
   */
  _updateCounters(alert) {
    const ruleId = alert.ruleId || alert.ruleName;
    
    // Incrementa il contatore totale
    this.notificationCounters.total++;
    
    // Incrementa il contatore per regola
    if (!this.notificationCounters.byRule[ruleId]) {
      this.notificationCounters.byRule[ruleId] = 0;
    }
    this.notificationCounters.byRule[ruleId]++;
    
    // Incrementa i contatori per canale
    for (const channel of this.channels) {
      if (!this.notificationCounters.byChannel[channel]) {
        this.notificationCounters.byChannel[channel] = 0;
      }
      this.notificationCounters.byChannel[channel]++;
    }
  }
  
  /**
   * Resetta i contatori per il throttling
   * @private
   */
  _resetCounters() {
    this.notificationCounters = {
      total: 0,
      byChannel: {},
      byRule: {},
      lastReset: Date.now()
    };
    
    logger.debug('Contatori di throttling resettati');
  }
  
  /**
   * Prepara una notifica
   * @param {Object} alert - Alert da notificare
   * @returns {Object} Notifica preparata
   * @private
   */
  _prepareNotification(alert) {
    // Formatta i dettagli dell'alert
    let details = '';
    
    if (typeof alert.result === 'object') {
      details = JSON.stringify(alert.result, null, 2);
    } else if (alert.result) {
      details = String(alert.result);
    }
    
    // Crea la notifica
    return {
      alert,
      timestamp: new Date().toISOString(),
      details,
      formatted: {
        email: this._formatEmailNotification(alert, details),
        slack: this._formatSlackNotification(alert, details),
        webhook: this._formatWebhookNotification(alert, details),
        sms: this._formatSmsNotification(alert),
        push: this._formatPushNotification(alert)
      }
    };
  }
  
  /**
   * Formatta una notifica email
   * @param {Object} alert - Alert da notificare
   * @param {string} details - Dettagli dell'alert
   * @returns {Object} Notifica email formattata
   * @private
   */
  _formatEmailNotification(alert, details) {
    const template = this.templates.email;
    
    // Sostituisci i placeholder nel soggetto
    const subject = template.subject
      .replace('{ruleName}', alert.ruleName)
      .replace('{severity}', alert.severity)
      .replace('{category}', alert.category || 'N/A')
      .replace('{timestamp}', new Date(alert.timestamp).toLocaleString());
    
    // Sostituisci i placeholder nel corpo
    const body = template.body
      .replace('{ruleName}', alert.ruleName)
      .replace('{severity}', alert.severity)
      .replace('{category}', alert.category || 'N/A')
      .replace('{timestamp}', new Date(alert.timestamp).toLocaleString())
      .replace('{details}', details);
    
    return { subject, body };
  }
  
  /**
   * Formatta una notifica Slack
   * @param {Object} alert - Alert da notificare
   * @param {string} details - Dettagli dell'alert
   * @returns {Object} Notifica Slack formattata
   * @private
   */
  _formatSlackNotification(alert, details) {
    const template = this.templates.slack;
    
    // Sostituisci i placeholder nel testo
    const text = template.text
      .replace('{ruleName}', alert.ruleName)
      .replace('{severity}', alert.severity)
      .replace('{category}', alert.category || 'N/A')
      .replace('{timestamp}', new Date(alert.timestamp).toLocaleString())
      .replace('{details}', details);
    
    // Colore in base alla severità
    let color;
    switch (alert.severity) {
      case 'critical':
        color = '#FF0000'; // Rosso
        break;
      case 'high':
        color = '#FFA500'; // Arancione
        break;
      case 'medium':
        color = '#FFFF00'; // Giallo
        break;
      case 'low':
        color = '#00FF00'; // Verde
        break;
      default:
        color = '#808080'; // Grigio
    }
    
    return {
      text,
      attachments: [
        {
          color,
          fields: [
            {
              title: 'Regola',
              value: alert.ruleName,
              short: true
            },
            {
              title: 'Severità',
              value: alert.severity,
              short: true
            },
            {
              title: 'Categoria',
              value: alert.category || 'N/A',
              short: true
            },
            {
              title: 'Timestamp',
              value: new Date(alert.timestamp).toLocaleString(),
              short: true
            },
            {
              title: 'Dettagli',
              value: details,
              short: false
            }
          ]
        }
      ]
    };
  }
  
  /**
   * Formatta una notifica webhook
   * @param {Object} alert - Alert da notificare
   * @param {string} details - Dettagli dell'alert
   * @returns {Object} Notifica webhook formattata
   * @private
   */
  _formatWebhookNotification(alert, details) {
    const template = this.templates.webhook;
    
    if (template.format === 'json') {
      return {
        alert: {
          id: alert.id || `alert-${alert.timestamp}`,
          ruleName: alert.ruleName,
          ruleId: alert.ruleId,
          severity: alert.severity,
          category: alert.category,
          timestamp: alert.timestamp,
          details: details
        },
        source: 'layer2-security-system',
        timestamp: new Date().toISOString()
      };
    } else {
      // Formato personalizzato
      return template.payload || alert;
    }
  }
  
  /**
   * Formatta una notifica SMS
   * @param {Object} alert - Alert da notificare
   * @returns {string} Notifica SMS formattata
   * @private
   */
  _formatSmsNotification(alert) {
    return `Alert di sicurezza: ${alert.severity.toUpperCase()} - ${alert.ruleName}`;
  }
  
  /**
   * Formatta una notifica push
   * @param {Object} alert - Alert da notificare
   * @returns {Object} Notifica push formattata
   * @private
   */
  _formatPushNotification(alert) {
    return {
      title: `Alert di sicurezza: ${alert.severity.toUpperCase()}`,
      body: alert.ruleName,
      data: {
        alertId: alert.id || `alert-${alert.timestamp}`,
        ruleName: alert.ruleName,
        severity: alert.severity,
        category: alert.category,
        timestamp: alert.timestamp
      }
    };
  }
  
  /**
   * Invia una notifica su un canale specifico
   * @param {string} channel - Canale di notifica
   * @param {Object} notification - Notifica da inviare
   * @returns {Promise<Object>} Risultato dell'invio
   * @private
   */
  async _notifyChannel(channel, notification) {
    try {
      logger.debug(`Invio notifica sul canale ${channel}`);
      
      switch (channel) {
        case 'log':
          return await this._notifyLog(notification);
        case 'email':
          return await this._notifyEmail(notification);
        case 'slack':
          return await this._notifySlack(notification);
        case 'webhook':
          return await this._notifyWebhook(notification);
        case 'sms':
          return await this._notifySms(notification);
        case 'push':
          return await this._notifyPush(notification);
        default:
          logger.warn(`Canale di notifica non supportato: ${channel}`);
          return { channel, success: false, error: 'Canale non supportato' };
      }
    } catch (error) {
      logger.error(`Errore durante l'invio della notifica sul canale ${channel}`, { error: error.message });
      return { channel, success: false, error: error.message };
    }
  }
  
  /**
   * Invia una notifica tramite log
   * @param {Object} notification - Notifica da inviare
   * @returns {Promise<Object>} Risultato dell'invio
   * @private
   */
  async _notifyLog(notification) {
    const { alert } = notification;
    
    logger.warn(`ALERT: ${alert.ruleName} (${alert.severity})`, {
      alert,
      details: notification.details
    });
    
    return { channel: 'log', success: true };
  }
  
  /**
   * Invia una notifica tramite email
   * @param {Object} notification - Notifica da inviare
   * @returns {Promise<Object>} Risultato dell'invio
   * @private
   */
  async _notifyEmail(notification) {
    if (!this.transports.email) {
      return { channel: 'email', success: false, error: 'Trasporto email non inizializzato' };
    }
    
    if (!this.contacts.email || !this.contacts.email.recipients) {
      return { channel: 'email', success: false, error: 'Destinatari email non configurati' };
    }
    
    const { subject, body } = notification.formatted.email;
    
    // Opzioni per l'email
    const mailOptions = {
      from: this.contacts.email.from || 'security-alerts@example.com',
      to: this.contacts.email.recipients,
      subject,
      text: body,
      html: body.replace(/\n/g, '<br>')
    };
    
    // Invia l'email
    const result = await this.transports.email.sendMail(mailOptions);
    
    logger.info('Notifica email inviata', {
      messageId: result.messageId,
      recipients: this.contacts.email.recipients
    });
    
    return { channel: 'email', success: true, messageId: result.messageId };
  }
  
  /**
   * Invia una notifica tramite Slack
   * @param {Object} notification - Notifica da inviare
   * @returns {Promise<Object>} Risultato dell'invio
   * @private
   */
  async _notifySlack(notification) {
    if (!this.transports.slack) {
      return { channel: 'slack', success: false, error: 'Trasporto Slack non inizializzato' };
    }
    
    const { webhookUrl, channel } = this.transports.slack;
    const slackNotification = notification.formatted.slack;
    
    // Aggiungi il canale se specificato
    if (channel) {
      slackNotification.channel = channel;
    }
    
    // Invia la notifica a Slack
    const response = await axios.post(webhookUrl, slackNotification);
    
    logger.info('Notifica Slack inviata', {
      statusCode: response.status,
      channel
    });
    
    return { channel: 'slack', success: response.status === 200 };
  }
  
  /**
   * Invia una notifica tramite webhook
   * @param {Object} notification - Notifica da inviare
   * @returns {Promise<Object>} Risultato dell'invio
   * @private
   */
  async _notifyWebhook(notification) {
    if (!this.transports.webhook) {
      return { channel: 'webhook', success: false, error: 'Trasporto webhook non inizializzato' };
    }
    
    const { url, method, headers } = this.transports.webhook;
    const webhookNotification = notification.formatted.webhook;
    
    // Invia la notifica tramite webhook
    const response = await axios({
      method,
      url,
      headers,
      data: webhookNotification
    });
    
    logger.info('Notifica webhook inviata', {
      statusCode: response.status,
      url
    });
    
    return { channel: 'webhook', success: response.status >= 200 && response.status < 300 };
  }
  
  /**
   * Invia una notifica tramite SMS
   * @param {Object} notification - Notifica da inviare
   * @returns {Promise<Object>} Risultato dell'invio
   * @private
   */
  async _notifySms(notification) {
    // Implementazione specifica del provider SMS
    logger.info('Notifica SMS simulata', {
      recipients: this.contacts.sms?.recipients || 'nessuno'
    });
    
    return { channel: 'sms', success: true, simulated: true };
  }
  
  /**
   * Invia una notifica tramite push
   * @param {Object} notification - Notifica da inviare
   * @returns {Promise<Object>} Risultato dell'invio
   * @private
   */
  async _notifySms(notification) {
    // Implementazione specifica del provider push
    logger.info('Notifica push simulata', {
      recipients: this.contacts.push?.recipients || 'nessuno'
    });
    
    return { channel: 'push', success: true, simulated: true };
  }
  
  /**
   * Processa la coda di notifiche
   * @returns {Promise<Array<Object>>} Risultati dell'invio
   */
  async processQueue() {
    if (this.notificationQueue.length === 0) {
      return [];
    }
    
    logger.info(`Elaborazione della coda di notifiche (${this.notificationQueue.length} elementi)`);
    
    // Resetta i contatori
    this._resetCounters();
    
    // Raggruppa le notifiche simili se abilitato
    let queue = [...this.notificationQueue];
    
    if (this.throttling.groupSimilar) {
      queue = this._groupSimilarNotifications(queue);
    }
    
    // Limita il numero di notifiche
    if (queue.length > this.throttling.maxNotifications) {
      queue = queue.slice(0, this.throttling.maxNotifications);
      
      // Aggiungi una notifica di riepilogo
      queue.push({
        alert: {
          ruleName: 'Notifica di riepilogo',
          severity: 'medium',
          category: 'system',
          timestamp: Date.now(),
          result: `${this.notificationQueue.length - this.throttling.maxNotifications} notifiche aggiuntive sono state omesse a causa del throttling.`
        },
        timestamp: Date.now()
      });
    }
    
    // Invia le notifiche
    const results = [];
    
    for (const item of queue) {
      const result = await this.notify(item.alert);
      results.push(result);
    }
    
    // Svuota la coda
    this.notificationQueue = [];
    
    logger.info(`Coda di notifiche elaborata (${results.length} notifiche inviate)`);
    
    return results;
  }
  
  /**
   * Raggruppa notifiche simili
   * @param {Array<Object>} queue - Coda di notifiche
   * @returns {Array<Object>} Coda di notifiche raggruppate
   * @private
   */
  _groupSimilarNotifications(queue) {
    const groups = {};
    
    // Raggruppa per regola
    for (const item of queue) {
      const ruleId = item.alert.ruleId || item.alert.ruleName;
      
      if (!groups[ruleId]) {
        groups[ruleId] = [];
      }
      
      groups[ruleId].push(item);
    }
    
    // Crea notifiche raggruppate
    const result = [];
    
    for (const [ruleId, items] of Object.entries(groups)) {
      if (items.length === 1) {
        // Se c'è solo un elemento, aggiungilo direttamente
        result.push(items[0]);
      } else {
        // Altrimenti, crea una notifica di gruppo
        const firstItem = items[0];
        
        result.push({
          alert: {
            ruleName: `${firstItem.alert.ruleName} (${items.length} occorrenze)`,
            ruleId,
            severity: firstItem.alert.severity,
            category: firstItem.alert.category,
            timestamp: Date.now(),
            result: `Ci sono state ${items.length} occorrenze di questo alert nel periodo di throttling.`
          },
          timestamp: Date.now()
        });
      }
    }
    
    return result;
  }
  
  /**
   * Aggiunge un canale di notifica
   * @param {string} channel - Canale da aggiungere
   * @param {Object} config - Configurazione per il canale
   * @returns {boolean} True se il canale è stato aggiunto
   */
  addChannel(channel, config) {
    if (this.channels.includes(channel)) {
      logger.warn(`Il canale ${channel} è già abilitato`);
      return false;
    }
    
    // Aggiungi il canale
    this.channels.push(channel);
    
    // Aggiorna la configurazione dei contatti
    if (config) {
      this.contacts[channel] = config;
    }
    
    // Inizializza il trasporto
    this._initializeTransports();
    
    logger.info(`Canale ${channel} aggiunto`);
    
    return true;
  }
  
  /**
   * Rimuove un canale di notifica
   * @param {string} channel - Canale da rimuovere
   * @returns {boolean} True se il canale è stato rimosso
   */
  removeChannel(channel) {
    const index = this.channels.indexOf(channel);
    
    if (index === -1) {
      logger.warn(`Il canale ${channel} non è abilitato`);
      return false;
    }
    
    // Rimuovi il canale
    this.channels.splice(index, 1);
    
    logger.info(`Canale ${channel} rimosso`);
    
    return true;
  }
  
  /**
   * Aggiorna i filtri
   * @param {Object} filters - Nuovi filtri
   */
  updateFilters(filters) {
    this.filters = { ...this.filters, ...filters };
    
    logger.info('Filtri aggiornati', { filters: this.filters });
  }
  
  /**
   * Aggiorna la configurazione di throttling
   * @param {Object} throttling - Nuova configurazione di throttling
   */
  updateThrottling(throttling) {
    this.throttling = { ...this.throttling, ...throttling };
    
    logger.info('Configurazione di throttling aggiornata', { throttling: this.throttling });
  }
  
  /**
   * Aggiorna i template
   * @param {Object} templates - Nuovi template
   */
  updateTemplates(templates) {
    this.templates = { ...this.templates, ...templates };
    
    logger.info('Template aggiornati');
  }
  
  /**
   * Ottiene la configurazione del notificatore
   * @returns {Object} Configurazione
   */
  getConfig() {
    return {
      channels: this.channels,
      filters: this.filters,
      throttling: this.throttling,
      queueLength: this.notificationQueue.length,
      counters: this.notificationCounters
    };
  }
}

module.exports = { AlertNotifier };
