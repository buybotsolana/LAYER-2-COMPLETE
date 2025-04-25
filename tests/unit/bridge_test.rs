// src/bridge/bridge_test.rs
#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::token_bridge::{TokenBridge, DepositEvent, WithdrawalEvent, TokenType};
    
    #[test]
    fn test_deposit_eth() {
        // Create a token bridge instance
        let mut bridge = TokenBridge::new();
        
        // Create a deposit event for ETH
        let deposit_event = DepositEvent {
            l1_sender: [1; 20],
            l2_recipient: [2; 32],
            token_type: TokenType::ETH,
            amount: 1_000_000_000_000_000_000, // 1 ETH in wei
            l1_tx_hash: [3; 32],
            l1_block_number: 100,
            l1_timestamp: 1000,
        };
        
        // Process the deposit
        let result = bridge.process_deposit(deposit_event.clone());
        assert!(result.is_ok(), "Deposit processing failed");
        
        // Verify the deposit was recorded
        let deposits = bridge.get_deposits_by_recipient(deposit_event.l2_recipient);
        assert_eq!(deposits.len(), 1, "Should have one deposit");
        assert_eq!(deposits[0].token_type, TokenType::ETH, "Deposit should be ETH");
        assert_eq!(deposits[0].amount, deposit_event.amount, "Deposit amount should match");
        
        // Verify the balance was updated
        let balance = bridge.get_balance(deposit_event.l2_recipient, TokenType::ETH);
        assert_eq!(balance, deposit_event.amount, "Balance should match deposit amount");
    }
    
    #[test]
    fn test_deposit_erc20() {
        // Create a token bridge instance
        let mut bridge = TokenBridge::new();
        
        // Create a deposit event for USDC
        let deposit_event = DepositEvent {
            l1_sender: [1; 20],
            l2_recipient: [2; 32],
            token_type: TokenType::USDC,
            amount: 1_000_000, // 1 USDC (assuming 6 decimals)
            l1_tx_hash: [3; 32],
            l1_block_number: 100,
            l1_timestamp: 1000,
        };
        
        // Process the deposit
        let result = bridge.process_deposit(deposit_event.clone());
        assert!(result.is_ok(), "Deposit processing failed");
        
        // Verify the deposit was recorded
        let deposits = bridge.get_deposits_by_recipient(deposit_event.l2_recipient);
        assert_eq!(deposits.len(), 1, "Should have one deposit");
        assert_eq!(deposits[0].token_type, TokenType::USDC, "Deposit should be USDC");
        assert_eq!(deposits[0].amount, deposit_event.amount, "Deposit amount should match");
        
        // Verify the balance was updated
        let balance = bridge.get_balance(deposit_event.l2_recipient, TokenType::USDC);
        assert_eq!(balance, deposit_event.amount, "Balance should match deposit amount");
    }
    
    #[test]
    fn test_multiple_deposits() {
        // Create a token bridge instance
        let mut bridge = TokenBridge::new();
        
        // Create a recipient
        let recipient = [2; 32];
        
        // Create multiple deposit events
        let deposit_events = vec![
            DepositEvent {
                l1_sender: [1; 20],
                l2_recipient: recipient,
                token_type: TokenType::ETH,
                amount: 1_000_000_000_000_000_000, // 1 ETH in wei
                l1_tx_hash: [3; 32],
                l1_block_number: 100,
                l1_timestamp: 1000,
            },
            DepositEvent {
                l1_sender: [1; 20],
                l2_recipient: recipient,
                token_type: TokenType::ETH,
                amount: 2_000_000_000_000_000_000, // 2 ETH in wei
                l1_tx_hash: [4; 32],
                l1_block_number: 101,
                l1_timestamp: 1001,
            },
            DepositEvent {
                l1_sender: [1; 20],
                l2_recipient: recipient,
                token_type: TokenType::USDC,
                amount: 1_000_000, // 1 USDC (assuming 6 decimals)
                l1_tx_hash: [5; 32],
                l1_block_number: 102,
                l1_timestamp: 1002,
            },
        ];
        
        // Process all deposits
        for event in deposit_events.iter() {
            let result = bridge.process_deposit(event.clone());
            assert!(result.is_ok(), "Deposit processing failed");
        }
        
        // Verify the deposits were recorded
        let deposits = bridge.get_deposits_by_recipient(recipient);
        assert_eq!(deposits.len(), 3, "Should have three deposits");
        
        // Verify the balances were updated
        let eth_balance = bridge.get_balance(recipient, TokenType::ETH);
        assert_eq!(eth_balance, 3_000_000_000_000_000_000, "ETH balance should be 3 ETH");
        
        let usdc_balance = bridge.get_balance(recipient, TokenType::USDC);
        assert_eq!(usdc_balance, 1_000_000, "USDC balance should be 1 USDC");
    }
    
    #[test]
    fn test_withdrawal() {
        // Create a token bridge instance
        let mut bridge = TokenBridge::new();
        
        // Create a sender
        let sender = [2; 32];
        
        // Deposit some ETH first
        let deposit_event = DepositEvent {
            l1_sender: [1; 20],
            l2_recipient: sender,
            token_type: TokenType::ETH,
            amount: 5_000_000_000_000_000_000, // 5 ETH in wei
            l1_tx_hash: [3; 32],
            l1_block_number: 100,
            l1_timestamp: 1000,
        };
        
        let result = bridge.process_deposit(deposit_event.clone());
        assert!(result.is_ok(), "Deposit processing failed");
        
        // Create a withdrawal
        let withdrawal_amount = 2_000_000_000_000_000_000; // 2 ETH in wei
        let l1_recipient = [3; 20];
        
        let result = bridge.initiate_withdrawal(
            sender,
            l1_recipient,
            TokenType::ETH,
            withdrawal_amount,
            1,
            1100,
        );
        
        assert!(result.is_ok(), "Withdrawal initiation failed");
        
        // Get the withdrawal ID
        let withdrawal_id = result.unwrap();
        
        // Verify the withdrawal was recorded
        let withdrawal = bridge.get_withdrawal(withdrawal_id);
        assert!(withdrawal.is_some(), "Withdrawal should exist");
        
        let withdrawal = withdrawal.unwrap();
        assert_eq!(withdrawal.l2_sender, sender, "Withdrawal sender should match");
        assert_eq!(withdrawal.l1_recipient, l1_recipient, "Withdrawal recipient should match");
        assert_eq!(withdrawal.token_type, TokenType::ETH, "Withdrawal token type should be ETH");
        assert_eq!(withdrawal.amount, withdrawal_amount, "Withdrawal amount should match");
        
        // Verify the balance was updated
        let balance = bridge.get_balance(sender, TokenType::ETH);
        assert_eq!(balance, 3_000_000_000_000_000_000, "Balance should be 3 ETH after withdrawal");
    }
    
    #[test]
    fn test_withdrawal_insufficient_balance() {
        // Create a token bridge instance
        let mut bridge = TokenBridge::new();
        
        // Create a sender
        let sender = [2; 32];
        
        // Deposit some ETH first
        let deposit_event = DepositEvent {
            l1_sender: [1; 20],
            l2_recipient: sender,
            token_type: TokenType::ETH,
            amount: 1_000_000_000_000_000_000, // 1 ETH in wei
            l1_tx_hash: [3; 32],
            l1_block_number: 100,
            l1_timestamp: 1000,
        };
        
        let result = bridge.process_deposit(deposit_event.clone());
        assert!(result.is_ok(), "Deposit processing failed");
        
        // Try to withdraw more than the balance
        let withdrawal_amount = 2_000_000_000_000_000_000; // 2 ETH in wei
        let l1_recipient = [3; 20];
        
        let result = bridge.initiate_withdrawal(
            sender,
            l1_recipient,
            TokenType::ETH,
            withdrawal_amount,
            1,
            1100,
        );
        
        assert!(result.is_err(), "Withdrawal should fail due to insufficient balance");
    }
    
    #[test]
    fn test_withdrawal_completion() {
        // Create a token bridge instance
        let mut bridge = TokenBridge::new();
        
        // Create a sender
        let sender = [2; 32];
        
        // Deposit some ETH first
        let deposit_event = DepositEvent {
            l1_sender: [1; 20],
            l2_recipient: sender,
            token_type: TokenType::ETH,
            amount: 5_000_000_000_000_000_000, // 5 ETH in wei
            l1_tx_hash: [3; 32],
            l1_block_number: 100,
            l1_timestamp: 1000,
        };
        
        let result = bridge.process_deposit(deposit_event.clone());
        assert!(result.is_ok(), "Deposit processing failed");
        
        // Create a withdrawal
        let withdrawal_amount = 2_000_000_000_000_000_000; // 2 ETH in wei
        let l1_recipient = [3; 20];
        
        let result = bridge.initiate_withdrawal(
            sender,
            l1_recipient,
            TokenType::ETH,
            withdrawal_amount,
            1,
            1100,
        );
        
        assert!(result.is_ok(), "Withdrawal initiation failed");
        
        // Get the withdrawal ID
        let withdrawal_id = result.unwrap();
        
        // Complete the withdrawal
        let result = bridge.complete_withdrawal(withdrawal_id, 200, 2000);
        assert!(result.is_ok(), "Withdrawal completion failed");
        
        // Verify the withdrawal status
        let withdrawal = bridge.get_withdrawal(withdrawal_id);
        assert!(withdrawal.is_some(), "Withdrawal should exist");
        
        let withdrawal = withdrawal.unwrap();
        assert!(withdrawal.completed, "Withdrawal should be marked as completed");
        assert_eq!(withdrawal.l1_block_number, Some(200), "L1 block number should be set");
        assert_eq!(withdrawal.l1_timestamp, Some(2000), "L1 timestamp should be set");
    }
    
    #[test]
    fn test_withdrawal_events() {
        // Create a token bridge instance
        let mut bridge = TokenBridge::new();
        
        // Create a sender
        let sender = [2; 32];
        
        // Deposit some ETH first
        let deposit_event = DepositEvent {
            l1_sender: [1; 20],
            l2_recipient: sender,
            token_type: TokenType::ETH,
            amount: 5_000_000_000_000_000_000, // 5 ETH in wei
            l1_tx_hash: [3; 32],
            l1_block_number: 100,
            l1_timestamp: 1000,
        };
        
        let result = bridge.process_deposit(deposit_event.clone());
        assert!(result.is_ok(), "Deposit processing failed");
        
        // Create a withdrawal
        let withdrawal_amount = 2_000_000_000_000_000_000; // 2 ETH in wei
        let l1_recipient = [3; 20];
        
        let result = bridge.initiate_withdrawal(
            sender,
            l1_recipient,
            TokenType::ETH,
            withdrawal_amount,
            1,
            1100,
        );
        
        assert!(result.is_ok(), "Withdrawal initiation failed");
        
        // Get the withdrawal events
        let events = bridge.get_withdrawal_events();
        assert_eq!(events.len(), 1, "Should have one withdrawal event");
        
        let event = &events[0];
        assert_eq!(event.l2_sender, sender, "Event sender should match");
        assert_eq!(event.l1_recipient, l1_recipient, "Event recipient should match");
        assert_eq!(event.token_type, TokenType::ETH, "Event token type should be ETH");
        assert_eq!(event.amount, withdrawal_amount, "Event amount should match");
    }
    
    #[test]
    fn test_deposit_and_withdrawal_flow() {
        // Create a token bridge instance
        let mut bridge = TokenBridge::new();
        
        // Create users
        let user1 = [1; 32];
        let user2 = [2; 32];
        let l1_user1 = [1; 20];
        let l1_user2 = [2; 20];
        
        // User 1 deposits ETH
        let deposit_event1 = DepositEvent {
            l1_sender: l1_user1,
            l2_recipient: user1,
            token_type: TokenType::ETH,
            amount: 10_000_000_000_000_000_000, // 10 ETH in wei
            l1_tx_hash: [3; 32],
            l1_block_number: 100,
            l1_timestamp: 1000,
        };
        
        bridge.process_deposit(deposit_event1.clone()).unwrap();
        
        // User 2 deposits USDC
        let deposit_event2 = DepositEvent {
            l1_sender: l1_user2,
            l2_recipient: user2,
            token_type: TokenType::USDC,
            amount: 5_000_000, // 5 USDC (assuming 6 decimals)
            l1_tx_hash: [4; 32],
            l1_block_number: 101,
            l1_timestamp: 1001,
        };
        
        bridge.process_deposit(deposit_event2.clone()).unwrap();
        
        // User 1 withdraws some ETH
        let withdrawal_id1 = bridge.initiate_withdrawal(
            user1,
            l1_user1,
            TokenType::ETH,
            3_000_000_000_000_000_000, // 3 ETH in wei
            1,
            1100,
        ).unwrap();
        
        // User 2 withdraws some USDC
        let withdrawal_id2 = bridge.initiate_withdrawal(
            user2,
            l1_user2,
            TokenType::USDC,
            2_000_000, // 2 USDC
            1,
            1101,
        ).unwrap();
        
        // Complete the withdrawals
        bridge.complete_withdrawal(withdrawal_id1, 200, 2000).unwrap();
        bridge.complete_withdrawal(withdrawal_id2, 201, 2001).unwrap();
        
        // Verify final balances
        let user1_eth_balance = bridge.get_balance(user1, TokenType::ETH);
        assert_eq!(user1_eth_balance, 7_000_000_000_000_000_000, "User 1 should have 7 ETH left");
        
        let user2_usdc_balance = bridge.get_balance(user2, TokenType::USDC);
        assert_eq!(user2_usdc_balance, 3_000_000, "User 2 should have 3 USDC left");
    }
}
