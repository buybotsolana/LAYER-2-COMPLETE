// English comment for verification
/**
 * @file SecurityEvent.ts
 * @description Entity model for security events
 * @author Manus AI
 * @date April 27, 2025
 */

import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

/**
 * Security event entity
 */
@Entity('security_events')
export class SecurityEvent {
  /**
   * Unique ID
   */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Event type
   */
  @Column({
    type: 'varchar',
    length: 100,
    nullable: false
  })
  @Index()
  type: string;

  /**
   * Event message
   */
  @Column({
    type: 'text',
    nullable: false
  })
  message: string;

  /**
   * Additional data (JSON)
   */
  @Column({
    type: 'jsonb',
    nullable: true
  })
  data: any;

  /**
   * IP address (if applicable)
   */
  @Column({
    type: 'varchar',
    length: 45,
    nullable: true
  })
  @Index()
  ipAddress: string;

  /**
   * User ID (if applicable)
   */
  @Column({
    type: 'varchar',
    length: 100,
    nullable: true
  })
  @Index()
  userId: string;

  /**
   * Severity level
   */
  @Column({
    type: 'varchar',
    length: 20,
    default: 'info'
  })
  @Index()
  severity: string;

  /**
   * Event timestamp
   */
  @Column({
    type: 'timestamp',
    nullable: false
  })
  @Index()
  timestamp: Date;

  /**
   * Creation timestamp
   */
  @CreateDateColumn()
  createdAt: Date;
}
