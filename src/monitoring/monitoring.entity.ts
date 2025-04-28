// English comment for verification
/**
 * @file monitoring.entity.ts
 * @description Entity definitions for monitoring system
 */

import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * Enum for monitoring event severity levels
 */
export enum EventSeverity {
  DEBUG = 'debug',
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

/**
 * Enum for monitoring event categories
 */
export enum EventCategory {
  SYSTEM = 'system',
  DATABASE = 'database',
  TRANSACTION = 'transaction',
  BUNDLE = 'bundle',
  SEQUENCER = 'sequencer',
  BRIDGE = 'bridge',
  GAS = 'gas',
  PERFORMANCE = 'performance',
  SECURITY = 'security',
  NETWORK = 'network'
}

/**
 * Entity for storing monitoring events
 */
@Entity('monitoring_events')
@Index(['timestamp', 'severity'])
@Index(['category', 'severity'])
@Index(['source', 'eventType'])
export class MonitoringEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  source: string;

  @Column({ type: 'varchar', length: 255 })
  eventType: string;

  @Column({
    type: 'enum',
    enum: EventSeverity,
    default: EventSeverity.INFO
  })
  severity: EventSeverity;

  @Column({
    type: 'enum',
    enum: EventCategory,
    default: EventCategory.SYSTEM
  })
  category: EventCategory;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'jsonb', nullable: true })
  details: any;

  @Column({ type: 'varchar', length: 255, nullable: true })
  relatedEntityId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  relatedEntityType: string;

  @CreateDateColumn({ type: 'timestamptz' })
  timestamp: Date;

  @Column({ type: 'boolean', default: false })
  acknowledged: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledgedAt: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  acknowledgedBy: string;

  @Column({ type: 'boolean', default: false })
  resolved: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  resolvedBy: string;

  @Column({ type: 'text', nullable: true })
  resolutionNotes: string;
}

/**
 * Entity for storing performance metrics
 */
@Entity('performance_metrics')
@Index(['timestamp', 'metricType'])
export class PerformanceMetric {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  metricType: string;

  @Column({ type: 'varchar', length: 255 })
  source: string;

  @Column({ type: 'float' })
  value: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  unit: string;

  @Column({ type: 'jsonb', nullable: true })
  dimensions: any;

  @CreateDateColumn({ type: 'timestamptz' })
  timestamp: Date;
}

/**
 * Entity for storing alert configurations
 */
@Entity('alert_configurations')
export class AlertConfiguration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'varchar', length: 255 })
  metricType: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  source: string;

  @Column({ type: 'varchar', length: 50 })
  operator: string;

  @Column({ type: 'float' })
  threshold: number;

  @Column({ type: 'integer' })
  evaluationPeriodSeconds: number;

  @Column({ type: 'integer' })
  consecutiveDatapointsToAlert: number;

  @Column({
    type: 'enum',
    enum: EventSeverity,
    default: EventSeverity.WARNING
  })
  severity: EventSeverity;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'jsonb', nullable: true })
  notificationChannels: any;

  @Column({ type: 'jsonb', nullable: true })
  dimensions: any;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/**
 * Entity for storing alert history
 */
@Entity('alert_history')
@Index(['timestamp', 'severity'])
@Index(['alertConfigurationId', 'status'])
export class AlertHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  alertConfigurationId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({
    type: 'enum',
    enum: EventSeverity,
    default: EventSeverity.WARNING
  })
  severity: EventSeverity;

  @Column({ type: 'varchar', length: 50 })
  status: string; // TRIGGERED, RESOLVED

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'float' })
  value: number;

  @Column({ type: 'float' })
  threshold: number;

  @Column({ type: 'jsonb', nullable: true })
  details: any;

  @CreateDateColumn({ type: 'timestamptz' })
  timestamp: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date;

  @Column({ type: 'integer', default: 0 })
  notificationsSent: number;

  @Column({ type: 'jsonb', nullable: true })
  notificationResults: any;
}

/**
 * Entity for storing system health status
 */
@Entity('system_health')
export class SystemHealth {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  status: string; // healthy, degraded, unhealthy

  @Column({ type: 'jsonb' })
  components: any;

  @Column({ type: 'text', nullable: true })
  message: string;

  @Column({ type: 'jsonb', nullable: true })
  details: any;

  @CreateDateColumn({ type: 'timestamptz' })
  timestamp: Date;
}
