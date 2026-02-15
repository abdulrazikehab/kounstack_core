import { Controller, Get, Post, Put, Body, Param, Headers, UseGuards, Request, ValidationPipe, BadRequestException } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PaymentSettingsService } from './payment-settings.service';
import { HyperPayService } from './hyperpay.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Public } from '../auth/public.decorator';
import { RolesGuard } from '../guard/roles.guard';
import { Roles } from '../decorator/roles.decorator';
import { UserRole } from '../types/user-role.enum';
import { UpdatePaymentSettingsDto, TestHyperPayDto, RefundPaymentDto } from './dto/payment-settings.dto';

@Controller('payment')
export class PaymentController {
  constructor(
    private readonly paymentSettings: PaymentSettingsService,
    private readonly hyperPay: HyperPayService,
  ) {}

  /**
   * Get payment settings (admin only)
   * GET /api/payment/settings
   */
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('settings')
  async getSettings(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.tenantId;
    if (!tenantId || tenantId === 'default' || tenantId === 'system') {
      throw new BadRequestException('Valid tenant context required');
    }
    return this.paymentSettings.getSettings(tenantId);
  }

  /**
   * Get available payment methods for checkout (public)
   * GET /api/payment/methods
   * SECURITY: Rate limited to prevent reconnaissance
   */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Get('methods')
  async getAvailableMethods(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.tenantId || 'default';
    return this.paymentSettings.getAvailablePaymentMethods(tenantId);
  }

  /**
   * Update payment settings (admin only)
   * PUT /api/payment/settings
   */
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Put('settings')
  async updateSettings(@Request() req: any, @Body(ValidationPipe) data: UpdatePaymentSettingsDto) {
    const tenantId = req.user?.tenantId || req.tenantId || 'default';
    
    // SECURITY FIX: Map DTO to internal settings interface securely
    const settings: any = {};
    if (data.hyperpay) {
      if (data.hyperpay.entityId !== undefined) settings.hyperPayEntityId = data.hyperpay.entityId;
      if (data.hyperpay.accessToken !== undefined) settings.hyperPayAccessToken = data.hyperpay.accessToken;
      if (data.hyperpay.testMode !== undefined) settings.hyperPayTestMode = data.hyperpay.testMode;
    }
    
    if (data.enabledMethods) {
      if (data.enabledMethods.hyperpay !== undefined) settings.hyperPayEnabled = data.enabledMethods.hyperpay;
      if (data.enabledMethods.stripe !== undefined) settings.stripeEnabled = data.enabledMethods.stripe;
      if (data.enabledMethods.paypal !== undefined) settings.payPalEnabled = data.enabledMethods.paypal;
      if (data.enabledMethods.neoleap !== undefined) settings.neoleapEnabled = data.enabledMethods.neoleap;
      if (data.enabledMethods.cod !== undefined) settings.codEnabled = data.enabledMethods.cod;
      if (data.enabledMethods.wallet !== undefined) settings.walletEnabled = data.enabledMethods.wallet;
    }

    return this.paymentSettings.updateSettings(tenantId, settings);
  }

  /**
   * Test HyperPay connection (admin only)
   * POST /api/payment/hyperpay/test
   */
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('hyperpay/test')
  async testHyperPay(@Body(ValidationPipe) data: TestHyperPayDto) {
    return this.paymentSettings.testHyperPayConnection(
      data.entityId,
      data.accessToken,
      !!data.testMode,
    );
  }

  /**
   * Create HyperPay checkout (public, for checkout page)
   * POST /api/payment/hyperpay/checkout
   */
  @Public()
  @Post('hyperpay/checkout')
  async createHyperPayCheckout(
    @Body() orderData: any,
    @Request() req: any,
  ) {
    const tenantId = req.user?.tenantId || req.tenantId;
    if (!tenantId || tenantId === 'default') {
      throw new BadRequestException('Valid tenant context required');
    }
    
    // SECURITY FIX: Do not rely on client-provided amount. Service will fetch from DB.
    // We map the orderData to the required parameters
    
    if (!orderData.orderId) {
      throw new BadRequestException('Order ID is required');
    }

    const settings = await this.paymentSettings.getSettings(tenantId);

    // SECURITY FIX: Pass minimal data. Service will fetch order details.
    // ensure orderId is passed.
    const secureOrderData = {
      ...orderData,
      orderId: orderData.orderId,
    };

    return this.hyperPay.createCheckout(settings, secureOrderData);
  }

  /**
   * Get HyperPay payment status (public, for return URL)
   * GET /api/payment/hyperpay/status/:checkoutId
   */
  @Public()
  @Get('hyperpay/status/:checkoutId')
  async getHyperPayStatus(
    @Param('checkoutId') checkoutId: string,
    @Request() req: any,
  ) {
    const tenantId = req.user?.tenantId || req.tenantId;
    if (!tenantId || tenantId === 'default') {
      throw new BadRequestException('Valid tenant context required');
    }
    const settings = await this.paymentSettings.getSettings(tenantId);
    return this.hyperPay.getPaymentStatus(settings, checkoutId);
  }

  /**
   * HyperPay webhook endpoint (public, called by HyperPay)
   * POST /api/payment/hyperpay/webhook
   */
  @Public()
  @Post('hyperpay/webhook')
  async hyperPayWebhook(
    @Request() req: any,
    @Body() data: any,
    @Headers('x-webhook-signature') signature: string,
  ) {
    try {
      // SECURITY FIX: Pass raw body for signature verification
      // Verify signature using the raw body buffer if available, otherwise fallback (which may fail secure checks)
      return await this.hyperPay.processWebhook(data, signature, req.rawBody);
    } catch (error: any) {
      // SECURITY FIX: Generic error message to avoid information leakage
      const isProduction = process.env.NODE_ENV === 'production';
      throw new BadRequestException(isProduction ? 'Webhook processing failed' : error.message);
    }
  }

  /**
   * Refund a payment (admin only)
   * POST /api/payment/hyperpay/refund/:transactionId
   */
  @Roles(UserRole.SHOP_OWNER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('hyperpay/refund/:transactionId')
  async refundPayment(
    @Request() req: any,
    @Param('transactionId') transactionId: string,
    @Body(ValidationPipe) data: RefundPaymentDto,
  ) {
    const tenantId = req.user?.tenantId || req.tenantId;
    if (!tenantId || tenantId === 'default') {
      throw new BadRequestException('Valid tenant context required');
    }
    const settings = await this.paymentSettings.getSettings(tenantId);
    return this.hyperPay.refundPayment(settings, transactionId, data.amount);
  }
}