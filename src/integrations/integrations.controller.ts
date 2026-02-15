import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../types/request.types';
import { IntegrationsService } from './integrations.service';

@UseGuards(JwtAuthGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  async getIntegrations(@Request() req: AuthenticatedRequest) {
    const tenantId = req.user?.tenantId || req.user?.id;
    return this.integrationsService.getIntegrations(tenantId);
  }

  @Post()
  async createIntegration(
    @Request() req: AuthenticatedRequest,
    @Body() data: { name: string; type: string; provider: string; config?: any; credentials?: any }
  ) {
    const tenantId = req.user?.tenantId || req.user?.id;
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }
    return this.integrationsService.createIntegration(tenantId, data);
  }

  @Put(':id')
  async updateIntegration(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() data: { name?: string; isActive?: boolean; config?: any; credentials?: any }
  ) {
    const tenantId = req.user?.tenantId || req.user?.id;
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }
    return this.integrationsService.updateIntegration(tenantId, id, data);
  }

  @Delete(':id')
  async deleteIntegration(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string
  ) {
    const tenantId = req.user?.tenantId || req.user?.id;
    return this.integrationsService.deleteIntegration(tenantId, id);
  }
}

