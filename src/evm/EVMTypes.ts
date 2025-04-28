// English comment for verification
/**
 * @file EVMTypes.ts
 * @description Type definitions for the EVM compatibility layer
 * @author Layer2 Team
 * @date April 27, 2025
 */

import { BigNumber } from 'ethers';
import BN from 'bn.js';

/**
 * Enum representing different EVM opcodes
 */
export enum EVMOpcode {
  // Stack operations
  PUSH1 = 0x60,
  PUSH2 = 0x61,
  PUSH32 = 0x7f,
  POP = 0x50,
  DUP1 = 0x80,
  DUP2 = 0x81,
  SWAP1 = 0x90,
  SWAP2 = 0x91,
  
  // Arithmetic operations
  ADD = 0x01,
  SUB = 0x03,
  MUL = 0x02,
  DIV = 0x04,
  MOD = 0x06,
  
  // Logical operations
  LT = 0x10,
  GT = 0x11,
  EQ = 0x14,
  AND = 0x16,
  OR = 0x17,
  
  // Memory operations
  MLOAD = 0x51,
  MSTORE = 0x52,
  MSTORE8 = 0x53,
  
  // Storage operations
  SLOAD = 0x54,
  SSTORE = 0x55,
  
  // Control flow
  JUMP = 0x56,
  JUMPI = 0x57,
  PC = 0x58,
  JUMPDEST = 0x5b,
  
  // Environment information
  ADDRESS = 0x30,
  BALANCE = 0x31,
  ORIGIN = 0x32,
  CALLER = 0x33,
  CALLVALUE = 0x34,
  CALLDATALOAD = 0x35,
  CALLDATASIZE = 0x36,
  CALLDATACOPY = 0x37,
  CODESIZE = 0x38,
  CODECOPY = 0x39,
  GASPRICE = 0x3a,
  
  // Block information
  BLOCKHASH = 0x40,
  COINBASE = 0x41,
  TIMESTAMP = 0x42,
  NUMBER = 0x43,
  DIFFICULTY = 0x44,
  GASLIMIT = 0x45,
  
  // System operations
  CREATE = 0xf0,
  CALL = 0xf1,
  CALLCODE = 0xf2,
  RETURN = 0xf3,
  DELEGATECALL = 0xf4,
  STATICCALL = 0xfa,
  REVERT = 0xfd,
  INVALID = 0xfe,
  SELFDESTRUCT = 0xff,
  
  // Logging operations
  LOG0 = 0xa0,
  LOG1 = 0xa1,
  LOG2 = 0xa2,
  LOG3 = 0xa3,
  LOG4 = 0xa4,
  
  // SHA3
  SHA3 = 0x20,
  
  // Gas
  GAS = 0x5a,
  
  // Stop
  STOP = 0x00
}

/**
 * Interface representing an EVM instruction
 */
export interface EVMInstruction {
  /** Opcode of the instruction */
  opcode: EVMOpcode;
  /** Operands of the instruction (if any) */
  operands?: Buffer;
  /** Gas cost of the instruction */
  gasCost: number;
  /** Program counter */
  pc: number;
}

/**
 * Interface representing the EVM execution context
 */
export interface EVMExecutionContext {
  /** Call data */
  callData: Buffer;
  /** Call value */
  callValue: BigNumber;
  /** Address of the contract being executed */
  address: string;
  /** Address of the caller */
  caller: string;
  /** Address of the origin */
  origin: string;
  /** Gas price */
  gasPrice: BigNumber;
  /** Gas limit */
  gasLimit: BigNumber;
  /** Block number */
  blockNumber: number;
  /** Block timestamp */
  blockTimestamp: number;
  /** Block coinbase */
  blockCoinbase: string;
  /** Block difficulty */
  blockDifficulty: BigNumber;
  /** Block gas limit */
  blockGasLimit: BigNumber;
  /** Chain ID */
  chainId: number;
  /** Static call flag */
  isStatic: boolean;
  /** Depth of the call stack */
  depth: number;
}

/**
 * Interface representing the EVM stack
 */
export interface EVMStack {
  /** Stack items */
  items: BigNumber[];
  /** Maximum stack size */
  maxSize: number;
  
  /** Pushes a value onto the stack */
  push(value: BigNumber): void;
  /** Pops a value from the stack */
  pop(): BigNumber;
  /** Duplicates a stack item */
  dup(position: number): void;
  /** Swaps two stack items */
  swap(position: number): void;
  /** Gets the current stack size */
  size(): number;
  /** Gets a stack item at a specific position */
  get(position: number): BigNumber;
  /** Sets a stack item at a specific position */
  set(position: number, value: BigNumber): void;
  /** Checks if the stack is empty */
  isEmpty(): boolean;
  /** Checks if the stack is full */
  isFull(): boolean;
  /** Clears the stack */
  clear(): void;
}

/**
 * Interface representing the EVM memory
 */
export interface EVMMemory {
  /** Memory buffer */
  buffer: Buffer;
  /** Maximum memory size */
  maxSize: number;
  
  /** Stores a value in memory */
  store(offset: number, value: Buffer): void;
  /** Stores a byte in memory */
  store8(offset: number, value: number): void;
  /** Loads a value from memory */
  load(offset: number, length: number): Buffer;
  /** Gets the current memory size */
  size(): number;
  /** Expands memory to accommodate a specific offset */
  expand(offset: number, length: number): void;
  /** Clears memory */
  clear(): void;
}

/**
 * Interface representing the EVM storage
 */
export interface EVMStorage {
  /** Storage map */
  storage: Map<string, BigNumber>;
  
  /** Stores a value in storage */
  store(key: BigNumber, value: BigNumber): void;
  /** Loads a value from storage */
  load(key: BigNumber): BigNumber;
  /** Clears storage */
  clear(): void;
  /** Gets all storage entries */
  getAll(): Map<string, BigNumber>;
  /** Sets all storage entries */
  setAll(storage: Map<string, BigNumber>): void;
}

/**
 * Interface representing the EVM logs
 */
export interface EVMLog {
  /** Address of the contract that generated the log */
  address: string;
  /** Log topics */
  topics: string[];
  /** Log data */
  data: Buffer;
  /** Block number */
  blockNumber: number;
  /** Transaction hash */
  transactionHash: string;
  /** Transaction index */
  transactionIndex: number;
  /** Block hash */
  blockHash: string;
  /** Log index */
  logIndex: number;
}

/**
 * Interface representing the EVM execution result
 */
export interface EVMExecutionResult {
  /** Return data */
  returnData: Buffer;
  /** Gas used */
  gasUsed: BigNumber;
  /** Reverted flag */
  reverted: boolean;
  /** Error message (if any) */
  error?: string;
  /** Logs generated during execution */
  logs: EVMLog[];
  /** Created contract address (if any) */
  createdAddress?: string;
  /** Self-destructed addresses */
  selfDestructed: string[];
  /** Refunded gas */
  gasRefund: BigNumber;
}

/**
 * Interface representing an EVM contract
 */
export interface EVMContract {
  /** Contract address */
  address: string;
  /** Contract code */
  code: Buffer;
  /** Contract storage */
  storage: EVMStorage;
  /** Contract balance */
  balance: BigNumber;
  /** Contract nonce */
  nonce: number;
  /** Contract code hash */
  codeHash: string;
}

/**
 * Interface representing an EVM account
 */
export interface EVMAccount {
  /** Account address */
  address: string;
  /** Account balance */
  balance: BigNumber;
  /** Account nonce */
  nonce: number;
  /** Account code (if any) */
  code?: Buffer;
  /** Account storage (if any) */
  storage?: EVMStorage;
  /** Account code hash (if any) */
  codeHash?: string;
}

/**
 * Interface representing an EVM transaction
 */
export interface EVMTransaction {
  /** Transaction hash */
  hash: string;
  /** Transaction nonce */
  nonce: number;
  /** Block hash */
  blockHash: string;
  /** Block number */
  blockNumber: number;
  /** Transaction index */
  transactionIndex: number;
  /** Sender address */
  from: string;
  /** Recipient address */
  to?: string;
  /** Transaction value */
  value: BigNumber;
  /** Gas price */
  gasPrice: BigNumber;
  /** Gas limit */
  gas: BigNumber;
  /** Transaction input data */
  input: Buffer;
  /** Transaction v value */
  v: number;
  /** Transaction r value */
  r: string;
  /** Transaction s value */
  s: string;
  /** Chain ID */
  chainId: number;
}

/**
 * Interface representing an EVM block
 */
export interface EVMBlock {
  /** Block hash */
  hash: string;
  /** Parent hash */
  parentHash: string;
  /** Block number */
  number: number;
  /** Block timestamp */
  timestamp: number;
  /** Block nonce */
  nonce: string;
  /** Block difficulty */
  difficulty: BigNumber;
  /** Gas limit */
  gasLimit: BigNumber;
  /** Gas used */
  gasUsed: BigNumber;
  /** Miner address */
  miner: string;
  /** Extra data */
  extraData: Buffer;
  /** Transactions */
  transactions: string[] | EVMTransaction[];
  /** Uncles */
  uncles: string[];
  /** Receipts root */
  receiptsRoot: string;
  /** Transactions root */
  transactionsRoot: string;
  /** State root */
  stateRoot: string;
  /** Logs bloom */
  logsBloom: Buffer;
  /** Mix hash */
  mixHash: string;
}

/**
 * Interface representing an EVM transaction receipt
 */
export interface EVMTransactionReceipt {
  /** Transaction hash */
  transactionHash: string;
  /** Transaction index */
  transactionIndex: number;
  /** Block hash */
  blockHash: string;
  /** Block number */
  blockNumber: number;
  /** Sender address */
  from: string;
  /** Recipient address */
  to?: string;
  /** Cumulative gas used */
  cumulativeGasUsed: BigNumber;
  /** Gas used */
  gasUsed: BigNumber;
  /** Contract address (if created) */
  contractAddress?: string;
  /** Logs */
  logs: EVMLog[];
  /** Logs bloom */
  logsBloom: Buffer;
  /** Status (1 for success, 0 for failure) */
  status: number;
}

/**
 * Interface representing EVM configuration options
 */
export interface EVMOptions {
  /** Chain ID */
  chainId: number;
  /** Hardfork */
  hardfork: string;
  /** Enable EIP-1559 */
  enableEIP1559: boolean;
  /** Enable EIP-2930 */
  enableEIP2930: boolean;
  /** Enable EIP-3198 */
  enableEIP3198: boolean;
  /** Enable EIP-3529 */
  enableEIP3529: boolean;
  /** Enable EIP-3541 */
  enableEIP3541: boolean;
  /** Gas limit */
  gasLimit: BigNumber;
  /** Block gas limit */
  blockGasLimit: BigNumber;
  /** Block timestamp */
  blockTimestamp: number;
  /** Block number */
  blockNumber: number;
  /** Block difficulty */
  blockDifficulty: BigNumber;
  /** Block coinbase */
  blockCoinbase: string;
  /** Allow unlimited contract size */
  allowUnlimitedContractSize: boolean;
  /** Debug mode */
  debug: boolean;
}
