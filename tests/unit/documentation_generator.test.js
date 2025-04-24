/**
 * Test unitari per il Documentation Generator
 */

const { DocumentationGenerator } = require('../../offchain/documentation-generator');
const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const fs = require('fs').promises;

describe('DocumentationGenerator', () => {
    let documentationGenerator;
    let tempDir;
    let sourceDir;
    let outputDir;
    
    beforeEach(async () => {
        // Crea una directory temporanea per i test
        tempDir = path.join(__dirname, '..', '..', 'temp-test-' + Date.now());
        sourceDir = path.join(tempDir, 'src');
        outputDir = path.join(tempDir, 'docs');
        
        await fs.mkdir(tempDir, { recursive: true });
        await fs.mkdir(sourceDir, { recursive: true });
        await fs.mkdir(outputDir, { recursive: true });
        
        // Crea un file di esempio per i test
        const sampleFile = path.join(sourceDir, 'sample.js');
        await fs.writeFile(sampleFile, `
            /**
             * Modulo di esempio
             * 
             * Questo è un modulo di esempio per i test.
             */
            
            /**
             * Classe di esempio
             */
            class SampleClass {
                /**
                 * Costruttore
                 * @param {Object} config - Configurazione
                 */
                constructor(config = {}) {
                    this.config = config;
                }
                
                /**
                 * Metodo di esempio
                 * @param {string} param1 - Primo parametro
                 * @param {number} param2 - Secondo parametro
                 * @returns {boolean} - Risultato
                 */
                sampleMethod(param1, param2) {
                    return true;
                }
            }
            
            /**
             * Funzione di esempio
             * @param {string} param - Parametro
             * @returns {string} - Risultato
             */
            function sampleFunction(param) {
                return param;
            }
            
            module.exports = { SampleClass, sampleFunction };
        `);
        
        // Crea un'istanza di DocumentationGenerator con configurazione di test
        documentationGenerator = new DocumentationGenerator({
            sourceDir,
            outputDir,
            formats: ['markdown', 'html'],
            logger: {
                info: sinon.spy(),
                warn: sinon.spy(),
                error: sinon.spy(),
                debug: sinon.spy()
            }
        });
        
        // Inizializza il generatore
        await documentationGenerator.initialize();
    });
    
    afterEach(async () => {
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
        it('dovrebbe inizializzare correttamente il generatore', () => {
            expect(documentationGenerator.isInitialized).to.be.true;
            expect(documentationGenerator.documentation).to.be.an('object');
        });
    });
    
    describe('generateDocumentation()', () => {
        it('dovrebbe generare la documentazione correttamente', async () => {
            const results = await documentationGenerator.generateDocumentation();
            
            expect(results).to.be.an('object');
            expect(results.analyzedFiles).to.equal(1);
            expect(results.outputs).to.be.an('object');
            expect(results.outputs.markdown).to.be.a('string');
            expect(results.outputs.html).to.be.a('string');
            
            // Verifica che i file di output esistano
            const markdownExists = await fileExists(results.outputs.markdown);
            const htmlExists = await fileExists(results.outputs.html);
            
            expect(markdownExists).to.be.true;
            expect(htmlExists).to.be.true;
        });
        
        it('dovrebbe lanciare un errore se il generatore non è inizializzato', async () => {
            const uninitializedGenerator = new DocumentationGenerator({
                sourceDir,
                outputDir
            });
            
            try {
                await uninitializedGenerator.generateDocumentation();
                
                // La funzione dovrebbe lanciare un errore, quindi non dovremmo arrivare qui
                expect.fail('La funzione non ha lanciato un errore');
            } catch (error) {
                expect(error.message).to.include('non è inizializzato');
            }
        });
        
        it('dovrebbe rispettare le opzioni di esclusione', async () => {
            // Crea un altro file che dovrebbe essere escluso
            const excludedFile = path.join(sourceDir, 'excluded.js');
            await fs.writeFile(excludedFile, `
                /**
                 * Questo file dovrebbe essere escluso
                 */
                function excludedFunction() {
                    return true;
                }
                
                module.exports = { excludedFunction };
            `);
            
            const results = await documentationGenerator.generateDocumentation({
                exclude: ['excluded.js']
            });
            
            expect(results.analyzedFiles).to.equal(1);
        });
    });
    
    describe('generateComponentDocumentation()', () => {
        it('dovrebbe generare la documentazione di un singolo componente', async () => {
            // Prima genera la documentazione completa per popolare il registro
            await documentationGenerator.generateDocumentation();
            
            // Poi genera la documentazione di un singolo componente
            const outputPath = await documentationGenerator.generateComponentDocumentation('class', 'SampleClass');
            
            expect(outputPath).to.be.a('string');
            
            // Verifica che il file di output esista
            const fileExists = await fs.access(outputPath).then(() => true).catch(() => false);
            
            expect(fileExists).to.be.true;
        });
        
        it('dovrebbe lanciare un errore se il componente non esiste', async () => {
            // Prima genera la documentazione completa per popolare il registro
            await documentationGenerator.generateDocumentation();
            
            try {
                await documentationGenerator.generateComponentDocumentation('class', 'NonExistentClass');
                
                // La funzione dovrebbe lanciare un errore, quindi non dovremmo arrivare qui
                expect.fail('La funzione non ha lanciato un errore');
            } catch (error) {
                expect(error.message).to.include('Componente non trovato');
            }
        });
    });
    
    // Funzione di utilità per verificare se un file esiste
    async function fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch (error) {
            return false;
        }
    }
});
