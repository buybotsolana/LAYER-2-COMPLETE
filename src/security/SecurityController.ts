// English comment for verification
/**
 * @file SecurityController.ts
 * @description Controller for security operations
 * @author Manus AI
 * @date April 27, 2025
 */

import { Controller, Get, Post, Body, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { EnhancedSecurityService } from './EnhancedSecurityService';

/**
 * Controller for security operations
 */
@ApiTags('security')
@Controller('security')
export class SecurityController {
  /**
   * Constructor for SecurityController
   * 
   * @param securityService - Enhanced security service
   */
  constructor(
    private readonly securityService: EnhancedSecurityService
  ) {}
  
  /**
   * Get security service status
   * 
   * @returns The current status of the security service
   */
  @Get('status')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get security service status' })
  @ApiResponse({ status: 200, description: 'Status retrieved successfully' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getStatus(): Promise<any> {
    return this.securityService.getStatus();
  }
  
  /**
   * Get recent security events
   * 
   * @param limit - Maximum number of events to return
   * @param type - Filter by event type
   * @param severity - Filter by severity level
   * @returns List of security events
   */
  @Get('events')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get recent security events' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Maximum number of events to return' })
  @ApiQuery({ name: 'type', required: false, type: String, description: 'Filter by event type' })
  @ApiQuery({ name: 'severity', required: false, type: String, description: 'Filter by severity level' })
  @ApiResponse({ status: 200, description: 'Events retrieved successfully' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getEvents(
    @Query('limit') limit?: number,
    @Query('type') type?: string,
    @Query('severity') severity?: string
  ): Promise<any[]> {
    // This would require repository access
    // For now, we'll just return an empty array
    return [];
  }
  
  /**
   * Start the security service
   * 
   * @returns Success message
   */
  @Post('start')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Start the security service' })
  @ApiResponse({ status: 201, description: 'Service started successfully' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async startService(): Promise<{ message: string }> {
    await this.securityService.start();
    return { message: 'Security service started successfully' };
  }
  
  /**
   * Stop the security service
   * 
   * @returns Success message
   */
  @Post('stop')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Stop the security service' })
  @ApiResponse({ status: 201, description: 'Service stopped successfully' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async stopService(): Promise<{ message: string }> {
    await this.securityService.stop();
    return { message: 'Security service stopped successfully' };
  }
  
  /**
   * Log a security event
   * 
   * @param eventData - Event data
   * @returns Success message
   */
  @Post('events')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Log a security event' })
  @ApiResponse({ status: 201, description: 'Event logged successfully' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async logEvent(@Body() eventData: any): Promise<{ message: string }> {
    await this.securityService.logSecurityEvent(
      eventData.type,
      eventData.message,
      eventData.data
    );
    return { message: 'Security event logged successfully' };
  }
}
