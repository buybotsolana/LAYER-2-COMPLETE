/**
 * Modulo di gestione degli errori per il Layer-2 su Solana
 * 
 * Questo modulo definisce i tipi di errore specifici per il sistema Layer-2
 * e fornisce funzionalità per la conversione tra errori del programma Solana
 * e errori specifici del Layer-2.
 */

use solana_program::{
    program_error::ProgramError,
    msg,
};
use thiserror::Error;

/// Errori specifici del Layer-2
#[derive(Error, Debug, Copy, Clone, PartialEq)]
pub enum Layer2Error {
    /// Errore generico
    #[error("Errore generico del Layer-2")]
    Generic,

    /// Istruzione non valida
    #[error("Istruzione non valida")]
    InvalidInstruction,

    /// Dati dell'account non validi
    #[error("Dati dell'account non validi")]
    InvalidAccountData,

    /// Indirizzo non valido
    #[error("Indirizzo non valido")]
    InvalidAddress,

    /// Importo non valido
    #[error("Importo non valido")]
    InvalidAmount,

    /// Nonce non valido
    #[error("Nonce non valido")]
    InvalidNonce,

    /// Firma non valida
    #[error("Firma non valida")]
    InvalidSignature,

    /// Prova non valida
    #[error("Prova non valida")]
    InvalidProof,

    /// Prova di Merkle non valida
    #[error("Prova di Merkle non valida")]
    InvalidMerkleProof,

    /// Root di Merkle non valido
    #[error("Root di Merkle non valido")]
    InvalidMerkleRoot,

    /// Transizione di stato non valida
    #[error("Transizione di stato non valida")]
    InvalidStateTransition,

    /// Sfida non valida
    #[error("Sfida non valida")]
    InvalidChallenge,

    /// Sequencer non valido
    #[error("Sequencer non valido")]
    InvalidSequencer,

    /// Batch non valido
    #[error("Batch non valido")]
    InvalidBatch,

    /// Batch vuoto
    #[error("Il batch non può essere vuoto")]
    EmptyBatch,

    /// Batch troppo grande
    #[error("Il batch supera la dimensione massima")]
    BatchTooLarge,

    /// Transazione scaduta
    #[error("La transazione è scaduta")]
    TransactionExpired,

    /// Batch scaduto
    #[error("Il batch è scaduto")]
    BatchExpired,

    /// Sfida scaduta
    #[error("La sfida è scaduta")]
    ChallengeExpired,

    /// Saldo insufficiente
    #[error("Saldo insufficiente")]
    InsufficientBalance,

    /// Mittente uguale al destinatario
    #[error("Il mittente e il destinatario non possono essere uguali")]
    SenderEqualsRecipient,

    /// Transazione già elaborata
    #[error("La transazione è già stata elaborata")]
    TransactionAlreadyProcessed,

    /// Limite di transazioni raggiunto
    #[error("Limite di transazioni raggiunto")]
    TransactionLimitReached,

    /// Limite di batch raggiunto
    #[error("Limite di batch raggiunto")]
    BatchLimitReached,

    /// Periodo di contestazione non terminato
    #[error("Il periodo di contestazione non è ancora terminato")]
    ContestationPeriodNotEnded,

    /// Periodo di contestazione terminato
    #[error("Il periodo di contestazione è terminato")]
    ContestationPeriodEnded,

    /// Operazione non autorizzata
    #[error("Operazione non autorizzata")]
    Unauthorized,

    /// Operazione non supportata
    #[error("Operazione non supportata")]
    Unsupported,

    /// Errore di overflow aritmetico
    #[error("Overflow aritmetico")]
    ArithmeticOverflow,

    /// Errore di underflow aritmetico
    #[error("Underflow aritmetico")]
    ArithmeticUnderflow,

    /// Errore di divisione per zero
    #[error("Divisione per zero")]
    DivisionByZero,

    /// Errore di serializzazione
    #[error("Errore di serializzazione")]
    SerializationError,

    /// Errore di deserializzazione
    #[error("Errore di deserializzazione")]
    DeserializationError,

    /// Errore di compressione
    #[error("Errore di compressione")]
    CompressionError,

    /// Errore di decompressione
    #[error("Errore di decompressione")]
    DecompressionError,

    /// Errore di rete
    #[error("Errore di rete")]
    NetworkError,

    /// Timeout
    #[error("Timeout")]
    Timeout,

    /// Errore di database
    #[error("Errore di database")]
    DatabaseError,

    /// Errore di cache
    #[error("Errore di cache")]
    CacheError,

    /// Errore di configurazione
    #[error("Errore di configurazione")]
    ConfigurationError,

    /// Errore interno
    #[error("Errore interno")]
    InternalError,
}

impl From<Layer2Error> for ProgramError {
    fn from(e: Layer2Error) -> Self {
        ProgramError::Custom(e as u32)
    }
}

impl From<ProgramError> for Layer2Error {
    fn from(e: ProgramError) -> Self {
        match e {
            ProgramError::Custom(code) => {
                if code < 100 {
                    // Assumiamo che i codici di errore personalizzati sotto 100 siano errori del Layer-2
                    unsafe { std::mem::transmute::<u32, Layer2Error>(code) }
                } else {
                    Layer2Error::Generic
                }
            }
            ProgramError::InvalidArgument => Layer2Error::InvalidInstruction,
            ProgramError::InvalidAccountData => Layer2Error::InvalidAccountData,
            ProgramError::AccountDataTooSmall => Layer2Error::InvalidAccountData,
            ProgramError::InsufficientFunds => Layer2Error::InsufficientBalance,
            ProgramError::IncorrectProgramId => Layer2Error::Unauthorized,
            ProgramError::MissingRequiredSignature => Layer2Error::InvalidSignature,
            ProgramError::AccountAlreadyInitialized => Layer2Error::InvalidAccountData,
            ProgramError::UninitializedAccount => Layer2Error::InvalidAccountData,
            ProgramError::NotEnoughAccountKeys => Layer2Error::InvalidInstruction,
            ProgramError::AccountBorrowFailed => Layer2Error::InternalError,
            ProgramError::MaxSeedLengthExceeded => Layer2Error::InvalidInstruction,
            ProgramError::InvalidSeeds => Layer2Error::InvalidInstruction,
            ProgramError::BorshIoError(_) => Layer2Error::SerializationError,
            ProgramError::AccountNotRentExempt => Layer2Error::InvalidAccountData,
            ProgramError::UnsupportedSysvar => Layer2Error::Unsupported,
            ProgramError::IllegalOwner => Layer2Error::Unauthorized,
            _ => Layer2Error::Generic,
        }
    }
}

/// Funzione di utilità per registrare un errore e convertirlo in ProgramError
pub fn handle_error(error: Layer2Error) -> ProgramError {
    msg!("Errore Layer-2: {}", error.to_string());
    error.into()
}

/// Funzione di utilità per registrare un errore con un messaggio personalizzato e convertirlo in ProgramError
pub fn handle_error_with_message(error: Layer2Error, message: &str) -> ProgramError {
    msg!("Errore Layer-2: {} - {}", error.to_string(), message);
    error.into()
}

/// Funzione di utilità per verificare una condizione e restituire un errore se la condizione è falsa
pub fn require(condition: bool, error: Layer2Error) -> Result<(), ProgramError> {
    if !condition {
        Err(handle_error(error))
    } else {
        Ok(())
    }
}

/// Funzione di utilità per verificare una condizione con un messaggio personalizzato
pub fn require_with_message(condition: bool, error: Layer2Error, message: &str) -> Result<(), ProgramError> {
    if !condition {
        Err(handle_error_with_message(error, message))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_conversion() {
        // Test di conversione da Layer2Error a ProgramError e viceversa
        let original_error = Layer2Error::InvalidSignature;
        let program_error: ProgramError = original_error.into();
        
        if let ProgramError::Custom(code) = program_error {
            let converted_error: Layer2Error = unsafe { std::mem::transmute(code) };
            assert_eq!(original_error, converted_error);
        } else {
            panic!("Errore nella conversione da Layer2Error a ProgramError");
        }
    }

    #[test]
    fn test_program_error_conversion() {
        // Test di conversione da ProgramError a Layer2Error
        let program_error = ProgramError::InvalidArgument;
        let layer2_error: Layer2Error = program_error.into();
        assert_eq!(layer2_error, Layer2Error::InvalidInstruction);
        
        let program_error = ProgramError::InsufficientFunds;
        let layer2_error: Layer2Error = program_error.into();
        assert_eq!(layer2_error, Layer2Error::InsufficientBalance);
    }

    #[test]
    fn test_require_function() {
        // Test della funzione require con condizione vera
        let result = require(true, Layer2Error::InvalidSignature);
        assert!(result.is_ok());
        
        // Test della funzione require con condizione falsa
        let result = require(false, Layer2Error::InvalidSignature);
        assert!(result.is_err());
        
        if let Err(ProgramError::Custom(code)) = result {
            let error: Layer2Error = unsafe { std::mem::transmute(code) };
            assert_eq!(error, Layer2Error::InvalidSignature);
        } else {
            panic!("Errore nel test della funzione require");
        }
    }
}
