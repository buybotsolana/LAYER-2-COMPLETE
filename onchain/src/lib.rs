/**
 * Modulo principale del programma Layer-2 su Solana
 * 
 * Questo modulo definisce l'entrypoint del programma e include tutti i moduli necessari
 * per il funzionamento del sistema Layer-2.
 */

use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    pubkey::Pubkey,
    msg,
};

// Moduli del programma
pub mod error;
pub mod instruction;
pub mod processor;
pub mod state;
pub mod validation;
pub mod processor_deposit;
pub mod processor_transfer;
pub mod processor_withdrawal;

// Utilizzo dei moduli
use crate::processor::Processor;

// Entrypoint del programma
entrypoint!(process_instruction);

/// Funzione di entrypoint del programma
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    msg!("Layer-2: Inizio elaborazione istruzione");
    
    // Registra l'ID del programma
    msg!("Program ID: {}", program_id);
    
    // Registra il numero di account
    msg!("Numero di account: {}", accounts.len());
    
    // Registra la dimensione dei dati dell'istruzione
    msg!("Dimensione dati istruzione: {}", instruction_data.len());
    
    // Elabora l'istruzione
    let result = Processor::process(program_id, accounts, instruction_data);
    
    // Registra il risultato
    match &result {
        Ok(_) => msg!("Layer-2: Istruzione elaborata con successo"),
        Err(e) => msg!("Layer-2: Errore nell'elaborazione dell'istruzione: {:?}", e),
    }
    
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_program::clock::Epoch;
    use solana_program::instruction::{AccountMeta, Instruction};
    use solana_program::program_pack::Pack;
    use crate::instruction::Layer2Instruction;
    use crate::state::Layer2State;
    
    // Test per l'entrypoint
    #[test]
    fn test_entrypoint() {
        // Crea un program_id
        let program_id = Pubkey::new_unique();
        
        // Crea gli account necessari
        let state_key = Pubkey::new_unique();
        let sequencer_key = Pubkey::new_unique();
        
        let mut state_lamports = 0;
        let mut state_data = vec![0; Layer2State::LEN];
        let state_account_info = AccountInfo::new(
            &state_key,
            true,
            true,
            &mut state_lamports,
            &mut state_data,
            &program_id,
            false,
            Epoch::default(),
        );
        
        let mut sequencer_lamports = 1000000;
        let mut sequencer_data = vec![];
        let sequencer_account_info = AccountInfo::new(
            &sequencer_key,
            true,
            false,
            &mut sequencer_lamports,
            &mut sequencer_data,
            &Pubkey::default(),
            false,
            Epoch::default(),
        );
        
        let mut system_program_lamports = 0;
        let mut system_program_data = vec![];
        let system_program_account_info = AccountInfo::new(
            &solana_program::system_program::id(),
            false,
            false,
            &mut system_program_lamports,
            &mut system_program_data,
            &Pubkey::default(),
            false,
            Epoch::default(),
        );
        
        let mut rent_lamports = 0;
        let mut rent_data = vec![];
        let rent_account_info = AccountInfo::new(
            &solana_program::sysvar::rent::id(),
            false,
            false,
            &mut rent_lamports,
            &mut rent_data,
            &Pubkey::default(),
            false,
            Epoch::default(),
        );
        
        let accounts = vec![
            state_account_info,
            sequencer_account_info,
            system_program_account_info,
            rent_account_info,
        ];
        
        // Crea l'istruzione di inizializzazione
        let instruction_data = Layer2Instruction::Initialize { version: 1 }.serialize();
        
        // Esegui l'istruzione
        let result = process_instruction(&program_id, &accounts, &instruction_data);
        
        // Verifica che l'istruzione sia stata eseguita con successo
        assert!(result.is_ok());
    }
}
