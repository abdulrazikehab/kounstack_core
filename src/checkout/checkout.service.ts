import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { OrderService, CreateOrderDto } from '../order/order.service';
import { FraudDetectionService } from '../fraud/fraud-detection.service';
import { PurchaseLimitsService } from '../purchase-limits/purchase-limits.service';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private prisma: PrismaService,
    private cartService: CartService,
    private orderService: OrderService,
    private fraudService: FraudDetectionService,
    private limitsService: PurchaseLimitsService,
  ) {}

  async createOrderFromCart(
    tenantId: string,
    cartId: string,
    customerEmail: string,
    customerName?: string,
    shippingAddress?: any,
    billingAddress?: any,
    customerPhone?: string,
    notes?: string,
    ipAddress: string = '0.0.0.0',
    paymentOptions?: any, // OrderPaymentOptions
  ) {
    // Validate cart exists and has items
    const cart = await this.cartService.getCartById(tenantId, cartId);
    
    if (cart.cartItems.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    // Validate shipping address
    if (!shippingAddress) {
      throw new BadRequestException('Shipping address is required');
    }

    const requiredAddressFields = ['firstName', 'lastName', 'address1', 'city', 'country', 'zipCode'];
    for (const field of requiredAddressFields) {
      if (!shippingAddress[field]) {
        throw new BadRequestException(`Shipping address ${field} is required`);
      }
    }

    // FRAUD CHECK
    const cartTotal = await this.cartService.calculateCartTotal(cart);
    const fraudCheck = await this.fraudService.checkTransactionRisk(tenantId, customerEmail, Number(cartTotal.total), ipAddress);
    
    if (fraudCheck.isRisky) {
      this.logger.warn(`Fraud detected for cart ${cartId}: ${fraudCheck.reason}`);
      throw new ForbiddenException(`Transaction blocked: ${fraudCheck.reason}`);
    }

    // PURCHASE LIMIT CHECK
    let customerTierId: string | undefined;
    let isVerified = false;

    try {
      // Get user info if available - try by email if userId not provided (for guests/unlogged merchants)
      const user = await this.prisma.user.findFirst({
        where: { tenantId, email: customerEmail },
      });

      if (user) {
        // Simple verification check - if user exists in core, they've passed some verification
        isVerified = true;
      }

      const limitCheck = await this.limitsService.checkPurchaseLimit(
        tenantId,
        customerEmail,
        Number(cartTotal.total),
        customerTierId,
        isVerified,
      );

      if (!limitCheck.allowed) {
        this.logger.warn(`Purchase limit exceeded for cart ${cartId}: ${limitCheck.reason}`);
        throw new ForbiddenException(limitCheck.reason || 'Purchase amount exceeds the allowed limit');
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Error checking purchase limits: ${error}`);
    }

    // Create order data
    const orderData: CreateOrderDto = {
      customerEmail,
      customerName,
      shippingAddress,
      billingAddress: billingAddress || shippingAddress,
      customerPhone,
      notes,
      ipAddress,
    };

    // Create the order with payment options
    const order = await this.orderService.createOrder(tenantId, cartId, orderData, paymentOptions);

    // Record purchase for limits tracking
    try {
      await this.limitsService.recordPurchase(
        tenantId,
        customerEmail,
        Number(cartTotal.total),
        customerTierId,
        isVerified,
      );
    } catch (error) {
      this.logger.error(`Error recording purchase for limits: ${error}`);
    }

    return order;
  }

  async calculateShipping(tenantId: string, cartId: string, country: string, region?: string) {
    const cart = await this.cartService.getCartById(tenantId, cartId);
    // const total = await this.cartService.calculateCartTotal(cart); // Unused

    // Simple shipping calculation - in production, integrate with shipping providers
    const shippingRates: { [key: string]: { standard: number; express: number } } = {
      'SA': { standard: 15, express: 25 }, // Saudi Arabia
      'AE': { standard: 20, express: 35 }, // UAE
      'US': { standard: 30, express: 50 }, // USA
      'default': { standard: 25, express: 45 },
    };

    const rates = shippingRates[country] || shippingRates.default;

    return {
      standard: {
        method: 'Standard Shipping',
        cost: rates.standard,
        estimatedDays: '5-7 business days',
      },
      express: {
        method: 'Express Shipping',
        cost: rates.express,
        estimatedDays: '2-3 business days',
      },
    };
  }

  async validateCartForCheckout(tenantId: string, cartId: string) {
    const cart = await this.cartService.getCartById(tenantId, cartId);
    const issues: { type: string; message: string; itemId?: string; available?: number; requested?: number }[] = [];

    // Check inventory
    for (const item of cart.cartItems) {
      if (item.productVariant && item.productVariant.inventoryQuantity < item.quantity) {
        issues.push({
          type: 'INVENTORY',
          message: `Only ${item.productVariant.inventoryQuantity} items available for ${item.product.name} - ${item.productVariant.name}`,
          itemId: item.id,
          available: item.productVariant.inventoryQuantity,
          requested: item.quantity,
        });
      }

      // Check product availability
      if (!item.product.isAvailable) {
        issues.push({
          type: 'UNAVAILABLE',
          message: `${item.product.name} is no longer available`,
          itemId: item.id,
        });
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
      cartTotal: await this.cartService.calculateCartTotal(cart),
      itemCount: cart.cartItems.length,
    };
  }

  async getTenantOrders(tenantId: string, page: number = 1, limit: number = 10) {
    return this.orderService.getOrders(tenantId, page, limit);
  }

  async getOrder(tenantId: string, orderId: string) {
    return this.orderService.getOrder(tenantId, orderId);
  }

  async updateOrderStatus(tenantId: string, orderId: string, status: string) {
    return this.orderService.updateOrderStatus(tenantId, orderId, status);
  }

  async applyCoupon(tenantId: string, cartId: string, couponCode: string) {
    // Validate coupon exists and is valid
    const coupon = await this.prisma.coupon.findFirst({
      where: {
        code: couponCode,
        tenantId,
        isActive: true,
        startDate: { lte: new Date() },
        OR: [
          { endDate: null },
          { endDate: { gt: new Date() } },
        ],
      },
    });

    if (!coupon) {
      throw new BadRequestException('Invalid or expired coupon code');
    }

    // Check usage limits
    const usageCount = await this.prisma.couponRedemption.count({
      where: {
        couponId: coupon.id,
      },
    });

    if (coupon.usageLimit && usageCount >= coupon.usageLimit) {
      throw new BadRequestException('Coupon usage limit exceeded');
    }

    const cart = await this.cartService.getCartById(tenantId, cartId);
    const subtotal = await this.cartService.calculateCartTotal(cart);

    // Calculate discount
    let discountAmount = 0;
    if (coupon.discountType === 'PERCENTAGE') {
      discountAmount = (Number(subtotal.total) * Number(coupon.value)) / 100;
    } else {
      discountAmount = Number(coupon.value);
    }

    // Ensure discount doesn't make total negative
    discountAmount = Math.min(discountAmount, Number(subtotal.total));

    return {
      coupon: {
        code: coupon.code,
        // description: coupon.description, // Description might not exist on coupon model
        discountType: coupon.type,
        discountValue: coupon.value,
      },
      discountAmount,
      newTotal: Number(subtotal.total) - discountAmount,
      applied: true,
    };
  }
}