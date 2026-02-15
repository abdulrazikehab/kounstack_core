// apps/app-core/src/payment/hyperpay/hyperpay.service.ts
import { Injectable, Logger, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderService } from '../../order/order.service';
import { v4 as uuidv4 } from 'uuid';

export interface HyperPayCheckoutSession {
  id: string;
  result: {
    code: string;
    description: string;
  };
  buildNumber: string;
  timestamp: string;
  ndc: string;
}

export interface HyperPayPaymentStatus {
  id: string;
  paymentType: string;
  paymentBrand: string;
  amount: string;
  currency: string;
  descriptor: string;
  result: {
    code: string;
    description: string;
  };
  resultDetails: {
    AcquirerResponse: string;
    ConnectorTxID1: string;
  };
  card: {
    bin: string;
    last4Digits: string;
    holder: string;
    expiryMonth: string;
    expiryYear: string;
  };
  customer: {
    givenName: string;
    surname: string;
    email: string;
    ip: string;
  };
  customParameters: {
    SHOPPER_tenantId: string;
    SHOPPER_orderId: string;
  };
}

export interface PaymentSessionResponse {
  id: string;
  redirectUrl: string;
  result: {
    code: string;
    description: string;
  };
}

@Injectable()
export class HyperPayService {
  private readonly logger = new Logger(HyperPayService.name);
  private readonly baseUrl: string;
  private readonly entityId: string;
  private readonly accessToken: string;
  private readonly testMode: boolean;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    @Inject(forwardRef(() => OrderService))
    private orderService: OrderService,
  ) {
    this.baseUrl = this.configService.get('HYPERPAY_BASE_URL') || 'https://eu-proxy.oppwa.com';
    this.entityId = this.configService.get('HYPERPAY_ENTITY_ID') || '';
    this.accessToken = this.configService.get('HYPERPAY_ACCESS_TOKEN') || '';
    this.testMode = this.configService.get('NODE_ENV') === 'development';

    if (!this.entityId || !this.accessToken) {
      this.logger.warn('HyperPay credentials not configured');
    }
  }

  async createCheckoutSession(
    tenantId: string,
    orderId: string,
    // Amount is now fetched from DB for security
    currency: string = 'SAR',
    customerData: {
      email: string;
      name?: string;
      ip?: string;
    },
  ): Promise<PaymentSessionResponse> {
    // Get default currency from tenant settings if not provided or is default
    if (!currency || currency === 'SAR') {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      });
      const settings = (tenant?.settings || {}) as Record<string, unknown>;
      const defaultCurrency = (settings.currency as string);
      if (defaultCurrency) {
        currency = defaultCurrency;
      }
    }
    
    if (!this.entityId || !this.accessToken) {
      throw new BadRequestException('Payment gateway not configured');
    }

    // Verify order exists and get order details
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        tenantId,
      },
    });

    if (!order) {
      throw new BadRequestException('Order not found');
    }

    // SECURITY FIX: Use the amount from the database, not from the client
    // Assuming 'total' or 'amount' field exists on order. 
    // Using 'total' as it is the standard field for order total in this codebase's convention usually.
    // If 'total' doesn't exist, we try 'amount'.
    const orderAmount = (order as any).total || (order as any).amount;
    
    if (!orderAmount) {
      this.logger.error(`Order ${orderId} has no total amount`);
      throw new BadRequestException('Invalid order amount');
    }

    const formattedAmount = Number(orderAmount).toFixed(2);

    const formData = new URLSearchParams({
      'entityId': this.entityId,
      'amount': formattedAmount,
      'currency': currency,
      'paymentType': 'DB',
      'merchantTransactionId': order.orderNumber,
      'customer.email': customerData.email,
      'customer.givenName': customerData.name?.split(' ')[0] || 'Customer',
      'customer.surname': customerData.name?.split(' ').slice(1).join(' ') || 'Name',
      'browserPayment': 'true',
      'shopperResultUrl': `${this.configService.get('FRONTEND_URL')}/payment/callback`,
      'notificationUrl': `${this.configService.get('API_URL')}/payment/webhook/hyperpay`,
      'testMode': this.testMode ? 'EXTERNAL' : 'NONE',
    });

    // Add custom parameters
    formData.append('customParameters[SHOPPER_tenantId]', tenantId);
    formData.append('customParameters[SHOPPER_orderId]', orderId);

    try {
      const response = await fetch(`${this.baseUrl}/v1/checkouts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData,
      });

      const data = await response.json() as HyperPayCheckoutSession;

      if (data.result.code !== '000.200.100') {
        this.logger.error('HyperPay checkout creation failed:', data.result);
        throw new BadRequestException(`Payment session creation failed: ${data.result.description}`);
      }

      // Create payment record in database
      await this.prisma.payment.create({
        data: {
          tenantId,
          orderId,
          amount: Number(orderAmount),
          currency,
          status: 'PENDING',
          gateway: 'HYPERPAY',
          gatewayPaymentId: data.id,
        },
      });

      this.logger.log(`HyperPay checkout session created: ${data.id} for order ${orderId}`);
      
      return {
        id: data.id,
        redirectUrl: `${this.baseUrl}/v1/paymentWidgets.js?checkoutId=${data.id}`,
        result: data.result,
      };
    } catch (error) {
      this.logger.error('HyperPay API error:', error);
       // Check if exception is already BadRequestException
       if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Failed to create payment session');
    }
  }

  async checkPaymentStatus(checkoutId: string): Promise<HyperPayPaymentStatus> {
    if (!this.entityId || !this.accessToken) {
      throw new BadRequestException('Payment gateway not configured');
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/v1/checkouts/${checkoutId}/payment?entityId=${this.entityId}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json() as HyperPayPaymentStatus;

      this.logger.log(`HyperPay payment status for ${checkoutId}: ${data.result.code}`);

      return data;
    } catch (error) {
      this.logger.error('HyperPay status check error:', error);
      throw new BadRequestException('Failed to check payment status');
    }
  }

  async processWebhook(payload: any, signature: string, rawBody?: Buffer): Promise<void> {
    // Verify webhook signature
    // SECURITY FIX: Using rawBody if available
    if (!this.verifyWebhookSignature(payload, signature, rawBody)) {
      throw new BadRequestException('Invalid webhook signature');
    }

    const { id, paymentType, result, customParameters } = payload;

    this.logger.log(`Processing HyperPay webhook for checkout: ${id}, status: ${result.code}`);

    // Extract tenant and order information from custom parameters
    const tenantId = customParameters?.SHOPPER_tenantId;
    const orderId = customParameters?.SHOPPER_orderId;

    if (!tenantId || !orderId) {
      this.logger.error('Missing tenantId or orderId in webhook payload');
      return;
    }

    // Update payment and order status based on payment result
    try {
      if (this.isSuccessfulPayment(result.code)) {
        await this.handleSuccessfulPayment(tenantId, orderId, id, payload);
      } else if (this.isPendingPayment(result.code)) {
        await this.handlePendingPayment(tenantId, orderId, id, payload);
      } else {
        await this.handleFailedPayment(tenantId, orderId, id, payload);
      }
    } catch (error) {
      this.logger.error('Error processing webhook:', error);
      throw error;
    }
  }

  private isSuccessfulPayment(resultCode: string): boolean {
    const successCodes = [
      '000.000.000', // Transaction successful
      '000.100.110', // Transaction successful
      '000.100.111', // Transaction successful
      '000.100.112', // Transaction successful
      '000.300.000', // Transaction successful
      '000.300.100', // Transaction successful
      '000.300.101', // Transaction successful
      '000.300.102', // Transaction successful
    ];
    return successCodes.includes(resultCode);
  }

  private isPendingPayment(resultCode: string): boolean {
    const pendingCodes = [
      '000.200.000', // Transaction pending
      '000.200.100', // Transaction pending
      '000.200.101', // Transaction pending
      '000.200.102', // Transaction pending
      '000.400.000', // Transaction pending
      '000.400.100', // Transaction pending
    ];
    return resultCode.startsWith('000.400') || pendingCodes.includes(resultCode);
  }

  private async handleSuccessfulPayment(
    tenantId: string, 
    orderId: string, 
    paymentId: string, 
    payload: any
  ) {
    const prisma = this.prisma;
    
    await prisma.$transaction(async (tx: any) => {
      // Update payment status
      await tx.payment.updateMany({
        where: {
          gatewayPaymentId: paymentId,
          tenantId,
          orderId,
        },
        data: {
          status: 'SUCCEEDED',
          gatewayResponse: payload,
          updatedAt: new Date(),
        },
      });

      // Update order status with tenant isolation
      // SECURITY FIX: User updateMany for tenant isolation as 'id' is a unique field but tenantId must be checked
      await tx.order.updateMany({
        where: { id: orderId, tenantId },
        data: {
          status: 'CONFIRMED',
          paymentStatus: 'SUCCEEDED',
          transactionId: paymentId,
          paidAt: new Date(),
          updatedAt: new Date(),
        },
      });
    });

    this.logger.log(`Payment successful for order ${orderId}, tenant ${tenantId}`);

    // Process digital cards delivery after successful payment
    try {
      await this.orderService.processDigitalCardsDeliveryAfterPayment(orderId);
    } catch (error: any) {
      this.logger.error(`Failed to process digital cards delivery after payment for order ${orderId}:`, error);
      // Don't fail the payment processing if delivery fails
    }
  }

  private async handlePendingPayment(
    tenantId: string, 
    orderId: string, 
    paymentId: string, 
    payload: any
  ) {
    await this.prisma.payment.updateMany({
      where: {
        gatewayPaymentId: paymentId,
        tenantId,
        orderId,
      },
      data: {
        status: 'PROCESSING',
        gatewayResponse: payload,
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Payment pending for order ${orderId}, tenant ${tenantId}`);
  }

  private async handleFailedPayment(
    tenantId: string, 
    orderId: string, 
    paymentId: string, 
    payload: any
  ) {
    const prisma = this.prisma;
    
    await prisma.$transaction(async (tx: any) => {
      // Update payment status
      await tx.payment.updateMany({
        where: {
          gatewayPaymentId: paymentId,
          tenantId,
          orderId,
        },
        data: {
          status: 'FAILED',
          gatewayResponse: payload,
          updatedAt: new Date(),
        },
      });

      // Update order status with tenant isolation
      await tx.order.updateMany({
        where: { id: orderId, tenantId },
        data: {
          paymentStatus: 'FAILED',
          updatedAt: new Date(),
        },
      });
    });

    this.logger.warn(`Payment failed for order ${orderId}, tenant ${tenantId}: ${payload.result.description}`);
  }

  private verifyWebhookSignature(payload: any, signature: string, rawBody?: Buffer): boolean {
    const secret = this.configService.get<string>('HYPERPAY_WEBHOOK_SECRET');
    if (!secret || secret.length < 32) {
      this.logger.error('HYPERPAY_WEBHOOK_SECRET not configured or too weak');
      return false;
    }

    const crypto = require('crypto');
    let dataToSign: string;
    
    // SECURITY FIX: Prefer raw body for signature verification to ensure byte-for-byte match
    if (rawBody) {
        dataToSign = rawBody.toString('utf8');
    } else {
        this.logger.warn('Verifying webhook signature using JSON.stringify (unsafe) - Raw body missing');
        dataToSign = JSON.stringify(payload);
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(dataToSign)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );
    } catch (e) {
      return false;
    }
  }

  private generateWebhookSignature(payload: any): string {
    const secret = this.configService.get<string>('HYPERPAY_WEBHOOK_SECRET');
    if (!secret) {
      throw new Error('HYPERPAY_WEBHOOK_SECRET not configured');
    }
    
    const crypto = require('crypto');
    return crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  getSupportedPaymentMethods(): any[] {
    return [
      {
        brand: 'VISA',
        name: 'Visa',
        supported: true,
        type: 'CARD',
        currencies: ['SAR', 'USD', 'EUR'],
      },
      {
        brand: 'MASTER',
        name: 'Mastercard',
        supported: true,
        type: 'CARD',
        currencies: ['SAR', 'USD', 'EUR'],
      },
      {
        brand: 'MADA',
        name: 'Mada',
        supported: true,
        type: 'CARD',
        currencies: ['SAR'],
      },
      {
        brand: 'APPLEPAY',
        name: 'Apple Pay',
        supported: true,
        type: 'DIGITAL_WALLET',
        currencies: ['SAR', 'USD', 'EUR'],
      },
      {
        brand: 'STC_PAY',
        name: 'STC Pay',
        supported: true,
        type: 'DIGITAL_WALLET',
        currencies: ['SAR'],
      },
    ];
  }

  async refundPayment(
    paymentId: string,
    amount: number,
    reason?: string,
  ): Promise<any> {
    if (!this.entityId || !this.accessToken) {
      throw new BadRequestException('Payment gateway not configured');
    }

    // Get payment details from database
    const payment = await this.prisma.payment.findFirst({
      where: {
        gatewayPaymentId: paymentId,
        status: 'SUCCEEDED',
      },
    });

    if (!payment) {
      throw new BadRequestException('Payment not found or cannot be refunded');
    }

    const refundAmount = amount || payment.amount;

    if (refundAmount > payment.amount) {
      throw new BadRequestException('Refund amount cannot exceed original payment amount');
    }

    const formData = new URLSearchParams({
      'entityId': this.entityId,
      'amount': refundAmount.toFixed(2),
      'currency': payment.currency,
      'paymentType': 'RF',
    });

    try {
      const response = await fetch(`${this.baseUrl}/v1/payments/${paymentId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData,
      });

      const data = await response.json() as {
        id: string;
        result: {
          code: string;
          description: string;
        };
      };

      if (data.result.code !== '000.100.110') {
        this.logger.error('HyperPay refund failed:', data.result);
        throw new BadRequestException(`Refund failed: ${data.result.description}`);
      }

      // Create refund record in database
      await this.prisma.refund.create({
        data: {
          tenantId: payment.tenantId,
          paymentId: payment.id,
          amount: refundAmount,
          currency: payment.currency,
          reason,
          status: 'PROCESSED',
          gatewayRefundId: data.id,
        },
      });

      // Update payment status if full refund
      if (refundAmount === payment.amount) {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'REFUNDED' },
        });

        // Update order status
        await this.prisma.order.update({
          where: { id: payment.orderId },
          data: { 
            status: 'REFUNDED',
            paymentStatus: 'REFUNDED',
          },
        });
      } else {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'PARTIALLY_REFUNDED' },
        });
      }

      this.logger.log(`Payment ${paymentId} refunded successfully`);
      return data;
    } catch (error) {
      this.logger.error('HyperPay refund error:', error);
      throw new BadRequestException('Failed to process refund');
    }
  }
}