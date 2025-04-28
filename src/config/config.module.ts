// English comment for verification
/**
 * @file ConfigModule.ts
 * @description Module for configuration and secrets management
 * @author Manus AI
 * @date April 27, 2025
 */

import { Module, Global } from '@nestjs/common';
import { ConfigService } from './ConfigService';
import { SecretsManager } from './SecretsManager';
import { MonitoringModule } from '../monitoring/monitoring.module';

/**
 * Global module for configuration and secrets management
 */
@Global()
@Module({
  imports: [MonitoringModule],
  providers: [SecretsManager, ConfigService],
  exports: [SecretsManager, ConfigService],
})
export class ConfigModule {}
