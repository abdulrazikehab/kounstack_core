import { Controller, Get, Put, Body, UseGuards, Request, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PurchaseLimitsService, PurchaseLimitsConfig } from './purchase-limits.service';

@UseGuards(JwtAuthGuard)
@Controller('dashboard/purchase-limits')
export class PurchaseLimitsController {
  private readonly logger = new Logger(PurchaseLimitsController.name);

  constructor(private readonly limitsService: PurchaseLimitsService) {}

  @Get()
  async getLimits(@Request() req: any): Promise<PurchaseLimitsConfig> {
    try {
      const tenantId = req.tenantId || req.user?.tenantId || process.env.DEFAULT_TENANT_ID || 'default';
      return this.limitsService.getOrCreateLimits(tenantId);
    } catch (error: any) {
      this.logger.error('Error getting purchase limits:', error);
      throw error;
    }
  }

  @Put()
  async updateLimits(
    @Request() req: any,
    @Body() data: Partial<PurchaseLimitsConfig>,
  ): Promise<PurchaseLimitsConfig> {
    try {
      const tenantId = req.tenantId || req.user?.tenantId || process.env.DEFAULT_TENANT_ID || 'default';
      return this.limitsService.updateLimits(tenantId, data);
    } catch (error: any) {
      this.logger.error('Error updating purchase limits:', error);
      throw error;
    }
  }
}
