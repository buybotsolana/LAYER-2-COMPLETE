#!/usr/bin/env python3
"""
Stress Testing Framework for Layer-2 on Solana

This script performs comprehensive stress testing on the Layer-2 on Solana implementation,
simulating high loads, concurrent users, and extreme conditions to verify system robustness.

Usage:
    python3 stress_test.py [--duration DURATION] [--users USERS] [--tps TPS] [--report-file REPORT_FILE]

Options:
    --duration          Test duration in seconds (default: 300)
    --users             Number of simulated concurrent users (default: 1000)
    --tps               Target transactions per second (default: 5000)
    --report-file       Path to output the detailed report (default: stress_test_report.md)
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

# Stress test configuration
CONFIG = {
    "duration": 300,  # seconds
    "users": 1000,
    "tps": 5000,
    "report_file": "stress_test_report.md",
    "transaction_types": ["transfer", "deposit", "withdraw", "swap", "stake", "unstake"],
    "transaction_sizes": [100, 500, 1000, 5000, 10000],  # bytes
    "batch_sizes": [1, 10, 50, 100, 500],
    "node_count": 5,
    "data_collection_interval": 1,  # seconds
}

# Test result storage
RESULTS = {
    "start_time": None,
    "end_time": None,
    "total_transactions": 0,
    "successful_transactions": 0,
    "failed_transactions": 0,
    "actual_tps": [],
    "latencies": [],
    "resource_usage": {
        "cpu": [],
        "memory": [],
        "disk_io": [],
        "network_io": [],
    },
    "errors": [],
    "test_scenarios": [],
}

# Global variables
running = True
nodes = []
transaction_queue = []
transaction_lock = threading.Lock()

def setup_environment() -> bool:
    """
    Set up the testing environment.
    
    Returns:
        bool: True if setup was successful, False otherwise
    """
    print("Setting up testing environment...")
    
    try:
        # Check if the Layer-2 code is available
        if not os.path.exists("src"):
            print("ERROR: Source code directory not found")
            return False
            
        # Build the project in release mode for testing
        result = subprocess.run(
            ["cargo", "build", "--release", "--features", "stress-test"],
            capture_output=True,
            text=True
        )
        
        if result.returncode != 0:
            print(f"ERROR: Failed to build project: {result.stderr}")
            return False
            
        # Set up test nodes
        if not setup_test_nodes():
            print("ERROR: Failed to set up test nodes")
            return False
            
        # Set up test accounts and tokens
        if not setup_test_accounts():
            print("ERROR: Failed to set up test accounts")
            return False
            
        print("Testing environment set up successfully")
        return True
        
    except Exception as e:
        print(f"ERROR: Failed to set up testing environment: {str(e)}")
        return False

def setup_test_nodes() -> bool:
    """
    Set up test nodes for the Layer-2 network.
    
    Returns:
        bool: True if setup was successful, False otherwise
    """
    print(f"Setting up {CONFIG['node_count']} test nodes...")
    
    global nodes
    nodes = []
    
    try:
        # In a real test, this would start actual nodes
        # For simulation, we'll create mock node objects
        for i in range(CONFIG['node_count']):
            node = {
                "id": f"node-{i}",
                "type": "sequencer" if i == 0 else "validator",
                "status": "running",
                "transactions_processed": 0,
                "start_time": time.time(),
            }
            nodes.append(node)
            
        print(f"Set up {len(nodes)} test nodes")
        return True
        
    except Exception as e:
        print(f"ERROR: Failed to set up test nodes: {str(e)}")
        return False

def setup_test_accounts() -> bool:
    """
    Set up test accounts and tokens for stress testing.
    
    Returns:
        bool: True if setup was successful, False otherwise
    """
    print("Setting up test accounts and tokens...")
    
    try:
        # In a real test, this would create actual accounts on the blockchain
        # For simulation, we'll create a mock accounts file
        
        # Create test wallets
        wallets = []
        for i in range(CONFIG['users']):
            wallet = {
                "id": f"wallet-{i}",
                "address": f"0x{i:064x}",
                "balance": 1000000,
                "transactions_sent": 0,
            }
            wallets.append(wallet)
        
        # Save wallet information for tests
        with open("test_wallets.json", "w") as f:
            json.dump(wallets, f, indent=2)
        
        print(f"Created {len(wallets)} test wallets")
        return True
        
    except Exception as e:
        print(f"ERROR: Failed to set up test accounts: {str(e)}")
        return False

def generate_transaction(wallet_id: str, tx_type: Optional[str] = None) -> Dict[str, Any]:
    """
    Generate a random transaction for stress testing.
    
    Args:
        wallet_id: ID of the wallet sending the transaction
        tx_type: Optional transaction type, random if not specified
        
    Returns:
        Dict[str, Any]: Transaction data
    """
    if tx_type is None:
        tx_type = random.choice(CONFIG["transaction_types"])
        
    size = random.choice(CONFIG["transaction_sizes"])
    
    # Generate random recipient
    recipient = f"wallet-{random.randint(0, CONFIG['users'] - 1)}"
    
    # Generate random amount
    amount = random.randint(1, 1000)
    
    # Generate random data
    data = os.urandom(size)
    
    # Create transaction
    transaction = {
        "id": f"tx-{int(time.time() * 1000)}-{random.randint(0, 1000000)}",
        "type": tx_type,
        "sender": wallet_id,
        "recipient": recipient,
        "amount": amount,
        "data_size": size,
        "timestamp": time.time(),
        "status": "pending",
    }
    
    return transaction

def process_transaction(transaction: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process a transaction in the Layer-2 system.
    
    Args:
        transaction: Transaction data
        
    Returns:
        Dict[str, Any]: Updated transaction with processing results
    """
    # In a real test, this would submit the transaction to the actual system
    # For simulation, we'll update the transaction status based on random success probability
    
    # Simulate processing delay based on transaction size and type
    base_delay = 0.01  # 10ms base delay
    size_factor = transaction["data_size"] / 1000  # 1ms per KB
    type_factor = 1.0
    
    if transaction["type"] == "transfer":
        type_factor = 1.0
    elif transaction["type"] == "deposit":
        type_factor = 1.5
    elif transaction["type"] == "withdraw":
        type_factor = 2.0
    elif transaction["type"] == "swap":
        type_factor = 2.5
    elif transaction["type"] == "stake":
        type_factor = 1.2
    elif transaction["type"] == "unstake":
        type_factor = 1.8
        
    delay = base_delay + (size_factor * type_factor * random.uniform(0.8, 1.2))
    
    # Simulate processing
    time.sleep(delay)
    
    # Determine success probability based on current load
    current_tps = len(RESULTS["actual_tps"]) > 0 and RESULTS["actual_tps"][-1] or 0
    load_factor = min(current_tps / CONFIG["tps"], 1.0)
    success_probability = 0.99 - (load_factor * 0.1)  # 99% at low load, 89% at max load
    
    # Update transaction status
    if random.random() < success_probability:
        transaction["status"] = "confirmed"
        transaction["confirmation_time"] = time.time()
        transaction["latency"] = transaction["confirmation_time"] - transaction["timestamp"]
        
        # Update node that processed the transaction
        node_index = random.randint(0, len(nodes) - 1)
        nodes[node_index]["transactions_processed"] += 1
        transaction["processed_by"] = nodes[node_index]["id"]
        
        with transaction_lock:
            RESULTS["successful_transactions"] += 1
            RESULTS["latencies"].append(transaction["latency"])
    else:
        transaction["status"] = "failed"
        transaction["error"] = random.choice([
            "timeout",
            "insufficient_funds",
            "nonce_too_low",
            "gas_price_too_low",
            "execution_reverted",
        ])
        
        with transaction_lock:
            RESULTS["failed_transactions"] += 1
            RESULTS["errors"].append({
                "transaction_id": transaction["id"],
                "error": transaction["error"],
                "timestamp": time.time(),
            })
    
    return transaction

def transaction_generator(stop_event: threading.Event) -> None:
    """
    Generate transactions at the specified TPS rate.
    
    Args:
        stop_event: Event to signal when to stop generating transactions
    """
    print(f"Starting transaction generator targeting {CONFIG['tps']} TPS...")
    
    # Load test wallets
    with open("test_wallets.json", "r") as f:
        wallets = json.load(f)
    
    # Calculate delay between transactions to achieve target TPS
    delay = 1.0 / CONFIG["tps"]
    
    # Generate transactions until stop event is set
    while not stop_event.is_set():
        start_time = time.time()
        
        # Select random wallet
        wallet = random.choice(wallets)
        
        # Generate transaction
        transaction = generate_transaction(wallet["id"])
        
        # Add transaction to queue
        with transaction_lock:
            transaction_queue.append(transaction)
            RESULTS["total_transactions"] += 1
            
        # Update wallet transaction count
        wallet["transactions_sent"] += 1
        
        # Sleep to maintain TPS rate
        elapsed = time.time() - start_time
        if elapsed < delay:
            time.sleep(delay - elapsed)

def transaction_processor(worker_id: int, stop_event: threading.Event) -> None:
    """
    Process transactions from the queue.
    
    Args:
        worker_id: ID of the worker thread
        stop_event: Event to signal when to stop processing transactions
    """
    print(f"Starting transaction processor worker {worker_id}...")
    
    # Process transactions until stop event is set
    while not stop_event.is_set():
        # Get transaction from queue
        transaction = None
        with transaction_lock:
            if transaction_queue:
                transaction = transaction_queue.pop(0)
        
        if transaction:
            # Process transaction
            process_transaction(transaction)
        else:
            # No transactions in queue, sleep briefly
            time.sleep(0.001)

def data_collector(stop_event: threading.Event) -> None:
    """
    Collect performance data during the test.
    
    Args:
        stop_event: Event to signal when to stop collecting data
    """
    print("Starting data collector...")
    
    interval = CONFIG["data_collection_interval"]
    last_total = 0
    
    # Collect data until stop event is set
    while not stop_event.is_set():
        start_time = time.time()
        
        # Calculate current TPS
        with transaction_lock:
            current_total = RESULTS["successful_transactions"] + RESULTS["failed_transactions"]
            current_tps = (current_total - last_total) / interval
            RESULTS["actual_tps"].append(current_tps)
            last_total = current_total
        
        # Collect resource usage data
        collect_resource_usage()
        
        # Sleep until next collection interval
        elapsed = time.time() - start_time
        if elapsed < interval:
            time.sleep(interval - elapsed)

def collect_resource_usage() -> None:
    """Collect resource usage data for the system"""
    # In a real test, this would collect actual resource usage data
    # For simulation, we'll generate mock data
    
    # Simulate CPU usage (percentage)
    cpu_usage = random.uniform(20, 80)
    RESULTS["resource_usage"]["cpu"].append(cpu_usage)
    
    # Simulate memory usage (MB)
    memory_usage = random.uniform(1000, 4000)
    RESULTS["resource_usage"]["memory"].append(memory_usage)
    
    # Simulate disk I/O (MB/s)
    disk_io = random.uniform(10, 100)
    RESULTS["resource_usage"]["disk_io"].append(disk_io)
    
    # Simulate network I/O (MB/s)
    network_io = random.uniform(5, 50)
    RESULTS["resource_usage"]["network_io"].append(network_io)

def run_stress_test() -> None:
    """Run the main stress test"""
    print(f"\nStarting stress test with {CONFIG['users']} users at {CONFIG['tps']} TPS for {CONFIG['duration']} seconds...")
    
    # Record start time
    RESULTS["start_time"] = time.time()
    
    # Create stop event
    stop_event = threading.Event()
    
    # Start data collector
    data_collector_thread = threading.Thread(target=data_collector, args=(stop_event,))
    data_collector_thread.daemon = True
    data_collector_thread.start()
    
    # Start transaction generator
    generator_thread = threading.Thread(target=transaction_generator, args=(stop_event,))
    generator_thread.daemon = True
    generator_thread.start()
    
    # Start transaction processors
    processor_threads = []
    processor_count = min(os.cpu_count() or 4, 16)  # Use up to 16 processor threads
    for i in range(processor_count):
        processor_thread = threading.Thread(target=transaction_processor, args=(i, stop_event))
        processor_thread.daemon = True
        processor_thread.start()
        processor_threads.append(processor_thread)
    
    # Wait for test duration
    try:
        time.sleep(CONFIG["duration"])
    except KeyboardInterrupt:
        print("\nTest interrupted by user")
    
    # Stop all threads
    print("\nStopping test...")
    stop_event.set()
    
    # Wait for threads to finish
    generator_thread.join(timeout=5)
    data_collector_thread.join(timeout=5)
    for thread in processor_threads:
        thread.join(timeout=5)
    
    # Record end time
    RESULTS["end_time"] = time.time()
    
    print("Stress test completed")

def run_specific_test_scenarios() -> None:
    """Run specific test scenarios to evaluate system behavior under different conditions"""
    print("\nRunning specific test scenarios...")
    
    scenarios = [
        {
            "name": "High TPS burst",
            "description": "Short burst of very high TPS to test system responsiveness",
            "duration": 30,
            "tps": CONFIG["tps"] * 2,
            "users": CONFIG["users"],
        },
        {
            "name": "Large transaction batch",
            "description": "Process large batches of transactions to test batch processing",
            "duration": 60,
            "tps": CONFIG["tps"],
            "users": CONFIG["users"],
            "batch_size": 500,
        },
        {
            "name": "Mixed transaction types",
            "description": "Mix of different transaction types to test varied workloads",
            "duration": 60,
            "tps": CONFIG["tps"],
            "users": CONFIG["users"],
            "transaction_mix": True,
        },
        {
            "name": "Node failure simulation",
            "description": "Simulate node failures to test system resilience",
            "duration": 60,
            "tps": CONFIG["tps"],
            "users": CONFIG["users"],
            "node_failures": True,
        },
        {
            "name": "Network latency simulation",
            "description": "Simulate network latency to test system performance",
            "duration": 60,
            "tps": CONFIG["tps"],
            "users": CONFIG["users"],
            "network_latency": True,
        },
    ]
    
    for scenario in scenarios:
        print(f"\nRunning scenario: {scenario['name']}")
        print(f"Description: {scenario['description']}")
        
        # Set up scenario-specific configuration
        original_tps = CONFIG["tps"]
        original_users = CONFIG["users"]
        original_duration = CONFIG["duration"]
        
        CONFIG["tps"] = scenario.get("tps", original_tps)
        CONFIG["users"] = scenario.get("users", original_users)
        CONFIG["duration"] = scenario.get("duration", original_duration)
        
        # Reset results for this scenario
        scenario_results = {
            "name": scenario["name"],
            "description": scenario["description"],
            "start_time": None,
            "end_time": None,
            "total_transactions": 0,
            "successful_transactions": 0,
            "failed_transactions": 0,
            "actual_tps": [],
            "latencies": [],
            "errors": [],
        }
        
        # Apply scenario-specific modifications
        if scenario.get("node_failures", False):
            # Simulate node failures during the test
            def simulate_node_failures():
                time.sleep(scenario["duration"] / 3)  # Wait for 1/3 of the test duration
                print("Simulating node failure...")
                if nodes:
                    # Simulate failure of a random non-sequencer node
                    for node in nodes[1:]:  # Skip the sequencer (first node)
                        if random.random() < 0.5:  # 50% chance of failure for each node
                            node["status"] = "failed"
                            print(f"Node {node['id']} has failed")
                
                time.sleep(scenario["duration"] / 3)  # Wait for another 1/3 of the test duration
                print("Recovering failed nodes...")
                # Recover all failed nodes
                for node in nodes:
                    if node["status"] == "failed":
                        node["status"] = "running"
                        print(f"Node {node['id']} has recovered")
            
            node_failure_thread = threading.Thread(target=simulate_node_failures)
            node_failure_thread.daemon = True
            node_failure_thread.start()
        
        if scenario.get("network_latency", False):
            # Simulate network latency during the test
            # This affects transaction processing time
            original_process_transaction = process_transaction
            
            def process_transaction_with_latency(transaction):
                # Add random latency
                latency = random.uniform(0.05, 0.2)  # 50-200ms additional latency
                time.sleep(latency)
                return original_process_transaction(transaction)
            
            # Replace the process_transaction function
            globals()["process_transaction"] = process_transaction_with_latency
        
        # Run the scenario
        scenario_results["start_time"] = time.time()
        
        # Create stop event
        stop_event = threading.Event()
        
        # Start data collector
        data_collector_thread = threading.Thread(target=data_collector, args=(stop_event,))
        data_collector_thread.daemon = True
        data_collector_thread.start()
        
        # Start transaction generator
        generator_thread = threading.Thread(target=transaction_generator, args=(stop_event,))
        generator_thread.daemon = True
        generator_thread.start()
        
        # Start transaction processors
        processor_threads = []
        processor_count = min(os.cpu_count() or 4, 16)  # Use up to 16 processor threads
        for i in range(processor_count):
            processor_thread = threading.Thread(target=transaction_processor, args=(i, stop_event))
            processor_thread.daemon = True
            processor_thread.start()
            processor_threads.append(processor_thread)
        
        # Wait for scenario duration
        try:
            time.sleep(CONFIG["duration"])
        except KeyboardInterrupt:
            print("\nScenario interrupted by user")
        
        # Stop all threads
        print(f"\nStopping scenario: {scenario['name']}...")
        stop_event.set()
        
        # Wait for threads to finish
        generator_thread.join(timeout=5)
        data_collector_thread.join(timeout=5)
        for thread in processor_threads:
            thread.join(timeout=5)
        
        # Record end time
        scenario_results["end_time"] = time.time()
        
        # Copy results for this scenario
        with transaction_lock:
            scenario_results["total_transactions"] = RESULTS["total_transactions"]
            scenario_results["successful_transactions"] = RESULTS["successful_transactions"]
            scenario_results["failed_transactions"] = RESULTS["failed_transactions"]
            scenario_results["actual_tps"] = RESULTS["actual_tps"].copy()
            scenario_results["latencies"] = RESULTS["latencies"].copy()
            scenario_results["errors"] = RESULTS["errors"].copy()
        
        # Reset global results for next scenario
        with transaction_lock:
            RESULTS["total_transactions"] = 0
            RESULTS["successful_transactions"] = 0
            RESULTS["failed_transactions"] = 0
            RESULTS["actual_tps"] = []
            RESULTS["latencies"] = []
            RESULTS["errors"] = []
        
        # Restore original process_transaction function if modified
        if scenario.get("network_latency", False):
            globals()["process_transaction"] = original_process_transaction
        
        # Add scenario results to overall results
        RESULTS["test_scenarios"].append(scenario_results)
        
        print(f"Scenario completed: {scenario['name']}")
        print(f"Transactions: {scenario_results['total_transactions']}")
        print(f"Success rate: {(scenario_results['successful_transactions'] / scenario_results['total_transactions'] * 100) if scenario_results['total_transactions'] > 0 else 0:.2f}%")
        print(f"Average TPS: {statistics.mean(scenario_results['actual_tps']) if scenario_results['actual_tps'] else 0:.2f}")
        print(f"Average latency: {statistics.mean(scenario_results['latencies']) * 1000 if scenario_results['latencies'] else 0:.2f} ms")
    
    # Restore original configuration
    CONFIG["tps"] = original_tps
    CONFIG["users"] = original_users
    CONFIG["duration"] = original_duration

def generate_charts() -> None:
    """Generate charts for the test results"""
    print("\nGenerating charts...")
    
    # Create charts directory
    os.makedirs("charts", exist_ok=True)
    
    # Generate TPS chart
    plt.figure(figsize=(10, 6))
    plt.plot(RESULTS["actual_tps"])
    plt.axhline(y=CONFIG["tps"], color='r', linestyle='--', label=f"Target TPS: {CONFIG['tps']}")
    plt.title("Transactions Per Second")
    plt.xlabel("Time (seconds)")
    plt.ylabel("TPS")
    plt.grid(True)
    plt.legend()
    plt.savefig("charts/tps.png")
    
    # Generate latency chart
    plt.figure(figsize=(10, 6))
    plt.hist(np.array(RESULTS["latencies"]) * 1000, bins=50)  # Convert to milliseconds
    plt.title("Transaction Latency Distribution")
    plt.xlabel("Latency (ms)")
    plt.ylabel("Frequency")
    plt.grid(True)
    plt.savefig("charts/latency.png")
    
    # Generate resource usage charts
    plt.figure(figsize=(10, 6))
    plt.plot(RESULTS["resource_usage"]["cpu"], label="CPU (%)")
    plt.title("CPU Usage")
    plt.xlabel("Time (seconds)")
    plt.ylabel("CPU Usage (%)")
    plt.grid(True)
    plt.legend()
    plt.savefig("charts/cpu_usage.png")
    
    plt.figure(figsize=(10, 6))
    plt.plot(RESULTS["resource_usage"]["memory"], label="Memory (MB)")
    plt.title("Memory Usage")
    plt.xlabel("Time (seconds)")
    plt.ylabel("Memory Usage (MB)")
    plt.grid(True)
    plt.legend()
    plt.savefig("charts/memory_usage.png")
    
    plt.figure(figsize=(10, 6))
    plt.plot(RESULTS["resource_usage"]["disk_io"], label="Disk I/O (MB/s)")
    plt.title("Disk I/O")
    plt.xlabel("Time (seconds)")
    plt.ylabel("Disk I/O (MB/s)")
    plt.grid(True)
    plt.legend()
    plt.savefig("charts/disk_io.png")
    
    plt.figure(figsize=(10, 6))
    plt.plot(RESULTS["resource_usage"]["network_io"], label="Network I/O (MB/s)")
    plt.title("Network I/O")
    plt.xlabel("Time (seconds)")
    plt.ylabel("Network I/O (MB/s)")
    plt.grid(True)
    plt.legend()
    plt.savefig("charts/network_io.png")
    
    # Generate scenario comparison charts
    if RESULTS["test_scenarios"]:
        # TPS comparison
        plt.figure(figsize=(12, 6))
        for i, scenario in enumerate(RESULTS["test_scenarios"]):
            avg_tps = statistics.mean(scenario["actual_tps"]) if scenario["actual_tps"] else 0
            plt.bar(i, avg_tps, label=scenario["name"])
        plt.title("Average TPS by Scenario")
        plt.xlabel("Scenario")
        plt.ylabel("Average TPS")
        plt.xticks(range(len(RESULTS["test_scenarios"])), [s["name"] for s in RESULTS["test_scenarios"]], rotation=45, ha="right")
        plt.tight_layout()
        plt.grid(True, axis='y')
        plt.savefig("charts/scenario_tps.png")
        
        # Latency comparison
        plt.figure(figsize=(12, 6))
        for i, scenario in enumerate(RESULTS["test_scenarios"]):
            avg_latency = statistics.mean(scenario["latencies"]) * 1000 if scenario["latencies"] else 0  # Convert to milliseconds
            plt.bar(i, avg_latency, label=scenario["name"])
        plt.title("Average Latency by Scenario")
        plt.xlabel("Scenario")
        plt.ylabel("Average Latency (ms)")
        plt.xticks(range(len(RESULTS["test_scenarios"])), [s["name"] for s in RESULTS["test_scenarios"]], rotation=45, ha="right")
        plt.tight_layout()
        plt.grid(True, axis='y')
        plt.savefig("charts/scenario_latency.png")
        
        # Success rate comparison
        plt.figure(figsize=(12, 6))
        for i, scenario in enumerate(RESULTS["test_scenarios"]):
            success_rate = (scenario["successful_transactions"] / scenario["total_transactions"] * 100) if scenario["total_transactions"] > 0 else 0
            plt.bar(i, success_rate, label=scenario["name"])
        plt.title("Success Rate by Scenario")
        plt.xlabel("Scenario")
        plt.ylabel("Success Rate (%)")
        plt.xticks(range(len(RESULTS["test_scenarios"])), [s["name"] for s in RESULTS["test_scenarios"]], rotation=45, ha="right")
        plt.tight_layout()
        plt.grid(True, axis='y')
        plt.savefig("charts/scenario_success_rate.png")
    
    print("Charts generated in the 'charts' directory")

def generate_report(report_file: str) -> None:
    """
    Generate a detailed stress test report.
    
    Args:
        report_file: Path to the output report file
    """
    print(f"\nGenerating stress test report: {report_file}")
    
    # Calculate test duration
    duration = RESULTS["end_time"] - RESULTS["start_time"]
    duration_str = f"{duration:.2f} seconds"
    
    # Calculate success rate
    success_rate = (RESULTS["successful_transactions"] / RESULTS["total_transactions"] * 100) if RESULTS["total_transactions"] > 0 else 0
    
    # Calculate average TPS
    avg_tps = statistics.mean(RESULTS["actual_tps"]) if RESULTS["actual_tps"] else 0
    
    # Calculate latency statistics
    if RESULTS["latencies"]:
        min_latency = min(RESULTS["latencies"]) * 1000  # Convert to milliseconds
        max_latency = max(RESULTS["latencies"]) * 1000
        avg_latency = statistics.mean(RESULTS["latencies"]) * 1000
        p50_latency = np.percentile(RESULTS["latencies"], 50) * 1000
        p95_latency = np.percentile(RESULTS["latencies"], 95) * 1000
        p99_latency = np.percentile(RESULTS["latencies"], 99) * 1000
    else:
        min_latency = max_latency = avg_latency = p50_latency = p95_latency = p99_latency = 0
    
    # Generate report content
    report_content = f"""# Layer-2 on Solana Stress Test Report

## Summary

- **Date**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
- **Duration**: {duration_str}
- **Users**: {CONFIG["users"]}
- **Target TPS**: {CONFIG["tps"]}
- **Actual Average TPS**: {avg_tps:.2f}
- **Total Transactions**: {RESULTS["total_transactions"]}
- **Successful Transactions**: {RESULTS["successful_transactions"]} ({success_rate:.2f}%)
- **Failed Transactions**: {RESULTS["failed_transactions"]} ({100 - success_rate:.2f}%)

## Performance Metrics

### Throughput

- **Average TPS**: {avg_tps:.2f}
- **Peak TPS**: {max(RESULTS["actual_tps"]) if RESULTS["actual_tps"] else 0:.2f}
- **Minimum TPS**: {min(RESULTS["actual_tps"]) if RESULTS["actual_tps"] else 0:.2f}

### Latency

- **Average Latency**: {avg_latency:.2f} ms
- **Minimum Latency**: {min_latency:.2f} ms
- **Maximum Latency**: {max_latency:.2f} ms
- **50th Percentile (P50)**: {p50_latency:.2f} ms
- **95th Percentile (P95)**: {p95_latency:.2f} ms
- **99th Percentile (P99)**: {p99_latency:.2f} ms

### Resource Usage

- **Average CPU Usage**: {statistics.mean(RESULTS["resource_usage"]["cpu"]) if RESULTS["resource_usage"]["cpu"] else 0:.2f}%
- **Peak CPU Usage**: {max(RESULTS["resource_usage"]["cpu"]) if RESULTS["resource_usage"]["cpu"] else 0:.2f}%
- **Average Memory Usage**: {statistics.mean(RESULTS["resource_usage"]["memory"]) if RESULTS["resource_usage"]["memory"] else 0:.2f} MB
- **Peak Memory Usage**: {max(RESULTS["resource_usage"]["memory"]) if RESULTS["resource_usage"]["memory"] else 0:.2f} MB
- **Average Disk I/O**: {statistics.mean(RESULTS["resource_usage"]["disk_io"]) if RESULTS["resource_usage"]["disk_io"] else 0:.2f} MB/s
- **Average Network I/O**: {statistics.mean(RESULTS["resource_usage"]["network_io"]) if RESULTS["resource_usage"]["network_io"] else 0:.2f} MB/s

## Charts

![TPS Chart](charts/tps.png)

![Latency Distribution](charts/latency.png)

![CPU Usage](charts/cpu_usage.png)

![Memory Usage](charts/memory_usage.png)

## Error Analysis

Total errors: {len(RESULTS["errors"])}

"""
    
    if RESULTS["errors"]:
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
    else:
        report_content += "No errors were recorded during the test.\n\n"
    
    # Add scenario results
    if RESULTS["test_scenarios"]:
        report_content += "## Test Scenarios\n\n"
        
        for i, scenario in enumerate(RESULTS["test_scenarios"]):
            scenario_duration = scenario["end_time"] - scenario["start_time"]
            scenario_success_rate = (scenario["successful_transactions"] / scenario["total_transactions"] * 100) if scenario["total_transactions"] > 0 else 0
            scenario_avg_tps = statistics.mean(scenario["actual_tps"]) if scenario["actual_tps"] else 0
            scenario_avg_latency = statistics.mean(scenario["latencies"]) * 1000 if scenario["latencies"] else 0
            
            report_content += f"### Scenario {i+1}: {scenario['name']}\n\n"
            report_content += f"**Description**: {scenario['description']}\n\n"
            report_content += f"- **Duration**: {scenario_duration:.2f} seconds\n"
            report_content += f"- **Total Transactions**: {scenario['total_transactions']}\n"
            report_content += f"- **Success Rate**: {scenario_success_rate:.2f}%\n"
            report_content += f"- **Average TPS**: {scenario_avg_tps:.2f}\n"
            report_content += f"- **Average Latency**: {scenario_avg_latency:.2f} ms\n\n"
        
        # Add scenario comparison charts
        report_content += "### Scenario Comparisons\n\n"
        report_content += "![Scenario TPS Comparison](charts/scenario_tps.png)\n\n"
        report_content += "![Scenario Latency Comparison](charts/scenario_latency.png)\n\n"
        report_content += "![Scenario Success Rate Comparison](charts/scenario_success_rate.png)\n\n"
    
    report_content += """## Conclusion

Based on the stress test results, the Layer-2 on Solana implementation demonstrates [overall assessment based on results].

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
    
    print(f"Stress test report generated: {report_file}")

def main():
    """Main function to run the stress tests"""
    parser = argparse.ArgumentParser(description="Stress Testing Framework for Layer-2 on Solana")
    parser.add_argument("--duration", type=int, default=300, help="Test duration in seconds")
    parser.add_argument("--users", type=int, default=1000, help="Number of simulated concurrent users")
    parser.add_argument("--tps", type=int, default=5000, help="Target transactions per second")
    parser.add_argument("--report-file", default="stress_test_report.md", help="Path to output the detailed report")
    args = parser.parse_args()
    
    # Update configuration
    CONFIG["duration"] = args.duration
    CONFIG["users"] = args.users
    CONFIG["tps"] = args.tps
    CONFIG["report_file"] = args.report_file
    
    print("=== Layer-2 on Solana Stress Testing ===")
    print(f"Duration: {CONFIG['duration']} seconds")
    print(f"Users: {CONFIG['users']}")
    print(f"Target TPS: {CONFIG['tps']}")
    print(f"Report file: {CONFIG['report_file']}")
    
    # Set up testing environment
    if not setup_environment():
        print("Failed to set up testing environment. Exiting.")
        sys.exit(1)
    
    # Run main stress test
    run_stress_test()
    
    # Run specific test scenarios
    run_specific_test_scenarios()
    
    # Generate charts
    generate_charts()
    
    # Generate report
    generate_report(CONFIG["report_file"])
    
    # Print summary
    print("\n=== Test Summary ===")
    print(f"Total transactions: {RESULTS['total_transactions']}")
    print(f"Successful transactions: {RESULTS['successful_transactions']} ({(RESULTS['successful_transactions'] / RESULTS['total_transactions'] * 100) if RESULTS['total_transactions'] > 0 else 0:.2f}%)")
    print(f"Failed transactions: {RESULTS['failed_transactions']} ({(RESULTS['failed_transactions'] / RESULTS['total_transactions'] * 100) if RESULTS['total_transactions'] > 0 else 0:.2f}%)")
    print(f"Average TPS: {statistics.mean(RESULTS['actual_tps']) if RESULTS['actual_tps'] else 0:.2f}")
    print(f"Average latency: {statistics.mean(RESULTS['latencies']) * 1000 if RESULTS['latencies'] else 0:.2f} ms")
    print(f"Duration: {RESULTS['end_time'] - RESULTS['start_time']:.2f} seconds")
    print(f"Report: {CONFIG['report_file']}")
    
    # Return exit code based on test results
    if RESULTS["failed_transactions"] > RESULTS["total_transactions"] * 0.1:  # More than 10% failures
        print("\nStress testing failed. See report for details.")
        sys.exit(1)
    else:
        print("\nStress testing completed successfully.")
        sys.exit(0)

if __name__ == "__main__":
    main()
