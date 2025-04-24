/**
 * Sistema di Alert Manager per il Layer-2 su Solana
 * 
 * Questo modulo implementa un gestore degli alert che permette di inviare
 * notifiche e alert in base a eventi e condizioni del sistema.
 */

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');

/**
 * Classe AlertManager
 * 
 * Implementa un gestore degli alert con supporto per diversi canali di notifica
 * e livelli di severità.
 */
class AlertManager extends EventEmitter {
    /**
     * Costruttore
     * @param {Object} config - Configurazione del gestore degli alert
     * @param {Object} [config.channels] - Configurazione dei canali di notifica
     * @param {Object} [config.thresholds] - Soglie per gli alert
     * @param {string} [config.alertsDir] - Directory per gli alert persistenti
     * @param {boolean} [config.persistAlerts=true] - Se persistere gli alert
     * @param {Function} [config.logger] - Funzione di logging
     */
    constructor(config = {}) {
        super();
        
        this.config = {
            alertsDir: config.alertsDir || path.join(process.cwd(), 'alerts'),
            persistAlerts: config.persistAlerts !== undefined ? config.persistAlerts : true,
            ...config
        };
        
        // Inizializza i canali di notifica
        this.channels = {};
        
        // Inizializza le soglie
        this.thresholds = this.config.thresholds || {
            info: 0,
            warning: 1,
            error: 2,
            critical: 3
        };
        
        // Stato del gestore
        this.isInitialized = false;
        
        // Logger
        this.logger = this.config.logger || console;
        
        // Registro degli alert
        this.alerts = [];
        
        // Registro delle notifiche
        this.notifications = [];
    }

    /**
     * Inizializza il gestore degli alert
     * @returns {Promise<boolean>} - True se l'inizializzazione è riuscita
     */
    async initialize() {
        try {
            this.logger.info('Inizializzazione del gestore degli alert...');
            
            // Crea la directory degli alert se non esiste
            if (this.config.persistAlerts) {
                await fs.mkdir(this.config.alertsDir, { recursive: true });
            }
            
            // Registra i canali di notifica configurati
            if (this.config.channels) {
                for (const [channelName, channelConfig] of Object.entries(this.config.channels)) {
                    this.registerChannel(channelName, channelConfig);
                }
            }
            
            // Registra i canali di default
            this._registerDefaultChannels();
            
            this.isInitialized = true;
            this.emit('initialized');
            
            this.logger.info('Gestore degli alert inizializzato con successo');
            return true;
        } catch (error) {
            this.logger.error(`Errore durante l'inizializzazione del gestore degli alert: ${error.message}`);
            throw error;
        }
    }

    /**
     * Registra i canali di notifica di default
     * @private
     */
    _registerDefaultChannels() {
        // Canale di console
        if (!this.channels.console) {
            this.registerChannel('console', {
                type: 'console',
                enabled: true,
                minSeverity: 'info'
            });
        }
        
        // Canale di file
        if (!this.channels.file && this.config.persistAlerts) {
            this.registerChannel('file', {
                type: 'file',
                enabled: true,
                minSeverity: 'warning',
                filePath: path.join(this.config.alertsDir, 'alerts.log')
            });
        }
    }

    /**
     * Registra un canale di notifica
     * @param {string} channelName - Nome del canale
     * @param {Object} channelConfig - Configurazione del canale
     * @returns {Object} - Configurazione del canale registrato
     */
    registerChannel(channelName, channelConfig) {
        if (!channelName || !channelConfig) {
            throw new Error('Nome e configurazione del canale sono obbligatori');
        }
        
        this.channels[channelName] = {
            enabled: channelConfig.enabled !== undefined ? channelConfig.enabled : true,
            minSeverity: channelConfig.minSeverity || 'info',
            ...channelConfig
        };
        
        this.logger.info(`Canale di notifica registrato: ${channelName}`);
        
        return this.channels[channelName];
    }

    /**
     * Invia un alert
     * @param {Object} alert - Alert da inviare
     * @param {string} alert.severity - Severità dell'alert (info, warning, error, critical)
     * @param {string} alert.message - Messaggio dell'alert
     * @param {Object} [alert.details] - Dettagli aggiuntivi
     * @param {string[]} [alert.tags] - Tag dell'alert
     * @param {string[]} [alert.channels] - Canali specifici da utilizzare
     * @returns {Promise<boolean>} - True se l'invio è riuscito
     */
    async sendAlert(alert) {
        if (!this.isInitialized) {
            throw new Error('Il gestore degli alert non è inizializzato');
        }
        
        // Normalizza la severità
        const severity = alert.severity.toLowerCase();
        
        // Verifica se la severità è valida
        if (!this.thresholds.hasOwnProperty(severity)) {
            throw new Error(`Severità non valida: ${severity}`);
        }
        
        // Prepara l'alert
        const fullAlert = {
            id: `alert-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            severity,
            message: alert.message,
            details: alert.details || {},
            tags: alert.tags || [],
            timestamp: new Date().toISOString(),
            ...alert
        };
        
        // Registra l'alert
        this.alerts.push(fullAlert);
        
        // Limita la dimensione del registro
        if (this.alerts.length > 1000) {
            this.alerts = this.alerts.slice(-1000);
        }
        
        // Emetti evento
        this.emit('alert', fullAlert);
        
        // Invia l'alert ai canali appropriati
        const channelsToUse = alert.channels || Object.keys(this.channels);
        const severityLevel = this.thresholds[severity];
        
        for (const channelName of channelsToUse) {
            const channel = this.channels[channelName];
            
            if (!channel || !channel.enabled) {
                continue;
            }
            
            // Verifica se la severità è sufficiente
            const minSeverityLevel = this.thresholds[channel.minSeverity.toLowerCase()];
            
            if (severityLevel < minSeverityLevel) {
                continue;
            }
            
            try {
                await this._sendToChannel(channelName, fullAlert);
            } catch (error) {
                this.logger.error(`Errore durante l'invio dell'alert al canale ${channelName}: ${error.message}`);
            }
        }
        
        return true;
    }

    /**
     * Invia una notifica
     * @param {Object} notification - Notifica da inviare
     * @param {string} notification.severity - Severità della notifica (info, warning, error, critical)
     * @param {string} notification.message - Messaggio della notifica
     * @param {Object} [notification.details] - Dettagli aggiuntivi
     * @param {string[]} [notification.tags] - Tag della notifica
     * @param {string[]} [notification.channels] - Canali specifici da utilizzare
     * @returns {Promise<boolean>} - True se l'invio è riuscito
     */
    async sendNotification(notification) {
        if (!this.isInitialized) {
            throw new Error('Il gestore degli alert non è inizializzato');
        }
        
        // Normalizza la severità
        const severity = notification.severity.toLowerCase();
        
        // Verifica se la severità è valida
        if (!this.thresholds.hasOwnProperty(severity)) {
            throw new Error(`Severità non valida: ${severity}`);
        }
        
        // Prepara la notifica
        const fullNotification = {
            id: `notification-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            severity,
            message: notification.message,
            details: notification.details || {},
            tags: notification.tags || [],
            timestamp: new Date().toISOString(),
            ...notification
        };
        
        // Registra la notifica
        this.notifications.push(fullNotification);
        
        // Limita la dimensione del registro
        if (this.notifications.length > 1000) {
            this.notifications = this.notifications.slice(-1000);
        }
        
        // Emetti evento
        this.emit('notification', fullNotification);
        
        // Invia la notifica ai canali appropriati
        const channelsToUse = notification.channels || Object.keys(this.channels);
        const severityLevel = this.thresholds[severity];
        
        for (const channelName of channelsToUse) {
            const channel = this.channels[channelName];
            
            if (!channel || !channel.enabled) {
                continue;
            }
            
            // Verifica se la severità è sufficiente
            const minSeverityLevel = this.thresholds[channel.minSeverity.toLowerCase()];
            
            if (severityLevel < minSeverityLevel) {
                continue;
            }
            
            try {
                await this._sendToChannel(channelName, fullNotification, true);
            } catch (error) {
                this.logger.error(`Errore durante l'invio della notifica al canale ${channelName}: ${error.message}`);
            }
        }
        
        return true;
    }

    /**
     * Invia un messaggio a un canale specifico
     * @param {string} channelName - Nome del canale
     * @param {Object} message - Messaggio da inviare
     * @param {boolean} [isNotification=false] - Se il messaggio è una notifica
     * @returns {Promise<boolean>} - True se l'invio è riuscito
     * @private
     */
    async _sendToChannel(channelName, message, isNotification = false) {
        const channel = this.channels[channelName];
        
        if (!channel) {
            throw new Error(`Canale non trovato: ${channelName}`);
        }
        
        const messageType = isNotification ? 'Notification' : 'Alert';
        
        switch (channel.type) {
            case 'console':
                // Invia alla console
                const consoleMethod = message.severity === 'info' ? 'info' :
                                     message.severity === 'warning' ? 'warn' :
                                     'error';
                
                console[consoleMethod](`[${messageType}][${message.severity.toUpperCase()}] ${message.message}`);
                
                if (Object.keys(message.details).length > 0) {
                    console[consoleMethod]('Details:', message.details);
                }
                
                break;
                
            case 'file':
                // Invia a un file
                if (!channel.filePath) {
                    throw new Error('File path non specificato per il canale file');
                }
                
                const logEntry = JSON.stringify({
                    type: messageType,
                    ...message
                }) + '\n';
                
                await fs.appendFile(channel.filePath, logEntry, 'utf8');
                break;
                
            case 'webhook':
                // Invia a un webhook
                if (!channel.url) {
                    throw new Error('URL non specificato per il canale webhook');
                }
                
                const webhookPayload = {
                    type: messageType,
                    ...message
                };
                
                // Implementazione di esempio: in un sistema reale, questo utilizzerebbe
                // una libreria HTTP come axios o node-fetch
                await this._sendWebhook(channel.url, webhookPayload, channel.headers);
                break;
                
            case 'email':
                // Invia una email
                if (!channel.recipients) {
                    throw new Error('Destinatari non specificati per il canale email');
                }
                
                // Implementazione di esempio: in un sistema reale, questo utilizzerebbe
                // una libreria di email come nodemailer
                await this._sendEmail(
                    channel.recipients,
                    `[${messageType}][${message.severity.toUpperCase()}] ${message.message}`,
                    JSON.stringify(message, null, 2),
                    channel.smtpConfig
                );
                break;
                
            case 'slack':
                // Invia a Slack
                if (!channel.webhookUrl) {
                    throw new Error('Webhook URL non specificato per il canale Slack');
                }
                
                // Implementazione di esempio: in un sistema reale, questo utilizzerebbe
                // una libreria Slack o HTTP
                await this._sendSlackMessage(
                    channel.webhookUrl,
                    message.message,
                    message.severity,
                    message.details
                );
                break;
                
            case 'custom':
                // Canale personalizzato
                if (typeof channel.send !== 'function') {
                    throw new Error('Funzione send non specificata per il canale custom');
                }
                
                await channel.send(message, isNotification);
                break;
                
            default:
                throw new Error(`Tipo di canale non supportato: ${channel.type}`);
        }
        
        return true;
    }

    /**
     * Invia un messaggio a un webhook
     * @param {string} url - URL del webhook
     * @param {Object} payload - Payload da inviare
     * @param {Object} [headers] - Headers HTTP
     * @returns {Promise<boolean>} - True se l'invio è riuscito
     * @private
     */
    async _sendWebhook(url, payload, headers = {}) {
        // Implementazione di esempio: in un sistema reale, questo utilizzerebbe
        // una libreria HTTP come axios o node-fetch
        this.logger.debug(`Invio webhook a ${url}`, payload);
        
        // Simula l'invio
        return true;
    }

    /**
     * Invia una email
     * @param {string[]} recipients - Destinatari
     * @param {string} subject - Oggetto
     * @param {string} body - Corpo
     * @param {Object} [smtpConfig] - Configurazione SMTP
     * @returns {Promise<boolean>} - True se l'invio è riuscito
     * @private
     */
    async _sendEmail(recipients, subject, body, smtpConfig = {}) {
        // Implementazione di esempio: in un sistema reale, questo utilizzerebbe
        // una libreria di email come nodemailer
        this.logger.debug(`Invio email a ${recipients.join(', ')}`, { subject, body });
        
        // Simula l'invio
        return true;
    }

    /**
     * Invia un messaggio a Slack
     * @param {string} webhookUrl - URL del webhook Slack
     * @param {string} message - Messaggio
     * @param {string} severity - Severità
     * @param {Object} details - Dettagli
     * @returns {Promise<boolean>} - True se l'invio è riuscito
     * @private
     */
    async _sendSlackMessage(webhookUrl, message, severity, details = {}) {
        // Implementazione di esempio: in un sistema reale, questo utilizzerebbe
        // una libreria Slack o HTTP
        this.logger.debug(`Invio messaggio Slack a ${webhookUrl}`, { message, severity, details });
        
        // Simula l'invio
        return true;
    }

    /**
     * Ottiene gli alert
     * @param {Object} [options] - Opzioni di filtro
     * @param {string} [options.severity] - Filtra per severità
     * @param {string[]} [options.tags] - Filtra per tag
     * @param {number} [options.limit] - Numero massimo di alert da restituire
     * @returns {Array} - Alert filtrati
     */
    getAlerts(options = {}) {
        let filteredAlerts = [...this.alerts];
        
        // Filtra per severità
        if (options.severity) {
            filteredAlerts = filteredAlerts.filter(alert => alert.severity === options.severity);
        }
        
        // Filtra per tag
        if (options.tags && options.tags.length > 0) {
            filteredAlerts = filteredAlerts.filter(alert => {
                return options.tags.some(tag => alert.tags.includes(tag));
            });
        }
        
        // Ordina per timestamp decrescente
        filteredAlerts.sort((a, b) => {
            return new Date(b.timestamp) - new Date(a.timestamp);
        });
        
        // Limita il numero di risultati
        if (options.limit) {
            filteredAlerts = filteredAlerts.slice(0, options.limit);
        }
        
        return filteredAlerts;
    }

    /**
     * Ottiene le notifiche
     * @param {Object} [options] - Opzioni di filtro
     * @param {string} [options.severity] - Filtra per severità
     * @param {string[]} [options.tags] - Filtra per tag
     * @param {number} [options.limit] - Numero massimo di notifiche da restituire
     * @returns {Array} - Notifiche filtrate
     */
    getNotifications(options = {}) {
        let filteredNotifications = [...this.notifications];
        
        // Filtra per severità
        if (options.severity) {
            filteredNotifications = filteredNotifications.filter(notification => notification.severity === options.severity);
        }
        
        // Filtra per tag
        if (options.tags && options.tags.length > 0) {
            filteredNotifications = filteredNotifications.filter(notification => {
                return options.tags.some(tag => notification.tags.includes(tag));
            });
        }
        
        // Ordina per timestamp decrescente
        filteredNotifications.sort((a, b) => {
            return new Date(b.timestamp) - new Date(a.timestamp);
        });
        
        // Limita il numero di risultati
        if (options.limit) {
            filteredNotifications = filteredNotifications.slice(0, options.limit);
        }
        
        return filteredNotifications;
    }

    /**
     * Ottiene lo stato del gestore degli alert
     * @returns {Object} - Stato del gestore
     */
    getStatus() {
        return {
            isInitialized: this.isInitialized,
            channels: Object.keys(this.channels).map(name => ({
                name,
                enabled: this.channels[name].enabled,
                type: this.channels[name].type,
                minSeverity: this.channels[name].minSeverity
            })),
            alertsCount: this.alerts.length,
            notificationsCount: this.notifications.length,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = { AlertManager };
