/**
 * Generatore di Documentazione per il Layer-2 su Solana
 * 
 * Questo modulo implementa un generatore di documentazione che analizza
 * il codice sorgente e genera documentazione automatica in vari formati.
 */

const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');

/**
 * Classe DocumentationGenerator
 * 
 * Implementa un generatore di documentazione che analizza il codice sorgente
 * e genera documentazione in vari formati (Markdown, HTML, PDF).
 */
class DocumentationGenerator extends EventEmitter {
    /**
     * Costruttore
     * @param {Object} config - Configurazione del generatore
     * @param {string} [config.sourceDir] - Directory del codice sorgente
     * @param {string} [config.outputDir] - Directory di output
     * @param {string[]} [config.formats] - Formati di output
     * @param {Object} [config.templates] - Template per la documentazione
     * @param {Function} [config.logger] - Funzione di logging
     */
    constructor(config = {}) {
        super();
        
        this.config = {
            sourceDir: config.sourceDir || path.join(process.cwd(), 'src'),
            outputDir: config.outputDir || path.join(process.cwd(), 'docs'),
            formats: config.formats || ['markdown'],
            templates: config.templates || {},
            ...config
        };
        
        // Stato del generatore
        this.isInitialized = false;
        
        // Logger
        this.logger = this.config.logger || console;
        
        // Registro dei file analizzati
        this.analyzedFiles = [];
        
        // Documentazione generata
        this.documentation = {
            modules: {},
            classes: {},
            functions: {},
            interfaces: {},
            types: {}
        };
    }

    /**
     * Inizializza il generatore di documentazione
     * @returns {Promise<boolean>} - True se l'inizializzazione è riuscita
     */
    async initialize() {
        try {
            this.logger.info('Inizializzazione del generatore di documentazione...');
            
            // Crea la directory di output se non esiste
            await fs.mkdir(this.config.outputDir, { recursive: true });
            
            this.isInitialized = true;
            this.emit('initialized');
            
            this.logger.info('Generatore di documentazione inizializzato con successo');
            return true;
        } catch (error) {
            this.logger.error(`Errore durante l'inizializzazione del generatore di documentazione: ${error.message}`);
            throw error;
        }
    }

    /**
     * Genera la documentazione
     * @param {Object} [options] - Opzioni di generazione
     * @param {string[]} [options.files] - Lista di file specifici da documentare
     * @param {boolean} [options.recursive=true] - Se analizzare ricorsivamente le directory
     * @param {string[]} [options.exclude] - Pattern di file da escludere
     * @returns {Promise<Object>} - Risultati della generazione
     */
    async generateDocumentation(options = {}) {
        if (!this.isInitialized) {
            throw new Error('Il generatore di documentazione non è inizializzato');
        }
        
        const startTime = Date.now();
        this.logger.info('Generazione della documentazione...');
        
        // Opzioni di default
        const opts = {
            recursive: options.recursive !== undefined ? options.recursive : true,
            exclude: options.exclude || [],
            ...options
        };
        
        // Resetta lo stato
        this.analyzedFiles = [];
        this.documentation = {
            modules: {},
            classes: {},
            functions: {},
            interfaces: {},
            types: {}
        };
        
        try {
            // Trova i file da analizzare
            const files = options.files || await this._findSourceFiles(this.config.sourceDir, opts);
            
            // Analizza i file
            for (const file of files) {
                await this._analyzeFile(file);
            }
            
            // Genera la documentazione nei formati richiesti
            const outputs = {};
            
            for (const format of this.config.formats) {
                outputs[format] = await this._generateOutput(format);
            }
            
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            const results = {
                analyzedFiles: this.analyzedFiles.length,
                modules: Object.keys(this.documentation.modules).length,
                classes: Object.keys(this.documentation.classes).length,
                functions: Object.keys(this.documentation.functions).length,
                interfaces: Object.keys(this.documentation.interfaces).length,
                types: Object.keys(this.documentation.types).length,
                outputs,
                duration
            };
            
            this.logger.info(`Documentazione generata con successo in ${duration}ms`);
            this.emit('documentation_generated', results);
            
            return results;
        } catch (error) {
            this.logger.error(`Errore durante la generazione della documentazione: ${error.message}`);
            throw error;
        }
    }

    /**
     * Trova i file sorgente da analizzare
     * @param {string} dir - Directory da analizzare
     * @param {Object} options - Opzioni di ricerca
     * @returns {Promise<string[]>} - Lista di file trovati
     * @private
     */
    async _findSourceFiles(dir, options) {
        const files = [];
        
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                // Verifica se il file deve essere escluso
                if (options.exclude.some(pattern => {
                    if (pattern instanceof RegExp) {
                        return pattern.test(fullPath);
                    }
                    return fullPath.includes(pattern);
                })) {
                    continue;
                }
                
                if (entry.isDirectory()) {
                    if (options.recursive) {
                        const subFiles = await this._findSourceFiles(fullPath, options);
                        files.push(...subFiles);
                    }
                } else if (this._isSourceFile(entry.name)) {
                    files.push(fullPath);
                }
            }
        } catch (error) {
            this.logger.error(`Errore durante la ricerca dei file: ${error.message}`);
        }
        
        return files;
    }

    /**
     * Verifica se un file è un file sorgente da analizzare
     * @param {string} filename - Nome del file
     * @returns {boolean} - True se il file è un file sorgente
     * @private
     */
    _isSourceFile(filename) {
        const ext = path.extname(filename).toLowerCase();
        return ['.js', '.jsx', '.ts', '.tsx'].includes(ext);
    }

    /**
     * Analizza un file sorgente
     * @param {string} filePath - Percorso del file
     * @returns {Promise<Object>} - Documentazione del file
     * @private
     */
    async _analyzeFile(filePath) {
        try {
            this.logger.debug(`Analisi del file: ${filePath}`);
            
            // Leggi il contenuto del file
            const content = await fs.readFile(filePath, 'utf8');
            
            // Analizza il contenuto
            const fileDoc = this._parseFileContent(content, filePath);
            
            // Aggiungi alla documentazione
            this._addToDocumentation(fileDoc, filePath);
            
            // Aggiungi alla lista dei file analizzati
            this.analyzedFiles.push(filePath);
            
            return fileDoc;
        } catch (error) {
            this.logger.error(`Errore durante l'analisi del file ${filePath}: ${error.message}`);
            return null;
        }
    }

    /**
     * Analizza il contenuto di un file
     * @param {string} content - Contenuto del file
     * @param {string} filePath - Percorso del file
     * @returns {Object} - Documentazione del file
     * @private
     */
    _parseFileContent(content, filePath) {
        const fileDoc = {
            path: filePath,
            name: path.basename(filePath),
            description: '',
            modules: [],
            classes: [],
            functions: [],
            interfaces: [],
            types: []
        };
        
        // Estrai la descrizione del file
        const fileCommentMatch = content.match(/\/\*\*([\s\S]*?)\*\//);
        if (fileCommentMatch) {
            fileDoc.description = this._parseComment(fileCommentMatch[1]);
        }
        
        // Estrai le classi
        const classRegex = /class\s+(\w+)(?:\s+extends\s+(\w+))?\s*{([\s\S]*?)}/g;
        let classMatch;
        
        while ((classMatch = classRegex.exec(content)) !== null) {
            const className = classMatch[1];
            const extendsClass = classMatch[2] || null;
            const classBody = classMatch[3];
            
            // Cerca il commento della classe
            const classCommentMatch = content.substring(0, classMatch.index).match(/\/\*\*([\s\S]*?)\*\/\s*$/);
            const classDescription = classCommentMatch ? this._parseComment(classCommentMatch[1]) : '';
            
            // Estrai i metodi
            const methods = this._parseMethods(classBody);
            
            fileDoc.classes.push({
                name: className,
                extends: extendsClass,
                description: classDescription,
                methods
            });
        }
        
        // Estrai le funzioni
        const functionRegex = /(?:function|const|let|var)\s+(\w+)\s*=?\s*(?:function)?\s*\(([\s\S]*?)\)\s*(?:=>)?\s*{/g;
        let functionMatch;
        
        while ((functionMatch = functionRegex.exec(content)) !== null) {
            const functionName = functionMatch[1];
            const functionParams = functionMatch[2];
            
            // Cerca il commento della funzione
            const functionCommentMatch = content.substring(0, functionMatch.index).match(/\/\*\*([\s\S]*?)\*\/\s*$/);
            const functionDescription = functionCommentMatch ? this._parseComment(functionCommentMatch[1]) : '';
            
            // Estrai i parametri
            const params = this._parseParams(functionParams);
            
            fileDoc.functions.push({
                name: functionName,
                description: functionDescription,
                params
            });
        }
        
        return fileDoc;
    }

    /**
     * Analizza un commento JSDoc
     * @param {string} comment - Commento JSDoc
     * @returns {string} - Descrizione estratta
     * @private
     */
    _parseComment(comment) {
        // Rimuovi gli asterischi e gli spazi iniziali
        return comment
            .replace(/^\s*\*\s?/gm, '')
            .replace(/@\w+.*$/gm, '') // Rimuovi i tag JSDoc
            .trim();
    }

    /**
     * Analizza i metodi di una classe
     * @param {string} classBody - Corpo della classe
     * @returns {Array} - Lista dei metodi
     * @private
     */
    _parseMethods(classBody) {
        const methods = [];
        
        // Regex per i metodi
        const methodRegex = /(?:async\s+)?(\w+)\s*\(([\s\S]*?)\)\s*{/g;
        let methodMatch;
        
        while ((methodMatch = methodRegex.exec(classBody)) !== null) {
            const methodName = methodMatch[1];
            const methodParams = methodMatch[2];
            
            // Cerca il commento del metodo
            const methodCommentMatch = classBody.substring(0, methodMatch.index).match(/\/\*\*([\s\S]*?)\*\/\s*$/);
            const methodDescription = methodCommentMatch ? this._parseComment(methodCommentMatch[1]) : '';
            
            // Estrai i parametri
            const params = this._parseParams(methodParams);
            
            methods.push({
                name: methodName,
                description: methodDescription,
                params
            });
        }
        
        return methods;
    }

    /**
     * Analizza i parametri di una funzione o metodo
     * @param {string} paramsString - Stringa dei parametri
     * @returns {Array} - Lista dei parametri
     * @private
     */
    _parseParams(paramsString) {
        const params = [];
        
        // Dividi i parametri
        const paramParts = paramsString.split(',').map(p => p.trim()).filter(p => p);
        
        for (const part of paramParts) {
            // Estrai il nome e il valore di default
            const [paramName, defaultValue] = part.split('=').map(p => p.trim());
            
            params.push({
                name: paramName.replace(/^{.*}/, '').trim(), // Rimuovi il tipo se presente
                defaultValue: defaultValue || null
            });
        }
        
        return params;
    }

    /**
     * Aggiunge la documentazione di un file alla documentazione globale
     * @param {Object} fileDoc - Documentazione del file
     * @param {string} filePath - Percorso del file
     * @private
     */
    _addToDocumentation(fileDoc, filePath) {
        // Aggiungi il modulo
        const moduleName = this._getModuleName(filePath);
        
        this.documentation.modules[moduleName] = {
            name: moduleName,
            path: filePath,
            description: fileDoc.description
        };
        
        // Aggiungi le classi
        for (const classDoc of fileDoc.classes) {
            this.documentation.classes[classDoc.name] = {
                ...classDoc,
                module: moduleName
            };
        }
        
        // Aggiungi le funzioni
        for (const functionDoc of fileDoc.functions) {
            this.documentation.functions[functionDoc.name] = {
                ...functionDoc,
                module: moduleName
            };
        }
    }

    /**
     * Ottiene il nome del modulo da un percorso di file
     * @param {string} filePath - Percorso del file
     * @returns {string} - Nome del modulo
     * @private
     */
    _getModuleName(filePath) {
        // Rimuovi l'estensione
        const basename = path.basename(filePath, path.extname(filePath));
        
        // Ottieni il percorso relativo alla directory sorgente
        const relativePath = path.relative(this.config.sourceDir, path.dirname(filePath));
        
        if (relativePath === '') {
            return basename;
        }
        
        return `${relativePath.replace(/\\/g, '/')}/${basename}`;
    }

    /**
     * Genera l'output in un formato specifico
     * @param {string} format - Formato di output
     * @returns {Promise<string>} - Percorso del file generato
     * @private
     */
    async _generateOutput(format) {
        switch (format.toLowerCase()) {
            case 'markdown':
                return await this._generateMarkdown();
            case 'html':
                return await this._generateHtml();
            case 'pdf':
                return await this._generatePdf();
            default:
                throw new Error(`Formato non supportato: ${format}`);
        }
    }

    /**
     * Genera la documentazione in formato Markdown
     * @returns {Promise<string>} - Percorso del file generato
     * @private
     */
    async _generateMarkdown() {
        try {
            let markdown = '# Documentazione API\n\n';
            
            // Aggiungi la tabella dei contenuti
            markdown += '## Indice\n\n';
            markdown += '- [Moduli](#moduli)\n';
            markdown += '- [Classi](#classi)\n';
            markdown += '- [Funzioni](#funzioni)\n\n';
            
            // Aggiungi i moduli
            markdown += '## Moduli\n\n';
            
            for (const [moduleName, moduleDoc] of Object.entries(this.documentation.modules)) {
                markdown += `### ${moduleName}\n\n`;
                
                if (moduleDoc.description) {
                    markdown += `${moduleDoc.description}\n\n`;
                }
                
                markdown += `**File:** \`${moduleDoc.path}\`\n\n`;
            }
            
            // Aggiungi le classi
            markdown += '## Classi\n\n';
            
            for (const [className, classDoc] of Object.entries(this.documentation.classes)) {
                markdown += `### ${className}\n\n`;
                
                if (classDoc.extends) {
                    markdown += `**Estende:** ${classDoc.extends}\n\n`;
                }
                
                if (classDoc.description) {
                    markdown += `${classDoc.description}\n\n`;
                }
                
                markdown += `**Modulo:** ${classDoc.module}\n\n`;
                
                // Aggiungi i metodi
                if (classDoc.methods && classDoc.methods.length > 0) {
                    markdown += '#### Metodi\n\n';
                    
                    for (const method of classDoc.methods) {
                        markdown += `##### ${method.name}(${method.params.map(p => p.name).join(', ')})\n\n`;
                        
                        if (method.description) {
                            markdown += `${method.description}\n\n`;
                        }
                        
                        // Aggiungi i parametri
                        if (method.params && method.params.length > 0) {
                            markdown += '**Parametri:**\n\n';
                            
                            for (const param of method.params) {
                                markdown += `- \`${param.name}\``;
                                
                                if (param.defaultValue) {
                                    markdown += ` (default: ${param.defaultValue})`;
                                }
                                
                                markdown += '\n';
                            }
                            
                            markdown += '\n';
                        }
                    }
                }
            }
            
            // Aggiungi le funzioni
            markdown += '## Funzioni\n\n';
            
            for (const [functionName, functionDoc] of Object.entries(this.documentation.functions)) {
                markdown += `### ${functionName}(${functionDoc.params.map(p => p.name).join(', ')})\n\n`;
                
                if (functionDoc.description) {
                    markdown += `${functionDoc.description}\n\n`;
                }
                
                markdown += `**Modulo:** ${functionDoc.module}\n\n`;
                
                // Aggiungi i parametri
                if (functionDoc.params && functionDoc.params.length > 0) {
                    markdown += '**Parametri:**\n\n';
                    
                    for (const param of functionDoc.params) {
                        markdown += `- \`${param.name}\``;
                        
                        if (param.defaultValue) {
                            markdown += ` (default: ${param.defaultValue})`;
                        }
                        
                        markdown += '\n';
                    }
                    
                    markdown += '\n';
                }
            }
            
            // Scrivi il file
            const outputPath = path.join(this.config.outputDir, 'api.md');
            await fs.writeFile(outputPath, markdown, 'utf8');
            
            return outputPath;
        } catch (error) {
            this.logger.error(`Errore durante la generazione del Markdown: ${error.message}`);
            throw error;
        }
    }

    /**
     * Genera la documentazione in formato HTML
     * @returns {Promise<string>} - Percorso del file generato
     * @private
     */
    async _generateHtml() {
        try {
            // Genera prima il Markdown
            const markdownPath = await this._generateMarkdown();
            const markdown = await fs.readFile(markdownPath, 'utf8');
            
            // Converti il Markdown in HTML
            const html = this._markdownToHtml(markdown);
            
            // Scrivi il file
            const outputPath = path.join(this.config.outputDir, 'api.html');
            await fs.writeFile(outputPath, html, 'utf8');
            
            return outputPath;
        } catch (error) {
            this.logger.error(`Errore durante la generazione dell'HTML: ${error.message}`);
            throw error;
        }
    }

    /**
     * Converte il Markdown in HTML
     * @param {string} markdown - Contenuto Markdown
     * @returns {string} - Contenuto HTML
     * @private
     */
    _markdownToHtml(markdown) {
        // Implementazione semplificata: in un sistema reale, questo utilizzerebbe
        // una libreria come marked o markdown-it
        
        let html = '<!DOCTYPE html>\n<html>\n<head>\n';
        html += '<meta charset="UTF-8">\n';
        html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
        html += '<title>Documentazione API</title>\n';
        html += '<style>\n';
        html += 'body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 900px; margin: 0 auto; padding: 20px; }\n';
        html += 'h1 { border-bottom: 2px solid #eee; padding-bottom: 10px; }\n';
        html += 'h2 { margin-top: 30px; border-bottom: 1px solid #eee; padding-bottom: 5px; }\n';
        html += 'h3 { margin-top: 25px; }\n';
        html += 'h4 { margin-top: 20px; }\n';
        html += 'h5 { margin-top: 15px; }\n';
        html += 'code { background-color: #f5f5f5; padding: 2px 5px; border-radius: 3px; }\n';
        html += 'pre { background-color: #f5f5f5; padding: 10px; border-radius: 5px; overflow-x: auto; }\n';
        html += '</style>\n';
        html += '</head>\n<body>\n';
        
        // Converti i titoli
        html += markdown
            .replace(/^# (.*?)$/gm, '<h1>$1</h1>')
            .replace(/^## (.*?)$/gm, '<h2 id="$1">$1</h2>')
            .replace(/^### (.*?)$/gm, '<h3 id="$1">$1</h3>')
            .replace(/^#### (.*?)$/gm, '<h4>$1</h4>')
            .replace(/^##### (.*?)$/gm, '<h5>$1</h5>')
            
            // Converti i link
            .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>')
            
            // Converti il codice inline
            .replace(/`(.*?)`/g, '<code>$1</code>')
            
            // Converti i blocchi di codice
            .replace(/```(.*?)```/gs, '<pre><code>$1</code></pre>')
            
            // Converti gli elenchi
            .replace(/^- (.*?)$/gm, '<li>$1</li>')
            .replace(/(<li>.*?<\/li>\n)+/gs, '<ul>$&</ul>')
            
            // Converti i paragrafi
            .replace(/^([^<].*?)$/gm, '<p>$1</p>')
            
            // Rimuovi i paragrafi vuoti
            .replace(/<p><\/p>/g, '');
        
        html += '</body>\n</html>';
        
        return html;
    }

    /**
     * Genera la documentazione in formato PDF
     * @returns {Promise<string>} - Percorso del file generato
     * @private
     */
    async _generatePdf() {
        try {
            // Genera prima l'HTML
            const htmlPath = await this._generateHtml();
            
            // Implementazione di esempio: in un sistema reale, questo utilizzerebbe
            // una libreria come puppeteer o wkhtmltopdf
            this.logger.info('Generazione PDF non implementata completamente');
            this.logger.info(`Per generare il PDF, utilizzare l'HTML generato: ${htmlPath}`);
            
            // Simula la generazione del PDF
            const outputPath = path.join(this.config.outputDir, 'api.pdf');
            await fs.writeFile(outputPath, 'PDF placeholder', 'utf8');
            
            return outputPath;
        } catch (error) {
            this.logger.error(`Errore durante la generazione del PDF: ${error.message}`);
            throw error;
        }
    }

    /**
     * Genera la documentazione di un singolo componente
     * @param {string} componentType - Tipo di componente (module, class, function)
     * @param {string} componentName - Nome del componente
     * @param {string} format - Formato di output
     * @returns {Promise<string>} - Documentazione generata
     */
    async generateComponentDocumentation(componentType, componentName, format = 'markdown') {
        if (!this.isInitialized) {
            throw new Error('Il generatore di documentazione non è inizializzato');
        }
        
        // Verifica se il componente esiste
        const component = this.documentation[`${componentType}s`]?.[componentName];
        
        if (!component) {
            throw new Error(`Componente non trovato: ${componentType} ${componentName}`);
        }
        
        try {
            let content = '';
            
            switch (format.toLowerCase()) {
                case 'markdown':
                    content = this._generateComponentMarkdown(componentType, component);
                    break;
                case 'html':
                    const markdown = this._generateComponentMarkdown(componentType, component);
                    content = this._markdownToHtml(markdown);
                    break;
                default:
                    throw new Error(`Formato non supportato: ${format}`);
            }
            
            // Scrivi il file
            const outputPath = path.join(
                this.config.outputDir,
                `${componentType}_${componentName}.${format === 'html' ? 'html' : 'md'}`
            );
            
            await fs.writeFile(outputPath, content, 'utf8');
            
            return outputPath;
        } catch (error) {
            this.logger.error(`Errore durante la generazione della documentazione del componente: ${error.message}`);
            throw error;
        }
    }

    /**
     * Genera la documentazione Markdown di un singolo componente
     * @param {string} componentType - Tipo di componente
     * @param {Object} component - Componente
     * @returns {string} - Documentazione Markdown
     * @private
     */
    _generateComponentMarkdown(componentType, component) {
        let markdown = '';
        
        switch (componentType) {
            case 'module':
                markdown += `# Modulo: ${component.name}\n\n`;
                
                if (component.description) {
                    markdown += `${component.description}\n\n`;
                }
                
                markdown += `**File:** \`${component.path}\`\n\n`;
                break;
                
            case 'class':
                markdown += `# Classe: ${component.name}\n\n`;
                
                if (component.extends) {
                    markdown += `**Estende:** ${component.extends}\n\n`;
                }
                
                if (component.description) {
                    markdown += `${component.description}\n\n`;
                }
                
                markdown += `**Modulo:** ${component.module}\n\n`;
                
                // Aggiungi i metodi
                if (component.methods && component.methods.length > 0) {
                    markdown += '## Metodi\n\n';
                    
                    for (const method of component.methods) {
                        markdown += `### ${method.name}(${method.params.map(p => p.name).join(', ')})\n\n`;
                        
                        if (method.description) {
                            markdown += `${method.description}\n\n`;
                        }
                        
                        // Aggiungi i parametri
                        if (method.params && method.params.length > 0) {
                            markdown += '**Parametri:**\n\n';
                            
                            for (const param of method.params) {
                                markdown += `- \`${param.name}\``;
                                
                                if (param.defaultValue) {
                                    markdown += ` (default: ${param.defaultValue})`;
                                }
                                
                                markdown += '\n';
                            }
                            
                            markdown += '\n';
                        }
                    }
                }
                break;
                
            case 'function':
                markdown += `# Funzione: ${component.name}\n\n`;
                
                if (component.description) {
                    markdown += `${component.description}\n\n`;
                }
                
                markdown += `**Modulo:** ${component.module}\n\n`;
                
                // Aggiungi i parametri
                if (component.params && component.params.length > 0) {
                    markdown += '**Parametri:**\n\n';
                    
                    for (const param of component.params) {
                        markdown += `- \`${param.name}\``;
                        
                        if (param.defaultValue) {
                            markdown += ` (default: ${param.defaultValue})`;
                        }
                        
                        markdown += '\n';
                    }
                    
                    markdown += '\n';
                }
                break;
        }
        
        return markdown;
    }
}

module.exports = { DocumentationGenerator };
