import { Controller, Post, Get, Body, Query, Headers, UseGuards, Request } from '@nestjs/common';
import { GuestCheckoutService } from './guest-checkout.service';
import { Public } from '../auth/public.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';

@Controller('guest-checkout')
export class GuestCheckoutController {
  constructor(private readonly guestCheckoutService: GuestCheckoutService) {}

  /**
   * Create a guest order (no authentication required)
   * POST /api/guest-checkout/order
   */
  @Public()
  @Post('order')
  async createGuestOrder(
    @Request() req: any,
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Headers('x-tenant-domain') tenantDomain: string,
    @Body() orderData: any,
  ) {
    // Extract tenant ID from multiple sources (priority: header > request > body > default)
    const tenantId = tenantIdHeader || req.tenantId || orderData.tenantId || 'default';
    
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new Error('Invalid or missing tenant ID. Please ensure you are accessing the store from the correct domain.');
    }

    return this.guestCheckoutService.createGuestOrder(tenantId, {
      ...orderData,
      ipAddress: orderData.ipAddress || 'unknown',
    });
  }

  /**
   * Track guest order by order number and email
   * SECURITY FIX: Requires signed token or rate-limited access
   * GET /api/guest-checkout/track?orderNumber=XXX&email=xxx@example.com&token=XXX
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute
  @Get('track')
  async trackGuestOrder(
    @Query('orderNumber') orderNumber: string,
    @Query('email') email: string,
    @Query('token') token?: string,
  ) {
    // SECURITY FIX: Validate token if provided, otherwise use rate-limited access
    return this.guestCheckoutService.getGuestOrder(orderNumber, email, token);
  }

  /**
   * Get all orders by email (for customer orders page - includes both guest and regular orders)
   * GET /api/guest-checkout/orders-by-email?email=xxx@example.com
   */
  @Public()
  @Get('orders-by-email')
  async getOrdersByEmail(
    @Request() req: any,
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Query('email') email: string,
  ) {
    // Extract tenant ID from multiple sources
    const tenantId = tenantIdHeader || req.tenantId || 'default';
    
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new Error('Invalid or missing tenant ID. Please ensure you are accessing the store from the correct domain.');
    }

    if (!email) {
      throw new Error('Email is required');
    }

    return this.guestCheckoutService.getGuestOrdersByEmail(tenantId, email);
  }

  /**
   * Get checkout settings (public, for displaying on checkout page)
   * GET /api/guest-checkout/settings
   */
  @Public()
  @Get('settings')
  async getCheckoutSettings(@Headers('x-tenant-domain') tenantDomain: string) {
    const tenantId = 'default'; // Will be resolved by middleware
    return this.guestCheckoutService.getCheckoutSettings(tenantId);
  }

  /**
   * Update checkout settings (admin only)
   * POST /api/guest-checkout/settings
   */
  @UseGuards(JwtAuthGuard)
  @Post('settings')
  async updateCheckoutSettings(
    @Headers('x-tenant-domain') tenantDomain: string,
    @Body() settings: any,
  ) {
    const tenantId = 'default'; // Will be resolved from JWT
    return this.guestCheckoutService.updateCheckoutSettings(tenantId, settings);
  }
}
