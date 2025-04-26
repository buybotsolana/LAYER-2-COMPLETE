#!/usr/bin/env python3
# real_blockchain_test.py - Real Blockchain Tests for Layer-2 on Solana

import os
import sys
import time
import json
import argparse
import hashlib
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    from solana.rpc.api import Client
    from solana.rpc.types import TxOpts
    from solana.keypair import Keypair
    from solana.publickey import PublicKey
    from solana.transaction import Transaction, TransactionInstruction, AccountMeta
    import solana.system_program as sp
except ImportError:
    print("Error: Required Solana packages not found.")
    print("Please install them using: pip install solana")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("Error: Required 'requests' package not found.")
    print("Please install it using: pip install requests")
    sys.exit(1)

# Configuration
DEFAULT_SOLANA_ENDPOINT = "https://api.devnet.solana.com"
DEFAULT_PROGRAM_ID = "Layer2CompleteProgramId"  # Replace with actual program ID
DEFAULT_NUM_OPERATIONS = 100
DEFAULT_NUM_THREADS = 5
DEFAULT_OUTPUT_FILE = "real_blockchain_test_results.json"

# Test wallet generation
def generate_test_wallets(num_wallets):
    """Generate test wallets for the test"""
    wallets = []
    for _ in range(num_wallets):
        wallet = Keypair()
        wallets.append(wallet)
    return wallets

# Fund test wallets
def fund_test_wallets(client, wallets, amount_sol=1.0):
    """Fund test wallets with SOL from airdrop"""
    funded_wallets = []
    
    print(f"Funding {len(wallets)} test wallets with {amount_sol} SOL each...")
    
    for wallet in wallets:
        try:
            # Request airdrop
            airdrop_signature = client.request_airdrop(
                wallet.public_key, 
                int(amount_sol * 1_000_000_000)  # Convert SOL to lamports
            )
            
            # Wait for confirmation
            client.confirm_transaction(airdrop_signature['result'])
            
            # Verify balance
            balance = client.get_balance(wallet.public_key)
            if balance['result']['value'] > 0:
                funded_wallets.append(wallet)
                print(f"Funded wallet {wallet.public_key} with {amount_sol} SOL")
            else:
                print(f"Failed to fund wallet {wallet.public_key}")
        except Exception as e:
            print(f"Error funding wallet {wallet.public_key}: {str(e)}")
    
    print(f"Successfully funded {len(funded_wallets)}/{len(wallets)} wallets")
    return funded_wallets

# Test functions for each component
def test_fraud_proof_system(client, program_id, wallet):
    """Test the Fraud Proof System on real blockchain"""
    try:
        # Create a transaction to submit a fraud proof
        transaction = Transaction()
        
        # Generate random proof data
        proof_data = {
            'block_number': int(time.time()),
            'transaction_index': int(time.time() % 1000),
            'pre_state': hashlib.sha256(str(time.time()).encode()).hexdigest(),
            'post_state': hashlib.sha256(str(time.time() + 1).encode()).hexdigest(),
            'witness': hashlib.sha256(str(time.time() + 2).encode()).hexdigest()
        }
        
        # Serialize proof data
        serialized_data = json.dumps(proof_data).encode()
        
        # Create instruction data
        # Format: [0, ...proof_data]
        # 0 indicates FraudProofSystem instruction type
        instruction_data = bytes([0]) + serialized_data
        
        # Add instruction to transaction
        transaction.add(
            TransactionInstruction(
                keys=[
                    AccountMeta(pubkey=wallet.public_key, is_signer=True, is_writable=True),
                    # Add other required accounts here
                ],
                program_id=PublicKey(program_id),
                data=instruction_data
            )
        )
        
        # Sign and send transaction
        start_time = time.time()
        signature = client.send_transaction(
            transaction, 
            wallet, 
            opts=TxOpts(skip_preflight=False, preflight_commitment="confirmed")
        )
        
        # Wait for confirmation
        status = client.confirm_transaction(signature['result'])
        end_time = time.time()
        
        # Check result
        if status['result']['value'].get('err') is None:
            return {
                'success': True,
                'signature': signature['result'],
                'duration': end_time - start_time,
                'proof_data': proof_data
            }
        else:
            return {
                'success': False,
                'error': status['result']['value']['err'],
                'duration': end_time - start_time,
                'proof_data': proof_data
            }
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'duration': 0,
            'proof_data': proof_data if 'proof_data' in locals() else None
        }

def test_finalization_system(client, program_id, wallet):
    """Test the Finalization System on real blockchain"""
    try:
        # Create a transaction to propose a block
        transaction = Transaction()
        
        # Generate random block data
        block_data = {
            'block_number': int(time.time()),
            'parent_hash': hashlib.sha256(str(time.time()).encode()).hexdigest(),
            'state_root': hashlib.sha256(str(time.time() + 1).encode()).hexdigest(),
            'transactions_root': hashlib.sha256(str(time.time() + 2).encode()).hexdigest(),
            'timestamp': int(time.time())
        }
        
        # Serialize block data
        serialized_data = json.dumps(block_data).encode()
        
        # Create instruction data
        # Format: [1, ...block_data]
        # 1 indicates Finalization instruction type
        instruction_data = bytes([1]) + serialized_data
        
        # Add instruction to transaction
        transaction.add(
            TransactionInstruction(
                keys=[
                    AccountMeta(pubkey=wallet.public_key, is_signer=True, is_writable=True),
                    # Add other required accounts here
                ],
                program_id=PublicKey(program_id),
                data=instruction_data
            )
        )
        
        # Sign and send transaction
        start_time = time.time()
        signature = client.send_transaction(
            transaction, 
            wallet, 
            opts=TxOpts(skip_preflight=False, preflight_commitment="confirmed")
        )
        
        # Wait for confirmation
        status = client.confirm_transaction(signature['result'])
        end_time = time.time()
        
        # Check result
        if status['result']['value'].get('err') is None:
            return {
                'success': True,
                'signature': signature['result'],
                'duration': end_time - start_time,
                'block_data': block_data
            }
        else:
            return {
                'success': False,
                'error': status['result']['value']['err'],
                'duration': end_time - start_time,
                'block_data': block_data
            }
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'duration': 0,
            'block_data': block_data if 'block_data' in locals() else None
        }

def test_bridge_deposit(client, program_id, wallet):
    """Test the Bridge deposit functionality on real blockchain"""
    try:
        # Create a transaction to process a deposit
        transaction = Transaction()
        
        # Generate random deposit data
        deposit_data = {
            'l1_tx_hash': hashlib.sha256(str(time.time()).encode()).hexdigest(),
            'l1_block_number': int(time.time()),
            'l1_sender': '0x' + ''.join([hex(int(time.time() * 1000))[2:] for _ in range(5)]),
            'l2_recipient': str(wallet.public_key),
            'token': '0x' + hashlib.sha256(str(time.time() + 1).encode()).hexdigest()[:40],
            'amount': int(time.time() % 1000000000)
        }
        
        # Serialize deposit data
        serialized_data = json.dumps(deposit_data).encode()
        
        # Create instruction data
        # Format: [2, 0, ...deposit_data]
        # 2 indicates Bridge instruction type, 0 indicates deposit operation
        instruction_data = bytes([2, 0]) + serialized_data
        
        # Add instruction to transaction
        transaction.add(
            TransactionInstruction(
                keys=[
                    AccountMeta(pubkey=wallet.public_key, is_signer=True, is_writable=True),
                    # Add other required accounts here
                ],
                program_id=PublicKey(program_id),
                data=instruction_data
            )
        )
        
        # Sign and send transaction
        start_time = time.time()
        signature = client.send_transaction(
            transaction, 
            wallet, 
            opts=TxOpts(skip_preflight=False, preflight_commitment="confirmed")
        )
        
        # Wait for confirmation
        status = client.confirm_transaction(signature['result'])
        end_time = time.time()
        
        # Check result
        if status['result']['value'].get('err') is None:
            return {
                'success': True,
                'signature': signature['result'],
                'duration': end_time - start_time,
                'deposit_data': deposit_data
            }
        else:
            return {
                'success': False,
                'error': status['result']['value']['err'],
                'duration': end_time - start_time,
                'deposit_data': deposit_data
            }
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'duration': 0,
            'deposit_data': deposit_data if 'deposit_data' in locals() else None
        }

def test_bridge_withdrawal(client, program_id, wallet):
    """Test the Bridge withdrawal functionality on real blockchain"""
    try:
        # Create a transaction to process a withdrawal
        transaction = Transaction()
        
        # Generate random withdrawal data
        withdrawal_data = {
            'l2_tx_hash': hashlib.sha256(str(time.time()).encode()).hexdigest(),
            'l2_block_number': int(time.time()),
            'l2_sender': str(wallet.public_key),
            'l1_recipient': '0x' + ''.join([hex(int(time.time() * 1000))[2:] for _ in range(5)]),
            'token': '0x' + hashlib.sha256(str(time.time() + 1).encode()).hexdigest()[:40],
            'amount': int(time.time() % 1000000000)
        }
        
        # Serialize withdrawal data
        serialized_data = json.dumps(withdrawal_data).encode()
        
        # Create instruction data
        # Format: [2, 1, ...withdrawal_data]
        # 2 indicates Bridge instruction type, 1 indicates withdrawal operation
        instruction_data = bytes([2, 1]) + serialized_data
        
        # Add instruction to transaction
        transaction.add(
            TransactionInstruction(
                keys=[
                    AccountMeta(pubkey=wallet.public_key, is_signer=True, is_writable=True),
                    # Add other required accounts here
                ],
                program_id=PublicKey(program_id),
                data=instruction_data
            )
        )
        
        # Sign and send transaction
        start_time = time.time()
        signature = client.send_transaction(
            transaction, 
            wallet, 
            opts=TxOpts(skip_preflight=False, preflight_commitment="confirmed")
        )
        
        # Wait for confirmation
        status = client.confirm_transaction(signature['result'])
        end_time = time.time()
        
        # Check result
        if status['result']['value'].get('err') is None:
            return {
                'success': True,
                'signature': signature['result'],
                'duration': end_time - start_time,
                'withdrawal_data': withdrawal_data
            }
        else:
            return {
                'success': False,
                'error': status['result']['value']['err'],
                'duration': end_time - start_time,
                'withdrawal_data': withdrawal_data
            }
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'duration': 0,
            'withdrawal_data': withdrawal_data if 'withdrawal_data' in locals() else None
        }

def check_transaction_volume(client, program_id, start_time, end_time):
    """Check transaction volume for the program during the test period"""
    try:
        # Get signatures for the program
        signatures = client.get_signatures_for_address(
            PublicKey(program_id),
            start_slot=None,
            end_slot=None
        )
        
        if 'result' not in signatures or not signatures['result']:
            return {
                'success': False,
                'error': 'No signatures found',
                'volume': 0
            }
        
        # Filter signatures by time
        filtered_signatures = [
            sig for sig in signatures['result']
            if sig['blockTime'] >= start_time and sig['blockTime'] <= end_time
        ]
        
        return {
            'success': True,
            'volume': len(filtered_signatures),
            'signatures': [sig['signature'] for sig in filtered_signatures[:10]]  # Return first 10 signatures
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'volume': 0
        }

def check_price_and_slippage(token_address):
    """Check price and slippage for a token using DexScreener API"""
    try:
        # Use DexScreener API to get token info
        url = f"https://api.dexscreener.com/latest/dex/tokens/{token_address}"
        response = requests.get(url)
        
        if response.status_code != 200:
            return {
                'success': False,
                'error': f"API returned status code {response.status_code}",
                'price': None,
                'slippage': None
            }
        
        data = response.json()
        
        if 'pairs' not in data or not data['pairs']:
            return {
                'success': False,
                'error': 'No pairs found for token',
                'price': None,
                'slippage': None
            }
        
        # Get the first pair
        pair = data['pairs'][0]
        
        # Calculate slippage (difference between price and price impact)
        price = float(pair['priceUsd'])
        price_impact = float(pair.get('priceChange', {}).get('h24', '0').replace('%', '')) / 100
        slippage = abs(price_impact)
        
        return {
            'success': True,
            'price': price,
            'slippage': slippage,
            'volume_24h': pair.get('volume', {}).get('h24', 0),
            'liquidity': pair.get('liquidity', {}).get('usd', 0)
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'price': None,
            'slippage': None
        }

def run_real_blockchain_tests(args):
    """Run tests on real blockchain"""
    # Initialize Solana client
    client = Client(args.endpoint)
    
    # Check connection
    try:
        version = client.get_version()
        print(f"Connected to Solana node. Version: {version['result']['solana-core']}")
    except Exception as e:
        print(f"Error connecting to Solana node: {str(e)}")
        return {
            'success': False,
            'error': str(e)
        }
    
    # Generate and fund test wallets
    wallets = generate_test_wallets(args.threads)
    funded_wallets = fund_test_wallets(client, wallets)
    
    if not funded_wallets:
        print("Error: Failed to fund any test wallets")
        return {
            'success': False,
            'error': 'Failed to fund test wallets'
        }
    
    # Record start time
    start_time = time.time()
    
    # Initialize results
    results = {
        'fraud_proof_system': [],
        'finalization_system': [],
        'bridge_deposit': [],
        'bridge_withdrawal': []
    }
    
    # Run tests in parallel
    with ThreadPoolExecutor(max_workers=args.threads) as executor:
        # Distribute operations among components
        operations_per_component = args.operations // 4
        
        # Submit fraud proof system tests
        fraud_proof_futures = [
            executor.submit(test_fraud_proof_system, client, args.program_id, wallet)
            for wallet in funded_wallets[:args.threads]
            for _ in range(operations_per_component // args.threads)
        ]
        
        # Submit finalization system tests
        finalization_futures = [
            executor.submit(test_finalization_system, client, args.program_id, wallet)
            for wallet in funded_wallets[:args.threads]
            for _ in range(operations_per_component // args.threads)
        ]
        
        # Submit bridge deposit tests
        bridge_deposit_futures = [
            executor.submit(test_bridge_deposit, client, args.program_id, wallet)
            for wallet in funded_wallets[:args.threads]
            for _ in range(operations_per_component // args.threads)
        ]
        
        # Submit bridge withdrawal tests
        bridge_withdrawal_futures = [
            executor.submit(test_bridge_withdrawal, client, args.program_id, wallet)
            for wallet in funded_wallets[:args.threads]
            for _ in range(operations_per_component // args.threads)
        ]
        
        # Collect fraud proof system results
        for future in as_completed(fraud_proof_futures):
            results['fraud_proof_system'].append(future.result())
        
        # Collect finalization system results
        for future in as_completed(finalization_futures):
            results['finalization_system'].append(future.result())
        
        # Collect bridge deposit results
        for future in as_completed(bridge_deposit_futures):
            results['bridge_deposit'].append(future.result())
        
        # Collect bridge withdrawal results
        for future in as_completed(bridge_withdrawal_futures):
            results['bridge_withdrawal'].append(future.result())
    
    # Record end time
    end_time = time.time()
    
    # Check transaction volume
    volume_result = check_transaction_volume(client, args.program_id, int(start_time), int(end_time))
    
    # Check price and slippage (using a dummy token address for demonstration)
    token_address = "0x" + hashlib.sha256(str(time.time()).encode()).hexdigest()[:40]
    price_result = check_price_and_slippage(token_address)
    
    # Calculate success rates
    fraud_proof_success_rate = sum(1 for r in results['fraud_proof_system'] if r['success']) / len(results['fraud_proof_system']) if results['fraud_proof_system'] else 0
    finalization_success_rate = sum(1 for r in results['finalization_system'] if r['success']) / len(results['finalization_system']) if results['finalization_system'] else 0
    bridge_deposit_success_rate = sum(1 for r in results['bridge_deposit'] if r['success']) / len(results['bridge_deposit']) if results['bridge_deposit'] else 0
    bridge_withdrawal_success_rate = sum(1 for r in results['bridge_withdrawal'] if r['success']) / len(results['bridge_withdrawal']) if results['bridge_withdrawal'] else 0
    
    # Calculate average durations
    fraud_proof_avg_duration = sum(r['duration'] for r in results['fraud_proof_system'] if r['success']) / sum(1 for r in results['fraud_proof_system'] if r['success']) if sum(1 for r in results['fraud_proof_system'] if r['success']) > 0 else 0
    finalization_avg_duration = sum(r['duration'] for r in results['finalization_system'] if r['success']) / sum(1 for r in results['finalization_system'] if r['success']) if sum(1 for r in results['finalization_system'] if r['success']) > 0 else 0
    bridge_deposit_avg_duration = sum(r['duration'] for r in results['bridge_deposit'] if r['success']) / sum(1 for r in results['bridge_deposit'] if r['success']) if sum(1 for r in results['bridge_deposit'] if r['success']) > 0 else 0
    bridge_withdrawal_avg_duration = sum(r['duration'] for r in results['bridge_withdrawal'] if r['success']) / sum(1 for r in results['bridge_withdrawal'] if r['success']) if sum(1 for r in results['bridge_withdrawal'] if r['success']) > 0 else 0
    
    # Prepare summary
    summary = {
        'total_duration': end_time - start_time,
        'total_operations': args.operations,
        'operations_per_second': args.operations / (end_time - start_time),
        'success_rates': {
            'fraud_proof_system': fraud_proof_success_rate,
            'finalization_system': finalization_success_rate,
            'bridge_deposit': bridge_deposit_success_rate,
            'bridge_withdrawal': bridge_withdrawal_success_rate,
            'overall': (fraud_proof_success_rate + finalization_success_rate + bridge_deposit_success_rate + bridge_withdrawal_success_rate) / 4
        },
        'average_durations': {
            'fraud_proof_system': fraud_proof_avg_duration,
            'finalization_system': finalization_avg_duration,
            'bridge_deposit': bridge_deposit_avg_duration,
            'bridge_withdrawal': bridge_withdrawal_avg_duration,
            'overall': (fraud_proof_avg_duration + finalization_avg_duration + bridge_deposit_avg_duration + bridge_withdrawal_avg_duration) / 4
        },
        'transaction_volume': volume_result,
        'price_and_slippage': price_result
    }
    
    # Print summary
    print("\nTest Summary:")
    print(f"Total Duration: {summary['total_duration']:.2f} seconds")
    print(f"Total Operations: {summary['total_operations']}")
    print(f"Operations Per Second: {summary['operations_per_second']:.2f}")
    print("\nSuccess Rates:")
    print(f"  Fraud Proof System: {summary['success_rates']['fraud_proof_system']:.2%}")
    print(f"  Finalization System: {summary['success_rates']['finalization_system']:.2%}")
    print(f"  Bridge Deposit: {summary['success_rates']['bridge_deposit']:.2%}")
    print(f"  Bridge Withdrawal: {summary['success_rates']['bridge_withdrawal']:.2%}")
    print(f"  Overall: {summary['success_rates']['overall']:.2%}")
    print("\nAverage Durations (seconds):")
    print(f"  Fraud Proof System: {summary['average_durations']['fraud_proof_system']:.4f}")
    print(f"  Finalization System: {summary['average_durations']['finalization_system']:.4f}")
    print(f"  Bridge Deposit: {summary['average_durations']['bridge_deposit']:.4f}")
    print(f"  Bridge Withdrawal: {summary['average_durations']['bridge_withdrawal']:.4f}")
    print(f"  Overall: {summary['average_durations']['overall']:.4f}")
    
    # Prepare final results
    final_results = {
        'summary': summary,
        'detailed_results': results
    }
    
    return final_results

def main():
    parser = argparse.ArgumentParser(description='Real Blockchain Tests for Layer-2 on Solana')
    parser.add_argument('--endpoint', type=str, default=DEFAULT_SOLANA_ENDPOINT,
                        help=f'Solana RPC endpoint (default: {DEFAULT_SOLANA_ENDPOINT})')
    parser.add_argument('--program-id', type=str, default=DEFAULT_PROGRAM_ID,
                        help=f'Program ID (default: {DEFAULT_PROGRAM_ID})')
    parser.add_argument('--operations', type=int, default=DEFAULT_NUM_OPERATIONS,
                        help=f'Number of operations to perform (default: {DEFAULT_NUM_OPERATIONS})')
    parser.add_argument('--threads', type=int, default=DEFAULT_NUM_THREADS,
                        help=f'Number of threads to use (default: {DEFAULT_NUM_THREADS})')
    parser.add_argument('--output', type=str, default=DEFAULT_OUTPUT_FILE,
                        help=f'Output file for test results (default: {DEFAULT_OUTPUT_FILE})')
    
    args = parser.parse_args()
    
    print(f"Starting Real Blockchain Tests for Layer-2 on Solana")
    print(f"Endpoint: {args.endpoint}")
    print(f"Program ID: {args.program_id}")
    print(f"Operations: {args.operations}")
    print(f"Threads: {args.threads}")
    print(f"Output: {args.output}")
    
    # Run tests
    results = run_real_blockchain_tests(args)
    
    # Save results to file
    with open(args.output, 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"\nResults saved to {args.output}")

if __name__ == '__main__':
    main()
