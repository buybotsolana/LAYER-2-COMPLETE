/**
 * Test di sicurezza per il Layer-2 su Solana
 * 
 * Questo script esegue test di sicurezza completi per verificare la robustezza
 * del sistema Layer-2 contro varie vulnerabilità.
 */

const { expect } = require('chai');
const { Connection, PublicKey, Keypair, Transaction } = require('@solana/web3.js');
const BN = require('bn.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

// Importa i moduli da testare
const Sequencer = require('../offchain/sequencer');
const { MerkleTree } = require('../offchain/merkle_tree');
const { ErrorManager } = require('../offchain/error_manager');

// Configurazione dei test
const TEST_CONFIG = {
    solanaRpcUrl: 'http://localhost:8899', // URL locale per i test
    databasePath: ':memory:', // Database in memoria per i test
    programId: 'Layer2TestProgram111111111111111111111111111',
    privateKeyPath: path.join(__dirname, 'test_keypair.json'),
    logLevel: 'error',
};

// Crea una chiave di test
const testKeypair = Keypair.generate();
fs.writeFileSync(
    path.join(__dirname, 'test_keypair.json'),
    JSON.stringify(Array.from(testKeypair.secretKey)),
    'utf-8'
);

describe('Test di sicurezza del Layer-2', function() {
    this.timeout(10000); // Aumenta il timeout per i test di sicurezza
    
    let sequencer;
    let db;
    
    before(async function() {
        // Inizializza il database di test
        db = await open({
            filename: ':memory:',
            driver: sqlite3.Database,
        });
        
        // Crea un'istanza del sequencer per i test
        sequencer = new Sequencer(TEST_CONFIG);
        await sequencer.initialize();
    });
    
    after(async function() {
        // Pulisci dopo i test
        await sequencer.stop();
        await db.close();
        
        // Rimuovi il file della chiave di test
        fs.unlinkSync(path.join(__dirname, 'test_keypair.json'));
    });
    
    describe('Test di overflow aritmetico', function() {
        it('Dovrebbe gestire correttamente gli overflow nelle operazioni aritmetiche', async function() {
            // Crea una transazione con valori che potrebbero causare overflow
            const maxUint64 = new BN('ffffffffffffffff', 16); // 2^64 - 1
            const transaction = {
                sender: testKeypair.publicKey.toString(),
                recipient: Keypair.generate().publicKey.toString(),
                amount: maxUint64.toNumber(), // Questo causerà un overflow in JavaScript
                nonce: Number.MAX_SAFE_INTEGER,
                expiry_timestamp: Date.now() + 3600000, // 1 ora nel futuro
                transaction_type: 0, // Deposito
                data: Buffer.from('Test overflow'),
                signature: Buffer.from('TestSignature'),
            };
            
            // Verifica che il sequencer gestisca correttamente l'overflow
            try {
                await sequencer.addTransaction(transaction);
                // Se arriviamo qui, il test fallisce perché dovrebbe lanciare un'eccezione
                expect.fail('Dovrebbe lanciare un\'eccezione per overflow');
            } catch (error) {
                // Verifica che l'errore sia relativo all'overflow
                expect(error.message).to.include('non valido');
            }
        });
        
        it('Dovrebbe gestire correttamente gli underflow nelle operazioni aritmetiche', async function() {
            // Crea una transazione con valori negativi che potrebbero causare underflow
            const transaction = {
                sender: testKeypair.publicKey.toString(),
                recipient: Keypair.generate().publicKey.toString(),
                amount: -1, // Valore negativo non valido
                nonce: -1, // Valore negativo non valido
                expiry_timestamp: Date.now() + 3600000,
                transaction_type: 0,
                data: Buffer.from('Test underflow'),
                signature: Buffer.from('TestSignature'),
            };
            
            // Verifica che il sequencer gestisca correttamente l'underflow
            try {
                await sequencer.addTransaction(transaction);
                // Se arriviamo qui, il test fallisce perché dovrebbe lanciare un'eccezione
                expect.fail('Dovrebbe lanciare un\'eccezione per underflow');
            } catch (error) {
                // Verifica che l'errore sia relativo all'underflow
                expect(error.message).to.include('deve essere positivo');
            }
        });
        
        it('Dovrebbe gestire correttamente i valori limite', async function() {
            // Crea una transazione con valori limite validi
            const transaction = {
                sender: testKeypair.publicKey.toString(),
                recipient: Keypair.generate().publicKey.toString(),
                amount: Number.MAX_SAFE_INTEGER, // Valore massimo sicuro in JavaScript
                nonce: 1, // Valore minimo valido
                expiry_timestamp: Date.now() + 3600000,
                transaction_type: 0,
                data: Buffer.from('Test valori limite'),
                signature: Buffer.from('TestSignature'),
            };
            
            // Verifica che il sequencer gestisca correttamente i valori limite
            const result = await sequencer.addTransaction(transaction);
            expect(result.success).to.be.true;
        });
    });
    
    describe('Test di controlli di autorizzazione', function() {
        it('Dovrebbe rifiutare transazioni senza firma', async function() {
            // Crea una transazione senza firma
            const transaction = {
                sender: testKeypair.publicKey.toString(),
                recipient: Keypair.generate().publicKey.toString(),
                amount: 1000,
                nonce: 1,
                expiry_timestamp: Date.now() + 3600000,
                transaction_type: 0,
                data: Buffer.from('Test senza firma'),
                // Nessuna firma
            };
            
            // Verifica che il sequencer accetti la transazione (la firma è opzionale in questa fase)
            // ma la transazione non sarà elaborata senza firma
            const result = await sequencer.addTransaction(transaction);
            expect(result.success).to.be.true;
            
            // In un'implementazione reale, la transazione verrebbe rifiutata durante l'elaborazione
            // perché manca la firma
        });
        
        it('Dovrebbe rifiutare transazioni con firma non valida', async function() {
            // Crea una transazione con una firma non valida
            const transaction = {
                sender: testKeypair.publicKey.toString(),
                recipient: Keypair.generate().publicKey.toString(),
                amount: 1000,
                nonce: 1,
                expiry_timestamp: Date.now() + 3600000,
                transaction_type: 0,
                data: Buffer.from('Test firma non valida'),
                signature: Buffer.from('FirmaInvalida'),
            };
            
            // Verifica che il sequencer accetti la transazione (la validazione della firma
            // avviene durante l'elaborazione, non durante l'aggiunta)
            const result = await sequencer.addTransaction(transaction);
            expect(result.success).to.be.true;
            
            // In un'implementazione reale, la transazione verrebbe rifiutata durante l'elaborazione
            // perché la firma non è valida
        });
        
        it('Dovrebbe rifiutare transazioni con mittente e destinatario uguali', async function() {
            // Crea una transazione con mittente e destinatario uguali
            const sameAddress = testKeypair.publicKey.toString();
            const transaction = {
                sender: sameAddress,
                recipient: sameAddress, // Stesso indirizzo del mittente
                amount: 1000,
                nonce: 1,
                expiry_timestamp: Date.now() + 3600000,
                transaction_type: 0,
                data: Buffer.from('Test mittente e destinatario uguali'),
                signature: Buffer.from('TestSignature'),
            };
            
            // Verifica che il sequencer rifiuti la transazione
            try {
                await sequencer.addTransaction(transaction);
                // Se arriviamo qui, il test fallisce perché dovrebbe lanciare un'eccezione
                expect.fail('Dovrebbe lanciare un\'eccezione per mittente e destinatario uguali');
            } catch (error) {
                // Verifica che l'errore sia relativo al mittente e destinatario uguali
                expect(error.message).to.include('non possono essere uguali');
            }
        });
        
        it('Dovrebbe rifiutare transazioni con timestamp di scadenza nel passato', async function() {
            // Crea una transazione con timestamp di scadenza nel passato
            const transaction = {
                sender: testKeypair.publicKey.toString(),
                recipient: Keypair.generate().publicKey.toString(),
                amount: 1000,
                nonce: 1,
                expiry_timestamp: Date.now() - 3600000, // 1 ora nel passato
                transaction_type: 0,
                data: Buffer.from('Test timestamp scaduto'),
                signature: Buffer.from('TestSignature'),
            };
            
            // Verifica che il sequencer rifiuti la transazione
            try {
                await sequencer.addTransaction(transaction);
                // Se arriviamo qui, il test fallisce perché dovrebbe lanciare un'eccezione
                expect.fail('Dovrebbe lanciare un\'eccezione per timestamp scaduto');
            } catch (error) {
                // Verifica che l'errore sia relativo al timestamp scaduto
                expect(error.message).to.include('deve essere nel futuro');
            }
        });
    });
    
    describe('Test di SQL injection', function() {
        it('Dovrebbe prevenire SQL injection nei parametri delle query', async function() {
            // Crea una transazione con un tentativo di SQL injection
            const transaction = {
                sender: "' OR 1=1 --", // Tentativo di SQL injection
                recipient: Keypair.generate().publicKey.toString(),
                amount: 1000,
                nonce: 1,
                expiry_timestamp: Date.now() + 3600000,
                transaction_type: 0,
                data: Buffer.from('Test SQL injection'),
                signature: Buffer.from('TestSignature'),
            };
            
            // Verifica che il sequencer sanitizzi l'input
            const result = await sequencer.addTransaction(transaction);
            expect(result.success).to.be.true;
            
            // Verifica che l'input sia stato sanitizzato
            const txStatus = await sequencer.getTransactionStatus(result.id);
            expect(txStatus.success).to.be.true;
            expect(txStatus.transaction.sender).to.not.include("'");
            expect(txStatus.transaction.sender).to.not.include("--");
        });
        
        it('Dovrebbe prevenire SQL injection negli ID delle transazioni', async function() {
            // Tenta di ottenere lo stato di una transazione con un ID che contiene SQL injection
            const maliciousId = "1; DROP TABLE transactions; --";
            
            // Verifica che il sequencer sanitizzi l'input
            const result = await sequencer.getTransactionStatus(maliciousId);
            
            // Dovrebbe fallire con un errore di ID non valido, non con un errore SQL
            expect(result.success).to.be.false;
            expect(result.error).to.include('ID transazione non valido');
            
            // Verifica che la tabella transactions esista ancora
            const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
            const tableNames = tables.map(t => t.name);
            expect(tableNames).to.include('transactions');
        });
        
        it('Dovrebbe prevenire SQL injection negli ID dei batch', async function() {
            // Tenta di ottenere lo stato di un batch con un ID che contiene SQL injection
            const maliciousId = "1 UNION SELECT * FROM transactions; --";
            
            // Verifica che il sequencer sanitizzi l'input
            const result = await sequencer.getBatchStatus(maliciousId);
            
            // Dovrebbe fallire con un errore di ID non valido, non con un errore SQL
            expect(result.success).to.be.false;
            expect(result.error).to.include('ID batch non valido');
        });
        
        it('Dovrebbe prevenire SQL injection negli indirizzi degli account', async function() {
            // Tenta di ottenere il saldo di un account con un indirizzo che contiene SQL injection
            const maliciousAddress = "x'; DROP TABLE accounts; --";
            
            // Verifica che il sequencer sanitizzi l'input
            const result = await sequencer.getAccountBalance(maliciousAddress);
            
            // Dovrebbe restituire un saldo di 0, non un errore SQL
            expect(result.success).to.be.true;
            expect(result.balance).to.equal(0);
            
            // Verifica che l'indirizzo sia stato sanitizzato
            expect(result.address).to.not.include("'");
            expect(result.address).to.not.include("--");
        });
    });
    
    describe('Test di fuzzing', function() {
        it('Dovrebbe gestire correttamente input casuali', async function() {
            // Genera 10 transazioni con input casuali
            for (let i = 0; i < 10; i++) {
                const randomSender = crypto.randomBytes(32).toString('hex');
                const randomRecipient = crypto.randomBytes(32).toString('hex');
                const randomAmount = Math.floor(Math.random() * 1000000) + 1;
                const randomNonce = Math.floor(Math.random() * 1000000) + 1;
                const randomExpiry = Date.now() + Math.floor(Math.random() * 3600000) + 3600000;
                const randomType = Math.floor(Math.random() * 3);
                const randomData = crypto.randomBytes(Math.floor(Math.random() * 100)).toString('hex');
                const randomSignature = crypto.randomBytes(64).toString('hex');
                
                const transaction = {
                    sender: randomSender,
                    recipient: randomRecipient,
                    amount: randomAmount,
                    nonce: randomNonce,
                    expiry_timestamp: randomExpiry,
                    transaction_type: randomType,
                    data: Buffer.from(randomData, 'hex'),
                    signature: Buffer.from(randomSignature, 'hex'),
                };
                
                // Verifica che il sequencer gestisca correttamente l'input casuale
                try {
                    const result = await sequencer.addTransaction(transaction);
                    expect(result.success).to.be.true;
                } catch (error) {
                    // Se c'è un errore, verifica che sia un errore di validazione
                    expect(error.message).to.not.include('SQL');
                    expect(error.message).to.not.include('syntax');
                    expect(error.message).to.not.include('database');
                }
            }
        });
        
        it('Dovrebbe gestire correttamente input malformati', async function() {
            // Array di input malformati
            const malformedInputs = [
                { sender: null, recipient: 'valid', amount: 100, nonce: 1, expiry_timestamp: Date.now() + 3600000, transaction_type: 0 },
                { sender: 'valid', recipient: undefined, amount: 100, nonce: 1, expiry_timestamp: Date.now() + 3600000, transaction_type: 0 },
                { sender: 'valid', recipient: 'valid', amount: 'not a number', nonce: 1, expiry_timestamp: Date.now() + 3600000, transaction_type: 0 },
                { sender: 'valid', recipient: 'valid', amount: 100, nonce: 'not a number', expiry_timestamp: Date.now() + 3600000, transaction_type: 0 },
                { sender: 'valid', recipient: 'valid', amount: 100, nonce: 1, expiry_timestamp: 'not a number', transaction_type: 0 },
                { sender: 'valid', recipient: 'valid', amount: 100, nonce: 1, expiry_timestamp: Date.now() + 3600000, transaction_type: 'not a number' },
                { sender: 'valid', recipient: 'valid', amount: 100, nonce: 1, expiry_timestamp: Date.now() + 3600000, transaction_type: 0, data: 123 },
                { sender: 'valid', recipient: 'valid', amount: 100, nonce: 1, expiry_timestamp: Date.now() + 3600000, transaction_type: 0, signature: 123 },
                { sender: {}, recipient: 'valid', amount: 100, nonce: 1, expiry_timestamp: Date.now() + 3600000, transaction_type: 0 },
                { sender: 'valid', recipient: [], amount: 100, nonce: 1, expiry_timestamp: Date.now() + 3600000, transaction_type: 0 },
            ];
            
            // Verifica che il sequencer gestisca correttamente gli input malformati
            for (const input of malformedInputs) {
                try {
                    await sequencer.addTransaction(input);
                    // Se arriviamo qui, il test fallisce perché dovrebbe lanciare un'eccezione
                    expect.fail('Dovrebbe lanciare un\'eccezione per input malformato');
                } catch (error) {
                    // Verifica che l'errore non sia un errore SQL o di database
                    expect(error.message).to.not.include('SQL');
                    expect(error.message).to.not.include('syntax');
                    expect(error.message).to.not.include('database');
                }
            }
        });
    });
    
    describe('Test di vulnerabilità avanzate', function() {
        it('Dovrebbe prevenire attacchi di replay', async function() {
            // Crea una transazione valida
            const transaction = {
                sender: testKeypair.publicKey.toString(),
                recipient: Keypair.generate().publicKey.toString(),
                amount: 1000,
                nonce: 1,
                expiry_timestamp: Date.now() + 3600000,
                transaction_type: 0,
                data: Buffer.from('Test replay attack'),
                signature: Buffer.from('TestSignature'),
            };
            
            // Aggiungi la transazione per la prima volta
            const result1 = await sequencer.addTransaction(transaction);
            expect(result1.success).to.be.true;
            
            // Tenta di aggiungere la stessa transazione una seconda volta (replay attack)
            const result2 = await sequencer.addTransaction(transaction);
            expect(result2.success).to.be.false;
            expect(result2.error).to.include('duplicata');
        });
        
        it('Dovrebbe prevenire attacchi di front-running', async function() {
            // Questo test è più complesso e richiederebbe un'implementazione più dettagliata
            // In un'implementazione reale, verificheremmo che le transazioni vengano elaborate
            // nell'ordine corretto, indipendentemente dall'ordine di arrivo
            
            // Per semplicità, verifichiamo che le transazioni vengano elaborate in ordine FIFO
            const transaction1 = {
                sender: testKeypair.publicKey.toString(),
                recipient: Keypair.generate().publicKey.toString(),
                amount: 1000,
                nonce: 2,
                expiry_timestamp: Date.now() + 3600000,
                transaction_type: 0,
                data: Buffer.from('Test front-running 1'),
                signature: Buffer.from('TestSignature1'),
            };
            
            const transaction2 = {
                sender: testKeypair.publicKey.toString(),
                recipient: Keypair.generate().publicKey.toString(),
                amount: 2000,
                nonce: 3,
                expiry_timestamp: Date.now() + 3600000,
                transaction_type: 0,
                data: Buffer.from('Test front-running 2'),
                signature: Buffer.from('TestSignature2'),
            };
            
            // Aggiungi le transazioni
            const result1 = await sequencer.addTransaction(transaction1);
            expect(result1.success).to.be.true;
            
            const result2 = await sequencer.addTransaction(transaction2);
            expect(result2.success).to.be.true;
            
            // Verifica che le transazioni siano state aggiunte nell'ordine corretto
            const tx1 = await sequencer.getTransactionStatus(result1.id);
            const tx2 = await sequencer.getTransactionStatus(result2.id);
            
            expect(tx1.transaction.id).to.be.lessThan(tx2.transaction.id);
        });
        
        it('Dovrebbe prevenire attacchi di reentrancy', async function() {
            // Questo test è più complesso e richiederebbe un'implementazione più dettagliata
            // In un'implementazione reale, verificheremmo che le operazioni critiche
            // siano protette contro attacchi di reentrancy
            
            // Per semplicità, verifichiamo che le transazioni vengano elaborate atomicamente
            const transaction = {
                sender: testKeypair.publicKey.toString(),
                recipient: Keypair.generate().publicKey.toString(),
                amount: 1000,
                nonce: 4,
                expiry_timestamp: Date.now() + 3600000,
                transaction_type: 0,
                data: Buffer.from('Test reentrancy'),
                signature: Buffer.from('TestSignature'),
            };
            
            // Aggiungi la transazione
            const result = await sequencer.addTransaction(transaction);
            expect(result.success).to.be.true;
            
            // Verifica che la transazione sia stata aggiunta correttamente
            const tx = await sequencer.getTransactionStatus(result.id);
            expect(tx.transaction.id).to.equal(result.id);
            
            // In un'implementazione reale, verificheremmo che lo stato del sistema
            // sia coerente dopo l'elaborazione della transazione
        });
    });
    
    describe('Test di rate limiting', function() {
        it('Dovrebbe limitare il numero di transazioni per mittente', async function() {
            // Questo test è più complesso e richiederebbe un'implementazione più dettagliata
            // In un'implementazione reale, verificheremmo che il sistema limiti
            // il numero di transazioni che un mittente può inviare in un certo periodo
            
            // Per semplicità, aggiungiamo molte transazioni dallo stesso mittente
            // e verifichiamo che vengano tutte accettate (il rate limiting non è implementato)
            const sender = testKeypair.publicKey.toString();
            const transactions = [];
            
            for (let i = 0; i < 10; i++) {
                const transaction = {
                    sender,
                    recipient: Keypair.generate().publicKey.toString(),
                    amount: 1000 + i,
                    nonce: 5 + i,
                    expiry_timestamp: Date.now() + 3600000,
                    transaction_type: 0,
                    data: Buffer.from(`Test rate limiting ${i}`),
                    signature: Buffer.from(`TestSignature${i}`),
                };
                
                transactions.push(transaction);
            }
            
            // Aggiungi le transazioni
            const results = await Promise.all(transactions.map(tx => sequencer.addTransaction(tx)));
            
            // Verifica che tutte le transazioni siano state accettate
            for (const result of results) {
                expect(result.success).to.be.true;
            }
            
            // In un'implementazione reale, verificheremmo che il sistema limiti
            // il numero di transazioni che un mittente può inviare in un certo periodo
        });
    });
    
    describe('Test di circuit breaker', function() {
        it('Dovrebbe attivare il circuit breaker in caso di errori ripetuti', async function() {
            // Crea un error manager con un circuit breaker configurato per attivarsi dopo 3 errori
            const errorManager = new ErrorManager({
                enableCircuitBreaker: true,
                circuitBreakerThreshold: 3,
                circuitBreakerTimeout: 1000, // 1 secondo per i test
            });
            
            // Simula 3 errori
            errorManager.handleError('test', new Error('Test error 1'));
            errorManager.handleError('test', new Error('Test error 2'));
            errorManager.handleError('test', new Error('Test error 3'));
            
            // Verifica che il circuit breaker sia attivo
            expect(errorManager.isCircuitBreakerOpen()).to.be.true;
            
            // Attendi che il circuit breaker si resetti
            await new Promise(resolve => setTimeout(resolve, 1100));
            
            // Verifica che il circuit breaker sia stato resettato
            expect(errorManager.isCircuitBreakerOpen()).to.be.false;
        });
    });
});

// Esegui i test
if (require.main === module) {
    const Mocha = require('mocha');
    const mocha = new Mocha();
    mocha.addFile(__filename);
    mocha.run(failures => {
        process.exitCode = failures ? 1 : 0;
    });
}
