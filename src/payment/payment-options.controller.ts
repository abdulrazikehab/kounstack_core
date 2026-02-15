import { Controller, Get, Post, Put, Body, Param, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantRequiredGuard } from '../guard/tenant-required.guard';
import { PaymentOptionsService } from './payment-options.service';
import { AdminApiKeyGuard } from '../guard/admin-api-key.guard';

@Controller('payment-options')
export class PaymentOptionsController {
  constructor(private readonly paymentOptionsService: PaymentOptionsService) {}

  /**
   * Get all payment options for the current tenant
   * GET /api/payment-options
   */
  @UseGuards(JwtAuthGuard, TenantRequiredGuard)
  @Get()
  async getPaymentOptions(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.tenantId;
    return this.paymentOptionsService.getPaymentOptions(tenantId);
  }

  /**
   * Get enabled payment options for the current tenant (for mobile app)
   * GET /api/payment-options/enabled
   */
  @Get('enabled')
  async getEnabledPaymentOptions(@Request() req: any) {
    // Allow public access but require tenantId in query or header
    const tenantId = req.tenantId || req.query?.tenantId || req.headers['x-tenant-id'];
    
    if (!tenantId) {
      // Try to get from authenticated user
      if (req.user?.tenantId) {
        return this.paymentOptionsService.getEnabledPaymentOptions(req.user.tenantId);
      }
      throw new Error('Tenant ID is required');
    }

    return this.paymentOptionsService.getEnabledPaymentOptions(tenantId);
  }

  /**
   * Set payment option for the current tenant
   * PUT /api/payment-options/:paymentMethodId
   */
  @UseGuards(JwtAuthGuard, TenantRequiredGuard)
  @Put(':paymentMethodId')
  async setPaymentOption(
    @Request() req: any,
    @Param('paymentMethodId') paymentMethodId: string,
    @Body() data: { isEnabled: boolean; displayOrder?: number }
  ) {
    const tenantId = req.user?.tenantId || req.tenantId;
    return this.paymentOptionsService.setPaymentOption(tenantId, paymentMethodId, data);
  }

  /**
   * Toggle payment option for the current tenant
   * POST /api/payment-options/:paymentMethodId/toggle
   */
  @UseGuards(JwtAuthGuard, TenantRequiredGuard)
  @Post(':paymentMethodId/toggle')
  async togglePaymentOption(
    @Request() req: any,
    @Param('paymentMethodId') paymentMethodId: string
  ) {
    const tenantId = req.user?.tenantId || req.tenantId;
    return this.paymentOptionsService.togglePaymentOption(tenantId, paymentMethodId);
  }

  /**
   * Bulk update payment options for the current tenant
   * PUT /api/payment-options/bulk
   */
  @UseGuards(JwtAuthGuard, TenantRequiredGuard)
  @Put('bulk')
  async bulkUpdatePaymentOptions(
    @Request() req: any,
    @Body() updates: Array<{ paymentMethodId: string; isEnabled: boolean; displayOrder?: number }>
  ) {
    const tenantId = req.user?.tenantId || req.tenantId;
    return this.paymentOptionsService.bulkUpdatePaymentOptions(tenantId, updates);
  }

  /**
   * Admin endpoint: Get payment options for a specific tenant
   * GET /api/payment-options/admin/:tenantId
   */
  @UseGuards(AdminApiKeyGuard)
  @Get('admin/:tenantId')
  async getPaymentOptionsForTenant(@Param('tenantId') tenantId: string) {
    return this.paymentOptionsService.getPaymentOptions(tenantId);
  }

  /**
   * Admin endpoint: Set payment option for a specific tenant
   * PUT /api/payment-options/admin/:tenantId/:paymentMethodId
   */
  @UseGuards(AdminApiKeyGuard)
  @Put('admin/:tenantId/:paymentMethodId')
  async setPaymentOptionForTenant(
    @Param('tenantId') tenantId: string,
    @Param('paymentMethodId') paymentMethodId: string,
    @Body() data: { isEnabled: boolean; displayOrder?: number }
  ) {
    return this.paymentOptionsService.setPaymentOption(tenantId, paymentMethodId, data);
  }
}

