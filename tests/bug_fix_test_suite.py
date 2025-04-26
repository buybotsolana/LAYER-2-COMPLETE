#!/usr/bin/env python3

import os
import sys
import json
import time
import subprocess
import threading
import requests
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Any, Optional, Tuple

"""
Bug Fix Test Suite per Layer-2 su Solana

Questo script implementa test specifici per riprodurre e verificare le correzioni
dei bug identificati nel sistema Layer-2 su Solana.

Autore: Manus
Data: 26 Aprile 2025
"""

# Colori per l'output
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
BLUE = "\033[94m"
RESET = "\033[0m"

def print_header(message: str) -> None:
    """Stampa un'intestazione formattata."""
    print(f"\n{BLUE}{'=' * 80}{RESET}")
    print(f"{BLUE}== {message}{RESET}")
    print(f"{BLUE}{'=' * 80}{RESET}\n")

def print_success(message: str) -> None:
    """Stampa un messaggio di successo."""
    print(f"{GREEN}✓ {message}{RESET}")

def print_warning(message: str) -> None:
    """Stampa un messaggio di avviso."""
    print(f"{YELLOW}⚠ {message}{RESET}")

def print_error(message: str) -> None:
    """Stampa un messaggio di errore."""
    print(f"{RED}✗ {message}{RESET}")

def print_info(message: str) -> None:
    """Stampa un messaggio informativo."""
    print(f"{BLUE}ℹ {message}{RESET}")

class BugFixTestSuite:
    """Suite di test per la verifica delle correzioni dei bug."""

    def __init__(self, project_dir: str):
        """Inizializza la suite di test."""
        self.project_dir = project_dir
        self.results = {}
        self.test_count = 0
        self.pass_count = 0
        self.fail_count = 0

    def run_command(self, command: str, cwd: str = None, timeout: int = 30) -> Tuple[bool, str]:
        """Esegue un comando shell e restituisce l'output."""
        try:
            if cwd is None:
                cwd = self.project_dir
            
            result = subprocess.run(
                command,
                shell=True,
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            
            success = result.returncode == 0
            output = result.stdout if success else result.stderr
            
            return success, output
        except subprocess.TimeoutExpired:
            return False, f"Comando scaduto dopo {timeout} secondi: {command}"
        except Exception as e:
            return False, f"Errore durante l'esecuzione del comando: {e}"

    def test_block_finalization_deadlock(self) -> bool:
        """Test per il deadlock nella finalizzazione dei blocchi."""
        print_header("Test: Deadlock nella finalizzazione dei blocchi")
        
        # Compila il modulo di finalizzazione
        print_info("Compilazione del modulo di finalizzazione...")
        success, output = self.run_command("cargo test --package layer2-solana --lib finalization::block_finalization -- --nocapture")
        
        if not success:
            print_error(f"Errore durante la compilazione: {output}")
            return False
        
        # Esegui il test che riproduce il deadlock
        print_info("Esecuzione del test di finalizzazione concorrente...")
        
        # Creiamo un test che esegue finalizzazioni concorrenti
        test_code = """
        use std::thread;
        use std::sync::{Arc, Mutex};
        use layer2_solana::finalization::block_finalization::BlockFinalization;

        #[test]
        fn test_concurrent_finalization() {
            let finalization = Arc::new(Mutex::new(BlockFinalization::new(10)));
            
            // Proponi 10 blocchi
            {
                let mut fin = finalization.lock().unwrap();
                for i in 1..=10 {
                    fin.propose_block(i, [i as u8; 32], [i as u8; 32], [0; 32]).unwrap();
                }
            }
            
            // Crea 5 thread che tentano di finalizzare i blocchi contemporaneamente
            let mut handles = vec![];
            for _ in 0..5 {
                let fin_clone = Arc::clone(&finalization);
                let handle = thread::spawn(move || {
                    let mut fin = fin_clone.lock().unwrap();
                    fin.finalize_blocks().unwrap();
                });
                handles.push(handle);
            }
            
            // Attendi che tutti i thread completino
            for handle in handles {
                handle.join().unwrap();
            }
            
            // Verifica che tutti i blocchi siano stati finalizzati
            let fin = finalization.lock().unwrap();
            for i in 1..=10 {
                let block = fin.get_block(i).unwrap();
                assert_eq!(block.status, BlockStatus::Finalized);
            }
        }
        """
        
        # Scrivi il test in un file temporaneo
        with open(f"{self.project_dir}/tests/temp_finalization_test.rs", "w") as f:
            f.write(test_code)
        
        # Esegui il test
        success, output = self.run_command("cargo test --test temp_finalization_test -- --nocapture")
        
        # Verifica se il test ha rilevato il deadlock
        if "thread 'main' panicked at 'Block" in output and "finalization deadlocked" in output:
            print_error("Test fallito: Deadlock rilevato nella finalizzazione dei blocchi")
            print_info("Questo è il bug che dobbiamo correggere")
            return False
        elif success:
            print_success("Test superato: Nessun deadlock rilevato nella finalizzazione dei blocchi")
            return True
        else:
            print_error(f"Errore durante l'esecuzione del test: {output}")
            return False

    def test_bridge_connection_error(self) -> bool:
        """Test per gli errori di connessione nel bridge."""
        print_header("Test: Errori di connessione nel Bridge")
        
        # Avvia un validator Layer-2 simulato che non risponde
        print_info("Avvio di un validator Layer-2 simulato che non risponde...")
        
        # Esegui il test di deposito che dovrebbe fallire per errore di connessione
        print_info("Esecuzione del test di deposito...")
        
        # Creiamo un test che tenta di connettersi al validator Layer-2
        test_code = """
        const { expect } = require('chai');
        const { BridgeClient } = require('../src/bridge/bridge_client');

        describe('Bridge Connection Test', () => {
            it('should handle connection errors gracefully', async () => {
                const bridge = new BridgeClient({
                    layer2Url: 'http://localhost:8999', // URL non raggiungibile
                    timeout: 2000 // Timeout breve per accelerare il test
                });
                
                try {
                    await bridge.deposit({
                        token: '0x0000000000000000000000000000000000000000',
                        amount: '1000000000000000000',
                        recipient: '0x1234567890123456789012345678901234567890'
                    });
                    // Se arriviamo qui, il test è fallito perché non dovrebbe connettersi
                    throw new Error('Expected connection error but got success');
                } catch (error) {
                    // Verifichiamo che l'errore sia di tipo ConnectionRefusedError
                    expect(error.message).to.include('ConnectionRefusedError');
                    // Ma non dovrebbe crashare l'applicazione
                    expect(bridge.isAlive()).to.be.true;
                }
            });
        });
        """
        
        # Scrivi il test in un file temporaneo
        with open(f"{self.project_dir}/tests/temp_bridge_connection_test.js", "w") as f:
            f.write(test_code)
        
        # Esegui il test
        success, output = self.run_command("npx mocha tests/temp_bridge_connection_test.js")
        
        # Verifica se il test ha rilevato l'errore di connessione
        if "ConnectionRefusedError" in output and "unable to connect to Layer-2 validator" in output:
            print_error("Test fallito: Errore di connessione rilevato nel bridge")
            print_info("Questo è il bug che dobbiamo correggere")
            return False
        elif success:
            print_success("Test superato: Il bridge gestisce correttamente gli errori di connessione")
            return True
        else:
            print_error(f"Errore durante l'esecuzione del test: {output}")
            return False

    def test_sequencer_deadlock(self) -> bool:
        """Test per il deadlock nel sequencer."""
        print_header("Test: Deadlock nel Sequencer")
        
        # Compila il modulo del sequencer
        print_info("Compilazione del modulo del sequencer...")
        success, output = self.run_command("git checkout high-performance-architecture && npm install && npm run build")
        
        if not success:
            print_error(f"Errore durante la compilazione: {output}")
            return False
        
        # Esegui il test che riproduce il deadlock
        print_info("Esecuzione del test di transazioni concorrenti...")
        
        # Creiamo un test che invia transazioni concorrenti al sequencer
        test_code = """
        const { expect } = require('chai');
        const { Sequencer } = require('../src/sequencer');
        const { Transaction } = require('../src/transaction');

        describe('Sequencer Deadlock Test', () => {
            it('should handle concurrent transactions without deadlock', async function() {
                this.timeout(10000); // Aumenta il timeout a 10 secondi
                
                const sequencer = new Sequencer();
                await sequencer.start();
                
                // Crea 100 transazioni
                const transactions = [];
                for (let i = 0; i < 100; i++) {
                    transactions.push(new Transaction({
                        from: `0x${i.toString(16).padStart(40, '0')}`,
                        to: `0x${(i+1).toString(16).padStart(40, '0')}`,
                        value: '1000000000000000000',
                        nonce: i
                    }));
                }
                
                // Invia le transazioni in parallelo
                const promises = transactions.map(tx => sequencer.addTransaction(tx));
                
                // Se c'è un deadlock, questo non completerà mai
                await Promise.all(promises);
                
                // Verifica che tutte le transazioni siano state elaborate
                expect(sequencer.getProcessedTransactionCount()).to.equal(100);
                
                await sequencer.stop();
            });
        });
        """
        
        # Scrivi il test in un file temporaneo
        with open(f"{self.project_dir}/tests/temp_sequencer_deadlock_test.js", "w") as f:
            f.write(test_code)
        
        # Esegui il test
        success, output = self.run_command("npx mocha tests/temp_sequencer_deadlock_test.js")
        
        # Verifica se il test ha rilevato il deadlock
        if "Deadlock detected in Sequencer.js" in output:
            print_error("Test fallito: Deadlock rilevato nel sequencer")
            print_info("Questo è il bug che dobbiamo correggere")
            return False
        elif success:
            print_success("Test superato: Nessun deadlock rilevato nel sequencer")
            return True
        else:
            print_error(f"Errore durante l'esecuzione del test: {output}")
            return False

    def test_double_spend(self) -> bool:
        """Test per il problema di double-spend nel bridge."""
        print_header("Test: Double-Spend nel Bridge")
        
        # Compila il modulo del bridge
        print_info("Compilazione del modulo del bridge...")
        success, output = self.run_command("git checkout high-performance-architecture && npm install && npm run build")
        
        if not success:
            print_error(f"Errore durante la compilazione: {output}")
            return False
        
        # Esegui il test che riproduce il double-spend
        print_info("Esecuzione del test di depositi paralleli...")
        
        # Creiamo un test che tenta di eseguire depositi paralleli con lo stesso nonce
        test_code = """
        const { expect } = require('chai');
        const { BridgeClient } = require('../src/bridge/bridge_client');

        describe('Bridge Double-Spend Test', () => {
            it('should prevent double-spend with parallel deposits', async function() {
                this.timeout(10000); // Aumenta il timeout a 10 secondi
                
                const bridge = new BridgeClient({
                    layer2Url: 'http://localhost:8999',
                    mockMode: true // Usa la modalità mock per il test
                });
                
                // Crea due depositi identici
                const deposit1 = {
                    token: '0x0000000000000000000000000000000000000000',
                    amount: '1000000000000000000',
                    recipient: '0x1234567890123456789012345678901234567890',
                    nonce: 42 // Stesso nonce
                };
                
                const deposit2 = { ...deposit1 }; // Copia esatta
                
                // Invia i depositi in parallelo
                const promise1 = bridge.deposit(deposit1);
                const promise2 = bridge.deposit(deposit2);
                
                // Almeno uno dei depositi dovrebbe fallire
                try {
                    await Promise.all([promise1, promise2]);
                    // Se entrambi hanno successo, il test è fallito
                    throw new Error('Expected nonce collision error but got success for both deposits');
                } catch (error) {
                    // Verifichiamo che l'errore sia di tipo NonceCollisionError
                    expect(error.message).to.include('NonceCollisionError');
                }
            });
        });
        """
        
        # Scrivi il test in un file temporaneo
        with open(f"{self.project_dir}/tests/temp_bridge_double_spend_test.js", "w") as f:
            f.write(test_code)
        
        # Esegui il test
        success, output = self.run_command("npx mocha tests/temp_bridge_double_spend_test.js")
        
        # Verifica se il test ha rilevato il double-spend
        if "NonceCollisionError: Deposit transaction repeated for nonce" in output:
            print_error("Test fallito: Double-spend rilevato nel bridge")
            print_info("Questo è il bug che dobbiamo correggere")
            return False
        elif success:
            print_success("Test superato: Il bridge previene correttamente il double-spend")
            return True
        else:
            print_error(f"Errore durante l'esecuzione del test: {output}")
            return False

    def test_balance_overflow(self) -> bool:
        """Test per l'overflow nei bilanci."""
        print_header("Test: Overflow nei bilanci")
        
        # Compila il modulo di trasferimento
        print_info("Compilazione del modulo di trasferimento...")
        success, output = self.run_command("git checkout performance-optimizations && npm install && npm run build")
        
        if not success:
            print_error(f"Errore durante la compilazione: {output}")
            return False
        
        # Esegui il test che riproduce l'overflow
        print_info("Esecuzione del test di trasferimento con valori grandi...")
        
        # Creiamo un test che tenta di eseguire un trasferimento con valori grandi
        test_code = """
        const { expect } = require('chai');
        const { TransferService } = require('../src/transfer/transfer_service');
        const { Account } = require('../src/account/account');

        describe('Balance Overflow Test', () => {
            it('should handle large transfers without overflow', async () => {
                const transferService = new TransferService();
                
                // Crea due account
                const account1 = new Account('0x1234567890123456789012345678901234567890');
                const account2 = new Account('0x0987654321098765432109876543210987654321');
                
                // Imposta un saldo molto grande per account1
                account1.setBalance('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
                
                // Esegui un trasferimento
                await transferService.transfer({
                    from: account1,
                    to: account2,
                    amount: '0x1000000000000000000000000000000000000000000000000000000000000000'
                });
                
                // Verifica che i saldi siano corretti
                expect(account1.getBalance()).to.equal('0xeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
                expect(account2.getBalance()).to.equal('0x1000000000000000000000000000000000000000000000000000000000000000');
            });
        });
        """
        
        # Scrivi il test in un file temporaneo
        with open(f"{self.project_dir}/tests/temp_balance_overflow_test.js", "w") as f:
            f.write(test_code)
        
        # Esegui il test
        success, output = self.run_command("npx mocha tests/temp_balance_overflow_test.js")
        
        # Verifica se il test ha rilevato l'overflow
        if "RangeError: Invalid array length" in output:
            print_error("Test fallito: Overflow rilevato nei bilanci")
            print_info("Questo è il bug che dobbiamo correggere")
            return False
        elif success:
            print_success("Test superato: Nessun overflow rilevato nei bilanci")
            return True
        else:
            print_error(f"Errore durante l'esecuzione del test: {output}")
            return False

    def test_memory_leak(self) -> bool:
        """Test per il memory leak nel relayer."""
        print_header("Test: Memory Leak nel Relayer")
        
        # Compila il modulo del relayer
        print_info("Compilazione del modulo del relayer...")
        success, output = self.run_command("git checkout performance-optimizations && npm install && npm run build")
        
        if not success:
            print_error(f"Errore durante la compilazione: {output}")
            return False
        
        # Esegui il test che riproduce il memory leak
        print_info("Esecuzione del test di stress del relayer...")
        
        # Creiamo un test che esegue molte operazioni con il relayer
        test_code = """
        const { expect } = require('chai');
        const { Relayer } = require('../src/bridge/relayer');

        describe('Relayer Memory Leak Test', () => {
            it('should not leak memory under load', async function() {
                this.timeout(30000); // Aumenta il timeout a 30 secondi
                
                const relayer = new Relayer({
                    mockMode: true // Usa la modalità mock per il test
                });
                
                await relayer.start();
                
                // Funzione per misurare l'uso di memoria
                const getMemoryUsage = () => {
                    const memoryUsage = process.memoryUsage();
                    return memoryUsage.heapUsed / 1024 / 1024; // MB
                };
                
                // Misura l'uso di memoria iniziale
                const initialMemory = getMemoryUsage();
                console.log(`Memoria iniziale: ${initialMemory.toFixed(2)} MB`);
                
                // Esegui 1000 operazioni
                for (let i = 0; i < 1000; i++) {
                    await relayer.processMessage({
                        id: `msg-${i}`,
                        source: 'ethereum',
                        destination: 'solana',
                        payload: Buffer.from(`Test message ${i}`).toString('hex')
                    });
                    
                    // Ogni 100 operazioni, misura l'uso di memoria
                    if (i % 100 === 0) {
                        const currentMemory = getMemoryUsage();
                        console.log(`Operazione ${i}: ${currentMemory.toFixed(2)} MB`);
                    }
                }
                
                // Forza la garbage collection se possibile
                if (global.gc) {
                    global.gc();
                }
                
                // Misura l'uso di memoria finale
                const finalMemory = getMemoryUsage();
                console.log(`Memoria finale: ${finalMemory.toFixed(2)} MB`);
                
                // Calcola l'aumento di memoria
                const memoryIncrease = finalMemory - initialMemory;
                console.log(`Aumento di memoria: ${memoryIncrease.toFixed(2)} MB`);
                
                // L'aumento di memoria non dovrebbe essere eccessivo
                expect(memoryIncrease).to.be.lessThan(50); // Meno di 50 MB di aumento
                
                await relayer.stop();
            });
        });
        """
        
        # Scrivi il test in un file temporaneo
        with open(f"{self.project_dir}/tests/temp_relayer_memory_leak_test.js", "w") as f:
            f.write(test_code)
        
        # Esegui il test con --expose-gc per abilitare la garbage collection manuale
        success, output = self.run_command("node --expose-gc ./node_modules/.bin/mocha tests/temp_relayer_memory_leak_test.js")
        
        # Estrai l'aumento di memoria dal log
        import re
        memory_increase_match = re.search(r"Aumento di memoria: (\d+\.\d+) MB", output)
        
        if memory_increase_match:
            memory_increase = float(memory_increase_match.group(1))
            
            if memory_increase >= 50:
                print_error(f"Test fallito: Memory leak rilevato nel relayer (aumento di {memory_increase:.2f} MB)")
                print_info("Questo è il bug che dobbiamo correggere")
                return False
            else:
                print_success(f"Test superato: Nessun memory leak significativo rilevato nel relayer (aumento di {memory_increase:.2f} MB)")
                return True
        else:
            print_error(f"Errore durante l'analisi dell'output del test: {output}")
            return False

    def test_null_input_handling(self) -> bool:
        """Test per la gestione inadeguata degli input null."""
        print_header("Test: Gestione inadeguata degli input null")
        
        # Compila il modulo di challenge
        print_info("Compilazione del modulo di challenge...")
        success, output = self.run_command("git checkout robustness-improvements && npm install && npm run build")
        
        if not success:
            print_error(f"Errore durante la compilazione: {output}")
            return False
        
        # Esegui il test che riproduce l'errore di input null
        print_info("Esecuzione del test di input null...")
        
        # Creiamo un test che invia un input malformato
        test_code = """
        const { expect } = require('chai');
        const { ChallengeManager } = require('../src/challenge/challenge_manager');

        describe('Null Input Handling Test', () => {
            it('should handle null inputs gracefully', async () => {
                const challengeManager = new ChallengeManager();
                
                // Tenta di creare una challenge con input null
                try {
                    await challengeManager.createChallenge(null);
                    // Se arriviamo qui, il test è fallito perché dovrebbe lanciare un'eccezione
                    throw new Error('Expected error for null input but got success');
                } catch (error) {
                    // Verifichiamo che l'errore sia gestito correttamente
                    expect(error.message).to.not.include('Cannot read property');
                    expect(error.message).to.include('Invalid challenge request');
                }
                
                // Tenta di creare una challenge con input malformato
                try {
                    await challengeManager.createChallenge({});
                    // Se arriviamo qui, il test è fallito perché dovrebbe lanciare un'eccezione
                    throw new Error('Expected error for malformed input but got success');
                } catch (error) {
                    // Verifichiamo che l'errore sia gestito correttamente
                    expect(error.message).to.not.include('Cannot read property');
                    expect(error.message).to.include('Invalid challenge request');
                }
            });
        });
        """
        
        # Scrivi il test in un file temporaneo
        with open(f"{self.project_dir}/tests/temp_null_input_test.js", "w") as f:
            f.write(test_code)
        
        # Esegui il test
        success, output = self.run_command("npx mocha tests/temp_null_input_test.js")
        
        # Verifica se il test ha rilevato l'errore di input null
        if "TypeError: Cannot read property 'inputs' of undefined" in output:
            print_error("Test fallito: Gestione inadeguata degli input null rilevata")
            print_info("Questo è il bug che dobbiamo correggere")
            return False
        elif success:
            print_success("Test superato: Gli input null sono gestiti correttamente")
            return True
        else:
            print_error(f"Errore durante l'esecuzione del test: {output}")
            return False

    def test_replay_attack(self) -> bool:
        """Test per la vulnerabilità di replay attack."""
        print_header("Test: Vulnerabilità di Replay Attack")
        
        # Compila il modulo di relay
        print_info("Compilazione del modulo di relay...")
        success, output = self.run_command("git checkout robustness-improvements && npm install && npm run build")
        
        if not success:
            print_error(f"Errore durante la compilazione: {output}")
            return False
        
        # Esegui il test che riproduce il replay attack
        print_info("Esecuzione del test di replay attack...")
        
        # Creiamo un test che tenta di eseguire un replay attack
        test_code = """
        const { expect } = require('chai');
        const { MessageRelay } = require('../src/bridge/message_relay');

        describe('Replay Attack Test', () => {
            it('should prevent replay attacks', async () => {
                const relay = new MessageRelay({
                    mockMode: true // Usa la modalità mock per il test
                });
                
                // Crea un messaggio
                const message = {
                    id: 'msg-1',
                    source: 'ethereum',
                    destination: 'solana',
                    payload: Buffer.from('Test message').toString('hex')
                };
                
                // Processa il messaggio la prima volta
                const result1 = await relay.processMessage(message);
                expect(result1.success).to.be.true;
                
                // Tenta di processare lo stesso messaggio una seconda volta (replay attack)
                try {
                    await relay.processMessage(message);
                    // Se arriviamo qui, il test è fallito perché dovrebbe lanciare un'eccezione
                    throw new Error('Expected replay detection but got success');
                } catch (error) {
                    // Verifichiamo che l'errore sia di tipo ReplayDetectedError
                    expect(error.message).to.include('Replay detected');
                }
            });
        });
        """
        
        # Scrivi il test in un file temporaneo
        with open(f"{self.project_dir}/tests/temp_replay_attack_test.js", "w") as f:
            f.write(test_code)
        
        # Esegui il test
        success, output = self.run_command("npx mocha tests/temp_replay_attack_test.js")
        
        # Verifica se il test ha rilevato la vulnerabilità di replay attack
        if "Expected replay detection but got success" in output:
            print_error("Test fallito: Vulnerabilità di replay attack rilevata")
            print_info("Questo è il bug che dobbiamo correggere")
            return False
        elif success:
            print_success("Test superato: I replay attack sono prevenuti correttamente")
            return True
        else:
            print_error(f"Errore durante l'esecuzione del test: {output}")
            return False

    def run_all_tests(self) -> None:
        """Esegue tutti i test."""
        print_header("Esecuzione di tutti i test di bug fix")
        
        tests = [
            ("Deadlock nella finalizzazione dei blocchi", self.test_block_finalization_deadlock),
            ("Errori di connessione nel Bridge", self.test_bridge_connection_error),
            ("Deadlock nel Sequencer", self.test_sequencer_deadlock),
            ("Double-Spend nel Bridge", self.test_double_spend),
            ("Overflow nei bilanci", self.test_balance_overflow),
            ("Memory Leak nel Relayer", self.test_memory_leak),
            ("Gestione inadeguata degli input null", self.test_null_input_handling),
            ("Vulnerabilità di Replay Attack", self.test_replay_attack)
        ]
        
        for name, test_func in tests:
            self.test_count += 1
            print_header(f"Test {self.test_count}: {name}")
            
            try:
                result = test_func()
                self.results[name] = result
                
                if result:
                    self.pass_count += 1
                else:
                    self.fail_count += 1
            except Exception as e:
                print_error(f"Errore durante l'esecuzione del test: {e}")
                self.results[name] = False
                self.fail_count += 1
        
        self.print_summary()

    def print_summary(self) -> None:
        """Stampa un riepilogo dei risultati dei test."""
        print_header("Riepilogo dei risultati dei test")
        
        for name, result in self.results.items():
            if result:
                print_success(f"{name}: PASSATO")
            else:
                print_error(f"{name}: FALLITO")
        
        print_header(f"Totale: {self.test_count} test, {self.pass_count} passati, {self.fail_count} falliti")
        
        if self.fail_count == 0:
            print_success("Tutti i test sono passati!")
        else:
            print_error(f"{self.fail_count} test sono falliti!")

if __name__ == "__main__":
    # Ottieni la directory del progetto
    project_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    
    # Crea la suite di test
    test_suite = BugFixTestSuite(project_dir)
    
    # Esegui tutti i test
    test_suite.run_all_tests()
