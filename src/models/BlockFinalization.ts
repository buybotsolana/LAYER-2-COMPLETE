// English comment for verification
/**
 * @file BlockFinalization.ts
 * @description Entity model for block finalization records
 * @author Manus AI
 * @date April 27, 2025
 */

import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * Block finalization status enum
 */
export enum BlockFinalizationStatus {
  PENDING = 'PENDING',
  FINALIZED = 'FINALIZED',
  CHALLENGED = 'CHALLENGED',
  INVALIDATED = 'INVALIDATED',
  FAILED = 'FAILED'
}

/**
 * Block finalization entity
 */
@Entity('block_finalizations')
export class BlockFinalization {
  /**
   * Unique ID
   */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Bundle ID
   */
  @Column({
    type: 'varchar',
    length: 36,
    nullable: false
  })
  @Index()
  bundleId: string;

  /**
   * Block number
   */
  @Column({
    type: 'int',
    nullable: false
  })
  @Index()
  blockNumber: number;

  /**
   * Block hash
   */
  @Column({
    type: 'varchar',
    length: 66,
    nullable: false
  })
  @Index()
  blockHash: string;

  /**
   * State root hash
   */
  @Column({
    type: 'varchar',
    length: 66,
    nullable: false
  })
  stateRoot: string;

  /**
   * Parent block hash
   */
  @Column({
    type: 'varchar',
    length: 66,
    nullable: false
  })
  parentBlockHash: string;

  /**
   * Transactions root hash
   */
  @Column({
    type: 'varchar',
    length: 66,
    nullable: false
  })
  transactionsRoot: string;

  /**
   * Number of transactions in the block
   */
  @Column({
    type: 'int',
    nullable: false
  })
  transactionCount: number;

  /**
   * Ethereum transaction hash for the block proposal
   */
  @Column({
    type: 'varchar',
    length: 66,
    nullable: true
  })
  ethereumTransactionHash: string;

  /**
   * Finalization status
   */
  @Column({
    type: 'enum',
    enum: BlockFinalizationStatus,
    default: BlockFinalizationStatus.PENDING
  })
  @Index()
  status: BlockFinalizationStatus;

  /**
   * Error message (if any)
   */
  @Column({
    type: 'text',
    nullable: true
  })
  error: string;

  /**
   * Timestamp when the block was proposed
   */
  @Column({
    type: 'timestamp',
    nullable: false
  })
  proposedAt: Date;

  /**
   * Timestamp when the block was finalized
   */
  @Column({
    type: 'timestamp',
    nullable: true
  })
  finalizedAt: Date;

  /**
   * Creation timestamp
   */
  @CreateDateColumn()
  createdAt: Date;

  /**
   * Last update timestamp
   */
  @UpdateDateColumn()
  updatedAt: Date;
}
