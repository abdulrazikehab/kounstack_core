import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CheckoutService } from './checkout.service';
import { CartService } from '../cart/cart.service'; // Import CartService
import { GuestCheckoutService } from '../guest-checkout/guest-checkout.service';
import { AuthenticatedRequest } from '../types/request.types';

import { Public } from '../auth/public.decorator';

@Controller('checkout')
@UseGuards(JwtAuthGuard)
export class CheckoutController {
  constructor(
    private checkoutService: CheckoutService,
    private cartService: CartService, // Inject CartService
    private guestCheckoutService: GuestCheckoutService,
  ) {}

  private ensureTenantId(tenantId: string | undefined): string {
    // Use provided tenantId, or fall back to default
    return tenantId || process.env.DEFAULT_TENANT_ID || 'default';
  }

  @Post()
  async createOrder(
    @Request() req: any,
    @Body() body: {
      customerEmail: string;
      customerName?: string;
      shippingAddress?: any;
      billingAddress?: any;
      customerPhone?: string;
      paymentMethod?: string;
      useWalletBalance?: boolean;
      serialNumberDelivery?: string[]; // Array of delivery options: 'text', 'excel', 'pdf', 'email', 'whatsapp', 'inventory'
    },
  ) {
    const sessionId = this.getSessionId(req);
    const userId = req.user?.id;
    const tenantId = this.ensureTenantId(req.tenantId);
    
    // Get or create cart properly
    const cart = await this.cartService.getOrCreateCart(
      tenantId,
      sessionId,
      userId,
    );

    return this.checkoutService.createOrderFromCart(
      tenantId,
      cart.id,
      body.customerEmail,
      body.customerName,
      body.shippingAddress,
      body.billingAddress,
      body.customerPhone,
      undefined, // notes
      req.ip || req.socket.remoteAddress || '',
      {
        paymentMethod: body.paymentMethod,
        useWalletBalance: body.useWalletBalance,
        userId: userId,
        serialNumberDelivery: body.serialNumberDelivery,
      }
    );
  }

  @Public()
  @Get('settings')
  async getCheckoutSettings(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.tenantId || 'default';
    return this.guestCheckoutService.getCheckoutSettings(tenantId);
  }

  @Put('settings')
  async updateCheckoutSettings(
    @Request() req: AuthenticatedRequest,
    @Body() settings: any,
  ) {
    const tenantId = req.user?.tenantId || req.tenantId || 'default';
    return this.guestCheckoutService.updateCheckoutSettings(tenantId, settings);
  }

  // ... rest of the methods

  private getSessionId(req: AuthenticatedRequest): string {
    return req.headers['x-session-id'] as string || `session-${Date.now()}`;
  }
}