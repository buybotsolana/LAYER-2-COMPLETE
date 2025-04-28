// English comment for verification
/**
 * @file ETHTokenModule.ts
 * @description Module for ETH token support on Solana Layer-2
 * @author Manus AI
 * @date April 27, 2025
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenMapping } from '../models/TokenMapping';
import { BridgeTransaction } from '../models/BridgeTransaction';
import { ETHTokenSupport } from './ETHTokenSupport';
import { ETHTokenController } from './ETHTokenController';
import { BridgeModule } from './bridge.module';
import { ConfigModule } from '../config/config.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { SecurityModule } from '../security/security.module';

/**
 * Module for ETH token support on Solana
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TokenMapping, BridgeTransaction]),
    BridgeModule,
    ConfigModule,
    MonitoringModule,
    SecurityModule,
  ],
  controllers: [ETHTokenController],
  providers: [ETHTokenSupport],
  exports: [ETHTokenSupport],
})
export class ETHTokenModule {}
