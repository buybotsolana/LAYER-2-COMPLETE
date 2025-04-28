// English comment for verification
/**
 * @file BlockFinalizationController.ts
 * @description Controller for block finalization operations
 * @author Manus AI
 * @date April 27, 2025
 */

import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { BlockFinalizationService } from './BlockFinalizationService';

/**
 * Controller for block finalization operations
 */
@ApiTags('block-finalization')
@Controller('block-finalization')
export class BlockFinalizationController {
  /**
   * Constructor for BlockFinalizationController
   * 
   * @param blockFinalizationService - Block finalization service
   */
  constructor(
    private readonly blockFinalizationService: BlockFinalizationService
  ) {}
  
  /**
   * Get service status
   * 
   * @returns The current status of the service
   */
  @Get('status')
  @ApiOperation({ summary: 'Get service status' })
  @ApiResponse({ status: 200, description: 'Status retrieved successfully' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getStatus(): Promise<any> {
    return this.blockFinalizationService.getStatus();
  }
  
  /**
   * Get block status
   * 
   * @param blockHash - Hash of the block
   * @returns The block status
   */
  @Get('blocks/:blockHash')
  @ApiOperation({ summary: 'Get block status' })
  @ApiParam({ name: 'blockHash', description: 'Hash of the block' })
  @ApiResponse({ status: 200, description: 'Block status retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Block not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getBlockStatus(@Param('blockHash') blockHash: string): Promise<any> {
    return this.blockFinalizationService.getBlockStatus(blockHash);
  }
  
  /**
   * Get all finalized blocks
   * 
   * @param limit - Maximum number of blocks to return
   * @param offset - Offset for pagination
   * @returns List of finalized blocks
   */
  @Get('blocks')
  @ApiOperation({ summary: 'Get all finalized blocks' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Maximum number of blocks to return' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Offset for pagination' })
  @ApiResponse({ status: 200, description: 'Blocks retrieved successfully' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getFinalizedBlocks(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number
  ): Promise<any[]> {
    return this.blockFinalizationService.getFinalizedBlocks(limit, offset);
  }
  
  /**
   * Manually finalize a block
   * 
   * @param blockHash - Hash of the block to finalize
   * @returns The transaction hash
   */
  @Post('blocks/:blockHash/finalize')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Manually finalize a block' })
  @ApiParam({ name: 'blockHash', description: 'Hash of the block to finalize' })
  @ApiResponse({ status: 201, description: 'Block finalized successfully' })
  @ApiResponse({ status: 404, description: 'Block not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async finalizeBlock(@Param('blockHash') blockHash: string): Promise<{ transactionHash: string }> {
    const transactionHash = await this.blockFinalizationService.finalizeBlock(blockHash);
    return { transactionHash };
  }
  
  /**
   * Start the service
   * 
   * @returns Success message
   */
  @Post('start')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Start the service' })
  @ApiResponse({ status: 201, description: 'Service started successfully' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async startService(): Promise<{ message: string }> {
    await this.blockFinalizationService.start();
    return { message: 'Service started successfully' };
  }
  
  /**
   * Stop the service
   * 
   * @returns Success message
   */
  @Post('stop')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Stop the service' })
  @ApiResponse({ status: 201, description: 'Service stopped successfully' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async stopService(): Promise<{ message: string }> {
    await this.blockFinalizationService.stop();
    return { message: 'Service stopped successfully' };
  }
}
