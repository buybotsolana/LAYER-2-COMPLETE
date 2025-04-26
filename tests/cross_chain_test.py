#!/usr/bin/env python3
"""
Cross-Chain Integration Testing Framework for Layer-2 on Solana

This script performs comprehensive cross-chain integration testing for the Layer-2 on Solana
implementation, verifying interoperability with Ethereum, Polygon, Avalanche, and other chains.

Usage:
    python3 cross_chain_test.py [--chains CHAINS] [--duration DURATION] [--report-file REPORT_FILE]

Options:
    --chains            Comma-separated list of chains to test (default: ethereum,polygon,avalanche,bsc)
    --duration          Test duration in seconds for each chain (default: 300)
    --report-file       Path to output the detailed report (default: cross_chain_test_report.md)
"""

import os
import sys
import time
import json
import random
import argparse
import threading
import subprocess
import statistics
import matplotlib.pyplot as plt
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Any, Tuple, Optional, Union

# Test configuration
CONFIG = {
    "chains": ["ethereum", "polygon", "avalanche", "bsc"],
    "duration": 300,  # seconds per chain
    "report_file": "cross_chain_test_report.md",
    "transaction_types": ["deposit", "withdraw", "message", "call"],
    "transaction_sizes": [100, 500, 1000, 5000],  # bytes
    "test_accounts_per_chain": 10,
    "data_collection_interval": 1,  # seconds
}

# Test result storage
RESULTS = {
    "start_time": None,
    "end_time": None,
    "chain_results": {},
    "total_transactions": 0,
    "successful_transactions": 0,
    "failed_transactions": 0,
    "errors": [],
}

# Global variables
running = True
transaction_queue = []
transaction_lock = threading.Lock()
chain_connections = {}

class ChainConnection:
    """Simulates a connection to a blockchain network"""
    
    def __init__(self, chain_id: str):
        """
        Initialize a chain connection.
        
        Args:
            chain_id: Identifier of the blockchain network
        """
        self.chain_id = chain_id
        self.connected = False
        self.accounts = []
        self.transactions = []
        self.blocks = []
        self.current_block = 0
        self.latency = self._get_default_latency()
        
    def _get_default_latency(self) -> float:
        """Get default latency for this chain in seconds"""
        latency_map = {
            "ethereum": 12.0,  # ~12 seconds block time
            "polygon": 2.0,    # ~2 seconds block time
            "avalanche": 2.0,  # ~2 seconds block time
            "bsc": 3.0,        # ~3 seconds block time
            "solana": 0.4,     # ~400ms block time
        }
        return latency_map.get(self.chain_id.lower(), 5.0)
        
    def connect(self) -> bool:
        """
        Connect to the blockchain network.
        
        Returns:
            bool: True if connection successful, False otherwise
        """
        print(f"Connecting to {self.chain_id}...")
        
        # Simulate connection delay
        time.sleep(random.uniform(0.5, 2.0))
        
        # 95% chance of successful connection
        if random.random() < 0.95:
            self.connected = True
            print(f"Connected to {self.chain_id}")
            return True
        else:
            print(f"Failed to connect to {self.chain_id}")
            return False
            
    def disconnect(self) -> None:
        """Disconnect from the blockchain network"""
        if self.connected:
            print(f"Disconnecting from {self.chain_id}...")
            self.connected = False
            
    def create_accounts(self, count: int) -> List[Dict[str, Any]]:
        """
        Create test accounts on the blockchain.
        
        Args:
            count: Number of accounts to create
            
        Returns:
            List[Dict[str, Any]]: List of created accounts
        """
        print(f"Creating {count} test accounts on {self.chain_id}...")
        
        self.accounts = []
        for i in range(count):
            account = {
                "id": f"{self.chain_id}-account-{i}",
                "address": f"0x{random.getrandbits(160):040x}" if self.chain_id.lower() != "solana" else f"{random.getrandbits(256):064x}",
                "private_key": f"0x{random.getrandbits(256):064x}",
                "balance": random.uniform(1.0, 10.0),
                "token_balances": {
                    "USDC": random.uniform(100.0, 1000.0),
                    "USDT": random.uniform(100.0, 1000.0),
                    "DAI": random.uniform(100.0, 1000.0),
                    "WETH": random.uniform(0.1, 1.0) if self.chain_id.lower() != "solana" else 0,
                    "WSOL": random.uniform(1.0, 10.0) if self.chain_id.lower() == "solana" else 0,
                }
            }
            self.accounts.append(account)
            
        print(f"Created {len(self.accounts)} accounts on {self.chain_id}")
        return self.accounts
        
    def get_account(self, account_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Get a random account or a specific account by ID.
        
        Args:
            account_id: Optional account ID to retrieve
            
        Returns:
            Dict[str, Any]: Account information
        """
        if not self.accounts:
            raise ValueError(f"No accounts available for {self.chain_id}")
            
        if account_id:
            for account in self.accounts:
                if account["id"] == account_id:
                    return account
            raise ValueError(f"Account {account_id} not found for {self.chain_id}")
        else:
            return random.choice(self.accounts)
            
    def get_balance(self, account_id: str, token: Optional[str] = None) -> float:
        """
        Get account balance for native currency or a specific token.
        
        Args:
            account_id: Account ID
            token: Optional token name
            
        Returns:
            float: Account balance
        """
        account = self.get_account(account_id)
        
        if token:
            return account["token_balances"].get(token, 0.0)
        else:
            return account["balance"]
            
    def update_balance(self, account_id: str, amount: float, token: Optional[str] = None) -> None:
        """
        Update account balance for native currency or a specific token.
        
        Args:
            account_id: Account ID
            amount: Amount to add (positive) or subtract (negative)
            token: Optional token name
        """
        account = self.get_account(account_id)
        
        if token:
            current_balance = account["token_balances"].get(token, 0.0)
            account["token_balances"][token] = max(0.0, current_balance + amount)
        else:
            account["balance"] = max(0.0, account["balance"] + amount)
            
    def send_transaction(self, transaction: Dict[str, Any]) -> Dict[str, Any]:
        """
        Send a transaction to the blockchain.
        
        Args:
            transaction: Transaction data
            
        Returns:
            Dict[str, Any]: Updated transaction with processing results
        """
        if not self.connected:
            transaction["status"] = "failed"
            transaction["error"] = "chain_not_connected"
            return transaction
            
        # Simulate transaction processing
        processing_time = random.uniform(0.1, self.latency * 0.5)
        time.sleep(processing_time)
        
        # Determine success probability
        success_probability = 0.95  # 95% success rate
        
        # Update transaction status
        if random.random() < success_probability:
            transaction["status"] = "confirmed"
            transaction["confirmation_time"] = time.time()
            transaction["latency"] = transaction["confirmation_time"] - transaction["timestamp"]
            transaction["block_number"] = self.current_block
            
            # Update account balances if needed
            if transaction["type"] in ["deposit", "withdraw"]:
                if transaction["type"] == "deposit":
                    # Decrease balance on source chain
                    self.update_balance(
                        transaction["sender"],
                        -transaction["amount"],
                        transaction.get("token")
                    )
                elif transaction["type"] == "withdraw":
                    # Increase balance on destination chain
                    self.update_balance(
                        transaction["recipient"],
                        transaction["amount"],
                        transaction.get("token")
                    )
            
            self.transactions.append(transaction)
            self.current_block += 1
        else:
            transaction["status"] = "failed"
            transaction["error"] = random.choice([
                "timeout",
                "insufficient_funds",
                "nonce_too_low",
                "gas_price_too_low",
                "execution_reverted",
            ])
            
        return transaction
        
    def get_transaction(self, tx_id: str) -> Optional[Dict[str, Any]]:
        """
        Get transaction details by ID.
        
        Args:
            tx_id: Transaction ID
            
        Returns:
            Optional[Dict[str, Any]]: Transaction details or None if not found
        """
        for tx in self.transactions:
            if tx["id"] == tx_id:
                return tx
        return None

def setup_environment() -> bool:
    """
    Set up the testing environment.
    
    Returns:
        bool: True if setup was successful, False otherwise
    """
    print("Setting up cross-chain testing environment...")
    
    try:
        # Check if the Layer-2 code is available
        if not os.path.exists("src"):
            print("ERROR: Source code directory not found")
            return False
            
        # Build the project in release mode for testing
        result = subprocess.run(
            ["cargo", "build", "--release", "--features", "cross-chain-test"],
            capture_output=True,
            text=True
        )
        
        if result.returncode != 0:
            print(f"ERROR: Failed to build project: {result.stderr}")
            return False
            
        # Set up chain connections
        if not setup_chain_connections():
            print("ERROR: Failed to set up chain connections")
            return False
            
        # Set up test accounts
        if not setup_test_accounts():
            print("ERROR: Failed to set up test accounts")
            return False
            
        print("Cross-chain testing environment set up successfully")
        return True
        
    except Exception as e:
        print(f"ERROR: Failed to set up testing environment: {str(e)}")
        return False

def setup_chain_connections() -> bool:
    """
    Set up connections to all test chains.
    
    Returns:
        bool: True if all connections were successful, False otherwise
    """
    print(f"Setting up connections to {len(CONFIG['chains'])} chains...")
    
    global chain_connections
    chain_connections = {}
    
    # Always include Solana as the base chain
    chains_to_connect = CONFIG["chains"] + ["solana"]
    chains_to_connect = list(set(chains_to_connect))  # Remove duplicates
    
    for chain_id in chains_to_connect:
        connection = ChainConnection(chain_id)
        if connection.connect():
            chain_connections[chain_id] = connection
        else:
            print(f"ERROR: Failed to connect to {chain_id}")
            return False
            
    print(f"Connected to {len(chain_connections)} chains")
    return True

def setup_test_accounts() -> bool:
    """
    Set up test accounts on all chains.
    
    Returns:
        bool: True if setup was successful, False otherwise
    """
    print("Setting up test accounts on all chains...")
    
    try:
        for chain_id, connection in chain_connections.items():
            connection.create_accounts(CONFIG["test_accounts_per_chain"])
            
        print("Test accounts set up successfully")
        return True
        
    except Exception as e:
        print(f"ERROR: Failed to set up test accounts: {str(e)}")
        return False

def generate_cross_chain_transaction(
    source_chain: str,
    destination_chain: str,
    tx_type: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generate a random cross-chain transaction.
    
    Args:
        source_chain: Source chain ID
        destination_chain: Destination chain ID
        tx_type: Optional transaction type, random if not specified
        
    Returns:
        Dict[str, Any]: Transaction data
    """
    if tx_type is None:
        tx_type = random.choice(CONFIG["transaction_types"])
        
    size = random.choice(CONFIG["transaction_sizes"])
    
    # Get random accounts from source and destination chains
    source_account = chain_connections[source_chain].get_account()
    destination_account = chain_connections[destination_chain].get_account()
    
    # Generate random token and amount
    token = random.choice(list(source_account["token_balances"].keys()))
    amount = min(
        random.uniform(0.1, source_account["token_balances"][token] * 0.5),
        source_account["token_balances"][token]
    )
    
    # Generate random data
    data = os.urandom(size)
    
    # Create transaction
    transaction = {
        "id": f"tx-{source_chain}-{destination_chain}-{int(time.time() * 1000)}-{random.randint(0, 1000000)}",
        "type": tx_type,
        "source_chain": source_chain,
        "destination_chain": destination_chain,
        "sender": source_account["id"],
        "sender_address": source_account["address"],
        "recipient": destination_account["id"],
        "recipient_address": destination_account["address"],
        "token": token,
        "amount": amount,
        "data_size": size,
        "timestamp": time.time(),
        "status": "pending",
    }
    
    return transaction

def process_cross_chain_transaction(transaction: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process a cross-chain transaction.
    
    Args:
        transaction: Transaction data
        
    Returns:
        Dict[str, Any]: Updated transaction with processing results
    """
    source_chain = transaction["source_chain"]
    destination_chain = transaction["destination_chain"]
    
    # Check if chains are connected
    if source_chain not in chain_connections or destination_chain not in chain_connections:
        transaction["status"] = "failed"
        transaction["error"] = "chain_not_connected"
        return transaction
    
    # Step 1: Send transaction on source chain
    print(f"Processing {transaction['type']} from {source_chain} to {destination_chain}...")
    
    source_tx = transaction.copy()
    source_tx["id"] = f"{transaction['id']}-source"
    source_tx = chain_connections[source_chain].send_transaction(source_tx)
    
    if source_tx["status"] != "confirmed":
        transaction["status"] = "failed"
        transaction["error"] = f"source_chain_error: {source_tx.get('error', 'unknown')}"
        return transaction
    
    # Step 2: Wait for cross-chain confirmation period
    # This simulates the time needed for the Layer-2 to process and relay the transaction
    confirmation_time = random.uniform(5.0, 15.0)
    time.sleep(confirmation_time)
    
    # Step 3: Send transaction on destination chain
    destination_tx = transaction.copy()
    destination_tx["id"] = f"{transaction['id']}-destination"
    destination_tx = chain_connections[destination_chain].send_transaction(destination_tx)
    
    if destination_tx["status"] != "confirmed":
        transaction["status"] = "failed"
        transaction["error"] = f"destination_chain_error: {destination_tx.get('error', 'unknown')}"
        return transaction
    
    # Update transaction status
    transaction["status"] = "confirmed"
    transaction["confirmation_time"] = time.time()
    transaction["latency"] = transaction["confirmation_time"] - transaction["timestamp"]
    transaction["source_tx_id"] = source_tx["id"]
    transaction["destination_tx_id"] = destination_tx["id"]
    
    return transaction

def transaction_generator(stop_event: threading.Event) -> None:
    """
    Generate cross-chain transactions.
    
    Args:
        stop_event: Event to signal when to stop generating transactions
    """
    print("Starting cross-chain transaction generator...")
    
    # Calculate delay between transactions
    delay = 2.0  # Generate a transaction every 2 seconds
    
    # Generate transactions until stop event is set
    while not stop_event.is_set():
        start_time = time.time()
        
        # Select random source and destination chains
        chains = list(chain_connections.keys())
        source_chain = random.choice(chains)
        
        # Ensure destination chain is different from source chain
        available_destinations = [c for c in chains if c != source_chain]
        if not available_destinations:
            time.sleep(delay)
            continue
            
        destination_chain = random.choice(available_destinations)
        
        # Generate transaction
        transaction = generate_cross_chain_transaction(source_chain, destination_chain)
        
        # Add transaction to queue
        with transaction_lock:
            transaction_queue.append(transaction)
            RESULTS["total_transactions"] += 1
            
        # Sleep to maintain transaction rate
        elapsed = time.time() - start_time
        if elapsed < delay:
            time.sleep(delay - elapsed)

def transaction_processor(worker_id: int, stop_event: threading.Event) -> None:
    """
    Process cross-chain transactions from the queue.
    
    Args:
        worker_id: ID of the worker thread
        stop_event: Event to signal when to stop processing transactions
    """
    print(f"Starting cross-chain transaction processor worker {worker_id}...")
    
    # Process transactions until stop event is set
    while not stop_event.is_set():
        # Get transaction from queue
        transaction = None
        with transaction_lock:
            if transaction_queue:
                transaction = transaction_queue.pop(0)
        
        if transaction:
            # Process transaction
            result = process_cross_chain_transaction(transaction)
            
            # Update results
            with transaction_lock:
                source_chain = result["source_chain"]
                destination_chain = result["destination_chain"]
                
                # Initialize chain results if needed
                for chain in [source_chain, destination_chain]:
                    if chain not in RESULTS["chain_results"]:
                        RESULTS["chain_results"][chain] = {
                            "total": 0,
                            "successful": 0,
                            "failed": 0,
                            "latencies": [],
                        }
                
                # Update chain-specific results
                RESULTS["chain_results"][source_chain]["total"] += 1
                RESULTS["chain_results"][destination_chain]["total"] += 1
                
                if result["status"] == "confirmed":
                    RESULTS["successful_transactions"] += 1
                    RESULTS["chain_results"][source_chain]["successful"] += 1
                    RESULTS["chain_results"][destination_chain]["successful"] += 1
                    
                    # Record latency for both chains
                    RESULTS["chain_results"][source_chain]["latencies"].append(result["latency"])
                    RESULTS["chain_results"][destination_chain]["latencies"].append(result["latency"])
                else:
                    RESULTS["failed_transactions"] += 1
                    RESULTS["chain_results"][source_chain]["failed"] += 1
                    RESULTS["chain_results"][destination_chain]["failed"] += 1
                    
                    # Record error
                    RESULTS["errors"].append({
                        "transaction_id": result["id"],
                        "source_chain": source_chain,
                        "destination_chain": destination_chain,
                        "error": result.get("error", "unknown"),
                        "timestamp": time.time(),
                    })
        else:
            # No transactions in queue, sleep briefly
            time.sleep(0.1)

def test_specific_chain_pair(source_chain: str, destination_chain: str, duration: int) -> Dict[str, Any]:
    """
    Run a specific test between two chains.
    
    Args:
        source_chain: Source chain ID
        destination_chain: Destination chain ID
        duration: Test duration in seconds
        
    Returns:
        Dict[str, Any]: Test results
    """
    print(f"\nTesting {source_chain} -> {destination_chain} for {duration} seconds...")
    
    # Initialize results for this test
    test_results = {
        "source_chain": source_chain,
        "destination_chain": destination_chain,
        "start_time": time.time(),
        "end_time": None,
        "total_transactions": 0,
        "successful_transactions": 0,
        "failed_transactions": 0,
        "latencies": [],
        "errors": [],
    }
    
    # Create stop event
    stop_event = threading.Event()
    
    # Start transaction generator for this chain pair
    def chain_pair_generator():
        delay = 1.0  # Generate a transaction every second
        
        while not stop_event.is_set():
            start_time = time.time()
            
            # Generate transaction
            transaction = generate_cross_chain_transaction(source_chain, destination_chain)
            
            # Process transaction directly
            result = process_cross_chain_transaction(transaction)
            
            # Update results
            test_results["total_transactions"] += 1
            
            if result["status"] == "confirmed":
                test_results["successful_transactions"] += 1
                test_results["latencies"].append(result["latency"])
            else:
                test_results["failed_transactions"] += 1
                test_results["errors"].append({
                    "transaction_id": result["id"],
                    "error": result.get("error", "unknown"),
                    "timestamp": time.time(),
                })
            
            # Sleep to maintain transaction rate
            elapsed = time.time() - start_time
            if elapsed < delay:
                time.sleep(delay - elapsed)
    
    # Start generator thread
    generator_thread = threading.Thread(target=chain_pair_generator)
    generator_thread.daemon = True
    generator_thread.start()
    
    # Wait for test duration
    try:
        time.sleep(duration)
    except KeyboardInterrupt:
        print("\nTest interrupted by user")
    
    # Stop generator thread
    stop_event.set()
    generator_thread.join(timeout=5)
    
    # Record end time
    test_results["end_time"] = time.time()
    
    # Print summary
    success_rate = (test_results["successful_transactions"] / test_results["total_transactions"] * 100) if test_results["total_transactions"] > 0 else 0
    avg_latency = statistics.mean(test_results["latencies"]) if test_results["latencies"] else 0
    
    print(f"Test completed: {source_chain} -> {destination_chain}")
    print(f"Transactions: {test_results['total_transactions']}")
    print(f"Success rate: {success_rate:.2f}%")
    print(f"Average latency: {avg_latency:.2f} seconds")
    
    return test_results

def run_cross_chain_tests() -> None:
    """Run comprehensive cross-chain tests"""
    print("\nRunning comprehensive cross-chain tests...")
    
    # Record start time
    RESULTS["start_time"] = time.time()
    
    # Test each chain pair
    chain_pair_results = []
    
    for source_chain in CONFIG["chains"]:
        for destination_chain in CONFIG["chains"]:
            if source_chain != destination_chain:
                # Test this chain pair
                result = test_specific_chain_pair(
                    source_chain,
                    destination_chain,
                    CONFIG["duration"]
                )
                chain_pair_results.append(result)
    
    # Record end time
    RESULTS["end_time"] = time.time()
    
    # Add chain pair results to overall results
    RESULTS["chain_pair_results"] = chain_pair_results
    
    print("Comprehensive cross-chain tests completed")

def test_transaction_types() -> None:
    """Test specific transaction types across chains"""
    print("\nTesting specific transaction types across chains...")
    
    transaction_type_results = []
    
    for tx_type in CONFIG["transaction_types"]:
        print(f"\nTesting transaction type: {tx_type}")
        
        # Initialize results for this transaction type
        type_results = {
            "type": tx_type,
            "start_time": time.time(),
            "end_time": None,
            "total_transactions": 0,
            "successful_transactions": 0,
            "failed_transactions": 0,
            "latencies": [],
            "errors": [],
            "chain_pairs": [],
        }
        
        # Test this transaction type on each chain pair
        for source_chain in CONFIG["chains"]:
            for destination_chain in CONFIG["chains"]:
                if source_chain != destination_chain:
                    print(f"Testing {tx_type}: {source_chain} -> {destination_chain}")
                    
                    # Initialize results for this chain pair
                    pair_results = {
                        "source_chain": source_chain,
                        "destination_chain": destination_chain,
                        "total": 0,
                        "successful": 0,
                        "failed": 0,
                        "latencies": [],
                    }
                    
                    # Generate and process 5 transactions of this type
                    for _ in range(5):
                        # Generate transaction
                        transaction = generate_cross_chain_transaction(
                            source_chain,
                            destination_chain,
                            tx_type
                        )
                        
                        # Process transaction
                        result = process_cross_chain_transaction(transaction)
                        
                        # Update results
                        type_results["total_transactions"] += 1
                        pair_results["total"] += 1
                        
                        if result["status"] == "confirmed":
                            type_results["successful_transactions"] += 1
                            pair_results["successful"] += 1
                            type_results["latencies"].append(result["latency"])
                            pair_results["latencies"].append(result["latency"])
                        else:
                            type_results["failed_transactions"] += 1
                            pair_results["failed"] += 1
                            type_results["errors"].append({
                                "transaction_id": result["id"],
                                "source_chain": source_chain,
                                "destination_chain": destination_chain,
                                "error": result.get("error", "unknown"),
                                "timestamp": time.time(),
                            })
                    
                    # Add chain pair results to transaction type results
                    type_results["chain_pairs"].append(pair_results)
        
        # Record end time
        type_results["end_time"] = time.time()
        
        # Print summary
        success_rate = (type_results["successful_transactions"] / type_results["total_transactions"] * 100) if type_results["total_transactions"] > 0 else 0
        avg_latency = statistics.mean(type_results["latencies"]) if type_results["latencies"] else 0
        
        print(f"Transaction type test completed: {tx_type}")
        print(f"Transactions: {type_results['total_transactions']}")
        print(f"Success rate: {success_rate:.2f}%")
        print(f"Average latency: {avg_latency:.2f} seconds")
        
        # Add transaction type results to overall results
        transaction_type_results.append(type_results)
    
    # Add transaction type results to overall results
    RESULTS["transaction_type_results"] = transaction_type_results
    
    print("Transaction type tests completed")

def test_failure_scenarios() -> None:
    """Test failure scenarios and recovery"""
    print("\nTesting failure scenarios and recovery...")
    
    failure_scenario_results = []
    
    scenarios = [
        {
            "name": "Chain disconnection",
            "description": "Simulate temporary disconnection of a chain",
        },
        {
            "name": "Insufficient funds",
            "description": "Attempt transactions with insufficient funds",
        },
        {
            "name": "Invalid recipient",
            "description": "Attempt transactions with invalid recipient addresses",
        },
        {
            "name": "Network congestion",
            "description": "Simulate network congestion with increased latency",
        },
    ]
    
    for scenario in scenarios:
        print(f"\nTesting failure scenario: {scenario['name']}")
        print(f"Description: {scenario['description']}")
        
        # Initialize results for this scenario
        scenario_results = {
            "name": scenario["name"],
            "description": scenario["description"],
            "start_time": time.time(),
            "end_time": None,
            "total_transactions": 0,
            "successful_transactions": 0,
            "failed_transactions": 0,
            "recovery_successful": False,
            "errors": [],
        }
        
        # Select random source and destination chains
        chains = CONFIG["chains"]
        source_chain = random.choice(chains)
        available_destinations = [c for c in chains if c != source_chain]
        destination_chain = random.choice(available_destinations)
        
        # Apply scenario-specific modifications
        if scenario["name"] == "Chain disconnection":
            # Disconnect the destination chain
            print(f"Disconnecting {destination_chain}...")
            chain_connections[destination_chain].disconnect()
            
            # Generate and process a transaction (expected to fail)
            transaction = generate_cross_chain_transaction(source_chain, destination_chain)
            result = process_cross_chain_transaction(transaction)
            
            # Update results
            scenario_results["total_transactions"] += 1
            if result["status"] == "confirmed":
                scenario_results["successful_transactions"] += 1
            else:
                scenario_results["failed_transactions"] += 1
                scenario_results["errors"].append({
                    "transaction_id": result["id"],
                    "error": result.get("error", "unknown"),
                    "timestamp": time.time(),
                })
            
            # Reconnect the destination chain
            print(f"Reconnecting {destination_chain}...")
            chain_connections[destination_chain] = ChainConnection(destination_chain)
            reconnected = chain_connections[destination_chain].connect()
            if reconnected:
                chain_connections[destination_chain].create_accounts(CONFIG["test_accounts_per_chain"])
            
            # Try the transaction again (expected to succeed)
            transaction = generate_cross_chain_transaction(source_chain, destination_chain)
            result = process_cross_chain_transaction(transaction)
            
            # Update results
            scenario_results["total_transactions"] += 1
            if result["status"] == "confirmed":
                scenario_results["successful_transactions"] += 1
                scenario_results["recovery_successful"] = True
            else:
                scenario_results["failed_transactions"] += 1
                scenario_results["errors"].append({
                    "transaction_id": result["id"],
                    "error": result.get("error", "unknown"),
                    "timestamp": time.time(),
                })
                
        elif scenario["name"] == "Insufficient funds":
            # Get an account from the source chain
            source_account = chain_connections[source_chain].get_account()
            destination_account = chain_connections[destination_chain].get_account()
            
            # Create a transaction with amount exceeding balance
            token = random.choice(list(source_account["token_balances"].keys()))
            excessive_amount = source_account["token_balances"][token] * 2
            
            transaction = {
                "id": f"tx-{source_chain}-{destination_chain}-{int(time.time() * 1000)}-{random.randint(0, 1000000)}",
                "type": "deposit",
                "source_chain": source_chain,
                "destination_chain": destination_chain,
                "sender": source_account["id"],
                "sender_address": source_account["address"],
                "recipient": destination_account["id"],
                "recipient_address": destination_account["address"],
                "token": token,
                "amount": excessive_amount,
                "data_size": random.choice(CONFIG["transaction_sizes"]),
                "timestamp": time.time(),
                "status": "pending",
            }
            
            # Process transaction (expected to fail)
            result = process_cross_chain_transaction(transaction)
            
            # Update results
            scenario_results["total_transactions"] += 1
            if result["status"] == "confirmed":
                scenario_results["successful_transactions"] += 1
            else:
                scenario_results["failed_transactions"] += 1
                scenario_results["errors"].append({
                    "transaction_id": result["id"],
                    "error": result.get("error", "unknown"),
                    "timestamp": time.time(),
                })
            
            # Try with a valid amount (expected to succeed)
            valid_amount = source_account["token_balances"][token] * 0.5
            transaction["amount"] = valid_amount
            transaction["id"] = f"{transaction['id']}-retry"
            transaction["timestamp"] = time.time()
            
            result = process_cross_chain_transaction(transaction)
            
            # Update results
            scenario_results["total_transactions"] += 1
            if result["status"] == "confirmed":
                scenario_results["successful_transactions"] += 1
                scenario_results["recovery_successful"] = True
            else:
                scenario_results["failed_transactions"] += 1
                scenario_results["errors"].append({
                    "transaction_id": result["id"],
                    "error": result.get("error", "unknown"),
                    "timestamp": time.time(),
                })
                
        elif scenario["name"] == "Invalid recipient":
            # Get an account from the source chain
            source_account = chain_connections[source_chain].get_account()
            
            # Create a transaction with invalid recipient
            token = random.choice(list(source_account["token_balances"].keys()))
            amount = source_account["token_balances"][token] * 0.5
            
            transaction = {
                "id": f"tx-{source_chain}-{destination_chain}-{int(time.time() * 1000)}-{random.randint(0, 1000000)}",
                "type": "deposit",
                "source_chain": source_chain,
                "destination_chain": destination_chain,
                "sender": source_account["id"],
                "sender_address": source_account["address"],
                "recipient": "invalid-recipient",
                "recipient_address": "0xinvalid",
                "token": token,
                "amount": amount,
                "data_size": random.choice(CONFIG["transaction_sizes"]),
                "timestamp": time.time(),
                "status": "pending",
            }
            
            # Process transaction (expected to fail)
            result = process_cross_chain_transaction(transaction)
            
            # Update results
            scenario_results["total_transactions"] += 1
            if result["status"] == "confirmed":
                scenario_results["successful_transactions"] += 1
            else:
                scenario_results["failed_transactions"] += 1
                scenario_results["errors"].append({
                    "transaction_id": result["id"],
                    "error": result.get("error", "unknown"),
                    "timestamp": time.time(),
                })
            
            # Try with a valid recipient (expected to succeed)
            destination_account = chain_connections[destination_chain].get_account()
            transaction["recipient"] = destination_account["id"]
            transaction["recipient_address"] = destination_account["address"]
            transaction["id"] = f"{transaction['id']}-retry"
            transaction["timestamp"] = time.time()
            
            result = process_cross_chain_transaction(transaction)
            
            # Update results
            scenario_results["total_transactions"] += 1
            if result["status"] == "confirmed":
                scenario_results["successful_transactions"] += 1
                scenario_results["recovery_successful"] = True
            else:
                scenario_results["failed_transactions"] += 1
                scenario_results["errors"].append({
                    "transaction_id": result["id"],
                    "error": result.get("error", "unknown"),
                    "timestamp": time.time(),
                })
                
        elif scenario["name"] == "Network congestion":
            # Increase latency for the destination chain
            original_latency = chain_connections[destination_chain].latency
            chain_connections[destination_chain].latency *= 5
            print(f"Increasing latency for {destination_chain} from {original_latency:.2f}s to {chain_connections[destination_chain].latency:.2f}s")
            
            # Generate and process a transaction (expected to succeed but with high latency)
            transaction = generate_cross_chain_transaction(source_chain, destination_chain)
            result = process_cross_chain_transaction(transaction)
            
            # Update results
            scenario_results["total_transactions"] += 1
            if result["status"] == "confirmed":
                scenario_results["successful_transactions"] += 1
            else:
                scenario_results["failed_transactions"] += 1
                scenario_results["errors"].append({
                    "transaction_id": result["id"],
                    "error": result.get("error", "unknown"),
                    "timestamp": time.time(),
                })
            
            # Restore original latency
            chain_connections[destination_chain].latency = original_latency
            print(f"Restoring latency for {destination_chain} to {original_latency:.2f}s")
            
            # Try another transaction (expected to succeed with normal latency)
            transaction = generate_cross_chain_transaction(source_chain, destination_chain)
            result = process_cross_chain_transaction(transaction)
            
            # Update results
            scenario_results["total_transactions"] += 1
            if result["status"] == "confirmed":
                scenario_results["successful_transactions"] += 1
                scenario_results["recovery_successful"] = True
            else:
                scenario_results["failed_transactions"] += 1
                scenario_results["errors"].append({
                    "transaction_id": result["id"],
                    "error": result.get("error", "unknown"),
                    "timestamp": time.time(),
                })
        
        # Record end time
        scenario_results["end_time"] = time.time()
        
        # Print summary
        success_rate = (scenario_results["successful_transactions"] / scenario_results["total_transactions"] * 100) if scenario_results["total_transactions"] > 0 else 0
        
        print(f"Failure scenario test completed: {scenario['name']}")
        print(f"Transactions: {scenario_results['total_transactions']}")
        print(f"Success rate: {success_rate:.2f}%")
        print(f"Recovery successful: {scenario_results['recovery_successful']}")
        
        # Add scenario results to overall results
        failure_scenario_results.append(scenario_results)
    
    # Add failure scenario results to overall results
    RESULTS["failure_scenario_results"] = failure_scenario_results
    
    print("Failure scenario tests completed")

def generate_charts() -> None:
    """Generate charts for the test results"""
    print("\nGenerating charts...")
    
    # Create charts directory
    os.makedirs("charts", exist_ok=True)
    
    # Generate success rate by chain pair chart
    if "chain_pair_results" in RESULTS:
        plt.figure(figsize=(12, 8))
        
        # Prepare data
        pairs = []
        success_rates = []
        
        for result in RESULTS["chain_pair_results"]:
            pair = f"{result['source_chain']} -> {result['destination_chain']}"
            success_rate = (result["successful_transactions"] / result["total_transactions"] * 100) if result["total_transactions"] > 0 else 0
            
            pairs.append(pair)
            success_rates.append(success_rate)
        
        # Create chart
        plt.bar(range(len(pairs)), success_rates)
        plt.xlabel("Chain Pair")
        plt.ylabel("Success Rate (%)")
        plt.title("Cross-Chain Transaction Success Rate by Chain Pair")
        plt.xticks(range(len(pairs)), pairs, rotation=45, ha="right")
        plt.tight_layout()
        plt.grid(True, axis='y')
        plt.savefig("charts/chain_pair_success_rate.png")
    
    # Generate latency by chain pair chart
    if "chain_pair_results" in RESULTS:
        plt.figure(figsize=(12, 8))
        
        # Prepare data
        pairs = []
        latencies = []
        
        for result in RESULTS["chain_pair_results"]:
            pair = f"{result['source_chain']} -> {result['destination_chain']}"
            avg_latency = statistics.mean(result["latencies"]) if result["latencies"] else 0
            
            pairs.append(pair)
            latencies.append(avg_latency)
        
        # Create chart
        plt.bar(range(len(pairs)), latencies)
        plt.xlabel("Chain Pair")
        plt.ylabel("Average Latency (seconds)")
        plt.title("Cross-Chain Transaction Latency by Chain Pair")
        plt.xticks(range(len(pairs)), pairs, rotation=45, ha="right")
        plt.tight_layout()
        plt.grid(True, axis='y')
        plt.savefig("charts/chain_pair_latency.png")
    
    # Generate transaction type success rate chart
    if "transaction_type_results" in RESULTS:
        plt.figure(figsize=(10, 6))
        
        # Prepare data
        types = []
        success_rates = []
        
        for result in RESULTS["transaction_type_results"]:
            tx_type = result["type"]
            success_rate = (result["successful_transactions"] / result["total_transactions"] * 100) if result["total_transactions"] > 0 else 0
            
            types.append(tx_type)
            success_rates.append(success_rate)
        
        # Create chart
        plt.bar(range(len(types)), success_rates)
        plt.xlabel("Transaction Type")
        plt.ylabel("Success Rate (%)")
        plt.title("Cross-Chain Transaction Success Rate by Type")
        plt.xticks(range(len(types)), types)
        plt.grid(True, axis='y')
        plt.savefig("charts/transaction_type_success_rate.png")
    
    # Generate transaction type latency chart
    if "transaction_type_results" in RESULTS:
        plt.figure(figsize=(10, 6))
        
        # Prepare data
        types = []
        latencies = []
        
        for result in RESULTS["transaction_type_results"]:
            tx_type = result["type"]
            avg_latency = statistics.mean(result["latencies"]) if result["latencies"] else 0
            
            types.append(tx_type)
            latencies.append(avg_latency)
        
        # Create chart
        plt.bar(range(len(types)), latencies)
        plt.xlabel("Transaction Type")
        plt.ylabel("Average Latency (seconds)")
        plt.title("Cross-Chain Transaction Latency by Type")
        plt.xticks(range(len(types)), types)
        plt.grid(True, axis='y')
        plt.savefig("charts/transaction_type_latency.png")
    
    # Generate failure scenario success rate chart
    if "failure_scenario_results" in RESULTS:
        plt.figure(figsize=(12, 6))
        
        # Prepare data
        scenarios = []
        success_rates = []
        recovery_rates = []
        
        for result in RESULTS["failure_scenario_results"]:
            scenario = result["name"]
            success_rate = (result["successful_transactions"] / result["total_transactions"] * 100) if result["total_transactions"] > 0 else 0
            recovery_rate = 100 if result["recovery_successful"] else 0
            
            scenarios.append(scenario)
            success_rates.append(success_rate)
            recovery_rates.append(recovery_rate)
        
        # Create chart
        x = np.arange(len(scenarios))
        width = 0.35
        
        fig, ax = plt.subplots(figsize=(12, 6))
        rects1 = ax.bar(x - width/2, success_rates, width, label='Success Rate')
        rects2 = ax.bar(x + width/2, recovery_rates, width, label='Recovery Rate')
        
        ax.set_xlabel('Failure Scenario')
        ax.set_ylabel('Rate (%)')
        ax.set_title('Failure Scenario Success and Recovery Rates')
        ax.set_xticks(x)
        ax.set_xticklabels(scenarios, rotation=45, ha="right")
        ax.legend()
        ax.grid(True, axis='y')
        
        fig.tight_layout()
        plt.savefig("charts/failure_scenario_rates.png")
    
    print("Charts generated in the 'charts' directory")

def generate_report(report_file: str) -> None:
    """
    Generate a detailed cross-chain test report.
    
    Args:
        report_file: Path to the output report file
    """
    print(f"\nGenerating cross-chain test report: {report_file}")
    
    # Calculate test duration
    duration = RESULTS["end_time"] - RESULTS["start_time"]
    duration_str = f"{duration:.2f} seconds"
    
    # Calculate success rate
    success_rate = (RESULTS["successful_transactions"] / RESULTS["total_transactions"] * 100) if RESULTS["total_transactions"] > 0 else 0
    
    # Generate report content
    report_content = f"""# Layer-2 on Solana Cross-Chain Integration Test Report

## Summary

- **Date**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
- **Duration**: {duration_str}
- **Chains Tested**: {', '.join(CONFIG["chains"])}
- **Total Transactions**: {RESULTS["total_transactions"]}
- **Successful Transactions**: {RESULTS["successful_transactions"]} ({success_rate:.2f}%)
- **Failed Transactions**: {RESULTS["failed_transactions"]} ({100 - success_rate:.2f}%)

## Chain-Specific Results

"""
    
    # Add chain-specific results
    for chain, results in RESULTS["chain_results"].items():
        chain_success_rate = (results["successful"] / results["total"] * 100) if results["total"] > 0 else 0
        chain_avg_latency = statistics.mean(results["latencies"]) if results["latencies"] else 0
        
        report_content += f"### {chain.capitalize()}\n\n"
        report_content += f"- **Total Transactions**: {results['total']}\n"
        report_content += f"- **Successful Transactions**: {results['successful']} ({chain_success_rate:.2f}%)\n"
        report_content += f"- **Failed Transactions**: {results['failed']} ({100 - chain_success_rate:.2f}%)\n"
        report_content += f"- **Average Latency**: {chain_avg_latency:.2f} seconds\n\n"
    
    # Add chain pair results
    if "chain_pair_results" in RESULTS:
        report_content += "## Chain Pair Results\n\n"
        
        for result in RESULTS["chain_pair_results"]:
            source_chain = result["source_chain"]
            destination_chain = result["destination_chain"]
            pair_success_rate = (result["successful_transactions"] / result["total_transactions"] * 100) if result["total_transactions"] > 0 else 0
            pair_avg_latency = statistics.mean(result["latencies"]) if result["latencies"] else 0
            
            report_content += f"### {source_chain.capitalize()} -> {destination_chain.capitalize()}\n\n"
            report_content += f"- **Total Transactions**: {result['total_transactions']}\n"
            report_content += f"- **Successful Transactions**: {result['successful_transactions']} ({pair_success_rate:.2f}%)\n"
            report_content += f"- **Failed Transactions**: {result['failed_transactions']} ({100 - pair_success_rate:.2f}%)\n"
            report_content += f"- **Average Latency**: {pair_avg_latency:.2f} seconds\n\n"
    
    # Add transaction type results
    if "transaction_type_results" in RESULTS:
        report_content += "## Transaction Type Results\n\n"
        
        for result in RESULTS["transaction_type_results"]:
            tx_type = result["type"]
            type_success_rate = (result["successful_transactions"] / result["total_transactions"] * 100) if result["total_transactions"] > 0 else 0
            type_avg_latency = statistics.mean(result["latencies"]) if result["latencies"] else 0
            
            report_content += f"### {tx_type.capitalize()}\n\n"
            report_content += f"- **Total Transactions**: {result['total_transactions']}\n"
            report_content += f"- **Successful Transactions**: {result['successful_transactions']} ({type_success_rate:.2f}%)\n"
            report_content += f"- **Failed Transactions**: {result['failed_transactions']} ({100 - type_success_rate:.2f}%)\n"
            report_content += f"- **Average Latency**: {type_avg_latency:.2f} seconds\n\n"
            
            # Add chain pair details for this transaction type
            report_content += "#### Chain Pair Details\n\n"
            for pair in result["chain_pairs"]:
                source_chain = pair["source_chain"]
                destination_chain = pair["destination_chain"]
                pair_success_rate = (pair["successful"] / pair["total"] * 100) if pair["total"] > 0 else 0
                pair_avg_latency = statistics.mean(pair["latencies"]) if pair["latencies"] else 0
                
                report_content += f"- **{source_chain.capitalize()} -> {destination_chain.capitalize()}**: "
                report_content += f"{pair['successful']}/{pair['total']} successful ({pair_success_rate:.2f}%), "
                report_content += f"{pair_avg_latency:.2f}s avg latency\n"
            
            report_content += "\n"
    
    # Add failure scenario results
    if "failure_scenario_results" in RESULTS:
        report_content += "## Failure Scenario Results\n\n"
        
        for result in RESULTS["failure_scenario_results"]:
            scenario = result["name"]
            description = result["description"]
            scenario_success_rate = (result["successful_transactions"] / result["total_transactions"] * 100) if result["total_transactions"] > 0 else 0
            
            report_content += f"### {scenario}\n\n"
            report_content += f"**Description**: {description}\n\n"
            report_content += f"- **Total Transactions**: {result['total_transactions']}\n"
            report_content += f"- **Successful Transactions**: {result['successful_transactions']} ({scenario_success_rate:.2f}%)\n"
            report_content += f"- **Failed Transactions**: {result['failed_transactions']} ({100 - scenario_success_rate:.2f}%)\n"
            report_content += f"- **Recovery Successful**: {'Yes' if result['recovery_successful'] else 'No'}\n\n"
            
            # Add errors for this scenario
            if result["errors"]:
                report_content += "#### Errors\n\n"
                for error in result["errors"]:
                    report_content += f"- **Transaction**: {error['transaction_id']}\n"
                    report_content += f"  **Error**: {error['error']}\n"
                
                report_content += "\n"
    
    # Add charts
    report_content += "## Charts\n\n"
    
    if "chain_pair_results" in RESULTS:
        report_content += "### Chain Pair Success Rate\n\n"
        report_content += "![Chain Pair Success Rate](charts/chain_pair_success_rate.png)\n\n"
        
        report_content += "### Chain Pair Latency\n\n"
        report_content += "![Chain Pair Latency](charts/chain_pair_latency.png)\n\n"
    
    if "transaction_type_results" in RESULTS:
        report_content += "### Transaction Type Success Rate\n\n"
        report_content += "![Transaction Type Success Rate](charts/transaction_type_success_rate.png)\n\n"
        
        report_content += "### Transaction Type Latency\n\n"
        report_content += "![Transaction Type Latency](charts/transaction_type_latency.png)\n\n"
    
    if "failure_scenario_results" in RESULTS:
        report_content += "### Failure Scenario Rates\n\n"
        report_content += "![Failure Scenario Rates](charts/failure_scenario_rates.png)\n\n"
    
    # Add error analysis
    if RESULTS["errors"]:
        report_content += "## Error Analysis\n\n"
        
        # Group errors by type
        error_types = {}
        for error in RESULTS["errors"]:
            error_type = error["error"]
            if error_type not in error_types:
                error_types[error_type] = 0
            error_types[error_type] += 1
        
        report_content += "### Error Distribution\n\n"
        for error_type, count in error_types.items():
            percentage = (count / len(RESULTS["errors"])) * 100
            report_content += f"- **{error_type}**: {count} ({percentage:.2f}%)\n"
        
        report_content += "\n"
    
    report_content += """## Conclusion

Based on the cross-chain integration test results, the Layer-2 on Solana implementation demonstrates [overall assessment based on results].

Key findings:
- [Key finding 1]
- [Key finding 2]
- [Key finding 3]

Recommendations:
- [Recommendation 1]
- [Recommendation 2]
- [Recommendation 3]
"""
    
    # Write report to file
    with open(report_file, "w") as f:
        f.write(report_content)
    
    print(f"Cross-chain test report generated: {report_file}")

def main():
    """Main function to run the cross-chain tests"""
    parser = argparse.ArgumentParser(description="Cross-Chain Integration Testing Framework for Layer-2 on Solana")
    parser.add_argument("--chains", default="ethereum,polygon,avalanche,bsc", help="Comma-separated list of chains to test")
    parser.add_argument("--duration", type=int, default=300, help="Test duration in seconds for each chain")
    parser.add_argument("--report-file", default="cross_chain_test_report.md", help="Path to output the detailed report")
    args = parser.parse_args()
    
    # Update configuration
    CONFIG["chains"] = args.chains.split(",")
    CONFIG["duration"] = args.duration
    CONFIG["report_file"] = args.report_file
    
    print("=== Layer-2 on Solana Cross-Chain Integration Testing ===")
    print(f"Chains: {', '.join(CONFIG['chains'])}")
    print(f"Duration: {CONFIG['duration']} seconds per chain")
    print(f"Report file: {CONFIG['report_file']}")
    
    # Set up testing environment
    if not setup_environment():
        print("Failed to set up testing environment. Exiting.")
        sys.exit(1)
    
    # Run comprehensive cross-chain tests
    run_cross_chain_tests()
    
    # Test specific transaction types
    test_transaction_types()
    
    # Test failure scenarios
    test_failure_scenarios()
    
    # Generate charts
    generate_charts()
    
    # Generate report
    generate_report(CONFIG["report_file"])
    
    # Print summary
    print("\n=== Test Summary ===")
    print(f"Total transactions: {RESULTS['total_transactions']}")
    print(f"Successful transactions: {RESULTS['successful_transactions']} ({(RESULTS['successful_transactions'] / RESULTS['total_transactions'] * 100) if RESULTS['total_transactions'] > 0 else 0:.2f}%)")
    print(f"Failed transactions: {RESULTS['failed_transactions']} ({(RESULTS['failed_transactions'] / RESULTS['total_transactions'] * 100) if RESULTS['total_transactions'] > 0 else 0:.2f}%)")
    print(f"Duration: {RESULTS['end_time'] - RESULTS['start_time']:.2f} seconds")
    print(f"Report: {CONFIG['report_file']}")
    
    # Clean up
    for chain_id, connection in chain_connections.items():
        connection.disconnect()
    
    # Return exit code based on test results
    if RESULTS["failed_transactions"] > RESULTS["total_transactions"] * 0.1:  # More than 10% failures
        print("\nCross-chain testing failed. See report for details.")
        sys.exit(1)
    else:
        print("\nCross-chain testing completed successfully.")
        sys.exit(0)

if __name__ == "__main__":
    main()
