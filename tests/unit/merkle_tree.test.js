/**
 * Test unitari per il modulo merkle_tree.js
 * 
 * Questi test verificano il corretto funzionamento dell'implementazione ottimizzata
 * dell'albero di Merkle, inclusi caching degli stati intermedi, operazioni batch
 * e verifica parallela delle prove.
 */

const { MerkleTree } = require('../../offchain/merkle_tree');
const crypto = require('crypto');

// Funzione di utilità per generare dati di test
function generateTestData(count) {
  const data = [];
  for (let i = 0; i < count; i++) {
    data.push(Buffer.from(`data-${i}`, 'utf8'));
  }
  return data;
}

// Funzione di utilità per calcolare l'hash SHA-256
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

describe('MerkleTree', () => {
  let merkleTree;
  
  beforeEach(() => {
    // Crea un nuovo albero di Merkle per ogni test
    merkleTree = new MerkleTree({
      hashFunction: sha256,
      enableCaching: true,
      enableParallelVerification: true
    });
  });
  
  afterEach(() => {
    // Pulisci l'albero di Merkle dopo ogni test
    if (merkleTree) {
      merkleTree.clear();
    }
  });
  
  describe('Costruzione dell\'albero', () => {
    test('Dovrebbe costruire un albero vuoto', () => {
      expect(merkleTree.getRoot()).toBeNull();
      expect(merkleTree.getSize()).toBe(0);
    });
    
    test('Dovrebbe costruire un albero con un singolo elemento', () => {
      const data = Buffer.from('test-data', 'utf8');
      merkleTree.append(data);
      
      expect(merkleTree.getRoot()).not.toBeNull();
      expect(merkleTree.getSize()).toBe(1);
      
      // Verifica che la radice sia l'hash del dato
      const expectedRoot = sha256(data);
      expect(merkleTree.getRoot().equals(expectedRoot)).toBe(true);
    });
    
    test('Dovrebbe costruire un albero con più elementi', () => {
      const data = generateTestData(8);
      
      for (const item of data) {
        merkleTree.append(item);
      }
      
      expect(merkleTree.getRoot()).not.toBeNull();
      expect(merkleTree.getSize()).toBe(8);
    });
    
    test('Dovrebbe costruire un albero con un numero di elementi non potenza di 2', () => {
      const data = generateTestData(7);
      
      for (const item of data) {
        merkleTree.append(item);
      }
      
      expect(merkleTree.getRoot()).not.toBeNull();
      expect(merkleTree.getSize()).toBe(7);
    });
    
    test('Dovrebbe costruire un albero da un array di dati', () => {
      const data = generateTestData(10);
      merkleTree.build(data);
      
      expect(merkleTree.getRoot()).not.toBeNull();
      expect(merkleTree.getSize()).toBe(10);
    });
  });
  
  describe('Generazione e verifica delle prove', () => {
    test('Dovrebbe generare una prova valida per un elemento esistente', () => {
      const data = generateTestData(8);
      merkleTree.build(data);
      
      const index = 3;
      const proof = merkleTree.generateProof(index);
      
      expect(proof).not.toBeNull();
      expect(Array.isArray(proof)).toBe(true);
      expect(proof.length).toBeGreaterThan(0);
      
      // Verifica la prova
      const isValid = merkleTree.verifyProof(data[index], proof, merkleTree.getRoot());
      expect(isValid).toBe(true);
    });
    
    test('Dovrebbe fallire la verifica per un elemento non esistente', () => {
      const data = generateTestData(8);
      merkleTree.build(data);
      
      const index = 3;
      const proof = merkleTree.generateProof(index);
      
      // Modifica il dato
      const invalidData = Buffer.from('invalid-data', 'utf8');
      
      // Verifica la prova con il dato modificato
      const isValid = merkleTree.verifyProof(invalidData, proof, merkleTree.getRoot());
      expect(isValid).toBe(false);
    });
    
    test('Dovrebbe fallire la verifica per una prova manipolata', () => {
      const data = generateTestData(8);
      merkleTree.build(data);
      
      const index = 3;
      const proof = merkleTree.generateProof(index);
      
      // Manipola la prova
      if (proof.length > 0) {
        proof[0].data = Buffer.from('manipulated', 'utf8');
      }
      
      // Verifica la prova manipolata
      const isValid = merkleTree.verifyProof(data[index], proof, merkleTree.getRoot());
      expect(isValid).toBe(false);
    });
    
    test('Dovrebbe generare e verificare prove per tutti gli elementi', () => {
      const data = generateTestData(16);
      merkleTree.build(data);
      
      for (let i = 0; i < data.length; i++) {
        const proof = merkleTree.generateProof(i);
        const isValid = merkleTree.verifyProof(data[i], proof, merkleTree.getRoot());
        expect(isValid).toBe(true);
      }
    });
  });
  
  describe('Operazioni batch', () => {
    test('Dovrebbe aggiungere elementi in batch', () => {
      const data = generateTestData(100);
      
      // Aggiungi gli elementi in batch
      merkleTree.appendBatch(data);
      
      expect(merkleTree.getSize()).toBe(100);
      expect(merkleTree.getRoot()).not.toBeNull();
    });
    
    test('Dovrebbe aggiornare elementi in batch', () => {
      const data = generateTestData(10);
      merkleTree.build(data);
      
      const originalRoot = Buffer.from(merkleTree.getRoot());
      
      // Aggiorna alcuni elementi
      const updates = [
        { index: 2, data: Buffer.from('updated-2', 'utf8') },
        { index: 5, data: Buffer.from('updated-5', 'utf8') },
        { index: 8, data: Buffer.from('updated-8', 'utf8') }
      ];
      
      merkleTree.updateBatch(updates);
      
      // Verifica che la radice sia cambiata
      expect(merkleTree.getRoot().equals(originalRoot)).toBe(false);
      
      // Verifica che gli elementi siano stati aggiornati
      for (const update of updates) {
        const proof = merkleTree.generateProof(update.index);
        const isValid = merkleTree.verifyProof(update.data, proof, merkleTree.getRoot());
        expect(isValid).toBe(true);
      }
    });
    
    test('Dovrebbe verificare prove in batch', async () => {
      const data = generateTestData(20);
      merkleTree.build(data);
      
      // Genera prove per tutti gli elementi
      const proofs = [];
      for (let i = 0; i < data.length; i++) {
        proofs.push({
          data: data[i],
          proof: merkleTree.generateProof(i)
        });
      }
      
      // Verifica le prove in batch
      const results = await merkleTree.verifyProofBatch(proofs, merkleTree.getRoot());
      
      expect(results.length).toBe(proofs.length);
      expect(results.every(result => result === true)).toBe(true);
    });
  });
  
  describe('Caching degli stati intermedi', () => {
    test('Dovrebbe utilizzare la cache per migliorare le prestazioni', () => {
      // Disabilita la cache per il primo test
      const merkleTreeNoCache = new MerkleTree({
        hashFunction: sha256,
        enableCaching: false
      });
      
      const data = generateTestData(1000);
      
      // Misura il tempo senza cache
      const startNoCache = Date.now();
      merkleTreeNoCache.build(data);
      for (let i = 0; i < 10; i++) {
        merkleTreeNoCache.generateProof(i * 100);
      }
      const endNoCache = Date.now();
      const timeNoCache = endNoCache - startNoCache;
      
      // Misura il tempo con cache
      const startWithCache = Date.now();
      merkleTree.build(data);
      for (let i = 0; i < 10; i++) {
        merkleTree.generateProof(i * 100);
      }
      const endWithCache = Date.now();
      const timeWithCache = endWithCache - startWithCache;
      
      // La versione con cache dovrebbe essere più veloce
      expect(timeWithCache).toBeLessThanOrEqual(timeNoCache);
    });
    
    test('Dovrebbe aggiornare correttamente la cache dopo le modifiche', () => {
      const data = generateTestData(16);
      merkleTree.build(data);
      
      // Genera una prova prima dell'aggiornamento
      const index = 5;
      const originalProof = merkleTree.generateProof(index);
      
      // Aggiorna un elemento
      const updatedData = Buffer.from('updated-data', 'utf8');
      merkleTree.update(index, updatedData);
      
      // Genera una nuova prova
      const updatedProof = merkleTree.generateProof(index);
      
      // Le prove dovrebbero essere diverse
      expect(JSON.stringify(updatedProof)).not.toBe(JSON.stringify(originalProof));
      
      // La nuova prova dovrebbe essere valida
      const isValid = merkleTree.verifyProof(updatedData, updatedProof, merkleTree.getRoot());
      expect(isValid).toBe(true);
    });
  });
  
  describe('Verifica parallela', () => {
    test('Dovrebbe verificare prove in parallelo', async () => {
      // Crea un albero con molti elementi
      const data = generateTestData(100);
      merkleTree.build(data);
      
      // Genera prove per tutti gli elementi
      const proofs = [];
      for (let i = 0; i < data.length; i++) {
        proofs.push({
          data: data[i],
          proof: merkleTree.generateProof(i)
        });
      }
      
      // Verifica le prove in parallelo
      const results = await merkleTree.verifyProofBatch(proofs, merkleTree.getRoot());
      
      expect(results.length).toBe(proofs.length);
      expect(results.every(result => result === true)).toBe(true);
    });
    
    test('Dovrebbe gestire correttamente gli errori nella verifica parallela', async () => {
      const data = generateTestData(50);
      merkleTree.build(data);
      
      // Genera prove per tutti gli elementi
      const proofs = [];
      for (let i = 0; i < data.length; i++) {
        proofs.push({
          data: data[i],
          proof: merkleTree.generateProof(i)
        });
      }
      
      // Manipola alcune prove
      proofs[10].data = Buffer.from('invalid', 'utf8');
      proofs[20].proof[0].data = Buffer.from('invalid', 'utf8');
      
      // Verifica le prove in parallelo
      const results = await merkleTree.verifyProofBatch(proofs, merkleTree.getRoot());
      
      expect(results.length).toBe(proofs.length);
      expect(results[10]).toBe(false);
      expect(results[20]).toBe(false);
      
      // Le altre prove dovrebbero essere valide
      expect(results.filter(result => result === true).length).toBe(proofs.length - 2);
    });
  });
  
  describe('Gestione degli errori', () => {
    test('Dovrebbe gestire indici non validi', () => {
      const data = generateTestData(10);
      merkleTree.build(data);
      
      // Indice negativo
      expect(() => merkleTree.generateProof(-1)).toThrow();
      
      // Indice troppo grande
      expect(() => merkleTree.generateProof(10)).toThrow();
    });
    
    test('Dovrebbe gestire prove non valide', () => {
      const data = generateTestData(10);
      merkleTree.build(data);
      
      // Prova vuota
      const isValid = merkleTree.verifyProof(data[0], [], merkleTree.getRoot());
      expect(isValid).toBe(false);
    });
  });
  
  describe('Metriche e monitoraggio', () => {
    test('Dovrebbe tracciare le metriche di utilizzo', () => {
      const data = generateTestData(100);
      merkleTree.build(data);
      
      // Genera alcune prove
      for (let i = 0; i < 10; i++) {
        merkleTree.generateProof(i);
      }
      
      // Ottieni le metriche
      const metrics = merkleTree.getMetrics();
      
      expect(metrics).toBeDefined();
      expect(metrics.operations).toBeDefined();
      expect(metrics.operations.append).toBeGreaterThan(0);
      expect(metrics.operations.generateProof).toBeGreaterThan(0);
    });
  });
});
