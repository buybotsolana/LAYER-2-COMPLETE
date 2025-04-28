// English comment for verification
/**
 * @file BridgeTransaction.ts
 * @description Model for bridge transactions between Ethereum and Solana
 * 
 * This model represents a transaction processed by the UltraOptimizedBridge,
 * including deposits from Ethereum to Solana and withdrawals from Solana to Ethereum.
 */

import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * Transaction types supported by the bridge
 */
export enum TransactionType {
    DEPOSIT = 'deposit',     // From Ethereum to Solana
    WITHDRAWAL = 'withdrawal' // From Solana to Ethereum
}

/**
 * Transaction status states
 */
export enum TransactionStatus {
    PENDING = 'pending',         // Transaction initiated but not yet submitted
    PROCESSING = 'processing',   // Transaction submitted to source chain
    CONFIRMING = 'confirming',   // Transaction confirmed on source chain, waiting for target chain
    FINALIZING = 'finalizing',   // Transaction being finalized on target chain
    COMPLETED = 'completed',     // Transaction completed on both chains
    FAILED = 'failed',           // Transaction failed
    REJECTED = 'rejected'        // Transaction rejected by security checks
}

/**
 * Bridge transaction entity
 */
@Entity('bridge_transactions')
export class BridgeTransaction {
    /**
     * Unique transaction ID
     */
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /**
     * Type of transaction (deposit or withdrawal)
     */
    @Column({
        type: 'enum',
        enum: TransactionType,
        nullable: false
    })
    @Index()
    type: TransactionType;

    /**
     * Current status of the transaction
     */
    @Column({
        type: 'enum',
        enum: TransactionStatus,
        default: TransactionStatus.PENDING,
        nullable: false
    })
    @Index()
    status: TransactionStatus;

    /**
     * Source blockchain (ethereum or solana)
     */
    @Column({
        type: 'varchar',
        length: 20,
        nullable: false
    })
    @Index()
    sourceChain: string;

    /**
     * Target blockchain (ethereum or solana)
     */
    @Column({
        type: 'varchar',
        length: 20,
        nullable: false
    })
    @Index()
    targetChain: string;

    /**
     * Address on the source chain
     */
    @Column({
        type: 'varchar',
        length: 64,
        nullable: false
    })
    @Index()
    sourceAddress: string;

    /**
     * Address on the target chain
     */
    @Column({
        type: 'varchar',
        length: 64,
        nullable: false
    })
    @Index()
    targetAddress: string;

    /**
     * Token address/identifier
     */
    @Column({
        type: 'varchar',
        length: 64,
        nullable: false
    })
    @Index()
    token: string;

    /**
     * Amount of tokens (in smallest unit, as string to handle large numbers)
     */
    @Column({
        type: 'varchar',
        length: 78, // To accommodate very large numbers
        nullable: false
    })
    amount: string;

    /**
     * Transaction hash on the source chain
     */
    @Column({
        type: 'varchar',
        length: 66, // Ethereum tx hash is 66 chars with 0x prefix
        nullable: true
    })
    @Index()
    sourceTransactionHash: string;

    /**
     * Transaction hash/signature on the target chain
     */
    @Column({
        type: 'varchar',
        length: 128, // Solana signatures can be longer
        nullable: true
    })
    @Index()
    targetTransactionHash: string;

    /**
     * Block number on the source chain
     */
    @Column({
        type: 'bigint',
        nullable: true
    })
    sourceBlockNumber: number;

    /**
     * Block number on the target chain
     */
    @Column({
        type: 'bigint',
        nullable: true
    })
    targetBlockNumber: number;

    /**
     * Number of confirmations on the source chain
     */
    @Column({
        type: 'int',
        nullable: true
    })
    sourceConfirmations: number;

    /**
     * Number of confirmations on the target chain
     */
    @Column({
        type: 'int',
        nullable: true
    })
    targetConfirmations: number;

    /**
     * Fee paid on the source chain (in smallest unit, as string)
     */
    @Column({
        type: 'varchar',
        length: 78,
        nullable: true
    })
    sourceFee: string;

    /**
     * Fee paid on the target chain (in smallest unit, as string)
     */
    @Column({
        type: 'varchar',
        length: 78,
        nullable: true
    })
    targetFee: string;

    /**
     * Error message if the transaction failed
     */
    @Column({
        type: 'text',
        nullable: true
    })
    error: string;

    /**
     * Additional metadata as JSON
     */
    @Column({
        type: 'jsonb',
        nullable: true
    })
    metadata: any;

    /**
     * Number of retry attempts
     */
    @Column({
        type: 'int',
        default: 0,
        nullable: false
    })
    retryCount: number;

    /**
     * Timestamp of the next retry attempt
     */
    @Column({
        type: 'bigint',
        nullable: true
    })
    nextRetryTime: number;

    /**
     * Timestamp when the transaction was initiated
     */
    @Column({
        type: 'bigint',
        nullable: false
    })
    @Index()
    timestamp: number;

    /**
     * Timestamp when the transaction was completed or failed
     */
    @Column({
        type: 'bigint',
        nullable: true
    })
    completedTimestamp: number;

    /**
     * Creation timestamp (managed by TypeORM)
     */
    @CreateDateColumn()
    createdAt: Date;

    /**
     * Last update timestamp (managed by TypeORM)
     */
    @UpdateDateColumn()
    updatedAt: Date;
}
