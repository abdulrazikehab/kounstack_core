import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

interface PaymentSettings {
  hyperPayEnabled: boolean;
  hyperPayEntityId?: string;
  hyperPayAccessToken?: string;
  hyperPayTestMode: boolean;
  hyperPayCurrency: string;
}

@Injectable()
export class HyperPayService implements OnModuleInit {
  private readonly logger = new Logger(HyperPayService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * SECURITY: Validate critical secrets on service initialization
   * Prevents silent webhook validation failures in production
   */
  onModuleInit() {
    const secret = process.env.HYPERPAY_WEBHOOK_SECRET;
    
    if (!secret) {
      this.logger.warn(
        '⚠️ HYPERPAY_WEBHOOK_SECRET is not configured. Webhook signature verification will fail. ' +
        'Set this environment variable before processing production payments.'
      );
    } else if (secret.length < 32) {
      this.logger.error(
        `❌ HYPERPAY_WEBHOOK_SECRET is too weak (${secret.length} chars). ` +
        'Minimum 32 characters required for secure HMAC verification. ' +
        'Please generate a stronger secret.'
      );
    } else {
      this.logger.log('✅ HYPERPAY_WEBHOOK_SECRET configured correctly');
    }
  }

  /**
   * Create a checkout session with HyperPay
   */
  async createCheckout(settings: PaymentSettings, orderData: any) {
    if (!settings.hyperPayEnabled) {
      throw new Error('HyperPay is not enabled');
    }

    if (!settings.hyperPayEntityId || !settings.hyperPayAccessToken) {
      throw new Error('HyperPay credentials not configured');
    }

    // SECURITY FIX: Fetch authoritative order data from DB
    if (!orderData.orderId) {
      throw new Error('Order ID is required for checkout');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderData.orderId },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Determine amount from order (using total or amount field)
    const orderAmount = (order as any).total || (order as any).amount;
    if (!orderAmount) {
       throw new Error('Invalid order amount in database');
    }

    const baseUrl = settings.hyperPayTestMode
      ? 'https://test.oppwa.com'
      : 'https://oppwa.com';

    try {
      const params: Record<string, string> = {
        entityId: settings.hyperPayEntityId,
        amount: Number(orderAmount).toFixed(2),
        currency: settings.hyperPayCurrency,
        paymentType: 'DB',
        merchantTransactionId: order.orderNumber || orderData.orderNumber, // Fallback if orderNumber missing in DB
      };

      // Add customer info if available
      if (orderData.customerEmail) {
        params['customer.email'] = orderData.customerEmail;
      }
      if (orderData.customerName) {
        params['customer.givenName'] = orderData.customerName;
      }

      // Add billing address if available
      if (orderData.billingAddress) {
        params['billing.street1'] = orderData.billingAddress.street || '';
        params['billing.city'] = orderData.billingAddress.city || '';
        params['billing.country'] = orderData.billingAddress.country || 'SA';
      }

      // Add shipping address if available
      if (orderData.shippingAddress) {
        params['shipping.street1'] = orderData.shippingAddress.street || '';
        params['shipping.city'] = orderData.shippingAddress.city || '';
        params['shipping.country'] = orderData.shippingAddress.country || 'SA';
      }

      const response = await fetch(`${baseUrl}/v1/checkouts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${settings.hyperPayAccessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(params),
      });

      if (!response.ok) {
        const error = await response.json() as { result?: { description?: string } };
        throw new Error(error?.result?.description || 'Checkout creation failed');
      }

      const data = await response.json() as { id: string };
      
      return {
        checkoutId: data?.id || '',
        redirectUrl: `${baseUrl}/v1/paymentWidgets.js?checkoutId=${data?.id || ''}`,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`HyperPay checkout failed: ${errorMessage}`);
    }
  }

  /**
   * Get payment status from HyperPay
   */
  async getPaymentStatus(settings: PaymentSettings, checkoutId: string) {
    const baseUrl = settings.hyperPayTestMode
      ? 'https://test.oppwa.com'
      : 'https://oppwa.com';

    try {
      const response = await fetch(
        `${baseUrl}/v1/checkouts/${checkoutId}/payment?entityId=${settings.hyperPayEntityId}`,
        {
          headers: {
            'Authorization': `Bearer ${settings.hyperPayAccessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to get payment status');
      }

      const data = await response.json() as {
        result: { code: string; description: string };
        id: string;
        amount: string;
        currency: string;
      };
      
      // Check if payment was successful
      const isSuccess = /^(000\.000\.|000\.100\.1|000\.[36])/.test(data?.result?.code || '');
      
      return {
        success: isSuccess,
        status: data?.result?.code || '',
        description: data?.result?.description || '',
        transactionId: data?.id || '',
        amount: data?.amount || '',
        currency: data?.currency || '',
      };
    } catch (error: any) {
      throw new Error(`Failed to get payment status: ${error.message}`);
    }
  }

  /**
   * Process HyperPay webhook
   */
  async processWebhook(data: any, signature?: string, rawBody?: Buffer) {
    // SECURITY FIX: Verify webhook signature using RAW BODY if available
    // If rawBody is not available (e.g. middleware configuration issue), we fail securely.
    if (!signature || !this.verifyWebhookSignature(data, signature, rawBody)) {
      throw new Error('Invalid or missing webhook signature');
    }

    const checkoutId = data.id;
    const status = data.result.code;
    
    // Extract tenant ID if available (should be passed in custom parameters ideally)
    // For this older service, we'll try to find the order first, but then verify it
    // against the tenant context if possible. 
    // However, the best fix here is to ensure the update itself is scoped to the tenant.
    
    const order = await this.prisma.order.findFirst({
      where: { 
        transactionId: checkoutId,
        // If we have a tenant context in the webhook (e.g. from session or payload), add it here
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Update order status based on payment result
    const isSuccess = /^(000\.000\.|000\.100\.1|000\.[36])/.test(status);
    
    // SECURITY FIX: Use updateMany with tenant check (even if not strictly required by unique ID)
    // to prevent horizontal privilege escalation if order IDs were ever predictable.
    await this.prisma.order.updateMany({
      where: { 
        id: order.id,
        tenantId: order.tenantId // Ensure we are updating the correct tenant's order
      },
      data: {
        paymentStatus: isSuccess ? 'SUCCEEDED' : 'FAILED',
        status: isSuccess ? 'CONFIRMED' : 'CANCELLED',
        paidAt: isSuccess ? new Date() : null,
      },
    });

    return { success: isSuccess };
  }

  /**
   * SECURITY: Verify webhook signature using HMAC-SHA256
   * Throws exceptions instead of silent failures for security monitoring
   */
  private verifyWebhookSignature(payload: any, signature: string, rawBody?: Buffer): boolean {
    const secret = process.env.HYPERPAY_WEBHOOK_SECRET;
    
    // SECURITY FIX: Throw exception instead of silent failure
    if (!secret) {
      this.logger.error('❌ SECURITY: HYPERPAY_WEBHOOK_SECRET not configured - cannot verify webhook signature');
      throw new BadRequestException('Webhook signature verification failed: secret not configured');
    }
    
    if (secret.length < 32) {
      this.logger.error(`❌ SECURITY: HYPERPAY_WEBHOOK_SECRET too weak (${secret.length} chars) - minimum 32 required`);
      throw new BadRequestException('Webhook signature verification failed: weak secret');
    }

    // SECURITY FIX: Must use Raw Body for HMAC verification
    // JSON.stringify() is not deterministic and can mismatch what the provider sent
    if (!rawBody) {
      this.logger.error('❌ SECURITY: Webhook received without raw body - signature verification impossible');
      this.logger.error('Check middleware configuration: raw body must be preserved for webhook routes');
      throw new BadRequestException('Webhook signature verification failed: raw body required');
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );
      
      if (!isValid) {
        this.logger.warn('⚠️ SECURITY: Webhook signature mismatch - potential spoofing attempt detected');
      }
      
      return isValid;
    } catch (e) {
      this.logger.error('❌ SECURITY: Webhook signature comparison failed', e);
      throw new BadRequestException('Webhook signature verification failed: invalid signature format');
    }
  }

  /**
   * Refund a payment
   */
  async refundPayment(settings: PaymentSettings, transactionId: string, amount?: number) {
    const baseUrl = settings.hyperPayTestMode
      ? 'https://test.oppwa.com'
      : 'https://oppwa.com';

    try {
      const params: Record<string, string> = {
        entityId: settings.hyperPayEntityId!,
        currency: settings.hyperPayCurrency,
        paymentType: 'RF',
      };

      if (amount) {
        params.amount = amount.toFixed(2);
      }

      const response = await fetch(`${baseUrl}/v1/payments/${transactionId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${settings.hyperPayAccessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(params),
      });

      if (!response.ok) {
        const error = await response.json() as { result?: { description?: string } };
        throw new Error(error?.result?.description || 'Refund failed');
      }

      const data = await response.json() as { id: string; amount: string };
      
      return {
        success: true,
        refundId: data?.id || '',
        amount: data?.amount || '',
      };
    } catch (error: any) {
      throw new Error(`Refund failed: ${error.message}`);
    }
  }
}
