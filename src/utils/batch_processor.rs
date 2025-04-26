use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use std::thread::JoinHandle;
use std::time::Duration;

/**
 * Processore batch per gestire più operazioni in un unico passaggio
 * 
 * Questa classe fornisce un meccanismo efficiente per elaborare grandi quantità
 * di operazioni in batch, migliorando significativamente le prestazioni rispetto
 * all'elaborazione sequenziale.
 * 
 * @author Manus
 */
pub struct BatchProcessor<T, R> 
where 
    T: Send + 'static,
    R: Send + 'static
{
    /// Dimensione massima del batch
    batch_size: usize,
    
    /// Timeout per il flush automatico (in millisecondi)
    flush_timeout_ms: u64,
    
    /// Funzione di elaborazione del batch
    processor: Box<dyn Fn(Vec<T>) -> Vec<R> + Send + Sync>,
    
    /// Coda di elementi in attesa di elaborazione
    queue: Arc<Mutex<Vec<T>>>,
    
    /// Mappa di callback per i risultati
    callbacks: Arc<Mutex<HashMap<usize, Box<dyn FnOnce(R) + Send>>>>,
    
    /// Contatore per gli ID degli elementi
    counter: Arc<Mutex<usize>>,
    
    /// Thread di background per il flush automatico
    background_thread: Option<JoinHandle<()>>,
    
    /// Flag per indicare se il processore è in esecuzione
    running: Arc<Mutex<bool>>,
}

impl<T, R> BatchProcessor<T, R> 
where 
    T: Send + 'static + Clone,
    R: Send + 'static
{
    /**
     * Crea un nuovo processore batch
     * 
     * @param batch_size Dimensione massima del batch
     * @param flush_timeout_ms Timeout per il flush automatico (in millisecondi)
     * @param processor Funzione di elaborazione del batch
     * @return Nuovo processore batch
     */
    pub fn new(
        batch_size: usize, 
        flush_timeout_ms: u64, 
        processor: impl Fn(Vec<T>) -> Vec<R> + Send + Sync + 'static
    ) -> Self {
        let queue = Arc::new(Mutex::new(Vec::with_capacity(batch_size)));
        let callbacks = Arc::new(Mutex::new(HashMap::new()));
        let counter = Arc::new(Mutex::new(0));
        let running = Arc::new(Mutex::new(true));
        
        // Crea il thread di background per il flush automatico
        let bg_queue = Arc::clone(&queue);
        let bg_callbacks = Arc::clone(&callbacks);
        let bg_running = Arc::clone(&running);
        let processor_arc = Arc::new(processor);
        
        let background_thread = Some(thread::spawn(move || {
            let processor = processor_arc;
            
            while *bg_running.lock().unwrap() {
                thread::sleep(Duration::from_millis(flush_timeout_ms));
                
                // Controlla se è necessario eseguire il flush
                let should_flush = {
                    let queue = bg_queue.lock().unwrap();
                    !queue.is_empty()
                };
                
                if should_flush {
                    Self::flush_internal(&bg_queue, &bg_callbacks, &processor);
                }
            }
        }));
        
        BatchProcessor {
            batch_size,
            flush_timeout_ms,
            processor: Box::new(processor),
            queue,
            callbacks,
            counter,
            background_thread,
            running,
        }
    }
    
    /**
     * Aggiunge un elemento al batch per l'elaborazione
     * 
     * @param item Elemento da elaborare
     * @param callback Callback da chiamare con il risultato
     * @return ID dell'elemento
     */
    pub fn add<F>(&self, item: T, callback: F) -> usize 
    where 
        F: FnOnce(R) + Send + 'static
    {
        // Genera un ID univoco per l'elemento
        let id = {
            let mut counter = self.counter.lock().unwrap();
            *counter += 1;
            *counter
        };
        
        // Aggiungi il callback alla mappa
        {
            let mut callbacks = self.callbacks.lock().unwrap();
            callbacks.insert(id, Box::new(callback));
        }
        
        // Aggiungi l'elemento alla coda
        let should_flush = {
            let mut queue = self.queue.lock().unwrap();
            queue.push(item);
            queue.len() >= self.batch_size
        };
        
        // Esegui il flush se la coda è piena
        if should_flush {
            self.flush();
        }
        
        id
    }
    
    /**
     * Forza l'elaborazione di tutti gli elementi nella coda
     */
    pub fn flush(&self) {
        Self::flush_internal(&self.queue, &self.callbacks, &self.processor);
    }
    
    /**
     * Implementazione interna del flush
     */
    fn flush_internal(
        queue: &Arc<Mutex<Vec<T>>>, 
        callbacks: &Arc<Mutex<HashMap<usize, Box<dyn FnOnce(R) + Send>>>>,
        processor: &dyn Fn(Vec<T>) -> Vec<R>
    ) {
        // Estrai gli elementi dalla coda
        let batch = {
            let mut queue = queue.lock().unwrap();
            if queue.is_empty() {
                return;
            }
            std::mem::replace(&mut *queue, Vec::new())
        };
        
        // Elabora il batch
        let results = processor(batch);
        
        // Chiama i callback con i risultati
        let mut callbacks_map = callbacks.lock().unwrap();
        for (i, result) in results.into_iter().enumerate() {
            if let Some(callback) = callbacks_map.remove(&(i + 1)) {
                callback(result);
            }
        }
    }
    
    /**
     * Elabora un batch in modo sincrono e restituisce i risultati
     * 
     * @param items Elementi da elaborare
     * @return Risultati dell'elaborazione
     */
    pub fn process_batch_sync(&self, items: Vec<T>) -> Vec<R> {
        (self.processor)(items)
    }
    
    /**
     * Arresta il processore batch
     */
    pub fn shutdown(&mut self) {
        // Imposta il flag running a false
        {
            let mut running = self.running.lock().unwrap();
            *running = false;
        }
        
        // Attendi che il thread di background termini
        if let Some(thread) = self.background_thread.take() {
            let _ = thread.join();
        }
        
        // Esegui un ultimo flush
        self.flush();
    }
    
    /**
     * Ottiene la dimensione attuale della coda
     * 
     * @return Dimensione della coda
     */
    pub fn queue_size(&self) -> usize {
        let queue = self.queue.lock().unwrap();
        queue.len()
    }
    
    /**
     * Verifica se la coda è vuota
     * 
     * @return true se la coda è vuota, false altrimenti
     */
    pub fn is_queue_empty(&self) -> bool {
        let queue = self.queue.lock().unwrap();
        queue.is_empty()
    }
    
    /**
     * Modifica la dimensione del batch
     * 
     * @param new_size Nuova dimensione del batch
     */
    pub fn set_batch_size(&mut self, new_size: usize) {
        self.batch_size = new_size;
    }
    
    /**
     * Modifica il timeout per il flush automatico
     * 
     * @param new_timeout_ms Nuovo timeout in millisecondi
     */
    pub fn set_flush_timeout(&mut self, new_timeout_ms: u64) {
        self.flush_timeout_ms = new_timeout_ms;
    }
}

impl<T, R> Drop for BatchProcessor<T, R> 
where 
    T: Send + 'static,
    R: Send + 'static
{
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Instant;
    
    #[test]
    fn test_batch_processor() {
        // Crea un processore batch che raddoppia i numeri
        let processor = BatchProcessor::new(
            10, // batch_size
            100, // flush_timeout_ms
            |batch: Vec<i32>| -> Vec<i32> {
                batch.into_iter().map(|x| x * 2).collect()
            }
        );
        
        // Crea un canale per ricevere i risultati
        let (tx, rx) = mpsc::channel();
        
        // Aggiungi elementi al batch
        for i in 0..25 {
            let tx_clone = tx.clone();
            processor.add(i, move |result| {
                tx_clone.send(result).unwrap();
            });
        }
        
        // Forza il flush per elaborare gli elementi rimanenti
        processor.flush();
        
        // Raccogli i risultati
        drop(tx); // Chiudi il canale principale
        let results: Vec<i32> = rx.iter().collect();
        
        // Verifica che ci siano 25 risultati
        assert_eq!(results.len(), 25);
        
        // Verifica che ogni numero sia stato raddoppiato
        for i in 0..25 {
            assert!(results.contains(&(i * 2)));
        }
    }
    
    #[test]
    fn test_automatic_flush() {
        // Crea un processore batch con un timeout breve
        let processor = BatchProcessor::new(
            100, // batch_size (grande abbastanza da non causare un flush manuale)
            50,  // flush_timeout_ms (breve per causare un flush automatico)
            |batch: Vec<i32>| -> Vec<i32> {
                batch.into_iter().map(|x| x * 2).collect()
            }
        );
        
        // Crea un canale per ricevere i risultati
        let (tx, rx) = mpsc::channel();
        
        // Aggiungi elementi al batch
        for i in 0..5 {
            let tx_clone = tx.clone();
            processor.add(i, move |result| {
                tx_clone.send(result).unwrap();
            });
        }
        
        // Attendi che il flush automatico avvenga
        thread::sleep(Duration::from_millis(100));
        
        // Raccogli i risultati
        drop(tx); // Chiudi il canale principale
        let results: Vec<i32> = rx.iter().collect();
        
        // Verifica che ci siano 5 risultati
        assert_eq!(results.len(), 5);
        
        // Verifica che ogni numero sia stato raddoppiato
        for i in 0..5 {
            assert!(results.contains(&(i * 2)));
        }
    }
    
    #[test]
    fn test_performance() {
        const NUM_ITEMS: usize = 10000;
        
        // Funzione di elaborazione che simula un'operazione costosa
        let processor_fn = |batch: Vec<i32>| -> Vec<i32> {
            // Simula un'operazione che richiede 1ms per elemento
            thread::sleep(Duration::from_millis(batch.len() as u64));
            batch.into_iter().map(|x| x * 2).collect()
        };
        
        // Test con elaborazione sequenziale
        let start = Instant::now();
        let mut sequential_results = Vec::with_capacity(NUM_ITEMS);
        for i in 0..NUM_ITEMS {
            let result = processor_fn(vec![i as i32])[0];
            sequential_results.push(result);
        }
        let sequential_time = start.elapsed();
        
        // Test con elaborazione batch
        let start = Instant::now();
        let batch_processor = BatchProcessor::new(
            100, // batch_size
            10,  // flush_timeout_ms
            processor_fn
        );
        
        let (tx, rx) = mpsc::channel();
        
        for i in 0..NUM_ITEMS {
            let tx_clone = tx.clone();
            batch_processor.add(i as i32, move |result| {
                tx_clone.send(result).unwrap();
            });
        }
        
        batch_processor.flush();
        drop(tx);
        
        let batch_results: Vec<i32> = rx.iter().collect();
        let batch_time = start.elapsed();
        
        // Verifica che i risultati siano corretti
        assert_eq!(batch_results.len(), NUM_ITEMS);
        
        // Verifica che l'elaborazione batch sia più veloce
        println!("Sequential time: {:?}", sequential_time);
        println!("Batch time: {:?}", batch_time);
        assert!(batch_time < sequential_time);
    }
}
