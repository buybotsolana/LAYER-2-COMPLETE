// English comment for verification
/**
 * @file TokenMapping.ts
 * @description Model for token mappings between Ethereum and Solana
 * 
 * This model represents the mapping between tokens on Ethereum and Solana blockchains,
 * allowing the bridge to correctly translate token addresses between chains.
 */

import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index, Unique } from 'typeorm';

/**
 * Token mapping entity
 */
@Entity('token_mappings')
@Unique(['ethereumToken', 'solanaToken'])
export class TokenMapping {
    /**
     * Unique mapping ID
     */
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /**
     * Ethereum token address (0x format)
     */
    @Column({
        type: 'varchar',
        length: 42,
        nullable: false
    })
    @Index()
    ethereumToken: string;

    /**
     * Solana token mint address (base58 format)
     */
    @Column({
        type: 'varchar',
        length: 44,
        nullable: false
    })
    @Index()
    solanaToken: string;

    /**
     * Token symbol (e.g., "USDC", "WETH")
     */
    @Column({
        type: 'varchar',
        length: 20,
        nullable: false
    })
    @Index()
    symbol: string;

    /**
     * Token name (e.g., "USD Coin", "Wrapped Ether")
     */
    @Column({
        type: 'varchar',
        length: 100,
        nullable: true
    })
    name: string;

    /**
     * Token decimals on Ethereum
     */
    @Column({
        type: 'int',
        nullable: false,
        default: 18
    })
    decimals: number;

    /**
     * Token decimals on Solana
     */
    @Column({
        type: 'int',
        nullable: false,
        default: 9
    })
    solanaDecimals: number;

    /**
     * Minimum amount that can be bridged (in smallest unit, as string)
     */
    @Column({
        type: 'varchar',
        length: 78,
        nullable: true
    })
    minAmount: string;

    /**
     * Maximum amount that can be bridged (in smallest unit, as string)
     */
    @Column({
        type: 'varchar',
        length: 78,
        nullable: true
    })
    maxAmount: string;

    /**
     * Daily limit for bridging (in smallest unit, as string)
     */
    @Column({
        type: 'varchar',
        length: 78,
        nullable: true
    })
    dailyLimit: string;

    /**
     * Fee percentage for bridging (basis points, e.g., 25 = 0.25%)
     */
    @Column({
        type: 'int',
        nullable: true,
        default: 0
    })
    feePercentage: number;

    /**
     * Fixed fee amount (in smallest unit, as string)
     */
    @Column({
        type: 'varchar',
        length: 78,
        nullable: true
    })
    fixedFee: string;

    /**
     * Whether the token mapping is active
     */
    @Column({
        type: 'boolean',
        default: true,
        nullable: false
    })
    @Index()
    active: boolean;

    /**
     * Whether deposits are enabled for this token
     */
    @Column({
        type: 'boolean',
        default: true,
        nullable: false
    })
    depositsEnabled: boolean;

    /**
     * Whether withdrawals are enabled for this token
     */
    @Column({
        type: 'boolean',
        default: true,
        nullable: false
    })
    withdrawalsEnabled: boolean;

    /**
     * Total amount deposited (in smallest unit, as string)
     */
    @Column({
        type: 'varchar',
        length: 78,
        nullable: true,
        default: '0'
    })
    totalDeposited: string;

    /**
     * Total amount withdrawn (in smallest unit, as string)
     */
    @Column({
        type: 'varchar',
        length: 78,
        nullable: true,
        default: '0'
    })
    totalWithdrawn: string;

    /**
     * Total fees collected (in smallest unit, as string)
     */
    @Column({
        type: 'varchar',
        length: 78,
        nullable: true,
        default: '0'
    })
    totalFees: string;

    /**
     * Additional metadata as JSON
     */
    @Column({
        type: 'jsonb',
        nullable: true
    })
    metadata: any;

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
