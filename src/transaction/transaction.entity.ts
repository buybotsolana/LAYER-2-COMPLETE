// English comment for verification
/**
 * @file transaction.entity.ts
 * @description Entity definition for transactions in the Layer-2 system
 * @module transaction/entity
 */

import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Bundle } from '../sequencer/bundle.entity';

/**
 * Enum representing the possible statuses of a transaction
 */
export enum TransactionStatus {
  PENDING = 'pending',       // Transaction is waiting to be included in a bundle
  BUNDLED = 'bundled',       // Transaction has been included in a bundle
  CONFIRMED = 'confirmed',   // Transaction has been confirmed on-chain
  FAILED = 'failed',         // Transaction has failed
  EXPIRED = 'expired'        // Transaction has expired
}

/**
 * Enum representing the possible types of a transaction
 */
export enum TransactionType {
  TRANSFER = 'transfer',     // Token transfer transaction
  SWAP = 'swap',             // Token swap transaction
  BRIDGE = 'bridge',         // Cross-chain bridge transaction
  STAKE = 'stake',           // Staking transaction
  UNSTAKE = 'unstake',       // Unstaking transaction
  CLAIM = 'claim',           // Reward claim transaction
  ADMIN = 'admin'            // Administrative transaction
}

/**
 * Entity representing a transaction in the Layer-2 system
 * Stores all transaction data and metadata
 */
@Entity('transactions')
export class Transaction {
  /**
   * Unique identifier for the transaction
   */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Hash of the transaction
   * This is indexed for fast lookups
   */
  @Column({ length: 66 })
  @Index()
  hash: string;

  /**
   * Address of the sender
   * This is indexed for fast lookups by sender
   */
  @Column({ length: 44 })
  @Index()
  sender: string;

  /**
   * Address of the recipient
   * This is indexed for fast lookups by recipient
   */
  @Column({ length: 44 })
  @Index()
  recipient: string;

  /**
   * Amount of the transaction in base units
   * Stored as a string to preserve precision for large numbers
   */
  @Column({ type: 'varchar', length: 78 })
  amount: string;

  /**
   * Gas limit for the transaction
   */
  @Column({ type: 'int' })
  gasLimit: number;

  /**
   * Gas price for the transaction in base units
   * Stored as a string to preserve precision
   */
  @Column({ type: 'varchar', length: 78 })
  gasPrice: string;

  /**
   * Nonce of the transaction
   * This is indexed for fast lookups by nonce
   */
  @Column({ type: 'int' })
  @Index()
  nonce: number;

  /**
   * Raw transaction data
   */
  @Column({ type: 'text' })
  data: string;

  /**
   * Signature of the transaction
   */
  @Column({ type: 'varchar', length: 132 })
  signature: string;

  /**
   * Type of the transaction
   */
  @Column({
    type: 'enum',
    enum: TransactionType,
    default: TransactionType.TRANSFER
  })
  type: TransactionType;

  /**
   * Status of the transaction
   * This is indexed for fast lookups by status
   */
  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING
  })
  @Index()
  status: TransactionStatus;

  /**
   * Priority of the transaction (1-100)
   * Higher values indicate higher priority
   */
  @Column({ type: 'int', default: 50 })
  priority: number;

  /**
   * Fee paid for the transaction in base units
   * Stored as a string to preserve precision
   */
  @Column({ type: 'varchar', length: 78 })
  fee: string;

  /**
   * Timestamp when the transaction was created
   * This is indexed for fast lookups by creation time
   */
  @CreateDateColumn()
  @Index()
  createdAt: Date;

  /**
   * Timestamp when the transaction was last updated
   */
  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * Timestamp when the transaction expires
   * This is indexed for fast lookups of expired transactions
   */
  @Column({ type: 'timestamp', nullable: true })
  @Index()
  expiresAt: Date | null;

  /**
   * Error message if the transaction failed
   */
  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  /**
   * Block number where the transaction was confirmed
   * Null if not yet confirmed
   */
  @Column({ type: 'int', nullable: true })
  blockNumber: number | null;

  /**
   * Block timestamp when the transaction was confirmed
   * Null if not yet confirmed
   */
  @Column({ type: 'timestamp', nullable: true })
  blockTimestamp: Date | null;

  /**
   * ID of the bundle that includes this transaction
   * Null if not yet bundled
   */
  @Column({ nullable: true })
  bundleId: string | null;

  /**
   * Relation to the bundle that includes this transaction
   */
  @ManyToOne(() => Bundle, bundle => bundle.transactions)
  @JoinColumn({ name: 'bundleId' })
  bundle: Bundle | null;

  /**
   * Additional metadata for the transaction
   * Stored as a JSON object
   */
  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;
}
