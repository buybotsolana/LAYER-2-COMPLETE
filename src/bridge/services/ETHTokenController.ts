// English comment for verification
/**
 * @file ETHTokenController.ts
 * @description Controller for ETH token operations on Solana Layer-2
 * @author Manus AI
 * @date April 27, 2025
 */

import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { ETHTokenSupport, ETHTokenCreationParams, ETHTokenMintParams, ETHTokenBurnParams } from './ETHTokenSupport';

/**
 * Controller for ETH token operations on Solana
 */
@ApiTags('eth-tokens')
@Controller('eth-tokens')
export class ETHTokenController {
  /**
   * Constructor for ETHTokenController
   * 
   * @param ethTokenSupport - ETH token support service
   */
  constructor(
    private readonly ethTokenSupport: ETHTokenSupport
  ) {}
  
  /**
   * Create a new ETH token on Solana
   * 
   * @param params - Token creation parameters
   * @returns The created token mint address
   */
  @Post()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Create a new ETH token on Solana' })
  @ApiBody({ type: Object, description: 'Token creation parameters' })
  @ApiResponse({ status: 201, description: 'Token created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async createToken(@Body() params: ETHTokenCreationParams): Promise<{ solanaToken: string }> {
    const solanaToken = await this.ethTokenSupport.createETHToken(params);
    return { solanaToken };
  }
  
  /**
   * Mint ETH tokens on Solana
   * 
   * @param params - Token minting parameters
   * @returns The transaction signature
   */
  @Post('mint')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Mint ETH tokens on Solana' })
  @ApiBody({ type: Object, description: 'Token minting parameters' })
  @ApiResponse({ status: 201, description: 'Tokens minted successfully' })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async mintTokens(@Body() params: ETHTokenMintParams): Promise<{ signature: string }> {
    const signature = await this.ethTokenSupport.mintETHToken(params);
    return { signature };
  }
  
  /**
   * Burn ETH tokens on Solana
   * 
   * @param params - Token burning parameters
   * @returns The transaction signature
   */
  @Post('burn')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Burn ETH tokens on Solana' })
  @ApiBody({ type: Object, description: 'Token burning parameters' })
  @ApiResponse({ status: 201, description: 'Tokens burned successfully' })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async burnTokens(@Body() params: ETHTokenBurnParams): Promise<{ signature: string }> {
    const signature = await this.ethTokenSupport.burnETHToken(params);
    return { signature };
  }
  
  /**
   * Get ETH token information
   * 
   * @param solanaToken - Solana token mint address
   * @returns Token information
   */
  @Get(':solanaToken')
  @ApiOperation({ summary: 'Get ETH token information' })
  @ApiParam({ name: 'solanaToken', description: 'Solana token mint address' })
  @ApiResponse({ status: 200, description: 'Token information retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Token not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getTokenInfo(@Param('solanaToken') solanaToken: string): Promise<any> {
    return this.ethTokenSupport.getETHTokenInfo(solanaToken);
  }
  
  /**
   * Get all ETH tokens on Solana
   * 
   * @returns List of ETH tokens on Solana
   */
  @Get()
  @ApiOperation({ summary: 'Get all ETH tokens on Solana' })
  @ApiQuery({ name: 'active', required: false, type: Boolean, description: 'Filter by active status' })
  @ApiResponse({ status: 200, description: 'Tokens retrieved successfully' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getAllTokens(@Query('active') active?: boolean): Promise<any[]> {
    return this.ethTokenSupport.getAllETHTokens();
  }
  
  /**
   * Process a deposit from Ethereum to Solana
   * 
   * @param transactionId - Bridge transaction ID
   * @returns The mint transaction signature
   */
  @Post('process-deposit/:transactionId')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Process a deposit from Ethereum to Solana' })
  @ApiParam({ name: 'transactionId', description: 'Bridge transaction ID' })
  @ApiResponse({ status: 201, description: 'Deposit processed successfully' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async processDeposit(@Param('transactionId') transactionId: string): Promise<{ signature: string }> {
    // This would require fetching the transaction from the repository
    // For now, we'll just throw an error
    throw new Error('Not implemented');
  }
  
  /**
   * Process a withdrawal from Solana to Ethereum
   * 
   * @param transactionId - Bridge transaction ID
   * @returns The burn transaction signature
   */
  @Post('process-withdrawal/:transactionId')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Process a withdrawal from Solana to Ethereum' })
  @ApiParam({ name: 'transactionId', description: 'Bridge transaction ID' })
  @ApiResponse({ status: 201, description: 'Withdrawal processed successfully' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async processWithdrawal(@Param('transactionId') transactionId: string): Promise<{ signature: string }> {
    // This would require fetching the transaction from the repository
    // For now, we'll just throw an error
    throw new Error('Not implemented');
  }
}
