// English comment for verification
/**
 * @file BlockFinalizationModule.ts
 * @description Module for block finalization functionality
 * @author Manus AI
 * @date April 27, 2025
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockFinalization } from '../models/BlockFinalization';
import { Bundle } from '../sequencer/bundle.entity';
import { Transaction } from '../transaction/transaction.entity';
import { BlockFinalizationService } from './BlockFinalizationService';
import { BlockFinalizationController } from './BlockFinalizationController';
import { ConfigModule } from '../config/config.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { SecurityModule } from '../security/security.module';

/**
 * Module for block finalization functionality
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([BlockFinalization, Bundle, Transaction]),
    ConfigModule,
    MonitoringModule,
    SecurityModule,
  ],
  controllers: [BlockFinalizationController],
  providers: [BlockFinalizationService],
  exports: [BlockFinalizationService],
})
export class BlockFinalizationModule {}
