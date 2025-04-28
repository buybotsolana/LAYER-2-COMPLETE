// English comment for verification
/**
 * @file bundle.entity.ts
 * @description Enhanced entity definition for transaction bundles in the Layer-2 system
 * @module sequencer/entity
 */

import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { Transaction } from '../transaction/transaction.entity';

/**
 * Enum representing the possible statuses of a bundle
 */
export enum BundleStatus {
  PENDING = 'pending',       // Bundle is being filled with transactions
  READY = 'ready',           // Bundle is ready to be processed
  PROCESSING = 'processing', // Bundle is being processed
  SUBMITTING = 'submitting', // Bundle is being submitted to the blockchain
  CONFIRMED = 'confirmed',   // Bundle has been confirmed on-chain
  FAILED = 'failed',         // Bundle has failed
  EXPIRED = 'expired',       // Bundle has expired
  ABORTED = 'aborted'        // Bundle has been aborted
}

/**
 * Enum representing the possible priorities of a bundle
 */
export enum BundlePriority {
  LOW = 'low',               // Low priority bundle (processed last)
  MEDIUM = 'medium',         // Medium priority bundle
  HIGH = 'high',             // High priority bundle
  CRITICAL = 'critical'      // Critical priority bundle (processed first)
}

/**
 * Enum representing the possible types of a bundle
 */
export enum BundleType {
  STANDARD = 'standard',     // Standard bundle with mixed transactions
  SWAP = 'swap',             // Bundle containing only swap transactions
  BRIDGE = 'bridge',         // Bundle containing only bridge transactions
  STAKING = 'staking',       // Bundle containing only staking transactions
  ADMIN = 'admin'            // Bundle containing only administrative transactions
}

/**
 * Enhanced entity representing a bundle of transactions in the Layer-2 system
 * Stores all bundle data and metadata with PostgreSQL optimizations
 */
@Entity('bundles')
export class Bundle {
  /**
   * Unique identifier for the bundle
   */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Status of the bundle
   * This is indexed for fast lookups by status
   */
  @Column({
    type: 'enum',
    enum: BundleStatus,
    default: BundleStatus.PENDING
  })
  @Index()
  status: BundleStatus;

  /**
   * Priority of the bundle
   * This is indexed for fast lookups by priority
   */
  @Column({
    type: 'enum',
    enum: BundlePriority,
    default: BundlePriority.MEDIUM
  })
  @Index()
  priority: BundlePriority;

  /**
   * Type of the bundle
   * This is indexed for fast lookups by type
   */
  @Column({
    type: 'enum',
    enum: BundleType,
    default: BundleType.STANDARD
  })
  @Index()
  type: BundleType;

  /**
   * Hash of the bundle transaction on-chain
   * This is null until the bundle is submitted
   */
  @Column({ length: 66, nullable: true })
  @Index()
  hash: string | null;

  /**
   * Maximum number of transactions allowed in this bundle
   */
  @Column({ type: 'int' })
  maxTransactions: number;

  /**
   * Maximum gas allowed for this bundle
   */
  @Column({ type: 'int' })
  maxGas: number;

  /**
   * Current gas used by transactions in this bundle
   */
  @Column({ type: 'int', default: 0 })
  currentGas: number;

  /**
   * Priority fee for this bundle in base units
   * Stored as a string to preserve precision
   */
  @Column({ type: 'varchar', length: 78 })
  priorityFee: string;

  /**
   * Base fee for this bundle in base units
   * Stored as a string to preserve precision
   */
  @Column({ type: 'varchar', length: 78, default: '0' })
  baseFee: string;

  /**
   * Total fee collected for this bundle in base units
   * Stored as a string to preserve precision
   */
  @Column({ type: 'varchar', length: 78, default: '0' })
  totalFee: string;

  /**
   * Number of transactions in this bundle
   * This is a counter cache to avoid counting transactions every time
   */
  @Column({ type: 'int', default: 0 })
  transactionCount: number;

  /**
   * Number of retries for this bundle
   * Incremented each time the bundle submission fails
   */
  @Column({ type: 'int', default: 0 })
  retryCount: number;

  /**
   * Maximum number of retries allowed for this bundle
   */
  @Column({ type: 'int', default: 3 })
  maxRetries: number;

  /**
   * Timestamp when the bundle was created
   * This is indexed for fast lookups by creation time
   */
  @CreateDateColumn()
  @Index()
  createdAt: Date;

  /**
   * Timestamp when the bundle was last updated
   */
  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * Timestamp when the bundle expires
   * This is indexed for fast lookups of expired bundles
   */
  @Column({ type: 'timestamp', nullable: true })
  @Index()
  expiresAt: Date | null;

  /**
   * Timestamp when the bundle was finalized (marked as READY)
   * This is null until the bundle is finalized
   */
  @Column({ type: 'timestamp', nullable: true })
  finalizedAt: Date | null;

  /**
   * Timestamp when the bundle was processed
   * This is null until the bundle is processed
   */
  @Column({ type: 'timestamp', nullable: true })
  processedAt: Date | null;

  /**
   * Timestamp when the bundle was submitted to the blockchain
   * This is null until the bundle is submitted
   */
  @Column({ type: 'timestamp', nullable: true })
  submittedAt: Date | null;

  /**
   * Timestamp when the bundle was confirmed on-chain
   * This is null until the bundle is confirmed
   */
  @Column({ type: 'timestamp', nullable: true })
  confirmedAt: Date | null;

  /**
   * Block number where the bundle was confirmed
   * This is null until the bundle is confirmed
   */
  @Column({ type: 'int', nullable: true })
  blockNumber: number | null;

  /**
   * Block timestamp when the bundle was confirmed
   * This is null until the bundle is confirmed
   */
  @Column({ type: 'timestamp', nullable: true })
  blockTimestamp: Date | null;

  /**
   * Error message if the bundle failed
   * This is null unless the bundle failed
   */
  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  /**
   * ID of the sequencer that processed this bundle
   * Used for multi-sequencer setups
   */
  @Column({ length: 36, nullable: true })
  sequencerId: string | null;

  /**
   * ID of the parent bundle if this is a retry
   * This is null unless this bundle is a retry of a failed bundle
   */
  @Column({ nullable: true })
  parentBundleId: string | null;

  /**
   * Relation to the parent bundle if this is a retry
   */
  @ManyToOne(() => Bundle, bundle => bundle.childBundles)
  @JoinColumn({ name: 'parentBundleId' })
  parentBundle: Bundle | null;

  /**
   * Relation to child bundles if this bundle has retries
   */
  @OneToMany(() => Bundle, bundle => bundle.parentBundle)
  childBundles: Bundle[];

  /**
   * Relation to the transactions in this bundle
   */
  @OneToMany(() => Transaction, transaction => transaction.bundle)
  transactions: Transaction[];

  /**
   * Raw transaction data for the bundle
   * This is the serialized transaction that was submitted to the blockchain
   */
  @Column({ type: 'text', nullable: true })
  rawTransaction: string | null;

  /**
   * Gas price used for the bundle submission in base units
   * Stored as a string to preserve precision
   */
  @Column({ type: 'varchar', length: 78, nullable: true })
  submissionGasPrice: string | null;

  /**
   * Gas used by the bundle transaction on-chain
   * This is null until the bundle is confirmed
   */
  @Column({ type: 'int', nullable: true })
  gasUsed: number | null;

  /**
   * Effective gas price paid for the bundle transaction on-chain
   * This is null until the bundle is confirmed
   */
  @Column({ type: 'varchar', length: 78, nullable: true })
  effectiveGasPrice: string | null;

  /**
   * Additional metadata for the bundle
   * Stored as a JSON object
   */
  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  /**
   * Optimization settings for the bundle
   * Stored as a JSON object
   */
  @Column({ type: 'jsonb', default: {} })
  optimizationSettings: {
    /**
     * Whether to optimize gas price for this bundle
     */
    optimizeGasPrice: boolean;
    
    /**
     * Whether to reorder transactions for optimal execution
     */
    reorderTransactions: boolean;
    
    /**
     * Whether to retry failed transactions
     */
    retryFailedTransactions: boolean;
    
    /**
     * Custom gas price boost factor (1.0 = no boost)
     */
    gasPriceBoostFactor: number;
    
    /**
     * Additional optimization settings
     */
    [key: string]: any;
  };

  /**
   * Performance metrics for the bundle
   * Stored as a JSON object
   */
  @Column({ type: 'jsonb', default: {} })
  performanceMetrics: {
    /**
     * Time taken to finalize the bundle (ms)
     */
    finalizationTime?: number;
    
    /**
     * Time taken to process the bundle (ms)
     */
    processingTime?: number;
    
    /**
     * Time taken to submit the bundle (ms)
     */
    submissionTime?: number;
    
    /**
     * Time taken for the bundle to be confirmed (ms)
     */
    confirmationTime?: number;
    
    /**
     * Total time from creation to confirmation (ms)
     */
    totalTime?: number;
    
    /**
     * Additional performance metrics
     */
    [key: string]: any;
  };
}
