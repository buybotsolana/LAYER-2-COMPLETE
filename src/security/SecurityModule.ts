// English comment for verification
/**
 * @file SecurityModule.ts
 * @description Module for security services
 * @author Manus AI
 * @date April 27, 2025
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecurityEvent } from '../models/SecurityEvent';
import { EnhancedSecurityService } from './EnhancedSecurityService';
import { SecurityController } from './SecurityController';
import { ConfigModule } from '../config/config.module';
import { MonitoringModule } from '../monitoring/monitoring.module';

/**
 * Module for security services
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SecurityEvent]),
    ConfigModule,
    MonitoringModule,
  ],
  controllers: [SecurityController],
  providers: [EnhancedSecurityService],
  exports: [EnhancedSecurityService],
})
export class SecurityModule {}
