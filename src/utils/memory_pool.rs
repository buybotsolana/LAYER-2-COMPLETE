use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::mem;

/**
 * Pool di memoria per ridurre l'overhead di allocazione
 * 
 * Questa classe fornisce un pool di memoria che riutilizza le allocazioni
 * per ridurre l'overhead di allocazione/deallocazione, migliorando significativamente
 * le prestazioni in scenari con molte allocazioni di dimensioni simili.
 * 
 * @author Manus
 */
pub struct MemoryPool<T> {
    /// Pool di oggetti disponibili
    pool: Arc<Mutex<Vec<T>>>,
    
    /// Statistiche di utilizzo
    stats: Arc<Mutex<PoolStats>>,
    
    /// Dimensione massima del pool
    max_size: usize,
    
    /// Funzione di inizializzazione per nuovi oggetti
    initializer: Option<Box<dyn Fn() -> T + Send + Sync>>,
    
    /// Funzione di reset per oggetti riutilizzati
    reset_fn: Option<Box<dyn Fn(&mut T) -> () + Send + Sync>>,
    
    /// Pool di oggetti per dimensione (per tipi di dimensione variabile come Vec o String)
    size_pools: Option<Arc<Mutex<HashMap<usize, Vec<T>>>>>,
}

/// Statistiche di utilizzo del pool
#[derive(Debug, Clone)]
pub struct PoolStats {
    /// Numero di oggetti attualmente nel pool
    pub available: usize,
    
    /// Numero totale di allocazioni
    pub total_allocations: usize,
    
    /// Numero di oggetti riutilizzati dal pool
    pub reused: usize,
    
    /// Numero di oggetti creati
    pub created: usize,
    
    /// Numero di oggetti scartati (pool pieno)
    pub discarded: usize,
}

impl<T> MemoryPool<T> 
where 
    T: Send + 'static
{
    /**
     * Crea un nuovo pool di memoria
     * 
     * @param max_size Dimensione massima del pool
     * @return Nuovo pool di memoria
     */
    pub fn new(max_size: usize) -> Self {
        MemoryPool {
            pool: Arc::new(Mutex::new(Vec::with_capacity(max_size))),
            stats: Arc::new(Mutex::new(PoolStats {
                available: 0,
                total_allocations: 0,
                reused: 0,
                created: 0,
                discarded: 0,
            })),
            max_size,
            initializer: None,
            reset_fn: None,
            size_pools: None,
        }
    }
    
    /**
     * Crea un nuovo pool di memoria con una funzione di inizializzazione
     * 
     * @param max_size Dimensione massima del pool
     * @param initializer Funzione di inizializzazione per nuovi oggetti
     * @return Nuovo pool di memoria
     */
    pub fn with_initializer<F>(max_size: usize, initializer: F) -> Self 
    where 
        F: Fn() -> T + Send + Sync + 'static
    {
        MemoryPool {
            pool: Arc::new(Mutex::new(Vec::with_capacity(max_size))),
            stats: Arc::new(Mutex::new(PoolStats {
                available: 0,
                total_allocations: 0,
                reused: 0,
                created: 0,
                discarded: 0,
            })),
            max_size,
            initializer: Some(Box::new(initializer)),
            reset_fn: None,
            size_pools: None,
        }
    }
    
    /**
     * Imposta una funzione di reset per gli oggetti riutilizzati
     * 
     * @param reset_fn Funzione di reset
     */
    pub fn set_reset_function<F>(&mut self, reset_fn: F) 
    where 
        F: Fn(&mut T) -> () + Send + Sync + 'static
    {
        self.reset_fn = Some(Box::new(reset_fn));
    }
    
    /**
     * Abilita il pooling per dimensione (per tipi di dimensione variabile)
     */
    pub fn enable_size_pooling(&mut self) {
        self.size_pools = Some(Arc::new(Mutex::new(HashMap::new())));
    }
    
    /**
     * Ottiene un oggetto dal pool
     * 
     * @return Oggetto dal pool
     */
    pub fn get(&self) -> T 
    where 
        T: Default
    {
        let mut stats = self.stats.lock().unwrap();
        stats.total_allocations += 1;
        
        // Prova a ottenere un oggetto dal pool
        let mut pool = self.pool.lock().unwrap();
        if let Some(mut obj) = pool.pop() {
            stats.available = pool.len();
            stats.reused += 1;
            
            // Resetta l'oggetto se necessario
            if let Some(reset) = &self.reset_fn {
                reset(&mut obj);
            }
            
            obj
        } else {
            // Crea un nuovo oggetto
            stats.created += 1;
            
            if let Some(init) = &self.initializer {
                init()
            } else {
                T::default()
            }
        }
    }
    
    /**
     * Ottiene un oggetto dal pool di dimensione specifica
     * 
     * @param size Dimensione richiesta
     * @return Oggetto dal pool
     */
    pub fn get_sized(&self, size: usize) -> T 
    where 
        T: Default + SizedItem
    {
        if let Some(size_pools) = &self.size_pools {
            let mut stats = self.stats.lock().unwrap();
            stats.total_allocations += 1;
            
            // Prova a ottenere un oggetto dal pool di dimensione specifica
            let mut pools = size_pools.lock().unwrap();
            if let Some(pool) = pools.get_mut(&size) {
                if let Some(mut obj) = pool.pop() {
                    stats.reused += 1;
                    
                    // Resetta l'oggetto se necessario
                    if let Some(reset) = &self.reset_fn {
                        reset(&mut obj);
                    }
                    
                    return obj;
                }
            }
            
            // Crea un nuovo oggetto della dimensione richiesta
            stats.created += 1;
            
            if let Some(init) = &self.initializer {
                let mut obj = init();
                obj.resize(size);
                obj
            } else {
                let mut obj = T::default();
                obj.resize(size);
                obj
            }
        } else {
            // Pooling per dimensione non abilitato, usa il pool normale
            self.get()
        }
    }
    
    /**
     * Restituisce un oggetto al pool
     * 
     * @param obj Oggetto da restituire
     */
    pub fn put(&self, obj: T) {
        let mut stats = self.stats.lock().unwrap();
        
        // Restituisci l'oggetto al pool se c'è spazio
        let mut pool = self.pool.lock().unwrap();
        if pool.len() < self.max_size {
            pool.push(obj);
            stats.available = pool.len();
        } else {
            stats.discarded += 1;
            // L'oggetto verrà deallocato automaticamente
        }
    }
    
    /**
     * Restituisce un oggetto al pool di dimensione specifica
     * 
     * @param obj Oggetto da restituire
     */
    pub fn put_sized(&self, obj: T) 
    where 
        T: SizedItem
    {
        if let Some(size_pools) = &self.size_pools {
            let size = obj.size();
            let mut stats = self.stats.lock().unwrap();
            
            // Restituisci l'oggetto al pool di dimensione specifica
            let mut pools = size_pools.lock().unwrap();
            let pool = pools.entry(size).or_insert_with(Vec::new);
            
            if pool.len() < self.max_size {
                pool.push(obj);
                stats.available += 1;
            } else {
                stats.discarded += 1;
                // L'oggetto verrà deallocato automaticamente
            }
        } else {
            // Pooling per dimensione non abilitato, usa il pool normale
            self.put(obj);
        }
    }
    
    /**
     * Ottiene le statistiche di utilizzo del pool
     * 
     * @return Statistiche di utilizzo
     */
    pub fn get_stats(&self) -> PoolStats {
        let stats = self.stats.lock().unwrap();
        stats.clone()
    }
    
    /**
     * Svuota il pool
     */
    pub fn clear(&self) {
        let mut pool = self.pool.lock().unwrap();
        pool.clear();
        
        if let Some(size_pools) = &self.size_pools {
            let mut pools = size_pools.lock().unwrap();
            pools.clear();
        }
        
        let mut stats = self.stats.lock().unwrap();
        stats.available = 0;
    }
    
    /**
     * Preallocazione di oggetti nel pool
     * 
     * @param count Numero di oggetti da preallocare
     */
    pub fn preallocate(&self, count: usize) 
    where 
        T: Default + Clone
    {
        let mut pool = self.pool.lock().unwrap();
        let current_len = pool.len();
        let to_add = count.min(self.max_size - current_len);
        
        for _ in 0..to_add {
            if let Some(init) = &self.initializer {
                pool.push(init());
            } else {
                pool.push(T::default());
            }
        }
        
        let mut stats = self.stats.lock().unwrap();
        stats.available = pool.len();
        stats.created += to_add;
    }
    
    /**
     * Ottiene la dimensione massima del pool
     * 
     * @return Dimensione massima
     */
    pub fn max_size(&self) -> usize {
        self.max_size
    }
    
    /**
     * Ottiene il numero di oggetti disponibili nel pool
     * 
     * @return Numero di oggetti disponibili
     */
    pub fn available(&self) -> usize {
        let pool = self.pool.lock().unwrap();
        pool.len()
    }
}

/// Trait per oggetti con dimensione variabile
pub trait SizedItem {
    /// Ottiene la dimensione dell'oggetto
    fn size(&self) -> usize;
    
    /// Ridimensiona l'oggetto
    fn resize(&mut self, size: usize);
}

// Implementazione per Vec<T>
impl<U> SizedItem for Vec<U> {
    fn size(&self) -> usize {
        self.capacity()
    }
    
    fn resize(&mut self, size: usize) {
        self.clear();
        self.reserve(size);
    }
}

// Implementazione per String
impl SizedItem for String {
    fn size(&self) -> usize {
        self.capacity()
    }
    
    fn resize(&mut self, size: usize) {
        self.clear();
        self.reserve(size);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_memory_pool() {
        // Crea un pool di memoria per Vec<u8>
        let pool = MemoryPool::<Vec<u8>>::new(10);
        
        // Ottieni un oggetto dal pool
        let mut vec = pool.get();
        vec.extend_from_slice(&[1, 2, 3, 4, 5]);
        
        // Restituisci l'oggetto al pool
        pool.put(vec);
        
        // Ottieni un altro oggetto dal pool (dovrebbe essere lo stesso)
        let vec2 = pool.get();
        
        // Verifica che l'oggetto sia stato riutilizzato
        assert_eq!(vec2.capacity(), 5);
        
        // Verifica le statistiche
        let stats = pool.get_stats();
        assert_eq!(stats.total_allocations, 2);
        assert_eq!(stats.reused, 1);
        assert_eq!(stats.created, 1);
    }
    
    #[test]
    fn test_memory_pool_with_initializer() {
        // Crea un pool di memoria con initializer
        let pool = MemoryPool::<Vec<u8>>::with_initializer(10, || {
            let mut vec = Vec::with_capacity(100);
            vec.push(0); // Inizializza con un elemento
            vec
        });
        
        // Ottieni un oggetto dal pool
        let vec = pool.get();
        
        // Verifica che l'oggetto sia stato inizializzato correttamente
        assert_eq!(vec.len(), 1);
        assert_eq!(vec[0], 0);
        assert_eq!(vec.capacity(), 100);
    }
    
    #[test]
    fn test_memory_pool_with_reset() {
        // Crea un pool di memoria con reset
        let mut pool = MemoryPool::<Vec<u8>>::new(10);
        pool.set_reset_function(|vec| {
            vec.clear();
            vec.push(42); // Reset con un valore specifico
        });
        
        // Ottieni un oggetto dal pool
        let mut vec = pool.get();
        vec.extend_from_slice(&[1, 2, 3, 4, 5]);
        
        // Restituisci l'oggetto al pool
        pool.put(vec);
        
        // Ottieni un altro oggetto dal pool
        let vec2 = pool.get();
        
        // Verifica che l'oggetto sia stato resettato
        assert_eq!(vec2.len(), 1);
        assert_eq!(vec2[0], 42);
    }
    
    #[test]
    fn test_sized_memory_pool() {
        // Crea un pool di memoria con pooling per dimensione
        let mut pool = MemoryPool::<Vec<u8>>::new(10);
        pool.enable_size_pooling();
        
        // Ottieni oggetti di diverse dimensioni
        let mut vec1 = pool.get_sized(10);
        vec1.extend_from_slice(&[1, 2, 3]);
        
        let mut vec2 = pool.get_sized(20);
        vec2.extend_from_slice(&[4, 5, 6]);
        
        // Restituisci gli oggetti al pool
        pool.put_sized(vec1);
        pool.put_sized(vec2);
        
        // Ottieni oggetti delle stesse dimensioni
        let vec1_reused = pool.get_sized(10);
        let vec2_reused = pool.get_sized(20);
        
        // Verifica che gli oggetti siano stati riutilizzati
        assert_eq!(vec1_reused.capacity(), 10);
        assert_eq!(vec2_reused.capacity(), 20);
        
        // Verifica le statistiche
        let stats = pool.get_stats();
        assert_eq!(stats.reused, 2);
    }
    
    #[test]
    fn test_memory_pool_max_size() {
        // Crea un pool di memoria con dimensione massima 2
        let pool = MemoryPool::<Vec<u8>>::new(2);
        
        // Ottieni e restituisci 3 oggetti
        let vec1 = pool.get();
        let vec2 = pool.get();
        let vec3 = pool.get();
        
        pool.put(vec1);
        pool.put(vec2);
        pool.put(vec3); // Questo dovrebbe essere scartato
        
        // Verifica che il pool contenga solo 2 oggetti
        assert_eq!(pool.available(), 2);
        
        // Verifica le statistiche
        let stats = pool.get_stats();
        assert_eq!(stats.discarded, 1);
    }
    
    #[test]
    fn test_memory_pool_preallocate() {
        // Crea un pool di memoria
        let pool = MemoryPool::<Vec<u8>>::new(5);
        
        // Preallocazione
        pool.preallocate(3);
        
        // Verifica che il pool contenga 3 oggetti
        assert_eq!(pool.available(), 3);
        
        // Verifica le statistiche
        let stats = pool.get_stats();
        assert_eq!(stats.created, 3);
        assert_eq!(stats.available, 3);
    }
}
