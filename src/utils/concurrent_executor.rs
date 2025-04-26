use std::sync::{Arc, Mutex};
use std::thread;
use std::thread::JoinHandle;
use std::sync::mpsc::{channel, Sender, Receiver};
use std::collections::VecDeque;

/**
 * Esecutore concorrente per elaborazione parallela
 * 
 * Questa classe fornisce un pool di thread per eseguire task in parallelo,
 * migliorando significativamente le prestazioni per operazioni che possono
 * essere parallelizzate.
 * 
 * @author Manus
 */
pub struct ConcurrentExecutor {
    /// Numero di worker thread
    num_workers: usize,
    
    /// Canale per inviare task ai worker
    task_sender: Option<Sender<Task>>,
    
    /// Worker thread
    workers: Vec<JoinHandle<()>>,
    
    /// Flag per indicare se l'esecutore è in esecuzione
    running: Arc<Mutex<bool>>,
    
    /// Contatore di task completati
    completed_tasks: Arc<Mutex<usize>>,
    
    /// Contatore di task falliti
    failed_tasks: Arc<Mutex<usize>>,
    
    /// Coda di task in attesa
    pending_tasks: Arc<Mutex<VecDeque<Task>>>,
}

/// Tipo di funzione per i task
type TaskFn = Box<dyn FnOnce() -> Result<(), String> + Send + 'static>;

/// Struttura per rappresentare un task
struct Task {
    /// Funzione da eseguire
    function: TaskFn,
    
    /// Nome del task (per logging)
    name: String,
    
    /// Priorità del task (più basso = più alta priorità)
    priority: u8,
}

impl ConcurrentExecutor {
    /**
     * Crea un nuovo esecutore concorrente
     * 
     * @param num_workers Numero di worker thread (default: numero di core CPU)
     * @return Nuovo esecutore concorrente
     */
    pub fn new(num_workers: Option<usize>) -> Self {
        let num_workers = num_workers.unwrap_or_else(|| {
            // Usa il numero di core CPU come default
            num_cpus::get()
        });
        
        let running = Arc::new(Mutex::new(true));
        let completed_tasks = Arc::new(Mutex::new(0));
        let failed_tasks = Arc::new(Mutex::new(0));
        let pending_tasks = Arc::new(Mutex::new(VecDeque::new()));
        
        // Crea il canale per i task
        let (task_sender, task_receiver) = channel::<Task>();
        
        // Crea i worker thread
        let mut workers = Vec::with_capacity(num_workers);
        
        for id in 0..num_workers {
            let task_receiver = task_receiver.clone();
            let running = Arc::clone(&running);
            let completed_tasks = Arc::clone(&completed_tasks);
            let failed_tasks = Arc::clone(&failed_tasks);
            
            let worker = thread::spawn(move || {
                Self::worker_loop(id, task_receiver, running, completed_tasks, failed_tasks);
            });
            
            workers.push(worker);
        }
        
        ConcurrentExecutor {
            num_workers,
            task_sender: Some(task_sender),
            workers,
            running,
            completed_tasks,
            failed_tasks,
            pending_tasks,
        }
    }
    
    /**
     * Loop principale del worker
     */
    fn worker_loop(
        id: usize,
        task_receiver: Receiver<Task>,
        running: Arc<Mutex<bool>>,
        completed_tasks: Arc<Mutex<usize>>,
        failed_tasks: Arc<Mutex<usize>>,
    ) {
        println!("Worker {} started", id);
        
        while *running.lock().unwrap() {
            // Ricevi un task dal canale
            match task_receiver.recv() {
                Ok(task) => {
                    println!("Worker {} executing task: {}", id, task.name);
                    
                    // Esegui il task
                    match (task.function)() {
                        Ok(()) => {
                            // Task completato con successo
                            let mut completed = completed_tasks.lock().unwrap();
                            *completed += 1;
                            println!("Worker {} completed task: {}", id, task.name);
                        }
                        Err(err) => {
                            // Task fallito
                            let mut failed = failed_tasks.lock().unwrap();
                            *failed += 1;
                            println!("Worker {} failed task: {} - Error: {}", id, task.name, err);
                        }
                    }
                }
                Err(_) => {
                    // Canale chiuso, termina il worker
                    break;
                }
            }
        }
        
        println!("Worker {} stopped", id);
    }
    
    /**
     * Aggiunge un task all'esecutore
     * 
     * @param name Nome del task
     * @param priority Priorità del task (più basso = più alta priorità)
     * @param function Funzione da eseguire
     * @return true se il task è stato aggiunto con successo, false altrimenti
     */
    pub fn submit<F>(&self, name: &str, priority: u8, function: F) -> bool 
    where 
        F: FnOnce() -> Result<(), String> + Send + 'static
    {
        if let Some(sender) = &self.task_sender {
            let task = Task {
                function: Box::new(function),
                name: name.to_string(),
                priority,
            };
            
            // Aggiungi il task alla coda in attesa
            {
                let mut pending = self.pending_tasks.lock().unwrap();
                pending.push_back(task);
            }
            
            // Invia il task al worker
            match sender.send(task) {
                Ok(_) => true,
                Err(_) => {
                    println!("Failed to submit task: {}", name);
                    false
                }
            }
        } else {
            println!("Executor is not running");
            false
        }
    }
    
    /**
     * Aggiunge un batch di task all'esecutore
     * 
     * @param tasks Vector di tuple (nome, priorità, funzione)
     * @return Numero di task aggiunti con successo
     */
    pub fn submit_batch<F>(&self, tasks: Vec<(&str, u8, F)>) -> usize 
    where 
        F: FnOnce() -> Result<(), String> + Send + 'static + Clone
    {
        let mut successful = 0;
        
        for (name, priority, function) in tasks {
            if self.submit(name, priority, function) {
                successful += 1;
            }
        }
        
        successful
    }
    
    /**
     * Attende il completamento di tutti i task
     * 
     * @param timeout_ms Timeout in millisecondi (None = attesa infinita)
     * @return true se tutti i task sono stati completati, false se è scaduto il timeout
     */
    pub fn wait_for_completion(&self, timeout_ms: Option<u64>) -> bool {
        let start_time = std::time::Instant::now();
        
        loop {
            // Controlla se ci sono task in attesa
            let pending_count = {
                let pending = self.pending_tasks.lock().unwrap();
                pending.len()
            };
            
            if pending_count == 0 {
                return true;
            }
            
            // Controlla se è scaduto il timeout
            if let Some(timeout) = timeout_ms {
                if start_time.elapsed().as_millis() > timeout as u128 {
                    return false;
                }
            }
            
            // Attendi un po' prima di controllare di nuovo
            thread::sleep(std::time::Duration::from_millis(10));
        }
    }
    
    /**
     * Arresta l'esecutore
     */
    pub fn shutdown(&mut self) {
        // Imposta il flag running a false
        {
            let mut running = self.running.lock().unwrap();
            *running = false;
        }
        
        // Chiudi il canale dei task
        self.task_sender.take();
        
        // Attendi che i worker terminino
        while let Some(worker) = self.workers.pop() {
            let _ = worker.join();
        }
        
        println!("Executor shutdown complete");
    }
    
    /**
     * Ottiene il numero di task completati
     * 
     * @return Numero di task completati
     */
    pub fn get_completed_tasks(&self) -> usize {
        let completed = self.completed_tasks.lock().unwrap();
        *completed
    }
    
    /**
     * Ottiene il numero di task falliti
     * 
     * @return Numero di task falliti
     */
    pub fn get_failed_tasks(&self) -> usize {
        let failed = self.failed_tasks.lock().unwrap();
        *failed
    }
    
    /**
     * Ottiene il numero di task in attesa
     * 
     * @return Numero di task in attesa
     */
    pub fn get_pending_tasks(&self) -> usize {
        let pending = self.pending_tasks.lock().unwrap();
        pending.len()
    }
    
    /**
     * Ottiene il numero di worker
     * 
     * @return Numero di worker
     */
    pub fn get_num_workers(&self) -> usize {
        self.num_workers
    }
}

impl Drop for ConcurrentExecutor {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;
    
    #[test]
    fn test_concurrent_executor() {
        // Crea un esecutore con 4 worker
        let executor = ConcurrentExecutor::new(Some(4));
        
        // Contatore atomico per i task completati
        let counter = Arc::new(AtomicUsize::new(0));
        
        // Aggiungi 10 task
        for i in 0..10 {
            let counter_clone = Arc::clone(&counter);
            executor.submit(&format!("Task {}", i), 0, move || {
                // Simula un'operazione che richiede tempo
                thread::sleep(Duration::from_millis(100));
                counter_clone.fetch_add(1, Ordering::SeqCst);
                Ok(())
            });
        }
        
        // Attendi il completamento di tutti i task
        assert!(executor.wait_for_completion(Some(2000)));
        
        // Verifica che tutti i task siano stati completati
        assert_eq!(counter.load(Ordering::SeqCst), 10);
        assert_eq!(executor.get_completed_tasks(), 10);
        assert_eq!(executor.get_failed_tasks(), 0);
    }
    
    #[test]
    fn test_task_failure() {
        // Crea un esecutore con 2 worker
        let executor = ConcurrentExecutor::new(Some(2));
        
        // Aggiungi un task che fallisce
        executor.submit("Failing Task", 0, || {
            Err("Task failed intentionally".to_string())
        });
        
        // Aggiungi un task che ha successo
        executor.submit("Successful Task", 0, || {
            Ok(())
        });
        
        // Attendi il completamento di tutti i task
        assert!(executor.wait_for_completion(Some(1000)));
        
        // Verifica che un task sia fallito e uno abbia avuto successo
        assert_eq!(executor.get_completed_tasks(), 1);
        assert_eq!(executor.get_failed_tasks(), 1);
    }
    
    #[test]
    fn test_batch_submission() {
        // Crea un esecutore con 2 worker
        let executor = ConcurrentExecutor::new(Some(2));
        
        // Contatore atomico per i task completati
        let counter = Arc::new(AtomicUsize::new(0));
        
        // Crea un batch di task
        let mut tasks = Vec::new();
        for i in 0..5 {
            let counter_clone = Arc::clone(&counter);
            tasks.push((
                format!("Batch Task {}", i).as_str(),
                0,
                move || {
                    thread::sleep(Duration::from_millis(50));
                    counter_clone.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                }
            ));
        }
        
        // Aggiungi il batch di task
        let submitted = executor.submit_batch(tasks);
        assert_eq!(submitted, 5);
        
        // Attendi il completamento di tutti i task
        assert!(executor.wait_for_completion(Some(1000)));
        
        // Verifica che tutti i task siano stati completati
        assert_eq!(counter.load(Ordering::SeqCst), 5);
        assert_eq!(executor.get_completed_tasks(), 5);
    }
}
