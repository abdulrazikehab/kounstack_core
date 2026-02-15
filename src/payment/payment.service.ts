// apps/app-core/src/payment/payment.service.ts
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HyperpayService } from './hyperpay/hyperpay.service';

export interface PaymentIntent {
  id: string;
  clientSecret?: string;
  status: string;
  amount: number;
  currency: string;
  paymentMethodTypes: string[];
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private prisma: PrismaService,
    private hyperpayService: HyperpayService,
  ) {}

  async initializePayment(
    tenantId: string,
    orderId: string,
    paymentMethod: string = 'hyperpay',
  ): Promise<any> {
    try {
      // Verify order exists and is in pending state
      const order = await this.prisma.order.findFirst({
        where: {
          id: orderId,
          tenantId,
          status: 'PENDING',
        },
      });

      if (!order) {
        throw new NotFoundException('Order not found or already processed');
      }

      // Check for large payment amount - require manual review
      const orderAmount = Number(order.totalAmount);
      const largePaymentThreshold = parseFloat(process.env.LARGE_PAYMENT_THRESHOLD || '5000'); // Default 5000 SAR
      const requiresReview = orderAmount >= largePaymentThreshold;

      if (requiresReview) {
        // Update order status to CONFIRMED but add note for review
        await this.prisma.order.update({
          where: { id: orderId },
          data: {
            status: 'CONFIRMED',
            notes: `${order.notes ? order.notes + '\n' : ''}⚠️ Large payment (${orderAmount} SAR) - requires manual verification before processing.`,
          },
        });

        // Get default currency for tenant
        const tenant = await this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { settings: true },
        });
        const settings = (tenant?.settings || {}) as Record<string, unknown>;
        const defaultCurrency = (settings.currency as string) || 'SAR';

        // Create transaction with HOLD status
        await this.prisma.transaction.create({
          data: {
            tenantId,
            orderId: order.id,
            orderNumber: order.orderNumber,
            amount: orderAmount,
            currency: defaultCurrency,
            status: 'PENDING', // Hold status
            paymentProvider: 'HYPERPAY',
            customerEmail: order.customerEmail,
            customerName: order.customerName,
            description: `Large payment on hold - requires verification`,
            metadata: {
              requiresReview: true,
              reviewReason: 'Large payment amount',
              threshold: largePaymentThreshold,
            },
          },
        });

        this.logger.warn(`Large payment detected for order ${order.orderNumber}: ${orderAmount} SAR - Payment held for review`);

        return {
          success: true,
          requiresReview: true,
          message: `Your payment of ${orderAmount} SAR requires manual verification. Our team will review your order and process the payment within 24 hours.`,
          order: {
            id: order.id,
            orderNumber: order.orderNumber,
            totalAmount: order.totalAmount,
            currency: 'SAR',
            status: 'CONFIRMED',
          },
        };
      }

      // Get active payment method for tenant
      const tenantPaymentMethod = await this.prisma.paymentMethod.findFirst({
        where: {
          tenantId,
          provider: 'HYPERPAY',
          isActive: true,
        },
      });

      if (!tenantPaymentMethod) {
        throw new BadRequestException('No active payment method configured');
      }

      // Create payment session with HyperPay for normal payments
      const session = await this.hyperpayService.createCheckoutSession(
        tenantId,
        orderId,
        orderAmount,
        'SAR',
        {
          email: order.customerEmail,
          name: order.customerName,
        },
      );

      return {
        success: true,
        requiresReview: false,
        checkoutId: session.id,
        redirectUrl: session.redirectUrl,
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          totalAmount: order.totalAmount,
          currency: 'SAR',
        },
      };
    } catch (error) {
      this.logger.error('Error initializing payment:', error);
      throw new BadRequestException('Failed to initialize payment');
    }
  }

  async getPaymentStatus(tenantId: string, orderId: string) {
    try {
      const payment = await this.prisma.payment.findFirst({
        where: {
          tenantId,
          orderId,
        },
        include: {
          order: {
            select: {
              orderNumber: true,
              status: true,
              paymentStatus: true,
            },
          },
          refunds: {
            where: {
              status: 'PROCESSED',
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!payment) {
        throw new NotFoundException('Payment not found');
      }

      let gatewayStatus: any = null;
      if (payment.gatewayPaymentId) {
        try {
          gatewayStatus = await this.hyperpayService.checkPaymentStatus(payment.gatewayPaymentId);
        } catch (error) {
          this.logger.warn('Failed to fetch gateway status:', error);
        }
      }

      return {
        id: payment.id,
        status: payment.status,
        gateway: payment.gateway,
        amount: payment.amount,
        currency: payment.currency,
        order: payment.order,
        refunds: payment.refunds,
        gatewayStatus,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
      };
    } catch (error) {
      this.logger.error('Error getting payment status:', error);
      throw new BadRequestException('Failed to get payment status');
    }
  }

  async processPaymentWebhook(
    gateway: string,
    payload: any,
    signature: string,
  ): Promise<void> {
    try {
      switch (gateway.toLowerCase()) {
        case 'hyperpay':
          await this.hyperpayService.processWebhook(payload, signature);
          break;
        default:
          throw new BadRequestException(`Unsupported payment gateway: ${gateway}`);
      }
    } catch (error) {
      this.logger.error('Error processing payment webhook:', error);
      throw error;
    }
  }

  async refundPayment(
    tenantId: string,
    orderId: string,
    amount?: number,
    reason?: string,
  ): Promise<any> {
    try {
      const payment = await this.prisma.payment.findFirst({
        where: {
          tenantId,
          orderId,
          status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] },
        },
      });

      if (!payment) {
        throw new NotFoundException('Payment not found or cannot be refunded');
      }

      const refundAmount = amount || Number(payment.amount);

      if (refundAmount > Number(payment.amount)) {
        throw new BadRequestException('Refund amount cannot exceed original payment amount');
      }

      if (!payment.gatewayPaymentId) {
        throw new BadRequestException('Cannot process refund - missing gateway payment ID');
      }

      // Process refund through appropriate gateway
      let refundResult;
      switch (payment.gateway) {
        case 'HYPERPAY':
          refundResult = await this.hyperpayService.refundPayment(
            payment.gatewayPaymentId,
            refundAmount,
            reason,
          );
          break;
        default:
          throw new BadRequestException(`Refunds not supported for gateway: ${payment.gateway}`);
      }

      return {
        success: true,
        refundId: refundResult.id,
        amount: refundAmount,
        status: 'PROCESSED',
      };
    } catch (error) {
      this.logger.error('Error processing refund:', error);
      throw new BadRequestException('Failed to process refund');
    }
  }

  async getPaymentHistory(
    tenantId: string,
    page: number = 1,
    limit: number = 10,
    filters?: {
      status?: string;
      gateway?: string;
      startDate?: Date;
      endDate?: Date;
    },
  ) {
    const skip = (page - 1) * limit;

    const whereClause: any = { tenantId };

    if (filters?.status) {
      whereClause.status = filters.status;
    }

    if (filters?.gateway) {
      whereClause.gateway = filters.gateway;
    }

    if (filters?.startDate || filters?.endDate) {
      whereClause.createdAt = {};
      if (filters.startDate) {
        whereClause.createdAt.gte = filters.startDate;
      }
      if (filters.endDate) {
        whereClause.createdAt.lte = filters.endDate;
      }
    }

    const [payments, total] = await Promise.all([
      this.prisma.payment.findMany({
        where: whereClause,
        include: {
          order: {
            select: {
              orderNumber: true,
              customerEmail: true,
              totalAmount: true,
              status: true,
            },
          },
          refunds: {
            where: {
              status: 'PROCESSED',
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.payment.count({ where: whereClause }),
    ]);

    return {
      data: payments.map((payment: { id: any; status: any; gateway: any; amount: any; currency: any; order: any; refunds: any[]; createdAt: any; updatedAt: any; }) => ({
        id: payment.id,
        status: payment.status,
        gateway: payment.gateway,
        amount: payment.amount,
        currency: payment.currency,
        order: payment.order,
        refundAmount: payment.refunds.reduce((sum, refund) => sum + Number(refund.amount), 0),
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPaymentStats(tenantId: string) {
    const [
      totalPayments,
      successfulPayments,
      pendingPayments,
      failedPayments,
      totalRevenue,
      todayRevenue,
      refundedAmount,
    ] = await Promise.all([
      this.prisma.payment.count({ where: { tenantId } }),
      this.prisma.payment.count({ where: { tenantId, status: 'SUCCEEDED' } }),
      this.prisma.payment.count({ where: { tenantId, status: { in: ['PENDING', 'PROCESSING'] } } }),
      this.prisma.payment.count({ where: { tenantId, status: 'FAILED' } }),
      this.prisma.payment.aggregate({
        where: { tenantId, status: 'SUCCEEDED' },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          tenantId,
          status: 'SUCCEEDED',
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
        _sum: { amount: true },
      }),
      this.prisma.refund.aggregate({
        where: {
          tenantId,
          status: 'PROCESSED',
        },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalPayments,
      statusBreakdown: {
        successful: successfulPayments,
        pending: pendingPayments,
        failed: failedPayments,
      },
      totalRevenue: totalRevenue._sum.amount || 0,
      todayRevenue: todayRevenue._sum.amount || 0,
      refundedAmount: refundedAmount._sum.amount || 0,
      netRevenue: (totalRevenue._sum.amount || 0) - (refundedAmount._sum.amount || 0),
    };
  }

  async getSupportedPaymentMethods(tenantId: string) {
    const tenantMethods = await this.prisma.paymentMethod.findMany({
      where: {
        tenantId,
        isActive: true,
      },
    });

    const hyperpayMethods = this.hyperpayService.getSupportedPaymentMethods();

    return {
      methods: tenantMethods.map((method: { id: any; provider: any; name: any; }) => ({
        id: method.id,
        provider: method.provider,
        name: method.name,
        supportedMethods: hyperpayMethods,
      })),
    };
  }
}